#!/usr/bin/env bash
# Local PostgreSQL helper for BookMySeat.
# Runs an isolated cluster in ./.pgdata on port 5433 so it never touches a system-wide server.
#   ./scripts/db.sh start   -> init (first run) + start + create databases
#   ./scripts/db.sh stop    -> stop the cluster
#   ./scripts/db.sh status  -> show status
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="$ROOT/.pgdata"
PORT="${PGPORT:-5433}"
USER_NAME="bookmyseat"

case "${1:-start}" in
  start)
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
      echo "Initialising cluster in $PGDATA"
      initdb -D "$PGDATA" -U "$USER_NAME" --auth=trust -E UTF8 >/dev/null
    fi
    if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
      pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -o "-p $PORT -c max_connections=200" -w start
    fi
    for db in bookmyseat bookmyseat_test; do
      psql -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || createdb -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" "$db"
    done
    echo "PostgreSQL ready: postgres://$USER_NAME@127.0.0.1:$PORT/bookmyseat"
    ;;
  stop)   pg_ctl -D "$PGDATA" -w stop ;;
  status) pg_ctl -D "$PGDATA" status ;;
  *) echo "usage: $0 {start|stop|status}"; exit 1 ;;
esac
