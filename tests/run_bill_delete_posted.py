"""python3 run_bill_delete_posted.py - round 14c (C5b, C3 Restore): deleting a bill that has a live posting asks first,
with the voucher named: "This bill is posted to Tally (voucher id N / being checked). Deleting it here does not remove it
from Tally. Delete anyway?" (confirmTyped: the client's name and a reason), then the soft delete goes on as today; a bill
with no posting asks only the usual reason. A member (not the firm's owner) sees Restore blocked with the words beside
it ("Only the firm's owner can restore a deleted bill."), not a toast on click.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bill_delete_posted.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8277), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """async () => {
  const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  await openCompany(c.id);
  const mk = (id, n, no, extra) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: 1000, total: 1000});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; if (extra){ approve(e); Object.assign(e, extra); } return e; };
  mk("d1", "Plain Draft Co", "P/1", null);
  mk("p1", "Unconfirmed Co", "U/1", {postUnconfirmed: {at: "2026-10-01T10:00:00Z", company: "GARG"}});
  mk("p2", "Posted Co", "V/1", {exportedAt: "2026-10-01T10:00:00Z", postedVia: "bridge", tallyVchNo: "4521", tally: {at: "2026-10-01T10:00:00Z", guid: "g-1", vchDate: "20260701"}});
  mk("p3", "Held Co", "H/1", {});
  // the cloud still holds p3's FinCom id (tally_post_ids live): what the Post page already loads
  PostIds.readable = true; PostIds.by[c.id] = {at: Date.now(), key: "x", held: new Map([["p3", true]]), sig: "s"};
  window.__toasts = []; const t0 = window.toast; window.toast = (m) => { window.__toasts.push(String(m)); return t0 && t0(m); };
  refreshStats(c.id); goStep("review", "bills"); render();
  return c.id;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8277/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP); pg.wait_for_timeout(800)
    box = lambda: pg.inner_text("#confirmBox").replace("\n", " ") if pg.locator("#confirmBox .cbx").count() else ""
    def cancel():
        if pg.locator('#confirmBox [data-cbx="no"]').count(): pg.click('#confirmBox [data-cbx="no"]')
        pg.wait_for_timeout(300)
    WARN = "Deleting it here does not remove it from Tally. Delete anyway?"
    # a plain draft: the usual box only
    E("billDelete('d1')"); pg.wait_for_timeout(500)
    ok("Delete this bill?" in box() and WARN not in box() and pg.locator("#confirmBox #delWhy").count() == 1, "a bill with no posting: the usual box (why is it deleted), no warning")
    cancel()
    # posted and not yet confirmed: "being checked"
    E("billDelete('p1')"); pg.wait_for_timeout(500)
    ok("This bill is posted to Tally (voucher id being checked). " + WARN in box() and pg.locator("#confirmBox #cbxName").count() == 1, "C5b. posted, not confirmed: 'This bill is posted to Tally (voucher id being checked). %s', the client's name asked (%s)" % (WARN, box()[:200]))
    cancel()
    # in Tally with a voucher number
    E("billDelete('p2')"); pg.wait_for_timeout(500)
    ok("This bill is posted to Tally (voucher id 4521). " + WARN in box(), "C5b. in Tally: the voucher id named (%s)" % box()[:160])
    cancel()
    # the cloud still holds its FinCom id
    E("billDelete('p3')"); pg.wait_for_timeout(500)
    ok("This bill is posted to Tally (voucher id being checked). " + WARN in box(), "C5b. the id still held in FinCom's cloud: 'being checked' (%s)" % box()[:160])
    cancel()
    # on confirm the soft delete proceeds as today (the reason box, then Deleted with the reason)
    E("billDelete('p1')"); pg.wait_for_timeout(500)
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx-err").count() == 1 and E("D().entries['p1'].status") == "approved", "C5b. without the client's name typed: not deleted, the box says so")
    pg.fill("#confirmBox #cbxWhy", "posted by mistake"); pg.fill("#confirmBox #cbxName", "ZZ Zeta Exports"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(500)
    ok("Delete this bill?" in box() and pg.locator("#confirmBox #delWhy").count() == 1, "C5b. confirmed: the usual box follows (why is it deleted)")
    pg.fill("#confirmBox #delWhy", "posted by mistake"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(E("D().entries['p1'].status") == "deleted" and E("D().entries['p1'].deleted.reason") == "posted by mistake", "C5b. deleted softly, with the reason, as today")
    # ---- C3 (Restore): a member who is not the firm's owner sees why Restore is blocked, beside the button
    E("() => { Cloud.on = () => true; S.account = {me: {role: 'staff'}, firm: {name: 'Firm'}}; S.filter = 'deleted'; S.selected = 'p1'; S.reviewTable = false; render(); }"); pg.wait_for_timeout(600)
    rw = pg.locator("#app [data-restore-why]")
    ok(pg.locator("#app button:has-text('Restore')").count() == 1 and pg.locator("#app button:has-text('Restore')").is_disabled() and rw.count() == 1 and "Only the firm’s owner can restore a deleted bill." in rw.inner_text(),
       "C3. a member: Restore is disabled with 'Only the firm’s owner can restore a deleted bill.' beside it (%s)" % (rw.inner_text() if rw.count() else "-"))
    E("() => { S.account = {me: {role: 'owner'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(400)
    ok(pg.locator("#app button:has-text('Restore')").count() == 1 and not pg.locator("#app button:has-text('Restore')").is_disabled() and pg.locator("#app [data-restore-why]").count() == 0, "C3. the owner: Restore live, no words")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
