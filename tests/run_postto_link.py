"""python3 run_postto_link.py - the Tally company a client posts to, from its Tally link (staging, 26-Oct-2026).
ITSEasy Solutions Pvt Ltd was linked to its Tally company (tally_companies), but had no confirmed postTo: posting its bank
statement said "Not sent to Tally: choose the Tally company" and the button only opened the Tally page, where the
confirmation was hidden in the row's ⋯ (Post entries here) and linking again did not confirm it. Owner decision of
26-Oct-2026: linking a client to its Tally company also allows posting to that same company.
  1. already linked, no postTo (no GSTIN): opening the client confirms the linked company ("confirmed from the Tally link",
     by the signed-in person), saved and sent to the cloud;
  2. on posting (the fill not made yet): filled first, and the posting goes to the queue for that company;
  3. it stays: after a reload, and in a second browser holding an older copy of the client (the cloud's copy taken in,
     a later save there keeps it);
  4. a different confirmed company is kept (on opening, and on linking another company);
  5. Link (the app's link path) confirms the linked company, by the person who linked;
  6. two companies linked: nothing picked by itself; the gate asks "Post to which Tally company?" with one button each,
     one click confirms;
  7. posting stopped by a person, one company linked: the gate says "Allow posting to X?" with one button (Post to Tally
     and the bank statement's report); one click confirms and clears the stop.
A stand-in for the firm account inside the page. Made-up records only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_postto_link.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8417
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
ITS = "ITSEasy Solutions Pvt Ltd"
ME = "owner@firm.test"
# the client (no GSTIN, as on staging), linked in the cloud to `cos`; the firm account's clients table held in the page
# (window.__srv), the client's copy here in step with it (its sync mark and base)
SETUP = """async ([cid, cos, srv, email]) => {
  const F = 'f0000000-0000-0000-0000-00000000000f', now = new Date().toISOString();
  Cloud.st.firm = F; Cloud.st.email = email; Cloud.st.members = []; Cloud.on = () => true; TCloud.on = () => true;
  if (typeof LocalOwner === 'object') LocalOwner.mayPush = () => true;
  document.body.classList.add('is-test'); S.firm.firmName = S.firm.firmName || 'Test Firm';
  S.account = Object.assign({}, S.account || {}, {me: Object.assign({}, (S.account || {}).me || {}, {role: 'owner'})});
  let c;
  if (srv){ c = fixCompany(JSON.parse(JSON.stringify(srv))); }
  else { c = newCompany({name: 'ITSEasy Solutions Pvt Ltd', gstin: ''}); c.id = cid; c.tallyName = cos[0] || ''; }
  S.companies[cid] = c; S.data[cid] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c);
  const snap = cloudSnapshot().find(r => r.kind === 'client' && r.id === cid);
  window.__srv = srv ? JSON.parse(JSON.stringify(srv)) : JSON.parse(JSON.stringify(snap.data)); window.__sent = []; window.__rpc = [];
  const m = Cloud.marks(); m['client|' + cid + '|' + cid] = fpHash(JSON.stringify(snap.data)); Cloud.setMarks(m); await ClientBase.set(cid, window.__srv);
  window.__cos = cos.map(n => ({company: n, client_id: cid, gstin: null, device_id: 'd-1', last_seen: now, linked_at: now, linked_by: 'u-1'}));
  TCloud.pane = {devices: [{id: 'd-1', name: 'NWS144', main_bridge: 'go-1', revoked: false, info: {computer: 'NWS144', user: 'anshul', beat: {at: now, every: 30, tally: true, tallyState: 'open', open: cos.slice(), computer: 'NWS144'}, bridges: {'go-1': {computer: 'NWS144', user: 'anshul', version: '2.4.1', mode: 'main', at: now, tallyState: 'open', open: cos.slice()}}}}],
    companies: window.__cos, busy: '', err: '', at: Date.now()};
  TLight.st.cos = window.__cos; TLight.st.at = Date.now();
  TCloud.st[cid] = {at: Date.now(), books: cos.length ? [{from: '2025-04-01', book: 'bk1', company: cos[0]}] : []};
  TCloud.restAll = async (u) => /tally_companies/.test(u) ? JSON.parse(JSON.stringify(window.__cos)) : [];
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === 'tally_company_link') window.__cos.forEach(r => { if (r.company === a.p_company) r.client_id = a.p_client || null; });
    if (fn === 'tally_company_link' && a.p_client && !window.__cos.some(r => r.company === a.p_company)) window.__cos.push({company: a.p_company, client_id: a.p_client, device_id: 'd-1', last_seen: new Date().toISOString()});
    if (fn === 'tally_post_enqueue'){ window.__srvAtEnqueue = ((window.__srv.choices || {}).postTo || {}).state + '|' + (window.__srv.postTo || ''); return {ok: true}; }
    if (fn === 'tally_status') return TCloud.st[a.p_client] ? TCloud.st[a.p_client].books : [];
    return fn === 'tally_company_link' ? {ok: true} : null; };
  window.__job = {status: 'done', done: 1, n: 1, message: '1 of 1 in Tally', checking: false, company: cos[0] || '', results: null};
  Cloud.api = async (path, opts) => { const me = (opts || {}).method || 'GET';
    if (me !== 'GET') { const body = JSON.parse(JSON.stringify(opts.body || null)); window.__sent.push({path, body});
      if (path.startsWith('clients?')) { window.__srv = body.data; return [{data: body.data}]; } return null; }
    if (path.startsWith('clients?firm_id')) return [{data: JSON.parse(JSON.stringify(window.__srv)), updated_at: 'x', deleted: false}];
    if (/^tally_companies/.test(path)) return JSON.parse(JSON.stringify(window.__cos.filter(r => !/client_id=eq\\./.test(path) || path.includes(encodeURIComponent(r.client_id || '-')))));
    if (/tally_post_jobs/.test(path)) return [Object.assign({id: 'x'}, window.__job)];
    return []; };
  return cid;
}"""
# bills ready to post, the ledgers read from Tally (as run_post_page.py)
BILLS = """async () => {
  const c = CO(), now = new Date().toISOString();
  choiceConfirm(c, 'tds:professional', 'TDS Payable - Professional');
  const mk = (n, no, amt) => { const e = newEntry('Manual entry'); Object.assign(e.x, {vendorName: n, vendorGstin: '', invoiceNo: no, invoiceDate: '2026-07-01', taxable: amt, total: amt});
    e.natureId = 'professional'; e.partyLedger = n; e.expenseLedger = 'Professional Charges'; S.data[c.id].entries[e.id] = e; approve(e); return e; };
  mk('Alpha Consultants', 'A/1', 100000);
  refreshStats(c.id); goStep('post', 'bills');
  await new Promise(r => setTimeout(r, 700));
  S.bank.loading = false;
  S.bank.ledgers = Object.assign({}, S.bank.ledgers, {importedAt: now, live: true, list: ['Alpha Consultants', 'Professional Charges', 'TDS Payable - Professional'].map(n => ({name: n, group: ''}))});
  window.ensureTallyCompany = async () => c.postTo || ''; window.syncLedgersFromTally = async () => true; window.tallyCall = async () => ({vouchers: []});
  render();
}"""
PT = "(cid) => { const c = S.companies[cid], ch = choiceGet(c, 'postTo') || {}; return {value: ch.value || '', state: ch.state || '', by: ch.by || '', why: ch.why || '', postTo: c.postTo || ''}; }"
SRV_PT = "() => { const c = (window.__srv.choices || {}).postTo || {}; return {value: c.value || '', state: c.state || '', postTo: window.__srv.postTo || ''}; }"

with sync_playwright() as p:
    br = p.chromium.launch()
    def fresh(ctx=None):
        pg = ctx.new_page() if ctx else br.new_page(viewport={"width": 1440, "height": 900})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        return pg
    prob = lambda pg: pg.inner_text("#app [data-post-problem]").replace("\n", " ").strip() if pg.locator("#app [data-post-problem]").count() else ""

    print("== 1. already linked, no postTo: opening the client confirms the linked company")
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = fresh(ctx); cid = "cmvm820mjwyy4b"
    pg.evaluate(SETUP, [cid, [ITS], None, ME]); pg.wait_for_timeout(300)
    ok(pg.evaluate(PT, cid)["state"] != "confirmed", "before: not confirmed (%s)" % pg.evaluate(PT, cid))
    pg.evaluate("(cid) => { openCompany(cid); }", cid); pg.wait_for_timeout(1500)
    pt = pg.evaluate(PT, cid)
    ok(pt["value"] == ITS and pt["state"] == "confirmed" and pt["postTo"] == ITS, "opening the client: %s confirmed (%s)" % (ITS, pt))
    ok(pt["by"] == ME and pt["why"] == "confirmed from the Tally link", "by the signed-in person, 'confirmed from the Tally link' (%s / %s)" % (pt["by"], pt["why"]))
    ok(not pg.evaluate("(cid) => postToProblem(S.companies[cid], %r)" % ITS, cid), "posting into it is allowed")
    pg.evaluate("cloudPush()"); pg.wait_for_timeout(800)
    sp = pg.evaluate(SRV_PT)
    ok(sp == {"value": ITS, "state": "confirmed", "postTo": ITS}, "saved and sent to the cloud (%s)" % sp)
    srv_copy = pg.evaluate("() => window.__srv")

    print("== 3. it stays: a reload, and a second browser")
    pg.reload(); pg.wait_for_timeout(2500)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pt = pg.evaluate("(cid) => S.companies[cid] ? (" + PT + ")(cid) : null", cid)
    ok(pt and pt["value"] == ITS and pt["state"] == "confirmed", "after a reload: still confirmed (%s)" % pt)
    pg.close(); ctx.close()
    ctx2 = br.new_context(viewport={"width": 1440, "height": 900}); q = fresh(ctx2)
    old = dict(srv_copy); old.pop("choices", None); old["postTo"] = ""; old.pop("postToBy", None); old.pop("postToAt", None)
    # the second browser holds the copy from before (in step with the server as it was), FinCom's own fill stopped there
    q.evaluate(SETUP, [cid, [ITS], old, "staff@firm.test"]); q.wait_for_timeout(300)
    q.evaluate("(row) => cloudApply([{kind: 'client', id: row.id, client_id: row.id, data: row, updated_at: new Date().toISOString()}])", srv_copy); q.wait_for_timeout(800)
    pt = q.evaluate(PT, cid)
    ok(pt["value"] == ITS and pt["state"] == "confirmed" and pt["by"] == ME, "a second browser: the cloud's copy brings it, as confirmed by %s (%s)" % (ME, pt))
    q.evaluate("(srv) => { window.__srv = srv; }", srv_copy)
    q.evaluate("(cid) => { S.companies[cid].roundOff = 'x9'; Store.saveCompany(S.companies[cid]); }", cid)
    q.evaluate("cloudPush()"); q.wait_for_timeout(800)
    sp = q.evaluate(SRV_PT)
    ok(sp["state"] == "confirmed" and sp["value"] == ITS and q.evaluate("() => window.__srv.roundOff") == "x9", "a later save there keeps it (%s)" % sp)
    q.close(); ctx2.close()

    print("== 2. on posting: filled first, then posted")
    pg = fresh(); cid = "zzpost1"
    pg.evaluate(SETUP, [cid, [ITS], None, ME]); pg.wait_for_timeout(300)
    pg.evaluate("(cid) => { openCompany(cid); }", cid); pg.wait_for_timeout(1200)
    pg.evaluate(BILLS); pg.wait_for_timeout(600)
    # the fill not made yet (as for a client opened before this change): forgotten here, then Post pressed at once
    pg.evaluate("(cid) => { const c = S.companies[cid]; delete c.choices.postTo; c.postTo = ''; window.__rpc = []; postAllToTally(); }", cid); pg.wait_for_timeout(800)
    if pg.locator('#confirmBox [data-cbx="yes"]').is_visible(): pg.click('#confirmBox [data-cbx="yes"]')
    pg.wait_for_timeout(2500)
    pt = pg.evaluate(PT, cid)
    ok(pt["state"] == "confirmed" and pt["value"] == ITS and pt["why"] == "confirmed from the Tally link", "Post pressed: the linked company confirmed first (%s)" % pt)
    enq = [r for r in pg.evaluate("window.__rpc") if r[0] == "tally_post_enqueue"]
    ok(len(enq) == 1 and enq[0][1].get("p_client") == cid and len(enq[0][1]["p_payload"]["vouchers"]) == 1, "and the bill went to the cloud's queue for this client (%s)" % str(enq)[:160])
    ok(pg.evaluate("window.__srvAtEnqueue") == "confirmed|" + ITS, "the cloud had the confirmed company before the posting was queued (%s)" % pg.evaluate("window.__srvAtEnqueue"))
    ok("choose the Tally company" not in pg.inner_text("#app").lower(), "no 'choose the Tally company' on the page")
    pg.close()

    print("== 4. a different confirmed company is kept")
    pg = fresh(); cid = "zzkeep1"
    pg.evaluate(SETUP, [cid, [ITS], None, ME]); pg.wait_for_timeout(300)
    pg.evaluate("(cid) => choiceConfirm(S.companies[cid], 'postTo', 'OLD BOOKS CO', {by: 'ravi@firm.test'})", cid)
    pg.evaluate("(cid) => { openCompany(cid); }", cid); pg.wait_for_timeout(1500)
    pt = pg.evaluate(PT, cid)
    ok(pt["value"] == "OLD BOOKS CO" and pt["by"] == "ravi@firm.test", "opening: the confirmed OLD BOOKS CO stays (%s)" % pt)
    pg.evaluate("(cid) => tallyLinkClient('ANOTHER CO', cid, {keep: true})", cid); pg.wait_for_timeout(800)
    pt = pg.evaluate(PT, cid)
    ok(pt["value"] == "OLD BOOKS CO" and pt["by"] == "ravi@firm.test", "linking another company: it stays (%s)" % pt)
    pg.close()

    print("== 5. Link confirms the linked company")
    pg = fresh(); cid = "zzlink1"
    pg.evaluate(SETUP, [cid, [], None, ME]); pg.wait_for_timeout(300)
    pg.evaluate("() => { window.__cos.push({company: 'NEW BOOKS PVT LTD', client_id: null, device_id: 'd-1', last_seen: new Date().toISOString()}); }")
    ok(pg.evaluate(PT, cid)["state"] != "confirmed", "not linked: nothing confirmed")
    pg.evaluate("(cid) => tallyLinkClient('NEW BOOKS PVT LTD', cid)", cid); pg.wait_for_timeout(800)
    pt = pg.evaluate(PT, cid)
    ok(pt["value"] == "NEW BOOKS PVT LTD" and pt["state"] == "confirmed" and pt["by"] == ME, "linked: posting allowed into NEW BOOKS PVT LTD, by %s (%s)" % (ME, pt))
    pg.close()

    print("== 6. two companies linked: asked, one click")
    pg = fresh(); cid = "zztwo1"
    pg.evaluate(SETUP, [cid, [ITS, "ITSEasy Solutions Pvt Ltd 2025-26"], None, ME]); pg.wait_for_timeout(300)
    pg.evaluate("(cid) => { openCompany(cid); }", cid); pg.wait_for_timeout(1500)
    ok(pg.evaluate(PT, cid)["state"] != "confirmed", "nothing picked by itself (%s)" % pg.evaluate(PT, cid))
    pg.evaluate(BILLS); pg.wait_for_timeout(800)
    btns = pg.evaluate("() => [...document.querySelectorAll('#app [data-post-problem] button')].map(b => b.innerText.trim())")
    ok(prob(pg).startswith("Post to which Tally company?") and len(btns) == 2 and all(ITS in b for b in btns), "the gate asks, one button each (%s / %s)" % (prob(pg), btns))
    pg.evaluate("() => document.querySelectorAll('#app [data-post-problem] button')[1].click()"); pg.wait_for_timeout(600)
    pt = pg.evaluate(PT, cid)
    ok(pt["value"] == "ITSEasy Solutions Pvt Ltd 2025-26" and pt["state"] == "confirmed", "one click confirms the one pressed (%s)" % pt)
    ok(not prob(pg).startswith("Post to which"), "and the question goes (%s)" % prob(pg))
    pg.close()

    print("== 7. posting stopped by a person, one company linked: 'Allow posting to X?'")
    pg = fresh(); cid = "zzstop1"
    pg.evaluate(SETUP, [cid, [ITS], None, ME]); pg.wait_for_timeout(300)
    pg.evaluate("(cid) => choiceConfirm(S.companies[cid], 'postTo', '', {by: 'ravi@firm.test'})", cid)
    pg.evaluate("(cid) => { openCompany(cid); }", cid); pg.wait_for_timeout(1200)
    ok(pg.evaluate(PT, cid)["value"] == "", "a person's stop is not undone by itself")
    pg.evaluate(BILLS); pg.wait_for_timeout(800)
    btns = pg.evaluate("() => [...document.querySelectorAll('#app [data-post-problem] button')].map(b => b.innerText.trim())")
    ok(("Allow posting to %s?" % ITS) in prob(pg) and len(btns) == 1, "Post to Tally: 'Allow posting to %s?' with one button (%s / %s)" % (ITS, prob(pg), btns))
    pg.evaluate("() => document.querySelector('#app [data-post-problem] button').click()"); pg.wait_for_timeout(600)
    pt = pg.evaluate(PT, cid)
    ok(pt["value"] == ITS and pt["state"] == "confirmed" and pt["by"] == ME, "one click confirms it (%s)" % pt)
    # the bank statement's report of a posting the cloud refused (what the owner saw)
    pg.evaluate("(cid) => choiceConfirm(S.companies[cid], 'postTo', '', {by: 'ravi@firm.test'})", cid)
    pg.evaluate("""(cid) => { S.postStop = {cid, msg: "Choose the Tally company ITSEasy Solutions Pvt Ltd may post to (Client setup → Tally). Nothing was posted."};
      S.tab = 'bank'; S.view = 'company'; S.bank = Object.assign(S.bank || {}, {cid, loading: false}); S.bank.postReport = {at: Date.now(), posted: 0, failed: [], notAllowed: "Choose the Tally company ITSEasy Solutions Pvt Ltd may post to (Client setup → Tally). Nothing was posted.", dismiss: 'bankReportOk'}; render(); }""", cid)
    pg.wait_for_timeout(900)
    na = pg.locator("#app [data-not-allowed]")
    words = na.inner_text().replace("\n", " ") if na.count() else ""
    nb = pg.evaluate("() => { const n = document.querySelector('#app [data-not-allowed]'); return n ? [...n.querySelectorAll('button')].map(b => b.innerText.trim()) : []; }")
    ok(("Allow posting to %s?" % ITS) in words and len([b for b in nb if b != "Dismiss"]) == 1, "the bank's report: 'Allow posting to %s?' with one button (%s / %s)" % (ITS, words[:160], nb))
    if na.count():
        pg.evaluate("() => document.querySelector('#app [data-not-allowed] button').click()"); pg.wait_for_timeout(600)
    pt = pg.evaluate(PT, cid)
    ok(pt["value"] == ITS and pt["state"] == "confirmed", "one click confirms it (%s)" % pt)
    ok(pg.locator("#app [data-not-allowed]").count() == 0 and not pg.evaluate("!!S.postStop"), "and the refusal goes")
    pg.close()
    br.close()
errors = [e for e in errors if "ResizeObserver" not in e]
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
