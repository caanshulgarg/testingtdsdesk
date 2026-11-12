"""python3 run_migration174.py - server/tally-cloud/migration-174-post-jobs-safe.sql (12-Nov-2026, branch next-fix-post-jobs;
items 2-4 of the posting queue's state-machine review, approved by the owner; reworked after the review of ae4949393). On
a throwaway PostgreSQL (pg_stand, port 31174 unless PG174_PORT; never a real database), built as run_migration142.py
(32 -> ... -> 116 -> 127), then 142, 128 and 161, with made-up firms, logins and companies only. One shared server (SRV9),
two Windows logins, each its own key and bridge: A (made-up-a, the link's key) and B (made-up-b). Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (three columns, one index; no drop, delete or truncate);
     grants explicit; names no real database; md5; the two replaced functions start from their latest text (142, 36b)
     and change only the lines counted; tally_post_pickable_ok NOT replaced (142's pick-up rule as it is); runs twice
  1. the normal path unchanged: A has the company open, its waiting posting is taken by A (taken, taken_by A, seq null);
     a posting never taken, A closed and B open: B picks it up (142, unchanged)
  2. unlink after queue: the waiting posting (never taken) is failed at once with the plain reason, never taken; one
     found waiting at take time for an unlinked client (no trigger saw it) is failed there and not handed out
  3. posting stopped (tally_link_posting, as a member): a waiting posting never taken failed with "Not posted: posting
     into Tally was stopped for <client> after this was queued"; a TAKEN one (nothing reported sent, or an entry sent),
     a running one and a waiting one its bridge had before (requeued): never failed, never freed (its ids live), the stop
     flag set with the reason, never handed out again, never requeued; Retry refused while stopped, allowed again: queued
  4. earlier years (tally_split_links): the client's posting for that company is failed with the reason
  5. requeue (cron): taken 11 minutes ago, never reported: back to waiting for A, taken_by / taken_at / attempts kept;
     B (company open, A quiet) never takes it, not after 15 minutes nor an hour; A back with the company open takes it
     back; a person's Retry (taken_by kept) is never picked up by B
  6. the bridge still holds it: taken, reported (seq), A heard now: not requeued, not failed after many rounds; A quiet
     (beat 5 minutes old): requeued to A; running likewise; M1: held but no report for 2 hours while A beats: put back
     for A only (attempts kept, the words for the owner), B never takes it
  7. waiting more than 6 hours: the message says so, once; updated_at not moved
  8. row_version moves on with every update (the compare-and-set of posts_update): a write on the version read after an
     owner's settlement changes nothing
  9. names: the posting's company in other spacing / case is the same company (tally_nm); renamed in Tally since: the
     "renamed" words, never "unlinked"; the index on (firm_id, status)
  10. (second review) the stop flag is cleared when the posting leaves waiting / taken / running and when a Retry or a
     check's re-send brings it back: Retried after the stop, it is taken again; H2a: a posting once taken (no bridge
     named) is never handed to the key's new main bridge; H2b: A sent part of it, the cron put it back, the main bridge
     of A's Windows user switched to A2: the posting is not moved (held, "Started on ... can't be moved ... safely"),
     A2 and B never take it, a Retry is refused in those words; a posting never taken is moved to A2 as before (54);
     a waiting posting put back (attempts 1, no bridge recorded) is stop-flagged, never failed, when posting stops
RED_WITHOUT_174=1: the same checks without the file (2-10 fail)."""
import os, re, sys, json, hashlib, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.join(HERE, "..")
SQLDIR = os.path.join(ROOT, "server", "tally-cloud")
M174 = os.path.join(SQLDIR, "migration-174-post-jobs-safe.sql")
RED = os.environ.get("RED_WITHOUT_174") == "1"
src142 = open(os.path.join(HERE, "run_migration142.py")).read()
FILES = eval(compile(src142.split("\nFILES = ", 1)[1].split("\nfails = []", 1)[0], "run_migration142.py(FILES)", "eval"), {"os": os, "SQLDIR": SQLDIR, "HERE": HERE, "ROOT": ROOT})
FILES += [os.path.join(SQLDIR, f) for f in ("migration-142-post-any-bridge.sql", "migration-128-client-removed-frees-tally.sql", "migration-161-split-tally.sql")]
TF_ADD, TF_GONE, RQ_ADD, RQ_GONE = 25, 6, 40, 4
RS_ADD, RS_GONE, CN_ADD, CN_GONE = 3, 3, 12, 3   # rescue: the held count; cancel: the warning
RR_ADD, RR_GONE = 16, 1   # reroute: 54's text with the once-taken hold   # take_for: the two hand-outs in a loop with the check; requeue: 2b, 4b, M1, 4a
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
def fbody(t_, name):
    i = t_.index("create or replace function public." + name + "(")
    ends = [k for k in (t_.find("$function$;", i), t_.find("$$;", i)) if k >= 0]
    return [l.strip() for l in t_[i:min(ends)].splitlines() if l.strip()]   # compared as text, indentation aside

text = open(M174).read() if os.path.exists(M174) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M174), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and re.findall(r"alter table ([\w.]+) (\w+ \w+)", code) == [("public.tally_post_jobs", "add column")] * 4 and re.findall(r"create index if not exists (\w+)", code) == ["tally_post_jobs_firm_status", "tally_post_jobs_live_age"], "add-only: four columns and two indexes added, nothing dropped, deleted or truncated")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
NEW = {"tally_post_job_blocked": "(uuid)", "tally_post_hold_job": "(uuid)", "tally_post_hold": "(uuid, text)", "tally_post_bridge_holds": "(uuid)"}
REPL = {"tally_post_take_for": "(uuid, text, boolean)"}
TRIG = ["tally_post_jobs_version", "tally_post_links_hold", "tally_post_split_hold"]
ok(made == sorted(list(NEW) + list(REPL) + TRIG + ["tally_post_requeue", "tally_post_reroute", "tally_post_rescue", "tally_post_cancel"]), "makes or replaces only %s" % made)
ok("revoke all on function public.tally_post_rescue(uuid) from public, anon, authenticated;" in text and "revoke all on function public.tally_post_cancel(uuid) from public, anon;" in text and "grant execute on function public.tally_post_cancel(uuid) to authenticated;" in text,
   "tally_post_rescue (nobody, as 54) and tally_post_cancel (authenticated, as 116): grants restated")
ok("revoke all on function public.tally_post_reroute(uuid, boolean) from public, anon, authenticated;" in text and "grant execute on function public.tally_post_reroute" not in text, "tally_post_reroute: internal, granted to nobody, as 54")
ok("tally_post_pickable_ok" not in made, "142's pick-up rule (tally_post_pickable_ok) is not replaced: another bridge only for a posting never taken")
for fn, sig in list(NEW.items()) + list(REPL.items()):
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, "%s: service_role only, granted explicitly" % fn)
for fn in TRIG + ["tally_post_requeue"]:
    ok(("revoke all on function public.%s() from public, anon, authenticated;" % fn) in text, "%s: nobody may call it" % fn)
# started from the latest text: the lines added and removed against 142 (take_for, pickable_ok) and 36b (requeue)
m116 = open(os.path.join(ROOT, "server", "security", "migration-116-write-checks.sql")).read()
m54 = open(os.path.join(SQLDIR, "migration-54-post-target-bridge.sql")).read()
m142, m36b = open(os.path.join(SQLDIR, "migration-142-post-any-bridge.sql")).read(), open(os.path.join(SQLDIR, "migration-36b-post-acceptance.sql")).read()
for name, base, n_add, n_gone in (("tally_post_take_for", m142, TF_ADD, TF_GONE), ("tally_post_requeue", m36b, RQ_ADD, RQ_GONE), ("tally_post_reroute", m54, RR_ADD, RR_GONE), ("tally_post_rescue", m54, RS_ADD, RS_GONE), ("tally_post_cancel", m116, CN_ADD, CN_GONE)):
    if not text: ok(False, name + ": no file"); continue
    a, b = fbody(text, name), fbody(base, name)
    added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
    ok(len(added) == n_add and len(gone) == n_gone, "%s: the latest text (%s) with %d line(s) added, %d changed (%d / %d): %s" % (name, "142" if base is m142 else "36b" if base is m36b else "116" if base is m116 else "54", n_add, n_gone, len(added), len(gone), gone))

F = "99999999-9999-9999-9999-999999999174"
OWNER, STAFF = "55555555-5555-5555-5555-555555555174", "66666666-6666-6666-6666-666666666174"
DA, DB = "d1000000-0000-0000-0000-0000000001a4", "d1000000-0000-0000-0000-0000000001b4"
BA, BB = "go-aaaa000174", "go-bbbb000174"
BK, BK2 = "b0000001-0000-0000-0000-000000000174", "b0000002-0000-0000-0000-000000000174"
CO, CO2, GUID = "Made-up Osprey Traders", "Made-up Osprey Traders (old years)", "a1b2c3d4-0000-0000-0000-000000000174"
FOLDER = "C:\\TallyData\\Shared"
J = lambda n: "%08d-0000-0000-0000-000000000174" % n
NOW = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
db = pg_stand.start(int(os.environ.get("PG174_PORT") or 31174))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def as_role(role, uid, stmt):
    try: return True, db.one("set role %s; %s" % (role, stmt), uid)
    except RuntimeError as e: return False, str(e)
def rpc(uid, stmt, role="authenticated"):
    good, out = as_role(role, uid, stmt)
    if not good: return {"_error": out[-400:]}
    try: return json.loads(out) if out else {}
    except (TypeError, ValueError): return {"_out": out}
def beat(user, bridge, open_, ago=0, guid=GUID, folder=FOLDER):
    at = iso(NOW - datetime.timedelta(minutes=ago))
    return {"computer": "SRV9", "beat": {"at": at, "windowsUser": "SRV9\\" + user, "open": list(open_), "companies": [{"name": n, "guid": guid, "open": True} for n in open_]},
            "bridges": {bridge: {"at": at, "computer": "SRV9", "user": "SRV9\\" + user, "mode": "main", "open": list(open_), "tallyPort": 9000, "dataFolder": folder}}}
def setbeat(dev, info): db.sql("update tally_devices set info = %s, last_seen = now() where id = %s" % (q(json.dumps(info)), q(dev)))
def job(n, target, dev, status="waiting", taken_by=None, attempts=0, company=CO, client="c1", seq=None, results=None, items=None, ago=0):
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge, taken_by, attempts, taken_at, seq, results, items, created_at, updated_at) values (%s, %s, %s, %s, %s, %s, 1, %s, %s, %s, %d, %s, %s, %s, %s, now() - interval '%d minutes', now() - interval '%d minutes')"
           % (q(J(n)), q(F), q(client), q(company), q(dev), q(json.dumps({"masters": [], "vouchers": [{"id": "V%d" % n, "xml": "<VOUCHER/>"}], "ledger": ""})), q(status), q(target) if target else "null", q(taken_by) if taken_by else "null", attempts,
              ("now() - interval '%d minutes'" % ago) if taken_by else "null", "null" if seq is None else int(seq), q(json.dumps(results)) if results is not None else "null", q(json.dumps(items)) if items is not None else "null", ago, ago))
def take(dev, bridge):
    r = db.rows("select id::text, device_id::text dev, target_bridge, taken_by, status from tally_post_take_for(%s::uuid, %s, true)" % (q(dev), q(bridge)))
    return r[0] if r else None
row = lambda n: (db.rows("select device_id::text dev, target_bridge, coalesce(taken_by, '') taken_by, coalesce(taken_at::text, '') taken_at, status, attempts::text attempts, coalesce(message, '') message, updated_at::text upd, %s stop from tally_post_jobs where id = %s" % ("''" if RED else "coalesce(stop_reason, '')", q(J(n)))) or [None])[0]
live = lambda n: db.one("select coalesce(string_agg(live::text, ','), '') from tally_post_ids where job_id = %s" % q(J(n)))
def clear(): db.sql("update tally_post_jobs set status = 'cancelled' where status in ('waiting', 'taken', 'running')")
def relink():
    db.sql("update tally_links set state = 'linked', client_id = 'c1', posting_allowed = true where firm_id = %s and book_id = %s" % (q(F), q(BK)))
    db.sql("update tally_companies set client_id = 'c1' where firm_id = %s and book_id = %s" % (q(F), q(BK)))
requeue = lambda: int(db.one("select tally_post_requeue()") or 0)
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
                          alter role service_role bypassrls;
                          if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if; end $$;
      grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
      grant select on members to authenticated, service_role;
      insert into firms values (%(F)s, 'Made-up Firm 174') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true);
      create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
      insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%(DA)s, %(F)s, 'SRV9 · made-up-a', 'ha', '2.5.4', '{}', %(O)s),
        (%(DB)s, %(F)s, 'SRV9 · made-up-b', 'hb', '2.5.4', '{}', %(O)s);
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, updated_at timestamptz default now(), primary key (firm_id, id));
      create table if not exists public.tally_companies (firm_id uuid not null references public.firms(id) on delete cascade, company text not null, client_id text, gstin text,
        device_id uuid references public.tally_devices(id) on delete set null, first_seen timestamptz not null default now(), last_seen timestamptz, linked_at timestamptz, linked_by uuid,
        book_id uuid not null default gen_random_uuid() unique, primary key (firm_id, company));
      alter table public.tally_companies enable row level security;
      create policy tally_companies_read on public.tally_companies for select to authenticated using (firm_id = public.my_firm());
      grant select on public.tally_companies to authenticated;
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'Made-up Osprey', '{}');
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen, linked_at, book_id) values (%(F)s, %(CO)s, 'c1', %(DA)s, now(), now(), %(BK)s),
        (%(F)s, %(CO2)s, null, %(DA)s, now() - interval '1 day', null, %(BK2)s);
      insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%(BK)s, %(F)s, 'c1', %(CO)s, '2025-04-01'), (%(BK2)s, %(F)s, '', %(CO2)s, '2021-04-01');
      create table if not exists auth.users (id uuid primary key, email text);""" % {"F": q(F), "O": q(OWNER), "S": q(STAFF), "DA": q(DA), "DB": q(DB), "BK": q(BK), "BK2": q(BK2), "CO": q(CO), "CO2": q(CO2)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;")
    setbeat(DA, beat("made-up-a", BA, [CO])); setbeat(DB, beat("made-up-b", BB, [CO]))
    db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(DA), q(BA))); db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(DB), q(BB)))
    loc = json.loads(db.one("select tally_link_loc(%s::uuid, %s, %s)::text" % (q(DA), q(BA), q(CO))))["loc"]
    db.sql("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, device_id, computer, posting_allowed, state, data_loc, data_folder, windows_user) values (%s, %s, 'c1', %s, %s, %s, 'SRV9', true, 'linked', %s, %s, 'SRV9\\made-up-a') on conflict (firm_id, book_id) do update set data_loc = excluded.data_loc, device_id = excluded.device_id, company_guid = excluded.company_guid, posting_allowed = true, state = 'linked', client_id = 'c1'"
           % (q(F), q(BK), q(GUID), q(CO), q(DA), q(loc), q(FOLDER)))

    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_174: not run)" % n); continue
        r = psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    if not RED:
        priv = lambda role, sig: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(sig)))
        for rr in db.rows("select p.proname n, md5(p.prosrc) m, p.prosecdef::text d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[%s]) order by 1" % ",".join(q(f) for f in list(NEW) + list(REPL) + TRIG + ["tally_post_requeue"])):
            print("  read-back %(n)s md5(prosrc)=%(m)s definer=%(d)s" % rr)
        ok(all(priv("authenticated", "public.%s%s" % (f, s)) == "false" and priv("anon", "public.%s%s" % (f, s)) == "false" for f, s in list(NEW.items()) + list(REPL.items())), "not for anon or authenticated")
        ok(db.one("select count(*) from pg_trigger where not tgisinternal and tgname in ('tally_post_jobs_version', 'tally_post_links_hold', 'tally_post_split_hold')") == "3", "the three triggers, once (run twice)")

    print("== 1. the normal path")
    job(1, BA, DA)
    t = take(DA, BA)
    ok(t is not None and t["id"] == J(1) and t["status"] == "taken" and t["taken_by"] == BA and t["dev"] == DA, "A takes its own waiting posting (%s)" % t)
    ok(db.one("select coalesce(seq::text, 'null') from tally_post_jobs where id = %s" % q(J(1))) == "null", "the take clears seq, as before")
    ok(take(DA, BA) is None and take(DB, BB) is None, "nothing more to take")
    clear()
    setbeat(DA, beat("made-up-a", BA, [])); job(11, BA, DA)
    t = take(DB, BB); ok(t is not None and t["id"] == J(11) and t["dev"] == DB and t["taken_by"] == BB, "never taken, A closed, B open: B picks it up as 142 does (%s)" % t)
    setbeat(DA, beat("made-up-a", BA, [CO])); clear()

    print("== 2. unlinked after it was queued")
    job(2, BA, DA)
    r = rpc(STAFF, "select tally_link_set(%s, null)::text" % q(CO))
    ok("_error" not in r, "a member unlinks the client (%s)" % r.get("_error", ""))
    x = row(2)
    ok(x["status"] == "failed" and x["message"].startswith("Not posted: Made-up Osprey was unlinked from " + CO + " in Tally after this was queued."), "the waiting posting is failed at once, in plain words (%s / %s)" % (x["status"], x["message"]))
    ok(take(DA, BA) is None and take(DB, BB) is None and row(2)["status"] == "failed", "never taken")
    # a posting waiting for an unlinked client that no trigger saw (queued straight in): the take holds it, hands nothing
    job(21, BA, DA)
    ok(take(DA, BA) is None, "at take time: not handed out")
    x = row(21); ok(x["status"] == "failed" and "was unlinked" in x["message"], "and failed there with the reason (%s / %s)" % (x["status"], x["message"][:90]))
    relink(); clear()

    print("== 3. posting stopped after it was queued")
    job(3, BA, DA)                                                         # waiting, never taken
    job(31, BA, DA, status="taken", taken_by=BA, seq=1, items=[{"id": "V31", "state": "waiting"}])          # taken, nothing reported sent
    job(32, BA, DA, status="taken", taken_by=BA, seq=2, results=[{"id": "V32", "ok": False, "state": "sent", "sent": True}], items=[{"id": "V32", "state": "sent"}])   # an entry sent
    job(34, BA, DA, status="taken", taken_by=BA)                           # taken seconds ago, no report yet
    job(35, BA, DA, status="running", taken_by=BA, seq=5)                  # running
    job(36, BA, DA, status="waiting", taken_by=BA, attempts=1, ago=12)     # put back by the cron (taken_at kept)
    lv = {n: live(n) for n in (31, 32, 34, 35, 36)}
    ver = db.one("select version from tally_links where book_id = %s" % q(BK))
    r = rpc(OWNER, "select tally_link_posting(%s::uuid, false, %s)::text" % (q(BK), ver))
    ok("_error" not in r and r.get("posting_allowed") is False, "the owner stops posting into Tally (%s)" % r.get("_error", ""))
    WORDS = "Not posted: posting into Tally was stopped for Made-up Osprey after this was queued."
    ok(row(3)["status"] == "failed" and row(3)["message"].startswith(WORDS), "waiting, never taken: failed with the reason (%s)" % row(3)["message"][:120])
    for n, stt in ((31, "taken"), (32, "taken"), (34, "taken"), (35, "running"), (36, "waiting")):
        x = row(n)
        ok(x["status"] == stt and x["stop"].startswith(WORDS) and "Nothing of it was sent" not in x["stop"] and x["message"].startswith(WORDS) and "told to stop" in x["message"] and live(n) == lv[n] and "true" in lv[n],
           "posting %d (%s): never failed nor freed (ids live %s), the stop flag and the reason set (%s / %s)" % (n, stt, live(n), x["status"], x["stop"][:60]))
    ok(take(DA, BA) is None and take(DB, BB) is None and row(36)["status"] == "waiting", "never handed out again (the flagged waiting one neither)")
    requeue(); requeue()
    ok(row(31)["status"] == "taken" and row(34)["status"] == "taken" and row(35)["status"] == "running" and row(36)["status"] == "waiting" and row(31)["attempts"] == "0", "fresh: left to its bridge's next word")
    # (third review HIGH 1) its bridge no longer holds it: held for checking, never back to waiting, the flag kept, ids live
    db.sql("update tally_post_jobs set updated_at = now() - interval '20 minutes' where id in (%s, %s)" % (q(J(31)), q(J(34))))
    if not RED: db.sql("update tally_post_jobs set stop_at = now() - interval '11 minutes' where id = %s" % q(J(36)))
    requeue()
    ok(row(31)["status"] == "taken", "taken 20 minutes, reported, A heard (it holds it): left (%s)" % row(31)["status"])
    for n in (34, 36):
        x = row(n); ck = db.one("select checking::text from tally_post_jobs where id = %s" % q(J(n)))
        ok(x["status"] == "done" and ck == "true" and x["stop"] != "" and x["message"].startswith("Stopped: " + WORDS) and "Mark posted" in x["message"] and "true" in live(n),
           "HIGH 1: %d, its bridge silent: held for checking (done, checking), the flag kept, ids live (%s %s / %s)" % (n, x["status"], ck, x["message"][:80]))
    db.sql("update tally_post_jobs set updated_at = now() - interval '3 hours' where id in (%s, %s)" % (q(J(31)), q(J(35))))
    requeue()
    ok(row(31)["status"] == "done" and row(35)["status"] == "done", "HIGH 1: 2 hours without a word though A beats: held too (%s %s)" % (row(31)["status"], row(35)["status"]))
    ok(all(row(n)["status"] != "waiting" for n in (31, 34, 35, 36)), "never back to waiting")
    job(33, BA, DA)
    ok(take(DA, BA) is None and take(DB, BB) is None and row(33)["status"] == "failed", "queued straight in while stopped: never taken, failed at take")
    r = rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(J(3)), q(json.dumps({"vouchers": [{"id": "V3", "xml": "<VOUCHER/>"}]}))))
    ok(r.get("ok") is False and "stopped" in str(r.get("error")) and row(3)["status"] == "failed", "Retry while still stopped: refused (%s)" % (r.get("error") or r.get("_error")))
    ver = db.one("select version from tally_links where book_id = %s" % q(BK))
    rpc(OWNER, "select tally_link_posting(%s::uuid, true, %s)::text" % (q(BK), ver))
    db.sql("update tally_post_jobs set status = 'cancelled' where id <> %s and status in ('waiting', 'taken', 'running', 'failed')" % q(J(3)))
    r = rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(J(3)), q(json.dumps({"vouchers": [{"id": "V3", "xml": "<VOUCHER/>"}]}))))
    ok(r.get("ok") is True and r.get("retry") is True and row(3)["status"] == "waiting", "allowed again: Retry queues the same posting again (%s / %s)" % (r.get("error") or r.get("_error") or r, row(3)["status"]))
    t = take(DA, BA); ok(t is not None and t["id"] == J(3), "and A takes it (%s)" % t)
    clear()

    print("== 4. the company becomes the client's earlier years")
    db.sql("update tally_companies set client_id = 'c1' where book_id = %s" % q(BK2))      # (linked through its mirror, posting allowed)
    db.sql("update tally_links set posting_allowed = true where book_id = %s" % q(BK2))
    job(4, BA, DA, company=CO2)
    ok(db.one("select coalesce(tally_post_job_blocked(%s), 'null')" % q(J(4))) == "null" if not RED else False, "before: it may be posted")
    db.sql("insert into tally_split_links (firm_id, book_id, client_id, current_book, ends_on) values (%s, %s, 'c1', %s, '2025-03-31')" % (q(F), q(BK2), q(BK)))
    x = row(4); ok(x["status"] == "failed" and "earlier-years company of Made-up Osprey" in x["message"], "after: failed with the reason (%s / %s)" % (x["status"], x["message"][:120]))
    db.sql("update tally_split_links set state = 'unlinked' where book_id = %s; update tally_companies set client_id = null where book_id = %s" % (q(BK2), q(BK2)))
    clear()

    print("== 5. the requeue: back to the same bridge only")
    setbeat(DA, beat("made-up-a", BA, [], ago=12)); setbeat(DB, beat("made-up-b", BB, [CO]))
    job(5, BA, DA, status="taken", taken_by=BA, ago=11)
    n = requeue(); x = row(5)
    ok(x["status"] == "waiting" and x["taken_by"] == BA and x["taken_at"] != "" and x["attempts"] == "1", "taken 11 minutes ago, never reported: back to waiting for A, taken_by / taken_at kept (%s)" % x)
    ok(take(DB, BB) is None, "B (company open, A quiet) does not take it")
    for mins in (16, 60):
        db.sql("update tally_post_jobs set updated_at = now() - interval '%d minutes' where id = %s" % (mins, q(J(5))))
        ok(take(DB, BB) is None and row(5)["dev"] == DA and row(5)["status"] == "waiting", "nor after %d minutes waiting: never another computer once taken (%s)" % (mins, row(5)["dev"]))
    setbeat(DA, beat("made-up-a", BA, [CO]))
    t = take(DA, BA); ok(t is not None and t["id"] == J(5) and t["taken_by"] == BA, "A back with the company open: takes its own back (%s)" % t)
    clear()
    setbeat(DA, beat("made-up-a", BA, [], ago=12))
    job(52, BA, DA, status="waiting", taken_by=BA, attempts=1, ago=20)     # a person's Retry: taken_by kept
    db.sql("update tally_post_jobs set taken_at = null where id = %s" % q(J(52)))
    ok(take(DB, BB) is None and row(52)["dev"] == DA, "a person's Retry (taken_by kept) is never picked up by B (%s)" % row(52))
    clear()

    print("== 6. the bridge still holds it")
    setbeat(DA, beat("made-up-a", BA, []))
    job(6, BA, DA, status="taken", taken_by=BA, seq=4, ago=11)
    for i in range(7): requeue()
    x = row(6)
    ok(x["status"] == "taken" and x["attempts"] == "0" and x["taken_by"] == BA, "taken, reported, A heard now: not requeued nor failed after 7 rounds (%s)" % x)
    job(61, BA, DA, status="running", taken_by=BA, seq=9, ago=31)
    requeue(); ok(row(61)["status"] == "running", "running, reported, A heard: left (%s)" % row(61)["status"])
    setbeat(DA, beat("made-up-a", BA, [], ago=5))
    requeue(); x = row(6)
    ok(x["status"] == "waiting" and x["attempts"] == "1" and x["taken_by"] == BA, "A quiet 5 minutes: requeued, still A's (%s)" % x)
    ok(row(61)["status"] == "waiting", "the running one too (%s)" % row(61)["status"])
    clear()
    setbeat(DA, beat("made-up-a", BA, [])); setbeat(DB, beat("made-up-b", BB, [CO]))
    job(62, BA, DA, status="taken", taken_by=BA, seq=3, ago=90)
    requeue(); ok(row(62)["status"] == "taken", "held, 90 minutes without a report, A beating: left (%s)" % row(62)["status"])
    db.sql("update tally_post_jobs set updated_at = now() - interval '121 minutes' where id = %s" % q(J(62)))
    requeue(); requeue(); x = row(62)
    ok(x["status"] == "waiting" and x["taken_by"] == BA and x["dev"] == DA and x["attempts"] == "0" and "restart FinCom Bridge on that computer" in x["message"] and "cancel" not in x["message"].lower() and "never posted from another computer" in x["message"],
       "M1: 2 hours without a report while A beats: back for A only, attempts kept, the owner told (%s)" % x)
    db.sql("update tally_post_jobs set updated_at = now() - interval '30 minutes' where id = %s" % q(J(62)))
    ok(take(DB, BB) is None and row(62)["dev"] == DA, "B (company open) never takes it")
    clear()

    print("== 7. waiting more than 6 hours")
    setbeat(DA, beat("made-up-a", BA, [])); setbeat(DB, beat("made-up-b", BB, []))
    job(7, BA, DA, ago=7 * 60); job(71, BA, DA, ago=60)
    u0 = row(7)["upd"]
    requeue(); requeue()
    x = row(7)
    ok(x["status"] == "waiting" and x["message"].startswith("Still waiting after 6 hours (since ") and ("no FinCom Bridge with " + CO + " open in Tally has taken it") in x["message"], "the reason shown (%s)" % x["message"])
    ok(x["upd"] == u0 and x["message"].count("Still waiting") == 1, "once, and updated_at not moved")
    ok(row(71)["message"] == "", "waiting 1 hour: nothing said")
    clear()

    print("== 8. row_version: the compare-and-set of posts_update")
    job(8, BA, DA, status="running", taken_by=BA, seq=1)
    v0 = int(db.one("select coalesce(row_version, -1) from tally_post_jobs where id = %s" % q(J(8))) or -1) if not RED else -1
    db.sql("update tally_post_jobs set results = '[{\"id\": \"V8\", \"byOwner\": true}]' where id = %s" % q(J(8)))     # an owner's settlement meanwhile
    v1 = int(db.one("select coalesce(row_version, -1) from tally_post_jobs where id = %s" % q(J(8))) or -1) if not RED else -1
    ok(v1 == v0 + 1 and v0 >= 0, "every update moves it on (%s -> %s)" % (v0, v1))
    if not RED:
        n = db.one("with u as (update tally_post_jobs set status = 'done', results = '[]' where id = %s and row_version = %d returning 1) select count(*) from u" % (q(J(8)), v0))
        ok(n == "0" and "byOwner" in db.one("select results::text from tally_post_jobs where id = %s" % q(J(8))), "a write on the version read before: nothing changed, the settlement kept")
    print("== 10. the stop flag cleared; never another bridge of the same computer once taken")
    relink(); setbeat(DA, beat("made-up-a", BA, [CO]))
    job(100, BA, DA, status="taken", taken_by=BA, seq=1)
    ver = db.one("select version from tally_links where book_id = %s" % q(BK))
    rpc(OWNER, "select tally_link_posting(%s::uuid, false, %s)::text" % (q(BK), ver))
    ok(row(100)["stop"] != "", "stopped while taken: the flag set")
    db.sql("update tally_post_jobs set status = 'failed', message = 'stopped' where id = %s" % q(J(100)))       # its bridge's last word (posts_update)
    ok(row(100)["stop"] == "" and row(100)["status"] == "failed", "failed by its bridge's last word: the flag cleared (%s)" % row(100)["stop"][:40])
    ver = db.one("select version from tally_links where book_id = %s" % q(BK))
    rpc(OWNER, "select tally_link_posting(%s::uuid, true, %s)::text" % (q(BK), ver))
    r = rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(J(100)), q(json.dumps({"vouchers": [{"id": "V100", "xml": "<VOUCHER/>"}]}))))
    t = take(DA, BA)
    ok(r.get("ok") is True and t is not None and t["id"] == J(100), "Retried once posting is allowed again: taken again (%s / %s)" % (r.get("error") or r.get("_error") or r, t))
    if not RED: db.sql("update tally_post_jobs set stop_reason = 'x', stop_at = now() where id = %s" % q(J(100)))
    db.sql("update tally_post_jobs set status = 'done' where id = %s" % q(J(100)))
    db.sql("update tally_post_jobs set status = 'waiting', resend_only = '[\"V100\"]', taken_at = null where id = %s" % q(J(100)))   # a check's re-send
    ok(row(100)["stop"] == "" and row(100)["status"] == "waiting", "a check's re-send: no flag left (%s)" % row(100)["stop"])
    clear()
    # a second bridge of A's own Windows user on A's key (A2)
    BA2 = "go-aaaa000175"
    def two(ago_a=0, open_a=(CO,), open_a2=(CO,)):
        i = beat("made-up-a", BA, list(open_a), ago=ago_a); i2 = beat("made-up-a", BA2, list(open_a2))
        i["bridges"][BA2] = i2["bridges"][BA2]; setbeat(DA, i)
    two(); db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(DA), q(BA2)))
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(BA), q(DA)))
    setbeat(DB, beat("made-up-b", BB, [CO]))
    job(101, None, DA, status="waiting", taken_by=BA, attempts=1, ago=12)      # put back; names no bridge (older take)
    job(102, BA, DA, status="taken", taken_by=BA, seq=3, ago=12, results=[{"id": "V102", "ok": True, "verified": True, "state": "in_tally"}], items=[{"id": "V102", "state": "in_tally"}, {"id": "V102b", "state": "waiting"}])
    job(103, BA, DA)                                                             # never taken
    two(ago_a=12)                                                                # A quiet 12 minutes
    requeue(); ok(row(102)["status"] == "waiting" and row(102)["taken_by"] == BA, "A sent part of it, went quiet: put back for A (%s)" % row(102)["status"])
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(BA2), q(DA)))              # the main bridge switched to A2
    x = row(102)
    ok(x["target_bridge"] == BA and x["status"] == "waiting" and x["message"].startswith("Started on ") and "never moved to another bridge" in x["message"] and "Make that bridge able to post again" in x["message"] and "check-first" not in x["message"], "not moved to A2: held, in plain words (%s / %s)" % (x["target_bridge"], x["message"]))
    ok(row(103)["target_bridge"] == BA2, "the posting never taken: moved to A2 as before (%s)" % row(103)["target_bridge"])
    got = [take(DA, BA2) for _ in range(3)]
    ok([g["id"] for g in got if g] == [J(103)] and row(101)["status"] == "waiting" and row(102)["status"] == "waiting", "A2 takes only the one never taken; neither 101 (no bridge named, taken by A) nor 102 (%s)" % [g and g["id"] for g in got])
    ok(take(DB, BB) is None and row(102)["dev"] == DA, "B never takes it either")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(102)))
    r = rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(J(102)), q(json.dumps({"vouchers": [{"id": "V102", "xml": "<VOUCHER/>"}]}))))
    ok(r.get("ok") is False and "never moved to another bridge" in str(r.get("error")) and "Cancel" not in str(r.get("error")) and row(102)["status"] == "failed", "a Retry is refused in those words, without Cancel (LOW 4) (%s)" % (r.get("error") or r.get("_error")))
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(BA), q(DA)))
    clear()
    WORDS = "Not posted: posting into Tally was stopped for Made-up Osprey after this was queued."
    job(104, BA, DA, status="waiting", attempts=1)                               # a person's Retry: no bridge holds it (taken_at, taken_by empty)
    ver = db.one("select version from tally_links where book_id = %s" % q(BK))
    rpc(OWNER, "select tally_link_posting(%s::uuid, false, %s)::text" % (q(BK), ver))
    ok(row(104)["status"] == "waiting" and row(104)["stop"].startswith(WORDS), "fourth review LOW 2: a Retried posting (attempts 1): stop-flagged, not failed (%s / %s)" % (row(104)["status"], row(104)["stop"][:60]))
    if not RED: db.sql("update tally_post_jobs set stop_at = now() - interval '11 minutes' where id = %s" % q(J(104)))
    requeue(); ok(row(104)["status"] == "done" and db.one("select checking::text from tally_post_jobs where id = %s" % q(J(104))) == "true", "and held for checking 10 minutes after the stop (%s)" % row(104)["status"])
    ver = db.one("select version from tally_links where book_id = %s" % q(BK))
    rpc(OWNER, "select tally_link_posting(%s::uuid, true, %s)::text" % (q(BK), ver))
    setbeat(DA, beat("made-up-a", BA, [CO])); clear()

    print("== 11. third review")
    relink(); setbeat(DA, beat("made-up-a", BA, [CO])); setbeat(DB, beat("made-up-b", BB, [CO]))
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(BA), q(DA)))
    two()
    # MED 2: reported on by A (seq), A can no longer post (A2 the main bridge now), quiet 11 minutes: held, not requeued
    job(110, BA, DA, status="taken", taken_by=BA, seq=2, ago=11)
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(BA2), q(DA)))
    requeue(); x = row(110); ck = db.one("select checking::text from tally_post_jobs where id = %s" % q(J(110)))
    ok(x["status"] == "done" and ck == "true" and "can no longer post" in x["message"] and "Mark posted" in x["message"], "MED 2: held for checking, not back to waiting (%s %s / %s)" % (x["status"], ck, x["message"][:90]))
    # MED 3: a posting naming no bridge, taken by A, put back; A2 (another bridge of the key) the main now: held in words, not silent
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(BA), q(DA)))
    job(111, None, DA, status="waiting", taken_by=BA, attempts=1, ago=12)
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(BA2), q(DA)))
    x = row(111)
    ok(x["status"] == "waiting" and x["message"].startswith("Started on ") and "can no longer post" in x["message"], "MED 3: judged by the bridge that took it (A): held in words (%s)" % x["message"][:90])
    ok(take(DA, BA2) is None, "and A2 does not take it")
    rr = json.loads(db.one("select tally_post_rescue(%s::uuid)::text" % q(DA)) or "{}")
    ok(rr.get("held", 0) >= 1 and rr.get("failed") == 0, "LOW 8: the rescue counts it held, not failed (%s)" % rr)
    # MED 4: Cancel of a posting once taken warns; one never taken is cancelled as before
    r = rpc(STAFF, "select tally_post_cancel(%s)::text" % q(J(111)))
    ok(r.get("ok") is True and "Check Tally first" in str(r.get("warn")) and row(111)["message"].startswith("Cancelled after the Tally computer had started it"), "MED 4: Cancel once taken: the warning (%s)" % r)
    ok(live(111) == "true", "and its ids stay live until a person settles them (%s)" % live(111))
    job(114, BA, DA)
    r = rpc(STAFF, "select tally_post_cancel(%s)::text" % q(J(114)))
    ok(r == {"ok": True} and row(114)["message"] == "Cancelled before the Tally computer took it" and live(114) == "false", "a posting never taken: cancelled as before, its ids freed (%s %s)" % (r, live(114)))
    clear()
    # LOW 6: a v1 take (taken_by empty, taken_at set): never by a go- bridge; attempts > 0 counts as taken for the reroute
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(BA), q(DA)))
    job(112, None, DA, status="waiting", ago=12); db.sql("update tally_post_jobs set taken_at = now() - interval '12 minutes', attempts = 1 where id = %s" % q(J(112)))
    ok(take(DA, BA) is None and row(112)["status"] == "waiting", "LOW 6: a v1 bridge's posting (taken_at set, no taken_by): not taken by go- bridge A")
    # fourth review LOW 1: by the take's history, not attempts alone
    job(117, None, DA, status="waiting", attempts=1, ago=12)
    if not RED: db.sql("update tally_post_jobs set first_taken_at = now() - interval '1 day' where id = %s" % q(J(117)))   # a v1 take, then failed and Retried (taken_at cleared)
    ok(take(DA, BA) is None and row(117)["status"] == "waiting", "LOW 1: Retried after a v1 bridge took it: not taken by go- bridge A")
    job(118, BA, DA, status="waiting", attempts=1)          # never taken, failed (e.g. stopped), Retried
    t = take(DA, BA); ok(t is not None and t["id"] == J(118), "LOW 1: never taken, failed and Retried (attempts 1): A takes it (%s)" % t)
    ok(db.one("select (first_taken_at is not null)::text from tally_post_jobs where id = %s" % q(J(118))) == "true" if not RED else False, "the take records its history (first_taken_at)")
    clear()
    job(113, BA2, DA, status="waiting", attempts=1)          # Retried, never taken, for A2, A2 no longer able to post
    ok(json.loads(db.one("select tally_post_reroute(%s, false)::text" % q(J(113))) or "{}").get("state") == "moved" and row(113)["target_bridge"] == BA, "LOW 1: never taken (no history), attempts 1: moved to the bridge that may post, as 54 (%s)" % row(113)["target_bridge"])
    job(119, BA2, DA, status="waiting", attempts=1)
    if not RED: db.sql("update tally_post_jobs set first_taken_at = now() - interval '1 day' where id = %s" % q(J(119)))
    ok(json.loads(db.one("select tally_post_reroute(%s, false)::text" % q(J(119))) or "{}").get("held") is True and row(119)["target_bridge"] == BA2, "LOW 1: once taken by its history: held, not moved (%s)" % row(119)["target_bridge"])
    clear()
    # LOW 5: the 6-hour words: once taken, its own bridge, never "cancel" or another computer; never over the held words; written once
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(BA), q(DA))); setbeat(DA, beat("made-up-a", BA, []))
    job(115, BA, DA, status="waiting", taken_by=BA, attempts=1, ago=7 * 60); db.sql("update tally_post_jobs set taken_at = now() - interval '8 hours' where id = %s" % q(J(115)))
    job(116, BA, DA, status="waiting", taken_by=BA, attempts=1, ago=7 * 60); db.sql("update tally_post_jobs set message = 'Started on X, and that FinCom Bridge can no longer post' where id = %s" % q(J(116)))
    requeue(); v1 = db.one("select row_version::text from tally_post_jobs where id = %s" % q(J(115))) if not RED else "0"
    requeue(); v2 = db.one("select row_version::text from tally_post_jobs where id = %s" % q(J(115))) if not RED else "1"
    m = row(115)["message"]
    ok(m.startswith("Still waiting after 6 hours") and "which started it" in m and "cancel" not in m.lower() and "never posted from another computer" in m, "LOW 5: once taken: its own bridge named, no cancel (%s)" % m)
    ok(v1 == v2, "LOW 5: written once (row_version %s -> %s)" % (v1, v2))
    ok(row(116)["message"].startswith("Started on X"), "LOW 5: the held words not overwritten")
    setbeat(DA, beat("made-up-a", BA, [CO])); clear()

    ok(db.one("select count(*) from pg_indexes where indexname = 'tally_post_jobs_live_age' and indexdef like '%WHERE%'") == "1", "PERF: the partial index on (status, updated_at) for the queue")

    print("== 9. names and the index")
    relink(); setbeat(DA, beat("made-up-a", BA, [CO]))
    job(9, BA, DA, company="  made-up OSPREY traders\n")
    ok((db.one("select coalesce(tally_post_job_blocked(%s), 'null')" % q(J(9))) if not RED else "x") == "null", "the company in other case, with spaces / a line break around it: the same (tally_nm, as enqueue), may be posted")
    clear()
    job(91, BA, DA)
    db.sql("update tally_companies set company = 'Made-up Osprey Traders Pvt Ltd' where book_id = %s; update tally_links set company_name = 'Made-up Osprey Traders Pvt Ltd' where book_id = %s" % (q(BK), q(BK)))
    w = db.one("select coalesce(tally_post_job_blocked(%s), 'null')" % q(J(91))) if not RED else ""
    ok("was renamed" in w and "Made-up Osprey Traders Pvt Ltd" in w and "unlinked" not in w, "renamed in Tally since: the renamed words (%s)" % w)
    ok(take(DA, BA) is None and row(91)["status"] == "failed", "and not handed out")
    ok(db.one("select count(*) from pg_indexes where indexname = 'tally_post_jobs_firm_status'") == "1", "the index on (firm_id, status)")
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
