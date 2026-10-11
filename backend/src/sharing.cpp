#include "app.hpp"
#include <fstream>
#include <sstream>

namespace mk {
using namespace std;

json App::public_note(const std::string &token) {
  if (token.size() != 64 || token.find_first_not_of("0123456789abcdef") != std::string::npos)
    throw Error(404, "Sharing link is unavailable");
  auto rows =
      db.query("SELECT n.*,s.locked_authorized FROM share_links s JOIN notes n ON n.id=s.note_id "
               "AND n.user_id=s.user_id WHERE s.token_hash=? AND n.deleted=0 AND n.archived=0",
               {sha256(token)});
  if (rows.empty() || (flag(rows[0], "locked") && !flag(rows[0], "locked_authorized")))
    throw Error(404, "Sharing link is unavailable");
  return rows[0];
}

void App::sharing_routes() {
  route("POST", "/api/notes/([a-f0-9-]+)/share",
        [&](const httplib::Request &req, httplib::Response &) {
          auto s = auth(req);
          auto n = note(req.matches[1], s, false);
          if (flag(n, "archived"))
            throw Error(400, "Restore an archived note before sharing");
          auto b = json::parse(req.body);
          if (flag(n, "locked") && !b.value("authorize_locked", false))
            throw Error(400, "Explicitly authorize sharing this locked note");
          auto token = random_hex(32);
          db.query(
              "INSERT INTO share_links(token_hash,note_id,user_id,created_at,locked_authorized) "
              "VALUES(?,?,?,?,?)",
              {sha256(token), string(n, "id"), s.user, std::to_string(now()),
               flag(n, "locked") ? "1" : "0"});
          return json{{"url", url + "/share/" + token}};
        });
  route("GET", "/api/notes/([a-f0-9-]+)/share",
        [&](const httplib::Request &req, httplib::Response &) {
          auto s = auth(req);
          auto n = note(req.matches[1], s);
          auto count =
              db.query("SELECT COUNT(*) AS count FROM share_links WHERE note_id=? AND user_id=?",
                       {string(n, "id"), s.user});
          return json{{"count", number(count[0], "count")}};
        });
  route("DELETE", "/api/notes/([a-f0-9-]+)/share",
        [&](const httplib::Request &req, httplib::Response &) {
          auto s = auth(req);
          auto n = note(req.matches[1], s);
          db.query("DELETE FROM share_links WHERE note_id=? AND user_id=?",
                   {string(n, "id"), s.user});
          return json{{"ok", true}};
        });
  route("GET", "/api/shared/([a-f0-9]+)", [&](const httplib::Request &req, httplib::Response &) {
    auto n = public_note(req.matches[1]);
    json result = {
        {"title", string(n, "title")},
        {"content", string(n, "content")},
        {"updated_at", number(n, "updated_at")},
        {"attachments",
         db.query("SELECT id,kind,mime,name FROM attachments WHERE note_id=? AND user_id=?",
                  {string(n, "id"), string(n, "user_id")})}};
    return result;
  });
  route("GET", "/api/shared/([a-f0-9]+)/attachments/([a-f0-9]+)",
        [&](const httplib::Request &req, httplib::Response &res) {
          auto n = public_note(req.matches[1]);
          auto rows = db.query("SELECT * FROM attachments WHERE id=? AND note_id=? AND user_id=?",
                               {req.matches[2], string(n, "id"), string(n, "user_id")});
          if (rows.empty())
            throw Error(404, "Attachment not found");
          std::ifstream f(data + "/" + string(rows[0], "storage_key"), std::ios::binary);
          if (!f)
            throw Error(404, "Attachment unavailable");
          std::stringstream bytes;
          bytes << f.rdbuf();
          res.set_content(bytes.str(), string(rows[0], "mime"));
          res.set_header("Cache-Control", "no-store");
          return json{};
        });
}
} // namespace mk
