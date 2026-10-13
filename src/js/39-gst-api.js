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
    if (!retry) await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess();
    const r = await fetch(this.url(), {method: "POST", headers: {"Content-Type": "application/json", apikey: c.key, Authorization: "Bearer " + (s && s.access_token)}, body: JSON.stringify(body)});
    if (r.status === 401 && !retry){ await Cloud.refreshToken(s && s.access_token); return this.call(body, true); }
    let j = null; try { j = await r.json(); } catch (e){}
    if (!j) throw new Error("The GST API answered HTTP " + r.status + ".");
    if (!j.ok) throw new Error(j.error || "The GST API refused the request.");
    return j;
  },
  ready(ym){ const nx = GSTR.nextYm(ym), t = GSTF.today(); return t.slice(0, 7).replace("-", "") > nx || (t.slice(0, 7).replace("-", "") === nx && +t.slice(8, 10) >= 14); },
  gstinOf(reg){ return ((GSTR.gstins(S.books)) || []).find(g => g.slice(0, 2) === reg) || ""; },
  user(reg){ return (typeof GSTSet === "object" ? GSTSet.peek(reg).portalUser : "") || ""; },
  live(gstin){ const x = this.sess[gstin]; return x && x.connectedAt && !x.error && !x.endedAt && x.until > Date.now() ? x : null; },
  // the taxpayer's API access period: when it ends, and the days left (tax-accuracy: shown, and reminded 3 days before)
  accessLeft(gstin){ const x = this.sess[gstin]; if (!x || !x.accessUntil) return null; const ms = Date.parse(x.accessUntil) - Date.now(); return {until: x.accessUntil, days: Math.max(0, Math.ceil(ms / 86400000)), soon: ms < 3 * 86400000, over: ms <= 0}; },
  // what the server keeps for this GSTIN: asked again at most every 10 minutes (the server renews in the background)
  async status(gstin){
    this.seen[gstin] = Date.now();
    const j = await this.call({action: "status", gstins: [gstin]}), x = (j.sessions || [])[0];
    this.sess[gstin] = x ? Object.assign(this.sess[gstin] || {}, this.sessOf(x)) : (this.sess[gstin] && this.sess[gstin].sentAt ? {sentAt: this.sess[gstin].sentAt} : undefined);
  },
  sessOf(x){ return {until: Date.parse(x.until), connectedAt: x.connectedAt, error: x.error || "", accessUntil: x.accessUntil || "", accessDays: x.accessDays || 0, endedAt: x.endedAt || "", refreshedAt: x.refreshedAt || ""}; },
  // every client's GSTIN at once (Settings → GST API): sessions, the returns kept on the server, the e-invoice users
  async firmStatus(gstins){
    const list = Array.from(new Set(gstins.filter(g => /^\d{2}[A-Z0-9]{13}$/.test(g))));
    if (!list.length) return {sessions: [], returns: [], accounts: []};
    const [a, b, c] = await Promise.all([this.call({action: "status", gstins: list}), this.call({action: "returns", gstins: list}), this.call({action: "einv-status", gstins: list}).catch(() => ({accounts: []}))]);
    (a.sessions || []).forEach(x => { this.sess[x.gstin] = Object.assign(this.sess[x.gstin] || {}, this.sessOf(x)); this.seen[x.gstin] = Date.now(); });
    return {sessions: a.sessions || [], returns: b.returns || [], accounts: c.accounts || [], host: c.host || ""};
  },
  stale(gstin){ return !this.seen[gstin] || Date.now() - this.seen[gstin] > 10 * 60000; },
  async otp(reg){
    const gstin = this.gstinOf(reg), username = this.user(reg);
    const j = await this.call({action: "otp", gstin, username});
    this.sess[gstin] = {sentAt: Date.now()};
    return j;
  },
  async auth(reg, otp, days){
    const gstin = this.gstinOf(reg), username = this.user(reg);
    if (!this.sess[gstin]) throw new Error("Send the OTP first.");
    const j = await this.call({action: "auth", gstin, username, otp, days: days || 30});
    this.sess[gstin] = {until: Date.parse(j.until), connectedAt: new Date().toISOString(), error: "", accessUntil: j.accessUntil || "", accessDays: j.accessDays || 0, endedAt: ""}; this.seen[gstin] = Date.now();
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
// returns fetched on the server (Fetch now, or the daily run) are brought into the client's books: 2B with the 2B files,
// filed GSTR-1 with the filed copies (as a copy from the portal), filed 3B beside FinCom's own 3B
Object.assign(GSTAPI, {
  formOf: {"2B": "2B", "R1": "GSTR-1", "3B": "GSTR-3B"},
  async fetch(gstin, form, ym){
    const j = await this.call({action: "fetch", gstin, form, period: ym.slice(4, 6) + ym.slice(0, 4)});
    if (j.status === "none") return {none: true, error: j.error};
    const k = await this.call({action: "return", gstin, form, period: ym.slice(4, 6) + ym.slice(0, 4)});
    if (k.ret && k.ret.status === "ok") this.take(k.ret);
    return {ok: true, ret: k.ret};
  },
  // put one kept return into the books
  take(r){
    const b = S.books; if (!b || !r || !r.data) return;
    const ym = /^\d{6}$/.test(r.period) ? r.period.slice(2, 6) + r.period.slice(0, 2) : r.period, at = r.fetched_at || new Date().toISOString();
    if (r.form === "2B"){
      const t = GST2B.fromJson({data: r.data});
      if (!t.gstin || !t.ym) return;
      b.twoBs = b.twoBs || {}; b.twoBs[t.gstin + "|" + t.period] = Object.assign(t, {source: "api", fetchedAt: at});
      delete b.twoB; GST2B._memo = null; GSTR._carry = null;
    } else if (r.form === "R1"){
      GSTAmend.keep(Object.assign({}, r.data, {gstin: r.gstin, fp: r.period}), "portal", {via: "api", fetchedAt: at});
    } else if (r.form === "TRACK"){
      // the portal's return status list: each filed return marked with its ARN and date (request of 02-Oct-2026)
      if (typeof GSTX === "object") GSTX.takePortal(String(r.gstin).slice(0, 2), (r.data || {}).EFiledlist || []);
    } else if (r.form === "3B"){
      b.filed3b = Object.assign({}, b.filed3b, {[r.gstin + "|" + ym]: {gstin: r.gstin, ym, json: r.data, fetchedAt: at}});
    }
    b.apiTaken = Object.assign({}, b.apiTaken, {[r.gstin + "|" + r.form + "|" + r.period]: at});
  },
  // what the server has for this client's GSTINs and the books do not yet: brought in (at most every 10 minutes)
  async syncKept(){
    const b = S.books; if (!b || !this.on()) return 0;
    const gstins = GSTR.gstins(b) || []; if (!gstins.length) return 0;
    const key = gstins.join(","); if (this._sync && this._sync.key === key && Date.now() - this._sync.at < 10 * 60000) return 0;
    this._sync = {key, at: Date.now()};
    const j = await this.call({action: "returns", gstins});
    this.kept = j.returns || [];
    let n = 0;
    for (const r of this.kept){
      if (r.status !== "ok") continue;
      const had = (b.apiTaken || {})[r.gstin + "|" + r.form + "|" + r.period];
      if (had && had >= r.fetched_at) continue;
      const k = await this.call({action: "return", gstin: r.gstin, form: r.form, period: r.period});
      if (k.ret && k.ret.status === "ok"){ this.take(k.ret); n++; }
    }
    if (n) saveBooks();
    return n;
  },
  // the portal's list of returns filed in a year: each one marked filed here with its ARN and date
  async track(reg, fy){
    const gstin = this.gstinOf(reg), j = await this.call({action: "fetch", gstin, form: "TRACK", period: fy});
    if (j.status === "none") return 0;
    const k = await this.call({action: "return", gstin, form: "TRACK", period: fy});
    const n = k.ret && k.ret.status === "ok" ? GSTX.takePortal(reg, (k.ret.data || {}).EFiledlist || []) : 0;
    if (k.ret) this.take(k.ret);
    saveBooks(); return n;
  },
  keptFor(gstin, form, ym){ if (!ym) return null; return (this.kept || []).find(r => r.gstin === gstin && r.form === form && r.period === ym.slice(4, 6) + ym.slice(0, 4)) || null; }
});

/* ---------- filed returns against FinCom's working, month by month ---------- */
const GSTCMP = {
  H: ["taxable", "igst", "cgst", "sgst", "cess"],
  z(){ return {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}; },
  add(t, d, sg){ t.taxable = r2(t.taxable + sg * num(d.txval)); t.igst = r2(t.igst + sg * num(d.iamt)); t.cgst = r2(t.cgst + sg * num(d.camt)); t.sgst = r2(t.sgst + sg * num(d.samt)); t.cess = r2(t.cess + sg * num(d.csamt)); },
  // the filed GSTR-1's tables, added up: B2B, B2C large, B2C small, notes (credit notes take off), exports
  r1Filed(json){
    const out = {b2b: this.z(), b2cl: this.z(), b2cs: this.z(), cdnr: this.z(), exp: this.z()};
    const items = (inv, t, sg) => (inv.itms || []).forEach(it => this.add(t, it.itm_det || it, sg));
    (json.b2b || []).forEach(c => (c.inv || []).forEach(i => items(i, out.b2b, 1)));
    (json.b2cl || []).forEach(c => (c.inv || []).forEach(i => items(i, out.b2cl, 1)));
    (json.b2cs || []).forEach(x => this.add(out.b2cs, x, 1));
    (json.cdnr || []).forEach(c => (c.nt || []).forEach(n => items(n, out.cdnr, String(n.ntty || "C").toUpperCase() === "D" ? 1 : -1)));
    (json.cdnur || []).forEach(n => items(n, out.cdnr, String(n.ntty || "C").toUpperCase() === "D" ? 1 : -1));
    (json.exp || []).forEach(e => (e.inv || []).forEach(i => items(i, out.exp, 1)));
    return out;
  },
  r1Work(ym, reg){
    const g = GSTR.one(ym, reg), t = rows => { const s = GSTR.sum(rows); return {taxable: s.taxable, igst: s.igst, cgst: s.cgst, sgst: s.sgst, cess: s.cess}; };
    const notes = this.z(); g.cdnr.forEach(r => this.add(notes, {txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: r.cess}, r.note === "debit" ? 1 : -1));
    return {b2b: t(g.b2b), b2cl: t(g.b2cl), b2cs: t(g.b2c), cdnr: notes, exp: t(g.exp)};
  },
  // 3B's tables as rows: [label, {taxable, igst, cgst, sgst, cess}]
  r3bRows(j){
    const s = j.sup_details || {}, e = j.itc_elg || {}, rowOf = d => ({taxable: r2(num((d || {}).txval)), igst: r2(num((d || {}).iamt)), cgst: r2(num((d || {}).camt)), sgst: r2(num((d || {}).samt)), cess: r2(num((d || {}).csamt))});
    const ty = (list, t) => rowOf((list || []).find(x => x.ty === t));
    return [["3.1(a) Outward taxable supplies", rowOf(s.osup_det)], ["3.1(b) Zero rated", rowOf(s.osup_zero)], ["3.1(c) Nil rated, exempt", rowOf(s.osup_nil_exmp)],
      ["3.1(d) Inward, reverse charge", rowOf(s.isup_rev)], ["3.1(e) Non-GST", rowOf(s.osup_nongst)],
      ["4(A)(1) Import of goods", ty(e.itc_avl, "IMPG")], ["4(A)(2) Import of services", ty(e.itc_avl, "IMPS")], ["4(A)(3) Reverse charge", ty(e.itc_avl, "ISRC")],
      ["4(A)(4) ISD", ty(e.itc_avl, "ISD")], ["4(A)(5) All other ITC", ty(e.itc_avl, "OTH")], ["4(B)(1) Reversed, rules 38, 42, 43, 17(5)", ty(e.itc_rev, "RUL")],
      ["4(B)(2) Reversed, others", ty(e.itc_rev, "OTH")], ["4(C) Net ITC", rowOf(e.itc_net)]];
  },
  diff(a, b){ const d = {}; let any = false; this.H.forEach(h => { d[h] = r2(num(a[h]) - num(b[h])); if (Math.abs(d[h]) >= 1) any = true; }); return {d, any}; },
  // one month: GSTR-1 table by table and 3B row by row, filed (from the portal) against FinCom's working now
  month(ym, reg){
    const b = S.books, gstin = GSTAPI.gstinOf(reg), fp = ym.slice(4, 6) + ym.slice(0, 4);
    const f1 = ((b.filed || {})[gstin + "|" + fp] || null), f3 = ((b.filed3b || {})[gstin + "|" + ym] || null);
    const out = {ym, gstin, r1: null, r3b: null};
    if (f1 && f1.json && f1.source === "portal"){
      const F = this.r1Filed(f1.json), W = this.r1Work(ym, reg);
      const rows = [["B2B", "b2b"], ["B2C large", "b2cl"], ["B2C small", "b2cs"], ["Credit and debit notes", "cdnr"], ["Exports", "exp"]].map(([l, k]) => ({label: l, filed: F[k], work: W[k], ...this.diff(W[k], F[k])}));
      out.r1 = {rows, any: rows.some(r => r.any), via: f1.via || "file", at: f1.fetchedAt || f1.at};
    }
    if (f3 && f3.json){
      const F = this.r3bRows(f3.json), W = this.r3bRows(GSTR.threeBJson(ym, reg));
      const rows = F.map(([l, f], i) => ({label: l, filed: f, work: W[i][1], ...this.diff(W[i][1], f)}));
      out.r3b = {rows, any: rows.some(r => r.any), at: f3.fetchedAt};
    }
    return out;
  }
};

// the card is drawn by React (app/src/screens/GstApiCard.jsx) in this place
function viewGstApiCard(b){ return GSTAPI.gstinOf(S.gstReg || ((GSTR.gstins(b) || [])[0] || "").slice(0, 2)) ? '<div data-react="GstApiCard"></div>' : ""; }
