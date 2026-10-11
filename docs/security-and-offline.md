# Privacy, local drafts and synchronization

## Server boundaries

Passwords use OpenSSL PBKDF2-HMAC-SHA256 with 600,000 iterations and a cryptographically random per-password salt. Verification uses a constant-time comparison. Session/reset/share tokens have 256 random bits; reusable bearer tokens are stored only as hashes. Sessions use HttpOnly, SameSite=Strict cookies, seven-day expiry and configurable backend inactivity enforcement. Enable Secure cookies and HTTPS before public use.

Every value in SQL statements is parameterized. Foreign keys prevent folders, tags and attachments crossing account ownership. All note, attachment, share, export and backup operations check identity and lock policy. Request origins and CSRF tokens protect mutations. `X-Account-ID` guards browser-local libraries against another tab changing the shared sign-in cookie. A cookie switch causes reauthentication and preserves the old account's encrypted drafts; it never transfers pending writes to the newly signed-in account.

Rich HTML uses a restrictive tag/style allowlist. No scripts, event handlers, external links, arbitrary embedded images, arbitrary CSS or external resource URLs are accepted. Media is served through authorized API routes with no-store/nosniff headers. Uploaded names never become file paths; storage keys are random. No raw media directory is publicly mounted. Signature/MIME validation does not constitute antivirus scanning or full decoding validation.

App locking revokes access **on the C++ backend**, removes note unlock grants, hides the browser library and discards its in-memory vault key. Server inactivity is evaluated even if the interface is bypassed. Note locks require separate online password verification; unlock grants last ten minutes. Titles, content, previews, tags, snippets, counts and media of inaccessible locked notes are omitted/redacted. An expired individual grant redacts the browser preview when no pending edit is being preserved. A pending protected draft still requires backend unlock before transmission. Session lock protects the entire library and attachments.

A verified account password authorizes a complete-library backup, including locked notes. This is an explicit owner action, not anonymous locked-note access. Sharing a locked note also requires explicit authorization; lock-state changes revoke existing links. Links expose only that one note and its authorized media. Locked-note reminder notifications show “Locked note”.

## Encrypted offline vault

The service worker caches application shell assets only. It never caches API responses, private media URLs or share pages. Offline writing needs a previously established account and cached shell, HTTPS/localhost, IndexedDB and Web Crypto.

IndexedDB stores AES-GCM ciphertext with a fresh 96-bit IV for every snapshot. The browser derives a non-extractable AES-256 key from the user's password using PBKDF2-SHA256 (600,000 iterations) and the account's offline salt. Passwords, session cookies, CSRF tokens and the key are not stored in localStorage or IndexedDB. localStorage holds only the last account identity/salt and appearance preferences. The ciphertext retains note drafts, queued operations, organization metadata and cached attachment bytes. The key exists only in memory and is discarded on lock/logout/reload.

Ordinary unlocked notes can be created and edited offline. Newly recorded audio/images are encrypted and queued for upload. Existing authorized unlocked attachments are cached into the encrypted vault up to a 40 MiB encoded-media budget. Media beyond that cache budget remains online-only. Folders/tags must exist already to assign them offline; creating/renaming/removing organization, advanced search, saved-search changes, note unlocking, sharing, exports, backup/restore and account mutations need a connection and explain this in the interface.

Locked notes are excluded from the ordinary offline library. A pending locked-note draft is stored in a separate encrypted recovery compartment, omitted from offline previews, and recovered only after successful **server-side note unlock**. Protected media is excluded from offline caching. Offline storage does not provide a normal UI route around individual-note verification.

This is local at-rest protection, **not end-to-end encryption**. The C++ server and its database have plaintext note access. An already-unlocked browser, its developer tools, a malicious same-origin script, browser extension or compromised OS is outside this lock model. Encryption protects the vault while locked, not an actively compromised browser. Locally entered password verification works offline by successful authenticated decryption; backend account revocation/password changes become authoritative again on reconnection.

Password reset rotates the offline salt and invalidates existing sessions. If an old cache cannot be opened after the new password is verified online, the interface offers recovery using the previous password, reencrypting the existing drafts under the new salt/key. Alternatively, an explicitly confirmed fresh cache preserves the old ciphertext as an on-device archive and reloads server-persisted notes. Settings can recover ordinary pending drafts from that archive as independent notes when the previous password is available. Old protected drafts remain subject to online note verification. Without the previous password, old unsynchronized ciphertext cannot be decrypted; it is never silently discarded.

## Autosave and conflicts

Changes enter the in-memory pending queue immediately and trigger a serialized encrypted IndexedDB write. Network saves use a 650 ms debounce. Closing the editor waits for local persistence; it does not depend on a Save/Done action for server persistence. Local-storage failures retain the in-memory draft and show a warning. Browser eviction/storage denial or an abrupt kill before a transaction commits can defeat browser-side persistence; no browser app can promise durability when its storage is unavailable.

Statuses mean:

- **Saving**: local/network save work is in progress.
- **Saved**: the C++ server acknowledged the corresponding revision.
- **Saved on this device**: committed local encrypted draft while disconnected.
- **Waiting to sync**: a local queued change/conflict awaits server persistence.
- **Unable to save**: local storage or a nonrecoverable request failed; the draft is retained where possible.

A newly created note gets one stable client UUID. Repeated requests do not create duplicates or replace an existing note's original content. Pending note edits include their base revision. Changes made while a request is in flight remain queued on the newly acknowledged base revision. Recoverable failures retry. A 409 preserves the server version and local draft. The UI offers “Keep mine as a copy” or an explicitly confirmed “Use server version”; it never silently overwrites the remote version. Attachment copying preserves independent file ownership.

The server change log carries a monotonically increasing sequence and permanent-deletion tombstones. The browser polls every ten seconds while unlocked and connected, skips remote replacement of pending drafts, and protects open-editor stale revisions. Synchronization also propagates soft deletion, restoration, attachments and reminder metadata. Remote organization lists refresh on library loads; a rename does not alter note content. Automatic retry probes restore the session/CSRF token after an offline reload, then resume uploads. Expired/changed accounts require sign-in first.

## Reminders and browser capabilities

A C++ scheduler checks due reminders every ten seconds, inserts an event with a unique note/time pair, and marks the schedule delivered in one transaction. The active browser receives pending events and acknowledges them. Editing/removing a reminder clears its old events. Archived/trashed notes do not deliver; restoring an overdue undelivered note makes it eligible again. Times are persisted as UTC milliseconds and edited/displayed in local time.

Browser notification permission is optional. Denial does not remove the reminder; the in-app view/events still work. No push service has been configured: **a closed browser cannot receive a background push notification**. The server persists due events for the next unlocked session. Permission prompts, microphone recording formats, audio playback and native spell-check depend on the user's browser/device. No transcription is implemented.

## Operational limits

Use one server instance, persistent MySQL/media storage and TLS for deployment. The isolated `/tmp` MySQL instance used for local verification is a development fixture, not a durable production deployment. Keep its data or use a configured persistent MySQL service. Automatic database reconnect during transactions is disabled to avoid falsely committing partial work; restart after a database connection outage. The schema migration is idempotent for the initial version; future schema changes need numbered migrations rather than edits to applied production tables.

Portable backups/exports contain readable note/media content and should be protected by their owner. Backups exclude authentication/share secrets. Per-request upload and backup limits are enforced, but there is no per-account storage quota, reverse-proxy rate limiting or antivirus service. SMTP delivery and production TLS are external configuration requirements. These are explicit deployment boundaries, not claims of a completed hosted service or security audit.
