"""python3 run_post_page.py - review of 02-Oct-2026, C15-C18, B11, B14: the Post to Tally page and where postings go.
  - one line: "Posting into GARG SHEKHAR & COMPANY · Tally open on NWS144 · Update now" (the bridge's version and "Ready"
    under More, second pass of 02-Oct-2026), and a second line only for the action to take ("Tally not open on NWS144",
    "Choose the Tally company", "Install FinCom Bridge");
  - one table of the bills ready to post (date, party, bill no., amount, the ledgers on one line, Preview / Back to review);
  - one main button "Post N to Tally"; the rest under More; the finished postings below;
  - a posting stopped by the company check (the cloud's notAllowed): "Not sent to Tally: choose the Tally company" with a
    button to Client setup → Tally, never "Tally's reason"; the bills stay waiting;
  - one count of what is for Tally: the header chip, the tab badge, the page and the dashboard tile agree (item 8);
  - the import steps stack one under the other, also at 375 px (item 9);
  - the company is set by itself (postToBy auto) when exactly one Tally company is linked and its GSTIN is the client's;
  - every posting goes through FinCom's cloud queue when the client is linked there, also with the bridge on this
    computer; straight to the bridge otherwise, and then recorded (tally_post_record; an older cloud without it: no error).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_page.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8232), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
GARG = "GARG SHEKHAR & COMPANY"
SETUP = """async () => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "GARG SHEKHAR & COMPANY";
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  // review 21c (02-Oct-2026): posting uses confirmed choices only; this client's TDS ledger for professional fees is confirmed
  choiceConfirm(c, "tds:professional", "TDS Payable - Professional");
  const now = new Date().toISOString();
  window.__rpc = []; window.__saved = []; window.__enqueue = {ok: true};
  const save0 = Store.saveCompany.bind(Store); Store.saveCompany = (co) => { window.__saved.push(JSON.parse(JSON.stringify({id: co.id, postTo: co.postTo, postToBy: co.postToBy}))); return save0(co); };
  Cloud.on = () => true; Cloud.st.firm = {id: "f-1"}; Cloud.st.members = [];
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: "GARG SHEKHAR & COMPANY"}]};
  TCloud.pane = {devices: [{id: "d-1", name: "NWS144", main_bridge: "go-1", revoked: false, info: {computer: "NWS144", bridges: {"go-1": {computer: "NWS144", user: "anshul", version: "2.1.1", mode: "main", at: now, tallyState: "open", open: ["GARG SHEKHAR & COMPANY"]}}}}],
    companies: [{company: "GARG SHEKHAR & COMPANY", client_id: c.id, gstin: "09AANFG3202D1ZR"}], busy: "", err: "", at: Date.now()};
  TCloud.restAll = async (u) => /tally_post_jobs/.test(u) ? [] : [];
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a))]);
    if (fn === "tally_post_enqueue") return window.__enqueue;
    if (fn === "tally_post_record"){ if (window.__noRecord) throw {message: "Could not find the function public.tally_post_record(p_client, ...) in the schema cache"}; return {ok: true, id: a.p_id}; }
    if (fn === "tally_status") return TCloud.st[a.p_client] ? TCloud.st[a.p_client].books : [];
    return null; };
  window.__job = {status: "done", done: 1, n: 1, message: "1 of 1 in Tally", checking: false, company: "GARG SHEKHAR & COMPANY", results: null};
  Cloud.api = async (path) => { if (/tally_post_jobs/.test(path)) return [Object.assign({id: "x"}, window.__job)]; if (/tally_companies/.test(path)) return TCloud.pane.companies; return []; };
  await openCompany(c.id);
  const mk = (n, no, amt) => { const e = newEntry("Manual entry"); Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; approve(e); return e; };
  mk("Alpha Consultants", "A/1", 100000); mk("Kashi IT Solutions", "K/7", 20000);
  refreshStats(c.id); goStep("post", "bills");
  await new Promise(r => setTimeout(r, 700));
  S.bank.loading = false;
  S.bank.ledgers = Object.assign({}, S.bank.ledgers, {importedAt: now, live: true, list: ["Alpha Consultants", "Kashi IT Solutions", "Professional Charges", "TDS Payable - Professional"].map(n => ({name: n, group: ""}))});
  window.ensureTallyCompany = async () => "GARG SHEKHAR & COMPANY"; window.syncLedgersFromTally = async () => true; window.tallyCall = async () => ({vouchers: []});
  render();
  return c.id;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8232/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = pg.evaluate(SETUP); pg.wait_for_timeout(1200)
    E = lambda js, *a: pg.evaluate(js, *a)
    line = lambda: pg.inner_text("#app [data-post-line]").replace("\n", " ").strip() if pg.locator("#app [data-post-line]").count() else ""
    # second pass of 02-Oct-2026: what to do is a second line, only when something is wrong
    prob = lambda: pg.inner_text("#app [data-post-problem]").replace("\n", " ").strip() if pg.locator("#app [data-post-problem]").count() else ""
    # B14: the company set by itself on opening the client (one Tally company linked, same GSTIN)
    co = E("(() => { const c = CO(); return {postTo: c.postTo, by: c.postToBy, at: !!c.postToAt}; })()")
    ok(co == {"postTo": GARG, "by": "auto", "at": True} and any(x.get("postTo") == GARG for x in E("window.__saved")),
       "B14. opening the client: postTo set to GARG SHEKHAR & COMPANY by itself (auto) and saved (%s)" % co)
    # review 20-21 (02-Oct-2026): the company found by itself is a guess: posting waits until a person confirms it
    ok(E("choiceState(CO(), 'postTo')") == "guessed" and "confirm the Tally company" in prob() and prob().endswith("Confirm the Tally company"), "review 20. the company found by itself is a guess to confirm: '%s'" % prob())
    ok(E("postToProblem(CO(), 'GARG SHEKHAR & COMPANY')").startswith("Confirm the Tally company"), "review 21c. and posting is refused until it is confirmed")
    # #11 (the owner's rule of 05-Oct-2026): any member who may write confirms the posting company (who and when kept);
    # round 39: the tick on the client's Link to Tally card, "Post this client's entries into X"
    E("() => { window.__acct = S.account; S.account = Object.assign({}, S.account || {}, {me: Object.assign({}, (S.account || {}).me || {}, {role: 'staff'})}); S.postStop = null; S.step = null; S.tab = 'cotally'; render(); }"); pg.wait_for_timeout(500)
    pt = pg.inner_text("#app [data-tally-link-post]") if pg.locator("#app [data-tally-link-post]").count() else ""
    ok(pg.locator('#app [data-tally-link-post-tick]:not([disabled])').count() == 1 and not pg.is_checked('#app [data-tally-link-post-tick]') and "Found by FinCom" in pt and "An owner of the firm" not in pt,
       "#11. staff: the found company is not ticked, and can be ticked (no 'An owner of the firm chooses it') (%s)" % pt.replace("\n", " ")[:160])
    pg.click('#app [data-tally-link-post-tick]'); pg.wait_for_timeout(300); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(400)
    pc = E("(() => { const r = choiceGet(CO(), 'postTo'); return {state: r && r.state, by: !!(r && r.by), at: !!(r && r.at)}; })()")
    ok(pc == {"state": "confirmed", "by": True, "at": True}, "#11. staff's Confirm: confirmed, with who and when kept (%s)" % pc)
    E("() => { S.account = window.__acct; goStep('post', 'bills'); }"); pg.wait_for_timeout(500)
    E("() => { choiceConfirm(CO(), 'postTo', 'GARG SHEKHAR & COMPANY'); render(); }"); pg.wait_for_timeout(300)
    # C15: one line
    ok(pg.locator("#app [data-post-line]").count() == 1 and line() == "Posting into GARG SHEKHAR & COMPANY · Connected · Tally open on NWS144 · Update now" and prob() == "", "C15. one line, nothing else: '%s'" % line())
    E("document.querySelector(\"#app details[data-more='post']\").open = true")
    ok(pg.inner_text("#app [data-post-bridge]") == "FinCom Bridge 2.1.1 · Ready", "C15. the bridge's version and Ready under More")
    E("document.querySelector(\"#app details[data-more='post']\").open = false")
    # C16: one table
    ok(pg.locator("#app table[data-post-table]").count() == 1 and pg.locator("#app [data-post-row]").count() == 2, "C16. one table of the entries")
    hd = E("Array.from(document.querySelectorAll('#app [data-post-table] thead th')).map(t => t.textContent)")
    ok(hd[:5] == ["Date", "Party", "Bill no.", "Amount", "Ledgers"], "C16. columns: %s" % hd)
    r1 = pg.inner_text("#app [data-post-row]:first-child").replace("\n", " ")
    ok("01-Jul-2026" in r1 and "Alpha Consultants" in r1 and "A/1" in r1 and "Alpha Consultants · Professional Charges · TDS Payable - Professional" in r1,
       "C16. a row: date, party, bill no., amount, the ledgers on one line (%s)" % r1[:160])
    ok(all(pg.locator("#app [data-post-row]:first-child button:has-text('%s')" % t).count() == 1 for t in ("Preview", "Back to review")), "C16. Preview and Back to review on each (one Post button for the section)")
    # C17: one main button, the rest under More
    prim = E("Array.from(document.querySelectorAll('#app [data-post-page] .btn.primary')).filter(b => !b.closest('details') && b.offsetParent).map(b => b.textContent)")
    ok(prim == ["Post 2 to Tally"], "C17. one main button: %s" % prim)
    more = pg.locator("#app details[data-more='post']")
    ok(more.count() == 1, "C17. a More menu")
    E("document.querySelector(\"#app details[data-more='post']\").open = true"); pg.wait_for_timeout(200)
    mt = pg.inner_text("#app details[data-more='post'] .bk-menu-list")
    ok(all(x in mt for x in ("Download Tally file", "Download TDS register", "Clear sent invoices", "How to import the file into Tally")), "C17. More has the downloads, clear sent, import steps (%s)" % mt.replace("\n", " / ")[:160])
    ok(E("Array.from(document.querySelectorAll('#app [data-post-page] button')).filter(b => /Download Tally file|TDS register|Clear sent/.test(b.textContent) && !b.closest('details')).length") == 0, "C17. none of them outside More")
    E("document.querySelector(\"#app details[data-more='post']\").open = false")
    # C18: the finished postings below (QueueJobs)
    ok(E("(() => { const t = document.querySelector('#app [data-post-table]'), j = document.querySelector('#app [data-post-jobs]'); return !j || !!(t.compareDocumentPosition(j) & 4); })()"), "C18. the postings in FinCom's cloud come below the table")
    # C15: the action to take
    E("() => { TCloud.pane.devices[0].info.bridges['go-1'].tallyState = 'closed'; render(); }"); pg.wait_for_timeout(300)
    ok(line() == "Posting into GARG SHEKHAR & COMPANY" and prob() == "Tally not open on NWS144.", "C15. Tally closed there: '%s' / '%s'" % (line(), prob()))
    E("() => { TCloud.pane.devices[0].info.bridges['go-1'].tallyState = 'open'; render(); }")
    E("() => { const c = CO(); window.__keep = c.postTo; c.postTo = ''; AutoPostTo.at[c.id] = Date.now(); render(); }"); pg.wait_for_timeout(300)
    ok(prob().endswith("Choose the Tally company") and pg.locator("#app [data-post-problem] [data-post-action]").evaluate("b => b.tagName") == "BUTTON", "C15. no company chosen: 'Choose the Tally company' (%s)" % prob())
    E("() => { const c = CO(); c.postTo = window.__keep; TCloud.pane.devices = []; TCloud.on = () => false; render(); }"); pg.wait_for_timeout(300)
    ok(prob().startswith("Install FinCom Bridge"), "C15. no bridge anywhere: 'Install FinCom Bridge' (%s)" % prob())
    E("() => { TCloud.on = () => TCloud.__on !== false; TCloud.pane.devices = [{id: 'd-1', name: 'NWS144', main_bridge: 'go-1', revoked: false, info: {computer: 'NWS144', bridges: {'go-1': {computer: 'NWS144', version: '2.1.1', mode: 'main', at: new Date().toISOString(), tallyState: 'open'}}}}]; render(); }")
    pg.wait_for_timeout(300)
    # B14: the cloud's notAllowed: not Tally's reason, a button to Client setup → Tally, the bills stay waiting
    E("""() => { window.__enqueue = {ok: false, notAllowed: true, company: "GARG SHEKHAR & COMPANY", error: "Choose the Tally company Testing AAD may post to (Client setup → Tally). Its books in FinCom's cloud come from GARG SHEKHAR & COMPANY."}; }""")
    pg.click("#app [data-post-main]"); pg.wait_for_timeout(600)
    ok(pg.locator("#confirmBox [data-post-preview]").count() == 1, "the main button shows the preview first")
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(2500)
    na = pg.inner_text("#app [data-not-allowed]") if pg.locator("#app [data-not-allowed]").count() else ""
    app = pg.inner_text("#app")
    ok("Not sent to Tally: choose the Tally company." in na and "reason" not in app.lower().replace("’", "'").split("not sent to tally")[1][:400], "B14. 'Not sent to Tally: choose the Tally company', not Tally's reason (%s)" % na.replace("\n", " ")[:140])
    st = E("Object.values(D().entries).map(e => [e.status, !!e.exportedAt, e.postError || '', !!e.postFailedAt])")
    ok(all(x == ["approved", False, "", False] for x in st) and pg.locator("#app [data-post-row]").count() == 2 and pg.inner_text("#app [data-post-main]") == "Post 2 to Tally",
       "B14. the bills stay under Post to Tally, waiting, not failed nor sent (%s)" % st)
    ok(any(r[0] == "tally_post_enqueue" for r in E("window.__rpc")), "B11. the posting went to the cloud queue (the client is linked there)")
    pg.click("#app [data-not-allowed] [data-choose-company]"); pg.wait_for_timeout(500)
    ok(E("S.tab") == "cotally" and pg.locator("#app [data-tally-link-post]").count() == 1, "B14. the button opens Client setup → Tally (the Link to Tally card and its posting tick)")
    E("() => { goStep('post', 'bills'); }"); pg.wait_for_timeout(500)
    # B11: with the bridge on this computer too, the posting goes through the queue (not to /jobs)
    E("""() => { window.__rpc = []; window.__enqueue = {ok: true}; S.postStop = null; window.__direct = 0;
      Bridge.on = () => true; Bridge.up = () => true; Bridge.st = Object.assign({}, Bridge.st, {state: "ok", version: "2.1.1", tallyUp: true, open: [{name: "GARG SHEKHAR & COMPANY", port: 9000, gstin: "09AANFG3202D1ZR"}]});
      Bridge.postChecked = async (p) => { window.__direct++; return {ok: true, company: p.company, job: {id: "1b9f0156-0000-4000-8000-000000000001"}, results: p.vouchers.map(v => ({id: v.id, ok: true, verified: true}))}; };
      const e = Object.values(D().entries)[0]; window.__job.results = [{id: e.id, ok: true, verified: true}];
      window.__r1 = null; Bridge.post({company: "GARG SHEKHAR & COMPANY", client: S.coId, masters: [], vouchers: [{id: e.id, xml: voucherXml(e, CO())}]}).then(r => window.__r1 = r); }""")
    pg.wait_for_timeout(3000)
    r = E("window.__r1")
    ok(r and r.get("viaCloud") and E("window.__direct") == 0 and any(x[0] == "tally_post_enqueue" for x in E("window.__rpc")), "B11. bridge here and the client linked to the cloud: through the queue, not straight to the bridge")
    # straight to the bridge only without the cloud for this client; then recorded
    E("""() => { window.__rpc = []; TCloud.st[S.coId] = {at: Date.now(), books: []}; const e = Object.values(D().entries)[1];
      window.__r2 = null; Bridge.post({company: "GARG SHEKHAR & COMPANY", client: S.coId, masters: [], vouchers: [{id: e.id, xml: voucherXml(e, CO())}]}).then(r => window.__r2 = r, err => window.__r2 = {err: err.message}); }""")
    pg.wait_for_timeout(1500)
    rec = [x[1] for x in E("window.__rpc") if x[0] == "tally_post_record"]
    eid = E("Object.values(D().entries)[1].id")
    ok(E("window.__direct") == 1 and len(rec) == 1 and rec[0]["p_status"] == "done" and rec[0]["p_entry_ids"] == [eid] and rec[0]["p_id"] == "1b9f0156-0000-4000-8000-000000000001" and "FinCom Bridge 2.1.1" in rec[0]["p_message"],
       "B11. no cloud for the client: straight to the bridge, then recorded in the cloud (tally_post_record, done, %s)" % (rec[0]["p_message"] if rec else "-"))
    ok(not any(x[0] == "tally_post_enqueue" for x in E("window.__rpc")), "B11. and not queued")
    E("""() => { window.__noRecord = true; window.__r3 = null; const e = Object.values(D().entries)[1];
      Bridge.post({company: "GARG SHEKHAR & COMPANY", client: S.coId, masters: [], vouchers: [{id: e.id, xml: voucherXml(e, CO())}]}).then(r => window.__r3 = r, err => window.__r3 = {err: String(err && err.message)}); }""")
    pg.wait_for_timeout(1200)
    r3 = E("window.__r3")
    ok(r3 and not r3.get("err") and r3["results"][0]["ok"] and E("PostRecord.missing") is True, "B11. an older cloud without tally_post_record: the posting still works, nothing breaks")
    # item 8: one count everywhere (a bill sent in a Tally file and not confirmed counts until Tally confirms it)
    E("""() => { const a = Object.values(D().entries).find(x => x.status === "approved"), e = JSON.parse(JSON.stringify(a)); e.id = "tfile1"; e.x.invoiceNo = "T/1"; e.x.vendorName = "Tally File Co";
      S.data[S.coId].entries[e.id] = e; e.exportedAt = new Date().toISOString();
      refreshStats(S.coId); goStep("post", "bills"); }""")
    pg.wait_for_timeout(600)
    num = lambda t: int(([x for x in __import__("re").findall(r"\d+", t or "")] or ["-1"])[0])
    chip = E("(() => { const t = tallyStatus(CO()); return t.state + '|' + t.short; })()")
    tab = E("(() => { const b = Array.from(document.querySelectorAll('nav.sbar button')).find(x => /Post to Tally/.test(x.textContent)); return b ? b.textContent : ''; })()")
    # three tabs (plan item 1b): with the Tally file needing attention, Errors opens by itself; the Post button is under To post
    ok(pg.get_attribute('#app [data-post-tab][aria-selected="true"]', "data-post-tab") == "errors", "1b. something needs attention: the Errors tab opens by itself")
    pg.click('#app [data-post-tab="topost"]'); pg.wait_for_timeout(300)
    page = pg.inner_text("#app [data-post-main]") if pg.locator("#app [data-post-main]").count() else ""
    attn = E("(() => { const b = document.querySelector('nav.sbar [data-attn-n]'); return b ? b.textContent : ''; })()")
    tab = E("(() => { const b = document.querySelector('nav.sbar [data-step=post] [data-step-n]'); return b ? b.textContent : ''; })()")
    E("() => { S.tab = 'dash'; render(); }"); pg.wait_for_timeout(600)
    dash = E("(() => { const t = Array.from(document.querySelectorAll('#app .dtile')).find(x => /Post to Tally/.test(x.textContent)); return t ? t.querySelector('b').textContent : ''; })()")
    want = E("postCountFor(S.coId)")
    got = [num(chip.split("|")[1]), num(tab), num(page), num(dash)]
    # second pass of 02-Oct-2026: the count is "Ready to post"; the Tally file not confirmed (T/1) needs attention, a badge apart
    ok(chip.startswith("waiting") and want == 2 and got == [want] * 4,
       "8. one count: header chip, tab badge, Post button and dashboard tile all say %d (%s | %s | %s | %s)" % (want, chip, tab, page, dash))
    ok(attn == "1" and E("postAttentionFor(S.coId)") == 1, "8. the Tally file not confirmed has its own badge on the tab: %r" % attn)
    E("() => { goStep('post', 'bills'); }"); pg.wait_for_timeout(400)
    ok(pg.get_attribute('#app [data-post-tab][aria-selected="true"]', "data-post-tab") == "topost", "1b. the tab chosen (To post) is kept for the client")
    # item 9: the import steps stack, also at phone width
    pg.set_viewport_size({"width": 375, "height": 800}); pg.wait_for_timeout(300)
    E("document.querySelector(\"#app details[data-more='post']\").open = true"); pg.click('#app [data-more="post"] button:has-text("How to import the file into Tally")'); pg.wait_for_timeout(300)
    lay = E("""(() => { const li = Array.from(document.querySelectorAll('#app [data-import-steps] li')).map(x => x.getBoundingClientRect());
      return {n: li.length, stacked: li.every((r, i) => i === 0 || r.top >= li[i - 1].bottom - 1), scroll: document.documentElement.scrollWidth - innerWidth}; })()""")
    ok(lay["n"] == 5 and lay["stacked"] and lay["scroll"] <= 1, "9. the import steps stack one under the other at 375 px, no sideways scroll (%s)" % lay)
    pg.set_viewport_size({"width": 1440, "height": 950})
    # B14: postTo by itself, only when clear
    t = E("""async () => { const mk = (g) => { const c = newCompany({name: "ZZ " + g, gstin: g}); S.companies[c.id] = c; return c; };
      Bridge.up = () => false;
      const one = mk("09AAAAA0000A1Z5"), two = mk("09BBBBB0000B1Z5"), diff = mk("09CCCCC0000C1Z5"), set = mk("09DDDDD0000D1Z5"); set.postTo = "KEEP";
      TCloud.pane.companies = [{company: "ONE CO", client_id: one.id, gstin: "09AAAAA0000A1Z5"}, {company: "TWO A", client_id: two.id, gstin: "09BBBBB0000B1Z5"}, {company: "TWO B", client_id: two.id, gstin: "09BBBBB0000B1Z5"},
        {company: "DIFF CO", client_id: diff.id, gstin: "09ZZZZZ0000Z1Z5"}, {company: "SET CO", client_id: set.id, gstin: "09DDDDD0000D1Z5"}];
      for (const c of [one, two, diff, set]) await autoPostTo(c, true);
      return [one.postTo + "/" + one.postToBy, two.postTo || "", diff.postTo || "", set.postTo]; }""")
    ok(t == ["ONE CO/auto", "", "", "KEEP"], "B14. set only for one linked company with the same GSTIN; never over a company already chosen (%s)" % t)
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
