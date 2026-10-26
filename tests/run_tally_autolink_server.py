"""python3 run_tally_autolink_server.py - (23-Oct-2026, next-fix-tally-link) tally-ingest links a reported Tally company to a
client by itself only when it is certain (server/_shared/tallyname.js autoLinkFor): the same GSTIN, or the client's NAME
equal once the period ("(2024-25)", "- (from 1-Apr-25)") and Pvt Ltd / LLP / & / case are taken off; and that client is
not linked to another company. A client's typed Tally name alone links nothing: on staging (23-Oct, 09:35:21 UTC) the
bridge's "companies" report linked VMS EVENTS PRIVATE LIMITED (2024-25) to a new client "Salesify Marketing LLP" whose
Tally name the Add client form had left as VMS EVENTS (linked_by empty: this path).
The real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py).
Needs Deno (DENO, default: the deno on the PATH)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "f-1"; KEY = "fcd_" + "c" * 48
VMS, SAL = "VMS EVENTS PRIVATE LIMITED (2024-25)", "SALESIFY MARKETING LLP - (from 1-Apr-25)"
S1 = {"id": "cmvkrssmhbi53l", "firm_id": FIRM, "name": "Salesify Marketing LLP", "tally_name": VMS, "gstin": "", "deleted": False}
S2 = {"id": "cmvkrtpqqr6z9j", "firm_id": FIRM, "name": "Salesify Marketing LLP", "tally_name": "Salesify Marketing LLP", "gstin": "06AEVFS5010H1ZV", "deleted": False}
GS = {"id": "cmupe4m7upncpy", "firm_id": FIRM, "name": "Garg Shekhar & Company", "tally_name": "Garg Shekhar & Company", "gstin": "09AANFG3202D1ZR", "deleted": False}
AL = {"id": "c-alpha", "firm_id": FIRM, "name": "Alpha Traders LLP", "tally_name": "ALPHA TRADERS LLP (2024-25)", "gstin": "", "deleted": False}
F.T["clients"].extend([S1, S2, GS, AL])
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ALPHA TRADERS LLP (2024-25)", "client_id": "c-alpha", "book_id": "b-al", "last_seen": "2026-10-01T00:00:00Z", "linked_at": "2026-10-01T00:00:00Z"})
# unlinked by a person once: never linked by itself again
F.T["tally_companies"].append({"firm_id": FIRM, "company": "GARG SHEKHAR & CO OLD", "client_id": None, "gstin": "09AANFG3202D1ZR", "last_seen": "2026-10-01T00:00:00Z", "linked_at": "2026-10-02T00:00:00Z"})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "NWS144", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64,
                             "version": "2.4.1", "want_update_at": None, "want_sent_at": None})
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    body = dict(body, version="2.4.1")
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
row = lambda name: next((c for c in F.T["tally_companies"] if c["firm_id"] == FIRM and c["company"] == name), {})
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    # 1. the 23-Oct report: VMS EVENTS open; the first Salesify's Tally name is VMS EVENTS
    c, r = call({"kind": "companies", "companies": [{"name": VMS, "gstin": ""}, {"name": SAL, "gstin": ""}]})
    ok(c == 200 and r.get("links", {}).get(VMS) is False and not row(VMS).get("client_id"),
       "1. VMS EVENTS is not linked to Salesify because of a Tally name typed (or left) on the client (%s %s)" % (r.get("links"), row(VMS).get("client_id")))
    ok(row(VMS).get("last_seen") and row(VMS).get("device_id") == "d-1", "1. VMS EVENTS is recorded as seen on NWS144 (offered to a person)")
    ok(r.get("links", {}).get(SAL) is False and not row(SAL).get("client_id"), "1. two clients named Salesify Marketing LLP: its company waits for a person (%s)" % row(SAL).get("client_id"))
    # 2. the duplicate removed: Salesify's company links by its name with the period taken off
    S1["deleted"] = True
    c, r = call({"kind": "companies", "companies": [{"name": SAL, "gstin": ""}]})
    ok(r.get("links", {}).get(SAL) is True and row(SAL).get("client_id") == S2["id"] and row(SAL).get("linked_at"),
       "2. one Salesify left: SALESIFY MARKETING LLP - (from 1-Apr-25) linked to it by the normalised name (%s)" % row(SAL))
    # 3. the same GSTIN, another name
    c, r = call({"kind": "companies", "companies": [{"name": "GSC BOOKS 2026", "gstin": "09AANFG3202D1ZR"}]})
    ok(row("GSC BOOKS 2026").get("client_id") == GS["id"], "3. the same GSTIN as Garg Shekhar & Company: linked (%s)" % row("GSC BOOKS 2026").get("client_id"))
    # 4. a client linked to a company already: another of the same name waits for a person
    c, r = call({"kind": "companies", "companies": [{"name": "ALPHA TRADERS LLP (2025-26)", "gstin": ""}]})
    ok(not row("ALPHA TRADERS LLP (2025-26)").get("client_id"), "4. Alpha Traders, linked already: its 2025-26 company is not moved to it by itself")
    # 5. unlinked by a person: left so, even with the same GSTIN
    c, r = call({"kind": "companies", "companies": [{"name": "GARG SHEKHAR & CO OLD", "gstin": "09AANFG3202D1ZR"}]})
    ok(not row("GARG SHEKHAR & CO OLD").get("client_id"), "5. a company a person unlinked stays unlinked")
    # 6. a link a person made is kept whatever names say
    F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ PERSON", "client_id": S2["id"], "last_seen": "2026-10-01T00:00:00Z", "linked_at": "2026-10-01T00:00:00Z", "linked_by": "u-1"})
    c, r = call({"kind": "companies", "companies": [{"name": "ZZ PERSON", "gstin": ""}]})
    ok(row("ZZ PERSON").get("client_id") == S2["id"] and r.get("links", {}).get("ZZ PERSON") is True, "6. a person's link is kept")
    # 7. migration 110 (next-link-record): a company renamed in Tally (a linked company's GUID under a new name) is asked of
    # tally_link_follow (the SQL: run_migration110.py), which moves the link and its book; here the stand-in moves it
    asked = []
    def follow(fn_, a, _orig=F.rpc):
        if fn_ != "tally_link_follow": return _orig(fn_, a)
        asked.append(dict(a))
        if a.get("p_guid") == "GUID-ZZ" and a.get("p_company") == "ZZ PERSON RENAMED":
            r0 = row("ZZ PERSON"); F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ PERSON RENAMED", "client_id": r0["client_id"], "book_id": "b-zz", "last_seen": "2026-10-26T00:00:00Z", "linked_at": r0["linked_at"]})
            r0["client_id"] = None
            return r0 and S2["id"]
        return None
    F.rpc = follow
    c, r = call({"kind": "companies", "companies": [{"name": "ZZ PERSON RENAMED", "gstin": "", "guid": "GUID-ZZ"}, {"name": "NO GUID CO", "gstin": ""}, {"name": "ALPHA TRADERS LLP (2024-25)", "gstin": "", "guid": "GUID-AL"}]})
    ok(c == 200 and r.get("links", {}).get("ZZ PERSON RENAMED") is True and row("ZZ PERSON RENAMED").get("client_id") == S2["id"],
       "7. the renamed company keeps its client: tally_link_follow moved the link (%s %s)" % (c, r))
    ok([(x.get("p_company"), x.get("p_guid")) for x in asked] == [("ZZ PERSON RENAMED", "GUID-ZZ")] and all(x.get("p_firm") == FIRM for x in asked),
       "7. asked only for a company with a GUID and no link here (not for one without a GUID, nor for a linked one) (%s)" % asked)
    ok(all(x.get("p_device") == "d-1" and "p_bridge" in x for x in asked), "7. the follow names the computer and bridge that reported it (its data location)")
    # 8. migration 110: data from a second data location of a linked company is not applied (tally_link_place_check)
    places = []
    def place(fn_, a, _orig=F.rpc):
        if fn_ != "tally_link_place_check": return _orig(fn_, a)
        places.append(dict(a)); return PLACE[0]
    PLACE = [False]; F.rpc = place
    n0 = len(F.DAYS)
    c, r = call({"kind": "days", "company": "ZZ PERSON RENAMED", "days": [{"day": "20261001", "gz": ""}]})
    ok(c == 409 and r.get("otherPlace") is True and len(F.DAYS) == n0 and places and places[-1].get("p_book") == "b-zz" and places[-1].get("p_device") == "d-1",
       "8. days from a place FinCom does not read: 409 otherPlace, nothing applied (%s %s)" % (c, r))
    c, r = call({"kind": "recorder_lines", "company": "ZZ PERSON RENAMED", "lines": []})
    ok(c == 409 and r.get("otherPlace") is True, "8. the add-on's lines from there too (%s)" % c)
    PLACE[0] = None   # a cloud without 110 (the function missing answers an error): as before
    F.NO_FN.add("tally_link_place_check")
    c, r = call({"kind": "days", "company": "ZZ PERSON RENAMED", "days": [{"day": "20261001", "gz": ""}]})
    ok(not r.get("otherPlace") and c != 409, "8. a cloud without migration 110: as before, not refused (%s %s)" % (c, str(r)[:120]))
finally:
    fn.terminate()
    errs = [l for l in log if "error" in l.lower() or "uncaught" in l.lower()]
    if errs: print("  (function log: %s)" % " | ".join(x.strip() for x in errs[:8]))
print("\n%d check(s) failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
