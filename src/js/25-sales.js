/* ================================================================== */
/* Sales: read sales invoices, create invoices, post Sales vouchers    */
/* ================================================================== */
const GST_STATES = {"01":"Jammu and Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan",
  "09":"Uttar Pradesh","10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam",
  "19":"West Bengal","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat","26":"Dadra and Nagar Haveli and Daman and Diu","27":"Maharashtra",
  "29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu","34":"Puducherry","35":"Andaman and Nicobar Islands","36":"Telangana","37":"Andhra Pradesh",
  "38":"Ladakh","97":"Other Territory","96":"Other Country"};
// the states in code order (01 … 38, then 96, 97): an object's number-like keys ("10") come before "01" in JavaScript
function gstStateList(){ return Object.keys(GST_STATES).sort((a, b) => num(a) - num(b)).map(c => [c, GST_STATES[c]]); }
const SALES_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];
// From 22-09-2025 (GST rate rationalisation) most goods and services moved from 12% to 5% and from 28% to 18%;
// 12% and 28% remain only for a few items. Kept in the list, with a warning on later invoices (review item 10).
const GST_RATE_CHANGE = "2025-09-22";
function salesRateWarnings(x){
  const out = [];
  if (!x || !x.date || x.date < GST_RATE_CHANGE) return out;
  (x.items || []).forEach((it, i) => {
    const r = num(it.gstRate);
    if ((r === 12 || r === 28) && (String(it.desc || "").trim() || num(it.rate)))
      out.push("Item " + (i + 1) + (it.hsn ? " (HSN/SAC " + it.hsn + ")" : "") + ": " + r + "% applies after 22-09-2025 only to a few items; most moved to " + (r === 12 ? "5%" : "18%") + ". Check the rate for this HSN/SAC.");
  });
  return out;
}
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
  SALES_REV++; Object.assign(S.sales, {list: list || [], cfg: Object.assign({}, SALES_CFG_DEFAULT, cfg || {}), hist: hist || {}, loading: false});
  // invoices filed from elsewhere are matched now
  const pend = S.sales.list.filter(v => v.needsMap);
  if (pend.length){ pend.forEach(v => { v.needsMap = false; mapInvoice(v); }); saveSales(); }
  render();
  if (bridgeLive(CO(cid))) salesAutoSync();
}
let salesSaveTimer = null;
// next-fix-hang (review of bb5a5c53d): moved by every save of the sales (and their loading), so the GST figures kept
// across drawings (GSTR.keptState, src/js/12) see a marketplace invoice changed in place (ignored, its GSTIN typed, undone)
let SALES_REV = 0;
function saveSales(what){
  SALES_REV++;
  const s = SL(); if (!s) return;
  const cid = s.cid, list = s.list;
  if (typeof cloudSoon === "function") cloudSoon();
  clearTimeout(salesSaveTimer);
  if (S.bank && S.bank.cid === cid) S.bank.salesRef = list;
  salesSaveTimer = setTimeout(() => { salesSaveTimer = null; BankDB.set("sales:" + cid, list); }, 500);
  if (what && what.cfg && !(typeof Drafts === "object" && Drafts.hold("salescfg:" + cid))) BankDB.set("salescfg:" + cid, s.cfg);
  if (what && what.hist) BankDB.set("saleshist:" + cid, s.hist);
}
window.addEventListener("pagehide", () => { if (salesSaveTimer && S.sales){ clearTimeout(salesSaveTimer); BankDB.set("sales:" + S.sales.cid, S.sales.list); } });
function inv(id){ const s = SL(); return s && s.list.find(v => v.id === id); }

/* ---------- ledgers (exact Tally names only) ---------- */
// (by the whole group chain: a client keeps its sales ledgers under "Sales Local" under Sales Accounts, its GST under "GST Output")
// (worked out once for a ledger list: it is asked for every line of every invoice)
// and afresh when the list or any source of the groups' parents changes (Ledgers.chain's: the list's own, the books', the cloud's)
let ledInKept = [];
function ledgersIn(re){
  const b = B(); if (!b) return [];
  const L = b.ledgers.list || [], K = [L, b.ledgers.parents, S.books && S.books.groups, (Ledgers.st[b.cid] || 0).parents, Ledgers.ver];
  if (K.some((x, i) => x !== ledInKept[i])) (ledInKept = K).m = {};
  return ledInKept.m[re] || (ledInKept.m[re] = L.filter(l => re.test(l.group || "") || Ledgers.chain(b.cid, l.name).some(g => re.test(g))));
}
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
// output tax ledgers (optionally rate-wise, e.g. "Output CGST 9%"); v: the invoice, for the state of the client's own
// registration it is issued from (next-fix-igst-pick, 16-Nov-2026: taxLedgerPick, below)
function taxLedgerFor(kind, rate, v){ return taxLedgerPick(kind, rate, v).ledger; }
/* ---------- the output GST ledger by the registration an invoice is issued from ---------- */
// A client registered in several states keeps an output IGST (CGST, SGST) ledger for each, tagged by the state ("IGST
// Output - Maharashtra", "Output IGST 27", "Output SGST MH") or by the GSTIN on its Tally master, and often a plain one
// too. The owner's decision (16-Nov-2026): the ledger of the state of the client's own GSTIN the invoice is issued from
// (the invoice's own GSTIN, else the client's, else the registration its branch or series was seen with); else the one
// untagged ledger; else a person chooses once, for the client (and the state, with several registrations): never a guess
const GST_ABBR = {"01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK UT", "06": "HR", "07": "DL", "08": "RJ", "09": "UP", "10": "BR", "11": "SK", "12": "AR", "13": "NL", "14": "MN",
  "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH", "21": "OD OR", "22": "CG CT", "23": "MP", "24": "GJ", "26": "DNHDD DN DD", "27": "MH", "29": "KA", "30": "GA", "31": "LD",
  "32": "KL", "33": "TN", "34": "PY", "35": "AN", "36": "TS TG", "37": "AP", "38": "LA"};
const GST_STATE_ALIAS = {"05": ["uttaranchal"], "07": ["new delhi"], "21": ["orissa"], "26": ["daman", "dadra"], "34": ["pondicherry"], "36": ["telengana"]};
// (abbreviations that are English words count only in capitals: "as per", "set up")
const GST_ABBR_WORDS = /^(AS|UP|OR|CH|AN|GA|LA)$/;
let ledStateKept = {};
// the state a ledger is kept for: by its Tally master's GSTIN, else its name (a state's name, a code not a rate, an abbreviation); "" untagged
function ledgerStateTag(l){
  if (!l) return "";
  const key = l.name + "|" + (l.gstin || "") + "|" + (l.state || "");
  if (key in ledStateKept) return ledStateKept[key];
  const g = stateOfGstin(String(l.gstin || "").toUpperCase());
  let st = g && GST_STATES[g] ? g : "";
  const name = String(l.name || ""), low = " " + name.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  if (!st && l.state) st = stateCodeFrom(l.state);
  if (!st){ const m = name.toUpperCase().match(/\b(\d{2})[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/); if (m && GST_STATES[m[1]]) st = m[1]; }
  if (!st) st = (Object.entries(GST_STATES).find(([c, s]) => +c < 90 && [s].concat(GST_STATE_ALIAS[c] || []).some(n => low.includes(" " + n.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " "))) || [""])[0];
  // a code: two digits on their own, not a rate ("18%", "@ 18", "18 %") nor part of a figure
  if (!st){ const m = name.replace(/@\s*\d+(\.\d+)?/g, " ").replace(/\d+(\.\d+)?\s*%/g, " ").match(/(^|[^0-9.])(\d{2})(?![0-9.%])/); if (m && GST_STATES[m[2]] && +m[2] < 90) st = m[2]; }
  if (!st){
    const words = name.split(/[^A-Za-z]+/).filter(Boolean);
    st = (Object.entries(GST_ABBR).find(([c, a]) => a.split(" ").some(ab => words.some(w => w.toUpperCase() === ab && (!GST_ABBR_WORDS.test(ab) || w === ab)))) || [""])[0];
  }
  if (Object.keys(ledStateKept).length > 2000) ledStateKept = {};
  return (ledStateKept[key] = st);
}
function gstStateWords(c){ return c ? c + (GST_STATES[c] ? " " + GST_STATES[c] : "") : ""; }
// the client's own GSTINs: its own (client setup), and those read from Tally or added in GST settings
function salesOwnGstins(){
  const s = SL(), co = CO(s && s.cid) || {}, own = String(co.gstin || "").toUpperCase().trim();
  const fromBooks = S.books && (!S.books.cid || S.books.cid === co.id) && typeof GSTR === "object" && GSTR.gstins ? GSTR.gstins(S.books) : [];
  return Array.from(new Set([own].concat(fromBooks || [], co.gstins || []).map(g => String(g || "").toUpperCase()).filter(g => /^\d{2}[A-Z0-9]{13}$/.test(g))));
}
function salesOwnStates(){ return Array.from(new Set(salesOwnGstins().map(stateOfGstin).filter(Boolean))); }
// an invoice's branch or series, as a key ("b:bengaluru", "s:MH/##-##/")
function salesSeriesKeys(x){
  const k = [];
  if (String(x.branch || "").trim()) k.push("b:" + String(x.branch).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const no = String(x.number || "").toUpperCase().trim();
  if (/[A-Z]/.test(no.replace(/\d+\s*$/, ""))) k.push("s:" + no.replace(/\d+\s*$/, "").replace(/\d/g, "#"));
  return k;
}
// the client's own GSTIN this invoice is issued from: {code, gstin, why}; code "" when not known
function salesRegOf(v){
  const x = (v && v.x) || {}, s = SL(), own = salesOwnGstins();
  const g = String(x.sellerGstin || "").toUpperCase().trim();
  if (/^\d{2}[A-Z0-9]{13}$/.test(g) && GST_STATES[stateOfGstin(g)]) return {code: stateOfGstin(g), gstin: g, why: "the invoice’s own GSTIN"};
  const states = salesOwnStates();
  if (states.length === 1) return {code: states[0], gstin: own.find(z => stateOfGstin(z) === states[0]) || "", why: "the client’s GSTIN"};
  if (states.length > 1){
    const by = (s && s.cfg.regBy) || {};
    for (const k of salesSeriesKeys(x)) if (by[k] && states.includes(by[k])) return {code: by[k], gstin: own.find(z => stateOfGstin(z) === by[k]) || "", why: (k[0] === "b" ? "branch " + x.branch : "series " + k.slice(2)) + " is issued from it"};
  }
  return {code: "", gstin: "", why: "", several: states.length > 1};
}
// an invoice with its own GSTIN teaches its branch and series (for the invoices of that branch with none)
function salesLearnReg(v){
  const s = SL(), g = String(v.x.sellerGstin || "").toUpperCase(), c = stateOfGstin(g);
  if (!s || !c || !/^\d{2}[A-Z0-9]{13}$/.test(g) || salesOwnStates().length < 2 || !salesOwnStates().includes(c)) return;
  const by = s.cfg.regBy = s.cfg.regBy || {};
  let changed = false;
  salesSeriesKeys(v.x).forEach(k => { if (by[k] !== c){ by[k] = c; changed = true; } });
  if (changed && !s.regSaving){ s.regSaving = true; setTimeout(() => { s.regSaving = false; if (SL() === s) saveSales({cfg: true}); }, 0); }
}
// a person's one-click choice of the output GST ledger (the bar's or a row's): kept for the client (and the state, with
// several registrations), and every invoice of the client still waiting takes it at once. Posted invoices are not touched,
// nor a customer ledger a person set (mapInvoice keeps it)
function salesPickTax(ck, ledger){
  const s = SL(), l = exactLedger(ledger);
  if (!s || !ck || !l) return 0;
  const waiting = s.list.filter(v => ["review", "ready"].includes(v.status));
  if (!waiting.some(v => (v.taxAsk || []).some(a => a.ck === ck && a.cands.includes(l)))) return 0;
  s.cfg.taxPick = Object.assign({}, s.cfg.taxPick, {[ck]: l});
  let n = 0;
  waiting.forEach(v => { const had = (v.taxAsk || []).some(a => a.ck === ck); mapInvoice(v); if (had && !(v.taxAsk || []).some(a => a.ck === ck)) n++; });
  saveSales({cfg: true});
  if (typeof toast === "function") toast(l + " set as the output " + ck.replace(/[_@].*$/, "").toUpperCase() + " ledger: " + n + " invoice" + (n === 1 ? "" : "s") + " updated.");
  if (typeof render === "function") render();
  return n;
}
// {ledger, why, cands, ck, reg}: cands (several) and ck (the choice's key) when a person must choose
function taxLedgerPick(kind, rate, v){
  const cfg = SL().cfg, L = cfg.ledgers || {}, K0 = kind.toUpperCase();
  const half = kind === "igst" || kind === "cess" ? rate : rate / 2;
  for (const k of [kind + "_" + rateTag(half), kind]){ const e = exactLedger(L[k]); if (e) return {ledger: e, why: "set in Sales settings"}; }
  const K = {cgst: /c\.?\s*gst|central\s*(gst|tax)/i, sgst: /s\.?\s*gst|state\s*(gst|tax)|utgst/i, igst: /i\.?\s*gst|integrated/i, cess: /cess/i, }[kind];
  const taxes = ledgersIn(/duties|taxes/i).filter(l => K.test(l.name) && !/input|itc|credit|receivable|rcm|reverse/i.test(l.name) && !(kind === "sgst" && /cgst|igst/i.test(l.name)));
  const out = taxes.filter(l => /output|payable|liab/i.test(l.name));
  const pool = out.length ? out : taxes;
  const rateHit = pool.filter(l => new RegExp("(^|[^0-9.])" + rateTag(half).replace(".", "\\.") + "\\s*%").test(l.name));
  const plain = pool.filter(l => !/\d\s*%/.test(l.name));
  const cand = rateHit.length ? rateHit : plain.length ? plain : pool;
  if (!cand.length) return {ledger: "", why: ""};
  const reg = v ? salesRegOf(v) : {code: ""}, multi = salesOwnStates().length > 1;
  const ck = kind + (rateHit.length ? "_" + rateTag(half) : "") + (multi ? "@" + (reg.code || "?") : "");
  const chosen = exactLedger((cfg.taxPick || {})[ck]);
  if (chosen && cand.some(l => l.name === chosen)) return {ledger: chosen, why: "chosen by you" + (multi && reg.code ? " for " + gstStateWords(reg.code) : "") + " (Sales: " + K0 + " ledger)"};
  if (cand.length === 1) return {ledger: cand[0].name, why: "the only output " + K0 + " ledger"};
  const tagged = cand.map(l => ({l, st: ledgerStateTag(l)}));
  if (reg.code){
    const hit = tagged.filter(t => t.st === reg.code);
    if (hit.length === 1) return {ledger: hit[0].l.name, why: "picked by state " + gstStateWords(reg.code) + " (" + reg.why + ")"};
    if (hit.length > 1) return {ledger: "", why: "", cands: hit.map(t => t.l.name), ck, reg: reg.code};
  }
  const untagged = tagged.filter(t => !t.st);
  if (untagged.length === 1) return {ledger: untagged[0].l.name, why: "the only output " + K0 + " ledger not tagged by a state" + (reg.code ? " (none tagged " + gstStateWords(reg.code) + ")" : "")};
  return {ledger: "", why: "", cands: cand.map(l => l.name), ck, reg: reg.code || ""};
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
// (the home state: the client's registration the invoice is issued from, salesRegOf; else the client's GSTIN)
function isInterState(x, co){ const home = (SL() && salesRegOf({x}).code) || stateOfGstin(co.gstin); const pos = x.pos || stateOfGstin(x.customerGstin) || home; return !!(home && pos && home !== pos); }
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
  // (each line says why its ledger, or, when a person must choose, the candidates and the choice's key)
  const pickTo = (e, pk) => { if (pk.why) e.why = pk.why; if (pk.cands){ e.cands = pk.cands; e.ck = pk.ck; e.reg = pk.reg; } return e; };
  taxParts.forEach(t => { if (!t.amt) return; const pk = taxLedgerPick(t.kind, t.rate, v), l = pk.ledger || ""; const k = l || t.kind + "?"; const e = byLedger.get(k) || pickTo({side: "Cr", ledger: l, amt: 0, role: "tax", kind: t.kind}, pk); e.amt = r2(e.amt + t.amt); byLedger.set(k, e); });
  byLedger.forEach(e => lines.push(e));
  if (num(x.cess)){ const pk = taxLedgerPick("cess", 0, v); lines.push(pickTo({side: "Cr", ledger: pk.ledger, amt: r2(num(x.cess)), role: "tax", kind: "cess"}, pk)); }
  const cr = r2(lines.filter(l => l.side === "Cr").reduce((a, l) => a + l.amt, 0));
  const ro = r2(total - cr);
  if (Math.abs(ro) >= 0.01) lines.push({side: ro > 0 ? "Cr" : "Dr", ledger: roundOffLedger(), amt: Math.abs(ro), role: "roundoff"});
  return lines;
}
function invoiceProblems(v){
  const co = CO(SL().cid), x = v.x, p = [];
  if (v.hold) p.push(v.hold);   // a sheet's row held for a person (a negative amount its Type column does not explain)
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
  if (x.sellerGstin && co.gstin && !salesIsOwn(x.sellerGstin, co)) p.push("the seller GSTIN on the invoice is not " + co.name + "\u2019s");
  const dup = SL().list.find(o => o.id !== v.id && o.status !== "ignored" && normInvNo(o.x.number) === normInvNo(x.number) && o.x.date && x.date && fyLabel(o.x.date) === fyLabel(x.date));
  if (x.number && dup) p.push("invoice " + x.number + " already exists");
  return p;
}
// one of the client's own GSTINs (a registration of its PAN in another state is its own too)
function salesIsOwn(g, co){ g = String(g || "").toUpperCase(); return salesOwnGstins().includes(g) || (!!co.gstin && g.length === 15 && g.slice(2, 12) === String(co.gstin).toUpperCase().slice(2, 12)); }
function normInvNo(s){ return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, ""); }
function ledgerProblems(v, lines){
  const p = [];
  (lines || salesLines(v)).forEach(l => { if (!l.ledger) p.push({party: "customer ledger", sales: "sales ledger for " + rateTag(l.rate) + "%", tax: (l.kind || "tax").toUpperCase() + " output ledger", roundoff: "round-off ledger"}[l.role] + " not set" + (l.cands ? ": " + l.cands.length + " fit" + (l.reg ? " for " + gstStateWords(l.reg) : "") + ", choose one" : "")); else if (!exactLedger(l.ledger)) p.push("\u201c" + l.ledger + "\u201d is not a Tally ledger"); });
  return p;
}
// work out ledgers and status for an invoice
function mapInvoice(v){
  if (["posted", "intally", "ignored"].includes(v.status)) return;
  if (!v.userLedger || !exactLedger(v.customerLedger)){
    const c = hasLedgerList() ? customerLedgerFor(v) : {ledger: "", sure: false, label: ""};
    v.customerLedger = c.ledger; v.custSource = c.label; v.custSure = c.sure; v.userLedger = false;
  }
  salesLearnReg(v);
  v.problems = invoiceProblems(v);
  const lines = hasLedgerList() ? salesLines(v) : null;
  v.ledgerIssues = lines ? ledgerProblems(v, lines) : ["Tally ledger list not loaded"];
  // the output GST ledgers picked, with why (shown on the row), and the choices a person must make (next-fix-igst-pick)
  v.taxPicks = lines ? lines.filter(l => l.role === "tax" && l.ledger).map(l => ({kind: l.kind, ledger: l.ledger, why: l.why || ""})) : [];
  v.taxAsk = lines ? lines.filter(l => l.role === "tax" && !l.ledger && l.cands).map(l => ({kind: l.kind, ck: l.ck, reg: l.reg || "", cands: l.cands})) : [];
  // (an invoice a person said is not the Tally entry it was matched to waits for a person to set its ledger)
  const sure = v.problems.length === 0 && v.ledgerIssues.length === 0 && (v.custSure || v.userLedger || v.source === "created") && !(v.notTally && !v.userLedger);
  if (v.status !== "ready" || v.problems.length || v.ledgerIssues.length) v.status = sure && SL().cfg.auto !== false ? "ready" : "review";
}
function learnCustomer(v){
  const k = salesHistKey(v); if (!k || !v.customerLedger) return;
  const h = SL().hist[k];
  SL().hist[k] = {l: v.customerLedger, n: h && h.l === v.customerLedger ? h.n + 1 : 1, at: new Date().toISOString()};
  saveSales({hist: true});
}
/* ---------- Tally XML ---------- */
// the voucher type of a sales document: the Sales screen's, by its kind (never a sheet's own type name)
function salesVt(x){ const c = SL().cfg; return x.noteKind === "credit" ? c.creditNoteType || "Credit Note" : x.noteKind === "debit" ? c.debitNoteType || "Debit Note" : c.voucherType || "Sales"; }
// the company GSTIN of the voucher: the client's registration the invoice is issued from, else its own
function salesCmpGstin(v, co){ const r = salesRegOf(v); return r.gstin && salesIsOwn(r.gstin, co) ? r.gstin : co.gstin || ""; }
function salesVoucherXml(v, co){
  const x = v.x, cn = x.noteKind === "credit";
  const vt = xesc(salesVt(x)), d = toTallyDate(x.date);
  const pos = x.pos || stateOfGstin(x.customerGstin) || stateOfGstin(co.gstin);
  const amt2 = n => r2(n).toFixed(2);
  let s = '<VOUCHER VCHTYPE="' + vt + '" ACTION="Create" OBJVIEW="Accounting Voucher View">\n<DATE>' + d + "</DATE>\n<EFFECTIVEDATE>" + d + "</EFFECTIVEDATE>\n" +
    "<VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME>\n<VOUCHERNUMBER>" + xesc(x.number) + "</VOUCHERNUMBER>\n<REFERENCE>" + xesc(x.number) + "</REFERENCE>\n<REFERENCEDATE>" + d + "</REFERENCEDATE>\n" +
    "<PARTYLEDGERNAME>" + xesc(tallyLedgerName(v.customerLedger)) + "</PARTYLEDGERNAME>\n<PARTYNAME>" + xesc(x.customerName || v.customerLedger) + "</PARTYNAME>\n<BASICBUYERNAME>" + xesc(x.customerName || v.customerLedger) + "</BASICBUYERNAME>\n" +
    (x.customerGstin ? "<PARTYGSTIN>" + xesc(x.customerGstin) + "</PARTYGSTIN>\n<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n" : "<GSTREGISTRATIONTYPE>Unregistered/Consumer</GSTREGISTRATIONTYPE>\n") +
    (pos && GST_STATES[pos] ? "<STATENAME>" + xesc(GST_STATES[pos]) + "</STATENAME>\n<PLACEOFSUPPLY>" + xesc(GST_STATES[pos]) + "</PLACEOFSUPPLY>\n" : "") +
    "<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>\n" +
    (salesCmpGstin(v, co) ? "<CMPGSTIN>" + xesc(salesCmpGstin(v, co)) + "</CMPGSTIN>\n" : "") +
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
  await readerLoad();   // freeParse: the bill reader, the first time (src/js/82)
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
// rereadSales (an invoice read again): src/js/26-sales-invoice.js, with the Sales screen
