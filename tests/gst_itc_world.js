// next-gst-share part B (migration 171): the input tax credit cases added to a made-up world (tests/gst_cloud_world.js)
// for tests/run_gst_share.js and tests/run_gst_share_deno.ts. Every name, GSTIN and figure is invented here; no real
// client. itc(w) adds to w (in place) and returns the GUIDs of what it added:
//   impG    an import of goods (a bill of entry, IGST paid at customs; in 2B's IMPG by its number)       4(A)(1)
//   impS    an import of services (reverse charge, IGST paid by us and its credit taken)              3.1(d), 4(A)(2)
//   isd     credit distributed by the head office's ISD registration (in 2B's ISD part)              4(A)(5) as today
//   blocked a motor car bought (blocked by section 17(5): Tally's "ineligible" switch on the entry)       4(B)(1) / 4(D)
//   inel    a bill with its tax booked to a GST-ineligible ledger                                     ineligible
//   cnSup   a supplier's credit note, booked as our debit note (in 2B's CDNR: matched)                credit taken off
//   cnSup2  a supplier's credit note in Tally that 2B does not show (only in the books)
//   exempt  milk from an unregistered dairy, no tax (intra-state), and freight from a Haryana supplier with no tax
//           (inter-state), and fuel (non-GST)                                                          table 5
//   late    a bill dated in October whose 2B is November's (held in October, released in November)
// and to the 2Bs (w.portal, the portal's JSON): IMPG and ISD rows, the supplier's credit note, the blocked car's bill,
// the late bill (in November). The ledgers and the ledger list's settings for the new tax ledgers.
"use strict";
function itc(w){
  let k = 0;
  const r2 = (x) => Math.round(x * 100) / 100;
  const day = (ym, d) => ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(d).padStart(2, "0");
  const dmy = (ym, d) => String(d).padStart(2, "0") + "-" + ym.slice(4, 6) + "-" + ym.slice(0, 4);
  const add = (ym, d, vtype, party, ls, h) => {
    const guid = "itc-171-" + String(++k).padStart(3, "0");
    w.heads.push(Object.assign({guid, day: day(ym, d), alter_id: 800000 + k, vtype, vno: vtype.slice(0, 3).toUpperCase() + "/I" + k, party, narration: vtype + " (part B)", cancelled: false, optional: false,
      deleted_at: null, gstin: "", pos: "Delhi", ref: "", ref_date: null, cmp_gstin: w.OWN}, h || {}));
    ls.forEach(([l, a, m]) => { w.lines.push({guid, ledger: l, amount: r2(a), hsn: (m && m.hsn) || null, rate: m && m.rate != null ? m.rate : null});
      ((m && m.bills) || []).forEach((b) => w.bills.push({guid, ledger: l, name: b[0], type: b[1], amount: b[2], credit_days: b[3] == null ? null : b[3]})); });
    return guid;
  };
  const led = (name, parent, x) => w.ledgers.push(Object.assign({name, parent, open: 0, pan: "", gstin: ""}, x || {}));
  led("Harbour Freight Imports", "Sundry Creditors"); led("Lumen Cloud Pte Ltd", "Sundry Creditors"); led("Kestrel Head Office ISD", "Sundry Creditors", {gstin: "06AAKCS4821Q1ZY"});
  led("Marigold Dairy", "Sundry Creditors"); led("Roadside Fuel Point", "Sundry Creditors");
  led("Motor Car", "Fixed Assets"); led("Software Subscriptions", "Indirect Expenses"); led("Purchases - Exempt", "Purchase Accounts");
  ["Input IGST RCM", "RCM IGST Payable", "GST Ineligible"].forEach((l) => led(l, "Duties & Taxes"));
  const map = w.work.map;
  map["Input IGST RCM"] = {kind: "gst", what: "gst_rcm", tax: "IGST", side: "input", rcm: true, reg: "07", ok: true, byHand: true};
  map["RCM IGST Payable"] = {kind: "gst", what: "gst_rcm", tax: "IGST", side: "output", rcm: true, reg: "07", ok: true, byHand: true};
  map["GST Ineligible"] = {kind: "ineligible", what: "ineligible", reg: "07", ok: true, byHand: true};
  const g = {};
  const P = (name) => w.ledgers.find((l) => l.name === name);
  // 4(A)(1): a bill of entry of July, IGST 90,000 on 5,00,000 (Tally: the supplier abroad, the country on the entry)
  g.impG = add("202507", 14, "Purchase", "Harbour Freight Imports", [["Harbour Freight Imports", 590000, {bills: [["7781234", "New Ref", 590000, 60]]}], ["Purchases", -500000, {hsn: "8462", rate: 18}], ["Input IGST", -90000]],
    {ref: "7781234", ref_date: day("202507", 12), gst_country: "United States", gst_supply: "Goods", gst_reg_type: "Unregistered", gst_alter_id: 800001});
  // 3.1(d) and 4(A)(2): a software subscription from Singapore, IGST 18,000 under reverse charge
  g.impS = add("202508", 5, "Purchase", "Lumen Cloud Pte Ltd", [["Lumen Cloud Pte Ltd", 100000, {bills: [["LC-0825", "New Ref", 100000, 30]]}], ["Software Subscriptions", -100000, {hsn: "9973", rate: 18}], ["Input IGST RCM", -18000], ["RCM IGST Payable", 18000]],
    {ref: "LC-0825", ref_date: day("202508", 1), gst_country: "Singapore", gst_supply: "Services", gst_rcm: true, gst_alter_id: 800002});
  // ISD: the head office's distribution of September, IGST 5,400 (a journal: the input tax and the head office)
  g.isd = add("202509", 30, "Journal", "Kestrel Head Office ISD", [["Kestrel Head Office ISD", 5400], ["Input IGST", -5400]], {ref: "ISD/25/044", ref_date: day("202509", 30)});
  // 17(5): a motor car (blocked: Tally's ineligible switch on the entry), CGST and SGST 1,26,000 on 7,00,000
  g.blocked = add("202510", 9, "Purchase", "Alder Supply Co", [["Alder Supply Co", 826000, {bills: [["AS/CAR/1", "New Ref", 826000, 30]]}], ["Motor Car", -700000, {hsn: "8703", rate: 18}], ["Input CGST", -63000], ["Input SGST", -63000]],
    {gstin: P("Alder Supply Co").gstin, ref: "AS/CAR/1", ref_date: day("202510", 9), gst_ineligible: true, gst_alter_id: 800004});
  // a bill whose tax went to a GST-ineligible ledger (3,600)
  g.inel = add("202510", 15, "Purchase", "Hollyford Stationers", [["Hollyford Stationers", 23600, {bills: [["HS-INEL-1", "New Ref", 23600, 30]]}], ["Purchases", -20000, {hsn: "4802", rate: 18}], ["GST Ineligible", -3600]],
    {gstin: P("Hollyford Stationers").gstin, ref: "HS-INEL-1", ref_date: day("202510", 15)});
  // a supplier's credit note (our debit note in Tally), November, in 2B's CDNR: CGST and SGST 900 each come off
  g.cnSup = add("202511", 18, "Debit Note", "Glenrock Tools", [["Glenrock Tools", -11800, {bills: [["GT-CN-12", "New Ref", -11800, null]]}], ["Purchases", 10000, {hsn: "8462", rate: 18}], ["Input CGST", 900], ["Input SGST", 900]],
    {gstin: P("Glenrock Tools").gstin, ref: "GT-CN-12", ref_date: day("202511", 17)});
  // a supplier's credit note in Tally that 2B does not show (December)
  g.cnSup2 = add("202512", 6, "Debit Note", "Elmstead Paper", [["Elmstead Paper", -5900], ["Purchases", 5000, {hsn: "4802", rate: 18}], ["Input CGST", 450], ["Input SGST", 450]],
    {gstin: P("Elmstead Paper").gstin, ref: "EP-CN-3", ref_date: day("202512", 5)});
  // table 5: no tax, intra-state (unregistered dairy, exempt), inter-state (Haryana, freight with no tax), non-GST (fuel)
  g.exempt = add("202508", 19, "Purchase", "Marigold Dairy", [["Marigold Dairy", 12000], ["Purchases - Exempt", -12000, {hsn: "0401", rate: 0}]], {ref: "MD-88", gst_taxability: "Exempt", gst_alter_id: 800008});
  g.inter0 = add("202508", 21, "Purchase", "Bluepine Logistics", [["Bluepine Logistics", 7000], ["Freight", -7000, {hsn: "9965", rate: 0}]], {gstin: P("Bluepine Logistics").gstin, ref: "BPL-NT-1", gst_taxability: "Exempt", gst_alter_id: 800009});
  g.fuel = add("202508", 23, "Purchase", "Roadside Fuel Point", [["Roadside Fuel Point", 4000], ["Purchases - Exempt", -4000]], {ref: "FP-1", gst_taxability: "Non-GST", gst_alter_id: 800010});
  // an October bill of Dunmore's shown in November's 2B (held in October, released in November)
  g.late = add("202510", 22, "Purchase", "Dunmore Traders", [["Dunmore Traders", 35400, {bills: [["DT-LATE-7", "New Ref", 35400, 30]]}], ["Purchases", -30000, {hsn: "4802", rate: 18}], ["Input CGST", -2700], ["Input SGST", -2700]],
    {gstin: P("Dunmore Traders").gstin, ref: "DT-LATE-7", ref_date: day("202510", 22)});
  // the 2Bs
  const portalOf = (ym) => w.portal.find((j) => j.data.rtnprd === ym.slice(4, 6) + ym.slice(0, 4)).data;
  const sup = (dd, sec, P0, doc) => { const l = dd[sec] = dd[sec] || []; let s = l.find((x) => x.ctin === P0.gstin); if (!s){ s = {ctin: P0.gstin, trdnm: P0.name.toUpperCase(), supfildt: "11-01-2026", inv: [], nt: [], doclist: []}; l.push(s); } (sec === "cdnr" ? s.nt : sec === "isd" ? s.doclist : s.inv).push(doc); };
  const jul = portalOf("202507").docdata; jul.impg = (jul.impg || []).concat([{refdt: "20-07-2025", portcode: "INNSA1", boenum: "7781234", boedt: "12-07-2025", isamd: "N", txval: 500000, igst: 90000, cess: 0}]);
  sup(portalOf("202509").docdata, "isd", P("Kestrel Head Office ISD"), {doctyp: "I", docnum: "ISD/25/044", docdt: "30-09-2025", igst: 5400, cgst: 0, sgst: 0, cess: 0, itcelg: "Y"});
  sup(portalOf("202510").docdata, "b2b", P("Alder Supply Co"), {inum: "AS/CAR/1", dt: "09-10-2025", val: 826000, txval: 700000, igst: 0, cgst: 63000, sgst: 63000, cess: 0, pos: "07", rev: "N", itcavl: "Y"});
  sup(portalOf("202510").docdata, "b2b", P("Hollyford Stationers"), {inum: "HS-INEL-1", dt: "15-10-2025", val: 23600, txval: 20000, igst: 0, cgst: 1800, sgst: 1800, cess: 0, pos: "07", rev: "N", itcavl: "Y"});
  sup(portalOf("202511").docdata, "cdnr", P("Glenrock Tools"), {ntnum: "GT-CN-12", typ: "C", dt: "17-11-2025", val: 11800, txval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0, pos: "07", rev: "N", itcavl: "Y"});
  sup(portalOf("202511").docdata, "b2b", P("Dunmore Traders"), {inum: "DT-LATE-7", dt: dmy("202510", 22), val: 35400, txval: 30000, igst: 0, cgst: 2700, sgst: 2700, cess: 0, pos: "07", rev: "N", itcavl: "Y"});
  return g;
}
module.exports = {itc};
