"""The database for the Zoho Books tests: a throwaway PostgreSQL (pg_stand) built with staging's migrations in staging's
order (as run_e2e_tdsgst.py builds it: 32 .. 60, 68, 70, 61, 62 .. 67, 72, 73, 74), the Supabase pieces migration 75 leans
on made plain (Vault: vault.secrets, vault.decrypted_secrets, vault.create_secret / update_secret; extensions.gen_random_bytes),
then migration 75 (zoho-books). Nothing of a real database is touched.
    db = zoho_stand.build(port, run75=True)"""
import os, subprocess
import pg_stand
HERE = os.path.dirname(os.path.abspath(__file__))
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M75 = os.environ.get("M75_FILE") or os.path.join(HERE, "..", "server", "zoho-books", "migration-75-zoho-books.sql")
STAGING = ["migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql", "@34", "migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql",
           "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql", "migration-40-states-carried.sql", "migration-41-day-counts.sql",
           "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql", "migration-46-trial-tools.sql",
           "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
           "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql",
           "migration-68-alert-dismissals.sql", "migration-70-alert-dismissals-tighten.sql", "migration-61-privileges.sql",
           "migration-62-tds-rate-worked-out.sql", "migration-63-recorder-repeat.sql", "migration-64-pages-live.sql", "migration-65-selfchecks.sql", "migration-66-recorder-masters.sql",
           "migration-67-recorder-renumbered.sql", "migration-72-gst-type.sql", "migration-73-tds-fields.sql", "migration-74-payroll.sql"]
FILES = [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql") if f == "@34" else os.path.join(SQLDIR, f) for f in STAGING]
VAULT = r"""
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null) returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), updated_at = now() where id = secret_id $$;
revoke all on schema vault from public;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
"""
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
def psql_file(db, path):
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                       input=open(path).read(), capture_output=True, text=True)
    return r.returncode, (r.stderr or r.stdout)[-1500:]
def build(port, run75=True):
    db = pg_stand.start(port)
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create table if not exists clients (id text, firm_id uuid, name text, data jsonb default '{}', deleted boolean default false, tally_name text default '', gstin text default '', pan text default '', primary key (firm_id, id));")
    db.sql(VAULT)
    for path in FILES:
        if not os.path.exists(path): continue
        rc, err = psql_file(db, path)
        if rc: raise SystemExit("%s does not run: %s" % (os.path.basename(path), err))
    if run75:
        rc, err = psql_file(db, M75)
        if rc: raise SystemExit("migration 75 does not run: " + err)
    return db
