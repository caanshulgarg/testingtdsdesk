"""python3 run_migration199.py - server/tally-cloud/migration-199-post-match-fast.sql (18-Nov-2026, branch
next-fix-posttimeout). A big posting's final report timed out on staging: the bridge's update of the posting's status ran the
sync trigger (tally_post_ids_sync) and tally_post_job_accepted, which compared every id of the posting with every id of its
results and items through tally_post_id_match (four regexp_replace per pair): about a million regexps for 660 entries,
over the 8 s statement timeout, so the update was rolled back and the bridge reported again every few seconds. The owner's
aim (18-Nov-2026): a posting of 20,000 entries never stuck. So every step of the posting path that matched pair by pair is
made linear: tally_post_job_accepted, tally_post_ids_sync, tally_post_job_settle (Mark posted / Not in Tally), the posting
register's judge (run after every report), and each acceptance's stamp (an index of the posting's own ids; many in one call).
On a throwaway PostgreSQL (post_queue_stand: pg_stand, port 31199 unless PG199_PORT; never a real database; with 182's
read-back of a posting done: its light days, function and trigger), made-up firms, companies and entries only. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (no table, column or trigger; three indexes of tally_post_ids,
     if not there; nothing dropped, deleted or truncated); only the functions named replaced, each from its latest text
     (the text staging runs: md5 of prosrc before the file), with only the matching lines changed; one function new; every
     grant explicit, as on staging; names no real database; runs twice
  1. the same answers: 300 made-up postings (every spelling of an id: the tag, FinCom's entry id, either in letters and
     digits, empty, punctuation only, unrelated; accepted, confirmed, released, needs review, post-only, held, Tally's
     words, batches, owner's marks): tally_post_job_accepted, tally_post_job_settle (4 statuses x 3 checkings) and the
     register's judge (every status, resend_only) give exactly what the old text (kept here as reference copies) gives;
     the sync leaves exactly the ids live that the old rule leaves; a stamp finds exactly the ids tally_post_id_match finds
     a report's acceptances in one call stamp exactly as the one-by-one calls do
  2. a posting of 1500 entries: the report moving it to done under an 8 s statement timeout in under 2 s; settle, an
     owner's Mark posted and Not in Tally each in under 2 s; the cron's requeue; set failed: no id Tally took is freed
  3. a posting of 20,000 entries (BIG=0 skips it; not run with RED): queued, taken, 20 progress reports of 1,000 entries
     each (stamped in one call, the row written, the register judged), the report that moves it to done, settle, Mark
     posted, Not in Tally, the requeue: every step under an 8 s statement timeout and well under it (timings printed); every
     entry in the register in Tally; the days of its entries queued to be read back from Tally (182) at once
RED_WITHOUT_199=1: the same checks without the file (2 fails: cancelled by the statement timeout)."""
import os, re, sys, json, random, time, hashlib, csv
csv.field_size_limit(1 << 30)   # a big posting's results read back whole
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, CO, OWNER, STAFF, DA, BA
M199 = os.path.join(PS.SQLDIR, "migration-199-post-match-fast.sql")
RED = os.environ.get("RED_WITHOUT_199") == "1"
BIG = os.environ.get("BIG", "1") != "0" and not RED
STAGING_MD5 = {   # md5(prosrc) read on staging 18-Nov-2026
    "tally_post_job_accepted": "cccf0ec96605cc42d4067c78660ac3de", "tally_post_ids_sync": "143549d21a03db906a977abdde772098",
    "tally_post_job_settle": "d2b67920a6b6242df42880f38c79405b", "tally_post_id_accept": "e468a6f01baa895137079fc84656d79a",
    "tally_post_id_accept_reply": "24eb9855dc8d3f6c172d2a5b29030388", "tally_post_register_judged": "429b8fca71a4d40c81deb33914aa089c",
    # not changed (their callers and neighbours)
    "tally_post_mark_core": "5b289781d878a0e5f369388dd96ab7d0", "tally_post_release_core": "51487b4ab9a17081166decbbcec6d13f",
    "tally_post_requeue": "84ad1671efa86ad4748b3ad5301e7189", "tally_post_register_apply_row": "2c727e6f02bb0231483235707050285f",
    "tally_post_register_put": None, "tally_post_register_queued": None,   # (not read on staging: compared with 111's text below)
    "tally_post_register_apply": "367da7a9a605167b568ba27c3a8f0d17", "tally_post_id_release": "9641cb9a423a634e3e07b90431324346",
    "tally_post_job_read_back": "9609b41d1c45b8ce6dc3b96cfbaca8b4"}   # (tally_post_take_for: staging runs a later text than this stand's 174; not touched here)
CHANGED = ["tally_post_id_accept", "tally_post_id_accept_reply", "tally_post_ids_sync", "tally_post_job_accepted", "tally_post_job_settle", "tally_post_register_apply_row",
           "tally_post_register_judged", "tally_post_register_queued"]
NEW = ["tally_post_id_accept_many", "tally_post_id_stamp_fids"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M199).read() if os.path.exists(M199) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M199), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
IDX = sorted(re.findall(r"create index if not exists (\w+) on public\.tally_post_ids \(", code))
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and "alter table" not in code and "create table" not in code and "create trigger" not in code
   and code.count("create index") == 3 and IDX == ["tally_post_ids_job_entry", "tally_post_ids_job_entry_an", "tally_post_ids_job_fid_an"] and "create unique" not in code,
   "add-only: no table, column or trigger; three indexes of tally_post_ids, if not there (%s); nothing dropped, deleted or truncated" % IDX)
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == sorted(CHANGED + NEW), "replaces only %s; new: %s" % (", ".join(CHANGED), ", ".join(NEW)))
SIGS = ["public.tally_post_job_accepted(uuid, jsonb, jsonb)", "public.tally_post_ids_sync()", "public.tally_post_id_accept(uuid, text, text, timestamptz)",
        "public.tally_post_id_accept_reply(uuid, text, text, text, integer)", "public.tally_post_id_accept_many(uuid, jsonb)", "public.tally_post_id_stamp_fids(uuid, text[], text, timestamptz)", "public.tally_post_register_judged(public.tally_post_jobs)",
        "public.tally_post_register_apply_row(public.tally_post_jobs, uuid)", "public.tally_post_register_queued()"]
ok(all(("revoke all on function %s from public, anon, authenticated;" % s) in text and ("grant execute on function %s to service_role;" % s) in text for s in SIGS), "service_role only, granted explicitly")
SETTLE = "public.tally_post_job_settle(text, boolean, jsonb, jsonb, jsonb)"
ok(("grant execute on function %s to public, service_role;" % SETTLE) in text and ("revoke all on function %s" % SETTLE) not in text, "settle: its grants as on staging (any role, a pure calculation), written out")
APPLY_ADD, APPLY_GONE, QUEUED_ADD, QUEUED_GONE = 55, 18, 29, 2
def fbody(t_, name):   # post_queue_stand's, with 111's $fn$ too
    i = t_.index("create or replace function public." + name + "(")
    ends = [k for k in (t_.find("$function$;", i), t_.find("$$;", i), t_.find("$judge$;", i), t_.find("$fn$;", i)) if k >= 0]
    return [l.strip() for l in t_[i:min(ends)].splitlines() if l.strip()]
src = lambda n: open(os.path.join(PS.SQLDIR, n)).read()
m111 = src("migration-111-post-register.sql")
m36b, m40, m43, m174 = src("migration-36b-post-acceptance.sql"), src("migration-40-states-carried.sql"), src("migration-43-posting-reply.sql"), src("migration-174-post-jobs-safe.sql")
for name, s0, n_add, n_gone in (("tally_post_job_accepted", m43, 15, 5), ("tally_post_ids_sync", m40, 8, 4), ("tally_post_job_settle", m43, 13, 9),
                                ("tally_post_id_accept", m36b, 5, 3), ("tally_post_id_accept_reply", m43, 3, 2), ("tally_post_register_judged", m174, 35, 14),
                                ("tally_post_register_apply_row", m111, APPLY_ADD, APPLY_GONE), ("tally_post_register_queued", m111, QUEUED_ADD, QUEUED_GONE)):
    if ("create or replace function public." + name + "(") in text:
        a, b = fbody(text, name), fbody(s0, name)
        added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
        ok(len(added) == n_add and len(gone) == n_gone, "%s: the latest text with %d line(s) added, %d changed (%d / %d)" % (name, n_add, n_gone, len(added), len(gone)))
    else: ok(False, "%s: not in the file" % name)

st = PS.Stand(int(os.environ.get("PG199_PORT") or 31199)); db = st.db
# 182's read-back of a posting done (its light days table, the function and the trigger; the rest of 182 needs tables this stand has not)
m182 = src("migration-182-gap-after-post.sql")
t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
md5 = lambda name: db.one("select md5(prosrc) from pg_proc where proname = %s" % q(name))
J = lambda n: "%08d-0000-0000-0000-000000000199" % n
def timed(stmt, uid=None):
    t0 = time.time()
    try: out = db.one(stmt, uid); e = ""
    except RuntimeError as x: out, e = None, str(x)[-300:]
    return out, e, time.time() - t0
def ref_copy(sig, name, new):   # the old text kept under another name, to compare with
    old = db.one("select pg_get_functiondef(%s::regprocedure)" % q(sig))
    db.sql(old.replace("public." + name + "(", "public." + new + "(", 1))
try:
    print("== 0. the stand runs staging's text")
    for name, want in STAGING_MD5.items():
        if want: ok(md5(name) == want, "%s before the file: md5 %s (staging %s)" % (name, md5(name), want))
    OLD_QUEUED = db.one("select pg_get_functiondef('public.tally_post_register_queued()'::regprocedure)")
    db.sql("""create or replace function t199_try(p_sql text, p_dump text) returns text language plpgsql as $t$
      declare d text;
      begin
        begin
          execute p_sql;
          execute p_dump into d;
          raise exception using errcode = 'P0199', message = coalesce(d, '');
        exception when sqlstate 'P0199' then return sqlerrm;
                  when others then return 'ERROR: ' || sqlerrm;
        end;
      end $t$;""")
    ref_copy("public.tally_post_job_accepted(uuid, jsonb, jsonb)", "tally_post_job_accepted", "ref199_job_accepted")
    ref_copy(SETTLE, "tally_post_job_settle", "ref199_job_settle")
    ref_copy("public.tally_post_register_judged(public.tally_post_jobs)", "tally_post_register_judged", "ref199_register_judged")
    ref_copy("public.tally_post_register_apply_row(public.tally_post_jobs, uuid)", "tally_post_register_apply_row", "ref199_apply_row")
    REF_LIVE = """select coalesce(string_agg(i.fincom_id || '=' || ((i.accepted_at is not null and i.released_at is null)
                        or (%(st)s not in ('failed', 'cancelled') and i.released_at is null)
                        or (i.released_at is null and exists (select 1 from unnest(a.acc) x where tally_post_id_match(i.fincom_id, i.entry_id, x))))::text, ',' order by i.fincom_id), '')
                    from tally_post_ids i, (select coalesce(array_agg(distinct s.id), '{}') acc from tally_post_jobs j, lateral (
                        select unnest(string_to_array(coalesce(ref199_job_accepted(j.id, j.results, j.items), ''), ', ')) id
                        union select x->>'id' from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) x where x->>'id' is not null and (tally_post_result_taken(x) or tally_post_bool(x->>'ok'))
                        union select x->>'id' from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) x where x->>'id' is not null and tally_post_result_taken(x)) s
                      where j.id = %(j)s and s.id <> '') a where i.job_id = %(j)s"""
    LIVE = "select coalesce(string_agg(fincom_id || '=' || live::text, ',' order by fincom_id), '') from tally_post_ids where job_id = %s"
    # a stamp's rows: the old rule (tally_post_id_match) and the new (the spellings written out), for an id with letters or digits
    STAMP_EQ = """select count(*) filter (where tally_post_id_match(fincom_id, entry_id, %(x)s) is distinct from
                    (fincom_id = %(x)s or entry_id = %(x)s or regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = regexp_replace(%(x)s, '[^A-Za-z0-9]', '', 'g')
                     or regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g') = regexp_replace(%(x)s, '[^A-Za-z0-9]', '', 'g')))::text || '/' ||
                  count(*) filter (where tally_post_id_match(fincom_id, entry_id, %(x)s))::text from tally_post_ids where job_id = %(j)s"""
    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_199: not run)" % n); continue
        r = st.psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    st.grants()
    if not RED:
        priv = lambda role, s: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(s)))
        ok(all(priv("authenticated", s) == "false" and priv("anon", s) == "false" and priv("service_role", s) == "true" for s in SIGS), "not for anon or authenticated; service_role may")
        ok(db.one("select proacl::text from pg_proc where oid = %s::regprocedure" % q(SETTLE)) == "{=X/postgres,postgres=X/postgres,service_role=X/postgres}", "settle: the same privileges as on staging")
        same = [n for n in STAGING_MD5 if n not in CHANGED and STAGING_MD5[n] and md5(n) != STAGING_MD5[n]]
        ok(not same, "the functions not named are not changed (staging's text) %s" % same)
        ok(db.one("select count(*)::text from pg_indexes where tablename = 'tally_post_ids' and indexname like 'tally_post_ids_job_%'") == "3", "the three indexes are there")
        print("  read-back md5(prosrc): " + ", ".join("%s %s" % (n, md5(n)) for n in CHANGED + NEW))

    def new_job(n, status="running", payload=None):
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload) values (%s, %s, 'c1', %s, %s, 0, %s)" % (q(J(n)), q(F), q(CO), q(status), q(json.dumps(payload or {"vouchers": []}))))
    def put_ids(n, rows):   # [(fincom_id, entry_id, accepted, released)]
        if rows: db.sql("insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live, accepted_at, released_at, released_by) values " + ", ".join(
            "(%s, 'c1', %s, %s, %s, true, %s, %s, %s)" % (q(F), q(f), q(J(n)), q(e) if e is not None else "null", "now()" if a else "null", "now()" if r else "null", "'owner'" if r else "null") for f, e, a, r in rows))

    print("== 1. the same answers")
    rnd = random.Random(199)
    WORDS = ["", "CREATED 1 LASTVCHID 52", "CREATED 0", "ALTERED 3 VCHID 7", "Tally replied 'created', but the entry cannot be found in 'X'", "line error", None]
    def spell(f, e):   # an id as the bridge, FinCom or the tag may spell it, or none of the posting's
        c = rnd.randrange(9)
        if c == 0: return f
        if c == 1 and e: return e
        if c == 2: return re.sub(r"[^A-Za-z0-9]", "", f)
        if c == 3 and e: return re.sub(r"[^A-Za-z0-9]", "", e)
        if c == 4: return rnd.choice(["", "--", ".", " "])
        if c == 5: return f.lower()
        if c == 6: return "other-%d" % rnd.randrange(5)
        return rnd.choice([f, e or f])
    def entry(i_d):
        x = {"id": i_d}
        for k in ("ok", "verified", "byReply", "needsReview", "accepted", "held", "postOnly", "byOwner", "sent", "outcomeUnknown", "alreadySent", "refused", "already"):
            if rnd.random() < 0.2: x[k] = rnd.choice([True, False, "true", "yes", 1])
        if rnd.random() < 0.4: x["state"] = rnd.choice(["in_tally", "sent", "failed", "unknown", "waiting", "posted", "notfound", "needs_review", "sending"])
        w = rnd.choice(WORDS)
        if w is not None: x[rnd.choice(["reason", "message"])] = w
        if rnd.random() < 0.3: x["created"] = rnd.choice(["1", "0", "x", 2, "3"])
        if rnd.random() < 0.3: x["batchN"] = rnd.choice(["1", "2", "3", 3])
        if rnd.random() < 0.3: x["batchEnd"] = rnd.choice(["", "77", "1300"])
        if rnd.random() < 0.3: x["sentAt"] = rnd.choice(["a", "b"])
        if rnd.random() < 0.2: x["lastVchId"] = rnd.choice(["", "77"])
        if rnd.random() < 0.1: x["kind"] = "master"
        if rnd.random() < 0.1: x["errors"] = rnd.choice([0, 1])
        if rnd.random() < 0.1: x["vchNumber"] = "9"
        return x
    def vouchers(rows):   # the posting's payload: the tag in the voucher's words when it can be one, else FinCom's id; some twice
        vs = []
        for f, e, _, _ in rows:
            v = {"id": e if e is not None else f}
            if re.fullmatch(r"[A-Za-z0-9._-]+", f) and rnd.random() < 0.7: v["xml"] = "<VOUCHER%s>%s<DATE>202607%02d</DATE>%s<NARRATION>TDSDesk:%s</NARRATION><AMOUNT>-12.50</AMOUNT></VOUCHER>" % (
                rnd.choice(["", ' VCHTYPE="Payment"', ' OLDVCHTYPE="Old" VCHTYPE="Receipt"', ' VCHTYPE=""', ' VCHTYPE="' + "x" * 101 + '"', ' VCHTYPE="Jour"nal"']),
                rnd.choice(["", "<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>", "<VOUCHERTYPENAME></VOUCHERTYPENAME><VOUCHERTYPENAME>Contra</VOUCHERTYPENAME>",
                            "<VOUCHERTYPENAME>" + "y" * 101 + "</VOUCHERTYPENAME>", "<VOUCHERTYPENAME>Sales<B>x</B></VOUCHERTYPENAME><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>",
                            "<VOUCHERTYPENAME>Unclosed"]),
                rnd.randrange(1, 29),
                rnd.choice(["", "<VOUCHERNUMBER>17</VOUCHERNUMBER>", "<VOUCHERNUMBER>" + "9" * 61 + "</VOUCHERNUMBER><VOUCHERNUMBER>18</VOUCHERNUMBER>", "<VOUCHERNUMBER>A/26/1</VOUCHERNUMBER>",
                            "<DATE>2026071</DATE>", "<DATE>２０２６０７０１</DATE>", "<VOUCHERNUMBER>4<x</VOUCHERNUMBER>"]), f)
            if v.get("xml") and rnd.random() < 0.3: v["xml"] = v["xml"].replace("<DATE>", "<DATE>x</DATE><DATE>", 1)
            vs.append(v)
            if rnd.random() < 0.1: vs.append(dict(v))
        if rnd.random() < 0.1: vs.append({"id": "--"})   # no FinCom id at all: not counted
        return {"vouchers": vs}
    SET_Q = "select ref199_job_settle(%(a)s), tally_post_job_settle(%(a)s)"
    JUDGE_Q = """with r as (select jsonb_populate_record(null::public.tally_post_jobs, %s::jsonb) j)
                 select (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord, x.fincom_id), '[]')::text from r, ref199_register_judged(r.j) x) a,
                        (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord, x.fincom_id), '[]')::text from r, tally_post_register_judged(r.j) x) b"""
    # each side runs in its own transaction (rolled back): a time now() wrote differs between them; compared as "a time"
    TS = re.compile(r'"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+00:00"')
    norm = lambda t: TS.sub('"<time>"', t)
    def first_diff(a, b):
        a, b = norm(a), norm(b)
        if a.startswith("ERROR") or b.startswith("ERROR"): return (a[:300], b[:300])
        try:
            xa, xb = json.loads(a), json.loads(b)
            for i, (p_, q_) in enumerate(zip(xa, xb)):
                if p_ != q_: return (i, {k: (p_.get(k), q_.get(k)) for k in set(p_) | set(q_) if p_.get(k) != q_.get(k)})
            return ("rows", len(xa), len(xb))
        except Exception: return (a[:300], b[:300])
    bad_acc, bad_live, bad_settle, bad_judge, bad_stamp, shown, cases, settled, judged_rows = [], [], [], [], [], 0, 0, {}, 0
    bad_apply, bad_queue, applied, queued_cases, queued_refused = [], [], 0, 0, 0
    bad_many, many_cases = [], 0
    for n in range(1, 301):
        st0 = rnd.choice(["running", "taken", "done"]); new_job(n, st0)
        rows = []
        for k in range(rnd.randrange(1, 9)):
            f = rnd.choice(["J%d-INV-26.%02d" % (n, k), "J%d:bank#%d" % (n, k), "j%d inv %d" % (n, k)])
            e = rnd.choice([None, "j%d-abc-%d" % (n, k), "J%dINV26%02d" % (n, k), ""])
            rows.append((f, e, rnd.random() < 0.5, rnd.random() < 0.25))
        put_ids(n, rows)
        res = [entry(spell(f, e)) for f, e, _, _ in rows for _ in range(rnd.randrange(0, 3))]
        its = [entry(spell(f, e)) for f, e, _, _ in rows for _ in range(rnd.randrange(0, 2))]
        if rnd.random() < 0.15: res.append({"ok": True})   # a result without an id
        db.sql("update tally_post_jobs set results = %s, items = %s where id = %s" % (q(json.dumps(res)), q(json.dumps(its)), q(J(n))))
        a_ref = db.one("select coalesce(ref199_job_accepted(id, results, items), '<null>') from tally_post_jobs where id = %s" % q(J(n)))
        a_new = db.one("select coalesce(tally_post_job_accepted(id, results, items), '<null>') from tally_post_jobs where id = %s" % q(J(n)))
        if a_ref != a_new: bad_acc.append((n, a_ref, a_new))
        pay = vouchers(rows)
        for sst in ("running", "taken", "done", "failed"):
            for chk in ("true", "false", "null"):
                r0 = db.rows(SET_Q % {"a": "%s, %s, %s::jsonb, %s::jsonb, %s::jsonb" % (q(sst), chk, q(json.dumps(pay)), q(json.dumps(res)), q(json.dumps(its)))})[0]
                v0, v1 = list(r0.values())
                if v0 != v1: bad_settle.append((n, sst, chk, v0, v1))
                st_ = json.loads(v0)["status"]; settled[st_] = settled.get(st_, 0) + 1
        # an owner's marks on some entries (Mark posted, Not in Tally), by any spelling
        for f, e, _, _ in rows:
            if rnd.random() < 0.3:
                db.sql("insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user, at) values (%s, %s, %s, %s, '5', 'made-up note', %s, now() - interval '%d minutes')"
                       % (q(F), q(J(n)), q(spell(f, e) or "x"), q(rnd.choice(["posted", "released"])), q(OWNER), rnd.randrange(0, 3)))
        for jst in ("waiting", "taken", "running", "done", "failed", "cancelled"):
            ro = rnd.choice([None, [], [rows[0][1] or rows[0][0]], [rows[-1][0]]])
            jr = {"id": J(n), "firm_id": F, "client_id": "c1", "company": CO, "status": jst, "payload": pay, "results": res, "items": its, "resend_only": ro,
                  "taken_at": rnd.choice([None, "2026-11-17T12:00:00Z"]), "message": rnd.choice(["", "a posting's words"])}
            r0 = db.rows(JUDGE_Q % q(json.dumps(jr)))[0]
            if r0["a"] != r0["b"]: bad_judge.append((n, jst, r0["a"][:300], r0["b"][:300]))
            judged_rows += len(json.loads(r0["a"]))
        # the register written: the old loop (reference copy, tally_post_register_put per entry) and the new pass, each in a
        # transaction rolled back, from the same records (made varied first: states, sources, ids, words, another posting's)
        db.sql("""update tally_post_register r set state = (array['queued','sent','in_tally','refused','needs_review','released'])[1 + (abs(hashtext(r.fincom_id || %(s)s)) %% 6)],
                         source = (array['queue','status','reply','recorder','daybook','bridge','owner'])[1 + (abs(hashtext(r.fincom_id || 'src' || %(s)s)) %% 7)],
                         master_id = case when abs(hashtext(r.fincom_id || 'm')) %% 3 = 0 then '77' end, id_inferred = abs(hashtext(r.fincom_id || 'i')) %% 2 = 0,
                         tally_words = case when abs(hashtext(r.fincom_id || 'w')) %% 3 = 0 then 'made-up words' end,
                         job_id = case when abs(hashtext(r.fincom_id || 'j')) %% 5 = 0 then %(other)s::uuid else r.job_id end,
                         vch_type = case when abs(hashtext(r.fincom_id || 't')) %% 2 = 0 then 'Payment' end, amount = null
                   where r.firm_id = %(f)s and r.job_id = %(j)s""" % {"s": q(str(n)), "f": q(F), "j": q(J(n)), "other": q(J(999))})
        DUMP = """select coalesce(jsonb_agg(x order by x->>'fincom_id', x->>'k'), '[]')::text from (
                    select to_jsonb(r) - 'id' || jsonb_build_object('k', 'r') x from tally_post_register r where r.firm_id = %(f)s and r.fincom_id in (select fincom_id from tally_post_ids where job_id = %(j)s)
                    union all select to_jsonb(h) - 'id' - 'register_id' || jsonb_build_object('k', 'h' || coalesce(h.note, '') || coalesce(h.from_state, '') || h.to_state || h.source) from tally_post_register_history h
                     where h.firm_id = %(f)s and h.fincom_id in (select fincom_id from tally_post_ids where job_id = %(j)s)) s""" % {"f": q(F), "j": q(J(n))}
        jr = {"id": J(n), "firm_id": F, "client_id": "c1", "company": CO, "status": rnd.choice(["running", "done", "failed", "cancelled", "taken"]), "payload": pay, "results": res, "items": its,
              "taken_at": rnd.choice([None, "2026-11-17T12:00:00Z"]), "created_at": "2026-11-17T11:00:00Z", "updated_at": "2026-11-17T12:30:00Z", "created_by": OWNER}
        call = "select %s(jsonb_populate_record(null::public.tally_post_jobs, " + q(json.dumps(jr)) + "::jsonb), " + rnd.choice(["null", q(OWNER) + "::uuid"]) + ")"
        a0 = db.one("select t199_try(%s, %s)" % (q(call % "ref199_apply_row"), q(DUMP)))
        a1 = db.one("select t199_try(%s, %s)" % (q(call % "tally_post_register_apply_row"), q(DUMP)))
        if norm(a0) != norm(a1) or a0.startswith("ERROR"): bad_apply.append((n,) + first_diff(a0, a1))
        applied += len(json.loads(a0)) if not a0.startswith("ERROR") else 0
        # a new posting queuing some of these entries again (and new ones): the old trigger and the new, each rolled back
        if n % 3 == 0:
            jn = J(20000 + n)
            ids = [(f, e) for f, e, _, _ in rows if rnd.random() < 0.6] + [("J%d-NEW-%d" % (n, k), None) for k in range(rnd.randrange(0, 3))]
            if ids:
                ins = ("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, created_by) values (%s, %s, 'c1', %s, %s, 0, '{\"vouchers\": []}', %s); "
                       % (q(jn), q(F), q(CO), q(rnd.choice(["waiting", "waiting", "done"])), q(OWNER))
                       + "insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live) values " + ", ".join("(%s, 'c1', %s, %s, %s, false)" % (q(F), q(f), q(jn), q(e) if e is not None else "null") for f, e in ids))
                DQ = DUMP.replace("job_id = %s" % q(J(n)), "job_id = %s" % q(jn))
                b0 = db.one("select t199_try(%s, %s)" % (q(OLD_QUEUED + ";\n" + ins), q(DQ)))
                b1 = db.one("select t199_try(%s, %s)" % (q(ins), q(DQ)))
                if norm(b0) != norm(b1): bad_queue.append((n,) + first_diff(b0, b1))
                queued_cases += 1; queued_refused += b0.startswith("ERROR")
        # a report's acceptances in one call: the same rows as the one-by-one calls, in the same order (each rolled back)
        if n % 3 == 1:
            lst = [dict({"id": spell(f, e)}, **({"reply": True, "vchId": rnd.choice(["", "4410", " 77 "]), "batchEnd": rnd.choice(["", "90"]), "batchN": rnd.choice(["1", "3", "x"])} if rnd.random() < 0.5
                                                 else {"vch": rnd.choice(["", "V-1", None])})) for f, e, _, _ in rows for _ in range(rnd.randrange(1, 3))]
            ONE = ("select count(*) from (select case when tally_post_bool(x->>'reply') then tally_post_id_accept_reply(%(j)s::uuid, x->>'id', x->>'vchId', x->>'batchEnd', case when x->>'batchN' ~ '^\\d{1,6}$' then (x->>'batchN')::int end)"
                   " else tally_post_id_accept(%(j)s::uuid, x->>'id', x->>'vch') end from jsonb_array_elements(%(l)s::jsonb) with ordinality t(x, o) order by o) s") % {"j": q(J(n)), "l": q(json.dumps(lst))}
            MANY = "select tally_post_id_accept_many(%s::uuid, %s::jsonb)" % (q(J(n)), q(json.dumps(lst)))
            IDS = "select coalesce(jsonb_agg(to_jsonb(i) order by i.fincom_id), '[]')::text from tally_post_ids i where i.job_id = %s" % q(J(n))
            m0 = db.one("set role service_role; select t199_try(%s, %s)" % (q(ONE), q(IDS))); m1 = db.one("set role service_role; select t199_try(%s, %s)" % (q(MANY), q(IDS)))
            if norm(m0) != norm(m1) or m0.startswith("ERROR"): bad_many.append((n,) + first_diff(m0, m1))
            many_cases += 1
        for f, e, _, _ in rows:
            x = spell(f, e)
            if re.sub(r"[^A-Za-z0-9]", "", x or ""):
                r0 = db.one(STAMP_EQ % {"x": q(x), "j": q(J(n))})
                if not r0.startswith("0/"): bad_stamp.append((n, x, r0))
        to = rnd.choice([x for x in ["failed", "cancelled", "done", "failed", "waiting"] if x != st0])   # a change of status (the sync runs on one)
        want = db.one(REF_LIVE % {"st": q(to), "j": q(J(n))})
        try: db.sql("update tally_post_jobs set status = %s where id = %s" % (q(to), q(J(n))))
        except RuntimeError as e:   # Retry of a posting Tally accepted: refused by the resend guard, as before; nothing changed
            if "not sent to Tally again" not in str(e) and "needs review" not in str(e): bad_live.append((n, "error " + str(e)[-200:])); continue
            want = db.one(LIVE % q(J(n)))
        got = db.one(LIVE % q(J(n)))
        if got != want: bad_live.append((n, st0, to, want, got))
        cases += 1; shown += a_ref != "<null>"
    ok(not bad_acc, "tally_post_job_accepted: the old answer for all %d postings (%d with entries accepted, not confirmed) %s" % (cases, shown, bad_acc[:3]))
    ok(not bad_live, "the sync: the same ids live as the old rule after each status change %s" % bad_live[:3])
    ok(not bad_settle, "tally_post_job_settle: the old answer for all %d postings under 4 statuses x 3 checkings (%s) %s" % (cases, settled, bad_settle[:3]))
    ok(not bad_judge, "the register's judge: the old rows for all %d postings under 6 statuses (%d rows) %s" % (cases, judged_rows, bad_judge[:2]))
    ok(not bad_stamp, "a stamp finds exactly the ids tally_post_id_match finds %s" % bad_stamp[:3])
    ok(not bad_many and many_cases > 0, "a report's acceptances in one call (tally_post_id_accept_many): the same ids, stamps and releases as one by one (%d postings) %s" % (many_cases, bad_many[:2]))
    ok(not bad_apply and applied > 0, "the register written: the same records and history as the old loop for all %d postings (%d rows compared) %s" % (cases, applied, bad_apply[:2]))
    ok(not bad_queue and queued_cases > 0 and 0 < queued_refused < queued_cases, "a posting queued: the same records, history and refusals (the duplicate guard) as the old trigger (%d cases, %d refused) %s" % (queued_cases, queued_refused, bad_queue[:2]))

    print("== 2. a big posting")
    N = 1500
    BIGPAY = {"vouchers": [{"id": "bigentry-%04d" % k, "xml": "<VOUCHER><NARRATION>TDSDesk:big-%04d</NARRATION></VOUCHER>" % k} for k in range(N)]}
    new_job(1000, "running", BIGPAY)
    db.sql("update tally_post_ids set accepted_at = now() where job_id = %s" % q(J(1000)))   # every acceptance stamped, as the edge function does first
    ok(db.one("select count(*)::text from tally_post_ids where job_id = %s and accepted_at is not null and fincom_id like 'big-%%'" % q(J(1000))) == str(N), "the posting's %d ids, each stamped accepted" % N)
    res = [{"id": "bigentry-%04d" % k, "ok": True, "byReply": True, "vchId": str(9000 + k), "state": "posted", "message": "CREATED 1 LASTVCHID %d" % (9000 + k)} for k in range(N)]
    its = [{"id": "bigentry-%04d" % k, "state": "posted"} for k in range(N)] + [{"id": "led:made-up ledger", "state": "posted"}]
    t0 = time.time(); a = db.one("select coalesce(tally_post_job_accepted(%s::uuid, %s::jsonb, %s::jsonb), '<null>')" % (q(J(1000)), q(json.dumps(res)), q(json.dumps(its)))); t1 = time.time() - t0
    ok(a == "<null>" and t1 < 1.0, "tally_post_job_accepted on %d entries: every one confirmed (%s), %.2f s" % (N, a[:60], t1))
    upd = ("set role service_role; set statement_timeout = '8s'; update tally_post_jobs set status = 'done', done = %d, results = %s, items = %s, seq = 35 where id = %s and status <> 'cancelled'"
           % (N, q(json.dumps(res)), q(json.dumps(its)), q(J(1000))))
    t0 = time.time()
    try: db.sql(upd); err = ""
    except RuntimeError as e: err = str(e)[-200:]
    t2 = time.time() - t0
    ok(not err and t2 < 2.0, "the bridge's report moving it to done is written under an 8 s statement timeout: %.2f s %s" % (t2, err))
    if err: db.sql(upd.split("; ", 2)[2])   # (RED) stored without the timeout, so the owner's checks below run on a posting done
    ok(db.one("select status from tally_post_jobs where id = %s" % q(J(1000))) == "done" and db.one("select count(*) filter (where live)::text from tally_post_ids where job_id = %s" % q(J(1000))) == str(N),
       "stored done, every id live (Tally took them)")
    out, e, t = timed("set statement_timeout = '8s'; select tally_post_job_settle('done', true, payload, results, items)::text from tally_post_jobs where id = %s" % q(J(1000)))
    o = json.loads(out) if out else {}
    ok(not e and t < 1.0 and o.get("posted") == N and o.get("total") == N and o.get("status") == "done", "tally_post_job_settle on %d entries: %s of %s posted, %.2f s %s" % (N, o.get("posted"), o.get("total"), t, e))
    AS_OWNER = "set role authenticated; set statement_timeout = '8s'; "
    out, e, t = timed(AS_OWNER + "select tally_post_job_mark_posted(%s::uuid, 'bigentry-0007', '9007', 'seen in the day book')::text" % q(J(1000)), OWNER)
    o = json.loads(out) if out else {}
    ok(not e and t < 2.0 and o.get("ok") is True and o.get("posted") == N and o.get("status") == "done", "an owner's Mark posted on one entry: %.2f s %s %s" % (t, {k: o.get(k) for k in ("ok", "posted", "of", "status")}, e))
    out, e, t = timed(AS_OWNER + "select tally_post_owner_release(%s::uuid, 'bigentry-0008', 'looked in the day book of that date')::text" % q(J(1000)), OWNER)
    o = json.loads(out) if out else {}
    ok(not e and t < 2.0 and o.get("ok") is True and o.get("released") is True, "an owner's Not in Tally on another entry: %.2f s %s %s" % (t, {k: o.get(k) for k in ("ok", "released", "status")}, e))
    ok(db.one("select count(*) filter (where live)::text from tally_post_ids where job_id = %s" % q(J(1000))) == str(N - 1), "only the released entry's id is set free")
    db.sql("update tally_post_jobs set status = 'running', checking = false, results = '[]', items = '[]', updated_at = now() - interval '40 minutes' where id = %s" % q(J(1000)))
    db.sql("update tally_devices set last_seen = now() - interval '1 hour', info = '{}'")   # its bridge silent: the cron judges it
    out, e, t = timed("set statement_timeout = '8s'; select tally_post_requeue()::text")
    ok(not e and t < 2.0 and db.one("select status || '/' || checking::text from tally_post_jobs where id = %s" % q(J(1000))) == "done/true",
       "the cron's requeue on it (accepted, its bridge silent): held for checking, never back to waiting, %.2f s %s" % (t, e))
    t0 = time.time()
    try: db.sql("set role service_role; set statement_timeout = '8s'; update tally_post_jobs set status = 'failed' where id = %s" % q(J(1000))); err = ""
    except RuntimeError as e: err = str(e)[-200:]
    ok(not err and time.time() - t0 < 2.0 and db.one("select count(*) filter (where live)::text from tally_post_ids where job_id = %s" % q(J(1000))) == str(N - 1),
       "set failed by hand: in under 2 s, and no id Tally took is freed (%.2f s) %s" % (time.time() - t0, err))

    if BIG:
        print("== 3. a posting of 20,000 entries, from the queue to the register")
        clear = "update tally_post_jobs set status = 'failed' where status in ('waiting', 'taken', 'running')"
        db.sql(clear)
        st.setbeat(DA, st.beat("made-up-a", BA, [CO])); db.sql("update tally_devices set last_seen = now()")
        N, PART, LIMIT = 20000, 1000, 6.0   # each step's limit: three quarters of the 8 s statement timeout (the register's pass is some 3.5 s here)
        days = ["2026%02d%02d" % (m, d) for m in (4, 5, 6, 7, 8, 9, 10) for d in (3, 9, 15, 21, 27)]   # 35 days of the year
        V = [{"id": "e-%05d" % k, "xml": "<VOUCHER VCHTYPE=\"Payment\"><DATE>%s</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><NARRATION>TDSDesk:f-%05d</NARRATION><AMOUNT>-%d.00</AMOUNT></VOUCHER>"
              % (days[k % len(days)], k, 100 + k % 900)} for k in range(N)]
        timings = {}
        def step(name, stmt, uid=None, limit=LIMIT):
            out, e, t = timed("set statement_timeout = '8s'; " + stmt, uid)
            timings[name] = max(timings.get(name, 0), t)
            if e or t >= limit: ok(False, "%s: %.2f s %s" % (name, t, e))
            return out
        JB = "00020000-0000-0000-0000-000000000199"
        out = step("queued (tally_post_enqueue_to, the staff member)", "set role authenticated; select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(JB), q(json.dumps({"masters": [], "vouchers": V}))), STAFF, 8.0)
        ok(bool(out) and json.loads(out).get("ok") is True, "queued: %s" % (out or "")[:200])
        ok(db.one("select count(*)::text from tally_post_ids where job_id = %s and live" % q(JB)) == str(N) and db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'queued'" % q(JB)) == str(N),
           "its %d ids live, each in the register as queued" % N)
        out = step("taken (tally_post_take_for)", "set role service_role; select string_agg(id::text, ',') from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA)))
        ok(JB in (out or ""), "the bridge takes it (%s)" % (out or "")[:80])
        step("running (the first report)", "set role service_role; update tally_post_jobs set status = 'running', updated_at = now() where id = %s" % q(JB))
        res, its = [], [{"id": "e-%05d" % k, "kind": "voucher", "state": "waiting", "reason": ""} for k in range(N)]
        for p in range(N // PART):
            new = [{"id": "e-%05d" % k, "kind": "voucher", "ok": True, "byReply": True, "batchN": 50, "batchEnd": str(100000 + (k // 50) * 50 + 49), "sentAt": "2026-11-18T10:%02d:00Z" % (p % 60),
                    "created": 50, "altered": 0, "errors": 0, "exceptions": 0, "state": "posted", "message": "Posted by Tally's reply", "verified": None} for k in range(p * PART, (p + 1) * PART)]
            res += new
            for x in new: its[int(x["id"][2:])]["state"] = "posted"
            lst = [{"id": x["id"], "reply": True, "batchEnd": x["batchEnd"], "batchN": 50} for x in new]
            o = step("stamped (tally_post_id_accept_many, %d a report)" % PART, "set role service_role; select tally_post_id_accept_many(%s::uuid, %s::jsonb)::text" % (q(JB), q(json.dumps(lst))))
            if p == 0: ok(bool(o) and json.loads(o).get("stamped") == PART and json.loads(o).get("zero") == [], "one call stamps the report's %d acceptances (%s)" % (PART, (o or "")[:120]))
            last = p == N // PART - 1
            step("the report written (results and items whole)" if not last else "the report moving it to done",
                 "set role service_role; update tally_post_jobs set status = %s, done = %d, results = %s, items = %s, seq = %d, updated_at = now() where id = %s and status <> 'cancelled'"
                 % (q("done" if last else "running"), len(res), q(json.dumps(res)), q(json.dumps(its)), p + 2, q(JB)))
            step("the register judged (tally_post_register_apply)", "set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(JB))
        ok(db.one("select status || '/' || checking::text from tally_post_jobs where id = %s" % q(JB)) == "done/false", "done, nothing to check")
        ok(db.one("select count(*)::text from tally_post_ids where job_id = %s and accepted_at is not null and live" % q(JB)) == str(N), "every id stamped accepted and live")
        ok(db.one("select count(*)::text from tally_post_register where job_id = %s and state = 'in_tally'" % q(JB)) == str(N), "every entry in the register in Tally (by Tally's reply)")
        ok(db.one("select count(*)::text from tally_light_days where why = 'post' and day = any(%s::date[])" % q("{" + ",".join("%s-%s-%s" % (d[:4], d[4:6], d[6:]) for d in days) + "}")) == str(len(days)),
           "its %d days queued at once to be read back from Tally (182's read-back)" % len(days))
        o = step("settle (tally_post_job_settle)", "select tally_post_job_settle('done', true, payload, results, items)::text from tally_post_jobs where id = %s" % q(JB))
        ok(bool(o) and json.loads(o).get("posted") == N, "settle: %s" % (o or "")[:100])
        o = step("an owner's Mark posted", "set role authenticated; select tally_post_job_mark_posted(%s::uuid, 'e-00007', '100007', 'seen in the day book')::text" % q(JB), OWNER)
        ok(bool(o) and json.loads(o).get("ok") is True, "Mark posted: %s" % (o or "")[:120])
        o = step("an owner's Not in Tally", "set role authenticated; select tally_post_owner_release(%s::uuid, 'e-00008', 'looked in the day book of that date')::text" % q(JB), OWNER)
        ok(bool(o) and json.loads(o).get("released") is True, "Not in Tally: %s" % (o or "")[:120])
        step("the cron's requeue (tally_post_requeue)", "select tally_post_requeue()::text")
        ok(db.one("select count(*)::text from tally_post_ids where job_id = %s and live" % q(JB)) == str(N - 1), "only the released entry's id set free")
        for k, v in sorted(timings.items(), key=lambda kv: -kv[1]): print("  %6.2f s  %s (the slowest)" % (v, k))
        ok(all(v < LIMIT for k, v in timings.items() if not k.startswith("queued")), "every step of the posting under %.0f s (the statement timeout is 8 s)" % LIMIT)
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
