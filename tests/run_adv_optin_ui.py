"""python3 run_adv_optin_ui.py - "Show advances in GST returns (Tables 11A/11B)", per client, off unless turned on (the owner,
22-Oct-2026: "don't treat advance unless we say.. there should be an option whether to show advance in gst return"):
  1. a client never set: off. The GST page's Advances shows the switch and one quiet line ("Advances are not shown in GST returns for this
     client · Turn on") and nothing else; 11A/11B, 3B 3.1(a) and the checks have no advances; B2B is the same
  2. Turn on: kept in co.choices.advGst (confirmed, who and when), the Advances page shows 11A, GSTR-1 and 3B count it
  3. the tick on the page turns it off again (who and when, the value before kept), and on again
  4. after a reload: still on
  5. Client setup → GST shows the same setting, and a change there is not left as an unsaved draft
  6. a "look only" user (role readonly) sees it, disabled, and cannot change it; staff can
Made-up books (as tests/run_gstr1_party.js): money received in July 2025, invoiced in August.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_adv_optin_ui.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8273), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# a client with made-up books: a receipt in July 2025 from a customer (New Ref), its invoice in August (Agst Ref)
# (cid: the client again after a reload; the books are made again, as they are not what this test keeps)
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
# the client's GST page, Advances, July 2025
OPEN = """async (cid) => { if (S.coId !== cid) await openCompany(cid); S.view = "company"; S.tab = "books"; S.books = window.__bk; S.booksTab = "gst";
  LedMaster.refresh(S.books); GSTAdv._memo = null; GSTR._carry = null; S.gstReg = "09"; S.gstYm = "202507"; gstPartGo("adv"); render(); }"""
STATE = """() => { const c = CO(), a = GSTAdv.month("202507", "09"), b = GSTAdv.month("202508", "09");
  return {choice: (c.choices || {}).advGst || null, at: a.at.length, txpd: b.txpd.length, b3jul: GSTR.threeBm("202507", "09").net.igst,
    b2bAug: JSON.stringify(GSTR.one("202508", "09").b2b.map(r => [r.no, r.taxable, r.igst])), checks: GSTR.checks("202507", "09").filter(x => /advance/i.test(x.what)).length,
    off: !!document.querySelector("#app [data-adv-off]"), offText: (document.querySelector("#app [data-adv-off]") || {}).textContent || "",
    optin: (document.querySelector("#app [data-adv-optin]") || {dataset: {}}).dataset.advOptin || "", tiles: !!document.querySelector("#app .dash-tiles .dtile"),
    box: !!document.querySelector('#app input[aria-label="Show advances in GST returns (Tables 11A/11B)"]'),
    boxDisabled: !!(document.querySelector('#app input[aria-label="Show advances in GST returns (Tables 11A/11B)"]') || {}).disabled,
    turnOnDisabled: !!(document.querySelector("#app [data-adv-turn-on]") || {}).disabled, readonly: !!document.querySelector("#app [data-adv-readonly]"),
    who: (document.querySelector("#app [data-adv-who]") || {}).textContent || ""}; }"""

with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    E = pg.evaluate
    pg.goto("http://localhost:8273/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1500)
    cid = E(SETUP, None); E(OPEN, cid); pg.wait_for_timeout(900)

    print("1. never set: off")
    s = E(STATE)
    ok(s["choice"] is None and s["at"] == 0 and s["txpd"] == 0, "no choice kept; 11A in July and 11B in August empty (%d, %d)" % (s["at"], s["txpd"]))
    ok(s["off"] and s["offText"].replace(" ", " ").strip() == "Advances are not shown in GST returns for this client · Turn on" and not s["tiles"] and s["box"] and s["optin"] == "off",
       "the Advances page: the switch (unticked) and one quiet line, no tiles, no tables (%r)" % s["offText"])
    ok(s["b3jul"] == 0 and s["checks"] == 0, "3B 3.1(a) for July has no advance tax, and no check about advances (%s, %d)" % (s["b3jul"], s["checks"]))
    b2b_off = s["b2bAug"]

    print("2. Turn on")
    pg.click("#app [data-adv-turn-on]"); pg.wait_for_timeout(600)
    s = E(STATE)
    ch = s["choice"] or {}
    ok(ch.get("value") == "on" and ch.get("state") == "confirmed" and ch.get("by") and ch.get("at"), "kept as the client's confirmed choice, with who and when (%s)" % ch)
    ok(s["optin"] == "on" and s["tiles"] and s["at"] == 1 and s["txpd"] == 1 and s["b3jul"] == 90000, "the page shows 11A; July 11A and August 11B; 3B July IGST 90,000 (%s)" % s["b3jul"])
    ok(s["b2bAug"] == b2b_off, "B2B the same as with advances off (%s)" % s["b2bAug"])
    ok("Turned on" in s["who"], "who turned it on and when, beside the tick (%r)" % s["who"])

    print("3. off and on again with the tick")
    pg.click('#app input[aria-label="Show advances in GST returns (Tables 11A/11B)"]'); pg.wait_for_timeout(500)
    s = E(STATE); ch = s["choice"] or {}
    ok(ch.get("value") == "off" and (ch.get("prev") or {}).get("value") == "on" and s["off"] and s["at"] == 0, "the tick turns it off: the quiet line, the value before kept (%s)" % ch)
    pg.click("#app [data-adv-turn-on]"); pg.wait_for_timeout(500)
    ok(E(STATE)["optin"] == "on", "and Turn on again")

    print("4. after a reload")
    pg.wait_for_timeout(800); pg.reload(); pg.wait_for_timeout(2500)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    kept = E("(cid) => ((S.companies[cid] || {}).choices || {}).advGst || null", cid)
    ok(bool(kept) and kept.get("value") == "on" and kept.get("state") == "confirmed", "still on after a reload (%s)" % kept)
    E(SETUP, cid)
    E(OPEN, cid); pg.wait_for_timeout(900)
    s = E(STATE)
    ok(s["optin"] == "on" and s["at"] == 1, "the Advances page shows 11A after the reload")

    print("5. Client setup → GST")
    E("() => { S.tab = 'gstset'; render(); }"); pg.wait_for_timeout(1500)
    box = '#app input[aria-label="Show advances in GST returns (Tables 11A/11B)"]'
    ok(pg.locator(box).count() == 1 and pg.locator(box).is_checked(), "the same setting in Client setup → GST, ticked")
    pg.click(box); pg.wait_for_timeout(500)
    ch = E("() => CO().choices.advGst")
    foot = pg.locator('#app [data-confirm-foot="setup:gstset"]')
    ok(ch["value"] == "off" and not (foot.count() and "Not saved yet" in foot.inner_text()), "turned off there: saved at once, not left as a draft (%s)" % ch["value"])
    pg.click(box); pg.wait_for_timeout(500)
    ok(E("() => CO().choices.advGst.value") == "on", "and on again")

    print("6. who may change it")
    E("() => { S.account = Object.assign(S.account || {}, {me: {role: 'readonly', email: 'look@firm.test'}}); render(); }"); pg.wait_for_timeout(500)
    ok(pg.locator(box).is_disabled() and pg.locator("#app [data-adv-readonly]").count() >= 1, "Client setup → GST: a look-only user sees it disabled, with why")
    E(OPEN, cid); pg.wait_for_timeout(700)
    s = E(STATE)
    ok(s["box"] and s["boxDisabled"] and s["readonly"], "the Advances page: the tick disabled for a look-only user")
    E("() => { const i = document.querySelector('#app input[aria-label=\"Show advances in GST returns (Tables 11A/11B)\"]'); i.disabled = false; i.click(); }"); pg.wait_for_timeout(500)
    ok(E("() => CO().choices.advGst.value") == "on", "a look-only user cannot turn it off, even past the disabled tick")
    # turned off by the owner: a look-only user's "Turn on" is disabled too
    E("() => { S.account.me.role = 'owner'; render(); }"); pg.wait_for_timeout(300)
    pg.click('#app input[aria-label="Show advances in GST returns (Tables 11A/11B)"]'); pg.wait_for_timeout(500)
    E("() => { S.account.me.role = 'readonly'; render(); }"); pg.wait_for_timeout(400)
    s = E(STATE)
    ok(s["off"] and s["turnOnDisabled"] and s["readonly"], "off: a look-only user's “Turn on” is disabled, with why")
    E("() => { S.account.me.role = 'staff'; render(); }"); pg.wait_for_timeout(400)
    pg.click("#app [data-adv-turn-on]"); pg.wait_for_timeout(500)
    s = E(STATE)
    ok(s["optin"] == "on" and (s["choice"] or {}).get("value") == "on", "staff can turn it on")

    ok(not errors, "no page errors %s" % errors[:3])
    br.close()
print("all passed" if not fails else "%d FAILED" % len(fails))
raise SystemExit(1 if fails else 0)
