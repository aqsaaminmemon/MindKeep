// Private content is persisted only as AES-GCM ciphertext. Keys stay in memory.
let key = null;
let writeChain = Promise.resolve();
const encoder = new TextEncoder();

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("mindkeep-private", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("vaults");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storage(operation, id, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        "vaults",
        operation === "get" ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore("vaults");
      const request =
        operation === "get"
          ? store.get(id)
          : operation === "put"
            ? store.put(value, id)
            : store.delete(id);
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const profile = () => {
  try {
    return JSON.parse(localStorage.getItem("mindkeep-profile"));
  } catch {
    return null;
  }
};
export const saveProfile = (user) =>
  localStorage.setItem("mindkeep-profile", JSON.stringify(user));

async function derive(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 600000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export class VaultError extends Error {
  constructor(user) {
    super(
      "This device cache uses an earlier password, or the password is incorrect. Your encrypted drafts have been preserved.",
    );
    this.user = user;
  }
}

async function decrypt(stored, candidate) {
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: stored.iv },
    candidate,
    stored.cipher,
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function unlockVault(password, user) {
  const candidate = await derive(password, user.offline_salt);
  const stored = await storage("get", user.id);
  let state = null;
  if (stored) {
    try {
      state = await decrypt(stored, candidate);
    } catch {
      throw new VaultError(user);
    }
  }
  key = candidate;
  return state;
}

export function persist(user, state) {
  if (!key) return Promise.reject(new Error("Local vault is locked"));
  const currentKey = key;
  const text = JSON.stringify(state);
  writeChain = writeChain
    .catch(() => {})
    .then(async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        currentKey,
        encoder.encode(text),
      );
      await storage("put", user.id, { iv, cipher, salt: user.offline_salt });
    });
  return writeChain;
}

// Recovery is offered only after online account-password verification succeeds.
export async function rekeyVault(oldPassword, newPassword, user) {
  const stored = await storage("get", user.id);
  const previousProfile = profile();
  const salt =
    stored?.salt ||
    (previousProfile?.id === user.id ? previousProfile.offline_salt : null);
  if (!stored || !salt)
    throw new Error(
      "The old cache salt is unavailable. Preserve its encrypted archive and start a fresh device cache.",
    );
  let state;
  try {
    state = await decrypt(stored, await derive(oldPassword, salt));
  } catch {
    throw new Error(
      "The previous password could not decrypt this cache. Nothing was changed.",
    );
  }
  key = await derive(newPassword, user.offline_salt);
  await persist(user, state);
  return state;
}

export async function freshVault(password, user) {
  const stored = await storage("get", user.id);
  if (stored)
    await storage("put", user.id + ":archive:" + Date.now(), {
      ...stored,
      salt:
        stored.salt ||
        (profile()?.id === user.id ? profile().offline_salt : null),
      archived: true,
    });
  key = await derive(password, user.offline_salt);
  const state = {
    notes: [],
    pending: {},
    lockedDrafts: {},
    media: {},
    folders: [],
    tags: [],
    searches: [],
    sequence: 0,
  };
  await persist(user, state);
  return state;
}

export async function recoverArchivedVault(oldPassword, user) {
  const db = await database();
  let archive;
  try {
    archive = await new Promise((resolve, reject) => {
      const request = db
        .transaction("vaults")
        .objectStore("vaults")
        .openCursor();
      const items = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor)
          return resolve(
            items.sort((a, b) => b.id.localeCompare(a.id))[0]?.value,
          );
        if (String(cursor.key).startsWith(user.id + ":archive:"))
          items.push({ id: String(cursor.key), value: cursor.value });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
  if (!archive?.salt)
    throw new Error("No recoverable encrypted device archive was found.");
  try {
    return await decrypt(archive, await derive(oldPassword, archive.salt));
  } catch {
    throw new Error(
      "The previous password could not decrypt the archive. Nothing was changed.",
    );
  }
}

export async function lockVault() {
  await writeChain.catch(() => {});
  key = null;
}
export async function forgetVault(user) {
  await lockVault();
  await storage("delete", user.id);
  localStorage.removeItem("mindkeep-profile");
}
export const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
export function base64ToBlob(data, mime) {
  return new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
    type: mime,
  });
}
