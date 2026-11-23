// The Tally page's owner actions (were TCloud's in src/js/49-tally-cloud.js; moved here by next-fast-open, 20-Oct-2026,
// to keep legacy.js within its 600 KB budget). Only the Tally page (app/src/screens/Tally.jsx) calls them; they are put on
// TCloud when that page's code loads, and use legacy.js's globals (TCloud, Cloud, TCloudUp, askConfirm, esc, toast, render).
/* global TCloud, Cloud, TCloudUp, askConfirm, esc, toast, render, num */
const acts = {
  // (moved from src/js/49-tally-cloud.js by the audit of 22-Nov-2026, as they were)
  // an owner switches a bridge to changes only (it never takes a posting) or back -> tally_bridge_changes_only
  async changesOnly(r, on){
    if (on){
      const a = await askConfirm({title: "Changes only for " + this.bridgeWords(r) + "?", ok: "Changes only",
        body: "<p>This bridge keeps reading Tally\u2019s changes for FinCom but is never given a posting, and the Post screen never offers it. A posting it is running now finishes.</p>"});
      if (!a || !a.ok) return;
    }
    await this.control("tally_bridge_changes_only", {p_device: r.device.id, p_bridge: r.id, p_on: !!on},
      (on ? "Changes only: " : "Posting allowed again: ") + this.bridgeWords(r) + ".");
  },
  // Fix 2b: an owner releases a bridge's identity: the next computer that reports the id gets it (kept with who, when, why)
  async releaseIdentity(r){
    const a = await askConfirm({title: "Release the identity of " + this.bridgeWords(r) + "?", ok: "Release it",
      body: "<p>FinCom keeps bridge " + esc(r.id) + " tied to the computer key that reported it first. Released, the next computer that reports this id gets it. Who released it, when and why are kept.</p>" +
        '<div class="bk-form one"><label><span>Why (kept with the release)</span><input id="releaseWhy" maxlength="300" placeholder="e.g. the computer was set up again"></label></div>',
      read: () => ({why: ((document.getElementById("releaseWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say why the identity is released."});
    if (!a || !a.ok) return;
    await this.control("tally_bridge_reset", {p_bridge: r.id, p_why: a.data.why}, "The identity of " + this.bridgeWords(r) + " is released; the next computer that reports it gets it.");
  },
  // an owner links a member to the bridge they post through (r null: unlinked) -> tally_member_bridge_link
  async linkMember(uid, r){
    const m = ((typeof Cloud === "object" && Cloud.st.members) || []).find(x => x.user_id === uid), who = (m && (m.name || m.email)) || "The member";
    await this.control("tally_member_bridge_link", {p_user: uid, p_device: r ? r.device.id : null, p_bridge: r ? r.id : null},
      r ? who + " now posts through " + this.bridgeWords(r) + "." : who + " is no longer linked to a bridge.");
  },
  // round 15 (F3): the posting settings of a computer, saved by an owner -> tally_device_post_settings(p_device, p_post_only
  // (names; [] = any company), p_bills, p_bank (1..500)); the bridge applies them at its next heartbeat (info.beat.postOnly,
  // postBatchBills, postBatchBank, settingsAt). Checked here first: the words stay on the line, nothing is sent
  postSettingsCheck(v){
    const n = k => { const x = Math.floor(num(v[k])); return x >= 1 && x <= 500 ? x : null; };
    if (!n("bills")) return "Bills per request must be a number from 1 to 500.";
    if (!n("bank")) return "Bank lines per request must be a number from 1 to 500.";
    return "";
  },
  postSettingsNames(text){ const seen = new Set(); return String(text || "").split(/[,\n;]/).map(x => x.trim()).filter(x => x && !seen.has(x.toUpperCase()) && seen.add(x.toUpperCase())).slice(0, 20); },
  // v.only0 is the names box as the editor opened: left as it was, p_post_only goes as null (the row's list, and an
  // installer-set PostOnly, stay); emptied from a named list, the owner is asked first (review of 2.1.8, must-fix)
  async postSettings(dev, v){
    const why = this.postSettingsCheck(v);
    if (why) return why;
    const names = this.postSettingsNames(v.only), was = this.postSettingsNames(v.only0), touched = JSON.stringify(names) !== JSON.stringify(was);
    if (touched && !names.length && was.length){
      const a = await askConfirm({title: "Posting to any company from this computer?", ok: "Yes, any company", danger: true,
        body: "<p>" + esc(dev.name || "This computer") + " now posts only to " + esc(was.join(", ")) + ". With the list empty, FinCom Bridge there posts into whichever Tally company a client is set to, and the list set by its installer goes.</p>"});
      if (!a || !a.ok) return "Nothing sent: the list stays as it was.";
    }
    await this.control("tally_device_post_settings", {p_device: dev.id, p_post_only: touched ? names : null, p_bills: Math.floor(num(v.bills)), p_bank: Math.floor(num(v.bank))},
      "Saved for " + (dev.name || "the computer") + "; the bridge applies it within a minute.");
    return "";
  },
  // round 19: an owner switches the trial tools of one computer on or off -> tally_device_trial_tools(p_device, p_on)
  // (migration 46; owner only there too); the bridge applies it at its next heartbeat (within 30 seconds)
  async trialTools(dev, on){
    await this.control("tally_device_trial_tools", {p_device: dev.id, p_on: !!on},
      "Trial tools " + (on ? "on" : "off") + " for " + (dev.name || "the computer") + "; the bridge applies it within 30 seconds.");
  },
  // round 20 (d.3): an owner picks where a computer's changes come from -> tally_device_recorder_source(p_device,
  // p_source) (migration 47; owner only there too); the bridge takes it from its next heartbeat's answer
  RECORDER_SOURCES: [["addon", "the add-on"], ["alterid", "Tally’s change list"], ["both", "both"]],
  async recorderSource(dev, src){
    const w = (this.RECORDER_SOURCES.find(x => x[0] === src) || [])[1];
    if (!w) return;
    await this.control("tally_device_recorder_source", {p_device: dev.id, p_source: src},
      "Changes on " + (dev.name || "the computer") + " now come from " + w + "; the bridge takes it within 30 seconds.");
  },
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
