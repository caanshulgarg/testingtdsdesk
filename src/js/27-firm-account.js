/* ================================================================== */
/* Firm account: the same data on every computer (Supabase)            */
/* ================================================================== */
const CLOUD_DEFAULT = {url: "https://nrtczucrlgalvtojwoes.supabase.co", key: "sb_publishable_HMkVf1jl9iOA8Xt4YaUezg_--4cIWVR", auto: true};
const CLOUD_CHUNK = 300;      // bank rows per record
const Cloud = {
  st: {state: "off", email: "", role: "", firm: "", lastSync: 0, pending: 0, error: "", busy: "", members: []},
  cfg(){ let c = {}; try { c = JSON.parse(lsGet("tdsdesk:cloud") || "{}"); } catch (e){} return Object.assign({}, CLOUD_DEFAULT, c); },
  setCfg(p){ lsSet("tdsdesk:cloud", JSON.stringify(Object.assign(this.cfg(), p))); },
  sess(){ let s = null; try { s = JSON.parse(lsGet("tdsdesk:cloudsess") || "null"); } catch (e){} return s; },
  setSess(s){ if (s) lsSet("tdsdesk:cloudsess", JSON.stringify(s)); else lsDel("tdsdesk:cloudsess"); },
  on(){ return !!(this.sess() && this.sess().access_token); },
  marks(){ let m = {}; try { m = JSON.parse(lsGet("tdsdesk:cloudmarks") || "{}"); } catch (e){} return m; },
  setMarks(m){ lsSet("tdsdesk:cloudmarks", JSON.stringify(m)); },
  async authCall(path, body){
    const c = this.cfg();
    const r = await fetch(c.url.replace(/\/+$/, "") + "/auth/v1/" + path, {method: "POST", headers: {apikey: c.key, "Content-Type": "application/json"}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || ("Sign-in failed (" + r.status + ")"));
    return j;
  },
  async signIn(email, password){
    const j = await this.authCall("token?grant_type=password", {email: String(email).trim(), password});
    this.setSess({access_token: j.access_token, refresh_token: j.refresh_token, at: Date.now(), expires_in: j.expires_in || 3600, email: (j.user && j.user.email) || email, user_id: j.user && j.user.id});
    this.setCfg({email: String(email).trim()});
    await this.whoAmI();
    return true;
  },
  async refreshToken(){
    const s = this.sess();
    if (!s || !s.refresh_token) throw new Error("Signed out");
    const j = await this.authCall("token?grant_type=refresh_token", {refresh_token: s.refresh_token});
    this.setSess(Object.assign({}, s, {access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token, at: Date.now(), expires_in: j.expires_in || 3600}));
  },
  signOut(){ this.setSess(null); this.st = {state: "off", email: "", role: "", firm: "", lastSync: 0, pending: 0, error: "", busy: "", members: []}; },
  async api(path, opts, retry){
    const c = this.cfg(), s = this.sess();
    if (!s) throw new Error("Signed out");
    opts = opts || {};
    const headers = Object.assign({apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, opts.headers || {});
    const r = await fetch(c.url.replace(/\/+$/, "") + "/rest/v1/" + path, {method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined});
    if (r.status === 401 && !retry){ await this.refreshToken(); return this.api(path, opts, true); }
    const text = await r.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (e){ j = null; }
    if (!r.ok) throw new Error((j && (j.message || j.hint)) || ("Cloud error " + r.status));
    return j;
  },
  async changePassword(pw){
    const c = this.cfg(), sess = this.sess();
    const r = await fetch(c.url.replace(/\/+$/, "") + "/auth/v1/user", {method: "PUT", headers: {apikey: c.key, Authorization: "Bearer " + sess.access_token, "Content-Type": "application/json"}, body: JSON.stringify({password: pw})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.message || j.error_description || ("Could not change the password (" + r.status + ")"));
    return true;
  },
  async whoAmI(){
    const rows = await this.api("members?select=user_id,firm_id,name,email,role,active");
    const me = (rows || []).find(m => m.user_id === (this.sess() || {}).user_id) || (rows || [])[0];
    this.st.members = rows || [];
    if (me){ this.st.role = me.role; this.st.firm = me.firm_id; }
    this.st.email = (this.sess() || {}).email || "";
    this.st.state = me ? "ok" : "nofirm";
    if (!me) this.st.error = "This account is not linked to a firm yet.";
    return me;
  }
};
/* ---------- what is kept in the cloud ---------- */
function cloudSnapshot(){
  const out = [];
  const add = (kind, id, client_id, data) => out.push({kind, id, client_id: client_id || "", data});
  add("firm", "firm", "", S.firm);
  Object.values(S.companies).forEach(c => add("client", c.id, c.id, c));
  Object.entries(S.data || {}).forEach(([cid, d]) => {
    Object.values((d && d.entries) || {}).forEach(e => add("entry", e.id, cid, e));
    Object.values((d && d.parties) || {}).forEach(p => add("party", p.id, cid, p));
  });
  Object.values(S.inbox || {}).forEach(i => add("unsorted", i.id, "", i));
  const b = S.bank;
  if (b && b.cid && !b.loading){
    add("bank_meta", b.cid, b.cid, {rules: b.rules, newLed: b.newLed, keys: b.keys, hist: b.hist});
    b.stmts.forEach(st => add("bank_stmt", b.cid + ":" + st.id, b.cid, st));
    if (b.cur && b.rows.length){
      for (let i = 0; i * CLOUD_CHUNK < b.rows.length; i++) add("bank_rows", b.cid + ":" + b.cur + ":" + i, b.cid, {rows: b.rows.slice(i * CLOUD_CHUNK, (i + 1) * CLOUD_CHUNK)});
    }
  }
  const s = S.sales;
  if (s && s.cid && !s.loading){
    add("sales_cfg", s.cid, s.cid, {cfg: s.cfg, hist: s.hist});
    s.list.forEach(v => add("sales", s.cid + ":" + v.id, s.cid, v));
  }
  return out;
}
function cloudKey(r){ return r.kind + "|" + (r.client_id || "") + "|" + r.id; }
// changes since the last sync (and anything deleted here)
function cloudChanges(){
  const marks = Cloud.marks(), snap = cloudSnapshot(), now = [], seen = {};
  snap.forEach(r => {
    const k = cloudKey(r), h = fpHash(JSON.stringify(r.data));
    seen[k] = h;
    if (marks[k] !== h) now.push(Object.assign({}, r, {hash: h}));
  });
  const owned = new Set(snap.map(r => r.kind).concat(["firm", "client", "entry", "party", "unsorted", "bank_meta", "bank_stmt", "bank_rows", "sales", "sales_cfg"]));
  owned.delete("inbox");
  // something counts as deleted only if what holds it is open here and it is really gone:
  // a client's bills when that client is loaded, its bank data when its bank is open, its sales when its sales are open
  const b = S.bank && !S.bank.loading ? S.bank : null, sl = S.sales && !S.sales.loading ? S.sales : null;
  const judgeable = k => {
    const [kind, cid, ...rest] = k.split("|"), id = rest.join("|");
    if (kind === "entry" || kind === "party") return !!(S.data[cid] && S.data[cid].loaded);
    if (kind === "bank_meta" || kind === "bank_stmt") return !!(b && b.cid === cid);
    if (kind === "bank_rows"){
      if (!b || b.cid !== cid) return false;
      const sid = id.split(":")[1];
      return sid === b.cur || !b.stmts.some(st => st.id === sid);   // the open statement, or one that was deleted
    }
    if (kind === "sales" || kind === "sales_cfg") return !!(sl && sl.cid === cid);
    return true;
  };
  const gone = Object.keys(marks).filter(k => !(k in seen) && marks[k] !== "gone" && owned.has(k.split("|")[0]) && judgeable(k)).map(k => {
    const bits = k.split("|");
    return {kind: bits[0], client_id: bits[1] || "", id: bits.slice(2).join("|"), data: {}, deleted: true, hash: "gone"};
  });
  return {changes: now.concat(gone), seen};
}
async function cloudPush(){
  const {changes} = cloudChanges();
  if (!changes.length) return 0;
  const marks = Cloud.marks();
  const clients = changes.filter(r => r.kind === "client");
  const rest = changes.filter(r => r.kind !== "client");
  const sendBatch = async (table, rows) => {
    await Cloud.api(table + "?on_conflict=" + (table === "clients" ? "firm_id,id" : "firm_id,kind,id"), {
      method: "POST", headers: {Prefer: "resolution=merge-duplicates,return=minimal"}, body: rows});
  };
  for (let i = 0; i < clients.length; i += 20){
    const rows = clients.slice(i, i + 20).map(r => ({firm_id: Cloud.st.firm, id: r.id, name: r.data.name || "", gstin: r.data.gstin || "", pan: r.data.pan || "", tally_name: r.data.tallyName || "", data: r.data, deleted: !!r.deleted}));
    await sendBatch("clients", rows);
    clients.slice(i, i + 20).forEach(r => { marks[cloudKey(r)] = r.hash; });
    Cloud.setMarks(marks);
  }
  for (let i = 0; i < rest.length; i += 20){
    const part = rest.slice(i, i + 20);
    await sendBatch("records", part.map(r => ({firm_id: Cloud.st.firm, kind: r.kind, id: r.id, client_id: r.client_id || "", data: r.data, deleted: !!r.deleted})));
    part.forEach(r => { marks[cloudKey(r)] = r.hash; });
    Cloud.setMarks(marks);
  }
  return changes.length;
}
async function cloudPull(){
  const cfg = Cloud.cfg();
  let since = cfg.lastPull || "1970-01-01T00:00:00Z";
  let got = 0, applied = [];
  for (const table of ["clients", "records"]){
    let cursor = since;
    for (let page = 0; page < 40; page++){
      const sel = table === "clients" ? "id,data,deleted,updated_at" : "kind,id,client_id,data,deleted,updated_at";
      const rows = await Cloud.api(table + "?select=" + sel + "&updated_at=gt." + encodeURIComponent(cursor) + "&order=updated_at.asc&limit=200");
      if (!rows || !rows.length) break;
      rows.forEach(r => applied.push(table === "clients" ? {kind: "client", id: r.id, client_id: r.id, data: r.data, deleted: r.deleted, updated_at: r.updated_at} : r));
      got += rows.length;
      cursor = rows[rows.length - 1].updated_at;
      if (rows.length < 200) break;
    }
  }
  if (!applied.length) return 0;
  const newest = applied.map(r => r.updated_at).sort().pop();
  await cloudApply(applied);
  Cloud.setCfg({lastPull: newest});
  return got;
}
// write what came from the cloud into this computer
function stableStr(v){
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStr).join(",") + "]";
  return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + stableStr(v[k])).join(",") + "}";
}
async function cloudApply(rows){
  const marks = Cloud.marks();
  const touchedBank = new Set(), touchedSales = new Set();
  const mine = new Map(); try { cloudSnapshot().forEach(r => mine.set(cloudKey(r), stableStr(r.data))); } catch (e){}
  for (const r of rows){
    const k = cloudKey(r);
    if (!r.deleted && mine.has(k) && mine.get(k) === stableStr(r.data)){ marks[k] = fpHash(JSON.stringify(r.data)); continue; }   // this computer's own save coming back
    if (r.kind !== "inbox") marks[k] = r.deleted ? "gone" : fpHash(JSON.stringify(r.data));   // inbox records are office automation's, never tracked for deletion
    const cid = r.client_id;
    if (r.kind === "firm"){ if (!r.deleted){ S.firm = Object.assign(clone(DEFAULT_FIRM), r.data); Store.saveFirm(); } }
    else if (r.kind === "client"){
      if (r.deleted){ delete S.companies[r.id]; Store.put("companies/" + r.id, null); }
      else { S.companies[r.id] = fixCompany(clone(r.data)); Store.saveCompany(S.companies[r.id]); }
    }
    else if (r.kind === "entry" || r.kind === "party"){
      if (!S.data[cid] || !S.data[cid].loaded){ try { await Store.loadCompany(cid); } catch (e){} }
      if (!S.data[cid]) S.data[cid] = {parties: {}, entries: {}, loaded: true};
      const bag = r.kind === "entry" ? S.data[cid].entries : S.data[cid].parties;
      if (r.deleted){ if (r.kind === "entry" && bag[r.id] && bag[r.id].fileHash) unregisterHash(cid, bag[r.id].fileHash); delete bag[r.id]; Store.put("companies/" + cid + "/" + (r.kind === "entry" ? "entries/" : "parties/") + r.id, null); }
      else { bag[r.id] = clone(r.data); if (r.kind === "entry") Store.saveEntry(cid, bag[r.id]); else Store.saveParty(cid, bag[r.id]); }
    }
    else if (r.kind === "unsorted"){ if (r.deleted) delete S.inbox[r.id]; else { S.inbox[r.id] = clone(r.data); Store.saveInbox(S.inbox[r.id]); } }
    else if (r.kind === "inbox"){ if (r.deleted) delete S.docq[r.id]; else S.docq[r.id] = Object.assign({}, r.data, {id: r.id, client_id: r.client_id || ""}); }
    else if (r.kind === "bank_meta"){ await cloudApplyBankMeta(cid, r); touchedBank.add(cid); }
    else if (r.kind === "bank_stmt" || r.kind === "bank_rows"){ await cloudApplyBankPart(r); touchedBank.add(cid); }
    else if (r.kind === "sales" || r.kind === "sales_cfg"){ await cloudApplySales(r); touchedSales.add(cid); }
  }
  Cloud.setMarks(marks);
  // reload what is open on screen
  if (S.bank && touchedBank.has(S.bank.cid)){
    const o = S.bank, keep = {filter: o.filter, grouped: o.grouped, q: o.q, f: o.f, from: o.from, to: o.to, limit: o.limit, sel: o.sel, sticky: o.sticky, cur: o.cur};
    await loadBank(o.cid);
    if (S.bank && S.bank.cid === o.cid){
      const sameStmt = keep.cur && S.bank.stmts.some(x => x.id === keep.cur);
      Object.assign(S.bank, {filter: keep.filter, grouped: keep.grouped, q: keep.q, f: keep.f, from: keep.from, to: keep.to, limit: keep.limit});
      if (sameStmt){ if (S.bank.cur !== keep.cur && typeof openStatement === "function") await openStatement(keep.cur); S.bank.sel = new Set([...keep.sel].filter(id => S.bank.rows.some(r => r.id === id))); }
    }
  }
  if (S.sales && touchedSales.has(S.sales.cid)){
    const o = S.sales, keep = {filter: o.filter, q: o.q, sel: o.sel, openId: o.openId, view: o.view};
    await loadSales(o.cid);
    if (S.sales && S.sales.cid === o.cid) Object.assign(S.sales, {filter: keep.filter, q: keep.q, openId: keep.openId, view: keep.view, sel: new Set([...keep.sel].filter(id => S.sales.list.some(v => v.id === id)))});
  }
  Object.keys(S.companies).forEach(id => { try { refreshStats(id); } catch (e){} });
}
async function cloudApplyBankMeta(cid, r){
  if (r.deleted) return;
  const d = r.data || {};
  await Promise.all([BankDB.set("rules:" + cid, d.rules || []), BankDB.set("newled:" + cid, d.newLed || []), BankDB.set("keys:" + cid, d.keys || {}), BankDB.set("hist:" + cid, d.hist || {rows: {}})]);
}
async function cloudApplyBankPart(r){
  const bits = String(r.id).split(":");
  const cid = bits[0], sid = bits[1];
  if (r.kind === "bank_stmt"){
    const list = (await BankDB.get("stmts:" + cid)) || [];
    const i = list.findIndex(x => x.id === sid);
    if (r.deleted){ if (i >= 0){ list.splice(i, 1); await BankDB.set("stmts:" + cid, list); await BankDB.del("stmt:" + cid + ":" + sid); } return; }
    if (i >= 0) list[i] = r.data; else list.push(r.data);
    await BankDB.set("stmts:" + cid, list);
    return;
  }
  const part = Number(bits[2] || 0);
  const key = "stmt:" + cid + ":" + sid;
  const rows = (await BankDB.get(key)) || [];
  if (r.deleted){ return; }
  const incoming = (r.data && r.data.rows) || [];
  const merged = rows.slice();
  for (let i = 0; i < incoming.length; i++) merged[part * CLOUD_CHUNK + i] = incoming[i];
  await BankDB.set(key, merged.filter(Boolean));
}
async function cloudApplySales(r){
  const bits = String(r.id).split(":");
  const cid = bits[0], id = bits.slice(1).join(":");
  if (r.kind === "sales_cfg"){
    if (r.deleted) return;
    await BankDB.set("salescfg:" + cid, (r.data || {}).cfg || {});
    await BankDB.set("saleshist:" + cid, (r.data || {}).hist || {});
    return;
  }
  const list = (await BankDB.get("sales:" + cid)) || [];
  const i = list.findIndex(v => v.id === id);
  if (r.deleted){ if (i >= 0){ list.splice(i, 1); await BankDB.set("sales:" + cid, list); } return; }
  if (i >= 0) list[i] = r.data; else list.push(r.data);
  await BankDB.set("sales:" + cid, list);
}
/* ---------- the sync itself ---------- */
let cloudTimer = null, cloudBusy = false;
async function cloudSync(manual){
  if (!Cloud.on() || cloudBusy) return;
  if (!Cloud.st.firm){ try { await Cloud.whoAmI(); } catch (e){ Cloud.st.error = e.message; renderTop(); return; } }
  if (!Cloud.st.firm) return;
  cloudBusy = true;
  Cloud.st.busy = "Syncing\u2026"; Cloud.st.error = "";
  if (manual) render();
  try {
    const sent = await cloudPush();
    const got = await cloudPull();
    Cloud.st.lastSync = Date.now();
    Cloud.st.pending = cloudChanges().changes.length;
    Cloud.st.state = "ok";
    if (manual) toast(sent || got ? "Synced: " + sent + " sent, " + got + " received." : "Everything is already up to date.");
  } catch (e){
    Cloud.st.error = e.message;
    Cloud.st.state = /Signed out|JWT|401/i.test(e.message) ? "signedout" : "error";
    if (manual) toast("Sync failed: " + e.message);
  }
  Cloud.st.busy = ""; cloudBusy = false;
  render();
}
function startCloudSync(){
  clearInterval(cloudTimer);
  if (!Cloud.on()) return;
  loadAccount(true);
  cloudSync(false);
  cloudTimer = setInterval(() => { if (document.visibilityState === "visible" && Cloud.cfg().auto !== false) cloudSync(false); }, 45000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Cloud.on() && Cloud.cfg().auto !== false) cloudSync(false); });
function whoChip(){
  if (!Cloud.on()) return "";
  return whoChipInner() + '<button class="tchip signout" data-act="signOutNow" title="Sign out of TDS Desk">\u23fb Sign out</button>';
}
function whoChipInner(){
  const a = S.account, who = a && a.me ? (a.me.name || a.me.email) : Cloud.st.email;
  return '<button class="tchip" data-act="openSettings" title="' + esc(Cloud.st.email) + '">' + esc(who) + (a && a.superadmin ? " \u00b7 administrator" : a && a.me ? " \u00b7 " + esc(a.me.role) : "") + "</button>";
}
function cloudChip(){
  if (!Cloud.on()) return "";
  const st = Cloud.st;
  if (st.busy) return '<span class="tchip off">Syncing\u2026</span>';
  if (st.state === "signedout") return '<button class="tchip bad" data-act="openSettings">Sign in again</button>';
  if (st.error) return '<button class="tchip warn" data-act="openSettings" title="' + esc(st.error) + '">Sync problem</button>';
  const mins = st.lastSync ? Math.round((Date.now() - st.lastSync) / 60000) : null;
  return '<span class="tchip ok" title="' + esc(st.email) + (st.lastSync ? " \u00b7 last sync " + new Date(st.lastSync).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : "") + '">\u2601 Shared' + (mins > 5 ? " \u00b7 " + mins + "m" : "") + "</span>";
}
function viewCloudSettings(){
  const c = Cloud.cfg(), st = Cloud.st;
  let h = '<div class="pane"><h2>Firm account (shared data)</h2>';
  if (!Cloud.on()){
    h += '<p class="note" style="margin:0 0 10px">Sign in to share clients, bills, bank statements and sales invoices with the rest of the firm. Without signing in, everything stays on this computer only.</p>' +
      '<div class="grid"><label class="f"><span>Email</span><input type="email" data-cloud="email" data-fk="cloudemail" value="' + esc((S.cloudForm && S.cloudForm.email) || c.email || "") + '" autocomplete="username"></label>' +
      '<label class="f"><span>Password</span><input type="password" data-cloud="password" data-fk="cloudpw" value="' + esc((S.cloudForm && S.cloudForm.password) || "") + '" autocomplete="current-password"></label></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn small primary" data-act="cloudSignIn">Sign in</button></div>' +
      (st.error ? '<p class="bk-warn" style="margin-top:10px">' + esc(st.error) + "</p>" : "");
    return h + "</div>";
  }
  const pending = st.pending;
  h += '<p class="note" style="margin:0 0 8px">Signed in as <b>' + esc(st.email) + "</b>" + (st.role ? " (" + esc(st.role) + ")" : "") + (st.lastSync ? " \u00b7 last sync " + new Date(st.lastSync).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : "") + (pending ? " \u00b7 " + pending + " change" + (pending > 1 ? "s" : "") + " waiting to be sent" : " \u00b7 everything is sent") + "</p>";
  if (st.error) h += '<p class="bk-warn">' + esc(st.error) + "</p>";
  h += '<label class="chk"><input type="checkbox" data-cloud="auto"' + (c.auto !== false ? " checked" : "") + "> Keep in sync automatically (every 45 seconds)</label>" +
    '<div class="row" style="margin-top:10px"><button class="btn small primary" data-act="cloudSync"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Syncing\u2026" : "Sync now") + '</button><button class="btn small" data-act="cloudSignOut">Sign out</button></div>';
  h += '<h3 style="margin:14px 0 4px;font-size:15px">Change password</h3><div class="bk-form two"><label><span>New password (8 characters or more)</span><input type="password" data-cloud="newpw" data-fk="cloudnewpw" autocomplete="new-password"></label>' +
    '<label><span>Repeat it</span><input type="password" data-cloud="newpw2" data-fk="cloudnewpw2" autocomplete="new-password"></label></div>' +
    '<div class="row" style="margin-top:8px"><button class="btn small" data-act="cloudPassword">Change password</button></div>';
  if ((st.members || []).length) h += '<h3 style="margin:14px 0 4px;font-size:15px">People in the firm</h3><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>' +
    st.members.map(m => "<tr><td>" + esc(m.name || "\u2014") + "</td><td>" + esc(m.email) + "</td><td>" + esc(m.role) + (m.active ? "" : " (off)") + "</td></tr>").join("") + "</tbody></table>";
  return h + "</div>";
}

/* ---------- plan, balance and charging ---------- */
const MODULE_ICON = {bills: "\u{1F9FE}", bank: "\u{1F3E6}", sales: "\u{1F4C4}", claude: "\u2728", vision: "\u{1F441}", tally: "\u{1F4D2}", cloud: "\u2601", clients: "\u{1F465}"};
Cloud.rpc = async function(name, args){ return this.api("rpc/" + name, {method: "POST", body: args || {}}); };
Cloud.fn = async function(name, body){
  const c = this.cfg(), s = this.sess();
  if (!s) throw new Error("Sign in to the firm account first.");
  const r = await fetch(c.url.replace(/\/+$/, "") + "/functions/v1/" + name, {
    method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: JSON.stringify(body || {})});
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw Object.assign(new Error(j.error || ("Request failed (" + r.status + ")")), {reason: j.reason, balance: j.balance});
  return j;
};
async function loadAccount(quiet){
  setTimeout(() => loadDocq(true), 0);
  if (!Cloud.on()) return null;
  try {
    const a = await Cloud.rpc("my_account");
    S.account = a || null;
    try { pickEngine(); } catch (e){}      // the plan may provide Claude
    if (a && a.superadmin && !S.adminData) loadAdminOverview(true);
    if (typeof SUP === "object") SUP.load(true);          // the Help count: tickets awaiting an answer
    if (!quiet) render();
    return a;
  } catch (e){ if (!quiet) toast("Could not read the account: " + e.message); return null; }
}
function accountBalance(){ return S.account && S.account.firm ? num(S.account.firm.balance) : null; }
function moduleIncluded(code){
  const inc = S.account && S.account.firm && S.account.firm.plan && S.account.firm.plan.includes;
  return !!(inc && inc[code]);
}
function modulePrice(code){
  const m = ((S.account || {}).modules || []).find(x => x.code === code);
  return m ? num(m.price) : 0;
}
// charge for work done here; returns true when the work may go ahead
async function charge(code, qty, ref, note){
  if (!Cloud.on() || !S.account) return true;           // not signed in: nothing is charged
  try {
    const r = await Cloud.rpc("charge_usage", {p_code: code, p_qty: qty, p_ref: ref || "", p_note: note || ""});
    if (r && r.ok){ if (S.account.firm) S.account.firm.balance = r.balance; renderTop(); return true; }
    if (r && r.reason === "low_balance"){
      S.creditStop = {at: Date.now(), needed: r.needed, balance: r.balance, code};
      toast("Credit finished: " + INR.format(num(r.needed)) + " needed, " + INR.format(num(r.balance)) + " left. Ask the administrator to add credit.");
    } else if (r && r.reason === "module_off") toast("This part is switched off for your firm.");
    else if (r && r.reason === "firm_off") toast("This firm's account is switched off. Contact the administrator.");
    render();
    return false;
  } catch (e){ return true; }                            // never block work because the internet is down
}
function creditBanner(){
  const a = S.account;
  if (!a || !a.firm) return "";
  const bal = num(a.firm.balance), warn = num(a.firm.warn_at);
  if (S.creditStop && Date.now() - S.creditStop.at < 6 * 3600e3 && bal <= 0)
    return '<p class="banner" style="border-left-color:var(--stop);background:var(--stop-soft)"><b>Credit finished.</b> Reading new bills, bank statements and invoices is paused. Everything already in TDS Desk still works, and entries can still be posted to Tally. Ask the administrator to add credit.</p>';
  if (bal <= warn)
    return '<p class="banner">Credit left: <b>' + INR.format(bal) + "</b>. Ask the administrator to top it up before it runs out.</p>";
  return "";
}
/* ---------- the firm's own account screen ---------- */
function viewAccount(){
  const a = S.account;
  if (!Cloud.on()) return "";
  if (!a || !a.firm) return '<div class="pane"><h2>Plan and credit</h2><p class="note">Reading the account\u2026</p></div>';
  const f = a.firm, plan = f.plan || {name: "No plan set", monthly_fee: 0, includes: {}};
  const used = (a.usage || []).reduce((m, u) => (m[u.code] = u, m), {});
  const isOwner = (a.me || {}).role === "owner";
  let h = '<div class="pane"><h2>Plan and credit</h2>' +
    '<div class="bk-figs" style="margin:0 0 10px"><div><dt>Credit left</dt><dd' + (num(f.balance) <= num(f.warn_at) ? ' style="color:var(--stop)"' : "") + ">" + INR.format(num(f.balance)) + "</dd></div>" +
    "<div><dt>Plan</dt><dd>" + esc(plan.name) + "</dd></div>" +
    "<div><dt>Monthly</dt><dd>" + (num(plan.monthly_fee) ? INR.format(num(plan.monthly_fee)) : "\u2014") + "</dd></div>" +
    "<div><dt>Since</dt><dd>" + fmtDate(f.period_start) + "</dd></div></div>";
  h += '<div class="tblwrap"><table class="data"><thead><tr><th>What</th><th>How it is charged</th><th class="n">This month</th><th class="n">Spent</th></tr></thead><tbody>' +
    (a.modules || []).map(m => {
      const inc = moduleIncluded(m.code), u = used[m.code];
      return "<tr><td>" + (MODULE_ICON[m.code] || "") + " " + esc(m.title) + (m.enabled ? "" : ' <span class="tag no">off</span>') + "</td>" +
        "<td>" + (m.billing === "free" ? "included" : inc ? '<span class="tag ok">in the plan</span>' : INR.format(num(m.price)) + " " + esc(m.unit)) + "</td>" +
        '<td class="n">' + (u ? num(u.qty) : 0) + '</td><td class="n">' + (u && num(u.spent) ? INR.format(num(u.spent)) : "\u2014") + "</td></tr>";
    }).join("") + "</tbody></table></div>";
  h += '<div class="row" style="margin-top:10px"><button class="btn small" data-act="acctRefresh">Refresh</button><button class="btn small" data-act="acctHistory">' + (S.walletOpen ? "Hide" : "Show") + " credit history</button></div>";
  if (S.walletOpen) h += walletHtml();
  return h + "</div>";
}
function walletHtml(){
  const rows = S.wallet || [];
  if (!rows.length) return '<p class="note" style="margin-top:8px">No entries yet.</p>';
  return '<div class="tblwrap" style="margin-top:8px"><table class="data"><thead><tr><th>When</th><th>What</th><th class="n">Amount</th><th class="n">Left</th><th>Note</th></tr></thead><tbody>' +
    rows.map(w => "<tr><td>" + new Date(w.at).toLocaleString([], {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}) + "</td>" +
      "<td>" + esc(w.kind === "credit" ? "Credit added" : w.kind === "fee" ? "Monthly charge" : w.kind === "refund" ? "Refund" : (w.code || "use")) + "</td>" +
      '<td class="n"' + (num(w.amount) < 0 ? "" : ' style="color:var(--ledger)"') + ">" + INR.format(num(w.amount)) + '</td><td class="n">' + INR.format(num(w.balance_after)) + "</td><td>" + esc(w.note || "") + "</td></tr>").join("") +
    "</tbody></table></div>";
}
function viewAccountPeopleOnly(){
  const a = S.account;
  if (!a) return "";
  return '<div class="pane">' + viewPeople((a.me || {}).role === "owner" || a.superadmin === true) + viewDocsSettings() + viewDropKeys() + viewBackups() + "</div>";
}
function viewBackups(){
  if (!Cloud.on()) return "";
  const list = S.backups;
  let h = '<h3 style="margin:16px 0 6px;font-size:15px">Backups</h3>' +
    '<p class="note" style="margin:0 0 6px">A copy of this firm\u2019s clients, bills, bank statements and sales is taken every night and the last fourteen are kept. Download one to keep outside the system.</p>' +
    '<div class="row"><button class="btn small" data-act="backupList">' + (list ? "Refresh" : "Show backups") + '</button><button class="btn small" data-act="backupNow">Take one now</button></div>';
  if (!list) return h;
  if (!list.length) return h + '<p class="note" style="margin-top:6px">None yet. Press <b>Take one now</b>.</p>';
  h += '<div class="tblwrap" style="margin-top:8px"><table class="data"><thead><tr><th>Taken</th><th class="n">Clients</th><th class="n">Records</th><th class="n">Size</th><th></th></tr></thead><tbody>' +
    list.slice(0, 14).map(b => "<tr><td>" + new Date(b.taken_at).toLocaleString([], {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}) + '</td><td class="n">' + b.clients +
      '</td><td class="n">' + b.records + '</td><td class="n">' + Math.round(num(b.bytes) / 1024) + ' KB</td><td><button class="btn small" data-backup="' + b.id + '">Download</button></td></tr>').join("") +
    "</tbody></table></div>";
  return h;
}
function viewPeople(canManage){
  const a = S.account;
  if (!a) return "";
  let h = '<h3 style="margin:16px 0 6px;font-size:15px">People in the firm</h3><div class="tblwrap"><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>' +
    (a.people || []).map(p => "<tr><td>" + esc(p.name || "\u2014") + "</td><td>" + esc(p.email) + "</td><td>" + esc(p.role) + (p.active ? "" : " (off)") + "</td>" +
      '<td style="white-space:nowrap">' + (canManage ? '<button class="linkbtn" data-person="reset" data-email="' + esc(p.email) + '">New password</button> ' +
        '<button class="linkbtn" data-person="' + (p.active ? "off" : "on") + '" data-email="' + esc(p.email) + '">' + (p.active ? "Switch off" : "Switch on") + "</button>" : "") + "</td></tr>").join("") +
    "</tbody></table></div>";
  if (canManage) h += '<div class="bk-form three" style="margin-top:8px"><label><span>Name</span><input type="text" id="npName"></label>' +
    '<label><span>Email</span><input type="email" id="npEmail"></label>' +
    '<label><span>Can do</span><select id="npRole"><option value="staff">Everything except billing</option><option value="readonly">Look only</option><option value="owner">Everything, including people</option></select></label></div>' +
    '<div class="row" style="margin-top:6px"><button class="btn small primary" data-act="addPerson">Add this person</button><span class="note">A password is made for them; they can change it after signing in.</span></div>';
  if (S.newPerson) h += '<p class="bk-alert" style="margin-top:8px"><b>' + esc(S.newPerson.email) + "</b> can sign in with the password <b>" + esc(S.newPerson.password) + "</b>. Write it down: it is shown only now.</p>";
  return h;
}
/* ---------- superadmin: firms, credit, plans, prices, keys ---------- */
async function loadAdminOverview(quiet){
  if (!Cloud.on()) return;
  try {
    const d = await Cloud.rpc("admin_overview");
    S.adminData = d && d.firms ? d : null;
    if (!quiet) render();
  } catch (e){ if (!quiet) toast("Could not read the platform data: " + e.message); }
}
function viewSuperadmin(){
  const a = S.account;
  if (!a || !a.superadmin) return "";
  const d = S.adminData;
  let h = '<div class="pane"><h2>Platform (administrator only)</h2>';
  if (!d) return h + '<p class="note">Reading\u2026 <button class="btn small" data-act="adminRefresh">Refresh</button></p></div>';
  const firms = d.firms || [];
  h += '<div class="bk-figs" style="margin:0 0 10px"><div><dt>Firms</dt><dd>' + firms.length + "</dd></div>" +
    "<div><dt>Credit held</dt><dd>" + INR.format(firms.reduce((s, f) => s + num(f.balance), 0)) + "</dd></div>" +
    "<div><dt>Charged this month</dt><dd>" + INR.format(num(d.month)) + "</dd></div></div>";
  h += '<div class="tblwrap"><table class="data"><thead><tr><th>Firm</th><th>Plan</th><th class="n">Credit</th><th class="n">Used this period</th><th class="n">People</th><th></th></tr></thead><tbody>' +
    firms.map(f => "<tr><td><b>" + esc(f.name) + "</b>" + (f.active ? "" : ' <span class="tag no">off</span>') + (f.note ? '<div class="nr">' + esc(f.note) + "</div>" : "") + "</td>" +
      '<td><select data-adminplan="' + f.id + '">' + (d.plans || []).map(p => '<option value="' + p.id + '"' + (p.id === f.plan_id ? " selected" : "") + ">" + esc(p.name) + (num(p.monthly_fee) ? " (" + INR.format(num(p.monthly_fee)) + "/m)" : "") + "</option>").join("") + "</select></td>" +
      '<td class="n"' + (num(f.balance) <= 0 ? ' style="color:var(--stop)"' : "") + ">" + INR.format(num(f.balance)) + '</td><td class="n">' + INR.format(num(f.used_this_period)) + '</td><td class="n">' + f.people + "</td>" +
      '<td style="white-space:nowrap"><button class="btn small" data-adminact="credit" data-firm="' + f.id + '" data-name="' + esc(f.name) + '">Add credit</button> ' +
      '<button class="linkbtn" data-adminact="prices" data-firm="' + f.id + '" data-name="' + esc(f.name) + '">Prices</button> ' +
      '<button class="linkbtn" data-adminact="' + (f.active ? "off" : "on") + '" data-firm="' + f.id + '">' + (f.active ? "Switch off" : "Switch on") + "</button></td></tr>").join("") +
    "</tbody></table></div>";
  if (S.adminPrices){
    const f = firms.find(x => x.id === S.adminPrices);
    if (f) h += '<div class="bdiag" style="margin-top:10px"><b>Prices for ' + esc(f.name) + "</b> \u2014 blank means the standard price." +
      '<table class="data" style="margin-top:6px"><tbody>' + (f.modules || []).map(m => {
        const std = (d.modules || []).find(x => x.code === m.code) || {};
        return "<tr><td>" + (MODULE_ICON[m.code] || "") + " " + esc(std.title || m.code) + '<div class="nr">' + esc(std.unit || "") + " \u00b7 standard " + INR.format(num(std.price)) + "</div></td>" +
          '<td style="width:130px"><input type="number" step="0.01" min="0" id="pr_' + m.code + '" value="' + (num(m.price) === num(std.price) ? "" : num(m.price)) + '" placeholder="' + num(std.price) + '"></td>' +
          '<td><label class="chk"><input type="checkbox" id="en_' + m.code + '"' + (m.enabled ? " checked" : "") + "> on</label></td></tr>";
      }).join("") + "</tbody></table>" +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" data-adminact="savePrices" data-firm="' + f.id + '">Save prices</button><button class="btn small" data-adminact="closePrices">Close</button></div></div>';
  }
  // new firm
  h += '<h3 style="margin:16px 0 6px;font-size:15px">Add a firm</h3>' +
    '<div class="bk-form three"><label><span>Firm name</span><input type="text" id="nfName"></label>' +
    '<label><span>Owner email</span><input type="email" id="nfEmail"></label>' +
    '<label><span>Owner name</span><input type="text" id="nfOwner"></label></div>' +
    '<div class="bk-form three" style="margin-top:6px"><label><span>Plan</span><select id="nfPlan">' + (d.plans || []).map(p => '<option value="' + p.id + '">' + esc(p.name) + "</option>").join("") + "</select></label>" +
    '<label><span>Opening credit</span><input type="number" id="nfCredit" value="0" min="0" step="100"></label></div>' +
    '<div class="row" style="margin-top:6px"><button class="btn small primary" data-adminact="createFirm">Create the firm</button></div>';
  if (S.newFirm) h += '<p class="bk-alert" style="margin-top:8px">Firm made. <b>' + esc(S.newFirm.email) + "</b> signs in with the password <b>" + esc(S.newFirm.password) + "</b>. Shown only now.</p>";
  // plans
  h += '<h3 style="margin:16px 0 6px;font-size:15px">Plans</h3><div class="tblwrap"><table class="data"><thead><tr><th>Plan</th><th class="n">Monthly</th><th>Included</th><th></th></tr></thead><tbody>' +
    (d.plans || []).map(p => "<tr><td>" + esc(p.name) + (p.note ? '<div class="nr">' + esc(p.note) + "</div>" : "") + '</td><td class="n">' + (num(p.monthly_fee) ? INR.format(num(p.monthly_fee)) : "\u2014") + "</td>" +
      "<td>" + (Object.keys(p.includes || {}).length ? Object.entries(p.includes).map(([k, v]) => esc(k) + (v && v.cap ? " (" + v.cap + ")" : "")).join(", ") : "nothing \u2014 pay per use") + "</td>" +
      '<td><button class="linkbtn" data-adminact="editPlan" data-plan="' + p.id + '">Change</button></td></tr>').join("") + "</tbody></table></div>";
  if (S.planEdit){
    const p = (d.plans || []).find(x => x.id === S.planEdit) || {name: "", monthly_fee: 0, includes: {}, note: ""};
    h += '<div class="bdiag" style="margin-top:10px"><b>' + (p.id ? "Change this plan" : "New plan") + "</b>" +
      '<div class="bk-form two" style="margin-top:6px"><label><span>Name</span><input type="text" id="plName" value="' + esc(p.name) + '"></label>' +
      '<label><span>Monthly fee</span><input type="number" id="plFee" step="50" min="0" value="' + num(p.monthly_fee) + '"></label></div>' +
      '<div style="margin-top:8px">Included, and how much of it:</div><table class="data"><tbody>' +
      (d.modules || []).filter(m => m.billing !== "free").map(m => {
        const inc = (p.includes || {})[m.code];
        return "<tr><td>" + (MODULE_ICON[m.code] || "") + " " + esc(m.title) + '</td><td><label class="chk"><input type="checkbox" id="inc_' + m.code + '"' + (inc ? " checked" : "") + "> included</label></td>" +
          '<td style="width:150px"><input type="number" id="cap_' + m.code + '" min="0" step="10" value="' + (inc && inc.cap ? inc.cap : "") + '" placeholder="no limit"></td></tr>';
      }).join("") + "</tbody></table>" +
      '<label class="f" style="margin-top:6px"><span>Note</span><input type="text" id="plNote" value="' + esc(p.note || "") + '"></label>' +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" data-adminact="savePlan" data-plan="' + (p.id || "") + '">Save the plan</button><button class="btn small" data-adminact="closePlan">Close</button></div></div>';
  }
  h += '<div class="row" style="margin-top:6px"><button class="btn small" data-adminact="newPlan">Add a plan</button><button class="btn small" data-adminact="runMonthly">Run this month\'s charges</button><button class="btn small" data-act="adminRefresh">Refresh</button></div>';
  // keys
  const su = (d.signup || {open: false});
  h += '<h3 style="margin:16px 0 6px;font-size:15px">New accounts</h3>' +
    '<div class="bk-form three"><label class="chk" style="align-self:end"><input type="checkbox" id="suOpen"' + (su.open ? " checked" : "") + "> Anyone may create an account</label>" +
    '<label><span>Credit to start with</span><input type="number" id="suCredit" value="' + num(su.trial_credit || 0) + '" step="50" min="0"></label>' +
    '<label><span>Plan they start on</span><select id="suPlan">' + (d.plans || []).map(p => '<option' + (p.name === su.plan ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + "</select></label></div>" +
    '<div class="row" style="margin-top:6px"><button class="btn small" data-adminact="saveSignup">Save</button></div>';
  h += '<h3 style="margin:16px 0 6px;font-size:15px">Keys (only you)</h3><p class="note" style="margin:0 0 6px">These stay on the server. Firms use Claude and Google through us and never see a key. A key cannot be read back here \u2014 only replaced.</p>' +
    '<div class="tblwrap"><table class="data"><tbody>' +
    [["claude_api_key", "Claude API key"], ["google_vision_key", "Google Cloud Vision key"]].map(([k, label]) => {
      const s = (d.secrets || []).find(x => x.name === k);
      return "<tr><td>" + esc(label) + "</td><td>" + (s ? '<span class="tag ok">set</span> \u2026' + esc(s.tail || "") + " \u00b7 " + new Date(s.updated_at).toLocaleDateString() : '<span class="tag no">not set</span>') + "</td>" +
        '<td><input type="password" id="sec_' + k + '" placeholder="paste a new key"></td>' +
        '<td><button class="btn small" data-adminact="saveSecret" data-name="' + k + '">Save</button></td></tr>';
    }).join("") + "</tbody></table></div>";
  return h + "</div>";
}

/* ---------- nothing is shown until someone signs in ---------- */
function signInNeeded(){
  if (window.claude) return false;                 // inside claude.ai, for trying things out
  if (Cloud.on()) return false;                    // signed in (works offline once signed in)
  return Cloud.cfg().gate !== false;
}
Cloud.signUp = async function(d){
  const c = this.cfg();
  const r = await fetch(c.url.replace(/\/+$/, "") + "/functions/v1/signup", {method: "POST", headers: {apikey: c.key, "Content-Type": "application/json"}, body: JSON.stringify(d)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || "The account could not be made.");
  return j;
};
function viewSignUp(){
  const st = Cloud.st, f = S.cloudForm || {};
  return '<div class="signin"><div class="signin-box">' +
    "<h1>Create an account</h1>" +
    '<p class="note" style="margin:8px 0 14px">Your firm gets its own space. Nobody else can see your data.</p>' +
    '<label class="f"><span>Firm name</span><input type="text" data-cloud="firm" data-fk="sufirm" value="' + esc(f.firm || "") + '"></label>' +
    '<label class="f" style="margin-top:8px"><span>Your name</span><input type="text" data-cloud="name" data-fk="suname" value="' + esc(f.name || "") + '"></label>' +
    '<label class="f" style="margin-top:8px"><span>Email</span><input type="email" data-cloud="email" data-fk="cloudemail" value="' + esc(f.email || "") + '" autocomplete="username"></label>' +
    '<label class="f" style="margin-top:8px"><span>Password (8 characters or more)</span><input type="password" data-cloud="password" data-fk="cloudpw" value="' + esc(f.password || "") + '" autocomplete="new-password"></label>' +
    '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="cloudSignUp"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Making the account\u2026" : "Create the account") + "</button></div>" +
    (st.error ? '<p class="bk-warn" style="margin-top:10px">' + esc(st.error) + "</p>" : "") +
    '<p class="note" style="margin-top:14px">Already have one? <button class="linkbtn" data-act="showSignIn">Sign in</button></p>' +
    "</div></div>";
}
function viewSignIn(){
  const c = Cloud.cfg(), st = Cloud.st;
  if (S.signUpOpen) return viewSignUp();
  return '<div class="signin"><div class="signin-box">' +
    '<h1>TDS Desk</h1>' +
    '<p class="note">' + esc(S.firm && S.firm.firmName ? S.firm.firmName : "Garg Shekhar & Company") + "</p>" +
    '<p class="note" style="margin:10px 0 14px">Sign in to see your firm\u2019s work. Nothing is shown before that.</p>' +
    '<label class="f"><span>Email</span><input type="email" data-cloud="email" data-fk="cloudemail" value="' + esc((S.cloudForm && S.cloudForm.email) || c.email || "") + '" autocomplete="username" autofocus></label>' +
    '<label class="f" style="margin-top:8px"><span>Password</span><input type="password" data-cloud="password" data-fk="cloudpw" value="' + esc((S.cloudForm && S.cloudForm.password) || "") + '" autocomplete="current-password"></label>' +
    '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="cloudSignIn"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Signing in\u2026" : "Sign in") + "</button></div>" +
    (st.error ? '<p class="bk-warn" style="margin-top:10px">' + esc(st.error) + "</p>" : "") +
    '<p class="note" style="margin-top:14px">Forgotten the password? Ask the person who runs your firm\u2019s account to make a new one.</p>' +
    '<p class="note" style="margin-top:10px">No internet on this computer? <button class="linkbtn" data-act="useOffline">Use it here without an account</button> \u2014 the work stays on this computer only.</p>' +
    (S.signupInfo && S.signupInfo.open !== false ? '<p class="note" style="margin-top:6px">New here? <button class="linkbtn" data-act="showSignUp">Create an account</button>' + (num(S.signupInfo.trial_credit) ? " \u00b7 starts with " + INR.format(num(S.signupInfo.trial_credit)) + " of credit" : "") + "</p>" : "") +
    "</div></div>";
}

// Always-visible bar at the bottom of the screen for the bill that is open
function actionBar(){
  if (S.view === "company" && S.tab === "invoices" && S.reviewTable && S.filter === "draft" && !drawerEntry()) return reviewBar();
  if (S.view === "company" && S.tab === "bank") return bankBar();
  if (S.view === "company" && S.tab === "sales") return salesBar();
  if (S.view !== "company" || S.tab !== "invoices") return "";
  const e = S.selected && D().entries[S.selected];
  if (!e || S.reading[e.id]) return "";
  const drafts = Object.values(D().entries).filter(o => o.status === "draft" && o.id !== e.id).sort(byDate);
  const nextBtn = drafts.length ? '<button class="btn" data-act="nextBill">Next bill →</button>' : "";
  let left = "", right = "";
  if (e.status === "draft"){
    const c = compute(e);
    const todo = [];
    if (e.uncertain && e.uncertain.length) todo.push('<button class="btn small" data-act="fieldsOk">Fields look right</button><span class="note">' + e.uncertain.length + " amber field" + (e.uncertain.length > 1 ? "s" : "") + "</span>");
    if (e.confirmType && !(c.party && c.party.natureDefault) && !c.skip) todo.push('<button class="btn small" data-act="confirmType">Confirm payment type: ' + esc(c.rule.label) + '</button>');
    if (c.dup && c.dup.strong) todo.push('<button class="btn small" data-act="notDup">It is a different bill</button>');
    if (c.gd.rcmSuggest) todo.push('<span class="tag warn" title="' + esc(catLabel(RCM_CATS, c.gd.rcmSuggest.cat)) + '">RCM?</span><button class="btn small" data-act="rcmApply">Apply</button><button class="btn small" data-act="rcmDismiss">No</button>');
    if (c.gd.blockSuggest) todo.push('<span class="tag warn" title="' + esc(catLabel(BLOCK_CATS, c.gd.blockSuggest.cat)) + '">Blocked credit?</span><button class="btn small" data-act="blockAccept">Block</button><button class="btn small" data-act="blockReject">Allow</button>');
    if (c.tdsWould > 0 && !c.skip) todo.push('<button class="btn small" data-act="skipTds" title="Approve this bill without a TDS line">Don\u2019t book TDS</button>');
    if (c.skip) todo.push('<span class="tag warn" title="' + esc(skipText(c.skip)) + '">TDS not booked</span><button class="btn small" data-act="bookTds">Book TDS ' + money0(c.tdsWould) + "</button>");
    const other = c.missing.filter(m => !/payment type|duplicate/.test(m));
    if (other.length) todo.push('<span class="missing">Fill in: ' + esc(other.join(", ")) + "</span>");
    const onlyTdsBits = todo.every(t => /skipTds|bookTds|TDS not booked|rcmApply|blockAccept/.test(t));
    left = todo.length && !onlyTdsBits ? "<b>To do:</b> " + todo.join(" ")
      : '<span class="tag ok">Ready to approve</span> <span class="note">' + (c.skip ? "No TDS booked (would be " + money0(c.tdsWould) + ")" : "TDS " + money(c.tds)) + " · " + esc(c.rule.label) + "</span> " + todo.join(" ");
    right = '<button class="btn" data-act="reject">No entry needed</button>' +
      '<button class="btn primary" data-act="approve"' + (c.missing.length ? ' disabled title="' + esc("Still needed: " + c.missing.join(", ")) + '"' : "") + ">Approve <kbd>Ctrl+A</kbd></button>" + nextBtn;
  } else if (e.status === "duplicate"){
    left = '<span class="tag warn">Held as duplicate</span> <span class="note">' + esc((e.dupOf && e.dupOf.msg) || "") + "</span>";
    right = '<button class="btn danger" data-act="delete">Delete this copy</button>' +
      (e.dupOf && e.dupOf.entryId && D().entries[e.dupOf.entryId] ? '<button class="btn" data-act="openOriginal">Open the earlier bill</button>' : "") +
      '<button class="btn" data-act="notDup">It is a different bill</button>' + nextBtn;
  } else if (e.status === "approved"){
    left = '<span class="tag ok">Approved</span> <span class="note">' + (e.exportedAt ? "Sent to Tally" : "Waiting in Send to Tally") + "</span>";
    right = (e.exportedAt ? "" : '<button class="btn" data-act="undo">Undo approval</button><button class="btn" data-act="goExport">Send to Tally</button>') + nextBtn;
  } else {
    left = '<span class="tag no">No entry</span>';
    right = '<button class="btn" data-act="restore">Move back to review</button>' + nextBtn;
  }
  return '<div class="actionbar"><div class="ab-left">' + left + '</div><div class="ab-right">' + right + "</div></div>";
}
function pf(label, key, val, type){ return '<label class="f"><span>' + label + '</span><input type="' + (type || "text") + '" data-p="' + key + '" data-fk="p:' + key + '" value="' + esc(val == null ? "" : val) + '"' + (type === "number" ? ' step="0.01"' : "") + "></label>"; }

function viewGst(e, c, ro, snap){
  const co = CO();
  if (ro){
    const s = snap || {};
    if (!s.rcm && !s.blocked) return "";
    return '<section><h3>GST</h3><p class="note" style="margin:0">' + (s.rcm ? "Reverse charge: " + esc(catLabel(RCM_CATS, s.rcm.cat)) + " @ " + s.rcm.rate + "%, tax " + money(s.rcm.tax) + ". " : "") +
      (s.blocked ? "GST credit blocked: " + esc(catLabel(BLOCK_CATS, s.blocked)) + "." : "") + "</p></section>";
  }
  const gd = c.gd, r = c.rcmTax;
  let h = '<section><h3>GST</h3><div class="gstgrid">';
  // reverse charge
  h += '<div class="gstbox"><label class="chk"><input type="checkbox" data-gst="rcm"' + (r ? " checked" : "") + "> <b>Reverse charge applies</b></label>";
  if (gd.rcmSuggest) h += '<div class="suggest">Suggested: ' + esc(catLabel(RCM_CATS, gd.rcmSuggest.cat)) + ' <span class="note">(' + esc(gd.rcmSuggest.why) + ')</span><div class="row" style="margin-top:6px"><button class="btn small" data-act="rcmApply">Apply reverse charge</button><button class="btn small" data-act="rcmDismiss">Not reverse charge</button></div></div>';
  if (r){
    h += '<div class="grid" style="margin-top:6px"><label class="f wide"><span>Category</span><select data-gst="rcmCat">' + RCM_CATS.map(x => '<option value="' + x.id + '"' + (x.id === e.rcm.cat ? " selected" : "") + ">" + esc(x.label) + "</option>").join("") + "</select></label>" +
      '<label class="f"><span>Rate %</span><input type="number" step="0.01" data-gst="rcmRate" value="' + esc(e.rcm.rate) + '"></label>' +
      '<label class="chk" style="align-self:end"><input type="checkbox" data-gst="rcmInter"' + (r.inter ? " checked" : "") + "> Inter-state (IGST)</label></div>" +
      '<p class="note" style="margin:6px 0 0">Tax payable under reverse charge: <b>' + money(r.tax) + "</b> (" + (r.inter ? "IGST " + money(r.igst) : "CGST " + money(r.cgst) + " + SGST " + money(r.sgst)) + ")" + (c.blocked ? ", with the input credit blocked" : ", and the same amount taken as input credit") + ". Check the rate against the current notification.</p>";
  }
  h += "</div>";
  // blocked credit
  const bcat = c.blocked ? gd.block.cat : (e.itcBlock && e.itcBlock.cat) || (gd.blockSuggest && gd.blockSuggest.cat) || BLOCK_CATS[0].id;
  h += '<div class="gstbox"><label class="chk"><input type="checkbox" data-gst="block"' + (c.blocked ? " checked" : "") + "> <b>GST credit is blocked (section 17(5))</b></label>";
  if (gd.blockSuggest) h += '<div class="suggest">Possibly blocked: ' + esc(catLabel(BLOCK_CATS, gd.blockSuggest.cat)) + '<div class="row" style="margin-top:6px"><button class="btn small" data-act="blockAccept">Accept: block credit</button><button class="btn small" data-act="blockReject">Reject: credit allowed</button></div></div>';
  if (c.blocked){
    h += '<label class="f" style="margin-top:6px"><span>Category</span><select data-gst="blockCat">' + BLOCK_CATS.map(x => '<option value="' + x.id + '"' + (x.id === bcat ? " selected" : "") + ">" + esc(x.label) + " — " + esc(x.sec) + "</option>").join("") + "</select></label>" +
      '<p class="note" style="margin:6px 0 0">' + (gd.block.from === "client" ? "Blocked by this client's setting. Untick to claim credit on this bill. " : "") + "GST of " + money(c.gstTotal + (r ? r.tax : 0)) + " is added to the expense instead of input credit.</p>";
  }
  h += "</div></div></section>";
  return h;
}

/* ---------- Client: settings ---------- */
function viewCompanySettings(){
  const c = CO();
  const cf = (label, key, val) => '<label class="f"><span>' + label + '</span><input type="text" data-c="' + key + '" data-fk="c:' + key + '" value="' + esc(val) + '"></label>';
  const cc = (key, val, label) => '<label class="chk"><input type="checkbox" data-c="' + key + '"' + (val ? " checked" : "") + "> " + esc(label) + "</label>";
  let h = '<div class="stack"><div class="pane" style="margin-top:0"><h2>' + esc(c.name) + '</h2><p class="note" style="margin:0 0 12px">These settings apply to this client only. Ledger names must match this company in Tally exactly.</p><div class="grid">' +
    cf("Client name", "name", c.name) + cf("GSTIN", "gstin", c.gstin) + cf("PAN", "pan", c.pan) + cf("Company name in Tally", "tallyName", c.tallyName) +
    (Bridge.up() && Bridge.st.open.length ? '<label class="f"><span>Or pick the company open in Tally</span><select data-picktally><option value="">\u2014</option>' + Bridge.st.open.map(o => '<option' + (o.name === c.tallyName ? " selected" : "") + ">" + esc(o.name) + "</option>").join("") + "</select></label>" : "") +
    '<label class="f"><span>Voucher type</span><select data-c="voucherType">' + ["Journal", "Purchase"].map(v => "<option" + (c.voucherType === v ? " selected" : "") + ">" + v + "</option>").join("") + "</select></label>" +
    '<div class="f wide vnum"><span>Voucher numbering</span>' + (c.vchNumbering === "tally"
      ? '<div class="note"><span class="tag ok">Automatic in Tally</span> Tally gives every entry its own next number' + (c.vchAutoAt ? " (set " + fmtDate(String(c.vchAutoAt).slice(0, 10)) + ")" : "") + '. TDS Desk sends no voucher numbers. <button class="linkbtn" data-act="vchUseBillNo">Use supplier bill numbers instead</button></div>'
      : '<div class="note">TDS Desk sends the supplier\u2019s bill number as the voucher number; a number already in Tally is retried with the supplier\u2019s initials.</div>' +
        '<div class="row" style="gap:8px"><button class="btn small" data-act="vchAuto"' + (Bridge.on() && Bridge.up() ? "" : " disabled title=\"Needs the Tally Bridge and Tally open\"") + '>Set automatic numbering in Tally</button>' +
        '<button class="btn small" data-act="vchTallyDone">It is set in Tally already: use Tally\u2019s automatic numbers</button></div>') + "</div>" +
    cf("Input CGST ledger", "gst.cgst", c.gst.cgst) + cf("Input SGST ledger", "gst.sgst", c.gst.sgst) + cf("Input IGST ledger", "gst.igst", c.gst.igst) + cf("Round off ledger", "roundOff", c.roundOff) +
    '</div><div class="stack" style="margin-top:14px;gap:8px">' +
    cc("bookTds", c.bookTds !== false, "Book TDS in purchase entries. Untick if this client books TDS separately (for example at the time of payment); TDS is still worked out and shown.") +
    cc("turnover10cr", c.turnover10cr, "Turnover last year was above ₹10 crore (needed for TDS on purchase of goods)") +
    '<label class="chk"><input type="checkbox" data-c="mustDeduct"' + (c.mustDeduct === false ? "" : " checked") + "> This client has to deduct TDS</label>" +
    '<p class="note" style="margin:-4px 0 8px 24px">An individual or HUF deducts only if last year\u2019s business turnover was above \u20b91 crore, or professional receipts above \u20b950 lakh. Companies, firms and LLPs always deduct. Untick this and no TDS is worked out for any bill of this client.</p>' +
    cc("createOptional", c.createOptional, "Post purchase bills and sales invoices into Tally as Optional vouchers (Tally hides these from the Day Book until they are made regular with Ctrl+L)") +
    cc("billwise", c.billwise, "Add the invoice number as a bill-wise reference on the party") + "</div></div>";
  h += '<div class="pane"><h2>GST: reverse charge and blocked credit</h2>' +
    '<p class="note" style="margin:0 0 10px">Reverse charge entries use these ledgers: the input side is debited (unless the credit is blocked) and the payable side is credited.</p><div class="grid">' +
    Object.keys(RCM_LEDGER_DEFAULTS).map(k => cf({rcmCgstIn:"RCM input CGST", rcmSgstIn:"RCM input SGST", rcmIgstIn:"RCM input IGST", rcmCgstOut:"RCM payable CGST", rcmSgstOut:"RCM payable SGST", rcmIgstOut:"RCM payable IGST"}[k], "gst." + k, rcmLedger(c, k))).join("") + "</div>" +
    '<h3 style="margin-top:16px">Blocked credit for this client (section 17(5))</h3><p class="note" style="margin:-6px 0 10px">Flag: suggest on matching bills; you accept or reject. Always blocked: apply automatically (you can still untick it on a bill). Credit allowed: never flag, for example a car dealer for motor vehicles.</p>' +
    '<div class="tblwrap"><table class="data"><thead><tr><th>Category</th><th>Section</th><th>For this client</th></tr></thead><tbody>' +
    BLOCK_CATS.map(b => "<tr><td>" + esc(b.label) + "</td><td>" + esc(b.sec) + '</td><td><select data-gstrule="' + b.id + '">' +
      [["flag","Flag for review"],["block","Always blocked"],["allow","Credit allowed"]].map(([v, t]) => '<option value="' + v + '"' + (blockRule(c, b.id) === v ? " selected" : "") + ">" + t + "</option>").join("") + "</select></td></tr>").join("") +
    "</tbody></table></div></div>";
  h += '<div class="pane"><h2>Ledgers by payment type</h2><div class="tblwrap"><table class="data"><thead><tr><th>Payment type</th><th>TDS ledger in Tally</th><th>Default expense ledger</th></tr></thead><tbody>' +
    rules().map(r => "<tr><td>" + esc(r.label) + "</td><td>" + (r.basis === "never" ? "—" : '<input type="text" data-tdsled="' + r.id + '" value="' + esc(c.tdsLedgers[r.id] || "") + '" aria-label="TDS ledger">') +
      '</td><td><input type="text" data-expled="' + r.id + '" value="' + esc(c.expenseLedgers[r.id] || "") + '" aria-label="Expense ledger"></td></tr>').join("") + "</tbody></table></div></div>";
  h += '<div class="pane"><h2>Remove this client</h2><p class="note" style="margin:0 0 10px">Deletes this client with all its invoices and deductees from the desk. Nothing in Tally is touched.</p>' +
    '<button class="btn danger" data-act="delCo">' + (S.arm === "delCo" ? "Click again to delete " + esc(c.name) : "Delete client") + "</button></div></div>";
  return h;
}

/* ---------- Client: send to Tally ---------- */
function viewExport(){
  const co = CO(), v = Object.values(D().entries);
  const waiting = v.filter(e => e.status === "approved" && !e.exportedAt).sort(byDate);
  const sent = v.filter(e => e.exportedAt).length;
  const ledgers = new Set();
  waiting.forEach(e => (e.snapshot ? e.snapshot.lines : []).forEach(l => ledgers.add(l.ledger)));
  const totTds = waiting.reduce((a, e) => a + (e.snapshot ? e.snapshot.tds : 0), 0);
  let h = '<div class="two"><div class="pane" style="margin-top:0"><h2>' + waiting.length + " approved entr" + (waiting.length === 1 ? "y" : "ies") + " waiting</h2>" +
    '<p class="note" style="margin:0 0 12px">TDS in these entries: ' + money(totTds) + ". " + sent + " sent earlier.</p>";
  if (waiting.length){
    h += '<div class="tblwrap"><table class="data"><thead><tr><th>Date</th><th>Supplier</th><th>Bill no.</th><th class="n">Amount</th><th>Section</th><th class="n">TDS</th><th></th></tr></thead><tbody>' +
      waiting.map(e => "<tr><td>" + fmtDate(e.x.invoiceDate) + "</td><td>" + esc(e.x.vendorName) + (e.noteKind ? ' <span class="tag">' + (e.noteKind === "credit" ? "credit note" : "debit note") + "</span>" : "") + "</td><td>" + esc(e.x.invoiceNo || "") + '</td><td class="n">' + INR.format(num(e.x.total)) + "</td><td>" + esc(e.snapshot.ref) + '</td><td class="n">' + money0(e.snapshot.tds) + "</td>" +
        '<td class="ac" style="white-space:nowrap"><button class="btn small" data-billback="' + e.id + '">Back to review</button> <button class="btn small danger" data-billdel="' + e.id + '" title="Delete this bill">Delete</button></td></tr>').join("") + "</tbody></table></div>" +
      (waiting.length > 1 ? '<div class="row" style="margin-top:8px"><button class="btn small" data-act="billBackAll">Send all ' + waiting.length + " back to review</button></div>" : "");
  }
  const bp = S.billPost || {};
  const ctx = !!(S.bank && S.bank.cid === co.id && !S.bank.loading && hasLedgerList());
  if (ctx) canonicalizeBills(waiting);
  const issues = ctx ? billLedgerIssues(waiting) : [];
  if (issues.length){
    const opts = (sel) => '<option value="">\u2014 Choose the Tally ledger \u2014</option>' + (S.bank.ledgers.list || []).map(l => '<option' + (l.name === sel ? " selected" : "") + ">" + esc(l.name) + "</option>").join("");
    h += '<div class="bk-alert bad" style="margin:10px 0 0"><b>' + issues.length + " ledger" + (issues.length > 1 ? "s are" : " is") + ' not in Tally.</b> Bills using them are not posted until you choose the right Tally ledger (or create it). Fixes are saved for future bills.' +
      '<table class="data" style="margin-top:8px"><thead><tr><th>Name used</th><th>Used as</th><th class="n">Bills</th><th>Tally ledger</th><th></th></tr></thead><tbody>' +
      issues.map((x, i) => { const sug = suggestLedgers(x.name, x.role, 1)[0] || "";
        return "<tr><td><b>" + esc(x.name) + "</b></td><td>" + esc({party: "Supplier", expense: "Expense", gst: "Input GST", tds: "TDS payable", roundoff: "Round off", "rcm-in": "RCM input", "rcm-out": "RCM payable"}[x.role] || x.role) + '</td><td class="n">' + x.bills + '</td><td><select id="bfx' + i + '">' + opts(sug) + "</select></td>" +
          '<td style="white-space:nowrap"><button class="btn small primary" data-billfixsel="bfx' + i + '" data-role="' + esc(x.role) + '" data-old="' + esc(x.name) + '">Replace</button> <button class="linkbtn" data-billcreate="' + esc(x.role) + '" data-old="' + esc(x.name) + '">Create in Tally</button></td></tr>'; }).join("") + "</tbody></table></div>";
  }
  if (bp.busy) h += '<p class="bk-alert" style="margin:10px 0 0">' + esc(bp.busy) + "</p>";
  if (bp.error) h += '<p class="bk-alert bad" style="margin:10px 0 0">' + esc(bp.error) + "</p>";
  const unconf = waiting.filter(e => e.postUnconfirmed);
  if (unconf.length && !bp.done) h += '<div class="bk-alert bad" style="margin:10px 0 0"><b>' + unconf.length + " bill" + (unconf.length > 1 ? "s were" : " was") + " sent to Tally earlier but not confirmed there:</b> " + unconf.map(e => esc(e.x.invoiceNo) + " \u00b7 " + esc(e.x.vendorName)).join("; ") +
    '. Check Tally first. <button class="btn small" data-act="billCheckWaiting">Check these in Tally</button></div>';
  if (bp.done) h += '<div class="bk-alert' + (bp.unverified || (bp.failed && bp.failed.length) ? " bad" : "") + '" style="margin:10px 0 0">' + (bp.ok || 0) + " posted into <b>" + esc(bp.company || "") + "</b> and confirmed there" + (bp.dup ? " \u00b7 " + bp.dup + " already in Tally (not posted again)" : "") + (bp.failed && bp.failed.length - (bp.unverified || 0) > 0 ? " \u00b7 " + (bp.failed.length - (bp.unverified || 0)) + " not posted" : "") +
    (bp.optional ? '<div style="margin-top:4px"><b>' + bp.optional + " went in as Optional vouchers.</b> Tally does not show these in the Day Book. See them in TallyPrime: Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers (or in the Day Book: F12 / Ctrl+B \u2192 show Optional vouchers). Open one and press Ctrl+L to make it a regular entry. To post regular entries directly, untick \u201cCreate entries as Optional vouchers\u201d in Company settings.</div>" : "") +
    (bp.unverified ? '<div style="margin-top:4px"><b>' + bp.unverified + " not confirmed:</b> Tally replied \u2018created\u2019 but the entry could not be found afterwards, so " + (bp.unverified > 1 ? "they stay" : "it stays") + " in the waiting list. Look in Tally; if it is not there, post again. Use <b>Settings \u2192 Tally Bridge \u2192 Test reading entries</b> and send the result if this repeats.</div>" : "") + "</div>";
  if (bp.done && bp.failed && bp.failed.length) h += '<div class="bk-alert bad" style="margin:10px 0 0"><b>' + bp.failed.length + " not posted.</b> They are back in <b>To review</b> with Tally\u2019s reason on each.<ul>" +
    bp.failed.map(f => "<li>" + esc(f.no) + " \u00b7 " + esc(f.party) + ": " + esc(f.msg) + "</li>").join("") + "</ul>" +
    '<div class="row" style="gap:8px;margin-top:6px"><button class="btn small primary" data-act="billRetry">Retry these ' + bp.failed.length + '</button><button class="btn small" data-step="review">Open them in To review</button>' +
    (/already\s+exists/i.test(bp.failed.map(f => f.msg).join(" ")) ? '<span class="note">Tally already has these voucher numbers. In Tally, set the Purchase voucher type\u2019s numbering to Automatic, or retry: numbers get the supplier\u2019s initials.</span>' : "") + "</div></div>";
  const canPost = Bridge.on() && Bridge.up();
  const bc = S.billCheck || {};
  const undoable = v.filter(e => e.exportedAt && e.tally && e.tally.guid);
  if (canPost && undoable.length) h += '<div class="row" style="margin-top:10px"><button class="btn small" data-act="billUnpost">Take an entry back out of Tally</button><span class="note">' + undoable.length + " posted bills can be removed from Tally from here.</span></div>";
  if (canPost && sent) h += '<div class="row" style="margin-top:10px"><button class="btn small" data-act="billCheck"' + (bc.busy ? " disabled" : "") + ">" + (bc.busy ? "Checking Tally\u2026" : "Check sent bills in Tally") + '</button><span class="note">Confirms that every bill marked as sent is really in Tally.</span></div>';
  if (bc.error) h += '<p class="bk-alert bad" style="margin:8px 0 0">' + esc(bc.error) + "</p>";
  if (bc.at){
    const miss = (bc.missing || []).map(id => D().entries[id]).filter(e => e && e.exportedAt);
    h += '<div class="bk-alert' + (miss.length ? " bad" : "") + '" style="margin:8px 0 0"><b>' + bc.checked + " sent bills checked in " + esc(bc.company) + ":</b> " + bc.found + " found" + (bc.optional ? " (" + bc.optional + " as Optional vouchers \u2014 Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers)" : "") +
      (miss.length ? '<br><b>' + miss.length + " not in Tally:</b><ul>" + miss.map(e => "<li>" + esc(e.x.invoiceNo) + " \u00b7 " + esc(e.x.vendorName) + " \u00b7 " + fmtDate(e.x.invoiceDate) + "</li>").join("") + '</ul><button class="btn small primary" data-act="billRepost">Mark these ' + miss.length + " as not sent (to post them again)</button>" : "") + "</div>";
  }
  h += '<div class="row" style="margin-top:14px">' + (canPost ? '<button class="btn primary" data-act="billPost"' + (waiting.length ? "" : " disabled") + ">Post " + waiting.length + " to Tally</button>" : "") +
    '<button class="btn' + (canPost ? "" : " primary") + '" data-act="xml"' + (waiting.length ? "" : " disabled") + ">Download Tally file</button>" +
    '<button class="btn" data-act="csv">Download TDS register (Excel CSV)</button></div>' +
    '<label class="chk" style="margin-top:12px"><input type="checkbox" id="markSent" checked> Mark these as sent after download</label>' +
    '<div style="margin-top:16px"><button class="btn small" data-act="clearSent">' + (S.arm === "clearSent" ? "Click again to clear" : "Clear sent invoices older than 90 days") + '</button><div class="note" style="margin-top:4px">Frees space. Download the register first; deductee year totals are kept.</div></div></div>';
  if (bridgeLive(co)) h += '<div class="pane" style="margin-top:0"><h2>Straight into Tally</h2><p class="note">' + esc(Bridge.openFor(co).name) + " is open in Tally. <b>Post to Tally</b> checks for bills already booked (same bill number and party), then creates the rest" + (co.createOptional ? " as Optional vouchers" : "") + ". Any bill Tally refuses is listed with Tally\u2019s reason.</p></div>";
  else h += '<div class="pane" style="margin-top:0"><h2>Import into Tally</h2><ol class="steps">' +
    "<li>Download the Tally file and unzip it to get the .xml file.</li>" +
    "<li>Open <b>" + esc(co.tallyName || co.name) + "</b> in TallyPrime.</li>" +
    "<li>Check these ledgers exist in it with the same names" + (ledgers.size ? ": " + Array.from(ledgers).filter(Boolean).map(esc).join(", ") : "") + ".</li>" +
    "<li>Go to Gateway of Tally, then Import, then Transactions, and choose the .xml file.</li>" +
    "<li>" + (co.createOptional ? "The vouchers arrive as Optional. Review them in Day Book (include optional vouchers), then regularise them." : "The vouchers post straight to the books. Review them in Day Book.") + "</li></ol>" +
    '<p class="note" style="margin:12px 0 0">The file names this company, so Tally will not import it into a different one. These are plain accounting entries; Tally\'s Form 140 (old 26Q) screen may list them under exceptions until the nature of payment is set on the TDS ledger.</p></div></div>';
  return h;
}

/* ---------- Company switcher (F3) ---------- */
function switcherList(){
  const q = (S.switcher.q || "").trim().toLowerCase();
  const rec = recentIds();
  let list = sortedCompanies();
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || (c.gstin || "").toLowerCase().includes(q) || (c.tallyName || "").toLowerCase().includes(q));
  else list.sort((a, b) => { const ia = rec.indexOf(a.id), ib = rec.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name); });
  return list;
}
function renderSwitcher(){
  const m = document.getElementById("modal");
  if (!S.switcher){ m.innerHTML = ""; m.classList.add("hidden"); return; }
  m.classList.remove("hidden");
  const list = switcherList();
  S.switcher.idx = Math.max(0, Math.min(S.switcher.idx, list.length - 1));
  const rec = recentIds();
  if (!m.querySelector(".sw")){
    m.innerHTML = '<div class="sw" role="dialog" aria-modal="true" aria-label="Select company"><div class="swhead"><b>Select company</b><span class="note">↑↓ to move, Enter to open, Esc to close</span></div>' +
      '<input type="text" id="swq" placeholder="Type a client name or GSTIN" autocomplete="off"><ul class="swlist" id="swlist" role="listbox"></ul>' +
      '<div class="swfoot"><button class="btn small" data-act="swHome">All clients</button><button class="btn small" data-act="swAdd">Add client</button></div></div>';
    const inp = m.querySelector("#swq"); inp.value = S.switcher.q || ""; inp.focus();
  }
  m.querySelector("#swlist").innerHTML = list.length ? list.map((c, i) => {
    const st = c.stats || {};
    return '<li role="option" aria-selected="' + (i === S.switcher.idx) + '" data-open="' + c.id + '"><span><b>' + esc(c.name) + "</b>" + (c.id === S.coId ? ' <span class="tag stamp">Open</span>' : "") +
      (!S.switcher.q && rec.indexOf(c.id) >= 0 && rec.indexOf(c.id) < 5 ? ' <span class="note">recent</span>' : "") + '<br><span class="note">' + esc(c.gstin || "No GSTIN") + "</span></span>" +
      "<span>" + (st.drafts ? '<span class="tag warn">' + st.drafts + " to review</span>" : "") + "</span></li>";
  }).join("") : '<li class="note">No client matches.</li>';
  const sel = m.querySelector('[aria-selected="true"]'); if (sel && sel.scrollIntoView) sel.scrollIntoView({block:"nearest"});
}
function openSwitcher(){ if (!Object.keys(S.companies).length){ goHome(); S.addingCo = true; render(); return; } S.switcher = {q:"", idx:0}; renderSwitcher(); }
function closeSwitcher(){ S.switcher = null; renderSwitcher(); }

async function openCompany(cid){
  loadDocq().catch(() => {});
  if (!S.companies[cid]) return;
  closeSwitcher();
  const changed = S.coId !== cid;
  S.coId = cid; S.view = "company"; S.arm = null;
  if (changed){ S.tab = "dash"; S.filter = "draft"; S.selected = null; S.partySel = null; S.step = null; }
  lsSet("tdsdesk:last", cid);
  const rec = recentIds().filter(x => x !== cid); rec.unshift(cid); lsSet("tdsdesk:recent", JSON.stringify(rec.slice(0, 10)));
  if (!D(cid).loaded){
    S.loadingCo = true; render();
    try { await Store.loadCompany(cid); }
    catch (e){ S.loadingCo = false; toast("This client could not be opened. Check your connection and try again."); goHome(); return; }
    S.loadingCo = false;
  }
  pruneStaleHashes(cid);
  refreshStats(cid);
  render(); window.scrollTo(0, 0);
}
function goHome(){ closeSwitcher(); S.view = "home"; S.arm = null; render(); }

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */
const timers = {};
function later(key, fn, ms){ clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); }
function curEntry(){ return S.view === "company" && S.selected ? D().entries[S.selected] : null; }

document.addEventListener("click", ev => {
  const t = ev.target.closest("button,[data-select],[data-open],#drop,#dropAuto,#modal,#bankDrop,#salesDrop");
  if (!t) return;
  if (t.dataset.settab !== undefined){ S.settingsTab = t.dataset.settab || null; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.backup){
    Cloud.rpc("backup_data", {p_id: num(t.dataset.backup)}).then(d => {
      saveFile("tds-desk-backup-" + new Date().toISOString().slice(0, 10) + ".json", new Blob([JSON.stringify(d, null, 1)], {type: "application/json"}));
      toast("Downloaded. Keep it somewhere outside this system.");
    }, e => toast(e.message));
    return;
  }
  if (t.dataset.docqread){ readDocq([t.dataset.docqread], S.view === "company" ? S.coId : ""); return; }
  if (t.dataset.docqforce){ const id = t.dataset.docqforce; S.docqLocal[id] = {}; readDocq([id], S.view === "company" ? S.coId : "", {force: true}); return; }
  if (t.dataset.openentry){
    const e0 = S.data[t.dataset.openco] && S.data[t.dataset.openco].entries[t.dataset.openentry];
    if (e0){ if (S.coId !== t.dataset.openco) openCompany(t.dataset.openco); S.tab = "invoices"; S.reviewTable = false; S.filter = e0.status; S.selected = e0.id; render(); window.scrollTo(0, 0); }
    return;
  }
  if (t.dataset.docqaside){ setAsideDocq(t.dataset.docqaside); return; }
  if (t.dataset.dropoff){
    askConfirm({title: "Switch this key off?", ok: "Switch it off", body: '<p class="note">Anything using this key will no longer be able to send files in.</p>'}).then(a => {
      if (!a) return;
      Cloud.rpc("revoke_drop_key", {p_id: t.dataset.dropoff}).then(() => Cloud.rpc("my_drop_keys")).then(k => { S.dropKeys = [].concat(k || []); render(); }, e => toast(e.message));
    });
    return;
  }
  if (t.dataset.useexp){
    const e0 = curEntry();
    if (e0 && e0.status === "draft"){ e0.expenseLedger = t.dataset.useexp; e0.expenseUserSet = true; e0.expenseFrom = ""; Store.saveEntry(S.coId, e0); render(); }
    return;
  }
  if (t.dataset.person){
    const email = t.dataset.email, what = t.dataset.person;
    if (what === "reset") Cloud.fn("admin", {action: "reset_password", email}).then(r => { S.newPerson = {email: r.email, password: r.password}; toast("New password made."); render(); }, e => toast(e.message));
    else Cloud.fn("admin", {action: "set_person", email, active: what === "on"}).then(() => { toast(what === "on" ? "Switched on." : "Switched off."); loadAccount(); }, e => toast(e.message));
    return;
  }
  if (t.dataset.adminact){
    const act = t.dataset.adminact, firm = t.dataset.firm, g = id => (document.getElementById(id) || {}).value || "";
    const after = msg => { toast(msg); loadAdminOverview(); loadAccount(true); };
    if (act === "credit"){
      askConfirm({title: "Add credit to " + (t.dataset.name || "this firm"), ok: "Add credit",
        body: '<div class="bk-form two"><label><span>Amount</span><input type="number" id="crAmt" value="5000" step="500"></label><label><span>Note (payment reference)</span><input type="text" id="crNote"></label></div>',
        read: () => ({amount: num((document.getElementById("crAmt") || {}).value), note: (document.getElementById("crNote") || {}).value || ""})
      }).then(a => { if (!a) return; Cloud.rpc("admin_credit", {p_firm: firm, p_amount: a.data.amount, p_note: a.data.note}).then(r => after("Credit added. Balance: " + INR.format(num(r.balance))), e => toast(e.message)); });
      return;
    }
    if (act === "prices"){ S.adminPrices = firm; render(); return; }
    if (act === "closePrices"){ S.adminPrices = null; render(); return; }
    if (act === "savePrices"){
      const f = ((S.adminData || {}).firms || []).find(x => x.id === firm) || {};
      const jobs = (f.modules || []).map(m => {
        const v = (document.getElementById("pr_" + m.code) || {}).value;
        const on = !!(document.getElementById("en_" + m.code) || {}).checked;
        return Cloud.rpc("admin_set_module", {p_firm: firm, p_code: m.code, p_enabled: on, p_price: v === "" ? null : num(v)});
      });
      Promise.all(jobs).then(() => { S.adminPrices = null; after("Prices saved."); }, e => toast(e.message));
      return;
    }
    if (act === "on" || act === "off"){ Cloud.rpc("admin_set_firm", {p_firm: firm, p_active: act === "on"}).then(() => after(act === "on" ? "Switched on." : "Switched off."), e => toast(e.message)); return; }
    if (act === "createFirm"){
      const name = g("nfName").trim(), email = g("nfEmail").trim();
      if (!name || !email){ toast("The firm name and the owner's email are needed."); return; }
      Cloud.fn("admin", {action: "create_firm", name, email, owner_name: g("nfOwner"), plan_id: g("nfPlan"), credit: num(g("nfCredit"))})
        .then(r => { S.newFirm = {email: r.email, password: r.password}; after("Firm created."); }, e => toast(e.message));
      return;
    }
    if (act === "editPlan"){ S.planEdit = t.dataset.plan; render(); return; }
    if (act === "newPlan"){ S.planEdit = "new"; render(); return; }
    if (act === "closePlan"){ S.planEdit = null; render(); return; }
    if (act === "savePlan"){
      const mods = ((S.adminData || {}).modules || []).filter(m => m.billing !== "free");
      const includes = {};
      mods.forEach(m => {
        if ((document.getElementById("inc_" + m.code) || {}).checked){
          const cap = (document.getElementById("cap_" + m.code) || {}).value;
          includes[m.code] = cap === "" ? {cap: null} : {cap: num(cap), price_after: m.price};
        }
      });
      Cloud.rpc("admin_save_plan", {p_id: t.dataset.plan && t.dataset.plan !== "new" ? t.dataset.plan : null, p_name: g("plName"), p_monthly: num(g("plFee")), p_includes: includes, p_note: g("plNote")})
        .then(() => { S.planEdit = null; after("Plan saved."); }, e => toast(e.message));
      return;
    }
    if (act === "runMonthly"){ Cloud.rpc("run_monthly", {}).then(r => after(r.charged + " firms charged" + (r.short_of_credit ? ", " + r.short_of_credit + " had too little credit" : "") + "."), e => toast(e.message)); return; }
    if (act === "saveSignup"){
      Cloud.rpc("admin_set_setting", {p_name: "signup", p_value: {open: !!(document.getElementById("suOpen") || {}).checked, trial_credit: num(g("suCredit")), plan: g("suPlan")}})
        .then(() => after("Saved."), e => toast(e.message));
      return;
    }
    if (act === "saveSecret"){
      const k = t.dataset.name, v = (document.getElementById("sec_" + k) || {}).value || "";
      if (!v.trim()){ toast("Paste the key first."); return; }
      Cloud.rpc("admin_set_secret", {p_name: k, p_value: v.trim()}).then(() => { const el = document.getElementById("sec_" + k); if (el) el.value = ""; after("Key saved. It cannot be read back."); }, e => toast(e.message));
      return;
    }
    return;
  }
  if (t.dataset.adminplan){ return; }
  if (t.closest && t.closest("[data-colf]")){ const bt = t.closest("[data-colf]"), k = bt.dataset.colf, tb = bt.dataset.colt; S.colPop = S.colPop && S.colPop.k === k && S.colPop.t === tb ? null : {t: tb, k, justOpened: true}; render(); return; }
  if (t.closest && t.closest("[data-cpclose]")){ S.colPop = null; render(); return; }
  if (t.closest && t.closest("[data-cpapply]")){ colPopApply(false); return; }
  if (t.closest && t.closest("[data-cpclear]")){ colPopApply(true, S.colAuto); return; }
  if (t.dataset.cpquick){ const [a2, b2] = quickRange(t.dataset.cpquick), pop = document.getElementById("colpop"); if (pop){ pop.querySelector('[data-pf="from"]').value = a2; pop.querySelector('[data-pf="to"]').value = b2; } colPopApply(false, false); return; }   // a quick pick is a whole choice: close
  if (t.dataset.chipx){ S.colPop = {t: t.dataset.colt, k: t.dataset.chipx}; colPopApply(true); return; }
  if (t.dataset.chipall){ if (t.dataset.chipall === "bank"){ const b = B(); b.from = ""; b.to = ""; b.f = {}; b.sel.clear(); } else if (t.dataset.chipall === "sales"){ const sl = SL(); if (sl){ sl.f = {}; sl.sel.clear(); } } else if (t.dataset.chipall === "txn"){ S.txnF = S.txnF || {}; S.txnF[txnTab()] = {}; S.txnQ = ""; S.txnStatus = ""; } else { S.revF = {}; S.revSel = new Set(); } S.colPop = null; render(); return; }
  if (t.dataset.billback){ const e = D().entries[t.dataset.billback]; if (e){ const keep = S.tab; undoApproval(e); S.tab = keep; render(); } return; }
  if (t.dataset.billdel){
    const e = D().entries[t.dataset.billdel];
    if (!e) return;
    if (e.exportedAt){ toast("This bill is in Tally. Take it back from Tally first (Posted \u2192 Take it back), then delete it."); return; }
    askConfirm({title: "Delete this bill?", ok: "Delete", body: '<p class="note">' + esc(e.x.vendorName || e.fileName || "") + (e.x.invoiceNo ? " \u00b7 " + esc(e.x.invoiceNo) : "") + ". The file can be uploaded again later.</p>"}).then(ok => {
      if (!ok) return;
      if (e.status === "approved") unapply(e, S.coId);
      if (S.revSel) S.revSel.delete(e.id);
      if (S.drawerOpen && S.selected === e.id) S.drawerOpen = false;
      removeEntry(e); refreshStats(S.coId); toast("Deleted."); render();
    });
    return;
  }
  if (t.dataset.reread){ const e0 = D().entries[t.dataset.rid]; if (e0) rereadEntry(e0, t.dataset.reread === "free" ? null : t.dataset.reread); return; }
  if (t.dataset.revopen){ S.selected = t.dataset.revopen; S.drawerOpen = true; render(); return; }
  if (t.dataset.revapprove){ const e0 = D().entries[t.dataset.revapprove]; if (e0){ approve(e0); refreshStats(S.coId); toast("Approved."); render(); } return; }
  if (t.hasAttribute && (t.hasAttribute("data-revsel") || t.hasAttribute("data-revall"))) return;
  if (t.dataset.billfixsel){
    const sel = document.getElementById(t.dataset.billfixsel), to = sel && sel.value;
    if (!to){ toast("Choose the Tally ledger first."); return; }
    const n = replaceLedgerInWaiting(S.coId, t.dataset.old, to, t.dataset.role);
    toast("\u201c" + to + "\u201d used in " + n + " bill" + (n === 1 ? "" : "s") + " and saved for future bills.");
    refreshStats(S.coId); render();
    return;
  }
  if (t.dataset.billfix !== undefined || t.dataset.billcreate !== undefined){
    const cid = S.coId, role = t.dataset.billfix || t.dataset.billcreate, old = t.dataset.old;
    const apply = to => {
      const e0 = curEntry();
      if (e0 && !e0.snapshot){
        if (role === "party") e0.partyLedger = to;
        else if (role === "expense") e0.expenseLedger = to;
        Store.saveEntry(cid, e0);
      }
      const n = replaceLedgerInWaiting(cid, old, to, role);
      toast("\u201c" + to + "\u201d used" + (n > 1 ? " in " + n + " bills" : "") + (["gst", "tds", "roundoff", "rcm-in", "rcm-out"].includes(role) ? ", and saved in Company settings" : "") + ".");
      refreshStats(cid); render();
    };
    if (t.dataset.billfix !== undefined) apply(t.dataset.new);
    else openCreateLedger(old, null, null, {group: role === "party" ? "Sundry Creditors" : role === "expense" ? "Indirect Expenses" : role === "roundoff" ? "Indirect Expenses" : "Duties & Taxes", onCreated: name => apply(name)});
    return;
  }
  if (t.dataset.bridgepin !== undefined){
    const port = num(t.dataset.bridgepin);
    Bridge.setCfg({port: port || 0}); Bridge.lastOpenKey = null;
    if (S.bank){ S.bank.syncedAt = {}; S.bank.ledgers.importedAt = ""; }
    Bridge.refresh().then(() => { toast(port ? "TDS Desk now uses only the Tally on port " + port + "." : "TDS Desk picks your Tally automatically."); bridgeTick(false); render(); });
    return;
  }
  if (S.view === "company" && (S.tab === "bank" || (S.tab === "export" && S.bank && S.bank.cid === S.coId)) && bankClick(t)) return;   // bank buttons also work on the Post step
  if (S.view === "company" && S.tab === "sales" && salesClick(t)) return;
  if (t.id === "modal"){ if (ev.target.id === "modal") closeSwitcher(); return; }
  if (t.dataset.open){ openCompany(t.dataset.open); return; }
  if (t.dataset.bookstab){ S.booksTab = t.dataset.bookstab; render(); return; }
  if (t.dataset.gstpart){ S.gstPart = t.dataset.gstpart; render(); return; }
  if (t.dataset.itctcat !== undefined){ S.itctCat = S.itctCat === t.dataset.itctcat ? "" : t.dataset.itctcat; render(); return; }
  if (t.dataset.inregchip !== undefined){ S.inregF = S.inregF === t.dataset.inregchip ? "" : t.dataset.inregchip; render(); return; }
  if (t.dataset.tdspart){ S.tdsPart = t.dataset.tdspart; render(); return; }
  if (t.dataset.tdsnav){ S.tdsView = t.dataset.tdsnav; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.tdsgo){
    const [fy, q, form] = t.dataset.tdsgo.split("|");
    S.tdsFy = fy;
    if (q){ S.tdsQ = q; S.tdsForm = form || "26Q"; S.tdsView = "return"; S.tdsTab = ""; S.tdsOpen = ""; S.chOpen = ""; }
    else S.tdsView = "year";
    render(); window.scrollTo(0, 0); return;
  }
  if (t.dataset.tdstab){ S.tdsTab = t.dataset.tdstab; render(); return; }
  if (t.dataset.tdsfclear){ S.tdsFl = Object.assign({}, S.tdsFl, {[t.dataset.tdsfclear]: {}}); render(); return; }
  if (t.dataset.tdssort){
    const [tab, k] = t.dataset.tdssort.split("|"), cur = (S.tdsSort || {})[tab] || {};
    S.tdsSort = Object.assign({}, S.tdsSort, {[tab]: {k, d: cur.k === k ? -(cur.d || 1) : 1}}); render(); return;
  }
  if (t.dataset.misweek !== undefined){ const w = num(t.dataset.misweek); S.misWeek = S.misWeek === w ? -1 : w; render(); return; }
  if (t.dataset.miscf !== undefined){ S.misCf = S.misCf === t.dataset.miscf ? "" : t.dataset.miscf; render(); return; }
  if (t.dataset.miscc !== undefined){ S.misCc = S.misCc === t.dataset.miscc ? "" : t.dataset.miscc; render(); return; }
  if (t.dataset.fstab){ S.fsTab = t.dataset.fstab; render(); return; }
  if (t.dataset.fsunmap !== undefined){ const c = FS.cfg(S.books); delete c.map[t.dataset.fsunmap]; S.books.fs = c; S.fsRun = S.fsRun ? {fy: S.fsRun.fy, kind: c.kind, d: FS.build(S.fsRun.fy)} : null; saveBooks(); render(); return; }
  if (t.dataset.mistab){ S.misTab = t.dataset.mistab; S.misQ = ""; S.misF = ""; render(); return; }
  if (t.dataset.misquick){ const x = misRangeQuick(t.dataset.misquick, S.books); S.misRange = {from: Audit.iso(x.from), to: Audit.iso(x.to)}; render(); return; }
  if (t.dataset.misopen !== undefined){ S.misOpen = S.misOpen === t.dataset.misopen ? "" : t.dataset.misopen; render(); return; }
  if (t.dataset.misopenhead !== undefined){ S.misOpenHead = S.misOpenHead === t.dataset.misopenhead ? "" : t.dataset.misopenhead; render(); return; }
  if (t.dataset.misled !== undefined){ S.misLed = t.dataset.misled; render(); return; }
  if (t.dataset.audittab){ S.auditTab = t.dataset.audittab; render(); return; }
  if (t.dataset.reladd !== undefined){ const b = S.books; b.auditRel = (b.auditRel || []).concat([{name: t.dataset.reladd, relation: ""}]); saveBooks(); render(); return; }
  if (t.dataset.reldel !== undefined){ const b = S.books; b.auditRel = (b.auditRel || []).filter(x => x.name !== t.dataset.reldel); saveBooks(); render(); return; }
  if (t.dataset.auditopen){ S.auditOpen = S.auditOpen === t.dataset.auditopen ? "" : t.dataset.auditopen; render(); return; }
  if (t.dataset.auditarea !== undefined && t.tagName === "BUTTON"){ S.auditArea = t.dataset.auditarea; render(); return; }
  if (t.dataset.lmpost){ LedMaster.applyPosting(S.books, CO(), t.dataset.lmpost); render(); return; }
  if (t.dataset.lmview){ S.lmView = t.dataset.lmview; S.booksTab = "ledgers"; render(); return; }
  if (t.dataset.lmok){ const m = S.books.map[t.dataset.lmok]; if (m){ LedMaster.confirm(S.books, [t.dataset.lmok], !m.ok); S.books.reco = null; saveBooks(); render(); } return; }
  if (t.dataset.r2tab){ S.r2Tab = t.dataset.r2tab; render(); return; }
  if (t.dataset.r2scope){ S.r2Scope = t.dataset.r2scope; render(); return; }
  if (t.dataset.r2open){ S.r2Open = S.r2Open === t.dataset.r2open ? "" : t.dataset.r2open; render(); return; }
  if (t.dataset.r2fclear){ S.r2F = Object.assign({}, S.r2F, {[t.dataset.r2fclear]: {}}); render(); return; }
  if (t.dataset.r2ok){ const st = GST2B.state(); st.confirm[t.dataset.r2ok] = "yes"; saveBooks(); render(); return; }
  if (t.dataset.r2no){
    const st = GST2B.state(), [pk, ids] = t.dataset.r2no.split(">");
    String(ids || "").split(",").filter(Boolean).forEach(id => { st.confirm[pk + ">" + id] = "no"; });
    delete st.link[pk]; delete st.confirm[pk];
    saveBooks(); render(); return;
  }
  if (t.dataset.r2copy){
    const reg = r2Reg(S.books), sc0 = r2Scope(), sc = GST2B.scope(reg, sc0.months);
    const s = GST2B.suppliers(sc).find(x => (x.gstin || x.party) === t.dataset.r2copy);
    if (s){
      const text = GST2B.followUp(s);
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Note copied: paste it into an email or WhatsApp."),
        () => printView("Note to " + s.party, "<pre style=\"white-space:pre-wrap;font:13px/1.5 inherit\">" + esc(text) + "</pre>"));
    }
    return;
  }
  if (t.dataset.chopen){ S.chOpen = S.chOpen === t.dataset.chopen ? "" : t.dataset.chopen; render(); return; }
  if (t.dataset.q24open){ S.q24Open = S.q24Open === t.dataset.q24open ? "" : t.dataset.q24open; render(); return; }
  if (t.dataset.r1open){ S.r1Open = S.r1Open === t.dataset.r1open ? "" : t.dataset.r1open; render(); return; }
  if (t.dataset.b2open){ S.b2Open = S.b2Open === t.dataset.b2open ? "" : t.dataset.b2open; render(); return; }
  if (t.dataset.clearf){ S[t.dataset.clearf] = {}; render(); return; }
  if (t.dataset.printid){
    const co = CO(), el = document.getElementById(t.dataset.printid);
    printView(t.dataset.printtitle || co.name, "<h1>" + esc(co.name) + '</h1><p class="note">' + esc(t.dataset.printtitle || "") + " \u00b7 printed " + fmtDate(new Date().toISOString().slice(0, 10)) + "</p>" + (el ? el.outerHTML : ""));
    return;
  }
  if (t.dataset.tdsopen){ S.tdsOpen = S.tdsOpen === t.dataset.tdsopen ? "" : t.dataset.tdsopen; render(); return; }
  if (t.dataset.qgo){ S.tdsQ = t.dataset.qgo; S.tdsForm = "26Q"; S.tdsView = "return"; S.tdsTab = ""; render(); return; }
  if (t.dataset.assetdel){ S.books.assets = (S.books.assets || []).filter(a => a.id !== t.dataset.assetdel); saveBooks(); render(); return; }
  if (t.dataset.certdel){ S.books.certs = (S.books.certs || []).filter(c => c.id !== t.dataset.certdel); saveBooks(); render(); return; }
  if (t.dataset["2btab"]){ S.twoBTab = t.dataset["2btab"]; render(); return; }
  if (t.dataset.paymake){
    const p = TDS.paymentsFromBooks().find(x => x.vid === t.dataset.paymake);
    const bsr = (document.querySelector('[data-paybsr="' + t.dataset.paymake + '"]') || {}).value || "";
    const ser = (document.querySelector('[data-payser="' + t.dataset.paymake + '"]') || {}).value || "";
    if (!p) return;
    if (!bsr.trim() || !ser.trim()){ toast("Fill the BSR code and the challan serial number first."); return; }
    S.books.challans = (S.books.challans || []).concat([{id: uid("ch"), bsr: bsr.trim(), serial: ser.trim(), date: p.date, tax: p.tax, interest: 0, fromVoucher: p.vid}]);
    saveBooks(); toast("Challan added from the books."); render(); return;
  }
  if (t.dataset.chdel){ S.books.challans = (S.books.challans || []).filter(c => c.id !== t.dataset.chdel);
    Object.keys(S.books.alloc || {}).forEach(k => { if (S.books.alloc[k] === t.dataset.chdel) delete S.books.alloc[k]; });
    saveBooks(); render(); return; }
  if (t.dataset.txntab){ S.txnTab = t.dataset.txntab; render(); return; }
  if (t.dataset.txngo){
    const id = t.dataset.txngo, kind = t.dataset.txnkind;
    if (kind === "bill"){ const e = D().entries[id]; if (e){ S.tab = "invoices"; S.filter = e.status === "duplicate" ? "duplicate" : e.status; S.reviewTable = e.status === "draft"; S.selected = id; S.drawerOpen = e.status === "draft"; render(); window.scrollTo(0, 0); } return; }
    if (kind === "sale"){ S.tab = "sales"; if (SL()) SL().openId = id; render(); window.scrollTo(0, 0); return; }
    S.tab = "bank"; if (S.bank){ S.bank.filter = "all"; S.bank.sticky.add(id); } render(); window.scrollTo(0, 0); return;
  }
  if (t.dataset.txnopen){
    const id = t.dataset.txnopen;
    toast("Opening the document\u2026");
    FileStore.get(S.coId, id, t.dataset.txnpath || "", t.dataset.txnname || "").then(f => {
      if (f) window.open(URL.createObjectURL(f), "_blank");
      else toast("That document could not be found on this computer or in the firm account.");
    });
    return;
  }
  if (t.dataset.goclient !== undefined && t.dataset.goclient !== null && t.dataset.goclient !== ""){
    const to = t.dataset.goclient, cid = S.coId;
    if (!cid) return;
    const go = () => {
      S.colPop = null; S.drawerOpen = false;
      if (to === "dash"){ S.tab = "dash"; S.step = null; render(); window.scrollTo(0, 0); return; }
      if (to === "inbox"){ S.tab = "clientInbox"; S.step = null; render(); window.scrollTo(0, 0); return; }
      if (to === "txn"){ S.tab = "txn"; S.step = null; render(); window.scrollTo(0, 0); return; }
      if (to === "books"){ S.tab = "books"; S.step = null; render(); window.scrollTo(0, 0); return; }
      if (to === "post"){ goStep("post", "bills"); return; }
      if (to === "bank" && (!S.bank || S.bank.cid !== cid)) loadBank(cid).then(() => render());
      goStep(to === "bills" ? "review" : "review", to === "bills" ? "bills" : to);
    };
    if (S.view !== "company" || S.coId !== cid) openCompany(cid).then(go); else go();
    return;
  }
  if (t.dataset.nav){ closeSwitcher(); S.firmMenu = false; S.tallyPanel = false; S.view = "home"; S.homeTab = t.dataset.nav; S.step = null; S.addingCo = false; S.arm = null; if (t.dataset.nav === "rules") S.settingsTab = null; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.step){ goStep(t.dataset.step); return; }
  if (t.dataset.dtype){
    const step = t.dataset.gstep || curStep(), type = t.dataset.dtype;
    if (type === "bank" && (!S.bank || S.bank.cid !== S.coId)) loadBank(S.coId).then(() => { if (S.pendingBankFilter && S.bank){ S.bank.filter = S.pendingBankFilter; S.pendingBankFilter = null; } render(); });
    goStep(step === "post" && type === "sales" ? "review" : step, type);
    return;
  }
  if (t.dataset.goto){ const st = t.dataset.gstep || "review"; openCompany(t.dataset.goto).then(() => goStep(st, "bills")); return; }
  if (t.dataset.tab){ S.tab = t.dataset.tab; S.step = null; S.arm = null; render(); return; }
  if (t.dataset.htab){ S.homeTab = t.dataset.htab; S.addingCo = false; render(); return; }
  if (t.dataset.filter){ S.filter = t.dataset.filter; S.selected = null; render(); return; }
  if (t.dataset.select){ S.selected = t.dataset.select; render(); if (window.innerWidth < 860){ const d = document.querySelector(".detail"); if (d) d.scrollIntoView({behavior:"smooth", block:"start"}); } return; }
  if (t.id === "drop"){ pickFiles("company"); return; }
  if (t.id === "dropAuto"){ pickFiles("auto"); return; }
  if (t.dataset.editparty){ S.partySel = t.dataset.editparty; render(); return; }
  if (t.dataset.job){
    const j = S.jobs.find(x => x.id === t.dataset.jid);
    if (!j) return;
    if (t.dataset.job === "retry" || t.dataset.job === "google" || t.dataset.job === "claude"){ S.readBlocked = null; j.force = t.dataset.job === "retry" ? null : t.dataset.job; j.advanced = false; j.status = "waiting"; j.msg = ""; j.prev = null; j.donePromise = new Promise(res => { j.markDone = res; }); S.batchSize = 2; pump(); render(); }
    else if (t.dataset.job === "type") typeItIn(j);
    else if (t.dataset.job === "open") openJobEntry(j);
    return;
  }
  if (t.dataset.delinbox){ const id = t.dataset.delinbox; delete S.inbox[id]; delete S.files[id]; Store.deleteInbox(id); render(); return; }
  const e = curEntry(), act = t.dataset.act;
  if (act !== "delCo" && act !== "clearSent") S.arm = null;
  switch (act){
    case "switch": openSwitcher(); break;
    case "home": goHome(); break;
    case "swHome": S.homeTab = "clients"; goHome(); break;
    case "swAdd": S.homeTab = "clients"; S.addingCo = true; goHome(); break;
    case "addCo": S.view = "home"; S.homeTab = "clients"; S.addingCo = true; render(); { const n = document.getElementById("ncName"); if (n) n.focus(); } break;
    case "cancelCo": S.addingCo = false; render(); break;
    case "saveCo": saveNewCompany(); break;
    case "reread": if (e) rereadCarefully(e); break;
    case "confirmType": if (e){ e.confirmType = false; Store.saveEntry(S.coId, e); refreshStats(S.coId); toast("Payment type confirmed: " + ruleOf(e.natureId).label + ". It will be remembered for this supplier when you approve."); render(); } break;
    case "skipTds": if (e && e.status === "draft"){ e.tdsForce = false; e.tdsSkip = "pay"; Store.saveEntry(S.coId, e); refreshStats(S.coId); toast("TDS will not be booked on this bill. Choose the reason in the TDS decision section."); render(); } break;
    case "revTable": S.reviewTable = true; S.revSel = new Set(); render(); window.scrollTo(0, 0); break;
    case "revList": S.reviewTable = false; render(); break;
    case "bankPickBills": S.reviewTable = false; render(); setTimeout(() => { const el = document.getElementById("fileIn"); if (el) el.click(); }, 50); break;
    case "revNone": S.revSel = new Set(); render(); break;
    case "revTdsOn": case "revTdsOff": {
      const on = S.arm === null || true, want = t.dataset.act === "revTdsOn";
      draftRows().filter(r => S.revSel.has(r.e.id)).forEach(r => revSet(r.e, want));
      toast((want ? "TDS will be booked on " : "TDS will not be booked on ") + S.revSel.size + " bills.");
      render(); break;
    }
    case "revApprove": case "revApproveAll": {
      const rows = draftRows().filter(r => t.dataset.act === "revApprove" ? S.revSel.has(r.e.id) : (!(r.c.missing || []).length && !r.c.flags.some(f => f.lvl === "hi") && !r.e.confirmType));
      let ok = 0, held = 0;
      rows.forEach(r => { const c = compute(r.e); if ((c.missing || []).length){ held++; return; } approve(r.e); ok++; });
      S.revSel = new Set();
      toast(ok + " approved" + (held ? ", " + held + " still need details" : "") + ".");
      refreshStats(S.coId); render(); break;
    }
    case "revCheckTally": reviewCheckTally(draftRows().filter(r => S.revSel.has(r.e.id))); break;
    case "revCheckTallyAll": reviewCheckTally(draftRows()); break;
    case "ytdFetch": {
      const e0 = curEntry(); if (!e0) break;
      const c0 = compute(e0), led = partyLedgerName(c0.party, e0);
      if (!led){ toast("Set the supplier's Tally ledger on this bill first."); break; }
      S.ytdBusy = e0.id; render();
      fetchPartyYtd(c0.party, fyOf(e0.x.invoiceDate), led).then(info => {
        S.ytdBusy = null;
        if (info) toast(money0(info.credited) + " credited to " + led + " in Tally this year (" + info.vouchers + " vouchers).");
        else toast("Could not read that ledger from Tally.");
        render();
      }, err => { S.ytdBusy = null; toast("Could not read from Tally: " + err.message); render(); });
      break;
    }
    case "bookTds": if (e && e.status === "draft"){ const c0 = compute(e); e.tdsSkip = null; if (c0.skip && c0.skip.from !== "bill") e.tdsForce = true; Store.saveEntry(S.coId, e); refreshStats(S.coId); render(); } break;
    case "rcmApply": if (e){ const sg = suggestRcm(e, CO()); const cat = sg ? sg.cat : "other"; e.rcm = {on:true, cat, rate:catRate(cat), inter:null}; Store.saveEntry(S.coId, e); render(); } break;
    case "rcmDismiss": if (e){ e.rcmDismissed = true; Store.saveEntry(S.coId, e); render(); } break;
    case "blockAccept": if (e){ const sg = suggestBlock(e, CO()); e.itcBlock = {on:true, cat: sg ? sg.cat : BLOCK_CATS[0].id}; Store.saveEntry(S.coId, e); render(); } break;
    case "blockReject": if (e){ e.itcBlock = {on:false, cat: (suggestBlock(e, CO()) || {}).cat}; e.blockDismissed = true; Store.saveEntry(S.coId, e); render(); } break;
    case "fieldsOk": if (e){ e.uncertain = []; Store.saveEntry(S.coId, e); refreshStats(S.coId); render(); } break;
    case "nextBill": { const next = Object.values(D().entries).filter(o => o.status === "draft" && (!e || o.id !== e.id)).sort(byDate)[0]; if (next){ S.filter = "draft"; S.selected = next.id; render(); window.scrollTo(0, 0); } break; }
    case "goExport": S.tab = "export"; render(); window.scrollTo(0, 0); break;
    case "runSelfTest": runSelfTest(); break;
    case "goSelfTest": closeSwitcher(); S.view = "home"; S.homeTab = "rules"; render(); { const el = document.getElementById("selfTestPane"); if (el && el.scrollIntoView) el.scrollIntoView(); } break;
    case "copyDiag": {
      const box = document.getElementById("diagBox"); const txt = box ? box.value : diagnosticReport();
      const done = () => toast("Report copied. Paste it into the chat.");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => { if (box){ box.focus(); box.select(); } toast("Select the report and copy it (Ctrl+C)."); });
      else { if (box){ box.focus(); box.select(); } toast("Select the report and copy it (Ctrl+C)."); }
      break;
    }
    case "cloudSignIn": {
      const em = document.querySelector('[data-cloud="email"]'), pw = document.querySelector('[data-cloud="password"]');
      const email = em ? em.value.trim() : "", pass = pw ? pw.value : "";
      if (!email || !pass){ toast("Enter your email and password."); break; }
      Cloud.st.busy = "Signing in\u2026"; Cloud.st.error = ""; render();
      Cloud.signIn(email, pass).then(() => { Cloud.st.busy = ""; S.cloudForm = null; toast("Signed in as " + email + "."); startCloudSync(); loadAccount(true).then(() => render()); render(); },
        err => { Cloud.st.busy = ""; Cloud.st.error = err.message; render(); });
      break;
    }
    case "useOffline": Cloud.setCfg({gate: false}); toast("Working on this computer only. Sign in later from Settings to share with the firm."); render(); break;
    case "docqReadAll": { const ids = docqFor(S.view === "company" ? S.coId : "").filter(d => d.status === "waiting").map(d => d.id); readDocq(ids, S.view === "company" ? S.coId : ""); break; }
    case "dropKeysList": Cloud.rpc("my_drop_keys").then(r => { S.dropKeys = [].concat(r || []); render(); }, e => toast(e.message)); break;
    case "dropKeyNew": {
      askConfirm({title: "Make a drop key", ok: "Make it", body: '<div class="bk-form one"><label><span>What is it for?</span><input type="text" id="dkLabel" value="Cowork agent"></label></div>',
        read: () => ({label: (document.getElementById("dkLabel") || {}).value || "Agent"})}).then(a => {
        if (!a) return;
        Cloud.rpc("create_drop_key", {p_label: a.data.label}).then(r => {
          if (!r || r.ok === false){ toast((r && r.reason) || "Could not make a key."); return; }
          S.newDropKey = r.key; return Cloud.rpc("my_drop_keys").then(k => { S.dropKeys = [].concat(k || []); render(); });
        }, e => toast(e.message));
      });
      break;
    }
    case "dropKeyHide": S.newDropKey = null; render(); break;
    case "drawerClose": S.drawerOpen = false; render(); break;
    case "setup": S.step = null; S.tab = isSetupTab(S.tab) ? "invoices" : "settings"; render(); break;
    case "toBankReady": S.tab = "bank"; if (S.bank) S.bank.filter = "ready"; render(); break;
    case "toBankDone": S.tab = "bank"; if (S.bank) S.bank.filter = "done"; render(); break;
    case "toBillsApproved": S.tab = "invoices"; S.filter = "approved"; S.selected = null; render(); break;
    case "collectBills": pickMode = "company"; document.getElementById("fileIn").click(); break;
    case "uploadHere": {
      if (docType() === "bank"){
        if (S.tab !== "bank" || curStep() !== "review") goStep("review", "bank");
        setTimeout(() => { const el = document.getElementById("bankIn"); if (el){ S.advanceAfterBank = true; el.click(); } }, 60);
      } else { S.advanceAfterRead = true; pickMode = "company"; document.getElementById("fileIn").click(); }
      break;
    }
    case "signOutNow": {
      askConfirm({title: "Sign out of TDS Desk?", ok: "Sign out", body: '<p class="note">You will need your email and password to come back in. Work already synced stays in your firm account.</p>'}).then(a => {
        if (!a) return;
        Cloud.signOut(); clearInterval(cloudTimer); S.account = null; S.adminData = null; S.backups = null; S.settingsTab = null;
        Cloud.setCfg({gate: true});            // signing out always brings the sign-in screen back
        S.view = "home"; S.coId = null; toast("Signed out."); render();
      });
      break;
    }
    case "showSignUp": S.signUpOpen = true; Cloud.st.error = ""; render(); break;
    case "showSignIn": S.signUpOpen = false; Cloud.st.error = ""; render(); break;
    case "cloudSignUp": {
      const f = S.cloudForm || {};
      if (!f.firm || !f.email || !(f.password || "").trim()){ toast("Fill in the firm name, email and password."); break; }
      Cloud.st.busy = "Making the account\u2026"; Cloud.st.error = ""; render();
      Cloud.signUp({firm: f.firm, name: f.name || "", email: f.email, password: f.password})
        .then(() => Cloud.signIn(f.email, f.password))
        .then(() => { Cloud.st.busy = ""; S.cloudForm = null; S.signUpOpen = false; toast("Welcome. Your firm is ready."); startCloudSync(); loadAccount(true).then(() => render()); render(); },
              err => { Cloud.st.busy = ""; Cloud.st.error = err.message; render(); });
      break;
    }
    case "docIsBill": { const e0 = curEntry(); if (e0){ e0.docOverride = true; Store.saveEntry(S.coId, e0); toast("Taken as a tax invoice."); render(); } break; }
    case "buyerOk": { const e0 = curEntry(); if (e0){ e0.buyerOverride = true; Store.saveEntry(S.coId, e0); toast("Kept under " + CO().name + "."); render(); } break; }
    case "cloudSync": cloudSync(true); break;
    case "logAll": S.logAll = !S.logAll; render(); break;
    case "logCsv": postLogCsv(); break;
    case "backupList": Cloud.rpc("my_backups").then(r => { S.backups = [].concat(r || []); render(); }, e => toast(e.message)); break;
    case "backupNow": {
      toast("Taking a backup\u2026");
      Cloud.rpc("take_backup", {p_firm: (S.account && S.account.firm) ? S.account.firm.id : null})
        .then(() => Cloud.rpc("my_backups")).then(r => { S.backups = [].concat(r || []); toast("Backup taken."); render(); }, e => toast(e.message));
      break;
    }
    case "acctRefresh": loadAccount(); break;
    case "adminRefresh": loadAdminOverview(); break;
    case "acctHistory": {
      S.walletOpen = !S.walletOpen;
      if (S.walletOpen) Cloud.api("wallet_entries?select=at,kind,code,qty,amount,balance_after,note&order=at.desc&limit=50").then(r => { S.wallet = r || []; render(); }, e => toast(e.message));
      render(); break;
    }
    case "addPerson": {
      const g = id => (document.getElementById(id) || {}).value || "";
      const email = g("npEmail").trim();
      if (!email){ toast("An email address is needed."); break; }
      Cloud.fn("admin", {action: "add_person", email, name: g("npName"), role: g("npRole")}).then(r => {
        S.newPerson = {email: r.email, password: r.password};
        toast("Added " + r.email + ".");
        loadAccount();
      }, e => toast(e.message));
      break;
    }
    case "cloudPassword": {
      const a = document.querySelector('[data-cloud="newpw"]'), b2 = document.querySelector('[data-cloud="newpw2"]');
      const pw = a ? a.value : "", pw2 = b2 ? b2.value : "";
      if (pw.length < 8){ toast("Use at least 8 characters."); break; }
      if (pw !== pw2){ toast("The two passwords are not the same."); break; }
      Cloud.changePassword(pw).then(() => { if (a) a.value = ""; if (b2) b2.value = ""; toast("Password changed. Use it next time you sign in."); },
        err => toast(err.message));
      break;
    }
    case "cloudSignOut": {
      askConfirm({title: "Sign out of the firm account?", ok: "Sign out", body: "This computer keeps its own copy of everything. Changes made after signing out are not shared until you sign in again."}).then(a => {
        if (!a) return;
        Cloud.signOut(); clearInterval(cloudTimer); S.account = null; S.adminData = null; toast("Signed out."); render();
      });
      break;
    }
    case "bridgeTest": { const k = document.querySelector('[data-bridge="key"]'), u = document.querySelector('[data-bridge="url"]');
      Bridge.setCfg({key: k ? k.value.trim() : Bridge.cfg().key, url: u ? u.value.trim() || "http://127.0.0.1:9100" : Bridge.cfg().url});
      Bridge.lastOpenKey = null; Bridge.refresh().then(() => { toast(Bridge.up() ? "Connected to the Tally Bridge." : Bridge.st.error); startBridgePolling(); render(); }); break; }
    case "bridgeSetupFile": saveBridgeSetup(); break;
    case "adminCreditGo": break;
    case "bridgeConnect": {
      toast("Looking for the bridge on this computer\u2026");
      Bridge.pair().then(j => {
        Bridge.lastOpenKey = null;
        return Bridge.refresh().then(() => { toast("Connected to the bridge on " + (j.computer || "this computer") + "."); startBridgePolling(); render(); });
      }, err => { Bridge.st.error = err.message; toast(err.message); render(); });
      break;
    }
    case "bridgeOff": Bridge.setCfg({key: ""}); clearInterval(bridgeTimer); Bridge.st = {state: "off", sessions: [], open: [], at: Date.now(), error: ""}; render(); break;
    case "billPost": postBillsToTally(); break;
    case "marketPick": { const i = document.getElementById("marketIn"); if (i){ i.value = ""; i.click(); } break; }
    case "booksPick": { const i = document.getElementById("booksIn"); if (i){ i.value = ""; i.click(); } break; }
    case "mastersPick": { const i = document.getElementById("mastersIn"); if (i){ i.value = ""; i.click(); } break; }
    case "filedPick": { const i = document.getElementById("filedIn"); if (i){ i.value = ""; i.click(); } break; }
    case "twoBPick": { const i = document.getElementById("twoBIn"); if (i){ i.value = ""; i.click(); } break; }
    case "tallyRead": {
      const b = S.books, t = Audit.today(), r = S.tallyRange || {from: Audit.iso(Audit.fyStart(t)), to: Audit.iso(t)};
      const from = Audit.ymd(r.from), to = Audit.ymd(r.to);
      if (!from || !to || from > to){ toast("Choose a period: from a date to a later one."); break; }
      if (!bridgeLive(CO())){ toast("Open this company in Tally with the bridge running."); break; }
      TallyRead.read(from, to, "live").then(n2 => { toast(n2 + " vouchers and Tally's balances read."); render(); },
        e => { b.busy = ""; const msg = String(e && e.message || e); toast(/Unknown address/.test(msg) ? "This needs Tally Bridge 1.10. Update the bridge on the Tally computer." : "Could not read Tally: " + msg); render(); });
      break;
    }
    case "tallyCopyCheck": {
      const co = CO(); if (!bridgeLive(co)) break;
      const q = "?company=" + encodeURIComponent(Bridge.openFor(co).name) + Bridge.pinQ();
      Promise.all([Bridge.call("/synced" + q, null, 30000), Bridge.call("/schedule", null, 30000).catch(() => null)]).then(([c, sc]) => {
        S.tallyCopy = Object.assign({}, c, {schedule: sc, time: (S.tallyCopy || {}).time}); render();
      }, e => { S.tallyCopy = {error: /Unknown address/.test(String(e && e.message)) ? "This needs Tally Bridge 1.10." : String(e && e.message || e)}; render(); });
      break;
    }
    case "tallyCopyUse": {
      const cp = S.tallyCopy; if (!cp || !cp.from) break;
      TallyRead.read(cp.from, cp.to, "copy").then(n2 => { toast(n2 + " vouchers read from last night's copy."); render(); }, e => { S.books.busy = ""; toast("Could not read the copy: " + (e && e.message || e)); render(); });
      break;
    }
    case "tallyScheduleOn": case "tallyScheduleOff": {
      const on = act === "tallyScheduleOn", time = (S.tallyCopy || {}).time || "02:00";
      Bridge.call("/schedule", {on, time}, 60000).then(sc => { S.tallyCopy = Object.assign({}, S.tallyCopy, {schedule: sc}); toast(on ? "The bridge will copy every open company at " + time + " each night." : "Nightly copy stopped."); render(); },
        e => toast("The bridge could not set it: " + (e && e.message || e)));
      break;
    }
    case "fsRun": { const y = S.fsFy || fsYears()[0], c = FS.cfg(S.books); S.fsRun = {fy: y, kind: c.kind, d: FS.build(y)}; render(); break; }
    case "fsPdf": { const d = S.fsRun && S.fsRun.d; if (d && !d.error) printView(CO().name + " financial statements " + d.fy, "<style>@page{size:A4 portrait;margin:14mm}h2{font-size:14px;margin:14px 0 6px;border-bottom:1px solid #D7DEDA}</style>" + FS.html(d)); break; }
    case "fsExcel": { const d = S.fsRun && S.fsRun.d; if (d && !d.error) fsExcel(d).then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break; }
    case "misRun": {
      const b = S.books, rg = S.misRange || (x => ({from: Audit.iso(x.from), to: Audit.iso(x.to)}))(misRangeQuick("ytd", b));
      if (!rg.from || !rg.to || rg.from > rg.to){ toast("Choose a period: from a date to a later one."); break; }
      MIS.run(rg.from, rg.to, "run now"); saveBooks(); render(); break;
    }
    case "misBudFill": {
      const b = S.books, r = (b.mis || {}).last; if (!r) break;
      const fy = Audit.fyStart(r.to).slice(0, 4), k = 1 + num(S.misBudPct || 10) / 100, n2 = r.pl.months.length || 1;
      b.budget = b.budget || {}; const B = b.budget[fy] = {};
      MIS.HEADS.forEach(([h2]) => { const H = r.pl.heads[h2]; if (!H) return; const avg = r2(H.t / n2 * k); B[h2] = {}; GSTRev.fyMonths(fy + "04").forEach(mm => { B[h2][mm] = Math.round(avg); }); });
      saveBooks(); toast("Budget filled: this year's monthly average so far, plus " + (S.misBudPct || 10) + "%. Change any month."); render(); break;
    }
    case "misPack": { const r = (S.books.mis || {}).last; if (r) printView(CO().name + " MIS " + r.from + "-" + r.to, "<style>@page{size:A4 portrait;margin:14mm}h2{font-size:15px;margin:14px 0 6px;border-bottom:1px solid #D7DEDA;padding-bottom:3px}</style>" + misPackHtml(r)); break; }
    case "misExcel": { const r = (S.books.mis || {}).last; if (r) misExcel(r).then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break; }
    case "relAddTyped": {
      const b = S.books, i = document.getElementById("relq"), v = i ? i.value.trim() : "";
      if (!v || !(Object.assign({}, b.ledInfo || {}, b.map || {})[v])){ toast("Choose a ledger from the list."); break; }
      if (!(b.auditRel || []).some(x => x.name === v)) b.auditRel = (b.auditRel || []).concat([{name: v, relation: ""}]);
      saveBooks(); render(); break;
    }
    case "audit3cdPdf": { const run = (S.books.audit || {}).last; if (run) printView(CO().name + " 3CD working " + run.from + "-" + run.to, "<style>@page{size:A4 portrait;margin:14mm}p{margin:0 0 6px}</style>" + Audit.form3cdHtml(Audit.form3cd(run))); break; }
    case "audit3cdExcel": {
      const run = (S.books.audit || {}).last; if (!run) break;
      const d = Audit.form3cd(run);
      ensureXlsx().then(() => {
        const wb = XLSX.utils.book_new();
        d.clauses.forEach(c => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Clause " + c.no + ". " + c.title], c.head].concat(c.rows).concat(c.note ? [[], [c.note]] : [])), ("Cl " + c.no).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31)));
        saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-3CD-working-" + run.from + "-" + run.to + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
        toast("Downloaded.");
      }, e => toast("Could not build the file: " + (e && e.message)));
      break;
    }
    case "auditReadLy": {
      const b = S.books, dr = Audit.defaultRange(b), r0 = S.auditRange || {from: Audit.iso(dr.from), to: Audit.iso(dr.to)};
      const f0 = Audit.ymd(r0.from), t0 = Audit.ymd(r0.to), lf = MIS.shift(f0, -1), lt = MIS.shift(t0, -1);
      const keepTb = b.tb;
      TallyRead.read(lf, lt, "live").then(() => { if (keepTb && keepTb.from === f0) b.tb = keepTb; const run = Audit.run(f0, t0, "run now, with last year read from Tally"); saveBooks(); toast("Last year read. " + run.findings.length + " findings."); render(); },
        e => { b.busy = ""; toast("Could not read last year: " + (e && e.message || e)); render(); });
      break;
    }
    case "auditRun": {
      const b = S.books, dr = Audit.defaultRange(b), r = S.auditRange || {from: Audit.iso(dr.from), to: Audit.iso(dr.to)};
      if (!r.from || !r.to || r.from > r.to){ toast("Choose a period: from a date to a later one."); break; }
      const run = Audit.run(r.from, r.to, "run now"); saveBooks();
      toast(run.findings.length + " findings, " + run.findings.filter(f => f.sev === "high").length + " serious."); render(); break;
    }
    case "auditReport": {
      const run = (S.books.audit || {}).last; if (!run) break;
      printView(CO().name + " audit " + run.from + "-" + run.to, "<style>@page{size:A4 portrait;margin:14mm}h2{font-size:15px;margin:16px 0 8px;border-bottom:1px solid #D7DEDA;padding-bottom:3px}p{margin:0 0 6px}</style>" + Audit.reportHtml(run));
      break;
    }
    case "auditExcel": { const run = (S.books.audit || {}).last; if (run) Audit.toExcel(run).then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break; }
    case "auditJe": {
      const run = (S.books.audit || {}).last; if (!run) break;
      const jes = Audit.jesToPass(run);
      if (!jes.length){ toast("Mark a finding \u201cEntry to pass\u201d first; its entries go into the file."); break; }
      const miss = Audit.missingLedgers(jes);
      saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-audit-entries.xml", new Blob([Audit.jeXml(jes)], {type: "application/xml"}));
      toast(jes.length + " entries in the file. In Tally: Import \u2192 Transactions." + (miss.length ? " Create these ledgers first: " + miss.join(", ") + "." : ""));
      break;
    }
    case "auditFinal": { const fz = Audit.finalise(); if (fz){ saveBooks(); toast("Final report locked for this period (result code " + fz.run.code + ")."); render(); } break; }
    case "auditFinalPdf": {
      const run = (S.books.audit || {}).last, fz = run && Audit.finalFor(run.from, run.to); if (!fz) break;
      printView(CO().name + " audit final " + fz.run.from + "-" + fz.run.to, "<style>@page{size:A4 portrait;margin:14mm}h2{font-size:15px;margin:16px 0 8px;border-bottom:1px solid #D7DEDA;padding-bottom:3px}p{margin:0 0 6px}</style>" + '<p class="note">FINAL &middot; locked on ' + fmtDate(fz.at.slice(0, 10)) + "</p>" + Audit.reportHtml(fz.run, fz.st));
      break;
    }
    case "auditUnlock": { const run = (S.books.audit || {}).last; if (run && S.books.audit.final){ delete S.books.audit.final[run.from + "-" + run.to]; saveBooks(); toast("Unlocked."); render(); } break; }
    case "gst9Pdf": case "gst9cPdf": { const w = act === "gst9Pdf" ? "9" : "9C"; printView(CO().name + " GSTR-" + w, "<style>@page{size:A4 portrait;margin:12mm}</style>" + gst9PackHtml(w)); break; }
    case "itctExcel": itctExcel().then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "itctCopy": case "itctMail": case "itctWa": {
      const x = itctSupplier(t.dataset.sup); if (!x) break;
      if (act === "itctCopy") (navigator.clipboard ? navigator.clipboard.writeText(x.L.text) : Promise.reject()).then(() => toast("Letter copied."), () => toast("Could not copy; use the Excel."));
      if (act === "itctMail"){ if (!x.s.email){ toast("Type the supplier's email first."); break; } window.open("mailto:" + encodeURIComponent(x.s.email) + "?subject=" + encodeURIComponent("GST: invoices not in our GSTR-2B") + "&body=" + encodeURIComponent(x.L.text), "_blank"); }
      if (act === "itctWa"){ const ph = String(x.s.phone || "").replace(/\D/g, ""); if (!ph){ toast("Type the supplier's phone first."); break; } window.open("https://wa.me/" + (ph.length === 10 ? "91" + ph : ph) + "?text=" + encodeURIComponent(x.L.text), "_blank"); }
      itctLogSent(x.reg, x.s.key); render(); break; }
    case "inregExcel": inregExcel().then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "gst9Excel": case "gst9cExcel": gst9Excel(act === "gst9Excel" ? "9" : "9C").then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "lmPostAll": { const n2 = LedMaster.applyPosting(S.books, CO()); toast(n2 + " posting ledger" + (n2 === 1 ? "" : "s") + " set from the master."); render(); break; }
    case "lmConfirmShown": {
      const b = S.books, info = b.ledInfo || {}, q = String(S.ledQ || "").toLowerCase(), view = S.lmView || "pending";
      const pool = view === "gst" ? Object.entries(b.map).filter(([nm, m]) => LedMaster.isGst(m.what) && LedMaster.taxLike(nm, m, info[nm])) :
        view === "tds" ? Object.entries(b.map).filter(([nm, m]) => LedMaster.isTds(m.what) && LedMaster.taxLike(nm, m, info[nm])) : LedMaster.pending(b);
      const names = pool.filter(([nm, m]) => !m.ok && (!q || nm.toLowerCase().includes(q) || String(m.section || "").toLowerCase().includes(q) || String((info[nm] || {}).group || "").toLowerCase().includes(q))).map(x => x[0]);
      LedMaster.confirm(b, names, true); b.reco = null; saveBooks(); toast(names.length + " ledger" + (names.length === 1 ? "" : "s") + " confirmed."); render(); break;
    }
    case "ledRead": {
      const co = CO(), b = S.books;
      if (!bridgeLive(co)){ toast("Connect the Tally Bridge and open this company in Tally, or bring in the ledger masters XML under \u201cFrom Tally\u201d."); break; }
      b.busy = "Reading the ledgers from Tally\u2026"; render();
      Bridge.call("/ledgers?company=" + encodeURIComponent(Bridge.openFor(co).name) + Bridge.pinQ(), null, 180000).then(async j => {
        const info = {}, groups = {};
        [].concat(j.ledgers || []).forEach(l => { if (!l || !l.name) return;
          info[l.name] = {group: l.group || "", taxType: String(l.taxType || "").replace(/[^A-Za-z ]/g, "").trim(), dutyHead: l.dutyHead || "", tdsNature: l.tdsNature || "", gstin: l.gstin || "", pan: l.pan || ""};
          if (l.gstin) (b.gstins = b.gstins || {})[l.name] = String(l.gstin).toUpperCase();
          if (l.pan) (b.pans = b.pans || {})[l.name] = String(l.pan).toUpperCase();
          if (l.group) (b.under = b.under || {})[l.name] = l.group; });
        [].concat(j.groups || []).forEach(g => { if (g && g.name) groups[g.name] = g.parent || ""; });
        b.ledInfo = info; b.ledInfoAt = new Date().toISOString(); if (Object.keys(groups).length) b.groups = groups;
        LedMaster.refresh(b); b.busy = ""; b.reco = null; await saveBooks();
        toast(Object.keys(info).length + " ledgers read from Tally. " + LedMaster.pending(b).length + " GST or TDS ledgers to confirm."); render();
      }, e => { b.busy = ""; toast("Could not read Tally: " + (e && e.message || e)); render(); });
      break;
    }
    case "assetAdd": { const b = S.books; b.assets = (b.assets || []).concat([{id: uid("as"), name: "", date: "", igst: 0, cgst: 0, sgst: 0, cess: 0, use: "common", reg: S.gstReg || "", sold: ""}]); saveBooks(); render(); break; }
    case "booksClear": askConfirm({title: "Remove the books read from Tally?", ok: "Remove", body: '<p class="note">Challans and what you corrected stay. The day book can be brought in again.</p>'}).then(ok => {
      if (!ok) return; S.books.vouchers = []; S.books.meta = null; S.books.reco = null; saveBooks(); toast("Removed."); render(); }); break;
    case "booksWipe": {
      const b = S.books; if (!b) break;
      askConfirm({title: "Remove Tally data and all GST work?", ok: "Remove", danger: true, wide: true,
        body: '<p class="note"><b>Removed for ' + esc(CO().name) + ":</b> the day book and ledger masters read from Tally, Tally\u2019s balances, the audit, MIS and trial balance worked from them; every 2B, filed GSTR-1 and GSTR-1A copy; GST settings and contacts; 3B and GSTR-9 figures typed; filing dates and portal figures; ITC follow-up and IMS decisions; advances, reversal and amendment choices; and the returns-filed PDFs.</p>" +
          '<p class="note"><b>Kept:</b> TDS challans, certificates and the salary sheet; bills, bank and sales; the client\u2019s own settings. It cannot be undone; the day book can be brought in again.</p>'}).then(async ok => {
        if (!ok) return;
        const co = CO(), vault = (b.gstVault || []).slice();
        for (const x of vault){ try { await FileStore.drop(co.id, x.id); } catch (e){} if (x.docPath && typeof CloudDocs === "object") CloudDocs.remove(x.docPath); }
        booksWipe(b); GST2B._memo = null; GSTR._carry = null; if (typeof GSTAPI === "object") GSTAPI.sess = {};
        await saveBooks(); toast("Tally data and all GST work removed for " + co.name + "."); render();
      }); break;
    }
    case "fvuClose": S.fvuResult = null; render(); break;
    case "tdsFClear": S.tdsF = {}; render(); break;
    case "tdsPrint": {
      const co = CO(), t = document.getElementById("tdsTable");
      printView(co.name + " TDS " + (S.tdsQ || "") + " " + (S.tdsFy || ""),
        "<h1>" + esc(co.name) + '</h1><p class="note">TDS other than salary \u00b7 ' + esc(S.tdsQ || "all quarters") + " " + esc(S.tdsFy || "") +
        " \u00b7 printed " + fmtDate(new Date().toISOString().slice(0, 10)) + "</p>" + (t ? t.outerHTML : ""));
      break;
    }
    case "tdsAuto": { const n = TDS.autoAllocate(); saveBooks(); toast(n ? n + " deduction" + (n === 1 ? "" : "s") + " put against challans." : "Nothing could be matched to a challan. Check the amounts and dates."); render(); break; }
    case "certAdd": {
      const g = id => (document.getElementById(id) || {}).value || "";
      const party = g("ctParty").trim();
      if (!party){ toast("Name the deductee as it appears in Tally."); break; }
      S.books.certs = (S.books.certs || []).concat([{id: uid("ct"), party, pan: g("ctPan").toUpperCase().trim(), section: g("ctSec").toUpperCase().trim(),
        certNo: g("ctNo").trim(), rate: num(g("ctRate")), from: g("ctFrom"), to: g("ctTo")}]);
      saveBooks(); toast("Certificate added."); render(); break;
    }
    case "yearExcel26": TDSYear.toExcel(S.tdsFy || "", "26Q").then(() => toast("Downloaded."), e => toast("Could not build it: " + (e && e.message))); break;
    case "yearExcel24": TDSYear.toExcel(S.tdsFy || "", "24Q").then(() => toast("Downloaded."), e => toast("Could not build it: " + (e && e.message))); break;
    case "yearExcelAll": TDSYear.toExcel(S.tdsFy || "", "").then(() => toast("Downloaded."), e => toast("Could not build it: " + (e && e.message))); break;
    case "salaryPick": { const i = document.getElementById("salaryIn"); if (i){ i.value = ""; i.click(); } break; }
    case "salaryClear": askConfirm({title: "Remove the salary sheet?", ok: "Remove", body: '<p class="note">The challans and everything else stay.</p>'}).then(ok => {
      if (!ok) return; S.books.salary = []; saveBooks(); toast("Removed."); render(); }); break;
    case "q24Excel": TDS24Q.toExcel(S.tdsFy || "", S.tdsQ || "Q4").then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "tdsTxt": { if (!ledgersReady("tds")) break; LedMaster.snap(S.books, "26Q " + (S.tdsQ || "") + " " + (S.tdsFy || "")); saveBooks();
      const q = S.tdsQ || "", fy = S.tdsFy || "";
      if (!q || !fy){ toast("Choose the year and the quarter first."); break; }
      const r = TDS26Q.build(fy, q, TDS26Q.firmDetails());
      if (r.error){ toast(r.error); break; }
      saveFile(r.name, new Blob([r.text], {type: "text/plain"}));
      toast(r.rows + " deductions under " + r.challans + " challan" + (r.challans === 1 ? "" : "s") + ". Check it with the FVU before filing.");
      break;
    }
    case "tdsFvu": { if (!ledgersReady("tds")) break;
      const q = S.tdsQ || "", fy = S.tdsFy || "";
      if (!q || !fy){ toast("Choose the year and the quarter first."); break; }
      const r = TDS26Q.build(fy, q, TDS26Q.firmDetails());
      if (r.error){ toast(r.error); break; }
      const co = CO();
      toast("Running the FVU on the Tally computer\u2026");
      Bridge.call("/fvu", {text: r.text, name: r.name, fvuJar: (co.fvuJar || ""), csi: (co.csiFile || ""), outDir: (co.fvuOut || "")}, 200000).then(res => {
        res = Object.assign({}, res, {ok: res.accepted != null ? !!res.accepted : !!res.ok});
        S.fvuResult = Object.assign({at: new Date().toISOString(), q, fy}, res);
        toast(res.ok ? "The FVU accepted it. The .fvu file is on the Tally computer." : "The FVU found problems. They are listed below.");
        render();
      }, e => { const msg = (e && e.message) || "the bridge did not answer"; S.fvuResult = {at: new Date().toISOString(), ok: false, errors: /Unknown address/.test(msg) ? "This needs Tally Bridge 1.10. Download it under Settings \u2192 Tally Bridge and run the setup on the Tally computer." : msg}; toast("Could not run the FVU: " + msg); render(); });
      break;
    }
    case "tdsExcel": TDS.toExcel(S.tdsFy || "", S.tdsQ || "").then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "gstJson": if (!ledgersReady("gst")) break; LedMaster.snap(S.books, "GSTR-1 " + GSTR.label(S.gstYm || "") + (S.gstReg ? " " + S.gstReg : "")); saveBooks(); GSTR.toJsonFile(S.gstYm || "", S.gstReg || "").then(j => toast("GSTR-1 JSON for " + j.fp + " downloaded. Check it on the portal's offline tool before filing."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "gst3bJson": { if (!ledgersReady("gst")) break; LedMaster.snap(S.books, "GSTR-3B " + GSTR.label(S.gstYm || "") + (S.gstReg ? " " + S.gstReg : "")); saveBooks();
      const j = GSTR.threeBJson(S.gstYm || "", S.gstReg || "");
      saveFile("GSTR3B_" + (j.gstin || "") + "_" + j.ret_period + ".json", new Blob([JSON.stringify(j)], {type: "application/json"}));
      toast("GSTR-3B JSON for " + j.ret_period + " downloaded. Check it in the portal's offline tool before filing.");
      break;
    }
    case "gstExcel": GSTR.toExcel(S.gstYm || "", S.gstReg || "").then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "twoBExcel": { const sc0 = r2Scope(); GST2B.toExcel(GST2B.scope(r2Reg(S.books), sc0.months), sc0.label).then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break; }
    case "chAdd": {
      const g = id => (document.getElementById(id) || {}).value || "";
      const bsr = g("chBsr").trim(), ser = g("chSer").trim(), dt = g("chDate").replace(/-/g, ""), tax = num(g("chTax"));
      if (!bsr || !ser || !dt || !tax){ toast("Fill the BSR code, serial number, date and tax."); break; }
      S.books.challans = (S.books.challans || []).concat([{id: uid("ch"), bsr, serial: ser, date: dt, tax, interest: num(g("chInt"))}]);
      saveBooks(); toast("Challan added."); render(); break;
    }
    case "txnCsv": txnCsv(); break;
    case "txnClear": S.txnQ = ""; S.txnStatus = ""; S.txnF = S.txnF || {}; S.txnF[txnTab()] = {}; render(); break;
    case "tallyPanel": S.tallyPanel = !S.tallyPanel; S.firmMenu = false; render(); break;
    case "tallyPanelClose": S.tallyPanel = false; render(); break;
    case "tallyGuide": S.tallyPanel = false; S.view = "home"; S.homeTab = "tally"; render(); window.scrollTo(0, 0); break;
    case "firmMenu": S.firmMenu = !S.firmMenu; S.tallyPanel = false; render(); break;
    case "firmMenuClose": S.firmMenu = false; render(); break;
    case "docSendPending": if (S.coId) CloudDocs.sendPending(S.coId); break;
    case "docUsage": Cloud.rpc("doc_usage").then(u => { S.docUsage = u || null; render(); }, e => toast(e.message)); break;
    case "docTidy": {
      const years = num(S.firm.docYears || 3);
      CloudDocs.oldOnes(years).then(list => {
        if (!list.length){ toast("No documents are older than " + years + " year" + (years === 1 ? "" : "s") + " among the clients open on this computer."); return; }
        askConfirm({title: "Clear out " + list.length + " document" + (list.length === 1 ? "" : "s") + "?", ok: "Clear them out", danger: true,
          body: '<p class="note">Documents older than ' + years + " year" + (years === 1 ? "" : "s") + " are removed from the firm account. The bills themselves, and everything posted to Tally, stay. Download them first if you need to keep them.</p>" +
            '<p class="note">Oldest: ' + esc(fmtDate(list[0].when)) + " \u00b7 " + esc(list[0].what) + "</p>"}).then(async ok => {
          if (!ok) return;
          let n = 0;
          for (const it of list){
            await CloudDocs.remove(it.path);
            const e = (S.data[it.cid] || {entries: {}}).entries[it.id];
            if (e){ delete e.docPath; delete e.docSize; Store.saveEntry(it.cid, e); }
            n++;
          }
          S.docUsage = null; toast(n + " document" + (n === 1 ? "" : "s") + " cleared out."); render();
        });
      });
      break;
    }
    case "vchAuto": setAutoNumbering(); break;
    case "vchTallyDone": { const co = CO(); co.vchNumbering = "tally"; co.vchAutoAt = new Date().toISOString(); Store.saveCompany(co); toast("TDS Desk will leave voucher numbers to Tally."); render(); break; }
    case "vchUseBillNo": { const co = CO(); co.vchNumbering = ""; Store.saveCompany(co); toast("TDS Desk will send the supplier\u2019s bill number as the voucher number."); render(); break; }
    case "revFClear": S.revF = {}; S.revQuery = ""; S.revSel = new Set(); render(); break;
    case "billBackAll": {
      const list = Object.values(D().entries).filter(e => e.status === "approved" && !e.exportedAt);
      list.forEach(e => unapply(e, S.coId)); list.forEach(e => Store.saveEntry(S.coId, e));
      refreshStats(S.coId); toast(list.length + " bill" + (list.length === 1 ? "" : "s") + " back in To review."); render(); break;
    }
    case "revDelete": {
      const ids = Array.from(S.revSel || []).filter(id => D().entries[id] && !D().entries[id].exportedAt);
      if (!ids.length) break;
      askConfirm({title: "Delete " + ids.length + " bill" + (ids.length === 1 ? "" : "s") + "?", ok: "Delete", body: '<p class="note">The files can be uploaded again later.</p>'}).then(ok => {
        if (!ok) return;
        ids.forEach(id => { const e = D().entries[id]; if (!e) return; if (e.status === "approved") unapply(e, S.coId); removeEntry(e); });
        S.revSel = new Set(); S.drawerOpen = false; refreshStats(S.coId); toast(ids.length + " deleted."); render();
      });
      break;
    }
    case "billRetry": {
      const ids = ((S.billPost && S.billPost.failed) || []).map(f => f.id).filter(Boolean);
      let again = 0, stuck = [];
      ids.forEach(id => { const e = D().entries[id]; if (!e || e.status !== "draft") return; const c = compute(e); if (c.missing.length){ stuck.push(e.x.invoiceNo || e.x.vendorName); return; }
        e.vchNo = e.vchNo || ""; const keepSel = S.selected; approve(e); S.selected = keepSel; again++; });
      if (stuck.length) toast(stuck.length + " still need something filled in: open them in To review.");
      if (again) postBillsToTally();
      break;
    }
    case "billUnpost": {
      const list = Object.values(D().entries).filter(e => e.exportedAt && e.tally && e.tally.guid).sort(byDate);
      if (!list.length){ toast("Nothing here can be taken back automatically."); break; }
      askConfirm({title: "Take an entry back out of Tally", ok: "Choose this one", wide: true,
        body: '<p class="note">The voucher is deleted from Tally and the bill comes back here as waiting.</p><div class="bk-form one"><label><span>Entry</span><select id="unpostPick">' +
          list.map(e => '<option value="' + e.id + '">' + esc(e.x.invoiceNo || "(no number)") + " \u00b7 " + esc(e.x.vendorName || "") + " \u00b7 " + INR.format(num(e.x.total)) + " \u00b7 " + esc((e.tally || {}).vchType || "") + " " + esc(e.tallyVchNo || "") + "</option>").join("") + "</select></label></div>",
        read: () => ({id: (document.getElementById("unpostPick") || {}).value})}).then(a => {
        if (!a || !a.data.id) return;
        const e0 = D().entries[a.data.id];
        if (!e0) return;
        unpostFromTally("bill", e0, S.coId).then(ok => {
          if (!ok) return;
          e0.exportedAt = null; e0.postVerified = false; e0.tally = null; e0.tallyVchNo = ""; e0.postNote = "";
          Store.saveEntry(S.coId, e0); refreshStats(S.coId); render();
        });
      });
      break;
    }
    case "billCheck": checkBillsInTally(); break;
    case "billCheckWaiting": checkBillsInTally(true); break;
    case "bridgeReadTest": {
      const co = CO(), o = co && Bridge.openFor(co);
      const name = o ? o.name : (Bridge.st.open[0] && Bridge.st.open[0].name);
      if (!name){ toast("Open a company in Tally first."); break; }
      S.readTest = {busy: true}; render();
      Bridge.call("/readtest?company=" + encodeURIComponent(name) + Bridge.pinQ(), null, 180000).then(j => { S.readTest = Object.assign({at: Date.now()}, j, {tests: [].concat(j.tests || [])}); render(); }, err => { S.readTest = {error: err.message}; render(); });
      break;
    }
    case "billRepost": {
      const ids = (S.billCheck && S.billCheck.missing) || [];
      ids.forEach(id => { const e = D().entries[id]; if (e){ e.exportedAt = null; e.postNote = ""; e.postVerified = false; e.tallyCheck = null; e.postUnconfirmed = null; e.postError = ""; Store.saveEntry(S.coId, e); } });
      S.billCheck = null; refreshStats(S.coId); toast(ids.length + " bills are waiting to be posted again."); render(); break;
    }
    case "bridgeDiag": Bridge.diagnose().then(() => Bridge.refresh()).then(() => render()); break;
    case "openSettings": S.settingsTab = S.settingsTab || null; S.firmMenu = false; S.tallyPanel = false; closeSwitcher(); S.view = "home"; S.homeTab = "rules"; S.arm = null; render(); window.scrollTo(0, 0); break;
    case "dlStandalone": downloadStandalone(); break;
    case "goReading": closeSwitcher(); S.view = "home"; S.homeTab = "rules"; render(); { const r = document.getElementById("readingPane"); if (r && r.scrollIntoView) r.scrollIntoView(); } break;
    case "testReader": testReader(); break;
    case "testOcr": testFreeOcr(); break;
    case "testGoogle": testGoogle(); break;
    case "saveGoogle": {
      const key = (document.getElementById("gKey").value || "").trim();
      if (!/^AIza[0-9A-Za-z_\-]{20,}$/.test(key)){ toast("That does not look like a Google API key (it starts with AIza)."); break; }
      lsSet("tdsdesk:gvision", JSON.stringify({key})); S.googleTest = null; toast("Google key saved in this browser."); render(); testGoogle(); break;
    }
    case "removeGoogle": try { localStorage.removeItem("tdsdesk:gvision"); } catch (err){} S.googleTest = null; toast("Google key removed from this browser."); render(); break;
    case "askPerm": askPermission(); break;
    case "toggleKey": S.apiKeyShown = !S.apiKeyShown; render(); break;
    case "saveKey": {
      const key = (document.getElementById("apiKey").value || "").trim();
      if (!/^sk-ant-/.test(key)){ toast("That does not look like a Claude API key (it starts with sk-ant-)."); break; }
      lsSet("tdsdesk:api", JSON.stringify({key, model:(document.getElementById("apiModel").value || "").trim() || API_DEFAULTS.model,
        carefulModel:(document.getElementById("apiCareful").value || "").trim() || API_DEFAULTS.carefulModel}));
      S.readBlocked = null; pickEngine(); S.testResult = null; toast("Key saved in this browser."); render(); testReader(); break;
    }
    case "removeKey": try { localStorage.removeItem("tdsdesk:api"); } catch (err){} pickEngine(); S.testResult = null; toast("Key removed from this browser."); render(); break;
    case "pasteOpen": S.pasteOpen = true; render(); { const b = document.getElementById("pasteBox"); if (b) b.focus(); } break;
    case "pasteClose": S.pasteOpen = false; render(); break;
    case "pasteAdd": addPasted(document.getElementById("pasteBox").value); break;
    case "notDup": if (e){ e.notDuplicate = true; if (e.status === "duplicate") e.status = "draft"; delete e.dupOf; Store.saveEntry(S.coId, e); S.filter = "draft"; refreshStats(S.coId); toast("Kept as a separate bill."); render(); } break;
    case "openOriginal": if (e && e.dupOf && D().entries[e.dupOf.entryId]){ const o = D().entries[e.dupOf.entryId]; S.filter = o.status; S.selected = o.id; render(); } break;
    case "clearJobs": { const keep = S.view === "company" ? (j => !(j.target === S.coId || j.cid === S.coId)) : (j => j.target !== "auto"); S.jobs = S.jobs.filter(j => keep(j) || ["waiting","checking","reading"].includes(j.status)); render(); } break;
    case "camera": pickMode = "company"; document.getElementById("camIn").click(); break;
    case "manual": { const n = newEntry("Manual entry"); D().entries[n.id] = n; S.selected = n.id; S.filter = "draft"; Store.saveEntry(S.coId, n); refreshStats(S.coId); render(); break; }
    case "approve": if (e) approve(e); break;
    case "reject": if (e){ if (e.docPath){ CloudDocs.remove(e.docPath); delete e.docPath; } setStatus(e, "rejected", "Marked as no entry needed."); } break;
    case "restore": if (e) setStatus(e, "draft"); break;
    case "undo": if (e) undoApproval(e); break;
    case "delete": if (e) removeEntry(e); break;
    case "addParty": { const id = "p-new-" + Date.now().toString(36); D().parties[id] = {id, name:"New deductee", pan:"", gstin:"", ledgerName:"", natureDefault:"", expenseLedger:"", ldcRate:"", ldcValidTo:"", ytd:{}}; S.partySel = id; Store.saveParty(S.coId, D().parties[id]); render(); break; }
    case "closeParty": S.partySel = null; render(); break;
    case "resetRules": S.firm.rules = {}; Store.saveFirm(); toast("Default rates and limits restored."); render(); break;
    case "delCo":
      if (S.arm !== "delCo"){ S.arm = "delCo"; render(); break; }
      { const name = CO().name, cid = S.coId; S.arm = null; S.coId = null; S.view = "home";
        Store.deleteCompany(cid).then(() => { toast(name + " deleted from the desk."); render(); }); render(); }
      break;
    case "clearSent":
      if (S.arm !== "clearSent"){ S.arm = "clearSent"; render(); break; }
      S.arm = null; clearSent(); break;
    case "xml": { const m = document.getElementById("markSent"); exportXml(m ? m.checked : true); break; }
    case "csv": exportCsv(); break;
  }
});
function saveNewCompany(){
  const name = (document.getElementById("ncName").value || "").trim();
  const gstin = (document.getElementById("ncGstin").value || "").trim().toUpperCase();
  if (!name){ toast("Enter the client name."); document.getElementById("ncName").focus(); return; }
  if (gstin && !gstinValid(gstin)){ toast("That GSTIN fails its check digit. Check each character or leave it blank."); return; }
  if (gstin && Object.values(S.companies).some(c => c.gstin === gstin)){ toast("A client with this GSTIN already exists."); return; }
  const copyEl = document.getElementById("ncCopy"), src = copyEl && copyEl.value ? S.companies[copyEl.value] : null;
  const co = newCompany(Object.assign(src ? {voucherType:src.voucherType, createOptional:src.createOptional, billwise:src.billwise, gst:src.gst, roundOff:src.roundOff, tdsLedgers:src.tdsLedgers, expenseLedgers:src.expenseLedgers} : {},
    {name, gstin, tallyName:(document.getElementById("ncTally").value || "").trim() || name, turnover10cr:document.getElementById("ncTurn").checked}));
  S.companies[co.id] = co; S.data[co.id] = {parties:{}, entries:{}, loaded:true};
  co.stats = {drafts:0, check:0, waiting:0, tdsFy:0, invoicesFy:0, records:1, fy:fyOf(null)};
  Store.saveCompany(co);
  S.addingCo = false;
  toast(name + " added.");
  openCompany(co.id);
}
let pickMode = "company";
function pickFiles(mode){ pickMode = mode; document.getElementById("fileIn").click(); }
async function handleFiles(files, mode){
  if (!files.length) return;
  if (mode === "company" && S.view === "company" && S.coId){
    enqueueFiles(files, S.coId);
  } else {
    if (!Object.keys(S.companies).length){ toast("Add a client first, so uploads have somewhere to go."); S.addingCo = true; render(); return; }
    enqueueFiles(files, "auto");
  }
}

document.addEventListener("keydown", ev => {
  const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey;
  if (S.switcher){
    const list = switcherList();
    if (k === "Escape"){ ev.preventDefault(); closeSwitcher(); return; }
    if (k === "ArrowDown"){ ev.preventDefault(); S.switcher.idx = Math.min(list.length - 1, S.switcher.idx + 1); renderSwitcher(); return; }
    if (k === "ArrowUp"){ ev.preventDefault(); S.switcher.idx = Math.max(0, S.switcher.idx - 1); renderSwitcher(); return; }
    if (k === "Enter"){ ev.preventDefault(); if (list[S.switcher.idx]) openCompany(list[S.switcher.idx].id); return; }
    if (k === "F3"){ ev.preventDefault(); return; }
    return;
  }
  if (k === "F3" || (ctrl && k.toLowerCase() === "k")){ ev.preventDefault(); openSwitcher(); return; }
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  const inField = /INPUT|SELECT|TEXTAREA/.test(tag);
  if (ctrl && k.toLowerCase() === "a" && !inField && S.view === "company" && S.tab === "invoices"){
    const e = curEntry();
    if (e && e.status === "draft" && !S.reading[e.id]){ ev.preventDefault(); approve(e); }
    return;
  }
  if (k === "Escape" && !inField && S.view === "company"){ goHome(); return; }
  if ((k === "Enter" || k === " ") && (ev.target.id === "drop" || ev.target.id === "dropAuto")){ ev.preventDefault(); pickFiles(ev.target.id === "drop" ? "company" : "auto"); }
});

document.addEventListener("input", ev => {
  const t = ev.target;
  if (t && t.dataset && t.dataset.r2f){
    const tab = S.r2Tab || "suppliers";
    S.r2F = Object.assign({}, S.r2F, {[tab]: Object.assign({}, (S.r2F || {})[tab], {[t.dataset.r2f]: t.value})});
    if (t.type === "search") later("r2f", render, 250); else render();
    return;
  }
  if (t && t.dataset && t.dataset.tdsf){
    const tab = S.tdsTab || "deductions";
    S.tdsFl = Object.assign({}, S.tdsFl, {[tab]: Object.assign({}, (S.tdsFl || {})[tab], {[t.dataset.tdsf]: t.value})});
    if (t.type === "search" || t.type === "text") later("tdsf", render, 250); else render();
    return;
  }
  if (t && t.id === "revq"){ S.revQuery = t.value; softRender(); return; }
  if (t && t.id === "txnq"){ S.txnQ = t.value; later("txnq", render, 250); return; }
  if (t && t.id === "fsq"){ S.fsQ = t.value; later("fsq", render, 250); return; }
  if (t && t.id === "misq"){ S.misQ = t.value; later("misq", render, 250); return; }
  if (t && t.id === "ledq"){ S.ledQ = t.value; later("ledq", render, 250); return; }
  if (t && t.id && /^(q24F|r1F|b2F)q$/.test(t.id)){ const k = t.id.slice(0, -1); S[k] = Object.assign({}, S[k], {q: t.value}); later(t.id, render, 250); return; }
  if (t && t.dataset){
    // the browser lowercases attribute names, so match without case
    const key = Object.keys(t.dataset).find(k => /^(q24f|r1f|b2f)./i.test(k));
    if (key){
      const which = key.toLowerCase().startsWith("q24f") ? ["q24F", 4] : key.toLowerCase().startsWith("r1f") ? ["r1F", 3] : ["b2F", 3];
      const field = key.slice(which[1]);
      S[which[0]] = Object.assign({}, S[which[0]], {[field]: t.value});
      render(); return;
    }
  }
  if (t && t.id === "tdsq"){ S.tdsF = Object.assign({}, S.tdsF, {q: t.value}); later("tdsq", render, 250); return; }
  if (t && t.dataset && t.dataset.tdsfsec !== undefined){ S.tdsF = Object.assign({}, S.tdsF, {section: t.value}); render(); return; }
  if (t && t.dataset && t.dataset.tdsfch !== undefined){ S.tdsF = Object.assign({}, S.tdsF, {challan: t.value}); render(); return; }
  if (t && t.dataset && t.dataset.tdsfpan !== undefined){ S.tdsF = Object.assign({}, S.tdsF, {pan: t.value}); render(); return; }
  if (t && t.dataset && t.dataset.gstym !== undefined){ S.gstYm = t.value; S.books.reco = null; render(); return; }
  if (t && t.dataset && t.dataset.gstreg !== undefined){ S.gstReg = t.value; S.books.reco = null; render(); return; }
  if (t && t.dataset && t.dataset.tdsfy !== undefined){ S.tdsFy = t.value; if (S.tdsView === "return") S.tdsView = "year"; render(); return; }
  if (t && t.dataset && t.dataset.tdsq !== undefined){ S.tdsQ = t.value; render(); return; }
  if (t && t.dataset && t.dataset.ledkind){ const m = S.books.map[t.dataset.ledkind]; if (m){ m.kind = t.value; m.byHand = true; if (m.kind !== "tds_payable") delete m.section;
    if (/^(gst|gst_common|ineligible)$/.test(m.kind)){ const gg = Books.guess(t.dataset.ledkind); if (!m.tax) m.tax = gg.tax || "IGST"; if (!m.side) m.side = gg.side || "input"; if (m.reg == null && gg.reg) m.reg = gg.reg; }
    S.books.mapV = (S.books.mapV || 0) + 1; S.books.reco = null; saveBooks(); render(); } return; }
  if (t && t.dataset && (t.dataset.ledtax || t.dataset.ledside || t.dataset.ledreg)){
    const key = t.dataset.ledtax || t.dataset.ledside || t.dataset.ledreg, m = S.books.map[key];
    if (m){
      if (t.dataset.ledtax) m.tax = t.value;
      if (t.dataset.ledside) m.side = t.value;
      if (t.dataset.ledreg) m.reg = t.value;
      m.byHand = true; S.books.mapV = (S.books.mapV || 0) + 1; S.books.reco = null; saveBooks(); render();
    }
    return;
  }
  if (t && t.dataset && t.dataset.ledsec){ const m = S.books.map[t.dataset.ledsec]; if (m){ m.section = t.value.toUpperCase(); m.byHand = true; later("ledsec", () => { saveBooks(); render(); }, 500); } return; }
  if (t && t.dataset && t.dataset.alloc){ S.books.alloc = S.books.alloc || {}; if (t.value) S.books.alloc[t.dataset.alloc] = t.value; else delete S.books.alloc[t.dataset.alloc]; saveBooks(); render(); return; }
  if (t && t.dataset && t.dataset.txnstatus !== undefined){ S.txnStatus = t.value; render(); return; }
  if (t && t.dataset && t.dataset.rf){ S.revF = S.revF || {}; S.revF[t.dataset.rf] = t.value; S.revSel = new Set(); softRender(); return; }
  if (t && t.dataset && ["email", "password", "firm", "name"].includes(t.dataset.cloud)){ S.cloudForm = Object.assign({}, S.cloudForm, {[t.dataset.cloud]: t.value}); }
  if (S.view === "company" && S.tab === "bank" && bankInput(t)) return;
  if (S.view === "company" && S.tab === "sales" && salesInput(t)) return;
  if (t.id === "swq"){ S.switcher.q = t.value; S.switcher.idx = 0; renderSwitcher(); return; }
  if (t.hasAttribute("data-hq")){ S.homeQuery = t.value; later("hq", render, 150); return; }
  const e = curEntry(), cid = S.coId;
  if (t.dataset.x && e && e.status === "draft"){
    if (t.dataset.x === "vendorName" && (!e.partyLedger || e.partyLedger === e.x.vendorName)) e.partyLedger = t.value;
    e.x[t.dataset.x] = /vendorGstin|vendorPan|buyerGstin/.test(t.dataset.x) ? t.value.toUpperCase() : t.value;
    if (e.uncertain) e.uncertain = e.uncertain.filter(k => k !== t.dataset.x);
    later("e" + e.id, () => Store.saveEntry(cid, e), 600);
    if (t.type !== "date") later("r", render, 350);
    return;
  }
  if (t.dataset.e && e && e.status === "draft" && t.type === "text"){ e[t.dataset.e] = t.value; later("e" + e.id, () => Store.saveEntry(cid, e), 600); later("r", render, 350); return; }
  const p = S.partySel && D().parties[S.partySel];
  if (t.dataset.p && p && t.tagName === "INPUT"){ p[t.dataset.p] = /^(pan|gstin)$/.test(t.dataset.p) ? t.value.toUpperCase().trim() : t.value; later("p" + p.id, () => Store.saveParty(cid, p), 600); return; }
  if (t.dataset.ytd && p){
    const fy = S.partyFy; p.ytd = p.ytd || {}; p.ytd[fy] = p.ytd[fy] || {};
    const cur = p.ytd[fy][t.dataset.ytd] || {credited:0, tdsBase:0};
    cur[t.dataset.k] = num(t.value); p.ytd[fy][t.dataset.ytd] = cur; later("p" + p.id, () => Store.saveParty(cid, p), 600); return;
  }
  const co = CO();
  if (t.dataset.c && co && t.type === "text"){
    setPath(co, t.dataset.c, /^(gstin|pan)$/.test(t.dataset.c) ? t.value.toUpperCase().trim() : t.value);
    later("c" + co.id, () => Store.saveCompany(co), 600);
    if (t.dataset.c === "name") later("top", renderTop, 200);
    return;
  }
  if (t.dataset.tdsled && co){ co.tdsLedgers[t.dataset.tdsled] = t.value; later("c" + co.id, () => Store.saveCompany(co), 600); return; }
  if (t.dataset.expled && co){ co.expenseLedgers[t.dataset.expled] = t.value; later("c" + co.id, () => Store.saveCompany(co), 600); return; }
  if (t.dataset.firm){ S.firm[t.dataset.firm] = t.value; later("firm", () => Store.saveFirm(), 600); document.getElementById("firmLine").textContent = t.value; return; }
  if (t.dataset.rule){ const r = S.firm.rules[t.dataset.rule] = S.firm.rules[t.dataset.rule] || {}; r[t.dataset.k] = num(t.value); later("firm", () => Store.saveFirm(), 600); return; }
});
function setPath(o, path, v){ const k = path.split("."); if (k.length === 2) o[k[0]][k[1]] = v; else o[k[0]] = v; }

document.addEventListener("change", ev => {
  if (ev.target && ev.target.id && ["booksIn", "mastersIn", "twoBIn", "filedIn"].includes(ev.target.id)){ booksChange(ev.target); return; }
  if (ev.target && ev.target.dataset && S.books && gstFixChange(ev.target)) return;
  if (ev.target && ev.target.id === "marketIn"){ const f = (ev.target.files || [])[0]; ev.target.value = ""; if (f) importMarketFile(f); return; }
  if (ev.target && ev.target.id === "salaryIn"){
    const f = (ev.target.files || [])[0]; ev.target.value = "";
    if (!f) return;
    const b = S.books; b.busy = "Reading " + f.name + "\u2026"; render();
    TDS24Q.fromFile(f).then(async r => {
      b.busy = "";
      if (r.error){ toast(r.error); render(); return; }
      b.salary = r.rows; await saveBooks();
      const noPan = r.rows.filter(x => !/^[A-Z]{5}\d{4}[A-Z]$/.test(x.pan)).length;
      toast(r.rows.length + " salary rows read" + (noPan ? ", " + noPan + " without a valid PAN" : "") + ".");
      render();
    }, e => { b.busy = ""; toast("Could not read that sheet: " + ((e && e.message) || e)); render(); });
    return;
  }
  const t = ev.target, e = curEntry(), cid = S.coId;
  if (t.dataset && t.dataset.adminplan){
    Cloud.rpc("admin_set_plan", {p_firm: t.dataset.adminplan, p_plan: t.value}).then(() => { toast("Plan changed."); loadAdminOverview(); }, e => toast(e.message));
    return;
  }
  if (t.dataset && t.dataset.revtds){ const e0 = D().entries[t.dataset.revtds]; if (e0){ revSet(e0, t.checked); render(); } return; }
  if (t.dataset && t.dataset.revnature){ const e0 = D().entries[t.dataset.revnature]; if (e0){ e0.natureId = t.value; e0.confirmType = false; Store.saveEntry(S.coId, e0); render(); } return; }
  if (t.dataset && t.dataset.cloud){
    const k = t.dataset.cloud;
    if (["email", "password", "firm", "name"].includes(k)){ S.cloudForm = Object.assign({}, S.cloudForm, {[k]: t.value}); } if (k === "auto"){ Cloud.setCfg({auto: t.checked}); startCloudSync(); } else if (k === "email") Cloud.setCfg({email: t.value.trim()}); return; }
  if (t.dataset && t.dataset.bridge){ const k = t.dataset.bridge; Bridge.setCfg({[k]: t.type === "checkbox" ? t.checked : t.value.trim()}); if (k !== "follow"){ Bridge.lastOpenKey = null; startBridgePolling(); } return; }
  if (t.dataset && t.dataset.bridgelink !== undefined){ const c = S.companies[t.value]; if (c){ c.tallyName = t.dataset.bridgelink; Store.saveCompany(c); Bridge.lastOpenKey = null; toast(c.name + " is linked to the Tally company " + c.tallyName + "."); bridgeTick(false); render(); } return; }
  if (t.hasAttribute && t.hasAttribute("data-picktally")){ const co = CO(); if (co && t.value){ co.tallyName = t.value; Store.saveCompany(co); Bridge.lastOpenKey = null; render(); } return; }
  if (S.view === "company" && S.tab === "bank" && bankChange(t)) return;
  if (S.view === "company" && S.tab === "sales" && salesChange(t)) return;
  if (t.dataset.actToggle === "askClaudeNew"){ S.askClaudeNewSupplier = t.checked; lsSet("tdsdesk:askClaudeNew", t.checked ? "1" : ""); render(); return; }
  if (t.dataset.actToggle === "freeFirst"){ S.freeFirst = t.checked; lsSet("tdsdesk:freeFirst", t.checked ? "1" : "0"); render(); return; }
  if (t.dataset.actToggle === "cloudDocs"){ S.firm.cloudDocs = t.checked; Store.saveFirm(); toast(t.checked ? "Documents will be kept in the firm account." : "Documents stay on this computer only."); render(); return; }
  if (t.dataset && t.dataset.firmset === "docYears"){ S.firm.docYears = num(t.value); Store.saveFirm(); render(); return; }
  if (t.dataset.actToggle === "splitPdf"){ S.splitPdf = t.checked; lsSet("tdsdesk:splitPdf", t.checked ? "1" : ""); return; }
  if (t.id === "fileIn" || t.id === "camIn"){ const files = Array.from(t.files || []); t.value = ""; handleFiles(files, pickMode); return; }
  if (t.dataset.assign){ assignInbox(t.dataset.assign, t.value); return; }
  if (t.dataset.x === "invoiceDate" && e && e.status === "draft"){ e.x.invoiceDate = t.value; if (e.uncertain) e.uncertain = e.uncertain.filter(k => k !== "invoiceDate"); Store.saveEntry(cid, e); render(); return; }
  if (t.dataset.gst && e && e.status === "draft"){
    const k = t.dataset.gst, co0 = CO(cid);
    if (k === "rcm"){
      if (t.checked){ const sg = suggestRcm(e, co0); const cat = (e.rcm && e.rcm.cat) || (sg && sg.cat) || "other"; e.rcm = {on:true, cat, rate:catRate(cat), inter:null}; }
      else { e.rcm = Object.assign({}, e.rcm || {}, {on:false}); e.rcmDismissed = true; }
    }
    if (k === "rcmCat"){ e.rcm.cat = t.value; e.rcm.rate = catRate(t.value); }
    if (k === "rcmRate") e.rcm.rate = num(t.value);
    if (k === "rcmInter") e.rcm.inter = t.checked;
    if (k === "block"){ const sg = suggestBlock(e, co0); e.itcBlock = {on: t.checked, cat: (e.itcBlock && e.itcBlock.cat) || (sg && sg.cat) || BLOCK_CATS[0].id}; if (!t.checked) e.blockDismissed = true; }
    if (k === "blockCat") e.itcBlock = {on:true, cat:t.value};
    Store.saveEntry(cid, e); refreshStats(cid); render(); return;
  }
  if (t.dataset.gstrule && CO()){ const co = CO(); co.gstBlock = co.gstBlock || {}; co.gstBlock[t.dataset.gstrule] = t.value; Store.saveCompany(co); render(); return; }
  if (t.hasAttribute("data-bookTds") && e && e.status === "draft"){
    const c0 = compute(e, cid);
    if (t.checked && c0.tdsWould <= 0){ e.tdsAlways = true; e.tdsSkip = null; e.tdsForce = true; Store.saveEntry(cid, e); render(); return true; }
    if (!t.checked && e.tdsAlways && c0.tdsWould > 0 && !c0.skip){ e.tdsAlways = false; Store.saveEntry(cid, e); render(); return true; }
    if (t.checked){
      // book it: clear a bill-level choice, or override a supplier/client setting for this bill
      if (e.tdsSkip) e.tdsSkip = null;
      if (c0.skip && c0.skip.from !== "bill") e.tdsForce = true;
      if (!compute(e, cid).skip) e.tdsForce = e.tdsForce || false;
    } else {
      e.tdsForce = false;
      if (!tdsSkipOf(e, CO(cid), c0.party)) e.tdsSkip = "pay";
    }
    Store.saveEntry(cid, e); refreshStats(cid); render(); return;
  }
  if (t.dataset.e && e && e.status === "draft"){
    if (t.type === "checkbox") e[t.dataset.e] = t.checked;
    else if (t.tagName === "SELECT"){
      const prev = e.natureId; e[t.dataset.e] = t.value;
      if (t.dataset.e === "natureId") e.confirmType = false;
      if (t.dataset.e === "expenseLedger"){ e.expenseUserSet = true; e.expenseFrom = ""; }
      if (t.dataset.e === "natureId" && (!e.expenseLedger || e.expenseLedger === CO().expenseLedgers[prev])) e.expenseLedger = CO().expenseLedgers[t.value] || e.expenseLedger;
    }
    Store.saveEntry(cid, e); refreshStats(cid); render(); return;
  }
  if (t.hasAttribute("data-pnotds")){ const p = D().parties[S.partySel]; if (p){ p.noTds = t.checked; if (t.checked && !p.noTdsReason) p.noTdsReason = "na"; Store.saveParty(cid, p); refreshStats(cid); render(); } return; }
  if (t.dataset && t.dataset.docqmove !== undefined && t.value){ assignDocq(t.dataset.docqmove, t.value); return true; }
  if (t.hasAttribute("data-ptransporter")){ const p = D().parties[S.partySel]; if (p){ p.transporter = t.checked; Store.saveParty(S.coId, p); render(); } return true; }
  if (t.hasAttribute("data-pnotdsreason")){ const p = D().parties[S.partySel]; if (p){ p.noTdsReason = t.value; Store.saveParty(cid, p); render(); } return; }
  if (t.dataset.p === "natureDefault"){ const p = D().parties[S.partySel]; if (p){ p.natureDefault = t.value; Store.saveParty(cid, p); render(); } return; }
  if (t.dataset.p && S.partySel){ render(); return; }
  if (t.hasAttribute("data-pfy")){ S.partyFy = t.value; render(); return; }
  const co = CO();
  if (t.dataset.c && co){
    if (t.type === "checkbox") co[t.dataset.c] = t.checked;
    else if (t.tagName === "SELECT") co[t.dataset.c] = t.value;
    else if (t.dataset.c === "gstin"){
      const g = t.value.toUpperCase().trim();
      if (g && !gstinValid(g)) toast("That GSTIN fails its check digit. Check each character.");
      else if (g && Object.values(S.companies).some(c => c.id !== co.id && c.gstin === g)) toast("Another client already has this GSTIN.");
      if (GSTIN_RE.test(g) && !co.pan) co.pan = g.slice(2, 12);
      else if (GSTIN_RE.test(g) && co.pan && String(co.pan).toUpperCase() !== g.slice(2, 12)) toast("This GSTIN\u2019s PAN is " + g.slice(2, 12) + ", but the client\u2019s PAN is " + co.pan + ". Correct one of them.");
    }
    else if (t.dataset.c === "pan"){
      const p0 = t.value.toUpperCase().trim(), g0 = String(co.gstin || "").toUpperCase();
      if (p0 && GSTIN_RE.test(g0) && g0.slice(2, 12) !== p0) toast("The client\u2019s GSTIN " + g0 + " carries PAN " + g0.slice(2, 12) + ", not " + p0 + ". Correct one of them.");
    }
    Store.saveCompany(co); refreshStats(co.id); render(); return;
  }
  if (t.dataset.rule || t.dataset.firm){ Store.saveFirm(); return; }
});
document.addEventListener("dragover", ev => { const d = ev.target.closest && ev.target.closest("#drop,#dropAuto,#bankDrop,.bk"); if (d){ ev.preventDefault(); d.classList.add("over"); } });
document.addEventListener("dragleave", ev => { const d = ev.target.closest && ev.target.closest("#drop,#dropAuto,#bankDrop"); if (d) d.classList.remove("over"); });
document.addEventListener("drop", ev => {
  const sd = ev.target.closest && ev.target.closest("#salesDrop, .sl");
  if (sd && S.tab === "sales"){ ev.preventDefault(); sd.classList.remove("over"); uploadSales(Array.from(ev.dataTransfer.files || []).filter(f => isPdf(f) || isImage(f))); return; }
  const bd = ev.target.closest && ev.target.closest("#bankDrop, .bk");
  if (bd){ ev.preventDefault(); bd.classList.remove("over"); const was = S.step; Promise.resolve(uploadStatements(Array.from(ev.dataTransfer.files || []).filter(isBankFile))).then(() => { if (was === "collect" && S.step === "collect") goStep("review", "bank"); }); return; }
  const d = ev.target.closest && ev.target.closest("#drop,#dropAuto");
  if (!d) return;
  ev.preventDefault(); d.classList.remove("over");
  handleFiles(Array.from(ev.dataTransfer.files || []), d.id === "drop" ? "company" : "auto");
});

document.addEventListener("mousedown", ev => {
  if (!S.colPop) return;
  const t = ev.target;
  if (t.closest && (t.closest("#colpop") || t.closest("[data-colf]"))) return;
  S.colPop = null; render();
}, true);
document.addEventListener("keydown", ev => {
  if (!S.colPop) return;
  if (ev.key === "Escape"){ ev.preventDefault(); ev.stopImmediatePropagation(); S.colPop = null; render(); }
  else if (ev.key === "Enter" && ev.target.closest && ev.target.closest("#colpop")){ ev.preventDefault(); ev.stopImmediatePropagation(); colPopApply(false); }
}, true);
document.addEventListener("input", ev => {
  const t = ev.target;
  if (!t || !t.closest || !t.closest("#colpop")) return;
  ev.stopImmediatePropagation();
  if (t.hasAttribute("data-cpauto")){ S.colAuto = t.checked; lsSet("tdsdesk:colauto", t.checked ? "1" : "0"); if (t.checked) colPopApply(false, true); else render(); return; }
  if (t.hasAttribute("data-cpsearch")){
    const q = t.value.trim().toLowerCase();
    if (S.colPop) S.colPop.search = t.value;
    t.parentNode.querySelectorAll(".cp-item").forEach(it => { it.style.display = !q || it.textContent.toLowerCase().includes(q) ? "" : "none"; });
    return;
  }
  if (!S.colAuto) return;
  if (t.type === "checkbox" || t.type === "radio" || t.tagName === "SELECT" || t.type === "date") colPopApply(false, true);
  else later("colauto", () => colPopApply(false, true), 350);      // as you type
}, true);
window.addEventListener("resize", () => placeColPop());
window.addEventListener("scroll", () => placeColPop(), true);
// Esc closes an open bill panel first, before any other shortcut sees the key
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && S.drawerOpen && !document.querySelector("#confirmBox[style*='flex']")){ ev.preventDefault(); ev.stopImmediatePropagation(); S.drawerOpen = false; render(); }
}, true);
/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */
(async function start(){
  S.splitPdf = lsGet("tdsdesk:splitPdf") === "1";
  S.freeFirst = lsGet("tdsdesk:freeFirst") !== "0";
  S.askClaudeNewSupplier = lsGet("tdsdesk:askClaudeNew") === "1";
  const samplePromise = (async () => { try { return window.claude && window.claude.use ? await window.claude.use("sample") : null; } catch(e){ return null; } })();
  if (!window.claude) S.sampleReady = false;
  await Store.init();
  try { await Store.loadFirm(); }
  catch (e){ S.firm = S.firm || Object.assign({}, DEFAULT_FIRM); toast("Saved data could not be loaded. Reload the page to try again."); }
  Object.keys(S.data).forEach(refreshStats);
  render();
  const last = lsGet("tdsdesk:last") || recentIds()[0];
  if (last && S.companies[last]) openCompany(last);
  S.sample = await samplePromise;
  if (S.sample){
    try { const lim = await S.sample.limits(); S.imgMax = lim && lim.images ? Math.min(6, lim.images.maxCount) : 0; } catch(e){ S.imgMax = 0; }
    try { const perms = await window.claude.use("permissions"); if (perms) S.samplePerm = await perms.state("sample"); } catch(e){}
    document.getElementById("fileIn").accept = "application/pdf,image/*,.jpg,.jpeg,.jfif,.png,.webp,.heic";
  }
  pickEngine();
  S.sampleReady = true;
  probeOcr();
  try { const last = JSON.parse(lsGet("tdsdesk:selftest") || "null"); if (last && last.results) S.selfTest = {busy: false, results: last.results, finished: last.finished, remembered: true}; } catch (e){}
  setTimeout(() => { if (typeof dailyGoogleCheck === "function") dailyGoogleCheck(); }, 20000);   // no OCR at start: it loads only when a bill needs it
  startBridgePolling();
  startCloudSync();
  if (!Cloud.on()) fetch(Cloud.cfg().url.replace(/\/+$/, "") + "/rest/v1/rpc/signup_info", {method: "POST", headers: {apikey: Cloud.cfg().key, "Content-Type": "application/json"}, body: "{}"})
    .then(r => r.json()).then(j => { S.signupInfo = j || {open: false}; render(); }, () => {});
  render();
})();
window.addEventListener("beforeunload", () => { if (S.coId) lsSet("tdsdesk:last", S.coId); });

