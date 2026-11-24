/* ================================================================== */
/* Sales: read sales invoices, create invoices, post Sales vouchers    */
/* ================================================================== */
const GST_STATES = {"01":"Jammu and Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan",
  "09":"Uttar Pradesh","10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam",
  "19":"West Bengal","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat","26":"Dadra and Nagar Haveli and Daman and Diu","27":"Maharashtra",
  "29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu","34":"Puducherry","35":"Andaman and Nicobar Islands","36":"Telangana","37":"Andhra Pradesh",
  "38":"Ladakh","97":"Other Territory","96":"Other Country"};
const SALES_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];
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
  salesCfgTook(S.sales);
  // next-fix-sales-sync: with the ledger list here, every invoice waiting is mapped again on this computer
  const remapped = typeof salesRemapWaiting === "function" && salesRemapWaiting();
  // invoices filed from elsewhere are matched now
  // (next-fix-sales-hang: with the invoices listed by number once, salesByNo in src/js/26-sales-invoice.js, when it is in)
  (window.salesByNo || (f => f()))(() => {
  const pend = S.sales.list.filter(v => v.needsMap);
  if (pend.length){ pend.forEach(v => { v.needsMap = false; mapInvoice(v); }); saveSales(); }
  // (item 6: the problems kept with an invoice waiting are worked out again on opening, so a label left from an earlier
  // state, "customer GSTIN is not valid" on a GSTIN since cleared, never stays)
  if (!remapped) S.sales.list.forEach(v => { if (["review", "ready"].includes(v.status) && !v.needsMap){ const was = JSON.stringify(v.problems || []); v.problems = salesProblemsNow(v); if (was !== JSON.stringify(v.problems)) mapInvoice(v); } });
  });
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
  salesSaveTimer = setTimeout(() => { salesSaveTimer = null; BankDB.set("sales:" + cid, list.map(salesSynced)); }, 500);
  if (what && what.cfg && !(typeof Drafts === "object" && Drafts.hold("salescfg:" + cid))){ salesCfgStamp(s); salesCfgWrite(s); }
  if (what && what.hist) BankDB.set("saleshist:" + cid, s.hist);
}
/* ---------- next-fix-sales-sync (16-Nov-2026): Sales settings merged key by key ---------- */
// The settings went to the cloud as one whole object, and the last computer to save won: one with empty ledger settings
// wiped the ledgers set on another. Now each setting, and each entry of the maps (the ledgers, the GST ledgers chosen,
// the branches' registrations, the items, "not this Tally entry"), carries when it was last changed here (cfgAt, kept in
// this browser as cfg._at and sent beside cfg): the newer one wins; with neither newer, an empty or missing value never
// wipes one that is set. Merged when a copy comes from the cloud (cloudApplySales, src/js/27) and when saving here
const SALES_CFG_MAPS = ["ledgers", "items", "taxPick", "regBy", "notTally"];
const salesCfgObj = x => !!x && typeof x === "object" && !Array.isArray(x);
function salesCfgUnits(cfg){
  const o = {};
  Object.keys(cfg || {}).forEach(k => { if (k === "_at") return; const v = cfg[k];
    if (SALES_CFG_MAPS.includes(k) && salesCfgObj(v)) Object.keys(v).forEach(e => { o[k + "/" + e] = JSON.stringify(v[e]); }); else o[k] = JSON.stringify(v); });
  return o;
}
// the settings as read from this browser: their times apart (s.cfgAt), and what they were (s.cfgSaved), to see what changes
function salesCfgTook(s){ const at = s.cfg._at; delete s.cfg._at; s.cfgAt = salesCfgObj(at) ? at : {}; s.cfgSaved = salesCfgUnits(s.cfg); }
function salesCfgStamp(s){
  const now = new Date().toISOString(), u = salesCfgUnits(s.cfg), was = s.cfgSaved || {};
  s.cfgAt = s.cfgAt || {};
  new Set(Object.keys(u).concat(Object.keys(was))).forEach(k => { if (u[k] !== was[k]) s.cfgAt[k] = now; });
  s.cfgSaved = u;
}
// a (what is kept here, with a._at) and b (the other copy, with bAt): one settings object, with _at. A time more than 5
// minutes ahead (a computer's clock) counts as now; with neither newer, a value set beats the default (or an empty
// one), else b; the series' next number is the higher of the two
function salesCfgMerge(a, b, bAt){
  a = salesCfgObj(a) ? a : {}; b = salesCfgObj(b) ? b : {};
  const now = new Date().toISOString(), soon = new Date(Date.now() + 300000).toISOString();
  const times = o => { const t = {}; if (salesCfgObj(o)) Object.keys(o).forEach(k => { t[k] = String(o[k] || "") > soon ? now : String(o[k] || ""); }); return t; };
  const aAt = times(a._at); bAt = times(salesCfgObj(bAt) ? bAt : b._at);
  const dflt = (k, x) => x == null || x === "" || (typeof x === "object" && !Object.keys(x).length) || (!k.includes("/") && JSON.stringify(x) === JSON.stringify(SALES_CFG_DEFAULT[k]));
  const out = {}, at = Object.assign({}, aAt);
  const take = (k, x, y) => { const ta = aAt[k] || "", tb = bAt[k] || "", w = tb > ta || (tb === ta && !(dflt(k, y) && !dflt(k, x))); if (w && tb) at[k] = tb; return w ? y : x; };
  new Set(Object.keys(a).concat(Object.keys(b))).forEach(k => {
    if (k === "_at") return;
    if (SALES_CFG_MAPS.includes(k) && (salesCfgObj(a[k]) || salesCfgObj(b[k])) && (a[k] == null || salesCfgObj(a[k])) && (b[k] == null || salesCfgObj(b[k]))){
      const x = a[k] || {}, y = b[k] || {}, m = {};
      new Set(Object.keys(x).concat(Object.keys(y))).forEach(e => { const v = take(k + "/" + e, x[e], y[e]); if (v !== undefined) m[e] = v; });
      out[k] = m;
    } else if (k === "next"){ const ta = aAt[k] || "", tb = bAt[k] || ""; out[k] = ta === tb ? Math.max(num(a[k]) || 1, num(b[k]) || 1) : take(k, a[k], b[k]); }
    else { const v = take(k, a[k], b[k]); if (v !== undefined) out[k] = v; }
  });
  out._at = at;
  return out;
}
// saved in this browser merged with what is kept there (a copy from another computer may have come in since): what
// that copy has and is not changed here comes into the settings on screen
let salesCfgQ = Promise.resolve();
function salesCfgWrite(s){
  const cid = s.cid;
  salesCfgQ = salesCfgQ.then(async () => {
    const m = salesCfgMerge(await BankDB.get("salescfg:" + cid), s.cfg, s.cfgAt);
    let took = false;
    new Set(Object.keys(m).concat(Object.keys(s.cfg))).forEach(k => { if (k === "_at") return;
      if (!(k in m)){ delete s.cfg[k]; took = true; } else if (JSON.stringify(m[k]) !== JSON.stringify(s.cfg[k])){ s.cfg[k] = m[k]; took = true; } });
    s.cfgAt = Object.assign({}, m._at); s.cfgSaved = salesCfgUnits(s.cfg);
    await BankDB.set("salescfg:" + cid, Object.assign({}, s.cfg, {_at: s.cfgAt}));
    if (took && SL() === s && typeof render === "function") render();
  }).catch(() => {});
  return salesCfgQ;
}
/* ---------- next-fix-sales-sync: the invoices waiting, looked at again on this computer ---------- */
// (16-Nov-2026: one computer said Ready, the other To review, for the same invoices) an invoice's status is saved on it
// by the computer that last mapped it. Once the ledger list the customer match reads is here, every invoice waiting is
// looked at again here: only a blank ledger is filled; a ledger set on it (by a person, a confirm or an earlier pick)
// is never replaced, so what is posted does not change; its problems and status are worked out again (a "Moved back
// to review" stays). That is this computer's view only: never saved, never sent (salesSynced gives the copy as it
// was), unless a blank was filled, which is sent once. Again when another list comes in (ledgersChanged, src/js/24).
// (salesRemapWaiting: src/js/26-sales-invoice.js, with the Sales screen; looked at once that file is in)
// Each invoice's duplicate checks look only at the invoices of its own number (salesOfNo), the debtors listed once
let salesNoIdx = null;
function salesOfNo(no){ return salesNoIdx ? salesNoIdx.get(normInvNo(no)) || [] : SL().list; }
// the invoice as it is to be kept and sent: as it was before it was looked at again, while nothing else changed it
function salesSynced(v){ const k = v.__vw; return k && JSON.stringify(v) === k.after ? JSON.parse(k.before) : v; }
window.addEventListener("pagehide", () => { if (salesSaveTimer && S.sales){ clearTimeout(salesSaveTimer); BankDB.set("sales:" + S.sales.cid, S.sales.list.map(salesSynced)); } });
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
  // (next-fix-pagespeed: looked for once per list, kept with its sales ledgers: 20,000 ledgers each invoice)
  const m = ledInKept.m, named = "n" in m ? m.n : (m.n = (B().ledgers.list || []).find(l => /^sales(\s*(a\/c|account))?$/i.test(l.name)));
  return named ? named.name : "";
}
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
    // next-fix-sales-sync (16-Nov-2026: a state-09 client's CGST taken as "OUTPUT CGST @9% (DL)", by its rate alone): a
    // ledger clearly tagged for another state than the client's own GSTIN's (ledgerClearTag) is never picked by itself,
    // only offered when nothing else fits; with no ledger so tagged, all as before. A person's choice comes first
    const home = salesOwnStates()[0] || "", away = l => { const st = home ? ledgerClearTag(l.name) : ""; return !!st && st !== home; };
    const far = pool.filter(away), ours = far.length ? pool.filter(l => !away(l)) : pool;
    const hitOf = list => list.filter(l => new RegExp("(^|[^0-9.])" + rateTag(half).replace(".", "\\.") + "\\s*%").test(l.name));
    const rateHit = hitOf(ours), chosen = exactLedger((cfg.taxPick || {})[ik]);
    if (chosen && pool.some(l => l.name === chosen && rightRate(l))) return {ledger: chosen, why: "chosen by you (Sales: " + K0 + " ledger at " + rateTag(half) + "%)"};
    if (rateHit.length === 1) return {ledger: rateHit[0].name, why: "the output " + K0 + " ledger for " + rateTag(half) + "%"};
    const plain = ours.filter(l => !/\d\s*%/.test(l.name));
    if (plain.length === 1) return {ledger: plain[0].name, why: "the only output " + K0 + " ledger without a rate"};
    if (ours.length === 1 && !/\d\s*%/.test(ours[0].name)) return {ledger: ours[0].name, why: "the only output " + K0 + " ledger"};
    let cands = (rateHit.length ? rateHit : ours).filter(rightRate);
    if (!cands.length && far.length){ const fh = hitOf(far); cands = (fh.length ? fh : far).filter(rightRate); }
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
// the state a ledger's name says clearly (next-fix-sales-sync): in brackets ("(DL)", "(Delhi)", "(07)") or its full name
// after a separator ("- Delhi"); never a bare word ("DN", "KA"), nor in brackets an abbreviation that is also an
// accounting word ("(DN)", "(CN)", "(JV)": only the state's name or code there)
function ledgerClearTag(name){
  const n = String(name || ""), low = t => " " + t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const byName = t => (Object.entries(GST_STATES).find(([c, st]) => +c < 90 && [st].concat(GST_STATE_ALIAS[c] || []).some(x => low(x) === low(t))) || [""])[0];
  for (const m of n.matchAll(/\(\s*([^()]*?)\s*\)/g)){
    const t = m[1], c = /^\d{2}$/.test(t) ? (GST_STATES[t] && +t < 90 && !GST_RATE_NUMS.includes(+t) ? t : "") : (!/^(DN|CN|DD|PY|TS|JV|PV|RV|SB)$/i.test(t) && Object.entries(GST_ABBR).find(([, a]) => a.split(" ").includes(t.toUpperCase())) || [byName(t)])[0];
    if (c) return c;
  }
  const m = n.match(/[-\u2013\/|:]\s*([A-Za-z][A-Za-z &.]*?)\s*$/);
  return m ? byName(m[1]) : "";
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
  const debtors = Ledgers.memo("salesDebtors", () => (b.ledgers.list || []).filter(l => !BANK_GROUPS.test(l.group || "")));
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
// (next-fix-audit-sales-einv) a supply to an SEZ unit or developer (x.supply "SEZWP" with payment of IGST, "SEZWOP" under
// LUT): inter-state whatever the states, IGST Act s.7(5)(b)
function isInterState(x, co){ if (/^SEZ/.test(x.supply || "")) return true; const home = (SL() && salesRegOf({x}).code) || stateOfGstin(co.gstin); const pos = x.pos || stateOfGstin(x.customerGstin) || home; return !!(home && pos && home !== pos); }
function salesLines(v){
  const co = CO(SL().cid), x = v.x;
  const inter = num(x.igst) > 0 || (!num(x.cgst) && isInterState(x, co));
  const groups = salesTotals(x);
  const lines = [];
  const total = r2(num(x.total));
  // (by: "you" on a line whose ledger a person picked on the invoice or in bulk: kept, never worked out again)
  lines.push(Object.assign({side: "Dr", ledger: v.customerLedger || "", amt: total, role: "party"}, v.userLedger && v.custSource === "Set by you" ? {by: "you"} : {}));
  groups.forEach(g => lines.push(Object.assign({side: "Cr", ledger: v.salesLedgers && v.salesLedgers[g.rate] || salesLedgerFor(g.rate, inter), amt: g.taxable, role: "sales", rate: g.rate}, v.salesBy && v.salesBy[g.rate] ? {by: "you"} : {})));
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
  // (an output ledger a person picked for this invoice, by kind and GST rate, v.taxLedgers["igst_18"]: before any pick)
  const mine = k => exactLedger((v.taxLedgers || {})[k]);
  const pickOf = (kind, rate) => { const m = mine(salesTaxKey(kind, rate)); return m ? {ledger: m, why: "set by you", by: "you"} : taxLedgerPick(kind, rate, v); };
  taxParts.forEach(t => { if (!t.amt) return; const pk = pickOf(t.kind, t.rate), l = pk.ledger || ""; const k = l || t.kind + "?"; const e = byLedger.get(k) || pickTo({side: "Cr", ledger: l, amt: 0, role: "tax", kind: t.kind, keys: []}, pk); e.amt = r2(e.amt + t.amt); if (pk.by) e.by = "you"; if (!e.keys.includes(salesTaxKey(t.kind, t.rate))) e.keys.push(salesTaxKey(t.kind, t.rate)); byLedger.set(k, e); });
  byLedger.forEach(e => lines.push(e));
  if (num(x.cess)){ const pk = pickOf("cess", 0); lines.push(Object.assign(pickTo({side: "Cr", ledger: pk.ledger, amt: r2(num(x.cess)), role: "tax", kind: "cess", keys: [salesTaxKey("cess", 0)]}, pk), pk.by ? {by: "you"} : {})); }
  const cr = r2(lines.filter(l => l.side === "Cr").reduce((a, l) => a + l.amt, 0));
  const ro = r2(total - cr);
  if (Math.abs(ro) >= 0.01) lines.push({side: ro > 0 ? "Cr" : "Dr", ledger: roundOffLedger(), amt: Math.abs(ro), role: "roundoff"});
  return lines;
}
// the key of an output tax line a person sets on an invoice: its kind and the invoice's GST rate ("igst_18", "cess_0")
function salesTaxKey(kind, rate){ return kind + "_" + (kind === "cess" ? "0" : rateTag(num(rate))); }
// an invoice's problems with the items check (mapInvoice, and the check again on opening, so neither loses it)
function salesProblemsNow(v, lines){
  const p = invoiceProblems(v); if (lines === undefined) lines = hasLedgerList() ? salesLines(v) : null;
  // (next-fix-audit-sales-einv) the voucher's sales and GST lines are the invoice's own figures, and Round Off no more than a
  // rupee: items at their rates that do not add up to the invoice are held, never posted with the gap in Round Off
  if (lines){ const x = v.x, sum = r => r2(lines.filter(l => l.role === r).reduce((a, l) => a + l.amt, 0)), ro = sum("roundoff");
    if (Math.abs(sum("sales") - num(x.taxable)) > 1 || Math.abs(sum("tax") - num(x.cgst) - num(x.sgst) - num(x.igst) - num(x.cess)) > 1 || ro > 1)
      p.push("the items (taxable " + money(sum("sales")) + ", GST " + money(sum("tax")) + ") do not agree with the invoice\u2019s taxable value and GST" + (ro > 1 ? ": " + money(ro) + " would go to Round Off" : "") + ". Check the items");
  }
  return p;
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
  const sez = /^SEZ/.test(x.supply || "");
  // (next-fix-audit-sales-einv) a supply to an SEZ (IGST Act s.7(5)(b), zero-rated under s.16(1)(b)): IGST with payment,
  // none under LUT; held for Tally, since FinCom does not mark a voucher SEZ (Tally would report it as B2B, not SEZ)
  if (sez){
    if (num(x.cgst) || num(x.sgst)) p.push("a supply to an SEZ is inter-state (IGST Act s.7(5)(b)): IGST, not CGST + SGST");
    if (x.supply === "SEZWOP" && gst > 0) p.push("a supply to an SEZ under LUT carries no IGST");
    if (x.supply === "SEZWP" && !num(x.igst) && num(x.taxable) > 0) p.push("a supply to an SEZ with payment of IGST, but no IGST is charged");
    p.push("a supply to an SEZ: enter it in Tally by hand, with the party marked SEZ (FinCom does not yet mark the voucher SEZ)");
  }
  // (an IRN cancelled: the invoice is not a supply any more, never posted, CGST Rules r.48(4))
  if (x.irnStatus === "cancelled") p.push("its IRN is cancelled: this invoice is not a sale any more");
  if (gst > 0 && inter && !num(x.igst) && !sez) p.push("CGST + SGST are charged, but the place of supply is " + stName(pos) + from + ", another state than " + stName(home) + ", so IGST is expected");
  if (gst > 0 && !inter && num(x.igst) && pos) p.push("IGST is charged, but the place of supply is " + stName(pos) + from + ", the state " + co.name + " issues it from, so CGST + SGST are expected");
  // (asked once the customer ledger is set: with none, the ledger is what it waits for, and Tally's master gives the state)
  if (num(x.igst) > 0 && !pos && v.customerLedger) p.push("IGST is charged, but the party\u2019s state is not known (no GSTIN or state on the sheet or in its Tally ledger): set the customer\u2019s GSTIN or the place of supply");
  // (the owner, 23-Nov-2026, "it should flow", superseding 16-Nov-2026's "Post duplicate anyway"): no invoice is held for
  // a number already in Tally or posted from FinCom; the same entry is marked In Tally when posting (salesCheckSafe)
  if (v.needsCheck) p.push("Not confirmed: check Tally before posting again");
  // (the books use several sales voucher types: an invoice waits for the person's answer, none is applied before it)
  if (SL().vtAsk && !x.noteKind) p.push("Choose the voucher type");
  if (v.refused) p.push("Refused by Tally" + (v.refused.single ? " (sent on its own)" : "") + ": " + (v.refused.hint || v.refused.said || "Tally created nothing"));
  if (Math.abs(num(x.cgst) - num(x.sgst)) > 0.05) p.push("CGST and SGST differ");
  if (salesTotals(x).some(g => g.mixed)) p.push("GST is not at one standard rate (several rates?): use Enter items");
  if (x.sellerGstin && co.gstin && !salesIsOwn(x.sellerGstin, co)) p.push("the seller GSTIN on the invoice is not " + co.name + "\u2019s");
  // (two not yet posted of one number and year: one is a mistake; one already posted or In Tally holds nothing)
  const dup = salesOfNo(x.number).find(o => o.id !== v.id && !["ignored", "posted", "intally"].includes(o.status) && normInvNo(o.x.number) === normInvNo(x.number) && o.x.date && x.date && fyLabel(o.x.date) === fyLabel(x.date));
  if (x.number && dup) p.push("invoice " + x.number + " already exists");
  return p;
}
// the same entry (the owner, 23-Nov-2026: "it should flow"; 24-Nov-2026): the number, the financial year, the amount
// (to ₹1) and the customer. Both with a GSTIN: the same GSTIN, and any Sales-class voucher type (salesTypeClasses:
// "Sales" and "Sales UP" alike; never a note); either without one: the exact voucher type and the party ledger. a, b:
// {no (normInvNo), type, date (yyyy-mm-dd), amount, gstin, party, note, seller}; isInv: the Sales-class test
// (salesCheckTally's). A client with several registrations of its own, or the two issued from different GSTINs (the
// invoice's seller GSTIN, the Tally entry's company GSTIN): the exact type only, so two branches' invoice 12 are never
// one (review of 03ffa5eed). Neither with a GSTIN (a walk-in cash memo, the owner, 24-Nov-2026): also any two Sales-class
// vouchers of the same date, whatever the party or the type ("CM/1" a "Cash Memo" to "Cash" in Tally, a "Sales" to
// "Walk-in Customer" here). Anything less is another entry, and is posted
function salesSameEntry(a, b, isInv){
  const lc = s => String(s || "").trim().toLowerCase(), up = s => String(s || "").trim().toUpperCase();
  if (!a.no || a.no !== b.no || !a.date || !b.date || fyLabel(a.date) !== fyLabel(b.date) || Math.abs(r2(a.amount) - r2(b.amount)) > 1) return false;
  const same = !!lc(a.type) && lc(a.type) === lc(b.type), sale = () => { const cls = isInv || salesTypeClasses([].concat((SL() && SL().cfg || {}).voucherType || [])); return !a.note && !b.note && cls(a.type) && cls(b.type); };
  // (several registrations: only when both sellers are known and the same; one registration: unless they differ)
  const otherSeller = up(a.seller) && up(b.seller) ? up(a.seller) !== up(b.seller) : salesOwnGstins().length > 1;
  // (neither with a GSTIN: never issued from another GSTIN, nor a Tally voucher found by its reference, byRef; review of 69441fde7)
  if (!up(a.gstin) && !up(b.gstin) && !otherSeller && !a.byRef && !b.byRef && String(a.date).slice(0, 10) === String(b.date).slice(0, 10) && sale()) return true;
  if (!up(a.gstin) || !up(b.gstin)) return same && !!lc(a.party) && lc(a.party) === lc(b.party);
  if (up(a.gstin) !== up(b.gstin)) return false;
  if (same) return true;
  if (otherSeller) return false;
  return sale();
}
// (an invoice already In Tally: the type of the Tally entry it was matched to)
function salesEntryOf(v){ return {no: normInvNo(v.x.number), type: (v.status === "intally" && v.tallyMatch && v.tallyMatch.type) || salesVt(v.x), date: v.x.date, amount: Math.abs(num(v.x.total)), gstin: v.x.customerGstin, party: v.customerLedger, note: !!v.x.noteKind, seller: v.x.sellerGstin || ""}; }
// the entries a person said are not this invoice's (Not this Tally entry): on it, and kept for its number (cfg.notTally)
function salesNotOf(v){ return (v.notTally || []).concat(((SL().cfg || {}).notTally || {})[normInvNo(v.x.number)] || []); }
// (the owner's case, 24-Nov-2026: an Optional voucher deleted in Tally, the invoice uploaded again, was marked In Tally)
// a FinCom invoice really in the books: posted with Tally's own answer (never a file only), not as an Optional voucher, or
// found in Tally itself (not In Tally only because of another FinCom invoice, "fincom:")
function salesInBooks(o){ return !!o && !o.postedOptional && ((o.status === "posted" && o.postedVia !== "file") || (o.status === "intally" && !!o.tallyMatch && !/^fincom:/.test(o.tallyMatch.key || ""))); }
// the same entry posted from FinCom (salesSameEntry), posted or found in Tally: {src, type, number, date, amount, party,
// id}, or null; never one a person said is not it ("fincom:" + its id). Never a hold: salesCheckSafe marks it In Tally quietly
function salesDupOf(v){
  if (!v || !["review", "ready"].includes(v.status)) return null;
  const e = salesEntryOf(v); if (!e.no || !e.date) return null;
  const not = salesNotOf(v);
  const o = salesOfNo(v.x.number).find(o => o.id !== v.id && ["posted", "intally"].includes(o.status) && salesInBooks(o) && !not.includes("fincom:" + o.id) && !(o.tallyMatch && o.tallyMatch.key && not.includes(o.tallyMatch.key)) && salesSameEntry(e, salesEntryOf(o)));
  return o ? {src: "fincom", type: salesVt(o.x), number: o.x.number, date: o.x.date, amount: r2(Math.abs(num(o.x.total))), party: o.customerLedger || o.x.customerName || "", id: o.id} : null;
}
// a voucher type that is never a sale, by a word of its name (spaces, "_", "-", brackets between words): a credit or
// debit note (also "Cr Note", "Dr Note", CN, DN, a note alone), a Journal, a receipt, a payment, a contra, Rtn or Ret, a
// petty or an expense one ("Petty Cash Memo"); or by any part of it: a challan (the owner, 24-Nov-2026: "Delivery
// challan is not sales": "Sales Challan", "Challan Sales", "Sales Delivery Challan" never), a proforma, a self invoice
// (reverse charge, an inward supply), an inward, import, RCM, reverse-charge, supplier's, vendor's, "Pur"/"Purch",
// job-work-in, cancelled or "Performa" one (review of 69441fde7: "invoice" alone is not enough), a return
// ("SalesReturn", "Returnable"), a quotation or a memo ("Sales Memorandum": not in the books), but a cash memo is a sale
// (the owner, 24-Nov-2026: "Cash Memo", "Sales Cash Memo"; a sales word as "sales" is); a purchase first ("Purchase
// Cash Memo", "Purchase Invoice"), or anywhere with no "sales" ("Sales Purchase" is one); an order only with "sales" or
// "invoice" ("Inv") after it, or a home, door, online or free one with either ("Sales Order Invoice", "Sales Online
// Order"), never alone ("Sales Order"; "Sales Border" is no order); a delivery ("Delivery", "Deliveries", not
// "Delivered") only with a sales word ("Sales Delivery", "Door Delivery Sales"; never "Delivery Note", "Sales Delivery
// Challan"). "Credit" or "Debit" alone is a sale ("Credit Sales");
// salesBooksVts and salesTypeClasses use this one test (salesNotSale, with the client's own note types)
const SALES_NOT_SALE = /(?:^|[^a-z0-9])(?:(?:credit|debit|cr|dr)\.?[\s_-]*notes?|notes?|cn|dn|journals?|receipts?|payments?|rtn|ret|contra|petty|expenses?)(?=$|[^a-z0-9])|challan|pro[\s_-]*forma|self[\s_-]*invoice|return|quotation|memo|inward|\bimport(?:s|ed)?\b|rcm|reverse[\s_-]*charge|supplier|vendor|\bpur(?:ch)?\b|cancel|perfor?ma|job[\s_-]*work[\s_-]*in(?:ward)?\b/i;
// (a note type set the same as the client's sales type is no note: never a reason to post a sale again)
function salesNotSale(t){ const c = (SL() && SL().cfg) || {}, l = x => String(x || "").toLowerCase().trim(), n = l(t), m = n.replace(/cash[\s_-]*memo(?!r)/g, "cash sales");
  // (a sales word of the name itself: a cash memo is none, "Cash Memo Purchase", "Cash Memo Delivery" never a sale)
  const sw = /\bsales?\b/.test(n), iw = sw || /\binv(?:oice)?\b/.test(n);
  return SALES_NOT_SALE.test(m) || (/(?:^|[^a-z0-9])purchases?(?=$|[^a-z0-9])/.test(m) && (/^purchase/.test(m) || !sw))
    || (/(?:^|[^a-z]|sales|re)order/.test(m) && !(/order[\s\S]*(?:\bsales?\b|\binv(?:oice)?\b)/.test(m) || iw && /(?:home|door|online|free)[\s_-]*order/.test(m)))
    || (/deliver(?:y|ies)?\b/.test(m) && !iw) || (n !== l(c.voucherType || "Sales") && [c.creditNoteType, c.debitNoteType].some(x => !!n && l(x) === n)); }
// next-fix-sales-upload (the owner, 16-Nov-2026): the client's own sales voucher type, from the vouchers FinCom already
// reads (the client's books): the Sales-class type most used, the default for uploads, shown as "(from your Tally)"; a
// type a person typed in Sales settings stands (cfg.vtBy "you"), and when the books use more than one in real use the
// person is asked once (cfg.vtBy "asked")
function salesBooksVts(){
  const s = SL(), bk = S.books && s && S.books.cid === s.cid ? S.books : null; if (!bk) return [];
  const n = new Map();
  (bk.vouchers || []).forEach(v => { const t = String(v.type || "").trim(); if (!t || v.opt || v.cancel || salesNotSale(t) || !/\bsales\b|cash[\s_-]*memo/i.test(t)) return; n.set(t, (n.get(t) || 0) + 1); });
  const all = Array.from(n.entries()).sort((a, b) => b[1] - a[1]), tot = all.reduce((a, x) => a + x[1], 0);
  // (in real use: at least 3 vouchers and a twentieth of the client's sales)
  return all.filter(([, c]) => c >= 3 && c >= tot * 0.05).map(([type, count]) => ({type, count}));
}
function salesLearnVt(){
  const s = SL(); if (!s || !s.cfg) return;
  const c = s.cfg, was = !!s.vtAsk;
  // (review of d487be4c1) learnt only while the type is still the untouched default "Sales": a type ever set to anything
  // else (old settings with no vtBy too), typed by hand, answered or learnt before, is never replaced
  const untouched = !c.vtBy && !c.vtFrom && (!c.voucherType || String(c.voucherType).trim() === "Sales");
  s.vtAsk = null;
  if (untouched){
    const t = salesBooksVts();
    // several in real use: none applied until the person answers (the invoices wait, "Choose the voucher type")
    if (t.length > 1) s.vtAsk = t;
    else if (t.length === 1 && t[0].type !== "Sales"){
      c.voucherType = t[0].type; c.vtFrom = "books"; c.vtNotice = {to: t[0].type, at: new Date().toISOString()};
      saveSales({cfg: true});
    }
  }
  if (was !== !!s.vtAsk) (s.list || []).forEach(v => mapInvoice(v));
}
function normInvNo(s){ return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, ""); }
function ledgerProblems(v, lines){
  const p = [];
  (lines || salesLines(v)).forEach(l => { if (!l.ledger) p.push({party: "customer ledger", sales: "sales ledger for " + rateTag(l.rate) + "%", tax: (l.kind || "tax").toUpperCase() + " output ledger", roundoff: "round-off ledger"}[l.role] + " not set" + (l.cands ? ": " + l.cands.length + " fit" + (l.reg ? " for " + gstStateWords(l.reg) : "") + (l.unknown ? " (which of the client\u2019s registrations it is from is not known)" : "") + ", choose one" : "")); else if (!exactLedger(l.ledger)) p.push("\u201c" + l.ledger + "\u201d is not a Tally ledger"); });
  return p;
}
// work out ledgers and status for an invoice
// keep: a customer ledger set stays as it is (salesRemapWaiting); v.heldBack: moved back to review by a person, never
// made Ready by itself
function mapInvoice(v, keep){
  if (["posted", "intally", "ignored"].includes(v.status)) return;
  if (v.status === "ready") delete v.heldBack;
  if (!(keep && v.customerLedger) && (!v.userLedger || !exactLedger(v.customerLedger))){
    const c = hasLedgerList() ? customerLedgerFor(v) : {ledger: "", sure: false, label: ""};
    v.customerLedger = c.ledger; v.custSource = c.label; v.custSure = c.sure; v.userLedger = false;
  }
  salesLearnReg(v);
  const lines = hasLedgerList() ? salesLines(v) : null;
  v.problems = salesProblemsNow(v, lines);
  v.ledgerIssues = lines ? ledgerProblems(v, lines) : ["Tally ledger list not loaded"];
  // the output GST ledgers picked, with why (shown on the row), and the choices a person must make (next-fix-igst-pick)
  v.taxPicks = lines ? lines.filter(l => l.role === "tax" && l.ledger).map(l => ({kind: l.kind, ledger: l.ledger, why: l.why || ""})) : [];
  v.taxAsk = lines ? lines.filter(l => l.role === "tax" && !l.ledger && l.cands).map(l => ({kind: l.kind, ck: l.ck, ik: l.ik, reg: l.reg || "", unknown: !!l.unknown, cands: l.cands})) : [];
  // (an invoice a person said is not the Tally entry it was matched to waits for a person to set its ledger)
  const sure = v.problems.length === 0 && v.ledgerIssues.length === 0 && (v.custSure || v.userLedger || v.source === "created") && !(v.notTally && !v.userLedger);
  if (v.status !== "ready" || v.problems.length || v.ledgerIssues.length) v.status = sure && SL().cfg.auto !== false && !v.heldBack ? "ready" : "review";
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
  // (nor on an invoice with a live IRN: its party, GSTIN and place of supply are the IRN's)
  const x = v.x, h = v.sheetHad; if (!h || x.irnStatus === "active" || ["posted", "intally", "ignored"].includes(v.status)) return;
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
// (next-fix-audit-sales-einv) the invoice a credit note is against (x.againstInvoice), posted from FinCom or found in Tally:
// the note is set against that bill (Agst Ref), so the invoice is not left outstanding; else null (its own New Ref).
// Only the one invoice of that number to the same customer ledger, dated in the note's financial year on or before it:
// another party's bill is never taken (review of b4ff11b10). (The owner, 23-Nov-2026: s.34(2) CGST Act lets a note be
// issued up to 30 November of the next year.) With none of that number in the note's year, the one invoice of the
// customer ledger and number in any earlier year is taken; two or more there (a series that starts again each year),
// none, or one dated after the note: New Ref
function salesAgainstOf(v){ const x = v.x, ag = x.noteKind === "credit" && x.date && v.customerLedger && normInvNo(x.againstInvoice);
  const c = ag ? salesOfNo(x.againstInvoice).filter(o => o.id !== v.id && !o.x.noteKind && ["posted", "intally"].includes(o.status) && normInvNo(o.x.number) === ag && o.customerLedger === v.customerLedger && o.x.date && o.x.date <= x.date) : [];
  const same = c.length ? c.filter(o => fyLabel(o.x.date) === fyLabel(x.date)) : [], pick = same.length ? same : c;
  return pick.length === 1 ? pick[0] : null; }
function salesVoucherXml(v, co){
  const x = v.x, cn = x.noteKind === "credit";
  const vt = xesc(salesVt(x)), d = toTallyDate(x.date);
  // (the client's own state only for an invoice of CGST + SGST: an IGST invoice with no place of supply is held, item 1)
  // (review of 44e4c1e97: as 5d3611f5c for a client of one registration; one of several takes the state of the
  // registration the invoice is issued from. An IGST invoice with no place of supply is held, invoiceProblems)
  const pos = x.pos || stateOfGstin(x.customerGstin) || (salesOwnStates().length > 1 && salesRegOf(v).code) || stateOfGstin(co.gstin);
  const amt2 = n => r2(n).toFixed(2);
  const orig = salesAgainstOf(v);
  let s = '<VOUCHER VCHTYPE="' + vt + '" ACTION="Create" OBJVIEW="Accounting Voucher View">\n<DATE>' + d + "</DATE>\n<EFFECTIVEDATE>" + d + "</EFFECTIVEDATE>\n" +
    "<VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME>\n<VOUCHERNUMBER>" + xesc(x.number) + "</VOUCHERNUMBER>\n<REFERENCE>" + xesc(x.number) + "</REFERENCE>\n<REFERENCEDATE>" + d + "</REFERENCEDATE>\n" +
    "<PARTYLEDGERNAME>" + xesc(tallyLedgerName(v.customerLedger)) + "</PARTYLEDGERNAME>\n<PARTYNAME>" + xesc(x.customerName || v.customerLedger) + "</PARTYNAME>\n<BASICBUYERNAME>" + xesc(x.customerName || v.customerLedger) + "</BASICBUYERNAME>\n" +
    (x.customerGstin ? "<PARTYGSTIN>" + xesc(x.customerGstin) + "</PARTYGSTIN>\n<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n" : "<GSTREGISTRATIONTYPE>Unregistered/Consumer</GSTREGISTRATIONTYPE>\n") +
    (pos && GST_STATES[pos] ? "<STATENAME>" + xesc(GST_STATES[pos]) + "</STATENAME>\n<PLACEOFSUPPLY>" + xesc(GST_STATES[pos]) + "</PLACEOFSUPPLY>\n" : "") +
    "<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>\n" +
    (salesCmpGstin(v, co) ? "<CMPGSTIN>" + xesc(salesCmpGstin(v, co)) + "</CMPGSTIN>\n" : "") +
    (co.multiGstin ? vchGstReg(co, salesCmpGstin(v, co)) : "") +   // (the owner's approval of 23-Nov-2026: src/js/01)
    (x.irn && x.irnStatus !== "cancelled" ? "<IRN>" + xesc(x.irn) + "</IRN>\n" : "") +
    "<NARRATION>" + xesc((x.noteKind === "credit" ? "Being credit note " : x.noteKind === "debit" ? "Being debit note " : v.source === "created" ? "Sales invoice " : "Being sales invoice ") + x.number + " dated " + fmtDate(x.date) + " to " + (x.customerName || v.customerLedger) + " | TDSDesk:" + v.id) + "</NARRATION>\n" +
    "<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n<ISINVOICE>No</ISINVOICE>\n<ISOPTIONAL>" + (co.createOptional ? "Yes" : "No") + "</ISOPTIONAL>\n";
  salesLines(v).forEach(l => {
    const dr = cn ? l.side !== "Dr" : l.side === "Dr", a = (dr ? "-" : "") + amt2(l.amt);
    s += "<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>" + xesc(tallyLedgerName(l.ledger)) + "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>" + (dr ? "Yes" : "No") + "</ISDEEMEDPOSITIVE>\n<ISPARTYLEDGER>" + (l.role === "party" ? "Yes" : "No") + "</ISPARTYLEDGER>\n<AMOUNT>" + a + "</AMOUNT>\n";
    if (l.role === "party") s += "<BILLALLOCATIONS.LIST>\n<NAME>" + xesc(orig ? orig.x.number : x.number) + "</NAME>\n<BILLTYPE>" + (orig ? "Agst Ref" : "New Ref") + "</BILLTYPE>\n" + (x.dueDays ? "<BILLCREDITPERIOD>" + num(x.dueDays) + " Days</BILLCREDITPERIOD>\n" : "") + "<AMOUNT>" + a + "</AMOUNT>\n</BILLALLOCATIONS.LIST>\n";
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
// (next-fix-audit-sales-einv) the reader of an uploaded invoice (salesReadFile, salesPrompt, salesFromClaude) comes with the
// Sales screen's part, src/js/26-sales-invoice.js: loaded first when an upload starts elsewhere (the assistant)
async function readSalesFile(...a){ if (typeof salesReadFile !== "function") await window.loadPart("invoice"); return salesReadFile(...a); }
function newInvoice(x, source, extra){
  return Object.assign({id: uid("sv"), source, status: "review", x: Object.assign({number: "", date: "", customerName: "", customerGstin: "", address: "", pos: "", taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0, items: []}, x),
    customerLedger: "", userLedger: false, createdAt: new Date().toISOString()}, extra || {});
}
// rereadSales (an invoice read again): src/js/26-sales-invoice.js, with the Sales screen
