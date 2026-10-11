#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f data/dev.env ]]; then source data/dev.env; fi
MK_DB_DIR="${MINDKEEP_DEV_DB_DIR:-/tmp/mindkeep-mysql-$UID}"
MK_NEW_DB=0
mkdir -p data "$MK_DB_DIR"
chmod 700 data "$MK_DB_DIR"
if [[ ! -d "$MK_DB_DIR/mysql" ]]; then
  MK_NEW_DB=1
  mysqld --no-defaults --initialize-insecure --datadir="$MK_DB_DIR" --log-error="$MK_DB_DIR/server.log"
fi
if ! mysqladmin --no-defaults --socket="$MK_DB_DIR/mysql.sock" ping >/dev/null 2>&1; then
  mysqld --no-defaults --datadir="$MK_DB_DIR" --socket="$MK_DB_DIR/mysql.sock" --pid-file="$MK_DB_DIR/server.pid" --port=3307 --bind-address=127.0.0.1 --mysqlx=OFF --log-error="$MK_DB_DIR/server.log" --daemonize
fi
if [[ ! -f data/dev.env ]]; then
  MINDKEEP_DB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
  umask 077
  cat > data/dev.env <<ENV
export MINDKEEP_DEV_DB_DIR=$MK_DB_DIR
export MINDKEEP_DB_HOST=127.0.0.1
export MINDKEEP_DB_PORT=3307
export MINDKEEP_DB_NAME=mindkeep
export MINDKEEP_DB_USER=mindkeep
export MINDKEEP_DB_PASSWORD=$MINDKEEP_DB_PASSWORD
export MINDKEEP_PUBLIC_URL=http://localhost:8080
export MINDKEEP_DATA=data/media
ENV
fi
mysql --no-defaults --socket="$MK_DB_DIR/mysql.sock" -u root <<SQL
CREATE DATABASE IF NOT EXISTS mindkeep CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'mindkeep'@'127.0.0.1' IDENTIFIED BY '$MINDKEEP_DB_PASSWORD';
GRANT ALL PRIVILEGES ON mindkeep.* TO 'mindkeep'@'127.0.0.1';
SQL
if [[ "$MK_NEW_DB" == 1 && -f data/database-snapshot.sql ]]; then
  mysql --no-defaults --socket="$MK_DB_DIR/mysql.sock" -u root <data/database-snapshot.sql
  printf 'Recovered the private development database snapshot.\n'
fi
printf 'Development MySQL is ready on 127.0.0.1:3307. Configuration: data/dev.env\n'
