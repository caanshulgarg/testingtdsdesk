"""python3 run_post_hide_remove.py - Hide and Remove on the Posted and Errors tabs (the owner's spec of 04-Oct-2026, item J), in
the app, on the staging-shaped rows of run_post_rows_fix.py. FinCom's cloud is stood in for here (tally_post_row_flags and
the three functions of migration 49; run_migration49.py checks the real ones on PostgreSQL).
  - without migration 49 (no tally_post_row_flags): no Hide, no Remove, no tick boxes, and no error;
  - Hide (a row; "Hide all" / the rows ticked): tally_post_row_hide(keys, true), for this user only; the row leaves the list,
    "Show hidden (N)" lists it with "Show again" (tally_post_row_hide(keys, false)); nothing else is called;
  - Remove (one row, any member): asks once, then tally_post_row_remove([key], why); the row goes to "Removed (N)" with who
    and when, and "Restore" (tally_post_row_restore);
  - "Remove all" (owners only) acts on the rows shown after a search, or on the rows ticked; it asks once: "Remove N rows from
    this list? The entries in Tally are not affected. You can restore them from Removed.";
  SAFETY: removing a Posted row calls nothing but tally_post_row_remove (no release, no mark, no posting), leaves the bill's
    posted mark and Tally id as they were, keeps its FinCom id held, and Post on that bill is still refused at the app's
    gate (nothing queued); an Errors row whose posting is still going on cannot be removed - the button says why, "Remove
    all" leaves it out and nothing cancels the posting; the tab counts leave out hidden and removed rows.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_hide_remove.py"""
import os, re, json, copy
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
os.environ["PORT"] = os.environ.get("HIDE_PORT", "8293")
from playwright.sync_api import sync_playwright
import run_post_rows_fix as rf
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FX = copy.deepcopy(rf.FX)
# an Errors row whose posting is still going on: Tally answered nothing yet, the cloud checks it (job running, item unknown)
LIVE = "00000066-1111-4111-8111-000000000000"
FX["jobs"].append({"id": LIVE, "client_id": "cmufksrrqjub2g", "company": rf.G, "status": "running", "checking": True, "n": 1, "done": 0, "message": "Sent to Tally; checking whether it reached Tally",
                   "created_at": "2026-10-04T17:10:00+00:00", "updated_at": "2026-10-04T17:10:05+00:00", "entry_ids": ["lv1"], "created_by": rf.OWNER,
                   "results": [{"id": "lv1", "ok": False, "outcomeUnknown": True, "message": "Checking whether it reached Tally"}], "items": [{"id": "lv1", "state": "unknown", "reason": "Checking whether it reached Tally"}]})
FX["bills"].append(rf.bill("lv1", "LV/1", "LIVE CHECK CO", "2026-09-20", 4720))
SERVER = r"""() => {
  // FinCom's cloud for this test: the three functions of migration 49 on window.__flags
  const me = () => (S.account && S.account.me && S.account.me.user_id) || "";
  const owner = () => (S.account && S.account.me && S.account.me.role) === "owner";
  const live = k => { const j = window.__fx.jobs.find(x => x.id === k.split(":")[0]); return !!(j && (["waiting", "taken", "running"].includes(j.status) || j.checking)); };
  window.__rpcHook = async (fn, a) => {
    const F = window.__flags, now = new Date().toISOString();
    if (fn === "tally_post_row_hide"){ a.p_keys.forEach(k => { const f = F.find(x => x.kind === "hide" && x.row_key === k && x.user_id === me() && !x.restored_at);
        if (a.p_on && !f) F.push({row_key: k, kind: "hide", user_id: me(), at: now}); if (!a.p_on && f) f.restored_at = now; }); return {ok: true}; }
    if (fn === "tally_post_row_remove"){ if (a.p_keys.length > 1 && !owner()) throw new Error("only an owner of the firm can remove more than one row at a time");
      const bad = a.p_keys.find(live); if (bad) throw new Error("this row cannot be removed: its posting is still going on (" + bad + ")");
      a.p_keys.forEach(k => { if (!F.find(x => x.kind === "remove" && x.row_key === k && !x.restored_at)) F.push({row_key: k, kind: "remove", user_id: me(), at: now, why: a.p_why || null}); }); return {ok: true}; }
    if (fn === "tally_post_row_restore"){ F.filter(x => x.kind === "remove" && a.p_keys.includes(x.row_key) && !x.restored_at).forEach(x => { x.restored_at = now; }); return {ok: true}; }
    return undefined;
  };
}"""
rf.serve(int(os.environ["PORT"]))
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%s/" % os.environ["PORT"]); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: " ".join(pg.inner_text(sel).split()) if pg.locator(sel).count() else ""
    def tab(name): pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(400)
    cnt = lambda t: int(re.findall(r"\d+", txt('#app [data-post-tabs] [data-post-tab="%s"] [data-tab-n]' % t))[0])
    keys = lambda t: E("(t) => Array.from(document.querySelectorAll('#app [data-post-panel=\"' + t + '\"] [data-entry-row]')).map(r => r.getAttribute('data-row-key'))", t)
    rpc = lambda: [c for c in E("window.__rpc") if c[0] not in ("tally_status", "tally_want_update")]
    # ---- without migration 49
    E(rf.FIXTURE, dict(FX, flags=False)); pg.wait_for_timeout(2000); E("() => { PostFlags.load(true); }"); pg.wait_for_timeout(600); tab("posted")
    ok(E("PostFlags.ok") is False and pg.locator("#app [data-row-hide], #app [data-row-remove], #app [data-row-tick], #app [data-hide-all], #app [data-remove-all]").count() == 0 and not errors,
       "J. without migration 49 (tally_post_row_flags missing): no Hide, no Remove, no tick boxes, no error (%s)" % E("PostFlags.ok"))
    # ---- with it
    E("() => { window.__flags = []; PostFlags.ok = null; PostFlags.at = 0; PostFlags.load(true); }"); E(SERVER); pg.wait_for_timeout(800); tab("posted")
    ok(E("PostFlags.ok") is True and pg.locator('#app [data-post-panel="posted"] [data-row-hide]').count() == len(keys("posted")) and pg.locator('#app [data-post-panel="posted"] [data-row-tick]').count() == len(keys("posted")),
       "J. with migration 49: Hide, Remove and a tick box on every Posted row")
    p0, e0 = cnt("posted"), cnt("errors")
    K3829 = rf.J["j3829"] + ":emutzp8x6z64zl"
    snap = lambda: E("""() => { const e = D().entries.emutzp8x6z64zl; return JSON.stringify({exp: e.exportedAt, tally: e.tally, by: e.postByReply, status: e.status, held: postIdReleased('emutzp8x6z64zl', S.coId)}); }""")
    before = snap()
    # Hide one
    E("() => { window.__rpc = []; }")
    pg.click('#app [data-post-panel="posted"] [data-row-key="%s"] [data-row-hide]' % K3829); pg.wait_for_timeout(800)
    ok(rpc() == [["tally_post_row_hide", {"p_keys": [K3829], "p_on": True}]], "J. Hide: tally_post_row_hide([the row], true) and nothing else (%s)" % rpc())
    ok(K3829 not in keys("posted") and cnt("posted") == p0 - 1 and "Show hidden (1)" in txt('#app [data-post-panel="posted"] [data-show-hidden]'), "J. hidden: off the list, the tab count leaves it out (%d -> %d), 'Show hidden (1)'" % (p0, cnt("posted")))
    pg.click('#app [data-post-panel="posted"] [data-show-hidden]'); pg.wait_for_timeout(300)
    ok(keys("posted") == [K3829] and pg.locator('#app [data-post-panel="posted"] [data-row-unhide]').count() == 1, "J. Show hidden lists it, with Show again")
    E("() => { window.__rpc = []; }"); pg.click('#app [data-post-panel="posted"] [data-row-unhide]'); pg.wait_for_timeout(800)
    ok(rpc() == [["tally_post_row_hide", {"p_keys": [K3829], "p_on": False}]], "J. Show again: tally_post_row_hide([the row], false) (%s)" % rpc())
    pg.click('#app [data-post-panel="posted"] [data-show-hidden]') if pg.locator('#app [data-post-panel="posted"] [data-show-hidden]').count() else None; pg.wait_for_timeout(300)
    ok(K3829 in keys("posted") and cnt("posted") == p0, "J. back on the list, the count as before")
    ok(snap() == before, "J. hiding changed nothing of the bill or its posted mark")
    # Remove one (a staff member may remove one row)
    E("() => { S.account = {me: {role: 'staff', user_id: '871ad9b4-dec0-47ab-a22f-9184aa7e5694', name: 'Ankit Garg'}, firm: {name: 'Firm'}}; Cloud.st.members.push({user_id: '871ad9b4-dec0-47ab-a22f-9184aa7e5694', name: 'Ankit Garg'}); render(); }"); pg.wait_for_timeout(400); tab("posted")
    ok(pg.locator('#app [data-post-panel="posted"] [data-remove-all]').count() == 0, "J. Remove all: owners only (a staff member does not see it)")
    E("() => { window.__rpc = []; }"); pg.click('#app [data-post-panel="posted"] [data-row-key="%s"] [data-row-remove]' % K3829); pg.wait_for_timeout(400)
    ask = txt("#confirmBox")
    ok("Remove this row from the list? The entry in Tally is not affected. You can restore it from Removed." in ask, "J. Remove asks once (%s)" % ask[:160])
    pg.fill("#confirmBox input#removeWhy", "seen in Tally, done"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(900)
    ok(rpc() == [["tally_post_row_remove", {"p_keys": [K3829], "p_why": "seen in Tally, done"}]], "J. SAFETY: removing a Posted row calls tally_post_row_remove alone: no release, no mark, no posting (%s)" % rpc())
    ok(K3829 not in keys("posted") and cnt("posted") == p0 - 1 and "Removed (1)" in txt('#app [data-post-panel="posted"] [data-show-removed]'), "J. removed: off the list for everyone, 'Removed (1)'")
    ok(snap() == before and E("postIdReleased('emutzp8x6z64zl', S.coId)") is False, "J. SAFETY: the bill keeps its posted mark and Tally id, and its FinCom id stays held (%s)" % snap())
    # the same bill can never be posted again because its row was removed: the app's gate
    E("() => { window.__rpc = []; window.__said = []; const t0 = window.toast; window.toast = m => { window.__said.push(String(m)); return t0(m); }; return postAllToTally({kind: 'bill', id: 'emutzp8x6z64zl'}); }"); pg.wait_for_timeout(800)
    ok(not [c for c in rpc() if c[0] == "tally_post_enqueue"] and E("D().entries.emutzp8x6z64zl.exportedAt") and pg.locator("#confirmBox .cbx").count() == 0,
       "J. SAFETY: Post on the removed row's bill is refused at the app's gate: nothing queued, no preview (%s)" % E("window.__said"))
    ok(E("postBucket(D().entries.emutzp8x6z64zl, {jobs: postJobStates(S.coId)})") == "intally", "J. SAFETY: the bill still counts as in Tally (postBucket intally)")
    tab("posted"); pg.click('#app [data-post-panel="posted"] [data-show-removed]'); pg.wait_for_timeout(300)
    rm = txt('#app [data-post-panel="posted"] [data-row-key="%s"]' % K3829)
    ok("Removed by Ankit Garg on" in rm and " IST: seen in Tally, done" in rm and pg.locator('#app [data-post-panel="posted"] [data-row-key="%s"] [data-row-restore]' % K3829).count() == 1, "J. Removed: who and when, why, and Restore (%s)" % rm[-120:])
    E("() => { window.__rpc = []; }"); pg.click('#app [data-post-panel="posted"] [data-row-key="%s"] [data-row-restore]' % K3829); pg.wait_for_timeout(900)
    ok(rpc() == [["tally_post_row_restore", {"p_keys": [K3829]}]], "J. Restore: tally_post_row_restore([the row]) (%s)" % rpc())
    if pg.locator('#app [data-post-panel="posted"] [data-show-removed]').count(): pg.click('#app [data-post-panel="posted"] [data-show-removed]'); pg.wait_for_timeout(300)
    ok(K3829 in keys("posted") and cnt("posted") == p0, "J. restored: back on the list for everyone")
    # Remove all (owner): the rows shown after a search
    E("() => { S.account = {me: {role: 'owner', user_id: window.__fx.OWNER, name: 'Anshul garg'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(400); tab("posted")
    pg.fill('#app [data-post-panel="posted"] [data-posted-search]', "jitin"); pg.wait_for_timeout(400)
    shown = keys("posted"); n = len(shown)
    E("() => { window.__rpc = []; }"); pg.click('#app [data-post-panel="posted"] [data-remove-all]'); pg.wait_for_timeout(400)
    ask = txt("#confirmBox")
    ok(("Remove %d rows from this list? The entries in Tally are not affected. You can restore them from Removed." % n) in ask, "J. Remove all asks once: 'Remove %d rows from this list? The entries in Tally are not affected. You can restore them from Removed.' (%s)" % (n, ask[:200]))
    pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(300)
    ok(not rpc(), "J. Cancel: nothing removed")
    # the rows ticked
    pg.click('#app [data-post-panel="posted"] [data-row-key="%s"] [data-row-tick]' % shown[0]); pg.click('#app [data-post-panel="posted"] [data-row-key="%s"] [data-row-tick]' % shown[1]); pg.wait_for_timeout(300)
    ok(txt('#app [data-post-panel="posted"] [data-remove-all]') == "Remove selected (2)" and txt('#app [data-post-panel="posted"] [data-hide-all]') == "Hide selected (2)", "J. a selection: 'Remove selected (2)', 'Hide selected (2)'")
    pg.click('#app [data-post-panel="posted"] [data-remove-all]'); pg.wait_for_timeout(400)
    ok("Remove 2 rows from this list?" in txt("#confirmBox"), "J. Remove selected asks for the two")
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(900)
    ok(rpc() == [["tally_post_row_remove", {"p_keys": sorted(shown[:2], key=shown.index), "p_why": ""}]], "J. tally_post_row_remove(the two rows ticked) (%s)" % rpc())
    ok(cnt("posted") == p0 - 2, "J. the Posted count leaves out the removed rows (%d)" % cnt("posted"))
    # Hide all, the rows shown after a search
    pg.fill('#app [data-post-panel="posted"] [data-posted-search]', ""); pg.wait_for_timeout(300)
    pg.fill('#app [data-post-panel="posted"] [data-posted-search]', "26303"); pg.wait_for_timeout(300)
    E("() => { window.__rpc = []; }"); pg.click('#app [data-post-panel="posted"] [data-hide-all]'); pg.wait_for_timeout(900)
    ok(rpc() == [["tally_post_row_hide", {"p_keys": [rf.J["j5000"] + ":emutbefbslee3n"], "p_on": True}]], "J. Hide all acts on the rows shown after the search (%s)" % rpc())
    pg.fill('#app [data-post-panel="posted"] [data-posted-search]', ""); pg.wait_for_timeout(300)
    ok(cnt("posted") == p0 - 3, "J. the Posted count leaves out hidden and removed rows (%d)" % cnt("posted"))
    # ---- Errors: a row whose posting is still going on cannot be removed
    tab("errors")
    KL = LIVE + ":lv1"; RL = '#app [data-post-panel="errors"] [data-row-key="%s"]' % KL
    ok(pg.locator(RL).count() == 1 and pg.locator(RL + " [data-row-remove]").is_disabled() and "Cannot be removed: its posting is still going on" in txt(RL + " [data-remove-why]"),
       "J. SAFETY: an Errors row whose posting is still going on: Remove is off and says why (%s)" % txt(RL + " [data-remove-why]"))
    ek = keys("errors"); e1 = cnt("errors")
    E("() => { window.__rpc = []; }"); pg.click('#app [data-post-panel="errors"] [data-remove-all]'); pg.wait_for_timeout(400)
    ask = txt("#confirmBox")
    ok(("Remove %d rows from this list?" % (len(ek) - 1)) in ask and "1 row is left as it is: its posting is still going on." in ask, "J. Remove all on Errors leaves the live one out and says so (%s)" % ask[:240])
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(900)
    calls = rpc()
    ok(len(calls) == 1 and calls[0][0] == "tally_post_row_remove" and KL not in calls[0][1]["p_keys"] and len(calls[0][1]["p_keys"]) == len(ek) - 1, "J. SAFETY: tally_post_row_remove without the live row; no tally_post_cancel, nothing else (%s)" % [c[0] for c in calls])
    ok(keys("errors") == [KL] and cnt("errors") == 1 and E("window.__fx.jobs.find(j => j.id === '%s').status" % LIVE) == "running", "J. the live row stays, its posting still running; the Errors count is 1 (%s)" % keys("errors"))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
