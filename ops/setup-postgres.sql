\set ON_ERROR_STOP on

-- Required psql variables:
--   etl_user      NFLETL login name.
--   etl_password  NFLETL login password.
--   bronze_db     Bronze database name.

\if :{?etl_user}
\else
  \echo 'ERROR: etl_user is required.'
  \quit 2
\endif
\if :{?etl_password}
\else
  \echo 'ERROR: etl_password is required.'
  \quit 2
\endif
\if :{?bronze_db}
\else
  \echo 'ERROR: bronze_db is required.'
  \quit 2
\endif

\echo 'Creating or updating the NFLETL login...'
SELECT format('CREATE ROLE %I LOGIN', :'etl_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'etl_user')
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'etl_user', :'etl_password')
\gexec

\echo 'Creating or updating the bronze database...'
SELECT format('CREATE DATABASE %I OWNER %I', :'bronze_db', :'etl_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'bronze_db')
\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'bronze_db', :'etl_user')
\gexec

\connect :bronze_db
SELECT format('CREATE SCHEMA bronze AUTHORIZATION %I', :'etl_user')
WHERE NOT EXISTS (SELECT FROM pg_namespace WHERE nspname = 'bronze')
\gexec
SELECT format('ALTER SCHEMA bronze OWNER TO %I', :'etl_user')
\gexec

\echo 'NFLETL PostgreSQL provisioning complete.'
SELECT current_setting('server_version') AS server_version,
       current_database() AS database,
       pg_get_userbyid(datdba) AS database_owner,
       (SELECT schema_owner
          FROM information_schema.schemata
         WHERE schema_name = 'bronze') AS schema_owner
FROM pg_database
WHERE datname = current_database();
