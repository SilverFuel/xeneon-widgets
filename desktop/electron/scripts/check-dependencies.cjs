// Exercise the exact builder -> get -> global-agent -> roarr resolution path.
// This process uses only loopback fixtures, never the user's proxy or trust store.
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { createRequire } = require("node:module");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const tlsFixture = require("./fixtures/localhost-tls.cjs");

for (const name of Object.keys(process.env)) {
  if (/proxy|^NODE_TLS_REJECT_UNAUTHORIZED$|^GLOBAL_AGENT_/i.test(name)) delete process.env[name];
}
process.env.ROARR_LOG = "true";
process.env.ELECTRON_GET_NO_PROGRESS = "1";

const lock = require("../package-lock.json");
assert(!Object.keys(lock.packages).some(name => name.endsWith("/sprintf-js")), "unpatched sprintf-js returned to the lockfile");
const builderRequire = createRequire(require.resolve("app-builder-lib/package.json"));
const getRequire = createRequire(builderRequire.resolve("@electron/get"));
const proxyRequire = createRequire(getRequire.resolve("global-agent"));
const logger = proxyRequire("roarr").default;
assert.equal(typeof logger.child, "function", "global-agent requires the CommonJS default logger");
const records = [];
global.ROARR.write = message => records.push(JSON.parse(message));
const log = logger.child({ package: "dependency-check" }).child({ namespace: "compatibility" });
for (const payload of ["%.100000f", "%(__proto__)s"]) {
  // Untrusted network fields are context values, never format strings.
  log.info({ destination: payload }, "download %s", "fixture");
  assert.equal(records.at(-1).context.destination, payload);
  assert.equal(records.at(-1).context.package, "dependency-check");
  assert.equal(records.at(-1).message, "download fixture");
}
for (const level of ["trace", "debug", "warn", "error"]) log[level]("fixture event");
assert.equal(typeof builderRequire("./out/util/electronGet.js").downloadElectronArtifact, "function");
const { GotDownloader } = getRequire("./GotDownloader.js");
const downloader = new GotDownloader();
const directRequest = http.request.bind(http);
const directAgent = new http.Agent();
const sockets = new Set();
const servers = [];
const directory = mkdtempSync(join(tmpdir(), "auxora-dependency-check-"));
let proxyRequests = 0;
let tunnelRequests = 0;
const deadline = setTimeout(() => {
  console.error("Electron dependency compatibility check timed out");
  process.exit(1);
}, 20000);

function track(socket) {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  return socket;
}

async function listen(server) {
  servers.push(server);
  server.on("connection", track);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function download(url, name, options = {}) {
  const target = join(directory, name);
  await downloader.download(url, target, { quiet: true, retry: { limit: 0 }, timeout: { request: 2000 }, ...options });
  assert.equal(readFileSync(target, "utf8"), "fixture payload");
}

async function main() {
  const handler = (request, response) => {
    if (request.url === "/slow") return;
    if (request.url === "/missing") response.writeHead(404);
    response.end("fixture payload");
  };
  const httpPort = await listen(http.createServer(handler));
  const httpsPort = await listen(https.createServer(tlsFixture, handler));
  const proxy = http.createServer((request, response) => {
    const destination = new URL(request.url);
    // Refuse all traffic except this test's own origin.
    assert.equal(destination.origin, `http://127.0.0.1:${httpPort}`);
    proxyRequests += 1;
    const upstream = directRequest(destination, { agent: directAgent }, result => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    upstream.on("error", error => response.destroy(error));
    upstream.end();
  });
  proxy.on("connect", (request, client, head) => {
    assert.equal(request.url, `localhost:${httpsPort}`);
    tunnelRequests += 1;
    const upstream = track(net.connect(httpsPort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    }));
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);
  const httpUrl = `http://127.0.0.1:${httpPort}`;
  const httpsUrl = `https://localhost:${httpsPort}`;
  const trusted = { https: { certificateAuthority: tlsFixture.cert } };

  await download(httpUrl, "direct");
  process.env.GLOBAL_AGENT_HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
  process.env.GLOBAL_AGENT_HTTPS_PROXY = process.env.GLOBAL_AGENT_HTTP_PROXY;
  getRequire("./proxy.js").initializeProxy();
  assert(global.GLOBAL_AGENT, "get swallowed a proxy bootstrap failure");
  assert.equal(getRequire("global-agent").bootstrap(), false, "bootstrap must remain idempotent");

  await assert.rejects(download(`${httpUrl}/?input=%.100000f`, "malformed"), /URI malformed/);
  await download(`${httpUrl}/?input=${encodeURIComponent("%.100000f")}`, "proxied");
  assert.equal(proxyRequests, 1);
  global.GLOBAL_AGENT.NO_PROXY = "127.0.0.1";
  await download(httpUrl, "bypassed");
  assert.equal(proxyRequests, 1, "NO_PROXY must bypass the proxy");
  global.GLOBAL_AGENT.NO_PROXY = null;
  await download(httpsUrl, "secure", trusted);
  assert.equal(tunnelRequests, 1, "HTTPS must use CONNECT");
  await assert.rejects(download(httpsUrl, "untrusted"), error => error.code === "DEPTH_ZERO_SELF_SIGNED_CERT");
  await assert.rejects(download(httpsUrl, "wrong-host", {
    https: { certificateAuthority: tlsFixture.cert }, servername: "wrong.invalid"
  }), error => error.code === "ERR_TLS_CERT_ALTNAME_INVALID");
  await assert.rejects(download(`${httpUrl}/missing`, "missing"), error => error.response?.statusCode === 404);
  await assert.rejects(download(`${httpUrl}/slow`, "timeout", { timeout: { request: 150 } }), error => error.code === "ETIMEDOUT");
  assert(records.some(record => record.context.package === "global-agent" && record.message === "proxying request"), "proxy trace logging must remain enabled");
  assert(records.some(record => record.context.package === "global-agent" && record.context.logLevel === 50), "proxy errors must still be logged");
  console.log("Electron dependency checks passed: logger context, builder imports, direct/proxied downloads, NO_PROXY, HTTPS CONNECT, certificate/hostname rejection, HTTP errors and timeouts");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  for (const socket of sockets) socket.destroy();
  directAgent.destroy();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  clearTimeout(deadline);
  rmSync(directory, { recursive: true, force: true });
});
