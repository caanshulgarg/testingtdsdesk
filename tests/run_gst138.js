// node run_gst138.js - GST, the rest: GSTINs from Tally's registration details, B2C large at Rs 1 lakh, 3B table 4 as the form is now,
// credit as far as 2B shows it, 3.2 by place of supply, table 5, GSTR-9 figures typed and table 12, amendments that are one document
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "GST9", "GST9C", "INR", "NORM_CACHE", "normName", "gramsOf", "normNameRaw", "nameSim"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const M = v => Math.round(v || 0).toLocaleString("en-IN");
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  ok(Object.keys(ms.gstins).length >= 1300, "GSTINs read from Tally's registration details as well as PARTYGSTIN: " + Object.keys(ms.gstins).length + " ledgers (221 before)");
  ok(ms.gstins["2K Mart"] === "33AJWPD7135L1ZT", "e.g. 2K Mart 33AJWPD7135L1ZT, held only in the registration details");
  const fromG = Object.values(ms.info).filter(i => i.panFrom === "GSTIN").length;
  ok(fromG > 0 && ms.pans["2K Mart"] === "AJWPD7135L", "a PAN not typed in Tally is taken from the GSTIN (" + fromG + " ledgers)");
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, twoBs: {}});
  // B2C large from Rs 1 lakh: plant an inter-state sale of Rs 1.5 lakh to an unregistered buyer in March 2026
  const tpl = b.vouchers.find(v => v.date.startsWith("202603") && v.type === "07 SALE" && v.ent.some(e => /IGST OUTPUT/.test(e.l)));
  const sl = tpl.ent.find(e => e.a > 0 && !/OUTPUT/.test(e.l)).l, ig = tpl.ent.find(e => /IGST OUTPUT/.test(e.l)).l;
  b.vouchers.push({id: "plant-b2cl", date: "20260320", type: "07 SALE", no: "PLANT/B2CL/1", party: "CASH CUSTOMER MUMBAI", gstin: "", pos: "Maharashtra", cmp: "07AADCV3366N1ZU", ent: [{l: "CASH CUSTOMER MUMBAI", a: -177000}, {l: sl, a: 150000, h: "998596", gr: 18}, {l: ig, a: 27000}], hsn: ["998596"]});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  const r1 = x.GSTR.one("202603", "07");
  ok(r1.b2cl.some(r => r.no === "PLANT/B2CL/1"), "an inter-state invoice of Rs 1.77 lakh to an unregistered buyer is B2C large (limit Rs 1 lakh from August 2024)");
  const t3n = x.GSTR.threeB("202603", "07");
  ok(t3n.unregPos.some(p => p.pos === "27" && p.taxable >= 150000), "3.2 by place of supply: Maharashtra (27) carries it");
  const j3 = x.GSTR.threeBJson("202603", "07");
  ok(j3.inter_sup && j3.inter_sup.unreg_details.every(u => /^\d{2}$/.test(u.pos)), "3B JSON 3.2: every line has a two-digit place of supply");
  ok(j3.inward_sup && j3.inward_sup.isup_details.length === 2 && j3.itc_elg.itc_inelg.length === 2 && j3.itc_elg.itc_avl.some(a => a.ty === "ISD"), "3B JSON has table 5, 4(D) and the ISD line");
  // 17(5) in 4(B)(1): mark one March bill as ITC not available
  const bill = b.vouchers.find(v => v.date.startsWith("202603") && x.Books.isPurchase(v) && v.ent.some(e => /07 IGST INPUT/.test(e.l)));
  bill.ineligibleFlag = true;
  const tb = x.GSTR.threeB("202603", "07");
  ok(tb.rev1.igst >= tb.blocked.igst && tb.blocked.igst > 0 && tb.rev2.igst === 0, "a bill marked ITC not available is in 4(B)(1) with rules 42 and 43, not 4(B)(2)");
  bill.ineligibleFlag = false;
  // credit as far as 2B shows it
  ["022026", "032026"].forEach(p => { const f = DATA + "/returns_R2B_07AADCV3366N1ZU_" + p + ".json"; if (fs.existsSync(f)){ const t = x.GST2B.fromJson(JSON.parse(fs.readFileSync(f, "utf8"))); b.twoBs[t.gstin + "|" + t.period] = t; } });
  if (Object.keys(b.twoBs).length === 2){
    const mar = x.GSTR.threeB("202603", "07"), feb = x.GSTR.threeB("202602", "07");
    b.itcBasis = {"07": "books"}; const marB = x.GSTR.threeB("202603", "07"); b.itcBasis = {};
    const hold = mar.held.igst + mar.held.cgst + mar.held.sgst, rel = mar.released.igst + mar.released.cgst + mar.released.sgst;
    ok(mar.basis === "2b" && hold > 1000000, "March on the 2B basis: " + mar.held.n + " bills not in 2B held back, Rs " + M(hold));
    ok(Math.abs((marB.other.igst + marB.other.cgst + marB.other.sgst) - (mar.other.igst + mar.other.cgst + mar.other.sgst) - (hold - rel + mar.cn2b.igst + mar.cn2b.cgst + mar.cn2b.sgst)) < 1, "4(A)(5) on the books basis less the 2B basis = held, less released, plus suppliers' credit notes in 2B");
    ok(mar.released.n > 0, "bills booked in February and in March's 2B are taken in March: " + mar.released.n + ", Rs " + M(rel));
    const na = mar.na.igst + mar.na.cgst + mar.na.sgst;
    ok(Math.abs(na - 343517) < 2, "4(D)(2) from 2B's not-available lines: Rs " + M(na));
    const jan = x.GSTR.threeB("202601", "07");
    ok(jan.basis !== "2b" && jan.held.n === 0, "January has no 2B here: the books are used");
  } else console.log("  (VMS 2B files not here; the 2B basis checks skipped)");
  // GSTR-9: typed figures and table 12
  const fy = "2025", d0 = x.GST9.build(fy, "07");
  x.GST9.typed(fy, "07")["4K"] = {taxable: 100000, igst: 18000};
  x.GST9.typed(fy, "07")["15E"] = {igst: 5000};
  const d1 = x.GST9.build(fy, "07");
  ok(Math.abs(d1.T["4N"].taxable - d0.T["4N"].taxable - 100000) < 0.01 && Math.abs(d1.T["4N"].igst - d0.T["4N"].igst - 18000) < 0.01, "4K typed goes into 4N");
  ok(d1.part6["15E"].igst === 5000, "table 15 typed is kept");
  ok(d1.T["12"] && d1.T["12books"], "table 12 from the books (credit of this year's bills reversed in April to November next year): Rs " + M(d1.T["12"].igst + d1.T["12"].cgst + d1.T["12"].sgst));
  ok(Math.abs(d1.T["5M"].taxable - (d1.T["5G"].taxable - d1.T["5H"].taxable + d1.T["5I"].taxable + d1.T["5J"].taxable - d1.T["5K"].taxable)) < 0.01, "5M = 5G - 5H + 5I + 5J - 5K");
  const html = x.GST9.html(d1);
  ok(/10\. Particulars|Supplies \/ tax declared through amendments/.test(html) && /15, 16 and 19/.test(html) && /14\. Differential tax/.test(html), "the return shows 10 to 14 and Part VI");
  delete x.GST9.typed(fy, "07")["4K"]; delete x.GST9.typed(fy, "07")["15E"];
  // amendments: keep July 2025 as filed, then renumber one invoice, correct another's GSTIN, and remove a third's GSTIN
  const reg = "07", jul = x.GSTR.toJson("202507", reg, {plain: true});
  x.GSTAmend.keep(JSON.parse(JSON.stringify(jul)), "downloaded");
  const inv = x.GSTR.one("202507", reg).b2b;
  const vA = b.vouchers.find(v => v.id === inv[0].id), vB = b.vouchers.find(v => v.id === inv.find(r => r.gstin !== inv[0].gstin && r.no !== inv[0].no).id);
  const vC = b.vouchers.find(v => v.id === inv.find(r => r.id !== vA.id && r.id !== vB.id && r.igst > 0 && r.parts.length === 1 && r.total <= 100000).id);
  const oldNo = vA.no; vA.no = vA.no + "R";
  const oldG = vB.gstin; vB.gstin = oldG.slice(0, 14) + (oldG.slice(14) === "Z" ? "Y" : "Z");
  const oldC = vC.gstin; vC.gstin = "";
  const p = x.GSTAmend.pending("202510", reg);
  const rn = p.rows.find(r => r.what === "amend" && r.was && r.was.num === oldNo);
  ok(rn && rn.changes.some(c => /^number /.test(c)) && !p.rows.some(r => r.what === "gone" && r.was.num === oldNo), "renumbered invoice: one 9A amendment, number " + oldNo + " to " + vA.no + ", not a deletion and a new invoice");
  const gc = p.rows.find(r => r.what === "amend" && r.now && r.now.ctin === vB.gstin);
  ok(gc && gc.changes.some(c => /^GSTIN /.test(c)), "GSTIN corrected: one 9A amendment under the new GSTIN");
  const oct = x.GSTR.toJson("202510", reg);
  ok((oct.b2ba || []).some(g => g.ctin === vB.gstin && g.inv.some(i => i.oinum === String(vB.no))), "the JSON has it in b2ba under the new GSTIN with the original number");
  const gone = p.rows.find(r => r.what === "gone" && r.was.ctin === oldC), t10 = p.rows.find(r => r.kind === "B2CS" && r.P === "202507");
  ok(gone && t10 && (oct.b2csa || []).some(z => z.omon === "072025"), "GSTIN removed: the B2B invoice amended to nil, and July's B2C small revised in table 10");
  vA.no = oldNo; vB.gstin = oldG; vC.gstin = oldC;
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
