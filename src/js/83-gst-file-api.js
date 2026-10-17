/* @react-lazy: begin 83-gst-file-api.js (the React app loads this file with its GST filing screens: build.py react_parts) */
/* ================================================================== */
/* Filing GSTR-1, IFF and GSTR-3B through the GST API (17-Oct-2026)   */
/* ================================================================== */
// The owner's decisions of 17-Oct-2026 ("Both, API first"; "Prepare, you file"): FinCom saves the return on the portal
// through the firm's server function (gst-taxpro: save, summary, confirm, proceed, evc_otp, file, track;
// docs/gst-filing-api.md); a person compares the portal's summary with FinCom's and confirms it, and a person files with
// the authorised signatory's EVC OTP. FinCom never types or keeps an OTP or a captcha. The steps are drawn by
// app/src/screens/gst/FileApi.jsx on the GSTR-1, IFF and GSTR-3B cards.
// Owner update of 17-Oct-2026: the API route needs the taxpayer's OTP about every 30 days, so it is a choice per client:
// "File through: GST API (OTP every 30 days) / Browser helper", the browser helper by default. The API steps show only for
// a client set to the GST API whose GSTIN has a live API session.

// the client's choice of how its returns are filed: "api" or "helper" (the default). For the browser helper (branch
// next-gst-browser) and anything else that needs to know: gstFileRoute() for the client open, gstFileRoute(books) for
// another client's books
function gstFileRoute(books){
  const b = books || S.books || {};
  return b.gstFileRoute === "api" ? "api" : "helper";
}
// how the client's authorised signatory signs (the owner's answer of 17-Oct-2026): "evc" (an OTP; proprietors, firms and
// others) or "dsc" (companies and LLPs must). Chosen per client; by default DSC for a company (its PAN), else EVC. A DSC
// client's return is saved, compared and made ready to file through the API, then filed with DSC on the portal; FinCom
// reads the ARN back (RETTRACK). gstSignWith() for the client open, gstSignWith(books, co) for another
function gstSignWith(books, co){
  const b = books || S.books || {};
  if (b.gstSign === "dsc" || b.gstSign === "evc") return b.gstSign;
  const e = typeof FS === "object" && FS.entityOf ? FS.entityOf(co || (typeof CO === "function" ? CO() : null)).code : "";
  return e === "C" ? "dsc" : "evc";
}
// the GST portal's returns dashboard, where a return is filed with DSC (the person signs in there themselves)
const GST_PORTAL_RETURNS = "https://return.gst.gov.in/returns/auth/dashboard";
const GSTFILE = {
  FORMS: {R1: "GSTR-1", IFF: "IFF", "3B": "GSTR-3B"},
  st: {},
  route(){ return gstFileRoute(); },
  sign(){ return gstSignWith(); },
  setSign(v){ const b = S.books; if (!b) return; b.gstSign = v === "dsc" ? "dsc" : "evc"; saveBooks(); render(); },
  // DSC: the portal's returns dashboard in a new tab; the person signs in, picks the period and files with DSC there
  openPortal(){ try { window.open(GST_PORTAL_RETURNS, "_blank", "noopener"); } catch (e){} },
  setRoute(v){ const b = S.books; if (!b) return; if (v === "api") b.gstFileRoute = "api"; else delete b.gstFileRoute; saveBooks(); render(); },
  gstin(reg){ return typeof GSTAPI === "object" ? GSTAPI.gstinOf(reg) : ""; },
  // the API steps: chosen for this client, and its GSTIN connected (the existing per-client OTP session)
  apiReady(reg){ const g = this.gstin(reg); return this.route() === "api" && !!g && typeof GSTAPI === "object" && GSTAPI.on() && !!GSTAPI.live(g); },
  // owner and staff, as for posting; a viewer sees where a return stands
  mayFile(){ const r = S.account && (S.account.me || {}).role; return r === "owner" || r === "staff"; },
  period(ym){ return ym.slice(4, 6) + ym.slice(0, 4); },
  key(form, ym, reg){ return form + "|" + reg + "|" + ym; },
  state(form, ym, reg){ const k = this.key(form, ym, reg); return this.st[k] = this.st[k] || {}; },
  // the return exactly as the Download JSON button makes it
  payload(form, ym, reg){
    if (form === "3B") return GSTR.threeBJson(ym, reg);
    if (form === "IFF") return GSTQ.iff(ym, reg).json;
    const ft = typeof GSTSet === "object" && reg ? GSTSet.typeOf(ym, reg) : "monthly";
    return ft === "qrmp" ? GSTQ.r1Q(ym, reg).json : GSTR.toJson(ym, reg);
  },
  body(form, ym, reg, extra){ return Object.assign({gstin: this.gstin(reg), form, period: this.period(ym)}, extra || {}); },
  async call(form, ym, reg, action, extra){
    const s = this.state(form, ym, reg);
    if (s.busy) return null;
    s.busy = action; s.msg = ""; render();
    try {
      const j = await GSTAPI.call(this.body(form, ym, reg, Object.assign({action}, extra || {})));
      return j;
    } catch (e){
      s.msg = (e && e.message) || String(e); s.bad = true;
      // a refusal that moved the return back (the summary changed): read where it stands again
      this.load(form, ym, reg, true).catch(() => {});
      return null;
    } finally { s.busy = ""; render(); }
  },
  async load(form, ym, reg, force){
    const s = this.state(form, ym, reg);
    if (!force && s.loadedAt && Date.now() - s.loadedAt < 60000) return s;
    s.loadedAt = Date.now();
    try {
      const j = await GSTAPI.call(this.body(form, ym, reg, {action: "filing"}));
      s.filing = j.filing; s.log = j.log || []; s.host = j.host || "";
      if (s.filing && s.filing.status === "filed" && s.filing.arn) this.markFiled(form, ym, reg, s.filing.arn, s.filing.filed_at);
      // filed with DSC on the portal: the ARN read back by itself (at most every 10 minutes while it waits)
      else if (s.filing && s.filing.status === "proceeded" && this.sign() === "dsc" && this.mayFile() && (!s.trackedAt || Date.now() - s.trackedAt > 10 * 60000)){
        s.trackedAt = Date.now(); this.track(form, ym, reg, true).catch(() => {});
      }
    } catch (e){ s.loadErr = (e && e.message) || String(e); }
    render(); return s;
  },
  async save(form, ym, reg){
    if (typeof ledgersReady === "function" && !ledgersReady("gst")) return;
    if (form !== "3B"){ const pr = GSTAmend.proof(ym, reg); if (pr){ toast((form === "IFF" ? "IFF" : "GSTR-1") + " for " + GSTR.label(ym) + " is already marked filed" + (pr.arn ? " (ARN " + pr.arn + ")" : "") + "; changes go as amendments."); return; } }
    else if (GSTF.peek(ym, reg).r3b){ toast("GSTR-3B for " + GSTR.label(ym) + " is already marked filed."); return; }
    const p = this.payload(form, ym, reg), s = this.state(form, ym, reg);
    const j = await this.call(form, ym, reg, "save", {payload: p});
    if (!j) return;
    // the copy kept, as for a download: what later months' amendments are measured against
    if (form !== "3B"){ try { GSTAmend.keep(JSON.parse(JSON.stringify(p)), "downloaded", form === "IFF" ? {iff: true, via: "api"} : {via: "api"}); saveBooks(); } catch (e){} }
    s.cmp = null; s.bad = !j.ok; s.msg = j.saveState === "P" ? "Saved on the portal and processed. Now read the portal’s summary." : (j.error || "Saved; the portal is still processing it.");
    await this.load(form, ym, reg, true);
  },
  async summary(form, ym, reg){
    const j = await this.call(form, ym, reg, "summary"), s = this.state(form, ym, reg);
    if (!j) return;
    s.cmp = {rows: j.rows || [], differs: j.differs || [], rounding: j.rounding || [], plan: j.plan || null}; s.bad = false;
    s.msg = j.differs && j.differs.length ? j.differs.length + " difference" + (j.differs.length === 1 ? "" : "s") + " between the portal and FinCom: check each one." : "The portal’s summary matches FinCom.";
    await this.load(form, ym, reg, true);
  },
  async confirm(form, ym, reg, note){
    const s = this.state(form, ym, reg), diffs = ((s.cmp || {}).differs) || [];
    const j = await this.call(form, ym, reg, "confirm", {accept: diffs, note: note || ""});
    if (!j) return;
    s.bad = false; s.msg = diffs.length ? "Differences accepted. Next: proceed to file." : "Confirmed. Next: proceed to file.";
    await this.load(form, ym, reg, true);
  },
  async proceed(form, ym, reg){
    const j = await this.call(form, ym, reg, "proceed"), s = this.state(form, ym, reg);
    if (!j) return;
    s.bad = false; s.msg = form === "3B" ? "The liability is set off on the portal. Next: the signatory’s OTP." : "Ready to file on the portal. Next: the signatory’s OTP.";
    await this.load(form, ym, reg, true);
  },
  async otp(form, ym, reg, pan){
    const j = await this.call(form, ym, reg, "evc_otp", {pan: String(pan || "").toUpperCase().trim()}), s = this.state(form, ym, reg);
    if (!j) return;
    s.bad = false; s.msg = "The portal has sent the OTP to the authorised signatory’s mobile and e-mail. Type it below and press File.";
    await this.load(form, ym, reg, true);
  },
  // the person's click: the OTP goes to the server once, and is not kept here either
  async file(form, ym, reg, pan, otp){
    const j = await this.call(form, ym, reg, "file", {pan: String(pan || "").toUpperCase().trim(), otp: String(otp || "").trim()}), s = this.state(form, ym, reg);
    if (!j) return false;
    this.markFiled(form, ym, reg, j.arn, j.filedAt); saveBooks();
    s.bad = false; s.msg = this.FORMS[form] + " for " + GSTR.label(ym) + " filed. ARN " + j.arn + ".";
    toast(s.msg);
    await this.load(form, ym, reg, true);
    return true;
  },
  async track(form, ym, reg, quiet){
    const s = this.state(form, ym, reg); s.trackedAt = Date.now();
    const j = await this.call(form, ym, reg, "track");
    if (!j) return;
    if (j.filed) this.markFiled(form, ym, reg, j.arn, j.dof ? j.dof.split("-").reverse().join("-") + "T00:00:00+05:30" : "");
    if (!quiet || j.filed){ s.bad = false; s.msg = j.filed ? "Filed on the portal, ARN " + j.arn + "." : "Not filed on the portal yet."; }
    await this.load(form, ym, reg, true);
  },
  istDate(at){ const t = Date.parse(at || ""); return new Date((isNaN(t) ? Date.now() : t) + 5.5 * 3600000).toISOString().slice(0, 10); },
  // filed with an ARN: the month marked filed (this replaces the date typed by hand)
  markFiled(form, ym, reg, arn, at){
    if (!arn || !S.books) return;
    const r = GSTF.rec(ym, reg), d = this.istDate(at);
    const k = form === "3B" ? "r3b" : form === "IFF" ? "iff" : "r1";
    if (r[k + "Arn"] === arn && r[k + "Via"] === "api") return;
    r[k] = d; r[k + "Arn"] = arn; r[k + "Via"] = "api";
    if (form === "IFF"){ delete r.iffSkip; if (typeof GSTQ === "object") GSTQ.iffSnap(ym, reg); }
    // the 3B as filed is FinCom's working the person confirmed: kept, as "Mark this 3B as filed" does
    if (form === "3B" && !r.snap){ r.snap = GSTF.snapOf(GSTR.threeB(ym, reg)); r.snapAt = new Date().toISOString(); }
    GSTR._carry = null; saveBooks();
  },
  // filed through the API: {on, arn} for the card, else null
  filedApi(form, ym, reg){
    const r = GSTF.peek(ym, reg), k = form === "3B" ? "r3b" : form === "IFF" ? "iff" : "r1";
    return r[k + "Via"] === "api" && r[k + "Arn"] ? {on: r[k], arn: r[k + "Arn"]} : null;
  }
};
if (typeof gstFileRoute !== "undefined") globalThis.gstFileRoute = gstFileRoute;
if (typeof GSTFILE !== "undefined") globalThis.GSTFILE = GSTFILE;
// (each name only when declared: a test's harness loads a file's names one by one, tests/harness.js)
/* @react-lazy: end */
