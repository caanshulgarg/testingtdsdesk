/* ================================================================== */
/* The 26Q text file, as the FVU expects it, and its validation       */
/* ================================================================== */
// tax-accuracy: one builder for 26Q (residents), 27Q (non-residents, old section 195) and 27EQ (TCS, old section 206C).
// The records and their order are 26Q's as FinCom has made them; 27Q and 27EQ add their own fields at the end of each
// deduction (DD) record. Remarks: A = lower deduction / collection certificate (old 197 / 206C(9)), C = higher rate,
// no PAN or PAN inoperative (old 206AA / 206CC). Check every file with the FVU before filing.
const TDS_FORMS = {
  "26Q": {rows: () => TDS.rows(), title: "26Q, other than salary"},
  "27Q": {rows: () => TDS.nrRows(), title: "27Q, payments to non-residents"},
  "27EQ": {rows: () => TDS.tcsRows(), title: "27EQ, tax collected at source", tcs: true}
};
// The forms of the Income-tax Act, 2025 (periods from 1 April 2026): Form 140 (was 26Q), 144 (was 27Q), 143 (was 27EQ),
// 138 (was 24Q). Their deductions carry a numeric payment code in place of the old section code. The codes and the layout
// are to be matched field by field to Protean's file-format documents and run through their FVU; until that is done
// (NEW_FORMS_VALIDATED), a new-form file is a draft: named so, and not sent to the FVU from FinCom.
const NEW_FORMS_VALIDATED = false;
// The payment codes of the new forms (FY 2026-27 on), by form: Form 140 (26Q) and Form 144 (27Q) by old section (and,
// for a section split by what was paid for, by TDSRate.payType: r.pay; for 194C by the PAN's fourth letter, as the rate
// is chosen, TDSRate.expect); Form 143 (27EQ) by the old collection code. next-tds-forms-2025 (17-Oct-2026): the codes are
// Annexure 2 of Protean's file format version 1.1 of 22-07-2026 (and Note 15 / Note 9 / Note 13 of the Gazette Forms 140,
// 143, 144), read against the old section of the same payment (docs/tds-forms-2025/GAPS.md lists each, for the owner).
// A section with { unconfirmed } gets NO code: the old section is split in the new list by something FinCom does not know
// (who pays, cash or kind, the amount over a year); its deductions are in To fix as "payment code to confirm"
// (payCodeRows). A section not listed is unconfirmed the same way.
const PAY_CODES = {
  "26Q": {
    "192A": {code: "1004", note: "accumulated balance of provident fund due to an employee (392(7))"},
    "193": {code: "1019", note: "interest on securities (393(1) Sl. 5(i))"},
    "194": {code: "1029", note: "dividends (393(1) Sl. 7)"},
    // the owner, 17-Oct-2026: 1022 for a client that is not a bank, co-operative bank or post office (Client setup → TDS,
    // isBank, default no); for one that is, 1020 (senior citizen) or 1021 (others), which FinCom does not know: to confirm
    "194A": {bank: {no: "1022"}, bankWhy: "interest paid by a bank, co-operative bank or post office: 1020 if the deductee is a senior citizen, 1021 if not", note: "interest other than on securities (393(1) Sl. 5(ii), 5(iii))"},
    "194B": {unconfirmed: "winnings: 1058, or 1059 when given in kind (or the cash is not enough) and the tax was paid before release"},
    "194BA": {unconfirmed: "online games: 1060, or 1061 when given in kind (or the cash is not enough)"},
    "194BB": {code: "1062", note: "winnings from horse races (393(3) Sl. 3)"},
    "194C": {byPan: {P: "1023", H: "1023"}, other: "1024", note: "work contract: 1023 if the contractor is an individual or HUF (PAN's 4th letter P or H), else 1024 (393(1) Sl. 6(i))"},
    "194D": {code: "1005", note: "insurance commission (393(1) Sl. 1(i))"},
    "194DA": {code: "1030", note: "life insurance policy payout (393(1) Sl. 8(i))"},
    "194EE": {code: "1066", note: "NSS deposits, old section 80CCA(2)(a) (393(3) Sl. 6)"},
    "194G": {code: "1063", note: "commission on lottery tickets (393(3) Sl. 4)"},
    "194H": {code: "1006", note: "commission or brokerage, others (393(1) Sl. 1(ii))"},
    "194I": {by: {rent_machinery: "1008", rent_building: "1009"}, note: "rent: plant or machinery 1008, other (land, building, furniture) 1009 (393(1) Sl. 2(ii))"},
    "194IC": {code: "1011", note: "joint development agreement, section 67(14) (393(1) Sl. 3(ii))"},
    "194J": {by: {technical: "1026", professional: "1027", director: "1028"}, note: "technical services 1026, professional services 1027, a director's fees 1028 (393(1) Sl. 6(iii))"},
    "194K": {code: "1013", note: "units of a mutual fund (393(1) Sl. 4(i))"},
    "194LA": {code: "1012", note: "compensation on acquisition of immovable property (393(1) Sl. 3(iii))"},
    "194LBA": {unconfirmed: "business trust: interest 1014, dividend 1015, rent 1016"},
    "194LBB": {code: "1017", note: "investment fund units (393(1) Sl. 4(iii))"},
    "194LBC": {code: "1018", note: "securitisation trust (393(1) Sl. 4(iv))"},
    "194N": {unconfirmed: "cash withdrawal: 1064 to a co-operative society, 1065 to others; the amount above the limit is needed too"},
    "194O": {code: "1035", note: "e-commerce operator (393(1) Sl. 8(v))"},
    "194Q": {code: "1031", note: "purchase of goods (393(1) Sl. 8(ii))"},
    "194R": {unconfirmed: "business perquisite: 1033, or 1034 when in kind (or the cash is not enough) and the tax was paid before release"},
    "194S": {unconfirmed: "virtual digital asset: 1037, or 1038 when in kind or partly in kind"},
    "194T": {code: "1067", note: "partner's salary, remuneration, commission, bonus or interest (393(3) Sl. 7)"}
  },
  "27Q": {
    "195": {code: "1057", note: "any other sum chargeable to a non-resident (393(2) Sl. 17)"},
    "194E": {code: "1039", note: "non-resident sportsman, entertainer or sports association, section 211 income (393(2) Sl. 1)"}
  },
  "27EQ": {"6CA": "1068", "6CI": "1069", "6CB": "1070", "6CC": "1071", "6CD": "1072", "6CE": "1073", "6CJ": "1074", "6CL": "1075",
    "6CF": "1090", "6CG": "1091", "6CH": "1092"}
};
// The section codes of the 26Q / 27Q file's deductee records, in one place (the TDS review of 14-Oct-2026, H4). A section
// not listed keeps the code the file has always carried (194C -> 94C; 195 stays 195). A section split by what was paid for
// (TDSRate.payType: r.pay) has a code for each kind; a row whose kind is not known gets none, and the file says so.
// THE CODES MARKED unverified ARE NOT CHECKED AGAINST PROTEAN'S FILE FORMAT (the reviewer's memory of it): the owner to
// confirm them against Protean's current list before filing; docs/tds-codes.md says how.
// FVU 8.7 (17-Oct-2026): its list of the codes 26Q and 27Q may carry has 4JA, 4JB, 4IA, 4IB, 4DA, 4BB; 194LA is 94L there
// (4LA is not in it), 194LBB LBB, 194LBC LBC. Whether 4JA is technical and 4JB professional is not in the list: as before.
const TDS_SEC_CODES = {
  "194J": {by: {technical: "4JA", professional: "4JB"}, unverified: true, note: "194J(a) fees for technical services; 194J(b) professional fees"},
  "194I": {by: {rent_machinery: "4IA", rent_building: "4IB"}, note: "194-I(a) plant and machinery; 194-I(b) land, building or furniture (Protean's 2018 annexure)"},
  "194DA": {code: "4DA"}, "194BB": {code: "4BB"}, "194LA": {code: "94L"}, "194LBB": {code: "LBB"}, "194LBC": {code: "LBC"},
  "194LBA": {by: {}, note: "BA1 or BA2 by the clause of 194LBA: not known to FinCom"}
};
const TDS26Q = {
  // next-challan-match (the owner, 17-Oct-2026): no deduction is left out of a file silently. A deduction with tax on no
  // challan stops the file, with the list ({error, untagged}); one with no tax on no challan (a nil deduction: a nil challan
  // FinCom does not make) is counted in the file's answer (nilOut). rows: the return's deductions of the quarter
  untaggedError(rows, collections){
    const un = (rows || []).filter(r => !r.challan && num(r.tds) > 0.005);
    if (!un.length) return null;
    const w = collections ? ["collection", "collections"] : ["deduction", "deductions"];
    const rs = (v) => "\u20b9" + (typeof INR === "object" ? INR.format(r2(num(v))) : r2(num(v)).toFixed(2)), dt = (d) => { const t = TDS.ymd(d); return t.slice(6, 8) + "-" + t.slice(4, 6) + "-" + t.slice(0, 4); };
    return {error: un.length + " " + (un.length === 1 ? w[0] + " is" : w[1] + " are") + " on no challan (" + rs(un.reduce((a, r) => a + num(r.tds), 0)) + "): match " + (un.length === 1 ? "it" : "them") +
      " on the return's Challans tab first; the file is not made while any is left out. " + un.slice(0, 5).map(r => (r.party || r.employee || "?") + " " + dt(r.date) + " " + rs(r.tds)).join("; ") + (un.length > 5 ? " \u2026" : ""),
      untagged: un.map(r => r.id)};
  },
  // the deductee's name as the file writes it: the name corrected in FinCom (Deductees (PAN), b.panFix), else the books'
  fileName(r){ const f = ((S.books || {}).panFix || {})[r.party || r.employee] || {}; return f.name || r.party || r.employee || ""; },
  nilOut(rows){ return (rows || []).filter(r => !r.challan && !(num(r.tds) > 0.005)).length; },
  // the file is caret-delimited ASCII; each line is one record
  build(fy, q, firm, form){
    form = TDS_FORMS[form] ? form : "26Q";
    // tax year 2026-27 on: Forms 140, 144, 143 as Protean's file format has them (src/js/83); earlier years below, as before
    if (TDS.isNew(fy) && typeof TDSF25 === "object") return TDSF25.build(fy, q, firm, form);
    const isNew = TDS.isNew(fy), fno = TDS.formNo(form, fy), missing = new Set();
    const all = TDS_FORMS[form].rows().filter(r => r.fy === fy && r.q === q), un = this.untaggedError(all, form === "27EQ");
    if (un) return un;
    const rows = all.filter(r => r.challan), nilOut = this.nilOut(all);
    const used = {};
    rows.forEach(r => { (used[r.challan] = used[r.challan] || []).push(r); });
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
  // the payment code of the Act of 2025 for a deduction or collection (new forms); "" until the table has it
  payCode(r, form){ return this.payCodeOf(r, form).code; },
  // {code, why}: the code, or "" with why it has none ("payment code to confirm: …")
  payCodeOf(r, form, firm){
    const t = PAY_CODES[form] || {};
    if (form === "27EQ"){ const c = t[r.code || ""]; return c ? {code: c, why: ""} : {code: "", why: "payment code to confirm: " + (r.code ? "collection code " + r.code + " has no confirmed code in Form 143" : "no collection code")}; }
    const sec = TDS.sec(r.section), e = t[sec];
    if (!e) return {code: "", why: "payment code to confirm: " + sec + " has no confirmed code in Form " + TDS.formNo(form, "2026-27")};
    if (e.unconfirmed) return {code: "", why: "payment code to confirm: " + e.unconfirmed};
    if (e.code) return {code: e.code, why: ""};
    if (e.bank){
      let f = firm; if (!f) try { f = this.firmDetails(); } catch (x){ f = {}; }
      return f && f.isBank ? {code: "", why: "payment code to confirm: " + sec + ", " + e.bankWhy} : {code: e.bank.no, why: ""};
    }
    if (e.byPan){
      const p = String(r.pan || "").toUpperCase(), k = Certs.validPan(p) ? p[3] : "";
      if (!k) return {code: "", why: "payment code to confirm: " + sec + " to " + (r.party || "?") + ", no valid PAN to tell an individual or HUF (" + Object.values(e.byPan)[0] + ") from others (" + e.other + ")"};
      return {code: e.byPan[k] || e.other, why: ""};
    }
    const c = e.by && e.by[r.pay];
    return c ? {code: c, why: ""} : {code: "", why: "payment code to confirm: " + sec + ", what was paid for is not known (" + Object.keys(e.by || {}).join(" or ") + ")"};
  },
  // the deductions of a new-form return (FY 2026-27 on) with no confirmed payment code: [{row, why}] (To fix)
  payCodeRows(fy, q, form){
    if (!TDS.isNew(fy) || !TDS_FORMS[form]) return [];
    const firm = this.firmDetails();
    return TDS_FORMS[form].rows().filter(r => r.fy === fy && r.q === q).map(r => ({row: r, why: this.payCodeOf(r, form, firm).why})).filter(x => x.why);
  },
  // the section code as the 26Q / 27Q file carries it (FVU 8.7's list): 194C is 94C, 194EE 4EE, 194LC 4LC; 193, 194 and 195
  // stay as they are; 196D is 96D
  code(section){
    const s = TDS.sec(section);
    if (/^19[345]$/.test(s)) return s;
    if (/^196[A-D]$/.test(s)) return s.slice(1);
    if (/^194[A-Z]{2}$/.test(s)) return "4" + s.slice(3);
    return "9" + s.replace(/^19/, "");
  },
  // a deduction's code, from the one table (TDS_SEC_CODES); "" when its section is split and what was paid for is not known
  codeFor(r){
    const s = TDS.sec(r.section), t = TDS_SEC_CODES[s];
    if (!t) return this.code(r.section);
    if (t.code) return t.code;
    return (t.by && t.by[r.pay]) || "";
  },
  // A: a certificate covers the payment (its number goes beside); C: the higher rate, with no PAN or an inoperative one
  remark(r, form){
    const cert = form === "27EQ" ? TCS27EQ.certFor(r) : Certs.forRow(r);
    if (cert) return {remark: "A", certNo: String(cert.certNo || "").toUpperCase().slice(0, 10), certFull: String(cert.certNo || "").toUpperCase().replace(/\s/g, "")};
    if (!Certs.validPan(r.pan) || Certs.inoperative(r.pan)) return {remark: "C", certNo: ""};
    return {remark: "", certNo: ""};
  },
  // 27Q: the deductee's details a non-resident return asks for, kept per party in S.books.nrInfo
  nrInfo(party){ return ((S.books || {}).nrInfo || {})[party] || {}; },
  nrTail(r){
    const i = this.nrInfo(r.party), t = v => String(v == null ? "" : v).replace(/[\^\r\n]/g, " ").replace(/[^\x20-\x7E]/g, "").trim();
    // rate under the Act (A) or the treaty (B); the nature of the remittance; the Form 15CA acknowledgement; the country;
    // e-mail, phone, address and tax identification number in the country of residence
    return [i.dtaa ? "B" : "A", t(i.nature).slice(0, 2), t(i.ack15ca).slice(0, 15), t(i.country).slice(0, 3), t(i.email).slice(0, 75),
      t(i.phone).slice(0, 15), t(i.address).slice(0, 150), t(i.tin).slice(0, 25)];
  },
  // 27EQ: the collectee's PAN status and whether the buyer is a non-resident
  tcsTail(r){ return [r.nonResident ? "Y" : "N", ""]; },
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
      const tax = sum(14), interest = r2(num(part.interest)), fee = r2(num(part.fee));
      return {c, dds, tax, interest, fee, total: r2(tax + interest + fee), deposited: sum(19), deducted: sum(17)};
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
        22: money(x.tax), 23: "0.00", 24: "0.00", 25: money(x.interest), 26: "0.00", 27: money(x.total), 29: money(x.deposited), 30: money(x.tax), 31: "0.00", 32: "0.00",
        33: money(x.deducted), 34: money(x.interest), 35: "0.00", 37: "N", 39: money(x.fee), 40: String(x.c.minorHead || "200")});
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
  // the deductor's details: what the client's settings keep (co.tds26q), else the TAN, PAN and name. category: the deductor
  // category the files up to FY 2025-26 carry (oldText): the one set, else from the PAN's fourth letter (K company, F firm,
  // Q individual or HUF, P AOP, T trust, B BOI, J artificial juridical person; "" for any other: a government body, an LLP,
  // a local authority: asked). The new forms' draft keeps deductorType, F unless set, as before
  firmDetails(){
    const co = CO(), f = (co.tds26q || {}), pan = String(co.pan || "").toUpperCase();
    const byPan = /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? ({C: "K", F: "F", P: "Q", H: "Q", A: "P", T: "T", B: "B", J: "J"}[pan[3]] || "") : "";
    // Client setup → TDS (the deductor's details, co.tds26q). category: as chosen, else from the PAN (the old files' batch
    // header, next-fvu87); deductorType only as chosen (the new forms read it from the PAN themselves, TDSF25.categoryFor;
    // the old draft path keeps F when none is chosen). gstinOwn: the client's own GSTIN, which the new forms write unless one is
    // given here (the old files write only one given here, as before)
    return Object.assign({tan: co.tan || "", pan: co.pan || "", name: co.tallyName || co.name, category: f.deductorType || byPan, gstinOwn: co.gstin || ""}, f);
  }
};

/* ---------- 27EQ: tax collected at source (old section 206C; section 394 of the Income-tax Act, 2025) ---------- */
const TCS27EQ = {
  // the collection code of the 27EQ file, from the words in the TCS ledger's name; a ledger the words do not place is left
  // for a person to choose (S.books.tcsCodes[ledger])
  // the official codes of Form 27EQ (the TDS review of 14-Oct-2026, H3: 6CB to 6CI were shifted by one), matched in this
  // order (tendu before forest produce, timber under a lease before other timber)
  CODES: [
    ["6CA", "Alcoholic liquor for human consumption", /LIQUOR|ALCOHOL/],
    ["6CI", "Tendu leaves", /TENDU/],
    ["6CB", "Timber obtained under a forest lease", /TIMBER.*LEASE|FOREST\s*LEASE/],
    ["6CC", "Timber obtained other than under a forest lease", /TIMBER/],
    ["6CD", "Any other forest produce", /FOREST/],
    ["6CE", "Scrap", /SCRAP/],
    ["6CF", "Parking lot (lease or licence)", /PARKING/],
    ["6CG", "Toll plaza (lease or licence)", /TOLL/],
    ["6CH", "Mining and quarrying (lease or licence)", /MINING|QUARR/],
    ["6CJ", "Minerals: coal, lignite or iron ore", /COAL|LIGNITE|IRON\s*ORE|MINERAL/],
    ["6CL", "Motor vehicle above ₹10 lakh", /MOTOR|VEHICLE|CAR\b/],
    ["6CO", "Overseas tour programme package", /OVERSEAS|TOUR\s*PACKAGE|FOREIGN\s*TOUR/]
  ],
  // a code a person chose from the old, shifted list (before 14-Oct-2026) means the nature it was shown with: moved to that
  // nature's official code, once per client (b.tcsCodesFixed)
  OLD_TO_NEW: {"6CB": "6CI", "6CC": "6CB", "6CD": "6CC", "6CE": "6CD", "6CF": "6CE", "6CG": "6CF", "6CH": "6CG", "6CI": "6CH"},
  fixCodes(b){
    if (!b || b.tcsCodesFixed) return false;
    const t = b.tcsCodes || {}, out = {};
    Object.keys(t).forEach(l => { out[l] = this.OLD_TO_NEW[t[l]] || t[l]; });
    b.tcsCodes = out; b.tcsCodesFixed = "2026-10-14";
    return true;
  },
  codeOf(ledger, section){
    const b = S.books || {};
    if (b.tcsCodes && !b.tcsCodesFixed && this.fixCodes(b) && typeof saveBooks === "function") try { saveBooks(); } catch (e){}
    const set = (b.tcsCodes || {})[ledger];
    if (set) return set;
    const up = String(ledger || "").toUpperCase();
    const hit = this.CODES.find(([, , re]) => re.test(up));
    return hit ? hit[0] : "";
  },
  // a lower collection certificate (old section 206C(9)) for this buyer, kept with the other certificates as section 206C
  certFor(r){
    return Certs.all().find(c => /^206C/.test(String(c.section || "")) && normName(c.party) === normName(r.party) &&
      (!c.from || TDS.ymd(r.date) >= TDS.ymd(c.from)) && (!c.to || TDS.ymd(r.date) <= TDS.ymd(c.to))) || null;
  },
  // what is missing before a 27EQ can be filed
  checks(fy, q){
    const out = [];
    TDS.tcsRows().filter(r => r.fy === fy && r.q === q).forEach(r => {
      if (!r.code){ out.push({row: r, why: "No collection code for the ledger " + r.ledger + ". Choose one."}); return; }
      // the rate that applies on the collection's date (overseas tours before April 2026: 5%, or 20% above ₹10 lakh)
      const want = TDS.tcsRate(r.code, r.date), alt = r.code === "6CO" && TDS.ymd(r.date) < "20260401" ? [5, 20] : [want];
      if (want != null && r.rate != null && !alt.some(a => Math.abs(a - r.rate) < 0.05))
        out.push({row: r, why: r.party + " (" + fmtDate(tallyDate(r.date)) + "): TCS at " + r.rate + "%, but " + alt.join("% or ") + "% applies to " + r.code + " on that date."});
    });
    return out;
  }
};
