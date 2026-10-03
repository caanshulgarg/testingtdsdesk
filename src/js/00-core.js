
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
  {id:"goods", label:"Purchase of goods", ref:"393(1) Sl. 8(ii)", old:"194Q", rateInd:0.1, rateOth:0.1, single:0, limit:5000000, basis:"excess", turnoverTest:true, noPanRate:5,
   hint:"purchase of goods, raw material, stock-in-trade, capital goods (supply of goods rather than a service)"},
  // tax-accuracy (stage 5): the other payments a client may make. form: the return or challan-cum-statement it goes in
  {id:"rent_individual", label:"Rent paid by an individual / HUF (not audited)", ref:"393(1) Sl. 2(i)", old:"194-IB", rateInd:2, rateOth:2, single:0, limit:50000, basis:"monthly", form:"26QC",
   payer:"an individual or HUF not liable to tax audit", hint:"rent of land, building or furniture paid by an individual or HUF that is not liable to tax audit (Form 26QC, no TAN needed)"},
  {id:"property", label:"Purchase of immovable property", ref:"393(1) Sl. 3(i)", old:"194-IA", rateInd:1, rateOth:1, single:5000000, limit:0, basis:"single", form:"26QB",
   hint:"buying land (other than agricultural land) or a building from a resident for ₹50 lakh or more (Form 26QB, no TAN needed)"},
  {id:"contract_individual", label:"Contract / professional fees paid by an individual / HUF (not audited)", ref:"393(1) Sl. 6(ii)", old:"194M", rateInd:2, rateOth:2, single:0, limit:5000000, basis:"annual", form:"26QD",
   payer:"an individual or HUF not liable to tax audit", hint:"contract work, commission or professional fees paid by an individual or HUF not liable to tax audit, above ₹50 lakh in the year (Form 26QD)"},
  {id:"perquisite", label:"Benefit or perquisite of a business", ref:"393(1) Sl. 8(iv)", old:"194R", rateInd:10, rateOth:10, single:0, limit:20000, basis:"annual",
   hint:"a benefit or perquisite given to a resident from a business or profession: free goods, sponsored trips, gifts to dealers or doctors"},
  {id:"ecommerce", label:"E-commerce operator to a seller", ref:"393(1) Sl. 8(v)", old:"194-O", rateInd:0.1, rateOth:0.1, single:0, limit:500000, basis:"annual", noPanRate:5,
   payer:"an e-commerce operator", hint:"gross sales of goods or services of a seller made through the client's e-commerce platform (the ₹5 lakh limit is only for an individual or HUF seller with a PAN)"},
  {id:"cash_withdrawal", label:"Cash withdrawal (bank, co-operative, post office)", ref:"393(3)", old:"194N", rateInd:2, rateOth:2, single:0, limit:10000000, basis:"excess",
   payer:"a bank, co-operative bank or post office", hint:"cash paid out to an account holder above ₹1 crore in the year (₹3 crore for a co-operative society); TDS on the amount above the limit"},
  {id:"partner", label:"Partner's salary, commission, bonus or interest", ref:"393(3)", old:"194T", rateInd:10, rateOth:10, single:0, limit:20000, basis:"annual",
   payer:"a partnership firm or LLP", hint:"salary, remuneration, commission, bonus or interest a firm or LLP pays or credits to a partner (not drawings or capital)"},
  {id:"nonresident", label:"Payment to a non-resident", ref:"393(2)", old:"195", rateInd:20.8, rateOth:20.8, single:0, limit:0, basis:"always", form:"27Q", nonResident:true,
   hint:"interest, royalty, fees for technical services or other sums chargeable to tax paid to a non-resident or foreign company; 20% + 4% cess unless a lower treaty (DTAA) rate is set on the deductee with a tax residency certificate"},
  {id:"none", label:"Not covered by TDS", ref:"—", old:"—", rateInd:0, rateOth:0, single:0, limit:0, basis:"never",
   hint:"payments with no TDS: utilities, government fees, bank charges, insurance premium, reimbursements, travel tickets, and similar"}
];
const EXPENSE_DEFAULTS = {contractor:"Contract Charges", professional:"Professional Fees", technical:"Technical Service Charges", director:"Director Sitting Fees",
  commission:"Commission Paid", rent_building:"Rent", rent_machinery:"Machinery Hire Charges", interest:"Interest Paid", goods:"Purchases", none:"General Expenses",
  rent_individual:"Rent", property:"Land and Building", contract_individual:"Contract Charges", perquisite:"Business Promotion", ecommerce:"Payable to Sellers",
  cash_withdrawal:"Cash Withdrawals", partner:"Partners' Remuneration", nonresident:"Foreign Services"};
const TDS_LEDGER_DEFAULTS = {contractor:"TDS Payable - Contractor", professional:"TDS Payable - Professional", technical:"TDS Payable - Technical",
  director:"TDS Payable - Director", commission:"TDS Payable - Commission", rent_building:"TDS Payable - Rent", rent_machinery:"TDS Payable - Rent",
  interest:"TDS Payable - Interest", goods:"TDS Payable - Purchase of Goods", none:"",
  rent_individual:"TDS Payable - Rent", property:"TDS Payable - Property", contract_individual:"TDS Payable - Contract", perquisite:"TDS Payable - Perquisite",
  ecommerce:"TDS Payable - E-commerce", cash_withdrawal:"TDS Payable - Cash Withdrawal", partner:"TDS Payable - Partners", nonresident:"TDS Payable - Non-resident"};
const GST_DEFAULTS = {cgst:"Input CGST", sgst:"Input SGST", igst:"Input IGST"};
const DEFAULT_FIRM = {firmName:"", rules:{}};
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/;
const DB_LIMIT = 5000;
const APP_VERSION = "30 Sep 2026 · build 199 (posting queue: post from any computer, the Tally computer posts when Tally is free; posted entries go to the cloud without reading Tally again)";
// the bridge setup file's fingerprint, put in by build.py: a new setup file is never served from an old cache
const BRIDGE_SETUP_SHA = "{{BRIDGE_SETUP_SHA}}";
// the bridge Setup handed out: assets/bridge-setup.txt on the live site; the testing builds (build.py to_test) hand out
// assets/bridge-setup-test.txt, so a new bridge is tried on staging without changing what live users download
const BRIDGE_SETUP_ID = "bridge-setup";
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

// a Tally ledger's name as its entries name it: a name ending in (or holding) line breaks, as Tally sometimes keeps it in
// the master, is the same ledger without them
// only the line breaks go (Tally keeps names such as "Arktos  Control & Instruments" with two spaces, and a posting must
// use Tally's exact name); the same rule as tally_nm on the server
function ledNm(n){ return namesBreaks(n); }
// review of 02-Oct-2026 (trade receivables 11,550 short): Tally's XML can carry a name's line breaks escaped twice
// ("MCS Project Pvt Ltd&amp;#13;&amp;#10;"), which comes out of the reader as "MCS Project Pvt Ltd&#13;&#10;"; a copy
// of the books read before the cloud cleaned its names (migration-23) keeps such names in its balances and groups.
// ledClean: the name as it is kept: entities decoded, line breaks gone (ledNm); other spaces stay, as Tally has them.
// ledKey: the name for matching only: also every run of spaces as one, so "A  B" and "A B&#13;&#10;" meet
// All four are the one rule shared with the cloud reader (server/_shared/names.js, put ahead of this file by build.py)
function ledEnt(s){ return namesDecode(s); }
function ledClean(n){ return namesClean(n); }
function ledKey(n){ return namesKey(n); }
// the group a ledger sits under, and the groups above it: the one place every report looks it up (MIS, Reports, the
// accounts, Audit, Parties). The name is looked up as kept, else by its clean key, so a name with line breaks or
// entities still finds its group (and a group's parent the same way)
const LED_IDX = new WeakMap();
function ledIdx(o){
  if (!o) return null;
  // built again when the names changed (counted at most once a second: paths are asked for many times a run)
  const x = LED_IDX.get(o), t = Date.now();
  if (x && t - x.at < 1000) return x;
  const n = Object.keys(o).length;
  if (x && x.n === n){ x.at = t; return x; }
  const m = new Map(); Object.keys(o).forEach(k => { const kk = ledKey(k); if (kk && (!m.has(kk) || o[k])) m.set(kk, o[k]); });
  const y = {n, m, at: t, seen: new Map()};             // seen: a name already looked up by its key
  LED_IDX.set(o, y);
  return y;
}
function ledLook(o, l){
  if (!o || l == null) return undefined;
  if (o[l] != null) return o[l];
  const x = ledIdx(o);
  if (x.seen.has(l)) return x.seen.get(l);
  const p = x.m.get(ledKey(l)), v = p == null ? undefined : p;
  x.seen.set(l, v);
  return v;
}
function ledUnder(b, l){ return ledLook(b && b.under, l); }
function ledGroupPath(b, l){
  const groups = (b && b.groups) || {}, out = [];
  let p = ledUnder(b, l);
  for (let i = 0; p && i < 15; i++){ if (groups[p] == null && /&|\r|\n/.test(p)) p = ledClean(p); out.push(p); p = ledLook(groups, p) || ""; }
  return out;
}
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
  // the choices a person confirmed (src/js/60): a copy coming in never takes back a newer or confirmed one held here
  if (typeof choiceMigrate === "function") choiceMigrate(c, typeof S === "object" && S.companies ? S.companies[c.id] : null);
  return c;
}
/* ---------- the rate a deduction is made at: shared by bills (compute) and the check of the books (Certs) ---------- */
// No PAN, or a PAN made inoperative (not linked with Aadhaar): the higher of the rate and 20% (old section 206AA); 5% for
// purchase of goods and e-commerce (the section's own proviso). Section 206AB (non-filers) is gone from 1 April 2025.
const NO_PAN_RATE = 20;
function noPanRate(rule, rate){ return rule && rule.noPanRate != null && rule.noPanRate !== "" ? num(rule.noPanRate) : Math.max(num(rate), NO_PAN_RATE); }
function panInoperative(party){ return !!(party && party.panInoperative); }
// a deductee's lower deduction certificates (old section 197): [{no, rule, rate, from, to, limit}]; the older single rate
// and valid-to date kept on a deductee count as one certificate for every payment type, with no amount limit
function ldcList(party){
  if (!party) return [];
  const out = (Array.isArray(party.ldc) ? party.ldc : []).filter(c => c && c.rate !== "" && c.rate != null && !c.deleted);
  if (party.ldcRate !== undefined && party.ldcRate !== "" && party.ldcValidTo) out.push({no: "", rule: "", rate: party.ldcRate, from: "", to: party.ldcValidTo, limit: 0, old: true});
  return out;
}
function ldcFor(party, ruleId, date){
  const d = String(date || "").slice(0, 10);
  return ldcList(party).find(c => (!c.rule || c.rule === ruleId) && (!c.from || !d || d >= c.from) && (!c.to || !d || d <= c.to)) || null;
}
// how much of a certificate's amount approved bills have used
function ldcUsed(party, cert, cid, skip){
  if (!party || !cert || !num(cert.limit)) return 0;
  let used = 0;
  Object.values(D(cid).entries || {}).forEach(e => {
    if (e === skip || e.status !== "approved" || !e.snapshot || !e.snapshot.cert) return;
    if (e.snapshot.cert !== (cert.no || "-") || !e.applied || e.applied.partyId !== party.id) return;
    used = r2(used + num(e.snapshot.certBase));
  });
  return used;
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
