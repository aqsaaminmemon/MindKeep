#include "app.hpp"
#include <cstdio>
#include <regex>

namespace mk {
using namespace std;

void App::validate_password(const std::string &p) {
  if (p.size() < 10 || p.size() > 256)
    throw Error(400, "Use a password with 10–256 bytes");
}

json App::user(const std::string &id) {
  auto u = db.query("SELECT id,email,name,offline_salt FROM users WHERE id=?", {id});
  if (u.empty())
    throw Error(401, "Please sign in");
  return u[0];
}

Session App::auth(const httplib::Request &req, bool allow_locked) {
  std::string token;
  auto cookies = req.get_header_value("Cookie");
  std::smatch m;
  if (std::regex_search(cookies, m, std::regex("(?:^|;\\s*)mindkeep=([a-f0-9]{64})(?:;|$)")))
    token = m[1];
  if (token.empty())
    throw Error(401, "Please sign in");
  auto hash = sha256(token);
  auto rows = db.query("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?",
                       {hash, std::to_string(now())});
  if (rows.empty())
    throw Error(401, "Your session expired. Please sign in");
  auto &r = rows[0];
  Session s{hash, string(r, "user_id"), string(r, "csrf"), flag(r, "locked")};
  if (req.path != "/api/auth/session" && !req.path.starts_with("/api/attachments/") &&
      req.get_header_value("X-Account-ID") != s.user)
    throw Error(401, "The account changed in another tab. Sign in again to protect your drafts");
  auto idle = number(r, "idle_minutes");
  if (idle > 0 && now() - number(r, "last_active") >= idle * 60000) {
    s.locked = true;
    db.query("UPDATE sessions SET locked=1 WHERE token_hash=?", {hash});
    db.query("DELETE FROM note_unlocks WHERE session_hash=?", {hash});
  }
  if (req.method != "GET" && req.method != "HEAD" && req.get_header_value("X-CSRF-Token") != s.csrf)
    throw Error(403, "Refresh the page and try again");
  if (s.locked && !allow_locked)
    throw Error(423, "MindKeep is locked");
  return s;
}

void rate_limit(const std::string &key) {
  static std::mutex mutex;
  static std::unordered_map<std::string, std::pair<long long, int>> counts;
  std::lock_guard lock(mutex);
  auto &c = counts[key];
  if (now() - c.first > 60000)
    c = {now(), 0};
  if (++c.second > 12)
    throw Error(429, "Too many attempts. Please wait a minute");
  if (counts.size() > 10000)
    counts.clear();
}

void App::auth_routes() {
  auto login = [this](const httplib::Request &req, httplib::Response &res, bool registration) {
    rate_limit(req.remote_addr);
    auto b = json::parse(req.body);
    auto email = fold(b.at("email").get<std::string>());
    auto password = b.at("password").get<std::string>();
    validate_password(password);
    if (email.size() > 254 || !std::regex_match(email, std::regex("[^@\\s]+@[^@\\s]+\\.[^@\\s]+")))
      throw Error(400, "Enter a valid email address");
    std::string uid;
    if (registration) {
      auto name = b.value("name", "");
      if (name.empty() || name.size() > 80)
        throw Error(400, "Enter a name up to 80 bytes");
      if (!db.query("SELECT id FROM users WHERE email=?", {email}).empty())
        throw Error(409, "An account with this email already exists");
      uid = random_hex();
      db.query("INSERT INTO users(id,email,name,password_hash,offline_salt,created_at) "
               "VALUES(?,?,?,?,?,?)",
               {uid, email, name, password_hash(password), random_hex(), std::to_string(now())});
    } else {
      auto users = db.query("SELECT * FROM users WHERE email=?", {email});
      if (users.empty() || !password_verify(password, string(users[0], "password_hash")))
        throw Error(401, "Email or password is incorrect");
      uid = string(users[0], "id");
    }
    auto token = random_hex(32), csrf = random_hex(32);
    db.query(
        "INSERT INTO sessions(token_hash,user_id,csrf,expires_at,last_active) VALUES(?,?,?,?,?)",
        {sha256(token), uid, csrf, std::to_string(now() + 7LL * 86400000), std::to_string(now())});
    res.set_header("Set-Cookie", "mindkeep=" + token +
                                     "; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800" +
                                     (env("MINDKEEP_SECURE_COOKIE") == "1" ? "; Secure" : ""));
    return json{{"user", user(uid)}, {"csrf", csrf}, {"idle_minutes", 15}};
  };
  route("POST", "/api/auth/register",
        [=](const httplib::Request &req, httplib::Response &res) { return login(req, res, true); });
  route("POST", "/api/auth/login", [=](const httplib::Request &req, httplib::Response &res) {
    return login(req, res, false);
  });
  route("GET", "/api/auth/session", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req, true);
    auto r = db.query("SELECT idle_minutes FROM sessions WHERE token_hash=?", {s.hash});
    return json{{"user", user(s.user)},
                {"csrf", s.csrf},
                {"locked", s.locked},
                {"idle_minutes", number(r[0], "idle_minutes")}};
  });
  route("POST", "/api/auth/logout", [&](const httplib::Request &req, httplib::Response &res) {
    auto s = auth(req, true);
    db.query("DELETE FROM sessions WHERE token_hash=?", {s.hash});
    res.set_header("Set-Cookie", "mindkeep=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    return json{{"ok", true}};
  });
  route("POST", "/api/auth/lock", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req, true);
    db.transaction([&] {
      db.query("UPDATE sessions SET locked=1 WHERE token_hash=?", {s.hash});
      db.query("DELETE FROM note_unlocks WHERE session_hash=?", {s.hash});
    });
    return json{{"ok", true}};
  });
  route("POST", "/api/auth/unlock", [&](const httplib::Request &req, httplib::Response &) {
    rate_limit(req.remote_addr + "unlock");
    auto s = auth(req, true);
    auto b = json::parse(req.body);
    auto u = db.query("SELECT password_hash FROM users WHERE id=?", {s.user});
    if (!password_verify(b.at("password"), string(u[0], "password_hash")))
      throw Error(401, "Password is incorrect");
    db.query("UPDATE sessions SET locked=0,last_active=? WHERE token_hash=?",
             {std::to_string(now()), s.hash});
    return json{{"ok", true}};
  });
  route("POST", "/api/auth/activity", [&](const httplib::Request &req, httplib::Response &) {
    auto s = auth(req);
    auto b = json::parse(req.body);
    if (b.contains("idle_minutes")) {
      int minutes = b["idle_minutes"];
      if (minutes < 1 || minutes > 120)
        throw Error(400, "Choose 1–120 minutes");
      db.query("UPDATE sessions SET idle_minutes=? WHERE token_hash=?",
               {std::to_string(minutes), s.hash});
    }
    db.query("UPDATE sessions SET last_active=? WHERE token_hash=?",
             {std::to_string(now()), s.hash});
    return json{{"ok", true}};
  });
  route("POST", "/api/auth/reset-request", [&](const httplib::Request &req, httplib::Response &) {
    rate_limit(req.remote_addr + "reset");
    auto command = env("MINDKEEP_MAIL_COMMAND");
    if (command.empty())
      throw Error(503, "Password reset email is not configured. Contact the server administrator");
    auto b = json::parse(req.body);
    auto email = fold(b.at("email").get<std::string>());
    const bool code_mode = b.value("format", "link") == "code";
    auto request_id = random_hex(32);
    auto users = db.query("SELECT id FROM users WHERE email=?", {email});
    if (!users.empty()) {
      auto uid = string(users[0], "id"), token = random_hex(32);
      std::string body;
      if (code_mode) {
        unsigned long raw;
        do {
          raw = std::stoul(random_hex(4), nullptr, 16);
        } while (raw >= 4294000000UL);
        const auto code = std::to_string(1000000UL + raw % 1000000UL).substr(1);
        {
          std::lock_guard lock(mutations);
          db.transaction([&] {
            db.query("DELETE FROM reset_codes WHERE user_id=? OR expires_at<?",
                     {uid, std::to_string(now())});
            db.query("DELETE FROM reset_tokens WHERE user_id=?", {uid});
            db.query("INSERT INTO reset_codes(request_hash,user_id,code_hash,expires_at) "
                     "VALUES(?,?,?,?)",
                     {sha256(request_id), uid, sha256(request_id + ":" + code),
                      std::to_string(now() + 10 * 60000)});
          });
        }
        body = "Your MindKeep verification code is: " + code +
               "\nEnter it in MindKeep within 10 minutes, then choose a new password.\nIf you did "
               "not request this, ignore this email.";
      } else {
        std::lock_guard lock(mutations);
        db.query("DELETE FROM reset_tokens WHERE user_id=?", {uid});
        db.query("INSERT INTO reset_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)",
                 {sha256(token), uid, std::to_string(now() + 30 * 60000)});
        body = "Use this link within 30 minutes: " + url + "/#reset=" + token +
               "\nIf you did not request this, ignore this email.";
      }
      auto mail = json{
          {"to", email},
          {"subject",
           code_mode ? "Your MindKeep verification code" : "Reset your MindKeep password"},
          {"text",
           body}}.dump();
      FILE *pipe = popen(command.c_str(), "w");
      if (!pipe) {
        db.query("DELETE FROM reset_codes WHERE request_hash=?", {sha256(request_id)});
        db.query("DELETE FROM reset_tokens WHERE token_hash=?", {sha256(token)});
        throw Error(503, "Email delivery is unavailable");
      }
      auto written = fwrite(mail.data(), 1, mail.size(), pipe);
      int code = pclose(pipe);
      if (written != mail.size() || code != 0) {
        db.query("DELETE FROM reset_codes WHERE request_hash=?", {sha256(request_id)});
        db.query("DELETE FROM reset_tokens WHERE token_hash=?", {sha256(token)});
        throw Error(503, "Email delivery failed. Please retry later");
      }
    }
    if (code_mode)
      return json{{"request_id", request_id},
                  {"message", "If this account exists, a verification code has been sent. Check "
                              "your inbox and spam folder."}};
    return json{{"message", "If this account exists, a reset email has been sent."}};
  });
  route("POST", "/api/auth/reset-verify", [&](const httplib::Request &req, httplib::Response &) {
    rate_limit(req.remote_addr + "reset-verify");
    auto b = json::parse(req.body);
    const auto request_id = b.value("request_id", ""), code = b.value("code", "");
    if (request_id.size() != 64 || !std::regex_match(code, std::regex("[0-9]{6}")))
      throw Error(400, "Enter the six-digit code from your email");
    std::lock_guard lock(mutations);
    std::string token;
    db.transaction([&] {
      auto rows = db.query("SELECT user_id,code_hash,attempts FROM reset_codes WHERE "
                           "request_hash=? AND expires_at>? FOR UPDATE",
                           {sha256(request_id), std::to_string(now())});
      if (rows.empty())
        return;
      if (number(rows[0], "attempts") >= 5)
        return;
      if (string(rows[0], "code_hash") != sha256(request_id + ":" + code)) {
        db.query("UPDATE reset_codes SET attempts=attempts+1 WHERE request_hash=?",
                 {sha256(request_id)});
        return;
      }
      token = random_hex(32);
      auto uid = string(rows[0], "user_id");
      db.query("DELETE FROM reset_codes WHERE user_id=?", {uid});
      db.query("DELETE FROM reset_tokens WHERE user_id=?", {uid});
      db.query("INSERT INTO reset_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)",
               {sha256(token), uid, std::to_string(now() + 10 * 60000)});
    });
    if (token.empty())
      throw Error(
          400, "This code is incorrect, expired, or already used. Request a new code if needed.");
    return json{{"token", token}};
  });
  route("POST", "/api/auth/reset", [&](const httplib::Request &req, httplib::Response &) {
    rate_limit(req.remote_addr + "reset-replace");
    auto b = json::parse(req.body);
    std::string password = b.at("password"), token = b.at("token");
    validate_password(password);
    if (token.size() != 64)
      throw Error(400, "Invalid reset token");
    std::lock_guard lock(mutations);
    db.transaction([&] {
      auto tokens = db.query(
          "SELECT user_id FROM reset_tokens WHERE token_hash=? AND expires_at>? FOR UPDATE",
          {sha256(token), std::to_string(now())});
      if (tokens.empty())
        throw Error(400, "This reset link is invalid, expired, or already used");
      auto uid = string(tokens[0], "user_id");
      db.query("UPDATE users SET password_hash=?,offline_salt=? WHERE id=?",
               {password_hash(password), random_hex(), uid});
      db.query("DELETE FROM reset_tokens WHERE user_id=?", {uid});
      db.query("DELETE FROM sessions WHERE user_id=?", {uid});
      db.query("DELETE FROM reset_codes WHERE user_id=?", {uid});
    });
    return json{{"ok", true}};
  });
}
} // namespace mk
