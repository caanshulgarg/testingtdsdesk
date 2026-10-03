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
    for i in range(60):
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
    c, r = call({"kind": "posts_take", "version": "2.1.0", "bridge": main})
    ok(c == 200, "and may take it (%s)" % c)
    # the bridge's menu: Switch to main bridge (a second Go install takes over)
    dev["main_bridge"] = None
    other = dict(GO, id="go-aaaaaaaaaaaa", user="tally2")
    c, r = call({"kind": "make_main", "shadow": True, "version": "2.1.0", "bridge": other})
    ok(c == 200 and dev.get("main_bridge") == "go-aaaaaaaaaaaa", "Switch to main bridge from a bridge's menu records it as the main one")
    c, r = call({"kind": "make_main", "version": "1.15.0"})
    ok(c == 400 and dev.get("main_bridge") == "go-aaaaaaaaaaaa", "1.15.0 cannot make itself the main bridge")
    c, r = call({"kind": "beat", "version": "2.1.0", "bridge": main, "tally": True})
    ok(r.get("notMain") is True and r.get("posts") == 0, "and the first 2.1.0 is then told it is not the main one")
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
    ok(c == 200 and job["status"] == "running" and job.get("checking") is True and job.get("message", "").startswith("Posted, not yet confirmed:"), "an entry Tally accepted: the posting is stored running with checking, never failed; 'Posted, not yet confirmed: …' (%s, %s)" % (job["status"], job.get("message")))
    ok(it.get("v1", {}).get("state") == "unknown" and rs.get("v1", {}).get("outcomeUnknown") is True and rs["v1"].get("state") == "unknown" and rs["v1"].get("ok") is False, "the accepted entry is unknown (checking), not failed (%s)" % it.get("v1"))
    ok(it.get("v2", {}).get("state") == "failed" and rs.get("v2", {}).get("state") != "unknown", "the entry Tally refused stays failed")
    ok(acc == [{"p_job": "p-1", "p_id": "v1", "p_vch": "26298"}], "tally_post_id_accept(job, id, voucher) called for v1 alone, with the voucher from Tally's words (%s)" % acc)
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v1", "ok": True, "verified": True, "vchNumber": "26298"}, {"id": "v2", "ok": False, "message": "refused"}],
                 "items": [{"id": "v1", "state": "in_tally"}, {"id": "v2", "state": "failed", "reason": "refused"}]})
    it = {x["id"]: x for x in job.get("items") or []}
    ok(c == 200 and job["status"] == "running" and it["v1"]["state"] == "in_tally", "verified in Tally: in_tally kept; the posting still never stored failed while an accepted entry is in it")
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "message": "refused", "results": [{"id": "v2", "ok": False, "message": "CREATED 0 ALTERED 0 ERRORS 1"}], "items": [{"id": "v2", "state": "failed", "reason": "refused"}]})
    ok(c == 200 and job["status"] == "failed" and job.get("checking") is False, "no acceptance (CREATED 0 is not one): failed is stored as before")
    acc.clear()
    for k in ("vchNumber", "masterId", "guid"):
        job["status"] = "running"
        c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "results": [{"id": "v2", "ok": False, k: "77", "message": "x"}], "items": [{"id": "v2", "state": "failed"}]})
        ok(job["status"] == "running" and job["items"][0]["state"] == "unknown", "a %s in a result is an acceptance too" % k)
    ok(len(acc) == 3 and acc[0]["p_vch"] == "77" and acc[2]["p_vch"] == "", "each stamped the id (the voucher when there is one)")
    job["status"] = "running"
    c, r = call({"kind": "posts_update", "version": "2.1.5", "bridge": main, "id": "p-1", "status": "failed", "items": [{"id": "v2", "state": "failed", "reason": "CREATED 1 ALTERED 0; LASTVCHID 26300; then the read-back timed out"}]})
    ok(job["status"] == "running" and job["items"][0]["state"] == "unknown" and len(acc) == 4 and acc[3]["p_vch"] == "26300", "an acceptance in an item's reason (no result) counts too")
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
