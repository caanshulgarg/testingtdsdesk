"""python3 run_migration47.py - migration-47-recorder-queue-alerts (04-Oct-2026, round 20 part c: the cloud side of the live
recorder; docs/cloud-recorder-plan.md). On a throwaway PostgreSQL (pg_stand, port 30481): staging's order 32 -> ... -> 45 -> 46,
the Supabase pieces 47 leans on made plain (SCHEMA47 below: a pgmq stand-in, pg_cron's cron.schedule, Storage's buckets /
objects / foldername, migration 13's tally_jobs), made-up rows, then 47 twice. Never a real database.
Checks:
  the text: begin; set local lock_timeout '10s'; ... commit; no 'delete from' anywhere (comments too), no drop or truncate but
    the one widening CHECK swap on tally_jobs.kind; nothing deleted or added by the migration; every function security definer
    with search_path = public, pg_temp; md5(prosrc) of each function = the file's text between its $function$ marks.
  1. the queue: tally_recorder_enqueue (service role only) puts one message per call on pgmq tally_recorder; tally_recorder_drain
     applies them one at a time in order (created, altered, deleted of one entry over three messages), archives each; a
     message that fails is tried again (read_ct) and after 5 tries archived and kept in tally_recorder_failures with words;
     the drain refused to signed-in people; cron 'tally-recorder-drain' every 30 seconds calling the SQL directly.
  2. alerts: tally_alerts (RLS: the firm reads; nobody writes directly; another firm sees nothing); tally_alert_scan_gaps
     (the cursor's gap -> one 'gap' alert per book and day, updated in place), tally_alert_scan_silent (tally_recorder_silent
     per firm -> 'silent' per computer, only inside Mon-Sat 09:00-19:00 IST: tally_alert_working_now), tally_alert_daily_summary
     (one 'summary' per firm and day: lines applied / held / failed, queue failures, open gaps, postings done / needs review);
     each job run on the populated database leaves every other table byte-identical (an md5 of every table in every schema,
     tally_alerts aside); one per kind, book or device, and day; tally_alert_read marks read for members of the firm only;
     cron: gaps every 10 minutes, silent '*/30 3-13 * * 1-6', summary '30 13 * * *'.
  3. tally_devices.recorder_source ('addon' | 'alterid' | 'both', default 'addon'), set by the owner's
     tally_device_recorder_source only (staff, another firm, a revoked computer, a bad value refused with words).
  4. tally_recorder_line: ledger_altered with a GUID the copy holds under another name -> tally_ledger_rename (the lines
     follow); the same name -> held as before; an unknown GUID -> held.
  5. Storage: bucket 'tally-uploads' private, 2 GB limit; members insert / read under '<firm id>/' only; no update or delete.
  6. tally_jobs takes kind 'upload' (and still refuses an unknown kind); tally_jobs.upload jsonb (path, period, size, name).
RED (before 47): the file is missing, every check fails."""
import os, re, sys, json, hashlib, subprocess, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql")]
M47 = os.environ.get("M47_FILE") or os.path.join(SQLDIR, "migration-47-recorder-queue-alerts.sql")

# The Supabase pieces migration 47 leans on, made plain for pg_stand (staging has the real ones: pgmq 1.5.1, pg_cron 1.6.4,
# Storage). Shared: run_migration48.py, run_migration_order.py and run_recorder_server.py read this text.
SCHEMA47 = r"""
-- pgmq stand-in {
create schema if not exists pgmq;
create table if not exists pgmq.meta (queue_name text primary key, created_at timestamptz not null default now());
do $$ begin if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'pgmq' and t.typname = 'message_record') then
  create type pgmq.message_record as (msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb); end if; end $$;
create or replace function pgmq.create(queue_name text) returns void language plpgsql as $$
begin
  execute format('create table if not exists pgmq.%I (msg_id bigserial primary key, read_ct integer not null default 0, enqueued_at timestamptz not null default now(), vt timestamptz not null default now(), message jsonb)', 'q_' || queue_name);
  execute format('create table if not exists pgmq.%I (msg_id bigint primary key, read_ct integer, enqueued_at timestamptz, archived_at timestamptz not null default now(), vt timestamptz, message jsonb)', 'a_' || queue_name);
  insert into pgmq.meta (queue_name) values (queue_name) on conflict do nothing;
end $$;
create or replace function pgmq.list_queues() returns table (queue_name text, created_at timestamptz) language sql as $$ select m.queue_name, m.created_at from pgmq.meta m $$;
create or replace function pgmq.send(queue_name text, msg jsonb, delay integer default 0) returns setof bigint language plpgsql as $$
begin
  return query execute format('insert into pgmq.%I (vt, message) values (now() + make_interval(secs => $2), $1) returning msg_id', 'q_' || queue_name) using msg, delay;
end $$;
create or replace function pgmq.read(queue_name text, vt integer, qty integer) returns setof pgmq.message_record language plpgsql as $$
begin
  return query execute format('with c as (select msg_id from pgmq.%I where vt <= clock_timestamp() order by msg_id limit $1 for update skip locked)
    update pgmq.%I m set vt = clock_timestamp() + make_interval(secs => $2), read_ct = m.read_ct + 1 from c where m.msg_id = c.msg_id
    returning m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message', 'q_' || queue_name, 'q_' || queue_name) using qty, vt;
end $$;
create or replace function pgmq.archive(queue_name text, msg_id bigint) returns boolean language plpgsql as $$
declare n integer;
begin
  execute format('with a as (delete from pgmq.%I where msg_id = $1 returning *) insert into pgmq.%I (msg_id, read_ct, enqueued_at, vt, message) select msg_id, read_ct, enqueued_at, vt, message from a', 'q_' || queue_name, 'a_' || queue_name) using msg_id;
  get diagnostics n = row_count; return n > 0;
end $$;
create or replace function pgmq.set_vt(queue_name text, msg_id bigint, vt integer) returns setof pgmq.message_record language plpgsql as $$
begin
  return query execute format('update pgmq.%I m set vt = clock_timestamp() + make_interval(secs => $2) where m.msg_id = $1 returning m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message', 'q_' || queue_name) using msg_id, vt;
end $$;
-- } pgmq stand-in
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, created_at timestamptz default now(),
  metadata jsonb, unique (bucket_id, name));
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare p text[] := string_to_array(name, '/'); begin return p[1:array_length(p, 1) - 1]; end $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
insert into storage.buckets (id, name, public) values ('tally-days', 'tally-days', false) on conflict do nothing;
create table if not exists public.tally_jobs (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references public.firms(id), client_id text not null, book_id uuid,
  kind text not null check (kind in ('daybook', 'reparse')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  total integer not null default 0, done integer not null default 0, sealed boolean not null default false, bad jsonb not null default '[]'::jsonb,
  message text not null default '', created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.tally_jobs enable row level security;
do $$ begin if not exists (select 1 from pg_policies where tablename = 'tally_jobs') then
  create policy tally_jobs_read on public.tally_jobs for select to authenticated using (firm_id = my_firm()); end if; end $$;
grant select on public.tally_jobs to authenticated;
"""

fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER, GONE = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333", "22222222-2222-2222-2222-222222222222"
D1, D2, D3, DR = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002", "d3000000-0000-0000-0000-000000000003", "d4000000-0000-0000-0000-000000000004"
B1, B2, B9 = "11111111-1111-1111-1111-111111111111", "12222222-1111-1111-1111-111111111111", "19999999-1111-1111-1111-111111111111"
LEDGERS = [["Cash", "Cash-in-Hand", "-1000"], ["Sales", "Sales Accounts", "0"], ["Rent", "Indirect Expenses", "0"], ["Capital", "Capital Account", "1000"]]
GROUPS = [["Sales Accounts", ""], ["Indirect Expenses", ""], ["Capital Account", ""], ["Cash-in-Hand", ""]]
def V(guid, alter, day, narr=""):
    return {"guid": guid, "alter": alter, "type": "Sales", "no": guid.upper(), "party": "", "narr": narr, "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": day}
L = lambda guid, ledger, amount: [guid, ledger, amount, "", None, []]
def entry(lid, event, guid, alter, day, amt=10, ledger="Sales"):
    return {"line_id": lid, "event": event, "saved_at": "2026-10-04T10:00:00+05:30", "pc": "NWS144", "company_guid": "cg-1", "object_guid": guid, "master_id": "7", "alter_id": alter,
            "vch_type": "Sales", "vch_no": guid.upper(), "vch_date": day, "vouchers": [V(guid, alter, day)], "lines": [L(guid, ledger, amt), L(guid, "Cash", -amt)]}
def gone(lid, guid, alter, day):
    return {"line_id": lid, "event": "deleted", "saved_at": "2026-10-04T10:00:00+05:30", "pc": "NWS144", "object_guid": guid, "alter_id": alter, "vch_date": day}

# Round 21 (docs/reviews/migration-47-48-review.md): THE REAL pgmq for the queue. pgmq 1.5.1 (staging's) is plain SQL
# (pgmq-extension/sql/pgmq.sql, no C), so it is installed as an extension of pg_stand's PostgreSQL when its text is at hand:
# PGMQ_SQL (a file), else fetched once from GitHub (through the proxy, curl) into $TMPDIR. Without it (no network, a read-only
# share directory, or PGMQ_STUB=1) the stand-in in SCHEMA47 is used. The output says which.
PGMQ_VERSION = "1.5.1"
def real_pgmq():
    if os.environ.get("PGMQ_STUB"): return None
    try:
        share = subprocess.run([pg_stand.BIN + "/pg_config", "--sharedir"], capture_output=True, text=True).stdout.strip() or "/usr/share/postgresql/16"
        ext = os.path.join(share, "extension")
        ctl, sqlf = os.path.join(ext, "pgmq.control"), os.path.join(ext, "pgmq--%s.sql" % PGMQ_VERSION)
        if not (os.path.exists(ctl) and os.path.exists(sqlf)):
            src = os.environ.get("PGMQ_SQL") or os.path.join(os.environ.get("TMPDIR", "/tmp"), "pgmq-%s.sql" % PGMQ_VERSION)
            if not os.path.exists(src):
                url = "https://raw.githubusercontent.com/pgmq/pgmq/v%s/pgmq-extension/sql/pgmq.sql" % PGMQ_VERSION
                r = subprocess.run(["curl", "-sSfL", "--max-time", "60", "-o", src + ".part", url], capture_output=True, text=True)
                if r.returncode: print("  (the real pgmq could not be fetched: %s)" % r.stderr.strip()[-200:]); return None
                os.replace(src + ".part", src)
            text = open(src).read()
            if "CREATE FUNCTION pgmq.read(" not in text or re.search(r"(?i)\blanguage\s+c\b", text): print("  (the pgmq text is not the plain-SQL 1.5.1)"); return None
            open(sqlf, "w").write(text)
            open(ctl, "w").write("comment = 'A lightweight message queue (pgmq %s, plain SQL)'\ndefault_version = '%s'\nschema = 'pgmq'\nrelocatable = false\nsuperuser = false\n" % (PGMQ_VERSION, PGMQ_VERSION))
        return "the real pgmq %s (extension files in %s)" % (PGMQ_VERSION, ext)
    except Exception as e:
        print("  (the real pgmq not installed: %s)" % e); return None
PGMQ = real_pgmq()
print("== the queue: %s" % (PGMQ or "the pgmq stand-in (SCHEMA47)"))
db = pg_stand.start(30481)      # below the ephemeral range (32768-60999)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
def as_user(uid, stmt):
    try: return True, db.one("set fincom.role = 'authenticated'; set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def jn(s):
    try: return db.one(s)
    except RuntimeError as e: return "ERROR " + str(e)[-300:]
def j(s):
    x = jn(s)
    try: return json.loads(x) if x and not x.startswith("ERROR") else {"_error": x}
    except ValueError: return {"_error": x}
def table_hashes():
    """an md5 of every table's full content in every schema (pg_catalog and information_schema aside)"""
    out = {}
    for r in db.rows("select table_schema || '.' || table_name as t from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1"):
        t = r["t"]; sch, nm = t.split(".", 1)
        out[t] = db.one('select md5(coalesce(string_agg(x::text, \'|\' order by x::text), \'\')) from "%s"."%s" x' % (sch, nm))
    return out
apply = lambda lines, book=B1, dev=D1: j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(book), q(dev), js(lines)))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    if PGMQ:
        db.sql(re.sub(r"-- pgmq stand-in \{.*?-- \} pgmq stand-in\n", "", SCHEMA47, flags=re.S))
        db.sql("create extension if not exists pgmq;")          # as Supabase has it once Queues is on (staging: pgmq 1.5.1)
        ok(db.one("select extversion from pg_extension where extname = 'pgmq'") == PGMQ_VERSION, "the real pgmq %s is the queue here" % PGMQ_VERSION)
    else:
        db.sql(SCHEMA47)
    # Supabase's defaults (review M6, L8): the API roles get every table made in public and in pgmq (Queues exposed)
    db.sql("""grant usage on schema pgmq to anon, authenticated;
      alter default privileges in schema pgmq grant all on tables to anon, authenticated; alter default privileges in schema pgmq grant all on sequences to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated;""")
    db.sql("select pgmq.create('tally_work') where not exists (select 1 from pgmq.list_queues() where queue_name = 'tally_work');")    # migration 13's queue
    # review M7: another CHECK that names kind (it must survive 47's swap untouched)
    db.sql("alter table public.tally_jobs add constraint tally_jobs_reparse_book check (kind <> 'reparse' or book_id is not null);")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(T)s, %(F2)s, 'Them', 'owner', true), (%(G)s, %(F)s, 'Former', 'staff', false);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B1)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%(B2)s, %(F)s, 'c2', 'ZZ TWO', '2026-04-01', '2026-03-31'), (%(B9)s, %(F2)s, 'c9', 'THEIR CO', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version, created_at, info) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.2.0', now() - interval '30 days', jsonb_build_object('beat', jsonb_build_object('at', now(), 'tally', true))),
        (%(D2)s, %(F)s, 'NWS145', 'h2', '2.2.0', now() - interval '30 days', '{}'), (%(D3)s, %(F2)s, 'THEIRS', 'h3', '2.2.0', now() - interval '30 days', jsonb_build_object('beat', jsonb_build_object('at', now(), 'tally', true)));
      insert into tally_devices (id, firm_id, name, key_hash, revoked) values (%(DR)s, %(F)s, 'OLD-PC', 'h4', true);
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}'), ('c2', %(F)s, 'ZZ2', '{"choices": {}}');""" % {
        "F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "T": q(OTHER), "G": q(GONE), "D1": q(D1), "D2": q(D2), "D3": q(D3), "DR": q(DR), "B1": q(B1), "B2": q(B2), "B9": q(B9)})
    for path in FILES:
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    db.sql("alter default privileges in schema public grant execute on functions to anon, authenticated;")
    for b in (B1, B2):
        j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)::text" % (q(b), js(LEDGERS), js(GROUPS)))
        db.sql("update tally_ledgers set tally_guid = 'g-' || lower(name) where book_id = %s" % q(b))
    j("select tally_ingest_day(%s, '2026-05-02', %s, %s, 2, 5, 100)::text" % (q(B1), js([V("d1", 5, "2026-05-02"), V("d2", 5, "2026-05-02")]), js([L("d1", "Sales", 10), L("d1", "Cash", -10), L("d2", "Rent", -7), L("d2", "Cash", 7)])))
    # the populated state the alert jobs read: lines today (applied, held, failed), a gap, postings (done, one needing review)
    r = apply([entry("p1", "created", "e1", 20, "2026-05-03"), entry("p2", "created", "", 21, "2026-05-03"), {"line_id": "p3", "event": "created", "object_guid": "e9", "alter_id": 22}])
    ok(r.get("applied") == 1 and r.get("held") == 2, "the populated database: lines today applied 1, held 2 (%s)" % {k: r.get(k) for k in ("applied", "held", "failed")})
    j("select tally_start_point(%s, %s, 'cg-1', 40, 1, %s, 'go-1')::text" % (q(F), q(B1), q(D1)))
    g = j("select tally_recorder_gap_check(%s, %s, 47, now())::text" % (q(B1), q(D1)))
    ok(g.get("missing") == 7, "the populated database: a gap on ZZ CO (up to 7) (%s)" % g.get("missing"))
    db.sql("""insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status, results, updated_at) values
      ('00000001-0000-0000-0000-000000000001', %(F)s, 'c1', 'ZZ CO', '{"vouchers": []}', 2, 'done', '[{"id": "A1", "ok": true}, {"id": "A2", "needsReview": true, "accepted": true}]', now()),
      ('00000001-0000-0000-0000-000000000002', %(F)s, 'c1', 'ZZ CO', '{"vouchers": []}', 1, 'failed', '[]', now());""" % {"F": q(F)})
    counts = lambda: {t: db.one("select count(*) from %s" % t) for t in ("tally_devices", "tally_books", "tally_vouchers", "tally_recorder_lines", "tally_sync_cursor", "tally_jobs", "storage.buckets", "tally_ledgers")}
    before = counts()
    for i in (1, 2):
        r = psql_file(M47); ok(r.returncode == 0, "migration-47 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if r.returncode: raise SystemExit("cannot go on without the migration")
    after = counts()
    ok({k: v for k, v in after.items() if k != "storage.buckets"} == {k: v for k, v in before.items() if k != "storage.buckets"} and int(after["storage.buckets"]) == int(before["storage.buckets"]) + 1,
       "nothing deleted or added by the migration but the one bucket (%s)" % after)
    body = open(M47).read() if os.path.exists(M47) else ""
    low = body.lower()
    ok(body != "" and "delete from" not in low, "the text holds no 'delete from' anywhere (comments too)")
    rest = re.sub(r"alter table public\.tally_jobs drop constraint %i, add constraint %i check", "", low)
    ok(body != "" and not re.search(r"\b(drop|truncate)\s+(table|view|function|trigger|policy|column|index|schema|extension)\b", low) and "truncate " not in low
       and len(re.findall(r"drop constraint", low)) == 1 and "drop constraint" not in rest, "no drop or truncate; the one constraint swap (tally_jobs.kind, widened) only")
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", body, re.M) is not None and body.rstrip().endswith("commit;"), "begin; set local lock_timeout = '10s'; ... commit;")
    bodies = re.findall(r"create or replace function public\.(\w+)\((.*?)\)\s*returns.*?\$function\$(.*?)\$function\$", body, re.S)
    names = sorted(n for n, _, _ in bodies)
    ok(names == sorted(["tally_recorder_enqueue", "tally_recorder_drain", "tally_alert_working_now", "tally_alert_scan_gaps", "tally_alert_scan_silent", "tally_alert_daily_summary", "tally_alert_read",
                        "tally_device_recorder_source", "tally_recorder_line",
                        # round 21 (review 47/48): H1 send / order / failure, M1 take / settle / fail, L5 words, L6 who, M3 the upload's cursor, the gap check with lost lines
                        "tally_recorder_send", "tally_recorder_take", "tally_recorder_settle", "tally_recorder_fail", "tally_recorder_why", "tally_service_or_owner", "tally_try_uuid",
                        "tally_recorder_gap_check", "tally_upload_advance"]), "the functions in the file (%s)" % names)
    # review M1: the pg_cron drain is a PROCEDURE (it commits after each read and each message): PostgreSQL forbids COMMIT in a
    # security definer procedure or one with SET, so it is security invoker without SET, every name schema-qualified, and
    # executable by nobody but its owner (pg_cron runs it as the owner)
    procs = re.findall(r"create or replace procedure public\.(\w+)\((.*?)\)\s*language plpgsql as \$procedure\$(.*?)\$procedure\$", body, re.S)
    prow = (db.rows("select md5(prosrc) as m, prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf, prokind from pg_proc where proname = 'tally_recorder_drain_run' and pronamespace = 'public'::regnamespace") or [{}])[0]
    psrc = procs[0][2] if procs else ""
    ok(len(procs) == 1 and procs[0][0] == "tally_recorder_drain_run" and prow.get("m") == hashlib.md5(psrc.encode()).hexdigest() and prow.get("prokind") == "p" and prow.get("prosecdef") == "f" and prow.get("conf") == ""
       and not re.search(r"(?<![.\w])(tally_\w+|pgmq)\s*[.(]", re.sub(r"public\.tally_\w+|--[^\n]*", "", psrc)),
       "the procedure tally_recorder_drain_run: md5(prosrc) = %s; security invoker, no SET (COMMIT needs both), every name public.-qualified (%s)" % (hashlib.md5(psrc.encode()).hexdigest(), {k: prow.get(k) for k in ("prokind", "prosecdef", "conf")}))
    for name, args, src in bodies:
        rows = db.rows("select md5(prosrc) as m, prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(name))
        file_md5 = hashlib.md5(src.encode()).hexdigest()
        ok(len(rows) == 1 and rows[0]["m"] == file_md5 and rows[0]["prosecdef"] == "t" and rows[0]["conf"].replace(" ", "") == "search_path=public,pg_temp",
           "md5(prosrc) of %s = %s; security definer, search_path = public, pg_temp" % (name, file_md5))
    priv = lambda who, sig: jn("select has_function_privilege('%s', 'public.%s', 'execute')" % (who, sig))
    grants = {sig: (priv("anon", sig), priv("authenticated", sig), priv("service_role", sig)) for sig in (
        "tally_recorder_enqueue(uuid, uuid, uuid, jsonb)", "tally_recorder_drain(integer)", "tally_alert_scan_gaps()", "tally_alert_scan_silent()", "tally_alert_daily_summary()",
        "tally_alert_working_now(timestamptz)", "tally_alert_read(bigint)", "tally_device_recorder_source(uuid, text)", "tally_recorder_line(uuid, uuid, jsonb, bigint)",
        "tally_recorder_send(uuid, uuid, uuid, jsonb, boolean)", "tally_upload_advance(uuid, text, text, jsonb, integer)", "tally_recorder_gap_check(uuid, uuid, bigint, timestamptz)",
        "tally_recorder_take(integer)", "tally_recorder_settle(bigint, jsonb)", "tally_recorder_fail(bigint, jsonb, integer, text)", "tally_recorder_why(text, text)", "tally_service_or_owner()", "tally_try_uuid(text)",
        "tally_recorder_drain_run(integer)")}
    ok(grants == {"tally_recorder_enqueue(uuid, uuid, uuid, jsonb)": ("f", "f", "t"), "tally_recorder_drain(integer)": ("f", "f", "t"), "tally_alert_scan_gaps()": ("f", "f", "f"),
                  "tally_alert_scan_silent()": ("f", "f", "f"), "tally_alert_daily_summary()": ("f", "f", "f"), "tally_alert_working_now(timestamptz)": ("f", "f", "f"),
                  "tally_alert_read(bigint)": ("f", "t", "f"), "tally_device_recorder_source(uuid, text)": ("f", "t", "f"), "tally_recorder_line(uuid, uuid, jsonb, bigint)": ("f", "f", "f"),
                  "tally_recorder_send(uuid, uuid, uuid, jsonb, boolean)": ("f", "f", "t"), "tally_upload_advance(uuid, text, text, jsonb, integer)": ("f", "f", "t"), "tally_recorder_gap_check(uuid, uuid, bigint, timestamptz)": ("f", "f", "t"),
                  "tally_recorder_take(integer)": ("f", "f", "f"), "tally_recorder_settle(bigint, jsonb)": ("f", "f", "f"), "tally_recorder_fail(bigint, jsonb, integer, text)": ("f", "f", "f"), "tally_recorder_why(text, text)": ("f", "f", "f"),
                  "tally_service_or_owner()": ("f", "f", "f"), "tally_try_uuid(text)": ("f", "f", "f"), "tally_recorder_drain_run(integer)": ("f", "f", "f")},
       "grants: the queue the service role's; the alert jobs and the line nobody's (pg_cron runs them as the owner); the read and the owner's switch authenticated (checks inside); anon nothing (%s)" % grants)
    # ---------------------------------------------------------------- 1. the queue
    print("== 1. the recorder queue")
    ok(db.one("select count(*) from pgmq.list_queues() where queue_name = 'tally_recorder'") == "1", "pgmq queue tally_recorder made (once, after two runs)")
    m1 = jn("select tally_recorder_enqueue(%s, %s, %s, %s)::text" % (q(F), q(B1), q(D1), js([entry("q1", "created", "qv", 30, "2026-05-10", 100)])))
    m2 = jn("select tally_recorder_enqueue(%s, %s, %s, %s)::text" % (q(F), q(B1), q(D1), js([entry("q2", "altered", "qv", 31, "2026-05-11", 120)])))
    m3 = jn("select tally_recorder_enqueue(%s, %s, %s, %s)::text" % (q(F), q(B1), q(D1), js([gone("q3", "qv", 32, "2026-05-11"), entry("q4", "created", "qw", 33, "2026-05-11", 5)])))
    e1 = json.loads(m1) if m1 and m1.startswith("{") else {}
    ok(e1.get("ok") is True and e1.get("queued") == 1 and isinstance(e1.get("msg"), int) and db.one("select count(*) from pgmq.q_tally_recorder") == "3",
       "tally_recorder_enqueue: one message per call ({ok, msg, queued}) (%s)" % m1)
    ok(db.one("select count(*) from tally_vouchers where guid in ('qv', 'qw')") == "0" and db.one("select count(*) from tally_recorder_lines where line_id like 'q%'") == "0", "queued: nothing applied yet")
    bad = [jn("select tally_recorder_enqueue(%s, %s, %s, %s)::text" % (q(F), q(B9), q(D1), js([entry("x", "created", "x", 1, "2026-05-10")]))),
           jn("select tally_recorder_enqueue(%s, %s, %s, '{}'::jsonb)::text" % (q(F), q(B1), q(D1))),
           jn("select tally_recorder_enqueue(%s, %s, %s, %s)::text" % (q(F), q(B1), q(D3), js([entry("x", "created", "x", 1, "2026-05-10")])))]
    ok(all(b.startswith("ERROR") for b in bad) and db.one("select count(*) from pgmq.q_tally_recorder") == "3", "enqueue refuses another firm's book, a non-list, another firm's computer (%s)" % [b[-80:] for b in bad])
    good, out = as_user(OWNER, "select tally_recorder_enqueue(%s, %s, %s, %s)::text" % (q(F), q(B1), q(D1), js([])))
    ok(not good, "enqueue refused to a signed-in owner (%s)" % out[-80:])
    good, out = as_user(OWNER, "select tally_recorder_drain(1000)::text")
    ok(not good, "drain refused to a signed-in owner (%s)" % out[-80:])
    d = j("select tally_recorder_drain(20000)::text")
    v = (db.rows("select alter_id, deleted_at is not null as gone, day from tally_vouchers where book_id = %s and guid = 'qv'" % q(B1)) or [{}])[0]
    st = {x["line_id"]: x["state"] for x in db.rows("select line_id, state from tally_recorder_lines where line_id like 'q%' order by id")}
    order = [x["line_id"] for x in db.rows("select line_id from tally_recorder_lines where line_id like 'q%' order by id")]
    ok(d.get("ok") is True and d.get("done") == 3 and st == {"q1": "applied", "q2": "applied", "q3": "applied", "q4": "applied"} and order == ["q1", "q2", "q3", "q4"]
       and v == {"alter_id": "32", "gone": "t", "day": "2026-05-11"}, "drain: three messages applied one at a time, in order: created, altered (moved a day), deleted (%s; %s; %s)" % (d, st, v))
    ok(db.one("select count(*) from pgmq.q_tally_recorder") == "0" and db.one("select count(*) from pgmq.a_tally_recorder") == "3", "each applied message archived (kept), the queue empty")
    ok(db.one("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and ledger = 'Sales' and day in ('2026-05-10', '2026-05-11')" % q(B1)) == "5", "the day cache after the drain: only qw's 5 (qv moved, then deleted)")
    ok(db.one("select recorder_max_alter from tally_sync_cursor where book_id = %s" % q(B1)) == "33", "the recorder's highest AlterID raised by the drain (33)")
    d0 = j("select tally_recorder_drain(20000)::text")
    ok(d0.get("done") == 0, "drain with nothing queued: done 0 (%s)" % d0)
    # as pg_cron runs it: no JWT, so Supabase's auth.role() is null (the checks `auth.role() <> 'service_role'` let it through)
    db.sql("select tally_recorder_enqueue(%s, %s, %s, %s)" % (q(F), q(B1), q(D1), js([entry("c1", "created", "cv", 34, "2026-05-13", 3)])))
    db.sql("alter function auth.role() rename to role_stand; create function auth.role() returns text language sql stable as $$ select null::text $$;")
    d = j("select tally_recorder_drain(20000)::text")
    db.sql("drop function auth.role(); alter function auth.role_stand() rename to role;")
    ok(d.get("done") == 1 and db.one("select state from tally_recorder_lines where line_id = 'c1'") == "applied", "the drain as pg_cron runs it (auth.role() null): applied (%s)" % d)
    # retries: a message that fails is tried again, then after 5 tries archived and kept with words
    db.sql("select pgmq.send('tally_recorder', %s)" % js({"firm": F, "book": "1aaaaaaa-1111-1111-1111-111111111111", "device": D1, "lines": [entry("r1", "created", "rv", 1, "2026-05-10")]}))
    tries = []
    for i in range(6):
        d = j("select tally_recorder_drain(5000)::text")
        tries.append((d.get("done"), d.get("retried"), d.get("failed")))
        db.sql("update pgmq.q_tally_recorder set vt = now() - interval '1 second'")     # its time is up: seen again
    ok(tries[:4] == [(0, 1, 0)] * 4 and tries[4] == (0, 0, 1) and tries[5] == (0, 0, 0), "a failing message: tried again 4 times, the 5th failure archived and counted failed (%s)" % tries)
    fl = (db.rows("select tries, lines, why, book_id, firm_id, msg_id is not null as m, line_ids::text as ids from tally_recorder_failures") or [{}])[0]
    ok(fl.get("tries") == "5" and fl.get("lines") == "1" and "no such book" in (fl.get("why") or "") and fl.get("firm_id") == F and fl.get("ids") == '["r1"]' and db.one("select count(*) from pgmq.q_tally_recorder") == "0",
       "kept in tally_recorder_failures with words (no such book), the tries, the line ids; the queue empty (%s)" % fl)
    good, out = as_user(STAFF, "select count(*) from tally_recorder_failures"); good2, out2 = as_user(OTHER, "select count(*) from tally_recorder_failures")
    ok(good and out == "1" and good2 and out2 == "0", "tally_recorder_failures: the firm reads its rows, another firm none (%s / %s)" % (out, out2))
    good, out = as_user(OWNER, "insert into tally_recorder_failures (firm_id, msg_id, tries, why) values (%s, 99, 1, 'x') returning id" % q(F))
    ok(not good, "nobody writes tally_recorder_failures directly (%s)" % out[-80:])
    cron = {x["jobname"]: (x["schedule"], x["command"]) for x in db.rows("select jobname, schedule, command from cron.job")}
    ok(cron.get("tally-recorder-drain", ("", ""))[0] == "30 seconds" and cron.get("tally-recorder-drain", ("", ""))[1] == "call public.tally_recorder_drain_run(15000)",
       "cron tally-recorder-drain every 30 seconds: call public.tally_recorder_drain_run(15000), the SQL directly (no HTTP), committing per message (review M1) (%s)" % (cron.get("tally-recorder-drain"),))
    # ---------------------------------------------------------------- 4. ledger_altered with a known GUID under another name
    print("== 4. ledger_altered -> rename")
    r = apply([entry("n0", "created", "nv", 40, "2026-05-12", 7, ledger="Rent"), {"line_id": "n1", "event": "ledger_altered", "object_guid": "g-rent", "name": "Rent Paid", "alter_id": 3, "saved_at": "2026-10-04T10:00:00+05:30"}])
    st = {x["line_id"]: (x["state"], x.get("why")) for x in r.get("results") or []}
    ok(st.get("n1", ("",))[0] == "applied" and db.one("select count(*) from tally_ledgers where book_id = %s and name = 'Rent Paid' and tally_guid = 'g-rent' and renamed_at is not null" % q(B1)) == "1"
       and db.one("select count(*) from tally_lines where book_id = %s and ledger = 'Rent Paid'" % q(B1)) == "2" and db.one("select count(*) from tally_lines where book_id = %s and ledger = 'Rent'" % q(B1)) == "0",
       "ledger_altered, GUID g-rent held as Rent, now 'Rent Paid': tally_ledger_rename (renamed_at; the lines follow) (%s)" % (st.get("n1"),))
    r = apply([{"line_id": "n2", "event": "ledger_altered", "object_guid": "g-sales", "name": "Sales", "saved_at": "2026-10-04T10:00:00+05:30"},
               {"line_id": "n3", "event": "ledger_altered", "object_guid": "g-nobody", "name": "New Name", "saved_at": "2026-10-04T10:00:00+05:30"},
               {"line_id": "n4", "event": "ledger_created", "object_guid": "g-new", "name": "Brand New", "saved_at": "2026-10-04T10:00:00+05:30"}])
    st = {x["line_id"]: (x["state"], x.get("why")) for x in r.get("results") or []}
    ok(st.get("n2") == ("held", "ledger lines applied by the next ledger list") and st.get("n3") == ("held", "ledger lines applied by the next ledger list") and st.get("n4") == ("held", "ledger lines applied by the next ledger list")
       and db.one("select count(*) from tally_ledgers where book_id = %s and name in ('New Name', 'Brand New')" % q(B1)) == "0",
       "ledger_altered under the same name, or an unknown GUID, and ledger_created: held as before (%s)" % st)
    # ---------------------------------------------------------------- 3. the recorder source per computer
    print("== 3. tally_devices.recorder_source")
    col = (db.rows("select data_type, is_nullable, column_default from information_schema.columns where table_name = 'tally_devices' and column_name = 'recorder_source'") or [{}])[0]
    ok(col.get("data_type") == "text" and col.get("is_nullable") == "NO" and "addon" in (col.get("column_default") or ""), "tally_devices.recorder_source text not null default 'addon' (%s)" % col)
    ok(db.one("select count(*) from tally_devices where recorder_source = 'addon'") == db.one("select count(*) from tally_devices"), "every existing computer: addon")
    ok(jn("update tally_devices set recorder_source = 'tdl' where id = %s" % q(D2)).startswith("ERROR"), "the column's check refuses another value")
    rs = lambda d: db.one("select recorder_source || '/' || (recorder_source_at is not null)::text || '/' || coalesce(recorder_source_by::text, '') from tally_devices where id = %s" % q(d))
    good, out = as_user(OWNER, "select tally_device_recorder_source(%s, 'both')::text" % q(D1)); r = json.loads(out) if good else {}
    ok(good and r.get("ok") is True and r.get("recorderSource") == "both" and r.get("device") == D1 and rs(D1) == "both/true/" + OWNER, "the owner sets 'both': stamped at and by (%s; %s)" % (out, rs(D1)))
    good, out = as_user(OWNER, "select tally_device_recorder_source(%s, 'alterid')::text" % q(D1))
    ok(good and rs(D1).startswith("alterid/"), "the owner sets 'alterid' (%s)" % rs(D1))
    for who, dev, val, words, label in ((STAFF, D1, "addon", "only an owner", "staff refused"), (GONE, D1, "addon", "", "a former member refused"), (OTHER, D1, "addon", "not a computer of your firm", "another firm's owner refused"),
                                        (OWNER, D3, "addon", "not a computer of your firm", "another firm's computer refused"), (OWNER, DR, "addon", "not a computer of your firm", "a revoked computer refused"),
                                        (OWNER, D1, "tdl", "addon, alterid or both", "a bad value refused with words"), (OWNER, D1, None, "addon, alterid or both", "null refused with words")):
        good, out = as_user(who, "select tally_device_recorder_source(%s, %s)::text" % (q(dev), "null" if val is None else q(val)))
        ok(not good and words in out and rs(D1).startswith("alterid/"), "recorder source: %s (%s)" % (label, out.strip().splitlines()[0][-110:] if out else out))
    good, out = as_user(STAFF, "select count(*) filter (where recorder_source is not null) || '/' || count(*) from tally_devices")
    ok(good and out == "3/3", "the firm reads the column (its own computers only) (%s %s)" % (good, out))
    # ---------------------------------------------------------------- 2. alerts
    print("== 2. alerts")
    ok(db.one("select relrowsecurity from pg_class where oid = 'public.tally_alerts'::regclass") == "t" and db.one("select count(*) from pg_policies where tablename = 'tally_alerts' and cmd = 'SELECT'") == "1"
       and db.one("select count(*) from pg_policies where tablename = 'tally_alerts' and cmd <> 'SELECT'") == "0", "tally_alerts: RLS on, one select policy, no write policy")
    ok(jn("select has_table_privilege('authenticated', 'public.tally_alerts', 'insert') or has_table_privilege('authenticated', 'public.tally_alerts', 'update') or has_table_privilege('authenticated', 'public.tally_alerts', 'delete') or has_table_privilege('anon', 'public.tally_alerts', 'select')") == "f",
       "tally_alerts: authenticated select only (no insert, update, delete); anon nothing")
    ok(jn("select tally_alert_working_now('2026-10-05 03:29:00+00')") == "f" and jn("select tally_alert_working_now('2026-10-05 03:30:00+00')") == "t" and jn("select tally_alert_working_now('2026-10-05 13:30:00+00')") == "t"
       and jn("select tally_alert_working_now('2026-10-05 13:31:00+00')") == "f" and jn("select tally_alert_working_now('2026-10-04 06:00:00+00')") == "f" and jn("select tally_alert_working_now('2026-10-10 06:00:00+00')") == "t",
       "working hours: Mon 08:59 IST no, 09:00 yes, 19:00 yes, 19:01 no; Sunday no; Saturday yes")
    others = lambda h: {k: v for k, v in h.items() if k != "public.tally_alerts"}
    h0 = table_hashes()
    ok(len(h0) > 30, "the hash covers every table of every schema (%d tables)" % len(h0))
    r = j("select tally_alert_scan_gaps()::text"); h1 = table_hashes()
    ga = (db.rows("select firm_id, client_id, book_id, device_id, day = (now() at time zone 'Asia/Kolkata')::date as today, words, data->>'missing' as missing, read_at from tally_alerts where kind = 'gap' and device_id is null") or [{}])
    ok(r.get("ok") is True and len(ga) == 1 and ga[0].get("book_id") == B1 and ga[0].get("client_id") == "c1" and ga[0].get("today") == "t" and ga[0].get("missing") == "7" and "ZZ CO" in ga[0].get("words", "") and "up to 7 changes not received" in ga[0].get("words", ""),
       "scan_gaps: one 'gap' alert for ZZ CO today, its words and the gap (%s)" % ga)
    ok(others(h1) == others(h0) and h1["public.tally_alerts"] != h0["public.tally_alerts"], "scan_gaps wrote tally_alerts only: every other table identical (%s)" % [k for k in h1 if h1[k] != h0.get(k)])
    j("select tally_alert_scan_gaps()::text"); h2 = table_hashes()
    ok(db.one("select count(*) from tally_alerts where kind = 'gap' and device_id is null") == "1" and h2 == h1, "scan_gaps again, the same gap: still one alert, nothing changed at all")
    j("select tally_recorder_gap_check(%s, %s, 52, now())::text" % (q(B1), q(D1)))
    good, out = as_user(STAFF, "select tally_alert_read(id)::text from tally_alerts where kind = 'gap' and device_id is null")
    ok(good and db.one("select read_by from tally_alerts where kind = 'gap' and device_id is null") == STAFF, "a member (staff) marks the gap alert read (%s)" % out)
    j("select tally_alert_scan_gaps()::text")
    ga = (db.rows("select data->>'missing' as missing, words, read_at from tally_alerts where kind = 'gap' and device_id is null") or [{}])
    ok(len(ga) == 1 and ga[0].get("missing") == "12" and "up to 12" in ga[0].get("words", "") and not ga[0].get("read_at"), "the gap grew (12): the same row updated, unread again (%s)" % ga)
    db.sql("update tally_alerts set day = day - 1 where kind = 'gap' and device_id is null")       # yesterday's alert
    j("select tally_alert_scan_gaps()::text")
    ok(db.one("select count(*) from tally_alerts where kind = 'gap' and device_id is null") == "2", "a new day: a new gap alert (one per book and day)")
    h0 = table_hashes()
    db.sql("create or replace function public.tally_alert_working_now(p_at timestamptz) returns boolean language sql as $$ select false $$")     # outside hours (the stand-in)
    r = j("select tally_alert_scan_silent()::text")
    ok(r.get("skipped") and db.one("select count(*) from tally_alerts where kind = 'silent'") == "0" and table_hashes() == h0, "scan_silent outside Mon-Sat 09:00-19:00 IST: skipped, nothing written (%s)" % r)
    db.sql("create or replace function public.tally_alert_working_now(p_at timestamptz) returns boolean language sql as $$ select true $$")      # inside hours
    r = j("select tally_alert_scan_silent()::text"); h1 = table_hashes()
    si = {x["device_id"]: x for x in db.rows("select firm_id, device_id, book_id, words, data->>'name' as name from tally_alerts where kind = 'silent'")}
    ok(r.get("ok") is True and set(si) == {D3} and si[D3]["firm_id"] == F2 and "THEIRS" in si[D3]["words"] and not si[D3]["book_id"],
       "scan_silent: a 'silent' alert for THEIRS (Tally open today, no line for a working day), none for NWS144 (lines today) or NWS145 (no beat) (%s)" % si)
    ok(others(h1) == others(h0), "scan_silent wrote tally_alerts only (%s)" % [k for k in h1 if h1[k] != h0.get(k)])
    j("select tally_alert_scan_silent()::text")
    ok(db.one("select count(*) from tally_alerts where kind = 'silent'") == "1", "scan_silent again: still one per computer and day")
    h0 = table_hashes()
    r = j("select tally_alert_daily_summary()::text"); h1 = table_hashes()
    sm = {x["firm_id"]: x for x in db.rows("select firm_id, book_id, device_id, words, data::text as data from tally_alerts where kind = 'summary'")}
    dF = json.loads(sm.get(F, {}).get("data") or "{}")
    ok(r.get("ok") is True and set(sm) == {F, F2} and not sm[F]["book_id"] and not sm[F]["device_id"], "summary: one per firm with books (%s)" % list(sm))
    ok(dF.get("applied") == 8 and dF.get("held") == 5 and dF.get("failed") == 0 and dF.get("queueFailed") == 1 and dF.get("gaps") == 1 and dF.get("postingsDone") == 1 and dF.get("postingsFailed") == 1 and dF.get("needsReview") == 1,
       "summary's counts for today: lines applied 8 / held 5 / failed 0, 1 queue failure, 1 open gap, postings done 1 / failed 1, 1 entry needs review (%s)" % dF)
    ok("8 recorder lines applied" in sm[F]["words"] and "1 open gap" in sm[F]["words"] and "1 needs review" in sm[F]["words"], "summary's words (%s)" % sm[F]["words"])
    ok(others(h1) == others(h0), "the summary wrote tally_alerts only (%s)" % [k for k in h1 if h1[k] != h0.get(k)])
    j("select tally_alert_daily_summary()::text")
    ok(db.one("select count(*) from tally_alerts where kind = 'summary'") == "2", "the summary again: still one per firm and day")
    ok(jn("insert into tally_alerts (firm_id, kind, day, words) values (%s, 'summary', (now() at time zone 'Asia/Kolkata')::date, 'x')" % q(F)).startswith("ERROR"), "the unique index: a second summary of the firm for the day refused")
    ok(jn("insert into tally_alerts (firm_id, kind, day, words) values (%s, 'news', current_date, 'x')" % q(F)).startswith("ERROR"), "kind is gap, silent or summary only")
    # read marking and RLS
    good, out = as_user(STAFF, "select count(*) from tally_alerts"); good2, out2 = as_user(OTHER, "select string_agg(kind, ',' order by kind) from tally_alerts")
    ok(good and out == "4" and good2 and out2 == "silent,summary", "RLS: each firm reads its own alerts (2 gap, 1 failed queued send, 1 summary) (%s / %s)" % (out, out2))
    aid = db.one("select id from tally_alerts where kind = 'summary' and firm_id = %s" % q(F))
    good, out = as_user(OTHER, "select tally_alert_read(%s)::text" % aid)
    ok(not good and "not an alert of your firm" in out and not db.one("select read_at from tally_alerts where id = %s" % aid), "another firm's member cannot mark it read (%s)" % out.strip().splitlines()[0][-90:])
    good, out = as_user(GONE, "select tally_alert_read(%s)::text" % aid)
    ok(not good and not db.one("select read_at from tally_alerts where id = %s" % aid), "a former member cannot mark it read")
    good, out = as_user(OWNER, "select tally_alert_read(%s)::text" % aid); r = json.loads(out) if good else {}
    ok(good and r.get("ok") is True and r.get("readBy") == OWNER and db.one("select read_by from tally_alerts where id = %s" % aid) == OWNER, "the owner marks it read (%s)" % out)
    good, out = as_user(STAFF, "select tally_alert_read(%s)::text" % aid)
    ok(good and db.one("select read_by from tally_alerts where id = %s" % aid) == OWNER, "marked again by staff: the first reader kept")
    good, out = as_user(OWNER, "update tally_alerts set read_at = null returning id")
    ok(not good or out in (None, ""), "no direct update by a member (%s)" % out)
    cron = {x["jobname"]: (x["schedule"], x["command"]) for x in db.rows("select jobname, schedule, command from cron.job")}
    ok(cron.get("tally-alert-gaps", ("",))[0] == "*/10 * * * *" and "tally_alert_scan_gaps()" in cron.get("tally-alert-gaps", ("", ""))[1]
       and cron.get("tally-alert-silent", ("",))[0] == "*/30 3-13 * * 1-6" and "tally_alert_scan_silent()" in cron.get("tally-alert-silent", ("", ""))[1]
       and cron.get("tally-alert-summary", ("",))[0] == "30 13 * * *" and "tally_alert_daily_summary()" in cron.get("tally-alert-summary", ("", ""))[1]
       and not any("http" in c for _, c in cron.values()), "cron: gaps every 10 minutes, silent */30 3-13 UTC Mon-Sat, summary 13:30 UTC (19:00 IST), all plain SQL (%s)" % cron)
    # ---------------------------------------------------------------- 5. storage
    print("== 5. the tally-uploads bucket")
    bk = (db.rows("select public, file_size_limit from storage.buckets where id = 'tally-uploads'") or [{}])[0]
    ok(bk == {"public": "f", "file_size_limit": "2147483648"}, "bucket tally-uploads: private, 2 GB limit (%s)" % bk)
    put = lambda uid, name: as_user(uid, "insert into storage.objects (bucket_id, name, owner) values ('tally-uploads', %s, %s) returning name" % (q(name), q(uid)))
    g1, o1 = put(STAFF, F + "/job-1.xml"); g2, o2 = put(STAFF, F2 + "/job-2.xml"); g3, o3 = put(OTHER, F2 + "/job-3.xml"); g4, o4 = put(OWNER, "job-4.xml")
    ok(g1 and not g2 and g3 and not g4, "members add under their own firm's folder only (staff own %s, staff other %s, other own %s, top level %s)" % (g1, g2, g3, g4))
    good, out = as_user(STAFF, "select string_agg(name, ',') from storage.objects where bucket_id = 'tally-uploads'")
    ok(good and out == F + "/job-1.xml", "members read their firm's objects only (%s)" % out)
    good, out = as_user(STAFF, "update storage.objects set name = name || '.x' where bucket_id = 'tally-uploads' returning name")
    good2, out2 = as_user(OWNER, "delete from storage.objects where bucket_id = 'tally-uploads' returning name")
    ok((not good or not out) and (not good2 or not out2) and db.one("select count(*) from storage.objects where bucket_id = 'tally-uploads'") == "2", "no update or delete by a member (%s %s)" % (out, out2))
    good, out = as_user(STAFF, "insert into storage.objects (bucket_id, name) values ('tally-days', %s) returning name" % q(F + "/x.xml.gz"))
    ok(not good, "the policies are tally-uploads' only: no insert into another bucket")
    # ---------------------------------------------------------------- 6. tally_jobs kind 'upload'
    print("== 6. tally_jobs kind upload")
    ok(not jn("insert into tally_jobs (firm_id, client_id, kind) values (%s, 'c1', 'upload') returning kind" % q(F)).startswith("ERROR"), "tally_jobs takes kind 'upload'")
    ok(not jn("insert into tally_jobs (firm_id, client_id, kind) values (%s, 'c1', 'daybook') returning kind" % q(F)).startswith("ERROR"), "and still daybook")
    ok(jn("insert into tally_jobs (firm_id, client_id, kind) values (%s, 'c1', 'bogus') returning kind" % q(F)).startswith("ERROR"), "and still refuses an unknown kind")
    kd = {x["conname"]: x["d"] for x in db.rows("select conname, pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.tally_jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'")}
    ok(kd == {"tally_jobs_kind_check": "CHECK ((kind = ANY (ARRAY['daybook'::text, 'reparse'::text, 'upload'::text])))", "tally_jobs_reparse_book": "CHECK (((kind <> 'reparse'::text) OR (book_id IS NOT NULL)))"},
       "M7. the kind list swapped by its exact old text (not stacked); the other CHECK that names kind left as it was (%s)" % kd)
    col = (db.rows("select data_type, is_nullable from information_schema.columns where table_name = 'tally_jobs' and column_name = 'upload'") or [{}])[0]
    ok(col == {"data_type": "jsonb", "is_nullable": "YES"} and db.one("select count(*) from tally_jobs where upload is not null") == "0", "tally_jobs.upload jsonb (the stored file's path, period, size, name), empty on every old job (%s)" % col)
    r = psql_file(M47)
    ok(r.returncode == 0 and db.one("select count(*) from tally_alerts") == "6" and rs(D1).startswith("alterid/") and db.one("select count(*) from tally_jobs where kind = 'upload'") == "1",
       "migration-47 a third time over used tables: the alerts, the owner's choice and the upload job kept (%s)" % (r.stderr or "").strip()[-200:])

    # ================================================================ round 21: docs/reviews/migration-47-48-review.md
    print("== review 47/48: H1 (per book in order; a failed queued send never silent)")
    sendq = lambda lines, queue, book=B2: j("select tally_recorder_send(%s, %s, %s, %s, %s)::text" % (q(F), q(book), q(D1), js(lines), "true" if queue else "false"))
    lstate = lambda pre, book=B2: [(x["line_id"], x["state"]) for x in db.rows("select line_id, state from tally_recorder_lines where book_id = %s and line_id like %s order by id" % (q(book), q(pre + "%")))]
    pend = lambda book=B2: db.one("select count(*) from tally_recorder_pending where book_id = %s and state = 'pending'" % q(book))
    def vt0(): db.sql("update pgmq.q_tally_recorder set vt = now() - interval '1 second'")
    j("select tally_start_point(%s, %s, 'cg-2', 1000, 1, %s, 'go-1')::text" % (q(F), q(B2), q(D1)))
    # a failure only for the first message: its line h00 cannot be stored (an internal error with raw text that must not reach the firm)
    db.sql("""create or replace function public.test_boom() returns trigger language plpgsql as $$ begin
                if new.line_id = 'h00' and new.state = 'received' then raise exception 'boom (test) internal detail xyz' using errcode = 'XX001'; end if; return new; end $$;
              create trigger test_boom before insert on public.tally_recorder_lines for each row execute function public.test_boom();""")
    big = [entry("h%02d" % i, "created", "hv%02d" % i, 1001 + i, "2026-06-01", 10 + i) for i in range(60)]
    small = [entry("h%02d" % i, "created", "hv%02d" % i, 1001 + i, "2026-06-02", 5) for i in range(60, 63)]
    s1 = sendq(big, True)
    ok(s1.get("ok") is True and s1.get("queued") == 60 and s1.get("behind") == 0 and pend() == "1", "H1. tally_recorder_send(queue): 60 lines queued, the book has 1 message pending (%s)" % {k: s1.get(k) for k in ("queued", "behind", "_error")})
    s2 = sendq(small, False)
    ok(s2.get("queued") == 3 and s2.get("behind") == 1 and lstate("h") == [] and pend() == "2",
       "H1. 3 lines for the same book while a message is pending: queued behind it, not applied directly (%s)" % {k: s2.get(k) for k in ("queued", "behind", "applied", "_error")})
    s3 = sendq([entry("o1", "created", "ov1", 60, "2026-06-03", 1)], False, B1)
    ok(s3.get("applied") == 1 and not s3.get("queued"), "H1. another book is not held back: applied directly (%s)" % {k: s3.get(k) for k in ("applied", "queued", "_error")})
    runs = []
    for i in range(5):
        runs.append(j("select tally_recorder_drain(5000)::text")); vt0()
    ok([(x.get("done"), x.get("retried"), x.get("waiting")) for x in runs[:4]] == [(0, 1, 1)] * 4 and (runs[4].get("failed"), runs[4].get("done")) == (1, 1),
       "H1. the failing message tried 4 times, the one behind it waits its turn (not a try); the 5th failure archives it and the next applies in the same run (%s)" % [{k: x.get(k) for k in ("done", "retried", "waiting", "failed")} for x in runs])
    order = lstate("h")
    ok(order == [("h%02d" % i, "failed") for i in range(60)] + [("h%02d" % i, "applied") for i in range(60, 63)],
       "H1. the failed send's 60 lines written as 'failed' rows (Sync activity shows them), then the 3 behind applied, in that order (%s ... %s)" % (order[:2], order[-4:]))
    hw = db.one("select held_why from tally_recorder_lines where line_id = 'h05' and book_id = %s" % q(B2)) or ""
    ok(hw.startswith("queued send failed after 5 tries") and "an internal error (code XX001)" in hw and "xyz" not in hw, "H1/L5. their words: plain, the raw error kept out (%s)" % hw)
    fw = db.one("select why from tally_recorder_failures where book_id = %s" % q(B2)) or ""
    ok("stopped after 5 tries" in fw and "XX001" in fw and "xyz" not in fw and "boom" not in fw, "L5. tally_recorder_failures.why: plain words, no raw error text (%s)" % fw)
    al = (db.rows("select words, data::text as data, read_at from tally_alerts where kind = 'gap' and book_id = %s and device_id = %s" % (q(B2), q(D1))) or [{}])[0]
    ok("ZZ TWO" in (al.get("words") or "") and "60 changes" in (al.get("words") or "") and "not applied" in (al.get("words") or "") and not al.get("read_at"),
       "H1. a 'gap' alert for the book the same minute (the computer named), unread (%s)" % al.get("words"))
    g = j("select tally_recorder_gap_check(%s, %s, 1063, now())::text" % (q(B2), q(D1)))
    ok(g.get("missing") == 60 and "queued send" in str((g.get("gap") or {}).get("words")), "H1. the gap check is not fooled: Tally at 1063, the recorder's highest 1063, yet up to 60 not received (the failed send) (%s)" % {k: g.get(k) for k in ("missing", "_error")})
    db.sql("drop trigger test_boom on public.tally_recorder_lines")
    s4 = sendq(big, False)
    g = j("select tally_recorder_gap_check(%s, %s, 1063, now())::text" % (q(B2), q(D1)))
    ok(s4.get("applied") == 60 and g.get("missing") is None and g.get("matched") is True, "H1. the same 60 sent again (nothing pending: applied directly): the gap closes (%s; %s)" % ({k: s4.get(k) for k in ("applied", "queued")}, {k: g.get(k) for k in ("missing", "matched")}))
    ok(db.one("select relrowsecurity from pg_class where oid = 'public.tally_recorder_pending'::regclass") == "t" and as_user(STAFF, "select count(*) from tally_recorder_pending")[0] is False,
       "H1. tally_recorder_pending: RLS on, the firm's members read nothing")

    print("== M1: the try counted before the apply; a stuck message fails by itself and is counted")
    holder = subprocess.Popen(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-q"],
                              stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
    holder.stdin.write("select pg_advisory_lock(hashtext(%s));\nselect pg_sleep(300);\n" % q(B2)); holder.stdin.flush()
    for _ in range(50):
        if db.one("select count(*) from pg_locks where locktype = 'advisory' and granted") != "0": break
        time.sleep(0.1)
    db.sql("select tally_recorder_enqueue(%s, %s, %s, %s)" % (q(F), q(B1), q(D1), js([entry("ma", "created", "mav", 70, "2026-06-04", 2)])))
    db.sql("select tally_recorder_enqueue(%s, %s, %s, %s)" % (q(F), q(B2), q(D1), js([entry("ms", "created", "msv", 1070, "2026-06-04", 3)])))
    sid = db.one("select max(msg_id) from tally_recorder_pending where book_id = %s" % q(B2))
    def cron_run(stmt):
        try: db.sql(stmt); return "ok"
        except RuntimeError as e: return "ERROR " + str(e)[-160:]
    outs, el = [], []
    for i in range(5):
        t0 = time.time(); outs.append(cron_run("set statement_timeout = '2s';\ncall public.tally_recorder_drain_run(15000);")); el.append(round(time.time() - t0, 1)); vt0()
    tr = (db.rows("select tries, state, why from tally_recorder_pending where msg_id = %s" % (sid or 0)) or [{}])[0]
    fr = (db.rows("select tries, why from tally_recorder_failures where msg_id = %s" % (sid or 0)) or [{}])[0]
    ok(outs == ["ok"] * 5 and lstate("ma", B1) == [("ma", "applied")], "M1. pg_cron's call under a 2 s statement timeout: no error; the message before the stuck one applied and kept (%s %s)" % (outs, lstate("ma", B1)))
    ok(tr.get("tries") == "5" and tr.get("state") == "failed" and fr.get("tries") == "5" and "did not finish in time" in (fr.get("why") or "") and all(x < 4 for x in el)
       and db.one("select count(*) from pgmq.q_tally_recorder where msg_id = %s" % (sid or 0)) == "0" and lstate("ms") == [("ms", "failed")],
       "M1. a message cancelled on every try: each try counted (committed before the apply), the 5th archives it with words, its line 'failed' (%s; %s; %s s a run)" % (tr, fr.get("why"), el))
    db.sql("select tally_recorder_enqueue(%s, %s, %s, %s)" % (q(F), q(B1), q(D1), js([entry("mc", "created", "mcv", 71, "2026-06-04", 2)])))
    db.sql("select tally_recorder_enqueue(%s, %s, %s, %s)" % (q(F), q(B2), q(D1), js([entry("ml", "created", "mlv", 1071, "2026-06-04", 4)])))
    lid = db.one("select max(msg_id) from tally_recorder_pending where book_id = %s" % q(B2))
    t0 = time.time(); o = cron_run("call public.tally_recorder_drain_run(3000);"); took = time.time() - t0
    tl = (db.rows("select tries, state, why from tally_recorder_pending where msg_id = %s" % (lid or 0)) or [{}])[0]
    ok(o == "ok" and took < 5 and lstate("mc", B1) == [("mc", "applied")] and tl.get("tries") == "1" and tl.get("state") == "pending" and "busy" in (tl.get("why") or ""),
       "M1. a message waiting on a lock (no statement timeout): its own lock timeout within the 3 s budget, counted (1 try, 'busy'), the other book's applied (%.1f s; %s)" % (took, tl))
    db.sql("select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory' and granted and pid <> pg_backend_pid()")
    holder.kill(); holder.wait()
    time.sleep(0.5); vt0()
    o = cron_run("call public.tally_recorder_drain_run(5000);")
    ok(o == "ok" and lstate("ml") == [("ml", "applied")] and pend() == "0", "M1. the lock free: the next run applies it (%s)" % lstate("ml"))

    print("== M6: the queue's tables closed to the API roles")
    pv = {(r_, t_): jn("select has_table_privilege('%s', 'pgmq.%s', 'select') or has_table_privilege('%s', 'pgmq.%s', 'insert') or has_table_privilege('%s', 'pgmq.%s', 'delete')" % ((r_, t_) * 3))
          for r_ in ("anon", "authenticated") for t_ in ("q_tally_recorder", "a_tally_recorder")}
    good, out = as_user(STAFF, "select count(*) from pgmq.a_tally_recorder")
    ok(set(pv.values()) == {"f"} and not good and db.one("select bool_and(relrowsecurity) from pg_class where oid in ('pgmq.q_tally_recorder'::regclass, 'pgmq.a_tally_recorder'::regclass)") == "t",
       "M6. pgmq.q_tally_recorder / a_tally_recorder: no privilege for anon or authenticated (under Supabase's default grants), RLS on; a member's select refused (%s; %s)" % (pv, out.strip().splitlines()[0][-80:] if out else out))

    print("== M8: a ledger renamed by ledger_altered only above the AlterID seen; never merged by it")
    led = lambda lid_, name, alt: apply([dict({"line_id": lid_, "event": "ledger_altered", "object_guid": "g-capital", "name": name, "saved_at": "2026-10-04T10:00:00+05:30"}, **({"alter_id": alt} if alt is not None else {}))])
    st1 = (led("m81", "Capital A/c", 20).get("results") or [{}])[0]
    st2 = (led("m82", "Capital", 15).get("results") or [{}])[0]
    st3 = (led("m83", "Cash", 30).get("results") or [{}])[0]
    st4 = (led("m84", "Capital B", None).get("results") or [{}])[0]
    cap = (db.rows("select name, alter_id from tally_ledgers where book_id = %s and tally_guid = 'g-capital'" % q(B1)) or [{}])[0]
    ok(st1.get("state") == "applied" and st2.get("state") == "stale" and "not above" in str(st2.get("why")) and st3.get("state") == "held" and "merge" in str(st3.get("why"))
       and st4.get("state") == "held" and "AlterID" in str(st4.get("why")) and cap == {"name": "Capital A/c", "alter_id": "20"}
       and db.one("select count(*) from tally_ledgers where book_id = %s and name = 'Cash' and deleted_at is null" % q(B1)) == "1",
       "M8. renamed at AlterID 20; an older 15 stale (not undone); a name another ledger holds held (no merge); no AlterID held (%s)" % [(x.get("state"), x.get("why")) for x in (st1, st2, st3, st4)] + " %s" % cap)

    print("== M3: an upload piece's work queued once (tally_upload_advance)")
    J = db.one("insert into tally_jobs (firm_id, client_id, book_id, kind, sealed, total, status, upload) values (%s, 'c1', %s, 'upload', true, 10, 'running', '{\"path\": \"x\", \"at\": \"main:0\"}') returning id" % (q(F), q(B1)))
    nwork = lambda: db.one("select count(*) from pgmq.q_tally_work where message->>'job' = %s" % q(J))
    msgs = [{"job": J, "firm": F, "book": B1, "days": [{"day": "20260401", "gz": ""}]}, {"job": J, "firm": F, "book": B1, "upload": {"from": 100}}]
    adv = lambda at, nxt, ms, late: j("select tally_upload_advance(%s, %s, %s, %s, %d)::text" % (q(J), q(at), q(nxt), js(ms), late))
    a1, a2 = adv("main:0", "main:100", msgs, 0), adv("main:0", "main:100", msgs, 0)
    ok(a1.get("moved") is True and a2.get("moved") is False and nwork() == "2" and db.one("select upload->>'at' from tally_jobs where id = %s" % q(J)) == "main:100",
       "M3. a piece run twice: its days and next piece queued once, the cursor moved once (%s / %s; %s queued)" % (a1, a2, nwork()))
    a3, a4 = adv("main:100", "end", msgs[:1], 3), adv("main:100", "end", msgs[:1], 3)
    ok(a3.get("moved") is True and a4.get("moved") is False and db.one("select total from tally_jobs where id = %s" % q(J)) == "13", "M3. the late days added to the total once (13) (%s / %s)" % (a3, a4))
    ok(as_user(OWNER, "select tally_upload_advance(%s, 'end', 'x', '[]'::jsonb, 0)::text" % q(J))[0] is False, "M3. tally_upload_advance refused to a signed-in owner")

    print("== L6: no JWT is not enough: only the owner's own logins pass")
    db.sql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'l6_login') then create role l6_login login; end if; end $$; grant usage on schema auth, public to l6_login; grant execute on function public.tally_recorder_drain(integer) to l6_login;")
    db.sql("alter function auth.role() rename to role_stand; create function auth.role() returns text language sql stable as $$ select null::text $$; grant execute on function auth.role() to public;")
    r6 = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "l6_login", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", "select public.tally_recorder_drain(1000)"],
                        capture_output=True, text=True)
    as_cron = cron_run("select public.tally_recorder_drain(1000);")
    db.sql("drop function auth.role(); alter function auth.role_stand() rename to role; revoke execute on function public.tally_recorder_drain(integer) from l6_login;")
    ok(r6.returncode != 0 and "not allowed" in r6.stderr and as_cron == "ok", "L6. another login with EXECUTE and no JWT (auth.role() null): 'not allowed'; the owner's login (pg_cron) still runs it (%s; %s)" % (r6.stderr.strip()[-80:], as_cron))

    print("== L7: one firm's bad data never stops an alert job for the others")
    silent_def = db.one("select pg_get_functiondef('public.tally_recorder_silent(uuid)'::regprocedure)")
    db.sql("""create or replace function public.tally_recorder_silent(p_firm uuid) returns jsonb language sql security definer set search_path = public, pg_temp as $$
      select case when p_firm = %s then '{"silent": [{"device": "not-a-uuid", "name": "BAD"}]}'::jsonb else jsonb_build_object('silent', jsonb_build_array(jsonb_build_object('device', %s, 'name', 'NWS145', 'workingHours', 3))) end $$""" % (q(F2), q(D2)))
    db.sql("create or replace function public.tally_alert_working_now(p_at timestamptz) returns boolean language sql as $$ select true $$")
    db.sql("delete from tally_alerts where kind = 'silent'")
    r7 = j("select tally_alert_scan_silent()::text")
    db.sql(silent_def)
    ok(r7.get("ok") is True and r7.get("firmsFailed") == 1 and db.one("select count(*) from tally_alerts where kind = 'silent' and device_id = %s" % q(D2)) == "1",
       "L7. scan_silent: the other firm's bad answer counted (firmsFailed 1), this firm's alert written (%s)" % r7)
    db.sql("insert into tally_sync_cursor (book_id, firm_id) values (%s, %s) on conflict do nothing; update tally_sync_cursor set gap = '{\"missing\": 3, \"words\": \"up to 3\"}' where book_id = %s;" % (q(B9), q(F2), q(B9)))
    db.sql("""create or replace function public.test_alert_boom() returns trigger language plpgsql as $$ begin if new.firm_id = %s then raise exception 'bad row (test)'; end if; return new; end $$;
              create trigger test_alert_boom before insert or update on public.tally_alerts for each row execute function public.test_alert_boom();""" % q(F2))
    r7 = j("select tally_alert_scan_gaps()::text")
    db.sql("drop trigger test_alert_boom on public.tally_alerts; update tally_sync_cursor set gap = null where book_id = %s;" % q(B9))
    ok(r7.get("ok") is True and r7.get("firmsFailed") == 1, "L7. scan_gaps: one firm's unwritable alert counted, the job goes on (%s)" % r7)

    print("== L8: authenticated holds SELECT only on the new tables")
    gr8 = sorted(set(x["p"] for x in db.rows("select privilege_type as p from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and table_name in ('tally_alerts', 'tally_recorder_failures')")))
    gr8b = db.one("select count(*) from information_schema.role_table_grants where grantee in ('anon', 'authenticated') and table_name = 'tally_recorder_pending'")
    ok(gr8 == ["SELECT"] and gr8b == "0", "L8. under Supabase's default grants: tally_alerts / tally_recorder_failures SELECT only (revoke all, so PG17's MAINTAIN too); tally_recorder_pending nothing (%s; %s)" % (gr8, gr8b))

    print("== M7: a kind CHECK that is not migration 13's is never swapped blindly")
    db.sql("delete from tally_jobs where kind = 'upload'; alter table public.tally_jobs drop constraint tally_jobs_kind_check, add constraint tally_jobs_kind_check check (kind in ('daybook', 'reparse', 'manual'));")
    r = psql_file(M47)
    kd = db.one("select pg_get_constraintdef(oid) from pg_constraint where conname = 'tally_jobs_kind_check'")
    ok(r.returncode != 0 and "by hand" in r.stderr and "manual" in kd and "upload" not in kd, "M7. a hand-widened kind CHECK (daybook, reparse, manual): 47 stops with words, nothing changed (%s; %s)" % ((r.stderr or "").strip().splitlines()[-1][-160:] if r.stderr else "", kd))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
