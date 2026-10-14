import { designLogo, setDesign } from "./design.js?v=2";
import { refreshMasonry } from "./masonry.js";
import { formattedPreview } from "./note-preview.js";
import {
  initButtonFeedback,
  buttonSoundsEnabled,
  setButtonSounds,
} from "./ui-feedback.js";
import { icon, escape, cleanHTML, highlightedText } from "./icons.js";
import {
  api,
  setCSRF,
  setAccount,
  APIError,
  downloadAPI,
  download,
} from "./api.js";
import {
  profile,
  saveProfile,
  unlockVault,
  persist,
  lockVault,
  blobToBase64,
  base64ToBlob,
  VaultError,
  rekeyVault,
  freshVault,
  recoverArchivedVault,
} from "./offline.js";
import {
  initEditor,
  setEditorNote,
  getEditorNote,
  updateEditor,
  clearEditor,
  readEditor,
  status,
  renderEditorMeta,
  highlight,
} from "./editor.js?v=34";
const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  notes: new Map(),
  pending: {},
  lockedDrafts: {},
  media: {},
  folders: [],
  tags: [],
  searches: [],
  sequence: 0,
  online: navigator.onLine,
  locked: true,
  view: "all",
  folder: null,
  tag: null,
  query: "",
  results: null,
  filters: {},
  mode: localStorage.getItem("mindkeep-view") || "grid",
  sort: "updated",
  syncing: false,
  authMode: "login",
  resetRequest: "",
  resetEmail: "",
  resetToken: "",
  idleMinutes: 15,
  lastActivity: Date.now(),
  searchSerial: 0,
  selecting: false,
  selectedNotes: new Set(),
};
let timer,
  toastTimer,
  activityTimer = 0,
  creating = false,
  locking = false;
const nav = [
  ["all", "notes", "All Notes"],
  ["reminders", "bell", "Reminders"],
  ["favorites", "star", "Favorites"],
  ["recent", "clock", "Recent"],
  ["archive", "archive", "Archive"],
  ["trash", "trash", "Trash"],
];
const onlineOnly = () => {
  if (!state.online)
    throw new Error(
      "This action needs a connection. Your draft is safe on this device.",
    );
};
const notify = (message) => {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5500);
};
const handle =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      notify(error.message);
      if (error.status === 423 && error.message === "MindKeep is locked")
        await lockApp(false);
      if (error.status === 401 && !state.locked) {
        await lockApp(false);
        authScreen("login");
      }
    }
  };
const newID = () => crypto.randomUUID();
const blank = () => ({
  id: newID(),
  title: "",
  content: "",
  plain_text: "",
  folder_id: null,
  tags: [],
  attachments: [],
  reminder: null,
  pinned: false,
  favorite: false,
  archived: false,
  deleted: false,
  locked: false,
  protected: false,
  color: "white",
  created_at: Date.now(),
  updated_at: Date.now(),
  revision: 0,
  opened_at: Date.now(),
});
function snapshot() {
  return {
    notes: [...state.notes.values()].filter((n) => !n.locked),
    pending: Object.fromEntries(
      Object.entries(state.pending).filter(([, p]) => !p.note.locked),
    ),
    lockedDrafts: {
      ...state.lockedDrafts,
      ...Object.fromEntries(
        Object.entries(state.pending).filter(([, p]) => p.note.locked),
      ),
    },
    media: Object.fromEntries(
      Object.entries(state.media).filter(
        ([, m]) => !state.notes.get(m.note_id)?.locked,
      ),
    ),
    folders: state.folders,
    tags: state.tags,
    searches: state.searches,
    sequence: state.sequence,
  };
}
async function stash() {
  if (!state.user || state.locked) return;
  try {
    await persist(state.user, snapshot());
  } catch (error) {
    status("Unable to save");
    notify(
      "Local storage failed. Keep this tab open until your changes reach the server.",
    );
    throw error;
  }
}
function hydrate(data) {
  if (!data) return;
  state.notes = new Map((data.notes || []).map((n) => [n.id, n]));
  state.pending = data.pending || {};
  state.lockedDrafts = data.lockedDrafts || {};
  state.media = data.media || {};
  state.folders = data.folders || [];
  state.tags = data.tags || [];
  state.searches = data.searches || [];
  state.sequence = data.sequence || 0;
}
function connection(value) {
  state.online = value;
  document.body.classList.toggle("offline", !value);
  $("offline-banner").hidden = value;
  $("connection-label").textContent = value
    ? "Connected"
    : "Saved on this device";
}
function updateThemeSelection() {
  const mode = localStorage.getItem("mindkeep-theme") || "light";
  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.theme === mode));
  });
}
function setTheme(mode) {
  document.documentElement.classList.toggle("theme-dark", mode === "dark");
  document.body.classList.toggle("theme-dark", mode === "dark");
  localStorage.setItem("mindkeep-theme", mode);
  document.documentElement.style.removeProperty("--accent");
  updateThemeSelection();
  setDesign();
}
setTheme(localStorage.getItem("mindkeep-theme") || "light");
function renderViewControl() {
  const control = $("view-mode");
  if (!control) return;
  const labels = { grid: "Grid view", list: "List view", compact: "Compact view" };
  control.innerHTML = `${icon(state.mode)}<svg class="view-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>`;
  control.setAttribute("aria-label", `Change layout: ${labels[state.mode]}`);
  control.title = `Change layout: ${labels[state.mode]}`;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const selected = button.dataset.view === state.mode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
}
function setupViewMenu() {
  const control = $("view-mode");
  const menu = $("view-popup");
  menu.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "open") return;
    const rect = control.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - 176, innerWidth - 184))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - 152))}px`;
  });
  menu.addEventListener("toggle", () => {
    const open = menu.matches(":popover-open");
    control.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector('[aria-checked="true"]').focus();
  });
  const openMenu = () => {
    if (!menu.matches(":popover-open")) menu.showPopover();
    menu.querySelector('[aria-checked="true"]').focus();
  };
  control.onkeydown = (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      openMenu();
    }
  };
  menu.onkeydown = (event) => {
    const buttons = [...menu.querySelectorAll("[data-view]")];
    const index = buttons.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
    if (["Escape", "Tab"].includes(event.key)) {
      menu.hidePopover();
      control.focus();
      if (event.key === "Escape") event.preventDefault();
    }
  };
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => {
      state.mode = button.dataset.view;
      localStorage.setItem("mindkeep-view", state.mode);
      menu.hidePopover();
      render();
      control.focus();
    };
  });
  renderViewControl();
}
function setupIcons() {
  const pairs = {
    "sidebar-toggle": "menu",
    "search-icon": "search",
    "filter-toggle": "filter",
    settings: "settings",
    "add-folder": "plus",
    "add-tag": "plus",
    "focus-editor": "focus",
    "editor-close": "close",
    "note-pin": "pin",
    "note-favorite": "star",
    "note-remind": "bell",
    "note-more": "more",
    "utility-close": "close",
  };
  for (const [id, name] of Object.entries(pairs)) $(id).innerHTML = icon(name);
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.insertAdjacentHTML("afterbegin", icon(b.dataset.view)));
}
function dialog(title, html) {
  $("utility-body").onclick = null;
  $("utility-title").textContent = title;
  $("utility-body").innerHTML = html;
  if (!$("utility-dialog").open) $("utility-dialog").showModal();
}
function closeUtility() {
  $("utility-dialog").close();
  $("utility-body").innerHTML = "";
  $("utility-body").onclick = null;
}
function inputDialog(title, label, action, type = "text", value = "") {
  dialog(
    title,
    `<form id="utility-form"><label>${escape(label)}<input id="utility-input" type="${type}" value="${escape(value)}" required ${type === "text" ? 'maxlength="80"' : ""}></label><p id="utility-error" class="form-error" role="alert"></p><div class="dialog-buttons"><button class="primary" type="submit">Continue</button></div></form>`,
  );
  $("utility-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector("button");
    button.disabled = true;
    try {
      await action($("utility-input").value);
      closeUtility();
    } catch (error) {
      $("utility-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  setTimeout(() => $("utility-input").focus(), 50);
}
function confirmDialog(title, message, action, label = "Confirm") {
  dialog(
    title,
    `<p>${escape(message)}</p><div class="dialog-buttons"><button id="cancel-action" class="secondary">Cancel</button><button id="confirm-action" class="primary">${escape(label)}</button></div>`,
  );
  $("cancel-action").onclick = closeUtility;
  $("confirm-action").onclick = handle(async () => {
    const closeAfterAction = await action();
    if (closeAfterAction !== false) closeUtility();
  });
}
function authScreen(mode) {
  state.authMode = mode;
  if (["login", "register", "forgot"].includes(mode)) {
    state.resetRequest = "";
    state.resetToken = "";
    state.resetEmail = "";
  }
  $("application").hidden = true;
  $("auth-screen").hidden = false;
  $("auth-error").textContent = "";
  $("auth-form").reset();
  const lock = mode === "unlock";
  $("name-label").hidden = mode !== "register";
  $("email-label").hidden = lock || ["reset", "verify"].includes(mode);
  $("password-label").hidden = ["forgot", "verify"].includes(mode);
  $("auth-email").required = !lock && !["reset", "verify"].includes(mode);
  $("auth-password").required = !["forgot", "verify"].includes(mode);
  $("code-label").hidden = mode !== "verify";
  $("auth-code").required = mode === "verify";
  $("resend-code").hidden = mode !== "verify";
  $("auth-name").required = mode === "register";
  $("auth-password").autocomplete =
    mode === "register" || mode === "reset"
      ? "new-password"
      : "current-password";
  $("auth-heading").textContent = {
    login: "Welcome to Mindkeep",
    register: "Make a little room",
    unlock: "Welcome to Mindkeep",
    forgot: "Forgot your password?",
    verify: "Check your email",
    reset: "A fresh start",
  }[mode];
  $("auth-description").textContent = {
    login: "Your ideas deserve a place to stay.",
    register: "Create your own space. It only takes a moment.",
    unlock:
      "Enter your password to unlock " +
      (state.user?.email || profile()?.email || "your private space") +
      ".",
    forgot: "We’ll email you a six-digit verification code.",
    verify: "Enter the code sent to your email. It expires in 10 minutes.",
    reset: "Choose a new password for your account.",
  }[mode];
  $("auth-submit").textContent = {
    login: "Sign in",
    register: "Create account",
    unlock: "Unlock MindKeep",
    forgot: "Send verification code",
    verify: "Verify code",
    reset: "Set new password",
  }[mode];
  $("auth-switch").hidden = mode === "reset";
  $("auth-switch").textContent =
    mode === "login"
      ? "New here? Create an account"
      : mode === "register"
        ? "Already have an account? Sign in"
        : "Back to sign in";
  $("forgot").hidden = !["login", "unlock"].includes(mode);
}
async function enterApp(user, password, local) {
  state.user = user;
  setAccount(user.id);
  const data = local === undefined ? await unlockVault(password, user) : local;
  state.locked = false;
  hydrate(data);
  saveProfile(user);
  localStorage.removeItem("mindkeep-locked");
  state.lastActivity = Date.now();
  $("account").textContent = (user.name || "M").slice(0, 1).toUpperCase();
  $("auth-screen").hidden = true;
  $("application").hidden = false;
  connection(state.online);
  render();
  if (state.online) {
    await refreshLibrary();
    await synchronize();
  }
  await stash();
}
async function submitAuth(event) {
  event.preventDefault();
  const submit = $("auth-submit");
  submit.disabled = true;
  $("auth-error").textContent = "";
  const password = $("auth-password").value;
  try {
    if (state.authMode === "forgot") {
      onlineOnly();
      const email = $("auth-email").value;
      const data = await api("/auth/reset-request", "POST", {
        email,
        format: "code",
      });
      state.resetEmail = email;
      state.resetRequest = data.request_id;
      authScreen("verify");
      $("auth-error").textContent = data.message;
      return;
    }
    if (state.authMode === "verify") {
      onlineOnly();
      const data = await api("/auth/reset-verify", "POST", {
        request_id: state.resetRequest,
        code: $("auth-code").value.trim(),
      });
      state.resetToken = data.token;
      authScreen("reset");
      return;
    }
    if (state.authMode === "reset") {
      onlineOnly();
      await api("/auth/reset", "POST", {
        token: state.resetToken || location.hash.slice(7),
        password,
      });
      history.replaceState(null, "", location.pathname);
      authScreen("login");
      notify("Password updated. Sign in with your new password.");
      return;
    }
    if (state.authMode === "unlock") {
      const user = state.user || profile();
      if (!user)
        throw new Error("Sign in to establish a local account session first.");
      if (state.online) await api("/auth/unlock", "POST", { password });
      const local = await unlockVault(password, user);
      await enterApp(user, password, local);
      return;
    }
    onlineOnly();
    const response = await api(
      "/auth/" + (state.authMode === "register" ? "register" : "login"),
      "POST",
      { email: $("auth-email").value, password, name: $("auth-name").value },
    );
    setCSRF(response.csrf);
    state.idleMinutes = response.idle_minutes;
    state.notes = new Map();
    state.pending = {};
    state.media = {};
    await enterApp(response.user, password);
  } catch (error) {
    $("auth-error").textContent = error.message;
    if (error instanceof VaultError && state.online)
      offerVaultRecovery(error.user, password);
    if (error.status === 0) connection(false);
  } finally {
    $("auth-password").value = "";
    submit.disabled = false;
  }
}
function offerVaultRecovery(user, password) {
  dialog(
    "Recover this device’s drafts",
    `<p>Your current account password was verified online. This device cache was encrypted with an earlier password.</p><form id="recover-form"><label>Previous password<input id="previous-password" type="password" autocomplete="off" required></label><p id="recover-error" class="form-error" role="alert"></p><div class="dialog-buttons"><button class="primary" type="submit">Recover drafts</button></div></form><p>If you cannot remember the previous password, you can start a fresh device cache. Server notes stay intact, and the old encrypted cache is archived on this device.</p><button class="text-button" id="fresh-vault">Start a fresh device cache</button>`,
  );
  $("recover-form").onsubmit = async (event) => {
    event.preventDefault();
    try {
      const local = await rekeyVault(
        $("previous-password").value,
        password,
        user,
      );
      closeUtility();
      await enterApp(user, password, local);
      notify("Encrypted drafts recovered with your new password.");
    } catch (error) {
      $("recover-error").textContent = error.message;
    }
  };
  $("fresh-vault").onclick = () =>
    confirmDialog(
      "Start a fresh device cache?",
      "Unsynced drafts in the old cache will not appear until recovered with the previous password. The encrypted archive and all server notes are preserved.",
      async () => {
        const local = await freshVault(password, user);
        await enterApp(user, password, local);
      },
      "Start fresh",
    );
}
async function refreshLibrary() {
  const [library, folders, tags, searches] = await Promise.all([
    api("/notes"),
    api("/folders"),
    api("/tags"),
    api("/searches"),
  ]);
  for (const n of library.notes) {
    const pending = state.pending[n.id];
    if (!pending) {
      state.notes.set(n.id, n);
      const current = getEditorNote();
      if (current?.id === n.id && n.protected) {
        clearEditor();
        notify("This note is locked. Verify your password to reopen it.");
      }
    }
  }
  const remote = new Set(library.notes.map((n) => n.id));
  for (const [id] of state.notes)
    if (!remote.has(id) && !state.pending[id]) state.notes.delete(id);
  state.folders = folders.folders;
  state.tags = tags.tags;
  state.searches = searches.searches;
  state.sequence = library.sequence;
  render();
  await stash();
  cacheMedia().catch(() => {});
}
function editNote(note, { touchTimestamp = true } = {}) {
  if (state.locked) return;
  if (note.locked && !state.online) {
    status("Unable to save");
    notify("Locked notes cannot be edited offline. Reconnect to continue.");
    return;
  }
  if (touchTimestamp) note.updated_at = Date.now();
  const version = (state.pending[note.id]?.version || 0) + 1;
  state.notes.set(note.id, note);
  state.pending[note.id] = {
    note: structuredClone(note),
    version,
    base: note.revision,
    conflict: note.conflict || null,
  };
  status("Saving");
  stash()
    .then(() => {
      if (!state.online) status("Saved on this device");
      else status("Waiting to sync");
    })
    .catch(() => {});
  clearTimeout(timer);
  timer = setTimeout(() => synchronize(), 650);
  render();
}
async function synchronize() {
  if (state.syncing || state.locked || !state.online) return;
  state.syncing = true;
  try {
    for (const [id, original] of Object.entries(state.pending)) {
      if (state.locked) break;
      let pending = state.pending[id];
      if (!pending || pending.conflict) continue;
      if (pending.note.locked && !navigator.onLine) continue;
      const version = pending.version;
      const outgoing = structuredClone(pending.note);
      delete outgoing.conflict;
      delete outgoing.protected;
      outgoing.tags = (outgoing.tags || []).map((t) => t.id);
      outgoing.revision = pending.base;
      if (getEditorNote()?.id === id) status("Saving");
      let saved;
      try {
        saved = await api(
          outgoing.revision ? "/notes/" + id : "/notes",
          outgoing.revision ? "PUT" : "POST",
          outgoing,
        );
      } catch (error) {
        if (error.status === 409 && error.data?.conflict) {
          pending.conflict = error.data.server;
          pending.note.conflict = error.data.server;
          state.notes.set(id, pending.note);
          if (getEditorNote()?.id === id) {
            updateEditor(pending.note);
            $("conflict-banner").hidden = false;
            status("Waiting to sync");
          }
          notify(
            "A concurrent edit was found. Open the note to keep both versions or choose the server version.",
          );
          await stash();
          continue;
        }
        throw error;
      }
      pending = state.pending[id];
      if (!pending) continue;
      const current = state.notes.get(id);
      const createNeedsUpdate =
        !outgoing.revision &&
        ([
          "title",
          "content",
          "folder_id",
          "pinned",
          "favorite",
          "archived",
          "deleted",
          "locked",
          "color",
        ].some((key) => (outgoing[key] ?? null) !== (saved[key] ?? null)) ||
          JSON.stringify((outgoing.tags || []).slice().sort()) !==
            JSON.stringify((saved.tags || []).map((t) => t.id).sort()) ||
          (outgoing.reminder?.due_at ?? null) !==
            (saved.reminder?.due_at ?? null));
      if (pending.version === version && !createNeedsUpdate) {
        delete state.pending[id];
        delete state.lockedDrafts[id];
        saved.attachments = [
          ...(saved.attachments || []),
          ...(current.attachments || []).filter((a) => a.pending),
        ];
        state.notes.set(id, saved);
        if (getEditorNote()?.id === id) updateEditor(saved);
      } else {
        pending.base = saved.revision;
        pending.note.revision = saved.revision;
        current.revision = saved.revision;
      }
      if (getEditorNote()?.id === id)
        status(state.pending[id] ? "Waiting to sync" : "Saved");
      await stash();
    }
    for (const [id, n] of state.notes) {
      for (const attachment of [...(n.attachments || [])].filter(
        (a) => a.pending,
      )) {
        if (state.pending[id] || n.conflict || !n.revision) continue;
        const data = state.media[attachment.id];
        if (!data) continue;
        const form = new FormData();
        form.append(
          "file",
          base64ToBlob(data.data, data.mime),
          attachment.name,
        );
        const saved = await api("/notes/" + id + "/attachments", "POST", form, {
          "X-Upload-ID": attachment.id,
        });
        const fresh = state.notes.get(id);
        const remaining = (fresh.attachments || []).filter(
          (a) => a.pending && a.id !== attachment.id,
        );
        saved.attachments.push(...remaining);
        state.notes.set(id, saved);
        const uploaded = saved.attachments.filter((a) => !a.pending).at(-1);
        if (uploaded) state.media[uploaded.id] = { ...data, note_id: id };
        delete state.media[attachment.id];
        if (getEditorNote()?.id === id) updateEditor(saved);
        await stash();
      }
    }
    render();
  } catch (error) {
    if (error.status === 0) {
      connection(false);
      status("Saved on this device");
    } else if (error.status === 423) {
      status("Waiting to sync");
      if (error.message === "MindKeep is locked") await lockApp(false);
      else
        notify(
          "A note needs password verification before it can sync. Open the note to unlock it.",
        );
    } else {
      status("Unable to save");
      notify(error.message);
    }
  } finally {
    state.syncing = false;
    if (
      Object.values(state.pending).some((p) => !p.conflict) &&
      state.online &&
      !state.locked
    ) {
      clearTimeout(timer);
      timer = setTimeout(synchronize, 4000);
    }
  }
}
async function reconnect() {
  try {
    const session = await api("/auth/session");
    if (state.user && session.user.id !== state.user.id)
      throw new APIError(
        "The account changed in another tab. Sign in again to protect your drafts.",
        401,
      );
    setCSRF(session.csrf);
    setAccount(session.user.id);
    connection(true);
    if (state.locked) {
      if (localStorage.getItem("mindkeep-locked"))
        await api("/auth/lock", "POST", {});
      return;
    }
    if (session.locked) {
      await lockApp(false);
      return;
    }
    await synchronize();
    await pullChanges();
  } catch (error) {
    if (error.status === 401 && !state.locked) {
      await lockApp(false);
      authScreen("login");
    } else if (error.status === 0) connection(false);
  }
}
async function pullChanges() {
  if (state.locked || !state.online || state.syncing) return;
  try {
    const result = await api("/sync?since=" + state.sequence);
    for (const change of result.changes) {
      if (state.pending[change.id]) continue;
      const local = state.notes.get(change.id);
      if (
        change.note &&
        local &&
        change.note.revision <= local.revision &&
        change.note.protected === local.protected
      )
        continue;
      if (change.note) {
        state.notes.set(change.id, change.note);
        const current = getEditorNote();
        if (current?.id === change.id) {
          if (change.note.protected) {
            clearEditor();
            notify("This note now requires verification.");
          } else {
            const focused =
              document.activeElement === $("note-title") ||
              $("note-content").contains(document.activeElement);
            if (!focused) setEditorNote(change.note, editorContext());
            else {
              state.notes.set(change.id, current);
              current.remote_revision = change.note.revision;
              notify(
                "This note changed on another device. Your next edit will preserve both versions.",
              );
            }
          }
        }
      } else {
        state.notes.delete(change.id);
        if (getEditorNote()?.id === change.id) clearEditor();
      }
    }
    state.sequence = result.sequence;
    const [folders, tags, searches] = await Promise.all([
      api("/folders"),
      api("/tags"),
      api("/searches"),
    ]);
    state.folders = folders.folders;
    state.tags = tags.tags;
    state.searches = searches.searches;
    render();
    await stash();
    await deliverReminders();
  } catch (error) {
    if (error.status === 0) connection(false);
    else if (error.status === 423 || error.status === 401) await lockApp(false);
  }
}
function filteredNotes() {
  let notes = state.results
    ? state.results.map((result) => ({
        ...result,
        ...(state.notes.get(result.id) || {}),
        snippet: result.snippet,
        score: result.score,
      }))
    : [...state.notes.values()];
  if (!state.results)
    notes = notes.filter((n) => {
      if (state.view === "trash") return n.deleted;
      if (n.deleted) return false;
      if (state.view === "archive") return n.archived;
      if (n.archived) return false;
      if (state.view === "favorites") return n.favorite;
      if (state.view === "reminders") return !!n.reminder;
      if (state.view === "recent") return !!n.opened_at;
      if (state.folder) return n.folder_id === state.folder;
      if (state.tag) return n.tags?.some((t) => t.id === state.tag);
      return true;
    });
  if (state.view === "recent" && !state.results)
    return notes.sort((a, b) => b.opened_at - a.opened_at).slice(0, 5);
  if (state.sort === "relevance" && state.results) return notes;
  return notes.sort((a, b) =>
    state.sort === "title"
      ? (a.title || "").localeCompare(b.title || "")
      : state.sort === "created"
        ? b.created_at - a.created_at
        : b.updated_at - a.updated_at || a.id.localeCompare(b.id),
  );
}
function terms() {
  return (state.query.match(/"([^"]+)"|[^\s]+/g) || [])
    .filter((t) => !t.includes(":"))
    .map((t) => t.replaceAll('"', ""))
    .filter((t) => t.length > 0);
}
function matched(text) {
  return highlightedText(
    String(text),
    state.query ? state.highlightTerms || terms() : [],
  );
}
const relative = (time) =>
  time
    ? new Date(time).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
async function cacheMedia() {
  if (state.locked || !state.online) return;
  let total = Object.values(state.media).reduce(
    (sum, m) => sum + (m.data?.length || 0),
    0,
  );
  for (const n of state.notes.values()) {
    if (n.locked || n.protected || n.deleted) continue;
    for (const a of n.attachments || []) {
      if (a.pending || state.media[a.id] || total > 40 * 1024 * 1024) continue;
      const response = await fetch("/api/attachments/" + a.id, {
        cache: "no-store",
      });
      if (!response.ok) continue;
      const bytes = await blobToBase64(await response.blob());
      if (state.locked) return;
      state.media[a.id] = { mime: a.mime, data: bytes, note_id: n.id };
      total += bytes.length;
    }
  }
  await stash();
}
function mediaURL(a, n) {
  const local = state.media[a.id];
  if (local) return `data:${local.mime};base64,${local.data}`;
  return "/api/attachments/" + a.id;
}
function card(n) {
  const tone = [...String(n.id)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 3;
  const image = n.attachments?.find((a) => a.kind === "image");
  const audio = n.attachments?.find((a) => a.kind === "audio");
  const doc = new DOMParser().parseFromString(n.content || "", "text/html");
  const checklist = [...doc.querySelectorAll("li[data-checked]")];
  const preview = n.snippet || n.plain_text || doc.body.textContent || "";
  const previewHTML = !state.results && !n.protected
    ? formattedPreview(doc.body) || matched(preview.slice(0, 270))
    : matched(preview.slice(0, 270));
  return `<article class="note-card ${state.selecting ? "selectable" : ""} ${state.selectedNotes?.has(n.id) ? "note-selected" : ""}" data-id="${escape(n.id)}" data-color="${escape(n.color || "white")}" data-tone="${tone}">${state.selecting ? `<label class="note-select-control"><input type="checkbox" data-select-note="${escape(n.id)}" ${state.selectedNotes?.has(n.id) ? "checked" : ""} ${n.protected || n.deleted ? "disabled" : ""} aria-label="Select ${escape(n.title || "Untitled note")}"><span>${n.protected ? "Unlock to select" : "Select"}</span></label>` : ""}${image ? `<img class="card-image" src="${escape(mediaURL(image, n))}" alt="${escape(image.name)}" loading="lazy">` : ""}<button class="card-open" data-open="${escape(n.id)}" aria-label="Open ${escape(n.title || "Untitled note")}"><div class="card-heading"><h2 class="card-title">${n.protected ? icon("lock") + " Locked note" : state.results && state.filters?.scope === "content" ? escape(n.title || "Untitled note") : matched(n.title || "Untitled note")}</h2>${n.pinned ? `<span class="card-pin">${icon("pin")}</span>` : ""}</div>${!checklist.length || state.results ? `<p class="card-text">${n.protected ? "Verify your password to open." : previewHTML}</p>` : ""}</button>${
    checklist.length && !state.results
      ? `<ul class="card-checklist">${checklist
          .slice(0, 5)
          .map(
            (li, i) =>
              `<li class="${li.dataset.checked === "true" ? "completed" : ""}"><input type="checkbox" ${li.dataset.checked === "true" ? "checked" : ""} data-check="${i}" data-note="${escape(n.id)}" aria-label="${escape(li.textContent)}"><span>${formattedPreview(li) || escape(li.textContent)}</span></li>`,
          )
          .join("")}</ul>`
      : ""
  }${audio ? `<audio class="audio-preview" controls preload="none" src="${escape(mediaURL(audio, n))}" aria-label="Audio note"></audio>` : ""}${
    n.tags?.length
      ? `<div class="tags">${n.tags
          .slice(0, 4)
          .map((t) => `<span class="tag">${escape(t.name)}</span>`)
          .join("")}</div>`
      : ""
  }<div class="card-footer"><span class="card-time">${escape(relative(n.updated_at || n.created_at))}${n.conflict ? "<small>Conflict · review both versions</small>" : ""}${n.deleted && n.trash_expires_at ? `<small>${Math.max(0, Math.ceil((n.trash_expires_at - Date.now()) / 86400000))} days left</small>` : ""}</span>${n.reminder ? `<div class="reminder-chip" title="${escape(new Date(n.reminder.due_at).toLocaleString())}">${icon("bell")}<span class="reminder-label">${escape(new Date(n.reminder.due_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</span></div>` : ""}<div class="card-actions"><button class="icon-button ${n.favorite ? "favorite-on" : ""}" data-favorite="${escape(n.id)}" aria-pressed="${Boolean(n.favorite)}" aria-label="${n.favorite ? "Remove from" : "Add to"} favorites">${icon("star")}</button><button class="icon-button" data-menu="${escape(n.id)}" aria-label="More actions for ${escape(n.title || "note")}">${icon("more")}</button></div></div></article>`;
}
function render() {
  if (state.locked) return;
  const menu = $("organization-popup");
  if (menu?.matches(":popover-open")) menu.hidePopover();
  $("note-composer").hidden =
    state.view !== "all" ||
    state.selecting ||
    !!state.query?.trim() ||
    !!state.results;
  const searching = !!state.query?.trim() || !!state.results;
  $("selection-toolbar").hidden = searching;
  if (searching) {
    state.selecting = false;
    state.selectedNotes?.clear();
  }
  const notes = filteredNotes();
  const selectable = notes.filter((n) => !n.deleted && !n.protected);
  const visible = new Set(selectable.map((n) => n.id));
  for (const id of state.selectedNotes || [])
    if (!visible.has(id)) state.selectedNotes.delete(id);
  $("select-notes").hidden = !!state.selecting;
  $("select-notes").disabled = !selectable.length;
  $("select-notes").setAttribute("aria-pressed", String(!!state.selecting));
  $("selection-actions").hidden = !state.selecting;
  $("selection-count").textContent =
    `${state.selectedNotes?.size || 0} selected`;
  $("delete-selected-notes").disabled = !state.selectedNotes?.size;
  $("select-all-notes").disabled = !selectable.length;
  const active = [...state.notes.values()].filter(
    (n) => !n.deleted && !n.archived,
  );
  $("main-nav").innerHTML = nav
    .map(
      ([view, name, label]) =>
        `<button class="nav-item ${state.view === view && !state.folder && !state.tag && !state.results ? "active" : ""}" data-nav="${view}">${icon(name)}<span class="nav-name">${label}</span>${view === "all" ? `<span class="nav-count">${active.length}</span>` : ""}</button>`,
    )
    .join("");
  for (const [type, items] of [
    ["folder", state.folders],
    ["tag", state.tags],
  ]) {
    $(type + "-nav").innerHTML = items
      .map(
        (item) =>
          `<div class="organization-row"><button class="nav-item ${state[type] === item.id ? "active" : ""}" data-${type}="${escape(item.id)}">${icon(type)}<span class="nav-name">${escape(item.name)}</span></button><button class="icon-button organization-menu" data-organization-menu="${type}s:${escape(item.id)}" aria-label="Actions for ${type} ${escape(item.name)}" aria-haspopup="menu" title="${type[0].toUpperCase() + type.slice(1)} actions">${icon("more")}</button></div>`,
      )
      .join("");
    $(type + "-hint").hidden = items.length > 0;
    const current = $("filter-" + type).value;
    $("filter-" + type).innerHTML =
      `<option value="">Any ${type}</option>` +
      items
        .map(
          (item) =>
            `<option value="${escape(item.name)}">${escape(item.name)}</option>`,
        )
        .join("");
    $("filter-" + type).value = current;
  }
  $("saved-search-count").textContent = `${state.searches.length}/5`;
  $("save-search").disabled = state.searches.length >= 5;
  $("save-search").title = state.searches.length >= 5
    ? "Five-search limit reached. Delete one in Settings → Manage saved searches."
    : "Save these options (up to five saved searches).";
  $("saved-filter-list").innerHTML = state.searches.length
    ? state.searches.map((saved) =>
        `<button type="button" class="secondary" data-saved-search="${escape(saved.id)}" aria-label="Run saved search ${escape(saved.name)}">${icon("search")}<span>${escape(saved.name)}</span></button>`).join("")
    : '<p class="saved-search-empty">No saved searches yet. Save a search above to reuse it here.</p>';
  let title = state.results
    ? "Search results"
    : state.folder
      ? state.folders.find((f) => f.id === state.folder)?.name
      : state.tag
        ? "# " + state.tags.find((t) => t.id === state.tag)?.name
        : nav.find((v) => v[0] === state.view)?.[2];
  $("view-title").textContent = title || "All notes";
  $("view-title").classList.toggle("search-results-title", !!state.results);
  $("view-description").textContent = state.results
    ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} found${state.view === "all" ? "" : ` in ${nav.find(([view]) => view === state.view)?.[2] || "this collection"}`}`
    : {
        all: "A little space for everything on your mind.",
        reminders: "The things you want to come back to.",
        favorites: "Keep your favorite thoughts close.",
        recent: "Your five most recently opened notes.",
        archive: "Out of the way. Still here when you need it.",
        trash: "Notes stay here for 30 days, then are permanently deleted.",
      }[state.view] || "Your notes, a little more organized.";
  $("sort").value = state.sort;
  renderViewControl();
  const pinned = notes.filter((n) => n.pinned),
    other = notes.filter((n) => !n.pinned);
  const group = (label, list, pin = false) =>
    list.length
      ? `<div class="collection-label">${pin ? icon("pin") : ""}${label} <span>· ${list.length}</span></div><div class="notes-grid ${state.mode}">${list.map(card).join("")}</div>`
      : "";
  if (!notes.length) {
    const isSearch = !!state.results;
    $("collection").innerHTML =
      `<section class="empty-state"><div class="empty-illustration">${icon(isSearch ? "search" : state.view === "trash" ? "trash" : "notes")}</div><h2>${isSearch ? "No notes found" : state.view === "all" && !state.folder && !state.tag ? "Make room for your first thought" : "Nothing here just yet"}</h2><p>${isSearch ? "Try a different word or adjust your filters." : "An idea, a list, a little reminder.<br>Start with whatever’s on your mind."}</p>${!isSearch && !state.query?.trim() && !state.selecting && state.view === "all" ? '<button class="primary" data-new="true">Create note</button>' : ""}</section>`;
  } else if (
    state.view === "all" &&
    !state.results &&
    !state.folder &&
    !state.tag
  )
    $("collection").innerHTML =
      group("PINNED", pinned, true) +
      group(pinned.length ? "OTHER NOTES" : "YOUR NOTES", other);
  else
    $("collection").innerHTML = group(
      state.results ? "MATCHES" : "YOUR NOTES",
      notes,
    );
  refreshMasonry();
  $("collection-footer").innerHTML = notes.length
    ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} · A little less to remember <span>✧</span>`
    : "";
}
function toggleNoteSelection(id) {
  const n = state.notes.get(id);
  if (!n || n.protected || n.deleted) return;
  if (state.selectedNotes.has(id)) state.selectedNotes.delete(id);
  else state.selectedNotes.add(id);
  render();
}
function deleteSelectedNotes() {
  const ids = [...state.selectedNotes];
  if (!ids.length) return;
  confirmDialog(
    `Delete ${ids.length} ${ids.length === 1 ? "note" : "notes"}?`,
    "The selected notes will move to Trash. You can restore them later.",
    async () => {
      const notes = ids.map((id) => state.notes.get(id)).filter(Boolean);
      if (
        notes.some(
          (n) => n.protected || n.conflict || (n.locked && !state.online),
        )
      )
        throw new Error(
          "Unlock or resolve the selected notes before deleting them.",
        );
      for (const n of notes) {
        n.deleted = true;
        n.deleted_at ||= Date.now();
        n.trash_expires_at = n.deleted_at + 30 * 86400000;
        editNote(n);
        if (getEditorNote()?.id === n.id) clearEditor();
      }
      if (state.results)
        state.results = state.results.filter((n) => !ids.includes(n.id));
      state.selecting = false;
      state.selectedNotes.clear();
      await stash();
      render();
      notify(
        `${notes.length} ${notes.length === 1 ? "note moved" : "notes moved"} to Trash.`,
      );
      if (state.online) await synchronize();
    },
    "Move to Trash",
  );
}
function navigate(view, folder = null, tag = null) {
  state.selecting = false;
  state.selectedNotes?.clear();
  state.view = view;
  if (state.sort === "relevance") state.sort = "updated";
  state.folder = folder;
  state.tag = tag;
  ++state.searchSerial;
  state.results = null;
  state.highlightTerms = [];
  highlight([]);
  state.query = "";
  $("search").value = "";
  $("search-error").hidden = true;
  document.body.classList.remove("drawer-open");
  $("drawer-shade").hidden = true;
  render();
}
function clearSearch() {
  ++state.searchSerial;
  state.query = "";
  state.results = null;
  state.filters = {};
  state.highlightTerms = [];
  if (state.sort === "relevance") state.sort = "updated";
  $("search").value = "";
  for (const key of ["folder", "tag", "exclude"])
    $("filter-" + key).value = "";
  $("filter-scope").value = "all";
  $("filters").hidden = true;
  $("filter-toggle").setAttribute("aria-expanded", "false");
  $("search-error").hidden = true;
  highlight([]);
  render();
}
function readSearchFilters() {
  return {
    folder: $("filter-folder").value,
    tag: $("filter-tag").value,
    scope: $("filter-scope").value,
    exclude: $("filter-exclude").value.trim(),
    category: ({ archive: "archived", trash: "trash", favorites: "favorites", recent: "recent", reminders: "reminders" })[state.view] || "active",
  };
}
function saveSearch() {
  onlineOnly();
  if (state.searches.length >= 5) {
    notify("You can save up to 5 searches. Delete one in Settings → Manage saved searches first.");
    return;
  }
  const query = $("search").value.trim();
  const filters = readSearchFilters();
  if (!query && !filters.folder && !filters.tag && !filters.exclude && filters.scope === "all") {
    notify("Enter a search or choose a filter before saving.");
    return;
  }
  inputDialog("Save search", "Search name", async (name) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Enter a name for this search.");
    if (state.searches.length >= 5)
      throw new Error("You can save up to 5 searches. Delete one in Settings first.");
    await api("/searches", "POST", { name: trimmed, query, filters });
    state.searches = (await api("/searches")).searches;
    render();
    await stash();
    notify("Search saved. Select it from Saved searches to reuse it.");
  });
}
async function openSavedSearch(saved) {
  if (!saved) return;
  state.view = ({ archived: "archive", trash: "trash", favorites: "favorites", recent: "recent", reminders: "reminders" })[saved.filters.category] || "all";
  state.folder = null;
  state.tag = null;
  $("search").value = saved.query;
  for (const key of ["folder", "tag", "scope", "exclude"])
    $("filter-" + key).value = saved.filters[key] || (key === "scope" ? "all" : "");
  $("filters").hidden = false;
  $("filter-toggle").setAttribute("aria-expanded", "true");
  await search();
}
async function search() {
  const query = $("search").value.trim();
  const filters = readSearchFilters();
  state.filters = filters;
  state.query = query;
  state.highlightTerms = [];
  highlight([]);
  $("search-error").hidden = true;
  const serial = ++state.searchSerial;
  if (
    !query &&
    !Object.entries(filters).some(
      ([k, v]) =>
        v &&
        !(k === "state" && v === "active") &&
        !(k === "scope" && v === "all") &&
        k !== "category",
    )
  ) {
    state.results = null;
    if (state.sort === "relevance") state.sort = "updated";
    render();
    return;
  }
  if (!state.online) {
    $("search-error").hidden = false;
    $("search-error").textContent =
      "Search requires the C++ server. Reconnect to search your library.";
    return;
  }
  try {
    const result = await api("/search", "POST", { query, filters });
    if (serial !== state.searchSerial) return;
    for (const note of result.results) {
      if (!state.pending[note.id]) {
        const { snippet, score, ...fullNote } = note;
        state.notes.set(note.id, fullNote);
      }
    }
    state.results = result.results;
    state.highlightTerms = result.highlight_terms;
    state.sort = "relevance";
    $("search-error").hidden = true;
    render();
  } catch (error) {
    if (serial !== state.searchSerial) return;
    $("search-error").hidden = false;
    $("search-error").textContent = error.message;
  }
}
function editorContext() {
  return {
    edit: editNote,
    close: handle(closeEditor),
    folders: () => state.folders,
    mediaURL,
    query: state.query ? state.highlightTerms || terms() : [],
    menu: noteMenu,
    remind: reminderDialog,
    tags: tagDialog,
    removeMedia: handle(removeMedia),
    conflictCopy: handle(conflictCopy),
    conflictServer: handle(conflictServer),
  };
}
async function createNote() {
  if (
    creating ||
    state.locked ||
    state.view !== "all" ||
    state.query?.trim() ||
    state.results
  )
    return;
  creating = true;
  try {
    if (getEditorNote()) {
      await closeEditor();
    }
    const n = blank();
    if (state.folder) n.folder_id = state.folder;
    state.notes.set(n.id, n);
    editNote(n);
    setEditorNote(n, editorContext());
  } finally {
    creating = false;
  }
}
async function openNote(id) {
  let n = state.notes.get(id);
  if (!n) return;
  if (getEditorNote()?.id === id) return;
  if (getEditorNote()) await closeEditor();
  if (n.protected || state.lockedDrafts[id]) {
    onlineOnly();
    inputDialog(
      "Unlock this note",
      "Your account password",
      async (password) => {
        const unlocked = await api("/notes/" + id + "/unlock", "POST", {
          password,
        });
        const recovered = state.lockedDrafts[id];
        if (recovered) {
          state.pending[id] = recovered;
          state.notes.set(id, recovered.note);
          delete state.lockedDrafts[id];
        } else state.notes.set(id, unlocked);
        await openNote(id);
      },
      "password",
    );
    return;
  }
  if (n.locked && !state.online)
    throw new Error("Locked notes require online verification.");
  if (state.online && !state.pending[id]) {
    n = await api("/notes/" + id);
    state.notes.set(id, n);
  } else {
    n.opened_at = Date.now();
    state.notes.set(id, n);
  }
  setEditorNote(n, editorContext());
  status(
    n.conflict
      ? "Waiting to sync"
      : state.pending[id]
        ? state.online
          ? "Waiting to sync"
          : "Saved on this device"
        : "Saved",
  );
  await stash();
  render();
}
async function closeEditor() {
  readEditor();
  await stash();
  clearEditor();
  render();
  if (state.online) await synchronize();
}
async function changeNote(n, fields) {
  if (n.protected) {
    await openNote(n.id);
    return;
  }
  if (n.locked && !state.online)
    throw new Error("Locked notes require a connection.");
  Object.assign(n, fields);
  if ("deleted" in fields) {
    n.deleted_at = fields.deleted ? n.deleted_at || Date.now() : null;
    n.trash_expires_at = fields.deleted ? n.deleted_at + 30 * 86400000 : null;
  }
  editNote(n, {
    touchTimestamp: !(Object.keys(fields).length === 1 && "favorite" in fields),
  });
  if (getEditorNote()?.id === n.id) updateEditor(n);
  await stash();
  if (state.online) await synchronize();
}
async function conflictCopy() {
  const n = getEditorNote();
  if (!n?.conflict) return;
  const server = n.conflict;
  const copy = structuredClone(n);
  copy.id = newID();
  copy.title = (copy.title || "Untitled") + " (my version)";
  copy.revision = 0;
  copy.conflict = null;
  copy.locked = false;
  copy.created_at = Date.now();
  copy.updated_at = Date.now();
  for (const a of copy.attachments || []) {
    if (!a.pending && state.online) {
      const response = await fetch("/api/attachments/" + a.id);
      if (response.ok) {
        const data = await blobToBase64(await response.blob());
        const newid = newID();
        state.media[newid] = { data, mime: a.mime, note_id: copy.id };
        a.id = newid;
        a.pending = true;
      }
    }
  }
  delete state.pending[n.id];
  state.notes.set(n.id, server);
  state.notes.set(copy.id, copy);
  editNote(copy);
  setEditorNote(copy, editorContext());
  await stash();
  await synchronize();
  notify("Your draft was preserved as a separate note.");
}
async function conflictServer() {
  const n = getEditorNote();
  if (!n?.conflict) return;
  confirmDialog(
    "Use the server version?",
    "Your unsynchronized draft will be replaced on this device. Choose “Keep mine as a copy” to preserve it instead.",
    async () => {
      const server = n.conflict;
      delete state.pending[n.id];
      state.notes.set(n.id, server);
      setEditorNote(server, editorContext());
      await stash();
      render();
    },
    "Use server version",
  );
}
function noteMenu(n) {
  dialog(
    "Note actions",
    `<div class="menu-list"><button data-action="pin">${icon("pin")}${n.pinned ? "Unpin" : "Pin"} note</button><button data-action="duplicate">${icon("copy")}Duplicate note</button><button data-action="archive">${icon(n.archived ? "restore" : "archive")}${n.archived ? "Restore from archive" : "Archive note"}</button>${n.locked ? `<button data-action="unlock">${icon("unlock")}Remove note lock</button>` : ""}<button data-action="share">${icon("share")}Read-only sharing</button><button data-action="export">${icon("download")}Export note</button><button data-action="delete" class="${n.deleted ? "" : "danger"}">${icon(n.deleted ? "restore" : "trash")}${n.deleted ? "Restore from Trash" : "Move to Trash"}</button>${n.deleted ? '<button data-action="permanent" class="danger">' + icon("trash") + "Delete permanently</button>" : ""}</div>${!n.protected ? `<fieldset class="note-background"><legend>Note background</legend><div class="note-background-options"><button type="button" class="note-background-choice" data-note-color="mint" aria-pressed="${n.color === "mint"}"><span class="note-background-swatch note-background-green" aria-hidden="true"></span>Green</button><button type="button" class="note-background-choice" data-note-color="peach" aria-pressed="${n.color === "peach"}"><span class="note-background-swatch note-background-peach" aria-hidden="true"></span>Peach</button><button type="button" class="note-background-choice" data-note-color="yellow" aria-pressed="${n.color === "yellow"}"><span class="note-background-swatch note-background-yellow" aria-hidden="true"></span>Yellow</button></div></fieldset>` : ""}`,
  );
  $("utility-body").onclick = handle(async (event) => {
    const color = event.target.closest("[data-note-color]")?.dataset.noteColor;
    if (color === "mint" || color === "peach" || color === "yellow") {
      closeUtility();
      if (getEditorNote()?.id === n.id) readEditor();
      await changeNote(n, { color });
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    $("utility-body").onclick = null;
    closeUtility();
    if (n.protected) {
      await openNote(n.id);
      return;
    }
    if (action === "pin") await changeNote(n, { pinned: !n.pinned });
    if (action === "archive") {
      await changeNote(n, { archived: !n.archived });
      if (getEditorNote()?.id === n.id) await closeEditor();
    }
    if (action === "delete") {
      await changeNote(n, { deleted: !n.deleted });
      if (getEditorNote()?.id === n.id) await closeEditor();
    }
    if (action === "duplicate") {
      onlineOnly();
      await synchronize();
      if (state.pending[n.id])
        throw new Error(
          "Resolve pending changes before duplicating this note.",
        );
      const copy = await api("/notes/" + n.id + "/duplicate", "POST", {});
      state.notes.set(copy.id, copy);
      await stash();
      render();
      await openNote(copy.id);
    }
    if (action === "unlock" && n.locked) {
      onlineOnly();
      if (state.pending[n.id]) await synchronize();
      if (state.pending[n.id])
        throw new Error("Save your draft before changing its lock.");
      await changeNote(n, { locked: false });
      await stash();
      notify("Note lock removed.");
    }
    if (action === "share") await sharingDialog(n);
    if (action === "export") exportDialog(n);
    if (action === "permanent") {
      onlineOnly();
      confirmDialog(
        "Delete this note permanently?",
        "This removes the note and its attachments from your library. It cannot be recovered.",
        async () => {
          await api("/notes/" + n.id, "DELETE");
          state.notes.delete(n.id);
          delete state.pending[n.id];
          if (getEditorNote()?.id === n.id) clearEditor();
          await stash();
          render();
        },
        "Delete permanently",
      );
    }
  });
}
function tagDialog() {
  const n = getEditorNote();
  if (!n) return;
  dialog(
    "Tags for this note",
    `<p>Give this thought a label. Tags are always optional.</p><div>${state.tags.length ? state.tags.map((t) => `<label><input type="checkbox" data-tagcheck="${escape(t.id)}" ${n.tags.some((a) => a.id === t.id) ? "checked" : ""}> ${escape(t.name)}</label>`).join("") : "<p>No tags yet. Add one from the sidebar.</p>"}</div><div class="dialog-buttons"><button class="primary" id="tags-done">Done</button></div>`,
  );
  $("tags-done").onclick = () => {
    n.tags = [...document.querySelectorAll("[data-tagcheck]:checked")].map(
      (c) => state.tags.find((t) => t.id === c.dataset.tagcheck),
    );
    editNote(n);
    renderEditorMeta();
    closeUtility();
  };
}
function reminderDialog() {
  const n = getEditorNote();
  if (!n) return;
  const d = n.reminder
    ? new Date(n.reminder.due_at)
    : new Date(Date.now() + 3600000);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  inputDialog(
    "Come back to this note",
    "Reminder date and time (your timezone)",
    async (value) => {
      const due = new Date(value).getTime();
      if (!Number.isFinite(due) || due <= Date.now())
        throw new Error("Choose a date and time in the future.");
      n.reminder = { due_at: due, delivered: false };
      editNote(n);
      renderEditorMeta();
      if ("Notification" in window && Notification.permission === "default")
        await Notification.requestPermission();
    },
    "datetime-local",
    local,
  );
}
async function sharingDialog(n) {
  onlineOnly();
  await synchronize();
  if (state.pending[n.id])
    throw new Error("Resolve pending changes before sharing.");
  const shares = await api("/notes/" + n.id + "/share");
  dialog(
    "Share a little thought",
    `<p>Anyone with the link can read this note and its media. They cannot edit it. ${n.locked ? "This explicitly permits reading this locked note without your password." : ""}</p><p>${shares.count} active ${shares.count === 1 ? "link" : "links"}.</p><div id="share-output"></div><div class="dialog-buttons"><button class="secondary danger" id="revoke-share">Revoke all links</button><button class="primary" id="make-share">Create read-only link</button></div>`,
  );
  $("make-share").onclick = handle(async () => {
    const result = await api("/notes/" + n.id + "/share", "POST", {
      authorize_locked: !!n.locked,
    });
    $("share-output").innerHTML =
      `<label>Read-only link<input id="share-url" readonly value="${escape(result.url)}"></label><button class="text-button" id="copy-share">Copy link</button>`;
    $("copy-share").onclick = handle(async () => {
      await navigator.clipboard.writeText(result.url);
      notify("Link copied.");
    });
  });
  $("revoke-share").onclick = handle(async () => {
    await api("/notes/" + n.id + "/share", "DELETE");
    notify("All links for this note were revoked.");
    closeUtility();
  });
}
function exportDialog(n) {
  onlineOnly();
  dialog(
    "Take your note with you",
    `<p>HTML and PDF preserve formatting and images. HTML also embeds audio. Text and Markdown identify attachment filenames; use a library backup for all original files.</p><div class="menu-list">${[
      ["txt", "Plain text"],
      ["md", "Markdown"],
      ["html", "HTML with media"],
      ["pdf", "PDF document"],
    ]
      .map(
        ([f, label]) =>
          `<button data-export="${f}">${icon("download")}${label}</button>`,
      )
      .join("")}</div>`,
  );
  $("utility-body").onclick = handle(async (event) => {
    const format = event.target.closest("[data-export]")?.dataset.export;
    if (!format) return;
    await synchronize();
    if (state.pending[n.id])
      throw new Error("Resolve unsynchronized changes before exporting.");
    notify("Preparing your " + format.toUpperCase() + " export…");
    const blob = await downloadAPI(
      "/notes/" + n.id + "/export?format=" + format,
    );
    download(blob, "mindkeep-note." + format);
    closeUtility();
  });
}
async function removeMedia(id) {
  const n = getEditorNote();
  const a = n.attachments.find((item) => item.id === id);
  if (!a) return;
  if (a.pending) {
    n.attachments = n.attachments.filter((item) => item.id !== id);
    delete state.media[id];
    editNote(n);
    renderEditorMeta();
    return;
  }
  onlineOnly();
  await synchronize();
  const saved = await api("/attachments/" + id, "DELETE");
  state.notes.set(n.id, saved);
  updateEditor(saved);
  await stash();
  render();
}
async function addOrganization(type) {
  onlineOnly();
  inputDialog("New " + type.slice(0, -1), "Name", async (name) => {
    await api("/" + type, "POST", { name });
    await refreshLibrary();
  });
}
function settingsDialog() {
  dialog(
    "Application settings",
    `<p>A calm space, the way you like it.</p><label>Appearance</label><div class="settings-row"><button class="secondary" data-theme="light">Light</button><button class="secondary" data-theme="dark">Dark</button></div><label class="sound-setting"><input id="button-sounds" type="checkbox" ${buttonSoundsEnabled() ? "checked" : ""}> Button click sounds</label><label>Lock after inactivity<select id="idle-setting">${[1, 5, 15, 30, 60, 120].map((n) => `<option value="${n}" ${n === state.idleMinutes ? "selected" : ""}>${n} minutes</option>`).join("")}</select></label><div class="menu-list"><button id="backup-library">${icon("download")}Back up your library</button><button id="restore-library">${icon("restore")}Restore a backup</button><button id="manage-organization">${icon("search")}Manage saved searches</button><button id="recover-device">${icon("restore")}Recover previous device drafts</button><button id="show-shortcuts">${icon("compact")}Keyboard shortcuts</button></div>`,
  );
  document
    .querySelectorAll("[data-theme]")
    .forEach((b) => (b.onclick = () => setTheme(b.dataset.theme)));
  updateThemeSelection();
  $("button-sounds").onchange = (event) =>
    setButtonSounds(event.target.checked);
  $("idle-setting").onchange = handle(async (event) => {
    onlineOnly();
    state.idleMinutes = Number(event.target.value);
    await api("/auth/activity", "POST", { idle_minutes: state.idleMinutes });
  });
  $("backup-library").onclick = handle(() => {
    onlineOnly();
    inputDialog(
      "Back up your entire library",
      "Verify your account password",
      async (password) => {
        await synchronize();
        if (Object.keys(state.pending).length)
          throw new Error("Resolve unsynchronized drafts before backing up.");
        const blob = await downloadAPI("/backup", "POST", { password });
        download(
          blob,
          "mindkeep-backup-" + new Date().toISOString().slice(0, 10) + ".json",
        );
      },
      "password",
    );
  });
  $("restore-library").onclick = handle(() => {
    onlineOnly();
    closeUtility();
    $("restore-file").click();
  });
  $("show-shortcuts").onclick = () =>
    dialog(
      "A few handy shortcuts",
      `<table class="shortcut-table"><tr><td>Create note</td><td><kbd>Ctrl / ⌘ Shift N</kbd></td></tr><tr><td>Search notes</td><td><kbd>Ctrl / ⌘ K</kbd></td></tr><tr><td>Focus writing</td><td><kbd>Ctrl / ⌘ Shift F</kbd></td></tr><tr><td>Bold / italic / underline</td><td><kbd>Ctrl / ⌘ B / I / U</kbd></td></tr><tr><td>Undo / redo</td><td><kbd>Ctrl / ⌘ Z / Shift Z</kbd></td></tr><tr><td>Close editor</td><td><kbd>Esc</kbd></td></tr></table><p>Spell-check comes from your browser. No shortcut deletes a note.</p>`,
    );
  $("manage-organization").onclick = organizationDialog;
  $("recover-device").onclick = () =>
    inputDialog(
      "Recover previous device drafts",
      "Password used by the old device cache",
      async (password) => {
        const recovered = await recoverArchivedVault(password, state.user);
        Object.assign(state.lockedDrafts, recovered.lockedDrafts || {});
        for (const item of Object.values(recovered.pending || {})) {
          const copy = structuredClone(item.note);
          copy.id = newID();
          copy.revision = 0;
          copy.title = (copy.title || "Untitled") + " (recovered draft)";
          copy.locked = false;
          copy.conflict = null;
          state.notes.set(copy.id, copy);
          for (const a of copy.attachments || []) {
            const media = recovered.media?.[a.id];
            if (media) {
              const id = newID();
              state.media[id] = { ...media, note_id: copy.id };
              a.id = id;
              a.pending = true;
            }
          }
          copy.attachments = (copy.attachments || []).filter((a) => a.pending);
          editNote(copy);
        }
        await stash();
        notify(
          "Ordinary drafts were imported as new notes. Protected drafts await verification when their original notes open. The archive remains intact.",
        );
      },
      "password",
    );
}
function removeOrganization(type, id) {
  onlineOnly();
  const item = state[type].find((item) => item.id === id);
  if (!item) return;
  const kind = type === "searches" ? "saved search" : type.slice(0, -1);
  confirmDialog(
    `Delete ${kind}?`,
    `Delete “${item.name}”? Your notes will be kept.`,
    async () => {
      if (type === "searches") {
        await api("/searches/" + id, "DELETE");
        state.searches = (await api("/searches")).searches;
        render();
        await stash();
        notify("Saved search deleted. Your notes are unchanged.");
        organizationDialog();
        return false;
      }
      readEditor();
      await synchronize();
      const affected = Object.values(state.pending).some(({ note }) =>
        type === "folders"
          ? note.folder_id === id
          : type === "tags" && (note.tags || []).some((tag) => tag.id === id),
      );
      if (affected)
        throw new Error(
          "Save or resolve the pending notes in this item before deleting it.",
        );
      await api("/" + type + "/" + id, "DELETE");
      if (type !== "searches") {
        const filter = $("filter-" + kind);
        if (filter.value === item.name) filter.value = "";
        if (state[kind] === id) navigate("all");
      }
      await refreshLibrary();
      const current = getEditorNote();
      if (current && !state.pending[current.id]) {
        const refreshed = state.notes.get(current.id);
        if (refreshed && !refreshed.protected) updateEditor(refreshed);
      }
      if (state.results) await search();
      notify(
        `${kind[0].toUpperCase() + kind.slice(1)} deleted. Your notes are safe.`,
      );
    },
    "Delete",
  );
}
function renameOrganization(type, id) {
  onlineOnly();
  const item = state[type].find((item) => item.id === id);
  if (!item) return;
  inputDialog(
    "Rename " + type.slice(0, -1),
    "Name",
    async (name) => {
      await api("/" + type + "/" + id, "PUT", { name });
      const filter = $("filter-" + type.slice(0, -1));
      const selected = filter.value === item.name;
      await refreshLibrary();
      if (selected) filter.value = name;
      if (state.results) await search();
    },
    "text",
    item.name,
  );
}
function organizationMenu(type, id, anchor) {
  const item = state[type].find((item) => item.id === id);
  if (!item || !anchor) return;
  const menu = $("organization-popup");
  if (menu.matches(":popover-open")) menu.hidePopover();
  menu.setAttribute("aria-label", `Actions for ${item.name}`);
  menu.innerHTML = `<button role="menuitem" data-organization-action="rename">${icon("notes")}Rename</button><button role="menuitem" data-organization-action="delete" class="danger">${icon("trash")}Delete</button>`;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.right - 126, innerWidth - 176))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 5, innerHeight - 100))}px`;
  menu.onclick = handle((event) => {
    const action = event.target.closest("[data-organization-action]")?.dataset
      .organizationAction;
    if (!action) return;
    menu.hidePopover();
    anchor.focus();
    if (action === "rename") renameOrganization(type, id);
    if (action === "delete") removeOrganization(type, id);
  });
  menu.onkeydown = (event) => {
    const buttons = [...menu.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next].focus();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      menu.hidePopover();
      anchor.focus();
    }
  };
  menu.showPopover();
  menu.querySelector("button").focus();
}
function organizationDialog() {
  dialog(
    "Manage saved searches",
    `<p>${state.searches.length}/5 saved searches. Deleting a saved search keeps all your notes.</p><div class="menu-list">${state.searches.map((item) => `<div class="settings-row"><span class="saved-search-name">${escape(item.name)}</span><button class="icon-button danger" data-remove-search="${escape(item.id)}" aria-label="Delete saved search ${escape(item.name)}">${icon("trash")}</button></div>`).join("") || "<p>No saved searches yet.</p>"}</div>`,
  );
  $("utility-body").onclick = handle((event) => {
    const id = event.target.closest("[data-remove-search]")?.dataset.removeSearch;
    if (id) removeOrganization("searches", id);
  });
}
async function restoreFile(file) {
  onlineOnly();
  if (file.size > 70 * 1024 * 1024) throw new Error("Backup exceeds 70 MiB.");
  const backup = JSON.parse(await file.text());
  confirmDialog(
    "Restore this library?",
    "The backup will be validated and imported as new notes. Your existing notes remain. Sharing links are not imported.",
    async () => {
      const result = await api("/restore", "POST", backup);
      await refreshLibrary();
      notify(
        `Restored ${result.restored_notes} notes and ${result.restored_attachments} attachments.`,
      );
    },
    "Restore backup",
  );
}
async function lockApp(remote = true) {
  if (locking || state.locked) return;
  locking = true;
  try {
    readEditor();
    await stash();
    if (remote && state.online) {
      try {
        await api("/auth/lock", "POST", {});
      } catch (error) {
        if (error.status !== 0 && error.status !== 401) throw error;
      }
    }
    localStorage.setItem("mindkeep-locked", "1");
    state.locked = true;
    await lockVault();
    clearEditor();
    closeUtility();
    if ($("view-popup").matches(":popover-open"))
      $("view-popup").hidePopover();
    if ($("organization-popup").matches(":popover-open"))
      $("organization-popup").hidePopover();
    state.notes.clear();
    state.selecting = false;
    state.selectedNotes.clear();
    state.pending = {};
    state.lockedDrafts = {};
    state.media = {};
    state.results = null;
    $("collection").innerHTML = "";
    authScreen("unlock");
  } finally {
    locking = false;
  }
}
async function accountDialog() {
  dialog(
    "Your private space",
    `<p><strong>${escape(state.user.name)}</strong><br>${escape(state.user.email)}</p><div class="menu-list"><button id="account-lock">${icon("lock")}Lock MindKeep</button><button id="account-settings">${icon("settings")}Settings</button><button id="sign-out">${icon("logout")}Sign out</button></div>`,
  );
  $("account-lock").onclick = handle(() => lockApp());
  $("account-settings").onclick = settingsDialog;
  $("sign-out").onclick = handle(async () => {
    onlineOnly();
    await stash();
    await api("/auth/logout", "POST", {});
    await lockApp(false);
    state.user = null;
    authScreen("login");
    notify("Signed out. Unsynced drafts remain encrypted on this device.");
  });
}
async function deliverReminders() {
  const events = await api("/reminders/events");
  for (const event of events.events) {
    notify("Reminder: " + event.title);
    if ("Notification" in window && Notification.permission === "granted")
      new Notification("MindKeep reminder", {
        body: event.title,
        icon: designLogo(),
        tag: "mindkeep-" + event.id,
      });
    await api("/reminders/events/" + event.id + "/ack", "POST", {});
  }
}
async function sharedPage() {
  const token = location.pathname.split("/")[2];
  $("auth-screen").hidden = true;
  try {
    const n = await api("/shared/" + token);
    const main = document.createElement("main");
    main.className = "shared-note";
    main.innerHTML = `<div class="brand"><img src="${designLogo()}" alt=""><span>MindKeep</span></div><div class="eyebrow">A SHARED THOUGHT · READ ONLY</div><h1>${escape(n.title || "Untitled note")}</h1><div class="shared-content">${cleanHTML(n.content)}</div><div class="note-media">${n.attachments.map((a) => (a.kind === "image" ? `<img style="max-width:100%" alt="${escape(a.name)}" src="/api/shared/${token}/attachments/${escape(a.id)}">` : `<div><p>${escape(a.name)}</p><audio controls src="/api/shared/${token}/attachments/${escape(a.id)}"></audio></div>`)).join("")}</div><p class="muted" style="font-size:11px">Shared with you through MindKeep.</p>`;
    document.body.append(main);
  } catch (error) {
    document.body.innerHTML =
      '<main class="shared-note"><h1>This link is unavailable</h1><p>It may have been revoked, or the note is no longer shared.</p><a href="/">Open MindKeep</a></main>';
  }
}
function wireEvents() {
  initButtonFeedback();
  setupIcons();
  initEditor(editorContext());
  $("auth-form").onsubmit = submitAuth;
  $("auth-switch").onclick = () =>
    authScreen(state.authMode === "login" ? "register" : "login");
  $("forgot").onclick = () => authScreen("forgot");
  $("resend-code").onclick = handle(async () => {
    const button = $("resend-code");
    button.disabled = true;
    try {
      onlineOnly();
      const data = await api("/auth/reset-request", "POST", {
        email: state.resetEmail,
        format: "code",
      });
      state.resetRequest = data.request_id;
      $("auth-code").value = "";
      $("auth-error").textContent = data.message;
    } finally {
      button.disabled = false;
    }
  });
  $("utility-close").onclick = closeUtility;
  $("sidebar-toggle").onclick = () => {
    if (innerWidth <= 850) {
      document.body.classList.toggle("drawer-open");
      $("drawer-shade").hidden =
        !document.body.classList.contains("drawer-open");
    } else document.body.classList.toggle("sidebar-hidden");
  };
  $("drawer-shade").onclick = () => {
    document.body.classList.remove("drawer-open");
    $("drawer-shade").hidden = true;
  };
  $("sidebar").onclick = handle(async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.organizationMenu) {
      const [type, id] = button.dataset.organizationMenu.split(":");
      organizationMenu(type, id, button);
      return;
    }
    if (button.dataset.nav) navigate(button.dataset.nav);
    if (button.dataset.folder) navigate("folder", button.dataset.folder);
    if (button.dataset.tag) navigate("tag", null, button.dataset.tag);
  });
  $("quick-create").onclick = handle(() => createNote());
  $("create-note").onclick = handle(() => createNote());
  $("add-folder").onclick = handle(() => addOrganization("folders"));
  $("add-tag").onclick = handle(() => addOrganization("tags"));
  $("settings").onclick = settingsDialog;
  $("account").onclick = handle(accountDialog);
  $("lock-app").onclick = handle(() => lockApp());
  $("sort").onchange = (event) => {
    state.sort = event.target.value;
    render();
  };
  setupViewMenu();
  $("search-form").onsubmit = (event) => {
    event.preventDefault();
    search();
  };
  let searchTimer;
  $("search").oninput = () => {
    clearTimeout(searchTimer);
    ++state.searchSerial;
    state.highlightTerms = [];
    highlight([]);
    if (!$("search").value.trim()) {
      clearSearch();
    } else {
      state.query = $("search").value.trim();
      render();
      searchTimer = setTimeout(search, 300);
    }
  };
  $("save-search").onclick = handle(saveSearch);
  $("saved-filter-list").onclick = handle(async (event) => {
    const button = event.target.closest("[data-saved-search]");
    if (button)
      await openSavedSearch(state.searches.find((s) => s.id === button.dataset.savedSearch));
  });
  $("filter-toggle").onclick = () => {
    $("filters").hidden = !$("filters").hidden;
    $("filter-toggle").setAttribute("aria-expanded", String(!$("filters").hidden));
  };
  document
    .querySelectorAll("#filters select,#filters input")
    .forEach((el) => (el.onchange = search));
  $("select-notes").onclick = () => {
    state.selecting = true;
    state.selectedNotes.clear();
    render();
  };
  $("cancel-selection").onclick = () => {
    state.selecting = false;
    state.selectedNotes.clear();
    render();
  };
  $("select-all-notes").onclick = () => {
    state.selectedNotes = new Set(
      filteredNotes()
        .filter((n) => !n.deleted && !n.protected)
        .map((n) => n.id),
    );
    render();
  };
  $("delete-selected-notes").onclick = handle(deleteSelectedNotes);
  $("collection").onclick = handle(async (event) => {
    if (state.selecting) {
      if (event.target.closest(".note-select-control")) return;
      const card = event.target.closest("[data-id]");
      if (card) toggleNoteSelection(card.dataset.id);
      return;
    }
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.open) await openNote(b.dataset.open);
    if (b.dataset.new) await createNote();
    if (b.dataset.favorite)
      await changeNote(state.notes.get(b.dataset.favorite), {
        favorite: !state.notes.get(b.dataset.favorite).favorite,
      });
    if (b.dataset.menu) noteMenu(state.notes.get(b.dataset.menu));
  });
  $("collection").onchange = handle(async (event) => {
    const selection = event.target.closest("[data-select-note]");
    if (selection) {
      toggleNoteSelection(selection.dataset.selectNote);
      return;
    }
    if (state.selecting) return;
    const checkbox = event.target.closest("[data-check]");
    if (!checkbox) return;
    const n = state.notes.get(checkbox.dataset.note);
    const doc = new DOMParser().parseFromString(n.content, "text/html");
    const li =
      doc.querySelectorAll("li[data-checked]")[Number(checkbox.dataset.check)];
    if (li) {
      li.dataset.checked = String(checkbox.checked);
      await changeNote(n, { content: doc.body.innerHTML });
    }
  });
  $("restore-file").onchange = handle(async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) await restoreFile(file);
  });
  window.addEventListener("offline", () => connection(false));
  window.addEventListener("online", handle(reconnect));
  document.addEventListener(
    "keydown",
    handle(async (event) => {
      if (state.locked) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (getEditorNote()) await closeEditor();
        $("search").focus();
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        await createNote();
      }
      if (
        modifier &&
        event.shiftKey &&
        event.key.toLowerCase() === "f" &&
        getEditorNote()
      ) {
        event.preventDefault();
        $("editor-dialog").classList.toggle("focused");
      }
    }),
  );
  for (const name of ["pointerdown", "keydown"])
    document.addEventListener(name, () => {
      if (state.locked) return;
      state.lastActivity = Date.now();
      if (state.online && Date.now() - activityTimer > 30000) {
        activityTimer = Date.now();
        api("/auth/activity", "POST", {}).catch((error) => {
          if (error.status === 423) lockApp(false);
        });
      }
    });
  window.addEventListener("beforeunload", (event) => {
    if (Object.keys(state.pending).length) {
      stash().catch(() => {});
      if (Object.values(state.pending).some((p) => p.note.locked)) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
  });
  setInterval(() => {
    if (!state.locked) {
      for (const n of state.notes.values()) {
        if (
          n.locked &&
          !n.protected &&
          n.unlock_expires_at &&
          n.unlock_expires_at < Date.now() &&
          !state.pending[n.id]
        ) {
          n.protected = true;
          n.title = "Locked note";
          n.content = "";
          n.plain_text = "";
          n.attachments = [];
          n.tags = [];
          n.reminder = null;
          if (getEditorNote()?.id === n.id) clearEditor();
          render();
        }
      }
    }
    if (
      !state.locked &&
      Date.now() - state.lastActivity > state.idleMinutes * 60000
    )
      handle(() => lockApp())();
  }, 5000);
  setInterval(pullChanges, 10000);
  setInterval(async () => {
    if (state.online || !navigator.onLine) return;
    try {
      await api("/health");
      await reconnect();
    } catch {}
  }, 10000);
  setInterval(() => {
    if (!state.locked && state.online) synchronize();
  }, 15000);
}
async function boot() {
  if (location.pathname.startsWith("/share/")) {
    await sharedPage();
    return;
  }
  wireEvents();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => notify("Offline caching is unavailable in this browser."));
  if (location.hash.startsWith("#reset=")) {
    authScreen("reset");
    return;
  }
  try {
    const session = await api("/auth/session");
    state.user = session.user;
    setAccount(session.user.id);
    state.idleMinutes = session.idle_minutes;
    setCSRF(session.csrf);
    if (!session.locked) await api("/auth/lock", "POST", {});
    authScreen("unlock");
  } catch (error) {
    if (error.status === 0) {
      connection(false);
      state.user = profile();
      authScreen(state.user ? "unlock" : "login");
    } else authScreen("login");
  }
}
boot().catch((error) => {
  notify(error.message);
  authScreen("login");
});
