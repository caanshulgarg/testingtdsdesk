"""python3 run_post_wait_words_ingest.py - next-posting-never-stuck (C1; the owner, 23-Nov-2026: "warnings say just 'Tally is
closed'", no computer or Windows user named). A posting waiting for a bridge whose beat says Tally is closed, or the
company is not open there, says so in the posting's own words, instead of the requeue's 2-hour "restart FinCom Bridge on
that computer" (migration 174) or "Carrying on" (resumePaused): "Not posted yet: Tally is closed. Open Tally and <company>." (the "Not posted yet: " start lets migration 142/203's gate words replace them, as before).
Words only: the status, the bridge and everything else of the posting unchanged. tally-ingest (server/tally-cloud/index.ts)
under Deno against the stand-in for Supabase (fake_supabase.py). Made-up names only. Checks:
  1. Tally closed: the 2-hour words replaced; no computer or Windows user in them; status waiting, taken_by kept;
  2. Tally open, another company open: "<company> is not open in Tally. Open Tally and <company>";
  3. the company open: the posting's words left as they are (the bridge takes it, its own words follow);
  4. never: another bridge's posting, a posting held (stop_reason), one taken, one with other words (a person's, 203's);
  5. "Carrying on" (resumePaused's words) with Tally closed: replaced too;
  6. at most once a minute for a bridge (TALLY_WAIT_WORDS_MS on a test stand): beats in between read nothing.
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
FIRM = "f-wait"; KEY = "fcd_" + "d" * 48
ME = {"id": "go-aaaa00c1c1", "computer": "PC-MADEUP", "user": "PC-MADEUP\\madeup", "mode": "main", "runMode": "user", "version": "2.5.19", "port": 9101}
OTHER = "go-bbbb00c1c1"
F.T["tally_devices"].append({"id": "d-wait", "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {"bridges": {ME["id"]: {"at": "2026-11-23T10:00:00Z"}}}, "version": "2.5.19"})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ HERON CO", "client_id": "c1", "device_id": "d-wait", "book_id": "bk-wait"})
TWO_H = "No word from the FinCom Bridge on this posting for 2 hours, though the bridge is running: put back for the same bridge (it is never posted from another computer). If it stays so, restart FinCom Bridge on that computer."
RESUMED = "Carrying on: FinCom Bridge sends the rest of this posting now; what it already sent to Tally is never sent again."
CLOSED = "Not posted yet: Tally is closed. Open Tally and ZZ HERON CO."
NOTOPEN = "Not posted yet: ZZ HERON CO is not open in Tally. Open Tally and ZZ HERON CO."
def job(i, status="waiting", **kw):
    return dict({"id": i, "firm_id": FIRM, "client_id": "c1", "device_id": "d-wait", "company": "ZZ HERON CO", "status": status, "checking": False, "seq": 1, "message": TWO_H,
                 "results": [], "items": [], "target_bridge": ME["id"], "taken_by": ME["id"], "row_version": 3, "stop_reason": None, "updated_at": "2026-11-23T08:00:00Z",
                 "payload": {"vouchers": [{"id": "K1", "xml": "<VOUCHER/>"}]}}, **kw)
row = lambda i: next(j for j in F.T["tally_post_jobs"] if j["id"] == i)
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key", TALLY_WAIT_WORDS_MS="1500")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def beat(tally, open_=()):
    return call({"kind": "beat", "version": "2.5.19", "bridge": ME, "tally": tally, "tallyState": "open" if tally else "closed", "open": list(open_), "companies": [{"name": n, "open": True} for n in open_]})
import urllib.parse as _up
# the reads for these words: the waiting postings of this computer with their words (select=id,company,message,...)
reads = lambda: sum(1 for m, p, q in F.QUERIES if m == "GET" and p.endswith("/tally_post_jobs") and _up.unquote(q).startswith("select=id,company,message,"))
try:
    for _ in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    # (review of 76d6c030e: the bridge is chosen in the query, not after its limit of 50: 55 waiting postings of another
    # bridge come first, and this bridge's are still read)
    F.HONOR_LIMIT[0] = True
    F.T["tally_post_jobs"] += [job("w-o%02d" % k, target_bridge=OTHER, taken_by=OTHER) for k in range(55)]
    F.T["tally_post_jobs"] += [job("w1"), job("w-other", target_bridge=OTHER, taken_by=OTHER), job("w-held", stop_reason="The client's Tally link changed after this posting was made."),
                              job("w-taken", status="taken"), job("w-person", message="Not posted yet: the linked Tally company ZZ HERON CO is not open in Tally on the computer"),
                              job("w-res", message=RESUMED)]
    print("== 1. Tally closed")
    c, r = beat(False); time.sleep(0.3)
    w = row("w1")
    ok(c == 200 and w["message"] == CLOSED, "the 2-hour words replaced: %r" % w["message"])
    ok("PC-MADEUP" not in w["message"] and "madeup" not in w["message"] and "restart" not in w["message"], "no computer, no Windows user, no 'restart'")
    ok(w["status"] == "waiting" and w["taken_by"] == ME["id"] and w["target_bridge"] == ME["id"] and w["stop_reason"] is None, "words only: waiting, the same bridge")
    q = [_up.unquote(qq) for m, pp, qq in F.QUERIES if m == "GET" and pp.endswith("/tally_post_jobs") and _up.unquote(qq).startswith("select=id,company,message,")]
    ok(q and ("or=(taken_by.eq.%s,and(taken_by.is.null,target_bridge.eq.%s))" % (ME["id"], ME["id"])) in q[0], "the bridge chosen in the query (%s)" % (q[:1],))
    ok(all(row("w-o%02d" % k)["message"] == TWO_H for k in range(55)), "the other bridge's 55: as they were")
    print("== 4. never another's, held, taken or other words")
    ok(row("w-other")["message"] == TWO_H, "another bridge's posting: as it was")
    ok(row("w-held")["message"] == TWO_H, "a held posting (stop_reason): as it was")
    ok(row("w-taken")["message"] == TWO_H, "a taken posting: as it was")
    ok(row("w-person")["message"].startswith("Not posted yet: the linked Tally company"), "203's gate words: as they were")
    print("== 5. Carrying on, Tally closed")
    ok(row("w-res")["message"] == CLOSED, "resumePaused's 'Carrying on' replaced too: %r" % row("w-res")["message"])
    print("== 6. once a minute (1.5 s here)")
    n0 = reads(); beat(False); beat(False)
    ok(n0 >= 1 and reads() == n0, "beats in between: no read of the postings for these words (%d)" % (reads() - n0))
    print("== 2. Tally open, another company open")
    time.sleep(1.7); beat(True, ["ZZ OTHER CO"]); time.sleep(0.3)
    ok(row("w1")["message"] == NOTOPEN, "the company not open: %r" % row("w1")["message"])
    print("== 3. the company open")
    time.sleep(1.7); beat(True, ["zz heron  co"]); time.sleep(0.3)
    ok(row("w1")["message"] == NOTOPEN, "open (any case, spaces): left as it is; the bridge takes it (%r)" % row("w1")["message"])
finally:
    fn.terminate()
    try: fn.wait(5)
    except Exception: fn.kill()
    F.stop() if hasattr(F, "stop") else None
if fails: print("\n".join(log[-60:])); print([q for q in F.QUERIES if "tally_post_jobs" in q[1]][:12])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
