/* @react-lazy: begin 88-fin-statements.js (the React app loads this file with the Financial statements page: app/src/lib/finGlobals.js; build.py react_parts) */
/* ================================================================== */
/* Financial statements in the owner's audit format (ROUND 99,        */
/* 20-Oct-2026): every figure from the trial balance by code, worked  */
/* out exactly as the Excel formulas do (docs/fin-statements-api.md)  */
/* ================================================================== */
// The model only: no screen. FinSt.tb(fy) is the trial balance (Ledger | PY | CY | Adj | Final | Code), FinSt.build(fy,
// {unit, dec}) the notes, balance sheet, profit and loss, cash flow, PPE schedule, computation of income and checks.
// Amounts in the TB are in rupees with a debit positive (the workbooks' sign); a note line is ROUND(sign x SUMIFS(the TB
// in the unit, the code), dec), its sign -1 for liabilities and income, +1 for assets and expenses. Stored per client in
// b.fs (synced with the books): map (ledger -> code; old line names are read as codes), adj {fy: [{dr, cr, amt, narr}]},
// inputs, regime, taxDep {fy: {block: opening WDV}}, taxBlock {ledger: block}, compEdits {fy: {line: {v, why}}},
// pyTb {fy: {ledger: amount}}, ppeAdj {fy: {gross code: {sale, dep}}}, stock (FS's typed stock).
const FinSt = (() => {
  const UNITS = {1: "Rupees", 1000: "Rupees thousand", 100000: "Rupees lakhs", 10000000: "Rupees crores"};
  // Excel's ROUND: half away from zero on the decimal figure (binary noise cleared first: 0.035 -> 0.04, 2.675 -> 2.68)
  const RND = (v, d) => { v = +v || 0; const p = Math.pow(10, d), x = Number((Math.abs(v) * p).toPrecision(15)), r = Math.round(x) / p * Math.sign(v); return r === 0 ? 0 : r; };
  const N = v => +v || 0, R2 = v => RND(v, 2);

  // ---------- the catalogue: notes, their groups and codes (codes of the owner's workbook keep their meaning) ----------
  // a note: key, title, st (BS / PL), sign, groups [g, head, sec (balance sheet section), codes [[code, label, extra]]];
  // only: "co" (companies) or "nc" (firms, LLPs, proprietors and other non-corporate entities)
  const NOTES = [
    {key: "3", title: "Share capital", st: "BS", sign: -1, only: "co", groups: [["sc", "Issued, subscribed and fully paid up", "EQ", [["3A", "Equity shares, fully paid up"], ["3B", "Preference shares, fully paid up"]]]]},
    {key: "3", title: "Partners' capital accounts", st: "BS", sign: -1, only: "nc", groups: [["cap", "", "EQ", [["3P", "Capital accounts"], ["3Q", "Current accounts"], ["3R", "Less: drawings"]]]]},
    {key: "4", title: "Reserves and surplus", st: "BS", sign: -1, groups: [["res", "", "EQ", [["4B", "Securities premium"], ["4C", "General reserve"], ["4D", "Other reserves"]]], ["sur", "Surplus in the statement of profit and loss", "EQ", [["4A", "Balance at the beginning of the year"],
      // the profit of the year before the period chosen (statements for a part of the year): FinCom's own line, never a ledger's
      ["4E", "Profit for the earlier part of the year", {sys: true}]]]]},
    {key: "30", title: "Long-term borrowings", st: "BS", sign: -1, groups: [["ltb", "", "NCL", [["30A", "Term loans from banks (secured)"], ["30B", "Loans from related parties and others"]]]]},
    {key: "31", title: "Deferred tax liabilities (net)", st: "BS", sign: -1, groups: [["dtl", "", "NCL", [["31A", "Deferred tax liabilities (net)"]]]]},
    {key: "32", title: "Other long-term liabilities", st: "BS", sign: -1, groups: [["oltl", "", "NCL", [["32A", "Other long-term liabilities"]]]]},
    {key: "5", title: "Provisions", st: "BS", sign: -1, groups: [["lt", "Long-term provisions", "NCL", [["5A", "Gratuity (non-current portion)"], ["5C", "Leave encashment (non-current portion)"], ["5D", "Other long-term provisions"]]],
      ["st", "Short-term provisions", "CL", [["5E", "Gratuity (current portion)"], ["5B", "Leave encashment"], ["5F", "Provision for expenses"], ["5G", "Other short-term provisions"]]]]},
    {key: "33", title: "Short-term borrowings", st: "BS", sign: -1, groups: [["stb", "", "CL", [["33A", "Loans repayable on demand from banks (cash credit / overdraft)"], ["33B", "Loans from related parties and others"], ["33C", "Credit cards"]]]]},
    {key: "6", title: "Trade payables", st: "BS", sign: -1, groups: [["msme", "", "CL", [["6A", "Outstanding dues of micro and small enterprises", {msme: true}]]], ["oth", "", "CL", [["6B", "Outstanding dues of creditors other than micro and small enterprises"]]]]},
    {key: "7", title: "Other current liabilities", st: "BS", sign: -1, groups: [["ocl", "", "CL", [["7A", "Other payables"], ["7B", "Employee related payables"], ["7C", "Payable for statutory remittances (PF, ESI, GST, withholding taxes)"],
      ["7D", "Provision for income tax (net of advance tax)"], ["7E", "Advances from customers"], ["7F", "Creditors for capital goods"], ["7G", "Interest accrued"], ["7H", "Income received in advance"]]]]},
    {key: "8", title: "Property, plant and equipment", st: "BS", sign: 1, grid: "ppe", groups: [["ppe", "", "NCA", []]]},
    {key: "34", title: "Intangible assets", st: "BS", sign: 1, grid: "int", groups: [["int", "", "NCA", []]]},
    {key: "35", title: "Capital work-in-progress and intangible assets under development", st: "BS", sign: 1, groups: [["cwip", "", "NCA", [["35A", "Capital work-in-progress"]]], ["iaud", "", "NCA", [["35B", "Intangible assets under development"]]]]},
    {key: "36", title: "Non-current investments", st: "BS", sign: 1, groups: [["nci", "", "NCA", [["36A", "Non-current investments"]]]]},
    {key: "9", title: "Deferred tax assets (net)", st: "BS", sign: 1, groups: [["dta", "", "NCA", [["9A", "Deferred tax assets (net)"]]]]},
    {key: "38", title: "Long-term loans and advances and other non-current assets", st: "BS", sign: 1, groups: [["la", "(a) Long-term loans and advances (unsecured, considered good)", "NCA", [["38A", "Security deposits"], ["38B", "Capital advances"], ["38D", "Other long-term loans and advances"]]],
      ["onca", "(b) Other non-current assets", "NCA", [["38C", "Other non-current assets"]]]]},
    {key: "37", title: "Current investments", st: "BS", sign: 1, groups: [["ci", "", "CA", [["37A", "Current investments"]]]]},
    {key: "39", title: "Inventories", st: "BS", sign: 1, groups: [["inv", "", "CA", [["39A", "Inventories"]]]]},
    {key: "10", title: "Trade receivables", st: "BS", sign: 1, groups: [["tr", "", "CA", [["10A", "Unsecured, considered good"], ["10B", "Less: provision for doubtful receivables"]]]]},
    {key: "11", title: "Cash and bank balances", st: "BS", sign: 1, groups: [["cce", "Cash and cash equivalents", "CA", [["11D", "Cash on hand"], ["11A", "Balances with banks - on current accounts"]]],
      ["obb", "Other bank balances", "CA", [["11B", "Fixed deposits with original maturity of more than 3 months"], ["11C", "Deposits under lien / margin money"]]]]},
    {key: "12", title: "Short-term loans and advances and other current assets", st: "BS", sign: 1, groups: [["la", "(a) Short-term loans and advances (unsecured, considered good)", "CA", [["12A", "Security deposits"], ["12B", "Advance income tax and TDS (net of provision)"],
      ["12C", "Prepaid expenses"], ["12D", "Goods and Services Tax and other taxes receivable"], ["12F", "Advances to suppliers"], ["12G", "Loans and advances to employees"], ["12H", "Other loans and advances"]]],
      ["oca", "(b) Other current assets", "CA", [["12E", "Interest accrued on deposits"], ["12K", "Other current assets (unbilled revenue and others)"]]]]},
    {key: "13", title: "Revenue from operations", st: "PL", sign: -1, groups: [["rev", "", "", [["13A", "Sale of services"], ["13B", "Sale of products"], ["13C", "Other operating revenue"]]]]},
    {key: "14", title: "Other income", st: "PL", sign: -1, groups: [["oth", "", "", [["14A", "Interest on fixed deposits"], ["14B", "Profit on sale of assets"], ["14C", "Exchange gain (net)"], ["14D", "Interest on income tax refund"], ["14E", "Other non-operating income"]]]]},
    {key: "40", title: "Cost of materials consumed", st: "PL", sign: 1, groups: [["mat", "", "", [["40A", "Cost of materials consumed"]]]]},
    {key: "41", title: "Purchases of stock-in-trade", st: "PL", sign: 1, groups: [["pur", "", "", [["41A", "Purchases of stock-in-trade"]]]]},
    {key: "42", title: "Changes in inventories", st: "PL", sign: 1, groups: [["chg", "", "", [["42A", "Changes in inventories of finished goods, work-in-progress and stock-in-trade"]]]]},
    {key: "15", title: "Employee benefits expense", st: "PL", sign: 1, groups: [["emp", "", "", [["15A", "Salaries, wages and bonus"], ["15B", "Contribution to provident and other funds"], ["15C", "Staff welfare expenses"],
      ["15D", "Share based payments to employees"], ["15E", "Gratuity"], ["15P", "Remuneration to partners", {only: "nc"}]]]]},
    {key: "16", title: "Finance costs", st: "PL", sign: 1, groups: [["fin", "", "", [["16A", "Interest on statutory dues"], ["16B", "Interest on borrowings"], ["16C", "Other borrowing costs"], ["16P", "Interest on partners' capital", {only: "nc"}]]]]},
    {key: "17", title: "Other expenses", st: "PL", sign: 1, groups: [["exp", "", "", [["17A", "Rent"], ["17B", "Recruitment"], ["17C", "Travelling and conveyance"], ["17D", "Payment to auditors"], ["17E", "Legal and professional"], ["17F", "Insurance"],
      ["17G", "Bank charges"], ["17H", "Training"], ["17K", "Power and fuel"], ["17L", "Repairs and maintenance"], ["17M", "Communication"], ["17N", "Printing and stationery"], ["17P", "Rates and taxes"],
      ["17Q", "Advertisement and business promotion"], ["17R", "Corporate social responsibility"], ["17S", "Bad debts written off"], ["17T", "Loss on sale of assets"], ["17U", "Exchange loss (net)"],
      ["17V", "Commission and brokerage"], ["17W", "Software and subscriptions"], ["17J", "Miscellaneous expenses (including rounding off)"]]]]},
    {key: "43", title: "Exceptional items", st: "PL", sign: 1, groups: [["exc", "", "", [["43A", "Exceptional items"]]]]},
    {key: "22", title: "Tax expense", st: "PL", sign: 1, nonote: true, groups: [["tax", "", "", [["22A", "Current tax"], ["22B", "Tax relating to earlier years"], ["22C", "Deferred tax charge / (credit)"]]]]}
  ];
  // the fixed assets' classes: gross block and accumulated depreciation codes, and the income-tax block they fall in
  const PPE = [["comp", "Computers", "8A", "8C", "c40"], ["oe", "Office equipment", "8B", "8D", "pm15"], ["furn", "Furniture and fixtures", "8F", "8G", "f10"], ["pm", "Plant and machinery", "8H", "8J", "pm15"],
    ["veh", "Vehicles", "8K", "8L", "pm15"], ["bld", "Buildings", "8M", "8N", "b10"], ["land", "Freehold land", "8P", "", ""], ["lhi", "Leasehold improvements", "8Q", "8R", "b10"]];
  const INT = [["sw", "Computer software and other intangible assets", "34A", "34B", "i25"]];
  const BLOCKS = [["c40", "Computers including software (40%)", 0.4], ["pm15", "Plant and machinery (15%)", 0.15], ["f10", "Furniture and fittings (10%)", 0.1], ["b10", "Buildings (10%)", 0.1], ["i25", "Intangible assets (25%)", 0.25]];
  const CODES = {};
  NOTES.forEach(n => n.groups.forEach(([g, head, sec, codes]) => codes.forEach(([code, label, x]) => {
    CODES[code] = Object.assign({code, note: n.key, group: g, label, side: n.st, sign: n.sign, sec: sec || "", only: n.only || ""}, x || {}); })));
  PPE.concat(INT).forEach(([cls, label, g, a, blk], i) => { const key = i < PPE.length ? "8" : "34";
    CODES[g] = {code: g, note: key, group: key === "8" ? "ppe" : "int", label: label + " - gross block", side: "BS", sign: 1, sec: "NCA", only: "", ppe: "gross", cls, blk};
    if (a) CODES[a] = {code: a, note: key, group: key === "8" ? "ppe" : "int", label: label + " - accumulated depreciation", side: "BS", sign: 1, sec: "NCA", only: "", ppe: "dep", cls, blk}; });
  CODES["8E"] = {code: "8E", note: "8", group: "dep", label: "Depreciation on property, plant and equipment", side: "PL", sign: 1, sec: "", only: ""};
  CODES["34D"] = {code: "34D", note: "34", group: "dep", label: "Amortisation of intangible assets", side: "PL", sign: 1, sec: "", only: ""};
  const codes = kind => Object.fromEntries(Object.entries(CODES).filter(([, c]) => !c.only || c.only === kind));
  const OLD = ["share", "capital", "reserves", "ltb", "dtl", "oltl", "ltp", "stb", "tp", "ocl", "stp", "ppe", "intang", "cwip", "nci", "dta", "ltla", "onca", "ci", "inv", "tr", "cash", "stla", "oca",
    "rev", "oth", "mat", "pur", "chg", "emp", "fin", "dep", "exp", "exc", "tax"];

  // ---------- suggest: FS.place's line for the ledger, then the code by its name and groups ----------
  const kindOf = () => FS.cfg(S.books).kind === "co" ? "co" : "nc";
  const ppeCls = nm => /COMPUTER|LAPTOP|SERVER|PRINTER|DESKTOP|\bIT EQUIP/.test(nm) ? "comp" : /FURNITURE|FIXTURE/.test(nm) ? "furn" : /VEHICLE|\bCARS?\b|MOTOR|SCOOTER|BIKE|TWO WHEELER/.test(nm) ? "veh" :
    /LEASEHOLD IMPROVE/.test(nm) ? "lhi" : /BUILDING|PREMISES|\bFLAT\b|OFFICE SPACE/.test(nm) ? "bld" : /\bLAND\b/.test(nm) ? "land" : /PLANT|MACHINE/.test(nm) ? "pm" :
    /EQUIP|MOBILE|AIR CONDITION|\bAC\b|CCTV|ELECTRICAL|APPLIANCE/.test(nm) ? "oe" : "pm";
  const EXP = [[/PENALT|\bFINES?\b|LATE FEE|COMPOUNDING/, "17J"], [/\bRENT\b|LEASE RENT|HIRE CHARGES/, "17A"], [/RECRUIT|HIRING|MANPOWER/, "17B"], [/TRAVEL|CONVEYANCE|\bTOUR|HOTEL|LODGING|AIRFARE|TAXI|\bCAB\b/, "17C"],
    [/AUDIT FEE|AUDITOR|STATUTORY AUDIT|TAX AUDIT/, "17D"], [/LEGAL|PROFESSIONAL|CONSULT/, "17E"], [/INSURANCE/, "17F"], [/BANK CHARGE|BANK COMMISSION/, "17G"], [/TRAINING|SEMINAR|CONFERENCE/, "17H"],
    [/POWER|ELECTRICITY|FUEL|DIESEL|PETROL|GENERATOR/, "17K"], [/REPAIR|MAINTENANCE|\bAMC\b/, "17L"], [/TELEPHONE|INTERNET|MOBILE|COMMUNICATION|POSTAGE|COURIER|BROADBAND/, "17M"], [/PRINTING|STATIONERY/, "17N"],
    [/RATES|TAXES|FILING FEE|\bROC\b|STAMP DUTY|REGISTRATION|LICEN[CS]E FEE/, "17P"], [/ADVERTIS|MARKETING|PROMOTION|PUBLICITY|SPONSOR/, "17Q"], [/\bCSR\b|CORPORATE SOCIAL/, "17R"],
    [/BAD DEBT|WRITTEN OFF|WRITE OFF|PROVISION FOR DOUBTFUL/, "17S"], [/LOSS ON SALE|LOSS ON DISPOSAL/, "17T"], [/EXCHANGE|FOREX|FOREIGN/, "17U"], [/COMMISSION|BROKERAGE/, "17V"], [/SOFTWARE|SUBSCRIPTION|SAAS|CLOUD|HOSTING/, "17W"]];
  const STAT_INT = /INTEREST\b.*\b(TDS|TCS|GST|IGST|CGST|SGST|INCOME TAX|STATUTORY|PF|ESI|PROFESSIONAL TAX|SERVICE TAX|LATE PAYMENT)\b|\b(TDS|TCS|GST)\b.*\bINTEREST/;
  // the code within an old line (or the line FS.place gives); bal is a debit positive
  function refine(l, line, gp, bal, kind){
    const nm = String(l).toUpperCase(), P = (gp || []).map(g => String(g).toLowerCase()), has = g => P.includes(g), up = nm + " " + P.join(" ").toUpperCase(), cr = N(bal) < 0;
    const plLine = ["rev", "oth", "mat", "pur", "chg", "emp", "fin", "dep", "exp", "exc", "tax"].includes(line);
    if (plLine){
      if (/^(emp|fin|exp)$/.test(line) && STAT_INT.test(nm)) return "16A";
      if (kind === "nc" && /PARTNER/.test(nm) && /^(emp|fin|exp)$/.test(line)) return /INTEREST/.test(nm) ? "16P" : "15P";
      if (/^(fin|exp)$/.test(line) && /BANK CHARGE|BANK COMMISSION/.test(nm)) return "17G";
      // a director's remuneration is an employee benefit (Schedule III), not an other expense (ROUND 100: the reports pack reads it)
      if (kind === "co" && /^(emp|exp)$/.test(line) && /DIRECTORS?'?\s*(REMUNERATION|SALARY)|REMUNERATION TO DIRECTORS?|MANAGERIAL REMUNERATION/.test(nm)) return "15A";
    } else {
      if (/INTEREST (ACCRUED|RECEIVABLE)|ACCRUED INTEREST/.test(nm) && !cr) return "12E";
      if (/PROVISION FOR (INCOME )?TAX|INCOME TAX PAYABLE|PROVISION FOR CURRENT TAX/.test(nm) && line !== "dta" && line !== "dtl") return "7D";
    }
    switch (line){
      case "share": return /PREF/.test(nm) ? "3B" : "3A";
      case "capital": return kind === "co" ? (/PREF/.test(nm) ? "3B" : "3A") : /DRAWING/.test(nm) ? "3R" : /CURRENT/.test(nm) ? "3Q" : "3P";
      case "reserves": return /PROFIT\s*&\s*LOSS|PROFIT AND LOSS|P\s*&\s*L\b|SURPLUS/.test(nm) ? "4A" : /PREMIUM/.test(nm) ? "4B" : /GENERAL RESERVE/.test(nm) ? "4C" : "4D";
      case "ltb": return /BANK|TERM LOAN|VEHICLE LOAN|CAR LOAN|\bSECURED/.test(up) ? "30A" : "30B";   // "\b": an "Unsecured Loans" group is not secured
      case "dtl": return "31A";
      case "oltl": return "32A";
      case "ltp": return /GRATUITY/.test(nm) ? "5A" : /LEAVE/.test(nm) ? "5B" : "5D";
      case "stp": return /GRATUITY/.test(nm) ? "5E" : /LEAVE/.test(nm) ? "5B" : /\bTAX/.test(nm) ? "7D" : /EXPENSE|PAYABLE|OUTSTANDING/.test(nm) ? "5F" : "5G";
      case "stb": return /CREDIT CARD/.test(up) ? "33C" : (/OVERDRAFT|\bOD\b|\bCC\b|CASH CREDIT|BANK/.test(up) || has("bank od a/c") || has("bank occ a/c")) ? "33A" : "33B";
      case "tp": return /micro|small/i.test((MIS.msme() || {})[l] || "") ? "6A" : "6B";
      case "ocl":
        if (has("sundry debtors") || /ADVANCE (FROM|RECEIVED)|CUSTOMER ADVANCE/.test(nm)) return "7E";
        if (has("duties & taxes") || /\bTDS\b|\bTCS\b|\bGST\b|IGST|CGST|SGST|\bPF\b|\bEPF\b|\bESIC?\b|PROFESSIONAL TAX|DUTIES|LABOUR WELFARE|WITHHOLDING/.test(nm)) return "7C";
        if (/SALARY|SALARIES|WAGES|BONUS|EMPLOYEE|STAFF|REIMBURSE/.test(nm)) return "7B";
        if (/CAPITAL CREDITOR|CREDITORS? FOR CAPITAL/.test(nm)) return "7F";
        if (/INTEREST ACCRUED|INTEREST PAYABLE/.test(nm)) return "7G";
        if (/ADVANCE INCOME|RECEIVED IN ADVANCE|UNEARNED|DEFERRED REVENUE/.test(nm)) return "7H";
        return "7A";
      case "ppe": { const c = PPE.find(z => z[0] === ppeCls(nm)); return c[3] && (/ACC(UMULATED)?\.?\s*DEP|DEPRECIATION|PROVISION FOR DEP/.test(nm) || cr) ? c[3] : c[2]; }
      case "intang": return /UNDER DEVELOPMENT/.test(nm) ? "35B" : (/AMORTI|ACC(UMULATED)?\.?\s*(DEP|AMORT)/.test(nm) || cr) ? "34B" : "34A";
      case "cwip": return /INTANGIBLE.*DEVELOPMENT|UNDER DEVELOPMENT/.test(nm) ? "35B" : "35A";
      case "nci": return "36A";
      case "ci": return "37A";
      case "dta": return "9A";
      case "inv": return "39A";
      case "ltla": return /CAPITAL ADVANCE/.test(nm) ? "38B" : /SECURITY|DEPOSIT/.test(nm) ? "38A" : "38D";
      case "onca": return "38C";
      case "tr": return /PROVISION|DOUBTFUL/.test(nm) ? "10B" : "10A";
      case "cash": return has("cash-in-hand") || /^CASH\b|PETTY CASH|CASH IN HAND/.test(nm) ? "11D" : /LIEN|MARGIN MONEY/.test(up) ? "11C" : /FIXED DEPOSIT|\bFD\b|\bFDR\b|TERM DEPOSIT/.test(up) ? "11B" : "11A";
      case "stla":
        if (/\bTDS\b|\bTCS\b|ADVANCE TAX|INCOME TAX|SELF ASSESSMENT|REFUND/.test(nm)) return "12B";
        if (has("duties & taxes") || /\bGST\b|IGST|CGST|SGST|INPUT|ELECTRONIC CREDIT|CENVAT|\bVAT\b/.test(nm)) return "12D";
        if (/PREPAID/.test(nm)) return "12C";
        if (/SECURITY|DEPOSIT/.test(nm)) return "12A";
        if (has("sundry creditors") || /ADVANCE TO (SUPPLIER|VENDOR)|SUPPLIER ADVANCE/.test(nm)) return "12F";
        if (/STAFF|EMPLOYEE|SALARY ADVANCE|IMPREST|LOAN TO EMP/.test(nm)) return "12G";
        return "12H";
      case "oca": return /INTEREST ACCRUED|ACCRUED INTEREST/.test(nm) ? "12E" : "12K";
      case "rev": return /SALE OF (GOODS|PRODUCTS?)|\bGOODS\b|PRODUCT|TRADING/.test(nm) ? "13B" : /SCRAP|EXPORT INCENTIVE|DUTY DRAWBACK|OTHER OPERATING/.test(nm) ? "13C" : "13A";
      case "oth": return /INTEREST/.test(nm) && /REFUND|INCOME TAX/.test(nm) ? "14D" : /INTEREST/.test(nm) ? "14A" : /PROFIT ON (SALE|DISPOSAL)|GAIN ON (SALE|DISPOSAL)/.test(nm) ? "14B" : /EXCHANGE|FOREX|FOREIGN/.test(nm) ? "14C" : "14E";
      case "mat": return "40A";
      case "pur": return FS.cfg(S.books).mfg ? "40A" : "41A";
      case "chg": return "42A";
      case "emp": return /\bPF\b|PROVIDENT|\bESIC?\b|EMPLOYER|CONTRIBUTION|LABOUR WELFARE|\bNPS\b|SUPERANNUATION/.test(nm) ? "15B" : /ESOP|STOCK OPTION|SHARE BASED|STOCK COMPENSATION|STOCK BASED/.test(nm) ? "15D" :
        /GRATUITY/.test(nm) ? "15E" : /WELFARE|STAFF|FOOD|REFRESH|CANTEEN|MEDICAL/.test(nm) ? "15C" : "15A";
      case "fin": return /PROCESSING|LOAN CHARGE|OTHER BORROWING/.test(nm) ? "16C" : "16B";
      case "dep": return /AMORTI/.test(nm) ? "34D" : "8E";
      case "tax": return /DEFERRED/.test(nm) ? "22C" : /PRIOR|EARLIER|PREVIOUS YEAR|SHORT PROVISION|EXCESS PROVISION/.test(nm) ? "22B" : "22A";
      case "exc": return "43A";
      case "exp": { const e = EXP.find(([re]) => re.test(nm)); return e ? e[1] : "17J"; }
    }
    return "";
  }
  function suggest(l, gp, bal, kind){
    kind = kind || kindOf(); gp = gp || Books.groupPath(l);
    if (/^profit\s*&\s*loss a\/c$/i.test(String(l).trim())) return "4A";
    return refine(l, FS.place(l, -N(bal), kind, gp), gp, bal, kind);
  }
  // the code of a ledger: by hand (b.fs.map: a code, an old line name read as its code, or "none"), else suggested: from
  // last year's balance sheet when one is uploaded (up: {ledger: {code, why}}, FinPyBs.suggestions), else by rule
  function codeOf(l, bal, kind, map, up){
    kind = kind || kindOf(); map = map || (S.books.fs || {}).map || {};
    const h = map[l], K = codes(kind);
    if (h === "none") return {code: "", codeSrc: "none"};
    if (h && K[h]) return {code: h, codeSrc: "hand"};
    if (h && OLD.includes(h)) return {code: refine(l, h, Books.groupPath(l), bal, kind), codeSrc: "hand"};
    if (up && up[l] && K[up[l].code]) return {code: up[l].code, codeSrc: "suggested", why: up[l].why};
    const s = suggest(l, null, bal, kind);
    return s && K[s] ? {code: s, codeSrc: "suggested"} : {code: "", codeSrc: "none"};
  }

  // ---------- the period: the whole year, or a part of it (owner, 29-Oct-2026) ----------
  // A part of the year: the P&L is the movements From -> To; the balance sheet is as on To (the year's opening + the
  // movements to To). The profit of the year before From is FinCom's line 4E in the surplus ("Add: profit for 01-Apr to
  // ..., earlier in the year"): the balance at the beginning of the year stays last year's audited closing, and the balance
  // sheet ties. From may be in the previous financial year (a period across 31 March): the period belongs to To's year, its
  // reserves start from that year's opening, and 4E takes out the profit From -> 31 March already in that opening.
  // The comparative (cmp): "same" the same dates a year earlier (when FinCom's copy holds them), or "fy" the last full
  // year (its P&L and cash flow, and the balance sheet as at the previous 31 March).
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DMY = ymd => ymd.slice(6, 8) + "-" + MON[N(ymd.slice(4, 6)) - 1] + "-" + ymd.slice(0, 4);
  const FYL = y => N(y) + "-" + String(N(y) + 1).slice(2);
  const todayYmd = () => { const t = new Date(); return t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0"); };
  const okYmd = s => /^\d{8}$/.test(String(s || ""));
  // the same day a year earlier (29 February and month ends kept as month ends)
  const lastDay = (y, m) => new Date(y, m, 0).getDate();
  const yearBack = ymd => { const y = N(ymd.slice(0, 4)) - 1, m = N(ymd.slice(4, 6)), d = N(ymd.slice(6, 8)), end = d === lastDay(y + 1, m);
    return y + ymd.slice(4, 6) + String(end ? lastDay(y, m) : Math.min(d, lastDay(y, m))).padStart(2, "0"); };
  const PRESETS = [["fy", "Full year"], ["h1", "H1 Apr–Sep"], ["q1", "Q1 Apr–Jun"], ["q2", "Q2 Jul–Sep"], ["q3", "Q3 Oct–Dec"], ["q4", "Q4 Jan–Mar"],
    ["m9", "9 months Apr–Dec"], ["ytd", "Year to date"], ["custom", "Custom"]];
  function periods(fy, o){
    const Y = String(N(fy)), Z = String(N(fy) + 1), fyTo = Z + "0331", t = (o && o.today) || todayYmd(), ytd = t < Y + "0401" || t > fyTo ? fyTo : t;
    const D = {fy: [Y + "0401", fyTo], h1: [Y + "0401", Y + "0930"], q1: [Y + "0401", Y + "0630"], q2: [Y + "0701", Y + "0930"], q3: [Y + "1001", Y + "1231"], q4: [Z + "0101", fyTo],
      m9: [Y + "0401", Y + "1231"], ytd: [Y + "0401", ytd], custom: [null, null]};
    return PRESETS.map(([key, label]) => ({key, label, from: D[key][0], to: D[key][1]}));
  }
  // {preset, from, to, cmp} (or nothing: the full year) -> the period worked out for the year fy
  function periodOf(fy, p, o){
    fy = String(fy); if (p && p.fy === fy && p.resolved) return p;
    const fyFrom = fy + "0401", fyTo = String(N(fy) + 1) + "0331", prevFrom = String(N(fy) - 1) + "0401", list = periods(fy, o);
    let pre = list.find(z => z.key === ((p && p.preset) || "fy")) || list[0], from = pre.from, to = pre.to;
    if (pre.key === "custom"){
      from = okYmd(p.from) ? p.from : fyFrom; to = okYmd(p.to) ? p.to : fyTo;
      // To within the year; From from the start of the previous year at the earliest. A range that does not end in this
      // year is no range of this year: the full year
      if (to > fyTo) to = fyTo;
      if (from > to || to < fyFrom || from > fyTo){ from = fyFrom; to = fyTo; }
      if (from < prevFrom) from = prevFrom;
    }
    const full = from === fyFrom && to === fyTo, cmp = !full && p && p.cmp === "fy" ? "fy" : "same", spans = from < fyFrom;
    const pyFrom = cmp === "fy" ? prevFrom : yearBack(from), pyTo = cmp === "fy" ? Audit.dayBefore(fyFrom) : yearBack(to);
    const range = DMY(from) + " to " + DMY(to), pyRange = DMY(pyFrom) + " to " + DMY(pyTo), pyYear = full || cmp === "fy";
    if (full && pre.key !== "custom") pre = list[0];   // (Custom stays Custom, its dates shown, even when they make the whole year)
    return {resolved: true, fy, key: pre.key, label: pre.label, from, to, full, cmp, spans, fyFrom, fyTo, pyFrom, pyTo, asAt: DMY(to), pyAsAt: DMY(pyTo), range, pyRange,
      forWhat: full ? "for the year ended " + DMY(to) : "for the period " + range, pyForWhat: pyYear ? "for the year ended " + DMY(pyTo) : "for the period " + pyRange,
      // the P&L's comparative column head: [words, dates]
      pyPlHead: pyYear ? ["Year ended", DMY(pyTo)] : ["For the period", pyRange], pyPlLabel: pyYear ? "Year ended " + DMY(pyTo) : pyRange,
      cmpNote: full ? "" : cmp === "fy" ? "Comparative: the last full year (the year ended " + DMY(pyTo) + "; the balance sheet as at " + DMY(pyTo) + ")."
        : "Comparative: the same period last year (" + pyRange + "; the balance sheet as at " + DMY(pyTo) + ").",
      spansNote: spans ? "The period spans two financial years (" + FYL(N(fy) - 1) + " and " + FYL(fy) + "): the reserves start from the balance at " + DMY(fyFrom) + ", and the profit from " + DMY(from) + " to " + DMY(Audit.dayBefore(fyFrom)) + ", already in it, is shown as its own line." : ""};
  }
  // what the adjustments of a period are kept under: the year for the full year, else "<fy>:<from>-<to>"
  const periodKey = (fy, p) => { const P = periodOf(fy, p); return P.full ? String(fy) : P.fy + ":" + P.from + "-" + P.to; };
  // the period chosen on the page, kept per client (b.fs.period, synced with the books)
  const periodGet = fy => periodOf(fy, ((S.books || {}).fs || {}).period);

  // ---------- stock (owner, 29-Oct-2026: "what about opening stock") ----------
  // Stock as on a date, and where it comes from, never a figure made up: Tally's Stock-in-hand ledgers when the copy keeps
  // them (the stock items' own values are not read into FinCom's copy), else, for the opening of the year, last year's
  // balance sheet as uploaded (its Inventories), else typed by hand (b.fs.stockAt {ymd: {v, by, at}}), else the year's
  // figures typed in the old statements (b.fs.stock {open, close}). Opening stock at the start of the year is the stock as on
  // the day before it; at the start of the period, as on the day before From; closing stock, as on To.
  const isStockLed = l => FS.nature(l).path.some(g => /^stock-in-hand$/i.test(g));
  function stockOn(ymd, x){
    const f = x.f, st = x.st || {}, t = (f.stockAt || {})[ymd];
    if (x.integrated){ const at = x.balAt(ymd); return {v: R2(Object.keys(at).filter(isStockLed).reduce((s, l) => s - N(at[l]), 0)), src: "tally", label: "Tally: the Stock-in-hand ledgers"}; }
    if (ymd === x.fyOpen && x.upInv != null) return {v: x.upInv, src: "upload", label: "last year's balance sheet: Inventories (" + (x.upl.file || "uploaded") + ", version " + x.upl.v + ")"};
    if (t && t.v != null && t.v !== "") return {v: R2(N(t.v)), src: "typed", label: "typed by " + (t.by || "someone") + (t.at ? " on " + DMY(String(t.at).slice(0, 10).replace(/-/g, "")) : ""), by: t.by, at: t.at};
    if (ymd === x.fyOpen && N(st.open)) return {v: R2(N(st.open)), src: "typed", label: "typed in FinCom's statements (the year's opening stock)"};
    if (ymd === x.fyClose && N(st.close)) return {v: R2(N(st.close)), src: "typed", label: "typed in FinCom's statements (the year's closing stock)"};
    return {v: null, src: "none", label: "not known: type it, or upload last year's balance sheet"};
  }
  const upInvOf = upl => { if (!upl) return null; const ls = (upl.lines || []).filter(z => z.use && z.code === "39A"); return ls.length ? R2(ls.reduce((s, z) => s + N(z.amt), 0) * (N(upl.unit) || 1)) : null; };

  // ---------- the trial balance ----------
  const fyDates = fy => ({from: fy + "0401", to: String(N(fy) + 1) + "0331"});
  const BF = "Profit and loss: balance brought forward in the income and expense ledgers";
  const pyUpload = fy => (typeof FinPyBs === "object" && FinPyBs.latest) ? FinPyBs.latest(fy) : null;
  function tb(fy, per){
    const b = S.books || {}, c = FS.cfg(b), kind = c.kind === "co" ? "co" : "nc", f = b.fs || {}, P = periodOf(fy, per), {from, to} = P, fyFrom = P.fyFrom;
    const bal = Audit.balances(from < fyFrom ? from : fyFrom, to);
    if (!bal.ok) return {error: bal.why, fy, from, to};
    const close = bal.at(to), open = bal.at(Audit.dayBefore(fyFrom)), isRev = l => FS.nature(l).rev;
    // the balances the day before the period begins (the year's opening for the full year)
    const pOpen = P.full ? open : bal.at(Audit.dayBefore(from));
    // last year's entries made to match its audited balance sheet (FinRecon: adjustments with carry, dated its 31 March)
    // are in this year's opening balances, until they are passed in Tally (b.fs.recon[fy - 1].inTally)
    const prevY = String(N(fy) - 1), inTally = y => !!(((f.recon || {})[y]) || {}).inTally;
    const carried = inTally(prevY) ? [] : (((f.adj || {})[prevY]) || []).filter(a => a.carry && N(a.amt) && a.dr && a.cr);
    const carry = m => carried.forEach(a => { m[a.dr] = R2(N(m[a.dr]) - N(a.amt)); m[a.cr] = R2(N(m[a.cr]) + N(a.amt)); });
    carry(close); carry(open); if (pOpen !== open && !P.spans) carry(pOpen);
    const rows = {}, R = l => rows[l] = rows[l] || {ledger: l, group: Books.groupPath(l)[0] || "", py: 0, cy: 0, adj: 0};
    const all = Array.from(new Set(Object.keys(close).concat(Object.keys(open), Object.keys(pOpen))));
    let bfCy = 0, bfPy = 0, slCy = 0, slPy = 0;
    const openBs = {};   // each balance sheet ledger at the start of the year (a debit positive): last year's closing in FinCom
    all.forEach(l => { const rv = isRev(l); R(l).cy = R2(rv ? -(N(close[l]) - N(pOpen[l])) : -N(close[l]));
      if (rv){ bfCy += -N(open[l]); slCy += -(N(pOpen[l]) - N(open[l])); } else openBs[l] = R2(-N(open[l])); });
    // last year: typed (b.fs.pyTb), else the previous year in FinCom's copy, else last year's balance sheet when one is
    // uploaded (b.fs.pyBs), else the opening balances only. A part of the year compared with the same period: those dates
    // a year earlier from the copy, or none; compared with the last full year: as the full year
    const pyFrom = String(N(fy) - 1) + "0401", typed = (f.pyTb || {})[fy], upl = pyUpload(fy), same = !P.full && P.cmp !== "fy";
    const copyFrom = same && P.pyFrom < pyFrom ? P.pyFrom : pyFrom, hasCopy = (b.tb && b.tb.from <= copyFrom) || MIS.covered(copyFrom);
    let pySrc = "opening", pyBal = null;
    if (same){
      const pb = hasCopy ? Audit.balances(copyFrom, P.pyTo) : null;
      if (pb && pb.ok){
        pySrc = "copy"; pyBal = pb; const pc = pb.at(P.pyTo), po = pb.at(Audit.dayBefore(pyFrom)), pp = pb.at(Audit.dayBefore(P.pyFrom));
        Array.from(new Set(Object.keys(pc).concat(Object.keys(po), Object.keys(pp)))).forEach(l => { const rv = isRev(l); R(l).py = R2(rv ? -(N(pc[l]) - N(pp[l])) : -N(pc[l]));
          if (rv){ bfPy += -N(po[l]); slPy += -(N(pp[l]) - N(po[l])); } });
        (((f.adj || {})[periodKey(String(N(fy) - 1), {preset: "custom", from: P.pyFrom, to: P.pyTo})]) || []).forEach(a => { if (!N(a.amt)) return; R(a.dr).py = R2(R(a.dr).py + N(a.amt)); R(a.cr).py = R2(R(a.cr).py - N(a.amt)); });
      } else pySrc = "none";
    } else if (typed && Object.keys(typed).length){ pySrc = "typed"; Object.entries(typed).forEach(([l, v]) => { R(l).py = R2(N(v)); }); }
    else {
      const pb = hasCopy ? Audit.balances(pyFrom, Audit.dayBefore(fyFrom)) : null;
      if (pb && pb.ok){
        pySrc = "copy"; pyBal = pb; const pOpen = pb.at(Audit.dayBefore(pyFrom));
        Array.from(new Set(all.concat(Object.keys(pOpen)))).forEach(l => { const rv = isRev(l); R(l).py = R2(rv ? -(N(open[l]) - N(pOpen[l])) : -N(open[l])); if (rv) bfPy += -N(pOpen[l]); });
        (((f.adj || {})[String(N(fy) - 1)]) || []).forEach(a => { if (!N(a.amt) || (a.carry && !inTally(prevY))) return; R(a.dr).py = R2(R(a.dr).py + N(a.amt)); R(a.cr).py = R2(R(a.cr).py - N(a.amt)); });
      } else if (upl && upl.usePy !== false) pySrc = "upload";
      else all.forEach(l => { if (isRev(l)) bfPy += -N(open[l]); else R(l).py = R2(-N(open[l])); });
    }
    // a third column, the balances at the start of the period (a part of the year: the cash flow and the PPE schedule
    // start there; last year's balance sheet as the PY: the PPE schedule starts from FinCom's own gross block and depreciation)
    const hasOp = !P.full || pySrc === "upload";
    if (hasOp) Object.values(rows).forEach(r => { r.op = isRev(r.ledger) ? 0 : R2(-N(pOpen[r.ledger])); });
    const out = [], K = codes(kind);
    const syn = (ledger, code, cy, py, op) => { if (!(Math.abs(cy) >= 0.005 || Math.abs(py) >= 0.005 || (hasOp && Math.abs(N(op == null ? cy : op)) >= 0.005))) return null;
      const r = Object.assign({ledger, group: "", py: R2(py), cy: R2(cy), adj: 0, final: R2(cy), code, codeSrc: "suggested", side: CODES[code].side, synthetic: true}, hasOp ? {op: R2(op == null ? cy : op)} : {});
      out.push(r); return r; };
    // stock, when Tally does not keep it: the closing stock (39A), the change (42A: opening at the start of the period less
    // closing), the opening stock of the year in the surplus (4A), and the change before the period in the profit earlier in
    // the year (4E). A figure not known is nil, and the Checks tab says which is missing
    const integrated = all.some(l => isStockLed(l) && Math.abs(N(close[l])) >= 1) || all.some(l => isStockLed(l) && Math.abs(N(open[l])) >= 1), warn = [];
    const A = Audit.dayBefore(fyFrom), Bd = P.full ? A : Audit.dayBefore(from), Cd = to;
    const sx = {f, st: c.stock || {}, integrated, balAt: d => bal.at(d), fyOpen: A, fyClose: P.fyTo, upl, upInv: upInvOf(upl)};
    const sA = stockOn(A, sx), sB = Bd === A ? sA : stockOn(Bd, sx), sC = stockOn(Cd, sx);
    const stock = {integrated, dates: {A, B: Bd, C: Cd}, A: sA, B: sB, C: sC, missing: [], upInv: sx.upInv};
    if (!integrated && [sA, sB, sC].some(z => z.v != null)){
      [["Opening stock at the start of the year", A, sA]].concat(Bd !== A ? [["Opening stock at the start of the period", Bd, sB]] : [], [["Closing stock", Cd, sC]])
        .forEach(([w, dt, z]) => { if (z.v == null) stock.missing.push(w + " (as on " + DMY(dt) + ")"); });
      const vA = N(sA.v), vB = N(sB.v), vC = N(sC.v);
      // last year's column: the year (or the last full year): its closing stock is this year's opening (and its own
      // opening, when known, gives its change); the same period last year: only when all three of its figures are known
      let pyS = [0, 0, 0, 0];
      if (pySrc !== "upload" && pySrc !== "none"){
        if (!same){ const pA = stockOn(Audit.dayBefore(pyFrom), Object.assign({}, sx, {fyOpen: "", fyClose: "", integrated: false})); pyS = [vA, pA.v != null ? pA.v - vA : 0, -(pA.v != null ? pA.v : vA), 0]; }
        else { const q = [Audit.dayBefore(pyFrom), Audit.dayBefore(P.pyFrom), P.pyTo].map(d => stockOn(d, Object.assign({}, sx, {fyOpen: "", fyClose: "", integrated: false})));
          if (q.every(z => z.v != null)) pyS = [q[2].v, q[1].v - q[2].v, -q[0].v, -(q[1].v - q[0].v)]; }
      }
      const tag = (r, s) => { if (r) r.stk = s; };
      tag(syn("Closing stock as on " + DMY(Cd), "39A", vC, pyS[0], vB), {cy: "C", op: "B"});
      tag(syn("Changes in inventories (opening less closing stock)", "42A", vB - vC, pyS[1], 0), {cy: "B-C", op: "0"});
      tag(syn("Opening stock in the surplus (as on " + DMY(A) + ")", "4A", -vA, pyS[2], -vA), {cy: "-A", op: "-A"});
      if (Bd !== A) tag(syn("Stock change before the period (in the profit earlier in the year)", "4E", vA - vB, pyS[3], vA - vB), {cy: "A-B", op: "A-B"});
    }
    // the adjustments (audit entries kept in FinCom, never posted to Tally), for this period
    // (entries made to match the audited balance sheet, once passed in Tally, are Tally's: not added again)
    const adj = ((f.adj || {})[periodKey(fy, P)] || []).filter(a => !(a.carry && inTally(String(fy))));
    adj.forEach(a => { if (!N(a.amt) || !a.dr || !a.cr) return; R(a.dr).adj = R2(R(a.dr).adj + N(a.amt)); R(a.cr).adj = R2(R(a.cr).adj - N(a.amt)); });
    // the codes last year's balance sheet suggests (never over a hand choice)
    const up = upl && FinPyBs.suggestions ? FinPyBs.suggestions(upl, openBs, kind, f.map || {}) : null;
    Object.values(rows).sort((a, z) => a.ledger.localeCompare(z.ledger)).forEach(r => {
      if (!r.cy && !r.py && !r.adj && !r.op) return;
      // the balance that tells a ledger's side: the year's closing, else last year's; with no last year in the PY column
      // (an uploaded balance sheet, or a part of the year with none), its balance at the start of the year
      r.final = R2(r.cy + r.adj); const k = codeOf(r.ledger, r.final || r.py || (hasOp ? N(openBs[r.ledger]) || N(r.op) : 0), kind, f.map || {}, up);
      out.push(Object.assign(r, k.code && !K[k.code] ? {code: "", codeSrc: "none"} : k)); r.side = r.code ? CODES[r.code].side : "";
    });
    syn(BF, "4A", bfCy, bfPy);
    if (!P.full) syn(P.spans ? "Profit for " + DMY(from) + " to " + DMY(Audit.dayBefore(fyFrom)) + " (in the balance at the beginning of the year)" : "Profit for " + DMY(P.fyFrom) + " to " + DMY(Audit.dayBefore(from)) + " (earlier in the year)", "4E", slCy, slPy);
    // last year's balance sheet as the PY column: its lines by code (FinPyBs.pyRows), in rupees, a debit positive
    if (pySrc === "upload") FinPyBs.pyRows(upl, kind).forEach(([code, v]) => { if (K[code]) syn("Last year's balance sheet: " + CODES[code].label, code, 0, v, 0); });
    depCredited(b, out, adj, from, to, kind, f.map || {});
    return {fy, from, to, kind, entity: FS.entityOf().code, rows: out, pySrc, src: bal.src, adj, period: P, hasOp, openBs, bfOpen: R2(bfCy), upload: upl || null, warn, stock,
      carried: carried.length ? {n: carried.length, list: carried, note: "Opening balances adjusted to the audited balance sheet (" + carried.length + " entr" + (carried.length > 1 ? "ies" : "y") + ")"} : null};
  }
  // depreciation credited straight to an asset (Tally's usual way: Dr Depreciation / Cr Laptops, no accumulated-
  // depreciation ledger): per gross-block row, depCrBook (the day book's entries of the year that debit a depreciation
  // ledger, 8E / 34D, and credit the asset; a reversal the other way) and depCr (with the adjustments Dr 8E/34D, Cr the
  // asset). The PPE schedule adds it to the gross block and to the charge, so the net block stays the TB's (docs)
  const isDep = c => c === "8E" || c === "34D", isGross = c => !!(CODES[c] && CODES[c].ppe === "gross");
  function depCredited(b, out, adj, from, to, kind, map){
    const code = {}; out.forEach(r => { code[r.ledger] = r.code; });
    const cOf = l => code[l] !== undefined ? code[l] : (code[l] = codeOf(l, 1, kind, map).code), book = {};
    (b.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || v.opt || v.cancel) return;
      const ent = v.ent || [], dep = ent.filter(en => isDep(cOf(en.l))).reduce((s, en) => s - N(en.a), 0);   // a debit positive
      if (Math.abs(dep) < 0.005) return;
      // the asset side: credits for a charge, debits for a reversal; never more than the depreciation entered
      const ast = ent.filter(en => isGross(cOf(en.l)) && (dep > 0 ? N(en.a) > 0 : N(en.a) < 0)), tot = ast.reduce((s, en) => s + N(en.a), 0);
      if (!tot) return; const k = Math.min(1, dep / tot);
      ast.forEach(en => { book[en.l] = (book[en.l] || 0) + N(en.a) * k; });
    });
    const all = Object.assign({}, book);
    adj.forEach(a => { if (!N(a.amt) || !a.dr || !a.cr) return;
      if (isDep(cOf(a.dr)) && isGross(cOf(a.cr))) all[a.cr] = (all[a.cr] || 0) + N(a.amt);
      else if (isGross(cOf(a.dr)) && isDep(cOf(a.cr))) all[a.dr] = (all[a.dr] || 0) - N(a.amt); });
    out.forEach(r => { if (isGross(r.code)){ r.depCr = R2(N(all[r.ledger])); r.depCrBook = R2(N(book[r.ledger])); } });
  }

  // the balance sheet's line (its id, as FinSt.build's bs.sections) a code is shown in; "" for the P&L
  const BSID = {sc: ["3", ["sc", "cap"]], rs: ["4", ["res", "sur"]], ltb: ["30"], dtl: ["31"], oltl: ["32"], ltp: ["5", ["lt"]], stb: ["33"], tpm: ["6", ["msme"]], tpo: ["6", ["oth"]], ocl: ["7"], stp: ["5", ["st"]],
    ppe: ["8", ["ppe"]], intang: ["34", ["int"]], cwip: ["35", ["cwip"]], iaud: ["35", ["iaud"]], nci: ["36"], dta: ["9"], ltla: ["38", ["la"]], onca: ["38", ["onca"]], ci: ["37"], inv: ["39"], tr: ["10"], cash: ["11"],
    stla: ["12", ["la"]], oca: ["12", ["oca"]]};
  function bsLineOf(code){ const c = CODES[code]; if (!c || c.side !== "BS") return ""; const e = Object.entries(BSID).find(([, [k, gs]]) => k === c.note && (!gs || gs.includes(c.group))); return e ? e[0] : ""; }

  // ---------- inputs ----------
  function inputs(co, firm){
    const b = S.books || {}, t = (b.fs || {}).inputs || {}, kind = kindOf(), e = FS.entityOf(co).code;
    co = co || (typeof CO === "function" ? CO() : null) || {}; firm = firm || (typeof S === "object" && S.firm) || {};
    const unit = UNITS[t.unit] ? N(t.unit) : (kind === "co" ? 1000 : 1), dec = t.dec === 0 || t.dec === 2 ? t.dec : 2;
    return {name: t.name || co.name || "", cin: t.cin || co.cin || "", pan: t.pan || co.pan || "", address: t.address || co.address || co.addr || "", holding: t.holding || "",
      shares: Object.assign({number: "", face: 10, authorised: "", holders: []}, t.shares), directors: t.directors || [], partners: t.partners || [],
      auditor: Object.assign({firm: firm.firmName || firm.name || "", frn: firm.frn || "", partner: firm.partner || "", mno: firm.mno || "", place: firm.place || firm.city || ""}, t.auditor),
      place: t.place || "", date: t.date || "", udin: t.udin || "", unit, dec, kind, entity: e, regime: regime(),
      unitLine: "(All amounts in " + (UNITS[unit] || "Rupees") + ", unless otherwise stated)"};
  }
  function regime(){ const b = S.books || {}, r = (b.fs || {}).regime; if (r) return r; return kindOf() === "co" ? "115BAA" : FS.entityOf().code === "F" ? "firm" : "slab"; }

  // ---------- the statements ----------
  function build(fy, opt){
    opt = opt || {};
    const PER = periodOf(fy, opt.period), T = tb(fy, PER);
    if (T.error) return {error: T.error, fy};
    const inp = inputs(), unit = UNITS[opt.unit] ? N(opt.unit) : inp.unit, dec = opt.dec === 0 || opt.dec === 2 ? opt.dec : inp.dec, kind = T.kind, K = codes(kind);
    const b = S.books, f = b.fs || {}, e = T.entity;
    // the balances the cash flow starts from (OB): last year's column for the full year, the start of the period for a part
    // of it; the PPE schedule's opening (PB): the same, but FinCom's own gross block and depreciation when the PY column is
    // an uploaded balance sheet (it holds the net block only)
    const OB = PER.full ? "py" : "op", PB = T.hasOp ? "op" : "py", part = !PER.full, YP = part ? "period" : "year";
    const SU = {cy: {}, py: {}, op: {}};
    const DC = {};   // depreciation credited straight to the assets, by gross code, in the unit (TB column L / UNIT)
    T.rows.forEach(r => { if (!r.code) return; SU.cy[r.code] = (SU.cy[r.code] || 0) + r.final / unit; SU.py[r.code] = (SU.py[r.code] || 0) + r.py / unit; if (T.hasOp) SU.op[r.code] = (SU.op[r.code] || 0) + N(r.op) / unit;
      if (r.depCr) DC[r.code] = (DC[r.code] || 0) + r.depCr / unit; });
    const S1 = (col, code) => SU[col][code] || 0, LV = (col, code, sign) => RND(sign * S1(col, code), dec), SUM = a => RND(a.reduce((s, v) => s + N(v), 0), dec);
    const nUsed = Object.keys(SU.cy).filter(k => Math.abs(SU.cy[k]) > 1e-9 || Math.abs(SU.py[k]) > 1e-9).length;
    const tol = RND(0.5 * Math.pow(10, -dec) * Math.max(2, nUsed + 2), dec + 1);
    // the prior year (or the same part of it) worked out the same way, for last year's cash flow and PPE schedule (values,
    // as the workbooks type them)
    const prior = !opt.inner && !["opening", "none", "upload"].includes(T.pySrc) ? build(String(N(fy) - 1), {unit, dec, inner: true, period: part ? {preset: "custom", from: PER.pyFrom, to: PER.pyTo} : undefined}) : null, pri = prior && !prior.error ? prior : null;
    // the PPE and intangibles schedules
    const grid = (list, col, adjs) => {
      const rows = [];
      list.forEach(([cls, label, g, a]) => {
        if (col === "cy"){
          // the depreciation credited straight to the asset (dc) is added back to the gross block and to the
          // accumulated depreciation: the charge shows, the additions are not net of it, the net block is the TB's
          const dc = DC[g] || 0, D = LV(PB, g, 1), G = RND(S1("cy", g) + dc, dec), H = a ? LV(PB, a, -1) : 0, Kc = RND((a ? -S1("cy", a) : 0) + dc, dec), x = (adjs || {})[g] || {};
          const sale = RND(N(x.sale) / unit, dec), J = -RND(N(x.dep) / unit, dec);
          if (!D && !G && !H && !Kc) return;
          const E = RND(Math.max(0, G - D) + sale, dec), F = RND(-(Math.max(0, D - G) + sale), dec), I = RND(Kc - H - J, dec);
          rows.push({cls, label, g, a, D, E, F, G, H, I, J, K: Kc, L: RND(D - H, dec), M: RND(G - Kc, dec), dc: dc ? RND(dc, dec) : 0});
        } else {
          const G = LV("py", g, 1), Kc = a ? LV("py", a, -1) : 0; if (!G && !Kc) return;
          rows.push({cls, label, g, a, D: null, E: null, F: null, G, H: null, I: null, J: null, K: Kc, L: null, M: RND(G - Kc, dec)});
        }
      });
      const total = {}; "DEFGHIJKLM".split("").forEach(k => { total[k] = rows.some(r => r[k] != null) ? SUM(rows.map(r => r[k])) : null; });
      return {rows, total};
    };
    const ppeAdj = (f.ppeAdj || {})[periodKey(fy, PER)] || {};
    const ppe = {cy: grid(PPE, "cy", ppeAdj), py: pri ? pri.ppe.cy : Object.assign(grid(PPE, "py"), {partial: true})};
    const intg = {cy: grid(INT, "cy", ppeAdj), py: pri ? pri.intang.cy : Object.assign(grid(INT, "py"), {partial: true})};
    // the notes, their lines rounded each, groups and totals summed
    const notes = {};
    NOTES.forEach(n => {
      if (n.only && n.only !== kind) return;
      const o = {key: n.key, title: n.title, st: n.st, groups: {}, lines: [], total: {cy: 0, py: 0}, nonote: !!n.nonote};
      if (n.key === "3" && kind === "nc") o.title = e === "F" ? "Partners' capital accounts" : e === "P" ? "Proprietor's capital account" : "Owners' capital accounts";
      n.groups.forEach(([g, head, sec, cs]) => {
        const lab = (code, label) => kind === "nc" && code === "4A" ? "Balance in profit and loss account"
          : code === "4E" ? (PER.spans ? "Profit for " + DMY(PER.from) + " to " + DMY(Audit.dayBefore(PER.fyFrom)) + ", already in the balance at the beginning of the year"
            : "Add: profit for " + DMY(PER.fyFrom) + " to " + DMY(part ? Audit.dayBefore(PER.from) : PER.fyFrom) + " (earlier in the year)") : label;
        const ls = cs.filter(([code]) => K[code]).map(([code, label]) => Object.assign({label: lab(code, label), code, group: g, cy: LV("cy", code, n.sign), py: LV("py", code, n.sign)}, part ? {op: LV("op", code, n.sign)} : {}));
        o.groups[g] = Object.assign({head, sec, cy: SUM(ls.map(z => z.cy)), py: SUM(ls.map(z => z.py)), lines: ls}, part ? {op: SUM(ls.map(z => z.op))} : {});
      });
      notes[n.key] = o;
    });
    notes["8"].groups.ppe = Object.assign({head: "", sec: "NCA", cy: N(ppe.cy.total.M), py: N(ppe.py.total.M), lines: []}, part ? {op: N(ppe.cy.total.L)} : {});
    notes["34"].groups.int = Object.assign({head: "", sec: "NCA", cy: N(intg.cy.total.M), py: N(intg.py.total.M), lines: []}, part ? {op: N(intg.cy.total.L)} : {});
    const G = (k, g, col) => N(((notes[k] || {}).groups[g] || {})[col]), NT = (k, col) => Object.values((notes[k] || {groups: {}}).groups).reduce((s, z) => s + N(z[col]), 0);
    const line = (k, code, col) => { const z = (((notes[k] || {}).groups) || {}); for (const g in z){ const x = z[g].lines.find(y => y.code === code); if (x) return x[col]; } return 0; };
    // profit and loss before the rounding put in Note 17
    const pl = col => {
      const rev = G("13", "rev", col), oth = G("14", "oth", col), inc = RND(rev + oth, dec);
      // the schedule's charge; for last year without the year before (a schedule of closing figures only), the TB's 8E / 34D
      const gp = col === "cy" ? ppe.cy : ppe.py, gi = col === "cy" ? intg.cy : intg.py;
      const dep = RND((gp.partial ? LV(col, "8E", 1) : N(gp.total.I)) + (gi.partial ? LV(col, "34D", 1) : N(gi.total.I)), dec);
      const exp = ["mat", "pur", "chg", "emp", "fin"].map((g, i) => G(["40", "41", "42", "15", "16"][i], g, col)), oexp = G("17", "exp", col);
      const tot = RND(exp.reduce((s, v) => s + v, 0) + dep + oexp, dec), pbe = RND(inc - tot, dec), exc = G("43", "exc", col), pbt = RND(pbe - exc, dec);
      const t = [line("22", "22A", col), line("22", "22B", col), line("22", "22C", col)], tax = RND(t[0] + t[1] + t[2], dec);
      return {rev, oth, inc, mat: exp[0], pur: exp[1], chg: exp[2], emp: exp[3], fin: exp[4], dep, exp: oexp, tot, pbe, exc, pbt, cur: t[0], prior: t[1], def: t[2], tax, pat: RND(pbt - tax, dec)};
    };
    // the balance sheet's own figure for the profit (assets less everything but this year's profit), and the rounding left
    const bsLines = () => {
      const eqc = col => kind === "co" ? NT("3", col) + NT("4", col) : NT("3", col) + NT("4", col);
      const sec = (col, s2) => Object.values(notes).reduce((a, n) => a + Object.values(n.groups).filter(z => z.sec === s2).reduce((x, z) => x + N(z[col]), 0), 0);
      return col => ({eq: eqc(col), ncl: sec(col, "NCL"), cl: sec(col, "CL"), nca: sec(col, "NCA"), ca: sec(col, "CA")});
    };
    const plug = {cy: 0, py: 0}, P = {};
    ["cy", "py"].forEach(col => {
      const p0 = pl(col), s2 = bsLines()(col), bsProfit = (s2.nca + s2.ca) - (s2.eq + s2.ncl + s2.cl);
      const res = RND(p0.pat - bsProfit, dec);
      if (Math.abs(res) <= tol && res !== 0){
        plug[col] = res; const o17 = notes["17"], ln = o17.groups.exp.lines.find(z => z.code === "17J");
        ln[col] = RND(ln[col] + res, dec); ln.plug = Object.assign(ln.plug || {}, {[col]: res});
        o17.groups.exp[col] = SUM(o17.groups.exp.lines.map(z => z[col]));
      }
      P[col] = pl(col);
    });
    // this year's profit: in the surplus (a company) or the capital accounts (a firm), then the totals
    ["cy", "py"].forEach(col => {
      const pat = P[col].pat;
      if (kind === "co"){ const g = notes["4"].groups.sur; g.profit = g.profit || {}; g.profit[col] = pat; g[col] = RND(g[col] + pat, dec); }
      else { const g = notes["3"].groups.cap; g.profit = g.profit || {}; g.profit[col] = pat; g[col] = RND(g[col] + pat, dec); }
    });
    Object.values(notes).forEach(n => { n.total = Object.assign({cy: SUM(Object.values(n.groups).map(z => z.cy)), py: SUM(Object.values(n.groups).map(z => z.py))}, part ? {op: SUM(Object.values(n.groups).map(z => z.op))} : {}); });
    // the lines each note shows: a head per group, its lines with a figure, the profit, subtotals when there are groups
    const PRES = {"3": kind === "co" ? null : ["cap", "Add: profit for the " + YP], "4": kind === "co" ? ["sur", "Add: profit for the " + YP] : null};
    Object.values(notes).forEach(n => {
      const gs = Object.entries(n.groups), many = gs.filter(([, z]) => z.lines.some(y => y.cy || y.py)).length > 1;
      gs.forEach(([g, z]) => {
        const ls = z.lines.filter(y => y.cy || y.py || (y.plug && (y.plug.cy || y.plug.py)));
        const pr = PRES[n.key] && PRES[n.key][0] === g ? {label: PRES[n.key][1], code: "", group: g, cy: z.profit.cy, py: z.profit.py, profit: true, ...(part ? {op: 0} : {})} : null;
        if (!ls.length && !pr) return;
        if (z.head) n.lines.push({label: z.head, head: true, group: g});
        n.lines.push(...ls); if (pr) n.lines.push(pr);
        if (many || pr) n.lines.push({label: pr && n.key === "4" ? "Balance at the end of the " + YP : "Total " + (z.head ? z.head.replace(/^\([a-z]\)\s*/, "").toLowerCase() : n.title.toLowerCase()), total: true, group: g, cy: z.cy, py: z.py, ...(part ? {op: z.op} : {})});
      });
    });
    // the balance sheet
    const eqLabel = kind === "co" ? "Shareholders' funds" : e === "F" ? "Partners' funds" : e === "P" ? "Proprietor's funds" : "Owners' funds";
    const BSL = [["EQ", eqLabel, [["sc", kind === "co" ? "Share capital" : notes["3"].title, "3", ["sc", "cap"]], ["rs", "Reserves and surplus", "4", ["res", "sur"]]]],
      ["NCL", "Non-current liabilities", [["ltb", "Long-term borrowings", "30"], ["dtl", "Deferred tax liabilities (net)", "31"], ["oltl", "Other long-term liabilities", "32"], ["ltp", "Long-term provisions", "5", ["lt"]]]],
      ["CL", "Current liabilities", [["stb", "Short-term borrowings", "33"], ["tpm", "Trade payables: outstanding dues of micro and small enterprises", "6", ["msme"]], ["tpo", "Trade payables: outstanding dues of creditors other than micro and small enterprises", "6", ["oth"]],
        ["ocl", "Other current liabilities", "7"], ["stp", "Short-term provisions", "5", ["st"]]]],
      ["NCA", "Non-current assets", [["ppe", "Property, plant and equipment", "8"], ["intang", "Intangible assets", "34"], ["cwip", "Capital work-in-progress", "35", ["cwip"]], ["iaud", "Intangible assets under development", "35", ["iaud"]],
        ["nci", "Non-current investments", "36"], ["dta", "Deferred tax assets (net)", "9"], ["ltla", "Long-term loans and advances", "38", ["la"]], ["onca", "Other non-current assets", "38", ["onca"]]]],
      ["CA", "Current assets", [["ci", "Current investments", "37"], ["inv", "Inventories", "39"], ["tr", "Trade receivables", "10"], ["cash", "Cash and bank balances", "11"], ["stla", "Short-term loans and advances", "12", ["la"]], ["oca", "Other current assets", "12", ["oca"]]]]];
    const sections = {};
    BSL.forEach(([s2, label, ls]) => {
      const lines = ls.map(([id, l, k, gs]) => { const n = notes[k]; const v = col => n ? RND((gs || Object.keys(n.groups)).reduce((a, g) => a + N((n.groups[g] || {})[col]), 0), dec) : 0; return {id, label: l, note: k, cy: v("cy"), py: v("py")}; });
      sections[s2] = {label, lines, total: {cy: SUM(lines.map(z => z.cy)), py: SUM(lines.map(z => z.py))}};
    });
    const tot = col => ({eqL: RND(sections.EQ.total[col] + sections.NCL.total[col] + sections.CL.total[col], dec), assets: RND(sections.NCA.total[col] + sections.CA.total[col], dec)});
    const bsT = {cy: tot("cy"), py: tot("py")};
    const bs = {sections, total: {eqL: {cy: bsT.cy.eqL, py: bsT.py.eqL}, assets: {cy: bsT.cy.assets, py: bsT.py.assets}}};
    // note numbers: 1 and 2 are the corporate information and the accounting policies; then each note with a figure, in
    // the order the balance sheet and the profit and loss refer to them
    const order = [], used = k => { const n = notes[k]; if (!n || n.nonote || order.includes(k)) return; if (n.lines.some(z => z.cy || z.py) || (k === "8" && ppe.cy.rows.length + ppe.py.rows.length) || (k === "34" && intg.cy.rows.length + intg.py.rows.length)) order.push(k); };
    BSL.forEach(([, , ls]) => ls.forEach(z => used(z[2])));
    ["13", "14", "40", "41", "42", "15", "16", "8", "34", "17", "43"].forEach(used);
    const noOf = {}; order.forEach((k, i) => { noOf[k] = i + 3; });
    BSL.forEach(([s2]) => sections[s2].lines.forEach(z => { z.no = noOf[z.note] || null; }));
    notes["8"].ppe = ppe; notes["34"].ppe = intg;
    notes["8"].lines = ppe.cy.rows.map(r => ({label: r.label, code: r.g, cy: r.M, py: (ppe.py.rows.find(z => z.cls === r.cls) || {}).M || 0}));
    notes["34"].lines = intg.cy.rows.map(r => ({label: r.label, code: r.g, cy: r.M, py: (intg.py.rows.find(z => z.cls === r.cls) || {}).M || 0}));
    const noteList = order.map(k => Object.assign(notes[k], {no: noOf[k]}));
    // the profit and loss
    const PLL = [["rev", "Revenue from operations", "13"], ["oth", "Other income", "14"], ["inc", "Total income", ""], ["mat", "Cost of materials consumed", "40"], ["pur", "Purchases of stock-in-trade", "41"],
      ["chg", "Changes in inventories of finished goods, work-in-progress and stock-in-trade", "42"], ["emp", "Employee benefits expense", "15"], ["fin", "Finance costs", "16"], ["dep", "Depreciation and amortisation expense", "8"],
      ["exp", "Other expenses", "17"], ["tot", "Total expenses", ""], ["pbe", "Profit before exceptional items and tax", ""], ["exc", "Exceptional items", "43"], ["pbt", "Profit before tax", ""],
      ["cur", "Current tax", ""], ["prior", "Tax relating to earlier years", ""], ["def", "Deferred tax charge / (credit)", ""], ["tax", "Total tax expense", ""], ["pat", "Profit for the " + YP, ""]];
    const plOut = {lines: PLL.map(([k, label, nk]) => ({key: k, label, no: noOf[nk] || null, cy: P.cy[k], py: P.py[k]}))};
    PLL.forEach(([k]) => { plOut[k] = {cy: P.cy[k], py: P.py[k]}; });
    // EPS from the trial balance in rupees, as the workbooks do: the profit / the number of shares
    const patRs = col => R2(-T.rows.filter(r => r.code && CODES[r.code] && CODES[r.code].side === "PL").reduce((s, r) => s + (col === "cy" ? r.final : r.py), 0));
    const shares = N(inp.shares.number);
    plOut.eps = kind === "co" && shares ? {cy: RND(patRs("cy") / shares, 2), py: RND(patRs("py") / shares, 2)} : null;
    // the cash flow, indirect method (AS 3), from the notes; last year's as the year before works it out
    const cf = {lines: [], cy: cashFlow("cy"), py: pri ? pri.cf.cy : null};
    function cashFlow(col){
      const o = col === "cy" ? "py" : null; if (!o) return null;
      const d2 = (k, g) => g ? RND(G(k, g, "cy") - G(k, g, OB), dec) : RND(NT(k, "cy") - NT(k, OB), dec), Ln = (k, code, c2) => line(k, code, c2 || "cy"), dl = (k, code) => RND(line(k, code, "cy") - line(k, code, OB), dec);
      const p = P.cy, gr = ppe.cy.total, ig = intg.cy.total;
      const x = {pbt: p.pbt, dep: p.dep, finc: p.fin, psale: RND(-Ln("14", "14B") + Ln("17", "17T"), dec), intinc: RND(-(Ln("14", "14A") + Ln("14", "14D")), dec)};
      x.opBefore = SUM([x.pbt, x.dep, x.finc, x.psale, x.intinc]);
      x.wc_tp = d2("6"); x.wc_ocl = RND(d2("7") - dl("7", "7D") - dl("7", "7F"), dec); x.wc_prov = d2("5"); x.wc_oltl = d2("32");
      x.wc_la = RND(-(d2("12", "la") - dl("12", "12B")) - d2("38", "la") - d2("38", "onca"), dec); x.wc_tr = RND(-d2("10"), dec); x.wc_inv = RND(-d2("39"), dec); x.wc_oca = RND(-(d2("12", "oca") - dl("12", "12E")), dec);
      x.cashGen = SUM([x.opBefore, x.wc_tp, x.wc_ocl, x.wc_prov, x.wc_oltl, x.wc_la, x.wc_tr, x.wc_inv, x.wc_oca]);
      x.taxPaid = RND(-((p.cur + p.prior) - dl("7", "7D") + dl("12", "12B")), dec);
      x.op = RND(x.cashGen + x.taxPaid, dec);
      x.capex = RND(-(N(gr.E) + N(ig.E)) - d2("35") + dl("7", "7F"), dec);
      x.sale = RND(Ln("14", "14B") - Ln("17", "17T") - N(gr.F) - N(ig.F) + N(gr.J) + N(ig.J), dec);
      x.obb = RND(-d2("11", "obb"), dec); x.invest = RND(-(d2("36") + d2("37")), dec); x.intRec = RND(Ln("14", "14A") + Ln("14", "14D") - dl("12", "12E"), dec);
      x.inv = SUM([x.capex, x.sale, x.obb, x.invest, x.intRec]);
      x.equity = kind === "co" ? RND(d2("3") + d2("4", "res"), dec) : RND(d2("3") - p.pat + d2("4"), dec);
      x.surplus = kind === "co" ? RND(line("4", "4A", "cy") + line("4", "4E", "cy") - G("4", "sur", OB), dec) : 0;
      x.borrow = RND(d2("30") + d2("33"), dec); x.finPaid = RND(-p.fin, dec);
      x.fin = SUM([x.equity, x.surplus, x.borrow, x.finPaid]);
      x.net = SUM([x.op, x.inv, x.fin]); x.open = G("11", "cce", OB); x.close = RND(x.open + x.net, dec); x.perNote = G("11", "cce", "cy"); x.diff = RND(x.close - x.perNote, dec);
      return x;
    }
    const CFL = [["pbt", "Profit before tax"], ["dep", "Depreciation and amortisation"], ["finc", "Finance costs"], ["psale", "(Profit) / loss on sale of assets"], ["intinc", "Interest income"],
      ["opBefore", "Operating profit before working capital changes"], ["wc_tp", "Increase / (decrease) in trade payables"], ["wc_ocl", "Increase / (decrease) in other current liabilities"], ["wc_prov", "Increase / (decrease) in provisions"],
      ["wc_oltl", "Increase / (decrease) in other long-term liabilities"], ["wc_la", "(Increase) / decrease in loans, advances and other non-current assets"], ["wc_tr", "(Increase) / decrease in trade receivables"],
      ["wc_inv", "(Increase) / decrease in inventories"], ["wc_oca", "(Increase) / decrease in other current assets"], ["cashGen", "Cash generated from operations"], ["taxPaid", "Income taxes paid (net of refunds)"],
      ["op", "A. Net cash from operating activities"], ["capex", "Purchase of property, plant and equipment and intangible assets"], ["sale", "Proceeds from sale of fixed assets"], ["obb", "Investment in bank deposits"],
      ["invest", "Purchase of investments (net)"], ["intRec", "Interest received"], ["inv", "B. Net cash used in investing activities"], ["equity", kind === "co" ? "Proceeds from issue of shares" : "Capital introduced / (withdrawn), net"],
      ["surplus", "Dividends and other movements in surplus"], ["borrow", "Proceeds from / (repayment of) borrowings, net"], ["finPaid", "Finance costs paid"], ["fin", "C. Net cash from financing activities"],
      ["net", "Net increase / (decrease) in cash and cash equivalents (A + B + C)"], ["open", "Cash and cash equivalents at the beginning of the " + YP], ["close", "Cash and cash equivalents at the end of the " + YP],
      ["perNote", "Cash and cash equivalents as per Note " + (noOf["11"] || 11)], ["diff", "Difference (should be nil)"]];
    cf.lines = CFL.map(([k, label]) => ({key: k, label, cy: cf.cy ? cf.cy[k] : null, py: cf.py ? cf.py[k] : null}));
    const d = {fy, kind, entity: e, inputs: Object.assign({}, inp, {unit, dec, tol, unitLine: "(All amounts in " + (UNITS[unit] || "Rupees") + ", unless otherwise stated)"}), tb: T, notes: noteList, noteOf: noOf,
      bs, pl: plOut, cf, ppe, intang: intg, plug, prior: pri ? {fy: pri.fy} : null,
      period: Object.assign({}, PER, {pyNote: part && T.pySrc === "none" ? "The same period of last year is not in FinCom's copy of the books, so the comparative column is blank (choose Compare with: Last full year for last year's figures)." : ""}), stock: T.stock};
    if (opt.inner) return d;
    // the computation of income is for a full financial year (its additions and deductions, 43B, 40A(7), the tax
    // depreciation and the tax itself are worked out for a year); for a part of the year a line says so
    d.comp = part ? null : comp(d);
    if (part) d.compNote = "The computation of income is for a full financial year. Choose Full year to see it.";
    d.checks = checks(d, {S1, LV, tol, unit, dec, line, G, OB, part: part && PER.cmp !== "fy"});
    if (T.upload) d.pyCheck = pyCheck(T, sections, BSL, kind);
    return d;
  }
  // last year's balance sheet (uploaded) against FinCom's opening balances, by head of the balance sheet, in rupees: each
  // ledger's balance at the start of the year by its code (hand, suggested or by rule), the lines of the upload used
  function pyCheck(T, sections, BSL, kind){
    const up = T.upload, u = N(up.unit) || 1, K = codes(kind), byHead = {}, add = (id, k, v) => { (byHead[id] = byHead[id] || {up: 0, fc: 0})[k] += v; };
    const code = {}; T.rows.forEach(r => { if (!r.synthetic) code[r.ledger] = r.code; });
    Object.entries(T.openBs).forEach(([l, v]) => { const c = code[l] !== undefined ? code[l] : codeOf(l, v, kind).code, id = bsLineOf(c); if (id && K[c]) add(id, "fc", CODES[c].sign * v); });
    if (T.bfOpen) add("rs", "fc", -T.bfOpen);
    (up.lines || []).forEach(z => { if (!z.use || !K[z.code]) return; const id = bsLineOf(z.code); if (id) add(id, "up", N(z.amt) * u); });
    const label = {}; BSL.forEach(([, , ls]) => ls.forEach(([id, l]) => { label[id] = l; }));
    const rows = [];
    BSL.forEach(([s2, , ls]) => ls.forEach(([id]) => { const x = byHead[id]; if (!x || (Math.abs(x.up) < 0.005 && Math.abs(x.fc) < 0.005)) return;
      const dif = R2(x.up - x.fc); rows.push({id, sec: s2, label: label[id], up: R2(x.up), fc: R2(x.fc), diff: Math.abs(dif) <= Math.max(0.005, u / 2) ? 0 : dif}); }));
    return {rows, bad: rows.filter(z => z.diff).length, unit: u, file: up.file || "", v: up.v};
  }

  // ---------- the checks: each must read 0 ----------
  function checks(d, h){
    const {tol, dec, unit, LV} = h, z = (v, t) => { v = RND(v, dec + 2); return Math.abs(v) <= t ? 0 : RND(v, dec); }, out = [];
    const add = (key, label, v, t) => out.push({key, label, value: z(v, t == null ? tol : t)});
    add("bsCy", "Balance sheet: equity and liabilities - assets (CY)", d.bs.total.eqL.cy - d.bs.total.assets.cy, 0.5 * Math.pow(10, -dec) - 1e-9);
    add("bsPy", "Balance sheet: equity and liabilities - assets (PY)", d.bs.total.eqL.py - d.bs.total.assets.py, 0.5 * Math.pow(10, -dec) - 1e-9);
    out.push({key: "tbCy", label: "Trial balance total (CY, Rs)", value: (v => Math.abs(v) < 0.011 ? 0 : v)(R2(d.tb.rows.reduce((s, r) => s + r.final, 0)))});
    out.push({key: "tbPy", label: "Trial balance total (PY, Rs)", value: (v => Math.abs(v) < 0.011 ? 0 : v)(R2(d.tb.rows.reduce((s, r) => s + r.py, 0)))});
    add("unmapped", "Balance of ledgers without a code (CY + PY)", d.tb.rows.filter(r => !r.code).reduce((s, r) => s + Math.abs(r.final) / unit + Math.abs(r.py) / unit, 0), 0.5 * Math.pow(10, -dec) - 1e-9);
    // (a part of the year: last year's column is the same period, not the closing the year opened with)
    if (d.kind === "co" && !h.part){ const n4 = d.notes.find(n => n.key === "4"), sur = n4 ? n4.groups.sur : null;
      add("surplus", "Opening surplus (CY) - closing surplus (PY)", sur ? (sur.lines.find(y => y.code === "4A") || {cy: 0}).cy - sur.py : 0); }
    const grid = d.ppe.cy.total, ig = d.intang.cy.total, chg = N(grid.I) + N(ig.I);
    add("ppeDep", "Depreciation: schedule (Notes 8 and 34) - trial balance", chg - (LV("cy", "8E", 1) + LV("cy", "34D", 1)));
    add("ppeNet", "Net block: schedule - trial balance (CY)", N(grid.M) + N(ig.M) - RND(PPE.concat(INT).reduce((s, c2) => s + h.S1("cy", c2[2]) + (c2[3] ? h.S1("cy", c2[3]) : 0), 0), dec));
    add("cfCy", "Cash flow difference (CY)", d.cf.cy ? d.cf.cy.diff : 0);
    if (d.cf.py) add("cfPy", "Cash flow difference (PY)", d.cf.py.diff);
    add("deferredTax", "Deferred tax in P&L - movement in deferred tax (Notes 9 and 31)", d.pl.def.cy - (RND(h.G("31", "dtl", "cy") - h.G("31", "dtl", h.OB), dec) - RND(h.G("9", "dta", "cy") - h.G("9", "dta", h.OB), dec)));
    if (d.comp){ const cp = (d.comp.checks.find(c2 => c2.key === "pbt") || {}).value;
      out.push({key: "compPbt", label: "Computation: PBT - profit and loss", value: cp || 0}); }
    out.push({key: "unit", label: "Presentation unit is Rupees, thousands, lakhs or crores", value: UNITS[unit] ? 0 : 1});
    // stock: each figure the statements need known; the opening stock against last year's closing stock (its balance sheet)
    const sk = d.stock || {};
    if (sk.missing && sk.missing.length) out.push({key: "stockMissing", label: "Stock not known: " + sk.missing.join("; "), value: sk.missing.length});
    if (d.tb.upload && (sk.upInv != null || (sk.A && sk.A.v))){ const v = R2(N(sk.A && sk.A.v) - N(sk.upInv));
      out.push({key: "stockOpen", label: "Opening stock vs last year's closing stock (last year's balance sheet), Rs", value: Math.abs(v) < 0.011 ? 0 : v}); }
    return out;
  }

  // ---------- income-tax depreciation by block (opening WDV typed once, then carried forward) ----------
  function taxDep(fy, depth){
    const b = S.books || {}, f = b.fs || {}, typed = (f.taxDep || {})[fy], {from, to} = fyDates(fy), kind = kindOf(), map = f.map || {};
    const earlier = Object.keys(f.taxDep || {}).some(y => y < fy);
    let open = {}, carried = false;
    if (typed) open = typed;
    else if (earlier && (depth || 0) < 20){ open = Object.fromEntries(taxDep(String(N(fy) - 1), (depth || 0) + 1).blocks.map(z => [z.key, z.close])); carried = true; }
    const blk = {}; BLOCKS.forEach(([key, name, rate]) => { blk[key] = {key, name, rate, open: N(open[key]), addA: 0, addB: 0, sale: 0}; });
    // each ledger's code as the trial balance gives it (a sale is a credit to a gross block, never read as depreciation)
    const T = tb(fy), half = fy + "0930", cache = {}; if (!T.error) T.rows.forEach(r => { cache[r.ledger] = r.code; });
    (b.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || v.opt || v.cancel || /DEPRECIATION/i.test(v.narr || "")) return;
      const cOf = l => cache[l] !== undefined ? cache[l] : (cache[l] = codeOf(l, 1, kind, map).code);
      // the books' depreciation credited to the asset (an entry debiting 8E / 34D) is no sale
      if ((v.ent || []).some(en => isDep(cOf(en.l)))) return;
      (v.ent || []).forEach(en => {
        const c = cOf(en.l), x = CODES[c];
        if (!x || x.ppe !== "gross") return;
        const k = (f.taxBlock || {})[en.l] || x.blk; if (!blk[k]) return;
        if (N(en.a) < 0){ if (v.date <= half) blk[k].addA = R2(blk[k].addA - N(en.a)); else blk[k].addB = R2(blk[k].addB - N(en.a)); }
        else blk[k].sale = R2(blk[k].sale + N(en.a));
      });
    });
    const blocks = Object.values(blk).map(z => {
      const base = z.open + z.addA - z.sale, dep = RND(Math.max(0, base) * z.rate + Math.max(0, z.addB + Math.min(0, base)) * z.rate / 2, 0);
      return Object.assign(z, {dep, close: R2(Math.max(0, z.open + z.addA + z.addB - z.sale - dep))});
    }).filter(z => z.open || z.addA || z.addB || z.sale);
    return {fy, blocks, total: R2(blocks.reduce((s, z) => s + z.dep, 0)), typed: !!typed, carried};
  }

  // ---------- tax by regime ----------
  function taxOn(ti, rg, inp){
    const sur = (t, s) => R2(t * s), slabs = [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]];
    const base = i => {
      if (rg === "115BAA") return i * 0.22;
      if (rg === "firm") return i * 0.30;
      if (rg === "normal") return i * (inp.small400 === false ? 0.30 : 0.25);
      let t = 0, lo = 0; slabs.forEach(([hi, r]) => { if (i > lo) t += (Math.min(i, hi) - lo) * r; lo = hi; }); return i <= 1200000 ? 0 : t;   // 115BAC, rebate u/s 87A to Rs 12 lakh
    };
    const steps = rg === "115BAA" ? [[0, 0.10]] : rg === "firm" ? [[1e7, 0.12]] : rg === "normal" ? [[1e7, 0.07], [1e8, 0.12]] : [[5e6, 0.10], [1e7, 0.15], [2e7, 0.25]];
    const rateAt = i => steps.reduce((r, [t, s]) => i > t ? s : r, 0);
    const tax = R2(base(ti)); let s = sur(tax, rateAt(ti));
    // marginal relief: tax and surcharge above a threshold no more than the income above it
    if (rg !== "115BAA") steps.forEach(([t]) => { if (ti > t){ const atT = R2(base(t)) * (1 + rateAt(t)); if (tax + s > atT + (ti - t)) s = R2(Math.max(0, atT + (ti - t) - tax)); } });
    return {tax, sur: s, cess: R2((tax + s) * 0.04)};
  }

  // ---------- computation of income ----------
  function comp(d){
    const T = d.tb, fy = d.fy, b = S.books, f = b.fs || {}, edits = (f.compEdits || {})[fy] || {}, inp = d.inputs, rg = inp.regime, unit = inp.unit;
    const RS = code => R2(T.rows.filter(r => r.code === code).reduce((s, r) => s + r.final, 0)), RSp = code => R2(T.rows.filter(r => r.code === code).reduce((s, r) => s + r.py, 0));
    const isPL = r => r.code && CODES[r.code] && CODES[r.code].side === "PL";
    const byName = (re, not) => { const rs = T.rows.filter(r => isPL(r) && CODES[r.code].sign > 0 && re.test(r.ledger.toUpperCase()) && !(not && not.test(r.ledger.toUpperCase()))); return {v: R2(rs.reduce((s, r) => s + r.final, 0)), rows: rs.map(r => r.ledger)}; };
    const lines = [], V = {};
    const L = (key, label, sec, calc, more) => {
      const ed = edits[key], x = Object.assign({key, label, sec, calc: R2(calc), v: R2(calc)}, more || {});
      if (ed && ed.v != null && ed.v !== ""){ x.v = R2(N(ed.v)); x.edited = true; x.why = ed.why || ""; }
      lines.push(x); V[key] = x.v; return x.v;
    };
    const to = fyDates(fy).to, priorTo = fyDates(String(N(fy) - 1)).to;
    const msme = at => { try { const r = Audit.checks.msme43Bh(Audit, [], {to: at, from: fyDates(at.slice(0, 4) - 1).from}); return r ? R2(r.amount) : 0; } catch (e){ return 0; } };
    const pbt = R2(-T.rows.filter(r => isPL(r) && CODES[r.code].note !== "22").reduce((s, r) => s + r.final, 0));
    L("pbt", "Net profit before tax as per the statement of profit and loss", "A", pbt, {codes: "all P&L codes except 22A-22C"});
    const intT = byName(/INTEREST\b.*\b(TDS|TCS|INCOME TAX)\b|\b(TDS|TCS)\b.*\bINTEREST/), gstI = byName(/INTEREST\b.*\b(GST|IGST|CGST|SGST)\b|\b(GST|IGST|CGST|SGST)\b.*\bINTEREST/), pen = byName(/PENALT|\bFINES?\b|LATE FEE|COMPOUNDING/, /INTEREST/);
    const stat = T.rows.filter(r => r.code === "7C" && /\bPF\b|\bEPF\b|\bESIC?\b|PROFESSIONAL TAX|LABOUR WELFARE|\bGST\b|IGST|CGST|SGST/i.test(r.ledger) && r.final < 0);
    const adds = [
      L("add_dep", "Depreciation as per the books", "A+", RS("8E") + RS("34D"), {codes: ["8E", "34D"]}),
      L("add_40a7", "Provision for gratuity (section 40A(7))", "A+", Math.max(0, RS("15E")), {codes: ["15E"]}),
      L("add_43b_leave", "Leave encashment unpaid at the year end (section 43B(f))", "A+", -(RS("5B") + RS("5C")), {codes: ["5B", "5C"]}),
      L("add_43bh", "Dues to micro and small enterprises unpaid beyond the time allowed (section 43B(h))", "A+", msme(to)),
      L("add_43b_stat", "Statutory dues unpaid by the due date of the return (section 43B; taken as paid in time unless changed)", "A+", 0, {items: stat.map(r => [r.ledger, R2(-r.final)])}),
      L("add_int_tds", "Interest on late payment of TDS / income tax", "A+", intT.v, {rows: intT.rows}),
      L("add_gst_int", "Interest on GST", "A+", gstI.v, {rows: gstI.rows}),
      L("add_penalty", "Penalties, fines and late fees (Explanation 1 to section 37(1))", "A+", pen.v, {rows: pen.rows}),
      L("add_csr", "Corporate social responsibility (Explanation 2 to section 37(1))", "A+", RS("17R"), {codes: ["17R"]}),
      L("add_loss_sale", "Loss on sale of assets", "A+", RS("17T"), {codes: ["17T"]})];
    const itd = taxDep(fy), prov = col => -((col === "cy" ? RS("5A") + RS("5E") : RSp("5A") + RSp("5E")));
    const prevEd = (f.compEdits || {})[String(N(fy) - 1)] || {}, pe = k => prevEd[k] && prevEd[k].v != null && prevEd[k].v !== "" ? N(prevEd[k].v) : 0;
    const less = [
      L("less_itdep", "Depreciation as per the Income-tax Act (section 32), Annexure 1", "A-", itd.total),
      L("less_grat_paid", "Gratuity paid during the year (section 40A(7))", "A-", Math.max(0, prov("py") + RS("15E") - prov("cy")), {codes: ["5A", "5E", "15E"]}),
      L("less_43b_paid", "Disallowed in earlier years, paid this year (section 43B)", "A-", -(RSp("5B") + RSp("5C")) + msme(priorTo) + pe("add_43b_stat"), {codes: ["5B", "5C"]}),
      L("less_profit_sale", "Profit on sale of assets", "A-", -RS("14B"), {codes: ["14B"]}),
      L("less_ifos", "Income considered under income from other sources", "A-", -(RS("14A") + RS("14D")), {codes: ["14A", "14D"]})];
    const pgbp = L("pgbp", "Profits and gains of business or profession", "A=", V.pbt + adds.reduce((s, v) => s + v, 0) - less.reduce((s, v) => s + v, 0));
    const ifos = L("ifos", "Income from other sources: interest", "B", -(RS("14A") + RS("14D")), {codes: ["14A", "14D"]});
    const gti = L("gti", "Gross total income", "C", pgbp + ifos);
    const ded = L("ded", "Deductions under Chapter VI-A", "C", 0);
    const ti = L("ti", "Total income (rounded off u/s 288A)", "C", Math.max(0, RND(gti - ded, -1)));
    const t = taxOn(ti, rg, inp);
    L("tax", rg === "115BAA" ? "Income-tax @ 22% (section 115BAA)" : rg === "firm" ? "Income-tax @ 30%" : rg === "normal" ? "Income-tax @ " + (inp.small400 === false ? "30%" : "25%") : "Income-tax at the slab rates (section 115BAC)", "D", t.tax);
    L("sur", "Surcharge", "D", t.sur); L("cess", "Health and education cess @ 4%", "D", t.cess);
    const total = L("taxTotal", "Tax liability", "D", RND(V.tax + V.sur + V.cess, 0));
    const mv = re => R2(T.rows.filter(r => r.code === "12B" && re.test(r.ledger)).reduce((s, r) => s + Math.max(0, r.cy - r.py), 0));
    const tds = L("tds", "Less: TDS / TCS (receivable ledgers, this year)", "D", mv(/\bTDS\b|\bTCS\b/i)), adv = L("adv", "Less: advance tax and self-assessment tax paid", "D", mv(/ADVANCE TAX|SELF ASSESSMENT/i));
    L("payable", "Tax payable / (refundable)", "D", RND(total - tds - adv, -1));
    const plPbt = d.pl.pbt.cy * unit, tolRs = 2 * inp.tol * unit + 0.011, cpv = R2(plPbt - V.pbt);
    const checks2 = [{key: "pbt", label: "P&L profit before tax (in rupees) - the computation's", value: Math.abs(cpv) <= tolRs ? 0 : cpv},
      {key: "provision", label: "Current tax in the P&L - tax computed (0 once the provision is booked)", value: RND(RS("22A") - total, 0)}];
    return {regime: rg, ay: (N(fy) + 1) + "-" + String(N(fy) + 2).slice(2), lines, itdep: itd, checks: checks2};
  }

  // ---------- what the page changes (each kept in b.fs, synced with the books) ----------
  const save = () => { if (typeof saveBooks === "function") saveBooks(); };
  const fsOf = () => { const b = S.books; b.fs = b.fs || {}; return b.fs; };
  function mapSet(l, code){ const f = fsOf(); f.map = Object.assign({}, f.map); if (code) f.map[l] = code; else delete f.map[l]; save(); }
  // old line names (FS.LINES: "tp", "stla") rewritten as codes; returns how many
  function migrate(b){
    b = b || S.books; const f = b.fs = b.fs || {}, kind = kindOf(); let n = 0;
    f.map = Object.assign({}, f.map);
    Object.entries(f.map).forEach(([l, v]) => { if (OLD.includes(v)){ const c = refine(l, v, Books.groupPath(l), 0, kind); if (c){ f.map[l] = c; n++; } } });
    if (n) save(); return n;
  }
  // (an entry may carry more: id, date, kind, by, at, recon / carry for the entries matching the audited balance sheet)
  function adjAdd(fy, a){ const f = fsOf(); f.adj = Object.assign({}, f.adj); f.adj[fy] = (f.adj[fy] || []).concat([Object.assign({}, a, {dr: a.dr, cr: a.cr, amt: R2(N(a.amt)), narr: a.narr || ""})]); save(); }
  function adjDelId(fy, id){ const f = fsOf(); f.adj = Object.assign({}, f.adj); f.adj[fy] = (f.adj[fy] || []).filter(a => a.id !== id); save(); }
  function adjSet(fy, i, a){ const f = fsOf(); f.adj = Object.assign({}, f.adj); const l = (f.adj[fy] || []).slice(); if (!l[i]) return; l[i] = Object.assign({}, l[i], a, a.amt != null ? {amt: R2(N(a.amt))} : {}); f.adj[fy] = l; save(); }
  function adjDel(fy, i){ const f = fsOf(); f.adj = Object.assign({}, f.adj); f.adj[fy] = (f.adj[fy] || []).filter((_, j) => j !== i); save(); }
  function compEdit(fy, key, v, why){ const f = fsOf(); f.compEdits = Object.assign({}, f.compEdits); const e = Object.assign({}, f.compEdits[fy]); if (v == null || v === "") delete e[key]; else e[key] = {v: N(v), why: why || ""}; f.compEdits[fy] = e; save(); }
  function regimeSet(v){ fsOf().regime = v; save(); }
  function inputsSet(o){ const f = fsOf(); f.inputs = Object.assign({}, f.inputs, o); save(); }
  function taxDepSet(fy, block, wdv){ const f = fsOf(); f.taxDep = Object.assign({}, f.taxDep); f.taxDep[fy] = Object.assign({}, f.taxDep[fy]); if (wdv === "" || wdv == null) delete f.taxDep[fy][block]; else f.taxDep[fy][block] = R2(N(wdv)); save(); }
  // the period (and the comparative chosen, cmp "same" / "fy") kept per client; a preset drops custom dates
  function periodSet(p){
    const f = fsOf(), x = Object.assign({}, f.period, p || {});
    if (!x.preset) x.preset = "fy";
    if (x.preset !== "custom"){ delete x.from; delete x.to; }
    if (x.cmp !== "fy") delete x.cmp;
    if (x.preset === "fy" && !x.cmp) delete f.period; else f.period = x;
    save();
  }
  // stock typed by hand, as on a date (null: forgotten), with who typed it and when
  function stockSet(ymd, v){
    const f = fsOf(); f.stockAt = Object.assign({}, f.stockAt);
    if (v == null || v === "") delete f.stockAt[ymd];
    else f.stockAt[ymd] = {v: R2(N(v)), by: (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || (typeof S === "object" && S.firm && (S.firm.partner || S.firm.firmName)) || "this computer", at: new Date().toISOString()};
    save();
  }
  function pyTbSet(fy, led){ const f = fsOf(); f.pyTb = Object.assign({}, f.pyTb); if (led) f.pyTb[fy] = led; else delete f.pyTb[fy]; save(); }
  function ppeAdjSet(fy, code, o){ const f = fsOf(); f.ppeAdj = Object.assign({}, f.ppeAdj); f.ppeAdj[fy] = Object.assign({}, f.ppeAdj[fy], {[code]: o}); save(); }

  return {CODES, NOTES, PPE, INT, BLOCKS, UNITS, RND, codes, suggest, refine, codeOf, tb, build, inputs, regime, taxDep, taxOn, comp, checks,
    mapSet, migrate, adjAdd, adjSet, adjDel, adjDelId, compEdit, regimeSet, inputsSet, taxDepSet, pyTbSet, ppeAdjSet,
    periods, periodOf, periodKey, periodGet, periodSet, stockSet, bsLineOf, DMY, yearBack};
})();

if (typeof globalThis === "object") Object.assign(globalThis, {FinSt});
/* @react-lazy: end */
