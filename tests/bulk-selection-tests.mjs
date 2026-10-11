import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../frontend/app.js", import.meta.url),
  "utf8",
);
const state = {
  selecting: true,
  selectedNotes: new Set(),
  notes: new Map(),
  online: true,
  results: null,
  pending: {},
};
let confirmation,
  queued = [],
  syncs = 0,
  stashes = 0;
const context = vm.createContext({
  state,
  render() {},
  confirmDialog(title, message, action) {
    assert.match(message, /restore/);
    confirmation = action;
  },
  editNote(n) {
    queued.push(n.id);
    state.pending[n.id] = { note: structuredClone(n) };
  },
  getEditorNote() {
    return null;
  },
  clearEditor() {},
  async stash() {
    stashes++;
  },
  async synchronize() {
    syncs++;
  },
  notify() {},
});
vm.runInContext(
  source.slice(
    source.indexOf("function toggleNoteSelection("),
    source.indexOf("function navigate("),
  ),
  context,
);
const reset = () => {
  state.notes = new Map(
    ["a", "b", "c"].map((id) => [
      id,
      { id, title: id, content: "Preserve " + id, deleted: false },
    ]),
  );
  state.pending = {};
  state.selecting = true;
  state.selectedNotes = new Set();
  state.results = null;
  queued = [];
  syncs = 0;
};
reset();
context.toggleNoteSelection("a");
context.toggleNoteSelection("a");
assert.equal(state.selectedNotes.size, 0);
context.toggleNoteSelection("a");
context.toggleNoteSelection("b");
context.deleteSelectedNotes();
assert.equal(queued.length, 0, "Deletion waits for confirmation");
await confirmation();
assert.deepEqual(queued, ["a", "b"]);
assert.equal(syncs, 1);
assert.equal(state.notes.get("c").deleted, false);
assert.equal(state.pending.a.note.content, "Preserve a");
assert.equal(state.selecting, false);
assert.equal(state.selectedNotes.size, 0);
reset();
state.online = false;
state.selectedNotes = new Set(["a", "b"]);
state.results = [...state.notes.values()];
context.deleteSelectedNotes();
await confirmation();
assert.equal(syncs, 0);
assert.deepEqual(
  state.results.map((n) => n.id),
  ["c"],
);
assert.equal(Object.keys(state.pending).length, 2);
reset();
state.online = true;
state.notes.get("b").conflict = {};
state.selectedNotes = new Set(["a", "b"]);
context.deleteSelectedNotes();
await assert.rejects(confirmation(), /resolve/);
assert.equal(queued.length, 0);
assert.equal(state.notes.get("a").deleted, false);
state.notes.get("b").protected = true;
state.selectedNotes.clear();
context.toggleNoteSelection("b");
assert.equal(state.selectedNotes.size, 0);
console.log(
  "PASS: selection toggles, confirmation, selected-only deletion, one batch sync, preserved offline drafts, search cleanup and conflict/lock protection",
);
