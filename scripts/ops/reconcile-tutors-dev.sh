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
# Needs:  TUTORS_DEV_DATABASE_URL (already present in .env.local), psql, npx
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

MIGRATION=supabase/migrations/20260923205546_direct_messages_and_lesson_names.sql
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Backing up tutors_dev to $WORK/backup.sql"
pg_dump --no-owner --no-privileges "$TUTORS_DEV_DATABASE_URL" > "$WORK/backup.sql"
echo "    $(wc -c < "$WORK/backup.sql") bytes. Copy it somewhere durable if you want to keep it."

echo "==> Creating the two storage policies that 20260923205546 never applied"
# Extracted verbatim from the migration. Both statements drop-if-exists first,
# so running them twice is harmless.
{
  awk '/conversation participants read attachments/,/;/' "$MIGRATION"
  awk '/conversation participants upload attachments/,/;/' "$MIGRATION"
} > "$WORK/policies.sql"
psql "$TUTORS_DEV_DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -f "$WORK/policies.sql"

echo "==> Verifying"
count=$(psql "$TUTORS_DEV_DATABASE_URL" -X -t -A \
  -c "select count(*) from pg_policies where schemaname='storage';")
if [ "$count" -ne 3 ]; then
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
