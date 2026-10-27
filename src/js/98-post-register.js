/* @react-lazy: begin 98-post-register.js (the React app loads this file with Post to Tally, Bank and Post automatically, and the bill page fetches it: app/src/screens/Post.jsx, Bank.jsx, Bill.jsx, app/src/lib/autopost.js) */
/* ================================================================== */
/* The posting register: one record per entry sent to Tally            */
/* (build stabilisation step 3, approved by the owner on 26-Oct-2026)  */
/* ================================================================== */
// FinCom's cloud keeps ONE record per entry FinCom sends to Tally (tally_post_register, migration 111), with one state:
// queued, sent, in_tally, refused, needs_review, released. The cloud alone decides it (Tally's reply by the 7.2 proof's rule,
// the recorder's TDSDesk tag, the Day Book, a person's Mark posted / Not in Tally); this page only reads it. When the cloud
// has the register, the Post page's tabs and counts (postJobStates, postBucket, postStatus), the "Posted to Tally" stamp of a
// bill or bank line (postMarkFor, Bank.jsx) and the marking of finished postings (postReconcile) read their state from it;
// without it (an older cloud, the table not readable) every one of them works as before. Kept out of legacy.js (its size
// budget, tests/run_stability.py): callers in src/js/59, 62 and 96 check that these names exist.
const PostReg = {
  by: {}, readable: null, busy: {}, missingAt: 0,
  COLS: "fincom_id,entry_id,kind,company,state,master_id,id_inferred,vch_type,vch_no,vch_date,amount,tally_words,job_id,source,changed_by,changed_at,queued_at,sent_at,settled_at",
  // the client's postings as this page knows them: a new posting, or a posting's change, reads the register again
  key(cid){ return (typeof CloudJobs === "object" ? CloudJobs.forClient(cid) : []).map(j => j.id + ":" + j.status + ":" + (j.updated_at || "")).join(","); },
  missing(m){ return /\b(42P01|PGRST205|PGRST202|404)\b|does not exist|schema cache/i.test(String(m || "")); },
  async load(cid, force){
    if (!cid || typeof TCloud !== "object" || !TCloud.on() || this.busy[cid]) return;
    if (this.readable === false && Date.now() - this.missingAt < 600000 && !force) return;
    const s = this.by[cid], key = this.key(cid);
    // speed round (27-Oct-2026): a posting's change (CloudJobs, live) reads it at once; else every 5 minutes while seen
    if (!force && s && s.key === key && (Date.now() - s.at < SLOW_MS || !pollOk())) return;
    this.busy[cid] = true;
    try {
      const rows = [].concat(await TCloud.restAll("tally_post_register?select=" + this.COLS + "&client_id=eq." + encodeURIComponent(cid) + "&order=changed_at.desc") || []);
      const m = new Map();
      rows.forEach(r => { [r.entry_id, r.fincom_id].filter(Boolean).forEach(k => { if (!m.has(String(k))) m.set(String(k), r); }); });
      const sg = JSON.stringify(rows.map(r => [r.fincom_id, r.state, r.master_id, r.id_inferred, r.source, r.changed_at, r.job_id]));
      const changed = !s || s.sg !== sg;
      this.by[cid] = {at: Date.now(), key, m, rows, sg}; this.readable = true;
      if (changed && typeof render === "function") render();
    } catch (e){
      if (this.missing((e && e.message) || e)){ this.readable = false; this.missingAt = Date.now(); delete this.by[cid]; }
      else if (s) s.at = Date.now();
    } finally { delete this.busy[cid]; }
  },
  // the two owner actions by FinCom id, for an entry with no bill here (a bank line, a sales invoice): the cloud maps them
  // onto the existing ones (55: Mark posted; Not in Tally = the bridge looks in Tally first)
  async markPosted(cid, x){
    const no = (x.d && x.d.no) || x.id;
    const a = await askConfirm({title: "Mark " + no + " as posted in Tally?", ok: "Mark posted",
      body: "<p>You saw this entry in Tally. FinCom records it as posted, with who marked it and when; nothing is sent to Tally.</p>" +
        '<div class="bk-form one"><label><span>Tally id</span><input id="regVch" maxlength="20" inputmode="numeric" placeholder="Digits only, as Tally shows it"></label>' +
        '<label><span>Reason (kept with your name)</span><input id="regNote" maxlength="300" placeholder="Where you saw it in Tally"></label></div>',
      read: () => ({vch: ((document.getElementById("regVch") || {}).value || "").trim(), note: ((document.getElementById("regNote") || {}).value || "").trim()}),
      validate: d => !d || !/^\d+$/.test(d.vch) ? "Type Tally's id for this entry, digits only (for example 26301)." : d.note ? "" : "Say where you saw it in Tally (kept with your name and the time)."});
    if (!a || !a.ok) return;
    return this.call(cid, "tally_post_register_mark_posted", {p_fincom_id: String(x.reg.fincom_id), p_vch: a.data.vch, p_note: a.data.note}, no + " is marked posted.");
  },
  async release(cid, x){
    const no = (x.d && x.d.no) || x.id;
    const a = await askConfirm({title: no + ": not in Tally?", ok: "Not in Tally – post again", danger: true,
      body: "<p>Before anything is sent, the FinCom Bridge looks in Tally for this entry. If it is there, it is marked posted with Tally’s id; if it is not, a person confirms and it is sent again, once. Your name, the time and the reason are kept.</p>" +
        '<div class="bk-form one"><label><span>Reason (what you saw in Tally)</span><input id="regWhy" maxlength="500" placeholder="Not in the Day Book of …"></label></div>',
      read: () => ({why: ((document.getElementById("regWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say what you saw in Tally."});
    if (!a || !a.ok) return;
    return this.call(cid, "tally_post_register_release", {p_fincom_id: String(x.reg.fincom_id), p_why: a.data.why}, "The FinCom Bridge looks in Tally first; " + no + " is sent again only if it is not there.");
  },
  async call(cid, fn, args, done){
    try {
      const r = await TCloud.rpc(fn, args);
      if (r && r.ok === false) throw new Error(r.error || "It was not done.");
      toast(done);
    } catch (e){ toast(this.missing((e && e.message) || e) ? "FinCom’s cloud is not ready for this yet (migration 111)." : String((e && e.message) || e).replace(/^ERROR:\s*/i, "")); }
    if (typeof PostChecks === "object") PostChecks.load(cid, true);
    if (typeof CloudJobs === "object") await CloudJobs.load(true);
    await this.load(cid, true);
    if (typeof render === "function") render();
  }
};
// the register for a client is here (read once at least): true / false
function postRegOn(cid){ if (cid) PostReg.load(cid); return PostReg.readable === true && !!(cid && PostReg.by[cid]); }
// one entry's record: the row, null (the register has none for it), or undefined (no register here: decide as before)
function postRegOf(cid, id){ if (!postRegOn(cid)) return undefined; return PostReg.by[cid].m.get(String(id)) || null; }
// the posting a record names: the one this page has, else a stand-in with what the register says
function postRegJob(cid, r){
  const j = typeof CloudJobs === "object" ? (CloudJobs.list || []).find(k => k.id === r.job_id) : null;
  if (j) return j;
  const st = {queued: "waiting", sent: "running", refused: "failed"}[r.state] || "done";
  return {id: r.job_id, client_id: cid, company: r.company || "", status: st, created_at: r.queued_at, updated_at: r.changed_at, results: [], items: [], stub: true};
}
// postJobStates (src/js/59) from the register: id -> {st, job, reason, reg}; null without the register
const POST_REG_ST = {queued: "sending", sent: "sending", in_tally: "posted", needs_review: "review", refused: "refused", released: ""};
function postRegStates(cid){
  if (!postRegOn(cid)) return null;
  const out = new Map();
  PostReg.by[cid].rows.forEach(r => {
    const id = String(r.entry_id || r.fincom_id);
    if (out.has(id)) return;
    out.set(id, {st: POST_REG_ST[r.state] || "", job: postRegJob(cid, r), reason: r.tally_words || "", reg: r});
  });
  return out;
}
// postBucket (src/js/59) from the register; null: decided as before (a refusal older than the bill's approval, a release)
function postRegBucket(e, js){
  const r = js.reg;
  if (r.state === "in_tally") return "intally";
  if (r.state === "queued" || r.state === "sent") return "sending";
  if (r.state === "needs_review") return "review";
  if (r.state === "refused" && String(r.queued_at || "") >= String(e.approvedAt || "")) return "refused";
  return null;
}
// a result shaped as the bridge's, from a record in Tally (postReconcile marks the bill or bank line with it)
function postRegResult(r){
  const own = !r.id_inferred && r.master_id ? r.master_id : "";
  return {id: String(r.entry_id || r.fincom_id), ok: true, verified: r.source !== "reply", byReply: r.source === "reply", vchId: own, masterId: own, vchNumber: r.vch_no || "",
    vchGuess: r.id_inferred ? r.master_id || "" : "", inferred: !!r.id_inferred, vchType: r.vch_type || "", vchDate: String(r.vch_date || "").replace(/-/g, ""), company: r.company || "",
    sentAt: r.sent_at || r.changed_at || "", register: r.state};
}
// the "Posted to Tally" stamp from the register: a mark (in_tally), null (not in Tally: no stamp), undefined (no register)
function postRegMark(cid, id){
  const r = postRegOf(cid, id);
  if (r === undefined) return undefined;
  if (!r) return undefined;
  if (r.state !== "in_tally") return null;
  const by = r.source === "owner" && r.changed_by && typeof memberName === "function" ? memberName(r.changed_by) : "";
  const vch = r.master_id ? r.master_id + (r.id_inferred ? " (inferred from the batch)" : "") : r.vch_no ? "not given (voucher no. " + r.vch_no + ")" : "not given";
  return {vch, company: r.company || "", at: r.settled_at || r.changed_at || "", by, job: r.job_id || "", register: r.source};
}
// one line for a bank line not in Tally by the register: "" when there is no record (or it is in Tally: the stamp says it)
function postRegLine(cid, id){
  const r = postRegOf(cid, id);
  if (!r || r.state === "in_tally") return "";
  const w = typeof postReasonText === "function" ? postReasonText(r.tally_words) : String(r.tally_words || "");
  return {queued: "Waiting to be sent to Tally", sent: "With the Tally computer now", needs_review: "Needs review: " + (w || "the outcome in Tally is not known") + " · settle it on Post to Tally",
    refused: "Refused by Tally: " + (w || "Tally did not take it"), released: "Not in Tally (released" + (w ? ": " + w : "") + ")"}[r.state] || "";
}
// postStatus (src/js/62) from the register; undefined: decided as before. mk and tid are postStatus's own
function postRegStatus(r, e, job, mk, tid, ctx){
  const bill = !!(e && e.x), deleted = (bill && e.status === "deleted") || ctx.missing === true, backInReview = bill && !["approved", "deleted"].includes(e.status);
  const when = t => (typeof fmtIST === "function" ? fmtIST(t) : String(t || "")) || "";
  const who = u => !u ? "" : ctx.me && u === ctx.me ? "you" : typeof memberName === "function" ? memberName(u) || "a member" : "a member";
  // the Tally id is the register's alone (never a batch's last id the bridge put on every voucher of a request)
  const id = r.master_id ? {vch: r.master_id, inferred: !!r.id_inferred, ids: [r.master_id]} : {ids: []};
  const idSay = r.master_id ? "Tally id " + r.master_id + (r.id_inferred ? " (inferred from the batch's last id)" : "") : "";
  const at = r.settled_at || r.sent_at || r.changed_at || "";
  const words = typeof postReasonText === "function" ? postReasonText(r.tally_words) : String(r.tally_words || "");
  const again = {kind: "postAgain", label: "Post again"};
  const more = {id, posted: at, reg: r};
  switch (r.state){
    case "queued": return mk(4, "In the queue: waiting for the Tally computer to take it.", job.status === "waiting" && !job.stub ? {kind: "cancel", label: "Cancel"} : null, more);
    case "sent": return mk(5, "Tally is taking it now. Nothing to do.", null, more);
    case "in_tally":
      if (deleted) return mk(10, (idSay ? idSay + ". " : "") + (ctx.missing ? "The bill is no longer in FinCom, so there is nothing to restore. The entry stays in Tally." : "Restore the bill in FinCom to keep its record with the entry in Tally."), ctx.missing ? null : {kind: "restore", label: "Restore the bill"}, more);
      if (r.source === "owner") return Object.assign(mk(3, "Marked posted by " + (who(r.changed_by) || "a member") + (r.changed_at ? " on " + when(r.changed_at) : "") + (r.master_id ? "; Tally id " + r.master_id : "") + (words ? " (" + words + ")" : "") + ".", null, more), {words: "Posted, marked by " + (who(r.changed_by) || "a member")});
      if (r.source !== "reply") return mk(2, "Nothing to do. FinCom found it in Tally" + (r.master_id ? " (Tally id " + r.master_id + ")" : "") + " " + ({recorder: "from Tally's own line", daybook: "in the Day Book", bridge: "by the FinCom Bridge's check"}[r.source] || "") + " on " + when(r.changed_at) + ".", null, more);
      return mk(1, (idSay ? idSay + ". " : "") + "Nothing to do.", null, more);
    case "needs_review": {
      const ns = ctx.check && ctx.check.state === "notseen" ? ctx.check : null, ck = ctx.check && ctx.check.state === "waiting" ? ctx.check : null;
      const settle = {kind: "settle", label: "It is in Tally: mark posted (Tally id)"};
      const why = {id: "review", reason: "Tally’s reply needs a look", fix: ""};
      if (ns) return mk(6, (postReasonText(ns.words) || "Tally has no such voucher on that day. Look in Tally; if it is not there, press ‘I looked in Tally: not there – post again’ (reason required).") + (ns.checked_at ? " (The FinCom Bridge looked on " + when(ns.checked_at) + ".)" : ""), settle, Object.assign({reason: why, accepted: true, notSeen: ns}, more));
      if (ck) return mk(6, "Checking Tally before it is sent again: " + (postReasonText(ck.last_words) || "waiting for the FinCom Bridge to look in Tally") + ". Asked by " + (who(ck.asked_by) || "a member") + (ck.asked_at ? " on " + when(ck.asked_at) : "") + (ck.why ? " (" + ck.why + ")" : "") + ". Nothing is sent until the bridge finds it is not there.", settle, Object.assign({reason: why, accepted: true, check: ck}, more));
      return mk(6, (words ? "Tally’s words: " + words + ". " : "The outcome in Tally is not known. ") + "Look in Tally’s Day Book" + (bill && e.x.invoiceDate ? " for " + (typeof fmtDate === "function" ? fmtDate(e.x.invoiceDate) : e.x.invoiceDate) : "") + ": if it is there, mark it posted; if not, press Not in Tally – post again (the FinCom Bridge looks in Tally first).",
        settle, Object.assign({reason: why, accepted: true}, more));
    }
    case "refused": {
      if (backInReview) return null;
      const why = (typeof postReasonFor === "function" && postReasonFor(words || "Tally did not take it", job.client_id)) || {reason: words || "Tally did not take it", fix: "", again: true};
      return mk(why.kind === "stopped" ? 8 : 7, why.reason + ". " + (why.fix || ""), bill && !deleted && !e.exportedAt && why.again !== false ? again : null, Object.assign({reason: why}, more));
    }
    case "released":
      if (bill && e.status === "approved" && !e.exportedAt) return null;
      return mk(8, (who(r.changed_by) ? who(r.changed_by).replace(/^you$/, "You") + " said it is not in Tally" : "Marked not in Tally") + (r.changed_at ? " on " + when(r.changed_at) : "") + (words ? " (" + words + ")" : "") + ". It can be posted again.",
        deleted || !bill ? null : again, Object.assign({reason: {id: "released", reason: "Not in Tally: released", fix: "It can be posted again."}, released: true}, more));
  }
  return undefined;
}
if (typeof globalThis === "object") Object.assign(globalThis, {PostReg, postRegOn, postRegOf, postRegJob, postRegStates, postRegBucket, postRegResult, postRegMark, postRegLine, postRegStatus});
/* @react-lazy: end */
