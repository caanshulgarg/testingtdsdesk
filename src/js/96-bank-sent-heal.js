/* @react-lazy: begin 96-bank-sent-heal.js (the React app loads this file with the Bank screen and Post automatically: app/src/screens/Bank.jsx, app/src/lib/autopost.js; build.py react_parts) */
/* ================================================================== */
/* Bank lines a posting of this computer already put in Tally          */
/* (owner, 26-Oct-2026 19:31 IST, ITSEasy Solutions: 41 lines)         */
/* ================================================================== */
// Tally created the 41 vouchers of job 3cca4219 (ids up to 2447), but the page had stopped following that job before its
// last request was answered, so the 41 stayed ready; pressed again, the bridge's resend guard refused them all ("already
// sent from this computer on … job 3cca4219") and the page called them "41 not posted". Callers in src/js/24 and 20 check
// that these names exist (a page that never opened the Bank screen behaves as before).
// 26-Oct-2026 (ITSEasy, 41 lines): the Tally id of each line of a batch Tally took whole (CREATED = n, no errors): the n
// ids end at LASTVCHID in the order sent (batchEnd-n+1 .. batchEnd). Only an inference, kept apart (vchGuess, inferred),
// never as the line's voucher id; only for a request every one of whose n answers is here and taken. Map id -> id guessed
function bankBatchGuesses(results){
  const out = new Map(), groups = new Map();
  [].concat(results || []).forEach(x => {
    if (!x || !postTaken(x) || x.vchId || !/^\d+$/.test(String(x.batchEnd || "")) || !(num(x.batchN) > 1)) return;
    const k = x.batchEnd + "|" + (x.sentAt || "");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  });
  groups.forEach(g => { const n = num(g[0].batchN), end = +g[0].batchEnd; if (g.length === n) g.forEach((x, i) => out.set(String(x.id), String(end - n + 1 + i))); });
  return out;
}
// The resend guard's own record (owner, 26-Oct-2026, ITSEasy): a line the bridge would not send again ("already sent
// from this computer on … job X") IS in Tally when that job's answer for it was taken (Tally's reply, read back, altered).
// The job's record on the bridge (/jobs?id=X, kept on that computer) settles it: such a line is marked posted from that
// answer (its batch's ids, the job, when it went), never sent again. A job whose answer for the line was not taken (Tally
// created fewer than it was sent, a line error, no answer) leaves the line for review. Also for a line whose posting this
// page stopped following before the job ended (notAnswered, r.postJob). Returns {n, at, batchEnd, rows}.
async function bankJobAnswers(jobId, memo){
  if (memo && memo.has(jobId)) return memo.get(jobId);
  let j = null;
  try { j = await Bridge.call("/jobs?id=" + encodeURIComponent(jobId), null, 15000); } catch (e){ j = null; }
  const got = j && ["done", "failed", "cancelled"].includes(j.status) ? j : null;
  if (memo) memo.set(jobId, got);
  return got;
}
function bankJobOf(r){
  if (r.postJob) return String(r.postJob);
  const m = String(r.postError || "").match(/already sent from this computer on .*?, job ([A-Za-z0-9-]{8,64})/);
  return m ? m[1] : "";
}
async function bankSentHeal(cid, rows, tname, ids){
  const out = {n: 0, at: "", batchEnd: "", rows: [], refused: []};
  const b = B();
  if (!b || b.cid !== cid || typeof Bridge !== "object" || !Bridge.on() || !Bridge.up()) return out;
  const todo = [].concat(rows || []).filter(r => r.state === "ready" && (!ids || ids.has(r.id)) && bankJobOf(r));
  if (!todo.length) return out;
  const memo = new Map(), co = CO(cid), rowOf = new Map(b.rows.map(q => [String(q.id), q]));
  tname = tname || co.tallyName || (TCloud.book(cid) || {}).company || co.name;
  for (const r of todo){
    let job = bankJobOf(r), x = null, j = null;
    // the job named, or the earlier one its own record names (at most three steps back)
    for (let hop = 0; hop < 3 && job; hop++){
      j = await bankJobAnswers(job, memo);
      x = j && [].concat(j.results || []).find(q => q && String(q.id) === String(r.id));
      if (x && !x.ok && x.alreadySent && x.sentJob && x.sentJob !== job){ job = String(x.sentJob); continue; }
      break;
    }
    // a request Tally took all but the lines its errors name (bankPartialSplit): those lines say why, the rest are posted
    const sp = x && !x.ok && x.needsReview ? bankPartialSplit(j.results, rowOf).get(String(r.id)) : null;
    if (sp && sp.refused){ r.postError = sp.refused; delete r.postJob; out.refused.push(r); continue; }
    if (sp && sp.taken) x = sp.taken;
    if (!x || !postTaken(x)) continue;
    const guess = sp ? sp.guess : bankBatchGuesses(j.results).get(String(r.id));
    const at = x.sentAt || j.finishedAt || j.updatedAt || new Date().toISOString();
    bankPosted(cid, r, Object.assign({}, x, {jobId: job, vchGuess: guess || ""}), j.company || tname, at, {by: postMyName()});
    out.n++; out.rows.push(r);
    if (!out.at || at > out.at) out.at = at;
    if (+x.batchEnd > +(out.batchEnd || 0)) out.batchEnd = String(x.batchEnd);
  }
  if (out.n){ learnRows(out.rows, "sent"); saveBank({rows: true, posted: true}); }
  else if (out.refused.length) saveBank({rows: true});
  return out;
}
// 26-Oct-2026 (ITSEasy, 19-Feb-2026 receipt of 1,500 to "Software"): one request of 41, Tally created 40 (ids up to
// 2447, the request before ended at 2407) and refused one line; the bridge put all 41 under review with Tally's words, so
// the 40 in Tally stayed ready and the one refused was not told apart. When Tally's line errors name the ledgers it has not
// got ("Ledger 'Software' does not exist!") and exactly the lines using them make up what it did not create, those lines
// are refused with Tally's words and the others are posted (ids inferred in order). Anything else stays for review.
// Map id -> {taken: result, guess} | {refused: words}
function bankPartialSplit(results, rowOf){
  const out = new Map(), groups = new Map();
  [].concat(results || []).forEach(x => { if (x && !x.ok && x.needsReview && x.accepted && /^\d+$/.test(String(x.batchEnd || ""))){ const k = x.batchEnd + "|" + (x.sentAt || ""); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); } });
  const nm = v => ledNm(v || "").toLowerCase();
  groups.forEach(g => {
    const x0 = g[0], n = num(x0.batchN), made = num(x0.created) + num(x0.altered), errs = [].concat(x0.lineError || []).map(e => plainMsg(e));
    if (g.length !== n || made <= 0 || made >= n) return;
    const names = new Set(), all = errs.every(e => { const m = e.match(/Ledger\s*['\u2018\u2019"]([^'\u2018\u2019"]+)['\u2018\u2019"]\s*does not exist/i); if (m) names.add(nm(m[1])); return !!m; });
    if (!all || !names.size) return;
    const uses = r => [r.ledger, r.tdsAtPay ? r.tdsLedger : ""].concat((r.splits || []).map(p => p.ledger)).some(l => l && names.has(nm(l)));
    const rows = g.map(x => rowOf.get(String(x.id)));
    if (rows.some(r => !r)) return;
    const bad = rows.filter(uses);
    if (bad.length !== n - made) return;
    let i = 0;
    g.forEach((x, k) => {
      const r = rows[k];
      if (bad.includes(r)) out.set(String(x.id), {refused: "Not in Tally: Tally refused this line (" + errs.join("; ") + "); it created the other " + made + " of the batch."});
      else out.set(String(x.id), {taken: Object.assign({}, x, {ok: true, byReply: true, verified: false, needsReview: false, message: ""}), guess: num(x0.altered) ? "" : String(+x.batchEnd - made + 1 + i++)});
    });
  });
  return out;
}
// the quiet line for lines settled from the resend guard's record: "41 already in Tally (sent 19:26, Tally ids up to
// 2447) — marked as posted."
function bankAlreadyLine(h){
  const t = h.at ? fmtIST(h.at).replace(/^.* (\d\d:\d\d) IST$/, "$1") : "";
  const bits = [t ? "sent " + t : "", h.batchEnd ? "Tally ids up to " + h.batchEnd : ""].filter(Boolean).join(", ");
  return h.n + " already in Tally" + (bits ? " (" + bits + ")" : "") + " \u2014 marked as posted.";
}
// on opening a statement: its lines a posting of this computer already put in Tally (the job's record on the bridge
// says Tally took them) show as posted, In Tally. Nothing is sent; once per statement per page load while the bridge answers
async function bankHealOpen(){
  const b = B(), st = b && curStmt();
  if (!b || !st || b.busy) return 0;
  const k = b.cid + ":" + st.id;
  bankHealOpen.done = bankHealOpen.done || {};
  if (bankHealOpen.done[k]) return 0;
  if (!b.rows.some(r => r.state === "ready" && bankJobOf(r))) return 0;
  if (!(Bridge.on() && Bridge.up())) return 0;
  bankHealOpen.done[k] = 1;
  const h = await bankSentHeal(b.cid, b.rows);
  if (h.n && B() === b){ b.postReport = {at: Date.now(), posted: 0, skipped: 0, movedBack: 0, failed: [], already: h.n, alreadyLine: bankAlreadyLine(h), dismiss: "bankReportOk"}; render(); }
  return h.n;
}
if (typeof globalThis === "object") Object.assign(globalThis, {bankPartialSplit, bankBatchGuesses, bankJobAnswers, bankJobOf, bankSentHeal, bankAlreadyLine, bankHealOpen});
/* @react-lazy: end */
