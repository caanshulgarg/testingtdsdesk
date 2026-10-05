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
import os, re, sys, json, subprocess
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
D1, D2, D3 = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002", "d3000000-0000-0000-0000-000000000003"
B1, B2, B3, B4 = "go-aaaa000001", "go-bbbb000002", "go-cccc000003", "go-dddd000004"   # anshul's, ravi's, meena's (all NW144), a test bridge on D1
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
    br = lambda *ids: q(json.dumps({"bridges": {i: {"at": "2026-10-05T10:00:00Z", "computer": "NW144", "user": u, "mode": "main", "open": ["ZZ CO"]} for i, u in ids}}))
    DEV_OF.update({B1: D1, B4: D1, B2: D2, B3: D3, "go-ffff00000f": D1})
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Ravi', 'staff', true), (%(S2)s, %(F)s, 'Meena', 'staff', true);
      insert into tally_devices (id, firm_id, name, key_hash, version, info) values (%(D1)s, %(F)s, 'NW144 · anshul', 'h1', '2.3.0', %(I1)s), (%(D2)s, %(F)s, 'NW144 · ravi', 'h2', '2.3.0', %(I2)s),
        (%(D3)s, %(F)s, 'NW144 · meena', 'h3', '2.3.0', %(I3)s);
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"postTo": "ZZ CO"}');""" % {"F": q(F), "O": q(OWNER), "S": q(STAFF), "S2": q(STAFF2), "D1": q(D1), "D2": q(D2), "D3": q(D3),
        "I1": br((B1, "anshul"), (B4, "anshul")), "I2": br((B2, "ravi")), "I3": br((B3, "meena"))})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""create table if not exists tally_companies (firm_id uuid, company text, client_id text, device_id uuid, last_seen timestamptz, book_id uuid, gstin text, linked_at timestamptz);
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen) values (%s, 'ZZ CO', 'c1', %s, now());""" % (q(F), q(D1)))
    # an older posting, queued before 54
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, '{\"vouchers\": []}', 0, 'waiting')" % (q(J(1)), q(F), q(D1)))
    before = counts()
    for rnd in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "0. pass %d: migration 54 runs %s" % (rnd, (r.stderr or "").strip()[-400:]))
        if r.returncode: raise SystemExit("cannot go on")
        ok(counts() == before, "0. pass %d: nothing deleted, nothing added (%s)" % (rnd, counts()))
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
    r = rpcj(STAFF, "select tally_member_bridge_link(%s::uuid, %s::uuid, %s)::text" % (q(STAFF), q(D2), q(B2)))
    ok("_error" in r and "owner" in r["_error"], "3. staff cannot link themselves (%s)" % r)
    r = rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, %s::uuid, %s)::text" % (q(STAFF), q(D2), q(B2)))
    ok(r.get("ok") is True, "3. the owner links Ravi to his bridge on NW144 (%s)" % r)
    r = rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, %s::uuid, %s)::text" % (q(STAFF2), q(D3), q(B3)))
    ok(r.get("ok") is True, "3. and Meena to hers (changes only)")
    r = rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, %s::uuid, %s)::text" % (q(STAFF2), q(D2), "'go-ffff00000f'"))
    ok("_error" in r, "3. a bridge not heard from on that computer is refused")
    good, out = as_user(STAFF, "select bridge_id from tally_member_bridges where user_id = %s" % q(STAFF))
    ok(good and out == B2, "3. members read the links (%s)" % out)
    # 4. queueing with a target
    r = enq(STAFF, 2)
    ok(r.get("ok") is True and r.get("target") == B2 and jrow(2) == {"t": B2, "d": D2, "status": "waiting"}, "4. Ravi posts with no target: his own bridge on NW144 (%s | %s)" % (r, jrow(2)))
    r = enq(OWNER, 3)
    ok(r.get("ok") is True and jrow(3)["t"] == "null" and jrow(3)["d"] == D1, "4. the owner, not linked: no target, the computer that keeps the company (as today) (%s | %s)" % (r, jrow(3)))
    r = enq(OWNER, 4, target=B2)
    ok(r.get("ok") is True and jrow(4) == {"t": B2, "d": D2, "status": "waiting"}, "4. the owner picks Ravi's bridge: queued for it, on its computer (%s)" % jrow(4))
    r = enq(STAFF, 5, target=B1)
    ok(r.get("ok") is False and "owner" in r.get("error", "") and not jrow(5), "4. Ravi cannot pick another bridge than his own (%s)" % r)
    r = enq(OWNER, 6, target=B3)
    ok(r.get("ok") is False and "changes only" in r.get("error", "") and not jrow(6), "4. a changes-only bridge is never a target (%s)" % r)
    r = enq(STAFF2, 7)
    ok(r.get("ok") is True and jrow(7)["t"] == "null", "4. Meena's own bridge is changes only: her posting goes to the computer's main bridge, as today (%s | %s)" % (r, jrow(7)))
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
    ok(good and json.loads(out).get("ok") is True and jrow(11)["t"] == "null", "4. the 3-argument tally_post_enqueue is as before (no target)")
    r = enq(OWNER, 4, target=B2)
    ok(r.get("ok") is True and r.get("again") is True and jrow(4)["t"] == B2, "4. the same posting again: as before (again), its target kept (%s)" % r)
    # 5. the hand-out
    ok(take(D2, B2, False) == [J(2)], "5. Ravi's bridge (not main) takes the posting for it, the oldest first")
    ok(take(D2, B2, False) == [J(4)] and take(D2, B2, False) == [], "5. then the owner's posting for it; nothing else")
    ok(take(D1, B4, False) == [], "5. another bridge on anshul's computer (not main) takes nothing with no target")
    ok(take(D1, B1, True) == [J(1)], "5. anshul's main bridge takes the older posting (no target), as today")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge) values (%s, %s, 'c1', 'ZZ CO', %s, '{\"vouchers\": []}', 0, 'waiting', %s)" % (q(J(20)), q(F), q(D3), q(B3)))
    ok(take(D3, B3, True) == [] and jrow(20)["status"] == "waiting", "5. a changes-only bridge takes no posting, even one for it")
    ok(take(D1, B2, True) == [], "5. a bridge never takes another computer's postings")
    privs = lambda sig: [db.one("select has_function_privilege(%s, %s, 'execute')" % (q(r), q("public." + sig))) for r in ("anon", "authenticated")]
    ok(privs("tally_post_take_for(uuid, text, boolean)") == ["f", "f"], "5. tally_post_take_for: not for anon nor members (the service role only)")
    ok(privs("tally_post_enqueue_to(uuid, text, jsonb, text, uuid)") == ["f", "t"] and privs("tally_bridge_bind(uuid, text)") == ["f", "f"] and privs("tally_post_enqueue_core(uuid, text, jsonb, uuid, text)") == ["f", "f"] and privs("tally_bridge_changes_only(uuid, text, boolean)") == ["f", "t"] and privs("tally_member_bridge_link(uuid, uuid, text)") == ["f", "t"],
       "5. the owner's and the poster's functions: members only")
    n = 0
    for fn in sorted(set(re.findall(r"function\s+public\.(\w+)\s*\(", text))):
        for row in db.rows("select prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)):
            n += 1
            ok(row["prosecdef"] == "t" and row["conf"].replace(" ", "") == "search_path=public,pg_temp", "5. %s: security definer, search_path = public, pg_temp (%s)" % (fn, row))
    ok(n >= 4, "5. %d functions checked" % n)
    # ---- review M2: a posting already queued is never moved to another bridge by queueing it again (again / Retry)
    # the owner's posting, queued with no target (made here as an older page made it)
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, created_by) values (%s, %s, 'c1', 'ZZ CO', %s, %s, 1, 'waiting', %s)" % (q(J(30)), q(F), q(D1), q(json.dumps({"vouchers": [vch("V30")]})), q(OWNER)))
    r = enq(STAFF, 30)
    ok(r.get("again") is True and jrow(30) == {"t": "null", "d": D1, "status": "waiting"}, "M2. Ravi queueing the owner's waiting posting again: it stays where it was, no target (%s | %s)" % (r, jrow(30)))
    r = enq(OWNER, 31, target=B1)
    ok(r.get("ok") is True and jrow(31)["t"] == B1, "M2. the owner's posting for his own bridge (%s)" % jrow(31))
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(31)))
    r = enq(STAFF, 31)
    ok(r.get("retry") is True and jrow(31) == {"t": B1, "d": D1, "status": "waiting"}, "M2. Ravi's Retry of the owner's failed posting: waits again for the owner's bridge, not Ravi's (%s | %s)" % (r, jrow(31)))
    # ---- review M3: a bridge id belongs to the computer that reported it first; a copied id never moves a posting
    ok(db.one("select count(*) from tally_bridge_ids") == "4" and db.one("select device_id::text from tally_bridge_ids where bridge_id = %s" % q(B1)) == D1, "M3. the ids heard from before 54 are bound to their computer (4)")
    db.sql("update tally_devices set info = jsonb_set(info, '{bridges,%s}', '{\"at\": \"2026-10-06T10:00:00Z\", \"mode\": \"main\", \"open\": [\"ZZ CO\"]}'::jsonb) where id = %s" % (B1, q(D2)))
    ok(db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(D2), q(B1))) == "false" and db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(D1), q(B1))) == "true",
       "M3. Ravi's computer reporting the owner's bridge id (copied): not bound to it; the owner's computer is")
    ok(db.one("select tally_bridge_bind(%s::uuid, 'go-eeee00000e')::text" % q(D2)) == "true" and db.one("select tally_bridge_bind(%s::uuid, 'go-eeee00000e')::text" % q(D1)) == "false", "M3. a new id: bound to the first computer that reports it")
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
    ok(r.get("ok") is True and jrow(33) == {"t": "null", "d": D1, "status": "waiting"}, "M4. the company last seen on Meena's changes-only computer: the posting goes to the newest computer that may post with ZZ CO open (%s | %s)" % (r, jrow(33)))
    good, out = as_user(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J(35)), q(json.dumps({"vouchers": [vch("V35")]}))))
    ok(good and jrow(35)["d"] == D1, "M4. the same through the 3-argument tally_post_enqueue (%s)" % jrow(35))
    def opened(devs, val):
        for dv, bk in [(D1, B1), (D1, B4), (D2, B2), (D3, B3)]:
            if dv in devs: db.sql("update tally_devices set info = jsonb_set(info, array['bridges', %s, 'open'], %s::jsonb) where id = %s" % (q(bk), q(json.dumps(val)), q(dv)))
    opened((D1, D2), [])
    r = enq(OWNER, 34)
    ok(r.get("ok") is False and "No computer that may post has ZZ CO open" in r.get("error", "") and not jrow(34), "M4. no computer that may post has it open: refused in plain words (%s)" % r.get("error"))
    db.sql("update tally_companies set device_id = %s where company = 'ZZ CO'" % q(D1))
    opened((D1, D2, D3), ["ZZ CO"])
    # 3 again: unlinking keeps the row
    r = rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, null, null)::text" % q(STAFF))
    ok(r.get("ok") is True and db.one("select count(*) from tally_member_bridges where user_id = %s and bridge_id is null" % q(STAFF)) == "1", "3. unlinking Ravi keeps his row (bridge null); nothing deleted")
    r = enq(STAFF, 21)
    ok(r.get("ok") is True and jrow(21)["t"] == "null", "4. unlinked, Ravi's posting goes to the computer's main bridge (%s)" % jrow(21))
finally:
    db.stop()
print("\nall checks passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
