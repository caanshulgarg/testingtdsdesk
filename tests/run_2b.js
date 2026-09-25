// node run_2b.js - a 2B for June and July 2025 made from the VMS purchases, with faults planted; each must be found
const fs = require("fs"), {load} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const NAMES = ["num", "r2", "MONTHS", "fmtDate", "STATE_CODES", "Books", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "GRAM_CACHE", "normName", "gramsOf", "normNameRaw", "nameSim"];
let h;
try { h = load(HTML, NAMES); } catch (e){ h = load(HTML, NAMES.filter(n => n !== "GRAM_CACHE")); }
const {ctx, x} = h;
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
b.map = x.Books.mapLedgers(b.vouchers, {});
ctx.S.books = b; ctx.S.coId = "t";
const G = x.GST2B, clone = o => JSON.parse(JSON.stringify(o)), dmy = d => d.slice(6, 8) + "-" + d.slice(4, 6) + "-" + d.slice(0, 4);
// real 2B: parsed totals equal the portal's own summary
const real = G.fromJson(JSON.parse(fs.readFileSync(DATA + "/returns_R2B_09AASCA7501M2Z4_032025.json")));
const sm = JSON.parse(fs.readFileSync(DATA + "/returns_R2B_09AASCA7501M2Z4_032025.json")).data.itcsumm.itcavl.nonrevsup.b2b;
const rb = real.rows.filter(r => r.sec === "b2b");
ok(Math.abs(rb.reduce((a, r) => a + r.igst, 0) - sm.igst) < 0.01 && Math.abs(rb.reduce((a, r) => a + r.taxable, 0) - sm.txval) < 0.01, "real 2B: B2B totals equal the portal's summary (" + rb.length + " invoices)");
ok(real.rows.filter(r => r.sec === "cdnr").every(r => r.no && r.dir === -1), "real 2B: credit notes carry their numbers (ntnum) and reduce credit");
// the Tally side
const docs = G.bookDocs();
const jun = docs.filter(d => d.ym === "202506" && d.reg === "07" && d.gstin && d.dir === 1);
const jul = docs.filter(d => d.ym === "202507" && d.reg === "07" && d.gstin && d.dir === 1);
console.log("Tally, reg 07: June " + jun.length + " invoices with GSTIN, July " + jul.length + "; skipped " + JSON.stringify(G.skipped));
// build 2B JSON from Tally documents
const inv = d => ({inum: d.no, dt: dmy(d.date), val: x.r2(d.taxable + d.igst + d.cgst + d.sgst), txval: d.taxable, igst: d.igst, cgst: d.cgst, sgst: d.sgst, cess: 0, rev: "N", itcavl: "Y", rsn: "", typ: "R", pos: "07", imsStatus: "N"});
const make = (period, list, extra) => {
  const by = {};
  list.forEach(d => { (by[d.gstin] = by[d.gstin] || {ctin: d.gstin, trdnm: d.party, supfildt: "11-" + period.slice(0, 2) + "-" + period.slice(2), supprd: period, inv: []}).inv.push(inv(d)); });
  const dd = {b2b: Object.values(by)};
  Object.assign(dd, extra || {});
  return {data: {gstin: "07AADCV3366N1ZU", rtnprd: period, gendt: "14-" + period.slice(0, 2) + "-" + period.slice(2), docdata: dd}};
};
const J = jun.slice(), plant = {};
plant.missing2b = J.splice(0, 3);                                     // booked, not reported by the supplier
plant.diff = J[0]; plant.fmt = J.find((d, i) => i > 0 && /^\d{1,6}$/.test(d.no)) || J[1]; plant.renum = J.find(d => d !== plant.fmt && d !== plant.diff && !/^\d+$/.test(d.no)) || J[2];
plant.heads = J.find(d => d.igst > 0 && ![plant.diff, plant.fmt, plant.renum].includes(d));
plant.late = J[J.length - 1];                                          // the supplier reports it in July
const junRows = J.filter(d => d !== plant.late).map(d => {
  const r = clone(d);
  if (d === plant.diff){ r.taxable = x.r2(r.taxable + 500); r.igst ? r.igst = x.r2(r.igst + 90) : (r.cgst = x.r2(r.cgst + 45), r.sgst = x.r2(r.sgst + 45)); }
  if (d === plant.fmt) r.no = "INV/2025-26/" + String(d.no).padStart(5, "0");
  if (d === plant.renum) r.no = "ZX-99" + String(d.no).length;
  if (d === plant.heads){ r.cgst = x.r2(r.igst / 2); r.sgst = x.r2(r.igst - r.cgst); r.igst = 0; }
  return r;
});
// a supplier missing its GSTIN in Tally: remove it from one July voucher and from the masters
const noG = jul.find(d => /^[A-Z0-9/-]{3,}$/.test(d.no) && !Object.values(plant).includes(d));
const vNoG = b.vouchers.find(v => v.id === noG.id); const oldG = vNoG.gstin; vNoG.gstin = "";
Object.keys(b.gstins).forEach(k => { if (b.gstins[k] === oldG) delete b.gstins[k]; });
const extra = [{ctin: "27AAACX0000X1Z5", trdnm: "NOT OUR SUPPLIER PVT LTD", supfildt: "11-07-2025", supprd: "062025", inv: [
  {inum: "N/1", dt: "05-06-2025", val: 1180, txval: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0, rev: "N", itcavl: "Y", rsn: "", typ: "R", pos: "07", imsStatus: "R"},
  {inum: "N/2", dt: "06-06-2025", val: 11800, txval: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0, rev: "N", itcavl: "N", rsn: "C", typ: "R", pos: "07", imsStatus: "N"}]}];
const j6 = make("062025", junRows); j6.data.docdata.b2b = j6.data.docdata.b2b.concat(extra);
const julList = jul.filter(d => d !== noG).concat([plant.late, noG]);
const j7 = make("072025", julList);
// a credit note from a supplier against a July debit note in Tally
const dn = docs.find(d => d.ym === "202507" && d.reg === "07" && d.dir === -1 && d.gstin);
if (dn) j7.data.docdata.cdnr = [{ctin: dn.gstin, trdnm: dn.party, supfildt: "11-08-2025", supprd: "072025", nt: [{ntnum: dn.no, dt: dmy(dn.date), val: x.r2(dn.taxable + dn.igst + dn.cgst + dn.sgst), txval: dn.taxable, igst: dn.igst, cgst: dn.cgst, sgst: dn.sgst, cess: 0, typ: "C", rev: "N", itcavl: "Y", rsn: "", pos: "07", imsStatus: "N"}]}];
b.twoBs = {};
[j6, j7].forEach(j => { const t = G.fromJson(clone(j)); b.twoBs[t.gstin + "|" + t.period] = t; });
fs.writeFileSync(OUT + "/2B_062025_test.json", JSON.stringify(j6)); fs.writeFileSync(OUT + "/2B_072025_test.json", JSON.stringify(j7));
const sc = G.scope("07", ["202506"]);
console.log("June: matched " + sc.matched.length + ", differences " + sc.diff.length + ", to confirm " + sc.probable.length + ", 2B only " + sc.only2b.length + ", Tally only " + sc.onlyBooks.length + ", other month " + sc.timing.length);
const pairOf = d => sc.pairs.find(p => p.books.some(z => z.id === d.id));
ok(plant.missing2b.every(d => sc.onlyBooks.some(z => z.id === d.id)), "3 invoices not reported by suppliers: in Tally only");
ok(pairOf(plant.diff) && pairOf(plant.diff).status === "diff" && pairOf(plant.diff).issues.some(i => /taxable differs by 500/.test(i)), "taxable 500 more in 2B: a difference, explained");
ok(pairOf(plant.fmt) && pairOf(plant.fmt).status === "matched", "number written differently (" + plant.fmt.no + " vs INV/2025-26/" + String(plant.fmt.no).padStart(5, "0") + "): matched");
ok(pairOf(plant.renum) && pairOf(plant.renum).status === "probable", "different number, same supplier and amount: put to you to confirm");
ok(pairOf(plant.heads) && pairOf(plant.heads).status === "diff" && pairOf(plant.heads).issues.some(i => /IGST in the books/.test(i)), "IGST in Tally, CGST and SGST in 2B: flagged");
ok(sc.only2b.some(p => p.no === "N/1" && p.ims === "R") && sc.only2b.some(p => p.no === "N/2" && p.itcavl === "N"), "not our supplier: in 2B only, with IMS rejected and ITC not available shown");
const pl = pairOf(plant.late);
ok(pl && pl.timing && pl.p.ym === "202507", "booked in June, reported in July: matched, flagged as another month");
const s7 = G.scope("07", ["202507"]), pg = s7.pairs.find(p => p.books.some(z => z.id === noG.id));
ok(pg && pg.status === "probable" && pg.issues.some(i => /no GSTIN in Tally/.test(i)), "no GSTIN in Tally: found by number and tax, 2B's GSTIN suggested");
if (dn){ const pc = s7.pairs.find(p => p.books.some(z => z.id === dn.id)); ok(pc && pc.p.sec === "cdnr" && pc.status === "matched", "supplier's credit note matched to the debit note in Tally"); }
const everyOther = sc.matched.length;
ok(everyOther >= junRows.length - 6, "the rest of June matched: " + everyOther);
// what the user does
const st = G.state();
st.confirm[pairOf(plant.renum).p.key] = "yes";
ok(G.scope("07", ["202506"]).pairs.find(p => p.books.some(z => z.id === plant.renum.id)).status === "matched", "'Same' confirms it");
const pd = pairOf(plant.diff); st.confirm[pd.p.key + ">" + plant.diff.id] = "no";
const after = G.scope("07", ["202506"]);
ok(!after.pairs.some(p => p.p.key === pd.p.key) && after.only2b.some(p => p.key === pd.p.key) && after.onlyBooks.some(d => d.id === plant.diff.id), "'Not the same' separates them");
st.link[pd.p.key] = [plant.diff.id];
ok(G.scope("07", ["202506"]).pairs.some(p => p.p.key === pd.p.key && p.manual), "linking by hand pairs them again");
// the year view and supplier view
const yr = G.scope("07", x.GSTRev.fyMonths("202506"));
const sup = G.suppliers(yr);
ok(sup.length > 10 && sup.every(s => typeof s.gap === "number"), "supplier by supplier: " + sup.length + " suppliers");
const s1 = sup.find(s => s.pbk.length && s.gstin);
ok(s1 && /are in our books but do not appear in our GSTR-2B/.test(G.followUp(s1)) && G.followUp(s1).includes(s1.pbk[0].no), "note to a supplier lists its missing invoices");
// tolerance
st.opt = {tol: 600};
ok(G.scope("07", ["202506"]).pairs.find(p => p.books.some(z => z.id === plant.diff.id)).status === "matched", "with ₹600 allowed, the ₹500 difference counts as matched");
st.opt = {tol: 1};
console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
