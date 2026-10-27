"""python3 run_older_entries_ui.py - older entries come ONLY by uploading Tally's Day Book file, never fetched
automatically (the owner's decision of 26-Oct-2026; was ROUND 102/103's "Bring older entries from Tally" card and the
per-computer "Reading older entries" switch). The React test build (app/dist-test):
  1. Books › From Tally: no "Bring older entries from Tally" card and none of its words; ONE plain line above the upload:
     "Older entries: in Tally open Day Book, choose the period (F2), Alt+E → Export as XML, then drop the file here.";
     nothing asks the cloud to fetch a period (no tally_period_choose / tally_period_pause).
  2. Connect Tally: the ledgers still come by themselves (the first sync's bar: "312 of 1,240"); no older-entries card on
     the Tally page.
  3. The build: no file holds the card's words, no OlderEntries chunk; the first file and legacy.js within their budgets
     (260 / 600 KB gzip).
  No console error; at 390 wide the page does not scroll sideways.
Run: TDSDESK_SITE=../app/dist-test python3 run_older_entries_ui.py"""
import os, re, sys, json, glob, gzip
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import uploadpage_setup as U
import run_tally_page_clean as TP
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
fails, errors, cons = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LINE = "Older entries: in Tally open Day Book, choose the period (F2), Alt+E → Export as XML, then drop the file here."
GONE = ["Bring older entries from Tally", "Counting the year in Tally", "Whole year", "Reading older entries", "outside office hours", "Old-days test"]

def main():
    with sync_playwright() as p:
        srv, br, pg = U.start(p, 8455, SITE, errors=errors)
        pg.on("console", lambda m: cons.append(m.text[:160]) if m.type == "error" else None)
        E = pg.evaluate
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        print("== 1. Books › From Tally: the upload is the one way")
        U.open_page(pg, "owner")
        E("""() => { const cid = S.coId; TCloud.st[cid] = Object.assign(TCloud.st[cid] || {}, {books: [{book: "bk-zz", company: "ZZ", from: "2025-04-01", openAsOn: "2025-03-31", days: 10, entries: 100, to: "2026-10-20", ledgersAt: new Date().toISOString(), state: {}}], at: Date.now()});
            S.booksTab = "overview"; render(); setTimeout(() => { S.booksTab = "import"; render(); }, 60); }"""); pg.wait_for_timeout(1500)
        body = pg.inner_text("#app")
        ok(n("#app [data-older-entries]") == 0 and not [w for w in GONE if w in body], "no older-entries card, none of its words (%s)" % [w for w in GONE if w in body])
        ok(txt("#app [data-up-older]") == LINE, "the one plain line (%s)" % txt("#app [data-up-older]"))
        ok(E("() => { const l = document.querySelector('#app [data-up-older]'), d = document.querySelector('#app [data-up-drop]'); return !!l && !!d && !!(l.compareDocumentPosition(d) & 4); }"), "the line is above the upload drop box")
        calls = [c[0] for c in E("window.__rpc || []") if c[0] in ("tally_period_choose", "tally_period_pause")]
        ok(not calls, "nothing asks the cloud to fetch a period (%s)" % calls)
        pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(600)
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "390 wide: no sideways scroll")
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "from-tally-390.png"), full_page=True)
        pg.set_viewport_size({"width": 1366, "height": 900}); pg.wait_for_timeout(400)
        if SHOTS: pg.screenshot(path=os.path.join(SHOTS, "from-tally-1366.png"), full_page=True)

        print("== 2. Connect Tally: the ledgers still come by themselves")
        pg.goto("http://localhost:8455/"); pg.wait_for_timeout(2500)
        if n('button[data-act="useOffline"]'): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        d6 = TP.dev(7, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), version="2.4.5")
        five = {"garg shekhar & company": TP.book("garg shekhar & company"), "ABC TRADERS": TP.book("ABC TRADERS"), "GB TEXCOAT": TP.book("GB TEXCOAT", ledgers=False, days=False)}
        two = TP.companies(linked=("ABC TRADERS", "garg shekhar & company"), seen=("GB TEXCOAT",), d=d6["id"])
        E(TP.SETUP, [[d6], two, [], "owner", TP.CLIENTS, True, five]); pg.wait_for_timeout(1800)
        E("""() => { const base = TCloud.rpc; window.__led = null; TCloud.rpc = async (fn, a) => {
            if (fn === 'tally_period_status') return {ok: true, pull: null, ledger: window.__led}; return base(fn, a); }; }""")
        s5 = '#app [data-tco-list=firm] [data-tco-row="GB TEXCOAT"]'
        pg.click(s5 + " [data-tco-act]"); pg.wait_for_timeout(800)
        E("() => { window.__led = {read: 312, of: 1240, done: false, at: new Date().toISOString(), round: 'r1'}; }")
        pg.wait_for_timeout(11500)
        ok(txt(s5 + " [data-tco-sync=running]").startswith("Reading ledgers from Tally: 312 of 1,240 (25%)"), "the first sync while reading: '312 of 1,240 (25%%)' (%s)" % txt(s5 + " [data-tco-sync]"))
        ok(n('#app [data-older-entries]') == 0 and "Bring older entries" not in pg.inner_text("#app"), "no older-entries card on the Tally page")

        print("== 3. the build")
        older = [f for f in glob.glob(os.path.join(SITE, "assets", "*.js")) if "Bring older entries from Tally" in open(f, encoding="utf-8", errors="replace").read()]
        first = glob.glob(os.path.join(SITE, "assets", "index-*.js")); leg = os.path.join(SITE, "legacy.js")
        gz = lambda f: len(gzip.compress(open(f, "rb").read(), 6)) // 1024
        ok(not older and not glob.glob(os.path.join(SITE, "assets", "OlderEntries-*.js")), "no file holds the card, no OlderEntries chunk (%s)" % [os.path.basename(f) for f in older])
        ok(first and sum(gz(f) for f in first) <= 260 and gz(leg) <= 600, "the first file %d KB and legacy.js %d KB gzip within 260 / 600" % (sum(gz(f) for f in first), gz(leg)))
        ok(not errors and not [c for c in cons if "PGRST202" not in c and "404" not in c], "no page error or console error (%s %s)" % (errors[:2], cons[:2]))
        br.close(); srv.shutdown()

    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
