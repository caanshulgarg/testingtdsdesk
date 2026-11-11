"""python3 run_speed_render.py - next-speed-render (11-Nov-2026; the owner: MIS, Audit, the TDS ledgers, the Reports list and the
tie-out must open at once and fill in their figures a moment later). On 51,758 made-up entries each of these pages held the
browser 1.3-3 s (5-13 s on an office PC) before it showed anything. Now each page is drawn at once, its figures worked out
behind it in steps (app/src/lib/behind.jsx), filled in as they come; kept for the books as they are, so a second open is at
once; after a change to the books the last figures stay on the page (marked updating) until the new ones replace them.

For each page, on made-up books (seeded here; no client's name or figure), with the steps one a task (window.FinComBehind:
nothing worked out in the drawing itself, one step a task, every step drawn), the test checks:
  1. the first drawing has the page (its heading, table or list) and "Working out…" where the figures go;
  2. the figures come in over several tasks (some shown while others are still being worked out, where the page has parts);
  3. once in, every figure is the one the page's own function gives worked out at once, from nothing kept;
  4. a second open: the figures in the first drawing, nothing worked out again;
  5. an entry changed and the books saved: the last figures stay, marked updating, then the new ones replace them, and they
     are the books' as changed.
Pages: T. Tie-out.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_speed_render.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("SR_PORT") or 8297)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# made-up books over 25 months (Apr-2024 to Apr-2026): sales to customers, bills from suppliers, receipts and payments
# through the bank, expenses, cash drawn; ledger groups as Tally gives them; opening balances from FinCom's copy
SETUP = """async ([n]) => {
  let c = Object.values(S.companies).find(x => x.name === "ZZ Speed Client");
  if (!c){ c = newCompany({name: "ZZ Speed Client", gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-anshul", name: "Anshul"}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner", user_id: "u-anshul"})});
  TCloud.on = () => true; Cloud.api = async () => []; TCloud.restAll = async () => []; TCloud.rpc = async () => null; TCloud.st[c.id] = {at: Date.now(), books: []};
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  if (S.view !== "company" || S.coId !== c.id) await openCompany(c.id);
  let s = 7; const R = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const groups = {"Sundry Debtors": "Current Assets", "Sundry Creditors": "Current Liabilities", "Bank Accounts": "Current Assets", "Cash-in-Hand": "Current Assets",
    "Current Assets": "", "Current Liabilities": "", "Capital Account": "", "Sales Accounts": "", "Purchase Accounts": "", "Indirect Expenses": ""};
  const under = {"Made Up Bank": "Bank Accounts", "Cash": "Cash-in-Hand", "Capital": "Capital Account", "Sales": "Sales Accounts", "Purchases": "Purchase Accounts", "Rent": "Indirect Expenses", "Office Expenses": "Indirect Expenses"};
  const cus = [], sup = [];
  for (let i = 0; i < 12; i++){ const a = "Made Up Customer " + i, b = "Made Up Supplier " + i; cus.push(a); sup.push(b); under[a] = "Sundry Debtors"; under[b] = "Sundry Creditors"; }
  const V = [], pad = (x) => String(x).padStart(2, "0");
  for (let i = 0; i < n; i++){
    const k = Math.floor(i * 25 / n), y = 2024 + Math.floor((3 + k) / 12), mo = (3 + k) % 12 + 1, date = y + pad(mo) + pad(1 + Math.floor(R() * 28)), amt = Math.round(1000 + R() * 90000) + Math.round(R() * 100) / 100, kind = i % 6;
    const cu = cus[Math.floor(R() * cus.length)], su = sup[Math.floor(R() * sup.length)];
    const ent = kind === 0 ? [[cu, -amt], ["Sales", amt]] : kind === 1 ? [["Purchases", -amt], [su, amt]] : kind === 2 ? [["Made Up Bank", -amt], [cu, amt]]
      : kind === 3 ? [[su, -amt], ["Made Up Bank", amt]] : kind === 4 ? [["Rent", -amt], ["Made Up Bank", amt]] : [["Cash", -amt], ["Made Up Bank", amt]];
    V.push({id: "e" + i, date, no: String(i + 1), type: ["Sales", "Purchase", "Receipt", "Payment", "Payment", "Contra"][kind], party: "", narr: "", ent: ent.map(([l, a]) => ({l, a}))});
  }
  V.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const led = {}; Object.keys(under).forEach(l => { led[l] = {open: 0}; }); led["Made Up Bank"] = {open: -500000}; led["Capital"] = {open: 500000};
  S.books = {loading: false, cid: c.id, vouchers: V, map: {}, groups, under, meta: {from: V[0].date, to: V[V.length - 1].date, company: "ZZ SPEED"},
    tb: {from: "20240401", to: "20270331", at: "2026-10-01T00:00:00Z", src: "copy", led}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
  if (typeof Rec === "object") Rec.tie = {};
  Object.assign(window.FinComBehind || {}, {IN_MS: 0, STEP_MS: 0, DRAW_MS: 0});
  return c.id;
}"""
# what the page shows, frame by frame from the click until nothing is worked out (or 20 s): the count of "Working out…"
# and of figures marked updating, in each frame
WATCH = """(go) => new Promise((done) => { const out = []; const t0 = performance.now(); (new Function(go))();
  const look = () => { const w = document.querySelectorAll('#app [data-working]').length, u = document.querySelectorAll('#app [data-updating]').length;
    out.push([w, u]); if ((w === 0 && u === 0 && out.length > 1) || performance.now() - t0 > 20000) done(out); else requestAnimationFrame(look); };
  look(); })"""

def tieout(pg, E, cid):
    print("T. Tie-out")
    months = E("(cid) => Rec.months(cid)", cid)
    fresh = """(cid) => { Rec._fc = null; MIS._mk = new WeakMap(); Audit._mv = new WeakMap(); Parties._p = null;
      return Object.fromEntries(Rec.months(cid).map(m => { const f = Rec.fincom(cid, m); return [m, Rec.FIGS.map(([k]) => f[k] == null ? "FinCom: not available" : "FinCom " + INR.format(r2(f[k])))]; })); }"""
    shown = """() => Object.fromEntries([...document.querySelectorAll('#app [data-tieout-month]')].map(r => [r.getAttribute('data-tieout-month'), [...r.querySelectorAll('[data-tie-fincom]')].map(x => x.textContent.trim())]))"""
    E("() => goClient('books:dash')"); pg.wait_for_timeout(500)
    fr = E(WATCH, "goClient('books:tieout')")
    first = fr[0]
    ok(len(months) == 25 and E("() => document.querySelectorAll('#app [data-tieout-table] [data-tieout-month]').length") == 25, "T1. the page and its 25 months are drawn (%d months)" % len(months))
    ok(first[0] >= 5 * 24, "T1. the first drawing says Working out… where FinCom's figures go (%d of 125)" % first[0])
    mid = [w for w, u in fr if 0 < w < first[0]]
    ok(len(set(mid)) >= 3, "T2. the figures come in over several tasks, month by month (%d frames part done, %d different)" % (len(mid), len(set(mid))))
    want = E(fresh, cid); got = E(shown)
    ok(got == want, "T3. every figure is Rec.fincom's, worked out at once from nothing kept (%d months)" % len(want) + ("" if got == want else " got %s want %s" % (json.dumps(got)[:300], json.dumps(want)[:300])))
    E("() => goClient('books:dash')"); pg.wait_for_timeout(400)
    fr2 = E(WATCH, "goClient('books:tieout')")
    ok(fr2[0] == [0, 0] and E(shown) == want, "T4. a second open: the figures in the first drawing (%s)" % fr2[:3])
    # an entry of Apr-2025 doubled and the books saved: Apr-2025 onwards change
    E("""() => { const b = S.books, i = b.vouchers.findIndex(v => v.date >= "20250410" && /Sales/.test(v.type)); b.vouchers[i] = Object.assign({}, b.vouchers[i], {ent: b.vouchers[i].ent.map(e => ({l: e.l, a: r2(e.a * 2)}))}); saveBooks(); }""")
    fr3 = E(WATCH, "render()")
    ok(fr3[0][0] == 0 and fr3[0][1] > 0, "T5. after a change: the last figures stay, marked updating, none says Working out (%s)" % fr3[:2])
    want2 = E(fresh, cid); got2 = E(shown)
    ok(got2 == want2 and want2 != want, "T5. then the new figures replace them, the books' as changed (%d months differ from before)" % sum(1 for m in want if want[m] != want2.get(m)))

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1500, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        cid = E(SETUP, [2500]); pg.wait_for_timeout(800)
        # the screens' files in before anything is timed
        for t in ("books:tieout", "books:dash"): E("(t) => goClient(t)", t); pg.wait_for_timeout(1500)
        # ... and nothing kept from that visit (the same books as a new object: nothing worked out for them yet)
        E("() => { S.books = Object.assign({}, S.books); Rec._fc = null; render(); }"); pg.wait_for_timeout(500)
        tieout(pg, E, cid)
        br.close()
finally:
    srv.shutdown()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to fetch" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
