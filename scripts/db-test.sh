#!/usr/bin/env bash
# Rebuild the database, seed fixtures, run every SQL suite, print a report.
# Exits non-zero if any assertion failed — safe to wire straight into CI.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGURL="${PGURL:-postgresql://postgres@localhost:54322/postgres}"
PSQL="$PGBIN/psql $PGURL -q"

./scripts/db-reset.sh > /tmp/genesis-db-reset.log 2>&1
echo "✓ migrations applied from zero"

$PSQL -v ON_ERROR_STOP=1 -f supabase/tests/harness/01_assert.sql
$PSQL -c "truncate test.results restart identity;" > /dev/null
$PSQL -v ON_ERROR_STOP=1 -f supabase/tests/10_seed.sql
echo "✓ fixtures seeded"

failed_files=0
for f in supabase/tests/[2-9]*.sql; do
  errors=$($PSQL -f "$f" 2>&1 | grep -E "^psql.*(ERROR|FATAL)" || true)
  if [ -n "$errors" ]; then
    echo "!! $(basename "$f")"
    echo "$errors" | sed 's/^/     /'
    failed_files=$((failed_files + 1))
  fi
done

echo
$PGBIN/psql "$PGURL" -c "
  select suite,
         count(*) filter (where passed)     as passed,
         count(*) filter (where not passed) as failed
    from test.results group by suite order by suite;"

$PGBIN/psql "$PGURL" -c "
  select suite, name, detail from test.results where not passed order by id;"

total=$($PSQL -t -A -c "select count(*) from test.results")
failed=$($PSQL -t -A -c "select count(*) from test.results where not passed")

echo "── $((total - failed))/$total assertions passed, $failed_files file(s) with SQL errors"
[ "$failed" -eq 0 ] && [ "$failed_files" -eq 0 ]
