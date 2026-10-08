-- Least-privilege database role for the worker.
--
-- The worker only reads builds/projects, and updates and deletes builds. It never inserts, and
-- never touches document text (yjs_docs), comments, the sharing graph (project_members), the audit
-- log, or users. Pointing the worker at this role means a stolen worker credential
-- (e.g. if a compile ever escaped its sandbox and read the process environment) cannot dump
-- document contents or user data, nor change anything beyond build bookkeeping.
--
-- Apply as the database owner, then set WORKER_DATABASE_URL to use the latex_worker role:
--   psql "$DATABASE_URL" -v worker_password="$POSTGRES_WORKER_PASSWORD" -f docker/postgres/worker-role.sql
-- Re-run it after a migration that adds a table the worker reads: grants are explicit per table,
-- so a new table is not reachable until granted (fail-closed).

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'latex_worker') THEN
    CREATE ROLE latex_worker LOGIN;
  END IF;
END
$$;

ALTER ROLE latex_worker WITH PASSWORD :'worker_password';

-- Start from nothing, so re-running after a schema change never leaves a stale grant.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM latex_worker;

GRANT USAGE ON SCHEMA public TO latex_worker;
GRANT SELECT ON builds, projects TO latex_worker;
GRANT UPDATE, DELETE ON builds TO latex_worker;
