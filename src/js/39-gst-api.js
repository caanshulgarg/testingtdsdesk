/* ================================================================== */
/* GST API: the taxpayer's OTP sign-in and GSTR-2B fetched from the   */
/* portal through FYN Gateway, by the firm's own server function     */
/* ================================================================== */
// The FYN key and secret stay in the firm's Supabase project (function gst-api). The taxpayer's session (app_key, auth
// token, SEK) is kept only in this tab's memory: never saved, gone when the tab is closed or the portal's session ends.
const GSTAPI = {
  sess: {},
  on(){ return typeof Cloud === "object" && Cloud.on() && !!S.account; },
  url(){ return String(Cloud.cfg().url || "").replace(/\/+$/, "") + "/functions/v1/gst-api"; },
  async call(body, retry){
    const c = Cloud.cfg(), s = Cloud.sess();
    const r = await fetch(this.url(), {method: "POST", headers: {"Content-Type": "application/json", apikey: c.key, Authorization: "Bearer " + (s && s.access_token)}, body: JSON.stringify(body)});
    if (r.status === 401 && !retry){ await Cloud.refreshToken(); return this.call(body, true); }
    let j = null; try { j = await r.json(); } catch (e){}
    if (!j) throw new Error("The GST API answered HTTP " + r.status + ".");
    if (!j.ok) throw new Error(j.error || "The GST API refused the request.");
    return j;
  },
  ready(ym){ const nx = GSTR.nextYm(ym), t = GSTF.today(); return t.slice(0, 7).replace("-", "") > nx || (t.slice(0, 7).replace("-", "") === nx && +t.slice(8, 10) >= 14); },
  gstinOf(reg){ return ((((S.books || {}).meta || {}).gstins) || []).find(g => g.slice(0, 2) === reg) || ""; },
  user(reg){ return (typeof GSTSet === "object" ? GSTSet.peek(reg).portalUser : "") || ""; },
  live(gstin){ const x = this.sess[gstin]; return x && x.auth_token && x.until > Date.now() ? x : null; },
  async otp(reg){
    const gstin = this.gstinOf(reg), username = this.user(reg);
    const j = await this.call({action: "otp", gstin, username});
    this.sess[gstin] = {app_key: j.app_key, sentAt: Date.now()};
    return j;
  },
  async auth(reg, otp){
    const gstin = this.gstinOf(reg), username = this.user(reg), x = this.sess[gstin];
    if (!x || !x.app_key) throw new Error("Send the OTP first.");
    const j = await this.call({action: "auth", gstin, username, otp});
    Object.assign(x, {auth_token: j.auth_token, sek: j.sek, until: Date.now() + Math.max(5, (j.expiryMinutes || 120) - 2) * 60000});
    return x;
  },
  // 2B for a month (YYYYMM), in the same place as a 2B file brought in
  async twoB(reg, ym){
    const gstin = this.gstinOf(reg), x = this.live(gstin);
    if (!x) throw new Error("Connect with the taxpayer’s OTP first.");
    const j = await this.call({action: "2b", gstin, username: this.user(reg), period: ym.slice(4, 6) + ym.slice(0, 4), auth_token: x.auth_token, sek: x.sek, app_key: x.app_key});
    const t = GST2B.fromJson({data: j.data});
    if (!t.gstin || !t.ym) throw new Error("The 2B for " + GSTR.label(ym) + " came back without its GSTIN or period.");
    const b = S.books; b.twoBs = b.twoBs || {}; b.twoBs[t.gstin + "|" + t.period] = Object.assign(t, {source: "api", fetchedAt: new Date().toISOString()});
    delete b.twoB; GST2B._memo = null; GSTR._carry = null;
    return t;
  }
};
function viewGstApiCard(b){
  const reg = S.gstReg || (((b.meta || {}).gstins || [])[0] || "").slice(0, 2), gstin = GSTAPI.gstinOf(reg);
  if (!gstin) return "";
  let h = '<section class="dash-card" style="margin-bottom:12px"><h3>Fetch 2B from the portal</h3>';
  if (!GSTAPI.on()) return h + '<p class="note">Sign in to the firm account (top right) to fetch 2B straight from the GST portal through the firm’s GST API connection. Until then, bring in the JSON files downloaded from the portal.</p></section>';
  const user = GSTAPI.user(reg), live = GSTAPI.live(gstin), pend = GSTAPI.sess[gstin] && !live, busy = S.gstApiBusy;
  if (!user) return h + '<p class="note">Type ' + esc(gstin) + "’s GST portal username in " + gstSetLink("GST settings") + " to connect. The taxpayer must also allow API access on the portal (My Profile → Manage API Access).</p></section>";
  if (!live){
    h += '<p class="note">' + esc(gstin) + " · portal user <b>" + esc(user) + "</b>. The OTP goes to the taxpayer’s registered mobile and email; the taxpayer must have allowed API access on the portal (My Profile → Manage API Access).</p>" +
      '<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><button class="btn small' + (pend ? "" : " primary") + '" data-gapi="otp"' + (busy ? " disabled" : "") + ">" + (pend ? "Send the OTP again" : "Send OTP") + "</button>" +
      (pend ? '<input type="text" inputmode="numeric" maxlength="6" data-gapiotp data-fk="gapiotp" placeholder="6-digit OTP" style="width:130px"><button class="btn small primary" data-gapi="auth"' + (busy ? " disabled" : "") + ">Connect</button>" : "") + "</div>";
    return h + (S.gstApiMsg ? '<p class="note">' + esc(S.gstApiMsg) + "</p>" : "") + "</section>";
  }
  const have = new Set(GST2B.all2b(reg).map(t => t.ym).concat(Object.values(b.twoBs || {}).filter(t => t.gstin === gstin).map(t => t.ym)));
  // a month's 2B is made on the 14th of the next month
  const fy = S.gstYm ? GSTRev.fyMonths(S.gstYm) : [], due = fy.filter(GSTAPI.ready);
  const missing = due.filter(m => !have.has(m)), until = new Date(live.until);
  h += '<p class="note">Connected to the portal for ' + esc(gstin) + " until " + String(until.getHours()).padStart(2, "0") + ":" + String(until.getMinutes()).padStart(2, "0") + ".</p>" +
    '<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><select data-gapiym style="width:auto">' + fy.map(m => '<option value="' + m + '"' + (m === (S.gstApiYm || S.gstYm) ? " selected" : "") + ">" + GSTR.label(m) + (have.has(m) ? " ✓" : "") + "</option>").join("") + "</select>" +
    '<button class="btn small primary" data-gapi="one"' + (busy ? " disabled" : "") + ">Fetch 2B</button>" +
    (missing.length ? '<button class="btn small" data-gapi="all"' + (busy ? " disabled" : "") + ">Fetch the " + missing.length + " month" + (missing.length === 1 ? "" : "s") + " not here yet</button>" : "") + "</div>";
  return h + (S.gstApiMsg ? '<p class="note">' + esc(S.gstApiMsg) + "</p>" : "") + "</section>";
}
if (typeof document !== "undefined"){
  document.addEventListener("change", e => { const t = e.target; if (t.dataset && t.dataset.gapiym !== undefined){ S.gstApiYm = t.value; } });
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-gapi]"); if (!t || !S.books || S.gstApiBusy) return;
    const reg = S.gstReg || (((S.books.meta || {}).gstins || [])[0] || "").slice(0, 2), a = t.dataset.gapi;
    const run = async (msg, f) => { S.gstApiBusy = true; S.gstApiMsg = msg; render(); try { S.gstApiMsg = await f(); } catch (err){ S.gstApiMsg = "Not done: " + ((err && err.message) || err); } S.gstApiBusy = false; render(); };
    if (a === "otp") return run("Asking the portal to send the OTP…", async () => { await GSTAPI.otp(reg); return "OTP sent to the taxpayer’s registered mobile and email. Type it and press Connect."; });
    if (a === "auth"){ const i = document.querySelector("[data-gapiotp]"), otp = i ? i.value.trim() : "";
      return run("Connecting…", async () => { await GSTAPI.auth(reg, otp); return "Connected."; }); }
    const months = a === "one" ? [S.gstApiYm || S.gstYm] : (() => { const gstin = GSTAPI.gstinOf(reg), have = new Set(Object.values(S.books.twoBs || {}).filter(x => x.gstin === gstin).map(x => x.ym));
      return GSTRev.fyMonths(S.gstYm).filter(m => !have.has(m) && GSTAPI.ready(m)); })();
    return run("Fetching 2B…", async () => {
      const got = [], failed = [];
      for (const m of months){ S.gstApiMsg = "Fetching 2B for " + GSTR.label(m) + "…"; render();
        try { const x = await GSTAPI.twoB(reg, m); got.push(GSTR.label(m) + " (" + x.rows.length + ")"); } catch (err){ failed.push(GSTR.label(m) + ": " + ((err && err.message) || err)); } }
      if (got.length) saveBooks();
      return (got.length ? "2B fetched: " + got.join(", ") + "." : "") + (failed.length ? " Not fetched — " + failed.join("; ") : "");
    });
  });
}
