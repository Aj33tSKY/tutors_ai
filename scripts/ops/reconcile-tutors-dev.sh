#!/usr/bin/env bash
# One-off: reconcile tutors_dev's migration history with this repository.
#
# Why this is needed: tutors_dev's schema was applied outside the Supabase CLI,
# so supabase_migrations.schema_migrations does not exist at all and every
# migration reads as unapplied. Comparing a full schema dump against a database
# built from this repository showed tutors_dev matches through 20260924143844,
# with one exception — two storage policies from 20260923205546 were never
# created.
#
# So this script completes that migration, then records the ten migrations that
# are genuinely already present. It does not apply pending migrations and does
# not modify any data; the staging pipeline applies what remains
# (20260924184118 and 20260925120000).
#
# Usage:  bash scripts/ops/reconcile-tutors-dev.sh
# Needs:  TUTORS_DEV_DATABASE_URL (already in .env.local), npx, and either psql
#         on PATH or the local Supabase stack running (npx supabase start).
set -euo pipefail

cd "$(dirname "$0")/../.."

if [ -z "${TUTORS_DEV_DATABASE_URL:-}" ]; then
  set -a; . ./.env.local; set +a
fi
: "${TUTORS_DEV_DATABASE_URL:?TUTORS_DEV_DATABASE_URL is not set}"

# Refuse to run against anything that is not tutors_dev.
case "$TUTORS_DEV_DATABASE_URL" in
  *khxcdmtppyzslxjecbgq*) ;;
  *) echo "error: TUTORS_DEV_DATABASE_URL does not point at tutors_dev. Refusing." >&2; exit 1 ;;
esac

# psql is not installed on the host here, but the local Supabase database
# container ships it. Prefer a real psql if one exists.
DB_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -m1 '^supabase_db_' || true)"
if command -v psql >/dev/null 2>&1; then
  run_sql() { psql "$TUTORS_DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -f "$1"; }
  query()   { psql "$TUTORS_DEV_DATABASE_URL" -X -t -A -c "$1"; }
elif [ -n "$DB_CONTAINER" ]; then
  echo "(using psql inside $DB_CONTAINER; no psql on PATH)"
  run_sql() { docker exec -i "$DB_CONTAINER" psql "$TUTORS_DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -q < "$1"; }
  query()   { docker exec "$DB_CONTAINER" psql "$TUTORS_DEV_DATABASE_URL" -X -t -A -c "$1"; }
else
  echo "error: no psql on PATH and no supabase_db_* container running." >&2
  echo "       Run 'npx supabase start' first, or install the postgresql client." >&2
  exit 1
fi

MIGRATION=supabase/migrations/20260923205546_direct_messages_and_lesson_names.sql
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Deliberately outside the repository: this is a data dump and *.sql is not
# gitignored here, so keeping it in the tree risks committing user data.
BACKUP_DIR="$HOME/tutors-dev-backups"
BACKUP="$BACKUP_DIR/tutors_dev-$(date +%Y%m%d-%H%M%S).sql"
mkdir -p "$BACKUP_DIR"

echo "==> Backing up tutors_dev"
# Two dumps on purpose: `supabase db dump` writes schema only unless asked for
# data, and a schema-only file is not a backup you can restore from.
npx --no-install supabase db dump --db-url "$TUTORS_DEV_DATABASE_URL" -f "$BACKUP" >/dev/null
npx --no-install supabase db dump --db-url "$TUTORS_DEV_DATABASE_URL" \
  --data-only --use-copy -f "${BACKUP%.sql}-data.sql" >/dev/null
echo "    schema: $BACKUP ($(wc -c < "$BACKUP" | tr -d ' ') bytes)"
echo "    data:   ${BACKUP%.sql}-data.sql ($(wc -c < "${BACKUP%.sql}-data.sql" | tr -d ' ') bytes)"

echo "==> Creating the two storage policies that 20260923205546 never applied"
# Extracted verbatim from the migration. Both statements drop-if-exists first,
# so running them twice is harmless.
{
  awk '/conversation participants read attachments/,/;/' "$MIGRATION"
  awk '/conversation participants upload attachments/,/;/' "$MIGRATION"
} > "$WORK/policies.sql"
run_sql "$WORK/policies.sql"

echo "==> Verifying"
count="$(query "select count(*) from pg_policies where schemaname='storage';" | tr -d '[:space:]')"
if [ "$count" != "3" ]; then
  echo "error: expected 3 storage policies, found $count. Stopping before baselining." >&2
  exit 1
fi
echo "    3 storage policies present"

echo "==> Recording the ten migrations tutors_dev already has"
for version in 20260923205545 20260923205546 20260924090000 20260924090100 \
               20260924093000 20260924094500 20260924095000 20260924095500 \
               20260924115135 20260924143844; do
  npx --no-install supabase migration repair --status applied "$version" \
    --db-url "$TUTORS_DEV_DATABASE_URL"
done

echo "==> Resulting history"
npx --no-install supabase migration list --db-url "$TUTORS_DEV_DATABASE_URL"

echo "==> Checking the deployment guard accepts it"
npx --no-install supabase migration list --db-url "$TUTORS_DEV_DATABASE_URL" \
  --output-format json > "$WORK/history.json"
SUPABASE_BASELINE_VERSION=20260924143844 \
  node scripts/ci/verify-supabase-migration-history.mjs "$WORK/history.json"

echo
echo "Done. 20260924184118 and 20260925120000 should be the only pending migrations."
echo "Then set STAGING_MIGRATIONS_BASELINED=true in the staging GitHub Environment."
