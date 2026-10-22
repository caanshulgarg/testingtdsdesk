"""python3 run_migration101.py - migration-101-autopost (23-Oct-2026, branch next-autopost; NOT run on staging) on a throwaway
PostgreSQL (pg_stand, port 31010 unless PG101_PORT; never a real database), with staging's clients, members and
sync_refused, and its two guards on clients (clients_keep_keys, sync_guard) made as on staging:
  0. the file: one transaction, lock_timeout 10 s; add-only (nothing dropped but the policies and trigger it makes again,
     no "delete from", no truncate, no table altered but to turn row-level security on); names no real database; md5
  1. runs, and runs a second time
  2. grants are explicit: a member (authenticated) reads claims and the log, calls autopost_claim / autopost_mark, writes
     no table directly; anon nothing; the service role everything
  3. row-level security: a member reads only the firm's claims and log
  4. the rights (the guard on clients): staff cannot switch it on, raise a limit, remove the daily limit, widen the
     amounts, shorten the hold or change the rights (the old setting is kept, the attempt logged and in sync_refused);
     staff can switch it off and tighten; the owner can do everything; a new client sent by staff with it on is kept
     off; every change is in the log with who and when; a write of the server's own (no person) passes
  5. the claim: off → nothing; each entry once (a second run, a second browser at the same moment: refused); the limit
     per entry; the daily total for the client by India's date (across runs; yesterday's not counted); a claim not
     finished within its lease taken again, one posted / queued / undone never; bank or bills switched off refused
  6. autopost_mark: queued, posted, failed, released; undone only as "who may undo" allows; a look-only member nothing
RED_WITHOUT_101=1: the same checks without running the file (1 to 6 fail)."""
import os, re, sys, json, hashlib, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "security", "migration-101-autopost.sql")
RED = os.environ.get("RED_WITHOUT_101") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
drops = re.findall(r"\bdrop\s+(\w+)", code)
ok(all(d in ("policy", "trigger") for d in drops) and "delete from" not in code and "truncate" not in code
   and not re.search(r"\balter\s+table\b(?!\s+public\.autopost_\w+\s+enable row level security)", code), "add-only (drops only of the policies and trigger it makes again: %s)" % sorted(set(drops)))
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")

STAND = r"""
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to authenticated, service_role;
grant select on members to authenticated, service_role;
create table if not exists public.clients (id text not null, firm_id uuid not null, name text, gstin text, pan text, tally_name text, data jsonb, updated_at timestamptz default now(), updated_by uuid,
  deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid, delete_reason text, restored_at timestamptz, restored_by uuid, primary key (firm_id, id));
alter table public.clients enable row level security;
create policy clients_rw on public.clients for all to authenticated using (firm_id = my_firm()) with check (firm_id = my_firm());
grant select, insert, update on public.clients to authenticated;
grant all on public.clients to service_role;
create table if not exists public.sync_refused (id bigserial primary key, at timestamptz not null default now(), firm_id uuid, user_id uuid, tbl text not null, kind text, row_id text not null, what text not null);
-- the two guards staging runs on clients before this one (migrations 19 and 30), as there
create or replace function public.clients_keep_keys() returns trigger language plpgsql set search_path to 'public' as $f$
begin if jsonb_typeof(old.data) = 'object' and jsonb_typeof(new.data) = 'object' and old.data is distinct from new.data then new.data := old.data || new.data; end if; return new; end $f$;
create trigger clients_keep_keys before update on public.clients for each row execute function public.clients_keep_keys();
create or replace function public.sync_guard_clients() returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin if old.data is not null and (new.data is null or new.data = '{}'::jsonb) then new.data := old.data; end if; return new; end $f$;
create trigger sync_guard before update on public.clients for each row execute function public.sync_guard_clients();
"""
F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
OWN, STAFF, LOOK, OWN2 = "aaaaaaaa-0000-0000-0000-00000000000a", "bbbbbbbb-0000-0000-0000-00000000000b", "cccccccc-0000-0000-0000-00000000000c", "dddddddd-0000-0000-0000-00000000000d"
db = pg_stand.start(int(os.environ.get("PG101_PORT") or 31010))
def err(s, uid=None):
    try: db.sql(s, uid); return ""
    except RuntimeError as e: return str(e)
def one(s, uid=None):
    try: return db.one(s, uid)
    except RuntimeError as e: return "ERROR " + str(e)[:300]
AS = lambda role: "set role %s; " % role
I = lambda v: int(v) if str(v or "").isdigit() else -1
def setting(cid, uid, v):
    """a member saves the client with this setting, as the app does (a PATCH of data)"""
    return err(AS("authenticated") + "update public.clients set data = jsonb_set(coalesce(data, '{}'), '{choices}', coalesce(data->'choices', '{}') || jsonb_build_object('autopost', jsonb_build_object('value', '%s'::jsonb, 'state', 'confirmed'))) where id = '%s'" % (json.dumps(v), cid), uid)
def cur(cid):
    r = one("select coalesce(data #> '{choices,autopost,value}', 'null')::text from public.clients where id = '%s'" % cid)
    try: return json.loads(r or "null")
    except Exception: return None
def claimj(cid, run, items, uid=STAFF):
    r = one(AS("authenticated") + "select public.autopost_claim('%s', '%s', '%s'::jsonb)::text" % (cid, run, json.dumps(items)), uid)
    try: return json.loads(r)
    except Exception: return {"error": r}
def markj(cid, run, ids, st, uid=STAFF):
    r = one(AS("authenticated") + "select public.autopost_mark('%s', '%s', array[%s]::text[], '%s', null)::text" % (cid, run, ",".join("'%s'" % i for i in ids), st), uid)
    try: return json.loads(r)
    except Exception: return {"error": r}
R = ["%08d-0000-4000-8000-000000000000" % i for i in range(1, 20)]
try:
    db.sql(STAND + "insert into firms values ('%s', 'A'), ('%s', 'B'); insert into members (user_id, firm_id, role) values ('%s', '%s', 'owner'), ('%s', '%s', 'staff'), ('%s', '%s', 'readonly'), ('%s', '%s', 'owner');"
           % (F1, F2, OWN, F1, STAFF, F1, LOOK, F1, OWN2, F2))
    db.sql("insert into public.clients (id, firm_id, name, data) values ('c-aad', '%s', 'Testing AAD', '{\"name\":\"Testing AAD\",\"choices\":{}}'), ('c-leads', '%s', 'Leads', '{\"name\":\"Leads\"}'), ('c-b', '%s', 'Other firm', '{}')" % (F1, F1, F2))
    print("== 1. runs twice")
    if not RED:
        e1 = err(text); e2 = err(text)
        ok(not e1 and not e2, "the file runs, and runs again" + (": " + (e1 or e2)[:300] if e1 or e2 else ""))
    ok(one("select count(*) from information_schema.tables where table_name in ('autopost_claims', 'autopost_log')") == "2", "the two tables")
    trig = one("select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.clients'::regclass and not tgisinternal")
    ok(trig == "clients_keep_keys,sync_guard,sync_guard_autopost", "the guard runs after clients_keep_keys and sync_guard (names in order): %s" % trig)
    print("== 2. grants")
    priv = lambda role, t: one("select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t)) or ""
    ok(priv("authenticated", "autopost_claims") == "SELECT" and priv("authenticated", "autopost_log") == "SELECT", "a member: read only (%s / %s)" % (priv("authenticated", "autopost_claims"), priv("authenticated", "autopost_log")))
    ok(priv("anon", "autopost_claims") in ("", None) and priv("anon", "autopost_log") in ("", None), "anon: nothing on the tables")
    ok(all(p in priv("service_role", "autopost_claims") for p in ("DELETE", "INSERT", "SELECT", "UPDATE")), "the service role: everything")
    fx = lambda role, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (role, f))
    ok(fx("authenticated", "public.autopost_claim(text, uuid, jsonb)") == "true" and fx("anon", "public.autopost_claim(text, uuid, jsonb)") == "false"
       and fx("authenticated", "public.autopost_mark(text, uuid, text[], text, uuid)") == "true" and fx("anon", "public.autopost_mark(text, uuid, text[], text, uuid)") == "false", "claim and mark: members, not anon")
    ok(fx("authenticated", "public.sync_guard_autopost()") == "false", "the guard is not callable")
    ok("permission denied" in err(AS("authenticated") + "insert into public.autopost_claims (firm_id, client_id, entry_id, run_id, kind, day) values ('%s', 'c-aad', 'x', '%s', 'bank', current_date)" % (F1, R[0]), STAFF)
       and "permission denied" in err(AS("authenticated") + "update public.autopost_claims set status = 'posted'", STAFF), "a member cannot write a claim directly")
    print("== 4. the rights")
    setting("c-aad", STAFF, {"on": True})
    ok(cur("c-aad") is None, "staff cannot switch it on: the setting stays off")
    ok(one("select count(*) from public.autopost_log where refused and by_user = '%s' and what like '%%switch it on%%'" % STAFF) == "1"
       and one("select count(*) from public.sync_refused where kind = 'autopost' and user_id = '%s'" % STAFF) == "1", "the attempt is in the log and in sync_refused")
    setting("c-aad", OWN, {"on": True, "perEntry": 50000, "perDay": 500000, "holdMin": 15})
    ok((cur("c-aad") or {}).get("on") is True, "the owner switches it on")
    base = {"on": True, "perEntry": 50000, "perDay": 500000, "holdMin": 15}
    for v, what in [(dict(base, perEntry=100000), "raise the limit per entry"), (dict(base, perDay=None), "remove the daily limit"), (dict(base, bankAmounts="within"), "allow any amount within the limit"),
                    (dict(base, holdMin=0), "shorten the hold"), (dict(base, whoOn="anyone"), "change who may change it"), (dict(base, billsNoGstin=True), "add suppliers without a GSTIN")]:
        setting("c-aad", STAFF, v)
        c = cur("c-aad") or {}
        ok(c.get("perEntry") == 50000 and c.get("perDay") == 500000 and c.get("holdMin") == 15 and c.get("bankAmounts", "exact") == "exact" and c.get("whoOn", "owner") == "owner" and not c.get("billsNoGstin"), "staff cannot " + what + ": kept")
    setting("c-aad", STAFF, {"on": True, "perEntry": 20000, "perDay": 100000, "holdMin": 30})
    c = cur("c-aad") or {}
    ok(c.get("perEntry") == 20000 and c.get("perDay") == 100000 and c.get("holdMin") == 30, "staff can tighten (a lower limit, a longer hold)")
    setting("c-aad", STAFF, {"on": False, "perEntry": 20000, "perDay": 100000, "holdMin": 30})
    ok((cur("c-aad") or {}).get("on") is False, "staff can always switch it off")
    setting("c-aad", OWN, {"on": True, "perEntry": 50000, "perDay": 1000, "holdMin": 0})
    ok((cur("c-aad") or {}).get("on") is True and (cur("c-aad") or {}).get("holdMin") == 0, "the owner switches it on again, with “Post at once” (hold 0)")
    e = err(AS("authenticated") + "insert into public.clients (id, firm_id, name, data) values ('c-new', '%s', 'New', '{\"choices\":{\"autopost\":{\"value\":{\"on\":true}}}}')" % F1, STAFF)
    ok(not e and cur("c-new") is None, "a new client sent by staff with it switched on is kept off" + (": " + e[:200] if e else ""))
    e = err(AS("authenticated") + "update public.clients set data = data || '{\"note\":\"x\"}' where id = 'c-aad'", STAFF)
    ok(not e and (cur("c-aad") or {}).get("on") is True, "a save of another setting by staff leaves it as it is")
    err("update public.clients set data = jsonb_set(data, '{choices}', '{\"autopost\":{\"value\":{\"on\":true,\"perEntry\":75000}}}') where id = 'c-leads'")
    ok((cur("c-leads") or {}).get("perEntry") == 75000, "a write of the server's own (no person signed in) passes")
    nlog = I(one("select count(*) from public.autopost_log where firm_id = '%s' and client_id = 'c-aad'" % F1))
    ok(nlog >= 10 and I(one("select count(*) from public.autopost_log where not refused and by_role = 'owner'")) >= 2 and one("select count(*) from public.autopost_log where at is null or (by_user is null and client_id = 'c-aad')") == "0",
       "every change is logged, with who, their role and when (%d rows for Testing AAD)" % nlog)
    print("== 3. row-level security")
    ok(one(AS("authenticated") + "select count(*) from public.autopost_log", OWN2) == "0" and I(one(AS("authenticated") + "select count(*) from public.autopost_log", STAFF) or 0) > 0, "a member reads only the firm's log")
    print("== 5. the claim")
    setting("c-aad", OWN, {"on": True, "perEntry": 50000, "perDay": 1000, "holdMin": 0})
    a = claimj("c-aad", R[1], [{"id": "bank:fp1", "kind": "bank", "amount": 600, "rule": "B1"}, {"id": "bank:fp2", "kind": "bank", "amount": 600, "rule": "B1"}, {"id": "bill:e1", "kind": "bill", "amount": 60000, "rule": "P1"}])
    ok(a.get("ok") and a.get("taken") == ["bank:fp1"] and {x["id"]: x["why"] for x in a.get("refused", [])} == {"bank:fp2": "daily limit", "bill:e1": "over the limit per entry"},
       "the limit per entry and the daily total (₹1,000): one taken, one over the day, one over the entry: %s" % a)
    b2 = claimj("c-aad", R[2], [{"id": "bank:fp1", "kind": "bank", "amount": 600}, {"id": "bank:fp3", "kind": "bank", "amount": 300}], OWN)
    ok(b2.get("taken") == ["bank:fp3"] and (b2.get("refused") or [{}])[0].get("why", "").startswith("already taken"), "a second run (another browser) never takes an entry already taken; the day's total counts across runs: %s" % b2)
    ok((claimj("c-aad", R[3], [{"id": "bank:fp4", "kind": "bank", "amount": 200}]).get("refused") or [{}])[0].get("why") == "daily limit", "₹900 used of ₹1,000: ₹200 more is refused")
    err("insert into public.autopost_claims (firm_id, client_id, entry_id, run_id, kind, amount, day, status) values ('%s', 'c-aad', 'bank:old', '%s', 'bank', 900, ((now() at time zone 'Asia/Kolkata')::date - 1), 'posted')" % (F1, R[4]))
    ok(claimj("c-aad", R[3], [{"id": "bank:fp5", "kind": "bank", "amount": 100}]).get("taken") == ["bank:fp5"], "yesterday's (IST) postings do not count against today")
    ok(one("select string_agg(distinct day::text, ',') from public.autopost_claims where entry_id = 'bank:fp5'") == one("select ((now() at time zone 'Asia/Kolkata')::date)::text"), "the day is India's date")
    # two browsers at the same moment: one claim each, at once, for the same entries
    setting("c-aad", OWN, {"on": True, "perEntry": 50000, "perDay": None, "holdMin": 0})
    items = [{"id": "bank:race%d" % i, "kind": "bank", "amount": 10} for i in range(30)]
    outs = [None, None]
    def go(i): outs[i] = claimj("c-aad", R[10 + i], items, STAFF if i == 0 else OWN)
    ts = [threading.Thread(target=go, args=(i,)) for i in range(2)]
    [t.start() for t in ts]; [t.join() for t in ts]
    t0, t1 = set((outs[0] or {}).get("taken", [])), set((outs[1] or {}).get("taken", []))
    ok(len(t0) + len(t1) == 30 and not (t0 & t1) and one("select count(*) from public.autopost_claims where entry_id like 'bank:race%'") == "30", "two browsers claiming the same 30 entries at once: each entry to one only (%d + %d)" % (len(t0), len(t1)))
    # the lease: a claim not finished in 10 minutes may be taken again; a posted one never
    err("update public.autopost_claims set lease_until = now() - interval '1 second' where entry_id = 'bank:fp3'")
    ok(claimj("c-aad", R[5], [{"id": "bank:fp3", "kind": "bank", "amount": 300}]).get("taken") == ["bank:fp3"], "a claim whose lease ran out (the browser closed) is taken again")
    ok(markj("c-aad", R[1], ["bank:fp1"], "posted").get("n") == 1, "mark: posted")
    err("update public.autopost_claims set lease_until = now() - interval '1 second' where entry_id = 'bank:fp1'")
    ok("already taken (posted)" in json.dumps(claimj("c-aad", R[6], [{"id": "bank:fp1", "kind": "bank", "amount": 600}])), "a posted entry is never taken again")
    ok(markj("c-aad", R[5], ["bank:fp3"], "queued").get("n") == 1 and "already taken (queued)" in json.dumps(claimj("c-aad", R[7], [{"id": "bank:fp3", "kind": "bank", "amount": 300}])), "a queued entry (Tally closed) is not taken again either")
    ok(markj("c-aad", R[3], ["bank:fp5"], "failed").get("n") == 1 and claimj("c-aad", R[8], [{"id": "bank:fp5", "kind": "bank", "amount": 100}]).get("taken") == ["bank:fp5"], "a failed one may be tried again (Retry)")
    setting("c-aad", STAFF, {"on": True, "perEntry": 50000, "perDay": None, "holdMin": 0, "bills": False})
    ok("switched off for bill" in json.dumps(claimj("c-aad", R[9], [{"id": "bill:e9", "kind": "bill", "amount": 100}])), "bills switched off (by staff: a tightening): refused")
    setting("c-aad", STAFF, {"on": False, "perEntry": 50000, "perDay": None, "holdMin": 0, "bills": False})
    ok("off for this client" in json.dumps(claimj("c-aad", R[9], [{"id": "bank:z", "kind": "bank", "amount": 1}])), "switched off: nothing is taken")
    ok("Only the owner or staff" in json.dumps(claimj("c-aad", R[9], [{"id": "bank:z", "kind": "bank", "amount": 1}], LOOK)), "a look-only member cannot claim")
    ok("No such client" in json.dumps(claimj("c-b", R[9], [{"id": "bank:z", "kind": "bank", "amount": 1}])), "nor for another firm's client")
    print("== 6. autopost_mark: undo")
    setting("c-aad", OWN, {"on": True, "perEntry": 50000, "perDay": None, "holdMin": 0, "whoUndo": "owner"})
    ok("Only the owner may undo" in json.dumps(markj("c-aad", R[1], ["bank:fp1"], "undone", STAFF)), "with “the owner only”, staff cannot undo")
    ok(markj("c-aad", R[1], ["bank:fp1"], "undone", OWN).get("n") == 1 and "already taken (undone)" in json.dumps(claimj("c-aad", R[11], [{"id": "bank:fp1", "kind": "bank", "amount": 600}], OWN)), "the owner undoes; an undone entry is never taken by itself again")
    ok("Only the owner or staff" in json.dumps(markj("c-aad", R[1], ["bank:fp1"], "posted", LOOK)), "a look-only member marks nothing")
    ok(one(AS("authenticated") + "select count(*) from public.autopost_claims", OWN2) == "0" and I(one(AS("authenticated") + "select count(*) from public.autopost_claims", STAFF) or 0) > 0, "a member reads only the firm's claims")
finally:
    db.stop()
print("\n%d FAILED" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
