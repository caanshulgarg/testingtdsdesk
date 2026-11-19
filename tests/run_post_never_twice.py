"""python3 run_post_never_twice.py - never twice (the third review of 19-Nov-2026, branch next-fix-posttimeout): an entry
released to be sent again (by itself, 200, or by a member's "I looked in Tally: not there", 55/174) waits for its own
posting's hand-back, and is never posted in another posting meanwhile nor handed back once another posting has it. On a
throwaway PostgreSQL (post_queue_stand: pg_stand, port 31202 unless PG202_PORT; never a real database), 184 and 185 as on
staging, then 199, 200 and 201 applied together in one session; made-up firms and entries only.
  R. the review's reproduction: a held posting P; a member confirms X (released, P still held); X queued again in Q: refused
     (P owes it); 200 proves W missing and hands P back: X and W, once, by P alone
  T. staging's path today (174 alone): a member confirms X on a held P, X is queued in Q, a member confirms W: P handed back
     with X and W. Now: Q refused; and with X already in another posting (put there before this release), the hand-back
     sends W alone and closes X's check, naming that posting
  E. 200's hand-back reads the WHOLE list for entries posted elsewhere (one a member released, planted elsewhere first)
  K. a re-send list kept from an earlier hand-back is never sent again
  M. a member's release on a held posting a Mark posted then settles: the cron hands it back by itself (no posting stays
     owing); a Retry of another posting holding it is refused meanwhile
  O. the bridge's post_ok (tally_post_resend_ok): a held posting's list not handed back yet, or with an entry posted
     elsewhere: not sent; handed back: sent
  W. an owner's own release (no check): the entry is free (posted anew elsewhere), never in its old posting's hand-back
  Q. a hand-back being sent (waiting, taken, running) keeps its entries; the cron's requeue keeps them
  S. a stopped posting (stop_reason) whose entries are proven not in Tally: never handed back, even after 174 clears the
     stop once it settles; the entries free for a person
RED_WITHOUT_199_201=1: T on staging's code today (184/185 only, no 199/200/201): the double post (fails)."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, CO, OWNER, STAFF, DA, BA
RED = os.environ.get("RED_WITHOUT_199_201") == "1"
M = [os.path.join(PS.SQLDIR, f) for f in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql")]
M184, M185 = (os.path.join(PS.SQLDIR, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql"))
ME = "00000000-0000-0000-0000-000000000200"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
st = PS.Stand(int(os.environ.get("PG202_PORT") or 31202), extra=(M184, M185)); db = st.db
J = lambda n: "%08d-0000-0000-0000-000000000202" % n
try:
    m182 = open(os.path.join(PS.SQLDIR, "migration-182-gap-after-post.sql")).read()
    t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
    f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
    db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
    if not RED:
        r = st.psql_text("\n".join(open(p).read() for p in M))   # one session, in order (docs/MIGRATION-ORDER.md)
        ok(r.returncode == 0, "199, 200, 201 applied together in one session %s" % (r.stderr or "").strip()[-300:])
        st.grants()
    st.setbeat(DA, st.beat("made-up-a", BA, [CO])); db.sql("update tally_devices set last_seen = now()")
    vx = lambda x: {"id": x, "xml": "<VOUCHER VCHTYPE=\"Payment\"><DATE>20261117</DATE><NARRATION>TDSDesk:%s</NARRATION><AMOUNT>-5.00</AMOUNT></VOUCHER>" % x}
    def enq(jid, xs): return st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(jid), q(json.dumps({"masters": [], "vouchers": [vx(x) for x in xs]}))))
    def held(n, xs, auto=False):   # a posting of xs its bridge had, held for checking, each entry "not seen" by that bridge
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, taken_by, taken_at, created_by) values (%s, %s, 'c1', %s, 'running', %d, %s, %s, %s, now() - interval '50 minutes', %s)"
               % (q(J(n)), q(F), q(CO), len(xs), q(json.dumps({"vouchers": [vx(x) for x in xs]})), q(DA), q(BA), q(STAFF)))
        db.sql("update tally_post_jobs set status = 'done', checking = true, items = %s, message = 'Held (made-up)', updated_at = now() - interval '40 minutes' where id = %s"
               % (q(json.dumps([{"id": x, "kind": "voucher", "state": "sent"} for x in xs])), q(J(n))))
        if not RED:
            db.sql("insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, at) values (%s, %s, %s, %s, 100, 120, 0, now() - interval '20 minutes')" % (q(F), q(PS.BK), q(J(n)), q(DA)))
        for x in xs:
            db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device) values (%s, %s, %s, %s, %s, 'made-up', 'notseen', now(), %s, %s)"
                   % (q(F), q(J(n)), q(x), q(CO), q(ME if auto else OWNER), q(BA), q(DA)))
            if auto: db.sql("update tally_post_checks set auto = true where job_id = %s and entry_id = %s" % (q(J(n)), q(x)))
    def complete():   # FinCom's read of Tally is complete past every posting's window
        db.sql("insert into tally_sync_cursor (book_id, firm_id, start_at, match_start, match_alter, match_at) values (%s, %s, '2026-11-01', '2026-11-01', 125, now()) on conflict (book_id) do update set start_at = '2026-11-01', match_start = '2026-11-01', match_alter = 125, match_at = now()" % (q(PS.BK), q(F)))
    def auto(n, x):   # the check of x is FinCom's own (asked by itself)
        db.sql("update tally_post_checks set asked_by = %s, auto = true where job_id = %s and entry_id = %s" % (q(ME), q(J(n)), q(x)))
    def confirm(n, x): return st.rpc(OWNER, "select tally_post_check_confirm(%s::uuid, %s, 'looked in the day book (made-up)')::text" % (q(J(n)), q(x)))
    def svc(sql_): return json.loads(db.one("set role service_role; select %s::text" % sql_) or "null")
    def take(): return db.one("set role service_role; select string_agg(id::text, ',') from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA)))
    def row(n): return json.loads(db.one("select (to_jsonb(j) - 'payload')::text from tally_post_jobs j where id = %s" % q(J(n))) or "null")
    def holders(x):   # the postings that would send x to Tally: x live there, or x in a re-send list of a posting sending (or to send) it
        live = (db.one("select coalesce(string_agg(job_id::text, ',' order by job_id), '') from tally_post_ids where fincom_id = %s and live" % q(x)) or "").split(",")
        rs = (db.one("select coalesce(string_agg(id::text, ',' order by id), '') from tally_post_jobs where status in ('waiting', 'taken', 'running') and resend_only ? %s" % q(x)) or "").split(",")
        return sorted(set(z for z in live + rs if z))
    def plant(n, x):   # (data from before this release) x put in another posting n after its release, as staging's code let it
        db.sql("set session_replication_role = replica; insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', 1, %s, %s, %s);"
               "insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live) values (%s, 'c1', %s, %s, %s, true); set session_replication_role = origin;"
               % (q(J(n)), q(F), q(CO), q(json.dumps({"vouchers": [vx(x)]})), q(DA), q(STAFF), q(F), q(x), q(J(n)), q(x)))
    def close(*ns): db.sql("update tally_post_jobs set status = 'failed', checking = false where id = any(%s::uuid[])" % q("{" + ",".join(J(n) for n in ns) + "}"))
    WAITING = "already waiting to be posted in an earlier posting"

    print("== T. staging's path today: a member confirms X on a held posting, X queued again, a member confirms W")
    X, W = "tx-x", "tx-w"
    held(10, [X, W])
    c1 = confirm(10, X)
    ok(c1.get("ok") is True and row(10)["status"] == "done" and row(10)["checking"] is True and row(10)["resend_only"] == [X], "X released, P still held, X in its re-send list (%s)" % c1.get("words"))
    e = enq(J(11), [X])
    ok(e.get("ok") is False and WAITING in (e.get("error") or "") and [d.get("job") for d in e.get("dupes") or []] == [J(10)],
       "X queued again in Q: refused, P owes it (%s)" % json.dumps(e)[:220])
    c2 = confirm(10, W); r = row(10)
    ok(c2.get("ok") is True and r["status"] == "waiting" and sorted(r["resend_only"] or []) == sorted([X, W]), "W confirmed: P handed back with X and W (%s %s)" % (r["status"], r["resend_only"]))
    ok(holders(X) == [J(10)] and holders(W) == [J(10)], "each sent by P alone, once (X: %s)" % holders(X))
    if not RED:
        ok(db.one("select string_agg(entry_id || '=' || resent::text, ',' order by entry_id) from tally_post_checks where job_id = %s" % q(J(10))) == "%s=true,%s=true" % (W, X),
           "both checks marked handed back (a later hand-back never sends them again)")
        e = enq(J(12), [X]); ok(e.get("ok") is False and WAITING in (e.get("error") or ""), "and while P sends it: refused")
        close(10)
        # X already in another posting before the confirm of W (put there by staging's code before this release)
        X, W = "tx-x2", "tx-w2"
        held(13, [X, W]); confirm(13, X); plant(14, X)
        c2 = confirm(13, W); r = row(13)
        ok(r["status"] == "waiting" and r["resend_only"] == [W] and J(14)[:8] in (c2.get("words") or "") and J(14)[:8] in (r["message"] or ""),
           "X in another posting already: P hands back W alone, saying where X went (%s | %s)" % (r["resend_only"], c2.get("words")))
        ok(db.one("select state from tally_post_checks where job_id = %s and entry_id = %s" % (q(J(13)), q(X))) == "superseded" and holders(X) == [J(14)], "X's check closed; X sent by that posting only")
        close(13, 14)

    if not RED:
        print("== R. the review's reproduction: a member confirms X on a held posting, X posted elsewhere, 200 hands back")
        X, W = "rx-x", "rx-w"
        held(20, [X, W]); confirm(20, X)
        ok([z["job_id"] for z in json.loads(db.one("set role service_role; select coalesce(json_agg(r), '[]')::text from tally_post_resend_reserved(%s::uuid) r where r.fincom_id = %s" % (q(F), q(X))))] == [J(20)],
           "X reserved for P (its member's release counts, whoever confirmed it)")
        e = enq(J(21), [X])
        ok(e.get("ok") is False and WAITING in (e.get("error") or ""), "X queued in Q: refused (%s)" % (e.get("error") or "")[:120])
        try:
            db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', 1, %s, %s, %s)" % (q(J(22)), q(F), q(CO), q(json.dumps({"vouchers": [vx(X)]})), q(DA), q(STAFF))); e2 = ""
        except RuntimeError as x_: e2 = str(x_)
        ok("Not queued" in e2 and J(20)[:8] in e2, "and by any other way into the queue: refused by the queue's guard (%s)" % e2.split("CONTEXT")[0][-160:])
        complete(); auto(20, W)
        o = svc("tally_post_settle_itself(%s::uuid)" % q(J(20)))
        ok(o.get("resend") is True and o.get("released") == 1, "W proven not in Tally by itself: released (%s)" % (o.get("words") or "")[:160])
        o = svc("tally_post_settle_resend(%s::uuid)" % q(J(20))); r = row(20)
        ok(o.get("resent") is True and r["status"] == "waiting" and sorted(r["resend_only"]) == sorted([X, W]), "handed back: X and W (%s)" % r["resend_only"])
        ok(holders(X) == [J(20)] and holders(W) == [J(20)], "X sent by P alone, once: %s" % holders(X))
        close(20)

        print("== E. 200's hand-back reads the whole list: an entry a member released, posted elsewhere meanwhile, is not sent")
        X, W = "ex-x", "ex-w"
        held(30, [X, W]); confirm(30, X); plant(31, X); complete(); auto(30, W)
        svc("tally_post_settle_itself(%s::uuid)" % q(J(30))); o = svc("tally_post_settle_resend(%s::uuid)" % q(J(30))); r = row(30)
        ok(o.get("resent") is True and r["resend_only"] == [W] and J(31) in json.dumps(o.get("elsewhere")), "W handed back alone; X named as posted elsewhere (%s %s)" % (r["resend_only"], o.get("elsewhere")))
        ok(db.one("select state from tally_post_checks where job_id = %s and entry_id = %s" % (q(J(30)), q(X))) == "superseded" and holders(X) == [J(31)], "X's check closed: X sent by that posting only")
        # every entry of the list taken elsewhere: nothing handed back, the posting settles
        X = "ex-y"; held(32, [X]); confirm(32, X)
        ok(row(32)["status"] == "waiting", "(one entry: a member's confirm hands it back at once)")
        close(30, 31, 32)
        X, W = "ex-z", "ex-v"; held(33, [X, W]); confirm(33, X); plant(34, X)
        db.sql("update tally_post_jobs set checking = false where id = %s" % q(J(33)))   # (settled meanwhile with W in Tally, say)
        db.sql("update tally_post_checks set state = 'superseded' where job_id = %s and entry_id = %s" % (q(J(33)), q(W)))
        o = svc("tally_post_settle_resend(%s::uuid)" % q(J(33))); r = row(33)
        ok(o.get("resent") is False and r["status"] in ("done", "failed") and not r["checking"] and J(34)[:8] in (r["message"] or ""), "nothing left to send: not handed back, settled, saying where it went (%s/%s %s)" % (r["status"], r["checking"], (r["message"] or "")[-120:]))
        close(33, 34)

        print("== K. a re-send list kept from an earlier hand-back is never sent again")
        X, W = "kx-x", "kx-w"
        held(40, [X, W]); confirm(40, X); confirm(40, W)
        ok(row(40)["status"] == "waiting" and sorted(row(40)["resend_only"]) == sorted([X, W]), "handed back: X and W")
        take()
        db.one("set role service_role; select tally_post_id_accept(%s::uuid, %s, null)::text" % (q(J(40)), q(X)))
        # X went to Tally; W's reply was lost: held again, W checked "not seen" by itself, proven not in Tally
        db.sql("update tally_post_jobs set status = 'done', checking = true, results = %s, updated_at = now() where id = %s"
               % (q(json.dumps([{"id": X, "kind": "voucher", "ok": True, "verified": True, "state": "in_tally"}])), q(J(40))))
        db.sql("update tally_post_ids set live = true where job_id = %s and fincom_id = %s" % (q(J(40)), q(W)))   # (re-sent: live again until proven)
        db.sql("update tally_post_ids set released_at = null, released_by = null where job_id = %s and fincom_id = %s" % (q(J(40)), q(W)))
        db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device, auto) values (%s, %s, %s, %s, %s, 'made-up', 'notseen', now() + interval '1 second', %s, %s, true)"
               % (q(F), q(J(40)), q(W), q(CO), q(ME), q(BA), q(DA)))
        db.sql("update tally_post_windows set at = now() - interval '1 minute' where job_id = %s" % q(J(40))); complete()
        o = svc("tally_post_settle_itself(%s::uuid)" % q(J(40)))
        o2 = svc("tally_post_settle_resend(%s::uuid)" % q(J(40))); r = row(40)
        ok(o.get("released") == 1 and o2.get("resent") is True and r["resend_only"] == [W], "handed back again: W alone, never X a second time (%s)" % r["resend_only"])
        close(40)

        print("== M. a member's release on a held posting a Mark posted settles: the cron hands it back by itself")
        X, W = "mx-x", "mx-w"
        held(50, [X, W]); confirm(50, X)
        db.one("set role service_role; select tally_post_mark_core(%s::uuid, %s::uuid, %s::uuid, %s, 'V7', 'made-up: found in Tally')::text" % (q(F), q(OWNER), q(J(50)), q(W)))
        r = row(50)
        ok(r["status"] in ("done", "failed") and not r["checking"], "W marked posted: P settled (%s/%s), X still owed" % (r["status"], r["checking"]))
        e = enq(J(52), [X]); ok(e.get("ok") is False and WAITING in (e.get("error") or ""), "X queued again meanwhile: refused")
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'failed', 1, %s, %s, %s)"
               % (q(J(51)), q(F), q(CO), q(json.dumps({"vouchers": [vx("mx-other")]})), q(DA), q(STAFF)))
        db.sql("set session_replication_role = replica; insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live) values (%s, 'c1', %s, %s, %s, false); set session_replication_role = origin"
               % (q(F), q(X), q(J(51)), q(X)))   # (an older posting that failed, holding X too: its Retry)
        e = enq(J(51), [X]); ok(e.get("ok") is False and "being posted in another posting" in (e.get("error") or ""), "a Retry of another posting holding X: refused (%s)" % (e.get("error") or "")[:120])
        db.sql("delete from tally_post_ids where job_id = %s and fincom_id = %s" % (q(J(51)), q(X)))
        ok(db.one("set role service_role; select tally_post_work_due()::text") == "true", "the cron sees work to do")
        o = svc("tally_post_settle_resend_due(5)"); r = row(50)
        ok(o.get("resent") == 1 and r["status"] == "waiting" and r["resend_only"] == [X] and holders(X) == [J(50)], "handed back by itself: X alone, by P (%s)" % r["resend_only"])
        close(50)
        ok(svc("tally_post_settle_resend_due(5)").get("looked") == 0, "nothing more owed")

        print("== O. the bridge's post_ok: a list not handed back yet, or with an entry posted elsewhere, is not sent")
        X, W = "ox-x", "ox-w"
        held(60, [X, W]); confirm(60, X)
        w1 = svc("to_jsonb(tally_post_resend_ok(%s::uuid))" % q(J(60)))
        ok(isinstance(w1, str) and "handed back" in w1, "held, X released by a member, not handed back: not sent (%s)" % w1)
        confirm(60, W)
        ok(svc("to_jsonb(tally_post_resend_ok(%s::uuid))" % q(J(60))) is None, "handed back: sent")
        db.sql("set session_replication_role = replica; insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live) values (%s, 'c1', %s, %s, %s, true); set session_replication_role = origin"
               % (q(F), q(X), q(J(61)), q(X)))
        w2 = svc("to_jsonb(tally_post_resend_ok(%s::uuid))" % q(J(60)))
        ok(isinstance(w2, str) and X in w2 and J(61)[:8] in w2, "an entry of it in another posting (data from before this release): not sent (%s)" % w2)
        db.sql("delete from tally_post_ids where job_id = %s" % q(J(61))); close(60)

        print("== W. an owner's own release: free to post anew, never in its old posting's hand-back")
        X, W = "wx-x", "wx-w"
        held(70, [X, W]); db.sql("update tally_post_jobs set checking = false where id = %s" % q(J(70)))
        o = st.rpc(OWNER, "select tally_post_owner_release(%s::uuid, %s, 'not in the day book (made-up)')::text" % (q(J(70)), q(X)))
        ok(o.get("ok") is True, "the owner releases X (%s)" % json.dumps(o)[:120])
        e = enq(J(71), [X]); ok(e.get("ok") is True, "X posted anew in another posting (%s)" % json.dumps(e)[:120])
        db.sql("update tally_post_jobs set checking = true where id = %s" % q(J(70))); complete(); auto(70, W)
        svc("tally_post_settle_itself(%s::uuid)" % q(J(70))); svc("tally_post_settle_resend(%s::uuid)" % q(J(70))); r = row(70)
        ok(r["status"] == "waiting" and r["resend_only"] == [W] and holders(X) == [J(71)], "P's hand-back: W alone; X only in the new posting (%s %s)" % (r["resend_only"], holders(X)))
        close(70, 71)

        print("== Q. a hand-back being sent keeps its entries; the cron's requeue too")
        X = "qx-x"; held(80, [X]); confirm(80, X)
        ok(row(80)["status"] == "waiting", "handed back")
        take()
        db.sql("set role service_role; update tally_post_jobs set status = 'running', updated_at = now() - interval '40 minutes' where id = %s" % q(J(80)))
        e = enq(J(81), [X]); ok(e.get("ok") is False, "running: X refused elsewhere")
        db.one("select tally_post_requeue()::text")
        r = row(80)
        e = enq(J(82), [X]); ok(e.get("ok") is False and (r["status"] in ("waiting", "done") ), "after the requeue (%s/%s %s): still refused elsewhere" % (r["status"], r["checking"], r["resend_only"]))
        close(80)

        print("== S. a stopped posting's entries proven not in Tally: never handed back, even once the stop is cleared")
        X = "sx-x"; held(90, [X], auto=True)
        db.sql("update tally_post_jobs set stop_reason = 'Not posted: posting into Tally was stopped for Made-up Heron after this was queued (made-up).', stop_at = now() where id = %s" % q(J(90)))
        complete()
        o = svc("tally_post_settle_itself(%s::uuid)" % q(J(90))); r = row(90)
        ok(o.get("released") == 1 and o.get("resend") is not True and r["status"] in ("done", "failed") and not r["checking"] and r["stop_reason"] is None,
           "proven not in Tally, released; the posting settles (174 clears its stop): %s/%s %s" % (r["status"], r["checking"], (r["message"] or "")[-160:]))
        ok(db.one("select state from tally_post_checks where job_id = %s and entry_id = %s" % (q(J(90)), q(X))) == "superseded", "its check closed: owed by nobody")
        o = svc("tally_post_settle_resend_due(5)"); r = row(90)
        ok(r["status"] != "waiting" and holders(X) == [] and svc("tally_post_settle_resend(%s::uuid)" % q(J(90))).get("resent") is False, "the cron never hands it back (%s)" % o)
        e = enq(J(91), [X]); ok(e.get("ok") is True, "the entry is free for a person to post again (%s)" % json.dumps(e)[:120])
        close(90, 91)
        # blocked at the hand-back (the link stopped after it was settled): never handed back
        X = "sx-y"; held(92, [X], auto=True); complete()
        o = svc("tally_post_settle_itself(%s::uuid)" % q(J(92)))
        db.sql("update tally_links set posting_allowed = false where firm_id = %s" % q(F))
        o = svc("tally_post_settle_resend(%s::uuid)" % q(J(92))); r = row(92)
        ok(o.get("resent") is False and o.get("blocked") and r["status"] != "waiting" and not r["checking"], "posting stopped before the hand-back: not handed back, settled (%s)" % (r["message"] or "")[-160:])
        db.sql("update tally_links set posting_allowed = true where firm_id = %s" % q(F))
        ok(svc("tally_post_settle_resend_due(5)").get("resent") == 0, "and the cron never hands it back")
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
