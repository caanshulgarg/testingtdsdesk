"""python3 run_renumber_list.py - next-renumber (the owner's decision of 08-Oct-2026, "renumbering yes"): tally-ingest's
read-only kind "renumber_list". After a voucher is inserted (or deleted) in Tally, FinCom Bridge asks which entries FinCom
holds of that voucher type from that date on, so it can read each again from Tally (FinComVoucherObject, by MasterID) and
send those Tally renumbered. Asked {company, company_guid, vtype, from: yyyymmdd, no, mid, limit}; answered {ok, entries:
[{mid, guid, day: yyyymmdd, no, alter}], more, unknown}. The real cloud function (server/tally-cloud/index.ts) under Deno
against the stand-in for Supabase (fake_supabase.py), as run_main_bridge_server.py. Needs Deno (DENO, default: on the PATH).
  1. scoped: only the book of THIS firm's company of that name (another firm's company of the same name and its entries
     never), only that voucher type, not deleted, from the date on; on that date only those numbered from the given number
     up (prefix and suffix of the series set aside); the given MasterID left out; in date and number order.
  2. MasterIDs: the one a Tally GUID carries ("<company GUID>-<MasterID in hex>"); else the latest recorder line of the
     book under that GUID; an entry with neither is not listed, only counted (unknown).
  3. capped: at most `limit` entries (500 at most whatever is asked), `more` when there were more.
  4. read-only: no table changes but the computer's last_seen (every call's), no database function but tally_book_for.
  5. refused: a company not linked (409), no voucher type or no date (400).
RED: before the kind exists every call answers 400 "unknown kind"."""
import os, sys, json, time, copy, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, CID = "f-1", "b-1", "c-1"; KEY = "fcd_" + "a" * 48
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
G = lambda mid: "%s-%08x" % (CG, mid)
F.HONOR_LIMIT[0] = True
F.T["clients"].append({"id": CID, "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-01T00:00:00Z"})
F.T["tally_companies"].append({"firm_id": "f-2", "company": "ZZ CO", "client_id": "c-2", "book_id": "b-2", "last_seen": "2026-10-01T00:00:00Z"})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64,
                             "version": "2.3.5", "want_update_at": None, "want_sent_at": None})
def vch(book, mid, day, no, alter, vtype="Receipt", deleted=None, guid=None):
    F.T.setdefault("tally_vouchers", []).append({"book_id": book, "firm_id": FIRM if book == BOOK else "f-2", "guid": guid or G(mid), "day": day, "alter_id": alter, "vtype": vtype, "vno": no,
                                  "party": "", "narration": "", "cancelled": False, "optional": False, "deleted_at": deleted})
vch(BOOK, 26309, "2026-10-05", "190", 54390)
vch(BOOK, 26311, "2026-10-05", "191", 54391)
vch(BOOK, 26312, "2026-10-05", "192", 54392)
vch(BOOK, 26313, "2026-10-06", "193", 54393)
vch(BOOK, 26314, "2026-10-07", "194", 54394)
vch(BOOK, 26400, "2026-10-05", "191", 54400)                       # the inserted one itself (mid given: left out)
vch(BOOK, 26320, "2026-10-04", "189", 54380)                       # before the date
vch(BOOK, 26321, "2026-10-06", "J-7", 54395, vtype="Journal")      # another voucher type
vch(BOOK, 26322, "2026-10-06", "195", 54396, deleted="2026-10-07T00:00:00Z")   # deleted
vch(BOOK, 0, "2026-10-08", "196", 54397, guid="aa11bb22-0000-0000-0000-000000000001-00000abc")   # came by import: its own GUID
vch(BOOK, 0, "2026-10-09", "197", 54398, guid="no-mid-anywhere")   # no MasterID known
vch("b-2", 26313, "2026-10-06", "193", 54393)                      # another firm's company of the same name
F.T.setdefault("tally_recorder_lines", []).append({"id": 7, "book_id": BOOK, "object_guid": "aa11bb22-0000-0000-0000-000000000001-00000abc", "master_id": "26330", "state": "applied", "event": "altered"})
F.T.setdefault("tally_recorder_lines", []).append({"id": 8, "book_id": "b-2", "object_guid": "no-mid-anywhere", "master_id": "999", "state": "applied", "event": "altered"})
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
ASK = {"kind": "renumber_list", "version": "2.3.5", "company": "ZZ CO", "company_guid": CG, "vtype": "Receipt", "from": "20261005", "no": "191", "mid": "26400", "limit": 500}
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    before = {t: copy.deepcopy(v) for t, v in F.T.items() if t != "tally_devices"}
    F.ARGS.clear()
    c, r = call(ASK)
    ents = r.get("entries") or []
    got = [(e.get("mid"), e.get("day"), e.get("no")) for e in ents]
    ok(c == 200 and r.get("ok") is True, "answered 200 ok (%s %s)" % (c, r.get("error")))
    ok(got == [("26311", "20261005", "191"), ("26312", "20261005", "192"), ("26313", "20261006", "193"), ("26314", "20261007", "194"), ("26330", "20261008", "196")],
       "1-2. this book's Receipts from 05-Oct numbered 191 up (190 and 189 not, the inserted 26400 not, the Journal not, the deleted 195 not), in order, MasterIDs from the GUID or the recorder line: %s" % got)
    ok(all(e.get("guid") and isinstance(e.get("alter"), int) for e in ents) and ents and ents[0]["guid"] == G(26311) and ents[0]["alter"] == 54391, "each with its GUID and AlterID (%s)" % (ents[:1],))
    ok(r.get("more") is False and r.get("unknown") == 1, "2. not more; one entry without a MasterID counted, not listed (more %s, unknown %s)" % (r.get("more"), r.get("unknown")))
    c, r = call(dict(ASK, limit=3))
    ok(c == 200 and [e["mid"] for e in r.get("entries") or []] == ["26311", "26312", "26313"] and r.get("more") is True, "3. capped at the limit asked (3): the first three, more (%s)" % r)
    c, r = call(dict(ASK, limit=100000))
    ok(c == 200 and len(r.get("entries") or []) == 5, "3. a limit above 500 is 500 (%s)" % len(r.get("entries") or []))
    c, r = call(dict(ASK, no="", mid=""))
    ok(c == 200 and sorted(e["mid"] for e in r.get("entries") or [] if e["day"] == "20261005") == ["26309", "26311", "26312", "26400"], "1. no number: every entry of that day (%s)" % [e["mid"] for e in r.get("entries") or []])
    c, r = call(dict(ASK, vtype="receipt"))
    ok(c == 200 and r.get("entries") == [], "1. the voucher type as Tally names it (%s)" % r.get("entries"))
    after = {t: v for t, v in F.T.items() if t != "tally_devices"}
    ok(after == before, "4. nothing in the database changed")
    ok(set(F.ARGS) <= {"tally_book_for"}, "4. no database function but tally_book_for (%s)" % sorted(F.ARGS))
    c, r = call(dict(ASK, company="NOT LINKED"))
    ok(c == 409 and r.get("notLinked") is True, "5. a company not linked: 409 (%s %s)" % (c, r))
    c, r = call(dict(ASK, vtype=""))
    ok(c == 400, "5. no voucher type: 400 (%s)" % c)
    c, r = call(dict(ASK, **{"from": "5-Oct"}))
    ok(c == 400, "5. no date: 400 (%s)" % c)
finally:
    fn.terminate()
print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
if fails: print("".join(log[-30:]))
sys.exit(1 if fails else 0)
