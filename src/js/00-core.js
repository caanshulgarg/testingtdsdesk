
"use strict";
/* TDS rules: Income-tax Act, 2025 (section 393), tax year 2026-27. Editable under Rates and limits. */
const RULE_DEFAULTS = [
  {id:"contractor", label:"Contractor / job work / manpower", ref:"393(1) Sl. 6(i)", old:"194C", rateInd:1, rateOth:2, single:30000, limit:100000, basis:"single_or_annual",
   hint:"works contracts, job work, labour or manpower supply, transport/carriage, catering, advertising, repair and maintenance contracts"},
  {id:"professional", label:"Professional fees", ref:"393(1) Sl. 6(iii)(a)", old:"194J", rateInd:10, rateOth:10, single:0, limit:50000, basis:"annual",
   hint:"legal, audit, accounting, medical, engineering, architectural, consultancy, interior decoration and similar professional services"},
  {id:"technical", label:"Technical services", ref:"393(1) Sl. 6(iii)(b)", old:"194J", rateInd:2, rateOth:2, single:0, limit:50000, basis:"annual",
   hint:"fees for technical services: managerial, technical or consultancy services that are not professional services, e.g. IT support, software implementation"},
  {id:"director", label:"Director fees / commission", ref:"393(1) Sl. 6(iii)(c)", old:"194J", rateInd:10, rateOth:10, single:0, limit:0, basis:"always",
   hint:"sitting fees, commission or remuneration to a company director (not salary)"},
  {id:"commission", label:"Commission / brokerage", ref:"393(1) Sl. 1(ii)", old:"194H", rateInd:2, rateOth:2, single:0, limit:20000, basis:"annual",
   hint:"commission or brokerage other than insurance commission"},
  {id:"rent_building", label:"Rent: land, building, furniture", ref:"393(1) Sl. 2(ii)", old:"194-I", rateInd:10, rateOth:10, single:0, limit:50000, basis:"monthly",
   hint:"rent or lease of land, building, office, warehouse, furniture or fittings"},
  {id:"rent_machinery", label:"Rent: plant and machinery", ref:"393(1) Sl. 2(ii)", old:"194-I", rateInd:2, rateOth:2, single:0, limit:50000, basis:"monthly",
   hint:"hire or rent of plant, machinery or equipment without operator"},
  {id:"interest", label:"Interest (non-bank)", ref:"393(1) Sl. 5(iii)", old:"194A", rateInd:10, rateOth:10, single:0, limit:10000, basis:"annual",
   hint:"interest on loans or deposits payable to a non-bank party, other than interest on securities"},
  {id:"goods", label:"Purchase of goods", ref:"393(1) Sl. 8(ii)", old:"194Q", rateInd:0.1, rateOth:0.1, single:0, limit:5000000, basis:"excess",
   hint:"purchase of goods, raw material, stock-in-trade, capital goods (supply of goods rather than a service)"},
  {id:"none", label:"Not covered by TDS", ref:"—", old:"—", rateInd:0, rateOth:0, single:0, limit:0, basis:"never",
   hint:"payments with no TDS: utilities, government fees, bank charges, insurance premium, reimbursements, travel tickets, and similar"}
];
const EXPENSE_DEFAULTS = {contractor:"Contract Charges", professional:"Professional Fees", technical:"Technical Service Charges", director:"Director Sitting Fees",
  commission:"Commission Paid", rent_building:"Rent", rent_machinery:"Machinery Hire Charges", interest:"Interest Paid", goods:"Purchases", none:"General Expenses"};
const TDS_LEDGER_DEFAULTS = {contractor:"TDS Payable - Contractor", professional:"TDS Payable - Professional", technical:"TDS Payable - Technical",
  director:"TDS Payable - Director", commission:"TDS Payable - Commission", rent_building:"TDS Payable - Rent", rent_machinery:"TDS Payable - Rent",
  interest:"TDS Payable - Interest", goods:"TDS Payable - Purchase of Goods", none:""};
const GST_DEFAULTS = {cgst:"Input CGST", sgst:"Input SGST", igst:"Input IGST"};
const DEFAULT_FIRM = {firmName:"Garg Shekhar & Company", rules:{}};
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/;
const DB_LIMIT = 5000;
const APP_VERSION = "26 Sep 2026 · build 152 (GSTINs added in GST settings, each with its own settings; GST tab without a day book)";
const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstinCheckChar(g){
  let sum = 0;
  for (let i = 0; i < 14; i++){ const v = GST_CHARS.indexOf(g[i]); if (v < 0) return ""; const p = v * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + p % 36; }
  return GST_CHARS[(36 - sum % 36) % 36];
}
function gstinValid(g){ g = String(g || "").toUpperCase(); return GSTIN_RE.test(g) && gstinCheckChar(g) === g[14]; }
// Handwritten GSTINs: try swapping look-alike characters until the check digit agrees.
const LOOKALIKE = {S:"5", "5":"S", O:"0", "0":"O", D:"0", I:"1", "1":"I", L:"1", B:"8", "8":"B", Z:"2", "2":"Z", G:"6", "6":"G", Q:"0", T:"7", "7":"T", U:"V", V:"U", A:"4", "4":"A"};
function fixGstin(raw){
  const g = String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!g) return {value:"", status:"empty"};
  if (gstinValid(g)) return {value:g, status:"ok"};
  const found = new Set();
  if (g.length === 15){
    for (let i = 0; i < 15; i++){
      const alt = LOOKALIKE[g[i]];
      if (!alt) continue;
      const c = g.slice(0, i) + alt + g.slice(i + 1);
      if (gstinValid(c)) found.add(c);
    }
  }
  if (found.size === 1) return {value:[...found][0], status:"fixed", from:g};
  if (!found.size && g.length === 15){
    const two = new Set();
    for (let i = 0; i < 15; i++){
      const a = LOOKALIKE[g[i]]; if (!a) continue;
      for (let k = i + 1; k < 15; k++){
        const b = LOOKALIKE[g[k]]; if (!b) continue;
        const c = g.slice(0, i) + a + g.slice(i + 1, k) + b + g.slice(k + 1);
        if (gstinValid(c)) two.add(c);
      }
    }
    if (two.size === 1) return {value:[...two][0], status:"fixed", from:g};
  }
  return {value:g, status:"invalid"};
}


/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
const S = {
  firm:null, companies:{}, inbox:{}, data:{},          // data[cid] = {parties, entries, loaded}
  coId:null, view:"home", homeTab:"today", tab:"invoices", filter:"draft", step:null, colAuto: lsGet("tdsdesk:colauto") !== "0", selected:null,
  reading:{}, sample:null, sampleReady:false, imgMax:0, storeKind:"memory",
  partySel:null, partyFy:null, arm:null, homeQuery:"", addingCo:false, switcher:null, loadingCo:false,
  files:{}, previews:{}, filePages:{}, jobs:[], pendingHashes:{}, batchSize:0, readBlocked:null,
  splitPdf: false, pasteOpen: false, freeFirst: true, ocrState: "idle", ocrError: "", ocrCount: 0, ocrTest: null, googleTest: null, selfTest: null, bank: null, readStats: {free:0, google:0, claudeText:0, claudeImages:0},
  engine: null, samplePerm: null, perms: null, testResult: null, apiKeyShown: false
};

function newCompany(f){
  f = f || {};
  const gstin = String(f.gstin || "").toUpperCase().trim();
  return {
    id: uid("c"), name: String(f.name || "").trim(), gstin,
    pan: String(f.pan || (GSTIN_RE.test(gstin) ? gstin.slice(2, 12) : "")).toUpperCase().trim(),
    tallyName: String(f.tallyName || f.name || "").trim(),
    turnover10cr: !!f.turnover10cr, voucherType: f.voucherType || "Journal",
    createOptional: f.createOptional !== false, billwise: f.billwise !== false,
    gst: Object.assign({}, GST_DEFAULTS, f.gst || {}), roundOff: f.roundOff || "Round Off",
    tdsLedgers: Object.assign({}, TDS_LEDGER_DEFAULTS, f.tdsLedgers || {}),
    expenseLedgers: Object.assign({}, EXPENSE_DEFAULTS, f.expenseLedgers || {}),
    stats: {}, hashes: {}, keys: {}, createdAt: new Date().toISOString()
  };
}
function fixCompany(c){
  c.gst = Object.assign({}, GST_DEFAULTS, c.gst || {});
  c.tdsLedgers = Object.assign({}, TDS_LEDGER_DEFAULTS, c.tdsLedgers || {});
  c.expenseLedgers = Object.assign({}, EXPENSE_DEFAULTS, c.expenseLedgers || {});
  c.stats = c.stats || {};
  c.hashes = c.hashes || {};
  c.keys = c.keys || {};
  return c;
}
function rules(){ return RULE_DEFAULTS.map(r => Object.assign({}, r, (S.firm.rules || {})[r.id] || {})); }
function ruleOf(id){ return rules().find(r => r.id === id) || rules().find(r => r.id === "none"); }
function D(cid){ return S.data[cid || S.coId] || {parties:{}, entries:{}, loaded:false}; }
function CO(cid){ return S.companies[cid || S.coId]; }

/* ------------------------------------------------------------------ */
/* Storage: shared database when available, else this browser         */
/*   config/firm                      firm name + rates               */
/*   companies/<cid>                  one client                      */
/*   companies/<cid>/parties/<pid>    deductees of that client        */
/*   companies/<cid>/entries/<eid>    invoices of that client         */
/*   inbox/<id>                       uploads not yet matched         */
/* ------------------------------------------------------------------ */
const IDBStore = {
  dbp: null,
  open(){
    if (this.dbp) return this.dbp;
    this.dbp = new Promise(ok => {
      let done = false; const fin = v => { if (!done){ done = true; ok(v); } };
      try {
        const r = indexedDB.open("tdsdesk-work", 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("docs")) r.result.createObjectStore("docs"); };
        r.onsuccess = () => fin(r.result); r.onerror = () => fin(null); r.onblocked = () => fin(null);
      } catch (e){ fin(null); }
      setTimeout(() => fin(null), 5000);
    });
    return this.dbp;
  },
  async get(key){ const db = await this.open(); return new Promise((ok, no) => { const q = db.transaction("docs").objectStore("docs").get(key); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); },
  async prefix(p){
    const db = await this.open();
    return new Promise((ok, no) => {
      const out = [], q = db.transaction("docs").objectStore("docs").openCursor(IDBKeyRange.bound(p, p + "\uffff"));
      q.onsuccess = () => { const c = q.result; if (c){ out.push([c.key, c.value]); c.continue(); } else ok(out); };
      q.onerror = () => no(q.error);
    });
  },
  async write(pairs){
    const db = await this.open();
    return new Promise((ok, no) => {
      const tx = db.transaction("docs", "readwrite"), st = tx.objectStore("docs");
      pairs.forEach(([k, v]) => { if (v == null) st.delete(k); else st.put(v, k); });
      tx.oncomplete = () => ok(); tx.onerror = () => no(tx.error); tx.onabort = () => no(tx.error || {name: "AbortError"});
    });
  }
};
// The uploaded file is kept in this browser's database, so the document can be opened later, not just in this session.
const FileStore = {
  max: 20 * 1024 * 1024,
  key(cid, id){ return "file:" + cid + ":" + id; },
  async put(cid, id, file){
    if (!file || S.storeKind !== "idb" || file.size > this.max) return false;
    try { await IDBStore.write([[this.key(cid, id), {name: file.name, type: file.type, at: new Date().toISOString(), blob: file}]]); S.fileIndex && S.fileIndex.add(id); return true; }
    catch (e){ return false; }
  },
  async get(cid, id, cloudPath, name){
    if (S.files[id]) return S.files[id];
    if (S.storeKind === "idb"){
      try {
        const rec = await IDBStore.get(this.key(cid, id));
        if (rec && rec.blob){ const f = new File([rec.blob], rec.name || "document", {type: rec.type || "application/octet-stream"}); S.files[id] = f; return f; }
      } catch (e){}
    }
    if (cloudPath && CloudDocs.on()){
      try { const f = await CloudDocs.fetchFile(cloudPath, name); S.files[id] = f; FileStore.put(cid, id, f); return f; } catch (e){ return null; }
    }
    return null;
  },
  async index(cid){
    S.fileIndex = new Set(Object.keys(S.files));
    if (S.storeKind !== "idb") return S.fileIndex;
    try { (await IDBStore.prefix("file:" + cid + ":")).forEach(([k]) => S.fileIndex.add(k.split(":").slice(2).join(":"))); } catch (e){}
    return S.fileIndex;
  },
  async drop(cid, id){ if (S.storeKind === "idb"){ try { await IDBStore.write([[this.key(cid, id), null]]); } catch (e){} } S.fileIndex && S.fileIndex.delete(id); delete S.files[id]; }
};
