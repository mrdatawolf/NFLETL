# PostgreSQL setup for NFLETL

NFLETL owns and writes the PostgreSQL `bronze` database. Configure the
application first, then use the included idempotent provisioning script to
create or update its login, database, and schema.

NFLDataAPI's `nfldataapi` role, read-only bronze grants, and `silver` database
are intentionally handled by that sibling project's setup script.

## Install PostgreSQL 17

On a Debian 13 development box:

```bash
sudo apt update
sudo apt install postgresql postgresql-client
sudo systemctl enable --now postgresql
pg_isready
```

Debian 13 installs PostgreSQL 17 from its standard repositories. Confirm the
running version with:

```bash
sudo -u postgres psql -X -Atqc "SHOW server_version;"
```

## Configure the application first

From the NFLETL repository root, copy the example environment file if a local
one does not already exist:

```bash
cp .env.example .env
```

Set the PostgreSQL connection values in `.env` before provisioning:

```dotenv
PGHOST=localhost
PGPORT=5432
PGDATABASE=bronze
PGUSER=nfletl
PGPASSWORD='choose-a-development-password'
```

Quotes around `PGPASSWORD` are recommended when it contains `#`, spaces, or
shell metacharacters. The wrapper reads only the three required PostgreSQL
keys and does not execute or source `.env`. Keep `.env` uncommitted and remove
any obsolete `DB_PATH` setting.

## Automated local setup

Run the wrapper from the repository root:

```bash
./ops/setup-postgres.sh
```

The wrapper loads `.env`, uses `PGUSER`, `PGPASSWORD`, and `PGDATABASE` to
create or update the application login, then connects through `sudo` as the
local `postgres` administrator. It creates the bronze database, makes NFLETL
its owner, and creates the `bronze` schema with the same owner. It is
idempotent and can be rerun to repair ownership or synchronize a changed
development password.

The script deliberately does not provision PostgreSQL packages or modify
`pg_hba.conf`. Those host-level operations vary by environment.

For PostgreSQL on another host, run the SQL file using an administrator
connection and pass the configured values explicitly:

```bash
psql -h DB_HOST -U postgres -d postgres \
  --set=etl_user=nfletl \
  --set=etl_password='the-password-from-.env' \
  --set=bronze_db=bronze \
  --file=ops/setup-postgres.sql
```

Be aware that command-line arguments may be visible to other local users
while that command runs. Use an administrator-approved secret mechanism when
provisioning shared or production systems.

## Install, bootstrap, and populate

```bash
npm install
npm run build
npm run run
```

NFLETL checks connectivity and creates its idempotent metadata and landing
tables at startup. Sources with an empty path or a nonexistent file are
reported as `skipped`; configure their paths in `.env` and rerun when those
files become available. Hash deduplication prevents unchanged source rows
from being duplicated.

`start.sh` and `start.bat` test the native `better-sqlite3` addon after
installing dependencies and automatically rebuild it when it was compiled for
a different `NODE_MODULE_VERSION`. When running the npm commands manually,
the equivalent recovery is:

```bash
npm rebuild better-sqlite3
```

## Verification

```bash
psql -W -h localhost -U nfletl -d bronze \
  -c "SELECT current_setting('server_version'), current_user, current_database();" \
  -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'bronze' ORDER BY table_name;"
```

The `-W` option prompts without saving the password in shell history.

Useful host-side diagnostics:

```bash
sudo systemctl status postgresql
pg_isready
sudo -u postgres psql -X -c "\l"
sudo -u postgres psql -X -c "\du"
```

If `psql` defaults to your Linux username and reports that the role does not
exist, pass `-h localhost -U nfletl -d bronze` or load the project's `PG*`
variables. Local socket and TCP password authentication can use different
rules in PostgreSQL's `pg_hba.conf`.
