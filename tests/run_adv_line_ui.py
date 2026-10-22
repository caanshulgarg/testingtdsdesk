"""python3 run_adv_line_ui.py - the advances switch where the owner works (22-Oct-2026: he could not find it; it was only in
Client setup -> GST and on the Advances working, which a GSTR-1 page linked to only when there were advances):
  1. the month's GSTR-1 summary and GSTR-3B summary each have one line "Advances (11A/11B): Off for this client · Turn on"
  2. GST -> Advances is reachable while off (the line's link, and the return picker): the switch and the off line
  3. Turn on from the GSTR-1 line: "On · Turn off"; 11A/11B filled (GSTR-1 JSON, 3B 3.1(a))
  4. still on after a reload
  5. a look-only member sees the line's button greyed out and cannot change it
Made-up books (as run_adv_optin_ui.py). Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_adv_line_ui.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8619), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SETUP = """async (cid) => {
  const CMP = "09AAACZ9999Z1Z5", c = cid ? S.companies[cid] : newCompany({name: "ZZ Advances Test", gstin: CMP});
  if (!cid){ S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c); }
  const V = (id, type, date, no, party, ent, extra) => Object.assign({id, type, date, no, party, gstin: "", pos: "", cmp: CMP, narr: "", hsn: [],
    ent: ent.map(([l, a, o]) => Object.assign({l, a}, o || {}))}, extra || {});
  const SV = {h: "997161", gr: 18};
  const vs = [
    V("r6", "Receipt", "20250720", "", "Zenith Life Co-DL", [["Zenith Life Co-DL", 590000, {b: [["TEST/2526/L020", "New Ref", 590000]]}], ["Bank of Nowhere", -590000]]),
    V("s6", "Sales", "20250805", "TEST/2526/L020", "Zenith Life Company", [["Zenith Life Co-DL", -590000, {b: [["TEST/2526/L020", "Agst Ref", -590000]]}],
      ["Commission Income", 500000, SV], ["Output IGST", 90000]], {gstin: "07AAACQ1234Q1Z1"})];
  const b = {cid: c.id, loading: false, vouchers: vs, meta: {from: "20250401", to: "20260331", gstins: [CMP], bills: 1}, gstins: {"Zenith Life Co-DL": "07AAACQ1234Q1Z1"},
    states: {}, challans: [], alloc: {}, certs: [], under: {"Commission Income": "Sales Accounts", "Zenith Life Co-DL": "Sundry Debtors", "Bank of Nowhere": "Bank Accounts"},
    groups: {"Sales Accounts": "", "Sundry Debtors": "Current Assets", "Current Assets": "", "Bank Accounts": "Current Assets"}};
  b.map = Books.mapLedgers(vs, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  set("Output IGST", {kind: "gst", tax: "IGST", side: "output", reg: "09"}); set("Bank of Nowhere", {kind: "bank"});
  window.__bk = b; return c.id; }"""
# the client's GST page, a part of July 2025, the Summary tab
OPEN = """async ([cid, part]) => { if (S.coId !== cid) await openCompany(cid); S.view = "company"; S.tab = "books"; S.books = window.__bk; S.booksTab = "gst";
  LedMaster.refresh(S.books); GSTAdv._memo = null; GSTR._carry = null; S.gstReg = "09"; S.gstYm = "202507"; gstPartGo(part); S.gstSub = "summary"; render(); }"""
LINE = """() => { const l = document.querySelector("#app [data-adv-line]"), t = document.querySelector("#app [data-adv-toggle]");
  return {n: document.querySelectorAll("#app [data-adv-line]").length, state: l ? l.dataset.advLine : "", text: l ? l.textContent.replace(/\u00a0/g, " ").trim() : "",
    disabled: !!(t && t.disabled), opacity: t ? getComputedStyle(t).opacity : "", choice: ((CO().choices || {}).advGst || {}).value || "",
    at: GSTAdv.month("202507", "09").at.length, j11a: (GSTR.toJson("202507", "09").at || []).length, b3: GSTR.threeBm("202507", "09").net.igst}; }"""

with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    E = pg.evaluate
    pg.goto("http://localhost:8619/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    cid = E(SETUP, None)

    print("1. the line on GSTR-1 and GSTR-3B")
    E(OPEN, [cid, "r1"]); pg.wait_for_timeout(900); s = E(LINE)
    ok(s["n"] == 1 and s["state"] == "off" and s["text"].startswith("Advances (11A/11B): Off for this client · Turn on"), "GSTR-1 summary: the line, off (%r)" % s["text"])
    ok(pg.locator("#app [data-adv-line]").is_visible(), "the line is visible on the GSTR-1 page")
    E(OPEN, [cid, "r3b"]); pg.wait_for_timeout(900); s = E(LINE)
    ok(s["n"] == 1 and s["state"] == "off", "GSTR-3B summary: the line too (%r)" % s["text"])

    print("2. Advances reachable while off")
    pg.click("#app [data-adv-open]"); pg.wait_for_timeout(700)
    ok(E("S.gstPart") == "adv" and pg.locator("#app [data-adv-off]").count() == 1 and pg.locator('#app input[aria-label="Show advances in GST returns (Tables 11A/11B)"]').count() == 1,
       "the line's link opens Advances: the switch and the off line")
    E(OPEN, [cid, "r1"]); pg.wait_for_timeout(600)
    ok(pg.locator('#app select[data-gst-return-pick] option[value="adv"]').count() == 1, "Advances is in the return picker while off")

    print("3. Turn on from the GSTR-1 line")
    E(OPEN, [cid, "r1"]); pg.wait_for_timeout(700)
    ok(E(LINE)["at"] == 0 and E(LINE)["j11a"] == 0, "off: 11A empty")
    pg.click("#app [data-adv-toggle]"); pg.wait_for_timeout(700); s = E(LINE)
    ok(s["choice"] == "on" and s["state"] == "on" and "Advances (11A/11B): On · Turn off" in s["text"], "on: the line says On · Turn off (%r)" % s["text"])
    ok(s["at"] == 1 and s["j11a"] == 1 and s["b3"] == 90000, "11A filled: GSTR-1 JSON at, 3B 3.1(a) IGST 90,000 (%s, %s, %s)" % (s["at"], s["j11a"], s["b3"]))

    print("4. after a reload")
    pg.wait_for_timeout(800); pg.reload(); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    E(SETUP, cid); E(OPEN, [cid, "r1"]); pg.wait_for_timeout(900); s = E(LINE)
    ok(s["choice"] == "on" and s["state"] == "on" and s["at"] == 1, "still on after a reload (%r)" % s["text"])

    print("5. a look-only member")
    E("() => { S.account = Object.assign(S.account || {}, {me: {role: 'readonly', email: 'look@firm.test'}}); render(); }"); pg.wait_for_timeout(500); s = E(LINE)
    ok(s["disabled"] and float(s["opacity"] or 1) < 1 and "only the firm" in s["text"].lower(), "the line's button greyed out, with why (%s, %r)" % (s["opacity"], s["text"]))
    E("() => { const t = document.querySelector('#app [data-adv-toggle]'); t.disabled = false; t.click(); }"); pg.wait_for_timeout(500)
    ok(E(LINE)["choice"] == "on", "a look-only member cannot turn it off, even past the disabled button")

    ok(not errors, "no page errors %s" % errors[:3])
    br.close()
print("all passed" if not fails else "%d FAILED" % len(fails))
raise SystemExit(1 if fails else 0)
