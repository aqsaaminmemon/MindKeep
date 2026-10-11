#include "app.hpp"
#include <fcntl.h>
#include <filesystem>
#include <fstream>
#include <list>
#include <queue>
#include <signal.h>
#include <spawn.h>
#include <sstream>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
extern char **environ;

namespace mk {
using namespace std;

std::string media_kind(const std::string &, const std::string &);

static std::string read_file(const std::string &path) {
  std::ifstream f(path, std::ios::binary);
  if (!f)
    throw Error(404, "An attachment file is missing");
  std::stringstream s;
  s << f.rdbuf();
  return s.str();
}

static std::string export_html(const json &n, const json &media) {
  std::string html =
      "<!doctype html><html><head><meta charset=\"utf-8\"><title>" +
      escape_html(string(n, "title", "Note")) +
      "</title><style>body{font:16px "
      "Arial,sans-serif;color:#172744;margin:36px;line-height:1.6;overflow-wrap:anywhere}h1,h2,h3{"
      "break-after:avoid}img{max-width:100%;max-height:700px;object-fit:contain}li[data-checked='"
      "true']{text-decoration:line-through}li[data-checked='true']::marker{content:'☑ "
      "'}li[data-checked='false']::marker{content:'☐ "
      "'}audio{width:100%}@page{size:A4;margin:18mm}@media "
      "print{body{margin:0}audio{display:none}}</style></head><body><h1>" +
      escape_html(string(n, "title")) + "</h1>" + string(n, "content");
  for (auto &a : media) {
    auto uri = "data:" + string(a, "mime") + ";base64," + string(a, "data");
    if (string(a, "kind") == "image")
      html += "<figure><img alt=\"" + escape_html(string(a, "name")) + "\" src=\"" + uri +
              "\"></figure>";
    else
      html += "<p>Audio: " + escape_html(string(a, "name")) + "</p><audio controls src=\"" + uri +
              "\"></audio>";
  }
  return html + "</body></html>";
}

static std::string render_pdf(const std::string &html, const std::string &root) {
  auto dir = std::filesystem::absolute(root + "/pdf-" + random_hex()).string();
  std::filesystem::create_directories(dir);
  std::filesystem::permissions(dir, std::filesystem::perms::owner_all);
  auto cleanup = [&] { std::filesystem::remove_all(dir); };
  try {
    auto input = dir + "/note.html", output = dir + "/note.pdf";
    std::ofstream(input) << html;
    auto executable = env("MINDKEEP_PDF_BROWSER", "/usr/bin/google-chrome");
    std::vector<std::string> args = {executable,
                                     "--headless",
                                     "--disable-gpu",
                                     "--disable-background-networking",
                                     "--no-first-run",
                                     "--no-pdf-header-footer",
                                     "--user-data-dir=" + dir + "/profile",
                                     "--print-to-pdf=" + output,
                                     "file://" + input};
    std::vector<char *> argv;
    for (auto &arg : args)
      argv.push_back(arg.data());
    argv.push_back(nullptr);
    pid_t pid;
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_addopen(&actions, 1, "/dev/null", O_WRONLY, 0);
    posix_spawn_file_actions_addopen(&actions, 2, "/dev/null", O_WRONLY, 0);
    int code = posix_spawn(&pid, executable.c_str(), &actions, nullptr, argv.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    if (code)
      throw Error(503, "PDF browser is unavailable. Configure MINDKEEP_PDF_BROWSER");
    int status = 0;
    bool finished = false;
    for (int i = 0; i < 200; i++) {
      if (waitpid(pid, &status, WNOHANG) == pid) {
        finished = true;
        break;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    if (!finished) {
      kill(pid, SIGKILL);
      waitpid(pid, &status, 0);
      throw Error(503, "PDF rendering timed out");
    }
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0 || !std::filesystem::exists(output))
      throw Error(503, "PDF renderer failed. Check browser sandbox availability");
    auto pdf = read_file(output);
    if (!pdf.starts_with("%PDF-"))
      throw Error(503, "PDF renderer produced invalid output");
    cleanup();
    return pdf;
  } catch (...) {
    cleanup();
    throw;
  }
}

void App::backup_routes() {
  route("GET", "/api/notes/([a-f0-9-]+)/export",
        [&](const httplib::Request &req, httplib::Response &res) {
          auto s = auth(req);
          auto n = note(req.matches[1], s);
          auto format = req.has_param("format") ? req.get_param_value("format") : "txt";
          json media = json::array();
          for (auto &a : db.query("SELECT * FROM attachments WHERE note_id=? AND user_id=?",
                                  {string(n, "id"), s.user})) {
            a["data"] = base64(read_file(data + "/" + string(a, "storage_key")));
            media.push_back(a);
          }
          std::string content, mime;
          if (format == "txt" || format == "md") {
            content = string(n, "title") + "\n\n" +
                      (format == "md" ? markdown(string(n, "content")) : string(n, "plain_text"));
            for (auto &a : media)
              content += "\n[" + string(a, "kind") + ": " + string(a, "name") + "]";
            mime = "text/plain; charset=utf-8";
          } else if (format == "html") {
            content = export_html(n, media);
            mime = "text/html; charset=utf-8";
          } else if (format == "pdf") {
            content = render_pdf(export_html(n, media), data);
            mime = "application/pdf";
          } else {
            throw Error(400, "Choose txt, md, html, or pdf");
          }
          res.set_content(content, mime);
          res.set_header("Content-Disposition",
                         "attachment; filename=\"mindkeep-note." + format + "\"");
          res.set_header("Cache-Control", "no-store");
          return json{};
        });
  route("POST", "/api/backup", [&](const httplib::Request &req, httplib::Response &res) {
    rate_limit(req.remote_addr + "backup");
    auto s = auth(req);
    auto b = json::parse(req.body);
    auto u = db.query("SELECT password_hash FROM users WHERE id=?", {s.user});
    if (!password_verify(b.at("password"), string(u[0], "password_hash")))
      throw Error(401, "Password is incorrect");
    std::lock_guard lock(mutations);
    json backup = {{"format", "mindkeep-library"},
                   {"version", 1},
                   {"created_at", now()},
                   {"folders", db.query("SELECT id,name FROM folders WHERE user_id=?", {s.user})},
                   {"tags", db.query("SELECT id,name FROM tags WHERE user_id=?", {s.user})},
                   {"notes", json::array()},
                   {"searches", json::array()}};
    size_t bytes = 0;
    for (auto n : db.query("SELECT * FROM notes WHERE user_id=?", {s.user})) {
      n = enrich(n, s, false);
      n.erase("opened_at");
      n.erase("protected");
      for (auto &a : n["attachments"]) {
        auto rows = db.query("SELECT storage_key FROM attachments WHERE id=? AND user_id=?",
                             {string(a, "id"), s.user});
        auto file = read_file(data + "/" + string(rows[0], "storage_key"));
        bytes += file.size();
        if (bytes > 40 * 1024 * 1024)
          throw Error(413, "Library exceeds the 40 MiB backup media limit");
        a["data"] = base64(file);
      }
      backup["notes"].push_back(n);
    }
    for (auto r :
         db.query("SELECT name,query,filters FROM saved_searches WHERE user_id=?", {s.user})) {
      r["filters"] = json::parse(string(r, "filters"));
      backup["searches"].push_back(r);
    }
    res.set_content(backup.dump(2), "application/json");
    res.set_header("Content-Disposition", "attachment; filename=\"mindkeep-backup.json\"");
    res.set_header("Cache-Control", "no-store");
    return json{};
  });
  route("POST", "/api/restore", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    auto b = json::parse(req.body);
    if (b.value("format", "") != "mindkeep-library" || b.value("version", 0) != 1)
      throw Error(400, "Unsupported backup format or version");
    for (auto key : {"folders", "tags", "notes", "searches"})
      if (!b.contains(key) || !b[key].is_array())
        throw Error(400, "Backup is missing an array: " + std::string(key));
    if (b["notes"].size() > 10000)
      throw Error(413, "Backup exceeds 10,000 notes");
    std::map<std::string, std::string> folders, tags;
    for (auto key : {"folders", "tags"}) {
      std::set<std::string> ids;
      for (auto &item : b[key]) {
        auto id = id_check(item.at("id"));
        std::string name = item.at("name");
        if (name.empty() || name.size() > 80 || !ids.insert(id).second)
          throw Error(400, "Invalid or duplicate organization item");
        fold(name);
        (std::string(key) == "folders" ? folders : tags)[id] = random_hex(18);
      }
    }
    size_t bytes = 0;
    std::set<std::string> ids;
    // Append decoded attachments without reallocating the staging container.
    list<pair<std::string, std::string>> files;
    for (auto &n : b["notes"]) {
      auto id = id_check(n.at("id"));
      if (!ids.insert(id).second)
        throw Error(400, "Duplicate note ID in backup");
      std::string title = n.at("title"), content = n.at("content");
      if (title.size() > 500)
        throw Error(400, "Invalid note title");
      n["content"] = sanitize_html(content);
      fold(title);
      fold(plain_text(n["content"]));
      for (auto key : {"pinned", "favorite", "archived", "deleted", "locked"})
        if (!n.at(key).is_boolean())
          throw Error(400, "Invalid note state");
      if (!std::set<std::string>{"white", "blue", "violet", "peach", "mint", "yellow"}.contains(
              n.value("color", "white")))
        throw Error(400, "Invalid note color");
      auto fid = string(n, "folder_id");
      if (!fid.empty() && !folders.contains(fid))
        throw Error(400, "Missing folder in backup");
      if (!n.at("tags").is_array() || !n.at("attachments").is_array())
        throw Error(400, "Invalid note metadata");
      for (auto &t : n["tags"])
        if (!tags.contains(string(t, "id")))
          throw Error(400, "Missing tag in backup");
      if (!n.at("reminder").is_null() && number(n["reminder"], "due_at") <= 0)
        throw Error(400, "Invalid reminder");
      if (number(n, "created_at") <= 0 || number(n, "updated_at") < number(n, "created_at"))
        throw Error(400, "Invalid timestamps");
      for (auto &a : n["attachments"]) {
        auto decoded = unbase64(a.at("data"));
        auto kind = media_kind(string(a, "mime"), decoded);
        if (string(a, "name").size() > 200 || string(a, "kind") != kind)
          throw Error(400, "Invalid attachment metadata");
        bytes += decoded.size();
        if (bytes > 40 * 1024 * 1024)
          throw Error(413, "Backup media exceeds 40 MiB");
        auto key = random_hex();
        a["new_key"] = key;
        a["bytes"] = decoded.size();
        files.emplace_back(key, std::move(decoded));
      }
    }
    for (auto &r : b["searches"]) {
      std::string name = r.at("name");
      if (name.empty() || name.size() > 80)
        throw Error(400, "Invalid saved search name");
      parse_query(r.at("query"), r.at("filters"));
    }
    std::lock_guard lock(mutations);
    vector<std::string> written;
    // Restore indexing follows the same FIFO order as the imported notes.
    queue<std::string> noteids;
    size_t restored_notes = 0;
    try {
      for (auto &[key, file] : files) {
        auto path = data + "/" + key;
        std::ofstream out(path, std::ios::binary);
        out.write(file.data(), file.size());
        out.close();
        if (!out)
          throw Error(500, "Could not restore media");
        written.push_back(path);
        std::filesystem::permissions(path, std::filesystem::perms::owner_read |
                                               std::filesystem::perms::owner_write);
      }
      db.transaction([&] {
        for (auto key : {"folders", "tags"})
          for (auto &item : b[key]) {
            auto &map = std::string(key) == "folders" ? folders : tags;
            auto existing =
                db.query("SELECT id FROM " + std::string(key) + " WHERE user_id=? AND name=?",
                         {s.user, string(item, "name")});
            if (!existing.empty())
              map[string(item, "id")] = string(existing[0], "id");
            else
              db.query("INSERT INTO " + std::string(key) + "(id,user_id,name) VALUES(?,?,?)",
                       {map.at(string(item, "id")), s.user, string(item, "name")});
          }
        for (auto &n : b["notes"]) {
          auto id = random_hex(18), fid = string(n, "folder_id");
          noteids.push(id);
          db.query("INSERT INTO "
                   "notes(id,user_id,title,content,plain_text,folder_id,pinned,favorite,archived,"
                   "deleted,locked,color,created_at,updated_at,revision) "
                   "VALUES(?,?,?,?,?,NULLIF(?,''),?,?,?,?,?,?,?,?,1)",
                   {id, s.user, string(n, "title"), string(n, "content"),
                    plain_text(string(n, "content")), fid.empty() ? "" : folders.at(fid),
                    flag(n, "pinned") ? "1" : "0", flag(n, "favorite") ? "1" : "0",
                    flag(n, "archived") ? "1" : "0", flag(n, "deleted") ? "1" : "0",
                    flag(n, "locked") ? "1" : "0", n.value("color", "white"),
                    std::to_string(number(n, "created_at")),
                    std::to_string(number(n, "updated_at"))});
          for (auto &t : n["tags"])
            db.query("INSERT IGNORE INTO note_tags(note_id,tag_id,user_id) VALUES(?,?,?)",
                     {id, tags.at(string(t, "id")), s.user});
          if (!n["reminder"].is_null())
            db.query("INSERT INTO reminders(note_id,user_id,due_at) VALUES(?,?,?)",
                     {id, s.user, std::to_string(number(n["reminder"], "due_at"))});
          for (auto &a : n["attachments"])
            db.query("INSERT INTO "
                     "attachments(id,note_id,user_id,kind,mime,name,storage_key,bytes,created_at) "
                     "VALUES(?,?,?,?,?,?,?,?,?)",
                     {random_hex(), id, s.user, string(a, "kind"), string(a, "mime"),
                      string(a, "name"), string(a, "new_key"), std::to_string(number(a, "bytes")),
                      std::to_string(now())});
          change(s.user, id, 1);
        }
        for (auto &r : b["searches"])
          db.query(
              "INSERT INTO saved_searches(id,user_id,name,query,filters) VALUES(?,?,?,?,?)",
              {random_hex(), s.user, string(r, "name"), string(r, "query"), r["filters"].dump()});
      });
      restored_notes = noteids.size();
      while (!noteids.empty()) {
        index_note(noteids.front());
        noteids.pop();
      }
    } catch (...) {
      for (auto &path : written)
        std::filesystem::remove(path);
      throw;
    }
    return json{
        {"restored_notes", restored_notes},
        {"restored_attachments", files.size()},
        {"restored_folders", folders.size()},
        {"restored_tags", tags.size()},
        {"warnings", json::array()},
        {"message",
         "Imported as new notes. Existing notes were preserved; sharing links were not restored."}};
  });
}
} // namespace mk
