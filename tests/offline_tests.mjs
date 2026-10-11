// Real Web Crypto with a deterministic IndexedDB test adapter; no browser private state is inspected.
import assert from "node:assert/strict";
import { indexedDB } from "../data/test-deps/node_modules/fake-indexeddb/build/esm/index.js";
import {
  unlockVault,
  persist,
  lockVault,
  rekeyVault,
  freshVault,
  recoverArchivedVault,
  saveProfile,
  VaultError,
} from "../frontend/offline.js";
globalThis.indexedDB = indexedDB;
const metadata = new Map();
globalThis.localStorage = {
  getItem: (key) => metadata.get(key) || null,
  setItem: (key, value) => metadata.set(key, value),
  removeItem: (key) => metadata.delete(key),
};
const user = {
  id: "test-vault-user",
  offline_salt: "old-random-salt-for-test",
  name: "Synthetic vault test",
};
const password = "old-test-password-123456";
const nextPassword = "new-test-password-123456";
const nextUser = { ...user, offline_salt: "new-random-salt-for-test" };
const draft = {
  notes: [
    { id: "one", title: "Secret draft", content: "Never discard this draft" },
  ],
  pending: {
    one: { note: { id: "one", title: "Secret draft" }, base: 0, version: 1 },
  },
  lockedDrafts: { locked: { note: { title: "Protected draft" } } },
  media: {},
  folders: [],
  tags: [],
  searches: [],
  sequence: 0,
};
assert.equal(await unlockVault(password, user), null);
saveProfile(user);
await persist(user, draft);
await lockVault();
await assert.rejects(unlockVault("wrong-password", user), VaultError);
assert.deepEqual(await unlockVault(password, user), draft);
await lockVault();
await assert.rejects(unlockVault(nextPassword, nextUser), VaultError);
await assert.rejects(rekeyVault("wrong-password", nextPassword, nextUser));
assert.deepEqual(await rekeyVault(password, nextPassword, nextUser), draft);
saveProfile(nextUser);
await lockVault();
assert.deepEqual(await unlockVault(nextPassword, nextUser), draft);
await lockVault();
await assert.rejects(unlockVault(password, user), VaultError);
assert.deepEqual((await freshVault(nextPassword, nextUser)).notes, []);
assert.deepEqual(await recoverArchivedVault(nextPassword, nextUser), draft);
await lockVault();
assert.deepEqual((await unlockVault(nextPassword, nextUser)).pending, {});
console.log(
  "PASS: encryption round trip, wrong-password rejection, salt rotation, draft rekey, protected draft preservation, archived recovery, and lock lifecycle",
);
