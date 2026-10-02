"""python3 run_post_preview.py - review of 02-Oct-2026, B9/B10/B12: before anything goes to Tally.
  - each voucher is shown as it goes to Tally (read from the XML being sent): date, voucher type, each ledger Dr / Cr,
    narration; with warnings for a new ledger, an income ledger on a purchase, and a party whose GSTIN is not the bill's;
  - a "create master" for a ledger Tally already has (INPUT CGST: same name, any case) is never sent;
  - a ledger that must be created is named first ("This will create ledger X under group Y in <company>"), nothing is
    sent until that is confirmed, and Cancel sends nothing;
  - Tally's ALTERED is said "Altered in Tally", never "created"; one word per entry (In Tally (verified) / In Tally, not
    yet read back / Altered in Tally / Failed: reason).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_preview.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8231), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """async () => {
  const c = newCompany({name: "ZZ PREVIEW", gstin: "09AANFG3202D1ZR"}); c.postTo = "ZZ CO"; c.tallyName = "ZZ CO"; c.voucherType = "Purchase";
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  await openCompany(c.id);
  const mk = (n, gstin, no, amt, exp) => { const e = newEntry("Manual entry"); Object.assign(e.x, {vendorName: n, vendorGstin: gstin, invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = exp; S.data[c.id].entries[e.id] = e; approve(e); return e; };
  const a = mk("Alpha Consultants", "09AAAPA1234A1Z5", "A/1", 100000, "Professional Charges");
  const g = mk("Gamma Rentals", "09AAAFG5678B1Z5", "G/3", 60000, "Sales Account");
  refreshStats(c.id); goStep("post", "bills");
  await new Promise(r => setTimeout(r, 600));
  S.bank.loading = false;
  S.bank.ledgers = Object.assign({}, S.bank.ledgers, {importedAt: new Date().toISOString(), live: true, list: [
    {name: "Alpha Consultants", group: "Sundry Creditors", gstin: "09AAAPA1234A1Z5"}, {name: "Gamma Rentals", group: "Sundry Creditors", gstin: "09ZZZZZ9999Z1Z5"},
    {name: "Sales Account", group: "Sales Accounts"}, {name: "TDS Payable", group: "Duties & Taxes"}, {name: "TDS Payable - Professional", group: "Duties & Taxes"}, {name: "INPUT CGST", group: "Duties & Taxes"}, {name: "INPUT IGST", group: "Duties & Taxes"},
    {name: "Round Off", group: "Indirect Expenses"}]});
  S.bank.newLed = [{name: "Input Cgst", group: "Duties & Taxes"}, {name: "Professional Charges", group: "Indirect Expenses"}];
  window.__sent = []; window.__reply = null;
  Bridge.postChecked = async (p) => { window.__sent.push(JSON.parse(JSON.stringify(p))); return window.__reply ? window.__reply(p) : {ok: true, company: p.company, results: [].concat(p.masters, p.vouchers).map(x => ({id: x.id, ok: true, verified: true}))}; };
  render();
  return {cid: c.id, a: a.id, g: g.id};
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8231/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    ids = pg.evaluate(SETUP); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    # B10: the voucher as it goes to Tally
    v = E("(id) => voucherPreview(voucherXml(D().entries[id], CO()))", ids["a"])
    ok(v["date"] == "2026-07-01" and v["type"] == "Purchase" and v["ref"] == "A/1" and v["party"] == "Alpha Consultants" and "TDSDesk:" in v["narration"],
       "B10. read from the XML sent: date, voucher type, reference, party, narration (%s)" % {k: v[k] for k in ("date", "type", "ref", "party")})
    dr = [l for l in v["lines"] if l["dr"]]; cr = [l for l in v["lines"] if not l["dr"]]
    ok(any(l["ledger"] == "Professional Charges" and l["amount"] > 0 for l in dr) and any(l["ledger"] == "Alpha Consultants" for l in cr) and v["dr"] == v["cr"],
       "B10. each ledger with Dr / Cr amount, debits = credits (%s)" % [(l["ledger"], "Dr" if l["dr"] else "Cr", l["amount"]) for l in v["lines"]])
    # the Preview action of one entry
    pg.click('#app [data-post-row="%s"] [data-preview]' % ids["a"]); pg.wait_for_timeout(400)
    box = pg.inner_text("#confirmBox") if pg.locator("#confirmBox [data-pv]").count() else ""
    ok("Professional Charges" in box and "01-Jul-2026" in box and "Purchase" in box and "TDSDesk:" in box, "B10. Preview shows the entry: date, type, ledgers, narration")
    ok("New ledger: Professional Charges will be created under Indirect Expenses" in box, "B10. warning: a new ledger (not in Tally's list)")
    ok(pg.locator('#confirmBox [data-cbx="no"]').count() == 0, "a Preview only shows (Close)")
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    pg.click('#app [data-post-row="%s"] [data-preview]' % ids["g"]); pg.wait_for_timeout(400)
    box = pg.inner_text("#confirmBox")
    ok("Income ledger on a purchase: Sales Account is under Sales Accounts" in box, "B10. warning: an income ledger on a purchase")
    ok("Party not matched by GSTIN: the bill is from 09AAAFG5678B1Z5, but the ledger Gamma Rentals has 09ZZZZZ9999Z1Z5" in box, "B10. warning: the party's GSTIN is not the bill's")
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    # B9: a master for a ledger Tally has is not sent; a new one asked first
    E("""() => { window.__res = null; window.__err = null;
      Bridge.post({company: "ZZ CO", client: S.coId, masters: [{id: "led:Input Cgst", xml: ledgerMasterXml({name: "Input Cgst", group: "Duties & Taxes"})}, {id: "led:INPUT IGST", xml: ledgerMasterXml({name: "INPUT IGST", group: "Duties & Taxes"})}],
        vouchers: [{id: "v1", xml: voucherXml(Object.values(D().entries)[0], CO())}]}).then(r => window.__res = r, e => window.__err = e); }""")
    pg.wait_for_timeout(600)
    s = E("window.__sent"); r = E("window.__res")
    ok(r and len(s) == 1 and s[0]["masters"] == [] and len(s[0]["vouchers"]) == 1 and pg.locator("#confirmBox [data-create-masters]").count() == 0,
       "B9. INPUT CGST / INPUT IGST already in Tally (any case): no create master sent, nothing asked")
    ex = [x for x in (r or {}).get("results", []) if x["id"].startswith("led:")]
    ok(len(ex) == 2 and all(x["ok"] and x["existed"] for x in ex) and "Already in Tally" in ex[0]["word"], "B9. they are answered here: already in Tally, not sent (%s)" % [x.get("word") for x in ex])
    E("""() => { window.__sent = []; window.__res = null; window.__err = null;
      Bridge.post({company: "ZZ CO", client: S.coId, masters: [{id: "led:Brand New Ledger", xml: ledgerMasterXml({name: "Brand New Ledger", group: "Indirect Expenses"})}], vouchers: [{id: "v2", xml: voucherXml(Object.values(D().entries)[0], CO())}]})
        .then(r => window.__res = r, e => window.__err = e); }""")
    pg.wait_for_timeout(600)
    ask = pg.inner_text("#confirmBox [data-create-masters]") if pg.locator("#confirmBox [data-create-masters]").count() else ""
    ok("This will create ledger Brand New Ledger under group Indirect Expenses in ZZ CO." in ask and E("window.__sent.length") == 0, "B9. a new ledger: asked first, nothing sent yet (%s)" % ask[:90])
    pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(400)
    err = E("window.__err")
    ok(E("window.__sent.length") == 0 and err and err.get("code") == "cancelled" and "Nothing was sent to Tally" in err.get("message", ""), "B9. Cancel: nothing at all is sent (%s)" % (err or {}).get("message"))
    E("""() => { window.__res = null; Bridge.post({company: "ZZ CO", client: S.coId, masters: [{id: "led:Brand New Ledger", xml: ledgerMasterXml({name: "Brand New Ledger", group: "Indirect Expenses"})}], vouchers: []}).then(r => window.__res = r); }""")
    pg.wait_for_timeout(500); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(500)
    ok(E("window.__sent.length") == 1 and E("window.__sent[0].masters.length") == 1, "B9. confirmed: the new ledger goes")
    # B12: ALTERED said as altered
    w = E("""() => [postWord({ok: true, altered: 1, created: 0, message: "ALTERED 1"}), postWord({ok: true, message: "ALTERED: 1"}), postWord({ok: true, verified: true, created: 1}),
      postWord({ok: true, verified: null}), postWord({ok: false, message: "Ledger &apos;X&apos; does not exist!"})]""")
    ok(w == ["Altered in Tally", "Altered in Tally", "In Tally (verified)", "In Tally, not yet read back", "Failed: Ledger 'X' does not exist!"], "B12. one word each: %s" % w)
    # the whole run: the main button shows every entry first (Post / Cancel); a master Tally has is dropped; ALTERED shown
    E("""() => { window.__sent = []; window.__reply = (p) => ({ok: true, company: p.company, results: p.masters.map(m => ({id: m.id, ok: true, altered: 1, created: 0, message: "ALTERED 1"}))
        .concat(p.vouchers.map((v, i) => i === 0 ? {id: v.id, ok: true, verified: true, altered: 1, created: 0} : {id: v.id, ok: true, verified: true, created: 1}))});
      window.ensureTallyCompany = async () => "ZZ CO"; window.syncLedgersFromTally = async () => true; window.tallyCall = async () => ({vouchers: []}); window.canPostTally = () => true; render(); }""")
    pg.wait_for_timeout(400)
    main = pg.locator("#app [data-post-main]")
    ok(main.count() == 1 and main.inner_text() == "Post 2 to Tally", "the main button: Post 2 to Tally")
    main.click(); pg.wait_for_timeout(600)
    pv = pg.inner_text("#confirmBox") if pg.locator("#confirmBox [data-post-preview]").count() else ""
    ok(pg.locator("#confirmBox [data-pv]").count() == 2 and "Post 2 entries to ZZ CO?" in pv and pg.locator('#confirmBox [data-cbx="no"]').inner_text() == "Cancel" and pg.locator('#confirmBox [data-cbx="yes"]').inner_text() == "Post",
       "B10. Post shows the preview of all before sending (Post / Cancel)")
    ok("This will create ledger Professional Charges under group Indirect Expenses in ZZ CO." in pv and "Input Cgst" not in pv, "B9. the preview names the ledger to be created, not the one Tally has")
    ok(pg.locator("#confirmBox [data-pv-count]").count() == 1, "the warnings are counted above the buttons")
    ok(E("window.__sent.length") == 0, "nothing sent while the preview is open")
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(2000)
    s = E("window.__sent")
    ok(len(s) == 1 and [m["id"] for m in s[0]["masters"]] == ["led:Professional Charges"] and len(s[0]["vouchers"]) == 2 and pg.locator("#confirmBox [data-create-masters]").count() == 0,
       "B9. posted: only the new ledger as a master (Input Cgst not sent), not asked twice (%s)" % [m["id"] for m in s[0]["masters"]] if s else "nothing sent")
    res = pg.inner_text("#app [data-post-result]") if pg.locator("#app [data-post-result]").count() else ""
    ok("1 altered in Tally" in res and "Professional Charges: Altered in Tally" in res and "created" not in res.lower(), "B9/B12. Tally's ALTERED is said 'altered', not 'created' (%s)" % res.replace("\n", " ")[:160])
    lg = E("(S.firm.postLog || []).filter(x => x.co === S.coId).map(x => x.what + ':' + x.action)")
    ok("ledger:altered" in lg and "bill:altered" in lg and "bill:posted" in lg and not any("created" in x for x in lg), "B12. the record says altered for the altered ones (%s)" % lg)
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
