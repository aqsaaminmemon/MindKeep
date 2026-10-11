#include "app.hpp"
#include <fstream>
#include <iostream>
#include <sstream>

namespace mk {
using namespace std;

std::string env(const char *key, const std::string &fallback) {
  auto v = std::getenv(key);
  return v ? v : fallback;
}

Database::Database() {
  connection = mysql_init(nullptr);
  unsigned int timeout = 5;
  mysql_options(connection, MYSQL_OPT_CONNECT_TIMEOUT, &timeout);
  if (!mysql_real_connect(
          connection, env("MINDKEEP_DB_HOST", "127.0.0.1").c_str(),
          env("MINDKEEP_DB_USER", "mindkeep").c_str(), env("MINDKEEP_DB_PASSWORD").c_str(),
          env("MINDKEEP_DB_NAME", "mindkeep").c_str(), std::stoi(env("MINDKEEP_DB_PORT", "3306")),
          nullptr, CLIENT_MULTI_RESULTS))
    throw std::runtime_error(
        "Cannot connect to MySQL. Check MINDKEEP_DB_* and run migrations/setup.");
  mysql_set_character_set(connection, "utf8mb4");
}

Database::~Database() {
  if (connection)
    mysql_close(connection);
}

Rows Database::query(const std::string &sql, const std::vector<std::string> &params) {
  std::lock_guard lock(mutex);
  MYSQL_STMT *raw = mysql_stmt_init(connection);
  if (!raw)
    throw std::runtime_error("MySQL statement initialization failed");
  std::unique_ptr<MYSQL_STMT, decltype(&mysql_stmt_close)> stmt(raw, mysql_stmt_close);
  auto check = [&](int code) {
    if (code) {
      std::cerr << "Database error " << mysql_stmt_errno(stmt.get()) << " in statement: " << sql
                << "\n";
      throw std::runtime_error(std::string("Database operation failed: ") +
                               mysql_stmt_error(stmt.get()));
    }
  };
  check(mysql_stmt_prepare(raw, sql.data(), sql.size()));
  std::vector<MYSQL_BIND> bindings(params.size());
  std::vector<unsigned long> lengths(params.size());
  for (size_t i = 0; i < params.size(); i++) {
    lengths[i] = params[i].size();
    bindings[i] = {};
    bindings[i].buffer_type = MYSQL_TYPE_STRING;
    bindings[i].buffer = (void *)params[i].data();
    bindings[i].buffer_length = lengths[i];
    bindings[i].length = &lengths[i];
  }
  if (!bindings.empty())
    check(mysql_stmt_bind_param(raw, bindings.data()));
  bool update_max = true;
  mysql_stmt_attr_set(raw, STMT_ATTR_UPDATE_MAX_LENGTH, &update_max);
  check(mysql_stmt_execute(raw));
  MYSQL_RES *metadata = mysql_stmt_result_metadata(raw);
  if (!metadata)
    return {};
  std::unique_ptr<MYSQL_RES, decltype(&mysql_free_result)> meta(metadata, mysql_free_result);
  check(mysql_stmt_store_result(raw));
  auto fields = mysql_fetch_fields(metadata);
  auto count = mysql_num_fields(metadata);
  std::vector<MYSQL_BIND> result(count);
  std::vector<std::vector<char>> buffers(count);
  std::vector<unsigned long> sizes(count);
  std::unique_ptr<bool[]> nulls(new bool[count]);
  std::unique_ptr<bool[]> errors(new bool[count]);
  for (unsigned i = 0; i < count; i++) {
    buffers[i].resize(std::max<unsigned long>(fields[i].max_length + 1, 256));
    result[i] = {};
    result[i].buffer_type = MYSQL_TYPE_STRING;
    result[i].buffer = buffers[i].data();
    result[i].buffer_length = buffers[i].size();
    result[i].length = &sizes[i];
    result[i].is_null = &nulls[i];
    result[i].error = &errors[i];
  }
  check(mysql_stmt_bind_result(raw, result.data()));
  Rows rows;
  int status;
  while ((status = mysql_stmt_fetch(raw)) != MYSQL_NO_DATA) {
    if (status && status != MYSQL_DATA_TRUNCATED)
      check(status);
    json row = json::object();
    for (unsigned i = 0; i < count; i++) {
      if (nulls[i])
        row[fields[i].name] = nullptr;
      else {
        if (errors[i]) {
          buffers[i].resize(sizes[i] + 1);
          result[i].buffer = buffers[i].data();
          result[i].buffer_length = buffers[i].size();
          check(mysql_stmt_fetch_column(raw, &result[i], i, 0));
        }
        row[fields[i].name] = std::string(buffers[i].data(), sizes[i]);
      }
    }
    rows.push_back(row);
  }
  return rows;
}

void Database::transaction(const std::function<void()> &f) {
  std::lock_guard lock(mutex);
  if (mysql_autocommit(connection, false))
    throw std::runtime_error("Cannot begin database transaction");
  try {
    f();
    if (mysql_commit(connection))
      throw std::runtime_error("Cannot commit database transaction");
    mysql_autocommit(connection, true);
  } catch (...) {
    mysql_rollback(connection);
    mysql_autocommit(connection, true);
    throw;
  }
}

void Database::migrate(const std::string &file) {
  std::ifstream stream(file);
  if (!stream)
    throw std::runtime_error("Migration file missing");
  std::stringstream all;
  all << stream.rdbuf();
  std::string statement;
  std::stringstream split(all.str());
  while (std::getline(split, statement, ';'))
    if (statement.find_first_not_of(" \n\r\t") != std::string::npos)
      query(statement);
}
} // namespace mk
