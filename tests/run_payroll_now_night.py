"""python3 tests/run_payroll_now_night.py - (review B2 of "Make the journal now") the running month's payroll entry made with
the button is left alone by tonight's run. night_apply (migrations 206-208, not changed) withdraws, on a complete run, every
ready or held entry whose dedupe the run did not pass; the night never makes the running month, so assistant-night passes
that month's entry as one to keep (paynow.js keepNow: a dedupe only, ready or held, never one approved). On a throwaway
PostgreSQL (pg_stand), made-up data only:
  1. without it (as before): the running month's entry made now is withdrawn the same night
  2. with it: the entry stays ready, its finding stays resolved; nothing new is made; a month the night makes itself and
     no longer finds is still withdrawn (the night's own rule)
  3. an approved one is not passed and stays approved (never put back as ready)
PG_PORT (55487); the database under TMPDIR (default /tmp/pjnow-pg)."""
import os, sys, json, subprocess
os.environ["TMPDIR"] = os.environ.get("PG_TMP") or "/tmp/pjnow-pg"
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
NIGHT = os.path.join(HERE, "..", "server", "assistant-night")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

F1 = "11111111-1111-1111-1111-111111111111"
TODAY = "20261124"
# keepNow on the rows the cloud holds (the handler's rest, as a stand-in over them); [] when paynow.js has no keepNow
KEEP = r"""
import * as PN from "%s";
import { payrollMonths } from "%s";
const [rows, firm, cid, today] = JSON.parse(process.argv[1]);
const rest = async () => rows.filter((r) => r.firm_id === firm && r.client_id === cid);
const k = typeof PN.keepNow === "function" ? await PN.keepNow(rest, firm, cid, payrollMonths(today)) : [];
process.stdout.write(JSON.stringify(k));
""" % (os.path.join(NIGHT, "paynow.js"), os.path.join(HERE, "..", "server", "_shared", "dailyjournals.js"))
def keep_of(db, cid):
    rows = db.rows("select id::text, firm_id::text, client_id, dedupe, state from night_entries where client_id = '%s'" % cid)
    r = subprocess.run(["node", "--input-type=module", "-e", KEEP, json.dumps([rows, F1, cid, TODAY])], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)

db = pg_stand.start(int(os.environ.get("PG_PORT") or 55487))
try:
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      create extension if not exists pgcrypto;
      create table if not exists clients (id text, firm_id uuid, name text, deleted boolean default false, status text default 'active');
      create table if not exists auth.users (id uuid primary key, email text);
      grant usage on schema public to authenticated, anon, service_role;
      insert into firms values ('%s', 'Sample & Co');
      insert into clients (id, firm_id, name) values ('c1', '%s', 'Sample Traders'), ('c2', '%s', 'Demo Textiles'), ('c3', '%s', 'Test Works');""" % (F1, F1, F1, F1))
    for m in ("migration-206-assistant-night.sql", "migration-207-night-close-drafts.sql", "migration-208-daily-phase2.sql"):
        db.sql(open(os.path.join(NIGHT, m)).read())
    # "Make now" for Nov 2026 (the running month) as paynow.js applyNow keeps it: a resolved finding and its ready entry;
    # and Oct 2026's entry, made by an earlier night (the night makes Oct itself)
    def made_now(cid, state="ready", decided=False):
        db.sql("""insert into night_findings (firm_id, client_id, kind, key, facts, state, evidence, candidates, first_seen, last_seen)
            values ('%(f)s', '%(c)s', 'payroll_due', 'payroll:202611', '{"ym": "202611"}', 'resolved', '[]', '[]', '2026-11-24', '2026-11-24'),
                   ('%(f)s', '%(c)s', 'payroll_due', 'payroll:202610', '{"ym": "202610"}', 'resolved', '[]', '[]', '2026-11-01', '2026-11-23');
          insert into night_entries (firm_id, client_id, finding_id, source, dedupe, work_ref, voucher, reason, why, evidence, checks, state, decided_by, decided_at)
            select '%(f)s', '%(c)s', id, 'payroll', key, 'dc-x', '{"type": "Journal", "kind": "payroll", "date": "20261130", "lines": []}', 'Payroll', 'Payroll', '[]', '[]',
                   case when key = 'payroll:202611' then '%(s)s' else 'ready' end,
                   case when key = 'payroll:202611' and %(d)s then '%(f)s'::uuid end, case when key = 'payroll:202611' and %(d)s then now() - interval '2 hours' end
              from night_findings where client_id = '%(c)s';""" % {"f": F1, "c": cid, "s": state, "d": "true" if decided else "false"})
    def night(cid, entries):
        # tonight's complete run (p_complete): the books show Oct's salary booked now (the night no longer makes Oct), and
        # the night never makes the running month: no finding or entry of the night's own for either
        return json.loads(db.one("set role service_role;\nselect public.night_apply('%s', '%s', '2026-11-24', 'v1', '[]'::jsonb, '%s'::jsonb, true, '')::text" % (F1, cid, json.dumps(entries).replace("'", "''"))))
    st = lambda cid, d: db.one("select state from night_entries where client_id = '%s' and dedupe = '%s'" % (cid, d))

    print("1. without it (as before)")
    made_now("c2")
    night("c2", [])
    ok(st("c2", "payroll:202611") == "withdrawn", "1. the running month's entry made now: withdrawn the same night (the bug)")

    print("2. with it")
    made_now("c1")
    k = keep_of(db, "c1")
    ok([e.get("dedupe") for e in k] == ["payroll:202611"], "2. keepNow: the running month's entry only: " + json.dumps(k))
    c = night("c1", k)
    ok(st("c1", "payroll:202611") == "ready", "2. Make now for Nov 2026, then the night run (p_complete): the entry stays ready")
    ok(db.one("select state from night_findings where client_id = 'c1' and key = 'payroll:202611'") == "resolved", "2. its finding stays resolved")
    ok(c.get("entries") == 0 and db.one("select count(*) from night_entries where client_id = 'c1'") == "2", "2. nothing new made, nothing counted: " + json.dumps(c))
    ok(st("c1", "payroll:202610") == "withdrawn", "2. a month the night makes itself and no longer finds: withdrawn, as before")
    ok(db.one("select status from night_runs where client_id = 'c1'") == "ok", "2. the run complete")
    night("c1", keep_of(db, "c1"))
    ok(st("c1", "payroll:202611") == "ready", "2. the next night too")

    print("3. approved")
    made_now("c3", "approved", True)
    k3 = keep_of(db, "c3")
    ok(k3 == [], "3. an approved one is not passed: " + json.dumps(k3))
    night("c3", k3)
    ok(st("c3", "payroll:202611") == "approved", "3. it stays approved (never put back as ready)")
finally:
    db.stop()
    import shutil; shutil.rmtree(db.data, ignore_errors=True)
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
