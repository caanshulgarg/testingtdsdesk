/* ================================================================== */
/* Firm account: the same data on every computer (Supabase)            */
/* ================================================================== */
const CLOUD_DEFAULT = {url: "https://nrtczucrlgalvtojwoes.supabase.co", key: "sb_publishable_HMkVf1jl9iOA8Xt4YaUezg_--4cIWVR", auto: true};
const CLOUD_CHUNK = 300;      // bank rows per record
const Cloud = {
  st: {state: "off", email: "", role: "", firm: "", lastSync: 0, pending: 0, error: "", busy: "", members: []},
  cfg(){ let c = {}; try { c = JSON.parse(lsGet("tdsdesk:cloud") || "{}"); } catch (e){}
    // a build tied to one database (the test site: staging) forgets an address kept from another, and its sign-in
    if (CLOUD_DEFAULT.lock && c.url && c.url !== CLOUD_DEFAULT.url){ c = {email: c.email || ""}; lsSet("tdsdesk:cloud", JSON.stringify(c)); lsDel("tdsdesk:cloudsess"); }
    return Object.assign({}, CLOUD_DEFAULT, c); },
  setCfg(p){ lsSet("tdsdesk:cloud", JSON.stringify(Object.assign(this.cfg(), p))); },
  sess(){ let s = null; try { s = JSON.parse(lsGet("tdsdesk:cloudsess") || "null"); } catch (e){} return s; },
  setSess(s){ if (s) lsSet("tdsdesk:cloudsess", JSON.stringify(s)); else lsDel("tdsdesk:cloudsess"); },
  on(){ return !!(this.sess() && this.sess().access_token); },
  marks(){ let m = {}; try { m = JSON.parse(lsGet("tdsdesk:cloudmarks") || "{}"); } catch (e){} return m; },
  // removals the user asked for (review of 02-Oct-2026: a client missing from this browser after a reload was sent as
  // deleted, and blanked all three clients of a firm). Only what is on this list is ever sent as deleted.
  dels(){ let m = {}; try { m = JSON.parse(lsGet("tdsdesk:clouddels") || "{}"); } catch (e){} return m; },
  setDels(m){ lsSet("tdsdesk:clouddels", JSON.stringify(m)); },
  delete(kind, cid, id, why){ if (typeof Live === "object" && Live.applying) return; const d = this.dels(); d[kind + "|" + (cid || "") + "|" + id] = {at: new Date().toISOString(), why: String(why || "").slice(0, 200)}; this.setDels(d); },
  setMarks(m){ lsSet("tdsdesk:cloudmarks", JSON.stringify(m)); },
  async authCall(path, body){
    const c = this.cfg();
    const r = await fetch(c.url.replace(/\/+$/, "") + "/auth/v1/" + path, {method: "POST", headers: {apikey: c.key, "Content-Type": "application/json"}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || ("Sign-in failed (" + r.status + ")"));
    return j;
  },
  // through the sign-in function, which counts wrong passwords and locks the account after 5 (review item 21);
  // straight at Supabase Auth where that function is not deployed (the lock is then kept by the token hook alone)
  async signInCall(email, password){
    const c = this.cfg();
    let r;
    try { r = await fetch(c.url.replace(/\/+$/, "") + "/functions/v1/signin", {method: "POST", headers: {apikey: c.key, "Content-Type": "application/json"}, body: JSON.stringify({email, password})}); }
    catch (e){ r = null; }
    if (!r || r.status === 404) return this.authCall("token?grant_type=password", {email, password});
    const j = await r.json().catch(() => null);
    // an answer that is not the sign-in function's own (the gateway's "function not found", a proxy page): sign in as before
    if (!j || (!r.ok && !("ok" in j)) || (r.ok && !j.access_token)) return this.authCall("token?grant_type=password", {email, password});
    if (!r.ok) throw new Error(j.error || ("Sign-in failed (" + r.status + ")"));
    return j;
  },
  async signIn(email, password){
    const j = await this.signInCall(String(email).trim(), password);
    this.setSess({access_token: j.access_token, refresh_token: j.refresh_token, at: Date.now(), expires_in: j.expires_in || 3600, email: (j.user && j.user.email) || email, user_id: j.user && j.user.id});
    this.setCfg({email: String(email).trim()});
    if (await this.checkMfa()) return true;      // the code is asked for before anything of the firm is shown
    await this.whoAmI();
    return true;
  },
  // A new access token from the refresh token. One refresh at a time: requests that fail together (opening a bill
  // fetches its document while the sync runs) share it, and a token another tab has refreshed meanwhile is used as
  // it is. Two refreshes with the same refresh token can make Supabase end the session (review: signed out after
  // the page was left idle). used: the token a failed request carried; skipped when the session already has a newer one.
  refreshToken(used){
    const s0 = this.sess();
    if (used && s0 && s0.access_token && s0.access_token !== used) return Promise.resolve();
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      const s = this.sess();
      if (!s || !s.refresh_token) throw new Error("Signed out");
      const j = await this.authCall("token?grant_type=refresh_token", {refresh_token: s.refresh_token});
      const now = this.sess();
      if (!now || now.refresh_token !== s.refresh_token) return;      // signed out, or another tab got there first
      this.setSess(Object.assign({}, s, {access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token, at: Date.now(), expires_in: j.expires_in || 3600}));
    })().finally(() => { this._refreshing = null; });
    return this._refreshing;
  },
  // before a request: a token that has run out, or will within two minutes, is refreshed first (a page left idle for
  // an hour no longer sends an expired token and depends on the 401 to recover)
  async fresh(){
    const s = this.sess();
    if (!s || !s.refresh_token) return;
    const until = num(s.at) + (num(s.expires_in) || 3600) * 1000;
    if (Date.now() > until - 120000) await this.refreshToken();
  },
  signOut(){ try { Live.stop(); } catch (e){} this.setSess(null); this.st = {state: "off", email: "", role: "", firm: "", lastSync: 0, pending: 0, error: "", busy: "", members: []}; },
  async api(path, opts, retry){
    if (!retry) await this.fresh().catch(() => {});
    const c = this.cfg(), s = this.sess();
    if (!s) throw new Error("Signed out");
    opts = opts || {};
    const headers = Object.assign({apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, opts.headers || {});
    const r = await fetch(c.url.replace(/\/+$/, "") + "/rest/v1/" + path, {method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined});
    if (r.status === 401 && !retry){ await this.refreshToken(s.access_token); return this.api(path, opts, true); }
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
  // a settings page with unsaved changes (Drafts, src/js/60): the cloud gets the saved values, not the draft
  const view = (kind, id, client_id, data) => typeof Drafts === "object" ? Drafts.view(kind, id, data, client_id) : data;
  const add = (kind, id, client_id, data) => out.push({kind, id, client_id: client_id || "", data: view(kind, id, client_id, data)});
  // an empty firm record (a reload with nothing kept here) is never sent: it would replace the firm's name and rules
  const f = S.firm || {}, filled = Object.keys(f).some(k => { const v = f[k]; return v != null && v !== "" && !(typeof v === "object" && !Object.keys(v).length); });
  if (filled && String(f.firmName || "").trim()) add("firm", "firm", "", S.firm);
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
// The last copy of each record this computer and the server agreed on (sent from here, or taken from the server), kept
// in memory as JSON: the base cloudApplyNow merges against when a copy comes in over a change made here and not yet
// sent (owner, 04-Oct-2026). Clients keep theirs in BankDB (ClientBase).
const CloudBase = new Map();
const CLOUD_BASE_SEED = new Set(["entry", "party", "unsorted", "sales", "firm"]);
function cloudBaseSet(k, json){ if (!/^(client|inbox)\|/.test(k)) CloudBase.set(k, json); }
// changes since the last sync (and anything deleted here)
function cloudChanges(){
  const marks = Cloud.marks(), snap = cloudSnapshot(), now = [], seen = {};
  snap.forEach(r => {
    const k = cloudKey(r), json = JSON.stringify(r.data), h = fpHash(json);
    seen[k] = h;
    if (marks[k] !== h) now.push(Object.assign({}, r, {hash: h, json}));
    else if (r.kind === "client") ClientBase.seed(r.id, r.data);   // in step with the server: that copy is its base
    else if (CLOUD_BASE_SEED.has(r.kind) && !CloudBase.has(k)) CloudBase.set(k, json);
  });
  // Nothing is ever deleted because it is missing here: a reload with empty storage, a client not loaded yet or a bank
  // not open all look like absence. A record is sent as deleted only when the user removed it (Cloud.delete), and the
  // server keeps its last data even then (migration-19).
  const dels = Cloud.dels(), gone = [];
  Object.keys(dels).forEach(k => {
    if (k in seen){ delete dels[k]; return; }                      // it came back (restored): not deleted
    if (marks[k] === "gone") return;
    const bits = k.split("|");
    gone.push({kind: bits[0], client_id: bits[1] || "", id: bits.slice(2).join("|"), data: {}, deleted: true, hash: "gone", why: (dels[k] || {}).why || ""});
  });
  // the open statement now has fewer rows than before: its chunks past the end are sent empty, not deleted
  const b = S.bank && !S.bank.loading ? S.bank : null;
  if (b && b.cur && b.rows.length) Object.keys(marks).forEach(k => {
    const [kind, cid, ...rest] = k.split("|"), id = rest.join("|");
    if (kind !== "bank_rows" || cid !== b.cid || k in seen || marks[k] === "gone" || id.split(":")[1] !== b.cur) return;
    const h = fpHash(JSON.stringify({rows: []}));
    if (marks[k] !== h) now.push({kind, client_id: cid, id, data: {rows: []}, hash: h});
  });
  return {changes: now.concat(gone), seen};
}
// the deleted flag, with the reason where the server has the column (migration-19); nothing else of the row is sent
async function cloudMarkDeleted(path, why){
  const body = {deleted: true, delete_reason: String(why || "removed in the app").slice(0, 300)};
  try { await Cloud.api(path, {method: "PATCH", headers: {Prefer: "return=minimal"}, body}); }
  catch (e){ if (!/delete_reason|PGRST204|column/i.test(String(e && e.message || e))) throw e; await Cloud.api(path, {method: "PATCH", headers: {Prefer: "return=minimal"}, body: {deleted: true}}); }
}
function cloudDelsSent(rows){ const d = Cloud.dels(); let n = 0; rows.forEach(r => { if (r.deleted && d[cloudKey(r)]){ delete d[cloudKey(r)]; n++; } }); if (n) Cloud.setDels(d); }
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
  const cdel = clients.filter(r => r.deleted); clients.splice(0, clients.length, ...clients.filter(r => !r.deleted));
  for (const r of cdel){
    await cloudMarkDeleted("clients?firm_id=eq." + Cloud.st.firm + "&id=eq." + encodeURIComponent(r.id), r.why);
    marks[cloudKey(r)] = r.hash; Cloud.setMarks(marks); cloudDelsSent([r]);
  }
  // Client setup is merged into the server's copy, one client at a time, never sent whole (cloudPushClient)
  for (const r of clients){
    marks[cloudKey(r)] = await cloudPushClient(r, sendBatch);
    Cloud.setMarks(marks); cloudDelsSent([r]);
  }
  for (let i = 0; i < rest.length; i += 20){
    const part = rest.slice(i, i + 20);
    // deletions go on their own, as the flag only (a merge upsert of a partial row would need every column)
    const del = part.filter(r => r.deleted), up = part.filter(r => !r.deleted);
    if (up.length) await sendBatch("records", up.map(r => ({firm_id: Cloud.st.firm, kind: r.kind, id: r.id, client_id: r.client_id || "", data: r.data, deleted: false})));
    for (const r of del) await cloudMarkDeleted("records?firm_id=eq." + Cloud.st.firm + "&kind=eq." + encodeURIComponent(r.kind) + "&id=eq." + encodeURIComponent(r.id), r.why);
    part.forEach(r => { marks[cloudKey(r)] = r.hash; if (!r.deleted && r.json) cloudBaseSet(cloudKey(r), r.json); });
    Cloud.setMarks(marks); cloudDelsSent(part);
  }
  return changes.length;
}
// Client setup merged, never replaced (review of 02-Oct-2026: Testing AAD's "posting allowed to company", set at about
// 05:30 UTC, was wiped at 06:02 when a browser holding an older copy of the client sent its whole settings, which the
// server took as they were). Each computer keeps the last copy of a client it saw on the server (its base, in BankDB
// "cbase:<id>"). A save reads the server's copy, lays over it only what this computer changed since its base, and writes
// it on condition that the server's copy has not changed in between (else it reads and merges again). A value changed
// here and on the server since the base: this save's value. No base yet (the first save after this change): the
// server's values stand and this computer only adds what the server lacks.
const NOBASE = {};
function plainObj(v){ return !!v && typeof v === "object" && !Array.isArray(v); }
function sameVal(a, b){ return a === b || (a !== undefined && b !== undefined && stableStr(a) === stableStr(b)); }
function merge3(base, mine, theirs){
  if (base === NOBASE){
    if (plainObj(mine) && plainObj(theirs)){
      const out = Object.assign({}, theirs);
      Object.keys(mine).forEach(k => { if (mine[k] !== undefined) out[k] = k in theirs ? merge3(NOBASE, mine[k], theirs[k]) : mine[k]; });
      return out;
    }
    return theirs === undefined ? mine : theirs;
  }
  if (sameVal(mine, base)) return theirs;                        // not changed here: the server's value
  if (sameVal(theirs, base) || sameVal(mine, theirs)) return mine;  // changed here only
  if (plainObj(mine) && plainObj(theirs)){                       // changed in both places: setting by setting
    const b = plainObj(base) ? base : {}, out = {};
    new Set([...Object.keys(theirs), ...Object.keys(mine)]).forEach(k => { const v = merge3(b[k], mine[k], theirs[k]); if (v !== undefined) out[k] = v; });
    return out;
  }
  return mine;
}
const ClientBase = {
  async get(id){ try { const v = await BankDB.get("cbase:" + id); return v === undefined || v === null ? NOBASE : v; } catch (e){ return NOBASE; } },
  async set(id, data){ this.seeded.add(id); try { await BankDB.set("cbase:" + id, clone(data)); } catch (e){} },
  // a client in step with the server and with no base kept yet (the first sync after this change): its copy here is it
  seeded: new Set(),
  seed(id, data){
    if (this.seeded.has(id)) return;
    this.seeded.add(id);
    const copy = clone(data);
    this.get(id).then(b => { if (b === NOBASE) return BankDB.set("cbase:" + id, copy); }).catch(() => {});
  }
};
// the merged copy, kept on this computer too; returns the mark (fingerprint) of what is now here
function takeClientHere(id, data){
  const was = Live.applying; Live.applying = true;
  try { S.companies[id] = fixCompany(clone(data)); Store.saveCompany(S.companies[id]); } finally { Live.applying = was; }
  return fpHash(JSON.stringify(S.companies[id]));
}
async function cloudPushClient(r, sendBatch){
  const q = "clients?firm_id=eq." + Cloud.st.firm + "&id=eq." + encodeURIComponent(r.id);
  for (let tries = 0; tries < 5; tries++){
    const cur = ((await Cloud.api(q + "&select=data,updated_at,deleted")) || [])[0];
    const row = d => ({name: d.name || "", gstin: d.gstin || "", pan: d.pan || "", tally_name: d.tallyName || "", data: d, deleted: false});
    if (!cur){                                                    // a new client: sent as it is
      await sendBatch("clients", [Object.assign({firm_id: Cloud.st.firm, id: r.id}, row(r.data))]);
      await ClientBase.set(r.id, r.data);
      return r.hash;
    }
    if (cur.deleted){                                             // removed on another computer: not brought back by a save here
      const was = Live.applying; Live.applying = true;
      try { delete S.companies[r.id]; Store.put("companies/" + r.id, null); } finally { Live.applying = was; }
      return "gone";
    }
    const theirs = plainObj(cur.data) ? cur.data : {};
    const data = Object.keys(theirs).length ? merge3(await ClientBase.get(r.id), r.data, theirs) : r.data;
    if (sameVal(data, theirs)){ await ClientBase.set(r.id, theirs); return sameVal(data, r.data) ? r.hash : takeClientHere(r.id, theirs); }
    const out = await Cloud.api(q + "&updated_at=eq." + encodeURIComponent(cur.updated_at), {method: "PATCH", headers: {Prefer: "return=representation"}, body: row(data)});
    if (!out || !out.length) continue;                            // changed on the server in between: read and merge again
    const saved = plainObj(out[0].data) ? out[0].data : data;
    await ClientBase.set(r.id, saved);
    return sameVal(saved, r.data) ? r.hash : takeClientHere(r.id, saved);
  }
  throw new Error("The setup of " + ((r.data && r.data.name) || "a client") + " kept changing on another computer while it was being saved; it is saved at the next try.");
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
// Records from the cloud are written by other people (firm members, the inbox automation), so the
// identifiers the screens put into HTML attributes are cleaned on the way in: only letters, digits and _ - . : @
const SAFE_ID = /^[\w\-.:@]{1,160}$/;
const ID_KEYS = new Set(["id", "stId", "state", "cls", "kind", "vid", "cid", "client_id", "status", "level", "reg", "pos", "hsn"]);
function cleanIds(v, depth){
  if (depth > 12 || !v || typeof v !== "object") return v;
  if (Array.isArray(v)){ v.forEach(x => cleanIds(x, depth + 1)); return v; }
  for (const k of Object.keys(v)){
    const x = v[k];
    if (ID_KEYS.has(k) && typeof x === "string" && x && !SAFE_ID.test(x)) v[k] = x.replace(/[^\w\-.:@ ,]/g, "").slice(0, 160);
    else if (x && typeof x === "object") cleanIds(x, depth + 1);
  }
  return v;
}
function cloudRowOk(r){ return r && SAFE_ID.test(String(r.id || "")) && (!r.client_id || SAFE_ID.test(String(r.client_id))); }
async function cloudApply(rows){
  const was = Live.applying; Live.applying = true;          // what comes from the server is not sent back
  try { await cloudApplyNow(rows); } finally { Live.applying = was; }
}
async function cloudApplyNow(rows){
  const marks = Cloud.marks();
  rows = [].concat(rows || []).filter(cloudRowOk);
  rows.forEach(r => { if (r.data) cleanIds(r.data, 0); });
  const touchedBank = new Set(), touchedSales = new Set();
  const mine = new Map(), mineData = new Map();
  try { cloudSnapshot().forEach(r => { const k = cloudKey(r); mine.set(k, stableStr(r.data)); mineData.set(k, r.data); }); } catch (e){}
  // a sales list or bank statement with a save waiting here: written first, so the reload below does not lose it
  // (each helper looked up by name: the node tests load cloudApplyNow with only the functions they name)
  if (typeof cloudFlushListsBefore === "function") await cloudFlushListsBefore(rows);
  const baseSet = (k, json) => { if (typeof cloudBaseSet === "function") cloudBaseSet(k, json); };
  const baseGet = k => typeof CloudBase === "object" ? CloudBase.get(k) : undefined;
  const waiting = key => typeof pendingEdit === "function" && pendingEdit(key);
  const keepMark = new Map(), inPlace = new Set();
  let sendAfter = false;
  for (let r of rows){
    const k = cloudKey(r);
    if (!r.deleted && mine.has(k) && mine.get(k) === stableStr(r.data)){   // this computer's own save coming back
      marks[k] = fpHash(JSON.stringify(r.data));
      if (r.kind === "client") await ClientBase.set(r.id, r.data); else baseSet(k, JSON.stringify(r.data));
      continue;
    }
    // A copy from the server is not laid over a change made here and not yet sent (owner, 04-Oct-2026: on a bill, the
    // copy of the save before the last keystroke came back, replaced the invoice number here and became the sync mark,
    // so the full number was never sent). A change is not yet sent here when its save is still waiting (pendingEdit) or
    // the record here is no longer what was last sent or taken (its mark). Then the copy is merged as the client setup
    // is (merge3, against the last copy both had): what was changed here stays, what was changed only there comes in,
    // and the mark is kept, so the result is sent at the next push. The same item changed on both computers: the
    // later push wins, as everywhere else. Nothing changed here: the copy is taken as before. Removals still come in.
    if (!r.deleted && r.kind !== "client" && r.kind !== "inbox" && mineData.has(k)){
      const here = mineData.get(k), was = marks[k];
      const unsent = (r.kind === "entry" && waiting("e" + r.id)) || (!!was && was !== "gone" && was !== fpHash(JSON.stringify(here)));
      if (unsent){
        const base = baseGet(k);
        // no base kept (a change made before this page was opened): what is here is kept whole
        const data = base !== undefined && plainObj(here) && plainObj(r.data) ? merge3(JSON.parse(base), here, r.data) : here;
        baseSet(k, JSON.stringify(r.data));
        sendAfter = true;
        if (stableStr(data) === mine.get(k)) continue;              // nothing of theirs to take: the row is left, the mark kept
        keepMark.set(k, was); inPlace.add(k);
        r = Object.assign({}, r, {data: clone(data)});
      }
    }
    const markWas = marks[k];
    if (!r.deleted && r.kind !== "client") baseSet(k, JSON.stringify(r.data));
    if (r.kind !== "inbox") marks[k] = r.deleted ? "gone" : fpHash(JSON.stringify(r.data));   // inbox records are office automation's, never tracked for deletion
    const cid = r.client_id;
    if (r.kind === "firm"){ if (!r.deleted){ S.firm = firmMerge(S.firm, r.data); Store.saveFirm(); } }
    else if (r.kind === "client"){
      if (r.deleted){ delete S.companies[r.id]; Store.put("companies/" + r.id, null); }
      else {
        // a change made here and not yet sent is kept, laid over the server's copy (merge3); it is sent at the next save
        const here = S.companies[r.id], pending = here && markWas && markWas !== "gone" && markWas !== fpHash(JSON.stringify(here));
        const data = pending && plainObj(r.data) ? merge3(await ClientBase.get(r.id), here, r.data) : r.data;
        S.companies[r.id] = fixCompany(clone(data)); Store.saveCompany(S.companies[r.id]);
        await ClientBase.set(r.id, r.data);
        if (pending) marks[k] = markWas;
      }
    }
    else if (r.kind === "entry" || r.kind === "party"){
      if (!S.data[cid] || !S.data[cid].loaded){ try { await Store.loadCompany(cid); } catch (e){} }
      if (!S.data[cid]) S.data[cid] = {parties: {}, entries: {}, loaded: true};
      const bag = r.kind === "entry" ? S.data[cid].entries : S.data[cid].parties;
      if (r.deleted){ if (r.kind === "entry" && bag[r.id] && bag[r.id].fileHash) unregisterHash(cid, bag[r.id].fileHash); delete bag[r.id]; Store.put("companies/" + cid + "/" + (r.kind === "entry" ? "entries/" : "parties/") + r.id, null); }
      // a supplier's ledger confirmed here and newer is kept over an older or guessed one coming in (src/js/60)
      // a bill merged over a change typed here: the same object is updated, so the save still waiting for it saves the merge
      else if (r.kind === "entry" && inPlace.has(k) && bag[r.id]){ const t = bag[r.id]; Object.keys(t).forEach(x => delete t[x]); Object.assign(t, clone(r.data)); Store.saveEntry(cid, t); }
      else { bag[r.id] = r.kind === "party" && typeof partyKeepChoice === "function" ? partyKeepChoice(bag[r.id], clone(r.data)) : clone(r.data); if (r.kind === "entry") Store.saveEntry(cid, bag[r.id]); else Store.saveParty(cid, bag[r.id]); }
    }
    else if (r.kind === "unsorted"){ if (r.deleted) delete S.inbox[r.id]; else { S.inbox[r.id] = clone(r.data); Store.saveInbox(S.inbox[r.id]); } }
    else if (r.kind === "inbox"){ if (r.deleted) delete S.docq[r.id]; else S.docq[r.id] = Object.assign({}, r.data, {id: r.id, client_id: r.client_id || ""}); }
    else if (r.kind === "bank_meta"){ await cloudApplyBankMeta(cid, r); touchedBank.add(cid); }
    else if (r.kind === "bank_stmt" || r.kind === "bank_rows"){ await cloudApplyBankPart(r); touchedBank.add(cid); }
    else if (r.kind === "sales" || r.kind === "sales_cfg"){ await cloudApplySales(r); touchedSales.add(cid); }
  }
  keepMark.forEach((was, k) => { marks[k] = was; });
  Cloud.setMarks(marks);
  // what was kept here goes to the server once this copy is in (cloudSoon does nothing while it is being applied)
  if (sendAfter) setTimeout(() => { try { if (typeof cloudSoon === "function") cloudSoon(); } catch (e){} }, 50);
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
async function cloudFlushListsBefore(rows){
  try {
    const s = S.sales, b = S.bank;
    if (s && typeof salesSaveTimer !== "undefined" && salesSaveTimer && rows.some(r => /^sales/.test(r.kind) && r.client_id === s.cid)){
      clearTimeout(salesSaveTimer); salesSaveTimer = null; await BankDB.set("sales:" + s.cid, s.list);
    }
    if (b && b.cur && typeof bankSaveTimer !== "undefined" && bankSaveTimer && rows.some(r => /^bank_/.test(r.kind) && r.client_id === b.cid)){
      clearTimeout(bankSaveTimer); bankSaveTimer = null; await BankDB.set("stmt:" + b.cid + ":" + b.cur, b.rows);
      const st = b.stmts.find(x => x.id === b.cur);
      if (st && typeof countStates === "function"){ st.counts = countStates(b.rows); await BankDB.set("stmts:" + b.cid, b.stmts); }
    }
  } catch (e){}
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
  if (!Cloud.on() || cloudBusy || Cloud.st.mfa) return;
  if (!Cloud.st.firm){ try { await Cloud.whoAmI(); } catch (e){ Cloud.st.error = e.message; renderTop(); return; } }
  if (!Cloud.st.firm) return;
  cloudBusy = true;
  Cloud.st.busy = "Syncing\u2026"; Cloud.st.error = "";
  if (manual) render();
  try {
    const sent = await cloudPush();
    const got = await cloudPull();
    try { await BookSync.tick(); } catch (e){}
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
  Cloud.checkMfa().then(m => { if (m) render(); else startCloudSync2(); }, () => startCloudSync2());
}
function startCloudSync2(){
  loadAccount(true);
  cloudSync(false).then(() => { try { Live.start(); } catch (e){} });
  cloudTimer = setInterval(() => { if (document.visibilityState === "visible" && Cloud.cfg().auto !== false) cloudSync(false); }, 45000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Cloud.on() && Cloud.cfg().auto !== false) cloudSync(false); });
function whoChip(){
  if (!Cloud.on()) return "";
  return whoChipInner() + '<button class="tchip signout" data-act="signOutNow" title="Sign out of FinCom">\u23fb Sign out</button>';
}
function whoChipInner(){
  const a = S.account, who = a && a.me ? (a.me.name || a.me.email) : Cloud.st.email;
  return '<button class="tchip" data-act="openSettings" title="' + esc(Cloud.st.email) + '">' + esc(who) + (a && a.superadmin ? " \u00b7 administrator" : a && a.me ? " \u00b7 " + esc(a.me.role) : "") + "</button>";
}
function cloudChip(){
  if (!Cloud.on()) return "";
  const st = Cloud.st;
  const sv = Live.sv;
  if (st.state !== "signedout" && sv.state === "offline") return '<span class="tchip warn" title="Changes are kept on this computer and sent when it is back online">Offline \u00b7 changes kept here</span>';
  if (sv.state === "saving") return '<span class="tchip off">Saving\u2026</span>';
  if (st.busy) return '<span class="tchip off">Syncing\u2026</span>';
  if (st.state === "signedout") return '<button class="tchip bad" data-act="openSettings">Sign in again</button>';
  if (st.error) return '<button class="tchip warn" data-act="openSettings" title="' + esc(st.error) + '">Sync problem</button>';
  const mins = st.lastSync ? Math.round((Date.now() - st.lastSync) / 60000) : null;
  return '<span class="tchip ok" title="' + esc(st.email) + (st.lastSync ? " \u00b7 last sync " + fmtTime(st.lastSync) : "") + '">\u2601 ' + (sv.at ? "Saved " + fmtTime(sv.at) : "Shared") + (Live.st === "live" ? " \u00b7 live" : "") + "</span>";
}

/* ---------- plan, balance and charging ---------- */
const MODULE_ICON = {bills: "\u{1F9FE}", bank: "\u{1F3E6}", sales: "\u{1F4C4}", claude: "\u2728", vision: "\u{1F441}", tally: "\u{1F4D2}", cloud: "\u2601", clients: "\u{1F465}"};
Cloud.rpc = async function(name, args){ return this.api("rpc/" + name, {method: "POST", body: args || {}}); };
Cloud.fn = async function(name, body, retry){
  if (!retry) await this.fresh().catch(() => {});
  const c = this.cfg(), s = this.sess();
  if (!s) throw new Error("Sign in to the firm account first.");
  let r;
  // a request the browser stopped before the server answered (no connection, or this site not allowed by the
  // function): said in words, not the browser's "Load failed" / "Failed to fetch"
  try { r = await fetch(c.url.replace(/\/+$/, "") + "/functions/v1/" + name, {
    method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: JSON.stringify(body || {})}); }
  // kind "blocked" (review of 02-Oct-2026: the gateway did not allow staging.fincom.live, the browser stopped the call
  // and the bill only said "The Claude API refused the request")
  catch (e){
    const why = (e && e.message) || "no answer";
    throw Object.assign(new Error(name === "gateway" ? "Your browser could not reach FinCom\u2019s reading service (blocked or offline)."
      : "FinCom\u2019s server could not be reached from this page (" + why + "). Check the connection and try again; if it keeps happening, tell support which page you were on."),
      {kind: "blocked", status: 0, browserError: why});
  }
  if (r.status === 401 && !retry){ await this.refreshToken(s.access_token); return this.fn(name, body, true); }
  const j = await r.json().catch(() => ({}));
  // the gateway's kind, status, wait and its own words travel with the error (src/js/01 errCopy says them plainly)
  if (!r.ok || j.ok === false){
    const ra = j.retry_after != null ? j.retry_after : r.headers.get("Retry-After");
    throw Object.assign(new Error(j.error || ("Request failed (" + r.status + ")")), {reason: j.reason, balance: j.balance, kind: j.kind || "other",
      status: j.status != null ? j.status : r.status, retryAfter: ra != null && isFinite(Number(ra)) ? Number(ra) : null, serverError: j.error || "",
      detail: j.detail || "", model: j.model || "", category: j.category || ""});
  }
  return j;
};
async function loadAccount(quiet){
  if (Cloud.st.mfa) return null;                 // nothing of the firm before the two-step code
  setTimeout(() => loadDocq(true), 0);
  if (!Cloud.on()) return null;
  try {
    const a = await Cloud.rpc("my_account");
    S.account = a || null;
    // the firm's name is the firm account's (firms.name): shown in the firm record, never asked for again when it is there
    const fn = String(((a || {}).firm || {}).name || "").trim();
    if (fn && S.firm && S.firm.firmName !== fn){ S.firm.firmName = fn; Store.saveFirm(); }
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
/* ---------- the firm's own account screen ---------- */
/* ---------- superadmin: firms, credit, plans, prices, keys ---------- */
async function loadAdminOverview(quiet){
  if (!Cloud.on()) return;
  try {
    const d = await Cloud.rpc("admin_overview");
    S.adminData = d && d.firms ? d : null;
    if (!quiet) render();
  } catch (e){ if (!quiet) toast("Could not read the platform data: " + e.message); }
}

// where a link in an email should bring the person back: this page, without its #…
function appUrl(){ return location.origin + location.pathname; }
// An invite or reset link lands here with the session in the address (#access_token=…&type=invite|recovery):
// the person is signed in and asked to choose their password before anything else (review item 21)
function takeAuthLink(){
  const h = String(location.hash || "");
  if (!/access_token=/.test(h) || !/type=(invite|recovery|signup|magiclink)/.test(h)) return false;
  const q = new URLSearchParams(h.replace(/^#/, ""));
  try { history.replaceState(null, "", location.pathname + location.search); } catch (e){}
  Cloud.setSess({access_token: q.get("access_token"), refresh_token: q.get("refresh_token"), at: Date.now(), expires_in: num(q.get("expires_in")) || 3600, email: "", user_id: ""});
  S.setPassword = {type: q.get("type")};
  return true;
}
async function setPasswordGo(){
  const a = (document.getElementById("spw1") || {}).value || "", b = (document.getElementById("spw2") || {}).value || "";
  const f = S.setPassword || (S.setPassword = {});
  if (a.length < 10 || !/[A-Za-z]/.test(a) || !/\d/.test(a)){ f.error = "Use 10 characters or more, with letters and digits."; render(); return; }
  if (a !== b){ f.error = "The two passwords are not the same."; render(); return; }
  const c = Cloud.cfg(), s = Cloud.sess();
  Cloud.st.busy = "saving"; render();
  try {
    const r = await fetch(c.url.replace(/\/+$/, "") + "/auth/v1/user", {method: "PUT", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: JSON.stringify({password: a})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "The password could not be saved.");
    Cloud.setSess(Object.assign({}, s, {email: j.email || "", user_id: j.id || ""}));
    Cloud.setCfg({email: j.email || ""});
    S.setPassword = null; Cloud.st.busy = "";
    auditEvent("password_set", f.type || "");
    if (!(await Cloud.checkMfa())) await Cloud.whoAmI();
    render();
  } catch (e){ Cloud.st.busy = ""; f.error = e.message; render(); }
}

/* ---------- nothing is shown until someone signs in: the page is React (app/src/screens/SignIn.jsx) ---------- */
function signInNeeded(){
  if (window.claude) return false;                 // inside claude.ai, for trying things out
  if (S.setPassword) return true;                  // arrived from an invite or reset link: the password comes first
  if (Cloud.on()) return !!Cloud.st.mfa;           // signed in (works offline once signed in), unless the code is still due
  return Cloud.cfg().gate !== false;
}
Cloud.signUp = async function(d){
  const c = this.cfg();
  const r = await fetch(c.url.replace(/\/+$/, "") + "/functions/v1/signup", {method: "POST", headers: {apikey: c.key, "Content-Type": "application/json"}, body: JSON.stringify(d)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || "The account could not be made.");
  return j;
};


/* ---------- Client setup: React (app/src/screens/Settings.jsx) ---------- */

/* ---------- Client: send to Tally: React (app/src/screens/Post.jsx) ---------- */
function viewExport(){ return '<div data-react="Export"></div>'; }

/* ---------- Company switcher (F3) ---------- */
function switcherList(){
  const q = (S.switcher.q || "").trim().toLowerCase();
  const rec = recentIds();
  let list = sortedCompanies();
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || (c.gstin || "").toLowerCase().includes(q) || (c.tallyName || "").toLowerCase().includes(q));
  else list.sort((a, b) => { const ia = rec.indexOf(a.id), ib = rec.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name); });
  return list;
}
// the client switcher is drawn by React (app/src/Switcher.jsx), with its own keys
function renderSwitcher(){ if (window.FinComReact) FinComReact.redraw(); }
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
  // FinCom Bridge 2.1.3: the client's Tally computer brings in what changed in Tally since its last read (one light update)
  try { if (typeof TWake === "object") TWake.open(cid); } catch (e){}
  // round 17 (04-Oct-2026): a posting FinCom's cloud finished by Tally's reply while this client was not open is marked
  // on its bills and bank lines now (postReconcile, src/js/59: reads the finished postings, sends nothing to Tally)
  setTimeout(() => { try {
    if (typeof postReconcile !== "function" || typeof CloudJobs !== "object") return;
    if (CloudJobs.list) { if (postReconcile(cid) && S.coId === cid) render(); }
    else if (typeof CloudJobs.load === "function") Promise.resolve(CloudJobs.load()).then(() => render(), () => {});
  } catch (e){} }, 0);
  // 02-Oct-2026: the Tally company this client may post to, set by itself when it is clear (one linked, same GSTIN)
  setTimeout(() => { try { if (typeof autoPostTo === "function") autoPostTo(S.companies[cid]).catch(() => {}); } catch (e){} }, 0);
  // the client's ledger list, read on opening the client (from the cloud copy when linked, else the bridge); then the
  // Client setup ledgers of the wrong tax head or section, or not in Tally, are set to the ones that fit (and saved)
  if (typeof Ledgers === "object") Ledgers.load(cid).then(() => { if (S.coId === cid && Ledgers.cid() === cid && autoMapCompanyLedgers(CO(cid)).length) render(); }, () => {});
}
function goHome(){ closeSwitcher(); S.view = "home"; S.arm = null; render(); }

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */
const timers = {}, laterFns = {};
function later(key, fn, ms){
  clearTimeout(timers[key]); laterFns[key] = fn;
  timers[key] = setTimeout(() => { delete timers[key]; delete laterFns[key]; fn(); }, ms);
}
// a bill's typed change waits a moment before it is saved (billSaveLater): pendingEdit("e" + id) says one is waiting
// (cloudApplyNow then keeps it over a copy coming in), flushBillSaves() makes every waiting save now (leaving the page,
// the tab hidden, signing out), so a change typed in the last moment is never lost or left unsent
const billSaveKeys = new Set();
function pendingEdit(key){ return !!laterFns[key]; }
function billSaveLater(e, cid){ const key = "e" + e.id; billSaveKeys.add(key); later(key, () => { billSaveKeys.delete(key); Store.saveEntry(cid, e); }, 600); }
function flushBillSaves(){
  let n = 0;
  [...billSaveKeys].forEach(key => {
    billSaveKeys.delete(key);
    const fn = laterFns[key]; if (!fn) return;
    clearTimeout(timers[key]); delete timers[key]; delete laterFns[key];
    try { fn(); n++; } catch (e){}
  });
  return n;
}
// leaving the page or hiding the tab: the waiting bill saves are made, and sent to the firm account straight away
function flushBillSavesAndSend(){
  if (!flushBillSaves()) return;
  try { if (typeof Cloud === "object" && Cloud.on() && Cloud.st.firm && !Cloud.st.mfa && Cloud.cfg().auto !== false && typeof cloudPushNow === "function") cloudPushNow(); } catch (e){}
}
if (typeof window === "object" && typeof document === "object" && window.addEventListener){
  window.addEventListener("pagehide", flushBillSavesAndSend);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushBillSavesAndSend(); });
}
function curEntry(){ return S.view === "company" && S.selected ? D().entries[S.selected] : null; }

/* ---------- editing a draft bill: called by the bill screen (React: app/src/screens/Bill.jsx) ---------- */
// a field read from the bill (e.x): saved a moment after typing stops; the date at once
function billSetX(e, key, value){
  if (!e || e.status !== "draft") return;
  const cid = S.coId;
  // with the client's ledger list here, the party ledger is matched again by itself (billAutoLedgers); without it, the name
  if (key === "vendorName" && !hasLedgerList() && (!e.partyLedger || e.partyLedger === e.x.vendorName)) e.partyLedger = value;
  e.x[key] = /vendorGstin|vendorPan|buyerGstin/.test(key) ? String(value).toUpperCase() : value;
  if (e.uncertain) e.uncertain = e.uncertain.filter(k => k !== key);
  if (key === "invoiceDate"){ Store.saveEntry(cid, e); render(); return; }
  billSaveLater(e, cid);
  later("r", render, 350);
  if (window.FinComReact) FinComReact.redraw();
}
// a ledger or the narration, as typed
function billSetText(e, key, value){
  if (!e || e.status !== "draft") return;
  const cid = S.coId;
  e[key] = value;
  // a ledger a person typed or picked is theirs: not changed by itself afterwards (empty: picked by itself again)
  if (key === "partyLedger"){ e.partyUserSet = !!String(value).trim(); e.partyAuto = !e.partyUserSet; e.partyFrom = ""; }
  if (key === "expenseLedger"){ e.expenseUserSet = !!String(value).trim(); e.expenseAuto = !e.expenseUserSet; e.expenseFrom = ""; }
  billSaveLater(e, cid); later("r", render, 350);
  if (window.FinComReact) FinComReact.redraw();
}
// a GST or TDS ledger chosen on the bill (key "gst:cgst", "rcm-in:sgst", "tds"): checked by compute against the line's
// tax head or section (a ledger of another head is refused there); empty: picked by itself again
function billSetTaxLed(e, key, value){
  if (!e || e.status !== "draft") return;
  const cid = S.coId;
  e.taxLed = Object.assign({}, e.taxLed || {});
  if (String(value || "").trim()) e.taxLed[key] = value; else delete e.taxLed[key];
  billSaveLater(e, cid); later("r", render, 350);
  if (window.FinComReact) FinComReact.redraw();
}
// a choice on the bill: the payment type, why TDS is not booked, earlier bills' TDS, a ledger picked from a list
function billSetChoice(e, key, value){
  if (!e || e.status !== "draft") return;
  const cid = S.coId, prev = e.natureId;
  e[key] = value;
  if (key === "natureId"){
    e.confirmType = false;
    if (!hasLedgerList() && (!e.expenseLedger || e.expenseLedger === CO().expenseLedgers[prev])) e.expenseLedger = CO().expenseLedgers[value] || e.expenseLedger;
  }
  if (key === "expenseLedger"){ e.expenseUserSet = true; e.expenseFrom = ""; }
  Store.saveEntry(cid, e); refreshStats(cid); render();
}
// who is signed in, for the audit trail
function whoAmI(){ return (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || "this computer"; }
// "Deduct anyway (expected to cross the limit)": a bill below the limits, TDS deducted on a person's say-so.
// Who ticked it and why is kept on the bill and in the audit trail (review item 3).
function billDeductAnyway(e, on, why){
  if (!e || e.status !== "draft") return;
  const cid = S.coId;
  if (on){
    e.tdsAlways = true; e.tdsSkip = null; e.tdsForce = true;
    e.tdsAlwaysBy = whoAmI(); e.tdsAlwaysAt = new Date().toISOString(); e.tdsAlwaysWhy = why || "expected to cross the yearly limit";
  } else { e.tdsAlways = false; e.tdsForce = false; e.tdsAlwaysBy = ""; e.tdsAlwaysAt = ""; e.tdsAlwaysWhy = ""; }
  auditEvent(on ? "tds_deduct_anyway" : "tds_deduct_anyway_off", (e.x.vendorName || "") + " bill " + (e.x.invoiceNo || e.id) + (on ? ": " + e.tdsAlwaysWhy : ""), cid);
  Store.saveEntry(cid, e); refreshStats(cid); render();
}
// "Deduct TDS on this bill"
function billBookTds(e, on){
  if (!e || e.status !== "draft") return;
  const cid = S.coId, c0 = compute(e, cid);
  if (on && c0.tdsWould <= 0) return billDeductAnyway(e, true);
  if (!on && c0.anyway) return billDeductAnyway(e, false);
  if (on){
    // book it: clear a bill-level choice, or override a supplier/client setting for this bill
    if (e.tdsSkip) e.tdsSkip = null;
    if (c0.skip && c0.skip.from !== "bill") e.tdsForce = true;
    if (!compute(e, cid).skip) e.tdsForce = e.tdsForce || false;
  } else {
    e.tdsForce = false;
    if (!tdsSkipOf(e, CO(cid), c0.party)) e.tdsSkip = "pay";
  }
  Store.saveEntry(cid, e); refreshStats(cid); render();
}
// the GST section: reverse charge (on, category, rate, inter-state) and blocked credit (on, category)
function billGst(e, k, v){
  if (!e || e.status !== "draft") return;
  const cid = S.coId, co0 = CO(cid);
  if (k === "rcm"){
    if (v){ const sg = suggestRcm(e, co0); const cat = (e.rcm && e.rcm.cat) || (sg && sg.cat) || "other"; e.rcm = {on:true, cat, rate:catRate(cat), inter:null}; }
    else { e.rcm = Object.assign({}, e.rcm || {}, {on:false}); e.rcmDismissed = true; }
  }
  if (k === "rcmCat"){ e.rcm.cat = v; e.rcm.rate = catRate(v); }
  if (k === "rcmRate") e.rcm.rate = num(v);
  if (k === "rcmInter") e.rcm.inter = v;
  if (k === "block"){ const sg = suggestBlock(e, co0); e.itcBlock = {on: v, cat: (e.itcBlock && e.itcBlock.cat) || (sg && sg.cat) || BLOCK_CATS[0].id}; if (!v) e.blockDismissed = true; }
  if (k === "blockCat") e.itcBlock = {on:true, cat:v};
  Store.saveEntry(cid, e); refreshStats(cid); render();
}
// the client's Tally ledger list, so a bill's entry can be checked line by line before approval (review item 2):
// straight from Tally when the bridge has the company open, else from a ledger list file exported from Tally
async function billReadLedgers(){
  const cid = S.coId, co = CO(cid);
  if (!S.bank || S.bank.cid !== cid || S.bank.loading) await loadBank(cid);
  if (bridgeLive(co) || (typeof TCloud === "object" && TCloud.on() && TCloud.has(cid))){ await Ledgers.refresh(cid); return; }
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".xlsx,.xls,.csv,.xml";
  inp.onchange = async () => { const f = inp.files && inp.files[0]; if (f && S.bank && S.bank.cid === cid){ await importLedgerList(f); render(); } };
  inp.click();
}
// "Booked before for this supplier": use that expense ledger
function billUseExpense(e, name){ if (e && e.status === "draft"){ e.expenseLedger = name; e.expenseUserSet = true; e.expenseFrom = ""; Store.saveEntry(S.coId, e); render(); } }
// a ledger not in Tally: use a suggested one (to) or create it; the same fix goes to every bill waiting with it
function billFixLedger(role, old, to){
  const cid = S.coId;
  const apply = name => {
    const e0 = curEntry();
    if (e0 && !e0.snapshot){
      if (role === "party"){ e0.partyLedger = name; e0.partyUserSet = true; e0.partyAuto = false; e0.partyFrom = ""; }
      else if (role === "expense"){ e0.expenseLedger = name; e0.expenseUserSet = true; e0.expenseAuto = false; e0.expenseFrom = ""; }
      Store.saveEntry(cid, e0);
    }
    const n = replaceLedgerInWaiting(cid, old, name, role);
    toast("\u201c" + name + "\u201d used" + (n > 1 ? " in " + n + " bills" : "") + (["gst", "tds", "roundoff", "rcm-in", "rcm-out"].includes(role) ? ", and saved in Client setup" : "") + ".");
    refreshStats(cid); render();
  };
  if (to) apply(to);
  else openCreateLedger(old, null, null, {group: role === "party" ? "Sundry Creditors" : role === "expense" ? "Indirect Expenses" : role === "roundoff" ? "Indirect Expenses" : "Duties & Taxes", onCreated: name => apply(name)});
}
/* ---------- navigation actions: called by the React screens and by the click handler below ---------- */
function goClient(to){
  const cid = S.coId;
  if (!cid) return;
  const go = () => {
    S.colPop = null; S.drawerOpen = false;
    if (to === "dash"){ S.tab = "dash"; S.step = null; render(); window.scrollTo(0, 0); return; }
    if (to === "inbox"){ S.tab = "clientInbox"; S.step = null; render(); window.scrollTo(0, 0); return; }
    if (to === "txn"){ S.tab = "txn"; S.step = null; render(); window.scrollTo(0, 0); return; }
    if (to === "books"){ S.tab = "books"; S.step = null; if (BOOKS_OWN_PAGES.includes(S.booksTab)) S.booksTab = S.booksLast || "import"; render(); window.scrollTo(0, 0); return; }
    if (to.indexOf("books:") === 0){ if (!BOOKS_OWN_PAGES.includes(S.booksTab)) S.booksLast = S.booksTab; S.tab = "books"; S.booksTab = to.slice(6); S.step = null; render(); window.scrollTo(0, 0); if (S.booksTab === "lookup") setTimeout(() => { const a = document.getElementById("lkAsk"); if (a && !(S.lk && S.lk.res)) a.focus(); }, 60); return; }
    if (to === "post"){ goStep("post", "bills"); return; }
    if (to === "bank" && (!S.bank || S.bank.cid !== cid)) loadBank(cid).then(() => render());
    goStep("review", to === "bills" ? "bills" : to);
  };
  if (S.view !== "company" || S.coId !== cid) openCompany(cid).then(go); else go();
}
// a section of the firm's Settings (the firm menu in the sidebar, and page links)
function goSettings(sec){ closeSwitcher(); S.firmMenu = false; S.tallyPanel = false; S.view = "home"; S.homeTab = "rules"; S.settingsTab = sec || null; S.step = null; S.arm = null; render(); window.scrollTo(0, 0); }
function navHome(tab){ if (tab === "help" && typeof SUP === "object" && !(S.view === "home" && S.homeTab === "help")) S.helpCtx = SUP.context(); closeSwitcher(); S.firmMenu = false; S.tallyPanel = false; S.view = "home"; S.homeTab = tab; S.step = null; S.addingCo = false; S.arm = null; if (tab === "rules") S.settingsTab = null; render(); window.scrollTo(0, 0); }
function goTab(tab){ S.tab = tab; S.step = null; S.arm = null; render(); }
function toggleSetup(){ S.step = null; S.tab = isSetupTab(S.tab) ? "invoices" : "settings"; render(); }
// a control drawn by React answers its own events; these handlers take the old screens, and the old pieces a React
// screen still shows inside it (marked data-legacy)
// delete a bill (asks first); not one already in Tally
// Delete is a soft delete (review item 24): only the firm's owner, with a reason; the bill is kept under "Deleted"
// with its document and can be restored. Working offline (no firm account) there is no owner to ask for.
function canDeleteBills(){
  if (!Cloud.on() || !S.account) return true;
  return S.account.superadmin === true || ((S.account.me || {}).role === "owner");
}
// round 14c (C5b): a bill with a live posting (in Tally, posted and not yet confirmed, or its FinCom id still held by the
// cloud's tally_post_ids / a finished posting of the cloud): the voucher Tally gave it, or "being checked"
function billLivePosting(e, cid){
  if (!e) return null;
  cid = cid || S.coId;
  const vch = (e.tallyVchNo || (e.tally && (e.tally.vchNo || e.tally.number)) || "").toString().trim();
  if (e.exportedAt || e.postUnconfirmed) return {vch};
  if (typeof postIdReleased === "function" && postIdReleased(e.id, cid) === false) return {vch};
  if (typeof CloudJobs === "object" && CloudJobs.list && CloudJobs.forClient(cid).some(j => CloudJobs.okIn(j).has(String(e.id)))){
    const r = [].concat(...CloudJobs.forClient(cid).map(j => j.results || [])).find(x => x && String(x.id) === String(e.id) && x.ok);
    return {vch: vch || (r && (r.vchNumber || r.vchNo)) || ""};
  }
  return null;
}
function billDelete(id){
  const e = D().entries[id];
  if (!e) return;
  if (!canDeleteBills()){ toast("Only the firm\u2019s owner can delete a bill. Mark it \u201cNo entry\u201d instead, or ask the owner."); return; }
  const live = billLivePosting(e, S.coId);
  if (live){
    const words = "This bill is posted to Tally (voucher id " + (live.vch ? esc(live.vch) : "being checked") + "). Deleting it here does not remove it from Tally. Delete anyway?";
    confirmTyped({title: "Delete a bill posted to Tally?", ok: "Delete anyway", body: '<p class="note" data-delete-posted="">' + words + "</p>"}).then(r => { if (r) billDeleteAsk(e); });
    return;
  }
  billDeleteAsk(e);
}
function billDeleteAsk(e){
  askConfirm({title: "Delete this bill?", ok: "Delete", danger: true,
    body: '<p class="note">' + esc(e.x.vendorName || e.fileName || "") + (e.x.invoiceNo ? " \u00b7 " + esc(e.x.invoiceNo) : "") + ". It moves to \u201cDeleted\u201d with its document, and can be restored from there.</p>" +
      '<label class="f" style="margin-top:8px"><span>Why is it deleted?</span><input type="text" id="delWhy" maxlength="200" placeholder="For example: uploaded twice, not this client\u2019s bill"></label>',
    read: () => ((document.getElementById("delWhy") || {}).value || "").trim(),
    validate: why => why.length < 3 ? "Write why the bill is deleted." : ""}).then(r => {
    if (!r) return;
    if (e.status === "approved") unapply(e, S.coId);
    if (S.revSel) S.revSel.delete(e.id);
    if (S.drawerOpen && S.selected === e.id) S.drawerOpen = false;
    softDeleteEntry(e, r.data); refreshStats(S.coId); toast("Deleted. It is under \u201cDeleted\u201d, where it can be restored."); render();
  });
}
function softDeleteEntry(e, why){
  e.deleted = {at: new Date().toISOString(), by: whoAmI(), reason: String(why || "").slice(0, 200), status: e.status};
  e.status = "deleted";
  unregisterHash(S.coId, e.fileHash);            // the same file can be uploaded again
  if (S.selected === e.id) S.selected = null;
  Store.saveEntry(S.coId, e);
  auditEvent("bill_delete", (e.x.vendorName || e.fileName || "") + " " + (e.x.invoiceNo || e.id) + ": " + e.deleted.reason, S.coId);
}
// back to To review (an approved bill was taken off its supplier's totals when deleted, so it is approved again)
function billRestore(id){
  const e = D().entries[id];
  if (!e || e.status !== "deleted") return;
  if (!canDeleteBills()){ toast("Only the firm\u2019s owner can restore a deleted bill."); return; }
  e.restored = {at: new Date().toISOString(), by: whoAmI(), was: e.deleted};
  // a bill already in Tally (cleared after 90 days) goes back to where it was, not to be posted again
  e.status = e.exportedAt && e.deleted && e.deleted.status ? e.deleted.status : "draft"; e.deleted = null;
  if (e.fileHash) registerHash(S.coId, e.fileHash, e.id);
  Store.saveEntry(S.coId, e);
  auditEvent("bill_restore", (e.x.vendorName || e.fileName || "") + " " + (e.x.invoiceNo || e.id), S.coId);
  S.filter = "draft"; S.selected = e.id; refreshStats(S.coId); toast("Restored to To review."); render();
}
// round 14c (C1, C2): the items of compute().missing that are a box on the bill (data-focus-field on its input), and the
// click that puts the cursor there; the first missing one is marked bk-missing when the bill opens
const MISSING_FIELD = {"invoice date": "invoiceDate", "supplier name": "vendorName", "taxable value": "taxable", "party ledger": "partyLedger", "expense ledger": "expenseLedger", "TDS ledger": "tdsLedger"};
function missingField(item){ return MISSING_FIELD[String(item || "").trim()] || ""; }
function firstMissingField(missing){ for (const m of (missing || [])){ const k = missingField(m); if (k) return k; } return ""; }
function focusBillField(key){
  const host = document.querySelector("#app aside.drawer") || document.getElementById("app") || document;
  const el = host.querySelector('[data-focus-field="' + key + '"]');
  if (!el) return false;
  try { el.scrollIntoView({block: "center"}); } catch (e){}
  el.focus();
  return true;
}
// C1 (the bulk buttons): why no bill is ready, counted from the drafts' missing lists: "No bill is ready: 2 need an invoice
// date, 1 a party ledger"
function noneReadyWords(rows){
  const counts = new Map();
  (rows || []).forEach(r => { const c = r.c || compute(r.e), seen = new Set(); (c.missing || []).forEach(m => { if (seen.has(m)) return; seen.add(m); counts.set(m, (counts.get(m) || 0) + 1); }); });
  if (!counts.size) return "";
  const art = m => /^(your |a |an |confirmation)/.test(m) ? m : /^[aeiou]/i.test(m) ? "an " + m : "a " + m;
  const parts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([m, n], i) => n + " " + (i === 0 ? (n === 1 ? "needs " : "need ") : "") + art(m));
  return "No bill is ready: " + parts.join(", ") + ".";
}
// the bills in the list as shown (Invoices.jsx orders them the same way), and a step to the next or previous one
function billList(){
  const all = Object.values(D().entries || {}), f = S.filter || "draft";
  return all.filter(e => e.status === f).sort((a, b) => (f === "draft" ? byDate(a, b) : byDate(b, a)));
}
function billStep(dir){
  const list = billList(); if (!list.length) return;
  const i = list.findIndex(e => e.id === S.selected);
  const next = list[Math.min(list.length - 1, Math.max(0, i < 0 ? 0 : i + dir))];
  if (next && next.id !== S.selected){ S.selected = next.id; render(); }
}
// an approved bill, not yet in Tally, back to To review (staying on the page it was sent back from)
function billBack(id){ const e = D().entries[id]; if (e){ const keep = S.tab; undoApproval(e); S.tab = keep; render(); } }
// a ledger Tally does not have, in the bills waiting to be posted: use the Tally ledger chosen instead
function billFixPick(old, role, to){
  if (!to){ toast("Choose the Tally ledger first."); return; }
  const n = replaceLedgerInWaiting(S.coId, old, to, role);
  toast("\u201c" + to + "\u201d used in " + n + " bill" + (n === 1 ? "" : "s") + " and saved for future bills.");
  refreshStats(S.coId); render();
}
// the bank's buttons (data-act="bank…" in the old bank screen), for a React screen
function bankAct(act){ return bankClick({dataset: {act}}); }
// open a kind of document (bills, bank, sales) at a step; the step the client is on when none is given
function goDocType(type, step){
  step = step || curStep();
  if (type === "bank" && (!S.bank || S.bank.cid !== S.coId)) loadBank(S.coId).then(() => { if (S.pendingBankFilter && S.bank){ S.bank.filter = S.pendingBankFilter; S.pendingBankFilter = null; } render(); });
  goStep(step === "post" && type === "sales" ? "review" : step, type);
}
// Transactions (app/src/screens/Txn.jsx): a kind of register, an entry opened where it is worked on, its document
function txnTabGo(k){ S.txnTab = k; render(); }
function txnGo(kind, id){
  if (kind === "bill"){ const e = D().entries[id]; if (e){ S.tab = "invoices"; S.filter = e.status === "duplicate" ? "duplicate" : e.status; S.reviewTable = e.status === "draft"; S.selected = id; S.drawerOpen = e.status === "draft"; render(); window.scrollTo(0, 0); } return; }
  if (kind === "sale"){ S.tab = "sales"; if (SL()) SL().openId = id; render(); window.scrollTo(0, 0); return; }
  S.tab = "bank"; if (S.bank){ S.bank.filter = "all"; S.bank.sticky.add(id); } render(); window.scrollTo(0, 0);
}
function txnOpenDoc(key, path, name){
  toast("Opening the document…");
  FileStore.get(S.coId, key, path || "", name || "").then(f => {
    if (f) window.open(URL.createObjectURL(f), "_blank");
    else toast("That document could not be found on this computer or in the firm account.");
  });
}
// a filter kept in S[id] (S.r1F, S.b2F, …): a box typed in (typed: the page follows a moment later) or a choice
function setFilter(id, key, val, typed){ S[id] = Object.assign({}, S[id], {[key]: val}); if (typed){ FinComReact.redraw(); later(id + "q", render, 250); } else render(); }
function clearFilter(id){ S[id] = {}; render(); }
// 2B reconciliation (app/src/screens/gst/TwoB.jsx): its tab, span, filters, and what the user settles about a document
// 27Q: a non-resident deductee's details for the file; 27EQ: a TCS ledger's collection code
function tdsNrSet(party, k, v){ const b = S.books; b.nrInfo = Object.assign({}, b.nrInfo); b.nrInfo[party] = Object.assign({}, b.nrInfo[party], {[k]: typeof v === "string" ? v.trim() : v}); saveBooks(); render(); }
function tdsTcsCode(ledger, code){ const b = S.books; b.tcsCodes = Object.assign({}, b.tcsCodes, {[ledger]: code}); saveBooks(); render(); }
function r2TabGo(id){ S.r2Tab = id; render(); }
function r2ScopeGo(mode){ S.r2Scope = mode; render(); }
function r2Filter(key, val, typed){ const tab = S.r2Tab || "suppliers"; S.r2F = Object.assign({}, S.r2F, {[tab]: Object.assign({}, (S.r2F || {})[tab], {[key]: val})}); if (typed){ FinComReact.redraw(); later("r2f", render, 250); } else render(); }
function r2FilterClear(tab){ S.r2F = Object.assign({}, S.r2F, {[tab]: {}}); render(); }
function r2SetTol(v){ const st = GST2B.state(); st.opt = Object.assign({}, st.opt, {tol: Math.max(0, num(v))}); saveBooks(); render(); }
// "Same": a likely pair confirmed; "Not the same" or "Unlink": the 2B document and those Tally entries are kept apart
function r2Confirm(key){ const st = GST2B.state(); st.confirm[key] = "yes"; saveBooks(); render(); }
function r2Unlink(key, ids){ const st = GST2B.state(); ids.forEach(id => { st.confirm[key + ">" + id] = "no"; }); delete st.link[key]; delete st.confirm[key]; saveBooks(); render(); }
// a 2B document not found in Tally, linked by hand to the entry it was booked as
function r2Link(key, id){ const st = GST2B.state(); if (id){ st.link[key] = [id]; delete st.confirm[key]; } saveBooks(); render(); }
function r2Tag(key, tag){ const st = GST2B.state(); if (tag) st.tag[key] = {tag, at: new Date().toISOString()}; else delete st.tag[key]; saveBooks(); render(); }
// a note to a supplier listing the invoices not in their return, to the clipboard (or on screen to copy)
function r2Copy(k){
  const reg = r2Reg(S.books), sc0 = r2Scope(), sc = GST2B.scope(reg, sc0.months);
  const s = GST2B.suppliers(sc).find(x => (x.gstin || x.party) === k); if (!s) return;
  const text = GST2B.followUp(s);
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Note copied: paste it into an email or WhatsApp."),
    () => printView("Note to " + s.party, "<pre style=\"white-space:pre-wrap;font:13px/1.5 inherit\">" + esc(text) + "</pre>"));
}
// one setting of a page kept in S (S.inregF, S.inregScope, …); typed: the page follows a moment later
function setAndShow(key, val, typed){ S[key] = val; if (typed){ FinComReact.redraw(); later(key, render, 250); } else render(); }
// a TDS return's pages (app/src/screens/TdsReturn.jsx): its tabs, filters, sorting, the rows opened, challans
function tdsTabGo(id){ S.tdsTab = id; render(); }
function tdsFilter(tab, key, val, typed){ S.tdsFl = Object.assign({}, S.tdsFl, {[tab]: Object.assign({}, (S.tdsFl || {})[tab], {[key]: val})}); if (typed){ FinComReact.redraw(); later("tdsf", render, 250); } else render(); }
function tdsFilterClear(tab){ S.tdsFl = Object.assign({}, S.tdsFl, {[tab]: {}}); render(); }
function tdsSortBy(tab, k){ const cur = (S.tdsSort || {})[tab] || {}; S.tdsSort = Object.assign({}, S.tdsSort, {[tab]: {k, d: cur.k === k ? -(cur.d || 1) : 1}}); render(); }
// one row opened under a table (a challan's deductions, a deductee's, an employee's months); a second click closes it
function tdsToggle(which, key){ S[which] = S[which] === key ? "" : key; render(); }
function tdsAlloc(rowId, chId){ S.books.alloc = S.books.alloc || {}; if (chId) S.books.alloc[rowId] = chId; else delete S.books.alloc[rowId]; saveBooks(); render(); }
function challanAdd(c){
  const bsr = String(c.bsr || "").trim(), ser = String(c.serial || "").trim(), dt = String(c.date || "").replace(/-/g, ""), tax = num(c.tax);
  if (!bsr || !ser || !dt || !tax){ toast("Fill the BSR code, serial number, date and tax."); return false; }
  S.books.challans = (S.books.challans || []).concat([{id: uid("ch"), bsr, serial: ser, date: dt, tax, interest: num(c.interest)}]);
  saveBooks(); toast("Challan added."); render(); return true;
}
function challanDelete(id){
  S.books.challans = (S.books.challans || []).filter(c => c.id !== id);
  Object.keys(S.books.alloc || {}).forEach(k => { if (S.books.alloc[k] === id) delete S.books.alloc[k]; });
  saveBooks(); render();
}
// a TDS payment voucher in Tally becomes a challan, once its BSR code and serial are given
function challanFromBooks(vid, bsr, ser){
  const p = TDS.paymentsFromBooks().find(x => x.vid === vid); if (!p) return false;
  if (!String(bsr || "").trim() || !String(ser || "").trim()){ toast("Fill the BSR code and the challan serial number first."); return false; }
  S.books.challans = (S.books.challans || []).concat([{id: uid("ch"), bsr: bsr.trim(), serial: ser.trim(), date: p.date, tax: p.tax, interest: 0, fromVoucher: p.vid}]);
  saveBooks(); toast("Challan added from the books."); render(); return true;
}
function certAdd(c){
  const party = String(c.party || "").trim();
  if (!party){ toast("Name the deductee as it appears in Tally."); return false; }
  S.books.certs = (S.books.certs || []).concat([{id: uid("ct"), party, pan: String(c.pan || "").toUpperCase().trim(), section: String(c.section || "").toUpperCase().trim(),
    certNo: String(c.certNo || "").trim(), rate: num(c.rate), from: c.from || "", to: c.to || ""}]);
  saveBooks(); toast("Certificate added."); render(); return true;
}
function certDelete(id){ S.books.certs = (S.books.certs || []).filter(c => c.id !== id); saveBooks(); render(); }
// a table printed, or saved as PDF, with the client's name above it
function printTable(id, title){
  const co = CO(), el = document.getElementById(id);
  printView(title || co.name, "<h1>" + esc(co.name) + '</h1><p class="note">' + esc(title || "") + " · printed " + fmtDate(new Date().toISOString().slice(0, 10)) + "</p>" + (el ? el.outerHTML : ""));
}
// TDS & GST from the books (app/src/screens/Books.jsx): a tab of the books; in TDS, a year, a quarter's return
// parts of the books with a sidebar entry of their own, outside "TDS & GST" (MIS, Accounts and Audit moved out: review item 7)
const BOOKS_OWN_PAGES = ["reports", "lookup", "letters", "mis", "fs", "audit"];
function booksTabGo(tab, gstPart){ S.booksTab = tab; if (gstPart) S.gstPart = gstPart; render(); }
function tdsNav(view){ S.tdsView = view; render(); window.scrollTo(0, 0); }
function tdsGo(fy, q, form){
  S.tdsFy = fy;
  if (q){ S.tdsQ = q; S.tdsForm = form || "26Q"; S.tdsView = "return"; S.tdsTab = ""; S.tdsOpen = ""; S.chOpen = ""; }
  else S.tdsView = "year";
  render(); window.scrollTo(0, 0);
}
function tdsSetFy(fy){ S.tdsFy = fy; if (S.tdsView === "return") S.tdsView = "year"; render(); }
// the review table (app/src/screens/Review.jsx)
function revPick(id, on){ S.revSel = S.revSel || new Set(); if (on) S.revSel.add(id); else S.revSel.delete(id); render(); }
function revPickAll(on){ S.revSel = new Set(on ? revFiltered().map(r => r.e.id) : []); render(); }   // only the rows the filter shows
function revOpen(id){ S.selected = id; S.drawerOpen = true; render(); }
function revApproveOne(id){ const e = D().entries[id]; if (e){ approve(e); refreshStats(S.coId); if (e.status === "approved") toast("Approved."); render(); } }
function revNature(id, v){ const e = D().entries[id]; if (e){ e.natureId = v; e.confirmType = false; Store.saveEntry(S.coId, e); render(); } }
function revTds(id, on){
  const e = D().entries[id]; if (!e) return;
  // one bill ticked below the limits: "Deduct anyway", recorded with who and why
  if (on && compute(e).tdsWould <= 0) return billDeductAnyway(e, true);
  if (!on && compute(e).anyway) return billDeductAnyway(e, false);
  revSet(e, on); render();
}
// the firm account in Settings (app/src/screens/Account.jsx): a person's password, two-step or switching on and off; a
// backup downloaded; a drop key switched off; the platform page's buttons (they read its boxes by id) and a firm's plan
// the firm account's admin service not yet updated (Phase 2 waits for the database): it does not know the new actions
function adminNotYet(e){ return /unknown action/i.test(String((e && e.message) || "")); }
function acctPerson(what, email){
  // a reset link by email: they choose the new password; "makepw" is the fallback where email is not set up
  if (what === "reset") Cloud.fn("admin", {action: "send_reset", email, redirect: appUrl()}).then(r => { S.newPerson = null; toast(r.note || "Reset link sent."); render(); },
    e => toast(adminNotYet(e) ? "Reset links by email start once the firm account\u2019s update is done. For now, use \u201cMake a password\u201d." : e.message));
  else if (what === "makepw") Cloud.fn("admin", {action: "reset_password", email}).then(r => { S.newPerson = {email: r.email, password: r.password}; toast("New password made."); render(); }, e => toast(e.message));
  else if (what === "unlock") Cloud.fn("admin", {action: "unlock", email}).then(r => toast(r.note || "Unlocked."),
    e => toast(adminNotYet(e) ? "The lockout starts once the firm account\u2019s update is done: nobody is locked out until then." : e.message));
  else if (what === "mfa") askConfirm({title: "Reset two-step sign-in for " + email + "?", ok: "Reset", body: '<p class="note">Their authenticator entry is removed. At the next sign-in they set it up again with their phone. Do this only when you are sure it is them asking.</p>'})
    .then(a => { if (a) Cloud.fn("admin", {action: "reset_two_step", email}).then(() => toast("Two-step sign-in reset for " + email + "."), e => toast(e.message)); });
  else Cloud.fn("admin", {action: "set_person", email, active: what === "on"}).then(() => { toast(what === "on" ? "Switched on." : "Switched off."); loadAccount(); }, e => toast(e.message));
}
function acctBackup(id){
  Cloud.rpc("backup_data", {p_id: num(id)}).then(d => {
    saveFile("tds-desk-backup-" + new Date().toISOString().slice(0, 10) + ".json", new Blob([JSON.stringify(d, null, 1)], {type: "application/json"}));
    toast("Downloaded. Keep it somewhere outside this system.");
  }, e => toast(e.message));
}
function acctDropOff(id){
  askConfirm({title: "Switch this key off?", ok: "Switch it off", body: '<p class="note">Anything using this key will no longer be able to send files in.</p>'}).then(a => {
    if (!a) return;
    Cloud.rpc("revoke_drop_key", {p_id: id}).then(() => Cloud.rpc("my_drop_keys")).then(k => { S.dropKeys = [].concat(k || []); render(); }, e => toast(e.message));
  });
}
function adminPlan(firm, plan){ Cloud.rpc("admin_set_plan", {p_firm: firm, p_plan: plan}).then(() => { toast("Plan changed."); loadAdminOverview(); }, e => toast(e.message)); }
function adminAct(act, firm, d){
  d = d || {};
  const g = id => (document.getElementById(id) || {}).value || "";
  const after = msg => { toast(msg); loadAdminOverview(); loadAccount(true); };
  if (act === "credit"){
    askConfirm({title: "Add credit to " + (d.name || "this firm"), ok: "Add credit",
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
  if (act === "editPlan"){ S.planEdit = d.plan; render(); return; }
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
    Cloud.rpc("admin_save_plan", {p_id: d.plan && d.plan !== "new" ? d.plan : null, p_name: g("plName"), p_monthly: num(g("plFee")), p_includes: includes, p_note: g("plNote")})
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
    const k = d.name, v = (document.getElementById("sec_" + k) || {}).value || "";
    if (!v.trim()){ toast("Paste the key first."); return; }
    Cloud.rpc("admin_set_secret", {p_name: k, p_value: v.trim()}).then(() => { const el = document.getElementById("sec_" + k); if (el) el.value = ""; after("Key saved. It cannot be read back."); }, e => toast(e.message));
    return;
  }
  return;
}
function cloudForm(k, v){ S.cloudForm = Object.assign({}, S.cloudForm, {[k]: v}); if (k === "email") Cloud.setCfg({email: v.trim()}); }
function cloudAuto(on){ Cloud.setCfg({auto: on}); startCloudSync(); render(); }
function docsKeep(on){ S.firm.cloudDocs = on; Store.saveFirm(); toast(on ? "Documents will be kept in the firm account." : "Documents stay on this computer only."); render(); }
function docYearsSet(v){ S.firm.docYears = num(v); Store.saveFirm(); render(); }
function reactOwned(el){ return !!(el && el.closest && el.closest(".react-host") && !el.closest("[data-legacy]")); }
document.addEventListener("click", ev => {
  if (reactOwned(ev.target)) return;
  const t = ev.target.closest("button,[data-select],[data-open],#drop,#modal,#bankDrop,#salesDrop");
  if (!t) return;
  if (t.dataset.settab !== undefined){ S.settingsTab = t.dataset.settab || null; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.openentry){
    const e0 = S.data[t.dataset.openco] && S.data[t.dataset.openco].entries[t.dataset.openentry];
    if (e0){ if (S.coId !== t.dataset.openco) openCompany(t.dataset.openco); S.tab = "invoices"; S.reviewTable = false; S.filter = e0.status; S.selected = e0.id; render(); window.scrollTo(0, 0); }
    return;
  }
  if (t.dataset.useexp){
    billUseExpense(curEntry(), t.dataset.useexp);
    return;
  }
  if (t.closest && t.closest("[data-colf]")){ const bt = t.closest("[data-colf]"), k = bt.dataset.colf, tb = bt.dataset.colt; S.colPop = S.colPop && S.colPop.k === k && S.colPop.t === tb ? null : {t: tb, k, justOpened: true}; render(); return; }
  if (t.closest && t.closest("[data-cpclose]")){ S.colPop = null; render(); return; }
  if (t.closest && t.closest("[data-cpapply]")){ colPopApply(false); return; }
  if (t.closest && t.closest("[data-cpclear]")){ colPopApply(true, S.colAuto); return; }
  if (t.dataset.cpquick){ const [a2, b2] = quickRange(t.dataset.cpquick), pop = document.getElementById("colpop"); if (pop){ pop.querySelector('[data-pf="from"]').value = a2; pop.querySelector('[data-pf="to"]').value = b2; } colPopApply(false, false); return; }   // a quick pick is a whole choice: close
  if (t.dataset.billdel){ billDelete(t.dataset.billdel); return; }
  if (t.dataset.reread){ const e0 = D().entries[t.dataset.rid]; if (e0) rereadEntry(e0, t.dataset.reread === "free" ? null : t.dataset.reread); return; }
  if (S.view === "company" && (S.tab === "bank" || (S.tab === "export" && S.bank && S.bank.cid === S.coId)) && bankClick(t)) return;   // bank buttons also work on the Post step
  if (S.view === "company" && S.tab === "sales" && salesClick(t)) return;
  if (t.dataset.open){ openCompany(t.dataset.open); return; }
  if (t.dataset.bookstab){ booksTabGo(t.dataset.bookstab, t.dataset.gstpart); return; }
  if (t.dataset.gstpart){ gstPartGo(t.dataset.gstpart); return; }
  if (t.dataset.tdspart){ S.tdsPart = t.dataset.tdspart; render(); return; }
  if (t.dataset.tdsnav){ tdsNav(t.dataset.tdsnav); return; }
  if (t.dataset.tdsgo){ tdsGo(...t.dataset.tdsgo.split("|")); return; }
  if (t.dataset.tdstab){ tdsTabGo(t.dataset.tdstab); return; }
  if (t.dataset.tdsfclear){ tdsFilterClear(t.dataset.tdsfclear); return; }
  if (t.dataset.tdssort){ tdsSortBy(...t.dataset.tdssort.split("|")); return; }
  if (t.dataset.mistab){ S.misTab = t.dataset.mistab; S.misQ = ""; S.misF = ""; render(); return; }
  if (t.dataset.misquick){ const x = misRangeQuick(t.dataset.misquick, S.books); S.misRange = {from: Audit.iso(x.from), to: Audit.iso(x.to)}; render(); return; }
  if (t.dataset.b2open){ S.b2Open = S.b2Open === t.dataset.b2open ? "" : t.dataset.b2open; render(); return; }
  if (t.dataset.clearf){ clearFilter(t.dataset.clearf); return; }
  if (t.dataset.printid){ printTable(t.dataset.printid, t.dataset.printtitle); return; }
  if (t.dataset.qgo){ S.tdsQ = t.dataset.qgo; S.tdsForm = "26Q"; S.tdsView = "return"; S.tdsTab = ""; render(); return; }
  if (t.dataset["2btab"]){ S.twoBTab = t.dataset["2btab"]; render(); return; }
  if (t.dataset.goclient !== undefined && t.dataset.goclient !== null && t.dataset.goclient !== ""){ goClient(t.dataset.goclient); return; }
  if (t.dataset.nav){ navHome(t.dataset.nav); return; }
  if (t.dataset.step){ goStep(t.dataset.step); return; }
  if (t.dataset.dtype){ goDocType(t.dataset.dtype, t.dataset.gstep); return; }
  if (t.dataset.goto){ const st = t.dataset.gstep || "review"; openCompany(t.dataset.goto).then(() => goStep(st, "bills")); return; }
  if (t.dataset.tab){ goTab(t.dataset.tab); return; }
  if (t.dataset.htab){ S.homeTab = t.dataset.htab; S.addingCo = false; render(); return; }
  if (t.dataset.filter){ S.filter = t.dataset.filter; S.selected = null; render(); return; }
  if (t.dataset.select){ S.selected = t.dataset.select; render(); if (window.innerWidth < 860){ const d = document.querySelector(".detail"); if (d) d.scrollIntoView({behavior:"smooth", block:"start"}); } return; }
  if (t.id === "drop"){ pickFiles("company"); return; }
  if (t.dataset.act) doAct(t.dataset.act, t); else S.arm = null;   // any other button disarms a pending delete
});
/* ---------- the actions behind the buttons: doAct("name") from React, or a data-act button of an old screen ----------
   t is the button (only a few actions read more of it than its data-act); from React it may be left out */
function doAct(act, t){
  t = t || {dataset: {act}};
  const e = curEntry();
  if (act !== "delCo" && act !== "clearSent") S.arm = null;
  switch (act){
    case "switch": openSwitcher(); break;
    case "home": goHome(); break;
    case "swHome": S.homeTab = "clients"; goHome(); break;
    case "swAdd": S.homeTab = "clients"; S.addingCo = true; goHome(); break;
    case "addCo": S.view = "home"; S.homeTab = "clients"; S.addingCo = true; render(); { const n = document.getElementById("ncName"); if (n) n.focus(); } break;
    case "cancelCo": S.addingCo = false; render(); break;
    case "reread": if (e) rereadCarefully(e); break;
    case "confirmType": if (e){ e.confirmType = false; Store.saveEntry(S.coId, e); refreshStats(S.coId); toast("Payment type confirmed: " + ruleOf(e.natureId).label + ". It will be remembered for this supplier when you approve."); render(); } break;
    case "skipTds": if (e && e.status === "draft"){ e.tdsForce = false; e.tdsSkip = "pay"; Store.saveEntry(S.coId, e); refreshStats(S.coId); toast("TDS will not be booked on this bill. Choose the reason in the TDS decision section."); render(); } break;
    case "revTable": S.reviewTable = true; S.revSel = new Set(); render(); window.scrollTo(0, 0); break;
    case "revList": S.reviewTable = false; render(); break;
    case "bankPickBills": S.reviewTable = false; render(); setTimeout(() => { const el = document.getElementById("fileIn"); if (el) el.click(); }, 50); break;
    case "revNone": S.revSel = new Set(); render(); break;
    case "revTdsOn": case "revTdsOff": {
      const want = act === "revTdsOn";
      draftRows().filter(r => S.revSel.has(r.e.id)).forEach(r => revSet(r.e, want));
      toast((want ? "TDS will be booked on " : "TDS will not be booked on ") + S.revSel.size + " bills.");
      render(); break;
    }
    case "revApprove": case "revApproveAll": {
      const rows = draftRows().filter(r => act === "revApprove" ? S.revSel.has(r.e.id) : (!(r.c.missing || []).length && !r.c.flags.some(f => f.lvl === "hi") && !r.e.confirmType));
      let ok = 0, held = 0;
      rows.forEach(r => { const c = compute(r.e); if ((c.missing || []).length || notReadYet(r.e)){ held++; return; } approve(r.e); ok++; });
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
    case "setPasswordGo": setPasswordGo(); break;
    case "cloudSignIn": {
      const em = document.querySelector('[data-cloud="email"]'), pw = document.querySelector('[data-cloud="password"]');
      const email = em ? em.value.trim() : "", pass = pw ? pw.value : "";
      if (!email || !pass){ toast("Enter your email and password."); break; }
      Cloud.st.busy = "Signing in\u2026"; Cloud.st.error = ""; render();
      Cloud.signIn(email, pass).then(() => { Cloud.st.busy = ""; S.cloudForm = null; S.signedOutWhy = ""; toast("Signed in as " + email + "."); setTimeout(() => { auditEvent("signin", navigator.userAgent.slice(0, 160)); setTimeout(loadLastSignIn, 1500); }, 3000); startCloudSync(); loadAccount(true).then(() => render()); render(); },
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
    case "setup": toggleSetup(); break;
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
      flushBillSaves();                                         // a bill change typed a moment ago: saved and counted as not sent yet
      const pend = Cloud.on() ? cloudChanges().changes.length : 0;
      askConfirm({title: "Sign out of FinCom?", ok: "Sign out", body: '<p class="note">You will need your email, password' + (Cloud.st.firm ? " and, if set up, the code from your phone" : "") + ' to come back in. Work already synced stays in your firm account.</p>',
        check: pend ? "" : "Also remove this firm\u2019s work from this computer (for a shared or office computer)"}).then(a => {
        if (!a) return;
        signOutHere("Signed out.", !!(a.check && !pend));
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
        .then(() => { Cloud.st.busy = ""; S.cloudForm = null; S.signUpOpen = false; if (!S.firm.firmName){ S.firm.firmName = f.firm; Store.saveFirm(); } toast("Welcome. Your firm is ready."); startCloudSync(); loadAccount(true).then(() => render()); render(); },
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
    case "invitePerson": {
      // an email with a link to set their own password (review item 21)
      const g = id => (document.getElementById(id) || {}).value || "";
      const email = g("npEmail").trim();
      if (!email){ toast("An email address is needed."); break; }
      const who = {email, name: g("npName"), role: g("npRole")};
      Cloud.fn("admin", Object.assign({action: "invite_person", redirect: appUrl()}, who)).then(r => {
        S.newPerson = null; toast(r.note || ("Invited " + r.email + ".")); loadAccount();
      }, e => {
        if (!adminNotYet(e)){ toast(e.message); return; }
        // until the update is done: added as before, with a password made for them and shown once
        Cloud.fn("admin", Object.assign({action: "add_person"}, who)).then(r => {
          S.newPerson = r.password ? {email: r.email, password: r.password} : null;
          toast("Email invites start once the firm account\u2019s update is done, so a password was made instead." + (r.password ? "" : " " + (r.note || "")));
          render(); loadAccount();
        }, e2 => toast(e2.message));
      });
      break;
    }
    case "addPerson": {
      const g = id => (document.getElementById(id) || {}).value || "";
      const email = g("npEmail").trim();
      if (!email){ toast("An email address is needed."); break; }
      Cloud.fn("admin", {action: "add_person", email, name: g("npName"), role: g("npRole")}).then(r => {
        S.newPerson = r.password ? {email: r.email, password: r.password} : null;
        toast("Added " + r.email + "." + (r.password ? "" : " " + (r.note || "")));
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
      flushBillSaves();
      askConfirm({title: "Sign out of the firm account?", ok: "Sign out", body: "This computer keeps its own copy of everything. Changes made after signing out are not shared until you sign in again."}).then(a => {
        if (!a) return;
        signOutHere("Signed out.");
      });
      break;
    }
    case "bridgeTest": { const k = document.querySelector('[data-bridge="key"]'), u = document.querySelector('[data-bridge="url"]');
      Bridge.setCfg({key: k ? k.value.trim() : Bridge.cfg().key, url: u ? u.value.trim() || "http://127.0.0.1:9100" : Bridge.cfg().url});
      Bridge.lastOpenKey = null; Bridge.refresh().then(() => { toast(Bridge.up() ? "Connected to FinCom Bridge." : Bridge.st.error); startBridgePolling(); render(); }); break; }
    case "bridgeSetupFile": saveBridgeSetup(); break;
    case "adminCreditGo": break;
    case "bridgeConnect": {
      askConfirm({title: "Connect to FinCom Bridge", ok: "Connect",
        body: '<p class="note">Type the 6-digit code FinCom Bridge shows on this computer: right-click the FinCom icon near the clock \u2192 \u201cConnect FinCom on this computer\u2026\u201d. The code works once, for 15 minutes.</p><input type="text" id="bridgeCode" inputmode="numeric" maxlength="7" autocomplete="off" placeholder="6-digit code" style="width:160px;font-size:18px;letter-spacing:3px">',
        read: () => String((document.getElementById("bridgeCode") || {}).value || "").replace(/\D/g, ""),
        validate: v => /^\d{6}$/.test(v) ? "" : "Type the 6 digits FinCom Bridge shows."}).then(a => {
      if (!a) return;
      toast("Connecting to the bridge on this computer\u2026");
      Bridge.pair(a.data).then(j => {
        Bridge.lastOpenKey = null;
        return Bridge.refresh().then(() => { toast("Connected to the bridge on " + (j.computer || "this computer") + "."); startBridgePolling(); render(); });
      }, err => { Bridge.st.error = err.message; toast(err.message); render(); });
      });
      break;
    }
    case "bridgeOff": Bridge.setCfg({key: ""}); clearInterval(bridgeTimer); Bridge.st = {state: "off", sessions: [], open: [], at: Date.now(), error: ""}; render(); break;
    case "billPost": postBillsToTally(); break;
    case "postAll": postAllToTally(); break;
    case "postToChoose": goChooseTallyCompany(); break;
    case "marketPick": { const i = document.getElementById("marketIn"); if (i){ i.value = ""; i.click(); } break; }
    case "booksPick": { const i = document.getElementById("booksIn"); if (i){ i.value = ""; i.click(); } break; }
    case "mastersPick": { const i = document.getElementById("mastersIn"); if (i){ i.value = ""; i.click(); } break; }
    case "setupKeepOn": LK.keepOn(true).then(() => { (S.setupKeep || {})[S.coId] = null; render(); }); break;
    case "keepNow": {
      // 03-Oct-2026 (item 25): reading stopped from FinCom for this client's computer: nothing is asked, the toast says who and why
      const stopped = typeof tallyStopFor === "function" && tallyStopFor(S.coId);
      if (stopped){ toast("Reading is stopped by " + (stopped.who || "FinCom") + " (" + (stopped.reason || "no reason given") + "); resume it on the Tally page"); break; }
      if (Bridge.on() && (Bridge.up() || !TCloud.has(S.coId))) LK.keepSet({now: true}, "Updating from Tally now. The books here follow in a few minutes.");
      else TCloud.rpc("tally_want_update", {p_client: S.coId}).then(j => toast(j && j.ok ? "The Tally computer is asked to update; it starts within a minute, and the books here follow in a few minutes." : "No Tally computer is linked to this client yet."), e => toast("Could not ask the Tally computer: " + ((e && e.message) || e)));
      break; }
    case "setupModeBridge": case "setupModeFiles":
      Bridge.call("/keepmode" + (Bridge.pinQ() ? "?" + Bridge.pinQ().slice(1) : ""), {company: BridgeSeed.company(), mode: act === "setupModeBridge" ? "bridge" : "files"}, 20000)
        .then(j => { (S.setupKeep = S.setupKeep || {})[S.coId] = {at: Date.now(), st: j}; toast(act === "setupModeBridge" ? "The bridge will copy the year from Tally in the evening, or when nobody is at the computer." : "The bridge waits for the day book files."); render(); }, e => toast("The bridge could not do it: " + ((e && e.message) || e) + (/Unknown|No such/i.test(String(e && e.message)) ? " (it needs FinCom Bridge 2.1: install it from the Tally page)" : "")));
      break;
    case "tbCheckPick": { const i = document.getElementById("tbCheckIn"); if (i){ i.value = ""; i.click(); } break; }
    case "multiPick": { const i = document.getElementById("multiBooksIn"); if (i){ i.value = ""; i.click(); } break; }
    case "multiStart": MultiUp.start(); break;
    case "multiClose": S.multiUp = null; render(); break;
    case "tbPick": { const i = document.getElementById("tbIn"); if (i){ i.value = ""; i.click(); } break; }
    case "filedPick": { const i = document.getElementById("filedIn"); if (i){ i.value = ""; i.click(); } break; }
    case "twoBPick": { const i = document.getElementById("twoBIn"); if (i){ i.value = ""; i.click(); } break; }
    case "tallyRead": {
      const b = S.books, t = Audit.today(), r = S.tallyRange || {from: Audit.iso(Audit.fyStart(t)), to: Audit.iso(t)};
      const from = Audit.ymd(r.from), to = Audit.ymd(r.to);
      if (!from || !to || from > to){ toast("Choose a period: from a date to a later one."); break; }
      if (!bridgeLive(CO())){ toast("Open this company in Tally with the bridge running."); break; }
      LK.keepSet({now: true}, "Updating from Tally now. The books here follow in a few minutes.");
      break;
    }
    case "tallyCopyCheck": {
      const co = CO(); if (!bridgeLive(co)) break;
      const q = "?company=" + encodeURIComponent(Bridge.openFor(co).name) + Bridge.pinQ();
      Promise.all([Bridge.call("/synced" + q, null, 30000), Bridge.call("/schedule", null, 30000).catch(() => null)]).then(([c, sc]) => {
        S.tallyCopy = Object.assign({}, c, {schedule: sc, time: (S.tallyCopy || {}).time}); render();
      }, e => { S.tallyCopy = {error: /Unknown address/.test(String(e && e.message)) ? "This needs FinCom Bridge 2.1. Install FinCom Bridge from the Tally page." : String(e && e.message || e)}; render(); });
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
    case "fsRun": { const y = fsYearNow(), c = FS.cfg(S.books); S.fsRun = {fy: y, kind: c.kind, d: FS.build(y)}; render(); break; }
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
      // the books in FinCom's cloud first (review of 02-Oct-2026: the audit ran on whatever this browser held)
      (async () => {
        if (typeof TCloud === "object" && TCloud.on()){ try { await TCloud.status(S.coId); if (TCloud.has(S.coId) && await TCloud.load() === "new") TCloud.rework(S.books); } catch (e){} }
        const run = Audit.run(r.from, r.to, "run now"); saveBooks();
        toast(run.vouchers + " entries from " + fmtDate(Audit.iso(run.from)) + " to " + fmtDate(Audit.iso(run.to)) + ": " + run.findings.length + " findings, " + run.findings.filter(f => f.sev === "high").length + " serious."); render();
      })();
      break;
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
    case "itctCopy": case "itctMail": case "itctWa": itctWrite(act, t.dataset.sup); break;
    case "inregExcel": inregExcel().then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "gst9Excel": case "gst9cExcel": gst9Excel(act === "gst9Excel" ? "9" : "9C").then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "lmPostAll": { const n2 = LedMaster.applyPosting(S.books, CO()); toast(n2 + " posting ledger" + (n2 === 1 ? "" : "s") + " set from the master."); render(); break; }
    case "lmConfirmShown": {
      const b = S.books, info = b.ledInfo || {}, q = String(S.ledQ || "").toLowerCase(), view = S.lmView || "pending";
      const pool = view === "gst" ? Object.entries(b.map).filter(([nm, m]) => LedMaster.isGst(m.what) && LedMaster.taxLike(nm, m, info[nm])) :
        view === "tds" ? Object.entries(b.map).filter(([nm, m]) => LedMaster.isTds(m.what) && LedMaster.taxLike(nm, m, info[nm])) : LedMaster.pending(b);
      const names = pool.filter(([nm, m]) => !m.ok && (!q || nm.toLowerCase().includes(q) || String(m.section || "").toLowerCase().includes(q) || String((info[nm] || {}).group || "").toLowerCase().includes(q))).map(x => x[0]);
      // a confirm button is its own confirm step: saved at once, not a draft (src/js/60)
      Drafts.direct(() => { LedMaster.confirm(b, names, true); b.reco = null; saveBooks(); }, {bypass: true}); toast(names.length + " ledger" + (names.length === 1 ? "" : "s") + " confirmed."); render(); break;
    }
    // ledgers with entries but no master: the masters read again (through the bridge here, else the firm's Tally
    // computer is asked to update the cloud copy, masters included)
    case "tbMasters": {
      if (typeof bridgeLive === "function" && bridgeLive(CO())){ doAct("ledRead"); break; }
      if (typeof TCloud === "object" && TCloud.on()) TCloud.rpc("tally_want_update", {p_client: S.coId}).then(j => {
        toast(j && j.ok ? "The Tally computer will read the ledger masters with its next update (within a minute or two), then this is worked out again." : "No Tally computer is linked to this client yet: read the masters on the Tally computer (Tally ledgers → Read ledgers from Tally).");
        LK.cache = {}; }, e => toast("Could not ask the Tally computer: " + ((e && e.message) || e)));
      else toast("Read the ledger masters on the computer where Tally runs (Tally ledgers → Read ledgers from Tally).");
      break;
    }
    case "ledRead": {
      const co = CO(), b = S.books;
      if (!bridgeLive(co)){ toast("Connect FinCom Bridge and open this company in Tally, or bring in the ledger masters XML under \u201cFrom Tally\u201d."); break; }
      b.busy = "Reading the ledgers from Tally\u2026"; render();
      Bridge.call("/ledgers?company=" + encodeURIComponent(Bridge.openFor(co).name) + Bridge.pinQ(), null, 180000).then(async j => {
        const info = {}, groups = {};
        [].concat(j.ledgers || []).forEach(l => { if (!l || !l.name) return;
          info[l.name] = {group: l.group || "", taxType: String(l.taxType || "").replace(/[^A-Za-z ]/g, "").trim(), dutyHead: l.dutyHead || "", tdsNature: l.tdsNature || "", rate: num(l.rate) || undefined, gstin: l.gstin || "", pan: l.pan || ""};
          // contact details, from bridge 1.12.9: for letters to the party
          if (l.email) info[l.name].email = String(l.email).trim(); if (l.phone) info[l.name].phone = String(l.phone).trim(); if (l.mobile) info[l.name].mobile = String(l.mobile).trim();
          if (l.address) info[l.name].addr = [].concat(l.address).filter(Boolean).join("\n");
          if (l.gstin) (b.gstins = b.gstins || {})[l.name] = String(l.gstin).toUpperCase();
          if (l.pan) (b.pans = b.pans || {})[l.name] = String(l.pan).toUpperCase();
          if (l.group) (b.under = b.under || {})[l.name] = l.group; });
        [].concat(j.groups || []).forEach(g => { if (g && g.name) groups[g.name] = g.parent || ""; });
        b.ledInfo = info; b.ledInfoAt = new Date().toISOString(); if (Object.keys(groups).length){ b.groups = groups; TallyRead.yearOpen(b); }
        LedMaster.refresh(b); b.busy = ""; b.reco = null; await saveBooks();
        toast(Object.keys(info).length + " ledgers read from Tally. " + LedMaster.pending(b).length + " GST or TDS ledgers to confirm."); render();
      }, e => { b.busy = ""; toast("Could not read Tally: " + (e && e.message || e)); render(); });
      break;
    }
    case "assetAdd": { const b = S.books; b.assets = (b.assets || []).concat([{id: uid("as"), name: "", date: "", igst: 0, cgst: 0, sgst: 0, cess: 0, use: "common", reg: S.gstReg || "", sold: ""}]); saveBooks(); render(); break; }
    case "booksClear": confirmTyped({title: "Remove the books read from Tally?", ok: "Remove", body: '<p class="note">Challans and what you corrected stay. Nothing in Tally or in FinCom\u2019s cloud copy is touched, and a copy is kept: <b>More \u2192 Restore</b> puts the books back.</p>'}).then(async ok => {
      if (!ok) return; const b = S.books, cid = S.coId;
      const kept = await Trash.put(cid, "books", "The books read from Tally (" + (b.vouchers || []).length + " entries)", {vouchers: b.vouchers, meta: b.meta, reco: b.reco}, ok.reason);
      b.trashLog = (b.trashLog || []).concat([{kind: "books", id: kept.id, server: kept.server, reason: ok.reason, at: new Date().toISOString(), by: whoAmI()}]);
      BookItems.allowMass = Object.assign({}, BookItems.allowMass, {[cid + "|vouchers"]: 1, [cid + "|meta"]: 1, [cid + "|reco"]: 1});
      b.vouchers = []; b.meta = null; b.reco = null; saveBooks(); toast("Removed. More \u2192 Restore puts them back."); render(); }); break;
    // the GST and TDS ledger check (src/js/57, request of 02-Oct-2026)
    case "lcRun": { const b = S.books; if (!b) break; const c = LedCheck.run(b); const high = c.names.filter(n => c.items[n].s.conf === "high").length; toast(c.names.length + " tax-like ledgers checked: " + high + " settled by Tally’s masters or the day book, " + (c.names.length - high) + " to look at."); saveBooks(); render(); break; }
    case "lcConfirm": { const b = S.books, c = b && b.ledCheck; if (!c) break;
      const names = (c.names || []).filter(n => !((b.map || {})[n] || {}).ok && LedCheck.ticked(c.items[n]));
      const n = Drafts.direct(() => { const k = LedCheck.confirm(b, names); saveBooks(); return k; }, {bypass: true}); GSTR._carry = null; GST2B._memo = null; toast(n + " ledger" + (n === 1 ? "" : "s") + " confirmed. Only confirmed ledgers count in the returns now."); render(); break; }
    case "lcAi": { const b = S.books; if (!b || !b.ledCheck) break; b.busy = "Asking AI about the unclear ledgers…"; render();
      LedCheck.askAi(b).then(n => { b.busy = ""; if (n){ toast("AI answered for " + n + " ledger" + (n === 1 ? "" : "s") + ". Its answers are not ticked: check each."); saveBooks(); } render(); }, e => { b.busy = ""; toast("AI could not be asked: " + ((e && e.message) || e)); render(); }); break; }
    case "trashRestore": {
      // the newest removal of the books or of Tally data and GST work, or the one picked (data-i) in More; from the
      // server, so it can be put back on any computer
      const cid = S.coId, i = num(t && t.dataset && t.dataset.i);
      Trash.list(cid).then(async all => {
        const list = all.filter(x => x.kind === "books" || x.kind === "wipe"), x = list[i] || list[0];
        if (!x){ toast("Nothing removed here to restore."); return; }
        let data; try { data = await Trash.take(x); } catch (e){ toast("Could not restore it: " + ((e && e.message) || e)); return; }
        if (!data){ toast("Nothing kept to restore for that removal."); return; }
        Object.assign(S.books, data);
        S.books.trashLog = (S.books.trashLog || []).concat([{kind: "restore:" + x.kind, id: x.id, at: new Date().toISOString(), by: whoAmI()}]);
        GST2B._memo = null; GSTR._carry = null; await saveBooks(); toast("Restored: " + x.label + "."); render();
      }); break;
    }
    case "booksWipe": {
      const b = S.books; if (!b) break;
      confirmTyped({title: "Remove Tally data and all GST work?", ok: "Remove", wide: true,
        body: '<p class="note"><b>Removed for ' + esc(CO().name) + ":</b> the day book and ledger masters read from Tally, Tally\u2019s balances, the audit, MIS and trial balance worked from them; every 2B, filed GSTR-1 and GSTR-1A copy; GST settings and contacts; 3B and GSTR-9 figures typed; filing dates and portal figures; ITC follow-up and IMS decisions; advances, reversal and amendment choices; and the returns-filed PDFs.</p>" +
          '<p class="note"><b>Kept:</b> TDS challans, certificates and the salary sheet; bills, bank and sales; the client\u2019s own settings; the returns-filed PDF files themselves. A copy of what is removed is kept: <b>More \u2192 Restore</b> puts it back.</p>'}).then(async ok => {
        if (!ok) return;
        const co = CO(), snap = {};
        // a soft delete: everything removed is kept as it was (the PDFs stay where they are), and can be put back
        BOOKS_WIPE.forEach(k => { if (b[k] !== undefined) snap[k] = b[k]; });
        const kept = await Trash.put(co.id, "wipe", "Tally data and all GST work", snap, ok.reason);
        b.trashLog = (b.trashLog || []).concat([{kind: "wipe", id: kept.id, server: kept.server, reason: ok.reason, at: new Date().toISOString(), by: whoAmI()}]);
        BookItems.allowMass = Object.assign({}, BookItems.allowMass, Object.fromEntries(BOOKS_WIPE.map(k => [co.id + "|" + k, 1])));
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
    case "yearExcel26": TDSYear.toExcel(S.tdsFy || "", "26Q").then(() => toast("Downloaded."), e => toast("Could not build it: " + (e && e.message))); break;
    case "yearExcel24": TDSYear.toExcel(S.tdsFy || "", "24Q").then(() => toast("Downloaded."), e => toast("Could not build it: " + (e && e.message))); break;
    case "yearExcelAll": TDSYear.toExcel(S.tdsFy || "", "").then(() => toast("Downloaded."), e => toast("Could not build it: " + (e && e.message))); break;
    case "salaryPick": { const i = document.getElementById("salaryIn"); if (i){ i.value = ""; i.click(); } break; }
    case "salaryClear": askConfirm({title: "Remove the salary sheet?", ok: "Remove", body: '<p class="note">The challans and everything else stay.</p>'}).then(ok => {
      if (!ok) return; S.books.salary = []; saveBooks(); toast("Removed."); render(); }); break;
    case "q24Excel": TDS24Q.toExcel(S.tdsFy || "", S.tdsQ || "Q4").then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "tdsTxt": { if (!ledgersReady("tds")) break; LedMaster.snap(S.books, (S.tdsForm || "26Q") + " " + (S.tdsQ || "") + " " + (S.tdsFy || "")); saveBooks();
      const q = S.tdsQ || "", fy = S.tdsFy || "";
      if (!q || !fy){ toast("Choose the year and the quarter first."); break; }
      const r = TDS26Q.build(fy, q, TDS26Q.firmDetails(), S.tdsForm);
      if (r.error){ toast(r.error); break; }
      saveFile(r.name, new Blob([r.text], {type: "text/plain"}));
      toast((r.draft ? "Form " + r.formNo + ", draft – not yet validated: " : "") + r.rows + (r.form === "27EQ" ? " collections" : " deductions") + " under " + r.challans + " challan" + (r.challans === 1 ? "" : "s") + (r.remarks ? ", " + r.remarks + " with a remark (certificate or higher rate)" : "") +
        (r.missingCodes && r.missingCodes.length ? ". No payment code yet for " + r.missingCodes.join(", ") : "") + (r.draft ? ". Do not file it." : ". Check it with the FVU before filing."));
      break;
    }
    case "tdsFvu": { if (!ledgersReady("tds")) break;
      const q = S.tdsQ || "", fy = S.tdsFy || "";
      if (!q || !fy){ toast("Choose the year and the quarter first."); break; }
      const r = TDS26Q.build(fy, q, TDS26Q.firmDetails(), S.tdsForm);
      if (r.error){ toast(r.error); break; }
      if (r.draft){ toast("Form " + r.formNo + " is a draft – not yet validated against Protean’s file format, so it is not sent to the FVU yet."); break; }
      const co = CO();
      toast("Running the FVU on the Tally computer\u2026");
      Bridge.call("/fvu", {text: r.text, name: r.name, fvuJar: (co.fvuJar || ""), csi: (co.csiFile || ""), outDir: (co.fvuOut || "")}, 200000).then(res => {
        res = Object.assign({}, res, {ok: res.accepted != null ? !!res.accepted : !!res.ok});
        S.fvuResult = Object.assign({at: new Date().toISOString(), q, fy, form: r.form}, res);
        toast(res.ok ? "The FVU accepted it. The .fvu file is on the Tally computer." : "The FVU found problems. They are listed below.");
        render();
      }, e => { const msg = (e && e.message) || "the bridge did not answer"; S.fvuResult = {at: new Date().toISOString(), ok: false, errors: /Unknown address/.test(msg) ? "This needs FinCom Bridge 2.1. Install FinCom Bridge from the Tally page and run it on the Tally computer." : msg}; toast("Could not run the FVU: " + msg); render(); });
      break;
    }
    case "tdsExcel": TDS.toExcel(S.tdsFy || "", S.tdsQ || "", S.tdsForm).then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "gstJson": if (!ledgersReady("gst")) break;
      // a month already filed: its return is not made again from the books as they are now
      { const ym = S.gstYm || "", reg = S.gstReg || "", pr = reg && ym ? GSTAmend.proof(ym, reg) : null;
        if (pr){ askConfirm({title: "GSTR-1 for " + GSTR.label(ym) + " is already filed", ok: "Close", body: '<p class="note">It was filed' + (pr.arn ? " with ARN " + esc(pr.arn) : "") + (pr.on ? " on " + esc(fmtDate(pr.on)) : "") +
          ". A return made again from the books now would be wrong: the filed return stays as it is, and whatever was added, changed or deleted in Tally since goes as amendments in " + esc(GSTR.label(GSTAmend.nextOpen(ym, reg))) + "’s GSTR-1 (GST → Amendments).</p>"}); break; } }
      LedMaster.snap(S.books, "GSTR-1 " + GSTR.label(S.gstYm || "") + (S.gstReg ? " " + S.gstReg : "")); saveBooks(); GSTR.toJsonFile(S.gstYm || "", S.gstReg || "").then(j => toast("GSTR-1 JSON for " + j.fp + " downloaded. Check it on the portal's offline tool before filing."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "gst3bJson": { if (!ledgersReady("gst")) break; LedMaster.snap(S.books, "GSTR-3B " + GSTR.label(S.gstYm || "") + (S.gstReg ? " " + S.gstReg : "")); saveBooks();
      const j = GSTR.threeBJson(S.gstYm || "", S.gstReg || "");
      saveFile("GSTR3B_" + (j.gstin || "") + "_" + j.ret_period + ".json", new Blob([JSON.stringify(j)], {type: "application/json"}));
      toast("GSTR-3B JSON for " + j.ret_period + " downloaded. Check it in the portal's offline tool before filing.");
      break;
    }
    case "gstExcel": GSTR.toExcel(S.gstYm || "", S.gstReg || "").then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break;
    case "twoBExcel": { const sc0 = r2Scope(); GST2B.toExcel(GST2B.scope(r2Reg(S.books), sc0.months), sc0.label).then(() => toast("Downloaded."), e => toast("Could not build the file: " + (e && e.message))); break; }
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
    case "vchTallyDone": { const co = CO(); co.vchNumbering = "tally"; co.vchAutoAt = new Date().toISOString(); Store.saveCompany(co); toast("FinCom will leave voucher numbers to Tally."); render(); break; }
    case "vchUseBillNo": { const co = CO(); co.vchNumbering = ""; Store.saveCompany(co); toast("FinCom will send the supplier\u2019s bill number as the voucher number."); render(); break; }
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
    case "billRepostGone":
    case "billRepost": {
      // billRepostGone: the bills whose voucher is no longer in Tally's entries in the cloud copy (TallyProof)
      const ids = act === "billRepostGone" ? Object.values(D().entries).filter(e => e.goneFromTally).map(e => e.id) : (S.billCheck && S.billCheck.missing) || [];
      ids.forEach(id => { const e = D().entries[id]; if (e){ e.exportedAt = null; e.postNote = ""; e.postVerified = false; e.tallyCheck = null; e.postUnconfirmed = null; e.postError = ""; delete e.goneFromTally; Store.saveEntry(S.coId, e); } });
      S.billCheck = null; refreshStats(S.coId); toast(ids.length + " bills are waiting to be posted again."); render(); break;
    }
    case "bridgeDiag": Bridge.diagnose().then(() => Bridge.refresh()).then(() => render()); break;
    case "goTcloud": S.settingsTab = "tcloud"; S.firmMenu = false; S.tallyPanel = false; closeSwitcher(); S.view = "home"; S.homeTab = "rules"; S.arm = null; render(); window.scrollTo(0, 0); break;
    case "openSettings": S.settingsTab = S.settingsTab || null; S.firmMenu = false; S.tallyPanel = false; closeSwitcher(); S.view = "home"; S.homeTab = "rules"; S.arm = null; render(); window.scrollTo(0, 0); break;
    case "dlStandalone": downloadStandalone(); break;
    case "goReading": closeSwitcher(); S.view = "home"; S.homeTab = "rules"; S.settingsTab = "reading"; render(); { const r = document.getElementById("readingPane"); if (r && r.scrollIntoView) r.scrollIntoView(); } break;
    case "testReader": testReader(); break;
    case "testOcr": testFreeOcr(); break;
    case "testGoogle": testGoogle(); break;
    case "saveGoogle": case "removeGoogle": toast("Keys are no longer kept in the browser. Sign in to the firm account to use Google OCR."); break;
    case "askPerm": askPermission(); break;
    case "toggleKey": S.apiKeyShown = !S.apiKeyShown; render(); break;
    case "saveKey": case "removeKey": toast("Keys are no longer kept in the browser. Sign in to the firm account to use Claude."); break;
    case "pasteOpen": S.pasteOpen = true; render(); break;
    case "pasteClose": S.pasteOpen = false; render(); break;
    case "notDup": if (e){ e.notDuplicate = true; if (e.status === "duplicate") e.status = "draft"; delete e.dupOf; Store.saveEntry(S.coId, e); S.filter = "draft"; refreshStats(S.coId); toast("Kept as a separate bill."); render(); } break;
    case "openOriginal": if (e && e.dupOf && D().entries[e.dupOf.entryId]){ const o = D().entries[e.dupOf.entryId]; S.filter = o.status; S.selected = o.id; render(); } break;
    case "clearJobs": { const keep = S.view === "company" ? (j => !(j.target === S.coId || j.cid === S.coId)) : (j => j.target !== "auto"); S.jobs = S.jobs.filter(j => keep(j) || ["waiting","checking","reading"].includes(j.status)); render(); } break;
    case "camera": pickMode = "company"; document.getElementById("camIn").click(); break;
    case "manual": { const n = newEntry("Manual entry"); D().entries[n.id] = n; S.selected = n.id; S.filter = "draft"; Store.saveEntry(S.coId, n); refreshStats(S.coId); render(); break; }
    case "approve": if (e) approve(e); break;
    case "reject": if (e){ if (e.docPath){ CloudDocs.remove(e.docPath); delete e.docPath; } setStatus(e, "rejected", "Marked as no entry needed."); } break;
    case "restore": if (e) setStatus(e, "draft"); break;
    case "undo": if (e) undoApproval(e); break;
    case "delete": if (e) billDelete(e.id); break;
    case "addParty": { const id = "p-new-" + Date.now().toString(36); D().parties[id] = {id, name:"New supplier", pan:"", gstin:"", ledgerName:"", natureDefault:"", expenseLedger:"", ldcRate:"", ldcValidTo:"", ytd:{}}; S.partySel = id; Store.saveParty(S.coId, D().parties[id]); render(); break; }
    case "closeParty": S.partySel = null; render(); break;
    case "resetRules": S.firm.rules = {}; Store.saveFirm(); toast("Default rates and limits restored."); render(); break;
    case "delCo": {
      closeMenus && closeMenus();
      const name = CO().name, cid = S.coId;
      confirmTyped({title: "Remove " + name + "?", ok: "Remove client", body: '<p class="note">It leaves the client list on every computer of the firm. The firm account keeps its details, bills, bank and books, marked removed, and they can be brought back. Nothing in Tally is touched.</p>'}).then(ok => {
        if (!ok) return;
        S.coId = null; S.view = "home";
        Store.deleteCompany(cid, ok.reason).then(() => { toast(name + " removed. The firm account keeps its data."); render(); }); render();
      });
      break;
    }
    case "clearSent":
      confirmTyped({title: "Clear sent invoices older than 90 days?", ok: "Clear them", body: '<p class="note">Invoices sent to Tally more than 90 days ago move to \u201cDeleted\u201d, where each can be restored. Nothing in Tally changes, and deductee year totals are kept. Download the register first if you need it.</p>'})
        .then(ok => { if (ok) clearSent(ok.reason); }); break;
    case "xml": { const m = document.getElementById("markSent"); exportXml(m ? m.checked : true); break; }
    case "csv": exportCsv(); break;
  }
}
// v: {name, gstin, tallyName, copyFrom, turnover10cr} from the add-client form; false when something is missing
function saveNewCompany(v){
  const name = String(v.name || "").trim(), gstin = String(v.gstin || "").trim().toUpperCase();
  if (!name){ toast("Enter the client name."); return false; }
  if (gstin && !gstinValid(gstin)){ toast("That GSTIN fails its check digit. Check each character or leave it blank."); return false; }
  if (gstin && Object.values(S.companies).some(c => c.gstin === gstin)){ toast("A client with this GSTIN already exists."); return false; }
  const src = v.copyFrom ? S.companies[v.copyFrom] : null;
  const co = newCompany(Object.assign(src ? {voucherType:src.voucherType, createOptional:src.createOptional, billwise:src.billwise, gst:src.gst, roundOff:src.roundOff, tdsLedgers:src.tdsLedgers, expenseLedgers:src.expenseLedgers} : {},
    {name, gstin, tallyName:String(v.tallyName || "").trim() || name, turnover10cr:!!v.turnover10cr}));
  S.companies[co.id] = co; S.data[co.id] = {parties:{}, entries:{}, loaded:true};
  co.stats = {drafts:0, check:0, waiting:0, tdsFy:0, invoicesFy:0, records:1, fy:fyOf(null)};
  // 02-Oct-2026: the Tally company chosen here, and (ticked) the one company its entries may be posted to
  const tco = String(v.tallyCompany || "").trim();
  // chosen by the person adding the client: confirmed (src/js/60)
  if (tco && v.postOnly){ co.choices = Object.assign({}, co.choices, {postTo: {value: tco, state: "confirmed", by: whoAmI(), at: new Date().toISOString()}}); co.postTo = tco; co.postToAt = co.choices.postTo.at; co.postToBy = (Cloud.st && Cloud.st.email) || ""; }
  Store.saveCompany(co);
  S.addingCo = false;
  toast(name + " added." + (co.postTo ? " Entries go only into " + co.postTo + "." : ""));
  openCompany(co.id);
  if (tco) linkNewClient(co, tco).catch(() => {});
  return true;
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
  if (S.switcher) return;   // the switcher (React) has the keys while it is open
  if (k === "F3" || (ctrl && k.toLowerCase() === "k")){ ev.preventDefault(); openSwitcher(); return; }
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  const inField = /INPUT|SELECT|TEXTAREA/.test(tag);
  // Ctrl+Enter approves the bill on screen (review item 33: Ctrl+A is the browser's Select All, left alone now);
  // from inside a box too: the box is left first, so what was typed counts
  if (ctrl && k === "Enter" && S.view === "company" && S.tab === "invoices"){
    const e = curEntry();
    if (e && e.status === "draft" && !S.reading[e.id]){
      ev.preventDefault();
      if (inField && document.activeElement.blur) document.activeElement.blur();
      setTimeout(() => { const e2 = curEntry(); if (e2 && e2.status === "draft") { approve(e2); render(); } }, 60);
    }
    return;
  }
  // J / K: the next or previous bill in the list shown
  if (!ctrl && !ev.altKey && !inField && (k === "j" || k === "k") && S.view === "company" && S.tab === "invoices" && !S.reviewTable){
    ev.preventDefault(); billStep(k === "j" ? 1 : -1); return;
  }
  if (k === "Escape" && !inField && S.view === "company"){ goHome(); return; }
  if ((k === "Enter" || k === " ") && ev.target.id === "drop"){ ev.preventDefault(); pickFiles("company"); }
});

document.addEventListener("input", ev => {
  if (reactOwned(ev.target)) return;
  const t = ev.target;
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
  if (t && t.dataset && ["email", "password", "firm", "name"].includes(t.dataset.cloud)){ S.cloudForm = Object.assign({}, S.cloudForm, {[t.dataset.cloud]: t.value}); }
  if (S.view === "company" && S.tab === "bank" && bankInput(t)) return;
  if (S.view === "company" && S.tab === "sales" && salesInput(t)) return;
    const e = curEntry(), cid = S.coId;
  if (t.dataset.x && e && e.status === "draft" && t.type !== "date"){ billSetX(e, t.dataset.x, t.value); return; }
  if (t.dataset.e && e && e.status === "draft" && t.type === "text"){ billSetText(e, t.dataset.e, t.value); return; }
  const co = CO();
  if (t.dataset.c && co && t.type === "text"){ coSetText(t.dataset.c, t.value); return; }
});
// a client's setting typed (saved a moment later); path is "name", "gst.cgst", ...
// a GST or TDS ledger in Client setup, as it was before typing began: put back when what was typed is refused
const SETUP_PREV = {};
function coSetText(path, v){
  const co = CO(); if (!co) return;
  if (/^gst\./.test(path) && !((co.id + path) in SETUP_PREV)) SETUP_PREV[co.id + path] = (co.gst || {})[path.slice(4)] || "";
  setPath(co, path, /^(gstin|pan)$/.test(path) ? String(v).toUpperCase().trim() : v);
  later("c" + co.id, () => Store.saveCompany(co), 600);
  if (path === "name") later("top", renderTop, 200);
}
// a client's setting chosen or finished (ticked, picked, or a box left): checked, saved, and the page drawn again
function coCommit(path, v){
  const co = CO(); if (!co) return;
  if (v !== undefined) setPath(co, path, /^(gstin|pan)$/.test(path) ? String(v).toUpperCase().trim() : v);
  if (path === "gstin"){
    const g = String(co.gstin || "").toUpperCase().trim();
    if (g && !gstinValid(g)) toast("That GSTIN fails its check digit. Check each character.");
    else if (g && Object.values(S.companies).some(c => c.id !== co.id && c.gstin === g)) toast("Another client already has this GSTIN.");
    if (GSTIN_RE.test(g) && !co.pan) co.pan = g.slice(2, 12);
    else if (GSTIN_RE.test(g) && co.pan && String(co.pan).toUpperCase() !== g.slice(2, 12)) toast("This GSTIN’s PAN is " + g.slice(2, 12) + ", but the client’s PAN is " + co.pan + ". Correct one of them.");
  } else if (path === "pan"){
    const p0 = String(co.pan || "").toUpperCase().trim(), g0 = String(co.gstin || "").toUpperCase();
    if (p0 && GSTIN_RE.test(g0) && g0.slice(2, 12) !== p0) toast("The client’s GSTIN " + g0 + " carries PAN " + g0.slice(2, 12) + ", not " + p0 + ". Correct one of them.");
  } else if (/^gst\.(cgst|sgst|igst|rcm(Cgst|Sgst|Igst)(In|Out))$/.test(path)){
    // review of 02-Oct-2026: an optional override, checked against the ledger list: a ledger of another tax head, or
    // one Tally does not have, is refused (and what was there before is put back)
    const k = path.slice(4), val = String((co.gst || {})[k] || "").trim(), prev = (co.id + path) in SETUP_PREV ? SETUP_PREV[co.id + path] : val;
    delete SETUP_PREV[co.id + path];
    const head = /cgst/i.test(k) ? "CGST" : /sgst/i.test(k) ? "SGST" : "IGST", kind = /In$/.test(k) ? "rcm-in" : /Out$/.test(k) ? "rcm-out" : "gst";
    co.gstPin = co.gstPin || {};
    if (!val){ delete co.gstPin[k]; co.gst[k] = ""; }
    else {
      const listed = Ledgers.cid() === co.id && hasLedgerList();
      const c = listed || (S.books && S.books.cid === co.id) ? gstLedgerCheck(co.id, val, head, kind) : (() => { const nh = Ledgers.headOfName(val); return nh && nh !== head && kind !== "rcm-out" ? {ok: false, msg: "\u201c" + val + "\u201d is a" + (/^I/.test(nh) ? "n " : " ") + nh + " ledger, not " + head} : {ok: true, name: val}; })();
      if (!c.ok){ co.gst[k] = prev; toast(c.msg + ". Not taken: " + (prev ? "\u201c" + prev + "\u201d kept." : "left empty.")); }
      else { if (c.name !== prev) co.gstPin[k] = true; co.gst[k] = c.name; }
    }
  }
  Store.saveCompany(co); refreshStats(co.id); render();
}
function coSetTallyName(name){ const co = CO(); if (co && name){ co.tallyName = name; Store.saveCompany(co); Bridge.lastOpenKey = null; render(); } }
// per payment type: the TDS ledger (kind "tds") or the default expense ledger (kind "exp")
function coSetRuleLedger(kind, ruleId, v){ const co = CO(); const m = kind === "tds" ? co.tdsLedgers : co.expenseLedgers; if (!((co.id + kind + ruleId) in SETUP_PREV)) SETUP_PREV[co.id + kind + ruleId] = m[ruleId] || ""; m[ruleId] = v; later("c" + co.id, () => Store.saveCompany(co), 600); }
// a TDS ledger of another section, or an income ledger as the expense default, is refused when the box is left
function coCommitRuleLedger(kind, ruleId){
  const co = CO(); if (!co) return;
  const m = kind === "tds" ? co.tdsLedgers : co.expenseLedgers, val = String(m[ruleId] || "").trim(), pk = co.id + kind + ruleId, prev = pk in SETUP_PREV ? SETUP_PREV[pk] : val;
  delete SETUP_PREV[pk];
  if (!val) return;
  const r = ruleOf(ruleId), listed = Ledgers.cid() === co.id && hasLedgerList();
  let msg = "";
  if (kind === "tds"){ const c = tdsLedgerCheck(co.id, val, Ledgers.sec(r.old)); if (!c.ok && (listed || c.sec)) msg = c.msg; else if (c.ok) m[ruleId] = c.name; }
  else if (listed){ const ex = exactLedger(val); if (ex && Ledgers.cls(co.id, ex) === "income") msg = "\u201c" + ex + "\u201d is an income ledger, not for purchase bills"; }
  if (msg){ m[ruleId] = prev; toast(msg + ". Not taken: " + (prev ? "\u201c" + prev + "\u201d kept." : "left empty.")); }
  Store.saveCompany(co); render();
}
function coSetBlockRule(catId, v){ const co = CO(); co.gstBlock = co.gstBlock || {}; co.gstBlock[catId] = v; Store.saveCompany(co); render(); }
// the firm's own name, shown in the top bar and on reports
// First sign-in of an owner with no firm name yet (review item 32): the name (from sign-up where given), address and
// logo are asked for once; "Later" puts it off until the next sign-in
// a firm record from elsewhere never empties a field filled here (name, address, logo, rules): the filled one is kept
// (review of 02-Oct-2026: a sync replaced the firm's name, address and logo with an empty copy)
function firmMerge(mine, theirs){
  const out = Object.assign(clone(DEFAULT_FIRM), mine || {}), filled = v => v != null && v !== "" && !(typeof v === "object" && !Object.keys(v).length);
  Object.entries(theirs || {}).forEach(([k, v]) => { if (filled(v) || !filled(out[k])) out[k] = v; });
  const fn = String((((S.account || {}).firm) || {}).name || "").trim(); if (fn) out.firmName = fn;
  return out;
}
function firmSetupDue(){
  // "Later" holds for the rest of the day on this computer (review recheck: it came back on every refresh)
  const later = S.firmSetupLater || lsGet("tdsdesk:firmSetupLater") === fmtDate(new Date());
  const fn = String((((S.account || {}).firm) || {}).name || "").trim();
  return !!(S.firm && !S.firm.firmName && !fn && !later && typeof Cloud === "object" && Cloud.on() && S.account && ((S.account.me || {}).role === "owner"));
}
function firmSetupLater(){ S.firmSetupLater = true; lsSet("tdsdesk:firmSetupLater", fmtDate(new Date())); render(); }
function firmSetupSave(d){
  const name = String(d.name || "").trim();
  if (!name){ toast("The firm\u2019s name is needed."); return false; }
  S.firm.firmName = name.slice(0, 120); firmNameToAccount(S.firm.firmName);
  S.firm.firmAddress = String(d.address || "").trim().slice(0, 400);
  if (d.logo !== undefined) S.firm.firmLogo = d.logo || "";
  Store.saveFirm(); toast("Saved."); render();
  return true;
}
// a logo picked from the computer, kept small (a data URL of at most about 150 KB)
function firmLogoRead(file){
  return new Promise((ok, no) => {
    if (!file || !/^image\//.test(file.type)){ no(new Error("Choose a picture (PNG or JPG).")); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 320 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const out = c.toDataURL("image/png");
      out.length > 200000 ? no(new Error("The logo is too large; use a smaller picture.")) : ok(out);
    };
    img.onerror = () => no(new Error("That picture could not be read."));
    img.src = url;
  });
}
// the firm's name goes to the firm account (firms.name, owners only: migration-21) as well as the firm record
function firmNameToAccount(v){
  const n = String(v || "").trim(); if (!n || typeof Cloud !== "object" || !Cloud.on() || !S.account || ((S.account.me || {}).role !== "owner")) return;
  Cloud.rpc("firm_name_set", {p_name: n}).then(() => { if (S.account.firm) S.account.firm.name = n; }, e => { if (!/firm_name_set|PGRST202|schema cache/i.test(String(e && e.message || e))) toast("The firm's name could not be saved to the firm account: " + ((e && e.message) || e)); });
}
function firmSetName(v){ S.firm.firmName = v; later("firm", () => { if (typeof Drafts === "object" && Drafts.hold("firm")) return; Store.saveFirm(); firmNameToAccount(v); }, 600); const el = document.getElementById("firmLine"); if (el) el.textContent = v; }
function setPath(o, path, v){ const k = path.split("."); if (k.length === 2) o[k[0]][k[1]] = v; else o[k[0]] = v; }

document.addEventListener("change", ev => {
  if (reactOwned(ev.target)) return;
  if (ev.target && ev.target.id && ["booksIn", "mastersIn", "tbIn", "tbCheckIn", "twoBIn", "filedIn"].includes(ev.target.id)){ booksChange(ev.target); return; }
  if (ev.target && ev.target.id === "multiBooksIn"){ MultiUp.pick(ev.target); return; }
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
  if (t.dataset && t.dataset.cloud){
    const k = t.dataset.cloud;
    if (["email", "password", "firm", "name"].includes(k)){ S.cloudForm = Object.assign({}, S.cloudForm, {[k]: t.value}); } if (k === "auto"){ Cloud.setCfg({auto: t.checked}); startCloudSync(); } else if (k === "email") Cloud.setCfg({email: t.value.trim()}); return; }
  if (S.view === "company" && S.tab === "bank" && bankChange(t)) return;
  if (S.view === "company" && S.tab === "sales" && salesChange(t)) return;
  if (t.id === "fileIn" || t.id === "camIn"){ const files = Array.from(t.files || []); t.value = ""; handleFiles(files, pickMode); return; }
  if (t.dataset.x === "invoiceDate" && e && e.status === "draft"){ billSetX(e, "invoiceDate", t.value); return; }
  if (t.dataset.gst && e && e.status === "draft"){ billGst(e, t.dataset.gst, t.type === "checkbox" ? t.checked : t.value); return; }
  if (t.dataset.gstrule && CO()){ const co = CO(); co.gstBlock = co.gstBlock || {}; co.gstBlock[t.dataset.gstrule] = t.value; Store.saveCompany(co); render(); return; }
  if (t.hasAttribute("data-bookTds") && e && e.status === "draft"){ billBookTds(e, t.checked); return; }
  if (t.dataset.e && e && e.status === "draft"){
    if (t.type === "checkbox" || t.tagName === "SELECT") billSetChoice(e, t.dataset.e, t.type === "checkbox" ? t.checked : t.value);
    else { Store.saveEntry(cid, e); refreshStats(cid); render(); }
    return;
  }
  const co = CO();
  if (t.dataset.c && co){ coCommit(t.dataset.c, t.type === "checkbox" ? t.checked : t.tagName === "SELECT" ? t.value : undefined); return; }
});
document.addEventListener("dragover", ev => { const d = ev.target.closest && ev.target.closest("#drop,#bankDrop,.bk"); if (d){ ev.preventDefault(); d.classList.add("over"); } });
document.addEventListener("dragleave", ev => { const d = ev.target.closest && ev.target.closest("#drop,#bankDrop"); if (d) d.classList.remove("over"); });
document.addEventListener("drop", ev => {
  const sd = ev.target.closest && ev.target.closest("#salesDrop, .sl");
  if (sd && S.tab === "sales"){ ev.preventDefault(); sd.classList.remove("over"); uploadSales(Array.from(ev.dataTransfer.files || []).filter(f => isPdf(f) || isImage(f))); return; }
  const bd = ev.target.closest && ev.target.closest("#bankDrop, .bk");
  if (bd){ ev.preventDefault(); bd.classList.remove("over"); const was = S.step; Promise.resolve(uploadStatements(Array.from(ev.dataTransfer.files || []).filter(isBankFile))).then(() => { if (was === "collect" && S.step === "collect") goStep("review", "bank"); }); return; }
  const d = ev.target.closest && ev.target.closest("#drop");
  if (!d) return;
  ev.preventDefault(); d.classList.remove("over");
  handleFiles(Array.from(ev.dataTransfer.files || []), "company");
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
  if (reactOwned(ev.target)) return;
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
// the landing page links here with #register or #signin: show that screen (unless already signed in)
function applyEntryHash(){
  const h = String(location.hash || "").toLowerCase();
  if (h !== "#register" && h !== "#signin") return;
  try { history.replaceState(null, "", location.pathname + location.search); } catch (e){}
  if (Cloud.on() || window.claude) return;
  Cloud.setCfg({gate: true});                  // someone who chose "without an account" earlier still sees the screen asked for
  S.signUpOpen = h === "#register"; Cloud.st.error = "";
}
window.addEventListener("hashchange", () => { applyEntryHash(); render(); });
(async function start(){
  takeAuthLink();
  applyEntryHash();
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
  // a page link (#/…) opens that page; otherwise the client open last time
  if (/^#\//.test(location.hash) && typeof Route === "object" && signInNeeded()) Route.pending = location.hash;
  const linked = /^#\//.test(location.hash) && typeof Route === "object" && !signInNeeded() ? await Route.apply(location.hash) : false;
  const last = lsGet("tdsdesk:last") || recentIds()[0];
  if (!linked && last && S.companies[last]) openCompany(last);
  if (typeof Route === "object"){ Route.ready = true; Route.replaceNext = true; }
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
  if (wipeStoredKeys()){ pickEngine(); setTimeout(() => toast("For safety, API keys saved in this browser were removed. Sign in to the firm account to use Claude and Google OCR."), 1500); }
  startBridgePolling();
  startCloudSync();
  if (!Cloud.on()) fetch(Cloud.cfg().url.replace(/\/+$/, "") + "/rest/v1/rpc/signup_info", {method: "POST", headers: {apikey: Cloud.cfg().key, "Content-Type": "application/json"}, body: "{}"})
    .then(r => r.json()).then(j => { S.signupInfo = j || {open: false}; render(); }, () => {});
  render();
})();
window.addEventListener("beforeunload", () => { if (S.coId) lsSet("tdsdesk:last", S.coId); });

// an owner clears a client's wrong GSTIN or PAN, with a reason (review of 02-Oct-2026): on the server through
// client_clear_ids (migration-25; a sync alone can never empty them), then here
async function coClearIds(what){
  const co = CO(), label = what.map(w => w === "gstin" ? "GSTIN " + (co.gstin || "") : "PAN " + (co.pan || "")).join(" and ");
  const ok = await askConfirm({title: "Clear the " + label + "?", ok: "Clear it", danger: true,
    body: "<p>" + esc(co.name) + " will have no " + what.map(w => w.toUpperCase()).join(" or ") + " in FinCom until one is typed again. Returns and checks that need it will say so.</p>" +
      '<label class="f" style="margin-top:12px"><span>Reason (kept with the change)</span><input type="text" id="cbxWhy" autocomplete="off" aria-label="Reason"></label>',
    read: () => ({reason: ((document.getElementById("cbxWhy") || {}).value || "").trim()}),
    validate: v => v.reason ? "" : "Give the reason."});
  if (!ok) return;
  const reason = (ok.data && ok.data.reason) || "";
  if (Cloud.on() && Cloud.st.state !== "off"){
    try { await Cloud.rpc("client_clear_ids", {p_client: co.id, p_what: what, p_reason: reason}); }
    catch (e){ const m = String((e && e.message) || e); toast(/client_clear_ids|does not exist|schema cache/i.test(m) ? "FinCom's cloud is not ready for this yet (migration-25)." : m); return; }
  }
  what.forEach(w => { co[w] = ""; });
  co.idsCleared = (co.idsCleared || []).concat([{what, reason, at: new Date().toISOString(), by: (Cloud.st && Cloud.st.email) || ""}]).slice(-20);
  Store.saveCompany(co); toast("Cleared. Type the right " + what.map(w => w.toUpperCase()).join(" and ") + " when you have it."); render();
}
