#!/usr/bin/env bash
# Tears the disposable local stack down and deletes its data directory.
ROOT="${LOCAL_STACK_DIR:-/tmp/ask-sunny-local-stack}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
docker rm -f ask-sunny-local-auth ask-sunny-local-mailpit >/dev/null 2>&1 || true
for pidfile in "$ROOT/postgrest.pid" "$ROOT/gateway.pid"; do
  [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null || true
done
[ -d "$ROOT/pg" ] && su postgres -c "$PGBIN/pg_ctl -D $ROOT/pg -m immediate stop" >/dev/null 2>&1 || true
rm -rf "$ROOT"
echo "local stack removed"
