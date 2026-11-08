import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const inlineSource = readFileSync(new URL("../js/inline-widgets.js", import.meta.url), "utf8");
const setupSource = readFileSync(new URL("../js/widgets/setup.js", import.meta.url), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function mountFixture(kind, options = {}) {
  const fieldName = kind === "weather" ? "apiKey" : "password";
  const secret = { value: "", defaultValue: "" };
  const otherSecret = { value: "unsubmitted-other-form-draft", defaultValue: "" };
  const fields = kind === "weather"
    ? { apiKey: secret, city: { value: "Indianapolis" }, units: { value: "metric" } }
    : { password: secret, baseUrl: { value: "https://camera.example.test" }, camera: { value: "garage" }, username: { value: "viewer" } };
  const form = { getAttribute: name => name === "data-form" ? kind : null, fields };
  const listeners = new Map();
  const savedBodies = [];
  const save = deferred();
  const window = {};
  const context = vm.createContext({
    window,
    FormData: class {
      constructor(target) { this.values = Object.fromEntries(Object.entries(target.fields).map(([name, input]) => [name, input.value])); }
      get(name) { return this.values[name] || ""; }
    }
  });
  vm.runInContext(inlineSource, context, { filename: "js/inline-widgets.js" });
  let mountSetup;
  const container = {
    html: "",
    querySelector: selector => {
      if (selector === `form[data-form="${kind}"] input[name="${fieldName}"]`) return secret;
      if (/form\[data-form=/.test(selector)) return otherSecret;
      return null;
    }
  };
  Object.assign(window.InlineWidgets.runtime, {
    registerRenderer: (id, renderer) => { if (id === "setup") mountSetup = renderer; },
    addListener: (_cleanups, _target, type, listener) => listeners.set(type, listener),
    // The stable reconciler retains dirty form values through status redraws.
    // DOM insertion is replaced here; field values remain independent of markup.
    patchStableDom: (target, html) => { target.html = html; },
    buildBridgeUrl: (_env, path) => path,
    requestJson: async (path, request) => {
      if (path === `/api/config/${kind}`) {
        savedBodies.push(JSON.parse(JSON.stringify(request.body)));
        return savedBodies.length === 1 ? save.promise : {};
      }
      if (path === "/api/frigate/test") {
        if (options.testError) throw new Error("Synthetic connection test failure");
        return { configured: true, connected: true, state: "Ready" };
      }
      assert.ok(["/api/health", "/api/config", "/api/hue", "/api/provisioning"].includes(path));
      return {};
    }
  });
  vm.runInContext(setupSource, context, { filename: "js/widgets/setup.js" });
  const controller = mountSetup({ id: "setup" }, container, {
    handleSetupUpdate: async () => { if (options.updateError) throw new Error("Synthetic status refresh failure"); }
  });
  await controller.refresh();
  return {
    controller, secret, otherSecret, savedBodies, save, fieldName,
    submit: () => listeners.get("submit")({ target: form, preventDefault() {} })
  };
}

for (const kind of ["weather", "frigate"]) {
  test(`${kind}: saved secret clears before refresh and is not resubmitted`, async () => {
    const fixture = await mountFixture(kind);
    fixture.secret.value = "synthetic-submitted-secret";
    await fixture.controller.refresh();
    assert.equal(fixture.secret.value, "synthetic-submitted-secret", "unrelated refresh must preserve the draft");
    fixture.submit();
    assert.equal(fixture.secret.value, "synthetic-submitted-secret", "pending save must retain the draft");
    fixture.save.resolve({});
    await settle();
    assert.equal(fixture.secret.value, "");
    assert.equal(fixture.secret.defaultValue, "");
    assert.equal(fixture.otherSecret.value, "unsubmitted-other-form-draft");
    fixture.submit();
    await settle();
    assert.equal(fixture.savedBodies.length, 2);
    assert.equal(fixture.savedBodies[0][fixture.fieldName], "synthetic-submitted-secret");
    assert.equal(fixture.savedBodies[1][fixture.fieldName], "", "subsequent settings save must keep the stored credential");
    fixture.controller.destroy();
  });

  test(`${kind}: rejected save preserves the submitted draft for correction`, async () => {
    const fixture = await mountFixture(kind);
    fixture.secret.value = "synthetic-rejected-secret";
    fixture.submit();
    fixture.save.reject(new Error("Synthetic save rejection"));
    await settle();
    assert.equal(fixture.secret.value, "synthetic-rejected-secret");
    assert.equal(fixture.otherSecret.value, "unsubmitted-other-form-draft");
    fixture.controller.destroy();
  });

  test(`${kind}: successful save preserves a newer draft entered while pending`, async () => {
    const fixture = await mountFixture(kind);
    fixture.secret.value = "synthetic-submitted-secret";
    fixture.submit();
    fixture.secret.value = "synthetic-new-draft";
    fixture.save.resolve({});
    await settle();
    assert.equal(fixture.secret.value, "synthetic-new-draft");
    assert.equal(fixture.otherSecret.value, "unsubmitted-other-form-draft");
    fixture.controller.destroy();
  });

  test(`${kind}: later status refresh failure does not restore the saved secret`, async () => {
    const fixture = await mountFixture(kind, { updateError: true });
    fixture.secret.value = "synthetic-submitted-secret";
    fixture.submit();
    fixture.save.resolve({});
    await settle();
    assert.equal(fixture.secret.value, "");
    fixture.controller.destroy();
  });
}

test("frigate: a connection test failure after saving still clears the saved password", async () => {
  const fixture = await mountFixture("frigate", { testError: true });
  fixture.secret.value = "synthetic-submitted-secret";
  fixture.submit();
  fixture.save.resolve({});
  await settle();
  assert.equal(fixture.secret.value, "");
  fixture.controller.destroy();
});
