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
    const all = TDS_FORMS[form].rows().filter(r => r.fy === fy && r.q === q), un = this.untaggedError(all, form === "27EQ");
    if (un) return un;
    // M4: a nil deduction with remark T or Y goes in the file under the quarter's first challan (not left out); next-tds-autoplace:
    // B too (a 15G/15H declaration, src/js/94)
    const nil = all.filter(r => !r.challan && !(num(r.tds) > 0.005) && /^[BTY]$/.test(this.remark(r, form).remark)), rows = all.filter(r => r.challan), nilOut = this.nilOut(all) - nil.length;
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
    if (!isNew) return Object.assign(this.oldBuild(form, fy, q, firm, rows, live, used), {nilOut});
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
      formNo: fno, isNew, draft: isNew && !NEW_FORMS_VALIDATED, missingCodes: Array.from(missing),
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
  // 26Q, 27Q, 27EQ up to FY 2025-26: the deductee (collectee) records of each challan, and the file
  oldBuild(form, fy, q, firm, rows, live, used){
    const money = v => r2(num(v)).toFixed(2), dmy = s => s ? String(s).slice(6, 8) + String(s).slice(4, 6) + String(s).slice(0, 4) : "";
    const txt = (v, n) => String(v == null ? "" : v).replace(/[\^\r\n]/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, n || 75);
    const missing = new Set();
    const chs = live.map(c => {
      const part = typeof TDSReg === "object" ? TDSReg.portionFor(c, form, fy, q) : {interest: num(c.interest), fee: num(c.fee) + num(c.others)};
      const dds = (used[c.id] || []).map(r => {
        const m = this.remark(r, form), code = form === "27EQ" ? r.code || "" : this.codeFor(r);
        if (form !== "27EQ" && !code) missing.add(TDS.sec(r.section) + " (" + r.party + "): what was paid for is not known, so the section code (" + Object.keys(TDS_SEC_CODES[TDS.sec(r.section)].by).join(" or ") + ") cannot be chosen");
        if (form === "27EQ" && !code) missing.add(r.ledger + ": no collection code");
        const pan = r.pan && Certs.validPan(r.pan) ? r.pan : "PANNOTAVBL";
        const dc = this.oldDeducteeCode(r, form, pan);
        if (dc.why) missing.add(r.party + ": " + dc.why);
        const d = {8: dc.code, 10: pan, 12: pan === "PANNOTAVBL" ? this.oldRefNo(r.party) : "", 13: txt(this.fileName(r)),
          14: money(r.tds), 15: "0.00", 16: "0.00", 17: money(r.tds), 19: money(r.tds), 22: money(r.paid), 23: dmy(r.credit || r.date), 24: dmy(r.date),
          26: r.rate == null ? "" : r2(r.rate).toFixed(4), 30: m.remark, 33: form === "27EQ" ? code.slice(-1) : code, 34: m.certNo};
        // 27EQ: the total value of the purchase (what the buyer was charged, without the TCS)
        if (form === "27EQ") d[21] = money(r.paid);
        if (form === "27Q"){
          const t = this.nrTail(r);
          [35, 36, 37, 38, 39, 40, 41, 42].forEach((n, i) => { d[n] = t[i]; });
          if (!/^\d{1,3}$/.test(t[3]) || num(t[3]) <= 0 || num(t[3]) >= 287 || num(t[3]) === 99) missing.add(r.party + ": the country of residence as Protean's country code (a number)");
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
      missingCodes: Array.from(missing), firmMissing, remarks: rows.filter(r => this.remark(r, form).remark).length};
  },
};
if (typeof TDS26Q === "object") Object.assign(TDS26Q, TDS26QFile);
if (typeof globalThis === "object") Object.assign(globalThis, {TDS26QFile});
/* @react-lazy: end */
