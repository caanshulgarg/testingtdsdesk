/* ================================================================== */
/* Bank statements: upload, read, check, suggest, create, send to Tally */
/* ================================================================== */
const BANK_LEDGER_DEFAULTS = {charges:"Bank Charges", interest:"Interest Received", gstCash:"GST Electronic Cash Ledger", tds:"TDS Payable",
  advanceTax:"Advance Tax", pf:"PF Payable", esi:"ESI Payable", salary:"Salary Payable", cash:"Cash"};
const BANK_LEDGER_LABELS = {charges:"Bank charges", interest:"Interest received", gstCash:"GST payment (cash ledger)", tds:"TDS payment", advanceTax:"Advance / self-assessment tax",
  pf:"PF payment", esi:"ESI payment", salary:"Salary payment", cash:"Cash withdrawal / deposit"};
const TALLY_GROUPS = ["Sundry Creditors","Sundry Debtors","Indirect Expenses","Direct Expenses","Indirect Incomes","Direct Incomes","Purchase Accounts","Sales Accounts",
  "Loans & Advances (Asset)","Loans (Liability)","Secured Loans","Unsecured Loans","Deposits (Asset)","Investments","Fixed Assets","Current Assets","Current Liabilities",
  "Duties & Taxes","Provisions","Capital Account","Reserves & Surplus","Bank Accounts","Bank OD A/c","Cash-in-Hand","Suspense A/c","Misc. Expenses (ASSET)"];
const BANK_STATES = {attention:"Needs a ledger", suggested:"Suggested", ready:"Ready", intally:"Already in Tally", ignored:"Ignored", sent:"Sent to Tally"};

/* ---------- storage: IndexedDB (large), kept per client ---------- */
const BankDB = {
  mem: {}, dbp: null, mode: "starting", lost: false,
  open(){
    if (this.dbp) return this.dbp;
    this.dbp = new Promise(ok => {
      let done = false;
      const finish = v => { if (!done){ done = true; this.mode = v ? "database" : (this.lsOk() ? "browser storage" : "memory only"); ok(v); } };
      // Safari can leave this request unanswered for files opened from disk: give up after 3 seconds
      setTimeout(() => finish(null), 3000);
      try {
        if (!window.indexedDB) return finish(null);
        const r = indexedDB.open("tdsdesk-bank", 1);
        r.onupgradeneeded = () => { try { r.result.createObjectStore("kv"); } catch (e){} };
        r.onsuccess = () => finish(r.result);
        r.onerror = () => finish(null);
        r.onblocked = () => finish(null);
      } catch (e){ finish(null); }
    });
    return this.dbp;
  },
  lsOk(){ try { localStorage.setItem("tdsdesk:bank:test", "1"); localStorage.removeItem("tdsdesk:bank:test"); return true; } catch (e){ return false; } },
  lsGet(k){ try { const v = localStorage.getItem("tdsdesk:bank:" + k); return v ? JSON.parse(v) : undefined; } catch (e){ return undefined; } },
  lsSet(k, v){ try { localStorage.setItem("tdsdesk:bank:" + k, JSON.stringify(v)); return true; } catch (e){ this.lost = true; return false; } },
  withTimeout(p, fallback){ return Promise.race([p, new Promise(ok => setTimeout(() => ok(fallback), 4000))]); },
  async get(k){
    const db = await this.open();
    if (!db) return k in this.mem ? this.mem[k] : this.lsGet(k);
    return this.withTimeout(new Promise(ok => { try { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(this.mem[k]); } catch (e){ ok(this.mem[k]); } }), this.mem[k]);
  },
  async set(k, v){
    this.mem[k] = v;
    const db = await this.open();
    if (!db) return this.lsSet(k, v);
    return this.withTimeout(new Promise(ok => { try { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = () => ok(true); tx.onerror = () => ok(false); } catch (e){ ok(false); } }), false);
  },
  async del(k){
    delete this.mem[k];
    const db = await this.open();
    if (!db){ try { localStorage.removeItem("tdsdesk:bank:" + k); } catch (e){} return; }
    return this.withTimeout(new Promise(ok => { try { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").delete(k); tx.oncomplete = () => ok(true); tx.onerror = () => ok(false); } catch (e){ ok(false); } }), false);
  }
};
function B(){ return S.bank; }
// file pickers live outside the redrawn screen, so a refresh while a file dialog is open cannot lose the choice
function ensureFileInputs(){
  [["bankIn", true, ".xlsx,.xls,.xlsm,.csv,.txt,.pdf,.jpg,.jpeg,.png,.webp,image/*"], ["ledIn", false, ".xlsx,.xls,.csv,.xml"], ["bookIn", false, ".xlsx,.xls,.csv"], ["salesIn", true, "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp"]].forEach(([id, multi, accept]) => {
    if (document.getElementById(id)) return;
    const el = document.createElement("input");
    el.type = "file"; el.id = id; el.hidden = true; el.accept = accept; if (multi) el.multiple = true;
    document.body.appendChild(el);
  });
}
async function loadBank(cid){
  S.bank = {cid, loading: true, stmts: [], cur: null, rows: [], rules: [], ledgers: {list: [], importedAt: ""}, newLed: [], keys: {}, books: {},
    filter: "review", grouped: false, showSettings: false, q: "", limit: 100, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0};
  render();
  const [stmts, rules, ledgers, newLed, keys, wrules, books, hist, salesRef, postedTags] = await Promise.all([
    BankDB.get("stmts:" + cid), BankDB.get("rules:" + cid), BankDB.get("ledgers:" + cid), BankDB.get("newled:" + cid), BankDB.get("keys:" + cid), BankDB.get("wrules:" + cid), BankDB.get("books:" + cid), BankDB.get("hist:" + cid), BankDB.get("sales:" + cid), BankDB.get("posted:" + cid)]);
  if (S.bank && S.bank.cid === cid) S.bank.salesRef = salesRef || [];
  if (!S.bank || S.bank.cid !== cid) return;
  Object.assign(S.bank, {postedTags: postedTags || {}, stmts: stmts || [], rules: rules || [], wrules: wrules || [], ledgers: ledgers || {list: [], importedAt: ""}, newLed: newLed || [], keys: keys || {}, books: books || {}, hist: hist && hist.rows ? hist : {rows: {}}, loading: false});
  S.bank.histVer++;
  if (S.bank.stmts.length) await openStatement(S.bank.stmts[S.bank.stmts.length - 1].id);
  render();
  if (bridgeLive(CO(cid))) bankAutoSync(false);
}
async function openStatement(sid){
  const b = B(); if (!b) return;
  b.cur = sid; b.rows = (await BankDB.get("stmt:" + b.cid + ":" + sid)) || [];
  // rows still undecided pick up whatever was learnt since this statement was last open
  if (b.rows.some(r => r.state === "attention" || (r.state === "suggested" && r.source !== "history"))) suggestAll(b.rows, true); b.limit = 100; b.pendingRule = null; b.sel.clear(); b.sticky.clear(); b.undo = null;
  const n = b.rows.filter(r => r.state === "attention").length;
  b.filter = n || b.rows.some(r => r.state === "suggested") ? "review" : "ready";
  render();
  if (bridgeLive()) bankAutoSync(false);
}
function curStmt(){ const b = B(); return b && b.stmts.find(s => s.id === b.cur); }
let bankSaveTimer = null;
function saveBank(what){
  const b = B(); if (!b) return;
  const cid = b.cid;
  if (!what || what.rows){
    clearTimeout(bankSaveTimer);
    const sid = b.cur, rows = b.rows;
    bankSaveTimer = setTimeout(() => {
      bankSaveTimer = null;
      BankDB.set("stmt:" + cid + ":" + sid, rows);
      const st = b.stmts.find(s => s.id === sid);
      if (st){ st.counts = countStates(rows); BankDB.set("stmts:" + cid, b.stmts); }
    }, 900);
  }
  if (what && what.stmts) BankDB.set("stmts:" + cid, b.stmts);
  if (what && what.rules) BankDB.set("rules:" + cid, b.rules);
  if (what && what.wrules) BankDB.set("wrules:" + cid, b.wrules || []);
  if (what && what.posted) BankDB.set("posted:" + cid, b.postedTags || {});
  if (what && what.ledgers) BankDB.set("ledgers:" + cid, b.ledgers);
  if (what && what.newLed) BankDB.set("newled:" + cid, b.newLed);
  if (what && what.keys) BankDB.set("keys:" + cid, b.keys);
  if (what && what.books) BankDB.set("books:" + cid, b.books);
  if (what && what.hist){ clearTimeout(saveBank.histTimer); saveBank.histTimer = setTimeout(() => BankDB.set("hist:" + cid, b.hist), 700); }
}
window.addEventListener("pagehide", () => { if (bankSaveTimer && S.bank){ clearTimeout(bankSaveTimer); const b = S.bank; BankDB.set("stmt:" + b.cid + ":" + b.cur, b.rows); } });
function countStates(rows){ const c = {}; rows.forEach(r => { c[r.state] = (c[r.state] || 0) + 1; }); return c; }

/* ---------- reading cells ---------- */
function cellText(v){
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, " ").trim();
}
function bankAmount(v){
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).replace(/[₹,\s]/g, "").replace(/^(rs\.?|inr)/i, "");
  if (!s || /^[-–—]+$/.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1, -1); }
  if (/dr\.?$/i.test(s)){ neg = true; s = s.replace(/dr\.?$/i, ""); }
  s = s.replace(/cr\.?$/i, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
}
function bankDate(v){
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000 && window.XLSX){
    const d = XLSX.SSF.parse_date_code(v);
    return d ? toIsoDate(d.d, d.m, d.y) : "";
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toIsoDate(m[3], m[2], m[1]);
  m = s.match(/^(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{2,4})\b/);
  if (m) return toIsoDate(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[\/\-.\s]?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\/\-.\s,]*(\d{2,4})\b/i);
  if (m) return toIsoDate(m[1], MONTHS[m[2].toLowerCase()], m[3]);
  return "";
}
const BANK_HDR = [
  ["valueDate", /^value\s*d(ate|t)\.?$|value\s*date/i],
  ["date", /^(s\.?\s*no\.?\s*)?(txn|tran|transaction|post(ing)?|trans)?\.?\s*date$|^date$|^dt\.?$|transaction\s*date|^tran\s*date|^txn\s*date/i],
  ["balance", /^bal(ance)?\b|balance/i],
  ["drcr", /^(dr\s*\/\s*cr|cr\s*\/\s*dr|debit\s*\/\s*credit|txn\s*type|type)$/i],
  ["debit", /withdrawal|^debit|debit\s*amount|^dr\.?$|dr\.?\s*amount|paid\s*out|withdrawn/i],
  ["credit", /deposit|^credit|credit\s*amount|^cr\.?$|cr\.?\s*amount|paid\s*in|received/i],
  ["amount", /^(transaction\s*)?amount|amount\s*\(/i],
  ["ref", /chq|cheque|ref(erence)?(\s*no)?|instrument|utr/i],
  ["narr", /narration|particulars|description|remarks|details|transaction\s*info/i]
];
function classifyHeader(text){
  const t = cellText(text);
  if (!t || t.length > 60) return "";
  for (const [k, re] of BANK_HDR) if (re.test(t)) return k;
  const joined = t.replace(/\s+/g, "");                 // "Withdra wal (Dr)" -> "Withdrawal(Dr)"
  if (joined !== t) for (const [k, re] of BANK_HDR) if (re.test(joined)) return k;
  return "";
}
// Find the heading row and which column holds what
function findHeader(grid){
  for (let i = 0; i < Math.min(grid.length, 80); i++){
    const row = grid[i] || [];
    const next = grid[i + 1] || [];
    const cols = {};
    const width = Math.max(row.length, next.length);
    for (let c = 0; c < width; c++){
      let k = classifyHeader(row[c]);
      // two-line headings: "Withdrawal" / "Amt."
      if (!k && cellText(row[c]) && cellText(next[c]) && !bankDate(next[c]) && bankAmount(next[c]) === null) k = classifyHeader(cellText(row[c]) + " " + cellText(next[c]));
      if (!k) continue;
      if (k === "drcr" && cols.drcr !== undefined) continue;          // Kotak: a second Dr/Cr belongs to the balance
      if (cols[k] === undefined) cols[k] = c;
    }
    if (cols.date === undefined && cols.valueDate !== undefined){ cols.date = cols.valueDate; }
    const hasAmounts = (cols.debit !== undefined && cols.credit !== undefined) || cols.amount !== undefined;
    if (cols.date !== undefined && cols.narr !== undefined && hasAmounts) return {at: i, cols};
  }
  return null;
}
const BANK_NAMES = [["HDFC","HDFC Bank"],["ICIC","ICICI Bank"],["SBIN","State Bank of India"],["UTIB","Axis Bank"],["KKBK","Kotak Mahindra Bank"],["PUNB","Punjab National Bank"],
  ["BARB","Bank of Baroda"],["YESB","Yes Bank"],["IDFB","IDFC First Bank"],["INDB","IndusInd Bank"],["CNRB","Canara Bank"],["UBIN","Union Bank of India"],["BKID","Bank of India"],
  ["CBIN","Central Bank of India"],["IDIB","Indian Bank"],["UCBA","UCO Bank"],["FDRL","Federal Bank"],["RATN","RBL Bank"],["AUBL","AU Small Finance Bank"],["IOBA","Indian Overseas Bank"],["MAHB","Bank of Maharashtra"],["PSIB","Punjab & Sind Bank"]];
function statementMeta(lines){
  const txt = lines.join("\n");
  const meta = {};
  const ac = txt.match(/(?:a\/?c|account)\s*(?:no|number|num)?\.?\s*[:\-]?\s*([0-9Xx*]{6,20})/i);
  if (ac) meta.acct = ac[1].toUpperCase();
  const ifsc = txt.toUpperCase().match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
  if (ifsc) meta.ifsc = ifsc[1];
  const byIfsc = meta.ifsc && BANK_NAMES.find(b => b[0] === meta.ifsc.slice(0, 4));
  const byName = BANK_NAMES.find(b => new RegExp("\\b" + b[1].replace(/ /g, "\\s*"), "i").test(txt));
  meta.bank = byIfsc ? byIfsc[1] : byName ? byName[1] : "";
  const per = txt.match(/(?:from|period)\s*[:\-]?\s*(\S+)\s*(?:to|-)\s*(\S+)/i);
  if (per){ meta.from = bankDate(per[1]); meta.to = bankDate(per[2]); }
  const ob = txt.match(/(?:opening\s*bal(?:ance)?|bal(?:ance)?\s*(?:brought|b\/)\s*f(?:or)?w?(?:ar)?d?|b\/f\s*bal(?:ance)?)[^0-9\-]{0,20}(-?[\d,]+\.\d{2})\s*(dr|cr)?/i);
  if (ob) meta.opening = bankAmount(ob[1] + (ob[2] || ""));
  const cb = txt.match(/closing\s*balance[^0-9\-]{0,20}(-?[\d,]+\.\d{2})\s*(dr|cr)?/i);
  if (cb) meta.closing = bankAmount(cb[1] + (cb[2] || ""));
  return meta;
}
// Turn cells into transactions; join narration lines that wrap onto the next row
function rowsFromCells(list, cols, getCell, rowText){
  const out = [];
  let lastWasTxn = false;
  for (const raw of list){
    const g = k => cols[k] === undefined ? "" : getCell(raw, cols[k]);
    const date = bankDate(g("date"));
    let debit = bankAmount(g("debit")), credit = bankAmount(g("credit"));
    if (cols.amount !== undefined){
      const a = bankAmount(g("amount")), t = cellText(g("drcr")).toUpperCase();
      if (a !== null){
        if (/^D|DR|DEBIT|WITHDRAW/.test(t) || (a < 0 && !/CR/.test(t))){ debit = Math.abs(a); credit = null; }
        else { credit = Math.abs(a); debit = null; }
      }
    }
    const balRaw = g("balance");
    let balance = bankAmount(balRaw);
    const narr = cellText(g("narr")), ref = cellText(g("ref"));
    if (!date){
      const hasMoney = (debit || credit || balance !== null);
      const whole = rowText ? rowText(raw) : narr;
      const isFooter = /(opening|closing)\s*bal|total|page\s*\d|statement\s*summary|summary|generated\s*on|dr\s*count|cr\s*count|end\s*of\s*statement|\*{3,}/i.test(whole);
      if (!hasMoney && narr && lastWasTxn && !isFooter && !cellText(g("ref"))) out[out.length - 1].narr += " " + narr;
      else lastWasTxn = false;
      continue;
    }
    if (!debit && !credit){ lastWasTxn = false; continue; }
    lastWasTxn = true;
    out.push({date, valueDate: bankDate(g("valueDate")), narr, ref, page: raw.page || null, debit: debit ? Math.abs(debit) : 0, credit: credit ? Math.abs(credit) : 0, balance});
  }
  return out;
}
/* ---------- Excel / CSV ---------- */
async function gridsFromSheet(file){
  await ensureXlsx();
  if (!window.XLSX) throw {code: "xlsx_missing"};
  const buf = await file.arrayBuffer();
  // CSV/text: keep every value as written, so 05-09-2026 stays 5 September (SheetJS would read it US-style)
  const plain = /\.(csv|txt)$/i.test(file.name) || /text\/(csv|plain)/.test(file.type);
  const wb = XLSX.read(buf, plain ? {type: "array", raw: true} : {type: "array", cellDates: true, raw: false, dateNF: "dd/mm/yyyy"});
  return wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, raw: true, defval: "", blankrows: false}));
}
async function parseSheetStatement(file){
  const grids = await gridsFromSheet(file);
  for (const grid of grids){
    const h = findHeader(grid);
    if (!h) continue;
    const top = grid.slice(0, h.at).map(r => r.map(cellText).filter(Boolean).join(" "));
    const tail = grid.slice(h.at + 1).filter(r => !bankDate(r[h.cols.date])).map(r => r.map(cellText).filter(Boolean).join(" "));
    const meta = statementMeta(top.concat(tail));
    const rows = rowsFromCells(grid.slice(h.at + 1), h.cols, (r, c) => r[c], r => r.map(cellText).filter(Boolean).join(" "));
    return {meta, rows, source: "sheet"};
  }
  throw {code: "bank_no_header"};
}
/* ---------- PDF with text inside: rebuild the table from word positions ---------- */
const MONEY_TOKEN = /^-?[\d,]+\.\d{2}(cr|dr)?$/i;
const DATE_TOKEN = /^(\d{1,2}[\/\-.](\d{1,2}|[a-z]{3,9})[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})$/i;
// Split a text piece that holds several dates/amounts ("0.00 59,400.00 159,400.00") into positioned tokens
function splitPiece(it){
  const words = it.s.split(/\s+/).filter(Boolean);
  const numeric = words.filter(w => MONEY_TOKEN.test(w) || DATE_TOKEN.test(w) || /^(cr|dr)\.?$/i.test(w)).length;
  if (words.length < 2 || numeric < 2 || numeric < words.length - 1) return [it];
  const total = it.s.length, out = [];
  let pos = 0;
  words.forEach(w => {
    const at = it.s.indexOf(w, pos); pos = at + w.length;
    out.push({s: w, x: it.x + it.w * at / total, w: it.w * w.length / total, y: it.y, h: it.h});
  });
  return out;
}
function headerBand(items){
  // group into lines
  const lines = [];
  items.slice().sort((a, b) => b.y - a.y).forEach(it => {
    let ln = lines.find(l => Math.abs(l.y - it.y) <= 1.5);
    if (!ln){ ln = {y: it.y, items: []}; lines.push(ln); }
    ln.items.push(it);
  });
  lines.sort((a, b) => b.y - a.y);
  const dataLike = ln => ln.items.some(it => DATE_TOKEN.test(it.s) || MONEY_TOKEN.test(it.s.replace(/\s/g, "")) || /^[\d,]+\.\d{0,2}$/.test(it.s) || /\d{1,2}[\/\-][a-z]{3}[\/\-]\d{2}/i.test(it.s));
  for (let li = 0; li < lines.length; li++){
    if (!lines[li].items.some(it => /balance/i.test(it.s) && it.s.length < 30)) continue;
    // the heading may span a few lines above and below the "Balance" line
    let lo = li, hi = li;
    while (lo > 0 && lines[lo - 1].y - lines[lo].y <= 14 && !dataLike(lines[lo - 1])) lo--;
    while (hi < lines.length - 1 && lines[hi].y - lines[hi + 1].y <= 14 && !dataLike(lines[hi + 1])) hi++;
    const band = [];
    for (let i = lo; i <= hi; i++) lines[i].items.forEach(it => { if (it.s.length < 40) band.push(it); });
    const clusters = [];
    band.slice().sort((a, b) => a.x - b.x).forEach(it => {
      const c = clusters.find(c => it.x < c.r + 3 && it.x + it.w > c.x - 3);
      if (c){ c.items.push(it); c.x = Math.min(c.x, it.x); c.r = Math.max(c.r, it.x + it.w); }
      else clusters.push({x: it.x, r: it.x + it.w, items: [it]});
    });
    clusters.sort((a, b) => a.x - b.x);
    const cols = clusters.map(c => {
      const text = c.items.sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(" ");
      return {k: classifyHeader(text), x: c.x, r: c.r, text};
    });
    const has = k => cols.some(c => c.k === k);
    if ((has("date") || has("valueDate")) && has("narr") && ((has("debit") && has("credit")) || has("amount"))){
      const seen = new Set();
      cols.forEach(c => { if (c.k && seen.has(c.k)) c.k = ""; else if (c.k) seen.add(c.k); });
      if (!has("date")) cols.forEach(c => { if (c.k === "valueDate") c.k = "date"; });
      const top = Math.max(...band.map(i => i.y + i.h)), bottom = Math.min(...band.map(i => i.y));
      return {cols, top, bottom};
    }
  }
  return null;
}
const NUMERIC_COLS = ["debit", "credit", "balance", "amount"];
function overlapOf(it, c){ return Math.min(it.x + it.w, c.r + 3) - Math.max(it.x, c.x - 3); }
// Which column a piece of text belongs to ("" = a column we do not use, such as Tran Id or Posted Date)
function assignColumn(it, cols){
  const s0 = it.s.replace(/\s/g, "");
  const moneyish = MONEY_TOKEN.test(s0);
  let best = null, bo = 0;
  cols.forEach(c => { const ov = overlapOf(it, c); if (ov > bo){ bo = ov; best = c; } });
  if (moneyish && (!best || !NUMERIC_COLS.includes(best.k))){
    // amounts are right-aligned and may stick out of the heading: nearest right edge among amount columns
    let nb = null, bd = 1e9;
    cols.filter(c => NUMERIC_COLS.includes(c.k)).forEach(c => { const d = Math.abs((it.x + it.w) - c.r); if (d < bd){ bd = d; nb = c; } });
    if (nb && (!best || bd < 40)) return nb.k;
  }
  if (/^(cr|dr)\.?$/i.test(it.s)){ const c = cols.find(c => c.k === "drcr"); if (c) return "drcr"; }
  if (best) return best.k;
  // outside every heading: nearest centre, but only for text columns
  let nb = null, bd = 1e9;
  cols.forEach(c => { const d = Math.abs((it.x + it.w / 2) - (c.x + c.r) / 2); if (d < bd){ bd = d; nb = c; } });
  return nb && bd < 60 ? nb.k : "";
}
// Join the pieces of one cell. Amounts and dates broken over lines are joined without spaces;
// narration broken in the middle of a word (a full-width line with no spaces) is joined without a space too.
function joinCell(k, ps, maxW){
  if (NUMERIC_COLS.includes(k) || k === "valueDate") return ps.map(t => t.s.replace(/\s/g, "")).join("");
  let out = "";
  ps.forEach((t, i) => {
    if (!i){ out = t.s; return; }
    const prev = ps[i - 1];
    const hard = /[-\/]$/.test(prev.s) || (!/\s/.test(prev.s) && prev.w >= maxW * 0.85 && /[A-Za-z0-9]$/.test(prev.s) && /^[A-Za-z0-9]/.test(t.s));
    out += (hard ? "" : " ") + t.s;
  });
  return out;
}
// keep the statement's own separator: "01-Sep-" + "2026" -> "01-Sep-2026"; "02 Sep" + "2026" -> "02 Sep 2026"; "01/08/" + "2026" -> "01/08/2026"
function joinDateYear(d, y){
  d = String(d || "").trim(); y = String(y || "").trim();
  if (/[-\/.]$/.test(d)) return d + y;
  const sep = (d.match(/[-\/.]/) || [" "])[0];
  return d + sep + y;
}
// The same on raw words, before columns are known: "01-Sep-" with "2026" just below it becomes "01-Sep-2026".
function joinWrappedDateItems(items){
  const partial = /^\d{1,2}[-\/. ]?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-\/. ]?$|^\d{1,2}[-\/.]\d{1,2}[-\/.]$/i;
  const out = items.slice(), used = new Set();
  out.forEach(t => {
    if (!partial.test(String(t.s || "").trim()) || bankDate(t.s)) return;
    const lh = Math.max(8, t.h || 10) * 2.6;
    const yr = out.filter(u => u !== t && !used.has(u) && /^(19|20)\d{2}$/.test(String(u.s).trim()) && t.y - u.y > 0.5 && t.y - u.y < lh && Math.abs(u.x - t.x) < Math.max(45, (t.w || 40)))
      .sort((a, b) => (t.y - a.y) - (t.y - b.y))[0];
    if (yr){ t.s = joinDateYear(t.s, yr.s); if (!bankDate(t.s)) return; used.add(yr); }
  });
  return out.filter(u => !used.has(u));
}
// A date wrapped over two lines in the date column is joined back together: "01-Sep-" above "2026".
function joinWrappedDates(tokens){
  const partial = /^\d{1,2}[-\/. ]?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-\/. ]?$|^\d{1,2}[-\/.]\d{1,2}[-\/.]?$/i;
  tokens.filter(t => t.k === "date" && partial.test(t.s) && !bankDate(t.s)).forEach(t => {
    const lh = Math.max(8, t.h || 10) * 2.6;
    const yr = tokens.filter(u => u !== t && !u.used && /^(19|20)?\d{2}$/.test(u.s) && t.y - u.y > 0.5 && t.y - u.y < lh && Math.abs(u.x - t.x) < 45)
      .sort((a, b) => (t.y - a.y) - (t.y - b.y))[0];
    if (yr){ const j = joinDateYear(t.s, yr.s); if (bankDate(j)){ t.s = j; yr.used = true; } }
  });
  for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].used) tokens.splice(i, 1);
}
async function parsePdfStatement(file){
  await ensurePdfJs();
  if (!window.pdfjsLib) throw {code: "pdf_unavailable"};
  let pdf;
  try { pdf = await pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise; }
  catch (e){ throw {code: /password/i.test(String(e && (e.name || e.message))) ? "pdf_password" : "pdf_broken"}; }
  let cols = null, textChars = 0, lastRow = null;
  const allRows = [], metaLines = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 400); p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    let raw = (tc.items || []).filter(it => it.str && it.str.trim()).map(it => ({s: it.str.replace(/\s+/g, " ").trim(), x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 8}));
    textChars += raw.reduce((a, it) => a + it.s.length, 0);
    // page numbers, "End of Statement" and similar footers
    const footY = raw.filter(it => /^page\s*\d+(\s*of(\s*\d+)?)?$/i.test(it.s) || /end\s*of\s*(the\s*)?statement/i.test(it.s)).map(it => it.y);
    raw = raw.filter(it => !footY.some(y => Math.abs(y - it.y) <= 2) && !/^-{4,}.*-{4,}$/.test(it.s));
    const hb = headerBand(raw);
    let body = raw;
    if (hb){
      if (!cols) raw.filter(it => it.y > hb.top).sort((a, b) => b.y - a.y || a.x - b.x).forEach(it => metaLines.push(it.s));
      cols = hb.cols;
      body = raw.filter(it => it.y < hb.bottom - 1);
    } else if (!cols){ raw.forEach(it => metaLines.push(it.s)); continue; }
    const tokens = [];
    body.forEach(it => splitPiece(it).forEach(t => { t.k = assignColumn(t, cols); if (t.k) tokens.push(t); }));
    joinWrappedDates(tokens);          // "01-Sep-" above "2026" (some ICICI statements) is one date
    const anchors = tokens.filter(t => t.k === "date" && bankDate(t.s)).sort((a, b) => b.y - a.y);
    const maxW = Math.max(1, ...tokens.filter(t => t.k === "narr").map(t => t.w));
    // centred cells (text above the date) or top-aligned cells (text runs down from the date)
    const centred = anchors.length && tokens.some(t => (t.k === "narr" || t.k === "ref") && t.y > anchors[0].y + 2 && anchors.length > 1 && t.y < anchors[0].y + (anchors[0].y - anchors[1].y) / 2);
    const rows = anchors.map(a => ({y: a.y, page: p, parts: {}}));
    tokens.forEach(t => {
      let r = null;
      if (!rows.length){ if (lastRow && !centred) r = lastRow; }
      else if (centred){
        let bi = -1, bd = 1e9;
        rows.forEach((x, i) => { const d = Math.abs(x.y - t.y); if (d < bd){ bd = d; bi = i; } });
        const x = rows[bi];
        const prevGap = bi > 0 ? rows[bi - 1].y - x.y : 40, nextGap = bi < rows.length - 1 ? x.y - rows[bi + 1].y : 40;
        if (bd <= Math.max((t.y > x.y ? prevGap : nextGap) * 0.75 + 2, 6)) r = x;
      } else {
        // the nearest date at or above this line; lines above the first date continue the previous page's last row
        for (const x of rows){ if (x.y >= t.y - 2){ r = x; } else break; }
        if (!r && lastRow && t.k !== "date") r = lastRow;
      }
      if (r) (r.parts[t.k] = r.parts[t.k] || []).push(t);
    });
    rows.forEach(r => { r.maxW = maxW; allRows.push(r); });
    if (rows.length) lastRow = rows[rows.length - 1];
  }
  if (textChars < 50) throw {code: "bank_scanned"};
  if (!cols) throw {code: "bank_no_header"};
  allRows.forEach(r => {
    r.cells = {};
    Object.keys(r.parts).forEach(k => {
      const ps = r.parts[k].sort((a, b) => b.y - a.y || a.x - b.x);
      if (k === "date" && ps.length > 1 && ps.every(t => bankDate(t.s))) r.cells.date = ps[0].s;
      else if (k === "date") r.cells.date = ps.find(t => bankDate(t.s)).s;
      else r.cells[k] = joinCell(k, ps, r.maxW);
    });
    r.text = Object.values(r.cells).join(" ");
  });
  const colIdx = {};
  cols.forEach(c => { if (c.k) colIdx[c.k] = c.k; });
  const meta = statementMeta(metaLines);
  const rows = rowsFromCells(allRows, colIdx, (r, k) => r.cells[k] || "", r => r.text);
  return {meta, rows, source: "pdf"};
}
/* ---------- reading any statement: headings first, then a heading-free reader, then OCR ---------- */
// Join pieces that a narrow column broke over two lines: "4,69,858." + "76", "16/Sep/20" + "25"
function mergeWrapped(items){
  const out = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const used = new Set();
  out.forEach((it, i) => {
    if (used.has(i)) return;
    const brokenAmt = /^[\d,]+\.\d?$/.test(it.s), brokenDate = /^\d{1,2}[\/\-][A-Za-z]{3}[\/\-]\d{2}$/.test(it.s) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2}$/.test(it.s);
    if (!brokenAmt && !brokenDate) return;
    for (let j = i + 1; j < out.length; j++){
      const n = out[j];
      if (it.y - n.y > it.h * 1.8) break;
      if (used.has(j) || n.y >= it.y) continue;
      const ok = brokenAmt ? /^\d{1,2}$/.test(n.s) && Math.abs((n.x + n.w) - (it.x + it.w)) < 12 : /^\d{2}$/.test(n.s) && Math.abs(n.x - it.x) < 6;
      if (ok){ it.s += n.s; it.w = Math.max(it.w, n.x + n.w - it.x); used.add(j); break; }
    }
  });
  return out.filter((_, i) => !used.has(i));
}
const TIME_TOKEN = /^\d{1,2}:\d{2}(:\d{2})?$|^(am|pm)$/i;
function fixOcrNumber(s){ return /^[\dOoIlS,.]+$/.test(s) && /\d/.test(s) && /[.,]/.test(s) ? s.replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/S/g, "5") : s; }
// Heading-free reader: a transaction line has a date on the left and amounts on the right; the balance is the right-most amount.
function parseByLines(pages){
  const rows = [], meta = [];
  let last = null, pageW = 600, curPage = 0;
  pages.forEach((pg, pi) => {
    curPage = pg.page || pi + 1;
    const markPage = r => { if (r && !r.page) r.page = curPage; };
    const items = mergeWrapped(joinWrappedDateItems(pg.items)).flatMap(it => splitPiece(it));
    if (!items.length) return;
    pageW = Math.max(...items.map(it => it.x + it.w), 200);
    const minX = Math.min(...items.map(it => it.x));
    const lines = [];
    items.forEach(it => {
      let ln = lines.find(l => Math.abs(l.y - it.y) <= Math.max(l.h, it.h) * 0.5);
      if (!ln){ ln = {y: it.y, h: it.h, items: []}; lines.push(ln); }
      ln.items.push(it);
    });
    lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
    lines.sort((a, b) => b.y - a.y);
    const leftLimit = minX + (pageW - minX) * 0.45, rightStart = minX + (pageW - minX) * 0.4;
    const isMoney = t => t.x > rightStart && MONEY_TOKEN.test(fixOcrNumber(t.s).replace(/\s/g, ""));
    const dayMon = (toks, i) => /^\d{1,2}$/.test(toks[i].s) && toks[i + 1] && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?$/i.test(toks[i + 1].s) && !(toks[i + 2] && /^\d{2,4}$/.test(toks[i + 2].s));
    // a date wrapped in its cell: "02 Sep" with "2026" on the line below
    lines.forEach((l, li) => {
      for (let i = 0; i < l.items.length && l.items[i].x < leftLimit; i++){
        const joined = /^\d{1,2}[\s\/\-.]*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[\/\-]?$/i.test(l.items[i].s) || /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]?$/.test(l.items[i].s);
        const splitMon = dayMon(l.items, i) || joined;
        if (!splitMon) continue;
        for (let k = li + 1; k < Math.min(lines.length, li + 3); k++){
          if (l.y - lines[k].y > l.h * 2.2) break;
          const yi = lines[k].items.findIndex(t => /^(19|20)\d{2}$/.test(t.s) && Math.abs(t.x - l.items[i].x) < Math.max(20, l.h * 2));
          if (yi >= 0){
            const y = lines[k].items.splice(yi, 1)[0];
            if (joined){ const t = l.items[i]; t.s = t.s.replace(/[\/\-.]$/, "") + (/[\/\-.]/.test(t.s) && !/[a-z]/i.test(t.s) ? "/" : " ") + y.s; t.w = Math.max(t.w, y.x + y.w - t.x); }
            else l.items.splice(i + 2, 0, Object.assign({}, y, {y: l.y}));
            break;
          }
        }
      }
    });
    // centred cells: a line with the date but no amounts, and a nearby line with amounts but no date, are one transaction
    const hasDate = l => l.items.some(t => t.x < leftLimit && (DATE_TOKEN.test(t.s) || bankDate(t.s)));
    const hasDate3 = l => hasDate(l) || l.items.some((t, i) => t.x < leftLimit && i + 2 < l.items.length && /^\d{1,2}$/.test(t.s) && bankDate(t.s + " " + l.items[i + 1].s + " " + l.items[i + 2].s));
    lines.forEach((l, li) => {
      if (!l.items.length || !hasDate3(l) || l.items.some(isMoney)) return;
      let best = -1, bd = 1e9;
      for (let k = Math.max(0, li - 2); k < Math.min(lines.length, li + 3); k++){
        if (k === li || !lines[k].items.some(isMoney) || hasDate3(lines[k])) continue;
        const d = Math.abs(lines[k].y - l.y);
        if (d < bd && d <= Math.max(l.h, lines[k].h) * 1.8){ bd = d; best = k; }
      }
      if (best >= 0){ l.items = l.items.concat(lines[best].items.map(t => Object.assign({}, t, {y: l.y}))).sort((a, b) => a.x - b.x); lines[best].items = []; }
    });
    const txLines = [];
    lines.forEach(l => {
      if (!l.items.length) return;
      const toks = l.items;
      let date = "", dateEnd = -1;
      for (let i = 0; i < toks.length && toks[i].x < leftLimit; i++){
        const one = bankDate(toks[i].s);
        const three = i + 2 < toks.length ? bankDate(toks[i].s + " " + toks[i + 1].s + " " + toks[i + 2].s) : "";
        if (one && (DATE_TOKEN.test(toks[i].s) || /^\d{1,2}\s+[a-z]{3,9}\.?,?\s+\d{2,4}$/i.test(toks[i].s))){ date = one; dateEnd = i; break; }
        if (three && /^\d{1,2}$/.test(toks[i].s) && /^\d{2,4}$/.test(toks[i + 2].s)){ date = three; dateEnd = i + 2; break; }
      }
      const money = toks.map((t, i) => ({t, i, v: isMoney(t) ? bankAmount(fixOcrNumber(t.s)) : null})).filter(m => m.v !== null);
      if (date && money.length && money[money.length - 1].t.x > minX + (pageW - minX) * 0.6){
        const firstMoney = money[0].i;
        const narr = toks.filter((t, i) => i > dateEnd && i < firstMoney && !DATE_TOKEN.test(t.s) && !TIME_TOKEN.test(t.s)).map(t => t.s).join(" ");
        const bal = money[money.length - 1];
        const after = toks[bal.i + 1];
        let balance = bal.v;
        if (after && /^dr\.?$/i.test(after.s)) balance = -Math.abs(balance);
        const amts = money.slice(0, -1).filter(m => Math.abs(m.v) > 0);
        const row = {y: l.y, date, narr, amts, balance, balRight: bal.t.x + bal.t.w, drcr: toks.slice(firstMoney).map(t => t.s).join(" "), page: pi, cont: []};
        row.page = curPage; txLines.push(row); rows.push(row); last = row;
      } else if (!date && !money.length){
        const text = toks.filter(t => !TIME_TOKEN.test(t.s)).map(t => t.s).join(" ");
        if (!rows.length && !txLines.length) meta.push(text);
        l.contText = text;
      } else if (!rows.length) meta.push(toks.map(t => t.s).join(" "));
    });
    // attach narration lines: to the transaction at or above (top-aligned), or the nearest one (centred)
    const conts = lines.filter(l => l.contText && txLines.length);
    const centred = conts.some(l => l.y > txLines[0].y + 2 && txLines.length > 1 && l.y < txLines[0].y + (txLines[0].y - txLines[1].y) / 2);
    lines.forEach(l => {
      if (!l.contText || /^page\s*\d+|statement\s*summary|end\s*of|opening\s*balance|closing\s*balance|^total|generated|this\s*is\s*a\s*(computer|system)/i.test(l.contText)) return;
      let target = null;
      if (centred){
        let bd = 1e9; txLines.forEach(t => { const d = Math.abs(t.y - l.y); if (d < bd){ bd = d; target = t; } });
        if (bd > Math.max(30, l.h * 2.2)) target = null;
      } else {
        for (const t of txLines){ if (t.y >= l.y - 2) target = t; else break; }
        if (!target && pi > 0 && rows.length && rows[rows.length - 1 - txLines.length]) target = rows[rows.length - 1 - txLines.length];
        if (target && target.y - l.y > 90 && target.page === pi) target = null;
      }
      if (target) target.cont.push({y: l.y, text: l.contText, page: pi});
    });
  });
  // direction from the balance movement; unknown rows by the column their amount sits in
  const out = [];
  rows.forEach(r => { r.cont.sort((a, b) => a.page - b.page || b.y - a.y); });
  let prevBal = null;
  const drEdges = [], crEdges = [];
  rows.forEach(r => {
    const amt = r.amts.length ? Math.abs(r.amts[r.amts.length - 1].v) : 0;
    let dir = "";
    if (prevBal !== null && amt && r.balance !== null && r.balance !== undefined){
      // banks often print an overdrawn balance without its minus sign
      for (const bal of [r.balance, -r.balance]){
        if (Math.abs(r2(prevBal - amt) - bal) <= 0.011){ dir = "dr"; r.balance = bal; break; }
        if (Math.abs(r2(prevBal + amt) - bal) <= 0.011){ dir = "cr"; r.balance = bal; break; }
      }
    }
    if (!dir && /\bdr\b/i.test(r.drcr) && !/\bcr\b/i.test(r.drcr.replace(/cr\s*$/i, ""))) dir = "";
    r.dir = dir; r.amt = amt;
    if (dir && r.amts.length){ const e = r.amts[r.amts.length - 1].t; (dir === "dr" ? drEdges : crEdges).push(e.x + e.w); }
    prevBal = r.balance;
  });
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const drE = med(drEdges), crE = med(crEdges);
  rows.forEach(r => {
    if (!r.dir && r.amts.length && drE !== null && crE !== null){
      const e = r.amts[r.amts.length - 1].t, x = e.x + e.w;
      r.dir = Math.abs(x - drE) <= Math.abs(x - crE) ? "dr" : "cr";
    }
    if (!r.dir && r.amts.length){ const t = r.amts[r.amts.length - 1].t.s; r.dir = /cr/i.test(t) ? "cr" : "dr"; }
    const narr = [r.narr].concat(r.cont.map(c => c.text)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    out.push({date: r.date, valueDate: "", narr, ref: "", page: r.page || curPage, debit: r.dir === "dr" ? r.amt : 0, credit: r.dir === "cr" ? r.amt : 0, balance: r.balance, noAmt: !r.amt});
  });
  // a missing amount may be filled from the balance change; a printed amount is never replaced
  for (let i = 1; i < out.length; i++){
    const r = out[i], prev = out[i - 1].balance, amt = r.debit || r.credit;
    const fits = amt && (Math.abs(r2(prev - r.debit + r.credit) - r.balance) <= 0.011);
    if (fits) continue;
    const next = out[i + 1];
    const nextOk = !next || (next.debit || next.credit) && Math.abs(r2(r.balance - next.debit + next.credit) - next.balance) <= 0.011 || (!next.debit && !next.credit);
    const diff = r2(r.balance - prev);
    if (!amt && diff && nextOk){ r.debit = diff < 0 ? -diff : 0; r.credit = diff > 0 ? diff : 0; r.repaired = true; continue; }
    // the printed amount disagrees with the balances: keep it, and make someone look
    if (amt) r.balWarn = true;
  }
  const kept = out.filter(r => r.debit || r.credit);
  return {rows: kept, meta: statementMeta(meta)};
}
// Excel/CSV without recognisable headings: each cell becomes a positioned piece
function sheetAsPages(grid){
  const items = [];
  grid.forEach((row, ri) => row.forEach((v, ci) => {
    let s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" ? (Number.isInteger(v) && Math.abs(v) > 20000 && Math.abs(v) < 80000 && window.XLSX ? bankDate(v) || v.toFixed(2) : v.toFixed(2)) : cellText(v);
    if (!s) return;
    items.push({s, x: ci * 100, y: 100000 - ri * 10, w: 90, h: 8});
  }));
  return [{items}];
}
/* ---------- OCR for scanned statements and photos: words with positions ---------- */
async function ocrWords(canvas){
  const eng = await getOcr();
  if (!eng) throw {code: "ocr_not_working"};
  if (!eng.tsv) throw {code: "ocr_no_positions"};
  return eng.tsv(canvas);
}
async function statementImages(file, onPage){
  await ensurePdfJs();
  const canvases = [];
  if (isPdf(file)){
    const pdf = await pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
    for (let p = 1; p <= Math.min(pdf.numPages, 60); p++){
      const page = await pdf.getPage(p);
      const vp0 = page.getViewport({scale: 1});
      const vp = page.getViewport({scale: Math.min(4, 2400 / Math.max(vp0.width, vp0.height))});
      const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      await page.render({canvasContext: g, viewport: vp}).promise;
      canvases.push(c);
      if (onPage) onPage(p, pdf.numPages);
    }
  } else canvases.push(await imageToCanvas(file));
  return canvases;
}
async function parseScannedStatement(file, progress, engine){
  const canvases = await statementImages(file);
  const pages = [];
  for (let i = 0; i < canvases.length; i++){
    if (progress) progress((engine === "google" ? "Google OCR: page " : "Reading page ") + (i + 1) + " of " + canvases.length + "…");
    const c = canvases[i];
    const src = cropCanvas(c, 0, 0, c.width, c.height);
    if (engine !== "google") enhanceCanvas(src);
    const words = engine === "google" ? await googleWords(src) : await ocrWords(src);
    pages.push({items: words.filter(w => w.conf > 20 && w.s.trim()).map(w => ({s: fixOcrNumber(w.s.trim()), x: w.x, y: src.height - w.y - w.h, w: w.w, h: w.h})), ocr: true});
  }
  return pages;
}
// headings reader on already-positioned pages (used for OCR words)
function parseByHeadings(pages){
  let cols = null, lastRow = null;
  const allRows = [], metaLines = [];
  pages.forEach((pg, pgi) => {
    const pageNo = pg.page || pgi + 1;
    const raw = joinWrappedDateItems(pg.ocr ? joinOcrWords(pg.items) : pg.items);
    const hb = headerBand(raw);
    let body = raw;
    if (hb){ if (!cols) raw.filter(it => it.y > hb.top).forEach(it => metaLines.push(it.s)); cols = hb.cols; body = raw.filter(it => it.y < hb.bottom - 1); }
    else if (!cols){ raw.forEach(it => metaLines.push(it.s)); return; }
    const tokens = [];
    mergeWrapped(body).forEach(it => splitPiece(it).forEach(t => { t.k = assignColumn(t, cols); if (t.k) tokens.push(t); }));
    joinWrappedDates(tokens);          // "01-Sep-" above "2026" (some ICICI statements) is one date
    const anchors = tokens.filter(t => t.k === "date" && bankDate(t.s)).sort((a, b) => b.y - a.y);
    const rows = anchors.map(a => ({y: a.y, page: pageNo, parts: {}}));
    tokens.forEach(t => {
      let r = null;
      for (const x of rows){ if (x.y >= t.y - t.h * 0.6) r = x; else break; }
      if (!r && !rows.length) r = lastRow;
      if (r) (r.parts[t.k] = r.parts[t.k] || []).push(t);
    });
    rows.forEach(r => { r.page = pageNo; allRows.push(r); });
    if (rows.length) lastRow = rows[rows.length - 1];
  });
  if (!cols) return null;
  allRows.forEach(r => {
    r.cells = {};
    Object.keys(r.parts).forEach(k => {
      const ps = r.parts[k].sort((a, b) => b.y - a.y || a.x - b.x);
      r.cells[k] = k === "date" ? (ps.find(t => bankDate(t.s)) || ps[0]).s : joinCell(k, ps, 1e9);
    });
    r.text = Object.values(r.cells).join(" ");
  });
  const colIdx = {}; cols.forEach(c => { if (c.k) colIdx[c.k] = c.k; });
  return {rows: rowsFromCells(allRows, colIdx, (r, k) => r.cells[k] || "", r => r.text), meta: statementMeta(metaLines)};
}
// OCR gives single words: join words on one line that sit close together into phrases
function joinOcrWords(items){
  const lines = [];
  items.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(it => {
    let ln = lines.find(l => Math.abs(l.y - it.y) <= Math.max(l.h, it.h) * 0.5);
    if (!ln){ ln = {y: it.y, h: it.h, items: []}; lines.push(ln); }
    ln.items.push(it);
  });
  const out = [];
  lines.forEach(l => {
    l.items.sort((a, b) => a.x - b.x);
    let cur = null;
    l.items = l.items.filter(it => !/^[|¦!\[\]_]+$/.test(it.s)).map(it => Object.assign({}, it, {s: it.s.replace(/^[|¦]+\s*|\s*[|¦]+$/g, "")})).filter(it => it.s);
    l.items.forEach(it => {
      const numeric = MONEY_TOKEN.test(it.s) || DATE_TOKEN.test(it.s) || /^\d{1,2}$/.test(it.s) || /^(19|20)\d{2}$/.test(it.s) || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?$/i.test(it.s);
      if (cur && !numeric && !cur.numeric && it.x - (cur.x + cur.w) < Math.max(it.h, cur.h) * 0.9){ cur.s += " " + it.s; cur.w = it.x + it.w - cur.x; }
      else { cur = Object.assign({}, it, {numeric}); out.push(cur); }
    });
  });
  return out;
}
function scoreParse(p){
  if (!p || !p.rows || !p.rows.length) return -1;
  const rows = p.rows.map(r => Object.assign({}, r));
  const meta = Object.assign({}, p.meta);
  const chk = checkBalances(rows, meta);
  return rows.length - chk.bad * 3;
}
// Try every reader and keep the one whose rows agree best with the running balance
