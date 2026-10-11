#pragma once
#include "core.hpp"
#include <functional>
#include <httplib.h>
#include <mutex>
#include <mysql.h>

namespace mk {
struct Error : std::runtime_error {
  int status;

  Error(int s, const std::string &m) : std::runtime_error(m), status(s) {}
};

using Rows = std::vector<json>;

class Database {
  MYSQL *connection = nullptr;
  mutable std::recursive_mutex mutex;

public:
  Database();
  ~Database();
  Rows query(const std::string &sql, const std::vector<std::string> &params = {});
  void transaction(const std::function<void()> &f);
  void migrate(const std::string &file);
};

void rate_limit(const std::string &key);
std::string env(const char *key, const std::string &fallback = "");

struct Session {
  std::string hash, user, csrf;
  bool locked = false;
};

struct App {
  Database db;
  SearchIndex index;
  httplib::Server server;
  std::mutex mutations;
  std::string data = env("MINDKEEP_DATA", "data"),
              url = env("MINDKEEP_PUBLIC_URL", "http://localhost:8080");
  void respond(httplib::Response &res, const json &body, int status = 200);
  void route(const std::string &method, const std::string &path,
             const std::function<json(const httplib::Request &, httplib::Response &)> &fn);
  Session auth(const httplib::Request &req, bool allow_locked = false);
  json user(const std::string &id);
  json note(const std::string &id, const Session &session, bool allow_deleted = true);
  bool unlocked(const Session &session, const json &note);
  std::set<std::string> unlocks(const Session &session);
  json enrich(json row, const Session &session, bool redact = true);
  Document document(const json &row);
  void rebuild();
  void index_note(const std::string &id);
  void change(const std::string &owner, const std::string &id, long long revision,
              const std::string &operation = "upsert");
  json save_note(const Session &s, const json &input, bool create);
  void validate_password(const std::string &p);
  void auth_routes();
  void note_routes();
  void media_routes();
  void sharing_routes();
  void backup_routes();
  void reminder_tick();
  void trash_tick();
  json upload(const Session &s, const std::string &noteid, const std::string &mime,
              const std::string &name, const std::string &bytes,
              const std::string &operation_id = "");
  json public_note(const std::string &token);
};

inline long long number(const json &j, const std::string &key) {
  if (!j.contains(key) || j[key].is_null())
    return 0;
  if (j[key].is_number())
    return j[key].get<long long>();
  return std::stoll(j[key].get<std::string>());
}

inline bool flag(const json &j, const std::string &key) {
  if (!j.contains(key) || j[key].is_null())
    return false;
  if (j[key].is_boolean())
    return j[key].get<bool>();
  return number(j, key) != 0;
}

inline std::string string(const json &j, const std::string &key, const std::string &fallback = "") {
  return !j.contains(key) || j[key].is_null() ? fallback : j[key].get<std::string>();
}

inline std::string id_check(const std::string &id) {
  if (id.size() > 36 || id.size() < 16 ||
      id.find_first_not_of("0123456789abcdef-") != std::string::npos)
    throw Error(400, "Invalid ID");
  return id;
}
} // namespace mk
