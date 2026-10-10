"""python3 run_tieout.py - phase 2, H54: Books -> Tie-out (migration 44: tally_tieouts, tally_tieout_save, tally_month_locks,
tally_month_lock / tally_month_unlock). One row a month of the copy's period: the five figures typed from Tally
(receivables, payables, cash and bank, profit, trial balance total) beside FinCom's own five for the same month-end, worked
out by the helpers the books screens already use (Parties.position, Audit.balances with isCash / isBankL as MIS does,
MIS.pl, LK.tbBooks), the difference of each; Save -> tally_tieout_save(p_client, p_month, p_figures, p_fincom, p_tick null);
the owner's Tick (p_tick true) -> "Tied out by <name> on <date>", Untick (false); the owner's Lock month (a note) ->
tally_month_lock(p_client, p_month, p_note) and a locked month says "Locked: Tally changes to this month are held for your
approval", Unlock -> tally_month_unlock. Staff cannot tick or lock, and a ticked month is read-only for them. Without
migration 44 the tab says "not available until migration 44 runs".
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tieout.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8291), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# made-up books: capital 1,00,000 into the bank on 01-Apr-2026; in April a sale of 50,000 to ABC Traders (unpaid), a bill of
# 20,000 from XYZ Supplies for office expenses (unpaid), rent of 10,000 from the bank, 5,000 drawn in cash.
# At 30-Apr: receivables 50,000, payables 20,000, cash and bank 90,000, profit 20,000, trial balance 1,70,000
SETUP = """async ([role, tie, locks, old]) => {
  let c = Object.values(S.companies).find(x => x.name === "ZZ Tie Client");
  if (!c){ c = newCompany({name: "ZZ Tie Client", gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  window.__calls = []; window.__tie = tie || []; window.__locks = locks || []; window.__old = old || ""; window.__fail = null;
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-anshul", name: "Anshul"}, {user_id: "u-neha", email: "neha@fincom.in"}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role, user_id: role === "owner" ? "u-anshul" : "u-neha"})});
  TCloud.on = () => true;
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  const copy = (x) => JSON.parse(JSON.stringify(x));
  Cloud.api = async (p) => {
    if (/^tally_tieouts/.test(p)){ if (window.__old) throw new Error(window.__old); return copy(window.__tie); }
    if (/^tally_month_locks/.test(p)){ if (window.__old) throw new Error(window.__old); return copy(window.__locks); }
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => {
    window.__calls.push([fn, copy(a || {})]);
    if (window.__fail) throw new Error(window.__fail);
    if (fn === "tally_tieout_save"){
      const row = Object.assign({month: a.p_month, fincom: a.p_fincom, saved_at: new Date().toISOString(), saved_by: S.account.me.user_id, ticked_at: null, ticked_by: null, note: ""}, a.p_figures);
      if (a.p_tick === true){ row.ticked_at = "2026-10-04T10:00:00Z"; row.ticked_by = S.account.me.user_id; }
      window.__tie = window.__tie.filter(r => r.month !== a.p_month).concat([row]);
      return Object.assign({ok: true}, row);
    }
    if (fn === "tally_month_lock"){ window.__locks = [{month: a.p_month, locked_at: "2026-10-04T10:05:00Z", locked_by: "u-anshul", note: a.p_note}]; return {ok: true, month: a.p_month.slice(0, 7), books: 1, locked: 1, already: false}; }
    if (fn === "tally_month_unlock"){ window.__locks = []; return {ok: true, month: a.p_month.slice(0, 7), unlocked: 1}; }
    return null;
  };
  TCloud.st[c.id] = {at: Date.now(), books: []};
  if (S.view !== "company" || S.coId !== c.id) await openCompany(c.id);
  const groups = {"Sundry Debtors": "Current Assets", "Sundry Creditors": "Current Liabilities", "Bank Accounts": "Current Assets", "Cash-in-Hand": "Current Assets",
    "Current Assets": "", "Current Liabilities": "", "Capital Account": "", "Sales Accounts": "", "Indirect Expenses": ""};
  const under = {"ABC Traders": "Sundry Debtors", "XYZ Supplies": "Sundry Creditors", "HDFC Bank": "Bank Accounts", "Cash": "Cash-in-Hand", "Capital": "Capital Account",
    "Sales": "Sales Accounts", "Rent": "Indirect Expenses", "Office Expenses": "Indirect Expenses"};
  const v = (id, date, type, ent) => ({id, date, no: id, type, party: "", narr: "", ent: ent.map(([l, a]) => ({l, a}))});
  // Tally's signs: a credit positive, a debit negative
  const vouchers = [v("1", "20260405", "Sales", [["ABC Traders", -50000], ["Sales", 50000]]), v("2", "20260410", "Purchase", [["Office Expenses", -20000], ["XYZ Supplies", 20000]]),
    v("3", "20260415", "Payment", [["Rent", -10000], ["HDFC Bank", 10000]]), v("4", "20260420", "Contra", [["Cash", -5000], ["HDFC Bank", 5000]]),
    v("5", "20260510", "Sales", [["ABC Traders", -30000], ["Sales", 30000]])];
  const led = {}; Object.keys(under).forEach(l => { led[l] = {open: 0}; }); led["HDFC Bank"] = {open: -100000}; led["Capital"] = {open: 100000};
  S.books = {loading: false, cid: c.id, vouchers, map: {}, groups, under, meta: {from: "20260401", to: "20260531", company: "ZZ TIE"}, tb: {from: "20260401", to: "20270331", at: "2026-10-01T00:00:00Z", src: "copy", led},
    alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
  if (typeof Rec === "object") Rec.tie = {};
  goClient("books:tieout");
  return c.id;
}"""
APR, MAY = "2026-04-01", "2026-05-01"
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1500, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8291/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    row = lambda m: '#app [data-tieout-month="%s"]' % m
    cid = E(SETUP, ["owner", [], [], ""]); pg.wait_for_timeout(1200)
    ok(pg.locator('#app nav[aria-label="Books"] button', has_text="Tie-out").count() == 1, "Books has a Tie-out tab beside From Tally, Tally ledgers, TDS, GST")
    ok(E("booksTab()") == "tieout" and pg.locator("#app [data-tieout]").count() == 1, "the Tie-out tab opens (%s)" % E("booksTab()"))
    ok(pg.locator(row(APR)).count() == 1 and pg.locator(row(MAY)).count() == 1, "one row a month of the copy's period: Apr-2026 and May-2026")
    fc = lambda m, k: txt(row(m) + ' [data-tie-fincom="%s"]' % k)
    got = {k: fc(APR, k) for k in ("receivables", "payables", "cash_bank", "profit", "tb_total")}
    ok(got["receivables"].endswith("50,000.00") and got["payables"].endswith("20,000.00") and got["cash_bank"].endswith("90,000.00") and got["profit"].endswith("20,000.00") and got["tb_total"].endswith("1,70,000.00"),
       "FinCom's five for 30-Apr from the books' own helpers: 50,000 / 20,000 / 90,000 / 20,000 / 1,70,000 (%s)" % got)
    ok(fc(MAY, "receivables").endswith("80,000.00") and fc(MAY, "profit").endswith("50,000.00"), "31-May: receivables 80,000, profit for the year so far 50,000 (%s, %s)" % (fc(MAY, "receivables"), fc(MAY, "profit")))
    # ---- typed from Tally; differences shown at once
    inp = lambda m, k: row(m) + ' input[data-tie-fig="%s"]' % k
    for k, v in (("receivables", "50000"), ("payables", "21,000"), ("cash_bank", "90000"), ("profit", "19000"), ("tb_total", "170000")): pg.fill(inp(APR, k), v)
    pg.fill(row(APR) + " input[data-tie-note]", "from Tally's balance sheet"); pg.wait_for_timeout(300)
    dif = lambda m, k: txt(row(m) + ' [data-tie-diff="%s"]' % k)
    ok(dif(APR, "payables").replace("−", "-") in ("1,000.00", "+1,000.00") and dif(APR, "profit").replace("−", "-") == "-1,000.00" and dif(APR, "receivables") in ("0.00", "✓"),
       "the difference a figure: payables 1,000.00, profit -1,000.00, receivables none (%s / %s / %s)" % (dif(APR, "payables"), dif(APR, "profit"), dif(APR, "receivables")))
    ok(pg.get_attribute(row(APR) + ' [data-tie-diff="payables"]', "data-off") == "1" and pg.get_attribute(row(APR) + ' [data-tie-diff="receivables"]', "data-off") == "0", "a difference is marked; a figure that agrees is not")
    pg.click(row(APR) + " [data-tie-save]"); pg.wait_for_timeout(600)
    saves = [c for c in E("window.__calls") if c[0] == "tally_tieout_save"]
    ok(saves == [["tally_tieout_save", {"p_client": cid, "p_month": APR, "p_figures": {"receivables": 50000, "payables": 21000, "cash_bank": 90000, "profit": 19000, "tb_total": 170000, "note": "from Tally's balance sheet"},
        "p_fincom": {"receivables": 50000, "payables": 20000, "cash_bank": 90000, "profit": 20000, "tb_total": 170000}, "p_tick": None}]],
       "Save -> tally_tieout_save(p_client, p_month, p_figures, p_fincom = FinCom's five now, p_tick null) (%s)" % saves)
    ok("Saved" in txt(row(APR)) and pg.input_value(inp(APR, "payables")) in ("21000", "21,000"), "saved: the row says so and keeps the figures (%s)" % txt(row(APR) + " [data-tie-msg]"))
    # a figure that is not a number: nothing sent
    E("() => { window.__calls = []; }")
    pg.fill(inp(MAY, "receivables"), "abc"); pg.click(row(MAY) + " [data-tie-save]"); pg.wait_for_timeout(400)
    ok(not E("window.__calls") and "number" in txt(row(MAY) + " [data-tie-msg]"), "a figure that is not a number: refused here, nothing sent (%s)" % txt(row(MAY) + " [data-tie-msg]"))
    pg.fill(inp(MAY, "receivables"), "")
    # ---- the owner ticks
    ok(pg.locator(row(APR) + " [data-tie-tick]").count() == 1 and pg.locator(row(APR) + " [data-tie-lock]").count() == 1, "owner: Tick and Lock month")
    pg.click(row(APR) + " [data-tie-tick]"); pg.wait_for_timeout(600)
    t = [c for c in E("window.__calls") if c[0] == "tally_tieout_save"]
    ok(len(t) == 1 and t[0][1]["p_tick"] is True and t[0][1]["p_month"] == APR and t[0][1]["p_figures"]["payables"] == 21000, "Tick -> tally_tieout_save(..., p_tick true) with the figures (%s)" % t)
    tk = txt(row(APR) + " [data-tie-ticked]")
    ok(tk == "Tied out by Anshul on 04-Oct-2026", "ticked: 'Tied out by <name> on <date>' (%s)" % tk)
    ok(pg.locator(row(APR) + " [data-tie-untick]").count() == 1, "owner: Untick on a ticked month")
    # ---- the owner locks the month, with a note
    E("() => { window.__calls = []; }")
    pg.click(row(APR) + " [data-tie-lock]"); pg.wait_for_timeout(400)
    ok(pg.locator("#confirmBox #lockNote").count() == 1, "Lock month asks for a note")
    pg.fill("#confirmBox #lockNote", "Books closed for April"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
    ok(["tally_month_lock", {"p_client": cid, "p_month": APR, "p_note": "Books closed for April"}] in E("window.__calls"), "Lock month -> tally_month_lock(p_client, p_month, p_note) (%s)" % E("window.__calls"))
    lk = txt(row(APR) + " [data-tie-locked]")
    ok(lk.startswith("Locked: Tally changes to this month are held for your approval"), "a locked month says so (%s)" % lk)
    ok(pg.locator(row(APR) + " [data-tie-unlock]").count() == 1 and pg.locator(row(APR) + " [data-tie-lock]").count() == 0, "owner: Unlock in place of Lock month")
    pg.click(row(APR) + " [data-tie-unlock]"); pg.wait_for_timeout(400)
    if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]')
    pg.wait_for_timeout(800)
    ul = [c for c in E("window.__calls") if c[0] == "tally_month_unlock"]
    ok(len(ul) == 1 and ul[0][1]["p_client"] == cid and ul[0][1]["p_month"] == APR, "Unlock -> tally_month_unlock(p_client, p_month, p_note) (%s)" % ul)
    ok(pg.locator(row(APR) + " [data-tie-locked]").count() == 0, "unlocked: the words go")
    # ---- staff: no Tick, no Lock; a ticked month is read-only
    TICKED = [{"month": APR, "receivables": 50000, "payables": 21000, "cash_bank": 90000, "profit": 19000, "tb_total": 170000, "fincom": {}, "saved_at": "2026-10-04T10:00:00Z", "saved_by": "u-anshul",
               "ticked_at": "2026-10-04T10:00:00Z", "ticked_by": "u-anshul", "note": ""}]
    E(SETUP, ["staff", TICKED, [{"month": APR, "locked_at": "2026-10-04T10:05:00Z", "locked_by": "u-anshul", "note": "x"}], ""]); pg.wait_for_timeout(1200)
    ok(pg.locator("#app [data-tie-tick], #app [data-tie-untick], #app [data-tie-lock], #app [data-tie-unlock]").count() == 0, "staff: no Tick, Untick, Lock month or Unlock anywhere")
    ok(txt(row(APR) + " [data-tie-ticked]") == "Tied out by Anshul on 04-Oct-2026" and txt(row(APR) + " [data-tie-locked]").startswith("Locked:"), "staff see the tick and the lock")
    ok(pg.locator(row(APR) + " [data-tie-save]").count() == 0 and all(pg.locator(inp(APR, k)).is_disabled() for k in ("receivables", "payables", "cash_bank", "profit", "tb_total")),
       "staff: a ticked month is read-only (no Save, the figures cannot be typed)")
    ok(pg.locator(row(MAY) + " [data-tie-save]").count() == 1 and not pg.locator(inp(MAY, "payables")).is_disabled(), "staff may save a month not ticked")
    pg.fill(inp(MAY, "payables"), "20000"); pg.click(row(MAY) + " [data-tie-save]"); pg.wait_for_timeout(600)
    s = [c for c in E("window.__calls") if c[0] == "tally_tieout_save"]
    ok(len(s) == 1 and s[0][1]["p_tick"] is None and s[0][1]["p_month"] == MAY, "staff Save sends p_tick null (%s)" % s)
    # ---- migration 44 not run: the tab says so, nothing breaks
    E(SETUP, ["owner", [], [], "column tally_tieouts.receivables does not exist (42703)"]); pg.wait_for_timeout(1200)
    ok("not available until migration 44 runs" in txt("#app [data-tieout]") and pg.locator("#app [data-tie-save]").count() == 0, "without migration 44: 'not available until migration 44 runs', no Save (%s)" % txt("#app [data-tieout] [data-not-ready]"))
    E(SETUP, ["owner", [], [], "Could not find the table 'public.tally_tieouts' in the schema cache (PGRST205)"]); pg.wait_for_timeout(1200)
    ok("not available until migration 44 runs" in txt("#app [data-tieout]"), "the table missing (PGRST205): the same words")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
