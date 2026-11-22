// Daily Check phase 2 (next-daily-p2; docs/DAILY-CHECK-PHASE2.md): the trust levels and the id a Daily Check journal
// carries in Tally. Small on purpose: the page's settings load it without the builders (dailyjournals.js re-exports it).
const num = (x) => { const n = typeof x === "number" ? x : parseFloat(String(x == null ? "" : x).replace(/[,₹\s]/g, "")); return isFinite(n) ? n : 0; };

// the id the journal carries in Tally ("TDSDesk:<id>" in its narration): the same each night for the same entry
export function voucherId(dedupe) {
  let h = 2166136261 >>> 0;
  for (const c of String(dedupe)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let h2 = 5381;
  for (const c of String(dedupe)) h2 = ((h2 * 33) ^ c.codePointAt(0)) >>> 0;
  return "dc-" + h.toString(36) + h2.toString(36);
}

// ---------------------------------------------------------------- the trust levels (decisions D2 and D3)
export const TRUST_KINDS = ["bank", "recurring", "payroll", "setoff", "new_ledger"];
export const TRUST_WORDS = { bank: "Bank line booking", recurring: "Monthly entries", payroll: "Payroll journal", setoff: "GST set-off", new_ledger: "New ledger" };
export const LEVEL_WORDS = ["Ask me first", "Do it, then tell me", "Do it quietly"];
export const kindOfSource = (s) => ({ bank_self_answer: "bank", recurring: "recurring", payroll: "payroll", gst_setoff: "setoff" })[s] || "";
export const PROMOTE_AFTER = 20;
// D1: posting with no one pressing Approve needs a server path that does not exist (the bridge takes postings from a
// person's session). Until the owner decides, every level still waits for Approve.
export const AUTO_POSTING = false;
export function trustGate(o) {
  const level = Math.max(0, Math.min(2, Number(o && o.level) || 0)), limit = num(o && o.limit), amt = Math.abs(num(o && o.amt));
  const allowed = o && o.allowed !== undefined ? !!o.allowed : AUTO_POSTING;
  if (!level) return { act: "ask", why: "" };
  if (limit > 0 && amt > limit) return { act: "ask", why: "Over the limit: asks you first" };
  if (!allowed) return { act: "ask", why: "Still waits for Approve (posting by itself is not on yet)" };
  return level === 1 ? { act: "tell", why: "Done, then told; undo within 24 hours" } : { act: "quiet", why: "Done quietly; in the log" };
}
// the promotion suggestion: approvals of a kind for a client since the last rejection, edit or level change
export function promotion(stat, level) {
  const n = Number(stat && stat.approved) || 0, lv = Number(level) || 0;
  if (lv >= 2 || n < PROMOTE_AFTER || (stat && stat.dismissedAt && (!stat.lastAt || stat.lastAt <= stat.dismissedAt))) return null;
  return { to: lv + 1, n };
}

