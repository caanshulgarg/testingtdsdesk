"""python3 run_post_testcopies.py - Test bills on ZZ TEST (round 15, T): on Post to Tally, an owner of a client whose confirmed
postTo company begins with "ZZ TEST" can make N (1..100) test copies of a ready bill: new ids, invoice numbers "<no>-T1".."-TN",
the same amounts, ledgers and date, x.testCopy = true, ready to post. Never on any other client; never for staff.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_testcopies.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8276), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """async (postTo) => {
  const c = newCompany({name: "Test Client " + postTo, gstin: "09AANFG3202D1ZR"}); c.tallyName = postTo;
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "tds:professional", "TDS Payable - Professional"); choiceConfirm(c, "postTo", postTo);
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-1", name: "Anshul"}];
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: postTo, daysAt: new Date().toISOString(), state: {doneTo: "20261001", skipped: []}}]};
  TCloud.restAll = async () => []; TCloud.rpc = async (fn, a) => fn === "tally_status" ? TCloud.st[a.p_client].books : /^tally_(want_update|post_enqueue|post_dismiss|post_undismiss|post_record)$/.test(fn) ? {ok: true} : null; Cloud.api = async () => [];
  CloudJobs.list = []; CloudJobs.at = Date.now(); PostCheck.due = () => false; TallyProof.check = async () => 0; window.autoPostTo = async () => {};
  // the Tally computer's light, as run_post_tabs stubs it (a refresh that resolves at once would redraw without end)
  const now = new Date().toISOString();
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [{id: "d-1", name: "NWS144", revoked: false, last_seen: now, info: {computer: "NWS144", beat: {at: now, every: 30, tally: true, tallyState: "open", open: [postTo], companies: [{name: postTo, open: true, at: now, lastRead: now}]}}}],
    cos: [{company: postTo, client_id: c.id, device_id: "d-1"}]};
  await openCompany(c.id);
  const mk = (id, n, no, amt) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; approve(e); return e; };
  mk("r1", "Alpha Consultants", "A/1", 100000); mk("r2", "Kashi IT Solutions", "K/7", 20000);
  refreshStats(c.id); goStep("post", "bills");
  await new Promise(r => setTimeout(r, 400));
  S.bank.loading = false; S.account = {me: {role: "owner"}, firm: {name: "Firm"}}; render();
  return c.id;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8276/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    def tab(name):
        pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(300)
    cid = E(SETUP, "ZZ TEST"); pg.wait_for_timeout(1000); tab("topost")
    TC = "#app [data-test-copies]"
    ok(pg.locator(TC).count() == 1 and "Make" in txt(TC + " [data-tc-make]") and "test copies of this bill" in txt(TC + " [data-tc-make]"), "T. an owner on a ZZ TEST client: 'Make N test copies of this bill' on the Post page (%s)" % txt(TC)[:120])
    ok(pg.locator(TC + " select[data-tc-bill] option").count() == 2 and pg.locator(TC + " input[data-tc-n]").count() == 1, "T. choose a ready bill (the two here), and N")
    pg.select_option(TC + " select[data-tc-bill]", "r1"); pg.fill(TC + " input[data-tc-n]", "0"); pg.click(TC + " [data-tc-make]"); pg.wait_for_timeout(400)
    ok(E("Object.keys(D().entries).length") == 2 and "1 to 100" in txt(TC), "T. N = 0: nothing made, '1 to 100' (%s)" % txt(TC)[-80:])
    pg.fill(TC + " input[data-tc-n]", "101"); pg.click(TC + " [data-tc-make]"); pg.wait_for_timeout(400)
    ok(E("Object.keys(D().entries).length") == 2, "T. N = 101: nothing made")
    pg.fill(TC + " input[data-tc-n]", "3"); pg.wait_for_timeout(200)
    ok("Make 3 test copies of this bill" in txt(TC + " [data-tc-make]"), "T. the button names N (%s)" % txt(TC + " [data-tc-make]"))
    pg.click(TC + " [data-tc-make]"); pg.wait_for_timeout(800)
    copies = E("""Object.values(D().entries).filter(e => e.x.testCopy === true).sort((a, b) => a.x.invoiceNo.localeCompare(b.x.invoiceNo)).map(e => ({id: e.id, no: e.x.invoiceNo, total: e.x.total, date: e.x.invoiceDate, party: e.partyLedger, exp: e.expenseLedger, st: e.status, sent: !!e.exportedAt, lines: (e.snapshot && e.snapshot.lines || []).map(l => l.ledger + ":" + l.amt).join("|")}))""")
    src = E("""(() => { const e = D().entries.r1; return {total: e.x.total, date: e.x.invoiceDate, party: e.partyLedger, exp: e.expenseLedger, lines: (e.snapshot && e.snapshot.lines || []).map(l => l.ledger + ":" + l.amt).join("|")}; })()""")
    ok([c["no"] for c in copies] == ["A/1-T1", "A/1-T2", "A/1-T3"] and len(set(c["id"] for c in copies)) == 3 and "r1" not in [c["id"] for c in copies], "T. three new bills A/1-T1..T3 with new ids (%s)" % [c["no"] for c in copies])
    ok(all(c["total"] == src["total"] and c["date"] == src["date"] and c["party"] == src["party"] and c["exp"] == src["exp"] and c["lines"] == src["lines"] and c["st"] == "approved" and not c["sent"] for c in copies),
       "T. the same amounts, ledgers and date; approved and not sent (%s | %s)" % (copies[:1], src))
    ok(E("D().entries.r1.x.testCopy") is None and E("D().entries.r1.x.invoiceNo") == "A/1", "T. the original is untouched")
    ok(txt("#app [data-post-main]") == "Post 5 to Tally" and pg.locator('#app [data-post-table] [data-post-row]').count() == 5 and "test copy" in txt('#app [data-post-table] [data-post-row="%s"]' % copies[0]["id"]),
       "T. the copies are ready to post: 'Post 5 to Tally', each row marked test copy (%s)" % txt("#app [data-post-main]"))
    ok("3 test copies" in txt(TC), "T. the box says what it made (%s)" % txt(TC)[-100:])
    # staff: nothing
    E("() => { S.account = {me: {role: 'staff'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(300)
    ok(pg.locator(TC).count() == 0, "T. a staff member: no box")
    E("() => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(300)
    # postTo confirmed but not ZZ TEST: nothing, and the function refuses too
    cid2 = E(SETUP, "GARG SHEKHAR & COMPANY"); pg.wait_for_timeout(1000); tab("topost")
    ok(pg.locator(TC).count() == 0 and txt("#app [data-post-main]") == "Post 2 to Tally", "T. a client posting to GARG SHEKHAR & COMPANY: no box")
    r = E("postTestCopies(S.coId, 'r1', 2)")
    ok(r and r.get("ok") is False and E("Object.keys(D().entries).length") == 2, "T. the function refuses it on any other client (%s)" % r)
    # postTo ZZ TEST but not confirmed: nothing
    E("""() => { const c = CO(); c.choices.postTo = {value: "ZZ TEST 2", state: "suggested"}; c.postTo = "ZZ TEST 2"; render(); }"""); pg.wait_for_timeout(300)
    ok(pg.locator(TC).count() == 0, "T. ZZ TEST suggested, not confirmed: no box")
    E("""() => { choiceConfirm(CO(), "postTo", "ZZ TEST 2"); render(); }"""); pg.wait_for_timeout(300)
    ok(pg.locator(TC).count() == 1, "T. confirmed 'ZZ TEST 2' (begins with ZZ TEST): the box")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
