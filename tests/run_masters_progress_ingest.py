"""python3 run_masters_progress_ingest.py - next-masters-progress (the owner: "reading masters does not have progress bar.. we
could not know whether it is working or not"): tally-ingest (server/tally-cloud/index.ts under Deno, against the stand-in for
Supabase, fake_supabase.py; never a real database) keeps the ledger list's rounds as the ledgers' progress, and never takes
an empty list for the company's masters. Written before the code. Checks:
  A. every ledger_list batch of a round (Update now, the nightly run, Import ledgers) reaches tally_ledger_progress_save:
     read = the GUIDs the round has delivered so far (tally_ledger_round_batch's seen), of = the round's rowsRead, done
     only on the round's last batch (complete); tally_books.ledgers_at set on the last batch as before;
  B. a last batch with no ledger rows, no GUIDs seen (this batch and the round) and no groups: tally_books.ledgers_at is
     NOT set; the answer says empty and its notes "Tally gave an empty list for this company"; the round keeps that note
     (tally_ledger_rounds.note, the page reads it); the progress is done at 0 of 0;
  C. a last batch with no rows but GUIDs seen (nothing changed in Tally), or groups only: not empty, ledgers_at set;
  D. a cloud without migration 98 (no tally_ledger_progress_save): the list is taken as before (200, ledgers_at set);
  E. a call with no round (a bridge before 2.1.5): no progress saved; an empty one sets no ledgers_at either.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, urllib.error, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999999155"
BA, BB, BC, BD, BE = ("11111111-1111-1111-1111-11111111155%d" % i for i in range(5))
DEV, KEY = "d1000000-0000-0000-0000-000000000155", "fcd_" + "a" * 42 + "155155"
GO = {"id": "go-aaaaaa255255", "computer": "PC-M", "user": "user-m", "mode": "main", "runMode": "user", "version": "2.5.13"}
NAMES = {BA: "ALPHA TRADERS", BB: "BLANK CO", BC: "STEADY CO", BD: "OLD CLOUD CO", BE: "OLD BRIDGE CO"}
FS.T["clients"] += [{"id": "c%d" % i, "firm_id": FIRM, "name": n, "tally_name": n, "gstin": "", "deleted": False} for i, n in enumerate(NAMES.values())]
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": n, "client_id": "c%d" % i, "book_id": b, "device_id": DEV, "last_seen": "2026-11-11T00:00:00Z"} for i, (b, n) in enumerate(NAMES.items())]
FS.T["tally_books"] += [{"book_id": b, "firm_id": FIRM, "client_id": "c%d" % i, "company": n, "from_date": "2025-04-01", "open_as_on": "2025-03-31", "ledgers_at": None} for i, (b, n) in enumerate(NAMES.items())]
FS.T["tally_devices"].append({"id": DEV, "firm_id": FIRM, "name": "PC-M", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.13", "wake_token": None})
FS.T.setdefault("tally_ledgers", []); FS.T.setdefault("tally_groups", []); FS.T.setdefault("tally_ledger_aliases", []); FS.T.setdefault("tally_vouchers", [])
FS.T.setdefault("tally_ledger_rounds", [])
real = FS.rpc
def rpc(fn, a):
    if fn == "tally_book_for":
        c = next((c for c in FS.T["tally_companies"] if c["firm_id"] == a["p_firm"] and c["company"] == a["p_company"]), None)
        return c["book_id"] if c and c.get("client_id") and c.get("book_id") else None
    if fn == "tally_ledger_round_batch":     # as migration 34 does it: the round's batches and GUIDs seen, summed
        FS.ARGS.setdefault(fn, []).append(a)
        r = next((x for x in FS.T["tally_ledger_rounds"] if x["book_id"] == a["p_book"] and x["round_id"] == a["p_round"]), None)
        if not r:
            r = {"book_id": a["p_book"], "round_id": a["p_round"], "firm_id": FIRM, "batches": 0, "rows_received": 0, "seen_n": 0, "note": None}
            FS.T["tally_ledger_rounds"].append(r)
        r["batches"] += 1; r["rows_received"] += a["p_rows"] or 0; r["seen_n"] += len(a.get("p_seen") or [])
        r["rows_read"], r["complete"] = a["p_rows_read"], a["p_complete"]
        return {"ok": True, "round": r["round_id"], "batches": r["batches"], "rows": r["rows_received"], "rowsRead": r["rows_read"], "complete": r["complete"], "seen": r["seen_n"]}
    if fn == "tally_ledgers_mark_gone":
        FS.ARGS.setdefault(fn, []).append(a)
        r = next((x for x in FS.T["tally_ledger_rounds"] if x["book_id"] == a["p_book"] and x["round_id"] == a["p_round"]), None)
        if r: r["note"] = "nothing to mark: the round saw every live ledger with a GUID"
        return {"ok": True, "marked": 0, "held": 0, "gone": 0, "note": "nothing to mark: the round saw every live ledger with a GUID"}
    if fn == "tally_ledger_progress_save":
        FS.ARGS.setdefault(fn, []).append(a)
        return {"ok": True}
    return real(fn, a)
FS.rpc = rpc
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
def boot():
    p = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    threading.Thread(target=lambda: [log.append(l) for l in p.stdout], daemon=True).start()
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    return p
log = []
def call(body):
    body = dict({"version": "2.5.13", "bridge": GO}, **body)
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
row = lambda g, name, parent, op="0": ["g-" + g, 1, 1, name, parent, op, "", "", 0, ""]
GROUPS = [["Sundry Debtors", ""], ["Cash-in-Hand", ""]]
def lst(company, rnd, rows, seen, last, rows_read, groups=True):
    b = {"kind": "ledger_list", "company": company, "complete": True, "rowsRead": rows_read, "seen": seen, "last": last, "ledgers": rows}
    if rnd is not None: b["round"] = rnd
    if groups: b["groups"] = GROUPS
    return call(b)
book = lambda b: next(x for x in FS.T["tally_books"] if x["book_id"] == b)
prog = lambda b: [x for x in (FS.ARGS.get("tally_ledger_progress_save") or []) if x["p_book"] == b]
EMPTY = "Tally gave an empty list for this company"
fn = boot()
try:
    print("== A. a round of two batches: the progress after each, done on the last")
    c, r = lst("ALPHA TRADERS", "r-a", [row("1", "Cash", "Cash-in-Hand"), row("2", "Party One", "Sundry Debtors")], ["g-1", "g-2"], False, 3)
    p = prog(BA)
    ok(c == 200 and len(p) == 1 and p[0]["p_round"] == "r-a" and p[0]["p_read"] == 2 and p[0]["p_of"] == 3 and p[0]["p_done"] is False and p[0]["p_device"] == DEV,
       "A. the first batch: 2 of 3, not done (%s %s)" % (c, p))
    ok(book(BA)["ledgers_at"] is None, "A. ledgers_at not set before the last batch")
    c, r = lst("ALPHA TRADERS", "r-a", [row("3", "Party Two", "Sundry Debtors")], ["g-3"], True, 3, groups=False)
    p = prog(BA)
    ok(c == 200 and len(p) == 2 and p[1]["p_read"] == 3 and p[1]["p_of"] == 3 and p[1]["p_done"] is True, "A. the last batch: 3 of 3, done (%s)" % p[-1:])
    ok(bool(book(BA)["ledgers_at"]) and not r.get("empty") and EMPTY not in json.dumps(r.get("notes")), "A. ledgers_at set, not empty (%s)" % r)
    print("== B. an empty list from Tally")
    c, r = lst("BLANK CO", "r-b", [], [], True, 0, groups=False)
    rb = next(x for x in FS.T["tally_ledger_rounds"] if x["book_id"] == BB)
    ok(c == 200 and book(BB)["ledgers_at"] is None, "B. ledgers_at NOT set (%s %s)" % (c, book(BB)["ledgers_at"]))
    ok(r.get("empty") is True and EMPTY in (r.get("notes") or []), "B. the answer says empty, with the note (%s)" % r)
    ok(str(rb.get("note") or "").startswith(EMPTY), "B. the round keeps the note (%s)" % rb.get("note"))
    p = prog(BB)
    ok(len(p) == 1 and p[0]["p_read"] == 0 and p[0]["p_of"] == 0 and p[0]["p_done"] is True, "B. the progress done at 0 of 0 (%s)" % p)
    print("== C. no rows but GUIDs seen (nothing changed), or groups only: not empty")
    c, r = lst("STEADY CO", "r-c", [], ["g-1", "g-2", "g-3", "g-4"], True, 4, groups=False)
    ok(c == 200 and bool(book(BC)["ledgers_at"]) and not r.get("empty"), "C. GUIDs seen: ledgers_at set (%s)" % r)
    ok(prog(BC)[-1]["p_read"] == 4 and prog(BC)[-1]["p_done"] is True, "C. 4 of 4, done (%s)" % prog(BC)[-1:])
    book(BC)["ledgers_at"] = None
    c, r = lst("STEADY CO", "r-c2", [], [], True, 0, groups=True)
    ok(c == 200 and bool(book(BC)["ledgers_at"]) and not r.get("empty"), "C. groups only: ledgers_at set (%s)" % r)
    print("== E. no round (a bridge before 2.1.5)")
    n0 = len(FS.ARGS.get("tally_ledger_progress_save") or [])
    c, r = lst("OLD BRIDGE CO", None, [row("1", "Cash", "Cash-in-Hand")], [], False, None)
    ok(c == 200 and bool(book(BE)["ledgers_at"]) and len(FS.ARGS.get("tally_ledger_progress_save") or []) == n0, "E. taken, ledgers_at set, no progress (%s)" % r)
    book(BE)["ledgers_at"] = None
    c, r = lst("OLD BRIDGE CO", None, [], [], False, None, groups=False)
    ok(c == 200 and book(BE)["ledgers_at"] is None and r.get("empty") is True, "E. an empty call: no ledgers_at (%s)" % r)
    print("== D. a cloud without migration 98")
    FS.NO_FN.add("tally_ledger_progress_save")
    c, r = lst("OLD CLOUD CO", "r-d", [row("1", "Cash", "Cash-in-Hand")], ["g-1"], True, 1)
    ok(c == 200 and bool(book(BD)["ledgers_at"]), "D. taken as before (%s %s)" % (c, r))
finally:
    fn.terminate()
    try: fn.wait(10)
    except Exception: pass
if fails:
    print("".join(log[-40:]))
    print("FAILED %d" % len(fails)); raise SystemExit(1)
print("ALL PASSED")
