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
    # round 5 (C3): the cloud copy keeps an entry deleted in Tally, marked (deleted_at, migration-32/37): the check reads
    # live entries only; a cloud without the column is read as before
    qs = E("window.__q")
    ok(qs and all("deleted_at=is.null" in u for u in qs if "tally_vouchers" in u), "C3. tally_vouchers read with deleted_at=is.null (%s)" % [u[:90] for u in qs][:2])
    E("""() => { window.__q = []; Cloud.api = async (u) => { window.__q.push(u); if (/deleted_at/.test(u)) throw new Error('column tally_vouchers.deleted_at does not exist (42703)'); return /tally_vouchers/.test(u) ? [{guid: 'g-66b7', cancelled: false}] : []; };
      TallyProof.hasDel = null; TallyProof.at = {}; }""")
    E("TallyProof.check(S.coId, true)"); pg.wait_for_timeout(500)
    st2 = E("[billInTally(S.data[S.coId].entries.orig), billInTally(S.data[S.coId].entries.p81)]"); qs = E("window.__q")
    ok(st2 == [False, True] and any("tally_vouchers" in u and "deleted_at" not in u for u in qs) and E("TallyProof.hasDel") is False, "C3. without the column: read again without it, the same answer (%s)" % [u[-60:] for u in qs])
    E("""() => { window.__q = []; Cloud.api = async (u) => { window.__q.push(u); return /tally_vouchers/.test(u) ? [{guid: 'g-66b7', cancelled: false}] : []; }; TallyProof.hasDel = null; TallyProof.at = {}; }""")
    E("TallyProof.check(S.coId, true)"); pg.wait_for_timeout(500)
    ok(E("!!S.data[S.coId].entries.orig.goneFromTally"), "C3. an entry deleted in Tally (not answered) stays gone")
    # the bank lines' check (checkBank) reads the same way: vouchers by id without deleted entries, and the day's lines
    # without those of a deleted entry
    E("""() => { S.bank = {cid: S.coId, rows: [{id: "s1-1", state: "sent", date: "2026-07-01", debit: 100, tally: {guid: "g-b1", at: "2026-07-02T00:00:00Z"}, sentAt: "2026-07-02T00:00:00Z"}], stmts: [{id: "s1"}], ledgers: {list: []}};
      window.saveBank = () => {}; window.__q = []; TallyProof.hasDel = null; TallyProof.bankAt = {};
      Cloud.api = async (u) => { window.__q.push(u); return /tally_vouchers\\?select=guid,cancelled/.test(u) ? [{guid: "g-b1", cancelled: false}] : []; }; }""")
    E("TallyProof.checkBank(S.coId, true)"); pg.wait_for_timeout(500)
    qs = E("window.__q")
    ok(qs and all("deleted_at=is.null" in u for u in qs if "tally_vouchers?select=guid,cancelled" in u) and not E("!!S.bank.rows[0].goneFromTally"), "C3. the bank lines' vouchers read live only; the line found stays (%s)" % [u[-70:] for u in qs][:2])
    # round 9 (owner item 10): a bank line without a voucher id is looked for among the day's lines (tally_lines, a direct
    # read): the lines of an entry deleted in Tally (tally_vouchers.deleted_at, migration-37) are left out, so a line whose
    # only match is such an entry is gone from Tally
    E("""() => { CO().bankAccounts = [{id: "a1", ledger: "HDFC Bank", bank: "HDFC", last4: "1234"}];
      S.bank = {cid: S.coId, rows: [{id: "s2-1", state: "intally", date: "2026-07-01", debit: 100}], stmts: [{id: "s2", acctId: "a1", bank: "HDFC"}], ledgers: {list: []}};
      window.saveBank = () => {}; window.__q = []; TallyProof.hasDel = null; TallyProof.bankAt = {};
      Cloud.api = async (u) => { window.__q.push(u);
        if (/deleted_at=not\\.is\\.null/.test(u)) return [{guid: "g-del"}];
        if (/tally_lines/.test(u)) return [{ledger: "HDFC Bank", amount: 100, guid: "g-del"}];
        return []; }; }""")
    E("TallyProof.checkBank(S.coId, true)"); pg.wait_for_timeout(500)
    qs = E("window.__q")
    ok(any("tally_lines" in u for u in qs) and E("!!S.bank.rows[0].goneFromTally"), "10. a bank line matched only by the line of an entry deleted in Tally: that line is left out, the bank line is gone (%s)" % [u[-60:] for u in qs][:3])
    # 10. the ledgers page's other direct read of tally_lines (the party ledger of a GSTIN, from the cloud copy's entries
    # carrying it): the lines of an entry deleted in Tally are not read or used; a cloud without the column is read as before
    G = "09ZZZZZ0000Z1Z1"
    STUB = """(bad) => { window.__q = []; TallyProof.hasDel = null; Ledgers.gstinMap = {};
      Cloud.api = async (u) => { window.__q.push(u);
        if (bad && /deleted_at/.test(u)) throw new Error('column tally_vouchers.deleted_at does not exist (42703)');
        if (/tally_vouchers\\?select=party,guid/.test(u)) return /deleted_at=is\\.null/.test(u) ? [] : [{party: "Zed Deleted Party", guid: "g-del"}];
        if (/tally_lines/.test(u)) return [{ledger: "Zed Deleted Party"}];
        return []; }; }"""
    E(STUB, False); E("(g) => Ledgers.gstinParty(S.coId, g)", G); pg.wait_for_timeout(500)
    qs = E("window.__q")
    ok(any("tally_vouchers?select=party,guid" in u and "deleted_at=is.null" in u for u in qs) and not any("tally_lines" in u and "g-del" in u for u in qs) and E("(g) => Ledgers.gstinMap[S.coId][g]", G) == "",
       "10. the GSTIN's vouchers are read live only: the deleted entry's lines are not read, no party from them (%s)" % [u[-70:] for u in qs][:3])
    E(STUB, True); E("(g) => Ledgers.gstinParty(S.coId, g)", G); pg.wait_for_timeout(500)
    qs = E("window.__q")
    ok(any("tally_vouchers?select=party,guid" in u and "deleted_at" not in u for u in qs) and any("tally_lines" in u and "g-del" in u for u in qs) and E("TallyProof.hasDel") is False,
       "10. without the column (42703): read again without it, the entry's lines read as before (%s)" % [u[-60:] for u in qs][:3])
    E("() => { S.tab = 'invoices'; S.filter = 'draft'; S.reviewTable = false; render(); }"); pg.wait_for_timeout(300)
    bar = pg.inner_text("header nav.sbar") if pg.locator("header nav.sbar").count() else pg.inner_text("nav.sbar[aria-label=Status]")
    # second pass of 02-Oct-2026: the tab counts what is ready to post (none); the two bills not confirmed in Tally are a
    # badge of their own (what needs attention)
    tabn = E("[document.querySelector('nav.sbar [data-step=post] [data-step-n]').textContent, (document.querySelector('nav.sbar [data-step=post] [data-attn-n]') || {}).textContent || '']")
    ok("In Tally 1" in bar.replace("\n", " ") and tabn == ["0", "2"], "8. the step bar: Post to Tally 0, needing attention 2 · In Tally 1 (%s; %s)" % (bar.replace("\n", " "), tabn))
    # 9, 10. the server's queue: what went to Tally, and a failed posting on the Post page
    E("""() => { TCloud.restAll = async () => [
        {id: 'e9bd8ae0', client_id: S.coId, company: 'GARG SHEKHAR & COMPANY', status: 'done', done: 1, n: 1, message: '1 of 1 sent to Tally', created_at: '2026-10-02T02:21:12Z', updated_at: '2026-10-02T02:21:30Z', created_by: 'u-1',
         results: [{id: 'p81', ok: true, verified: true, kind: 'voucher', guid: 'g-66b7', vchNumber: 'FA/2026-27/081', vchType: 'Journal', masterId: '26295'}]},
        {id: 'aebb6c15', client_id: S.coId, company: 'GARG SHEKHAR & COMPANY', status: 'failed', done: 0, n: 1, message: 'Tally did not show GARG SHEKHAR & COMPANY for two minutes.', created_at: '2026-10-02T01:50:39Z', updated_at: '2026-10-02T01:53:21Z', results: [],
         items: [{id: 'p90', kind: 'voucher', state: 'failed', reason: "ledger 'Professional Fees' is not in Tally"}]},
        {id: 'b3785b05', client_id: S.coId, company: 'GARG SHEKHAR & COMPANY', status: 'done', done: 1, n: 1, message: '1 of 1 sent to Tally', created_at: '2026-10-01T10:41:19Z', updated_at: '2026-10-01T10:41:34Z', created_by: 'u-1',
         results: [{id: 'emupeho9q2sijk', ok: true, verified: true, kind: 'voucher', guid: 'g-66b6', vchNumber: 'FA/ELEC/013', vchType: 'Journal', masterId: '26294'}]}];
      Cloud.st.members = [{user_id: 'u-1', name: 'Anshul'}]; CloudJobs.list = null; CloudJobs.at = 0; S.tab = 'done'; S.step = 'done'; render(); }""")
    # phase 2: the Tally page's Everything sent is a tab of its own (Computers, Sync activity, Everything sent)
    E("() => { S.view = 'home'; S.homeTab = 'tally'; S.tallyTab = 'sent'; render(); }"); pg.wait_for_timeout(1200)
    log = pg.inner_text("#app")
    ok("FA/ELEC/013" in log and "FA/2026-27/081" in log and "2 entries for" in log and "from the cloud queue" in log and "Anshul" in log,
       "9. Everything sent to Tally lists the queue's postings (FA/ELEC/013 on 01-Oct, FA/2026-27/081), by whom")
    E("() => { S.view = 'company'; S.tab = 'export'; render(); }"); pg.wait_for_timeout(1000)
    if not pg.locator("#app [data-post-attention]").count():
        E("() => { goStep('post'); }"); pg.wait_for_timeout(1000)
    # the owner's spec of 04-Oct: one row an entry. The failed posting aebb6c15 held p90 alone, and p90 was put in a Tally
    # file after it: p90 is listed once, as in a Tally file (not under the failed posting, and no Retry of it: that would
    # send it a second time)
    ok(pg.locator('#app [data-post-attention] [data-job="aebb6c15"]').count() == 0 and pg.locator('#app [data-post-attention] [data-job="e9bd8ae0"]').count() == 0,
       "10. the failed posting (aebb6c15) whose bill went into a Tally file after it: not a row of its own")
    ok(E("Array.from(document.querySelectorAll('#app [data-post-panel=\"errors\"] [data-bill-row]')).map(r => r.getAttribute('data-bill-row')).sort().join()") == "orig,p90",
       "3 (posting fixes). each bill not confirmed in Tally once, as a row of its own")
    ok(pg.locator('#app [data-bill-row="p90"] [data-retry], #app [data-bill-row="p90"] [data-post-again]').count() == 0, "10. and no Retry or Post again for it")
    # second pass of 02-Oct-2026 (item 3): FA/ELEC/013 is not offered to be posted again on the cloud copy's word: Tally is
    # read afresh first, and here there is no Tally to read (no bridge, no Tally computer heard from)
    pg.wait_for_timeout(600)
    o = pg.inner_text('#app [data-post-attention] [data-bill-row="orig"]') if pg.locator('#app [data-post-attention] [data-bill-row="orig"]').count() else ""
    p9 = pg.inner_text('#app [data-post-attention] [data-bill-row="p90"]') if pg.locator('#app [data-post-attention] [data-bill-row="p90"]').count() else ""
    ok("FA/ELEC/013" in o and "Not checked yet" in o and pg.locator('#app [data-bill-row="orig"] [data-post-again]').count() == 0 and pg.locator('#app [data-bill-row="orig"] [data-check-now]').count() == 1
       and "In a Tally file" in p9 and pg.locator('#app [data-post-unsure]').count() == 0,
       "8. the bills not counted as in Tally need attention, each once; the one not found in the cloud copy says 'Not checked yet' with Check now, no Post again (%s)" % o.replace("\n", " ")[:160])
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
