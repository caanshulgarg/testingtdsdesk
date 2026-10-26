"""python3 run_post_register_server.py - tally-ingest and the posting register (migration 111, next-post-register): the real
cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py). Needs Deno.
  1. posts_update writes the register: after the posting's own update, tally_post_register_apply(job) (the database judges
     Tally's reply by the proof's rule; run_migration111.py tests that rule); the bridge's answer is unchanged.
  2. a recorder line carrying a FinCom id (TDSDesk:<id>, fid) or a REMOTEGUID settles the book's lines:
     tally_post_register_settle_book(book); a line without either asks nothing.
  3. a day file whose entries carry a FinCom id settles them too (tally_post_register_settle_book); one without asks nothing.
  4. a cloud without migration 111 (the functions missing, PGRST202): posts_update, recorder lines and days answer as before,
     the register is not asked again for 10 minutes (said once in the log).
  5. a database error from the register is logged, never thrown: the posting's update stands."""
import os, sys, json, time, gzip, base64, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK = "f-1", "bk-111"; KEY = "fcd_" + "b" * 48
ME = {"id": "go-aaaa000111", "computer": "NW144", "user": "NW144\\anshul", "mode": "main", "runMode": "user", "version": "2.4.7", "port": 9101}
F.T["tally_devices"].append({"id": "d-111", "firm_id": FIRM, "name": "NW144 · anshul", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False,
                             "info": {"bridges": {ME["id"]: {"at": "2026-10-26T10:00:00Z", "open": ["ZZ CO"]}}}, "wake_token": "w" * 64, "version": "2.4.7"})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": "c1", "device_id": "d-111", "book_id": BOOK})
def vch(i): return {"id": i, "xml": "<VOUCHER VCHTYPE=\"Payment\"><DATE>20261009</DATE><NARRATION>TDSDesk:%s | Bank</NARRATION></VOUCHER>" % i}
F.T["tally_post_jobs"] += [{"id": "j-1", "firm_id": FIRM, "client_id": "c1", "device_id": "d-111", "company": "ZZ CO", "status": "taken", "payload": {"vouchers": [vch("P1"), vch("P2"), vch("P3")]},
                            "created_at": "2026-10-26T10:00:00Z", "target_bridge": None},
                           {"id": "j-2", "firm_id": FIRM, "client_id": "c1", "device_id": "d-111", "company": "ZZ CO", "status": "taken", "payload": {"vouchers": [vch("Q1")]},
                            "created_at": "2026-10-26T10:00:00Z", "target_bridge": None}]
# the register's functions as migration 111 answers them (their SQL: run_migration111.py); REG_FAIL: a database error
REG_FAIL = [False]
_rpc = F.rpc
def rpc(fn, a):
    if fn == "tally_post_register_apply":
        F.ARGS.setdefault(fn, []).append(a)
        if REG_FAIL[0]: raise RuntimeError("canceling statement due to statement timeout (test)")
        return {"ok": True, "changed": 3, "states": {"needs_review": 3}}
    if fn == "tally_post_register_settle_book":
        F.ARGS.setdefault(fn, []).append(a); return {"ok": True, "settled": 1}
    if fn in ("tally_recorder_send", "tally_recorder_apply"):
        F.ARGS.setdefault(fn, []).append(a)
        return {"ok": True, "results": [{"line_id": l.get("line_id"), "state": "applied", "why": None} for l in a.get("p_lines") or []]}
    return _rpc(fn, a)
F.rpc = rpc
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def gz(t): return base64.b64encode(gzip.compress(t.encode())).decode()
def day(narr): return ("<ENVELOPE><TALLYMESSAGE><VOUCHER REMOTEID=\"g-1\" VCHTYPE=\"Payment\"><DATE>20261009</DATE><GUID>g-1</GUID><ALTERID>7</ALTERID>"
                       "<VOUCHERNUMBER>1</VOUCHERNUMBER><PARTYLEDGERNAME>Alpha Traders</PARTYLEDGERNAME><NARRATION>%s</NARRATION>"
                       "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Alpha Traders</LEDGERNAME><AMOUNT>-1180.00</AMOUNT></ALLLEDGERENTRIES.LIST>"
                       "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Bank</LEDGERNAME><AMOUNT>1180.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></ENVELOPE>" % narr)
def reply(i, created, n=3):
    return {"id": i, "kind": "voucher", "ok": created == n, "byReply": created == n, "needsReview": created != n, "accepted": created > 0, "created": created, "altered": 0, "errors": 0,
            "exceptions": n - created, "ignored": 0, "batchN": n, "batchEnd": "706", "lastVchId": "706", "lineError": ["Ledger 'X' does not exist!"] if created != n else [],
            "message": "Tally's reply: created %d of %d" % (created, n), "sentAt": "2026-10-26T10:01:00+05:30"}
LINE = lambda lid, **k: dict({"line_id": lid, "event": "created", "object_guid": "g-" + lid, "master_id": "905", "alter_id": 9, "vch_type": "Payment", "vch_no": "7", "vch_date": "20261009",
                              "saved_at": "2026-10-26T10:02:00+05:30", "pc": "NW144", "user": "anshul", "company_guid": "cg-1"}, **k)
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    call({"kind": "beat", "version": "2.4.7", "bridge": ME, "tally": True, "tallyState": "open", "open": ["ZZ CO"]})
    # ---------------------------------------------------------------- 1. posts_update writes the register
    c, r = call({"kind": "posts_update", "version": "2.4.7", "bridge": ME, "id": "j-1", "status": "done", "done": 2, "message": "Posted 2 of 3; 3 need review", "seq": 1,
                 "results": [reply(i, 2) for i in ("P1", "P2", "P3")], "items": [{"id": i, "state": "needs_review", "reason": "Tally's reply: created 2 of 3"} for i in ("P1", "P2", "P3")],
                 "reqs": [{"n": 3, "seconds": 0.3, "created": 2, "altered": 0, "exceptions": 1, "ignored": 0, "lastVchId": "706"}], "secondsTotal": 0.3})
    j1 = next(j for j in F.T["tally_post_jobs"] if j["id"] == "j-1")
    ap = F.ARGS.get("tally_post_register_apply") or []
    ok(c == 200 and r == {"ok": True} and j1.get("status") == "done" and len(j1.get("results") or []) == 3, "1. posts_update answers and stores the posting as before (%s %s, %s)" % (c, r, j1.get("status")))
    ok([a.get("p_job") for a in ap] == ["j-1"], "1. then the register is written for that posting: tally_post_register_apply(j-1) (%s)" % ap)
    ok(any("posting register" in l and "needs_review" in l for l in log), "1. the register's states are said in the log")
    # ---------------------------------------------------------------- 5. a register error never stops the posting's update
    REG_FAIL[0] = True
    c, r = call({"kind": "posts_update", "version": "2.4.7", "bridge": ME, "id": "j-2", "status": "running", "done": 0, "message": "Posting", "seq": 1, "results": [], "items": [{"id": "Q1", "state": "sending"}]})
    j2 = next(j for j in F.T["tally_post_jobs"] if j["id"] == "j-2")
    ok(c == 200 and r.get("ok") is True and j2.get("status") == "running" and len(F.ARGS["tally_post_register_apply"]) == 2, "5. a database error in the register: logged, the update stands (%s %s %s)" % (c, r, j2.get("status")))
    ok(any("tally_post_register_apply" in l and "statement timeout" in l for l in log), "5. the error is in the log")
    REG_FAIL[0] = False
    # ---------------------------------------------------------------- 2. recorder lines settle by the FinCom id
    n0 = len(F.ARGS.get("tally_post_register_settle_book") or [])
    c, r = call({"kind": "recorder_lines", "company": "ZZ CO", "version": "2.4.7", "bridge": ME, "lines": [LINE("L1")]})
    ok(c == 200 and len(F.ARGS.get("tally_post_register_settle_book") or []) == n0, "2. a line with no FinCom id asks nothing of the register (%s %s)" % (c, r.get("error")))
    c, r = call({"kind": "recorder_lines", "company": "ZZ CO", "version": "2.4.7", "bridge": ME, "lines": [LINE("L2", narration="TDSDesk:P1 | Bank")]})
    sb = F.ARGS.get("tally_post_register_settle_book") or []
    sent = (F.ARGS.get("tally_recorder_send") or [{}])[-1].get("p_lines") or [{}]
    ok(c == 200 and len(sb) == n0 + 1 and sb[-1].get("p_book") == BOOK and sent[-1].get("fid") == "P1", "2. a line with TDSDesk:P1 settles the book's lines: tally_post_register_settle_book(%s) (%s)" % (BOOK, sb[-1:]))
    c, r = call({"kind": "recorder_lines", "company": "ZZ CO", "version": "2.4.7", "bridge": ME, "lines": [LINE("L3", remoteGuid="P2")]})
    sent = (F.ARGS.get("tally_recorder_send") or [{}])[-1].get("p_lines") or [{}]
    ok(c == 200 and len(F.ARGS["tally_post_register_settle_book"]) == n0 + 2 and sent[-1].get("remoteGuid") == "P2" and (sent[-1].get("payload") or {}).get("remoteGuid") == "P2",
       "2. a line with a REMOTEGUID is kept with it (payload) and settles too (%s)" % {k: sent[-1].get(k) for k in ("remoteGuid", "fid")})
    # ---------------------------------------------------------------- 3. days
    n1 = len(F.ARGS["tally_post_register_settle_book"])
    c, r = call({"kind": "days", "version": "2.4.7", "bridge": ME, "company": "ZZ CO", "days": [{"day": "20261009", "n": 1, "gz": gz(day("Payment to Alpha"))}]})
    ok(c == 200 and r.get("done") == ["20261009"] and len(F.ARGS["tally_post_register_settle_book"]) == n1, "3. a day with no FinCom id asks nothing (%s %s)" % (c, r))
    c, r = call({"kind": "days", "version": "2.4.7", "bridge": ME, "company": "ZZ CO", "days": [{"day": "20261009", "n": 1, "gz": gz(day("Payment | TDSDesk:P3"))}]})
    ok(c == 200 and r.get("done") == ["20261009"] and len(F.ARGS["tally_post_register_settle_book"]) == n1 + 1 and F.ARGS["tally_post_register_settle_book"][-1].get("p_book") == BOOK,
       "3. a day whose entry carries TDSDesk:P3 settles the book's lines (%s)" % F.ARGS["tally_post_register_settle_book"][-1:])
    # ---------------------------------------------------------------- 4. a cloud without 111
    F.NO_FN.update({"tally_post_register_apply", "tally_post_register_settle_book"})
    k0, k1 = len(F.ARGS["tally_post_register_apply"]), len(F.ARGS["tally_post_register_settle_book"])
    j2["status"] = "taken"
    c, r = call({"kind": "posts_update", "version": "2.4.7", "bridge": ME, "id": "j-2", "status": "done", "done": 1, "message": "Posted 1 of 1", "seq": 2,
                 "results": [dict(reply("Q1", 1, 1), vchId="801", batchEnd="801", lastVchId="801")]})
    ok(c == 200 and r == {"ok": True} and j2.get("status") == "done", "4. without 111: posts_update as before (%s %s)" % (c, r))
    c, r = call({"kind": "recorder_lines", "company": "ZZ CO", "version": "2.4.7", "bridge": ME, "lines": [LINE("L4", narration="TDSDesk:Q1 | Bank")]})
    ok(c == 200 and r.get("applied") == 1, "4. without 111: recorder lines as before (%s %s)" % (c, r.get("applied")))
    c, r = call({"kind": "days", "version": "2.4.7", "bridge": ME, "company": "ZZ CO", "days": [{"day": "20261009", "n": 1, "gz": gz(day("Payment | TDSDesk:Q1"))}]})
    ok(c == 200 and r.get("done") == ["20261009"], "4. without 111: days as before (%s)" % r)
    ok(len(F.ARGS["tally_post_register_apply"]) == k0 and len(F.ARGS["tally_post_register_settle_book"]) == k1, "4. nothing reached the missing functions (PostgREST answered 404)")
    ok(sum("no posting register in this cloud (migration 111)" in l for l in log) == 1, "4. said once in the log, then not asked for 10 minutes")
finally:
    fn.kill(); F.stop() if hasattr(F, "stop") else None
print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)))
if fails: print("".join(log[-40:]))
raise SystemExit(1 if fails else 0)
