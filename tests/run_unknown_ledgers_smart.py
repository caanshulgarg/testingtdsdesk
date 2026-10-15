"""python3 run_unknown_ledgers_smart.py - the owner (15-Oct-2026), on 221 near-identical lines for one client ("Sales GBTS2627-09
of 12-Oct-2026 uses the ledger 'OUTPUT IGST 18%', which FinCom does not have yet. ... until the next ledger list or bridge
2.3.1."): "there should be some smart way to show it.. everywhere it is showing like that.. and there is no option to
rectify this also.. even after confirming all the ledgers.. all the error is there.. rather it should automatically be
removed".

The shape of GB TEXCOAT SOLUTION PRIVATE LIMITED on staging: 9 ledger names used by entries and not in FinCom's ledger list
(GST PAYABLE 14, INPUT CGST 82, INPUT IGST 94, INPUT SGST 81, OUTPUT IGST 18% 38, PURCHASE @18% 10, Provision for Tax 1,
SNV AVIATION PRIVATE LIMITED Delhi 3, UFLEX Limited 4: 327 entries), its Tally computer NWS144 with background reading
PAUSED from the tray. Checked:
  1. one line for the client, never a line an entry: "9 ledgers used in Tally are not in FinCom yet (INPUT IGST, INPUT CGST,
     … · 327 entries)"; on the Books page once, on Books -> Ledgers once (in Please check), none on Sync activity; the bell
     has one item for the client with the count only;
  2. expanded: one row a ledger with its entry count and "see entries" (which lists that ledger's entries);
  3. no "2.3.1" anywhere;
  4. the one action, Read the ledgers now: the existing Update now path (tally_want_update for the client); with reading
     paused on NWS144 its plain reason (the tray's Resume background reading) and that it still reads once; then progress;
  5. self-clearing, with no Clear pressed:
     a. a ledger confirmed on the GST/TDS ledgers page (b.map ok) leaves the line at once;
     b. a ledger arriving in FinCom's list under Tally's other capitals or spaces ("Input CGST" for "INPUT CGST", as on
        staging) leaves it (Tally names a ledger without minding capitals or spaces);
     c. a ledger Tally renamed (tally_ledger_aliases, migration 59: same GUID, "SNV AVIATION PRIVATE LIMITED Delhi" for
        FinCom's "SNV AVIATION PRIVATE LIMITED") leaves it;
     d. every ledger settled: nothing shown anywhere, the bell's item gone.
  6. the stopped / offline / Tally-closed reasons: the button cannot run and says why.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_unknown_ledgers_smart.py [shots-dir]
RED (before the change): a line an entry and ledger, the "2.3.1" words, no Read the ledgers now, a confirmed ledger stays."""
import json, os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else ""
import ledpage_setup as L
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
COUNTS = [("GST PAYABLE", 14), ("INPUT CGST", 82), ("INPUT IGST", 94), ("INPUT SGST", 81), ("OUTPUT IGST 18%", 38), ("PURCHASE @18%", 10),
          ("Provision for Tax", 1), ("SNV AVIATION PRIVATE LIMITED Delhi", 3), ("UFLEX Limited", 4)]
UNKNOWN, i = [], 0
for n, k in COUNTS:
    for j in range(k):
        i += 1
        UNKNOWN.append({"book_id": "bk-zz", "client_id": "CID", "guid": "g-%d" % i, "vtype": "Sales" if n.startswith("OUTPUT") else "Purchase",
                        "vno": "GBTS2627-%03d" % i, "day": "2026-%02d-%02d" % (4 + (i % 6), 1 + (i % 28)), "ledgers": [n]})
assert len(UNKNOWN) == 327
D1 = "d0000000-0000-4000-8000-000000000001"
# the computer that keeps the client's company: NWS144, Tally open, background reading paused from the tray
DEV = """([cid, co, paused, state]) => {
  const now = new Date().toISOString();
  const beat = {at: state === "offline" ? new Date(Date.now() - 3600e3).toISOString() : now, every: 30, tally: state !== "closed", tallyState: state === "closed" ? "closed" : "open",
    open: state === "closed" ? [] : [co], paused, computer: "NWS144", version: "2.4.4", companies: [{name: co, open: true, lastRead: "2026-10-10T10:28:17"}]};
  const d = {id: "@D1@", name: "Office computer", revoked: false, last_seen: beat.at, version: "2.4.4", main_bridge: "go-1",
    info: {computer: "NWS144", user: "tally", beat, readStop: state === "stopped" ? {by: "fincom", reason: "audit week", at: now} : null,
      bridges: {"go-1": {at: beat.at, version: "2.4.4", computer: "NWS144", tally: true, tallyState: beat.tallyState, open: beat.open, paused}}}};
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [d], cos: [{company: co, client_id: cid, device_id: d.id}], stops: state === "stopped" ? [{device_id: d.id, reason: "audit week", stopped_at: now}] : []};
  TCloud.pane.devices = [d]; TCloud.pane.at = Date.now();
  if (typeof Bridge === "object"){ Bridge.on = () => false; }
  render(); }""".replace("@D1@", D1)
RELOAD = """async () => { const cid = S.books.cid; if (typeof Ledgers === "object"){ await Ledgers.load(cid, {force: true}); Ledgers.seen[cid] = Date.now(); }
  Rec.unk = {}; const bks = Rec.unkBooks(cid); await Rec.unkLoad(bks.length ? bks : null); render(); }"""
with sync_playwright() as p:
    srv, br, pg = L.start(p, 8457, SITE, width=1440, height=1000, errors=errors)
    E = pg.evaluate
    alltxt = lambda s: E("(s) => [...document.querySelectorAll(s)].map(e => e.innerText.replace(/\\s+/g, ' ').trim())", s)
    cid, _ = L.open_page(pg, "owner", True)
    co = E("() => (CO() || {}).tallyName || (CO() || {}).name")
    E("(u) => { window.__unk15 = u; const r = TCloud.rpc; TCloud.rpc = async (fn, a) => { if (fn === 'tally_unknown_ledger_entries'){ window.__rpc.push([fn, a]); return JSON.parse(JSON.stringify(window.__unk15)).map(x => Object.assign(x, {client_id: S.books.cid})); } return r(fn, a); }; }", UNKNOWN)
    E(DEV, [cid, co, True, "open"])
    E(RELOAD); pg.wait_for_timeout(500)
    def bellunk():
        # the bell reads the firm's list (p_book null) on its first look: look, wait for the read, look again
        E("() => AlertHub.all()"); pg.wait_for_timeout(700)
        return E("() => AlertHub.all().filter(x => /^unk:/.test(x.key)).map(x => x.text)")
    # ---------- 1. one line for the client, on the Books page
    E("() => { S.booksTab = 'mis'; S.misTab = 'pl'; render(); }"); pg.wait_for_timeout(800)
    box = '#app [data-unknown-ledgers="books"]'
    ok(E("(s) => document.querySelectorAll(s).length", box) == 1, "1. Books page: one unknown-ledgers line for the client")
    head = alltxt(box + " [data-unk-head]")
    ok(head and head[0].startswith("9 ledgers used in Tally are not in FinCom yet (INPUT IGST, INPUT CGST, ") and head[0].endswith("· 327 entries)"),
       "1. the line: 9 ledgers, the two most used named, 327 entries (%s)" % head)
    ok(E("(s) => document.querySelectorAll(s + ' [data-unknown-ledger]').length", box) == 0, "1. no line an entry")
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "after-books-1440.png"))
    # ---------- 2. expanded: one row a ledger, its count, see entries
    E("(s) => { const d = document.querySelector(s + ' details[data-unk-fold]'); if (d) d.open = true; }", box); pg.wait_for_timeout(200)
    rows = alltxt(box + " [data-unk-row]")
    ok(len(rows) == 9, "2. expanded: one row a ledger (%d)" % len(rows))
    ok(any(r.startswith("INPUT IGST") and "94 entries" in r for r in rows) and any(r.startswith("Provision for Tax") and "1 entry" in r for r in rows), "2. each row: the ledger and its entry count")
    pg.click(box + ' [data-unk-see="UFLEX Limited"]'); pg.wait_for_timeout(300)
    ents = alltxt(box + ' [data-unk-entries="UFLEX Limited"] li')
    ok(len(ents) == 4 and all("GBTS2627-" in e for e in ents), "2. see entries: that ledger's 4 entries (%s)" % ents[:2])
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "after-books-open-1440.png"))
    # ---------- 3. no 2.3.1
    ok("2.3.1" not in pg.inner_text("#app"), "3. no '2.3.1' on the page")
    # ---------- 4. the action and its reason while paused
    why = alltxt(box + " [data-unk-why]")
    ok(why and "paused on NWS144" in why[0] and "Resume background reading" in why[0] and "still" in why[0], "4. paused: the plain reason, and that the read still goes once (%s)" % why)
    ok(E("(s) => { const b = document.querySelector(s + ' [data-unk-read]'); return !!b && !b.disabled && b.innerText.trim(); }", box) == "Read the ledgers now", "4. Read the ledgers now, enabled")
    E("() => { window.__rpc.length = 0; }")
    pg.click(box + " [data-unk-read]"); pg.wait_for_timeout(600)
    calls = [c for c in E("window.__rpc") if c[0] == "tally_want_update"]
    ok(len(calls) == 1 and calls[0][1].get("p_client") == cid, "4. asks through the existing Update now (tally_want_update for the client) (%s)" % calls)
    prog = alltxt(box + " [data-unk-progress]")
    ok(prog and "Asked NWS144" in prog[0], "4. progress shown (%s)" % prog)
    # ---------- 1b. Books -> Ledgers: one line in Please check; Sync activity: none; the bell: one item, a count
    E("() => { S.booksTab = 'ledgers'; render(); }"); pg.wait_for_timeout(800)
    led = alltxt('#app [data-led-check] [data-led-line="unknown"]')
    ok(len(led) == 1 and "9 ledgers used in Tally are not in FinCom yet" in led[0], "1. Books -> Ledgers: one line in Please check (%d)" % len(led))
    ok(E("() => document.querySelectorAll('#app [data-unknown-ledgers]').length") == 1, "1. Books -> Ledgers: not repeated above the page")
    bell = bellunk()
    ok(len(bell) == 1 and "9 ledgers" in bell[0] and "INPUT" not in bell[0], "1. the bell: one item for the client, the count only (%s)" % bell)
    E("() => { navHome('tally'); S.tallyTab = 'activity'; render(); }"); pg.wait_for_timeout(1200)
    ok(E("() => document.querySelectorAll('#app [data-unknown-ledgers], #app [data-unknown-ledger]').length") == 0, "1. Sync activity: not listed there")
    E("(id) => { Rec.openClientTab(id, 'books:mis'); }", cid); pg.wait_for_timeout(1000)
    E("() => { S.booksTab = 'mis'; render(); }"); pg.wait_for_timeout(500)
    # ---------- 5a. confirmed on the ledgers page: gone at once
    E("() => { const b = S.books; b.map['Provision for Tax'] = Object.assign(b.map['Provision for Tax'] || {n: 1}, {what: 'none', ok: true, okBy: 'anshul', okAt: new Date().toISOString()}); render(); }"); pg.wait_for_timeout(400)
    head = alltxt(box + " [data-unk-head]")
    ok(head and head[0].startswith("8 ledgers used in Tally"), "5a. a ledger confirmed: gone from the line at once (%s)" % head)
    # ---------- 5b. arriving under Tally's other capitals / spaces
    E("() => { window.__ledRows.push({name: 'Input CGST', parent: 'Duties & Taxes'}, {name: 'UFLEX  LIMITED', parent: 'Sundry Creditors'}, {name: 'Purchase@18%', parent: 'Purchase Accounts'}); }")
    E(RELOAD); pg.wait_for_timeout(400)
    head = alltxt(box + " [data-unk-head]")
    ok(head and head[0].startswith("5 ledgers used in Tally"), "5b. INPUT CGST, UFLEX Limited, PURCHASE @18%% arrive as Input CGST, UFLEX  LIMITED, Purchase@18%%: gone (%s)" % head)
    # ---------- 5c. renamed in Tally (migration 59's alias)
    E("""() => { window.__ledRows.push({name: 'SNV AVIATION PRIVATE LIMITED', parent: 'Sundry Creditors'});
      const ra = TCloud.restAll; TCloud.restAll = async (u) => /^tally_ledger_aliases/.test(u) ? [{tally_name: 'SNV AVIATION PRIVATE LIMITED Delhi', fincom_name: 'SNV AVIATION PRIVATE LIMITED'}] : ra(u); }""")
    E(RELOAD); pg.wait_for_timeout(400)
    head = alltxt(box + " [data-unk-head]")
    ok(head and head[0].startswith("4 ledgers used in Tally"), "5c. a ledger renamed in Tally (alias, same GUID): gone (%s)" % head)
    # ---------- 6. the reasons it cannot run now
    E("() => { Rec.unkAsk = {}; }")
    for st, word in [("stopped", "stopped"), ("offline", "offline"), ("closed", "not open")]:
        E(DEV, [cid, co, False, st]); pg.wait_for_timeout(300)
        why = alltxt(box + " [data-unk-why]")
        dis = E("(s) => { const b = document.querySelector(s + ' [data-unk-read]'); return !!b && b.disabled; }", box)
        ok(dis and why and word in why[0] and "NWS144" in why[0], "6. %s: cannot run now, says why (%s)" % (st, why))
    E(DEV, [cid, co, True, "open"])
    # ---------- 5d. every ledger arrives: nothing anywhere
    E("() => { ['GST Payable', 'Input IGST', 'Input SGST', 'Output IGST 18%'].forEach(n => window.__ledRows.push({name: n, parent: 'Duties & Taxes'})); }")
    E(RELOAD); pg.wait_for_timeout(400)
    ok(E("() => document.querySelectorAll('#app [data-unknown-ledgers]').length") == 0, "5d. every ledger settled: the line is gone by itself")
    ok(len(bellunk()) == 0, "5d. the bell's item gone too")
    E("() => { S.booksTab = 'ledgers'; render(); }"); pg.wait_for_timeout(500)
    ok(E("() => document.querySelectorAll('#app [data-led-line=\"unknown\"]').length") == 0, "5d. Books -> Ledgers: gone")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close(); srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
