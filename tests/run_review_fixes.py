"""python3 run_review_fixes.py - review of 30 Sep 2026, phase 1 (items 1-12), checked the way a user would see them.
Offline, a made-up client; no client data needed.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_review_fixes.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8171), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8171/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    app = lambda: pg.inner_text("#app")
    # a client with a GSTIN in UP, and one with none
    cid = pg.evaluate("""() => { const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; return c.id; }""")
    nog = pg.evaluate("""() => { const c = newCompany({name: "No GSTIN Traders", gstin: ""}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; return c.id; }""")
    bill = """(a) => { const [cid, x, nat, extra] = a; const e = newEntry("SNT-113.pdf"); Object.assign(e.x, x); e.natureId = nat; e.partyLedger = x.vendorName; e.expenseLedger = "Technical Services";
      Object.assign(e, extra || {}); S.data[cid].entries[e.id] = e; return e.id; }"""
    snt = {"vendorName": "Shree Nandik Technologies", "vendorGstin": "09ABCFS1234K1Z1", "invoiceNo": "SNT/26-27/113", "invoiceDate": "2026-09-19", "taxable": 30000, "cgst": 2700, "sgst": 2700, "total": 35400,
           "buyerGstin": "", "description": "Technical services", "items": [{"desc": "Software support", "hsn": "998314", "taxable": 30000}]}
    snt["vendorGstin"] = pg.evaluate("() => { for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'){ const g = '09ABCFS1234K1Z' + ch; if (gstinValid(g)) return g; } }")
    C = lambda cid_, id_, k: pg.evaluate("(a) => compute(S.data[a[0]].entries[a[1]], a[0])[a[2]]", [cid_, id_, k])

    # 1. 17(5): IT services with club words on the page are not flagged; the reason is named when a code triggers
    e1 = pg.evaluate(bill, [cid, snt, "technical", {"hint": "Member of the Rotary Club. Club membership no. 4471. Membership fee paid."}])
    ok(pg.evaluate("(a) => compute(S.data[a[0]].entries[a[1]], a[0]).gd.blockSuggest", [cid, e1]) is None, "1. SAC 998314 bill with club words in the footer: no 17(5) flag")
    # 3. TDS below the limit is off by default, even with an old unrecorded tick
    e3 = pg.evaluate(bill, [cid, snt, "technical", {"tdsAlways": True, "tdsForce": True}])
    ok(C(cid, e3, "tds") == 0 and not C(cid, e3, "anyway"), "3. ₹30,000 technical bill within ₹50,000: no TDS (an old tick with nobody recorded is ignored)")
    # 4. ITC: the client with a GSTIN takes credit; without a GSTIN the GST goes to the cost
    e4 = pg.evaluate(bill, [nog, snt, "technical", {}])
    lines = pg.evaluate("(a) => compute(S.data[a[0]].entries[a[1]], a[0]).lines", [nog, e4])
    ok(not any(l["role"] == "gst" for l in lines) and any(l["role"] == "expense" and l["amt"] == 35400 for l in lines), "4. client without GSTIN: no Input CGST/SGST, ₹35,400 to the expense")
    ok(any(l["role"] == "gst" for l in pg.evaluate("(a) => compute(S.data[a[0]].entries[a[1]], a[0]).lines", [cid, e1])), "4. client with the GSTIN: input credit taken")
    other = dict(snt, buyerGstin="07AAACB1234C1Z5")
    e4b = pg.evaluate(bill, [cid, other, "technical", {}])
    ok(not C(cid, e4b, "itc")["ok"] and not any(l["role"] == "gst" for l in pg.evaluate("(a) => compute(S.data[a[0]].entries[a[1]], a[0]).lines", [cid, e4b])), "4. billed to another GSTIN: no input credit")
    igst = dict(snt, cgst=0, sgst=0, igst=5400)
    e4c = pg.evaluate(bill, [cid, igst, "technical", {}])
    ok(any("CGST + SGST are expected" in f["t"] for f in C(cid, e4c, "flags")), "4. same-state supplier charging IGST: the place of supply is questioned")
    # 2. a blank ledger on any line stops approval
    pg.evaluate("(cid) => { S.companies[cid].gst.cgst = ''; }", cid)
    ok(any("GST ledger" in m for m in C(cid, e1, "missing")), "2. a blank GST ledger: approval waits for it")
    pg.evaluate("(cid) => { S.companies[cid].gst.cgst = 'Input CGST'; }", cid)
    # open the bill on screen
    pg.evaluate("(a) => openCompany(a[0]).then(() => { goStep('review', 'bills'); })", [cid]); pg.wait_for_timeout(1000)
    if pg.locator('#app button:has-text("One at a time")').count(): pg.click('#app button:has-text("One at a time")'); pg.wait_for_timeout(500)
    pg.evaluate("(id) => { S.selected = id; render(); }", e1); pg.wait_for_timeout(700)
    ok("Deduct anyway (expected to cross the limit)" in app(), "3. below the limit the tick reads “Deduct anyway (expected to cross the limit)”")
    pg.click('#app label:has-text("Deduct anyway") input'); pg.wait_for_timeout(500)
    ok(C(cid, e1, "tds") == 600 and pg.evaluate("(id) => D().entries[id].tdsAlwaysBy", e1) != "" and "Deducted anyway on your instruction" in app(), "3. ticked: ₹600 deducted, who ticked it recorded and shown")
    pg.click('#app label:has-text("Deduct anyway") input'); pg.wait_for_timeout(500)
    ok(C(cid, e1, "tds") == 0, "3. unticked: no TDS")
    ok("Place of supply: supplier in 09" in app() and "CGST + SGST is expected" in app(), "4. the bill shows the place of supply check")
    ok("The ledgers are not checked against Tally yet" in app(), "2. no ledger list read: the draft entry says so, with a button to read it")
    ok("shown only in the session it was uploaded" not in app(), "12. the contradicting line is gone")
    ok(pg.locator("#app .billdoc, #app .prevbox").count() >= 1, "12. the bill's document panel sits beside the fields")
    # 8. suppliers on waiting bills
    pg.evaluate("() => { S.tab = 'deductees'; render(); }"); pg.wait_for_timeout(600)
    # 2c58741 (review of 02-Oct-2026): the list is "Supplier not yet in FinCom's list", each marked new or with its Tally ledger
    ok("Supplier not yet in FinCom\u2019s list" in app() and "Shree Nandik Technologies" in app(), "8. Client setup lists the supplier of a waiting bill as new")
    pg.click('#app button:has-text("Save and fill in")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("Object.values(D().parties).some(p => p.name === 'Shree Nandik Technologies')"), "8. Save and fill in: the supplier is in the list")
    # 5. one Tally status
    st = pg.evaluate("tallyStatus(CO()).label")
    # round 39: Client setup says the client's link in the four words of its Link to Tally card
    ok(st == "Not set up" and "Tally: Not linked" in pg.inner_text("#top, header, body"), "5. one status: “Not set up” with no bridge and no computer sending; Client setup: “Tally: Not linked”")
    # 9 and 10. a new sales invoice
    pg.evaluate("(cid) => { goClient('sales'); }", cid); pg.wait_for_timeout(800)
    pg.evaluate("startDraft()"); pg.wait_for_timeout(700)
    opts = pg.eval_on_selector_all('#app select:near(:text("Place of supply")) option', "os => os.map(o => o.value).filter(Boolean)")
    ok(opts[:3] == ["01", "02", "03"] and opts[-2:] == ["96", "97"], "9. states in code order: 01, 02, 03 … 96, 97 (" + ",".join(opts[:3]) + "…" + ",".join(opts[-2:]) + ")")
    pg.evaluate("() => { draftItem(0, 'desc', 'Chairs'); draftItem(0, 'rate', 1000); draftItem(0, 'gstRate', 28); }"); pg.wait_for_timeout(500)
    ok("28% applies after 22-09-2025 only to a few items" in app(), "10. 28% on an invoice after 22-09-2025: a warning")
    ok(pg.locator('#app input[aria-label="Cess"]').count() == 1, "10. a Cess column on the items")
    pg.evaluate("() => { draftItem(0, 'cess', 150); }"); pg.wait_for_timeout(400)
    ok(pg.evaluate("SL().draft.x.cess") == 150 and "Cess" in pg.inner_text("#app .si-tot"), "10. cess on an item goes into the invoice and its totals")
    pg.evaluate("() => salesAct('salesCancel')"); pg.wait_for_timeout(400)
    pg.evaluate("(cid) => openCompany(cid).then(() => { goClient('sales'); startDraft(); })", nog); pg.wait_for_timeout(900)
    ok("Same state: CGST + SGST" not in app() and "The client's state is not known" in app(), "9. client state not known: no CGST/SGST note, it says what to add")
    pg.evaluate("() => { draftItem(0, 'desc', 'Chairs'); draftItem(0, 'rate', 1000); draftItem(0, 'gstRate', 28); }"); pg.wait_for_timeout(500)
    tot = pg.inner_text("#app .si-tot")
    ok("CGST" not in tot and "SGST" not in tot and "IGST" not in tot and pg.evaluate("SL().draft.x.total") == 1000, "9. client state not known: no GST lines in the totals, and none in the total (" + tot.replace("\n", " ") + ")")
    pg.evaluate("() => salesAct('salesCancel')"); pg.wait_for_timeout(300)
    # 5 (recheck). a firm Tally computer heard just now: linked client in sync, a client with only a Tally name typed is not linked
    st = pg.evaluate("""(a) => { const [cid, nog] = a; S.companies[nog].tallyName = "Mastercad Solutions"; TCloud.on = () => true; TLight.st.at = Date.now();
      TLight.st.devs = [{id: "d1", name: "Office", last_seen: new Date().toISOString(), info: {beat: {at: new Date().toISOString(), tally: true, companies: []}}}];
      TLight.st.cos = [{company: "GARG SHEKHAR & COMPANY", client_id: cid, gstin: "09AANFG3202D1ZR"}];
      return [tallyStatus(S.companies[cid]).state, tallyStatus(S.companies[nog]).label]; }""", [cid, nog])
    ok(st[0] in ("ok", "waiting") and st[1] == "Connected \u2013 company not linked", "5. linked client: connected; a client with only a Tally name typed: “Connected – company not linked” (" + str(st) + ")")
    pg.evaluate("(cid) => openCompany(cid).then(() => { S.tab = 'books'; S.booksTab = 'import'; render(); })", nog); pg.wait_for_timeout(1200)
    # The owner's simpler upload page (08-Oct-2026, next-uploadpage 143a104b; docs/ui-pass/uploadpage/README.md row 12)
    # removed step 4 and its Tally pill from From Tally: the top bar's Tally sign is the one status on the page. Item 5
    # ("one status everywhere") is kept as: no second, different Tally status on this page, and the top bar's sign shown.
    ok("Not connected on this computer" not in app() and "4. FinCom Bridge" not in app() and pg.locator("#app [data-tally]").count() == 0
       and pg.locator("[data-tally-sign]").count() == 1,
       "5. From Tally: no Tally status of its own (no “Not connected on this computer”, no step 4); the top bar’s sign is the one status")
    # 6 (recheck). the link as the cloud has it, and the GSTIN matched whatever its spacing or case
    ok(pg.evaluate("(cid) => (gstinMatch({gstin: ' 09aanfg3202d1zr '}) || {}).id === cid", cid), "6. a Tally company's GSTIN matches the client's, whatever the case or spaces")
    pg.evaluate("""(cid) => { TCloud.rpc = async () => ({}); Cloud.api = async (q) => /tally_devices/.test(q) ? [] : [];
      TCloud.restAll = async () => [{company: "GARG SHEKHAR & COMPANY", client_id: cid, gstin: "09AANFG3202D1ZR", last_seen: new Date().toISOString(), linked_at: new Date().toISOString()}];
      TCloud.pane.devices = null; S.view = "home"; S.homeTab = "rules"; S.settingsTab = "tcloud"; render(); }""", cid); pg.wait_for_timeout(1200)
    ok("Linked to Testing AAD" in app() and pg.eval_on_selector('#app select[aria-label="Client for GARG SHEKHAR & COMPANY"]', "s => s.options[s.selectedIndex].text") == "Testing AAD",
       "6. Books in the cloud: GARG SHEKHAR & COMPANY shows as linked to Testing AAD")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
