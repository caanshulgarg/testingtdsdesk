/* ================================================================== */
/* Sales: read sales invoices, create invoices, post Sales vouchers    */
/* ================================================================== */
const GST_STATES = {"01":"Jammu and Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan",
  "09":"Uttar Pradesh","10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam",
  "19":"West Bengal","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat","26":"Dadra and Nagar Haveli and Daman and Diu","27":"Maharashtra",
  "29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu","34":"Puducherry","35":"Andaman and Nicobar Islands","36":"Telangana","37":"Andhra Pradesh",
  "38":"Ladakh","97":"Other Territory","96":"Other Country"};
const SALES_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];
const SALES_UNITS = ["Nos", "Pcs", "Kg", "Gm", "Ltr", "Mtr", "Sq Ft", "Box", "Set", "Hrs", "Days", "Month", "Job"];
function stateOfGstin(g){ return /^\d{2}[A-Z]/.test(String(g || "")) ? String(g).slice(0, 2) : ""; }
function stateCodeFrom(text){
  const t = String(text || "").trim();
  if (!t) return "";
  const m = t.match(/\b(\d{2})\b/);
  if (m && GST_STATES[m[1]]) return m[1];
  const n = t.toLowerCase().replace(/[^a-z]/g, "");
  const hit = Object.entries(GST_STATES).find(([c, s]) => s.toLowerCase().replace(/[^a-z]/g, "") === n) || Object.entries(GST_STATES).find(([c, s]) => n.length > 3 && s.toLowerCase().replace(/[^a-z]/g, "").startsWith(n));
  return hit ? hit[0] : "";
}
// Rupees in words, Indian style
function rupeesInWords(amount){
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = n => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  const three = n => (n >= 100 ? ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " : "") : "") + (n % 100 ? two(n % 100) : "");
  const words = n => {
    if (n === 0) return "Zero";
    const parts = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thou = Math.floor(n / 1e3); n %= 1e3;
    if (crore) parts.push(words(crore) + " Crore");
    if (lakh) parts.push(two(lakh) + " Lakh");
    if (thou) parts.push(two(thou) + " Thousand");
    if (n) parts.push(three(n));
    return parts.join(" ");
  };
  const a = Math.abs(r2(amount));
  const rupees = Math.floor(a), paise = Math.round((a - rupees) * 100);
  return "Rupees " + words(rupees) + (paise ? " and " + two(paise) + " Paise" : "") + " Only";
}
function fyLabel(iso){ const d = iso ? new Date(iso + "T00:00:00") : new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return String(y).slice(2) + "-" + String(y + 1).slice(2); }

/* ---------- storage (kept per client, like bank statements) ---------- */
function SL(){ return S.sales; }
const SALES_CFG_DEFAULT = {voucherType: "Sales", series: "INV/{FY}/", next: 1, pad: 4, address: "", phone: "", email: "", bankName: "", bankAc: "", bankIfsc: "", bankBranch: "",
  terms: "Goods once sold will not be taken back. Interest at 18% p.a. will be charged on payments made after the due date. Subject to local jurisdiction.", signatory: "", ledgers: {}, auto: true, items: {}};
async function loadSales(cid){
  S.sales = {cid, loading: true, list: [], cfg: Object.assign({}, SALES_CFG_DEFAULT), filter: "review", q: "", sel: new Set(), sticky: new Set(), busy: "", openId: null, view: "list", draft: null, undo: null, hist: {}};
  render();
  if (!S.bank || S.bank.cid !== cid) await loadBank(cid);   // the client's Tally ledgers live with the bank data
  const [list, cfg, hist] = await Promise.all([BankDB.get("sales:" + cid), BankDB.get("salescfg:" + cid), BankDB.get("saleshist:" + cid)]);
  if (!S.sales || S.sales.cid !== cid) return;
  Object.assign(S.sales, {list: list || [], cfg: Object.assign({}, SALES_CFG_DEFAULT, cfg || {}), hist: hist || {}, loading: false});
  // invoices filed from elsewhere are matched now
  const pend = S.sales.list.filter(v => v.needsMap);
  if (pend.length){ pend.forEach(v => { v.needsMap = false; mapInvoice(v); }); saveSales(); }
  render();
  if (bridgeLive(CO(cid))) salesAutoSync();
}
let salesSaveTimer = null;
function saveSales(what){
  const s = SL(); if (!s) return;
  const cid = s.cid, list = s.list;
  clearTimeout(salesSaveTimer);
  if (S.bank && S.bank.cid === cid) S.bank.salesRef = list;
  salesSaveTimer = setTimeout(() => { salesSaveTimer = null; BankDB.set("sales:" + cid, list); }, 500);
  if (what && what.cfg) BankDB.set("salescfg:" + cid, s.cfg);
  if (what && what.hist) BankDB.set("saleshist:" + cid, s.hist);
}
window.addEventListener("pagehide", () => { if (salesSaveTimer && S.sales){ clearTimeout(salesSaveTimer); BankDB.set("sales:" + S.sales.cid, S.sales.list); } });
function inv(id){ const s = SL(); return s && s.list.find(v => v.id === id); }

/* ---------- ledgers (exact Tally names only) ---------- */
function ledgersIn(re){ const b = B(); return b ? (b.ledgers.list || []).filter(l => re.test(l.group || "")) : []; }
function rateTag(rate){ return String(rate).replace(/\.0+$/, ""); }
// sales ledger for a GST rate, local or inter-state
function salesLedgerFor(rate, inter){
  const cfg = SL().cfg, L = cfg.ledgers || {};
  for (const k of ["sales_" + rateTag(rate) + (inter ? "_i" : "_l"), "sales_" + rateTag(rate), "sales"]){ const e = exactLedger(L[k]); if (e) return e; }
  const salesL = ledgersIn(/sales accounts?/i);
  const rt = rateTag(rate);
  const withRate = salesL.filter(l => new RegExp("(^|[^0-9.])" + rt.replace(".", "\\.") + "\\s*%").test(l.name));
  const interRe = /igst|inter[\s-]*state|\binter\b|central|outside|out\s*of\s*state|ost\b/i;
  const pick = withRate.filter(l => inter ? interRe.test(l.name) : !interRe.test(l.name));
  if (pick.length === 1) return pick[0].name;
  if (withRate.length === 1) return withRate[0].name;
  const plain = salesL.filter(l => !/\d\s*%/.test(l.name));
  if (plain.length === 1) return plain[0].name;
  if (salesL.length === 1) return salesL[0].name;
  const named = (B().ledgers.list || []).find(l => /^sales(\s*(a\/c|account))?$/i.test(l.name));
  return named ? named.name : "";
}
// output tax ledgers (optionally rate-wise, e.g. "Output CGST 9%")
function taxLedgerFor(kind, rate){
  const cfg = SL().cfg, L = cfg.ledgers || {};
  const half = kind === "igst" || kind === "cess" ? rate : rate / 2;
  for (const k of [kind + "_" + rateTag(half), kind]){ const e = exactLedger(L[k]); if (e) return e; }
  const K = {cgst: /c\.?\s*gst|central\s*(gst|tax)/i, sgst: /s\.?\s*gst|state\s*(gst|tax)|utgst/i, igst: /i\.?\s*gst|integrated/i, cess: /cess/i, }[kind];
  const taxes = ledgersIn(/duties|taxes/i).filter(l => K.test(l.name) && !/input|itc|credit|receivable|rcm|reverse/i.test(l.name) && !(kind === "sgst" && /cgst|igst/i.test(l.name)));
  const out = taxes.filter(l => /output|payable|liab/i.test(l.name));
  const pool = out.length ? out : taxes;
  const rateHit = pool.filter(l => new RegExp("(^|[^0-9.])" + rateTag(half).replace(".", "\\.") + "\\s*%").test(l.name));
  if (rateHit.length === 1) return rateHit[0].name;
  const plain = pool.filter(l => !/\d\s*%/.test(l.name));
  if (plain.length === 1) return plain[0].name;
  return pool.length === 1 ? pool[0].name : "";
}
function roundOffLedger(){
  const e = exactLedger((SL().cfg.ledgers || {}).roundOff); if (e) return e;
  const hit = (B().ledgers.list || []).find(l => /round(ed|ing)?\s*[- ]?off/i.test(l.name));
  return hit ? hit.name : "";
}
function salesHistKey(v){ return v.x.customerGstin ? "g:" + v.x.customerGstin : v.x.customerName ? "n:" + normName(v.x.customerName).replace(/ /g, "") : ""; }
// customer ledger: GSTIN on the Tally ledger, then past invoices, then a close name
function customerLedgerFor(v){
  const b = B(), x = v.x;
  const debtors = (b.ledgers.list || []).filter(l => !BANK_GROUPS.test(l.group || ""));
  if (x.customerGstin){
    const byG = debtors.filter(l => String(l.gstin || "").toUpperCase() === x.customerGstin);
    if (byG.length === 1) return {ledger: byG[0].name, sure: true, label: "GSTIN match"};
    const pend = b.newLed.find(l => l.gstin === x.customerGstin);
    if (pend) return {ledger: pend.name, sure: true, label: "New ledger (GSTIN)"};
  }
  const hk = salesHistKey(v), h = hk && SL().hist[hk];
  if (h){ const l = exactLedger(h.l); if (l) return {ledger: l, sure: h.n >= 2 || !!x.customerGstin, label: "Past invoices (" + h.n + ")"}; }
  if (x.customerName){
    const want = normName(x.customerName).replace(/ /g, "");
    const exact = debtors.find(l => normName(l.name).replace(/ /g, "") === want);
    if (exact) return {ledger: exact.name, sure: /sundry\s*debtors/i.test(exact.group || "") && !x.customerGstin, label: "Name match"};
    let best = null;
    debtors.filter(l => /sundry\s*debtors|current\s*assets|loans/i.test(l.group || "")).forEach(l => { const s = nameSim(x.customerName, l.name); if (s >= 0.85 && (!best || s > best.s)) best = {l, s}; });
    if (best) return {ledger: best.l.name, sure: false, label: "Name match"};
  }
  return {ledger: "", sure: false, label: ""};
}
// the lines of the Sales voucher
function salesTotals(x){
  const items = (x.items || []).filter(it => num(it.taxable) || num(it.qty));
  const groups = new Map();
  if (items.length){
    items.forEach(it => { const r = num(it.gstRate); const g = groups.get(r) || {rate: r, taxable: 0}; g.taxable = r2(g.taxable + num(it.taxable)); groups.set(r, g); });
  } else {
    const gst = num(x.cgst) + num(x.sgst) + num(x.igst);
    const rate = num(x.taxable) ? Math.round(gst / num(x.taxable) * 10000) / 100 : 0;
    const std = SALES_RATES.find(s => Math.abs(num(x.taxable) * s / 100 - gst) <= Math.max(1.5, gst * 0.002));
    groups.set(std !== undefined ? std : rate, {rate: std !== undefined ? std : rate, taxable: r2(num(x.taxable)), mixed: std === undefined && gst > 0});
  }
  return Array.from(groups.values()).sort((a, b) => a.rate - b.rate);
}
function isInterState(x, co){ const home = stateOfGstin(co.gstin); const pos = x.pos || stateOfGstin(x.customerGstin) || home; return !!(home && pos && home !== pos); }
function salesLines(v){
  const co = CO(SL().cid), x = v.x;
  const inter = num(x.igst) > 0 || (!num(x.cgst) && isInterState(x, co));
  const groups = salesTotals(x);
  const lines = [];
  const total = r2(num(x.total));
  lines.push({side: "Dr", ledger: v.customerLedger || "", amt: total, role: "party"});
  groups.forEach(g => lines.push({side: "Cr", ledger: v.salesLedgers && v.salesLedgers[g.rate] || salesLedgerFor(g.rate, inter), amt: g.taxable, role: "sales", rate: g.rate}));
  const taxParts = [];
  if (groups.length > 1 && (x.items || []).length){
    groups.forEach(g => {
      const t = r2(g.taxable * g.rate / 100);
      if (inter) taxParts.push({kind: "igst", rate: g.rate, amt: t});
      else { taxParts.push({kind: "cgst", rate: g.rate, amt: r2(t / 2)}); taxParts.push({kind: "sgst", rate: g.rate, amt: r2(t - r2(t / 2))}); }
    });
  } else {
    const rate = groups[0] ? groups[0].rate : 0;
    if (num(x.cgst)) taxParts.push({kind: "cgst", rate, amt: r2(num(x.cgst))});
    if (num(x.sgst)) taxParts.push({kind: "sgst", rate, amt: r2(num(x.sgst))});
    if (num(x.igst)) taxParts.push({kind: "igst", rate, amt: r2(num(x.igst))});
  }
  // merge by ledger
  const byLedger = new Map();
  taxParts.forEach(t => { if (!t.amt) return; const l = taxLedgerFor(t.kind, t.rate) || ""; const k = l || t.kind + "?"; const e = byLedger.get(k) || {side: "Cr", ledger: l, amt: 0, role: "tax", kind: t.kind}; e.amt = r2(e.amt + t.amt); byLedger.set(k, e); });
  byLedger.forEach(e => lines.push(e));
  if (num(x.cess)) lines.push({side: "Cr", ledger: taxLedgerFor("cess", 0), amt: r2(num(x.cess)), role: "tax", kind: "cess"});
  const cr = r2(lines.filter(l => l.side === "Cr").reduce((a, l) => a + l.amt, 0));
  const ro = r2(total - cr);
  if (Math.abs(ro) >= 0.01) lines.push({side: ro > 0 ? "Cr" : "Dr", ledger: roundOffLedger(), amt: Math.abs(ro), role: "roundoff"});
  return lines;
}
function invoiceProblems(v){
  const co = CO(SL().cid), x = v.x, p = [];
  if (!x.number) p.push("invoice number missing");
  if (!x.date) p.push("invoice date missing");
  if (!(num(x.total) > 0)) p.push("total missing");
  if (x.customerGstin && !gstinValid(x.customerGstin)) p.push("customer GSTIN is not valid");
  const gst = num(x.cgst) + num(x.sgst) + num(x.igst);
  if (Math.abs(num(x.taxable) + gst + num(x.cess) - num(x.total)) > 1.0) p.push("taxable value + GST does not equal the total");
  if (num(x.igst) && (num(x.cgst) || num(x.sgst))) p.push("both IGST and CGST/SGST");
  const inter = isInterState(x, co);
  if (gst > 0 && inter && !num(x.igst)) p.push("place of supply is another state, so IGST is expected");
  if (gst > 0 && !inter && num(x.igst) && x.pos) p.push("place of supply is the same state, so CGST + SGST are expected");
  if (Math.abs(num(x.cgst) - num(x.sgst)) > 0.05) p.push("CGST and SGST differ");
  if (salesTotals(x).some(g => g.mixed)) p.push("GST is not at one standard rate (several rates?): use Enter items");
  if (x.sellerGstin && co.gstin && x.sellerGstin !== co.gstin) p.push("the seller GSTIN on the invoice is not " + co.name + "\u2019s");
  const dup = SL().list.find(o => o.id !== v.id && o.status !== "ignored" && normInvNo(o.x.number) === normInvNo(x.number) && o.x.date && x.date && fyLabel(o.x.date) === fyLabel(x.date));
  if (x.number && dup) p.push("invoice " + x.number + " already exists");
  return p;
}
function normInvNo(s){ return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, ""); }
function ledgerProblems(v){
  const p = [];
  salesLines(v).forEach(l => { if (!l.ledger) p.push({party: "customer ledger", sales: "sales ledger for " + rateTag(l.rate) + "%", tax: (l.kind || "tax").toUpperCase() + " output ledger", roundoff: "round-off ledger"}[l.role] + " not set"); else if (!exactLedger(l.ledger)) p.push("\u201c" + l.ledger + "\u201d is not a Tally ledger"); });
  return p;
}
// work out ledgers and status for an invoice
function mapInvoice(v){
  if (["posted", "intally", "ignored"].includes(v.status)) return;
  if (!v.userLedger || !exactLedger(v.customerLedger)){
    const c = hasLedgerList() ? customerLedgerFor(v) : {ledger: "", sure: false, label: ""};
    v.customerLedger = c.ledger; v.custSource = c.label; v.custSure = c.sure; v.userLedger = false;
  }
  v.problems = invoiceProblems(v);
  v.ledgerIssues = hasLedgerList() ? ledgerProblems(v) : ["Tally ledger list not loaded"];
  const sure = v.problems.length === 0 && v.ledgerIssues.length === 0 && (v.custSure || v.userLedger || v.source === "created");
  if (v.status !== "ready" || v.problems.length || v.ledgerIssues.length) v.status = sure && SL().cfg.auto !== false ? "ready" : "review";
}
function learnCustomer(v){
  const k = salesHistKey(v); if (!k || !v.customerLedger) return;
  const h = SL().hist[k];
  SL().hist[k] = {l: v.customerLedger, n: h && h.l === v.customerLedger ? h.n + 1 : 1, at: new Date().toISOString()};
  saveSales({hist: true});
}
/* ---------- Tally XML ---------- */
function salesVoucherXml(v, co){
  const x = v.x, cfg = SL().cfg, cn = x.noteKind === "credit";
  const vt = xesc(cn ? (cfg.creditNoteType || "Credit Note") : x.noteKind === "debit" ? (cfg.debitNoteType || "Debit Note") : (cfg.voucherType || "Sales")), d = tallyDate(x.date);
  const pos = x.pos || stateOfGstin(x.customerGstin) || stateOfGstin(co.gstin);
  const amt2 = n => r2(n).toFixed(2);
  let s = '<VOUCHER VCHTYPE="' + vt + '" ACTION="Create" OBJVIEW="Accounting Voucher View">\n<DATE>' + d + "</DATE>\n<EFFECTIVEDATE>" + d + "</EFFECTIVEDATE>\n" +
    "<VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME>\n<VOUCHERNUMBER>" + xesc(x.number) + "</VOUCHERNUMBER>\n<REFERENCE>" + xesc(x.number) + "</REFERENCE>\n<REFERENCEDATE>" + d + "</REFERENCEDATE>\n" +
    "<PARTYLEDGERNAME>" + xesc(tallyLedgerName(v.customerLedger)) + "</PARTYLEDGERNAME>\n<PARTYNAME>" + xesc(x.customerName || v.customerLedger) + "</PARTYNAME>\n<BASICBUYERNAME>" + xesc(x.customerName || v.customerLedger) + "</BASICBUYERNAME>\n" +
    (x.customerGstin ? "<PARTYGSTIN>" + xesc(x.customerGstin) + "</PARTYGSTIN>\n<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n" : "<GSTREGISTRATIONTYPE>Unregistered/Consumer</GSTREGISTRATIONTYPE>\n") +
    (pos && GST_STATES[pos] ? "<STATENAME>" + xesc(GST_STATES[pos]) + "</STATENAME>\n<PLACEOFSUPPLY>" + xesc(GST_STATES[pos]) + "</PLACEOFSUPPLY>\n" : "") +
    "<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>\n" +
    (co.gstin ? "<CMPGSTIN>" + xesc(co.gstin) + "</CMPGSTIN>\n" : "") +
    (x.irn ? "<IRN>" + xesc(x.irn) + "</IRN>\n" : "") +
    "<NARRATION>" + xesc((x.noteKind === "credit" ? "Being credit note " : x.noteKind === "debit" ? "Being debit note " : v.source === "created" ? "Sales invoice " : "Being sales invoice ") + x.number + " dated " + fmtDate(x.date) + " to " + (x.customerName || v.customerLedger) + " | TDSDesk:" + v.id) + "</NARRATION>\n" +
    "<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n<ISINVOICE>No</ISINVOICE>\n<ISOPTIONAL>" + (co.createOptional ? "Yes" : "No") + "</ISOPTIONAL>\n";
  salesLines(v).forEach(l => {
    const dr = cn ? l.side !== "Dr" : l.side === "Dr", a = (dr ? "-" : "") + amt2(l.amt);
    s += "<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>" + xesc(tallyLedgerName(l.ledger)) + "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>" + (dr ? "Yes" : "No") + "</ISDEEMEDPOSITIVE>\n<ISPARTYLEDGER>" + (l.role === "party" ? "Yes" : "No") + "</ISPARTYLEDGER>\n<AMOUNT>" + a + "</AMOUNT>\n";
    if (l.role === "party") s += "<BILLALLOCATIONS.LIST>\n<NAME>" + xesc(x.number) + "</NAME>\n<BILLTYPE>New Ref</BILLTYPE>\n" + (x.dueDays ? "<BILLCREDITPERIOD>" + num(x.dueDays) + " Days</BILLCREDITPERIOD>\n" : "") + "<AMOUNT>" + a + "</AMOUNT>\n</BILLALLOCATIONS.LIST>\n";
    s += "</ALLLEDGERENTRIES.LIST>\n";
  });
  return s + "</VOUCHER>\n";
}
function customerMasterXml(l){
  const st = stateOfGstin(l.gstin) || l.state || "";
  return '<LEDGER NAME="' + xesc(l.name) + '" ACTION="Create">\n<NAME.LIST>\n<NAME>' + xesc(l.name) + "</NAME>\n</NAME.LIST>\n<PARENT>" + xesc(l.group || "Sundry Debtors") + "</PARENT>\n<ISBILLWISEON>Yes</ISBILLWISEON>\n" +
    (l.pan ? "<INCOMETAXNUMBER>" + xesc(l.pan) + "</INCOMETAXNUMBER>\n" : "") +
    (l.gstin ? "<PARTYGSTIN>" + xesc(l.gstin) + "</PARTYGSTIN>\n<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n" : "") +
    (st && GST_STATES[st] ? "<LEDSTATENAME>" + xesc(GST_STATES[st]) + "</LEDSTATENAME>\n<COUNTRYNAME>India</COUNTRYNAME>\n" : "") +
    (l.address ? "<ADDRESS.LIST>\n" + String(l.address).split(/\n/).filter(Boolean).slice(0, 4).map(a => "<ADDRESS>" + xesc(a) + "</ADDRESS>\n").join("") + "</ADDRESS.LIST>\n" : "") +
    "</LEDGER>\n";
}
/* ---------- reading uploaded sales invoices ---------- */
function salesPrompt(text, fileName, nImages, co){
  return "You read an Indian GST sales (tax) invoice issued by " + co.name + (co.gstin ? " (GSTIN " + co.gstin + ")" : "") + ". The customer is the buyer / bill-to party.\n" +
    (text ? "Text found in the file (may be incomplete):\n" + String(text).slice(0, 6000) + "\n" : "") +
    (nImages ? "The invoice pages are attached as " + nImages + " image(s).\n" : "") +
    "File name: " + fileName + "\n" +
    'Reply with only JSON: {"invoiceNo":"","invoiceDate":"YYYY-MM-DD","sellerGstin":"","customerName":"","customerGstin":"","customerAddress":"","placeOfSupply":"state name or 2-digit code",' +
    '"items":[{"description":"","hsn":"","qty":0,"unit":"","rate":0,"taxable":0,"gstRate":0}],"taxableValue":0,"cgst":0,"sgst":0,"igst":0,"cess":0,"roundOff":0,"totalAmount":0,"irn":"","dueDays":0}. ' +
    "Use 0 or empty when a value is not on the invoice. Amounts are plain numbers without commas.";
}
// the customer name: the line under "Bill to" (or on it), else the line above the customer's GSTIN
function customerFromText(text, custGstin, co){
  const lines = String(text || "").split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const bad = l => /gstin|gst\s*no|pan\b|address|place\s*of|state\b|phone|mobile|email|invoice|date|^\d|pin\s*code|\b\d{6}\b|tax\s*invoice|original|duplicate/i.test(l) || normName(l) === normName(co.name) || l.length < 3;
  const clean = l => l.replace(/^(bill(ed)?\s*to|buyer|customer|consignee|party|ship(ped)?\s*to|details\s+of\s+receiver)\s*(\(.*?\))?\s*[:\-]?\s*/i, "").replace(/^m\/s\.?\s*/i, "").trim();
  const at = lines.findIndex(l => /^(bill(ed)?\s*to|buyer|customer|consignee|details\s+of\s+receiver)\b/i.test(l));
  if (at >= 0){
    const same = clean(lines[at]);
    if (same && !bad(same)) return same;
    for (let i = at + 1; i < Math.min(lines.length, at + 4); i++){ const c = clean(lines[i]); if (c && !bad(c)) return c; }
  }
  if (custGstin){
    const gi = lines.findIndex(l => l.toUpperCase().replace(/\s/g, "").includes(custGstin));
    for (let i = gi - 1; i >= Math.max(0, gi - 3); i--){ const c = clean(lines[i]); if (c && !bad(c)) return c; }
  }
  return "";
}
function posFromText(text){
  const m = String(text || "").match(/place\s*of\s*supply\s*[:\-]?\s*([A-Za-z &.]+?)\s*(?:\(?\s*(\d{2})\s*\)?)?(?:\n|$|,)/i);
  return m ? (m[2] && GST_STATES[m[2]] ? m[2] : stateCodeFrom(m[1])) : "";
}
function salesFromFree(fp, co, text){
  const j = fp.j;
  const cust = j.vendorGstin && j.vendorGstin !== co.gstin ? j.vendorGstin : j.buyerGstin && j.buyerGstin !== co.gstin ? j.buyerGstin : "";
  return {number: j.invoiceNo || "", date: j.invoiceDate || "", sellerGstin: [j.vendorGstin, j.buyerGstin].includes(co.gstin) ? co.gstin : "",
    customerName: customerFromText(text || String(j.hint || "").replace(/ (bill(ed)? to|buyer|gstin|place of supply)/gi, "\n$1"), cust, co) || (cust ? (j.vendorGstin === cust ? j.vendorName : j.buyerName) || "" : ""),
    customerGstin: cust, pos: stateOfGstin(cust) || posFromText(text || j.hint),
    taxable: num(j.taxableValue), cgst: num(j.cgst), sgst: num(j.sgst), igst: num(j.igst), cess: 0, total: num(j.totalAmount), items: []};
}
function salesFromClaude(j, co){
  const g = s => fixGstin(s).value || "";
  const cust = g(j.customerGstin);
  const items = (j.items || []).filter(it => it && (num(it.taxable) || num(it.qty))).map(it => ({desc: String(it.description || "").slice(0, 200), hsn: String(it.hsn || ""), qty: num(it.qty), unit: String(it.unit || ""), rate: num(it.rate), disc: 0, taxable: num(it.taxable) || r2(num(it.qty) * num(it.rate)), gstRate: num(it.gstRate)}));
  return {number: String(j.invoiceNo || "").trim(), date: /^\d{4}-\d{2}-\d{2}$/.test(j.invoiceDate || "") ? j.invoiceDate : "", sellerGstin: g(j.sellerGstin),
    customerName: String(j.customerName || "").trim(), customerGstin: cust && cust !== co.gstin ? cust : "", address: String(j.customerAddress || ""),
    pos: stateCodeFrom(j.placeOfSupply) || stateOfGstin(cust), taxable: num(j.taxableValue), cgst: num(j.cgst), sgst: num(j.sgst), igst: num(j.igst), cess: num(j.cess),
    total: num(j.totalAmount), irn: String(j.irn || ""), dueDays: num(j.dueDays), items};
}
async function readSalesFile(file, cid, progress, pageList, force){
  const co = CO(cid), trace = [];
  let text = "", canvases = [], kind;
  if (isPdf(file)){ const r = await pdfPages(file, pageList || [1, 2]); text = r.text; canvases = r.canvases; kind = text.replace(/\s/g, "").length >= 80 ? "pdf_text" : "pdf_scan"; }
  else if (isImage(file)){ canvases = [await imageToCanvas(file)]; kind = "photo"; }
  else throw {code: "sales_type"};
  let best = null;
  const tryText = (t, label) => {
    const fp = freeParse(t, cid, file.name, {ocr: kind !== "pdf_text"});
    const x = salesFromFree(fp, co, t);
    const why = fp.why.filter(w => !/supplier GSTIN not found|client's own sales invoice|not a standard rate/.test(w));
    const ok = why.length === 0 && x.number && x.date && x.total > 0;
    trace.push({step: label, ok, note: ok ? "all checks passed" : why.join("; ")});
    if (!best || ok) best = {x, ok, why};
    return ok;
  };
  if (kind === "pdf_text") tryText(text, "PDF\u2019s own text");
  if (!(best && best.ok) && canvases.length){
    if (progress) progress("reading the scan");
    for (const psm of ["3", "11"]){
      const o = await ocrCanvas(canvases[0], psm).catch(() => null);
      if (!o) break;
      if (tryText(o.text, "Built-in OCR")) break;
    }
  }
  if (force === "google" && googleReady()){
    try { const o = await googleOcr(canvases[0] || (await imageToCanvas(file))); if (tryText(o.text, "Google OCR")) { /* best updated inside */ } } catch (e){ trace.push({step: "Google OCR", ok: false, note: (e && e.code) || "failed"}); }
  }
  if (best && best.ok && force !== "claude"){ best.x.noteKind = best.x.noteKind || noteKindOf(String(text || "").split("\n")); return {x: best.x, method: force === "google" ? "google-ocr" : "free", trace}; }
  // Claude reads the rest (items included)
  if (S.engine){
    if (progress) progress("asking Claude");
    let images = [];
    if (S.imgMax && canvases.length){ for (const c of canvases.slice(0, Math.min(2, S.imgMax))) images.push(await imgBlob(c, kind === "pdf_text" ? "page" : "photo")); images = images.filter(Boolean); }
    try {
      const j = await claudeRead(salesPrompt(kind === "pdf_text" ? text : "", file.name, images.length, co), images, false);
      const x = salesFromClaude(j, co);
      trace.push({step: images.length ? "Claude (images)" : "Claude (text)", ok: !!(x.number && x.total), note: x.number ? "read" : "incomplete"});
      if (x.number || x.total) return {x, method: "claude", trace};
    } catch (e){ trace.push({step: "Claude", ok: false, note: errCopy(e && e.code)}); }
  }
  if (best && (best.x.number || best.x.total)) return {x: best.x, method: "free-partial", trace};
  throw {code: "sales_unreadable", trace};
}
function newInvoice(x, source, extra){
  return Object.assign({id: uid("sv"), source, status: "review", x: Object.assign({number: "", date: "", customerName: "", customerGstin: "", address: "", pos: "", taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0, items: []}, x),
    customerLedger: "", userLedger: false, createdAt: new Date().toISOString()}, extra || {});
}
async function rereadSales(v, force){
  const s = SL(); if (!s) return;
  const file = S.files["sv:" + v.id];
  if (!file){ toast("The file for this invoice is not on this computer any more. Upload it again."); return; }
  if (force === "claude" && !claudeReady()){ toast("Claude is not available on this plan or in this view."); return; }
  if (force === "google" && !googleReady()){ toast("Google OCR is not set up."); return; }
  s.busy = force === "claude" ? "Reading again with Claude\u2026" : force === "google" ? "Reading again with Google OCR\u2026" : "Reading again\u2026"; render();
  try {
    const r = await readSalesFile(file, s.cid, m => { s.busy = m + "\u2026"; render(); }, null, force);
    Object.assign(v.x, r.x || {});
    v.method = r.method; v.problems = []; mapInvoice(v); saveSales();
    toast("Read again: " + (r.method || "") + ". Check the invoice.");
  } catch (e){ toast("Could not read it that way: " + errCopy(e && e.code)); }
  s.busy = ""; render();
}
