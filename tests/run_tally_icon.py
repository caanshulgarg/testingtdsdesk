"""python3 run_tally_icon.py - the header's ONE Tally icon (next-tally-icon, 27-Oct-2026; the owner: "header is too noisy of
tally remarks.. everywhere.. just need only an icon showing tally status only"; "that tally icon should have some option
to take action there only"; "I don't need NWS144... need only Tally... it should be simple to understand").
  1. Exactly one Tally status element in the header on Overview, Purchase, Bank, TDS, GST and Post to Tally; no client
     title chip, no status line beside the title, no top-bar chip words ("Linked", "Waiting for Tally", "This PC",
     "Tally not on this computer") visible in the header; no "Posting into ..." block or Tally status line on the page
     body (Post to Tally keeps where it posts as a small label at its Post button).
  2. The icon's colour and aria-label in each state: green Linked ("Connected to Tally · last entry 2:41 pm"), amber
     Waiting for Tally ("Open <company> in Tally"), red Needs you (one short sentence), grey Not linked / not connected.
     Plain words: never the computer's name, a port, a Windows user or the bridge.
  3. The popover (a click; never the side panel) shows the word, the line and the state's action, done in place, its
     result said there: Update now / Check again / Allow posting (tally_link_posting, once) / Use ② (owners;
     tally_link_place_choose, once; staff see who can) / Link to Tally company (an inline list, the link function once) /
     Download when no computer has FinCom. Esc and a click outside close it; the keyboard reaches it.
  4. Phone 390: the same single icon, no sideways scroll, the popover inside the screen.
  5. (next-bridge-follows-login) A company no client has, from a computer revoked or moved away to another login (IX
     DESIGNS in firm ABC): not on the Tally page's list nor in the popover's list until "From a removed computer (n)" is
     opened; a linked company of that computer stays, marked "computer moved".
Options: --shots DIR saves the screens.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_icon.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_link_record import SETUP, BILLS, store, dev, rec, row, OPEN, BEAT, ALPHA, ITS, GA, GE, CA, CE, CU, CLIENTS, ME, OTHER, Q
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = int(os.environ.get("ICON_PORT") or 8473)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
NOT_PLAIN = re.compile(r"NWS144|anshul|[Pp]ort \d|\bport\b|[Bb]ridge|TallyPrime|This PC|this computer")
ICON = "header.top [data-tally-icon]"
POP = "header.top [data-tally-pop]"

def rgb(s):
    m = re.findall(r"[\d.]+", s or "")
    return tuple(float(x) for x in m[:3]) if len(m) >= 3 else (0, 0, 0)
HUE = {"linked": lambda r, g, b: g > r + 20 and g > b,
       "waiting": lambda r, g, b: r > b + 40 and g > b + 20,
       "needs": lambda r, g, b: r > g + 40 and r > b + 40,
       "none": lambda r, g, b: max(r, g, b) - min(r, g, b) < 40}

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def page(w=1440, h=900):
            pg = br.new_page(viewport={"width": w, "height": h})
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
                body=json.dumps({"setup": {"version": "2.4.7", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.7.exe", "sha256": "ab" * 32}})))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            pg.wait_for_function("() => typeof LinkRec === 'object' && typeof LinkWord === 'function'", timeout=30000)
            return pg
        def shot(pg, name, sel=None, pad=8):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True)
            if sel and pg.locator(sel).count():
                b = pg.evaluate("([s, p]) => { const r = document.querySelector(s).getBoundingClientRect(); return {x: Math.max(0, r.left - p), y: Math.max(0, r.top - p), width: Math.min(innerWidth, r.width + 2 * p), height: r.height + 2 * p}; }", [sel, pad])
                pg.screenshot(path=os.path.join(SHOTS, name + ".png"), clip=b)
            else: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))
        def client_page(pg, cid, to="dash"):
            pg.evaluate("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", cid); pg.wait_for_timeout(1200)
            if to != "dash": pg.evaluate("(t) => goClient(t)", to); pg.wait_for_timeout(1500)
        def scene(pg, devs, links=None, role="owner", email=ME, places=None, cid=CA):
            s = store(links=links if links is not None else [rec(ALPHA, "b-alpha", CA, GA), rec(ITS, "b-its", CE, GE)], devs=devs)
            s["cos"][0]["client_id"] = CA if any(l["client_id"] == CA for l in s["links"]) else None
            if places is not None: s["places"] = places
            pg.evaluate(SETUP, [s, role, email, CLIENTS]); client_page(pg, cid)
        icon = lambda pg: pg.evaluate("(s) => { const b = document.querySelectorAll(s); if (b.length !== 1) return {n: b.length}; const e = b[0], d = e.querySelector('.tsign-dot');"
                                      " return {n: 1, state: e.getAttribute('data-tally-icon'), label: e.getAttribute('aria-label'), title: e.title, text: e.innerText.trim(), dot: getComputedStyle(d).backgroundColor, w: e.getBoundingClientRect().width}; }", ICON)
        def pop_open(pg):
            if not pg.locator(POP).count(): pg.click(ICON)
            pg.wait_for_selector(POP + " [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(300)
            return pg.evaluate("(s) => { const e = document.querySelector(s); return {state: e.getAttribute('data-tally-pop'), word: e.querySelector('[data-tally-pop-word]').innerText, line: (e.querySelector('[data-tally-pop-line]') || {innerText: ''}).innerText,"
                               " acts: [...e.querySelectorAll('[data-tally-pop-act]')].map(b => b.getAttribute('data-tally-pop-act')), text: e.innerText, msg: (e.querySelector('[data-tally-pop-msg]') || {innerText: ''}).innerText}; }", POP)
        def act(pg, a, wait=1800):
            pg.click(POP + " [data-tally-pop-act=%s]" % a); pg.wait_for_timeout(wait)
            return pg.evaluate("(s) => { const e = document.querySelector(s); return e ? (e.querySelector('[data-tally-pop-msg]') || {innerText: ''}).innerText : null; }", POP)
        rpc = lambda pg, fn: [r for r in pg.evaluate("window.__rpc") if r[0] == fn]
        no_panel = lambda pg: pg.evaluate("() => !S.tallyPanel && !document.querySelector('[data-overlay=tallypanel]')")
        def state_checks(pg, want, label_re, name):
            i = icon(pg)
            ok(i["n"] == 1 and i["state"] == want and re.fullmatch(label_re + r"(?: — \d+ compan(?:y|ies) open in Tally (?:is|are) not linked)?", i["label"] or "") and i["title"] == i["label"] and not i["text"] and i["w"] <= 40,
               "%s: one icon, %s, no words on it, aria-label %r (%s)" % (name, want, i.get("label"), i))
            ok(HUE[want](*rgb(i["dot"])), "%s: its dot is %s (%s)" % (name, {"linked": "green", "waiting": "amber", "needs": "red", "none": "grey"}[want], i["dot"]))
            ok(not NOT_PLAIN.search(i["label"] or ""), "%s: plain words in the label (no computer, port or bridge)" % name)
            pg.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
            shot(pg, "desktop-header-" + name, "header.top")
            return i

        print("== 2/3. the four states, their colours, words and actions")
        pg = page(); E = lambda js, *a: pg.evaluate(js, *a)
        E("() => { window.__upd = []; window.__chk = 0; }")
        # Linked: green, "Connected to Tally · last entry 2:41 pm", Update now
        scene(pg, [dev(OPEN, BEAT)])
        state_checks(pg, "linked", r"Tally: Linked — Connected to Tally · last entry \d{1,2}:\d\d [ap]m", "linked")
        po = pop_open(pg)
        ok(po["state"] == "linked" and po["word"] == "Linked" and po["line"].startswith("Connected to Tally · last entry ") and po["acts"] == ["update"] and not NOT_PLAIN.search(po["text"]),
           "Linked: the popover says the word, the line, one action Update now, plain words (%s)" % po)
        ok("Open Tally page" in po["text"] and no_panel(pg), "Open Tally page is there; no side panel")
        shot(pg, "desktop-popover-linked", POP, 12)
        E("() => { window.__updWas = window.tallyUpdateNow; window.tallyUpdateNow = (c) => { window.__upd.push(c); }; }")
        m = act(pg, "update", 600)
        ok(E("window.__upd") == [CA] and m.startswith("Asked Tally for its new entries at ") and no_panel(pg) and E("() => S.view") == "company",
           "Update now: asked once for this client, the result in the popover, nothing else opens (%s)" % m)
        E("() => { window.tallyUpdateNow = window.__updWas; }")
        # Esc closes it, the focus back on the icon; a click outside closes it
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        ok(pg.locator(POP).count() == 0 and E("() => document.activeElement && document.activeElement.hasAttribute('data-tally-icon')"), "Esc closes it, the focus back on the icon")
        pop_open(pg); pg.mouse.click(700, 600); pg.wait_for_timeout(400)
        ok(pg.locator(POP).count() == 0, "a click outside closes it")
        # keyboard: the icon is reached with Tab and opens with Enter; the focus goes into the popover
        E("() => document.querySelector('[data-tally-icon]').focus()"); pg.keyboard.press("Enter"); pg.wait_for_timeout(800)
        ok(pg.locator(POP).count() == 1 and E("(s) => !!document.activeElement.closest(s)", POP), "Enter on the icon opens it; the focus is in the popover (%s)" % E("() => document.activeElement.outerHTML.slice(0, 80)"))
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

        # Waiting for Tally: amber, "Open <company> in Tally", Check again
        scene(pg, [dev([], BEAT, tally="closed")])
        state_checks(pg, "waiting", r"Tally: Waiting for Tally — Open %s in Tally" % re.escape(ALPHA), "waiting")
        po = pop_open(pg)
        ok(po["word"] == "Waiting for Tally" and po["line"] == "Open %s in Tally" % ALPHA and po["acts"] == ["check"] and not NOT_PLAIN.search(po["text"]), "Waiting: Open %s in Tally, Check again (%s)" % (ALPHA, po))
        shot(pg, "desktop-popover-waiting", POP, 12)
        E("() => { window.__chkWas = window.tallyCheckNow; window.tallyCheckNow = () => { window.__chk++; return Promise.resolve(); }; }")
        m = act(pg, "check", 600)
        ok(E("window.__chk") == 1 and m.startswith("Checked at ") and m.endswith(": Waiting for Tally.") and no_panel(pg), "Check again: once, the answer in the popover (%s)" % m)
        E("() => { window.tallyCheckNow = window.__chkWas; }")
        pg.keyboard.press("Escape")

        # Needs you (posting stopped): red, one short sentence, Allow posting
        scene(pg, [dev(OPEN, BEAT)], [rec(ALPHA, "b-alpha", CA, GA, allowed=False), rec(ITS, "b-its", CE, GE)])
        state_checks(pg, "needs", r"Tally: Needs you — Posting to Tally is stopped for Alpha Traders Ltd\.", "needs")
        po = pop_open(pg)
        ok(po["acts"] == ["allow"] and po["line"] == "Posting to Tally is stopped for Alpha Traders Ltd." and not NOT_PLAIN.search(po["text"]), "Needs you: the sentence and Allow posting (%s)" % po)
        shot(pg, "desktop-popover-needs", POP, 12)
        E("() => { window.__rpc = []; }")
        m = act(pg, "allow", 2200)
        tp = rpc(pg, "tally_link_posting")
        ok(len(tp) == 1 and tp[0][1].get("p_allowed") is True and E("(b) => window.__links.find(l => l.book_id === b).posting_allowed", "b-alpha") is True and m == "Posting to Tally is allowed again." and no_panel(pg),
           "Allow posting: tally_link_posting once, allowed, said in the popover (%s, %s)" % (tp, m))
        pg.keyboard.press("Escape")

        # Needs you (the same company in two places): Use ② for an owner, who can for staff
        lap = {"go-3": {"at": "ago:1", "version": "2.4.7", "computer": "LAPTOP", "user": "ravi", "mode": "main", "tallyState": "open", "open": [ALPHA], "tallyPort": 9001, "dataFolder": "D:\\Copy\\Data"}}
        places = [{"book_id": "b-alpha", "data_loc": "f-nws", "data_folder": "C:\\Users\\anshul\\TallyPrime\\Data", "computer": "NWS144", "windows_user": "anshul", "tally_port": 9005, "state": "chosen", "last_seen": "ago:1", "entries_at": "ago:1", "last_entry": "2026-10-27"},
                  {"book_id": "b-alpha", "data_loc": "f-lap", "data_folder": "D:\\Copy\\Data", "computer": "LAPTOP", "windows_user": "ravi", "tally_port": 9001, "state": "waiting", "last_seen": "ago:2", "entries_at": "ago:2", "last_entry": "2026-10-20"}]
        two = [dict(rec(ALPHA, "b-alpha", CA, GA), data_loc="f-nws"), rec(ITS, "b-its", CE, GE)]
        scene(pg, [dev(OPEN, BEAT, bridges=lap)], two, places=places)
        i = icon(pg); po = pop_open(pg)
        ok(i["state"] == "needs" and po["acts"] == ["place1", "place2"] and "two places" in po["line"] and not re.search(r"LAPTOP|NWS144|ravi|anshul|Data", po["text"]), "two places: Use ① / Use ②, no computer names (%s)" % po)
        shot(pg, "desktop-popover-needs-two-places", POP, 12)
        E("() => { window.__rpc = []; }")
        m = act(pg, "place2", 2200)
        ch = rpc(pg, "tally_link_place_choose")
        ok(ch == [["tally_link_place_choose", {"p_book": "b-alpha", "p_loc": "f-lap"}]] and m.startswith("FinCom reads ") and no_panel(pg), "Use ②: tally_link_place_choose once, said in the popover (%s, %s)" % (ch, m))
        pg.keyboard.press("Escape")
        scene(pg, [dev(OPEN, BEAT, bridges=lap)], two, role="staff", email=OTHER, places=places)
        po = pop_open(pg)
        ok(not po["acts"] and "An owner of the firm can do this." in po["text"], "staff: no Use buttons, one line saying who can (%s)" % po["text"][:200])
        pg.keyboard.press("Escape")

        # Not linked: grey, "Not linked to a Tally company yet.", the inline list, the link function once
        scene(pg, [dev(OPEN, BEAT)], [rec(ITS, "b-its", CE, GE)], cid=CU)
        state_checks(pg, "none", r"Tally: Not linked — Not linked to a Tally company yet\.", "not-linked")
        po = pop_open(pg)
        opts = E("(s) => [...document.querySelectorAll(s + ' [data-tally-pop-pick] option')].map(o => o.value)", POP)
        ok(po["acts"] == ["link"] and ALPHA in opts and ITS not in opts, "Not linked: Link with the companies no client has (%s)" % opts)
        shot(pg, "desktop-popover-not-linked", POP, 12)
        E("() => { window.__rpc = []; }")
        pg.select_option(POP + " [data-tally-pop-pick]", ALPHA)
        m = act(pg, "link", 2800)
        lk = rpc(pg, "tally_company_link") + rpc(pg, "tally_link_set")
        ok(len(lk) == 1 and lk[0][1].get("p_client") == CU and lk[0][1].get("p_company") == ALPHA and m == "Beta Works is linked to %s." % ALPHA and no_panel(pg) and E("() => S.view") == "company",
           "Link: the link function once, said in the popover, the page stays (%s, %s)" % (lk, m))
        pg.keyboard.press("Escape")

        # no computer of the firm has FinCom: grey, Download
        pg.evaluate(SETUP, [dict(store(), devs=[]), "owner", ME, CLIENTS]); pg.evaluate("() => { TLight.st.devs = []; TCloud.pane.devices = []; TallySteady.reset(); render(); }")
        E("() => { S.coId = null; S.view = 'home'; navHome('clients'); }"); pg.wait_for_timeout(1000)
        i = icon(pg); po = pop_open(pg)
        ok(i["state"] == "none" and HUE["none"](*rgb(i["dot"])) and pg.locator(POP + " [data-tally-pop-download]").count() == 1 and "Download FinCom for Tally" in po["text"],
           "no FinCom on any computer (the firm's page): grey, Download in the popover (%s)" % i)
        shot(pg, "desktop-popover-no-connection", POP, 12)
        pg.keyboard.press("Escape")

        print("== 1. one Tally element in the header on each page; no Tally status lines in the body")
        scene(pg, [dev([], BEAT, tally="closed")])
        E(BILLS); pg.wait_for_timeout(900)
        for name, to in [("Overview", "dash"), ("Purchase", "bills"), ("Bank", "bank"), ("TDS", "books:tds"), ("GST", "books:gst"), ("Post to Tally", "post")]:
            client_page(pg, CA, to)
            h = E("() => { const h = document.querySelector('header.top'); return {n: h.querySelectorAll('[data-tally-icon], [data-tally-chip], [data-link-status], .tsign-long, [data-tally-here]').length, icons: h.querySelectorAll('[data-tally-icon]').length, text: h.innerText}; }")
            bad = [w for w in ("Linked", "Waiting for Tally", "This PC", "Tally not on this computer", "Open " + ALPHA) if w in h["text"]]
            ok(h["icons"] == 1 and h["n"] == 1 and not bad, "%s: one Tally element in the header, no Tally words in it (%s, %s)" % (name, h["n"], bad))
            body = E("() => document.getElementById('app').innerText")
            ok("Posting into" not in body and "in TallyPrime on" not in body and pg.locator("#app [data-post-line], #app [data-link-status-at=title], #app [data-books-stale-open]").count() == 0,
               "%s: no Tally status line on the page" % name)
        ok(E("() => S.tab") in ("export", "post") or pg.locator("#app [data-post-page]").count() == 1, "on Post to Tally")
        into = E("() => { const e = document.querySelector('#app [data-post-into]'); return e ? e.innerText : ''; }")
        ok(into == "into " + ALPHA, "Post to Tally: where it posts, a small label at the Post button (%r)" % into)
        ok(pg.locator("#app [data-post-problem]").count() == 0, "before Post is pressed: no Tally line on the page")
        shot(pg, "ready-to-post-after")
        E("() => { S.postTried = S.coId; render(); }"); pg.wait_for_timeout(500)
        pp = E("() => { const e = document.querySelector('#app [data-post-problem]'); return e ? e.innerText : ''; }")
        ok(pp.startswith("Not sent to Tally. Open %s in Tally." % ALPHA) and not NOT_PLAIN.search(pp), "once Post was pressed: one plain line (%r)" % pp)
        pg.close()

        print("== 5. companies from a removed computer")
        pg = page(); E = lambda js, *a: pg.evaluate(js, *a)
        D2 = "d0000000-0000-4000-8000-000000000002"
        gone = dict(dev([], []), id=D2, name="NWS144", revoked=True); gone["info"] = dict(gone["info"], movedAway={"bridge": "go-9", "at": "ago:5", "revoked": True})
        # migration 115 on a computer key two bridges share: one bridge moved away, the key left (revoked false), the
        # other bridge still sends its companies with it: those companies are not "from a removed computer"
        D3 = "d0000000-0000-4000-8000-000000000003"
        shared = dict(dev([], []), id=D3, name="SHARED PC"); shared["info"] = dict(shared["info"], movedAway={"bridge": "go-8", "at": "ago:5", "revoked": False})
        s5 = store(links=[rec(ALPHA, "b-alpha", CA, GA), rec(ITS, "b-its", CE, GE), dict(rec("OLD CO", "b-old", CE, "0ld00001-0000-0000-0000-000000000001"), device_id=D2)],
                   devs=[dev(OPEN, BEAT), gone, shared])
        s5["cos"][0]["client_id"] = CA
        s5["cos"] += [dict(row("IX DESIGNS", "b-ix"), device_id=D2), dict(row("OLD CO", "b-old", CE), device_id=D2), dict(row("SHARED CO", "b-sh"), device_id=D3)]
        E(SETUP, [s5, "owner", ME, CLIENTS])
        E("() => { S.coId = null; S.view = 'home'; navHome('tally'); }"); pg.wait_for_timeout(1800)
        RW = lambda c: '#app [data-tco-list=firm] [data-tco-row="%s"]' % c
        ok(pg.locator(RW("IX DESIGNS")).count() == 0 and pg.locator("#app [data-tco-show-gone]").inner_text() == "From a removed computer (1)",
           "IX DESIGNS (not a client, its computer removed): not listed; 'From a removed computer (1)' (%s)" % pg.locator("#app [data-tco-show-gone]").all_inner_texts())
        ok(pg.locator(RW("OLD CO")).count() == 1 and pg.locator(RW("OLD CO") + " [data-tco-moved]").inner_text() == "computer moved", "OLD CO (linked) stays, marked 'computer moved'")
        ok(pg.locator(RW("SHARED CO")).count() == 1 and pg.locator(RW("SHARED CO") + " [data-tco-gone], " + RW("SHARED CO") + " [data-tco-moved]").count() == 0,
           "SHARED CO: its computer key still in use (one bridge moved away, key not revoked): listed as usual")
        shot(pg, "tally-page-removed-computer-closed", "#app [data-tco-list=firm]")
        pg.click("#app [data-tco-show-gone]"); pg.wait_for_timeout(500)
        ok(pg.locator(RW("IX DESIGNS")).count() == 1 and pg.locator(RW("IX DESIGNS") + " [data-tco-gone]").count() == 1, "opened: IX DESIGNS is listed, marked 'from a removed computer'")
        shot(pg, "tally-page-removed-computer-open", "#app [data-tco-list=firm]")
        client_page(pg, CU); pop_open(pg)
        opts = E("(s) => [...document.querySelectorAll(s + ' [data-tally-pop-pick] option')].map(o => o.value)", POP)
        ok("IX DESIGNS" not in opts, "the Tally icon's Link list leaves it out (%s)" % opts)
        pg.close()

        print("== 4. phone 390")
        pg = page(390, 844); E = lambda js, *a: pg.evaluate(js, *a)
        scene(pg, [dev(OPEN, BEAT)])
        i = icon(pg)
        ok(i["n"] == 1 and i["state"] == "linked" and not i["text"], "phone: the same single icon (%s)" % i)
        ok(E("() => document.documentElement.scrollWidth <= innerWidth + 1"), "phone: no sideways scroll")
        shot(pg, "phone-390-header", "header.top")
        pop_open(pg)
        r = E("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.right, innerWidth]; }", POP)
        ok(r[0] >= 0 and r[1] <= r[2], "phone: the popover inside the screen (%s)" % r)
        shot(pg, "phone-390-popover")
        pg.close()
        br.close()
    srv.shutdown()
    errs = [e for e in errors if "ResizeObserver" not in e]
    ok(not errs, "no page errors (%s)" % errs[:3])
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
