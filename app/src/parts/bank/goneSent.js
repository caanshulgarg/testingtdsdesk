// Lines posted to Tally from a statement since deleted (owner, 01-Nov-2026: "If I delete any statement then it should not
// show it duplicate if it is not posted.. if posted then warning and we should be able to upload and post it to tally..").
// Deleting a statement drops its fingerprints (src/js/23 deleteStatement), so its lines come in again on a new upload; the
// fingerprints of its lines that were in Tally are kept in the client's learnt history as hist.gone {fp: when posted}
// (kept here and in the cloud's bank_meta with the history, and kept when the history is forgotten). A line of the open
// statement with such a fingerprint, not posted from this statement, is marked goneSent: a warning on the line and in the
// statement's header, and posting it asks once (bankGoneAsk, called by postBankToTally, src/js/24); automatic posting
// leaves it (src/js/90). A line that is a duplicate of a statement still in the list is skipped at upload, as before.
const whenOf = (at) => (at && at !== "?" ? fmtDate(String(at).slice(0, 10)) : "");

// marks the lines of the open statement; returns {n: newly marked, at: the earliest date among them}
export function markGone(b) {
  const g = (b && b.hist && b.hist.gone) || {};
  let n = 0, at = "";
  if (!b || !b.rows || !Object.keys(g).length) return { n, at };
  b.rows.forEach((r) => {
    if (!r || !r.fp || r.goneSent || !(r.fp in g) || r.state === "sent" || r.state === "intally") return;
    r.goneSent = { at: g[r.fp] }; n++;
    if (g[r.fp] !== "?" && (!at || g[r.fp] < at)) at = g[r.fp];
  });
  return { n, at };
}
export const goneOpen = (r) => !!(r && r.goneSent && r.state !== "sent" && r.state !== "intally");
export const goneLine = (r) => "Already posted to Tally" + (whenOf(r.goneSent.at) ? " on " + whenOf(r.goneSent.at) : "") + " from a deleted statement";
export const goneCount = (b) => (b && b.rows ? b.rows.filter(goneOpen).length : 0);
export function goneToast(m) {
  return m.n + (m.n === 1 ? " line was" : " lines were") + " already posted to Tally" + (whenOf(m.at) ? " (on " + whenOf(m.at) + ")" : "") +
    " from a deleted statement. " + (m.n === 1 ? "It is" : "They are") + " marked; posting asks you first.";
}

// asked by postBankToTally before anything is sent: the ids to post (unchanged when no such line is among them), or false
// next-bank-overlap: a line marked "Possible repeat — check" (src/js/96) is never sent until it is confirmed
async function bankGoneAsk(b, ids) {
  const rep = (r) => !!(r.rep && r.rep.kind === "weak" && !r.rep.ok), ready = (r) => r.state === "ready" && (!ids || ids.includes(r.id));
  const held = b.rows.filter((r) => ready(r) && rep(r));
  if (held.length) {
    ids = b.rows.filter((r) => ready(r) && !rep(r)).map((r) => r.id);
    toast((held.length === 1 ? "1 entry is" : held.length + " entries are") + " marked Possible repeat — check, and " + (held.length === 1 ? "was" : "were") + " not posted: Keep it or It’s a repeat first.");
    if (!ids.length) return false;
  }
  const want = (r) => r.state === "ready" && (!ids || ids.includes(r.id));
  const pick = b.rows.filter((r) => want(r) && r.goneSent && !r.goneSent.ok);
  if (!pick.length) return ids;
  const dates = [...new Set(pick.map((r) => whenOf(r.goneSent.at)).filter(Boolean))].slice(0, 3).join(", ");
  const yes = await askConfirm({ title: pick.length + (pick.length === 1 ? " entry was" : " entries were") + " posted before; post again?", ok: "Post again",
    body: (pick.length === 1 ? "This entry was" : "These " + pick.length + " entries were") + " posted to Tally" + (dates ? " on " + dates : "") +
      " from a statement that has since been deleted. Tally still has them unless they were removed there: posting again makes a second voucher for each." +
      " Choose Cancel to post the other lines only." });
  if (yes) { pick.forEach((r) => { r.goneSent.ok = true; }); saveBank({ rows: true }); return ids; }
  const rest = b.rows.filter((r) => want(r) && !pick.includes(r)).map((r) => r.id);
  if (!rest.length) { toast("Nothing posted."); return false; }
  return rest;
}
if (typeof globalThis === "object") globalThis.bankGoneAsk = bankGoneAsk;
