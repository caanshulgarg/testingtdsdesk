/* ================================================================== */
/* Documents in the firm account: shrunk, uploaded in the background, */
/* opened from any computer, and cleared out after the kept period.   */
/* ================================================================== */
const CloudDocs = {
  queue: [], busy: false, max: 24 * 1024 * 1024,
  on(){ return !!(Cloud.on() && S.account && S.firm.cloudDocs !== false); },
  path(cid, id, name){
    const safe = String(name || "document").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    return Cloud.st.firm + "/" + cid + "/" + id + "-" + safe;
  },
  // a phone photo of a bill is shrunk to reading size before it goes up
  async shrink(file){
    if (!isImage(file) || file.size < 400 * 1024) return file;
    try {
      const c = await imageToCanvas(file);
      const k = Math.min(1, 1800 / Math.max(c.width, c.height));
      const out = k < 1 ? cropCanvas(c, 0, 0, c.width, c.height) : c;
      if (k < 1){
        const cv = document.createElement("canvas");
        cv.width = Math.round(c.width * k); cv.height = Math.round(c.height * k);
        cv.getContext("2d").drawImage(c, 0, 0, cv.width, cv.height);
        const blob = await new Promise(res => cv.toBlob(res, "image/jpeg", 0.82));
        if (blob && blob.size < file.size) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {type: "image/jpeg"});
      }
      const blob = await new Promise(res => (out.toBlob ? out : c).toBlob(res, "image/jpeg", 0.82));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {type: "image/jpeg"}) : file;
    } catch (e){ return file; }
  },
  add(cid, id, file, kind){
    if (!this.on() || !file || file.size > this.max) return;
    this.queue.push({cid, id, file, kind, tries: 0});
    if (!this.busy) setTimeout(() => this.run(), 300);        // after the reading, never in its way
  },
  async run(){
    if (this.busy) return;
    this.busy = true;
    const tick = setInterval(() => { if (S.view === "company" && ["txn", "invoices"].includes(S.tab)) softRender(); }, 1200);
    while (this.queue.length){
      const job = this.queue[0];
      try {
        const small = await this.shrink(job.file);
        const path = this.path(job.cid, job.id, small.name);
        const c = Cloud.cfg(), s = Cloud.sess();
        const url = c.url.replace(/\/+$/, "") + "/storage/v1/object/client-docs/" + path.split("/").map(encodeURIComponent).join("/");
        let r = await fetch(url, {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "x-upsert": "true", "Content-Type": small.type || "application/octet-stream"}, body: small});
        if (r.status === 401){ await Cloud.refreshToken(); r = await fetch(url, {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token, "x-upsert": "true", "Content-Type": small.type || "application/octet-stream"}, body: small}); }
        if (!r.ok) throw new Error("upload " + r.status);
        this.note(job, path, small.size);
        this.queue.shift();
      } catch (e){
        job.tries++;
        if (job.tries >= 3){ this.queue.shift(); }            // it stays on this computer; nothing is lost
        else await new Promise(res => setTimeout(res, 4000));
      }
    }
    this.busy = false;
    clearInterval(tick);
    if (S.view === "company") softRender();
  },
  // remember where it went, on the record itself, so any computer can open it
  note(job, path, size){
    if (job.kind === "bill"){
      const e = (S.data[job.cid] || {entries: {}}).entries[job.id];
      if (e){ e.docPath = path; e.docSize = size; Store.saveEntry(job.cid, e); }
    } else if (job.kind === "sale"){
      const s = SL();
      const v = s && s.cid === job.cid ? s.list.find(x => "sv:" + x.id === job.id) : null;
      if (v){ v.docPath = path; v.docSize = size; saveSales(); }
    } else if (job.kind === "stmt"){
      const b = S.bank, id = job.id.replace(/^st:/, "");
      const st = b && b.cid === job.cid ? (b.stmts || []).find(x => x.id === id) : null;
      if (st){ st.docPath = path; st.docSize = size; saveBank({stmts: true}); }
    }
  },
  async fetchFile(path, name){
    const c = Cloud.cfg(), s = Cloud.sess();
    const url = c.url.replace(/\/+$/, "") + "/storage/v1/object/client-docs/" + path.split("/").map(encodeURIComponent).join("/");
    let r = await fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + s.access_token}});
    if (r.status === 401){ await Cloud.refreshToken(); r = await fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token}}); }
    if (!r.ok) throw {code: "doc_missing", message: "the document could not be fetched (" + r.status + ")"};
    const blob = await r.blob();
    return new File([blob], name || path.split("-").slice(1).join("-") || "document", {type: blob.type || "application/octet-stream"});
  },
  async remove(path){
    if (!path || !this.on()) return;
    try {
      const c = Cloud.cfg(), s = Cloud.sess();
      await fetch(c.url.replace(/\/+$/, "") + "/storage/v1/object/client-docs/" + path.split("/").map(encodeURIComponent).join("/"),
        {method: "DELETE", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token}});
    } catch (e){}
  },
  // documents older than the period the firm keeps
  // documents already on this computer that never went up: after an update, or after being offline
  async pending(cid){
    const out = [];
    const d = S.data[cid];
    if (!d || !d.loaded) return out;
    const idx = await FileStore.index(cid);
    Object.values(d.entries).forEach(e => {
      if (e.docPath || e.status === "rejected" || e.status === "duplicate") return;
      if (idx.has(e.id)) out.push({id: e.id, kind: "bill", name: e.fileName || ""});
    });
    return out;
  },
  async sendPending(cid){
    const list = await this.pending(cid);
    if (!list.length){ toast("Every document for this client is already in the firm account."); return; }
    for (const it of list){
      const f = await FileStore.get(cid, it.id);
      if (f) this.add(cid, it.id, f, it.kind);
    }
    toast("Sending " + list.length + " document" + (list.length === 1 ? "" : "s") + " to the firm account\u2026");
    render();
  },
  async oldOnes(years){
    const cut = new Date(); cut.setFullYear(cut.getFullYear() - num(years || 3));
    const out = [];
    Object.values(S.companies).forEach(co => {
      const d = S.data[co.id];
      if (!d || !d.loaded) return;
      Object.values(d.entries).forEach(e => {
        const when = e.x.invoiceDate || (e.createdAt || "").slice(0, 10);
        if (e.docPath && when && when < cut.toISOString().slice(0, 10)) out.push({cid: co.id, id: e.id, path: e.docPath, when, what: (e.x.vendorName || e.fileName || "")});
      });
    });
    return out;
  }
};

const Store = {
  db:null, chains:{}, lsTimer:null,
  async init(){
    let db = null;
    try { db = window.claude && window.claude.use ? await window.claude.use("db") : null; } catch(e){ db = null; }
    if (db){ this.db = db; S.storeKind = "db"; return; }
    try { if (typeof indexedDB !== "undefined" && await IDBStore.open()){ S.storeKind = "idb"; return; } } catch (e){}
    try { localStorage.setItem("tdsdesk:probe", "1"); localStorage.removeItem("tdsdesk:probe"); S.storeKind = "local"; }
    catch(e){ S.storeKind = "memory"; }
  },
  async loadFirm(){
    if (S.storeKind === "db"){
      const [firm, cos, inbox] = await Promise.all([
        this.db.doc("config/firm").get(),
        this.db.collection("companies").limit(1000).get(),
        this.db.collection("inbox").limit(500).get()
      ]);
      S.firm = Object.assign(clone(DEFAULT_FIRM), firm.exists ? clone(firm.data()) : {});
      cos.docs.forEach(d => { S.companies[d.id] = fixCompany(clone(d.data())); });
      inbox.docs.forEach(d => { S.inbox[d.id] = clone(d.data()); });
      if (!cos.docs.length) await this.migrateDb();
    } else if (S.storeKind === "idb"){
      const firm = await IDBStore.get("config/firm");
      const cos = (await IDBStore.prefix("companies/")).filter(([k]) => k.split("/").length === 2);
      if (!firm && !cos.length && (localStorage.getItem("tdsdesk:v2") || localStorage.getItem("tdsdesk:v1"))){ await this.moveFromLocal(); return; }
      S.firm = Object.assign(clone(DEFAULT_FIRM), firm || {});
      cos.forEach(([k, c]) => { S.companies[c.id || k.split("/")[1]] = fixCompany(c); });
      (await IDBStore.prefix("inbox/")).forEach(([k, i]) => { S.inbox[i.id || k.split("/")[1]] = i; });
      // the old copy is kept for a week after a move, then removed
      try { const m = JSON.parse(localStorage.getItem("tdsdesk:v2:moved") || "null"); if (m && Date.now() - new Date(m.at).getTime() > 7 * 86400000){ localStorage.removeItem("tdsdesk:v2"); localStorage.removeItem("tdsdesk:v1"); localStorage.removeItem("tdsdesk:v2:moved"); } } catch (e){}
    } else if (S.storeKind === "local"){
      let v2 = null;
      try { v2 = JSON.parse(localStorage.getItem("tdsdesk:v2") || "null"); } catch(e){ v2 = null; }
      if (v2){
        S.firm = Object.assign(clone(DEFAULT_FIRM), v2.firm || {});
        Object.values(v2.companies || {}).forEach(c => { S.companies[c.id] = fixCompany(c); });
        S.inbox = v2.inbox || {};
        Object.entries(v2.data || {}).forEach(([cid, d]) => { S.data[cid] = {parties:d.parties || {}, entries:d.entries || {}, loaded:true}; });
      } else {
        S.firm = clone(DEFAULT_FIRM);
        let v1 = null;
        try { v1 = JSON.parse(localStorage.getItem("tdsdesk:v1") || "null"); } catch(e){ v1 = null; }
        if (v1 && (Object.keys(v1.entries || {}).length || Object.keys(v1.parties || {}).length)){
          this.adoptLegacy(v1.settings || {}, v1.parties || {}, v1.entries || {});
          this.saveLocal();
        }
      }
    } else {
      S.firm = clone(DEFAULT_FIRM);
    }
  },
  // Move everything from the browser's small storage into its database, check it all arrived, and keep the old copy a week.
  async moveFromLocal(){
    toast("Moving your saved work to this browser\u2019s database\u2026");
    let v2 = null;
    try { v2 = JSON.parse(localStorage.getItem("tdsdesk:v2") || "null"); } catch (e){ v2 = null; }
    if (v2){
      S.firm = Object.assign(clone(DEFAULT_FIRM), v2.firm || {});
      Object.values(v2.companies || {}).forEach(c => { S.companies[c.id] = fixCompany(c); });
      S.inbox = v2.inbox || {};
      Object.entries(v2.data || {}).forEach(([cid, d]) => { S.data[cid] = {parties: d.parties || {}, entries: d.entries || {}, loaded: true}; });
    } else {
      S.firm = clone(DEFAULT_FIRM);
      let v1 = null;
      try { v1 = JSON.parse(localStorage.getItem("tdsdesk:v1") || "null"); } catch (e){ v1 = null; }
      if (v1) this.adoptLegacy(v1.settings || {}, v1.parties || {}, v1.entries || {});
    }
    const pairs = [["config/firm", clone(S.firm)]];
    Object.values(S.companies).forEach(c => pairs.push(["companies/" + c.id, clone(c)]));
    Object.values(S.inbox || {}).forEach(i => pairs.push(["inbox/" + i.id, clone(i)]));
    let bills = 0;
    Object.entries(S.data).forEach(([cid, d]) => {
      Object.values(d.parties || {}).forEach(pt => pairs.push(["companies/" + cid + "/parties/" + pt.id, clone(pt)]));
      Object.values(d.entries || {}).forEach(e => { pairs.push(["companies/" + cid + "/entries/" + e.id, clone(e)]); bills++; });
    });
    try {
      await IDBStore.write(pairs);
      const back = (await IDBStore.prefix("companies/")).filter(([k]) => /\/entries\//.test(k)).length;
      if (back < bills) throw new Error("only " + back + " of " + bills + " bills arrived");
      localStorage.setItem("tdsdesk:v2:moved", JSON.stringify({at: new Date().toISOString(), bills, clients: Object.keys(S.companies).length}));
      toast("Moved " + bills + " bill" + (bills === 1 ? "" : "s") + " and " + Object.keys(S.companies).length + " client" + (Object.keys(S.companies).length === 1 ? "" : "s") + " to this browser\u2019s database.");
    } catch (e){
      // could not move: carry on with the old storage, nothing lost
      S.storeKind = "local";
      toast("Your work stays in the older storage for now (" + (e.message || e.name || "move failed") + ").");
    }
  },
  // The first version kept one company's data at the top level. Move it into a client.
  adoptLegacy(settings, parties, entries){
    S.firm.firmName = settings.firmName || S.firm.firmName;
    S.firm.rules = settings.rules || {};
    const co = newCompany({
      name: settings.companyName || "My first client", tallyName: settings.companyName || "",
      turnover10cr: settings.buyerTurnoverAbove10Cr, voucherType: settings.voucherType,
      createOptional: settings.createOptional, billwise: settings.billwise, gst: settings.gst,
      roundOff: settings.roundOff, tdsLedgers: settings.tdsLedgers, expenseLedgers: settings.expenseLedgers
    });
    S.companies[co.id] = co;
    S.data[co.id] = {parties: parties, entries: entries, loaded: true};
    return co;
  },
  async migrateDb(){
    const [cfg, ps, es] = await Promise.all([
      this.db.doc("config/settings").get(),
      this.db.collection("parties").limit(1000).get(),
      this.db.collection("entries").limit(1000).get()
    ]);
    if (!cfg.exists && !ps.docs.length && !es.docs.length) return;
    const parties = {}, entries = {};
    ps.docs.forEach(d => { parties[d.id] = clone(d.data()); });
    es.docs.forEach(d => { entries[d.id] = clone(d.data()); });
    const co = this.adoptLegacy(cfg.exists ? clone(cfg.data()) : {}, parties, entries);
    this.saveFirm();
    this.saveCompany(co);
    Object.values(parties).forEach(p => this.saveParty(co.id, p));
    Object.values(entries).forEach(e => this.saveEntry(co.id, e));
    // remove the old copies only after the new ones are written
    await Promise.all(Object.values(this.chains));
    if (!this.failed){
      ps.docs.forEach(d => this.put("parties/" + d.id, null));
      es.docs.forEach(d => this.put("entries/" + d.id, null));
      if (cfg.exists) this.put("config/settings", null);
    }
    toast("Your earlier invoices were moved into the client \u201c" + co.name + "\u201d. Rename it in Company settings.");
  },
  async loadCompany(cid){
    if (S.data[cid] && S.data[cid].loaded) return;
    if (S.storeKind === "idb"){
      const base = "companies/" + cid;
      const [ps, es] = await Promise.all([IDBStore.prefix(base + "/parties/"), IDBStore.prefix(base + "/entries/")]);
      const d = {parties: {}, entries: {}, loaded: true};
      ps.forEach(([k, v]) => { d.parties[v.id || k.split("/").pop()] = v; });
      es.forEach(([k, v]) => { d.entries[v.id || k.split("/").pop()] = v; });
      // anything already added in this session (for example by the sync) stays
      const cur = S.data[cid];
      if (cur){ Object.assign(d.parties, cur.parties || {}); Object.assign(d.entries, cur.entries || {}); }
      S.data[cid] = d;
      return;
    }
    if (S.storeKind !== "db"){ S.data[cid] = S.data[cid] || {parties:{}, entries:{}, loaded:true}; return; }
    const base = "companies/" + cid;
    const [ps, es] = await Promise.all([
      this.db.collection(base + "/parties").limit(1000).get(),
      this.db.collection(base + "/entries").orderBy("createdAt", "desc").limit(1000).get()
    ]);
    const d = {parties:{}, entries:{}, loaded:true};
    ps.docs.forEach(x => { d.parties[x.id] = clone(x.data()); });
    es.docs.forEach(x => { d.entries[x.id] = clone(x.data()); });
    S.data[cid] = d;
  },
  put(path, obj){
    if (S.storeKind === "db"){
      const body = obj ? clone(obj) : null;
      this.chains[path] = (this.chains[path] || Promise.resolve()).then(async () => {
        const ref = this.db.doc(path);
        if (body) await ref.set(body); else await ref.delete();
      }).catch(e => {
        this.failed = true;
        toast(e && e.code === "quota_exceeded"
          ? "Storage is full. Download the register, then clear sent invoices in Send to Tally."
          : "A change could not be saved. Check your connection and try again.");
      });
    } else if (S.storeKind === "idb"){
      // each record is written on its own, in the background, in order: nothing waits, nothing is rewritten in full
      const body = obj ? clone(obj) : null;
      this.chains[path] = (this.chains[path] || Promise.resolve()).then(() => IDBStore.write([[path, body]])).catch(e => {
        this.failed = true;
        toast(e && /quota/i.test(e.name || e.message || "") ? "This browser\u2019s storage is full. Download the register, then clear sent invoices." : "A change could not be saved on this computer. Reload the page and try again.");
      });
    } else if (S.storeKind === "local"){
      clearTimeout(this.lsTimer);
      this.lsTimer = setTimeout(() => this.saveLocal(), 300);
    }
  },
  saveLocal(){
    try {
      localStorage.setItem("tdsdesk:v2", JSON.stringify({firm:S.firm, companies:S.companies, inbox:S.inbox,
        data:Object.fromEntries(Object.entries(S.data).map(([k, v]) => [k, {parties:v.parties, entries:v.entries}]))}));
    } catch(e){ toast("This browser's storage is full. Download the register and clear sent invoices."); }
  },
  saveFirm(){ this.put("config/firm", S.firm); },
  saveCompany(c){ this.put("companies/" + c.id, c); },
  saveParty(cid, p){ this.put("companies/" + cid + "/parties/" + p.id, p); },
  saveEntry(cid, e){ this.put("companies/" + cid + "/entries/" + e.id, e); },
  deleteEntry(cid, id){ this.put("companies/" + cid + "/entries/" + id, null); },
  deleteParty(cid, id){ this.put("companies/" + cid + "/parties/" + id, null); },
  saveInbox(i){ this.put("inbox/" + i.id, i); },
  deleteInbox(id){ this.put("inbox/" + id, null); },
  async deleteCompany(cid){
    await this.loadCompany(cid);
    const d = S.data[cid];
    Object.keys(d.parties).forEach(id => this.deleteParty(cid, id));
    Object.keys(d.entries).forEach(id => this.deleteEntry(cid, id));
    this.put("companies/" + cid, null);
    delete S.data[cid]; delete S.companies[cid];
    if (S.storeKind === "local") this.saveLocal();
  }
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function clone(o){ return JSON.parse(JSON.stringify(o === undefined ? null : o)); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function xesc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&#34;","'":"&#39;"}[c])); }
function num(v){ if (typeof v === "number") return isFinite(v) ? v : 0; const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
function r2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
const INR = new Intl.NumberFormat("en-IN", {minimumFractionDigits:2, maximumFractionDigits:2});
const INR0 = new Intl.NumberFormat("en-IN", {maximumFractionDigits:0});
function money(n){ return "₹" + INR.format(num(n)); }
function money0(n){ return "₹" + INR0.format(num(n)); }
function uid(p){ return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function norm(s){ return String(s || "").toLowerCase().replace(/\b(m\/s|messrs|pvt|private|ltd|limited|llp|the)\b/g, "").replace(/[^a-z0-9]/g, ""); }
function slug(s){ return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client"; }
function fyOf(d){
  let dt = d ? new Date(d + "T00:00:00") : new Date();
  if (isNaN(dt)) dt = new Date();
  const y = dt.getFullYear(), s = dt.getMonth() >= 3 ? y : y - 1;
  return s + "-" + String((s + 1) % 100).padStart(2, "0");
}
S.partyFy = fyOf(null);
function fmtDate(d){ if (!d) return "—"; const dt = new Date(String(d).slice(0, 10) + "T00:00:00"); return isNaN(dt) ? d : dt.toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"}); }
function effectivePan(x){
  const pan = String(x.vendorPan || "").toUpperCase().trim();
  if (PAN_RE.test(pan)) return pan;
  const g = String(x.vendorGstin || "").toUpperCase().trim();
  if (GSTIN_RE.test(g)) return g.slice(2, 12);
  return "";
}
let toastTimer;
function toast(msg){ const t = document.getElementById("toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 4500); }
function byDate(a, b){ return String(a.x.invoiceDate || a.createdAt).localeCompare(String(b.x.invoiceDate || b.createdAt)); }
function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
function lsDel(k){ try { localStorage.removeItem(k); } catch(e){} }

/* ------------------------------------------------------------------ */
/* Preparing pages for reading. Claude sees each image at about 1.2    */
/* megapixels, so handwritten pages are also sent as close-up strips.  */
/* ------------------------------------------------------------------ */
const libLoads = {};
function loadScriptOnce(name){
  if (!libLoads[name]) libLoads[name] = new Promise((res, rej) => {
    const el = document.createElement("script");
    el.src = window.TDS_ASSETS + name; el.async = false;
    el.onload = () => res(); el.onerror = () => { delete libLoads[name]; rej({code: "lib_missing", message: name + " could not be loaded"}); };
    document.head.appendChild(el);
  });
  return libLoads[name];
}
async function ensurePdfJs(){
  if (window.pdfjsLib || !window.TDS_ASSETS) return;
  await loadScriptOnce("pdfjs-lib.js"); await loadScriptOnce("pdfjs-worker.js");
}
async function ensureXlsx(){
  if (window.XLSX || !window.TDS_ASSETS) return;
  await loadScriptOnce("xlsx.js");
}
const pdfCache = new Map();
async function getPdf(file){
  await ensurePdfJs();
  if (!window.pdfjsLib) throw {code:"pdf_unavailable"};
  if (!pdfCache.has(file)){
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdfCache.set(file, file.arrayBuffer().then(buf => window.pdfjsLib.getDocument({data:new Uint8Array(buf), isEvalSupported:false}).promise)
      .catch(() => { pdfCache.delete(file); throw {code:"pdf_broken"}; }));
  }
  return pdfCache.get(file);
}
// pdf.js gives text pieces with positions; rebuild them into lines, left to right.
function pageTextLines(tc){
  const rows = [];
  for (const it of tc.items || []){
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
    let row = rows.find(r => Math.abs(r.y - y) <= Math.max(r.h, h) * 0.5);
    if (!row){ row = {y, h, items: []}; rows.push(row); }
    row.items.push({x, s: it.str, w: it.width || 0});
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let line = "", end = null;
    for (const it of r.items){
      if (end !== null) line += it.x - end > r.h * 1.5 ? "   " : (it.x - end > r.h * 0.15 ? " " : "");
      line += it.s;
      end = it.x + it.w;
    }
    return line.replace(/[ \t]+/g, " ").trim();
  }).join("\n");
}
// pages: list of 1-based page numbers
async function pdfPages(file, pages){
  const pdf = await getPdf(file);
  let text = ""; const canvases = [];
  for (const i of pages.filter(n => n >= 1 && n <= pdf.numPages)){
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    text += pageTextLines(tc) + "\n";
    const vp0 = page.getViewport({scale:1});
    const vp = page.getViewport({scale: Math.min(3.5, 2600 / Math.max(vp0.width, vp0.height))});
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({canvasContext:g, viewport:vp}).promise;
    canvases.push(c);
  }
  return {text: text.trim().slice(0, 14000), canvases, pageCount: pdf.numPages};
}
async function loadImageSource(file){
  try { return await createImageBitmap(file, {imageOrientation:"from-image"}); } catch (e){}
  try { return await createImageBitmap(file); } catch (e){}
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    if (img.decode) await img.decode(); else await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; });
    return {img, url};
  } catch (e){
    URL.revokeObjectURL(url);
    throw {code: /hei[cf]/i.test((file.type || "") + file.name) ? "heic" : "image_rejected"};
  }
}
async function imageToCanvas(file){
  const srcObj = await loadImageSource(file);
  const el = srcObj.img || srcObj, url = srcObj.url;
  const W = el.naturalWidth || el.width, H = el.naturalHeight || el.height;
  if (!W || !H){ if (url) URL.revokeObjectURL(url); throw {code:"image_rejected"}; }
  const k = Math.min(1, 3000 / Math.max(W, H));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(el, 0, 0, c.width, c.height);
  if (el.close) el.close();
  if (url) URL.revokeObjectURL(url);
  return c;
}
function cropCanvas(src, x, y, w, h){
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}
// Grey scale with a contrast stretch: helps faint pen, pencil and carbon copies.
function enhanceCanvas(c){
  const g = c.getContext("2d");
  let img;
  try { img = g.getImageData(0, 0, c.width, c.height); } catch (e){ return c; }
  const d = img.data, hist = new Uint32Array(256), total = c.width * c.height;
  for (let i = 0; i < d.length; i += 4){ const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
  let lo = 0, hi = 255, acc = 0;
  while (lo < 254 && (acc += hist[lo]) < total * 0.01) lo++;
  acc = 0;
  while (hi > lo + 1 && (acc += hist[hi]) < total * 0.02) hi--;
  if (hi - lo < 40){ lo = 0; hi = 255; }
  const span = hi - lo;
  for (let i = 0; i < d.length; i += 4){
    let v = (d[i] - lo) * 255 / span;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// Trim empty paper around the writing, so close-ups cover text rather than margins.
function trimToContent(src){
  const k = Math.min(1, 400 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.drawImage(src, 0, 0, w, h);
  let d;
  try { d = g.getImageData(0, 0, w, h).data; } catch (e){ return src; }
  const lum = new Uint8Array(w * h), hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++){ const y = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0; lum[i] = y; hist[y]++; }
  let acc = 0, paper = 255;
  for (let v = 255; v >= 0; v--){ acc += hist[v]; if (acc >= w * h * 0.5){ paper = v; break; } }
  const ink = paper - 45, rows = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lum[y * w + x] < ink){ rows[y]++; cols[x]++; }
  const band = (arr, len, other) => { let a = 0, b = len - 1; while (a < len && arr[a] < other * 0.01) a++; while (b > a && arr[b] < other * 0.01) b--; return [a, b]; };
  const [y0, y1] = band(rows, h, w), [x0, x1] = band(cols, w, h);
  if (y1 - y0 < h * 0.15 || x1 - x0 < w * 0.15) return src;
  const m = 0.03, X0 = Math.max(0, (x0 / w - m)), Y0 = Math.max(0, (y0 / h - m)), X1 = Math.min(1, (x1 + 1) / w + m), Y1 = Math.min(1, (y1 + 1) / h + m);
  if ((X1 - X0) * (Y1 - Y0) > 0.9) return src;
  return cropCanvas(src, Math.round(X0 * src.width), Math.round(Y0 * src.height), Math.round((X1 - X0) * src.width), Math.round((Y1 - Y0) * src.height));
}
// n overlapping horizontal strips, top to bottom, so each text line stays whole.
// A short, wide writing area needs fewer strips.
function stripsOf(src, n){
  if (src.width > src.height * 1.2) n = Math.max(1, Math.min(n, 2));
  const L = src.height, size = Math.min(L, Math.ceil(L / n * 1.15)), out = [];
  for (let i = 0; i < n; i++){
    const start = n === 1 ? 0 : Math.round(i * (L - size) / (n - 1));
    out.push(enhanceCanvas(cropCanvas(src, 0, start, src.width, size)));
  }
  return out;
}
function canvasJpeg(c, maxSide, q){
  let src = c;
  const k = Math.min(1, maxSide / Math.max(c.width, c.height));
  if (k < 1){ src = document.createElement("canvas"); src.width = Math.round(c.width * k); src.height = Math.round(c.height * k); src.getContext("2d").drawImage(c, 0, 0, src.width, src.height); }
  return new Promise(r => src.toBlob(b => r(b), "image/jpeg", q || 0.88));
}
// Size an image for the engine in use. Through your own API key, Sonnet 5 and Opus 5
// read up to 2576 px on the long edge and 4784 visual tokens (28 x 28 px each).
function fitScale(w, h, maxEdge, maxTok){
  let k = Math.min(1, maxEdge / Math.max(w, h));
  while (k > 0.05 && Math.ceil(w * k / 28) * Math.ceil(h * k / 28) > maxTok) k *= 0.97;
  return k;
}
function imgBlob(c, kind){
  if (S.engine === "api"){
    const k = fitScale(c.width, c.height, 2576, 4700);
    return canvasJpeg(c, Math.max(c.width, c.height) * k, 0.9);
  }
  return canvasJpeg(c, kind === "strip" ? 2200 : 1800);
}
// Page 1 in full plus close-ups, then further pages in full, within the per-call limit.
async function buildImageSet(canvases, careful){
  const max = S.imgMax, out = [];
  if (!max || !canvases.length) return out;
  if (max === 1){
    out.push(await imgBlob(enhanceCanvas(trimToContent(canvases[0])), "strip"));
    return out.filter(Boolean);
  }
  const stripCount = max >= 4 ? (careful ? 3 : 2) : max >= 3 ? 2 : 0;
  out.push(await imgBlob(canvases[0], "page"));
  if (stripCount) for (const st of stripsOf(trimToContent(canvases[0]), stripCount)) out.push(await imgBlob(st, "strip"));
  else out.push(await imgBlob(enhanceCanvas(trimToContent(canvases[0])), "strip"));
  for (let i = 1; i < canvases.length && out.length < max; i++) out.push(await imgBlob(canvases[i], "page"));
  return out.slice(0, max).filter(Boolean);
}

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8){ let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipOne(name, text){
  const enc = new TextEncoder(), nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data);
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2));
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const lh = new DataView(new ArrayBuffer(30));
  lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
  lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
  lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
  const cd = new DataView(new ArrayBuffer(46));
  cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
  cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true); cd.setUint32(16, crc, true);
  cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nameB.length, true);
  cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, 0, true);
  const cdOffset = 30 + nameB.length + data.length, cdSize = 46 + nameB.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, cdOffset, true); end.setUint16(20, 0, true);
  return new Blob([lh.buffer, nameB, data, cd.buffer, nameB, end.buffer], {type:"application/zip"});
}
/* ------------------------------------------------------------------ */
/* Parties (per client)                                                */
/* ------------------------------------------------------------------ */
// The supplier's ledger in the client's Tally ledger list (needs the bank/sales ledger list of that client to be loaded)
function tallyPartyFor(x, cid){
  if (!S.bank || S.bank.cid !== cid || !hasLedgerList()) return null;
  const list = S.bank.ledgers.list || [];
  const g = fixGstin(x.vendorGstin).value, pan = effectivePan(x);
  if (g){ const hit = list.filter(l => String(l.gstin || "").toUpperCase() === g); if (hit.length === 1) return {name: hit[0].name, how: "GSTIN on the Tally ledger"}; }
  if (pan){ const hit = list.filter(l => String(l.pan || "").toUpperCase() === pan); if (hit.length === 1) return {name: hit[0].name, how: "PAN on the Tally ledger"}; }
  if (x.vendorName){
    const want = normName(x.vendorName).replace(/ /g, "");
    const hit = list.filter(l => /sundry|creditors|current liabilities/i.test(l.group || "") && normName(l.name).replace(/ /g, "") === want);
    if (hit.length === 1) return {name: hit[0].name, how: "name matches the Tally ledger"};
  }
  return null;
}
function closestTallyLedger(name, groupRe){
  const list = (S.bank.ledgers.list || []).filter(l => !groupRe || groupRe.test(l.group || ""));
  let best = null;
  list.forEach(l => { const sc = nameSim(name, l.name); if (sc >= 0.85 && (!best || sc > best.sc)) best = {l, sc}; });
  return best ? best.l.name : null;
}
function findParty(x, cid){
  const parties = D(cid).parties;
  const pan = effectivePan(x);
  if (pan && parties["p-" + pan]) return parties["p-" + pan];
  const nm = norm(x.vendorName);
  return Object.values(parties).find(p => (pan && p.pan === pan) || (nm && norm(p.name) === nm)) || null;
}
/* ---------- what this supplier was already credited in Tally this year ---------- */
function fyStartEnd(fy){
  const m = String(fy).match(/(\d{4})/);
  const y = m ? num(m[1]) : (num(String(fy).slice(0, 2)) + 2000);
  return {from: y + "-04-01", to: (y + 1) + "-03-31"};
}
function partyLedgerName(party, e){
  return exactLedger((e && e.partyLedger) || (party && party.ledgerName) || (e && e.x && e.x.vendorName) || (party && party.name) || "") || "";
}
// credits to the supplier's ledger in Tally for the year, without GST
async function fetchPartyYtd(party, fy, ledger, opts){
  const co = CO(), cid = S.coId;
  if (!bridgeLive(co) || !ledger) return null;
  const span = fyStartEnd(fy);
  const today = new Date().toISOString().slice(0, 10);
  const to = span.to < today ? span.to : today;
  const j = await Bridge.call("/vouchers?company=" + encodeURIComponent(Bridge.openFor(co).name) + "&from=" + isoToTally(span.from) + "&to=" + isoToTally(to) + "&ledger=" + encodeURIComponent(ledger) + Bridge.pinQ(), null, 300000);
  let credited = 0, gross = 0, n = 0;
  [].concat(j.vouchers || []).forEach(v => {
    if (/^yes$/i.test(v.cancelled || "")) return;
    const entries = [].concat(v.entries || []);
    const mine = entries.find(x => norm(x.ledger) === norm(ledger));
    if (!mine) return;
    const amt = parseFloat(String(mine.amount).replace(/,/g, "")) || 0;
    if (amt <= 0) return;                       // only credits to the supplier
    n++;
    gross = r2(gross + amt);
    // the bill value without GST: the other side, leaving out tax ledgers
    let base = 0;
    entries.forEach(x => {
      if (norm(x.ledger) === norm(ledger)) return;
      const a = parseFloat(String(x.amount).replace(/,/g, "")) || 0;
      if (a >= 0) return;                        // debits carry the value
      const info = ledgerInfo(x.ledger);
      if (info && /duties|taxes/i.test(info.group || "")) return;
      if (/\b(c|s|i|ut)gst|cess|tds\b/i.test(x.ledger)) return;
      base = r2(base + Math.abs(a));
    });
    credited = r2(credited + (base || amt));
  });
  const info = {fy, ledger, credited, gross, vouchers: n, at: new Date().toISOString()};
  const key = normName(ledger) + "|" + fy;
  co.tallyYtd = Object.assign({}, co.tallyYtd, {[key]: info});
  Store.saveCompany(co);
  if (party){ party.tallyYtd = info; Store.saveParty(cid, party); }
  return info;
}
function tallyYtdFor(party, fy, e){
  const co = CO();
  const led = partyLedgerName(party, e);
  const byLedger = led && co && co.tallyYtd && co.tallyYtd[normName(led) + "|" + fy];
  if (byLedger) return byLedger;
  const t = party && party.tallyYtd;
  return t && t.fy === fy ? t : null;
}
// our own approved bills of this party, this year, this payment type
function ourYtd(party, fy, natureId, cid, skipSent){
  let credited = 0, tdsBase = 0, bills = 0;
  Object.values(D(cid).entries || {}).forEach(e => {
    if (e.status !== "approved" || !e.snapshot) return;
    if (fyOf(e.x.invoiceDate) !== fy || e.natureId !== natureId) return;
    const p = findParty(e.x, cid);
    if (!party || !p || p.id !== party.id) return;
    if (skipSent && e.exportedAt) return;        // those are counted in the Tally figure
    bills++;
    credited = r2(credited + num(e.snapshot.base));
    tdsBase = r2(tdsBase + num(e.snapshot.tdsBase));
  });
  return {credited, tdsBase, bills};
}
function ytdOf(party, fy, natureId, cid){
  const y = party && party.ytd && party.ytd[fy] && party.ytd[fy][natureId];
  const stored = {credited: y ? num(y.credited) : 0, tdsBase: y ? num(y.tdsBase) : 0};
  const t = tallyYtdFor(party, fy, arguments[4]);
  if (!t) return stored;
  // Tally already holds the bills sent to it; count only the rest from here
  const ours = ourYtd(party, fy, natureId, cid || S.coId, true);
  return {credited: r2(t.credited + ours.credited), tdsBase: r2(Math.max(stored.tdsBase, ours.tdsBase)), fromTally: t, ours};
}

/* ------------------------------------------------------------------ */
/* TDS engine                                                          */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* GST: reverse charge and blocked credit. Suggestions only; you decide */
/* ------------------------------------------------------------------ */
const RCM_LEDGER_DEFAULTS = {rcmCgstIn:"Input CGST (RCM)", rcmSgstIn:"Input SGST (RCM)", rcmIgstIn:"Input IGST (RCM)",
  rcmCgstOut:"CGST Payable (RCM)", rcmSgstOut:"SGST Payable (RCM)", rcmIgstOut:"IGST Payable (RCM)"};
// Reverse charge categories (services, Notification 13/2017-CT(Rate) as amended). Rates are editable per bill: check the current notification.
const RCM_CATS = [
  {id:"advocate", label:"Legal services by an advocate or firm of advocates", rate:18, words:/(advocate|legal\s+(services?|fee|consultation|opinion)|law\s+(firm|chambers|associates)|solicitor|litigation|appearance\s+fee|court\s+fee)/i},
  {id:"gta", label:"Goods transport agency (GTA)", rate:5, words:/(goods\s+transport\s+agency|\bgta\b|consignment\s+note|lorry\s+receipt|\bl\.?\s?r\.?\s*no|bilty|freight|transportation\s+of\s+goods|cartage)/i},
  {id:"rent_unreg", label:"Rent of commercial property from an unregistered person", rate:18, words:/(\brent\b|lease\s+rent|godown|warehouse|shop\s+rent|office\s+rent)/i, unregisteredOnly:true},
  {id:"sponsorship", label:"Sponsorship services", rate:18, words:/sponsor/i},
  {id:"director", label:"Services by a director (sitting fee, remuneration)", rate:18, words:/(sitting\s+fee|director'?s?\s+(fee|remuneration|commission))/i},
  {id:"security", label:"Security services (supplier other than a body corporate)", rate:18, words:/(security\s+(services?|guards?|charges)|watch\s*(and|&)\s*ward|guarding)/i, notCompanyOnly:true},
  {id:"vehicle_hire", label:"Renting of a motor vehicle (supplier other than a body corporate)", rate:5, words:/((cab|car|taxi|vehicle|bus|tempo)\s+(hire|rental|rent|charges)|hiring\s+of\s+(car|vehicle|cab|bus))/i, notCompanyOnly:true},
  {id:"insurance_agent", label:"Services by an insurance agent", rate:18, words:/insurance\s+agent/i},
  {id:"recovery_agent", label:"Services by a recovery agent", rate:18, words:/recovery\s+agent/i},
  {id:"other", label:"Other reverse charge supply", rate:18, words:null}
];
// Blocked credit under section 17(5). Each client decides: flag, always block, or credit allowed.
const BLOCK_CATS = [
  {id:"motor", label:"Motor vehicles, their repair, servicing and insurance", sec:"17(5)(a), (aa), (ab)", words:/(motor\s+(car|vehicle)|\bcar\b|four\s*wheeler|vehicle\s+(repair|servic|insurance|maintenance)|car\s+(wash|servic|repair|insurance)|\b8703\d*\b|motor\s+insurance)/i},
  {id:"food", label:"Food, beverages and outdoor catering", sec:"17(5)(b)(i)", words:/(food|beverage|catering|caterer|restaurant|meals?\b|lunch|dinner|breakfast|snacks|refreshment|canteen|tiffin|sweets|\b9963\d*\b)/i},
  {id:"beauty_health", label:"Beauty treatment, health services, cosmetic and plastic surgery", sec:"17(5)(b)(i)", words:/(beauty|salon|spa\b|cosmetic|plastic\s+surgery|health\s+check|hospital|medical\s+treatment|clinic)/i},
  {id:"club", label:"Membership of a club, health and fitness centre", sec:"17(5)(b)(ii)", words:/(club\s+membership|membership\s+fee|\bgym\b|fitness\s+(centre|center)|health\s+club|golf)/i},
  {id:"life_health_ins", label:"Life and health insurance", sec:"17(5)(b)(i)", words:/(life\s+insurance|health\s+insurance|mediclaim|group\s+(health|term)|term\s+insurance)/i},
  {id:"travel", label:"Travel benefits to employees (leave or home travel)", sec:"17(5)(b)(iii)", words:/(leave\s+travel|\bltc\b|home\s+travel|holiday\s+package|tour\s+package|vacation)/i},
  {id:"construction", label:"Works contract or goods and services for construction of immovable property", sec:"17(5)(c), (d)", words:/(works\s+contract|construction\s+of|civil\s+work|building\s+work|renovation|boundary\s+wall|flooring|\b9954\d*\b)/i},
  {id:"gifts", label:"Gifts, free samples and personal consumption", sec:"17(5)(g), (h)", words:/(gift|hamper|diwali|festival\s+(gift|sweets)|free\s+sample|personal\s+use)/i}
];
function rcmLedger(co, k){ return (co.gst && co.gst[k]) || RCM_LEDGER_DEFAULTS[k]; }
function blockRule(co, id){ return (co.gstBlock && co.gstBlock[id]) || "flag"; }
function gstText(e){ return [e.x.vendorName, e.x.description, e.hint].filter(Boolean).join(" \n "); }
function looksBodyCorporate(e){ const p = effectivePan(e.x); return (p && p[3] === "C") || /(private\s+limited|pvt\.?\s*ltd|limited\b|ltd\b|llp\b)/i.test(e.x.vendorName || ""); }
function suggestRcm(e, co){
  const t = gstText(e), gst = num(e.x.cgst) + num(e.x.sgst) + num(e.x.igst);
  const says = /(reverse\s*charge\s*[:\-]?\s*(yes|y\b|applicable)|payable\s+(on|under)\s+reverse\s+charge|under\s+reverse\s+charge|\brcm\b\s*(applicable|:?\s*yes))/i.test(t)
    && !/reverse\s*charge\s*[:\-]?\s*(no|n\b|not\s+applicable)/i.test(t);
  if (gst > 0 && !says) return null;                 // GST charged by the supplier: forward charge
  const unreg = !gstinValid(e.x.vendorGstin);
  for (const c of RCM_CATS){
    if (!c.words || !c.words.test(t)) continue;
    if (c.unregisteredOnly && (!unreg || !co.gstin)) continue;
    if (c.notCompanyOnly && looksBodyCorporate(e)) continue;
    return {cat: c.id, why: says ? "the bill says tax is payable under reverse charge" : "no GST charged, and this looks like " + c.label.toLowerCase()};
  }
  return says ? {cat: "other", why: "the bill says tax is payable under reverse charge"} : null;
}
function suggestBlock(e, co){
  const t = gstText(e);
  for (const c of BLOCK_CATS){
    const rule = blockRule(co, c.id);
    if (rule === "allow" || !c.words.test(t)) continue;
    return {cat: c.id, rule, why: "looks like " + c.label.toLowerCase()};
  }
  return null;
}
// What applies to this bill, after your choices
function gstDecision(e, co){
  const rs = e.rcmDismissed ? null : suggestRcm(e, co);
  const bs = e.blockDismissed ? null : suggestBlock(e, co);
  let rcm = null;
  if (e.rcm && e.rcm.on) rcm = e.rcm;
  let block = null;
  if (e.itcBlock && e.itcBlock.on) block = {cat: e.itcBlock.cat, from: "bill"};
  else if (e.itcBlock && e.itcBlock.on === false) block = null;
  else if (bs && bs.rule === "block") block = {cat: bs.cat, from: "client"};
  return {rcm, block, rcmSuggest: rcm ? null : rs, blockSuggest: (block || (e.itcBlock && e.itcBlock.on === false)) ? null : bs};
}
function rcmTaxOf(e, co, base){
  if (!(e.rcm && e.rcm.on)) return null;
  const rate = num(e.rcm.rate);
  const supState = gstinValid(e.x.vendorGstin) ? e.x.vendorGstin.slice(0, 2) : "";
  const cliState = (co.gstin || "").slice(0, 2);
  const inter = e.rcm.inter != null ? !!e.rcm.inter : !!(supState && cliState && supState !== cliState);
  const tax = r2(base * rate / 100);
  return inter ? {inter, rate, tax, igst: tax, cgst: 0, sgst: 0} : {inter, rate, tax, igst: 0, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2))};
}
function catRate(id){ const c = RCM_CATS.find(x => x.id === id); return c ? c.rate : 18; }
function catLabel(list, id){ const c = list.find(x => x.id === id); return c ? c.label : id; }

// TDS is always worked out, but booking it is your choice: per bill, per supplier or per client.
const SKIP_REASONS = {
  transporter: "Transporter's declaration on file: ten or fewer goods carriages, PAN given",
  pay: "Will deduct at the time of payment",
  booked: "Already deducted or booked separately",
  ldc: "Lower or nil deduction certificate",
  na: "Not applicable in my judgement",
  notliable: "This client is not required to deduct TDS",
  other: "Other reason",
  note: "Credit note: it reduces the purchase, so no TDS is deducted on it"
};
function tdsSkipOf(e, co, party){
  if (e.tdsForce) return null;
  if (e.tdsSkip) return {reason: e.tdsSkip, from: "bill"};
  if (co && co.mustDeduct === false) return {reason: "notliable", from: "client"};
  if (party && party.transporter && (e.natureId === "contractor")) return {reason: "transporter", from: "supplier"};
  if (party && party.noTds) return {reason: party.noTdsReason || "na", from: "supplier"};
  if (co && co.bookTds === false) return {reason: "booked", from: "client"};
  return null;
}
// where the year's figure comes from: Tally plus bills here
function ytdSourceHtml(e, c){
  const party = c.party, fy = fyOf(e.x.invoiceDate), t = tallyYtdFor(party, fy, e);
  const led = partyLedgerName(party, e);
  const busy = S.ytdBusy === e.id;
  if (t){
    const ours = ourYtd(party, fy, c.rule.id, S.coId, true);
    return '<p class="note" style="margin:4px 0 0">Year so far: <b>' + money0(t.credited) + "</b> credited to " + esc(t.ledger) + " in Tally (" + t.vouchers + " voucher" + (t.vouchers === 1 ? "" : "s") + ", GST left out)" +
      (ours.credited ? " + <b>" + money0(ours.credited) + "</b> from " + ours.bills + " bill" + (ours.bills === 1 ? "" : "s") + " here not yet in Tally" : "") +
      " \u00b7 read " + new Date(t.at).toLocaleString([], {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}) +
      ' <button class="linkbtn" data-act="ytdFetch"' + (busy ? " disabled" : "") + ">" + (busy ? "Reading\u2026" : "Check again") + "</button></p>";
  }
  if (!bridgeLive()) return '<p class="note" style="margin:4px 0 0">This year\u2019s total counts only the bills entered here. Connect the Tally Bridge to include what is already booked in Tally.</p>';
  if (!led) return '<p class="note" style="margin:4px 0 0">Choose the supplier\u2019s Tally ledger below to check what was already credited to it this year.</p>';
  return '<p class="note" style="margin:4px 0 0">This year\u2019s total counts only the bills entered here. <button class="linkbtn" data-act="ytdFetch"' + (busy ? " disabled" : "") + ">" + (busy ? "Reading from Tally\u2026" : "Check " + esc(led) + " in Tally") + "</button></p>";
}
function skipText(skip){
  return (SKIP_REASONS[skip.reason] || skip.reason) + (skip.from === "supplier" ? " (set for this supplier)" : skip.from === "client" ? " (set for this client)" : "");
}
function compute(e, cid){
  cid = cid || S.coId;
  const co = CO(cid), x = e.x, party = findParty(x, cid), entries = D(cid).entries;
  const rule = ruleOf(e.natureId);
  const gstTotal = num(x.cgst) + num(x.sgst) + num(x.igst);
  const base = r2(num(x.taxable) || Math.max(0, num(x.total) - gstTotal));
  const total = r2(num(x.total) || base + gstTotal);
  const fy = fyOf(x.invoiceDate);
  const ytd = ytdOf(party, fy, rule.id, cid, e);
  const pan = effectivePan(x);
  const panOk = !!pan;
  const indHuf = panOk && (pan[3] === "P" || pan[3] === "H");
  const why = [], flags = [];
  let applicable = false, tdsBase = 0, catchUp = 0, meter = null;

  let rate = 0, rateNote = "";
  if (rule.basis !== "never"){
    if (!panOk){ rate = rule.id === "goods" ? 5 : 20; rateNote = "No PAN: higher rate"; }
    else { rate = indHuf ? num(rule.rateInd) : num(rule.rateOth); rateNote = rule.rateInd !== rule.rateOth ? (indHuf ? "Individual / HUF rate" : "Rate for others") : "Standard rate"; }
    if (party && party.ldcRate !== undefined && party.ldcRate !== "" && party.ldcValidTo && x.invoiceDate && x.invoiceDate <= party.ldcValidTo){
      rate = num(party.ldcRate); rateNote = "Lower deduction certificate (valid to " + fmtDate(party.ldcValidTo) + ")";
      flags.push({lvl:"info", t:"Lower deduction certificate rate of " + rate + "% applied. Check the certificate limit has not been used up."});
    }
  }

  const after = ytd.credited + base;
  const forceAlways = !!e.tdsAlways;
  const pendingCatch = Math.max(0, r2(ytd.credited - ytd.tdsBase));
  switch (rule.basis){
    case "never":
      why.push("This payment type is not covered by TDS.");
      break;
    case "always":
      applicable = true; tdsBase = base; why.push("No threshold applies to this payment type.");
      break;
    case "single_or_annual":
      meter = {used:ytd.credited, add:base, limit:num(rule.limit), label:"Credited this year vs annual limit"};
      if (base > num(rule.single)){ applicable = true; why.push("This bill of " + money0(base) + " is above the single-bill limit of " + money0(rule.single) + "."); }
      if (after > num(rule.limit)){
        applicable = true; catchUp = pendingCatch;
        why.push("Total credited this year becomes " + money0(after) + ", above the annual limit of " + money0(rule.limit) + ".");
      }
      if (!applicable) why.push("Below both limits: bill under " + money0(rule.single) + " and year total " + money0(after) + " under " + money0(rule.limit) + ".");
      tdsBase = applicable ? base : 0;
      break;
    case "annual":
      meter = {used:ytd.credited, add:base, limit:num(rule.limit), label:"Credited this year vs annual limit"};
      if (after > num(rule.limit)){
        applicable = true; tdsBase = base; catchUp = pendingCatch;
        why.push("Total credited this year becomes " + money0(after) + ", above the limit of " + money0(rule.limit) + ".");
      } else why.push("Year total " + money0(after) + " stays within the limit of " + money0(rule.limit) + ".");
      break;
    case "monthly": {
      const months = Math.max(1, Math.round(num(x.rentMonths) || 1));
      const perMonth = r2(base / months);
      meter = {used:0, add:perMonth, limit:num(rule.limit), label:"Rent per month vs monthly limit"};
      if (perMonth > num(rule.limit)){ applicable = true; tdsBase = base; why.push("Rent of " + money0(perMonth) + " a month is above " + money0(rule.limit) + " a month."); }
      else why.push("Rent of " + money0(perMonth) + " a month is within " + money0(rule.limit) + " a month.");
      if (months > 1) flags.push({lvl:"", t:"This invoice covers " + months + " months. The monthly test used " + money0(perMonth) + " a month; confirm the period."});
      break;
    }
    case "excess":
      meter = {used:ytd.credited, add:base, limit:num(rule.limit), label:"Purchases from this seller this year vs limit"};
      if (!co.turnover10cr){
        why.push("Not applied: this client's previous-year turnover is set as ₹10 crore or less (Company settings).");
      } else if (after > num(rule.limit)){
        applicable = true;
        tdsBase = r2(Math.min(base, after - Math.max(num(rule.limit), ytd.credited)));
        why.push("Purchases this year reach " + money0(after) + ". TDS applies only on the " + money0(tdsBase) + " above " + money0(rule.limit) + ".");
      } else why.push("Purchases this year of " + money0(after) + " are within " + money0(rule.limit) + ".");
      break;
  }
  if (!applicable && forceAlways && rule.basis !== "never"){
    applicable = true; tdsBase = base;
    why.push("Deducted on your instruction, although this bill is below the limits.");
  }
  if (applicable && rule.basis !== "excess") why.push("TDS is worked on the value before GST, as GST is shown separately.");

  if (catchUp > 0){
    flags.push({lvl:"", t:"Earlier bills worth " + money0(catchUp) + " this year had no TDS. " + (e.includeCatchUp ? "Their TDS is included in this entry." : "Their TDS is not included; tick the box to add it.")});
    if (e.includeCatchUp) tdsBase = r2(tdsBase + catchUp);
  }
  const tdsWould = applicable ? Math.round(tdsBase * rate / 100) : 0;
  const skip = tdsWould > 0 ? tdsSkipOf(e, co, party) : null;
  const tds = skip ? 0 : tdsWould;
  if (skip) flags.push({lvl:"info", t:"TDS of " + money(tdsWould) + " applies but is not booked in this entry: " + skipText(skip) + ". The party is credited with the full amount."});

  try { itemChecks(e.x).forEach(c => flags.push({lvl: c.lvl === "warn" ? "" : "info", t: c.text})); } catch (err){}
  if (rule.basis !== "never" && !panOk) flags.push({lvl:"hi", t:"No valid PAN or GSTIN found, so the higher rate of " + rate + "% is used. Get the deductee's PAN."});
  const g = String(x.vendorGstin || "").toUpperCase(), pp = String(x.vendorPan || "").toUpperCase();
  if (g && !gstinValid(g)) flags.push({lvl:"hi", t:"The supplier GSTIN " + g + " fails its check digit, so at least one character is wrong. Compare it with the bill."});
  if (x.buyerGstin && !gstinValid(x.buyerGstin)) flags.push({lvl:"", t:"The billed-to GSTIN " + x.buyerGstin + " fails its check digit. Compare it with the bill."});
  if (e.status === "draft" && e.gstinNotes) e.gstinNotes.forEach(n => flags.push({lvl:"info", t:n}));
  if (GSTIN_RE.test(g) && PAN_RE.test(pp) && g.slice(2, 12) !== pp) flags.push({lvl:"hi", t:"The PAN on the invoice does not match the PAN inside the GSTIN."});
  if (e.docKind && !e.docOverride){
    flags.push({lvl: "hi", t: "This paper is " + (DOC_KIND_TEXT[e.docKind] || "not a tax invoice") + ", not a purchase bill. No purchase should be booked from it. If the supplier later sends the tax invoice, book that one."});
  }
  if (x.shipGstin && co.gstin && String(x.shipGstin).toUpperCase() === co.gstin && String(x.buyerGstin || "").toUpperCase() !== co.gstin)
    flags.push({lvl: "hi", t: "This bill is billed to " + (x.buyerGstin || "another party") + " and only delivered to " + co.name + ". The purchase belongs to the party it is billed to, not to this client."});
  if (x.buyerGstin && co.gstin && String(x.buyerGstin).toUpperCase() !== co.gstin) flags.push({lvl:"hi", t:"The invoice is billed to GSTIN " + x.buyerGstin + ", not " + co.name + " (" + co.gstin + "). Check it belongs to this client."});
  if (num(x.taxable) && num(x.total) && Math.abs(num(x.taxable) + gstTotal - num(x.total)) > 1) flags.push({lvl:"", t:"Taxable value plus GST (" + money(num(x.taxable) + gstTotal) + ") differs from the invoice total (" + money(x.total) + "). The difference goes to round off."});
  if (num(x.cgst) !== num(x.sgst)) flags.push({lvl:"", t:"CGST and SGST are not equal. Check the GST amounts."});
  if ((num(x.cgst) || num(x.sgst)) && num(x.igst)) flags.push({lvl:"", t:"The invoice shows both IGST and CGST/SGST. Check the place of supply."});
  if (party && party.natureDefault && party.natureDefault !== e.natureId) flags.push({lvl:"", t:"This deductee is usually treated as \u201c" + ruleOf(party.natureDefault).label + "\u201d. You have chosen \u201c" + rule.label + "\u201d."});
  const byClaude = /Claude/.test(e.readMode || "") || !e.readMode;
  const who = byClaude ? "Claude" : "Free reading";
  if (e.ai && e.ai.suggested && e.ai.suggested !== e.natureId && !(party && party.natureDefault === e.natureId)) flags.push({lvl:"info", t:who + " suggested \u201c" + ruleOf(e.ai.suggested).label + "\u201d for this invoice."});
  if (e.ai && num(e.ai.confidence) > 0 && num(e.ai.confidence) < 0.7 && e.status === "draft" && !(party && party.natureDefault) && !skip){
    flags.push({lvl:"", t: byClaude ? "Claude was unsure of the payment type. Check it before approving."
      : "The payment type was guessed from the bill's wording" + (e.ai.reason ? " (" + e.ai.reason.replace(/^Free reading:\s*/, "") + ")" : "") + ". Confirm it before approving."});
  }
  if (!x.invoiceDate) flags.push({lvl:"hi", t:"Invoice date is missing."});
  if (e.status === "draft" && e.uncertain && e.uncertain.length){
    const names = {vendorName:"supplier name", vendorGstin:"GSTIN", vendorPan:"PAN", buyerGstin:"billed-to GSTIN", invoiceNo:"bill number", invoiceDate:"date", taxable:"taxable value", cgst:"CGST", sgst:"SGST", igst:"IGST", total:"total", description:"items"};
    flags.push({lvl:"", t:(e.handwritten ? "Handwritten bill. " : "") + "Check against the image: " + e.uncertain.map(k => names[k] || k).join(", ") + "."});
  }
  const dup = e.status === "approved" || e.notDuplicate ? null : findDuplicate(e, cid);
  if (dup) flags.push({lvl:"hi", t:(dup.strong ? "Duplicate: " : "Possible duplicate: ") + dup.msg + (dup.strong ? " Approval is blocked unless you confirm it is a different bill." : "")});
  if (party && e.status === "draft"){
    const others = Object.values(entries).filter(o => o.id !== e.id && o.status === "draft" && (findParty(o.x, cid) || {}).id === party.id).length;
    if (others) flags.push({lvl:"info", t:others + " other draft" + (others > 1 ? "s" : "") + " for this deductee are waiting. Limits count only approved invoices, so approve in date order."});
  }
  if (!party && rule.basis !== "never" && e.status === "draft") flags.push({lvl:"info", t:"New deductee for this client. If bills were credited earlier this year outside this desk, enter them in Deductees so the limits are right."});
  const tdsLedger = co.tdsLedgers[rule.id] || "";
  if (tds > 0 && !tdsLedger) flags.push({lvl:"hi", t:"No TDS ledger is set for " + rule.label + ". Add it in Company settings."});

  // GST: reverse charge and blocked credit (your choices; suggestions never block approval)
  const gd = gstDecision(e, co);
  const rcmTax = rcmTaxOf(e, co, base);
  const blocked = !!gd.block;
  if (gd.rcmSuggest) flags.push({lvl:"info", t:"Reverse charge may apply: " + catLabel(RCM_CATS, gd.rcmSuggest.cat) + " (" + gd.rcmSuggest.why + "). Apply it or dismiss it in the GST section."});
  if (gd.blockSuggest) flags.push({lvl:"info", t:"GST credit may be blocked under section 17(5): " + catLabel(BLOCK_CATS, gd.blockSuggest.cat) + ". Accept or reject it in the GST section."});
  if (rcmTax && gstTotal > 0) flags.push({lvl:"", t:"Reverse charge is on, but the supplier also charged GST on the bill. Check the bill."});
  if (blocked) flags.push({lvl:"info", t:"GST credit blocked (" + catLabel(BLOCK_CATS, gd.block.cat) + (gd.block.from === "client" ? ", client setting" : "") + "): the GST is added to the expense."});

  const lines = [];
  const blockedGst = blocked ? r2(gstTotal + (rcmTax ? rcmTax.tax : 0)) : 0;
  lines.push({side:"Dr", ledger:e.expenseLedger || "", amt:r2(base + blockedGst), role:"expense"});
  if (!blocked){
    if (num(x.cgst)) lines.push({side:"Dr", ledger:co.gst.cgst, amt:r2(num(x.cgst)), role:"gst"});
    if (num(x.sgst)) lines.push({side:"Dr", ledger:co.gst.sgst, amt:r2(num(x.sgst)), role:"gst"});
    if (num(x.igst)) lines.push({side:"Dr", ledger:co.gst.igst, amt:r2(num(x.igst)), role:"gst"});
  }
  if (rcmTax){
    if (!blocked){
      if (rcmTax.cgst) lines.push({side:"Dr", ledger:rcmLedger(co, "rcmCgstIn"), amt:rcmTax.cgst, role:"rcm-in"});
      if (rcmTax.sgst) lines.push({side:"Dr", ledger:rcmLedger(co, "rcmSgstIn"), amt:rcmTax.sgst, role:"rcm-in"});
      if (rcmTax.igst) lines.push({side:"Dr", ledger:rcmLedger(co, "rcmIgstIn"), amt:rcmTax.igst, role:"rcm-in"});
    }
    if (rcmTax.cgst) lines.push({side:"Cr", ledger:rcmLedger(co, "rcmCgstOut"), amt:rcmTax.cgst, role:"rcm-out"});
    if (rcmTax.sgst) lines.push({side:"Cr", ledger:rcmLedger(co, "rcmSgstOut"), amt:rcmTax.sgst, role:"rcm-out"});
    if (rcmTax.igst) lines.push({side:"Cr", ledger:rcmLedger(co, "rcmIgstOut"), amt:rcmTax.igst, role:"rcm-out"});
  }
  const ro = r2(total - (base + gstTotal));
  if (Math.abs(ro) >= 0.01) lines.push({side: ro > 0 ? "Dr" : "Cr", ledger:co.roundOff, amt:Math.abs(ro), role:"roundoff"});
  lines.push({side:"Cr", ledger:e.partyLedger || "", amt:r2(total - tds), role:"party"});
  if (tds > 0) lines.push({side:"Cr", ledger:tdsLedger, amt:tds, role:"tds"});
  const dr = r2(lines.filter(l => l.side === "Dr").reduce((a, l) => a + l.amt, 0));
  const cr = r2(lines.filter(l => l.side === "Cr").reduce((a, l) => a + l.amt, 0));

  const missing = [];
  if (e.docKind && !e.docOverride) missing.push("your confirmation that this really is a purchase bill");
  if (x.buyerGstin && co.gstin && String(x.buyerGstin).toUpperCase() !== co.gstin && !e.buyerOverride) missing.push("your confirmation that this bill belongs to " + co.name);
  if (!x.vendorName) missing.push("deductee name");
  if (!x.invoiceDate) missing.push("invoice date");
  if (!(base > 0)) missing.push("taxable value");
  if (!e.partyLedger) missing.push("party ledger");
  if (!e.expenseLedger) missing.push("expense ledger");
  if (tds > 0 && !tdsLedger) missing.push("TDS ledger");
  if (Math.abs(dr - cr) >= 0.01) missing.push("a balanced entry");
  if (dup && dup.strong) missing.push("confirmation that this is not a duplicate");
  if (e.confirmType && e.status === "draft" && !(party && party.natureDefault) && !skip) missing.push("your confirmation of the payment type");

  return {rule, party, base, total, gstTotal, fy, ytd, pan, panOk, indHuf, applicable, rate, rateNote, tdsBase, catchUp, tds, tdsWould, skip, gd, rcmTax, blocked, why, flags, meter, lines, dr, cr, missing, tdsLedger, dup};
}

/* ------------------------------------------------------------------ */
/* Reading invoices                                                    */
/* ------------------------------------------------------------------ */
const UNSURE_KEYS = {vendorName:"vendorName", vendorGstin:"vendorGstin", vendorPan:"vendorPan", buyerGstin:"buyerGstin", invoiceNo:"invoiceNo", invoiceDate:"invoiceDate",
  taxableValue:"taxable", cgst:"cgst", sgst:"sgst", igst:"igst", totalAmount:"total", description:"description"};
function buildPrompt(text, fileName, imageCount, kind){
  const list = rules().map(r => "- " + r.id + ": " + r.label + " (" + r.hint + ")").join("\n");
  const how = kind === "pdf_text"
    ? "The file is a PDF with a text layer; its text is below" + (imageCount ? " and its page images are attached" : "") + "."
    : "The invoice may be handwritten or a photo or scan: a kachcha bill, cash memo, manual bill-book page or a printed bill, possibly at an angle, faint, or partly in Hindi. " +
      (imageCount > 1 ? "The first image is the whole first page. The next images are enhanced close-up strips of that same page from top to bottom (they overlap), sent so small and handwritten writing is legible; any image after those is a further page. Use the whole page for layout and the strips to read the writing." : "The page image is attached.");
  return "You are reading one Indian purchase or expense bill for a chartered accountant. The buyer is the accountant's client and may need to deduct TDS.\n" +
    how + "\n" +
    (text ? "Text extracted from the file (may be incomplete):\n\"\"\"\n" + text + "\n\"\"\"\n" : "") +
    "File name: " + fileName + "\n\n" +
    "Extract the bill and classify the payment for TDS under India's Income-tax Act, 2025 (section 393). Choose natureId from:\n" + list + "\n\n" +
    "Reply with only one JSON object in this shape:\n" +
    "{\"docKind\": \"invoice\"|\"proforma\"|\"purchase_order\"|\"quotation\"|\"challan\"|\"receipt\"|\"statement\", \"shipGstin\": string|null, \"items\": [{\"description\": string, \"hsn\": string|null, \"qty\": number|null, \"unit\": string|null, \"rate\": number|null, \"taxable\": number, \"gstRate\": number|null}], \"vendorName\": string, \"vendorGstin\": string|null, \"vendorPan\": string|null, \"buyerName\": string|null, \"buyerGstin\": string|null, \"invoiceNo\": string|null, \"invoiceDate\": \"YYYY-MM-DD\"|null, \"taxableValue\": number|null, \"cgst\": number, \"sgst\": number, \"igst\": number, \"totalAmount\": number|null, \"description\": string, \"natureId\": string, \"natureReason\": string, \"confidence\": number, \"rentMonths\": number|null, \"handwritten\": boolean, \"uncertainFields\": string[], \"legibilityNote\": string}\n" +
    "How to read:\n" +
    "- The vendor issued the bill (name at the top, stamp or signature); the buyer is who it is billed to (\"M/s\", \"To\", \"Bill to\", \"Buyer\").\n" +
    "- Amounts: Indian grouping (1,25,000 = 125000), \"/-\" and \"Rs.\" mark rupees. If the amount is also written in words, use the words to confirm or correct the figure.\n" +
    "- If GST is not charged separately, taxableValue equals the total and all GST heads are 0. If the total is not written, add up the item lines (quantity x rate).\n" +
    "- Dates are day first (12/09/26 = 2026-09-12). A GSTIN has 15 characters; copy it exactly or give null.\n" +
    "- Give vendorPan only if a PAN is written; do not work it out. Use null for anything not on the bill, rather than guessing.\n" +
    "- docKind: what the paper actually is. A proforma invoice, purchase order, quotation, delivery challan or receipt is NOT a purchase bill.\n" +
    "- buyerGstin: the GSTIN in the \"Bill to\" block. shipGstin: the GSTIN in the \"Ship to\" or consignee block, when it is different.\n" +
    "- items: one entry for each line on the bill, each with its own GST rate when the bill shows more than one. Leave items empty if the bill has no line detail.\n" +
    "- description: at most 100 characters on what was supplied. natureReason: at most 160 characters. confidence: 0 to 1 for the natureId choice. rentMonths: months billed, only for rent.\n" +
    "- handwritten: true if the key figures are handwritten. uncertainFields: names of fields from the shape above that you could not read with confidence (for example \"totalAmount\", \"invoiceDate\"). legibilityNote: at most 120 characters on what was hard to read, or an empty string.";
}
/* ---------- what was actually billed: the item lines ---------- */
const UNIT_WORDS = /\b(nos?|pcs?|pieces?|kgs?|kg|gms?|ltrs?|ltr|lts?|mtrs?|mtr|meters?|units?|bags?|boxes?|box|cartons?|drums?|rolls?|sets?|pairs?|dozens?|tons?|quintals?|sq\s?ft|sqft|sq\s?mtr|hrs?|hours?|days?|months?|trips?)\b/i;
// pull item rows out of the lines between the table heading and the totals
function readItems(lines){
  const rows = itemLines(lines);
  const out = [];
  rows.forEach(l0 => {
    // addresses, IPs, phone numbers and web addresses are not amounts
    const l = String(l0)
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, " ")
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
      .replace(/\b(?:ip|server|mac|imei|port)\b\s*[-:]?\s*\S+/gi, " ")
      .replace(/\+?\d{2}[- ]?\d{10}\b/g, " ");
    const amts = lineAmounts(l).filter(a => a.strong || a.v > 0).map(a => a.v);
    if (!amts.length) return;
    const hsn = (l.match(/\b(\d{4}|\d{6}|\d{8})\b/g) || []).find(c => /^(0[1-9]|[1-9]\d)/.test(c) && (c.length === 4 || c.length === 6 || c.length === 8) && num(c) > 1000) || "";
    // many bills print: HSN | GST% | quantity | unit | rate | amount
    if (hsn){
      const after = l.slice(l.indexOf(hsn) + hsn.length);
      const nums = (after.match(/-?[\d,]+(?:\.\d+)?/g) || []).map(x => num(x)).filter(x => x > 0);
      const unitM2 = after.match(/\b([A-Za-z]{2,8})\b(?=\s*[\d,])/);
      if (nums.length >= 4){
        const [g, q, rt, amt] = [nums[0], nums[1], nums[2], nums[nums.length - 1]];
        if (g <= 28 && q > 0 && rt > 0 && Math.abs(r2(q * rt) - amt) <= Math.max(2, amt * 0.02)){
          const desc2 = l.slice(0, l.indexOf(hsn)).replace(/^\s*\d+[.)]?\s*/, "").replace(/\s+/g, " ").trim();
          out.push({desc: desc2.slice(0, 80), hsn, qty: q, unit: unitM2 ? unitM2[1] : "", rate: rt, taxable: r2(amt), gstRate: g});
          return;
        }
      }
      if (nums.length === 3 && Math.abs(r2(nums[0] * nums[1]) - nums[2]) <= Math.max(2, nums[2] * 0.02)){
        const desc3 = l.slice(0, l.indexOf(hsn)).replace(/^\s*\d+[.)]?\s*/, "").replace(/\s+/g, " ").trim();
        out.push({desc: desc3.slice(0, 80), hsn, qty: nums[0], unit: unitM2 ? unitM2[1] : "", rate: nums[1], taxable: r2(nums[2]), gstRate: null});
        return;
      }
    }
    const unitM = l.match(UNIT_WORDS);
    const taxable = amts[amts.length - 1];
    let qty = 0, rate = 0;
    if (amts.length >= 3){ qty = amts[amts.length - 3]; rate = amts[amts.length - 2]; }
    else if (amts.length === 2){ rate = amts[0]; qty = rate ? r2(taxable / rate) : 0; }
    if (qty && rate && Math.abs(r2(qty * rate) - taxable) > Math.max(1, taxable * 0.02)){ qty = 0; rate = 0; }
    const gstM = l.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
    const desc = l.replace(/\s{2,}/g, " ").replace(/[\d,]+\.\d{2}/g, "").replace(/\b\d{4,8}\b/g, "").replace(UNIT_WORDS, "").replace(/\s+/g, " ").trim();
    if (desc.replace(/[^A-Za-z]/g, "").length < 3) return;
    out.push({desc: desc.slice(0, 80), hsn, qty, unit: unitM ? unitM[0] : "", rate, taxable, gstRate: gstM ? num(gstM[1]) : null});
  });
  // drop specks: a line worth almost nothing next to the rest is noise, not an item
  const big = out.reduce((a, i) => Math.max(a, num(i.taxable)), 0);
  return out.filter(i => num(i.taxable) >= Math.max(5, big * 0.005)).slice(0, 40);
}
// add up the items by GST rate, so a two-rate bill is obvious
function itemSummary(x){
  const items = (x.items || []).filter(i => num(i.taxable) > 0);
  if (!items.length) return null;
  const billTaxable = num(x.taxable !== undefined && x.taxable !== "" ? x.taxable : x.taxableValue);
  const read = r2(items.reduce((a, i) => a + num(i.taxable), 0));
  if (billTaxable && (read < billTaxable * 0.5 || read > billTaxable * 2)) return {items, rates: [], total: read, gstOnBill: 0, expect: null, multi: false, unreliable: true};
  const byRate = new Map();
  items.forEach(i => {
    const k = i.gstRate == null ? "?" : String(i.gstRate);
    const e = byRate.get(k) || {rate: i.gstRate, taxable: 0, n: 0, hsn: new Set()};
    e.taxable = r2(e.taxable + num(i.taxable)); e.n++;
    if (i.hsn) e.hsn.add(i.hsn);
    byRate.set(k, e);
  });
  const total = r2(items.reduce((a, i) => a + num(i.taxable), 0));
  const gstOnBill = r2(num(x.cgst) + num(x.sgst) + num(x.igst));
  const rates = Array.from(byRate.values());
  const expect = rates.every(r => r.rate != null) ? r2(rates.reduce((a, r) => a + r.taxable * num(r.rate) / 100, 0)) : null;
  return {items, rates, total, gstOnBill, expect, multi: rates.filter(r => r.rate).length > 1};
}
function itemChecks(x){
  const s = itemSummary(x);
  if (!s) return [];
  const out = [];
  const taxable = num(x.taxable !== undefined && x.taxable !== "" ? x.taxable : x.taxableValue);
  if (taxable && (s.total < taxable * 0.5 || s.total > taxable * 2))
    out.push({lvl: "info", text: "The item lines could not be read reliably (they add up to " + INR.format(s.total) + " against a taxable value of " + INR.format(taxable) + "), so only the totals are used."});
  else if (taxable && Math.abs(s.total - taxable) > Math.max(2, taxable * 0.01))
    out.push({lvl: "warn", text: "The item lines add up to " + INR.format(s.total) + ", but the bill's taxable value is " + INR.format(taxable) + "."});
  if (s.expect != null && s.gstOnBill && Math.abs(s.expect - s.gstOnBill) > Math.max(2, s.gstOnBill * 0.02))
    out.push({lvl: "warn", text: "GST on the items works out to " + INR.format(s.expect) + ", but the bill charges " + INR.format(s.gstOnBill) + "."});
  if (s.multi)
    out.push({lvl: "info", text: "This bill has more than one GST rate (" + s.rates.filter(r => r.rate).map(r => r.rate + "%: " + INR.format(r.taxable)).join(", ") + "). Check the expense ledger and the input GST split."});
  return out;
}
function itemsHtml(e, ro){
  const x = e.x, s = itemSummary(x);
  if (!s) return "";
  const rows = s.items.map((i, k) => "<tr><td>" + esc(i.desc) + "</td><td>" + esc(i.hsn || "\u2014") + '</td><td class="n">' + (i.qty ? i.qty + (i.unit ? " " + esc(i.unit) : "") : "\u2014") +
    '</td><td class="n">' + (i.rate ? INR.format(i.rate) : "\u2014") + '</td><td class="n">' + INR.format(num(i.taxable)) + '</td><td class="n">' + (i.gstRate == null ? "\u2014" : i.gstRate + "%") + "</td></tr>").join("");
  const rateRows = s.rates.map(r => "<tr><td>" + (r.rate == null ? "rate not shown" : r.rate + "%") + "</td><td>" + (r.hsn.size ? Array.from(r.hsn).join(", ") : "\u2014") +
    '</td><td class="n">' + INR.format(r.taxable) + '</td><td class="n">' + (r.rate ? INR.format(r2(r.taxable * r.rate / 100)) : "\u2014") + "</td></tr>").join("");
  if (s.unreliable) return '<p class="note" style="margin:6px 0">The line items on this bill could not be read reliably, so only the totals are used.</p>';
  return '<details class="itembox"' + (s.multi ? " open" : "") + '><summary>What was billed \u00b7 ' + s.items.length + " line" + (s.items.length === 1 ? "" : "s") +
    (s.multi ? ' <span class="tag">two GST rates</span>' : "") + "</summary>" +
    '<div class="tblwrap"><table class="data"><thead><tr><th>Description</th><th>HSN/SAC</th><th class="n">Quantity</th><th class="n">Rate</th><th class="n">Value</th><th class="n">GST</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
    (s.rates.length > 1 || s.multi ? '<h4 style="margin:10px 0 4px;font-size:14px">By GST rate</h4><div class="tblwrap"><table class="data"><thead><tr><th>Rate</th><th>HSN/SAC</th><th class="n">Taxable</th><th class="n">GST</th></tr></thead><tbody>' + rateRows + "</tbody></table></div>" : "") +
    "</details>";
}
/* ---------- what kind of paper is this, and whose is it? ---------- */
const DOC_KINDS = [
  ["proforma", /\b(proforma|performa|pro\s*-?\s*forma)\s*invoice\b|\bproforma\b/i, "a proforma invoice"],
  ["purchase_order", /\b(purchase\s*order|work\s*order|order\s*confirmation)\b|\bp\.?\s?o\.?\s*(no|number|#)/i, "a purchase order"],
  ["quotation", /\b(quotation|quote\s*(no|ref)|budgetary\s*offer)\b|\bestimate\s*(no|slip)?\b/i, "a quotation or estimate"],
  ["challan", /\b(delivery\s*challan|dispatch\s*challan|challan\s*cum)\b/i, "a delivery challan"],
  ["receipt", /\b(payment\s*receipt|money\s*receipt|advance\s*receipt|receipt\s*voucher)\b/i, "a receipt"],
  ["statement", /\b(statement\s*of\s*account|ledger\s*statement|outstanding\s*statement)\b/i, "a statement of account"]
];
const DOC_KIND_TEXT = {proforma: "a proforma invoice", purchase_order: "a purchase order", quotation: "a quotation or estimate",
  challan: "a delivery challan", receipt: "a receipt", statement: "a statement of account"};
// look only at the headings: the word "proforma" inside terms means nothing
// a credit or debit note, from its heading
function noteKindOf(lines){
  const head = [].concat(lines || []).slice(0, 25).join(" \n ");
  if (/\bcredit\s*note\b/i.test(head)) return "credit";
  if (/\bdebit\s*note\b/i.test(head)) return "debit";
  return "";
}
// a note's own number, and the invoice it is against
function noteNoOf(lines){
  const t = [].concat(lines || []).slice(0, 40).join("\n");
  const m = t.match(/\b(?:credit|debit)\s*note\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{1,30})/i) || t.match(/\b(?:cn|dn)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{1,30})/i);
  const a = t.match(/\b(?:against|original|ref(?:erence)?\.?\s*to)\s*(?:invoice|bill)?\s*(?:no|number|#)?\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{2,30})/i);
  return {no: m ? m[1].replace(/[.\-]+$/, "") : "", against: a ? a[1].replace(/[.\-]+$/, "") : ""};
}
function docKindOf(lines){
  const head = lines.slice(0, Math.min(lines.length, 25)).join(" \n ");
  const strongTax = /\b(tax\s*invoice|gst\s*invoice|invoice\s*(no|number|#))\b/i.test(head) && !/\b(proforma|performa|pro\s*-?\s*forma)\b/i.test(head);
  if (strongTax) return "";
  for (const [kind, re] of DOC_KINDS) if (re.test(head)) return kind;
  return "";
}
// which GSTIN is the bill made out to, and which is only the delivery address
function billToShipTo(lines){
  const out = {bill: "", ship: ""};
  let mode = "", left = 0;
  lines.forEach(l => {
    if (/^\s*(bill\s*to|billed\s*to|buyer|sold\s*to|invoice\s*to)\b/i.test(l)){ mode = "bill"; left = 14; }
    else if (/^\s*(ship\s*to|shipped\s*to|consignee|deliver(y)?\s*to|place\s*of\s*delivery)\b/i.test(l)){ mode = "ship"; left = 14; }
    if (!mode || left <= 0) return;
    const g = (l.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z][Z][0-9A-Z]\b/i) || [])[0];
    if (g && !out[mode]) out[mode] = g.toUpperCase();
    left--;
    if (left <= 0) mode = "";
  });
  return out;
}
function isPdf(file){ return file.type === "application/pdf" || /\.pdf$/i.test(file.name); }
function isImage(file){ return /^image\//.test(file.type) || /\.(jpe?g|jpe|jfif|pjpeg|png|webp|gif|hei[cf])$/i.test(file.name); }
/* ------------------------------------------------------------------ */
/* Free OCR (Tesseract, open source), loaded only when first needed    */
/* ------------------------------------------------------------------ */
const TESS = {
  script: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
  corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
  langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int"
};
if (window.__TESS) Object.assign(TESS, window.__TESS);
let ocrEngineP = null, ocrChain = Promise.resolve();
function loadScript(src){
  return new Promise((ok, bad) => { const el = document.createElement("script"); el.dataset.injected = "1"; el.src = src; el.onload = ok; el.onerror = () => bad({code:"ocr_script"}); document.head.appendChild(el); });
}
function withTimeout(p, ms, code){ return Promise.race([p, new Promise((_, bad) => setTimeout(() => bad({code}), ms))]); }
// The engine sits at the end of this (large) file, so wait until the page has been read in full.
function domReady(){ return document.readyState === "loading" ? new Promise(r => document.addEventListener("DOMContentLoaded", r, {once:true})) : Promise.resolve(); }
const blockCache = {};
function blockText(id){
  const el = document.getElementById(id);
  if (el) return Promise.resolve(el.textContent);
  if (!window.TDS_ASSETS) return Promise.resolve(null);
  if (!blockCache[id]) blockCache[id] = fetch(window.TDS_ASSETS + id + ".txt", {cache: "force-cache"}).then(r => {
    if (!r.ok) throw {code: "asset_missing", message: id + " could not be fetched (" + r.status + ")"};
    return r.text();
  }).catch(e => { delete blockCache[id]; throw e; });
  return blockCache[id];
}
function hasBuiltInOcr(){ return !!((document.getElementById("tess-core") && document.getElementById("tess-eng")) || window.TDS_ASSETS); }
function base64ToBytes(b64){
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function canvasPng(c){ return new Promise(r => c.toBlob(r, "image/png")); }
function parseTsv(tsv){
  const out = [];
  String(tsv || "").split("\n").forEach(line => {
    const c = line.split("\t");
    if (c.length < 12 || c[0] !== "5") return;
    const s = c.slice(11).join(" ").trim();
    if (!s) return;
    out.push({x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: +c[10], s});
  });
  return out;
}
// 1. Built-in OCR: the Tesseract engine and English data are inside this file, run in the page.
async function loadBuiltInOcr(){
  await domReady();
  if (!hasBuiltInOcr()) throw {code:"not_built_in"};
  if (typeof WebAssembly === "undefined") throw {code:"no_wasm"};
  if (typeof TesseractCore === "undefined"){
    const el = document.createElement("script");
    el.dataset.injected = "1";
    el.textContent = await blockText("tess-core");
    document.head.appendChild(el);
  }
  if (typeof TesseractCore === "undefined") throw {code:"core_blocked"};
  let Mod;
  try { Mod = await withTimeout(TesseractCore({TesseractProgress(){}}), 45000, "core_timeout"); }
  catch (e){ throw {code: e && e.code ? e.code : "wasm_blocked", message: e && e.message}; }
  if (typeof DecompressionStream === "undefined") throw {code:"old_browser"};
  const gz = base64ToBytes(String(await blockText("tess-eng")).trim());
  const raw = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  Mod.FS.writeFile("/eng.traineddata", raw);
  const api = new Mod.TessBaseAPI();
  if (api.Init("/", "eng", 1) !== 0) throw {code:"init_failed"};
  return {kind:"built-in", recognize: async (canvas, psm) => {
    const png = new Uint8Array(await (await canvasPng(canvas)).arrayBuffer());
    Mod.FS.writeFile("/input", png);
    api.SetVariable("tessedit_pageseg_mode", String(psm || "3"));
    if (api.SetImageFile(1, 0) === 1) throw {code:"ocr_image"};
    api.Recognize(null);
    const text = api.GetUTF8Text(), confidence = api.MeanTextConf();
    api.Clear();
    return {text, confidence};
  }, tsv: async (canvas) => {
    const png = new Uint8Array(await (await canvasPng(canvas)).arrayBuffer());
    const run = ocrChain.then(async () => {
      await new Promise(r => setTimeout(r, 20));
      Mod.FS.writeFile("/input", png);
      api.SetVariable("tessedit_pageseg_mode", "6");
      if (api.SetImageFile(1, 0) === 1) throw {code:"ocr_image"};
      api.Recognize(null);
      const t = api.GetTSVText(0);
      api.Clear();
      return parseTsv(t);
    });
    ocrChain = run.catch(() => {});
    return run;
  }};
}
// 2. Fallback: download the engine (for devices where the built-in one cannot start)
async function loadDownloadedOcr(){
  await withTimeout(fetch(TESS.langPath + "/eng.traineddata.gz", {method:"HEAD"}), 10000, "ocr_timeout").catch(e => { throw {code: e && e.code === "ocr_timeout" ? "ocr_timeout" : "ocr_blocked"}; });
  if (!window.Tesseract) await loadScript(TESS.script);
  const w = await withTimeout(window.Tesseract.createWorker("eng", 1, {workerPath:TESS.workerPath, corePath:TESS.corePath, langPath:TESS.langPath}), 90000, "ocr_timeout");
  return {kind:"downloaded", recognize: async (canvas, psm) => {
    await w.setParameters({tessedit_pageseg_mode: psm || "3"});
    const r = await withTimeout(w.recognize(canvas), 90000, "ocr_timeout");
    return {text: (r.data && r.data.text) || "", confidence: (r.data && r.data.confidence) || 0};
  }, tsv: async (canvas) => {
    await w.setParameters({tessedit_pageseg_mode: "6"});
    const r = await withTimeout(w.recognize(canvas, {}, {tsv: true, text: false}), 120000, "ocr_timeout");
    return parseTsv(r.data && r.data.tsv);
  }};
}
function getOcr(){
  if (S.ocrState === "unavailable") return Promise.resolve(null);
  if (!ocrEngineP){
    S.ocrState = "loading"; softRender();
    ocrEngineP = (async () => {
      try { return await loadBuiltInOcr(); }
      catch (e){ S.ocrBuiltInError = (e && e.code) || "failed"; }
      return loadDownloadedOcr();
    })()
      .then(eng => { S.ocrState = "ready"; S.ocrKind = eng.kind; softRender(); return eng; })
      .catch(e => { S.ocrState = "unavailable"; S.ocrKind = ""; S.ocrError = (e && e.code) || "failed"; softRender(); return null; });
  }
  return ocrEngineP;
}
const OCR_PROBLEMS = {
  core_blocked: "this page does not allow the built-in OCR program to start",
  wasm_blocked: "this page does not allow the built-in OCR program to run (WebAssembly is blocked)",
  core_timeout: "the built-in OCR program took too long to start",
  old_browser: "this browser is too old for the built-in OCR; update Chrome, Edge, Firefox or Safari",
  no_wasm: "this browser cannot run the OCR program",
  init_failed: "the OCR language data could not be loaded",
  ocr_blocked: "the backup OCR download is blocked here",
  ocr_script: "the backup OCR program could not be downloaded",
  ocr_timeout: "the backup OCR download took too long",
  failed: "the free OCR could not start in this browser"
};
function ocrProblem(){
  const a = OCR_PROBLEMS[S.ocrBuiltInError], b = OCR_PROBLEMS[S.ocrError];
  const txt = [a, b && b !== a ? b : ""].filter(Boolean).join("; and ") || OCR_PROBLEMS.failed;
  return txt + (window.claude ? ". Inside claude.ai this can be blocked; the standalone file (on your computer or GitHub Pages) runs it" : "");
}
// At start-up: nothing to download when the OCR is built in
async function probeOcr(){
  if (S.ocrState !== "idle") return;
  await domReady();
  if (hasBuiltInOcr() && typeof WebAssembly !== "undefined"){ S.ocrState = "available"; S.ocrKind = "built-in"; render(); return; }
  try { await withTimeout(fetch(TESS.langPath + "/eng.traineddata.gz", {method:"HEAD"}), 8000, "ocr_timeout"); S.ocrState = "available"; S.ocrKind = "downloaded"; }
  catch (e){ S.ocrState = "unavailable"; S.ocrError = (e && e.code) || "ocr_blocked"; }
  render();
}
async function testFreeOcr(){
  S.ocrTest = {busy:true}; render();
  await new Promise(r => setTimeout(r, 50));
  const c = document.createElement("canvas"); c.width = 1000; c.height = 360;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 1000, 360);
  g.fillStyle = "#111"; g.font = "bold 44px Arial, sans-serif";
  g.fillText("TAX INVOICE No: TST-4821", 40, 110); g.fillText("Grand Total 7,350.00", 40, 230);
  const t0 = Date.now();
  const o = await ocrCanvas(c, "3");
  const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
  if (!o) S.ocrTest = {ok:false, msg:"Free OCR is not working: " + ocrProblem() + "."};
  else {
    const ok = /4821/.test(o.text) && /7,?350/.test(o.text);
    S.ocrTest = {ok, msg: ok ? "Free OCR works (" + (S.ocrKind === "built-in" ? "built into this app, no download" : "downloaded engine") + "): the test image was read correctly in " + secs + " s."
      : "Free OCR started but misread the test image: \u201c" + o.text.replace(/\s+/g, " ").trim().slice(0, 80) + "\u201d."};
  }
  render();
}
/* ------------------------------------------------------------------ */
/* Google Cloud Vision OCR (optional, your own Google API key).        */
/* Much stronger than the built-in OCR on photos and handwriting.      */
/* ------------------------------------------------------------------ */
function googleSettings(){ try { return JSON.parse(lsGet("tdsdesk:gvision") || "{}"); } catch (e){ return {}; } }
function hasGoogle(){ return (!!googleSettings().key || (Cloud.on() && !!S.account && moduleEnabled("vision"))) && !window.claude; }
function moduleEnabled(code){ const m = ((S.account || {}).modules || []).find(x => x.code === code); return !m || m.enabled !== false; }
function googleAvailable(){ return !!(googleSettings().key || (Cloud.on() && S.account)); }
// Google OCR returning each word with its place on the page, so a statement's columns can be rebuilt
async function googleWords(canvas){
  const cfg = googleSettings();
  const k = Math.min(1, 3000 / Math.max(canvas.width, canvas.height));
  const blob = await canvasJpeg(canvas, Math.max(canvas.width, canvas.height) * k, 0.92);
  const body = {requests: [{image: {content: await blobToBase64(blob)}, features: [{type: "DOCUMENT_TEXT_DETECTION"}], imageContext: {languageHints: ["en", "hi"]}}]};
  let resp;
  if (Cloud.on() && S.account && !cfg.key){
    const j = await Cloud.fn("gateway", {what: "vision", qty: 1, ref: "bank statement page", payload: body});
    resp = ((j.data || {}).responses || [])[0] || {};
  } else if (cfg.key){
    const res = await withTimeout(fetch("https://vision.googleapis.com/v1/images:annotate?key=" + encodeURIComponent(cfg.key), {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}), 60000, "google_timeout");
    const data = await res.json();
    resp = ((data && data.responses) || [])[0] || {};
    if (!res.ok || resp.error) throw {code: "google_error", message: (resp.error && resp.error.message) || res.status};
  } else throw {code: "no_google_key"};
  S.googleCount = (S.googleCount || 0) + 1;
  const out = [];
  ((resp.fullTextAnnotation || {}).pages || []).forEach(pg => (pg.blocks || []).forEach(bl => (bl.paragraphs || []).forEach(pa => (pa.words || []).forEach(w => {
    const s0 = (w.symbols || []).map(x => x.text).join("");
    const v = ((w.boundingBox || {}).vertices || []), xs = v.map(q => q.x || 0), ys = v.map(q => q.y || 0);
    if (!s0 || !xs.length) return;
    const x0 = Math.min(...xs) / k, y0 = Math.min(...ys) / k, x1 = Math.max(...xs) / k, y1 = Math.max(...ys) / k;
    out.push({s: s0, x: x0, y: y0, w: x1 - x0, h: y1 - y0, conf: Math.round((w.confidence == null ? 0.9 : w.confidence) * 100)});
  }))));
  return out;
}
async function googleOcr(canvas){
  const cfg = googleSettings();
  const k = Math.min(1, 3000 / Math.max(canvas.width, canvas.height));
  const blob = await canvasJpeg(canvas, Math.max(canvas.width, canvas.height) * k, 0.92);
  const body = {requests: [{image: {content: await blobToBase64(blob)}, features: [{type: "DOCUMENT_TEXT_DETECTION"}], imageContext: {languageHints: ["en", "hi"]}}]};
  // signed in to the firm account: the platform holds the key and charges the firm
  if (Cloud.on() && S.account && !cfg.key){
    let j;
    try { j = await Cloud.fn("gateway", {what: "vision", qty: 1, ref: "ocr", payload: body}); }
    catch (e){
      if (e.reason === "low_balance"){ S.creditStop = {at: Date.now(), balance: e.balance, code: "vision"}; render(); }
      throw {code: e.reason === "low_balance" ? "no_credit" : "google_error", message: e.message};
    }
    const r0 = ((j.data || {}).responses || [])[0] || {};
    const full0 = r0.fullTextAnnotation || {};
    S.googleCount = (S.googleCount || 0) + 1;
    return {text: full0.text || "", confidence: full0.text ? 85 : 0};
  }
  if (!cfg.key) throw {code:"no_google_key"};
  let res;
  try {
    res = await withTimeout(fetch("https://vision.googleapis.com/v1/images:annotate?key=" + encodeURIComponent(cfg.key), {
      method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}), 60000, "google_timeout");
  } catch (e){ throw {code: e && e.code === "google_timeout" ? "google_timeout" : "google_blocked"}; }
  let data = null;
  try { data = await res.json(); } catch (e){ data = null; }
  const errMsg = (data && data.error && data.error.message) || (data && data.responses && data.responses[0] && data.responses[0].error && data.responses[0].error.message) || "";
  if (!res.ok || errMsg){
    const code = /referer|referrer|HTTP_REFERRER|API_KEY_(IOS|ANDROID|HTTP)/i.test(errMsg) ? "google_referrer"
      : res.status === 400 && /api key/i.test(errMsg) ? "google_bad_key"
      : res.status === 403 && /billing/i.test(errMsg) ? "google_billing"
      : res.status === 403 && /(not been used|disabled|enable)/i.test(errMsg) ? "google_not_enabled"
      : res.status === 403 ? "google_forbidden" : res.status === 429 ? "google_quota" : "google_error";
    throw {code, message: errMsg};
  }
  const r = (data.responses || [])[0] || {};
  const full = r.fullTextAnnotation || {};
  const blocks = (full.pages || []).flatMap(pg => pg.blocks || []).filter(b => typeof b.confidence === "number");
  const confidence = blocks.length ? Math.round(blocks.reduce((a, b) => a + b.confidence, 0) / blocks.length * 100) : (full.text ? 80 : 0);
  S.googleCount = (S.googleCount || 0) + 1;
  return {text: full.text || "", confidence};
}
async function dailyGoogleCheck(){
  if (!googleSettings().key || window.claude) return;   // through the platform there is no key here to check
  let last = null;
  try { last = JSON.parse(lsGet("tdsdesk:gcheck") || "null"); } catch (e){ last = null; }
  if (last && last.key === googleSettings().key.slice(-6) && Date.now() - last.at < 20 * 3600e3 && last.ok){ S.googleAuto = last; render(); return; }
  await testGoogle();
  S.googleAuto = {ok: !!(S.googleTest && S.googleTest.ok), msg: S.googleTest ? S.googleTest.msg : "", at: Date.now(), key: googleSettings().key.slice(-6)};
  lsSet("tdsdesk:gcheck", JSON.stringify(S.googleAuto));
  render();
}
// what to do when Google refuses, based on the reason it gave
function googleHelpHtml(){
  const t = S.googleTest;
  if (!t || t.busy || t.ok || !t.code) return "";
  const proj = '<a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud console \u2192 APIs &amp; Services \u2192 Credentials</a>';
  const vision = '<a href="https://console.cloud.google.com/apis/library/vision.googleapis.com" target="_blank" rel="noopener">Cloud Vision API</a>';
  const billing = '<a href="https://console.cloud.google.com/billing" target="_blank" rel="noopener">Billing</a>';
  const steps = {
    google_referrer: ["Open " + proj + " and click the API key you are using here.",
      "Under <b>Application restrictions</b> choose <b>None</b>. A website restriction cannot work here, because the app is opened as a file and the browser sends no website address.",
      "Under <b>API restrictions</b> keep <b>Restrict key</b> and tick only <b>Cloud Vision API</b>, so the key stays safe.",
      "Save, wait a minute, then press <b>Test</b> again."],
    google_not_enabled: ["Open " + vision + " and check the right project is selected at the top.",
      "Press <b>Enable</b>.", "Wait a minute and press <b>Test</b> again."],
    google_billing: ["Open " + billing + " and link a billing account to this project.",
      "The first 1,000 pages each month stay free; billing only has to be enabled.", "Press <b>Test</b> again."],
    google_bad_key: ["Open " + proj + " and copy the API key again, with no spaces.",
      "Paste it in the Google Cloud Vision OCR box below and press <b>Save and test</b>.",
      "If it still fails, create a new key and restrict it to the Cloud Vision API."],
    google_forbidden: ["Open " + proj + " and click the key.",
      "Set <b>Application restrictions</b> to <b>None</b>, and under <b>API restrictions</b> tick <b>Cloud Vision API</b>.",
      "Check that " + vision + " is enabled for the project and " + billing + " is linked.", "Press <b>Test</b> again."],
    google_quota: ["The usage limit has been reached for now. Wait, or raise the quota in the Google Cloud console.",
      "The built-in OCR keeps working in the meantime."],
    google_blocked: ["This page cannot reach Google. Open the downloaded file (TDS-Desk-standalone.html) instead of the claude.ai page.",
      "If you already use the downloaded file, check that the network or antivirus does not block vision.googleapis.com."],
    google_timeout: ["Google did not answer in time. Press <b>Test</b> again.", "If it keeps happening, check this computer's internet connection."]
  }[t.code] || ["Press <b>Test</b> again.", "If it keeps failing, send me the message above."];
  return '<div class="bdiag" style="margin-top:10px"><b>How to fix this</b><ol style="margin:8px 0 0 18px;line-height:1.55">' + steps.map(x => "<li>" + x + "</li>").join("") + "</ol></div>";
}
async function testGoogle(){
  S.googleTest = {busy: true}; render();
  const c = document.createElement("canvas"); c.width = 1000; c.height = 360;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 1000, 360);
  g.fillStyle = "#123"; g.font = "italic 46px Georgia, serif";
  g.fillText("Bill No. 4821", 40, 110); g.fillText("Total Rs 7,350/-", 40, 230);
  const t0 = Date.now();
  try {
    const o = await googleOcr(c);
    const ok = /4821/.test(o.text) && /7,?350/.test(o.text);
    S.googleTest = {ok, msg: ok ? "Google OCR works: the test image was read correctly in " + Math.max(1, Math.round((Date.now() - t0) / 1000)) + " s." : "Google OCR answered but read: \u201c" + o.text.replace(/\s+/g, " ").slice(0, 80) + "\u201d."};
  } catch (e){
    S.googleTest = {ok: false, code: (e && e.code) || "google_error", msg: errCopy(e && e.code) + (e && e.message ? " Google said: \u201c" + e.message + "\u201d" : "")};
  }
  render();
}
// Erase long horizontal and vertical lines (table borders), which confuse OCR.
function removeLines(c){
  const g = c.getContext("2d"), W = c.width, H = c.height;
  let img;
  try { img = g.getImageData(0, 0, W, H); } catch (e){ return c; }
  const d = img.data, dark = new Uint8Array(W * H), kill = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = d[i * 4] < 150 ? 1 : 0;
  const minH = Math.max(40, Math.round(W * 0.05)), minV = Math.max(40, Math.round(H * 0.025));
  for (let y = 0; y < H; y++){ let run = 0; for (let x = 0; x <= W; x++){ if (x < W && dark[y * W + x]) run++; else { if (run >= minH) for (let k = x - run; k < x; k++) kill[y * W + k] = 1; run = 0; } } }
  for (let x = 0; x < W; x++){ let run = 0; for (let y = 0; y <= H; y++){ if (y < H && dark[y * W + x]) run++; else { if (run >= minV) for (let k = y - run; k < y; k++) kill[k * W + x] = 1; run = 0; } } }
  for (let i = 0; i < W * H; i++) if (kill[i]){ d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}
// psm "3" = automatic page layout, "11" = scattered text (fields placed around the page)
async function ocrCanvas(c, psm, opts){
  const eng = await getOcr();
  if (!eng) return null;
  const long = Math.max(c.width, c.height);
  let src;
  if (long < 1000){
    const k = 1400 / long;
    src = document.createElement("canvas"); src.width = Math.round(c.width * k); src.height = Math.round(c.height * k);
    src.getContext("2d").drawImage(c, 0, 0, src.width, src.height);
  } else src = cropCanvas(c, 0, 0, c.width, c.height);
  enhanceCanvas(src);   // grey and contrast-stretched: recovers faint printed lines
  if (opts && opts.delines) removeLines(src);
  const run = ocrChain.then(async () => {
    await new Promise(r => setTimeout(r, 30));   // let the screen update first
    return eng.recognize(src, psm);
  });
  ocrChain = run.catch(() => {});
  try { const r = await run; S.ocrCount = (S.ocrCount || 0) + 1; return r; }
  catch (e){ return null; }
}

/* ------------------------------------------------------------------ */
/* Free reading: pick bill fields out of plain text with rules.        */
/* A result is accepted only when every check passes.                  */
/* ------------------------------------------------------------------ */
const FREE_GST_RATES = [0.25, 1.5, 3, 5, 6, 12, 18, 28, 40];
function ocrDigits(s){ return s.replace(/[OoQD]/g, "0").replace(/[Il|!]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/G/g, "6"); }
function ocrLetters(s){ return s.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B").replace(/2/g, "Z").replace(/6/g, "G"); }
// Candidate GSTINs, repaired by position (digits where digits belong) and by the check digit.
function findGstins(text){
  const out = [], seen = new Set();
  const lines = String(text || "").split(/\n/);
  const buyerAt = lines.findIndex(l => /(buyer|bill(ed)?\s*to|consignee|ship(ped)?\s*to|recipient|details\s+of\s+receiver)/i.test(l));
  lines.forEach((line, li) => {
    const up = line.toUpperCase().replace(/[‘’'`]/g, "");
    const re = /(?:^|[^A-Z0-9])([0-9OIQDSBZG|!]{2}\s?[A-Z0-9]{5}\s?[0-9OIQDSBZG|!]{4}\s?[A-Z0-9]\s?[A-Z0-9]\s?[Z2]\s?[A-Z0-9])(?![A-Z0-9])/g;
    let m;
    while ((m = re.exec(up))){
      const raw = m[1].replace(/\s/g, "");
      if (raw.length !== 15) continue;
      const g = ocrDigits(raw.slice(0, 2)) + ocrLetters(raw.slice(2, 7)) + ocrDigits(raw.slice(7, 11)) + ocrLetters(raw.slice(11, 12)) + raw[12] + "Z" + raw[14];
      const f = fixGstin(g);
      if (f.status === "ok" || f.status === "fixed"){
        if (seen.has(f.value)) continue;
        seen.add(f.value);
        const ctx = (lines[li - 1] || "") + " " + line + " " + (lines[li - 2] || "");
        out.push({gstin: f.value, line: li, buyerHint: (buyerAt >= 0 && li > buyerAt && li - buyerAt <= 12) || /(bill(ed)?\s*to|buyer|consignee|recipient|ship(ped)?\s*to|customer|party|m\/s|\bto\b)/i.test(ctx)});
      }
    }
    // second look, on lines that mention GST: join the pieces and try every 15-character window
    if (/G\s?\.?\s?S\s?\.?\s?T|GST|65T|6ST|C5T/i.test(up)){
      const compact = up.replace(/[^A-Z0-9|!]/g, "");
      for (let i = 0; i + 15 <= compact.length; i++){
        const raw = compact.slice(i, i + 15);
        const g = ocrDigits(raw.slice(0, 2)) + ocrLetters(raw.slice(2, 7)) + ocrDigits(raw.slice(7, 11)) + ocrLetters(raw.slice(11, 12)) + raw[12] + "Z" + raw[14];
        if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g)) continue;
        const f = fixGstin(g);
        if ((f.status === "ok" || f.status === "fixed") && !seen.has(f.value)){
          seen.add(f.value);
          const ctx = (lines[li - 1] || "") + " " + line + " " + (lines[li - 2] || "");
          out.push({gstin: f.value, line: li, buyerHint: (buyerAt >= 0 && li > buyerAt && li - buyerAt <= 12) || /(bill(ed)?\s*to|buyer|consignee|recipient|ship(ped)?\s*to)/i.test(ctx)});
        }
      }
    }
  });
  return out;
}
function parseAmount(s){
  const t = String(s).replace(/[Oo]/g, "0").replace(/[, ]/g, "");
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
}
// Amounts on a line: money-shaped numbers, not rates ("18%"), not codes.
function lineAmounts(line){
  const out = [];
  const re = /(-?\s?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)(\s*%)?/g;
  let m;
  while ((m = re.exec(line))){
    if (m[2]) continue;
    const raw = m[1];
    const hasDec = /\.\d{1,2}$/.test(raw), hasComma = raw.includes(",");
    const v = parseAmount(raw);
    if (v === null) continue;
    if (!hasDec && !hasComma && Math.abs(v) >= 100000) continue;   // phone, account or HSN numbers
    out.push({v, strong: hasDec || hasComma});
  }
  return out;
}
// A heading row of a table: several column labels, or an item-table heading.
function isHeadingRow(line){
  if (lineAmounts(line).some(a => a.strong)) return false;
  const labels = colLabels().filter(([, re]) => re.test(line)).length;
  return labels >= 2 || (/(description|particulars|item)/i.test(line) && /(qty|quantity|rate|hsn|sac|amount|value)/i.test(line));
}
function amountAfter(lines, re, opts){
  opts = opts || {};
  const hits = [];
  lines.forEach((line, i) => {
    if (!re.test(line)) return;
    if (/in\s*words|rupees\s+[a-z]/i.test(line)) return;
    let am = lineAmounts(line.replace(re, " ")).filter(a => a.strong);
    if (!am.length && lines[i + 1] && !opts.sameLineOnly && !isHeadingRow(line)) am = lineAmounts(lines[i + 1]).filter(a => a.strong);
    if (am.length) hits.push(am[am.length - 1].v);
  });
  if (!hits.length) return null;
  return opts.pick === "max" ? Math.max(...hits) : opts.pick === "first" ? hits[0] : hits[hits.length - 1];
}
const MONTHS = {jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12};
function toIsoDate(d, m, y){
  d = +d; m = +m; y = +y;
  if (y < 100) y += 2000;
  if (!(y >= 2017 && y <= 2035 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return "";
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
function datesIn(s){
  const out = [];
  let m;
  const r1 = /\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/g;
  while ((m = r1.exec(s))){ const d = toIsoDate(m[1], m[2], m[3]); if (d) out.push(d); }
  const r2 = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s\-\/.,]*(\d{4}|\d{2})\b/gi;
  while ((m = r2.exec(s))){ const d = toIsoDate(m[1], MONTHS[m[2].toLowerCase()], m[3]); if (d) out.push(d); }
  const r3 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  while ((m = r3.exec(s))){ const d = toIsoDate(m[2], MONTHS[m[1].toLowerCase()], m[3]); if (d) out.push(d); }
  return out;
}
const OTHER_DATES = /(ack(nowledge?ment)?|due|delivery|dispatch|despatch|order|p\.?\s?o|lr|gr|challan|e-?way(\s*bill)?|supply|payment|ref(erence)?|irn|valid(ity)?|expiry|birth)\.?\s*(no\.?\s*)?(&\s*)?date/i;
function findDate(lines){
  for (const re of [/(invoice|inv|bill|document|doc)\.?\s*(no\.?\s*(&|and|\/)\s*)?date/i, /\bdated?\b/i, /\bdt\.?\s/i]){
    for (let i = 0; i < lines.length; i++){
      if (!re.test(lines[i])) continue;
      // cut out other kinds of dates on the same line ("Ack Date : 10-Sep-26")
      const clean = lines[i].replace(new RegExp(OTHER_DATES.source + "\\s*[:\\-]?\\s*\\S+(\\s+\\S+)?", "ig"), " ");
      if (!re.test(clean)) continue;
      const after = clean.slice(clean.search(re));
      const d = datesIn(after)[0] || (lines[i + 1] ? datesIn(lines[i + 1])[0] : "") || (lines[i + 2] && lines[i + 2].length < 40 ? datesIn(lines[i + 2])[0] : "");
      if (d) return d;
    }
  }
  // a date wrapped by a narrow cell: "10-Sep-" on one line, "2026" on the next
  for (let i = 0; i < lines.length - 1; i++){
    if (OTHER_DATES.test(lines[i])) continue;
    const m = lines[i].match(/(?:^|\s)(\d{1,2})[\-\/.\s](jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\-\/.]?$|(?:^|\s)(\d{1,2})[\-\/.\s](jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\-\/.]\s/i);
    if (!m) continue;
    const d = m[1] || m[3], mon = (m[2] || m[4]).toLowerCase();
    for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1); k++){
      const y = lines[k].match(/(?:^|\s)(20\d{2})(?=\s|$)/);
      if (y){ const iso = toIsoDate(d, MONTHS[mon], y[1]); if (iso) return iso; }
    }
  }
  return "";
}
// ---- GST labels, tolerant of OCR ("CGSTAmL", "IGST18"), but not GSTIN ----
// OCR often reads G as 6 and I as 1 or l ("16ST", "C6ST")
const RE_CGST = /\bc\s?[g6]st(?!\s?in\b)/i, RE_SGST = /\b(s|ut)\s?[g6]st(?!\s?in\b)/i, RE_IGST = /(\bi\s?[g6]st|(?<![\w.,])[1l|][g6]st)(?!\s?in\b)/i;
const NUMBER_WORD_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|lacs?|crores?)\b/ig;
function numberWordCount(l){ return (String(l).match(NUMBER_WORD_RE) || []).length; }
// PANs printed on the bill (labelled), for suppliers without GSTIN
const PAN_HOLDER = /^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/;
function findPans(lines){
  const out = [];
  lines.forEach((l, i) => {
    const ctx = (lines[i - 1] || "") + " " + l;
    if (!/\bpan\b/i.test(ctx)) return;
    (l.toUpperCase().match(/\b[A-Z]{5}[0-9OIL]{4}[A-Z]\b/g) || []).forEach(raw => {
      const p = raw.slice(0, 5) + ocrDigits(raw.slice(5, 9)) + raw[9];
      if (PAN_HOLDER.test(p) && out.indexOf(p) < 0) out.push(p);
    });
  });
  return out;
}
// Rates printed on the bill ("18%", "@ 5%", "9 %")
function ratesShown(lines){
  const set = new Set();
  lines.forEach(l => (l.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/g) || []).forEach(m => { const v = parseFloat(m); if (FREE_GST_RATES.includes(v) || FREE_GST_RATES.includes(v * 2)) set.add(FREE_GST_RATES.includes(v * 2) && !FREE_GST_RATES.includes(v) ? v * 2 : v); }));
  return Array.from(set).sort((a, b) => a - b);
}
// ---- amount in words (Indian numbering) ----
const WORD_NUMS = {zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13,
  fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fourty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90};
const WORD_SCALES = {thousand:1e3, lakh:1e5, lakhs:1e5, lac:1e5, lacs:1e5, million:1e6, crore:1e7, crores:1e7};
function wordsValue(words){
  let total = 0, cur = 0, any = false;
  for (const w of words){
    if (w in WORD_NUMS){ cur += WORD_NUMS[w]; any = true; }
    else if (w === "hundred"){ cur = (cur || 1) * 100; any = true; }
    else if (WORD_SCALES[w]){ total += (cur || 1) * WORD_SCALES[w]; cur = 0; any = true; }
    else if (w === "and") continue;
    else return null;   // an unknown word: do not trust this reading
  }
  return any ? total + cur : null;
}
// Returns the amount written in words, only when every word was understood.
function amountInWords(lines, mode){
  for (let i = 0; i < lines.length; i++){
    const L = lines[i];
    const looks = /(in\s*words|\brupees?\b|\binr\s+[a-z]|\brs\.?\s+[a-z]{3,})/i.test(L) || (/\bonly\b/i.test(L) && numberWordCount(L) >= 2);
    if (!looks) continue;
    const isTax = /\b(tax|gst)\s*(amount|amt)?\b.*in\s*words|\btax\s*amount\b/i.test(L);
    if ((mode === "tax") !== isTax) continue;
    const parts = [];
    for (let k = i; k < Math.min(lines.length, i + 4); k++){
      const l = lines[k].toLowerCase();
      if (k > i && /\d/.test(l)) continue;             // a figures line placed in between
      if (k > i && !numberWordCount(l) && !/\bonly\b/.test(l)) { if (parts.length) break; else continue; }
      let seg = l;
      if (k === i){
        if (/(rupees?|inr|rs\.?)\s+[a-z]/.test(l) && numberWordCount(l.replace(/^.*?(rupees?|inr|rs\.?)\s+/, "")) > 0) seg = l.replace(/^.*?(rupees?|inr|rs\.?)\s+/, "");
        else if (/in\s*words/.test(l)) seg = l.replace(/^.*in\s*words\)?\s*[:\-]?/, "");
        else if (numberWordCount(l) >= 2){
          // "Eighteen Thousand Nine Hundred Rupees only", or a misread "Res. Thirty One ..."
          const m = l.match(/((?:\b[a-z]+\b[\s,\-]*)+?)\s*(?:rupees?\s*)?only\b/);
          seg = m ? m[1] : l;
          seg = seg.replace(/^.*?\b(?=(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)\b)/, "");
        } else continue;
      }
      parts.push(seg);
      if (/\bonly\b/.test(l)) break;
    }
    const text = parts.join(" ").replace(/\bonly\b.*$/, "").replace(/[^a-z\s]/g, " ");
    const words = text.split(/\s+/).filter(w => w && !/^(rupees?|inr|rs|indian|res)$/.test(w));
    if (!words.length) continue;
    const pi = words.indexOf("paise");
    let rup = words, pai = [];
    if (pi >= 0){
      const andIdx = words.lastIndexOf("and", pi);
      rup = words.slice(0, andIdx >= 0 ? andIdx : pi);
      pai = words.slice(andIdx >= 0 ? andIdx + 1 : pi, pi);
      if (words.slice(pi + 1).length) continue;
    }
    const r = wordsValue(rup);
    if (r === null || r <= 0) continue;
    const p = pai.length ? wordsValue(pai) : 0;
    if (p === null) continue;
    return Math.round((r + p / 100) * 100) / 100;
  }
  return null;
}
// ---- GST summary tables: labels in one row, amounts in the row below ----
function colLabels(){ return COL_LABELS; }
const COL_LABELS = [
  ["taxable", /tax'?\s?able\s*(value|amount|amt)?|assessable/i],
  ["cgst", /\bc\s?gst(?!\s?in\b)/i], ["sgst", /\b(s|ut)\s?gst(?!\s?in\b)/i], ["igst", /\bi\s?gst(?!\s?in\b)/i],
  ["total", /(total\s*(inv(oice)?\.?\s*)?(value|amount|amt)|invoice\s*(value|total|amount)|grand\s*total|amount\s*payable)/i]
];
function tableColumns(lines){
  const found = {};
  for (let i = 0; i < lines.length - 1; i++){
    const l = lines[i];
    if (lineAmounts(l).some(a => a.strong)) continue;
    const hits = [];
    for (const [k, re] of COL_LABELS){ const m = l.match(re); if (m) hits.push({k, at: m.index}); }
    if (hits.length < 2) continue;
    hits.sort((a, b) => a.at - b.at);
    for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++){
      const am = lineAmounts(lines[j]).filter(a => a.strong);
      if (am.length >= hits.length){
        const vals = am.slice(-hits.length);
        hits.forEach((h, idx) => { if (found[h.k] === undefined) found[h.k] = vals[idx].v; });
        break;
      }
    }
  }
  return found;
}
// IGST / CGST / SGST / UTGST mentioned as a tax line (not "GSTIN")
function gstShown(lines){ return lines.some(l => (RE_CGST.test(l) || RE_SGST.test(l) || RE_IGST.test(l)) && !/\b(0(\.0+)?\s*%|nil|exempt)/i.test(l)); }
function amountShown(lines, v){
  if (v === null || v === undefined) return false;
  return lines.some(l => lineAmounts(l).some(a => Math.abs(a.v - v) < 0.01));
}
// ---- Reconcile the figures: total − GST must equal a taxable value printed on the bill ----
function taxWordsAmount(lines){ return amountInWords(lines, "tax"); }
function reconcileFigures(lines, found){
  const round = v => Math.round(v * 100) / 100;
  const totals = [], gsts = [];
  const addT = (v, w, from) => { if (v > 0) totals.push({v: round(v), w, from}); };
  const addG = (v, w, parts, from) => { if (v >= 0) gsts.push({v: round(v), w, parts, from}); };
  const hasI = lines.some(l => RE_IGST.test(l)), hasCS = lines.some(l => RE_CGST.test(l) || RE_SGST.test(l));
  // CGST+SGST inside a state, IGST across states; the GSTIN state codes decide when the labels do not
  const split = g => (hasI && !hasCS) ? {igst: g} : (hasCS && !hasI) ? {cgst: round(g / 2), sgst: round(g / 2)}
    : (found.supplierState && found.buyerState && found.supplierState !== found.buyerState) ? {igst: g} : {cgst: round(g / 2), sgst: round(g / 2)};
  addT(found.inWords, 3, "amount in words");
  addT(found.total, 2, "total line");
  addT(found.tblTotal, 1, "summary table");
  lines.forEach((l, i) => {
    if (/^(grand\s*)?total\b/i.test(l) && !/(tax|qty|quantity)/i.test(l)){
      let am = lineAmounts(l).filter(a => a.strong);
      if (!am.length && lines[i + 1]) am = lineAmounts(lines[i + 1]).filter(a => a.strong).slice(-1);
      if (am.length === 1 || (am.length > 1 && /(₹|rs\.?|inr)/i.test(l))) addT(am[am.length - 1].v, /(₹|rs\.?|inr)/i.test(l) ? 2 : 1, "total line");
    }
    if (/\b(net\s*amount|net\s*payable|amount\s*payable|total\s*inv\.?\s*(amt|amount|value))\b/i.test(l)){
      const am = lineAmounts(l).filter(a => a.strong);
      if (am.length) addT(am[am.length - 1].v, 1, "total line");
    }
  });
  // GST lines
  const igstL = [], cgstL = [], sgstL = [];
  lines.forEach(l => {
    const am = lineAmounts(l).filter(a => a.strong).map(a => a.v).filter(v => v > 0);
    if (!am.length) return;
    const i = RE_IGST.test(l), c = RE_CGST.test(l), s = RE_SGST.test(l);
    if (i && !c && !s) igstL.push(am[am.length - 1]);
    else if (c && !s && !i) cgstL.push(am[am.length - 1]);
    else if (s && !c && !i) sgstL.push(am[am.length - 1]);
  });
  const uniq = a => Array.from(new Set(a));
  uniq(igstL).forEach(v => addG(v, 2, {igst: v}, "IGST line"));
  if (uniq(igstL).length > 1) addG(uniq(igstL).reduce((a, b) => a + b, 0), 2, {igst: round(uniq(igstL).reduce((a, b) => a + b, 0))}, "IGST lines added");
  uniq(cgstL).forEach(c => { if (sgstL.some(s => Math.abs(s - c) < 0.01)) addG(c * 2, 2, {cgst: c, sgst: c}, "CGST + SGST lines"); });
  if (uniq(cgstL).length > 1){
    const cs = round(uniq(cgstL).reduce((a, b) => a + b, 0)), ss = round(uniq(sgstL).reduce((a, b) => a + b, 0));
    if (Math.abs(cs - ss) < 0.02) addG(cs + ss, 2, {cgst: cs, sgst: ss}, "CGST + SGST lines added");
  }
  const tw = taxWordsAmount(lines);
  if (tw !== null) addG(tw, 3, split(tw), "tax amount in words");
  if (found.tblGst) addG(found.tblGst, 1, found.tblParts, "summary table");
  if (!gstShown(lines)) addG(0, 1, {}, "no GST on the bill");
  // table rows where the largest amount is the sum of the others: taxable + tax(es) = total
  lines.forEach(l => {
    const am = lineAmounts(l).filter(a => a.strong).map(a => a.v).filter(v => v > 0);
    if (am.length < 3 || am.length > 14) return;
    const M = Math.max(...am), rest = am.filter((v, k) => k !== am.indexOf(M));
    for (let a = 0; a < rest.length; a++) for (let b = 0; b < rest.length; b++){
      if (b === a) continue;
      if (Math.abs(rest[a] + rest[b] - M) < 0.02 && rest[a] > rest[b]){ addT(M, 2, "table row"); addG(rest[b], 2, split(rest[b]), "table row"); }
      for (let c = b + 1; c < rest.length; c++){
        if (c === a || rest[a] <= rest[b]) continue;
        if (Math.abs(rest[a] + rest[b] + rest[c] - M) < 0.02 && Math.abs(rest[b] - rest[c]) < 0.01){ addT(M, 2, "table row"); addG(rest[b] + rest[c], 2, {cgst: rest[b], sgst: rest[c]}, "table row"); }
      }
    }
  });
  // a single-rate bill: total ÷ (1 + rate) is a printed taxable value, and the difference is printed as tax
  totals.filter(t => t.w >= 2).forEach(t => FREE_GST_RATES.forEach(r => {
    const tx = round(t.v / (1 + r / 100)), g = round(t.v - tx);
    if (g > 0 && amountShown(lines, tx) && (amountShown(lines, g) || amountShown(lines, round(g / 2)))) addG(g, 2, split(g), "rate " + r + "% on a printed taxable value");
  }));
  const rates = ratesShown(lines);
  const rateOk = (g, tx) => {
    const eff = g / tx * 100;
    if (FREE_GST_RATES.some(r => Math.abs(eff - r) <= 0.15)) return true;
    // several rates on one bill: the overall rate lies between the lowest and highest printed rate
    return rates.length >= 2 && eff > rates[0] + 0.05 && eff < rates[rates.length - 1] - 0.05 ? "mixed" : false;
  };
  const shownAmounts = [];
  lines.forEach(l => lineAmounts(l).forEach(a => { if (a.strong && a.v > 0) shownAmounts.push(a.v); }));
  const roLines = [0];
  lines.forEach(l => { if (/(round(ed)?\s*[-]?\s*off|\br\s*[\/i1l]\s*o(ff)?\b)/i.test(l)) lineAmounts(l).forEach(a => { if (Math.abs(a.v) <= 1 && a.v !== 0) roLines.push(a.v, -a.v); }); });
  let best = null;
  for (const t of totals) for (const g of gsts){
    let tx = null, ro = 0, roPenalty = 0;
    for (const r of roLines){ const c = round(t.v - g.v - r); if (c > 0 && amountShown(lines, c)){ tx = c; ro = r; break; } }
    if (tx === null){
      // round off not printed or not read: accept a printed taxable value within ₹1
      const want = t.v - g.v;
      const near = shownAmounts.filter(v => Math.abs(v - want) <= 1 && Math.abs(v - want) > 0.005).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
      if (near){ tx = near; ro = round(want - near); roPenalty = 1; }
    }
    if (tx === null || tx <= 0) continue;
    const rk = g.v > 0 ? rateOk(g.v, tx) : true;
    if (!rk) continue;
    const score = t.w + g.w + (ro === 0 ? 1 : 0) - roPenalty - (rk === "mixed" ? 1 : 0)
      + totals.filter(x => x !== t && Math.abs(x.v - t.v) < 0.01).length + gsts.filter(x => x !== g && Math.abs(x.v - g.v) < 0.01).length;
    if (!best || score > best.score) best = {score, total: t.v, taxable: tx, gst: g.v, parts: g.parts, ro, mixed: rk === "mixed" ? rates : null, from: [t.from, g.from]};
  }
  return best;
}
// ---- Bill number: pick the most invoice-like token on a line ----
function invoiceTokenScore(tok, line){
  if (!/\d/.test(tok) || tok.length < 2) return -9;
  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(tok) || /^\d{1,2}-[a-z]{3}-\d{2,4}$/i.test(tok)) return -9;   // dates
  if (/^\d+(st|nd|rd|th)$/i.test(tok) || /^\d{6}$/.test(tok) || /^\d{10,}$/.test(tok)) return -9;               // floors, PIN codes, phone / account numbers
  if (GSTIN_RE.test(tok.toUpperCase())) return -9;
  let s = 0;
  if (/(^|[\/\-])(20)?(\d{2})[\-\/](20)?(\d{2})([\/\-]|$)/.test(tok)){
    const m = tok.match(/(?:20)?(\d{2})[\-\/](?:20)?(\d{2})/);
    if (m && (+m[1] + 1) % 100 === +m[2] % 100) s += 6;       // financial year inside: 2026-27
  }
  if (/\//.test(tok)) s += 2;
  if (tok.length >= 5) s += 1;
  if (/^(b|t|a|c|d|e|f|g|h|plot|sector|block|flat|shop|unit|floor|gali|wz|rz)[\-\/]?\d{1,3}$/i.test(tok)) s -= 4;   // address bits: B-17, T-01, Sector-3
  const before = line.slice(0, line.indexOf(tok)).toLowerCase();
  if (/(floor|sector|plot|block|road|nagar|street|near|tower|building|khasra|house|pin)\W*$/.test(before)) s -= 3;
  return s;
}
function bestInvoiceToken(line, minScore){
  const toks = (line.match(/[A-Za-z0-9][A-Za-z0-9\/\-_.]{0,29}/g) || []).map(t => t.replace(/[.\-\/]+$/, ""));
  let best = null;
  toks.forEach(t => { const sc = invoiceTokenScore(t, line); if (sc >= minScore && (!best || sc > best.sc)) best = {t, sc}; });
  return best ? best.t : "";
}
function findInvoiceNo(lines, fileName){
  const labels = [/(tax\s*)?invoice\s*(no|number|num|#)\.?/i, /(?:^|\s)#(?=\s*[A-Z]{0,6}[\-\/]?\d)/, /\binv\.?\s*(no|number|#)\.?/i, /(bill|document|doc|voucher|memo|challan)\s*(no|number|#)\.?/i, /\bserial\s*no\.?/i, /\bsr\.?\s*no\.?/i];
  const isDate = t => /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(t);
  const pick = str => {
    const t = (String(str).replace(/^((\s*(&|and|\/)\s*date)|[\s:.\-#])+/i, "").match(/^([A-Za-z0-9][A-Za-z0-9\/\-_.]{0,29})/) || [])[1];
    return t && /\d/.test(t) && !isDate(t) ? t.replace(/[.\-\/]+$/, "") : "";
  };
  for (const re of labels){
    for (let i = 0; i < lines.length; i++){
      const m = lines[i].match(re);
      if (!m) continue;
      const got = pick(lines[i].slice(m.index + m[0].length));
      if (got && invoiceTokenScore(got, lines[i]) > -3) return got;
      // labels in a heading row, value in the row below (often next to address text)
      for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1); k++){
        const shortLine = (lines[k].match(/[A-Za-z0-9][A-Za-z0-9\/\-_.]*/g) || []).length <= 2;
        const tok = bestInvoiceToken(lines[k], shortLine ? 0 : 2);
        if (tok && !(shortLine && /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(tok))) return tok;
      }
    }
  }
  // financial-year style numbers: "PRI/26-27/0214", "INV/2026-27/214", also when a narrow cell wraps them
  const fy = (a, b) => { a = +a % 100; b = +b % 100; return (a + 1) % 100 === b; };
  for (const l of lines){
    const m = l.match(/(?:^|\s)([A-Z]{1,10}[\/\-])?((?:20)?(\d{2})[\-\/](?:20)?(\d{2}))[\/\-]((?:[A-Z]{1,8}[\/\-])?[A-Z]{0,4}\d{1,8})(?=\s|$)/);
    // a date such as 09-10-2026 also looks like this, so without a prefix the last part must not be a year
    if (m && fy(m[3], m[4]) && (m[1] || !/^(19|20)?\d{2}$/.test(m[5]))) return m[0].trim();
  }
  for (let i = 0; i < lines.length - 1; i++){
    const a = lines[i].match(/(?:^|\s)([A-Z]{1,10}[\/\-](?:20)?(\d{2})[\-\/])$|(?:^|\s)([A-Z]{1,10}[\/\-](?:20)?(\d{2})[\-\/])\s/);
    if (!a) continue;
    const head = a[1] || a[3], y1 = a[2] || a[4];
    for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1); k++){
      const b = lines[k].match(/(?:^|\s)((?:20)?(\d{2})[\/\-]([A-Z]{0,4}\d{1,8}))(?=\s|$)/g) || [];
      for (const cand of b){
        const mm = cand.trim().match(/^(?:20)?(\d{2})[\/\-]([A-Z]{0,4}\d{1,8})$/);
        if (mm && fy(y1, mm[1])) return head + cand.trim();
      }
    }
  }
  // the file name, e.g. "Supplier inv-214.pdf", only if that number is also printed on the bill
  const fm = String(fileName || "").match(/(?:inv(?:oice)?|bill)[\s_\-#.]*([A-Za-z0-9\/\-]{1,20}?\d[A-Za-z0-9\/\-]*)/i);
  if (fm){
    const tok = fm[1].replace(/\.(pdf|jpe?g|png|webp)$/i, "");
    const re = new RegExp("(^|[^A-Za-z0-9])" + tok.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + "([^A-Za-z0-9]|$)");
    if (lines.some(l => re.test(l))) return tok;
  }
  return "";
}
const NAME_SKIP = /(tax\s*invoice|invoice|original|duplicate|triplicate|recipient|gstin|pan\b|phone|mob|e-?mail|www\.|bill\s*of\s*supply|cash\s*memo|credit|debit|state|page\s*\d|deals\s+in|dealers?\s+in|manufacturers?\s+of|khasra|plot|road|nagar|enclave|sector|near\b|@|^\W*$)/i;
// Tally adds the financial year to company names: "ABC TRADERS PVT LTD (2026-2027)"
function stripFyName(n){ return String(n || "").replace(/\s*[\(\[]\s*(fy\s*)?(20)?\d{2}\s*[-\/]\s*(20)?\d{2}\s*[\)\]]\s*$/i, "").replace(/\s+(fy\s*)?20\d{2}\s*-\s*(20)?\d{2}\s*$/i, "").trim(); }
// the name in the signature block: "For M/s. ABC & Associates" below the totals, followed by a designation
function signatureName(lines){
  let from = -1;
  lines.forEach((l, i) => { if (/(grand\s*)?total|amount\s*(chargeable|in\s*words)|rupees|\bonly\b|thanking|yours\s+(faithfully|truly|sincerely)/i.test(l)) from = i; });
  for (let i = lines.length - 1; i > from && i >= 0; i--){
    const m = lines[i].match(/^\s*for\s+(?:m\/?s\.?\s*)?(.{3,80}?)\s*[:,.]?\s*$/i);
    if (!m) continue;
    const nm = stripFyName(m[1].trim());
    if (/^(the|your|our|any|all|this|period|year|month|quarterly|monthly|annual|services?|supply)\b/i.test(nm) || /\d{3}/.test(nm)) continue;
    const next = lines.slice(i + 1, i + 6).join(" ");
    if (/(chartered|accountants?|proprietor|partner|director|authori[sz]ed|signatory|advocate|manager|\bsd\/?-)/i.test(next)) return nm;
  }
  return "";
}
const RIGHT_COL_LABELS = /\s+(invoice\s*no|inv\.?\s*no|bill\s*no|dated?\b|delivery\s*note|reference\s*no|buyer'?s\s*order|dispatch|destination|e-?way|mode\s*\/?\s*terms|place\s+of\s+supply)/i;
// the first line of a letterhead, cut before the address or a right-hand column
function letterheadName(line){
  const l = String(line || "").split(RIGHT_COL_LABELS)[0];
  return stripFyName(l.split(/\s+(?=(?:near|opp\.?|opposite|behind|plot|shop|house|h\.?\s*no|flat|sector|road|street|st\.|floor|gate|bazar|bazaar|market|nagar|colony|phase|village|p\.?o\.?|dist|tehsil|\d)\b)/i)[0].replace(/[,;:]+$/, "").trim());
}
const DOC_TITLE = /\s*\b((gst\s*|tax\s*|retail\s*|proforma\s*|commercial\s*)?invoice|bill\s+of\s+supply|rent\s+bill|cash\s+memo|estimate|quotation|receipt|debit\s+note|credit\s+note)\s*$/i;
const DESIGNATION = /^(advocates?|chartered\s+accountants?|company\s+secretar(y|ies)|cost\s+accountants?|architects?|consultants?|proprietor|partner|doctor|dr\.?\s|engineers?)\b/i;
function cleanName(l){ return stripFyName(String(l || "").replace(DOC_TITLE, "").replace(/^(from|name)\s*[:\-]\s*/i, "").replace(/^(sh|shri|smt|mr|mrs|ms|m\/s)\.?\s+/i, "").replace(/[,;:]+$/, "").trim()); }
function guessVendorName(lines, firstGstinLine, clientName){
  const own = n => clientName && (normName(n) === normName(clientName) || nameSim(n, clientName) >= 0.85);
  // lines belonging to "Bill to" / "Ship to" / "Consignee" are the other side, never the seller
  const blocked = new Set();
  lines.forEach((l, i) => {
    if (/^\s*(bill\s*to|billed\s*to|ship\s*to|shipped\s*to|consignee|buyer|deliver(y)?\s*to|sold\s*to)\b/i.test(l)){
      for (let k = i; k < Math.min(lines.length, i + 7); k++) blocked.add(k);
    }
  });
  const sentence = l => l.split(" ").length > 9 || /\b(we|hereby|enclose|kindly|please|thanking|dear|sir|madam|regards|reg:|subject|sub:)\b/i.test(l);
  const firmLike = /(associates|& co\b|\bco\.|company|llp|pvt|ltd|limited|enterprises|traders|trading|services|agency|agencies|consultancy|industries|solutions|systems|computers|technologies|corporation|& sons|electricals?|electronics|hardware|stores|mart|works|motors|pharma|medicos?|foods|transport|logistics|carriers|printers|packaging)/i;
  // boilerplate that is never a supplier's name
  const JUNK = /(rupees|paisa|amount\s*in\s*words|e\.?\s?&\s?o\.?\s?e|terms|conditions|warranty|declaration|authoris|signator|jurisdiction|customer\s*care|page\s*\d|subject to|bank\s*details|ifsc|branch\s*code|a\/?c\s*no|gstin|state\s*name|place\s*of\s*supply|^total\b|^sub\s*total)/i;
  const usable = l => l.length >= 4 && !sentence(l) && !own(l) && !NAME_SKIP.test(l) && !DESIGNATION.test(l) && !JUNK.test(l) && /[A-Za-z]{3}/.test(l) && !/^(to|from|bill\s*to|buyer|party)\b\s*[:,]?$/i.test(l);
  const raw = lines.slice(0, 8);
  const top = raw.map((l, i) => (blocked.has(i) ? "" : cleanName(letterheadName(l))));
  const sig = signatureName(lines);
  if (sig && !own(sig)){
    const hit = top.find(l => l && (normName(l) === normName(sig) || nameSim(l, sig) >= 0.8));
    return hit || cleanName(sig);
  }
  // a person's name with the designation on the next line ("SURESH KUMAR SHARMA" / "Advocate, Delhi High Court")
  for (let i = 0; i < 4; i++) if (top[i] && usable(top[i]) && DESIGNATION.test(raw[i + 1] || "")) return top[i];
  // "From:" followed by the name
  const fi = raw.findIndex(l => /^from\s*[:\-]/i.test(l));
  if (fi >= 0){
    const same = cleanName(letterheadName(raw[fi].replace(/^from\s*[:\-]\s*/i, "")));
    if (same && usable(same) && !/^(bill|invoice)\b/i.test(same)) return same;
    for (let i = fi + 1; i < Math.min(raw.length, fi + 3); i++) if (top[i] && usable(top[i])) return top[i];
  }
  const firm = top.slice(0, 3).find(l => l && usable(l) && firmLike.test(l));
  if (firm) return firm;
  const caps = top.slice(0, 2).find(l => l && usable(l) && l === l.toUpperCase() && l.split(" ").length >= 2 && l.split(" ").length <= 6);
  if (caps) return caps;
  // the seller is named above the item table, never in the terms at the foot
  let headEnd = lines.findIndex(l => /(item\s*name|description|particulars|goods)/i.test(l) && /(hsn|sac|qty|quantity|rate|amount)/i.test(l));
  if (headEnd < 0) headEnd = lines.findIndex(l => /(sub\s*total|grand\s*total|amount\s*in\s*words|taxable\s*value)/i.test(l));
  if (headEnd < 5) headEnd = Math.max(8, Math.round(lines.length * 0.4));
  // when the supplier's GSTIN is on the bill, the seller's name is written beside it
  const near = firstGstinLine >= 0 ? {from: Math.max(0, firstGstinLine - 6), to: firstGstinLine + 6} : null;
  const keep = lines.map((l, i) => (blocked.has(i) || i > headEnd || (near && (i < near.from || i > near.to)) ? "" : l));
  const guess = cleanName(guessVendorNameOld(keep.filter(l => l && usable(l)), firstGstinLine));
  return guess && usable(guess) && guess.split(" ").filter(w => /[A-Za-z]{2}/.test(w)).length >= 2 ? guess : "";
}
function guessVendorNameOld(lines, firstGstinLine){
  // the supplier's name is near the top, before the "To / Bill to / M/s" block
  let stop = lines.findIndex(l => /^(to\b|bill(ed)?\s*to|m\/s\b|buyer|consignee|ship(ped)?\s*to|details\s+of\s+(receiver|recipient))/i.test(l));
  if (stop < 0 || stop > 14) stop = 14;
  const top = lines.slice(0, Math.max(3, stop));
  const TITLE_BITS = /(tax\s*invoice|\(?\s*e-?\s*invoice\s*\)?|original\s+for\s+(the\s+)?(recipient|buyer)|(duplicate|triplicate)(\s+for\s+\w+)?|bill\s+of\s+supply|cash\s+memo|retail\s+invoice|invoice)/ig;
  const RIGHT_COL = /\b(invoice\s*no|inv\.?\s*no|bill\s*no|dated?\b|delivery\s*note|reference\s*no|buyer'?s\s*order|dispatch|destination|e-?way|mode\s*\/?\s*terms|place\s+of\s+supply)/i;
  const cands = top.map(l => l.split(RIGHT_COL)[0].replace(/\s{2,}.*/, "").replace(TITLE_BITS, " ").replace(/[^A-Za-z0-9&.,()' \-]/g, " ").replace(/\s+/g, " ").trim())
    .filter(l => l.length >= 4 && !NAME_SKIP.test(l) && /[A-Za-z]{3}/.test(l) && (l.match(/\d/g) || []).length <= 2);
  const scored = cands.map(l => ({l, s: (/(pvt|ltd|limited|llp|traders|enterprises|industries|agency|agencies|company|co\.|associates|services|carriers|solutions|stores|& sons)/i.test(l) ? 5 : 0) + (l === l.toUpperCase() ? 3 : 0) + Math.min(l.length, 40) / 20}));
  scored.sort((a, b) => b.s - a.s);
  return scored.length ? scored[0].l : "";
}
const NATURE_WORDS = [
  ["rent_machinery", /(hire|rent(al)?)\s+(of\s+|charges\s+for\s+)?(machine|machinery|equipment|crane|jcb|generator|dg\s*set)/i],
  ["rent_building", /\b(rent|lease\s*rent|licen[cs]e\s+fee)\b/i],
  ["professional", /(professional\s+(fee|charge|service)|consultan|legal\s+(fee|service)|audit\s+fee|advocate|architect|retainer|ind\s*as\b|financial\s+statements|statutory\s+audit|tax\s+audit|internal\s+audit|income\s*tax\s+return|valuation\s+report|certification\s+fee)/i],
  ["technical", /(technical\s+service|software\s+(implementation|support)|it\s+support|annual\s+maintenance|\bamc\b|cloud\s+(computing|hosting|services?)|\bvps\b|server\s+(hosting|rental)|web\s+hosting|data\s*cent(er|re))/i],
  ["commission", /(commission|brokerage)/i],
  ["interest", /\binterest\s+(on|charged|amount)\b/i],
  ["contractor", /(freight|cartage|carriage|transportation\s+charges|labou?r\s+charges?|job\s*work|contract|loading|unloading|repair|catering|advertis|manpower|security\s+service|printing\s+charges)/i]
];
// The item lines: between the table heading and the totals.
function itemLines(lines){
  const head = lines.findIndex(l => /(description|particulars|item|goods|services)/i.test(l) && /(qty|quantity|rate|amount|hsn|sac)/i.test(l));
  const start = head >= 0 ? head + 1 : 0;
  let end = lines.findIndex((l, i) => i > start && /(taxable|sub\s*-?\s*total|total\s*before|grand\s*total|\btotal\b)/i.test(l));
  if (end < 0) end = Math.min(lines.length, start + 15);
  return lines.slice(start, end).filter(l => /[A-Za-z]{3}/.test(l) && lineAmounts(l).some(a => a.strong) && !/\b(c|s|i|ut)?\s?gst\b|\btax\b|round\s*off|\btotal\b/i.test(l));
}
const SAC_NATURE = [["9982", "professional"], ["9983", "technical"], ["9985", "contractor"], ["9987", "contractor"], ["9954", "contractor"], ["9965", "contractor"], ["9966", "contractor"], ["9967", "contractor"], ["9972", "rent_building"], ["9973", "rent_machinery"]];
function guessNature(items){
  const t = items.join(" \n");
  for (const [id, re] of NATURE_WORDS) if (re.test(t)) return {id, how: "item description"};
  const sac = (t.match(/\b99\d{2,4}\b/) || [])[0];
  if (sac){ const hit = SAC_NATURE.find(([code]) => sac.startsWith(code)); if (hit) return {id: hit[1], how: "SAC code " + sac}; }
  const codes = t.match(/\b\d{4,8}\b/g) || [];
  if (codes.length && codes.every(c => !/^99/.test(c)) && /(kgs?|pcs|nos|units?|mtrs?|ltrs?|bags?|boxes|qty)/i.test(t)) return {id: "goods", how: "HSN codes and quantities"};
  return null;
}
// Returns {ok, j, cid, why[]}. j has the same shape Claude returns.
function freeParse(text, cid, fileName, opts){
  opts = opts || {};
  const why = [];
  const lines = String(text || "").split(/\n/).map(l => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const gstins = findGstins(text);
  // which client is this for?
  let buyer = null;
  const cos = Object.values(S.companies);
  if (!cid){
    for (const g of gstins){ const c = cos.find(x => x.gstin === g.gstin); if (c){ cid = c.id; buyer = g; break; } }
    if (!cid){
      for (const g of gstins){ const c = cos.filter(x => (x.pan || (x.gstin || "").slice(2, 12)) === g.gstin.slice(2, 12)); if (c.length === 1){ cid = c[0].id; buyer = g; break; } }
    }
  } else {
    const co = CO(cid);
    buyer = gstins.find(g => g.gstin === co.gstin) || gstins.find(g => co.pan && g.gstin.slice(2, 12) === co.pan) || null;
  }
  if (!buyer) buyer = gstins.find(g => g.buyerHint && gstins.indexOf(g) > 0) || null;
  // the client's own sales invoice: its GSTIN is in the seller's header, and the other GSTIN is under Bill to
  let salesOf = null;
  if (buyer && cid && CO(cid) && buyer.gstin === CO(cid).gstin && !buyer.buyerHint && (gstins.some(g => g !== buyer && g.buyerHint && g.line > buyer.line) || (gstins.length === 1 && buyer.line <= 8))) salesOf = cid;
  const supplier = gstins.find(g => g !== buyer && !(cid && CO(cid) && g.gstin === CO(cid).gstin)) || null;
  // an unregistered supplier (landlord, advocate): PAN instead of GSTIN, and no GST
  let supplierPan = "";
  if (!supplier){
    const buyerPan = buyer ? buyer.gstin.slice(2, 12) : (cid && CO(cid) ? (CO(cid).pan || (CO(cid).gstin || "").slice(2, 12)) : "");
    const inGstins = gstins.map(g => g.gstin.slice(2, 12));
    supplierPan = findPans(lines).find(p => p !== buyerPan && inGstins.indexOf(p) < 0) || "";
    if (!supplierPan) why.push("supplier GSTIN not found");
  }

  let invoiceNo = findInvoiceNo(lines, fileName);
  let noNumber = false;
  if (!invoiceNo){
    const dt = findDate(lines);
    if (dt && /\b(bill|invoice|fees?)\b/i.test(lines.join(" ")) && !/\b(invoice|bill)\s*(no|number|#)/i.test(lines.join(" "))){
      invoiceNo = "Bill dt " + dt.slice(8, 10) + "." + dt.slice(5, 7) + "." + dt.slice(0, 4);
      noNumber = true;
    } else why.push("bill number not found");
  }
  const invoiceDate = findDate(lines);
  if (!invoiceDate) why.push("date not found");

  let total = amountAfter(lines, /(grand\s*total|invoice\s*(total|value|amount)|total\s*(invoice\s*)?(amount|value|amt)(\s*after\s*tax)?|amount\s*payable|net\s*payable|bill\s*amount|total\s*amount|total\s*\((rs|inr|₹)\.?\)|^total\s*(₹|rs\.?|inr)\s*[\d,]+\.\d{2}$)/i);
  let taxable = amountAfter(lines, /(tax'?\s?able\s*(value|amount|amt)|total\s*taxable|sub\s*-?\s*total|total\s*before\s*tax|assessable\s*value|amount\s*before\s*tax)/i, {pick:"max"});
  let cgst = amountAfter(lines, RE_CGST, {pick:"max", sameLineOnly:true}) || 0;
  let sgst = amountAfter(lines, RE_SGST, {pick:"max", sameLineOnly:true}) || 0;
  let igst = amountAfter(lines, RE_IGST, {pick:"max", sameLineOnly:true}) || 0;
  const ro = amountAfter(lines, /(round(ed)?\s*[-]?\s*off|\br\s*\/\s*o\b)/i, {sameLineOnly:true}) || 0;
  const extraChecks = [];
  // GST summary tables (labels in one row, amounts below)
  const tbl = tableColumns(lines);
  const lineGst = cgst + sgst + igst;
  const lineOk = total !== null && taxable !== null && Math.abs(taxable + lineGst - total) <= 1.0 && (lineGst > 0 || taxable !== total || !gstShown(lines));
  const tblGst = (tbl.cgst || 0) + (tbl.sgst || 0) + (tbl.igst || 0);
  const tableOk = tbl.total !== undefined && tbl.taxable !== undefined && Math.abs(tbl.taxable + tblGst - tbl.total) <= 1.0;
  if (tableOk){
    total = tbl.total; taxable = tbl.taxable;
    cgst = tbl.cgst || 0; sgst = tbl.sgst || 0; igst = tbl.igst || 0;
    extraChecks.push("figures from the GST summary table");
  } else if (!lineOk && (tbl.total !== undefined || tbl.taxable !== undefined)){
    if (tbl.total !== undefined && (total === null || !lineOk)) total = tbl.total;
    if (tbl.taxable !== undefined && (taxable === null || !lineOk)) taxable = tbl.taxable;
    if (tbl.cgst !== undefined && !cgst) cgst = tbl.cgst;
    if (tbl.sgst !== undefined && !sgst) sgst = tbl.sgst;
    if (tbl.igst !== undefined && !igst) igst = tbl.igst;
  }
  // amount in words (the invoice total, not the tax amount)
  const inWords = amountInWords(lines);
  const rec = reconcileFigures(lines, {inWords, total, tblTotal: tbl.total,
    supplierState: supplier ? supplier.gstin.slice(0, 2) : "", buyerState: buyer ? buyer.gstin.slice(0, 2) : (cid && CO(cid) && CO(cid).gstin ? CO(cid).gstin.slice(0, 2) : ""),
    tblGst: (tbl.cgst || 0) + (tbl.sgst || 0) + (tbl.igst || 0), tblParts: {cgst: tbl.cgst, sgst: tbl.sgst, igst: tbl.igst}});
  if (rec){
    total = rec.total; taxable = rec.taxable;
    cgst = rec.parts.cgst || 0; sgst = rec.parts.sgst || 0; igst = rec.parts.igst || 0;
    const i = extraChecks.indexOf("figures from the GST summary table"); if (i >= 0) extraChecks.splice(i, 1);
    extraChecks.push("taxable value (" + INR.format(rec.taxable) + ") = total from " + rec.from[0] + " − GST from " + rec.from[1] + ", and it is printed on the bill");
    if (rec.ro) extraChecks.push("round off " + rec.ro);
    if (rec.mixed) extraChecks.push("several GST rates on the bill (" + rec.mixed.join("%, ") + "%)");
  }
  const gst = cgst + sgst + igst;
  if (supplierPan && gst > 0) why.push("GST is charged but the supplier's GSTIN was not found");
  if (inWords !== null){
    if (total === null){ total = inWords; extraChecks.push("total taken from the amount in words"); }
    else if (rec && Math.abs(inWords - total) <= 1){ if (rec.from[0] !== "amount in words") extraChecks.push("total matches the amount in words"); }
    else if (Math.abs(inWords - total) <= 1) extraChecks.push("total matches the amount in words");
    else if (Math.abs(inWords - Math.round(total)) > 1) why.push("total in figures (" + total + ") and in words (" + inWords + ") differ");
  }
  if (total === null) why.push("total not found");
  if (taxable === null && total !== null && gst > 0){
    taxable = Math.round((total - gst - ro) * 100) / 100;
    if (!amountShown(lines, taxable) && !amountShown(lines, Math.round((total - gst) * 100) / 100)) { why.push("taxable value not shown on the bill"); }
  }
  if (taxable === null && total !== null && gst === 0 && !supplier) taxable = total;
  if (taxable === null) why.push("taxable value not found");
  if (total !== null && taxable !== null){
    const diff = Math.abs(taxable + gst - total);
    if (diff > 1.0 && Math.abs(taxable + gst + ro - total) > 0.05) why.push("taxable value plus GST does not equal the total");
  }
  if (gst === 0 && gstShown(lines)) why.push("GST is shown on the bill but its amount was not found");
  if (cgst && sgst && Math.abs(cgst - sgst) > 0.05) why.push("CGST and SGST differ");
  if ((cgst || sgst) && igst) why.push("both IGST and CGST/SGST found");
  if (gst > 0 && taxable && !(rec && rec.mixed)){
    const rate = gst / taxable * 100;
    if (!FREE_GST_RATES.some(r => Math.abs(rate - r) <= 0.15)) why.push("GST is " + rate.toFixed(2) + "% of the taxable value, not a standard rate");
  }
  const bs = billToShipTo(lines);
  if (bs.bill && bs.bill !== (supplier ? supplier.gstin : "")) buyer = {gstin: bs.bill, line: -1};   // the bill-to block decides whose bill it is
  if (supplier && cid && CO(cid) && supplier.gstin === CO(cid).gstin) why.push("this looks like the client's own sales invoice");
  // no GSTIN or PAN printed: a saved deductee of this name supplies the PAN
  if (!supplier && !supplierPan && cid && S.data[cid]){
    const nm0 = normName(guessVendorName(lines, -1, CO(cid) ? CO(cid).name : ""));
    const p0 = nm0 && Object.values(S.data[cid].parties || {}).find(x => x.pan && normName(x.name) === nm0);
    if (p0){ supplierPan = p0.pan; const k = why.indexOf("supplier GSTIN not found"); if (k >= 0) why.splice(k, 1); }
  }

  // supplier name and payment type: from this client's saved deductee, if known
  let vendorName = "", natureId = "", natureReason = "", known = false;
  if ((supplier || supplierPan) && cid && S.data[cid]){
    const sp = supplier ? supplier.gstin.slice(2, 12) : supplierPan;
    const p = Object.values(S.data[cid].parties).find(x => (supplier && x.gstin === supplier.gstin) || (x.pan && x.pan === sp));
    if (p){ vendorName = p.name; natureId = p.natureDefault || ""; natureReason = "Saved payment type for this deductee"; known = !!p.natureDefault; }
  }
  const guessedName = guessVendorName(lines, supplier ? supplier.line : lines.findIndex(l => /\bpan\b/i.test(l)), cid && CO(cid) ? CO(cid).name : "");
  const items = itemLines(lines);
  const nat = guessNature(items) || (/(bill\s+for\s+professional\s+services|professional\s+(fees|services)|chartered\s+accountants?|company\s+secretar|cost\s+accountants?|advocates?\b)/i.test(lines.join(" ")) ? {id: "professional", how: "the bill is for professional services"} : null);
  const itemText = items.map(l => l.replace(/\b\d[\d,.\/]*\b/g, " ").replace(/[^A-Za-z&()\-\/ ]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).join("; ");
  const j = {
    vendorName: vendorName || guessedName, vendorGstin: supplier ? supplier.gstin : null, vendorPan: supplierPan || null,
    buyerName: null, buyerGstin: buyer ? buyer.gstin : null,
    invoiceNo: (noteKindOf(lines) && noteNoOf(lines).no) || invoiceNo || null, invoiceDate: invoiceDate || null,
    againstInvoice: noteKindOf(lines) ? (noteNoOf(lines).against || (noteNoOf(lines).no ? invoiceNo : "") || null) : null,
    taxableValue: taxable, cgst, sgst, igst, totalAmount: total,
    description: itemText.slice(0, 100),
    items: readItems(lines),
    docKind: docKindOf(lines),
    noteKind: noteKindOf(lines),
    shipGstin: (billToShipTo(lines).ship || null),
    hint: lines.slice(0, 80).join(" ").slice(0, 1500),
    natureId: natureId || (nat ? nat.id : "none"),
    natureReason: natureReason || (nat ? "Free reading: " + nat.how : ""),
    confidence: known ? 0.95 : nat ? 0.6 : 0.2,
    rentMonths: null, handwritten: false,
    uncertainFields: (known ? [] : ["vendorName"]).concat(supplierPan && opts.ocr && !known ? ["vendorPan"] : []).concat(noNumber ? ["invoiceNo"] : []),
    legibilityNote: noNumber ? "The bill has no bill number: a reference from its date is used." : "",
    salesOf
  };
  const checks = why.length ? [] : [supplierPan ? "supplier PAN (no GSTIN, no GST)" : "supplier GSTIN check digit", "bill number", "date", "taxable value + GST = total"].concat(gst > 0 ? ["GST at " + Math.round(gst / taxable * 1000) / 10 + "%"] : [], extraChecks);
  // which fields are missing or doubtful, for a partly read draft
  const missing = [];
  if (!supplier && !supplierPan) missing.push("vendorGstin");
  if (!invoiceNo) missing.push("invoiceNo");
  if (!invoiceDate) missing.push("invoiceDate");
  if (total === null || why.some(w => /total/.test(w))) missing.push("total");
  if (taxable === null || why.some(w => /taxable|GST is/.test(w))) missing.push("taxable");
  if (why.some(w => /CGST|IGST|GST is/.test(w))) missing.push("cgst", "sgst", "igst");
  const found = [supplier || supplierPan || null, invoiceNo, invoiceDate, total, taxable].filter(v => v !== null && v !== undefined && v !== "").length;
  return {ok: why.length === 0, known, j, cid, why, checks, missing, found};
}


/* ------------------------------------------------------------------ */
/* Self-test: reads two sample bills that are built into this file,   */
/* using only the free engines (no cost), and checks every field.      */
/* ------------------------------------------------------------------ */
const SIMD_TEST = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);
const SAMPLE_EXPECT = {vendorGstin:"09AAAAS0000A1ZI", invoiceNo:"ST/26-27/101", invoiceDate:"2026-09-14", taxableValue:20000, igst:2400, totalAmount:22400};
function envInfo(){
  let simd = false;
  try { simd = typeof WebAssembly !== "undefined" && WebAssembly.validate(SIMD_TEST); } catch (e){ simd = false; }
  return {
    where: window.claude ? "inside claude.ai" : location.protocol === "file:" ? "standalone file opened from this computer" : "standalone page at " + location.host,
    browser: navigator.userAgent,
    wasm: typeof WebAssembly !== "undefined", simd,
    gunzip: typeof DecompressionStream !== "undefined",
    images: typeof createImageBitmap !== "undefined",
    pdf: !!(window.pdfjsLib || window.TDS_ASSETS), pdfBuiltIn: !!document.getElementById("pdfjs-lib"),
    ocrBuiltIn: hasBuiltInOcr(), samples: !!(document.getElementById("sample-jpg") || window.TDS_ASSETS),
    storage: S.storeKind
  };
}
async function sampleFile(id, name, type){
  const t = await blockText(id);
  if (!t) throw {code:"no_samples"};
  return new File([base64ToBytes(t.trim())], name, {type});
}
async function freeReadOnly(file){
  let text = "", canvases = [], kind;
  if (isPdf(file)){
    const r = await pdfPages(file, [1]);
    text = r.text; canvases = r.canvases;
    kind = text.replace(/\s/g, "").length >= 80 ? "pdf_text" : "pdf_scan";
  } else { canvases = [await imageToCanvas(file)]; kind = "photo"; }
  let best = null;
  const tryT = t => { const r = freeParse(t, null, file.name); if (!best || r.ok || r.why.length < best.why.length) best = r; return r.ok; };
  if (kind === "pdf_text") tryT(text);
  else {
    const passes = [];
    for (const psm of ["3", "11"]){
      const o = await ocrCanvas(canvases[0], psm);
      if (!o) throw {code:"ocr_not_working"};
      passes.push(o);
      if (tryT(o.text)) break;
      if (passes.length > 1 && tryT(passes.map(x => x.text).join("\n"))) break;
    }
  }
  return {kind, fp: best};
}
function compareSample(j){
  const bad = [];
  for (const [k, v] of Object.entries(SAMPLE_EXPECT)){
    const got = j ? j[k] : null;
    const same = typeof v === "number" ? Math.abs(num(got) - v) < 0.01 : String(got || "") === v;
    if (!same) bad.push(k + " read as " + (got == null || got === "" ? "nothing" : got));
  }
  return bad;
}
async function runSelfTest(){
  if (S.selfTest && S.selfTest.busy) return;
  S.selfTest = {busy:true, started: Date.now(), results: {}}; softRender();
  const res = S.selfTest.results;
  // 1. PDF text
  try {
    await ensurePdfJs();
    if (!window.pdfjsLib) throw {code:"pdf_unavailable"};
    const t0 = Date.now();
    const r = await freeReadOnly(await sampleFile("sample-pdf", "sample-bill.pdf", "application/pdf"));
    const bad = compareSample(r.fp && r.fp.j);
    res.pdf = bad.length ? {ok:false, msg:"Read the sample PDF but got: " + bad.join(", ") + "."} : {ok:true, msg:"Sample PDF read correctly in " + Math.max(1, Math.round((Date.now() - t0) / 1000)) + " s."};
  } catch (e){ res.pdf = {ok:false, msg: errCopy(e && e.code)}; }
  softRender();
  // 2. built-in OCR on a photo
  try {
    const t0 = Date.now();
    const r = await freeReadOnly(await sampleFile("sample-jpg", "sample-bill.jpg", "image/jpeg"));
    const bad = compareSample(r.fp && r.fp.j);
    const saw = String((r.fp && r.fp.text) || r.text || "").split(/\n/).filter(l => /GST|G\.S\.T|6ST|65T/i.test(l)).slice(0, 2).map(l => l.trim().slice(0, 70)).join(" | ");
    res.ocr = bad.length ? {ok:false, msg:"Built-in OCR ran but read: " + bad.join(", ") + "." + (saw ? " OCR saw: \u201c" + saw + "\u201d" : " OCR found no GST line.")} : {ok:true, msg:"Sample photo read correctly by the built-in OCR in " + Math.max(1, Math.round((Date.now() - t0) / 1000)) + " s."};
  } catch (e){ res.ocr = {ok:false, msg: e && e.code === "ocr_not_working" ? "Built-in OCR is not working: " + ocrProblem() + "." : errCopy(e && e.code)}; }
  S.selfTest.busy = false; S.selfTest.finished = Date.now();
  lsSet("tdsdesk:selftest", JSON.stringify({results: S.selfTest.results, finished: S.selfTest.finished}));
  render();
}
function diagnosticReport(){
  const e = envInfo(), st = S.selfTest && S.selfTest.results || {};
  const yn = v => v ? "yes" : "NO";
  return [
    "TDS Desk diagnostic report",
    "Version: " + APP_VERSION,
    "Opened: " + e.where,
    "Browser: " + e.browser,
    "WebAssembly: " + yn(e.wasm) + " · SIMD: " + yn(e.simd) + " · Gzip: " + yn(e.gunzip) + " · Images: " + yn(e.images),
    "PDF reader loaded: " + yn(e.pdf) + " (built in: " + yn(e.pdfBuiltIn) + ")",
    "Built-in OCR present: " + yn(e.ocrBuiltIn) + " · state: " + S.ocrState + (S.ocrKind ? " (" + S.ocrKind + ")" : "") + (S.ocrBuiltInError ? " · built-in error: " + S.ocrBuiltInError : "") + (S.ocrError ? " · error: " + S.ocrError : ""),
    "Self-test PDF: " + (st.pdf ? (st.pdf.ok ? "PASS " : "FAIL ") + st.pdf.msg : "not run"),
    "Self-test OCR: " + (st.ocr ? (st.ocr.ok ? "PASS " : "FAIL ") + st.ocr.msg : "not run"),
    "Google OCR key: " + (googleSettings().key ? "saved" : "none") + (S.googleTest ? " · test: " + S.googleTest.msg : ""),
    "Claude: " + (S.engine || "none") + (S.samplePerm ? " · permission: " + S.samplePerm : "") + (S.readBlocked ? " · blocked: " + S.readBlocked : "") + (S.testResult ? " · test: " + S.testResult.msg : ""),
    "Storage: " + e.storage + " · Clients: " + Object.keys(S.companies).length,
    "Read free, all time: " + (Object.values(S.companies).map(c => { const f = freeRate(c); return f ? c.name + " " + f.pct + "% of " + f.n : ""; }).filter(Boolean).join(" · ") || "no bills yet"),
    "Google OCR last used: " + (S.googleLast ? (S.googleLast.ok ? "worked" : "FAILED: " + S.googleLast.msg) : "not used yet") + (S.googleAuto ? " · daily check: " + (S.googleAuto.ok ? "PASS" : "FAIL " + S.googleAuto.msg) : ""),
    "New suppliers: " + (S.askClaudeNewSupplier ? "Claude asked for name and payment type" : "you confirm name and payment type (no Claude call)"),
    "Bills read this session: free " + S.readStats.free + ", Google " + (S.readStats.google || 0) + ", free figures + Claude name " + (S.readStats.freePlusClaude || 0) + ", Claude text " + S.readStats.claudeText + ", Claude images " + S.readStats.claudeImages,
    "Recent bills:" + ((S.recentReads || []).length ? "" : " none"),
    ...(S.recentReads || []).map(b => "  " + b.name + " -> " + b.method + (b.trace.length ? "\n    " + b.trace.map(t => (t.ok ? "OK " : "NO ") + t.step + (t.note ? ": " + t.note : "")).join("\n    ") : "")),
    "Recent problems: " + (S.jobs.filter(j => j.status === "failed").slice(-3).map(j => j.name + ": " + j.msg).join(" | ") || "none")
  ].join("\n");
}
function selfTestSummary(){
  const st = S.selfTest;
  if (!st) return {state:"none"};
  if (st.busy) return {state:"busy"};
  const r = st.results, fails = ["pdf", "ocr"].filter(k => r[k] && !r[k].ok);
  return {state: fails.length ? "fail" : "ok", fails, r};
}
function viewSelfTest(){
  const e = envInfo(), sum = selfTestSummary(), r = (S.selfTest && S.selfTest.results) || {};
  const line = (label, res) => '<tr><td><b>' + label + '</b></td><td>' + (!res ? (sum.state === "busy" ? '<span class="tag no">Testing…</span>' : '<span class="tag no">Not run</span>') : res.ok ? '<span class="tag ok">Pass</span>' : '<span class="tag bad">Fail</span>') + '</td><td class="note">' + (res ? esc(res.msg) : "") + "</td></tr>";
  const yn = (label, v, fix) => '<tr><td>' + label + '</td><td>' + (v ? '<span class="tag ok">Yes</span>' : '<span class="tag bad">No</span>') + '</td><td class="note">' + (v ? "" : fix) + "</td></tr>";
  return '<div class="pane" id="selfTestPane"><h2>Self-test</h2>' +
    '<p class="note" style="margin:0 0 10px">Reads two sample bills built into this app (a PDF and a photo) with the free engines only. No cost. Runs by itself when the app opens.</p>' +
    '<div class="tblwrap"><table class="data"><tbody>' + line("Sample PDF (free PDF reading)", r.pdf) + line("Sample photo (built-in OCR)", r.ocr) + "</tbody></table></div>" +
    '<div class="row" style="margin-top:10px"><button class="btn" data-act="runSelfTest"' + (sum.state === "busy" ? " disabled" : "") + ">Run self-test again</button></div>" +
    '<h3 style="margin-top:16px">This browser</h3><div class="tblwrap"><table class="data"><tbody>' +
    '<tr><td>Opened</td><td colspan="2">' + esc(e.where) + "</td></tr>" +
    yn("WebAssembly", e.wasm, "This browser cannot run the OCR. Use a current Chrome or Edge.") +
    yn("WebAssembly SIMD", e.simd, "Needed by the built-in OCR. Update the browser (Chrome 91+, Edge 91+, Firefox 89+, Safari 16.4+).") +
    yn("Gzip support", e.gunzip, "Needed by the built-in OCR. Update the browser (Chrome 80+, Firefox 113+, Safari 16.4+).") +
    yn("PDF reader loaded", e.pdf, "Reload the page. If it stays No, download the standalone file again.") +
    yn("Built-in OCR inside the file", e.ocrBuiltIn, "This copy is incomplete. Download the standalone file again.") +
    "</tbody></table></div>" +
    '<h3 style="margin-top:16px">Diagnostic report</h3><p class="note" style="margin:0 0 6px">If something is still not working, copy this and send it to me.</p>' +
    '<textarea id="diagBox" rows="9" readonly>' + esc(diagnosticReport()) + "</textarea>" +
    '<div class="row" style="margin-top:6px"><button class="btn small" data-act="copyDiag">Copy report</button></div></div>';
}
function selfTestBanner(){
  const sum = selfTestSummary();
  if (sum.state !== "fail") return "";
  const msgs = sum.fails.map(k => (k === "pdf" ? "PDF reading: " : "Photo OCR: ") + sum.r[k].msg);
  return '<div class="banner" style="border-left-color:var(--stop);background:var(--stop-soft);margin-bottom:12px"><b>Bill reading has a problem here.</b> ' + esc(msgs.join(" ")) +
    ' <button class="linkbtn" data-act="goSelfTest">See the self-test</button></div>';
}

/* ------------------------------------------------------------------ */
/* Reading order: free first, Claude only when needed                  */
/*  1. the PDF's own text, or free OCR, checked by rules               */
/*  2. Claude with text only (cheap) for a new supplier's name/type    */
/*  3. Claude with images, for handwriting and poor scans              */
/* ------------------------------------------------------------------ */
const READ_LABELS = {"free-text":"free (PDF text)", "free-ocr":"free OCR", "free+claude-text":"free + Claude (text only)",
  "google-ocr":"Google OCR", "google+claude-text":"Google OCR + Claude (text only)", "free-partial":"free (partly read)",
  "claude-text":"Claude (text only)", "claude-images":"Claude (images)", "claude-careful":"Claude (careful re-read)"};
function readLabel(r){ return READ_LABELS[r.method] || r.method || ""; }
// A small coloured badge: green = free, blue = Claude
function readBadge(mode){
  if (!mode) return "";
  if (/^free (OCR|\(PDF)/.test(mode)) return '<span class="tag ok" title="' + esc(mode) + '">Free</span>';
  if (mode === "Google OCR") return '<span class="tag ok" title="' + esc(mode) + '">Google OCR</span>';
  if (/text only/.test(mode)) return '<span class="tag stamp" title="' + esc(mode) + '">Claude text</span>';
  if (/^Claude/.test(mode)) return '<span class="tag stamp" title="' + esc(mode) + '">Claude</span>';
  if (mode === "pasted") return '<span class="tag no">Pasted</span>';
  if (mode === "free (partly read)") return '<span class="tag warn" title="' + esc(mode) + '">Partly read</span>';
  return "";
}
function checksPass(j){
  const tot = num(j.totalAmount), tx = num(j.taxableValue), gst = num(j.cgst) + num(j.sgst) + num(j.igst);
  return !!(j.vendorName && j.invoiceDate && tot > 0 && tx > 0 && Math.abs(tx + gst - tot) <= 1.5);
}
async function claudeRead(prompt, images, careful){
  if (S.engine === "api") return apiJson(prompt, images, careful);
  if (S.engine !== "claude") throw {code:"no_engine"};
  if (S.readBlocked) throw {code:S.readBlocked};
  const opts = {modelTier: careful ? "complex" : "default"};
  if (careful) opts.cache = false;
  if (images && images.length) opts.images = images;
  try { return (await S.sample.json(prompt, opts)) || {}; }
  catch (err){
    if (err && /^(not_granted|sampling_disabled|session_expired|capability_disabled|not_declared)$/.test(err.code)) S.readBlocked = err.code;
    throw err;
  }
}
// Bill numbers and dates have no check digit: when OCR read them, another OCR reading must agree.
function crossCheckOcr(j, texts){
  const unsure = [];
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (j.invoiceNo){
    const want = norm(j.invoiceNo);
    const hasToken = t => String(t).split(/\s+/).some(w => norm(w) === want);
    const agree = texts.filter(t => { const got = findInvoiceNo(String(t).split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean), ""); return norm(got) === want || hasToken(t); }).length;
    if (agree < 2) unsure.push("invoiceNo");
  }
  if (j.invoiceDate){
    const agree = texts.filter(t => findDate(String(t).split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean)) === j.invoiceDate || datesIn(String(t)).indexOf(j.invoiceDate) >= 0).length;
    if (agree < 2) unsure.push("invoiceDate");
  }
  return unsure;
}
async function extract(file, careful, page, cidHint, force){
  if (!S.engine && !S.freeFirst) throw {code: S.sampleReady ? "no_engine" : "not_ready"};
  let text = "", canvases = [], kind;
  if (isPdf(file)){
    const r = await pdfPages(file, page ? [].concat(page) : [1, 2, 3]);
    text = r.text; canvases = r.canvases;
    kind = text.replace(/\s/g, "").length >= 80 ? "pdf_text" : "pdf_scan";
    if (kind === "pdf_scan") text = "";
  } else if (isImage(file)){
    canvases = [await imageToCanvas(file)];
    kind = "photo";
  } else throw {code:"bad_type"};
  if (!canvases.length) throw {code:"unreadable"};
  const preview = await canvasJpeg(canvases[0], 1400, 0.8);
  // trace: every step that was tried, whether it worked, and why not
  const trace = [];
  const step = (name, ok, note) => trace.push({step: name, ok: !!ok, note: note || ""});

  // asked for a particular reader: Google OCR first, or straight to Claude
  if (force === "google"){
    if (!googleReady()) throw {code: "no_google_key"};
    const o = await googleOcr(canvases[0]);
    let fpG = freeParse(o.text, cidHint || null, file.name, {ocr: true});
    if (fpG.cid && !D(fpG.cid).loaded){ try { await Store.loadCompany(fpG.cid); fpG = freeParse(o.text, fpG.cid, file.name, {ocr: true}); } catch (e){} }
    if (kind === "pdf_text" && !fpG.ok){ const r2 = freeParse(text + "\n" + o.text, fpG.cid || cidHint || null, file.name, {ocr: true}); if (r2.ok) fpG = r2; }
    trace.push({step: "Google OCR (asked for)", ok: !!fpG.ok, note: fpG.ok ? "read" : (fpG.why || []).join(", ")});
    if (fpG.ok) return {j: fpG.j, kind, preview, method: "google-ocr", checks: fpG.checks, trace};
    if (!S.engine) throw {code: "free_failed", detail: (fpG.why || []).join(", "), trace, partial: fpG.found >= 2 ? {j: fpG.j, missing: fpG.missing, kind, preview} : null};
    force = "claude";     // Google could not read it: Claude next
  }
  // 1. free
  let freeWhy = "", lastFree = null;
  if (!careful && S.freeFirst && force !== "claude"){
    let ftext = "", conf = 0, fp = null;
    const tryText = async (t, c) => {
      if (!t || t.replace(/\s/g, "").length < 40) return null;
      let r = freeParse(t, cidHint || null, file.name, {ocr: c < 100});
      if (r.cid && !D(r.cid).loaded){ try { await Store.loadCompany(r.cid); r = freeParse(t, r.cid, file.name, {ocr: c < 100}); } catch (e){} }
      if (!fp || r.ok || r.why.length < fp.why.length){ fp = r; ftext = t; conf = c; }
      return r;
    };
    const res = r => r ? (r.ok ? "all checks passed" : r.why.join(", ")) : "no readable text";
    let source = kind === "pdf_text" ? "free-text" : "free-ocr", googleWhy = "";
    const salesHand = () => fp && fp.j && fp.j.salesOf ? {j: Object.assign({}, fp.j, {salesText: ftext}), kind, preview, method: source, trace, checks: fp.checks || []} : null;
    if (kind === "pdf_text"){ const r = await tryText(text, 100); step("PDF's own text", r && r.ok, res(r)); if (salesHand()){ step("Sales invoice", true, "the client's own invoice: handed to Sales"); return salesHand(); } }
    else step("PDF's own text", false, kind === "pdf_scan" ? "scanned PDF, no text inside" : "photo, no text inside");
    const ocrTexts = [];
    if (!(fp && fp.ok)){
      const passes = [];
      for (const [psm, delines] of [["3", false], ["11", false], ["3", true]]){
        const label = "Built-in OCR (" + (delines ? "table lines removed" : psm === "3" ? "page layout" : "scattered text") + ")";
        const o = await ocrCanvas(canvases[0], psm, {delines});
        if (!o){ step("Built-in OCR", false, "not working here: " + ocrProblem()); break; }
        passes.push(o);
        ocrTexts.push(o.text);
        let r = await tryText(o.text, o.confidence);
        if (!(r && r.ok) && kind === "pdf_text"){ const r2 = await tryText(text + "\n" + o.text, o.confidence); if (r2 && r2.ok) r = r2; }
        if (!(r && r.ok) && passes.length > 1){ const r3 = await tryText(passes.map(x => x.text).join("\n"), Math.min(...passes.map(x => x.confidence))); if (r3 && r3.ok) r = r3; }
        step(label, r && r.ok, res(r) + " (confidence " + Math.round(o.confidence) + "%)");
        if (r && r.ok){ source = "free-ocr"; break; }
        if (salesHand()) break;
      }
      if (salesHand()){ step("Sales invoice", true, "the client's own invoice: handed to Sales"); return salesHand(); }
      if (!(fp && fp.ok)){
        if (!hasGoogle()) step("Google OCR", false, window.claude ? "not available inside claude.ai" : "no Google key saved");
        else {
          const before = fp;
          fp = null;
          try {
            const o = await googleOcr(canvases[0]);
            let r = await tryText(o.text, o.confidence);
            if (!(r && r.ok) && kind === "pdf_text"){ const r2 = await tryText(text + "\n" + o.text, o.confidence); if (r2 && r2.ok) r = r2; }
            S.googleLast = {ok: true, at: Date.now()};
            step("Google OCR", r && r.ok, res(r));
            if (fp && fp.ok) source = "google-ocr";
            else { googleWhy = "Google OCR: " + res(r); if (before && (!fp || before.why.length <= fp.why.length)) fp = before; }
          } catch (e){
            const msg = errCopy(e && e.code) + (e && e.message ? " Google said: " + e.message : "");
            S.googleLast = {ok: false, at: Date.now(), msg};
            step("Google OCR", false, msg);
            googleWhy = "Google OCR failed (" + ((e && e.code) || "error") + ")"; fp = before;
          }
        }
      }
    }
    if (fp){
      lastFree = fp;
      if (fp.ok && source === "free-ocr"){
        if (ocrTexts.length < 2){
          const o2 = await ocrCanvas(canvases[0], "11");
          if (o2) ocrTexts.push(o2.text);
        }
        const unsure = crossCheckOcr(fp.j, ocrTexts);
        if (unsure.length){
          fp.j.uncertainFields = Array.from(new Set((fp.j.uncertainFields || []).concat(unsure)));
          step("Second OCR reading", false, "did not agree on: " + unsure.map(k => k === "invoiceNo" ? "bill number" : "date").join(", ") + " (marked for you to check)");
        } else step("Second OCR reading", true, "bill number and date confirmed");
      }
      if (fp.ok){
        const askClaude = S.askClaudeNewSupplier && S.engine && !fp.known && (kind === "pdf_text" || conf >= 75);
        if (!askClaude){
          // accepted free: for a new supplier the name and payment type are for you to confirm
          const note = fp.known ? "" : "New supplier: check the name and confirm the payment type before approving.";
          if (!fp.known) step("Supplier name and payment type", true, "left for you to confirm (no Claude call)");
          return {j: fp.j, kind, preview, method: source, checks: fp.checks, trace, note, confirmType: !fp.known};
        }
        // figures are checked; ask Claude (text only) just for the supplier's name and the payment type
        try {
          const jt = await claudeRead(buildPrompt(ftext, file.name, 0, "pdf_text"), [], false);
          const m = Object.assign({}, fp.j, {
            vendorName: jt.vendorName || fp.j.vendorName, vendorPan: jt.vendorPan || null, buyerName: jt.buyerName || null,
            description: jt.description || fp.j.description, natureId: jt.natureId || fp.j.natureId,
            natureReason: jt.natureReason || fp.j.natureReason, confidence: jt.confidence, rentMonths: jt.rentMonths == null ? null : jt.rentMonths,
            uncertainFields: []});
          step("Claude (text only)", true, "asked only for the supplier name and payment type; figures came from free reading");
          return {j: m, kind, preview, method: source === "google-ocr" ? "google+claude-text" : "free+claude-text", checks: fp.checks, trace};
        } catch (err){
          step("Claude (text only)", false, errCopy(err && err.code));
          return {j: fp.j, kind, preview, method: source, checks: fp.checks, trace, confirmType: true, note: "Claude could not be asked for the supplier name and payment type; check them."};
        }
      }
      freeWhy = fp.why.join(", ") + (googleWhy ? "; " + googleWhy : "");
    } else {
      freeWhy = S.ocrState === "unavailable" && kind !== "pdf_text" ? "free OCR is not available here (" + (S.ocrError || "blocked") + ")" : "no readable text was found";
      if (googleWhy && freeWhy.indexOf(googleWhy) < 0) freeWhy += "; " + googleWhy;
    }
  } else if (careful) step("Free reading", false, "skipped: careful re-read asked for");
  else step("Free reading", false, "switched off in Settings");
  if (!S.engine) throw {code: force === "claude" ? "no_engine" : "free_failed", detail: freeWhy, trace, partial: lastFree && lastFree.found >= 2 ? {j: lastFree.j, missing: lastFree.missing, kind, preview} : null};

  // 2. text PDFs: Claude with the text only
  if (kind === "pdf_text" && !careful){
    const j = await claudeRead(buildPrompt(text, file.name, 0, "pdf_text"), [], false);
    const ok = checksPass(j);
    step("Claude (text only)", ok || !S.imgMax, ok ? "read the whole bill from the PDF's text" : "its figures did not add up; trying the page image");
    if (ok || !S.imgMax) return {j, kind, preview, method:"claude-text", freeWhy, trace};
  }

  // 3. Claude with images
  if (!S.imgMax) throw {code:"images_unavailable", trace};
  let images = [];
  if (kind === "pdf_text"){
    for (const c of canvases.slice(0, Math.min(2, S.imgMax))) images.push(await imgBlob(c, "page"));
    images = images.filter(Boolean);
  } else {
    images = await buildImageSet(canvases, careful);
    if (!images.length) throw {code:"unreadable", trace};
  }
  const j = await claudeRead(buildPrompt(text, file.name, images.length, kind), images, careful);
  step(careful ? "Claude (careful re-read)" : "Claude (images)", true, "read from " + images.length + " image" + (images.length === 1 ? "" : "s"));
  return {j, kind, preview, method: careful ? "claude-careful" : "claude-images", freeWhy, trace};
}
// A photo or scan that came back without the essentials gets one careful re-read.
function needsCarefulRead(r){
  const j = r.j || {};
  if (r.kind === "pdf_text" || /^free/.test(r.method || "")) return false;
  const missing = !j.vendorName || j.totalAmount == null || !j.invoiceDate;
  const unsure = Array.isArray(j.uncertainFields) && j.uncertainFields.some(f => f === "totalAmount" || f === "taxableValue");
  return missing || unsure;
}
async function extractBest(file, onCareful, page, cidHint, force){
  let r = await extract(file, false, page, cidHint, force);
  if (needsCarefulRead(r)){
    if (onCareful) onCareful();
    try { const r2 = await extract(file, true, page, cidHint, force); r2.freeWhy = r.freeWhy; r2.trace = (r.trace || []).concat(r2.trace || []); r = r2; } catch (e){ /* keep the first reading */ }
  }
  return r;
}
function setPreview(key, blob){
  if (!blob) return;
  if (S.previews[key]) URL.revokeObjectURL(S.previews[key]);
  S.previews[key] = URL.createObjectURL(blob);
}
function movePreview(from, to){
  if (S.previews[from]){ S.previews[to] = S.previews[from]; delete S.previews[from]; }
  if (S.files[from]){ S.files[to] = S.files[from]; delete S.files[from]; }
}

/* ------------------------------------------------------------------ */
/* Reading with your own Claude API key (works outside claude.ai)      */
/* ------------------------------------------------------------------ */
const API_DEFAULTS = {model:"claude-sonnet-5", carefulModel:"claude-opus-5"};
function apiSettings(){
  let o = {};
  try { o = JSON.parse(lsGet("tdsdesk:api") || "{}"); } catch (e){ o = {}; }
  return Object.assign({}, API_DEFAULTS, o);
}
function blobToBase64(b){
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = () => bad(r.error); r.readAsDataURL(b); });
}
function parseJsonReply(text){
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch (e){}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a){ try { return JSON.parse(t.slice(a, b + 1)); } catch (e){} }
  throw {code:"invalid_json"};
}
async function apiJson(prompt, images, careful){
  const cfg = apiSettings();
  const content = [];
  for (const b of images || []) content.push({type:"image", source:{type:"base64", media_type:"image/jpeg", data: await blobToBase64(b)}});
  content.push({type:"text", text: prompt + "\n\nReply with only the JSON object, no other text."});
  // signed in to the firm account: the platform holds the key and charges the firm
  if (Cloud.on() && S.account && !cfg.key){
    let j;
    try {
      j = await Cloud.fn("gateway", {what: "claude", qty: 1, ref: "read",
        payload: {model: careful ? (cfg.carefulModel || "claude-sonnet-4-6") : (cfg.model || "claude-sonnet-4-6"), max_tokens: 16000, messages: [{role: "user", content}]}});
    } catch (e){
      if (e.reason === "low_balance"){ S.creditStop = {at: Date.now(), balance: e.balance, code: "claude"}; render(); }
      throw {code: e.reason === "low_balance" ? "no_credit" : "api_error", message: e.message};
    }
    const text = ((j.data && j.data.content) || []).filter(x => x.type === "text").map(x => x.text).join("\n");
    return parseJsonReply(text);
  }
  if (!cfg.key) throw {code:"no_key"};
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"content-type":"application/json", "x-api-key":cfg.key, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true"},
      body: JSON.stringify({model: careful ? cfg.carefulModel : cfg.model, max_tokens: 16000, messages:[{role:"user", content}]})
    });
  } catch (e){ throw {code:"api_blocked"}; }
  let data = null;
  try { data = await res.json(); } catch (e){ data = null; }
  if (!res.ok){
    const msg = data && data.error && data.error.message ? String(data.error.message) : "";
    const code = res.status === 401 ? "bad_key" : res.status === 403 ? "key_forbidden" : res.status === 404 ? "bad_model"
      : res.status === 429 ? "rate_limited" : res.status === 413 ? "prompt_too_large" : res.status >= 500 ? "upstream_error" : "api_error";
    throw {code, message: msg};
  }
  const text = ((data && data.content) || []).filter(x => x.type === "text").map(x => x.text).join("\n");
  if (data && data.stop_reason === "max_tokens" && !text.includes("}")) throw {code:"invalid_json"};
  return parseJsonReply(text);
}
async function testReader(){
  S.testResult = {busy:true}; render();
  const c = document.createElement("canvas"); c.width = 900; c.height = 300;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 900, 300);
  g.fillStyle = "#123"; g.font = "italic 48px Georgia, serif";
  g.fillText("Test bill no. 4821", 40, 110); g.fillText("Total Rs 7,350/-", 40, 200);
  const blob = await canvasJpeg(c, 900, 0.9);
  const prompt = "The attached image is a test. Reply with only this JSON: {\"billNo\": string, \"total\": number}";
  const t0 = Date.now();
  try {
    let j;
    if (S.engine === "api") j = await apiJson(prompt, [blob], false);
    else if (S.engine === "claude"){
      if (!S.imgMax) throw {code:"images_unavailable"};
      j = await S.sample.json(prompt, {images:[blob], modelTier:"quick", cache:false});
    } else throw {code:"no_engine"};
    const ok = String(j.billNo || "").includes("4821") && Math.round(num(j.total)) === 7350;
    S.testResult = {ok, msg: ok ? "Reading works: the test bill was read correctly in " + Math.round((Date.now() - t0) / 1000) + " s." : "Claude answered, but read the test bill as " + JSON.stringify(j) + "."};
  } catch (err){
    if (err && /^(not_granted|sampling_disabled|session_expired|capability_disabled|not_declared)$/.test(err.code)) S.readBlocked = err.code;
    S.testResult = {ok:false, msg: errCopy(err && err.code) + (err && err.message && S.engine === "api" ? " Claude API said: " + err.message : "")};
  }
  render();
}
function pickEngine(){
  const cfg = apiSettings();
  if (S.sample) S.engine = "claude";
  else if (cfg.key) S.engine = "api";
  else if (Cloud.on() && S.account) S.engine = "api";     // the plan holds the key; the gateway charges the firm
  else S.engine = null;
  if (S.engine === "api") S.imgMax = 6;
}
function claudeReady(){ return !!S.engine && !S.readBlocked; }
function googleReady(){ return !!(googleSettings().key || (Cloud.on() && S.account)); }

function errCopy(code){
  return errText(code) + (code ? " (" + code + ")" : "");
}
function errText(code){
  return ({
    no_engine:"No way to read bills is set up in this view. See Settings, Reading bills.",
    no_google_key:"Add your Google Cloud Vision API key in Settings.",
    google_blocked:"This copy of the app cannot reach Google. Use the standalone file, opened in a browser or from your own website.",
    google_timeout:"Google did not answer in time. Press Retry.",
    google_bad_key:"Google rejected the API key. Check it in Settings.",
    google_billing:"Billing is not enabled on the Google Cloud project. Enable billing (the first 1,000 pages a month stay free).",
    google_not_enabled:"The Cloud Vision API is not enabled on this Google Cloud project. Enable it in the Google Cloud console.",
    google_forbidden:"Google refused the request. Check the API key's restrictions (allowed websites and APIs).",
    no_credit:"The firm's credit has run out. Ask the administrator to add credit; everything already in TDS Desk still works.",
    google_referrer:"This API key only works from certain websites, but the app is opened as a file, which sends no website address. Remove the website restriction on the key, then test again.",
    google_quota:"Google's usage limit was reached. Wait, or raise the quota in the Google Cloud console.",
    google_error:"Google could not read this image.",
    free_failed:"Free reading could not read this bill, and Claude reading is not set up here. Use Type it in, or set up Claude reading in Settings.",
    not_ready:"Still connecting to Claude. Wait a few seconds and press Retry.",
    no_key:"Add your Claude API key in Settings, Reading bills.",
    bad_key:"The Claude API key was rejected. Check it in Settings, Reading bills.",
    key_forbidden:"This API key is not allowed to use that model or feature. Check your Claude Console account.",
    bad_model:"The model name in Settings was not found. Use claude-sonnet-5 or claude-opus-5.",
    api_error:"The Claude API refused the request.",
    api_blocked:"This copy of the app cannot reach the Claude API. Use the downloaded file, opened in a browser or from your own website.",
    pdf_broken:"This PDF could not be opened. It may be password-protected or damaged.",
    no_sample:"Automatic reading is not available in this view. Use Type it in.",
    not_granted:"Claude access was not allowed for this app. Reload the page, allow access, then press Retry.",
    images_unavailable:"Photos and scanned bills cannot be sent to Claude in this view; only PDFs with a text layer can. Try the app on claude.ai in a desktop browser, or use Type it in.",
    image_rejected:"This image could not be opened. Try a clearer photo, a JPG, or a PDF.",
    heic:"This is an iPhone HEIC photo, which this browser cannot open. Share it as JPG (Settings, Camera, Formats, Most Compatible) or upload a PDF.",
    pdf_unavailable:"The PDF reader did not load. Reload the page and try again.",
    unreadable:"No text or pages could be read from this PDF.",
    bad_type:"Only PDF, JPG, PNG and WebP files can be read.",
    session_expired:"Your Claude session has expired. Sign in again, reload, then press Retry.",
    upstream_error:"Claude could not be reached. Press Retry.",
    rate_limited:"Claude is busy or your usage limit was reached. Wait a minute, then press Retry.",
    invalid_json:"Claude's reply could not be turned into bill details. Press Retry.",
    prompt_too_large:"This file has too much text. Upload only the invoice pages.",
    refused:"Claude declined to read this file. Use Type it in."
  })[code] || "The bill could not be read. Press Retry, or use Type it in.";
}
function newEntry(fileName){
  return {id: uid("e"), fileName: fileName || "Manual entry", createdAt: new Date().toISOString(), status:"draft",
    x:{vendorName:"", vendorGstin:"", vendorPan:"", buyerName:"", buyerGstin:"", invoiceNo:"", invoiceDate:"", taxable:"", cgst:"", sgst:"", igst:"", total:"", description:"", rentMonths:""},
    natureId:"none", expenseLedger:"", partyLedger:"", includeCatchUp:true, ai:null, narration:""};
}
function applyExtraction(e, j, cid){
  const s = v => (v == null ? "" : String(v)).trim();
  e.x.vendorName = s(j.vendorName);
  e.x.vendorGstin = s(j.vendorGstin).toUpperCase().replace(/\s/g, "");
  e.x.vendorPan = s(j.vendorPan).toUpperCase().replace(/\s/g, "");
  e.x.buyerName = s(j.buyerName);
  e.x.buyerGstin = s(j.buyerGstin).toUpperCase().replace(/\s/g, "");
  e.gstinNotes = [];
  e.x.invoiceNo = s(j.invoiceNo);
  e.x.invoiceDate = /^\d{4}-\d{2}-\d{2}$/.test(s(j.invoiceDate)) ? s(j.invoiceDate) : "";
  e.x.taxable = j.taxableValue == null ? "" : r2(num(j.taxableValue));
  e.x.cgst = r2(num(j.cgst)); e.x.sgst = r2(num(j.sgst)); e.x.igst = r2(num(j.igst));
  e.x.total = j.totalAmount == null ? "" : r2(num(j.totalAmount));
  e.x.description = s(j.description).slice(0, 140);
  e.docKind = String(j.docKind || "").toLowerCase().replace(/[^a-z_]/g, "");
  if (e.docKind === "invoice") e.docKind = "";
  e.x.shipGstin = String(j.shipGstin || "").toUpperCase().replace(/\s/g, "");
  e.x.items = (j.items || []).map(i => ({
    desc: String(i.desc || i.description || "").slice(0, 80), hsn: String(i.hsn || "").replace(/\D/g, "").slice(0, 8),
    qty: num(i.qty), unit: String(i.unit || "").slice(0, 10), rate: num(i.rate),
    taxable: r2(num(i.taxable)), gstRate: i.gstRate == null || i.gstRate === "" ? null : num(i.gstRate)
  })).filter(i => i.desc && (i.taxable || i.qty)).slice(0, 40);
  if (j.hint) e.hint = String(j.hint).slice(0, 1500);
  // a credit note from the supplier reduces the purchase: no TDS on it, and it goes to Tally as a Debit Note
  e.noteKind = j.noteKind || (/credit/.test(e.docKind || "") ? "credit" : /debit/.test(e.docKind || "") ? "debit" : "") || noteKindOf(String(j.hint || "").split(/\n| {3,}/));
  if (e.noteKind && /note/.test(e.docKind || "")) e.docKind = "";
  if (e.noteKind === "credit" && !e.tdsSkip) e.tdsSkip = "note";
  if (e.noteKind && j.againstInvoice) e.x.againstInvoice = String(j.againstInvoice).slice(0, 40);
  e.x.rentMonths = j.rentMonths == null ? "" : Math.round(num(j.rentMonths));
  const suggested = rules().some(r => r.id === j.natureId) ? j.natureId : "none";
  const fixedV = fixGstin(e.x.vendorGstin);
  if (fixedV.status === "fixed") e.x.vendorGstin = fixedV.value;
  e.ai = {suggested, reason: s(j.natureReason).slice(0, 220), confidence: num(j.confidence)};
  e.handwritten = !!j.handwritten;
  e.legibility = s(j.legibilityNote).slice(0, 160);
  e.uncertain = Array.from(new Set((Array.isArray(j.uncertainFields) ? j.uncertainFields : []).map(f => UNSURE_KEYS[f]).filter(Boolean)));
  ["vendorName","invoiceDate","total"].forEach(k => { if (!e.x[k] && e.uncertain.indexOf(k) < 0) e.uncertain.push(k); });
  [["vendorGstin","supplier"], ["buyerGstin","billed-to"]].forEach(([k, who]) => {
    const f = fixGstin(e.x[k]);
    if (f.status === "fixed"){
      e.x[k] = f.value;
      e.gstinNotes.push("The " + who + " GSTIN was read as " + f.from + ", which fails its check digit; corrected to " + f.value + ".");
      if (e.uncertain.indexOf(k) < 0) e.uncertain.push(k);
    } else if (f.status === "invalid"){
      if (e.uncertain.indexOf(k) < 0) e.uncertain.push(k);
    }
  });
  const party = findParty(e.x, cid);
  e.natureId = party && party.natureDefault ? party.natureDefault : suggested;
  fillLedgers(e, party, cid);
  e.narration = narrationFor(e);
}
/* ---------- how this supplier has been booked before, in Tally ---------- */
const NOT_EXPENSE = /(duties|taxes|bank|cash|sundry\s*creditors|sundry\s*debtors|current\s*liabilities|capital)/i;
function isTaxLike(name){ return /\b(c|s|i|ut)gst\b|\bcess\b|\btds\b|\btcs\b|round\s*off|input\s*(c|s|i)gst/i.test(name || ""); }
// read the supplier's ledger for the last twelve months and count what the other side was
async function partyExpensesFromTally(partyLedger, cid){
  const co = CO(cid || S.coId);
  if (!bridgeLive(co) || !partyLedger) return null;
  co.partyExp = co.partyExp || {};
  const key = normName(partyLedger);
  const had = co.partyExp[key];
  if (had && Date.now() - new Date(had.at).getTime() < 7 * 86400000) return had;     // a week is fresh enough
  const to = new Date(), from = new Date(to.getTime() - 365 * 86400000);
  let rows = [];
  try {
    const j = await Bridge.call("/ledgervouchers?company=" + encodeURIComponent(Bridge.openFor(co).name) + "&ledger=" + encodeURIComponent(partyLedger) +
      "&from=" + isoToTally(from.toISOString().slice(0, 10)) + "&to=" + isoToTally(to.toISOString().slice(0, 10)) + Bridge.pinQ(), null, 120000);
    rows = [].concat(j.rows || []);
  } catch (e){ return had || null; }
  const count = {};
  rows.forEach(r => {
    const credited = num(String(r.cr || "").replace(/,/g, "")) !== 0;          // the supplier was credited: a bill
    const other = String(r.other || "").trim();
    if (!credited || !other || normName(other) === key || isTaxLike(other)) return;
    const info = ledgerInfo(other);
    if (info && NOT_EXPENSE.test(info.group || "")) return;
    const c = count[other] || (count[other] = {ledger: other, n: 0, amount: 0});
    c.n++; c.amount = r2(c.amount + Math.abs(num(String(r.cr).replace(/,/g, ""))));
  });
  const top = Object.values(count).sort((a, b) => b.n - a.n || b.amount - a.amount).slice(0, 4);
  const res = {at: new Date().toISOString(), bills: rows.filter(r => num(String(r.cr || "").replace(/,/g, "")) !== 0).length, top};
  co.partyExp[key] = res;
  Store.saveCompany(co);
  return res;
}
// fill the expense ledger on drafts from what Tally shows, unless a person already chose one
async function applyPartyHistory(entries, cid){
  const co = CO(cid);
  if (!bridgeLive(co)) return 0;
  const byLedger = new Map();
  entries.forEach(e => {
    if (!e || e.status !== "draft" || !e.partyLedger || !exactLedger(e.partyLedger)) return;
    (byLedger.get(e.partyLedger) || byLedger.set(e.partyLedger, []).get(e.partyLedger)).push(e);
  });
  let changed = 0;
  for (const [led, list] of byLedger){
    const h = await partyExpensesFromTally(exactLedger(led), cid);
    if (!h || !h.top.length) continue;
    const best = h.top.find(t => exactLedger(t.ledger));
    list.forEach(e => {
      e.partyHist = {bills: h.bills, top: h.top};
      if (!best || e.expenseUserSet) return;
      const party = findParty(e.x, cid);
      if (party && party.expenseLedger && party.expenseChosenByUser) return;      // the person's own choice for this supplier stands
      if (e.expenseLedger !== exactLedger(best.ledger)){
        e.expenseLedger = exactLedger(best.ledger);
        e.expenseFrom = "Used for this supplier in Tally " + best.n + " of " + h.bills + " time" + (h.bills === 1 ? "" : "s") + " in the last year";
        changed++;
      }
      Store.saveEntry(cid, e);
    });
  }
  return changed;
}
function partyHistHtml(e, ro){
  const h = e.partyHist;
  if (!h || !h.top || !h.top.length) return "";
  return '<div class="phist"><span class="muted">Booked before for this supplier:</span> ' +
    h.top.map(t => (ro ? '<span class="chip">' : '<button class="chip' + (norm(t.ledger) === norm(e.expenseLedger) ? " on" : "") + '" data-useexp="' + esc(t.ledger) + '">') +
      esc(t.ledger) + " <b>" + t.n + "\u00d7</b>" + (ro ? "</span>" : "</button>")).join(" ") + "</div>";
}

function fillLedgers(e, party, cid){
  if (!e.partyLedger){
    const t = tallyPartyFor(e.x, cid);
    e.partyLedger = (party && party.ledgerName) || (t && t.name) || e.x.vendorName;
    if (t && !(party && party.ledgerName)) e.partyFromTally = t.how;
  }
  if (!e.expenseLedger) e.expenseLedger = (party && party.expenseLedger) || CO(cid).expenseLedgers[e.natureId] || "";
  if (e.expenseLedger && S.bank && S.bank.cid === cid && hasLedgerList() && !exactLedger(e.expenseLedger)){ const ex = closestTallyLedger(e.expenseLedger, /expense|purchase/i); if (ex) e.expenseLedger = ex; }
}
function narrationFor(e){
  const bits = ["Being invoice " + (e.x.invoiceNo || "") + " dated " + fmtDate(e.x.invoiceDate) + " from " + (e.x.vendorName || "supplier")];
  if (e.x.description) bits.push("for " + e.x.description);
  return bits.join(" ").replace(/\s+/g, " ").trim() + ".";
}

/* ------------------------------------------------------------------ */
/* Duplicate protection                                                */
/*  1. the same file (or PDF page) twice: blocked before reading      */
/*  2. the same supplier + bill number in the same tax year: held     */
/* ------------------------------------------------------------------ */
const hashCache = new WeakMap();
async function fileHash(file){
  if (hashCache.has(file)) return hashCache.get(file);
  let h;
  try {
    const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    h = Array.from(new Uint8Array(d)).slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (e){
    let a = 7; for (const ch of file.name + "|" + file.size + "|" + file.lastModified) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
    h = "n" + a.toString(16);
  }
  hashCache.set(file, h);
  return h;
}
function statusLabel(st){ return ({draft:"to review", approved:"approved", rejected:"marked no entry", duplicate:"held as duplicate"})[st] || st; }
function findHash(h){
  if (S.pendingHashes[h]) return {msg:"The same file is already in this upload."};
  for (const c of Object.values(S.companies)){
    const rec = c.hashes && c.hashes[h];
    if (!rec) continue;
    const e = S.data[c.id] && S.data[c.id].entries[rec.e];
    if (S.data[c.id] && S.data[c.id].loaded && !e) continue;   // entry was deleted
    return {cid:c.id, entryId:rec.e,
      msg:"Already uploaded to " + c.name + (e ? " as " + (e.x.vendorName || e.fileName) + (e.x.invoiceNo ? " bill " + e.x.invoiceNo : "") + " (" + statusLabel(e.status) + ")" : " on " + fmtDate(rec.d)) + "."};
  }
  const inb = Object.values(S.inbox).find(i => i.hash === h);
  if (inb) return {msg:"Already waiting in Unsorted uploads."};
  return null;
}
function pruneIndex(obj, max){
  const keys = Object.keys(obj);
  if (keys.length <= max) return;
  keys.sort((a, b) => String(obj[a].d || obj[a]).localeCompare(String(obj[b].d || obj[b])));
  keys.slice(0, keys.length - max).forEach(k => delete obj[k]);
}
function registerHash(cid, h, entryId){
  if (!h) return;
  const co = CO(cid);
  co.hashes = co.hashes || {};
  co.hashes[h] = {e: entryId, d: new Date().toISOString().slice(0, 10)};
  pruneIndex(co.hashes, 3000);
  Store.saveCompany(co);
}
function pruneStaleHashes(cid){
  const co = CO(cid), d = S.data[cid];
  if (!co || !co.hashes || !d || !d.loaded) return 0;
  let n = 0;
  Object.keys(co.hashes).forEach(h => { const rec = co.hashes[h]; if (rec && rec.e && !d.entries[rec.e]){ delete co.hashes[h]; n++; } });
  if (n) Store.saveCompany(co);
  return n;
}
function liveHashRec(cid, h){
  const co = CO(cid);
  const rec = h && co && co.hashes && co.hashes[h];
  if (!rec) return null;
  const d = S.data[cid];
  if (d && d.entries && d.entries[rec.e]) return rec;
  if (d && d.loaded) unregisterHash(cid, h);      // the bill it pointed at is gone: the file is free again
  return null;
}
function unregisterHash(cid, h){
  const co = CO(cid);
  if (h && co && co.hashes && co.hashes[h]){ delete co.hashes[h]; Store.saveCompany(co); }
}
function normInv(v){ return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|[A-Z])0+(?=\d)/g, "$1"); }
function invKey(x){
  const inv = normInv(x.invoiceNo);
  const who = effectivePan(x) || norm(x.vendorName);
  if (!inv || !who) return "";
  return who + "|" + inv + "|" + fyOf(x.invoiceDate);
}
function findDuplicate(e, cid){
  const k = invKey(e.x);
  if (k){
    for (const o of Object.values(D(cid).entries)){
      if (o.id === e.id || o.status === "duplicate" || o.notDuplicate) continue;
      if (invKey(o.x) === k) return {entryId:o.id, strong:true,
        msg:"Same supplier and bill number as " + (o.x.vendorName || o.fileName) + " bill " + o.x.invoiceNo + " dated " + fmtDate(o.x.invoiceDate) + " (" + statusLabel(o.status) + ")."};
    }
    const sent = (CO(cid).keys || {})[k];
    if (sent) return {strong:true, msg:"Same supplier and bill number as a bill approved on " + fmtDate(sent) + " (since cleared from the desk)."};
  }
  // weaker: same supplier, same date and same total
  const who = effectivePan(e.x) || norm(e.x.vendorName), tot = num(e.x.total);
  if (who && tot && e.x.invoiceDate){
    for (const o of Object.values(D(cid).entries)){
      if (o.id === e.id || o.status === "duplicate") continue;
      if ((effectivePan(o.x) || norm(o.x.vendorName)) === who && o.x.invoiceDate === e.x.invoiceDate && Math.abs(num(o.x.total) - tot) < 1)
        return {entryId:o.id, strong:false, msg:"Same supplier, date and total as " + (o.x.vendorName || o.fileName) + (o.x.invoiceNo ? " bill " + o.x.invoiceNo : "") + " (" + statusLabel(o.status) + ")."};
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Reading queue (bulk upload): two bills at a time                    */
/* ------------------------------------------------------------------ */
let activeJobs = 0;
const MAX_PARALLEL = 2;
let renderQueued = false;
function softRender(){ if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }
// One PDF may hold one invoice over several pages, several invoices, or copies of one invoice.
// Returns the pages of each invoice, or null when the PDF is a single invoice.
async function invoiceGroups(file){
  let pdf; try { pdf = await getPdf(file); } catch (e){ return null; }
  const n = pdf.numPages;
  if (n < 2) return null;
  const pages = [];
  for (let p = 1; p <= Math.min(n, 200); p++){
    let t = "";
    try { t = pageTextLines(await (await pdf.getPage(p)).getTextContent()); } catch (e){}
    pages.push({p, t, chars: t.replace(/\s/g, "").length});
  }
  // a scanned PDF has no text to go by: three or more pages are taken as one bill per page
  if (pages.filter(x => x.chars >= 80).length < pages.length / 2) return n >= 3 ? pages.map(x => [x.p]) : null;
  const RE_NO = /(?:invoice|inv|bill|voucher)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{1,30})/i;
  const RE_TOTAL = /(grand\s+total|total\s+amount|invoice\s+total|amount\s+chargeable|total\s+invoice\s+value|net\s+amount|(?:^|\n)\s*total\b[^\n]*\d{1,3}(?:,\d{2,3})*(?:\.\d{2})?)/i;
  const RE_HEAD = /(tax\s+invoice|invoice|bill\s+of\s+supply)/i;
  const groups = []; let cur = null;
  for (const pg of pages){
    const carried = /(c\s*\/\s*[fo]\b|carried\s+(?:forward|over)|continued|contd\.?|to\s+be\s+continued)/i.test(pg.t);
    const m = pg.t.match(RE_NO), no = m ? normInv(m[1]) : "", hasTotal = RE_TOTAL.test(pg.t) && !carried;   // "Total c/f" does not end an invoice
    const gst = (pg.t.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/) || [""])[0];
    if (cur && no && no === cur.no){
      if (cur.hasTotal && hasTotal){ cur.copies++; continue; }        // original, duplicate, triplicate: read once
      cur.pages.push(pg.p); cur.hasTotal = cur.hasTotal || hasTotal; continue;
    }
    if (cur && no && !cur.no && !cur.hasTotal){ cur.no = no; cur.pages.push(pg.p); cur.hasTotal = hasTotal; continue; }
    const fresh = !cur || (no && no !== cur.no && RE_HEAD.test(pg.t))
      || (cur.hasTotal && hasTotal)                                   // the last invoice already ended; this page brings its own total
      || (cur.hasTotal && RE_HEAD.test(pg.t) && (pg.t.match(/\d{1,3}(?:,\d{2,3})+\.\d{2}|\d{3,}\.\d{2}/g) || []).length >= 3)   // after a totalled invoice, a page with a heading and its own amounts
      || (gst && cur.gst && gst !== cur.gst && RE_HEAD.test(pg.t));   // another supplier
    if (fresh){ cur = {no, gst, pages: [pg.p], hasTotal, copies: 0}; groups.push(cur); continue; }
    if (!cur.gst && gst) cur.gst = gst;
    cur.pages.push(pg.p); cur.hasTotal = cur.hasTotal || hasTotal;   // a page without a new number carries on the same invoice
  }
  const copies = groups.reduce((a, g) => a + g.copies, 0);
  if (groups.length < 2 && !copies) return null;
  return groups.slice(0, 100).map(g => g.pages);
}
async function enqueueFiles(files, target){
  const split = S.splitPdf;
  const add = [];
  for (const f of files){
    if (!isPdf(f) && !isImage(f)){ add.push({file:f, status:"failed", msg:errCopy("bad_type")}); continue; }
    if (isPdf(f) && split){
      let n = 1;
      try { n = (await getPdf(f)).numPages; } catch (e){ add.push({file:f, status:"failed", msg:errCopy(e && e.code)}); continue; }
      const pages = Math.min(n, 100);
      for (let p = 1; p <= pages; p++) add.push({file:f, page:p});
      if (n > 100) toast(f.name + " has " + n + " pages; the first 100 were queued.");
    } else if (isPdf(f)){
      const groups = await invoiceGroups(f);
      if (groups && groups.length > 1){
        groups.forEach(g => add.push({file: f, page: g.length === 1 ? g[0] : g}));
        toast(f.name + " holds " + groups.length + " invoices: each is read as its own bill.");
      } else if (groups && groups.length === 1) add.push({file: f, page: groups[0].length === 1 ? groups[0][0] : groups[0]});
      else add.push({file: f});
    } else add.push({file:f});
  }
  add.forEach(j => {
    // results are filed in upload order, so the first copy of a bill is always the one kept
    j.prev = S.jobs.length ? S.jobs[S.jobs.length - 1] : null;
    j.donePromise = new Promise(res => { j.markDone = res; });
    if (j.status === "failed") j.markDone();
    j.id = uid("j"); j.target = target; j.status = j.status || "waiting";
    j.force = j.force || null;
    j.name = j.file.name + (j.page ? (Array.isArray(j.page) ? " · pages " + j.page[0] + "\u2013" + j.page[j.page.length - 1] : " · page " + j.page) : "");
    S.jobs.push(j);
  });
  S.batchSize = add.length;
  pump(); softRender();
}
// a batch read from Collect lands you on Review, with the first new bill open
function afterBatch(){
  if (S.view !== "company" || !(S.step === "collect" || S.advanceAfterRead || ["invoices", "export", "done"].includes(S.tab))) return;
  S.advanceAfterRead = false;
  const mine = S.jobs.filter(j => !j.advanced && (j.cid === S.coId || j.target === S.coId));
  const fresh = mine.filter(j => ["done", "partial", "held"].includes(j.status));
  const dups = mine.filter(j => j.status === "duplicate"), toSales = mine.filter(j => j.status === "unsorted"), bad = mine.filter(j => j.status === "failed");
  mine.forEach(j => { j.advanced = true; });
  if (!mine.length) return;
  const said = [fresh.length ? fresh.length + " read" : "", dups.length ? dups.length + " already uploaded (skipped)" : "", toSales.length ? toSales.length + " filed under Sales" : "", bad.length ? bad.length + " could not be read" : ""].filter(Boolean).join(" \u00b7 ");
  if (!fresh.length){ toast(said + "."); render(); return; }
  const first = fresh.map(j => D().entries[j.entryId]).find(e => e && e.status === "draft");
  goStep("review", "bills");
  toast(said + ". Review " + (fresh.length === 1 ? "it" : "them") + " below.");
}
let readTick = null;
function keepBusyCardAlive(){
  if (readTick) return;
  readTick = setInterval(() => {
    const busy = (S.jobs || []).some(j => ["waiting", "checking", "reading"].includes(j.status));
    if (!busy && !CloudDocs.queue.length){ clearInterval(readTick); readTick = null; }
    if (S.view === "company" && !S.drawerOpen && !S.colPop) softRender();
  }, 1000);
}
function pump(){
  keepBusyCardAlive();
  while (activeJobs < MAX_PARALLEL){
    const j = S.jobs.find(x => x.status === "waiting");
    if (!j) break;
    activeJobs++;
    j.status = "checking"; j.startedAt = Date.now();
    runJob(j).catch(err => { j.status = "failed"; j.msg = errCopy(err && err.code); })
      .finally(() => {
        activeJobs--;
        try { if (j.file && j.file.__docq) docqFinish(j); } catch (e){}
        if (j.ownsPending){ delete S.pendingHashes[j.hash]; j.ownsPending = false; }
        const prev = j.prev;
        j.prev = null;
        // a job counts as finished only once every earlier job has finished
        Promise.resolve(prev && prev.donePromise).then(() => j.markDone());
        if (!S.jobs.some(x => x.status === "waiting" || x.status === "checking" || x.status === "reading")){ pdfCache.clear(); setTimeout(afterBatch, 0); }
        pump(); softRender();
      });
  }
}
// Fingerprint checks run one at a time in upload order, so the first copy always wins.
let reserveChain = Promise.resolve();
function reserveFile(j){
  const p = reserveChain.then(async () => {
    j.hash = (await fileHash(j.file)) + (j.page ? "p" + j.page : "");
    const seen = findHash(j.hash);
    if (!seen){ S.pendingHashes[j.hash] = true; j.ownsPending = true; }
    return seen;
  });
  reserveChain = p.catch(() => {});
  return p;
}
async function runJob(j){
  const seen = await reserveFile(j);
  if (seen && !(j.file && j.file.__force)){ j.status = "duplicate"; j.msg = seen.msg; j.dupRef = seen; return; }
  if (!(await charge("bills", 1, j.name, "Bill read"))){ j.status = "failed"; j.msg = "Credit finished. Ask the administrator to add credit."; softRender(); return; }
  j.status = "reading"; j.msg = ""; softRender();
  let r;
  try { r = await extractBest(j.file, () => { j.msg = "Hard to read, reading again carefully"; softRender(); }, j.page, j.target === "auto" ? null : j.target, j.force); }
  catch (err){
    if (err && err.partial && j.target !== "auto"){
      const cid = j.target, e = newEntry(j.name), pr = err.partial;
      applyExtraction(e, pr.j, cid);
      e.readMode = "free (partly read)";
      e.readTrace = err.trace || [];
      e.confirmType = true;
      e.uncertain = Array.from(new Set((e.uncertain || []).concat(pr.missing)));
      e.readError = "Free reading found part of this bill. Fill in the fields marked in amber (" + err.detail + "), or add a Google OCR or Claude key in Settings.";
      e.fileHash = j.hash;
      S.files[e.id] = j.file; if (j.page) S.filePages[e.id] = [].concat(j.page)[0]; const dcid = j.cid || j.target || S.coId; FileStore.put(dcid, e.id, j.file); CloudDocs.add(dcid, e.id, j.file, "bill"); FileStore.put(cid, e.id, j.file);
      setPreview(e.id, pr.preview);
      j.method = "free-partial";
      finishNewEntry(e, cid, j);
      if (j.status === "done"){ j.status = "partial"; j.msg = "Partly read: fill in " + pr.missing.length + " field" + (pr.missing.length === 1 ? "" : "s") + "."; }
      return;
    }
    j.status = "failed"; j.trace = err && err.trace; j.msg = errCopy(err && err.code) + (err && err.detail ? " Free reading: " + err.detail + "." : ""); return;
  }
  j.method = r.method;
  if (/^free-/.test(r.method)) S.readStats.free++;
  else if (r.method === "google-ocr") S.readStats.google = (S.readStats.google || 0) + 1;
  else if (r.method === "free+claude-text" || r.method === "google+claude-text") S.readStats.freePlusClaude = (S.readStats.freePlusClaude || 0) + 1;
  else if (r.method === "claude-text") S.readStats.claudeText++;
  else S.readStats.claudeImages++;
  if (cidForCount(j)){
    const co = CO(cidForCount(j));
    co.readCounts = co.readCounts || {free:0, google:0, claude:0};
    const grp = /^free-/.test(r.method) ? "free" : r.method === "google-ocr" ? "google" : "claude";
    co.readCounts[grp] = (co.readCounts[grp] || 0) + 1;
    Store.saveCompany(co);
  }
  S.recentReads = (S.recentReads || []).concat([{name: j.name, method: readLabel(r), trace: r.trace || []}]).slice(-8);
  if (j.prev && j.prev.donePromise){ j.msg = "Read; waiting for the earlier file"; await j.prev.donePromise; j.msg = ""; }

  let cid = j.target === "auto" ? null : j.target;
  let how = "";
  // a sales invoice goes to Sales, not to purchase bills
  const saleCid = (r.j && r.j.salesOf) || (r.j && cid && CO(cid) && CO(cid).gstin && fixGstin(r.j.vendorGstin).value === CO(cid).gstin ? cid : null) || (!cid ? routeCompany(r.j).salesCid : null);
  if (saleCid && (!cid || saleCid === cid)){
    const added = await salesIngest(saleCid, j.file, r, j.hash);
    j.status = "unsorted";
    j.msg = added ? "Sales invoice of " + CO(saleCid).name + ": filed under Sales" : "This sales invoice is already in Sales";
    toast(j.name + ": " + j.msg + ".");
    return;
  }
  if (!cid){
    const route = routeCompany(r.j);
    if (!route.cid){
      const item = {id:uid("i"), fileName:j.name, createdAt:new Date().toISOString(), j:r.j, note:route.note, hash:j.hash, readMode:readLabel(r), freeWhy:r.freeWhy || "", readNote:r.note || ""};
      S.inbox[item.id] = item; S.files[item.id] = j.file; setPreview(item.id, r.preview);
      if (j.page) S.filePages[item.id] = [].concat(j.page)[0];
      Store.saveInbox(item);
      j.status = "unsorted"; j.msg = route.note;
      return;
    }
    cid = route.cid; how = route.how;
    await Store.loadCompany(cid);
  }
  const e = newEntry(j.name);
  applyExtraction(e, r.j, cid);
  e.readMode = readLabel(r);
  if (r.trace) e.readTrace = r.trace;
  if (r.confirmType && !(findParty(e.x, cid) || {}).natureDefault) e.confirmType = true;
  if (r.checks) e.checks = r.checks;
  if (r.freeWhy) e.freeWhy = r.freeWhy;
  if (r.note) e.readNote = r.note;
  e.fileHash = j.hash;
  if (how) e.routedBy = how;
  S.files[e.id] = j.file; if (j.page) S.filePages[e.id] = [].concat(j.page)[0]; const dcid = j.cid || j.target || S.coId; FileStore.put(dcid, e.id, j.file); CloudDocs.add(dcid, e.id, j.file, "bill");
  setPreview(e.id, r.preview);
  finishNewEntry(e, cid, j);
}
// shared by the queue, Unsorted uploads and "Type it in"
function finishNewEntry(e, cid, j){
  const dup = findDuplicate(e, cid);
  if (dup && dup.strong){ e.status = "duplicate"; e.dupOf = {entryId:dup.entryId || null, msg:dup.msg}; }
  D(cid).entries[e.id] = e;
  Store.saveEntry(cid, e);
  if (e.fileHash) registerHash(cid, e.fileHash, e.id);
  refreshStats(cid);
  if (e.status === "draft") applyPartyHistory([e], cid).then(n => { if (n || e.partyHist) render(); }).catch(() => {});
  if (j){
    j.cid = cid; j.entryId = e.id;
    j.status = e.status === "duplicate" ? "held" : "done";
    j.msg = e.status === "duplicate" ? dup.msg : (j.target === "auto" ? "Filed under " + CO(cid).name + (e.routedBy ? " by " + e.routedBy : "") : "") ;
  }
  if (cid === S.coId && S.view === "company" && (S.batchSize === 1 || !S.selected)){
    S.filter = e.status; S.selected = e.id;
  }
}
function addPasted(text){
  let data;
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { data = JSON.parse(raw); }
  catch (err){
    const m = raw.match(/[\[{][\s\S]*[\]}]/);
    try { data = m ? JSON.parse(m[0]) : null; } catch (e2){ data = null; }
  }
  const list = Array.isArray(data) ? data : data && typeof data === "object" ? (Array.isArray(data.bills) ? data.bills : [data]) : [];
  const bills = list.filter(b => b && typeof b === "object" && (b.vendorName || b.invoiceNo || b.totalAmount));
  if (!bills.length){ toast("No bill details found. Paste the JSON exactly as Claude gave it."); return; }
  const cid = S.coId;
  let held = 0, lastId = null;
  bills.forEach((b, i) => {
    const e = newEntry("Pasted bill " + (b.invoiceNo ? b.invoiceNo : i + 1));
    applyExtraction(e, b, cid);
    e.readMode = "pasted";
    finishNewEntry(e, cid, null);
    if (e.status === "duplicate") held++; else lastId = e.id;
  });
  S.pasteOpen = false;
  if (lastId){ S.filter = "draft"; S.selected = lastId; }
  const added = bills.length - held;
  toast([added ? added + " bill" + (added > 1 ? "s" : "") + " added" : "", held ? held + " held as duplicate" + (held > 1 ? "s" : "") : ""].filter(Boolean).join(", ") + ".");
  render();
}
async function downloadStandalone(){
  const root = document.documentElement.cloneNode(true);
  root.querySelectorAll("[data-injected]").forEach(n => n.remove());
  // keep only this app's own parts; anything else was added by the page host
  const keepScript = el => ["app-main", "tess-core", "tess-eng", "pdfjs-lib", "pdfjs-worker", "xlsx-lib", "sample-jpg", "sample-pdf"].includes(el.id) || /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\//.test(el.getAttribute("src") || "");
  root.querySelectorAll("script").forEach(el => { if (!keepScript(el)) el.remove(); });
  root.querySelectorAll("head > *").forEach(el => {
    const tag = el.tagName.toLowerCase();
    const keep = (tag === "meta" && (el.hasAttribute("charset") || el.getAttribute("name") === "viewport")) || tag === "title" ||
      (tag === "link" && /fonts\.(googleapis|gstatic)\.com/.test(el.getAttribute("href") || "")) || (tag === "style" && el.id === "app-style") || (tag === "script" && keepScript(el));
    if (!keep) el.remove();
  });
  const bodyKeep = new Set(["app", "modal", "toast", "fileIn", "camIn", "bankIn", "ledIn", "bookIn", "salesIn", "booksIn", "mastersIn", "twoBIn", "filedIn", "marketIn", "salaryIn", "app-main", "tess-core", "tess-eng", "pdfjs-lib", "pdfjs-worker", "xlsx-lib", "sample-jpg", "sample-pdf"]);
  Array.from(root.querySelector("body").children).forEach(el => {
    if (el.tagName.toLowerCase() === "header" && el.classList.contains("top")) return;
    if (el.tagName.toLowerCase() === "script" && keepScript(el)) return;
    if (!bodyKeep.has(el.id)) el.remove();
  });
  const q = sel => root.querySelector(sel);
  q("#app").innerHTML = '<p class="note">Loading…</p>';
  const ta = q("#diagBox"); if (ta) ta.textContent = "";
  ["#tabs", "#cobar", "#modal", "#toast", "#firmLine"].forEach(sel => { const n = q(sel); if (n) n.innerHTML = ""; });
  q("#modal").className = "hidden"; q("#toast").className = "toast hidden";
  const html = "<!DOCTYPE html>\n" + root.outerHTML;
  toast("Preparing the standalone app (about 8 MB)…");
  const ok = await saveFile("TDS-Desk-standalone.html", new Blob([html], {type:"text/html"}));
  if (ok) toast("Saved. Open TDS-Desk-standalone.html in Chrome or Edge, then go to Settings.");
}
async function askPermission(){
  let perms = null;
  try { perms = window.claude && window.claude.use ? await window.claude.use("permissions") : null; } catch (e){ perms = null; }
  if (!perms){ toast("Permissions cannot be changed in this view."); return; }
  const r = await perms.request(["sample"]);
  S.samplePerm = r && r.sample ? r.sample : S.samplePerm;
  if (S.samplePerm === "granted") S.readBlocked = null;
  toast(S.samplePerm === "granted" ? "Claude reading is allowed." : S.samplePerm === "denied" ? "Access was declined. Reload the page to be asked again." : "Claude reading is " + S.samplePerm + ".");
  render();
}
function typeItIn(j){
  const cid = j.target === "auto" ? S.coId : j.target;
  if (!cid){ toast("Open the client first, then use Type it in."); return; }
  const e = newEntry(j.name);
  e.fileHash = j.hash; e.readError = j.msg;
  S.files[e.id] = j.file; if (j.page) S.filePages[e.id] = [].concat(j.page)[0]; const dcid = j.cid || j.target || S.coId; FileStore.put(dcid, e.id, j.file); CloudDocs.add(dcid, e.id, j.file, "bill");
  if (isImage(j.file)) S.previews[e.id] = URL.createObjectURL(j.file);
  finishNewEntry(e, cid, null);
  j.status = "typed"; j.cid = cid; j.entryId = e.id;
  if (S.coId !== cid) openCompany(cid);
  S.filter = "draft"; S.selected = e.id; render();
}
function openJobEntry(j){
  const ref = j.entryId ? {cid:j.cid, entryId:j.entryId} : j.dupRef;
  if (!ref || !ref.cid){ toast("The earlier copy is not on this desk any more."); return; }
  openCompany(ref.cid).then(() => {
    const e = D(ref.cid).entries[ref.entryId];
    if (!e){ toast("The earlier copy is not on this desk any more."); return; }
    S.tab = "invoices"; S.filter = e.status; S.selected = e.id; render();
  });
}
async function rereadCarefully(e){
  const file = S.files[e.id], cid = S.coId;
  if (!file){ toast("The original file is only kept while this page is open. Upload it again to re-read."); return; }
  S.reading[e.id] = "Reading again carefully"; render();
  try {
    const r = await extract(file, true, S.filePages[e.id], cid);
    e.readTrace = (e.readTrace || []).concat(r.trace || []);
    const keepParty = e.partyLedger;
    e.partyLedger = ""; e.expenseLedger = "";
    applyExtraction(e, r.j, cid);
    if (keepParty && keepParty !== e.x.vendorName) e.partyLedger = keepParty;
    e.readMode = readLabel(r); delete e.readError;
    setPreview(e.id, r.preview);
    toast("Read again with the most careful model. Check the highlighted fields.");
  } catch (err){ toast(errCopy(err && err.code)); }
  delete S.reading[e.id];
  Store.saveEntry(cid, e); refreshStats(cid); render();
}
function cidForCount(j){ return j.target && j.target !== "auto" ? j.target : null; }
function freeRate(co){
  const rc = (co && co.readCounts) || {}, n = (rc.free || 0) + (rc.google || 0) + (rc.claude || 0);
  return n ? {n, pct: Math.round(100 * (rc.free || 0) / n), google: rc.google || 0, claude: rc.claude || 0, free: rc.free || 0} : null;
}
// "Working on it": a spinner, what it is doing now, and how far it has got
function busyCard(title, detail, done, total){
  const pct = total ? Math.round(Math.min(1, done / total) * 100) : null;
  const m = pct === null && detail ? String(detail).match(/page (\d+) of (\d+)/i) : null;
  const p2 = m ? Math.round(m[1] / m[2] * 100) : pct;
  return '<div class="busycard" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span>' +
    '<div class="busytext"><b>' + esc(title) + "</b>" + (detail ? '<span class="note">' + esc(detail) + "</span>" : "") +
    (p2 === null ? "" : '<div class="busybar"><i style="width:' + p2 + '%"></i></div>') + "</div>" +
    (total ? '<span class="busyn">' + done + " / " + total + "</span>" : "") + "</div>";
}
// what the reading of this client's bills is doing right now
function docsBusyCard(){
  const n = CloudDocs.queue.length;
  if (!n) return "";
  return busyCard("Saving " + n + " document" + (n === 1 ? "" : "s") + " to the firm account\u2026", "This happens in the background; you can carry on.", 0, 0);
}
function billsBusyCard(){
  const mine = (S.jobs || []).filter(j => j.cid === S.coId || j.target === S.coId || j.target === "auto");
  const busy = mine.filter(j => ["waiting", "checking", "reading"].includes(j.status));
  if (!busy.length) return "";
  const now = busy.find(j => j.status === "reading") || busy[0];
  const done = mine.length - busy.length;
  const stage = now.msg || ({waiting: "waiting its turn", checking: "checking whether it was uploaded before", reading: "reading it"})[now.status] || "";
  const secs = now.startedAt ? Math.round((Date.now() - now.startedAt) / 1000) : 0;
  return busyCard("Reading " + (busy.length === 1 ? "a bill" : busy.length + " bills") + "\u2026",
    now.name + " \u00b7 " + stage + (secs > 3 ? " \u00b7 " + secs + "s" : ""), done, mine.length);
}
function viewJobs(filterFn){
  const jobs = S.jobs.filter(filterFn);
  if (!jobs.length) return "";
  const n = st => jobs.filter(j => j.status === st).length;
  const busy = n("waiting") + n("checking") + n("reading");
  const label = {waiting:["Waiting","no"], checking:["Checking","no"], reading:["Reading","no"], done:["Done","ok"], held:["Held: duplicate","warn"],
    duplicate:["Not uploaded: duplicate","warn"], failed:["Could not read","bad"], partial:["Partly read","warn"], unsorted:["Unsorted","warn"], typed:["Typed in","ok"]};
  let h = '<div class="jobs"><div class="jobshead"><b>' + (busy ? "Reading " + (jobs.length - busy) + " of " + jobs.length + "…" : jobs.length + " file" + (jobs.length === 1 ? "" : "s") + " processed") + "</b>" +
    '<span class="note">' + [n("done") + n("typed") ? (n("done") + n("typed")) + " added" : "",
      jobs.filter(j => /^free-/.test(j.method || "")).length ? jobs.filter(j => /^free-/.test(j.method || "")).length + " free" : "",
      jobs.filter(j => /claude/.test(j.method || "")).length ? jobs.filter(j => /claude/.test(j.method || "")).length + " by Claude" : "", n("duplicate") + n("held") ? (n("duplicate") + n("held")) + " duplicate" : "", n("failed") ? n("failed") + " failed" : "", n("unsorted") ? n("unsorted") + " unsorted" : ""].filter(Boolean).join(" · ") + "</span>" +
    (busy ? "" : '<button class="btn small" data-act="clearJobs">Clear list</button>') + "</div>";
  if (busy) h += '<div class="bar jobbar"><div class="add" style="left:0;width:' + Math.round((jobs.length - busy) / jobs.length * 100) + '%"></div></div>';
  h += '<ul class="joblist">' + jobs.slice().reverse().map(j => {
    const [t, cls] = label[j.status] || [j.status, "no"];
    const acts = (j.status === "failed" || j.status === "partial" ? '<button class="btn small" data-job="retry" data-jid="' + j.id + '">Read again</button>' +
        '<button class="btn small" data-job="google" data-jid="' + j.id + '"' + (googleReady() ? "" : " disabled") + '>With Google OCR</button>' +
        '<button class="btn small" data-job="claude" data-jid="' + j.id + '"' + (claudeReady() ? "" : " disabled") + '>With Claude</button>' +
        (j.status === "failed" ? '<button class="btn small" data-job="type" data-jid="' + j.id + '">Type it in</button>' : "") : "") +
      ((j.status === "duplicate" && j.dupRef && j.dupRef.cid) || ((j.status === "held" || j.status === "done" || j.status === "typed") && j.entryId) ? '<button class="btn small" data-job="open" data-jid="' + j.id + '">Open</button>' : "");
    const via = j.method ? " " + readBadge(READ_LABELS[j.method] || j.method) : "";
    return '<li><div class="jn"><span class="jname">' + esc(j.name) + via + '</span><span class="tag ' + cls + '">' + (j.status === "reading" || j.status === "checking" ? '<span class="dot sm"></span>' : "") + t + "</span></div>" +
      (j.msg ? '<div class="note">' + esc(j.msg) + "</div>" : "") + (acts ? '<div class="row" style="gap:6px;margin-top:4px">' + acts + "</div>" : "") + "</li>";
  }).join("") + "</ul></div>";
  return h;
}
function readingCheck(){
  const ocr = {idle:["no","Free OCR: checking…"], available:["ok", S.ocrKind === "built-in" ? "Free OCR: built in" : "Free OCR: available"], loading:["no","Free OCR: loading…"], ready:["ok","Free OCR: working"], unavailable:["bad","Free OCR: blocked here"]}[S.ocrState] || ["no","Free OCR"];
  const cl = !S.sampleReady ? ["no","Claude: checking…"] : viaPlatform() ? ["ok","Claude: in your plan"] : S.engine === "api" ? ["ok","Claude: your API key"] : S.engine === "claude" ? (S.readBlocked || S.samplePerm === "denied" ? ["bad","Claude: access declined"] : ["ok","Claude: available"]) : ["bad","Claude: not set up"];
  const pdf = (window.pdfjsLib || window.TDS_ASSETS) ? ["ok","PDF text: free"] : ["bad","PDF reader missing"];
  const sum = selfTestSummary();
  const selfT = sum.state === "ok" ? ["ok", "Self-test: passed"] : sum.state === "fail" ? ["bad", "Self-test: failed"] : sum.state === "busy" ? ["no", "Self-test: running…"] : null;
  return '<div class="rcheck">' + (selfT ? [selfT] : []).concat([pdf, ocr, cl]).map(([c, t]) => '<span class="tag ' + c + '">' + esc(t) + "</span>").join(" ") +
    (hasGoogle() ? ((S.googleAuto && !S.googleAuto.ok) || (S.googleLast && !S.googleLast.ok) ? ' <span class="tag bad">Google OCR: not working</span>' : S.googleAuto && S.googleAuto.ok ? ' <span class="tag ok">Google OCR: working</span>' : ' <span class="tag ok">Google OCR: set up</span>') : "") +
    ' <button class="linkbtn" data-act="goReading">Reading check</button></div>';
}
function readerStatus(){
  const fix = ' <button class="linkbtn" data-act="goReading">Fix</button>';
  if (!S.sampleReady) return '<span class="tag no">Connecting to Claude…</span>';
  if (S.engine === "api") return '<span class="tag ok">Reading with your Claude API key</span>';
  if (!S.engine) return S.freeFirst ? '<span class="tag warn">Free reading only (printed bills and PDFs)</span>' + fix : '<span class="tag bad">Bills cannot be read in this view</span>' + fix;
  if (S.readBlocked || S.samplePerm === "denied") return '<span class="tag bad">Claude access was declined</span>' + fix;
  if (S.samplePerm === "prompt") return '<span class="tag warn">Claude will ask permission on the first bill</span>' + fix;
  return S.imgMax ? '<span class="tag ok">Reads PDFs, scans and photos</span>' : '<span class="tag warn">Reads text PDFs only in this view</span>' + fix;
}
function uploadOptions(){
  return '<label class="chk small"><input type="checkbox" data-act-toggle="splitPdf"' + (S.splitPdf ? " checked" : "") + "> A PDF holds many bills: read each page as a separate bill</label>";
}

// Upload from the client list: file it by the buyer's GSTIN
function routeCompany(j){
  const cos = Object.values(S.companies);
  if (j.salesOf && S.companies[j.salesOf]) return {cid: null, salesCid: j.salesOf, how: "seller GSTIN"};
  const vg0 = fixGstin(j.vendorGstin).value;
  const seller0 = vg0 && cos.filter(c => c.gstin && c.gstin === vg0);
  if (seller0 && seller0.length === 1 && fixGstin(j.buyerGstin).value !== vg0) return {cid: null, salesCid: seller0[0].id, how: "seller GSTIN"};
  const bg = fixGstin(j.buyerGstin).value;
  const vg = fixGstin(j.vendorGstin).value;
  if (bg){
    const exact = cos.filter(c => c.gstin && c.gstin === bg);
    if (exact.length === 1) return {cid: exact[0].id, how: "buyer GSTIN"};
    if (GSTIN_RE.test(bg)){
      const byPan = cos.filter(c => (c.pan || (c.gstin || "").slice(2, 12)) === bg.slice(2, 12));
      if (byPan.length === 1) return {cid: byPan[0].id, how: "buyer PAN"};
    }
  }
  const bn = norm(j.buyerName);
  if (bn){
    const byName = cos.filter(c => norm(c.name) === bn || norm(c.tallyName) === bn);
    if (byName.length === 1) return {cid: byName[0].id, how: "buyer name"};
  }
  if (vg){
    const seller = cos.find(c => c.gstin && c.gstin === vg);
    if (seller) return {cid: null, note: "This looks like a sales invoice issued by " + seller.name + ". TDS Desk is for purchase and expense invoices."};
  }
  if (!bg && !bn && Bridge.up()){
    const open = Bridge.openClients();
    if (open.length === 1) return {cid: open[0].id, how: "company open in Tally"};
  }
  return {cid: null, note: bg || bn ? "Billed to " + (j.buyerName || "") + (bg ? " (" + bg + ")" : "") + ", which does not match any client." : "No buyer details were found on the invoice."};
}
async function assignInbox(id, cid){
  const item = S.inbox[id];
  if (!item || !cid) return;
  await Store.loadCompany(cid);
  const e = newEntry(item.fileName);
  if (item.j) applyExtraction(e, item.j, cid);
  else e.readError = item.note;
  e.fileHash = item.hash; e.readMode = item.readMode; if (item.freeWhy) e.freeWhy = item.freeWhy; if (item.readNote) e.readNote = item.readNote;
  movePreview(id, e.id);
  if (S.filePages[id]){ S.filePages[e.id] = S.filePages[id]; delete S.filePages[id]; }
  delete S.inbox[id]; Store.deleteInbox(id);
  finishNewEntry(e, cid, null);
  toast(item.fileName + " moved to " + CO(cid).name + (e.status === "duplicate" ? ", held as a duplicate." : "."));
  render();
}

/* ------------------------------------------------------------------ */
/* Approve / undo / reject (current client)                            */
/* ------------------------------------------------------------------ */
function approve(e){
  const cid = S.coId, c = compute(e, cid);
  if (c.missing.length){ toast("Fill in " + c.missing.join(", ") + " before approving."); return; }
  const parties = D(cid).parties;
  let party = c.party;
  if (!party){
    const id = c.pan ? "p-" + c.pan : "p-" + slug(e.x.vendorName) + "-" + Date.now().toString(36);
    party = {id, name:e.x.vendorName, pan:c.pan, gstin:e.x.vendorGstin, ledgerName:e.partyLedger, natureDefault:"", expenseLedger:"", ldcRate:"", ldcValidTo:"", ytd:{}};
    parties[id] = party;
  }
  if (!party.natureDefault) party.natureDefault = e.natureId;
  party.ledgerName = e.partyLedger;
  party.expenseLedger = e.expenseLedger;
  if (!party.pan && c.pan) party.pan = c.pan;
  if (!party.gstin && e.x.vendorGstin) party.gstin = e.x.vendorGstin;
  party.ytd = party.ytd || {};
  party.ytd[c.fy] = party.ytd[c.fy] || {};
  const cur = party.ytd[c.fy][c.rule.id] || {credited:0, tdsBase:0};
  const addBase = c.applicable ? c.tdsBase : 0;
  cur.credited = r2(num(cur.credited) + c.base);
  cur.tdsBase = r2(num(cur.tdsBase) + addBase);
  party.ytd[c.fy][c.rule.id] = cur;
  e.status = "approved";
  e.approvedAt = new Date().toISOString();
  const k = invKey(e.x), co = CO(cid);
  if (k){ co.keys = co.keys || {}; co.keys[k] = e.approvedAt.slice(0, 10); pruneIndex(co.keys, 3000); Store.saveCompany(co); }
  e.applied = {partyId:party.id, fy:c.fy, natureId:c.rule.id, credited:c.base, tdsBase:addBase};
  e.snapshot = {lines:c.lines, tds:c.tds, tdsWould:c.tdsWould, skip:c.skip, rcm:c.rcmTax ? Object.assign({cat:e.rcm.cat}, c.rcmTax) : null, blocked:c.blocked ? c.gd.block.cat : null, rate:c.rate, tdsBase:c.tdsBase, base:c.base, total:c.total, pan:c.pan, ref:c.rule.ref, old:c.rule.old, label:c.rule.label,
    applicable:c.applicable, catchUp:e.includeCatchUp ? c.catchUp : 0, why:c.why, meter:c.meter, fy:c.fy, rateNote:c.rateNote, indHuf:c.indHuf, never:c.rule.basis === "never"};
  Store.saveParty(cid, party);
  Store.saveEntry(cid, e);
  toast("Approved. " + (c.skip ? "TDS not booked (" + (SKIP_REASONS[c.skip.reason] || c.skip.reason) + "); would have been " + money0(c.tdsWould) + "." : c.tds ? "TDS " + money0(c.tds) + " drafted for Tally." : "No TDS on this invoice."));
  const next = Object.values(D(cid).entries).filter(o => o.status === "draft" && !S.reading[o.id]).sort(byDate)[0];
  if (next) S.selected = next.id;
  refreshStats(cid); render();
}
function unapply(e, cid){
  const a = e.applied, p = a && D(cid).parties[a.partyId];
  if (p && p.ytd && p.ytd[a.fy] && p.ytd[a.fy][a.natureId]){
    const cur = p.ytd[a.fy][a.natureId];
    cur.credited = r2(Math.max(0, num(cur.credited) - a.credited));
    cur.tdsBase = r2(Math.max(0, num(cur.tdsBase) - a.tdsBase));
    Store.saveParty(cid, p);
  }
  const k = invKey(e.x), co = CO(cid);
  if (k && co.keys && co.keys[k]){ delete co.keys[k]; Store.saveCompany(co); }
  e.status = "draft"; delete e.applied; delete e.snapshot; delete e.approvedAt;
}
function undoApproval(e){
  const cid = S.coId;
  if (e.exportedAt){ toast("This entry was already sent to Tally. Delete it in Tally first, then undo here."); return; }
  const a = e.applied, p = a && D(cid).parties[a.partyId];
  if (p && p.ytd && p.ytd[a.fy] && p.ytd[a.fy][a.natureId]){
    const cur = p.ytd[a.fy][a.natureId];
    cur.credited = r2(Math.max(0, num(cur.credited) - a.credited));
    cur.tdsBase = r2(Math.max(0, num(cur.tdsBase) - a.tdsBase));
    Store.saveParty(cid, p);
  }
  const k = invKey(e.x), co = CO(cid);
  if (k && co.keys && co.keys[k]){ delete co.keys[k]; Store.saveCompany(co); }
  e.status = "draft"; delete e.applied; delete e.snapshot; delete e.approvedAt;
  Store.saveEntry(cid, e); toast("Approval undone. The entry is back in drafts."); S.filter = "draft"; refreshStats(cid); render();
}
function setStatus(e, st, msg){ e.status = st; Store.saveEntry(S.coId, e); if (msg) toast(msg); if (st === "draft") S.filter = "draft"; refreshStats(S.coId); render(); }
// read this bill again with a chosen reader, keeping the same bill
async function rereadEntry(e, force){
  const cid = S.coId, file = S.files[e.id];
  if (!file){ toast("The file for this bill is not on this computer any more. Upload it again."); return; }
  if (force === "claude" && !claudeReady()){ toast("Claude is not available on this plan or in this view."); return; }
  if (force === "google" && !googleReady()){ toast("Google OCR is not set up: add a key in Settings, or use a plan that includes it."); return; }
  S.reading[e.id] = true; toast(force === "claude" ? "Reading again with Claude\u2026" : force === "google" ? "Reading again with Google OCR\u2026" : "Reading again\u2026"); render();
  try {
    const r = await extractBest(file, null, S.filePages[e.id], cid, force);
    applyExtraction(e, r.j, cid);
    e.readMode = readLabel(r); e.readTrace = r.trace || []; e.readError = ""; e.uncertain = e.uncertain || [];
    Store.saveEntry(cid, e);
    toast("Read again: " + readLabel(r) + ". Check the fields.");
  } catch (err){
    e.readError = errCopy(err && err.code) + (err && err.detail ? " " + err.detail : "");
    Store.saveEntry(cid, e);
    toast("Could not read it that way: " + errCopy(err && err.code));
  }
  delete S.reading[e.id]; refreshStats(cid); render();
}
function rereadButtons(e){
  return '<div class="row" style="gap:8px;margin-top:8px"><span class="note">Read again:</span>' +
    '<button class="btn small" data-reread="free" data-rid="' + e.id + '">Free</button>' +
    '<button class="btn small" data-reread="google" data-rid="' + e.id + '"' + (googleReady() ? "" : " disabled title=\"Google OCR is not set up\"") + ">Google OCR</button>" +
    '<button class="btn small" data-reread="claude" data-rid="' + e.id + '"' + (claudeReady() ? "" : " disabled title=\"Claude is not available here\"") + ">Claude</button></div>";
}
function removeEntry(e){
  FileStore.drop(S.coId, e.id);
  if (e.docPath) CloudDocs.remove(e.docPath); delete D().entries[e.id]; Store.deleteEntry(S.coId, e.id); unregisterHash(S.coId, e.fileHash); delete S.files[e.id]; if (S.selected === e.id) S.selected = null; toast("Invoice deleted."); refreshStats(S.coId); render(); }

/* Summary kept on each client so the client list needs no extra loading */
function refreshStats(cid){
  const co = CO(cid), d = S.data[cid];
  if (!co || !d || !d.loaded) return;
  const v = Object.values(d.entries), fy = fyOf(null);
  const drafts = v.filter(e => e.status === "draft");
  const st = {
    drafts: drafts.length,
    check: drafts.filter(e => !S.reading[e.id] && (() => { const c = compute(e, cid); return c.missing.length || c.flags.some(f => f.lvl !== "info"); })()).length,
    waiting: v.filter(e => e.status === "approved" && !e.exportedAt).length,
    tdsFy: v.filter(e => e.status === "approved" && e.snapshot && e.snapshot.fy === fy).reduce((a, e) => a + num(e.snapshot.tds), 0),
    invoicesFy: v.filter(e => e.status === "approved" && e.snapshot && e.snapshot.fy === fy).length,
    records: v.length + Object.keys(d.parties).length + 1,
    dups: v.filter(e => e.status === "duplicate").length
  };
  const old = co.stats || {};
  if (["drafts","check","waiting","tdsFy","invoicesFy","records","dups"].some(k => old[k] !== st[k])){
    co.stats = Object.assign(st, {fy, updatedAt: new Date().toISOString()});
    Store.saveCompany(co);
  }
}

/* ------------------------------------------------------------------ */
/* Tally XML, ZIP, CSV (current client)                                */
/* ------------------------------------------------------------------ */
function tallyDate(d){ return String(d || "").replace(/-/g, ""); }
function amt(n){ return r2(n).toFixed(2); }
// the voucher number Tally gets: the supplier's bill number, unless the client leaves numbering to Tally
function vchNoFor(e, co){
  if (co.vchNumbering === "tally") return "";
  return String(e.vchNo || e.x.invoiceNo || "").trim().slice(0, 60);
}
function initialsOf(name){ return String(name || "").replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !/^(pvt|ltd|private|limited|and|the|co|llp)$/i.test(w)).map(w => w[0].toUpperCase()).join("").slice(0, 4) || "X"; }
function voucherXml(e, co){
  const note = e.noteKind === "credit";                 // a supplier's credit note: a Debit Note in Tally, every line reversed
  const s = e.snapshot, vt = xesc(note ? (co.debitNoteType || "Debit Note") : (co.voucherType || "Journal")), d = tallyDate(e.x.invoiceDate);
  let x = '<VOUCHER VCHTYPE="' + vt + '" ACTION="Create" OBJVIEW="Accounting Voucher View">\n';
  x += "<DATE>" + d + "</DATE>\n<EFFECTIVEDATE>" + d + "</EFFECTIVEDATE>\n";
  x += "<VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME>\n";
  const vno = vchNoFor(e, co);
  if (vno) x += "<VOUCHERNUMBER>" + xesc(vno) + "</VOUCHERNUMBER>\n";
  x += "<REFERENCE>" + xesc(e.x.invoiceNo) + "</REFERENCE>\n<REFERENCEDATE>" + d + "</REFERENCEDATE>\n";
  x += "<PARTYLEDGERNAME>" + xesc(tallyLedgerName(e.partyLedger)) + "</PARTYLEDGERNAME>\n";
  x += "<NARRATION>" + xesc((e.narration || narrationFor(e)) + " | TDSDesk:" + e.id) + "</NARRATION>\n";
  x += "<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n<ISINVOICE>No</ISINVOICE>\n";
  x += "<ISOPTIONAL>" + (co.createOptional ? "Yes" : "No") + "</ISOPTIONAL>\n";
  s.lines.forEach(l => {
    const dr = note ? l.side !== "Dr" : l.side === "Dr", a = dr ? "-" + amt(l.amt) : amt(l.amt);
    x += "<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>" + xesc(tallyLedgerName(l.ledger)) + "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>" + (dr ? "Yes" : "No") + "</ISDEEMEDPOSITIVE>\n<AMOUNT>" + a + "</AMOUNT>\n";
    if (l.role === "party" && co.billwise && e.x.invoiceNo){
      x += "<BILLALLOCATIONS.LIST>\n<NAME>" + xesc(e.x.invoiceNo) + "</NAME>\n<BILLTYPE>New Ref</BILLTYPE>\n<AMOUNT>" + a + "</AMOUNT>\n</BILLALLOCATIONS.LIST>\n";
    }
    x += "</ALLLEDGERENTRIES.LIST>\n";
  });
  return x + "</VOUCHER>\n";
}
function envelope(list, co){
  const name = co.tallyName || co.name;
  const used = new Set(list.flatMap(e => (e.snapshot ? e.snapshot.lines : []).map(l => String(l.ledger).toLowerCase())));
  const masters = S.bank && S.bank.cid === co.id ? S.bank.newLed.filter(l => !l.sent && used.has(l.name.toLowerCase())) : [];
  const sv = name ? "<STATICVARIABLES><SVCURRENTCOMPANY>" + xesc(name) + "</SVCURRENTCOMPANY></STATICVARIABLES>" : "";
  return '<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n<BODY>\n<IMPORTDATA>\n<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>' + sv + "</REQUESTDESC>\n<REQUESTDATA>\n" +
    masters.map(l => '<TALLYMESSAGE xmlns:UDF="TallySchema">\n' + ledgerMasterXml(l) + "</TALLYMESSAGE>\n").join("") +
    list.map(e => '<TALLYMESSAGE xmlns:UDF="TallySchema">\n' + voucherXml(e, co) + "</TALLYMESSAGE>\n").join("") +
    "</REQUESTDATA>\n</IMPORTDATA>\n</BODY>\n</ENVELOPE>\n";
}
function csvCell(v){ const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function registerCsv(list, co){
  const head = ["Client","Invoice date","Invoice no","Deductee","PAN","GSTIN","Payment type","Section (2025 Act)","Old section","Taxable value","Invoice total","TDS base","Rate %","TDS booked","TDS that applies","Reason TDS not booked","Reverse charge","RCM tax","GST credit","Party ledger","Expense ledger","Approved on","Sent to Tally"];
  const rows = list.map(e => { const s = e.snapshot || {}; return [co.name, e.x.invoiceDate, e.x.invoiceNo, e.x.vendorName, s.pan, e.x.vendorGstin, s.label, s.ref, s.old, s.base, s.total, s.applicable ? s.tdsBase : 0, s.rate, s.tds, s.tdsWould != null ? s.tdsWould : s.tds, s.skip ? skipText(s.skip) : "", s.rcm ? catLabel(RCM_CATS, s.rcm.cat) + " @ " + s.rcm.rate + "%" : "No", s.rcm ? s.rcm.tax : 0, s.blocked ? "Blocked: " + catLabel(BLOCK_CATS, s.blocked) : "Claimed", e.partyLedger, e.expenseLedger, (e.approvedAt || "").slice(0, 10), e.exportedAt ? e.exportedAt.slice(0, 10) : "No"]; });
  return "\uFEFF" + [head].concat(rows).map(r => r.map(csvCell).join(",")).join("\r\n");
}
async function saveFile(filename, data){
  let dl = null;
  try { dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null; } catch(e){ dl = null; }
  if (!dl){
    if (!window.claude){
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], {type:"text/plain"}));
      const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    }
    toast("Downloads are not available in this view."); return false;
  }
  try { await dl.save({filename, data}); return true; }
  catch (e){
    toast(e && e.code === "declined" ? "Download cancelled." : e && e.code === "rate_limited" ? "A download prompt is already open." : "The file could not be saved here.");
    return false;
  }
}
async function exportXml(markSent){
  const co = CO(), list = Object.values(D().entries).filter(e => e.status === "approved" && !e.exportedAt).sort(byDate);
  if (!list.length){ toast("No approved entries are waiting for this client."); return; }
  const stamp = new Date().toISOString().slice(0, 10), base = "tally-" + slug(co.name) + "-" + stamp;
  const ok = await saveFile(base + ".zip", zipOne(base + ".xml", envelope(list, co)));
  if (ok && markSent){
    const t = new Date().toISOString();
    list.forEach(e => { e.exportedAt = t; Store.saveEntry(co.id, e); });
    toast(list.length + " entr" + (list.length > 1 ? "ies" : "y") + " of " + co.name + " marked as sent to Tally.");
    refreshStats(co.id); render();
  }
}
async function exportCsv(){
  const co = CO(), list = Object.values(D().entries).filter(e => e.status === "approved").sort(byDate);
  if (!list.length){ toast("Nothing approved yet for this client."); return; }
  await saveFile("tds-register-" + slug(co.name) + "-" + new Date().toISOString().slice(0, 10) + ".csv", registerCsv(list, co));
}
function clearSent(){
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString();
  const old = Object.values(D().entries).filter(e => e.exportedAt && e.exportedAt < cutoff);
  old.forEach(e => { delete D().entries[e.id]; Store.deleteEntry(S.coId, e.id); });
  toast(old.length ? old.length + " old sent invoices cleared. Deductee year totals are kept." : "No sent invoices older than 90 days.");
  refreshStats(S.coId); render();
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */
const app = document.getElementById("app");
function sortedCompanies(){ return Object.values(S.companies).sort((a, b) => a.name.localeCompare(b.name)); }
function recentIds(){ try { return JSON.parse(lsGet("tdsdesk:recent") || "[]"); } catch(e){ return []; } }

function render(){
  const drafts = {};
  document.querySelectorAll("#app [data-draft]").forEach(el => { if (el.id) drafts[el.id] = el.value; });
  const a = document.activeElement, fk = a && a.dataset ? (a.dataset.fk || (a.hasAttribute("data-draft") ? "id:" + a.id : null)) : null;
  let pos = null; try { pos = fk && (a.type === "text" || a.type === "search") ? a.selectionStart : null; } catch(e){}
  const typed = fk && a.hasAttribute && a.hasAttribute("data-keeptyped") ? a.value : null;
  renderTop();
  if (signInNeeded()){
    app.innerHTML = viewSignIn();
    if (typeof acAfterRender === "function") acAfterRender();
    const f0 = document.querySelector('[data-cloud="email"]');
    if (f0 && !document.activeElement.matches("input")) f0.focus();
    return;
  }
  const banner = creditBanner() + (S.storeKind === "db" || (Cloud.on() && Cloud.st && !Cloud.st.error) ? "" :
    '<p class="banner">' + (S.storeKind === "local" || S.storeKind === "idb" ? "Your work is saved in this browser only. Clearing browser data will remove it." : "Your work is not being saved. It will be lost when you close this page.") + "</p>");
  let body;
  if (S.view === "company" && CO() && !S.loadingCo && S.tab === "books"){
    body = viewBooks();
  } else if (S.view === "company" && CO() && !S.loadingCo && S.tab === "txn"){
    body = viewTransactions();
  } else if (S.view === "company" && CO() && !S.loadingCo && S.tab === "dash"){
    body = viewClientDash();
  } else if (S.view === "company" && CO() && !S.loadingCo && S.tab === "clientInbox"){
    body = (docqPanel(S.coId) || '<p class="note">Nothing is waiting for this client. Documents sent in by office automation appear here.</p>') +
      '<div class="row" style="margin-top:10px"><button class="btn small" data-nav="inbox">Inbox for all clients</button></div>';
  } else if (S.view === "company" && CO() && !S.loadingCo && S.tab === "export"){
    body = viewPostStep();
  } else if (S.view === "company" && CO() && !S.loadingCo && S.tab === "done"){
    body = viewDoneStep();
  } else if (S.view === "company" && CO() && !S.loadingCo && (S.tab === "bankset" || S.tab === "bankrules")){
    body = viewBankSetup(S.tab === "bankrules" ? "rules" : "accounts");
  } else if (S.view === "company" && CO() && S.step === "collect" && !isSetupTab(S.tab) && !S.loadingCo){
    body = viewCollect();
  } else if (S.view === "company" && CO()){
    body = S.loadingCo ? '<p class="note">Opening ' + esc(CO().name) + "…</p>" :
      ((S.tab === "invoices" || S.tab === "export") && (!S.bank || S.bank.cid !== CO().id) && !S.bankCtxLoading ? (S.bankCtxLoading = true, loadBank(CO().id).then(() => { S.bankCtxLoading = false; autoMapCompanyLedgers(CO()); render(); }), "") : "") +
      (S.tab === "invoices" ? viewInvoices() : S.tab === "bank" ? viewBank() : S.tab === "sales" ? viewSales() : S.tab === "deductees" ? viewParties() : S.tab === "settings" ? viewCompanySettings() : viewExport());
  } else {
    S.view = "home";
    body = S.homeTab === "today" ? viewToday() : S.homeTab === "inbox" ? viewInboxAll() : S.homeTab === "tally" ? viewTallyHome() : S.homeTab === "rules" ? viewRules() : viewClients();
  }
  const working = S.view === "company" && CO() ? billsBusyCard() + docsBusyCard() : "";
  app.innerHTML = selfTestBanner() + banner + working + body + drawerHtml() + actionBar() + colPopHtml() + tallyPanelHtml() + firmMenuHtml();
  placeColPop();
  Object.entries(drafts).forEach(([id, v]) => { const el = document.getElementById(id); if (el && el.hasAttribute("data-draft") && el.value !== v) el.value = v; });
  renderSwitcher();
  if (fk){
    const el = fk.indexOf("id:") === 0 ? document.getElementById(fk.slice(3)) : document.querySelector('[data-fk="' + fk + '"]');
    if (el && typed !== null && el.value !== typed) el.value = typed;
    if (el && el !== document.activeElement){ el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch(e){} }
  }
  if (typeof acAfterRender === "function") acAfterRender();
  if (S.view === "company" && ["bank", "invoices", "export", "sales"].includes(S.tab) && typeof maybeLiveSync === "function") maybeLiveSync();
}

