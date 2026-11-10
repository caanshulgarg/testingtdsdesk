"""python3 run_tally_filters.py - the Tally page's clients: the owner's approved filter design (next-tally-filters2,
design-filters Main and Phone). Made-up names only.
  1. the bar: search, Filters, Sort (Needs attention first); the state chips with counts (a chip with none off); the
     seven columns, four of them sort buttons; nothing filtered: no tags, no "Showing" line; a client not linked says so
     once; View and Save view in the bar, clear of the sticky Download bar
  2. a chip: Not open in Tally: only that client, "Showing 1 of 4 clients", its tag, Filters 1; the tag removed: all again
  3. the Filters panel: Masters, Entries, Last entry received, In Tally, Tally computer (the computer's name only), each
     choice with its count, none: off; filters add up with the chips; tags, Clear all
  4. search: client, Tally company, the client's GSTIN
  5. sort by each option and by the column heads (aria-sort, a second press the other way)
  6. views: built in, saved (this browser, per firm), applied, removed; a stored view this page cannot use cleaned; no
     firm known: no Save view; with no browser storage: kept for the tab
  7. More ▾ still opens the light row; Less ▴ closes it
  8. a read asked for the client's older Tally company (relinked since): not this link's read
  9. a phone (390): no sideways scroll of the page, the chips scroll, the rows are cards, the panel a bottom sheet with
     Show N clients, a modal dialog (its heading focused, Escape closes it, focus back on Filters, the page held)
"""
import os, re, sys, json, threading, functools, http.server, datetime
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_FILTERS_PORT", "9573"))
SHOT = os.environ.get("TALLY_FILTERS_SHOTS", "")   # a folder: the two screenshots of the design (desktop, phone)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.4.exe", "sha256": "cd" * 32}}
NW = "NW144"
ORBIT, NOVA_C, LARK, KEST = "Orbit Space", "Nova Widgets", "Larkspur & Co", "Kestrel Foods"
ORB, NOVA = "ORBIT SPACE", "NOVA WIDGETS"
GSTIN = "27AAACK1234F1Z5"
PC1, PC2 = "OFFICE-SERVER", "ACCOUNTS-LAPTOP"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2 if SHOT else 1); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        # two computers; the second's name carries its Windows login, as an older bridge sends it: never shown
        o1 = T.dev(5, PC1, "made-up-o1", tally="open", opened=(ORB,), version="2.5.4", rec=(ORB,), beat={"bridgePort": 9101, "windowsUser": NW + "\\made-up-o1"},
                   ports=[{"port": 9041, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        o2 = T.dev(6, PC2 + " · NWDOM\\made-up-o2", "made-up-o2", tally="open", opened=(NOVA,), version="2.5.4", rec=(NOVA,), beat={"bridgePort": 9102, "windowsUser": NW + "\\made-up-o2"},
                   ports=[{"port": 9043, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        c9 = [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": o1["id"], "gstin": "", "last_seen": "ago:0.5"},
              {"company": NOVA, "client_id": "NAME:" + NOVA_C, "device_id": o2["id"], "gstin": "", "last_seen": "ago:0.5"},
              {"company": "LARKSPUR CO", "client_id": "NAME:" + LARK, "device_id": o1["id"], "gstin": "", "last_seen": "ago:3000"}]
        # Larkspur's books in FinCom up to 12 days ago: days to bring, and (its company open nowhere) the Day Book upload
        d12 = (datetime.datetime.utcnow() + datetime.timedelta(hours=5.5) - datetime.timedelta(days=12)).date().isoformat()
        lark = T.book(LARK); lark[0]["to"] = d12
        # and two entries Tally sent that only their day's Day Book settles: its button is Upload Day Book
        hl = [dict(T.held(i, LARK), company="LARKSPUR CO", device_id=o1["id"], pc=PC1) for i in (1, 2)]
        E(T.SETUP, [[o1, o2], c9, hl, "owner", [ORBIT, NOVA_C, LARK, KEST], True, {ORBIT: T.book(ORBIT), NOVA_C: T.book(NOVA_C), LARK: lark}])
        E("""([k, g]) => { const c = Object.values(S.companies).find(x => x.name === k); c.gstin = g; }""", [KEST, GSTIN])
        E("() => { window.__linksApi = false; }"); E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, {}); E(TS.FORGET)
        E("() => { try { Object.keys(localStorage).filter(k => k.startsWith('fincom:tally-views:')).forEach(k => localStorage.removeItem(k)); } catch (e) {} }")
        E(TS.MINE, ["", "", ""]); E("() => { S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
        pg.wait_for_timeout(3500)
        ROWS = "#app [data-tsm-table] tr[data-tsm-row]"
        names = lambda: E("() => [...document.querySelectorAll('#app [data-tsm-table] tr[data-tsm-row]')].map(r => r.getAttribute('data-tsm-row'))")
        chips = lambda: E("() => Object.fromEntries([...document.querySelectorAll('#app [data-tpf-chip]')].map(b => [b.getAttribute('data-tpf-chip'), [Number(b.querySelector('[data-tpf-n]').getAttribute('data-tpf-n')), b.disabled, b.getAttribute('aria-pressed')]]))")
        opts = lambda: E("() => Object.fromEntries([...document.querySelectorAll('#app [data-tpf-opt]')].map(l => { const i = l.querySelector('input'); return [l.getAttribute('data-tpf-opt'), [Number(l.querySelector('[data-tpf-n]').getAttribute('data-tpf-n')), i.disabled, i.checked, l.innerText.replace(/\\s+/g, ' ').trim()]]; }))")
        tags = lambda: E("() => [...document.querySelectorAll('#app [data-tpf-tag]')].map(t => t.innerText.replace(/\\s+/g, ' ').trim())")
        count = lambda: E("() => { const c = document.querySelector('#app [data-tpf-count]'); return c ? Number(c.getAttribute('data-tpf-count')) : 0; }")
        click = lambda sel, ms=450: (pg.click(sel), pg.wait_for_timeout(ms))
        opt = lambda k, ms=450: click("#app [data-tpf-opt='%s'] input" % k, ms)
        sort = lambda v: (pg.select_option("#app select[data-tpf-sort=bar]", v), pg.wait_for_timeout(450))
        aria = lambda: E("() => Object.fromEntries([...document.querySelectorAll('#app [data-tsm-table] thead th[data-tpf-th]')].map(t => [t.getAttribute('data-tpf-th'), t.getAttribute('aria-sort')]))")
        base = names()

        print("== 1. the bar, the chips, the columns")
        ok(n(ROWS) == 4, "1. all 4 clients shown (%s)" % base)
        ok(n("#app [data-tpf] input[data-tsm-q]") == 1 and n("#app [data-tpf-toggle]") == 1 and pg.input_value("#app select[data-tpf-sort=bar]") == "need",
           "1. search, Filters and Sort (Needs attention first)")
        ok(E("() => [...document.querySelectorAll('#app select[data-tpf-sort=bar] option')].map(o => o.textContent)") == ["Needs attention first", "Open in Tally first", "Client name A–Z", "Last entry, newest", "Most days to bring"], "1. the five sorts")
        ch = chips()
        ok(list(ch.keys()) == ["all", "need", "reading", "ok", "open", "away", "free"], "1. the seven chips in order (%s)" % list(ch.keys()))
        ok(txt("#app [data-tpf-chips]") == "All 4 Needs attention 1 Reading now 0 Up to date 2 Open in Tally now 2 Not open in Tally 1 Not linked 1", "1. each chip with its count (%s)" % txt("#app [data-tpf-chips]"))
        ok(ch["reading"][1] and not ch["need"][1] and ch["all"][2] == "true", "1. a chip with none is off; All is on (%s)" % ch)
        heads = E("() => [...document.querySelectorAll('#app [data-tsm-table] thead th')].map(t => t.innerText.trim().toLowerCase())")
        ok(heads == ["client · tally company", "state", "in tally", "masters", "entries", "last entry", "action"], "1. the seven columns (%s)" % heads)
        ok(aria() == {"name": "none", "need": "ascending", "open": "none", "last": "none"}, "1. Client, State, In Tally and Last entry sort; State (needs attention first) on (%s)" % aria())
        ok(n("#app [data-tpf-tags]") == 0 and n("#app [data-tpf-showing]") == 0 and count() == 0, "1. nothing filtered: no tags, no Showing line, no count")
        LR = '#app [data-tsm-table] tr[data-tsm-row="%s"]' % LARK
        ok(n(LR + " td[data-tsm-col=state] [data-tpt-state=away]") == 1 and "is not open in Tally" in txt(LR + " td[data-tsm-col=state]"), "1. the state and what to do in the State cell (%s)" % txt(LR + " td[data-tsm-col=state]")[:160])
        ok(pg.get_attribute(LR + " [data-tpt-intally]", "data-tpt-intally") == "away" and txt(LR + " td.tpt-io-td") == "Not open", "1. In Tally: Not open")
        ok(pg.get_attribute('#app tr[data-tsm-row="%s"] [data-tpt-intally]' % ORBIT, "data-tpt-intally") == "open", "1. In Tally: Open")
        KR = '#app [data-tsm-table] tr[data-tsm-row="%s"]' % KEST
        ok(txt(KR + " .tpt-co-line") == "Not linked" and n(KR + " [data-tpt-state]") == 0 and txt(KR).count("Not linked") == 1 and txt(KR + " td.tpt-io-td") == "",
           "1. a client not linked: 'Not linked' once, on the client line; no state line or In Tally mark repeating it (%s)" % txt(KR)[:120])
        ok(E("() => { const l = document.querySelector('#app label[for=tpf-sort]'), s = document.getElementById('tpf-sort'); return !!l && !!s && s.matches('select[data-tpf-sort=bar]'); }"), "1. the Sort label names its select")
        ok(n("#app [data-tpf] .tpf-bar select[data-tpf-view]") == 1 and n("#app .tpt-head [data-tpf-views]") == 0, "1. View and Save view in the filter bar")
        vis = E("""() => { const e = document.querySelector('#app [data-tsm-table]'); e.scrollIntoView({block: 'start'}); window.scrollBy(0, -80);
          const v = document.querySelector('#app select[data-tpf-view]'), r = v.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h === v || v.contains(h); }""")
        ok(vis, "1. the View select is not under the sticky Download bar")
        E("() => window.scrollTo(0, 0)")

        print("== 2. a chip")
        click("#app [data-tpf-chip=away]")
        ok(names() == [LARK], "2. Not open in Tally: only that client (%s)" % names())
        ok(txt("#app [data-tpf-showing]") == "Showing 1 of 4 clients", "2. Showing 1 of 4 clients (%s)" % txt("#app [data-tpf-showing]"))
        ok(chips()["away"][2] == "true" and tags() == ["Not open in Tally"] and count() == 1, "2. the chip on, its tag, Filters 1 (%s, %d)" % (tags(), count()))
        click("#app [data-tpf-tag=chip]")
        ok(names() == base and chips()["all"][2] == "true" and n("#app [data-tpf-tags]") == 0, "2. the tag removed: all 4 again")

        print("== 3. the Filters panel")
        ok(n("#app [data-tpf-panel]") == 0 and pg.get_attribute("#app [data-tpf-toggle]", "aria-expanded") == "false", "3. closed at first")
        click("#app [data-tpf-toggle]")
        ok(n("#app [data-tpf-panel]") == 1 and pg.get_attribute("#app [data-tpf-toggle]", "aria-expanded") == "true", "3. Filters opens it")
        ok(pg.get_attribute("#app [data-tpf-panel]", "role") == "region" and pg.get_attribute("#app [data-tpf-panel]", "aria-modal") is None, "3. a wide screen: a region of the card, not a dialog")
        groups = E("() => [...document.querySelectorAll('#app [data-tpf-group]')].map(g => g.querySelector('legend').textContent)")
        ok(groups == ["Masters", "Entries", "Last entry received", "In Tally", "Tally computer"], "3. its five groups (%s)" % groups)
        o = opts()
        ok([k for k in o if k.startswith("fma:")] == ["fma:done", "fma:reading", "fma:none", "fma:why"] and [k for k in o if k.startswith("fen:")] == ["fen:up", "fen:going", "fen:behind", "fen:upload", "fen:held", "fen:none"],
           "3. the masters and entries choices")
        ok([o[k][3] for k in o if k.startswith("flast:")] == ["Any time 4", "Today 2", "In the last 7 days 2", "Older than 7 days 0", "Never 2"], "3. last entry received, with counts (%s)" % [o[k][3] for k in o if k.startswith("flast:")])
        ok([o[k][3] for k in o if k.startswith("fopen:")] == ["Open or not 4", "Open in Tally now 2", "Not open in Tally 1"], "3. in Tally, with counts (%s)" % [o[k][3] for k in o if k.startswith("fopen:")])
        pcs = {k: v[3] for k, v in o.items() if k.startswith("fpc:")}
        ok(pcs == {"fpc:" + PC2: PC2 + " 1", "fpc:" + PC1: PC1 + " 2"}, "3. one choice per Tally computer, its name only (%s)" % pcs)
        ok("NWDOM" not in txt("#app [data-tsm-table]") and "made-up-o" not in txt("#app [data-tsm-table]"), "3. no Windows login on the page")
        ok(o["fma:done"][0] == 3 and o["fma:none"][0] == 0 and o["fen:up"][0] == 2 and o["fen:behind"][0] == 1 and o["fen:upload"][0] == 1, "3. the counts (%s)" % {k: v[0] for k, v in o.items()})
        ok(o["fma:why"][1] and o["fen:going"][1] and o["flast:older"][1] and not o["fen:up"][1] and not o["flast:any"][1], "3. a choice with none is off")
        opt("fen:upload")
        ok(names() == [LARK] and tags() == ["Entries: Upload needed"] and count() == 1, "3. Entries: Upload needed: Larkspur (%s %s)" % (names(), tags()))
        opt("fen:up")
        ok(sorted(names()) == sorted([LARK, NOVA_C, ORBIT]) and tags() == ["Entries: Upload needed, Up to date"], "3. two entries choices: either (%s %s)" % (names(), tags()))
        opt("fpc:" + PC1)
        ok(sorted(names()) == sorted([LARK, ORBIT]) and count() == 2, "3. and the office server: two (%s)" % names())
        ok(opts()["fpc:" + PC2][0] == 1 and opts()["fen:none"][1], "3. each group's counts follow the other filters (%s)" % opts()["fpc:" + PC2][:2])
        click("#app [data-tpf-chip=open]")
        ok(names() == [ORBIT] and count() == 3 and tags() == ["Open in Tally now", "Entries: Upload needed, Up to date", "Tally computer: " + PC1], "3. and the chip Open in Tally now: one (%s %s)" % (names(), tags()))
        ok(txt("#app [data-tpf-showing]") == "Showing 1 of 4 clients", "3. Showing 1 of 4 clients")
        ok(opts()["fopen:away"][:2] == [0, True] and opts()["fopen:open"][:2] == [1, False], "3. In Tally counts what the chip keeps: Not open 0, off (%s)" % opts()["fopen:away"])
        click("#app [data-tpf-tag=fen]")
        ok("fen" not in E("() => [...document.querySelectorAll('#app [data-tpf-tag]')].map(t => t.getAttribute('data-tpf-tag')).join(',')") and count() == 2, "3. a tag removes its own filter only (%s)" % tags())
        click("#app [data-tpf-clear]:not([data-tpf-clear=sheet])")
        ok(names() == base and count() == 0 and n("#app [data-tpf-tags]") == 0 and not any(v[2] for k, v in opts().items() if not k.endswith(":any")), "3. Clear all: all 4 again, nothing chosen")
        opt("fpc:" + PC2); pg.fill("#app [data-tsm-q]", "orbit"); pg.wait_for_timeout(450)
        ok(opts()["fpc:" + PC2][:3] == [0, False, True] and names() == [], "3. a chosen choice with none left stays on, to take off (%s)" % opts()["fpc:" + PC2])
        click("#app [data-tpf-clear]:not([data-tpf-clear=sheet])")
        ok(pg.input_value("#app [data-tsm-q]") == "" and names() == base, "3. Clear all clears the search too")
        opt("flast:never")
        ok(sorted(names()) == sorted([LARK, KEST]) and tags() == ["Last entry: Never"], "3. last entry: never (%s)" % names())
        opt("flast:any")
        ok(n(ROWS) == 4 and n("#app [data-tpf-tags]") == 0, "3. any time again: no tag")
        click("#app [data-tpf-toggle]")
        ok(n("#app [data-tpf-panel]") == 0, "3. Filters again closes it")

        print("== 4. search")
        pg.fill("#app [data-tsm-q]", GSTIN.lower()[:9]); pg.wait_for_timeout(450)
        ok(names() == [KEST], "4. the client's GSTIN (%s)" % names())
        ok(tags() == ["Search: “%s”" % GSTIN.lower()[:9]] and txt("#app [data-tpf-showing]") == "Showing 1 of 4 clients", "4. its tag and Showing (%s)" % tags())
        ok(txt("#app [data-tpf-chips]").startswith("All 1 "), "4. the chips count what the search keeps (%s)" % txt("#app [data-tpf-chips]"))
        pg.fill("#app [data-tsm-q]", "nova widg"); pg.wait_for_timeout(450)
        ok(names() == [NOVA_C], "4. the Tally company (%s)" % names())
        click("#app [data-tpf-tag=q]")
        ok(names() == base and pg.input_value("#app [data-tsm-q]") == "", "4. its tag removed: the search empty, all 4")
        pg.fill("#app [data-tsm-q]", "no such made-up name"); pg.wait_for_timeout(450)
        ok(txt("#app [data-tsm-none]").startswith("No client matches.") and n("#app [data-tsm-showall]") == 1, "4. nothing matches: No client matches, Show all")
        click("#app [data-tsm-showall]")
        ok(names() == base, "4. Show all")

        print("== 5. sort")
        sort("name")
        ok(names() == sorted(base, key=str.lower), "5. Client name A–Z (%s)" % names())
        ok(aria()["name"] == "ascending" and aria()["need"] == "none", "5. its column head says so (%s)" % aria())
        sort("open")
        ok(set(names()[:2]) == {ORBIT, NOVA_C}, "5. Open in Tally first (%s)" % names())
        sort("last")
        ok(set(names()[:2]) == {ORBIT, NOVA_C} and set(names()[2:]) == {LARK, KEST} and aria()["last"] == "descending", "5. Last entry, newest; never last (%s %s)" % (names(), aria()))
        sort("days")
        ok(names()[0] == LARK, "5. Most days to bring: Larkspur first (%s)" % names())
        sort("need")
        ok(names() == base, "5. Needs attention first: the rows as before (%s)" % names())
        click("#app [data-tpf-head=name]")
        ok(names() == sorted(base, key=str.lower) and pg.input_value("#app select[data-tpf-sort=bar]") == "name" and aria()["name"] == "ascending", "5. the Client head: A–Z (%s)" % names())
        click("#app [data-tpf-head=name]")
        ok(names() == sorted(base, key=str.lower, reverse=True) and aria()["name"] == "descending", "5. again: Z–A (%s %s)" % (names(), aria()))
        click("#app [data-tpf-head=open]")
        ok(set(names()[:2]) == {ORBIT, NOVA_C} and aria()["open"] == "ascending", "5. the In Tally head: open first")
        click("#app [data-tpf-head=open]")
        ok(set(names()[2:]) == {ORBIT, NOVA_C} and aria()["open"] == "descending", "5. again: open last (%s)" % names())
        click("#app [data-tpf-head=last]")
        ok(set(names()[:2]) == {ORBIT, NOVA_C} and aria()["last"] == "descending", "5. the Last entry head: newest first")
        click("#app [data-tpf-head=need]")
        ok(names() == base and aria()["need"] == "ascending", "5. the State head: needs attention first")
        click("#app [data-tpf-head=need]")
        ok(names() == base[::-1] and aria()["need"] == "descending", "5. again: the other way (%s)" % names())
        sort("need")

        print("== 6. views")
        vopts = lambda: E("() => [...document.querySelectorAll('#app select[data-tpf-view] option')].map(o => o.value + '=' + o.textContent)")
        ok(vopts() == ["all=All clients", "need=Needs attention", "books=Bringing books", "upload=Upload needed"] and pg.input_value("#app select[data-tpf-view]") == "all", "6. the built-in views; All clients now (%s)" % vopts())
        pg.select_option("#app select[data-tpf-view]", "need"); pg.wait_for_timeout(450)
        ok(names() == [LARK] and chips()["need"][2] == "true", "6. Needs attention: its chip on (%s)" % names())
        pg.select_option("#app select[data-tpf-view]", "upload"); pg.wait_for_timeout(450)
        ok(names() == [LARK] and tags() == ["Entries: Upload needed"], "6. Upload needed (%s)" % tags())
        pg.select_option("#app select[data-tpf-view]", "all"); pg.wait_for_timeout(450)
        ok(names() == base and count() == 0, "6. All clients: nothing filtered")
        click("#app [data-tpf-chip=open]"); sort("name")
        ok(pg.input_value("#app select[data-tpf-view]") == "" and "=Custom" in vopts()[0], "6. filters of no view: Custom")
        click("#app [data-tpf-save]")
        ok(n("#app [data-tpf-save-name]") == 1 and pg.is_disabled("#app [data-tpf-save-ok]"), "6. Save view asks for a name")
        pg.fill("#app [data-tpf-save-name]", "Open clients"); click("#app [data-tpf-save-ok]")
        ok("saved:Open clients=Open clients" in vopts() and pg.input_value("#app select[data-tpf-view]") == "saved:Open clients", "6. saved and chosen (%s)" % vopts())
        kept = E("() => { const k = Object.keys(localStorage).find(k => k.startsWith('fincom:tally-views:')); return k ? [k, JSON.parse(localStorage.getItem(k))] : null; }")
        ok(kept and kept[0].endswith(":f-1") and kept[1][0]["name"] == "Open clients" and kept[1][0]["f"]["chip"] == "open" and kept[1][0]["f"]["sort"] == "name", "6. kept in this browser for the firm (%s)" % (kept,))
        pg.select_option("#app select[data-tpf-view]", "all"); pg.wait_for_timeout(450)
        ok(names() == base, "6. All clients again")
        E("() => { S.tsm = null; render(); }"); pg.wait_for_timeout(450)
        ok("saved:Open clients=Open clients" in vopts(), "6. still there when the page is drawn afresh")
        pg.select_option("#app select[data-tpf-view]", "saved:Open clients"); pg.wait_for_timeout(450)
        ok(names() == sorted([ORBIT, NOVA_C], key=str.lower) and pg.input_value("#app select[data-tpf-sort=bar]") == "name", "6. the saved view applied: its filter and sort (%s)" % names())
        click("#app [data-tpf-remove]")
        ok(not any(v.startswith("saved:") for v in vopts()) and E("() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('fincom:tally-views:'))))") == [], "6. Remove view: gone (%s)" % vopts())
        click("#app [data-tpf-clear]:not([data-tpf-clear=sheet])"); sort("need")
        # a view kept by an older page: a chip and a sort this page does not know are left out
        E("""() => { const k = Object.keys(localStorage).find(k => k.startsWith('fincom:tally-views:')); localStorage.setItem(k, JSON.stringify([{name: 'Old view', f: {chip: 'gone', fen: ['up', 'nope'], sort: 'bogus', dir: 7}}, {name: '', f: {}}, 'x'])); S.tsm = null; render(); }""")
        pg.wait_for_timeout(450)
        ok([v for v in vopts() if v.startswith("saved:")] == ["saved:Old view=Old view"], "5. a stored view kept, the broken ones dropped (%s)" % vopts())
        pg.select_option("#app select[data-tpf-view]", "saved:Old view"); pg.wait_for_timeout(450)
        ok(chips()["all"][2] == "true" and pg.input_value("#app select[data-tpf-sort=bar]") == "need" and tags() == ["Entries: Up to date"], "5. its unknown chip and sort left out, its known choice kept (%s)" % tags())
        click("#app [data-tpf-remove]"); click("#app [data-tpf-clear]:not([data-tpf-clear=sheet])")
        # no firm known yet: no Save view (never a key shared by every firm)
        E("() => { window.__firm = Cloud.st.firm; Cloud.st.firm = ''; S.tsm = null; render(); }"); pg.wait_for_timeout(450)
        ok(n("#app [data-tpf-save]") == 0 and n("#app select[data-tpf-view]") == 1 and E("() => Object.keys(localStorage).filter(k => /^fincom:tally-views:(local)?$/.test(k)).length") == 0, "5. no firm known: no Save view, nothing stored under a shared key")
        E("() => { Cloud.st.firm = window.__firm; S.tsm = null; render(); }"); pg.wait_for_timeout(450)
        ok(n("#app [data-tpf-save]") == 1, "5. the firm known again: Save view")
        E("() => { window.__ls = [Storage.prototype.getItem, Storage.prototype.setItem]; Storage.prototype.getItem = () => { throw new Error('blocked'); }; Storage.prototype.setItem = () => { throw new Error('blocked'); }; S.tsm = null; render(); }")
        pg.wait_for_timeout(450)
        ok(n(ROWS) == 4 and vopts()[:1] == ["all=All clients"], "6. no browser storage: the page and its views all the same")
        click("#app [data-tpf-chip=need]"); click("#app [data-tpf-save]"); pg.fill("#app [data-tpf-save-name]", "Today"); click("#app [data-tpf-save-ok]")
        ok("saved:Today=Today" in vopts() and names() == [LARK], "6. a view saved for the tab (%s)" % vopts())
        click("#app [data-tpf-remove]")
        ok(not any(v.startswith("saved:") for v in vopts()), "6. and removed")
        E("() => { [Storage.prototype.getItem, Storage.prototype.setItem] = window.__ls; S.tsm = null; render(); }"); pg.wait_for_timeout(450)

        print("== 7. More ▾")
        OR = '#app [data-tsm-table] tr[data-tsm-row="%s"]' % ORBIT
        ok(all(n('#app tr[data-tsm-row="%s"] [data-tpt-open]' % k) == 1 for k in base), "7. every row keeps More ▾")
        ok(n(OR + " [data-tpt-main]") == 1, "7. and its main button")
        click(OR + " [data-tpt-open]")
        ok(n('#app tr[data-tpt-light="%s"] [data-tpt-light-in]' % pg.get_attribute(OR, "data-tsm-cid")) == 1 and "Less" in txt(OR + " [data-tpt-open]"), "7. More ▾ opens the light row")
        ok(pg.get_attribute('#app tr[data-tpt-light] td', "colspan") == "7", "7. the light row spans the seven columns")
        click(OR + " [data-tpt-open]")
        ok(n("#app tr[data-tpt-light]") == 0, "7. Less ▴ closes it")

        print("== 8. a read asked for the client's older Tally company (relinked since): not this link's read")
        cid = pg.get_attribute(OR, "data-tsm-cid")
        before = pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters")
        E("""(c) => { S.tcoSync = S.tcoSync || {}; S.tcoSync[c] = {cid: c, company: 'ORBIT SPACE - (from 1-Apr-2021)', at: Date.now() - 400000, via: 'cloud', err: '', end: 0, late: false, led: null, prog: null, why: 'made up', la0: '', samples: []}; render(); }""", cid)
        pg.wait_for_timeout(700)
        ok(pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters") == before and "from 1-Apr-2021" not in txt(OR), "8. the older company's read is not shown on the row (%s -> %s; %s)" % (before, pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters"), txt(OR)[:160]))
        E("""(c) => { S.tcoSync[c].company = 'ORBIT SPACE'; render(); }""", cid); pg.wait_for_timeout(700)
        ok(pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters") in ("reading", "waiting"), "8. the same read for the linked company: shown (%s)" % pg.get_attribute(OR + " [data-tpg-masters]", "data-tpg-masters"))
        ok(chips()["reading"][0] == 1, "8. and counted as Reading now (%s)" % chips()["reading"])
        E("""(c) => { delete S.tcoSync[c]; render(); }""", cid); pg.wait_for_timeout(400)

        if SHOT:
            click("#app [data-tpf-chip=need]"); click("#app [data-tpf-toggle]")
            E("() => { const e = document.querySelector('#app [data-tsm-table]'); if (e) e.scrollIntoView({block: 'start'}); window.scrollBy(0, -80); }"); pg.wait_for_timeout(500)
            pg.screenshot(path=os.path.join(SHOT, "filters2-desktop.png"))
            click("#app [data-tpf-clear]:not([data-tpf-clear=sheet])"); click("#app [data-tpf-toggle]")

        print("== 9. a phone")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(700)
        sw = E("() => document.documentElement.scrollWidth")
        ok(sw <= 392, "9. no sideways scroll of the page (%d)" % sw)
        cs = E("() => { const c = document.querySelector('#app [data-tpf-chips]'), s = getComputedStyle(c); return [s.overflowX, s.flexWrap, c.scrollWidth > c.clientWidth, c.getBoundingClientRect().right]; }")
        ok(cs[0] == "auto" and cs[1] == "nowrap" and cs[2] and cs[3] <= 392, "9. the chips scroll sideways in their own row (%s)" % cs)
        card = E("""(s) => { const r = document.querySelector(s), b = r.getBoundingClientRect(), g = (q) => r.querySelector(q).getBoundingClientRect();
          const m = g('td.tpt-masters'), e = g('td.tpt-entries'), a = g('[data-tpt-main]'), io = g('[data-tpt-intally]');
          return {grid: getComputedStyle(r).display, w: b.width, side: Math.abs(m.top - e.top) < 2 && e.left > m.right - 1, full: a.width > b.width - 60, io: io.top < m.top && io.left > b.left + b.width / 2, ioText: r.querySelector('[data-tpt-intally]').innerText}; }""", OR)
        ok(card["grid"] == "grid" and card["w"] <= 380, "9. each row a card (%s)" % card)
        ok(card["side"] and card["full"], "9. Masters and Entries side by side, the button full width (%s)" % card)
        ok(card["io"] and card["ioText"] == "Open in Tally", "9. the In Tally badge beside the client (%s)" % card)
        ok(pg.is_visible(OR + " [data-tpt-open]"), "9. More ▾ kept")
        ok(not pg.is_visible("#app select[data-tpf-sort=bar]"), "9. Sort moves into the sheet")
        if SHOT:
            E("() => { const e = document.querySelector('#app [data-tsm-table]'); if (e) e.scrollIntoView({block: 'start'}); window.scrollBy(0, -70); }"); pg.wait_for_timeout(500)
            pg.screenshot(path=os.path.join(SHOT, "filters2-phone.png"))
        click("#app [data-tpf-chip=open]"); click("#app [data-tpf-toggle]")
        sh = E("() => { const p = document.querySelector('#app [data-tpf-panel]'), b = p.getBoundingClientRect(), s = getComputedStyle(p); return [s.position, Math.round(b.bottom), Math.round(b.left), Math.round(b.width)]; }")
        ok(sh[0] == "fixed" and abs(sh[1] - 844) <= 2 and sh[2] == 0 and sh[3] == 390, "9. the panel opens as a bottom sheet (%s)" % sh)
        ok(pg.is_visible("#app [data-tpf-panel] select[data-tpf-sort=sheet]") and pg.is_visible("#app [data-tpf-clear=sheet]"), "9. with Sort and Clear all")
        ok(txt("#app [data-tpf-show]") == "Show 2 clients", "9. Show 2 clients (%s)" % txt("#app [data-tpf-show]"))
        opt("fpc:" + PC1)
        ok(txt("#app [data-tpf-show]") == "Show 1 client", "9. it follows the filters (%s)" % txt("#app [data-tpf-show]"))
        click("#app [data-tpf-show]")
        ok(n("#app [data-tpf-panel]") == 0 and names() == [ORBIT], "9. Show closes the sheet (%s)" % names())
        click("#app [data-tpf-toggle]")
        dg = E("() => { const p = document.querySelector('#app [data-tpf-panel]'), a = document.activeElement; return [p.getAttribute('role'), p.getAttribute('aria-modal'), a && a.hasAttribute('data-tpf-sheet-title'), getComputedStyle(document.documentElement).overflow]; }")
        ok(dg == ["dialog", "true", True, "hidden"], "9. the sheet: a modal dialog, its heading focused, the page behind not scrolling (%s)" % dg)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(450)
        af = E("() => [!!document.querySelector('#app [data-tpf-panel]'), !!(document.activeElement && document.activeElement.hasAttribute('data-tpf-toggle')), getComputedStyle(document.documentElement).overflow]")
        ok(af[0] is False and af[1] and af[2] != "hidden", "9. Escape closes it, focus back on Filters, the page scrolls again (%s)" % af)
        sw = E("() => document.documentElement.scrollWidth")
        ok(sw <= 392, "9. still no sideways scroll (%d)" % sw)
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)

if __name__ == "__main__":
    main()
