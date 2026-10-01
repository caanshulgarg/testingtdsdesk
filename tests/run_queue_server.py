"""python3 run_queue_server.py - the server's job queue (migration-13, branch fast-sync): a day book handed over from
FinCom is read into the cloud copy by the server, from a queue, and finishes even if the browser is closed straight after
handing it over; a piece that fails is tried again; "Read the kept day books again" runs the same way; the heartbeat
gives the Tally computer its wake-up channel. The real cloud function (server/tally-cloud/index.ts) runs under Deno
against a stand-in for Supabase (fake_supabase.py). Needs Deno (DENO, default: the deno on the PATH)."""
import os, sys, json, time, gzip, base64, hashlib, subprocess, urllib.request, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F, make_fake_books
DENO = os.environ.get("DENO") or shutil.which("deno")
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def until(fn, secs=30, step=0.2):
    t = time.time()
    while time.time() - t < secs:
        v = fn()
        if v: return v
        time.sleep(step)
    return None
FIRM, BOOK, CID = "f-1", "b-1", "c-1"; KEY = "fcd_" + "a" * 48
F.USERS["tok-owner"] = {"id": "u-owner", "email": "owner@zz.test"}; F.USERS["tok-staff"] = {"id": "u-staff", "email": "staff@zz.test"}
F.T["members"] += [{"user_id": "u-owner", "firm_id": FIRM, "role": "owner", "active": True}, {"user_id": "u-staff", "firm_id": FIRM, "role": "staff", "active": True}]
F.T["clients"].append({"id": CID, "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-01T00:00:00Z"})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64})
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key", TALLY_WORK_VT="2")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
import threading; threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
URL = "http://127.0.0.1:8000/"
def call(body, tok="tok-owner", headers=None):
    h = {"Content-Type": "application/json"}; h.update(headers or {})
    if tok: h["Authorization"] = "Bearer " + tok
    rq = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
try:
    ok(until(lambda: any("Listening" in l for l in log), 60), "the cloud function runs (Deno)")
    # the made-up books, day by day, as FinCom hands a chosen day book over
    days = {}
    for d, v in make_fake_books.entries(): days.setdefault(d, []).append(v)
    gz = lambda xml: base64.b64encode(gzip.compress(xml.encode())).decode()
    DAYS = sorted(days)
    piece = lambda ds: [{"day": d, "gz": gz("<ENVELOPE><BODY><DATA>" + "".join(days[d]) + "</DATA></BODY></ENVELOPE>")} for d in ds]
    F.FAIL["20260305"] = 2                     # the database busy twice for one day: tried again
    c, j = call({"kind": "job_new", "client": CID, "total": len(DAYS), "name": "daybook.xml"}); job = j.get("job")
    ok(c == 200 and job, "a job is made for the day book (%s)" % j)
    times = []
    for i in range(0, len(DAYS), 7):
        t0 = time.time(); c, r = call({"kind": "stage_days", "client": CID, "job": job, "days": piece(DAYS[i:i + 7]), "last": i + 7 >= len(DAYS)}); times.append(time.time() - t0)
        ok(c == 200 and r.get("queued") == len(DAYS[i:i + 7]), "part %d handed over (%.2f s)" % (i // 7 + 1, times[-1])) if i == 0 else None
    ok(max(times) < 2, "every part is taken at once, the reading left to the server (longest %.2f s)" % max(times))
    # the browser is gone now: nothing more is asked of it. The database's timer wakes the worker every few seconds here
    timer = {"on": True}
    def tick():
        while timer["on"]: call({"kind": "work"}, tok=None, headers={"x-fincom-work": F.WORK_KEY}); time.sleep(1.5)
    threading.Thread(target=tick, daemon=True).start()
    jrow = lambda: next(x for x in F.T["tally_jobs"] if x["id"] == job)
    ok(until(lambda: jrow()["status"] == "done", 60), "the server finished the job with the browser closed: %s, %d of %d days" % (jrow()["status"], jrow()["done"], jrow()["total"]))
    got = sorted(set(d for b, d, n in F.DAYS if b == BOOK))
    ok(got == DAYS and F.FAIL["20260305"] == 0, "every day is in the cloud copy, the day that failed twice included (%d days)" % len(got))
    ok(all(q["archived"] for q in F.QUEUE) and not any(q["read_ct"] > 3 for q in F.QUEUE), "every piece done and archived (kept), the failed one read %d times" % max(q["read_ct"] for q in F.QUEUE))
    ok(all(("%s/%s/%s/%s.xml.gz" % ("tally-days/" + FIRM, BOOK, d[:6], d)) in F.FILES for d in DAYS), "each day's file kept in the bucket, as before")
    # a day that never goes in: given up after 5 tries, and the job says why
    F.FAIL["20260302"] = 99
    c, j2 = call({"kind": "job_new", "client": CID, "total": 1}); c, r = call({"kind": "stage_days", "client": CID, "job": j2["job"], "days": piece(["20260302"]), "last": True})
    j2row = lambda: next(x for x in F.T["tally_jobs"] if x["id"] == j2["job"])
    ok(until(lambda: j2row()["status"] == "failed", 60), "a piece that fails 5 times: the job says so (%s: %s)" % (j2row()["status"], j2row()["message"][:80]))
    F.FAIL["20260302"] = 0
    # Read the kept day books again: the owner only, a month a piece
    c, r = call({"kind": "reparse_queue", "client": CID}, tok="tok-staff")
    ok(c == 403, "read again: not for staff (%d)" % c)
    n0 = len(F.DAYS); c, r = call({"kind": "reparse_queue", "client": CID})
    ok(c == 200 and r.get("months") == 1, "read again: a job of %s month(s)" % r.get("months"))
    j3row = lambda: next(x for x in F.T["tally_jobs"] if x["id"] == r["job"])
    ok(until(lambda: j3row()["status"] == "done", 60) and len(F.DAYS) - n0 == len(DAYS), "read again by the server: %d days read again, %s" % (len(F.DAYS) - n0, j3row()["status"]))
    # the timer's key, and the heartbeat's wake-up channel
    c, r = call({"kind": "work"}, tok=None, headers={"x-fincom-work": "wrong"})
    ok(c == 401, "the queue worker refuses a wrong key (%d)" % c)
    c, r = call({"kind": "beat", "tally": True, "companies": []}, tok=None, headers={"x-fincom-device": KEY})
    w = (r or {}).get("wake") or {}
    ok(c == 200 and w.get("topic") == "tb-" + "w" * 64 and w.get("url", "").startswith("ws://127.0.0.1:%d/realtime/v1/websocket" % F.PORT) and w.get("key") == "anon-key",
       "the heartbeat gives the Tally computer its wake-up channel (%s)" % w.get("topic", "")[:12])
    F.T["tally_devices"][0].pop("wake_token")
    c, r = call({"kind": "beat", "tally": True, "companies": []}, tok=None, headers={"x-fincom-device": KEY})
    ok(c == 200 and r.get("wake") is None, "and without migration-13's column the heartbeat works as before")
    timer["on"] = False
finally:
    fn.terminate()
errs = [l for l in log if "Error" in l and "busy (test)" not in l and "Stopped after" not in l]
if errs: print("    function log:", "".join(errs[:5]))
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
