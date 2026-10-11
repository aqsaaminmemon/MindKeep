import vm from "node:vm";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../frontend/app.js", import.meta.url),
  "utf8",
);
const elements = {
  "auth-submit": {},
  "auth-error": {},
  "auth-password": { value: "" },
  "auth-email": { value: "qa@example.test" },
  "auth-code": { value: "123456" },
};
const state = { authMode: "forgot" };
let requests = [],
  fail = false;
const context = vm.createContext({
  state,
  $: (id) => elements[id],
  onlineOnly() {},
  async api(path, method, body) {
    requests.push([path, body]);
    if (fail) throw new Error("Incorrect code");
    return path.endsWith("reset-request")
      ? { request_id: "request", message: "Sent" }
      : path.endsWith("reset-verify")
        ? { token: "verified-token" }
        : {};
  },
  authScreen: (mode) => (state.authMode = mode),
  history: { replaceState() {} },
  location: { hash: "", pathname: "/" },
  notify() {},
  VaultError: class extends Error {},
});
vm.runInContext(
  source.slice(
    source.indexOf("async function submitAuth("),
    source.indexOf("function offerVaultRecovery("),
  ),
  context,
);
const event = { preventDefault() {} };
await context.submitAuth(event);
assert.equal(state.authMode, "verify");
assert.equal(requests[0][1].format, "code");
assert.equal(state.resetEmail, "qa@example.test");
fail = true;
await context.submitAuth(event);
assert.equal(state.authMode, "verify");
assert.equal(elements["auth-error"].textContent, "Incorrect code");
fail = false;
await context.submitAuth(event);
assert.equal(state.authMode, "reset");
assert.equal(state.resetToken, "verified-token");
elements["auth-password"].value = "new-synthetic-password";
await context.submitAuth(event);
assert.equal(requests.at(-1)[1].token, "verified-token");
assert.equal(state.authMode, "login");
assert.equal(elements["auth-password"].value, "");
console.log(
  "PASS: email request -> code verification -> new password, invalid-code retry and verified-token use",
);
