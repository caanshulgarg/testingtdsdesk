// The Tally page's owner actions (were TCloud's in src/js/49-tally-cloud.js; moved here by next-fast-open, 20-Oct-2026,
// to keep legacy.js within its 600 KB budget). Only the Tally page (app/src/screens/Tally.jsx) calls them; they are put on
// TCloud when that page's code loads, and use legacy.js's globals (TCloud, Cloud, TCloudUp, askConfirm, esc, toast, render).
/* global TCloud, Cloud, TCloudUp, askConfirm, esc, toast, render */
const acts = {
  // the owner's rule of 05-Oct-2026 (migration 54): new versions go to every computer by themselves; an owner HOLDS a
  // version (no bridge takes it; a reason is required, kept with who and when), lets it go again, rolls every bridge back
  // to an earlier version (until cleared), and clears that rollback
  async releaseHold(v){
    const a = await askConfirm({title: "Hold version " + v + "?", ok: "Hold it",
      body: "<p>No bridge of the firm takes FinCom Bridge " + esc(v) + " until you let it go; the ones running it keep running.</p>" +
        '<div class="bk-form one"><label><span>Why (kept with the version, shown on this page)</span><input id="holdWhy" maxlength="500" placeholder="What went wrong"></label></div>',
      read: () => ({why: ((document.getElementById("holdWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say why the version is held."});
    if (!a || !a.ok) return;
    await this.control("tally_release_hold", {p_version: v, p_why: a.data.why}, "Version " + v + " is held: no bridge takes it.");
  },
  async releaseUnhold(v){
    const a = await askConfirm({title: "Let version " + v + " go?", ok: "Let it go",
      body: "<p>Every bridge of the firm takes FinCom Bridge " + esc(v) + " by itself again, within a few hours.</p>" +
        '<div class="bk-form one"><label><span>Note (kept)</span><input id="unholdWhy" maxlength="500" placeholder="What was put right"></label></div>',
      read: () => ({why: ((document.getElementById("unholdWhy") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    await this.control("tally_release_unhold", {p_version: v, p_why: (a.data && a.data.why) || ""}, "Version " + v + " goes to every computer again.");
  },
  async releaseRollback(){
    const a = await askConfirm({title: "Roll every bridge back to an earlier version?", ok: "Roll back",
      body: "<p>Each bridge of the firm that keeps that version from its last update puts it back by itself, and no bridge takes a newer version until you clear the rollback. A bridge that does not keep it stays as it is and says so in its log.</p>" +
        '<div class="bk-form one"><label><span>Version (like 2.2.4)</span><input id="rollbackVersion" maxlength="20" placeholder="2.2.4"></label>' +
        '<label><span>Why (kept, shown on this page)</span><input id="rollbackWhy" maxlength="500" placeholder="What went wrong"></label></div>',
      read: () => ({version: ((document.getElementById("rollbackVersion") || {}).value || "").trim(), why: ((document.getElementById("rollbackWhy") || {}).value || "").trim()}),
      validate: d => !d || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(d.version) ? "Give the version, like 2.2.4." : !d.why ? "Say why." : ""});
    if (!a || !a.ok) return;
    await this.control("tally_release_rollback", {p_version: a.data.version, p_why: a.data.why}, "Every bridge goes back to version " + a.data.version + " (where it is kept); no newer version until you clear it.");
  },
  async releaseRollbackClear(){
    const a = await askConfirm({title: "Clear the rollback?", ok: "Clear it", body: "<p>Every bridge takes the newest version by itself again, within a few hours.</p>"});
    if (!a || !a.ok) return;
    await this.control("tally_release_rollback_clear", {p_why: ""}, "The rollback is cleared; the bridges update themselves again.");
  },
  // round 4, item 23: an owner withdraws a version on trial or approved (a reason is required; the cloud's beat gives it
  // to no computer any more; a new pilot of it is allowed)
  async releaseWithdraw(v){
    const a = await askConfirm({title: "Withdraw version " + v + "?", ok: "Withdraw it",
      body: "<p>No computer of the firm gets FinCom Bridge " + esc(v) + " from FinCom\u2019s cloud any more; the ones running it keep running. It can be tried on one computer again later.</p>" +
        '<div class="bk-form one"><label><span>Why (kept with the version, shown on this page)</span><input id="withdrawWhy" maxlength="500" placeholder="What went wrong"></label></div>',
      read: () => ({why: ((document.getElementById("withdrawWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say why the version is withdrawn."});
    if (!a || !a.ok) return;
    await this.control("tally_release_withdraw", {p_version: v, p_why: a.data.why}, "Version " + v + " is withdrawn.");
  },
  // item 10: an owner clears "needs a fresh baseline" on a book (with a note); the bridge reads the company afresh
  async baselineClear(book, company){
    const a = await askConfirm({title: "Clear the baseline of " + company + "?", ok: "Clear it",
      body: "<p>FinCom\u2019s cloud stops holding " + esc(company) + " back; the bridge reads the whole company again from Tally at its next round, and the copy here follows it.</p>" +
        '<div class="bk-form one"><label><span>Note (why it is cleared; kept with the book)</span><input id="baselineNote" maxlength="500" placeholder="What happened in Tally"></label></div>',
      read: () => ({note: ((document.getElementById("baselineNote") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    await this.control("tally_baseline_clear", {p_book: book, p_note: (a.data && a.data.note) || ""}, "The baseline of " + company + " is cleared; the bridge reads it afresh.");
  },
  // "Make this the main bridge": an owner, asked first; tally-ingest gives postings only to it from then on, tells the
  // bridge (its next heartbeat) to switch itself over, which stops bridge 1.15.0 on that computer
  async makeMain(r){
    const others = this.bridgesHeard().filter(x => x.device.id === r.device.id && x.id !== r.id);
    const ok = await askConfirm({title: "Make this the main bridge?", ok: "Make it the main bridge",
      body: "<p><b>FinCom Bridge " + esc(r.version) + "</b> on <b>" + esc(r.computer) + "</b>" + (r.user ? " (Windows user " + esc(r.user) + ")" : "") + " will read Tally <b>and post</b> to it.</p>" +
        (others.length ? "<p>" + others.map(x => "Bridge " + esc(x.version || "?") + (x.user ? " of " + esc(x.user) : "")).join(", ") + " on this computer stops posting at once: FinCom gives postings to the main bridge only. " +
          "Within a minute the new bridge also stops any older bridge for its Windows user and takes over its pairing, settings and copy of the books.</p>" : "") +
        "<p>Only one bridge may ever post to Tally.</p>"});
    if (!ok) return;
    try {
      await Cloud.rpc("tally_bridge_make_main", {p_device: r.device.id, p_bridge: r.id});
      toast("Done. FinCom Bridge " + r.version + " on " + r.computer + " is the main bridge; it switches over within a minute.");
    } catch (e){
      const m = String((e && e.message) || e);
      toast(/tally_bridge_make_main|does not exist|schema cache/i.test(m) ? "FinCom's cloud is not ready for this yet (migration-22 is not applied)." : m);
    }
    await this.refreshPane();
  },
  // an install log dropped on the Tally page (a bridge not connected to FinCom yet cannot send its own), for FinCom support
  async sendInstallLog(file){
    const p = this.pane;
    if (!file) return;
    if (file.size > 2 * 1024 * 1024){ p.logSent = {err: "That file is larger than 2 MB; it is not an install log."}; render(); return; }
    p.logSent = {busy: true}; render();
    try {
      const text = await file.text();
      const j = await TCloudUp.post({kind: "install_log", name: file.name, text}, {});
      p.logSent = {ok: true, ref: j.path || "", name: file.name};
    } catch (e){ p.logSent = {err: (e && e.message) || String(e)}; }
    render();
  }
};
if (typeof TCloud === "object") Object.assign(TCloud, acts);
export default acts;
