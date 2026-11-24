"""python3 run_devlookup_gateway.py - tally-ingest's computer-key lookup (where=device_lookup) when the gateway in front of
the database answers an HTML error page (Sentry FINCOM-CLOUD-STAGING-8, -B, -C, -9; 16-18 Nov 2026: Cloudflare's 520-525
while staging's Postgres restarted). server/tally-cloud/index.ts under Deno, against the stand-in for Supabase
(fake_supabase.py), and the Deno test of server/tally-cloud/dbgateway.js. Made-up computer, keys and pages only. Written
before the change. Checks:
  1. dbgateway_test.ts: a page becomes one short line (the same for every Ray ID and time), which errors are worth one
     more try (a lost connection, never a statement timeout), the wait and the time allowed, and the Sentry report: one
     fixed short line for many pages, its status and code as tags.
  2. one 522 page, then the database back: the lookup is asked once more after a short wait and the call is answered as
     usual (200), not "busy".
  3. the gateway down the whole time (521, 522, 525): 503 "FinCom is busy, trying again", as before, asked exactly twice
     (one more try, no more), and the log line is short: the status and the page's title, never the page.
  4. an ordinary database error (a statement timeout, two rows): busy as before, asked ONCE (not tried again).
  5. as before: an unknown key and a revoked key 401, the database well 200.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
ROOT = os.path.join(HERE, "..")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999992050"
DA, KA = "d2050000-0000-0000-0000-000000000205", "fcd_" + "e" * 48
DR, KR = "d2050000-0000-0000-0000-000000000206", "fcd_" + "f" * 48
KNONE = "fcd_" + "9" * 48
H = lambda k: hashlib.sha256(k.encode()).hexdigest()
FS.T["tally_devices"] += [{"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": H(KA), "revoked": False, "info": {}, "version": "2.5.13"},
                          {"id": DR, "firm_id": FIRM, "name": "PC-REVOKED", "key_hash": H(KR), "revoked": True, "info": {}, "version": "2.5.13"}]
def page(code, words, ray):
    return ("<!DOCTYPE html>\n<html class=\"no-js\" lang=\"en-US\"><head><title>madeupref.supabase.co | %d: %s</title></head><body>"
            "<h1><span class=\"cf-error-type\">Error</span> <span class=\"cf-error-code\">%d</span></h1>"
            "<span>Cloudflare Ray ID: <strong>%s</strong></span><p>Browser Working. Host Error. Click here for more information.</p>"
            "</body></html>" % (code, words, code, ray))
print("== 1. dbgateway.js (deno test)")
r = subprocess.run([DENO, "test", "--allow-read", os.path.join(ROOT, "server", "tally-cloud", "dbgateway_test.ts")], cwd=ROOT, capture_output=True, text=True, env=dict(os.environ, NO_COLOR="1"))
out = r.stdout + r.stderr
for l in out.splitlines():
    if " ... " in l: print("    " + l.strip())
ok(r.returncode == 0, "1. deno test server/tally-cloud/dbgateway_test.ts" + ("" if r.returncode == 0 else "\n" + out[-3000:]))
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(ROOT, "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA):
    hd = {"Content-Type": "application/json", "x-fincom-device": key}
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=hd)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read()), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}"), dict(e.headers)
BUSY = "FinCom is busy, trying again"
def busy(c, r, h): return c == 503 and r.get("ok") is False and r.get("error") == BUSY and r.get("retry") is True and str(h.get("Retry-After") or h.get("retry-after") or "").isdigit()
def lookups(): return len([1 for (m, p) in FS.CALLS if m == "GET" and p == "/rest/v1/tally_devices"])
HELLO = {"kind": "hello", "version": "2.5.13", "info": {"computer": "PC-MADEUP", "user": "madeup"}}
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    c, r0, h = call(dict(HELLO))
    ok(c == 200, "0. the database well: hello answered (%s %s)" % (c, str(r0)[:100]))
    print("== 2. one gateway page, then the database back")
    FS.CALLS.clear(); FS.GATEWAY_FAIL["tally_devices"] = {"status": 522, "body": page(522, "Connection timed out", "9a1b2c3d4e5f6071"), "n": 1}
    t0 = time.time(); c, r, h = call(dict(HELLO)); took = time.time() - t0
    ok(c == 200 and r.get("ok") is not False, "2. answered as usual after one more try (%s %s)" % (c, str(r)[:100]))
    ok(lookups() == 2, "2. the key looked up twice (%d)" % lookups())
    ok(0.2 <= took < 5,     # (readRetry waits 200-400 ms: dbgateway.js)
        "2. after a short wait (%.2f s)" % took)
    print("== 3. the gateway down the whole time")
    for code, words, ray in ((522, "Connection timed out", "0f0e0d0c0b0a0918"), (521, "Web server is down", "1234567890abcdef"), (525, "SSL handshake failed", "fedcba0987654321")):
        FS.CALLS.clear(); del log[:]
        FS.GATEWAY_FAIL["tally_devices"] = {"status": code, "body": page(code, words, ray), "n": -1}
        c, r, h = call(dict(HELLO))
        ok(busy(c, r, h), "3. %d: 503, busy, to be tried again (%s %s)" % (code, c, r))
        ok(lookups() == 2, "3. %d: asked twice, one more try and no more (%d)" % (code, lookups()))
        time.sleep(0.3)
        lines = [l for l in log if "could not be looked up" in l]
        ok(len(lines) == 1 and ("%d" % code) in lines[0] and words in lines[0] and "<" not in lines[0] and "Ray" not in lines[0] and len(lines[0]) < 200,
           "3. %d: one short log line: %r" % (code, lines[0].strip() if lines else None))
    FS.GATEWAY_FAIL.pop("tally_devices")
    print("== 4. an ordinary database error: not tried again")
    for err in ({"message": "canceling statement due to statement timeout", "code": "57014"}, {"message": "JSON object requested, multiple (or no) rows returned", "code": "PGRST116"}):
        FS.CALLS.clear(); FS.FAIL_SELECT["tally_devices"] = err
        c, r, h = call(dict(HELLO))
        ok(busy(c, r, h) and lookups() == 1, "4. %s: busy, asked once (%s, %d)" % (err["code"], c, lookups()))
    FS.FAIL_SELECT.pop("tally_devices")
    print("== 5. as before with the database well")
    c, r, h = call(dict(HELLO), key=KNONE)
    ok(c == 401 and "key is not valid any more" in r.get("error", ""), "5. a key FinCom does not hold: 401 (%s)" % c)
    c, r, h = call(dict(HELLO), key=KR)
    ok(c == 401 and "key is not valid any more" in r.get("error", ""), "5. a revoked key: 401 (%s)" % c)
    FS.CALLS.clear()
    c, r, h = call(dict(HELLO))
    ok(c == 200 and lookups() == 1, "5. the database well: answered, the key looked up once (%s, %d)" % (c, lookups()))
    print("== 6. a slow but healthy database; one that hangs")
    for secs in (1.0, 1.3):
        FS.CALLS.clear(); FS.TABLE_DELAY["tally_devices"] = [secs]
        t0 = time.time(); c, r, h = call(dict(HELLO)); took = time.time() - t0
        ok(c == 200 and r.get("ok") is not False and lookups() == 1, "6. the key lookup answers in %.1f s: answered as usual, asked once (%s %s, %d, %.2f s)" % (secs, c, str(r)[:80], lookups(), took))
    # the first try slow past its share, the second at once: one more try within the time allowed
    FS.CALLS.clear(); FS.TABLE_DELAY["tally_devices"] = [3.0, 0.0]
    t0 = time.time(); c, r, h = call(dict(HELLO)); took = time.time() - t0
    time.sleep(3.2)   # (the stand-in counts a call when it answers it: the first, given up on, after its 3 s)
    ok(c == 200 and lookups() == 2 and took < 2.0, "6. the first try hangs, the second answers: answered as usual within 2 s (%s, %d, %.2f s)" % (c, lookups(), took))
    # hangs the whole time: busy, fast, the whole lookup (its one more try included) within 1.8 s, every request within 2 s
    FS.CALLS.clear(); del log[:]; FS.TABLE_DELAY["tally_devices"] = [5.0]
    t0 = time.time(); c, r, h = call(dict(HELLO)); took = time.time() - t0
    ok(busy(c, r, h) and took < 2.0, "6. the database hangs: 503 busy within 2 s (%s, %.2f s)" % (c, took))
    time.sleep(0.3)
    lines = [l for l in log if "could not be looked up" in l]
    ok(len(lines) == 1 and "tries 2" in lines[0], "6. the database hangs: tried twice within the time allowed (%r)" % (lines[0].strip()[:200] if lines else None))
    FS.TABLE_DELAY.pop("tally_devices"); time.sleep(5.5)
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
