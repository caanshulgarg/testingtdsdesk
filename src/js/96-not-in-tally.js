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
//   nothing there (or the cloud cannot answer yet): said plainly; nothing is sent.
// On the Post press (salesEarlier, from postSalesRun), and by "Not in Tally? Post again" on a posted invoice, bill or bank
// line (the same rule, for one marked posted before this).
const NotInTally = {
  busy: {},
  LABEL: "Not in Tally? Post again",
  on(id){ return !!this.busy[String(id)]; },
  fid(id){ return String(id || "").replace(/[^A-Za-z0-9]/g, ""); },
  // the posting that holds the entry's FinCom id (live), else ""
  async holder(co, fid){
    const rows = await Cloud.api("tally_post_ids?select=job_id&live=is.true&client_id=eq." + encodeURIComponent(co.id) + "&fincom_id=eq." + encodeURIComponent(fid));
    return String(([].concat(rows || [])[0] || {}).job_id || "");
  },
  // the cloud decides by its copy: {state: optional|deleted|cancelled (sent again), there, none, elsewhere, busy, blocked,
  // notready, unable; resent, vno, vtype, day, words}
  async resend(job, id){
    let r;
    try { r = await TCloud.rpc("tally_post_copy_resend", {p_job: job, p_id: String(id)}); }
    catch (e){
      const m = String((e && e.message) || e);
      if (/tally_post_copy_resend|PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(m)) return {state: "notready", words: "FinCom's cloud cannot decide this from its copy of Tally yet (migration 219), so nothing was sent."};
      return {state: "unable", words: "FinCom's cloud did not answer (" + plainMsg(m) + "), so nothing was sent."};
    }
    r = r || {};
    const st = String(r.state || (r.ok ? "optional" : "unable"));
    const what = {deleted: "FinCom's copy of Tally shows it deleted in Tally", optional: "FinCom's copy of Tally has it only as an Optional voucher", cancelled: "FinCom's copy of Tally has it only as a cancelled voucher"}[st];
    let words;
    if (r.resent) words = what + ": sent again. It posts by itself; FinCom marks it when Tally answers.";
    else if (r.released) words = what + ": " + (plainMsg(r.error) || "released, not sent yet.");
    else if (st === "there") words = "In Tally (FinCom's copy: " + [r.vtype, r.vno ? "no. " + r.vno : "", r.day ? "of " + fmtDate(String(r.day).slice(0, 10)) : ""].filter(Boolean).join(" ") + "), posted before by FinCom; nothing was sent.";
    else words = plainMsg(r.error) || "Nothing was sent.";
    return Object.assign({}, r, {state: st, words});
  },
  // one entry marked posted (a button): the posting that holds it, then the cloud's decision; o: {co, id, fid, what, sent(r), there(r)}
  async run(o){
    const k = String(o.id);
    if (this.busy[k]) return null;
    if (!(typeof TCloud === "object" && TCloud.on() && TCloud.has(o.co.id))){ toast("FinCom keeps no copy of this client's Tally books, so it cannot tell whether " + o.what + " is in Tally. Nothing was sent."); return null; }
    this.busy[k] = true; render();
    try {
      let job = "";
      try { job = await this.holder(o.co, o.fid || this.fid(o.id)); } catch (e){ toast("FinCom's cloud could not be read (" + plainMsg(e.message) + "). Nothing was sent."); return null; }
      if (!job){ toast("No posting of FinCom holds " + o.what + " now, so there is nothing to release. Nothing was sent."); return null; }
      const r = await this.resend(job, o.id);
      if (r.resent && o.sent) o.sent(r, job);
      if (r.state === "there" && o.there) o.there(r);
      toast(o.what.charAt(0).toUpperCase() + o.what.slice(1) + ": " + r.words);
      return r;
    } finally { delete this.busy[k]; render(); }
  }
};
const salesWhen = (r) => { const t = Date.parse((r && r.sentAt) || ""); return t ? new Date(t).toISOString() : ""; };
// the Post press: the invoices an earlier posting holds ([invoice, that posting's answer]); returns the words for the message
async function salesEarlier(early, co){
  let resent = 0, there = 0, held = 0;
  for (const [v, r] of early){
    const d = await NotInTally.resend(r.earlier, v.id);
    if (d.resent){
      resent++; v.postJob = r.earlier; v.postError = d.words; v.postNote = "";
    } else {
      // posted before by FinCom (that posting's own date); in Tally by the copy, or not sent again for the reason said
      v.status = "posted"; v.postedAt = salesWhen(r) || v.postedAt || new Date().toISOString(); v.postError = ""; v.postedInto = r.company || "";
      v.postedOptional = false; delete v.postJob;
      if (d.state === "there"){ there++; v.postNote = "Posted before by FinCom; in Tally"; v.tallyMatch = {number: String(d.vno || ""), date: String(d.day || ""), type: String(d.vtype || "")}; }
      else { held++; v.postNote = "Posted before by FinCom, not sent again"; v.postWhy = d.words; }
    }
  }
  saveSales();
  return [resent ? resent + " posted before and not in the books (FinCom's copy of Tally): sent again, posting by itself" : "",
    there ? there + " posted before and in Tally (FinCom's copy): not sent again" : "",
    held ? held + " posted before, not sent again: " + (held === 1 ? (early.find(([v]) => v.postWhy) || [{}])[0].postWhy : "open each to see why") : ""].filter(Boolean).join("; ").replace(/\.$/, "");
}
// a sales invoice marked Posted
async function salesNotInTally(id){
  const s = SL(), v = s && s.list.find(x => x.id === id);
  if (!v || v.status !== "posted") return null;
  return NotInTally.run({co: CO(s.cid), id: v.id, what: "invoice " + (v.x.number || v.id),
    sent: (r, job) => { v.status = "ready"; delete v.postedAt; v.postJob = job; v.postNote = ""; delete v.postWhy; v.postError = r.words; v.postedOptional = false; saveSales(); },
    there: r => { v.postNote = "Posted before by FinCom; in Tally"; delete v.postWhy; v.tallyMatch = {number: String(r.vno || ""), date: String(r.day || ""), type: String(r.vtype || "")}; saveSales(); }});
}
// a purchase bill sent to Tally
async function billNotInTally(id){
  const cid = S.coId, e = D().entries[id];
  if (!e || e.status !== "approved" || !e.exportedAt) return null;
  return NotInTally.run({co: CO(cid), id: e.id, what: "bill " + ((e.x && e.x.invoiceNo) || e.id),
    sent: r => { e.postUndo = {why: r.words, at: new Date().toISOString(), by: postMyName()}; billClearPosting(e); Store.saveEntry(cid, e); refreshStats(cid); if (typeof CloudJobs === "object") CloudJobs.load(true); }});
}
// a bank line FinCom posted (its FinCom id: the line's fingerprint, as its voucher carries it)
async function bankNotInTally(id){
  const b = B(), r = b && b.rows.find(x => x.id === id);
  if (!r || !(r.state === "sent" || (r.state === "intally" && bankOwnPost(r)))) return null;
  return NotInTally.run({co: CO(b.cid), id: r.id, fid: fpHash(r.fp || r.id), what: "the bank line of " + fmtDate(r.date),
    sent: (x, job) => { bankClearPosting(r, "ready"); r.postJob = job; r.postError = x.words; if (b.postedTags) delete b.postedTags[fpHash(r.fp || r.id)]; saveBank({rows: true, posted: true}); }});
}
if (typeof globalThis === "object") Object.assign(globalThis, {NotInTally, salesEarlier, salesNotInTally, billNotInTally, bankNotInTally});
/* @react-lazy: end */
