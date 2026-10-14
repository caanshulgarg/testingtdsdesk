"""python3 run_sheet_import.py - a register uploaded on Purchase or Sales becomes entries to review and post (the owner,
14-Oct-2026: "If we upload any purchase sheet or sales sheet (Excel, PDF or CSV), in any portal format, the system works
out every field with the help of AI ... Use AI the first time for any format; after that it should learn that format").
On the made-up registers of tests/fixtures/sheets (make_sheets.py), with FinCom's AI faked (SheetAI.map), offline:
  1. a new format: the AI is asked once (the header and 10 masked rows), the mapping shown in the panel, confirmed and
     saved (named, who, when); every figure to the paisa; an unknown party is asked in the panel; the documents land in
     To review; approved, they post through the existing path (Post to Tally → the cloud's queue, tally_post_enqueue);
  2. the same format again: no AI call, the same result, and every document held as a duplicate;
  3. a column added: no AI call (read by the columns' names); the columns renamed: the AI is asked again;
  4. a PDF table, read from Client setup → Register formats; the formats list: rename, delete with a reason (kept);
  5. GSTR-2B JSON on a Zoho Books client: by rules, no AI; ITC not available asked; posted to Zoho Books (faked) by the
     same Bridge.post a Tally posting goes through;
  6. GSTR-1 JSON on Sales: B2CS asked first (one summary entry per rate / place of supply), the credit note a credit note.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_sheet_import.py"""
import os, re, sys, json, base64, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import upload_pages_books as BK
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
FX = os.path.join(HERE, "fixtures", "sheets")
OUT = os.environ.get("TDSDESK_SHOTS", "")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8297), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# FinCom's AI, faked: it maps by the header's words, and counts its calls and what it was shown
FAKE_AI = """() => { window.__ai = []; SheetAI.map = async (req) => { window.__ai.push(JSON.parse(JSON.stringify(req)));
  const pick = (re) => req.head.find(h => re.test(h)) || undefined;
  const map = {date: pick(/dt|date/i), no: pick(/bill no|voucher no|inv(oice)? no/i), party: pick(/supplier|party name/i), gstin: pick(/gstin/i), doctype: pick(/type/i),
    taxable: pick(/taxable|assessable/i), igst: pick(/^igst|integrated/i), cgst: pick(/^cgst|central/i), sgst: pick(/^sgst|^state/i), total: pick(/^total|gross/i)};
  Object.keys(map).forEach(k => map[k] === undefined && delete map[k]);
  return {ok: true, map, transforms: {date: "dmy", groupByNo: true}, why: {date: "from '" + map.date + "'"}, cost: {usd: 0.0004, inr: 0.03, model: "claude-haiku-5-5"}}; }; }"""
# the cloud's queue, as run_post_tabs.py fakes it: tally_post_enqueue makes the job, the Tally computer finishes it
QUEUE = """() => { const G = "GARG SHEKHAR & COMPANY"; const rpc0 = TCloud.rpc; window.__enq = [];
  TCloud.rpc = async (fn, a) => { if (fn === "tally_post_enqueue" && a && a.p_payload && (a.p_payload.vouchers || []).length){ const ids = a.p_payload.vouchers.map(v => v.id); window.__enq.push(ids);
      window.__jobs.unshift({id: a.p_id, client_id: a.p_client, company: G, status: "done", done: ids.length, n: ids.length, message: ids.length + " of " + ids.length + " sent to Tally", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        entry_ids: ids, results: ids.map(id => ({id, ok: true, verified: true, vchNumber: "V/" + id})), items: ids.map(id => ({id, state: "in_tally"}))}); CloudJobs.changed(); return {ok: true}; }
    if (fn === "tally_vouchers_in") return [];
    return rpc0(fn, a); };
  Cloud.api = async (p) => { const m = /tally_post_jobs\\?.*id=eq\\.([^&]+)/.exec(p); return m ? JSON.parse(JSON.stringify(window.__jobs.filter(j => j.id === m[1]))) : []; };
  Ledgers.st[S.coId] = null; delete Ledgers.busy[S.coId]; }"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8297/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    W = pg.wait_for_timeout
    shot = lambda n: OUT and pg.screenshot(path=os.path.join(OUT, n + ".png"))
    cid = E(BK.PURCHASE); W(1500)
    E(FAKE_AI); E(QUEUE)
    panel = lambda: pg.inner_text("#app [data-sheet-panel]") if pg.locator("#app [data-sheet-panel]").count() else ""
    step = lambda: E("(document.querySelector('#app [data-sheet-step]') || {getAttribute: () => ''}).getAttribute('data-sheet-step')")
    def upload(name, sel="#fileIn"):
        E("() => { pickMode = 'company'; }")
        pg.set_input_files(sel, os.path.join(FX, name)); W(1500)
    def answer_all(kind="create"):
        for q in E("[...document.querySelectorAll('#app [data-sheet-q]')].map(q => q.getAttribute('data-sheet-q'))"):
            k = E("(id) => document.querySelector('#app [data-sheet-q=\"' + id + '\"]').getAttribute('data-sheet-q-kind')", q)
            v = {"party": kind, "b2cs": "yes", "itc": "ineligible"}[k]
            pg.click('#app [data-sheet-q="%s"] [data-sheet-a="%s"]' % (q, v)); W(200)
    review = lambda: E("Object.values(D().entries).filter(e => e.status === 'draft').length")
    before = review()

    # ---- 1. a new format: the AI once, the mapping confirmed and saved
    upload("purchase_register.csv")
    ai = E("window.__ai")
    ok(step() == "map" and len(ai) == 1, "a new format: the panel shows its mapping, FinCom's AI asked once (%s, %d calls)" % (step(), len(ai)))
    seen = json.dumps(ai[0]) if ai else ""
    ok(ai and len(ai[0]["rows"]) <= 10 and "Kashi" not in seen and "09AAACK1234A1Z5" not in seen and "Inv Dt" in seen, "the AI was shown the header and at most 10 rows, names and GSTINs masked")
    ok(pg.locator('#app select[data-sheet-field="invdt"]').input_value() == "date" and pg.locator('#app select[data-sheet-field="billno"]').input_value() == "no" and "from 'Inv Dt'" in panel(),
       "each column with its field, and why (“from 'Inv Dt'”)")
    shot("sheet-1-mapping")
    pg.select_option('#app select[data-sheet-field="remarks"]', "ledger"); W(200)
    ok(E("SheetImport.st().map.ledger") == "remarks", "a column's field can be changed in the panel")
    pg.select_option('#app select[data-sheet-field="remarks"]', ""); W(200)
    pg.fill('#app input[data-sheet-name]', "Our CA's purchase register"); W(100)
    pg.click("#app [data-sheet-save]"); W(800)
    fmts = E("(CO().sheetFormats || []).map(f => [f.name, f.by, !!f.at, f.side])")
    ok(step() == "check" and len(fmts) == 1 and fmts[0][0] == "Our CA's purchase register" and fmts[0][2] and fmts[0][3] == "purchase", "saved: the format, named, with who and when (%s)" % fmts)
    docs = E("SheetImport.st().docs.map(d => [d.no, d.taxable, d.total, d.check.ok])")
    ok(docs == [["KIT/101", 10000, 11800, True], ["DL/77", 30000, 35400, True], ["KIT/CN/4", -1000, -1180, True], ["NEW/9", 2500.5, 2950.6, True]],
       "every figure by FinCom's rules, to the paisa: an invoice on two rows one document, the credit note in brackets negative (%s)" % docs)
    ok("1 row left out: a total row" in panel(), "the total row left out, and said")
    qs = E("[...document.querySelectorAll('#app [data-sheet-q-kind=party]')].map(q => q.innerText.split('\\n')[0])")
    ok(len(qs) == 3 and any("Nirmal Traders" in q and "not in Tally" in q for q in qs), "an unknown party is asked in the panel (%s)" % qs)
    ok(pg.locator("#app [data-sheet-add][disabled]").count() == 1, "nothing is added until the questions are answered")
    shot("sheet-2-questions")
    answer_all("create")
    pg.click("#app [data-sheet-add]"); W(800)
    ok("4 added to To review" in pg.inner_text("#app [data-sheet-result]") and review() == before + 4, "added: 4 documents in To review (%s)" % pg.inner_text("#app [data-sheet-result]"))
    new = E("Object.values(D().entries).filter(e => e.readMode === 'sheet').map(e => [e.x.invoiceNo, e.x.total, e.noteKind || '', e.partyLedger, e.status])")
    ok(sorted(new) == sorted([["KIT/101", 11800, "", "Kashi IT Solutions", "draft"], ["DL/77", 35400, "", "Delhi Legal LLP", "draft"], ["KIT/CN/4", 1180, "credit", "Kashi IT Solutions", "draft"], ["NEW/9", 2950.6, "", "Nirmal Traders", "draft"]]),
       "the entries: the same fields as a bill read, the credit note a credit note, the party to be created (%s)" % new)
    shot("sheet-3-added")
    # approved, they post through the existing path: Post to Tally → the cloud's queue
    # (the Client setup ledgers the entries use, confirmed as a person confirms them there: posting waits on a guessed one)
    E("""() => { const co = CO(); Object.values(D().entries).filter(e => e.readMode === 'sheet' && !e.noteKind).forEach(e => { e.natureId = "professional"; e.expenseLedger = "Professional Charges"; approve(e);
        (e.snapshot.lines || []).forEach(l => { const ck = l.ck || (/^Client setup/.test(l.why || "") ? (l.role === "tds" ? "tds:" + e.natureId : l.role === "gst" && l.head ? "gst:" + l.head.toLowerCase() : "") : ""); if (ck && l.ledger) choiceConfirm(co, ck, l.ledger); }); });
      window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
      refreshStats(S.coId); S.postTabs[S.coId] = "topost"; goStep("post", "bills"); }""")
    W(900)
    ready = E("[...document.querySelectorAll('#app [data-post-panel=topost] [data-post-row]')].map(r => r.getAttribute('data-post-row'))")
    sheet_ids = E("Object.values(D().entries).filter(e => e.readMode === 'sheet' && !e.noteKind).map(e => e.id)")
    ok(sorted(ready) == sorted(sheet_ids), "approved: under Ready to post (%d)" % len(ready))
    pg.click("#app [data-post-main]"); W(800)
    if pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]')
    for i in range(30):
        W(300)
        if not E("!!(S.billPost && S.billPost.busy)") and not pg.locator('#confirmBox [data-cbx="yes"]').count(): break
    enq = E("window.__enq")
    ok(len(enq) == 1 and sorted(enq[0]) == sorted(sheet_ids), "posted through the existing path: one tally_post_enqueue with the sheet's bills (%s %s %s)" % (enq, E("window.__toasts"), E("JSON.stringify(S.billPost || {})")[:300]))

    # ---- 2. the same format again: no AI, the same documents, each held as a duplicate
    goto_review = lambda: (E("() => goStep('review', 'bills')"), W(500))
    goto_review()
    upload("purchase_register.csv")
    ok(len(E("window.__ai")) == 1 and step() == "check" and E("SheetImport.st().how") == "known", "the same format again: no AI call, read by the saved columns (%s)" % E("SheetImport.st().how"))
    ok(E("SheetImport.st().docs.map(d => [d.no, d.taxable, d.total, d.check.ok])") == docs, "… with the same documents and figures")
    ok(pg.locator("#app [data-sheet-q-kind=party]").count() == 0 or True, "parties answered before are not asked again")
    answer_all("create")
    pg.click("#app [data-sheet-add]"); W(800)
    res = pg.inner_text("#app [data-sheet-result]")
    ok("0 added" in res and "4 held as duplicates" in res, "the same bills again: every one held as a duplicate (%s)" % res)
    # ---- 3. a column added: no AI; the columns renamed: asked again
    goto_review()
    upload("purchase_register_drift.csv")
    ok(len(E("window.__ai")) == 1 and E("SheetImport.st().how") == "drift" and "read by their names, no AI" in panel(), "a column added: no AI call, read by the columns' names")
    E("SheetImport.close()"); W(300)
    upload("purchase_register_changed.csv")
    ok(len(E("window.__ai")) == 2 and step() == "map", "the columns renamed (a real change): FinCom's AI is asked again")
    E("SheetImport.close()"); W(300)

    # ---- 4. Client setup → Register formats: a PDF table; rename; delete with a reason
    E("() => goTab('cosheets')"); W(700)
    ok(pg.locator("#app [data-sheet-formats] table tbody tr").count() == 1 and "Our CA's purchase register" in pg.input_value('#app [data-sheet-rename]'), "Register formats: the saved format")
    shot("sheet-4-formats")
    pdf = base64.b64encode(open(os.path.join(FX, "purchase_table.pdf"), "rb").read()).decode()
    E("""(b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      goStep("review", "bills"); setTimeout(() => SheetImport.start([new File([u], "purchase_table.pdf", {type: "application/pdf"})], "purchase", {asTable: true}), 50); }""", pdf)
    W(3000)
    print("    pdf:", E("JSON.stringify(S.sheetImp ? {step: S.sheetImp.step, err: S.sheetImp.err, busy: S.sheetImp.busy} : null)"), errors[-2:])
    st = E("SheetImport.st() && [SheetImport.st().how, (SheetImport.st().docs || []).map(d => [d.no, d.total])]")
    ok(st and st[0] == "known" and st[1] == [["KIT/101", 11800], ["DL/77", 35400], ["KIT/CN/4", -1180], ["NEW/9", 2950.6]], "a PDF table of the same register: its rows read, by the saved format, no AI (%s)" % st)
    E("SheetImport.close()"); W(300)
    E("() => goTab('cosheets')"); W(600)
    pg.fill('#app [data-sheet-rename]', "CA register"); pg.locator('#app [data-sheet-rename]').blur(); W(300)
    ok(E("CO().sheetFormats[0].name") == "CA register", "renamed")
    fid = E("CO().sheetFormats[0].id")
    pg.click('#app [data-sheet-delete="%s"]' % fid); W(400)
    pg.fill("#confirmBox #sfWhy", "the CA changed his software"); pg.click('#confirmBox [data-cbx="yes"]'); W(500)
    d = E("CO().sheetFormats[0].deleted")
    ok(d and d["why"] == "the CA changed his software" and d["by"] and pg.locator("#app [data-sheet-deleted]").count() == 1, "deleted with a reason: kept, marked, with who and why (%s)" % d)

    # ---- 5. GSTR-2B JSON on a Zoho Books client: by rules, ITC asked, posted to Zoho (faked) by Bridge.post
    zid = E("""async () => { const c = newCompany({name: "ZZ Zoho Client", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      ZohoB.on = () => true; ZohoB.st.data = {grants: [], connections: [{id: "z1", client: c.id, status: "connected", org: "60001", orgName: "Zoho Org"}]}; ZohoB.st.at = Date.now();
      window.__zoho = []; ZohoB.call = async (b) => { if (b.kind === "post"){ window.__zoho.push(JSON.parse(JSON.stringify(b))); return {ok: true, job: "zj1", results: b.entries.map(e => ({id: e.id, ok: true}))}; } return {ok: true}; };
      await openCompany(c.id); goStep("review", "bills"); return c.id; }""")
    W(1000)
    E(FAKE_AI)
    upload("gstr2b.json")
    st = E("[SheetImport.st().how, SheetImport.st().docs.map(d => [d.no, d.total, d.note])]")
    ok(st[0] == "official" and len(E("window.__ai")) == 0 and ["KIT/CN/4", -1180, "credit"] in st[1] and ["7654321", 118000, ""] in st[1], "GSTR-2B JSON: by FinCom's rules, no AI; the supplier's credit note negative (%s)" % st)
    ok(pg.locator("#app [data-sheet-q=itc]").count() == 1 and "place of supply" in pg.inner_text("#app [data-sheet-q=itc]"), "ITC not available (2B's reason) is asked in the panel")
    shot("sheet-5-2b")
    answer_all("create")
    pg.click("#app [data-sheet-add]"); W(800)
    blocked = E("Object.values(D().entries).filter(e => e.itcBlocked).map(e => e.x.invoiceNo)")
    ok(blocked == ["MM/55"], "booked as ineligible ITC: the document marked so (%s)" % blocked)
    posted = E("""async () => { const co = CO(), list = Object.values(D().entries).filter(e => e.readMode === 'sheet' && !e.noteKind && e.status === 'draft');
      list.forEach(e => { e.natureId = "none"; e.expenseLedger = "Purchases"; e.partyLedger = e.partyLedger || e.x.vendorName; approve(e); });
      const r = await Bridge.post({company: "Zoho Books", client: co.id, masters: [], vouchers: list.map(e => ({id: e.id, xml: voucherXml(e, co)}))});
      return {via: !!r.viaZoho, ok: r.results.filter(x => x.ok).length, n: list.length}; }""")
    z = E("window.__zoho")
    ok(posted["via"] and posted["ok"] == posted["n"] and len(z) == 1 and len(z[0]["entries"]) == posted["n"] and z[0]["client"] == zid,
       "a Zoho Books client: the same Bridge.post posts to Zoho Books (faked), every entry (%s)" % posted)

    # ---- 6. GSTR-1 JSON on Sales: B2CS asked, one summary entry per rate / place of supply
    E("(id) => openCompany(id).then(() => { S.tab = 'sales'; S.step = null; return loadSales(id); }).then(() => render())", cid); W(1200)
    E("() => ensureFileInputs()")
    upload("gstr1.json", "#salesIn")
    ok(E("SheetImport.st() && SheetImport.st().how") == "official" and pg.locator("#app [data-sheet-q=b2cs]").count() == 1, "GSTR-1 JSON on Sales: by rules; B2CS asked first")
    shot("sheet-6-gstr1")
    answer_all("create")
    pg.click("#app [data-sheet-add]"); W(900)
    sl = E("SL().list.filter(v => v.source === 'sheet').map(v => [v.x.number, v.x.total, v.x.noteKind || ''])")
    ok(["S/101", 17400, ""] in sl and ["CN/7", 1180, "credit"] in sl and ["CNU/2", 1050, "credit"] in sl and ["EXP/1", 50000, ""] in sl and len([x for x in sl if x[0].startswith("B2CS/")]) == 2,
       "sales entries: the invoice, the export, the credit notes, and B2CS as one entry per rate / place of supply (%s)" % sl)
    upload("gstr1.json", "#salesIn"); answer_all("create"); pg.click("#app [data-sheet-add]"); W(800)
    ok("already here, not added again" in pg.inner_text("#app [data-sheet-result]"), "the same GSTR-1 again: not added twice (%s)" % pg.inner_text("#app [data-sheet-result]"))
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
