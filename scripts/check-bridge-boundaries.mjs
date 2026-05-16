import { readFileSync } from "node:fs";

const bridgeServer = readFileSync("bridge/server.mjs", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  /const\s+maxJsonBodyBytes\s*=\s*256\s*\*\s*1024\s*;/.test(bridgeServer),
  "legacy bridge must cap JSON request bodies at 256 KiB"
);

assert(
  /class\s+RequestBodyTooLargeError\s+extends\s+Error/.test(bridgeServer),
  "legacy bridge must return a typed error for oversized request bodies"
);

assert(
  /this\.statusCode\s*=\s*413\s*;/.test(bridgeServer),
  "oversized legacy bridge request bodies must map to HTTP 413"
);

assert(
  /class\s+InvalidJsonBodyError\s+extends\s+Error/.test(bridgeServer)
    && /this\.statusCode\s*=\s*400\s*;/.test(bridgeServer),
  "invalid legacy bridge JSON must map to HTTP 400"
);

assert(
  /statusCode\s*>=\s*500\s*\?\s*"Request failed"\s*:\s*error\.message/.test(bridgeServer),
  "legacy bridge must not expose raw internal error messages on HTTP 500 responses"
);

assert(
  /response\.headersSent\s*\|\|\s*response\.writableEnded/.test(bridgeServer)
    && /if\s*\(!response\.writableEnded\)\s*\{\s*response\.end\(\);/s.test(bridgeServer),
  "legacy bridge error handler must not write JSON after response headers are sent"
);

console.log("checked bridge/server.mjs external boundaries");
