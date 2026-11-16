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
  // (item 6: the problems kept with an invoice waiting are worked out again on opening, so a label left from an earlier
  // state, "customer GSTIN is not valid" on a GSTIN since cleared, never stays)
  S.sales.list.forEach(v => { if (["review", "ready"].includes(v.status) && !v.needsMap){ const was = JSON.stringify(v.problems || []); v.problems = invoiceProblems(v); if (was !== JSON.stringify(v.problems)) mapInvoice(v); } });
  salesLearnVt();
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
// output tax ledgers (optionally rate-wise, e.g. "Output CGST 9%" or "Output IGST 18"); v: the invoice, for the state of
// the client's own registration it is issued from (next-fix-igst-pick, 16-Nov-2026: taxLedgerPick, below)
function taxLedgerFor(kind, rate, v){ return taxLedgerPick(kind, rate, v).ledger; }
/* ---------- the output GST ledger by the registration an invoice is issued from ---------- */
// A client registered in several states keeps an output IGST (CGST, SGST) ledger for each, tagged by the state ("IGST
// Output - Maharashtra", "Output SGST MH", "Output IGST (27)") or by the GSTIN on its Tally master, and often a plain one
// too. The owner's decision (16-Nov-2026): the ledger of the state of the client's own GSTIN the invoice is issued from
// (the invoice's own GSTIN, else the client's, else the registration its branch or series was seen with); else the one
// untagged ledger; else a person chooses: never a guess.
// Review of 2f8b825a7: a number in a ledger's name is a rate first ("Output IGST 18" is 18%, not Assam; "Output CGST 14"
// is half of 28%); a two-digit number is a state code only beside "state" / "code", in brackets, or after a separator
// with the state's own abbreviation or name ("- 27 MH"), never in a year ("FY 2026-27"), never in a rate-wise ledger list
const GST_ABBR = {"01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK", "06": "HR", "07": "DL", "08": "RJ", "09": "UP", "10": "BR", "11": "SK", "12": "AR", "13": "NL", "14": "MN",
  "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH", "21": "OD OR", "22": "CG CT", "23": "MP", "24": "GJ", "26": "DNHDD DN DD", "27": "MH", "29": "KA", "30": "GA", "31": "LD",
  "32": "KL", "33": "TN", "34": "PY", "35": "AN", "36": "TS TG", "37": "AP", "38": "LA"};
const GST_STATE_ALIAS = {"01": ["jammu kashmir", "j k"], "05": ["uttaranchal"], "07": ["new delhi"], "21": ["orissa"], "26": ["daman", "dadra"], "34": ["pondicherry"], "36": ["telengana"]};
// (abbreviations that are English words count only in capitals: "as per", "set up")
const GST_ABBR_WORDS = /^(AS|UP|OR|CH|AN|GA|LA)$/;
// the GST rates and their halves (CGST / SGST) a ledger's name may carry, with or without "%"
const GST_RATE_NUMS = [0.125, 0.25, 1.5, 2.5, 3, 5, 6, 9, 12, 14, 18, 20, 28, 40];
// a ledger's name with its years and GSTINs taken out ("FY 2026-27", "2025-2026", "2026")
function ledNameBare(name){ return String(name || "").replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/gi, " ").replace(/\b(fy|ay|f\.y\.)\s*\d{2,4}\s*[-\/]\s*\d{2,4}\b/gi, " ").replace(/\b(19|20)\d{2}\s*[-\/]\s*\d{2,4}\b/g, " ").replace(/\b(19|20)\d{2}\b/g, " "); }
// the state code a ledger's name gives by a number in a state's context: "State 27", "Code 27", "(27)", "- 27 MH"
function ledNumState(bare){
  const ok = c => GST_STATES[c] && +c < 90 ? c : "";
  let m = bare.match(/\b(state(\s*code)?|code)\s*(no\.?)?\s*[:#\-]?\s*(\d{2})(?![\d.%])/i); if (m && ok(m[4])) return m[4];
  m = bare.match(/(\d{2})\s*[:#\-]?\s*(state(\s*code)?|code)\b/i); if (m && ok(m[1])) return m[1];
  m = bare.match(/\(\s*(\d{2})\s*\)/); if (m && ok(m[1]) && !GST_RATE_NUMS.includes(+m[1])) return m[1];
  m = bare.match(/[-–\/|:]\s*(\d{2})\s*[-–\/|:]?\s*([A-Za-z][A-Za-z ]+)/);
  if (m && ok(m[1])){ const w = m[2].trim(), c = m[1]; if (GST_ABBR[c].split(" ").includes(w.split(/\s+/)[0].toUpperCase()) || stateCodeFrom(w) === c) return c; }
  return "";
}
// the rates a ledger's name carries, and whether a number in it leaves its rate in doubt (re-review of aec7142b3):
// a rate is a number with "%" (or "@ 18"), or a GST rate (or half) standing bare at the end of the name with no
// state / branch / code word before it; never a number with a leading zero ("Branch 05"); a state code in context
// ("Code 29") is not a rate. Any other number ("Output IGST 18 Sales", "Branch 05") puts the ledger in doubt: never
// picked by itself for a client with several registrations
function ledgerRateInfo(name){
  let bare = ledNameBare(name);
  const sc = ledNumState(bare); if (sc) bare = bare.replace(new RegExp("(^|[^\\d.])" + sc + "(?![\\d.])"), "$1 ");
  const rates = [];
  let doubt = false;
  const lead0 = n => /^0\d/.test(n);
  bare = bare.replace(/(^|[^\d.])(\d+(?:\.\d+)?)\s*%/g, (all, p, n) => { if (lead0(n)) doubt = true; else rates.push(+n); return p + " "; })
    .replace(/@\s*(\d+(?:\.\d+)?)(?![\d.])/g, (all, n) => { if (lead0(n) || !GST_RATE_NUMS.includes(+n)) doubt = true; else rates.push(+n); return " "; });
  const end = bare.match(/(^|[^\d.])(\d+(?:\.\d+)?)\s*\)?[\s.\-–_]*$/);
  if (end){
    const before = bare.slice(0, end.index + end[1].length).replace(/[\s(\-–_:#]+$/, ""), w = (before.match(/([A-Za-z.]+)$/) || [])[1] || "";
    if (!lead0(end[2]) && GST_RATE_NUMS.includes(+end[2]) && !/^(state|code|branch|br|unit|plant|div|division|depot|loc|location|no\.?|series|gstin|reg)$/i.test(w)) rates.push(+end[2]);
    else doubt = true;
    bare = bare.slice(0, end.index + end[1].length);
  }
  if (/\d/.test(bare)) doubt = true;
  return {rates, doubt};
}
function ledgerRates(name){ return ledgerRateInfo(name).rates; }
let ledStateKept = {};
// the state a ledger is kept for, each ledger on its own: its Tally master's GSTIN, else its name (a state's name, an
// abbreviation, a code in a state's context); "" untagged
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
  if (!st) st = ledNumState(ledNameBare(name));
  if (!st){
    const words = name.split(/[^A-Za-z]+/).filter(Boolean);
    st = (Object.entries(GST_ABBR).find(([c, a]) => a.split(" ").some(ab => words.some(w => w.toUpperCase() === ab && (!GST_ABBR_WORDS.test(ab) || w === ab)))) || [""])[0];
  }
  if (Object.keys(ledStateKept).length > 2000) ledStateKept = {};
  return (ledStateKept[key] = st);
}
function gstStateWords(c){ return c ? c + (GST_STATES[c] ? " " + GST_STATES[c] : "") : ""; }
// the client's own GSTINs, as its client setup keeps them (its GSTIN, and "Other GSTINs", its registrations in other
// states): never what happens to be loaded, so a choice kept for the client means the same each time (review of 2f8b825a7)
function salesOwnGstins(){
  const s = SL(), co = CO(s && s.cid) || {}, pan = salesPan(co), own = String(co.gstin || "").toUpperCase().trim();
  const others = (String(co.otherGstins || "").toUpperCase().match(/\b\d{2}[A-Z0-9]{13}\b/g) || []).concat(co.gstins || []).map(g => String(g || "").toUpperCase().trim());
  // (the client's own GSTIN as set up is always its own, whatever its check digit: round 3 of the review; the other
  // GSTINs only when real GSTINs of the client's own PAN: a mistyped one, or another's, is no registration of the client)
  return Array.from(new Set((/^\d{2}[A-Z0-9]{13}$/.test(own) && GST_STATES[own.slice(0, 2)] ? [own] : []).concat(others.filter(g => g !== own && salesGstinOfPan(g, pan)))));
}
function salesPan(co){ return String((co && (co.pan || String(co.gstin || "").slice(2, 12))) || "").toUpperCase().trim(); }
function salesGstinOfPan(g, pan){ return /^\d{2}[A-Z0-9]{13}$/.test(g) && (typeof gstinValid !== "function" || gstinValid(g)) && pan.length === 10 && g.slice(2, 12) === pan && !!GST_STATES[g.slice(0, 2)]; }
function salesOwnStates(){ return Array.from(new Set(salesOwnGstins().map(stateOfGstin).filter(c => GST_STATES[c]))); }
// one of the client's own GSTINs: exactly its GSTIN, or one of its Other GSTINs (re-review round 3: the same PAN alone
// is never enough; an invoice from a registration not set up says "the seller GSTIN … is not the client's")
function salesIsOwn(g){
  g = String(g || "").toUpperCase().trim();
  return !!g && salesOwnGstins().includes(g);
}
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
  // (the invoice's own GSTIN only when it is the client's: same PAN; another's is said as a problem, never used)
  if (salesIsOwn(g) && GST_STATES[stateOfGstin(g)]) return {code: stateOfGstin(g), gstin: g, why: "the invoice’s own GSTIN"};
  const states = salesOwnStates();
  if (states.length === 1) return {code: states[0], gstin: own.find(z => stateOfGstin(z) === states[0]) || "", why: "the client’s GSTIN"};
  if (states.length > 1){
    // (a branch or series seen with two states tells nothing: "*")
    const by = (s && s.cfg.regBy) || {};
    for (const k of salesSeriesKeys(x)) if (by[k] && by[k] !== "*" && states.includes(by[k])) return {code: by[k], gstin: own.find(z => stateOfGstin(z) === by[k]) || "", why: (k[0] === "b" ? "branch " + x.branch : "series " + k.slice(2)) + " is issued from it"};
  }
  return {code: "", gstin: "", why: "", several: states.length > 1};
}
// an invoice with its own GSTIN teaches its branch and series (for the invoices of that branch with none); a key seen
// with two states is marked "*" for good: unknown
function salesLearnReg(v){
  const s = SL(), g = String(v.x.sellerGstin || "").toUpperCase(), c = stateOfGstin(g);
  if (!s || !c || !salesIsOwn(g) || salesOwnStates().length < 2 || !salesOwnStates().includes(c)) return;
  const by = s.cfg.regBy = s.cfg.regBy || {};
  let changed = false;
  salesSeriesKeys(v.x).forEach(k => { const to = !by[k] || by[k] === c ? c : "*"; if (by[k] !== to){ by[k] = to; changed = true; } });
  if (changed && !s.regSaving){ s.regSaving = true; setTimeout(() => { s.regSaving = false; if (SL() === s) saveSales({cfg: true}); }, 0); }
}
// a person's one-click choice of the output GST ledger (the bar's or a row's). With ck (the state known, or one
// registration): kept for the client (and that state), and every invoice of the client still waiting takes it at once.
// Without (several registrations, the state not known: review of 2f8b825a7): that invoice only (id), kept on it.
// Posted invoices are not touched, nor a customer ledger a person set (mapInvoice keeps it)
function salesPickTax(ck, ledger, id, ik){
  const s = SL(), l = exactLedger(ledger);
  if (!s || !l) return 0;
  const waiting = s.list.filter(v => ["review", "ready"].includes(v.status));
  let n = 0, kind = "";
  if (!ck){
    const v = waiting.find(o => o.id === id), a = v && (v.taxAsk || []).find(a => !a.ck && a.ik === ik && a.cands.includes(l));
    if (!a) return 0;
    v.taxPick = Object.assign({}, v.taxPick, {[ik]: l}); kind = a.kind; mapInvoice(v); n = 1;
    saveSales();
  } else {
    const a = waiting.map(v => (v.taxAsk || []).find(a => a.ck === ck && a.cands.includes(l))).find(Boolean);
    if (!a) return 0;
    kind = a.kind;
    s.cfg.taxPick = Object.assign({}, s.cfg.taxPick, {[ck]: l});
    waiting.forEach(v => { const had = (v.taxAsk || []).some(a => a.ck === ck); mapInvoice(v); if (had && !(v.taxAsk || []).some(a => a.ck === ck)) n++; });
    saveSales({cfg: true});
  }
  if (typeof toast === "function") toast(l + " set as the output " + String(kind).toUpperCase() + " ledger: " + n + " invoice" + (n === 1 ? "" : "s") + " updated.");
  if (typeof render === "function") render();
  return n;
}
// {ledger, why, cands, ck, ik, reg}: cands when a person must choose; ck the client's choice key (none when the state
// is not known with several registrations: then ik, the invoice's own). Re-review of aec7142b3: a client with one
// registration is picked as before 2f8b825a7 (by "%" rates, the one plain ledger, the one ledger), never a ledger of
// another rate; all the state rules are for a client with several registrations, and there nothing is posted by itself
// unless FinCom is sure: the state not known is always asked
function taxLedgerPick(kind, rate, v){
  const cfg = SL().cfg, L = cfg.ledgers || {}, K0 = kind.toUpperCase();
  const half = kind === "igst" || kind === "cess" ? rate : rate / 2;
  const multi = salesOwnStates().length > 1;
  const setL = [kind + "_" + rateTag(half), kind].map(k => exactLedger(L[k])).find(Boolean);
  if (setL && !multi) return {ledger: setL, why: "set in Sales settings"};
  const K = {cgst: /c\.?\s*gst|central\s*(gst|tax)/i, sgst: /s\.?\s*gst|state\s*(gst|tax)|utgst/i, igst: /i\.?\s*gst|integrated/i, cess: /cess/i, }[kind];
  const taxes = ledgersIn(/duties|taxes/i).filter(l => K.test(l.name) && !/input|itc|credit|receivable|rcm|reverse/i.test(l.name) && !(kind === "sgst" && /cgst|igst/i.test(l.name)));
  const out = taxes.filter(l => /output|payable|liab/i.test(l.name));
  const pool = out.length ? out : taxes;
  const info = new Map(pool.map(l => [l.name, ledgerRateInfo(l.name)]));
  const ik = kind + "_" + rateTag(half);
  // (a ledger of another rate is never a candidate: its rate read with "%", or bare at the end of its name)
  const rightRate = l => { const r = info.get(l.name).rates; return !r.length || r.includes(+half); };
  if (!multi){
    const rateHit = pool.filter(l => new RegExp("(^|[^0-9.])" + rateTag(half).replace(".", "\\.") + "\\s*%").test(l.name));
    if (rateHit.length === 1) return {ledger: rateHit[0].name, why: "the output " + K0 + " ledger for " + rateTag(half) + "%"};
    const plain = pool.filter(l => !/\d\s*%/.test(l.name));
    if (plain.length === 1) return {ledger: plain[0].name, why: "the only output " + K0 + " ledger without a rate"};
    if (pool.length === 1 && !/\d\s*%/.test(pool[0].name)) return {ledger: pool[0].name, why: "the only output " + K0 + " ledger"};
    const cands = (rateHit.length ? rateHit : pool).filter(rightRate);
    const chosen = exactLedger((cfg.taxPick || {})[ik]);
    if (chosen && cands.some(l => l.name === chosen)) return {ledger: chosen, why: "chosen by you (Sales: " + K0 + " ledger at " + rateTag(half) + "%)"};
    return cands.length ? {ledger: "", why: "", cands: cands.map(l => l.name), ck: ik, ik, reg: ""} : {ledger: "", why: ""};
  }
  const rateHit = pool.filter(l => info.get(l.name).rates.includes(+half));
  const cand = rateHit.length ? rateHit : pool.filter(l => !info.get(l.name).rates.length);
  const reg = v ? salesRegOf(v) : {code: ""};
  if (!reg.code){
    // several registrations, which one not known: asked on the invoice, every time (nothing kept for the client); the
    // Sales settings ledger among the choices (re-review round 3)
    const names = cand.map(l => l.name).concat(setL && !cand.some(l => l.name === setL) ? [setL] : []);
    if (!names.length) return {ledger: "", why: ""};
    const mine = exactLedger(((v && v.taxPick) || {})[ik]);
    if (mine && names.includes(mine)) return {ledger: mine, why: "chosen by you on this invoice"};
    return {ledger: "", why: "", cands: names, ck: "", ik, reg: "", unknown: true};
  }
  // (no output ledger of this kind but the one set in Sales settings: it, as before, unless tagged for another state)
  if (!cand.length){ const st = setL ? ledgerStateTag(exactLedgerObj(setL)) : ""; return setL && (!st || st === reg.code) ? {ledger: setL, why: "set in Sales settings"} : {ledger: "", why: ""}; }
  const ck = ik + "@" + reg.code, sw = gstStateWords(reg.code);
  const tagged = cand.map(l => ({l, st: ledgerStateTag(l), doubt: info.get(l.name).doubt}));
  const mineOrOk = tagged.filter(t => !t.st || t.st === reg.code);
  const ask = (list) => list.length ? {ledger: "", why: "", cands: list.map(t => t.l.name), ck, ik, reg: reg.code} : {ledger: "", why: ""};
  // the person's choice for this state, then the state's own ledger, then Sales settings, then the one untagged ledger
  const chosen = exactLedger((cfg.taxPick || {})[ck]);
  if (chosen && mineOrOk.some(t => t.l.name === chosen)) return {ledger: chosen, why: "chosen by you for " + sw + " (Sales: " + K0 + " ledger at " + rateTag(half) + "%)"};
  const hit = tagged.filter(t => t.st === reg.code);
  if (hit.length === 1 && !hit[0].doubt) return {ledger: hit[0].l.name, why: "picked by state " + sw + " (" + reg.why + ")"};
  if (hit.length) return ask(hit);
  if (setL){ const st = ledgerStateTag(exactLedgerObj(setL)); if (!st || st === reg.code) return {ledger: setL, why: "set in Sales settings (none tagged " + sw + ")"}; }
  const untagged = tagged.filter(t => !t.st);
  if (untagged.length === 1 && !untagged[0].doubt) return {ledger: untagged[0].l.name, why: "the only output " + K0 + " ledger not tagged by a state (none tagged " + sw + ")"};
  return ask(mineOrOk);
}
// a Tally ledger's own record (its GSTIN, for its state)
function exactLedgerObj(name){ const b = B(); return ((b && b.ledgers.list) || []).find(l => l.name === name) || {name}; }
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
    items.forEach(it => { const r = num(it.gstRate); const g = groups.get(r) || {rate: r, taxable: 0}; g.taxable = r2(g.taxable + num(it.taxable));
      // (an item line that carries its own tax, a sheet's rows at that rate: its figures as given, never worked out again)
      if (it.tax != null && it.tax !== ""){ g.own = true; ["igst", "cgst", "sgst"].forEach(k => { g[k] = r2(num(g[k]) + num(it[k])); }); }
      groups.set(r, g); });
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
      if (g.own){ ["cgst", "sgst", "igst"].forEach(k => { if (num(g[k])) taxParts.push({kind: k, rate: g.rate, amt: r2(num(g[k]))}); }); return; }
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
  const pickTo = (e, pk) => { if (pk.why) e.why = pk.why; if (pk.cands){ e.cands = pk.cands; e.ck = pk.ck; e.ik = pk.ik; e.reg = pk.reg; e.unknown = pk.unknown; } return e; };
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
  const inter = isInterState(x, co), home = salesRegOf(v).code || stateOfGstin(co.gstin), pos = x.pos || stateOfGstin(x.customerGstin);
  // next-fix-sales-upload (item 1): the place of supply named, and where it came from (the party's Tally ledger when the
  // sheet gave none); an IGST invoice whose party's state is not known is held, never posted as a sale to a consumer
  const from = v.filled && v.filled.pos && v.filled.pos === x.pos ? " (the party\u2019s state in its Tally ledger)" : "";
  const stName = c => GST_STATES[c] || c;
  if (gst > 0 && inter && !num(x.igst)) p.push("CGST + SGST are charged, but the place of supply is " + stName(pos) + from + ", another state than " + stName(home) + ", so IGST is expected");
  if (gst > 0 && !inter && num(x.igst) && pos) p.push("IGST is charged, but the place of supply is " + stName(pos) + from + ", the state " + co.name + " issues it from, so CGST + SGST are expected");
  // (asked once the customer ledger is set: with none, the ledger is what it waits for, and Tally's master gives the state)
  if (num(x.igst) > 0 && !pos && v.customerLedger) p.push("IGST is charged, but the party\u2019s state is not known (no GSTIN or state on the sheet or in its Tally ledger): set the customer\u2019s GSTIN or the place of supply");
  // (the owner, 16-Nov-2026) the same number and type already in Tally, or posted from FinCom: never posted again
  // without a person's "Post duplicate anyway", confirmed twice
  const dupOf = salesDupOf(v);
  if (dupOf) p.push(salesDupWords(dupOf));
  if (v.needsCheck) p.push("Not confirmed: check Tally before posting again");
  if (v.refused) p.push("Refused by Tally" + (v.refused.single ? " (sent on its own)" : "") + ": " + (v.refused.hint || v.refused.said || "Tally created nothing"));
  if (Math.abs(num(x.cgst) - num(x.sgst)) > 0.05) p.push("CGST and SGST differ");
  if (salesTotals(x).some(g => g.mixed)) p.push("GST is not at one standard rate (several rates?): use Enter items");
  if (x.sellerGstin && co.gstin && !salesIsOwn(x.sellerGstin, co)) p.push("the seller GSTIN on the invoice is not " + co.name + "\u2019s");
  const dup = SL().list.find(o => o.id !== v.id && o.status !== "ignored" && normInvNo(o.x.number) === normInvNo(x.number) && o.x.date && x.date && fyLabel(o.x.date) === fyLabel(x.date));
  if (x.number && dup && !(dupOf && dupOf.src === "fincom")) p.push("invoice " + x.number + " already exists");
  return p;
}
// the voucher of this number and type already in Tally (the duplicate check's v.dupBlock) or posted from FinCom (another
// invoice of the number, its type and year, posted or found in Tally): {src, type, number, date, amount}, or null when
// there is none or a person pressed "Post duplicate anyway" for this number
function salesDupOf(v){
  if (!v || !["review", "ready"].includes(v.status)) return null;
  const no = normInvNo(v.x.number); if (!no || (v.dupOverride && v.dupOverride.no === no)) return null;
  if (v.dupBlock) return Object.assign({src: "tally"}, v.dupBlock);
  const vt = String(salesVt(v.x)).toLowerCase();
  const o = (SL().list || []).find(o => o.id !== v.id && ["posted", "intally"].includes(o.status) && normInvNo(o.x.number) === no && String(salesVt(o.x)).toLowerCase() === vt && o.x.date && v.x.date && fyLabel(o.x.date) === fyLabel(v.x.date));
  return o ? {src: "fincom", type: salesVt(o.x), number: o.x.number, date: o.x.date, amount: r2(Math.abs(num(o.x.total))), id: o.id} : null;
}
function salesDupWords(d){
  const dt = String(d.date || ""), iso = /^\d{8}$/.test(dt) ? dt.slice(0, 4) + "-" + dt.slice(4, 6) + "-" + dt.slice(6) : dt;
  return "Already in Tally as " + [d.type || "Sales", d.number].filter(Boolean).join(" ") + (iso ? " dated " + fmtDate(iso) : "") + ", " + money0(num(d.amount)) + ". Post again anyway?";
}
// next-fix-sales-upload (the owner, 16-Nov-2026): the client's own sales voucher type, from the vouchers FinCom already
// reads (the client's books): the Sales-class type most used, the default for uploads, shown as "(from your Tally)"; a
// type a person typed in Sales settings stands (cfg.vtBy "you"), and when the books use more than one in real use the
// person is asked once (cfg.vtBy "asked")
function salesBooksVts(){
  const s = SL(), bk = S.books && s && S.books.cid === s.cid ? S.books : null; if (!bk) return [];
  const n = new Map(), never = /note|return|order|quotation|delivery|memo|journal|receipt|payment|contra/i;
  (bk.vouchers || []).forEach(v => { const t = String(v.type || "").trim(); if (!t || v.opt || v.cancel || never.test(t) || !/\bsales\b/i.test(t)) return; n.set(t, (n.get(t) || 0) + 1); });
  const all = Array.from(n.entries()).sort((a, b) => b[1] - a[1]), tot = all.reduce((a, x) => a + x[1], 0);
  // (in real use: at least 3 vouchers and a twentieth of the client's sales)
  return all.filter(([, c]) => c >= 3 && c >= tot * 0.05).map(([type, count]) => ({type, count}));
}
function salesLearnVt(){
  const s = SL(); if (!s || !s.cfg) return;
  const c = s.cfg; if (c.vtBy === "you" || c.vtBy === "asked") { s.vtAsk = null; return; }
  const t = salesBooksVts(); if (!t.length){ s.vtAsk = null; return; }
  const was = c.voucherType;
  c.voucherType = t[0].type; c.vtFrom = "books";
  s.vtAsk = t.length > 1 ? t : null;
  if (was !== c.voucherType) saveSales({cfg: true});
}
// the person's answer when the books use several sales types: kept for the client
function salesVtAnswer(t){ const s = SL(); if (!s || !t) return; s.cfg.voucherType = t; s.cfg.vtBy = "asked"; s.cfg.vtFrom = "books"; s.vtAsk = null; saveSales({cfg: true}); s.list.forEach(v => mapInvoice(v)); render(); }
function normInvNo(s){ return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, ""); }
function ledgerProblems(v, lines){
  const p = [];
  (lines || salesLines(v)).forEach(l => { if (!l.ledger) p.push({party: "customer ledger", sales: "sales ledger for " + rateTag(l.rate) + "%", tax: (l.kind || "tax").toUpperCase() + " output ledger", roundoff: "round-off ledger"}[l.role] + " not set" + (l.cands ? ": " + l.cands.length + " fit" + (l.reg ? " for " + gstStateWords(l.reg) : "") + (l.unknown ? " (which of the client\u2019s registrations it is from is not known)" : "") + ", choose one" : "")); else if (!exactLedger(l.ledger)) p.push("\u201c" + l.ledger + "\u201d is not a Tally ledger"); });
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
  v.taxAsk = lines ? lines.filter(l => l.role === "tax" && !l.ledger && l.cands).map(l => ({kind: l.kind, ck: l.ck, ik: l.ik, reg: l.reg || "", unknown: !!l.unknown, cands: l.cands})) : [];
  // (an invoice a person said is not the Tally entry it was matched to waits for a person to set its ledger)
  const sure = v.problems.length === 0 && v.ledgerIssues.length === 0 && (v.custSure || v.userLedger || v.source === "created") && !(v.notTally && !v.userLedger);
  if (v.status !== "ready" || v.problems.length || v.ledgerIssues.length) v.status = sure && SL().cfg.auto !== false ? "ready" : "review";
}
// next-fix-sales-upload (item 1): a party's GSTIN and state as its Tally ledger master has them (the ledger list read
// from Tally, else the client's books): {gstin, state (the 2-digit code), stateName}, or null when Tally has no such ledger
function partyMaster(ledger){
  const name = exactLedger(ledger); if (!name) return null;
  const b = B(), l = ((b && b.ledgers && b.ledgers.list) || []).find(x => x.name === name) || {};
  const bk = S.books && (!S.books.cid || S.books.cid === SL().cid) ? S.books : null;
  const g = String(l.gstin || (bk && ((bk.gstins || {})[name] || ((bk.ledInfo || {})[name] || {}).gstin)) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const gstin = GSTIN_RE.test(g) ? g : "", stateName = String(l.state || l.stateName || (bk && (bk.states || {})[name]) || "").trim();
  return {gstin, state: stateOfGstin(gstin) || stateCodeFrom(stateName), stateName};
}
// an invoice from a sheet that gave no GSTIN (or no place of supply): the party's, from its Tally ledger master, so a
// B2B sale is never reported as one to a consumer; the place of supply is the party's state. What a person typed stands;
// what was filled so follows the customer ledger a person sets (v.filled: what was filled, and from which ledger)
function salesPartyFill(v){
  // (only an invoice uploaded from a sheet since this rule, when it is added and when a person sets its customer ledger:
  // never one uploaded before, nor a B2CS / B2CL or unregistered row, which carry no v.sheetHad; never on a reload)
  const x = v.x, h = v.sheetHad; if (!h || ["posted", "intally", "ignored"].includes(v.status)) return;
  const f = v.filled || {}, m = v.customerLedger ? partyMaster(v.customerLedger) : null;
  const ours = k => !x[k] || (f[k] && x[k] === f[k]);
  const out = {ledger: v.customerLedger || ""};
  if (!h.gstin && ours("customerGstin")){ x.customerGstin = (m && m.gstin) || ""; if (x.customerGstin) out.customerGstin = x.customerGstin; }
  if (!h.pos && (!x.pos || (f.pos && x.pos === f.pos))){ x.pos = stateOfGstin(x.customerGstin) || (m && m.state) || ""; if (x.pos) out.pos = x.pos; }
  if (out.customerGstin || out.pos) v.filled = out; else delete v.filled;
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
  // (the client's own state only for an invoice of CGST + SGST: an IGST invoice with no place of supply is held, item 1)
  // (review of 44e4c1e97: as 5d3611f5c for a client of one registration; one of several takes the state of the
  // registration the invoice is issued from. An IGST invoice with no place of supply is held, invoiceProblems)
  const pos = x.pos || stateOfGstin(x.customerGstin) || (salesOwnStates().length > 1 && salesRegOf(v).code) || stateOfGstin(co.gstin);
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
