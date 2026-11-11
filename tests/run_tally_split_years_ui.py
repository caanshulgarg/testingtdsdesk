"""python3 run_tally_split_years_ui.py - next-split-years (migration 161): the Tally page's link chooser offers a client's
EARLIER-YEARS company (a split Tally: the same business cut into two Tally companies by date, one Tally GUID). Made-up
firm (run_tally_page_clean.py's stand-in cloud; nothing real is changed): the client ZZ Split Pvt Ltd linked to
"ZZ SPLIT PVT LTD - (from 1-Apr-25)"; "ZZ SPLIT PVT LTD - (from 1-Apr-2021)" open in Tally, not linked, the same GUID.
  1. the earlier company's row, the client chosen: "Current company" / "Earlier years (a split Tally), ending on" with
     Earlier years chosen first (one GUID) and the day 31-Mar-2025 (from the current company's name); Link sends ONE
     tally_split_link (the company, the client, the day), never tally_company_link
  2. "Current company" chosen instead: the usual link (tally_company_link), as before
  3. linked as earlier years: its row says "Earlier years · until 31-Mar-2025 (a split Tally)", has no Sync now / Post
     here, and "Unlink earlier years" (asked once) sends tally_split_unlink with its book
  4. a client with one company: no earlier-years choice in the picker
  5. Books › From Tally, Bring books from Tally: the years of both companies; an earlier year chosen stays chosen and Start
     asks it of the earlier company's book; a later year of the current company's
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_split_years_ui.py"""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8473 + 1161
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CLIENT, CUR, EARLY, LONE = "ZZ Split Pvt Ltd", "ZZ SPLIT PVT LTD - (from 1-Apr-25)", "ZZ SPLIT PVT LTD - (from 1-Apr-2021)", "GB TEXCOAT"
GUID = "c9000000-0000-4000-8000-000000000161"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    d = T.dev(7, "NWS144", "anshul", tally="open", opened=(CUR, EARLY, LONE), version="2.5.12", rec=(CUR,),
              cos=[{"name": n, "guid": g, "open": True, "phase": "live", "waiting": 0, "lastRead": "ago:30"} for n, g in ((CUR, GUID), (EARLY, GUID), (LONE, "g-lone-161"))])
    cos = [{"company": CUR, "client_id": "NAME:" + CLIENT, "device_id": d["id"], "gstin": "", "last_seen": "ago:1", "book_id": "b-cur"},
           {"company": EARLY, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:1", "book_id": "b-early"},
           {"company": LONE, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:1", "book_id": "b-lone"}]
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(5000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        calls = lambda fn: [c[1] for c in E("window.__calls") if c[0] == fn]
        def confirm(yes):
            sel = '#confirmBox [data-cbx="%s"]' % ("yes" if yes else "no")
            pg.wait_for_selector(sel, state="visible", timeout=10000); body = txt("#confirmBox"); pg.click(sel)
            pg.wait_for_selector(sel, state="hidden", timeout=10000); pg.wait_for_timeout(500); return body
        def scene():
            ids = E(T.SETUP, [[d], cos, [], "owner", [CLIENT, "Other Pvt Ltd"], True, {}])
            pg.wait_for_timeout(1800); return ids
        R = lambda co: '#app [data-tco-list=firm] [data-tco-row="%s"]' % co
        try:
            print("== 1. the earlier company's row: Earlier years offered, chosen first")
            ids = scene(); cid = ids[CLIENT]
            pk = R(EARLY) + " select[data-tco-act=pick]"
            ok(n(pk) == 1, "the earlier company's row has its picker (%s)" % txt(R(EARLY))[:160])
            pg.select_option(pk, cid); pg.wait_for_timeout(600)
            box = R(EARLY) + " [data-tco-split-pick]"
            ok(n(box) == 1, "the client chosen: how it is the client's is asked (%s)" % txt(R(EARLY))[:240])
            ok(pg.is_checked(box + " [data-tco-split-as=early]") and pg.input_value(box + " [data-tco-split-ends]") == "2025-03-31",
               "Earlier years chosen first (one Tally GUID), ending on 31-Mar-2025 from the current company's name (%s)" % (pg.input_value(box + " [data-tco-split-ends]") if n(box) else None))
            ok("posted only into " + CUR in txt(box), "it says postings go only into the current company (%s)" % txt(box))
            E("() => { window.__calls = []; }")
            pg.click(R(EARLY) + " [data-tco-relink]"); pg.wait_for_timeout(1500)
            ok(calls("tally_split_link") == [{"p_company": EARLY, "p_client": cid, "p_ends": "2025-03-31"}] and not [x for x in calls("tally_company_link") if x.get("p_client")],
               "Link: ONE tally_split_link, no usual link (%s)" % E("window.__calls")[:4])

            print("== 2. Current company chosen instead: the usual link")
            ids = scene(); cid = ids[CLIENT]
            pg.select_option(pk, cid); pg.wait_for_timeout(600)
            pg.check(box + " [data-tco-split-as=current]"); E("() => { window.__calls = []; }")
            pg.click(R(EARLY) + " [data-tco-relink]"); pg.wait_for_timeout(800)
            if n("#confirmBox [data-cbx=yes]:visible"): confirm(True)
            pg.wait_for_timeout(1200)
            ok(not calls("tally_split_link") and {"p_company": EARLY, "p_client": cid} in calls("tally_company_link"), "the usual link, as before (%s)" % E("window.__calls")[:4])

            print("== 3. linked as earlier years: its row, and Unlink earlier years")
            ids = scene(); cid = ids[CLIENT]
            E("""(a) => { window.__companies.forEach(c => { if (c.company === a.e) c.client_id = a.cid; });
              TCloud.st[a.cid] = Object.assign(TCloud.st[a.cid] || {}, {split: {book: 'b-early', company: a.e, ends: '20250331', from: '20210401', currentBook: 'b-cur', currentCompany: a.c, curFrom: '20250401', live: true, version: 1}, splitAt: Date.now(), at: Date.now()});
              TLight.st.cos = window.__companies; TCloud.splitLoad = async (id) => (TCloud.st[id] || {}).split || null; render(); }""", {"e": EARLY, "c": CUR, "cid": cid})
            pg.wait_for_timeout(1500)
            row = txt(R(EARLY))
            ok("Earlier years" in row and "until 31-Mar-2025" in row and "a split Tally" in row, "its row: Earlier years · until 31-Mar-2025 (a split Tally) (%s)" % row[:240])
            ok(n(R(EARLY) + " [data-tco-sync-now]") == 0 and n(R(EARLY) + " [data-tco-post-here]") == 0, "no Sync now, no Post entries here on it")
            ok(n(R(CUR) + " [data-tco-sync-now]") == 1, "the current company's row as before")
            E("() => { window.__calls = []; }")
            pg.click(R(EARLY) + " [data-tco-split-unlink]"); body = confirm(True); pg.wait_for_timeout(1200)
            ok(CUR in body and "Nothing in Tally changes" in body, "asked once, naming the current company kept (%s)" % body[:200])
            ok(calls("tally_split_unlink") == [{"p_book": "b-early"}] and not calls("tally_company_link"), "Unlink earlier years: tally_split_unlink with its book (%s)" % E("window.__calls")[:4])

            print("== 4. a client with one company: no earlier-years choice")
            ids = scene()
            pk2 = R(LONE) + " select[data-tco-act=pick]"
            pg.select_option(pk2, ids["Other Pvt Ltd"]); pg.wait_for_timeout(600)
            ok(n(R(LONE) + " [data-tco-split-pick]") == 0, "no choice for a client with no company linked")
            print("== 5. Bring books from Tally: an earlier year is kept and brought from the earlier company (the review's finding 2)")
            ids = scene(); cid = ids[CLIENT]
            E("""(a) => { const sum = [{book: 'b-cur', client: a.cid, company: a.c, from: '2025-04-01', devices: [{id: 'dv', fetchOn: true}]},
                                     {book: 'b-early', client: a.cid, company: a.e, from: '2021-04-01', devices: [{id: 'dv', fetchOn: true}]}];
              const st = {split: {book: 'b-early', company: a.e, ends: '20250331', from: '20210401', currentBook: 'b-cur', currentCompany: a.c, curFrom: '20250401', live: true, version: 1}, splitAt: Date.now(), at: Date.now(),
                books: [{book: 'b-cur', company: a.c, from: '2025-04-01', to: '2026-01-31', days: 30, entries: 300}, {book: 'b-early', company: a.e, from: '2021-04-01', to: '2025-03-31', days: 300, entries: 3000}]};
              TCloud.splitLoad = async (id) => (TCloud.st[id] || {}).split || null;
              const rpc = TCloud.rpc; TCloud.rpc = async (fn, x) => { if (fn === 'tally_fetch_summary') { window.__calls.push([fn, x]); return {ok: true, books: sum}; }
                if (fn === 'tally_status') { window.__calls.push([fn, x]); Object.assign(TCloud.st[a.cid] = TCloud.st[a.cid] || {}, st); return st.books; } return rpc(fn, x); };
              Object.assign(TCloud.st[a.cid] = TCloud.st[a.cid] || {}, st);
              location.hash = '#/c/' + encodeURIComponent(a.cid) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); }""", {"e": EARLY, "c": CUR, "cid": cid})
            pg.wait_for_timeout(4000)
            E("() => { if (window.tfxRefresh) window.tfxRefresh(); }"); pg.wait_for_timeout(1500); E("() => render()"); pg.wait_for_timeout(1500)
            fysel = "#app [data-older-fy]"
            ok(n(fysel) == 1, "Bring books from Tally is on the page (%s)" % txt("#app")[:200])
            opts = E("(s) => { const e = document.querySelector(s); return e ? [...e.options].map(o => [o.value, o.getAttribute('data-older-fy-book'), o.textContent]) : []; }", fysel)
            ok(any(o[0] == "2023" and o[1] == "early" and EARLY in o[2] for o in opts) and any(o[1] == "current" for o in opts) and not any(o[0] == "2024" and o[1] == "current" for o in opts),
               "the years of both companies, each said with its company (%s)" % [o[0] + ":" + str(o[1]) for o in opts])
            pg.select_option(fysel, "2023"); pg.wait_for_timeout(1500)
            ok(pg.input_value(fysel) == "2023", "FY 2023-24 chosen stays chosen (it moves the picker to the earlier company's book) (%s)" % pg.input_value(fysel))
            E("() => { window.__calls = []; }")
            pg.click("#app [data-older-start]"); pg.wait_for_timeout(1500)
            ch = [c[1] for c in E("window.__calls") if c[0] in ("tally_period_choose_lean", "tally_period_choose")]
            ok(ch[:1] == [{"p_book": "b-early", "p_fy_start": "2023-04-01", "p_part": "year"}], "Start: FY 2023-24 asked of the earlier company's book (%s)" % ch)
            pg.select_option(fysel, "2025"); pg.wait_for_timeout(1500); E("() => { window.__calls = []; }")
            if n("#app [data-older-start]"): pg.click("#app [data-older-start]"); pg.wait_for_timeout(1500)
            ch = [c[1] for c in E("window.__calls") if c[0] in ("tally_period_choose_lean", "tally_period_choose")]
            ok(pg.input_value(fysel) == "2025" and ch[:1] == [{"p_book": "b-cur", "p_fy_start": "2025-04-01", "p_part": "year"}], "FY 2025-26: asked of the current company's book (%s)" % ch)
        except Exception as e:
            ok(False, "the steps ran through (%s)" % str(e).split("\n")[0])
        ok(not errors, "no page errors %s" % errors[:2])
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
