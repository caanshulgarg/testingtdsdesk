// What to do with each bill's credit: the ONE store (next-itc-simple, the owner, 24-Oct-2026: "2B & ITC page is not clear
// .. Input register, 2B reconciliation, and in 2B reconciliation there should be follow-up also .. and one main tab should
// be Final credit taking into 3B"). Every line of the 2B reconciliation has one Decision:
//   now       Take now (in this month's 3B)                 later     Take in a later month (with the month)
//   booksnow  Take now though not in 2B (the owner's choice) follow    Follow up with supplier
//   correct   Ask supplier to correct                        reverse   Reverse / do not take
//   book      Book in Tally (in 2B, not in the books)
// Kept with the books as S.books.itcDec["<reg>|<line key>"] = {d, ym, note, at, by} (one of BOOKS_KEYS, so each decision
// is its own item on the server, client_book_items, and two people deciding two bills never clash). ym is the month the
// credit goes into ("" = the line's own month). A decision taken off is kept as d "" (so it also overrides an old remark).
//
// Decisions made before this (23-Oct-2026 and earlier) are read, never lost: the 2B reconciliation's remark
// (reco2b.tag[k] = {tag, at}, k the Tally document's id or the 2B document's key) and ITC follow-up's decision
// (itcTrack[reg].dec[k] = {act, at, ts, note}, k "B|gstin|no|dir", "D|…", "P|…", "R|<2B key>") are mapped onto the choices
// below; the latest of the three (by its time) is the line's decision. The two old stores are no longer written.
// The line keys are ITC follow-up's: "B|<GSTIN or party>|<number written the one way>|<1 invoice, -1 note>" for a bill in
// the books (alone or matched: a decision stays with the bill when it turns up in a later 2B), "P|<GSTIN>|<no>|<dir>" for
// a document only in 2B, "R|<2B key>" for one rejected in IMS. The 3B side is app/src/lib/itcFinal.js.

export const DECS = [["now", "Take now"], ["later", "Take in a later month"], ["booksnow", "Take now though not in 2B"], ["follow", "Follow up with supplier"],
  ["correct", "Ask supplier to correct"], ["reverse", "Reverse / do not take"], ["book", "Book in Tally"]];
export const DEC_LABEL = Object.fromEntries(DECS);
export const DEC_CODE = Object.fromEntries(DECS.map(([c, l]) => [l, c]));

// the old remarks and follow-up decisions, as choices
export const TAG_DEC = { "To book in Tally": "book", "Booked in a later month": "later", "Not our purchase": "reverse", "Blocked, section 17(5)": "reverse", "Ask supplier to correct": "correct",
  "Follow up with supplier": "follow", "Expect in next 2B": "later", "Reverse in 3B": "reverse", "Reverse charge or import": "reverse", "No credit claimed": "reverse" };
export const ACT_DEC = { B: { follow: "follow", wait: "later", expense: "reverse" }, D: { supplier: "correct", books: "correct" },
  P: { book: "book", pending: "later", reject: "reverse", supplier: "correct" }, R: { keep: "reverse", accept: "now" } };

const ms = (iso) => Date.parse(iso || "") || 0;
// when an old follow-up decision was made: its time, or for one made before times were kept the start of its day
const decAt = (d) => (d.ts ? ms(d.ts) : /^\d{8}$/.test(d.at || "") ? ms(d.at.slice(0, 4) + "-" + d.at.slice(4, 6) + "-" + d.at.slice(6, 8) + "T00:00:00") : 0);
const who = () => { try { return (Cloud.st && Cloud.st.email) || ((Cloud.sess && Cloud.sess()) || {}).email || ""; } catch (e) { return ""; } };

export const ITCDec = {
  all() { return ((S.books || {}).itcDec) || {}; },
  // the line's decision: {d, ym, note, at, src: "you" | "remark" | "follow-up", was} or null. keys: its key and the keys it
  // had before (a 2B-only document booked later), tagKeys: the old remarks' keys (Tally ids, 2B keys)
  get(reg, keys, tagKeys) {
    const b = S.books || {}, mine = b.itcDec || {}, tags = ((b.reco2b || {}).tag) || {}, dec = (((b.itcTrack || {})[reg || ""]) || {}).dec || {};
    let best = null, note = "";
    const take = (c) => { if (!best || c.t > best.t) best = c; };
    keys.forEach((k) => { const x = mine[(reg || "") + "|" + k]; if (x) take({ d: x.d || "", ym: x.ym || "", note: x.note, t: ms(x.at) + 1, at: x.at, by: x.by, src: "you" }); });
    (tagKeys || []).forEach((k) => { const t = tags[k]; if (t && TAG_DEC[t.tag]) take({ d: TAG_DEC[t.tag], ym: "", t: ms(t.at), at: t.at, src: "remark", was: t.tag }); });
    keys.forEach((k) => { const x = dec[k]; if (!x) return; if (x.note && !note) note = x.note; const d = x.act && (ACT_DEC[k[0]] || {})[x.act]; if (d) take({ d, ym: "", t: decAt(x), at: x.ts || x.at, src: "follow-up", was: x.act }); });
    if (best && best.note == null) best.note = note;
    if (!best && note) best = { d: "", ym: "", note, t: 0, src: "follow-up" };
    return best;
  },
  // set the decision of one or more lines (keys: each line's own key); d "" takes it off
  set(reg, keys, d, ym) {
    const b = S.books, at = new Date().toISOString(), by = who();
    b.itcDec = Object.assign({}, b.itcDec || {});
    keys.forEach((k) => { const id = (reg || "") + "|" + k, was = b.itcDec[id] || {}; b.itcDec[id] = Object.assign({}, was, { d: d || "", ym: d === "later" || d === "now" || d === "booksnow" ? ym || "" : "", at, by }); });
    saveBooks();
  },
  note(reg, key, note, cur) {
    const b = S.books, id = (reg || "") + "|" + key, was = (b.itcDec || {})[id];
    b.itcDec = Object.assign({}, b.itcDec || {});
    // a note alone keeps the decision as it is (the one in force, from wherever it came)
    b.itcDec[id] = Object.assign({}, was || (cur && cur.src !== "you" && cur.d ? { d: cur.d, ym: cur.ym || "" } : { d: "", ym: "" }), { note: String(note || ""), at: (was && was.at) || (cur && cur.at) || new Date().toISOString(), by: who() });
    saveBooks();
  },
  // what changed since: a signature of everything a decision is read from (the 3B's carried credit is kept against it)
  sig(b) { b = b || S.books || {}; return JSON.stringify([b.itcDec || {}, b.itcAdj || {}, (b.reco2b || {}).tag || {}, b.itcTrack || {}, b.itcBasis || {}]); },
};

// the old entry points, for anything still calling them: they now write the one store
function r2Tag(key, tag) {
  const reg = (typeof r2Reg === "function" ? r2Reg(S.books) : "") || S.gstReg || "";
  const row = typeof ITCF === "object" ? ITCF.rowByTagKey(reg, key) : null;
  if (row) { ITCDec.set(reg, [row.key], TAG_DEC[tag] || "", ""); render(); }
}
function itctSetAct(key, act) {
  const reg = S.gstReg || "", d = (ACT_DEC[key[0]] || {})[act] || "";
  ITCDec.set(reg, [key], d, ""); render();
}
Object.assign(globalThis, { ITCDec, r2Tag, itctSetAct });
