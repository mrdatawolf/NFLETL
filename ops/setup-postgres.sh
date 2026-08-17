#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env does not exist. Copy .env.example to .env and configure it first." >&2
  exit 1
fi

# Read only the keys needed for provisioning. Do not `source .env`: dotenv
# permits values that are not valid shell syntax, and a sourced file could
# execute arbitrary commands. The final definition of a repeated key wins.
read_dotenv_value() {
  local key=$1 line value=''
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    if [[ $line == "$key="* ]]; then
      value=${line#*=}
    fi
  done < .env

  if [[ $value == \"*\" && $value == *\" ]]; then
    value=${value:1:${#value}-2}
  elif [[ $value == \'*\' && $value == *\' ]]; then
    value=${value:1:${#value}-2}
  fi
  printf '%s' "$value"
}

ETL_USER=$(read_dotenv_value PGUSER)
ETL_PASSWORD=$(read_dotenv_value PGPASSWORD)
BRONZE_DATABASE=$(read_dotenv_value PGDATABASE)

: "${ETL_USER:?PGUSER must be set in .env}"
: "${ETL_PASSWORD:?PGPASSWORD must be set in .env}"
: "${BRONZE_DATABASE:?PGDATABASE must be set in .env}"

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
