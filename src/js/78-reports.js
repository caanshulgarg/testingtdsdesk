/* @react-lazy: begin 78-reports.js (the React app loads this file with its Statements screen: build.py react_parts) */
/* ================================================================== */
/* Reports, Step 3 of the FinCom Assistant: Schedule III financial     */
/* statements in the firm's format (company, firm, LLP, proprietor),  */
/* the 27 checks before output, Excel with live formulas to the TB,   */
/* Word and print (PDF), the provisional TB export, the Form 3CD      */
/* draft, the cash-basis MIS and the DCF model.                       */
/*                                                                    */
/* FSX is self-contained (no globals of the program): the app calls   */
/* it with the books it holds (FSX.fromBooks), the Assistant's server */
/* tool (server/assistant/tools/reports.ts) imports this file and     */
/* calls it with the trial balance read by SQL. Both give the same    */
/* figures. No AI in any figure: the AI may only suggest a mapping    */
/* (labelled "AI") and draft narrative text (labelled). Nothing here  */
/* writes to the books.                                               */
/*                                                                    */
/* Amounts are kept in paise (integers) and shown in whole rupees,    */
/* Indian digit grouping, negatives in brackets, nil as "-". Ledger   */
/* amounts are Dr positive inside FSX (Tally's sign is the opposite). */
/* ================================================================== */
const FSX = (() => {
  const X = {};
  // ------------------------------------------------------------ numbers
  const P = v => { const n = Number(v); return isFinite(n) ? Math.round(n * 100) : 0; };          // rupees -> paise
  const R0 = p => { const a = Math.abs(p), r = Math.floor((a + 50) / 100) * 100; return p < 0 ? -r : r; }; // Excel ROUND(x,0), half away from zero, in paise
  const rs = p => p / 100;                                                                        // paise -> rupees
  const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
  // whole rupees, Indian grouping (x,xx,xx,xxx), (1,234) for a negative, "-" for nil
  function money(p, o){
    if (p == null || p === "") return "";
    const r = Math.round(R0(p) / 100);
    if (!r) return "-";
    const s = String(Math.abs(r)), last3 = s.slice(-3), rest = s.slice(0, -3);
    const g = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last3;
    return r < 0 ? "(" + g + ")" : g;
  }
  const dec2 = v => v == null || !isFinite(v) ? "-" : (Math.round(v * 100) / 100).toFixed(2);
  const pct2 = v => v == null || !isFinite(v) ? "-" : (Math.round(v * 10000) / 100).toFixed(2) + "%";
  X.money = money; X.P = P; X.R0 = R0; X.dec2 = dec2; X.pct2 = pct2;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  X.esc = esc;
  // ------------------------------------------------------------ dates
  const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  X.fyEnd = fy => "March 31, " + (Number(fy) + 1);
  X.fyLabel = fy => Number(fy) + "-" + String(Number(fy) + 1).slice(2);
  X.dates = fy => ({cyAsAt: "As at March 31, " + (Number(fy) + 1), pyAsAt: "As at March 31, " + Number(fy), cyYear: "Year ended March 31, " + (Number(fy) + 1),
    pyYear: "Year ended March 31, " + Number(fy), openAsAt: "As at April 01, " + Number(fy), from: Number(fy) + "-04-01", to: (Number(fy) + 1) + "-03-31"});
  X.longDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "")); return m ? MON[Number(m[2]) - 1] + " " + m[3] + ", " + m[1] : String(iso || ""); };

  // ------------------------------------------------------------ the lines of the statements
  // [id, side (L liability, A asset, I income, E expense), section, face label, note title]
  const LINES = [
    ["share", "L", "EQ", "Share Capital", "Share Capital"],
    ["capital", "L", "EQ", "Partners' Capital Account", "Partners' Capital Account"],
    ["current", "L", "EQ", "Partners' Current Account", "Partners' Current Account"],
    ["reserves", "L", "EQ", "Reserves and Surplus", "Reserves and Surplus"],
    ["ltb", "L", "NCL", "Long-term Borrowings", "Long-term Borrowings"],
    ["dtl", "L", "NCL", "Deferred Tax Liabilities (Net)", "Deferred Tax Liabilities (Net)"],
    ["oltl", "L", "NCL", "Other Long-term Liabilities", "Other Long-term Liabilities"],
    ["ltp", "L", "NCL", "Long-term Provisions", "Long-term Provisions"],
    ["stb", "L", "CL", "Short-term Borrowings", "Short-term Borrowings"],
    ["tp", "L", "CL", "Trade Payables", "Trade Payables"],
    ["ocl", "L", "CL", "Other Current Liabilities", "Other Current Liabilities"],
    ["stp", "L", "CL", "Short-term Provisions", "Short-term Provisions"],
    ["ppe", "A", "NCA", "Property, Plant and Equipment", "Property, Plant and Equipment and Intangible Assets"],
    ["intang", "A", "NCA", "Intangible Assets", "Property, Plant and Equipment and Intangible Assets"],
    ["cwip", "A", "NCA", "Capital Work-in-Progress", "Property, Plant and Equipment and Intangible Assets"],
    ["nci", "A", "NCA", "Non-current Investments", "Non-current Investments"],
    ["dta", "A", "NCA", "Deferred Tax Assets (Net)", "Deferred Tax Assets (Net)"],
    ["ltla", "A", "NCA", "Long-term Loans and Advances", "Long-term Loans and Advances"],
    ["onca", "A", "NCA", "Other Non-current Assets", "Other Non-current Assets"],
    ["ci", "A", "CA", "Current Investments", "Current Investments"],
    ["inv", "A", "CA", "Inventories", "Inventories"],
    ["tr", "A", "CA", "Trade Receivables", "Trade Receivables"],
    ["cash", "A", "CA", "Cash and Bank Balances", "Cash and Bank Balances"],
    ["stla", "A", "CA", "Short-term Loans and Advances", "Short-term Loans and Advances"],
    ["oca", "A", "CA", "Other Current Assets", "Other Current Assets"],
    ["rev", "I", "PL", "Revenue from Operations", "Revenue from Operations"],
    ["oth", "I", "PL", "Other Income", "Other Income"],
    ["mat", "E", "PL", "Cost of Materials Consumed", "Cost of Materials Consumed"],
    ["pur", "E", "PL", "Purchases of Stock in Trade", "Purchases of Stock in Trade"],
    ["chg", "E", "PL", "Change in Inventories of finished goods, work-in-progress, and stock-in-trade", "Change in Inventories of finished goods, work-in-progress and stock-in-trade"],
    ["emp", "E", "PL", "Employee Benefits Expense", "Employee Benefits Expense"],
    ["fin", "E", "PL", "Finance Costs", "Finance Costs"],
    ["dep", "E", "PL", "Depreciation and Amortisation Expense", "Depreciation and Amortisation Expense"],
    ["exp", "E", "PL", "Other Expenses", "Other Expenses"],
    ["exc", "E", "PL", "Exceptional Items", "Exceptional Items"],
    ["xo", "E", "PL", "Extraordinary Items", "Extraordinary Items"],
    ["tax", "E", "PL", "Tax Expenses", "Tax Expenses"]
  ].map(([id, side, sec, face, title]) => ({id, side, sec, face, title}));
  X.LINES = LINES;
  X.line = id => LINES.find(z => z.id === id) || null;
  X.isPL = id => { const z = X.line(id); return !!z && z.sec === "PL"; };
  // the entity kinds and the layout each takes
  X.KINDS = {company: "Company", llp: "Limited Liability Partnership", firm: "Partnership Firm", proprietor: "Proprietorship"};
  X.layoutOf = kind => kind === "company" ? "co" : "nc";
  X.kindFromPan = pan => { const c = String(pan || "").toUpperCase()[3]; return c === "C" ? "company" : c === "F" ? "firm" : c === "P" ? "proprietor" : ""; };

  // the firm's fixed order of Other Expenses heads, each with the sub-head it falls under for a firm (Sample A)
  const EXP = [
    ["Processing and manufacturing charges", /PROCESS|JOB ?WORK|MANUFACTUR|LABOU?R CHARGE/, "Manufacturing & Operating Expenses"],
    ["Electricity / Power and fuel", /ELECTRIC|POWER|FUEL|DIESEL|GENERATOR/, "Manufacturing & Operating Expenses"],
    ["Repairs and maintenance", /REPAIR|MAINTEN/, "Manufacturing & Operating Expenses"],
    ["Rent", /\bRENT\b|LEASE RENT/, "Administrative & General Expenses"],
    ["Recruitment", /RECRUIT/, "Administrative & General Expenses"],
    ["Professional and consultancy", /PROFESSION|CONSULT|LEGAL|RETAINER/, "Administrative & General Expenses"],
    ["Auditor's Remuneration", /AUDIT/, "Administrative & General Expenses"],
    ["Printing and stationery", /PRINT|STATION/, "Administrative & General Expenses"],
    ["Telephone and Internet", /TELEPHONE|MOBILE|INTERNET|BROADBAND|COMMUNICATION/, "Administrative & General Expenses"],
    ["IT services", /SOFTWARE|\bIT\b|CLOUD|HOSTING|DOMAIN/, "Administrative & General Expenses"],
    ["Security and Housekeeping", /SECURITY|HOUSEKEEP|CLEANING/, "Administrative & General Expenses"],
    ["Travelling", /TRAVEL|TOUR|HOTEL|AIR ?FARE/, "Administrative & General Expenses"],
    ["Conveyance", /CONVEYANCE|LOCAL TRANSPORT|TAXI|CAB/, "Administrative & General Expenses"],
    ["Insurance", /INSURANCE/, "Administrative & General Expenses"],
    ["Rates and Taxes", /RATES|TAXES|MUNICIPAL|PROPERTY TAX|STAMP|FILING FEE|ROC FEE/, "Administrative & General Expenses"],
    ["Penalties and Fines", /PENALT|\bFINE|LATE FEE/, "Miscellaneous & Other Expenses"],
    ["Office and Administration", /OFFICE|ADMIN|POSTAGE|COURIER/, "Administrative & General Expenses"],
    ["Bank Charges", /BANK CHARGE|BANK COMMISSION/, "Administrative & General Expenses"],
    ["Gateway charges", /GATEWAY|PAYMENT CHARGE|RAZORPAY|PAYU|STRIPE/, "Selling & Distribution Expenses"],
    ["Freight outward", /FREIGHT|CARRIAGE OUT|TRANSPORT|SHIPPING|DELIVERY/, "Selling & Distribution Expenses"],
    ["Advertisement and Marketing", /ADVERT|MARKETING|PROMOTION|PUBLICITY/, "Selling & Distribution Expenses"],
    ["Commission and Brokerage", /COMMISSION|BROKERAGE/, "Selling & Distribution Expenses"],
    ["Bad Debts written off", /BAD DEBT|WRITTEN OFF/, "Miscellaneous & Other Expenses"],
    ["Miscellaneous", /./, "Miscellaneous & Other Expenses"]
  ];
  X.EXP_HEADS = EXP.map(z => z[0]);
  X.EXP_GROUP = Object.fromEntries(EXP.map(z => [z[0], z[2]]));
  X.EXP_GROUPS = ["Cost of Stores and Spare Parts Consumed", "Manufacturing & Operating Expenses", "Administrative & General Expenses", "Selling & Distribution Expenses", "Miscellaneous & Other Expenses"];
  // the sub-heads (note rows) of each line, in the order they print
  X.SUBS = {
    share: ["Equity Share Capital"],
    reserves: ["Securities Premium", "General Reserve", "Surplus", "Other Reserves"],
    capital: ["Capital"], current: ["Current"],
    ltb: ["Secured|Term loans from banks", "Secured|Term loans from financial institutions", "Secured|Term loans from others", "Unsecured|Term loans from banks", "Unsecured|Loans from related parties", "Unsecured|Other loans"],
    stb: ["Secured|Loans repayable on demand from banks", "Secured|Current maturities of long-term debt", "Unsecured|Loans from related parties", "Unsecured|Other loans", "Unsecured|Current maturities of long-term debt"],
    tp: ["Micro and Small Enterprises", "Others"],
    ocl: ["Advance from Customers", "Employee dues", "Audit fees payable", "TDS payable", "GST payable", "PF payable", "ESI payable", "Credit card", "Other payables"],
    stp: ["Provision for Gratuity", "Provision for Taxation", "Provision for Other Expenses"],
    ltp: ["Provision for Gratuity", "Provision for Leave Encashment", "Other provisions"],
    oltl: ["Security deposits received", "Others"],
    ppe: ["Land", "Buildings", "Plant and Machinery", "Furniture and Fixtures", "Vehicles", "Office Equipment", "Computers", "Other Assets"],
    intang: ["Computer Software", "Goodwill", "Other Intangible Assets"], cwip: ["Capital Work-in-Progress"],
    nci: ["Unquoted|Investments in Equity Instruments", "Quoted|Investments in Equity Instruments", "Unquoted|Other investments"],
    ci: ["Investments in Mutual Funds", "Other current investments"],
    dta: ["Deferred Tax Assets (Net)"], dtl: ["Deferred Tax Liabilities (Net)"],
    ltla: ["Security Deposits", "Loans to related parties", "Capital advances", "Other loans and advances"],
    onca: ["Other non-current assets"],
    inv: ["Raw Materials", "Work-in-progress", "Finished Goods", "Stock-in-trade", "Stores and Spares"],
    tr: ["Unsecured, considered good", "Unsecured, considered doubtful"],
    cash: ["Cash and Cash Equivalents|Cash on hand", "Cash and Cash Equivalents|Balances with banks in current accounts", "Other Bank Balances|Other bank balances"],
    stla: ["Advance Tax and TDS", "GST Input Credit", "Advances to suppliers", "Advances to employees", "Loans to related parties", "Advances to others"],
    oca: ["Security Deposits", "Prepaid expenses", "Interest accrued", "Other current assets"],
    rev: ["Revenue from operations|Sale of products", "Revenue from operations|Sale of services", "Other operating revenue|Other operating revenue"],
    oth: ["Interest income|Interest on bank deposits", "Other non-operating income|Dividend income", "Other non-operating income|Miscellaneous income"],
    mat: ["Purchase", "Carriage Inward"], pur: ["Purchases of stock-in-trade"], chg: [],
    emp: ["Salaries and wages", "Director's Remuneration", "Partners' Remuneration", "Contribution to provident and other funds", "Gratuity", "Bonus", "Staff welfare expenses"],
    fin: ["Interest on Borrowings", "Interest on Partners' Capital", "Interest on late payment of taxes", "Interest others", "Other Borrowing costs"],
    dep: ["Depreciation on Property, Plant and Equipment", "Amortisation of intangible assets"],
    exp: X.EXP_HEADS.slice(),
    exc: ["Exceptional items"], xo: ["Extraordinary items"],
    tax: ["Current Tax", "Deferred Tax", "Tax of earlier years"]
  };

  // ------------------------------------------------------------ the mapping, rule-based first
  // a ledger: {l, g: [parent, ..., primary group]}; returns {line, sub, why, by: "rule"} or null for the owner to place
  X.suggest = function(t, kind){
    const g = (t.g || []).map(s => String(s).toLowerCase()), has = s => g.includes(s), up = String(t.l || "").toUpperCase(), all = up + " " + (t.g || []).join(" ").toUpperCase();
    const close = (t.o || 0) + (t.d || 0) - (t.c || 0), dr = close > 0, nc = X.layoutOf(kind) === "nc";
    const R = (line, sub, why) => ({line, sub, why, by: "rule"});
    // income and expenses
    if (has("sales accounts")) return R("rev", /SERVICE|FEES|CONSULT/.test(up) ? "Revenue from operations|Sale of services" : "Revenue from operations|Sale of products", "under Sales Accounts");
    if (has("direct incomes")) return R("rev", "Other operating revenue|Other operating revenue", "under Direct Incomes");
    if (has("indirect incomes")) return R("oth", /INTEREST/.test(up) ? "Interest income|Interest on bank deposits" : /DIVIDEND/.test(up) ? "Other non-operating income|Dividend income" : "Other non-operating income|Miscellaneous income", "under Indirect Incomes");
    if (has("purchase accounts")) return /RAW|MATERIAL|CONSUM/.test(up) ? R("mat", "Purchase", "under Purchase Accounts, raw material") : R("pur", "Purchases of stock-in-trade", "under Purchase Accounts");
    if (has("direct expenses") || has("indirect expenses")){
      if (/DEPRECIATION|AMORTI/.test(all)) return R("dep", /AMORTI/.test(up) ? "Amortisation of intangible assets" : "Depreciation on Property, Plant and Equipment", "depreciation");
      if (/DEFERRED TAX/.test(up)) return R("tax", "Deferred Tax", "deferred tax");
      if (/INCOME TAX|PROVISION FOR TAX|CURRENT TAX/.test(up)) return R("tax", /EARLIER|PRIOR/.test(up) ? "Tax of earlier years" : "Current Tax", "income tax");
      if (/PARTNER.*REMUN|REMUNERATION.*PARTNER/.test(up)) return R("emp", "Partners' Remuneration", "remuneration to partners");
      if (/INTEREST.*PARTNER|PARTNER.*INTEREST/.test(up)) return R("fin", "Interest on Partners' Capital", "interest to partners");
      if (/DIRECTOR.*REMUN|REMUNERATION.*DIRECTOR/.test(up)) return R("emp", "Director's Remuneration", "directors' remuneration");
      if (/SALAR|WAGES|STIPEND/.test(up)) return R("emp", "Salaries and wages", "salaries");
      if (/\bPF\b|PROVIDENT|\bESI|EMPLOYER.*CONTRIB/.test(up)) return R("emp", "Contribution to provident and other funds", "PF and ESI");
      if (/GRATUITY/.test(up)) return R("emp", "Gratuity", "gratuity");
      if (/BONUS/.test(up)) return R("emp", "Bonus", "bonus");
      if (/STAFF WELFARE|EMPLOYEE WELFARE/.test(up)) return R("emp", "Staff welfare expenses", "staff welfare");
      if (/INTEREST ON (TDS|GST|INCOME TAX|LATE|DELAY)|INTEREST.*TAX/.test(up)) return R("fin", "Interest on late payment of taxes", "interest on taxes");
      if (/PROCESSING FEE|LOAN PROCESS/.test(up)) return R("fin", "Other Borrowing costs", "loan processing fee");
      if (/INTEREST/.test(up) && /LOAN|BANK|OD|CC|TERM|BORROW/.test(up)) return R("fin", "Interest on Borrowings", "interest on loans");
      if (/INTEREST/.test(up)) return R("fin", "Interest others", "interest");
      if (has("direct expenses") && /CARRIAGE IN|FREIGHT IN/.test(up)) return R("mat", "Carriage Inward", "carriage inward");
      const h = EXP.find(z => z[1].test(up));
      return R("exp", h[0], "an expense (" + h[0] + ")");
    }
    // the owners' funds
    if (has("reserves & surplus")) return R("reserves", /PREMIUM/.test(up) ? "Securities Premium" : /GENERAL RESERVE/.test(up) ? "General Reserve" : /PROFIT|P ?& ?L|SURPLUS/.test(up) ? "Surplus" : "Other Reserves", "under Reserves & Surplus");
    if (/PROFIT\s*&\s*LOSS/.test(up)) return R("reserves", "Surplus", "the profit and loss account");
    if (has("capital account")){
      if (!nc) return /PREMIUM/.test(up) ? R("reserves", "Securities Premium", "share premium") : R("share", "Equity Share Capital", "under Capital Account");
      return /CURRENT/.test(up) ? R("current", "Current", "a partner's current account") : R("capital", "Capital", "under Capital Account");
    }
    // borrowings
    if (has("bank od a/c") || has("bank occ a/c")) return dr ? R("cash", "Cash and Cash Equivalents|Balances with banks in current accounts", "an overdraft account in debit") : R("stb", "Secured|Loans repayable on demand from banks", "an overdraft or cash credit");
    if (has("secured loans")) return /CREDIT CARD|OVERDRAFT|\bOD\b|\bCC\b|CASH CREDIT/.test(all) ? R("stb", "Secured|Loans repayable on demand from banks", "an overdraft or cash credit") :
      R("ltb", /BANK/.test(up) ? "Secured|Term loans from banks" : /FINANCE|NBFC|CAPITAL|HOUSING/.test(up) ? "Secured|Term loans from financial institutions" : "Secured|Term loans from others", "under Secured Loans");
    if (has("unsecured loans") || has("loans (liability)")){
      if (/CREDIT CARD/.test(up)) return R("ocl", "Credit card", "a credit card");
      return dr ? R("stla", "Advances to others", "a loan account in debit") : R("ltb", /DIRECTOR|PARTNER|RELATIVE/.test(up) ? "Unsecured|Loans from related parties" : /BANK/.test(up) ? "Unsecured|Term loans from banks" : "Unsecured|Other loans", "under Unsecured Loans");
    }
    // assets
    if (has("fixed assets")){
      if (/SOFTWARE|GOODWILL|TRADEMARK|PATENT|COPYRIGHT|LICEN[CS]E|INTANGIBLE/.test(up)) return R("intang", /GOODWILL/.test(up) ? "Goodwill" : /SOFTWARE/.test(up) ? "Computer Software" : "Other Intangible Assets", "an intangible asset");
      if (/CAPITAL WORK|CWIP|UNDER CONSTRUCTION/.test(up)) return R("cwip", "Capital Work-in-Progress", "capital work in progress");
      const cls = /\bLAND\b/.test(up) ? "Land" : /BUILDING|PREMISES/.test(up) ? "Buildings" : /PLANT|MACHIN/.test(up) ? "Plant and Machinery" : /FURNIT|FIXTURE/.test(up) ? "Furniture and Fixtures" :
        /VEHICLE|\bCAR\b|MOTOR|SCOOTER|BIKE/.test(up) ? "Vehicles" : /COMPUTER|LAPTOP|PRINTER|SERVER/.test(up) ? "Computers" : /OFFICE|EQUIP|\bAC\b|AIR CONDITION|MOBILE|PHONE/.test(up) ? "Office Equipment" : "Other Assets";
      return R("ppe", cls, "under Fixed Assets");
    }
    if (has("investments")) return /MUTUAL FUND|\bMF\b|LIQUID/.test(up) ? R("ci", "Investments in Mutual Funds", "a mutual fund") : R("nci", "Unquoted|Investments in Equity Instruments", "under Investments");
    if (has("stock-in-hand")) return R("inv", /RAW|MATERIAL/.test(up) ? "Raw Materials" : /WIP|WORK.IN/.test(up) ? "Work-in-progress" : /STORE|SPARE/.test(up) ? "Stores and Spares" : /TRADING|STOCK.IN.TRADE/.test(up) ? "Stock-in-trade" : "Finished Goods", "under Stock-in-Hand");
    if (has("sundry debtors")) return dr ? R("tr", "Unsecured, considered good", "a customer") : R("ocl", "Advance from Customers", "a customer in credit");
    if (has("sundry creditors")) return dr ? R("stla", "Advances to suppliers", "a supplier in debit") : R("tp", t.msme ? "Micro and Small Enterprises" : "Others", "a supplier");
    if (has("cash-in-hand")) return R("cash", "Cash and Cash Equivalents|Cash on hand", "cash");
    if (has("bank accounts")){
      if (!dr && close < 0) return R("stb", "Secured|Loans repayable on demand from banks", "a bank account in credit");
      return R("cash", /FIXED DEPOSIT|\bFD\b|FDR|DEPOSIT/.test(up) ? "Other Bank Balances|Other bank balances" : "Cash and Cash Equivalents|Balances with banks in current accounts", "a bank account");
    }
    if (/DEFERRED TAX/.test(up)) return dr ? R("dta", "Deferred Tax Assets (Net)", "deferred tax") : R("dtl", "Deferred Tax Liabilities (Net)", "deferred tax");
    if (has("provisions")) return /GRATUITY/.test(up) ? R("stp", "Provision for Gratuity", "a provision") : /TAX/.test(up) ? R("stp", "Provision for Taxation", "a provision for tax") : R("stp", "Provision for Other Expenses", "a provision");
    if (has("duties & taxes")){
      if (dr) return R("stla", /TDS|TCS|ADVANCE TAX|INCOME TAX/.test(up) ? "Advance Tax and TDS" : "GST Input Credit", "a tax ledger in debit");
      return R("ocl", /TDS|TCS/.test(up) ? "TDS payable" : /GST|CGST|SGST|IGST/.test(up) ? "GST payable" : /\bPF\b|PROVIDENT/.test(up) ? "PF payable" : /\bESI/.test(up) ? "ESI payable" : "Other payables", "under Duties & Taxes");
    }
    if (has("deposits (asset)")) return /FIXED DEPOSIT|\bFD\b|FDR/.test(up) ? R("cash", "Other Bank Balances|Other bank balances", "a fixed deposit") : R(/RENT|SECURITY|ELECTRIC/.test(up) ? "ltla" : "oca", "Security Deposits", "a deposit");
    if (has("loans & advances (asset)")){
      if (!dr) return R("ocl", "Other payables", "an advance in credit");
      return R("stla", /STAFF|EMPLOYEE|SALARY ADV/.test(up) ? "Advances to employees" : /DIRECTOR|PARTNER|RELATIVE/.test(up) ? "Loans to related parties" : /TDS|TCS|ADVANCE TAX|INCOME TAX/.test(up) ? "Advance Tax and TDS" : /GST|INPUT/.test(up) ? "GST Input Credit" : "Advances to others", "under Loans & Advances (Asset)");
    }
    if (has("current assets")) return R(dr ? "oca" : "ocl", dr ? (/PREPAID/.test(up) ? "Prepaid expenses" : /INTEREST ACCRUED/.test(up) ? "Interest accrued" : "Other current assets") : "Other payables", "under Current Assets");
    if (has("current liabilities")) return dr ? R("stla", "Advances to others", "a liability in debit") : R("ocl", /SALAR|WAGES|EMPLOYEE|STAFF/.test(up) ? "Employee dues" : /AUDIT/.test(up) ? "Audit fees payable" : "Other payables", "under Current Liabilities");
    if (has("misc. expenses (asset)")) return R("onca", "Other non-current assets", "miscellaneous expenditure");
    return null;
  };
  // the sub-head for a ledger on a line (when the owner moves a ledger to another line, the sub follows the rule for it)
  X.subFor = function(t, line, kind){
    const s = X.suggest(t, kind);
    if (s && s.line === line) return s.sub;
    const list = X.SUBS[line] || [];
    if (line === "exp"){ const h = EXP.find(z => z[1].test(String(t.l).toUpperCase())); return h[0]; }
    return list[list.length - 1] || "";
  };

  // ------------------------------------------------------------ the mapping kept for a client, versioned
  // store: {versions: [{v, at, by, note, map: {ledger: {line, sub, by}}}], draft: {...}}; the owner confirms once, it
  // is reused every year; a ledger not in the confirmed version is new and flagged
  X.mapping = function(store, tb, kind){
    store = store || {versions: []};
    const conf = (store.versions || [])[store.versions.length - 1] || null, map = {}, fresh = [], unplaced = [];
    (tb || []).forEach(t => {
      const k = t.l, c = conf && conf.map[k], d = store.draft && store.draft[k];
      if (d){ map[k] = Object.assign({}, d, {pending: true}); if (conf && !c) fresh.push(k); return; }
      if (c){ map[k] = Object.assign({}, c); return; }
      const s = X.suggest(t, kind);
      if (!s){ unplaced.push(k); map[k] = {line: "", sub: "", by: "none", why: "no rule: place it by hand"}; }
      else map[k] = s;
      if (conf) fresh.push(k);
    });
    return {map, version: conf ? conf.v : 0, confirmed: !!conf, fresh, unplaced};
  };
  X.confirm = function(store, map, who, at, note){
    store = store || {versions: []};
    const v = ((store.versions || []).slice(-1)[0] || {v: 0}).v + 1, keep = {};
    Object.keys(map).sort().forEach(k => { const m = map[k]; if (m && m.line) keep[k] = {line: m.line, sub: m.sub || "", by: m.by === "owner" ? "owner" : m.by === "ai" ? "ai-confirmed" : "rule"}; });
    store.versions = (store.versions || []).concat([{v, at: at || "", by: who || "", note: note || "", map: keep}]);
    store.draft = {};
    return store;
  };
  X.editMap = function(store, ledger, line, sub, kind, t){
    store = store || {versions: []}; store.draft = store.draft || {};
    store.draft[ledger] = {line, sub: sub || X.subFor(t || {l: ledger, g: []}, line, kind), by: "owner", why: "placed by hand"};
    return store;
  };

  // ------------------------------------------------------------ cells and formulas
  // a figure: {v: paise (whole rupees), f: Excel formula, nm: defined name}. Every figure on the statements is a formula
  // back to the TB sheet (TB_*) or to the Details sheet (D_*, figures Tally does not hold), or to other named figures.
  const xq = s => String(s).replace(/"/g, '""');
  const C = (v, f, nm) => ({v, f: f || null, nm: nm || null});
  X.C = C;
  // the Excel names a figure can take: letters, digits and _ only
  const nmOf = s => String(s).replace(/[^A-Za-z0-9_]/g, "_");

  // ------------------------------------------------------------ the builder
  // inp: {entity: {name, kind, cin, pan, udyam, address}, fy: "2025" (the year from 1 April 2025), tb: [{l, g: [parent ..
  //   primary], o, d, c, po, pd, pc, msme}] (rupees, Dr positive; o the opening of the year; po, pd, pc the previous year
  //   when known), map: {ledger: {line, sub}} (the confirmed mapping), det: the details for you, age: {tp, tr}, opts}
  X.build = function(inp){
    const ent = Object.assign({name: "", kind: "company"}, inp.entity || {}), kind = ent.kind, co = X.layoutOf(kind) === "co", firm = !co;
    const fy = String(inp.fy), D = X.dates(fy), det = inp.det || {}, opts = Object.assign({cashflow: false}, inp.opts || {});
    const map = inp.map || {}, warn = [];
    // the ledgers, in paise, with their line and sub-head
    const L = (inp.tb || []).map((t, i) => {
      const m = map[t.l] || {}, line = m.line || "", pl = X.isPL(line), hasPy = t.po != null || t.pd != null || t.pc != null;
      const o = P(t.o), d = P(t.d), c = P(t.c), po = P(t.po), pd = P(t.pd), pc = P(t.pc);
      // stock ledgers (Tally without integrated inventory): last year's closing stock is this year's opening
      const cy = pl ? d - c : o + d - c, py = pl ? pd - pc : (hasPy && line !== "inv" ? po + pd - pc : o);
      return {i, l: t.l, g: t.g || [], line, sub: m.sub || "", by: m.by || "", pl, o, d, c, po, pd, pc, hasPy, cy, py, msme: t.msme || ""};
    });
    // books not rolled over at the year end (as FinCom holds them: Tally's balances moved by the vouchers): last year's
    // profit is still in the income and expense ledgers, the closing stock is not in the stock ledgers, and a firm's
    // profit is not yet in the partners' accounts. FSX carries all three into this year's openings itself.
    const rolled = !L.some(x => x.pl && x.o);
    const unplaced = L.filter(x => !x.line && (x.o || x.d || x.c || x.po || x.pd || x.pc)).map(x => x.l);
    const nm = {}, cells = {};           // the defined names: name -> paise, and name -> the figure

    const sideSign = line => { const z = X.line(line); return z && (z.side === "L" || z.side === "I") ? -1 : 1; };
    // the sum of a column over the ledgers of a line (and sub), signed for the statement, rounded to the rupee, with its formula
    const tbSum = (col, line, sub, extra) => {
      const sg = sideSign(line), xs = L.filter(x => x.line === line && (sub == null || x.sub === sub) && (!extra || extra(x)));
      const raw = sum(xs, x => x[{CY: "cy", PY: "py", O: "o", D: "d", C: "c", PO: "po", PD: "pd", PC: "pc"}[col]]);
      const f = "ROUND(ROUND(SUMIFS(TB_" + col + ",TB_LINE,\"" + xq(line) + "\"" + (sub != null ? ",TB_SUB,\"" + xq(sub) + "\"" : "") + "),2),0)";
      return C(sg * R0(raw), (sg < 0 ? "-" : "") + f);
    };
    const ledSum = (col, ledgers, sg) => {
      const xs = L.filter(x => ledgers.includes(x.l)), raw = sum(xs, x => x[col === "CY" ? "cy" : col === "PY" ? "py" : col === "O" ? "o" : col === "D" ? "d" : col === "C" ? "c" : col === "PO" ? "po" : col === "PD" ? "pd" : "pc"]);
      const f = ledgers.length ? "ROUND(ROUND(" + ledgers.map(l => "SUMIFS(TB_" + col + ",TB_LEDGER,\"" + xq(l) + "\")").join("+") + ",2),0)" : "0";
      return C((sg || 1) * R0(raw), ((sg || 1) < 0 ? "-" : "") + f);
    };
    // the details for you that go into a figure: a cell on the Details sheet
    const inputs = [];
    const din = (n, label, rupees, group) => { const v = P(rupees); const key = "D_" + nmOf(n); if (!inputs.find(z => z.nm === key)) inputs.push({nm: key, label, v, group: group || ""}); nm[key] = v; return C(v, key); };
    const dinN = (n, label, count, group) => { const key = "D_" + nmOf(n); const v = Number(count) || 0; if (!inputs.find(z => z.nm === key)) inputs.push({nm: key, label, n: v, group: group || ""}); nm[key] = v; return {n: v, f: key}; };
    const add = (a, b) => C(a.v + b.v, "(" + (a.f || a.v / 100) + ")+(" + (b.f || b.v / 100) + ")");
    const neg = a => C(-a.v, "-(" + (a.f || a.v / 100) + ")");
    const ref = n => C(nm[n] != null ? nm[n] : 0, n);
    const named = (cell, n) => { cell.nm = n; nm[n] = cell.v; cells[n] = cell; return cell; };
    const lineHas = id => L.some(x => x.line === id && (x.cy || x.py || x.o));

    // ---------------------------------------------------------- inventories (closing as given in the details, else the ledgers)
    const INV = X.SUBS.inv, stockCls = {}, carry = {v: 0, f: []};
    INV.forEach(k => {
      const open = tbSum("O", "inv", k), mv = tbSum("CY", "inv", k);  // mv: the ledgers' closing
      const ledClose = mv, ledMove = C(mv.v - open.v, "(" + mv.f + ")-(" + open.f + ")");
      const given = det.stock && det.stock.cy && det.stock.cy[k] != null ? din("stock_cy_" + k, "Closing stock " + k + " (" + D.cyAsAt + ")", det.stock.cy[k], "Inventories") : null;
      const givenPy = det.stock && det.stock.py && det.stock.py[k] != null ? din("stock_py_" + k, "Closing stock " + k + " (" + D.pyAsAt + ")", det.stock.py[k], "Inventories") : null;
      const close = given || ledClose, pyClose = givenPy || tbSum("PY", "inv", k);
      // not rolled over: last year's closing stock (given) is this year's opening; the difference goes to the opening surplus
      if (!rolled && givenPy){ carry.v += givenPy.v - open.v; carry.f.push("(" + givenPy.f + ")-(" + open.f + ")"); const pD = tbSum("PD", "inv", k), pC = tbSum("PC", "inv", k); stockCls[k] = {open: givenPy, ledMove, close, pyOpen: tbSum("PO", "inv", k), pyMove: C(pD.v - pC.v, "(" + pD.f + ")-(" + pC.f + ")"), pyClose, ledOpen: open}; return; }
      const pyOpen = tbSum("PO", "inv", k), pyD = tbSum("PD", "inv", k), pyC = tbSum("PC", "inv", k), pyMove = C(pyD.v - pyC.v, "(" + pyD.f + ")-(" + pyC.f + ")");
      stockCls[k] = {open, ledMove, close, pyOpen, pyMove, pyClose};
    });
    const anyInv = INV.some(k => stockCls[k].close.v || stockCls[k].open.v || stockCls[k].pyClose.v);
    // the expense effect of a class of stock: opening + movements booked - closing
    const stockEff = (ks, y) => {
      const parts = ks.map(k => { const s = stockCls[k]; return y === "py" ? [s.pyOpen, s.pyMove, s.pyClose] : [s.open, s.ledMove, s.close]; });
      const v = sum(parts, p => p[0].v + p[1].v - p[2].v);
      return C(v, parts.length ? parts.map(p => "(" + p[0].f + ")+(" + p[1].f + ")-(" + p[2].f + ")").join("+") : "0");
    };

    // ---------------------------------------------------------- the P&L figures
    const pl = {}, plPy = {};
    const PLL = ["rev", "oth", "mat", "pur", "chg", "emp", "fin", "dep", "exp", "exc", "xo", "tax"];
    PLL.forEach(k => { pl[k] = tbSum("CY", k); plPy[k] = tbSum("PY", k); });
    const RM = ["Raw Materials", "Stores and Spares"], FG = ["Work-in-progress", "Finished Goods", "Stock-in-trade"];
    pl.mat = add(pl.mat, stockEff(RM, "cy")); plPy.mat = add(plPy.mat, stockEff(RM, "py"));
    pl.chg = add(pl.chg, stockEff(FG, "cy")); plPy.chg = add(plPy.chg, stockEff(FG, "py"));
    // the P&L face, each a named figure
    PLL.forEach(k => { named(pl[k], "L_" + k + "_CY"); named(plPy[k], "L_" + k + "_PY"); });
    const tot = (ks, y, n, sgn) => { const v = sum(ks, (k, i) => (sgn ? sgn[i] : 1) * nm["L_" + k + "_" + y]); return named(C(v, ks.map((k, i) => (sgn && sgn[i] < 0 ? "-" : (i ? "+" : "")) + "L_" + k + "_" + y).join("")), n); };
    ["CY", "PY"].forEach(y => {
      tot(["rev", "oth"], y, "T_inc_" + y);
      tot(["mat", "pur", "chg", "emp", "fin", "dep", "exp"], y, "T_exp_" + y);
      named(C(nm["T_inc_" + y] - nm["T_exp_" + y], "T_inc_" + y + "-T_exp_" + y), "T_pbe_" + y);
      named(C(nm["T_pbe_" + y] - nm["L_exc_" + y], "T_pbe_" + y + "-L_exc_" + y), "T_pbx_" + y);
      named(C(nm["T_pbx_" + y] - nm["L_xo_" + y], "T_pbx_" + y + "-L_xo_" + y), "T_pbt_" + y);
    });
    // tax: current and deferred (earlier years shown with current tax)
    const taxCur = {CY: add(tbSum("CY", "tax", "Current Tax"), tbSum("CY", "tax", "Tax of earlier years")), PY: add(tbSum("PY", "tax", "Current Tax"), tbSum("PY", "tax", "Tax of earlier years"))};
    const taxDef = {CY: tbSum("CY", "tax", "Deferred Tax"), PY: tbSum("PY", "tax", "Deferred Tax")};
    ["CY", "PY"].forEach(y => { named(taxCur[y], "L_taxcur_" + y); named(taxDef[y], "L_taxdef_" + y);
      named(C(nm["T_pbt_" + y] - nm["L_tax_" + y], "T_pbt_" + y + "-L_tax_" + y), "T_pat_" + y); });

    // ---------------------------------------------------------- the partners' accounts (a firm or LLP) or the proprietor's
    const partners = firm ? (det.partners || []) : [];
    const pAcc = {cap: [], cur: []};
    if (firm){
      ["PY", "CY"].forEach(y => {
        const py = y === "PY", O = py ? "PO" : "O", Dc = py ? "PD" : "D", Cc = py ? "PC" : "C";
        let given = 0;
        partners.forEach((p, i) => {
          const share = Number(p.share) || 0, last = i === partners.length - 1;
          const rem = ledSum(py ? "PY" : "CY", [].concat(p.rem || [])), int = ledSum(py ? "PY" : "CY", [].concat(p.int || []));
          const profit = last ? C(nm["T_pat_" + y] - given, "T_pat_" + y + (partners.length > 1 ? "-(" + partners.slice(0, -1).map((q, j) => "P_" + j + "_profit_" + y).join("+") + ")" : "")) :
            C(R0(nm["T_pat_" + y] * share / 100), "ROUND(T_pat_" + y + "*" + share + "/100,0)");
          named(profit, "P_" + i + "_profit_" + y); given += profit.v;
          const mk = (ledger, withPl) => {
            const lg = ledger ? [ledger] : [];
            let open = ledSum(O, lg, -1); const cr = ledSum(Cc, lg, 1), dr = ledSum(Dc, lg, 1);
            // not rolled over: last year's share of profit is part of this year's opening
            if (!rolled && !py && withPl) open = C(open.v + nm["P_" + i + "_profit_PY"], "(" + open.f + ")+P_" + i + "_profit_PY");
            const r = withPl ? rem : C(0, "0"), n = withPl ? int : C(0, "0"), pr = withPl ? profit : C(0, "0");
            const intro = C(cr.v - r.v - n.v, "(" + cr.f + ")-(" + r.f + ")-(" + n.f + ")"), wd = C(-dr.v, "-(" + dr.f + ")");
            const close = C(open.v + intro.v + r.v + n.v + wd.v + pr.v, null);
            return {name: p.name, share, open, intro, rem: r, int: n, wd, profit: pr, close};
          };
          const hasCur = !!p.current;
          pAcc.cap.push(Object.assign(mk(p.capital, !hasCur), {y, i}));
          if (hasCur) pAcc.cur.push(Object.assign(mk(p.current, true), {y, i}));
        });
      });
    }

    // ---------------------------------------------------------- the balance sheet lines
    const bsLines = co ? ["share", "reserves", "ltb", "dtl", "oltl", "ltp", "stb", "tp", "ocl", "stp", "ppe", "intang", "cwip", "nci", "dta", "ltla", "onca", "ci", "inv", "tr", "cash", "stla", "oca"]
      : ["capital", "current", "reserves", "ltb", "dtl", "oltl", "ltp", "stb", "tp", "ocl", "stp", "ppe", "intang", "cwip", "nci", "dta", "ltla", "onca", "ci", "inv", "tr", "cash", "stla", "oca"];
    const face = {};
    bsLines.forEach(k => {
      ["CY", "PY"].forEach(y => {
        let c;
        if (k === "inv") c = C(sum(INV, z => (y === "CY" ? stockCls[z].close : stockCls[z].pyClose).v), INV.map(z => "(" + (y === "CY" ? stockCls[z].close : stockCls[z].pyClose).f + ")").join("+"));
        else if (firm && (k === "capital" || k === "current")){
          const rows = pAcc[k === "capital" ? "cap" : "cur"].filter(r => r.y === y);
          c = C(sum(rows, r => r.close.v), null);           // the formula is the note's total (set when the note is made)
          if (!partners.length) c = tbSum(y, k);
        } else if (k === "reserves") c = C(0, null);         // set below, from the note
        else c = tbSum(y, k);
        face[k + "_" + y] = c;
      });
    });
    // reserves: the note's rows, and a rounding off that makes the balance sheet tally in whole rupees (never more than a few rupees)
    const sideTot = (secs, y, skip) => sum(bsLines.filter(k => secs.includes(X.line(k).sec) && k !== skip), k => face[k + "_" + y].v);
    const res = {CY: {}, PY: {}};
    ["CY", "PY"].forEach(y => {
      const py = y === "PY", R = res[y];
      ["Securities Premium", "General Reserve", "Other Reserves"].forEach(s => {
        const open = tbSum(py ? "PO" : "O", "reserves", s), addn = tbSum(py ? "PC" : "C", "reserves", s), ded = tbSum(py ? "PD" : "D", "reserves", s);
        // a liability: the opening (a credit) shows positive; credits in the year are additions, debits deductions
        R[s] = {open, add: C(-addn.v, addn.f.replace(/^-/, "")), ded: C(-ded.v, ded.f.replace(/^-/, ""))};
        R[s].close = C(R[s].open.v + R[s].add.v - R[s].ded.v, null);
      });
      // surplus: the P&L ledger's opening, last year's profit still in income and expense ledgers, the profit, adjustments
      const so = tbSum(py ? "PO" : "O", "reserves", "Surplus"), nomO = C(-R0(sum(L.filter(x => x.pl), x => py ? x.po : x.o)),
        "-ROUND(ROUND(SUMIFS(TB_" + (py ? "PO" : "O") + ",TB_NATURE,\"PL\"),2),0)");
      let sOpen = C(so.v + nomO.v, "(" + so.f + ")+(" + nomO.f + ")");
      if (!py && carry.v) sOpen = C(sOpen.v + carry.v, sOpen.f + "+" + carry.f.join("+"));
      if (!py && !rolled && firm && partners.length) sOpen = C(sOpen.v - nm.T_pat_PY, sOpen.f + "-T_pat_PY");
      const sAdjRaw = sum(L.filter(x => x.line === "reserves" && x.sub === "Surplus"), x => py ? x.pc - x.pd : x.c - x.d);
      const sAdj = C(R0(sAdjRaw), "ROUND(ROUND(SUMIFS(TB_" + (py ? "PC" : "C") + ",TB_LINE,\"reserves\",TB_SUB,\"Surplus\")-SUMIFS(TB_" + (py ? "PD" : "D") + ",TB_LINE,\"reserves\",TB_SUB,\"Surplus\"),2),0)");
      R.sOpen = sOpen; R.profit = ref("T_pat_" + y); R.adj = sAdj; R.adjCaption = ((det.reserves || {}).adjCaption || {})[y.toLowerCase()] || "";
      R.transfer = firm ? C(-nm["T_pat_" + y], "-T_pat_" + y) : C(0, "0");
      const before = R["Securities Premium"].close.v + R["General Reserve"].close.v + R["Other Reserves"].close.v + sOpen.v + R.profit.v + sAdj.v + R.transfer.v;
      const other = sideTot(["NCA", "CA"], y) - sideTot(["EQ", "NCL", "CL"], y, "reserves");
      R.round = C(other - before, null); R.total = C(other, null);
      if (Math.abs(R.round.v) > 500) R.roundBig = true;   // more than 5 rupees: the balance sheet does not tally
      face["reserves_" + y] = C(R.total.v, null);
    });
    // section totals
    ["CY", "PY"].forEach(y => {
      named(C(sideTot(["EQ", "NCL", "CL"], y), "S_EQ_" + y + "+S_NCL_" + y + "+S_CL_" + y), "T_el_" + y);
      named(C(sideTot(["NCA", "CA"], y), "S_NCA_" + y + "+S_CA_" + y), "T_as_" + y);
      // reserves: what makes the two sides agree, worked out in the note (Rounding Off) from the other lines
      face["reserves_" + y].f = "S_NCA_" + y + "+S_CA_" + y + "-(" + bsLines.filter(k => ["EQ", "NCL", "CL"].includes(X.line(k).sec) && k !== "reserves").map(k => "L_" + k + "_" + y).join("+") + ")";
      bsLines.forEach(k => named(face[k + "_" + y], "L_" + k + "_" + y));
      ["EQ", "NCL", "CL", "NCA", "CA"].forEach(s => named(C(sideTot([s], y), bsLines.filter(k => X.line(k).sec === s).map(k => "L_" + k + "_" + y).join("+") || "0"), "S_" + s + "_" + y));
    });
    // trade payables on the face, micro and small apart (company)
    const tpMse = {CY: tbSum("CY", "tp", "Micro and Small Enterprises"), PY: tbSum("PY", "tp", "Micro and Small Enterprises")};
    ["CY", "PY"].forEach(y => { named(tpMse[y], "L_tpmse_" + y); named(C(face["tp_" + y].v - tpMse[y].v, "L_tp_" + y + "-L_tpmse_" + y), "L_tpoth_" + y); });

    const model = {rolled, carry: carry.v, ent, kind, co, firm, fy, D, det, opts, L, nm, cellsByName: cells, age: inp.age || null, units: X.UNITS, inputs, unplaced, warn, face, pl, plPy, stockCls, pAcc, res, partners, tpMse, taxCur, taxDef, bsLines, notes: [], pages: []};
    X.notes(model);
    X.ratios(model);
    if (opts.cashflow) X.cashflow(model);
    X.number(model);
    X.paginate(model);
    return model;
  };

  // ------------------------------------------------------------ the accounting policies, by entity type
  // each: [no, title, text]; text may hold {E} (the entity: the Company / the Firm / the LLP / the Proprietor) and {Es}
  // (its possessive). Switches: dep ("sch2" Schedule II rates / "it" Income-tax rates), mat, deferredTax, levelIV,
  // exportIncentive, dividend. The owner may edit any paragraph (det.policies.text[no]).
  X.policies = function(kind, sw){
    sw = Object.assign({dep: kind === "company" ? "sch2" : "it", mat: kind === "company", deferredTax: kind === "company", levelIV: kind !== "company", exportIncentive: false, dividend: kind !== "company"}, sw || {});
    const co = kind === "company", P2 = [];
    const add = (title, text) => P2.push([title, text]);
    add("Basis of Preparation", co ? "These financial statements have been prepared in accordance with the generally accepted accounting principles in India (Indian GAAP) under the historical cost convention on the accrual basis. Indian GAAP comprises the Accounting Standards notified under section 133 of the Companies Act, 2013 read with the Companies (Accounting Standards) Rules, 2021, and the other relevant provisions of the Act. The financial statements are presented in the format of Division I of Schedule III to the Act. All assets and liabilities have been classified as current or non-current as per {Es} normal operating cycle, which has been determined as twelve months."
      : "These financial statements have been prepared in accordance with the generally accepted accounting principles in India (Indian GAAP) under the historical cost convention on the accrual basis, and the Accounting Standards issued by the Institute of Chartered Accountants of India as applicable to non-corporate entities. They are presented in the format of the ICAI Guidance Note on Financial Statements of Non-Corporate Entities. {E} has determined its operating cycle as twelve months for classifying assets and liabilities as current or non-current.");
    add("Use of Estimates", "The preparation of the financial statements requires management to make estimates and assumptions that affect the reported amounts of assets, liabilities, income and expenses and the disclosure of contingent liabilities. The estimates are based on management's best knowledge of current events and actions; actual results could differ. Significant estimates include:\n(i) the useful lives of property, plant and equipment;\n(ii) provisions for doubtful receivables;\n(iii) provisions for employee benefits;\n(iv) provisions for income tax;\n(v) the valuation of inventories;\n(vi) contingent liabilities.\nAny revision to an accounting estimate is recognised prospectively.");
    add(co ? "Property, Plant and Equipments" : "Property, Plant and Equipment", "Property, plant and equipment are stated at cost of acquisition less accumulated depreciation and impairment, if any. Cost includes the purchase price, non-refundable taxes and expenses directly attributable to bringing the asset to its working condition. " +
      (sw.dep === "sch2" ? "Depreciation is provided on the written down value method at the rates derived from the useful lives prescribed in Schedule II to the Companies Act, 2013, with a residual value of not more than 5% of the cost. Depreciation on additions and deletions is provided on a pro-rata basis from or up to the date of addition or deletion."
        : "Depreciation is provided on the written down value method at the rates and on the blocks of assets prescribed under the Income-tax Act, 1961; on assets put to use for less than 180 days in the year, at 50% of the rate."));
    if (co) add("Impairment of Assets", "At each balance sheet date {E} reviews the carrying amounts of its assets for any indication of impairment. Where the carrying amount exceeds the recoverable amount, the asset is written down to the recoverable amount and the loss is recognised in the Statement of Profit and Loss.");
    add("Investments", "Long-term investments are carried at cost less any diminution in value that is other than temporary. Current investments are carried at the lower of cost and fair value.");
    add("Inventories", "Inventories are valued at the lower of cost and net realisable value. Cost is determined on the first-in, first-out (FIFO) basis and includes all costs of purchase, conversion and other costs incurred in bringing the inventories to their present location and condition.");
    add("Trade Receivables and Loans and Advances", "Trade receivables and loans and advances are stated after making adequate provision for amounts considered doubtful of recovery.");
    add("Cash and cash equivalents", "Cash and cash equivalents comprise cash on hand and balances with banks, and short-term deposits with an original maturity of three months or less.");
    add("Provisions and Contingent Liabilities", "A provision is recognised when {E} has a present obligation as a result of a past event, it is probable that an outflow of resources will be required to settle it, and a reliable estimate can be made. Contingent liabilities are disclosed by way of notes; contingent assets are not recognised.");
    add("Revenue Recognition", "Revenue from the sale of goods is recognised when the significant risks and rewards of ownership pass to the buyer, and from services as they are rendered, net of goods and services tax, returns and discounts. Interest income is recognised on a time proportion basis." +
      (sw.dividend ? " Dividend income is recognised when the right to receive it is established." : "") + (sw.exportIncentive ? " Export incentives are recognised when the right to receive them is established and there is no significant uncertainty about collection." : ""));
    add("Employee Benefits", sw.levelIV ? "{E} is a Level IV entity as per the ICAI classification. Short-term employee benefits are recognised as an expense in the year in which the services are rendered. Contributions to the provident fund and other defined contribution schemes are charged when due. Gratuity and leave encashment are accounted for on a payment basis."
      : "Short-term employee benefits are recognised as an expense at the undiscounted amount in the year in which the related service is rendered. Contributions to defined contribution plans such as the provident fund are charged when due. The liability for defined benefit plans such as gratuity is determined by actuarial valuation at the balance sheet date. Other long-term employee benefits are provided on the basis of actuarial valuation.");
    add("Taxes on Income", "Current tax is the amount of tax payable on the taxable income for the year as determined under the Income-tax Act, 1961." + (sw.mat ? " Minimum Alternate Tax (MAT) paid is recognised as an asset only where there is convincing evidence that {E} will pay normal tax within the period allowed." : "") +
      (sw.deferredTax && !sw.levelIV ? " Deferred tax is recognised on timing differences between taxable income and accounting income that originate in one period and are capable of reversal in one or more subsequent periods, at the tax rates enacted or substantively enacted at the balance sheet date. Deferred tax assets are recognised only to the extent there is reasonable certainty of realisation." : " Deferred tax is not applicable to {E} as a Level IV entity."));
    if (co) add("Earnings per Share", "Basic earnings per share is computed by dividing the net profit after tax attributable to equity shareholders by the weighted average number of equity shares outstanding during the year. Diluted earnings per share is computed after adjusting for the effects of all dilutive potential equity shares.");
    return P2.map(([t, x], i) => ({no: "2." + (i + 1), title: t, text: x}));
  };
  const ENTW = {company: ["the Company", "the Company's"], llp: ["the LLP", "the LLP's"], firm: ["the Firm", "the Firm's"], proprietor: ["the Proprietor", "the Proprietor's"]};
  X.entWords = kind => ENTW[kind] || ENTW.company;
  const fillE = (s, kind) => { const w = X.entWords(kind); return String(s).replace(/\{E\}/g, w[0].replace(/^t/, "T")).replace(/\{Es\}/g, w[1]).replace(/([.:;] |^)the (Company|Firm|LLP|Proprietor)/g, (m, a, b) => a + "The " + b); };

  // the Additional Regulatory Information (company): [key, the "no" statement, the "yes" statement]
  X.ARI = [
    ["charges", "There are no charges or satisfaction yet to be registered with the Registrar of Companies beyond the statutory period.", "Charges or satisfaction yet to be registered with the Registrar of Companies beyond the statutory period: {x}"],
    ["wilful", "The Company has not been declared a wilful defaulter by any bank or financial institution or other lender.", "The Company has been declared a wilful defaulter: {x}"],
    ["statements", "The quarterly returns or statements of current assets filed by the Company with banks or financial institutions are in agreement with the books of account.", "The quarterly returns or statements of current assets filed with the banks differ from the books of account: {x}"],
    ["titleDeeds", "The title deeds of all immovable properties are held in the name of the Company.", "Title deeds of immovable property not held in the name of the Company: {x}"],
    ["benami", "No proceedings have been initiated or are pending against the Company for holding any benami property under the Benami Transactions (Prohibition) Act, 1988 and the rules made thereunder.", "Proceedings under the Benami Transactions (Prohibition) Act, 1988: {x}"],
    ["revaluation", "The Company has not revalued its property, plant and equipment or intangible assets during the year.", "Revaluation of property, plant and equipment or intangible assets during the year: {x}"],
    ["cwip", "The Company has no capital work-in-progress.", "Capital work-in-progress ageing and completion schedule: {x}"],
    ["iaud", "The Company has no intangible assets under development.", "Intangible assets under development: {x}"],
    ["layers", "The Company has complied with the number of layers prescribed under clause (87) of section 2 of the Companies Act, 2013.", "Non-compliance with the number of layers prescribed under section 2(87): {x}"],
    ["crypto", "The Company has not traded or invested in crypto currency or virtual currency during the year.", "Crypto currency or virtual currency: {x}"],
    ["rpLoans", "The Company has not granted any loans or advances in the nature of loans to promoters, directors, KMPs and related parties that are repayable on demand or without specifying any terms or period of repayment.", "Loans or advances in the nature of loans granted to promoters, directors, KMPs and related parties: Refer Note {{note:stla}}. {x}"],
    ["struckOff", "The Company has no transactions with companies struck off under section 248 of the Companies Act, 2013 or section 560 of the Companies Act, 1956.", "Transactions with struck-off companies: {x}"],
    ["undisclosed", "The Company has no transaction not recorded in the books of account that has been surrendered or disclosed as income during the year in the tax assessments under the Income-tax Act, 1961.", "Income surrendered or disclosed in tax assessments: {x}"],
    ["schemes", "No scheme of arrangements has been approved by the competent authority in terms of sections 230 to 237 of the Companies Act, 2013.", "Scheme of arrangements approved under sections 230 to 237: {x}"],
    ["onwardOut", "The Company has not advanced or loaned or invested funds to any other person or entity with the understanding that the intermediary shall lend or invest in other persons identified by or on behalf of the Company (ultimate beneficiaries).", "Funds advanced to intermediaries for ultimate beneficiaries: {x}"],
    ["onwardIn", "The Company has not received any fund from any person or entity with the understanding that the Company shall lend or invest in other persons identified by or on behalf of the funding party (ultimate beneficiaries).", "Funds received from funding parties for ultimate beneficiaries: {x}"]
  ];
  X.REGROUP = "Previous Period figures have been re-grouped / re-classified, wherever necessary, to make them comparable with Current Period's classification.";

  // ------------------------------------------------------------ the notes
  X.notes = function(M){
    const {co, firm, D, det, L, nm, face, ent} = M, N = M.notes, kind = M.kind;
    const cells = M.cellsByName = M.cellsByName || {};
    const named = (cell, n) => { cell.nm = n; nm[n] = cell.v; cells[n] = cell; return cell; };
    const sideSign = line => { const z = X.line(line); return z && (z.side === "L" || z.side === "I") ? -1 : 1; };
    const tbSum = (col, line, sub, ledger) => {
      const sg = sideSign(line), xs = L.filter(x => x.line === line && (sub == null || x.sub === sub) && (ledger == null || x.l === ledger));
      const raw = sum(xs, x => x[{CY: "cy", PY: "py", O: "o", D: "d", C: "c", PO: "po", PD: "pd", PC: "pc"}[col]]);
      const f = "ROUND(ROUND(SUMIFS(TB_" + col + ",TB_LINE,\"" + xq(line) + "\"" + (sub != null ? ",TB_SUB,\"" + xq(sub) + "\"" : "") + (ledger != null ? ",TB_LEDGER,\"" + xq(ledger) + "\"" : "") + "),2),0)";
      return C(sg * R0(raw), (sg < 0 ? "-" : "") + f);
    };
    const din = (n, label, rupees, group) => { const key = "D_" + nmOf(n), v = P(rupees); if (!M.inputs.find(z => z.nm === key)) M.inputs.push({nm: key, label, v, group: group || ""}); nm[key] = v; return C(v, key); };
    const dinN = (n, label, count, group) => { const key = "D_" + nmOf(n), v = Number(count) || 0; if (!M.inputs.find(z => z.nm === key)) M.inputs.push({nm: key, label, n: v, group: group || ""}); nm[key] = v; return {n: v, f: key}; };
    const ref = n => C(nm[n] != null ? nm[n] : 0, n);
    const Z = () => C(0, "0");
    // tables: cols [{h, n: numeric}], rows [{t: label, k: h|r|s|t|gt|blank|txt, c: [cells], ind}]
    const T = (cols, o) => Object.assign({cols, rows: []}, o || {});
    const row = (tb, t, c, k, ind) => { tb.rows.push({t, c, k: k || "r", ind: ind || 0}); return tb.rows.length - 1; };
    const sumRows = (tb, idx, col) => { const v = sum(idx, i => (tb.rows[i].c[col - 1] || {v: 0}).v || 0); return C(v, idx.length ? idx.map(i => "#R" + i + "#").join("+") : "0"); };
    const cols3 = pl => [{h: "Particulars"}, {h: pl ? D.cyYear : D.cyAsAt, n: 1}, {h: pl ? D.pyYear : D.pyAsAt, n: 1}];
    const note = (key, title, o) => { const n = Object.assign({key, title, tables: [], paras: [], lines: [], print: true}, o || {}); N.push(n); return n; };
    const nz = (...cs) => cs.some(c => c && c.v);

    // a note of a line: its sub-heads (grouped "Head|Row"), a Rounding Off row where the rows do not add to the face, the Total
    const stdTable = (lines, pl, o) => {
      o = o || {};
      const tb = T(cols3(pl)), idx = [], subs = [];
      lines.forEach(line => {
        const known = X.SUBS[line] || [], extra = Array.from(new Set(L.filter(x => x.line === line).map(x => x.sub))).filter(s => !known.includes(s));
        known.concat(extra).forEach(s => subs.push([line, s]));
      });
      let head = null, grp = [], groups = [];
      const flush = () => { if (grp.length && groups.length + 1 > 0 && o.subtotals) { const st = [sumRows(tb, grp, 1), sumRows(tb, grp, 2)]; groups.push(row(tb, "", st, "s")); } grp = []; };
      subs.forEach(([line, s]) => {
        const cy = tbSum("CY", line, s), py = tbSum("PY", line, s);
        if (!nz(cy, py)) return;
        const [h, r] = s.includes("|") ? s.split("|") : [null, s];
        if (h !== head){ if (head !== null) flush(); if (h) row(tb, h, [null, null], "h"); head = h; }
        const i = row(tb, r, [cy, py], "r", h ? 1 : 0); idx.push(i); grp.push(i);
      });
      flush();
      const total = [o.total ? o.total[0] : ref("L_" + lines[0] + "_CY"), o.total ? o.total[1] : ref("L_" + lines[0] + "_PY")];
      if (lines.length > 1 && !o.total) total.forEach((c, j) => { const y = j ? "PY" : "CY"; c.v = sum(lines, k => nm["L_" + k + "_" + y] || 0); c.f = lines.map(k => "L_" + k + "_" + y).join("+"); });
      const rs = [1, 2].map(j => { const s2 = sumRows(tb, idx, j); return C(total[j - 1].v - s2.v, "#T#-(" + s2.f + ")"); });
      if (rs.some(c => c.v)) idx.push(row(tb, "(+) Rounding Off", rs, "r"));
      row(tb, "Total", total.map(c => C(c.v, c.f)), "t");
      return tb;
    };
    const lineNote = (line, extraLines, o) => {
      const lines = [line].concat(extraLines || []);
      const any = lines.some(k => nm["L_" + k + "_CY"] || nm["L_" + k + "_PY"]);
      if (!any) return null;
      const n = note(line, X.line(line).title, {lines});
      n.tables.push(stdTable(lines, X.isPL(line), o));
      return n;
    };

    // 1 General Information
    const w = X.entWords(kind);
    const gi = note("gi", "General Information");
    if (co) gi.paras.push({t: "p", x: (ent.name || "") + " (the Company) is a " + (ent.private === false ? "public" : "private") + " limited company incorporated in India under the provisions of the Companies Act" + (ent.incorporated ? " on " + ent.incorporated : "") + ". Its registered office is at " + (ent.address || "") + ". The CIN of the Company is " + (ent.cin || "") + "." + (ent.business ? " " + ent.business : "")});
    else gi.paras.push({t: "p", x: (ent.name || "") + " (the " + (kind === "llp" ? "LLP" : kind === "proprietor" ? "Proprietorship" : "Firm") + "), is a " + (kind === "llp" ? "Limited Liability Partnership" : kind === "proprietor" ? "Proprietorship concern" : "Partnership") + ", whose registered address is " + (ent.address || "") + ". The PAN of the " + (kind === "llp" ? "LLP" : kind === "proprietor" ? "Proprietor" : "Firm") + " is " + (ent.pan || "") + "." + (ent.business ? " " + ent.business : "")});
    // 2 Significant Accounting Policies
    const sap = note("sap", "Significant Accounting Policies");
    const pol = X.policies(kind, (det.policies || {}).switches), edits = (det.policies || {}).text || {};
    pol.forEach(p => { sap.paras.push({t: "h", x: p.no + " " + p.title}); String(edits[p.no] != null ? edits[p.no] : fillE(p.text, kind)).split("\n").forEach(s => sap.paras.push({t: /^\(\w+\)/.test(s) ? "li" : "p", x: s})); });

    // ---------- the balance sheet notes, in the face's order
    // Share capital (company)
    if (co && (nm.L_share_CY || nm.L_share_PY)){
      const n = note("share", "Share Capital", {lines: ["share"]}), sh = det.shares || {};
      const iss = sh.issued || {}, cyN = dinN("sh_cy_n", "Equity shares at the end of the year (number)", (iss.cy || {}).n, "Share capital"), pyN = dinN("sh_py_n", "Equity shares at the end of the previous year (number)", (iss.py || {}).n, "Share capital");
      const cyFv = din("sh_cy_fv", "Face value of an equity share (" + D.cyAsAt + ")", (iss.cy || {}).fv, "Share capital"), pyFv = din("sh_py_fv", "Face value of an equity share (" + D.pyAsAt + ")", (iss.py || {}).fv, "Share capital");
      const ta = T(cols3(false));
      row(ta, "Authorised", [null, null], "h");
      (sh.authorised || []).forEach((a, i) => { const an = dinN("sh_auth_n_" + i, "Authorised shares (number), row " + (i + 1), a.n, "Share capital"), af = din("sh_auth_fv_" + i, "Authorised face value, row " + (i + 1), a.fv, "Share capital");
        const v = C(Math.round(an.n * af.v), an.f + "*" + af.f); row(ta, an.n.toLocaleString("en-IN") + " " + (a.cls || "Equity") + " shares of ₹ " + rs(af.v) + " each", [v, C(v.v, v.f)], "r", 1); });
      row(ta, "Issued, subscribed and fully paid up", [null, null], "h");
      const paid = [ref("L_share_CY"), ref("L_share_PY")];
      row(ta, cyN.n.toLocaleString("en-IN") + " Equity shares of ₹ " + rs(cyFv.v) + " each" + (pyN.n !== cyN.n || pyFv.v !== cyFv.v ? " (" + D.pyAsAt + ": " + pyN.n.toLocaleString("en-IN") + " shares of ₹ " + rs(pyFv.v) + " each)" : ""), paid, "r", 1);
      row(ta, "Total", [ref("L_share_CY"), ref("L_share_PY")], "t");
      n.tables.push(ta); n.share = {cyN, pyN, cyFv, pyFv};
      // (b) reconciliation of the number of shares
      const rc = T([{h: "Particulars"}, {h: D.cyAsAt + " No. of Shares", n: 2}, {h: "Amount", n: 1}, {h: D.pyAsAt + " No. of Shares", n: 2}, {h: "Amount", n: 1}], {title: "(b) Reconciliation of the number of Equity Shares outstanding"});
      const isd = sh.issuedDuring || {}, bb = sh.reduced || {};
      const inC = dinN("sh_add_cy", "Shares issued during the year (number)", (isd.cy || {}).n, "Share capital"), inP = dinN("sh_add_py", "Shares issued during the previous year (number)", (isd.py || {}).n, "Share capital");
      const outC = dinN("sh_less_cy", "Shares bought back or reduced during the year (number)", (bb.cy || {}).n, "Share capital"), outP = dinN("sh_less_py", "Shares bought back or reduced during the previous year (number)", (bb.py || {}).n, "Share capital");
      const begC = {n: cyN.n - inC.n + outC.n, f: cyN.f + "-" + inC.f + "+" + outC.f}, begP = {n: pyN.n - inP.n + outP.n, f: pyN.f + "-" + inP.f + "+" + outP.f};
      const nc = c => ({v: c.n, f: c.f, cnt: 1}), am = (c, fv) => C(Math.round(c.n * fv.v), "(" + c.f + ")*" + fv.f);
      row(rc, "Shares outstanding at the beginning of the year", [nc(begC), am(begC, cyFv), nc(begP), am(begP, pyFv)]);
      row(rc, "Add: Shares issued during the year", [nc(inC), am(inC, cyFv), nc(inP), am(inP, pyFv)]);
      row(rc, "Less: Shares bought back / other deductions", [nc(outC), am(outC, cyFv), nc(outP), am(outP, pyFv)]);
      row(rc, "Shares outstanding at the end of the year", [nc(cyN), am(cyN, cyFv), nc(pyN), am(pyN, pyFv)], "t");
      n.tables.push(rc);
      n.paras.push({t: "h", x: "(c) Rights, preferences and restrictions attached to shares"}, {t: "p", x: sh.rights || "The Company has only one class of equity shares having a par value as stated above. Each holder of equity shares is entitled to one vote per share. In the event of liquidation, the equity shareholders are eligible to receive the remaining assets of the Company after distribution of all preferential amounts, in proportion to their shareholding."});
      const holdT = (title, list, promo) => {
        const t = T([{h: promo ? "Promoter Name" : "Name of Shareholder"}, {h: D.cyAsAt + " No. of Shares", n: 2}, {h: "% of holding", n: 3}, {h: D.pyAsAt + " No. of Shares", n: 2}, {h: "% of holding", n: 3}].concat(promo ? [{h: "% Change during the year", n: 3}] : []), {title});
        let a = 0, b = 0; const idx = [], kk = promo ? "pr" : "h5";
        const pcF = (col, base) => "IF(" + base.f + "=0,0,#C" + col + "#/" + base.f + ")";
        (list || []).forEach((h, i) => { const c1 = dinN("sh_" + kk + "_cy_" + i, (promo ? "Promoter " : "Shareholder over 5% ") + h.name + ": shares held (" + D.cyAsAt + ")", +h.cy || 0, "Share capital"), c2 = dinN("sh_" + kk + "_py_" + i, (promo ? "Promoter " : "Shareholder over 5% ") + h.name + ": shares held (" + D.pyAsAt + ")", +h.py || 0, "Share capital");
          const pc = cyN.n ? c1.n / cyN.n : 0, pp = pyN.n ? c2.n / pyN.n : 0; a += c1.n; b += c2.n;
          idx.push(row(t, h.name, [{v: c1.n, cnt: 1, f: c1.f}, {v: pc, pc: 1, f: pcF(1, cyN)}, {v: c2.n, cnt: 1, f: c2.f}, {v: pp, pc: 1, f: pcF(3, pyN)}].concat(promo ? [{v: pp ? (pc - pp) / pp : 0, pc: 1, f: "IF(#C4#=0,0,(#C2#-#C4#)/#C4#)"}] : []))); });
        const sc = j => ({v: sum(idx, i => t.rows[i].c[j - 1].v), cnt: 1, f: idx.length ? idx.map(i => "#R" + i + "#").join("+") : "0"});
        row(t, "Total", [sc(1), {v: cyN.n ? a / cyN.n : 0, pc: 1, f: pcF(1, cyN)}, sc(3), {v: pyN.n ? b / pyN.n : 0, pc: 1, f: pcF(3, pyN)}].concat(promo ? [null] : []), "t");
        return t;
      };
      n.tables.push(holdT("(d) Shareholders holding more than 5% of the shares", sh.holders5, false));
      n.paras.push({t: "h", x: "(e) Details for the period of five years immediately preceding the date of the balance sheet"},
        {t: "p", x: "a) Aggregate number and class of shares allotted as fully paid up pursuant to contract(s) without payment being received in cash: " + ((sh.fiveYear || {}).nonCash || "Nil") + "."},
        {t: "p", x: "b) Aggregate number and class of shares allotted as fully paid up by way of bonus shares: " + ((sh.fiveYear || {}).bonus || "Nil") + "."},
        {t: "p", x: "c) Aggregate number and class of shares bought back: " + ((sh.fiveYear || {}).buyback || "Nil") + "."},
        {t: "h", x: "(f) Other details"}, {t: "p", x: sh.other || "There are no securities convertible into equity shares, no calls unpaid and no forfeited shares."});
      n.tables.push(holdT("(g) Shares held by Promoters at the end of the year", sh.promoters, true));
      n.tables[n.tables.length - 1].after = "paras";
    }
    // Partners' capital and current accounts (firm, LLP) or the proprietor's capital
    const partnerNote = (key, list) => {
      const ttl = kind === "proprietor" ? "Proprietor's Capital Account" : X.line(key).title;
      const n = note(key, ttl, {lines: [key]});
      const t = T([{h: kind === "proprietor" ? "Name of Proprietor" : "Name of Partner"}, {h: "Share (%)", n: 4}, {h: "Opening Balance", n: 1}, {h: "Capital Introduced", n: 1}, {h: "Remuneration", n: 1}, {h: "Interest", n: 1}, {h: "Withdrawal", n: 1}, {h: "Profit/Loss", n: 1}, {h: "Closing Balance", n: 1}]);
      const cyRows = list.filter(r => r.y === "CY"), pyRows = list.filter(r => r.y === "PY"), idx = [];
      const shareIn = (r, y) => { const d2 = dinN("p_share_" + r.i + "_" + y, "Partner " + r.name + ": share of profit (%)" + (y === "py" ? ", previous year" : ""), r.share, "Partners"); return {v: d2.n, sh: 1, f: d2.f}; };
      cyRows.forEach(r => { const cs = [shareIn(r, "cy"), r.open, r.intro, r.rem, r.int, r.wd, r.profit]; const close = C(sum(cs.slice(1), c => c.v), "SUM(#C2#:#C7#)"); r.close = close;
        idx.push(row(t, r.name, cs.concat([close]))); });
      const tc = [1, 2, 3, 4, 5, 6, 7, 8].map(j => j === 1 ? {v: sum(cyRows, r => r.share), sh: 1, f: idx.map(i => "#R" + i + "#").join("+") || "0"} : sumRows(t, idx, j));
      named(tc[7], "N_" + key + "_CY");
      row(t, "Current Year", tc, "t");
      const py = [1, 2, 3, 4, 5, 6, 7, 8].map(j => {
        if (j === 1){ const ps = pyRows.map(r => shareIn(r, "py")); return {v: sum(ps, z => z.v), sh: 1, f: ps.map(z => z.f).join("+") || "0"}; }
        const k = ["", "", "open", "intro", "rem", "int", "wd", "profit"][j];
        if (j === 8){ const v = sum(pyRows, r => r.open.v + r.intro.v + r.rem.v + r.int.v + r.wd.v + r.profit.v); return C(v, "SUM(#C2#:#C7#)"); }
        return C(sum(pyRows, r => r[k].v), pyRows.map(r => "(" + r[k].f + ")").join("+") || "0");
      });
      named(py[7], "N_" + key + "_PY");
      row(t, "Previous Year", py, "t");
      n.tables.push(t);
      face[key + "_CY"].f = "N_" + key + "_CY"; face[key + "_PY"].f = "N_" + key + "_PY";
      return n;
    };
    if (firm && M.partners.length){ partnerNote("capital", M.pAcc.cap); if (M.pAcc.cur.length) partnerNote("current", M.pAcc.cur); }
    else if (firm){ lineNote("capital"); lineNote("current"); }
    // Reserves and Surplus
    {
      const R = M.res, any = nm.L_reserves_CY || nm.L_reserves_PY || firm || ["Securities Premium", "General Reserve", "Other Reserves"].some(s => R.CY[s].open.v || R.CY[s].close.v);
      if (any){
        const n = note("reserves", "Reserves and Surplus", {lines: ["reserves"], nil: !(nm.L_reserves_CY || nm.L_reserves_PY)});
        const t = T(cols3(false)), idx = [];
        ["Securities Premium", "General Reserve", "Other Reserves"].forEach(s => {
          if (!nz(R.CY[s].open, R.CY[s].add, R.CY[s].ded, R.PY[s].open, R.PY[s].add, R.PY[s].ded)) return;
          row(t, s, [null, null], "h");
          const a = row(t, "Opening Balance", [R.CY[s].open, R.PY[s].open], "r", 1), b = row(t, "(+) Additions during the year", [R.CY[s].add, R.PY[s].add], "r", 1), c = row(t, "(-) Deductions during the year", [R.CY[s].ded, R.PY[s].ded], "r", 1);
          idx.push(row(t, "", [C(R.CY[s].close.v, "#R" + a + "#+#R" + b + "#-#R" + c + "#"), C(R.PY[s].close.v, "#R" + a + "#+#R" + b + "#-#R" + c + "#")], "s"));
          n["prem_" + s] = {a, b, c};
        });
        row(t, "Surplus in Statement of Profit and Loss", [null, null], "h");
        const s1 = [row(t, "Opening Balance", [R.CY.sOpen, R.PY.sOpen], "r", 1), row(t, "(+) Net Profit or (Loss) for the period", [R.CY.profit, R.PY.profit], "r", 1)];
        if (R.CY.adj.v || R.PY.adj.v) s1.push(row(t, R.CY.adjCaption || R.PY.adjCaption || "", [R.CY.adj, R.PY.adj], "r", 1));
        if (firm) s1.push(row(t, "(-) Transfer to Partners' Current Account", [R.CY.transfer, R.PY.transfer], "r", 1));
        const sub1 = [sumRows(t, s1, 1), sumRows(t, s1, 2)]; idx.push(row(t, "", sub1, "s"));
        const tot = [ref("L_reserves_CY"), ref("L_reserves_PY")];
        const rr = [1, 2].map(j => { const s2 = sumRows(t, idx, j); return C(tot[j - 1].v - s2.v, "#T#-(" + s2.f + ")"); });
        row(t, "(+) Rounding Off", rr, "r");
        R.CY.round.v = rr[0].v; R.PY.round.v = rr[1].v;
        row(t, "Total", tot, "t");
        n.tables.push(t); n.adjRow = s1.length > 2 && !firm ? s1[2] : null;
      }
    }
    // Borrowings: the note, then the repayment terms and the nature of security (details for you)
    const loanTables = (n, line) => {
      const loans = (det.loans || []).filter(x => (x.table || "") === line || (!x.table && (L.find(z => z.l === x.ledger) || {}).line === line));
      const t = T([{h: "Description of Borrowing"}, {h: "Interest rate"}, {h: "Amount Outstanding", n: 1}, {h: "Repayment Terms"}], {title: "Repayment Terms for " + (line === "ltb" ? "long-term" : "short-term") + " borrowings"});
      const idx = [];
      loans.forEach(x => { const lz = L.find(z => z.l === x.ledger); const c = lz ? tbSum("CY", lz.line, null, x.ledger) : C(0, "0");
        idx.push(row(t, x.desc || x.ledger, [String(x.rate == null ? "" : (Number(x.rate) < 1 && Number(x.rate) > 0 ? x.rate : Number(x.rate).toFixed(2) + "%")), c, x.terms || ""])); });
      if (!loans.length) return;
      row(t, "Total", [null, sumRows(t, idx, 2), null], "t");
      t.loanTable = line; n.tables.push(t);
      const sec = loans.filter(x => x.secured || (L.find(z => z.l === x.ledger) || {sub: ""}).sub.startsWith("Secured"));
      if (sec.length){ const s = T([{h: "Description of Borrowing"}, {h: "Nature of Security"}], {title: "Nature of security for " + (line === "ltb" ? "long-term" : "short-term") + " secured borrowings"}); sec.forEach(x => row(s, x.desc || x.ledger, [x.security || ""])); n.tables.push(s); }
    };
    const order = co ? ["reserves:done", "ltb", "dtl", "oltl", "ltp", "stb", "tp", "ocl", "stp"] : ["ltb", "dtl", "oltl", "ltp", "stb", "tp", "ocl", "stp"];
    order.forEach(k => {
      if (k.includes(":")) return;
      const n = lineNote(k);
      if (!n) return;
      if (k === "ltb" || k === "stb") loanTables(n, k);
      if (k === "tp") ageNote(n, "tp");
    });
    function ageNote(n, which){
      if (firm) return;                     // the firm's format has no ageing table (Sample A)
      const A = (M.age || {})[which] || ((M.inpAge || {})[which]);
      if (!A) { n.paras.push({t: "p", x: "Ageing: to be given (Details for you)."}); n.ageMissing = true; return; }
      const head = which === "tp" ? ["Unbilled", "Not Due", "Less than 1 year", "1-2 years", "2-3 years", "More than 3 years"] : ["Not Due", "Less than 6 months", "6 months - 1 year", "1-2 years", "2-3 years", "More than 3 years"];
      const rowsN = which === "tp" ? [["msme", "MSME"], ["others", "Others"], ["dmsme", "Disputed dues - MSME"], ["dothers", "Disputed dues - Others"]] : [["ug", "Undisputed - Considered Good"], ["ud", "Undisputed - Considered doubtful"], ["dg", "Disputed - Considered Good"], ["dd", "Disputed - Considered doubtful"]];
      ["cy", "py"].forEach(y => {
        const t = T([{h: "Particulars"}].concat(head.map(h => ({h, n: 1}))).concat([{h: "Total", n: 1}]), {title: (which === "tp" ? "Trade Payables" : "Trade Receivables") + " ageing schedule " + (y === "cy" ? D.cyAsAt : D.pyAsAt) + " (Outstanding for following periods from due date of payment)", ageing: which, y});
        const idx = [];
        rowsN.forEach(([k, lab], ri) => { const b = ((A[y] || {})[k] || []); const cs = head.map((h, j) => din("age_" + which + "_" + y + "_" + k + "_" + j, lab + ", " + h + " (" + (y === "cy" ? D.cyAsAt : D.pyAsAt) + ")", b[j] || 0, which === "tp" ? "Trade payables ageing" : "Trade receivables ageing"));
          idx.push(row(t, lab, cs.concat([C(sum(cs, c => c.v), "SUM(#C1#:#C" + head.length + "#)")]))); });
        row(t, "Total", head.map((h, j) => sumRows(t, idx, j + 1)).concat([sumRows(t, idx, head.length + 1)]), "t");
        n.tables.push(t);
      });
    }
    // PPE and intangible assets: the fixed asset register (company) or the income-tax blocks (firm)
    if (["ppe", "intang", "cwip"].some(k => nm["L_" + k + "_CY"] || nm["L_" + k + "_PY"])){
      // a company, or a non-corporate entity whose books follow its own policy (the fixed asset register, 80-assets.js):
      // the gross-block schedule; otherwise (books at the Income-tax rates) the block schedule
      if (co || det.depBasis === "sch2" || det.depBasis === "own"){
        const n = note("ppe", "Property, Plant and Equipment and Intangible Assets", {lines: ["ppe", "intang", "cwip"], landscape: true});
        const far = det.far || {}, hdr = ["As at " + "opening", "Additions", "Deductions", "As at closing", "As at opening", "For the year", "On Deductions", "As at closing", "As at closing", "As at opening"];
        ["cy", "py"].forEach(y => {
          const end = y === "cy" ? D.cyAsAt.replace("As at ", "") : D.pyAsAt.replace("As at ", ""), beg = y === "cy" ? "April 01, " + M.fy : "April 01, " + (Number(M.fy) - 1);
          const t = T([{h: "Particulars"}].concat(["As at " + beg, "Additions", "Deductions", "As at " + end, "As at " + beg, "For the year", "On Deductions", "As at " + end, "As at " + end, "As at " + beg].map(h => ({h, n: 1}))),
            {title: "for '" + (y === "cy" ? "Current period" : "Previous period") + "'", bands: [["", 1], ["Gross Block", 4], ["Depreciation and Amortisation", 4], ["Net Book Value", 2]], far: y});
          const list = (far[y] || null);
          const groups = [["ppe", "A. Property, Plant and Equipment"], ["intang", "B. Intangible Assets"], ["cwip", "C. Capital Work-in-Progress"]];
          let gi2 = 0; const tots = [];
          groups.forEach(([line, lab]) => {
            let items = list ? list.filter(x => (x.line || "ppe") === line) : null;
            if (!items){
              // no register: each class from the ledgers (written down value), depreciation not known
              const subs = Array.from(new Set(L.filter(x => x.line === line).map(x => x.sub)));
              items = subs.map(s => ({cls: s, fromTb: true}));
            }
            if (!items.length) return;
            row(t, (gi2 === 0 ? "" : "") + n.key.replace("ppe", "") + lab, new Array(10).fill(null), "h"); gi2++;
            const idx = [];
            items.forEach((x, i) => {
              let g;
              if (x.fromTb){ const o = tbSum(y === "cy" ? "O" : "PO", line, x.cls), cy = tbSum(y === "cy" ? "CY" : "PY", line, x.cls), dd = tbSum(y === "cy" ? "D" : "PD", line, x.cls), cc = tbSum(y === "cy" ? "C" : "PC", line, x.cls);
                g = [o, dd, cc, cy, Z(), Z(), Z(), Z()]; n.farFromTb = true; }
              else { const k = "far_" + y + "_" + line + "_" + i, lab2 = x.cls + " (" + (y === "cy" ? "current" : "previous") + " period): ";
                g = [din(k + "_go", lab2 + "gross block at the start", x.gOpen, "Fixed asset register"), din(k + "_ga", lab2 + "additions", x.gAdd, "Fixed asset register"), din(k + "_gd", lab2 + "deductions", x.gDel, "Fixed asset register"), null,
                  din(k + "_do", lab2 + "depreciation at the start", x.dOpen, "Fixed asset register"), din(k + "_dy", lab2 + "depreciation for the year", x.dYear, "Fixed asset register"), din(k + "_dd", lab2 + "depreciation on deductions", x.dDel, "Fixed asset register"), null];
                g[3] = C(g[0].v + g[1].v - g[2].v, "#C1#+#C2#-#C3#"); g[7] = C(g[4].v + g[5].v - g[6].v, "#C5#+#C6#-#C7#"); }
              const nb = C(g[3].v - g[7].v, "#C4#-#C8#"), nbo = C(g[0].v - g[4].v, "#C1#-#C5#");
              idx.push(row(t, x.cls, g.concat([nb, nbo]), "r", 1));
            });
            const tr = row(t, "Total", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => sumRows(t, idx, j)), "s");
            tots.push(tr);
            t.rows[tr].line = line;
          });
          if (tots.length > 1) row(t, "Total", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => sumRows(t, tots, j)), "t"); else if (tots.length) t.rows[tots[0]].k = "t";
          n.tables.push(t);
        });
      } else {
        // the income-tax blocks (Sample A, Note 10)
        const n = note("ppe", "Income Tax Block of Property, Plant and Equipment and Intangible Assets", {lines: ["ppe", "intang", "cwip"], landscape: true, itBlock: true});
        const t = T([{h: "Asset Block"}, {h: "Opening WDV", n: 1}, {h: "More than 180 days", n: 1}, {h: "Less than 180 days", n: 1}, {h: "Sale Value", n: 1}, {h: "STCL/(STCG)", n: 1}, {h: "Rate", n: 4}, {h: "Amount", n: 1}, {h: "Rate", n: 4}, {h: "Amount", n: 1}, {h: "Closing WDV", n: 1}],
          {bands: [["", 2], ["Additions", 2], ["Deductions", 2], ["Depreciation", 2], ["Additional Depreciation", 2], ["", 1]]});
        const blocks = (det.itBlocks || {});
        const mk = (y) => (blocks[y] || []).map((b, i) => {
          const k = "it_" + y + "_" + i, lab = b.block + " (" + (y === "cy" ? "current" : "previous") + " year): ";
          const o = din(k + "_o", lab + "opening WDV", b.open, "Income-tax blocks"), a1 = din(k + "_a1", lab + "additions put to use 180 days or more", b.addGt180, "Income-tax blocks"), a2 = din(k + "_a2", lab + "additions put to use less than 180 days", b.addLt180, "Income-tax blocks"),
            sv = din(k + "_s", lab + "sale value", b.sale, "Income-tax blocks"), st = din(k + "_st", lab + "short-term capital loss / (gain)", b.stcg, "Income-tax blocks");
          const rate = Number(b.rate) || 0, ar = Number(b.addlRate) || 0, rIn = dinN(k + "_rate", lab + "rate of depreciation (%)", rate, "Income-tax blocks"), aIn = dinN(k + "_arate", lab + "rate of additional depreciation (%)", ar, "Income-tax blocks");
          const base1 = o.v + a1.v - sv.v, b2 = Math.max(0, a2.v + Math.min(0, base1));
          // the fixed asset register (src/js/80-assets.js) gives the additions eligible for additional depreciation (section
          // 32(1)(iia)) and the half brought forward from last year; a block with a short-term capital gain or loss (section
          // 50: a negative block, or a block emptied) gets no depreciation and closes at nil. Typed rows without these work as before.
          const reg = b.addlGt180 != null || b.addlLt180 != null || b.addlBf != null, ceased = st.v !== 0, nw = reg || ceased;
          const e1 = reg ? din(k + "_e1", lab + "additions eligible for additional depreciation, 180 days or more", b.addlGt180 || 0, "Income-tax blocks") : a1,
            e2 = reg ? din(k + "_e2", lab + "additions eligible for additional depreciation, less than 180 days", b.addlLt180 || 0, "Income-tax blocks") : a2,
            bf = reg ? din(k + "_bf", lab + "additional depreciation brought forward (section 32(1)(iia))", b.addlBf || 0, "Income-tax blocks") : null;
          const e1f = reg ? e1.f : "#C2#", e2f = reg ? e2.f : "#C3#", bff = reg ? bf.f : "0";
          const depF = "ROUND(MAX(0,#C1#+#C2#-#C4#)*#C6#/100+MAX(0,#C3#+MIN(0,#C1#+#C2#-#C4#))*#C6#/200,0)";
          const dep = ceased ? C(0, "IF(#C5#<>0,0," + depF + ")") : C(R0(Math.max(0, base1) * rate / 100 + b2 * rate / 200), nw ? "IF(#C5#<>0,0," + depF + ")" : depF);
          const addl = !nw ? C(R0(a1.v * ar / 100 + a2.v * ar / 200), "ROUND(#C2#*#C8#/100+#C3#*#C8#/200,0)")
            : C(ceased ? 0 : Math.max(0, Math.min(o.v + a1.v + a2.v - sv.v - dep.v, R0(e1.v * ar / 100 + e2.v * ar / 200) + (bf ? bf.v : 0))),
              "IF(#C5#<>0,0,MAX(0,MIN(#C1#+#C2#+#C3#-#C4#-#C7#,ROUND(" + e1f + "*#C8#/100+" + e2f + "*#C8#/200,0)+" + bff + ")))");
          const close = !nw ? C(o.v + a1.v + a2.v - sv.v - dep.v - addl.v, "#C1#+#C2#+#C3#-#C4#-#C7#-#C9#") : C(o.v + a1.v + a2.v - sv.v - st.v - dep.v - addl.v, "#C1#+#C2#+#C3#-#C4#-#C5#-#C7#-#C9#");
          return {b: b.block, cells: [o, a1, a2, sv, st, {v: rate, rt: 1, f: rIn.f}, dep, {v: ar, rt: 1, f: aIn.f}, addl, close], nw, e1f: reg ? e1f : null, e2f: reg ? e2f : null, bff: reg ? bff : null};
        });
        const cyR = mk("cy"), pyR = mk("py"), idx = [];
        cyR.forEach(r => idx.push(row(t, r.b, r.cells)));
        const ct = row(t, "Current Year Total", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => j === 6 || j === 8 ? null : sumRows(t, idx, j)), "t");
        // the previous year's blocks are not printed row by row; their totals are, worked out from the Details cells
        const pf = (r, j) => { const c = r.cells, nmf = k => c[k].f, rate = nmf(5), ar = nmf(7), b1 = "(" + nmf(0) + "+" + nmf(1) + "-" + nmf(3) + ")";
          let dep = "ROUND(MAX(0," + b1 + ")*" + rate + "/100+MAX(0," + nmf(2) + "+MIN(0," + b1 + "))*" + rate + "/200,0)", addl = "ROUND(" + nmf(1) + "*" + ar + "/100+" + nmf(2) + "*" + ar + "/200,0)";
          if (r.nw){ const st = nmf(4), tot = "(" + nmf(0) + "+" + nmf(1) + "+" + nmf(2) + "-" + nmf(3) + ")"; dep = "IF(" + st + "<>0,0," + dep + ")";
            addl = "IF(" + st + "<>0,0,MAX(0,MIN(" + tot + "-" + dep + ",ROUND(" + (r.e1f || nmf(1)) + "*" + ar + "/100+" + (r.e2f || nmf(2)) + "*" + ar + "/200,0)+" + (r.bff || "0") + ")))";
            return j === 6 ? dep : j === 8 ? addl : j === 9 ? "(" + tot + "-" + st + "-" + dep + "-" + addl + ")" : nmf(j); }
          return j === 6 ? dep : j === 8 ? addl : j === 9 ? "(" + nmf(0) + "+" + nmf(1) + "+" + nmf(2) + "-" + nmf(3) + "-" + dep + "-" + addl + ")" : nmf(j); };
        const pt = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(j => j === 5 || j === 7 ? null : C(sum(pyR, r => r.cells[j].v), pyR.length ? pyR.map(r => pf(r, j)).join("+") : "0"));
        n.pyBlocks = pyR; n.cyBlocks = cyR;
        row(t, "Previous Year Total", pt, "t");
        t.itTotals = {cy: ct};
        n.tables.push(t);
        // no register of blocks: say so; the face is from the books
        if (!cyR.length) n.paras.push({t: "p", x: "The block-wise working is to be given (Details for you)."});
      }
    }
    // the other balance sheet notes, in the face's order
    ["nci", "dta", "ltla", "onca", "ci", "inv", "tr", "cash", "stla", "oca"].forEach(k => {
      if (k === "inv"){
        if (!(nm.L_inv_CY || nm.L_inv_PY)) return;
        const n = note("inv", "Inventories", {lines: ["inv"]}), t = T(cols3(false)), idx = [];
        X.SUBS.inv.forEach(s => { const c = M.stockCls[s]; if (c.close.v || c.pyClose.v) idx.push(row(t, s, [C(c.close.v, c.close.f), C(c.pyClose.v, c.pyClose.f)])); });
        row(t, "Total", [ref("L_inv_CY"), ref("L_inv_PY")], "t"); n.tables.push(t); return;
      }
      const n = lineNote(k, null, k === "cash" ? {subtotals: true} : null);
      if (!n) return;
      if (k === "tr") ageNote(n, "tr");
      if (k === "nci"){ const unq = [tbSum("CY", "nci", "Unquoted|Investments in Equity Instruments"), tbSum("PY", "nci", "Unquoted|Investments in Equity Instruments")];
        const t = T(cols3(false)); row(t, "Aggregate amount of unquoted investments", [C(unq[0].v + tbSum("CY", "nci", "Unquoted|Other investments").v, unq[0].f + "+" + tbSum("CY", "nci", "Unquoted|Other investments").f), C(unq[1].v + tbSum("PY", "nci", "Unquoted|Other investments").v, unq[1].f + "+" + tbSum("PY", "nci", "Unquoted|Other investments").f)]); n.tables.push(t); }
      if (k === "stla" && co){
        const rl = det.rpLoans || [], t = T([{h: "Type of Borrower"}, {h: D.cyAsAt + " Amount outstanding", n: 1}, {h: "% of Total", n: 3}, {h: D.pyAsAt + " Amount outstanding", n: 1}, {h: "% of Total", n: 3}], {title: "Loans and advances repayable on demand or granted without specifying any terms or period of repayment", rpLoans: 1});
        const totC = nm.L_stla_CY || 0, totP = nm.L_stla_PY || 0;
        [["demand", "Repayable on demand"], ["noterms", "Without specifying any terms or period of repayment"]].forEach(([b, lab]) => {
          row(t, lab, [null, null, null, null], "h"); const idx = [];
          ["Promoters", "Directors", "KMPs", "Related Parties"].forEach(ty => {
            const leds = rl.filter(x => (x.basis || "demand") === b && x.type === ty).map(x => x.ledger);
            const cy = C(R0(sum(L.filter(x => leds.includes(x.l)), x => x.cy)), leds.length ? "ROUND(ROUND(" + leds.map(l => "SUMIFS(TB_CY,TB_LEDGER,\"" + xq(l) + "\")").join("+") + ",2),0)" : "0");
            const py = C(R0(sum(L.filter(x => leds.includes(x.l)), x => x.py)), leds.length ? "ROUND(ROUND(" + leds.map(l => "SUMIFS(TB_PY,TB_LEDGER,\"" + xq(l) + "\")").join("+") + ",2),0)" : "0");
            idx.push(row(t, ty, [cy, {v: totC ? cy.v / totC : 0, pc: 1, f: "IF(L_stla_CY=0,0,#C1#/L_stla_CY)"}, py, {v: totP ? py.v / totP : 0, pc: 1, f: "IF(L_stla_PY=0,0,#C3#/L_stla_PY)"}], "r", 1));
          });
          row(t, "Total", [sumRows(t, idx, 1), null, sumRows(t, idx, 3), null], "s");
        });
        n.tables.push(t);
      }
    });

    // ---------- the profit and loss notes
    lineNote("rev"); lineNote("oth");
    // cost of materials consumed: opening, purchases, carriage, movements booked, closing
    if (nm.L_mat_CY || nm.L_mat_PY){
      const n = note("mat", "Cost of Materials Consumed", {lines: ["mat"]}), t = T(cols3(true)), S = M.stockCls, RM = ["Raw Materials", "Stores and Spares"];
      const agg = (y, k) => { const cs = RM.map(c => S[c][k]); return C(sum(cs, c => c.v), cs.map(c => "(" + c.f + ")").join("+")); };
      const idx = [row(t, "Opening Stock of Raw materials", [agg("cy", "open"), agg("py", "pyOpen")]), row(t, "(+) Purchase", [tbSum("CY", "mat", "Purchase"), tbSum("PY", "mat", "Purchase")]), row(t, "(+) Carriage Inward", [tbSum("CY", "mat", "Carriage Inward"), tbSum("PY", "mat", "Carriage Inward")])];
      const extraSubs = Array.from(new Set(L.filter(x => x.line === "mat" && !["Purchase", "Carriage Inward"].includes(x.sub)).map(x => x.sub)));
      extraSubs.forEach(s => idx.push(row(t, "(+) " + s, [tbSum("CY", "mat", s), tbSum("PY", "mat", s)])));
      const mv = [agg("cy", "ledMove"), agg("py", "pyMove")]; if (mv[0].v || mv[1].v) idx.push(row(t, "(+) Stock movements booked in the books", mv));
      const cl = [agg("cy", "close"), agg("py", "pyClose")]; idx.push(row(t, "(-) Closing Stock", [C(-cl[0].v, "-(" + cl[0].f + ")"), C(-cl[1].v, "-(" + cl[1].f + ")")]));
      const st = [sumRows(t, idx, 1), sumRows(t, idx, 2)]; const si = row(t, "", st, "s");
      const tot = [ref("L_mat_CY"), ref("L_mat_PY")], rr = tot.map((c, j) => C(c.v - st[j].v, "#T#-#R" + si + "#"));
      if (rr.some(c => c.v)) row(t, "(+) Rounding Off", rr); row(t, "Total", tot, "t"); n.tables.push(t);
    }
    lineNote("pur");
    if (nm.L_chg_CY || nm.L_chg_PY){
      const n = note("chg", X.line("chg").title, {lines: ["chg"]}), t = T(cols3(true)), S = M.stockCls, FG = ["Work-in-progress", "Finished Goods", "Stock-in-trade"];
      const agg = k => { const cs = FG.map(c => S[c][k]); return C(sum(cs, c => c.v), cs.map(c => "(" + c.f + ")").join("+")); };
      const o = [agg("open"), agg("pyOpen")], c = [agg("close"), agg("pyClose")], mv = [agg("ledMove"), agg("pyMove")];
      const a = row(t, "Opening Inventories (" + FG.filter(k => S[k].open.v || S[k].close.v || S[k].pyClose.v).join(", ") + ")", o), b = row(t, "Closing Inventories", c);
      const rows2 = [a]; let m2 = null; if (mv[0].v || mv[1].v) m2 = row(t, "Stock movements booked in the books", mv);
      const st = [0, 1].map(j => C(o[j].v + (mv[j].v) - c[j].v, "#R" + a + "#" + (m2 != null ? "+#R" + m2 + "#" : "") + "-#R" + b + "#")); const si = row(t, "", st, "s");
      const tot = [ref("L_chg_CY"), ref("L_chg_PY")], rr = tot.map((x, j) => C(x.v - st[j].v, "#T#-#R" + si + "#"));
      if (rr.some(x => x.v)) row(t, "(+) Rounding Off", rr); row(t, "Total", tot, "t"); n.tables.push(t);
    }
    lineNote("emp"); lineNote("fin"); lineNote("dep");
    // other expenses: the fixed list (company) or under sub-heads (firm), with the auditor's remuneration box
    if (nm.L_exp_CY || nm.L_exp_PY){
      const n = note("exp", "Other Expenses", {lines: ["exp"]}), t = T(cols3(true)), idx = [];
      const subs = X.EXP_HEADS.concat(Array.from(new Set(L.filter(x => x.line === "exp" && !X.EXP_HEADS.includes(x.sub)).map(x => x.sub))));
      if (firm){
        X.EXP_GROUPS.slice(1).forEach(g => {
          const mine = subs.filter(s => (X.EXP_GROUP[s] || "Miscellaneous & Other Expenses") === g).filter(s => nz(tbSum("CY", "exp", s), tbSum("PY", "exp", s)));
          if (!mine.length) return;
          row(t, g, [null, null], "h"); const gi3 = [];
          mine.forEach(s => { const i = row(t, s, [tbSum("CY", "exp", s), tbSum("PY", "exp", s)], "r", 1); gi3.push(i); idx.push(i); });
          row(t, "", [sumRows(t, gi3, 1), sumRows(t, gi3, 2)], "s");
        });
      } else subs.forEach(s => { const cy = tbSum("CY", "exp", s), py = tbSum("PY", "exp", s); if (nz(cy, py)) idx.push(row(t, s, [cy, py])); });
      const tot = [ref("L_exp_CY"), ref("L_exp_PY")], rr = [1, 2].map(j => { const s2 = sumRows(t, idx, j); return C(tot[j - 1].v - s2.v, "#T#-(" + s2.f + ")"); });
      if (rr.some(c => c.v)) row(t, "(+) Rounding Off", rr);
      row(t, "Total", tot, "t"); n.tables.push(t);
      const ar = det.auditorRem || {};
      if (ar.statutory != null || ar.tax != null || ar.other != null){
        const b = T(cols3(true), {title: "Auditor's Remuneration includes", box: 1, auditorRem: 1}), bi = [];
        [["statutory", "Statutory audit fees"], ["tax", "Tax audit fees"], ["other", "Other services"]].forEach(([k, lab]) => { if (ar[k] == null && !(ar.py || {})[k]) return; bi.push(row(b, lab, [din("arem_cy_" + k, "Auditor's remuneration: " + lab, ar[k], "Auditor's remuneration"), din("arem_py_" + k, "Auditor's remuneration (previous year): " + lab, (ar.py || {})[k], "Auditor's remuneration")])); });
        row(b, "Total", [sumRows(b, bi, 1), sumRows(b, bi, 2)], "t"); n.tables.push(b);
      }
    }
    lineNote("exc"); lineNote("xo");
    // tax expenses
    if (nm.L_tax_CY || nm.L_tax_PY){
      const n = note("tax", "Tax Expenses", {lines: ["tax"]}), t = T(cols3(true));
      row(t, "Current Tax", [null, null], "h"); row(t, "Current Year", [ref("L_taxcur_CY"), ref("L_taxcur_PY")], "r", 1);
      if (co){ row(t, "Deferred Tax", [null, null], "h"); row(t, "Origination and reversal of timing differences", [ref("L_taxdef_CY"), ref("L_taxdef_PY")], "r", 1); row(t, "Total", [ref("L_tax_CY"), ref("L_tax_PY")], "t"); }
      n.tables.push(t);
    }
    // EPS (company)
    if (co){
      const n = note("eps", "Earnings Per Share"), t = T(cols3(true)), e = det.eps || {}, sh = (N.find(z => z.key === "share") || {}).share || {cyN: {n: 0, f: "0"}, pyN: {n: 0, f: "0"}, cyFv: {v: 0}};
      const wC = dinN("eps_w_cy", "Weighted average number of equity shares (year)", e.weightedCy != null ? e.weightedCy : sh.cyN.n, "EPS"), wP = dinN("eps_w_py", "Weighted average number of equity shares (previous year)", e.weightedPy != null ? e.weightedPy : sh.pyN.n, "EPS");
      const pdC = din("eps_pref_cy", "Preference dividend (year)", e.prefDiv || 0, "EPS"), pdP = din("eps_pref_py", "Preference dividend (previous year)", (e.prefDivPy || 0), "EPS");
      const dC = din("eps_dil_cy", "Adjustments to earnings for dilutive potential shares (c)", e.dilEarn || 0, "EPS"), dP = din("eps_dil_py", "Adjustments to earnings for dilutive potential shares, previous year (c)", e.dilEarnPy || 0, "EPS");
      const eC = dinN("eps_dsh_cy", "Dilutive potential equity shares (e)", e.dilShares || 0, "EPS"), eP = dinN("eps_dsh_py", "Dilutive potential equity shares, previous year (e)", e.dilSharesPy || 0, "EPS");
      const a = row(t, "Net Profit after Tax", [ref("T_pat_CY"), ref("T_pat_PY")]), b = row(t, "Less: Preference Dividend", [pdC, pdP]);
      const ea = row(t, "Earnings attributable to equity shareholders (a)", [C(nm.T_pat_CY - pdC.v, "#R" + a + "#-#R" + b + "#"), C(nm.T_pat_PY - pdP.v, "#R" + a + "#-#R" + b + "#")], "s");
      row(t, "Number of equity shares at the end of the year", [{v: sh.cyN.n, cnt: 1, f: sh.cyN.f}, {v: sh.pyN.n, cnt: 1, f: sh.pyN.f}]);
      const wb = row(t, "Weighted average number of equity shares (b)", [{v: wC.n, cnt: 1, f: wC.f}, {v: wP.n, cnt: 1, f: wP.f}]);
      const basic = [wC.n ? (nm.T_pat_CY - pdC.v) / 100 / wC.n : null, wP.n ? (nm.T_pat_PY - pdP.v) / 100 / wP.n : null];
      named({v: basic[0], eps: 1, f: "IF(#R" + wb + "#=0,0,#R" + ea + "#/#R" + wb + "#)"}, "E_basic_CY"); named({v: basic[1], eps: 1, f: "IF(#R" + wb + "#=0,0,#R" + ea + "#/#R" + wb + "#)"}, "E_basic_PY");
      row(t, "Basic Earnings per share (a/b) (Face value of ₹ " + rs((sh.cyFv || {v: 0}).v) + " each)", [cells.E_basic_CY, cells.E_basic_PY]);
      const rc = row(t, "Adjustments to earnings for dilutive potential equity shares (c)", [dC, dP]);
      const rd = row(t, "Earnings for diluted EPS (d = a + c)", [C(nm.T_pat_CY - pdC.v + dC.v, "#R" + ea + "#+#R" + rc + "#"), C(nm.T_pat_PY - pdP.v + dP.v, "#R" + ea + "#+#R" + rc + "#")]);
      const re = row(t, "Dilutive potential equity shares (e)", [{v: eC.n, cnt: 1, f: eC.f}, {v: eP.n, cnt: 1, f: eP.f}]);
      const rf = row(t, "Weighted average shares for diluted EPS (f = b + e)", [{v: wC.n + eC.n, cnt: 1, f: "#R" + wb + "#+#R" + re + "#"}, {v: wP.n + eP.n, cnt: 1, f: "#R" + wb + "#+#R" + re + "#"}]);
      const dil = [(wC.n + eC.n) ? (nm.T_pat_CY - pdC.v + dC.v) / 100 / (wC.n + eC.n) : null, (wP.n + eP.n) ? (nm.T_pat_PY - pdP.v + dP.v) / 100 / (wP.n + eP.n) : null];
      named({v: dil[0], eps: 1, f: "IF(#R" + rf + "#=0,0,#R" + rd + "#/#R" + rf + "#)"}, "E_dil_CY"); named({v: dil[1], eps: 1, f: "IF(#R" + rf + "#=0,0,#R" + rd + "#/#R" + rf + "#)"}, "E_dil_PY");
      row(t, "Diluted Earnings per share (d/f)", [cells.E_dil_CY, cells.E_dil_PY], "t");
      n.tables.push(t); n.faceValue = (sh.cyFv || {v: 0}).v;
    }
    // related parties (company; a firm when given)
    const rp = det.rp || {};
    if (co && ((rp.parties || []).length || (rp.tx || []).length)){
      const n = note("rp", "Related Party Disclosures");
      const a = T([{h: "Name of the Related Party"}, {h: "Nature of Relationship"}], {title: "(a) List of all Related Parties"}); (rp.parties || []).forEach(p => row(a, p.name, [p.relation || ""])); n.tables.push(a);
      const b = T([{h: "Name"}, {h: "Relationship"}, {h: "Nature of Transaction"}, {h: D.cyYear, n: 1}, {h: D.pyYear, n: 1}], {title: "(b) Transactions with Related Parties"});
      (rp.tx || []).forEach((x, i) => row(b, x.name, [x.relation || ((rp.parties || []).find(p => p.name === x.name) || {}).relation || "", x.nature || "", din("rptx_cy_" + i, "Related party transaction " + (i + 1) + " (year)", x.cy, "Related parties"), din("rptx_py_" + i, "Related party transaction " + (i + 1) + " (previous year)", x.py, "Related parties")]));
      n.tables.push(b);
      const c = T([{h: "Name"}, {h: "Relationship"}, {h: "Nature of Balance (Assets/Liability)"}, {h: D.cyAsAt, n: 1}, {h: D.pyAsAt, n: 1}], {title: "(c) Outstanding Balances", rpBal: 1});
      (rp.bal || []).forEach((x, i) => { const lz = L.find(z => z.l === x.ledger), s = lz && X.line(lz.line) && X.line(lz.line).side === "L" ? -1 : 1;
        const cy = lz ? C(s * R0(lz.cy), (s < 0 ? "-" : "") + "ROUND(SUMIFS(TB_CY,TB_LEDGER,\"" + xq(x.ledger) + "\"),0)") : din("rpbal_cy_" + i, "Related party balance " + (i + 1), x.cy, "Related parties");
        const py = x.py === null ? null : lz ? C(s * R0(lz.py), (s < 0 ? "-" : "") + "ROUND(SUMIFS(TB_PY,TB_LEDGER,\"" + xq(x.ledger) + "\"),0)") : din("rpbal_py_" + i, "Related party balance " + (i + 1) + " (previous year)", x.py, "Related parties");
        const r = row(c, x.name, [x.relation || "", x.nature || "", cy, py]); c.rows[r].ledger = x.ledger || ""; c.rows[r].given = {cy: x.cy, py: x.py}; });
      n.tables.push(c);
    }
    // the analytical ratios (filled by X.ratios), the additional regulatory information, the other disclosures
    note("ratios", "Analytical Ratios");
    if (co){
      const n = note("ari", "Additional Regulatory Information for current and previous year"), a = det.ari || {};
      X.ARI.forEach(([k, no, yes], i) => { const x = a[k]; n.paras.push({t: "li", x: "(" + String.fromCharCode(97 + i) + ") " + (x && x.yes ? yes.replace("{x}", x.text || "") : no), ari: k}); });
    }
    const od = note("other", "Other Disclosures");
    const cl = det.contingent || [];
    if (cl.length){ const t = T(cols3(false), {title: "Contingent liabilities not provided for"}), idx = []; cl.forEach((x, i) => idx.push(row(t, x.what, [din("cont_cy_" + i, "Contingent liability: " + x.what, x.cy, "Contingent liabilities"), din("cont_py_" + i, "Contingent liability (previous year): " + x.what, x.py, "Contingent liabilities")]))); row(t, "Total", [sumRows(t, idx, 1), sumRows(t, idx, 2)], "t"); od.tables.push(t); }
    od.paras.push({t: "p", x: X.REGROUP});
    od.sign = true;
    // the face figures of the partners' accounts: their notes' totals
  };

  // ------------------------------------------------------------ the faces of the statements
  // rows: {t, note (a note key, shown as its number), c: [cy, py], k: h (head) | r | s (subtotal) | t (total) | gt}
  X.faceRows = function(M){
    const {co, firm, nm} = M, cells = M.cellsByName, ref = n => C(nm[n] != null ? nm[n] : 0, n), F = [];
    const r = (t, note, cy, py, k, ind) => F.push({t, note: note || null, c: [cy, py], k: k || "r", ind: ind || 0});
    const shown = k => !!(nm["L_" + k + "_CY"] || nm["L_" + k + "_PY"]);
    const bs = [];
    const R = (t, note, a, b, k, ind) => bs.push({t, note: note || null, c: [a, b], k: k || "r", ind: ind || 0});
    R(firm ? "I.  PARTNERS' FUNDS AND LIABILITIES" : "I.  EQUITY AND LIABILITIES", null, null, null, "h");
    const sec = (title, s, keys) => {
      const ks = keys.filter(shown); if (!ks.length) return;
      R(title, null, null, null, "h", 1);
      ks.forEach(k => {
        if (k === "tp" && co){ R("Trade Payables", null, null, null, "r", 2);
          R("total outstanding dues of micro and small enterprises", "tp", ref("L_tpmse_CY"), ref("L_tpmse_PY"), "r", 3);
          R("total outstanding dues of creditors other than micro and small enterprises", "tp", ref("L_tpoth_CY"), ref("L_tpoth_PY"), "r", 3); return; }
        R(k === "capital" && M.kind === "proprietor" ? "Proprietor's Capital Account" : X.line(k).face, k === "intang" || k === "cwip" ? "ppe" : k, ref("L_" + k + "_CY"), ref("L_" + k + "_PY"), "r", 2);
      });
      R("", null, ref("S_" + s + "_CY"), ref("S_" + s + "_PY"), "s");
    };
    sec(firm ? (M.kind === "proprietor" ? "Proprietor's Funds" : "Partners' Funds") : "Shareholders' Funds", "EQ", firm ? ["capital", "current", "reserves"] : ["share", "reserves"]);
    sec("Non-current Liabilities", "NCL", ["ltb", "dtl", "oltl", "ltp"]);
    sec("Current Liabilities", "CL", ["stb", "tp", "ocl", "stp"]);
    R("TOTAL", null, ref("T_el_CY"), ref("T_el_PY"), "gt");
    R("II. ASSETS", null, null, null, "h");
    const nca = ["ppe", "intang", "cwip", "nci", "dta", "ltla", "onca"].filter(shown);
    if (nca.length){
      R("Non-current Assets", null, null, null, "h", 1);
      const fa = ["ppe", "intang", "cwip"].filter(shown);
      if (fa.length){ R("Property, Plant and Equipment and Intangible Assets", null, null, null, "r", 2); fa.forEach(k => R(X.line(k).face, "ppe", ref("L_" + k + "_CY"), ref("L_" + k + "_PY"), "r", 3)); }
      ["nci", "dta", "ltla", "onca"].filter(shown).forEach(k => R(X.line(k).face, k, ref("L_" + k + "_CY"), ref("L_" + k + "_PY"), "r", 2));
      R("", null, ref("S_NCA_CY"), ref("S_NCA_PY"), "s");
    }
    sec("Current Assets", "CA", ["ci", "inv", "tr", "cash", "stla", "oca"]);
    R("TOTAL", null, ref("T_as_CY"), ref("T_as_PY"), "gt");
    if (firm){ R("General Information", "gi", null, null, "r", 0); R("Significant Accounting Policies", "sap", null, null, "r", 0); }
    // the statement of profit and loss
    const pl = [];
    const Q = (t, note, a, b, k, ind) => pl.push({t, note: note || null, c: [a, b], k: k || "r", ind: ind || 0});
    const plShown = k => !!(nm["L_" + k + "_CY"] || nm["L_" + k + "_PY"]);
    Q("INCOME", null, null, null, "h");
    ["rev", "oth"].filter(plShown).forEach(k => Q(X.line(k).face, k, ref("L_" + k + "_CY"), ref("L_" + k + "_PY"), "r", 1));
    Q("Total Income", null, ref("T_inc_CY"), ref("T_inc_PY"), "s");
    Q("EXPENSES", null, null, null, "h");
    ["mat", "pur", "chg", "emp", "fin", "dep", "exp"].filter(plShown).forEach(k => Q(X.line(k).face, k, ref("L_" + k + "_CY"), ref("L_" + k + "_PY"), "r", 1));
    Q("Total Expenses", null, ref("T_exp_CY"), ref("T_exp_PY"), "s");
    Q("Profit before Exceptional & Extraordinary items, and Tax", null, ref("T_pbe_CY"), ref("T_pbe_PY"), "s");
    Q("Exceptional Items", plShown("exc") ? "exc" : "-", ref("L_exc_CY"), ref("L_exc_PY"), "r", 1);
    Q("Profit before Extraordinary items, and Tax", null, ref("T_pbx_CY"), ref("T_pbx_PY"), "s");
    Q("Extraordinary Items", plShown("xo") ? "xo" : "-", ref("L_xo_CY"), ref("L_xo_PY"), "r", 1);
    Q("Profit before Tax", null, ref("T_pbt_CY"), ref("T_pbt_PY"), "s");
    Q("Tax Expenses", null, null, null, "h");
    Q("Current Tax", plShown("tax") ? "tax" : "-", ref("L_taxcur_CY"), ref("L_taxcur_PY"), "r", 1);
    if (co) Q("Deferred Tax", plShown("tax") ? "tax" : "-", ref("L_taxdef_CY"), ref("L_taxdef_PY"), "r", 1);
    Q("Profit (Loss) for the Year", null, ref("T_pat_CY"), ref("T_pat_PY"), "gt");
    if (co){
      const fv = (M.notes.find(n => n.key === "eps") || {}).faceValue || 0;
      Q("Earnings Per Equity Share", null, null, null, "h");
      const er = n => Object.assign({}, cells[n], {f: n, nm: null});
      Q("Basic (Face value of ₹ " + rs(fv) + " each)", "eps", er("E_basic_CY"), er("E_basic_PY"), "r", 1);
      Q("Diluted (Face value of ₹ " + rs(fv) + " each)", "eps", er("E_dil_CY"), er("E_dil_PY"), "r", 1);
    }
    if (firm){ Q("General Information", "gi", null, null, "r", 0); Q("Significant Accounting Policies", "sap", null, null, "r", 0); }
    return {bs, pl};
  };

  // ------------------------------------------------------------ the analytical ratios
  X.ratios = function(M){
    const {co, nm, det} = M, cells = M.cellsByName, ex = det.ratioExplain || {};
    const V = n => nm[n] || 0;
    const dIn = (n, label, rupees) => { const key = "D_" + nmOf(n), v = P(rupees); if (!M.inputs.find(z => z.nm === key)) M.inputs.push({nm: key, label, v, group: "Ratios"}); nm[key] = v; return key; };
    const purch = y => { const xs = M.L.filter(x => x.line === "mat" && x.sub === "Purchase"); return R0(sum(xs, x => y === "CY" ? x.cy : x.py)); };
    const purF = y => "ROUND(ROUND(SUMIFS(TB_" + y + ",TB_LINE,\"mat\",TB_SUB,\"Purchase\"),2),0)+L_pur_" + y;
    const pIn = dIn("dscr_principal_cy", "Principal repaid on borrowings during the year (for the debt service coverage ratio)", (det.dscr || {}).principalCy || 0);
    const pInP = dIn("dscr_principal_py", "Principal repaid on borrowings during the previous year", (det.dscr || {}).principalPy || 0);
    const eq = y => co ? "(L_share_" + y + "+L_reserves_" + y + ")" : "(L_capital_" + y + "+L_current_" + y + "+L_reserves_" + y + ")";
    const eqV = y => co ? V("L_share_" + y) + V("L_reserves_" + y) : V("L_capital_" + y) + V("L_current_" + y) + V("L_reserves_" + y);
    const avg = (fn, fv, y) => y === "CY" ? {f: "((" + fn("CY") + ")+(" + fn("PY") + "))/2", v: (fv("CY") + fv("PY")) / 2} : {f: "(" + fn("PY") + ")", v: fv("PY")};
    const L = (k, y) => "L_" + k + "_" + y, LV = (k, y) => V(L(k, y));
    const defs = [
      ["current", "Current Ratio", "times", "Current Assets", "Current Liabilities", y => ({f: "S_CA_" + y, v: V("S_CA_" + y)}), y => ({f: "S_CL_" + y, v: V("S_CL_" + y)})],
      ["de", "Debt-Equity Ratio", "times", "Total Debt", "Shareholders' Equity", y => ({f: L("ltb", y) + "+" + L("stb", y), v: LV("ltb", y) + LV("stb", y)}), y => ({f: eq(y), v: eqV(y)})],
      ["dscr", "Debt Service Coverage Ratio", "times", "Earnings available for debt service (Profit after tax + Depreciation + Finance costs)", "Debt service (Finance costs + Principal repayments)",
        y => ({f: "T_pat_" + y + "+" + L("dep", y) + "+" + L("fin", y), v: V("T_pat_" + y) + LV("dep", y) + LV("fin", y)}), y => ({f: L("fin", y) + "+" + (y === "CY" ? pIn : pInP), v: LV("fin", y) + V(y === "CY" ? pIn : pInP)})],
      ["roe", "Return on Equity Ratio", "%", "Net Profit after Tax", "Average Shareholders' Equity", y => ({f: "T_pat_" + y, v: V("T_pat_" + y)}), y => avg(eq, eqV, y)],
      ["inv", "Inventory turnover ratio", "times", "Cost of Goods Sold", "Average Inventory", y => ({f: L("mat", y) + "+" + L("pur", y) + "+" + L("chg", y), v: LV("mat", y) + LV("pur", y) + LV("chg", y)}), y => avg(z => L("inv", z), z => LV("inv", z), y)],
      ["tr", "Trade Receivables turnover ratio", "times", "Revenue from Operations", "Average Trade Receivables", y => ({f: L("rev", y), v: LV("rev", y)}), y => avg(z => L("tr", z), z => LV("tr", z), y)],
      ["tp", "Trade payables turnover ratio", "times", "Purchases", "Average Trade Payables", y => ({f: purF(y), v: purch(y) + LV("pur", y)}), y => avg(z => L("tp", z), z => LV("tp", z), y)],
      ["nct", "Net capital turnover ratio", "times", "Revenue from Operations", "Working Capital (Current Assets - Current Liabilities)", y => ({f: L("rev", y), v: LV("rev", y)}), y => ({f: "S_CA_" + y + "-S_CL_" + y, v: V("S_CA_" + y) - V("S_CL_" + y)})],
      ["np", "Net profit ratio", "%", "Net Profit after Tax", "Revenue from Operations", y => ({f: "T_pat_" + y, v: V("T_pat_" + y)}), y => ({f: L("rev", y), v: LV("rev", y)})],
      ["roce", "Return on Capital employed", "%", "Earnings before interest and taxes", "Capital Employed", y => ({f: "T_pbt_" + y + "+" + L("fin", y), v: V("T_pbt_" + y) + LV("fin", y)}),
        y => ({f: eq(y) + "-" + L("intang", y) + "+" + L("ltb", y) + "+" + L("stb", y) + "+" + L("dtl", y), v: eqV(y) - LV("intang", y) + LV("ltb", y) + LV("stb", y) + LV("dtl", y)})],
      ["roi", "Return on investment", "%", "Income from investments", "Average Investments", y => { const xs = M.L.filter(x => x.line === "oth" && /Interest|Dividend/.test(x.sub)); return {f: "-ROUND(ROUND(SUMIFS(TB_" + y + ",TB_LINE,\"oth\",TB_SUB,\"Interest income|Interest on bank deposits\")+SUMIFS(TB_" + y + ",TB_LINE,\"oth\",TB_SUB,\"Other non-operating income|Dividend income\"),2),0)", v: -R0(sum(xs, x => y === "CY" ? x.cy : x.py))}; },
        y => avg(z => L("nci", z) + "+" + L("ci", z) + "+" + "ROUND(ROUND(SUMIFS(TB_" + z + ",TB_LINE,\"cash\",TB_SUB,\"Other Bank Balances|Other bank balances\"),2),0)", z => LV("nci", z) + LV("ci", z) + R0(sum(M.L.filter(x => x.line === "cash" && x.sub === "Other Bank Balances|Other bank balances"), x => z === "CY" ? x.cy : x.py)), y)],
      ["gp", "Gross profit ratio", "%", "Gross Profit (Revenue from Operations - Cost of Goods Sold)", "Revenue from Operations", y => ({f: L("rev", y) + "-(" + L("mat", y) + "+" + L("pur", y) + "+" + L("chg", y) + ")", v: LV("rev", y) - LV("mat", y) - LV("pur", y) - LV("chg", y)}), y => ({f: L("rev", y), v: LV("rev", y)})]
    ];
    const keys = co ? ["current", "de", "dscr", "roe", "inv", "tr", "tp", "nct", "np", "roce", "roi"] : ["np", "gp"];
    M.ratioList = keys.map(k => {
      const d = defs.find(z => z[0] === k), [, name, unit, numL, denL, fN, fD] = d;
      const r = {key: k, name: name + " (in " + (unit === "%" ? "%" : "times") + ")", unit, numL, denL};
      ["CY", "PY"].forEach(y => {
        const a = fN(y), b = fD(y), v = b.v ? a.v / b.v : null;
        r[y] = {v, f: "IF((" + b.f + ")=0,\"-\",(" + a.f + ")/(" + b.f + "))", num: a, den: b, ratio: 1, pc: unit === "%" ? 1 : 0};
      });
      r.variance = r.CY.v != null && r.PY.v != null && r.PY.v !== 0 ? (r.CY.v - r.PY.v) / Math.abs(r.PY.v) : null;
      r.varF = "IF(OR(ISTEXT(#C1#),ISTEXT(#C2#)),\"-\",IF(#C2#=0,\"-\",(#C1#-#C2#)/ABS(#C2#)))";
      r.reason = ex[k] || "";
      r.needs = r.variance != null && Math.abs(r.variance) > 0.25;
      return r;
    });
    const n = M.notes.find(z => z.key === "ratios");
    if (n){
      const t = {cols: [{h: "Ratio"}, {h: "Numerator"}, {h: "Denominator"}, {h: M.D.cyYear.replace("Year ended", "As at / Year ended"), n: 5}, {h: M.D.pyYear.replace("Year ended", "As at / Year ended"), n: 5}, {h: "% Variance", n: 3}, {h: "Reason for variance above 25%"}], rows: [], ratios: 1};
      M.ratioList.forEach(r => t.rows.push({t: r.name, k: "r", c: [r.numL, r.denL, r.CY, r.PY, {v: r.variance, pc: 1, f: r.varF.replace(/#C1#/g, "#C3#").replace(/#C2#/g, "#C4#")}, r.needs ? (r.reason || "") : (r.reason || "")], ratio: r.key}));
      n.tables = [t];
      n.paras = co ? [{t: "p", x: "Capital employed = Tangible Net Worth + Total Debt + Deferred Tax Liability. Averages are of the opening and closing balances of the year; the previous year's ratios use its closing balances."}] : [];
    }
  };

  // ------------------------------------------------------------ the cash flow statement (AS-3, indirect method), behind a switch
  X.cashflow = function(M){
    const {nm} = M, V = n => nm[n] || 0, rows = [];
    const sub = (line, s, y) => R0(sum(M.L.filter(x => x.line === line && x.sub === s), x => (y === "CY" ? x.cy : x.py))) * (X.line(line).side === "L" ? -1 : 1);
    const subF = (line, s, y) => (X.line(line).side === "L" ? "-" : "") + "ROUND(ROUND(SUMIFS(TB_" + y + ",TB_LINE,\"" + line + "\",TB_SUB,\"" + xq(s) + "\"),2),0)";
    const d = k => ({v: V("L_" + k + "_CY") - V("L_" + k + "_PY"), f: "(L_" + k + "_CY-L_" + k + "_PY)"});
    const ds = (line, s) => ({v: sub(line, s, "CY") - sub(line, s, "PY"), f: "(" + subF(line, s, "CY") + "-(" + subF(line, s, "PY") + "))"});
    const r = (t, v, f, k) => { rows.push({t, c: [v == null ? null : C(v, f)], k: k || "r"}); return rows.length - 1; };
    const A = [], B = [], Cc = [];
    r("A. Cash flow from operating activities", null, null, "h");
    A.push(r("Profit before Tax", V("T_pbt_CY"), "T_pbt_CY"));
    r("Adjustments for:", null, null, "h");
    A.push(r("Depreciation and Amortisation Expense", V("L_dep_CY"), "L_dep_CY"));
    A.push(r("Finance Costs", V("L_fin_CY"), "L_fin_CY"));
    const ii = {v: sub("oth", "Interest income|Interest on bank deposits", "CY"), f: subF("oth", "Interest income|Interest on bank deposits", "CY")}, di = {v: sub("oth", "Other non-operating income|Dividend income", "CY"), f: subF("oth", "Other non-operating income|Dividend income", "CY")};
    A.push(r("Interest income", -ii.v, "-(" + ii.f + ")")); A.push(r("Dividend income", -di.v, "-(" + di.f + ")"));
    const opb = r("Operating profit before working capital changes", sum(A, i => rows[i].c[0].v), A.map(i => "#R" + i + "#").join("+"), "s");
    const wc = [opb];
    r("Changes in working capital:", null, null, "h");
    const at = ds("stla", "Advance Tax and TDS"), pt = ds("stp", "Provision for Taxation");
    [["inv", "Inventories"], ["tr", "Trade Receivables"], ["ltla", "Long-term Loans and Advances"], ["onca", "Other Non-current Assets"], ["oca", "Other Current Assets"]].forEach(([k, l]) => { const x = d(k); if (x.v || V("L_" + k + "_CY")) wc.push(r("(Increase) / Decrease in " + l, -x.v, "-" + x.f)); });
    { const x = d("stla"); wc.push(r("(Increase) / Decrease in Short-term Loans and Advances (other than advance tax)", -(x.v - at.v), "-(" + x.f + "-" + at.f + ")")); }
    [["tp", "Trade Payables"], ["ocl", "Other Current Liabilities"], ["ltp", "Long-term Provisions"], ["oltl", "Other Long-term Liabilities"]].forEach(([k, l]) => { const x = d(k); if (x.v || V("L_" + k + "_CY")) wc.push(r("Increase / (Decrease) in " + l, x.v, x.f)); });
    { const x = d("stp"); wc.push(r("Increase / (Decrease) in Short-term Provisions (other than for tax)", x.v - pt.v, "(" + x.f + "-" + pt.f + ")")); }
    const cg = r("Cash generated from operations", sum(wc, i => rows[i].c[0].v), wc.map(i => "#R" + i + "#").join("+"), "s");
    const tx = r("Income taxes paid (net)", -(V("L_taxcur_CY") - pt.v + at.v), "-(L_taxcur_CY-" + pt.f + "+" + at.f + ")");
    const na = r("Net cash from operating activities (A)", rows[cg].c[0].v + rows[tx].c[0].v, "#R" + cg + "#+#R" + tx + "#", "t");
    r("B. Cash flow from investing activities", null, null, "h");
    const fa = ["ppe", "intang", "cwip"].map(d), faV = sum(fa, x => x.v);
    B.push(r("Purchase of Property, Plant and Equipment and Intangible Assets (net)", -(faV + V("L_dep_CY")), "-(" + fa.map(x => x.f).join("+") + "+L_dep_CY)"));
    { const x1 = d("nci"), x2 = d("ci"); B.push(r("(Purchase) / Sale of Investments (net)", -(x1.v + x2.v), "-(" + x1.f + "+" + x2.f + ")")); }
    { const x = ds("cash", "Other Bank Balances|Other bank balances"); B.push(r("(Increase) / Decrease in Other Bank Balances", -x.v, "-" + x.f)); }
    B.push(r("Interest received", ii.v, ii.f)); B.push(r("Dividend received", di.v, di.f));
    const nb = r("Net cash used in investing activities (B)", sum(B, i => rows[i].c[0].v), B.map(i => "#R" + i + "#").join("+"), "t");
    r("C. Cash flow from financing activities", null, null, "h");
    if (M.co){ const x = d("share"); Cc.push(r("Proceeds from issue of share capital", x.v, x.f)); const y = d("reserves"); Cc.push(r("Securities premium and other movements in reserves", y.v - V("T_pat_CY"), y.f + "-T_pat_CY")); }
    else { const xs = ["capital", "current", "reserves"].map(d); Cc.push(r("Capital introduced less withdrawals (net of profit credited)", sum(xs, x => x.v) - V("T_pat_CY"), xs.map(x => x.f).join("+") + "-T_pat_CY")); }
    { const x = d("ltb"); Cc.push(r("Proceeds from / (Repayment of) Long-term Borrowings (net)", x.v, x.f)); }
    { const x = d("stb"); Cc.push(r("Proceeds from / (Repayment of) Short-term Borrowings (net)", x.v, x.f)); }
    Cc.push(r("Finance costs paid", -V("L_fin_CY"), "-L_fin_CY"));
    const nc = r("Net cash from / (used in) financing activities (C)", sum(Cc, i => rows[i].c[0].v), Cc.map(i => "#R" + i + "#").join("+"), "t");
    const net = r("Net increase / (decrease) in cash and cash equivalents (A+B+C)", rows[na].c[0].v + rows[nb].c[0].v + rows[nc].c[0].v, "#R" + na + "#+#R" + nb + "#+#R" + nc + "#", "s");
    const cce = y => ({v: sub("cash", "Cash and Cash Equivalents|Cash on hand", y) + sub("cash", "Cash and Cash Equivalents|Balances with banks in current accounts", y), f: subF("cash", "Cash and Cash Equivalents|Cash on hand", y) + "+" + subF("cash", "Cash and Cash Equivalents|Balances with banks in current accounts", y)});
    const o = cce("PY"), c2 = cce("CY");
    const op = r("Cash and cash equivalents at the beginning of the year", o.v, o.f);
    const cl = r("Cash and cash equivalents at the end of the year", rows[net].c[0].v + o.v, "#R" + net + "#+#R" + op + "#", "gt");
    const bk = r("Cash and cash equivalents as per the Balance Sheet (Note {{note:cash}})", c2.v, c2.f);
    M.cf = {rows, diff: rows[cl].c[0].v - c2.v, close: cl, books: bk};
  };

  // ------------------------------------------------------------ note numbers, and the references that follow them
  X.number = function(M){
    let n = 0; M.noteNo = {};
    M.notes.forEach(z => { if (z.print) { z.no = ++n; M.noteNo[z.key] = n; (z.lines || []).forEach(k => { if (!M.noteNo[k]) M.noteNo[k] = n; }); } else z.no = null; });
    M.face2 = X.faceRows(M);
  };
  // "{{note:stla}}" becomes the note's number; one that does not resolve stays visible for check 19
  X.resolveRefs = (s, M) => String(s).replace(/\{\{note:(\w+)\}\}/g, (m, k) => M.noteNo[k] ? String(M.noteNo[k]) : "-");

  // ------------------------------------------------------------ pages: what each printed page holds
  // capacity in lines (A4 portrait at 9-10 pt); a landscape note (PPE) gets a page of its own
  X.paginate = function(M){
    const pages = [], CAP = 56;
    pages.push({kind: "bs", items: ["bs"]});
    pages.push({kind: "pl", items: ["pl"]});
    if (M.cf) pages.push({kind: "cf", items: ["cf"]});
    const est = z => 2 + sum(z.paras, p => 1 + Math.floor(String(p.x).length / 120)) + sum(z.tables, t => 3 + t.rows.length + (t.title ? 1 : 0)) + (z.sign ? 16 : 0);
    let cur = null, used = 0;
    M.notes.filter(z => z.print).forEach(z => {
      const h = est(z);
      if (z.landscape){ pages.push({kind: "notes", items: [z.key], landscape: true}); cur = null; used = 0; return; }
      if (!cur || used + h > CAP && used > 0){ cur = {kind: "notes", items: []}; pages.push(cur); used = 0; }
      cur.items.push(z.key); used += h;
      // a long note (the policies) runs over pages of its own: count them so "n / N" is right
      while (used > CAP){ used -= CAP; cur.more = (cur.more || 0) + 1; }
    });
    // physical pages: a page that runs over is counted as more than one
    let no = 0; pages.forEach(p => { p.from = no + 1; no += 1 + (p.more || 0); p.to = no; });
    M.pages = pages; M.pageCount = no;
  };

  // ------------------------------------------------------------ a small evaluator of FSX's own formulas (the subset it
  // writes), so the checks recompute every figure the way Excel will, from the TB and the details
  const isUnitless = c => c && (c.cnt || c.pc || c.eps || c.ratio || c.sh || c.rt);
  X.evalFormula = function(M, f, ctx){
    const cells = M.cellsByName || {}, inp = Object.fromEntries((M.inputs || []).map(z => [z.nm, z]));
    const nameVal = n => {
      if (inp[n]) return inp[n].n != null ? inp[n].n : inp[n].v / 100;
      const c = cells[n]; if (c) return isUnitless(c) ? c.v : c.v / 100;
      if (M.nm[n] != null) return M.nm[n] / 100;
      throw new Error("unknown name " + n);
    };
    const cellVal = c => c == null ? 0 : typeof c === "string" ? c : (c.v == null ? 0 : isUnitless(c) ? c.v : c.v / 100);
    let s = String(f);
    if (ctx){
      s = s.replace(/#C(\d+)#:#C(\d+)#/g, (m, a, b) => { const o = []; for (let i = +a; i <= +b; i++) o.push("#C" + i + "#"); return o.join(","); });
      s = s.replace(/#R(\d+)#/g, (m, i) => "(" + num(cellVal(ctx.t.rows[+i].c[ctx.j])) + ")").replace(/#C(\d+)#/g, (m, j) => "(" + num(cellVal(ctx.row.c[+j - 1])) + ")")
        .replace(/#T#/g, () => { const tr = ctx.t.rows.find(r => r.k === "t"); return "(" + num(cellVal(tr && tr.c[ctx.j])) + ")"; });
    }
    function num(v){ return typeof v === "string" ? JSON.stringify(v) : String(v); }
    // tokens
    const tk = []; let i = 0;
    while (i < s.length){
      const ch = s[i];
      if (/\s/.test(ch)){ i++; continue; }
      if (ch === '"'){ let j = i + 1, out = ""; while (j < s.length){ if (s[j] === '"' && s[j + 1] === '"'){ out += '"'; j += 2; continue; } if (s[j] === '"') break; out += s[j++]; } tk.push({t: "s", v: out}); i = j + 1; continue; }
      const m = /^(\d+(\.\d+)?(e-?\d+)?)/i.exec(s.slice(i)); if (m){ tk.push({t: "n", v: parseFloat(m[1])}); i += m[1].length; continue; }
      const w = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i)); if (w){ tk.push({t: "w", v: w[0]}); i += w[0].length; continue; }
      if ("<>".includes(ch) && s[i + 1] === "="){ tk.push({t: "o", v: ch + "="}); i += 2; continue; }
      if (ch === "<" && s[i + 1] === ">"){ tk.push({t: "o", v: "<>"}); i += 2; continue; }
      tk.push({t: "o", v: ch}); i++;
    }
    let p = 0;
    const peek = () => tk[p] && tk[p].t === "o" ? tk[p] : (tk[p] ? {v: null} : undefined), eat = v => { if (tk[p] && tk[p].t === "o" && tk[p].v === v){ p++; return true; } return false; };
    const N = v => typeof v === "string" ? (v === "" ? 0 : NaN) : v;
    function cmp(){ let a = expr(); while (peek() && ["=", "<", ">", "<=", ">=", "<>"].includes(peek().v)){ const o = tk[p++].v, b = expr(); a = o === "=" ? a === b : o === "<" ? a < b : o === ">" ? a > b : o === "<=" ? a <= b : o === ">=" ? a >= b : a !== b; } return a; }
    function expr(){ let a = term(); while (peek() && (peek().v === "+" || peek().v === "-")){ const o = tk[p++].v, b = term(); a = o === "+" ? N(a) + N(b) : N(a) - N(b); } return a; }
    function term(){ let a = unary(); while (peek() && (peek().v === "*" || peek().v === "/")){ const o = tk[p++].v, b = unary(); if (o === "/" && N(b) === 0) throw new Error("#DIV/0!"); a = o === "*" ? N(a) * N(b) : N(a) / N(b); } return a; }
    function unary(){ if (eat("-")) return -N(unary()); if (eat("+")) return N(unary()); return pow(); }
    function pow(){ let a = atom(); while (peek() && peek().v === "^"){ p++; const b = atom(); a = Math.pow(N(a), N(b)); } return a; }
    function args(){ const out = []; if (eat(")")) return out; do { out.push(cmp()); } while (eat(",")); if (!eat(")")) throw new Error("expected )"); return out; }
    const round = (x, d) => { const k = Math.pow(10, d || 0), y = Math.abs(x) * k, r = Math.floor(y + 0.5 + 1e-9); return (x < 0 ? -r : r) / k; };
    const tbCol = n => ({TB_CY: "cy", TB_PY: "py", TB_O: "o", TB_D: "d", TB_C: "c", TB_PO: "po", TB_PD: "pd", TB_PC: "pc"}[n]);
    const tbKey = n => ({TB_LINE: x => x.line, TB_SUB: x => x.sub, TB_LEDGER: x => x.l, TB_NATURE: x => x.pl ? "PL" : "BS"}[n]);
    function atom(){
      const t = tk[p++];
      if (!t) throw new Error("unexpected end");
      if (t.t === "n") return t.v;
      if (t.t === "s") return t.v;
      if (t.v === "("){ const v = cmp(); if (!eat(")")) throw new Error("expected )"); return v; }
      if (t.t === "w"){
        if (eat("(")){
          const fn = t.v.toUpperCase();
          if (fn === "SUMIFS"){
            const col = tk[p++].v, crit = []; while (eat(",")){ const k = tk[p++].v; eat(","); const v = cmp(); crit.push([tbKey(k), v]); } eat(")");
            return sum(M.L.filter(x => crit.every(([g, v]) => g(x) === v)), x => x[tbCol(col)]) / 100;
          }
          const a = args();
          if (fn === "SUM") return sum(a, v => N(v) || 0);
          if (fn === "ROUND") return round(N(a[0]), N(a[1]));
          if (fn === "MAX") return Math.max(...a.map(N));
          if (fn === "MIN") return Math.min(...a.map(N));
          if (fn === "ABS") return Math.abs(N(a[0]));
          if (fn === "IF") return a[0] ? a[1] : (a.length > 2 ? a[2] : false);
          if (fn === "OR") return a.some(Boolean);
          if (fn === "AND") return a.every(Boolean);
          if (fn === "ISTEXT") return typeof a[0] === "string";
          if (fn === "POWER") return Math.pow(N(a[0]), N(a[1]));
          throw new Error("function " + fn);
        }
        if (t.v === "TRUE") return true; if (t.v === "FALSE") return false;
        return nameVal(t.v);
      }
      throw new Error("token " + t.v);
    }
    const v = cmp();
    if (p < tk.length) throw new Error("left over: " + tk.slice(p).map(z => z.v).join(""));
    return v;
  };
  // every figure of the statements, with where it sits
  X.allCells = function(M){
    const out = [];
    const face = M.face2 || X.faceRows(M);
    [["bs", face.bs], ["pl", face.pl]].forEach(([w, rows]) => rows.forEach((r, ri) => r.c.forEach((c, j) => { if (c && typeof c === "object") out.push({where: w, label: r.t, c, ctx: null}); })));
    M.notes.forEach(n => n.tables.forEach(t => t.rows.forEach((r, ri) => (r.c || []).forEach((c, j) => { if (c && typeof c === "object") out.push({where: "note " + (n.no || n.key) + " " + n.title, label: r.t, c, ctx: {t, row: r, j}}); }))));
    if (M.cf) M.cf.rows.forEach(r => r.c.forEach((c, j) => { if (c) out.push({where: "cash flow", label: r.t, c, ctx: {t: {rows: M.cf.rows}, row: r, j}}); }));
    return out;
  };

  // ------------------------------------------------------------ the 27 checks of the spec (section 4), before any output
  // each: {id, title, level: "error" | "warn", ok, items: [what is wrong, in words]}; a failure is listed, nothing is fixed
  X.CHECKS = [
    [1, "Balance sheet: the two sides agree, and every section subtotal is the sum of its lines"],
    [2, "Profit and loss: Total Income, Total Expenses, the profit lines and PAT = PBT - tax"],
    [3, "Each line on the face equals its note's Total, this year and last year"],
    [4, "Each note adds up, and every amount sits on its own labelled row"],
    [5, "The previous-year column equals last year's figures, and last year's closing is this year's opening"],
    [6, "Ageing tables: each row adds up, the total equals the note, and the MSME / others rows equal the face"],
    [7, "Share capital: number of shares x face value = the paid-up amount = the reconciliation's closing amount"],
    [8, "Securities premium added only with shares issued in the reconciliation"],
    [9, "Reserves: opening + profit +/- adjustments = closing, and every adjustment has a caption"],
    [10, "Partners' accounts add up; the profit shares equal the profit in the ratio of the shares; remuneration and interest equal the P&L"],
    [11, "Fixed assets: gross block, depreciation and net block add up; depreciation equals the P&L; no negative additions"],
    [12, "Repayment terms: the table equals its borrowings note, each loan in the right table, rates shown as %"],
    [13, "Inventories: the closing stock on the face equals the notes, and the opening equals last year's closing"],
    [14, "Tax: the provision for tax agrees with the current tax; the deferred tax movement equals the deferred tax charge"],
    [15, "EPS = earnings / weighted shares; Basic = Diluted without potential shares; the face value agrees with the share capital note"],
    [16, "Ratios: recomputed from the statements, and every variance above 25% explained"],
    [17, "Related parties: balances agree with the ledgers; loans to directors and related parties are in the loans table"],
    [18, "Note numbers: every number on the face exists, every note is referenced (or deliberately nil), numbering has no gaps"],
    [19, "References in the text resolve to the right note"],
    [20, "No duplicated text"],
    [21, "No truncated sentences"],
    [22, "Wording follows the entity type"],
    [23, "Previous-year figures present on every comparative table"],
    [24, "Signatories complete: FRN, M.No, UDIN and Date; DIN of 8 digits; PAN in the right form"],
    [25, "Headers: the units line agrees with the rounding; column dates agree with the year"],
    [26, "Plausibility (warnings): cash on hand, receivables ageing, repeated ageing amounts, unsecured bank term loans"],
    [27, "No blank pages"]
  ];
  X.check = function(M){
    const out = [], nm = M.nm, cells = M.cellsByName, V = n => nm[n] || 0, rup = p => "₹" + money(p), face = M.face2 || X.faceRows(M);
    const note = k => M.notes.find(n => n.key === k && n.print);
    const totalRow = t => t.rows.find(r => r.k === "t");
    const add = (id, items, level) => out.push({id, title: X.CHECKS[id - 1][1], level: level || "error", ok: !items.length, items});
    const allText = (heads) => { const o = []; M.notes.filter(n => n.print).forEach(n => n.paras.forEach(p => { if (p.t === "h" && !heads) return; o.push({n, x: X.resolveRefs(p.x, M), raw: p.x, t: p.t}); })); return o; };
    // 1
    { const it = [];
      ["CY", "PY"].forEach(y => {
        const gt0 = face.bs.findIndex(z => z.k === "gt"), el = sum(face.bs.slice(0, gt0).filter(r => r.k === "r" && r.c[0]), r => r.c[y === "CY" ? 0 : 1].v);
        const gt1 = face.bs.findIndex((z, i) => z.k === "gt" && i > gt0), asRows = face.bs.slice(gt0 + 1, gt1).filter(r => r.k === "r" && r.c[0]), as = sum(asRows, r => r.c[y === "CY" ? 0 : 1].v);
        const gts = face.bs.filter(r => r.k === "gt");
        if (gts[0].c[y === "CY" ? 0 : 1].v !== el) it.push(y + ": the liabilities TOTAL " + rup(gts[0].c[y === "CY" ? 0 : 1].v) + " is not the sum of its lines " + rup(el));
        if (gts[1].c[y === "CY" ? 0 : 1].v !== as) it.push(y + ": the assets TOTAL " + rup(gts[1].c[y === "CY" ? 0 : 1].v) + " is not the sum of its lines " + rup(as));
        if (el !== as) it.push(y + ": the balance sheet does not tally: " + rup(el) + " against " + rup(as));
        const rr = M.res[y].round.v; if (Math.abs(rr) > 500) it.push(y + ": the books do not tally by " + rup(rr) + " (held in Reserves as Rounding Off): check the opening balances and the mapping");
        // each section subtotal
        let start = 0; face.bs.forEach((r, i) => { if (r.k === "h") start = i; if (r.k === "s"){ const ls = face.bs.slice(start, i).filter(z => z.k === "r" && z.c[0]); const s2 = sum(ls, z => z.c[y === "CY" ? 0 : 1].v); if (s2 !== r.c[y === "CY" ? 0 : 1].v) it.push(y + ": a section subtotal " + rup(r.c[y === "CY" ? 0 : 1].v) + " is not the sum of its lines " + rup(s2)); } });
      });
      add(1, it); }
    // 2
    { const it = [];
      ["CY", "PY"].forEach((y, j) => {
        const get = t => (face.pl.find(r => r.t === t) || {c: [{v: 0}, {v: 0}]}).c[j].v, lines = ks => sum(face.pl.filter(r => ks.includes(r.note) && r.k === "r"), r => r.c[j].v);
        const inc = get("Total Income"), ex = get("Total Expenses"), pbe = get("Profit before Exceptional & Extraordinary items, and Tax"), pbx = get("Profit before Extraordinary items, and Tax"), pbt = get("Profit before Tax"), pat = get("Profit (Loss) for the Year");
        const exc = get("Exceptional Items"), xo = get("Extraordinary Items"), tax = get("Current Tax") + (M.co ? get("Deferred Tax") : 0);
        if (inc !== lines(["rev", "oth"])) it.push(y + ": Total Income " + rup(inc) + " is not the sum of the income lines " + rup(lines(["rev", "oth"])));
        if (ex !== lines(["mat", "pur", "chg", "emp", "fin", "dep", "exp"])) it.push(y + ": Total Expenses " + rup(ex) + " is not the sum of the expense lines " + rup(lines(["mat", "pur", "chg", "emp", "fin", "dep", "exp"])));
        if (pbe !== inc - ex) it.push(y + ": profit before exceptional items is not income less expenses");
        if (pbx !== pbe - exc) it.push(y + ": profit before extraordinary items is not right");
        if (pbt !== pbx - xo) it.push(y + ": profit before tax is not right");
        if (pat !== pbt - tax) it.push(y + ": PAT " + rup(pat) + " is not PBT less tax " + rup(pbt - tax));
        if (tax !== V("L_tax_" + y)) it.push(y + ": the tax lines do not add to the tax expense");
      });
      add(2, it); }
    // 3
    { const it = [];
      M.notes.filter(n => n.print && n.lines.length).forEach(n => {
        const ks = n.lines;
        if (n.itBlock){
          const t = n.tables[0], ct = t && t.rows.find(r => r.t === "Current Year Total"), pt = t && t.rows.find(r => r.t === "Previous Year Total");
          const fcy = sum(ks, k => V("L_" + k + "_CY")), fpy = sum(ks, k => V("L_" + k + "_PY"));
          if (ct && ct.c[9].v !== fcy) it.push("Note " + n.no + " " + n.title + ": the closing WDV " + rup(ct.c[9].v) + " differs from the face " + rup(fcy) + " by " + rup(ct.c[9].v - fcy));
          if (pt && pt.c[9] && pt.c[9].v !== fpy) it.push("Note " + n.no + ": the previous year's closing WDV " + rup(pt.c[9].v) + " differs from the face " + rup(fpy) + " by " + rup(pt.c[9].v - fpy));
          const depPy = pt && pt.c[6] ? pt.c[6].v : null; if (depPy != null && depPy !== V("L_dep_PY")) it.push("Note " + n.no + ": the previous year's depreciation " + rup(depPy) + " differs from the P&L " + rup(V("L_dep_PY")) + " by " + rup(depPy - V("L_dep_PY")));
          return;
        }
        if (n.key === "ppe"){
          n.tables.filter(t => t.far).forEach(t => { const j = t.far === "cy" ? "CY" : "PY";
            t.rows.filter(r => r.line).forEach(r => { const f = V("L_" + r.line + "_" + j); if (r.c[8].v !== f) it.push("Note " + n.no + " (" + (j === "CY" ? "current" : "previous") + " period) " + X.line(r.line).face + ": net book value " + rup(r.c[8].v) + " differs from the face " + rup(f) + " by " + rup(r.c[8].v - f)); });
            if (!t.rows.some(r => r.line)){ const tr = totalRow(t); const f = sum(ks, k => V("L_" + k + "_" + j)); if (tr && tr.c[8].v !== f) it.push("Note " + n.no + ": net book value " + rup(tr.c[8].v) + " differs from the face " + rup(f)); }
          });
          return;
        }
        const t = n.tables[0], tr = t && totalRow(t);
        if (!tr) return;
        ["CY", "PY"].forEach((y, j) => {
          const want = sum(ks, k => V("L_" + k + "_" + y)), col = n.key === "capital" || n.key === "current" ? 7 : j;
          const got = n.key === "capital" || n.key === "current" ? (t.rows.find(r => r.t === (y === "CY" ? "Current Year" : "Previous Year")) || tr).c[7].v : tr.c[col].v;
          if (got !== want) it.push("Note " + n.no + " " + n.title + " (" + y + "): Total " + rup(got) + " differs from the face " + rup(want) + " by " + rup(got - want));
        });
      });
      add(3, it); }
    // 4
    { const it = [];
      X.allCells(M).forEach(z => {
        if (!z.c.f || z.c.v == null) return;
        let v; try { v = X.evalFormula(M, z.c.f, z.ctx); } catch (e){ it.push(z.where + ", " + (z.label || "a row") + ": the formula does not work (" + e.message + ")"); return; }
        if (typeof v === "string") return;
        const want = isUnitless(z.c) ? z.c.v : z.c.v / 100;
        if (Math.abs(v - want) > (isUnitless(z.c) ? 1e-6 : 0.005)) it.push(z.where + ", " + (z.label || "a row") + ": shows " + (isUnitless(z.c) ? want : rup(z.c.v)) + " but adds up to " + (isUnitless(z.c) ? v : rup(Math.round(v * 100))));
      });
      M.notes.filter(n => n.print).forEach(n => n.tables.forEach(t => t.rows.forEach((r, i) => {
        const has = (r.c || []).some(c => c && typeof c === "object" && c.v);
        if (has && r.k === "r" && !String(r.t || "").trim()) it.push("Note " + n.no + " " + n.title + ": an amount on a row with no label (row " + (i + 1) + ")");
        if (r.c && t.cols && r.c.length !== t.cols.length - 1) it.push("Note " + n.no + " " + n.title + ": row " + (i + 1) + " has " + r.c.length + " amounts for " + (t.cols.length - 1) + " columns");
      })));
      if (M.det.auditorRem && M.notes.find(n => n.key === "exp")){
        const b = note("exp") && note("exp").tables.find(t => t.auditorRem), ar = (note("exp").tables[0].rows.find(r => r.t === "Auditor's Remuneration") || {c: [{v: 0}]}).c[0].v;
        if (b && totalRow(b).c[0].v !== ar) it.push("Note " + note("exp").no + ": the auditor's remuneration break-up " + rup(totalRow(b).c[0].v) + " does not equal the line " + rup(ar));
      }
      add(4, it); }
    // 5
    { const it = [];
      // each ledger; the stock ledgers, the surplus and the partners' accounts take last year's profit or closing stock
      const special = x => x.line === "inv" || (x.line === "reserves" && x.sub === "Surplus") || (M.firm && (x.line === "capital" || x.line === "current"));
      M.L.filter(x => x.hasPy && !x.pl && !special(x) && x.po + x.pd - x.pc !== x.o).forEach(x => it.push(x.l + ": last year's closing " + rup(x.po + x.pd - x.pc) + " is not this year's opening " + rup(x.o)));
      if (M.L.some(x => x.hasPy)){
        const S2 = M.stockCls, pyPat = -sum(M.L.filter(x => x.pl), x => x.pd - x.pc) + sum(X.SUBS.inv, k => S2[k].pyClose.v - S2[k].pyOpen.v - S2[k].pyMove.v);
        const RP = M.res.PY, pyClose = RP.sOpen.v + RP.profit.v + RP.adj.v + RP.transfer.v, cyOpen = M.res.CY.sOpen.v;
        if (Math.abs(pyClose - cyOpen) > 500) it.push("Surplus: last year's closing " + rup(pyClose) + " is not this year's opening " + rup(cyOpen) + (M.rolled ? "" : " (the books are not rolled over: give last year's closing stock)"));
        if (M.firm && M.rolled) M.partners.forEach(p => [p.capital, p.current].filter(Boolean).forEach((l, j) => { const x = M.L.find(z => z.l === l); if (!x) return;
          const share = (j === 1 || !p.current) ? pyPat * (Number(p.share) || 0) / 100 : 0, want = x.po + x.pd - x.pc - share;
          if (Math.abs(want - x.o) > 100) it.push(l + ": last year's closing with last year's profit share " + rup(want) + " is not this year's opening " + rup(x.o)); }));
      }
      const ly = M.det.lastYear || {};
      Object.keys(ly).forEach(k => { const f = V("L_" + k + "_PY"); if (R0(P(ly[k])) !== f) it.push(X.line(k).face + ": the previous-year column " + rup(f) + " is not last year's signed statements " + rup(P(ly[k]))); });
      const ppe = note("ppe");
      if (ppe && !ppe.itBlock){ const c = ppe.tables.find(t => t.far === "cy"), p2 = ppe.tables.find(t => t.far === "py");
        if (c && p2) c.rows.forEach((r, i) => { if (r.k !== "r") return; const q = p2.rows.find(z => z.t === r.t && z.k === "r"); if (!q) return;
          if (q.c[3].v !== r.c[0].v) it.push("Note " + ppe.no + " " + r.t + ": the previous period's closing gross block " + rup(q.c[3].v) + " is not the current period's opening " + rup(r.c[0].v));
          if (q.c[7].v !== r.c[4].v) it.push("Note " + ppe.no + " " + r.t + ": the previous period's closing depreciation " + rup(q.c[7].v) + " is not the current period's opening " + rup(r.c[4].v)); }); }
      if (ppe && ppe.itBlock){ const cy = ppe.cyBlocks || [], py = ppe.pyBlocks || []; cy.forEach(b => { const q = py.find(z => z.b === b.b); if (q && q.cells[9].v !== b.cells[0].v) it.push("Note " + ppe.no + " " + b.b + ": the previous year's closing WDV " + rup(q.cells[9].v) + " is not this year's opening " + rup(b.cells[0].v)); }); }
      add(5, it); }
    // 6
    { const it = [];
      ["tp", "tr"].forEach(k => { const n = note(k); if (!n) return;
        n.tables.filter(t => t.ageing).forEach(t => { const y = t.y === "cy" ? "CY" : "PY";
          t.rows.forEach(r => { const last = r.c.length - 1, s2 = sum(r.c.slice(0, last), c => c.v); if (s2 !== r.c[last].v) it.push(t.title + ", " + r.t + ": the buckets add to " + rup(s2) + ", not " + rup(r.c[last].v)); });
          const tot = R0(totalRow(t).c[r0len(t)].v); if (tot !== V("L_" + k + "_" + y)) it.push(t.title + ": the total " + rup(tot) + " is not the note total " + rup(V("L_" + k + "_" + y)));
          if (k === "tp"){ const ms = t.rows.filter(r => /MSME/.test(r.t) && r.k !== "t"), msT = sum(ms, r => r.c[r.c.length - 1].v);
            if (R0(msT) !== V("L_tpmse_" + y)) it.push(t.title + ": the MSME rows " + rup(msT) + " are not the micro and small enterprises on the face " + rup(V("L_tpmse_" + y))); }
          // each row against the ledgers when the data tells the categories apart
          for (let i = 1; i < t.rows.length - 1; i++) { /* rows are per category */ }
        });
        if (n.ageMissing && !M.firm) it.push(n.title + ": the ageing table is not given");
      });
      function r0len(t){ return t.cols.length - 2; }
      add(6, it); }
    // 7
    { const it = [], n = note("share");
      if (n && n.share){ const s = n.share;
        ["CY", "PY"].forEach(y => { const cnt = y === "CY" ? s.cyN.n : s.pyN.n, fv = y === "CY" ? s.cyFv.v : s.pyFv.v, faceV = V("L_share_" + y), rc = n.tables[1], recon = rc.rows[3].c[y === "CY" ? 1 : 3].v;
          if (Math.round(cnt * fv) !== faceV) it.push(y + ": " + cnt.toLocaleString("en-IN") + " shares x ₹" + rs(fv) + " = " + rup(Math.round(cnt * fv)) + ", but the face shows " + rup(faceV));
          if (recon !== faceV) it.push(y + ": the reconciliation's closing amount " + rup(recon) + " is not the face " + rup(faceV)); });
        if (s.cyFv.v !== s.pyFv.v && !(n.tables[1].rows[1].c[0].v)) it.push("The face value changed from ₹" + rs(s.pyFv.v) + " to ₹" + rs(s.cyFv.v) + " with no shares issued: a split or consolidation must be shown in the reconciliation");
        if (n.tables[1].rows[0].c[0].v !== s.pyN.n) it.push("The reconciliation's opening number " + n.tables[1].rows[0].c[0].v + " is not last year's closing " + s.pyN.n);
      }
      add(7, it); }
    // 8
    { const it = [], sp = M.res.CY["Securities Premium"], n = note("share");
      if (sp && sp.add.v > 0 && !(n && n.tables[1] && n.tables[1].rows[1].c[0].v > 0)) it.push("A securities premium of " + rup(sp.add.v) + " was added in the year, but the share capital reconciliation shows no shares issued");
      add(8, it); }
    // 9
    { const it = [], n = note("reserves");
      if (n){ const t = n.tables[0];
        t.rows.forEach((r, i) => { if (r.k === "r" && (r.c || []).some(c => c && c.v) && !String(r.t || "").trim()) it.push("Note " + n.no + ": an adjustment of " + rup((r.c[0] || {}).v || (r.c[1] || {}).v) + " in the surplus has no caption"); });
        ["CY", "PY"].forEach((y, j) => { const R = M.res[y];
          const sumAll = sum(t.rows.filter(r => r.k === "s"), r => r.c[j].v) + ((t.rows.find(r => r.t === "(+) Rounding Off") || {c: [{v: 0}, {v: 0}]}).c[j].v);
          if (sumAll !== totalRow(t).c[j].v) it.push(y + ": opening + profit +/- adjustments do not reach the closing reserves " + rup(totalRow(t).c[j].v) + " (they reach " + rup(sumAll) + ")");
          if (totalRow(t).c[j].v !== V("L_reserves_" + y)) it.push(y + ": the closing reserves are not the face");
          const pr = t.rows.find(r => /Net Profit/.test(r.t)); if (pr && pr.c[j].v !== V("T_pat_" + y)) it.push(y + ": the profit in reserves " + rup(pr.c[j].v) + " is not the profit for the year " + rup(V("T_pat_" + y))); });
      }
      add(9, it); }
    // 10
    { const it = [];
      if (M.firm && M.partners.length){
        const sh = sum(M.partners, p => Number(p.share) || 0); if (Math.abs(sh - 100) > 1e-6) it.push("The partners' shares add to " + sh + "%, not 100%");
        ["capital", "current"].forEach(k => { const n = note(k); if (!n) return; const t = n.tables[0];
          t.rows.filter(r => r.k === "r").forEach(r => { const s2 = sum(r.c.slice(1, 7), c => c.v); if (s2 !== r.c[7].v) it.push(n.title + ", " + r.t + ": opening + introduced + remuneration + interest - withdrawal + profit = " + rup(s2) + ", not " + rup(r.c[7].v)); }); });
        ["CY", "PY"].forEach(y => {
          const rows = M.pAcc.cap.concat(M.pAcc.cur).filter(r => r.y === y), pr = sum(rows, r => r.profit.v);
          if (rows.length && pr !== V("T_pat_" + y)) it.push(y + ": the partners' profit shares add to " + rup(pr) + ", not the profit " + rup(V("T_pat_" + y)));
          M.partners.forEach((p, i) => { const r = rows.filter(z => z.i === i), got = sum(r, z => z.profit.v), want = R0(V("T_pat_" + y) * (Number(p.share) || 0) / 100);
            if (Math.abs(got - want) > 100 * M.partners.length) it.push(y + ": " + p.name + "'s profit share " + rup(got) + " is not " + p.share + "% of the profit (" + rup(want) + ")"); });
          const rem = sum(rows, r => r.rem.v), int = sum(rows, r => r.int.v);
          const plRem = R0(sum(M.L.filter(x => x.line === "emp" && x.sub === "Partners' Remuneration"), x => y === "CY" ? x.cy : x.py)), plInt = R0(sum(M.L.filter(x => x.line === "fin" && x.sub === "Interest on Partners' Capital"), x => y === "CY" ? x.cy : x.py));
          if (rows.length && rem !== plRem) it.push(y + ": remuneration in the partners' accounts " + rup(rem) + " is not the P&L's " + rup(plRem));
          if (rows.length && int !== plInt) it.push(y + ": interest in the partners' accounts " + rup(int) + " is not the P&L's " + rup(plInt));
        });
      } else if (M.firm && M.kind !== "proprietor") it.push("The partners (names, shares, PAN and their capital and current account ledgers) are not given");
      add(10, it); }
    // 11
    { const it = [], n = note("ppe");
      if (n && !n.itBlock){
        if (n.farFromTb) it.push("No fixed asset register: the note shows the written down values from the ledgers; give the register (Details for you)");
        n.tables.filter(t => t.far).forEach(t => t.rows.filter(r => r.k === "r").forEach(r => {
          const c = r.c.map(z => z ? z.v : 0);
          if (c[0] + c[1] - c[2] !== c[3]) it.push(r.t + ": opening gross + additions - deductions is not the closing gross");
          if (c[4] + c[5] - c[6] !== c[7]) it.push(r.t + ": opening depreciation + for the year - on deductions is not the closing depreciation");
          if (c[3] - c[7] !== c[8]) it.push(r.t + ": gross less depreciation is not the net book value");
          if (c[1] < 0) it.push(r.t + " (" + (t.far === "cy" ? "current" : "previous") + " period): negative additions of " + rup(c[1]) + " (net accumulated depreciation through the deductions column instead)");
          if (c[5] < 0) it.push(r.t + ": a negative depreciation charge for the year");
          if (c[6] && !c[2]) it.push(r.t + ": depreciation on deductions with no deductions from the gross block");
        }));
        ["cy", "py"].forEach(y => { const t = n.tables.find(z => z.far === y); if (!t || n.farFromTb) return; const tr = totalRow(t) || t.rows.filter(r => r.k === "s").slice(-1)[0];
          const dep = sum(t.rows.filter(r => r.k === "s" || r.k === "t").filter(r => r.line || r.k === "t").slice(0, 1).concat([]), r => r.c[5].v);
          const allDep = sum(t.rows.filter(r => r.k === "r"), r => r.c[5].v), want = V("L_dep_" + y.toUpperCase());
          if (allDep !== want) it.push((y === "cy" ? "Current" : "Previous") + " period: depreciation for the year " + rup(allDep) + " is not the P&L depreciation " + rup(want)); });
      }
      if (n && n.itBlock){
        (n.cyBlocks || []).concat(n.pyBlocks || []).forEach(b => { const c = b.cells.map(z => z.v);
          // a short-term capital gain or loss (section 50): no depreciation, the block closes at nil
          const base1 = c[0] + c[1] - c[3], b2 = Math.max(0, c[2] + Math.min(0, base1)), dep = c[4] ? 0 : R0(Math.max(0, base1) * c[5] / 100 + b2 * c[5] / 200);
          if (dep !== c[6]) it.push(b.b + ": depreciation " + rup(c[6]) + " is not the rate on the block with half the rate on additions under 180 days (" + rup(dep) + ")");
          if (c[0] + c[1] + c[2] - c[3] - c[4] - c[6] - c[8] !== c[9]) it.push(b.b + ": opening WDV + additions - sale value - STCL / (STCG) - depreciation is not the closing WDV");
          if (c[1] < 0 || c[2] < 0) it.push(b.b + ": negative additions"); });
        const dc = sum(n.cyBlocks || [], b => b.cells[6].v + b.cells[8].v); if ((n.cyBlocks || []).length && dc !== V("L_dep_CY")) it.push("Depreciation in the blocks " + rup(dc) + " is not the P&L depreciation " + rup(V("L_dep_CY")) + " (difference " + rup(dc - V("L_dep_CY")) + ")");
        if (!(n.cyBlocks || []).length) it.push("The income-tax blocks are not given (Details for you)");
      }
      add(11, it); }
    // 12
    { const it = [];
      ["ltb", "stb"].forEach(k => { const n = note(k); if (!n) return; const t = n.tables.find(z => z.loanTable);
        const ls = (M.det.loans || []).filter(x => (x.table || "") === k || (!x.table && (M.L.find(z => z.l === x.ledger) || {}).line === k));
        ls.forEach(x => { const lz = M.L.find(z => z.l === x.ledger); if (lz && lz.line !== k) it.push(n.title + ": the repayment terms list " + (x.desc || x.ledger) + ", which is classified under " + X.line(lz.line).face);
          if (x.rate != null && Number(x.rate) > 0 && Number(x.rate) < 1) it.push((x.desc || x.ledger) + ": the interest rate is shown as " + x.rate + "; show it as a percentage (" + (Number(x.rate) * 100).toFixed(2) + "%)"); });
        if (t){ const tot = totalRow(t).c[1].v; if (tot !== V("L_" + k + "_CY")) it.push(n.title + ": the repayment terms table adds to " + rup(tot) + ", not the note's " + rup(V("L_" + k + "_CY"))); }
        else if (V("L_" + k + "_CY")) it.push(n.title + ": the repayment terms are not given (Details for you)");
        if (k === "ltb" && M.L.some(x => x.line === "ltb" && /CURRENT MATURIT/i.test(x.l))) it.push("Current maturities of long-term debt are in long-term borrowings: show them under short-term borrowings");
      });
      add(12, it); }
    // 13
    { const it = [];
      if (V("L_inv_CY") || V("L_inv_PY")){
        const S = M.stockCls, cl = sum(X.SUBS.inv, k => S[k].close.v), op = sum(X.SUBS.inv, k => S[k].open.v), pyc = sum(X.SUBS.inv, k => S[k].pyClose.v);
        if (cl !== V("L_inv_CY")) it.push("The closing stock in the notes " + rup(cl) + " is not the face " + rup(V("L_inv_CY")));
        if (!M.rolled && !(M.det.stock && M.det.stock.py) && op) it.push("The books are not rolled over to this year, so the stock ledgers still show last year's opening stock: give last year's closing stock (Details for you)");
        if (op !== pyc) it.push("The opening stock " + rup(op) + " (the stock ledgers at the start of the year) is not last year's closing " + rup(pyc));
        const ch = note("chg"); if (ch){ const t = ch.tables[0], c = t.rows[1].c[0].v, want = sum(["Work-in-progress", "Finished Goods", "Stock-in-trade"], k => S[k].close.v); if (c !== want) it.push("The change in inventories note's closing " + rup(c) + " is not the inventories note " + rup(want)); }
      }
      add(13, it); }
    // 14
    { const it = [];
      ["CY", "PY"].forEach(y => {
        const prov = R0(-sum(M.L.filter(x => x.line === "stp" && x.sub === "Provision for Taxation"), x => y === "CY" ? x.cy : x.py)), cur = V("L_taxcur_" + y);
        const adv = R0(sum(M.L.filter(x => x.line === "stla" && x.sub === "Advance Tax and TDS"), x => y === "CY" ? x.cy : x.py));
        const netting = (M.det.tax || {}).netted;
        if (cur && prov !== (netting ? cur - adv : cur) && prov !== cur) it.push(y + ": the provision for tax " + rup(prov) + " does not agree with the current tax " + rup(cur) + (netting ? " net of advance tax " + rup(cur - adv) : ""));
      });
      const ddt = (V("L_dta_CY") - V("L_dta_PY")) - (V("L_dtl_CY") - V("L_dtl_PY")), chg = V("L_taxdef_CY");
      if (-ddt !== chg) it.push("The movement in deferred tax on the balance sheet " + rup(-ddt) + " is not the deferred tax charge " + rup(chg));
      add(14, it); }
    // 15
    { const it = [], n = note("eps");
      if (n){ const t = n.tables[0], g = l => t.rows.find(r => r.t.startsWith(l));
        ["CY", "PY"].forEach((y, j) => {
          const a = g("Earnings attributable").c[j].v, b = g("Weighted average number of equity shares").c[j].v, basic = g("Basic").c[j].v, dil = g("Diluted").c[j].v, e = g("Dilutive potential").c[j].v, c = g("Adjustments to earnings").c[j].v;
          if (!b) it.push(y + ": the weighted average number of shares is not given");
          else if (Math.abs(a / 100 / b - basic) > 0.005) it.push(y + ": Basic EPS " + dec2(basic) + " is not earnings / weighted shares " + dec2(a / 100 / b));
          if (!e && Math.abs((basic || 0) - (dil || 0)) > 0.005) it.push(y + ": with no potential equity shares, Diluted EPS " + dec2(dil) + " must equal Basic " + dec2(basic) + (c ? " (an adjustment to earnings of " + rup(c) + " is given)" : ""));
        });
        const s = note("share"); if (s && s.share && n.faceValue !== s.share.cyFv.v) it.push("The face value in EPS is not Note " + s.no + "'s");
        const fl = face.pl.find(r => /^Basic \(Face value/.test(r.t)); if (fl && s && s.share && !fl.t.includes("₹ " + rs(s.share.cyFv.v) + " each")) it.push("The face value on the face of the P&L is not Note " + s.no + "'s");
      }
      add(15, it); }
    // 16
    { const it = [];
      (M.ratioList || []).forEach(r => {
        ["CY", "PY"].forEach(y => { const z = r[y]; const v = z.den.v ? z.num.v / z.den.v : null; if ((v == null) !== (z.v == null) || (v != null && Math.abs(v - z.v) > 1e-9)) it.push(r.name + " (" + y + "): shown " + z.v + ", recomputed " + v); });
        const want = r.CY.v != null && r.PY.v != null && r.PY.v !== 0 ? (r.CY.v - r.PY.v) / Math.abs(r.PY.v) : null;
        if ((want == null) !== (r.variance == null) || (want != null && Math.abs(want - r.variance) > 1e-9)) it.push(r.name + ": the % variance is not (CY - PY) / PY");
        if (want != null && Math.abs(want) > 0.25 && !String(r.reason || "").trim()) it.push(r.name + ": varies by " + pct2(want) + " and needs an explanation (Details for you)");
      });
      add(16, it); }
    // 17
    { const it = [], n = note("rp");
      if (n){ const c = n.tables.find(t => t.rpBal);
        (c ? c.rows : []).forEach(r => { if (!r.ledger) return; const lz = M.L.find(z => z.l === r.ledger); if (!lz) { it.push(r.t + ": the ledger " + r.ledger + " is not in the books"); return; }
          const s = X.line(lz.line) && X.line(lz.line).side === "L" ? -1 : 1;
          if (r.given && r.given.cy != null && R0(P(r.given.cy)) !== s * R0(lz.cy)) it.push(r.t + ": the balance given " + rup(P(r.given.cy)) + " is not the ledger's " + rup(s * R0(lz.cy))); });
      }
      const listed = new Set((M.det.rpLoans || []).map(x => x.ledger));
      M.L.filter(x => ["stla", "ltla"].includes(x.line) && x.sub === "Loans to related parties" && (x.cy || x.py) && !listed.has(x.l)).forEach(x => it.push(x.l + " (" + rup(x.cy) + ") is a loan to a related party in " + X.line(x.line).face + ", but it is not in the table of loans to promoters, directors, KMPs and related parties"));
      add(17, it); }
    // 18
    { const it = [], nums = M.notes.filter(n => n.print).map(n => n.no);
      nums.forEach((v, i) => { if (v !== i + 1) it.push("Note numbers are not in sequence at " + v); });
      const refs = new Set(), faceNos = [];
      face.bs.concat(face.pl).forEach(r => { if (r.note && r.note !== "-"){ refs.add(r.note); if (!M.noteNo[r.note]) it.push("The face refers to a note for " + (r.t || r.note) + " that does not exist"); else faceNos.push(M.noteNo[r.note]); } });
      M.notes.filter(n => n.print && !["gi", "sap", "other", "ratios", "ari", "rp", "eps"].includes(n.key)).forEach(n => { const ref = n.lines.some(k => refs.has(k)) || refs.has(n.key); if (!ref && !n.nil) it.push("Note " + n.no + " " + n.title + " is printed but not referred to on the face, and is not nil"); });
      if (M.co && (refs.has("gi") || refs.has("sap"))) {}
      add(18, it); }
    // 19
    { const it = [];
      allText().forEach(({n, x}) => {
        const re = /Refer Note\s*([^.;)]*)/gi; let m;
        while ((m = re.exec(x))){ const parts = m[1].split(/[,&]|and/).map(s => s.trim()).filter(s => s !== ""); if (!parts.length) { it.push("Note " + n.no + ": \"Refer Note\" with no number"); continue; }
          parts.forEach(pp => { if (!/^\d+$/.test(pp)) it.push("Note " + n.no + ": \"Refer Note " + m[1].trim() + "\" has a blank or broken number"); else if (!M.notes.some(z => z.print && z.no === +pp)) it.push("Note " + n.no + ": refers to Note " + pp + ", which does not exist"); }); }
      });
      // the ARI's loans clause must point to the loans and advances note
      const ari = note("ari"); if (ari){ ari.paras.filter(p => p.ari === "rpLoans").forEach(p => { const x = X.resolveRefs(p.x, M), m = /Refer Note (\d+)/.exec(x); if (m && +m[1] !== M.noteNo.stla && +m[1] !== M.noteNo.ltla) it.push("Note " + ari.no + ": the loans to promoters and directors point to Note " + m[1] + ", not the loans and advances note " + (M.noteNo.stla || "")); }); }
      add(19, it); }
    // 20
    { const it = [], seen = {};
      allText().forEach(({n, x}) => { const k = x.trim().toLowerCase().replace(/\s+/g, " "); if (k.length < 40) return; if (seen[k]) it.push("Note " + n.no + " repeats a paragraph already in Note " + seen[k].no + ": \"" + x.slice(0, 60) + "...\""); else seen[k] = n;
        const ss = x.replace(/\.\s+/g, ".\u0000").split("\u0000").map(s => s.trim().toLowerCase()).filter(s => s.length > 40); const d = ss.find((s, i) => ss.indexOf(s) !== i); if (d) it.push("Note " + n.no + " repeats a sentence: \"" + d.slice(0, 60) + "...\""); });
      add(20, it); }
    // 21
    { const it = [];
      allText().forEach(({n, x}) => { const s = x.trim(); if (!s) return;
        if (/\b(is|are|of|the|at|by|to|and|was)\s*[.,:]?$/i.test(s) || /\b(is|are)\s*\.$/i.test(s) || !/[.:;)%"']$/.test(s) && s.length > 30) it.push("Note " + n.no + ": a sentence is cut short: \"..." + s.slice(-50) + "\""); });
      add(21, it); }
    // 22
    { const it = [], k = M.kind;
      const wrong = k === "company" ? /\b(the Firm|Partners?'? (capital|current)|the Proprietor|Proprietor's)\b/i : k === "proprietor" ? /\b(the Company|the Firm|Board of Directors|shareholders?)\b/ : /\b(the Company|the Proprietor|Proprietor's|Board of Directors|shareholders?)\b/;
      allText().forEach(({n, x}) => { const m = wrong.exec(x); if (m) it.push("Note " + n.no + " says \"" + m[0] + "\", but this is a " + (X.KINDS[k] || k)); });
      add(22, it); }
    // 23
    { const it = [];
      M.notes.filter(n => n.print).forEach(n => n.tables.forEach(t => {
        const pyCols = t.cols.map((c, i) => [c, i]).filter(([c]) => /March 31, \d{4}/.test(c.h) && c.h.includes(M.D.pyAsAt.slice(-4)) && !c.h.includes(M.D.cyAsAt.slice(-4)));
        if (!pyCols.length) return;
        t.rows.forEach(r => pyCols.forEach(([c, i]) => { const cy = r.c && r.c[i - 1 - (pyCols.length > 1 ? 1 : 1)]; const v = r.c && r.c[i - 1]; if (r.k !== "h" && r.c && v === null && r.c.some(z => z && typeof z === "object" && z.v)) it.push("Note " + n.no + (t.title ? " (" + t.title + ")" : "") + ", " + r.t + ": the previous-year figure is blank"); }));
      }));
      add(23, it); }
    // 24
    { const it = [], s = M.det.sign || {}, a = s.auditor || {};
      [["frn", "the auditor's firm registration number (FRN)"], ["partner", "the signing partner"], ["mno", "the membership number (M.No)"], ["udin", "the UDIN"], ["date", "the date"], ["place", "the place"]].forEach(([k, l]) => { if (!String(a[k] || "").trim()) it.push("Missing: " + l); });
      if (a.mno && !/^\d{6}$/.test(String(a.mno))) it.push("The membership number " + a.mno + " is not 6 digits");
      if (a.udin && !/^\d{8}[A-Z0-9]{10}$/i.test(String(a.udin))) it.push("The UDIN " + a.udin + " is not in the 18-character form");
      if (a.frn && !/^\d{6}[A-Z]$|^[A-Z]\d{6}$/i.test(String(a.frn))) it.push("The FRN " + a.frn + " is not in the form 123456W");
      if (M.co){ const ds = s.directors || []; if (ds.length < 2) it.push("Two directors are needed to sign"); ds.forEach(d => { if (!/^\d{8}$/.test(String(d.din || ""))) it.push("Director " + (d.name || "") + ": DIN \"" + (d.din || "") + "\" is not 8 digits"); }); }
      else { const ps = M.kind === "proprietor" ? [s.proprietor || {}] : (s.partners || M.partners || []); if (!ps.length) it.push("The partners who sign are not given");
        ps.forEach(p => { if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(String(p.pan || "").toUpperCase())) it.push((p.name || "A partner") + ": PAN \"" + (p.pan || "") + "\" is not in the form AAAAA9999A"); }); }
      add(24, it); }
    // 25
    { const it = [], D = M.D;
      if ((M.units || X.UNITS) !== X.UNITS) it.push("The units line \"" + M.units + "\" does not match the whole rupees used");
      M.notes.filter(n => n.print).forEach(n => n.tables.forEach(t => {
        if (!t.cols) return; const hs = t.cols.slice(1).map(c => c.h);
        hs.forEach(h => { const m = /(As at|Year ended) March 31, (\d{4})/.exec(h); if (!m) return; const yr = +m[2];
          if (yr !== Number(M.fy) + 1 && yr !== Number(M.fy)) it.push("Note " + n.no + ": the column \"" + h + "\" is not for this year or last");
          if (X.isPL(n.lines[0] || "") && m[1] === "As at") it.push("Note " + n.no + ": a profit and loss note's column says \"As at\"");
          if (!X.isPL(n.lines[0] || "x") && n.lines.length && m[1] === "Year ended") it.push("Note " + n.no + ": a balance sheet note's column says \"Year ended\""); });
        hs.forEach(h => { const m = /April 01, (\d{4})/.exec(h); if (m && +m[1] !== Number(M.fy) && +m[1] !== Number(M.fy) - 1) it.push("Note " + n.no + ": the opening column \"" + h + "\" is not April 01 of the year"); });
      }));
      add(25, it); }
    // 26 (warnings)
    { const it = [];
      const coh = R0(sum(M.L.filter(x => x.line === "cash" && /Cash on hand/.test(x.sub)), x => x.cy));
      if (coh > 200000 * 100 || (V("T_as_CY") && coh > V("T_as_CY") * 0.05 && coh > 50000 * 100)) it.push("Cash on hand of " + rup(coh) + " is large");
      const tr = note("tr"), at = tr && tr.tables.find(t => t.ageing && t.y === "cy");
      if (at){ const g = at.rows[0]; if (g && g.c[6].v && !g.c[0].v && !g.c[1].v) it.push("Trade receivables show nothing not due or under 6 months"); }
      M.notes.filter(n => n.print).forEach(n => n.tables.filter(t => t.ageing).forEach(t => t.rows.filter(r => r.k !== "t").forEach(r => { for (let i = 1; i < r.c.length - 1; i++) if (r.c[i].v && r.c[i].v === r.c[i - 1].v) it.push(t.title + ", " + r.t + ": the same amount " + rup(r.c[i].v) + " in two adjacent buckets"); })));
      M.L.filter(x => x.line === "ltb" && x.sub === "Unsecured|Term loans from banks" && x.cy).forEach(x => it.push(x.l + ": a term loan from a bank shown as unsecured"));
      add(26, it, "warn"); }
    // 27
    { const it = [];
      (M.pages || []).forEach((p, i) => { const has = (p.items || []).some(k => k === "bs" || k === "pl" || k === "cf" || (M.notes.find(n => n.key === k && n.print) && (M.notes.find(n => n.key === k).tables.length || M.notes.find(n => n.key === k).paras.length))); if (!has) it.push("Page " + (i + 1) + " is blank"); });
      add(27, it); }
    return out;
  };
  X.UNITS = "(All amounts in ₹, unless otherwise stated)";

  // ------------------------------------------------------------ showing a figure
  X.show = function(c, unit){
    if (c == null) return "";
    if (typeof c === "string") return c;
    if (c.v == null) return "-";
    if (c.pc) return pct2(c.v);
    if (c.ratio) return c.v == null ? "-" : c.pc ? pct2(c.v) : dec2(c.v);
    if (c.eps) return dec2(c.v);
    if (c.cnt) return c.v ? Number(c.v).toLocaleString("en-IN") : "-";
    if (c.sh) return dec2(c.v);
    if (c.rt) return c.v ? dec2(c.v) + "%" : "-";
    return money(c.v);
  };
  // the header lines of a page, and the signature block
  X.head = function(M, kind){
    const e = M.ent, name = String(e.name || "").toUpperCase() + (e.udyam ? " (" + e.udyam + ")" : "");
    const ident = M.co ? (e.cin ? "CIN : " + e.cin : "") : (e.pan ? "PAN : " + e.pan : "");
    const title = kind === "bs" ? "Balance Sheet as at " + X.fyEnd(M.fy) : kind === "pl" ? "Statement of Profit and Loss for the year ended " + X.fyEnd(M.fy) : kind === "cf" ? "Cash Flow Statement for the year ended " + X.fyEnd(M.fy) : "Notes to the Financial Statements for the year ended " + X.fyEnd(M.fy);
    return kind === "notes" ? [name, title, M.units || X.UNITS] : [name].concat(ident ? [ident] : []).concat(e.address ? [e.address] : []).concat([title, M.units || X.UNITS]);
  };
  X.signLines = function(M){
    const s = M.det.sign || {}, a = s.auditor || {}, left = ["The accompanying notes are an integral part of the Financial Statements", "As per our report of even date attached", "For " + (a.firm || ""), "Chartered Accountants", "Firm Regn No : " + (a.frn || ""), "", "", (a.partner || ""), "Partner", "Membership No : " + (a.mno || ""), "UDIN : " + (a.udin || ""), "Place : " + (a.place || ""), "Date : " + (a.date || "")];
    let right;
    if (M.co){ right = ["For and on behalf of Board of Directors", String(M.ent.name || "").toUpperCase(), "", ""]; (s.directors || []).forEach(d => right.push("", d.name || "", d.role || "Director", "DIN : " + (d.din || ""))); right.push("", "Place : " + (s.place || a.place || ""), "Date : " + (s.date || a.date || "")); }
    else if (M.kind === "proprietor"){ const p = s.proprietor || {}; right = ["For " + String(M.ent.name || "").toUpperCase(), "", "", p.name || "", "PROPRIETOR", "PAN : " + (p.pan || ""), "", "Place : " + (s.place || a.place || ""), "Date : " + (s.date || a.date || "")]; }
    else { right = ["For " + String(M.ent.name || "").toUpperCase(), "", ""]; (s.partners || M.partners || []).forEach(p => right.push("", p.name || "", "PARTNER", "PAN : " + (p.pan || ""))); right.push("", "Place : " + (s.place || a.place || ""), "Date : " + (s.date || a.date || "")); }
    return {left, right};
  };

  // ------------------------------------------------------------ the statements as print-ready HTML (A4; "n / N" in the footer)
  X.html = function(M){
    const e = esc, D = M.D;
    const css = "@page{size:A4 portrait;margin:14mm 12mm 16mm;@bottom-right{content:counter(page) ' / ' counter(pages);font:9pt Calibri,Arial,sans-serif}}@page land{size:A4 landscape}" +
      "body{font:9.5pt Calibri,'Segoe UI',Arial,sans-serif;color:#000;margin:0;background:#fff}.pg{page-break-before:always;break-before:page}.pg:first-child{page-break-before:auto;break-before:auto}.pg.land{page:land}" +
      ".hd{text-align:center;border-bottom:1.2px solid #000;padding-bottom:4px;margin-bottom:8px}.hd b{font-size:12pt}.hd div{font-size:10pt}.hd .u{font-size:9pt;font-style:italic}" +
      "table{border-collapse:collapse;width:100%;margin:4px 0 8px}td,th{border:0.6px solid #000;padding:2px 5px;vertical-align:top}th{font-weight:bold;text-align:center;background:#fff}" +
      "td.n{text-align:right;white-space:nowrap;width:18%}td.nn{text-align:center;width:7%}tr.h td{font-weight:bold}tr.s td{font-weight:bold}tr.s td.n{border-top:1.2px solid #000}tr.t td{font-weight:bold}tr.t td:first-child{text-align:right}tr.t td.n{border-top:1.2px solid #000}" +
      "tr.gt td{font-weight:bold}tr.gt td.n{border-top:1.2px solid #000;border-bottom:3px double #000}h3{font-size:10.5pt;margin:10px 0 3px}h4{font-size:9.5pt;margin:6px 0 2px}p{margin:2px 0 4px;text-align:justify}" +
      ".sg{display:flex;justify-content:space-between;margin-top:18px;font-size:9pt}.sg div{width:46%}.sg div.r{text-align:right}.box{border:1px solid #000;padding:4px;margin:6px 0}";
    const head = k => '<div class="hd">' + X.head(M, k).map((l, i) => i === 0 ? "<b>" + e(l) + "</b>" : '<div class="' + (/^\(All amounts/.test(l) ? "u" : "") + '">' + e(l) + "</div>").join("") + "</div>";
    const sign = () => { const s = X.signLines(M); return '<div class="sg"><div>' + s.left.map(l => e(l) || "&nbsp;").join("<br>") + '</div><div class="r">' + s.right.map(l => e(l) || "&nbsp;").join("<br>") + "</div></div>"; };
    const faceT = (rows, pl) => '<table><thead><tr><th>Particulars</th><th>Note</th><th>' + e(pl ? D.cyYear : D.cyAsAt) + "</th><th>" + e(pl ? D.pyYear : D.pyAsAt) + "</th></tr></thead><tbody>" +
      rows.map(r => '<tr class="' + r.k + '"><td style="padding-left:' + (4 + r.ind * 12) + 'px">' + e(r.t) + '</td><td class="nn">' + (r.note === "-" ? "-" : r.note ? (M.noteNo[r.note] || "") : "") + '</td><td class="n">' + (r.c[0] ? X.show(r.c[0]) : "") + '</td><td class="n">' + (r.c[1] ? X.show(r.c[1]) : "") + "</td></tr>").join("") + "</tbody></table>";
    const tbl = t => {
      let h = (t.title ? "<h4>" + e(X.resolveRefs(t.title, M)) + "</h4>" : "") + '<table' + (t.box ? ' class="box"' : "") + "><thead>";
      if (t.bands) h += "<tr>" + t.bands.map(([b, s]) => '<th colspan="' + s + '">' + e(b) + "</th>").join("") + "</tr>";
      h += "<tr>" + t.cols.map(c => "<th>" + e(c.h) + "</th>").join("") + "</tr></thead><tbody>";
      t.rows.forEach(r => { h += '<tr class="' + r.k + '"><td style="padding-left:' + (4 + (r.ind || 0) * 12) + 'px">' + e(r.t) + "</td>" + (r.c || []).map((c, j) => { const col = t.cols[j + 1] || {}; return col.n ? '<td class="n">' + X.show(c) + "</td>" : "<td>" + e(typeof c === "string" ? c : c == null ? "" : X.show(c)) + "</td>"; }).join("") + "</tr>"; });
      return h + "</tbody></table>";
    };
    const noteH = n => {
      let h = "<h3>" + n.no + ". " + e(n.title) + "</h3>";
      const paras = n.paras.map(p => p.t === "h" ? "<h4>" + e(X.resolveRefs(p.x, M)) + "</h4>" : "<p" + (p.t === "li" ? ' style="padding-left:14px"' : "") + ">" + e(X.resolveRefs(p.x, M)) + "</p>").join("");
      const before = n.key === "share" ? 2 : n.tables.length;     // share capital: (a), (b), then the prose (c), then (d)..(g)
      h += n.tables.slice(0, before).map(tbl).join("") + paras + n.tables.slice(before).map(tbl).join("");
      if (n.sign) h += sign();
      return h;
    };
    let body = "";
    M.pages.forEach(p => {
      body += '<section class="pg' + (p.landscape ? " land" : "") + '" data-page="' + p.kind + '">' + head(p.kind);
      if (p.kind === "bs") body += faceT(M.face2.bs, false) + sign();
      else if (p.kind === "pl") body += faceT(M.face2.pl, true) + sign();
      else if (p.kind === "cf") body += '<table><thead><tr><th>Particulars</th><th>' + e(D.cyYear) + "</th></tr></thead><tbody>" + M.cf.rows.map(r => '<tr class="' + r.k + '"><td>' + e(X.resolveRefs(r.t, M)) + '</td><td class="n">' + (r.c[0] ? X.show(r.c[0]) : "") + "</td></tr>").join("") + "</tbody></table>" + sign();
      else p.items.forEach(k => { const n = M.notes.find(z => z.key === k); if (n) body += noteH(n); });
      body += "</section>";
    });
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + e(M.ent.name + " - Financial Statements " + X.fyLabel(M.fy)) + "</title><style>" + css + "</style></head><body>" + body + "</body></html>";
  };

  // ------------------------------------------------------------ a zip (stored), for xlsx and docx
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  X.zip = function(files){
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    files.forEach(([name, data]) => {
      const nb = enc.encode(name), db = typeof data === "string" ? enc.encode(data) : data, c = crc32(db);
      const loc = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(c), u32(db.length), u32(db.length), u16(nb.length), u16(0));
      parts.push(Uint8Array.from(loc), nb, db);
      cen.push([[].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(c), u32(db.length), u32(db.length), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off)), nb]);
      off += loc.length + nb.length + db.length;
    });
    let cl = 0; cen.forEach(([h, nb]) => { parts.push(Uint8Array.from(h), nb); cl += h.length + nb.length; });
    parts.push(Uint8Array.from([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cl), u32(off), u16(0))));
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  };
  const xe = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const colL = i => { let s = ""; i++; while (i > 0){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  X.colL = colL;

  // ------------------------------------------------------------ a workbook writer: sheets of cells, formulas with cached values, names
  // sheet: {name, rows: [[cell...]], widths: [..]}; cell: null | string | number | {v, f, s: style, t: "s"|"n"|"str"}
  // styles: 0 plain, 1 bold, 2 money, 3 money bold, 4 percent, 5 two decimals, 6 count, 7 heading, 8 percent bold, 9 money double-rule total
  X.xlsx = function(sheets, names){
    const sst = [], sIdx = {};
    const si = s => { s = String(s); if (sIdx[s] == null){ sIdx[s] = sst.length; sst.push(s); } return sIdx[s]; };
    const sheetXml = sh => {
      let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
      if (sh.widths) x += "<cols>" + sh.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("") + "</cols>";
      x += "<sheetData>";
      sh.rows.forEach((r, ri) => {
        if (!r || !r.length) return;
        x += '<row r="' + (ri + 1) + '">';
        r.forEach((c, ci) => {
          if (c == null || c === "") return;
          const ref = colL(ci) + (ri + 1);
          if (typeof c === "string"){ x += '<c r="' + ref + '" t="s"><v>' + si(c) + "</v></c>"; return; }
          if (typeof c === "number"){ x += '<c r="' + ref + '"><v>' + c + "</v></c>"; return; }
          const st = c.s ? ' s="' + c.s + '"' : "";
          if (c.f){
            const isStr = typeof c.v === "string";
            x += '<c r="' + ref + '"' + st + (isStr ? ' t="str"' : "") + "><f>" + xe(c.f) + "</f>" + (c.v == null ? "" : "<v>" + xe(isStr ? c.v : (isFinite(c.v) ? c.v : 0)) + "</v>") + "</c>";
          } else if (typeof c.v === "string") x += '<c r="' + ref + '" t="s"' + st + "><v>" + si(c.v) + "</v></c>";
          else if (c.v != null && isFinite(c.v)) x += '<c r="' + ref + '"' + st + "><v>" + c.v + "</v></c>";
        });
        x += "</row>";
      });
      x += "</sheetData>";
      if (sh.landscape) x += '<pageSetup orientation="landscape" paperSize="9"/>';
      return x + "</worksheet>";
    };
    const files = [];
    const wsx = sheets.map(sheetXml);
    files.push(["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>']);
    files.push(["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
    const dn = Object.entries(names || {}).sort((a, b) => a[0].localeCompare(b[0])).map(([n, ref]) => '<definedName name="' + xe(n) + '">' + xe(ref) + "</definedName>").join("");
    files.push(["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => '<sheet name="' + xe(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + "</sheets>" + (dn ? "<definedNames>" + dn + "</definedNames>" : "") + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>']);
    files.push(["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId' + (sheets.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>']);
    files.push(["xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0;(#,##0);&quot;-&quot;"/><numFmt numFmtId="165" formatCode="0.00%"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts>' +
      '<fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="3"><border/><border><top style="thin"/></border><border><top style="thin"/><bottom style="double"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="10">' +
      '<xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/><xf numFmtId="3" applyNumberFormat="1"/><xf fontId="1" applyFont="1"/><xf numFmtId="165" fontId="1" applyNumberFormat="1" applyFont="1"/><xf numFmtId="164" fontId="1" borderId="2" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
      "</cellXfs></styleSheet>"]);
    files.push(["xl/sharedStrings.xml", "x"]);
    wsx.forEach((x, i) => files.push(["xl/worksheets/sheet" + (i + 1) + ".xml", x]));
    // shared strings after the sheets are written (the sheets fill sst)
    files[files.findIndex(f => f[0] === "xl/sharedStrings.xml")][1] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + sst.length + '" uniqueCount="' + sst.length + '">' + sst.map(s => '<si><t xml:space="preserve">' + xe(s) + "</t></si>").join("") + "</sst>";
    return X.zip(files);
  };

  // ------------------------------------------------------------ the statements as Excel: every figure a live formula
  X.excel = function(M, checks){
    const sheets = [], names = {}, placed = new Set(), D = M.D;
    const q = s => "'" + String(s).replace(/'/g, "''") + "'";
    // TB
    const tb = {name: "TB", rows: [["Ledger", "Tally group", "Primary group", "Line", "Sub-head", "Nature", "Opening (Dr +)", "Debit", "Credit", "Closing (Dr +)", "Amount this year (Dr +)", "Opening last year (Dr +)", "Debit last year", "Credit last year", "Amount last year (Dr +)", "Last year known", "Mapping by"]], widths: [38, 24, 22, 10, 40, 8, 16, 16, 16, 16, 18, 16, 16, 16, 18, 8, 10]};
    M.L.forEach((x, i) => { const r = i + 2;
      tb.rows.push([x.l, x.g[0] || "", x.g[x.g.length - 1] || "", x.line, x.sub, x.pl ? "PL" : "BS", {v: x.o / 100, s: 2}, {v: x.d / 100, s: 2}, {v: x.c / 100, s: 2}, {v: (x.o + x.d - x.c) / 100, f: "G" + r + "+H" + r + "-I" + r, s: 2},
        {v: x.cy / 100, f: "IF(F" + r + "=\"PL\",H" + r + "-I" + r + ",J" + r + ")", s: 2}, {v: x.po / 100, s: 2}, {v: x.pd / 100, s: 2}, {v: x.pc / 100, s: 2},
        {v: x.py / 100, f: "IF(F" + r + "=\"PL\",M" + r + "-N" + r + ",IF(AND(P" + r + "=1,D" + r + "<>\"inv\"),L" + r + "+M" + r + "-N" + r + ",G" + r + "))", s: 2}, x.hasPy ? 1 : 0, x.by || ""]); });
    const n1 = Math.max(2, M.L.length + 1), rng = c => "TB!$" + c + "$2:$" + c + "$" + n1;
    Object.assign(names, {TB_LEDGER: rng("A"), TB_LINE: rng("D"), TB_SUB: rng("E"), TB_NATURE: rng("F"), TB_O: rng("G"), TB_D: rng("H"), TB_C: rng("I"), TB_CY: rng("K"), TB_PO: rng("L"), TB_PD: rng("M"), TB_PC: rng("N"), TB_PY: rng("O")});
    tb.rows.push([], ["Total", "", "", "", "", "", {v: sum(M.L, x => x.o) / 100, f: "SUM(G2:G" + n1 + ")", s: 3}, {v: sum(M.L, x => x.d) / 100, f: "SUM(H2:H" + n1 + ")", s: 3}, {v: sum(M.L, x => x.c) / 100, f: "SUM(I2:I" + n1 + ")", s: 3}, {v: sum(M.L, x => x.o + x.d - x.c) / 100, f: "SUM(J2:J" + n1 + ")", s: 3}]);
    sheets.push(tb);
    // Details: the figures Tally does not hold
    const det = {name: "Details", rows: [["Details for you (figures Tally does not hold)", "", ""], ["Group", "Item", "Value"]], widths: [26, 70, 18]};
    M.inputs.forEach(z => { det.rows.push([z.group, z.label, z.n != null ? {v: z.n, s: 6} : {v: z.v / 100, s: 2}]); names[z.nm] = "Details!$C$" + det.rows.length; placed.add(z.nm); });
    sheets.push(det);
    const style = (c, k) => c.pc ? (k === "t" ? 8 : 4) : c.eps || c.ratio || c.sh || c.rt ? 5 : c.cnt ? 6 : k === "gt" ? 9 : k === "t" || k === "s" ? 3 : 2;
    const xv = c => typeof c.v === "string" ? c.v : c.v == null ? null : (isUnitless(c) ? c.v : c.v / 100);
    // a table onto a sheet at a row; #R#, #C#, #T# become addresses
    const putTable = (sh, t, startRow, colOff) => {
      colOff = colOff || 0;
      if (t.title){ sh.rows[startRow] = [{v: X.resolveRefs(t.title, M), s: 1}]; startRow++; }
      if (t.bands){ const r = []; let c = 0; t.bands.forEach(([b, s]) => { r[c] = b ? {v: b, s: 7} : ""; c += s; }); sh.rows[startRow] = r; startRow++; }
      sh.rows[startRow] = t.cols.map(c => ({v: c.h, s: 7})); startRow++;
      const base = startRow, tIdx = t.rows.findIndex(r => r.k === "t");
      t.rows.forEach((r, i) => {
        const row = [{v: r.t || "", s: r.k === "h" || r.k === "t" || r.k === "gt" ? 1 : 0}];
        (r.c || []).forEach((c, j) => {
          if (c == null){ row.push(""); return; }
          if (typeof c === "string"){ row.push(c); return; }
          const col = colL(j + 1 + colOff);
          let f = c.f ? String(c.f).replace(/#R(\d+)#/g, (m, k) => col + (base + Number(k) + 1)).replace(/#C(\d+)#/g, (m, k) => colL(Number(k) + colOff) + (base + i + 1)).replace(/#T#/g, () => col + (base + tIdx + 1)) : null;
          const cell = {v: xv(c), f, s: style(c, r.k)};
          row.push(cell);
          if (c.nm && !placed.has(c.nm)){ names[c.nm] = q(sh.name) + "!$" + col + "$" + (base + i + 1); placed.add(c.nm); }
        });
        sh.rows[base + i] = row;
      });
      return base + t.rows.length + 1;
    };
    // the faces
    const face = (title, rows, pl) => {
      const sh = {name: title, rows: [], widths: [70, 8, 20, 20]};
      X.head(M, pl === "cf" ? "cf" : pl ? "pl" : "bs").forEach((l, i) => sh.rows.push([{v: l, s: i === 0 ? 1 : 0}]));
      sh.rows.push([]);
      // the face's own figures carry the line names (L_*, T_*, S_*, E_*): the cell itself, with its formula to the TB
      const own = c => { if (!c) return null; const n = c.f, tg = n && M.cellsByName[n]; return tg && /^(L|T|S)_/.test(n) && !placed.has(n) && tg !== c ? Object.assign({}, tg, {nm: n}) : Object.assign({}, c, {nm: null}); };
      const t = {cols: [{h: "Particulars"}, {h: "Note"}, {h: pl ? D.cyYear : D.cyAsAt, n: 1}, {h: pl ? D.pyYear : D.pyAsAt, n: 1}], rows: rows.map(r => ({t: r.t, k: r.k, c: [r.note === "-" ? "-" : r.note ? String(M.noteNo[r.note] || "") : null].concat(r.c.map(own))}))};
      putTable(sh, t, sh.rows.length, 0);
      const s = X.signLines(M); sh.rows.push([]); const n0 = sh.rows.length; s.left.forEach((l, i) => { sh.rows[n0 + i] = [l, "", s.right[i] || ""]; }); for (let i = s.left.length; i < s.right.length; i++) sh.rows[n0 + i] = ["", "", s.right[i]];
      sheets.push(sh);
    };
    face("Balance Sheet", M.face2.bs, false);
    face("Profit and Loss", M.face2.pl, true);
    if (M.cf){ const sh = {name: "Cash Flow", rows: [], widths: [80, 20]}; X.head(M, "cf").forEach(l => sh.rows.push([l])); sh.rows.push([]); putTable(sh, {cols: [{h: "Particulars"}, {h: D.cyYear, n: 1}], rows: M.cf.rows.map(r => Object.assign({}, r, {t: X.resolveRefs(r.t, M)}))}, sh.rows.length, 0); sheets.push(sh); }
    // the notes, one after another
    const ns = {name: "Notes", rows: [], widths: [60, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18]};
    X.head(M, "notes").forEach(l => ns.rows.push([l])); ns.rows.push([]);
    M.notes.filter(n => n.print).forEach(n => {
      ns.rows.push([{v: n.no + ". " + n.title, s: 1}]);
      const before = n.key === "share" ? 2 : n.tables.length;
      n.tables.slice(0, before).forEach(t => { const r = putTable(ns, t, ns.rows.length, 0); ns.rows.length = Math.max(ns.rows.length, r); });
      n.paras.forEach(p => ns.rows.push([X.resolveRefs(p.x, M)]));
      n.tables.slice(before).forEach(t => { const r = putTable(ns, t, ns.rows.length, 0); ns.rows.length = Math.max(ns.rows.length, r); });
      ns.rows.push([]);
    });
    sheets.push(ns);
    // the named figures not on any sheet yet (the previous year's partners' shares, intermediate totals)
    const calc = {name: "Calc", rows: [["Name", "Value"]], widths: [30, 20]};
    const want = new Set(); const scan = f => String(f || "").replace(/"[^"]*"/g, "").replace(/[A-Za-z_][A-Za-z0-9_]*/g, w => { if (M.cellsByName[w] || M.nm[w] != null) want.add(w); return w; });
    sheets.forEach(s => s.rows.forEach(r => (r || []).forEach(c => { if (c && c.f) scan(c.f); })));
    let grew = true;
    while (grew){ grew = false; Array.from(want).forEach(w => { if (placed.has(w)) return; const c = M.cellsByName[w]; if (!c) return; placed.add(w); calc.rows.push([w, {v: xv(c), f: c.f, s: style(c, "r")}]); names[w] = "Calc!$B$" + calc.rows.length; if (c.f){ const before = want.size; scan(c.f); if (want.size > before) grew = true; } }); }
    sheets.push(calc);
    if (checks){ const ck = {name: "Checks", rows: [["#", "Check", "Result", "What to look at"]], widths: [5, 80, 10, 100]}; checks.forEach(c => { if (c.ok) ck.rows.push([c.id, c.title, "OK", ""]); else c.items.forEach((x, i) => ck.rows.push([i ? "" : c.id, i ? "" : c.title, i ? "" : (c.level === "warn" ? "Warning" : "FAIL"), x])); }); sheets.push(ck); }
    return {bytes: X.xlsx(sheets, names), sheets, names};
  };

  // ------------------------------------------------------------ Word: one section per printed page group (its own header,
  // portrait or landscape), the footer "n / N" (PAGE / NUMPAGES), boxed tables, double rule under totals
  X.docx = function(blocks, o){
    // blocks: [{section: {head: [lines], landscape}, items: [{p: text, b, center, right, size, keep} | {table: {cols, rows, widths}} | {sign: {left, right}} | {pb: true}]}]
    o = o || {};
    const W = (t, b, sz, al, it) => "<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"40\"/>" + (al ? '<w:jc w:val="' + al + '"/>' : "") + "</w:pPr><w:r><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\"/>" + (b ? "<w:b/>" : "") + (it ? "<w:i/>" : "") + '<w:sz w:val="' + (sz || 19) + '"/></w:rPr><w:t xml:space="preserve">' + xe(t) + "</w:t></w:r></w:p>";
    const bd = (top, bot) => '<w:tcBorders><w:top w:val="single" w:sz="' + (top === "single8" ? 12 : 4) + '"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="' + (bot === "double" ? "double" : "single") + '" w:sz="' + (bot === "double" ? 6 : 4) + '"/><w:right w:val="single" w:sz="4"/></w:tcBorders>';
    const tblX = (t, landscape) => {
      const full = landscape ? 15000 : 10000, n = t.cols.length, first = Math.round(full * (n > 4 ? 0.28 : 0.52)), rest = Math.round((full - first) / Math.max(1, n - 1));
      const ws = t.cols.map((c, i) => i === 0 ? first : rest);
      let x = '<w:tbl><w:tblPr><w:tblW w:w="' + full + '" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + ws.map(w => '<w:gridCol w:w="' + w + '"/>').join("") + "</w:tblGrid>";
      const tc = (txt, w, o2) => '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (o2.span > 1 ? '<w:gridSpan w:val="' + o2.span + '"/>' : "") + bd(o2.top, o2.bot) + "</w:tcPr>" + W(txt, o2.b, o2.sz || 17, o2.al) + "</w:tc>";
      if (t.bands){ x += "<w:tr><w:trPr><w:tblHeader/></w:trPr>"; let c = 0; t.bands.forEach(([b, s]) => { x += tc(b, sum(ws.slice(c, c + s)), {b: 1, al: "center", span: s}); c += s; }); x += "</w:tr>"; }
      x += "<w:tr><w:trPr><w:tblHeader/></w:trPr>" + t.cols.map((c, i) => tc(c.h, ws[i], {b: 1, al: "center"})).join("") + "</w:tr>";
      t.rows.forEach(r => {
        const b = ["h", "s", "t", "gt"].includes(r.k), top = r.k === "s" || r.k === "t" || r.k === "gt" ? "single8" : "single", bot = r.k === "gt" ? "double" : "single";
        x += "<w:tr><w:trPr><w:cantSplit/></w:trPr>" + tc((r.ind ? " ".repeat(r.ind) : "") + (r.t || ""), ws[0], {b, al: r.k === "t" ? "right" : null, top: "single", bot: "single"}) +
          (r.c || []).map((c, j) => { const col = t.cols[j + 1] || {}; return tc(typeof c === "string" ? c : X.show(c), ws[j + 1], {b, al: col.n ? "right" : null, top: col.n ? top : "single", bot: col.n ? bot : "single"}); }).join("") + "</w:tr>";
      });
      return x + "</w:tbl>" + W("", 0, 8);
    };
    const signX = s => {
      const rows = Math.max(s.left.length, s.right.length);
      let x = '<w:tbl><w:tblPr><w:tblW w:w="10000" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="5000"/></w:tblGrid>';
      for (let i = 0; i < rows; i++) x += "<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w=\"5000\" w:type=\"dxa\"/></w:tcPr>" + W(s.left[i] || "", /^For /.test(s.left[i] || ""), 17) + "</w:tc><w:tc><w:tcPr><w:tcW w:w=\"5000\" w:type=\"dxa\"/></w:tcPr>" + W(s.right[i] || "", /^For /.test(s.right[i] || ""), 17, "right") + "</w:tc></w:tr>";
      return x + "</w:tbl>";
    };
    const headers = [];
    let body = "";
    blocks.forEach((bk, bi) => {
      bk.items.forEach(it => {
        if (it.table) body += tblX(it.table, bk.section.landscape);
        else if (it.sign) body += signX(it.sign);
        else body += W(it.p, it.b, it.size, it.center ? "center" : it.right ? "right" : (it.justify ? "both" : null), it.i);
      });
      headers.push(bk.section.head);
      const land = bk.section.landscape, last = bi === blocks.length - 1;
      const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rIdH' + (bi + 1) + '"/><w:footerReference w:type="default" r:id="rIdF"/>' + (land ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>') +
        '<w:pgMar w:top="1300" w:right="800" w:bottom="1000" w:left="800" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr>';
      body += last ? sect : "<w:p><w:pPr>" + sect + "</w:pPr></w:p>";
    });
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + "><w:body>" + body + "</w:body></w:document>";
    const footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + NS + '><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="17"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:rPr><w:sz w:val="17"/></w:rPr><w:t xml:space="preserve"> / </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' + (o.footerNote ? W(o.footerNote, 0, 15, "left", 1) : "") + "</w:ftr>";
    const hdrX = lines => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ' + NS + ">" + lines.map((l, i) => W(l, i === 0 || /^(DRAFT|Balance Sheet|Statement|Notes|Cash Flow)/.test(l), i === 0 ? 24 : 19, "center", /^\(All amounts/.test(l))).join("") +
      '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1"/></w:pBdr><w:spacing w:after="0"/></w:pPr></w:p></w:hdr>';
    const files = [["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      headers.map((h, i) => '<Override PartName="/word/header' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>').join("") + "</Types>"],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ["word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
        headers.map((h, i) => '<Relationship Id="rIdH' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header' + (i + 1) + '.xml"/>').join("") + "</Relationships>"],
      ["word/document.xml", doc], ["word/footer1.xml", footer]].concat(headers.map((h, i) => ["word/header" + (i + 1) + ".xml", hdrX(h)]));
    return X.zip(files);
  };
  // the statements as Word: the same pages as the print view
  X.word = function(M){
    const blocks = [], D = M.D;
    const faceTable = (rows, pl) => ({cols: [{h: "Particulars"}, {h: "Note"}, {h: pl ? D.cyYear : D.cyAsAt, n: 1}, {h: pl ? D.pyYear : D.pyAsAt, n: 1}],
      rows: rows.map(r => ({t: r.t, k: r.k, ind: r.ind, c: [r.note === "-" ? "-" : r.note ? String(M.noteNo[r.note] || "") : "", r.c[0] || "", r.c[1] || ""]}))});
    const noteItems = n => {
      const it = [{p: n.no + ". " + n.title, b: 1, size: 21}];
      const before = n.key === "share" ? 2 : n.tables.length, tb = t => (t.title ? [{p: X.resolveRefs(t.title, M), b: 1}] : []).concat([{table: t}]);
      n.tables.slice(0, before).forEach(t => it.push(...tb(t)));
      n.paras.forEach(p => it.push({p: X.resolveRefs(p.x, M), b: p.t === "h", justify: p.t !== "h"}));
      n.tables.slice(before).forEach(t => it.push(...tb(t)));
      if (n.sign) it.push({p: ""}, {sign: X.signLines(M)});
      return it;
    };
    M.pages.forEach(p => {
      const items = [];
      if (p.kind === "bs") items.push({table: faceTable(M.face2.bs, false)}, {p: ""}, {sign: X.signLines(M)});
      else if (p.kind === "pl") items.push({table: faceTable(M.face2.pl, true)}, {p: ""}, {sign: X.signLines(M)});
      else if (p.kind === "cf") items.push({table: {cols: [{h: "Particulars"}, {h: D.cyYear, n: 1}], rows: M.cf.rows.map(r => Object.assign({}, r, {t: X.resolveRefs(r.t, M)}))}}, {p: ""}, {sign: X.signLines(M)});
      else p.items.forEach(k => { const n = M.notes.find(z => z.key === k); if (n) items.push(...noteItems(n)); });
      blocks.push({section: {head: X.head(M, p.kind), landscape: !!p.landscape}, items});
    });
    return X.docx(blocks);
  };

  // ------------------------------------------------------------ the provisional TB for the firm's utility (columns chosen)
  X.TB_COLS = [["ledger", "Ledger Name"], ["primary", "Tally Group (Primary)"], ["parent", "Parent Group"], ["opDr", "Opening Dr"], ["opCr", "Opening Cr"], ["dr", "Debit"], ["cr", "Credit"], ["clDr", "Closing Dr"], ["clCr", "Closing Cr"],
    ["closing", "Closing (Dr +, Cr -)"], ["pyClosing", "PY Closing (Dr +, Cr -)"], ["line", "Schedule III line"], ["sub", "Sub-head"], ["nature", "BS / PL"]];
  X.TB_DEFAULT = ["ledger", "primary", "parent", "opDr", "opCr", "dr", "cr", "clDr", "clCr", "pyClosing"];
  X.tbExport = function(M, cols, o){
    cols = (cols && cols.length ? cols : X.TB_DEFAULT).filter(k => X.TB_COLS.some(z => z[0] === k));
    o = o || {};
    const lab = k => (X.TB_COLS.find(z => z[0] === k) || [k, k])[1];
    const val = (x, k) => { const cl = x.o + x.d - x.c, py = x.pl ? x.pd - x.pc : (x.hasPy ? x.po + x.pd - x.pc : x.o);
      return {ledger: x.l, primary: x.g[x.g.length - 1] || "", parent: x.g[0] || "", opDr: x.o > 0 ? x.o / 100 : 0, opCr: x.o < 0 ? -x.o / 100 : 0, dr: x.d / 100, cr: x.c / 100, clDr: cl > 0 ? cl / 100 : 0, clCr: cl < 0 ? -cl / 100 : 0,
        closing: cl / 100, pyClosing: py / 100, line: x.line ? (X.line(x.line) || {face: x.line}).face : "", sub: x.sub, nature: x.pl ? "PL" : "BS"}[k]; };
    const rows = [cols.map(lab)].concat(M.L.map(x => cols.map(k => val(x, k))));
    const tot = cols.map((k, i) => i === 0 ? "Total" : ["opDr", "opCr", "dr", "cr", "clDr", "clCr", "closing", "pyClosing"].includes(k) ? Math.round(sum(M.L, x => val(x, k)) * 100) / 100 : "");
    rows.push(tot);
    if (o.csv) return rows.map(r => r.map(v => typeof v === "number" ? String(v) : '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const s = M.det.sign || {}, a = s.auditor || {}, e = M.ent;
    const basic = [["Basic details", ""], ["Entity name", e.name || ""], ["Entity type", X.KINDS[M.kind] || M.kind], [M.co ? "CIN" : "PAN", M.co ? e.cin || "" : e.pan || ""], ["PAN", e.pan || ""], ["Address", e.address || ""], ["Financial year", X.fyLabel(M.fy)],
      ["Auditor firm", a.firm || ""], ["FRN", a.frn || ""], ["Partner", a.partner || ""], ["M.No", a.mno || ""], ["UDIN", a.udin || ""], ["Place", a.place || ""], ["Date", a.date || ""]]
      .concat((M.co ? (s.directors || []) : (s.partners || M.partners || [])).map((p, i) => [(M.co ? "Director " : "Partner ") + (i + 1), (p.name || "") + (M.co ? ", DIN " + (p.din || "") : ", PAN " + (p.pan || ""))]));
    const n = rows.length;
    const sh = {name: "TB", rows: rows.map((r, i) => i === n - 1 ? r.map((v, j) => typeof v === "number" ? {v, f: "SUM(" + colL(j) + "2:" + colL(j) + (n - 1) + ")", s: 3} : v) : r.map(v => typeof v === "number" ? {v, s: 2} : v)), widths: cols.map(k => k === "ledger" ? 40 : 18)};
    return X.xlsx([sh, {name: "Basic details", rows: basic, widths: [24, 60]}], {});
  };

  // ------------------------------------------------------------ the cash-basis MIS: receipts and payments by head and month,
  // from the cash and bank vouchers, reconciled to the profit on the accrual basis
  // inp: {entity, from, to (YYYY-MM-DD), tb: [{l, g, o, d, c}], vouchers: [{date, no, type, ent: [{l, a}]}] (a Dr positive, rupees), map}
  X.isCashLed = g => (g || []).some(s => /^(cash-in-hand|bank accounts|bank od a\/c|bank occ a\/c)$/i.test(s));
  X.cashMis = function(inp){
    const gOf = {}; (inp.tb || []).forEach(t => { gOf[t.l] = t.g || []; });
    const isCash = l => X.isCashLed(gOf[l]), head = l => { const g = gOf[l] || []; return g[0] || "(not grouped)"; };
    const lines = [], months = new Set();
    (inp.vouchers || []).filter(v => v.date >= inp.from && v.date <= inp.to && !v.cancel && !v.opt).forEach(v => {
      const ent = v.ent.map(e => ({l: e.l, a: P(e.a)}));
      const cash = sum(ent.filter(e => isCash(e.l)), e => e.a);
      if (!cash) return;
      const m = v.date.slice(0, 7); months.add(m);
      // the cash goes to the other side's ledgers, in proportion; to the paisa, the remainder to the largest
      const other = ent.filter(e => !isCash(e.l) && (cash > 0 ? e.a < 0 : e.a > 0));
      const base = sum(other, e => Math.abs(e.a)), amt = Math.abs(cash);
      if (!other.length || !base){ lines.push({date: v.date, m, no: v.no, type: v.type, head: "(contra / unallocated)", l: "", r: cash > 0 ? amt : 0, p: cash < 0 ? amt : 0}); return; }
      let given = 0; const parts = other.map(e => { const s = Math.floor(amt * Math.abs(e.a) / base); given += s; return {e, s}; });
      parts.sort((a, b) => Math.abs(b.e.a) - Math.abs(a.e.a))[0].s += amt - given;
      parts.forEach(({e, s}) => lines.push({date: v.date, m, no: v.no, type: v.type, head: head(e.l), l: e.l, r: cash > 0 ? s : 0, p: cash < 0 ? s : 0}));
    });
    const ms = Array.from(months).sort();
    const by = (k) => { const o = {}; lines.filter(x => x[k]).forEach(x => { const h = o[x.head] = o[x.head] || {head: x.head, m: {}, t: 0}; h.m[x.m] = (h.m[x.m] || 0) + x[k]; h.t += x[k]; }); return Object.values(o).sort((a, b) => b.t - a.t || a.head.localeCompare(b.head)); };
    const rec = by("r"), pay = by("p"), R = sum(lines, x => x.r), Pp = sum(lines, x => x.p);
    const cashL = (inp.tb || []).filter(t => isCash(t.l)), open = sum(cashL, t => P(t.o)), move = sum(cashL, t => P(t.d) - P(t.c));
    // the reconciliation: profit (accrual) + the movement of every other balance sheet ledger = the movement in cash and bank
    const pls = (inp.tb || []).filter(t => { const m = (inp.map || {})[t.l]; return m ? X.isPL(m.line) : /^(sales accounts|purchase accounts|direct incomes|indirect incomes|direct expenses|indirect expenses)$/i.test((t.g || []).slice(-1)[0] || ""); });
    const plSet = new Set(pls.map(t => t.l)), stockCh = inp.stock ? P(inp.stock.close) - P(inp.stock.open) : 0, profit = -sum(pls, t => P(t.d) - P(t.c)) + stockCh;
    const adj = {}; (inp.tb || []).filter(t => !plSet.has(t.l) && !isCash(t.l)).forEach(t => { const m = (inp.map || {})[t.l], k = m && m.line ? (X.line(m.line) || {face: m.line}).face : ((t.g || []).slice(-1)[0] || "(not grouped)"); adj[k] = (adj[k] || 0) + (P(t.c) - P(t.d)); });
    if (stockCh) adj["Inventories (closing stock not booked in the ledgers)"] = -stockCh;
    const recon = [["Profit for the period (accrual basis" + (inp.stock ? ", as in the statements" : ", from the books") + ")", profit]].concat(Object.entries(adj).filter(([, v]) => v).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [(v > 0 ? "Add: increase in / decrease of " : "Less: decrease in / increase of ") + k, v]));
    const reconTot = sum(recon, z => z[1]);
    return {from: inp.from, to: inp.to, months: ms, rec, pay, lines, totals: {receipts: R, payments: Pp, net: R - Pp}, cash: {open, move, close: open + move, ledgers: cashL.map(t => t.l)}, recon, reconTot, diff: reconTot - move, voucherDiff: (R - Pp) - move, entity: inp.entity || {}};
  };
  X.cashMisExcel = function(cm){
    const mL = m => { const [y, mo] = m.split("-"); return MON[Number(mo) - 1].slice(0, 3) + "-" + y.slice(2); };
    const ln = {name: "Lines", rows: [["Date", "Month", "Voucher", "Type", "Head", "Ledger", "Receipt", "Payment"]], widths: [12, 9, 14, 14, 30, 36, 16, 16]};
    cm.lines.forEach(x => ln.rows.push([x.date, x.m, x.no || "", x.type || "", x.head, x.l, {v: x.r / 100, s: 2}, {v: x.p / 100, s: 2}]));
    const N = cm.lines.length + 1, names = {CM_M: "Lines!$B$2:$B$" + Math.max(2, N), CM_H: "Lines!$E$2:$E$" + Math.max(2, N), CM_R: "Lines!$G$2:$G$" + Math.max(2, N), CM_P: "Lines!$H$2:$H$" + Math.max(2, N)};
    const rp = {name: "Receipts and Payments", rows: [[String((cm.entity || {}).name || "").toUpperCase()], ["Receipts and payments (cash basis) " + cm.from + " to " + cm.to], [X.UNITS], [], ["Head"].concat(cm.months.map(mL)).concat(["Total"])], widths: [40].concat(cm.months.map(() => 14)).concat([16])};
    const block = (title, list, col) => {
      rp.rows.push([{v: title, s: 1}]); const first = rp.rows.length + 1;
      list.forEach(h => { const r = rp.rows.length + 1; rp.rows.push([h.head].concat(cm.months.map(m => ({v: (h.m[m] || 0) / 100, f: "SUMIFS(" + col + ",CM_H,$A" + r + ",CM_M,\"" + m + "\")", s: 2}))).concat([{v: h.t / 100, f: "SUM(B" + r + ":" + colL(cm.months.length) + r + ")", s: 3}])); });
      const last = rp.rows.length, r = last + 1;
      rp.rows.push([{v: "Total " + title.toLowerCase(), s: 1}].concat(cm.months.map((m, j) => ({v: sum(list, h => h.m[m] || 0) / 100, f: "SUM(" + colL(j + 1) + first + ":" + colL(j + 1) + last + ")", s: 3}))).concat([{v: sum(list, h => h.t) / 100, f: "SUM(" + colL(cm.months.length + 1) + first + ":" + colL(cm.months.length + 1) + last + ")", s: 3}]));
      return r;
    };
    const tr = block("Receipts", cm.rec, "CM_R"); rp.rows.push([]); const tp = block("Payments", cm.pay, "CM_P"); rp.rows.push([]);
    const tc = colL(cm.months.length + 1);
    rp.rows.push([{v: "Net receipts / (payments)", s: 1}].concat(cm.months.map((m, j) => ({v: (sum(cm.rec, h => h.m[m] || 0) - sum(cm.pay, h => h.m[m] || 0)) / 100, f: colL(j + 1) + tr + "-" + colL(j + 1) + tp, s: 3}))).concat([{v: cm.totals.net / 100, f: tc + tr + "-" + tc + tp, s: 3}]));
    rp.rows.push([]); rp.rows.push(["Cash and bank at the start", {v: cm.cash.open / 100, s: 2}]); const rS = rp.rows.length;
    rp.rows.push(["Cash and bank at the end (books)", {v: cm.cash.close / 100, s: 2}]); const rE = rp.rows.length;
    rp.rows.push(["Movement in cash and bank (books)", {v: cm.cash.move / 100, f: "B" + rE + "-B" + rS, s: 3}]);
    const rc = {name: "Reconciliation", rows: [["Reconciliation of the cash-basis result to the accrual profit"], [X.UNITS], [], ["Particulars", "Amount"]], widths: [70, 18]};
    const f0 = rc.rows.length + 1; cm.recon.forEach(([t, v]) => rc.rows.push([t, {v: v / 100, s: 2}]));
    const f1 = rc.rows.length; rc.rows.push([{v: "Net movement in cash and bank (cash basis)", s: 1}, {v: cm.reconTot / 100, f: "SUM(B" + f0 + ":B" + f1 + ")", s: 9}]);
    rc.rows.push(["Movement in cash and bank as per the books", {v: cm.cash.move / 100, s: 2}], ["Difference", {v: cm.diff / 100, f: "B" + (f1 + 1) + "-B" + (f1 + 2), s: 2}]);
    return X.xlsx([rp, rc, ln], names);
  };
  X.cashMisHtml = function(cm){
    const mL = m => { const [y, mo] = m.split("-"); return MON[Number(mo) - 1].slice(0, 3) + "-" + y.slice(2); };
    const tb = (title, list) => "<tr class=\"h\"><td colspan=\"" + (cm.months.length + 2) + "\">" + esc(title) + "</td></tr>" + list.map(h => "<tr><td>" + esc(h.head) + "</td>" + cm.months.map(m => '<td class="n">' + money(h.m[m] || 0) + "</td>").join("") + '<td class="n"><b>' + money(h.t) + "</b></td></tr>").join("") +
      '<tr class="t"><td>Total ' + esc(title.toLowerCase()) + "</td>" + cm.months.map(m => '<td class="n">' + money(sum(list, h => h.m[m] || 0)) + "</td>").join("") + '<td class="n">' + money(sum(list, h => h.t)) + "</td></tr>";
    return '<!doctype html><html><head><meta charset="utf-8"><title>Cash basis MIS</title><style>@page{size:A4 landscape;margin:12mm;@bottom-right{content:counter(page) " / " counter(pages)}}body{font:9pt Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%}td,th{border:.6px solid #000;padding:2px 4px}td.n{text-align:right;white-space:nowrap}tr.h td,tr.t td{font-weight:bold}tr.t td.n{border-top:1.2px solid #000}h1{font-size:13pt;margin:0}</style></head><body>' +
      "<h1>" + esc(String((cm.entity || {}).name || "").toUpperCase()) + "</h1><div>Receipts and payments, cash basis, " + esc(cm.from) + " to " + esc(cm.to) + "</div><div><i>" + X.UNITS + "</i></div><table><thead><tr><th>Head</th>" + cm.months.map(m => "<th>" + mL(m) + "</th>").join("") + "<th>Total</th></tr></thead><tbody>" +
      tb("Receipts", cm.rec) + tb("Payments", cm.pay) + '<tr class="t"><td>Net receipts / (payments)</td>' + cm.months.map(m => '<td class="n">' + money(sum(cm.rec, h => h.m[m] || 0) - sum(cm.pay, h => h.m[m] || 0)) + "</td>").join("") + '<td class="n">' + money(cm.totals.net) + "</td></tr></tbody></table>" +
      "<h3>Reconciliation to the accrual profit</h3><table><tbody>" + cm.recon.map(([t, v]) => "<tr><td>" + esc(t) + '</td><td class="n">' + money(v) + "</td></tr>").join("") + '<tr class="t"><td>Net movement in cash and bank</td><td class="n">' + money(cm.reconTot) + "</td></tr><tr><td>As per the books</td><td class=\"n\">" + money(cm.cash.move) + "</td></tr><tr><td>Difference</td><td class=\"n\">" + money(cm.diff) + "</td></tr></tbody></table></body></html>";
  };

  // ------------------------------------------------------------ the Form 3CD draft
  // clauses the books answer come in `fromBooks` (the shared audit functions' results, never worked out a second way);
  // the rest become "for you" questions. Every output is marked DRAFT.
  X.CLAUSES_3CD = [
    ["1", "Name of the assessee", "entity"], ["2", "Address", "entity"], ["3", "Permanent Account Number", "entity"], ["4", "Registration numbers under indirect tax laws (GST)", "books"],
    ["5", "Status", "entity"], ["6", "Previous year", "entity"], ["7", "Assessment year", "entity"], ["8", "Relevant clause of section 44AB under which the audit is conducted", "you"],
    ["8a", "Whether the assessee has opted for taxation under section 115BA / 115BAA / 115BAB / 115BAC / 115BAD / 115BAE", "you"], ["9", "Partners or members and their profit sharing ratios, and changes", "details"],
    ["10", "Nature of business or profession, and changes", "you"], ["11", "Books of account maintained, and where kept", "you"], ["12", "Profit and loss includes profits on a presumptive basis", "you"],
    ["13", "Method of accounting, changes and their effect; ICDS adjustments", "you"], ["14", "Method of valuation of closing stock, and deviation from section 145A", "you"],
    ["15", "Capital asset converted into stock-in-trade", "you"], ["16", "Amounts not credited to the profit and loss account", "you"], ["17", "Land or building transferred for less than the stamp duty value (section 43CA / 50C)", "you"],
    ["18", "Depreciation allowable under the Income-tax Act", "details"], ["19", "Amounts admissible under sections 32AC, 33AB, 35, 35AD and others", "you"],
    ["20(a)", "Bonus or commission to employees (section 36(1)(ii))", "you"], ["20(b)", "Employees' contributions to PF, ESI and other funds received, and dates of payment (section 36(1)(va))", "you"],
    ["21(a)", "Capital, personal, advertisement, club, penalty and similar expenditure debited", "books"], ["21(b)", "Amounts inadmissible under section 40(a): TDS not deducted or not paid", "books"],
    ["21(d)", "Payments otherwise than by account payee cheque or bank (section 40A(3))", "books"], ["21(e)", "Provision for gratuity not allowable (section 40A(7))", "you"], ["21(h)", "Expenditure in relation to exempt income (section 14A)", "you"],
    ["22", "Interest inadmissible under section 23 of the MSMED Act", "books"], ["23", "Payments to persons specified in section 40A(2)(b)", "confirm"],
    ["24", "Deemed profits under sections 32AC, 33AB, 33ABA, 33AC", "you"], ["25", "Profits chargeable to tax under section 41", "you"], ["26", "Sums under section 43B, including 43B(h)", "books"],
    ["27", "Input tax credit availed and utilised; prior period income and expenditure", "you"], ["28", "Property or shares received without or for inadequate consideration (section 56(2)(viia))", "you"],
    ["29", "Consideration for shares received above fair market value (section 56(2)(viib))", "you"], ["29A", "Advance received on a capital asset forfeited (section 56(2)(ix))", "you"],
    ["29B", "Income under section 56(2)(x)", "you"], ["30", "Amounts borrowed on hundi or repaid otherwise than by account payee cheque (section 69D)", "you"],
    ["30A", "Primary or secondary transfer pricing adjustment (section 92CE)", "you"], ["30B", "Interest expenditure exceeding the limit of section 94B", "you"], ["30C", "Impermissible avoidance arrangement (section 96)", "you"],
    ["31(a)", "Loans or deposits taken or accepted (section 269SS)", "books"], ["31(b)", "Loans or deposits repaid (section 269T)", "books"], ["31(ba)", "Receipts of Rs 2 lakh or more otherwise than by bank (section 269ST)", "books"],
    ["32", "Brought forward losses and unabsorbed depreciation", "you"], ["33", "Deductions under Chapter VI-A and Chapter III", "you"],
    ["34(a)", "Tax deducted or collected at source, section by section", "books"], ["34(b)", "TDS / TCS statements furnished in time", "you"], ["34(c)", "Interest under section 201(1A) / 206C(7)", "books"],
    ["35", "Quantitative details of principal items of goods traded, raw materials and finished products", "books"], ["36", "Distributed profits / buy-back tax", "you"],
    ["36A", "Amounts received as loan or advance treated as deemed dividend (section 2(22)(e))", "books"], ["37", "Cost audit", "you"], ["38", "Audit under the Central Excise Act", "you"], ["39", "Audit of services under section 72A of the Finance Act, 1994", "you"],
    ["40", "Turnover, gross profit and net profit ratios", "books"], ["41", "Demands raised or refunds issued under tax laws", "you"], ["42", "Forms 61, 61A and 61B furnished", "you"], ["43", "Country-by-country report (section 286)", "you"],
    ["44", "Break-up of total expenditure by the GST status of the supplier", "books"]
  ];
  X.form3cd = function(inp){
    const e = inp.entity || {}, fy = String(inp.fy), books = {}, given = inp.answers || {};
    (inp.fromBooks || []).forEach(c => { books[c.no] = c; });
    const kind = X.KINDS[e.kind] || e.kind || "";
    const C2 = X.CLAUSES_3CD.map(([no, title, src]) => {
      const b = books[no] || Object.values(books).find(z => String(z.no).split(/,\s*/).includes(no)) || Object.values(books).find(z => String(z.no).startsWith(no + "("));
      if (src === "entity"){ const v = {"1": e.name, "2": e.address, "3": e.pan, "5": kind, "6": "1 April " + fy + " to 31 March " + (Number(fy) + 1), "7": (Number(fy) + 1) + "-" + String(Number(fy) + 2).slice(2)}[no] || "";
        return {no, title, src: v ? "books" : "you", head: ["Answer"], rows: v ? [[v]] : [], note: v ? "" : "To be given."}; }
      if (b) return Object.assign({no, title, src: src === "confirm" ? "confirm" : "books"}, {head: b.head, rows: b.rows || [], note: b.note || "", count: b.count != null ? b.count : (b.rows || []).length, amount: b.amount});
      if (src === "details" && no === "9" && (inp.partners || []).length) return {no, title, src: "books", head: ["Partner", "Profit sharing ratio"], rows: inp.partners.map(p => [p.name, String(p.share) + "%"]), note: ""};
      if (src === "details" && no === "18" && (inp.itBlocks || []).length) return {no, title, src: "books", head: ["Block", "Rate", "Opening WDV", "Additions", "Sale value", "Depreciation", "Closing WDV"], rows: inp.itBlocks, note: inp.itBlocksNote || "From the income-tax block working of the fixed asset register (Books, Accounts, Fixed assets and depreciation)."};
      if (src === "books" && no === "35" && !inp.hasStock) return {no, title, src: "you", head: [], rows: [], note: "No stock quantities are kept in the books: give the quantitative details."};
      if (given[no]) return {no, title, src: "given", head: ["Answer"], rows: [[given[no]]], note: "Given by you."};
      return {no, title, src: src === "books" ? "you" : src === "confirm" ? "confirm" : "you", head: [], rows: [], note: src === "books" ? "Not found in the books for this period: confirm." : "The books cannot answer this: to be given."};
    });
    const forYou = C2.filter(c => c.src === "you").map(c => ({no: c.no, q: "Clause " + c.no + ": " + c.title + "?"}));
    return {entity: e, fy, clauses: C2, forYou, draft: true};
  };
  X.form3cdExcel = function(d){
    const sh = {name: "Form 3CD draft", rows: [["DRAFT - Form 3CD working from the books (not for filing)"], [String((d.entity || {}).name || "").toUpperCase()], ["Previous year " + X.fyLabel(d.fy)], [], ["Clause", "Particulars", "Source", "Details"]], widths: [8, 70, 12, 30, 18, 18, 18, 18]};
    d.clauses.forEach(c => {
      sh.rows.push([{v: c.no, s: 1}, {v: c.title, s: 1}, c.src === "books" ? "Books" : c.src === "confirm" ? "To confirm" : c.src === "given" ? "Given" : "For you", c.note || ""]);
      if (c.head && c.head.length && c.rows.length){ sh.rows.push(["", ""].concat(c.head.map(h => ({v: h, s: 7})))); const f = sh.rows.length + 1; c.rows.forEach(r => sh.rows.push(["", ""].concat(r.map(v => typeof v === "number" ? {v, s: 2} : v))));
        const amtCols = c.head.map((h, j) => j).filter(j => c.rows.every(r => typeof r[j] === "number")); if (c.rows.length > 1 && amtCols.length){ const l = sh.rows.length; const tr = ["", "Total"]; amtCols.forEach(j => { tr[j + 2] = {v: sum(c.rows, r => r[j]), f: "SUM(" + colL(j + 2) + f + ":" + colL(j + 2) + l + ")", s: 3}; }); sh.rows.push(tr); } }
    });
    const fy2 = {name: "For you", rows: [["DRAFT"], ["Questions the books cannot answer"], [], ["Clause", "Question", "Answer"]].concat(d.forYou.map(q => [q.no, q.q, ""])), widths: [8, 90, 40]};
    return X.xlsx([sh, fy2], {});
  };
  X.form3cdWord = function(d){
    const items = [{p: "DRAFT - not for filing. Working from the books for the tax auditor's review.", b: 1, center: 1}];
    d.clauses.forEach(c => {
      items.push({p: c.no + ". " + c.title + "  [" + (c.src === "books" ? "from the books" : c.src === "confirm" ? "from the books, to confirm" : c.src === "given" ? "given" : "for you") + "]", b: 1});
      if (c.head && c.head.length && c.rows.length) items.push({table: {cols: c.head.map((h, j) => ({h, n: c.rows.every(r => typeof r[j] === "number") ? 1 : 0})), rows: c.rows.map(r => ({t: String(r[0] == null ? "" : typeof r[0] === "number" ? money(P(r[0])) : r[0]), k: "r", c: r.slice(1).map(v => typeof v === "number" ? {v: P(v)} : String(v == null ? "" : v))}))}});
      if (c.note) items.push({p: c.note, i: 1});
    });
    items.push({p: ""}, {p: "Questions for you", b: 1}); d.forYou.forEach(q => items.push({p: q.q}));
    return X.docx([{section: {head: ["DRAFT", String((d.entity || {}).name || "").toUpperCase(), "Form 3CD working, previous year " + X.fyLabel(d.fy)]}, items}], {footerNote: "DRAFT - not for filing"});
  };

  // ------------------------------------------------------------ DCF valuation: history from the books, the assumptions from you
  X.DCF_NEED = [["years", "Forecast years (number)"], ["revGrowth", "Revenue growth for each forecast year (%)"], ["ebitdaMargin", "EBITDA margin for each forecast year (%)"], ["depPct", "Depreciation as % of revenue"], ["capexPct", "Capital expenditure as % of revenue"],
    ["nwcPct", "Net working capital as % of revenue"], ["taxRate", "Tax rate (%)"], ["tg", "Terminal growth rate (%)"], ["shares", "Number of equity shares"], ["valuationDate", "Valuation date"], ["method", "Method: FCFF or FCFE"]];
  X.dcfMissing = function(A){
    const miss = [];
    X.DCF_NEED.forEach(([k, l]) => { const v = A[k]; if (v == null || v === "" || (Array.isArray(v) && (!v.length || v.some(z => z == null || z === "")))) miss.push(l); });
    if (A.years && Array.isArray(A.revGrowth) && A.revGrowth.length !== Number(A.years)) miss.push("Revenue growth for each of the " + A.years + " years");
    if (A.years && Array.isArray(A.ebitdaMargin) && A.ebitdaMargin.length !== Number(A.years)) miss.push("EBITDA margin for each of the " + A.years + " years");
    const fcfe = String(A.method || "").toUpperCase() === "FCFE";
    if (fcfe){ if (A.ke == null && (A.rf == null || A.beta == null || A.erp == null)) miss.push("Cost of equity (or the risk-free rate, beta and equity risk premium)"); if (!Array.isArray(A.netBorrowing) || A.netBorrowing.length !== Number(A.years)) miss.push("Net borrowing for each forecast year (FCFE)"); if (A.interestPct == null) miss.push("Interest as % of revenue (FCFE)"); }
    else if (A.wacc == null && (A.rf == null || A.beta == null || A.erp == null || A.kd == null || A.de == null)) miss.push("WACC (or the risk-free rate, beta, equity risk premium, cost of debt and debt/equity)");
    if (!fcfe && A.netDebt == null) miss.push("Net debt at the valuation date (debt less cash)");
    return miss;
  };
  // hist: [{fy, rev, ebitda, dep, ebit, fin, pbt, tax, pat, nwc, debt, cash}] in rupees, oldest first
  X.dcf = function(hist, A){
    const miss = X.dcfMissing(A || {});
    if (miss.length) return {error: "These assumptions are needed (FinCom never assumes them): " + miss.join("; ") + ".", missing: miss};
    const n = Number(A.years), t = A.taxRate / 100, g = A.tg / 100, fcfe = String(A.method).toUpperCase() === "FCFE";
    const ke = A.ke != null ? A.ke / 100 : (A.rf + A.beta * A.erp) / 100;
    const wE = A.de != null ? 1 / (1 + A.de) : 1, wD = A.de != null ? A.de / (1 + A.de) : 0;
    const rate = fcfe ? ke : (A.wacc != null ? A.wacc / 100 : wE * ke + wD * (A.kd / 100) * (1 - t));
    const last = hist[hist.length - 1] || {rev: 0, nwc: 0};
    const yrs = []; let rev = last.rev, nwc0 = last.nwc != null ? last.nwc : last.rev * A.nwcPct / 100;
    for (let i = 0; i < n; i++){
      rev = rev * (1 + A.revGrowth[i] / 100);
      const ebitda = rev * A.ebitdaMargin[i] / 100, dep = rev * A.depPct / 100, ebit = ebitda - dep, tax = ebit * t, nopat = ebit - tax, capex = rev * A.capexPct / 100, nwc = rev * A.nwcPct / 100, dn = nwc - nwc0; nwc0 = nwc;
      const fcff = nopat + dep - capex - dn, intr = fcfe ? rev * A.interestPct / 100 : 0, fcfeV = fcff - intr * (1 - t) + (fcfe ? A.netBorrowing[i] : 0), cf = fcfe ? fcfeV : fcff, df = 1 / Math.pow(1 + rate, i + 1);
      yrs.push({rev, ebitda, dep, ebit, tax, nopat, capex, nwc, dn, fcff, intr, fcfe: fcfeV, cf, df, pv: cf * df});
    }
    if (rate <= g) return {error: "The discount rate must be above the terminal growth rate."};
    const tv = yrs[n - 1].cf * (1 + g) / (rate - g), pvTv = tv * yrs[n - 1].df, sumPv = sum(yrs, y => y.pv), ev = sumPv + pvTv;
    const equity = fcfe ? ev : ev - A.netDebt, perShare = equity / A.shares;
    const grid = {rates: [-0.02, -0.01, 0, 0.01, 0.02].map(d => rate + d), gs: [-0.01, -0.005, 0, 0.005, 0.01].map(d => g + d)};
    grid.v = grid.rates.map(w => grid.gs.map(gg => w <= gg ? null : (sum(yrs, (y, i) => y.cf / Math.pow(1 + w, i + 1)) + yrs[n - 1].cf * (1 + gg) / (w - gg) / Math.pow(1 + w, n) - (fcfe ? 0 : A.netDebt)) / A.shares));
    return {hist, A, n, rate, ke, g, t, fcfe, yrs, tv, pvTv, sumPv, ev, equity, perShare, grid};
  };
  X.dcfExcel = function(d, ent){
    const A = d.A, n = d.n, names = {};
    const as = {name: "Assumptions", rows: [["DRAFT - DCF valuation working. The assumptions are the user's; none is FinCom's."], [String((ent || {}).name || "").toUpperCase()], [], ["Assumption", "Value"]], widths: [60, 16]};
    const inp = (nmx, label, v) => { as.rows.push([label, {v, s: 5}]); names[nmx] = "Assumptions!$B$" + as.rows.length; };
    inp("A_tax", "Tax rate (decimal)", d.t); inp("A_g", "Terminal growth (decimal)", d.g);
    if (A.wacc != null || d.fcfe) inp("A_rate_in", d.fcfe ? "Cost of equity (decimal)" : "WACC (decimal)", d.rate);
    else { inp("A_rf", "Risk-free rate (decimal)", A.rf / 100); inp("A_beta", "Beta", A.beta); inp("A_erp", "Equity risk premium (decimal)", A.erp / 100); inp("A_kd", "Pre-tax cost of debt (decimal)", A.kd / 100); inp("A_de", "Debt / Equity", A.de); }
    inp("A_dep", "Depreciation % of revenue (decimal)", A.depPct / 100); inp("A_capex", "Capex % of revenue (decimal)", A.capexPct / 100); inp("A_nwc", "Net working capital % of revenue (decimal)", A.nwcPct / 100);
    inp("A_shares", "Number of equity shares", A.shares); if (!d.fcfe) inp("A_netdebt", "Net debt at the valuation date", A.netDebt); if (d.fcfe) inp("A_int", "Interest % of revenue (decimal)", A.interestPct / 100);
    if (A.wacc != null || d.fcfe) names.A_rate = names.A_rate_in;
    else { as.rows.push(["Cost of equity = rf + beta x ERP", {v: d.ke, f: "A_rf+A_beta*A_erp", s: 5}]); names.A_ke = "Assumptions!$B$" + as.rows.length; as.rows.push(["WACC", {v: d.rate, f: "1/(1+A_de)*A_ke+A_de/(1+A_de)*A_kd*(1-A_tax)", s: 5}]); names.A_rate = "Assumptions!$B$" + as.rows.length; }
    const hs = {name: "Historical", rows: [["From the books (Schedule III statements)"], [X.UNITS], [], ["Year", "Revenue", "EBITDA", "Depreciation", "EBIT", "Finance costs", "PBT", "Tax", "PAT", "Net working capital"]], widths: [12, 16, 16, 16, 16, 16, 16, 16, 16, 18]};
    d.hist.forEach(h => hs.rows.push([X.fyLabel(h.fy)].concat(["rev", "ebitda", "dep", "ebit", "fin", "pbt", "tax", "pat", "nwc"].map(k => ({v: h[k] || 0, s: 2})))));
    const lastRow = hs.rows.length;
    const ds = {name: "DCF", rows: [["DRAFT - " + (d.fcfe ? "FCFE" : "FCFF") + " discounted cash flow"], [X.UNITS], [], ["Particulars"].concat(Array.from({length: n}, (_, i) => "Year " + (i + 1)))], widths: [44].concat(Array.from({length: n}, () => 16))};
    const R = {}; const rowAt = (key, label, fn, st) => { const r = ds.rows.length + 1; R[key] = r; ds.rows.push([label].concat(Array.from({length: n}, (_, i) => { const o = fn(i, colL(i + 1), i ? colL(i) : null); return {v: o[0], f: o[1], s: st || 2}; }))); };
    rowAt("g", "Revenue growth (decimal)", i => [A.revGrowth[i] / 100, null], 5);
    rowAt("m", "EBITDA margin (decimal)", i => [A.ebitdaMargin[i] / 100, null], 5);
    rowAt("rev", "Revenue", (i, c, p) => [d.yrs[i].rev, (i ? p + R.rev : "Historical!$B$" + lastRow) + "*(1+" + c + R.g + ")"]);
    rowAt("ebitda", "EBITDA", (i, c) => [d.yrs[i].ebitda, c + R.rev + "*" + c + R.m]);
    rowAt("dep", "Depreciation", (i, c) => [d.yrs[i].dep, c + R.rev + "*A_dep"]);
    rowAt("ebit", "EBIT", (i, c) => [d.yrs[i].ebit, c + R.ebitda + "-" + c + R.dep]);
    rowAt("tax", "Tax on EBIT", (i, c) => [d.yrs[i].tax, c + R.ebit + "*A_tax"]);
    rowAt("nopat", "NOPAT", (i, c) => [d.yrs[i].nopat, c + R.ebit + "-" + c + R.tax]);
    rowAt("capex", "Capital expenditure", (i, c) => [d.yrs[i].capex, c + R.rev + "*A_capex"]);
    rowAt("nwc", "Net working capital", (i, c) => [d.yrs[i].nwc, c + R.rev + "*A_nwc"]);
    rowAt("dn", "Increase in net working capital", (i, c, p) => [d.yrs[i].dn, c + R.nwc + "-" + (i ? p + R.nwc : "Historical!$J$" + lastRow)]);
    rowAt("fcff", "Free cash flow to the firm (FCFF)", (i, c) => [d.yrs[i].fcff, c + R.nopat + "+" + c + R.dep + "-" + c + R.capex + "-" + c + R.dn], 3);
    if (d.fcfe){ rowAt("nb", "Net borrowing", i => [A.netBorrowing[i], null]); rowAt("int", "Interest", (i, c) => [d.yrs[i].intr, c + R.rev + "*A_int"]); rowAt("fcfe", "Free cash flow to equity (FCFE)", (i, c) => [d.yrs[i].fcfe, c + R.fcff + "-" + c + R.int + "*(1-A_tax)+" + c + R.nb], 3); }
    const cfRow = d.fcfe ? "fcfe" : "fcff";
    rowAt("df", "Discount factor", (i, c) => [d.yrs[i].df, "1/(1+A_rate)^" + (i + 1)], 5);
    rowAt("pv", "Present value", (i, c) => [d.yrs[i].pv, c + R[cfRow] + "*" + c + R.df]);
    const L = colL(n), put = (label, v, f, st) => { ds.rows.push([{v: label, s: 1}, {v, f, s: st || 3}]); return "DCF!$B$" + ds.rows.length; };
    ds.rows.push([]);
    names.V_sumpv = put("Sum of present values", d.sumPv, "SUM(B" + R.pv + ":" + L + R.pv + ")");
    names.V_tv = put("Terminal value (Gordon growth)", d.tv, L + R[cfRow] + "*(1+A_g)/(A_rate-A_g)");
    names.V_pvtv = put("Present value of the terminal value", d.pvTv, "V_tv*" + L + R.df);
    names.V_ev = put(d.fcfe ? "Equity value" : "Enterprise value", d.ev, "V_sumpv+V_pvtv");
    names.V_eq = put("Equity value", d.equity, d.fcfe ? "V_ev" : "V_ev-A_netdebt", 9);
    names.V_ps = put("Value per share", d.perShare, "V_eq/A_shares", 5);
    ds.rows.push([], [{v: "Sensitivity: value per share, " + (d.fcfe ? "cost of equity" : "WACC") + " (down) x terminal growth (across)", s: 1}]);
    const gr = ds.rows.length + 1; ds.rows.push([""].concat(d.grid.gs.map(x => ({v: x, s: 4}))));
    d.grid.rates.forEach((w, i) => { const r = ds.rows.length + 1; ds.rows.push([{v: w, s: 4}].concat(d.grid.gs.map((gg, j) => { const gc = colL(j + 1) + "$" + gr, wc = "$A" + r;
      const f = "IF(" + wc + "<=" + gc + ",\"-\",(" + Array.from({length: n}, (_, k) => colL(k + 1) + "$" + R[cfRow] + "/(1+" + wc + ")^" + (k + 1)).join("+") + "+" + L + "$" + R[cfRow] + "*(1+" + gc + ")/(" + wc + "-" + gc + ")/(1+" + wc + ")^" + n + (d.fcfe ? "" : "-A_netdebt") + ")/A_shares)";
      return {v: d.grid.v[i][j] == null ? "-" : d.grid.v[i][j], f, s: 5}; }))); });
    return X.xlsx([as, hs, ds], names);
  };
  X.dcfWord = function(d, ent){
    const items = [{p: "DRAFT VALUATION REPORT", b: 1, center: 1, size: 26}, {p: "This draft must be issued by a registered valuer / merchant banker. FinCom prepares the working only.", b: 1, center: 1},
      {p: "1. Purpose and basis", b: 1}, {p: "A discounted cash flow valuation (" + (d.fcfe ? "free cash flow to equity" : "free cash flow to the firm") + ") of the equity shares of " + ((ent || {}).name || "") + " as at " + d.A.valuationDate + ". The historical figures are from the financial statements prepared from the books; every assumption below was given by the user.", justify: 1},
      {p: "2. Historical performance (from the books)", b: 1},
      {table: {cols: [{h: "Year"}, {h: "Revenue", n: 1}, {h: "EBITDA", n: 1}, {h: "PAT", n: 1}], rows: d.hist.map(h => ({t: X.fyLabel(h.fy), k: "r", c: [{v: P(h.rev)}, {v: P(h.ebitda)}, {v: P(h.pat)}]}))}},
      {p: "3. Assumptions (given by the user)", b: 1},
      {table: {cols: [{h: "Assumption"}, {h: "Value"}], rows: X.DCF_NEED.map(([k, l]) => ({t: l, k: "r", c: [Array.isArray(d.A[k]) ? d.A[k].join(", ") : String(d.A[k])]})).concat([{t: d.fcfe ? "Cost of equity" : "Discount rate (WACC)", k: "r", c: [pct2(d.rate)]}])}},
      {p: "4. Projected cash flows and value", b: 1},
      {table: {cols: [{h: "Particulars"}].concat(d.yrs.map((y, i) => ({h: "Year " + (i + 1), n: 1}))), rows: [["Revenue", "rev"], ["EBITDA", "ebitda"], [d.fcfe ? "FCFE" : "FCFF", "cf"], ["Present value", "pv"]].map(([l, k]) => ({t: l, k: "r", c: d.yrs.map(y => ({v: P(y[k])}))}))}},
      {table: {cols: [{h: "Particulars"}, {h: "Amount", n: 1}], rows: [["Sum of present values", d.sumPv], ["Present value of the terminal value", d.pvTv], [d.fcfe ? "Equity value" : "Enterprise value", d.ev], ["Equity value", d.equity]].map(([l, v]) => ({t: l, k: "r", c: [{v: P(v)}]})).concat([{t: "Value per share (₹)", k: "t", c: [dec2(d.perShare)]}])}},
      {p: "5. Sensitivity of the value per share", b: 1},
      {table: {cols: [{h: (d.fcfe ? "Ke" : "WACC") + " \\ g"}].concat(d.grid.gs.map(x => ({h: pct2(x), n: 1}))), rows: d.grid.rates.map((w, i) => ({t: pct2(w), k: "r", c: d.grid.v[i].map(v => v == null ? "-" : dec2(v))}))}},
      {p: "6. Limitations", b: 1}, {p: "The value depends entirely on the assumptions given, which have not been verified. This is a draft working and is not a valuation report under any law; it must be reviewed, adopted and issued by a registered valuer / merchant banker.", justify: 1}];
    return X.docx([{section: {head: ["DRAFT", String((ent || {}).name || "").toUpperCase(), "Valuation of equity shares (DCF) - draft working"]}, items}], {footerNote: "DRAFT - must be issued by a registered valuer / merchant banker"});
  };
  // the history for the DCF from the statements of several years
  X.histFrom = function(models, o){
    const out = (o && o.withPy && models.length ? [Object.assign({py: true}, models[0])] : []).concat(models);
    return out.map(M0 => { const y = M0.py ? "PY" : "CY", M = M0.py ? Object.assign({}, M0, {fy: String(Number(M0.fy) - 1)}) : M0, V = n => (M.nm[n.replace(/_CY$/, "_" + y)] || 0) / 100;
      return {fy: M.fy, rev: V("L_rev_CY"), ebitda: V("T_pbt_CY") + V("L_fin_CY") + V("L_dep_CY"), dep: V("L_dep_CY"), ebit: V("T_pbt_CY") + V("L_fin_CY"), fin: V("L_fin_CY"), pbt: V("T_pbt_CY"), tax: V("L_tax_CY"), pat: V("T_pat_CY"),
        nwc: V("L_inv_CY") + V("L_tr_CY") + V("L_stla_CY") + V("L_oca_CY") - V("L_tp_CY") - V("L_ocl_CY") - V("L_stp_CY")}; });
  };

  // ------------------------------------------------------------ one call: the statements, the checks and the files
  // what both the app's screen and the Assistant's tool call, so both give the same figures
  X.run = function(inp, o){
    o = o || {};
    const kind = (inp.entity || {}).kind || "company";
    const mp = inp.map ? {map: inp.map, version: inp.mapVersion || 0, confirmed: true, fresh: [], unplaced: []} : X.mapping(inp.mapStore, inp.tb, kind);
    const M = X.build(Object.assign({}, inp, {map: mp.map}));
    M.mapping = mp;
    const checks = X.check(M);
    const fails = checks.filter(c => !c.ok && c.level === "error"), warns = checks.filter(c => !c.ok && c.level === "warn");
    const out = {model: M, checks, fails, warns, mapping: mp};
    if (o.files){
      out.files = {};
      if (o.files.includes("xlsx")) out.files.xlsx = X.excel(M, checks).bytes;
      if (o.files.includes("docx")) out.files.docx = X.word(M);
      if (o.files.includes("html")) out.files.html = X.html(M);
      if (o.files.includes("tb")) out.files.tb = X.tbExport(M, o.tbCols);
    }
    const V = n => (M.nm[n] || 0) / 100;
    out.summary = {entity: M.ent.name, kind: X.KINDS[kind], year: X.fyLabel(M.fy), notes: M.notes.filter(n => n.print).length, pages: M.pages.length,
      totalAssets: V("T_as_CY"), totalAssetsPy: V("T_as_PY"), revenue: V("L_rev_CY"), profitBeforeTax: V("T_pbt_CY"), profit: V("T_pat_CY"), checksFailed: fails.length, warnings: warns.length,
      unplacedLedgers: M.unplaced.length, newLedgers: (mp.fresh || []).length, mappingVersion: mp.version, mappingConfirmed: !!mp.confirmed};
    return out;
  };
  X.summaryText = s => s.entity + " (" + s.kind + "), " + s.year + ": total assets ₹" + money(P(s.totalAssets)) + ", revenue ₹" + money(P(s.revenue)) + ", profit ₹" + money(P(s.profit)) + "; " + s.notes + " notes; " +
    (s.checksFailed ? s.checksFailed + " of the 27 checks failed (listed, nothing fixed)" : "all 27 checks pass") + (s.warnings ? ", " + s.warnings + " warnings" : "") + (s.unplacedLedgers ? "; " + s.unplacedLedgers + " ledgers not placed" : "") + (s.newLedgers ? "; " + s.newLedgers + " new ledgers since the mapping was confirmed" : "") + ".";

  // ------------------------------------------------------------ the app: the books FinCom holds for the client
  // (browser only; uses the program's own globals). Ledger balances in Tally's sign (a debit negative) become Dr positive.
  X.store = function(b){ b = b || (typeof S === "object" ? S.books : null) || {}; b.fs = b.fs || {}; b.fs.rx = b.fs.rx || {map: {versions: [], draft: {}}, det: {}, opts: {}}; return b.fs.rx; };
  X.kindOf = function(b){
    const st = X.store(b); if (st.kind) return st.kind;
    const e = typeof FS === "object" ? FS.entityOf(typeof S === "object" && S.companies ? S.companies[b.cid] : null).code : "";
    return e === "C" ? "company" : e === "F" ? "firm" : e === "P" ? "proprietor" : "company";
  };
  X.tbFromBooks = function(fy){
    const b = S.books, from = fy + "0401", to = String(Number(fy) + 1) + "0331", pyFrom = String(Number(fy) - 1) + "0401", pyTo = fy + "0331";
    const bal = Audit.balances(from, to);
    if (!bal.ok) return {error: bal.why};
    const open = bal.at(Audit.dayBefore(from)), mv = {}, pmv = {};
    const move = (into, f, t) => (b.vouchers || []).forEach(v => { if (v.date < f || v.date > t || v.opt || v.cancel) return; v.ent.forEach(e => { const x = into[e.l] = into[e.l] || {d: 0, c: 0}; if (e.a < 0) x.d += -e.a; else x.c += e.a; }); });
    move(mv, from, to);
    const pyOk = typeof MIS === "object" && MIS.covered(pyFrom); let pyOpen = null;
    if (pyOk){ const pb = Audit.balances(pyFrom, pyTo); if (pb.ok){ pyOpen = pb.at(Audit.dayBefore(pyFrom)); move(pmv, pyFrom, pyTo); } }
    const msme = typeof MIS === "object" ? MIS.msme() : {};
    const all = Array.from(new Set(Object.keys(open).concat(Object.keys(mv)).concat(Object.keys(pmv)).concat(pyOpen ? Object.keys(pyOpen) : []))).sort();
    const tb = all.map(l => {
      const o = -(Number(open[l]) || 0), x = mv[l] || {d: 0, c: 0}, row = {l, g: Books.groupPath(l), o: Math.round(o * 100) / 100, d: Math.round(x.d * 100) / 100, c: Math.round(x.c * 100) / 100, msme: /micro|small/i.test(msme[l] || "") ? msme[l] : ""};
      if (pyOpen){ const px = pmv[l] || {d: 0, c: 0}; row.po = Math.round(-(Number(pyOpen[l]) || 0) * 100) / 100; row.pd = Math.round(px.d * 100) / 100; row.pc = Math.round(px.c * 100) / 100; }
      return row;
    }).filter(t => t.o || t.d || t.c || t.po || t.pd || t.pc);
    return {tb, from, to, src: bal.src, py: !!pyOpen};
  };
  X.inputFromBooks = function(fy, o){
    o = o || {};
    const b = S.books, st = X.store(b), co = typeof CO === "function" ? CO() || {} : {}, kind = o.kind || X.kindOf(b);
    const t = X.tbFromBooks(fy); if (t.error) return t;
    let det = Object.assign({}, (st.det || {})[fy] || {});
    // the fixed asset register of the year (src/js/80-assets.js), when kept: its classes and blocks replace the typed ones
    if (typeof FAR === "object" && FAR) det = FAR.feedDet(det, FAR.forYear(b, fy));
    const ent = Object.assign({name: co.name || "", kind, pan: co.pan || String(co.gstin || "").slice(2, 12), address: co.address || ""}, det.entity || {});
    // ageing from the books' bills when the details do not give it (MIS.ageing: by days from the bill date; not due is the books' own)
    return {entity: ent, fy: String(fy), tb: t.tb, mapStore: st.map, det, opts: Object.assign({cashflow: false}, st.opts || {}, o.opts || {}), src: t.src, age: det.age || null};
  };
  X.cashFromBooks = function(from, to){
    const b = S.books, fy = Audit.fyStart(from).slice(0, 4), t = X.tbFromBooks(fy); if (t.error) return t;
    const iso = d => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
    const vs = (b.vouchers || []).filter(v => v.date >= from && v.date <= to && !v.opt && !v.cancel).map(v => ({date: iso(v.date), no: v.no, type: v.type, ent: v.ent.map(e => ({l: e.l, a: -e.a}))}));
    const mp = X.mapping(X.store(b).map, t.tb, X.kindOf(b)).map;
    // the cash and bank movement over the period, from the books
    const tb = t.tb.map(r => Object.assign({}, r));
    // the closing stock of the statements when Tally does not carry it (Details for you)
    const det = (X.store(b).det || {})[fy] || {}, stockOpen = tb.filter(r => (mp[r.l] || {}).line === "inv").reduce((a, r) => a + r.o, 0);
    const stock = det.stock && det.stock.cy && to === String(Number(fy) + 1) + "0331" ? {open: stockOpen, close: Object.values(det.stock.cy).reduce((a, v) => a + (Number(v) || 0), 0)} : null;
    return {entity: {name: (typeof CO === "function" ? CO() || {} : {}).name || ""}, from: iso(from), to: iso(to), tb, vouchers: vs, map: mp, stock};
  };
  // the Form 3CD draft from the shared audit functions: AuditWP (src/js/77-audit.js, the audit helper) when the program has
  // it, for 40A(3), 269SS / 269T / 269ST, 43B(h) and the TDS defaults; the other clauses from Audit.form3cd (06-audit.js /
  // 07-mis.js). AuditWP itself calls Audit.checks, so each check is computed one way only. Without 77-audit.js the thin
  // shared layer is Audit.runNow / Audit.form3cd (to merge into 77-audit.js later).
  X.shared = function(){ const wp = typeof AuditWP === "object" && AuditWP && typeof AuditWP.check === "function" ? AuditWP : null;
    return wp ? {src: "77-audit.js (AuditWP)", wp} : {src: "06-audit.js / 07-mis.js (Audit.runNow; to merge with 77-audit.js)", wp: null}; };
  X.taxAuditFromBooks = function(fy){
    const sh = X.shared(), from = fy + "0401", to = String(Number(fy) + 1) + "0331";
    const run = Audit.runNow(from, to, "3CD draft"), d = Audit.form3cd(run), counts = {};
    run.findings.forEach(f => { counts[f.id] = f.count; });
    const dt = x => typeof fmtDate === "function" && typeof tallyDate === "function" ? fmtDate(tallyDate(x)) : x;
    const clauses = d.clauses.map(c => ({no: c.no, title: c.title, head: c.head, rows: c.rows, note: c.note}));
    if (sh.wp){
      const C3 = id => sh.wp.check(id, from, to) || {entries: [], count: 0, status: "ok"};
      const c40 = C3("cash40A3"), cst = C3("cash269ST"), cl = C3("cashLoans"), td = C3("tds"), ms = C3("msme43Bh");
      Object.assign(counts, {wp_cash40A3: c40.count, wp_cash269ST: cst.count, wp_cashLoans: cl.count, wp_tds: td.count, wp_msme43Bh: ms.count});
      const put = (no, head, rows, note) => { const c = clauses.find(z => z.no === no); if (c) Object.assign(c, {head, rows, note: note != null ? note : (rows.length ? "" : "None found.")}); };
      put("21(d)(A)", ["Date", "Party or ledger", "Amount"], c40.entries.map(e => [dt(e.date), e.party, e.amount]));
      put("31(a)", ["Date", "Lender", "Amount"], cl.entries.filter(e => /^269SS/.test(e.note)).map(e => [dt(e.date), e.party, e.amount]));
      put("31(b), 31(c)", ["Date", "To", "Amount"], cl.entries.filter(e => /^269T/.test(e.note)).map(e => [dt(e.date), e.party, e.amount]));
      put("31(ba)", ["Date", "From", "Amount"], cst.entries.map(e => [dt(e.date), e.party, e.amount]));
      put("21(b)(ii)(A)", ["Party", "Amount", "Detail"], td.entries.filter(e => /^not deducted/.test(e.note)).map(e => [e.party, e.amount, e.note]));
      put("34(c)", ["Deductee", "Interest", "Detail"], td.entries.filter(e => /^interest/.test(e.note)).map(e => [e.party, e.amount, e.note]));
      if (ms.status !== "na") put("22", ["Supplier", "Bill", "Outstanding", "Days"], ms.entries.map(e => [e.party, e.no, e.amount, e.note]), "The interest itself is not in the books; work it out on these bills at three times the bank rate.");
      const c26 = clauses.find(z => z.no === "26"); if (c26 && ms.status !== "na") c26.rows = c26.rows.filter(r => r[2] !== "43B(h) MSME").concat(ms.entries.map(e => [e.party, e.amount, "43B(h) MSME"]));
    }
    const co = typeof CO === "function" ? CO() || {} : {}, st = X.store(S.books), det = (st.det || {})[fy] || {};
    const fromBooks = clauses.map(c => Object.assign({}, c, {count: c.rows.length}));
    const hasStock = (S.books.vouchers || []).some(v => (v.inv || []).length);
    // clause 18 from the fixed asset register's income-tax blocks (src/js/80-assets.js), when kept for the year
    const far = typeof FAR === "object" && FAR ? FAR.forYear(S.books, fy) : null;
    return {run, counts, src: sh.src, d3: X.form3cd({entity: Object.assign({name: co.name, pan: co.pan, address: co.address, kind: X.kindOf(S.books)}, det.entity || {}), fy, fromBooks, partners: det.partners, hasStock, answers: det.answers3cd, itBlocks: far ? far.rows3cd : undefined})};
  };
  return X;
})();
if (typeof globalThis === "object") globalThis.FSX = FSX;
/* @react-lazy: end */
