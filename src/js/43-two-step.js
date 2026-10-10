/* ================================================================== */
/* Two-step sign-in (an authenticator-app code), where the session is */
/* kept, one token refresh at a time across tabs, and signing out     */
/* ================================================================== */
// Optional for firm work: once someone turns it on, the server shows nothing of the firm without the code
// (my_firm() is empty). Platform administration (all firms, credit, secrets) always needs it: is_superadmin() is
// false without it, so the administrator is asked for the code only when opening administration.
Cloud.aal = function(){
  const s = this.sess();
  try { return JSON.parse(atob(String(s.access_token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal || "aal1"; } catch (e){ return "aal1"; }
};

/* ---------- the session: where it is kept, and one refresh at a time across tabs (section D, 03-Oct-2026) ---------- */
// Cloud.sess/setSess/refreshToken/signIn are first written in src/js/27 and completed here. "Keep me signed in" (the
// tick box on the sign-in form, ticked by default) keeps the session in localStorage, shared by every tab of this
// browser and still there tomorrow; unticked keeps it in sessionStorage: this tab only, gone when the browser closes.
// A refresh keeps the session where it is. Nothing signs anyone out by itself (the idle timer of earlier builds is gone).
const SESS_KEY = "tdsdesk:cloudsess";
Cloud.keep = function(){ return lsGet("tdsdesk:keep") !== "0"; };
Cloud.sess = function(){
  let raw = null;
  try { raw = sessionStorage.getItem(SESS_KEY); } catch (e){}
  if (raw == null) raw = lsGet(SESS_KEY);
  try { return JSON.parse(raw || "null"); } catch (e){ return null; }
};
Cloud.setSess = function(s){
  if (!s){ lsDel(SESS_KEY); try { sessionStorage.removeItem(SESS_KEY); } catch (e){} return; }
  const txt = JSON.stringify(s);
  if (this.keep()){ lsSet(SESS_KEY, txt); try { sessionStorage.removeItem(SESS_KEY); } catch (e){} }
  else { try { sessionStorage.setItem(SESS_KEY, txt); lsDel(SESS_KEY); } catch (e){ lsSet(SESS_KEY, txt); } }
};
const cloudSignInBase = Cloud.signIn;
Cloud.signIn = async function(email, password){
  const box = document.querySelector('[data-cloud="keep"]');
  if (box) lsSet("tdsdesk:keep", box.checked ? "1" : "0");
  const r = await cloudSignInBase.call(this, email, password);
  S.signedOutWhy = "";
  setTimeout(flushAuditLater, 2500);       // a sign-out the server could not be told of at the time (its token was dead)
  return r;
};
// The lock: tdsdesk:refreshing in localStorage names the tab refreshing now. A second tab waits (a storage event, or
// 300 ms) and then finds the session the first tab wrote. Why: Supabase rotates refresh tokens, and a refresh token
// offered a second time (two tabs refreshing in the same moment) is refused and ends the whole session, in every tab.
const sessLock = {
  id: Math.random().toString(36).slice(2),
  held(){ try { const l = JSON.parse(lsGet("tdsdesk:refreshing") || "null"); return l && Date.now() - num(l.at) < 15000 ? l : null; } catch (e){ return null; } },
  async take(){
    const t0 = Date.now();
    while (Date.now() - t0 < 12000){
      const l = this.held();
      if (!l){ lsSet("tdsdesk:refreshing", JSON.stringify({at: Date.now(), by: this.id})); await new Promise(r => setTimeout(r, 25)); const m = this.held(); if (m && m.by === this.id) return true; continue; }
      if (l.by === this.id) return true;
      await new Promise(r => { let t; const done = () => { window.removeEventListener("storage", h); clearTimeout(t); r(); };
        const h = ev => { if (ev.key === "tdsdesk:refreshing" || ev.key === SESS_KEY) done(); }; window.addEventListener("storage", h); t = setTimeout(done, 300); });
    }
    return false;    // waited 12 s: the other tab must have stopped; go ahead
  },
  free(){ const l = this.held(); if (l && l.by === this.id) lsDel("tdsdesk:refreshing"); }
};
const SESS_REFUSED = /refresh token|invalid_grant|invalid grant|already used|not found|revoked|session/i;
Cloud.refreshToken = function(used){
  const s0 = this.sess();
  if (used && s0 && s0.access_token && s0.access_token !== used) return Promise.resolve();   // already newer (another request or tab did it)
  if (this._refreshing) return this._refreshing;
  this._refreshing = (async () => {
    const s = this.sess();
    if (!s || !s.refresh_token) throw new Error("Signed out");
    const shared = !!lsGet(SESS_KEY);
    if (shared) await sessLock.take();
    try {
      const now = this.sess();
      if (!now || !now.refresh_token) throw new Error("Signed out");
      if (now.access_token !== s.access_token || now.refresh_token !== s.refresh_token) return;   // another tab refreshed while we waited: use its session
      let j;
      try { j = await this.authCall("token?grant_type=refresh_token", {refresh_token: s.refresh_token}); }
      catch (e){
        const again = this.sess();
        if (again && again.refresh_token !== s.refresh_token) return;   // refused, but another tab holds a newer session: that one is used
        if (!SESS_REFUSED.test(String(e.message))) throw e;             // the network, not the server: the session stays, the next call tries again
        sessionEnded("the firm account no longer accepts this sign-in (" + e.message + ")");
        throw new Error("Signed out");
      }
      const cur = this.sess();
      if (!cur || cur.refresh_token !== s.refresh_token) return;        // signed out meanwhile, or another tab got there first
      this.setSess(Object.assign({}, s, {access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token, at: Date.now(), expires_in: j.expires_in || 3600}));
    } finally { if (shared) sessLock.free(); }
  })().finally(() => { this._refreshing = null; });
  return this._refreshing;
};
// a session that cannot continue: said in words on the sign-in page, the page kept for after signing in, nothing lost
function sessionEnded(reason){
  if (!Cloud.sess()) return;
  if (typeof Route === "object" && !signInNeeded()) Route.pending = Route.of();
  signOutHere("Your sign-in ended: " + reason, false, "Your sign-in ended: " + reason + ". Sign in again; your work is kept.");
}
// the other tabs of this browser: signed out there means signed out here, said so; signed in there brings this tab in
window.addEventListener("storage", ev => {
  if (!ev || ev.key !== SESS_KEY) return;
  if (!ev.newValue){
    if (Cloud.st.state === "off" && !Cloud.st.firm && !Cloud.st.email) return;   // this tab was not signed in
    if (typeof Route === "object" && !signInNeeded()) Route.pending = Route.of();
    signOutHere("Signed out in another tab.", false, "Your sign-in ended: you signed out in another tab or window. Sign in again; your work is kept.", true);
  } else if (!ev.oldValue && Cloud.st.state === "off" && !Cloud.st.firm){
    S.signedOutWhy = ""; Cloud.st.error = ""; Cloud.st.busy = ""; S.cloudForm = null;
    startCloudSync(); loadAccount(true).then(() => render(), () => render()); render();
  }
});
Cloud.authApi = async function(path, method, body, retry){
  if (!retry) await this.fresh().catch(() => {});
  const c = this.cfg(), s = this.sess();
  const r = await fetch(c.url.replace(/\/+$/, "") + "/auth/v1/" + path, {method: method || "GET",
    headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: body ? JSON.stringify(body) : undefined});
  if (r.status === 401 && !retry){ await this.refreshToken(s.access_token); return this.authApi(path, method, body, true); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || j.message || j.error_description || ("Request failed (" + r.status + ")"));
  return j;
};
Cloud.factors = async function(){
  const u = await this.authApi("user");
  return (u.factors || []).filter(f => f.factor_type === "totp");
};
// asks the server whether this sign-in still needs the code; sets st.mfa when it does
Cloud.checkMfa = async function(){
  if (!this.on()) { this.st.mfa = null; return null; }
  let st;
  try { st = await this.rpc("mfa_status"); this.st.mfaInfo = st || null; }
  catch (e){ if (/mfa_status|could not find|404/i.test(e.message)) { this.st.mfa = null; return null; } throw e; }   // a server without two-step yet
  if (!st || st.ok !== false){ this.st.mfa = null; return null; }
  const list = await this.factors();
  const good = list.find(f => f.status === "verified");
  if (good){ this.st.mfa = {need: "code", factorId: good.id}; return this.st.mfa; }
  this.st.mfa = {need: "enrol", required: true};
  return this.st.mfa;
};
// a new authenticator entry: the QR code and the key to type in by hand
Cloud.enrolStart = async function(){
  // an earlier half-finished set-up is dropped first
  for (const f of await this.factors()) if (f.status !== "verified") { try { await this.authApi("factors/" + f.id, "DELETE"); } catch (e){} }
  const j = await this.authApi("factors", "POST", {factor_type: "totp", friendly_name: "FinCom " + new Date().toISOString().slice(0, 16)});
  this.st.mfa = Object.assign({}, this.st.mfa || {need: "enrol"}, {factorId: j.id, qr: (j.totp || {}).qr_code || "", secret: (j.totp || {}).secret || ""});
  return this.st.mfa;
};
Cloud.mfaVerify = async function(code){
  const m = this.st.mfa || {};
  if (!m.factorId) throw new Error("Start again: no authenticator entry is waiting.");
  const ch = await this.authApi("factors/" + m.factorId + "/challenge", "POST", {});
  const j = await this.authApi("factors/" + m.factorId + "/verify", "POST", {challenge_id: ch.id, code: String(code).replace(/\s+/g, "")});
  const s = this.sess();
  this.setSess(Object.assign({}, s, {access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token, at: Date.now(), expires_in: j.expires_in || 3600}));
  this.st.mfa = null;
  await this.whoAmI();
  return true;
};
async function mfaAction(act){
  const done = () => { Cloud.st.busy = ""; render(); };
  if (act === "mfaStart"){
    Cloud.st.busy = "1"; Cloud.st.error = ""; render();
    try { await Cloud.enrolStart(); } catch (e){ Cloud.st.error = e.message; }
    done(); const c = document.getElementById("mfaCode"); if (c) c.focus();
  } else if (act === "mfaVerify"){
    const code = ((document.getElementById("mfaCode") || {}).value || "").trim();
    if (!/^\d{6}$/.test(code.replace(/\s+/g, ""))){ toast("Type the 6-digit code from the app."); return; }
    Cloud.st.busy = "1"; Cloud.st.error = ""; render();
    try { await Cloud.mfaVerify(code); toast("Two-step sign-in done."); auditEvent("signin.mfa", ""); setTimeout(flushAuditLater, 2500); startCloudSync(); loadAccount(true).then(() => render()); }
    catch (e){ Cloud.st.error = /invalid|expired/i.test(e.message) ? "That code did not match. Check the phone’s clock is right and try the newest code." : e.message; }
    done();
  } else if (act === "mfaCancel"){ Cloud.st.mfa = null; Cloud.st.error = ""; render(); }
  else if (act === "mfaSignOut"){ signOutHere("Signed out."); }
  else if (act === "mfaOptIn"){ Cloud.st.mfa = {need: "enrol", required: false}; render(); }
  else if (act === "mfaAdmin"){
    // the administrator unlocks administration: the code if set up, else set it up now
    Cloud.st.busy = "1"; render();
    try { const good = (await Cloud.factors()).find(f => f.status === "verified"); Cloud.st.mfa = good ? {need: "code", factorId: good.id, forAdmin: true} : {need: "enrol", required: false, forAdmin: true}; }
    catch (e){ toast(e.message); }
    Cloud.st.busy = ""; render();
  }
}
document.addEventListener("click", ev => {
  const t = ev.target.closest && ev.target.closest("[data-act]");
  if (!t || !/^mfa(Start|Verify|Cancel|SignOut|OptIn|Admin)$/.test(t.dataset.act)) return;
  ev.preventDefault(); ev.stopImmediatePropagation(); mfaAction(t.dataset.act);
}, true);
document.addEventListener("keydown", ev => { if (ev.key === "Enter" && ev.target && ev.target.id === "mfaCode"){ ev.preventDefault(); mfaAction("mfaVerify"); } }, true);

/* ---------- the audit trail: what people did, kept by the server, never changed ---------- */
function auditEvent(what, detail, cid){
  if (!Cloud.on() || !Cloud.st.firm || Cloud.st.mfa) return;
  Cloud.api("activity", {method: "POST", headers: {Prefer: "return=minimal"},
    body: {firm_id: Cloud.st.firm, client_id: String(cid || ""), what: String(what).slice(0, 60), detail: String(detail || "").slice(0, 500)}}).catch(() => {});
}

/* ---------- signing out: everywhere it happens, always with its reason ---------- */
// msg: the reason, as written to the activity log; why: what the sign-in page says (empty when the person chose to
// sign out); local: another tab already told the server (the storage listener above)
function signOutHere(msg, clearLocal, why, local){
  const s = Cloud.sess();
  if (!local) auditSignOut(msg || "Signed out.", s);
  // tell the server too, so the refresh token cannot be used again
  if (!local && s && s.access_token){ const c = Cloud.cfg(); fetch(c.url.replace(/\/+$/, "") + "/auth/v1/logout", {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token}}).catch(() => {}); }
  Cloud.signOut(); clearInterval(cloudTimer); S.account = null; S.adminData = null; S.backups = null; S.settingsTab = null;
  Cloud.setCfg({gate: true});
  S.signedOutWhy = why || "";
  S.view = "home"; S.coId = null;
  const after = () => { toast(msg || "Signed out."); render(); };
  // the page is reloaded after clearing, so nothing of the firm stays in memory either
  if (clearLocal) clearLocalCopy().then(() => location.reload(), () => location.reload()); else after();
}
// The sign-out goes to the activity log with the token in hand, before the session is cleared (auditEvent would read
// the session after it is gone and send nothing: the log showed sign-ins and never a sign-out). When the server will
// not take it now (the token is dead), it is kept and sent after the next sign-in.
function auditSignOut(detail, s){
  const firm = Cloud.st.firm;
  if (!s || !s.access_token || !firm) return;
  const row = {firm_id: firm, client_id: "", what: "signout", detail: String(detail || "").slice(0, 500)};
  const keep = () => { try { const q = JSON.parse(lsGet("tdsdesk:auditlater") || "[]"); q.push(row); lsSet("tdsdesk:auditlater", JSON.stringify(q.slice(-20))); } catch (e){} };
  const c = Cloud.cfg();
  try {
    fetch(c.url.replace(/\/+$/, "") + "/rest/v1/activity", {method: "POST", keepalive: true, headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json", Prefer: "return=minimal"}, body: JSON.stringify(row)})
      .then(r => { if (!r.ok) keep(); }, keep);
  } catch (e){ keep(); }
}
function flushAuditLater(){
  if (!Cloud.on() || !Cloud.st.firm || Cloud.st.mfa) return;
  let q = []; try { q = JSON.parse(lsGet("tdsdesk:auditlater") || "[]"); } catch (e){}
  if (!q.length) return;
  lsDel("tdsdesk:auditlater");
  q.forEach(row => auditEvent(row.what, row.detail + " (recorded after signing in again)"));
}
// Settings → Firm account, the owner: every computer and phone signed in to this account is signed out (Settings
// screen: app/src/screens/Account.jsx)
async function signOutAll(){
  const a = await askConfirm({title: "Sign out of all devices?", ok: "Sign out everywhere", body: '<p class="note">Every computer and phone signed in to your account is signed out, this one too. Work already synced stays in the firm account.</p>'});
  if (!a) return;
  try { await Cloud.authApi("logout?scope=global", "POST"); }
  catch (e){ toast("Could not reach the firm account: " + e.message); return; }
  signOutHere("Signed out of all devices.", false, "");
}
// removes this firm's copy from this browser (only after everything has reached the firm account)
async function clearLocalCopy(){
  try { const d = IDBStore.dbp && await IDBStore.dbp; if (d && d.close) d.close(); IDBStore.dbp = null; } catch (e){}
  const names = ["tdsdesk", "tdsdesk-bank", "tdsdesk-work", "tdsdesk-files", "tdsdesk-docs"];
  try { if (indexedDB.databases) (await indexedDB.databases()).forEach(d => { if (d.name && /^tdsdesk/.test(d.name) && !names.includes(d.name)) names.push(d.name); }); } catch (e){}
  await Promise.all(names.map(n => new Promise(r => { try { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(); } catch (e){ r(); } })));
  try { Object.keys(localStorage).filter(k => /^tdsdesk:/.test(k) && !/^tdsdesk:(cloud|bridge)$/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e){}
  S.companies = {}; S.data = {}; S.inbox = {}; S.docq = {};
}
// There is no automatic sign-out (section D, 03-Oct-2026): the idle timer of earlier builds (30 minutes without a
// click, Settings 5-240) signed out every tab of the browser from a tab left in the background, and the person at
// the keyboard landed on the sign-in page at their next click without a word of why.

/* ---------- last sign-in: shown after signing in, so a sign-in you did not make stands out ---------- */
function deviceName(ua){
  ua = String(ua || "");
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "a browser";
  const o = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return b + (o ? " on " + o : "");
}
async function loadLastSignIn(){
  const s = Cloud.sess();
  if (!s || !s.user_id || !Cloud.st.firm) return;
  try {
    const rows = await Cloud.api("activity?select=at,detail&user_id=eq." + encodeURIComponent(s.user_id) + "&what=eq.signin&order=at.desc&limit=2");
    const prev = (rows || [])[1];
    S.lastSignIn = prev ? {at: prev.at, device: deviceName(prev.detail)} : null;
    if (prev) toast("Your last sign-in: " + fmtDateTime(prev.at) + ", " + S.lastSignIn.device + ". Not you? Change your password in Settings.");
  } catch (e){}
}
