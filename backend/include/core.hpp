#pragma once
#include <chrono>
#include <map>
#include <memory>
#include <nlohmann/json.hpp>
#include <set>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace mk {
using json = nlohmann::json;

inline long long now() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

std::string random_hex(size_t bytes = 16);
std::string sha256(const std::string &s);
std::string password_hash(const std::string &s);
bool password_verify(const std::string &password, const std::string &encoded);
std::string base64(const std::string &s);
std::string unbase64(const std::string &s);
std::string sanitize_html(const std::string &html);
std::string plain_text(const std::string &html);
std::string markdown(const std::string &html);
std::string escape_html(const std::string &s);
std::vector<std::string> tokenize(const std::string &s);
std::string fold(const std::string &s);

struct Document {
  std::string id, owner, title, body, folder;
  std::vector<std::string> tags;
  long long created = 0, updated = 0;
  bool pinned = false, favorite = false, archived = false, deleted = false, locked = false;
};

struct Query {
  std::vector<std::string> terms, excluded;
  std::vector<std::vector<std::string>> phrases;
  std::string folder, tag, category, state = "active", scope = "all";
  long long before = 0, after = 0;
};

Query parse_query(const std::string &q, const json &filters = json::object());

struct Hit {
  std::string id, snippet;
  double score;
};

class SearchIndex {
  struct Posting {
    std::vector<int> title, body;
  };

  struct Trie {
    std::unordered_map<unsigned char, std::unique_ptr<Trie>> children;
    std::set<std::string> ids;
  };

  struct Library {
    std::unordered_map<std::string, Document> docs;
    // Ordered vocabulary supports efficient word-prefix lookup in titles and bodies.
    std::map<std::string, std::unordered_map<std::string, Posting>> terms;
    std::unordered_map<std::string, std::set<std::string>> folders, tags, states;
    std::map<long long, std::set<std::string>> dates;
    Trie titles;
  };

  std::unordered_map<std::string, Library> users;
  mutable std::shared_mutex mutex;
  static void remove(Library &l, const std::string &id);
  static void insert(Library &l, Document d);

public:
  void upsert(Document d);
  void erase(const std::string &owner, const std::string &id);
  void rebuild(const std::vector<Document> &docs);
  std::vector<Hit> search(const std::string &owner, const Query &q,
                          const std::set<std::string> &unlocked = {},
                          const std::set<std::string> *eligible = nullptr) const;
  size_t memory_bytes() const;
};
} // namespace mk
