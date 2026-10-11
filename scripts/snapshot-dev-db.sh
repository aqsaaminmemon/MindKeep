#!/usr/bin/env bash
# Private administrator snapshot of the isolated development database, not a portable user backup.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f data/dev.env ]] || { printf 'No development database configured.\n' >&2; exit 1; }
source data/dev.env
umask 077
MK_DEFAULTS="$(mktemp "$PWD/data/mysql-client.XXXXXX")"
trap 'rm -f "$MK_DEFAULTS"' EXIT
cat > "$MK_DEFAULTS" <<CONFIG
[client]
host=$MINDKEEP_DB_HOST
port=$MINDKEEP_DB_PORT
user=$MINDKEEP_DB_USER
password=$MINDKEEP_DB_PASSWORD
CONFIG
mysqldump --defaults-extra-file="$MK_DEFAULTS" --single-transaction --no-tablespaces --set-gtid-purged=OFF --databases "$MINDKEEP_DB_NAME" >data/database-snapshot.sql.tmp
mv data/database-snapshot.sql.tmp data/database-snapshot.sql
chmod 600 data/database-snapshot.sql
printf 'Private development database snapshot saved in data/database-snapshot.sql\n'
