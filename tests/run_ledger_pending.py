"""python3 run_ledger_pending.py - release-240 review H1 and M5 (09-Oct-2026), on the owner's condition: the ledger check's
saved suggestions are pending and count in NO figure until confirmed, whether or not the check's "only confirmed ledgers
count" switch (ledCheck.strict) was ever set; a reload never changes a return.
  H1. With nothing confirmed and the switch off (the state LedPage's own Confirm leaves), every return figure - GSTR-1
      (each month and registration), GSTR-3B, the inward supplies (ITC), the TDS rows (26Q, 27Q, 27EQ) - is the figure
      with every unconfirmed tax-like ledger counted as nothing (FinCom's "other tax": in no return, no taxable value).
      The same after the books are opened again, and after one ledger is confirmed (it, and only it, counts). The figures
      that move against 2.3.3 (the books' own guesses counted) are printed.
  M5. "Keep as confirmed" (LedPage.keepUse: a confirmed ledger now used differently) is saved at once: opened again
      WITHOUT a save in between, who kept it and when are still there.
Made-up client: tests/ledpage_setup.py (the fixture books and masters). Offline; no client data needed.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ledger_pending.py"""
import os, sys, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ledpage_setup as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# (as run_ledcheck_saved.py) # every figure a return is made from, as plain data
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
  const rows = LedPage.rows(b);
  out.page = {pending: LedMaster.pending(b).length, gst: rows.filter(r => !r.ok && !r.unclear && r.kind === "gst").length, tds: rows.filter(r => !r.ok && !r.unclear && r.kind === "tds").length,
    unclear: rows.filter(r => !r.ok && r.unclear).length, confirmed: rows.filter(r => r.ok).length};
  return JSON.parse(JSON.stringify(out)); }"""
def diff(a, b, path=""):
    if type(a) != type(b): return [path]
    if isinstance(a, dict): return [x for k in sorted(set(a) | set(b)) for x in diff(a.get(k), b.get(k), path + "/" + k)]
    if isinstance(a, list): return [path + "#len"] if len(a) != len(b) else [x for i in range(len(a)) for x in diff(a[i], b[i], path + "/%d" % i)]
    return [] if a == b else [path]
# opened again WITHOUT saving first: what was saved is what comes back
REOPEN = """async () => { const cid = S.books.cid; S.books = null; await openBooks(cid);
  for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise(r => setTimeout(r, 50)); render(); return !!S.books && !S.books.loading; }"""
# the same books with every unconfirmed tax-like ledger counted as nothing (FinCom's "other tax"), on a copy
AS_NOTHING = """() => { window.__orig = S.books; const c = JSON.parse(JSON.stringify(S.books)); const names = LedMaster.pending(c).map(([n]) => n);
  names.forEach(n => { c.map[n] = {n: (c.map[n] || {}).n || 0, kind: "tax_other"}; }); c.mapV = (c.mapV || 0) + 1; S.books = c; return names; }"""
# 2.3.3's reading: the books' own guesses counted (the check's switch was off), on a copy
AS_233 = """() => { window.__orig = S.books; const c = JSON.parse(JSON.stringify(S.books)); c.ledCheck = Object.assign({}, c.ledCheck, {strict: false});
  c.mapV = (c.mapV || 0) + 1; S.books = c; window.__lc233 = true; return true; }"""
BACK = "() => { S.books = window.__orig; S.books.mapV = (S.books.mapV || 0) + 1; return true; }"
with sync_playwright() as p:
    srv, br, pg = L.start(p, 8418, SITE, errors=errors)
    E = pg.evaluate
    L.open_page(pg, "owner", cloud=False)
    E("() => { LedMaster.refresh(S.books); LedPage.ensure(S.books); }")
    E("async () => { await saveBooks(); }")
    st = E("() => ({strict: !!(S.books.ledCheck || {}).strict, pending: LedMaster.pending(S.books).length, ok: Object.values(S.books.map).filter(m => m.ok).length})")
    ok(not st["strict"] and st["pending"] > 5 and st["ok"] == 0, "the check's switch off, %d ledgers pending, none confirmed" % st["pending"])
    f0 = E(FIGS)
    names = E(AS_NOTHING); fz = E(FIGS); E(BACK)
    d = [x for x in diff(f0, fz) if not x.startswith("/page")]
    ok(not d, "H1. every return figure counts the %d pending ledgers as nothing (switch off)%s" % (len(names), (": DIFFERS at %d, e.g. %s" % (len(d), d[:6])) if d else ""))
    ok(E(REOPEN), "opened again")
    f1 = E(FIGS)
    d1 = [x for x in diff(f0, f1) if not x.startswith("/page")]
    ok(not d1, "H1. the same after the books are opened again%s" % ((" DIFFERS " + str(d1[:5])) if d1 else ""))
    # against 2.3.3: what moves (the guesses no longer count)
    g = E("() => { const r = {}; LedMaster.pending(S.books).forEach(([n, m]) => { r[n] = Books.guess(n).kind || ''; }); return r; }")
    counted = {n: k for n, k in g.items() if k and k not in ("bank", "roundoff")}
    print("  info pending ledgers 2.3.3 counted by its own guess (now counted in no return until confirmed): %d %s" % (len(counted), sorted(counted.items())[:12]))
    # one ledger confirmed on the page (Confirm on its row): it counts, the rest still do not
    row = pg.locator("#app [data-led-table=gst] tbody tr[data-key]").first; n1 = row.get_attribute("data-key")
    row.locator("[data-led-confirm]").click(); pg.wait_for_timeout(500)
    ok(E("(n) => !!S.books.map[n].ok", n1) and not E("!!(S.books.ledCheck || {}).strict"), "Confirm on %s: confirmed; the switch still off" % n1)
    g0 = E(FIGS); E(AS_NOTHING); gz = E(FIGS); E(BACK)
    d = [x for x in diff(g0, gz) if not x.startswith("/page")]
    ok(not d, "H1. one confirmed: the others still count as nothing%s" % ((": DIFFERS " + str(d[:5])) if d else ""))
    ok(E(REOPEN), "opened again")
    g1 = E(FIGS)
    d = [x for x in diff(g0, g1) if not x.startswith("/page")]
    ok(not d, "H1. ... and the same after a reload%s" % ((" DIFFERS " + str(d[:5])) if d else ""))
    # M5. Keep as confirmed: saved at once, who and when kept after the books are opened again without a save
    E("(n) => { const it = (S.books.ledCheck.items || {})[n]; if (it){ it.okBy = ''; it.okAt = ''; } }", n1)
    E("(n) => LedPage.keepUse(S.books, n)", n1); pg.wait_for_timeout(500)
    before = E("(n) => { const it = S.books.ledCheck.items[n] || {}; return [it.okBy || '', it.okAt || '']; }", n1)
    ok(before[0] and before[1], "M5. keep as confirmed: who and when set (%s)" % before)
    ok(E(REOPEN), "opened again without a save")
    after = E("(n) => { const it = ((S.books.ledCheck || {}).items || {})[n] || {}; return [it.okBy || '', it.okAt || '']; }", n1)
    ok(after == before, "M5. who and when kept after the reload: %s (was %s)" % (after, before))
    ok(not errors, "no page errors %s" % errors[:3])
    br.close(); srv.shutdown()
print("\n%d FAILED" % len(fails) if fails else "\nALL PASSED")
sys.exit(1 if fails else 0)
