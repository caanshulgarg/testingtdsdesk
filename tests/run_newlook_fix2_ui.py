"""python3 run_newlook_fix2_ui.py - the owner's screenshot of 23-Nov-2026 (Safari, New look on, Bank > Lines to review, about
1000 px wide): "bank name is overlapping". Offline, made-up data only:
  1. New look, Bank: the statement's box in the header row (bank, account, period) shows its words on one line, cut with
     an ellipsis, wholly inside the header (not clipped at the top or the foot), and still changes the statement; the
     client's name beside it is one line with an ellipsis, at the same height;
  2. both looks (the owner's second screenshot): no words under FinCom in the sidebar and no bar along the foot; the
     testing site's words (a named preview's too: build with FINCOM_BANNER="Made-up review words") are the tooltip on the
     sidebar's Synced/Saved line, under its ⓘ and in Settings' About line;
  3. the classic look: Settings has My account > Look with the New look and Compact rows switches; turning New look on
     there turns it on at once; the firm menu's item stays;
  4. off: the Bank header as before;
  5. New look's top bar at about 1000 px: Upload statement keeps its width and is not drawn over the page's name.
Widths 1000 and 1440 (and a phone, 390); TDSDESK_ENGINE=webkit|chromium (default chromium). Screenshots
(deviceScaleFactor 2) go to TDSDESK_SHOTS when set, named <engine>-<width>-<look>-<what>.png.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_newlook_fix2_ui.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = int(os.environ.get("NL_PORT") or 8947)
ENGINE = os.environ.get("TDSDESK_ENGINE", "chromium")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS", "")
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# a long client name and a long statement name, as in the owner's screenshot (made up)
SETUP = """() => {
  const c = newCompany({name: "Sample Consulting Private Limited 01 Test Unit", gstin: "07AAGCL4827M1Z3"});
  c.bankAccounts = [{id: "a1", bank: "Demo Bank OD", acct: "9000000123", last4: "0123", ledger: "Demo Bank OD 9000000123"}];
  c.choices = Object.assign({}, c.choices, {"bank:a1": {value: "Demo Bank OD 9000000123", state: "confirmed", by: "Made-up Owner", at: "2026-11-01T10:00:00Z"}});
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const parties = ["Made Up Traders", "Sample Stores", "Demo Logistics", "Test Supplies Co"];
  let bal = 2500000;
  const rows = Array.from({length: 40}, (_, i) => { const out = i % 3 !== 1; const amt = [2000, 28788, 2970, 1000][i % 4] * (1 + (i % 5) / 10);
    bal += out ? -amt : amt;
    return {id: "r" + i, fp: "fp" + i, date: "2026-06-" + String(1 + (i % 28)).padStart(2, "0"), debit: out ? r2(amt) : 0, credit: out ? 0 : r2(amt), balance: r2(bal),
      narr: (out ? "NEFT DR " : "NEFT CR ") + parties[i % 4].toUpperCase() + " UTR" + (100000 + i), dec: {name: parties[i % 4], mode: "NEFT", utr: "UTR" + (100000 + i)},
      ledger: i % 4 ? "" : parties[i % 4], state: i % 4 ? "attention" : "suggested", balOk: true, why: ["No ledger found for this party."]}; });
  S.bank = {cid: c.id, loading: false, stmts: [
    {id: "s0", acctId: "a1", bank: "Demo Bank OD", acct: "9000000123", from: "2026-04-01", to: "2026-05-31", printed: true, opening: 2400000, closing: 2500000, n: 120, fileName: "demo-apr.xlsx", uploadedAt: "2026-06-03T10:00:00Z", counts: {sent: 118, ignored: 2}},
    {id: "s1", acctId: "a1", bank: "Demo Bank OD", acct: "9000000123", from: "2026-06-01", to: "2026-11-09", printed: true, opening: 2500000, closing: bal, n: 40, fileName: "demo-jun-nov.pdf", uploadedAt: "2026-11-10T09:30:00Z"}],
    cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "Demo Bank OD 9000000123", group: "Bank OD A/c"}, {name: "Salary Payable", group: "Current Liabilities"}]), importedAt: new Date().toISOString(), live: true},
    newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 300, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  S.nlBankTab = "lines"; render(); return c.id; }"""
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
NL_ON = "try { localStorage.setItem('fincom:newlook:local', 'on'); } catch (e) {}"
# the menu with its words, as in the owner's screenshot (the new look folds it under 1400 px until the person chooses)
UNFOLD = "try { localStorage.setItem('fincom:sideFolded', '0'); } catch (e) {}"
# the header row's boxes: each one line, cut with an ellipsis, wholly inside the header (and the box that holds them)
HEAD = """() => { const head = document.querySelector('#app [data-bank-head]'), id = head && head.querySelector('.bk-id'); if (!id) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height}; };
  const lines = (e) => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
  const inside = (a, b) => a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
  const hr = R(head), ir = R(id);
  const box = (e, txt) => { if (!e) return null; const cs = getComputedStyle(txt || e), r = R(e), t = txt ? R(txt) : r, lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return {h: Math.round(r.h), top: Math.round(r.top), mid: (r.top + r.bottom) / 2, inHead: inside(r, hr), inId: inside(r, ir), textIn: inside(t, r), lines: lines(txt || e),
      ellipsis: cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' && cs.overflow.includes('hidden'), cut: (txt || e).scrollWidth > (txt || e).clientWidth + 1,
      roomy: (txt || e).clientHeight >= Math.min(lh, parseFloat(cs.fontSize) * 1.15) - 0.5, right: Math.round(r.right), text: (txt || e).textContent}; };
  const pick = head.querySelector('[data-nl-stmtpick]'), sel = head.querySelector('select.bk-stmtsel');
  return {pick: pick ? box(pick, pick.querySelector('[data-nl-stmtlbl]')) : null, sel: sel ? box(sel) : null, selSeen: sel ? getComputedStyle(sel).opacity : null,
    client: box(head.querySelector('[data-bank-client]')), headRight: Math.round(hr.right), vw: innerWidth}; }"""
BRAND = """() => { const b = document.querySelector('#side .side-brand'); if (!b) return null; const a = getComputedStyle(b, '::after');
  const st = getComputedStyle(document.body, '::after'), t = document.querySelector('#side [data-trust-short]');
  return {shown: a.display !== 'none' && a.content !== 'none' && a.content !== 'normal', content: a.content, h: Math.round(b.getBoundingClientRect().height),
    strip: st.content === 'none' || st.content === 'normal' || st.display === 'none' ? '' : st.content, tip: t ? t.title : null,
    more: (document.querySelector('#side [data-site-words]') || {}).textContent || ''}; }"""
# the top bar: the page's name and the client's line are not covered by the page's own button or anything else
TOPBAR = """() => { const h = document.querySelector('header.top .tbar-title h2'), up = [...document.querySelectorAll('header.top .tb-page button')].find((b) => /Upload/.test(b.textContent));
  if (!h || !up) return null; const a = h.getBoundingClientRect(), b = up.getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(h);
  const t = r.getBoundingClientRect(), cr = document.querySelector('header.top .tbar-title .crumbs'), c = cr ? cr.getBoundingClientRect() : null, over = (x, y) => x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5;
  const g = document.querySelector('header.top .tb-global'), gr = g ? g.getBoundingClientRect() : null;
  return {title: h.textContent, titleW: Math.round(a.width), up: Math.round(b.width), covers: over(a, b) || over(t, b) || (!!c && over(c, b)), coversName: over(t, b), crumbsUnder: !!c && !!gr && over(c, gr), hitsGlobal: !!gr && over(b, gr),
    inRow: b.right <= document.querySelector('header.top').getBoundingClientRect().right + 0.5}; }"""
def brand(pg, look):
    b = pg.evaluate(BRAND)
    ok(b and not b["shown"], look + ": no words under FinCom in the sidebar (%s)" % (b and b["content"][:50]))
    ok(b and b["h"] <= 48, look + ": the sidebar's brand row is one short row (%s px)" % (b and b["h"]))
    ok(b and b["strip"] == "", look + ": no bar along the foot of the page (%s)" % (b and b["strip"][:60]))
    ok(b and "staging database" in (b["tip"] or "") and "Made-up review words" in (b["tip"] or ""), look + ": the site's words are the tooltip on the Synced/Saved line (%r)" % (b and b["tip"]))
    ok(b and "staging database" in b["more"], look + ": … and under its ⓘ (%r)" % (b and b["more"][:60]))

def page(br, w, h=760, nl=False, phone=False):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=phone and ENGINE != "firefox", has_touch=phone)
    if nl: ctx.add_init_script(NL_ON)
    if not phone: ctx.add_init_script(UNFOLD)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(1800)
    return ctx, pg
def shot(pg, name, full=False):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, ENGINE + "-" + name + ".png"), full_page=full)
def go(pg, js, ms=1200): pg.evaluate("() => { " + js + " }"); pg.wait_for_timeout(ms)

with sync_playwright() as p:
    br = getattr(p, ENGINE).launch()
    print("engine: %s %s" % (ENGINE, br.version))
    for w in (1000, 1440):
        print("1. New look, Bank header at %d px" % w)
        ctx, pg = page(br, w, nl=True)
        ok(pg.evaluate("document.documentElement.classList.contains('nl')"), "the new look is on")
        hd = pg.evaluate(HEAD)
        pk = hd and hd["pick"]
        ok(pk is not None, "the statement's box is drawn by the new look (%s)" % (hd and hd["sel"]))
        if pk:
            ok(pk["lines"] == 1 and pk["ellipsis"], "the statement's name: one line, cut with an ellipsis (%s)" % pk)
            ok(pk["inHead"] and pk["inId"] and pk["textIn"], "the statement's box and its words wholly inside the header, not clipped (%s)" % pk)
            ok(pk["roomy"] and 26 <= pk["h"] <= 34, "the statement's box is a proper height, room for its words (%s)" % pk)
            ok("Demo Bank OD" in pk["text"] and "09-Nov-2026" in pk["text"], "it names the bank and the period (%r)" % pk["text"])
            if w == 1000: ok(pk["cut"], "at 1000 px the long name is cut with … rather than pushing the figures away")
        sel = hd and hd["sel"]
        ok(sel is not None and sel["inHead"] and sel["inId"], "the list itself sits over the box, inside the header (%s)" % sel)
        cl = hd and hd["client"]
        ok(cl is not None and cl["lines"] == 1 and cl["ellipsis"] and cl["inHead"] and cl["inId"] and cl["roomy"], "the client's name: one line with an ellipsis, not clipped (%s)" % cl)
        if pk and cl: ok(abs(pk["mid"] - cl["mid"]) <= 2, "the client's name and the statement's box on one line, centred alike (%.1f vs %.1f)" % (cl["mid"], pk["mid"]))
        if w >= 1440:
            one = pg.evaluate("() => { const h = document.querySelector('#app [data-bank-head]'); const tops = [...h.children].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().top)); return Math.max(...tops) - Math.min(...tops); }")
            ok(one <= 12, "at %d px the header is one line (rows %d px apart)" % (w, one))
        ok(hd and hd["headRight"] <= hd["vw"] + 1 and pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "no sideways scroll")
        tb = pg.evaluate(TOPBAR)
        ok(tb and not tb["covers"] and not tb["crumbsUnder"] and not tb["hitsGlobal"] and tb["up"] >= 100 and tb["inRow"], "the top bar: Upload statement keeps its width; nothing is drawn over the page's name or the client's line (%s)" % tb)
        shot(pg, "%d-new-bank" % w)
        if SHOTS: pg.locator("#app [data-bank-head]").screenshot(path=os.path.join(SHOTS, ENGINE + "-%d-new-bank-head.png" % w))
        pg.select_option("#app select.bk-stmtsel", "s0"); pg.wait_for_timeout(1200)
        ok(pg.evaluate("S.bank.cur") == "s0", "choosing in the box still opens the other statement")
        hd2 = pg.evaluate(HEAD)
        ok(hd2 and hd2["pick"] and "31-May-2026" in hd2["pick"]["text"], "the box then names it (%s)" % (hd2 and hd2["pick"] and hd2["pick"]["text"]))
        print("2. New look: the sidebar and the foot")
        brand(pg, "new look")
        if SHOTS: pg.locator("#side").screenshot(path=os.path.join(SHOTS, ENGINE + "-%d-new-side.png" % w))
        ctx.close()

        print("4. off at %d px: as before" % w)
        ctx, pg = page(br, w)
        ok(not pg.evaluate("document.documentElement.classList.contains('nl')"), "the classic look")
        hd = pg.evaluate(HEAD)
        ok(hd and hd["pick"] is None and hd["sel"] is not None and hd["selSeen"] == "1", "the Bank header's own list, as before")
        brand(pg, "classic")
        tb = pg.evaluate(TOPBAR)
        # (the classic look is left as it is: at 1000 px with the menu's words its Upload also runs over the client's line, not the name)
        ok(tb and not tb["coversName"], "classic top bar: Upload statement does not cover the page's name (%s)" % tb)
        shot(pg, "%d-classic-bank" % w)
        print("3. classic Settings: My account > Look")
        go(pg, "goSettings(null)", 1500)
        groups = pg.evaluate("() => [...document.querySelectorAll('.setgroup-t')].map((e) => e.textContent)")
        items = pg.evaluate("() => [...document.querySelectorAll('[data-set-item]')].map((e) => e.dataset.setItem)")
        ok("My account" in groups and "look" in items, "a group My account with Look (%s / %s)" % (groups, items))
        for k in ("bridge", "postlog", "rates", "reading", "moves"): ok(k in items, "classic keeps %s" % k)
        ab = pg.locator("[data-about]").inner_text() if pg.locator("[data-about]").count() else ""
        ok("this version was built on" in ab and "staging database" in ab, "Settings' About line keeps the build and the site's words (%r)" % ab)
        if "look" in items:
            pg.locator('[data-set-item="look"]').first.click(); pg.wait_for_timeout(800)
            ok(pg.locator("[data-set-newlook]").count() == 1 and not pg.locator("[data-set-newlook]").is_checked(), "Look: New look, off")
            ok(pg.locator("[data-set-compact]").count() == 1, "Look: Compact rows")
            shot(pg, "%d-classic-settings-look" % w)
            pg.locator("[data-set-newlook]").click(); pg.wait_for_timeout(1500)
            ok(pg.evaluate("document.documentElement.classList.contains('nl')"), "turned on here: the new look at once")
            ok(pg.evaluate("localStorage.getItem('fincom:newlook:local')") == "on", "kept for this person")
            pg.evaluate("localStorage.setItem('fincom:newlook:local', 'off')")
        ctx.close()
        ctx, pg = page(br, w)
        go(pg, "navHome('clients')", 1200)
        pg.locator(".firmbtn").click(); pg.wait_for_timeout(300)
        ok(pg.locator("[data-newlook-switch]").count() == 1, "the firm menu keeps its New look item")
        ctx.close()

    print("5. a phone (390 px), New look")
    ctx, pg = page(br, 390, 844, nl=True, phone=True)
    ok(pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "Bank: no sideways scroll")
    hd = pg.evaluate(HEAD)
    pk = hd and hd["pick"]
    ok(pk is not None and pk["lines"] == 1 and pk["inHead"] and pk["right"] <= 390, "the statement's box: one line, inside the header and the screen (%s)" % pk)
    shot(pg, "390-new-bank")
    ctx.close()
    ctx, pg = page(br, 390, 844, phone=True)
    go(pg, "goSettings('look')", 1500)
    ok(pg.locator("[data-set-newlook]").count() == 1, "phone, classic: Settings › Look opens")
    shot(pg, "390-classic-settings-look")
    ctx.close()
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
