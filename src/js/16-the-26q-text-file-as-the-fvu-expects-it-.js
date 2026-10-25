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
  // next-challan-match (the owner, 17-Oct-2026): no deduction is left out of a file silently; next-tds-validate-short (25-Oct-
  // 2026): a deduction the file cannot carry is left out and said (TDS26Q.leftOut, src/js/92), never a refusal. A nil
  // deduction on no challan (a nil challan FinCom does not make) is counted in the file's answer (nilOut)
  // the deductee's name as the file writes it: the name corrected in FinCom (Deductees (PAN), b.panFix), else the books'
  fileName(r){ const f = (TDS.panRec ? TDS.panRec(r.party || r.employee) : ((S.books || {}).panFix || {})[r.party || r.employee]) || {}; return f.name || r.party || r.employee || ""; },
  nilOut(rows){ return (rows || []).filter(r => !r.challan && !(num(r.tds) > 0.005)).length; },
  // the file builders (build, the old forms' oldBuild / oldText and their helpers) and nrChecks: src/js/92 (TDS26QFile),
  // with the TDS screens (legacy.js's size; the TDS check of 22-Oct-2026)
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
    const c = e.by && e.by[r.pay || this.payGuess(r)];
    return c ? {code: c, why: ""} : {code: "", why: "payment code to confirm: " + sec + ", what was paid for is not known (" + Object.keys(e.by || {}).join(" or ") + ")"};
  },
  // next-tds-tidy2 (the owner: "Winman does not ask this"): what a 194J or 194-I payment was for when Tally's ledgers did
  // not say (r.pay): the rate deducted (194J 2% technical, 10% professional, a director's only where the words say so;
  // 194-I 2% machinery, 10% building), then the words of the party and the ledgers (professional, legal, audit, accounting,
  // consultancy; technical, software, IT, AMC, service charges; director, sitting fee), then the choice made before for the
  // deductee and ledger (b.tdsPayKind, Validate & file › Payment code to confirm). "" when none decides
  payGuess(r){
    const sec = TDS.sec(r.section);
    if (sec !== "194J" && sec !== "194I") return "";
    const v = this.vch(r), w = [r.party, r.ledger].concat(v ? (v.ent || []).map(e => e.l) : []).join(" ").toUpperCase();
    const rt = num(r.paid) > 0 ? r.tds / r.paid * 100 : num(r.rate), at = x => Math.abs(rt - x) < 0.06;
    if (sec === "194I") return at(2) ? "rent_machinery" : at(10) ? "rent_building" : TDSRate.kindOf(w).replace(/^(?!rent_).*/, "") || this.payKind(r);
    if (/DIRECTOR|SITTING\s*FEE/.test(w)) return "director";
    if (at(2)) return "technical";
    if (at(10)) return "professional";
    if (/TECHNICAL|SOFTWARE|\bIT\b|\bAMC\b|SERVICE\s*CHARGE|CALL\s*CENT/.test(w)) return "technical";
    if (/PROFESSIONAL|LEGAL|AUDIT|ACCOUNTING|CONSULT|ADVOCATE|RETAINER/.test(w)) return "professional";
    return this.payKind(r);
  },
  vch(r){ const b = S.books || {}; if (this._vb !== b.vouchers){ this._vb = b.vouchers; this._vm = new Map((b.vouchers || []).map(v => [v.id, v])); } return this._vm.get(String(r.id).split("|")[0]); },
  payKey(r){ return normName(r.party || "") + "|" + (r.ledger || ""); },
  payKind(r){ return ((S.books || {}).tdsPayKind || {})[this.payKey(r)] || ""; },
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
    return (t.by && t.by[r.pay || this.payGuess(r)]) || "";
  },
  // A: a certificate covers the payment (its number goes beside); C: the higher rate, with no PAN or an inoperative one
  // M4: no tax deducted, a deduction typed with its reason: T a transporter's declaration (194C(6), with PAN), Y below the
  // threshold (B, Form 15G/15H, asks the declaration's own details the file has fields for: not written yet)
  remark(r, form){
    if (!(num(r.tds) > 0.005) && /^[TY]$/.test(r.basis || "") && Certs.validPan(r.pan) && form !== "27EQ" && (r.basis === "Y" || /^194C/.test(TDS.sec(r.section)))) return {remark: r.basis, certNo: ""};
    const cert = form === "27EQ" ? TCS27EQ.certFor(r) : Certs.forRow(r);
    if (cert) return {remark: "A", certNo: String(cert.certNo || "").toUpperCase().slice(0, 10), certFull: String(cert.certNo || "").toUpperCase().replace(/\s/g, "")};
    // (the TDS check of 22-Oct-2026, N10: C only where the higher rate was deducted, 20%, or 5% under 194Q and 194-O; the FVU
    // refuses C with a lower rate, and a no-PAN deduction at the usual rate is a short deduction, said by Certs.issues)
    if ((!Certs.validPan(r.pan) || Certs.inoperative(r.pan)) && (form === "27Q" || num(r.rate) >= (/^194[QO]$/.test(TDS.sec(r.section)) ? 5 : 20))) return {remark: "C", certNo: ""};
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
