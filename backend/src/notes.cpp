#include "app.hpp"
#include <algorithm>
#include <filesystem>
#include <regex>

namespace mk {
using namespace std;

bool App::unlocked(const Session &s, const json &n) {
  if (!flag(n, "locked"))
    return true;
  return !db.query("SELECT note_id FROM note_unlocks WHERE session_hash=? AND note_id=? AND "
                   "expires_at>?",
                   {s.hash, string(n, "id"), std::to_string(now())})
              .empty();
}

std::set<std::string> App::unlocks(const Session &s) {
  std::set<std::string> ids;
  for (auto &r : db.query("SELECT note_id FROM note_unlocks WHERE session_hash=? AND expires_at>?",
                          {s.hash, std::to_string(now())}))
    ids.insert(string(r, "note_id"));
  return ids;
}

json App::note(const std::string &id, const Session &s, bool allow_deleted) {
  auto rows = db.query("SELECT * FROM notes WHERE id=? AND user_id=?", {id_check(id), s.user});
  if (rows.empty())
    throw Error(404, "Note not found");
  if (!allow_deleted && flag(rows[0], "deleted"))
    throw Error(404, "Note is in Trash");
  if (!unlocked(s, rows[0]))
    throw Error(423, "Verify your password to open this note");
  return rows[0];
}

json App::enrich(json row, const Session &s, bool redact) {
  for (auto k : {"created_at", "updated_at", "revision"})
    row[k] = number(row, k);
  for (auto k : {"pinned", "favorite", "archived", "deleted", "locked"})
    row[k] = flag(row, k);
  row.erase("user_id");
  auto id = string(row, "id");
  row["deleted_at"] = nullptr;
  row["trash_expires_at"] = nullptr;
  if (flag(row, "deleted")) {
    auto trash = db.query("SELECT deleted_at FROM trash_entries WHERE note_id=? AND user_id=?",
                          {id, s.user});
    if (!trash.empty()) {
      row["deleted_at"] = number(trash[0], "deleted_at");
      row["trash_expires_at"] = number(trash[0], "deleted_at") + 30LL * 86400000;
    }
  }
  if (redact && !unlocked(s, row)) {
    row["title"] = "Locked note";
    row["content"] = "";
    row["plain_text"] = "";
    row["tags"] = json::array();
    row["attachments"] = json::array();
    row["reminder"] = nullptr;
    row["protected"] = true;
    row["folder_id"] = nullptr;
    return row;
  }
  row["protected"] = false;
  if (flag(row, "locked")) {
    auto grants = db.query("SELECT expires_at FROM note_unlocks WHERE session_hash=? AND note_id=?",
                           {s.hash, id});
    row["unlock_expires_at"] = grants.empty() ? 0 : number(grants[0], "expires_at");
  }
  row["tags"] = db.query("SELECT t.id,t.name FROM tags t JOIN note_tags nt ON nt.tag_id=t.id WHERE "
                         "nt.note_id=? AND nt.user_id=? ORDER BY t.name",
                         {id, s.user});
  row["attachments"] = db.query("SELECT id,kind,mime,name,bytes,created_at FROM attachments WHERE "
                                "note_id=? AND user_id=? ORDER BY created_at",
                                {id, s.user});
  auto reminders = db.query("SELECT due_at,delivered FROM reminders WHERE note_id=? AND user_id=?",
                            {id, s.user});
  row["reminder"] = reminders.empty() ? json(nullptr)
                                      : json{{"due_at", number(reminders[0], "due_at")},
                                             {"delivered", flag(reminders[0], "delivered")}};
  auto access =
      db.query("SELECT opened_at FROM recent_access WHERE note_id=? AND user_id=?", {id, s.user});
  row["opened_at"] = access.empty() ? 0 : number(access[0], "opened_at");
  return row;
}

Document App::document(const json &r) {
  Document d;
  d.id = string(r, "id");
  d.owner = string(r, "user_id");
  d.title = string(r, "title");
  d.body = string(r, "plain_text");
  d.created = number(r, "created_at");
  d.updated = number(r, "updated_at");
  d.pinned = flag(r, "pinned");
  d.favorite = flag(r, "favorite");
  d.archived = flag(r, "archived");
  d.deleted = flag(r, "deleted");
  d.locked = flag(r, "locked");
  if (!r["folder_id"].is_null()) {
    auto f = db.query("SELECT name FROM folders WHERE id=? AND user_id=?",
                      {string(r, "folder_id"), d.owner});
    if (!f.empty())
      d.folder = string(f[0], "name");
  }
  for (auto &tag : db.query("SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id=t.id WHERE "
                            "nt.note_id=? AND nt.user_id=?",
                            {d.id, d.owner}))
    d.tags.push_back(string(tag, "name"));
  return d;
}

void App::rebuild() {
  std::vector<Document> docs;
  for (auto &r : db.query("SELECT * FROM notes"))
    docs.push_back(document(r));
  index.rebuild(docs);
}

void App::index_note(const std::string &id) {
  auto r = db.query("SELECT * FROM notes WHERE id=?", {id});
  if (!r.empty())
    index.upsert(document(r[0]));
}

json App::save_note(const Session &s, const json &b, bool create) {
  std::lock_guard lock(mutations);
  auto id = id_check(b.at("id").get<std::string>());
  json old;
  auto existing = db.query("SELECT * FROM notes WHERE id=?", {id});
  if (create && !existing.empty()) {
    if (string(existing[0], "user_id") != s.user)
      throw Error(409, "ID already exists");
    return enrich(note(id, s), s);
  }
  if (!create) {
    old = note(id, s);
    if (number(b, "revision") != number(old, "revision"))
      return json{{"conflict", true}, {"server", enrich(old, s)}};
  }
  std::string title = b.value("title", create ? "" : string(old, "title"));
  if (title.size() > 500)
    throw Error(400, "Title is too long (500 bytes maximum)");
  auto content = sanitize_html(b.value("content", create ? "" : string(old, "content")));
  fold(title);
  fold(plain_text(content));
  auto bool_value = [&](const std::string &key) {
    if (b.contains(key) && !b[key].is_boolean())
      throw Error(400, "Invalid note state");
    return b.value(key, create ? false : flag(old, key));
  };
  bool pinned = bool_value("pinned"), favorite = bool_value("favorite"),
       archived = bool_value("archived"), deleted = bool_value("deleted"),
       locked = bool_value("locked");
  auto folder = b.contains("folder_id") ? string(b, "folder_id")
                : create                ? ""
                                        : string(old, "folder_id");
  if (!folder.empty() &&
      db.query("SELECT id FROM folders WHERE id=? AND user_id=?", {folder, s.user}).empty())
    throw Error(400, "Folder does not belong to this account");
  auto tags = b.value("tags", json::array());
  if (!tags.is_array() || tags.size() > 30)
    throw Error(400, "A note can have up to 30 tags");
  std::vector<std::string> tagids;
  if (b.contains("tags"))
    for (auto &t : tags) {
      auto tid = t.is_string() ? t.get<std::string>() : t.at("id").get<std::string>();
      if (db.query("SELECT id FROM tags WHERE id=? AND user_id=?", {tid, s.user}).empty())
        throw Error(400, "Tag does not belong to this account");
      tagids.push_back(tid);
    }
  std::string color = b.value("color", create ? "white" : string(old, "color"));
  if (!std::set<std::string>{"white", "blue", "violet", "peach", "mint", "yellow"}.contains(color))
    throw Error(400, "Invalid card color");
  bool favorite_only = !create && favorite != flag(old, "favorite") &&
                       title == string(old, "title") && content == string(old, "content") &&
                       folder == string(old, "folder_id") && color == string(old, "color") &&
                       pinned == flag(old, "pinned") && archived == flag(old, "archived") &&
                       deleted == flag(old, "deleted") && locked == flag(old, "locked");
  if (favorite_only && (b.contains("tags") || b.contains("reminder"))) {
    auto previous = enrich(old, s);
    if (b.contains("tags")) {
      vector<std::string> previous_tags;
      for (auto &tag : previous["tags"])
        previous_tags.push_back(string(tag, "id"));
      auto requested_tags = tagids;
      sort(previous_tags.begin(), previous_tags.end());
      sort(requested_tags.begin(), requested_tags.end());
      favorite_only = requested_tags == previous_tags;
    }
    if (b.contains("reminder"))
      favorite_only = favorite_only && b["reminder"].is_null() == previous["reminder"].is_null() &&
                      (b["reminder"].is_null() ||
                       number(b["reminder"], "due_at") == number(previous["reminder"], "due_at"));
  }
  long long timestamp = favorite_only ? number(old, "updated_at") : now();
  long long revision = create ? 1 : number(old, "revision") + 1;
  db.transaction([&] {
    if (create)
      db.query("INSERT INTO "
               "notes(id,user_id,title,content,plain_text,folder_id,pinned,favorite,archived,"
               "deleted,locked,color,created_at,updated_at,revision) "
               "VALUES(?,?,?,?,?,NULLIF(?,''),?,?,?,?,?,?,?,?,?)",
               {id, s.user, title, content, plain_text(content), folder, pinned ? "1" : "0",
                favorite ? "1" : "0", archived ? "1" : "0", deleted ? "1" : "0", locked ? "1" : "0",
                color, std::to_string(timestamp), std::to_string(timestamp),
                std::to_string(revision)});
    else
      db.query("UPDATE notes SET "
               "title=?,content=?,plain_text=?,folder_id=NULLIF(?,''),pinned=?,favorite=?,archived="
               "?,deleted=?,locked=?,color=?,updated_at=?,revision=? WHERE id=? AND user_id=?",
               {title, content, plain_text(content), folder, pinned ? "1" : "0",
                favorite ? "1" : "0", archived ? "1" : "0", deleted ? "1" : "0", locked ? "1" : "0",
                color, std::to_string(timestamp), std::to_string(revision), id, s.user});
    if (deleted)
      db.query("INSERT IGNORE INTO trash_entries(note_id,user_id,deleted_at) VALUES(?,?,?)",
               {id, s.user, std::to_string(now())});
    else
      db.query("DELETE FROM trash_entries WHERE note_id=? AND user_id=?", {id, s.user});
    if (b.contains("tags")) {
      db.query("DELETE FROM note_tags WHERE note_id=? AND user_id=?", {id, s.user});
      for (auto &tid : tagids)
        db.query("INSERT IGNORE INTO note_tags(note_id,tag_id,user_id) VALUES(?,?,?)",
                 {id, tid, s.user});
    }
    if (b.contains("reminder") && !favorite_only) {
      db.query("DELETE FROM reminders WHERE note_id=? AND user_id=?", {id, s.user});
      db.query("DELETE FROM reminder_events WHERE note_id=? AND user_id=?", {id, s.user});
      if (!b["reminder"].is_null()) {
        auto due = number(b["reminder"], "due_at");
        if (due <= 0)
          throw Error(400, "Invalid reminder time");
        db.query("INSERT INTO reminders(note_id,user_id,due_at) VALUES(?,?,?)",
                 {id, s.user, std::to_string(due)});
      }
    }
    if (deleted || archived || (!create && locked != flag(old, "locked"))) {
      db.query("DELETE FROM share_links WHERE note_id=? AND user_id=?", {id, s.user});
    }
    if (locked) {
      db.query("INSERT INTO note_unlocks(session_hash,note_id,expires_at) VALUES(?,?,?) ON "
               "DUPLICATE KEY UPDATE expires_at=VALUES(expires_at)",
               {s.hash, id, std::to_string(now() + 10 * 60000)});
    }
    change(s.user, id, revision);
  });
  index_note(id);
  return enrich(note(id, s), s);
}

void App::trash_tick() {
  std::lock_guard lock(mutations);
  const auto current = now();
  // Existing and restored Trash notes start a full retention window when first tracked.
  db.query("INSERT IGNORE INTO trash_entries(note_id,user_id,deleted_at) SELECT id,user_id,? FROM "
           "notes WHERE deleted=1",
           {std::to_string(current)});
  auto expired = db.query(
      "SELECT n.id,n.user_id,n.revision FROM notes n JOIN trash_entries t ON t.note_id=n.id AND "
      "t.user_id=n.user_id WHERE n.deleted=1 AND t.deleted_at<=? ORDER BY t.deleted_at LIMIT 100",
      {std::to_string(current - 30LL * 86400000)});
  for (const auto &n : expired) {
    const auto id = string(n, "id"), owner = string(n, "user_id");
    auto files =
        db.query("SELECT storage_key FROM attachments WHERE note_id=? AND user_id=?", {id, owner});
    db.transaction([&] {
      change(owner, id, number(n, "revision") + 1, "delete");
      db.query("DELETE FROM notes WHERE id=? AND user_id=? AND deleted=1", {id, owner});
    });
    index.erase(owner, id);
    for (const auto &file : files) {
      std::error_code error;
      std::filesystem::remove(data + "/" + string(file, "storage_key"), error);
      if (error)
        std::cerr << "Trash attachment cleanup failed\n";
    }
  }
}

// Load ranked search results in bounded batches: three queries per batch instead of per note.
static json search_results(App &app, const Session &session, const vector<Hit> &hits) {
  unordered_map<std::string, json> notes;
  const auto current = now();
  for (size_t start = 0; start < hits.size(); start += 200) {
    const auto end = min(start + 200, hits.size());
    std::string placeholders;
    vector<std::string> ids;
    for (size_t i = start; i < end; ++i) {
      if (!placeholders.empty())
        placeholders += ",";
      placeholders += "?";
      ids.push_back(hits[i].id);
    }
    vector<std::string> params{session.hash, session.user};
    params.insert(params.end(), ids.begin(), ids.end());
    auto rows = app.db.query(
        "SELECT n.*,t.deleted_at AS trash_deleted_at,r.due_at AS reminder_due_at,"
        "r.delivered AS reminder_delivered,a.opened_at,u.expires_at AS unlock_expires_at "
        "FROM notes n LEFT JOIN trash_entries t ON t.note_id=n.id AND t.user_id=n.user_id "
        "LEFT JOIN reminders r ON r.note_id=n.id AND r.user_id=n.user_id "
        "LEFT JOIN recent_access a ON a.note_id=n.id AND a.user_id=n.user_id "
        "LEFT JOIN note_unlocks u ON u.note_id=n.id AND u.session_hash=? "
        "WHERE n.user_id=? AND n.id IN (" +
            placeholders + ")",
        params);
    for (auto &row : rows) {
      if (flag(row, "locked") && number(row, "unlock_expires_at") <= current)
        continue;
      const auto id = string(row, "id");
      for (auto key : {"created_at", "updated_at", "revision", "opened_at", "unlock_expires_at"})
        row[key] = number(row, key);
      for (auto key : {"pinned", "favorite", "archived", "deleted", "locked"})
        row[key] = flag(row, key);
      row["deleted_at"] = flag(row, "deleted") ? row["trash_deleted_at"] : json(nullptr);
      if (!row["deleted_at"].is_null())
        row["deleted_at"] = number(row, "deleted_at");
      row["trash_expires_at"] = row["deleted_at"].is_null()
                                    ? json(nullptr)
                                    : json(number(row, "deleted_at") + 30LL * 86400000);
      row["reminder"] = row["reminder_due_at"].is_null()
                            ? json(nullptr)
                            : json{{"due_at", number(row, "reminder_due_at")},
                                   {"delivered", flag(row, "reminder_delivered")}};
      row["tags"] = json::array();
      row["attachments"] = json::array();
      row["protected"] = false;
      for (auto key : {"user_id", "trash_deleted_at", "reminder_due_at", "reminder_delivered"})
        row.erase(key);
      if (!flag(row, "locked"))
        row.erase("unlock_expires_at");
      notes[id] = move(row);
    }
    params = {session.user};
    params.insert(params.end(), ids.begin(), ids.end());
    for (auto &tag : app.db.query(
             "SELECT nt.note_id,t.id,t.name FROM note_tags nt JOIN tags t ON t.id=nt.tag_id "
             "AND t.user_id=nt.user_id WHERE nt.user_id=? AND nt.note_id IN (" +
                 placeholders + ") ORDER BY t.name",
             params)) {
      auto i = notes.find(string(tag, "note_id"));
      if (i != notes.end()) {
        tag.erase("note_id");
        i->second["tags"].push_back(move(tag));
      }
    }
    for (auto &attachment : app.db.query(
             "SELECT note_id,id,kind,mime,name,bytes,created_at FROM attachments WHERE user_id=? "
             "AND note_id IN (" +
                 placeholders + ") ORDER BY created_at",
             params)) {
      auto i = notes.find(string(attachment, "note_id"));
      if (i != notes.end()) {
        attachment.erase("note_id");
        i->second["attachments"].push_back(move(attachment));
      }
    }
  }
  json result = json::array();
  for (auto &hit : hits) {
    auto i = notes.find(hit.id);
    if (i == notes.end())
      continue;
    i->second["snippet"] = hit.snippet;
    i->second["score"] = hit.score;
    result.push_back(move(i->second));
  }
  return result;
}

void App::note_routes() {
  route("GET", "/api/notes", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    std::lock_guard lock(mutations);
    json result = json::array();
    for (auto &r :
         db.query("SELECT * FROM notes WHERE user_id=? ORDER BY updated_at DESC, id ASC", {s.user}))
      result.push_back(enrich(r, s));
    return json{
        {"notes", result},
        {"sequence",
         number(
             db.query("SELECT COALESCE(MAX(sequence),0) AS sequence FROM changes WHERE user_id=?",
                      {s.user})[0],
             "sequence")}};
  });
  route("POST", "/api/notes", [&](const httplib::Request &req, httplib::Response &res) {
    auto s = auth(req);
    res.status = 201;
    return save_note(s, json::parse(req.body), true);
  });
  route("PUT", "/api/notes/([a-f0-9-]+)", [&](const httplib::Request &req, httplib::Response &res) {
    auto s = auth(req);
    auto b = json::parse(req.body);
    b["id"] = req.matches[1].str();
    auto result = save_note(s, b, false);
    if (result.value("conflict", false))
      res.status = 409;
    return result;
  });
  route("GET", "/api/notes/([a-f0-9-]+)", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    auto n = note(req.matches[1], s);
    db.query("INSERT INTO recent_access(user_id,note_id,opened_at) VALUES(?,?,?) ON DUPLICATE KEY "
             "UPDATE opened_at=VALUES(opened_at)",
             {s.user, string(n, "id"), std::to_string(now())});
    return enrich(n, s);
  });
  route("POST", "/api/notes/([a-f0-9-]+)/unlock",
        [&](const httplib::Request &req, httplib::Response &) {
          rate_limit(req.remote_addr + "note-unlock");
          auto s = auth(req);
          auto id = id_check(req.matches[1]);
          auto b = json::parse(req.body);
          auto rows = db.query("SELECT * FROM notes WHERE id=? AND user_id=?", {id, s.user});
          if (rows.empty())
            throw Error(404, "Note not found");
          auto u = db.query("SELECT password_hash FROM users WHERE id=?", {s.user});
          if (!password_verify(b.at("password"), string(u[0], "password_hash")))
            throw Error(401, "Password is incorrect");
          db.query("INSERT INTO note_unlocks(session_hash,note_id,expires_at) VALUES(?,?,?) ON "
                   "DUPLICATE KEY UPDATE expires_at=VALUES(expires_at)",
                   {s.hash, id, std::to_string(now() + 10 * 60000)});
          return enrich(rows[0], s);
        });
  route("DELETE", "/api/notes/([a-f0-9-]+)", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    std::lock_guard lock(mutations);
    auto n = note(req.matches[1], s);
    if (!flag(n, "deleted"))
      throw Error(400, "Move the note to Trash before deleting permanently");
    auto id = string(n, "id");
    auto files =
        db.query("SELECT storage_key FROM attachments WHERE note_id=? AND user_id=?", {id, s.user});
    db.transaction([&] {
      change(s.user, id, number(n, "revision") + 1, "delete");
      db.query("DELETE FROM notes WHERE id=? AND user_id=?", {id, s.user});
    });
    index.erase(s.user, id);
    for (auto &file : files)
      std::filesystem::remove(data + "/" + string(file, "storage_key"));
    return json{{"ok", true}};
  });
  route("POST", "/api/notes/([a-f0-9-]+)/duplicate",
        [&](const httplib::Request &req, httplib::Response &) {
          auto s = auth(req);
          auto n = enrich(note(req.matches[1], s), s);
          auto b = n;
          b["id"] = random_hex(18);
          b["title"] = string(n, "title") + " (copy)";
          b["locked"] = false;
          b["deleted"] = false;
          b["archived"] = false;
          b["reminder"] = nullptr;
          auto copy = save_note(s, b, true);
          for (auto &a : n["attachments"]) {
            auto stored = db.query("SELECT * FROM attachments WHERE id=? AND user_id=?",
                                   {string(a, "id"), s.user});
            std::ifstream file(data + "/" + string(stored[0], "storage_key"), std::ios::binary);
            std::stringstream bytes;
            bytes << file.rdbuf();
            upload(s, string(copy, "id"), string(a, "mime"), string(a, "name"), bytes.str());
          }
          return enrich(note(string(copy, "id"), s), s);
        });
  for (auto type : {std::string("folders"), std::string("tags")}) {
    route("GET", "/api/" + type, [&, type](const httplib::Request &req, httplib::Response &) {
      auto s = auth(req);
      return json{{type, db.query("SELECT id,name FROM " + type + " WHERE user_id=? ORDER BY name",
                                  {s.user})}};
    });
    route("POST", "/api/" + type, [&, type](const httplib::Request &req, httplib::Response &) {
      auto s = auth(req);
      auto b = json::parse(req.body);
      std::string name = b.at("name");
      if (name.empty() || name.size() > 80)
        throw Error(400, "Use a name of 1–80 bytes");
      fold(name);
      auto exists =
          db.query("SELECT id,name FROM " + type + " WHERE user_id=? AND name=?", {s.user, name});
      if (!exists.empty())
        return exists[0];
      auto id = random_hex(18);
      db.query("INSERT INTO " + type + "(id,user_id,name) VALUES(?,?,?)", {id, s.user, name});
      return json{{"id", id}, {"name", name}};
    });
    route("PUT", "/api/" + type + "/([a-f0-9-]+)",
          [&, type](const httplib::Request &req, httplib::Response &) {
            auto s = auth(req);
            std::lock_guard lock(mutations);
            auto b = json::parse(req.body);
            std::string name = b.at("name");
            if (name.empty() || name.size() > 80)
              throw Error(400, "Use a name of 1–80 bytes");
            if (db.query("SELECT id FROM " + type + " WHERE id=? AND user_id=?",
                         {req.matches[1], s.user})
                    .empty())
              throw Error(404, "Not found");
            db.query("UPDATE " + type + " SET name=? WHERE id=? AND user_id=?",
                     {name, req.matches[1], s.user});
            rebuild();
            return json{{"ok", true}};
          });
    route("DELETE", "/api/" + type + "/([a-f0-9-]+)",
          [&, type](const httplib::Request &req, httplib::Response &) {
            auto s = auth(req);
            std::lock_guard lock(mutations);
            auto id = req.matches[1].str();
            auto affected =
                type == "folders"
                    ? db.query("SELECT * FROM notes WHERE user_id=? AND folder_id=?", {s.user, id})
                    : db.query("SELECT n.* FROM notes n JOIN note_tags nt ON nt.note_id=n.id WHERE "
                               "nt.user_id=? AND nt.tag_id=?",
                               {s.user, id});
            db.transaction([&] {
              if (type == "folders")
                db.query("UPDATE notes SET folder_id=NULL WHERE folder_id=? AND user_id=?",
                         {id, s.user});
              db.query("DELETE FROM " + type + " WHERE id=? AND user_id=?", {id, s.user});
              for (auto &n : affected) {
                auto nid = string(n, "id");
                db.query("UPDATE notes SET revision=revision+1,updated_at=? WHERE id=?",
                         {std::to_string(now()), nid});
                change(s.user, nid, number(n, "revision") + 1);
              }
            });
            for (auto &n : affected)
              index_note(string(n, "id"));
            return json{{"ok", true}};
          });
  }
  route("POST", "/api/search", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    auto b = json::parse(req.body);
    auto query = parse_query(b.value("query", ""), b.value("filters", json::object()));
    std::lock_guard lock(mutations);
    std::set<std::string> eligible;
    const std::set<std::string> *restriction = nullptr;
    if (query.category == "recent" || query.category == "reminders") {
      const auto sql = query.category == "recent"
        ? "SELECT n.id FROM notes n JOIN recent_access a ON a.note_id=n.id AND a.user_id=n.user_id WHERE n.user_id=? AND n.deleted=0 AND n.archived=0 ORDER BY a.opened_at DESC,n.id ASC LIMIT 5"
        : "SELECT n.id FROM notes n JOIN reminders r ON r.note_id=n.id AND r.user_id=n.user_id WHERE n.user_id=? AND n.deleted=0 AND n.archived=0";
      for (const auto &row : db.query(sql, {s.user})) eligible.insert(string(row, "id"));
      restriction = &eligible;
    }
    auto hits = index.search(s.user, query, unlocks(s), restriction);
    auto result = search_results(*this, s, hits);
    json highlight_terms = query.terms;
    for (auto &phrase : query.phrases)
      for (auto &term : phrase)
        highlight_terms.push_back(term);
    return json{{"results", result},
                {"highlight_terms", highlight_terms},
                {"date_field", "updated_at (UTC)"}};
  });
  route("GET", "/api/searches", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    auto rows =
        db.query("SELECT id,name,query,filters FROM saved_searches WHERE user_id=?", {s.user});
    for (auto &r : rows)
      r["filters"] = json::parse(r["filters"].get<std::string>());
    return json{{"searches", rows}};
  });
  route("POST", "/api/searches", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    auto b = json::parse(req.body);
    std::string name = b.at("name"), query = b.at("query");
    if (name.empty() || name.size() > 80)
      throw Error(400, "Use a name of 1–80 bytes");
    auto filters = b.value("filters", json::object());
    parse_query(query, filters);
    std::lock_guard lock(mutations);
    const auto count = db.query("SELECT COUNT(*) AS total FROM saved_searches WHERE user_id=?", {s.user});
    if (number(count[0], "total") >= 5)
      throw Error(409, "You can save up to 5 searches. Delete one in Settings first.");
    auto id = random_hex();
    db.query("INSERT INTO saved_searches(id,user_id,name,query,filters) VALUES(?,?,?,?,?)",
             {id, s.user, name, query, filters.dump()});
    return json{{"id", id}};
  });
  route("DELETE", "/api/searches/([a-f0-9]+)",
        [&](const httplib::Request &req, httplib::Response &) {
          auto s = auth(req);
          std::lock_guard lock(mutations);
          db.query("DELETE FROM saved_searches WHERE id=? AND user_id=?", {req.matches[1], s.user});
          return json{{"ok", true}};
        });
  route("GET", "/api/sync", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    long long since = 0;
    if (req.has_param("since"))
      since = std::stoll(req.get_param_value("since"));
    std::lock_guard lock(mutations);
    auto changes =
        db.query("SELECT * FROM changes WHERE user_id=? AND sequence>? ORDER BY sequence",
                 {s.user, std::to_string(since)});
    json rows = json::array();
    long long sequence = since;
    std::set<std::string> seen;
    for (auto i = changes.rbegin(); i != changes.rend(); ++i) {
      sequence = std::max(sequence, number(*i, "sequence"));
      auto id = string(*i, "note_id");
      if (!seen.insert(id).second)
        continue;
      auto n = db.query("SELECT * FROM notes WHERE id=? AND user_id=?", {id, s.user});
      rows.push_back({{"id", id}, {"note", n.empty() ? json(nullptr) : enrich(n[0], s)}});
    }
    return json{{"changes", rows}, {"sequence", sequence}};
  });
  route("GET", "/api/reminders/events", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    json result = json::array();
    for (auto &r : db.query("SELECT e.id,e.note_id,e.due_at,n.title,n.locked FROM reminder_events "
                            "e JOIN notes n ON n.id=e.note_id WHERE e.user_id=? AND "
                            "e.acknowledged=0 AND n.deleted=0 AND n.archived=0",
                            {s.user})) {
      if (flag(r, "locked"))
        r["title"] = "Locked note";
      result.push_back(r);
    }
    return json{{"events", result}};
  });
  route("POST", "/api/reminders/events/([a-f0-9]+)/ack",
        [&](const httplib::Request &req, httplib::Response &) {
          auto s = auth(req);
          db.query("UPDATE reminder_events SET acknowledged=1 WHERE id=? AND user_id=?",
                   {req.matches[1], s.user});
          return json{{"ok", true}};
        });
}
} // namespace mk
