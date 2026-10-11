import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../frontend/app.js", import.meta.url),
  "utf8",
);
const note = {
  id: "remote-note",
  title: "Hello",
  content: "<p>A searchable thought</p>",
  plain_text: "A searchable thought",
  favorite: false,
  revision: 2,
  updated_at: 100,
  tags: [],
  attachments: [],
};
const state = {
  notes: new Map(),
  pending: {},
  lockedDrafts: {},
  locked: false,
  online: true,
  selecting: false,
  view: "all",
  sort: "updated",
  searchSerial: 0,
  results: null,
};
const elements = {
  search: { value: "Hello" },
  "filter-folder": { value: "" },
  "filter-tag": { value: "" },
  "filter-scope": { value: "all" },
  "search-error": {},
  collection: {},
};
let opened = null,
  menuNote = null,
  saves = 0;
const context = vm.createContext({
  state,
  $: (id) => elements[id],
  highlight() {},
  render() {},
  async api(path) {
    if (path === "/search")
      return {
        results: [{ ...note, snippet: "search preview", score: 5 }],
        highlight_terms: ["hello"],
      };
    if (path === "/notes/" + note.id) return { ...note };
    throw new Error(path);
  },
  getEditorNote: () => opened,
  setEditorNote: (n) => (opened = n),
  editorContext: () => ({}),
  status() {},
  async stash() {},
  async synchronize() {
    saves++;
  },
  editNote(n) {
    state.notes.set(n.id, n);
  },
  updateEditor() {},
  async closeEditor() {
    opened = null;
  },
  noteMenu: (n) => (menuNote = n),
  handle: (fn) => fn,
});
vm.runInContext(
  source.slice(
    source.indexOf("async function search()"),
    source.indexOf("function editorContext()"),
  ),
  context,
);
vm.runInContext(
  source.slice(
    source.indexOf("async function openNote("),
    source.indexOf("async function closeEditor("),
  ),
  context,
);
vm.runInContext(
  source.slice(
    source.indexOf("async function changeNote("),
    source.indexOf("async function conflictCopy("),
  ),
  context,
);
vm.runInContext(
  source.slice(
    source.indexOf("function filteredNotes("),
    source.indexOf("function terms("),
  ),
  context,
);
vm.runInContext(
  source.slice(
    source.indexOf('  $("collection").onclick ='),
    source.indexOf('  $("collection").onchange ='),
  ),
  context,
);
await context.search();
assert.equal(
  state.notes.get(note.id).content,
  note.content,
  "Search hydrates a note absent from the cached library",
);
assert.equal(
  state.notes.get(note.id).snippet,
  undefined,
  "Search previews do not enter the saved note",
);
const click = (dataset) =>
  elements.collection.onclick({ target: { closest: () => ({ dataset }) } });
await click({ open: note.id });
assert.equal(opened.id, note.id);
assert.equal(opened.content, note.content);
for (const selected of [true, false, true]) {
  await click({ favorite: note.id });
  assert.equal(state.notes.get(note.id).favorite, selected);
  const result = context.filteredNotes()[0];
  assert.equal(result.favorite, selected);
  assert.equal(result.snippet, "search preview");
  assert.equal(result.score, 5);
  assert.equal(result.updated_at, 100);
}
assert.equal(saves, 3);
await click({ menu: note.id });
assert.equal(menuNote.id, note.id);
assert.equal(menuNote.favorite, true);
const draft = {
  ...state.notes.get(note.id),
  title: "Unsaved draft",
  content: "Keep this draft",
};
state.notes.set(note.id, draft);
state.pending[note.id] = { note: draft };
await context.search();
assert.equal(state.notes.get(note.id).content, "Keep this draft");
assert.equal(context.filteredNotes()[0].title, "Unsaved draft");
console.log(
  "PASS: uncached search results open, favorite/unfavorite repeatedly, expose current note actions, preserve rank/highlights and protect unsaved drafts",
);
