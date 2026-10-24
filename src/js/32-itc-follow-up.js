/* ================================================================== */
/* ITC follow-up: what is kept for writing to suppliers               */
/* ================================================================== */
// Since next-itc-simple (24-Oct-2026) the follow-up is part of the 2B reconciliation: each line's decision is
// app/src/lib/itcSync.js (ITCDec, S.books.itcDec; the old decisions in itcTrack[reg].dec are read there, never lost), the
// letters to suppliers app/src/lib/itcFinal.js (ITCF.letters) and the 2B reconciliation's "Write to suppliers". What
// stays here is the store of the dates suppliers were written to and their contacts (itcTrack[reg].sent, .contact).
const ITCT = {
  store(reg){ const b = S.books; b.itcTrack = b.itcTrack || {}; const t = b.itcTrack[reg || ""] = b.itcTrack[reg || ""] || {}; t.dec = t.dec || {}; t.sent = t.sent || {}; t.contact = t.contact || {}; return t; },
  dec(reg, key){ return ((this.store(reg).dec[key]) || {}); },
  // the last day to take credit on a bill: 30 November after the end of its year (section 16(4))
  deadline(d){ const s = String(d || ""); if (s.length < 6) return ""; const y = num(s.slice(0, 4)), m = num(s.slice(4, 6)), fy = m >= 4 ? y : y - 1; return (fy + 1) + "1130"; },
  today(){ const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); },
  tax(o){ return r2(num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess)); }
};
