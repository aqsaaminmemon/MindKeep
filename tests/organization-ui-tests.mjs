import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(
  new URL("../frontend/app.js", import.meta.url),
  "utf8",
);
let action,
  deletes = [],
  navigations = [],
  refreshed = 0,
  searches = 0;
const elements = {
  "filter-folder": { value: "Ideas" },
  "filter-tag": { value: "Personal" },
};
const state = {
  folders: [{ id: "f1", name: "Ideas" }],
  tags: [{ id: "t1", name: "Personal" }],
  pending: {},
  notes: new Map(),
  folder: "f1",
  tag: null,
  results: null,
};
const context = vm.createContext({
  state,
  $: (id) => elements[id],
  onlineOnly() {},
  confirmDialog(title, message, callback) {
    assert.match(message, /notes will be kept/);
    action = callback;
  },
  readEditor() {},
  async synchronize() {},
  async api(path, method) {
    deletes.push([path, method]);
  },
  navigate(view) {
    navigations.push(view);
    state.folder = null;
    state.tag = null;
  },
  async refreshLibrary() {
    refreshed++;
  },
  getEditorNote() {
    return null;
  },
  updateEditor() {},
  async search() {
    searches++;
  },
  notify() {},
});
vm.runInContext(
  source.slice(
    source.indexOf("function removeOrganization("),
    source.indexOf("function organizationDialog("),
  ),
  context,
);
context.removeOrganization("folders", "f1");
assert.equal(deletes.length, 0, "Confirmation must precede deletion");
await action();
assert.deepEqual(deletes, [["/folders/f1", "DELETE"]]);
assert.deepEqual(navigations, ["all"]);
assert.equal(elements["filter-folder"].value, "");
assert.equal(refreshed, 1);
state.results = [];
context.removeOrganization("tags", "t1");
await action();
assert.equal(elements["filter-tag"].value, "");
assert.equal(searches, 1);
state.pending = { n: { note: { folder_id: "f1", tags: [{ id: "t1" }] } } };
for (const [type, id] of [
  ["folders", "f1"],
  ["tags", "t1"],
]) {
  context.removeOrganization(type, id);
  await assert.rejects(action(), /pending notes/);
}
assert.equal(deletes.length, 2, "Pending edits must prevent removal");
console.log(
  "PASS: folder/tag confirmation, selection cleanup, search refresh and pending draft protection",
);
let renameAction,
  initialName,
  closed = 0,
  focused = 0;
const buttons = [
  {
    focus() {
      focused++;
    },
  },
  {
    focus() {
      focused++;
    },
  },
];
const popup = {
  style: {},
  open: false,
  matches() {
    return this.open;
  },
  setAttribute() {},
  showPopover() {
    this.open = true;
  },
  hidePopover() {
    this.open = false;
    closed++;
  },
  querySelector() {
    return buttons[0];
  },
  querySelectorAll() {
    return buttons;
  },
};
elements["organization-popup"] = popup;
context.innerWidth = 1024;
context.innerHeight = 768;
context.document = { activeElement: buttons[0] };
const anchor = {
  getBoundingClientRect: () => ({ right: 280, bottom: 160 }),
  focus() {
    focused++;
  },
};
context.handle = (fn) => fn;
context.closeUtility = () => {
  throw new Error("Compact menu must not use a modal");
};
context.icon = (name) => `<svg data-icon="${name}"></svg>`;
context.inputDialog = (title, label, callback, type, value) => {
  renameAction = callback;
  initialName = value;
};
for (const [type, id, name] of [
  ["folders", "f1", "Ideas"],
  ["tags", "t1", "Personal"],
]) {
  context.organizationMenu(type, id, anchor);
  assert.match(popup.innerHTML, />Rename<\/button>/);
  assert.match(popup.innerHTML, />Delete<\/button>/);
  assert.equal(popup.open, true);
  assert.equal(popup.style.left, "154px");
  assert.equal(popup.style.top, "165px");
  popup.onkeydown({ key: "ArrowDown", preventDefault() {} });
  popup.onclick({
    target: { closest: () => ({ dataset: { organizationAction: "rename" } }) },
  });
  assert.equal(initialName, name, "Rename starts with the current name");
  await renameAction("New " + name);
  assert.deepEqual(deletes.at(-1), ["/" + type + "/" + id, "PUT"]);
  context.organizationMenu(type, id, anchor);
  popup.onclick({
    target: { closest: () => ({ dataset: { organizationAction: "delete" } }) },
  });
  assert.equal(typeof action, "function", "Delete opens the confirmation");
}
assert.equal(closed, 4);
context.organizationMenu("folders", "f1", anchor);
popup.onkeydown({ key: "Escape", preventDefault() {} });
assert.equal(popup.open, false);
assert.ok(focused > 4);
assert.match(source, /data-organization-menu=/);
assert.doesNotMatch(source, /data-remove-organization=/);
console.log(
  "PASS: compact anchored folder/tag menus, Rename/Delete routing, prefilled names and keyboard dismissal",
);
