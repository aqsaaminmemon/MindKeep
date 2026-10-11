import vm from "node:vm";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = (
  await readFile(new URL("../frontend/editor.js", import.meta.url), "utf8")
)
  .replace(/^import .*;\n/, "")
  .replaceAll("export ", "");
const elements = new Map();
for (const id of [
  "note-title",
  "note-content",
  "editor-dialog",
  "conflict-banner",
  "note-media",
])
  elements.set(id, {
    value: "",
    innerHTML: "",
    classList: { remove() {} },
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  });
const undo = {},
  redo = {};
let saves = 0;
const context = vm.createContext({
  document: {
    getElementById: (id) => elements.get(id),
    querySelector: (selector) => (selector.includes("undo") ? undo : redo),
    createElement: () => ({
      innerHTML: "",
      get innerText() {
        return this.innerHTML;
      },
    }),
  },
  cleanHTML: (text) => text,
  CSS: {},
  setTimeout() {},
  callbacks: null,
});
vm.runInContext(source, context);
context.renderEditorMeta = () => {};
context.decorateChecklists = () => {};
context.counts = () => {};
context.highlight = () => {};
const note = { id: "n", title: "Saved title", content: "Saved content" };
const callbacks = {
  edit() {
    saves++;
  },
};
context.setEditorNote(note, callbacks);
assert.equal(undo.disabled, true);
assert.equal(redo.disabled, true);
elements.get("note-title").value = "New title";
context.changed();
elements.get("note-content").innerHTML = "New content";
context.changed();
assert.equal(undo.disabled, false);
context.command("undo");
assert.equal(note.content, "Saved content");
assert.equal(note.title, "New title");
assert.equal(redo.disabled, false);
context.command("redo");
assert.equal(note.content, "New content");
context.clearEditor();
context.setEditorNote(note, callbacks);
assert.equal(undo.disabled, true);
assert.equal(redo.disabled, true);
context.command("undo");
assert.equal(note.content, "New content");
let prevented = false;
context.historyKey({
  key: "z",
  ctrlKey: true,
  preventDefault() {
    prevented = true;
  },
});
assert.equal(prevented, true);
assert.equal(
  note.content,
  "New content",
  "Keyboard undo cannot undo changes from before Done",
);
elements.get("note-content").innerHTML = "Next session edit";
context.changed();
context.command("undo");
assert.equal(note.content, "New content");
context.clearEditor();
context.setEditorNote(
  { id: "other", title: "Other note", content: "Other content" },
  callbacks,
);
context.command("redo");
assert.equal(
  elements.get("note-content").innerHTML,
  "Other content",
  "History cannot cross notes",
);
assert.ok(saves >= 5);
console.log(
  "PASS: title/content undo and redo within a session; Done/reopen reset; keyboard guard; no history across notes",
);
