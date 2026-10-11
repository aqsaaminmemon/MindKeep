> Historical verification notes. Earlier screenshot artifacts are retained locally; the current public screenshots are `screenshots/home.png`, `screenshots/editor.png`, and `screenshots/search.png`.

# Verification evidence — 10 October 2026

The folder was initially empty. After the power interruption, all written source files and vendored dependencies were intact; unfinished modules/frontend/tests were continued. The first runtime checks exposed missing architecture-specific OpenSSL headers, a schema collation mismatch, and MySQL rejecting transaction-control SQL through prepared statements. These were corrected. A stalled restricted-sandbox MySQL fixture was replaced by an isolated working local instance. No existing system database was changed.

## Automated checks

- CMake **Release** build with C++20, MySQL 8.4 client, OpenSSL and ICU: passes. No frontend framework/build pipeline or alternative backend was substituted.
- CTest search/security suite: passes. Includes Unicode/NFC/full casefold and malformed UTF-8, visible HTML/entity extraction, phrase order, title ranking/prefixes, multiword AND, folder/tag/date/state filtering, invalid/duplicate syntax, updates/removals/rebuild, user/lock isolation, password/base64 checks and concurrent index readers/writers. Assertions remain active in Release.
- `tests/api_tests.py`: **36 integration checks passed** on the final build; tests synthetic accounts only. Verifies idempotent creation, timestamp preservation, account isolation and cross-tab account guards, owned folder/tag relationships, revision conflicts, image/audio upload/retrieval, idempotent media retry, independently copied attachments, real exports, complete backup/restore, lock enforcement across notes/search/media/export, explicit locked-note sharing, revocation, reminder delivery/acknowledgement, Trash/restoration/permanent-delete tombstones, and unconfigured-email errors.
- `tests/reset_tests.py`: explicit **test email adapter**, isolated server, real MySQL tokens. Confirms password replacement, session invalidation, old-password rejection, token single-use and expiry. Does not claim real SMTP mailbox delivery.
- `tests/export_tests.py`: genuine long-note PDF, **17 A4 pages**, final paragraph present, café/Unicode survives extraction, Markdown headings/numbered lists/checklists preserved. The small image-note PDF is a genuine tagged PDF confirmed by `pdfinfo`; HTML includes original media bytes/audio controls.
- `tests/offline_tests.mjs`: real Web Crypto with a fake IndexedDB test adapter. Confirms encrypted round trip, wrong-password rejection, rotated salt rejection, recovery/rekey without lost pending/protected drafts, preserved ciphertext archive, archived-draft recovery and lock-key lifecycle. This supplements the real browser outage check, rather than replacing it.
- All authored JavaScript modules pass `node --check`; source was formatted for review.

No automated check reads, deletes or changes existing real-user notes. Tests create distinct synthetic accounts and deliberately retain them in the development database. Temporary exports contain synthetic test text only.

## Browser checks

Checked in the available Codex in-app browser using a separate **127.0.0.1 test origin** to isolate sign-in cookies from the user's localhost app:

1. Sign-in, encrypted-vault reopen, real MySQL-backed seeded cards.
2. Quick capture, Unicode text, bold formatting, closing/reopening, and **Saved** only after acknowledged persistence.
3. Quoted phrase search with the C++ engine and highlighted result text.
4. Desktop Airy Cards layout at 1280×900, mobile at **320×720**, full-screen editor and wrapping toolbar. The measured document scroll width did not exceed the viewport.
5. Shut down only the isolated QA server, create a note while disconnected, close/reload the cached application, unlock the encrypted local vault, and verify the draft text survived with **Saved on this device**. Restore the server, reconnect/reopen, verify the same note and acknowledged **Saved** state in MySQL.
6. Shared-cookie account changes were found during testing; an account-ID guard now prevents mixing another account's library into a device vault. Its regression test passes. The earlier wrong-vault warning did not indicate destroyed storage.

Screenshots in `screenshots/` show synthetic example notes and the responsive interface. They do not show private user notes.

Not exercised: physical microphone hardware/permission prompts, all browser engines, physical tablet/phone hardware, two physical remote devices, production TLS, real SMTP delivery, or closed-browser push notifications. These are explicit verification/configuration limits.

## Search measurements

See `search-performance.csv` for captured Release observations and `search-engine.md` for the generator/measurement method. The benchmark covers 100, 1,000 and 10,000 short synthetic notes, alternating phrase+tag and term+tag queries, 100 samples per size. On the recorded run, 10,000 notes indexed in approximately **234 ms**, query median approximately **34 ms**, p95 approximately **54 ms**, and structural index memory approximately **28 MB**. This excludes network/database/browser work and is not a production guarantee. Memory is an estimate, not measured process RSS.

## Runtime and durability

The local preview runs at `http://localhost:8080`. The test database is a separate MySQL instance on port 3307, with generated credentials under ignored, private `data/dev.env`. Its temporary data directory is documented in the README. A private administrator SQL snapshot is kept in the project data folder to aid development recovery; it is not a user-portable backup and must not be published. Use a normally provisioned persistent MySQL/media location for deployment. The public app has not been deployed or configured for real SMTP.

A final optional browser sign-in recheck was blocked by automatic approval review for the synthetic QA credential. Earlier browser checks and screenshots remain the recorded visual evidence; final-build API tests were completed independently.

## Requested UI corrections

Image-upload and voice-recording controls removed from composer/editor, including microphone capture code. Existing attachments retained for data safety and backup compatibility. Search clears match terms and editor highlights when emptied, invalidates late responses and clears old terms while replacing the query. Favorite stars fill via the favorite state class in cards and editor, with aria-pressed updated. `node tests/search-ui-tests.mjs` passes clearing, delayed-response, navigation, filter-only search and repeated card/editor favorite-state regressions. JavaScript syntax checks pass. Final live UI inspection reached the user account lock screen; no credentials were entered or user notes modified.

Creation controls (composer, empty-state action, and keyboard creation) are now limited to All Notes. Note background color selection removed. Reminder, favorite and menu controls share one footer row, including list view. Collection visibility regressions pass for All Notes, Favorites, Recent, Archive, Reminders and Trash.

Visual QA of synthetic cards generated by the production renderer confirmed reminder, star and menu centers align in one row in both list and grid layouts, at desktop and 320px viewport width. No horizontal overflow at 320px. Screenshot: `screenshots/card-actions.png`. Temporary preview server closed afterward.

## Data-structure refactor compatibility

Captured the original backend outputs before refactoring, then compared them byte for byte against the rebuilt core: 120 synthetic notes, 14 queries across three owner scopes (42 searches), score precision 17 digits, exact IDs/order/snippets, Unicode, phrase/prefix/organization/state/date search and five Markdown list inputs (including nesting and malformed/unwrapped lists). Outputs matched exactly. This is fixture-based compatibility evidence, not a proof for every possible input. No UI or API definitions changed.

The refactored full Release backend passed all 36 API integration checks, including backup validation, media restoration and restored-note/attachment counts. Added regression checks for equal-score heap ID ordering and nested Markdown parent numbering passed in CTest. The main local app was restarted with this build after successful checks.

Blue/violet appearance: synthetic preview of the real sign-in markup, production stylesheet, generated recolored logo and button-feedback module rendered successfully. Computed primary button color rgb(37,99,235), page background rgb(247,243,255), blue logo loaded. Trusted button click produced no browser errors. Visual screenshot: `screenshots/blue-violet-theme.png`. Physical speaker audibility was not measured. JavaScript syntax and existing UI regressions pass.

Masonry card view: mixed-height synthetic notes rendered by the production card function pack upward with 16–17px spacing per column. Browser geometry and screenshot confirmed later cards start beneath shorter cards without waiting for the tallest card. Resize to 320px produced one column, no overlapping cards and no horizontal overflow. List/compact CSS unchanged; resize observers recalculate grid spans after card/container size changes. Screenshot: `screenshots/masonry-layout.png`.

Favorite-order correction: frontend favorite-only edits retain the timestamp in optimistic/offline pending state; backend compares actual content/metadata and preserves updated_at for favorite-only mutations, while advancing revision and updating search membership. Unchanged reminder state is not reset. Timestamp ties have an ID tie-break. UI regression confirms repeated favorite/unfavorite saves preserve timestamps. Button feedback tests cover AudioContext resume, trusted clicks, disabled/untrusted click suppression, mute preference and explicit preview. The tone is now 120ms at 0.12 peak gain instead of 50ms at 0.025. Actual audibility still depends on browser/device output settings; Settings has an explicit Test sound action.

The favorite regression API test passed repeated full-payload toggles, partial toggles, library order after reload, revision increments and unchanged metadata. A real content edit still advances updated_at and sorts normally. All 36 general API checks passed. The real in-app browser successfully started the revised sound from a trusted Test sound click; the preview displayed Audio started successfully. Screenshot `screenshots/sound-check.png`. Main app restarted with the verified build.

Folder and tag removal: sidebar trash buttons open a named confirmation. Notes are preserved; selected views and filters are cleared, search results and an open editor refresh. Affected unsynced drafts block removal until saved or resolved. Verified with `node tests/organization-ui-tests.mjs` and synthetic-account `tests/organization_tests.py` against the local QA server.

Create/button feedback: actual trusted clicks now play a short local button-click.wav tap directly during the click, with Web Audio fallback. Enabled buttons receive a 180ms press animation; Create and quick composer lift on hover. Reduced-motion and disabled buttons are respected. Tests cover real click dispatch, replay, fallback, mute and animation.

Folder/tag actions now use sidebar three-dot buttons opening Rename and Delete. Rename is prefilled and updates the selected search filter; deletion retains confirmation and pending-draft protection. Verified via organization-ui-tests.mjs and existing search UI tests.

New ribbon logo from the user reference: built-in image editing generated the transparent coral cutout (logo-transparent.png) and blue logo (logo-ribbon-blue.png). Logo-ribbon-blue.svg uses the new silhouette with exact theme fill #3346A8. App, favicon, shared view and notification references updated; shell cache v17. Prompts: preserve three ribbon shapes; recolor to #3346A8 and remove background; separately remove only background preserving coral foreground.

Bulk note selection: Select notes enables card checkboxes, Select all, selection count, Cancel and Delete selected. Confirmation moves only selected notes to Trash, preserves content and queues offline changes; online synchronization runs after the batch. Selection clears on navigation and prunes hidden results. Protected notes cannot be selected, and conflicts or offline locked notes block the batch before mutation. Verified via node tests/bulk-selection-tests.mjs, existing UI tests and synthetic-account tests/bulk_delete_tests.py including restoration and an untouched unselected note.

Search-result interaction fix: search responses hydrate the note store without overwriting pending drafts or saving transient score/snippet fields. Result rendering reads live note state while retaining search ranking and snippets, so favorite toggles and note menus reflect current values. Verified actual collection click handlers with production search/open/changeNote/filteredNotes in tests/search-actions-tests.mjs, including an uncached note, repeated favorite toggles, menu access and pending draft protection; existing search, selection and organization tests also pass.

Editor history now uses session snapshots for title and content. Done/close clears undo and redo; toolbar, Ctrl/Cmd+Z/Y and native history input use only current session. Browser QA confirmed undo/redo before Done, reopening disables both, and Ctrl+Z leaves completed content intact. Evidence: docs/screenshots/editor-session-history.png. Unit coverage: tests/editor-history-tests.mjs. App/editor module URLs versioned v32 to avoid an older loaded bundle. Browser QA also confirmed a search-result Favorite click persists and fills the star.

11 October update: password recovery now requests and verifies a six-digit code before accepting a new password. Captured-mail integration tests verify ten-minute expiry, five failed guesses, resend invalidation, single use, and session invalidation. Frontend recovery transitions pass tests/reset-code-ui-tests.mjs. Real Gmail delivery still requires sender credentials; scripts/configure-email.sh --gmail securely configures STARTTLS with a Gmail app password. No real mailbox delivery is claimed.

Trash retention is server-managed at 30 days, with a startup check and checks every 10 seconds. Tests/trash_retention_tests.py passes for expiry, attachment file cleanup, sync tombstones, restoring, retrashing, edits that do not extend deadlines, and preservation of recent/active/legacy notes. Existing Trash notes receive a full retention window when first tracked. Trash shows the 30-day policy and days remaining.

Search results now omit the C++ attribution and hide bulk-selection controls. Note cards display a full localized date and time using updated_at (created_at fallback), with wrapping to avoid truncation. Search UI/action, selection, editor-history, recovery UI and CTest search correctness checks pass; backend builds successfully.

Garamond theme: bundled EB Garamond regular/italic variable fonts, including the SIL Open Font License, now provide the default app font and are cached offline. Buttons, fields, menus and note editor inherit it; Garamond is the first/default editor family and is accepted by both HTML sanitizers. Existing explicitly chosen font families remain available. Browser inspection confirmed the heading font family and the rendered login page; screenshot docs/screenshots/garamond-app.png. Backend build, CTest and editor-history checks pass.

11 October search improvements: ordinary queries now match case-folded word prefixes throughout titles and bodies (RiS → rise). Quoted phrases remain complete-token positional matches. Ordered vocabulary ranges, smallest indexed candidate seeds, rarest phrase-word narrowing and early empty-result returns replace unnecessary full-library candidate scans. Search HTTP results use three parameterized SQL queries per 200-note batch, preserve full metadata and heap ranking, and recheck unlock expiry under the mutation mutex. CTest and frontend search lifecycle/action tests pass. New tests/search_prefix_tests.py verifies mixed-case partial words, scoped filters, phrase behavior, exact metadata parity against opening a note, protected-note exclusion/verified unlock and 201 unique results across the batch boundary. That local 201-result HTTP call measured 36.9 ms. All 36 existing integration checks pass on the restarted server.

Same-machine in-process benchmark before this change (100 searches per size): at 10,000 short notes, median 31.4515 ms and p95 52.9189 ms. First updated run: median 17.6356 ms and p95 23.0168 ms. This is a mixed phrase/tag and ordinary-word/tag workload, not every query shape or end-to-end latency. docs/search-performance.csv contains the latest full rerun.

Purple Blue theme: light-mode accents and action backgrounds plus the logo SVG filter now use #6A5ACD, with matching hover shade #5B4BB6 and a lighter related accent for dark-mode text. Existing violet backgrounds and Garamond stay unchanged. Shell cache v41. Browser screenshot: docs/screenshots/purple-blue-theme.png.

Dark-mode correction: theme classes now apply to both the document root and body, resolving inherited light background/text colors. Dark navy page (#141A30), blue surface (#202741), violet selection (#343052), Purple Blue buttons and lighter violet action text form the dark palette. Native controls/scrollbars, colored note cards, welcome-page sample notes, notifications, errors, highlights and saved light-mode rich-text colors adapt to dark display. Saved note content is not recolored by the theme change. Browser QA on a synthetic account verified settings, note cards, saved dark text/white highlights in the editor and welcome-page samples. Text contrast: primary 12.79:1, secondary 8.03:1, action text on selected surface 6.05:1, primary button text 5.31:1. Screenshots: docs/screenshots/dark-notes.png, dark-settings.png and dark-editor.png. Search/action/editor-history regressions pass; shell cache v42.
