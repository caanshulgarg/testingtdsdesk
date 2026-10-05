"""python3 run_post_settle_server.py - the owner's decisions B and D of 05-Oct-2026 (migration 55) in tally-ingest: the real
cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py). Needs Deno.
  B1. the beat counts a check waiting for this bridge ("Not in Tally - post again") as work, so the bridge asks at once;
  B2. posts_take carries the waiting checks of this bridge's postings (the company, the entry, its voucher), with or
      without a posting to hand out; never another bridge's;
  B3. post_check passes the bridge's answer (found / notfound / unable, the company it looked in, the voucher found, its
      words) to tally_post_check_report naming this computer and this bridge; anything else is refused; a bridge that
      may not post (not the main one, changes only, test mode) is refused;
  B4. a cloud without migration 55: the beat and posts_take as before (no checks), post_check says the cloud is not ready;
  D1. lease_take with the bridge's purpose (post / read) calls the 7-argument tally_lease_take; without one, the
      6-argument one as before; a cloud without 55 (no 7-argument function): the 6-argument one."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "f-1"; KEY = "fcd_" + "e" * 48
ME = {"id": "go-aaaa000001", "computer": "NW144", "user": "NW144\\anshul", "mode": "main", "runMode": "user", "version": "2.3.0", "port": 9101}
OTHER = "go-cccc000003"
F.T["tally_devices"].append({"id": "d-5", "firm_id": FIRM, "name": "NW144 · anshul", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {"bridges": {ME["id"]: {"at": "2026-10-05T10:00:00Z"}}}, "wake_token": "w" * 64, "version": "2.3.0"})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": "c1", "device_id": "d-5", "book_id": "bk-55"})
F.T["tally_post_jobs"] += [{"id": "j-mine", "firm_id": FIRM, "device_id": "d-5", "company": "ZZ CO", "status": "failed", "payload": {"vouchers": [{"id": "K2", "xml": "<VOUCHER><NARRATION>TDSDesk:K2</NARRATION></VOUCHER>"}]}, "created_at": "2026-10-05T10:00:00Z", "target_bridge": None},
                           {"id": "j-other", "firm_id": FIRM, "device_id": "d-5", "company": "ZZ CO", "status": "failed", "payload": {"vouchers": [{"id": "K7", "xml": "<VOUCHER><NARRATION>TDSDesk:K7</NARRATION></VOUCHER>"}]}, "created_at": "2026-10-05T10:00:00Z", "target_bridge": OTHER}]
F.T["tally_post_checks"] = [{"id": 1, "firm_id": FIRM, "job_id": "j-mine", "entry_id": "K2", "company": "ZZ CO", "state": "waiting", "why": "not in the Day Book"},
                            {"id": 2, "firm_id": FIRM, "job_id": "j-other", "entry_id": "K7", "company": "ZZ CO", "state": "waiting", "why": "not there"}]
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
BEAT = {"kind": "beat", "version": "2.3.0", "bridge": ME, "tally": True, "tallyState": "open", "open": ["ZZ CO"]}
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    dev = F.T["tally_devices"][0]
    c, r = call(BEAT)
    ok(c == 200 and r.get("posts") == 1, "B1. no posting waiting, one check for this bridge: the beat says there is work (posts %s)" % r.get("posts"))
    c, r = call({"kind": "posts_take", "version": "2.3.0", "bridge": ME})
    chk = r.get("checks") or []
    ok(c == 200 and r.get("job") is None and [x.get("check") for x in chk] == [1] and chk[0].get("company") == "ZZ CO" and "TDSDesk:K2" in chk[0].get("xml", ""),
       "B2. posts_take carries this bridge's check (the company, the entry's voucher), not the other bridge's (%s)" % chk)
    ok(any(a.get("p_device") == "d-5" and a.get("p_bridge") == ME["id"] and a.get("p_main") is True for a in F.ARGS.get("tally_post_checks_for", [])), "B2. through tally_post_checks_for, naming the computer and the bridge")
    c, r = call({"kind": "post_check", "version": "2.3.0", "bridge": ME, "check": 1, "result": "notfound", "company": "ZZ CO", "words": "FinComTag 05-Jul-2026: none with TDSDesk:K2"})
    a = (F.ARGS.get("tally_post_check_report") or [{}])[-1]
    ok(c == 200 and r.get("state") == "notfound" and a.get("p_check") == 1 and a.get("p_device") == "d-5" and a.get("p_bridge") == ME["id"] and a.get("p_main") is True and a.get("p_company") == "ZZ CO"
       and a.get("p_result") == "notfound" and "TDSDesk:K2" in a.get("p_words", ""), "B3. post_check: the answer goes to tally_post_check_report for this computer and bridge (%s | %s)" % (r, a))
    c, r = call({"kind": "post_check", "version": "2.3.0", "bridge": ME, "check": 1, "result": "found", "company": "ZZ CO", "vch": "26301", "master": "9911"})
    a = F.ARGS["tally_post_check_report"][-1]
    ok(c == 200 and a.get("p_vch") == "26301" and a.get("p_master") == "9911", "B3. found: the voucher number and Tally's id passed on (%s)" % a)
    n = len(F.ARGS["tally_post_check_report"])
    c, r = call({"kind": "post_check", "version": "2.3.0", "bridge": ME, "check": 1, "result": "posted"})
    ok(c == 400 and len(F.ARGS["tally_post_check_report"]) == n, "B3. a result other than found / notfound / unable is refused (%s %s)" % (c, r.get("error")))
    # the owner's rule of 05-Oct-2026: the main-bridge rule holds among ONE Windows user's bridges, so the other bridge is this user's
    dev["main_bridge"] = OTHER
    dev["info"]["bridges"][OTHER] = {"at": "2026-10-05T10:00:00Z", "user": ME["user"]}
    c, r = call({"kind": "post_check", "version": "2.3.0", "bridge": ME, "check": 1, "result": "notfound", "company": "ZZ CO"})
    ok(c == 403 and len(F.ARGS["tally_post_check_report"]) == n, "B3. a bridge that may not post (another is the main one) cannot answer (%s %s)" % (c, r.get("error")))
    dev.pop("main_bridge"); dev["info"]["bridges"].pop(OTHER, None)
    # B4. a cloud without 55
    F.NO_FN.update({"tally_post_checks_for", "tally_post_check_report"})
    c, r = call(BEAT)
    ok(c == 200 and r.get("posts") == 0, "B4. without 55: the beat as before (posts %s)" % r.get("posts"))
    c, r = call({"kind": "posts_take", "version": "2.3.0", "bridge": ME})
    ok(c == 200 and not r.get("checks") and r.get("job") is None, "B4. posts_take as before (%s)" % r)
    c, r = call({"kind": "post_check", "version": "2.3.0", "bridge": ME, "check": 1, "result": "notfound", "company": "ZZ CO"})
    ok(c == 409 and "not ready" in (r.get("error") or ""), "B4. post_check: the cloud is not ready (%s %s)" % (c, r.get("error")))
    F.NO_FN.difference_update({"tally_post_checks_for", "tally_post_check_report"})
    # D1. the lease's purpose
    c, r = call({"kind": "lease_take", "version": "2.3.0", "bridge": ME, "company": "ZZ CO", "ttl": 120, "purpose": "post"})
    a = (F.ARGS.get("tally_lease_take") or [{}])[-1]
    ok(c == 200 and a.get("p_purpose") == "post" and a.get("p_holder") == ME["id"] and r.get("purpose") == "post", "D1. lease_take for a posting: the 7-argument call with p_purpose post (%s | %s)" % (a, r))
    c, r = call({"kind": "lease_take", "version": "2.3.0", "bridge": ME, "company": "ZZ CO", "ttl": 120, "purpose": "read"})
    ok(F.ARGS["tally_lease_take"][-1].get("p_purpose") == "read", "D1. for a read: p_purpose read")
    c, r = call({"kind": "lease_take", "version": "2.3.0", "bridge": ME, "company": "ZZ CO", "ttl": 120})
    ok(c == 200 and "p_purpose" not in F.ARGS["tally_lease_take"][-1], "D1. an older bridge (no purpose): the 6-argument call as before (%s)" % F.ARGS["tally_lease_take"][-1])
    F.LEASE7_MISSING[0] = True
    c, r = call({"kind": "lease_take", "version": "2.3.0", "bridge": ME, "company": "ZZ CO", "ttl": 120, "purpose": "post"})
    ok(c == 200 and r.get("held") is False and "p_purpose" not in F.ARGS["tally_lease_take"][-1], "D1. a cloud without 55: the 6-argument call (%s | %s)" % (r, F.ARGS["tally_lease_take"][-1]))
finally:
    fn.terminate()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
if fails: print("".join(log[-30:]))
sys.exit(1 if fails else 0)
