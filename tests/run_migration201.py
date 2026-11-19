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
import os, re, sys, json, random, time, hashlib, csv
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
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and code.count("create table") == 1 and "create trigger" not in code
   and code.count("create index if not exists") == 1 and "alter table public.tally_post_register_pending enable row level security" in code and code.count("alter table") == 1,
   "add-only: one table and its index; no trigger; nothing dropped, deleted or truncated")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
FNS = ["tally_post_register_maps(public.tally_post_jobs)", "tally_post_register_judged_part(public.tally_post_jobs, jsonb, jsonb, jsonb, jsonb)",
       "tally_post_register_apply_part(public.tally_post_jobs, uuid, jsonb, jsonb, jsonb, jsonb)", "tally_post_register_queue_part(public.tally_post_jobs, text[], boolean, uuid)",
       "tally_post_register_mark(uuid, uuid, uuid, boolean, boolean, uuid)", "tally_post_register_step(uuid, integer)", "tally_post_register_job_changed()", "tally_post_register_apply(uuid)",
       "tally_post_register_queued()", "tally_post_ids_sync()", "tally_post_job_read_back()", "tally_post_enqueue_core(uuid, text, jsonb, uuid, text)", "tally_post_work()"]
ok(all(("revoke all on function public.%s from public, anon, authenticated;" % s) in text and ("grant execute on function public.%s to service_role;" % s) in text for s in FNS)
, "every function granted explicitly (service_role)")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == sorted(set(f.split("(")[0] for f in FNS)), "only these functions (tally_fincom_id unchanged)")
ok("'set statement_timeout = ''40s''; select public.tally_post_work()'" in text and "'set statement_timeout = ''30s''; select public.tally_post_requeue()'" in text, "both cron jobs carry their own statement_timeout")

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
    for n in range(1, 151):
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
    ok(not bad_eq and cases_n == 150 and 0 < refused < cases_n,
       "150 postings: the records, history and ids exactly as the synchronous triggers leave them (%d refused by the guard alike, %d changed mid-pass) %s" % (refused, dirty_n, bad_eq[:2]))

    print("== 3. two workers; a pass done again changes nothing")
    V = [{"id": "w-%04d" % k, "xml": "<VOUCHER><DATE>20261117</DATE><NARRATION>TDSDesk:w-%04d</NARRATION></VOUCHER>" % k} for k in range(30)]
    db.sql("select set_config('fincom.register_sync_max', '10', false)")
    db.sql("alter database postgres set fincom.register_sync_max = '10'")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', 30, %s, %s, %s)" % (q(J(9001)), q(F), q(CO), q(json.dumps({"vouchers": V})), q(DA), q(STAFF)))
    ok(db.one("select count(*)::text from tally_post_register where job_id = %s" % q(J(9001))) == "0" and db.one("select (done_at is null and queue)::text from tally_post_register_pending where job_id = %s" % q(J(9001))) == "true",
       "a big posting queued: marked, its records left to the steps (the trigger did only the guard)")
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
    t0 = time.time(); o = db.one("set role service_role; select tally_post_work()::text"); t = time.time() - t0
    ok(json.loads(o).get("idle") is True or json.loads(o).get("steps", 1) >= 0, "the cron's run (%s, %.2f s)" % (o[:120], t))
    o = db.one("set role service_role; select tally_post_work()::text")
    plan = "\n".join(list(r.values())[0] for r in db.rows("explain select 1 from tally_post_register_pending p where p.done_at is null"))
    ok(json.loads(o).get("idle") is True and "tally_post_register_pending_open" in plan, "nothing to do: the cron is one indexed look (%s)" % plan.splitlines()[0][:80])

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
        t0 = time.time(); o = db.one("set role service_role; set statement_timeout = '40s'; select tally_post_work()::text"); t = time.time() - t0
        ok(t < 30 and json.loads(o).get("ok") is True, "the cron's busy run is bounded (%.1f s)" % t)
        print("  %s entries:" % label)
        for k, v in sorted(tm.items(), key=lambda kv: -kv[1]): print("  %6.2f s  %s" % (v, k))
        ok(all(v < LIMIT for v in tm.values()), "every statement under %.1f s at %s" % (LIMIT, label))
        return tm
    if BIG:
        big(20000, "20,000", True)
        big(50000, "50,000", False)
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
