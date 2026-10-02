"""python3 run_dups_posted.py - the review of build f9b59b7 (02-Oct-2026), items 1-4 and 8-10, on a test client:
the same file read page by page ("…p1") is found; a copy is linked to its original (also one held earlier without it);
the upload says what happened to each file; Duplicates and Deleted are filters with counts (the table too, and
Transactions); a duplicate shows its original beside it with Keep both / Delete this one; "In Tally" counts only bills
confirmed there and not since gone from Tally's entries in the cloud copy; the list of what went to Tally and the waiting
and failed postings come from the server's queue (tally_post_jobs).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_dups_posted.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8204), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """() => {
  const c = newCompany({name: "ZZ Test Client", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "invoices"; S.filter = "draft";
  S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  const mk = (id, inv, st, extra) => { const e = newEntry("Sales_" + inv.replace(/\\//g, "_") + ".pdf"); e.id = id;
    e.x = Object.assign(e.x || {}, {vendorName: "FINGATE ADVISORY SERVICES PRIVATE LIMITED", vendorGstin: "09AABCF1234K1Z5", invoiceNo: inv, invoiceDate: "2026-07-01", total: 23600, taxable: 20000});
    e.status = st; Object.assign(e, extra || {}); S.data[c.id].entries[id] = e; return e; };
  // FA/ELEC/013: posted on 29-Sep (voucher …66b4), since deleted in Tally; FA/2026-27/081: posted and still there;
  // FA/2026-27/090: a Tally file was made, never confirmed
  mk("orig", "FA/ELEC/013", "approved", {approvedAt: "2026-09-29T02:29:39Z", exportedAt: "2026-09-29T03:58:55Z", postVerified: true, postedVia: "bridge", fileHash: "928bbb30530e37ef4ab8",
    tally: {at: "2026-09-29T03:58:55Z", guid: "g-66b4", vchDate: "20260701", vchType: "Journal", company: "GARG SHEKHAR & COMPANY"}});
  mk("p81", "FA/2026-27/081", "approved", {approvedAt: "2026-10-02T01:40:18Z", exportedAt: "2026-10-02T02:21:11Z", postVerified: true, postedVia: "bridge",
    tally: {at: "2026-10-02T02:21:11Z", guid: "g-66b7", vchDate: "20260701", company: "GARG SHEKHAR & COMPANY"}});
  mk("p90", "FA/2026-27/090", "approved", {approvedAt: "2026-10-02T01:40:18Z", exportedAt: "2026-10-02T03:00:00Z"});
  // a copy held earlier without its original (as emuqaocqrvj2xr), and a deleted bill
  mk("oldcopy", "FA/ELEC/013", "duplicate", {dupOf: {entryId: null, msg: "Same supplier and bill number as a bill approved on 29-Sep-2026 (since cleared from the desk)."}, fileHash: "x1"});
  mk("gone", "FA/2026-27/070", "deleted", {deleted: {at: "2026-10-01T10:00:00Z", by: "test@test.com", reason: "wrong client"}});
  registerHash(c.id, "928bbb30530e37ef4ab8", "orig");
  c.keys = {}; c.keys[invKey(S.data[c.id].entries.orig.x)] = {d: "2026-09-29", e: "orig"};
  refreshStats(c.id); render();
  return c.id;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8204/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = pg.evaluate(SETUP); pg.wait_for_timeout(600)
    E = lambda js, *a: pg.evaluate(js, *a)
    # 3. the copy held earlier is linked to its original once the bills are loaded
    ok(E("S.data[S.coId].entries.oldcopy.dupOf.entryId") == "orig", "3. the copy held without its original is linked to it (emuqaocqrvj2xr → emum250ulhfbl8)")
    # 4. the same file read page by page
    f = E("findHash('928bbb30530e37ef4ab8p1')")
    ok(f and f.get("entryId") == "orig", "4. a one-page PDF fingerprinted with p1 is the same file (%s)" % (f or {}).get("msg"))
    # a new copy by bill number: linked to the original, named with where it is
    d = E("""(() => { const e = newEntry('FA_ELEC_013 again.pdf'); e.x = Object.assign(e.x || {}, {vendorName: 'Fingate Advisory Services Pvt Ltd', vendorPan: 'AABCF1234K', invoiceNo: 'FA-ELEC-013', invoiceDate: '2026-07-01', total: 23600});
      return findDuplicate(e, S.coId); })()""")
    ok(d and d["entryId"] == "orig" and d["strong"], "3. a new copy (PAN read, name spelt differently) is matched to the original (%s)" % (d or {}).get("msg"))
    # 1. the upload says what happened to each file
    E("""(() => { const e = newEntry('FA_ELEC_013 again.pdf'); e.x = Object.assign(e.x || {}, {vendorName: 'FINGATE ADVISORY SERVICES PRIVATE LIMITED', vendorGstin: '09AABCF1234K1Z5', invoiceNo: 'FA/ELEC/013', invoiceDate: '2026-07-01', total: 23600});
      const j1 = {name: 'Sales_FA_ELEC_013.pdf', status: 'reading', target: S.coId}; finishNewEntry(e, S.coId, j1);
      const j2 = {name: 'Sales_FA_ELEC_013.pdf (page 1)', status: 'duplicate', msg: 'Already uploaded', dupRef: {cid: S.coId, entryId: 'orig'}, target: S.coId};
      const j3 = {name: 'scan.jpg', status: 'failed', msg: 'The picture is too blurred to read.', target: S.coId};
      S.jobs = [j1, j2, j3]; S.tab = 'invoices'; S.filter = 'draft'; afterBatch(); })()""")
    pg.wait_for_timeout(600)
    u = pg.inner_text("#app [data-upload-result]")
    ok("1 duplicate" in u.replace("2 duplicates", "1 duplicate") and "could not be read: The picture is too blurred to read." in u and "approved on 29-Sep-2026" in u and "open the original" in u,
       "1. the upload says what happened to each file (%s)" % u.replace("\n", " | "))
    ok(E("S.filter") == "duplicate" and pg.locator("#app [data-dup-beside]").count() == 1, "1. only a duplicate came in: the Duplicates list opens on it, not 'Nothing waiting'")
    # 2. the duplicate with its original beside it, Keep both / Delete this one
    t = pg.inner_text("#app [data-dup-beside]")
    ok("The original" in t and "FA/ELEC/013" in t and "Keep both" in t and "Delete this one" in t, "2. the duplicate shows the original beside it, with Keep both and Delete this one")
    # 2. filters with counts: the list, the table, Transactions
    # review of 02-Oct-2026: one row of tabs for purchase bills (the step bar), with Duplicates and Deleted in it
    fl = pg.inner_text("nav.sbar[aria-label=Status][data-bill-filters]").replace("\n", " ")
    ok("Duplicates 2" in fl and "Deleted 1" in fl and fl.count("To review") == 1, "2. Duplicates and Deleted with counts in the one row of tabs (%s)" % fl)
    E("() => { S.filter = 'draft'; S.reviewTable = true; S.tab = 'invoices'; render(); }"); pg.wait_for_timeout(400)
    tb = pg.inner_text("nav.sbar[aria-label=Status][data-bill-filters]").replace("\n", " ")
    rows = pg.locator("nav.sbar").count() + pg.locator("#app .filters").count()
    ok("Duplicates 2" in tb and "Deleted 1" in tb and pg.locator("#app [data-bill-filters]").count() == 0 and rows == 1, "2. and on the table view, in the same single row (%s; %d rows of tabs)" % (tb, rows))
    E("() => { S.tab = 'txn'; S.txnTab = 'bills'; S.txnStatus = 'dup'; render(); }"); pg.wait_for_timeout(500)
    n_dup = pg.locator("#app table.txntbl tbody tr").count()
    E("() => { S.txnStatus = 'del'; render(); }"); pg.wait_for_timeout(300)
    n_del = pg.locator("#app table.txntbl tbody tr").count()
    opts = pg.inner_text("#app select[aria-label=Status]")
    ok(n_dup == 2 and n_del == 1 and "Duplicates (2)" in opts and "Deleted (1)" in opts, "2. Transactions: Duplicates (2) and Deleted (1) as filters (%d, %d)" % (n_dup, n_del))
    # 8. In Tally: confirmed and still in Tally's entries in the cloud copy
    E("""() => { TCloud.on = () => true; TCloud.has = () => true; TCloud.book = () => ({book: 'b-1', daysAt: '2026-10-02T03:30:00Z', state: {doneTo: '20261001', skipped: []}});
      window.__q = []; Cloud.api = async (u) => { window.__q.push(u); return /tally_vouchers/.test(u) ? [{guid: 'g-66b7', cancelled: false}] : []; }; }""")
    E("TallyProof.check(S.coId, true)"); pg.wait_for_timeout(500)
    st = E("[billInTally(S.data[S.coId].entries.orig), !!S.data[S.coId].entries.orig.goneFromTally, billInTally(S.data[S.coId].entries.p81), billInTally(S.data[S.coId].entries.p90), CO().stats.inTally, CO().stats.waiting]")
    ok(st == [False, True, True, False, 1, 2], "8. In Tally: 1 (081, confirmed and still there); FA/ELEC/013 gone from Tally and the unconfirmed Tally file not counted; 2 to post (%s)" % st)
    E("() => { S.tab = 'invoices'; S.filter = 'draft'; S.reviewTable = false; render(); }"); pg.wait_for_timeout(300)
    bar = pg.inner_text("header nav.sbar") if pg.locator("header nav.sbar").count() else pg.inner_text("nav.sbar[aria-label=Status]")
    ok("In Tally 1" in bar.replace("\n", " ") and "Post to Tally 2" in bar.replace("\n", " "), "8. the step bar: Post to Tally 2 · In Tally 1 (%s)" % bar.replace("\n", " "))
    # 9, 10. the server's queue: what went to Tally, and a failed posting on the Post page
    E("""() => { TCloud.restAll = async () => [
        {id: 'e9bd8ae0', client_id: S.coId, company: 'GARG SHEKHAR & COMPANY', status: 'done', done: 1, n: 1, message: '1 of 1 sent to Tally', created_at: '2026-10-02T02:21:12Z', updated_at: '2026-10-02T02:21:30Z', created_by: 'u-1',
         results: [{id: 'p81', ok: true, verified: true, kind: 'voucher', guid: 'g-66b7', vchNumber: 'FA/2026-27/081', vchType: 'Journal', masterId: '26295'}]},
        {id: 'aebb6c15', client_id: S.coId, company: 'GARG SHEKHAR & COMPANY', status: 'failed', done: 0, n: 1, message: 'Tally did not show GARG SHEKHAR & COMPANY for two minutes.', created_at: '2026-10-02T01:50:39Z', updated_at: '2026-10-02T01:53:21Z', results: [],
         items: [{id: 'p90', kind: 'voucher', state: 'failed', reason: "ledger 'Professional Fees' is not in Tally"}]},
        {id: 'b3785b05', client_id: S.coId, company: 'GARG SHEKHAR & COMPANY', status: 'done', done: 1, n: 1, message: '1 of 1 sent to Tally', created_at: '2026-10-01T10:41:19Z', updated_at: '2026-10-01T10:41:34Z', created_by: 'u-1',
         results: [{id: 'emupeho9q2sijk', ok: true, verified: true, kind: 'voucher', guid: 'g-66b6', vchNumber: 'FA/ELEC/013', vchType: 'Journal', masterId: '26294'}]}];
      Cloud.st.members = [{user_id: 'u-1', name: 'Anshul'}]; CloudJobs.list = null; CloudJobs.at = 0; S.tab = 'done'; S.step = 'done'; render(); }""")
    E("() => { S.view = 'home'; S.homeTab = 'tally'; render(); }"); pg.wait_for_timeout(1200)
    log = pg.inner_text("#app")
    ok("FA/ELEC/013" in log and "FA/2026-27/081" in log and "2 entries for" in log and "from the cloud queue" in log and "Anshul" in log,
       "9. Everything sent to Tally lists the queue's postings (FA/ELEC/013 on 01-Oct, FA/2026-27/081), by whom")
    E("() => { S.view = 'company'; S.tab = 'export'; render(); }"); pg.wait_for_timeout(1000)
    if not pg.locator("#app [data-post-jobs]").count():
        E("() => { goStep('post'); }"); pg.wait_for_timeout(1000)
    j = pg.inner_text("#app [data-post-jobs]") if pg.locator("#app [data-post-jobs]").count() else ""
    ok("Failed" in j and "two minutes" in j and "e9bd8ae0" not in j, "10. the failed posting (aebb6c15) is shown on Post to Tally, with what happened (%s)" % j[:120].replace("\n", " "))
    ok("FA/2026-27/090" in j and "Failed" in j and "Professional Fees" in j, "3 (posting fixes). each entry's state and reason in the failed posting")
    E("() => { window.__rpc = []; TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, a]); return {ok: true, id: a.p_id, retry: true}; }; }")
    pg.click('#app [data-job="aebb6c15"] button:has-text("Retry")'); pg.wait_for_timeout(600)
    ok(E("window.__rpc") == [["tally_post_enqueue", {"p_id": "aebb6c15", "p_client": cid, "p_payload": {}}]], "Retry queues the same posting again under its id")
    un = pg.inner_text("#app [data-post-unsure]") if pg.locator("#app [data-post-unsure]").count() else ""
    ok("FA/ELEC/013" in un and "Not in Tally any more" in un and "In a Tally file, not confirmed" in un and "Post the ones no longer in Tally again" in un,
       "8. the bills not counted as in Tally are listed apart, with a way to post again the one deleted in Tally")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
