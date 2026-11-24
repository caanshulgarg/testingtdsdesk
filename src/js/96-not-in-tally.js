/* @react-lazy: begin 96-not-in-tally.js (the React app loads this file with the Sales, Bank and purchase bill screens) */
// next-fix-reupload-posted (24-Nov-2026; the owner's rules: an entry that is not really in the books never counts as
// posted; "dont read from tally"; FinCom does what it needs itself on the button press). A sales invoice FinCom posted as an
// Optional voucher was deleted in Tally and posted again: FinCom's cloud held its FinCom id for the earlier posting
// (migration 184: not queued again), the page took that posting's old answer for a new one and called it "Posted" today,
// and nothing was sent.
//
// Now an entry an earlier posting holds is decided by FinCom's own copy of Tally (tally_vouchers, by the entry's FinCom
// id), by the cloud itself (migration 219, tally_post_copy_resend), never by asking Tally:
//   only deleted, Optional or cancelled vouchers there: the id released (an owner's release, the copy's state as the
//     reason) and the earlier posting handed back to send that entry alone; the posting computer's record lets it go once;
//   a regular voucher there: In Tally (posted before); nothing is sent;
//   nothing there, the copy not up to date since the posting's send or Tally's acceptance newer than its deletion
//     ("unsure": a stale copy never releases an entry that may be in Tally), or the cloud cannot answer yet: said plainly,
//     in the cloud's own words; nothing is sent.
// On the Post press (salesEarlier from postSalesRun; postEarlier from the bills' and bank lines' posting), and by "Not in
// Tally? Post again" on a posted invoice, bill or bank line (the same rule, for one marked posted before this). The review
// of 24-Nov-2026: Posted only when the copy has it as a regular entry, or when that earlier posting was taken by Tally and
// the copy has nothing of it; otherwise the entry keeps its state with the words as its red note (a failed earlier
// posting is never called posted). A client posting Optional vouchers by its setting: the Optional voucher IS the
// posting, so nothing is asked and nothing sent again.
const NotInTally = {
  busy: {},
  LABEL: "Not in Tally? Post again",
  on(id){ return !!this.busy[String(id)]; },
  // an entry whose Optional voucher is its posting: one posted as an Optional voucher (x.postedOptional), or of a client
  // whose entries go to Tally as Optional vouchers by its setting (Client setup): bills and invoices (createOptional),
  // bank lines their own (bankOptional, src/js/22 bankVoucherXml)
  optional(co, kind, x){ return !!((x && x.postedOptional) || (co && (kind === "bank" ? co.bankOptional : co.createOptional))); },
  fid(id){ return String(id || "").replace(/[^A-Za-z0-9]/g, ""); },
  // the posting that holds the entry's FinCom id (live), else ""
  async holder(co, fid){
    const rows = await Cloud.api("tally_post_ids?select=job_id&live=is.true&client_id=eq." + encodeURIComponent(co.id) + "&fincom_id=eq." + encodeURIComponent(fid));
    return String(([].concat(rows || [])[0] || {}).job_id || "");
  },
  // the cloud decides by its copy: {state: optional|deleted|cancelled (sent again), there, none, elsewhere, busy, blocked,
  // notready, unable; resent, vno, vtype, day, words}; when: when FinCom posted it (the words when the copy cannot tell)
  async resend(job, id, kind, when){
    let r;
    try { r = await TCloud.rpc("tally_post_copy_resend", {p_job: job, p_id: String(id)}); }
    catch (e){
      const m = String((e && e.message) || e);
      if (/tally_post_copy_resend|PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(m)) return {state: "notready", words: "FinCom can't check this yet. Nothing was sent."};
      return {state: "unable", words: "FinCom's cloud did not answer (" + plainMsg(m) + "), so nothing was sent."};
    }
    r = r || {};
    const st = String(r.state || (r.ok ? "optional" : "unable"));
    const what = {deleted: "FinCom's copy of Tally shows it deleted in Tally", optional: "FinCom's copy of Tally has it only as an Optional voucher", cancelled: "FinCom's copy of Tally has it only as a cancelled voucher"}[st];
    let words;
    if (r.resent) words = what + ": sent again. It posts by itself; FinCom marks it when Tally answers.";
    else if (r.released) words = what + ": " + (plainMsg(r.error) || "released, not sent yet.");
    // (polish 2) the copy cannot tell: said once, never "not sent again" beside "can't tell"
    else if (st === "none") words = (when ? "Posted by FinCom on " + fmtDate(String(when).slice(0, 10)) + ". FinCom's copy of Tally doesn't show it" : "FinCom's copy of Tally doesn't show this " + (kind || "entry")) + ", so it can't tell if it is still there. Nothing was sent.";
    else if (st === "there") words = "In Tally (FinCom's copy: " + [r.vtype, r.vno ? "no. " + r.vno : "", r.day ? "of " + fmtDate(String(r.day).slice(0, 10)) : ""].filter(Boolean).join(" ") + "), posted before by FinCom; nothing was sent.";
    else words = plainMsg(r.error) || "Nothing was sent.";
    return Object.assign({}, r, {state: st, words});
  },
  // one entry marked posted (a button): the posting that holds it, then the cloud's decision; o: {co, id, fid, kind, what,
  // entry (its postedOptional), when (when FinCom posted it), sent(r), there(r)}
  async run(o){
    const k = String(o.id);
    if (this.busy[k]) return null;
    if (this.optional(o.co, o.kind === "bank line" ? "bank" : "", o.entry)){ toast("This client posts Optional vouchers by its setting, so the Optional voucher in Tally is the posting itself. Nothing was sent."); return null; }
    if (!(typeof TCloud === "object" && TCloud.on() && TCloud.has(o.co.id))){ toast("FinCom keeps no copy of this client's Tally books, so it cannot tell whether " + o.what + " is in Tally. Nothing was sent."); return null; }
    this.busy[k] = true; render();
    try {
      let job = "";
      try { job = await this.holder(o.co, o.fid || this.fid(o.id)); } catch (e){ toast("FinCom's cloud could not be read (" + plainMsg(e.message) + "). Nothing was sent."); return null; }
      if (!job){ toast("No posting of FinCom holds " + o.what + " now, so there is nothing to release. Nothing was sent."); return null; }
      const r = await this.resend(job, o.id, o.kind, o.when);
      if (r.resent && o.sent) o.sent(r, job);
      if (r.state === "there" && o.there) o.there(r);
      toast(o.what.charAt(0).toUpperCase() + o.what.slice(1) + ": " + r.words);
      return r;
    } finally { delete this.busy[k]; render(); }
  }
};
const salesWhen = (r) => { const t = Date.parse((r && r.sentAt) || ""); return t ? new Date(t).toISOString() : ""; };
// what the Post press does with an entry an earlier posting holds (r: that posting's answer; d: the cloud's decision, or
// null for a client posting Optional vouchers by its setting): sent (queued on that posting again), posted (posted before:
// in Tally by the copy, or Tally took that posting and the copy has nothing of it), or keep (its state kept, the words as
// its red note: that posting's own words when it failed)
function earlierWay(r, d){
  if (d && d.resent) return {way: "sent", words: d.words};
  if (d && d.state === "there") return {way: "posted", there: true, words: d.words};
  if ((!d || d.state === "none") && r && r.ok && postTaken(r)) return {way: "posted", words: d ? d.words : ""};
  return {way: "keep", words: (r && !r.ok && plainMsg(r.message)) || (d && d.words) || "Not sent again."};
}
// the words of the Post press for those entries (n: {sent, there, posted, keep}), plain and counted
function earlierLine(n, what){
  const c = k => n[k] + " " + what + (n[k] === 1 ? " was" : "s were");
  return [n.sent ? c("sent") + " posted before by FinCom and " + (n.sent === 1 ? "is" : "are") + " not in the books: sent again, " + (n.sent === 1 ? "it posts" : "they post") + " by " + (n.sent === 1 ? "itself" : "themselves") : "",
    n.there ? c("there") + " posted before by FinCom and " + (n.there === 1 ? "is" : "are") + " in Tally: not sent again" : "",
    n.posted ? c("posted") + " posted before by FinCom and not sent again" : "",
    n.keep ? n.keep + " not sent: see the red note on " + (n.keep === 1 ? "it" : "each") : ""].filter(Boolean).join("; ");
}
// the Post press (sales): the invoices an earlier posting holds ([invoice, that posting's answer]); returns the words
async function salesEarlier(early, co){
  const n = {sent: 0, there: 0, posted: 0, keep: 0};
  for (const [v, r] of early){
    const opt = NotInTally.optional(co, "", v), d = opt ? null : await NotInTally.resend(r.earlier, v.id, "invoice", salesWhen(r)), w = earlierWay(r, d);
    n[w.there ? "there" : w.way]++;
    if (w.way === "sent"){ v.postJob = r.earlier; v.postError = w.words; v.postNote = ""; delete v.postWhy; }
    else if (w.way === "posted"){
      v.status = "posted"; v.postedAt = salesWhen(r) || v.postedAt || new Date().toISOString(); v.postError = ""; v.postedInto = r.company || "";
      v.postedOptional = opt; delete v.postJob;
      if (w.there){ v.postNote = "Posted before by FinCom; in Tally"; delete v.postWhy; v.tallyMatch = {number: String(d.vno || ""), date: String(d.day || ""), type: String(d.vtype || "")}; }
      else { v.postNote = "Posted before by FinCom, not sent again"; if (w.words) v.postWhy = w.words; else delete v.postWhy; }
    } else { v.postError = w.words; v.postJob = v.postJob || r.earlier; }
  }
  saveSales();
  return earlierLine(n, "invoice");
}
// a posting is still going in FinCom's cloud for this invoice: it stays out of the next Post press
function salesJobLive(v){
  return !!(v && v.postJob && typeof CloudJobs === "object" && [].concat(CloudJobs.list || []).some(j => j && j.id === v.postJob && ["waiting", "taken", "running"].includes(j.status)));
}
// the bills' and bank lines' Post press (src/js/24 postBillsToTally, postBankToTally): the same decision; returns its line
// for the caller's own toast and report (polish 2: one toast, the sales way)
async function postEarlier(kind, co, early, tname){
  const n = {sent: 0, there: 0, posted: 0, keep: 0}, cid = co.id;
  for (const [x, r] of early){
    const d = NotInTally.optional(co, kind, x) ? null : await NotInTally.resend(r.earlier, x.id, kind === "bill" ? "bill" : "bank line", salesWhen(r)), w = earlierWay(r, d);
    n[w.there ? "there" : w.way]++;
    const when = salesWhen(r) || new Date().toISOString(), ans = Object.assign({}, r, {ok: true, verified: true, vchNumber: (d && d.vno) || r.vchNumber || r.vchNo || ""});
    if (kind === "bill"){
      if (w.way === "posted"){ billPosted(cid, x, ans, tname, when, {quiet: true}); x.postNote = w.there ? "Posted before by FinCom; in Tally" : "Posted before by FinCom, not sent again"; }
      else { x.postError = w.words; if (w.way === "sent") x.postJobNew = r.earlier; }
      Store.saveEntry(cid, x);
    } else {
      if (w.way === "posted") bankPosted(cid, x, ans, tname, when, {quiet: true});
      else { x.postError = w.words; if (w.way === "sent") x.postJob = r.earlier; }
    }
  }
  if (kind === "bank") saveBank({rows: true, posted: true}); else refreshStats(cid);
  render();
  return earlierLine(n, kind === "bill" ? "bill" : "bank line");
}
// a sales invoice marked Posted
async function salesNotInTally(id){
  const s = SL(), v = s && s.list.find(x => x.id === id);
  if (!v || v.status !== "posted") return null;
  return NotInTally.run({co: CO(s.cid), id: v.id, kind: "invoice", what: "invoice " + (v.x.number || v.id), entry: v, when: v.postedAt,
    sent: (r, job) => { v.status = "ready"; delete v.postedAt; v.postJob = job; v.postNote = ""; delete v.postWhy; v.postError = r.words; v.postedOptional = false; saveSales(); },
    there: r => { v.postNote = "Posted before by FinCom; in Tally"; delete v.postWhy; v.tallyMatch = {number: String(r.vno || ""), date: String(r.day || ""), type: String(r.vtype || "")}; saveSales(); }});
}
// a purchase bill sent to Tally
async function billNotInTally(id){
  const cid = S.coId, e = D().entries[id];
  if (!e || e.status !== "approved" || !e.exportedAt) return null;
  return NotInTally.run({co: CO(cid), id: e.id, kind: "bill", what: "bill " + ((e.x && e.x.invoiceNo) || e.id), entry: e, when: e.exportedAt,
    sent: r => { e.postUndo = {why: r.words, at: new Date().toISOString(), by: postMyName()}; billClearPosting(e); Store.saveEntry(cid, e); refreshStats(cid); if (typeof CloudJobs === "object") CloudJobs.load(true); }});
}
// a bank line FinCom posted (its FinCom id: the line's fingerprint, as its voucher carries it)
async function bankNotInTally(id){
  const b = B(), r = b && b.rows.find(x => x.id === id);
  if (!r || !(r.state === "sent" || (r.state === "intally" && bankOwnPost(r)))) return null;
  return NotInTally.run({co: CO(b.cid), id: r.id, fid: fpHash(r.fp || r.id), kind: "bank line", what: "the bank line of " + fmtDate(r.date), entry: r, when: r.sentAt,
    sent: (x, job) => { bankClearPosting(r, "ready"); r.postJob = job; r.postError = x.words; if (b.postedTags) delete b.postedTags[fpHash(r.fp || r.id)]; saveBank({rows: true, posted: true}); }});
}
if (typeof globalThis === "object") Object.assign(globalThis, {NotInTally, salesEarlier, salesJobLive, postEarlier, salesNotInTally, billNotInTally, bankNotInTally});
/* @react-lazy: end */
