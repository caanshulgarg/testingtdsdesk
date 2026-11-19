"""python3 run_migration202.py - server/tally-cloud/migration-202-post-recheck.sql (19-Nov-2026, branch next-fix-posttimeout).
The owner: an entry that needs review is rechecked against Tally by itself, then marked posted or sent again; never a double
entry; an entry only ever posted into the company its client is linked to (by its GUID). On a throwaway PostgreSQL
(post_queue_stand: pg_stand, port 31203 unless PG202R_PORT; never a real database), 184, 185 as on staging, then 199, 200,
201 and 202 applied together in one session; made-up firms, entries and Day Book vouchers only.
  0. the file: one transaction, lock_timeout 10 s, add-only, every function granted explicitly, refuses to run without 201,
     runs twice
  A. read back by narration (the recorder's match): marked posted by itself
  B. its narration edited in Tally: found by content in FinCom's read of the Day Book (day, type, amount, party, number)
  C. two vouchers like it: found, a person picks; nothing released or sent
  D. a voucher of the same day and amount but another type: kept for a person, never sent
  E. Tally created it in another company (wrongCompany): needs review, said plainly, never sent
  F. sent again only when every proof holds: the bridge's check "not seen" since it needed review, no voucher like it, FinCom's
     read complete since the posting, nothing of Tally's says it took it; each proof missing on its own: not sent
  G. the bridge's check "found": marked posted (55's path), the recheck closes
  H. a day of rechecks: left to a person in words
  I. never twice, every path again: the entry sent again is its posting's (a new posting refused, the queue's guard, a
     Retry), one posted elsewhere meanwhile is not handed back, a recheck run again sends nothing
  J. (the sixth review: the gate's own words cleared once it opens; words for no client or company; a posting put back by
     tally-ingest handed out again only after 30 s)
     the hand-out: a posting goes only to a bridge that reports the linked company's GUID open; the beat's count
     (tally_post_count_for) asks the same gate, and a posting it refuses says why in plain words (another company ID open,
     or the link has no company ID yet): never waits silently, never the name alone; never over another writer's words
     ('Started on', the 6-hour words, 'Rechecked by itself', 'Retry:'), never moving updated_at, never on a bridge that may
     not post, never a write on a beat that changes nothing
  K. the cron: idle is one look; due: the recheck in the run
  L. an entry whose date or amount cannot be read from the posting: never sent again, left to a person in words
  M. the beat's count timed: 1,000 waiting postings, the gate open and refused, against 185's own text asked by turns
     (15 each, medians): never slower, within this stand's noise (identical calls here vary 140-270 ms: at most 1.25 x + 30 ms);
     the gate asked once per company, not per posting
RED_WITHOUT_202=1: the same checks without the file (fails)."""
import os, re, sys, json, time, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, CO, OWNER, STAFF, DA, BA
RED = os.environ.get("RED_WITHOUT_202") == "1"
M = [os.path.join(PS.SQLDIR, f) for f in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql")]
M202 = os.path.join(PS.SQLDIR, "migration-202-post-recheck.sql")
M184, M185 = (os.path.join(PS.SQLDIR, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql"))
ME = "00000000-0000-0000-0000-000000000200"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
text = open(M202).read() if os.path.exists(M202) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M202), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code.replace("delete from tally_post_recheck_plans where job_id = p_job", "") and not re.search(r"\b(drop|truncate)\s", code) and code.count("create table") == 2 and code.count("create index if not exists") == 2 and "create trigger" not in code,
   "add-only: two tables, two indexes; nothing dropped, deleted or truncated; no trigger")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
FNS = ["tally_post_recheck_enroll()", "tally_post_recheck_any()", "tally_post_recheck_job(uuid)", "tally_post_recheck_step(uuid, text)", "tally_post_work_then(uuid, text)", "tally_post_recheck_run(uuid[])", "tally_post_work_due()", "tally_post_work()",
       "tally_post_linked_open(uuid, uuid, text)", "tally_post_linked_why(uuid, uuid, text)", "tally_post_linked_ok(uuid, text, text, uuid, text)", "tally_post_linked_why_for(uuid, text, text, uuid, text)", "tally_post_take_for(uuid, text, boolean)", "tally_post_count_for(uuid, text, boolean)"]
ok(all(("revoke all on function public.%s from public, anon, authenticated;" % s) in text and ("grant execute on function public.%s to service_role;" % s) in text for s in FNS)
   and sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == sorted(f.split("(")[0] for f in FNS)
   and "grant execute on procedure public.tally_post_work_run(integer) to service_role;" in text, "only these functions (and 201's procedure), each granted explicitly")
ok("raise exception 'migration 202 runs after 199, 200 and 201" in text, "never runs without 199, 200, 201")
ok("FinComVoucher" not in text and "<ENVELOPE>" not in text.upper(), "no new request to Tally")

st = PS.Stand(int(os.environ.get("PG202R_PORT") or 31203), extra=(M184, M185)); db = st.db
J = lambda n: "%08d-0000-0000-0000-000000000203" % n
try:
    m182 = open(os.path.join(PS.SQLDIR, "migration-182-gap-after-post.sql")).read()
    t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
    f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
    db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
    r = st.psql_text(text)
    ok(r.returncode != 0 and "runs after 199, 200 and 201" in (r.stderr or ""), "without 201 first: refused (%s)" % (r.stderr or "").strip()[-120:])
    r = st.psql_text("\n".join(open(p).read() for p in M + ([] if RED else [M202])))
    ok(r.returncode == 0, "199, 200, 201%s applied together in one session %s" % ("" if RED else ", 202", (r.stderr or "").strip()[-300:]))
    if not RED:
        r = st.psql_text(text); ok(r.returncode == 0, "202 runs twice %s" % (r.stderr or "")[-200:])
    st.grants()
    st.setbeat(DA, st.beat("made-up-a", BA, [CO])); db.sql("update tally_devices set last_seen = now()")
    has = lambda f: db.one("select (to_regprocedure(%s) is not null)::text" % q(f)) == "true"
    def vx(x, party="Made-up Kite Supplies", amt="1250.00", vno=None, vtype="Payment", day="20261117"):
        return {"id": x, "xml": "<VOUCHER VCHTYPE=\"%s\"><DATE>%s</DATE>%s<PARTYLEDGERNAME>%s</PARTYLEDGERNAME><NARRATION>TDSDesk:%s</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><AMOUNT>-%s</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>"
                % (vtype, day, ("<VOUCHERNUMBER>%s</VOUCHERNUMBER>" % vno) if vno else "", party.replace("&", "&amp;"), x, party.replace("&", "&amp;"), amt)}
    def posting(n, vs, results=None, items=None):   # a posting its bridge had, settled (done), its entries uncertain: the register says needs review
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, taken_by, taken_at, created_by) values (%s, %s, 'c1', %s, 'running', %d, %s, %s, %s, now() - interval '50 minutes', %s)"
               % (q(J(n)), q(F), q(CO), len(vs), q(json.dumps({"vouchers": vs})), q(DA), q(BA), q(STAFF)))
        res = results if results is not None else [{"id": v["id"], "kind": "voucher", "ok": False, "state": "sent", "outcomeUnknown": True, "message": "made-up: the reply was lost"} for v in vs]
        db.sql("update tally_post_jobs set status = 'done', checking = false, results = %s, items = %s, message = 'Done (made-up)', updated_at = now() - interval '40 minutes' where id = %s"
               % (q(json.dumps(res)), q(json.dumps(items if items is not None else [{"id": v["id"], "kind": "voucher", "state": "sent"} for v in vs])), q(J(n))))
        db.sql("insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, at) values (%s, %s, %s, %s, 100, 120, 0, now() - interval '20 minutes') on conflict (job_id) do nothing" % (q(F), q(PS.BK), q(J(n)), q(DA)))
        return [v["id"] for v in vs]
    def reg(x): return db.one("select state from tally_post_register where fincom_id = %s" % q(x))
    def read(complete=True):   # how far FinCom has read the company (the posting windows' a1 is 120)
        db.sql("insert into tally_sync_cursor (book_id, firm_id, start_at, match_start, match_alter, match_at) values (%s, %s, '2026-11-01', '2026-11-01', %d, now()) on conflict (book_id) do update set start_at = '2026-11-01', match_start = '2026-11-01', match_alter = excluded.match_alter, match_at = now()"
               % (q(PS.BK), q(F), 125 if complete else 110))
    def daybook(guid, vtype="Payment", vno="", party="Made-up Kite Supplies", amt=1250, narration="Paid (made-up, narration edited)", day="2026-11-17", fid=None):
        db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, narration%s) values (%s, %s, %s, %s, %s, %s, %s, %s%s)"
               % (", fincom_id" if fid else "", q(PS.BK), q(F), q(guid), q(day), q(vtype), q(vno), q(party), q(narration), (", " + q(fid)) if fid else ""))
        db.sql("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values (%s, %s, %s, %s, %s, %s), (%s, %s, %s, %s, 'Made-up Bank', %s)"
               % (q(PS.BK), q(F), q(guid), q(day), q(party), -amt, q(PS.BK), q(F), q(guid), q(day), amt))
    def svc(sql_):
        try: return json.loads(db.one("set role service_role; select %s::text" % sql_) or "null")
        except RuntimeError as x_:
            if RED: return {}
            raise
    def due(n):
        if RED: return
        db.sql("update tally_post_rechecks set next_at = now() - interval '1 second' where job_id = %s and state = 'open'" % q(J(n)))
    def recheck(n):   # the cron's piece for this posting, and its follow-up (the hand-back, else the register)
        svc("tally_post_recheck_enroll()"); due(n)
        o = svc("tally_post_recheck_job(%s::uuid)" % q(J(n)))
        if o and o.get("resend"): svc("tally_post_work_then(%s::uuid, 'resend')" % q(J(n)))
        elif o and o.get("register"): svc("tally_post_work_then(%s::uuid, 'register')" % q(J(n)))
        return o or {}
    def rc(n, x):
        try: return json.loads(db.one("select to_jsonb(x)::text from tally_post_rechecks x where job_id = %s and fincom_id = %s" % (q(J(n)), q(x))) or "{}")
        except RuntimeError: return {}   # (RED_WITHOUT_202: no such table)
    def row(n): return json.loads(db.one("select (to_jsonb(j) - 'payload')::text from tally_post_jobs j where id = %s" % q(J(n))) or "null")
    def holders(x):
        live = (db.one("select coalesce(string_agg(job_id::text, ',' order by job_id), '') from tally_post_ids where fincom_id = %s and live" % q(x)) or "").split(",")
        rs = (db.one("select coalesce(string_agg(id::text, ',' order by id), '') from tally_post_jobs where status in ('waiting', 'taken', 'running') and resend_only ? %s" % q(x)) or "").split(",")
        return sorted(set(z for z in live + rs if z))
    def check_answer(n, x, result="notseen", vch="", mid=""):
        cid = db.one("select id from tally_post_checks where job_id = %s and entry_id = %s and state = 'waiting' order by id desc limit 1" % (q(J(n)), q(x)))
        if not cid: return None
        return svc("tally_post_check_report(%s, %s::uuid, %s, true, %s, %s, %s, %s, '')" % (cid, q(DA), q(BA), q(CO), q(result), q(vch), q(mid)))
    def close(*ns): db.sql("update tally_post_jobs set status = 'failed', checking = false where id = any(%s::uuid[])" % q("{" + ",".join(J(n) for n in ns) + "}"))
    def enq(jid, vs): return st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(jid), q(json.dumps({"masters": [], "vouchers": vs}))))

    print("== A. read back by narration: marked posted by itself")
    xa = posting(1, [vx("ra-1", amt="101.00")])[0]
    ok(reg(xa) == "needs_review", "the register: needs review (its reply lost)")
    db.sql("update tally_post_ids set matched_at = now(), matched_vch = 'V-77', matched_mid = '7077' where fincom_id = %s" % q(xa))
    o = recheck(1) if not RED else {}
    ok(o.get("posted") == 1 and reg(xa) == "in_tally" and rc(1, xa).get("state") == "posted", "found by FinCom's read-back: marked posted, the register in Tally (%s, %s)" % (o, reg(xa)))
    ok(holders(xa) == [J(1)] and not (row(1)["resend_only"] or []), "never sent again")

    print("== B. its narration edited in Tally: found by content in the Day Book")
    xb = posting(2, [vx("rb-1", amt="202.00", vno="88")])[0]
    daybook("g-rb-1", vno="88", amt=202, narration="Paid to Kite (narration edited by hand)")
    o = recheck(2) if not RED else {}
    r = row(2); res = next((x for x in r["results"] if x.get("id") == xb), {})
    ok(o.get("posted") == 1 and reg(xb) == "in_tally" and "Day Book" in (res.get("message") or "") and "88" in (rc(2, xb).get("words") or ""),
       "the same date, type, amount, party and number: marked posted (%s | %s)" % ((res.get("message") or "")[:120], rc(2, xb).get("words")))

    print("== C. two vouchers like it: found, a person picks")
    xc = posting(3, [vx("rc-1", amt="303.00")])[0]
    daybook("g-rc-1", amt=303); daybook("g-rc-2", amt=303)
    o = recheck(3) if not RED else {}
    ok(o.get("pick") == 1 and rc(3, xc).get("state") == "person" and "2 vouchers like it" in (rc(3, xc).get("words") or "") and reg(xc) == "needs_review" and holders(xc) == [J(3)],
       "needs a person to pick (%s); nothing released or sent" % rc(3, xc).get("words"))

    print("== D. the same day and amount, another type: kept, never sent")
    xd = posting(4, [vx("rd-1", amt="404.00")])[0]
    daybook("g-rd-1", vtype="Journal", amt=404)
    read(True)
    o = recheck(4) if not RED else {}
    check_answer(4, xd); o = recheck(4) if not RED else {}
    ok(o.get("kept") == 1 and o.get("released", 0) == 0 and rc(4, xd).get("state") == "open" and "same day and amount" in (rc(4, xd).get("words") or "") and holders(xd) == [J(4)],
       "kept for a person even with the bridge's 'not seen' and the read complete (%s)" % rc(4, xd).get("words"))

    print("== E. Tally created it in another company: needs review, never sent")
    xe = posting(5, [vx("re-1", amt="505.00")], results=[{"id": "re-1", "kind": "voucher", "ok": False, "state": "unknown", "outcomeUnknown": True, "wrongCompany": "Made-up Other Traders"}])[0]
    o = recheck(5) if not RED else {}
    ok(o.get("wrong") == 1 and rc(5, xe).get("state") == "person" and "Made-up Other Traders" in (rc(5, xe).get("words") or "") and "linked" in (rc(5, xe).get("words") or "") and holders(xe) == [J(5)],
       "said plainly (%s); never sent again" % rc(5, xe).get("words"))

    print("== F. sent again only when every proof holds")
    read(False)
    xf = posting(6, [vx("rf-1", amt="606.00")])[0]
    o = recheck(6) if not RED else {}
    ok(o.get("asked") == 1 and rc(6, xf).get("state") == "open", "first look: the bridge's check by narration asked by itself (%s)" % o)
    check_answer(6, xf, "notseen")
    o = recheck(6) if not RED else {}
    ok(o.get("released", 0) == 0 and holders(xf) == [J(6)], "'not seen', FinCom's read of Tally not complete: not sent")
    read(True)
    o = recheck(6) if not RED else {}; r = row(6)
    ok(o.get("released") == 1 and r["status"] == "waiting" and r["resend_only"] == [xf] and rc(6, xf).get("state") == "resent", "every proof holds: released, handed back by its posting alone (%s %s)" % (r["status"], r["resend_only"]))
    ok(holders(xf) == [J(6)], "sent by that posting only, once")
    # each proof missing on its own
    for n, x, why in ((7, "rf-acc", "stamped accepted"), (8, "rf-old", "the check answered before it needed review"), (9, "rf-like", "a voucher of the same day and amount")):
        posting(n, [vx(x, amt="7%02d.00" % n)])
        if why == "stamped accepted": db.one("set role service_role; select tally_post_id_accept(%s::uuid, %s, null)::text" % (q(J(n)), q(x)))
        if why == "a voucher of the same day and amount": daybook("g-" + x, vtype="Receipt", amt=700 + n)
        if why == "the check answered before it needed review":
            db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device, auto) values (%s, %s, %s, %s, %s, 'made-up', 'notseen', now() - interval '2 hours', %s, %s, true)"
                   % (q(F), q(J(n)), q(x), q(CO), q(ME), q(BA), q(DA)))
            db.sql("update tally_post_checks set asked_at = now() - interval '3 hours' where job_id = %s" % q(J(n)))
        recheck(n) if not RED else None
        if why != "the check answered before it needed review": check_answer(n, x, "notseen")
        o = recheck(n) if not RED else {}
        ok(o.get("released", 0) == 0 and row(n)["status"] == "done" and holders(x) == [J(n)] and rc(n, x).get("state") == "open",
           "%s: never sent again (%s)" % (why, rc(n, x).get("words")))
    ok(db.one("select count(*)::text from tally_post_checks where job_id = %s and state = 'waiting'" % q(J(8))) == "1", "the old answer: asked again by itself")

    print("== G. the bridge's check 'found': marked posted")
    xg = posting(10, [vx("rg-1", amt="1010.00", vno="91")])[0]
    recheck(10) if not RED else None
    a = check_answer(10, xg, "found", "91", "7091")
    o = recheck(10) if not RED else {}
    ok((a or {}).get("state") == "found" and reg(xg) == "in_tally" and rc(10, xg).get("state") in ("settled", "posted"), "found by the bridge: marked posted (%s, %s)" % (a, rc(10, xg).get("state")))

    print("== H. a day of rechecks: left to a person")
    xh = posting(11, [vx("rh-1", amt="1111.00")])[0]
    recheck(11) if not RED else None
    if not RED: db.sql("update tally_post_rechecks set since = now() - interval '25 hours' where job_id = %s; update tally_post_register set changed_at = now() - interval '25 hours' where fincom_id = %s" % (q(J(11)), q(xh)))
    o = recheck(11) if not RED else {}
    ok(rc(11, xh).get("state") == "person" and "a person must look" in (rc(11, xh).get("words") or "") and holders(xh) == [J(11)], "left to a person in words (%s)" % rc(11, xh).get("words"))

    print("== I. never twice, every path again")
    e = enq(J(20), [vx(xf, amt="606.00")])
    ok(e.get("ok") is False, "the entry sent again (F): a new posting of it refused (%s)" % (e.get("error") or "")[:100])
    try:
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', 1, %s, %s, %s)" % (q(J(21)), q(F), q(CO), q(json.dumps({"vouchers": [vx(xf)]})), q(DA), q(STAFF))); e2 = ""
    except RuntimeError as x_: e2 = str(x_)
    ok("Not queued" in e2 or "already being posted" in e2, "by any other way into the queue: refused (%s)" % e2.split("CONTEXT")[0][-120:])
    ok(recheck(6).get("released", 0) == 0 and holders(xf) == [J(6)], "a recheck run again: nothing more")
    close(6)
    if RED: ok(False, "I (RED_WITHOUT_202: the rest not run)")
    else:
        # posted elsewhere meanwhile (data from before this release): proven not in Tally, released, never handed back
        xi = posting(22, [vx("ri-1", amt="2222.00")])[0]
        recheck(22) if not RED else None; check_answer(22, xi, "notseen"); svc("tally_post_recheck_enroll()") if not RED else None; due(22)
        o = svc("tally_post_recheck_job(%s::uuid)" % q(J(22))) if not RED else {}
        db.sql("set session_replication_role = replica; insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', 1, %s, %s, %s);"
               "insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live) values (%s, 'c1', %s, %s, %s, true); set session_replication_role = origin;"
               % (q(J(23)), q(F), q(CO), q(json.dumps({"vouchers": [vx(xi)]})), q(DA), q(STAFF), q(F), q(xi), q(J(23)), q(xi)))
        o2 = svc("tally_post_settle_resend(%s::uuid)" % q(J(22))) if not RED else {}
        ok(o.get("released") == 1 and o2.get("resent") is False and holders(xi) == [J(23)], "released, then posted elsewhere before the hand-back: not handed back (%s)" % o2)
        close(22, 23)
        # a Retry of an older posting of the same entry, while it is owed
        xr = posting(24, [vx("rr-1", amt="2424.00")])[0]
        db.sql("set session_replication_role = replica; insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'failed', 1, %s, %s, %s);"
               "insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live) values (%s, 'c1', %s, %s, %s, false); set session_replication_role = origin;"
               % (q(J(25)), q(F), q(CO), q(json.dumps({"vouchers": [vx(xr)]})), q(DA), q(STAFF), q(F), q(xr), q(J(25)), q(xr)))
        recheck(24) if not RED else None; check_answer(24, xr, "notseen")
        db.sql("create or replace function t202_hold() returns trigger language plpgsql as $t$ begin if new.id = %s::uuid and new.status = 'waiting' then raise exception 'made-up: hand-back later'; end if; return new; end $t$;"
               "create trigger t202_hold before update on tally_post_jobs for each row execute function t202_hold();" % q(J(24)))
        o = recheck(24) if not RED else {}
        e = enq(J(25), [vx(xr)])
        ok(o.get("released") == 1 and e.get("ok") is False and holders(xr) == [], "released, its hand-back not done yet: a Retry of another posting holding it refused (%s)" % (e.get("error") or "")[:100])
        db.sql("drop trigger t202_hold on tally_post_jobs")
        svc("tally_post_settle_resend_due(5)")
        ok(holders(xr) == [J(24)] and row(24)["resend_only"] == [xr], "then handed back by the cron, by its own posting alone")
        close(24, 25)

    print("== J. the hand-out: only to a bridge that reports the linked company's GUID open")
    db.sql("update tally_post_jobs set status = 'failed' where status in ('waiting', 'taken', 'running')")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', 1, %s, %s, %s)" % (q(J(30)), q(F), q(CO), q(json.dumps({"vouchers": [vx("rj-1")]})), q(DA), q(STAFF)))
    take = lambda: db.one("set role service_role; select coalesce(string_agg(id::text, ','), '') from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA))) or ""
    count = lambda: db.one("set role service_role; select tally_post_count_for(%s::uuid, %s, true)::text" % (q(DA), q(BA)))
    msg = lambda: (row(30) or {}).get("message") or ""
    st.setbeat(DA, st.beat("made-up-a", BA, [CO], guid="ffffffff-0000-0000-0000-000000000202"))
    ok(count() == "0" if not RED else False, "the bridge has a company of that name open, another GUID: the beat counts nothing for it (%s)" % count())
    ok("not the linked one (different company ID)" in msg(), "the posting says why (%s)" % msg())
    ok(take() == "" if not RED else False, "and is handed nothing")
    st.setbeat(DA, st.beat("made-up-a", BA, [CO]))
    g0 = db.one("select company_guid from tally_links where firm_id = %s and client_id = 'c1'" % q(F))
    db.sql("update tally_links set company_guid = null where firm_id = %s and client_id = 'c1'" % q(F))
    ok(count() == "0" and "has no company ID yet" in msg(), "the link has no company ID yet: nothing counted, never the name alone; it says so (%s)" % msg())
    ok(take() == "", "and is handed nothing")
    db.sql("update tally_links set company_guid = %s where firm_id = %s and client_id = 'c1'" % (q(g0), q(F)))
    ok(count() == "1", "the linked company's GUID open: counted")
    ok(msg() == "" if not RED else False, "and the gate's own words cleared once it opens (%s)" % msg())
    # (the fifth review, B3) the gate's words never over another writer's, never moving updated_at; none on a bridge that may not post
    st.setbeat(DA, st.beat("made-up-a", BA, [CO], guid="ffffffff-0000-0000-0000-000000000202"))
    upd = lambda: db.one("select updated_at::text from tally_post_jobs where id = %s" % q(J(30)))
    ver = lambda: db.one("select row_version::text from tally_post_jobs where id = %s" % q(J(30)))
    for w in ("Started on SRV9 by made-up-a; held for that bridge", "Still waiting after 6 hours (since 19-Nov-2026 09:00 IST) for the FinCom Bridge", "Rechecked by itself on 19-Nov-2026: kept", "Retry: waiting for the Tally computer"):
        db.sql("update tally_post_jobs set message = %s, updated_at = now() - interval '3 hours' where id = %s" % (q(w), q(J(30))))
        u0 = upd(); count()
        ok(msg() == w and upd() == u0 if not RED else False, "another writer's words kept, updated_at not moved (%s...)" % w[:24])
    db.sql("update tally_post_jobs set message = '', updated_at = now() - interval '3 hours' where id = %s" % q(J(30)))
    u0 = upd(); count()
    ok("different company ID" in msg() and upd() == u0, "an empty message: the gate's words written, updated_at not moved")
    v0 = ver(); [count() for _ in range(3)]
    ok(ver() == v0, "beats that change nothing write nothing (row_version %s -> %s)" % (v0, ver()))
    db.sql("update tally_post_jobs set message = '' where id = %s" % q(J(30)))
    info = st.beat("made-up-a", BA, [CO], guid="ffffffff-0000-0000-0000-000000000202"); info["bridges"]["go-cccc000202"] = dict(info["bridges"][BA])
    st.setbeat(DA, info); db.sql("update tally_devices set main_bridge = 'go-cccc000202' where id = %s" % q(DA))
    if db.one("select tally_bridge_may_post(%s::uuid, %s)::text" % (q(DA), q(BA))) == "false":
        v0 = ver(); db.one("set role service_role; select tally_post_count_for(%s::uuid, %s, false)::text" % (q(DA), q(BA)))
        ok(msg() == "" and ver() == v0, "a bridge that may not post: the gate's words not written (%s)" % msg())
    else: ok(False, "the stand's bridge may still post with another main bridge")
    db.sql("update tally_devices set main_bridge = null where id = %s" % q(DA))
    st.setbeat(DA, st.beat("made-up-a", BA, [CO]))
    ok(J(30) in take(), "the linked company's GUID open: handed it")
    close(30)
    # (the sixth review) words for a posting that names no client or no company; another writer's words never cleared
    wf = lambda cl, co: db.one("set role service_role; select tally_post_linked_why_for(%s::uuid, %s, %s, %s::uuid, %s)" % (q(F), "null" if cl is None else q(cl), "null" if co is None else q(co), q(DA), q(BA))) if not RED else ""
    ok("names no client" in (wf(None, CO) or "") and "names no Tally company" in (wf("c1", None) or "") and "names no Tally company" in (wf("c1", "") or ""), "no client or no company: said plainly (%s)" % wf(None, CO))
    # (the sixth review) put back by tally-ingest (FinCom could not confirm in time): handed out again only after 30 s
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', 1, %s, %s, %s)" % (q(J(31)), q(F), q(CO), q(json.dumps({"vouchers": [vx("rj-2")]})), q(DA), q(STAFF)))
    db.sql("update tally_post_jobs set taken_by = %s, first_taken_at = now() - interval '1 minute', attempts = 1, message = 'Put back for the same FinCom Bridge: FinCom could not confirm in time that it may be sent', updated_at = now() where id = %s" % (q(BA), q(J(31))))
    ok(J(31) not in take() and count() == "0" if not RED else False, "put back a moment ago: not handed out, not counted (it waits 30 s)")
    db.sql("update tally_post_jobs set updated_at = now() - interval '31 seconds' where id = %s" % q(J(31)))
    ok(count() == "1" and J(31) in take(), "after 30 s: counted and handed to the same bridge")
    ok(not RED and "Put back" not in (db.one("select message from tally_post_jobs where id = %s" % q(J(31))) or "x"), "(taken: the take's own words)")
    close(31)

    print("== L. its date or amount cannot be read: never sent again, left to a person")
    read(True)
    xl = vx("rl-date", amt="1313.00", day="")
    xm = vx("rl-amt", amt="1414.00"); xm["xml"] = re.sub(r"<AMOUNT>[^<]*</AMOUNT>", "", xm["xml"])
    for n, v, what in ((12, xl, "date"), (13, xm, "amount")):
        x = posting(n, [v])[0]
        recheck(n) if not RED else None
        check_answer(n, x, "notseen")
        o = recheck(n) if not RED else {}
        w = rc(n, x).get("words") or ""
        ok(not RED and o.get("released", 0) == 0 and row(n)["status"] == "done" and holders(x) == [J(n)] and rc(n, x).get("state") == "person" and "date or amount" in w,
           "its %s not read: not sent, a person must look (%s %s)" % (what, rc(n, x).get("state"), w))
        close(n)

    print("== M. the beat's count timed (1,000 waiting postings, against 185's text)")
    m185 = open(M185).read(); a_ = m185.index("create or replace function public.tally_post_count_for("); b_ = m185.index("$function$;", m185.index("$function$", a_) + 10) + len("$function$;")
    db.sql(m185[a_:b_].replace("public.tally_post_count_for(", "public.tally_post_count_for_185(", 1))
    db.sql("update tally_post_jobs set status = 'failed', checking = false where status in ('waiting', 'taken', 'running')")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by, created_at) select extensions.gen_random_uuid(), %s, 'c1', %s, 'waiting', 1, '{}'::jsonb, %s, %s, now() - (g || ' seconds')::interval from generate_series(1, 1000) g"
           % (q(F), q(CO), q(DA), q(STAFF)))
    def tmed(fn, k=7):
        ts = []
        for _ in range(k):
            t0 = time.time(); out = db.one("set role service_role; select %s(%s::uuid, %s, true)::text" % (fn, q(DA), q(BA))); ts.append(time.time() - t0)
        return out, sorted(ts)[k // 2]
    def tpair(k=15):   # 202's and 185's counts asked by turns (the machine's load falls on both alike): their medians
        a_, b_ = [], []
        for _ in range(k):
            for fn, ts in (("tally_post_count_for", a_), ("tally_post_count_for_185", b_)):
                t0 = time.time(); o_ = db.one("set role service_role; select %s(%s::uuid, %s, true)::text" % (fn, q(DA), q(BA))); ts.append((time.time() - t0, o_))
        return a_[0][1], sorted(t for t, _ in a_)[k // 2], b_[0][1], sorted(t for t, _ in b_)[k // 2]
    st.setbeat(DA, st.beat("made-up-a", BA, [CO]))
    tmed("tally_post_count_for"); tmed("tally_post_count_for_185")   # (warm)
    n_new, t_new, n_old, t_old = tpair()
    print("    open: 185 %.0f ms (%s), 202 %.0f ms (%s)" % (t_old * 1000, n_old, t_new * 1000, n_new))
    ok(n_new == n_old == "1000" and t_new <= t_old * 1.25 + 0.03, "the gate open: counted alike, never slower than 185 (%.0f ms against %.0f ms)" % (t_new * 1000, t_old * 1000))
    st.setbeat(DA, st.beat("made-up-a", BA, [CO], guid="ffffffff-0000-0000-0000-000000000202"))
    t0 = time.time(); n1 = db.one("set role service_role; select tally_post_count_for(%s::uuid, %s, true)::text" % (q(DA), q(BA))); t_first = time.time() - t0
    written = db.one("select count(*)::text from tally_post_jobs where status = 'waiting' and message like 'Not posted yet:%'")
    for _ in range(60):
        if db.one("select count(*)::text from tally_post_jobs where status = 'waiting' and message like 'Not posted yet:%'") == "1000": break
        db.one("set role service_role; select tally_post_count_for(%s::uuid, %s, true)::text" % (q(DA), q(BA)))
    ok(db.one("select count(*)::text from tally_post_jobs where status = 'waiting' and message like 'Not posted yet:%'") == "1000", "every refused posting says why within 50 beats")
    v0 = db.one("select sum(row_version)::text from tally_post_jobs")
    n_ref, t_ref, _, t_old2 = tpair()
    v1 = db.one("select sum(row_version)::text from tally_post_jobs")
    print("    refused: first beat %.0f ms (%s words written), then 202 %.0f ms, 185 %.0f ms" % (t_first * 1000, written, t_ref * 1000, t_old2 * 1000))
    ok(n1 == "0" and n_ref == "0" and written == "20" and t_first < 0.5, "the gate refused: nothing counted; the words on at most 20 a beat (%s, %.0f ms)" % (written, t_first * 1000))
    ok(t_ref <= t_old2 * 1.25 + 0.03 and v0 == v1, "then each beat as fast as 185's, nothing written (%.0f ms against %.0f ms; row_version %s -> %s)" % (t_ref * 1000, t_old2 * 1000, v0, v1))
    db.sql("update tally_post_jobs set status = 'failed' where status = 'waiting'")
    st.setbeat(DA, st.beat("made-up-a", BA, [CO]))

    print("== K. the cron")
    if not RED: db.sql("update tally_post_rechecks set state = 'person' where state = 'open'")
    db.sql("update tally_post_jobs set status = 'failed', checking = false where status in ('waiting', 'taken', 'running') or checking")
    for _ in range(40):
        if '"idle": true' in (db.one("set role service_role; select tally_post_register_step(null, 2000)::text") or ""): break
    db.sql("update tally_post_register set changed_at = now() - interval '2 days' where state = 'needs_review'")
    db.sql("update tally_post_checks set resent = true where state = 'confirmed' and resent is not true")
    t0 = time.time(); r = st.psql_text("call public.tally_post_work_run();"); t = time.time() - t0
    ok(r.returncode == 0 and t < 0.5 and db.one("set role service_role; select tally_post_work_due()::text") == "false", "nothing to do: at once (%.2f s)" % t)
    xk = posting(40, [vx("rk-1", amt="4040.00")])[0]
    db.sql("update tally_post_ids set matched_at = now(), matched_vch = 'V-40' where fincom_id = %s" % q(xk))
    ok(db.one("set role service_role; select tally_post_work_due()::text") == "true", "an entry that needs review: the cron has work")
    r = st.psql_text("call public.tally_post_work_run();")
    ok(r.returncode == 0 and reg(xk) == "in_tally", "the cron's run rechecks it: marked posted (%s) %s" % (reg(xk), (r.stderr or "")[-200:]))
    # (the sixth review) the cron judges in one transaction and applies in the next; an entry a person settled in between
    # (its recheck no longer open) is left out of the apply; a plan older than 10 minutes is not applied
    xk2 = posting(41, [vx("rk-2", amt="4141.00")])[0]
    db.sql("update tally_post_ids set matched_at = now(), matched_vch = 'V-41' where fincom_id = %s" % q(xk2))
    svc("tally_post_recheck_enroll()"); due(41)
    o1 = svc("tally_post_recheck_step(%s::uuid, 'judge')" % q(J(41)))
    ok(o1.get("planned") == 1 and reg(xk2) == "needs_review", "judged: a plan of 1, nothing written yet (%s)" % o1)
    db.sql("update tally_post_rechecks set state = 'person' where job_id = %s" % q(J(41)))
    o2 = svc("tally_post_recheck_step(%s::uuid, 'apply')" % q(J(41)))
    ok(not o2.get("posted") and reg(xk2) == "needs_review", "settled by a person in between: not applied (%s)" % o2)
    db.sql("update tally_post_rechecks set state = 'open' where job_id = %s" % q(J(41))); due(41)
    svc("tally_post_recheck_step(%s::uuid, 'judge')" % q(J(41)))
    if not RED: db.sql("update tally_post_recheck_plans set at = now() - interval '11 minutes' where job_id = %s" % q(J(41)))
    o3 = svc("tally_post_recheck_step(%s::uuid, 'apply')" % q(J(41)))
    ok(o3.get("noplan") is True and reg(xk2) == "needs_review", "a plan older than 10 minutes: not applied (%s)" % o3)
    due(41); svc("tally_post_recheck_step(%s::uuid, 'judge')" % q(J(41))); o4 = svc("tally_post_work_then(%s::uuid, 'recheck')" % q(J(41)))
    if o4.get("register"): svc("tally_post_work_then(%s::uuid, 'register')" % q(J(41)))
    ok(o4.get("posted") == 1 and reg(xk2) == "in_tally", "judged, then applied by the follow-up: marked posted (%s)" % o4)
    # (the seventh review) an apply that fails: its recheck pushed 10 minutes with the words, as a judging that fails (not
    # judged again on every run of the cron)
    xk3 = posting(42, [vx("rk-3", amt="4242.00")])[0]
    db.sql("update tally_post_ids set matched_at = now(), matched_vch = 'V-42' where fincom_id = %s" % q(xk3))
    db.sql("""create or replace function public.t202_fail() returns trigger language plpgsql as $t$ begin
              if new.id = '%s'::uuid and new.message like 'Rechecked by itself%%' then raise exception 'made-up write error'; end if; return new; end $t$;
              create trigger t202_fail before update on tally_post_jobs for each row execute function public.t202_fail();""" % J(42))
    svc("tally_post_recheck_enroll()"); due(42)
    r = st.psql_text("call public.tally_post_work_run();")
    x3 = rc(42, xk3); wait_s = db.one("select round(extract(epoch from next_at - now()))::text from tally_post_rechecks where job_id = %s" % q(J(42))) if not RED else "0"
    ok(r.returncode == 0 and x3.get("state") == "open" and int(wait_s or 0) >= 590 and (x3.get("words") or "").startswith("Could not be rechecked this time: ") and "made-up write error" in (x3.get("words") or ""),
       "an apply that fails: looked at again in 10 minutes, said so (%s s; %s)" % (wait_s, x3.get("words")))
    db.sql("drop trigger t202_fail on tally_post_jobs"); close(42)
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
