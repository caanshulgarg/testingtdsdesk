"""python3 run_migration142.py - server/tally-cloud/migration-142-post-any-bridge.sql (06-Nov-2026, branch
next-tally-link-any-bridge; the owner's decision: a client <-> Tally company link belongs to the COMPANY, not to one Windows
login's bridge). On a throwaway PostgreSQL (pg_stand, port 31142 unless PG142_PORT; never a real database), built
32 -> ... -> 54 -> 55 -> 110 -> 115 -> 116 -> 127 as run_migration116.py, with made-up firms, logins and companies only.
One shared server (SRV9), two Windows logins, each its own computer key and bridge: A (made-up-a, the link's key) and B
(made-up-b). Checks:
  0. the file: one transaction, lock_timeout 10 s; create or replace only (no table, column, drop, delete, truncate);
     grants explicit; names no real database; md5; runs twice
  1. a posting queued for A while the company is open only in B's Tally: B takes it (tally_post_take_for), the posting
     is then B's (device, target, taken_by); A takes nothing afterwards; tally_post_pickable counts it for B before
  2. a posting already TAKEN by A is never handed to B (no double posting); nor a Retried one (attempts > 0, taken before)
  3. a waiting posting for A while A has the company open: B takes nothing (A's own)
  4. a bridge whose beat is older than 3 minutes does not serve; a company under ANOTHER GUID of the same name: not served
  5. another data folder than the link's (a copy of the company): not taken there
  6. tally_post_enqueue_to by a member with no bridge of their own: queued for the bridge with the company open (the
     link's key preferred when both have it open, else the other); open nowhere: refused "Open <company> in Tally ...";
     open only in a bridge reading ANOTHER data folder (a copy): never queued there
  8. tally_post_any_bridge(): true for a member (the page's check that 142 is here); anon may not; the note of a posting
     queued for a bridge not heard from names the company's Tally, never "your FinCom Bridge on <computer · login>"
  7. the beat's count (tally_post_count_for, what tally-ingest's postsFor says to the bridge): A online with the company
     closed is told 0 and handed nothing (its own posting waits in the cloud); A opens it: told 1 and takes it; with B
     open meanwhile, B is told 1 and takes it
RED_WITHOUT_142=1: the same checks without the file (1 and 6 fail)."""
import os, re, sys, json, hashlib, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.join(HERE, "..")
SQLDIR = os.path.join(ROOT, "server", "tally-cloud")
M142 = os.path.join(SQLDIR, "migration-142-post-any-bridge.sql")
RED = os.environ.get("RED_WITHOUT_142") == "1"
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
                                           "migration-110-tally-link-record.sql", "migration-115-bridge-follows-login.sql")] + \
        [os.path.join(ROOT, "server", "security", "migration-116-write-checks.sql"), os.path.join(SQLDIR, "migration-127-tally-place-real-folder.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]

text = open(M142).read() if os.path.exists(M142) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M142), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in code and not re.search(r"\b(drop|truncate|alter)\s", code) and not re.search(r"\bcreate\s+(table|policy|trigger|index)\b", code), "create or replace only: nothing dropped, deleted, truncated or altered")
ok(not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
FNS = {"tally_bridge_serves": "(uuid, text, text, text)", "tally_post_serving_bridge": "(uuid, text, text, uuid)", "tally_post_pickable_ok": "(uuid, uuid, text)",
       "tally_post_pickable": "(uuid, text)", "tally_post_take_for": "(uuid, text, boolean)", "tally_post_mine_ok": "(uuid, uuid, text, boolean)",
       "tally_post_count_for": "(uuid, text, boolean)"}
for fn, sig in FNS.items():
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, "%s: service_role only, granted explicitly" % fn)
ok("revoke all on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) from public, anon;" in text and "grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) to authenticated, service_role;" in text,
   "tally_post_enqueue_to: its grants restated")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok("revoke all on function public.tally_post_any_bridge() from public, anon;" in text and "grant execute on function public.tally_post_any_bridge() to authenticated, service_role;" in text,
   "tally_post_any_bridge: authenticated and service_role, granted explicitly")
ok(made == sorted(list(FNS) + ["tally_post_enqueue_to", "tally_post_any_bridge"]), "replaces or adds only %s" % made)

F = "99999999-9999-9999-9999-999999999142"
OWNER, STAFF = "55555555-5555-5555-5555-555555555142", "66666666-6666-6666-6666-666666666142"
DA, DB = "d1000000-0000-0000-0000-0000000001a2", "d1000000-0000-0000-0000-0000000001b2"
BA, BB = "go-aaaa000142", "go-bbbb000142"
BK = "b0000001-0000-0000-0000-000000000142"
CO, GUID = "Made-up Kestrel Traders", "a1b2c3d4-0000-0000-0000-000000000142"
FOLDER = "C:\\TallyData\\Shared"
J = lambda n: "%08d-0000-0000-0000-000000000142" % n
NOW = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
db = pg_stand.start(int(os.environ.get("PG142_PORT") or 31142))
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
# a login's beat: its bridge heard `ago` minutes ago, the companies open in its own Tally; the key's beat names the GUIDs
def beat(user, bridge, open_, ago=0, guid=GUID, folder=FOLDER):
    at = iso(NOW - datetime.timedelta(minutes=ago))
    return {"computer": "SRV9", "beat": {"at": at, "windowsUser": "SRV9\\" + user, "open": list(open_), "companies": [{"name": n, "guid": guid, "open": True} for n in open_]},
            "bridges": {bridge: {"at": at, "computer": "SRV9", "user": "SRV9\\" + user, "mode": "main", "open": list(open_), "tallyPort": 9000, "dataFolder": folder}}}
def setbeat(dev, info): db.sql("update tally_devices set info = %s, last_seen = now() where id = %s" % (q(json.dumps(info)), q(dev)))
def job(n, target, dev, status="waiting", taken_by=None, attempts=0):
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge, taken_by, attempts, taken_at) values (%s, %s, 'c1', %s, %s, %s, 1, %s, %s, %s, %d, %s)"
           % (q(J(n)), q(F), q(CO), q(dev), q(json.dumps({"masters": [], "vouchers": [{"id": "V%d" % n, "xml": "<VOUCHER/>"}], "ledger": ""})), q(status), q(target), q(taken_by) if taken_by else "null", attempts,
              "now()" if taken_by else "null"))
def take(dev, bridge):
    r = db.rows("select id::text, device_id::text dev, target_bridge, taken_by, status from tally_post_take_for(%s::uuid, %s, true)" % (q(dev), q(bridge)))
    return r[0] if r else None
row = lambda n: (db.rows("select device_id::text dev, target_bridge, taken_by, status from tally_post_jobs where id = %s" % q(J(n))) or [None])[0]
count = lambda dev, b: int(db.one("select tally_post_count_for(%s::uuid, %s, true)" % (q(dev), q(b))) or 0) if not RED else -1
pickable = lambda dev, b: int(db.one("select tally_post_pickable(%s::uuid, %s)" % (q(dev), q(b))) or 0) if not RED else -1
def clear(): db.sql("update tally_post_jobs set status = 'cancelled' where status in ('waiting', 'taken')")
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
                          alter role service_role bypassrls;
                          if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if; end $$;
      grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
      grant select on members to authenticated, service_role;
      insert into firms values (%(F)s, 'Made-up Firm') on conflict do nothing;
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
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'Made-up Kestrel', '{}');
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen, linked_at, book_id) values (%(F)s, %(CO)s, 'c1', %(DA)s, now(), now(), %(BK)s);
      insert into tally_books (book_id, firm_id, client_id, company) values (%(BK)s, %(F)s, 'c1', %(CO)s);
      create table if not exists auth.users (id uuid primary key, email text);""" % {"F": q(F), "O": q(OWNER), "S": q(STAFF), "DA": q(DA), "DB": q(DB), "BK": q(BK), "CO": q(CO)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;")
    setbeat(DA, beat("made-up-a", BA, [CO])); setbeat(DB, beat("made-up-b", BB, [CO]))
    db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(DA), q(BA))); db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(DB), q(BB)))
    # the link record: linked while the company was open in A's login (its key, the shared data folder)
    loc = json.loads(db.one("select tally_link_loc(%s::uuid, %s, %s)::text" % (q(DA), q(BA), q(CO))))["loc"]
    db.sql("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, device_id, computer, posting_allowed, state, data_loc, data_folder, windows_user) values (%s, %s, 'c1', %s, %s, %s, 'SRV9', true, 'linked', %s, %s, 'SRV9\\made-up-a') on conflict (firm_id, book_id) do update set data_loc = excluded.data_loc, device_id = excluded.device_id, company_guid = excluded.company_guid, posting_allowed = true, state = 'linked', client_id = 'c1'"
           % (q(F), q(BK), q(GUID), q(CO), q(DA), q(loc), q(FOLDER)))

    PRE = {x["n"]: x["m"] for x in db.rows("select proname n, md5(prosrc) m from pg_proc where pronamespace = 'public'::regnamespace and proname in ('tally_post_take_for', 'tally_post_enqueue_to')")}
    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_142: not run)" % n); continue
        r = psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    if not RED:
        priv = lambda role, sig: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(sig)))
        # the read-back values for staging (docs/MIGRATION-ORDER.md 142): md5(prosrc), security definer, who may execute
        for rr in db.rows("select p.proname n, md5(p.prosrc) m, p.prosecdef::text d, has_function_privilege('authenticated', p.oid, 'execute')::text a, has_function_privilege('anon', p.oid, 'execute')::text x from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[%s]) order by 1" % ",".join(q(f) for f in list(FNS) + ["tally_post_enqueue_to", "tally_post_any_bridge"])):
            print("  read-back %(n)s md5(prosrc)=%(m)s definer=%(d)s authenticated=%(a)s anon=%(x)s" % rr)
        ok(all(priv("authenticated", "public.%s%s" % (f, s)) == "false" and priv("anon", "public.%s%s" % (f, s)) == "false" for f, s in FNS.items()), "the new and replaced internal functions: not for anon or authenticated")

    print("== 1. open only in B's Tally: B takes A's waiting posting")
    setbeat(DA, beat("made-up-a", BA, []))           # A's Tally: the company closed
    job(1, BA, DA)
    ok(pickable(DB, BB) == 1 and pickable(DA, BA) == 0, "tally_post_pickable: 1 for B, 0 for A (%s, %s)" % (pickable(DB, BB), pickable(DA, BA)))
    ok(count(DB, BB) == 1 and count(DA, BA) == 0, "the beat's count: B told 1, A (online, the company closed) told 0 (%s, %s)" % (count(DB, BB), count(DA, BA)))
    t = take(DB, BB)
    ok(t is not None and t["id"] == J(1) and t["dev"] == DB and t["target_bridge"] == BB and t["taken_by"] == BB and t["status"] == "taken", "B takes it; the posting is B's now (%s)" % t)
    ok(take(DA, BA) is None and take(DB, BB) is None, "after: A takes nothing, B nothing more")
    clear()

    print("== 2. a posting taken by A stays with A")
    setbeat(DA, beat("made-up-a", BA, []))
    job(2, BA, DA, status="taken", taken_by=BA)
    ok(take(DB, BB) is None and row(2)["taken_by"] == BA and row(2)["dev"] == DA, "taken by A: never handed to B (%s)" % row(2))
    db.sql("update tally_post_jobs set status = 'waiting', attempts = 1 where id = %s" % q(J(2)))      # a Retry after A took it once
    ok(take(DB, BB) is None and row(2)["dev"] == DA and pickable(DB, BB) in (0, -1), "waiting again after a Retry (taken by A before): still A's (%s)" % row(2))
    clear()

    print("== 3. A has it open: A's own posting is A's")
    setbeat(DA, beat("made-up-a", BA, [CO]))
    job(3, BA, DA)
    ok(take(DB, BB) is None and row(3)["status"] == "waiting", "B takes nothing while A has it open")
    t = take(DA, BA); ok(t is not None and t["id"] == J(3) and t["taken_by"] == BA, "A takes its own (%s)" % t)
    clear()

    print("== 4. freshness and the GUID")
    setbeat(DA, beat("made-up-a", BA, [])); setbeat(DB, beat("made-up-b", BB, [CO], ago=5))
    job(4, BA, DA)
    ok(take(DB, BB) is None, "B heard 5 minutes ago: does not serve, takes nothing")
    setbeat(DB, beat("made-up-b", BB, [CO], guid="ffffffff-0000-0000-0000-000000000142"))
    ok(take(DB, BB) is None, "B has a company of the same name under another GUID: takes nothing")
    clear()

    print("== 5. another data folder (a copy)")
    setbeat(DB, beat("made-up-b", BB, [CO], folder="D:\\Copy\\Data"))
    job(5, BA, DA)
    ok(take(DB, BB) is None and row(5)["status"] == "waiting", "B reads the company from another folder: takes nothing")
    clear()

    print("== 6. a new posting goes to a bridge with the company open")
    pay = q(json.dumps({"vouchers": [{"id": "V60", "xml": "<VOUCHER/>"}]}))
    enq = lambda n, uid=STAFF: rpc(uid, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(J(n)), pay.replace("V60", "V%d" % n)))
    setbeat(DA, beat("made-up-a", BA, [])); setbeat(DB, beat("made-up-b", BB, [CO]))
    r = enq(60); ok(r.get("ok") is True and row(60) and row(60)["target_bridge"] == BB and row(60)["dev"] == DB, "open only in B: queued for B (%s / %s)" % (r.get("error") or r.get("_error") or r, row(60)))
    clear()
    setbeat(DA, beat("made-up-a", BA, [CO]))
    r = enq(61); ok(r.get("ok") is True and row(61) and row(61)["target_bridge"] == BA, "open in A and B: the link's key (A) first (%s / %s)" % (r.get("error") or r.get("_error") or r, row(61)))
    clear()
    setbeat(DA, beat("made-up-a", BA, [])); setbeat(DB, beat("made-up-b", BB, []))
    r = enq(62); ok(r.get("ok") is False and ("Open " + CO + " in Tally") in str(r.get("error")) and row(62) is None, "open nowhere: plain words, nothing queued (%s)" % (r.get("error") or r.get("_error") or r))
    setbeat(DB, beat("made-up-b", BB, [CO], folder="D:\\Copy\\Data"))
    r = enq(63); ok(r.get("ok") is False and row(63) is None, "open only in a copy in another folder (B): not queued there (%s / %s)" % (r.get("error") or r.get("_error") or r, row(63)))
    clear()

    print("== 7. the beat's count: a bridge whose Tally lacks the company is not told, and not handed it")
    setbeat(DA, beat("made-up-a", BA, [])); setbeat(DB, beat("made-up-b", BB, []))
    job(70, BA, DA)
    ok(count(DA, BA) == 0 and take(DA, BA) is None and row(70)["status"] == "waiting", "A online, the company closed: told 0, handed nothing, the posting waits (%s)" % row(70))
    ok(count(DB, BB) == 0 and take(DB, BB) is None, "B (closed too): told 0, nothing")
    setbeat(DA, beat("made-up-a", BA, [CO]))
    ok(count(DA, BA) == 1, "A opens the company: told 1 (%s)" % count(DA, BA))
    t = take(DA, BA); ok(t is not None and t["id"] == J(70) and t["taken_by"] == BA, "A takes it (%s)" % t)
    clear()
    setbeat(DA, beat("made-up-a", BA, [])); job(71, BA, DA); setbeat(DB, beat("made-up-b", BB, [CO]))
    ok(count(DA, BA) == 0 and count(DB, BB) == 1, "A closed, B open: A told 0, B told 1 (%s, %s)" % (count(DA, BA), count(DB, BB)))
    t = take(DB, BB); ok(t is not None and t["id"] == J(71) and t["dev"] == DB and t["taken_by"] == BB, "B takes it (%s)" % t)
    ok(count(DA, BA) == 0 and count(DB, BB) == 0, "after: nobody is told of it again")

    print("== 8. the page's check, and the note")
    if not RED:
        ok(rpc(STAFF, "select tally_post_any_bridge()::text") == True, "a member: tally_post_any_bridge() is true")
        good, out = as_role("anon", None, "select tally_post_any_bridge()::text"); ok(not good and "permission denied" in out, "anon: refused (%s)" % out.strip()[-80:])
    # the staff member's own linked bridge (A), heard 10 minutes ago; nobody has the company open: queued for A, with the note
    db.sql("insert into tally_member_bridges (firm_id, user_id, device_id, bridge_id) values (%s, %s, %s, %s) on conflict (firm_id, user_id) do update set device_id = excluded.device_id, bridge_id = excluded.bridge_id" % (q(F), q(STAFF), q(DA), q(BA)))
    setbeat(DA, beat("made-up-a", BA, [], ago=10)); setbeat(DB, beat("made-up-b", BB, []))
    r = enq(80); msg = db.one("select message from tally_post_jobs where id = %s" % q(J(80))) or ""
    ok(r.get("ok") is True and msg.startswith("Queued: waits for the Tally that has " + CO + " open.") and "your FinCom Bridge" not in msg and "made-up-a" not in msg and "SRV9" not in msg,
       "the note names the company's Tally (%s / %s)" % (r.get("error") or r.get("_error") or "ok", msg))
    # ROLLBACK_142=<file>: the staging rollback (not a migration) puts back 54's take_for and 116's enqueue_to, and the
    # page's check says no
    rb = os.environ.get("ROLLBACK_142")
    if rb and not RED:
        print("== 9. the rollback (%s)" % os.path.basename(rb))
        r = psql_text(open(rb).read()); ok(r.returncode == 0, "it runs %s" % (r.stderr or "").strip()[-300:])
        post = {x["n"]: x["m"] for x in db.rows("select proname n, md5(prosrc) m from pg_proc where pronamespace = 'public'::regnamespace and proname in ('tally_post_take_for', 'tally_post_enqueue_to')")}
        ok(post == PRE, "take_for and enqueue_to: the texts before 142 again (%s)" % post)
        ok(rpc(STAFF, "select tally_post_any_bridge()::text") == False, "the page's check now says no")
        ok(db.one("select has_function_privilege('service_role', 'public.tally_post_take_for(uuid,text,boolean)', 'execute')::text") == "true" and
           db.one("select has_function_privilege('authenticated', 'public.tally_post_take_for(uuid,text,boolean)', 'execute')::text") == "false", "take_for: service_role only, as before")
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
