"""python3 run_clean_names_server.py - migration-23 (02-Oct-2026): tally-ingest cleans ledger, group and party names
before they reach the database. Tally keeps some masters with line breaks in the name ("MCS Project Pvt Ltd\\r\\n",
"...&#13;&#10;"), while the day book names them without; the cloud copy keeps one clean name (each run of &#13; &#10;
CR LF, with the spaces around it, becomes one space, ends trimmed; other spaces kept: Tally keeps "Arktos  Control &
Instruments" with two, and postings use Tally's exact name), the rule of FinCom's ledNm and of tally_nm.
The real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py),
which notes what each database function was sent. Needs Deno (DENO, default: the deno on the PATH)."""
import os, sys, json, time, gzip, base64, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, CID = "f-1", "b-1", "c-1"; KEY = "fcd_" + "e" * 48
F.T["clients"].append({"id": CID, "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-01T00:00:00Z"})
F.T["tally_books"].append({"book_id": BOOK, "firm_id": FIRM, "client_id": CID, "company": "ZZ CO", "from_date": None})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64,
                             "version": "1.15.0", "want_update_at": None, "want_sent_at": None})
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def gz(t): return base64.b64encode(gzip.compress(t.encode())).decode()
MCS, RAK = "MCS Project Pvt Ltd", "RAKVIK TECHNOLOGIES PRIVATE LIMITED"
# one sale: the party with a line break (as Tally writes it, &#13;&#10;) and two spaces, its ledger lines: one with two
# spaces (kept), one with a line break and spaces round it
DAY = ("<ENVELOPE><TALLYMESSAGE><VOUCHER REMOTEID=\"g-1\" VCHTYPE=\"Sales\"><DATE>20260302</DATE><GUID>g-1</GUID><ALTERID>7</ALTERID>"
       "<VOUCHERNUMBER>1</VOUCHERNUMBER><PARTYLEDGERNAME>Arktos  Control &amp; Instruments&#13;&#10;</PARTYLEDGERNAME>"
       "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Arktos  Control &amp; Instruments</LEDGERNAME><AMOUNT>-4720.00</AMOUNT>"
       "<BILLALLOCATIONS.LIST><NAME>1</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-4720.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>"
       "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Professional Fee &#13;&#10; </LEDGERNAME><AMOUNT>4720.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></ENVELOPE>")
try:
    for i in range(60):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    # the masters: the same ledger as Tally sends it twice (CR LF, and the entity form), a name with two spaces, groups too
    c, r = call({"kind": "ledgers", "company": "ZZ CO", "from": "20250401", "openAsOn": "20250331",
                 "ledgers": [[MCS + "\r\n", "Master Cad", "6000"], [MCS + "&#13;&#10;", "", "0"], [RAK + "\r\n\r\n", "Rakesh Kumar\n", "-17550"],
                             ["Yellow  Media Pvt Ltd", "Sundry Debtors", "0"], ["Yellow  Media Pvt Ltd", "Sundry Debtors", "0"], ["Sal-Pratham \r\n", "SALARY  PAYABLE", "0"]],
                 "groups": [["Clean  Club", "Sundry Debtors"], ["Rakesh Kumar\r\n", "Sundry Debtors"], ["Rakesh Kumar", ""], ["Sundry Debtors", "Primary"]]})
    a = (F.ARGS.get("tally_ingest_ledgers_g") or [{}])[-1]
    ok(c == 200, "a ledger list is taken (%s)" % c)
    ok(a.get("p_ledgers") == [[MCS, "Master Cad", "6000"], [MCS, "", "0"], [RAK, "Rakesh Kumar", "-17550"], ["Yellow  Media Pvt Ltd", "Sundry Debtors", "0"], ["Sal-Pratham", "SALARY  PAYABLE", "0"]],
       "masters reach the database without line breaks, two spaces inside a name kept; the same name sent twice once; twins both go, for their openings to be added (%s)" % json.dumps(a.get("p_ledgers")))
    ok(a.get("p_groups") == [["Clean  Club", "Sundry Debtors"], ["Rakesh Kumar", "Sundry Debtors"], ["Sundry Debtors", ""]],
       "groups cleaned of line breaks (two spaces kept), one per clean name (the one with a parent), Primary as no parent (%s)" % json.dumps(a.get("p_groups")))
    # a day book: the party and the ledger lines arrive clean, the bill-wise line under the clean ledger too
    c, r = call({"kind": "days", "company": "ZZ CO", "days": [{"day": "20260302", "gz": gz(DAY)}]})
    d = (F.ARGS.get("tally_ingest_day") or [{}])[-1]
    ok(c == 200 and r.get("done") == ["20260302"], "a day is taken (%s %s)" % (c, r))
    ok([v["party"] for v in d.get("p_vouchers", [])] == ["Arktos  Control & Instruments"], "the entry's party has no line break, its two spaces kept (%s)" % json.dumps([v.get("party") for v in d.get("p_vouchers", [])]))
    ok([l[1] for l in d.get("p_lines", [])] == ["Arktos  Control & Instruments", "Professional Fee"], "its ledger lines: two spaces kept, the line break and the spaces round it gone (%s)" % json.dumps([l[1] for l in d.get("p_lines", [])]))
    ok(d.get("p_lines", [[]])[0][2:] == [-4720, "", None, [["1", "New Ref", -4720, None]]], "amount, HSN, rate and bill-wise details unchanged (%s)" % json.dumps(d.get("p_lines", [[]])[0][2:]))
    # the groups call (bridge 1.14.9) writes the tables itself: the ledger's twins are one clean row, with the group
    c, r = call({"kind": "groups", "company": "ZZ CO", "ledgers": [[RAK + "&#13;&#10;&#13;&#10;", ""], [RAK + "\r\n\r\n", "Rakesh Kumar"], ["  Yellow  Media Pvt Ltd ", "Clean  Club\n"], ["Yellow  Media Pvt Ltd&#13;&#10;", ""]],
                 "groups": [["Rakesh Kumar", "Sundry Debtors"], ["Clean  Club", "Sundry Debtors"], ["Sundry Debtors", "Primary"]]})
    led = {x["name"]: x for x in F.T.get("tally_ledgers", [])}
    ok(c == 200 and r.get("ledgers") == 2 and r.get("groups") == 3, "the groups call is taken: two ledgers once cleaned (%s %s)" % (c, r))
    ok(sorted(led) == [RAK, "Yellow  Media Pvt Ltd"], "the ledgers kept under clean names only (%s)" % json.dumps(sorted(led)))
    ok(led.get(RAK, {}).get("parent") == "Rakesh Kumar" and led.get(RAK, {}).get("chain") == ["Rakesh Kumar", "Sundry Debtors"], "the twin with a group gives the ledger its group and chain (%s)" % json.dumps(led.get(RAK)))
    ok(led.get("Yellow  Media Pvt Ltd", {}).get("chain") == ["Clean  Club", "Sundry Debtors"], "two spaces inside a ledger and a group name kept; the group with a line break meets its copy without (%s)" % json.dumps(led.get("Yellow  Media Pvt Ltd")))
    ok(sorted(g["name"] for g in F.T.get("tally_groups", [])) == ["Clean  Club", "Rakesh Kumar", "Sundry Debtors"], "the groups kept under clean names (%s)" % json.dumps(sorted(g["name"] for g in F.T.get("tally_groups", []))))
finally:
    fn.terminate()
    try: fn.wait(timeout=5)
    except Exception: fn.kill()
if fails:
    print("".join(log[-40:]))
    print("FAILED %d" % len(fails)); raise SystemExit(1)
print("all passed")
