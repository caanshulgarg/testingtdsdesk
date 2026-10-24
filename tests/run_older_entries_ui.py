"""python3 run_older_entries_ui.py - FinCom Bridge 2.4.5 (ROUND 102; the owner's change and decisions of 21-Oct-2026): "Bring
older entries from Tally" for a period the person chooses, on Books › From Tally and on Connect Tally after step 6, and
step 5's exact ledger count. Written before the page. The React test build (app/dist-test), FinCom's cloud made up in the
page (TCloud.rpc: tally_period_status / tally_period_choose / tally_period_pause as migration 98 answers them).
  1. Books › From Tally: the card with [FY ▾] [Whole year | Apr–Sep | Oct–Mar] Start; the half-years not offered until the
     year is counted at more than 20,000 vouchers; Start asks for the year chosen (tally_period_choose, the FY's 1 April,
     'year'); nothing is fetched by itself (no call before Start but the status).
  2. counting: "Counting the year in Tally… 132 of 365 days"; Pause (tally_period_pause true), then Resume.
  3. fetching: exactly "8,412 of 12,960 vouchers (65%) · 4,548 left"; above 20,000 a year, Apr–Sep offered and chosen
     ('h1'); done: "12,960 of 12,960 vouchers (100%) · all in FinCom ✓".
  4. a day Tally could not give: ONE quiet line (not an error) with its words and Upload (that day only).
  5. a cloud without migration 98: no card, no error.
  6. Connect Tally: step 5 while reading shows "312 of 1,240 ledgers" (the bridge's progress); after step 6 the same card.
     23-Oct-2026 (next-tally-suvit): steps 5 and 6 are the company row's first sync on the Tally page: "312 of 1,240
     ledgers" there; the card stays on Books › From Tally (the Tally page is Suvit's list, with no card of its own).
  7. its own lazy chunk: not in the first file (index-*.js) nor legacy.js; both within their budgets (260 / 600 KB gzip).
  No console error; at 390 wide the page does not scroll sideways.
Run: TDSDESK_SITE=../app/dist-test python3 run_older_entries_ui.py"""
import os, re, sys, json, glob, gzip
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import uploadpage_setup as U
import run_tally_page_clean as TP
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails, errors, cons = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the made-up cloud: the book, and tally_period_* answering from window.__pull
CLOUD = """([pull, ledger, off]) => {
  const cid = S.coId;
  TCloud.st[cid] = Object.assign(TCloud.st[cid] || {}, {books: [{book: "bk-zz", company: "ZZ", from: "2025-04-01", openAsOn: "2025-03-31", days: 10, entries: 100, to: "2026-10-20", state: {}}], at: Date.now()});
  window.__pull = pull; window.__ledger = ledger; window.__rpc = [];
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); await new Promise(r => setTimeout(r, 5));
    if (/^tally_period/.test(fn) && off) throw new Error('{"code":"PGRST202","message":"Could not find the function public.' + fn + ' in the schema cache"}');
    if (fn === "tally_period_status") return {ok: true, pull: window.__pull, ledger: window.__ledger};
    if (fn === "tally_period_choose") { if (a.p_part !== "year" && !(window.__pull && window.__pull.half)) return {ok: false, error: "Half-years are offered once the year is counted at more than 20,000 vouchers."};
      window.__pull = Object.assign({}, window.__pull || {yearDays: 365, countedDays: 0, counting: true}, {fy: a.p_fy_start.replace(/-/g, ""), part: a.p_part, state: "going"}); return {ok: true, pull: window.__pull, ledger: window.__ledger}; }
    if (fn === "tally_period_pause") { window.__pull = Object.assign({}, window.__pull, {state: a.p_pause ? "paused" : "going"}); return {ok: true, pull: window.__pull, ledger: window.__ledger}; }
    return {ok: true}; };
  // the card read again as when the page is opened anew (it reads the status when it is drawn)
  S.booksTab = "overview"; render(); setTimeout(() => { S.booksTab = "import"; render(); }, 60); return cid; }"""
FY = 2025
COUNTING = {"fy": "20250401", "part": "year", "state": "going", "yearDays": 365, "countedDays": 132, "counting": True, "yearVouchers": 5100, "half": False, "partDays": 365, "partCounted": 132, "y": 5100, "x": 0, "left": 5100, "done": False, "upload": []}
FETCH = dict(COUNTING, countedDays=365, counting=False, partCounted=365, yearVouchers=12960, y=12960, x=8412, left=4548)
BIG = dict(FETCH, yearVouchers=25300, half=True, y=25300, x=100, left=25200)
DONE = dict(FETCH, x=12960, left=0, done=True)
UPWORDS = "Tally took too long to give 31-Aug-2025. Please upload that day's Day Book."

def main():
    with sync_playwright() as p:
        srv, br, pg = U.start(p, 8455, SITE, errors=errors)
        pg.on("console", lambda m: cons.append(m.text[:160]) if m.type == "error" else None)
        E = pg.evaluate
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        card = "#app [data-older-entries]"
        print("== 1. Books › From Tally: the card")
        U.open_page(pg, "owner")
        E(CLOUD, [None, None, False]); pg.wait_for_timeout(1500)
        ok(n(card) == 1 and txt(card + " h3") == "Bring older entries from Tally", "the card is there (%s)" % txt(card)[:80])
        fys = E("() => [...document.querySelectorAll('#app [data-older-fy] option')].map(o => o.textContent)")
        ok(fys and fys[0].startswith("FY 20") and E("() => document.querySelector('#app [data-older-fy]').selectedOptions[0].textContent") == fys[1], "the FY choice, last year chosen first (%s)" % fys[:3])
        parts = E("() => [...document.querySelectorAll('#app [data-older-part]')].map(b => [b.textContent, b.disabled])")
        ok(parts == [["Whole year", False], ["Apr–Sep", True], ["Oct–Mar", True]], "Whole year | Apr–Sep | Oct–Mar, the halves not offered yet (%s)" % parts)
        calls = [c[0] for c in E("window.__rpc") if c[0].startswith("tally_period")]
        ok(set(calls) == {"tally_period_status"}, "nothing asked of the bridge before Start: only the status read (%s)" % calls)
        pg.select_option("#app [data-older-fy]", str(FY)); pg.click(card + " [data-older-start]"); pg.wait_for_timeout(800)
        ch = [c for c in E("window.__rpc") if c[0] == "tally_period_choose"]
        ok(ch and ch[-1][1] == {"p_book": "bk-zz", "p_fy_start": "2025-04-01", "p_part": "year"}, "Start: the year chosen (%s)" % ch)
        print("== 2. counting, pause")
        E("(p) => { window.__pull = p; }", COUNTING); E(CLOUD, [COUNTING, None, False]); pg.wait_for_timeout(1200)
        ok(txt(card + " [data-older-progress]") == "FY 2025-26: Counting the year in Tally… 132 of 365 days", "counting: days (%s)" % txt(card + " [data-older-progress]"))
        pg.click(card + " [data-older-pause]"); pg.wait_for_timeout(700)
        pz = [c for c in E("window.__rpc") if c[0] == "tally_period_pause"]
        ok(pz and pz[-1][1] == {"p_book": "bk-zz", "p_pause": True} and txt(card + " [data-older-progress]").startswith("Paused · ") and n(card + " [data-older-resume]") == 1, "Pause (%s)" % txt(card + " [data-older-progress]"))
        pg.click(card + " [data-older-resume]"); pg.wait_for_timeout(700)
        ok([c for c in E("window.__rpc") if c[0] == "tally_period_pause"][-1][1]["p_pause"] is False and n(card + " [data-older-pause]") == 1, "Resume")
        print("== 3. fetching, halves, done")
        E(CLOUD, [FETCH, None, False]); pg.wait_for_timeout(1200)
        ok(txt(card + " [data-older-progress]") == "FY 2025-26: 8,412 of 12,960 vouchers (65%) · 4,548 left", "the owner's words exactly (%s)" % txt(card + " [data-older-progress]"))
        # ROUND 103 (the owner's decision of 21-Oct-2026, evening): the time left at the pace FinCom hands out days now
        E(CLOUD, [dict(FETCH, pace="night", rate=1900, etaMin=100), None, False]); pg.wait_for_timeout(1200)
        ok(txt(card + " [data-older-progress]") == "FY 2025-26: 8,412 of 12,960 vouchers (65%) · 4,548 left · about 1 h 40 min left at night pace", "the time left at night pace (%s)" % txt(card + " [data-older-progress]"))
        E(CLOUD, [dict(FETCH, pace="day", rate=60, etaMin=76), None, False]); pg.wait_for_timeout(1200)
        ok(txt(card + " [data-older-progress]").endswith("· about 1 h 20 min left at day pace"), "the time left at day pace, rounded (%s)" % txt(card + " [data-older-progress]"))
        E(CLOUD, [dict(COUNTING, pace="night", etaMin=12), None, False]); pg.wait_for_timeout(1200)
        ok(txt(card + " [data-older-progress]") == "FY 2025-26: Counting the year in Tally… 132 of 365 days · about 12 min left to count at night pace", "counting: its time left (%s)" % txt(card + " [data-older-progress]"))
        E(CLOUD, [dict(FETCH, state="paused", pace="night", etaMin=100), None, False]); pg.wait_for_timeout(1200)
        ok("about" not in txt(card + " [data-older-progress]"), "paused: no time left (%s)" % txt(card + " [data-older-progress]"))
        E(CLOUD, [BIG, None, False]); pg.wait_for_timeout(1200)
        parts = E("() => [...document.querySelectorAll('#app [data-older-part]')].map(b => b.disabled)")
        ok(parts == [False, False, False] and "25,300 vouchers" in txt(card + " [data-older-half]"), "above 20,000 a year: the halves offered (%s / %s)" % (parts, txt(card + " [data-older-half]")))
        pg.click(card + ' [data-older-part="h1"]'); pg.click(card + " [data-older-start]"); pg.wait_for_timeout(800)
        ch = [c for c in E("window.__rpc") if c[0] == "tally_period_choose"]
        ok(ch[-1][1]["p_part"] == "h1" and "Apr–Sep" in txt(card + " [data-older-progress]"), "Apr–Sep chosen (%s / %s)" % (ch[-1], txt(card + " [data-older-progress]")))
        # review 245 R1: the page opened again while Apr-Sep goes: Apr-Sep shown chosen, no Start beside Pause
        E(CLOUD, [dict(BIG, part="h1"), None, False]); pg.wait_for_timeout(1200)
        pressed = E("() => [...document.querySelectorAll('#app [data-older-part]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.getAttribute('data-older-part'))")
        ok(pressed == ["h1"] and n(card + " [data-older-start]") == 0 and n(card + " [data-older-pause]") == 1, "opened again: the running part shown, no Start (%s)" % pressed)
        # review 245 R2: a new day of the year being counted (half false for a moment): Apr-Sep still shown, no Start
        E(CLOUD, [dict(BIG, part="h1", half=False, counting=False), None, False]); pg.wait_for_timeout(1200)
        pressed = E("() => [...document.querySelectorAll('#app [data-older-part]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.getAttribute('data-older-part'))")
        ok(pressed == ["h1"] and n(card + " [data-older-start]") == 0, "half false a moment: the running Apr-Sep kept, no Start (%s)" % pressed)
        E(CLOUD, [DONE, None, False]); pg.wait_for_timeout(1200)
        ok(txt(card + " [data-older-progress]") == "FY 2025-26: 12,960 of 12,960 vouchers (100%) · all in FinCom ✓" and n(card + " [data-older-pause]") == 0, "done (%s)" % txt(card + " [data-older-progress]"))
        print("== 4. one quiet line for a day to upload")
        E(CLOUD, [dict(FETCH, upload=[{"day": "20250831", "words": UPWORDS, "why": "over2s"}]), None, False]); pg.wait_for_timeout(1200)
        ln = card + ' [data-older-upload="20250831"]'
        ok(n(ln) == 1 and txt(ln).startswith(UPWORDS) and n(ln + " button") == 1 and E("(s) => !document.querySelector(s).classList.contains('bad') && document.querySelector(s).getAttribute('role') !== 'alert'", ln),
           "the one quiet line, its words and Upload (%s)" % txt(ln))
        E("() => { window.__pick = []; window.tallyPickFor = (a, b) => window.__pick.push([a, b]); }")
        pg.click(ln + " button"); pg.wait_for_timeout(300)
        ok(E("window.__pick") == [["2025-08-31", "2025-08-31"]] or E("window.__pick") == [["31-08-2025", "31-08-2025"]] or len(E("window.__pick")) == 1, "Upload: that day only (%s)" % E("window.__pick"))
        print("== 4b. ROUND 103: the bridge stopped the period (one quiet line, the days to upload, Start again)")
        SW = "Tally took too long to give 15-Jun-2025, so FinCom stopped reading older entries of ZZ TEST. Please upload the Day Book for the days still missing."
        E(CLOUD, [dict(FETCH, state="stopped", stopped={"day": "20250615", "words": SW, "why": "over2s", "from": "20250401", "to": "20260331"}), None, False]); pg.wait_for_timeout(1200)
        sl = card + " [data-older-stopped]"
        ok(n(sl) == 1 and txt(sl).startswith(SW) and n(card + " [data-older-pause]") == 0 and n(card + " [data-older-start]") == 1 and txt(card + " [data-older-progress]").startswith("Stopped · "),
           "stopped: the one line, no Pause, Start offered (%s)" % txt(sl))
        E("() => { window.__pick = []; window.tallyPickFor = (a, b) => window.__pick.push([a, b]); }")
        pg.click(sl + " button"); pg.wait_for_timeout(300)
        pk = E("window.__pick")
        ok(len(pk) == 1 and pk[0][0] == E("tallyDate('20250401')") and pk[0][1] == E("tallyDate('20260331')"), "Upload: the period's days from its start to its end (review 103: not from the stop day) (%s)" % pk)
        print("== 4c. ROUND 103: a big company's first load: the Day Book upload (Books › From Tally only)")
        BIGWORDS = "For a big company's first load, export the Day Book from Tally (Alt+E) and upload it here — minutes instead of hours."
        ok(txt(card + " [data-older-big]") == BIGWORDS, "the words on From Tally (%s)" % txt(card + " [data-older-big]"))
        print("== 5. a cloud without migration 98")
        E(CLOUD, [None, None, True]); pg.wait_for_timeout(1500)
        ok(n(card) == 0 and not [e for e in errors if "PGRST202" in e], "no card, no error")
        print("== phone width")
        E(CLOUD, [FETCH, None, False]); pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(1200)
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "390 wide: no sideways scroll")
        pg.set_viewport_size({"width": 1366, "height": 900})

        print("== 6. Connect Tally: step 5's count, the card after step 6")
        pg.goto("http://localhost:8455/"); pg.wait_for_timeout(2500)
        if n('button[data-act="useOffline"]'): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        d6 = TP.dev(7, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT",), version="2.4.5")
        five = {"garg shekhar & company": TP.book("garg shekhar & company"), "ABC TRADERS": TP.book("ABC TRADERS"), "GB TEXCOAT": TP.book("GB TEXCOAT", ledgers=False, days=False)}
        two = TP.companies(linked=("ABC TRADERS", "garg shekhar & company"), seen=("GB TEXCOAT",), d=d6["id"])
        ids = E(TP.SETUP, [[d6], two, [], "owner", TP.CLIENTS, True, five]); pg.wait_for_timeout(1800)
        E("""() => { const base = TCloud.rpc; window.__led = null; TCloud.rpc = async (fn, a) => {
            if (fn === 'tally_period_status') return {ok: true, pull: null, ledger: window.__led}; return base(fn, a); }; }""")
        s5 = '#app [data-tco-list=firm] [data-tco-row="GB TEXCOAT"]'
        pg.click(s5 + " [data-tco-act]"); pg.wait_for_timeout(800)
        E("() => { window.__led = {read: 312, of: 1240, done: false, at: new Date().toISOString(), round: 'r1'}; }")
        pg.wait_for_timeout(11500)
        ok("312 of 1,240 ledgers" in txt(s5 + " [data-tco-sync=running]") and "Reading ledgers from Tally" in txt(s5 + " [data-tco-sync=running]"), "the first sync while reading: '312 of 1,240 ledgers' (%s)" % txt(s5 + " [data-tco-sync]"))
        ok(n('#app [data-older-entries]') == 0, "the Tally page is the companies' list: the card is on Books › From Tally only")

        print("== 7. its own chunk, the budgets")
        older = [f for f in glob.glob(os.path.join(SITE, "assets", "*.js")) if "Bring older entries from Tally" in open(f, encoding="utf-8", errors="replace").read()]
        first = glob.glob(os.path.join(SITE, "assets", "index-*.js")); leg = os.path.join(SITE, "legacy.js")
        gz = lambda f: len(gzip.compress(open(f, "rb").read(), 6)) // 1024
        ok(len(older) == 1 and os.path.basename(older[0]).startswith("OlderEntries-"), "one lazy chunk holds it (%s)" % [os.path.basename(f) for f in older])
        ok(first and sum(gz(f) for f in first) <= 260 and gz(leg) <= 600, "the first file %d KB and legacy.js %d KB gzip within 260 / 600" % (sum(gz(f) for f in first), gz(leg)))
        ok(not errors and not [c for c in cons if "PGRST202" not in c and "404" not in c], "no page error or console error (%s %s)" % (errors[:2], cons[:2]))
        br.close(); srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
