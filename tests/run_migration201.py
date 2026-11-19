"""python3 run_migration201.py - server/tally-cloud/migration-201-post-register-async.sql (18-Nov-2026, branch
next-fix-posttimeout). The owner (18-Nov-2026): every request and trigger on the posting path well under the timeout at
20,000 entries, linear to 50,000. 201 takes the posting register's pass of a big posting out of the triggers (marked, then
done in steps of 2,000 by tally_post_register_step), gives tally_fincom_id the same answer without a regular expression,
and makes the sync, the read-back and the enqueue's duplicate lookup keyed. On a throwaway PostgreSQL (post_queue_stand:
pg_stand, port 31201 unless PG201_PORT; never a real database) with 199 and 200 run first; made-up firms and entries only.
  0. the file: one transaction, lock_timeout 10 s, add-only, every function granted explicitly, names no real database,
     runs twice
  2. the register, step by step = synchronous: 150 made-up postings queued (other postings' records in every state: the
     guard's refusals the same) and then reported on; the records, their history and the ids' live after the steps (chunks
     of 3, a change in the middle of a pass on some) exactly as the old triggers leave them
  3. two workers at the same moment: one does the step, the other is told idle; after the pass, a step changes nothing
  4. 20,000 and 50,000 entries (BIG=0 skips): queued, taken, 20 reports, done, held by the cron, settled by itself, handed
     back; every statement timed (limit 1.5 s at 20,000; under the 8 s statement timeout at 50,000); the register follows in
     steps; the cron is one indexed look when idle
RED_WITHOUT_201=1: the same checks without the file (fails)."""
import os, re, sys, json, random, time, hashlib, csv, subprocess, threading
csv.field_size_limit(1 << 30)
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, CO, OWNER, STAFF, DA, BA
M199, M200, M201 = (os.path.join(PS.SQLDIR, f) for f in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql"))
RED = os.environ.get("RED_WITHOUT_201") == "1"
BIG = os.environ.get("BIG", "1") != "0" and not RED
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
text = open(M201).read() if os.path.exists(M201) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M201), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
DELS = ["delete from tally_post_register_wants x where x.job_id = p_job;", "delete from tally_post_register_wants x where x.job_id = p_job and x.id = any(w.ids);",
        "delete from tally_post_work_errors e where e.last_at < now() - interval '7 days'"]
ok(bool(text) and code.count("delete from") == 3 and all(d in code for d in DELS) and "x.id <= w.top" not in code
   and not re.search(r"\b(drop|truncate)\s", code) and code.count("create table") == 3 and "create trigger" not in code
   and code.count("create index if not exists") == 2 and "alter table public.tally_post_register_pending enable row level security" in code
   and "alter table public.tally_post_register_wants enable row level security" in code and "alter table public.tally_post_work_errors enable row level security" in code and code.count("alter table") == 3,
   "add-only: three tables and their indexes; no trigger; nothing dropped or truncated; deleted only the wants a step has folded (or of a posting gone) and the error log's old rows")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
FNS = ["tally_post_register_maps(public.tally_post_jobs)", "tally_post_register_judged_part(public.tally_post_jobs, jsonb, jsonb, jsonb, jsonb)",
       "tally_post_register_apply_part(public.tally_post_jobs, uuid, jsonb, jsonb, jsonb, jsonb)", "tally_post_register_queue_part(public.tally_post_jobs, text[], boolean, uuid)",
       "tally_post_register_mark(uuid, uuid, uuid, boolean, boolean, uuid)", "tally_post_register_step(uuid, integer, uuid[])", "tally_post_register_job_changed()", "tally_post_register_apply(uuid)",
       "tally_post_register_queued()", "tally_post_ids_sync()", "tally_post_job_read_back()", "tally_post_enqueue_core(uuid, text, jsonb, uuid, text)", "tally_post_work()",
       "tally_post_register_fold(uuid)", "tally_post_work_due()", "tally_post_work_settle(uuid[])", "tally_post_work_then(uuid, text)",
       "tally_post_work_error(text, uuid, text, text)", "tally_post_resend_reserved(uuid)"]
ok(all(("revoke all on function public.%s from public, anon, authenticated;" % s) in text and ("grant execute on function public.%s to service_role;" % s) in text for s in FNS)
, "every function granted explicitly (service_role)")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == sorted(set(f.split("(")[0] for f in FNS)), "only these functions (tally_fincom_id unchanged)")
ok("revoke all on procedure public.tally_post_work_run(integer) from public, anon, authenticated;" in text and "grant execute on procedure public.tally_post_work_run(integer) to service_role;" in text
   and "security definer" not in text[text.index("create or replace procedure"):text.index("$proc$;")] and code.count("create or replace procedure") == 1, "the cron's procedure: granted explicitly, no security definer (it commits)")
ok("perform cron.schedule('tally-post-settle-itself', '* * * * *', 'call public.tally_post_work_run()');" in text and "'set statement_timeout = ''30s''; select public.tally_post_requeue()'" in text,
   "the worker's cron job CALLs the procedure alone (a SET before it would refuse its COMMITs); the requeue's carries its statement_timeout")

M184, M185 = (os.path.join(PS.SQLDIR, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql"))
st = PS.Stand(int(os.environ.get("PG201_PORT") or 31201), extra=(M184, M185, M199, M200)); db = st.db
m182 = open(os.path.join(PS.SQLDIR, "migration-182-gap-after-post.sql")).read()
t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
J = lambda n: "%08d-0000-0000-0000-000000000201" % n
TS = re.compile(r'"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+00:00"')
norm = lambda t: re.sub(r"tally_post_marks \d+", "tally_post_marks <n>", TS.sub('"<time>"', t))   # (a sequence is not rolled back: each run takes the next number)
def first_diff(a, b):
    a, b = norm(a), norm(b)
    if a.startswith("ERROR") or b.startswith("ERROR"): return (a[:300], b[:300])
    try:
        xa, xb = json.loads(a), json.loads(b)
        for k in sorted(set(xa) | set(xb)):
            if xa.get(k) != xb.get(k):
                pa, pb = xa.get(k), xb.get(k)
                if isinstance(pa, list) and isinstance(pb, list):
                    for i, (p_, q_) in enumerate(zip(pa, pb)):
                        if p_ != q_: return (k, i, {z: (p_.get(z), q_.get(z)) for z in set(p_) | set(q_) if p_.get(z) != q_.get(z)} if isinstance(p_, dict) else (p_, q_))
                    return (k, "rows", len(pa), len(pb))
                return (k, str(pa)[:200], str(pb)[:200])
        return ("same?",)
    except Exception as e: return (str(e), a[:200], b[:200])
try:
    db.sql("""create or replace function t201_try(p_sql text, p_dump text) returns text language plpgsql as $t$
      declare d text;
      begin
        begin
          execute p_sql;
          execute p_dump into d;
          raise exception using errcode = 'P0201', message = coalesce(d, '');
        exception when sqlstate 'P0201' then return sqlerrm;
                  when others then return 'ERROR: ' || sqlerrm;
        end;
      end $t$;""")
    OLD_QUEUED = db.one("select pg_get_functiondef('public.tally_post_register_queued()'::regprocedure)")
    OLD_CHANGED = db.one("select pg_get_functiondef('public.tally_post_register_job_changed()'::regprocedure)")
    OLD_SYNC = db.one("select pg_get_functiondef('public.tally_post_ids_sync()'::regprocedure)")
    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_201: not run)" % n); continue
        r = st.psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    st.grants()

    rnd = random.Random(201)
    print("== 2. the register, step by step = synchronous")
    def spell(f, e):
        c = rnd.randrange(8)
        if c == 0: return f
        if c == 1 and e: return e
        if c == 2: return re.sub(r"[^A-Za-z0-9]", "", f)
        if c == 3: return rnd.choice(["", "--"])
        if c == 4: return f.lower()
        if c == 5: return "other-%d" % rnd.randrange(5)
        return e or f
    def entry(i_d):
        x = {"id": i_d}
        for k in ("ok", "verified", "byReply", "needsReview", "accepted", "held", "postOnly", "byOwner", "sent", "outcomeUnknown", "alreadySent", "refused", "already"):
            if rnd.random() < 0.2: x[k] = rnd.choice([True, False, "true", 1])
        if rnd.random() < 0.4: x["state"] = rnd.choice(["in_tally", "sent", "failed", "unknown", "waiting", "posted", "notfound", "needs_review"])
        if rnd.random() < 0.3: x[rnd.choice(["reason", "message"])] = rnd.choice(["", "CREATED 1 LASTVCHID 52", "CREATED 0", "line error"])
        if rnd.random() < 0.3: x["created"] = rnd.choice(["1", "0", 2])
        if rnd.random() < 0.3: x["batchN"] = rnd.choice(["1", "2", 3])
        if rnd.random() < 0.3: x["batchEnd"] = rnd.choice(["", "77"])
        if rnd.random() < 0.3: x["sentAt"] = rnd.choice(["a", "b"])
        if rnd.random() < 0.1: x["vchNumber"] = "9"
        return x
    DUMP = """select jsonb_build_object(
        'reg', (select coalesce(jsonb_agg(to_jsonb(r) - 'id' order by r.fincom_id), '[]') from tally_post_register r where r.firm_id = %(f)s and r.fincom_id = any(%(fa)s::text[])),
        'hist', (select coalesce(jsonb_agg(to_jsonb(h) - 'id' - 'register_id' order by h.fincom_id, (to_jsonb(h) - 'id' - 'register_id' - 'at')::text), '[]') from tally_post_register_history h where h.firm_id = %(f)s and h.fincom_id = any(%(fa)s::text[])),
        'ids', (select coalesce(jsonb_agg(jsonb_build_array(i.job_id, i.fincom_id, i.live, i.released_at is null) order by i.job_id, i.fincom_id), '[]') from tally_post_ids i where i.firm_id = %(f)s and i.fincom_id = any(%(fa)s::text[])))::text"""
    DRAIN = "do $d$ declare o jsonb; k int := 0; begin loop o := tally_post_register_step(%s::uuid, 3); exit when o->'idle' = 'true'::jsonb or (o->'done' = 'true'::jsonb and o->>'phase' is null); k := k + 1; exit when k > 2000; end loop; end $d$;"
    bad_eq, refused, cases_n, dirty_n, steps_seen = [], 0, 0, 0, 0
    for n in range(1, 151 if os.environ.get("QUICK201") != "1" else 1):   # (QUICK201=1: while working on the timings only; never for a result)
        k_ = rnd.randrange(1, 9)
        fids = ["N%d-INV-%02d" % (n, k) if rnd.random() < 0.7 else "n%d.bank_%d" % (n, k) for k in range(k_)]
        eids = [rnd.choice([None, "n%d-e-%d" % (n, k), f]) for k, f in enumerate(fids)]
        V = [dict({"id": e if e else f}, xml="<VOUCHER VCHTYPE=\"Payment\"><DATE>202607%02d</DATE><VOUCHERNUMBER>%d</VOUCHERNUMBER><NARRATION>TDSDesk:%s</NARRATION><AMOUNT>-%d.50</AMOUNT></VOUCHER>" % (rnd.randrange(1, 29), k, f, k))
             for k, (f, e) in enumerate(zip(fids, eids))]
        if rnd.random() < 0.2: V.append(dict(V[0]))
        # an earlier posting holding some of these entries, its records in any state (its ids no longer live)
        olds = [f for f in fids if rnd.random() < 0.5]
        if olds:
            db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, created_by) values (%s, %s, 'c1', %s, 'done', %d, %s, %s)"
                   % (q(J(5000 + n)), q(F), q(CO), len(olds), q(json.dumps({"vouchers": [{"id": f, "xml": "<VOUCHER><NARRATION>TDSDesk:%s</NARRATION></VOUCHER>" % f} for f in olds]})), q(OWNER)))
            db.sql("update tally_post_ids set live = false where job_id = %s" % q(J(5000 + n)))
            db.sql("update tally_post_register r set state = (array['queued','sent','in_tally','refused','needs_review','released'])[1 + (abs(hashtext(r.fincom_id || %s)) %% 6)] where r.job_id = %s" % (q(str(n)), q(J(5000 + n))))
        st0 = rnd.choice(["waiting", "waiting", "done", "failed"])
        res = [entry(spell(f, e)) for f, e in zip(fids, eids) for _ in range(rnd.randrange(0, 3))]
        its = [entry(spell(f, e)) for f, e in zip(fids, eids) for _ in range(rnd.randrange(0, 2))]
        st1 = rnd.choice(["taken", "running", "done", "failed"])
        mid = rnd.random() < 0.35   # a change while the pass runs
        by = rnd.choice([None, OWNER])
        ins = "insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, %s, %d, %s, %s, %s)" % (
            q(J(n)), q(F), q(CO), q(st0), len(V), q(json.dumps({"vouchers": V})), q(DA), q(STAFF))
        upd = "update tally_post_jobs set status = %s, results = %s, items = %s, taken_at = now() where id = %s" % (q(st1), q(json.dumps(res)), q(json.dumps(its)), q(J(n)))
        mark = ("insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user) values (%s, %s, %s, %s, '5', 'made-up note', %s)" % (q(F), q(J(n)), q(spell(fids[0], eids[0]) or "x"), q(rnd.choice(["posted", "released"])), q(OWNER))) if rnd.random() < 0.3 else ""
        pre = ("select set_config('fincom.uid', %s, true);" % q(by)) if by else ""
        # the old: 199's triggers, all at once
        old = pre + OLD_QUEUED + ";\n" + OLD_CHANGED + ";\n" + OLD_SYNC + ";\n" + ins + ";\n" + (mark + ";\n" if mark else "") + upd + ";"
        # the new: 201's, every posting as a big one (in steps of 3), a change in the middle of a pass on some
        # (the steps follow the queue at once; a person's mark comes after, as it does in FinCom)
        new = pre + "select set_config('fincom.register_sync_max', '0', true);\n" + ins + ";\n" + DRAIN % q(J(n)) + "\n" + (mark + ";\n" if mark else "")
        if mid: new += "select tally_post_register_step(%s::uuid, 3); select tally_post_register_step(%s::uuid, 3);\n" % (q(J(n)), q(J(n)))
        new += upd + ";\n" + DRAIN % q(J(n))
        dump = DUMP % {"f": q(F), "fa": q("{" + ",".join(fids) + "}")}
        a0 = db.one("select t201_try(%s, %s)" % (q(old), q(dump))); a1 = db.one("select t201_try(%s, %s)" % (q(new), q(dump)))
        if norm(a0) != norm(a1):
            bad_eq.append((n, st0, st1, mid) + first_diff(a0, a1))
        refused += a0.startswith("ERROR"); cases_n += 1; dirty_n += mid
    ok(os.environ.get("QUICK201") == "1" or (not bad_eq and cases_n == 150 and 0 < refused < cases_n),
       "150 postings: the records, history and ids exactly as the synchronous triggers leave them (%d refused by the guard alike, %d changed mid-pass) %s" % (refused, dirty_n, bad_eq[:2]))

    print("== 2b. one pass judges every chunk by the posting as it was when the pass was prepared")
    JP = J(9100)
    VP = [{"id": "p-%02d" % k, "xml": "<VOUCHER><DATE>20261117</DATE><NARRATION>TDSDesk:p-%02d</NARRATION></VOUCHER>" % k} for k in range(9)]
    pre = "select set_config('fincom.register_sync_max', '0', false);"
    db.sql(pre + "insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, taken_at, created_by) values (%s, %s, 'c1', %s, 'taken', 9, %s, %s, now(), %s)"
           % (q(JP), q(F), q(CO), q(json.dumps({"vouchers": VP})), q(DA), q(STAFF)))
    STEP = "set role service_role; select tally_post_register_step(%s::uuid, 3)::text" % q(JP)
    for _ in range(20):   # the queue phase and the pass the queueing wanted, to its end
        o = json.loads(db.one(STEP) or "{}")
        if o.get("idle"): break
    db.sql(pre + "update tally_post_jobs set status = 'running', updated_at = now() where id = %s" % q(JP))   # a pass wanted: taken -> running (sent)
    seen = []
    for _ in range(6):
        o = json.loads(db.one(STEP) or "{}"); seen.append(o.get("phase"))
        if o.get("phase") == "judge" and o.get("done") == 3:
            # the posting changes in the middle of this pass: cancelled (it was taken: its entries need review)
            db.sql(pre + "update tally_post_jobs set status = 'cancelled', updated_at = now() where id = %s" % q(JP))
        if o.get("finished"): break
    states = db.one("select string_agg(distinct state, ',') from tally_post_register where job_id = %s" % q(JP))
    ok(o.get("finished") is True and states == "sent", "the pass that ran during the change: every chunk judged as the posting was (all sent: %s, %s)" % (states, seen))
    for _ in range(20):
        o = json.loads(db.one(STEP) or "{}")
        if o.get("idle"): break
    states = db.one("select string_agg(distinct state, ',') from tally_post_register where job_id = %s" % q(JP))
    ok(states == "needs_review" and db.one("select (done_at is not null)::text from tally_post_register_pending where job_id = %s" % q(JP)) == "true",
       "then the pass runs again for the change: every one as the posting is now (%s)" % states)
    db.sql("select set_config('fincom.register_sync_max', '', false)")

    print("== 3. two workers; a pass done again changes nothing")
    V = [{"id": "w-%04d" % k, "xml": "<VOUCHER><DATE>20261117</DATE><NARRATION>TDSDesk:w-%04d</NARRATION></VOUCHER>" % k} for k in range(30)]
    db.sql("select set_config('fincom.register_sync_max', '10', false)")
    db.sql("alter database postgres set fincom.register_sync_max = '10'")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', 30, %s, %s, %s)" % (q(J(9001)), q(F), q(CO), q(json.dumps({"vouchers": V})), q(DA), q(STAFF)))
    ok(db.one("select count(*)::text from tally_post_register where job_id = %s" % q(J(9001))) == "0" and db.one("select bool_or(queue)::text from tally_post_register_wants where job_id = %s" % q(J(9001))) == "true"
       and db.one("select count(*)::text from tally_post_register_pending where job_id = %s" % q(J(9001))) == "0",
       "a big posting queued: a pass asked for (appended), its records left to the steps (the trigger did only the guard)")
    a, b = st.pair("set role service_role; select tally_post_register_step(%s::uuid, 10)::text;" % q(J(9001)), "set role service_role; select tally_post_register_step(%s::uuid, 10)::text;" % q(J(9001)), hold=1.5, gap=0.5)
    ok('"phase": "queue"' in a and '"idle": true' in b, "two workers at the same moment: one does the step, the other is told idle (%s | %s)" % (a[-80:], b[-80:]))
    for _ in range(40): db.one("set role service_role; select tally_post_register_step(%s::uuid, 10)::text" % q(J(9001)))
    snap = db.one("select coalesce(jsonb_agg(to_jsonb(r) - 'changed_at' order by r.fincom_id), '[]')::text from tally_post_register r where r.job_id = %s" % q(J(9001)))
    ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'queued'" % q(J(9001))) == "30" and db.one("select (done_at is not null)::text from tally_post_register_pending where job_id = %s" % q(J(9001))) == "true",
       "the pass done: 30 records queued, the posting's row done")
    o = db.one("set role service_role; select tally_post_register_step(%s::uuid, 10)::text" % q(J(9001)))
    db.one("set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(J(9001)))
    for _ in range(10): db.one("set role service_role; select tally_post_register_step(%s::uuid, 10)::text" % q(J(9001)))
    ok('"idle": true' in o and db.one("select coalesce(jsonb_agg(to_jsonb(r) - 'changed_at' order by r.fincom_id), '[]')::text from tally_post_register r where r.job_id = %s" % q(J(9001))) == snap,
       "a step after it: idle; a pass again: nothing changes")
    db.sql("alter database postgres reset fincom.register_sync_max")
    print("== 3b. the duplicate guard while a big posting's records are still to be written")
    db.sql("alter database postgres set fincom.register_sync_max = '10'")
    def post(n, ids, status="waiting"):
        V_ = [{"id": x, "xml": "<VOUCHER><DATE>20261117</DATE><NARRATION>TDSDesk:%s</NARRATION></VOUCHER>" % x} for x in ids]
        try:
            db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, %s, %d, %s, %s, %s)"
                   % (q(J(n)), q(F), q(CO), q(status), len(ids), q(json.dumps({"vouchers": V_})), q(DA), q(STAFF)))
            return ""
        except RuntimeError as e: return str(e).split("CONTEXT")[0][-300:]
    ids_a = ["dg-%02d" % k for k in range(20)]
    ok(post(9201, ids_a) == "", "a big posting queued (its records left to the cron)")
    db.sql("set role service_role; update tally_post_jobs set status = 'taken', taken_at = now(), taken_by = %s where id = %s" % (q(BA), q(J(9201))))
    db.sql("set role service_role; update tally_post_jobs set status = 'cancelled', updated_at = now() where id = %s" % q(J(9201)))   # handed to its bridge, then cancelled: Tally may have them
    ok(db.one("select count(*)::text from tally_post_register where fincom_id like 'dg-%'") == "0" and db.one("select count(*)::text from tally_post_ids where job_id = %s and live" % q(J(9201))) == "0",
       "its records not written yet, its ids freed by the cancel (nothing of Tally's stamped)")
    e = post(9202, ids_a[:3])
    ok("Not queued" in e and "dg-0" in e, "another posting of the same entries: refused while the first one's records are being written (%s)" % e[-160:])
    for _ in range(40):
        if '"idle": true' in db.one("set role service_role; select tally_post_register_step(null, 2000)::text"): break
    ok(db.one("select string_agg(distinct state, ',') from tally_post_register where job_id = %s" % q(J(9201))) == "needs_review", "the cron's pass: the cancelled posting's entries need review")
    e = post(9203, ids_a[:3])
    ok("Not queued" in e and "waiting for review" in e, "and then refused by the register itself, as the synchronous guard refuses (%s)" % e[-120:])
    # never handed to a bridge: cancelled at once, its entries free to be posted again
    ids_b = ["dh-%02d" % k for k in range(20)]
    ok(post(9204, ids_b) == "", "a big posting queued")
    db.sql("set role service_role; update tally_post_jobs set status = 'cancelled', updated_at = now() where id = %s" % q(J(9204)))
    e = post(9205, ids_b[:3])
    ok(e == "", "cancelled before any bridge had it: its entries may be posted again at once (%s)" % e[-120:])
    db.sql("update tally_post_jobs set status = 'failed' where id = any(array[%s, %s]::uuid[])" % (q(J(9205)), q(J(9201))))
    db.sql("alter database postgres reset fincom.register_sync_max")
    t0 = time.time(); o = db.one("set role service_role; select tally_post_work()::text"); t = time.time() - t0
    ok(json.loads(o).get("idle") is True or json.loads(o).get("steps", 1) >= 0, "the cron's run (%s, %.2f s)" % (o[:120], t))
    o = db.one("set role service_role; select tally_post_work()::text")
    t0 = time.time(); r = st.psql_text("call public.tally_post_work_run();"); t = time.time() - t0
    ok(r.returncode == 0 and t < 0.5, "the cron's procedure with nothing to do: at once (%.2f s) %s" % (t, (r.stderr or "")[-200:]))
    plan = "\n".join(list(r.values())[0] for r in db.rows("explain select 1 from tally_post_register_pending p where p.done_at is null"))
    ok(json.loads(o).get("idle") is True and "tally_post_register_pending_open" in plan, "nothing to do: the cron is one indexed look (%s)" % plan.splitlines()[0][:80])

    print("== 6. never twice: an entry released by itself stays its posting's until that posting has handed it back")
    ME = "00000000-0000-0000-0000-000000000200"
    st.setbeat(DA, st.beat("made-up-a", BA, [CO])); db.sql("update tally_devices set last_seen = now()")
    vx = lambda x: {"id": x, "xml": "<VOUCHER VCHTYPE=\"Payment\"><DATE>20261117</DATE><NARRATION>TDSDesk:%s</NARRATION><AMOUNT>-5.00</AMOUNT></VOUCHER>" % x}
    def enq(jid, xs): return st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(jid), q(json.dumps({"masters": [], "vouchers": [vx(x) for x in xs]}))))
    def held_p(n, xs, accepted=()):   # a posting of xs its bridge had, held for checking; every entry 'not seen' by that bridge, FinCom's read of Tally complete
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, taken_by, taken_at, created_by) values (%s, %s, 'c1', %s, 'running', %d, %s, %s, %s, now() - interval '50 minutes', %s)"
               % (q(J(n)), q(F), q(CO), len(xs), q(json.dumps({"vouchers": [vx(x) for x in xs]})), q(DA), q(BA), q(STAFF)))
        for x in accepted: db.one("set role service_role; select tally_post_id_accept(%s::uuid, %s, null)::text" % (q(J(n)), q(x)))
        db.sql("update tally_post_jobs set status = 'done', checking = true, items = %s, message = 'Held (made-up)', updated_at = now() - interval '40 minutes' where id = %s" % (q(json.dumps([{"id": x, "kind": "voucher", "state": "sent"} for x in xs])), q(J(n))))
        db.sql("insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, at) values (%s, %s, %s, %s, 100, 120, 0, now() - interval '20 minutes')" % (q(F), q(PS.BK), q(J(n)), q(DA)))
        db.sql("insert into tally_sync_cursor (book_id, firm_id, start_at, match_start, match_alter, match_at) values (%s, %s, '2026-11-01', '2026-11-01', 125, now()) on conflict (book_id) do update set start_at = '2026-11-01', match_start = '2026-11-01', match_alter = greatest(tally_sync_cursor.match_alter, 125), match_at = now()" % (q(PS.BK), q(F)))
        for x in xs:
            db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device, auto) values (%s, %s, %s, %s, %s, 'made-up', 'notseen', now(), %s, %s, true)"
                   % (q(F), q(J(n)), q(x), q(CO), q(ME), q(BA), q(DA)))
        o = json.loads(db.one("set role service_role; select tally_post_settle_itself(%s::uuid)::text" % q(J(n))) or "{}")
        if o.get("register"): db.one("set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(J(n)))
        return o
    WAITING = "already waiting to be posted in an earlier posting"
    # (a) the hand-back held by an entry a person must settle (Tally accepted it): C; X proven not in Tally, released
    C, X, Y = "dx-c", "dx-x", "dx-y"
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'failed', 1, %s, %s, %s)"
           % (q(J(9310)), q(F), q(CO), q(json.dumps({"vouchers": [vx(X)]})), q(DA), q(STAFF)))   # an older posting of X that failed (never taken): its Retry below
    o = held_p(9301, [C, X], accepted=[C])
    r = json.loads(db.one("select (to_jsonb(j) - 'payload')::text from tally_post_jobs j where id = %s" % q(J(9301))))
    ok(o.get("released") == 1 and len(o.get("conflicts") or []) == 1 and r["status"] == "done" and not r["checking"], "X released by itself; its hand-back waits for a person on C (%s)" % (r["message"] or "")[:120])
    e1 = enq(J(9302), [X])
    ok(e1.get("ok") is False and WAITING in (e1.get("error") or "") and [d.get("job") for d in e1.get("dupes") or []] == [J(9301)],
       "X posted again meanwhile: refused, already being posted by its posting, which sends it again by itself (%s)" % json.dumps(e1)[:240])
    e2 = enq(J(9303), [X, Y])
    ok(e2.get("ok") is True and [d.get("id") for d in e2.get("dupes") or []] == [X] and db.one("select string_agg(fincom_id, ',') from tally_post_ids where job_id = %s" % q(J(9303))) == Y,
       "X with another entry: the other queued alone, X answered as held by that posting (%s)" % json.dumps(e2)[:200])
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(9303)))
    e3 = post(9304, [X])
    ok("Not queued" in e3 and X in e3 and J(9301)[:8] in e3, "the same by any other way into the queue: refused by the queue's own guard (%s)" % e3[-200:])
    e4 = enq(J(9310), [X])
    ok(e4.get("ok") is False and "being posted in another posting" in (e4.get("error") or ""), "a Retry of an older posting of X: refused too (%s)" % json.dumps(e4)[:200])
    db.one("set role service_role; select tally_post_mark_core(%s::uuid, %s::uuid, %s::uuid, %s, 'V1', 'made-up: found in Tally')::text" % (q(F), q(OWNER), q(J(9301)), q(C)))
    db.one("set role service_role; select tally_post_settle_resend_due()::text")
    r = json.loads(db.one("select (to_jsonb(j) - 'payload')::text from tally_post_jobs j where id = %s" % q(J(9301))))
    ok(r["status"] == "waiting" and r["resend_only"] == [X], "a person settles C: X handed back by its own posting, alone (%s)" % r["resend_only"])
    e5 = enq(J(9305), [X])
    ok(e5.get("ok") is False and WAITING in (e5.get("error") or ""), "and while it is being sent again: refused as before (%s)" % (e5.get("error") or "")[:120])
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(9301)))
    # (b) no conflict: the brief window between the settling's COMMIT and its hand-back (or the hand-back finding the posting locked)
    X2 = "dx-x2"
    o = held_p(9311, [X2])
    ok(o.get("resend") is True and o.get("released") == 1, "X2 released by itself, to be handed back")
    e6 = enq(J(9312), [X2])
    ok(e6.get("ok") is False and WAITING in (e6.get("error") or ""), "posted again before the hand-back: refused (%s)" % json.dumps(e6)[:200])
    a, b = st.pair("set role service_role; select 1 from tally_post_jobs where id = %s for update;" % q(J(9311)), "set role service_role; select tally_post_settle_resend(%s::uuid)::text;" % q(J(9311)), hold=1.0, gap=0.3)
    ok('"busy": true' in b and enq(J(9313), [X2]).get("ok") is False, "the hand-back finds the posting locked (busy): still refused (%s)" % b[-80:])
    db.one("set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(J(9311)))   # (a report's pass meanwhile: the record says released)
    ok(db.one("select state from tally_post_register where fincom_id = %s" % q(X2)) == "released", "X2's record: released")
    db.sql("alter database postgres set fincom.register_sync_max = '0'")   # (the register's pass of the hand-back left to the steps: its record still says released)
    o = json.loads(db.one("set role service_role; select tally_post_settle_resend(%s::uuid)::text" % q(J(9311))) or "{}")
    ok(o.get("resent") is True and enq(J(9314), [X2]).get("ok") is False, "handed back: still refused while it is sent again")
    e7 = post(9315, [X2])
    ok("Not queued" in e7 and J(9311)[:8] in e7, "and by any other way in, before the register has followed the hand-back (%s)" % e7[-160:])
    db.sql("alter database postgres reset fincom.register_sync_max")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(9311)))
    for _ in range(20):
        if '"idle": true' in db.one("set role service_role; select tally_post_register_step(null, 2000)::text"): break

    print("== 7. one bad item never stops the cron: a posting deleted with its pass asked for, a hand-back and a register pass that fail")
    F2 = "99999999-9999-9999-9999-999999999201"
    db.sql("insert into firms values (%s, 'Made-up Firm 201b') on conflict do nothing" % q(F2))
    db.sql("alter database postgres set fincom.register_sync_max = '2'")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, created_by) values (%s, %s, 'z1', 'Made-up Gone Co', 'waiting', 3, %s, %s)"
           % (q(J(9401)), q(F2), q(json.dumps({"vouchers": [vx("gone-%d" % k) for k in range(3)]})), q(STAFF)))
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, created_by) values (%s, %s, 'c1', %s, 'waiting', 3, %s, %s)"
           % (q(J(9402)), q(F), q(CO), q(json.dumps({"vouchers": [vx("poison-%d" % k) for k in range(3)]})), q(STAFF)))
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, created_by) values (%s, %s, 'c1', %s, 'waiting', 3, %s, %s)"
           % (q(J(9403)), q(F), q(CO), q(json.dumps({"vouchers": [vx("good-%d" % k) for k in range(3)]})), q(STAFF)))
    db.sql("alter database postgres reset fincom.register_sync_max")
    try: db.sql("delete from firms where id = %s" % q(F2))   # the firm deleted: its posting goes (cascade); the pass asked for stays (no reference)
    except RuntimeError: db.sql("delete from tally_post_jobs where id = %s" % q(J(9401)))
    # the oldest asked first: the gone one, then the poisoned one, then the good one
    db.sql("update tally_post_register_wants set at = now() - interval '3 minutes' where job_id = %s; update tally_post_register_wants set at = now() - interval '2 minutes' where job_id = %s" % (q(J(9401)), q(J(9402))))
    db.sql("""create or replace function t201_poison() returns trigger language plpgsql as $t$ begin
                if new.fincom_id like 'poison-%%' then raise exception 'made-up poison (register)'; end if; return new; end $t$;
              create trigger t201_poison before insert on tally_post_register for each row execute function t201_poison();
              create or replace function t201_poison_j() returns trigger language plpgsql as $t$ begin
                if new.id = %s::uuid and new.status = 'waiting' then raise exception 'made-up poison (hand-back)'; end if; return new; end $t$;
              create trigger t201_poison_j before update on tally_post_jobs for each row execute function t201_poison_j();""" % q(J(9406)))
    # a posting settled with an entry proven not in Tally, waiting for its hand-back, whose hand-back fails; and a good one
    for n, x in ((9406, "dz-p"), (9407, "dz-g")):
        held_p(n, [x]); db.sql("update tally_post_jobs set checking = false where id = %s" % q(J(n)))
    db.sql("update tally_post_jobs set status = 'failed' where status in ('waiting', 'taken', 'running') and id <> all(array[%s, %s]::uuid[])" % (q(J(9402)), q(J(9403))))
    t0 = time.time(); r = st.psql_text("call public.tally_post_work_run(10);"); t = time.time() - t0
    ok(r.returncode == 0, "the cron's run goes through (%.1f s) %s" % (t, (r.stderr or "").strip()[-300:]))
    ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'queued'" % q(J(9403))) == "3"
       and db.one("select (done_at is not null)::text from tally_post_register_pending where job_id = %s" % q(J(9403))) == "true", "the good posting's register written all the same")
    ok(db.one("select status from tally_post_jobs where id = %s" % q(J(9407))) == "waiting", "the good hand-back done all the same")
    ok(db.one("select count(*)::text from tally_post_register_wants where job_id = %s" % q(J(9401))) == "0", "the deleted posting's asked-for pass dropped")
    errs = db.one("select coalesce(string_agg(kind || ':' || left(job_id::text, 8) || ':' || words, ' | '), '') from tally_post_work_errors") if db.one("select (to_regclass('public.tally_post_work_errors') is not null)::text") == "true" else ""
    ok("made-up poison (register)" in errs and J(9402)[:8] in errs, "the register's error kept, not silent: %s" % errs[:200])
    ok("made-up poison (hand-back)" in (db.one("select words from tally_post_self_settle where job_id = %s" % q(J(9406))) or ""), "the hand-back's error kept with its posting")
    r = st.psql_text("call public.tally_post_work_run(5);")
    ok(r.returncode == 0 and db.one("select count(*)::text from tally_post_work_errors where job_id = %s" % q(J(9402))) == "1" if errs else False, "run again: the same one row a bad posting, counted (bounded)")
    db.sql("drop trigger t201_poison on tally_post_register; drop trigger t201_poison_j on tally_post_jobs")
    db.sql("update tally_post_jobs set status = 'failed' where id = any(array[%s, %s, %s, %s]::uuid[]); delete from tally_post_register_wants where job_id = %s" % (q(J(9402)), q(J(9403)), q(J(9406)), q(J(9407)), q(J(9401))))
    for _ in range(40):
        try:
            if '"idle": true' in db.one("set role service_role; select tally_post_register_step(null, 2000)::text"): break
        except RuntimeError as x: print("  (cleanup: %s)" % str(x)[:120]); break

    print("== 8. a want appended late (a lower number committed after the step looked) is never removed unfolded")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, created_by) values (%s, %s, 'c1', %s, 'failed', 1, %s, %s)" % (q(J(9501)), q(F), q(CO), q(json.dumps({"vouchers": [vx("late-0")]})), q(STAFF)))
    db.sql("delete from tally_post_register_wants where job_id = %s" % q(J(9501)))
    db.sql("""create or replace function t201_slow() returns trigger language plpgsql as $t$ begin if new.job_id = %s::uuid then perform pg_sleep(1.5); end if; return new; end $t$;
              create trigger t201_slow before insert or update on tally_post_register_pending for each row execute function t201_slow();""" % q(J(9501)))
    mk_w = "insert into tally_post_register_wants (job_id, firm_id) values (%s, %s);" % (q(J(9501)), q(F))
    a, b = st.pair(mk_w, mk_w + " select tally_post_register_fold(%s::uuid);" % q(J(9501)), hold=1.0, gap=0.3)
    db.sql("drop trigger t201_slow on tally_post_register_pending")
    ok(db.one("select count(*)::text from tally_post_register_wants where job_id = %s" % q(J(9501))) == "1", "the late one kept for the next step (%s | %s)" % (a[-60:], b[-60:]))
    for _ in range(10):
        if '"idle": true' in db.one("set role service_role; select tally_post_register_step(null, 2000)::text"): break
    ok(db.one("select count(*)::text from tally_post_register_wants where job_id = %s" % q(J(9501))) == "0", "and folded by it")

    print("== 9. 200 run again after 201 leaves the cron's command 201's")
    # (the stand's pg_cron stand-in: 47's cron.schedule and cron.job)
    if not RED:
        r1 = st.psql_text(text); r2 = st.psql_text(open(M200).read())
        ok(r1.returncode == 0 and r2.returncode == 0 and db.one("select command from cron.job where jobname = 'tally-post-settle-itself'") == "call public.tally_post_work_run()",
           "after 201, then 200 again: %s" % db.one("select command from cron.job where jobname = 'tally-post-settle-itself'"))
    else: ok(False, "9 (RED_WITHOUT_201: not run)")

    def together(JB, V, tm):
        """5. the cron's worker at work (a held posting of 20,000 settled, a new one of 20,000 recorded and judged in steps)
        while the bridge reports: a status report (with the register's step after it, as tally-ingest does) and a check
        report (with the settling after it) on both postings. The review (18-Nov-2026): the worker ran as one transaction of
        25-40 s holding the rows a report writes, so each report waited for it and hit the 8 s statement timeout."""
        print("== 5. the worker and the bridge's reports at the same moment (20,000)")
        N = len(V); JC = "%08d-0000-0000-0000-000000000201" % 777
        VC = [{"id": "c-%05d" % k, "xml": "<VOUCHER VCHTYPE=\"Payment\"><DATE>20261117</DATE><NARRATION>TDSDesk:c-%05d</NARRATION><AMOUNT>-%d.00</AMOUNT></VOUCHER>" % (k, 100 + k % 900)} for k in range(N)]
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, taken_by, taken_at, created_by) values (%s, %s, 'c1', %s, 'running', %d, %s, %s, %s, now(), %s)"
               % (q(JC), q(F), q(CO), N, q(json.dumps({"masters": [], "vouchers": VC})), q(DA), q(BA), q(STAFF)))
        # the held one again: done, checking, its entries read back but some (the checks below wait)
        db.sql("update tally_post_jobs set status = 'done', checking = true, resend_only = null, updated_at = now() - interval '5 minutes' where id = %s" % q(JB))
        mk = lambda job, e: int(db.one("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why) values (%s, %s, %s, %s, %s, 'made-up') returning id" % (q(F), q(job), q(e), q(CO), q(OWNER))))
        cb, cc = mk(JB, V[5]["id"]), mk(JC, VC[5]["id"])
        # a check report "found" marks the entry posted (55's tally_post_mark_core: a pass over the whole posting): its own
        # time, the worker not running, to compare with the same report while the worker runs
        cb0, cb2 = mk(JB, V[6]["id"]), mk(JB, V[7]["id"])
        t0 = time.time(); db.one("set role service_role; select tally_post_check_report(%d, %s::uuid, %s, true, %s, 'found', '56', '7056', '')::text" % (cb0, q(DA), q(BA), q(CO)))
        alone = time.time() - t0
        print("  %6.2f s  (a check report 'found' on the held posting, the worker not running: the report's own work)" % alone)
        db.sql("update tally_post_jobs set status = 'done', checking = true where id = %s" % q(JB))
        has_proc = db.one("select (to_regprocedure('public.tally_post_work_run(integer)') is not null)::text") == "true"
        worker = "call public.tally_post_work_run();" if has_proc else "set role service_role; set statement_timeout = '40s'; select public.tally_post_work();"
        t_w = time.time()
        pa = subprocess.Popen(st._cmd() + ["-At", "-f", "-"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        pa.stdin.write("set application_name = 't201worker';\n" + worker + "\n"); pa.stdin.close()
        ages, stop = [], [False]
        def watch():   # how long the worker's transaction has been open, sampled
            while not stop[0]:
                try: a = db.one("select coalesce(max(extract(epoch from clock_timestamp() - xact_start)), 0)::text from pg_stat_activity where application_name = 't201worker' and state <> 'idle'")
                except RuntimeError: a = None
                if a: ages.append(float(a))
                time.sleep(0.1)
        th = threading.Thread(target=watch, daemon=True); th.start()
        rep = {}
        def timed_(name, stmt):
            t0 = time.time()
            try: out = db.one("set statement_timeout = '8s'; " + stmt); e = ""
            except RuntimeError as x: out, e = None, str(x)[-200:]
            t = time.time() - t0; rep[name] = max(rep.get(name, (0, "")), (t, e)); tm["5. " + name] = max(tm.get("5. " + name, 0), t)
            return out
        time.sleep(0.4)   # the worker settling the held posting
        timed_("check report 'not seen', held posting (tally_post_check_report)", "set role service_role; select tally_post_check_report(%d, %s::uuid, %s, true, %s, 'notseen', '', '', '')::text" % (cb, q(DA), q(BA), q(CO)))
        timed_("its settling (tally_post_settle_itself)", "set role service_role; select tally_post_settle_itself(%s::uuid)::text" % q(JB))
        t0 = time.time(); db.one("set role service_role; set statement_timeout = '8s'; select tally_post_check_report(%d, %s::uuid, %s, true, %s, 'found', '57', '7057', '')::text" % (cb2, q(DA), q(BA), q(CO)))
        found_w = time.time() - t0; tm["5. check report 'found', held posting (55's mark: its own work)"] = found_w
        time.sleep(1.5)   # the worker recording the new one's entries, then judging them
        res = [{"id": VC[k]["id"], "kind": "voucher", "ok": True, "byReply": True, "batchN": 50, "batchEnd": str(300000 + (k // 50) * 50 + 49), "sentAt": "2026-11-18T11:00:00Z", "created": 50, "state": "posted"} for k in range(N // 10)]
        for rnd_ in range(3):
            timed_("status report (the posting written, its triggers)", "set role service_role; update tally_post_jobs set status = 'running', done = %d, results = %s, seq = %d, updated_at = now() where id = %s" % (len(res), q(json.dumps(res)), 10 + rnd_, q(JC)))
            timed_("its register step (tally_post_register_apply)", "set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(JC))
            if rnd_ == 0:
                timed_("check report, posting being judged (tally_post_check_report)", "set role service_role; select tally_post_check_report(%d, %s::uuid, %s, true, %s, 'notseen', '', '', '')::text" % (cc, q(DA), q(BA), q(CO)))
                timed_("its settling, not held (tally_post_settle_itself)", "set role service_role; select tally_post_settle_itself(%s::uuid)::text" % q(JC))
            time.sleep(1.0)
        o, e = pa.stdout.read(), pa.stderr.read(); pa.wait(); t_w = time.time() - t_w
        stop[0] = True; th.join()
        for k, (t, er) in rep.items(): print("  %6.2f s  %s %s" % (t, k, er))
        ok(all(not er and t < 1.5 for (t, er) in rep.values()), "every report answered in under 1.5 s while the worker runs (slowest %.2f s)" % max(t for (t, er) in rep.values()))
        ok(found_w < alone + 0.5, "a check report 'found' while the worker runs takes its own time, no wait for the worker (%.2f s; alone %.2f s)" % (found_w, alone))
        ok(pa.returncode == 0, "the worker's run: %.1f s %s" % (t_w, (e or "").strip()[-300:]))
        ok(ages and max(ages) < 2.0, "the worker never holds one transaction open long (longest seen %.2f s of %d looks)" % (max(ages or [0]), len(ages)))
        # the worker finishes the rest; the reports' changes all followed
        for _ in range(60):
            o = db.one("set role service_role; select tally_post_register_step(null, 2000)::text")
            if '"idle": true' in (o or ""): break
        ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'in_tally'" % q(JC)) == str(N // 10)
           and db.one("select count(*)::text from tally_post_register where job_id = %s" % q(JC)) == str(N), "the register of the new posting follows its last report (%s in Tally)" % (N // 10))
        db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(JC))
    def big(N, label, via_enqueue):
        print("== 4. %s entries" % label)
        db.sql("update tally_post_jobs set status = 'failed' where status in ('waiting', 'taken', 'running')"); db.sql("update tally_post_jobs set checking = false where checking")
        st.setbeat(DA, st.beat("made-up-a", BA, [CO])); db.sql("update tally_devices set last_seen = now()")
        LIMIT = 1.5 if N <= 20000 else 7.5
        JB = "%08d-0000-0000-0000-000000000201" % (100000 + N)
        days = ["2026%02d%02d" % (m, d) for m in (4, 5, 6, 7, 8, 9, 10) for d in (3, 9, 15, 21, 27)]
        V = [{"id": "b%d-%05d" % (N, k), "xml": "<VOUCHER VCHTYPE=\"Payment\"><DATE>%s</DATE><NARRATION>TDSDesk:g%d-%05d</NARRATION><AMOUNT>-%d.00</AMOUNT></VOUCHER>" % (days[k % len(days)], N, k, 100 + k % 900)} for k in range(N)]
        tm = {}
        def step(name, stmt, uid=None, limit=None):
            t0 = time.time()
            try: out = db.one("set statement_timeout = '8s'; " + stmt, uid); e = ""
            except RuntimeError as x: out, e = None, str(x)[-300:]
            t = time.time() - t0; tm[name] = max(tm.get(name, 0), t)
            if e or t >= (limit or LIMIT): ok(False, "%s: %.2f s %s" % (name, t, e))
            return out
        def drain(name):
            k = 0
            while k < 200:
                o = step(name, "set role service_role; select tally_post_register_step(%s::uuid, 2000)::text" % q(JB))
                if not o or '"idle": true' in o: break
                k += 1
            return k
        if via_enqueue:
            out = step("queued (tally_post_enqueue_to, the staff member)", "set role authenticated; select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(JB), q(json.dumps({"masters": [], "vouchers": V}))), STAFF)
            ok(bool(out) and json.loads(out).get("ok") is True, "queued: %s" % (out or "")[:120])
        else:   # (more than the queue's 8 MB: queued as the queue stores it)
            step("queued (the posting stored, its triggers)", "insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', %d, %s, %s, %s)"
                 % (q(JB), q(F), q(CO), N, q(json.dumps({"masters": [], "vouchers": V})), q(DA), q(STAFF)))
        ok(db.one("select count(*)::text from tally_post_ids where job_id = %s and live" % q(JB)) == str(N), "its %d ids live at once (the guard against a second posting)" % N)
        nq = drain("a register step (2,000 a step)")
        ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'queued'" % q(JB)) == str(N), "the register: %d queued after %d steps" % (N, nq))
        out = step("taken (tally_post_take_for)", "set role service_role; select string_agg(id::text, ',') from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA)))
        ok(JB in (out or ""), "the bridge takes it")
        step("running (the first report)", "set role service_role; update tally_post_jobs set status = 'running', updated_at = now() where id = %s" % q(JB))
        PART = N // 20
        res, its = [], [{"id": v["id"], "kind": "voucher", "state": "waiting"} for v in V]
        for p in range(20):
            new = [{"id": V[k]["id"], "kind": "voucher", "ok": True, "byReply": True, "batchN": 50, "batchEnd": str(100000 + (k // 50) * 50 + 49), "sentAt": "2026-11-18T10:%02d:00Z" % p,
                    "created": 50, "state": "posted", "message": "Posted by Tally's reply"} for k in range(p * PART, (p + 1) * PART)]
            res += new
            for x in new: its[int(x["id"].split("-")[1])]["state"] = "posted"
            step("stamped (tally_post_id_accept_many, a report)", "set role service_role; select tally_post_id_accept_many(%s::uuid, %s::jsonb)::text" % (q(JB), q(json.dumps([{"id": x["id"], "reply": True, "batchEnd": x["batchEnd"], "batchN": 50} for x in new]))))
            last = p == 19
            step("the report written" if not last else "the report moving it to done",
                 "set role service_role; update tally_post_jobs set status = %s, done = %d, results = %s, items = %s, seq = %d, updated_at = now() where id = %s"
                 % (q("done" if last else "running"), len(res), q(json.dumps(res)), q(json.dumps(its)), p + 2, q(JB)))
            o = step("the register after a report (tally_post_register_apply: one step)", "set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(JB))
            if p == 5:
                pr = json.loads(db.one("select to_jsonb(p) - 'vlist' - 'maps' from tally_post_register_pending p where job_id = %s" % q(JB)) or "{}")
                ok(db.one("select count(*)::text from tally_post_jobs j, jsonb_array_elements(j.results) r where j.id = %s and r->>'ok' = 'true'" % q(JB)) == str(6 * PART) and "register" in (pr.get("words") or ""),
                   "while the steps run: the posting shows its %d posted entries at once; the register says how far it is (%s)" % (6 * PART, pr.get("words")))
        ok(db.one("select status || '/' || checking::text from tally_post_jobs where id = %s" % q(JB)) == "done/false", "done, nothing to check")
        drain("a register step (2,000 a step)")
        ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'in_tally'" % q(JB)) == str(N), "the register: all %d in Tally after its steps" % N)
        ok(db.one("select count(*)::text from tally_light_days where why = 'post'") != "0", "its days queued to be read back (182)")
        # held: the cron finds it silent with entries unconfirmed (its last reports lost), FinCom's read-back has them all
        db.sql("update tally_post_jobs set status = 'running', results = %s, items = '[]', updated_at = now() - interval '40 minutes' where id = %s" % (q(json.dumps(res[:N * 3 // 4])), q(JB)))
        db.sql("update tally_devices set last_seen = now() - interval '1 hour', info = '{}'")
        step("the cron's requeue (holds it)", "select tally_post_requeue()::text")
        st.setbeat(DA, st.beat("made-up-a", BA, [CO]))
        ok(db.one("select status || '/' || checking::text from tally_post_jobs where id = %s" % q(JB)) == "done/true", "held by the requeue")
        db.sql("update tally_post_ids set matched_at = now(), matched_vch = 'V' where job_id = %s and fincom_id <= %s" % (q(JB), q("g%d-%05d" % (N, N - N // 50 - 1))))
        # (the last N/50: nothing of Tally's says it took them, their reports lost before any stamp: 200 releases only such)
        db.sql("update tally_post_ids set accepted_at = null, reply_vch = null, batch_end = null, batch_n = null where job_id = %s and matched_at is null" % q(JB))
        db.sql("insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, at) values (%s, %s, %s, %s, 1, 100, 0, now() - interval '5 minutes') on conflict (job_id) do nothing" % (q(F), q(PS.BK), q(JB), q(DA)))
        db.sql("insert into tally_sync_cursor (book_id, firm_id, start_at, match_start, match_alter, match_at) values (%s, %s, '2026-11-01', '2026-11-01', 200, now()) on conflict (book_id) do update set match_alter = 200, match_at = now(), start_at = '2026-11-01', match_start = '2026-11-01'" % (q(PS.BK), q(F)))
        db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device, auto) select %s, %s, i.entry_id, %s, '00000000-0000-0000-0000-000000000200', 'made-up', 'notseen', now(), %s, %s, true from tally_post_ids i where i.job_id = %s and i.matched_at is null"
               % (q(F), q(JB), q(CO), q(BA), q(DA), q(JB)))
        o = step("settle itself (200: read back -> posted, proven absent -> released)", "set role service_role; select tally_post_settle_itself(%s::uuid)::text" % q(JB))
        o = json.loads(o or "{}")
        ok(o.get("released") == N // 50 and o.get("resend") is True, "settled: %s posted by itself, %s released" % (o.get("found"), o.get("released")))
        step("the hand-back (tally_post_settle_resend: the change of status)", "set role service_role; select tally_post_settle_resend(%s::uuid)::text" % q(JB))
        ok(db.one("select status from tally_post_jobs where id = %s" % q(JB)) == "waiting", "handed back: waiting for those %d alone" % (N // 50))
        drain("a register step (2,000 a step)")
        ok(db.one("select (done_at is not null)::text from tally_post_register_pending where job_id = %s" % q(JB)) == "true", "the register's pass done after the hand-back")
        o = step("the worker's one transaction (tally_post_work: about a second)", "set role service_role; select tally_post_work()::text", limit=LIMIT + 0.5)
        ok(bool(o) and json.loads(o).get("ok") is True, "tally_post_work: one bounded transaction (%s)" % (o or "")[:160])
        t0 = time.time(); r = st.psql_text("call public.tally_post_work_run();"); t = time.time() - t0
        ok(r.returncode == 0 and t < 30, "the cron's run (call tally_post_work_run) is bounded (%.1f s) %s" % (t, (r.stderr or "")[-200:]))
        if N == 20000: together(JB, V, tm)
        print("  %s entries:" % label)
        for k, v in sorted(tm.items(), key=lambda kv: -kv[1]): print("  %6.2f s  %s" % (v, k))
        # (55's mark of a check found, a pass over the whole posting, is not of this branch: timed and shown, not held to the limit)
        ok(all(v < LIMIT for k, v in tm.items() if "55's mark" not in k), "every statement under %.1f s at %s" % (LIMIT, label))
        return tm
    if BIG:
        big(20000, "20,000", True)
        if os.environ.get("QUICK201") != "1": big(50000, "50,000", False)
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
