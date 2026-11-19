"""python3 run_migration199_202.py - the release applied as it is deployed: 199, 200, 201 and 202 in that order, in ONE session
(docs/MIGRATION-ORDER.md: alone, 199 or 199 + 200 leave a big posting at 4-6 s a status change), then every statement of the
posting path timed at 20,000 and 50,000 entries. Run it ALONE (no other suite at the same time: the timings). On a
throwaway PostgreSQL (post_queue_stand: pg_stand, port 31209 unless PG199_202_PORT; never a real database), 184 and 185
first as on staging; made-up firms, entries and Day Book vouchers only.
  0. the four files in one session; each refuses to run without the ones before it; run again: the same
  1. for 20,000 and 50,000 entries (BIG=0: 2,000 only, untimed): queued; the register in steps; taken; 20 reports (stamped,
     written, the register's step after each); done; held by the cron's requeue; read back but the last 2 % (200's section F:
     settled by itself, the 2 % proven not in Tally and handed back alone); the register after the hand-back; the worker's
     transaction; then a second posting of as many entries settled with its replies lost (every entry needs review):
     enrolled and rechecked by itself (202) in steps of 1,000 against the Day Book (half found there by content, a quarter
     read back), the cron's run; nothing to do: the cron's look. Every statement under 1.5 s at 20,000; under 7.5 s (the
     statement timeout is 8 s) at 50,000"""
import os, sys, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, CO, STAFF, DA, BA
M = [os.path.join(PS.SQLDIR, f) for f in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql", "migration-202-post-recheck.sql")]
M184, M185 = (os.path.join(PS.SQLDIR, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql"))
BIG = os.environ.get("BIG", "1") != "0"
ME = "00000000-0000-0000-0000-000000000200"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
st = PS.Stand(int(os.environ.get("PG199_202_PORT") or 31209), extra=(M184, M185)); db = st.db
try:
    m182 = open(os.path.join(PS.SQLDIR, "migration-182-gap-after-post.sql")).read()
    t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
    f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
    db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
    print("== 0. the release in one session")
    for k, p in enumerate(M[1:], 1):
        r = st.psql_text(open(p).read())
        ok(r.returncode != 0 and "runs after" in (r.stderr or ""), "%s alone, before %s: refused" % (os.path.basename(p), os.path.basename(M[k - 1])))
    t0 = time.time(); r = st.psql_text("\n".join(open(p).read() for p in M)); t = time.time() - t0
    ok(r.returncode == 0, "199, 200, 201, 202 applied together in one session (%.1f s) %s" % (t, (r.stderr or "").strip()[-300:]))
    r = st.psql_text("\n".join(open(p).read() for p in M))
    ok(r.returncode == 0, "and again: the same %s" % (r.stderr or "").strip()[-200:])
    st.grants()

    def run(N, label):
        print("== 1. %s entries" % label)
        db.sql("update tally_post_jobs set status = 'failed', checking = false where status in ('waiting', 'taken', 'running') or checking")
        st.setbeat(DA, st.beat("made-up-a", BA, [CO])); db.sql("update tally_devices set last_seen = now()")
        LIMIT = (1.5 if N <= 20000 else 7.5) if BIG else 60
        JB, JR = "%08d-0000-0000-0000-000000000209" % (100000 + N), "%08d-0000-0000-0000-000000000209" % (200000 + N)
        days = ["2026%02d%02d" % (m, d) for m in (4, 5, 6, 7, 8, 9, 10) for d in (3, 9, 15, 21, 27)]
        def V(pre):
            return [{"id": "%s%d-%05d" % (pre, N, k), "xml": "<VOUCHER VCHTYPE=\"Payment\"><DATE>%s</DATE><PARTYLEDGERNAME>Made-up Party %d</PARTYLEDGERNAME><NARRATION>TDSDesk:%s%d-%05d</NARRATION><AMOUNT>-%d.00</AMOUNT></VOUCHER>"
                     % (days[k % len(days)], k % 97, pre, N, k, 100 + k)} for k in range(N)]
        VB = V("b"); tm = {}
        def step(name, stmt, uid=None):
            t0 = time.time()
            try: out = db.one("set statement_timeout = '8s'; " + stmt, uid); e = ""
            except RuntimeError as x: out, e = None, str(x)[-300:]
            t = time.time() - t0; tm[name] = max(tm.get(name, 0), t)
            if e or t >= LIMIT: ok(False, "%s: %.2f s %s" % (name, t, e))
            return out
        def drain(job):
            for _ in range(300):
                o = step("a register step (201: 2,000 a step)", "set role service_role; select tally_post_register_step(%s::uuid, 2000)::text" % q(job))
                if not o or '"idle": true' in o: break
        if N <= 20000:
            out = step("queued (tally_post_enqueue_to)", "set role authenticated; select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(JB), q(json.dumps({"masters": [], "vouchers": VB}))), STAFF)
            ok(bool(out) and json.loads(out).get("ok") is True, "queued: %s" % (out or "")[:100])
        else:   # (more than the queue's 8 MB: stored as the queue stores it)
            step("queued (the posting stored, its triggers)", "insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', %d, %s, %s, %s)"
                 % (q(JB), q(F), q(CO), N, q(json.dumps({"masters": [], "vouchers": VB})), q(DA), q(STAFF)))
        drain(JB)
        ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'queued'" % q(JB)) == str(N), "the register: %d queued" % N)
        out = step("taken (tally_post_take_for: the linked company's GUID open)", "set role service_role; select string_agg(id::text, ',') from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA)))
        ok(JB in (out or ""), "the bridge takes it")
        step("running (the first report)", "set role service_role; update tally_post_jobs set status = 'running', updated_at = now() where id = %s" % q(JB))
        PART = N // 20; res = []; its = [{"id": v["id"], "kind": "voucher", "state": "waiting"} for v in VB]
        for p in range(20):
            new = [{"id": VB[k]["id"], "kind": "voucher", "ok": True, "byReply": True, "batchN": 50, "batchEnd": str(100000 + (k // 50) * 50 + 49), "sentAt": "2026-11-18T10:%02d:00Z" % p,
                    "created": 50, "state": "posted"} for k in range(p * PART, (p + 1) * PART)]
            res += new
            for x in new: its[int(x["id"].split("-")[1])]["state"] = "posted"
            step("stamped (tally_post_id_accept_many)", "set role service_role; select tally_post_id_accept_many(%s::uuid, %s::jsonb)::text" % (q(JB), q(json.dumps([{"id": x["id"], "reply": True, "batchEnd": x["batchEnd"], "batchN": 50} for x in new]))))
            step("the report written" if p < 19 else "the report moving it to done", "set role service_role; update tally_post_jobs set status = %s, done = %d, results = %s, items = %s, seq = %d, updated_at = now() where id = %s"
                 % (q("done" if p == 19 else "running"), len(res), q(json.dumps(res)), q(json.dumps(its)), p + 2, q(JB)))
            step("the register after a report (tally_post_register_apply)", "set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(JB))
        drain(JB)
        ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'in_tally'" % q(JB)) == str(N), "done: all %d in Tally in the register" % N)
        # 200's section F: held (its last reports lost), read back but the last 2 %, those proven not in Tally and handed back
        db.sql("update tally_post_jobs set status = 'running', results = %s, items = '[]', updated_at = now() - interval '40 minutes' where id = %s" % (q(json.dumps(res[:N * 3 // 4])), q(JB)))
        db.sql("update tally_devices set last_seen = now() - interval '1 hour', info = '{}'")
        step("the cron's requeue (holds it)", "select tally_post_requeue()::text")
        st.setbeat(DA, st.beat("made-up-a", BA, [CO]))
        db.sql("update tally_post_ids set matched_at = now(), matched_vch = 'V' where job_id = %s and fincom_id <= %s" % (q(JB), q("b%d-%05d" % (N, N - N // 50 - 1))))
        db.sql("update tally_post_ids set accepted_at = null, reply_vch = null, batch_end = null, batch_n = null where job_id = %s and matched_at is null" % q(JB))
        db.sql("insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, at) values (%s, %s, %s, %s, 1, 100, 0, now() - interval '5 minutes') on conflict (job_id) do nothing" % (q(F), q(PS.BK), q(JB), q(DA)))
        db.sql("insert into tally_sync_cursor (book_id, firm_id, start_at, match_start, match_alter, match_at) values (%s, %s, '2026-11-01', '2026-11-01', 200, now()) on conflict (book_id) do update set match_alter = 200, match_at = now(), start_at = '2026-11-01', match_start = '2026-11-01'" % (q(PS.BK), q(F)))
        db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device, auto) select %s, %s, i.entry_id, %s, %s, 'made-up', 'notseen', now(), %s, %s, true from tally_post_ids i where i.job_id = %s and i.matched_at is null"
               % (q(F), q(JB), q(CO), q(ME), q(BA), q(DA), q(JB)))
        o = json.loads(step("200 F: settle itself (read back -> posted, proven absent -> released)", "set role service_role; select tally_post_settle_itself(%s::uuid)::text" % q(JB)) or "{}")
        ok(o.get("released") == N // 50 and o.get("resend") is True, "settled by itself: %s released" % o.get("released"))
        step("200 F: the hand-back (tally_post_settle_resend: the change of status)", "set role service_role; select tally_post_settle_resend(%s::uuid)::text" % q(JB))
        ok(db.one("select status || ':' || jsonb_array_length(resend_only) from tally_post_jobs where id = %s" % q(JB)) == "waiting:%d" % (N // 50), "handed back: those %d alone" % (N // 50))
        drain(JB)
        step("the worker's one transaction (tally_post_work)", "set role service_role; select tally_post_work()::text")
        db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(JB))
        # 202: a posting settled with its replies lost: every entry needs review; half in the Day Book (content), a quarter read back
        VR = V("r")
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, taken_by, taken_at, created_by) values (%s, %s, 'c1', %s, 'running', %d, %s, %s, %s, now() - interval '50 minutes', %s)"
               % (q(JR), q(F), q(CO), N, q(json.dumps({"vouchers": VR})), q(DA), q(BA), q(STAFF)))
        db.sql("update tally_post_jobs set status = 'done', checking = false, results = %s, items = '[]', updated_at = now() where id = %s"
               % (q(json.dumps([{"id": v["id"], "kind": "voucher", "ok": False, "state": "sent", "outcomeUnknown": True} for v in VR])), q(JR)))
        db.sql("insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, at) values (%s, %s, %s, %s, 1, 100, 0, now() - interval '5 minutes') on conflict (job_id) do nothing" % (q(F), q(PS.BK), q(JR), q(DA)))
        drain(JR)
        ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'needs_review'" % q(JR)) == str(N), "the register: all %d need review" % N)
        db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, narration) select %s, %s, 'g' || k, to_date((array[%s])[1 + k %% %d], 'YYYYMMDD'), 'Payment', '', 'Made-up Party ' || (k %% 97), 'edited (made-up)' from generate_series(0, %d, 2) k"
               % (q(PS.BK), q(F), ",".join(q(d) for d in days), len(days), N - 1))
        db.sql("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) select v.book_id, v.firm_id, v.guid, v.day, v.party, -(100 + substr(v.guid, 2)::int) from tally_vouchers v where v.book_id = %s and v.guid ~ '^g[0-9]+$'" % q(PS.BK))
        db.sql("update tally_post_ids set matched_at = now(), matched_vch = 'V' where job_id = %s and right(fincom_id, 1) in ('1', '5')" % q(JR))
        o = step("202: the entries that need review taken up (tally_post_recheck_enroll)", "set role service_role; select tally_post_recheck_enroll()::text")
        ok(o == str(N), "enrolled: %s" % o)
        db.sql("update tally_post_rechecks set next_at = now() - interval '1 second' where job_id = %s" % q(JR))
        found = 0
        for _ in range(N // 1000 + 3):
            # (the sixth review) as the cron does it: judged in one statement, applied in the next transaction
            o = json.loads(step("202: a recheck of 1,000 judged (tally_post_recheck_step judge)", "set role service_role; select tally_post_recheck_step(%s::uuid, 'judge')::text" % q(JR)) or "{}")
            if o.get("idle"): break
            o = json.loads(step("202: its stamps written (tally_post_work_then recheck)", "set role service_role; select tally_post_work_then(%s::uuid, 'recheck')::text" % q(JR)) or "{}")
            found += o.get("posted") or 0
        ok(found == N // 2 + N // 5, "found in Tally by itself: %d (the Day Book's content and the read-back), nothing sent again (%s)" % (found, db.one("select coalesce(resend_only::text, '-') from tally_post_jobs where id = %s" % q(JR))))
        step("202: the register follows (tally_post_register_apply)", "set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(JR))
        drain(JR)
        ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'in_tally'" % q(JR)) == str(found), "the register: %d in Tally" % found)
        t0 = time.time(); r = st.psql_text("call public.tally_post_work_run(10);"); t = time.time() - t0
        ok(r.returncode == 0, "the cron's run with rechecks due (%.1f s, bounded) %s" % (t, (r.stderr or "")[-200:]))
        db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(JR)); drain(JR)
        db.sql("update tally_post_rechecks set state = 'person' where state = 'open'; update tally_post_register set changed_at = now() - interval '2 days' where state = 'needs_review'")
        db.sql("update tally_post_checks set resent = true where state = 'confirmed' and resent is not true")
        step("the cron's look with nothing to do (tally_post_work_due)", "set role service_role; select tally_post_work_due()::text")
        print("  %s entries:" % label)
        for k, v in sorted(tm.items(), key=lambda kv: -kv[1]): print("  %6.2f s  %s" % (v, k))
        ok(all(v < LIMIT for v in tm.values()), "every statement under %.1f s at %s (slowest %.2f s)" % (LIMIT, label, max(tm.values())))
        db.sql("delete from tally_lines where book_id = %s; delete from tally_vouchers where book_id = %s" % (q(PS.BK), q(PS.BK)))
    if BIG:
        run(20000, "20,000"); run(50000, "50,000")
    else: run(2000, "2,000")
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
