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
// The payment codes of the new forms (FY 2026-27 on), by form: Form 140 (26Q) by old section (and, for a section split by
// what was paid for, by TDSRate.payType: r.pay); Form 143 (27EQ) by the old collection code. From the coordinator's
// research of 14-Oct-2026 (docs/tds-codes.md, with the sources): several secondary sources agree; the official text
// (Income-tax Rules 2026, Protean's file format) could not be reached. A section with { unconfirmed } gets NO code: the
// sources disagree, so FinCom never picks one; its deductions are in To fix as "payment code to confirm" (payCodeRows).
// Anything not listed is unconfirmed the same way. The codes some sources only infer (1007, 1010, 1025, 1036) are never used.
const PAY_CODES = {
  "26Q": {
    "194J": {by: {technical: "1026", professional: "1027"}, note: "s.393(1): technical services (old 194J(a)) at 2%; professional services (old 194J(b)) at 10%"},
    "194T": {code: "1067", note: "partner's remuneration (old 194T)"},
    "194I": {unconfirmed: "rent: the sources disagree (1008/1009, or 1016/1017/1019)"}
  },
  "27EQ": {"6CA": "1068", "6CI": "1069", "6CB": "1070", "6CC": "1071", "6CD": "1072", "6CE": "1073"}
};
// The section codes of the 26Q / 27Q file's deductee records, in one place (the TDS review of 14-Oct-2026, H4). A section
// not listed keeps the code the file has always carried (194C -> 94C; 195 stays 195). A section split by what was paid for
// (TDSRate.payType: r.pay) has a code for each kind; a row whose kind is not known gets none, and the file says so.
// THE CODES MARKED unverified ARE NOT CHECKED AGAINST PROTEAN'S FILE FORMAT (the reviewer's memory of it): the owner to
// confirm them against Protean's current list before filing; docs/tds-codes.md says how.
const TDS_SEC_CODES = {
  "194J": {by: {technical: "4JA", professional: "4JB"}, unverified: true, note: "194J(a) fees for technical services; 194J(b) professional fees"},
  "194I": {by: {rent_machinery: "4IA", rent_building: "4IB"}, note: "194-I(a) plant and machinery; 194-I(b) land, building or furniture (Protean's 2018 annexure)"},
  "194DA": {code: "4DA", unverified: true}, "194BB": {code: "4BB", unverified: true}, "194LA": {code: "4LA", unverified: true}
};
const TDS26Q = {
  // the file is caret-delimited ASCII; each line is one record
  build(fy, q, firm, form){
    form = TDS_FORMS[form] ? form : "26Q";
    const isNew = TDS.isNew(fy), fno = TDS.formNo(form, fy), missing = new Set();
    const rows = TDS_FORMS[form].rows().filter(r => r.fy === fy && r.q === q && r.challan);
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
          r.pan && Certs.validPan(r.pan) ? r.pan : "PANNOTAVBL", txt(r.party), "", money(r.paid), money(r.tds), "0.00", "0.00", money(r.tds), "0.00", money(r.tds),
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
  payCodeOf(r, form){
    const t = PAY_CODES[form === "27EQ" ? "27EQ" : form === "26Q" ? "26Q" : ""] || {};
    if (form === "27EQ"){ const c = t[r.code || ""]; return c ? {code: c, why: ""} : {code: "", why: "payment code to confirm: " + (r.code ? "collection code " + r.code + " has no confirmed code in Form 143" : "no collection code")}; }
    const sec = TDS.sec(r.section), e = t[sec];
    if (!e) return {code: "", why: "payment code to confirm: " + sec + " has no confirmed code in Form " + TDS.formNo(form, "2026-27")};
    if (e.unconfirmed) return {code: "", why: "payment code to confirm: " + e.unconfirmed};
    if (e.code) return {code: e.code, why: ""};
    const c = e.by && e.by[r.pay];
    return c ? {code: c, why: ""} : {code: "", why: "payment code to confirm: " + sec + ", what was paid for is not known (" + Object.keys(e.by || {}).join(" or ") + ")"};
  },
  // the deductions of a new-form return (FY 2026-27 on) with no confirmed payment code: [{row, why}] (To fix)
  payCodeRows(fy, q, form){
    if (!TDS.isNew(fy) || !TDS_FORMS[form]) return [];
    return TDS_FORMS[form].rows().filter(r => r.fy === fy && r.q === q).map(r => ({row: r, why: this.payCodeOf(r, form).why})).filter(x => x.why);
  },
  // the section code as the 26Q file has carried it: 194C is 94C; 195 stays 195
  code(section){ const s = TDS.sec(section); return /^19[5-6]/.test(s) ? s : "9" + s.replace(/^19/, ""); },
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
    if (cert) return {remark: "A", certNo: String(cert.certNo || "").toUpperCase().slice(0, 10)};
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
  firmDetails(){
    const co = CO(), f = (co.tds26q || {});
    return Object.assign({tan: co.tan || "", pan: co.pan || "", name: co.tallyName || co.name, deductorType: "F"}, f);
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
