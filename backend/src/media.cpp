#include "app.hpp"
#include <filesystem>
#include <fstream>
#include <sstream>

namespace mk {
using namespace std;

std::string media_kind(const std::string &mime, const std::string &bytes) {
  if (bytes.empty() || bytes.size() > 20 * 1024 * 1024)
    throw Error(400, "Files must be 1 byte–20 MiB");
  auto starts = [&](const std::string &signature) { return bytes.starts_with(signature); };
  if (mime == "image/png" && starts(std::string("\x89PNG\r\n\x1a\n", 8)))
    return "image";
  if (mime == "image/jpeg" && starts(std::string("\xff\xd8\xff", 3)))
    return "image";
  if (mime == "image/gif" && (starts("GIF87a") || starts("GIF89a")))
    return "image";
  if (mime == "image/webp" && starts("RIFF") && bytes.size() > 12 && bytes.substr(8, 4) == "WEBP")
    return "image";
  if ((mime == "audio/webm" || mime == "video/webm") && starts(std::string("\x1a\x45\xdf\xa3", 4)))
    return "audio";
  if (mime == "audio/ogg" && starts("OggS"))
    return "audio";
  if (mime == "audio/wav" && starts("RIFF") && bytes.size() > 12 && bytes.substr(8, 4) == "WAVE")
    return "audio";
  if (mime == "audio/mp4" && bytes.size() > 12 && bytes.substr(4, 4) == "ftyp")
    return "audio";
  throw Error(400, "File type or signature is unsupported. Use PNG, JPEG, GIF, WebP, WebM, Ogg, "
                   "WAV, or MP4 audio");
}

json App::upload(const Session &s, const std::string &noteid, const std::string &mime,
                 const std::string &name, const std::string &bytes,
                 const std::string &operation_id) {
  auto kind = media_kind(mime, bytes);
  if (name.size() > 200)
    throw Error(400, "File name is too long");
  std::lock_guard lock(mutations);
  auto n = note(noteid, s, false);
  if (!operation_id.empty())
    id_check(operation_id);
  auto id = operation_id.empty() ? random_hex()
                                 : sha256(s.user + ":" + noteid + ":" + operation_id).substr(0, 32),
       key = random_hex();
  auto existing = db.query("SELECT * FROM attachments WHERE id=? AND note_id=? AND user_id=?",
                           {id, noteid, s.user});
  if (!existing.empty()) {
    std::ifstream oldfile(data + "/" + string(existing[0], "storage_key"), std::ios::binary);
    std::stringstream oldbytes;
    oldbytes << oldfile.rdbuf();
    if (!oldfile || sha256(oldbytes.str()) != sha256(bytes) || string(existing[0], "mime") != mime)
      throw Error(409, "Upload operation ID already refers to a different file");
    return enrich(n, s);
  }
  std::filesystem::create_directories(data);
  auto path = data + "/" + key;
  std::ofstream f(path, std::ios::binary);
  f.write(bytes.data(), bytes.size());
  f.close();
  if (!f)
    throw Error(500, "Could not store this attachment");
  std::filesystem::permissions(path, std::filesystem::perms::owner_read |
                                         std::filesystem::perms::owner_write);
  try {
    db.transaction([&] {
      db.query(
          "INSERT INTO attachments(id,note_id,user_id,kind,mime,name,storage_key,bytes,created_at) "
          "VALUES(?,?,?,?,?,?,?,?,?)",
          {id, noteid, s.user, kind, mime, name, key, std::to_string(bytes.size()),
           std::to_string(now())});
      db.query("UPDATE notes SET revision=revision+1,updated_at=? WHERE id=? AND user_id=?",
               {std::to_string(now()), noteid, s.user});
      change(s.user, noteid, number(n, "revision") + 1);
    });
  } catch (...) {
    std::filesystem::remove(path);
    throw;
  }
  index_note(noteid);
  return enrich(note(noteid, s), s);
}

void App::media_routes() {
  route("POST", "/api/notes/([a-f0-9-]+)/attachments",
        [&](const httplib::Request &req, httplib::Response &res) {
          auto s = auth(req);
          if (!req.is_multipart_form_data() || !req.has_file("file"))
            throw Error(400, "Choose a file");
          auto file = req.get_file_value("file");
          auto mime = file.content_type;
          auto semicolon = mime.find(';');
          if (semicolon != std::string::npos)
            mime.resize(semicolon);
          res.status = 201;
          return upload(s, req.matches[1], mime, file.filename, file.content,
                        req.get_header_value("X-Upload-ID"));
        });
  route("GET", "/api/attachments/([a-f0-9]+)",
        [&](const httplib::Request &req, httplib::Response &res) {
          auto s = auth(req);
          auto rows = db.query("SELECT * FROM attachments WHERE id=? AND user_id=?",
                               {req.matches[1], s.user});
          if (rows.empty())
            throw Error(404, "Attachment not found");
          note(string(rows[0], "note_id"), s, false);
          std::ifstream f(data + "/" + string(rows[0], "storage_key"), std::ios::binary);
          if (!f)
            throw Error(404, "Attachment file is unavailable");
          std::stringstream bytes;
          bytes << f.rdbuf();
          res.set_content(bytes.str(), string(rows[0], "mime"));
          res.set_header("Cache-Control", "no-store");
          res.set_header("Content-Disposition", "inline");
          return json{};
        });
  route("DELETE", "/api/attachments/([a-f0-9]+)",
        [&](const httplib::Request &req, httplib::Response &) {
          auto s = auth(req);
          std::lock_guard lock(mutations);
          auto rows = db.query("SELECT * FROM attachments WHERE id=? AND user_id=?",
                               {req.matches[1], s.user});
          if (rows.empty())
            throw Error(404, "Attachment not found");
          auto id = string(rows[0], "note_id");
          auto n = note(id, s);
          db.transaction([&] {
            db.query("DELETE FROM attachments WHERE id=? AND user_id=?", {req.matches[1], s.user});
            db.query("UPDATE notes SET revision=revision+1,updated_at=? WHERE id=? AND user_id=?",
                     {std::to_string(now()), id, s.user});
            change(s.user, id, number(n, "revision") + 1);
          });
          std::filesystem::remove(data + "/" + string(rows[0], "storage_key"));
          index_note(id);
          return enrich(note(id, s), s);
        });
}
} // namespace mk
