/* ================================================================== */
/* GST API: the taxpayer's OTP sign-in and GSTR-2B fetched from the   */
/* portal through TaxPro GSP, by the firm's own server function      */
/* ================================================================== */
// The TaxPro ASP password stays in the firm's Supabase project (function gst-taxpro; TaxPro's Decrypted API does GSTN's
// encryption). The taxpayer's portal session is kept by that function, encrypted, and renewed in the background, so one
// OTP lasts the taxpayer's API access period (up to 30 days) for every user of the firm. This tab only knows until when
// each GSTIN is connected, never the token.
const GSTAPI = {
  sess: {}, seen: {},
  on(){ return typeof Cloud === "object" && Cloud.on() && !!S.account; },
  url(){ return String(Cloud.cfg().url || "").replace(/\/+$/, "") + "/functions/v1/gst-taxpro"; },
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
  gstinOf(reg){ return ((GSTR.gstins(S.books)) || []).find(g => g.slice(0, 2) === reg) || ""; },
  user(reg){ return (typeof GSTSet === "object" ? GSTSet.peek(reg).portalUser : "") || ""; },
  live(gstin){ const x = this.sess[gstin]; return x && x.connectedAt && !x.error && x.until > Date.now() ? x : null; },
  // what the server keeps for this GSTIN: asked again at most every 10 minutes (the server renews in the background)
  async status(gstin){
    this.seen[gstin] = Date.now();
    const j = await this.call({action: "status", gstins: [gstin]}), x = (j.sessions || [])[0];
    this.sess[gstin] = x ? Object.assign(this.sess[gstin] || {}, {until: Date.parse(x.until), connectedAt: x.connectedAt, error: x.error || ""}) : (this.sess[gstin] && this.sess[gstin].sentAt ? {sentAt: this.sess[gstin].sentAt} : undefined);
  },
  stale(gstin){ return !this.seen[gstin] || Date.now() - this.seen[gstin] > 10 * 60000; },
  async otp(reg){
    const gstin = this.gstinOf(reg), username = this.user(reg);
    const j = await this.call({action: "otp", gstin, username});
    this.sess[gstin] = {sentAt: Date.now()};
    return j;
  },
  async auth(reg, otp){
    const gstin = this.gstinOf(reg), username = this.user(reg);
    if (!this.sess[gstin]) throw new Error("Send the OTP first.");
    const j = await this.call({action: "auth", gstin, username, otp});
    this.sess[gstin] = {until: Date.parse(j.until), connectedAt: new Date().toISOString(), error: ""}; this.seen[gstin] = Date.now();
    return this.sess[gstin];
  },
  // 2B for a month (YYYYMM), in the same place as a 2B file brought in
  async twoB(reg, ym){
    const gstin = this.gstinOf(reg), x = this.live(gstin);
    if (!x) throw new Error("Connect with the taxpayer’s OTP first.");
    const j = await this.call({action: "2b", gstin, username: this.user(reg), period: ym.slice(4, 6) + ym.slice(0, 4)});
    const t = GST2B.fromJson({data: j.data});
    if (!t.gstin || !t.ym) throw new Error("The 2B for " + GSTR.label(ym) + " came back without its GSTIN or period.");
    const b = S.books; b.twoBs = b.twoBs || {}; b.twoBs[t.gstin + "|" + t.period] = Object.assign(t, {source: "api", fetchedAt: new Date().toISOString()});
    delete b.twoB; GST2B._memo = null; GSTR._carry = null;
    return t;
  }
};
// the card is drawn by React (app/src/screens/GstApiCard.jsx) in this place
function viewGstApiCard(b){ return GSTAPI.gstinOf(S.gstReg || ((GSTR.gstins(b) || [])[0] || "").slice(0, 2)) ? '<div data-react="GstApiCard"></div>' : ""; }
