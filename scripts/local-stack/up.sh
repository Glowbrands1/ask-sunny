#!/usr/bin/env bash
# ============================================================================
# A DISPOSABLE, LOCAL, SUPABASE-SHAPED STACK — no cloud resources, no cost.
# ============================================================================
#
# For the auth-revocation integration tests (src/**/*.local-stack.test.ts).
# Everything binds 127.0.0.1, every credential is a throwaway local value, and
# `down.sh` deletes all of it. It NEVER talks to the Ask Sunny Supabase project.
#
#   Postgres 16   native binaries (PGBIN), port 54329, with pgvector
#   Supabase Auth supabase/gotrue Docker image (host network), port 59999
#   Mailpit       axllent/mailpit Docker image — catches every email, port 51025 / UI 58025
#   PostgREST     static binary (POSTGREST_BIN), port 53001
#   Gateway       gateway.mjs: /auth/v1 + /rest/v1 on one URL, port 54321
#
# Then EVERY migration in supabase/migrations is applied, in order, as the
# non-superuser `postgres` role, each in its own transaction.
#
# Requires: root (to run Postgres as the `postgres` OS user), Docker, Node,
# the two images pulled, a PostgREST binary.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ROOT="${LOCAL_STACK_DIR:-/tmp/ask-sunny-local-stack}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
POSTGREST_BIN="${POSTGREST_BIN:-/tmp/postgrest}"
GOTRUE_IMAGE="${GOTRUE_IMAGE:-supabase/gotrue:v2.180.0}"
MAILPIT_IMAGE="${MAILPIT_IMAGE:-axllent/mailpit:v1.27}"
PG_PORT=54329 AUTH_PORT=59999 REST_PORT=53001 GATEWAY_PORT=54321 SMTP_PORT=51025 MAIL_UI_PORT=58025
export LOCAL_STACK_JWT_SECRET="local-stack-only-jwt-secret-not-a-real-credential"

"$HERE/down.sh" >/dev/null 2>&1 || true
mkdir -p "$ROOT"
chown postgres "$ROOT"

echo "== postgres"
su postgres -c "$PGBIN/initdb -D $ROOT/pg -U supabase_admin --auth=trust >/dev/null"
su postgres -c "$PGBIN/pg_ctl -D $ROOT/pg -o '-p $PG_PORT -k $ROOT -c listen_addresses=127.0.0.1' -l $ROOT/pg.log -w start >/dev/null"
PSQL_ADMIN=(psql -h 127.0.0.1 -p "$PG_PORT" -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL_ADMIN[@]}" -f "$HERE/bootstrap.sql"

echo "== mailpit"
docker run -d --rm --name ask-sunny-local-mailpit --network host "$MAILPIT_IMAGE" \
  --smtp "127.0.0.1:$SMTP_PORT" --listen "127.0.0.1:$MAIL_UI_PORT" >/dev/null

echo "== supabase auth"
docker run -d --rm --name ask-sunny-local-auth --network host \
  -e GOTRUE_API_HOST=127.0.0.1 -e PORT="$AUTH_PORT" \
  -e API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1" \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_NAMESPACE=auth \
  -e DATABASE_URL="postgres://supabase_auth_admin:supabase_auth_admin@127.0.0.1:$PG_PORT/postgres?sslmode=disable" \
  -e GOTRUE_SITE_URL="http://127.0.0.1:3000" -e GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:3000/**" \
  -e GOTRUE_JWT_SECRET="$LOCAL_STACK_JWT_SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_DISABLE_SIGNUP=true -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false \
  -e GOTRUE_SMTP_HOST=127.0.0.1 -e GOTRUE_SMTP_PORT="$SMTP_PORT" -e GOTRUE_SMTP_ADMIN_EMAIL=auth@local.test \
  -e GOTRUE_SMTP_SENDER_NAME="Local Stack" -e GOTRUE_RATE_LIMIT_EMAIL_SENT=10000 \
  -e GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true -e GOTRUE_LOG_LEVEL=warn \
  "$GOTRUE_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$AUTH_PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$AUTH_PORT/health" >/dev/null || { docker logs ask-sunny-local-auth | tail -30; exit 1; }

# As in the Supabase project (observed 6 Oct 2026 with has_table_privilege): postgres holds every
# table privilege on these four auth tables, though not ownership (supabase_auth_admin owns them).
"${PSQL_ADMIN[@]}" -c "grant select, insert, update, delete, truncate, references, trigger on auth.users, auth.sessions, auth.refresh_tokens, auth.identities to postgres;"

echo "== migrations"
count=0
for migration in "$REPO"/supabase/migrations/*.sql; do
  source_file="$migration"
  # PRE-EXISTING, NOT PART OF THIS STACK: this file's own self-check builds a
  # ~392-character probe and then requires it to exceed 500, so it can never
  # apply to a fresh database (Production received different SQL for it). The
  # LOCAL copy only gets a long-enough probe; the repository file is untouched.
  if [ "$(basename "$migration")" = "20260919003000_google_review_url_check_repetition.sql" ]; then
    source_file="$ROOT/patched-$(basename "$migration")"
    sed "s/repeat('x', 300)/repeat('x', 460)/" "$migration" >"$source_file"
  fi
  psql -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -1 -f "$source_file" >/dev/null 2>"$ROOT/migration.err" || {
    echo "FAILED: $(basename "$migration")"; cat "$ROOT/migration.err"; exit 1; }
  count=$((count + 1))
done
echo "   applied $count migrations"

echo "== postgrest"
PGRST_DB_URI="postgres://authenticator:authenticator@127.0.0.1:$PG_PORT/postgres" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$LOCAL_STACK_JWT_SECRET" \
PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT="$REST_PORT" PGRST_LOG_LEVEL=warn \
  nohup "$POSTGREST_BIN" >"$ROOT/postgrest.log" 2>&1 &
echo $! >"$ROOT/postgrest.pid"

echo "== gateway"
GATEWAY_PORT=$GATEWAY_PORT AUTH_PORT=$AUTH_PORT REST_PORT=$REST_PORT nohup node "$HERE/gateway.mjs" >"$ROOT/gateway.log" 2>&1 &
echo $! >"$ROOT/gateway.pid"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$GATEWAY_PORT/rest/v1/" >/dev/null 2>&1 && break
  sleep 1
done

{
  echo "ASK_SUNNY_LOCAL_STACK=1"
  echo "LOCAL_STACK_URL=http://127.0.0.1:$GATEWAY_PORT"
  echo "LOCAL_STACK_MAIL_API=http://127.0.0.1:$MAIL_UI_PORT/api/v1"
  echo "LOCAL_STACK_PG=postgres://supabase_admin@127.0.0.1:$PG_PORT/postgres"
  node "$HERE/keys.mjs"
} >"$ROOT/env"
echo "== up. Environment: $ROOT/env"
