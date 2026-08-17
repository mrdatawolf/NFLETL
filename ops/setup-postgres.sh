#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env does not exist. Copy .env.example to .env and configure it first." >&2
  exit 1
fi

# .env is a trusted local file. Quote values containing #, spaces, or shell
# metacharacters (for example PGPASSWORD='abc#123').
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${PGUSER:?PGUSER must be set in .env}"
: "${PGPASSWORD:?PGPASSWORD must be set in .env}"
: "${PGDATABASE:?PGDATABASE must be set in .env}"

ETL_USER=$PGUSER
ETL_PASSWORD=$PGPASSWORD
BRONZE_DATABASE=$PGDATABASE

# Use the local postgres administrator for provisioning. Clear application
# PG* values so they cannot redirect or change the admin connection.
unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD

if [ "$(id -un)" = "postgres" ]; then
  ADMIN_COMMAND=(psql -d postgres)
elif command -v sudo >/dev/null 2>&1; then
  ADMIN_COMMAND=(sudo -u postgres psql -d postgres)
else
  echo "ERROR: run this script as postgres or install/configure sudo." >&2
  echo "For a remote server, use the administrator command in SetupPG.md." >&2
  exit 1
fi

"${ADMIN_COMMAND[@]}" \
  --set=etl_user="$ETL_USER" \
  --set=etl_password="$ETL_PASSWORD" \
  --set=bronze_db="$BRONZE_DATABASE" \
  --file=ops/setup-postgres.sql
