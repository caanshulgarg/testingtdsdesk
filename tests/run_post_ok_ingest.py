"""python3 run_post_ok_ingest.py - FinCom Bridge 2.5.15 (item 1, the owner's approval of 13-Nov-2026) in tally-ingest:
post_ok, the bridge's read-only question before it sends each part of a posting it took to Tally, and offlineSends
(the parts it sent while the cloud could not be reached) kept with posts_update's timing. tally-ingest
(server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py). Made-up names only. Checks:
  1. a posting taken by this bridge, running: post true; nothing of the row written;
  2. stopped (stop_reason, migration 174): post false, stop "stopped", the reason as the words;
  3. cancelled; done / failed (nothing being checked): settled; not there (or another key's): gone;
  4. taken by another bridge, or queued for another bridge of this computer: notYours;
  5. done and being checked (checking): post false, stop "checking" (review L2: an owner may release or post it
     again), unless handed back to send some entries again (resend_only): post true; waiting (put back for this same
     bridge): post true; (migration 200, never twice) one whose re-send list was not handed back yet, or has an entry
     posted again in another posting since (tally_post_resend_ok's words): post false, stop "checking", those words; that
     answer not had (an error, no such function, or not within 2 s of the request, the bridge waiting 3 s): post false,
     never allowed; that refusal before any part was sent: the posting put back for the same bridge at once;
  6. not the main bridge any more (another of the same Windows user chosen): notMain;
  7. a cloud without 174 (no stop_reason): read without it, as before;
  8. posts_update with offlineSends: kept in the timing; without it the timing as before;
  9. (review L3) posts_update of a posting another FinCom Bridge took (taken_by): answered cancelled (notYours), its
     acceptances stamped first, nothing of the row written;
 10. (2.5.16) posts_update from a bridge in test mode: refused, its acceptances (a posting of this firm only) stamped first.
 11. (2.5.16) key_check: known for a bridge id this computer key holds, not for another, and asking binds nothing;
     never without a Windows user recorded and said; at most 30 an hour for one key.
 12. (migration 203, the owner's rule) a posting stamped with the linked GUID (company_guid) while the client's link now
     has another (tally_post_link_guid): post false, stop "stopped", 203's words; the same GUID: post true; the link's GUID
     not had (an error): refused, never allowed; a cloud without 203 (no company_guid): read without it, as before.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, urllib.error, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "f-2515"; KEY = "fcd_" + "c" * 48
ME = {"id": "go-aaaa002515", "computer": "PC-MADEUP", "user": "PC-MADEUP\\madeup", "mode": "main", "runMode": "user", "version": "2.5.15", "port": 9101}
OTHER = "go-bbbb002515"
F.T["tally_devices"].append({"id": "d-2515", "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {"bridges": {ME["id"]: {"at": "2026-11-13T10:00:00Z"}}}, "version": "2.5.15"})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ HERON CO", "client_id": "c1", "device_id": "d-2515", "book_id": "bk-2515"})
def job(i, status, **kw):
    return dict({"id": i, "firm_id": FIRM, "device_id": "d-2515", "company": "ZZ HERON CO", "status": status, "checking": False, "seq": 1, "message": "as the cloud has it",
                 "results": [], "items": [], "target_bridge": ME["id"], "taken_by": ME["id"], "row_version": 0, "stop_reason": None,
                 "payload": {"vouchers": [{"id": "K1", "xml": "<VOUCHER/>"}]}}, **kw)
row = lambda i: next(j for j in F.T["tally_post_jobs"] if j["id"] == i)
# (the sixth review) 36b's resend guard and tally_post_job_accepted, the real ones: a throwaway PostgreSQL (post_queue_stand,
# port 31204 unless PGOK_PORT) holds a copy of each posting the stand-in is asked to put back (as "waiting")
import uuid as _uuid
try:
    import post_queue_stand as PS
    PST = PS.Stand(int(os.environ.get("PGOK_PORT") or 31204), extra=tuple(os.path.join(PS.SQLDIR, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql")))
    m182 = open(os.path.join(PS.SQLDIR, "migration-182-gap-after-post.sql")).read()
    t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
    f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
    PST.db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
    r_ = PST.psql_text("\n".join(open(os.path.join(PS.SQLDIR, f)).read() for f in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql", "migration-202-post-recheck.sql")))
    assert r_.returncode == 0, r_.stderr[-300:]
    PG = True
except Exception as e_:
    print("  (no PostgreSQL stand: %s)" % str(e_)[-200:]); PG = False; PST = None
def pg_copy(r):   # the posting and its ids as the stand-in holds them now, written to PostgreSQL (its triggers off for the copy)
    u = str(_uuid.uuid5(_uuid.NAMESPACE_URL, "post-ok/" + r["id"])); qq = PS.q
    ids = [x for x in F.T.get("tally_post_ids", []) if x.get("job_id") == r["id"]]
    PST.db.sql("set session_replication_role = replica; delete from tally_post_ids where job_id = %s or true; delete from tally_post_jobs where id = %s or true;"   # (the stand holds these copies only)
               "insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, taken_by, taken_at, results, items, resend_only, created_by) values (%s, %s, 'c1', %s, %s, %d, %s, %s, %s, now(), %s, %s, %s, %s);"
               % (qq(u), qq(u), qq(u), qq(PS.F), qq(PS.CO), qq(r["status"]), len(ids), qq(json.dumps(r.get("payload") or {})), qq(PS.DA), qq(PS.BA), qq(json.dumps(r.get("results") or [])), qq(json.dumps(r.get("items") or [])),
                  qq(json.dumps(r.get("resend_only"))) if r.get("resend_only") else "null", qq(PS.STAFF))
               + "".join("insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live, accepted_at, released_at, released_by) values (%s, 'c1', %s, %s, %s, %s, %s, %s, %s);"
                         % (qq(PS.F), qq(x["fincom_id"]), qq(u), qq(x.get("entry_id") or x["fincom_id"]), "true" if x.get("live") else "false", qq(x["accepted_at"]) if x.get("accepted_at") else "null",
                            qq(x["released_at"]) if x.get("released_at") else "null", qq(x["released_by"]) if x.get("released_by") else "null") for x in ids)
               + " set session_replication_role = origin;")
    return u
def real_accepted(a):
    r = next(j for j in F.T["tally_post_jobs"] if j["id"] == a["p_job"]); u = pg_copy(r)
    return PST.db.one("set role service_role; select tally_post_job_accepted(%s::uuid, %s::jsonb, %s::jsonb)" % (PS.q(u), PS.q(json.dumps(a.get("p_results"))), PS.q(json.dumps(a.get("p_items")))))
def real_guard(old, d):   # the stand-in's PATCH of a posting to "waiting": the same update on PostgreSQL, its triggers on (rolled back)
    if not PG or d.get("status") != "waiting" or old.get("status") == "waiting" or not str(old.get("id", "")).startswith("p6"): return None
    u = pg_copy(old)
    try: PST.db.sql("begin; update tally_post_jobs set status = 'waiting', results = %s, items = %s where id = %s; rollback;"
                    % (PS.q(json.dumps(d.get("results", old.get("results")))), PS.q(json.dumps(d.get("items", old.get("items")))), PS.q(u))); return None
    except RuntimeError as e: return str(e).split("CONTEXT")[0].strip()[-300:] or "refused"
F.PATCH_GUARD["tally_post_jobs"] = real_guard
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key", TALLY_PAUSE_SWEEP_MS="3000")   # (next-post-resume-2: a sweep for pauses noted elsewhere every 3 s here)
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def ask(i): return call({"kind": "post_ok", "version": "2.5.15", "bridge": ME, "id": i})
patches = lambda: sum(1 for m, p in F.CALLS if m == "PATCH" and p.endswith("/tally_post_jobs"))
try:
    for _ in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    print("== 1. this bridge's, running")
    F.T["tally_post_jobs"].append(job("p1", "running"))
    n0 = patches(); c, r = ask("p1")
    ok(c == 200 and r == {"ok": True, "post": True}, "post true (%s %s)" % (c, r))
    ok(patches() == n0 and row("p1")["status"] == "running", "read only: nothing written")
    print("== 2. stopped")
    WHY = "Not posted: posting into Tally was stopped for ZZ Heron after this was queued. Allow it on the Tally page, then post again."
    F.T["tally_post_jobs"].append(job("p2", "running", stop_reason=WHY))
    c, r = ask("p2")
    ok(c == 200 and r.get("post") is False and r.get("stop") == "stopped" and r.get("error") == WHY, "post false, stopped, the reason (%s %s)" % (c, r))
    print("== 3. cancelled, settled, gone")
    for jid, st, chk, want in (("p31", "cancelled", False, "cancelled"), ("p32", "done", False, "settled"), ("p33", "failed", False, "settled")):
        F.T["tally_post_jobs"].append(job(jid, st, checking=chk))
        c, r = ask(jid)
        ok(c == 200 and r.get("post") is False and r.get("stop") == want, "%s (%s): %s (%s)" % (jid, st, want, r))
    F.T["tally_post_jobs"].append(job("p34", "running", device_id="d-another"))
    for jid in ("p-none", "p34"):
        c, r = ask(jid)
        ok(c == 200 and r.get("post") is False and r.get("stop") == "gone", "%s: gone (%s)" % (jid, r))
    print("== 4. another bridge's")
    F.T["tally_post_jobs"].append(job("p41", "running", taken_by=OTHER, target_bridge=None))
    F.T["tally_post_jobs"].append(job("p42", "taken", target_bridge=OTHER, taken_by=None))
    for jid in ("p41", "p42"):
        c, r = ask(jid)
        ok(c == 200 and r.get("post") is False and r.get("stop") == "notYours", "%s: notYours (%s)" % (jid, r))
    print("== 5. being checked; put back for this bridge")
    F.T["tally_post_jobs"].append(job("p51", "done", checking=True))
    c, r = ask("p51")
    ok(c == 200 and r.get("post") is False and r.get("stop") == "checking", "p51 held for checking: stop (%s)" % r)
    F.T["tally_post_jobs"].append(job("p53", "done", checking=True, resend_only=["K1"]))
    F.T["tally_post_jobs"].append(job("p52", "waiting", attempts=1, taken_at="2026-11-13T09:00:00Z"))
    for jid in ("p53", "p52"):
        c, r = ask(jid)
        ok(c == 200 and r.get("post") is True, "%s: post true (%s)" % (jid, r))
    NOT = "Not sent: K1 was posted again in posting p99 since it was released; it is not sent twice."
    F.T["tally_post_jobs"].append(job("p54", "waiting", attempts=1, resend_only=["K1"])); F.RESEND_OK["p54"] = NOT
    F.T["tally_post_jobs"].append(job("p55", "done", checking=True, resend_only=["K1"])); F.RESEND_OK["p55"] = "This posting is held for checking in FinCom; the entries released for sending again go when it is handed back, not before."
    for jid in ("p54", "p55"):
        c, r = ask(jid)
        ok(c == 200 and r.get("post") is False and r.get("stop") == "checking" and r.get("error") == F.RESEND_OK[jid], "%s: the re-send list may not go now: post false (%s)" % (jid, r))
    # (the fourth review; the fifth, B1) the whole answer within 2 s of the request (the bridge waits 3 s, then posts what it
    # holds): the re-send check, the posting's read or the computer's lookup not had in time, or an error: refused, never allowed
    UNSURE = "could not confirm in time"
    for jid, how in (("p56", "error"), ("p57", "missing"), ("p58", "slow check"), ("p581", "slow posting read"), ("p582", "slow computer lookup")):
        F.T["tally_post_jobs"].append(job(jid, "waiting", attempts=1, resend_only=["K1"]))
        if how == "error": F.FAIL_RPC["tally_post_resend_ok"] = {"code": "57014", "message": "canceling statement due to statement timeout"}
        if how == "missing": F.NO_FN.add("tally_post_resend_ok")
        if how == "slow check": F.RPC_DELAY["tally_post_resend_ok"] = 12
        if how == "slow posting read": F.TABLE_DELAY["tally_post_jobs"] = [12]
        if how == "slow computer lookup": F.TABLE_DELAY["tally_devices"] = [1.5]
        t0 = time.time(); c, r = ask(jid); t = time.time() - t0
        F.FAIL_RPC.pop("tally_post_resend_ok", None); F.NO_FN.discard("tally_post_resend_ok"); F.RPC_DELAY.pop("tally_post_resend_ok", None); F.TABLE_DELAY.pop("tally_post_jobs", None); F.TABLE_DELAY.pop("tally_devices", None)
        ok(c == 200 and r.get("post") is False and r.get("stop") == "checking" and UNSURE in str(r.get("error") or "") and t < 2.0,
           "%s: %s: refused within the bridge's 3 s, never allowed (%.2f s, %s)" % (jid, how, t, r))
    time.sleep(12)   # (the slow calls above end on the stand-in's side)
    # its refusal ends the bridge's job "stopped" (reported as taken, its words with it): nothing of it was sent, so the posting
    # is put back for the same bridge at once (it sends it once FinCom answers); a part sent already: left as it was (judged as before)
    for jid, part, want in (("p59", "1 of 1", "waiting"), ("p591", "2 of 2", "taken")):
        F.T["tally_post_jobs"].append(job(jid, "taken", attempts=1, resend_only=["K1"], items=[{"id": "K1", "kind": "voucher", "state": "waiting"}]))
        c, r = call({"kind": "posts_update", "version": "2.5.15", "bridge": ME, "id": jid, "status": "taken", "done": 0, "seq": 2, "updatedAt": "2026-11-13T10:00:00Z",
                     "message": "Stopped by FinCom before part %s was sent: FinCom %s that the entries released for sending again may go now, so nothing more is sent now." % (part, UNSURE),
                     "results": [], "items": [{"id": "K1", "kind": "voucher", "state": "waiting"}], "reqs": [], "secondsTotal": 0})
        j_ = row(jid)
        ok(c == 200 and j_["status"] == want and j_["taken_by"] == ME["id"] and j_.get("resend_only") == ["K1"] and (want != "waiting" or "put back" in j_["message"].lower()),
           "%s stopped before part %s: %s (%s %s; %s)" % (jid, part, want, c, r, j_["message"][:120]))
    # (the sixth review, item 1) the put-back meets 36b's resend guard: a re-send posting whose other entry X FinCom found in
    # Tally by itself (stamped accepted, its result FinCom's own) while the bridge's kept result for X says "sent, no answer".
    # The guard and tally_post_job_accepted are the REAL ones, on a throwaway PostgreSQL (the stand-in asks it)
    if PG:
        UN = "Stopped by FinCom before part 1 of 1 was sent: FinCom could not confirm in time that this posting may be sent now, so nothing more is sent now."
        XIN = {"id": "X1", "ok": True, "verified": True, "state": "in_tally", "by": "FinCom (by itself)", "byItself": True, "byItselfAt": "2026-11-19T06:00:00Z"}
        XOLD = {"id": "X1", "ok": True, "verified": True, "state": "posted"}   # (a result of the bridge's own, not FinCom's settlement)
        YOUT = {"id": "Y1", "ok": False, "verified": False, "state": "notfound", "byOwner": True, "byOwnerAt": "2026-11-19T06:00:00Z", "byItself": True}
        XBR = {"id": "X1", "ok": False, "outcomeUnknown": True, "sent": True, "state": "unknown", "message": "Sent; no answer from Tally"}
        for jid, xres, pre, want in (("p60", XIN, True, "waiting"), ("p61", XOLD, True, "taken"), ("p62", XOLD, False, "taken")):
            F.T["tally_post_jobs"].append(job(jid, "taken", attempts=1, resend_only=["Y1"], results=[xres, YOUT], items=[{"id": "X1", "kind": "voucher", "state": "posted"}, {"id": "Y1", "kind": "voucher", "state": "notfound", "byOwner": True}],
                                              payload={"vouchers": [{"id": "X1", "xml": "<VOUCHER/>"}, {"id": "Y1", "xml": "<VOUCHER/>"}]}))
            F.T.setdefault("tally_post_ids", []).extend([{"job_id": jid, "fincom_id": "X1", "entry_id": "X1", "accepted_at": "2026-11-19T06:00:00Z", "released_at": None, "live": True},
                                                         {"job_id": jid, "fincom_id": "Y1", "entry_id": "Y1", "accepted_at": None, "released_at": "2026-11-19T06:00:00Z", "released_by": "owner", "live": False}])
            F.JOB_ACCEPTED[0] = real_accepted if pre else (lambda a_: None)   # p62: the check passes (a race), the guard refuses at the write
            c, r = call({"kind": "posts_update", "version": "2.5.15", "bridge": ME, "id": jid, "status": "taken", "done": 0, "seq": 2, "updatedAt": "2026-11-19T07:00:00Z", "message": UN,
                         "results": [XBR], "items": [{"id": "X1", "kind": "voucher", "state": "unknown"}, {"id": "Y1", "kind": "voucher", "state": "waiting"}], "reqs": [], "secondsTotal": 0})
            j_ = row(jid); x_ = next((x for x in j_["results"] if x["id"] == "X1"), {})
            ok(c == 200 and j_["status"] == want and j_["taken_by"] == ME["id"] and j_.get("resend_only") == ["Y1"] and (jid != "p60" or x_.get("byItself") is True),
               "%s: %s (%s %s; X1 %s; %s)" % (jid, want, c, r, x_.get("state"), j_["message"][:90]))
        F.JOB_ACCEPTED[0] = None
    else: ok(False, "the put-back against the real resend guard (no PostgreSQL stand)")
    print("== 14. stopped part-way because FinCom could not confirm in time: carried on for the same bridge a few minutes later")
    # (next-fix-post-resume, the owner's "yes to both" of 23-Nov-2026) the bridge's own record (its kept results and
    # posted-ids.json) keeps what it sent from going again (bridge-go/postresume_test.go); FinCom puts the posting back for
    # that same bridge only, only after a few minutes, and only when 36b's resend guard takes it
    PAUSED = "Paused: FinCom's cloud was slow to answer"
    MID = "Stopped by FinCom before part %s was sent: FinCom could not confirm in time that this posting may be sent now, so nothing more is sent now."
    K1OK = {"id": "K1", "ok": True, "byReply": True, "state": "posted", "vchId": "41", "batchN": 1, "batchEnd": "41"}
    V3 = {"vouchers": [{"id": "K1", "xml": "<VOUCHER/>"}, {"id": "K2", "xml": "<VOUCHER/>"}, {"id": "K3", "xml": "<VOUCHER/>"}]}
    IT3 = [{"id": "K1", "kind": "voucher", "state": "posted"}, {"id": "K2", "kind": "voucher", "state": "waiting"}, {"id": "K3", "kind": "voucher", "state": "waiting"}]
    def stop_mid(jid, part="2 of 3", results=None, **kw):
        F.T["tally_post_jobs"].append(job(jid, "running", attempts=1, payload=V3, **kw))
        return call({"kind": "posts_update", "version": "2.5.19", "bridge": ME, "id": jid, "status": "taken", "done": 1, "seq": 5, "updatedAt": "2026-11-23T10:00:00Z",
                     "message": MID % part, "results": [K1OK] if results is None else results, "items": IT3, "reqs": [], "secondsTotal": 0.4})
    ago = lambda m: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - 60 * m))
    beat = lambda: call({"kind": "beat", "version": "2.5.19", "bridge": ME, "tally": True, "open": ["ZZ HERON CO"], "companies": [{"name": "ZZ HERON CO", "open": True}]})
    c, r = stop_mid("p141")
    j_ = row("p141")
    ok(c == 200 and j_["status"] == "taken" and j_["taken_by"] == ME["id"] and j_["message"].startswith(PAUSED) and "never sent again" in j_["message"],
       "stopped before part 2 of 3: kept taken by this bridge, said as paused (%s %s; %s)" % (c, r, j_["message"][:140]))
    beat()
    ok(row("p141")["status"] == "taken", "a moment later: not put back yet (FinCom's cloud may still be slow)")
    j_["updated_at"] = ago(4)
    c, r = beat(); j_ = row("p141")
    ok(c == 200 and j_["status"] == "waiting" and j_["taken_by"] == ME["id"] and j_.get("target_bridge") == ME["id"] and not j_["message"].startswith("Put back for the same FinCom Bridge") and "never sent again" in j_["message"],
       "a few minutes later, at this bridge's beat: put back for the SAME bridge (%s; %s)" % (j_["status"], j_["message"][:140]))
    ok(r.get("posts", 0) >= 1, "the beat tells the bridge a posting waits (it takes it at once): %s" % r.get("posts"))
    # another bridge's paused posting on this computer: never put back by this bridge's beat
    F.T["tally_post_jobs"].append(job("p142", "taken", taken_by=OTHER, target_bridge=OTHER, message=PAUSED + ": test", updated_at=ago(10), results=[K1OK], items=IT3))
    beat()
    ok(row("p142")["status"] == "taken" and row("p142")["taken_by"] == OTHER, "another bridge's paused posting: left to that bridge")
    # Tally accepted an entry FinCom has not confirmed (36b): not paused, the bridge's words kept (judged as before)
    F.JOB_ACCEPTED[0] = lambda a_: "K1" if a_.get("p_job") == "p143" else None
    c, r = stop_mid("p143", results=[{"id": "K1", "ok": False, "accepted": True, "lastVchId": "43", "message": "Tally replied CREATED 1 LASTVCHID 43"}])
    F.JOB_ACCEPTED[0] = None
    ok(c == 200 and row("p143")["status"] == "taken" and not row("p143")["message"].startswith(PAUSED), "an entry accepted, not confirmed: not paused (%s)" % row("p143")["message"][:100])
    # a re-send list (resend_only): never carried on this way (its own path judges it)
    c, r = stop_mid("p144", resend_only=["K2"])
    ok(c == 200 and row("p144")["status"] == "taken" and not row("p144")["message"].startswith(PAUSED), "a re-send list: not paused (%s)" % row("p144")["message"][:100])
    # paused, then an owner released one of its entries: not put back by itself
    c, r = stop_mid("p145")
    F.T.setdefault("tally_post_ids", []).append({"job_id": "p145", "fincom_id": "K2", "entry_id": "K2", "accepted_at": None, "released_at": "2026-11-23T10:01:00Z", "released_by": "owner", "live": False})
    row("p145")["updated_at"] = ago(4); beat()
    ok(row("p145")["status"] == "taken" and "released" in row("p145")["message"] and not row("p145")["message"].startswith(PAUSED), "an entry of it released meanwhile: not put back, says why (%s)" % row("p145")["message"][:90])
    # carried on, then FinCom slow again before the first part of that try (part 1 of 1): paused again, never failed
    c, r = stop_mid("p146", part="1 of 1", results=[])
    row("p146")["results"] = [K1OK]
    c, r = call({"kind": "posts_update", "version": "2.5.19", "bridge": ME, "id": "p146", "status": "taken", "done": 1, "seq": 9, "updatedAt": "2026-11-23T10:09:00Z",
                 "message": MID % "1 of 1", "results": [K1OK], "items": IT3, "reqs": [], "secondsTotal": 0.1})
    ok(c == 200 and row("p146")["status"] == "taken" and row("p146")["message"].startswith(PAUSED), "stopped again on the try that carried on: paused again (%s)" % row("p146")["message"][:100])
    # cancelled in FinCom while paused: never put back
    c, r = stop_mid("p147"); row("p147")["status"] = "cancelled"; row("p147")["updated_at"] = ago(4); beat()
    ok(row("p147")["status"] == "cancelled", "cancelled while paused: stays cancelled")
    print("== 14b. (next-post-resume-2) the review's follow-ups")
    CAP = "FinCom's cloud kept timing out; posting waits — tell FinCom support"
    RESUMED = "Carrying on: FinCom Bridge"
    up = lambda jid, sq, done=1, part="2 of 3", res=None: call({"kind": "posts_update", "version": "2.5.19", "bridge": ME, "id": jid, "status": "taken", "done": done, "seq": sq, "updatedAt": "2026-11-23T10:00:00Z",
                                       "message": MID % part, "results": [K1OK] if res is None else res, "items": IT3, "reqs": [], "secondsTotal": 0.4})
    # 3. a late repeat of the stopped report after the put-back: the put-back stands (still waiting, its words); once taken
    # again (seq cleared by the hand-out), a repeat keeps the Paused mark and is not counted as another pause
    ok(row("p141")["status"] == "waiting", "(p141 put back above)")
    c, r = up("p141", 5)
    ok(c == 200 and row("p141")["status"] == "waiting" and row("p141")["message"].startswith(RESUMED), "a late repeat while put back: still waiting, its words kept (%s; %s)" % (row("p141")["status"], row("p141")["message"][:80]))
    row("p141")["status"] = "taken"; row("p141")["seq"] = None
    c, r = up("p141", 5)
    n141 = (row("p141").get("timing") or {}).get("pauses")
    ok(c == 200 and row("p141")["status"] == "taken" and row("p141")["message"].startswith(PAUSED) and n141 == 1, "a late repeat once taken again: Paused, not counted again (pauses %s)" % n141)
    # (the third review, items 2 and 3) a late repeat on a waiting posting whose words changed since (203's gate): it stays
    # waiting, those words kept; one stop-flagged meanwhile: never kept waiting by the repeat
    stop_mid("p155"); row("p155").update(status="waiting", seq=None, message="Not posted yet: ZZ HERON CO is not open in Tally on this computer (made-up words of the gate).")
    c, r = up("p155", 5)
    ok(c == 200 and row("p155")["status"] == "waiting" and row("p155")["message"].startswith("Not posted yet"), "a late repeat, the words changed since: still waiting, its words kept (%s; %s)" % (row("p155")["status"], row("p155")["message"][:60]))
    stop_mid("p156"); row("p156").update(status="waiting", seq=None, message="Carrying on: FinCom Bridge sends the rest of this posting now; what it already sent to Tally is never sent again.",
                                        stop_reason="Not posted: posting into Tally was stopped for ZZ Heron after this was queued.")
    c, r = up("p156", 5)
    ok(c == 200 and row("p156")["status"] != "waiting", "a late repeat on a stop-flagged posting: not kept waiting (%s; %s)" % (row("p156")["status"], row("p156")["message"][:60]))
    # 1. it cannot carry on by itself: the words say what it waits for, never "in a few minutes"
    c, r = stop_mid("p151")   # an entry released meanwhile
    F.T["tally_post_ids"].append({"job_id": "p151", "fincom_id": "K2", "entry_id": "K2", "accepted_at": None, "released_at": "2026-11-23T10:01:00Z", "released_by": "owner", "live": False})
    c, r = stop_mid("p152")   # Tally accepted an entry FinCom has not confirmed (found at the put-back)
    c, r = stop_mid("p153"); row("p153")["resend_only"] = ["K2"]   # a re-send list
    for jid in ("p151", "p152", "p153"): row(jid)["updated_at"] = ago(4)
    F.JOB_ACCEPTED[0] = lambda a_: "K1" if a_.get("p_job") == "p152" else None
    beat(); F.JOB_ACCEPTED[0] = None
    for jid, want in (("p151", "released"), ("p152", "Tally accepted K1"), ("p153", "re-send")):
        m_ = row(jid)["message"]
        ok(row(jid)["status"] == "taken" and (jid == "p152" or not m_.startswith(PAUSED)) and "in a few minutes" not in m_ and want in m_, "%s: says what it waits for (%s)" % (jid, m_[:150]))
    # (the third review, item 4) the Post page offers "It is in Tally: mark posted (Tally id)" for a posting still taken, not
    # "Not in Tally - post again" (refused while it is being sent): the words name only what the person can do; once marked
    # posted it carries on by itself (it keeps the Paused mark)
    m_ = row("p152")["message"]
    ok("It is in Tally: mark posted (Tally id)" in m_ and "Not in Tally" not in m_ and "release" not in m_ and m_.startswith(PAUSED), "p152: the words name the Post page's own button (%s)" % m_)
    row("p152")["updated_at"] = ago(4); time.sleep(3.2); beat()   # (marked posted by a member: in the database, not through tally-ingest; the next sweep finds it)
    ok(row("p152")["status"] == "waiting", "p152: marked posted meanwhile (nothing named now): put back (%s)" % row("p152")["status"])
    # 2. blocked rows never starve another: the oldest read first, each acted on (put back or relabelled)
    F.HONOR_LIMIT[0] = True
    for k in range(6):
        stop_mid("p16%d" % k)
        F.T["tally_post_ids"].append({"job_id": "p16%d" % k, "fincom_id": "K2", "entry_id": "K2", "accepted_at": None, "released_at": "2026-11-23T10:01:00Z", "released_by": "owner", "live": False})
        row("p16%d" % k)["updated_at"] = ago(20 - k)
    stop_mid("p169"); row("p169")["updated_at"] = ago(4)
    beat(); beat()
    F.HONOR_LIMIT[0] = False
    ok(row("p169")["status"] == "waiting" and all(not row("p16%d" % k)["message"].startswith(PAUSED) for k in range(6)), "six blocked postings older than it: it is put back all the same (%s)" % row("p169")["status"])
    # 4. five pauses in a row with nothing more sent: no more put-backs, plain words
    c, r = stop_mid("p170")
    for i in range(2, 6):
        row("p170")["updated_at"] = ago(4); beat()
        ok(row("p170")["status"] == "waiting", "p170 pause %d: put back" % (i - 1))
        row("p170")["status"] = "taken"; row("p170")["seq"] = None
        up("p170", 5 + i)
    m_ = row("p170")["message"]
    ok(row("p170")["status"] == "taken" and CAP in m_ and not m_.startswith(PAUSED), "the fifth pause in a row: not put back again, plain words (%s)" % m_[:160])
    row("p170")["updated_at"] = ago(30); beat()
    ok(row("p170")["status"] == "taken", "and a beat later still waits (%s)" % row("p170")["status"])
    # (more sent between two pauses: a new run of pauses)
    c, r = stop_mid("p171"); row("p171")["updated_at"] = ago(4); beat(); row("p171")["status"] = "taken"; row("p171")["seq"] = None
    up("p171", 9, done=2, res=[K1OK, dict(K1OK, id="K2", vchId="42", batchEnd="42")])
    ok(row("p171")["message"].startswith(PAUSED) and (row("p171").get("timing") or {}).get("pauses") == 1, "more sent since the last pause: counted from 1 again (%s)" % (row("p171").get("timing") or {}).get("pauses"))
    # 6. no read of paused postings on every beat when none is paused
    # (each paused posting reported finished by its bridge, or answered cancelled)
    for j_ in list(F.T["tally_post_jobs"]):
        if j_.get("device_id") == "d-2515" and str(j_.get("message") or "").startswith(PAUSED):
            call({"kind": "posts_update", "version": "2.5.19", "bridge": ME, "id": j_["id"], "status": "done", "done": 3, "seq": 999, "message": "Posted 3 of 3", "results": [K1OK], "items": IT3, "reqs": [], "secondsTotal": 0.4})
    ok(not [j_["id"] for j_ in F.T["tally_post_jobs"] if j_.get("device_id") == "d-2515" and j_.get("taken_by") == ME["id"] and j_.get("status") != "cancelled" and str(j_.get("message") or "").startswith(PAUSED)], "(none of this bridge's paused now: %s)" % [j_["id"] for j_ in F.T["tally_post_jobs"] if str(j_.get("message") or "").startswith(PAUSED) and j_.get("status") != "cancelled"])
    beat()
    q0 = len(F.QUERIES); beat(); beat()
    reads = [x for x in F.QUERIES[q0:] if x[0] == "GET" and x[1].endswith("/tally_post_jobs") and "like" in x[2]]
    ok(not reads, "nothing paused: the next beats do not look for paused postings (%d reads)" % len(reads))
    # (the third review, item 1) two bridges on one computer key: one's beat never delays the other's put-back
    F.T["tally_devices"][0]["info"]["bridges"][OTHER] = {"at": "2026-11-23T10:00:00Z", "user": "PC-MADEUP\\other"}
    OB = dict(ME, id=OTHER, user="PC-MADEUP\\other")
    c, r = call({"kind": "beat", "version": "2.5.19", "bridge": OB, "tally": True, "open": ["ZZ HERON CO"], "companies": [{"name": "ZZ HERON CO", "open": True}]})
    ok(c == 200 and row("p142")["status"] == "waiting" and row("p142")["taken_by"] == OTHER, "the other bridge's paused posting: put back at its own beat (%s %s; %s)" % (c, r.get("error", ""), row("p142")["status"]))
    # 36b's resend guard and tally_post_job_accepted, the real ones (PostgreSQL): an entry stamped accepted by FinCom whose
    # result the bridge says "sent, no answer": not paused; one Tally's reply posted (confirmed): paused, then put back
    if PG:
        F.JOB_ACCEPTED[0] = real_accepted
        XBR2 = {"id": "K1", "ok": False, "outcomeUnknown": True, "sent": True, "state": "unknown", "message": "Sent; no answer from Tally"}
        for jid, res, want in (("p6m1", [XBR2], False), ("p6m2", [K1OK], True)):
            F.T.setdefault("tally_post_ids", []).append({"job_id": jid, "fincom_id": "K1", "entry_id": "K1", "accepted_at": "2026-11-23T10:00:00Z", "released_at": None, "live": True})
            F.T["tally_post_jobs"].append(job(jid, "running", attempts=1, payload=V3, results=[]))
            c, r = call({"kind": "posts_update", "version": "2.5.19", "bridge": ME, "id": jid, "status": "taken", "done": 1, "seq": 5, "updatedAt": "2026-11-23T10:00:00Z",
                         "message": MID % "2 of 3", "results": res, "items": IT3, "reqs": [], "secondsTotal": 0.4})
            j_ = row(jid)
            ok(c == 200 and j_["status"] == "taken" and j_["message"].startswith(PAUSED) == want, "%s (real guard): %s (%s)" % (jid, "paused" if want else "not paused", j_["message"][:100]))
            if want:
                j_["updated_at"] = ago(4); beat()
                ok(row(jid)["status"] == "waiting" and row(jid)["taken_by"] == ME["id"], "%s: the real resend guard takes the put-back (%s)" % (jid, row(jid)["status"]))
        F.JOB_ACCEPTED[0] = None
    else: ok(False, "the part-way put-back against the real resend guard (no PostgreSQL stand)")
    print("== 12. the client linked to another Tally company since the posting was stamped (203)")
    LINKED = "The client was linked to another Tally company after this posting was made: check the entries and post again"
    F.T["tally_post_jobs"].append(job("p121", "running", client_id="c1", company_guid="g-old-0001"))
    F.T["tally_post_jobs"].append(job("p122", "running", client_id="c1", company_guid="g-same-001"))
    F.LINK_GUID[(FIRM, "c1", "ZZ HERON CO")] = "g-same-001"
    c, r = ask("p121")
    ok(c == 200 and r.get("post") is False and r.get("stop") == "stopped" and str(r.get("error") or "").startswith(LINKED), "another GUID: stopped, 203's words (%s %s)" % (c, r))
    c, r = ask("p122")
    ok(c == 200 and r.get("post") is True, "the same GUID: post true (%s %s)" % (c, r))
    F.LINK_GUID.pop((FIRM, "c1", "ZZ HERON CO"))
    c, r = ask("p122")
    ok(c == 200 and r.get("post") is False and r.get("stop") == "stopped" and str(r.get("error") or "").startswith("The client's Tally link changed or was removed after this posting was made"),
       "the link has no GUID now: stopped, in words that fit it (%s %s)" % (c, r))
    F.LINK_GUID[(FIRM, "c1", "ZZ HERON CO")] = "g-same-001"
    F.FAIL_RPC["tally_post_link_guid"] = {"code": "57014", "message": "canceling statement due to statement timeout"}
    c, r = ask("p122"); F.FAIL_RPC.pop("tally_post_link_guid", None)
    ok(c == 200 and r.get("post") is False and r.get("stop") == "checking", "the link's GUID not had: refused (%s %s)" % (c, r))
    F.LINK_GUID.pop((FIRM, "c1", "ZZ HERON CO"))
    # next-fix-postok (staging 23-Nov-2026: a posting of 674 entries stopped after 230, post_ok answering "could not confirm
    # in time" while every round trip to the database took ~0.35 s): a slow but healthy database is answered within the
    # budget. The posting's reads go beside the bridge's binding (all read only), so the answer takes three round trips one
    # after another (the key, then the binding and the reads together, then the link's GUID), not five
    F.LINK_GUID[(FIRM, "c1", "ZZ HERON CO")] = "g-same-001"
    F.DELAY[0] = 0.38
    t0 = time.time(); c, r = ask("p122"); t = time.time() - t0
    F.DELAY[0] = 0.0
    ok(c == 200 and r.get("post") is True and t < 1.8, "each round trip 0.38 s: answered post true in time (%.2f s, %s %s)" % (t, c, r))
    F.T["tally_post_jobs"].append(job("p124", "running", client_id="c1", company_guid="g-old-0001"))
    F.DELAY[0] = 0.38
    c, r = ask("p124"); F.DELAY[0] = 0.0
    ok(c == 200 and r.get("post") is False and r.get("stop") == "stopped", "and a changed link is still stopped (%s %s)" % (c, r))
    F.TABLE_DELAY["tally_post_jobs"] = [12]
    t0 = time.time(); c, r = ask("p122"); t = time.time() - t0; F.TABLE_DELAY.pop("tally_post_jobs", None)
    ok(c == 200 and r.get("post") is False and r.get("stop") == "checking" and t < 2.0, "the posting's read not had in time: still refused, never allowed (%.2f s, %s)" % (t, r))
    F.LINK_GUID.pop((FIRM, "c1", "ZZ HERON CO"))
    j123 = job("p123", "running"); F.T["tally_post_jobs"].append(j123); F.NO_COL["tally_post_jobs"] = {"company_guid"}
    c, r = ask("p123"); F.NO_COL.pop("tally_post_jobs", None)
    ok(c == 200 and r.get("post") is True, "a cloud without 203: read without company_guid, post true (%s %s)" % (c, r))
    print("== 6. not the main bridge any more")
    dev = F.T["tally_devices"][0]
    dev["main_bridge"] = OTHER; dev["info"]["bridges"][OTHER] = {"at": "2026-11-13T10:00:00Z", "user": ME["user"]}
    c, r = ask("p1")
    ok(c == 200 and r.get("post") is False and r.get("stop") == "notMain", "notMain (%s)" % r)
    dev.pop("main_bridge"); dev["info"]["bridges"].pop(OTHER, None)
    print("== 7. a cloud without 174")
    j7 = job("p7", "running"); j7.pop("stop_reason"); F.T["tally_post_jobs"].append(j7)
    F.NO_COL["tally_post_jobs"] = {"stop_reason"}
    c, r = ask("p7")
    ok(c == 200 and r.get("post") is True, "read without stop_reason: post true (%s %s)" % (c, r))
    F.NO_COL.pop("tally_post_jobs", None)
    print("== 8. offlineSends kept with the timing")
    F.T["tally_post_jobs"].append(job("p8", "taken"))
    c, r = call({"kind": "posts_update", "version": "2.5.15", "bridge": ME, "id": "p8", "status": "running", "done": 1, "message": "Posting 1 entry", "seq": 2, "updatedAt": "2026-11-13T10:00:00Z",
                 "results": [{"id": "K1", "ok": True, "byReply": True, "state": "posted"}], "items": [{"id": "K1", "kind": "voucher", "state": "posted"}], "checking": False,
                 "reqs": [{"n": 1, "seconds": 0.2, "created": 1}], "secondsTotal": 0.2, "offlineSends": 1})
    tm = row("p8").get("timing") or {}
    ok(c == 200 and tm.get("offlineSends") == 1 and tm.get("secondsTotal") == 0.2, "kept in the timing (%s %s %s)" % (c, r, tm))
    ok(any("could not be reached" in l for l in log), "logged")
    F.T["tally_post_jobs"].append(job("p81", "taken"))
    c, r = call({"kind": "posts_update", "version": "2.5.15", "bridge": ME, "id": "p81", "status": "running", "done": 0, "message": "Posting", "seq": 2, "results": [], "items": [], "reqs": [], "secondsTotal": 0})
    tm = row("p81").get("timing") or {}
    ok(c == 200 and "offlineSends" not in tm, "without it: the timing as before (%s)" % tm)
    print("== 9. posts_update of another bridge's posting")
    F.T["tally_post_jobs"].append(job("p9", "running", taken_by=OTHER))
    n0 = patches()
    c, r = call({"kind": "posts_update", "version": "2.5.15", "bridge": ME, "id": "p9", "status": "running", "done": 1, "message": "Posting", "seq": 2,
                 "results": [{"id": "K1", "ok": False, "accepted": True, "lastVchId": "91", "message": "Tally replied CREATED 1 LASTVCHID 91"}], "items": [{"id": "K1", "state": "unknown"}]})
    st = [a for a in F.ARGS.get("tally_post_id_accept", []) if a.get("p_job") == "p9"]
    ok(c == 200 and r.get("cancelled") is True and r.get("notYours") is True and st and row("p9")["status"] == "running" and row("p9")["taken_by"] == OTHER and patches() == n0,
       "answered cancelled, stamped first, nothing written (%s %s, %d stamps)" % (c, r, len(st)))
    print("== 10. posts_update from a bridge in test mode (2.5.16)")
    F.T["tally_post_jobs"].append(job("p10", "running"))
    n0 = patches()
    c, r = call({"kind": "posts_update", "shadow": True, "version": "2.5.16", "bridge": ME, "id": "p10", "status": "running", "done": 1, "message": "Posting", "seq": 2,
                 "results": [{"id": "K1", "ok": False, "accepted": True, "lastVchId": "92", "message": "Tally replied CREATED 1 LASTVCHID 92"}, {"id": "K2", "ok": False, "message": "refused"}]})
    st = [a for a in F.ARGS.get("tally_post_id_accept", []) if a.get("p_job") == "p10"]
    ok(c == 403 and len(st) == 1 and st[0].get("p_vch") == "92" and row("p10")["status"] == "running" and patches() == n0,
       "refused, the acceptance stamped first, nothing written (%s %s, %s)" % (c, r, st))
    F.T["tally_post_jobs"].append(dict(job("p11", "running"), firm_id="f-other"))
    c, r = call({"kind": "posts_update", "shadow": True, "version": "2.5.16", "bridge": ME, "id": "p11", "status": "running", "results": [{"id": "K1", "ok": True}]})
    ok(c == 403 and not [a for a in F.ARGS.get("tally_post_id_accept", []) if a.get("p_job") == "p11"], "another firm's posting: refused, nothing stamped")
    print("== 13. the beat: a company open only in a Tally a posting would not use keeps where and why (203's reason)")
    c, r = call({"kind": "beat", "version": "2.5.16", "bridge": ME, "tally": True, "open": ["ZZ HERON CO", "ZZ OTHER"], "companies": [
        {"name": "ZZ HERON CO", "open": False, "guid": "", "openElsewhere": {"port": 9001, "why": "owner unknown", "guid": "g-no", "x": "y"}},
        {"name": "ZZ OTHER", "open": False, "openElsewhere": {"port": "bad", "why": "made up"}}]})
    bt = (next((d for d in F.T["tally_devices"]), {}).get("info") or {}).get("beat") or {}
    cs = {x.get("name"): x for x in bt.get("companies", [])}
    ok(c == 200 and cs.get("ZZ HERON CO", {}).get("openElsewhere") == {"port": 9001, "why": "owner unknown"} and "openElsewhere" not in cs.get("ZZ OTHER", {"openElsewhere": 1}),
       "kept as {port, why} only (no GUID); words not known: left out (%s)" % [cs.get(k) for k in cs])
    ok(bt.get("bridge") == ME.get("id"), "the beat names the bridge that sent it (203's words only from that bridge's beat): %s" % bt.get("bridge"))
    print("== 11. key_check (2.5.16): read only, before the id is bound")
    call({"kind": "beat", "version": "2.5.15", "bridge": ME, "tally": True, "open": [], "companies": []})   # (an earlier bridge's beat recorded its Windows user)
    c, r = call({"kind": "key_check", "version": "2.5.16", "bridge": ME})
    ok(c == 200 and r == {"ok": True, "known": True}, "this computer's own bridge id: known (%s %s)" % (c, r))
    NEW = dict(ME, id="go-cccc002516")
    c, r = call({"kind": "key_check", "version": "2.5.16", "bridge": NEW})
    c2, r2 = call({"kind": "key_check", "version": "2.5.16", "bridge": NEW})
    ok(c == 200 and r == {"ok": True, "known": False} and r2 == {"ok": True, "known": False}
       and not any(x.get("bridge_id") == NEW["id"] for x in F.T.get("tally_bridge_ids", [])), "an id this key never held: not known, and not bound by asking")
    c, r = call({"kind": "key_check", "version": "2.5.16", "bridge": dict(ME, id="nope")})
    ok(c == 400, "not a bridge id: refused (%s)" % c)
    c, r = call({"kind": "key_check", "version": "2.5.16", "bridge": dict(ME, user="")})
    ok(c == 200 and r == {"ok": True, "known": False}, "no Windows user said: not known (%s %s)" % (c, r))
    dv = next(d for d in F.T["tally_devices"] if d.get("key_hash") == hashlib.sha256(KEY.encode()).hexdigest())
    saved = json.loads(json.dumps(dv.get("info") or {}))
    (dv.setdefault("info", {}).setdefault("bridges", {}).get(ME["id"]) or {}).pop("user", None)
    c, r = call({"kind": "key_check", "version": "2.5.16", "bridge": ME})
    ok(c == 200 and r == {"ok": True, "known": False}, "no Windows user ever recorded for that id: not known, connect again (%s %s)" % (c, r))
    dv["info"] = saved
    codes = [call({"kind": "key_check", "version": "2.5.16", "bridge": ME})[0] for _ in range(30)]
    ok(codes.count(429) >= 1 and codes[0] == 200, "at most 30 an hour for one key, then 429 (%s)" % codes[-3:])
finally:
    if PST: PST.stop()
    fn.terminate()
    try: fn.wait(10)
    except Exception: fn.kill()
if fails: print("".join(log[-40:]))
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
