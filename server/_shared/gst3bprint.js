// next-cloud-gst: the fingerprint of what a month's 3B is worked out from, made the same way on the books the app has
// open and on the books gst-run makes from the cloud. gst-run keeps it with each month (result.fp); before the app
// shows a 3B the cloud worked out, it makes its own from S.books and shows the cloud's only when the two are the same
// and nothing is pending (else it works the month out itself, as before). Plain JavaScript, an ES module: the gst-run
// function imports it, and the app's screen that will read the cloud's 3B imports it the same way (not in legacy.js).
//   gst3bPrint(b, sales, run2b) -> {n, alt, ids, sales: {n, h}, run, pend, work}
//     n, alt     how many entries and the highest AlterID
//     ids        a hash of every entry's id (in order of id; the order the books keep them in is not part of it)
//     sales      the marketplace invoices kept in Sales: how many, and a hash of them
//     run        the 2B matching run of the month's year that was read (gst-2b-match's id), "" for none
//     pend       ledgers with entries whose kind (GST, TDS, bank...) is a guess, not set or confirmed: the app may guess
//                them otherwise (another client's confirmation), so a cloud answer is used only when this is 0
//     work       a hash of the work the 3B reads (2B, IMS, typed and filed returns, settings, rules, advances, the
//                ledger list's kinds, the masters' groups and GSTINs)
// Note (review of 18ad47515, item 9): entries of the same day are taken in the order the books hold them; the app's
// books and the cloud's can hold one day's entries in another order. The app's order is not changed here; the fingerprint
// leaves the order out, and run_gst_cloud.js keeps the two orders the same.
const WORK = ["twoBs", "reco2b", "itcTrack", "outRej", "gst3b", "gstFiled", "gstSet", "gstOpen", "rule37On", "rev", "assets", "filed", "filed1a", "itcBasis",
  "advFix", "gstVault", "gstRegs", "states", "gstins", "under", "groups", "ledInfo", "itcDec", "gone"];
function gst3bHash(s) {
  let a = 2166136261 >>> 0, c = 5381;
  for (let i = 0; i < s.length; i++) { const k = s.charCodeAt(i); a = Math.imul(a ^ k, 16777619) >>> 0; c = (Math.imul(c, 33) ^ k) >>> 0; }
  return a.toString(16).padStart(8, "0") + c.toString(16).padStart(8, "0") + ":" + s.length;
}
// keys in order; an empty object or list under a key is left out (the engine makes some as it reads: ITCT.store's
// {dec: {}, sent: {}, contact: {}}, GST2B.state's), so books read and books shown give the same text
function gst3bStable(v) {
  if (v === null || typeof v !== "object") return v === undefined ? "null" : JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(gst3bStable).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== "function").sort().map((k) => [k, gst3bStable(v[k])]).filter(([, t]) => t !== "{}" && t !== "[]").map(([k, t]) => JSON.stringify(k) + ":" + t).join(",") + "}";
}
function gst3bPrint(b, sales, run2b) {
  const vs = (b && b.vouchers) || [], map = (b && b.map) || {};
  let alt = 0; vs.forEach((v) => { const x = Number(v && v.alt); if (isFinite(x) && x > alt) alt = x; });
  const kinds = {}; Object.keys(map).sort().forEach((k) => { const m = map[k] || {}; kinds[k] = [m.kind || "", m.what || "", m.tax || "", m.side || "", m.reg || "", !!m.rcm, m.held == null ? "" : !!m.held]; });
  const pend = Object.keys(map).filter((k) => { const m = map[k] || {}; return (m.n || 0) > 0 && !m.ok && !m.byHand && !!m.kind; }).length;
  const work = {}; WORK.forEach((k) => { if (b && b[k] !== undefined) work[k] = b[k]; });
  return { n: vs.length, alt, ids: gst3bHash(vs.map((v) => String(v && v.id)).sort().join("\n")),
    sales: { n: (sales || []).length, h: gst3bHash(gst3bStable(sales || [])) }, run: run2b == null ? "" : String(run2b), pend,
    work: gst3bHash(gst3bStable(work) + "|" + gst3bStable(kinds)) };
}
// the same inputs: every part equal, and nothing pending on either side
function gst3bSame(a, c) { return !!(a && c) && a.pend === 0 && c.pend === 0 && gst3bStable(a) === gst3bStable(c); }
export { gst3bPrint, gst3bSame, gst3bHash, gst3bStable };
