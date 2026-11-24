"""tell_stand.py - a throwaway PostgreSQL for migrations 221 (tally-tell) and 222 (tally-autoday), and for the tally-ingest
tests that load them (24-Nov-2026, next-tally-tell-sql). Built as run_migration217.py builds it (32 -> ... -> 133 -> 135
-> 136 -> 137 -> 150 -> 158 -> 160 -> 182 -> 214's tally_gap_front as live on staging -> 216 on 146's claims), then 146
whole (the readers that serve a book: tally_read_serving, tally_fetch_on, tally_days_claim), 196 and 197, with the few
tables staging has that this chain does not make (tally_links, tally_companies, tally_bridge_ids, as on staging). The
data lives under TMPDIR (never /tmp/fincom-pg-31207); nothing of a real database is touched. Made-up data only.
    st = tell_stand.build(port, with221=True, with222=True); st.db.sql(...); st.stop()"""
import os, re, sys, json, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M221 = os.environ.get("M221_FILE") or os.path.join(SQLDIR, "migration-221-tally-tell.sql")
M222 = os.environ.get("M222_FILE") or os.path.join(SQLDIR, "migration-222-tally-autoday.sql")
F = "99999999-9999-9999-9999-999999999221"
OWNER = "55555555-5555-5555-5555-555555555221"
STAFF = "66666666-6666-6666-6666-666666666221"
LOOK = "77777777-7777-7777-7777-777777777221"


def q(s): return "null" if s is None else "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]


def chain():
    """run_migration217.py's own build list (FILES, AFTER), read from it so the two never drift"""
    src = open(os.path.join(HERE, "run_migration217.py")).read()
    ns = {"os": os, "HERE": HERE, "SQLDIR": SQLDIR}
    exec(src[src.index("FILES = "):src.index("M = os.path.join")], ns)
    return ns["FILES"], ns["AFTER"]


class Stand:
    def __init__(self, db):
        self.db = db
    def psql_text(self, sql, role=None):
        pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
        return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(self.db.port), "-U", "postgres", "-d", "postgres",
                               "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=pre + sql, capture_output=True, text=True)
    def j(self, s, uid=None, role=None):
        pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
        try: x = self.db.one(pre + s, uid)
        except RuntimeError as e: return {"_error": str(e)[:300] + " ... " + str(e)[-300:]}
        try: return json.loads(x)
        except (TypeError, ValueError): return {"_error": x}
    def stop(self):
        self.db.stop(); shutil.rmtree(self.db.data, ignore_errors=True)


def build(port, with221=False, with222=False, log=print):
    db = pg_stand.start(port); st = Stand(db)
    FILES, AFTER = chain()
    def run(path, what=None):
        r = st.psql_text(open(path).read())
        if r.returncode: raise SystemExit("tell_stand: %s does not run: %s" % (what or os.path.basename(path), r.stderr[-600:]))
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("insert into firms values (%s, 'Made-up Firm') on conflict do nothing;" % q(F))
    db.sql("create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));")
    for u, n, r in ((OWNER, "Owner", "owner"), (STAFF, "Staff", "staff"), (LOOK, "Look", "readonly")):
        db.sql("insert into members values (%s, %s, %s, %s, true)" % (q(u), q(F), q(n), q(r)))
    for path in FILES: run(path)
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      alter table tally_devices add column if not exists version text; alter table tally_devices add column if not exists created_by uuid; alter table tally_devices add column if not exists want_update_at timestamptz;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, first_seen timestamptz, last_seen timestamptz, linked_at timestamptz, linked_by uuid, book_id uuid, primary key (firm_id, company));""")
    for path in AFTER: run(path)
    run(os.path.join(SQLDIR, "migration-182-gap-after-post.sql"))
    run(os.path.join(HERE, "fixtures", "migration-214-as-run-on-staging.sql"))
    # tally_links, tally_bridge_ids as on staging (read 24-Nov-2026); the link's place (tally_link_loc) as its folder
    db.sql("""create table if not exists tally_links (firm_id uuid, book_id uuid, client_id text, company_guid text, company_name text, gstin text, device_id uuid, computer text,
        posting_allowed boolean, state text, linked_by uuid, linked_at timestamptz, updated_by uuid, updated_at timestamptz, version bigint, how text, data_loc text, data_folder text,
        windows_user text, tally_port integer, guid_pick jsonb, guid_changed_at timestamptz);
      create table if not exists tally_bridge_ids (id bigserial, bridge_id text, device_id uuid, firm_id uuid, first_at timestamptz default now(), reset_at timestamptz, reset_by uuid, reset_why text);
      create or replace function tally_bridge_device(p_firm uuid, p_bridge text) returns uuid language sql stable as $b$ select device_id from tally_bridge_ids where firm_id = p_firm and bridge_id = p_bridge $b$;
      create or replace function tally_link_loc(p_device uuid, p_bridge text, p_company text) returns jsonb language sql stable as $b$ select null::jsonb $b$;
      create table if not exists tally_member_bridges (firm_id uuid not null, user_id uuid not null, device_id uuid, bridge_id text, set_by uuid, set_at timestamptz not null default now(), primary key (firm_id, user_id));""")
    run(os.path.join(SQLDIR, "migration-146-reads-follow-company.sql"))
    run(os.path.join(SQLDIR, "migration-216-beat-light.sql"))
    run(os.path.join(SQLDIR, "migration-196-recorder-no-held.sql"))
    run(os.path.join(SQLDIR, "migration-197-day-retry.sql"))
    run(os.path.join(SQLDIR, "migration-217-gap-older-reading.sql"))
    # tally_post_ids / tally_vouchers columns staging has (later migrations of the posting path)
    db.sql("""alter table tally_post_ids add column if not exists matched_guid text; alter table tally_post_ids add column if not exists matched_at timestamptz;
      alter table tally_post_ids add column if not exists accepted_at timestamptz; alter table tally_post_ids add column if not exists created_at timestamptz default now();
      alter table tally_post_jobs add column if not exists updated_at timestamptz default now(); alter table tally_post_jobs add column if not exists created_at timestamptz default now();
      alter table tally_vouchers add column if not exists fincom_id text; alter table tally_vouchers add column if not exists deleted_at timestamptz;""")
    if with221 and os.path.exists(M221): run(M221)
    if with222 and os.path.exists(M222): run(M222)
    return st
