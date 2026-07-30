#!/usr/bin/env bash
# Rebuild the local database from zero and replay every migration in order.
#
# Used by `npm run db:reset:local`, which targets a plain Postgres rather than
# the Docker-based Supabase stack — so migrations, triggers, functions and RLS
# can be proven in environments without Docker (including CI).
set -euo pipefail

# Resolve the repository root from this script's own location so the script
# behaves identically however it is invoked.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGURL="${PGURL:-postgresql://postgres@localhost:54322/postgres}"
PSQL="$PGBIN/psql $PGURL -v ON_ERROR_STOP=1 -q"

echo "→ dropping schemas"
$PSQL <<'SQL'
drop schema if exists public cascade;
drop schema if exists app cascade;
drop schema if exists auth cascade;
drop schema if exists storage cascade;
create schema public;
grant usage on schema public to public;
SQL

echo "→ platform shim"
$PSQL -f supabase/tests/harness/00_platform_shim.sql

for f in supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  $PSQL -f "$f"
done

echo "✓ database rebuilt"
