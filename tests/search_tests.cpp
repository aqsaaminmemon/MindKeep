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
