"""python3 run_busy_ingest.py - tally-ingest when the database cannot be read, and the beat's lookups side by side
(server/tally-cloud/index.ts under Deno, against the stand-in for Supabase, fake_supabase.py). The reliability audit of
11-Nov-2026, cloud items C2 and C4. Made-up computer, bridge and company only. Written before the change. Checks:
  1. the computer key cannot be looked up because the DATABASE answered an error: 503, "FinCom is busy, trying again",
     retry true, a Retry-After header; never 401 and never a word about the key or about connecting again; for every
     kind of call; nothing of the call is kept. The same when the lookup finds two rows (an error, not "no row").
  2. as before: a key FinCom does not hold, and a revoked key: 401 with the words about the key; a key of the wrong
     shape: 401; the database back: 200.
  3. the database's timer (the work key) when the key cannot be checked: 503 (it comes again in 30 s), not 401; a wrong
     work key with the database well: 401 as before.
  4. the beat with a slow database (every request 0.25 s): its answer is the same as with a fast one; lookups that do
     not depend on each other are asked at the same time (the last posting's time with the recorder's check; the
     bridge's changes-only switch with the pickups' book; the ledgers wanted and the older-entries switch with the
     held lines), and a company's book is asked once a beat however many lookups want it.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999991560"
DA, KA = "d1560000-0000-0000-0000-000000000156", "fcd_" + "a" * 48
DR, KR = "d1560000-0000-0000-0000-000000000157", "fcd_" + "b" * 48
KNONE = "fcd_" + "c" * 48
BOOK = "b1560000-0000-0000-0000-000000000156"
GA = {"id": "go-aaaaaa156156", "computer": "PC-MADEUP", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.13"}
H = lambda k: hashlib.sha256(k.encode()).hexdigest()
FS.T["tally_devices"] += [{"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": H(KA), "revoked": False, "info": {}, "version": "2.5.13", "period_fetch": False},
                          {"id": DR, "firm_id": FIRM, "name": "PC-REVOKED", "key_hash": H(KR), "revoked": True, "info": {}, "version": "2.5.13"}]
FS.T["tally_companies"].append({"firm_id": FIRM, "company": "MADEUP CO", "client_id": "c1", "device_id": DA, "book_id": BOOK})
FS.T["tally_post_jobs"].append({"id": "j1", "device_id": DA, "firm_id": FIRM, "status": "done", "company": "MADEUP CO", "updated_at": "2026-11-10T10:00:00.000Z", "created_at": "2026-11-10T09:00:00.000Z"})
real_rpc = FS.rpc
def rpc(fn, a):     # the functions of later migrations the beat asks, answered plainly (their SQL is tested on pg_stand)
    if fn == "tally_read_serving_many": FS.ARGS.setdefault(fn, []).append(a); return {}
    if fn == "tally_fetch_on": FS.ARGS.setdefault(fn, []).append(a); return False
    if fn == "tally_link_place_check": FS.ARGS.setdefault(fn, []).append(a); return True
    if fn == "tally_start_point": FS.ARGS.setdefault(fn, []).append(a); return {"set": False}
    if fn == "tally_recorder_gap_check": FS.ARGS.setdefault(fn, []).append(a); return {"gap": False, "missing": 0}
    return real_rpc(fn, a)
FS.rpc = rpc
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA, headers=None):
    hd = {"Content-Type": "application/json"}
    if key: hd["x-fincom-device"] = key
    hd.update(headers or {})
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=hd)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read()), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}"), dict(e.headers)
dev = lambda: next(d for d in FS.T["tally_devices"] if d["id"] == DA)
BUSY = "FinCom is busy, trying again"
def busy(c, r, h): return c == 503 and r.get("ok") is False and r.get("error") == BUSY and r.get("retry") is True and str(h.get("Retry-After") or h.get("retry-after") or "").isdigit()
def no_key_words(r): return not any(w in json.dumps(r).lower() for w in ("key", "valid", "connect", "pair"))
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    base = {"version": "2.5.13", "bridge": GA, "kind": "beat", "tally": True, "open": ["MADEUP CO"],
            "companies": [{"name": "MADEUP CO", "open": True, "guid": "g-madeup", "altvchid": 120, "altmstid": 40}],
            "pickups": [{"company": "MADEUP CO", "guid": "g-madeup", "kind": "period", "takenAt": "2026-11-11T04:00:00Z", "state": "started", "pickedUtc": "2026-11-11T04:00:05Z", "day": "20260410"}]}
    print("== 1. the database cannot be read: busy, never the key")
    FS.FAIL_SELECT["tally_devices"] = {"message": "canceling statement due to statement timeout", "code": "57014"}
    seen0 = dev().get("last_seen")
    for body in (base, {"kind": "hello", "info": {"computer": "PC-MADEUP", "user": "madeup"}}, {"kind": "posts_take", "bridge": GA}, {"kind": "period_entries", "company": "MADEUP CO", "bridge": GA}, {"kind": "own_key", "bridge": GA}):
        c, r, h = call(dict(body))
        ok(busy(c, r, h) and no_key_words(r), "1. %s: 503, busy, to be tried again, nothing about the key (%s %s, Retry-After %s)" % (body["kind"], c, r, h.get("Retry-After") or h.get("retry-after")))
    ok(dev().get("last_seen") == seen0 and not (dev().get("info") or {}).get("beat"), "1. nothing of those calls kept")
    c, r, h = call(dict(base), key=KNONE)
    ok(busy(c, r, h), "1. a key FinCom does not hold, asked while the database cannot be read: busy too (not told it is invalid) (%s)" % c)
    FS.FAIL_SELECT["tally_devices"] = {"message": "JSON object requested, multiple (or no) rows returned", "code": "PGRST116"}
    c, r, h = call(dict(base))
    ok(busy(c, r, h), "1. a lookup that answers an error of any kind: busy (%s %s)" % (c, r))
    FS.FAIL_SELECT.pop("tally_devices")
    print("== 2. as before with the database well")
    c, r, h = call(dict(base), key=KNONE)
    ok(c == 401 and "key is not valid any more" in r.get("error", ""), "2. a key FinCom does not hold: 401 (%s %s)" % (c, r))
    c, r, h = call(dict(base), key=KR)
    ok(c == 401 and "key is not valid any more" in r.get("error", ""), "2. a revoked key: 401 (%s)" % c)
    c, r, h = call(dict(base), key="fcd_short")
    ok(c == 401 and "not connected" in r.get("error", ""), "2. a key of the wrong shape: 401 (%s)" % c)
    c, fast, h = call(dict(base))
    ok(c == 200 and fast.get("ok") is True and (dev().get("info") or {}).get("beat", {}).get("tally") is True, "2. the database back: the beat is taken (%s %s)" % (c, str(fast)[:120]))
    print("== 3. the database's timer")
    FS.FAIL_RPC["tally_work_key_ok"] = {"message": "connection terminated due to connection timeout", "code": "08006"}
    c, r, h = call({}, key=None, headers={"x-fincom-work": FS.WORK_KEY})
    ok(busy(c, r, h), "3. the work key cannot be checked: 503, busy (%s %s)" % (c, r))
    FS.FAIL_RPC.pop("tally_work_key_ok")
    c, r, h = call({}, key=None, headers={"x-fincom-work": "wrong-key"})
    ok(c == 401 and r.get("error") == "not allowed", "3. a wrong work key, the database well: 401 as before (%s %s)" % (c, r))
    c, r, h = call({}, key=None, headers={"x-fincom-work": FS.WORK_KEY})
    ok(c == 200 and r.get("ok") is True, "3. the right work key: the work is done (%s %s)" % (c, r))
    print("== 4. the beat's lookups side by side")
    time.sleep(1.1)
    # a fresh function (its memory of books empty), a slow database
    fn.terminate(); fn.wait(timeout=20)
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    threading.Thread(target=lambda f=fn: [log.append(l) for l in f.stdout], daemon=True).start()
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    FS.ARGS.clear(); FS.SPANS.clear(); FS.DELAY[0] = 0.25
    t0 = time.time(); c, slow, h = call(dict(base)); took = time.time() - t0
    FS.DELAY[0] = 0.0
    spans = list(FS.SPANS)
    print("  the slow beat: %d requests to the database, %.2f s (one after another they would take %.2f s)" % (len(spans), took, 0.25 * len(spans)))
    strip = lambda o: {k: v for k, v in o.items() if k not in ("activityAt",)}
    ok(c == 200 and strip(slow) == strip(fast), "4. the same answer as with a fast database (%s)" % sorted(k for k in set(slow) | set(fast) if slow.get(k) != fast.get(k)))
    def span(pred): return [(a, b) for (m, p, a, b) in spans if pred(m, p)]
    def together(x, y, what):
        hit = any(a1 < b2 and a2 < b1 for (a1, b1) in x for (a2, b2) in y)
        ok(bool(x) and bool(y) and hit, "4. asked at the same time: %s (%d and %d requests)" % (what, len(x), len(y)))
    last_job = span(lambda m, p: m == "GET" and "/tally_post_jobs?" in p and "order=updated_at.desc" in p and "limit=1" in p)
    together(last_job, span(lambda m, p: "/rpc/tally_recorder_gap_check" in p or "/rpc/tally_start_point" in p or "/rpc/tally_link_place_check" in p), "the last posting's time and the recorder's check")
    together(span(lambda m, p: m == "GET" and "/tally_bridge_prefs?" in p), span(lambda m, p: "/rpc/tally_book_for" in p), "the changes-only switch and the pickups' book")
    held = span(lambda m, p: m == "GET" and "/tally_recorder_lines?" in p and "state=eq.held" in p)
    together(span(lambda m, p: "/rpc/tally_fetch_on" in p), held, "the older-entries switch and the held lines")
    ok(len(held) >= 3 and any(a1 < b2 and a2 < b1 for i, (a1, b1) in enumerate(held) for (a2, b2) in held[i + 1:]), "4. asked at the same time: the ledgers wanted and the held lines (%d requests)" % len(held))
    n_book = len([a for a in FS.ARGS.get("tally_book_for", []) if a.get("p_company") == "MADEUP CO"])
    ok(n_book == 1, "4. the company's book asked once in the beat (%d)" % n_book)
    ok(took < 0.25 * len(spans) - 0.4, "4. the beat is shorter than its requests one after another (%.2f s of %.2f s)" % (took, 0.25 * len(spans)))
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
