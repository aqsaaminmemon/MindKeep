import { icon, escape, cleanHTML, matchRanges } from "./icons.js";
const $ = (id) => document.getElementById(id);
let note = null,
  callbacks = null,
  selection = null;
let undoHistory = [],
  redoHistory = [];
function editorSnapshot() {
  return {
    title: $("note-title").value,
    content: cleanHTML($("note-content").innerHTML),
  };
}
function updateHistoryButtons() {
  document.querySelector('[data-command="undo"]').disabled =
    undoHistory.length < 2;
  document.querySelector('[data-command="redo"]').disabled =
    !redoHistory.length;
}
function recordHistory() {
  const current = editorSnapshot(),
    previous = undoHistory.at(-1);
  if (
    !previous ||
    current.title !== previous.title ||
    current.content !== previous.content
  ) {
    undoHistory.push(current);
    redoHistory = [];
  }
  updateHistoryButtons();
}
function applyHistory(cmd) {
  if (!note) return;
  if (cmd === "undo") {
    if (undoHistory.length < 2) return;
    redoHistory.push(undoHistory.pop());
  } else {
    if (!redoHistory.length) return;
    undoHistory.push(redoHistory.pop());
  }
  const snapshot = undoHistory.at(-1);
  $("note-title").value = snapshot.title;
  $("note-content").innerHTML = snapshot.content;
  selection = null;
  decorateChecklists();
  readEditor();
  counts();
  callbacks.edit(note);
  updateHistoryButtons();
}
function historyKey(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "z" || key === "y") {
    event.preventDefault();
    applyHistory(key === "y" || event.shiftKey ? "redo" : "undo");
  }
}
export function getEditorNote() {
  return note;
}
export function setEditorNote(n, ctx) {
  note = n;
  callbacks = ctx;
  selection = null;
  $("note-title").value = n.title || "";
  $("note-content").innerHTML = cleanHTML(n.content || "");
  undoHistory = [editorSnapshot()];
  redoHistory = [];
  updateHistoryButtons();
  $("editor-dialog").classList.remove("focused");
  $("conflict-banner").hidden = !n.conflict;
  renderEditorMeta();
  decorateChecklists();
  counts();
  highlight(ctx.query || "");
  if (!$("editor-dialog").open) $("editor-dialog").showModal();
  setTimeout(() => $("note-title").focus(), 30);
}
export function updateEditor(n) {
  if (!note || n.id !== note.id) return;
  note = n;
  renderEditorMeta();
  $("conflict-banner").hidden = !n.conflict;
}
export function clearEditor() {
  note = null;
  selection = null;
  undoHistory = [];
  redoHistory = [];
  updateHistoryButtons();
  $("note-title").value = "";
  $("note-content").innerHTML = "";
  $("note-media").innerHTML = "";
  $("editor-dialog").close();
  if (CSS.highlights) CSS.highlights.clear();
}
export function readEditor() {
  if (!note) return null;
  note.title = $("note-title").value;
  note.content = cleanHTML($("note-content").innerHTML);
  const el = document.createElement("div");
  el.innerHTML = note.content;
  note.plain_text = el.innerText || el.textContent;
  return note;
}
export function status(text) {
  $("save-status").textContent = text;
}
function counts() {
  const text = $("note-content").innerText.replace(/\n$/, "");
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) || [];
  $("note-counts").textContent =
    `${words.length} ${words.length === 1 ? "word" : "words"} · ${Array.from(text).length} characters`;
}
function decorateChecklists() {
  for (const li of $("note-content").querySelectorAll("li[data-checked]")) {
    li.setAttribute("role", "checkbox");
    li.setAttribute("aria-checked", li.dataset.checked);
    li.tabIndex = 0;
  }
}
function changed() {
  if (!note) return;
  recordHistory();
  decorateChecklists();
  readEditor();
  counts();
  callbacks.edit(note);
}
function rememberSelection() {
  const s = window.getSelection();
  if (s.rangeCount && $("note-content").contains(s.anchorNode))
    selection = s.getRangeAt(0).cloneRange();
}
function command(cmd, value) {
  if (cmd === "undo" || cmd === "redo") {
    applyHistory(cmd);
    return;
  }
  $("note-content").focus();
  if (selection) {
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(selection);
  }
  document.execCommand(cmd, false, value);
  rememberSelection();
  changed();
}
export function renderEditorMeta() {
  if (!note || !callbacks) return;
  $("note-pin").classList.toggle("pin-on", note.pinned);
  $("note-pin").setAttribute("aria-pressed", String(note.pinned));
  $("note-favorite").classList.toggle("favorite-on", note.favorite);
  $("note-favorite").setAttribute("aria-pressed", String(note.favorite));
  $("editor-type").textContent = note.locked ? "LOCKED NOTE" : "YOUR NOTE";
  $("note-folder").innerHTML =
    '<option value="">No folder</option>' +
    callbacks
      .folders()
      .map((f) => `<option value="${escape(f.id)}">${escape(f.name)}</option>`)
      .join("");
  $("note-folder").value = note.folder_id || "";
  $("note-tags").innerHTML = (note.tags || [])
    .map((t) => `<span class="tag">${escape(t.name)}</span>`)
    .join("");
  $("note-media").innerHTML = (note.attachments || [])
    .map(
      (a) =>
        `<div class="media-item">${a.kind === "image" ? `<img alt="${escape(a.name)}" src="${escape(callbacks.mediaURL(a, note))}">` : `<audio controls preload="none" src="${escape(callbacks.mediaURL(a, note))}"></audio>`}<p>${escape(a.name)}${a.pending ? " · waiting to sync" : ""}</p><button class="icon-button small" data-remove-media="${escape(a.id)}" aria-label="Remove attachment">${icon("close")}</button></div>`,
    )
    .join("");
  $("editor-reminder").hidden = !note.reminder;
  if (note.reminder)
    $("editor-reminder").innerHTML =
      `<span>Reminder · ${escape(new Date(note.reminder.due_at).toLocaleString())}</span><button class="text-button" id="remove-reminder">Remove</button>`;
}
export function initEditor(ctx) {
  callbacks = ctx;
  for (const id of ["note-title", "note-content"]) {
    $(id).addEventListener("keydown", historyKey);
    $(id).addEventListener("beforeinput", (event) => {
      if (["historyUndo", "historyRedo"].includes(event.inputType)) {
        event.preventDefault();
        applyHistory(event.inputType === "historyUndo" ? "undo" : "redo");
      }
    });
  }
  $("note-title").addEventListener("input", changed);
  $("note-content").addEventListener("input", changed);
  $("note-content").addEventListener("keyup", rememberSelection);
  $("note-content").addEventListener("mouseup", rememberSelection);
  document.addEventListener("selectionchange", rememberSelection);
  $("note-content").addEventListener("keydown", (event) => {
    const li = event.target.closest("li[data-checked]");
    if (li && event.target === li && event.key === " ") {
      event.preventDefault();
      const replacement = li.cloneNode(true);
      replacement.dataset.checked =
        li.dataset.checked === "true" ? "false" : "true";
      const range = document.createRange();
      range.selectNode(li);
      selection = range;
      command("insertHTML", replacement.outerHTML);
    }
  });
  $("note-content").addEventListener("paste", (event) => {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    command(
      "insertHTML",
      html
        ? cleanHTML(html)
        : escape(event.clipboardData.getData("text/plain")).replace(
            /\n/g,
            "<br>",
          ),
    );
  });
  $("note-content").addEventListener("click", (event) => {
    const li = event.target.closest("li[data-checked]");
    if (!li) return;
    const box = li.getBoundingClientRect();
    if (event.clientX > box.left + 4) return;
    event.preventDefault();
    const replacement = li.cloneNode(true);
    replacement.dataset.checked =
      li.dataset.checked === "true" ? "false" : "true";
    const range = document.createRange();
    range.selectNode(li);
    selection = range;
    command("insertHTML", replacement.outerHTML);
  });
  $("format-toolbar").addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  $("format-toolbar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-command]");
    if (button) command(button.dataset.command);
  });
  $("heading").onchange = (event) => command("formatBlock", event.target.value);
  $("font").onchange = (event) => command("fontName", event.target.value);
  $("font-size").onchange = (event) => command("fontSize", event.target.value);
  $("text-color").oninput = (event) => command("foreColor", event.target.value);
  $("highlight-color").oninput = (event) =>
    command("hiliteColor", event.target.value);
  $("note-folder").onchange = (event) => {
    note.folder_id = event.target.value || null;
    callbacks.edit(note);
  };
  $("note-media").onclick = (event) => {
    const b = event.target.closest("[data-remove-media]");
    if (b) callbacks.removeMedia(b.dataset.removeMedia);
  };
  $("editor-reminder").onclick = (event) => {
    if (event.target.closest("#remove-reminder")) {
      note.reminder = null;
      callbacks.edit(note);
      renderEditorMeta();
    }
  };
  $("editor-close").onclick = ctx.close;
  $("editor-done").onclick = ctx.close;
  $("editor-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    ctx.close();
  });
  $("focus-editor").onclick = () =>
    $("editor-dialog").classList.toggle("focused");
  $("note-pin").onclick = () => {
    note.pinned = !note.pinned;
    ctx.edit(note);
    renderEditorMeta();
  };
  $("note-favorite").onclick = () => {
    note.favorite = !note.favorite;
    ctx.edit(note, { touchTimestamp: false });
    renderEditorMeta();
  };
  $("note-remind").onclick = ctx.remind;
  $("note-more").onclick = () => ctx.menu(note);
  $("tag-note").onclick = ctx.tags;
  $("conflict-copy").onclick = ctx.conflictCopy;
  $("conflict-server").onclick = ctx.conflictServer;
}
export function highlight(query) {
  if (!CSS.highlights || !window.Highlight) return;
  CSS.highlights.delete("search-match");
  const terms = Array.isArray(query)
    ? query
    : query.match(/[\p{L}\p{N}]+/gu) || [];
  const ranges = [];
  const walker = document.createTreeWalker(
    $("note-content"),
    NodeFilter.SHOW_TEXT,
  );
  let node;
  while ((node = walker.nextNode()))
    for (const [start, end] of matchRanges(node.textContent, terms)) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      ranges.push(range);
    }
  CSS.highlights.set("search-match", new Highlight(...ranges));
}
