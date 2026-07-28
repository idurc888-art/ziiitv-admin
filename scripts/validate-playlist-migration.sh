#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pg_bin="${PG_BIN:-/usr/lib/postgresql/16/bin}"
test_root="$(mktemp -d -p /tmp qi220-migration-XXXXXX)"
data_dir="$test_root/data"
socket_dir="$test_root/socket"
log_file="$test_root/postgres.log"

cleanup() {
  if "$pg_bin/pg_ctl" -D "$data_dir" status >/dev/null 2>&1; then
    "$pg_bin/pg_ctl" -D "$data_dir" stop -m fast >/dev/null
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$socket_dir"
"$pg_bin/initdb" -D "$data_dir" --auth=trust --no-locale --encoding=UTF8 >/dev/null
"$pg_bin/pg_ctl" -D "$data_dir" -l "$log_file" -o "-k $socket_dir -c listen_addresses=''" start >/dev/null

psql -v ON_ERROR_STOP=1 -h "$socket_dir" -d postgres -f "$project_dir/tests/sql/supabase-baseline.sql" >/dev/null
sed -e '/create extension if not exists pgmq;/d' -e '/create extension if not exists supabase_vault/d' \
  "$project_dir/supabase/migrations/20260722000001_playlist_import_pipeline.sql" > "$test_root/core.sql"
psql -v ON_ERROR_STOP=1 -h "$socket_dir" -d postgres -f "$test_root/core.sql" >/dev/null
psql -v ON_ERROR_STOP=1 -h "$socket_dir" -d postgres -f "$project_dir/supabase/migrations/20260722000002_playlist_source_storage.sql" >/dev/null
psql -v ON_ERROR_STOP=1 -h "$socket_dir" -d postgres -f "$project_dir/tests/sql/playlist-import-integration.sql"
