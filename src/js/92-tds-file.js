/* @react-lazy: begin 92-tds-file.js (the React app loads this file with its TDS screens: app/src/lib/tdsGlobals.js; build.py react_parts) */
/* ================================================================== */
/* The TDS return files: 26Q, 27Q, 27EQ (and 24Q's records), as     */
/* Protean's FVU reads them                                          */
/* ================================================================== */
// Moved here from src/js/16 with the TDS check of 22-Oct-2026 (legacy.js's size budget, tests/run_stability.py): only the
// TDS screens make a file (doAct "tdsTxt", Validate & file, TDS24Q_FILE in src/js/73), and they load this file. The
// methods are put on TDS26Q (src/js/16), so every caller reads TDS26Q.build as before; tests/harness.js loads TDS26QFile
// with TDS26Q.
const TDS26QFile = {
  // the file is caret-delimited ASCII; each line is one record
  build(fy, q, firm, form){
    form = TDS_FORMS[form] ? form : "26Q";
    // tax year 2026-27 on: Forms 140, 144, 143 as Protean's file format has them (src/js/83); earlier years below, as before
    if (TDS.isNew(fy) && typeof TDSF25 === "object") return TDSF25.build(fy, q, firm, form);
    const isNew = TDS.isNew(fy), fno = TDS.formNo(form, fy), missing = new Set();
    const all = TDS_FORMS[form].rows().filter(r => r.fy === fy && r.q === q);
    // next-tds-validate-short: the rows the file cannot carry are left out and said (leftOut), never a refusal
    const lo = this.leftOut(form, fy, q, all), loIds = new Set(lo.map(x => x.r.id)), leftOut = lo.map(x => ({id: x.r.id, k: x.k, party: x.r.party || "", tds: r2(num(x.r.tds))}));
    // M4: a nil deduction with remark T or Y goes in the file under the quarter's first challan (not left out); next-tds-autoplace:
    // B too (a 15G/15H declaration, src/js/94)
    // (next-fvu87: 26Q only; FVU 8.7 takes no B, T or Y on a 27Q deductee, T-FV-4280, and src/js/94 writes them on 26Q only)
    const nil = form !== "26Q" ? [] : all.filter(r => !r.challan && !loIds.has(r.id) && !(num(r.tds) > 0.005) && /^[BTY]$/.test(this.remark(r, form).remark)), rows = all.filter(r => r.challan && !loIds.has(r.id)), nilOut = this.nilOut(all) - nil.length - lo.filter(x => !x.r.challan && !(num(x.r.tds) > 0.005)).length;
    const used = {};
    rows.forEach(r => { (used[r.challan] = used[r.challan] || []).push(r); });
    if (nil.length && rows.length) used[rows[0].challan] = used[rows[0].challan].concat(nil);
    // tds-layout (14-Oct-2026, the owner's register rules): a challan of another quarter or an earlier year that pays this
    // return's deductions is listed too (it was left out, and its deductions with it); the quarter's own as before
    const chs = TDS.challans().filter(c => (TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q) || (used[c.id] || []).length);
    const live = chs.filter(c => (used[c.id] || []).length);
    if (!live.length) return {error: "No challan for " + q + " " + fy + " has " + (form === "27EQ" ? "collections" : "deductions") + " in " + form + " against it yet."};
    // tds-challans (10-Oct-2026): a challan is never used beyond its amount; one that is (an old tagging) stops the file
    const useAll = TDS.challanUse(), over = live.filter(c => Math.round((useAll[c.id] || 0) * 100) > Math.round(num(c.tax) * 100));
    if (over.length) return {error: "Challan " + over.map(c => c.bsr + "/" + c.serial).join(", ") + " has more deductions against it than its amount. Take some off it first (Entries, tick them, Untag)."};
    const d = s => String(s || "").replace(/-/g, "");                 // ddmmyyyy
    const dmy = s => s ? String(s).slice(6, 8) + String(s).slice(4, 6) + String(s).slice(0, 4) : "";
    const today = new Date(), fileDate = String(today.getDate()).padStart(2, "0") + String(today.getMonth() + 1).padStart(2, "0") + today.getFullYear();
    const money = v => r2(num(v)).toFixed(2);
    // the file must be clean ASCII, and a caret would break a record
    const txt = v => String(v == null ? "" : v).replace(/[\^\r\n]/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, 75);
    const qNum = {Q1: "Q1", Q2: "Q2", Q3: "Q3", Q4: "Q4"}[q];
    const ay = (num(fy.slice(0, 4)) + 1) + "-" + String(num(fy.slice(0, 4)) + 2).slice(2);
    // up to FY 2025-26: the old forms, laid out as Protean's file format (oldBuild, below)
    if (!isNew){ const o = Object.assign(this.oldBuild(form, fy, q, firm, rows, live, used), {nilOut, leftOut}); if (lo.length) o.notes = [this.leftNote(lo)].concat(o.notes || []); return o; }
    const lines = [];
    let ln = 0;
    const put = arr => { ln++; lines.push([ln].concat(arr).join("^")); };
    // FH: file header
    put(["FH", "NS1", "R", fileDate, "1", "D", firm.tan, "1", "FinCom", "", "", "", "", "", "", "", ""]);
    // BH: batch header, one batch for this form and quarter
    put(["BH", "1", String(live.length), fno, firm.tan, firm.pan || "PANNOTREQD", fy.replace("-", ""), ay.replace("-", ""),
      txt(firm.name), txt(firm.branch), txt(firm.flat), txt(firm.premises), txt(firm.road), txt(firm.area), txt(firm.town),
      txt(firm.state), txt(firm.pin), txt(firm.email), txt(firm.phone), firm.deductorType || "F",
      txt(firm.person), txt(firm.personDesignation), firm.personFlat || "", firm.personPremises || "", firm.personRoad || "",
      firm.personArea || "", firm.personTown || "", firm.personState || "", firm.personPin || "", firm.personEmail || "", firm.personPhone || "",
      "N", "", "", "", "", "", qNum]);
    // CD: one per challan, with DD lines under it
    live.forEach((c, ci) => {
      const mine = used[c.id] || [];
      const tax = mine.reduce((a, r) => a + num(r.tds), 0);
      // the challan as deposited: interest, and fee and others where the challan read has them (tds-challans); its minor
      // head (200 unless the challan says 400)
      // the interest and fee: a person's portion for this return where one is set in the register (TDSReg, src/js/79);
      // else the challan's whole interest and fee, as before
      const part = typeof TDSReg === "object" ? TDSReg.portionFor(c, form, fy, q) : {interest: num(c.interest), fee: num(c.fee) + num(c.others)};
      // the record adds up (the TDS review, H5): its total is the tax of this return's deductions and the interest and fee it
      // carries, not the whole challan's deposit (a challan shared with another return was counted in full in each)
      put(["CD", "1", String(ci + 1), String(mine.length), "", money(tax), "0.00", "0.00", money(part.interest), money(part.fee),
        money(tax + num(part.interest) + num(part.fee)), "", c.bsr, dmy(c.date), c.serial, "C", String(c.minorHead || "200"), "N", "", "", money(tax), "0.00", "0.00", "0.00", "0.00", "0.00"]);
      mine.forEach((r, di) => {
        const m = this.remark(r, form);
        const old = form === "27EQ" ? r.code || "" : this.codeFor(r);
        if (!isNew && form !== "27EQ" && !old) missing.add(TDS.sec(r.section) + " (" + r.party + "): what was paid for is not known, so the section code (" + Object.keys(TDS_SEC_CODES[TDS.sec(r.section)].by).join(" or ") + ") cannot be chosen");
        const code = isNew ? this.payCode(r, form) : old;
        if (isNew && !code) missing.add(form === "27EQ" ? r.code || r.ledger : TDS.sec(r.section));
        const tail = form === "27Q" ? this.nrTail(r) : form === "27EQ" ? this.tcsTail(r) : [];
        put(["DD", "1", String(ci + 1), String(di + 1), "", r.dcode || (r.pan && /^[A-Z]{5}\d{4}[A-Z]$/.test(r.pan) ? (/^[A-Z]{3}C/.test(r.pan) ? "01" : "02") : "02"),
          r.pan && Certs.validPan(r.pan) ? r.pan : "PANNOTAVBL", txt(this.fileName(r)), "", money(r.paid), money(r.tds), "0.00", "0.00", money(r.tds), "0.00", money(r.tds),
          dmy(r.credit || r.date), dmy(r.date), (r.rate == null ? "" : r2(r.rate).toFixed(4)), code, m.remark, m.certNo, "", "", "", "", "", "", ""].concat(tail));
      });
    });
    return {text: lines.join("\r\n") + "\r\n", rows: rows.length, challans: live.length,
      name: (firm.tan || "TAN") + "_" + (isNew ? "Form" + fno : form) + "_" + q + "_" + fy.replace("-", "") + (isNew && !NEW_FORMS_VALIDATED ? "_DRAFT" : "") + ".txt", form,
      formNo: fno, isNew, draft: isNew && !NEW_FORMS_VALIDATED, missingCodes: Array.from(missing), leftOut, notes: lo.length ? [this.leftNote(lo)] : [],
      remarks: rows.filter(r => this.remark(r, form).remark).length};
  },
  // what is missing before a 27Q can be filed
  nrChecks(fy, q){
    const out = [];
    const seen = new Set();
    TDS.nrRows().filter(r => r.fy === fy && r.q === q).forEach(r => {
      if (seen.has(r.party)) return; seen.add(r.party);
      const i = this.nrInfo(r.party), miss = [];
      if (!i.country) miss.push("country");
      if (!i.nature) miss.push("nature of remittance");
      if (!Certs.validPan(r.pan) && !(i.tin && i.address && i.email)) miss.push("PAN, or the tax identification number, address and e-mail (rule 37BC)");
      if (i.dtaa && !i.trc) miss.push("tax residency certificate and Form 10F for the treaty rate");
      if (miss.length) out.push({party: r.party, missing: miss});
    });
    return out;
  },
  // ---------- the forms of the Income-tax Act, 1961 (26Q, 27Q, 27EQ, 24Q; FY 2025-26 and before), laid out as Protean's file
  // format: each record field by field, as Protean's FVU 8.7 (June 2024) reads it. Every record has a fixed number of
  // fields (OLD_FIELDS, the line number first); a field is given by its number in the format (oldRec). Checked with the FVU
  // itself on made-up books (tests/run_fvu87.py, where the FVU is installed) and field by field (tests/run_fvu_layout.js).
  OLD_FIELDS: {FH: 18, BH: 72, CD: 41, DD: 54, SD: 88},
  // the file type of each form: NS1 (26Q, 27Q), TC1 (27EQ), SL1 (24Q)
  OLD_FILE_TYPE: {"26Q": "NS1", "27Q": "NS1", "27EQ": "TC1", "24Q": "SL1"},
  oldRec(type, vals){
    const a = new Array(this.OLD_FIELDS[type] - 1).fill("");
    a[0] = type;
    Object.keys(vals).forEach(k => { const v = vals[k]; a[num(k) - 2] = v == null ? "" : String(v); });
    return a;
  },
  // the deductor's details the batch header asks (FVU 8.7 with only these given: no error), and those missing
  OLD_FIRM_NEEDS: [["tan", "TAN"], ["pan", "PAN"], ["name", "name"], ["deductorType", "deductor category"], ["branch", "branch or division"], ["flat", "address"], ["state", "state (two-digit code)"], ["pin", "PIN code"],
    ["person", "responsible person's name"], ["personDesignation", "responsible person's designation"], ["personPan", "responsible person's PAN"],
    ["personFlat", "responsible person's address"], ["personState", "responsible person's state (two-digit code)"], ["personPin", "responsible person's PIN code"],
    ["personMobile", "responsible person's mobile number"]],
  oldFirmMissing(firm){
    const f = Object.assign({}, firm, {personMobile: firm.personMobile || firm.personPhone, deductorType: this.oldCategory(firm)});
    const out = this.OLD_FIRM_NEEDS.filter(([k]) => !String(f[k] || "").trim() || (/state$/i.test(k) && !/^\d{2}$/.test(String(f[k]))) || (/pin$/i.test(k) && !/^\d{6}$/.test(String(f[k]))))
      .map(([, w]) => w);
    if (!String(f.email || "").trim() && !String(f.personEmail || "").trim()) out.push("e-mail of the deductor or the responsible person");
    return out;
  },
  // the deductor category of the batch header: firmDetails' category, else the one given
  oldCategory(firm){ return firm.category != null ? firm.category : firm.deductorType || ""; },
  // what the file cannot be complete without: the deductor's details, and the token of an earlier statement marked filed
  oldAsks(form, fy, q, firm){
    const out = this.oldFirmMissing(firm), e = this.oldEarlier(form, fy, q);
    if (e.filed && !/^\d{15}$/.test(e.token)) out.push("the token number of " + form + " " + e.q + " " + e.fy + " (marked filed without it)");
    return out;
  },
  // the regular statement of this form filed for an earlier quarter, as marked filed in FinCom (TDSFiled): the latest of the
  // eight quarters before this one, with its token (receipt) number; {filed: false} when none is marked
  oldEarlier(form, fy, q){
    if (typeof TDSFiled !== "object") return {filed: false, token: ""};
    let y = num(fy.slice(0, 4)), qi = ["Q1", "Q2", "Q3", "Q4"].indexOf(q);
    for (let i = 0; i < 8; i++){
      qi--; if (qi < 0){ qi = 3; y--; }
      const f = TDSFiled.get(y + "-" + String(y + 1).slice(2), "Q" + (qi + 1), form);
      if (f && f.on) return {filed: true, token: String(f.token || "").replace(/\s/g, ""), fy: y + "-" + String(y + 1).slice(2), q: "Q" + (qi + 1)};
    }
    return {filed: false, token: ""};
  },
  // the deductee (collectee) code: 26Q 1 company, 2 other; 27Q and 27EQ (FY 2023-24 on) two digits by the PAN's fourth letter
  // (FVU 8.7): 01 company, 02 individual, 03 HUF, 04 AOP, 07 firm, 08 BOI, 09 artificial juridical person, 10 others (G, T,
  // E, L); 05 and 06 (and any deductee with no PAN) only as the party's own code (r.dcode): else {why}
  OLD_PAN_CODES: {C: "01", P: "02", H: "03", A: "04", F: "07", B: "08", J: "09", G: "10", T: "10", E: "10", L: "10"},
  oldDeducteeCode(r, form, pan){
    const has = pan !== "PANNOTAVBL";
    if (form === "26Q") return {code: r.dcode ? (String(r.dcode).replace(/^0/, "") === "1" ? "1" : "2") : has && pan[3] === "C" ? "1" : "2", why: ""};
    if (r.dcode && /^(0[1-9]|10)$/.test(String(r.dcode))) return {code: String(r.dcode), why: ""};
    if (has && this.OLD_PAN_CODES[pan[3]]) return {code: this.OLD_PAN_CODES[pan[3]], why: ""};
    return {code: "10", why: "no PAN, so the deductee's status code (01 to 10) is not known: 10 (others) written"};
  },
  // a deductee with no PAN: the deductee reference number, ten digits, the same for the party in every return (from its name)
  oldRefNo(party){
    let h = 2166136261;
    const k = normName(party);
    for (let i = 0; i < k.length; i++){ h ^= k.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return String(1000000000 + h % 9000000000).slice(0, 10);
  },
  // the whole file: chs [{c, part: {interest, fee}, dds: [DD fields by number]}], sds [SD fields by number], subs (24Q) for each
  // SD its section 16 and Chapter VI-A records {s16: [[id, amount]], c6: [[id, gross, deductible]]}; a C6A record's fields:
  // section, deductible, gross, qualifying (given for 80G, 80TTA and others only: FVU 8.7, T_FV_6100)
  oldText(form, fy, q, firm, chs, sds, subs){
    const today = new Date(), fileDate = String(today.getDate()).padStart(2, "0") + String(today.getMonth() + 1).padStart(2, "0") + today.getFullYear();
    const money = v => r2(num(v)).toFixed(2), dmy = s => s ? String(s).slice(6, 8) + String(s).slice(4, 6) + String(s).slice(0, 4) : "";
    const txt = (v, n) => String(v == null ? "" : v).replace(/[\^\r\n]/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, n || 75);
    const ay = (num(fy.slice(0, 4)) + 1) + String(num(fy.slice(0, 4)) + 2).slice(2);
    const lines = []; let ln = 0;
    const put = (type, vals) => { ln++; lines.push([ln].concat(this.oldRec(type, vals)).join("^")); };
    const cds = chs.map(({c, part, dds}) => {
      const sum = n => r2(dds.reduce((a, d) => a + num(d[n]), 0));
      // (next-tds-interest2: the 234E fee in its own field 39, others in 26 and 35)
      const tax = sum(14), interest = r2(num(part.interest)), others = r2(num(part.others)), fee = r2(num(part.fee) - others);
      return {c, dds, tax, interest, fee, others, total: r2(tax + interest + fee + others), deposited: sum(19), deducted: sum(17)};
    });
    const earlier = this.oldEarlier(form, fy, q), mobile = firm.personMobile || firm.personPhone || "";
    const salaryTotal = r2((sds || []).reduce((a, s) => a + num(s[19]), 0));
    put("FH", {3: this.OLD_FILE_TYPE[form], 4: "R", 5: fileDate, 6: "1", 7: "D", 8: firm.tan, 9: "1", 10: "FinCom"});
    put("BH", {3: "1", 4: cds.length, 5: form, 9: earlier.filed ? earlier.token : "", 13: firm.tan, 15: firm.pan, 16: ay, 17: fy.replace("-", ""), 18: q,
      19: txt(firm.name), 20: txt(firm.branch), 21: txt(firm.flat, 25), 22: txt(firm.premises, 25), 23: txt(firm.road, 25), 24: txt(firm.area, 25), 25: txt(firm.town, 25),
      26: firm.state, 27: firm.pin, 28: txt(firm.email), 29: firm.std || "", 30: firm.std ? firm.phone || "" : "", 31: "N", 32: this.oldCategory(firm),
      33: txt(firm.person), 34: txt(firm.personDesignation, 20), 35: txt(firm.personFlat, 25), 36: txt(firm.personPremises, 25), 37: txt(firm.personRoad, 25),
      38: txt(firm.personArea, 25), 39: txt(firm.personTown, 25), 40: firm.personState, 41: firm.personPin, 42: txt(firm.personEmail), 43: mobile, 44: "", 45: "", 46: "N",
      47: money(cds.reduce((a, x) => a + x.total, 0)), 49: form === "24Q" ? String((sds || []).length) : "", 50: form === "24Q" && q === "Q4" ? money(salaryTotal) : "",
      51: "N", 52: earlier.filed ? "Y" : "N", 59: firm.personPan || "", 69: firm.gstin || "",
      70: form === "24Q" && q === "Q4" ? "0" : "", 71: form === "24Q" && q === "Q4" ? "0.00" : ""});
    cds.forEach((x, ci) => {
      put("CD", {3: "1", 4: ci + 1, 5: x.dds.length, 6: "N", 12: x.c.serial, 16: x.c.bsr, 18: dmy(x.c.date),
        22: money(x.tax), 23: "0.00", 24: "0.00", 25: money(x.interest), 26: money(x.others), 27: money(x.total), 29: money(x.deposited), 30: money(x.tax), 31: "0.00", 32: "0.00",
        33: money(x.deducted), 34: money(x.interest), 35: money(x.others), 37: "N", 39: money(x.fee), 40: String(x.c.minorHead || "200")});
      x.dds.forEach((d, di) => put("DD", Object.assign({3: "1", 4: ci + 1, 5: di + 1, 6: "O"}, d)));
    });
    (sds || []).forEach((s, i) => {
      put("SD", Object.assign({3: "1", 4: i + 1, 5: "A"}, s));
      const x = (subs || [])[i] || {};
      (x.s16 || []).forEach(([id, v], k) => { ln++; lines.push([ln, "S16", "1", i + 1, k + 1, id, money(v), ""].join("^")); });
      (x.c6 || []).forEach(([id, g, v], k) => { ln++; lines.push([ln, "C6A", "1", i + 1, k + 1, id, money(v), money(g), /^(80G|80TTA|OTHERS)$/.test(id) ? money(v) : "", ""].join("^")); });
    });
    return lines.join("\r\n") + "\r\n";
  },
  // next-fvu87 (24-Oct-2026): what Protean's FVU 8.7 takes on a deductee record, read off the FVU itself by running it on
  // FinCom's files with one thing changed at a time (tests/run_fvu87.py; docs/fvu-check.md, "FVU 8.7's rules"):
  //   B (Form 15G / 15H) only with these 26Q codes (T_FV_4245; 4JA and 4JB refused though the message names 194J)
  //   Y (below the threshold) only with these 26Q codes (T-FV-4282; 194Q: T_FV_6210, C, S and U only); with another code
  //   the row is written with no remark (the owner, 24-Oct-2026), which FVU 8.7 takes
  //   T (transporter) only with 94C and a valid PAN (T-FV-4265, T-FV-4266)
  //   with no tax deducted the date of deduction is left empty (T-FV-4257; with B: T-FV-4252)
  //   C only for a PAN that is structurally invalid (PANNOTAVBL; T-FV-4323): an inoperative PAN is written as it is, no C
  //   27Q nature of remittance (with section 195): one of NATURES (T-FV-4312); the deductee's address, e-mail, phone and tax
  //   ID in the country of residence only with remark C, no PAN and one of NATURE_CONTACT (T-FV-4335 to 4338, 4340 to 4343)
  //   no section code for 194T (T-FV-4301: 4T, 94T, 194T, 4TA, 9TA all refused): a later FVU is needed for it
  FVU87: {B: ["193", "194", "94A", "94D", "4EE", "4DA", "4IA", "4IB", "94K"],
    Y: ["193", "194", "4BB", "4EE", "4IA", "4IB", "4JA", "4JB", "94A", "94B", "94C", "94D", "94G", "94H", "94K", "94L", "94O", "94R", "94S"], T: ["94C"],
    NATURES: ["16", "21", "27", "28", "31", "49", "52", "66", "67", "68", "69", "70", "99"], NATURE_CONTACT: ["16", "21", "27", "31", "49", "52", "66", "67", "68", "69", "70"],
    NO_CODE: {"194T": "Protean's FVU 8.7 has no section code for 194T (payments to partners, from 1 April 2025): it refuses the record (T-FV-4301); a later FVU from Protean is needed"}},
  // a deductee record's remark as FVU 8.7 takes it: {remark, note (what FinCom wrote for it), yOff (Y taken off), why (FVU 8.7 refuses it: why)}
  fvu87Remark(r, form, code, m){
    const s = TDS.sec(r.section), zero = !(num(r.tds) > 0.005), pan = String(r.pan || "").toUpperCase();
    if (m.remark === "C" && Certs.validPan(pan)) return {remark: "", note: r.party + ": the PAN " + pan + " is inoperative: written as it is, without remark C (FVU 8.7 takes C only for a PAN that is not valid, T-FV-4323); the higher rate stays"};
    // (the owner, 24-Oct-2026: such a row is in the file with no remark, not left out; FVU 8.7 takes it so)
    if (zero && m.remark === "Y" && !this.FVU87.Y.includes(code)) return {remark: "", yOff: true, note: r.party + " (" + s + ", no TDS, below the limit): written with no remark; FVU 8.7 takes no remark Y for " + s + (s === "194Q" ? " (T_FV_6210)" : " (T-FV-4282)")};
    if (zero && m.remark === "B" && !this.FVU87.B.includes(code)) return {remark: "B", why: r.party + ": remark B (Form 15G / 15H) is not allowed for " + s + " (code " + code + "); FVU 8.7 refuses it (T_FV_4245)"};
    if (zero && m.remark === "T" && !this.FVU87.T.includes(code)) return {remark: "T", why: r.party + ": remark T (transporter) is only for 194C; FVU 8.7 refuses it for " + s + " (T-FV-4265)"};
    return {remark: m.remark};
  },
  // Validate & file: the deductee records FVU 8.7 refuses or FinCom changes for it, up to FY 2025-26 (26Q, 27Q):
  // [{k, level: error (FVU 8.7 refuses the file) | warn | info (what FinCom did), n, ids, words}]
  fvu87Checks(fy, q, form){
    if (TDS.isNew(fy) || (form !== "26Q" && form !== "27Q")) return [];
    const rows = TDS_FORMS[form].rows().filter(r => r.fy === fy && r.q === q && (r.challan || (form === "26Q" && !(num(r.tds) > 0.005) && /^[BTY]$/.test(this.remark(r, form).remark || ""))));
    const bad = {"no-code": [], "b-sec": [], "nature": [], "y-out": [], "inop": [], "contact": []};
    rows.forEach(r => {
      const s = TDS.sec(r.section), code = this.codeFor(r), m = this.fvu87Remark(r, form, code, this.remark(r, form));
      if (this.FVU87.NO_CODE[s]) bad["no-code"].push({r, w: r.party});
      if (m.why && /remark B/.test(m.why)) bad["b-sec"].push({r, w: r.party + " (" + s + ")"});
      if (m.yOff) bad["y-out"].push({r, w: r.party + " (" + s + ")"});
      else if (m.note) bad["inop"].push({r, w: r.party});
      if (form === "27Q"){
        const i = this.nrInfo(r.party), nat = String(i.nature || "").trim();
        if (nat && !this.FVU87.NATURES.includes(nat.padStart(2, "0"))) bad["nature"].push({r, w: r.party + " (" + nat + ")"});
        const has = [i.email, i.phone, i.address, i.tin].some(v => String(v || "").trim());
        if (has && !(this.remark(r, form).remark === "C" && !Certs.validPan(r.pan) && this.FVU87.NATURE_CONTACT.includes(nat.padStart(2, "0")))) bad["contact"].push({r, w: r.party});
      }
    });
    const W = {"no-code": ["warn", "194T: Protean's FVU 8.7 has no section code for payments to partners and refuses these records (T-FV-4301); a later FVU from Protean is needed: "],
      "b-sec": ["error", "Remark B (Form 15G / 15H) is only for interest, dividends, insurance commission, rent, NSS, life insurance payouts and mutual fund units; FVU 8.7 refuses it here (T_FV_4245): "],
      "nature": ["error", "Nature of remittance not in FVU 8.7's list for 27Q (16, 21, 27, 28, 31, 49, 52, 66-70, 99; T-FV-4312): "],
      "y-out": ["info", "Below the limit with no TDS, written in the file with no remark: FVU 8.7 takes no remark Y for this section: "],
      "inop": ["info", "Inoperative PAN: written as it is, without remark C (FVU 8.7 takes C only for a PAN that is not valid, T-FV-4323); the higher rate stays: "],
      "contact": ["info", "Foreign address, e-mail, phone and tax ID left out of the file: FVU 8.7 takes them only with no PAN, remark C and natures 16, 21, 27, 31, 49, 52, 66-70: "]};
    const uniq = (l) => Array.from(new Set(l.map(x => x.w)));
    return Object.keys(bad).filter(k => bad[k].length).map(k => ({k, level: W[k][0], n: bad[k].length, ids: bad[k].map(x => x.r.id), words: W[k][1] + uniq(bad[k]).join("; ")}));
  },
  // next-tds-validate-short (the owner, 25-Oct-2026: "there should not be any blocker also if we do not file any deductions..
  // we can say that certain deductions are not there but it cannot be a blocker"). A deductee record needs its challan, and
  // Protean's FVU refuses some records; the file is made from the rest, and the rows it leaves out are said (Validate & file's
  // warning, the file's notes). [{r, k, why}]: k "nochallan" tax on no challan; "early" on a challan the FVU refuses for it
  // (TDSEdit.placeIssues: a year before, after today, not minor head 200); "stale" a split whose tax changed in the books;
  // "remark" a nil row whose remark B, T or Y is wrong (TDSDecl.checks); "fvu87" a record FVU 8.7 refuses (fvu87Checks).
  // all: the return's rows of the quarter (else TDS.formRows)
  leftOut(form, fy, q, all){
    all = all || TDS.formRows(form).filter(r => r.fy === fy && r.q === q);
    const ch = {}, out = [], seen = new Set(), put = (r, k, why) => { if (r && !seen.has(r.id)){ seen.add(r.id); out.push({r, k, why: why || ""}); } };
    TDS.challans().forEach(c => { ch[c.id] = c; });
    const BAD = ["fy", "future", "minor"];
    all.forEach(r => {
      if (!r.challan || !ch[r.challan]){ if (num(r.tds) > 0.005) put(r, "nochallan", "on no challan"); return; }
      if (r.splitStale) return put(r, "stale", "a split whose tax changed in the books: undo the split and split it again");
      const p = typeof TDSEdit === "object" && TDSEdit.placeIssues ? TDSEdit.placeIssues(r, ch[r.challan]).find(x => BAD.includes(x.k)) : null;
      if (p) put(r, "early", p.words);
    });
    const byId = {}; all.forEach(r => { byId[r.id] = r; });
    const more = [];
    try { if (typeof TDSDecl === "object") more.push(...TDSDecl.checks(fy, q, form).filter(x => x.level === "error").map(x => ["remark", x])); } catch (e){ /* the remarks not loaded */ }
    try { more.push(...this.fvu87Checks(fy, q, form).filter(x => x.level === "error").map(x => ["fvu87", x])); } catch (e){ /* */ }
    more.forEach(([k, x]) => (x.ids || []).forEach(id => put(byId[id], k, x.words.split(":")[0])));
    return out;
  },
  // the file's own note of what it left out, in one line ("" when nothing)
  leftNote(lo){
    if (!lo || !lo.length) return "";
    const W = {nochallan: "on no challan", early: "on a challan the FVU refuses for it", stale: "split, its tax changed in the books", remark: "with a remark B, T or Y to correct", fvu87: "refused by FVU 8.7"};
    const by = {}; lo.forEach(x => { (by[x.k] = by[x.k] || []).push(x.r); });
    const rs = (v) => "₹" + (typeof INR === "object" ? INR.format(r2(num(v))) : r2(num(v)).toFixed(2));
    return "Left out of the file: " + Object.keys(by).map(k => by[k].length + " " + W[k] + " (" + rs(by[k].reduce((a, r) => a + num(r.tds), 0)) + ")").join("; ") + ". " +
      lo.slice(0, 5).map(x => (x.r.party || x.r.employee || "?") + " " + rs(x.r.tds)).join(", ") + (lo.length > 5 ? " …" : "");
  },
  // 26Q, 27Q, 27EQ up to FY 2025-26: the deductee (collectee) records of each challan, and the file
  oldBuild(form, fy, q, firm, rows, live, used){
    const money = v => r2(num(v)).toFixed(2), dmy = s => s ? String(s).slice(6, 8) + String(s).slice(4, 6) + String(s).slice(0, 4) : "";
    const txt = (v, n) => String(v == null ? "" : v).replace(/[\^\r\n]/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, n || 75);
    const missing = new Set(), problems = new Set(), notes = new Set();
    const chs = live.map(c => {
      const part = typeof TDSReg === "object" ? TDSReg.portionFor(c, form, fy, q) : {interest: num(c.interest), fee: num(c.fee) + num(c.others)};
      const dds = (used[c.id] || []).map(r => {
        const code = form === "27EQ" ? r.code || "" : this.codeFor(r), m0 = this.remark(r, form);
        // next-fvu87: the remark as FVU 8.7 takes it (Y where it takes none: no remark; what it refuses is a problem)
        const fv = form === "27EQ" ? {remark: m0.remark} : this.fvu87Remark(r, form, code, m0), m = Object.assign({}, m0, {remark: fv.remark});
        if (fv.note) notes.add(fv.note);
        if (fv.why) problems.add(fv.why);
        if (form !== "27EQ" && this.FVU87.NO_CODE[TDS.sec(r.section)]) problems.add(r.party + ": " + this.FVU87.NO_CODE[TDS.sec(r.section)]);
        if (form !== "27EQ" && !code) missing.add(TDS.sec(r.section) + " (" + r.party + "): what was paid for is not known, so the section code (" + Object.keys(TDS_SEC_CODES[TDS.sec(r.section)].by).join(" or ") + ") cannot be chosen");
        if (form === "27EQ" && !code) missing.add(r.ledger + ": no collection code");
        const pan = r.pan && Certs.validPan(r.pan) ? r.pan : "PANNOTAVBL";
        const dc = this.oldDeducteeCode(r, form, pan);
        if (dc.why) missing.add(r.party + ": " + dc.why);
        const d = {8: dc.code, 10: pan, 12: pan === "PANNOTAVBL" ? this.oldRefNo(r.party) : "", 13: txt(this.fileName(r)),
          // (next-fvu87: no tax deducted, no date of deduction: FVU 8.7, T-FV-4257 / T-FV-4252)
          14: money(r.tds), 15: "0.00", 16: "0.00", 17: money(r.tds), 19: money(r.tds), 22: money(r.paid), 23: dmy(r.credit || r.date), 24: num(r.tds) > 0.005 ? dmy(r.date) : "",
          26: r.rate == null ? "" : r2(r.rate).toFixed(4), 30: m.remark, 33: form === "27EQ" ? code.slice(-1) : code, 34: m.certNo};
        // 27EQ: the total value of the purchase (what the buyer was charged, without the TCS)
        if (form === "27EQ") d[21] = money(r.paid);
        if (form === "27Q"){
          const t = this.nrTail(r);
          [35, 36, 37, 38, 39, 40, 41, 42].forEach((n, i) => { d[n] = t[i]; });
          if (!/^\d{1,3}$/.test(t[3]) || num(t[3]) <= 0 || num(t[3]) >= 287 || num(t[3]) === 99) missing.add(r.party + ": the country of residence as Protean's country code (a number)");
          // next-fvu87: the nature as FVU 8.7 lists it; the address, e-mail, phone and tax ID only where FVU 8.7 takes them
          const nat = t[1] ? t[1].padStart(2, "0") : "";
          if (nat){ d[36] = nat; if (!this.FVU87.NATURES.includes(nat)) problems.add(r.party + ": nature of remittance " + nat + " is not in FVU 8.7's list for 27Q (T-FV-4312)"); }
          if (!(m.remark === "C" && pan === "PANNOTAVBL" && this.FVU87.NATURE_CONTACT.includes(nat)) && [39, 40, 41, 42].some(n => d[n])){
            [39, 40, 41, 42].forEach(n => { d[n] = ""; });
            notes.add(r.party + ": the address, e-mail, phone and tax ID in the country of residence left out (FVU 8.7 takes them only with no PAN, remark C and natures 16, 21, 27, 31, 49, 52, 66-70)");
          }
        }
        // 27Q, 27EQ (FY 2023-24 on): whether the deductee opted out of the new tax regime (section 115BAC(1A)): N unless the
        // party is marked so (S.books.nrInfo[party].optOut115BAC)
        if (form === "27Q" || form === "27EQ") d[49] = this.nrInfo(r.party).optOut115BAC ? "Y" : "N";
        return d;
      });
      return {c, part, dds};
    });
    const firmMissing = this.oldAsks(form, fy, q, firm);
    return {text: this.oldText(form, fy, q, firm, chs, []), rows: rows.length, challans: live.length,
      name: (firm.tan || "TAN") + "_" + form + "_" + q + "_" + fy.replace("-", "") + ".txt", form, formNo: form, isNew: false, draft: false,
      missingCodes: Array.from(missing), firmMissing, remarks: chs.reduce((a, x) => a + x.dds.filter(d => d[30]).length, 0), problems: Array.from(problems), notes: Array.from(notes)};
  },
};
if (typeof TDS26Q === "object") Object.assign(TDS26Q, TDS26QFile);
if (typeof globalThis === "object") Object.assign(globalThis, {TDS26QFile});
/* @react-lazy: end */
