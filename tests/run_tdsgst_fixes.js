// node run_tdsgst_fixes.js - round 43 (the TDS and GST end-to-end proof on a real TallyPrime 7.1, tests/run_e2e_tdsgst.py on
// branch e2e-tdsgst): each figure FinCom got wrong there, on a few made-up entries, against the law. Test data only.
//   1. an export under LUT (no IGST) is exp_typ WOPAY; with IGST, WPAY
//   2. a supply to an SEZ unit is reported in the b2b list with inv_typ SEWP (with IGST) / SEWOP (under LUT), not as an export
//   3. a credit note to an unregistered buyer against a B2C large invoice is in cdnur (typ B2CL), not netted into B2C small
//   4. table 8 (nil, exempt, non-GST): one row per supply type, intra- or inter-state, to a registered or unregistered person
//   5. a debit note raised on a customer (it credits a sales ledger and output tax) is an outward note (9B, ntty D; 3.1(a)),
//      never a purchase that takes input tax away
//   6. 194Q: TDS on the purchase value above 50 lakh: the amount the deduction is on (the TDS at 0.1%), not the whole bill
//   7. GSTR-3B of the month the amendments are reported in carries their differences in 3.1(a)
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR",
  "NORM_CACHE", "normName", "normNameRaw", "nameSim", "GSTSet", "GSTF", "GSTQ"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } }));
const CMP = "07AAACF1234A1ZH", reg = "07";
ctx.S.companies = {t: {id: "t", name: "Test", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
// one entry: [ledger, amount (Tally's sign: debit negative), {h: HSN, gr: GST rate}]
const V = (id, type, date, no, party, ent, extra) => Object.assign({id, type, date, no, party, gstin: "", pos: "", cmp: CMP, narr: "", ent: ent.map(([l, a, o]) => Object.assign({l, a}, o || {})), hsn: []}, extra || {});
const G = {h: "8471", gr: 18};
function books(vs){
  const b = {cid: "t", vouchers: vs, meta: {from: "20260401", to: "20260731", gstins: [CMP], bills: 1}, under: {"Sales": "Sales Accounts", "Purchases": "Purchase Accounts", "Beta": "Sundry Debtors", "Kappa": "Sundry Creditors"},
    groups: {"Sales Accounts": "Primary", "Purchase Accounts": "Primary", "Sundry Debtors": "Primary", "Sundry Creditors": "Primary"}, gstins: {}, states: {}, challans: [], alloc: {}, certs: []};
  b.map = x.Books.mapLedgers(vs, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  set("Output IGST", {what: "gst", kind: "gst", tax: "IGST", side: "output", reg}); set("Output CGST", {what: "gst", kind: "gst", tax: "CGST", side: "output", reg}); set("Output SGST", {what: "gst", kind: "gst", tax: "SGST", side: "output", reg});
  set("Input IGST", {what: "gst", kind: "gst", tax: "IGST", side: "input", reg});
  set("TDS Payable 194Q", {what: "tds_payable", kind: "tds_payable", section: "194Q"});
  ctx.S.books = b; return b;
}
const items = i => (i.itms || []).map(t => t.itm_det || t);
// ---- 1-5 on May 2026's GSTR-1
books([
  V("e1", "Sales", "20260502", "E/1", "Euro", [["Euro", -354000], ["Sales", 300000, G], ["Output IGST", 54000]], {country: "Germany"}),
  V("e2", "Sales", "20260502", "E/2", "Euro", [["Euro", -250000], ["Sales", 250000, G]], {country: "Germany"}),
  V("z1", "Sales", "20260501", "Z/1", "Gamma", [["Gamma", -177000], ["Sales", 150000, G], ["Output IGST", 27000]], {gstin: "29AABCG3333C1Z1", pos: "Karnataka", regType: "Regular", nature: "Sales to SEZ - Taxable"}),
  V("z2", "Sales", "20260501", "Z/2", "Delta", [["Delta", -80000], ["Sales", 80000, G]], {gstin: "33AABCD4444D1Z7", pos: "Tamil Nadu", regType: "Regular", nature: "Sales to SEZ - LUT/Bond"}),
  V("l1", "Sales", "20260502", "L/1", "Retail UP", [["Retail UP", -177000], ["Sales", 150000, G], ["Output IGST", 27000]], {pos: "Uttar Pradesh"}),
  V("c2", "Credit Note", "20260502", "CN/2", "Retail UP", [["Sales", -20000, G], ["Output IGST", -3600], ["Retail UP", 23600]], {pos: "Uttar Pradesh"}),
  V("n1", "Sales", "20260502", "N/1", "Alpha", [["Alpha", -30000], ["Sales", 30000, {h: "0701", gr: 0}]], {gstin: "07AABCA1111A1ZT", pos: "Delhi", taxability: "Nil Rated"}),
  V("n2", "Sales", "20260502", "N/2", "Walkin", [["Walkin", -20000], ["Sales", 20000, {h: "0401", gr: 0}]], {pos: "Haryana", taxability: "Exempt"}),
  V("d1", "Debit Note", "20260502", "DN/1", "Beta", [["Beta", -5900], ["Sales", 5000, G], ["Output IGST", 900]], {gstin: "27AABCB2222B1ZI", pos: "Maharashtra"}),
  V("p1", "Purchase", "20260501", "P/1", "Lambda", [["Purchases", -100000, G], ["Input IGST", -18000], ["Lambda", 118000]], {gstin: "08AABCL8888H1ZW", pos: "Delhi"}),
]);
const j = x.GSTR.toJson("202605", reg, {plain: true});
const exp = (j.exp || []).flatMap(g => g.inv.map(i => Object.assign({exp_typ: g.exp_typ}, i)));
ok((exp.find(i => i.inum === "E/1") || {}).exp_typ === "WPAY" && (exp.find(i => i.inum === "E/2") || {}).exp_typ === "WOPAY", "1. exports: E/1 with IGST WPAY, E/2 under LUT WOPAY (" + JSON.stringify(exp.map(i => [i.inum, i.exp_typ])) + ")");
const b2b = (j.b2b || []).flatMap(g => g.inv.map(i => Object.assign({ctin: g.ctin}, i)));
const z1 = b2b.find(i => i.inum === "Z/1"), z2 = b2b.find(i => i.inum === "Z/2");
ok(z1 && z1.inv_typ === "SEWP" && z2 && z2.inv_typ === "SEWOP" && !exp.some(i => /^Z\//.test(i.inum)), "2. SEZ: in the b2b list, Z/1 SEWP, Z/2 SEWOP, not in exp (" + JSON.stringify(b2b.map(i => [i.inum, i.inv_typ])) + ")");
const t3 = x.GSTR.threeB("202605", reg);
ok(Math.abs(t3.zero.taxable - 780000) < 0.01 && Math.abs(t3.zero.igst - 81000) < 0.01, "2. SEZ and exports in 3.1(b): 7,80,000 / IGST 81,000 (" + t3.zero.taxable + " / " + t3.zero.igst + ")");
const cdnur = j.cdnur || [];
ok(cdnur.length === 1 && cdnur[0].typ === "B2CL" && cdnur[0].nt_num === "CN/2" && cdnur[0].pos === "09" && Math.abs(items(cdnur[0])[0].txval - 20000) < 0.01 && !(j.b2cs || []).some(r => r.pos === "09"),
  "3. CN/2 against a B2C large invoice: cdnur typ B2CL, place 09, 20,000; not in B2C small (" + JSON.stringify({cdnur, b2cs: j.b2cs}) + ")");
const nil = {}; ((j.nil || {}).inv || []).forEach(r => { nil[r.sply_ty] = r; });
ok((nil.INTRAB2B || {}).nil_amt === 30000 && (nil.INTRB2C || {}).expt_amt === 20000 && !((nil.INTRB2B || {}).nil_amt) && !((nil.INTRB2B || {}).expt_amt), "4. table 8: nil 30,000 intra-state to registered (INTRAB2B), exempt 20,000 inter-state to unregistered (INTRB2C) (" + JSON.stringify(j.nil) + ")");
const cdnr = (j.cdnr || []).flatMap(g => g.nt.map(n => Object.assign({ctin: g.ctin}, n)));
const dn = cdnr.find(n => n.nt_num === "DN/1");
ok(dn && dn.ntty === "D" && Math.abs(items(dn)[0].txval - 5000) < 0.01 && Math.abs(items(dn)[0].iamt - 900) < 0.01, "5. DN/1 raised on a customer: 9B, ntty D, 5,000 / IGST 900 (" + JSON.stringify(cdnr) + ")");
ok(Math.abs(t3.other.igst - 18000) < 0.01 && Math.abs(t3.net.igst - (27000 + 900 - 3600)) < 0.01, "5. 3B: the debit note's IGST is outward tax (3.1(a) IGST 24,300), not input credit taken away (4(A)(5) IGST 18,000) (" + t3.net.igst + " / " + t3.other.igst + ")");
const d13 = ((j.doc_issue || {}).doc_det || []).find(d => d.doc_num === 4);
ok(d13 && d13.docs[0].totnum === 1, "5. table 13: the debit note counted under debit notes (4)");
// ---- 6. 194Q
books([V("q1", "Journal", "20260402", "JV/Q", "Tau", [["Purchase of Goods", -5500000], ["TDS Payable 194Q", 500], ["Tau", 5499500]])]);
const q = x.TDS.rows()[0] || {};
ok(Math.abs(q.paid - 500000) < 0.01 && Math.abs(q.rate - 0.1) < 0.0001, "6. 194Q: TDS 500 on a 55 lakh purchase: paid or credited 5,00,000 (above 50 lakh) at 0.1% (" + q.paid + " at " + q.rate + "%, " + q.rateFrom + ")");
// ---- 7. July's 3B carries the amendments of May reported in July's GSTR-1
const may = [V("s2", "Sales", "20260501", "S/2", "Beta", [["Beta", -236000], ["Sales", 200000, G], ["Output IGST", 36000]], {gstin: "27AABCB2222B1ZI", pos: "Maharashtra"}),
  V("s20", "Sales", "20260701", "S/20", "Alpha", [["Alpha", -11800], ["Sales", 10000, G], ["Output CGST", 900], ["Output SGST", 900]], {gstin: "07AABCA1111A1ZT", pos: "Delhi"})];
let b = books(may);
x.GSTAmend.keep(JSON.parse(JSON.stringify(x.GSTR.toJson("202605", reg))), "downloaded");
const filed = b.filed;
b = books([V("s2", "Sales", "20260501", "S/2", "Beta", [["Beta", -259600], ["Sales", 220000, G], ["Output IGST", 39600]], {gstin: "27AABCB2222B1ZI", pos: "Maharashtra"}), may[1]]);
b.filed = filed;
const jul = x.GSTR.toJson("202607", reg), t7 = x.GSTR.threeB("202607", reg);
ok((jul.b2ba || []).length === 1, "7. July's GSTR-1 carries the 9A amendment of S/2");
ok(Math.abs(t7.net.taxable - 30000) < 0.01 && Math.abs(t7.net.igst - 3600) < 0.01 && Math.abs(t7.net.cgst - 900) < 0.01, "7. July's 3.1(a): its own 10,000 and the amendment's 20,000 / IGST 3,600 (" + JSON.stringify(t7.net) + ")");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
