"""python3 run_main_bridge_server.py - (02-Oct-2026) every bridge tally-ingest hears from on a computer key, and the main
bridge: FinCom Bridge 2.x (test mode, beside 1.15.0) and bridge 1.15.0 are both listed with computer, Windows user, version
and mode; once 2.x is made the main bridge, only it is given postings and 1.15.0 is refused; the bridge's install log
(support pack, also in test mode) and an install log dropped on the Tally page are kept for FinCom support.
Based on run_shadow_server.py: - tally-ingest's shadow calls (branch go-bridge): FinCom Bridge 2.0.0 in test mode, beside
bridge 1.15.0 with the same computer key, sends marked shadow, and nothing it sends changes what 1.15.0 keeps:
its days are compared with the kept ones (same / differ / new) and not stored; its heartbeat is noted apart and does not
take "Update now"; it is never handed a posting. The real cloud function (server/tally-cloud/index.ts) under Deno against
the stand-in for Supabase (fake_supabase.py). Needs Deno (DENO, default: the deno on the PATH)."""
import os, sys, json, time, gzip, base64, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, CID = "f-1", "b-1", "c-1"; KEY = "fcd_" + "a" * 48
F.T["clients"].append({"id": CID, "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-01T00:00:00Z"})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64,
                             "version": "1.15.0", "want_update_at": "2026-10-01T10:00:00Z", "want_sent_at": None})
F.T["tally_post_jobs"].append({"id": "p-1", "firm_id": FIRM, "device_id": "d-1", "company": "ZZ CO", "status": "waiting", "payload": {"vouchers": []}, "created_at": "2026-10-01T10:00:00Z"})
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

GO = {"id": "go-3fa9c1d2e4b7", "computer": "NWS144", "user": "anshul", "mode": "test", "runMode": "user", "version": "2.1.0"}
F.USERS["tok-owner"] = {"id": "u-1", "email": "o@x"}
F.T["members"].append({"user_id": "u-1", "firm_id": FIRM, "active": True, "role": "owner"})
def web(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer tok-owner"})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
try:
    for i in range(240):   # up to 120 s: Deno may still be fetching the function's imports on a fresh machine
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    dev = F.T["tally_devices"][0]
    c, r = call({"kind": "hello", "version": "1.15.0", "info": {"computer": "NWS144", "user": "anshul"}})
    c, r = call({"kind": "beat", "version": "1.15.0", "tally": False, "open": []})
    c, r = call({"kind": "hello", "version": "1.15.0", "info": {"computer": "NWS144", "user": "anshul"}})
    ok("beat" in dev["info"] and dev["info"].get("computer") == "NWS144", "a hello keeps the heartbeat beside the computer's name (it used to replace it)")
    c, r = call({"kind": "beat", "shadow": True, "version": "2.0.0", "tally": True})
    ok(set(dev["info"].get("bridges", {})) == {"v1"} and dev["info"]["bridges"]["v1"]["mode"] == "main" and dev["info"]["shadow"]["version"] == "2.0.0",
       "a bridge 2.0.0 in test mode (no name of its own) is kept apart, never in 1.15.0's place")
    c, r = call({"kind": "beat", "shadow": True, "version": "2.1.0", "bridge": GO, "tally": True, "tallyState": "open", "open": ["ZZ CO"]})
    b = dev["info"].get("bridges", {})
    ok(c == 200 and r.get("makeMain") is False and set(b) == {"v1", GO["id"]}, "both bridges listed: 1.15.0 (v1) and 2.1.0 (%s)" % sorted(b))
    g, v = b.get(GO["id"], {}), b.get("v1", {})
    ok([g.get(k) for k in ("computer", "user", "version", "mode", "runMode", "tally")] == ["NWS144", "anshul", "2.1.0", "test", "user", True] and g.get("open") == ["ZZ CO"],
       "2.1.0: NWS144, anshul, 2.1.0, test mode, just for this user, sees Tally with ZZ CO open (%s)" % g)
    ok([v.get(k) for k in ("computer", "user", "version", "mode", "tally")] == ["NWS144", "anshul", "1.15.0", "main", False], "1.15.0: NWS144, anshul, main, Tally not seen (%s)" % v)
    c, r = call({"kind": "beat", "version": "1.15.0", "tally": True})
    ok(c == 200 and r.get("posts") == 1 and not r.get("notMain"), "with no main bridge chosen, 1.15.0 is given the posting as before")
    # made the main bridge on the Tally page (migration-22's function sets the column; the stand-in sets it the same way)
    dev["main_bridge"] = GO["id"]
    c, r = call({"kind": "beat", "shadow": True, "version": "2.1.0", "bridge": GO, "tally": True})
    ok(c == 200 and r.get("makeMain") is True, "2.1.0's heartbeat is told it is the main bridge now (makeMain)")
    c, r = call({"kind": "beat", "version": "1.15.0", "tally": True})
    ok(c == 200 and r.get("posts") == 0 and r.get("notMain") is True, "1.15.0's heartbeat: no postings, told another bridge is the main one")
    c, r = call({"kind": "posts_take", "version": "1.15.0"})
    ok(c == 403 and r.get("notMain") and F.T["tally_post_jobs"][0]["status"] == "waiting", "1.15.0 asking for the posting is refused; it still waits")
    c, r = call({"kind": "posts_update", "version": "1.15.0", "id": "p-1", "status": "done"})
    ok(c == 403 and F.T["tally_post_jobs"][0]["status"] == "waiting", "nor can 1.15.0 report one")
    main = dict(GO, mode="main")
    c, r = call({"kind": "beat", "version": "2.1.0", "bridge": main, "tally": True})
    ok(c == 200 and r.get("posts") == 1 and not r.get("notMain") and dev["info"]["bridges"][GO["id"]]["mode"] == "main", "2.1.0 switched over (no longer shadow): given the posting, listed as main")
    # round 11b (bridge 2.1.6): postOnly, the companies this computer posts to (an array of names; [] when none): kept in
    # the beat record and the bridge's entry, and passed on in the firm's broadcast beat, so the Tally page can say
    # "Posts only to: ZZ TEST"
    n_b = len(F.BCAST)
    c, r = call({"kind": "beat", "version": "2.1.6", "bridge": dict(main, version="2.1.6"), "tally": True, "postOnly": ["ZZ TEST", " Other Co ", 7, "x" * 300] + ["Co %d" % i for i in range(30)]})
    po = dev["info"]["beat"].get("postOnly"); pb = dev["info"]["bridges"][GO["id"]].get("postOnly")
    ok(c == 200 and isinstance(po, list) and po[:2] == ["ZZ TEST", "Other Co"] and len(po) <= 20 and all(isinstance(x, str) and len(x) <= 200 for x in po) and "" not in po,
       "11b. info.beat.postOnly: an array of names, strings only, trimmed, each cut to 200, at most 20 (%s…)" % (po or [None])[:3])
    ok(pb == po, "11b. info.bridges[<bridge id>].postOnly: the same list (%s)" % (pb or [None])[:2])
    bc = [m for b in F.BCAST[n_b:] for m in (b.get("messages") or []) if m.get("event") == "beat" and m.get("topic") == "fincom-tally-" + FIRM]
    ok(bc and (bc[-1].get("payload") or {}).get("beat", {}).get("postOnly") == po, "11b. the firm's broadcast beat (topic fincom-tally-<firm>, event beat) carries payload.beat.postOnly (%s)" % ((bc[-1].get("payload") or {}).get("beat", {}).get("postOnly") if bc else bc))
    c, r = call({"kind": "beat", "version": "2.1.6", "bridge": dict(main, version="2.1.6"), "tally": True, "postOnly": []})
    ok(dev["info"]["beat"].get("postOnly") == [] and dev["info"]["bridges"][GO["id"]].get("postOnly") == [], "11b. [] when the computer posts to any company")
    c, r = call({"kind": "beat", "version": "2.1.5", "bridge": main, "tally": True})
    ok(dev["info"]["beat"].get("postOnly") is None, "11b. an older bridge without the field: none kept (not an empty list)")
    # round 19: a 2.1.9 beat carries the change numbers top-level only (startPoint / changeNumbers by company; companies[]
    # without them). On a cloud without migration 44 (the stand-in has no tally_start_point / tally_recorder_gap_check) the
    # beat still answers 200; each missing function is said ONCE in the log with the company (console.error), not every beat
    n_log = len(log)
    b19 = {"kind": "beat", "version": "2.1.9", "bridge": dict(main, version="2.1.9"), "tally": True, "paused": True, "companies": [],
           "startPoint": {"ZZ CO": {"altvchid": 50, "altmstid": 3, "at": "2026-10-04T15:40:00", "guid": "cg-1"}},
           "changeNumbers": {"ZZ CO": {"altvchid": 52, "altmstid": 3, "at": "2026-10-04T15:45:00", "recorderSeen": True, "recorderLastAt": "2026-10-04T15:44:00"}}}
    c1, r1 = call(b19); c2, r2 = call(b19); time.sleep(0.5)
    said = lambda fn: [l.strip() for l in log[n_log:] if fn in l]
    ok(c1 == 200 and c2 == 200 and r1.get("ok") is True and r2.get("ok") is True, "19. a 2.1.9 beat with startPoint / changeNumbers on a cloud without 44: answered 200 (%s %s)" % (c1, c2))
    ok(len(F.ARGS.get("tally_start_point", [])) >= 1 and F.ARGS["tally_start_point"][0].get("p_guid") == "cg-1" and F.ARGS["tally_start_point"][0].get("p_altvch") == 50
       and any(a.get("p_altvchid") == 52 for a in F.ARGS.get("tally_recorder_gap_check", [])), "19. the top-level shape is read: tally_start_point (GUID cg-1, 50) and the gap check (52) are tried (%s)" % F.ARGS.get("tally_start_point"))
    ok(len(said("tally_start_point")) == 1 and "ZZ CO" in said("tally_start_point")[0] and len(said("tally_recorder_gap_check")) == 1 and "ZZ CO" in said("tally_recorder_gap_check")[0],
       "19. each missing function said once in the log, with the company, never silently (%s)" % (said("tally_start_point") + said("tally_recorder_gap_check")))
    ok(dev["info"]["bridges"][GO["id"]].get("recorder") == {"ZZ CO": {"seen": True, "lastAt": "2026-10-04T15:44:00"}}, "19. recorderOf reads changeNumbers' recorderSeen (%s)" % dev["info"]["bridges"][GO["id"]].get("recorder"))
    # round 19 (migration 46): the beat answer carries trialTools from tally_devices.trial_tools; no column (a cloud without 46): false
    ok(r1.get("trialTools") is False and "trial_tools" not in dev, "46. no trial_tools column: the beat answers trialTools false (%s)" % r1.get("trialTools"))
    dev["trial_tools"] = True
    c, r = call({"kind": "beat", "version": "2.1.10", "bridge": dict(main, version="2.1.10"), "tally": True})
    ok(c == 200 and r.get("trialTools") is True, "46. the owner's switch on: trialTools true (%s)" % r.get("trialTools"))
    dev["trial_tools"] = False
    c, r = call({"kind": "beat", "version": "2.1.10", "bridge": dict(main, version="2.1.10"), "tally": True})
    ok(c == 200 and r.get("trialTools") is False, "46. off: trialTools false (%s)" % r.get("trialTools"))
    dev.pop("trial_tools", None)
    # condition 4 (bridge 2.2.0): the 2-second rule's switch-offs (recorderBodyFetch / recorderSourceB / recorderSourceC, each
    # {company: {off, seconds, at, why}}) kept in the bridge's entry as recorderOff {bodies, B, C}; junk cleaned; absent when not sent
    off1 = {"off": True, "seconds": 3.4567, "at": "2026-10-05T14:05:09", "why": "Tally took 3.5 s for one entry (limit 2 s)"}
    junk = {"GARG SHEKHAR & COMPANY": off1, "x" * 300: off1, "NotOff": dict(off1, off=False), "Str": dict(off1, seconds="3"),
            "Big": dict(off1, seconds=99999), "Neg": dict(off1, seconds=-1), "Arr": [1], "Long": dict(off1, at="t" * 50, why="w" * 500)}
    junk.update({"Co %02d" % i: off1 for i in range(60)})
    c, r = call({"kind": "beat", "version": "2.2.0", "bridge": dict(main, version="2.2.0"), "tally": True,
                 "recorderBodyFetch": junk, "recorderSourceB": {"ZZ CO": dict(off1, seconds=2.04)}, "recorderSourceC": "nonsense"})
    ro = dev["info"]["bridges"][GO["id"]].get("recorderOff") or {}
    bo = ro.get("bodies") or {}
    ok(c == 200 and bo.get("GARG SHEKHAR & COMPANY") == {"off": True, "seconds": 3.5, "at": "2026-10-05T14:05:09", "why": off1["why"]},
       "c4. recorderBodyFetch stored in the bridge's entry as recorderOff.bodies, seconds rounded to 0.1 (%s)" % bo.get("GARG SHEKHAR & COMPANY"))
    ok(ro.get("B") == {"ZZ CO": {"off": True, "seconds": 2.0, "at": "2026-10-05T14:05:09", "why": off1["why"]}} and "C" not in ro,
       "c4. recorderSourceB stored as recorderOff.B; recorderSourceC not an object: not kept (%s)" % {k: ro.get(k) for k in ("B", "C")})
    ok(len(bo) <= 50 and all(len(k) <= 200 for k in bo) and not any(k in bo for k in ("NotOff", "Str", "Big", "Neg", "Arr")),
       "c4. junk dropped: off not true, seconds not a number or outside 0..3600, not an object, names over 200; at most 50 (%d kept)" % len(bo))
    ok(bo.get("Long", {}).get("at") == "t" * 30 and len(bo.get("Long", {}).get("why", "")) == 300, "c4. at cut to 30, why cut to 300")
    c, r = call({"kind": "beat", "version": "2.2.0", "bridge": dict(main, version="2.2.0"), "tally": True, "recorderBodyFetch": {"NotOff": dict(off1, off=False)}})
    ok(c == 200 and "recorderOff" not in dev["info"]["bridges"][GO["id"]], "c4. nothing off after cleaning: no recorderOff in the entry")
    c, r = call({"kind": "beat", "version": "2.1.10", "bridge": main, "tally": True})
    ok(c == 200 and "recorderOff" not in dev["info"]["bridges"][GO["id"]], "c4. an older bridge (no fields sent): no recorderOff")
    c, r = call({"kind": "posts_take", "version": "2.1.0", "bridge": main})
    ok(c == 200, "and may take it (%s)" % c)
    # the bridge's menu: Switch to main bridge (a second Go install takes over)
    dev["main_bridge"] = None
    other = dict(GO, id="go-aaaaaaaaaaaa")   # the same Windows user's second install (the main-bridge rule holds within ONE Windows user)
    c, r = call({"kind": "make_main", "shadow": True, "version": "2.1.0", "bridge": other})
    ok(c == 200 and dev.get("main_bridge") == "go-aaaaaaaaaaaa", "Switch to main bridge from a bridge's menu records it as the main one")
    c, r = call({"kind": "make_main", "version": "1.15.0"})
    ok(c == 400 and dev.get("main_bridge") == "go-aaaaaaaaaaaa", "1.15.0 cannot make itself the main bridge")
    # its line, as its own beats put it there (the main-bridge rule compares the Windows users of the two lines)
    dev["info"]["bridges"].setdefault("go-aaaaaaaaaaaa", {"at": dev["info"]["bridges"][GO["id"]]["at"], "computer": "NWS144", "user": GO["user"], "mode": "test"})
    c, r = call({"kind": "beat", "version": "2.1.0", "bridge": main, "tally": True})
    ok(r.get("notMain") is True and r.get("posts") == 0, "and the first 2.1.0 (the same Windows user) is then told it is not the main one")
    # the owner's rule of 05-Oct-2026: another Windows user's main bridge on the same computer key stops nobody
    dev["info"]["bridges"]["go-aaaaaaaaaaaa"]["user"] = "tally2"
    c, r = call({"kind": "beat", "version": "2.1.0", "bridge": main, "tally": True})
    ok(c == 200 and not r.get("notMain"), "#7. another Windows user's main bridge (tally2) on the same key: this bridge still posts (%s)" % r.get("notMain"))
    # posting updates (02-Oct-2026): each entry's state kept; a cancelled or vanished posting is told to the bridge
    dev["main_bridge"] = None
    c, r = call({"kind": "posts_update", "version": "2.1.0", "bridge": main, "id": "p-1", "status": "taken", "done": 0, "message": "Waiting for Tally: ZZ CO is not open",
                 "items": [{"id": "v1", "kind": "voucher", "state": "waiting", "reason": ""}, {"id": "v2", "state": "bogus"}]})
    job = F.T["tally_post_jobs"][0]
    ok(c == 200 and job.get("items") == [{"id": "v1", "kind": "voucher", "state": "waiting", "reason": ""}, {"id": "v2", "kind": "", "state": "waiting", "reason": ""}], "each entry's state is kept (an unknown state is read as waiting)")
    job["status"] = "cancelled"
    c, r = call({"kind": "posts_update", "version": "2.1.0", "bridge": main, "id": "p-1", "status": "taken", "message": "x"})
    ok(c == 200 and r.get("cancelled") is True and job["status"] == "cancelled", "a posting cancelled in FinCom: the bridge is told (cancelled), nothing changes")
    c, r = call({"kind": "posts_update", "version": "2.1.0", "bridge": main, "id": "no-such", "status": "taken"})
    ok(c == 200 and r.get("gone") is True, "a posting no longer there: the bridge is told (gone)")
    # 03-Oct-2026 (round 4): Tally accepted an entry (CREATED with LASTVCHID 26298) but the bridge reported the posting
    # failed; the cloud never stores that as failed: the entry's state is forced to unknown while not verified, the posting
    # stays running with checking, the id is stamped accepted_at (migration-36-post-acceptance) so the sync keeps it live
    job["status"] = "running"
    acc = []; real_rpc36 = F.rpc
    def rpc36(fn, a):
        if fn == "tally_post_id_accept": acc.append(a); return {"ok": True, "stamped": 1}
        return real_rpc36(fn, a)
    F.rpc = rpc36
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "done": 0, "message": "1 entry failed",
                 "results": [{"id": "v1", "ok": False, "verified": False, "message": "Tally replied CREATED 1 LASTVCHID 26298; the read-back did not find it"}, {"id": "v2", "ok": False, "message": "Tally refused it: ledger missing"}],
                 "items": [{"id": "v1", "state": "failed", "reason": "read-back failed"}, {"id": "v2", "state": "failed", "reason": "ledger missing"}]})
    it = {x["id"]: x for x in job.get("items") or []}; rs = {x["id"]: x for x in job.get("results") or []}
    ok(c == 200 and job["status"] == "done" and job.get("checking") is True and job.get("message", "").startswith("Posted, not yet confirmed:"), "an entry Tally accepted: the posting is stored 'done' with checking (never failed, never 'running': the requeue would send it again); 'Posted, not yet confirmed: …' (%s, %s)" % (job["status"], job.get("message")))
    ok(it.get("v1", {}).get("state") == "unknown" and rs.get("v1", {}).get("outcomeUnknown") is True and rs["v1"].get("state") == "unknown" and rs["v1"].get("ok") is False, "the accepted entry is unknown (checking), not failed (%s)" % it.get("v1"))
    ok(it.get("v2", {}).get("state") == "failed" and rs.get("v2", {}).get("state") != "unknown", "the entry Tally refused stays failed")
    strip = lambda a: {k: v for k, v in a.items() if k != "p_at"}
    ok([strip(a) for a in acc] == [{"p_job": "p-1", "p_id": "v1", "p_vch": "26298"}], "tally_post_id_accept(job, id, voucher) called for v1 alone, with the voucher from Tally's words (%s)" % acc)
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v1", "ok": True, "verified": True, "vchNumber": "26298"}, {"id": "v2", "ok": False, "message": "refused"}],
                 "items": [{"id": "v1", "state": "in_tally"}, {"id": "v2", "state": "failed", "reason": "refused"}]})
    it = {x["id"]: x for x in job.get("items") or []}
    # round 5 (C2): the hold is per entry. v1 verified in Tally holds nothing; v2 plainly refused: the posting is failed as before
    ok(c == 200 and job["status"] == "failed" and job.get("checking") is False and it["v1"]["state"] == "in_tally" and it["v2"]["state"] == "failed",
       "C2. one entry verified in Tally and one plainly refused: stored failed as before, in_tally kept (%s, %s)" % (job["status"], job.get("message")))
    job["status"] = "running"
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "message": "1 failed", "results": [{"id": "v1", "ok": True, "verified": None}, {"id": "v2", "ok": False, "message": "refused"}],
                 "items": [{"id": "v1", "state": "in_tally"}, {"id": "v2", "state": "failed", "reason": "refused"}]})
    ok(c == 200 and job["status"] == "failed", "C2. an entry whose item says in_tally holds nothing either (%s)" % job["status"])
    job["status"] = "running"; acc.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "message": "2 failed",
                 "results": [{"id": "v1", "ok": True, "verified": True, "vchNumber": "26298"}, {"id": "v2", "ok": False, "message": "CREATED 1 LASTVCHID 26299; read-back failed"}, {"id": "v3", "ok": False, "message": "refused: ledger missing"}],
                 "items": [{"id": "v1", "state": "in_tally"}, {"id": "v2", "state": "failed", "reason": "read-back failed"}, {"id": "v3", "state": "failed", "reason": "ledger missing"}]})
    it = {x["id"]: x for x in job.get("items") or []}
    ok(c == 200 and job["status"] == "done" and job.get("checking") is True and "accepted 1 entry " in job.get("message", "") and it["v2"]["state"] == "unknown" and it["v3"]["state"] == "failed" and it["v1"]["state"] == "in_tally",
       "C2. one verified, one accepted but unconfirmed, one refused: held open for the one entry alone, the message counts 1 (%s)" % job.get("message"))
    ok(sorted(a["p_id"] for a in acc) == ["v1", "v2"], "the stamp is for every entry Tally accepted, verified or not (%s)" % [a["p_id"] for a in acc])
    for k, v in (("accepted", True), ("lastVchId", "26305")):
        job["status"] = "running"; acc.clear()
        c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v2", "ok": False, k: v, "message": "x"}], "items": [{"id": "v2", "state": "failed"}]})
        ok(job["status"] == "done" and job.get("checking") is True and job["items"][0]["state"] == "unknown" and len(acc) == 1 and acc[0]["p_vch"] == ("26305" if k == "lastVchId" else ""), "C2. %s in a result is an acceptance too (%s)" % (k, acc))
    # C7 (bridge 2.1.6): an entry Tally accepted but not confirmed arrives as ok false, accepted true, lastVchId, state unknown:
    # stored unknown, its id stamped with the voucher id and never released, the posting not failed
    rel7 = []; real7 = F.rpc
    def rpc7(fn, a):
        if fn == "tally_post_id_release": rel7.append(a); return {"ok": True, "released": True}
        return rpc36(fn, a)
    F.rpc = rpc7; job["status"] = "running"; acc.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.6", "bridge": main, "id": "p-1", "status": "failed", "message": "1 not confirmed",
                 "results": [{"id": "v2", "ok": False, "accepted": True, "lastVchId": "26298", "outcomeUnknown": True, "state": "unknown", "message": "Tally replied 'created' (voucher id 26298) but the read-back did not find it; being checked and is not sent again"}],
                 "items": [{"id": "v2", "state": "failed", "reason": "not confirmed"}]})
    it = {x["id"]: x for x in job.get("items") or []}; rs = {x["id"]: x for x in job.get("results") or []}
    ok(c == 200 and job["status"] == "done" and job.get("checking") is True and it["v2"]["state"] == "unknown" and rs["v2"].get("accepted") is True and rs["v2"].get("lastVchId") == "26298" and rs["v2"].get("ok") is False,
       "C7. ok false + accepted true + lastVchId: item unknown, the result kept with accepted and lastVchId, the posting 'done' + checking, never failed, never running (%s)" % job["status"])
    ok(job["status"] not in ("running", "taken", "waiting"), "C7/owner: an accepted, unconfirmed posting is never parked where tally_post_requeue or tally_post_take would send it again (%s)" % job["status"])
    ok([strip(a) for a in acc] == [{"p_job": "p-1", "p_id": "v2", "p_vch": "26298"}] and rel7 == [], "C7. the id stamped accepted with the voucher id, never released (%s, %s)" % (acc, rel7))
    # F2: the time of Tally's reply (acceptedAt) travels with the stamp (p_at), so an owner's release made after it is kept
    job["status"] = "running"; acc.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v2", "ok": False, "accepted": True, "lastVchId": "26298", "acceptedAt": "2026-10-03T04:23:00Z", "state": "unknown"}], "items": [{"id": "v2", "state": "unknown"}]})
    ok(acc and "p_at" not in acc[0], "F2/R5. tally_post_id_accept is called without the bridge's clock: the cloud stamps its own time (%s)" % acc)
    # F3: the posting's ids are read once; only ids not yet stamped are stamped (300 ok results, 298 stamped: 2 calls), and
    # only ids not yet released are released
    F.T["tally_post_ids"] = [{"job_id": "p-1", "fincom_id": "v%d" % i, "entry_id": "v%d" % i, "accepted_at": None if i > 298 else "2026-10-03T04:00:00Z", "released_at": None} for i in range(1, 301)]
    F.T["tally_post_ids"].append({"job_id": "p-1", "fincom_id": "w-1", "entry_id": "w-1", "accepted_at": None, "released_at": "2026-10-03T04:00:00Z"})
    # R1: v298 was accepted once and then released by the owner (accepted_at kept as history): stamped again, so a new acceptance can clear the release
    F.T["tally_post_ids"][297]["released_at"] = "2026-10-03T05:00:00Z"; F.T["tally_post_ids"][297]["released_by"] = "owner"
    job["status"] = "running"; acc.clear(); rel7.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "done", "results": [{"id": "v%d" % i, "ok": True, "verified": True, "vchNumber": str(i)} for i in range(1, 301)] + [{"id": "w-1", "ok": False, "message": "refused"}, {"id": "w2", "ok": False, "message": "refused"}],
                 "items": [{"id": "w-1", "state": "failed", "reason": "refused"}, {"id": "w2", "state": "failed", "reason": "refused"}]})
    ok(c == 200 and sorted(a["p_id"] for a in acc) == ["v298", "v299", "v300"], "F3/R1. 300 accepted entries, 297 stamped and not released: tally_post_id_accept called for the 2 new ones and the released one alone (%d calls)" % len(acc))
    ok([a["p_id"] for a in rel7] == ["w2"], "F3. the id already released (w-1) is not released again; the new one is (%s)" % rel7)
    F.T["tally_post_ids"] = []
    # F4: a late update never goes back in time: a lower seq is ignored, and done / failed never return to running / taken
    job["status"] = "running"; job.pop("seq", None)
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "running", "seq": 5, "message": "5 of 9", "results": [], "items": []})
    ok(c == 200 and job.get("seq") == 5 and job["message"] == "5 of 9", "F4. seq stored with the update (%s)" % job.get("seq"))
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "running", "seq": 3, "message": "late: 3 of 9", "results": [], "items": []})
    ok(c == 200 and r.get("stale") is True and job["message"] == "5 of 9" and job.get("seq") == 5, "F4. an update with a lower seq is ignored, said so (stale) (%s)" % job["message"])
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "done", "seq": 6, "message": "9 of 9", "results": [{"id": "v1", "ok": True, "verified": True}], "items": []})
    ok(job["status"] == "done" and job.get("seq") == 6, "F4. done at seq 6")
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "running", "seq": 7, "message": "running again?", "results": [], "items": []})
    ok(c == 200 and job["status"] == "done" and r.get("stale") is True, "F4. done never goes back to running (%s)" % job["status"])
    job["status"] = "failed"
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "taken", "seq": 8, "results": [], "items": []})
    ok(job["status"] == "failed", "F4. failed never goes back to taken (%s)" % job["status"])
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "running", "message": "an older bridge, no seq", "results": [], "items": []})
    ok(job["status"] == "failed" and job.get("seq") == 6 and r.get("stale") is True, "F4/H1. a finished posting (failed, nothing being checked) takes no update at all, with or without seq (%s)" % job.get("seq"))
    # H1 (c): the owner's settlement of an entry (byOwner) is never written over by the bridge; one the bridge no longer names stays
    job["status"] = "running"; job["checking"] = False
    job["results"] = [{"id": "v1", "ok": True, "verified": True, "state": "in_tally", "vchNumber": "26298", "byOwner": True}, {"id": "v3", "ok": False, "state": "notfound", "byOwner": True}]
    job["items"] = [{"id": "v1", "state": "in_tally", "byOwner": True}, {"id": "v3", "state": "notfound", "byOwner": True}]
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "running", "seq": 9, "results": [{"id": "v1", "ok": False, "message": "late: refused"}, {"id": "v2", "ok": True, "verified": True}], "items": [{"id": "v1", "state": "failed", "reason": "late"}, {"id": "v2", "state": "in_tally"}]})
    rs = {x["id"]: x for x in job["results"]}; it = {x["id"]: x for x in job["items"]}
    ok(c == 200 and rs["v1"].get("byOwner") is True and rs["v1"]["ok"] is True and it["v1"]["state"] == "in_tally" and rs["v2"]["ok"] is True and it["v2"]["state"] == "in_tally" and rs["v3"].get("byOwner") is True and it["v3"]["state"] == "notfound",
       "H1. per entry: the owner's v1 stands, the bridge's v2 is stored, the owner's v3 (no longer named) stays (%s)" % sorted(rs))
    # R1: the bridge's entry newer than the owner's stamp (byOwnerAt) wins: it sent the entry once more after the release
    job["status"] = "running"; job["checking"] = False
    job["results"] = [{"id": "v3", "ok": False, "state": "notfound", "byOwner": True, "byOwnerAt": "2026-10-03T05:00:00Z"}]; job["items"] = [{"id": "v3", "state": "notfound", "byOwner": True, "byOwnerAt": "2026-10-03T05:00:00Z"}]
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "running", "seq": 10, "updatedAt": "2026-10-03T05:30:00Z", "results": [{"id": "v3", "ok": True, "verified": True, "vchNumber": "26400", "acceptedAt": "2026-10-03T05:29:00Z"}], "items": [{"id": "v3", "state": "in_tally"}]})
    rs = {x["id"]: x for x in job["results"]}; it = {x["id"]: x for x in job["items"]}
    ok(c == 200 and rs["v3"]["ok"] is True and rs["v3"].get("byOwner") is not True and it["v3"]["state"] == "in_tally", "R1. a bridge result newer than the owner's release shows the bridge's state (%s)" % rs["v3"].get("state"))
    job["results"] = []; job["items"] = []
    # R2: a posting held (done + checking) keeps checking while the bridge still sends running updates; its final update lands
    job["status"] = "done"; job["checking"] = True
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "running", "seq": 11, "checking": False, "message": "sending", "results": [], "items": []})
    ok(c == 200 and job["status"] == "done" and job["checking"] is True and r.get("stale") is True, "R2. clamped to done: checking kept true (%s)" % job.get("checking"))
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "done", "seq": 12, "checking": False, "message": "1 of 1 in Tally", "results": [{"id": "v1", "ok": True, "verified": True}], "items": [{"id": "v1", "state": "in_tally"}]})
    ok(c == 200 and not r.get("stale") and job["checking"] is False and job["message"] == "1 of 1 in Tally", "R2. the bridge's final update lands (%s)" % job["message"])
    # R4: held: true (a partial fast batch, not found by tag) is an acceptance: stamped, unconfirmed, the posting held
    job["status"] = "running"; job["checking"] = False; acc.clear(); rel7.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v9", "ok": False, "held": True, "message": "in a batch Tally took; not found by tag yet"}], "items": [{"id": "v9", "state": "failed", "reason": "not found by tag"}]})
    it = {x["id"]: x for x in job["items"]}
    ok(c == 200 and job["status"] == "done" and job["checking"] is True and it["v9"]["state"] == "unknown" and [a["p_id"] for a in acc] == ["v9"] and acc[0]["p_vch"] == "" and rel7 == [], "R4. held: stamped (no voucher), unknown, the posting held, never released (%s)" % job["status"])
    job["results"] = []; job["items"] = []
    # M2: the 2.1.5 bridge's exact words (the build on NWS144), no voucher id, no accepted flag: held, the id stamped
    T215 = "Tally replied 'created', but the entry cannot be found in 'ZZ CO'. It was not sent again: look for it in Tally (another company open in Tally, or an Optional voucher)."
    job["status"] = "running"; acc.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "message": "1 failed", "results": [{"id": "v5", "ok": False, "verified": False, "message": T215}], "items": [{"id": "v5", "state": "failed", "reason": T215}]})
    it = {x["id"]: x for x in job["items"]}
    ok(c == 200 and job["status"] == "done" and job.get("checking") is True and it["v5"]["state"] == "unknown" and [a["p_id"] for a in acc] == ["v5"], "M2. the 2.1.5 text alone: held (done + checking), unknown, the id stamped (%s)" % job["status"])
    job["status"] = "running"; acc.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v6", "ok": False, "created": 1, "message": "x"}], "items": [{"id": "v6", "state": "failed"}]})
    ok(job["status"] == "done" and [a["p_id"] for a in acc] == ["v6"], "M2. created > 0 in a result is an acceptance too")
    # L4: Tally created it in another company: held (the voucher is in Tally), the words say so, not 'post again'
    job["status"] = "running"; acc.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v7", "ok": False, "wrongCompany": "OTHER CO", "lastVchId": "26350", "message": "Tally put this entry into 'OTHER CO', not 'ZZ CO'. Delete it ... then post again."}], "items": [{"id": "v7", "state": "failed", "reason": "wrong company"}]})
    it = {x["id"]: x for x in job["items"]}; rs = {x["id"]: x for x in job["results"]}
    ok(job["status"] == "done" and it["v7"]["state"] == "unknown" and it["v7"]["reason"].startswith("Tally created it in OTHER CO instead; an owner marks it posted or releases it") and rs["v7"]["reason"].startswith("Tally created it in OTHER CO instead") and [a["p_id"] for a in acc] == ["v7"],
       "L4. held, the reason reworded for the owner (%s)" % it["v7"]["reason"][:90])
    job["status"] = "running"; acc.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.7", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v8", "ok": False, "lastVchId": "1"}], "items": [{"id": "v8", "state": "failed", "reason": "r" * 600}]})
    ok(len(job["items"][0]["reason"]) <= 500, "INFO. an item's reason stays under 500 (%d)" % len(job["items"][0]["reason"]))
    # round 11 bridge: a PostOnly refusal (this computer posts to one company only) is a plain refusal: no acceptance in its
    # words, the id released with the reason, the posting failed
    job["status"] = "running"; acc.clear(); rel7.clear(); F.rpc = rpc7
    PO = "This computer posts only to ZZ CO (PostOnly); posting to OTHER CO refused"
    c, r = call({"kind": "posts_update", "version": "2.1.9", "bridge": main, "id": "p-1", "status": "failed", "message": "1 refused",
                 "results": [{"id": "v11", "ok": False, "refused": True, "postOnly": True, "state": "failed", "reason": PO}], "items": [{"id": "v11", "state": "failed", "reason": PO}]})
    rs = {x["id"]: x for x in job["results"]}; it = {x["id"]: x for x in job["items"]}
    ok(c == 200 and job["status"] == "failed" and job.get("checking") is False and it["v11"]["state"] == "failed" and rs["v11"].get("refused") is True and rs["v11"].get("postOnly") is True and rs["v11"]["state"] == "failed",
       "11. a PostOnly refusal: stored failed as a plain refusal, refused / postOnly kept (%s)" % job["status"])
    ok(acc == [] and [strip(a) for a in rel7] == [{"p_job": "p-1", "p_id": "v11", "p_why": PO}], "11. never accepted (no CREATED / ALTERED in its words), the id released with the reason (%s, %s)" % (acc, rel7))
    # round 11s (M5): even a company named "Created 1 Pvt Ltd" in the refusal's words is never an acceptance: refused + postOnly
    # are read before the heuristics, on the result and on the item
    job["status"] = "running"; acc.clear(); rel7.clear()
    PO2 = "This computer posts only to Created 1 Pvt Ltd (PostOnly); posting to ZZ CO refused"
    c, r = call({"kind": "posts_update", "version": "2.1.9", "bridge": main, "id": "p-1", "status": "failed", "message": "1 refused",
                 "results": [{"id": "v12", "ok": False, "refused": True, "postOnly": True, "state": "failed", "reason": PO2, "message": PO2}], "items": [{"id": "v12", "state": "failed", "postOnly": True, "reason": PO2}]})
    it = {x["id"]: x for x in job["items"]}
    ok(c == 200 and job["status"] == "failed" and it["v12"]["state"] == "failed" and it["v12"].get("postOnly") is True and acc == [] and [a["p_id"] for a in rel7] == ["v12"], "M5. 'Created 1 Pvt Ltd' in a PostOnly refusal: never accepted, failed, the id released (%s)" % acc)
    F.rpc = real7
    # round 15 (build 2.1.8, migration 43): the bridge posts by Tally's reply. A result may carry byReply, vchId, batchEnd,
    # batchN, needsReview, accepted, created, altered, exceptions, ignored, errors, lineError, lastVchId, company, sentAt,
    # secondsReq; the update may carry reqs:[{n, seconds, created, altered, exceptions, ignored, lastVchId}] and secondsTotal
    # (stored in tally_post_jobs.timing). A byReply ok result: tally_post_id_accept_reply(job, id, vchId, batchEnd, batchN)
    # and the entry is taken (never held open); needsReview + accepted: tally_post_id_accept(job, id, lastVchId), unconfirmed
    # (the posting held, done + checking); needsReview without accepted: the id released 'needs review: ' + message
    rep15, acc15, rel15, NOREPLY = [], [], [], {"on": False}
    def rpc15(fn, a):
        if fn == "tally_post_id_accept_reply":
            if NOREPLY["on"]: raise RuntimeError("Could not find the function public.tally_post_id_accept_reply(p_batch_end, p_batch_n, p_id, p_job, p_vch) in the schema cache")
            rep15.append(a); return {"ok": True, "stamped": 1}
        if fn == "tally_post_id_accept": acc15.append(a); return {"ok": True, "stamped": 1}
        if fn == "tally_post_id_release": rel15.append(a); return {"ok": True, "released": True}
        return real7(fn, a)
    F.rpc = rpc15; job["status"] = "running"; job["checking"] = False; job["results"] = []; job["items"] = []; job.pop("timing", None)
    R15 = [{"id": "b1", "ok": True, "byReply": True, "vchId": "26500", "batchEnd": "26500", "batchN": 1, "created": 1, "altered": 0, "exceptions": 0, "ignored": 0, "errors": 0, "lastVchId": "26500", "company": "ZZ CO", "sentAt": "2026-10-03T09:00:01Z", "secondsReq": 1.25, "message": "Tally replied CREATED 1 LASTVCHID 26500"},
           {"id": "b2", "ok": True, "byReply": True, "vchId": "", "batchEnd": "26503", "batchN": 3, "created": 3, "message": "in a batch of 3 ending at 26503"},
           {"id": "b3", "ok": False, "needsReview": True, "accepted": True, "lastVchId": "26504", "created": 1, "exceptions": 1, "lineError": "Ledger 'Freight' does not exist", "state": "unknown", "message": "CREATED 1 with 1 exception"},
           {"id": "b4", "ok": False, "needsReview": True, "accepted": False, "created": 0, "errors": 1, "lineError": "Voucher number duplicate" + "x" * 400, "message": "Tally created nothing: 1 error"}]
    I15 = [{"id": "b1", "state": "sent"}, {"id": "b2", "state": "sent"}, {"id": "b3", "state": "unknown", "reason": "needs review"}, {"id": "b4", "state": "failed", "reason": "needs review"}]
    REQS15 = [{"n": 1, "seconds": 1.25, "created": 1, "altered": 0, "exceptions": 0, "ignored": 0, "lastVchId": "26500"}, {"n": 3, "seconds": 2.5, "created": 3, "altered": 0, "exceptions": 0, "ignored": 0, "lastVchId": "26503"}, {"n": "x", "seconds": -1, "junk": True}]
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "failed", "seq": 20, "message": "Posted 2 of 4; 2 need review", "results": R15, "items": I15, "reqs": REQS15, "secondsTotal": 3.75})
    rs = {x["id"]: x for x in job.get("results") or []}; it = {x["id"]: x for x in job.get("items") or []}
    ok(c == 200 and rs["b1"].get("byReply") is True and rs["b1"].get("vchId") == "26500" and rs["b1"].get("batchEnd") == "26500" and rs["b1"].get("batchN") == 1 and rs["b1"].get("created") == 1 and rs["b1"].get("lastVchId") == "26500"
       and rs["b1"].get("company") == "ZZ CO" and rs["b1"].get("sentAt") == "2026-10-03T09:00:01Z" and rs["b1"].get("secondsReq") == 1.25 and rs["b1"].get("exceptions") == 0 and rs["b1"].get("ignored") == 0 and rs["b1"].get("errors") == 0,
       "15. the reply fields of a result are stored: byReply, vchId, batchEnd, batchN, created, lastVchId, company, sentAt, secondsReq, exceptions, ignored, errors (%s)" % {k: rs["b1"].get(k) for k in ("byReply", "vchId", "batchEnd", "batchN", "secondsReq")})
    ok(rs["b3"].get("needsReview") is True and rs["b3"].get("accepted") is True and rs["b3"].get("lineError") == ["Ledger 'Freight' does not exist"] and rs["b4"].get("needsReview") is True and rs["b4"].get("accepted") is False and rs["b4"].get("lineError") == [("Voucher number duplicate" + "x" * 400)[:200]],
       "15. needsReview, accepted and lineError stored (lineError an array of texts, each cut to 200: the review's finding 8) (%s)" % {k: rs["b3"].get(k) for k in ("needsReview", "accepted", "lineError")})
    ok(rs["b2"].get("vchId") == "" and rs["b2"].get("batchN") == 3 and rs["b2"].get("batchEnd") == "26503", "15. a result of a batch of 3: no vchId of its own, batchEnd and batchN (%s)" % {k: rs["b2"].get(k) for k in ("vchId", "batchEnd", "batchN")})
    tm = job.get("timing") or {}
    ok(tm.get("secondsTotal") == 3.75 and tm.get("reqs") == [{"n": 1, "seconds": 1.25, "created": 1, "altered": 0, "exceptions": 0, "ignored": 0, "lastVchId": "26500"}, {"n": 3, "seconds": 2.5, "created": 3, "altered": 0, "exceptions": 0, "ignored": 0, "lastVchId": "26503"}, {"n": 0, "seconds": 0, "created": 0, "altered": 0, "exceptions": 0, "ignored": 0, "lastVchId": ""}],
       "15. tally_post_jobs.timing = {reqs: [{n, seconds, created, altered, exceptions, ignored, lastVchId}], secondsTotal}, cleaned (%s)" % json.dumps(tm)[:160])
    ok([strip(a) for a in rep15] == [{"p_job": "p-1", "p_id": "b1", "p_vch": "26500", "p_batch_end": "26500", "p_batch_n": 1}, {"p_job": "p-1", "p_id": "b2", "p_vch": None, "p_batch_end": "26503", "p_batch_n": 3}],
       "15. tally_post_id_accept_reply(job, id, vchId or null, batchEnd, batchN) for each byReply ok result (%s)" % rep15)
    ok([strip(a) for a in acc15] == [{"p_job": "p-1", "p_id": "b3", "p_vch": "26504"}], "15. a needsReview + accepted result: tally_post_id_accept(job, id, lastVchId), as an accepted unconfirmed id (%s)" % acc15)
    ok([strip(a) for a in rel15] == [{"p_job": "p-1", "p_id": "b4", "p_why": "needs review: Tally created nothing: 1 error"}], "15. a needsReview result without accepted (created 0): the id released with 'needs review: ' + message (%s)" % rel15)
    ok(job["status"] == "done" and job.get("checking") is True and it["b3"]["state"] == "unknown" and it["b1"]["state"] == "sent" and it["b2"]["state"] == "sent" and it["b4"]["state"] == "failed" and rs["b1"]["ok"] is True and rs["b2"]["ok"] is True,
       "15. the posting is held for the accepted unconfirmed entry alone (done + checking); the byReply ok entries are taken (sent, ok), never held open; the needsReview-without-accepted entry failed (%s %s)" % (job["status"], {k: it[k]["state"] for k in it}))
    # byReply ok entries alone (no needsReview): the posting is done as the bridge says, never held open as unconfirmed
    job["status"] = "running"; job["checking"] = False; rep15.clear(); acc15.clear(); rel15.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "done", "seq": 21, "message": "Posted 2 of 2", "results": [dict(R15[0]), dict(R15[1])], "items": [{"id": "b1", "state": "sent"}, {"id": "b2", "state": "sent"}], "reqs": REQS15[:2], "secondsTotal": 3.75})
    ok(c == 200 and job["status"] == "done" and job.get("checking") is False and job["message"] == "Posted 2 of 2" and [a["p_id"] for a in rep15] == ["b1", "b2"] and acc15 == [], "15. byReply ok results alone: done, no checking, stamped through the reply function alone (%s)" % job["status"])
    # a cloud without migration 43: tally_post_id_accept_reply is missing (PostgREST: 'Could not find the function'): the plain stamp is used, and timing is dropped
    NOREPLY["on"] = True; job["status"] = "running"; job["checking"] = False; rep15.clear(); acc15.clear(); job.pop("timing", None)
    _patch15 = F.H.do_PATCH
    def patch15(self):
        from urllib.parse import urlparse as _u
        if _u(self.path).path.endswith("/tally_post_jobs"):
            raw = self.body()
            if b'"timing"' in raw: return self.send(400, {"code": "PGRST204", "message": "Could not find the 'timing' column of 'tally_post_jobs' in the schema cache"})
            qq = __import__("urllib.parse", fromlist=["parse_qs"]).parse_qs(_u(self.path).query, keep_blank_values=True)
            for rw in F.T["tally_post_jobs"]:
                if F.match(rw, qq): rw.update(json.loads(raw))
            return self.send(204)
        return _patch15(self)
    F.H.do_PATCH = patch15
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "done", "seq": 22, "message": "Posted 1 of 1", "results": [dict(R15[0])], "items": [{"id": "b1", "state": "sent"}], "reqs": REQS15[:1], "secondsTotal": 1.25})
    F.H.do_PATCH = _patch15
    ok(c == 200 and job["status"] == "done" and job["message"] == "Posted 1 of 1" and "timing" not in job and [strip(a) for a in acc15] == [{"p_job": "p-1", "p_id": "b1", "p_vch": "26500"}] and rep15 == [],
       "15. without migration 43: the update lands without timing, and the byReply ok id is stamped with tally_post_id_accept(job, id, vchId) instead (%s, %s)" % (job.get("message"), acc15))
    NOREPLY["on"] = False; F.rpc = real7; job["results"] = []; job["items"] = []
    # the code review of 2.1.8 (docs/reviews/bridge-2.1.8-code-review.md, findings 3, 4, 5, 8 and 2's cloud half)
    F.rpc = rpc15; rep15.clear(); acc15.clear(); rel15.clear()
    # 3. the 2.1.8 bridge's item states posted and needs_review are kept (not read as waiting: the settle would leave the job running)
    job["status"] = "running"; job["checking"] = False
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "running", "seq": 30, "results": [], "items": [{"id": "s1", "state": "posted"}, {"id": "s2", "state": "needs_review", "reason": "1 exception"}, {"id": "s3", "state": "bogus"}]})
    it = {x["id"]: x for x in job.get("items") or []}
    ok(c == 200 and it["s1"]["state"] == "posted" and it["s2"]["state"] == "needs_review" and it["s3"]["state"] == "waiting", "CR3. item states posted and needs_review kept; an unknown one is still waiting (%s)" % {k: it[k]["state"] for k in it})
    # 4. an inferred voucher id is never stamped: lastVchId on an entry of a batch (batchN > 1) is the request's LASTVCHID, not the entry's
    job["status"] = "running"; job["checking"] = False; acc15.clear(); rep15.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "failed", "seq": 31,
                 "results": [{"id": "n1", "ok": False, "needsReview": True, "accepted": True, "lastVchId": "120", "batchEnd": "120", "batchN": 3, "created": 2, "exceptions": 1, "state": "unknown", "message": "CREATED 2 LASTVCHID 120 with 1 exception"}], "items": [{"id": "n1", "state": "needs_review"}]})
    ok(c == 200 and [strip(a) for a in acc15] == [{"p_job": "p-1", "p_id": "n1", "p_vch": ""}], "CR4. needsReview + accepted in a batch of 3 (LASTVCHID 120, no vchId): stamped with no voucher id, never the batch end (%s)" % acc15)
    job["status"] = "running"; job["checking"] = False; acc15.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "failed", "seq": 32,
                 "results": [{"id": "n2", "ok": False, "needsReview": True, "accepted": True, "lastVchId": "121", "vchId": "121", "batchN": 1, "created": 1, "exceptions": 1, "state": "unknown"}], "items": [{"id": "n2", "state": "needs_review"}]})
    ok([strip(a) for a in acc15] == [{"p_job": "p-1", "p_id": "n2", "p_vch": "121"}], "CR4. the same with batchN 1 and vchId: the exact id stamped (%s)" % acc15)
    NOREPLY["on"] = True; job["status"] = "running"; job["checking"] = False; acc15.clear(); rep15.clear()
    F.H.do_PATCH = patch15
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "done", "seq": 33, "results": [{"id": "n3", "ok": True, "byReply": True, "vchId": "", "lastVchId": "130", "batchEnd": "130", "batchN": 3}], "items": [{"id": "n3", "state": "posted"}]})
    F.H.do_PATCH = _patch15; NOREPLY["on"] = False
    ok(c == 200 and [strip(a) for a in acc15] == [{"p_job": "p-1", "p_id": "n3", "p_vch": ""}] and rep15 == [], "CR4. a byReply entry of a batch on a cloud without 43: the plain stamp carries no voucher id either (%s)" % acc15)
    # 5. an alreadySent refusal (this computer sent the entry before): accepted and kept locked, never released, never rewritten "being checked", the posting not held open
    job["status"] = "running"; job["checking"] = False; acc15.clear(); rep15.clear(); rel15.clear()
    AS = "already sent from this computer on 03-Oct-2026 10:02 (request of 3, LASTVCHID 26600); not sent again"
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "done", "seq": 34, "message": "Posted 0 of 2; 1 sent before",
                 "results": [{"id": "a1", "ok": False, "alreadySent": True, "refused": True, "lastVchId": "26600", "batchEnd": "26600", "batchN": 3, "state": "failed", "reason": AS, "message": AS},
                             {"id": "a2", "ok": False, "alreadySent": True, "refused": True, "vchId": "26601", "lastVchId": "26601", "batchN": 1, "state": "failed", "reason": AS}],
                 "items": [{"id": "a1", "state": "failed", "reason": AS}, {"id": "a2", "state": "failed", "reason": AS}]})
    rs = {x["id"]: x for x in job.get("results") or []}; it = {x["id"]: x for x in job.get("items") or []}
    ok(c == 200 and rs["a1"].get("alreadySent") is True and rs["a1"].get("refused") is True and rs["a1"].get("state") == "failed" and "being checked" not in rs["a1"].get("reason", "") and it["a1"]["state"] == "failed" and it["a1"]["reason"] == AS,
       "CR5. an alreadySent refusal is stored as it came (alreadySent, refused, failed), never rewritten as being checked (%s / %s)" % (rs["a1"].get("state"), it["a1"]["reason"][:40]))
    ok(sorted((a["p_id"], a["p_vch"]) for a in acc15) == [("a1", ""), ("a2", "26601")] and rep15 == [] and rel15 == [], "CR5. kept locked: tally_post_id_accept with the exact id only when batchN is 1, never a batch end; never released; not the reply stamp (%s %s %s)" % (acc15, rep15, rel15))
    ok(job["status"] == "done" and job.get("checking") is False and job["message"] == "Posted 0 of 2; 1 sent before", "CR5. the posting is not held open for it (%s, checking %s)" % (job["status"], job.get("checking")))
    job["status"] = "running"; job["checking"] = False; acc15.clear(); rel15.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "failed", "seq": 35, "results": [{"id": "a3", "ok": False, "alreadySent": True, "refused": True, "batchN": 3, "state": "failed", "reason": AS}], "items": [{"id": "a3", "state": "failed", "reason": AS}]})
    ok(c == 200 and [strip(a) for a in acc15] == [{"p_job": "p-1", "p_id": "a3", "p_vch": ""}] and rel15 == [] and job["items"][0]["state"] == "failed", "CR5. without any voucher id (the first send got no answer): still locked, not released (%s %s)" % (acc15, rel15))
    # 8. lineError arrives as an array of texts: kept as an array, at most 5 texts of at most 200 characters; a lone text becomes one
    job["status"] = "running"; job["checking"] = False; rel15.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "failed", "seq": 36,
                 "results": [{"id": "l1", "ok": False, "needsReview": True, "created": 0, "lineError": ["Ledger 'Freight' does not exist", "x" * 300, 7, None, "e4", "e5", "e6", "e7"], "message": "nothing created"}, {"id": "l2", "ok": False, "needsReview": True, "created": 0, "lineError": "one text"}, {"id": "l3", "ok": False, "needsReview": True, "created": 0, "lineError": 5}],
                 "items": [{"id": "l1", "state": "needs_review"}, {"id": "l2", "state": "needs_review"}, {"id": "l3", "state": "needs_review"}]})
    rs = {x["id"]: x for x in job.get("results") or []}
    ok(c == 200 and rs["l1"].get("lineError") == ["Ledger 'Freight' does not exist", "x" * 200, "e4", "e5", "e6"] and rs["l2"].get("lineError") == ["one text"] and rs["l3"].get("lineError") == [],
       "CR8. lineError: an array cleaned to at most 5 texts of 200 (strings only), a lone text wrapped, anything else [] (%s)" % json.dumps(rs["l1"].get("lineError"))[:80])
    ok(sorted(a["p_id"] for a in rel15) == ["l1", "l2", "l3"], "CR8. the needs-review entries without accepted are released as before (%s)" % [a["p_id"] for a in rel15])
    # 2 (cloud half): a 'failed' update that carries an entry sent with no answer from Tally (outcomeUnknown, or state sent)
    # is stored done (checking false): the posting never goes to 'failed' while an entry may be in Tally (the sync would free its id)
    job["status"] = "running"; job["checking"] = False; acc15.clear(); rel15.clear()
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "failed", "seq": 37, "message": "Posted 0 of 2; 1 need review; 1 sent with no answer from Tally",
                 "results": [{"id": "uf1", "ok": False, "outcomeUnknown": True, "sent": True, "state": "unknown", "batchN": 1, "message": "sent, no answer from Tally in 20 s"}, {"id": "uf2", "ok": False, "needsReview": True, "created": 0, "message": "refused"}],
                 "items": [{"id": "uf1", "state": "unknown", "reason": "no answer"}, {"id": "uf2", "state": "needs_review"}]})
    it = {x["id"]: x for x in job.get("items") or []}
    ok(c == 200 and job["status"] == "done" and job.get("checking") is False and job["message"].startswith("Posted 0 of 2") and it["uf1"]["state"] == "unknown" and [a["p_id"] for a in rel15] == ["uf2"] and acc15 == [],
       "CR2. failed + a no-answer entry: stored done (not failed), checking false, the message kept; the no-answer id neither stamped nor released, the refused one released (%s, %s)" % (job["status"], rel15))
    job["status"] = "running"; job["checking"] = False
    c, r = call({"kind": "posts_update", "version": "2.1.8", "bridge": dict(main, version="2.1.8"), "id": "p-1", "status": "failed", "seq": 38, "message": "1 refused", "results": [{"id": "uf3", "ok": False, "needsReview": True, "created": 0}], "items": [{"id": "uf3", "state": "needs_review"}]})
    ok(c == 200 and job["status"] == "failed", "CR2. a failed update without a no-answer entry is still stored failed (%s)" % job["status"])
    F.rpc = real7; job["results"] = []; job["items"] = []
    # F2 (a): posts_take hands the bridge the ids an owner released for the posting, so it sends them once and does not
    # mark them accepted from its memory
    F.T["tally_post_jobs"].append({"id": "p-2", "firm_id": FIRM, "device_id": "d-1", "company": "ZZ CO", "status": "waiting", "payload": {"vouchers": [{"id": "sid-3"}]}, "created_at": "2026-10-03T10:00:00Z"})
    F.T["tally_post_ids"] = [{"job_id": "p-2", "fincom_id": "h9f8e7", "entry_id": "sid-3", "accepted_at": "2026-10-03T04:23:00Z", "released_at": "2026-10-03T05:00:00Z", "released_by": "owner", "released_why": "not in the Day Book"},
                             {"job_id": "p-2", "fincom_id": "h2", "entry_id": "sid-4", "accepted_at": None, "released_at": "2026-10-03T05:00:00Z", "released_by": "bridge", "released_why": "refused"},
                             {"job_id": "p-2", "fincom_id": "h3", "entry_id": "sid-5", "accepted_at": "2026-10-03T06:00:00Z", "released_at": None, "released_by": "owner", "released_why": "cleared since"}]
    c, r = call({"kind": "posts_take", "version": "2.1.7", "bridge": main})
    ok(c == 200 and (r.get("job") or {}).get("id") == "p-2" and r["job"].get("released") == [{"id": "sid-3", "at": "2026-10-03T05:00:00Z", "by": "owner", "why": "not in the Day Book"}],
       "F2/R5. posts_take: the job carries released: [{id, at, by, why}] for the owner's releases still in force alone (%s)" % (r.get("job") or {}).get("released"))
    F.T["tally_post_ids"] = []; F.T["tally_post_jobs"][-1]["status"] = "cancelled"
    F.rpc = real7
    # S4: the cloud says stamped 0 (the id in tally_post_ids spelt otherwise): said in the log, so it is seen
    def rpc36z(fn, a):
        if fn == "tally_post_id_accept": acc.append(a); return {"ok": True, "stamped": 0}
        return real_rpc36(fn, a)
    F.rpc = rpc36z; job["status"] = "running"; n0 = len(log)
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v-2.x", "ok": False, "vchNumber": "9"}], "items": [{"id": "v-2.x", "state": "failed"}]})
    time.sleep(0.5)
    ok(c == 200 and any("stamped 0" in l and "v2x" in l for l in log[n0:]), "S4. tally_post_id_accept answering stamped 0 is logged with the id (%s)" % [l.strip() for l in log[n0:]][:3])
    F.rpc = rpc36
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "message": "refused", "results": [{"id": "v2", "ok": False, "message": "CREATED 0 ALTERED 0 ERRORS 1"}], "items": [{"id": "v2", "state": "failed", "reason": "refused"}]})
    ok(c == 200 and job["status"] == "failed" and job.get("checking") is False, "no acceptance (CREATED 0 is not one): failed is stored as before")
    acc.clear()
    for k in ("vchNumber", "masterId", "guid"):
        job["status"] = "running"
        c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v2", "ok": False, k: "77", "message": "x"}], "items": [{"id": "v2", "state": "failed"}]})
        ok(job["status"] == "done" and job.get("checking") is True and job["items"][0]["state"] == "unknown", "a %s in a result is an acceptance too" % k)
    ok(len(acc) == 3 and acc[0]["p_vch"] == "77" and acc[2]["p_vch"] == "", "each stamped the id (the voucher when there is one)")
    job["status"] = "running"
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "items": [{"id": "v2", "state": "failed", "reason": "CREATED 1 ALTERED 0; LASTVCHID 26300; then the read-back timed out"}]})
    ok(job["status"] == "done" and job.get("checking") is True and job["items"][0]["state"] == "unknown" and len(acc) == 4 and acc[3]["p_vch"] == "26300", "an acceptance in an item's reason (no result) counts too")
    F.rpc = real_rpc36
    # migration 37 (item 7): an entry the bridge reports failed (or not found) releases its id through tally_post_id_release
    # (job, id, why), once per entry — never an unknown one, and never one Tally accepted (forced to unknown first)
    rel = []; real_rpc37 = F.rpc
    def rpc37(fn, a):
        if fn == "tally_post_id_release": rel.append(a); return {"ok": True, "released": True}
        return real_rpc37(fn, a)
    F.rpc = rpc37
    job["status"] = "running"
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "message": "2 failed",
                 "results": [{"id": "v1", "ok": False, "message": "CREATED 1 LASTVCHID 26298; read-back failed"}, {"id": "v2", "ok": False, "message": "Tally refused it: ledger missing"}, {"id": "v3", "ok": False, "outcomeUnknown": True}],
                 "items": [{"id": "v1", "state": "failed", "reason": "read-back failed"}, {"id": "v2", "state": "failed", "reason": "ledger missing"}, {"id": "v3", "state": "unknown", "reason": "Tally stopped answering"}, {"id": "v4", "state": "notfound", "reason": "not in Tally after the check"}]})
    it = {x["id"]: x for x in job.get("items") or []}
    ok(c == 200 and it["v1"]["state"] == "unknown" and it["v4"]["state"] == "notfound", "items: v1 (Tally accepted) unknown; notfound is a state the cloud keeps (%s)" % it.get("v4"))
    ok(rel == [{"p_job": "p-1", "p_id": "v2", "p_why": "ledger missing"}, {"p_job": "p-1", "p_id": "v4", "p_why": "not in Tally after the check"}], "tally_post_id_release called once each for the failed and the not-found entry with the reason; never for the accepted or the unknown one (%s)" % rel)
    F.rpc = real_rpc37
    job["status"] = "cancelled"
    # migration 37 (item 14): a day's vouchers carry fid, the FinCom id from the full narration (parse.js), for tally_ingest_day
    import gzip
    vx = lambda g, narr: "<TALLYMESSAGE><VOUCHER REMOTEID=\"%s\" VCHTYPE=\"Payment\"><DATE>20260302</DATE><GUID>%s</GUID><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER><PARTYLEDGERNAME>Rent</PARTYLEDGERNAME><NARRATION>%s</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>" % (g, g, narr)
    xml = vx("g-fid-1", "Rent for March | TDSDesk:emu.qtw-0683g") + vx("g-fid-2", "Rent, no tag")
    c, r = call({"kind": "days", "version": "2.1.5", "bridge": main, "company": "ZZ CO", "days": [{"day": "20260302", "gz": base64.b64encode(gzip.compress(xml.encode()).decode() if False else gzip.compress(xml.encode())).decode()}]})
    ing = (F.ARGS.get("tally_ingest_day") or [{}])[-1]; vs = {v.get("guid"): v for v in (ing.get("p_vouchers") or [])}
    ok(c == 200 and vs.get("g-fid-1", {}).get("fid") == "emu.qtw-0683g" and "fid" in vs.get("g-fid-2", {}) and vs["g-fid-2"]["fid"] is None, "a day's vouchers carry fid: the TDSDesk tag from the narration, null without one (%s %s %s %s)" % (c, {g: v.get("fid") for g, v in vs.items()}, r, sorted(F.ARGS)))
    # round 10 (migration 39): a day the bridge positively read as empty (empty: true) goes with p_empty; a plain day without it
    n_ing = len(F.ARGS.get("tally_ingest_day") or [])
    c, r = call({"kind": "days", "version": "2.1.8", "bridge": main, "company": "ZZ CO", "days": [{"day": "20260303", "gz": base64.b64encode(gzip.compress(b"<ENVELOPE><BODY></BODY></ENVELOPE>")).decode(), "empty": True},
                                                                                          {"day": "20260304", "gz": base64.b64encode(gzip.compress(xml.replace("20260302", "20260304").encode())).decode()}]})
    ings = (F.ARGS.get("tally_ingest_day") or [])[n_ing:]
    ok(c == 200 and len(ings) == 2 and ings[0].get("p_empty") is True and ings[0].get("p_n") == 0 and "p_empty" not in ings[1] and ings[1].get("p_n") == 2,
       "39. an empty day with the bridge's flag: tally_ingest_day(…, p_empty: true); a day with entries: the 7-argument call (%s)" % [{k: a.get(k) for k in ("p_day", "p_n", "p_empty")} for a in ings])
    # round 11s (M3): the short-read guard works against the bridge's OWN count of the day (n): a day the bridge counted 3 whose
    # file parses 2 goes with p_n = 3 (the cloud then refuses: 'short read: 2 of 3', nothing marked); no count: the parsed one
    n_ing = len(F.ARGS.get("tally_ingest_day") or []); n_log = len(log)
    c, r = call({"kind": "days", "version": "2.1.8", "bridge": main, "company": "ZZ CO", "days": [{"day": "20260305", "n": 3, "gz": base64.b64encode(gzip.compress(xml.replace("20260302", "20260305").encode())).decode()},
                                                                                          {"day": "20260306", "gz": base64.b64encode(gzip.compress(xml.replace("20260302", "20260306").encode())).decode()},
                                                                                          {"day": "20260307", "n": "nonsense", "gz": base64.b64encode(gzip.compress(xml.replace("20260302", "20260307").encode())).decode()}]})
    ings = (F.ARGS.get("tally_ingest_day") or [])[n_ing:]; time.sleep(0.3)
    ok(c == 200 and [a.get("p_n") for a in ings] == [3, 2, 2] and len(ings[0].get("p_vouchers") or []) == 2, "M3. p_n = the bridge's count when sent (3 for a file of 2), else the parsed count (%s)" % [a.get("p_n") for a in ings])
    ok(any("parsed 2 of the bridge's 3" in l for l in log[n_log:]), "M3. the short read is logged (parsed 2 of the bridge's 3)")
    # 9 (code review): the fall-back to the 7-argument call only when the 8-argument function is missing, never on another error
    real9 = F.rpc; errs9 = {"text": ""}
    def rpc9(fn, a):
        if fn == "tally_ingest_day" and "p_empty" in a and errs9["text"]: F.ARGS.setdefault(fn, []).append(a); raise RuntimeError(errs9["text"])
        return real9(fn, a)
    F.rpc = rpc9
    errs9["text"] = "Could not find the function public.tally_ingest_day(p_alter, p_book, p_bytes, p_day, p_empty, p_lines, p_n, p_vouchers) in the schema cache"
    n_ing = len(F.ARGS.get("tally_ingest_day") or [])
    c, r = call({"kind": "days", "version": "2.1.8", "bridge": main, "company": "ZZ CO", "days": [{"day": "20260308", "gz": base64.b64encode(gzip.compress(b"<ENVELOPE><BODY></BODY></ENVELOPE>")).decode(), "empty": True}]})
    ings = (F.ARGS.get("tally_ingest_day") or [])[n_ing:]
    ok(c == 200 and len(ings) == 2 and "p_empty" in ings[0] and "p_empty" not in ings[1], "9. no 8-argument function on the cloud: the 7-argument call follows (%d calls)" % len(ings))
    errs9["text"] = "relation \"tally_days\" does not exist"
    n_ing = len(F.ARGS.get("tally_ingest_day") or [])
    c, r = call({"kind": "days", "version": "2.1.8", "bridge": main, "company": "ZZ CO", "days": [{"day": "20260309", "gz": base64.b64encode(gzip.compress(b"<ENVELOPE><BODY></BODY></ENVELOPE>")).decode(), "empty": True}]})
    ings = (F.ARGS.get("tally_ingest_day") or [])[n_ing:]
    ok(c != 200 and len(ings) == 1, "9. any other error of the 8-argument call is not papered over by a 7-argument retry (%s)" % c)
    F.rpc = real9
    dev["main_bridge"] = "go-aaaaaaaaaaaa"
    # install logs
    import zipfile, io
    zb = io.BytesIO(); zipfile.ZipFile(zb, "w").writestr("install.log", "2026-10-02 10:00:00  Install: test"); zb = base64.b64encode(zb.getvalue()).decode()
    c, r = call({"kind": "support", "shadow": True, "version": "2.1.0", "bridge": GO, "zip": zb, "note": "install log"})
    ok(c == 200 and any(k.startswith("tally-support/%s/d-1/" % FIRM) for k in F.FILES), "Send install log to FinCom from a bridge in test mode: kept (%s)" % r.get("path"))
    c, r = web({"kind": "install_log", "name": "install.log", "text": "2026-10-02 10:00:00  Install: the folder could not be written"})
    ok(c == 200 and any(k.startswith("tally-support/%s/web/" % FIRM) and k.endswith("-install.log") for k in F.FILES), "an install log dropped on the Tally page: kept (%s)" % r.get("path"))
    c, r = web({"kind": "install_log", "text": " "})
    ok(c == 413, "an empty one is refused")

    # migration-34 (02-Oct-2026, round 3): the bridge's ledger_list carries round, complete, rowsRead and seen (the GUIDs it
    # read, split over the batches); tally-ingest records each batch with its seen (tally_ledger_round_batch), renames
    # through tally_ledger_rename, and on the last batch calls tally_ledgers_mark_gone(book, round) once: the cloud marks
    # by what the round saw. A 'deleted' list is ignored for marking (counted deletedIgnored). Without migration-34 it
    # marks nothing and says so. At most 60 ledger_list calls a minute from one computer
    # migration-36 (03-Oct-2026, round 4 item 6): the batch is recorded first (counts), the rows upserted, and only THEN
    # the GUIDs seen are stamped (tally_ledger_round_seen) - so a first round on a copy whose rows had no GUID yet stamps
    # every row and tally_ledgers_mark_gone (last batch) finds nothing unseen. SEQ: each RPC with its place among the calls
    NO34 = {"on": False}; NO36 = {"on": False}; real_rpc = F.rpc; SEQ = []
    def rpc34(fn, a):
        if fn in ("tally_ledger_round_batch", "tally_ledgers_mark_gone", "tally_ledger_rename", "tally_ledger_round_seen"):
            F.ARGS.setdefault(fn, []).append(a); SEQ.append((fn, len(F.CALLS) - 1))
            if NO34["on"] or (NO36["on"] and fn == "tally_ledger_round_seen"): raise RuntimeError("Could not find the function public.%s(...) in the schema cache" % fn)
            if fn == "tally_ledger_round_batch": return {"ok": True, "round": a["p_round"], "batches": 1, "rows": a["p_rows"], "seen": len(a.get("p_seen") or [])}
            if fn == "tally_ledger_round_seen": return {"ok": True, "stamped": len(a.get("p_seen") or [])}
            if fn == "tally_ledgers_mark_gone": return {"ok": True, "marked": 2, "held": 1, "gone": 3, "note": "1 kept by the guard (entries or an opening)"}
            return {"ok": True, "renamed": True, "from": a["p_from"], "to": a["p_to"]}
        return real_rpc(fn, a)
    F.rpc = rpc34
    patched = lambda: [c for c in F.CALLS if c[0] == "PATCH" and c[1].endswith("/tally_ledgers")]
    row = lambda g, n: [g, 1, 1, n, "Sundry Debtors", "0", "", "", 0]
    n0 = len(patched()); sent = {"ok": 0}
    def lst(body):
        c, r = call(dict({"kind": "ledger_list", "version": "2.1.5", "bridge": main, "company": "ZZ CO"}, **body))
        if c == 200: sent["ok"] += 1
        return c, r
    c, r = lst({"round": "r-1", "complete": False, "rowsRead": None, "last": False, "seen": ["g1", "g2", " g9 "],
                "ledgers": [row("g1", "Alpha"), row("g2", "Beta")], "renamed": [["g2", "Old Beta", "Beta"]], "groups": [["Sundry Debtors", "Current Assets"]]})
    a = (F.ARGS.get("tally_ledger_round_batch") or [{}])[-1]
    ok(c == 200 and r.get("ok") and a == {"p_book": BOOK, "p_round": "r-1", "p_rows": 2, "p_rows_read": None, "p_complete": False, "p_device": "d-1", "p_bridge": GO["id"], "p_seen": ["g1", "g2", "g9"]},
       "a ledger_list batch is recorded on its round with the GUIDs it saw: book, round, rows, rowsRead, complete, computer, bridge, seen (%s %s)" % (c, a))
    a = (F.ARGS.get("tally_ledger_rename") or [{}])[-1]
    ok(a == {"p_book": BOOK, "p_guid": "g2", "p_from": "Old Beta", "p_to": "Beta"} and r.get("renamed") == 1, "a rename goes through tally_ledger_rename (%s)" % a)
    ok("tally_ledgers_mark_gone" not in F.ARGS and r.get("deleted") == 0, "not the last batch: tally_ledgers_mark_gone not called")
    a = (F.ARGS.get("tally_ledger_round_seen") or [{}])[-1]
    ok(a == {"p_book": BOOK, "p_round": "r-1", "p_seen": ["g1", "g2", "g9"]}, "the GUIDs seen are stamped through tally_ledger_round_seen with the same seen array (%s)" % a)
    at = lambda fn: [i for f, i in SEQ if f == fn]
    ups = [i for i, c in enumerate(F.CALLS) if c == ("POST", "/rest/v1/tally_ledgers")]
    ok(at("tally_ledger_round_batch") and ups and at("tally_ledger_round_seen") and at("tally_ledger_round_batch")[0] < ups[0] and ups[-1] < at("tally_ledger_round_seen")[0],
       "the order: round_batch (counts) -> the rows upserted -> round_seen (the stamp AFTER the upsert) (batch %s, upserts %s, seen %s)" % (at("tally_ledger_round_batch"), ups, at("tally_ledger_round_seen")))
    c, r = lst({"round": "r-1", "complete": True, "rowsRead": 3, "last": True, "seen": ["g3"], "ledgers": [], "deleted": [["g7", "Gone One"], ["g8", "Gone Two"]]})
    a = (F.ARGS.get("tally_ledger_round_batch") or [{}])[-1]
    ok(c == 200 and a.get("p_round") == "r-1" and a.get("p_complete") is True and a.get("p_rows_read") == 3 and a.get("p_rows") == 0 and a.get("p_seen") == ["g3"], "the last batch: complete, rowsRead and its seen recorded (%s)" % a)
    a = F.ARGS.get("tally_ledgers_mark_gone") or []
    # round 9: the calls have the shapes the rewritten migration 36 defines (staging's first 34 had a 7-argument batch and a
    # 3-argument mark_gone): batch with 8 named arguments (p_seen), mark_gone with exactly (p_book, p_round), round_seen (book, round, seen)
    ok(a and set(a[-1]) == {"p_book", "p_round"} and set(F.ARGS["tally_ledger_round_batch"][-1]) == {"p_book", "p_round", "p_rows", "p_rows_read", "p_complete", "p_device", "p_bridge", "p_seen"} and set(F.ARGS["tally_ledger_round_seen"][-1]) == {"p_book", "p_round", "p_seen"},
       "round 9: tally_ledgers_mark_gone(book, round), tally_ledger_round_batch with p_seen (8), tally_ledger_round_seen(book, round, seen): the arguments migration 36 defines")
    ok(len(a) == 1 and a[0] == {"p_book": BOOK, "p_round": "r-1"} and r.get("deleted") == 2 and r.get("deletesHeld") == 1 and any("guard" in n for n in r.get("notes", [])),
       "on the last batch tally_ledgers_mark_gone(book, round) is called once; its marked / held / note answered (%s %s)" % (a, {k: r.get(k) for k in ("deleted", "deletesHeld", "notes")}))
    ok(r.get("deletedIgnored") == 2 and any("ignored" in n for n in r.get("notes", [])), "the bridge's deleted list is ignored for marking and said (%s)" % r.get("notes"))
    ok(len(patched()) == n0, "tally_ledgers never updated directly (no PATCH) on the migration-34 path")
    ok(at("tally_ledger_round_seen")[-1] < at("tally_ledgers_mark_gone")[-1] and (F.ARGS["tally_ledger_round_seen"][-1]["p_seen"] == ["g3"]), "on the last batch: its seen stamped (after the upsert) before tally_ledgers_mark_gone")
    NO36["on"] = True
    c, r = lst({"round": "r-1b", "complete": True, "rowsRead": 3, "last": True, "seen": ["g3"], "ledgers": [row("g3", "Gamma")]})
    ok(c == 200 and r.get("ok") and any("migration-36" in n for n in r.get("notes", [])) and len(F.ARGS["tally_ledgers_mark_gone"]) == 2, "a cloud with 34 but without 36: the batch still goes through (34's batch stamps as before), 'migration-36 not applied' said (%s)" % r.get("notes"))
    NO36["on"] = False
    n_seen = len(F.ARGS["tally_ledger_round_seen"])
    c, r = call({"kind": "ledger_list", "version": "2.1.4", "bridge": main, "company": "ZZ CO", "last": True, "ledgers": [row("g1", "Alpha")], "deleted": [["g7", "Gone One"]]})
    sent["ok"] += c == 200
    ok(c == 200 and r.get("deleted") == 0 and r.get("deletedIgnored") == 1 and any("round" in n for n in r.get("notes", [])) and len(F.ARGS["tally_ledgers_mark_gone"]) == 2 and len(F.ARGS["tally_ledger_round_batch"]) == 3 and len(F.ARGS["tally_ledger_round_seen"]) == n_seen,
       "a bridge sending no round (2.1.4): no round recorded, nothing stamped, nothing marked and said (%s)" % r.get("notes"))
    NO34["on"] = True
    c, r = lst({"round": "r-2", "complete": True, "rowsRead": 1, "last": True, "seen": ["g1"], "ledgers": [row("g1", "Alpha")], "deleted": [["g7", "Gone One"], ["g8", "Gone Two"]]})
    ok(c == 200 and r.get("ok") and r.get("deleted") == 0 and r.get("deletedIgnored") == 2 and any("migration-34" in n for n in r.get("notes", [])) and len(patched()) == n0 and len(F.ARGS["tally_ledgers_mark_gone"]) == 2,
       "a cloud without migration-34: nothing marked, nothing updated directly, 'migration-34 not applied' said (%s)" % r.get("notes"))
    ok(len(F.ARGS["tally_ledger_round_seen"]) == n_seen, "and tally_ledger_round_seen not asked of it")
    NO34["on"] = False
    # round 11 (migration 40): the bridge's 10th column is the ledger's state (LEDSTATENAME): stored when sent, left as it is when absent or empty
    c, r = lst({"round": "r-2s", "complete": False, "last": False, "seen": ["g1", "g2", "g9"], "ledgers": [row("g1", "Alpha") + ["Uttar Pradesh"], row("g2", "Beta"), row("g9", "Iota") + [""]]})
    led = {x["name"]: x for x in F.T["tally_ledgers"] if x.get("book_id") == BOOK}
    ok(c == 200 and led.get("Alpha", {}).get("state") == "Uttar Pradesh" and "state" not in led.get("Iota", {}) and led.get("Beta", {}).get("state") in (None, ""), "40. a row with a state: stored (Alpha: Uttar Pradesh); without one, or empty: left as it is (%s)" % {k: led.get(k, {}).get("state") for k in ("Alpha", "Beta", "Iota")})
    c, r = lst({"round": "r-2s", "complete": False, "last": False, "seen": ["g1"], "ledgers": [row("g1", "Alpha")]})
    led = {x["name"]: x for x in F.T["tally_ledgers"] if x.get("book_id") == BOOK}
    ok(c == 200 and led["Alpha"].get("state") == "Uttar Pradesh", "40. the same row sent again without a state: the state kept")
    # at most 60 ledger_list calls a minute from one computer (a rogue key cannot bloat the rounds)
    codes = [lst({"round": "r-3", "complete": False, "last": False, "seen": [], "ledgers": []})[0] for i in range(70)]
    c, r = lst({"round": "r-3", "complete": False, "last": False, "seen": [], "ledgers": []})
    ok(429 in codes and sent["ok"] == 60 and c == 429 and r.get("ok") is False and "minute" in str(r.get("error")), "the 61st ledger_list in a minute from one computer: 429 with a plain message (%s; %d accepted)" % (r.get("error"), sent["ok"]))
    c, r = call({"kind": "beat", "version": "2.1.0", "bridge": main, "tally": True})
    ok(c == 200, "the computer's other calls are not held up by it")
finally:
    fn.kill()
    if fails: print("".join(log[-30:]))
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
