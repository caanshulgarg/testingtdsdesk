/* ================================================================== */
/* GST browser helper: FinCom's side (the extension is extension/gst-helper; docs/gst-browser-helper.md) */
/* ================================================================== */
// The helper is a Chrome extension the person installs. It fills GSTR-1 / IFF / GSTR-3B on the GST portal in the person's
// own logged-in tab and stops before File. FinCom talks to it over one port (the extension allows only this site,
// externally_connectable): FinCom sends the return's figures (the same GSTR-1 JSON and 3B figures FinCom's downloads
// carry) and gets back each step's result, the comparison with the portal, the 2B JSON, ledger balances and the ARN.
// Every run is logged: on the firm's server (gst_helper_runs, migration 93) when signed in, and with the client's books.
// The GST portal password, when one is saved (GST settings, Vault), is read only on the "Log in to GST portal" click,
// handed to the helper for the one fill and dropped; it is never kept here, logged or sent anywhere else.
const GSTB = {
  EXT_ID: "okajonmmjoidmaapknhpphpojodaocmg",       // fixed by the manifest's key
  port: null, ext: null, tried: 0, msg: "", logins: {}, loginsAt: {},
  FORMS: {R1: "GSTR-1", IFF: "IFF", "3B": "GSTR-3B", "2B": "GSTR-2B", LEDGER: "Ledgers", STATUS: "Return status"},
  avail(){ return !!(typeof chrome === "object" && chrome && chrome.runtime && typeof chrome.runtime.connect === "function"); },
  // connect once a page draws the helper's card; "installed" only when the helper has answered
  connect(){
    if (this.port || !this.avail() || Date.now() - this.tried < 3000) return !!this.port;
    this.tried = Date.now();
    try {
      const p = chrome.runtime.connect(this.EXT_ID, {name: "fincom"});
      p.onMessage.addListener((m) => { try { this.onMsg(m); } catch (e){ console.warn("GST helper:", e); } });
      p.onDisconnect.addListener(() => { void (chrome.runtime && chrome.runtime.lastError); if (this.port === p){ this.port = null; this.ext = null; render(); } });
      p.postMessage({type: "hello"});
      this.port = p;
    } catch (e){ this.port = null; }
    return !!this.port;
  },
  on(){ return !!(this.port && this.ext); },
  gstinOf(reg){ return (GSTR.gstins(S.books) || []).find(g => g.slice(0, 2) === reg) || ""; },
  key(reg, ym, form){ return (reg || "") + "|" + ym + "|" + form; },
  state(reg, ym, form){ return (((S.books || {}).gstHelper || {})[this.key(reg, ym, form)]) || null; },
  // the form of a month's GSTR-1: IFF in a QRMP quarter's first two months, else GSTR-1
  r1Form(ym, reg){ return typeof GSTSet === "object" && reg && GSTSet.typeOf(ym, reg) === "qrmp" && !GSTSet.isQEnd(ym) ? "IFF" : "R1"; },
  // the figures FinCom sends: the very JSON its own download gives, and the 3B with FinCom's set-off
  job(form, ym, reg, opts){
    const gstin = this.gstinOf(reg), fp = ym.slice(4, 6) + ym.slice(0, 4);
    const j = {id: form + "-" + gstin + "-" + ym + "-" + Date.now().toString(36), v: 1, form, gstin, ym, fp, label: GSTR.label(ym), client: {id: S.coId || "", name: (CO() || {}).name || ""},
      fincom: typeof APP_VERSION === "string" ? APP_VERSION.split(" · ")[0] : ""};
    if (form === "R1" || form === "IFF"){
      const ft = typeof GSTSet === "object" && reg ? GSTSet.typeOf(ym, reg) : "monthly";
      j.r1json = ft === "qrmp" ? (GSTSet.isQEnd(ym) ? GSTQ.r1Q(ym, reg).json : GSTQ.iff(ym, reg).json) : GSTR.toJson(ym, reg);
      j.r1mode = (opts && opts.mode) || "upload";
      // kept as a downloaded copy is: what later months' amendments are measured against (GSTR.toJsonFile does the same)
      if (reg && j.r1json.gstin){ try { GSTAmend.keep(JSON.parse(JSON.stringify(j.r1json)), "downloaded", ft === "qrmp" ? (GSTSet.isQEnd(ym) ? {quarter: GSTSet.qStart(ym) + "-" + ym} : {iff: true}) : null); saveBooks(); } catch (e){} }
    } else if (form === "3B"){
      const t = GSTR.threeB(ym, reg);
      j.r3bjson = GSTR.threeBJson(ym, reg);
      if (t.pay) j.pay = {use: t.pay.use, cash: t.pay.cash, due: t.pay.due, rcmCash: t.pay.rcmCash};
    }
    if (opts && opts.of) j.of = opts.of;
    return j;
  },
  // "Open the portal for this return"
  open(form, ym, reg, opts){
    if (!this.connect() || !this.ext){ toast("The FinCom GST helper is not installed in this browser (or is switched off). See “How to install”."); return false; }
    // filing is for the firm's owner and staff (the owner's decision of 17-Oct-2026), not a viewer
    if (typeof Cloud === "object" && Cloud.on() && S.account && S.account.me && !["owner", "staff"].includes(S.account.me.role)){ toast("Only the firm's owner and staff can use the GST helper."); return false; }
    const j = this.job(form, ym, reg, opts);
    if (!j.gstin){ toast("No GSTIN for this registration."); return false; }
    this.port.postMessage({type: "job", job: j, open: "dashboard"});
    const s = this.put(reg, ym, form, {steps: [], agree: {}, differences: [], final: false, sentAt: new Date().toISOString(), mode: j.r1mode || ""});
    s.arn = s.arn || "";
    saveBooks(); render();
    return true;
  },
  // "Log in to GST portal": the saved login read from Vault (logged on the server), handed to the helper, dropped
  async login(reg){
    if (!this.connect() || !this.ext){ toast("The FinCom GST helper is not installed in this browser."); return; }
    const gstin = this.gstinOf(reg);
    this.msg = "Reading the saved login…"; render();
    let r = null;
    try { r = await Cloud.rpc("gst_portal_login_read", {p_client: S.coId, p_gstin: gstin}); }
    catch (e){ this.msg = "Not done: " + ((e && e.message) || e); render(); return; }
    if (!r || !r.ok){ this.msg = (r && r.error) || "No login saved."; render(); return; }
    this.port.postMessage({type: "login", gstin, username: r.username, password: r.password});
    r.password = null; r = null;
    this.msg = "The portal's login page is opening in a new tab with the user id and password typed. Type the captcha there (and the OTP if the portal asks)."; render();
  },
  put(reg, ym, form, patch){
    const b = S.books; b.gstHelper = b.gstHelper || {};
    const k = this.key(reg, ym, form);
    b.gstHelper[k] = Object.assign(b.gstHelper[k] || {}, patch);
    return b.gstHelper[k];
  },
  // the log kept with the client's books (and on the firm's server when signed in)
  log(entry){
    const b = S.books; b.gstHelperLog = b.gstHelperLog || [];
    b.gstHelperLog.push(Object.assign({at: new Date().toISOString(), who: (Cloud.st && Cloud.st.email) || "this computer"}, entry));
    if (b.gstHelperLog.length > 300) b.gstHelperLog = b.gstHelperLog.slice(-300);
    if (typeof Cloud === "object" && Cloud.on() && S.account){
      Cloud.rpc("gst_helper_run_add", {p_client: S.coId, p_gstin: entry.gstin, p_period: entry.ym, p_form: entry.form, p_outcome: entry.outcome, p_steps: entry.steps || [],
        p_differences: entry.differences || [], p_arn: entry.arn || "", p_run_id: entry.runId || "", p_helper: entry.helper || "", p_selectors: entry.selectors || "", p_note: entry.note || ""})
        .catch((e) => console.warn("GST helper log:", e && e.message));
    }
  },
  // a message for a client other than the one open waits until that client is opened
  mine(m){ return m && m.gstin && (!m.client || !m.client.id || m.client.id === S.coId) && (GSTR.gstins(S.books) || []).includes(m.gstin); },
  hold(m){ let q = []; try { q = JSON.parse(lsGet("tdsdesk:gsthelper-wait") || "[]"); } catch (e){} q.push(m); lsSet("tdsdesk:gsthelper-wait", JSON.stringify(q.slice(-50))); },
  release(){
    let q = []; try { q = JSON.parse(lsGet("tdsdesk:gsthelper-wait") || "[]"); } catch (e){}
    if (!q.length || !S.books) return;
    const keep = q.filter((m) => !this.mine(m)), now = q.filter((m) => this.mine(m));
    if (!now.length) return;
    lsSet("tdsdesk:gsthelper-wait", JSON.stringify(keep));
    now.forEach((m) => this.onMsg(m, true));
  },
  onMsg(m, held){
    if (!m || typeof m !== "object") return;
    if (m.type === "hello"){ this.ext = {version: m.version, selectors: m.selectors, verified: m.verified}; this.release(); render(); return; }
    if (m.type === "login"){ this.msg = m.message || (m.ok ? "Login page filled." : "The login page was not filled."); render(); return; }
    if (m.type === "need"){
      if (!this.mine(m)) return;
      const reg = m.gstin.slice(0, 2);
      if (this.port) this.port.postMessage({type: "data", job: this.job(m.form, m.ym, reg)});
      return;
    }
    if (!S.books || !this.mine(m)){ if (!held && m.gstin) { this.hold(m); toast("The GST helper sent a result for " + ((m.client || {}).name || m.gstin) + "; it is recorded when that client is opened."); } return; }
    const reg = m.gstin.slice(0, 2), ym = m.ym;
    if (m.type === "run"){
      const stopped = (m.steps || []).some((s) => s.status === "stopped"), outcome = stopped ? "stopped" : (m.steps || []).some((s) => s.status === "you") ? "yours" : "done";
      this.put(reg, ym, m.form, {steps: m.steps || [], agree: m.agree || {}, differences: (m.differences || []).slice(0, 200), final: !!m.final, at: m.at, mode: m.mode || "",
        selectors: m.selectors, helper: m.version, portal51: m.portal51 || null});
      // the portal's own interest and late fee (5.1), as the Filing card keeps what is typed from the portal
      if (m.form === "3B" && m.portal51 && m.final){ const r = GSTF.rec(ym, reg); r.portalInt = m.portal51.interest; r.portalFee3 = m.portal51.fee; }
      if (m.final) this.log({form: m.form, gstin: m.gstin, ym, outcome, runId: m.jobId, helper: m.version, selectors: m.selectors,
        steps: (m.steps || []).map((s) => ({id: s.id, status: s.status, message: String(s.message || "").slice(0, 400)})), differences: (m.differences || []).slice(0, 200), note: m.mode ? "way: " + m.mode : ""});
      saveBooks(); render(); return;
    }
    if (m.type === "arn"){
      const form = m.form === "STATUS" ? (m.of || "3B") : m.form, r = GSTF.rec(ym, reg), today = GSTF.today();
      if (form === "3B"){ r.r3bArn = m.arn; if (!r.r3b) r.r3b = today; if (!r.snap){ r.snap = GSTF.snapOf(GSTR.threeB(ym, reg)); r.snapAt = new Date().toISOString(); GSTR._carry = null; } }
      else if (form === "IFF"){ r.iffArn = m.arn; if (!r.iff) r.iff = today; }
      else { r.r1Arn = m.arn; if (!r.r1) r.r1 = today; }
      this.put(reg, ym, form, {arn: m.arn, filedAt: m.at});
      this.log({form, gstin: m.gstin, ym, outcome: "filed", arn: m.arn, runId: m.jobId, note: "ARN read from the portal (" + (m.page || "") + ")"});
      saveBooks(); toast(this.FORMS[form] + " for " + GSTR.label(ym) + " filed: ARN " + m.arn + "."); render(); return;
    }
    if (m.type === "twoB"){
      let t = null;
      try { t = GST2B.fromJson(m.json && m.json.data ? {data: m.json.data} : m.json); } catch (e){ t = null; }
      if (!t || !t.gstin || !t.ym || t.gstin !== m.gstin){ toast("The 2B from the portal could not be read."); return; }
      const b = S.books; b.twoBs = b.twoBs || {}; b.twoBs[t.gstin + "|" + t.period] = Object.assign(t, {source: "helper", fetchedAt: new Date().toISOString()});
      delete b.twoB; GST2B._memo = null; GSTR._carry = null;
      this.put(reg, ym, "2B", {at: new Date().toISOString(), rows: t.rows.length});
      this.log({form: "2B", gstin: m.gstin, ym, outcome: "done", runId: m.jobId, note: "2B brought in: " + t.rows.length + " rows"});
      saveBooks(); toast("2B for " + GSTR.label(t.ym) + " brought in from the portal (" + t.rows.length + ")."); render(); return;
    }
    if (m.type === "ledger"){
      const b = S.books; b.gstHelperLedger = b.gstHelperLedger || {}; const x = b.gstHelperLedger[reg] = b.gstHelperLedger[reg] || {};
      x[m.which] = {got: m.got, at: new Date().toISOString(), ym};
      this.log({form: "LEDGER", gstin: m.gstin, ym, outcome: "info", runId: m.jobId, note: m.which + ": " + Object.entries(m.got || {}).map(([k, v]) => k + " " + v).join(", ")});
      saveBooks(); render();
    }
  },
  // the saved GST portal logins of the open client (user id, saved or not, who may use them; never the password)
  async loadLogins(force){
    const c = S.coId || "";
    if (!c || !(typeof Cloud === "object" && Cloud.on())) return null;
    if (!force && this.logins[c] && Date.now() - (this.loginsAt[c] || 0) < 60000) return this.logins[c];
    this.loginsAt[c] = Date.now();
    try { this.logins[c] = await Cloud.rpc("gst_portal_login_list", {p_client: c}) || []; } catch (e){ this.logins[c] = this.logins[c] || []; }
    render();
    return this.logins[c];
  },
  loginOf(gstin){ return ((this.logins[S.coId || ""] || []).find((x) => x.gstin === gstin)) || null; },
  async saveLogin(gstin, username, password, staff){
    const r = await Cloud.rpc("gst_portal_login_save", {p_client: S.coId, p_gstin: gstin, p_username: username, p_password: password || "", p_staff: staff});
    if (!r || !r.ok) throw new Error((r && r.error) || "Not saved.");
    await this.loadLogins(true);
    return r;
  },
  async deleteLogin(gstin){
    const r = await Cloud.rpc("gst_portal_login_delete", {p_client: S.coId, p_gstin: gstin});
    if (!r || !r.ok) throw new Error((r && r.error) || "Not deleted.");
    await this.loadLogins(true);
    return r;
  }
};
