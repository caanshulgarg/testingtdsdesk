// node run_ai.js - AI help, 2B pairing: only close candidates of the same supplier are shown to AI, only a confident
// pick among them is kept, and nothing is linked until accepted
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "INR", "esc", "AIH"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const st = {link: {}, confirm: {}};
Object.assign(ctx, {GST2B: {state: () => st}, GSTAmend: {dmy: d => d}, saveBooks: async () => {}, render(){}, errCopy: c => String(c), claudeReady: () => true,
  CO: () => ({id: "c1"}), RULE_DEFAULTS: []});
ctx.S.firm = {ai: {on: true}};
ctx.S.books = {cid: "c1"};
const A = x.AIH;
const p = {key: "k1", dir: "in", gstin: "07AAACR1234A1Z5", no: "INV/24-25/0045", date: "20250605", taxable: 10000, igst: 1800, party: "R Traders"};
const same = {id: "v1", dir: "in", gstin: "07AAACR1234A1Z5", no: "45", voucher: "P-12", date: "20250606", taxable: 10000, igst: 1800};
const otherPan = {id: "v2", dir: "in", gstin: "07BBBCR9999B1Z5", no: "45", voucher: "P-13", date: "20250606", taxable: 10000, igst: 1800};
const far = {id: "v3", dir: "in", gstin: "07AAACR1234A1Z5", no: "46", voucher: "P-14", date: "20250606", taxable: 90000, igst: 16200};
const noGst = {id: "v4", dir: "in", gstin: "", no: "0045", voucher: "P-15", date: "20250607", taxable: 10001, igst: 1800};
const c = A.cands(p, [same, otherPan, far, noGst]);
ok(c.length === 2 && c.some(d => d.id === "v1") && c.some(d => d.id === "v4"), "only close entries of the same supplier (or with no GSTIN) are candidates: " + c.map(d => d.id).join(","));
let prompt = "";
ctx.claudeRead = async pr => { prompt = pr; return {items: [{i: 0, pick: c.findIndex(d => d.id === "v1"), confidence: 0.92, reason: "0045 and 45 are the same"}]}; };
A._r2 = {list: [p], free: [same, otherPan, far, noGst]};
(async () => {
  await A.pair2b();
  ok(/INV\/24-25\/0045/.test(prompt) && !/P-13/.test(prompt) && !/P-14/.test(prompt), "AI is shown the 2B invoice and only its candidates");
  const s = ctx.S.books.ai.pairs.k1;
  ok(s && s.id === "v1" && /same/.test(s.reason), "the pick is kept as a suggestion with its reason");
  ok(!st.link.k1, "nothing is linked until someone accepts it");
  ok(A.pairCell(p).includes("accept"), "the 2B row offers accept and not this");
  // a low-confidence pick is not kept
  ctx.S.books.ai.pairs = {};
  ctx.claudeRead = async () => ({items: [{i: 0, pick: 0, confidence: 0.3, reason: "maybe"}]});
  await A.pair2b();
  ok(!ctx.S.books.ai.pairs.k1, "a pick AI is not sure of is dropped");
  // a pick outside the candidates is not kept
  ctx.claudeRead = async () => ({items: [{i: 0, pick: 7, confidence: 0.95, reason: "?"}]});
  await A.pair2b();
  ok(!ctx.S.books.ai.pairs.k1, "a pick outside the candidates is dropped");
  // AI help off: nothing asked
  ctx.S.firm.ai.on = false; let asked = false; ctx.claudeRead = async () => { asked = true; return {}; };
  await A.pair2b();
  ok(!asked && A.pairCell(p) === "", "with AI help off nothing is asked or shown");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
