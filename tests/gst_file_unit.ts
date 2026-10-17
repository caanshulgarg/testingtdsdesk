// deno test tests/gst_file_unit.ts - the pure parts of filing through the GST API (server/gst-taxpro/filing.ts):
// FinCom's figures from the GSTR-1 / 3B JSON, the portal's summary read the same way, the comparison a person confirms,
// the set-off of sections 49 / 49A and rule 88A, and the rule that writes go to the sandbox unless switched on for live.
import { r1Figures, r1PortalFigures, r3bFigures, compare, sameFigures, setoff, writeAllowed, cleanR1, cleanR3b, PROD_URL, SANDBOX_URL, safeText } from "../server/gst-taxpro/filing.ts";

const eq = (a: unknown, b: unknown, what: string) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(what + ": got " + x + ", expected " + y);
};
const yes = (c: unknown, what: string) => { if (!c) throw new Error(what); };

const R1 = {
  gstin: "09AANFG3202D1ZR", fp: "082026", version: "GST3.2.1", hash: "hash",
  b2b: [{ ctin: "07AAACB1234C1Z5", inv: [
    { inum: "S1", val: 1180, itms: [{ num: 1, itm_det: { txval: 1000, rt: 18, iamt: 180 } }] },
    { inum: "S2", val: 590, itms: [{ num: 1, itm_det: { txval: 250, rt: 18, iamt: 45 } }, { num: 2, itm_det: { txval: 250, rt: 18, iamt: 45 } }] }] }],
  b2cs: [{ sply_ty: "INTRA", pos: "09", rt: 18, txval: 300.5, camt: 27.05, samt: 27.05 }],
  cdnr: [{ ctin: "07AAACB1234C1Z5", nt: [{ ntty: "C", nt_num: "CN1", itms: [{ itm_det: { txval: 100, iamt: 18 } }] },
    { ntty: "D", nt_num: "DN1", itms: [{ itm_det: { txval: 10, iamt: 1.8 } }] }] }],
  hsn: { data: [{ hsn_sc: "8471", txval: 1500, iamt: 270 }, { hsn_sc: "9983", txval: 300.5, camt: 27.05, samt: 27.05 }] },
  doc_issue: { doc_det: [{ doc_num: 1, docs: [{ num: 1, from: "S1", to: "S2", totnum: 3, cancel: 1, net_issue: 2 }] }] },
};

Deno.test("GSTR-1: FinCom's figures by table, notes net (debit +, credit -)", () => {
  const f = r1Figures(R1);
  eq(f.B2B, { n: 2, txval: 1500, iamt: 270, camt: 0, samt: 0, csamt: 0 }, "B2B");
  eq(f.B2CS, { n: 1, txval: 300.5, iamt: 0, camt: 27.05, samt: 27.05, csamt: 0 }, "B2CS");
  eq(f.CDNR, { n: 2, txval: -90, iamt: -16.2, camt: 0, samt: 0, csamt: 0 }, "CDNR net");
  eq(f.HSN.txval, 1800.5, "HSN taxable");
  eq(f.DOC_ISSUE.n, 2, "documents issued, net of cancelled");
  yes(!("VERSION" in f) && !("HASH" in f), "the offline tool's version and hash are not tables");
});

Deno.test("GSTR-1: the portal's RETSUM read the same way; the same figures compare equal", () => {
  const sum = { ret_period: "082026", sec_sum: [
    { sec_nm: "B2B", ttl_rec: 2, ttl_val: 1770, ttl_tax: 1500, ttl_igst: 270, ttl_cgst: 0, ttl_sgst: 0, ttl_cess: 0 },
    { sec_nm: "B2CS", ttl_rec: 1, ttl_tax: 300.5, ttl_igst: 0, ttl_cgst: 27.05, ttl_sgst: 27.05, ttl_cess: 0 },
    { sec_nm: "CDNR", ttl_rec: 2, ttl_tax: -90, ttl_igst: -16.2 },
    { sec_nm: "HSN", ttl_rec: 2, ttl_tax: 1800.5, ttl_igst: 270, ttl_cgst: 27.05, ttl_sgst: 27.05 },
    { sec_nm: "DOC_ISSUE", ttl_rec: 3, ttl_doc_issued: 3, ttl_doc_cancelled: 1, net_doc_issued: 2 },
  ] };
  const p = r1PortalFigures(sum), c = compare(r1Figures(R1), p, "R1");
  eq(c.differs, [], "no differences");
  yes(sameFigures(p, r1PortalFigures(JSON.parse(JSON.stringify(sum)))), "same summary, same figures");
  // one rupee less IGST on the portal's B2B, one invoice fewer: both listed
  const p2 = r1PortalFigures({ sec_sum: sum.sec_sum.map((s) => s.sec_nm === "B2B" ? { ...s, ttl_igst: 269, ttl_rec: 1 } : s) });
  const c2 = compare(r1Figures(R1), p2, "R1");
  eq(c2.differs, ["B2B.n", "B2B.iamt"], "differences listed by table and figure");
  const row = c2.rows.find((r) => r.key === "B2B")!;
  eq(row.diff.iamt, 1, "FinCom less portal");
  yes(!sameFigures(p, p2), "a changed summary is not the same");
  // a table only on one side is a difference too
  const c3 = compare(r1Figures({ ...R1, exp: [{ exp_typ: "WOPAY", inv: [{ inum: "E1", itms: [{ txval: 500 }] }] }] }), p, "R1");
  yes(c3.differs.includes("EXP.n") && c3.differs.includes("EXP.txval"), "a table the portal does not have");
  // the owner's answer of 17-Oct-2026: under ₹1.00 is rounding (shown, no reason needed); ₹1.00 or more is a difference
  const at = (cgst: number) => compare(r1Figures(R1), r1PortalFigures({ sec_sum: sum.sec_sum.map((s) => s.sec_nm === "B2CS" ? { ...s, ttl_cgst: cgst } : s) }), "R1");
  const c4 = at(27.04);
  eq([c4.differs, c4.rounding], [[], ["B2CS.camt"]], "₹0.01: rounding, not a difference");
  const c5 = at(26.06);
  eq([c5.differs, c5.rounding], [[], ["B2CS.camt"]], "₹0.99: rounding, not a difference");
  eq(c5.rows.find((r) => r.key === "B2CS")!.rounding, ["B2CS.camt"], "the row says which figure is rounding");
  const c6 = at(26.05);
  eq([c6.differs, c6.rounding], [["B2CS.camt"], []], "₹1.00: a difference");
  const c7 = at(28.05);
  eq(c7.differs, ["B2CS.camt"], "₹1.00 the other way: a difference");
  // a count is never rounding
  const c8 = compare(r1Figures(R1), r1PortalFigures({ sec_sum: sum.sec_sum.map((s) => s.sec_nm === "B2B" ? { ...s, ttl_rec: 3 } : s) }), "R1");
  eq([c8.differs, c8.rounding], [["B2B.n"], []], "one document more on the portal: a difference");
});

const R3B = {
  gstin: "09AANFG3202D1ZR", ret_period: "082026",
  sup_details: { osup_det: { txval: 1000, iamt: 180, camt: 0, samt: 0, csamt: 0 }, osup_zero: { txval: 0, iamt: 0, csamt: 0 }, osup_nil_exmp: { txval: 50 },
    isup_rev: { txval: 200, iamt: 0, camt: 18, samt: 18, csamt: 0 }, osup_nongst: { txval: 0 } },
  itc_elg: { itc_avl: [{ ty: "IMPG", iamt: 0, camt: 0, samt: 0, csamt: 0 }, { ty: "OTH", iamt: 100, camt: 20, samt: 20, csamt: 0 }, { ty: "ISRC", iamt: 0, camt: 18, samt: 18, csamt: 0 }],
    itc_rev: [{ ty: "RUL", iamt: 0, camt: 0, samt: 0, csamt: 0 }], itc_net: { iamt: 100, camt: 38, samt: 38, csamt: 0 },
    itc_inelg: [{ ty: "RUL", iamt: 0, camt: 0, samt: 0, csamt: 0 }] },
  inward_sup: { isup_details: [{ ty: "GST", inter: 5, intra: 7 }] },
};
Deno.test("GSTR-3B: rows by table; the portal's own 3B (with tx_pmt) compares equal", () => {
  const f = r3bFigures(R3B);
  eq(f["3.1(a)"], { n: 0, txval: 1000, iamt: 180, camt: 0, samt: 0, csamt: 0 }, "3.1(a)");
  eq(f["4(A)(5)"].iamt, 100, "4(A)(5)");
  eq(f["4(C)"].camt, 38, "4(C)");
  eq(f["5"].txval, 12, "table 5 inter + intra");
  const portal = { ...R3B, tx_pmt: { tx_py: [] }, sup_details: { ...R3B.sup_details, osup_det: { txval: 1000, iamt: 180 } } };
  eq(compare(f, r3bFigures(portal), "3B").differs, [], "missing zeros are zeros");
  eq(compare(f, r3bFigures({ ...portal, sup_details: { ...portal.sup_details, osup_det: { txval: 1000, iamt: 170 } } }), "3B").differs, ["3.1(a).iamt"], "3.1(a) IGST differs");
});

Deno.test("set-off: IGST credit first, then CGST/SGST; CGST never against SGST; reverse charge and interest in cash", () => {
  // liability 3B: IGST 180, CGST 50, SGST 50 (other than reverse charge); RCM CGST 18, SGST 18; interest CGST 2
  const liab = [
    { liab_ldg_id: 11, trans_typ: 30002, igst: { tx: 180 }, cgst: { tx: 50, intr: 2 }, sgst: { tx: 50 }, cess: { tx: 0 } },
    { liab_ldg_id: 12, trans_typ: 30003, igst: { tx: 0 }, cgst: { tx: 18 }, sgst: { tx: 18 }, cess: { tx: 0 } },
  ];
  const itc = { igst: 200, cgst: 10, sgst: 60, cess: 0 };
  const cash = { igst: { tx: 0 }, cgst: { tx: 100, intr: 5 }, sgst: { tx: 100 }, cess: { tx: 0 } };
  const p = setoff(liab, itc, cash);
  // IGST credit 200: 180 against IGST, 20 left: to CGST first (its own credit 10 short of 50 by 40) -> 20 to CGST
  eq(p.pditc, { liab_ldg_id: 11, trans_typ: 30002, i_pdi: 180, i_pdc: 20, i_pds: 0, c_pdc: 10, c_pdi: 0, s_pds: 50, s_pdi: 0, cs_pdcs: 0 }, "credit used");
  // cash: CGST 50-20-10 = 20 tax + 2 interest; RCM 18 + 18 in cash
  const other = p.pdcash.find((x) => x.trans_typ === 30002)!, rcm = p.pdcash.find((x) => x.trans_typ === 30003)!;
  eq([other.ipd, other.cpd, other.spd, other.cspd, other.c_intrpd], [0, 20, 0, 0, 2], "cash, other than reverse charge");
  eq([rcm.ipd, rcm.cpd, rcm.spd], [0, 18, 18], "reverse charge in cash");
  eq(p.cashNeeded, { igst: 0, cgst: 40, sgst: 18, cess: 0 }, "cash needed by head (tax + interest + fee)");
  eq(p.short, {}, "enough cash");
  eq(p.left, { igst: 0, cgst: 0, sgst: 10, cess: 0 }, "credit carried");
  // not enough cash: said by head, nothing invented
  const q = setoff(liab, itc, { igst: { tx: 0 }, cgst: { tx: 30 }, sgst: { tx: 100 }, cess: { tx: 0 } });
  eq(q.short, { cgst: 10 }, "CGST cash short by 10");
});

Deno.test("set-off: IGST credit short; CGST and SGST credit then pay IGST after their own heads", () => {
  const liab = [{ liab_ldg_id: 1, trans_typ: 30002, igst: { tx: 100 }, cgst: { tx: 10 }, sgst: { tx: 10 }, cess: { tx: 5 } }];
  const p = setoff(liab, { igst: 30, cgst: 40, sgst: 25, cess: 9 }, { igst: { tx: 100 }, cgst: { tx: 0 }, sgst: { tx: 0 }, cess: { tx: 0 } });
  eq(p.pditc, { liab_ldg_id: 1, trans_typ: 30002, i_pdi: 30, i_pdc: 0, i_pds: 0, c_pdc: 10, c_pdi: 30, s_pds: 10, s_pdi: 15, cs_pdcs: 5 }, "credit used");
  eq(p.pdcash[0].ipd, 25, "IGST rest in cash: 100 - 30 - 30 - 15");
  eq(p.left, { igst: 0, cgst: 0, sgst: 0, cess: 4 }, "left");
});

Deno.test("writes go to the sandbox; production only when switched on", () => {
  yes(writeAllowed(SANDBOX_URL, ""), "sandbox");
  yes(writeAllowed("http://127.0.0.1:9310", ""), "a stand-in");
  yes(!writeAllowed(PROD_URL, ""), "production: refused");
  yes(!writeAllowed(PROD_URL + "/", "no"), "production: refused unless exactly yes");
  yes(writeAllowed(PROD_URL, "yes"), "production when TAXPRO_FILE_LIVE=yes");
});

Deno.test("payloads: only what the API takes; GSTIN and period must be this return's", () => {
  const c = cleanR1(R1, "09AANFG3202D1ZR", "082026");
  yes(!("version" in c) && !("hash" in c) && c.b2b && c.fp === "082026", "version and hash left out");
  let err = ""; try { cleanR1(R1, "09AANFG3202D1ZR", "092026"); } catch (e) { err = String(e); }
  yes(/period/.test(err), "another period refused");
  err = ""; try { cleanR3b(R3B, "07AAACT1234A1Z5", "082026"); } catch (e) { err = String(e); }
  yes(/GSTIN/.test(err), "another GSTIN refused");
  yes(cleanR3b(R3B, "09AANFG3202D1ZR", "082026").sup_details, "3B kept");
});

Deno.test("no OTP in any text kept", () => {
  eq(safeText("Invalid OTP 575757 for PAN AANFG3202D", "575757"), "Invalid OTP ****** for PAN AANFG3202D", "the OTP masked");
  eq(safeText("sid AANFG3202D|123456 refused", ""), "sid AANFG3202D|****** refused", "a PAN|OTP pair masked even when the OTP is not given");
});
