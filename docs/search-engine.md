# Custom C++ search engine

The primary retrieval algorithm is implemented in `backend/src/search.cpp`. MySQL is the source of truth, but no MySQL full-text index, Elasticsearch, hosted search service or replacement retrieval library is used. ICU handles Unicode normalization/classification; it does not index or rank notes.

## Structures

Each owner has an independent `Library`, held in a hash map. A library has:

- A hash map of documents keyed by stable note ID.
- An ordered term dictionary (`std::map`) → posting hash map keyed by note ID. Lower-bound lookup expands only vocabulary entries beginning with the query word. Each posting retains separate **title positions** and **body positions**. Vector lengths are term frequencies.
- A byte trie of normalized complete titles. Each prefix node has an ordered ID set; this gives deterministic title-prefix retrieval. UTF-8 prefix traversal is valid because normalized queries end at complete character boundaries.
- Hash maps of normalized folder names, tag names and note states to ordered ID sets.
- A sorted map from modification timestamp to ID sets for range filtering.

Title/body separation supports stronger title weighting and prevents a quoted phrase from spanning title and body. Ordered sets permit predictable intersections. Documents hold only the text/metadata needed for indexing, not attachment bytes.

## Processing

Canonical rich HTML is sanitized before persistence. `plain_text()` removes markup, inserts block/list line breaks and decodes supported entities. Raw HTML tag names and style attributes are not indexed as visible content. Images/audio are attachments, not HTML strings in the indexed text.

ICU validates UTF-8, normalizes to NFC and performs full case folding (including `Straße` → `strasse`). Tokens are contiguous Unicode letters/digits, with combining marks retained. Punctuation and whitespace separate tokens. No stop words are removed; every token has a stable sequential position, so phrases including “the” remain accurate.

Ordinary multiword queries use **AND**: each term must match a complete word or word prefix in title/body. A term may match in the title while another matches in the body. Prefix matching works at the start of every title/body word, regardless of case: `RiS` matches `rise`, and `sunr` matches `sunrise` later in a title. It does not match arbitrary middle-of-word substrings. A quoted phrase matches contiguous token positions within one field; punctuation is normalized to token boundaries, so this is an exact *token phrase*, not an exact raw byte substring.

Supported conditions:

```text
"take the scenic route"
tag:Everyday
folder:"Personal ideas"
tag:“Personal Ideas”
after:2026-01-01 before:2026-11-01
state:archived
```

ASCII and curly double quotes are accepted. Inline conditions override the corresponding filter controls; repeating an inline condition is rejected. Missing values, unmatched quotes, text directly following a closing quote, duplicate or unknown conditions/states, impossible calendar dates and reversed ranges produce a clear 400 error. Date filters apply to **modification time**, in UTC: `after` includes the start of the named date; `before` excludes that date's start. The UI labels this meaning.

## Retrieval and ranking

Choose the smallest indexed filter, word-prefix posting union, or exact phrase-word posting list as the candidate seed. Only materialize IDs that satisfy all filters and visibility rules. Locked documents are excluded unless that exact session has a live unlock grant. Default state is active; `all` excludes Trash. Filter ID sets and date range sets intersect the candidate set. For each ordinary term, intersect term postings (and title-trie matches). For each phrase, first narrow candidates with its rarest word, then verify that its first token position `p` has each successive token at `p+1`, `p+2`, etc., using binary search in ordered position vectors.

For each ordinary term:

```text
idf = 1 + log((visible_document_count + 1) / (eligible_prefix_document_frequency + 1))
term_score = idf * (3 * title_tf/(title_tf + 1) + body_tf/(body_tf + 1))
```

Prefix frequencies aggregate the matching vocabulary entries. Title-only scope omits the body contribution. A complete-title prefix match adds 2 points. Each matched phrase adds 4 points. Title weight is greater than body weight, term frequency saturates, rarer terms receive more weight, and ties break lexicographically by stable note ID. Locked documents excluded from a session's visibility do not influence its IDF values. A search in another owner's library never affects scores, snippets or result counts. The UI defaults search results to relevance; explicit title/date sorting is still available.

Snippets select a short region near a matching body term (or phrase token), with safe UTF-8 boundaries. Result highlights map normalized text back to original UTF-16 ranges in the frontend, preserving stored formatting. Open-editor highlighting uses the CSS Custom Highlight API and never inserts markup into canonical note content. Older browsers without that API still show result highlights.

## Lifecycle and concurrency

On startup, rebuild from stored MySQL notes/tags/folders. Creation, edits, metadata changes, soft deletion, restoration, attachments' revision updates, organization removal and permanent deletion update or remove indexed documents. Rename operations rebuild metadata membership. Edits remove old postings, title memberships and filter memberships before inserting replacement data; unused trie branches are pruned.

Database mutations are serialized by the application's mutation mutex. Related SQL changes use MySQL transactions with prepared value bindings. Commit database changes before updating the derived index. The search index has a `shared_mutex`: searches acquire a shared lock and updates/rebuilds acquire an exclusive lock. A replacement rebuild is constructed separately and swapped under the exclusive lock. The HTTP search route holds the mutation mutex across index retrieval and batched result loading, preventing intervening edits/deletions. Joined unlock grants are checked again before exposing locked-note content. No reader observes a partly edited posting list.

This is a **single-instance application**. Multiple devices connect to that one instance. Independently running several C++ servers against the same database is unsupported because their in-memory indexes would need an inter-process update channel.

## Complexity and memory

Let N be the owner's document count, P total token positions, T query terms, C candidates and H hits.

- Tokenization and insertion: proportional to text length/positions, plus title trie and ordered-set insertion costs. Rebuild is approximately O(P + total_title_bytes log N + metadata_memberships log N).
- Trie prefix lookup: O(prefix bytes + matching IDs).
- Ordered-set intersection: O(minimum set size × log maximum set size), with selective seeds reducing work.
- Date lookup: O(log distinct_dates + matching memberships).
- Phrase checks: candidate/token-position work, with binary searches O(log frequency) per successive token check.
- Ranking: O(posting-frequency work + C*T), then O(H log H) for priority-queue insertion/extraction.
- Update removal scans that library's metadata group dictionaries and old token lists; this favors simplicity at the project's scale rather than optimal per-document membership removal.

Index space is O(P + document text + memberships + trie-prefix ID memberships). Storing an ID set at every trie node is a deliberate speed/memory tradeoff: long titles and many shared prefixes cost memory. Selective queries start from indexed matches instead of scanning all documents. Broad queries that match most notes still require proportional candidate/result work. Hash-table overhead and allocator fragmentation vary by implementation.

`memory_bytes()` estimates document strings/objects, postings, trie nodes/ID memberships and filter/date memberships. It is an approximate structural estimate, not process RSS, allocator instrumentation or peak memory. Some container bucket/tag-vector overhead is uncounted. The benchmark does not claim a precise memory measurement.

## Reproducible evaluation

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j2
ctest --test-dir build --output-on-failure
./build/search_benchmark > docs/search-performance.csv
```

The generated dataset uses 100, 1,000 and 10,000 short English everyday notes, one owner, two alternating query shapes (phrase+tag and two-term+tag), 100 searches per size, and an in-process steady clock. It measures index construction, median/p95 query latency, and approximate index bytes. It excludes HTTP, MySQL, browser rendering, disk and media. See the committed CSV and verification report for observations from this machine. Short synthetic data is not a guarantee for long rich notes, many owners, pathological titles, or production load.

Search hits are ordered through a `std::priority_queue` binary heap: higher score has higher priority, and equal scores prefer the lexicographically smaller note ID. Every hit is extracted; no result limit is introduced. Ordinary word-prefix expansion now contributes title/body frequencies to relevance.

## HTTP result loading

Results are loaded in chunks of 200 using parameterized SQL: one joined note/reminder/access/Trash/unlock query, one tags query and one attachments query per chunk. A hash map associates metadata with note IDs and the final output restores the search heap order. This replaces several SQL round trips per hit, preserves full note metadata for opening/favoriting, and keeps account/session boundaries enforced. `tests/search_prefix_tests.py` checks metadata parity, lock/unlock behavior and results crossing the chunk boundary.
