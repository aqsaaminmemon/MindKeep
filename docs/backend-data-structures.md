# Backend data structures

The C++ backend uses the following structures in real operations. MySQL remains the persistent source of truth. This refactor changes internal containers, not routes, UI, scoring, result limits, permissions, stored formats or export formatting.

| Structure | Implementation | Actual role |
|---|---|---|
| Hash table | `std::unordered_map` | Per-owner search libraries, documents, per-word note postings, filter memberships and login rate-limit counters. |
| Positional inverted index | Nested hash maps plus position vectors | Word lookup and exact token-phrase matching, with separate title/body positions. |
| Prefix tree | Custom `SearchIndex::Trie` | Title-prefix lookup, with unique note memberships on each node. |
| Ordered sets/maps | `std::set`, `std::map` | Candidate intersections, duplicate-ID checks, unlocked IDs, time-range indexing and restore ID remapping. These are standard-library ordered containers, not handwritten balanced trees. |
| Dynamic array | `std::vector` | Tokens, phrase positions, database bindings/rows, exported result arrays and cleanup paths. |
| Binary heap | `std::priority_queue<Hit, vector<Hit>, ...>` | Extracts every search hit by descending score then ascending stable ID, preserving previous ordering. |
| Stack | `std::stack` backed by a vector | Tracks nested Markdown list types and numbering; popping restores the parent list context. |
| Doubly linked list | `std::list<pair<string, string>>` | Stages validated decoded backup attachments in original traversal order before writing them. |
| FIFO queue | `std::queue<string>` | Indexes restored notes in the same order in which they were imported. Uses the standard default deque backing container. |

New containers are in `backend/src/search.cpp`, `backend/src/security.cpp`, and `backend/src/backup.cpp`. Existing indexes are declared in `backend/include/core.hpp`.

Each authored backend implementation file uses `using namespace std;` inside `namespace mk`. Public headers retain qualified standard-library names, so importing a header does not import the whole standard namespace into its caller. Some existing type names stay qualified where useful, including `std::string`, since the project also has an `mk::string` JSON extraction function.

The heap still returns all matches. It adds no top-K cap, and it uses the same score formula and ID tie-break. The attachment list preserves append/iteration order. The restore queue's count is captured before it is drained, so the API's `restored_notes` count remains unchanged. The list stack preserves the original closing-tag handling and generated Markdown.

The search vocabulary now uses `std::map` for ordered prefix-range lookup. Search candidates start from the smallest indexed set/posting group; batched SQL result metadata is associated with IDs through `std::unordered_map`.
