"""python3 run_recorder_guid_server.py - (05-Oct-2026, FinCom Bridge 2.3.0: cancel/delete GUID) tally-ingest's recorder_lines
for a voucher's delete or cancel line WITHOUT a GUID (a real TallyPrime 7.1 writes none on these events; the bridge sends one
when Tally or its own record gave it). tally-ingest looks in FinCom's own record before the line is stored: the book's
recorder lines under the same company GUID and MasterID that ended applied or duplicate and came WITH Tally's entry under
their GUID (body.vouchers holding that GUID; never a placeholder ...-00000000, never a line whose ids did not belong
together). Exactly one GUID found: the line goes on with it (object_guid; the bridge's heldWhy dropped; payload.guidFrom says
where it came from) and the answer's result for that line carries guid. None, or two different GUIDs: the line goes as sent
(the database holds it with words). The GUID a MasterID makes (<company GUID>-<MasterID in 8 hex digits>) is never used on its
own. Lines with a GUID, ledger lines and other events are untouched.
The real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py); the
database's tally_recorder_send is answered by the stand-in here (what reaches it is checked). Needs Deno (DENO).
RED (before the change): the delete / cancel lines reach tally_recorder_send without a GUID."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, OTHER, CID = "f-1", "b-1", "b-2", "c-1"; KEY = "fcd_" + "e" * 48
CG = "78257d7a-c68a-4ffc-a253-148c60566464"
F.T["clients"].append({"id": CID, "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-05T00:00:00Z"})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.3.0"})
def row(i, mid, guid, event="created", state="applied", body=True, book=BOOK, cg=CG, mm=None):
    pl = {"line_id": "s%d" % i, "event": event, "object_guid": guid, "master_id": str(mid)}
    if mm: pl["idsMismatch"] = True
    return {"id": i, "book_id": book, "firm_id": FIRM, "line_id": "s%d" % i, "event": event, "state": state, "object_guid": guid, "master_id": str(mid), "company_guid": cg,
            "vch_type": "Receipt", "vch_no": str(i), "vch_date": "2026-10-02", "payload": pl, "body": {"vouchers": [{"guid": guid, "type": "Receipt"}]} if body else {}}
IMP = "aaaa1111-2222-3333-4444-555566667777-0000abcd"          # an entry that came by import: not the GUID its MasterID makes
F.T["tally_recorder_lines"] = [
    row(1, 2, CG + "-00000002"),                                  # mid 2: Tally's own entry, created then altered
    row(2, 2, CG + "-00000002", event="altered"),
    row(3, 3, IMP, state="duplicate"),                            # mid 3: an imported entry (another GUID): taken as Tally gave it
    row(4, 5, CG + "-00000005", body=False),                      # mid 5: no entry with the line: not Tally's word
    row(5, 6, CG + "-00000000"),                                  # mid 6: the placeholder: never
    row(6, 7, CG + "-00000007"), row(7, 7, CG + "-00000099"),     # mid 7: two GUIDs: FinCom cannot tell
    row(8, 8, CG + "-00000008", state="held"),                    # mid 8: held, not settled
    row(9, 9, CG + "-00000009", book=OTHER),                      # mid 9: another book's
    row(10, 10, "zz-other-co-0000000a", cg="zz-other-co"),         # mid 10: another company GUID's
    row(11, 11, CG + "-00000063", mm=True),                       # mid 11: ids that did not belong together
]
SENT = []
real = F.rpc
def rpc(fn, a):
    if fn == "tally_recorder_send":
        SENT.extend(a["p_lines"]); return {"results": [{"line_id": l["line_id"], "state": "held" if not l.get("object_guid") else "applied", "why": None} for l in a["p_lines"]]}
    return real(fn, a)
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
WORDS = "deleted in Tally; FinCom could not tell which entry: upload that day's Day Book to settle it"
def line(lid, event, mid, guid="", why=WORDS, cg=CG):
    l = {"line_id": lid, "event": event, "object_guid": guid, "master_id": str(mid), "alter_id": None, "vch_type": "Receipt", "vch_no": "1", "vch_date": "20261002",
         "saved_at": "2026-10-05T13:56:00Z", "pc": "PC", "user": "TALLY User", "company_guid": cg, "ledgers": [], "narration": "", "fid": "", "xml": "", "source": "addon"}
    if why: l["heldWhy"] = why
    return l
BR = {"id": "go-aaaaaa111111", "computer": "PC", "user": "u", "mode": "main", "runMode": "user", "version": "2.3.0"}
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    lines = [line("L2", "deleted", 2), line("L3", "cancelled", 3, why=WORDS.replace("deleted", "cancelled")), line("L5", "deleted", 5), line("L6", "deleted", 6),
             line("L7", "deleted", 7), line("L8", "deleted", 8), line("L9", "deleted", 9), line("L10", "deleted", 10), line("L11", "deleted", 11), line("L12", "deleted", 12),
             line("LG", "deleted", 2, guid="given-guid-1", why=None), line("LA", "altered", 2, why=None), line("LL", "ledger_deleted", 2, why=None)]
    c, r = call({"kind": "recorder_lines", "version": "2.3.0", "bridge": BR, "company": "ZZ CO", "company_guid": CG, "lines": lines})
    ok(c == 200 and len(SENT) == len(lines), "recorder_lines answered and every line reaches the database (%s, %d)" % (c, len(SENT)))
    got = {l["line_id"]: l for l in SENT}
    res = {x["line_id"]: x for x in (r.get("results") or [])}
    g = lambda k: got.get(k, {}).get("object_guid")
    ok(g("L2") == CG + "-00000002" and "heldWhy" not in got["L2"] and (got["L2"].get("payload") or {}).get("object_guid") == CG + "-00000002"
       and "copy" in str((got["L2"].get("payload") or {}).get("guidFrom", "")) and "heldWhy" not in (got["L2"].get("payload") or {}),
       "a delete of mid 2: Tally's GUID from FinCom's record, the bridge's words dropped, the payload says where it came from (%s)" % got.get("L2"))
    ok(res.get("L2", {}).get("guid") == CG + "-00000002", "the answer's result carries the GUID found (%s)" % res.get("L2"))
    ok(g("L3") == IMP, "a cancel of mid 3: an imported entry's GUID as Tally gave it with its entry, not the one its MasterID makes (%s)" % g("L3"))
    for k, why in (("L5", "no entry came with the line"), ("L6", "only the placeholder"), ("L7", "two GUIDs for one MasterID"), ("L8", "only a held line"),
                   ("L9", "another book's"), ("L10", "another company GUID's"), ("L11", "ids that did not belong together"), ("L12", "nothing known: never the GUID its MasterID makes")):
        ok(not g(k) and got.get(k, {}).get("heldWhy") == WORDS and "guid" not in res.get(k, {}), "%s not resolved: %s; held with the bridge's words (%s)" % (k, why, g(k)))
    ok(g("LG") == "given-guid-1" and g("LA") in (None, "") and g("LL") in (None, ""), "a line with a GUID, an alteration and a ledger delete untouched (%s %s %s)" % (g("LG"), g("LA"), g("LL")))
    ok(any("cancel/delete GUID" in l and "L2" in l for l in log), "tally-ingest logs the decision (%s)" % [l.strip() for l in log if "GUID" in l][:3])
    # the alteration carrying Tally's entry and the delete of it in the SAME call: the delete takes the GUID of the entry sent
    # before it (an older bridge's batch, or the bridge's record lost)
    G13 = "eeee-imported-00001313"
    X13 = ('<VOUCHER REMOTEID="%s" VCHTYPE="Receipt"><DATE>20261002</DATE><GUID>%s</GUID><MASTERID>13</MASTERID><ALTERID>40</ALTERID><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>'
           '<VOUCHERNUMBER>13</VOUCHERNUMBER><PARTYLEDGERNAME>Party</PARTYLEDGERNAME><NARRATION>x</NARRATION><ISCANCELLED>No</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL>'
           '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><AMOUNT>-5.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>5.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') % (G13, G13)
    alt13 = dict(line("A13", "altered", 13, guid=G13, why=None), xml=X13, alter_id=40)
    del SENT[:]
    c, r = call({"kind": "recorder_lines", "version": "2.3.0", "bridge": BR, "company": "ZZ CO", "company_guid": CG, "lines": [alt13, line("D13", "deleted", 13), line("D14", "deleted", 14)]})
    got = {l["line_id"]: l for l in SENT}
    ok(c == 200 and got.get("D13", {}).get("object_guid") == G13 and "heldWhy" not in got.get("D13", {}) and not got.get("D14", {}).get("object_guid"),
       "a delete after the alteration carrying Tally's entry in the same call takes that entry's GUID; another MasterID does not (%s, %s)" % (got.get("D13", {}).get("object_guid"), got.get("D14", {}).get("object_guid")))
finally:
    fn.terminate()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
