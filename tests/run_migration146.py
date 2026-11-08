"""python3 run_migration146.py - server/tally-cloud/migration-146-reads-follow-company.sql (08-Nov-2026, branch
next-link-follow; the owner: "it should automatically bring all the data"; "every function of the Tally page should work
with every person who has connected Tally"). On a throwaway PostgreSQL (pg_stand, port 31146 unless PG146_PORT; never a
real database), built 32 -> ... -> 54 -> 55 -> 110 -> 115 -> 116 -> 127 -> 142 as run_migration142.py, with made-up firms,
logins and companies only. One shared server (SRV9): two Windows logins A (the link's key) and B, each its own computer
key and bridge; a third key C on another computer (LAPTOP7) of the same firm; a key X of ANOTHER firm with the same
company open. Checks:
  0. the file: one transaction, lock_timeout 10 s; nothing dropped or deleted; RLS on the new table; grants explicit;
     names no real database; md5; runs twice
  1. open in A and B: A reads (linked), nothing moves
  2. A offline (10 minutes), B open: the reads move to B (tally_links device_id, windows_user, tally_port;
     tally_companies.device_id), one row in tally_read_moves with A's key, user and port kept, why offline; fetchOn from A's
     switch (same computer); asked again: B reads (linked), no second move
  3. an owner puts the move back: the link is A's again, the book held 24 hours (no move by itself); staff may not; the
     moves table: a member reads their own firm's rows only, may not write
  4. never across firms: only X (another firm) has it open: none, nothing moves
  5. another data folder (a copy), another GUID, a bridge older than 3 minutes, reading stopped: never the reader
  6. A online with the company closed, B open: moves, why not_open; settling: within 2 minutes no second move
  7. the deterministic order: A offline, B (the link's computer) and C (another computer, heard later) open: B first;
     C's switch is its own (no inheritance across computers); with the link's real folder, C is another place: never
RED_WITHOUT_146=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib, subprocess, datetime
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
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
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
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and not re.search(r"\balter\s+table\s+(?!public\.tally_read_moves\s+enable)", code), "add-only: nothing dropped, deleted, truncated; no other table altered")
ok("create table if not exists public.tally_read_moves" in code and "alter table public.tally_read_moves enable row level security" in code, "the new table, RLS on")
ok(not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
ok("revoke all on function public.tally_read_follow(uuid, uuid) from public, anon, authenticated;" in text and "grant execute on function public.tally_read_follow(uuid, uuid) to service_role;" in text, "tally_read_follow: service_role only")
ok("revoke all on function public.tally_read_move_back(bigint) from public, anon;" in text and "grant execute on function public.tally_read_move_back(bigint) to authenticated, service_role;" in text, "tally_read_move_back: authenticated (owners, checked inside) and service_role")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == ["tally_read_follow", "tally_read_move_back"], "adds only %s" % made)

F, F2 = "99999999-9999-9999-9999-999999999146", "88888888-8888-8888-8888-888888888146"
OWNER, STAFF, OTHER = "55555555-5555-5555-5555-555555555146", "66666666-6666-6666-6666-666666666146", "77777777-7777-7777-7777-777777777146"
DA, DB, DC, DX = "d1000000-0000-0000-0000-0000000001a6", "d1000000-0000-0000-0000-0000000001b6", "d1000000-0000-0000-0000-0000000001c6", "d1000000-0000-0000-0000-0000000001e6"
BA, BB, BC, BX = "go-aaaa000146", "go-bbbb000146", "go-cccc000146", "go-eeee000146"
BK = "b0000001-0000-0000-0000-000000000146"
CO, GUID = "Made-up Osprey Stores", "a1b2c3d4-0000-0000-0000-000000000146"
FOLDER = "C:\\TallyData\\Shared"
NOW = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
db = pg_stand.start(int(os.environ.get("PG146_PORT") or 31146))
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
def beat(user, bridge, open_, ago=0, guid=GUID, folder=FOLDER, pc="SRV9", port=9000, stopped=False):
    at = iso(NOW - datetime.timedelta(minutes=ago))
    b = {"at": at, "computer": pc, "user": pc + "\\" + user, "mode": "main", "open": list(open_), "tallyPort": port, "dataFolder": folder}
    if stopped: b["readStopped"] = {"by": "self", "reason": "made-up", "at": at}
    return {"computer": pc, "beat": {"at": at, "windowsUser": pc + "\\" + user, "open": list(open_), "companies": [{"name": n, "guid": guid, "open": True} for n in open_]}, "bridges": {bridge: b}}
def setbeat(dev, info, ago=0): db.sql("update tally_devices set info = %s, last_seen = now() - interval '%d minutes' where id = %s" % (q(json.dumps(info)), ago, q(dev)))
def follow():
    if RED: return {}
    out = db.one("select tally_read_follow(%s::uuid, %s::uuid)::text" % (q(F), q(BK)))
    return json.loads(out) if out else {}
link = lambda: (db.rows("select device_id::text dev, windows_user, tally_port, computer, posting_allowed::text pa, version from tally_links where firm_id = %s and book_id = %s" % (q(F), q(BK))) or [{}])[0]
codev = lambda: db.one("select device_id::text from tally_companies where firm_id = %s and book_id = %s" % (q(F), q(BK)))
moves = lambda: db.rows("select id, from_device::text fd, from_user, from_port, from_co_device::text fcd, to_device::text td, to_bridge, to_user, why, fetch_on::text fo, undone_at from tally_read_moves where book_id = %s order by id" % q(BK)) if not RED else []
def relink_a():
    db.sql("update tally_links set device_id = %s, windows_user = 'SRV9\\made-up-a', tally_port = 9000, computer = 'SRV9' where firm_id = %s and book_id = %s" % (q(DA), q(F), q(BK)))
    db.sql("update tally_companies set device_id = %s where book_id = %s" % (q(DA), q(BK)))
    if not RED: db.sql("update tally_read_moves set at = now() - interval '1 day' where book_id = %s" % q(BK))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
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
        (%(DX)s, %(F2)s, 'SRV9 · made-up-x', 'hx', '2.5.7', '{}', %(X)s);
      alter table tally_devices add column if not exists period_fetch boolean not null default false;   -- migration 98's switch (not built here)
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, updated_at timestamptz default now(), primary key (firm_id, id));
      create table if not exists public.tally_companies (firm_id uuid not null references public.firms(id) on delete cascade, company text not null, client_id text, gstin text,
        device_id uuid references public.tally_devices(id) on delete set null, first_seen timestamptz not null default now(), last_seen timestamptz, linked_at timestamptz, linked_by uuid,
        book_id uuid not null default gen_random_uuid() unique, primary key (firm_id, company));
      alter table public.tally_companies enable row level security;
      create policy tally_companies_read on public.tally_companies for select to authenticated using (firm_id = public.my_firm());
      grant select on public.tally_companies to authenticated;
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'Made-up Osprey', '{}');
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen, linked_at, book_id) values (%(F)s, %(CO)s, 'c1', %(DA)s, now(), now(), %(BK)s);
      insert into tally_books (book_id, firm_id, client_id, company) values (%(BK)s, %(F)s, 'c1', %(CO)s);
      create table if not exists auth.users (id uuid primary key, email text);""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "X": q(OTHER), "DA": q(DA), "DB": q(DB), "DC": q(DC), "DX": q(DX), "BK": q(BK), "CO": q(CO)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;")
    setbeat(DA, beat("made-up-a", BA, [CO])); setbeat(DB, beat("made-up-b", BB, [CO], port=9001)); setbeat(DC, beat("made-up-c", BC, [], pc="LAPTOP7")); setbeat(DX, beat("made-up-x", BX, [CO]))
    for d, b in ((DA, BA), (DB, BB), (DC, BC), (DX, BX)): db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(d), q(b)))
    loc = json.loads(db.one("select tally_link_loc(%s::uuid, %s, %s)::text" % (q(DA), q(BA), q(CO))))["loc"]
    db.sql("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, device_id, computer, posting_allowed, state, data_loc, data_folder, windows_user, tally_port) values (%s, %s, 'c1', %s, %s, %s, 'SRV9', true, 'linked', %s, %s, 'SRV9\\made-up-a', 9000) on conflict (firm_id, book_id) do update set data_loc = excluded.data_loc, device_id = excluded.device_id, company_guid = excluded.company_guid, posting_allowed = true, state = 'linked', client_id = 'c1', windows_user = excluded.windows_user, tally_port = 9000"
           % (q(F), q(BK), q(GUID), q(CO), q(DA), q(loc), q(FOLDER)))
    db.sql("update tally_devices set period_fetch = true where id = %s" % q(DA))
    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_146: not run)" % n); continue
        r = psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    if not RED:
        for rr in db.rows("select p.proname n, md5(p.prosrc) m, p.prosecdef::text d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('tally_read_follow', 'tally_read_move_back') order by 1"):
            print("  read-back %(n)s md5(prosrc)=%(m)s definer=%(d)s" % rr)
        good, out = as_role("authenticated", STAFF, "select tally_read_follow(%s::uuid, %s::uuid)::text" % (q(F), q(BK)))
        ok(not good, "a member may not call tally_read_follow (%s)" % out.strip()[-80:])
        good, out = as_role("anon", None, "select count(*) from tally_read_moves")
        ok(not good, "anon reads no moves")

    print("== 1. open in A and B: A (the link's key) reads, nothing moves")
    r = follow()
    ok(r.get("state") == "linked" and (r.get("reader") or {}).get("bridge") == BA and len(r.get("serving") or []) == 2, "linked, A reads; both serve (%s)" % r.get("state"))
    ok(link().get("dev") == DA and not moves(), "the link stays A's, no move")
    ok(all((s.get("device") != DX) for s in (r.get("serving") or [])), "the other firm's bridge is never a candidate")

    print("== 2. A offline 10 minutes, B open: the reads move to B")
    setbeat(DA, beat("made-up-a", BA, [CO], ago=10), ago=10)
    v0 = link().get("version")
    r = follow(); lk = link(); mv = moves()
    ok(r.get("state") == "moved" and r.get("why") == "offline" and (r.get("reader") or {}).get("bridge") == BB, "moved, why offline, B reads (%s)" % r)
    ok(lk.get("dev") == DB and lk.get("windows_user") == "SRV9\\made-up-b" and int(lk.get("tally_port") or 0) == 9001 and lk.get("pa") == "true" and lk.get("version") == v0,
       "the link: B's key, user and port; posting permission and version unchanged (%s)" % lk)
    ok(codev() == DB, "tally_companies.device_id follows (%s)" % codev())
    ok(len(mv) == 1 and mv[0]["fd"] == DA and mv[0]["from_user"] == "SRV9\\made-up-a" and int(mv[0]["from_port"]) == 9000 and mv[0]["fcd"] == DA and mv[0]["td"] == DB and mv[0]["to_bridge"] == BB,
       "one move recorded, A's key, user, port kept (%s)" % mv)
    ok(r.get("fetchOn") is True and mv and mv[0]["fo"] == "true", "fetchOn: A's switch carries over on the same computer (B's own is off)")
    r = follow()
    ok(r.get("state") == "linked" and (r.get("reader") or {}).get("bridge") == BB and len(moves()) == 1 and r.get("fetchOn") is True, "asked again: B reads, no second move, fetchOn still (%s)" % r.get("state"))

    print("== 3. an owner puts it back; the book is held 24 hours")
    mid = int(mv[0]["id"]) if mv else 0
    r = rpc(STAFF, "select tally_read_move_back(%d)::text" % mid)
    ok("_error" in r and "owner" in r["_error"], "staff: refused (%s)" % str(r)[-90:])
    r = rpc(OTHER, "select tally_read_move_back(%d)::text" % mid)
    ok(("_error" in r) or r.get("ok") is False, "an owner of another firm: refused or nothing found (%s)" % str(r)[-90:])
    r = rpc(OWNER, "select tally_read_move_back(%d)::text" % mid)
    ok(r.get("ok") is True and link().get("dev") == DA and link().get("windows_user") == "SRV9\\made-up-a" and codev() == DA, "the owner: put back to A (%s / %s)" % (r, link()))
    r = follow()
    ok(r.get("state") == "held" and link().get("dev") == DA and len(moves()) == 1, "held: nothing moves by itself (%s)" % r.get("state"))
    n_own = rpc(OWNER, "select count(*)::text from tally_read_moves"); n_oth = rpc(OTHER, "select count(*)::text from tally_read_moves")
    ok(n_own == 1 and n_oth == 0, "a member reads their own firm's moves only (%s, %s)" % (n_own, n_oth))
    good, out = as_role("authenticated", OWNER, "insert into tally_read_moves (firm_id, book_id, to_device, to_bridge, why) values (%s, %s, %s, 'go-x', 'offline')" % (q(F), q(BK), q(DB)))
    ok(not good, "a member may not write a move")
    if not RED: db.sql("update tally_read_moves set undone_at = now() - interval '2 days' where book_id = %s" % q(BK))

    print("== 4. never across firms")
    setbeat(DB, beat("made-up-b", BB, [], port=9001))
    r = follow()
    ok(r.get("state") == "none" and link().get("dev") == DA and (r.get("linked") or {}).get("online") is False, "only X (another firm) open: none, the link stays, A offline said (%s)" % r.get("state"))

    print("== 5. a copy elsewhere, another GUID, an old beat, reading stopped: never the reader")
    for what, info in (("another folder", beat("made-up-b", BB, [CO], folder="D:\\Copy\\Data", port=9001)), ("another GUID", beat("made-up-b", BB, [CO], guid="ffffffff-0000-0000-0000-000000000146", port=9001)),
                       ("heard 4 minutes ago", beat("made-up-b", BB, [CO], ago=4, port=9001)), ("reading stopped", beat("made-up-b", BB, [CO], port=9001, stopped=True))):
        setbeat(DB, info); r = follow()
        ok(r.get("state") == "none" and link().get("dev") == DA, "%s: none, nothing moves (%s)" % (what, r.get("state")))

    print("== 6. A online without the company, B open: not_open; then settling")
    setbeat(DA, beat("made-up-a", BA, [])); setbeat(DB, beat("made-up-b", BB, [CO], port=9001))
    r = follow()
    ok(r.get("state") == "moved" and r.get("why") == "not_open" and link().get("dev") == DB, "moved, why not_open (%s)" % r)
    setbeat(DB, beat("made-up-b", BB, [], port=9001)); setbeat(DA, beat("made-up-a", BA, [CO]))
    r = follow()
    ok(r.get("state") == "settling" and link().get("dev") == DB, "within 2 minutes of a move: settling, no move back yet (%s)" % r.get("state"))

    print("== 7. the order: the link's computer first, then the newest; a switch is per computer; another computer is another place")
    relink_a(); setbeat(DA, beat("made-up-a", BA, [CO], ago=10), ago=10)
    loc0 = db.one("select data_loc from tally_links where book_id = %s" % q(BK))
    db.sql("update tally_links set data_loc = null where book_id = %s" % q(BK))      # a link with no real folder known: any place counts
    setbeat(DB, beat("made-up-b", BB, [CO], ago=1, port=9001)); setbeat(DC, beat("made-up-c", BC, [CO], pc="LAPTOP7"))
    r = follow()
    ok(r.get("state") == "moved" and (r.get("reader") or {}).get("device") == DB, "B (the link's computer, heard a minute ago) before C (another computer, heard now) (%s)" % (r.get("reader") or {}).get("device"))
    relink_a(); setbeat(DB, beat("made-up-b", BB, [], port=9001))
    r = follow()
    ok(r.get("state") == "moved" and (r.get("reader") or {}).get("device") == DC and r.get("fetchOn") is False, "only C (another computer) open: C reads, A's switch does not carry over (%s, %s)" % (r.get("state"), r.get("fetchOn")))
    relink_a(); db.sql("update tally_links set data_loc = %s where book_id = %s" % (q(loc0), q(BK)))
    r = follow()
    ok(r.get("state") == "none" and link().get("dev") == DA, "with the link's real folder: C (the same folder name on another computer) is another place, never the reader (%s)" % r.get("state"))
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
