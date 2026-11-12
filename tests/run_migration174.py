"""python3 run_migration174.py - server/tally-cloud/migration-174-post-jobs-safe.sql (12-Nov-2026, branch next-fix-post-jobs;
items 2-4 of the posting queue's state-machine review, approved by the owner). On a throwaway PostgreSQL (pg_stand, port
31174 unless PG174_PORT; never a real database), built as run_migration142.py (32 -> ... -> 116 -> 127), then 142, 128 and
161, with made-up firms, logins and companies only. One shared server (SRV9), two Windows logins, each its own key and
bridge: A (made-up-a, the link's key) and B (made-up-b). Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (one column, no drop, delete or truncate); grants explicit;
     names no real database; md5; the three replaced functions start from their latest text (142, 36b) and change only
     the lines named; runs twice
  1. the normal path unchanged: A has the company open, its waiting posting is taken by A (taken, taken_by A, seq null)
  2. unlink after queue: the waiting posting is failed at once with the plain reason, never taken; a posting found
     waiting at take time for an unlinked client (no trigger saw it) is failed there and not handed out
  3. posting stopped (tally_link_posting, as a member): waiting and taken-but-unsent postings failed with "Not posted:
     posting into Tally was stopped for <client> after this was queued"; a taken posting with an entry sent is left;
     never taken; allowed again: a Retry queues it again (same id), refused while still stopped
  4. earlier years (tally_split_links): the client's posting for that company is failed with the reason
  5. requeue (cron): taken 11 minutes ago, never reported: back to waiting with taken_by / taken_at cleared; B (company
     open, A not) cannot take it at once, can after 15 minutes; A could take it back meanwhile when it has it open; a
     person's Retry (taken_by kept) is never picked up by B
  6. the bridge still holds it: taken, reported (seq), A heard now: not requeued, not failed, even after many rounds; A
     quiet (beat 5 minutes old): requeued; running likewise; after 6 hours its message says it is still with the bridge
  7. waiting more than 6 hours: the message says so, once; updated_at not moved
  8. row_version moves on with every update (the compare-and-set of posts_update): a write on the version read after an
     owner's settlement changes nothing
RED_WITHOUT_174=1: the same checks without the file (2-8 fail)."""
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
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
def fbody(t_, name):
    i = t_.index("create or replace function public." + name + "("); return t_[i:t_.index("$function$;", i)].splitlines()

text = open(M174).read() if os.path.exists(M174) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M174), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and re.findall(r"alter table ([\w.]+) (\w+ \w+)", code) == [("public.tally_post_jobs", "add column")], "add-only: one column added, nothing dropped, deleted or truncated")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
NEW = {"tally_post_job_blocked": "(uuid)", "tally_post_hold": "(uuid, text, boolean)", "tally_post_bridge_holds": "(uuid)"}
REPL = {"tally_post_pickable_ok": "(uuid, uuid, text)", "tally_post_take_for": "(uuid, text, boolean)"}
TRIG = ["tally_post_jobs_version", "tally_post_links_hold", "tally_post_split_hold"]
ok(made == sorted(list(NEW) + list(REPL) + TRIG + ["tally_post_requeue"]), "makes or replaces only %s" % made)
for fn, sig in list(NEW.items()) + list(REPL.items()):
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, "%s: service_role only, granted explicitly" % fn)
for fn in TRIG + ["tally_post_requeue"]:
    ok(("revoke all on function public.%s() from public, anon, authenticated;" % fn) in text, "%s: nobody may call it" % fn)
# started from the latest text: the lines added and removed against 142 (take_for, pickable_ok) and 36b (requeue)
m142, m36b = open(os.path.join(SQLDIR, "migration-142-post-any-bridge.sql")).read(), open(os.path.join(SQLDIR, "migration-36b-post-acceptance.sql")).read()
for name, base, n_add, n_gone in (("tally_post_take_for", m142, 6, 1), ("tally_post_pickable_ok", m142, 1, 1), ("tally_post_requeue", m36b, 13, 2)):
    if not text: ok(False, name + ": no file"); continue
    a, b = fbody(text, name), fbody(base, name)
    added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
    ok(len(added) == n_add and len(gone) == n_gone, "%s: the latest text (%s) with %d line(s) added, %d changed (%d / %d): %s" % (name, "142" if base is m142 else "36b", n_add, n_gone, len(added), len(gone), gone))

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
           % (q(J(n)), q(F), q(client), q(company), q(dev), q(json.dumps({"masters": [], "vouchers": [{"id": "V%d" % n, "xml": "<VOUCHER/>"}], "ledger": ""})), q(status), q(target), q(taken_by) if taken_by else "null", attempts,
              ("now() - interval '%d minutes'" % ago) if taken_by else "null", "null" if seq is None else int(seq), q(json.dumps(results)) if results is not None else "null", q(json.dumps(items)) if items is not None else "null", ago, ago))
def take(dev, bridge):
    r = db.rows("select id::text, device_id::text dev, target_bridge, taken_by, status from tally_post_take_for(%s::uuid, %s, true)" % (q(dev), q(bridge)))
    return r[0] if r else None
row = lambda n: (db.rows("select device_id::text dev, target_bridge, coalesce(taken_by, '') taken_by, coalesce(taken_at::text, '') taken_at, status, attempts::text attempts, coalesce(message, '') message, updated_at::text upd from tally_post_jobs where id = %s" % q(J(n))) or [None])[0]
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
    job(3, BA, DA)                                                         # waiting
    job(31, BA, DA, status="taken", taken_by=BA, seq=1, items=[{"id": "V31", "state": "waiting"}])          # taken, nothing sent
    job(32, BA, DA, status="taken", taken_by=BA, seq=2, results=[{"id": "V32", "ok": False, "state": "sent", "sent": True}], items=[{"id": "V32", "state": "sent"}])   # an entry sent
    ver = db.one("select version from tally_links where book_id = %s" % q(BK))
    r = rpc(OWNER, "select tally_link_posting(%s::uuid, false, %s)::text" % (q(BK), ver))
    ok("_error" not in r and r.get("posting_allowed") is False, "the owner stops posting into Tally (%s)" % r.get("_error", ""))
    WORDS = "Not posted: posting into Tally was stopped for Made-up Osprey after this was queued."
    ok(row(3)["status"] == "failed" and row(3)["message"].startswith(WORDS), "waiting: failed with the reason (%s)" % row(3)["message"][:120])
    ok(row(31)["status"] == "failed" and row(31)["message"].startswith(WORDS) and "stops it" in row(31)["message"], "taken, nothing of it sent yet: failed, the bridge told to stop (%s)" % row(31)["message"][-60:])
    ok(row(32)["status"] == "taken", "taken with an entry sent to Tally: left to finish (%s)" % row(32)["status"])
    job(33, BA, DA)
    ok(take(DA, BA) is None and take(DB, BB) is None and row(33)["status"] == "failed", "queued straight in while stopped: never taken, failed at take")
    r = rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(J(3)), q(json.dumps({"vouchers": [{"id": "V3", "xml": "<VOUCHER/>"}]}))))
    ok(r.get("ok") is False and "stopped" in str(r.get("error")) and row(3)["status"] == "failed", "Retry while still stopped: refused (%s)" % (r.get("error") or r.get("_error")))
    ver = db.one("select version from tally_links where book_id = %s" % q(BK))
    rpc(OWNER, "select tally_link_posting(%s::uuid, true, %s)::text" % (q(BK), ver))
    db.sql("update tally_post_jobs set status = 'cancelled' where id in (%s, %s)" % (q(J(32)), q(J(33))))
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

    print("== 5. the requeue: another bridge may take it after 15 minutes")
    setbeat(DA, beat("made-up-a", BA, [], ago=12)); setbeat(DB, beat("made-up-b", BB, [CO]))
    job(5, BA, DA, status="taken", taken_by=BA, ago=11)
    n = requeue(); x = row(5)
    ok(x["status"] == "waiting" and x["taken_by"] == "" and x["taken_at"] == "" and x["attempts"] == "1", "taken 11 minutes ago, never reported: back to waiting, taken_by and taken_at cleared (%s)" % x)
    ok(take(DB, BB) is None, "B (company open, A quiet) does not take it at once")
    db.sql("update tally_post_jobs set updated_at = now() - interval '16 minutes' where id = %s" % q(J(5)))
    t = take(DB, BB)
    ok(t is not None and t["id"] == J(5) and t["dev"] == DB and t["taken_by"] == BB, "after 15 minutes waiting: B takes it, the posting is B's now (%s)" % t)
    clear()
    job(51, BA, DA, status="taken", taken_by=BA, ago=11); requeue()
    setbeat(DA, beat("made-up-a", BA, [CO]))
    t = take(DA, BA); ok(t is not None and t["id"] == J(51) and t["taken_by"] == BA, "A back with the company open: takes its own back at once (%s)" % t)
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
    ok(x["status"] == "waiting" and x["attempts"] == "1" and x["taken_by"] == "", "A quiet 5 minutes: requeued (%s)" % x)
    ok(row(61)["status"] == "waiting", "the running one too (%s)" % row(61)["status"])
    clear()
    setbeat(DA, beat("made-up-a", BA, []))
    job(62, BA, DA, status="taken", taken_by=BA, seq=3, ago=7 * 60)
    db.sql("update tally_post_jobs set message = 'Waiting for Tally: Tally is closed' where id = %s" % q(J(62)))
    requeue(); requeue(); x = row(62)
    ok(x["status"] == "taken" and x["message"] == "Still with the FinCom Bridge after 6 hours: Waiting for Tally: Tally is closed", "held 7 hours: still taken, the message says so once (%s)" % x["message"])
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
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
