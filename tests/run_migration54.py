"""python3 run_migration54.py - migration-54-post-target-bridge (FinCom Bridge 2.3.0: one bridge for each Windows user on a shared
Windows server; each user's bridge is its own computer key, tally_devices row and info.bridges entry). On throwaway PostgreSQL
(pg_stand, port 30540; never a real database), built 32 -> ... -> 53 in staging's order, then 54 (twice). Checks:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), no 'delete from' anywhere, add-only, no real
     database named; it runs twice; nothing deleted.
  1. tally_post_jobs.target_bridge (text, nullable); older postings keep null.
  2. tally_bridge_prefs.changes_only, an owner's switch per bridge (tally_bridge_changes_only): staff refused, a bridge FinCom
     has not heard from refused.
  3. tally_member_bridges, an owner's link member <-> bridge (tally_member_bridge_link): staff refused; unlinking keeps the row
     (bridge null), nothing deleted.
  4. tally_post_enqueue_to(p_id, p_client, p_payload, p_target): no target -> the poster's own linked bridge (its computer);
     no link -> null (the computer's main bridge, as today); an owner may pick another linked bridge; staff may not; a
     changes-only bridge, or one that only reads, is never a target (own link changes-only: null); an unknown bridge refused; 53's rules (postTo, an id
     queued twice) unchanged; the 3-argument tally_post_enqueue unchanged (target null).
  5. tally_post_take_for(p_device, p_bridge, p_main): a bridge takes only postings for it, and those with no target only when
     it is the computer's main bridge; a changes-only bridge takes none; granted to the service role only (nobody here).
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql")]
M54 = os.environ.get("M54_FILE") or os.path.join(SQLDIR, "migration-54-post-target-bridge.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER, STAFF, STAFF2 = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777"
STAFF3 = "33333333-3333-3333-3333-333333333333"   # Durgesh: his bridge runs on an old shared computer key (1.15.0's settings carried over)
D1, D2, D3 = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002", "d3000000-0000-0000-0000-000000000003"
B1, B2, B3, B4 = "go-aaaa000001", "go-bbbb000002", "go-cccc000003", "go-dddd000004"   # anshul's, ravi's, meena's (all NW144), a test bridge on D1
F2, O2, D9 = "88888888-8888-8888-8888-888888888888", "44444444-4444-4444-4444-444444444444", "d9000000-0000-0000-0000-000000000009"   # review M-A: another firm
J = lambda n: "%08d-0000-0000-0000-000000005454" % n
def vch(i): return {"id": i, "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:%s</NARRATION></VOUCHER>" % i}

text = open(M54).read() if os.path.exists(M54) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M54))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok("delete from" not in low, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", low) and not re.search(r"\btruncate\b", low), "0. add-only (no drop, no truncate)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low), "0. names no real database")

db = pg_stand.start(30540)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def as_user(uid, stmt):
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def rpcj(uid, stmt):
    good, out = as_user(uid, stmt)
    if not good: return {"_error": out[-300:]}
    try: return json.loads(out)
    except (TypeError, ValueError): return {"_error": out}
def svc(stmt):
    try: return json.loads(db.one(stmt))
    except RuntimeError as e: return {"_error": str(e)[-400:], "ok": False}
DEV_OF = {}   # bridge -> its computer, as the Tally page passes it (review M3: the device is passed and checked)
def enq(uid, n, target=None, ids=None, client="c1", device=None):
    d = None if device == "none" else device if device is not None else DEV_OF.get(target)
    return rpcj(uid, "select tally_post_enqueue_to(%s::uuid, %s, %s::jsonb, %s, %s)::text" % (q(J(n)), q(client), q(json.dumps({"vouchers": [vch(i) for i in (ids or ["V%d" % n])]})),
                "null" if target is None else q(target), "null" if d is None else q(d) + "::uuid"))
def jrow(n): return (db.rows("select coalesce(target_bridge, 'null') as t, device_id::text as d, status from tally_post_jobs where id = %s" % q(J(n))) or [{}])[0]
def take(dev, br, main): return [r["id"] for r in db.rows("select id::text from tally_post_take_for(%s::uuid, %s, %s)" % (q(dev), q(br), "true" if main else "false"))]
def counts(): return {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_post_jobs", "tally_devices", "members", "tally_post_ids"]}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    NOW = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    DUP = "go-d0d0d0d0d0"   # an id reported by two computers before 54 (copied settings): bound to neither, said in a NOTICE
    def br(*ids, dup=False):
        b = {i: {"at": NOW, "computer": "NW144", "user": u, "mode": "main", "open": ["ZZ CO"]} for i, u in ids}
        if dup: b[DUP] = {"at": NOW, "computer": "NW144", "user": "copied", "mode": "test", "open": []}
        return q(json.dumps({"bridges": b}))
    DEV_OF.update({B1: D1, B4: D1, B2: D2, B3: D3, "go-ffff00000f": D1})
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Ravi', 'staff', true), (%(S2)s, %(F)s, 'Meena', 'staff', true), (%(S3)s, %(F)s, 'Durgesh', 'staff', true);
      create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
      -- each Windows user's computer key, made by that member's FinCom page (tally_device_create keeps created_by)
      insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%(D1)s, %(F)s, 'NW144 · anshul', 'h1', '2.3.0', %(I1)s, %(O)s), (%(D2)s, %(F)s, 'NW144 · ravi', 'h2', '2.3.0', %(I2)s, %(S)s),
        (%(D3)s, %(F)s, 'NW144 · meena', 'h3', '2.3.0', %(I3)s, %(S2)s);
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"postTo": "ZZ CO"}'), ('c9', '88888888-8888-8888-8888-888888888888', 'YY', '{"postTo": "YY CO"}');""" % {"F": q(F), "O": q(OWNER), "S": q(STAFF), "S2": q(STAFF2), "S3": q(STAFF3), "D1": q(D1), "D2": q(D2), "D3": q(D3),
        "I1": br((B1, "anshul"), (B4, "anshul"), dup=True), "I2": br((B2, "ravi"), dup=True), "I3": br((B3, "meena"))})
    # staging's computer and bridge (Fix 2a: bound to it by the migration)
    db.sql("insert into firms values ('22222222-2222-2222-2222-222222222222', 'Staging firm') on conflict do nothing")
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version, info) values ('58d73e82-57f3-4f72-9f3d-14cc93a5b2b1', '22222222-2222-2222-2222-222222222222', 'Office computer', 'hs', '2.2.3', %s)"
           % (q(json.dumps({"bridges": {"go-6b1ba45fbb1d": {"at": NOW, "computer": "OFFICE", "user": "tally", "mode": "main", "open": []}}}))))
    # review M-A: another firm's computer reporting anshul's bridge id B1 (a cloned Windows profile): bound per firm
    db.sql("""insert into firms values (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O2)s, %(F2)s, 'Priya', 'owner', true);
      insert into tally_devices (id, firm_id, name, key_hash, version, info) values (%(D9)s, %(F2)s, 'OTHERPC · priya', 'h9', '2.3.0', %(I9)s);""" % {"F2": q(F2), "O2": q(O2), "D9": q(D9),
        "I9": q(json.dumps({"bridges": {B1: {"at": NOW, "computer": "OTHERPC", "user": "priya", "mode": "main", "open": ["YY CO"]}}}))})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""create table if not exists tally_companies (firm_id uuid, company text, client_id text, device_id uuid, last_seen timestamptz, book_id uuid, gstin text, linked_at timestamptz);
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen) values (%s, 'ZZ CO', 'c1', %s, now()), (%s, 'YY CO', 'c9', %s, now());""" % (q(F), q(D1), q(F2), q(D9)))
    # an older posting, queued before 54
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, '{\"vouchers\": []}', 0, 'waiting')" % (q(J(1)), q(F), q(D1)))
    before = counts()
    for rnd in (1, 2):
        r = psql_text(text)
        if rnd == 1: notice1 = r.stderr or ""
        ok(r.returncode == 0, "0. pass %d: migration 54 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
        ok(counts() == before, "0. pass %d: nothing deleted, nothing added (%s)" % (rnd, counts()))
    # Fix 2a: every id reported today bound to its computer; an id under two computers bound to none, named in a NOTICE
    live = lambda b, f=None: db.one("select coalesce(string_agg(device_id::text, ','), '-') from tally_bridge_ids where bridge_id = %s and reset_at is null%s" % (q(b), "" if f is None else " and firm_id = " + q(f)))
    ok(live("go-6b1ba45fbb1d") == "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1", "Fix 2a. staging's go-6b1ba45fbb1d is bound to 58d73e82 (Office computer)")
    ok(live(B1, F) == D1 and live(B2) == D2 and live(B3) == D3 and live(B4) == D1, "Fix 2a. every other id bound to the computer that reports it")
    ok(live(DUP) == "-" and DUP in notice1 and "NOTICE" in notice1, "Fix 2a. %s (under two computers) bound to none, and named in a NOTICE for the owner (%s)" % (DUP, notice1.strip()[-300:]))
    ok(live(B1, F2) == D9, "M-A. the same id under another firm's computer (a cloned Windows profile): bound to that computer within its own firm too (%s)" % live(B1, F2))
    ok(B1 not in notice1, "M-A. an id under computers of two different firms is no NOTICE (%s)" % notice1.strip()[-300:])
    ok(db.one("select count(*) from tally_bridge_ids") == "6", "Fix 2a. the second run binds nothing more (6)")
    # 1. the column
    col = db.rows("select data_type, is_nullable from information_schema.columns where table_name = 'tally_post_jobs' and column_name = 'target_bridge'")
    ok(col == [{"data_type": "text", "is_nullable": "YES"}], "1. tally_post_jobs.target_bridge text, nullable (%s)" % col)
    ok(jrow(1)["t"] == "null", "1. the posting queued before 54 keeps no target")
    # 2. changes only: the owner's switch per bridge
    r = rpcj(STAFF, "select tally_bridge_changes_only(%s::uuid, %s, true)::text" % (q(D3), q(B3)))
    ok("_error" in r and "owner" in r["_error"], "2. staff cannot switch a bridge to changes only (%s)" % r)
    r = rpcj(OWNER, "select tally_bridge_changes_only(%s::uuid, 'go-ffff00000f', true)::text" % q(D3))
    ok("_error" in r, "2. a bridge FinCom has not heard from on that computer is refused")
    r = rpcj(OWNER, "select tally_bridge_changes_only(%s::uuid, %s, true)::text" % (q(D3), q(B3)))
    ok(r.get("ok") is True and db.one("select changes_only::text from tally_bridge_prefs where device_id = %s and bridge_id = %s" % (q(D3), q(B3))) == "true", "2. the owner switches meena's bridge to changes only (%s)" % r)
    good, out = as_user(STAFF, "select count(*) from tally_bridge_prefs")
    ok(good and out == "1", "2. members of the firm read the switches (%s)" % out)
    # 3. the link member <-> bridge
    LINK = lambda u, d, b: "select tally_member_bridge_link(%s::uuid, %s, %s)::text" % (q(u), "null" if d is None else q(d) + "::uuid", "null" if b is None else q(b))
    r = rpcj(STAFF, LINK(STAFF2, D2, B2))
    ok("_error" in r and "owner" in r["_error"], "3. staff cannot link ANOTHER member to a bridge (%s)" % r)
    r = rpcj(STAFF, LINK(STAFF, D2, B2))
    ok(r.get("ok") is True and db.one("select set_by::text from tally_member_bridges where user_id = %s" % q(STAFF)) == STAFF,
       "#4. Ravi links HIMSELF to his bridge (any member who may write; no owner needed; who is kept) (%s)" % r)
    r = rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, %s::uuid, %s)::text" % (q(STAFF), q(D2), q(B2)))
    ok(r.get("ok") is True, "3. the owner links Ravi to his bridge on NW144 (%s)" % r)
    r = rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, %s::uuid, %s)::text" % (q(STAFF2), q(D3), q(B3)))
    ok(r.get("ok") is True, "3. and Meena to hers (changes only)")
    r = rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, %s::uuid, %s)::text" % (q(STAFF2), q(D2), "'go-ffff00000f'"))
    ok("_error" in r, "3. a bridge not heard from on that computer is refused")
    r = rpcj(STAFF, LINK(STAFF, D3, B3))
    ok("_error" in r and "another member" in r["_error"], "#4. Ravi cannot link himself to Meena's bridge (it posts for another member already) (%s)" % r)
    r = rpcj(STAFF3, LINK(STAFF3, D2, "go-ffff00000f"))
    ok("_error" in r, "#4. a self-link to a bridge not heard from on that computer is refused too")
    r = rpcj(STAFF, LINK(STAFF, D1, B4))
    ok("_error" in r and "computer key you made" in r["_error"] and db.one("select coalesce(bridge_id, '-') from tally_member_bridges where user_id = %s" % q(STAFF)) == B2,
       "final M3. Ravi cannot link himself to a bridge on a computer key he did not make (anshul's B4, linked to nobody) (%s)" % str(r.get("_error", r))[-200:])
    good, out = as_user(STAFF, "select bridge_id from tally_member_bridges where user_id = %s" % q(STAFF))
    ok(good and out == B2, "3. members read the links (%s)" % out)
    # 4. queueing with a target
    r = enq(STAFF, 2)
    ok(r.get("ok") is True and r.get("target") == B2 and jrow(2) == {"t": B2, "d": D2, "status": "waiting"}, "4. Ravi posts with no target: his own bridge on NW144 (%s | %s)" % (r, jrow(2)))
    r = enq(OWNER, 3)
    ok(r.get("ok") is True and jrow(3) == {"t": B1, "d": D1, "status": "waiting"}, "#3. the owner, not linked: his OWN bridge (on the computer key he made) with ZZ CO open (%s | %s)" % (r, jrow(3)))
    r = enq(OWNER, 4, target=B2)
    ok(r.get("ok") is True and jrow(4) == {"t": B2, "d": D2, "status": "waiting"}, "4. the owner picks Ravi's bridge: queued for it, on its computer (%s)" % jrow(4))
    r = enq(STAFF, 5, target=B1)
    ok(r.get("ok") is False and "owner" in r.get("error", "") and not jrow(5), "4. Ravi cannot pick another bridge than his own (%s)" % r)
    r = enq(OWNER, 6, target=B3)
    ok(r.get("ok") is False and "changes only" in r.get("error", "") and not jrow(6), "4. a changes-only bridge is never a target (%s)" % r)
    r = enq(STAFF2, 7)
    W0 = "Nobody can post into ZZ CO from your sign-in just now: your FinCom Bridge (NW144 · meena) has it open but is set to Changes only or only reads Tally. Ask the firm's owner to switch Changes only off for it (Tally page), then post again."
    ok(r.get("ok") is False and r.get("error") == W0 and not jrow(7), "#3. Meena's own bridge is changes only: never routed into someone else's Tally; the words name the company and what to do (%s)" % r.get("error"))
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(B1), q(D1)))
    r = enq(OWNER, 12, target=B4)
    ok(r.get("ok") is False and "only reads" in r.get("error", "") and not jrow(12), "4. a bridge that only reads (another is the main one on its computer) is never a target (%s)" % r)
    r = enq(OWNER, 8, target="go-ffff00000f")
    ok(r.get("ok") is False and not jrow(8), "4. a bridge FinCom has not heard from is refused (%s)" % r)
    r = enq(OWNER, 9, target=B2, ids=["V2"])
    ok(r.get("ok") is False and "already waiting" in r.get("error", "") and not jrow(9), "4. 53's rules kept: an entry already waiting is not queued twice (%s)" % r)
    db.sql("update clients set data = '{\"postTo\": \"OTHER CO\"}' where id = 'c1'")
    r = enq(OWNER, 10, target=B2)
    ok(r.get("ok") is False and r.get("notAllowed") is True and not jrow(10), "4. the client's postTo still holds (%s)" % r.get("error"))
    db.sql("update clients set data = '{\"postTo\": \"ZZ CO\"}' where id = 'c1'")
    good, out = as_user(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J(11)), q(json.dumps({"vouchers": [vch("V11")]}))))
    ok(good and json.loads(out).get("ok") is True and jrow(11)["t"] == B1, "#3. the 3-argument tally_post_enqueue: the same rules (the owner's own bridge) (%s)" % jrow(11))
    r = enq(OWNER, 4, target=B2)
    ok(r.get("ok") is True and r.get("again") is True and jrow(4)["t"] == B2, "4. the same posting again: as before (again), its target kept (%s)" % r)
    # 5. the hand-out
    ok(take(D2, B2, False) == [J(2)], "5. Ravi's bridge (not main) takes the posting for it, the oldest first")
    ok(db.one("select coalesce(taken_by, '-') from tally_post_jobs where id = %s" % q(J(2))) == B2, "final M1. the bridge that took it is recorded (taken_by)")
    ok(take(D2, B2, False) == [J(4)] and take(D2, B2, False) == [], "5. then the owner's posting for it; nothing else")
    ok(take(D1, B4, False) == [], "5. another bridge on anshul's computer (not main) takes nothing with no target")
    ok(take(D1, B1, True) == [J(1)], "5. anshul's main bridge takes the older posting (no target), as today")
    ok(db.one("select coalesce(taken_by, '-') from tally_post_jobs where id = %s" % q(J(1))) == B1, "final M1. taken_by: the main bridge that took the posting naming none")
    col = db.rows("select column_name, data_type from information_schema.columns where table_name = 'tally_post_jobs' and column_name in ('taken_by', 'resend_only') order by 1")
    ok(col == [{"column_name": "resend_only", "data_type": "jsonb"}, {"column_name": "taken_by", "data_type": "text"}], "final M1. tally_post_jobs.taken_by (text) and resend_only (jsonb) (%s)" % col)
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge) values (%s, %s, 'c1', 'ZZ CO', %s, '{\"vouchers\": []}', 0, 'waiting', %s)" % (q(J(20)), q(F), q(D3), q(B3)))
    ok(take(D3, B3, True) == [] and jrow(20)["status"] == "waiting", "5. a changes-only bridge takes no posting, even one for it")
    ok(take(D1, B2, True) == [], "5. a bridge never takes another computer's postings")
    def privs(sig):
        try: return [db.one("select has_function_privilege(%s, %s, 'execute')" % (q(r), q("public." + sig))) for r in ("anon", "authenticated")]
        except RuntimeError as e: return ["missing: " + str(e)[-120:]]
    ok(privs("tally_post_rescue(uuid)") == ["f", "f"], "M-B. tally_post_rescue: not for anon nor members (the service role only)")
    ok(privs("tally_post_take_for(uuid, text, boolean)") == ["f", "f"], "5. tally_post_take_for: not for anon nor members (the service role only)")
    ok(privs("tally_post_enqueue_to(uuid, text, jsonb, text, uuid)") == ["f", "t"] and privs("tally_bridge_bind(uuid, text)") == ["f", "f"] and privs("tally_bridge_reset(text, text)") == ["f", "t"] and privs("tally_post_enqueue_core(uuid, text, jsonb, uuid, text)") == ["f", "f"] and privs("tally_bridge_changes_only(uuid, text, boolean)") == ["f", "t"] and privs("tally_member_bridge_link(uuid, uuid, text)") == ["f", "t"],
       "5. the owner's and the poster's functions: members only")
    n = 0
    for fn in sorted(set(re.findall(r"create or replace function\s+public\.(\w+)\s*\(", text))):
        for row in db.rows("select prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)):
            n += 1
            want = "search_path=public,extensions,pg_temp" if fn == "tally_device_create" else "search_path=public,pg_temp"   # pgcrypto lives in extensions on Supabase
            ok(row["prosecdef"] == "t" and row["conf"].replace(" ", "") == want, "5. %s: security definer, %s (%s)" % (fn, want, row))
    ok(n >= 4, "5. %d functions checked" % n)
    # ---- review M2: a posting already queued is never moved to another bridge by queueing it again (again / Retry)
    # the owner's posting, queued with no target (made here as an older page made it)
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, created_by) values (%s, %s, 'c1', 'ZZ CO', %s, %s, 1, 'waiting', %s)" % (q(J(30)), q(F), q(D1), q(json.dumps({"vouchers": [vch("V30")]})), q(OWNER)))
    r = enq(STAFF, 30)
    ok(r.get("again") is True and jrow(30) == {"t": "null", "d": D1, "status": "waiting"}, "M2. Ravi queueing the owner's waiting posting again: it stays where it was, no target (%s | %s)" % (r, jrow(30)))
    r = enq(OWNER, 31, target=B1)
    ok(r.get("ok") is True and jrow(31)["t"] == B1, "M2. the owner's posting for his own bridge (%s)" % jrow(31))
    db.sql("update tally_post_jobs set status = 'failed', resend_only = '[\"V31\"]' where id = %s" % q(J(31)))
    r = enq(STAFF, 31)
    ok(r.get("retry") is True and jrow(31) == {"t": B1, "d": D1, "status": "waiting"}, "M2. Ravi's Retry of the owner's failed posting: waits again for the owner's bridge, not Ravi's (%s | %s)" % (r, jrow(31)))
    ok(db.one("select coalesce(resend_only::text, '-') from tally_post_jobs where id = %s" % q(J(31))) == "-", "final M1. a person's Retry is a whole Retry again: resend_only cleared")
    # ---- review M3: a bridge id belongs to the computer that reported it first; a copied id never moves a posting

    db.sql("update tally_devices set info = jsonb_set(info, '{bridges,%s}', '{\"at\": \"2026-10-06T10:00:00Z\", \"computer\": \"NW144\", \"user\": \"ravi\", \"mode\": \"main\", \"open\": [\"ZZ CO\"]}'::jsonb) where id = %s" % (B1, q(D2)))
    bind = lambda d, b: json.loads(db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(d), q(b))))
    x = bind(D2, B1)
    ok(x.get("own") is False and x.get("words") == "This computer key cannot use bridge %s: it belongs to NW144 · anshul. Ask the firm's owner." % B1 and bind(D1, B1).get("own") is True,
       "M3 / Fix 2c. Ravi's computer reporting the owner's bridge id (copied): refused with plain words (%s); the owner's computer is its own" % x.get("words"))
    bind(D2, B1)
    al = db.rows("select device_id::text as d, tried_computer as c, tried_user as u, coalesce(cleared_at::text, '') as cl from tally_bridge_alerts where bridge_id = %s" % q(B1))
    ok(al == [{"d": D2, "c": "NW144", "u": "ravi", "cl": ""}], "Fix 2c. ONE bell alert for the owner naming the computer and Windows user that tried, however often it tries (%s)" % al)
    ok(db.one("select info->'idRefused'->>'words' from tally_devices where id = %s" % q(D2)) == x.get("words"), "Fix 2c. the words on the trying computer's own line (info.idRefused)")
    ok(bind(D2, "go-eeee00000e").get("own") is True and bind(D1, "go-eeee00000e").get("own") is False, "M3. a new id: bound to the first computer that reports it")
    # Fix 2b: the owner's soft reset ("Release this bridge's identity"): kept, never deleted; the next computer to report it gets it
    r = rpcj(STAFF, "select tally_bridge_reset('go-eeee00000e', 'moved')::text")
    ok("_error" in r and "owner" in r["_error"], "Fix 2b. staff cannot release a bridge's identity (%s)" % r)
    r = rpcj(OWNER, "select tally_bridge_reset('go-eeee00000e', 'Ravi reinstalled Windows')::text")
    hist = db.rows("select device_id::text as d, coalesce(reset_by::text, '') as by, coalesce(reset_why, '') as why, (reset_at is not null)::text as reset from tally_bridge_ids where bridge_id = 'go-eeee00000e' order by id")
    ok(r.get("ok") is True and hist == [{"d": D2, "by": OWNER, "why": "Ravi reinstalled Windows", "reset": "true"}], "Fix 2b. the owner releases it: the binding kept with who, when and why (%s)" % hist)
    ok(bind(D1, "go-eeee00000e").get("own") is True and live("go-eeee00000e") == D1 and db.one("select count(*) from tally_bridge_ids where bridge_id = 'go-eeee00000e'") == "2",
       "Fix 2b. the next computer that reports it is bound; the old binding stays as history")
    bind(D1, B1)
    r = rpcj(OWNER, "select tally_bridge_reset(%s, 'checked')::text" % q(B1))
    ok(db.one("select count(*) from tally_bridge_alerts where bridge_id = %s and cleared_at is null" % q(B1)) == "0", "Fix 2c. the alert clears when the identity is released")
    ok(bind(D1, B1).get("own") is True, "Fix 2b. the owner's computer reporting it again: bound again")
    r = enq(OWNER, 32, target=B1)
    ok(r.get("ok") is True and jrow(32) == {"t": B1, "d": D1, "status": "waiting"}, "M3. the owner's posting for his bridge goes to his computer, whatever Ravi's computer reports (%s)" % jrow(32))
    r = enq(OWNER, 36, target=B1, device=D2)
    ok(r.get("ok") is False and not jrow(36), "M3. the bridge named with another computer: refused (%s)" % r.get("error"))
    r = enq(OWNER, 37, target=B2, device="none")
    ok(r.get("ok") is False and not jrow(37), "M3. a target without its computer: refused (%s)" % r.get("error"))
    db.sql("update tally_devices set info = info #- '{bridges,%s}' where id = %s" % (B1, q(D2)))
    # ---- review M4: no target: the newest computer that may post with the company open, never a changes-only one
    db.sql("update tally_companies set device_id = %s, last_seen = now() where company = 'ZZ CO'" % q(D3))
    db.sql("update tally_devices set last_seen = now() - interval '1 minute' where id = %s; update tally_devices set last_seen = now() - interval '5 minutes' where id = %s" % (q(D1), q(D2)))
    r = enq(OWNER, 33)
    ok(r.get("ok") is True and jrow(33) == {"t": B1, "d": D1, "status": "waiting"}, "#3. the company last seen on Meena's changes-only computer: the owner's posting goes to his own bridge (%s | %s)" % (r, jrow(33)))
    good, out = as_user(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J(35)), q(json.dumps({"vouchers": [vch("V35")]}))))
    ok(good and jrow(35)["d"] == D1, "M4. the same through the 3-argument tally_post_enqueue (%s)" % jrow(35))
    def opened(devs, val):
        for dv, bk in [(D1, B1), (D1, B4), (D2, B2), (D3, B3)]:
            if dv in devs: db.sql("update tally_devices set info = jsonb_set(info, array['bridges', %s, 'open'], %s::jsonb) where id = %s" % (q(bk), q(json.dumps(val)), q(dv)))
    opened((D1, D2), [])
    r = enq(OWNER, 34)
    W1 = "Nobody can post into ZZ CO just now: the only computer that has it open (NW144 · meena) is set to Changes only. Open the company in Tally on a computer that may post (NW144 · anshul, NW144 · ravi), or ask the owner to switch Changes only off for that bridge."
    WO = "Nobody can post into ZZ CO from your sign-in just now: your FinCom Bridge (NW144 · anshul) does not have ZZ CO open in Tally. Open ZZ CO in Tally there, then post again."
    ok(r.get("ok") is False and r.get("error") == WO and not jrow(34), "#3. the owner's own bridge does not have it open (only Meena's has): never routed into her Tally; the words name the company and what to do (%s)" % r.get("error"))
    ok(db.one("select tally_post_nobody_words(%s, 'ZZ CO')" % q(F)) == W1, "Fix 3. the firm-wide words: only a changes-only bridge has it open")
    ok(db.one("select coalesce(tally_post_device_for(%s, 'ZZ CO', %s)::text, '-')" % (q(F), q(D1))) == "-", "#3. tally_post_device_for: the company's own computer is no longer preferred when it does not have the company open")
    opened((D3,), [])
    r = enq(OWNER, 38)
    W2 = "Nobody can post into ZZ CO just now: no computer has it open in Tally. Open the company in Tally on a computer that may post (NW144 · anshul, NW144 · ravi), then post again."
    ok(r.get("ok") is False and r.get("error") == WO and not jrow(38), "#3. none open anywhere: the owner's words (%s)" % r.get("error"))
    ok(db.one("select tally_post_nobody_words(%s, 'ZZ CO')" % q(F)) == W2, "Fix 3. the firm-wide words: none open anywhere")
    opened((D3,), ["ZZ CO"])
    # the poster's own bridge offline (not heard from for more than 3 minutes)
    db.sql("update tally_devices set info = jsonb_set(info, array['bridges', %s, 'at'], '\"2026-10-01T04:30:00Z\"'::jsonb) where id = %s" % (q(B2), q(D2)))
    opened((D1, D2), ["ZZ CO"])
    r = enq(STAFF, 39)
    W3 = "Queued: waits for your FinCom Bridge on NW144 · ravi (not heard from since 01-Oct-2026 10:00 IST); it is posted as soon as that bridge is back. If it does not come back by itself, start it there (sign in to Windows as ravi)."
    ok(r.get("ok") is True and r.get("note") == W3 and jrow(39) == {"t": B2, "d": D2, "status": "waiting"} and db.one("select message from tally_post_jobs where id = %s" % q(J(39))) == W3,
       "#6. the poster's own bridge not heard from for 3 minutes: queued anyway, with the note on it (%s | %s)" % (r.get("note") or r.get("error"), jrow(39)))
    db.sql("update tally_devices set info = jsonb_set(info, array['bridges', %s, 'at'], to_jsonb(%s::text)) where id = %s" % (q(B2), q(NOW), q(D2)))
    opened((D1, D2), [])
    db.sql("update tally_companies set device_id = %s where company = 'ZZ CO'" % q(D1))
    opened((D1, D2, D3), ["ZZ CO"])
    # 3 again: unlinking keeps the row
    r = rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, null, null)::text" % q(STAFF))
    ok(r.get("ok") is True and db.one("select count(*) from tally_member_bridges where user_id = %s and bridge_id is null" % q(STAFF)) == "1", "3. unlinking Ravi keeps his row (bridge null); nothing deleted")
    r = enq(STAFF, 21)
    ok(r.get("ok") is True and jrow(21) == {"t": B2, "d": D2, "status": "waiting"}, "#3. unlinked, Ravi's posting goes to his own bridge (the computer key he made) (%s)" % jrow(21))
    # ---- review M-A: a bridge id is bound within its firm only; another firm's binding never refuses, its words never show
    ok(bind(D9, B1).get("own") is True and live(B1, F2) == D9 and live(B1, F) == D1, "M-A. both firms' computers report %s: each is its own, within its firm" % B1)
    NEWID = "go-abcdef0099"
    ok(bind(D9, NEWID).get("own") is True and bind(D1, NEWID).get("own") is True and live(NEWID, F2) == D9 and live(NEWID, F) == D1, "M-A. a new id reported in two firms: each firm binds it to its own computer")
    x = bind(D2, NEWID)
    ok(x.get("own") is False and x.get("words") == "This computer key cannot use bridge %s: it belongs to NW144 · anshul. Ask the firm's owner." % NEWID, "M-A. within one firm the refusal still holds, naming the firm's own computer (%s)" % x.get("words"))
    ok(db.one("select count(*) from tally_devices where firm_id = %s and info ? 'idRefused'" % q(F2)) == "0" and db.one("select count(*) from tally_bridge_alerts where firm_id = %s" % q(F2)) == "0",
       "M-A. the other firm has no refusal on its rows and no alert")
    ok(db.one("select count(*) from tally_bridge_alerts where words ~* 'OTHERPC|priya' or tried_computer ~* 'OTHERPC' or tried_user ~* 'priya'") == "0"
       and db.one("select count(*) from tally_devices where firm_id = %s and info -> 'idRefused' ->> 'words' ~* 'OTHERPC|priya'" % q(F)) == "0",
       "M-A. the other firm's computer and Windows user appear in none of this firm's words")
    r = enq(O2, 50, target=B1, client="c9", device=D9)
    ok(r.get("ok") is True and jrow(50) == {"t": B1, "d": D9, "status": "waiting"}, "M-A. the other firm's owner posts through its bridge %s normally (%s | %s)" % (B1, r, jrow(50)))
    r = enq(OWNER, 51, target=B1)
    ok(r.get("ok") is True and jrow(51) == {"t": B1, "d": D1, "status": "waiting"}, "M-A. and this firm's owner through the same id on his own computer (%s | %s)" % (r, jrow(51)))
    ok(take(D9, B1, True) == [J(50)] and jrow(51)["status"] == "waiting", "M-A. the other firm's bridge takes its own posting, never this firm's")
    db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(51)))
    r = rpcj(O2, "select tally_bridge_reset(%s, 'cloned profile')::text" % q(B1))
    ok(r.get("ok") is True and r.get("released") is True and live(B1, F2) == "-" and live(B1, F) == D1, "M-A. the other firm's owner releases the id in his firm only; this firm's binding stays (%s)" % r)
    r = rpcj(OWNER, "select tally_bridge_reset(%s, 'tidy')::text" % q(NEWID))
    ok(r.get("ok") is True and live(NEWID, F) == "-" and live(NEWID, F2) == D9 and db.one("select count(*) from tally_bridge_alerts where bridge_id = %s and cleared_at is null" % q(NEWID)) == "0",
       "M-A. this firm's owner releases it in his firm (its alert cleared); the other firm's binding stays")
    ok(bind(D2, NEWID).get("own") is True and live(NEWID, F) == D2, "M-A. within the firm the next computer to report it gets it")
    # ---- review M-B: a posting for a bridge that can no longer post is never left waiting for ever
    def job(n, dev, target, status="waiting"):
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, created_by, target_bridge) values (%s, %s, 'c1', 'ZZ CO', %s, %s, 1, %s, %s, %s)"
               % (q(J(n)), q(F), q(dev), q(json.dumps({"vouchers": [vch("V%d" % n)]})), q(status), q(OWNER), "null" if target is None else q(target)))
    msg = lambda n: db.one("select coalesce(message, '') from tally_post_jobs where id = %s" % q(J(n)))
    co = lambda d, b, on: rpcj(OWNER, "select tally_bridge_changes_only(%s::uuid, %s, %s)::text" % (q(d), q(b), "true" if on else "false"))
    r = enq(OWNER, 60, target=B1)
    ok(r.get("ok") is True and jrow(60) == {"t": B1, "d": D1, "status": "waiting"}, "M-B. the owner's posting for his main bridge %s (%s)" % (B1, jrow(60)))
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(B4), q(D1)))
    ok(jrow(60) == {"t": B4, "d": D1, "status": "waiting"} and "NW144 · anshul" in msg(60), "M-B. another bridge made main on that computer: the posting moves to it, on the same computer (%s | %s)" % (jrow(60), msg(60)))
    db.sql("update tally_devices set main_bridge = null where id = %s" % q(D1))
    ok(jrow(60)["t"] == B4, "M-B. no main chosen (both may post): it stays")
    r = co(D1, B4, True)
    ok(r.get("ok") is True and jrow(60) == {"t": B1, "d": D1, "status": "waiting"}, "M-B. its bridge switched to Changes only: moved to the computer's bridge that may post (%s | %s)" % (r, jrow(60)))
    co(D1, B4, False); db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(B1), q(D1)))
    r = enq(OWNER, 61, target=B2)
    ok(r.get("ok") is True and jrow(61) == {"t": B2, "d": D2, "status": "waiting"}, "M-B. the owner's posting for Ravi's bridge (%s)" % jrow(61))
    r = co(D2, B2, True)
    W5 = "Not posted into ZZ CO: the FinCom Bridge it was for (NW144 · ravi) is set to Changes only, and no other bridge of the same Windows user on that computer may post. Ask the firm's owner to switch Changes only off for that bridge (Tally page), then Retry; or post these entries again so FinCom chooses a bridge that may post."
    ok(r.get("ok") is True and jrow(61) == {"t": B2, "d": D2, "status": "failed"} and msg(61) == W5, "M-B. switched to Changes only with no other bridge on that computer: failed in plain words, never left waiting (%s | %s)" % (jrow(61), msg(61)))
    r = enq(STAFF, 61)
    W6 = "Not queued again for ZZ CO: the FinCom Bridge it was for (NW144 · ravi) is set to Changes only, and no other bridge of the same Windows user on that computer may post. Ask the firm's owner to switch Changes only off for that bridge (Tally page), then Retry; or post these entries again so FinCom chooses a bridge that may post."
    ok(r.get("ok") is False and r.get("error") == W6 and jrow(61) == {"t": B2, "d": D2, "status": "failed"}, "M-B. Retry while it still cannot post: refused in plain words, nothing moved (%s)" % r.get("error"))
    co(D2, B2, False)
    r = enq(STAFF, 61)
    ok(r.get("retry") is True and jrow(61) == {"t": B2, "d": D2, "status": "waiting"}, "M-B. Changes only off again: Retry waits for that bridge (%s | %s)" % (r, jrow(61)))
    # Retry of a posting whose bridge is no longer main: the same computer's main bridge, never the retrier's (M2 kept)
    r = rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, %s::uuid, %s)::text" % (q(STAFF), q(D2), q(B2)))
    job(62, D1, B4, "failed")
    r = enq(STAFF, 62)
    ok(r.get("retry") is True and jrow(62) == {"t": B1, "d": D1, "status": "waiting"}, "M-B. Ravi's Retry of the owner's posting for a bridge no longer main: the same computer's main bridge, not Ravi's (%s | %s)" % (r, jrow(62)))
    job(64, D1, B4, "waiting")
    r = enq(STAFF, 64)
    ok(r.get("again") is True and jrow(64) == {"t": B1, "d": D1, "status": "waiting"}, "M-B. queued again while waiting for a bridge that can no longer post: moved the same way (%s | %s)" % (r, jrow(64)))
    # a posting naming no bridge on a computer none of whose bridges may post
    job(63, D3, None)
    r = co(D3, B3, True)
    W7 = "Not posted into ZZ CO: the computer it was for (NW144 · meena) has no FinCom Bridge that may post just now (each is set to Changes only or only reads Tally). Ask the firm's owner to make one of its bridges the main one or switch Changes only off for it (Tally page), then Retry; or post these entries again so FinCom chooses a bridge that may post."
    ok(jrow(63) == {"t": "null", "d": D3, "status": "failed"} and msg(63) == W7, "M-B. a posting naming no bridge on a computer that cannot post: failed in plain words (%s | %s)" % (jrow(63), msg(63)))
    ok(db.one("select count(*) from tally_post_jobs where status = 'waiting' and target_bridge is not null and not tally_bridge_may_post(device_id, target_bridge)") == "0", "M-B. no waiting posting is left for a bridge that cannot post")

    # ---- #7: the main-bridge rule holds only among the bridges of ONE Windows user. NW144's old shared computer key (1.15.0's
    # settings carried over to several users): anshul's B6 and durgesh's B7 and B9 report through the same key D4
    D4, B6, B7, B9 = "d4000000-0000-0000-0000-000000000004", "go-eeee000006", "go-ffff000007", "go-abab000009"
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by, main_bridge) values (%s, %s, 'NW144', 'h4', '2.3.0', %s, %s, %s)"
           % (q(D4), q(F), q(json.dumps({"bridges": {B6: {"at": NOW, "computer": "NW144", "user": "anshul", "mode": "main", "open": ["ZZ CO"]},
                                                     B7: {"at": NOW, "computer": "NW144", "user": "durgesh", "mode": "main", "open": ["ZZ CO"]},
                                                     B9: {"at": NOW, "computer": "NW144", "user": "Durgesh", "mode": "main", "open": ["ZZ CO"]}}})), q(OWNER), q(B6)))
    for b_ in (B6, B7, B9): bind(D4, b_)
    DEV_OF.update({B6: D4, B7: D4, B9: D4})
    mp = lambda d, b: db.one("select tally_bridge_may_post(%s, %s)::text" % (q(d), q(b)))
    ok(mp(D4, B6) == "true" and mp(D4, B7) == "true" and mp(D4, B9) == "true", "#7. anshul's bridge is the main one on the shared key: durgesh's bridges still post (another Windows user's main bridge stops nobody)")
    r = enq(STAFF3, 70)
    ok(r.get("ok") is False and "FinCom has not heard from a FinCom Bridge of yours" in r.get("error", "") and not jrow(70), "#3. Durgesh, with no bridge of his own known yet: refused in plain words, never routed into someone else's Tally (%s)" % r.get("error"))
    r = rpcj(STAFF3, LINK(STAFF3, D4, B7))
    ok("_error" in r and "computer key you made" in r["_error"], "final M3. Durgesh cannot link himself to a bridge on the shared key (made by another member): the key proves nothing of whose bridge it is (%s)" % str(r.get("_error", r))[-200:])
    r = rpcj(OWNER, LINK(STAFF3, D4, B7))
    ok(r.get("ok") is True, "#4. the owner links Durgesh to his bridge on the shared key (%s)" % r)
    r = enq(STAFF3, 70)
    ok(r.get("ok") is True and jrow(70) == {"t": B7, "d": D4, "status": "waiting"}, "#7. Durgesh's posting goes to his own bridge on the shared key (%s | %s)" % (r, jrow(70)))
    r = enq(STAFF3, 71, target=B6)
    ok(r.get("ok") is False and "owner" in r.get("error", "") and not jrow(71), "#5. Durgesh cannot post through anshul's bridge on the same key (not his own) (%s)" % r.get("error"))
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(B9), q(D4)))
    ok(jrow(70) == {"t": B9, "d": D4, "status": "waiting"} and mp(D4, B6) == "true" and mp(D4, B7) == "false",
       "#7. durgesh's other bridge made main: his posting moves to it (the same Windows user); anshul's bridge still posts (%s)" % jrow(70))
    r = rpcj(OWNER, "select tally_bridge_changes_only(%s::uuid, %s, true)::text" % (q(D4), q(B9)))
    ok(r.get("ok") is True and jrow(70) == {"t": B9, "d": D4, "status": "failed"} and "same Windows user" in msg(70),
       "#7. no bridge of durgesh's may post: failed in plain words, NEVER moved into anshul's Tally on the same key (%s | %s)" % (jrow(70), msg(70)))
    rpcj(OWNER, "select tally_bridge_changes_only(%s::uuid, %s, false)::text" % (q(D4), q(B9)))
    ok(db.one("select count(*) from tally_post_jobs j where j.status = 'waiting' and j.target_bridge is not null and lower(coalesce((select d.info->'bridges'->j.target_bridge->>'user' from tally_devices d where d.id = j.device_id), '')) = 'anshul' and j.created_by = %s" % q(STAFF3)) == "0",
       "#7. none of Durgesh's postings waits for anshul's bridge")
    # #7: a fresh computer key for the user whose bridge sits on a shared key (TCloud.auto): the bridge id goes with it
    r = rpcj(STAFF3, "select tally_device_create('NW144 · durgesh')::text")
    D5 = r.get("id", "")
    ok(bool(D5) and db.one("select created_by::text from tally_devices where id = %s" % q(D5)) == STAFF3, "#7. Durgesh's page makes his own computer key (created_by kept) (%s)" % r.get("_error", ""))
    job_ = lambda n, dev, t: db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, created_by, target_bridge) values (%s, %s, 'c1', 'ZZ CO', %s, %s, 1, 'waiting', %s, %s)" % (q(J(n)), q(F), q(dev), q(json.dumps({"vouchers": [vch("V%d" % n)]})), q(STAFF3), q(t)))
    job_(72, D4, B7)
    r = rpcj(STAFF, "select tally_bridge_own_key(%s, %s::uuid)::text" % (q(B7), q(D5)))
    ok("_error" in r and live(B7, F) == D4, "#7. nobody else may move it to their key (%s)" % r)
    r = rpcj(STAFF3, "select tally_bridge_own_key(%s, %s::uuid)::text" % (q(B6), q(D5)))
    ok("_error" in r and live(B6, F) == D4, "#7. nor a bridge he is not linked to (anshul's, on the same key) (%s)" % r)
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(B6), q(D4)))
    r = rpcj(STAFF3, "select tally_bridge_own_key(%s, %s::uuid)::text" % (q(B7), q(D5)))
    ok("_error" in r and "moves itself" in r["_error"] and live(B7, F) == D4, "final M3. a member alone cannot move a bridge, even his own linked one: the bridge moves itself (proof: it holds both keys) (%s)" % str(r.get("_error", r))[-200:])
    mv = lambda b, frm, to, u: svc("select tally_bridge_own_key_move(%s, %s::uuid, %s::uuid, %s)::text" % (q(b), q(frm), q(to), q(u)))
    ok(db.one("select has_function_privilege('authenticated', 'public.tally_bridge_own_key_move(text, uuid, uuid, text)', 'execute')") == "f", "final M3. tally_bridge_own_key_move: the service role only (tally-ingest, after the bridge proved both keys)")
    r = mv(B6, D4, D5, "durgesh")
    ok(r.get("ok") is False and live(B6, F) == D4, "final M3. the bridge's Windows user must be the one that bridge reports (anshul's B6 claimed as durgesh's): refused (%s)" % r)
    rk = rpcj(STAFF, "select tally_device_create('NW144 · ravi 2')::text"); D6 = rk.get("id", "")
    db.sql("update tally_devices set created_at = now() - interval '20 minutes' where id = %s" % q(D6))
    r = mv(B7, D4, D6, "durgesh")
    ok(r.get("ok") is False and live(B7, F) == D4, "final M3. only onto a NEW key (made within 15 minutes) (%s)" % r)
    r = mv(B7, D4, D5, "durgesh")
    hist = db.rows("select device_id::text as d, (reset_at is not null)::text as reset, coalesce(reset_why, '') as why from tally_bridge_ids where bridge_id = %s and firm_id = %s order by id" % (q(B7), q(F)))
    ok(r.get("ok") is True and r.get("moved") is True and live(B7, F) == D5 and len(hist) == 2 and hist[0]["reset"] == "true" and "own computer key" in hist[0]["why"],
       "#7. Durgesh's bridge moves to his own new key: the old binding kept as history, with why (%s | %s)" % (r, hist))
    ok(jrow(72) == {"t": B7, "d": D5, "status": "waiting"} and db.one("select device_id::text from tally_member_bridges where user_id = %s" % q(STAFF3)) == D5,
       "#7. its waiting posting and Durgesh's link go with it (the same bridge, the same Tally) (%s)" % jrow(72))
    db.sql("update tally_devices set info = jsonb_set(info, '{bridges}', jsonb_build_object(%s, %s::jsonb)) where id = %s" % (q(B7), q(json.dumps({"at": NOW, "computer": "NW144", "user": "durgesh", "mode": "main", "open": ["ZZ CO"]})), q(D5)))
    ok(bind(D5, B7).get("own") is True, "#7. the bridge reporting through its new key is its own there")
    r = rpcj(STAFF3, LINK(STAFF3, D5, B7))
    ok(r.get("ok") is True, "final M3. on the key he made, Durgesh links himself to his own bridge, no owner (%s)" % r)
    r = mv(B9, D4, D5, "durgesh")
    ok(r.get("ok") is False and live(B9, F) == D4, "#7. only onto a NEW key with nothing reported on it yet (%s)" % r)
    r = rpcj(OWNER, "select tally_bridge_own_key(%s, %s::uuid)::text" % (q(B9), q(D5)))
    ok("_error" in r, "#7. an owner too: only onto a NEW key (%s)" % str(r.get("_error", r))[-160:])
    # ---- #14: Update now wakes every computer key with the company open, and the caller's own
    db.sql("update tally_devices set want_update_at = null")
    opened((D3,), [])
    woken = lambda: sorted(r_["id"] for r_ in db.rows("select id::text from tally_devices where want_update_at is not null"))
    r = rpcj(OWNER, "select tally_want_update('c1')::text")
    ok(r.get("ok") is True and woken() == sorted([D1, D2, D4, D5]), "#14. the owner's Update now: the company's computer and every key whose bridges have ZZ CO open (not Meena's) (%s)" % woken())
    db.sql("update tally_devices set want_update_at = null")
    r = rpcj(STAFF2, "select tally_want_update('c1')::text")
    ok(r.get("ok") is True and woken() == sorted([D1, D2, D3, D4, D5]), "#14. Meena's: and her own key too (%s)" % woken())
    db.sql("update tally_devices set want_update_at = null")
    r = rpcj(STAFF2, "select tally_want_update('c-none')::text")
    ok(r.get("ok") is False and woken() == [], "#14. a client with no Tally company: nothing woken (%s)" % r)
    opened((D3,), ["ZZ CO"])
    # ---- #18: a bridge that stopped reading by itself: resumed by any member who may write, on a key they made
    stops = lambda: db.rows("select coalesce(device_id::text, 'all') as d, action, stopped_by::text as by from tally_read_stops order by id")
    r = rpcj(STAFF2, "select tally_read_resume(%s::uuid)::text" % q(D3))
    ok(r.get("ok") is True and stops()[-1] == {"d": D3, "action": "resume", "by": STAFF2}, "#18. Meena resumes her own bridge's self-stop (no owner needed) (%s)" % r)
    r = rpcj(STAFF, "select tally_read_resume(%s::uuid)::text" % q(D3))
    ok("_error" in r, "#18. Ravi cannot resume a key he did not make (%s)" % r.get("_error", "")[-120:])
    r = rpcj(STAFF, "select tally_read_resume(null)::text")
    ok("_error" in r, "#18. nor every computer at once")
    r = rpcj(STAFF, "select tally_read_stop(%s::uuid, 'test')::text" % q(D2))
    ok("_error" in r and "owner" in r["_error"], "#18. FinCom's emergency Stop stays owner-only")
    rpcj(OWNER, "select tally_read_stop(%s::uuid, 'emergency')::text" % q(D2))
    r = rpcj(STAFF, "select tally_read_resume(%s::uuid)::text" % q(D2))
    ok("_error" in r and "owner" in r["_error"], "#18. FinCom's Stop set by an owner: only an owner resumes it, even on Ravi's own key (%s)" % r.get("_error", "")[-160:])
    r = rpcj(OWNER, "select tally_read_resume(%s::uuid)::text" % q(D2))
    ok(r.get("ok") is True, "#18. the owner resumes it")
    rpcj(OWNER, "select tally_read_stop(null, 'all')::text")
    r = rpcj(STAFF2, "select tally_read_resume(%s::uuid)::text" % q(D3))
    ok("_error" in r and "owner" in r["_error"], "#18. a Stop of every computer: only an owner resumes (%s)" % r.get("_error", "")[-120:])
    rpcj(OWNER, "select tally_read_resume(null)::text")
    # ---- A: new bridge versions go to every computer by themselves; the owner may HOLD a version or roll back (who, when, why kept)
    rel_ = lambda v: (db.rows("select coalesce(held_at::text, '') as held, coalesce(held_by::text, '') as by, coalesce(held_why, '') as why from tally_bridge_releases where firm_id = %s and version = %s" % (q(F), q(v))) or [{}])[0]
    r = rpcj(STAFF, "select tally_release_hold('2.3.1', 'test')::text")
    ok("_error" in r and "owner" in r["_error"], "A. staff cannot hold a version (%s)" % r.get("_error", "")[-100:])
    r = rpcj(OWNER, "select tally_release_hold('2.3.1', '')::text")
    ok("_error" in r and "reason" in r["_error"], "A. a hold needs a reason")
    r = rpcj(OWNER, "select tally_release_hold('2.3.x', 'x')::text")
    ok("_error" in r, "A. not a version: refused")
    r = rpcj(OWNER, "select tally_release_hold('2.3.1', 'posting broke on NWS144')::text")
    h = rel_("2.3.1")
    ok(r.get("ok") is True and h.get("held") and h.get("by") == OWNER and h.get("why") == "posting broke on NWS144", "A. the owner holds 2.3.1: who, when and why kept (%s)" % h)
    r = rpcj(OWNER, "select tally_release_unhold('2.3.1', 'fixed in 2.3.1 build 2')::text")
    log_ = db.rows("select version, action, by_user::text as by, why from tally_bridge_release_log where firm_id = %s order by id" % q(F))
    ok(r.get("ok") is True and not rel_("2.3.1").get("held") and [x["action"] for x in log_] == ["hold", "unhold"] and log_[1]["why"] == "fixed in 2.3.1 build 2" and log_[0]["by"] == OWNER,
       "A. let go again: the hold cleared, both kept in the log with who and why (%s)" % log_)
    r = rpcj(STAFF, "select tally_release_rollback('2.2.4', 'x')::text")
    ok("_error" in r and "owner" in r["_error"], "A. staff cannot roll back")
    r = rpcj(OWNER, "select tally_release_rollback('2.2.4', 'posting broke')::text")
    r2 = rpcj(OWNER, "select tally_release_rollback('2.2.3', 'still broke')::text")
    rb = db.rows("select version, (cleared_at is null)::text as live, coalesce(cleared_by::text, '') as cb from tally_bridge_rollbacks where firm_id = %s order by id" % q(F))
    ok(r.get("ok") is True and r2.get("ok") is True and rb == [{"version": "2.2.4", "live": "false", "cb": OWNER}, {"version": "2.2.3", "live": "true", "cb": ""}],
       "A. the owner rolls back to 2.2.4, then 2.2.3: one standing at a time, the earlier kept (cleared) (%s)" % rb)
    good, out = as_user(STAFF, "select count(*) from tally_bridge_rollbacks")
    ok(good and out == "2", "A. members read the rollbacks (%s)" % out)
    r = rpcj(OWNER, "select tally_release_rollback_clear('fixed')::text")
    ok(r.get("ok") is True and db.one("select count(*) from tally_bridge_rollbacks where firm_id = %s and cleared_at is null" % q(F)) == "0" and db.one("select count(*) from tally_bridge_rollbacks") == "2",
       "A. the rollback cleared: none standing, the rows kept")
    ok([x["action"] for x in db.rows("select action from tally_bridge_release_log where firm_id = %s order by id" % q(F))] == ["hold", "unhold", "rollback", "rollback", "rollback_clear"], "A. every action in the log")
    # ---- #8: no limit on the number of computer keys (one per Windows user's bridge)
    n0 = int(db.one("select count(*) from tally_devices where firm_id = %s and not revoked" % q(F)))
    good, out = as_user(STAFF, "select count(*) from (select tally_device_create('PC ' || g) from generate_series(1, 60) g) x")
    ok(good and out == "60" and int(db.one("select count(*) from tally_devices where firm_id = %s and not revoked" % q(F))) == n0 + 60, "#8. 60 more computer keys are made (%s keys in the firm now; %s)" % (n0 + 60, out[-200:]))
    good, out = as_user("00000000-0000-0000-0000-00000000dead", "select tally_device_create('PC x')::text")
    ok(not good, "#8. still members who may write only")
finally:
    db.stop()
print("\nall checks passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
