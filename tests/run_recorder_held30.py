"""python3 run_recorder_held30.py - FinCom Bridge 2.3.4 (the owner, 08-Oct-2026: "30-day window for lines ended by the
slow-company rule: YES"). tally-ingest's beat answers heldLines / refetch: a held line received 7 to 30 days ago is listed
too when the slow-company rule ended it (its own held words, or those of its only ":resolved" row held without a body, are
the bridge's slow words: "FinCom does not ask Tally for this company's entries ..." (the company marked) or "Tally did not
answer in time for this entry when asked again ..." (its one ask timed out)); after the last 7 days' lines. Not listed: any
other held line older than 7 days (its words not the slow rule's, e.g. "Tally did not give this entry when asked again"); a
slow-ended line older than 30 days; one whose ":resolved" came twice (asked once more already) or came with a body; another
bridge's. The last 7 days are as before. Through the real cloud function (server/tally-cloud/index.ts) under Deno against
the stand-in for Supabase (fake_supabase.py); no database change (no migration).
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno). RED before the change: S1-S3 not listed. Review M1 (08-Oct-2026): listed only to a bridge of 2.3.4 or later (the beat's
version); an older bridge gets its last 7 days' lines only."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, DA = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111", "d1000000-0000-0000-0000-000000000001"
KA = "fcd_" + "a" * 48
GA = {"id": "go-aaaaaa111111", "computer": "NWS144", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.3.4"}
GO = {"id": "go-cccccc333333", "computer": "NWS144", "user": "other", "mode": "main", "runMode": "user", "version": "2.3.4"}
SLOW = "FinCom does not ask Tally for this company's entries: finding one entry took Tally longer than 2 s. Upload that day's Day Book to settle it."
TIMED = "Tally did not answer in time for this entry when asked again; upload that day's Day Book to settle it"
ONCE = "Tally did not give this entry when asked again; upload that day's Day Book to settle it"
WAIT = "waiting: Tally took longer than 2 s; FinCom asks again at 10:42"
def ago(days): return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - days * 86400))
n = [0]
def row(lid, days, why, bridge=GA["id"], state="held", body=None, mid="25689"):
    n[0] += 1
    return {"id": n[0], "line_id": lid, "company": "GARG SHEKHAR & COMPANY", "company_guid": "cg-1", "event": "created", "master_id": mid, "alter_id": None,
            "vch_type": "Journal", "vch_no": "", "vch_date": "2026-10-06", "book_id": BOOK, "firm_id": FIRM, "device_id": DA, "bridge": bridge, "state": state,
            "held_why": why, "object_guid": None, "body": body, "payload": None, "received_at": ago(days)}
FULL = {"vouchers": [{"guid": "cg-1-00006461"}]}
FS.T["tally_companies"].append({"firm_id": FIRM, "company": "GARG SHEKHAR & COMPANY", "client_id": "c1", "book_id": BOOK})
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "NWS144", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.3.4"})
FS.T["tally_recorder_lines"] = [
    # S1: 2.3.3 ended it by the company mark: the line itself sent held with the slow words (no ":resolved"), 10 days ago
    row("S1", 10, SLOW, mid="25690"),
    # S2: its one ask timed out: the line held (waiting words), its ":resolved" held with the timed-out words, no body
    row("S2", 12, WAIT, mid="25691"), row("S2:resolved", 11, TIMED, mid="25691"),
    # S3: the company marked after the line went: its ":resolved" with the slow words, 29 days ago
    row("S3", 29, WAIT, mid="25692"), row("S3:resolved", 28, SLOW, mid="25692"),
    # not listed: Tally answered without the entry (not the slow rule), 10 days ago
    row("N1", 10, WAIT, mid="25693"), row("N1:resolved", 9, ONCE, mid="25693"),
    # not listed: slow-ended, 31 days ago
    row("N2", 31, SLOW, mid="25694"),
    # not listed: asked once more already (a second ":resolved", held again)
    row("N3", 10, WAIT, mid="25695"), row("N3:resolved", 9, SLOW, mid="25695"), row("N3:resolved", 2, TIMED, mid="25695"),
    # not listed: its ":resolved" came with a body (resolved; the line waits for the drain)
    row("N4", 10, SLOW, mid="25696"), row("N4:resolved", 3, "", state="applied", body=FULL, mid="25696"),
    # not listed: another bridge's
    row("N5", 10, SLOW, bridge=GO["id"], mid="25697"),
    # not listed: older than 7 days with other words (no slow rule)
    row("N6", 8, WAIT, mid="25698"),
    # R1: the last 7 days, as before (any held words)
    row("R1", 2, WAIT, mid="25699"),
]
FS.T["tally_month_locks"] = []
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    def call(body, key=KA):
        rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    c, r = call({"kind": "beat", "version": "2.3.4", "bridge": GA, "tally": True, "open": []})
    hl = [x.get("line_id") for x in (r.get("heldLines") or [])]
    rf = [x.get("line_id") for x in (r.get("refetch") or [])]
    ok(c == 200, "the beat answered (%s)" % c)
    ok({"S1", "S2", "S3"} <= set(hl), "heldLines: the slow-ended lines of 7 to 30 days ago (S1 its own slow words; S2 its :resolved timed out; S3 29 days, its :resolved with the slow words) (%s)" % hl)
    ok(not {"N1", "N2", "N3", "N4", "N5", "N6"} & set(hl), "heldLines: not another rule's words (N1), not older than 30 days (N2), not asked once more already (N3), not resolved (N4), not another bridge's (N5), not older than 7 days without the slow rule (N6) (%s)" % hl)
    ok("R1" in hl and hl.index("R1") < min(hl.index(x) for x in ("S1", "S2", "S3") if x in hl), "heldLines: the last 7 days' line (R1) as before, listed before the older ones (%s)" % hl)
    ok({"S1", "S2", "S3"} <= set(rf) and not {"N1", "N2", "N3", "N4", "N5", "N6"} & set(rf), "refetch: the same slow-ended lines (no body), the same exclusions (%s)" % rf)
    s3 = next((x for x in r.get("heldLines") or [] if x.get("line_id") == "S3"), {})
    ok(set(s3) == {"line_id", "company", "company_guid", "event", "master_id", "vch_type", "vch_no", "vch_date"} and s3.get("master_id") == "25692" and s3.get("vch_date") == "20261006",
       "each row: the same fields as before, nothing added (%s)" % s3)
    # review M1: a bridge before 2.3.4 (no fast request; it would ask such a line the slow way, or end it again at once): the
    # 7-30-day lines are not listed to it; its last 7 days' lines are, as before. Read again with 2.3.4
    for ver in ("2.3.3", "2.2.2", ""):
        g = dict(GA, version=ver)
        c, r = call({"kind": "beat", "version": ver, "bridge": g, "tally": True, "open": []})
        h3 = [x.get("line_id") for x in (r.get("heldLines") or [])]
        f3 = [x.get("line_id") for x in (r.get("refetch") or [])]
        ok(c == 200 and "R1" in h3 and not {"S1", "S2", "S3"} & set(h3 + f3), "bridge %r: only its last 7 days' lines (%s / %s)" % (ver, h3, f3))
    for ver in ("2.3.4", "2.3.10", "2.4.0", "3.0.0"):
        g = dict(GA, version=ver)
        c, r = call({"kind": "beat", "version": ver, "bridge": g, "tally": True, "open": []})
        h3 = [x.get("line_id") for x in (r.get("heldLines") or [])]
        ok(c == 200 and {"S1", "S2", "S3"} <= set(h3), "bridge %r: the slow-ended lines of 7 to 30 days listed (%s)" % (ver, h3))
    c, r = call({"kind": "beat", "version": "2.3.4", "bridge": GO, "tally": True, "open": []})
    ok([x.get("line_id") for x in (r.get("heldLines") or [])] == ["N5"], "the other bridge gets its own slow-ended line only (%s)" % [x.get("line_id") for x in (r.get("heldLines") or [])])
finally:
    fn.terminate()
    if fails: print("".join(log[-40:]))
print("%d failed" % len(fails) if fails else "all ok")
sys.exit(1 if fails else 0)
