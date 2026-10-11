#include "app.hpp"
#include <csignal>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <thread>

namespace mk {
using namespace std;

void App::respond(httplib::Response &res, const json &body, int status) {
  res.status = status;
  res.set_content(body.dump(), "application/json; charset=utf-8");
  res.set_header("Cache-Control", "no-store");
}

void App::route(const std::string &method, const std::string &path,
                const std::function<json(const httplib::Request &, httplib::Response &)> &fn) {
  auto handler = [this, fn](const httplib::Request &req, httplib::Response &res) {
    try {
      auto body = fn(req, res);
      if (res.body.empty() && res.status != 302)
        respond(res, body, res.status);
    } catch (const Error &e) {
      respond(res, {{"error", e.what()}}, e.status);
    } catch (const json::exception &) {
      respond(res, {{"error", "Invalid request data"}}, 400);
    } catch (const std::invalid_argument &e) {
      respond(res, {{"error", e.what()}}, 400);
    } catch (const std::exception &e) {
      std::cerr << "Request failed: " << req.method << "; error category " << typeid(e).name()
                << "\n";
      respond(res, {{"error", "The operation could not be completed. Please retry."}}, 500);
    }
  };
  if (method == "GET")
    server.Get(path, handler);
  else if (method == "POST")
    server.Post(path, handler);
  else if (method == "PUT")
    server.Put(path, handler);
  else if (method == "DELETE")
    server.Delete(path, handler);
}

void App::change(const std::string &owner, const std::string &id, long long revision,
                 const std::string &operation) {
  db.query("INSERT INTO changes(user_id,note_id,revision,operation,changed_at) VALUES(?,?,?,?,?)",
           {owner, id, std::to_string(revision), operation, std::to_string(now())});
}

void App::reminder_tick() {
  std::lock_guard lock(mutations);
  db.transaction([&] {
    auto due = db.query("SELECT r.* FROM reminders r JOIN notes n ON n.id=r.note_id WHERE "
                        "r.delivered=0 AND r.due_at<=? AND n.deleted=0 AND n.archived=0",
                        {std::to_string(now())});
    for (auto &r : due) {
      db.query("INSERT IGNORE INTO reminder_events(id,note_id,user_id,due_at) VALUES(?,?,?,?)",
               {random_hex(), string(r, "note_id"), string(r, "user_id"), string(r, "due_at")});
      db.query("UPDATE reminders SET delivered=1 WHERE note_id=? AND due_at=?",
               {string(r, "note_id"), string(r, "due_at")});
    }
  });
}
} // namespace mk

int main() {
  using namespace mk;
  try {
    App app;
    app.db.migrate("database/migrations/001_initial.sql");
    std::filesystem::create_directories(app.data);
    app.trash_tick();
    app.rebuild();
    app.server.set_payload_max_length(70 * 1024 * 1024);
    app.server.set_read_timeout(20);
    app.server.set_write_timeout(20);
    app.server.set_pre_routing_handler([&](const httplib::Request &req, httplib::Response &res) {
      res.set_header("X-Content-Type-Options", "nosniff");
      res.set_header("Referrer-Policy", "no-referrer");
      res.set_header("X-Frame-Options", "DENY");
      res.set_header(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' "
          "blob: data:; media-src 'self' blob: data:; connect-src 'self'; frame-src 'self'; "
          "object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      res.set_header("Cache-Control", "no-cache");
      if (req.path.starts_with("/api") || req.path.starts_with("/share/"))
        res.set_header("Cache-Control", "no-store");
      if (req.method != "GET" && req.method != "HEAD" && req.method != "OPTIONS") {
        auto origin = req.get_header_value("Origin");
        auto site = req.get_header_value("Sec-Fetch-Site");
        if ((!origin.empty() && origin != app.url) || site == "cross-site") {
          app.respond(res, {{"error", "Request origin is not allowed"}}, 403);
          return httplib::Server::HandlerResponse::Handled;
        }
      }
      return httplib::Server::HandlerResponse::Unhandled;
    });
    app.route("GET", "/api/health", [&](const httplib::Request &, httplib::Response &) {
      app.db.query("SELECT 1");
      return json{{"status", "ok"}, {"backend", "C++20"}, {"storage", "MySQL"}};
    });
    app.auth_routes();
    app.note_routes();
    app.media_routes();
    app.sharing_routes();
    app.backup_routes();
    auto frontend = env("MINDKEEP_FRONTEND", "frontend");
    if (!app.server.set_mount_point("/", frontend))
      throw std::runtime_error("Frontend directory missing");
    app.server.Get("/share/[a-f0-9]+", [&](const httplib::Request &, httplib::Response &res) {
      std::ifstream file(frontend + "/index.html");
      std::stringstream content;
      content << file.rdbuf();
      res.set_content(content.str(), "text/html");
    });
    std::jthread reminders([&](std::stop_token stop) {
      while (!stop.stop_requested()) {
        try {
          app.reminder_tick();
          app.trash_tick();
        } catch (...) {
          std::cerr << "Background cleanup scheduler will retry\n";
        }
        for (int i = 0; i < 10 && !stop.stop_requested(); i++)
          std::this_thread::sleep_for(std::chrono::seconds(1));
      }
    });
    std::cout << "MindKeep ready at " << app.url << std::endl;
    if (!app.server.listen(env("MINDKEEP_HOST", "127.0.0.1"),
                           std::stoi(env("MINDKEEP_PORT", "8080"))))
      throw std::runtime_error("Cannot bind HTTP listener");
  } catch (const std::exception &e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
}
