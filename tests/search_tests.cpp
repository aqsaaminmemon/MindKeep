#include "core.hpp"
#include <iostream>
#include <stdexcept>
#include <thread>
using namespace mk;
using namespace std::string_literals;

void check(bool ok, const std::string &label) {
  if (!ok)
    throw std::runtime_error(label);
}

Document doc(std::string id, std::string owner, std::string title, std::string body) {
  Document d;
  d.id = id;
  d.owner = owner;
  d.title = title;
  d.body = body;
  d.updated = 1735689600000;
  d.created = d.updated;
  return d;
}

int main() {
  try {
    check(tokenize("Hello, WORLD! café CAFÉ مرحبا اردو 123") ==
              std::vector<std::string>({"hello", "world", "café", "café", "مرحبا", "اردو", "123"}),
          "Unicode tokenization and case folding");
    check(tokenize("Cafe\xcc\x81") == tokenize("Café"), "Unicode normalization");
    check(tokenize("Straße") == tokenize("STRASSE"), "Full Unicode case fold");
    bool bad = false;
    try {
      tokenize(std::string("\xff", 1));
    } catch (...) {
      bad = true;
    }
    check(bad, "Invalid UTF-8 rejected");
    check(plain_text(sanitize_html("<h2>Shopping</h2><p>milk &amp; bread</p>"))
                  .find("Shopping\nmilk & bread") != std::string::npos,
          "Visible HTML text extraction");
    check(sanitize_html("<img onerror=x src=x><b onclick=x>safe</b><span "
                        "style=\"background-image:url(x);color:#5265c7\">ok</span>")
                  .find("onclick") == std::string::npos,
          "Sanitizer rejects handlers");
    check(sanitize_html("<script>alert(1)</script><iframe src=x></iframe>").find("<script") ==
              std::string::npos,
          "Sanitizer rejects active content");
    check(plain_text("<p>Caf&#233; &eacute; &amp;#233; &#x627;</p>") == "Café é &#233; ا\n",
          "HTML numeric and named entity extraction");
    check(markdown("<ol><li>First</li><li>Second</li></ol>").find("1. First\n2. Second") !=
              std::string::npos,
          "Markdown numbered lists");
    check(markdown("<ol><li>Outer<ul><li>Inner</li></ul></li><li>Next</li></ol>") ==
              "1. Outer  - Inner\n\n2. Next\n",
          "Nested list stack restores parent numbering and preserves formatting");
    SearchIndex tied;
    tied.rebuild({doc("z", "owner", "Same title", "same body"),
                  doc("a", "owner", "Same title", "same body"),
                  doc("m", "owner", "Same title", "same body")});
    auto tied_hits = tied.search("owner", parse_query("same"));
    check(tied_hits.size() == 3 && tied_hits[0].id == "a" && tied_hits[1].id == "m" &&
              tied_hits[2].id == "z" && tied_hits[0].score == tied_hits[2].score,
          "Heap preserves ascending IDs for equal scores");
    SearchIndex prefixes;
    auto body_prefix = doc("body", "prefix-owner", "Morning plan", "Watch the sun rise slowly");
    auto title_prefix = doc("title", "prefix-owner", "Watch the sunrise", "A quiet morning");
    auto exact_prefix = doc("exact", "prefix-owner", "Rise", "Tomorrow");
    auto private_prefix = doc("private", "another-owner", "Rise", "rise");
    auto locked_prefix = doc("protected", "prefix-owner", "Rise", "rise");
    locked_prefix.locked = true;
    prefixes.rebuild({body_prefix, title_prefix, exact_prefix, private_prefix, locked_prefix});
    auto prefix_hits = prefixes.search("prefix-owner", parse_query("RiS"));
    std::set<std::string> prefix_ids;
    for (auto &hit : prefix_hits) {
      prefix_ids.insert(hit.id);
      check(hit.score > 0, "Body and title prefixes contribute relevance scores");
    }
    check(prefix_ids == std::set<std::string>{"body", "exact"},
          "Mixed-case partial words match body text while preserving account and lock isolation");
    check(prefixes.search("prefix-owner", parse_query("sunr", {{"scope", "title"}}))[0].id ==
              "title",
          "Prefixes match words later in the title");
    check(prefixes.search("prefix-owner", parse_query("ris", {{"scope", "title"}})).size() == 1,
          "Title-only prefix search excludes body-only matches");
    check(prefixes.search("prefix-owner", parse_query("ris slow")).size() == 1,
          "Multiple partial words retain AND matching");
    check(prefixes.search("prefix-owner", parse_query("\"ris\"")).empty(),
          "Quoted phrases still require complete words");
    body_prefix.body = "Changed content";
    prefixes.upsert(body_prefix);
    check(prefixes.search("prefix-owner", parse_query("slow")).empty(),
          "Editing removes stale prefix postings");
    prefixes.erase("prefix-owner", "title");
    check(prefixes.search("prefix-owner", parse_query("sunr")).empty(),
          "Deleting removes prefix vocabulary membership");

    SearchIndex scoped;
    auto title_only = doc("title-only", "scope-owner", "Project café", "Quiet morning");
    auto body_only = doc("body-only", "scope-owner", "Notebook", "Project café planning");
    auto both = doc("both", "scope-owner", "Project café", "Project café meeting");
    auto private_scope = doc("other", "other-owner", "Notebook", "Project café planning");
    auto locked_scope = doc("locked", "scope-owner", "Notebook", "Project café planning");
    locked_scope.locked = true;
    for (auto *d : {&title_only, &body_only, &both, &private_scope, &locked_scope}) {
      d->folder = "Work";
      d->tags = {"Ideas"};
    }
    scoped.rebuild({title_only, body_only, both, private_scope, locked_scope});
    auto ids = [&](const Query &query, const std::set<std::string> &unlocked = {}) {
      std::set<std::string> result;
      for (auto &hit : scoped.search("scope-owner", query, unlocked)) result.insert(hit.id);
      return result;
    };
    check(ids(parse_query("proj", {{"scope", "content"}})) ==
              std::set<std::string>{"body-only", "both"}, "Content scope excludes title-only prefixes");
    check(ids(parse_query("\"project café\"", {{"scope", "content"}})) ==
              std::set<std::string>{"body-only", "both"}, "Content-only phrases ignore title positions");
    check(ids(parse_query("project", {{"scope", "title"}})) ==
              std::set<std::string>{"title-only", "both"}, "Title scope remains correct");
    check(ids(parse_query("project", {{"scope", "content"}, {"exclude", "MEETING"},
                                    {"folder", "Work"}, {"tag", "Ideas"}})) ==
              std::set<std::string>{"body-only"}, "Content, exclusion, folder and tag combine");
    check(ids(parse_query("project", {{"exclude", "planning, meeting"}})) ==
              std::set<std::string>{"title-only"}, "Multiple exclusion words remove matching notes");
    check(ids(parse_query("project", {{"scope", "content"}, {"exclude", "proj"}})).size() == 2,
          "Excluded words are whole-word matches, not prefixes");
    check(ids(parse_query("project", {{"scope", "title"}, {"exclude", "meeting"}})).size() == 2,
          "Title exclusions do not inspect the content");
    check(ids(parse_query("", {{"scope", "content"}, {"exclude", "CAFÉ"}})) ==
              std::set<std::string>{"title-only"}, "Exclude-only search respects scope and Unicode");
    check(ids(parse_query("project", {{"scope", "content"}}), {"locked"}).size() == 3,
          "Content search retains explicit locked-note verification");
    auto body_rank = scoped.search("scope-owner", parse_query("project", {{"scope", "content"}}));
    check(body_rank.size() == 2 && body_rank[0].score == body_rank[1].score,
          "Content-only ranking ignores title matches and boosts");
    auto archived_scope = body_only;
    archived_scope.id = "archive";
    archived_scope.archived = true;
    auto trashed_scope = body_only;
    trashed_scope.id = "trash";
    trashed_scope.deleted = true;
    scoped.upsert(archived_scope);
    scoped.upsert(trashed_scope);
    check(ids(parse_query("project", {{"category", "archived"}, {"scope", "content"}})) ==
              std::set<std::string>{"archive"}, "Archive category searches only archived notes");
    check(ids(parse_query("project state:all", {{"category", "trash"}, {"exclude", "meeting"}})) ==
              std::set<std::string>{"trash"}, "Trash search cannot escape with an inline state condition");
    check(ids(parse_query("", {{"category", "archived"}, {"exclude", "planning"}})).empty(),
          "Archive exclusions apply without a positive query");
    both.favorite = true;
    archived_scope.favorite = true;
    trashed_scope.favorite = true;
    scoped.upsert(both);scoped.upsert(archived_scope);scoped.upsert(trashed_scope);
    check(ids(parse_query("project state:all", {{"category", "favorites"}})) ==
              std::set<std::string>{"both"}, "Favorites tab excludes nonfavorites, archive and trash");
    check(ids(parse_query("project state:trash", {{"category", "active"}})) ==
              std::set<std::string>{"body-only", "both", "title-only"}, "All Notes search remains in active notes");
    const std::set<std::string> recent_ids = {"body-only"};
    const auto recent_hits = scoped.search("scope-owner", parse_query("project", {{"category", "recent"}}), {}, &recent_ids);
    check(recent_hits.size() == 1 && recent_hits[0].id == "body-only", "Recent eligibility is applied before ranking");
    check(scoped.search("scope-owner", parse_query("project", {{"category", "recent"}})).empty(),
          "Recent cannot search an unrestricted library without visit eligibility");
    const std::set<std::string> reminder_ids = {"title-only", "archive"};
    const auto reminder_hits = scoped.search("scope-owner", parse_query("project", {{"category", "reminders"}}), {}, &reminder_ids);
    check(reminder_hits.size() == 1 && reminder_hits[0].id == "title-only", "Reminders stays active and restricted to reminder notes");
    body_only.body = "Project café meeting";
    scoped.upsert(body_only);
    check(ids(parse_query("project", {{"scope", "content"}, {"exclude", "meeting"}})).empty(),
          "Exclusions follow edited postings");

    SearchIndex idx;
    auto a = doc("a", "alice", "Weekend ideas", "take the scenic route and buy fresh flowers");
    a.folder = "Personal Ideas";
    a.tags = {"Life", "Personal Ideas"};
    a.pinned = true;
    auto b = doc("b", "alice", "Shopping", "weekend ideas and ideas ideas ideas");
    auto c = doc("c", "bob", "Weekend ideas", "private phrase");
    auto locked = doc("locked", "alice", "Secret weekend", "weekend ideas");
    locked.locked = true;
    auto trash = doc("trash", "alice", "Weekend trash", "weekend");
    trash.deleted = true;
    auto archived = doc("archive", "alice", "Weekend archive", "weekend");
    archived.archived = true;
    idx.rebuild({a, b, c, locked, trash, archived});
    auto hits = idx.search("alice", parse_query("weekend"));
    check(hits.size() == 2 && hits[0].id == "a", "Title weight and default state");
    check(idx.search("bob", parse_query("weekend")).size() == 1, "Owner isolation");
    check(idx.search("unknown", parse_query("weekend")).empty(), "Unknown owner has no results");
    check(idx.search("alice", parse_query("week"))[0].id == "a", "Trie title-prefix matching");
    check(idx.search("alice", parse_query("\"the scenic route\"")).size() == 1,
          "Positional phrase");
    check(idx.search("alice", parse_query("\"route scenic\"")).empty(), "Phrase ordering");
    check(idx.search("alice", parse_query("ideas flowers")).size() == 1,
          "Multiword AND across fields");
    check(idx.search("alice", parse_query("weekend tag:Life folder:\"Personal Ideas\"")).size() ==
              1,
          "Folder and tag intersections");
    check(idx.search("alice", parse_query("weekend tag:“Personal Ideas”")).size() == 1,
          "Curly quoted values");
    check(idx.search("alice", parse_query("weekend before:2025-01-01")).empty(),
          "Exclusive before date");
    check(idx.search("alice", parse_query("weekend after:2025-01-01")).size() == 2,
          "Inclusive after date");
    check(idx.search("alice", parse_query("weekend state:trash")).size() == 1, "Explicit Trash");
    check(idx.search("alice", parse_query("weekend state:all")).size() == 3,
          "All excludes Trash and locks");
    check(idx.search("alice", parse_query("weekend"), {"locked"}).size() == 3,
          "Unlock grant permits note");
    check(idx.search("bob", parse_query("secret"), {"locked"}).empty(),
          "Unlock cannot cross users");
    for (auto invalid : {"\"unclosed", "wat:x", "before:2025-02-30", "tag:", "state:invalid",
                         "tag:A tag:B", "after:2025-02-01 before:2025-01-01"}) {
      bad = false;
      try {
        parse_query(invalid);
      } catch (...) {
        bad = true;
      }
      check(bad, std::string("Syntax rejected: ") + invalid);
    }
    a.body = "changed completely";
    a.title = "New thought";
    a.tags = {"Other"};
    idx.upsert(a);
    check(idx.search("alice", parse_query("flowers")).empty(),
          "Content update removes old postings");
    check(idx.search("alice", parse_query("tag:Life")).empty(),
          "Metadata update removes old memberships");
    idx.erase("alice", "b");
    check(idx.search("alice", parse_query("shopping")).empty(), "Deletion updates index");
    idx.rebuild({a});
    check(idx.search("bob", parse_query("weekend")).empty(), "Rebuild replaces index");
    std::thread writer([&] {
      for (int i = 0; i < 50; i++) {
        auto d = a;
        d.body = "version " + std::to_string(i);
        idx.upsert(d);
      }
    });
    std::thread reader([&] {
      for (int i = 0; i < 200; i++)
        idx.search("alice", parse_query("new"));
    });
    writer.join();
    reader.join();
    check(idx.memory_bytes() > 0, "Memory estimate");
    auto hash = password_hash("correct horse battery");
    check(password_verify("correct horse battery", hash) &&
              !password_verify("wrong password", hash),
          "Secure password verification");
    check(unbase64(base64("hello\0world"s)) == "hello\0world"s, "Base64 round trip");
    std::cout << "PASS: search/security correctness suite and concurrent reader/writer stress\n";
    return 0;
  } catch (const std::exception &e) {
    std::cerr << "FAIL: " << e.what() << "\n";
    return 1;
  }
}
