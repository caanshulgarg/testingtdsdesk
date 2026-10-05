"""python3 run_migration55.py - migration-55-settle-and-lease (the owner's decisions B and D of 05-Oct-2026). On throwaway
PostgreSQL (pg_stand, port 30550; never a real database), built 32 -> ... -> 53 -> 54 in staging's order, then 55 (twice).
Checks:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), no 'delete from' anywhere, add-only, no real
     database named; it runs twice; nothing deleted.
  B. any member who may write (owner or staff) settles a posting whose result is uncertain, a reason required, the name and
     time kept: "Mark posted" (tally_post_job_mark_posted, a Tally voucher id) and "Not in Tally - post again"
     (tally_post_settle_ask: a check for the bridge). A viewer is refused. The id is released (and the posting sent
     again) ONLY when the posting's own bridge reports "checked, not found" for that exact company
     (tally_post_check_report, the service role): found -> marked posted with the voucher found, nothing sent; Tally
     not asked (busy, closed, silent) -> still waiting, the words kept, never sent; another company or another bridge ->
     refused. tally_post_id_release_owner without such a check is refused (owner or staff); Retry before it is refused
     by the resend guard (36b).
  D. the company lease marks its purpose (post / read): a posting that finds the lease held by another bridge's read
     records "want to post"; the reader sees it on its renewal and yields: the lease goes to the posting bridge (handed
     over, never cut); a posting never yields (to a read or a posting); two postings serialize; a lease given up by the
     reader is kept for the waiting posting; an older bridge (no purpose, the 6-argument call) is never asked to yield.
Prints md5(pg_get_functiondef) of every function of the file.
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess, datetime, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql")]
M55 = os.environ.get("M55_FILE") or os.path.join(SQLDIR, "migration-55-settle-and-lease.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER, STAFF, VIEWER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777"
D1, D2 = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002"
STAFF3 = "33333333-3333-3333-3333-333333333333"   # Durgesh, staff: not the asker
B1, B2 = "go-aaaa000001", "go-bbbb000002"
BOOK = "b0000000-0000-0000-0000-000000000055"
J = lambda n: "%08d-0000-0000-0000-000000005555" % n
def vch(i, date="20260705"): return {"id": i, "xml": "<VOUCHER VCHTYPE=\"Purchase\"><DATE>%s</DATE><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><NARRATION>TDSDesk:%s | Bill</NARRATION></VOUCHER>" % (date, i)}

text = open(M55).read() if os.path.exists(M55) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M55))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included): %d" % low.count("delete from"))
ok(not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\bdrop\b", low), "0. add-only (no drop, no truncate)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(all(re.search(r"function public\.%s\([^)]*\)[^$]*security definer set search_path (=|to) 'public', 'pg_temp'|function public\.%s\([^)]*\)[^$]*security definer set search_path = public, pg_temp" % (f, f), text, re.S) for f in FNS), "0. every function security definer, search_path public, pg_temp (%s)" % FNS)

db = pg_stand.start(30550)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def as_user(uid, stmt):
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def rpcj(uid, stmt):
    good, out = as_user(uid, stmt)
    if not good: return {"_error": out[-400:]}
    try: return json.loads(out)
    except (TypeError, ValueError): return {"_error": out}
def svc(stmt):
    try: return json.loads(db.one(stmt))
    except RuntimeError as e: return {"_error": str(e)[-400:]}
def counts(): return {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_post_jobs", "tally_devices", "members", "tally_post_ids", "tally_post_marks", "tally_company_lease"]}
def jrow(n): return (db.rows("select status, coalesce(checking, false)::text as checking, coalesce(message, '') as message from tally_post_jobs where id = %s" % q(J(n))) or [{}])[0]
def idrow(n, i): return (db.rows("select live::text, coalesce(released_by, '') as released_by, coalesce(released_why, '') as why, accepted_at is not null as acc from tally_post_ids where job_id = %s and fincom_id = %s" % (q(J(n)), q(i))) or [{}])[0]
def marks(n): return db.rows("select action, coalesce(vch, '') as vch, coalesce(note, '') as note, by_user::text as by from tally_post_marks where job_id = %s order by id" % q(J(n)))
def item(n, i): return json.loads(db.one("select coalesce((select x::text from jsonb_array_elements(coalesce(items, '[]'::jsonb)) x where x->>'id' = %s limit 1), '{}') from tally_post_jobs where id = %s" % (q(i), q(J(n)))))
def accepted_job(n, i):
    """a posting Tally accepted (CREATED, voucher id) but nobody confirmed: done + checking, the entry unknown"""
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, %s, 1, 'running')"
           % (q(J(n)), q(F), q(D1), q(json.dumps({"vouchers": [vch(i)]}))))
    db.one("select tally_post_id_accept(%s::uuid, %s, '26298')::text" % (q(J(n)), q(i)))
    db.sql("update tally_post_jobs set status = 'done', checking = true, results = %s, items = %s, message = 'being checked' where id = %s"
           % (q(json.dumps([{"id": i, "ok": False, "accepted": True, "outcomeUnknown": True, "lastVchId": "26298", "message": "Tally replied 'created' (voucher id 26298)"}])),
              q(json.dumps([{"id": i, "state": "unknown", "accepted": True}])), q(J(n))))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    NOW = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    br = lambda *ids: q(json.dumps({"bridges": {i: {"at": NOW, "computer": "NW144", "user": u, "mode": "main", "open": ["ZZ CO"]} for i, u in ids}}))
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true), (%(S)s, %(F)s, 'Ravi', 'staff', true), (%(V)s, %(F)s, 'Vina', 'viewer', true);
      insert into tally_devices (id, firm_id, name, key_hash, version, info) values (%(D1)s, %(F)s, 'NW144 · anshul', 'h1', '2.3.0', %(I1)s), (%(D2)s, %(F)s, 'NW144 · ravi', 'h2', '2.3.0', %(I2)s);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(BK)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"postTo": "ZZ CO"}');""" % {"F": q(F), "O": q(OWNER), "S": q(STAFF), "V": q(VIEWER), "D1": q(D1), "D2": q(D2),
        "I1": br((B1, "anshul")), "I2": br((B2, "ravi")), "BK": q(BOOK)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""create table if not exists tally_companies (firm_id uuid, company text, client_id text, device_id uuid, last_seen timestamptz, book_id uuid, gstin text, linked_at timestamptz);
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen) values (%s, 'ZZ CO', 'c1', %s, now());""" % (q(F), q(D1)))
    # what is there before 55: a lease held, a posting accepted and unconfirmed
    db.one("select tally_lease_take(%s, %s, 'go-old0000001', null, 120, '{\"computer\": \"PC-OLD\"}')::text" % (q(F), q(BOOK)))
    accepted_job(1, "K1")
    before = counts()
    for rnd in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "0. pass %d: migration 55 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
        ok(counts() == before, "0. pass %d: nothing deleted, nothing added (%s)" % (rnd, counts()))
    md5s = {}
    for f in FNS:
        for row in db.rows("select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as m from pg_proc p where p.proname = %s and p.pronamespace = 'public'::regnamespace order by 1" % q(f)):
            md5s[row["sig"]] = row["m"]
    for k in sorted(md5s): print("  md5 %s  %s" % (md5s[k], k))

    # ---------------------------------------------------------------- B. Mark posted: any member who may write
    r = rpcj(VIEWER, "select tally_post_job_mark_posted(%s::uuid, 'K1', '26298', 'seen in the Day Book')::text" % q(J(1)))
    ok("_error" in r, "B1. a viewer cannot mark an entry posted (%s)" % r)
    r = rpcj(STAFF, "select tally_post_job_mark_posted(%s::uuid, 'K1', '26298', '')::text" % q(J(1)))
    ok("_error" in r and "reason" in r["_error"].lower(), "B1. a reason is required (%s)" % r.get("_error", r)[-160:])
    r = rpcj(STAFF, "select tally_post_job_mark_posted(%s::uuid, 'K1', '26298', 'seen in the Day Book')::text" % q(J(1)))
    ok(r.get("ok") is True and jrow(1)["status"] == "done" and item(1, "K1").get("state") == "in_tally", "B1. staff (Ravi) marks K1 posted with Tally's voucher id: done, in Tally (%s | %s)" % (r, jrow(1)))
    m = marks(1)
    ok(m and m[-1]["action"] == "posted" and m[-1]["by"] == STAFF and m[-1]["vch"] == "26298" and m[-1]["note"] == "seen in the Day Book" and "Ravi" in item(1, "K1").get("by", ""),
       "B1. the name and time are kept: a tally_post_marks row by Ravi, the item says by Ravi (%s | %s)" % (m, item(1, "K1")))

    # ---------------------------------------------------------------- B. release without a 'not found' check is refused
    accepted_job(2, "K2")
    for who, uid in (("the owner", OWNER), ("staff", STAFF)):
        r = rpcj(uid, "select tally_post_id_release_owner(%s::uuid, 'K2', 'not in the Day Book')::text" % q(J(2)))
        ok("_error" in r and "checked" in r["_error"].lower() and idrow(2, "K2")["live"] == "true", "B2. %s's release without the bridge's 'not found' check is refused; the id stays live (%s)" % (who, r.get("_error", r)[-200:]))
    good, out = as_user(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J(2)))
    ok(jrow(2)["status"] != "waiting", "B2. Retry before the check: never sent again (the resend guard) (%s)" % out[-200:])
    # "Not in Tally - post again": a check for the bridge, nothing released, nothing sent
    r = rpcj(VIEWER, "select tally_post_settle_ask(%s::uuid, 'K2', 'not in the Day Book')::text" % q(J(2)))
    ok("_error" in r, "B3. a viewer cannot ask (%s)" % r.get("_error", r)[-120:])
    r = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K2', '')::text" % q(J(2)))
    ok("_error" in r and "reason" in r["_error"].lower(), "B3. a reason is required (%s)" % r.get("_error", r)[-120:])
    ask = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K2', 'not in the Day Book of 05-Jul')::text" % q(J(2)))
    ok(ask.get("ok") is True and ask.get("state") == "waiting" and ask.get("check") and idrow(2, "K2")["live"] == "true" and jrow(2)["status"] == "done",
       "B3. staff asks: a check waits for the bridge; nothing released, nothing sent (%s | %s)" % (ask, idrow(2, "K2")))
    again = rpcj(OWNER, "select tally_post_settle_ask(%s::uuid, 'K2', 'again')::text" % q(J(2)))
    ok(again.get("check") == ask.get("check"), "B3. asked again: the same check (%s)" % again)
    CK = ask.get("check")
    row = db.rows("select asked_by::text as by, why, state, asked_at is not null as at from tally_post_checks where id = %s" % CK)[0]
    ok(row == {"by": STAFF, "why": "not in the Day Book of 05-Jul", "state": "waiting", "at": "t"}, "B3. the check keeps who asked, when and why (%s)" % row)
    good, out = as_user(STAFF, "select count(*) from tally_post_checks")
    ok(good and out == "1", "B3. members read their firm's checks (%s)" % out)
    # the bridge's list
    lst = svc("select tally_post_checks_for(%s::uuid, %s, true)::text" % (q(D1), q(B1)))
    ok(isinstance(lst, list) and len(lst) == 1 and lst[0].get("check") == CK and lst[0].get("company") == "ZZ CO" and "TDSDesk:K2" in lst[0].get("xml", "") and lst[0].get("entry") == "K2",
       "B4. the posting's bridge lists the check with the company and the entry's voucher (%s)" % lst)
    ok(lst and lst[0].get("vchId") == "26298", "B4. with Tally's voucher id from the posting's result (its reply held this one entry), for an entry with no number (%s)" % (lst[0].get("vchId") if lst else lst))
    ok(svc("select tally_post_checks_for(%s::uuid, %s, false)::text" % (q(D1), q(B1))) == [], "B4. a bridge that is not the main one (and not named) lists none")
    ok(svc("select tally_post_checks_for(%s::uuid, %s, true)::text" % (q(D2), q(B2))) == [], "B4. another computer lists none")
    for fn in ("tally_post_checks_for(uuid, text, boolean)", "tally_post_check_report(bigint, uuid, text, boolean, text, text, text, text, text)"):
        ok(db.one("select has_function_privilege('authenticated', 'public.%s', 'execute')" % fn) == "f", "B4. %s: not for signed-in users (the service role, tally-ingest)" % fn.split("(")[0])
    rep = lambda ck, res, co="ZZ CO", vch="", master="", words="", dev=D1, bridge=B1, main=True: svc("select tally_post_check_report(%s, %s::uuid, %s, %s, %s, %s, %s, %s, %s)::text" % (ck, q(dev), q(bridge), "true" if main else "false", q(co), q(res), q(vch), q(master), q(words)))
    # Tally could not be asked: waits, said in plain words, never sent
    r = rep(CK, "unable", words="Tally is busy; it is asked again by itself")
    st = db.rows("select state, tries::text, coalesce(last_words, '') as w from tally_post_checks where id = %s" % CK)[0]
    ok(r.get("state") == "waiting" and st == {"state": "waiting", "tries": "1", "w": "Tally is busy; it is asked again by itself"} and idrow(2, "K2")["live"] == "true" and jrow(2)["status"] == "done",
       "B5. Tally not asked (busy): the check waits with the words, nothing released or sent (%s | %s)" % (r, st))
    r = rep(CK, "notseen", co="OTHER CO")
    ok(("_error" in r or r.get("ok") is False) and idrow(2, "K2")["live"] == "true" and db.one("select state from tally_post_checks where id = %s" % CK) == "waiting",
       "B6. 'not seen' in another company: refused, nothing released (%s)" % r)
    r = rep(CK, "notseen", dev=D2, bridge=B2)
    ok(("_error" in r or r.get("ok") is False) and idrow(2, "K2")["live"] == "true", "B7. 'not seen' from another bridge: refused (%s)" % r)
    r = rep(CK, "notseen", bridge=B1, main=False)
    ok(("_error" in r or r.get("ok") is False) and idrow(2, "K2")["live"] == "true", "B7. 'not seen' from a bridge that may not post this posting: refused (%s)" % r)
    # the owner's rule: Tally answered for ZZ CO and has no such voucher that day ("not seen"): the report NEVER releases;
    # nothing is sent until a member confirms after looking in Tally (tally_post_check_confirm, a reason required)
    r = rep(CK, "notseen", co="zz co", words="Tally has no voucher Purchase B-1 on 05-07-2026 in ZZ CO")
    ok(r.get("ok") is True and r.get("state") == "notseen" and not r.get("resent") and idrow(2, "K2")["live"] == "true" and jrow(2)["status"] == "done" and db.one("select state from tally_post_checks where id = %s" % CK) == "notseen",
       "B8. the bridge saw nothing that day: the check says 'not seen'; nothing released, nothing sent (%s | %s)" % (r, jrow(2)))
    r = rep(CK, "notfound", co="zz co")
    ok(idrow(2, "K2")["live"] == "true" and jrow(2)["status"] == "done", "B8. no report ever releases (an older word 'notfound' too) (%s)" % r)
    CONF = lambda uid, n, i, why: rpcj(uid, "select tally_post_check_confirm(%s::uuid, %s, %s)::text" % (q(J(n)), q(i), q(why)))
    ok(db.one("select has_function_privilege('anon', 'public.tally_post_check_confirm(uuid, text, text)', 'execute')") == "f", "B8. the confirm is for signed-in members only")
    r = CONF(VIEWER, 2, "K2", "looked")
    ok("_error" in r and idrow(2, "K2")["live"] == "true", "B8. a viewer cannot confirm (%s)" % str(r)[-120:])
    r = CONF(STAFF, 2, "K2", "")
    ok("_error" in r and "reason" in r["_error"].lower() and idrow(2, "K2")["live"] == "true", "B8. a reason is required (%s)" % str(r)[-120:])
    r = CONF(STAFF, 2, "K2", "searched TDSDesk:K2 in the Day Book: not there")
    ir = idrow(2, "K2"); m = marks(2)
    jj = db.rows("select status, coalesce(target_bridge, '-') as t, coalesce(resend_only::text, '-') as ro from tally_post_jobs where id = %s" % q(J(2)))[0]
    ok(r.get("ok") is True and ir["live"] == "false" and ir["released_by"] == "owner" and jj == {"status": "waiting", "t": B1, "ro": '["K2"]'},
       "B8. 'I looked in Tally: not there - post again': released, waits again for the bridge that looked, only that entry (%s | %s | %s)" % (r, ir, jj))
    cf = db.rows("select state, confirmed_by::text as by, confirmed_at is not null as at, coalesce(confirmed_why, '') as why from tally_post_checks where id = %s" % CK)[0]
    ok(m and m[-1]["action"] == "released" and m[-1]["by"] == STAFF and "searched TDSDesk:K2" in m[-1]["note"] and cf == {"state": "confirmed", "by": STAFF, "at": "t", "why": "searched TDSDesk:K2 in the Day Book: not there"},
       "B8. kept in Ravi's name with his reason and the time (%s | %s)" % (m[-1:], cf))
    r = CONF(STAFF, 2, "K2", "again")
    ok("_error" in r or r.get("ok") is False, "B8. confirmed once: a second confirm is refused (%s)" % str(r)[-160:])
    r = rep(CK, "found", vch="26300")
    ok(db.one("select state from tally_post_checks where id = %s" % CK) == "confirmed" and jrow(2)["status"] == "waiting", "B8. a late second report changes nothing (%s)" % r)
    r = rpcj(OWNER, "select tally_post_id_release_owner(%s::uuid, 'K2', 'not in Tally')::text" % q(J(2)))
    ok(r.get("ok") is True, "B8. after the confirm, the release is allowed (already done) (%s)" % r)
    # found: marked posted with the voucher found, nothing sent
    accepted_job(3, "K3")
    ck3 = rpcj(OWNER, "select tally_post_settle_ask(%s::uuid, 'K3', 'not in the Day Book')::text" % q(J(3))).get("check")
    r = rep(ck3, "found", vch="26301", master="9911", words="found by its FinCom id")
    m = marks(3)
    ok(r.get("ok") is True and r.get("state") == "found" and jrow(3)["status"] == "done" and item(3, "K3").get("state") == "in_tally" and idrow(3, "K3")["live"] == "true",
       "B9. the bridge found the entry: marked posted, nothing released, nothing sent (%s | %s)" % (r, jrow(3)))
    ok(m and m[-1]["action"] == "posted" and m[-1]["vch"] == "26301" and m[-1]["by"] == OWNER, "B9. with the voucher found, in the asker's name (%s)" % m)
    # a posting still going on: not asked
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, %s, 1, 'running')" % (q(J(4)), q(F), q(D1), q(json.dumps({"vouchers": [vch("K4")]}))))
    r = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K4', 'not there')::text" % q(J(4)))
    ok("_error" in r or r.get("ok") is False, "B10. a posting still being sent cannot be asked about (%s)" % r)
    r = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K1', 'deleted in Tally by hand')::text" % q(J(1)))
    ok(r.get("ok") is True and r.get("state") == "waiting" and idrow(1, "K1")["live"] == "true", "B11. an entry marked posted (deleted in Tally by hand since) is asked about the same way: a check, nothing released (%s)" % r)

    # ---------------------------------------------------------------- the final review of 2.3.0
    B5 = "go-eeee000005"   # meena's bridge reporting through anshul's key D1 (1.15.0's settings carried over): another Windows user
    db.sql("update tally_devices set info = jsonb_set(info, '{bridges,%s}', %s::jsonb) where id = %s" % (B5, q(json.dumps({"at": NOW, "computer": "NW144", "user": "meena", "mode": "main", "open": ["ZZ CO"]})), q(D1)))
    def taken_job(n, i, by, target=None):
        accepted_job(n, i)
        db.sql("update tally_post_jobs set taken_by = %s, target_bridge = %s where id = %s" % ("null" if by is None else q(by), "null" if target is None else q(target), q(J(n))))
    listed = lambda dev, b, main=True: [x.get("check") for x in svc("select tally_post_checks_for(%s::uuid, %s, %s)::text" % (q(dev), q(b), "true" if main else "false"))]
    ckstate = lambda ck: db.rows("select state, tries::text, coalesce(words, '') as words, coalesce(last_words, '') as lw from tally_post_checks where id = %s" % ck)[0]
    # M1: the check and the re-send go only to the bridge that TOOK the posting
    taken_job(10, "K10", B1)
    ck10 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K10', 'not in the Day Book')::text" % q(J(10))).get("check")
    ok(ck10 in listed(D1, B1) and ck10 not in listed(D1, B5), "final M1. the check goes to the bridge that took the posting (anshul's), not to another Windows user's bridge on the same key (%s | %s)" % (listed(D1, B1), listed(D1, B5)))
    r = rep(ck10, "notseen", bridge=B5)
    ok((r.get("ok") is False or "_error" in r) and idrow(10, "K10")["live"] == "true" and ckstate(ck10)["state"] == "waiting", "final M1. that other bridge cannot answer it (%s)" % r)
    r = rep(ck10, "notseen", bridge=B1, words="Tally has no voucher with id 26298 on 05-07-2026 in ZZ CO")
    ok(r.get("state") == "notseen" and jrow(10)["status"] == "done", "final M1. the taking bridge saw nothing: nothing sent yet (%s)" % r)
    r = CONF(STAFF, 10, "K10", "not in the Day Book")
    jj = db.rows("select status, coalesce(target_bridge, '-') as t, coalesce(resend_only::text, '-') as ro from tally_post_jobs where id = %s" % q(J(10)))[0]
    ok(r.get("ok") is True and jj == {"status": "waiting", "t": B1, "ro": '["K10"]'},
       "final M1. confirmed after the taking bridge's 'not seen': waits again FOR THAT BRIDGE, naming only the released entry (%s | %s)" % (r, jj))
    ok([x["id"] for x in db.rows("select id::text from tally_post_take_for(%s::uuid, %s, true)" % (q(D1), q(B5)))] == [] and jrow(10)["status"] == "waiting", "final M1. another Windows user's bridge on the same key does not take the re-send")
    got = []
    for _ in range(5): got += db.rows("select id::text, coalesce(resend_only::text, '-') as ro from tally_post_take_for(%s::uuid, %s, true)" % (q(D1), q(B1)))
    ok({"id": J(10), "ro": '["K10"]'} in got, "final M1. the taking bridge takes it, with the one entry to send (%s)" % got)
    # a posting with no record of who took it (older): only the key's main bridge
    taken_job(11, "K11", None)
    ck11 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K11', 'not there')::text" % q(J(11))).get("check")
    db.sql("update tally_devices set main_bridge = %s where id = %s" % (q(B1), q(D1)))
    ok(ck11 in listed(D1, B1) and ck11 not in listed(D1, B5, True), "final M1. no record: only the key's main bridge lists it, even if told it is main (%s)" % listed(D1, B5, True))
    r = rep(ck11, "notseen", bridge=B5, main=True)
    ok((r.get("ok") is False or "_error" in r) and ckstate(ck11)["state"] == "waiting", "final M1. ... and only it may answer (%s)" % r)
    db.sql("update tally_devices set main_bridge = null where id = %s" % q(D1))
    # M2: Mark posted supersedes a waiting check; a check never releases an entry marked posted after it was asked
    taken_job(12, "K12", B1)
    ck12 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K12', 'not in the Day Book')::text" % q(J(12))).get("check")
    rpcj(OWNER, "select tally_post_job_mark_posted(%s::uuid, 'K12', '26310', 'found it in the Day Book')::text" % q(J(12)))
    ok(ckstate(ck12)["state"] == "superseded", "final M2. Mark posted: the waiting check is superseded (the row kept) (%s)" % ckstate(ck12))
    r = rep(ck12, "notseen", bridge=B1)
    r2 = CONF(STAFF, 12, "K12", "not there")
    ok(idrow(12, "K12")["live"] == "true" and jrow(12)["status"] == "done" and ckstate(ck12)["state"] == "superseded" and ("_error" in r2 or r2.get("ok") is False), "final M2. a late 'not seen' and a confirm release nothing (%s | %s)" % (r, str(r2)[-160:]))
    taken_job(13, "K13", B1)
    ck13 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K13', 'not in the Day Book')::text" % q(J(13))).get("check")
    db.sql("insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user, at) values (%s, %s, 'K13', 'posted', '26311', 'marked', %s, now() + interval '1 second')" % (q(F), q(J(13)), q(OWNER)))
    r = rep(ck13, "notseen", bridge=B1)
    r2 = CONF(STAFF, 13, "K13", "not there")
    ok(("_error" in r2 or r2.get("ok") is False) and idrow(13, "K13")["live"] == "true" and jrow(13)["status"] == "done", "final M2. a posted mark newer than the check: the confirm is refused, never released (%s | %s)" % (r, str(r2)[-160:]))
    taken_job(19, "K19", B1)
    ck19 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K19', 'not there')::text" % q(J(19))).get("check")
    rep(ck19, "notseen", bridge=B1)
    rpcj(OWNER, "select tally_post_job_mark_posted(%s::uuid, 'K19', '26312', 'it is there on 06-Jul')::text" % q(J(19)))
    r2 = CONF(STAFF, 19, "K19", "not there")
    ok(ckstate(ck19)["state"] == "superseded" and ("_error" in r2 or r2.get("ok") is False) and idrow(19, "K19")["live"] == "true", "final M2. 'not seen', then marked posted: the check is closed; the confirm refused (%s)" % str(r2)[-160:])
    # withdraw: the asker or an owner
    taken_job(14, "K14", B1)
    ck14 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K14', 'not there')::text" % q(J(14))).get("check")
    r = rpcj(VIEWER, "select tally_post_check_withdraw(%s, 'changed my mind')::text" % ck14)
    ok("_error" in r and ckstate(ck14)["state"] == "waiting", "final M2. a viewer cannot withdraw a check (%s)" % str(r)[-160:])
    db.sql("insert into members values (%s, %s, 'Durgesh', 'staff', true) on conflict do nothing" % (q(STAFF3), q(F)))
    r = rpcj(STAFF3, "select tally_post_check_withdraw(%s, 'not mine')::text" % ck14)
    ok("_error" in r and ckstate(ck14)["state"] == "waiting", "final M2. another staff member (not the asker) cannot (%s)" % str(r)[-160:])
    r = rpcj(STAFF, "select tally_post_check_withdraw(%s, 'found it myself')::text" % ck14)
    w14 = db.rows("select state, withdrawn_by::text as by, withdrawn_at is not null as at, coalesce(withdrawn_why, '') as why from tally_post_checks where id = %s" % ck14)[0]
    ok(r.get("ok") is True and w14 == {"state": "withdrawn", "by": STAFF, "at": "t", "why": "found it myself"}, "final M2. the asker withdraws it: who, when and why kept (%s | %s)" % (r, w14))
    r = rep(ck14, "notseen", bridge=B1)
    r2 = CONF(STAFF, 14, "K14", "not there")
    ok(idrow(14, "K14")["live"] == "true" and jrow(14)["status"] == "done" and ck14 not in listed(D1, B1) and ("_error" in r2 or r2.get("ok") is False), "final M2. a withdrawn check is never handed out, nor answered, nor confirmed (%s | %s)" % (r, str(r2)[-120:]))
    taken_job(15, "K15", B1)
    ck15 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K15', 'not there')::text" % q(J(15))).get("check")
    r = rpcj(OWNER, "select tally_post_check_withdraw(%s, 'asked by mistake')::text" % ck15)
    ok(r.get("ok") is True and ckstate(ck15)["state"] == "withdrawn", "final M2. an owner withdraws anyone's (%s)" % r)
    # M4: given up after 10 unable tries, or 24 hours; handed out fairly (last tried last)
    taken_job(16, "K16", B1); taken_job(17, "K17", B1); taken_job(18, "K18", B1)
    ck16 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K16', 'not there')::text" % q(J(16))).get("check")
    ck17 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K17', 'not there')::text" % q(J(17))).get("check")
    ck18 = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K18', 'not there')::text" % q(J(18))).get("check")
    for _ in range(9): rep(ck16, "unable", bridge=B1, words="Tally may have numbered this entry itself")
    l = listed(D1, B1)
    ok(l.index(ck17) < l.index(ck16) and l.index(ck18) < l.index(ck16), "final M4. a check never tried comes before one tried (fair: last tried last) (%s)" % l)
    r = rep(ck16, "unable", bridge=B1, words="Tally may have numbered this entry itself")
    st16 = ckstate(ck16)
    ok(r.get("state") == "given_up" and st16["state"] == "given_up" and st16["tries"] == "10" and "Mark posted" in st16["words"] and "look" in st16["words"].lower() and ck16 not in listed(D1, B1) and idrow(16, "K16")["live"] == "true",
       "final M4. after 10 unable tries: given up, in plain words; no longer handed out; never released (%s | %s)" % (r, st16))
    db.sql("update tally_post_checks set asked_at = now() - interval '25 hours' where id = %s" % ck17)
    l = listed(D1, B1)
    st17 = ckstate(ck17)
    ok(ck17 not in l and st17["state"] == "given_up" and "24 hours" in st17["words"] and idrow(17, "K17")["live"] == "true", "final M4. waiting for 24 hours: given up the same way (%s | %s)" % (l, st17))
    r = rep(ck16, "notseen", bridge=B1)
    r2 = CONF(STAFF, 16, "K16", "not there")
    ok(idrow(16, "K16")["live"] == "true" and ckstate(ck16)["state"] == "given_up" and ("_error" in r2 or r2.get("ok") is False), "final M4. a given-up check releases nothing later, nor can it be confirmed (%s)" % r)
    again = rpcj(STAFF, "select tally_post_settle_ask(%s::uuid, 'K16', 'asked again after looking')::text" % q(J(16)))
    ok(again.get("ok") is True and again.get("check") not in (None, ck16), "final M4. a member may ask again: a new check (%s)" % again)

    # ---------------------------------------------------------------- D. the lease: purpose, want to post, yield
    take = lambda holder, purpose, dev="null": svc("select tally_lease_take(%s, %s, %s, %s, 120, %s, %s)::text" % (q(F), q(BOOK), q(holder), dev if dev == "null" else q(dev) + "::uuid", q(json.dumps({"computer": "PC-" + holder[-1]})), "null" if purpose is None else q(purpose)))
    take6 = lambda holder: svc("select tally_lease_take(%s, %s, %s, null, 120, %s)::text" % (q(F), q(BOOK), q(holder), q(json.dumps({"computer": "PC-" + holder[-1]}))))
    rel = lambda holder: svc("select tally_lease_release(%s, %s, %s)::text" % (q(F), q(BOOK), q(holder)))
    lease = lambda: db.rows("select holder, coalesce(purpose, '') as purpose, coalesce(want_post_by, '') as want from tally_company_lease where book_id = %s" % q(BOOK))[0]
    rel("go-old0000001")
    r = take("go-read00000a", "read")
    ok(r.get("held") is False and lease()["purpose"] == "read", "D1. a bridge takes the lease to read: purpose read (%s)" % lease())
    r = take("go-post00000b", "post")
    ok(r.get("held") is True and r.get("wanted") is True and lease()["want"] == "go-post00000b", "D2. a posting finds it held for a read: waits, its 'want to post' recorded (%s | %s)" % (r, lease()))
    r = take("go-post00000c", "read")
    ok(r.get("held") is True and lease()["holder"] == "go-read00000a", "D2. another read is held off (%s)" % r)
    r = take("go-read00000a", "read")
    ok(r.get("held") is True and r.get("yield") is True and lease()["holder"] == "go-post00000b" and lease()["purpose"] == "post" and lease()["want"] == "",
       "D3. the reader's renewal sees the want and yields: the lease goes to the posting bridge (%s | %s)" % (r, lease()))
    r = take("go-post00000b", "post")
    ok(r.get("held") is False, "D3. the posting bridge takes it (its own now) (%s)" % r)
    r = take("go-read00000a", "read")
    ok(r.get("held") is True and lease()["holder"] == "go-post00000b", "D4. the reader waits while the posting goes (%s)" % r)
    r = take("go-post00000c", "post")
    ok(r.get("held") is True and not r.get("wanted") and lease()["want"] == "", "D5. a second posting waits for the first (serialized), no want recorded (%s | %s)" % (r, lease()))
    r = take("go-post00000b", "post")
    ok(r.get("held") is False and lease()["holder"] == "go-post00000b", "D5. a posting never yields: renewed (%s)" % r)
    rel("go-post00000b")
    r = take("go-read00000a", "read")
    ok(r.get("held") is False and lease()["holder"] == "go-read00000a", "D6. released: reading resumes (%s)" % r)
    # a lease the reader gives up is kept for the posting that wants it
    take("go-post00000c", "post")
    rel("go-read00000a")
    r = take("go-read00000d", "read")
    ok(r.get("held") is True and lease()["want"] == "go-post00000c", "D7. the reader gave the lease up: another read does not take it while a posting wants it (%s | %s)" % (r, lease()))
    r = take("go-post00000c", "post")
    ok(r.get("held") is False and lease()["holder"] == "go-post00000c" and lease()["want"] == "", "D7. the posting takes it (%s)" % lease())
    rel("go-post00000c")
    # an older bridge (no purpose): never asked to yield
    r = take6("go-old0000001")
    ok(r.get("held") is False and lease()["purpose"] == "", "D8. an older bridge takes it with no purpose (%s)" % lease())
    r = take("go-post00000b", "post")
    ok(r.get("held") is True and not r.get("wanted"), "D8. a posting waits for an older bridge's turn (no want: it would not see it) (%s)" % r)
    r = take6("go-old0000001")
    ok(r.get("held") is False and lease()["holder"] == "go-old0000001", "D8. the older bridge's renewal: still its own (%s)" % r)
    rel("go-old0000001")
    ok(db.one("select has_function_privilege('authenticated', 'public.tally_lease_take(uuid, uuid, text, uuid, integer, jsonb, text)', 'execute')") == "f", "D9. the lease is for the service role only")
    ok(counts()["tally_company_lease"] == 1, "D9. the lease row is kept (one per company), nothing removed")
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
