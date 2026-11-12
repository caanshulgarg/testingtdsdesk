/* @react-lazy: begin 59-post-owner.js (the React app loads this file with its Post to Tally screen (app/src/screens/Post.jsx): build.py react_parts) */
/* Post to Tally: who holds a posting (was in src/js/59) */
const PostOwner = {
  notReady(m){ return /tally_post_job_mark_posted|tally_post_id_release_owner|tally_post_settle_ask|tally_post_check_withdraw|tally_post_check_confirm|PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(String(m || "")); },
  async call(cid, fn, args, done){
    try {
      const r = await TCloud.rpc(fn, args);
      if (r && r.ok === false) throw new Error(r.error || "It was not done.");
      toast(done);
    } catch (e){
      const m = String((e && e.message) || e);
      toast(this.notReady(m) ? "FinCom\u2019s cloud is not ready for this yet (migration " + (fn === "tally_post_settle_ask" || fn === "tally_post_check_withdraw" || fn === "tally_post_check_confirm" ? "55" : "36b") + ")." : m.replace(/^ERROR:\s*/i, ""));
    }
    if (typeof PostChecks === "object") PostChecks.load(cid, true);
    if (typeof PostMarks === "object") PostMarks.load(cid, true);
    if (typeof CloudJobs === "object") await CloudJobs.load(true);
    if (typeof PostIds === "object") PostIds.load(cid, true);
    render();
  },
  // E (the owner's spec of 04-Oct): the Tally id is Tally's own number, digits only; one the same as the bill number is
  // warned about (asked again), not refused. Without a posting of the cloud (a bill posted straight to a bridge) the mark
  // is kept on the bill here (markLocal). A bill FinCom's copy of Tally did not show is cleared of that once marked.
  idCheck(v){ return !v ? "Type Tally's id for this entry, as Tally shows it." : /^\d+$/.test(v) ? "" : "The Tally id is digits only (for example 26301)."; },
  async sameAsBill(e, v){
    const no = String((e && e.x && e.x.invoiceNo) || "").trim();
    if (!no || no !== v) return true;
    const a = await askConfirm({title: "The Tally id is the same as the bill number", ok: "Use " + v + " anyway",
      body: "<p>" + esc("You typed " + v + ", which is the bill number. Tally's id is the number Tally gives the entry (for example 26301). Use " + v + " anyway?") + "</p>"});
    return !!(a && (a === true || a.ok));
  },
  // why: a reason is required (Mark posted, decision B); a correction carries its own ("Correction: the Tally id is ...")
  async askId(e, title, ok, pre, intro, why){
    why = why !== false;
    const a = await askConfirm({title, ok,
      body: "<p>" + intro + "</p>" +
        '<div class="bk-form one"><label><span>Tally id</span><input id="markVch" maxlength="20" inputmode="numeric" placeholder="Digits only, as Tally shows it" value="' + esc(pre || "") + '"></label>' +
        '<label><span>' + (why ? "Reason (kept with your name)" : "Note (optional)") + '</span><input id="markNote" maxlength="300" placeholder="Where you saw it in Tally"></label></div>',
      read: () => ({vch: ((document.getElementById("markVch") || {}).value || "").trim(), note: ((document.getElementById("markNote") || {}).value || "").trim()}),
      validate: d => this.idCheck(d && d.vch) || (!why || (d && d.note) ? "" : "Say where you saw it in Tally (kept with your name and the time).")});
    if (!a || !a.ok) return null;
    if (!(await this.sameAsBill(e, a.data.vch))) return null;
    return a.data;
  },
  clearGone(cid, e){ if (e && e.x && e.goneFromTally){ delete e.goneFromTally; e.postVerified = true; Store.saveEntry(cid, e); refreshStats(cid); } },
  async markPosted(cid, e, job){
    const no = (e.x && e.x.invoiceNo) || e.id;
    if (!job) return this.markLocal(cid, e);
    const d = await this.askId(e, "Mark " + no + " as posted in Tally?", "Mark posted", "", "You saw this entry in Tally. FinCom records it as posted, with who marked it and when; nothing is sent to Tally.");
    if (!d) return;
    await this.call(cid, "tally_post_job_mark_posted", {p_job: job.id, p_id: String(e.id), p_vch: d.vch, p_note: d.note}, no + " is marked posted.");
    this.clearGone(cid, e);
  },
  // a bill posted straight to a bridge (no posting of the cloud names it): the mark is kept on the bill
  async markLocal(cid, e){
    const no = (e.x && e.x.invoiceNo) || e.id;
    const d = await this.askId(e, "Mark " + no + " as posted in Tally?", "Mark posted", (e.tally && (e.tally.vch || e.tally.masterId)) || "", "You saw this entry in Tally. FinCom records it as posted on this bill, with who marked it and when; nothing is sent to Tally.");
    if (!d) return;
    const now = new Date().toISOString(), me = (S.account && S.account.me) || {};
    e.exportedAt = e.exportedAt || now; e.postVerified = true; e.postedVia = e.postedVia || "bridge"; delete e.goneFromTally;
    e.tally = Object.assign({}, e.tally || {}, {vch: d.vch, byOwner: postMyName() || me.name || "an owner", byOwnerId: me.user_id || "", byOwnerAt: now, byOwnerNote: d.note || "", company: (e.tally && e.tally.company) || postCompanyName(S.companies[cid] || CO())});
    Store.saveEntry(cid, e); refreshStats(cid); toast(no + " is marked posted."); render();
  },
  // F (Jitin & Co. 4861): an owner typed the bill number as the Tally id; the correction is recorded the same way as a mark
  // (tally_post_job_mark_posted: a new row in tally_post_marks, the result's voucher, the id's accepted_vch)
  async correctId(cid, e, job, suggest, was){
    const no = (e.x && e.x.invoiceNo) || e.id;
    const d = await this.askId(e, "Correct the Tally id of " + no, "Correct the Tally id", suggest || "", "The Tally id kept for this entry" + (was ? " (" + esc(was) + ")" : "") + " is not Tally's own id. Type the id Tally shows for it; FinCom keeps the correction with who made it and when. Nothing is sent to Tally.", false);
    if (!d) return;
    const note = ("Correction: the Tally id is " + d.vch + (was ? ", not " + was : "") + (d.note ? " (" + d.note + ")" : "")).slice(0, 300);
    if (!job){
      const me = (S.account && S.account.me) || {};
      e.tally = Object.assign({}, e.tally || {}, {vch: d.vch, corrected: {from: was || "", by: postMyName() || me.name || "", byId: me.user_id || "", at: new Date().toISOString()}});
      Store.saveEntry(cid, e); toast("The Tally id of " + no + " is now " + d.vch + "."); render(); return;
    }
    await this.call(cid, "tally_post_job_mark_posted", {p_job: job.id, p_id: String(e.id), p_vch: d.vch, p_note: note}, "The Tally id of " + no + " is now " + d.vch + ".");
  },
  // the owner's rule (a duplicate entry must never be possible from this button): after the FinCom Bridge did not see the
  // entry on its day ("notseen"), a member who may post looks in Tally and confirms it is not there, a reason required
  // (tally_post_check_confirm: the only way it is released and sent again, that entry alone; name and time kept)
  async confirmNotSeen(cid, e, job){
    if (!job) return;
    const no = (e.x && e.x.invoiceNo) || e.id, co = job.company || "the company";
    const a = await askConfirm({title: no + ": you looked in Tally and it is not there?", ok: "I looked in Tally: not there \u2013 post again", danger: true,
      body: "<p>" + esc("The FinCom Bridge did not see this entry in " + co + " on its date, but it cannot see other dates. Confirm only after looking in Tally (Day Book, or search the narration TDSDesk:" + String(e.id) + "). It is then sent again, once; your name, the time and the reason are kept.") + "</p>" +
        '<div class="bk-form one"><label><span>Reason (where you looked in Tally)</span><input id="confirmWhy" maxlength="500" placeholder="Searched TDSDesk:\u2026 in the Day Book"></label></div>',
      read: () => ({why: ((document.getElementById("confirmWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say where you looked in Tally."});
    if (!a || !a.ok) return;
    return this.call(cid, "tally_post_check_confirm", {p_job: job.id, p_id: String(e.id), p_why: a.data.why}, no + " is sent again, once.");
  },
  // migration 174 (fifth review M2): an owner's own "I checked in Tally: not there" when no check can be answered (the
  // bridge that took the posting is gone): a reason required, kept with the name and the time; no bridge looks first
  async ownerNotThere(cid, e, job){
    if (!job) return;
    const no = (e.x && e.x.invoiceNo) || e.id;
    const a = await askConfirm({title: no + ": you checked in Tally and it is not there?", ok: "I checked in Tally: not there", danger: true,
      body: "<p>" + esc("No FinCom Bridge looks first. If it is in Tally, it will be posted twice. Confirm only after looking in Tally (Day Book, or search the narration TDSDesk:" + String(e.id) + "); your name, the time and the reason are kept.") + "</p>" +
        '<div class="bk-form one"><label><span>Reason (where you looked in Tally)</span><input id="ownerWhy" maxlength="400" placeholder="Searched TDSDesk:\u2026 in the Day Book"></label></div>',
      read: () => ({why: ((document.getElementById("ownerWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say where you looked in Tally."});
    if (!a || !a.ok) return;
    if (typeof auditEvent === "function") auditEvent("post_owner_not_there", no + ": " + a.data.why, cid);
    return this.call(cid, "tally_post_owner_release", {p_job: job.id, p_id: String(e.id), p_why: a.data.why}, no + " is released; it can be posted again.");
  },
  // the final review of 2.3.0 (M2): the member who asked for a check, or an owner, withdraws it while it waits
  // (tally_post_check_withdraw: who, when and why kept); nothing is released or sent
  async withdrawCheck(cid, ck){
    if (!ck || !ck.id) return;
    const a = await askConfirm({title: "Withdraw the check?", ok: "Withdraw the check",
      body: "<p>The FinCom Bridge stops looking in Tally for this entry. Nothing is released or sent; your name and the time are kept.</p>" +
        '<div class="bk-form one"><label><span>Reason (optional)</span><input id="withdrawWhy" maxlength="300" placeholder="Found it in Tally myself"></label></div>',
      read: () => ({why: ((document.getElementById("withdrawWhy") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    return this.call(cid, "tally_post_check_withdraw", {p_check: ck.id, p_why: (a.data && a.data.why) || ""}, "The check is withdrawn; nothing was released or sent.");
  },
  // decision B (05-Oct-2026): "Not in Tally - post again", any member who may post, a reason required. With a posting of
  // FinCom's cloud: tally_post_settle_ask (migration 55): the FinCom Bridge looks in that company in Tally first; found:
  // marked posted with the voucher found; not there: released and sent again, once; Tally not reachable: it waits and
  // looks again by itself. Nothing is sent from here. Without one (a bill posted straight to a bridge): undone here
  async release(cid, e, job){
    const no = (e.x && e.x.invoiceNo) || e.id;
    const co = (job && job.company) || "the company";
    const a = await askConfirm({title: no + ": not in Tally, post it again?", ok: "Not in Tally \u2013 post again", danger: true,
      body: "<p>" + (job ? "Before anything is sent, the FinCom Bridge looks in " + esc(co) + " in Tally for this entry. If it is there, it is marked posted with Tally\u2019s id; if it is not, it is sent again, once. If Tally cannot be asked now, it waits and looks again by itself. Your name, the time and the reason are kept."
          : "You looked in Tally and this entry is not there. FinCom undoes its posted mark so it can be posted again; the reason is kept with the entry. Nothing is sent to Tally now.") + "</p>" +
        '<div class="bk-form one"><label><span>Reason (what you saw in Tally)</span><input id="releaseWhy" maxlength="500" placeholder="Not in the Day Book of …"></label></div>',
      read: () => ({why: ((document.getElementById("releaseWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say what you saw in Tally."});
    if (!a || !a.ok) return;
    if (job) return this.call(cid, "tally_post_settle_ask", {p_job: job.id, p_id: String(e.id), p_why: a.data.why}, "The FinCom Bridge looks in " + co + " in Tally first; " + no + " is sent again only if it is not there.");
    if (!job){
      e.postUndo = {why: a.data.why, at: new Date().toISOString(), by: postMyName()};
      e.exportedAt = null; e.postVerified = false; e.postByReply = false; e.postUnconfirmed = null; e.postError = ""; e.postCheckFailed = null; delete e.goneFromTally;
      Store.saveEntry(cid, e); refreshStats(cid); toast(no + ": the posted mark is undone; it can be posted again."); render(); return;
    }
  }
};
if (typeof PostOwner !== "undefined") globalThis.PostOwner = PostOwner;
// (each name only when declared: a test's harness loads a file's names one by one, tests/harness.js)
/* @react-lazy: end */
