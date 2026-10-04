/* ================================================================== */
/* Post to Tally: why an entry is where it is, in the owner's words   */
/* ================================================================== */
// The owner's spec of 04-Oct-2026 (Post to Tally page):
//  A. one fixed layout per entry (bill or bank line), the same in every tab: line 1 status · bill no. · party · amount ·
//     bill date · voucher type; line 2 when, who, company, Tally id, voucher date in Tally (and the FY sentence); line 3,
//     only when not posted: reason · what to do · the button;
//  B. Tally's reply in one sentence (postReplySentence), never the bare counts;
//  C. exactly ten statuses, one pure function: postStatus(entry, job, ids, marks) -> {code, words, todo, action, tab};
//  D. the reasons table (POST_REASONS): the bridge's or Tally's message -> plain reason -> how to fix -> post again or not.
//     The same table is in docs/post-reasons-table.md for the owner to review. A message the table does not know is said
//     "Tally said: <message>" and logged (console and the firm's activity log, once a message);
//  J. Hide (for this user) and Remove (for everyone, soft, with Restore): PostFlags, migration 49. A flag only changes
//     what the list shows: it never touches a posting, its FinCom id or its marks.

// ---------- D. the reasons table. Patterns are the real words of FinCom Bridge (bridge-go/post.go, jobs.go,
// posting_status.go, config.go, allowlist.go, dupcheck.go), tally-ingest (server/tally-cloud/index.ts posts_update), the
// cloud's posting functions (migration 24, 36b) and this app (src/js/59, 24). First match wins, so the narrow ones come
// first. kind: refused (Tally said no: status 7), stopped (nothing reached Tally: status 8), review (Tally may have it:
// status 6). again: Post again is safe once the fix is made.
const POST_REASONS = [
  {id: "duplicate", kind: "stopped", again: false,
    re: /FinCom id is taken|already sent from this computer on|^Already in Tally \(voucher no\.|Held as posted|is not sent to Tally again: Tally accepted|Held as duplicate|already (?:being )?posted to Tally in another posting/i,
    seen: "its FinCom id is taken · already sent from this computer on … · Already in Tally (voucher no. …) · Held as posted …",
    reason: "This bill is already posted (FinCom holds it as posted)",
    fix: "Nothing to post again. If it is really not in Tally, an owner undoes the posted mark first (More → This entry is not in Tally)."},
  {id: "ledger", kind: "refused", again: true,
    re: /ledger\s*['‘’“”"]([^'‘’“”"]+)['‘’“”"]\s*(?:does\s*not\s*exist|is\s*not\s*in\s*Tally)/i,
    seen: "Ledger 'X' does not exist · Failed: ledger 'X' is not in Tally — create it · Ledger “X” is not in Tally",
    reason: m => "The ledger “" + m[1] + "” is not in Tally",
    fix: m => "Create the ledger “" + m[1] + "” in Tally, or choose Tally's own ledger in the bill, then post again."},
  {id: "vchtype", kind: "refused", again: true,
    re: /voucher\s*type\s*['‘’“”"]([^'‘’“”"]+)['‘’“”"]\s*(?:does\s*not\s*exist|is\s*not\s*in\s*Tally)/i,
    seen: "Voucher type 'X' does not exist · Failed: voucher type 'X' is not in Tally — create it",
    reason: m => "The voucher type “" + m[1] + "” is not in Tally",
    fix: m => "Create the voucher type “" + m[1] + "” in Tally, or choose another one in Client setup → Tally, then post again."},
  {id: "period", kind: "refused", again: true,
    re: /out of (?:the )?period|outside the (?:period|financial year)|not within the company's books|before the books|beginning of books|date is not within|outside the allowed period/i,
    seen: "Voucher date is outside the period of the company · Failed: the entry's date is not within the company's books in Tally",
    reason: "The bill's date is outside the financial year or the period allowed in Tally",
    fix: "In Tally, open the year that holds the bill's date (or allow that period), or correct the bill's date, then post again."},
  {id: "postonly", kind: "stopped", again: true,
    re: /\(PostOnly\)|posts only to .* refused|allow-list of requests|AllowImport|Posting to Tally is switched off|is the main bridge on this computer now|this one reads only and does not post|in test mode does not post/i,
    seen: "This computer posts only to X (PostOnly); posting to Y refused · not on the bridge's allow-list · Posting to Tally is switched off (AllowImport) · Another bridge is the main bridge",
    reason: "This computer may not post to that company",
    fix: "An owner allows posting to this company on that computer (FinCom → Tally page → the computer's posting settings), then post again."},
  {id: "wrongco", kind: "stopped", again: true,
    re: /created it in .* instead|may post only to|Choose the Tally company|Confirm the Tally company|books in FinCom's cloud come from|is linked to another client|not linked to a FinCom client|wrong company/i,
    seen: "X may post only to Y, but its books in FinCom's cloud come from Z · Choose the Tally company … · Tally created it in X instead",
    reason: "The Tally company is not the one this client posts to",
    fix: "Choose or confirm the Tally company in Client setup → Tally (and open that company in Tally), then post again."},
  {id: "many", kind: "stopped", again: true,
    re: /open in more than one Tally/i,
    seen: "Waiting for Tally: X is open in more than one Tally",
    reason: "The company is open in more than one Tally",
    fix: "Close it in all but one Tally, then post again."},
  {id: "notopen", kind: "stopped", again: true,
    re: /is not open — open it in TallyPrime|did not show .* for two minutes|company is not open|Open .* in Tally(?:Prime)?\b|no company (?:is )?open|No company given/i,
    seen: "Waiting for Tally: X is not open — open it in TallyPrime · Tally did not show X for two minutes. Open it in TallyPrime and post again.",
    reason: "The company is not open in Tally",
    fix: "Open the company in TallyPrime on the Tally computer, then post again."},
  {id: "tallydown", kind: "stopped", again: true,
    re: /TallyPrime is not open|Tally is not answering on its port|FinCom Bridge (?:on .* )?is not (?:running|answering)|Tally not open on|No Tally computer keeps|connection refused|ECONNREFUSED/i,
    seen: "Waiting for Tally: TallyPrime is not open · Tally is not answering on its port · FinCom Bridge on X is not running",
    reason: "Tally is not running on the Tally computer",
    fix: "Start TallyPrime (and FinCom Bridge) on the Tally computer, then post again."},
  {id: "busy", kind: "stopped", again: true,
    re: /another posting to this Tally is going on|is being posted in another posting|already waiting to be posted|Tally is busy/i,
    seen: "Waiting for Tally: another posting to this Tally is going on · Some of these entries are already waiting to be posted · Tally is busy (a report, a pop-up …)",
    reason: "Another posting is going on",
    fix: "Wait for that posting to finish (close any open report or pop-up in Tally); this one can be posted after it."},
  {id: "checkfailed", kind: "stopped", again: true,
    re: /^Could not check Tally|^Waiting for Tally\b/i,
    seen: "Could not check Tally, not posted. Try again. · Waiting for Tally: …",
    reason: "Tally could not be checked first, so nothing was sent",
    fix: "Make sure Tally is open on the Tally computer, then post again."},
  {id: "notapproved", kind: "stopped", again: false,
    re: /not approved|Choose a bill that is ready|no valid date|incomplete|Nothing (?:is waiting )?to (?:be )?post|Only VOUCHER, LEDGER|no Tally identity|deleted in FinCom/i,
    seen: "Nothing to post · Choose a bill that is ready to post · The entry has no valid date · Retry not possible: this bill was deleted in FinCom",
    reason: "The bill is not approved, or its details are incomplete",
    fix: "Open the bill, complete it and approve it (restore it first if it was deleted), then post."},
  {id: "noanswer", kind: "review", again: false,
    re: /no answer came|not known whether|Checking whether it reached Tally|did not answer|no answer|timed out|could not confirm/i,
    seen: "Sent to Tally, but no answer came · not known whether Tally got it · Checking whether it reached Tally · Tally did not answer",
    reason: "No answer from Tally: it may or may not be in Tally",
    fix: "Look in Tally's Day Book for the bill's date before anything else. If it is there: mark posted with its Tally id. If not: release it and post again."},
  {id: "incomplete", kind: "review", again: false,
    re: /replied 'created'|cannot be found in|not found yet in|reply needs a look|^Tally's reply: |<RESPONSE>|Tally did not confirm|Tally took it; not read back|not yet read back|accepted it.*being checked/i,
    seen: "Tally replied 'created', but the entry cannot be found … · Tally's reply: … · Tally did not confirm it · not yet read back",
    reason: "Tally's reply was incomplete: it said it took the entry, but FinCom could not find it in Tally",
    fix: "Look in Tally's Day Book for the bill's date. If it is there: mark posted with its Tally id. If not: release it and post again."},
  {id: "exception", kind: "refused", again: true,
    re: /Tally reported an exception|already exists!?$|Voucher Number .* already exists/i,
    seen: "Tally reported an exception. Check the ledger names and the voucher type. · Voucher Number 'X' already exists!",
    reason: "Tally found a problem in the entry (an exception)",
    fix: "Check the ledger names, the voucher type and the voucher number in Tally, then post again."},
  {id: "ignored", kind: "refused", again: false,
    re: /Tally ignored it/i,
    seen: "Tally ignored it (it may already exist).",
    reason: "Tally ignored it: an entry with the same details already exists",
    fix: "Look for the entry in Tally; if it is there, an owner marks this one posted with its Tally id."},
  {id: "restarted", kind: "stopped", again: true,
    re: /stopped part-way|was restarted/i,
    seen: "The posting stopped part-way (the computer or the bridge was restarted).",
    reason: "The posting stopped part-way (the Tally computer or the bridge was restarted)",
    fix: "Post again; what is already in Tally is not sent twice."},
  {id: "cancelled", kind: "stopped", again: true,
    re: /^Cancelled\b|cancelled in FinCom|posting was cancelled/i,
    seen: "Cancelled before the Tally computer took it · Cancelled in FinCom; nothing more is sent to Tally",
    reason: "The posting was cancelled before it reached Tally",
    fix: "Post again when you want it in Tally."},
  {id: "notcreated", kind: "refused", again: true,
    re: /Tally did not create it|Tally did not take it|^Failed: Tally refused it/i,
    seen: "Tally did not create it. · Failed: Tally refused it (…) — correct it",
    reason: "Tally did not create the entry",
    fix: "Open the bill, check its ledgers and date, then post again."},
  {id: "notsent", kind: "stopped", again: true,
    re: /^The posting stopped before anything was sent|^Not sent\b|Nothing was sent/i,
    seen: "The posting stopped before anything was sent.",
    reason: "The posting stopped before anything was sent",
    fix: "Put right what the message says, then post again."}
];
// HTML entities in a message (the bridge's XML words) without the page (plainMsg needs a document)
function postReasonText(m){
  return String(m == null ? "" : m).replace(/&#13;|&#10;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
    // the bridge's own prefix and its "then press Retry in FinCom" tail say nothing the reason does not
    .replace(/^Failed:\s*/i, "").replace(/,? then press Retry in FinCom\.?$/i, "");
}
const PostReasonLog = {said: new Set()};
// {id, kind, again, reason, fix, said}: said is the message as it came. An empty message: null. A message the table does
// not know: "Tally said: <message>", not safe to post again until a person has read it; logged once a message
function postReasonFor(msg, cid){
  const said = postReasonText(msg);
  if (!said) return null;
  for (const r of POST_REASONS){
    const m = said.match(r.re);
    if (!m) continue;
    const v = x => typeof x === "function" ? x(m) : x;
    return {id: r.id, kind: r.kind, again: r.again, reason: v(r.reason), fix: v(r.fix), said};
  }
  if (!PostReasonLog.said.has(said)){
    PostReasonLog.said.add(said);
    try { console.warn("Post to Tally: a message the reasons table does not know:", said); } catch (e){}
    try { if (typeof auditEvent === "function") auditEvent("Post: unknown Tally message", said, cid || ""); } catch (e){}
  }
  return {id: "unmapped", kind: "refused", again: false, reason: "Tally said: " + said, fix: "Read Tally's words, put right the bill or Tally, then post again. If it is not clear, send this line to FinCom support.", said};
}

// ---------- B. Tally's reply in one sentence (never the bare counts, never zeros)
const POST_REPLY_KEPT_FROM = "2026-10-04";
function postReplySentence(r, at){
  const cnt = k => r && r[k] != null && r[k] !== "" ? num(r[k]) : 0;
  const any = !!r && ["created", "altered", "ignored", "exceptions", "errors"].some(k => cnt(k) > 0);
  // an entry Tally may have (accepted, no answer, a reply that needs a look): line 3 says it, not this sentence
  if (r && r.ok === false && (r.accepted === true || r.outcomeUnknown === true || r.needsReview === true) && !(cnt("exceptions") > 0 || cnt("errors") > 0)) return "";
  if (!any){
    if (r && r.ok === false && r.message){ const why = postReasonFor(r.message); return why.kind === "refused" ? "Tally refused it: " + lcFirst(why.reason) + "." : ""; }
    const t = String(at || "").slice(0, 10);
    return t && t < POST_REPLY_KEPT_FROM ? "Posted before 04-Oct; Tally's reply was not kept." : "Tally's reply was not kept.";
  }
  if (cnt("exceptions") > 0 || cnt("errors") > 0){
    const why = postReasonFor(postLineWords(r) || r.message || "Tally reported an exception");
    return "Tally refused it: " + lcFirst(why.reason) + ".";
  }
  if (cnt("ignored") > 0) return "Tally ignored it: an entry with the same details already exists.";
  if (cnt("altered") > 0) return "Tally updated an existing entry instead of adding a new one.";
  return "Tally accepted it.";
}
function lcFirst(s){ s = String(s || ""); return /^Tally\b|^FinCom\b|^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1); }
function postLineWords(r){ const l = r && r.lineError, a = Array.isArray(l) ? l : l ? [l] : []; return a.map(x => postReasonText(x)).filter(Boolean).join(" "); }
// what "Show Tally's reply" opens: Tally's words and counts as they came
function postReplyRaw(r, it){
  if (!r && !it) return "";
  const parts = [];
  if (r){
    const c = ["created", "altered", "ignored", "exceptions", "errors"].filter(k => r[k] != null && r[k] !== "").map(k => k.toUpperCase() + " " + num(r[k]));
    if (c.length) parts.push(c.join(", "));
    if (r.lastVchId != null && r.lastVchId !== "") parts.push("LASTVCHID " + r.lastVchId);
    if (postLineWords(r)) parts.push(postLineWords(r));
    if (r.message) parts.push(postReasonText(r.message));
  }
  if (it && it.reason && !parts.includes(postReasonText(it.reason))) parts.push(postReasonText(it.reason));
  return parts.join("\n");
}

// ---------- the financial year (April to March): "2023-24"
function postFyOf(iso){
  const m = String(iso || "").match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  const y = +m[1] - (+m[2] < 4 ? 1 : 0);
  return y + "-" + String(y + 1).slice(2);
}
function postFyNow(now){ const d = new Date(now || Date.now()); return postFyOf(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")); }
function postIsoOf(d){ const s = String(d || ""); return /^\d{8}$/.test(s) ? s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ""; }

// ---------- the Tally id of an entry. Tally's own number (the voucher's master id), never the bill number:
//   a correction an owner recorded (tally_post_marks 'posted' with digits) > the bridge's exact id (vchId) > the batch's
//   end (batchEnd, batchN > 1: "in batch ending Tally id N") > the ids the cloud kept (reply_vch, batch_end) > the
//   read-back's master id (before bridge 2.1.8) > the mark kept on the bill > what an owner typed, when it is digits and
//   not the bill number. An owner's typed value that is the bill number (or not digits) is set aside for Tally's last id
//   (lastVchId) and called suspect: "Correct the Tally id".
// {vch} | {batchEnd, batchN} | {} with typed, suspect, ids (every Tally id named, for an entry Tally may have twice)
function postTallyIdOf(e, r, ids, marks, job){
  const digits = s => /^\d+$/.test(String(s == null ? "" : s).trim());
  const s = v => String(v == null ? "" : v).trim();
  const billNo = s(e && e.x && e.x.invoiceNo);
  const posted = [].concat(marks || []).filter(m => m && m.action === "posted");
  const last = posted[posted.length - 1];
  const typed = s(last && last.vch) || (r && (r.byOwner || (r.message && /^Marked posted by the owner/.test(r.message))) ? s(r.vchNumber) : "");
  const t = e && e.tally ? e.tally : {};
  const out = {typed, suspect: false, ids: []};
  const known = [];
  [r && r.lastVchId, ids && ids.accepted_vch, ids && ids.reply_vch].forEach(v => { if (digits(v) && !known.includes(s(v))) known.push(s(v)); });
  // the cloud's own words naming Tally's ids ("voucher 26298, then 26299 on a second send")
  String((job && job.message) || "").replace(/(?:voucher(?: id)?|Tally id|LASTVCHID>?)\s*(\d{3,})/gi, (a, n) => { if (!known.includes(n)) known.push(n); return a; });
  out.ids = known.sort((a, b) => +a - +b);
  const pick = (o) => Object.assign(out, o);
  if (last && digits(last.vch) && s(last.vch) !== billNo) return pick({vch: s(last.vch), how: "mark"});
  if (r && digits(r.vchId)) return pick({vch: s(r.vchId)});
  if (r && digits(r.batchEnd)) return num(r.batchN) > 1 ? pick({batchEnd: s(r.batchEnd), batchN: num(r.batchN)}) : pick({vch: s(r.batchEnd)});
  if (ids && digits(ids.reply_vch)) return pick({vch: s(ids.reply_vch)});
  if (ids && digits(ids.batch_end)) return num(ids.batch_n) > 1 ? pick({batchEnd: s(ids.batch_end), batchN: num(ids.batch_n)}) : pick({vch: s(ids.batch_end)});
  if (r && digits(r.masterId) && r.ok) return pick({vch: s(r.masterId)});
  if (digits(t.vch)) return pick({vch: s(t.vch)});
  if (digits(t.batchEnd)) return num(t.batchN) > 1 ? pick({batchEnd: s(t.batchEnd), batchN: num(t.batchN)}) : pick({vch: s(t.batchEnd)});
  if (digits(t.masterId)) return pick({vch: s(t.masterId)});
  if (typed && (!digits(typed) || typed === billNo)){
    if (r && digits(r.lastVchId)) return pick({vch: s(r.lastVchId), suspect: true});
    return pick({suspect: true});
  }
  if (digits(typed)) return pick({vch: typed});
  if (ids && digits(ids.accepted_vch) && s(ids.accepted_vch) !== billNo) return pick({vch: s(ids.accepted_vch), fromReply: true});
  if (r && digits(r.lastVchId)) return pick({vch: s(r.lastVchId), fromReply: true});
  return out;
}

// ---------- C. the ten statuses
const POST_STATUS = {
  1: {words: "Posted to Tally", tab: "posted"},
  2: {words: "Posted, matched with Tally", tab: "posted"},
  3: {words: "Posted, marked by you", tab: "posted"},
  4: {words: "Waiting to post", tab: "topost"},
  5: {words: "Posting now", tab: "topost"},
  6: {words: "Needs review", tab: "errors"},
  7: {words: "Not posted: Tally refused it", tab: "errors"},
  8: {words: "Not posted: stopped before sending", tab: "errors"},
  9: {words: "Cancelled", tab: "errors"},
  10: {words: "Bill deleted in FinCom but entry is in Tally", tab: "posted"}
};
const postWhenSay = t => (typeof fmtIST === "function" ? fmtIST(t) : String(t || "")) || "";
const postWhoSay = u => !u ? "" : typeof memberName === "function" ? memberName(u) : String(u);
// entry: the bill (or bank line) here, a stub {id} when FinCom has no record of it, or null; job: the newest posting of
// FinCom's cloud naming it (tally_post_jobs), or null; ids: its tally_post_ids row for that posting, or null; marks: the
// tally_post_marks rows of that posting and entry, oldest first. ctx (optional): {now, me (user id), queue (1-based place
// among the waiting postings), missing (FinCom has no record of the bill), ledger (a ledger Tally lacks), held (the id is
// still held: false / true / null)}.
// -> {code, words, todo, action: {kind, label} | null, tab, reason, id: Tally id, posted (the moment), by} or null when
// the entry is not for this page (ready to post, or back in review)
function postStatus(entry, job, ids, marks, ctx){
  ctx = ctx || {};
  const e = entry || null, id = String((e && e.id) || ctx.id || "");
  const r = job ? [].concat(job.results || []).find(x => x && String(x.id) === id) || null : null;
  const it = job ? [].concat(job.items || []).find(x => x && String(x.id) === id) || null : null;
  const bill = !!(e && e.x);
  const gone = !!(e && e.goneFromTally);
  const deleted = (bill && e.status === "deleted") || ctx.missing === true;
  const mk = (code, todo, action, more) => Object.assign({code, words: POST_STATUS[code].words, todo: todo || "", action: action || null, tab: POST_STATUS[code].tab}, more || {});
  const tid = postTallyIdOf(e, r, ids, marks, job);
  const idSay = tid.vch ? "Tally id " + tid.vch : tid.batchEnd ? "in batch ending Tally id " + tid.batchEnd : "";
  const again = {kind: "postAgain", label: "Post again"};
  const backInReview = bill && !["approved", "deleted"].includes(e.status);
  if (job){
    const live = ["waiting", "taken", "running"].includes(job.status) || !!job.checking;
    const ownerMark = !!((r && r.byOwner) || (it && it.byOwner));
    const releasedByOwner = !!((ids && ids.released_by === "owner" && ids.released_at) || (ownerMark && ((r && r.state === "notfound") || (it && it.state === "notfound"))));
    const okR = !releasedByOwner && !!((r && (r.ok === true || postAlready(r))) || (it && ["in_tally", "posted"].includes(it.state)));
    const at = (r && r.sentAt) || job.updated_at || job.created_at || "";
    if (releasedByOwner){
      if (bill && e.status === "approved" && !e.exportedAt) return null;              // back in Ready to post
      const why = (ids && ids.released_why) || (r && r.reason) || "";
      return mk(8, "An owner said it is not in Tally" + (why ? " (" + postReasonText(why).replace(/^Not in Tally: released by the owner on [^(]*\(|\)$/g, "") + ")" : "") + ". It can be posted again.", deleted || !bill ? null : again, {reason: {id: "released", reason: "Released by an owner: not in Tally", fix: "It can be posted again."}, released: true});
    }
    if (okR){
      if (gone) return mk(6, "FinCom's copy of Tally did not show it on " + (typeof fmtDate === "function" ? fmtDate(String(e.goneFromTally).slice(0, 10)) : String(e.goneFromTally).slice(0, 10)) + ". Look in Tally's Day Book for " + (bill ? (typeof fmtDate === "function" ? fmtDate(e.x.invoiceDate) : e.x.invoiceDate) : "the bill's date") + ": if it is there, mark it posted; if not, release it and post again.",
        {kind: "settle", label: "It is in Tally: mark posted (Tally id)"}, {reason: {id: "notseen", reason: "FinCom's copy of Tally did not show it", fix: "Look in Tally's Day Book."}, id: tid, posted: at});
      if (deleted) return mk(10, (idSay ? idSay + ". " : "") + (ctx.missing ? "The bill is no longer in FinCom, so there is nothing to restore. The entry stays in Tally." : "Restore the bill in FinCom to keep its record with the entry in Tally."),
        ctx.missing ? null : {kind: "restore", label: "Restore the bill"}, {id: tid, posted: at});
      if (ownerMark || [].concat(marks || []).some(m => m && m.action === "posted")){
        const m = [].concat(marks || []).filter(x => x && x.action === "posted").slice(-1)[0];
        const who = m && m.by_user ? m.by_user : job.created_by, when = (m && m.at) || (r && r.byOwnerAt) || (it && it.byOwnerAt) || "";
        const you = ctx.me && who === ctx.me;
        return Object.assign(mk(3, "Marked posted by " + (you ? "you" : postWhoSay(who) || "an owner") + (when ? " on " + postWhenSay(when) : "") + (tid.typed ? "; Tally id typed: " + tid.typed : "") + "." + (tid.suspect ? " The Tally id typed is the bill number, not Tally's id" + (tid.vch ? "; Tally's reply said " + tid.vch : "") + ": correct it." : ""),
          tid.suspect ? {kind: "correctId", label: "Correct the Tally id"} : null, {id: tid, posted: at, markedBy: who, markedAt: when}), {words: "Posted, marked by " + (you ? "you" : postWhoSay(who) || "an owner")});
      }
      if (ids && ids.matched_at) return mk(2, "Nothing to do. FinCom found it in Tally" + (ids.matched_vch ? " (Tally id " + ids.matched_vch + ")" : "") + " on " + postWhenSay(ids.matched_at) + ".", null, {id: tid, posted: at});
      return mk(1, (idSay ? idSay + ". " : "") + "Nothing to do.", tid.suspect ? {kind: "correctId", label: "Correct the Tally id"} : null, {id: tid, posted: at});
    }
    // Tally may have it: its reply needs a look, no answer came, it said CREATED and FinCom could not find it, or the
    // cloud holds the id as accepted (Tally gave it an id) while the posting says it failed
    const failMsg = (r && (postLineWords(r) || r.message)) || (it && it.reason) || "";
    const heldAccepted = !!(ids && ids.accepted_at && ids.live && !ids.released_at);
    const review = (r && postNeedsReview(r)) || (it && ["needs_review", "unknown"].includes(it.state)) || (r && r.outcomeUnknown === true) || (r && r.ok === false && r.accepted === true)
      || (!live && (heldAccepted || (failMsg && (postReasonFor(failMsg, job.client_id) || {}).kind === "review")));
    if (review){
      const msg = failMsg || job.message || "";
      const why = postReasonFor(msg, job.client_id) || {id: "noanswer", reason: "No answer from Tally: it may or may not be in Tally", fix: ""};
      const two = tid.ids.length > 1;
      const reason = two ? {id: "twice", reason: "Tally may have this entry twice (Tally ids " + tid.ids.join(" and ") + ")", fix: "Look in Tally's Day Book" + (bill ? " for " + (typeof fmtDate === "function" ? fmtDate(e.x.invoiceDate) : e.x.invoiceDate) : "") + ": keep one entry and delete the other in Tally, then mark this one posted with the Tally id you kept."} : why;
      const acc = (r && r.accepted === true) || (ids && ids.accepted_at);
      return mk(6, (ctx.differs ? ctx.differs + " " : "") + reason.reason + (tid.ids.length === 1 ? " (Tally id " + tid.ids[0] + ")" : "") + ". " + (reason.fix || "Look in Tally's Day Book: if it is there, mark it posted; if not, release it and post again.") + (deleted ? " The bill is " + (ctx.missing ? "no longer in FinCom." : "deleted in FinCom.") : ""),
        live && !acc ? null : {kind: "settle", label: "It is in Tally: mark posted (Tally id)"}, {reason, id: tid, posted: at, accepted: !!acc, checking: live});
    }
    if (live){
      if (job.status === "waiting" || (it && it.state === "waiting" && job.status !== "running")) return mk(4, (ctx.queue ? "Number " + ctx.queue + " in the queue" : "In the queue") + ": " + (postReasonText(job.message) || "waiting for the Tally computer to take it") + ".", job.status === "waiting" ? {kind: "cancel", label: "Cancel"} : null);
      return mk(5, "Tally is taking it now" + (job.message && !/^Taken by|^Posting$/i.test(job.message) ? " (" + postReasonText(job.message) + ")" : "") + ". Nothing to do.", null);
    }
    if (backInReview) return null;
    if (job.status === "cancelled"){
      const why = postReasonText(job.message) || "cancelled";
      return mk(9, "Cancelled on " + postWhenSay(job.updated_at || job.created_at) + (job.created_by ? " (posted by " + postWhoSay(job.created_by) + ")" : "") + ": " + why + ".", deleted || !bill ? null : again, {reason: postReasonFor(why) || null});
    }
    if ((r && r.ok === false) || (it && it.state === "failed") || job.status === "failed" || (job.status === "done" && !okR)){
      const msg = (r && (postLineWords(r) || r.message)) || (it && it.reason) || job.message || "Tally did not answer for this entry";
      const why = postReasonFor(msg, job.client_id);
      const stopped = why.kind === "stopped" || (r && r.checkFailed === true) || (!r && !it && job.status === "failed");
      const realDel = bill && e.status === "deleted";
      const safe = why.again && !(r && r.alreadySent) && !realDel && !(bill && e.exportedAt) && (bill || job.status === "failed");
      const fix = realDel ? "The bill was deleted in FinCom" + (e.deleted && e.deleted.at ? " on " + (typeof fmtDate === "function" ? fmtDate(String(e.deleted.at).slice(0, 10)) : String(e.deleted.at).slice(0, 10)) : "") + (e.deleted && e.deleted.reason ? " (" + e.deleted.reason + ")" : "") + ": restore it first." : why.fix;
      return mk(stopped ? 8 : 7, why.reason + ". " + fix, realDel ? {kind: "restore", label: "Restore the bill"} : safe ? again : null, {reason: why, alreadySent: !!(r && r.alreadySent)});
    }
    return null;
  }
  // no posting of the cloud names it: what the bill itself says
  if (!bill) return null;
  if (backInReview) return null;
  if (e.postCheckFailed){ const why = postReasonFor(e.postCheckFailed.message || "Could not check Tally, not posted. Try again."); return mk(8, why.reason + ". " + why.fix, again, {reason: why}); }
  const at = (e.tally && e.tally.at) || e.exportedAt || "";
  if (e.exportedAt && gone) return mk(6, "FinCom's copy of Tally did not show it on " + (typeof fmtDate === "function" ? fmtDate(String(e.goneFromTally).slice(0, 10)) : String(e.goneFromTally).slice(0, 10)) + ". Look in Tally's Day Book for " + (typeof fmtDate === "function" ? fmtDate(e.x.invoiceDate) : e.x.invoiceDate) + ": if it is there, mark it posted; if not, post it again.",
    {kind: "settle", label: "It is in Tally: mark posted (Tally id)"}, {reason: {id: "notseen", reason: "FinCom's copy of Tally did not show it", fix: "Look in Tally's Day Book."}, id: tid, posted: at});
  if (typeof billInTally === "function" ? billInTally(e) : (e.exportedAt && (e.postVerified || e.postByReply))){
    if (deleted) return mk(10, (idSay ? idSay + ". " : "") + "Restore the bill in FinCom to keep its record with the entry in Tally.", {kind: "restore", label: "Restore the bill"}, {id: tid, posted: at});
    if (e.tally && e.tally.byOwner) return Object.assign(mk(3, "Marked posted by " + (ctx.me && e.tally.byOwnerId === ctx.me ? "you" : e.tally.byOwner) + (e.tally.byOwnerAt ? " on " + postWhenSay(e.tally.byOwnerAt) : "") + (tid.typed || e.tally.vch ? "; Tally id typed: " + (tid.typed || e.tally.vch) : "") + ".", null, {id: tid, posted: at}),
      {words: "Posted, marked by " + (ctx.me && e.tally.byOwnerId === ctx.me ? "you" : e.tally.byOwner)});
    return mk(1, (idSay ? idSay + ". " : "") + "Nothing to do.", null, {id: tid, posted: at});
  }
  if (e.status !== "approved") return null;
  if (e.exportedAt) return mk(6, (e.postedVia === "bridge" ? "Posted" : "In a Tally file") + ", not confirmed in Tally. Look in Tally's Day Book for " + (typeof fmtDate === "function" ? fmtDate(e.x.invoiceDate) : e.x.invoiceDate) + ": if it is there, mark it posted; if not, post it again.",
    {kind: "settle", label: "It is in Tally: mark posted (Tally id)"}, {reason: {id: "unconfirmed", reason: "Not confirmed in Tally", fix: "Look in Tally's Day Book."}, id: tid, posted: at});
  if (e.postUnconfirmed) return e.postUnconfirmed.pending ? mk(5, "Tally is taking it now. Nothing to do.") : mk(6, "Sent, not confirmed in Tally. Look in Tally's Day Book before posting it again.", {kind: "settle", label: "It is in Tally: mark posted (Tally id)"}, {reason: postReasonFor("Tally did not confirm it")});
  if (ctx.ledger){ const why = postReasonFor("Ledger '" + ctx.ledger + "' does not exist"); return mk(8, why.reason + ". " + why.fix, {kind: "ledger", label: "Choose the Tally ledger"}, {reason: why}); }
  if (e.postError){ const why = postReasonFor(e.postError); return mk(why.kind === "stopped" ? 8 : 7, why.reason + ". " + why.fix, why.again ? again : null, {reason: why}); }
  return null;
}

// ---------- the rows of the page: one per entry, from the postings of FinCom's cloud (the newest naming it) and the
// bills here no posting names (posted straight to a bridge, a Tally file, a check that failed, a ledger Tally lacks)
// {key, id, kind: bill | bank | other, e (the bill, the bank line, or null), job, r, it, ids, marks, st (postStatus),
//  d: {no, party, amount, date, vchType, found, docPath, fileName, docKey}}
const PostMarks = {
  by: {}, readable: null, busy: {},
  async load(cid, force){
    if (!cid || typeof TCloud !== "object" || !TCloud.on() || this.readable === false || this.busy[cid]) return;
    const key = typeof PostIds === "object" ? PostIds.jobsKey(cid) : "", s = this.by[cid];
    if (!key || (!force && s && s.key === key && Date.now() - s.at < 60000)) return;
    this.busy[cid] = true;
    try {
      const rows = await TCloud.restAll("tally_post_marks?select=job_id,entry_id,action,vch,note,by_user,at&job_id=in.(" + key + ")&order=at.asc");
      const m = new Map();
      [].concat(rows || []).forEach(x => { const k = x.job_id + "|" + x.entry_id; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
      const sig = JSON.stringify([...m.entries()]);
      const changed = !s || s.sig !== sig;
      this.by[cid] = {at: Date.now(), key, m, sig}; this.readable = true;
      if (changed && typeof render === "function") render();
    } catch (e){ this.readable = false; this.by[cid] = {at: Date.now(), key, m: new Map(), sig: ""}; }
    finally { delete this.busy[cid]; }
  },
  of(cid, jobId, id){ const s = this.by[cid]; return (s && s.m && s.m.get(jobId + "|" + id)) || []; }
};
// the voucher a posting sent, for an entry FinCom has no record of (its bill deleted for good, or never kept): read from
// the posting's payload once, on demand
const PostPayloads = {
  by: {}, busy: false, asked: new Set(), readable: null,
  async load(jobIds){
    const want = jobIds.filter(j => j && !this.asked.has(j) && /^[0-9a-f-]{36}$/i.test(j));
    if (!want.length || this.busy || this.readable === false || typeof TCloud !== "object" || !TCloud.on()) return;
    this.busy = true; want.forEach(j => this.asked.add(j));
    try {
      const rows = await TCloud.restAll("tally_post_jobs?select=id,payload&id=in.(" + want.join(",") + ")");
      [].concat(rows || []).forEach(x => { if (x && x.id && x.payload) this.by[x.id] = x.payload; });
      this.readable = true;
      if (typeof render === "function") render();
    } catch (e){ this.readable = false; }
    finally { this.busy = false; }
  },
  voucher(jobId, id){
    const p = this.by[jobId], v = p && [].concat(p.vouchers || []).find(x => x && String(x.id) === String(id));
    return v && v.xml && typeof voucherPreview === "function" ? voucherPreview(v.xml) : null;
  }
};
function postDetailsOf(cid, id, e, kind, job, r){
  const co = (typeof S === "object" && S.companies && S.companies[cid]) || {};
  if (kind === "bill") return {no: e.x.invoiceNo || "", party: e.x.vendorName || "", amount: num(e.x.total), date: e.x.invoiceDate || "", vchType: (r && r.vchType) || (e.tally && e.tally.vchType) || (typeof vchTypeOf === "function" ? vchTypeOf(e, co) : ""),
    found: true, docKey: e.id, docPath: e.docPath || "", fileName: e.fileName || ""};
  if (kind === "bank") return {no: (e.dec && (e.dec.chq || e.dec.utr)) || e.ref || "", party: (e.dec && e.dec.name) || String(e.narr || "").slice(0, 40), amount: num(e.debit || e.credit), date: e.date || "",
    vchType: (r && r.vchType) || (e.credit ? co.receiptType || "Receipt" : co.paymentType || "Payment"), found: true};
  const v = job ? PostPayloads.voucher(job.id, id) : null;
  if (v && (v.party || v.ref || v.number || num(v.dr) || num(v.cr))) return {no: v.ref || v.number || (r && r.vchNumber) || "", party: v.party || "", amount: postVoucherAmount(v), date: v.date || "", vchType: v.type || (r && r.vchType) || "", found: true, fromPosting: true};
  return {no: "", party: "", amount: 0, date: "", vchType: (r && r.vchType) || "", found: false, need: !!job};
}
// the bill's amount in a voucher sent: the party's credit and the TDS taken from it (a round-off line is not the bill's)
function postVoucherAmount(v){
  const nm = x => String(x || "").trim().toLowerCase(), lines = (v && v.lines) || [];
  const party = lines.filter(l => !l.dr && nm(l.ledger) === nm(v.party));
  if (party.length) return r2(party.reduce((a, l) => a + num(l.amount), 0) + lines.filter(l => !l.dr && /\btds\b/i.test(l.ledger)).reduce((a, l) => a + num(l.amount), 0));
  return num(v && v.dr) || num(v && v.cr);
}
// what went to Tally (the posting's voucher) against the bill now: "" when they agree
function postDiffers(e, v){
  if (!e || !e.x || !v) return "";
  const out = [], fd = d => typeof fmtDate === "function" ? fmtDate(d) : d, mo = n => typeof money === "function" ? money(n) : String(n);
  const no = String(v.ref || v.number || "").trim(), bn = String(e.x.invoiceNo || "").trim();
  if (no !== bn) out.push("bill no. " + (no || "none") + " (the bill says " + (bn || "none") + ")");
  if (v.date && e.x.invoiceDate && v.date !== e.x.invoiceDate) out.push("date " + fd(v.date) + " (the bill says " + fd(e.x.invoiceDate) + ")");
  const amt = postVoucherAmount(v), tot = num(e.x.total);
  if (amt && tot && Math.abs(amt - tot) > 0.5) out.push("amount " + mo(amt) + " (the bill says " + mo(tot) + ")");
  return out.length ? "What went to Tally differs from the bill now: " + out.join(", ") + "." : "";
}
function postEntryRows(cid){
  const d = typeof S === "object" && S.data ? S.data[cid] : null;
  if (!d || !d.loaded) return null;
  const jobs = postJobStates(cid), out = [], seen = new Set();
  const b = S.bank && S.bank.cid === cid && !S.bank.loading ? S.bank : null;
  const pid = typeof PostIds === "object" ? PostIds.by[cid] : null;
  const me = (S.account && S.account.me && S.account.me.user_id) || "";
  const waiting = (typeof CloudJobs === "object" ? CloudJobs.list || [] : []).filter(j => j.status === "waiting").sort((x, y) => String(x.created_at || "").localeCompare(String(y.created_at || "")));
  const ledgers = postLedgerList(cid), needPay = [];
  const all = typeof CloudJobs === "object" ? CloudJobs.forClient(cid).slice().sort((x, y) => String(y.created_at || "").localeCompare(String(x.created_at || ""))) : [];
  jobs.forEach((js, id) => {
    let j = js.job;
    const e = d.entries[id] || null, bl = !e && b ? b.rows.find(q => String(q.id) === id) : null;
    // a posting that stopped (failed, cancelled) for an entry put in Tally since, by an older or later posting or another
    // way: the entry is where it went in, not under the stopped one
    if (CloudJobs.stopped(j) && !CloudJobs.okIn(j).has(id)){
      const went = all.find(k => k !== j && CloudJobs.okIn(k).has(id));
      if (went) j = went;
      // in Tally another way, or marked as sent here after this posting (a Tally file, a bridge here): the bill's own state
      else if (e && ((typeof billInTally === "function" && billInTally(e)) || (e.exportedAt && String(e.exportedAt) > String(j.created_at || "")))) return;
    }
    const kind = e ? "bill" : bl ? "bank" : "other";
    const ids = pid && pid.rows ? pid.rows.get(j.id + "|" + id) || null : null;
    const marks = PostMarks.of(cid, j.id, id);
    const ent = e || bl || {id};
    const held = typeof postIdReleased === "function" ? (postIdReleased(id, cid) === false ? true : postIdReleased(id, cid) === true ? false : null) : null;
    const missing = kind === "other" && !String(id).includes("-") && !(S.sales && (S.sales.list || []).some(v => String(v.id) === id));
    const c0 = {id, me, held, missing, queue: waiting.findIndex(w => w.id === j.id) + 1 || 0};
    let st = postStatus(kind === "bank" ? Object.assign({}, bl, {x: undefined}) : ent, j, ids, marks, c0);
    // C6 "what differs": an entry that needs review is set beside what the posting sent (its payload, read on demand)
    if (st && st.code === 6 && kind === "bill"){
      const v = PostPayloads.voucher(j.id, id);
      if (!v) needPay.push(j.id);
      else { const df = postDiffers(e, v); if (df) st = postStatus(ent, j, ids, marks, Object.assign({}, c0, {differs: df})); }
    }
    seen.add(id);
    if (!st) return;
    const r = [].concat(j.results || []).find(x => x && String(x.id) === id) || null, it = [].concat(j.items || []).find(x => x && String(x.id) === id) || null;
    const det = postDetailsOf(cid, id, ent, kind, j, r);
    if (kind === "other" && !det.found) needPay.push(j.id);
    out.push({key: j.id + ":" + id, id, kind, e: kind === "other" ? null : ent, job: j, r, it, ids, marks, st, d: det});
  });
  Object.values(d.entries).forEach(e => {
    if (seen.has(String(e.id))) return;
    const miss = ledgers && e.status === "approved" && !e.exportedAt && !e.postUnconfirmed && !e.postCheckFailed ? postMissingLedgers(e) : [];
    let st = postStatus(e, null, null, [], {me, ledger: miss.length ? miss[0].ledger : ""});
    if (!st) return;
    // a bill sent and not confirmed: what the fresh read of Tally said (PostCheck, src/js/59), Post again only after a
    // read made after the posting found nothing
    if (st.code === 6 && typeof PostCheck === "object"){ const v = PostCheck.view(e); st = Object.assign({}, st, {todo: v.text + ". " + st.todo, check: v.state}); }
    out.push({key: "local:" + e.id, id: String(e.id), kind: "bill", e, job: null, r: null, it: null, ids: null, marks: [], st, d: postDetailsOf(cid, e.id, e, "bill", null, null), miss});
  });
  if (needPay.length) setTimeout(() => PostPayloads.load([...new Set(needPay)]), 0);
  // newest first: the moment it was posted or sent, else the bill's date
  const when = x => String((x.st && x.st.posted) || (x.job && (x.job.updated_at || x.job.created_at)) || (x.e && x.e.exportedAt) || x.d.date || "");
  return out.sort((x, y) => when(y).localeCompare(when(x)));
}

// ---------- J. Hide (this user) and Remove (everyone, soft) of rows on Posted and Errors (migration 49)
// PostFlags.ok: null not read yet, true read, false the cloud has no tally_post_row_flags (the buttons are not shown).
// hide: Set of row keys hidden by this user; removed: Map row key -> {by, at, why}
const PostFlags = {
  ok: null, at: 0, busy: false, hide: new Set(), removed: new Map(), err: "",
  missing(m){ return /tally_post_row_flags|tally_post_row_(?:hide|remove|restore)|PGRST20[0-9]|42P01|42883|does not exist|schema cache|Could not find|\b404\b/i.test(String(m || "")); },
  async load(force){
    if (this.busy || typeof TCloud !== "object" || !TCloud.on() || this.ok === false) return;
    if (!force && Date.now() - this.at < 60000) return;
    this.busy = true;
    try {
      const rows = await TCloud.restAll("tally_post_row_flags?select=row_key,kind,user_id,at,why&restored_at=is.null");
      const me = (S.account && S.account.me && S.account.me.user_id) || "";
      const hide = new Set(), removed = new Map();
      [].concat(rows || []).forEach(x => { if (!x) return; if (x.kind === "remove") removed.set(x.row_key, {by: x.user_id, at: x.at, why: x.why || ""}); else if (x.kind === "hide" && (!me || !x.user_id || x.user_id === me)) hide.add(x.row_key); });
      const sig = JSON.stringify([[...hide].sort(), [...removed.keys()].sort()]), changed = sig !== this.sig;
      this.hide = hide; this.removed = removed; this.sig = sig; this.ok = true; this.at = Date.now();
      if (changed && typeof render === "function") render();
    } catch (e){
      const m = String((e && e.message) || e);
      if (this.missing(m)) this.ok = false; else this.err = m;
      this.at = Date.now();
    } finally { this.busy = false; }
  },
  isHidden(k){ return this.hide.has(k); },
  isRemoved(k){ return this.removed.has(k); },
  async call(fn, args, done){
    try {
      const r = await TCloud.rpc(fn, args);
      if (r && r.ok === false) throw new Error(r.error || "It was not done.");
      if (done) toast(done);
      await this.load(true);
      return true;
    } catch (e){
      const m = String((e && e.message) || e);
      if (this.missing(m)){ this.ok = false; toast("FinCom's cloud is not ready for this yet (migration 49)."); }
      else toast(m.replace(/^ERROR:\s*/i, ""));
      if (typeof render === "function") render();
      return false;
    }
  },
  hideRows(keys, on){ return this.call("tally_post_row_hide", {p_keys: keys, p_on: on !== false}, on === false ? null : keys.length + (keys.length === 1 ? " row hidden" : " rows hidden") + " (for you only). Show hidden brings them back."); },
  removeRows(keys, why){ return this.call("tally_post_row_remove", {p_keys: keys, p_why: why || ""}, keys.length + (keys.length === 1 ? " row moved" : " rows moved") + " to Removed. The entries in Tally are not affected."); },
  restoreRows(keys){ return this.call("tally_post_row_restore", {p_keys: keys}, keys.length + (keys.length === 1 ? " row restored." : " rows restored.")); }
};
// a row that may not be removed: its posting is still going on (removing never cancels a posting)
function postRowRemoveBlock(x){
  const j = x && x.job;
  if (j && (["waiting", "taken", "running"].includes(j.status) || j.checking)) return "Cannot be removed: its posting is still going on. Wait for it to finish (or cancel it on To post).";
  if (x && x.st && (x.st.code === 4 || x.st.code === 5)) return "Cannot be removed: it is being posted.";
  return "";
}
// the rows of a tab as the person sees them: {shown, hidden, removed} (search applied by the page)
function postTabRows(cid, tab){
  const all = postEntryRows(cid) || [];
  const mine = all.filter(x => x.st.tab === tab);
  return {shown: mine.filter(x => !PostFlags.isHidden(x.key) && !PostFlags.isRemoved(x.key)), hidden: mine.filter(x => PostFlags.isHidden(x.key) && !PostFlags.isRemoved(x.key)), removed: mine.filter(x => PostFlags.isRemoved(x.key))};
}
// G. search: bill no., party, amount, Tally id (and FinCom's id)
function postRowHit(x, q){
  const n = String(q || "").trim().toLowerCase();
  if (!n) return true;
  const tid = x.st && x.st.id ? [x.st.id.vch, x.st.id.batchEnd].concat(x.st.id.ids || []) : [];
  const amt = x.d.amount ? [String(x.d.amount), typeof INR === "object" ? INR.format(x.d.amount) : ""] : [];
  const n2 = n.replace(/[₹,\s]/g, "");
  return [x.id, x.d.no, x.d.party].concat(tid, amt).some(v => v != null && v !== "" && String(v).toLowerCase().includes(n))
    || (!!n2 && /^\d+(\.\d+)?$/.test(n2) && amt.some(v => String(v).replace(/,/g, "").includes(n2)));
}
