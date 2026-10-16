"""python3 run_book_start_server.py - round 64 (the owner's test of 16-Oct-2026: GB TEXCOAT's three Day Book uploads, 560 days,
1,182 entries and 224 ledgers held, every page empty; Connect Tally's step 5 never ticked). Through the real cloud function
(server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py); never a real database.
  A. upload_done on a book with no start (tally_books.from_date / open_as_on null): from = the upload's first day, openings as
     on the day before; a second upload with an earlier period does not move it; a book with a start keeps it; a book with
     a start but no openings date gets the day before its start.
  B. a later bridge "ledgers" call (the bridge's state from 20260401) cannot move the start forward past entries held
     before it: kept, said; with no entry before it the call goes through as before.
  C. ledger_list (the bridge's whole list, applyLedgerList) sets tally_books.ledgers_at on the last batch of a round (and on
     a call with no round), not on a middle batch.
  D. the "ledgers" wake says how many computers were asked (asked), 0 with notLinked for a client not linked.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
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
FIRM = "99999999-9999-9999-9999-999999999999"
B1, B2, B3, B4 = ("11111111-1111-1111-1111-11111111111%d" % i for i in range(1, 5))
DEV, KEY = "d1000000-0000-0000-0000-000000000001", "fcd_" + "b" * 48
FS.USERS["tok-owner"] = {"id": "u-owner", "email": "owner@zz.test"}
FS.T["members"] += [{"user_id": "u-owner", "firm_id": FIRM, "role": "owner", "active": True}]
FS.T["clients"] += [{"id": c, "firm_id": FIRM, "name": n, "tally_name": n, "gstin": "", "deleted": False} for c, n in (("c1", "GB TEXCOAT"), ("c2", "ABC"), ("c3", "OLD CO"), ("c4", "HALF CO"), ("c9", "NOT LINKED"))]
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": n, "client_id": c, "book_id": b, "device_id": DEV, "last_seen": "2026-10-16T00:00:00Z"}
                            for c, n, b in (("c1", "GB TEXCOAT", B1), ("c2", "ABC", B2), ("c3", "OLD CO", B3), ("c4", "HALF CO", B4))]
FS.T["tally_books"] += [{"book_id": B1, "firm_id": FIRM, "client_id": "c1", "company": "GB TEXCOAT", "from_date": None, "open_as_on": None, "ledgers_at": None},
                        {"book_id": B2, "firm_id": FIRM, "client_id": "c2", "company": "ABC", "from_date": None, "open_as_on": None, "ledgers_at": None},
                        {"book_id": B3, "firm_id": FIRM, "client_id": "c3", "company": "OLD CO", "from_date": "2024-04-01", "open_as_on": "2024-03-31", "ledgers_at": None},
                        {"book_id": B4, "firm_id": FIRM, "client_id": "c4", "company": "HALF CO", "from_date": "2025-04-01", "open_as_on": None, "ledgers_at": None}]
FS.T["tally_devices"].append({"id": DEV, "firm_id": FIRM, "name": "NWS144", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.4.4", "wake_token": None})
FS.T["tally_vouchers"] = [{"book_id": B1, "firm_id": FIRM, "guid": "v-early", "day": "2025-05-02", "deleted_at": None}]
FS.T.setdefault("tally_ledgers", []); FS.T.setdefault("tally_groups", []); FS.T.setdefault("tally_ledger_aliases", [])
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, device=False):
    h = {"Content-Type": "application/json"}
    if device: h["x-fincom-device"] = KEY
    else: h["Authorization"] = "Bearer tok-owner"
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    book = lambda b: next(x for x in FS.T["tally_books"] if x["book_id"] == b)
    def upload(client, frm, to):
        c, r = call({"kind": "upload_new", "client": client, "name": "DayBook.xml", "size": 5, "from": frm, "to": to})
        FS.FILES["tally-uploads/" + str(r.get("path"))] = b"<ENV>"
        c2, r2 = call({"kind": "upload_done", "client": client, "job": r.get("job"), "path": r.get("path")})
        return c, c2, r2
    # ---------------------------------------------------------------- A
    c, c2, r2 = upload("c1", "20250401", "20251231")
    bk = book(B1)
    ok(c == 200 and c2 == 200 and str(bk["from_date"])[:10] == "2025-04-01" and str(bk["open_as_on"])[:10] == "2025-03-31",
       "A. an upload on a book with no start: from_date = the upload's first day, open_as_on the day before (%s %s)" % (bk["from_date"], bk["open_as_on"]))
    upload("c1", "20240401", "20250331")
    ok(str(book(B1)["from_date"])[:10] == "2025-04-01" and str(book(B1)["open_as_on"])[:10] == "2025-03-31", "A. a second upload with an earlier period: the start is not moved (%s)" % book(B1)["from_date"])
    upload("c2", "20260401", "20261015")
    ok(str(book(B2)["from_date"])[:10] == "2026-04-01" and str(book(B2)["open_as_on"])[:10] == "2026-03-31", "A. another book: its own upload's dates (%s %s)" % (book(B2)["from_date"], book(B2)["open_as_on"]))
    upload("c3", "20260401", "20261015")
    ok(str(book(B3)["from_date"])[:10] == "2024-04-01" and str(book(B3)["open_as_on"])[:10] == "2024-03-31", "A. a book with a start keeps it (%s %s)" % (book(B3)["from_date"], book(B3)["open_as_on"]))
    upload("c4", "20260401", "20261015")
    ok(str(book(B4)["from_date"])[:10] == "2025-04-01" and str(book(B4)["open_as_on"])[:10] == "2025-03-31", "A. a start but no openings date: the day before the start (%s %s)" % (book(B4)["from_date"], book(B4)["open_as_on"]))
    # ---------------------------------------------------------------- B
    FS.ARGS.pop("tally_ingest_ledgers_g", None)
    c, r = call({"kind": "ledgers", "company": "GB TEXCOAT", "from": "20260401", "openAsOn": "20260331", "ledgers": [["Cash", "Cash-in-Hand", "-100"]], "groups": []}, device=True)
    ok(c == 200 and "kept" in r and not FS.ARGS.get("tally_ingest_ledgers_g") and str(book(B1)["from_date"])[:10] == "2025-04-01",
       "B. a later bridge 'ledgers' call (from 20260401) with entries before it: the start and openings kept, said (%s)" % r.get("kept", r))
    FS.ARGS.pop("tally_ingest_ledgers_g", None)
    c, r = call({"kind": "ledgers", "company": "ABC", "from": "20260401", "openAsOn": "20260331", "ledgers": [["Cash", "Cash-in-Hand", "-100"]], "groups": []}, device=True)
    ok(c == 200 and "kept" not in r and len(FS.ARGS.get("tally_ingest_ledgers_g") or []) == 1, "B. no entry before its date: the call goes through as before (%s)" % r)
    # ---------------------------------------------------------------- C
    row = lambda i: ["g-%d" % i, "", 10 + i, "Ledger %d" % i, "Sundry Debtors", "0", "", "", "0", ""]
    c, r = call({"kind": "ledger_list", "company": "GB TEXCOAT", "round": "r-1", "complete": True, "rowsRead": 2, "seen": ["g-1"], "ledgers": [row(1)], "groups": [["Sundry Debtors", ""]]}, device=True)
    ok(c == 200 and book(B1).get("ledgers_at") is None, "C. a middle batch of a round: ledgers_at not set yet (%s; %s)" % (c, book(B1).get("ledgers_at")))
    c, r = call({"kind": "ledger_list", "company": "GB TEXCOAT", "round": "r-1", "complete": True, "rowsRead": 2, "seen": ["g-2"], "last": True, "ledgers": [row(2)], "groups": []}, device=True)
    ok(c == 200 and str(book(B1).get("ledgers_at") or "").startswith("20"), "C. the last batch: tally_books.ledgers_at set (%s; %s)" % (c, book(B1).get("ledgers_at")))
    c, r = call({"kind": "ledger_list", "company": "ABC", "ledgers": [row(3)], "groups": []}, device=True)
    ok(c == 200 and str(book(B2).get("ledgers_at") or "").startswith("20"), "C. a list with no round (a bridge before 2.1.5): ledgers_at set (%s)" % book(B2).get("ledgers_at"))
    # ---------------------------------------------------------------- D
    c, r = call({"kind": "wake", "what": "ledgers", "client": "c1"})
    ok(c == 200 and r.get("asked") == 1 and r.get("woken") == 0, "D. the ledgers wake: the computer asked through its record (asked 1, woken 0: no wake channel) (%s)" % r)
    c, r = call({"kind": "wake", "what": "ledgers", "client": "c1"})
    ok(c == 200 and r.get("asked") == 0 and r.get("debounced") == 1, "D. again within a minute: debounced, none asked (%s)" % r)
    c, r = call({"kind": "wake", "what": "ledgers", "client": "c9"})
    ok(c == 200 and r.get("asked") == 0 and r.get("notLinked") is True, "D. a client not linked: none asked, notLinked (%s)" % r)
finally:
    fn.terminate()
    try: fn.wait(10)
    except Exception: pass
if fails:
    print("".join(log[-40:]))
    print("FAILED %d" % len(fails)); raise SystemExit(1)
print("ALL PASSED")
