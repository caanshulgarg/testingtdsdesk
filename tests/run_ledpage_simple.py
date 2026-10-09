"""python3 run_ledpage_simple.py - the simpler GST and TDS ledgers page (FinCom 2.4.0; updated for 2.4.1, where the page
is one table, see run_ledpage241.py: Needs you became "Please check" plus an "Other notices" fold, GST and TDS one table,
the confirmed are no longer folded, More and its tabs are gone, a change is saved at once; the owner of 08-Oct-2026: "there
should be simple page of tds & gst tally ledger import page.. it is currently in very bad shape.. take it with 2.4").
  1. one status line a book: "Ledgers from Tally: 73 · last updated 2 min ago · 5 need you", with "Read again now" only
     where it exists (the cloud copy here: Ledgers.refresh; nothing is asked of Tally) and an Upload button only when no
     bridge or cloud copy serves the client;
  2. three short sections, one answer and one action a row: GST ledgers (ledger -> what FinCom treats it as -> Confirm /
     Change), TDS ledgers (ledger -> section and nature of payment -> Confirm / Change), Needs you (renamed ledger: owner's
     Confirm; unknown ledger used by entries: Read the ledgers again; two ledgers with one GSTIN and a PAN not in its
     GSTIN: Fine as it is) - every ledger on one row only, no second list with tick boxes;
  3. confirmed ledgers fold to "N ledgers confirmed — show"; the find box; the client picked;
  4. the rest under More (other ledgers, what FinCom posts to, check again); staff: no rename Confirm, ledgers still
     confirmed; phone width: readable rows, no sideways scroll.
Made-up client: tests/ledpage_setup.py (fixture books and masters, FinCom's cloud made up in the page, offline).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ledpage_simple.py"""
import json, os, sys, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ledpage_setup as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
ROWS = "#app [data-led-table] tbody tr[data-key]"
with sync_playwright() as p:
    srv, br, pg = L.start(p, 8398, SITE, errors=errors)
    E = pg.evaluate; T = lambda sel="#app": pg.inner_text(sel)
    # no request to Tally from this page: every bridge call is recorded
    BRIDGE = "() => { window.__bridge = []; Bridge.call = async (u, b) => { window.__bridge.push(String(u)); throw new Error('no bridge in this test'); }; }"
    L.open_page(pg, "owner"); E(BRIDGE)
    # ---------- 1. the status line (2.4.1: "· N need you" is gone with the Needs-you list; "updated", not "last updated")
    st = T("#app [data-led-status]")
    m = re.search(r"Ledgers from Tally: ([\d,]+) · updated (\d+) min ago", st)
    ok(m is not None, "one status line: %r" % st.split("\n")[0])
    ok(m and int(m.group(1).replace(",", "")) == E("Ledgers.status(S.books.cid).n"), "its count is the bridge's ledger list in FinCom's cloud")
    ok(pg.locator("#app [data-led-read='cloud']").count() == 1 and pg.locator("#app [data-led-upload-btn]").count() == 0, "Read again now (the cloud copy), and no upload while the cloud copy serves the client")
    # ---------- 2. one answer a ledger, on one row only; no second list, no tick boxes (2.4.1: one table for GST and TDS)
    keys = E("() => [...document.querySelectorAll('#app table[data-led-table=main] tbody tr[data-key]')].map(r => r.dataset.key)")
    ok(len(keys) > 5 and len(keys) == len(set(keys)), "every ledger on one row only (%d rows)" % len(keys))
    ok(pg.locator("#app [data-ledcheck]").count() == 0 and pg.locator("#app [data-ledpage] input[type=checkbox]").count() == 0, "no second list with tick boxes")
    pend = E("LedMaster.pending(S.books).map(([n]) => n)")
    shown = set(keys)
    ok(all(n in shown for n in pend), "every ledger still to confirm is on the page (%d)" % len(pend))
    main = pg.locator("#app table[data-led-table=main] tbody tr[data-key]")
    open_rows = pg.locator("#app table[data-led-table=main] tbody tr[data-ok='0']:has([data-led-confirm])")
    one = all(open_rows.nth(i).locator("[data-led-confirm]").count() == 1 and open_rows.nth(i).locator("[data-led-change]").count() == 1 for i in range(open_rows.count()))
    ok(open_rows.count() > 3 and one, "each row to confirm: one Confirm and one Change (%d)" % open_rows.count())
    gst1 = pg.locator("#app table[data-led-table=main] tr[data-key='07 CGST INPUT']")
    says = gst1.locator(".led-says").inner_text() if gst1.count() else ""
    ok(re.search(r"(CGST|SGST|IGST|CESS)( \+ SGST)? (input|output)", says) is not None, "what FinCom reads it as, in words: %r" % says)
    row194 = pg.locator("#app table[data-led-table=main] tr[data-key='TDS ON CONTRACT 194C']")
    ok(row194.count() == 1 and "194-C" in row194.inner_text(), "TDS ledgers: the section (%r)" % (row194.inner_text() if row194.count() else ""))
    # ---------- Please check: the masters line (unknown ledger used by entries), one action
    unk = pg.locator("#app [data-led-check] [data-led-line=unknown]")
    ok(unk.count() == 1 and "'New Party Pvt Ltd' is used by 2 entries" in unk.inner_text() and unk.locator("[data-led-read-need]").count() == 1, "unknown ledger: one line for the ledger (2 entries), Read the ledgers again")
    ok(pg.locator("#app [data-unknown-ledgers]").count() == 0, "the long one-sentence-an-entry box is not repeated on this page")
    # ---------- Other notices (2.4.1: moved from Needs you to one fold at the bottom)
    pg.click("#app details[data-led-notices] > summary"); pg.wait_for_timeout(200)
    rn = pg.locator("#app [data-led-notices] tr[data-notice=renamed]")
    ok(rn.count() == 1 and rn.locator("button[data-rename-confirm='%s']" % L.RENAMED).count() == 1, "renamed in Tally: the owner's Confirm")
    ok(pg.locator("#app [data-renamed='%s']" % L.RENAMED).count() == 1, "one rename line on the page")
    g = pg.locator("#app [data-led-notices] tr[data-notice=gstin]")
    ok(g.count() == 1 and "Sharma Traders, Sharma Traders (Old)" in g.inner_text() and L.SAME_GSTIN in g.inner_text(), "same GSTIN on two ledgers")
    pn = pg.locator("#app [data-led-notices] tr[data-notice=pan]")
    ok(pn.count() == 1 and "Kumar Consultants" in pn.inner_text() and "ABCPK9999D" in pn.inner_text(), "a PAN that is not the one in its GSTIN")
    # a ledger FinCom could not tell: in the table, "Not known yet", Change to say what it is (2.4.1: no Needs you)
    uc = pg.locator("#app table[data-led-table=main] tr[data-key=%s]" % json.dumps(L.UNCLEAR))
    ok(uc.count() == 1 and "Not known yet" in uc.inner_text() and uc.locator("[data-led-confirm]").count() == 0, "a ledger FinCom could not tell: 'Not known yet', no Confirm")
    uc.locator("[data-led-change]").click(); pg.wait_for_timeout(300)
    pg.select_option('select[aria-label="What %s is"]' % L.UNCLEAR, "gst_setoff"); pg.wait_for_timeout(400)
    ok(E("(n) => S.books.map[n].what + '|' + S.books.map[n].ok", L.UNCLEAR) == "gst_setoff|true", "Change: chosen by hand, confirmed")
    pg.click("#app [data-led-done]"); pg.wait_for_timeout(300)
    # ---------- Confirm and Change
    first = open_rows.first.get_attribute("data-key"); done0 = E("Object.values(S.books.map).filter(m => m.ok).length")
    said = E("(n) => S.books.map[n].what", first)
    open_rows.first.locator("[data-led-confirm]").click(); pg.wait_for_timeout(400)
    ok(E("(n) => !!S.books.map[n].ok", first) and E("(n) => S.books.map[n].what", first) == said and not E("!!S.books.ledCheck.strict"), "Confirm: %s confirmed as the row said (%s); the check's strict switch untouched" % (first, said))
    ok(pg.locator("#app table[data-led-table=main] tr[data-key=%s] [data-led-okby]" % json.dumps(first)).count() == 1, "and the row says ✓ Confirmed by …, in place (2.4.1: no fold)")
    sec = pg.locator("#app table[data-led-table=main] tbody tr[data-ok='0']:has([data-led-confirm])").filter(has_text="GST").first; second = sec.get_attribute("data-key")
    side = E("(n) => S.books.map[n].side", second); want = "output" if side == "input" else "input"
    sec.locator("[data-led-change]").click(); pg.wait_for_timeout(300)
    ok(pg.locator("#app [data-led-editor=%s]" % json.dumps(second)).count() == 1 and E("(n) => !S.books.map[n] || !S.books.map[n].ok", second), "Change opens the choices in the row; nothing changes by opening it")
    pg.select_option('select[aria-label="Side of %s"]' % second, want); pg.wait_for_timeout(400)
    ok(E("(n) => S.books.map[n].side", second) == want and E("(n) => S.books.map[n].ok", second), "a change by hand: %s is %s, and confirmed" % (second, want))
    ok(pg.locator('#app [data-confirm-foot]').count() == 0, "2.4.1: a change is saved at once (no Save at the foot)")
    pg.click("#app [data-led-done]") if pg.locator("#app [data-led-done]").count() else None; pg.wait_for_timeout(200)
    # ---------- undo (2.4.1: a separate Undo; ✓ is not a button)
    back = pg.locator("#app table[data-led-table=main] tr[data-key=%s]" % json.dumps(first))
    ok(back.locator("[data-led-undo]").count() == 1, "the confirmed row has its Undo")
    back.locator("[data-led-undo]").click(); pg.wait_for_timeout(300)
    ok(not E("(n) => S.books.map[n].ok", first), "Undo puts it back, not confirmed")
    # ---------- Confirm all (2.4.1: only ledgers used in entries where FinCom and its check agree)
    if pg.locator("#app [data-led-confirm-agree]").count():
        names = E("LedPage.agreeing(S.books)")
        pg.click("#app [data-led-confirm-agree]"); pg.wait_for_timeout(400)
        ok(all(E("(n) => !!S.books.map[n].ok", n) for n in names), "Confirm all: the %d where FinCom and its check agree" % len(names))
    # ---------- notices' actions
    pg.click("#app [data-led-notices] tr[data-notice=gstin] [data-led-fine]"); pg.wait_for_timeout(300)
    ok(pg.locator("#app [data-led-notices] tr[data-notice=gstin]").count() == 0 and E("!!(S.books.ledOk || {})['gstin:%s']" % L.SAME_GSTIN), "Fine as it is: the GSTIN line goes, kept with the books")
    pg.click("#app button[data-rename-confirm='%s']" % L.RENAMED); pg.wait_for_timeout(1200)
    ok(any(c[0] == "tally_ledger_rename_confirm" for c in E("window.__rpc")) and pg.locator("#app [data-renamed='%s']" % L.RENAMED).count() == 0, "rename Confirm: asked of FinCom's cloud, the line goes")
    E("() => { window.__rest = []; }")
    pg.click("#app [data-led-check] [data-led-line=unknown] [data-led-read-need]"); pg.wait_for_timeout(1200)
    ok(any(x.startswith("tally_ledgers") for x in E("window.__rest")), "Read the ledgers again: the cloud copy is read again")
    E("() => { window.__rest = []; }")
    pg.click("#app [data-led-read='cloud']"); pg.wait_for_timeout(1200)
    ok(any(x.startswith("tally_ledgers") for x in E("window.__rest")), "Read again now: the cloud copy is read again")
    ok(E("window.__bridge.length") == 0, "no request to Tally from this page (%s)" % E("window.__bridge"))
    # ---------- find, client, other ledgers (2.4.1: More, what FinCom posts to, AI and Check again are gone)
    pg.fill('#app input[aria-label="Find a ledger"]', "SGST"); pg.wait_for_timeout(500)
    ks = E("() => [...document.querySelectorAll('#app table[data-led-table=main] tbody tr[data-key]')].map(r => r.dataset.key)")
    ok(len(ks) > 0 and all("SGST" in k.upper() for k in ks) and E("document.activeElement.getAttribute('aria-label')") == "Find a ledger", "the find box filters as typed, keeping the cursor (%s)" % ks)
    pg.fill('#app input[aria-label="Find a ledger"]', ""); pg.wait_for_timeout(400)
    opts = E("() => [...document.querySelectorAll('#app select[data-led-client] option')].map(o => o.textContent)")
    ok("ZZ Test Client" in opts and "ZZ Other Client" in opts, "the client picked: %s" % opts)
    E("() => { window.__go = []; Rec.openClientTab = (c, t) => window.__go.push([c, t]); }")
    other = E("Object.values(S.companies).find(c => c.name === 'ZZ Other Client').id")
    pg.select_option("#app select[data-led-client]", other); pg.wait_for_timeout(200)
    ok(E("window.__go") == [[other, "books:ledgers"]], "picking another client opens its ledgers page")
    ok(pg.locator('#app nav[aria-label="Ledgers"]').count() == 0 and pg.locator("#app [data-more-toggle=ledpage]").count() == 0 and pg.locator("#app [data-led-check-again]").count() == 0, "no More, no tabs, no Check again")
    oth = pg.locator("#app details[data-led-other]")
    ok(oth.count() == 1 and oth.get_attribute("open") is None, "Other ledgers (not tax): folded")
    oth.locator("summary").click(); pg.wait_for_timeout(300)
    ok(pg.locator("#app table[data-led-table=other] tbody tr[data-key]").count() > 5, "Other ledgers: add one FinCom missed (Change)")
    # ---------- staff
    L.open_page(pg, "staff"); E(BRIDGE)
    pg.click("#app details[data-led-notices] > summary"); pg.wait_for_timeout(200)
    rn = pg.locator("#app [data-led-notices] tr[data-notice=renamed]")
    ok(rn.count() == 1 and rn.locator("button").count() == 0 and "an owner of the firm confirms this" in rn.inner_text(), "staff: the rename line, without its Confirm")
    ok(pg.locator("#app [data-led-confirm]").count() > 0 and pg.locator("#app [data-led-change]").count() > 0, "staff confirm and change ledgers, as before")
    r0 = pg.locator("#app table[data-led-table=main] tbody tr[data-ok='0']:has([data-led-confirm])").first
    n = r0.get_attribute("data-key"); r0.locator("[data-led-confirm]").click(); pg.wait_for_timeout(300)
    ok(E("(n) => !!S.books.map[n].ok", n), "staff: Confirm works")
    # ---------- no bridge and no cloud copy: one clear upload
    L.open_page(pg, "owner", cloud=False)
    st = T("#app [data-led-status]")
    ok(pg.locator("#app [data-led-upload-btn]").count() == 1 and pg.locator("#app [data-led-read]").count() == 0, "no bridge: one Upload button, no Read again")
    ok("(from the ledger masters file)" in st, "the status line says the ledgers came from the masters file: %r" % st.split("\n")[0])
    E("() => { window.__picked = 0; const i = document.getElementById('mastersIn'); i.click = () => { window.__picked++; }; }")
    pg.click("#app [data-led-upload-btn]"); pg.wait_for_timeout(200)
    ok(E("window.__picked") == 1, "Upload opens the file chooser for the masters (the existing mastersPick)")
    # ---------- phone width
    L.open_page(pg, "owner")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(800)
    wide = E("document.scrollingElement.scrollWidth")
    over = E("() => { const out = []; document.querySelectorAll('body *').forEach(e => { const r = e.getBoundingClientRect(); if (r.right > 392 && r.width > 0 && !e.closest('nav.side, .side, aside')) out.push(e.tagName + '.' + e.className + ' ' + Math.round(r.right)); }); return out.slice(0, 6); }") if wide > 392 else []
    ok(wide <= 392, "phone: no sideways scroll (%d) %s" % (wide, over))
    r = pg.locator("#app table[data-led-table=main] tbody tr[data-ok='0']:has([data-led-confirm])").first
    ok(r.get_attribute("data-key") in r.inner_text() and r.locator("[data-led-confirm]").is_visible(), "phone: a row reads (its name) with its Confirm in view")
    bb = r.locator("[data-led-confirm]").bounding_box()
    ok(bb and bb["x"] + bb["width"] <= 390, "phone: Confirm within the screen")
    ok(pg.locator("#app [data-led-status]").is_visible() and pg.locator("#app [data-led-check]").is_visible(), "phone: the status line and Please check")
    ok(not errors, "no page errors %s" % errors[:3])
    br.close(); srv.shutdown()
print("\n%d FAILED" % len(fails) if fails else "\nALL PASSED")
sys.exit(1 if fails else 0)
