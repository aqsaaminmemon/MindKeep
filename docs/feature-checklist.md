# Original-number implementation checklist

The supplied numbered list contains **44 active items and postponed 27**, although its prose says 45 active. Every explicitly listed number is preserved here. “Implemented” means working local code, with the listed verification evidence; it does not claim configured production hosting, real SMTP delivery, all browsers, or a security audit.

| Original number | Selected feature | Status | Evidence / limit |
|---|---|---|---|
| 1 | Create notes | Implemented | Title/content composer and independent stable UUIDs; browser/API verified. |
| 2 | Edit notes | Implemented | Reopens canonical rich HTML; bold and Unicode browser round trip verified. |
| 3 | Autosave | Implemented | 650 ms debounce, encrypted immediate draft queue, server acknowledgement states; outage/reload verified. |
| 5 | Rich text formatting | Implemented | Browser editor bold, italic, underline and strikethrough; backend allowlist. |
| 6 | Headings | Implemented | Heading levels 1–3; preserved in HTML/PDF/Markdown. |
| 7 | Text colors and highlights | Implemented | Text color and highlight controls with sanitized styles. |
| 8 | Font controls | Implemented | Four font families and five practical sizes; availability follows browser/system fonts. |
| 9 | Bulleted and numbered lists | Implemented | Bulleted/numbered editor lists; Markdown numbered-list regression checked. |
| 10 | Checklists | Removed creation controls by request | Existing checklist content remains readable; composer/editor checklist creation controls removed. |
| 18 | Undo and redo | Implemented | Native editor undo/redo including formatting; no separate fake history. |
| 20 | Word and character counts | Implemented | Live body word/Unicode code-point counts; definition below. |
| 21 | Spell-check suggestions | Implemented | Browser-native contenteditable spell-check. |
| 22 | Distraction-free writing | Implemented | Expanded focus mode hides surrounding navigation. |
| 26 | Folders | Implemented | Optional owner-scoped single-level folders; move by updating folder_id. |
| 27 | Nested folders | Postponed | Postponed as required; no parent field or nested UI exists. |
| 28 | Tags | Implemented | Optional many-to-many tags; cross-owner FK and API checks. |
| 30 | Pinned notes | Implemented | Pinned cards render in a separate first group in All Notes. |
| 31 | Favorites | Implemented | Independent favorite state and dedicated Favorites view. |
| 32 | Archive | Implemented | Archive/restore and predictable search/sharing/reminder policy. |
| 33 | Trash and recovery | Implemented | Soft Trash/recovery; explicit permanent delete and media cleanup. |
| 34 | Duplicate notes | Implemented | Independent content and separately owned attachment copies; reminders/shares not copied. |
| 35 | Sorting | Implemented | Title, creation and modification sorting; relevance is default for search. |
| 36 | View modes | Implemented | Grid/list/compact controls and responsive card rendering. |
| 37 | Recent notes | Implemented | Separate Recent access metadata; opening preserves content modification time. |
| 46 | Title search using C++ data structures | Implemented | Separate title postings and normalized title-prefix trie. |
| 47 | Full-content search using a custom C++ search engine | Implemented | Custom C++ inverted index, frequencies/positions, normalization, deterministic ranking; correctness/benchmark suites. |
| 48 | Search filters | Implemented | Folder, tag, modification date, state and title-scope filters. Attachment-type filtering was optional and is omitted. |
| 49 | Highlight matching text | Implemented | Result highlighting and nonmutating opened-editor highlights; Unicode range mapping. |
| 50 | Saved searches | Implemented | Persisted queries and filter JSON; save/reuse/delete UI. |
| 51 | Advanced search syntax | Implemented | Quoted token phrases, tag/folder/before/after/state; syntax errors are explicit. |
| 56 | Note reminders | Implemented | MySQL schedule and C++ scheduler; unique event delivery/acknowledgement; API verified. Closed-browser push is not implemented. |
| 69 | Images | Removed from UI by request | Image capture/upload controls removed. Existing attachment data remains readable and included in backups/exports. |
| 73 | Audio notes | Removed from UI by request | Voice recording controls and microphone capture code removed. Existing attachments remain readable and included in backups/exports. |
| 79 | User accounts | Implemented | Registration/login/logout, password hashing, CSRF/account guard, private libraries; API/browser verified. |
| 80 | Password reset | Partial: delivery unconfigured | Token expiry, single use, password/session replacement and encrypted-vault recovery implemented and tested. Real SMTP delivery requires external configuration. |
| 82 | App lock | Implemented | Manual and configurable inactivity locks enforced by backend, vault-key disposal and hidden private UI. |
| 83 | Locked notes | Implemented | Additional online verification, ten-minute grants, redacted listing/search/media/exports; API verified. |
| 85 | Read-only sharing links | Implemented | Explicit single-note links with 256-bit tokens, authorized media, locked-note consent and revocation; API verified. |
| 91 | Themes | Implemented | Light/dark, custom accent with WCAG contrast fallback, note background color controls removed by request. |
| 92 | Responsive design | Implemented | Desktop, tablet drawer, 320px mobile and fullscreen wrapping editor; no horizontal overflow observed. |
| 93 | Keyboard shortcuts | Implemented | Documented capture/search/focus/format/undo shortcuts; no destructive keybindings. |
| 95 | Offline creation and editing | Implemented | Encrypted IndexedDB drafts/pending media, shell service worker, established-account offline verification; server outage and reload tested. Locked-note opening remains online-only. |
| 96 | Synchronization across devices | Implemented | Revision uploads, ten-second change polling, deletion tombstones, idempotent media retries, conflict choices; API clients and offline/reconnect verified. One server instance; physical two-device testing not run. |
| 98 | Export notes | Implemented | Actual txt/Markdown/HTML/PDF outputs; 17-page PDF/Unicode and image inclusion verified. Audio embedded in HTML; filenames in PDF/text/Markdown. |
| 99 | Backup and restore | Implemented | Versioned full-library JSON with base64 originals; validation before atomic import, owner/ID remapping, existing-note preservation and count report; API verified. |

## Count definition

Counts include the note body only, excluding title and attachment filenames. Words are contiguous Unicode letters/digits with combining marks. Punctuation and whitespace split words. Characters are Unicode code points, including spaces and internal line breaks, with the editor’s final artificial newline removed. They are not UTF-8 byte counts or a grapheme-cluster count.

## External blockers and remaining verification

- **80 / email delivery:** Real SMTP credentials/sender and mailbox-delivery verification are not available. The production reset endpoint explicitly reports unconfigured delivery rather than issuing console tokens. Token lifecycle and cache rekey/recovery are implemented.
- **73 / microphone:** Recording/playback source and real audio transport are implemented, but microphone hardware/permission prompts were not exercised.
- **Deployment:** This is a local app. Production HTTPS, persistent MySQL/media provisioning, and SMTP configuration remain external setup. The `/tmp` database is an isolated development fixture; keep its directory and use a normal persistent MySQL instance for durable personal use.
- **Browser/device coverage:** Browser UI and 320px layout were checked in the available in-app browser. Physical tablet/phone/multiple-device testing and closed-browser push delivery are not claimed. Reminders persist server events for the next active session.
- **Limitations by design:** Nested folders, AI/transcription/study/project tools and E2EE are absent. Search requires the C++ server; locked-note opening requires online verification. Backup/media sizes are bounded and documented.

See `verification.md`, `api.md`, `search-engine.md` and `security-and-offline.md` for exact evidence and behavior.
