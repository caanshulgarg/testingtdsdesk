/* ================================================================== */
/* Two-step sign-in (an authenticator-app code) and signing out when  */
/* nobody has used the page for a while                                */
/* ================================================================== */
// Optional for firm work: once someone turns it on, the server shows nothing of the firm without the code
// (my_firm() is empty). Platform administration (all firms, credit, secrets) always needs it: is_superadmin() is
// false without it, so the administrator is asked for the code only when opening administration.
Cloud.aal = function(){
  const s = this.sess();
  try { return JSON.parse(atob(String(s.access_token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal || "aal1"; } catch (e){ return "aal1"; }
};
Cloud.authApi = async function(path, method, body){
  const c = this.cfg(), s = this.sess();
  const r = await fetch(c.url.replace(/\/+$/, "") + "/auth/v1/" + path, {method: method || "GET",
    headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: body ? JSON.stringify(body) : undefined});
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
function viewTwoStep(){
  const m = Cloud.st.mfa || {}, busy = Cloud.st.busy;
  let h = '<div class="signin"><div class="signin-box"><h1>Two-step sign-in</h1>';
  if (m.forAdmin) h += '<p class="note" style="margin:8px 0 0">Platform administration changes every firm and the credit, so it needs the code from your phone. Your firm work does not.</p>';
  if (m.need === "code"){
    h += '<p class="note" style="margin:8px 0 14px">Open the authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar) and type the 6-digit code for FinCom.</p>';
  } else if (!m.factorId){
    h += '<p class="note" style="margin:8px 0 14px">' + (m.required ? "This account must" : "You can") +
      " protect this account with a code from an authenticator app on your phone, as well as the password. Install Google Authenticator or Microsoft Authenticator, then press the button.</p>" +
      '<div class="row"><button class="btn primary" data-act="mfaStart"' + (busy ? " disabled" : "") + ">Set it up</button></div>";
  } else {
    h += '<p class="note" style="margin:8px 0 10px">1. In the authenticator app choose <b>Add</b> → <b>Scan a QR code</b> and scan this.</p>' +
      (m.qr ? '<p style="text-align:center"><' + 'img alt="QR code for the authenticator app" style="width:190px;height:190px;background:#fff;padding:6px;border-radius:8px" src="' + esc(/^data:image\/svg\+xml|^data:image\/png/.test(m.qr) ? m.qr : "") + '"></p>' : "") +
      '<p class="note" style="margin:6px 0">Cannot scan? Type this key in the app instead: <code style="user-select:all;word-break:break-all">' + esc(m.secret || "") + "</code></p>" +
      '<p class="note" style="margin:10px 0 6px">2. Type the 6-digit code the app now shows.</p>';
  }
  if (m.need === "code" || m.factorId){
    h += '<label class="f"><span>Code</span><input type="text" id="mfaCode" data-fk="mfacode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456"></label>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="mfaVerify"' + (busy ? " disabled" : "") + ">" + (busy ? "Checking…" : "Continue") + "</button></div>";
  }
  if (Cloud.st.error) h += '<p class="bk-warn" style="margin-top:10px">' + esc(Cloud.st.error) + "</p>";
  h += '<p class="note" style="margin-top:14px">' + (m.required || (m.need === "code" && !m.forAdmin) ? "" : '<button class="linkbtn" data-act="mfaCancel">Not now</button> · ') +
    'Lost your phone? Ask the platform administrator to reset your two-step sign-in. <button class="linkbtn" data-act="mfaSignOut">Sign out</button></p>';
  return h + "</div></div>";
}
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
    try { await Cloud.mfaVerify(code); toast("Two-step sign-in done."); auditEvent("signin.mfa", ""); startCloudSync(); loadAccount(true).then(() => render()); }
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

/* ---------- signing out: everywhere it happens, and after a quiet spell ---------- */
function signOutHere(msg, clearLocal){
  auditEvent("signout", msg || "");
  const s = Cloud.sess();
  // tell the server too, so the refresh token cannot be used again
  if (s && s.access_token){ const c = Cloud.cfg(); fetch(c.url.replace(/\/+$/, "") + "/auth/v1/logout", {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token}}).catch(() => {}); }
  Cloud.signOut(); clearInterval(cloudTimer); S.account = null; S.adminData = null; S.backups = null; S.settingsTab = null;
  Cloud.setCfg({gate: true});
  S.view = "home"; S.coId = null;
  const after = () => { toast(msg || "Signed out."); render(); };
  // the page is reloaded after clearing, so nothing of the firm stays in memory either
  if (clearLocal) clearLocalCopy().then(() => location.reload(), () => location.reload()); else after();
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
const IDLE_MIN_DEFAULT = 30;
let idleLast = Date.now();
["pointerdown", "keydown", "wheel", "touchstart"].forEach(e => document.addEventListener(e, () => { idleLast = Date.now(); }, {passive: true, capture: true}));
setInterval(() => {
  if (!Cloud.on() || window.claude) return;
  const mins = num(lsGet("tdsdesk:idlemin")) || IDLE_MIN_DEFAULT;
  if (Date.now() - idleLast > mins * 60000){ idleLast = Date.now(); signOutHere("Signed out after " + mins + " minutes without use. Sign in again to carry on."); }
}, 30000);
// Settings, how long before signing out (app/src/screens/Account.jsx)
function idleMin(){ return num(lsGet("tdsdesk:idlemin")) || IDLE_MIN_DEFAULT; }
function idleSet(v){ lsSet("tdsdesk:idlemin", String(Math.max(5, Math.min(240, num(v) || IDLE_MIN_DEFAULT)))); toast("Saved: sign out after " + v + " minutes without use."); render(); }

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
    if (prev) toast("Your last sign-in: " + new Date(prev.at).toLocaleString("en-IN", {day: "numeric", month: "short", hour: "numeric", minute: "2-digit"}) + ", " + S.lastSignIn.device + ". Not you? Change your password in Settings.");
  } catch (e){}
}
