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
  const out = {n: 0, at: "", batchEnd: "", rows: [], refused: [], review: []};
  const b = B();
  if (!b || b.cid !== cid || typeof Bridge !== "object" || !Bridge.on() || !Bridge.up()) return out;
  const todo = [].concat(rows || []).filter(r => r.state === "ready" && (!ids || ids.has(r.id)) && bankJobOf(r));
  if (!todo.length) return out;
  const memo = new Map(), co = CO(cid), rowOf = new Map(b.rows.map(q => [String(q.id), q]));
  tname = tname || co.tallyName || (TCloud.book(cid) || {}).company || co.name;
  // migration 111: with the cloud's posting register, the register alone says whether a line is in Tally (never this page's
  // reading of a job's answer): in_tally -> marked posted from the record; refused -> Tally's words; anything else stays
  if (typeof PostReg === "object"){ await PostReg.load(cid, true); }
  for (const r of todo){
    const rg = typeof postRegOf === "function" ? postRegOf(cid, r.id) : undefined;
    if (rg){
      if (rg.state === "in_tally"){ const x = postRegResult(rg); bankPosted(cid, r, Object.assign({}, x, {jobId: rg.job_id}), rg.company || tname, x.sentAt, {by: postMyName()}); out.n++; out.rows.push(r); if (!out.at || x.sentAt > out.at) out.at = x.sentAt; }
      else if (rg.state === "refused"){ r.postError = "Not in Tally: Tally refused this line (" + (postReasonText(rg.tally_words) || "no words") + ")."; delete r.postJob; out.refused.push(r); }
      continue;
    }
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
    // 30-Oct-2026 (Fingate, job 488f8f64: Tally created 8 of 50 and 16 of 37): a line of a batch Tally made only partly
    // keeps Tally's own words and the batch's counts, never the guard's "already sent from this computer"
    if (x && !postTaken(x) && bankInReview(x)){ bankReviewMark(r, x, job); out.review.push(r); continue; }
    if (!x || !postTaken(x)) continue;
    const guess = sp ? sp.guess : bankBatchGuesses(j.results).get(String(r.id));
    const at = x.sentAt || j.finishedAt || j.updatedAt || new Date().toISOString();
    bankPosted(cid, r, Object.assign({}, x, {jobId: job, vchGuess: guess || ""}), j.company || tname, at, {by: postMyName()});
    out.n++; out.rows.push(r);
    if (!out.at || at > out.at) out.at = at;
    if (+x.batchEnd > +(out.batchEnd || 0)) out.batchEnd = String(x.batchEnd);
  }
  if (out.n){ learnRows(out.rows, "sent"); saveBank({rows: true, posted: true}); }
  else if (out.refused.length || out.review.length) saveBank({rows: true});
  return out;
}
// ---------- a batch Tally made only partly (owner, 30-Oct-2026, Fingate Advisory Services) ----------
// Bridge 2.4.9 sends bank lines 50 to a request. Tally's reply to a request counts what it made (CREATED, LASTVCHID) and
// gives its line errors, never WHICH voucher it refused; so every line of a request where it made fewer than it was sent
// needs review (the bridge's rule A2), and the bridge keeps them all on its record as sent (its resend guard). Before
// this, the page put Tally's words on the line once, and the next Post replaced them with the guard's "already sent
// from this computer on …", and the line sat "ready" for ever: 87 lines of one statement (24 of them in Tally, 63 not)
// with no word of Tally's left. Now each such line keeps r.postReview {job, created, n, batchEnd, at, words}, its
// postError says what Tally said, and Check with Tally (bankCheckReview) settles it from a read of the bank ledger.
function bankInReview(x){ return !!(x && (x.needsReview === true || x.outcomeUnknown === true || (x.ok === false && x.accepted === true))); }
function bankReviewWords(x){
  const n = num(x.batchN), made = num(x.created) + num(x.altered);
  const tw = [].concat(x.lineError || []).map(e => plainMsg(e)).filter(Boolean);
  const said = tw.length ? tw.join("; ") : plainMsg(x.message || "") || "no reason given";
  if (x.outcomeUnknown) return "Sent to Tally, and no answer came, so FinCom cannot tell whether Tally made it. Tally said: " + said + ". Press Check with Tally.";
  return "Tally made " + made + " of the " + n + " lines sent together" + (x.batchEnd ? " (Tally ids up to " + x.batchEnd + ")" : "") +
    " and does not say which. Tally said: " + said + ". Press Check with Tally to find which of them are in Tally.";
}
function bankReviewMark(r, x, job){
  r.postReview = {job: String(job || x.jobId || x.sentJob || r.postJob || ""), created: num(x.created) + num(x.altered), n: num(x.batchN), batchEnd: String(x.batchEnd || ""),
    at: x.sentAt || "", words: [].concat(x.lineError || []).map(e => plainMsg(e)).filter(Boolean).concat(x.lineError && x.lineError.length ? [] : [plainMsg(x.message || "")]).filter(Boolean).slice(0, 5)};
  if (r.postReview.job) r.postJob = r.postReview.job;
  r.postError = bankReviewWords(x);
}
// Check with Tally for the open statement: the bank ledger read for the lines' dates (the bridge here, else FinCom's
// copy). Only a read that holds those days settles anything (copyNotCovered: "not checked", never "not in Tally"):
//   found (FinCom's tag in the narration; else the one entry of that amount on that day): posted, with Tally's voucher;
//   not found: released for the FinCom Bridge (its record lets it go once more) and back to Post, with why. The bridge
//   still looks in Tally for each line just before it posts it, so nothing goes twice.
// Which lines: those in review (a partly made batch, no answer), or every line marked posted (opts.all). -> {found,
// missing, notCovered, error}
async function bankCheckReview(opts){
  opts = opts || {};
  const b = B(), co = b && CO(b.cid), st = b && curStmt();
  const out = {found: [], missing: [], notCovered: false, error: ""};
  if (!st) return out;
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId), ledger = acc && exactLedger(acc.ledger);
  if (!ledger){ out.error = "Choose the Tally ledger for this bank account first."; toast(out.error); return out; }
  const rows = b.rows.filter(r => opts.all ? ["sent", "intally"].includes(r.state) || (r.state === "ready" && (r.postReview || bankJobOf(r))) : r.state === "ready" && (r.postReview || bankJobOf(r)));
  if (!rows.length){ toast("No lines wait for a check with Tally."); return out; }
  const ds = rows.map(r => r.date).filter(Boolean).sort(), from = addDays(ds[0], -15), to = addDays(ds[ds.length - 1], 15);
  const tname = (typeof tallyCoName === "function" ? tallyCoName(co) : "") || co.tallyName || co.name;
  b.busy = "Reading " + ledger + " from Tally for " + fmtDate(from) + " to " + fmtDate(to) + "…"; render();
  let j;
  try { j = await tallyCall(co, ledgerLinesUrl(tname, ledger, from, to), null, 600000); }
  catch (e){ b.busy = ""; out.error = "Tally could not be read (" + ((e && e.message) || e) + "); nothing was changed."; b.reviewCheck = Object.assign({at: Date.now()}, out); render(); return out; }
  b.busy = "";
  if (copyNotCovered(j) || !Array.isArray(j && j.vouchers)){
    out.notCovered = true;
    b.reviewCheck = Object.assign({at: Date.now(), ledger, n: rows.length}, out);
    render(); return out;
  }
  const now = new Date().toISOString(), me = (typeof postMyName === "function" ? postMyName() : "") || (Cloud.st && Cloud.st.email) || "";
  const vs = [].concat(j.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || "")).map(v => {
    const be = [].concat(v.entries || []).find(e => norm(e.ledger) === norm(ledger));
    return be ? {v, date: tallyToIso(v.date), eff: r2(-(parseFloat(String(be.amount).replace(/,/g, "")) || 0)), tag: ((String(v.narration || "").match(/TDSDesk:([A-Za-z0-9]+)/i) || [])[1] || "").toLowerCase()} : null;
  }).filter(Boolean);
  const used = new Set();
  // FinCom's tag first, for every line; then amount and day, only where exactly one untagged entry fits
  const hit = new Map();
  rows.forEach(r => { const t = fpHash(r.fp || r.id).toLowerCase(), k = vs.findIndex((x, i) => !used.has(i) && x.tag === t); if (k >= 0){ used.add(k); hit.set(r.id, vs[k]); } });
  rows.forEach(r => {
    if (hit.has(r.id)) return;
    const c = vs.map((x, i) => i).filter(i => !used.has(i) && !vs[i].tag && vs[i].date === r.date && Math.abs(vs[i].eff - bankEffect(r)) < 0.01);
    const same = rows.filter(q => !hit.has(q.id) && q.date === r.date && Math.abs(bankEffect(q) - bankEffect(r)) < 0.01).length;
    if (c.length === 1 && same === 1){ used.add(c[0]); hit.set(r.id, vs[c[0]]); }
  });
  rows.forEach(r => {
    const x = hit.get(r.id);
    if (x){
      if (["sent", "intally"].includes(r.state)) return;
      const v = x.v;
      bankPosted(b.cid, r, {ok: true, verified: true, guid: v.guid || "", masterId: v.masterId || v.masterid || "", vchType: v.type || "", vchDate: v.date || "", vchNumber: v.number || "", jobId: (r.postReview && r.postReview.job) || r.postJob || ""}, tname, now, {by: me});
      if (r.tally && v.number) r.tally.number = String(v.number);
      r.tallyHow = "found in " + ledger + " at a check with Tally on " + fmtDate(now.slice(0, 10)) + (v.number ? " (" + (v.type || "voucher") + " no. " + v.number + ")" : "");
      delete r.postReview; delete r.release;
      out.found.push(r);
    } else {
      const was = r.postReview && r.postReview.words && r.postReview.words.length ? " (Tally had said: " + r.postReview.words.join("; ") + ")" : "";
      if (["sent", "intally"].includes(r.state)){ r.state = "ready"; r.tally = null; r.postedVia = ""; if (b.postedTags) delete b.postedTags[fpHash(r.fp || r.id)]; }
      r.release = {at: now, by: me || "FinCom", why: "Not in " + ledger + " at a check with Tally on " + fmtDate(now.slice(0, 10))};
      r.postError = "Not in Tally: " + ledger + " read on " + fmtDate(now.slice(0, 10)) + " for " + fmtDate(from) + " to " + fmtDate(to) + " has no entry for this line" + was + ". Post it again: the FinCom Bridge looks in Tally for it once more just before it posts it.";
      out.missing.push(r);
    }
  });
  if (out.found.length) learnRows(out.found, "sent");
  saveBank({rows: true, posted: true});
  b.reviewCheck = {at: Date.now(), ledger, from, to, n: rows.length, found: out.found.map(r => r.id), missing: out.missing.map(r => r.id), notCovered: false, error: ""};
  render();
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
  // migration 111: with the cloud's posting register a partly made batch is needs_review for every line (the 7.2 proof: Tally's
  // reply never says which voucher failed); the register, not this page, settles each line
  if (typeof PostReg === "object" && PostReg.readable === true) return out;
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
if (typeof globalThis === "object") Object.assign(globalThis, {bankPartialSplit, bankBatchGuesses, bankJobAnswers, bankJobOf, bankSentHeal, bankAlreadyLine, bankHealOpen, bankInReview, bankReviewWords, bankReviewMark, bankCheckReview});
/* @react-lazy: end */
