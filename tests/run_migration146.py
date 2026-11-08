"""python3 run_migration146.py - server/tally-cloud/migration-146-reads-follow-company.sql (08-Nov-2026, branch
next-link-follow; the owner: "it should connect to both Tally rather than switching… like Tally can be opened by n persons
and used simultaneously"). On a throwaway PostgreSQL (pg_stand, port 31146 unless PG146_PORT; never a real database),
built 32 -> ... -> 63 -> 98 -> 133 -> 135 -> 110 -> 115 -> 116 -> 127 -> 142, with made-up firms, logins and companies
only. One shared server (SRV9): Windows logins A (the link's key), B and D, each its own key and bridge; C on another
computer (LAPTOP7) of the same firm; X of ANOTHER firm with the same company open. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (no drop, delete, truncate, no other table altered; nothing
     but new functions); RLS on the new table; grants explicit; names no real database; md5; runs twice; members may not
     call the service-role functions
  1. the serving bridges: A and B together (A first); never X (another firm); never a copy in another folder, another GUID
     or none in the bridge's OWN record, a bridge heard 4 minutes ago (A, the link's key, still at 4, not at 6), reading
     stopped (by itself or from FinCom), test mode, a v1 bridge, a link with no GUID
  2. the days shared: A and B are handed different days; a bridge not serving gets none; 2 x 15 claims at the same time
     from two connections: no day held by two; a dead claim (expired) goes to the other bridge; the check's days the same
  3. tally_work_claim: one holder a unit; the same bridge renews; another gets it only after expiry; a bridge id not bound
     to the key gets nothing
  4. "read older entries": B (its own off, never switched) follows A's switch on the same computer (info.computer only), as
     it is NOW; C (another computer) not; B turned off by a person stays off; no computer in B's record: never its key name
  5. a posting taken once: A offline, B and D open, one waiting posting for A taken by B and D at the same time: exactly
     one takes it
  6. tally_read_view (members): the serving bridges, fetchOn, and the held lines the cloud asks again (another bridge's,
     not serving; 7 days, or slow-ended 30 days for 2.3.4+; never one already resolved, a serving bridge's own, or one of
     a locked month); another firm's member sees none
RED_WITHOUT_146=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib, subprocess, datetime, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.join(HERE, "..")
SQLDIR = os.path.join(ROOT, "server", "tally-cloud")
M146 = os.path.join(SQLDIR, "migration-146-reads-follow-company.sql")
RED = os.environ.get("RED_WITHOUT_146") == "1"
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql", "migration-63-recorder-repeat.sql",
                                           "migration-98-period-pull.sql", "migration-133-fetch-check.sql", "migration-135-check-changes.sql",
                                           "migration-110-tally-link-record.sql", "migration-115-bridge-follows-login.sql")] + \
        [os.path.join(ROOT, "server", "security", "migration-116-write-checks.sql"), os.path.join(SQLDIR, "migration-127-tally-place-real-folder.sql"),
         os.path.join(SQLDIR, "migration-142-post-any-bridge.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]

text = open(M146).read() if os.path.exists(M146) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M146), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and not re.search(r"\balter\s+table\s+(?!public\.tally_work_claims\s+enable)", code), "add-only: nothing dropped, deleted, truncated; no other table altered")
ok("create table if not exists public.tally_work_claims" in code and "alter table public.tally_work_claims enable row level security" in code, "the new table, RLS on")
ok(not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
SVC = {"tally_read_heard": "(uuid)", "tally_read_serving": "(uuid, uuid)", "tally_read_serving_many": "(uuid, uuid[])", "tally_read_serves": "(uuid, uuid, uuid, text)",
       "tally_work_claim": "(uuid, uuid, text, text[], uuid, text, integer)", "tally_days_claim": "(uuid, uuid, uuid, text, text, integer, boolean)", "tally_fetch_on": "(uuid)"}
for fn, sig in SVC.items():
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, "%s: service_role only" % fn)
ok("revoke all on function public.tally_read_view() from public, anon;" in text and "grant execute on function public.tally_read_view() to authenticated, service_role;" in text, "tally_read_view: members")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == sorted(list(SVC) + ["tally_read_view"]), "adds only %s" % made)
old = set()
for f in FILES:
    if f.endswith(".sql") and os.path.exists(f): old |= set(re.findall(r"create or replace function public\.(\w+)\(", open(f).read().lower()))
ok(not (set(made) & old), "no existing function replaced (%s)" % sorted(set(made) & old))

F, F2 = "99999999-9999-9999-9999-999999999146", "88888888-8888-8888-8888-888888888146"
OWNER, STAFF, OTHER = "55555555-5555-5555-5555-555555555146", "66666666-6666-6666-6666-666666666146", "77777777-7777-7777-7777-777777777146"
DA, DB, DC, DD, DX = ("d1000000-0000-0000-0000-0000000001%s6" % c for c in "abcde")
BA, BB, BC, BD, BX = ("go-%s000146" % (c * 4) for c in "abcde")
BK = "b0000001-0000-0000-0000-000000000146"
CO, GUID = "Made-up Osprey Stores", "a1b2c3d4-0000-0000-0000-000000000146"
FOLDER = "C:\\TallyData\\Shared"
NOW = datetime.datetime.now(datetime.timezone.utc)
TODAY = datetime.date.today()
FY = datetime.date(TODAY.year - (1 if TODAY.month >= 4 else 2), 4, 1)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
db = pg_stand.start(int(os.environ.get("PG146_PORT") or 31146))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def psql_service(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt", "-c",
                           "set role service_role; set request.jwt.claim.role = 'service_role'; " + sql], capture_output=True, text=True)
def as_role(role, uid, stmt):
    try: return True, db.one("set role %s; %s" % (role, stmt), uid)
    except RuntimeError as e: return False, str(e)
def rpc(uid, stmt, role="authenticated"):
    good, out = as_role(role, uid, stmt)
    if not good: return {"_error": out[-400:]}
    try: return json.loads(out) if out else {}
    except (TypeError, ValueError): return {"_out": out}
def entry(user, open_, ago=0, guid=GUID, folder=FOLDER, pc="SRV9", port=9000, stopped=False, mode="main", cos=True, version="2.5.7"):
    at = iso(NOW - datetime.timedelta(minutes=ago))
    b = {"at": at, "computer": pc, "user": pc + "\\" + user, "mode": mode, "open": list(open_), "tallyPort": port, "dataFolder": folder, "version": version}
    if cos: b["cos"] = [[n, guid] for n in open_]
    if stopped: b["readStopped"] = {"by": "self", "reason": "made-up", "at": at}
    return b
def beat(user, bridge, open_, ago=0, pc="SRV9", extra=None, readstop=False, **kw):
    at = iso(NOW - datetime.timedelta(minutes=ago))
    bs = {bridge: entry(user, open_, ago, pc=pc, **kw)}; bs.update(extra or {})
    i = {"computer": pc, "beat": {"at": at, "windowsUser": pc + "\\" + user, "open": list(open_), "companies": [{"name": n, "guid": kw.get("guid", GUID), "open": True} for n in open_]}, "bridges": bs}
    if readstop: i["readStop"] = {"by": "fincom", "reason": "made-up", "at": at}
    return i
def setbeat(dev, info, ago=0): db.sql("update tally_devices set info = %s, last_seen = now() - interval '%d minutes' where id = %s" % (q(json.dumps(info)), ago, q(dev)))
def serving():
    if RED: return []
    return json.loads(db.one("select tally_read_serving(%s::uuid, %s::uuid)::text" % (q(F), q(BK))) or "[]")
keys = lambda s: [(x["device"], x["bridge"]) for x in s]
def claim(dev, br, kind="period", n=3):
    if RED: return []
    out = db.one("select tally_days_claim(%s::uuid, %s::uuid, %s::uuid, %s, %s, %d, false)::text" % (q(F), q(BK), q(dev), q(br), q(kind), n))
    return [x["day"] for x in json.loads(out or "[]")]
def wclaim(units, dev, br, kind="held", ttl=300):
    if RED: return []
    out = db.one("select array_to_json(tally_work_claim(%s::uuid, %s::uuid, %s, array[%s]::text[], %s::uuid, %s, %d))::text" % (q(F), q(BK), q(kind), ",".join(q(u) for u in units), q(dev), q(br), ttl))
    return json.loads(out or "[]")
held_by = lambda kind="period": {} if RED else {r["unit"]: (r["device_id"], r["bridge_id"]) for r in db.rows("select unit, device_id::text, bridge_id from tally_work_claims where book_id = %s and kind = %s and until > now()" % (q(BK), q(kind)))}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
                          alter role service_role bypassrls;
                          if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if; end $$;
      grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
      grant select on members to authenticated, service_role;
      insert into firms values (%(F)s, 'Made-up Firm'), (%(F2)s, 'Made-up Other Firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
      insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%(DA)s, %(F)s, 'SRV9 · made-up-a', 'ha', '2.5.7', '{}', %(O)s),
        (%(DB)s, %(F)s, 'SRV9 · made-up-b', 'hb', '2.5.7', '{}', %(O)s), (%(DC)s, %(F)s, 'LAPTOP7 · made-up-c', 'hc', '2.5.7', '{}', %(O)s),
        (%(DD)s, %(F)s, 'SRV9 · made-up-d', 'hd', '2.5.7', '{}', %(O)s), (%(DX)s, %(F2)s, 'SRV9 · made-up-x', 'hx', '2.5.7', '{}', %(X)s);
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, updated_at timestamptz default now(), primary key (firm_id, id));
      create table if not exists public.tally_companies (firm_id uuid not null references public.firms(id) on delete cascade, company text not null, client_id text, gstin text,
        device_id uuid references public.tally_devices(id) on delete set null, first_seen timestamptz not null default now(), last_seen timestamptz, linked_at timestamptz, linked_by uuid,
        book_id uuid not null default gen_random_uuid() unique, primary key (firm_id, company));
      alter table public.tally_companies enable row level security;
      create policy tally_companies_read on public.tally_companies for select to authenticated using (firm_id = public.my_firm());
      grant select on public.tally_companies to authenticated;
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'Made-up Osprey', '{"choices": {}}');
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen, linked_at, book_id) values (%(F)s, %(CO)s, 'c1', %(DA)s, now(), now(), %(BK)s);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(BK)s, %(F)s, 'c1', %(CO)s, %(FY)s, %(FY)s::date - 1);
      create table if not exists auth.users (id uuid primary key, email text);""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "X": q(OTHER), "DA": q(DA), "DB": q(DB), "DC": q(DC), "DD": q(DD), "DX": q(DX), "BK": q(BK), "CO": q(CO), "FY": q(FY.isoformat())})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role; grant all on all sequences in schema public to service_role;")
    setbeat(DA, beat("made-up-a", BA, [CO])); setbeat(DB, beat("made-up-b", BB, [CO], port=9001)); setbeat(DC, beat("made-up-c", BC, [], pc="LAPTOP7"))
    setbeat(DD, beat("made-up-d", BD, [], port=9003)); setbeat(DX, beat("made-up-x", BX, [CO]))
    for d, b in ((DA, BA), (DB, BB), (DC, BC), (DD, BD), (DX, BX)): db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(d), q(b)))
    loc = json.loads(db.one("select tally_link_loc(%s::uuid, %s, %s)::text" % (q(DA), q(BA), q(CO))))["loc"]
    db.sql("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, device_id, computer, posting_allowed, state, data_loc, data_folder, windows_user, tally_port) values (%s, %s, 'c1', %s, %s, %s, 'SRV9', true, 'linked', %s, %s, 'SRV9\\made-up-a', 9000) on conflict (firm_id, book_id) do update set data_loc = excluded.data_loc, device_id = excluded.device_id, company_guid = excluded.company_guid, posting_allowed = true, state = 'linked', client_id = 'c1'"
           % (q(F), q(BK), q(GUID), q(CO), q(DA), q(loc), q(FOLDER)))
    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_146: not run)" % n); continue
        r = psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    if not RED:
        for rr in db.rows("select p.proname n, md5(p.prosrc) m from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[%s]) order by 1" % ",".join(q(x) for x in made)):
            print("  read-back %(n)s md5(prosrc)=%(m)s" % rr)
        good, out = as_role("authenticated", STAFF, "select tally_days_claim(%s::uuid, %s::uuid, %s::uuid, %s, 'period', 3, false)::text" % (q(F), q(BK), q(DA), q(BA)))
        ok(not good, "a member may not claim days (%s)" % out.strip()[-70:])
        good, out = as_role("anon", None, "select count(*) from tally_work_claims"); ok(not good, "anon reads no claims")

    print("== 1. the serving bridges")
    s = serving()
    ok(keys(s) == [(DA, BA), (DB, BB)] and s and s[0]["linked"] is True, "A and B serve, A (the link's key) first; never X of another firm (%s)" % keys(s))
    for what, dev, info, want in (("A heard 4 minutes ago (the link's key: present until 5)", DA, beat("made-up-a", BA, [CO], ago=4), [(DA, BA), (DB, BB)]),
                                  ("A heard 6 minutes ago", DA, beat("made-up-a", BA, [CO], ago=6), [(DB, BB)]),
                                  ("B heard 4 minutes ago", DB, beat("made-up-b", BB, [CO], ago=4, port=9001), [(DA, BA)]),
                                  ("B reads a copy in another folder", DB, beat("made-up-b", BB, [CO], folder="D:\\Copy\\Data", port=9001), [(DA, BA)]),
                                  ("B's own record: another GUID", DB, beat("made-up-b", BB, [CO], guid="ffffffff-0000-0000-0000-000000000146", port=9001), [(DA, BA)]),
                                  ("B's own record: no GUIDs (an older tally-ingest)", DB, beat("made-up-b", BB, [CO], cos=False, port=9001), [(DA, BA)]),
                                  ("B's reading stopped by itself", DB, beat("made-up-b", BB, [CO], stopped=True, port=9001), [(DA, BA)]),
                                  ("B's reading stopped from FinCom", DB, beat("made-up-b", BB, [CO], readstop=True, port=9001), [(DA, BA)]),
                                  ("B in test mode", DB, beat("made-up-b", BB, [CO], mode="test", port=9001), [(DA, BA)])):
        setbeat(dev, info); got = keys(serving())
        ok(got == want, "%s: %s" % (what, got))
        setbeat(DA, beat("made-up-a", BA, [CO])); setbeat(DB, beat("made-up-b", BB, [CO], port=9001))
    v1 = beat("made-up-b", BB, [], port=9001); v1["bridges"]["v1"] = {"at": iso(NOW), "computer": "SRV9", "user": "SRV9\\made-up-b", "open": [CO], "cos": [[CO, GUID]]}
    setbeat(DB, v1); ok(keys(serving()) == [(DA, BA)], "a v1 bridge: never")
    setbeat(DB, beat("made-up-b", BB, [CO], port=9001))
    db.sql("update tally_links set company_guid = null where book_id = %s" % q(BK)); ok(serving() == [], "a link with no GUID: none")
    db.sql("update tally_links set company_guid = %s where book_id = %s" % (q(GUID), q(BK)))

    print("== 2. the days shared, never handed to two")
    pc = rpc(OWNER, "select tally_period_choose(%s, %s, 'year')::text" % (q(BK), q(FY.isoformat())))
    ok(pc.get("ok") is not False and "_error" not in pc, "Bring books chosen for the year (%s)" % str(pc)[:120])
    a1, b1 = claim(DA, BA), claim(DB, BB)
    ok(len(a1) == 3 and len(b1) == 3 and not (set(a1) & set(b1)), "A and B each get 3 days, none the same (%s / %s)" % (a1, b1))
    ok(claim(DC, BC) == [] and claim(DX, BX) == [], "a bridge not serving (C, X of another firm): none")
    res = {BA: [], BB: []}
    def worker(dev, br):
        for _ in range(15):
            r = psql_service("select tally_days_claim(%s::uuid, %s::uuid, %s::uuid, %s, 'period', 3, false)::text" % (q(F), q(BK), q(dev), q(br)))
            if r.returncode == 0 and r.stdout.strip(): res[br] += [x["day"] for x in json.loads(r.stdout.strip().splitlines()[-1])]
    if not RED:
        ts = [threading.Thread(target=worker, args=(DA, BA)), threading.Thread(target=worker, args=(DB, BB))]
        [t.start() for t in ts]; [t.join() for t in ts]
    hb = held_by()
    ok(len(res[BA]) > 0 and len(res[BB]) > 0 and not (set(res[BA]) & set(res[BB])), "2 x 15 claims at the same time: %d and %d days, none given to both" % (len(set(res[BA])), len(set(res[BB]))))
    ok(all(hb.get(d) == (DA, BA) for d in set(res[BA]) | set(a1)) and all(hb.get(d) == (DB, BB) for d in set(res[BB]) | set(b1)), "each day held by the bridge it was given to")
    # review of 314a178f1: a day listed but given to nobody keeps its asked stamps (never marked asked for nobody)
    if not RED:
        stamped = {r["d"] for r in db.rows("select to_char(day, 'YYYYMMDD') d from tally_period_days where book_id = %s and asked_at is not null" % q(BK))}
        given = {r["unit"] for r in db.rows("select unit from tally_work_claims where book_id = %s and kind = 'period'" % q(BK))}
        ok(stamped and stamped <= given, "every day marked asked is a day some bridge was given (%d stamped, %d given; %s)" % (len(stamped), len(given), sorted(stamped - given)[:5]))
        pre = db.rows("select to_char(day, 'YYYYMMDD') d, asked_at::text a from tally_period_days where book_id = %s order by 1" % q(BK))
        ok(claim(DC, BC) == [] and db.rows("select to_char(day, 'YYYYMMDD') d, asked_at::text a from tally_period_days where book_id = %s order by 1" % q(BK)) == pre, "a bridge not serving: no day stamped")
    # the check's days: three days, all to A; B none; A's claims expire: B gets them
    if not RED:
        rq = rpc(OWNER, "select tally_check_request('c1', %s::date, %s::date)::text" % (q((FY + datetime.timedelta(days=10)).isoformat()), q((FY + datetime.timedelta(days=12)).isoformat())))
        ok(rq.get("ok") is True, "check for changes asked for 3 days (%s)" % str(rq)[:100])
    ca = claim(DA, BA, "check", 5); cb = claim(DB, BB, "check", 5)
    ok(len(ca) == 3 and cb == [], "the check's 3 days: all to A, none to B while A holds them (%s / %s)" % (ca, cb))
    if not RED: db.sql("update tally_work_claims set until = now() - interval '1 second' where book_id = %s and kind = 'check' and bridge_id = %s" % (q(BK), q(BA)))
    cb = claim(DB, BB, "check", 5)
    ok(sorted(cb) == sorted(ca) and len(cb) == 3, "A's claims dead (expired): B gets those days (%s)" % cb)
    if not RED:
        before = db.rows("select to_char(day, 'YYYYMMDD') d, asked_at::text a, first_asked_at::text f from tally_check_days where book_id = %s order by 1" % q(BK))
        ok(claim(DA, BA, "check", 5) == [] and db.rows("select to_char(day, 'YYYYMMDD') d, asked_at::text a, first_asked_at::text f from tally_check_days where book_id = %s order by 1" % q(BK)) == before,
           "A asks while B holds all 3: none given, and none of their asked stamps changed")

    print("== 3. tally_work_claim")
    w0 = wclaim(["L-1", "L-2"], DA, BA); ok(sorted(w0) == ["L-1", "L-2"], "A claims two held lines (%s)" % w0)
    ok(wclaim(["L-1", "L-3"], DB, BB) == ["L-3"], "B: only the one A does not hold")
    ok(wclaim(["L-1"], DA, BA) == ["L-1"], "A again: renewed")
    if not RED: db.sql("update tally_work_claims set until = now() - interval '1 second' where book_id = %s and kind = 'held' and unit = 'L-1'" % q(BK))
    ok(wclaim(["L-1"], DB, BB) == ["L-1"], "A's claim expired: B gets it")
    ok(wclaim(["L-9"], DA, BB) == [] and wclaim(["L-9"], DA, "v1") == [], "a bridge id not bound to that key, or a v1 bridge: nothing")

    print("== 4. read older entries: a key nobody switched follows a key on the same computer (info.computer), as it is now")
    fon = lambda d: (db.one("select tally_fetch_on(%s::uuid)::text" % q(d)) == "true") if not RED else None
    db.sql("update tally_devices set period_fetch = false, period_fetch_at = null where firm_id = %s" % q(F))
    db.sql("update tally_devices set period_fetch = true where id = %s" % q(DA))
    ok(fon(DB) is True and fon(DC) is False, "A's switch on: B (same computer, never switched) on, C (another computer) off")
    db.sql("update tally_devices set period_fetch = false where id = %s" % q(DA))
    ok(fon(DB) is False, "A's switch turned off: B off too")
    db.sql("update tally_devices set period_fetch = true where id = %s" % q(DA))
    db.sql("update tally_devices set period_fetch = false, period_fetch_at = now() where id = %s" % q(DB))
    ok(fon(DB) is False, "B turned off by a person (period_fetch_at set): stays off whatever A's switch")
    db.sql("update tally_devices set period_fetch = true, period_fetch_at = now() where id = %s" % q(DB))
    ok(fon(DB) is True, "B turned on by a person: on")
    db.sql("update tally_devices set period_fetch = false, period_fetch_at = null where id = %s" % q(DB))
    nb = beat("made-up-b", BB, [CO], port=9001); nb.pop("computer")
    setbeat(DB, nb)
    ok(fon(DB) is False, "B with no computer in its record: the key's name (SRV9 · ...) is never matched")
    setbeat(DB, beat("made-up-b", BB, [CO], port=9001))
    ok(fon(DB) is True, "B's record says SRV9 again: on")
    db.sql("update tally_devices set period_fetch = true where firm_id = %s" % q(F))

    print("== 5. a waiting posting: taken by exactly one bridge")
    setbeat(DA, beat("made-up-a", BA, [])); setbeat(DD, beat("made-up-d", BD, [CO], port=9003)); db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(DD), q(BD)))
    J = "00000146-0000-0000-0000-000000000146"
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge) values (%s, %s, 'c1', %s, %s, %s, 1, 'waiting', %s)"
           % (q(J), q(F), q(CO), q(DA), q(json.dumps({"masters": [], "vouchers": [{"id": "V146", "xml": "<VOUCHER/>"}], "ledger": ""})), q(BA)))
    took = {}
    def taker(dev, br):
        r = psql_service("select coalesce((select id::text from tally_post_take_for(%s::uuid, %s, true)), '')" % (q(dev), q(br)))
        took[br] = r.stdout.strip()
    ts = [threading.Thread(target=taker, args=(DB, BB)), threading.Thread(target=taker, args=(DD, BD))]
    [t.start() for t in ts]; [t.join() for t in ts]
    winners = [b for b, v in took.items() if v == J]
    row = db.rows("select device_id::text dev, taken_by from tally_post_jobs where id = %s" % q(J))[0]
    ok(len(winners) == 1 and row["taken_by"] == winners[0], "B and D at the same time: exactly one takes it (%s; %s)" % (took, row))

    print("== 6. the page's view")
    setbeat(DA, beat("made-up-a", BA, [CO], ago=10), ago=10)
    line = lambda lid, dev, br, days=1, why="Tally did not answer in time for this entry when asked again; upload that day's Day Book to settle it", guid=GUID, mid="146", typ="Sales", no="7", co=CO: db.one(
        "insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, line_id, event, state, held_why, received_at, company, company_guid, master_id, vch_type, vch_no) values (%s, 'c1', %s, %s, %s, %s, 'created', 'held', %s, now() - interval '%d days', %s, %s, %s, %s, %s) returning id::text"
        % (q(F), q(BK), q(dev), q(br), q(lid), q(why), days, q(co), "null" if guid is None else q(guid), "null" if mid is None else q(mid), q(typ), q(no)))
    ids = {"a1": line("L-a1", DA, BA), "a2": line("L-a2", DA, BA), "b1": line("L-b1", DB, BB), "a10": line("L-a10", DA, BA, 10, "could not tell which entry; upload the Day Book"),
           "a20": line("L-a20", DA, BA, 20), "lk": line("L-lk", DA, BA),
           # review of 314a178f1: lines no bridge would ask (bridge-go applyHeldLines), so their Day Book upload stays
           "tn": line("L-tn", DA, BA, mid=None), "ng": line("L-ng", DA, BA, guid=None), "og": line("L-og", DA, BA, guid="ffffffff-0000-0000-0000-000000000146"),
           "nm": line("L-nm", DA, BA, mid=None, no=""), "wl": line("L-wl", DA, BA, why="waiting for the ledger Made-up Rent; FinCom asks Tally for it"),
           "cb": line("L-cb", DA, BA, co="Made-up Another Company")}
    db.one("insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, line_id, event, state) values (%s, 'c1', %s, %s, %s, 'L-a2:resolved', 'created', 'applied') returning id::text" % (q(F), q(BK), q(DB), q(BB)))
    db.sql("update tally_recorder_lines set vch_date = date '2026-04-10' where id = %s" % ids["lk"])
    db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month) values (%s, 'c1', %s, date '2026-04-01')" % (q(F), q(BK)))
    v = rpc(STAFF, "select tally_read_view()::text") if not RED else {}
    bk = next((x for x in (v.get("books") or []) if x.get("book") == BK), {}) if isinstance(v, dict) else {}
    sv = [(x.get("device"), x.get("bridge")) for x in (bk.get("serving") or [])]
    ok(set(sv) == {(DB, BB), (DD, BD)} and bk.get("linkDevice") == DA and bk.get("fetchOn") is True, "the view: B and D serve (A offline), fetchOn (%s, %s)" % (sv, bk.get("fetchOn")))
    re_ = set(str(x) for x in (bk.get("reask") or []))
    ok(ids["tn"] in re_ and not (re_ & {ids["ng"], ids["og"], ids["nm"], ids["wl"], ids["cb"]}),
       "re-asked only lines a bridge asks: by type and number too; never no GUID, another GUID, nothing to ask by, waiting for a ledger, another company (%s)" % sorted(re_))
    ok(ids["a1"] in re_ and ids["a20"] in re_ and not (re_ & {ids["a2"], ids["b1"], ids["a10"], ids["lk"]}),
       "re-asked: A's line (1 day) and its slow-ended one (20 days); not one resolved, a serving bridge's own, a 10-day other one, or one of a locked month (%s)" % sorted(re_))
    good, out = as_role("anon", None, "select tally_read_view()::text"); ok(not good, "anon: no view")
    v2 = rpc(OTHER, "select tally_read_view()::text"); ok(isinstance(v2, dict) and not (v2.get("books") or []), "another firm's member sees none of it")
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
