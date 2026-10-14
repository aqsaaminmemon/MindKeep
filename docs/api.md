# API contract

All product endpoints run in C++. Private endpoints require the `mindkeep` HttpOnly session cookie. Every private JSON operation except session discovery also requires `X-Account-ID` equal to the session's user ID. This prevents a browser tab from merging a newly signed-in account into another account's local vault. Mutation requests additionally require `X-CSRF-Token`, returned by login/registration/session discovery. Direct image/audio requests use cookie ownership and per-note unlock checks because HTML media elements cannot set custom headers. Public sharing routes use their own unguessable token and no account library access.

Send JSON with `Content-Type: application/json`. Same-origin requests are required; configure `MINDKEEP_PUBLIC_URL` exactly, including host and port. Responses are JSON except attachment bytes, exports, and backup downloads. Errors use `{"error":"human-readable message"}`. A revision conflict uses HTTP 409 and `{"conflict":true,"server":{...}}`. No error response contains SQL, credentials, or private note data from another account.

## Accounts

| Method | Path | Body / behavior |
|---|---|---|
| POST | `/api/auth/register` | `{name,email,password}` → `{user,csrf,idle_minutes}` and cookie; password 10–256 bytes |
| POST | `/api/auth/login` | `{email,password}` → session/cookie |
| GET | `/api/auth/session` | Active identity, CSRF, lock state, inactivity setting; also available while locked |
| POST | `/api/auth/logout` | Invalidates the current session; available while locked |
| POST | `/api/auth/lock` | Locks the backend session and removes note-unlock grants |
| POST | `/api/auth/unlock` | `{password}` verifies the account password |
| POST | `/api/auth/activity` | User activity; optional `{idle_minutes:1..120}` |
| POST | `/api/auth/reset-request` | `{email}`; generic existence response, or 503 if delivery is unconfigured/failed |
| POST | `/api/auth/reset` | `{token,password}`; atomically consumes the token, rotates the password/offline salt, invalidates sessions |

Login, reset, unlock and backup password verification are rate-limited. Sessions expire after seven days. Inactivity is checked on every authorized operation; default is 15 minutes. GET requests do not count as user activity.

## Notes and organization

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/notes` | `{notes,sequence}`, including Archive and Trash; inaccessible locked notes are redacted |
| POST | `/api/notes` | Client-generated UUID `id`, optional title/content/folder/tags/states/reminder; idempotent stable ID |
| GET | `/api/notes/:id` | Opens an authorized note; records Recent separately from `updated_at` |
| PUT | `/api/notes/:id` | `revision` required, other fields optional; returns canonical sanitized note and next revision |
| DELETE | `/api/notes/:id` | Permanent deletion, permitted only in Trash; sync tombstone and attachment cleanup |
| POST | `/api/notes/:id/unlock` | `{password}`; verifies separately, grants access for 10 minutes |
| POST | `/api/notes/:id/duplicate` | Independent note and independent copies of attachments; no reminder/share/lock copied |
| GET/POST | `/api/folders`, `/api/tags` | List or create `{name}`; optional, single-level, user-owned |
| PUT/DELETE | `/api/folders/:id`, `/api/tags/:id` | Rename or remove. Removing keeps notes, advances affected revisions and updates the index |

Canonical content is sanitized rich HTML using an explicit allowlist. Image and audio attachments are separate metadata/files displayed in the note's media area. Tags in write requests are arrays of owned tag IDs. Folder IDs are nullable. Supported flags are `pinned`, `favorite`, `archived`, `deleted`, `locked`. Colors are `white`, `blue`, `violet`, `peach`, `mint`, `yellow`. Titles are capped at 500 UTF-8 bytes; note HTML at 1 MiB. Input is validated as UTF-8. All timestamps are UTC Unix milliseconds; the interface displays local time.

A reminder is `null` or `{due_at:<UTC milliseconds>}`. Setting/editing/removing resets old delivery events. Trash is soft deletion via `PUT {revision,deleted:true}`; recovery uses `deleted:false`. Archive works similarly. Pins and favorites are independent.

## Search and synchronization

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/search` | `{query,filters:{folder,tag,state,scope,before,after}}` → ranked `results`, normalized `highlight_terms`, date-field description |
| GET/POST | `/api/searches` | List or save `{name,query,filters}` |
| DELETE | `/api/searches/:id` | Remove saved search |
| GET | `/api/sync?since=:sequence` | Latest changes per note, including permanent-deletion `note:null` tombstones; next sequence |
| GET | `/api/reminders/events` | Undelivered in-app events, locked-note titles redacted |
| POST | `/api/reminders/events/:id/ack` | Acknowledges event; prevents subsequent in-app delivery |

State filters: `active`, `all` (active + archive), `archived`, `trash`, `favorites`, `pinned`, `locked`. Scope is `all`, `title`, or `content`. The optional `exclude` string contains whole words separated by spaces or commas; any note containing one of those normalized words in the chosen scope is excluded. Folder/tag filters take names; ownership is inherently scoped to the session's index. An optional `category` of `active`, `favorites`, `recent`, `reminders`, `archived`, or `trash` restricts the entire search to that tab, including when the query contains an inline state condition. Recent is limited to the five most recently opened active notes. Favorites and Reminders exclude archived and trashed notes. Dates apply to UTC modification dates. `after` is inclusive; `before` is exclusive. Invalid syntax is HTTP 400.

## Media and sharing

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/notes/:id/attachments` | Multipart `file`; optional stable `X-Upload-ID` UUID makes upload retries idempotent; 20 MiB cap; MIME + file-signature allowlist, owned note and unlock required |
| GET/DELETE | `/api/attachments/:id` | Authorized bytes/removal, with revision update on removal |
| GET/POST/DELETE | `/api/notes/:id/share` | Count links, create read-only link, revoke all links. Locked notes require `authorize_locked:true` |
| GET | `/api/shared/:token` | Selected note's title/content/media only; no user, folders, tags or library data |
| GET | `/api/shared/:token/attachments/:id` | Only an attachment owned by the selected shared note |

Supported images: PNG, JPEG, GIF, WebP. Supported audio containers: WebM, Ogg, WAV, MP4. Browser recording uses its supported MediaRecorder format. SVG and arbitrary HTML uploads are excluded. Upload validation checks container signatures; it is not an antivirus or full media-transcoding pipeline.

Sharing tokens are 256 random bits; only SHA-256 hashes are stored. Sharing is revoked on Trash, Archive, permanent deletion, explicit revocation, or a change in note lock state. Share pages are read-only. Owner verification for a locked note does not grant an unrelated visitor private API access; explicitly authorizing a link does authorize that note's public content/media.

## Export and backup

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/notes/:id/export?format=txt\|md\|html\|pdf` | Actual authorized downloadable format; PDF uses configured browser |
| POST | `/api/backup` | `{password}`; account verification authorizes entire library including locked notes; versioned JSON with base64 media |
| POST | `/api/restore` | Version-1 backup JSON; validates all records and media before an atomic import; remaps IDs and keeps existing notes |

Backup contains notes (including Trash/Archive/locks), folders, tags, reminders, saved searches and original attachment files. Passwords, sessions, reset tokens and reusable sharing tokens are excluded. Backup media cap is 40 MiB; restore HTTP payload cap 70 MiB, maximum 10,000 notes. A successful restore reports counts and warnings. Restored reminders are rescheduled; old notification-delivery history and Recent access history are not imported. Existing organization names are reused within the destination account. Export/backup files themselves are plaintext portable artifacts and should be stored privately.

Status codes: 400 validation/syntax, 401 authentication/account change, 403 CSRF/origin, 404 inaccessible/missing object, 409 conflict or duplicate account, 413 size, 423 session/note locked, 429 rate limit, 500 unexpected storage failure, 503 external delivery/PDF unavailable.

Saved searches are capped at five per account. A sixth creation returns HTTP 409; deleting one frees a slot. Restores that would exceed the cap are rejected before importing data. Existing saved searches are not removed automatically.
