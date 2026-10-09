"""python3 run_ledpage241.py - the simple GST and TDS ledgers page of FinCom 2.4.1 (the owner's decisions of 09-Oct-2026:
"Yes, build it", "Confirm all" only where FinCom and its check agree, "Keep today's figures").
  A. Cause A: a confirm survives a day-book refresh and a reload. Books.mapLedgers rebuilt b.map only from the ledgers
     used in entries, so a confirmed ledger with no entries (n:0) was dropped, LedMaster.refresh put it back as a guess,
     and the save wiped the confirm. Covered for a row's Confirm, Confirm all, Change, and an n:0 ledger; the refresh is
     the real one (bringDayBookFile with the fixture's day book).
  B. Cause B: Change is saved at once (no Save at the foot, no draft): what is in the browser's store (IndexedDB) after
     opening the books again WITHOUT a save, and what is pushed to FinCom's cloud (a stand-in server shared by two
     computers, as run_ledcheck_saved.py), hold the new value.
  C. "Please check": a ledger confirmed by hand that FinCom's check reads otherwise is listed with both answers and an
     example entry. "Keep mine" takes it off the list and moves no figure; "Use the check's" moves only that ledger's
     figures (they are those of the books with just that ledger changed).
  D. Confirm all touches only the ledgers used in entries (n > 0) where FinCom's answer and its check's agree.
  E. Undo puts back the previous state (a row, the batch of Confirm all, Keep mine, Use the check's, Change).
  F. "TDS 194 T" is read as section 194T (Books.guess and LedMaster.propose), "TDS ON CONTRACT 194C" still 194C.
  G. Gone from the page: Save at the foot, "Confirm the check's sure answers", Check again, the check / likely / AI tags
     and the Why panel, Ask AI, the "What FinCom posts to" and "AI: TDS and credit" tabs. Kept in "Other notices": the
     GSTIN and PAN lines, the renamed-in-Tally confirm (owners only), ledgers changed after returns were made. Kept in
     "Please check": the masters line (a ledger used by entries FinCom does not have yet), with Read the ledgers again.
  H. Staff: Confirm, Change and Undo as before (today's rule); the rename Confirm only for an owner. Phone: no sideways
     scroll.
Made-up client: tests/ledpage_setup.py (fixture books and masters). Offline, but for B (a stand-in server).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ledpage241.py"""
import os, re, sys, json, time, itertools, datetime
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ledpage_setup as L
from books_data import DATA
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("LEDPAGE241_PORT", "8431"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# every figure a return is made from (as run_ledger_pending.py)
FIGS = """() => { const b = S.books, out = {}, r2_ = x => Math.round((x || 0) * 100) / 100;
  if (typeof GSTR === "object"){ GSTR._carry = null; } if (typeof GST2B === "object") GST2B._memo = null; if (typeof LedCheck === "object") LedCheck._held = null;
  const months = GSTR.months(), regs = [""].concat((GSTR.gstins(b) || []).map(g => g.slice(0, 2)));
  const sum = s => ({taxable: r2_(s.taxable), igst: r2_(s.igst), cgst: r2_(s.cgst), sgst: r2_(s.sgst), cess: r2_(s.cess)});
  out.gstr1 = {}; out.gstr3b = {}; out.itc = {};
  months.forEach(m => regs.forEach(r => { const k = m + "|" + r, o = GSTR.one(m, r);
    out.gstr1[k] = ["b2b", "b2cl", "b2c", "cdnr", "nil"].map(t => sum(GSTR.sum(o[t] || [])));
    const t = GSTR.threeB(m, r); out.gstr3b[k] = {itc: t.itc, netItc: t.netItc, net: t.net};
    out.itc[k] = sum(GSTR.sum(GSTR.inward(m, r) || [])); }));
  const tds = rows => rows.map(x => [x.section, x.party || x.name || "", r2_(x.amount), r2_(x.tds), x.date || "", x.pan || ""]).sort((a, c) => JSON.stringify(a).localeCompare(JSON.stringify(c)));
  out.q26 = tds(TDS.rows()); out.q27 = tds(TDS.nrRows()); out.q27e = tds(TDS.tcsRows());
  return JSON.parse(JSON.stringify(out)); }"""
def diff(a, b, path=""):
    if type(a) != type(b): return [path]
    if isinstance(a, dict): return [x for k in sorted(set(a) | set(b)) for x in diff(a.get(k), b.get(k), path + "/" + k)]
    if isinstance(a, list): return [path + "#len"] if len(a) != len(b) else [x for i in range(len(a)) for x in diff(a[i], b[i], path + "/%d" % i)]
    return [] if a == b else [path]
# opened again WITHOUT a save first: what the browser's store holds is what comes back
# (the made-up cloud of ledpage_setup.py answers every read with the ledger list: the cloud copy's own load, which opening
# the books starts, is not made up here and would never end)
REOPEN = """async () => { const cid = S.books.cid; if (typeof TCloud === "object") TCloud.openLoad = async () => {}; S.books = null; await openBooks(cid);
  for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise(r => setTimeout(r, 50)); S.booksTab = "ledgers"; render(); return !!S.books && !S.books.loading; }"""
# the day book read again, the real way (src/js/23 bringDayBookFile): Books.mapLedgers, then LedMaster.refresh, then saved
REFRESH = """async () => { const f = document.getElementById("__dbx").files[0]; const r = await bringDayBookFile(f, "", "", {quiet: true});
  for (let i = 0; i < 100 && S.books.busy; i++) await new Promise(r => setTimeout(r, 50)); render(); return r && r.refused ? r.refused : "ok"; }"""
ADD_DBX = """() => { if (!document.getElementById("__dbx")){ const i = document.createElement("input"); i.type = "file"; i.id = "__dbx"; i.style.display = "none"; document.body.appendChild(i); } }"""
OKOF = "(ns) => ns.map(n => !!(S.books.map[n] || {}).ok)"
ENTRY = "(n) => { const m = S.books.map[n]; if (!m) return null; const c = JSON.parse(JSON.stringify(m)); delete c.n; return c; }"
MAIN = "#app table[data-led-table=main] tbody tr[data-key]"
row = lambda pg, n: pg.locator("#app table[data-led-table=main] tr[data-key=%s]" % json.dumps(n))

with sync_playwright() as p:
    srv, br, pg = L.start(p, PORT, SITE, errors=errors)
    E = pg.evaluate; T = lambda sel="#app": pg.inner_text(sel)
    E(ADD_DBX); pg.set_input_files("#__dbx", os.path.join(DATA, "DayBook.xml"))
    # ---------- 0. Causes A and B on any build (the red evidence on 2.4.0): the engine's confirm, and the page's Change
    L.open_page(pg, "owner")
    one0, zero0 = E("""() => { const t = Object.entries(S.books.map).filter(([n, m]) => (LedMaster.isGst(m.what) || LedMaster.isTds(m.what)) && !m.ok);
      return [(t.find(([n, m]) => (m.n || 0) > 0) || [""])[0], (t.find(([n, m]) => !((m.n || 0) > 0)) || [""])[0]]; }""")
    E("(ns) => Drafts.direct(() => { LedMaster.confirm(S.books, ns, true); saveBooks(); }, {bypass: true})", [one0, zero0]); pg.wait_for_timeout(400)
    rr = E(REFRESH); pg.wait_for_timeout(500)
    ok(E(OKOF, [one0, zero0]) == [True, True], "0. Cause A: confirmed %s (used in entries) and %s (no entries), then the day book read again (%s): both still confirmed (%s)" % (one0, zero0, rr, E(OKOF, [one0, zero0])))
    ok(E(REOPEN) and E(OKOF, [one0, zero0]) == [True, True], "0. Cause A: ... and after a reload (%s)" % E(OKOF, [one0, zero0]))
    ch0 = E("() => { const r = [...document.querySelectorAll('#app [data-led-table] tbody tr[data-key]')].find(t => t.querySelector('[data-led-change]') && /^gst$/.test((S.books.map[t.dataset.key] || {}).what || '') && !S.books.map[t.dataset.key].ok); return r ? r.dataset.key : ''; }")
    s0 = E("(n) => S.books.map[n].side", ch0); ns0 = "output" if s0 == "input" else "input"
    pg.click("#app [data-led-change=%s]" % json.dumps(ch0)); pg.wait_for_timeout(300)
    pg.select_option('select[aria-label="Side of %s"]' % ch0, ns0); pg.wait_for_timeout(600)
    ok(E(REOPEN) and E("(n) => [S.books.map[n].side, !!S.books.map[n].ok]", ch0) == [ns0, True], "0. Cause B: Change (%s to %s) is in the browser's store after a reload with no Save (%s)" % (ch0, ns0, E("(n) => [S.books.map[n].side, !!S.books.map[n].ok]", ch0)))
    L.open_page(pg, "owner")
    f0 = E(FIGS)
    # ---------- G. what is gone, what moved
    ok(pg.locator("#app [data-ledpage]").count() == 1 and pg.locator("#app table[data-led-table=main]").count() == 1, "G. one main table")
    ok(pg.locator('#app [data-confirm-foot="books:ledgers"]').count() == 0 and pg.locator("#app [data-confirm='books:ledgers']").count() == 0, "G. no Save at the foot, no draft section")
    gone = {"Confirm the check's sure answers": "[data-led-confirm-sure]", "Check again": "[data-led-check-again]", "Ask AI": "[data-led-ai]", "Why panel": "[data-led-why]",
            "More": "[data-more-toggle=ledpage]", "tabs": 'nav[aria-label="Ledgers"]'}
    ok(all(pg.locator("#app " + s).count() == 0 for s in gone.values()), "G. gone: %s" % ", ".join(k for k, s in gone.items() if pg.locator("#app " + s).count() == 0))
    txt = T("#app [data-ledpage]") if pg.locator("#app [data-ledpage]").count() else ""
    ok(not re.search(r"check differs|\blikely\b|What FinCom posts|AI: TDS and credit|Checked \d|Suggestions you have not confirmed", txt), "G. no check-differs / likely / AI tags, no posting or AI tab, no 'Checked …', no footnote")
    heads = E("() => [...document.querySelectorAll('#app table[data-led-table=main] thead th')].map(t => t.textContent.trim().toLowerCase())")
    ok(heads[:4] == ["ledger in your tally", "fincom reads it as", "used in (entries)", "example entry"], "G. the columns: %s" % heads)
    st = T("#app [data-led-status]") if pg.locator("#app [data-led-status]").count() else ""
    ok(re.search(r"Ledgers from Tally: [\d,]+ · updated ", st) is not None and pg.locator("#app [data-led-read]").count() == 1, "G. status line with Read again now: %r" % st.split("\n")[0])
    ok(pg.locator("#app details[data-led-notices]").count() == 1, "G. one 'Other notices' fold")
    nt = E("() => { const d = document.querySelector('#app details[data-led-notices]'); if (!d) return ''; d.open = true; return d.innerText; }"); pg.wait_for_timeout(200)
    ok(L.SAME_GSTIN in nt and "Kumar Consultants" in nt and "ABCPK9999D" in nt, "G. the GSTIN and PAN lines are in Other notices")
    ok(pg.locator("#app details[data-led-notices] [data-renamed='%s'] button[data-rename-confirm]" % L.RENAMED).count() == 1, "G. the renamed-in-Tally confirm is in Other notices (owner)")
    chk = pg.locator("#app [data-led-check]")
    unk = pg.locator("#app [data-led-check] [data-led-line=unknown]")
    ok(unk.count() == 1 and "New Party Pvt Ltd" in unk.inner_text() and unk.locator("[data-led-read-need]").count() == 1, "G. the masters line is in Please check, with Read the ledgers again")
    # ---------- F. TDS 194 T
    g = E("() => [Books.guess('TDS 194 T').section, LedMaster.propose('TDS 194 T', {}, null, []).section, Books.guess('TDS ON CONTRACT 194C').section, Books.guess('TDS PAYABLE 194 A/C').section || '', LedCheck.section('TDS 194 T')]")
    ok(g[0] == "194T" and g[1] == "194T", "F. 'TDS 194 T' is section 194T (guess %s, propose %s)" % (g[0], g[1]))
    ok(g[2] == "194C" and g[3] != "194A" and g[4] == "194T", "F. 'TDS ON CONTRACT 194C' still 194C; 'TDS PAYABLE 194 A/C' not 194A (%s); the check agrees (%s)" % (g[3], g[4]))
    # ---------- D. Confirm all: only n > 0 where both agree
    want = E("""() => Object.entries(S.books.map).filter(([n, m]) => (LedMaster.isGst(m.what) || LedMaster.isTds(m.what)) && !m.ok && (m.n || 0) > 0 &&
      (() => { const it = (S.books.ledCheck.items || {})[n], s = it && it.s; return !!(s && s.what && s.conf !== 'low' && LedPage.same(s, m)); })()).map(([n]) => n).sort()""")
    btn = pg.locator("#app [data-led-confirm-agree]")
    ok(btn.count() == 1 and ("Confirm %d ledgers that FinCom and its check agree on" % len(want)) in btn.inner_text(), "D. 'Confirm %d ledgers that FinCom and its check agree on' (%r)" % (len(want), btn.inner_text() if btn.count() else ""))
    before_all = E("() => JSON.parse(JSON.stringify(S.books.map))")
    if btn.count(): btn.click(); pg.wait_for_timeout(500)
    now_ok = E("(b) => Object.keys(S.books.map).filter(n => S.books.map[n].ok && !(b[n] || {}).ok).sort()", before_all)
    ok(len(want) > 2 and now_ok == want, "D. Confirm all confirmed exactly those %d (%s)" % (len(want), [x for x in now_ok if x not in want] or [x for x in want if x not in now_ok] or "same"))
    ok(not diff(f0, E(FIGS)), "D. ... and no figure moved")
    ok(pg.locator("#app [data-led-confirm-agree]").count() == 0, "D. the button goes once nothing is left to confirm that way")
    # ---------- E. Undo of the batch
    ub = pg.locator("#app [data-led-undo-bar] [data-led-undo-last]")
    ok(ub.count() == 1, "E. one Undo for the batch")
    if ub.count(): ub.click(); pg.wait_for_timeout(500)
    ok(E("(b) => Object.keys(b).every(n => JSON.stringify(Object.assign({}, b[n], {n: 0})) === JSON.stringify(Object.assign({}, S.books.map[n], {n: 0})))", before_all), "E. Undo: every ledger is as before Confirm all")
    pg.locator("#app [data-led-confirm-agree]").click() if pg.locator("#app [data-led-confirm-agree]").count() else None; pg.wait_for_timeout(500)
    # ---------- the owner of 09-Oct-2026: "if I want to edit the confirm ledger, then I should be able to do that"
    cg = E("() => { const r = [...document.querySelectorAll('#app table[data-led-table=main] tbody tr[data-key]')].find(t => t.querySelector('[data-led-okby]') && t.querySelector('[data-led-change]') && (S.books.map[t.dataset.key] || {}).what === 'gst' && (S.books.map[t.dataset.key] || {}).n > 0); return r ? r.dataset.key : ''; }")
    ok(bool(cg), "K. a confirmed GST ledger used in entries, with Change beside '✓ Confirmed' and Undo (%s)" % cg)
    if cg:
        e_cg = E(ENTRY, cg); n_cg = E("(n) => S.books.map[n].n", cg); fb = E(FIGS)
        old_side = e_cg["tax"]; cg_side = "CGST" if old_side == "IGST" else "IGST"   # the head: it moves the GST figures
        E("() => { window.__before = JSON.parse(JSON.stringify(S.books)); }")
        row(pg, cg).locator("[data-led-change]").click(); pg.wait_for_timeout(300)
        q = pg.locator("#confirmBox .cbx")
        qt = q.inner_text() if q.count() else ""
        ok(("This ledger is used in %d entries; your GST figures will change. Change it?" % n_cg) in qt, "K. asked once: %r" % qt.replace("\n", " ")[:160])
        ok(pg.locator("#app [data-led-editor=%s]" % json.dumps(cg)).count() == 0, "K. nothing opens before the answer")
        if q.count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
        pg.select_option('select[aria-label="Head of %s"]' % cg, cg_side); pg.wait_for_timeout(500)
        mm = E("(n) => S.books.map[n]", cg)
        ok(mm["tax"] == cg_side and mm.get("ok") and mm.get("okBy") and mm.get("okAt") != e_cg.get("okAt") and (mm.get("prev") or {}).get("tax") == old_side,
           "K. saved at once: %s is %s, confirmed by %s with a fresh time; the answer before kept (prev: %s)" % (cg, cg_side, mm.get("okBy"), (mm.get("prev") or {}).get("tax")))
        fu = E(FIGS)
        E("(n) => { window.__after = S.books; const c = window.__before; c.map[n] = JSON.parse(JSON.stringify(S.books.map[n])); c.mapV = (c.mapV || 0) + 1; S.books = c; }", cg)
        fx = E(FIGS); E("() => { S.books = window.__after; S.books.mapV = (S.books.mapV || 0) + 1; render(); }")
        ok(diff(fb, fu) and not diff(fx, fu), "K. only that ledger's figures move (%d figures; the books with just %s changed give the same)%s" % (len(diff(fb, fu)), cg, (" DIFFERS " + str(diff(fx, fu)[:4])) if diff(fx, fu) else ""))
        if pg.locator("#app [data-led-done]").count(): pg.click("#app [data-led-done]"); pg.wait_for_timeout(300)
        rr = E(REFRESH); pg.wait_for_timeout(500)
        ok(E("(n) => [S.books.map[n].tax, !!S.books.map[n].ok]", cg) == [cg_side, True], "K. the new answer survives a day-book refresh (%s)" % rr)
        ok(E(REOPEN) and E("(n) => [S.books.map[n].tax, !!S.books.map[n].ok]", cg) == [cg_side, True], "K. ... and a reload")
        pg.wait_for_timeout(300)
        if row(pg, cg).locator("[data-led-undo]").count(): row(pg, cg).locator("[data-led-undo]").click(); pg.wait_for_timeout(400)
        ok(E(ENTRY, cg) == e_cg and not diff(fb, E(FIGS)), "K. Undo puts the old answer back (%s, confirmed as before) and the figures with it" % E("(n) => S.books.map[n].tax", cg))
        # no question when no entry uses it
        z = E("() => { const r = [...document.querySelectorAll('#app table[data-led-table=main] tbody tr[data-key]')].find(t => t.querySelector('[data-led-change]') && !((S.books.map[t.dataset.key] || {}).n > 0) && (S.books.map[t.dataset.key] || {}).ok); return r ? r.dataset.key : ''; }")
        if not z:
            z = E("() => { const r = [...document.querySelectorAll('#app table[data-led-table=main] tbody tr[data-key]')].find(t => t.querySelector('[data-led-confirm]') && !((S.books.map[t.dataset.key] || {}).n > 0)); return r ? r.dataset.key : ''; }")
            if z: row(pg, z).locator("[data-led-confirm]").click(); pg.wait_for_timeout(400)
        if z:
            row(pg, z).locator("[data-led-change]").click(); pg.wait_for_timeout(300)
            ok(pg.locator("#confirmBox .cbx").count() == 0 and pg.locator("#app [data-led-editor=%s]" % json.dumps(z)).count() == 1, "K. a confirmed ledger no entry uses: Change opens at once, no question (%s)" % z)
            if pg.locator("#app [data-led-done]").count(): pg.click("#app [data-led-done]"); pg.wait_for_timeout(200)
            row(pg, z).locator("[data-led-undo]").click() if row(pg, z).locator("[data-led-undo]").count() else None; pg.wait_for_timeout(300)
    # ---------- A. a row's Confirm, an n:0 ledger, Change
    one = E("() => { const r = [...document.querySelectorAll('#app table[data-led-table=main] tbody tr[data-key]')].find(t => t.querySelector('[data-led-confirm]') && (S.books.map[t.dataset.key] || {}).n > 0); return r ? r.dataset.key : ''; }")
    zero = E("() => { const r = [...document.querySelectorAll('#app table[data-led-table=main] tbody tr[data-key]')].find(t => t.querySelector('[data-led-confirm]') && !((S.books.map[t.dataset.key] || {}).n > 0)); return r ? r.dataset.key : ''; }")
    ok(bool(one) and bool(zero), "A. a ledger used in entries to confirm (%s) and one with no entries (%s)" % (one, zero))
    e1 = E(ENTRY, one)
    for n in (one, zero):
        if n: row(pg, n).locator("[data-led-confirm]").click(); pg.wait_for_timeout(400)
    ok(E(OKOF, [one, zero]) == [True, True], "A. Confirm on the rows: both confirmed")
    r1 = row(pg, one)
    ok(r1.locator("[data-led-okby]").count() == 1 and re.search(r"✓ Confirmed by .+, \d\d-[A-Z][a-z]{2}-\d{4}", r1.locator("[data-led-okby]").inner_text()) is not None and r1.locator("[data-led-undo]").count() == 1,
       "A. a confirmed row: '%s' and a separate Undo" % (r1.locator("[data-led-okby]").inner_text() if r1.locator("[data-led-okby]").count() else ""))
    ok(r1.locator("button[data-led-okby]").count() == 0, "A. ✓ itself is not a button (not a hidden undo)")
    # Change: a GST ledger's side, saved at once
    ch = E("() => { const r = [...document.querySelectorAll('#app table[data-led-table=main] tbody tr[data-key]')].find(t => t.querySelector('[data-led-change]') && /^gst$/.test((S.books.map[t.dataset.key] || {}).what || '') && (S.books.map[t.dataset.key] || {}).n > 0 && t.dataset.key !== %s); return r ? r.dataset.key : ''; }" % json.dumps(cg))
    side = E("(n) => S.books.map[n].side", ch); new_side = "output" if side == "input" else "input"
    e_ch = E(ENTRY, ch)
    row(pg, ch).locator("[data-led-change]").click(); pg.wait_for_timeout(300)
    if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#app [data-led-editor=%s]" % json.dumps(ch)).count() == 1 and E(ENTRY, ch) == e_ch, "A. Change opens the choices; opening it changes nothing")
    pg.select_option('select[aria-label="Side of %s"]' % ch, new_side); pg.wait_for_timeout(500)
    ok(E("(n) => [S.books.map[n].side, !!S.books.map[n].ok, S.books.map[n].okBy || '']", ch)[:2] == [new_side, True], "A. Change: %s is %s, confirmed by this person" % (ch, new_side))
    ok(pg.locator('#app [data-confirm-foot]').count() == 0 and "Not saved yet" not in T(), "B. no Save button, nothing 'Not saved yet'")
    if pg.locator("#app [data-led-done]").count(): pg.click("#app [data-led-done]"); pg.wait_for_timeout(300)
    ok(E("Drafts.hold('books:' + S.books.cid)") is False, "B. the books' saving is not held by a draft")
    # the day book read again, then opened again without a save
    rr = E(REFRESH); pg.wait_for_timeout(600)
    names = want + [one, zero, ch]
    ok(rr == "ok" and all(E(OKOF, names)), "A. after a day-book refresh (%s): the %d confirmed (Confirm all, rows, Change, n:0) stay confirmed%s" % (rr, len(names), "" if all(E(OKOF, names)) else " LOST: " + str([n for n, v in zip(names, E(OKOF, names)) if not v])))
    ok(E("(n) => !!S.books.map[n] && S.books.map[n].ok && (S.books.map[n].n || 0) === 0", zero), "A. the n:0 ledger %s is kept in the map, confirmed, n:0" % zero)
    ok(E("(n) => S.books.map[n].side", ch) == new_side, "A. Change kept after the refresh")
    ok(E(REOPEN), "opened again (no save)")
    okn = E(OKOF, names)
    ok(all(okn), "A+B. after the reload: still confirmed (%d of %d)%s" % (sum(okn), len(okn), "" if all(okn) else " LOST: " + str([n for n, v in zip(names, okn) if not v])))
    ok(E("(n) => S.books.map[n].side", ch) == new_side, "B. Change in the browser's store after the reload, no Save: %s %s" % (ch, E("(n) => S.books.map[n].side", ch)))
    # ---------- E. a row's Undo puts back what was there
    pg.wait_for_timeout(300)
    if row(pg, one).locator("[data-led-undo]").count(): row(pg, one).locator("[data-led-undo]").click(); pg.wait_for_timeout(400)
    ok(E(ENTRY, one) == e1, "E. a row's Undo: %s as before its Confirm" % one)
    if row(pg, ch).locator("[data-led-undo]").count(): row(pg, ch).locator("[data-led-undo]").click(); pg.wait_for_timeout(400)
    ok(E(ENTRY, ch) == e_ch, "E. Undo of a Change: %s as before (side %s)" % (ch, E("(n) => S.books.map[n].side", ch)))
    # ---------- C. Please check: confirmed by hand, the check reads it otherwise
    E(L.SET_DIFFERS, L.DIFFERS); pg.wait_for_timeout(500)
    rv = pg.locator("#app [data-led-check] tr[data-led-review=%s]" % json.dumps(L.DIFFERS))
    rt = rv.inner_text() if rv.count() else ""
    ok(rv.count() == 1 and "You confirmed: SGST output" in rt and "FinCom’s check reads: CGST output" in rt.replace("'", "’"), "C. Please check lists %s with both answers: %r" % (L.DIFFERS, rt.replace("\n", " | ")[:200]))
    ok(rv.locator("[data-led-example]").count() == 1 and re.search(r"(Sales|Purchase|Journal|Credit Note|Debit Note|Payment|Receipt)\S* .*\d\d-[A-Z][a-z]{2}-\d{4}.*₹", rv.locator("[data-led-example]").inner_text()) is not None,
       "C. with an example entry: %r" % (rv.locator("[data-led-example]").inner_text() if rv.locator("[data-led-example]").count() else ""))
    fk = E(FIGS); ek = E(ENTRY, L.DIFFERS)
    if rv.locator("[data-led-keep-mine]").count(): rv.locator("[data-led-keep-mine]").click(); pg.wait_for_timeout(500)
    kept = E("(n) => S.books.map[n].kept || null", L.DIFFERS)
    ok(rv.count() == 0 and kept and kept.get("by") and kept.get("at"), "C. Keep mine: off the list, recorded by %s at %s" % ((kept or {}).get("by"), (kept or {}).get("at")))
    ok(not diff(fk, E(FIGS)) and E("(n) => S.books.map[n].tax", L.DIFFERS) == "SGST", "C. Keep mine moves no figure")
    ok(E(REOPEN) and pg.locator("#app [data-led-check] tr[data-led-review=%s]" % json.dumps(L.DIFFERS)).count() == 0, "C. after a reload it stays off the list")
    if pg.locator("#app [data-led-undo-bar] [data-led-undo-last]").count() == 0:
        row(pg, L.DIFFERS).locator("[data-led-undo]").click() if row(pg, L.DIFFERS).locator("[data-led-undo]").count() else None
    else: pg.click("#app [data-led-undo-bar] [data-led-undo-last]")
    pg.wait_for_timeout(500)
    ok(E(ENTRY, L.DIFFERS) == ek and rv.count() == 1, "E. Undo of Keep mine: back on the list, as before")
    # Use the check's: only that ledger's figures move
    E("() => { window.__before = JSON.parse(JSON.stringify(S.books)); }")
    if rv.locator("[data-led-use-check]").count(): rv.locator("[data-led-use-check]").click(); pg.wait_for_timeout(600)
    m = E("(n) => S.books.map[n]", L.DIFFERS)
    ok(m["tax"] == "CGST" and m["side"] == "output" and m.get("ok") and m.get("okBy") and m.get("okAt") and rv.count() == 0, "C. Use the check's: %s is CGST output, confirmed by %s at %s, off the list" % (L.DIFFERS, m.get("okBy"), m.get("okAt")))
    fu = E(FIGS)
    E("(n) => { window.__after = S.books; const c = window.__before; c.map[n] = JSON.parse(JSON.stringify(S.books.map[n])); c.mapV = (c.mapV || 0) + 1; S.books = c; }", L.DIFFERS)
    fx = E(FIGS); E("() => { S.books = window.__after; S.books.mapV = (S.books.mapV || 0) + 1; render(); }")
    ok(diff(fk, fu) and not diff(fx, fu), "C. its figures move (%d) and only that ledger's: those of the books with just %s changed%s" % (len(diff(fk, fu)), L.DIFFERS, (" DIFFERS " + str(diff(fx, fu)[:4])) if diff(fx, fu) else ""))
    pg.click("#app [data-led-undo-bar] [data-led-undo-last]") if pg.locator("#app [data-led-undo-bar] [data-led-undo-last]").count() else None; pg.wait_for_timeout(500)
    ok(E(ENTRY, L.DIFFERS) == ek and not diff(fk, E(FIGS)), "E. Undo of Use the check's: the ledger and the figures as before")
    # ---------- Other ledgers (not tax), folded; marked as tax via Change
    oth = pg.locator("#app details[data-led-other]")
    ok(oth.count() == 1 and oth.get_attribute("open") is None, "Other ledgers (not tax): folded at the bottom")
    if oth.count():
        oth.locator("summary").click(); pg.wait_for_timeout(300)
        on = oth.locator("table[data-led-table=other] tbody tr[data-key]").first.get_attribute("data-key")
        oth.locator("tr[data-key=%s] [data-led-change]" % json.dumps(on)).click(); pg.wait_for_timeout(300)
        pg.select_option('select[aria-label="What %s is"]' % on, "tds_payable"); pg.wait_for_timeout(400)
        ok(E("(n) => [S.books.map[n].what, !!S.books.map[n].ok]", on) == ["tds_payable", True], "an other ledger marked as TDS payable via Change (%s), saved at once" % on)
        if pg.locator("#app [data-led-undo-bar] [data-led-undo-last]").count(): pg.click("#app [data-led-undo-bar] [data-led-undo-last]"); pg.wait_for_timeout(400)
    # ---------- H. staff, phone
    L.open_page(pg, "staff")
    ok(pg.locator("#app [data-led-confirm]").count() > 0 and pg.locator("#app [data-led-change]").count() > 0, "H. staff confirm and change ledgers, as today")
    E("() => { const d = document.querySelector('#app details[data-led-notices]'); if (d) d.open = true; }"); pg.wait_for_timeout(200)
    ok(pg.locator("#app [data-renamed='%s']" % L.RENAMED).count() == 1 and pg.locator("#app button[data-rename-confirm]").count() == 0, "H. staff: the rename line without its Confirm")
    L.open_page(pg, "owner")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(800)
    wide = E("document.scrollingElement.scrollWidth")
    ok(wide <= 392, "H. phone: no sideways scroll (%d)" % wide)
    pg.set_viewport_size({"width": 1366, "height": 900})
    ok(not errors, "no page errors %s" % errors[:3])
    br.close(); srv.shutdown()

    # ---------- B. Change pushed to FinCom's cloud at once (a stand-in server shared by two computers)
    STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"; FIRM = "f0000000-0000-0000-0000-00000000000f"
    USERS = {"tA": ("u-asha", "Asha"), "tB": ("u-rahul", "Rahul")}
    seq = itertools.count(1); DB = {"items": {}}; SOCKS = []
    now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    def broadcast(rec):
        msg = json.dumps({"topic": "realtime:fincom-" + FIRM, "event": "postgres_changes", "ref": None, "payload": {"ids": [1], "data": {"schema": "public", "table": "client_book_items", "type": "UPDATE", "commit_timestamp": now(), "errors": None, "record": rec}}})
        for s in list(SOCKS):
            try: s.send(msg)
            except Exception: SOCKS.remove(s)
    def route(r):
        req = r.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
        j = lambda o: r.fulfill(status=200, content_type="application/json", body=json.dumps(o))
        body = json.loads(req.post_data) if req.post_data else None
        me = USERS.get((req.headers.get("authorization") or "").replace("Bearer ", ""), ("", ""))[0]
        if path.endswith("/rest/v1/members"): return j([{"user_id": v[0], "firm_id": FIRM, "name": v[1], "email": v[0] + "@zz.test", "role": "staff", "active": True} for v in USERS.values()])
        if path.endswith("/rest/v1/client_book_items"):
            cid = q["client_id"][0][3:]; after = int(q.get("seq", ["gt.0"])[0][3:])
            return j(sorted([x for x in DB["items"].values() if x["client_id"] == cid and x["seq"] > after], key=lambda x: x["seq"])[:1000])
        if path.endswith("/rest/v1/rpc/save_book_items"):
            out = []
            for x in body["p_items"]:
                rec = {"firm_id": FIRM, "client_id": body["p_client"], "key": x["k"], "item": x.get("i", ""), "ord": x.get("o"), "data": None if x.get("del") else x.get("d"),
                       "deleted": bool(x.get("del")), "seq": next(seq), "updated_at": now(), "updated_by": me}
                DB["items"][(rec["client_id"], rec["key"], rec["item"])] = rec; out.append(rec)
            for rec in out: broadcast(rec)
            return j({"ok": True, "items": [{"k": x["key"], "i": x["item"], "seq": x["seq"]} for x in out], "at": now()})
        return j([])
    def ws_route(ws):
        SOCKS.append(ws)
        def on_msg(m):
            try: x = json.loads(m)
            except Exception: return
            if x.get("event") == "phx_join": ws.send(json.dumps({"topic": x["topic"], "event": "phx_reply", "ref": x["ref"], "payload": {"status": "ok", "response": {"postgres_changes": [{"id": 1}]}}}))
            elif x.get("event") == "heartbeat": ws.send(json.dumps({"topic": "phoenix", "event": "phx_reply", "ref": x["ref"], "payload": {"status": "ok", "response": {}}}))
        ws.on_message(on_msg)
    def wait_for(pg, js, t=10):
        s = time.time()
        while time.time() - s < t:
            try:
                if pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return time.time() - s
            except Exception: pass
            time.sleep(0.1)
        return None
    import threading, functools, http.server
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("localhost", PORT + 1), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    br = p.chromium.launch()
    def computer(tok, name):
        ctx = br.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(name + ": " + str(e)))
        ctx.route(STAGE + "/**", route); ctx.route_web_socket(re.compile(r"wss://qbocskaiewaxqcvaunzc\.supabase\.co/realtime/.*"), ws_route)
        pg.goto("http://localhost:%d/" % (PORT + 1)); pg.wait_for_timeout(2000); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        pg.evaluate("""([tok, uid, firm]) => { S.firm.firmName = S.firm.firmName || "Test Firm"; Cloud.setSess({access_token: tok, refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: uid, email: uid + "@zz.test"});
          Cloud.st.firm = firm; Cloud.st.email = uid + "@zz.test"; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u-asha", name: "Asha"}, {user_id: "u-rahul", name: "Rahul"}]; startCloudSync2(); }""", [tok, USERS[tok][0], FIRM])
        wait_for(pg, "Live.st === 'live'", 10)
        return ctx, pg
    # the books as the made-up client has them (masters read), saved on both computers
    srv0, br0, pg0 = L.start(p, PORT + 2, SITE)
    L.open_page(pg0, "owner", cloud=False)
    BK = pg0.evaluate("() => { const b = JSON.parse(JSON.stringify(S.books)); delete b.ledCheck; delete b.loading; return b; }")
    br0.close(); srv0.shutdown()
    CID = "zzled241"
    OPEN = """async ([cid, bk, gstin]) => { if (!S.companies[cid]){ const c = newCompany({name: "ZZ Test Client", gstin}); c.id = cid; S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; }
      if (bk) await Books.save(cid, bk); S.coId = cid; S.view = "company"; S.tab = "books"; S.booksTab = "ledgers"; S.books = null; render(); }"""
    ctxA, A = computer("tA", "A"); ctxB, B = computer("tB", "B")
    for pg_ in (A, B):
        pg_.evaluate(OPEN, [CID, dict(BK, cid=CID), L.GSTIN]); wait_for(pg_, "S.books && S.books.cid === '%s' && !S.books.loading" % CID, 15)
    A.wait_for_timeout(800)
    n = A.evaluate("() => { const r = [...document.querySelectorAll('#app table[data-led-table=main] tbody tr[data-key]')].find(t => t.querySelector('[data-led-change]') && /^gst$/.test((S.books.map[t.dataset.key] || {}).what || '')); return r ? r.dataset.key : ''; }")
    ok(bool(n), "B. a GST ledger to change on computer A (%s)" % n)
    if n:
        side = A.evaluate("(n) => S.books.map[n].side", n); new_side = "output" if side == "input" else "input"
        A.locator("#app table[data-led-table=main] tr[data-key=%s] [data-led-change]" % json.dumps(n)).click(); A.wait_for_timeout(300)
        A.select_option('select[aria-label="Side of %s"]' % n, new_side)
        t = wait_for(B, "(S.books.map[%s] || {}).side === %s && !!S.books.map[%s].ok" % (json.dumps(n), json.dumps(new_side), json.dumps(n)), 8)
        pushed = [k for k, v in DB["items"].items() if k[1] == "map" and json.dumps(v.get("data") or {}).find(json.dumps(new_side)) >= 0]
        ok(bool(pushed), "B. the change was pushed to FinCom's cloud at once, with no Save (items %s)" % sorted(set(k[1] for k in DB["items"]))[:10])
        ok(t is not None, "B. computer B has %s as %s, confirmed (%.2fs)" % (n, new_side, t or 99))
    ok(not errors, "no page errors %s" % errors[:3])
    br.close(); srv.shutdown()
print("\n%d FAILED" % len(fails) if fails else "\nALL PASSED")
sys.exit(1 if fails else 0)
