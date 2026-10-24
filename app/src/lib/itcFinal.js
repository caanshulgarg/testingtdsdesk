// Final credit for 3B (next-itc-simple, the owner, 24-Oct-2026: "one main tab should be Final credit taking into 3B ..
// option to increase or decrease like TDS add deduction or remove"). The ITC that goes into GSTR-3B table 4 for a month,
// built from the decision on each line of the 2B reconciliation (app/src/lib/itcSync.js, ITCDec) and the adjustments typed
// here. GSTR.threeBm (src/js/12) is wrapped below, so the GSTR-3B screen, its JSON, the carried credit and this tab read
// ONE figure. In the main bundle (not the GST screen's file): the 3B is worked out on other pages too.
//
// THE LINES (ITCF.rows): every document GST2B.run (src/js/11) pairs or leaves over, for a registration:
//   pair   in the books and in 2B (matched, amounts differ, or a probable match)
//   books  in the books, not in 2B          2b   in 2B, not in the books          rej   rejected in IMS
// A line whose tax is not this kind of credit (reverse charge, imports, tax booked as ineligible, a bill on the held
// ledger, a note we issued, credit 2B says is not available) is "fixed": shown, nothing it decides changes 3B.
// Each other line carries, by head (IGST, CGST, SGST, cess):
//   booksBy[ym]  its tax in the books in that month (signed: a note less)       full   all of it
//   lower        the lower of the books and 2B (amounts differ: the excess waits, section 16(2)(aa))
//   laterAmt     what "Take in a later month" takes (all of it for a bill booked before its 2B month, else the lower)
//   def, defAmt  the month and amount FinCom takes it in when nothing is decided: as GSTR.threeBm always did (bills not
//                in 2B held back; booked earlier and in a later 2B taken then; a supplier's credit note in 2B taken off;
//                rejected in IMS not taken)
// THE MONTH (ITCF.credit): a line's credit month C and amount from its decision:
//   none, follow, correct (in 2B)   def, defAmt          now        the month chosen (else its own), lower
//   booksnow                         the month, full      later      the month picked (else, in 2B, def), laterAmt
//   follow, correct (not in 2B), reverse, book: no month (the credit is not taken; the line carries forward)
// and its effect on 4(A)(5) of month M is (C == M ? amount : 0) - booksBy[M]: the books' tax of M is in 4(A)(5) already.
// 4(A)(5) = the books' input tax of M (not imports or reverse charge) + every line's effect + reclaimed (4(D)(1)) +
// adjustments. The same rule is written as formulas in the Excel (screens/gst/itcExcel.js), so the workbook recalculates
// to the same figures; tests/run_itc_final.js checks the rule and that with nothing decided 3B is as before.
//
// ADJUSTMENTS: S.books.itcAdj[id] = {reg, ym, line (4A1 4A2 4A3 4A5 4B1 4B2 4D2), head, amt (+ or -), reason, by, at,
// log, deleted?: {by, at, reason}} (one of BOOKS_KEYS; taken out = kept, marked deleted, like TDS's added deductions).
import { ITCDec, DECS, DEC_LABEL } from "./itcSync.js";

const H = ["igst", "cgst", "sgst", "cess"];
export const HEADS = [["igst", "IGST"], ["cgst", "CGST"], ["sgst", "SGST"], ["cess", "Cess"]];
export const LINES = [["4A1", "4(A)(1) Import of goods"], ["4A2", "4(A)(2) Import of services"], ["4A3", "4(A)(3) Inward supplies on reverse charge"], ["4A5", "4(A)(5) All other ITC"],
  ["4B1", "4(B)(1) Reversed: rules 38, 42, 43 and section 17(5)"], ["4B2", "4(B)(2) Reversed: others"], ["4D2", "4(D)(2) Ineligible ITC"]];
export const LINE_LABEL = Object.fromEntries(LINES);
export const CHIPS = [["matched", "Matched"], ["books", "In books, not in 2B"], ["2b", "In 2B, not in books"], ["diff", "Amount differs"], ["ims", "Rejected/Pending in IMS"], ["cf", "Carried forward"]];
const z = () => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const N = (v) => (typeof num === "function" ? num(v) : +v || 0);
const R = (v) => Math.round((N(v) + Number.EPSILON) * 100) / 100;
const add = (o, x, f = 1) => { H.forEach((k) => { o[k] = R(o[k] + N((x || {})[k]) * f); }); return o; };
const sub = (a, c) => { const o = z(); H.forEach((k) => { o[k] = R(N(a && a[k]) - N(c && c[k])); }); return o; };
const tot = (o) => R(H.reduce((a, k) => a + N((o || {})[k]), 0));
const nz = (o) => !!o && H.some((k) => Math.abs(N(o[k])) >= 0.005);
const heads = (x, f = 1) => add(z(), x, f);
const bkey = (d) => "B|" + (d.gstin || d.party) + "|" + d.noN + "|" + d.dir;
const pkey = (p) => "P|" + p.gstin + "|" + p.noN + "|" + p.dir;
// which decisions a line may take
const ALLOW = { pair: ["now", "later", "booksnow", "follow", "correct", "reverse"], books: ["now", "booksnow", "later", "follow", "correct", "reverse"],
  "2b": ["now", "later", "follow", "correct", "reverse", "book"], cn: ["now", "reverse", "follow"], rej: ["now", "follow", "correct", "reverse"], fixed: ["follow", "correct"] };
const who = () => { try { return (Cloud.st && Cloud.st.email) || ((Cloud.sess && Cloud.sess()) || {}).email || ""; } catch (e) { return ""; } };
const lab = (ym) => (ym && typeof GSTR === "object" ? GSTR.label(ym) : ym || "");

// ---------- the lines of a registration
function build(reg) {
  const b = S.books || {}, res = GST2B.run(reg), choice = ((b.itcBasis || {})[reg || ""]) || "2b";
  const loaded = new Set(GST2B.all2b(reg).map((t) => t.ym)), on = (ym) => !!reg && choice === "2b" && loaded.has(ym);
  const vById = new Map((b.vouchers || []).map((v) => [v.id, v]));
  const imp = (d) => { const v = vById.get(d.id); return !!(v && Books.isImport(v)); };
  const claim = (d) => d.dir > 0 && !d.rcm && !d.ineligible && !d.held && !imp(d);
  const why = (d) => (d.rcm ? "reverse charge: 4(A)(3)" : imp(d) ? "import: 4(A)(1)" : d.ineligible ? "booked as ineligible" : d.held ? "on the held ledger: taken when moved" : d.dir < 0 ? "note: credit already reduced" : "");
  const rows = [];
  const money = (r, docs) => { r.booksBy = {}; docs.forEach((d) => { const ym = d.eb || d.ym; r.booksBy[ym] = add(r.booksBy[ym] || z(), d, d.dir || 1); }); };
  res.pairs.forEach((x) => {
    const p = x.p, d0 = x.books[0], docs = x.books.filter(claim);
    const r = { key: bkey(d0), alt: [pkey(p), "D|" + p.gstin + "|" + p.noN + "|" + p.dir], tagKeys: [p.key].concat(x.books.map((d) => d.id)), kind: "pair", status: x.status, x, p, docs: x.books,
      party: p.party || d0.party, gstin: p.gstin || d0.gstin, no: p.no, bookNo: x.books.map((d) => d.no).join(", "), voucher: x.books.map((d) => d.voucher).join(", "), date: p.date || d0.date,
      tm: p.ym, bm: d0.ym, ims: p.ims, issues: x.issues, bTax: x.books.reduce((a, d) => add(a, d, d.dir || 1), z()), pTax: heads(p, p.dir || 1) };
    if (!docs.length) { r.fixed = why(d0) || "nothing to take"; rows.push(r); return; }
    r.bm = docs[0].ym; money(r, docs);
    const full = docs.reduce((a, d) => add(a, d), z());
    let lower = full;
    // amounts differ: the lower of Tally and 2B is taken, the excess waits (as GSTR.threeBm: on the 2B basis only)
    if (x.status === "diff" && on(r.bm)) {
      const bt = tot(full), pt = tot(p), ex = R(bt - pt);
      if (ex >= 1 && bt > 0) { const f = ex / bt; lower = z(); docs.forEach((d) => H.forEach((k) => { lower[k] = R(lower[k] + N(d[k]) - R(N(d[k]) * f)); })); }
    }
    r.full = full; r.lower = lower;
    r.def = p.ym > r.bm && on(r.bm) ? p.ym : r.bm;
    r.defAmt = r.def === r.bm ? lower : full;
    r.laterAmt = p.ym > r.bm ? full : lower;
    // the GST rate (the owner, 24-Oct-2026: "if charged 5% then no ITC, if charged 18% then full ITC"): the books' own
    // (GST2B.bookDocs), else 2B's; at 5% (a tour operator's rate) the credit is not taken unless decided; none: unknown
    const rate = (docs.find((d) => d.gstRate) || {}).gstRate || (docs.some((d) => d.ru) ? GST2B.rateOf(p) : 0);
    if (docs.some((d) => d.noItc) || (docs.some((d) => d.ru || d.gstRate) && Math.abs(rate - 5) < 0.01)) { r.noItc = "5% tour operator rate: no ITC"; r.def = ""; }
    else if (docs.some((d) => d.ru) && !rate) { r.rateUnknown = true; r.def = ""; }   // not taken until the rate is known (decided)
    rows.push(r);
  });
  res.onlyBooks.forEach((d) => {
    const r = { key: bkey(d), alt: [], tagKeys: [d.id], kind: "books", docs: [d], party: d.party, gstin: d.gstin, bookNo: d.no, voucher: d.voucher, date: d.date, bm: d.ym, bTax: heads(d, d.dir || 1),
      nob: !loaded.has(d.ym) };
    if (!claim(d)) { r.fixed = why(d); rows.push(r); return; }
    money(r, [d]); r.full = r.lower = r.laterAmt = r.defAmt = heads(d); r.def = on(d.ym) ? "" : d.ym;
    if (d.noItc) { r.noItc = d.noItc; r.def = ""; } else if (d.ru) r.rateUnknown = true;
    rows.push(r);
  });
  res.only2b.forEach((p) => {
    const r = { key: pkey(p), alt: [], tagKeys: [p.key], kind: "2b", p, party: p.party, gstin: p.gstin, no: p.no, date: p.date, tm: p.ym, ims: p.ims, pTax: heads(p, p.dir || 1), cn: p.dir < 0 };
    if (p.itcavl === "N") r.fixed = "2B: credit not available, 4(D)(2)";
    else if (p.sec === "impg" || p.sec === "impgsez") r.fixed = "import: credit through the bill of entry in the books, 4(A)(1)";
    else if (p.rcm && p.dir > 0) r.fixed = "reverse charge: credit through the books, 4(A)(3)";
    if (r.fixed) { rows.push(r); return; }
    r.booksBy = {}; r.full = r.lower = r.laterAmt = r.defAmt = heads(p, p.dir || 1);
    r.def = p.dir < 0 && on(p.ym) ? p.ym : "";
    rows.push(r);
  });
  (res.rejected || []).forEach((x) => {
    const p = x.p;
    const r = { key: "R|" + p.key, alt: [], tagKeys: [p.key], kind: "rej", p, x, docs: x.books, party: p.party || (x.books[0] || {}).party, gstin: p.gstin, no: p.no, bookNo: x.books.map((d) => d.no).join(", "),
      voucher: x.books.map((d) => d.voucher).join(", "), date: p.date, tm: p.ym, bm: (x.books[0] || {}).ym, ims: "R", remarks: p.remarks || "", pTax: heads(p, p.dir || 1), bTax: x.books.reduce((a, d) => add(a, d, d.dir || 1), z()) };
    // as GSTR.threeBm: no credit in the month booked (on the 2B basis), else in the month of the 2B that shows the rejection
    const docs = x.books.filter((d) => !d.rcm && !d.ineligible && !d.held).map((d) => Object.assign({}, d, { eb: on(d.ym) ? d.ym : p.ym > d.ym && on(p.ym) ? p.ym : "" })).filter((d) => d.eb);
    if (!docs.length) { r.fixed = x.books.length ? "taken as booked (no 2B for its month)" : "rejected in IMS, not in the books: no credit"; rows.push(r); return; }
    money(r, docs); r.bm = docs[0].eb;
    r.full = r.lower = r.laterAmt = r.defAmt = docs.reduce((a, d) => add(a, d, d.dir || 1), z()); r.def = "";
    rows.push(r);
  });
  rows.forEach((r) => { r.home = [r.bm, r.tm].filter(Boolean).sort()[0] || ""; r.allow = ALLOW[r.fixed ? "fixed" : r.cn ? "cn" : r.kind]; });
  return { rows, res, loaded, on };
}

// ---------- a line's decision and its credit month
export function credit(r, s) {
  const allowed = r.allow || [];
  const d = s && s.d && allowed.includes(s.d) ? s.d : "";
  if (r.fixed) return { code: d, C: "", amt: z(), auto: !d };
  if (!d) return { code: "", C: r.def || "", amt: r.defAmt, auto: true };
  const own = r.bm || r.tm || "";
  if (d === "now") return { code: d, C: (s.ym || own), amt: r.lower };
  if (d === "booksnow") return { code: d, C: (s.ym || own), amt: r.full };
  if (d === "later") return { code: d, C: s.ym || (r.kind === "pair" ? r.def : ""), amt: r.laterAmt };
  if (d === "follow" || d === "correct") return r.kind === "pair" ? { code: d, C: r.def, amt: r.defAmt } : { code: d, C: "", amt: z() };
  return { code: d, C: "", amt: z() };
}
// the decision as the screen and the Excel say it in month M: an automatic one in words (Take now in its month, Take in a
// later month for one taken later, Follow up for a bill held for 2B, Book in Tally for a document only in 2B)
export function shown(r, e, M) {
  if (r.fixed) return { code: e.code, ym: "" };
  let code = e.code;
  if (e.auto) code = e.C ? "now" : r.noItc ? "reverse" : r.kind === "books" ? "follow" : r.cn ? "follow" : r.kind === "2b" ? "book" : r.kind === "rej" ? "reverse" : "follow";
  if ((code === "now" || code === "booksnow" || code === "later") && e.C && e.C !== M) return { code: "later", ym: e.C };
  if (code === "later" && !e.C) return { code: "later", ym: "" };
  if (code === "later" && e.C === M) return { code: "now", ym: "" };
  return { code, ym: code === "later" ? e.C : "" };
}
// the line's effect on 4(A)(5) of month M
export function effect(r, e, M) { const o = sub(e.C === M ? e.amt : z(), (r.booksBy || {})[M] || z()); return o; }
const isOpen = (r, e) => !r.fixed && !e.C && e.code !== "reverse" && !(e.auto && r.noItc);

// ---------- the model, worked out once for what it depends on
let memo = null;
function model(reg) {
  const b = S.books || {};
  if (!b.vouchers && !b.twoBs) return null;
  const res = GST2B.run(reg), key = [reg, ITCDec.sig(b), Object.keys(b.twoBs || {}).join(",")].join("|");
  if (memo && memo.key === key && memo.res === res && memo.v === b.vouchers) return memo.m;
  const m = build(reg);
  m.rows.forEach((r) => { r.s = ITCDec.get(reg, [r.key].concat(r.alt), r.tagKeys); r.e = credit(r, r.s); r.open = isOpen(r, r.e); });
  m.byTag = new Map(); m.rows.forEach((r) => r.tagKeys.forEach((k) => m.byTag.set(k, r)));
  memo = { key, res, v: b.vouchers, m };
  return m;
}

// the chip of a line in month M
function chipOf(r, M) {
  if (r.kind === "rej" || r.ims === "R" || r.ims === "P") return "ims";
  const inB = r.bm === M || !!(r.booksBy || {})[M];
  if (r.kind === "pair") {
    if (inB && r.tm <= M) return r.status === "diff" ? "diff" : "matched";
    if (inB) return "books";
    if (r.tm === M) return r.bm && r.bm < M ? "cf" : "2b";
    return "cf";
  }
  if (r.kind === "books") return r.bm === M ? "books" : "cf";
  if (r.kind === "2b") return r.tm === M ? "2b" : "cf";
  return "cf";
}

// ---------- the month: its lines and what they do to 4(A)(5)
function month(reg, M) {
  const m = model(reg);
  const cats = { held: [], excess: [], released: [], from2b: [], cn2b: [], rejBack: [] };
  const out = { rows: [], cats, effect: z() };
  if (!m) return out;
  m.rows.forEach((r) => {
    const e = r.e, inM = r.bm === M || r.tm === M || !!(r.booksBy || {})[M] || e.C === M;
    if (!inM && !(r.open && r.home && r.home < M)) return;
    const ef = r.fixed ? z() : effect(r, e, M), bk = (r.booksBy || {})[M], tk = e.C === M ? e.amt : null;
    const v = Object.assign({}, r, { chip: chipOf(r, M), show: shown(r, e, M), eff: ef });
    out.rows.push(v);
    if (r.fixed || !nz(ef) && !(bk && tk)) return;
    add(out.effect, ef);
    const put = (k, amt) => { if (nz(amt)) cats[k].push({ r: v, amt }); };
    if (r.kind === "rej") { if (tot(bk || tk || z()) >= 0) (tot(ef) < 0 ? put("held", heads(ef, -1)) : put("released", ef)); else put("rejBack", ef); }
    else if (r.kind === "2b") { if (tk) (r.cn ? put("cn2b", heads(tk, -1)) : put("from2b", tk)); }
    else if (bk && !tk) put("held", bk);
    else if (bk && tk) { const d = sub(bk, tk); if (tot(d) > 0) put("excess", d); else put("released", heads(d, -1)); }
    else if (tk) put("released", tk);
  });
  return out;
}
const sumCat = (list) => { const o = Object.assign(z(), { n: list.length, list: list.map((x) => Object.assign({}, x.r, { amt: x.amt })) }); list.forEach((x) => add(o, x.amt)); return o; };

// ---------- adjustments
const ADJ = () => ((S.books || {}).itcAdj) || {};
export const Adj = {
  list(reg, ym) { const A = ADJ(); return Object.keys(A).filter((k) => A[k] && !A[k].deleted && A[k].reg === (reg || "") && A[k].ym === ym).map((k) => Object.assign({ id: k }, A[k])).sort((a, c) => String(a.at).localeCompare(String(c.at))); },
  removed(reg, ym) { const A = ADJ(); return Object.keys(A).filter((k) => A[k] && A[k].deleted && A[k].reg === (reg || "") && A[k].ym === ym).map((k) => Object.assign({ id: k }, A[k])); },
  problem(x) {
    if (!LINE_LABEL[x.line]) return "Choose the 3B line.";
    if (!H.includes(x.head)) return "Choose IGST, CGST, SGST or cess.";
    if (!/^-?\d+(\.\d+)?$/.test(String(x.amt).replace(/,/g, "").trim()) || Math.abs(N(String(x.amt).replace(/,/g, ""))) < 0.005) return "Give the amount: more than nil, a minus to reduce.";
    if (!String(x.reason || "").trim()) return "Say why (the reason is kept with the adjustment).";
    return "";
  },
  // add (no id) or change one: {ok, why, id}
  save(reg, ym, x, id) {
    const why = this.problem(x); if (why) return { ok: false, why };
    const b = S.books, at = new Date().toISOString(), by = who();
    b.itcAdj = Object.assign({}, b.itcAdj || {});
    const k = id || "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), was = b.itcAdj[k];
    b.itcAdj[k] = { reg: reg || "", ym, line: x.line, head: x.head, amt: R(N(String(x.amt).replace(/,/g, ""))), reason: String(x.reason).trim(), by: was ? was.by : by, at: was ? was.at : at,
      log: (was ? was.log || [] : []).concat([{ act: was ? "edit" : "add", by, at }]) };
    saveBooks();
    return { ok: true, id: k };
  },
  remove(id, reason) {
    const b = S.books, x = (b.itcAdj || {})[id];
    if (!x) return { ok: false, why: "No such adjustment." };
    if (!String(reason || "").trim()) return { ok: false, why: "Say why it is taken out." };
    b.itcAdj = Object.assign({}, b.itcAdj, { [id]: Object.assign({}, x, { deleted: { by: who(), at: new Date().toISOString(), reason: String(reason).trim() } }) });
    saveBooks();
    return { ok: true };
  },
  // by 3B line, each head
  sum(reg, ym) { const o = {}; LINES.forEach(([k]) => { o[k] = z(); }); this.list(reg, ym).forEach((a) => { o[a.line][a.head] = R(o[a.line][a.head] + N(a.amt)); }); return o; },
};

// ---------- the wrap of GSTR.threeBm: 4(A)(5) from the decisions, the adjustments on every line, payment again
function apply(t, ym, reg) {
  if (!t || t.quarter) return t;
  const A = Adj.sum(reg, ym), anyAdj = LINES.some(([k]) => nz(A[k]));
  const hasDec = Object.keys(((S.books || {}).itcDec) || {}).some((k) => k.startsWith((reg || "") + "|"));
  const has2b = typeof GST2B === "object" && reg && GST2B.all2b(reg).length > 0;
  // the books' input tax of the month (what GSTR.threeBm started from), before anything for 2B
  const g = (o) => o || z(), base = z();
  H.forEach((k) => { base[k] = R(N(t.other[k]) + N(g(t.held)[k]) - N(g(t.released)[k]) + N(g(t.cn2b)[k]) - N(g(t.rejBack)[k]) - N(g(t.reclaim)[k])); });
  if (!anyAdj && !hasDec && !has2b) return Object.assign(t, { itcBase: base, itcAdj: A });
  const mo = has2b || hasDec ? month(reg, ym) : { cats: { held: [], excess: [], released: [], from2b: [], cn2b: [], rejBack: [] }, effect: z(), rows: [] };
  const c = mo.cats, held = sumCat(c.held.concat(c.excess)), released = sumCat(c.released.concat(c.from2b)), cn2b = sumCat(c.cn2b), rejBack = sumCat(c.rejBack);
  const other = Object.assign({}, t.other);
  H.forEach((k) => { other[k] = R(base[k] - held[k] + released[k] - cn2b[k] + rejBack[k] + N(g(t.reclaim)[k]) + A["4A5"][k]); });
  const plus = (o, a) => { const x = Object.assign({}, o || {}); H.forEach((k) => { x[k] = R(N(x[k]) + a[k]); }); return x; };
  const impGoods = plus(t.impGoods, A["4A1"]), impServ = plus(t.impServ, A["4A2"]), rcmIn = plus(t.rcmIn, A["4A3"]);
  const itc = {}; H.forEach((k) => { itc[k] = R(N(impGoods[k]) + N(impServ[k]) + N(rcmIn[k]) + N(other[k])); });
  const rev1 = plus(t.rev1, A["4B1"]), rev2 = plus(t.rev2, A["4B2"]), na = plus(t.na, A["4D2"]);
  const netItc = {}; H.forEach((k) => { netItc[k] = R(itc[k] - N(rev1[k]) - N(rev2[k])); });
  const pay = GSTR.setOff(t.net, t.rcmOut, netItc, t.opening);
  return Object.assign(t, { other, impGoods, impServ, rcmIn, itc, rev1, rev2, na, netItc, pay, payable: pay.cash, held, released, cn2b, rejBack, itcBase: base, itcAdj: A,
    itcCats: { held: sumCat(c.held), excess: sumCat(c.excess), released: sumCat(c.released), from2b: sumCat(c.from2b), cn2b, rejBack } });
}
if (typeof GSTR === "object" && GSTR.threeBm && !GSTR.threeBm.itcFinal) {
  const orig = GSTR.threeBm;
  GSTR.threeBm = function (ym, reg) {
    const t = orig.call(this, ym, reg);
    try { return apply(t, ym, reg); } catch (e) { if (typeof console === "object") console.error("ITC final", e); return t; }
  };
  GSTR.threeBm.itcFinal = true;
  GSTR.threeBm.orig = orig;
}

// ---------- letters to suppliers: every line set to follow up or ask to correct
function lettersOf(reg, rows) {
  const st = typeof ITCT === "object" ? ITCT.store(reg) : { sent: {}, contact: {} }, m = {};
  rows.filter((r) => r.show.code === "follow" || r.show.code === "correct").forEach((r) => {
    const k = r.gstin || r.party || "?", s = m[k] = m[k] || { key: k, gstin: r.gstin, party: r.party, rows: [], tax: 0 };
    s.rows.push(r); s.tax = R(s.tax + Math.abs(tot(r.kind === "2b" ? r.pTax : r.kind === "pair" && r.status === "diff" ? sub(r.bTax, r.pTax) : r.bTax || r.pTax)));
  });
  return Object.values(m).map((s) => {
    const c = typeof GSTSet === "object" ? GSTSet.contact(s.gstin, s.party, st.contact[s.key]) : {}, sent = (st.sent || {})[s.key] || [];
    return Object.assign(s, { email: c.email || "", phone: c.phone || "", sent, lastSent: sent[sent.length - 1] || "", text: letter(reg, s) });
  }).sort((a, c) => c.tax - a.tax);
}
function letter(reg, s) {
  const co = (typeof CO === "function" && CO()) || {}, m = (v) => INR.format(R(v)), d = (x) => GSTAmend.dmy(x), taxOf = (o) => m(Math.abs(tot(o)));
  const g = (GSTR.gstins(S.books) || []).find((x) => x.slice(0, 2) === reg) || co.gstin || "";
  const parts = [
    ["Invoices in our books that do not appear in our GSTR-2B. Please report them in your GSTR-1 / IFF:", s.rows.filter((r) => r.kind === "books" && !r.fixed), (r) => "Invoice " + r.bookNo + " dated " + d(r.date) + ", tax " + taxOf(r.bTax)],
    ["Invoices reported with different figures. Please amend them in your GSTR-1:", s.rows.filter((r) => r.kind === "pair"), (r) => "Invoice " + (r.no || r.bookNo) + " dated " + d(r.date) + ": tax " + taxOf(r.bTax) + " in our books, " + taxOf(r.pTax) + " in your return"],
    ["Credit notes you issued to us that are not in your return:", s.rows.filter((r) => r.kind === "books" && r.fixed), (r) => "Note " + r.bookNo + " dated " + d(r.date) + ", tax " + taxOf(r.bTax)],
    ["Documents we have rejected in the Invoice Management System. Please amend or cancel them in your GSTR-1A / GSTR-1:", s.rows.filter((r) => r.kind === "rej"), (r) => (r.p.dir < 0 ? "Credit note " : "Invoice ") + r.no + " dated " + d(r.date) + ", tax " + taxOf(r.pTax) + (r.remarks ? " (" + r.remarks + ")" : "")],
    ["Documents in our GSTR-2B that are not in our books. Please check them and correct or cancel them in your GSTR-1A / GSTR-1:", s.rows.filter((r) => r.kind === "2b"), (r) => r.no + " dated " + d(r.date) + ", tax " + taxOf(r.pTax)],
  ].filter((p) => p[1].length);
  let t = "Dear " + (s.party || "Sir/Madam") + ",\n\nWe are " + (co.name || "") + (g ? " (GSTIN " + g + ")" : "") + ". Our GST credit depends on your returns, so please look at the following:\n";
  parts.forEach(([h, list, f], i) => { t += "\n" + (i + 1) + ". " + h + "\n" + list.map((r, j) => "   " + (j + 1) + ". " + f(r)).join("\n") + "\n"; });
  t += "\nThe last date for us to take this credit is 30 November after the end of the year of each invoice. Please confirm once reported.\n\nRegards,\n" + (co.name || "");
  return t;
}

// ---------- what the screens, the Excel and the tests use
export const ITCF = {
  DECS, DEC_LABEL, LINES, LINE_LABEL, CHIPS, HEADS, credit, shown, effect,
  rows(reg) { const m = model(reg); return m ? m.rows : []; },
  month(reg, M) { return month(reg, M); },
  rowByTagKey(reg, k) { const m = model(reg); return m ? m.byTag.get(k) || null : null; },
  row(reg, key) { const m = model(reg); return m ? m.rows.find((r) => r.key === key) || null : null; },
  letters(reg, rows) { return lettersOf(reg, rows); },
  // the figures of table 4 for the month, as GSTR-3B has them
  table4(reg, ym) {
    const t = GSTR.threeB(ym, reg), g = (o) => heads(o || z());
    const A = [["4A1", g(t.impGoods)], ["4A2", g(t.impServ)], ["4A3", g(t.rcmIn)], ["4A5", g(t.other)]];
    const sumA = A.reduce((a, [, x]) => add(a, x), z());
    return { t, lines: A.concat([["4A", sumA], ["4B1", g(t.rev1)], ["4B2", g(t.rev2)], ["4C", g(t.netItc)], ["4D1", g(t.reclaim)], ["4D2", g(t.na)]]) };
  },
  // a line's decision, set from the screen or the Excel (M: the month on screen; "now" there is that month)
  decide(reg, rows, code, ym, M) {
    const ok = [], refused = [];
    rows.forEach((r) => { if (!code || (r.allow || []).includes(code)) ok.push(r); else refused.push(r); });
    if (ok.length) ITCDec.set(reg, ok.map((r) => r.key), code, code === "later" ? ym : code === "now" || code === "booksnow" ? M : "");
    return { ok: ok.length, refused };
  },
  logSent(reg, key) { if (typeof ITCT !== "object") return; const st = ITCT.store(reg); st.sent[key] = (st.sent[key] || []).concat([ITCT.today()]); saveBooks(); },
  // ---- the Excel's data (the workbook itself is screens/gst/itcExcel.js, with ExcelJS)
  months(M) { const all = GSTR.months(), out = new Set(all); for (let i = 0, y = +M.slice(0, 4), m = +M.slice(4); i < 15; i++) { out.add(y + String(m).padStart(2, "0")); m++; if (m > 12) { m = 1; y++; } } return Array.from(out).sort(); },
  excelData(reg, M) {
    const mo = month(reg, M), t = GSTR.threeB(M, reg), A = Adj.sum(reg, M), g = (o) => heads(o || z());
    const base = t.itcBase || z(), lines = mo.rows.slice().sort((a, c) => String(a.party || "").localeCompare(String(c.party || "")) || String(a.date || "").localeCompare(String(c.date || "")));
    const reclaim = g(t.reclaim);
    const sansAdj = (o, k) => sub(g(o), A[k]);
    return {
      reg, M, label: lab(M), gstin: (GSTR.gstins(S.books) || []).find((x) => x.slice(0, 2) === reg) || "", client: ((typeof CO === "function" && CO()) || {}).name || "", cid: S.coId || "",
      months: this.months(M).map((m) => [m, lab(m)]), decs: DECS, lines: LINES,
      rows: lines.map((r) => ({ key: r.key, chip: r.chip, status: (CHIPS.find((c) => c[0] === r.chip) || [])[1] || "", kind: r.fixed ? "fixed" : r.kind, party: r.party || "", gstin: r.gstin || "",
        no: r.no || "", bookNo: r.bookNo || "", date: r.date || "", bm: lab(r.bm), tm: lab(r.tm), bTax: g(r.bTax), pTax: g(r.pTax), dec: r.show.code ? DEC_LABEL[r.show.code] : "", takeIn: lab(r.show.ym), note: (r.s && r.s.note) || "",
        def: lab(r.def), booksM: g((r.booksBy || {})[M]), lower: g(r.lower), full: g(r.full), later: g(r.laterAmt), defAmt: g(r.defAmt), fixed: r.fixed || "", allow: r.allow,
        eff: g(r.eff) })),
      base: { "4A5": base, reclaim, "4A1": sansAdj(t.impGoods, "4A1"), "4A2": sansAdj(t.impServ, "4A2"), "4A3": sansAdj(t.rcmIn, "4A3"), "4B1": sansAdj(t.rev1, "4B1"), "4B2": sansAdj(t.rev2, "4B2"), "4D2": sansAdj(t.na, "4D2") },
      adj: Adj.list(reg, M).map((a) => ({ id: a.id, line: a.line, head: a.head, amt: a.amt, reason: a.reason })),
      table4: this.table4(reg, M).lines,
      inreg: typeof inregRows === "function" ? (() => { const keep = S.inregScope; S.inregScope = "month"; try { return inregRows(S.books).rows; } finally { S.inregScope = keep; } })() : [],
    };
  },
  // what an Excel brought back would change: {changes: [{r, from, to}], unknown: [keys], missing: [rows], adj: {add, edit, del}, refused}
  preview(reg, M, x) {
    const mo = month(reg, M), byKey = new Map(mo.rows.map((r) => [r.key, r])), seen = new Set(), changes = [], unknown = [], refused = [], notes = [];
    const codeOf = (l) => { const f = DECS.find(([, w]) => w.toLowerCase() === String(l || "").trim().toLowerCase()); return f ? f[0] : l ? null : ""; };
    const ymOf = (l) => { if (!l) return ""; const s = String(l).trim(), f = this.months(M).find((m) => lab(m).toLowerCase() === s.toLowerCase() || m === s); return f || null; };
    (x.rows || []).forEach((y) => {
      const r = byKey.get(y.key);
      if (!r) { unknown.push(y); return; }
      seen.add(y.key);
      const code = codeOf(y.dec), ym = ymOf(y.takeIn);
      if (code === null) { refused.push({ r, why: "“" + y.dec + "” is not one of the choices" }); return; }
      if (ym === null) { refused.push({ r, why: "“" + y.takeIn + "” is not a month" }); return; }
      if (code && !(r.allow || []).includes(code)) { refused.push({ r, why: DEC_LABEL[code] + " is not a choice for this line" }); return; }
      if (code === "later" && ym && ym <= M && r.show.code !== "later") { refused.push({ r, why: "Take in a later month: the month " + lab(ym) + " is not after " + lab(M) }); return; }
      const now = r.show, to = { code: code === "later" && !ym ? "later" : code, ym: code === "later" ? ym : "" };
      if (code === "now" || code === "booksnow") to.ym = "";
      const same = now.code === to.code && (now.ym || "") === (to.ym || "");
      if (!same) changes.push({ r, from: now, to });
      if (String(y.note || "") !== String((r.s && r.s.note) || "")) notes.push({ r, note: String(y.note || "") });
    });
    const missing = mo.rows.filter((r) => !seen.has(r.key));
    const cur = Adj.list(reg, M), byId = new Map(cur.map((a) => [a.id, a])), aseen = new Set(), adj = { add: [], edit: [], del: [], bad: [] };
    (x.adj || []).forEach((a, i) => {
      if (!a.line && !a.head && !N(a.amt) && !String(a.reason || "").trim()) return;
      const lineK = (LINES.find(([k, l]) => l === a.line || k === a.line) || [])[0] || "", headK = (HEADS.find(([k, l]) => l.toLowerCase() === String(a.head || "").toLowerCase() || k === a.head) || [])[0] || "";
      const v = { line: lineK, head: headK, amt: a.amt, reason: a.reason || "" }, why = Adj.problem(v);
      if (why) { adj.bad.push({ row: a.row || i + 2, why }); return; }
      const was = a.id && byId.get(a.id);
      if (a.id && !was) { adj.bad.push({ row: a.row || i + 2, why: "its hidden ID is not one of this month's adjustments" }); return; }
      if (was) { aseen.add(a.id); if (was.line !== v.line || was.head !== v.head || R(was.amt) !== R(N(v.amt)) || was.reason !== String(v.reason).trim()) adj.edit.push(Object.assign({ id: a.id, was }, v)); }
      else adj.add.push(v);
    });
    cur.forEach((a) => { if (!aseen.has(a.id)) adj.del.push(a); });
    return { changes, notes, unknown, missing, refused, adj, final: x.final || null };
  },
  // Apply: every decision, month, note and adjustment as in the file
  applyImport(reg, M, pv) {
    const b = S.books, at = new Date().toISOString(), by = who();
    b.itcDec = Object.assign({}, b.itcDec || {});
    pv.changes.forEach(({ r, to }) => {
      const id = (reg || "") + "|" + r.key, was = b.itcDec[id] || {};
      const ym = to.code === "later" ? to.ym || "" : to.code === "now" || to.code === "booksnow" ? M : "";
      b.itcDec[id] = Object.assign({}, was, { d: to.code || "", ym, at, by, from: "excel" });
      if (was.note == null && r.s && r.s.note) b.itcDec[id].note = r.s.note;
    });
    pv.notes.forEach(({ r, note }) => {
      const id = (reg || "") + "|" + r.key, was = b.itcDec[id];
      if (was) b.itcDec[id] = Object.assign({}, was, { note });
      else { const sh = r.s && r.s.src !== "you" && r.s.d ? { d: r.s.d, ym: r.s.ym || "" } : { d: "", ym: "" }; b.itcDec[id] = Object.assign(sh, { note, at: (r.s && r.s.at) || at, by }); }
    });
    pv.adj.add.forEach((a) => Adj.save(reg, M, a));
    pv.adj.edit.forEach((a) => Adj.save(reg, M, a, a.id));
    pv.adj.del.forEach((a) => Adj.remove(a.id, "taken out in the Excel brought back"));
    saveBooks();
  },
};
Object.assign(globalThis, { ITCF, ITCAdj: Adj });
