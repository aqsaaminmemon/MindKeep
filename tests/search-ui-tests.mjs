import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
// Execute the production search lifecycle with controlled transport and DOM inputs.
const source = await readFile(
  new URL("../frontend/app.js", import.meta.url),
  "utf8",
);
const elements = new Map();
for (const [id, value] of Object.entries({
  search: "",
  "filter-folder": "",
  "filter-tag": "",
  "filter-scope": "all",
  "filter-exclude": "",
}))
  elements.set(id, { value });
elements.set("search-error", { hidden: false, textContent: "Old error" });
elements.set("drawer-shade", { hidden: false });
elements.set("filters", { hidden: false });
elements.set("filter-toggle", { setAttribute(name, value) { this[name] = value; } });
const state = {
  query: "thought",
  highlightTerms: ["thought"],
  results: [{ id: "old" }],
  online: true,
  notes: new Map(),
  pending: {},
  searchSerial: 0,
  sort: "relevance",
};
let requests = [],
  editorHighlights = ["thought"],
  renders = 0;
const context = vm.createContext({
  state,
  $: (id) => elements.get(id),
  highlight: (terms) => (editorHighlights = terms),
  render: () => renders++,
  document: { body: { classList: { remove() {} } } },
  api: () => new Promise((resolve) => requests.push(resolve)),
});
const code = source.slice(
  source.indexOf("function navigate("),
  source.indexOf("function editorContext("),
);
vm.runInContext(code, context);
await context.search();
assert.equal(state.results, null);
assert.equal(state.highlightTerms.length, 0);
assert.equal(editorHighlights.length, 0);
assert.equal(elements.get("search-error").hidden, true);
assert.equal(requests.length, 0);
// A delayed old response arriving after clearing must not reintroduce matches.
elements.get("search").value = "thought";
const pending = context.search();
elements.get("search").value = "";
await context.search();
requests.shift()({ results: [{ id: "stale" }], highlight_terms: ["thought"] });
await pending;
assert.equal(state.results, null);
assert.equal(state.highlightTerms.length, 0);
// Navigation also invalidates pending searches.
elements.get("search").value = "thought";
const navigating = context.search();
context.navigate("favorites");
requests.shift()({ results: [{ id: "stale" }], highlight_terms: ["thought"] });
await navigating;
assert.equal(state.view, "favorites");
assert.equal(state.query, "");
assert.equal(state.results, null);
// Filters remain usable after clearing the text, without old highlights.
elements.get("filter-tag").value = "tag-id";
const filtered = context.search();
assert.equal(state.highlightTerms.length, 0);
requests.shift()({ results: [{ id: "filtered" }], highlight_terms: [] });
await filtered;
assert.equal(state.results[0].id, "filtered");
assert.equal(state.highlightTerms.length, 0);
assert.ok(renders >= 4);
console.log(
  "PASS: clear query, stale-response protection, navigation invalidation, and filter-only search",
);

// Clearing through the real input handler cancels pending filtered results and restores capture.
elements.get("search").value = "thought";
elements.get("filter-scope").value = "content";
elements.get("filter-exclude").value = "meeting";
const pendingFiltered = context.search();
state.sort = "relevance";
const savedSearches = [{ id: "saved", query: "thought", filters: { scope: "content" } }];
state.searches = savedSearches;
state.view = "all";
Object.assign(context, { searchTimer: 0, clearTimeout() {}, setTimeout: () => 1 });
vm.runInContext(source.slice(source.indexOf('  $("search").oninput ='),
  source.indexOf('  $("save-search").onclick =')), context);
elements.get("search").value = "";
elements.get("search").oninput();
assert.equal(state.results, null);
assert.equal(state.query, "");
assert.equal(state.sort, "updated");
assert.equal(elements.get("filter-tag").value, "");
assert.equal(elements.get("filter-exclude").value, "");
assert.equal(elements.get("filter-scope").value, "all");
assert.equal(elements.get("filters").hidden, true);
assert.equal(elements.get("filter-toggle")["aria-expanded"], "false");
assert.equal(state.searches, savedSearches);
requests.shift()({ results: [{ id: "late-filtered" }], highlight_terms: ["thought"] });
await pendingFiltered;
assert.equal(state.results, null);
// An empty query in Archive/Trash is a normal category view, not a filter-only search.
for (const category of ["archive", "trash"]) {
  state.view = category;
  await context.search();
  assert.equal(state.view, category);
  assert.equal(state.results, null);
}
state.view = "all";
console.log("PASS: clearing the search input resets filters and relevance, preserves saved searches and category, rejects late responses");

// Exercise the same favorite rendering used by cards and the open editor.
state.pending = {};
const favoriteNote = {
  id: "favorite-test",
  title: "A thought",
  content: "",
  favorite: false,
  tags: [],
  attachments: [],
};
Object.assign(context, {
  escape: (value) => String(value),
  icon: () => "<svg></svg>",
  matched: (text) => text,
  relative: () => "Today",
  mediaURL: () => "",
  formattedPreview: () => "",
  DOMParser: class {
    parseFromString() {
      return { querySelectorAll: () => [], body: { textContent: "" } };
    }
  },
});
vm.runInContext(
  source.slice(
    source.indexOf("function card("),
    source.indexOf("function render("),
  ),
  context,
);
for (const selected of [true, false, true, false]) {
  favoriteNote.favorite = selected;
  const html = context.card(favoriteNote);
  assert.equal(html.includes("icon-button favorite-on"), selected);
  assert.ok(html.includes(`aria-pressed="${selected}"`));
}
const editorSource = await readFile(
  new URL("../frontend/editor.js", import.meta.url),
  "utf8",
);
for (const id of [
  "editor-dialog",
  "note-pin",
  "note-favorite",
  "editor-type",
  "note-folder",
  "note-tags",
  "note-media",
  "editor-reminder",
]) {
  const classes = new Set();
  elements.set(id, {
    dataset: {},
    classList: {
      toggle(name, on) {
        on ? classes.add(name) : classes.delete(name);
      },
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    classes,
  });
}
Object.assign(context, {
  note: favoriteNote,
  callbacks: { folders: () => [] },
});
vm.runInContext(
  editorSource
    .slice(
      editorSource.indexOf("export function renderEditorMeta("),
      editorSource.indexOf("export function initEditor("),
    )
    .replace("export ", ""),
  context,
);
for (const selected of [true, false, true, false]) {
  favoriteNote.favorite = selected;
  context.renderEditorMeta();
  assert.equal(
    elements.get("note-favorite").classes.has("favorite-on"),
    selected,
  );
  assert.equal(elements.get("note-favorite")["aria-pressed"], String(selected));
}
console.log(
  "PASS: card and editor favorite indicators follow repeated selection/deselection",
);

// Production collection rendering controls both composer and empty-state creation.
for (const id of [
  "selection-toolbar",
  "select-notes",
  "selection-actions",
  "selection-count",
  "delete-selected-notes",
  "select-all-notes",
  "note-composer",
  "main-nav",
  "folder-nav",
  "tag-nav",
  "folder-hint",
  "tag-hint",
  "saved-search-count",
  "save-search",
  "saved-filter-list",
  "view-title",
  "view-description",
  "sort",
  "collection",
  "collection-footer",
])
  elements.set(id, { setAttribute() {}, classList: { toggle() {} } });
Object.assign(state, {
  locked: false,
  notes: new Map(),
  folders: [],
  tags: [],
  searches: [],
  results: null,
  folder: null,
  tag: null,
  mode: "grid",
});
Object.assign(context, {
  filteredNotes: () => [],
  refreshMasonry: () => {},
  nav: [
    ["all", "notes", "All Notes"],
    ["favorites", "star", "Favorites"],
    ["recent", "clock", "Recent"],
    ["archive", "archive", "Archive"],
    ["reminders", "bell", "Reminders"],
    ["trash", "trash", "Trash"],
  ],
});
context.document.querySelectorAll = () => [];
vm.runInContext(
  source.slice(source.indexOf("function renderViewControl("), source.indexOf("function setupViewMenu(")), context,
);
vm.runInContext(
  source.slice(
    source.indexOf("function render("),
    source.indexOf("function navigate("),
  ),
  context,
);
for (const view of [
  "all",
  "favorites",
  "recent",
  "archive",
  "reminders",
  "trash",
  "all",
]) {
  state.view = view;
  context.render();
  assert.equal(elements.get("note-composer").hidden, view !== "all");
  assert.equal(
    elements.get("collection").innerHTML.includes('data-new="true"'),
    view === "all",
  );
}
state.query = "hello";
context.render();
assert.equal(elements.get("note-composer").hidden, true);
assert.equal(
  elements.get("collection").innerHTML.includes('data-new="true"'),
  false,
);
state.query = "";
state.results = [];
context.render();
assert.equal(elements.get("note-composer").hidden, true);
state.results = null;
context.render();
assert.equal(elements.get("note-composer").hidden, false);
console.log("PASS: composer and empty-state creation appear only in All Notes");

// Saved names are shown directly beside the search options, including an empty state.
state.searches = [{ id: "saved-1", name: "Work search", query: "project", filters: { scope: "content" } }];
state.view = "all"; state.results = null; state.query = "";
context.render();
assert.ok(elements.get("saved-filter-list").innerHTML.includes('data-saved-search="saved-1"'));
assert.ok(elements.get("saved-filter-list").innerHTML.includes('Run saved search Work search'));
context.clearSearch();
assert.equal(elements.get("note-composer").hidden, false);
assert.ok(elements.get("saved-filter-list").innerHTML.includes('Work search'));
state.searches = Array.from({ length: 5 }, (_, i) => ({ id: `cap-${i}`, name: `Saved ${i}` }));
context.render();
assert.equal(elements.get("save-search").disabled, true);
assert.equal(elements.get("saved-search-count").textContent, "5/5");
state.searches.pop();context.render();
assert.equal(elements.get("save-search").disabled, false);
assert.equal(elements.get("saved-search-count").textContent, "4/5");
state.searches = [];
context.render();
assert.match(elements.get("saved-filter-list").innerHTML, /No saved searches yet/);
console.log("PASS: saved-search list is visible in the panel, clearing restores Create note and keeps saved searches");

// Optional synthetic markup fixture uses the production card and stylesheet for visual QA.
if (process.env.MINDKEEP_UI_FIXTURE) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = new URL("../data/ui-preview/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const icons = await readFile(
    new URL("../frontend/icons.js", import.meta.url),
    "utf8",
  );
  vm.runInContext(icons.replaceAll("export ", ""), context);
  favoriteNote.reminder = { due_at: Date.UTC(2026, 9, 11, 0, 4) };
  favoriteNote.favorite = true;
  const titles = [
    "Weekend plans",
    "A little idea",
    "Project notes",
    "Book list",
    "Tomorrow",
    "Travel notes",
    "A quote",
    "Small reminder",
  ];
  const markup = titles
    .map((title, i) =>
      context.card({
        ...favoriteNote,
        id: `preview-${i}`,
        title,
        plain_text: "A thought worth keeping.\n".repeat(
          [8, 1, 3, 2, 7, 1, 2, 4][i],
        ),
        reminder: i === 7 ? favoriteNote.reminder : null,
      }),
    )
    .join("");
  const css = await readFile(
    new URL("../frontend/styles.css", import.meta.url),
    "utf8",
  );
  await writeFile(
    new URL("index.html", dir),
    `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MindKeep card layout verification</title><style>${css}</style></head><body><main style="padding:24px;max-width:1000px;margin:auto"><h1>MindKeep</h1><p>Updated note actions · synthetic preview</p><h2>Your notes</h2><div id="collection"><div class="notes-grid grid">${markup}</div></div></main><script type="module">import {refreshMasonry} from "/masonry.js"; refreshMasonry();</script></body></html>`,
  );
}

// Execute real pending-save code: favorite-only changes must stay in place offline too.
Object.assign(context, {
  timer: 0,
  clearTimeout: () => {},
  setTimeout: () => 1,
  structuredClone,
  status: () => {},
  stash: () => Promise.resolve(),
  render: () => {},
  getEditorNote: () => null,
  updateEditor: () => {},
  synchronize: () => Promise.resolve(),
});
Object.assign(state, {
  locked: false,
  online: false,
  pending: {},
  notes: new Map(),
});
vm.runInContext(
  source.slice(
    source.indexOf("function editNote("),
    source.indexOf("async function synchronize("),
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
const stationary = {
  id: "stationary",
  revision: 4,
  updated_at: 100,
  title: "Keep order",
  favorite: false,
};
for (const favorite of [true, false, true]) {
  await context.changeNote(stationary, { favorite });
  assert.equal(stationary.updated_at, 100);
  assert.equal(state.pending.stationary.note.updated_at, 100);
  assert.equal(state.pending.stationary.note.favorite, favorite);
}
context.editNote(stationary);
assert.ok(stationary.updated_at > 100);
console.log(
  "PASS: optimistic and offline favorite saves preserve ordering timestamps; edits still update them",
);

// Recent contains five active notes in visit order, independent of edit time.
const recentState = {
  view: "recent", results: null, sort: "title",
  notes: new Map(Array.from({ length: 8 }, (_, i) => {
    const note = { id: `visit-${i}`, title: `Note ${i}`, opened_at: i + 1,
      updated_at: 100 - i, created_at: 100 - i };
    return [note.id, note];
  })),
};
recentState.notes.set("unvisited", { id: "unvisited", updated_at: 1000 });
recentState.notes.set("archived", { id: "archived", opened_at: 1000, archived: true });
recentState.notes.set("deleted", { id: "deleted", opened_at: 2000, deleted: true });
const recentContext = vm.createContext({ state: recentState });
vm.runInContext(source.slice(source.indexOf("function filteredNotes("),
  source.indexOf("function terms(")), recentContext);
const recentIDs = () => Array.from(recentContext.filteredNotes(), n => n.id);
assert.deepEqual(recentIDs(), ["visit-7", "visit-6", "visit-5", "visit-4", "visit-3"]);
recentState.notes.get("visit-0").opened_at = 20;
assert.deepEqual(recentIDs(), ["visit-0", "visit-7", "visit-6", "visit-5", "visit-4"]);
recentState.view = "all";
assert.equal(recentContext.filteredNotes().length, 9);
recentState.view = "recent";
recentState.results = [...recentState.notes.values()].slice(0, 8);
recentState.sort = "relevance";
assert.equal(recentContext.filteredNotes().length, 8);
recentState.results = null;
recentState.notes = new Map([["visit-0", recentState.notes.get("visit-0")]]);
assert.deepEqual(recentIDs(), ["visit-0"]);
console.log("PASS: Recent shows up to five latest visits, revisits reorder, other views remain complete");
