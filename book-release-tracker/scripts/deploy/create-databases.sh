#!/usr/bin/env bash
# One-time setup of the hosted databases (D3: separate data and secrets).
#
# Render's free plan allows one Postgres instance per workspace, so staging
# and production share the instance but get separate databases AND separate
# logins: each login owns only its own database, and PUBLIC may not connect
# to either, so the staging login can't open production data (or vice versa).
#
# Usage (on your Mac, from the project root):
#   export ADMIN_URL='<External Database URL from the Render dashboard>'
#   scripts/deploy/create-databases.sh
#
# It prints, for each environment, the INTERNAL url (paste into that Render
# service's DATABASE_URL) and the EXTERNAL url (only for seeding from your
# Mac). These contain passwords: paste them only into Render / your terminal,
# never into a file in the repo or into a chat. Running it again resets both
# passwords (and prints the new urls); data is kept.
set -euo pipefail
: "${ADMIN_URL:?Set ADMIN_URL to the External Database URL from Render}"
command -v psql >/dev/null || { echo "psql not found (brew install libpq, then follow its PATH hint)"; exit 1; }

# postgresql://user:pass@dpg-xxxx-a.oregon-postgres.render.com:5432/db
ext_host=$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(u.host)' "$ADMIN_URL")   # host[:port]
int_host=${ext_host%%.*}   # Render's internal hostname is the first label: dpg-xxxx-a
[ "$int_host" = "$ext_host" ] && int_host=$ext_host   # not a Render hostname (local test): keep it
admin_db=$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(u.pathname.slice(1))' "$ADMIN_URL")

for env in staging prod; do
  role="bibliophile_${env}"
  pw=$(openssl rand -hex 24)
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -v role="$role" -v pw="$pw" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'role', :'pw') \gexec
-- The admin login must be a member to hand the database over to the role.
SELECT format('GRANT %I TO CURRENT_USER', :'role') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'role', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'role') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'role') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'role', :'role') \gexec
SQL
  echo
  echo "== ${env} =="
  echo "  Render DATABASE_URL (internal): postgresql://${role}:${pw}@${int_host}/${role}"
  echo "  For seeding from your Mac:      postgresql://${role}:${pw}@${ext_host}/${role}?sslmode=require"
  [ "$env" = staging ] && staging_ext="postgresql://${role}:${pw}@${ext_host}/bibliophile_prod${SSLMODE-?sslmode=require}"
done

# The admin database itself: nobody but its owner.
psql "$ADMIN_URL" -q -c "REVOKE ALL ON DATABASE \"${admin_db}\" FROM PUBLIC" || true

echo
echo "Separation check: the staging login tries to open the production database..."
if psql "$staging_ext" -c 'select 1' >/dev/null 2>/tmp/sep-check.err; then
  echo "  FAILED: staging could connect to bibliophile_prod. Don't use these urls; ask for help."; exit 1
elif grep -q "permission denied for database" /tmp/sep-check.err; then
  echo "  ok, refused: $(grep -o 'permission denied for database.*' /tmp/sep-check.err | head -1)"
else
  echo "  couldn't run the check: $(head -1 /tmp/sep-check.err)"; exit 1
fi
