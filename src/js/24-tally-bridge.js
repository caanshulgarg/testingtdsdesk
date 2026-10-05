/* ================================================================== */
/* FinCom Bridge: live connection to TallyPrime on this computer       */
/* ================================================================== */
const Bridge = {
  st: {state: "off", sessions: [], open: [], at: 0, error: ""},
  lastOpenKey: null,
  cfg(){ let c = {}; try { c = JSON.parse(lsGet("tdsdesk:bridge") || "{}"); } catch (e){} return Object.assign({url: "http://127.0.0.1:9100", key: "", follow: true}, c); },
  setCfg(p){ lsSet("tdsdesk:bridge", JSON.stringify(Object.assign(this.cfg(), p))); },
  blocked(){ return !!window.claude; },
  on(){ return !this.blocked() && !!this.cfg().key; },
  up(){ return this.st.state === "ok"; },
  pinQ(){ const pp = this.cfg().port; return pp ? "&port=" + pp : ""; },
  // FinCom Bridge 2.3.0: on a shared Windows server each Windows user's bridge takes its own port of 9100..9119 and
  // answers only programs of its own Windows user (another user's bridge: 403 "not your FinCom Bridge"). FinCom finds its
  // own by asking /ping on each port: the bridge it was paired with (its id), else the bridge linked to the signed-in
  // member on the Tally page, else the one that says it is this Windows user's ("yours"); an older bridge (no "yours")
  // on 9100 as before. Only 127.0.0.1 addresses of the range are looked through; another address set by hand is kept.
  PORTS: Array.from({length: 20}, (_, i) => 9100 + i),
  localUrl(u){ const m = String(u || "").match(/^http:\/\/(127\.0\.0\.1|localhost):(\d+)\/*$/); return !!m && this.PORTS.includes(+m[2]); },
  async probe(port, ms){
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 1500);
    try { const r = await fetch("http://127.0.0.1:" + port + "/ping", {cache: "no-store", signal: ctl.signal}); const j = await r.json().catch(() => null); return j && j.ok !== false ? Object.assign({port}, j) : null; }
    catch (e){ return null; } finally { clearTimeout(t); }
  },
  async find(){
    const c = this.cfg();
    if (!this.localUrl(c.url)) return null;
    const found = (await Promise.all(this.PORTS.map(p => this.probe(p)))).filter(Boolean);
    const linked = typeof TCloud === "object" && TCloud.myBridge ? TCloud.myBridge() : "";
    const pick = (c.bridgeId && found.find(b => b.bridgeId === c.bridgeId && b.yours !== false)) || (linked && found.find(b => b.bridgeId === linked && b.yours !== false))
      || found.find(b => b.yours === true) || found.find(b => b.yours === undefined && b.port === 9100) || null;
    this.foundAt = Date.now();
    return pick ? {url: "http://127.0.0.1:" + pick.port, bridgeId: pick.bridgeId || "", port: pick.port} : null;
  },
  // the bridge did not answer, or it is another Windows user's: looked for once (at most every 15 s) on 9100..9119
  async refind(){
    if (this.foundAt && Date.now() - this.foundAt < 15000) return false;
    const f = await this.find();
    if (!f || f.url === this.cfg().url.replace(/\/+$/, "")) return false;
    this.setCfg({url: f.url, bridgeId: f.bridgeId || this.cfg().bridgeId || ""});
    return true;
  },
  async call(path, body, ms, again){
    const c = this.cfg();
    if (c.port){ if (body && typeof body === "object" && !Array.isArray(body)) body = Object.assign({port: c.port}, body); }
    // writes to Tally go into the firm's audit trail (who, which company, how many)
    if (body && /^\/(unpost|import|jobs)$/.test(path.split("?")[0]) && typeof auditEvent === "function"){
      const n = Array.isArray(body.items) ? body.items.length : Array.isArray(body.vouchers) ? body.vouchers.length : 1;
      auditEvent("tally." + path.split("?")[0].slice(1), (body.company || "") + " \u00b7 " + n + (body.guid ? " \u00b7 " + body.guid : "") + (body.vchNumber ? " \u00b7 no. " + body.vchNumber : ""), S.coId || "");
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 120000);
    let r;
    try {
      r = await fetch(c.url.replace(/\/+$/, "") + path, {method: body ? "POST" : "GET", headers: Object.assign({"X-Bridge-Key": c.key}, body ? {"Content-Type": "application/json"} : {}), body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: "no-store"});
    } catch (e){
      if (!again && e && e.name !== "AbortError" && await this.refind()) return this.call(path, body, ms, true);
      throw {code: "bridge_down", message: e && e.name === "AbortError" ? "FinCom Bridge did not answer in time. Check the FinCom Bridge icon near the clock (right-click \u2192 Test connection)." : "FinCom Bridge is not running on this computer (" + c.url + "). Check the FinCom Bridge icon near the clock (right-click \u2192 Test connection)."};
    } finally { clearTimeout(timer); }
    let j = null;
    try { j = await r.json(); } catch (e){ j = null; }
    if (r.status === 403 && j && j.notYours){
      if (!again && await this.refind()) return this.call(path, body, ms, true);
      throw {code: "bridge_other_user", message: "The FinCom Bridge at " + c.url + " is another Windows user's on this computer, and FinCom did not find yours on ports 9100\u20139119. Install FinCom Bridge for your own Windows user (the setup, \u201cJust for me\u201d)."};
    }
    if (!r.ok || !j || j.ok === false) throw {code: r.status === 401 ? "bridge_key" : "bridge", message: (j && (j.error || j.message)) || ("The bridge answered with error " + r.status + ".")};
    return j;
  },
  // fresh: a person's action (opening FinCom, posting, connecting) may ask Tally which companies are open. The minute
  // checks do not: the bridge answers them without asking Tally (1.14.0)
  async refresh(fresh = true){
    if (!this.on()){ this.st = {state: "off", sessions: [], open: [], at: Date.now(), error: ""}; return this.st; }
    try {
      const j = await this.call("/status" + (fresh ? "?fresh=1" : ""), null, 15000);
      j.sessions = [].concat(j.sessions || []).map(se => Object.assign({}, se, {companies: [].concat(se.companies || [])}));
      const pin = num(this.cfg().port);
      const usable = (j.sessions || []).filter(s => !s.skipped && s.ok && (!pin || s.port === pin));
      const open = [];
      usable.forEach(s => (s.companies || []).forEach(c => open.push({name: c.name, port: s.port, mine: s.mine, from: c.from, to: c.to, gstin: String(c.gstin || "").toUpperCase(), pan: String(c.pan || "").toUpperCase()})));
      // the same company in two Tally sessions that cannot be told apart: do not use either until one is chosen
      const names = {};
      open.forEach(o => { names[o.name] = (names[o.name] || 0) + 1; });
      const clash = !pin && Object.keys(names).filter(n => names[n] > 1 && !(open.filter(o => o.name === n && o.mine === true).length === 1));
      this.st = {state: "ok", sessions: j.sessions || [], open: open.filter(o => !(clash && clash.includes(o.name)) || o.mine === true), clash: clash || [], at: Date.now(), error: "",
        version: j.version, allowImport: j.allowImport !== false, mode: j.mode || "", user: j.user || "", mySession: j.mySession, jobs: [].concat(j.jobs || []),
        stuck: j.tallyStuck || null, tallyUp: usable.length > 0, pinMissing: !!pin && !(j.sessions || []).some(s => s.port === pin && s.ok && !s.skipped),
        // go-bridge: Tally open / busy / closed (a busy Tally is open, only slow); bridge 1.15.0: busy when it says Tally is stuck
        tallyState: (j.tally && j.tally.state) || (usable.length ? (j.tallyStuck ? "busy" : "open") : "closed"), busySince: (j.tally && j.tally.since) || (j.tallyStuck && j.tallyStuck.since) || "",
        beat: j.beat || null, computer: j.computer || "", paused: !!j.paused};
      if (!this.st.tallyUp || this.st.pinMissing){ if (!this.diag || Date.now() - this.diag.at > 30000) await this.diagnose(); }
      else this.diag = null;
      this.misses = 0; this.okAt = Date.now();
    } catch (e){
      // a bridge busy with Tally (1.15.0 answers one request at a time) is not a lost bridge: it stays connected,
      // "reconnecting", and is asked again every 15 s; offline only when it has not answered for two minutes (about
      // three missed heartbeats), or never while this tab is posting through it
      this.misses = (this.misses || 0) + 1;
      const was = this.st && this.st.state === "ok" && Date.now() - (this.okAt || this.st.at || 0) < 120000;
      if (e.code !== "bridge_key" && this.st && this.st.state === "ok" && (was || this.posting)){
        this.st = Object.assign({}, this.st, {shaky: true, error: e.message});
        clearTimeout(this.again); this.again = setTimeout(() => { if (typeof bridgeTick === "function") bridgeTick(false); }, this.misses === 1 ? 8000 : 15000);
      } else this.st = {state: e.code === "bridge_key" ? "key" : "down", sessions: [], open: [], at: Date.now(), error: e.message};
    }
    if (this.st.state === "ok" && !this.misses) this.st.shaky = false;
    return this.st;
  },
  diag: null,
  async diagnose(){
    try {
      const d = await this.call("/diagnose", null, 20000);
      d.findings = [].concat(d.findings || []); d.tallies = [].concat(d.tallies || []).map(t => Object.assign({}, t, {ports: [].concat(t.ports == null ? [] : t.ports)}));
      this.diag = Object.assign({at: Date.now()}, d);
    }
    catch (e){ this.diag = {at: Date.now(), error: e.message, findings: []}; }
    return this.diag;
  },
  // Post masters and vouchers to Tally. Bridge 1.12 and later: handed over as a job, which the bridge posts on its own
  // (in batches, one writer per Tally, checked in Tally before anything is sent again); FinCom follows its progress and
  // rides out a bridge or network that stops answering for a while. An older bridge: the one long request as before.
  // Returns {results: [{id, ok, message, ...}]} for every item sent, whatever happened.
  async post(payload, onProgress, onChecked){
    // nothing without a proper date, or dated before the company's books begin, ever goes to Tally: it is answered here
    const refused = [];
    // entries dated in a closed period: the user is asked, and those held back are answered here
    if (typeof ClosedP === "object" && (payload.vouchers || []).length){
      const held = await ClosedP.gate(payload);
      if (held.length){
        const ids = new Set(held.map(h => h.id));
        held.forEach(h => refused.push({id: h.id, ok: false, message: h.message, held: true}));
        payload = Object.assign({}, payload, {vouchers: payload.vouchers.filter(v => !ids.has(v.id))});
      }
    }
    const open = (this.st.open || []).find(o => o.name === payload.company);
    const booksFrom = open && /^\d{8}$/.test(String(open.from || "")) ? String(open.from) : "";
    const keep = list => [].concat(list || []).filter(it => {
      let why = voucherDateProblem(it.xml);
      const d = (String(it.xml || "").match(/^\s*<VOUCHER\b[\s\S]*?<DATE>(\d{8})<\/DATE>/) || [])[1];
      if (!why && d && booksFrom && d < booksFrom) why = "Dated " + fmtDate(tallyDate(d)) + ", before " + payload.company + "'s books begin (" + fmtDate(tallyDate(booksFrom)) + "), so it was not sent. Open the company that holds this period in Tally.";
      if (why) refused.push({id: it.id, ok: false, message: why});
      return !why;
    });
    payload = Object.assign({}, payload, {masters: keep(payload.masters), vouchers: keep(payload.vouchers)});
    if (!payload.masters.length && !payload.vouchers.length) return {ok: true, company: payload.company, results: refused};
    // build 199: Tally on another computer: through the queue in the cloud
    const coP = (payload.client && S.companies[payload.client]) || (typeof CO === "function" ? CO() : null);
    // 02-Oct-2026: only into the Tally company chosen for this client (Client setup → Tally); the cloud refuses the same
    const notAllowed = postToProblem(coP, payload.company);
    if (notAllowed) return {ok: true, company: payload.company, notAllowed: true, results: [].concat(payload.masters || [], payload.vouchers || []).map(x => ({id: x.id, ok: false, notAllowed: true, message: notAllowed})).concat(refused)};
    // review of 02-Oct-2026 (B9): a ledger Tally already has is never sent as a master; a new one is asked about first,
    // and nothing is sent until it is confirmed
    if (typeof PostGate === "object" && (payload.masters || []).length){
      const g = await PostGate.masters(payload, coP);
      if (g.cancelled) throw {code: "cancelled", message: "Nothing was sent to Tally: the new ledger" + ((payload.masters || []).length === 1 ? " was" : "s were") + " not confirmed."};
      refused.push(...g.results);
      payload = Object.assign({}, payload, {masters: g.masters});
      if (!payload.masters.length && !payload.vouchers.length) return {ok: true, company: payload.company, results: refused};
    }
    const words = o => { [].concat(o.results || []).forEach(x => { if (x && x.ok && postAltered(x)) x.altered = Math.max(1, num(x.altered)); if (x) x.word = postWord(x); }); return o; };
    // B11: every posting goes through the queue in FinCom's cloud when the client is linked there, also with the bridge
    // on this computer (the main bridge takes it from the queue; the live connection wakes it), so every posting is in one
    // list. Straight to the bridge only when the cloud is not there for this client; then recorded in the cloud afterwards
    const cloudOn = !!coP && typeof TCloud === "object" && TCloud.on();
    if (cloudOn && !(TCloud.st[coP.id] && TCloud.st[coP.id].books)){ try { await TCloud.status(coP.id); } catch (e){} }
    if (cloudOn && TCloud.has(coP.id)){
      const outC = await CloudPost.run(coP.id, payload, onProgress, onChecked ? chk => { words(chk); onChecked(chk); } : onChecked);
      outC.results = [].concat(outC.results || []).concat(refused);
      return words(outC);
    }
    let out = null;
    const after = onChecked || cloudOn ? chk => { words(chk); if (out && cloudOn && typeof PostRecord === "object") PostRecord.save(coP, payload, {recId: out.recId, company: out.company, results: [].concat(chk.results || []).concat(refused)}); if (onChecked) onChecked(chk); } : onChecked;
    out = await this.postChecked(payload, onProgress, after);
    out.results = [].concat(out.results || []).concat(refused);
    words(out);
    if (cloudOn && typeof PostRecord === "object") await PostRecord.save(coP, payload, out);
    return out;
  },
  async postChecked(payload, onProgress, onChecked){
    const jobs = bridgeVer(this.st.version) >= bridgeVer("1.12.0");
    if (!jobs) return this.call("/import", payload, 600000);
    const jobId = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    const ids = [].concat(payload.masters || [], payload.vouchers || []).map(x => x.id);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let told = "";
    const tell = (j, extra) => { const pj = Object.assign({done: 0, total: ids.length}, j || {}, extra || {}); const k = pj.done + "|" + pj.message; if (k === told) return; told = k; try { onProgress && onProgress(pj); } catch (e){} };
    this.posting = {id: jobId, at: Date.now()};
    try { lsSet("tdsdesk:bridgejob", JSON.stringify({id: jobId, at: Date.now(), company: payload.company, n: ids.length})); } catch (e){}
    let j = null;
    // hand it over; a request lost on the way is sent again with the same job number, so it can never start twice
    for (let a = 0; !j; a++){
      try { j = await this.call("/jobs", Object.assign({jobId}, payload), 20000); }
      catch (e){ if (a >= 5 || e.code === "bridge_key" || (e.code === "bridge" && !/in time|not running/.test(e.message))) { this.posting = null; throw e; } tell(null, {message: "Handing the entries to the bridge\u2026 (try " + (a + 2) + ")"}); await sleep(1500 * (a + 1)); }
    }
    let quietSince = 0, resumed = 0;
    while (!["done", "failed"].includes(j.status)){
      if (j.status === "interrupted"){
        if (resumed++ >= 3) break;
        tell(j, {message: "The posting stopped part-way; resuming it (nothing already in Tally is sent again)\u2026"});
        try { j = await this.call("/jobs/resume", {id: jobId}, 20000); } catch (e){ await sleep(3000); }
        continue;
      }
      tell(j);
      await sleep(quietSince ? 3000 : 700);
      try { j = await this.call("/jobs?id=" + encodeURIComponent(jobId), null, 15000); quietSince = 0; }
      catch (e){
        if (e.code === "bridge" && /No such job/.test(e.message)){ j = {status: "failed", message: "The bridge lost this posting. Press Post again: entries already in Tally are recognised and not sent twice.", results: j.results || []}; break; }
        quietSince = quietSince || Date.now();
        const s = Math.round((Date.now() - quietSince) / 1000);
        tell(j, {message: "The bridge is not answering (" + s + "s); the posting carries on there. Waiting\u2026"});
        if (Date.now() - quietSince > 15 * 60000){ j = Object.assign({}, j, {status: "failed", message: "The bridge did not answer for 15 minutes. The posting may have finished: press Post again. Entries already in Tally are recognised and not sent twice."}); break; }
      }
    }
    this.posting = null;
    // every item gets a result: the ones the job did not reach are refused with the job's reason
    const why = j.status === "done" ? "Not posted." : (j.message || "The posting stopped.");
    const resultsOf = jj => { const got = new Map([].concat(jj.results || []).map(r => [r.id, r])); return ids.map(id => got.get(id) || {id, ok: false, message: why}); };
    const results = resultsOf(j);
    if (j.checking){
      // the entries are in Tally; the bridge now reads them back once. FinCom carries on and is told when that is done.
      results.forEach(r => { if (r.ok && r.verified == null) r.pendingCheck = true; });
      this.followCheck(jobId, resultsOf, onChecked);
    } else { try { lsDel("tdsdesk:bridgejob"); } catch (e){} }
    return {ok: true, company: j.company || payload.company, port: j.port, results, checking: !!j.checking, job: {id: jobId, status: j.status, message: j.message}};
  },
  async followCheck(jobId, resultsOf, onChecked){
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const t0 = Date.now();
    for (let n = 0; Date.now() - t0 < 30 * 60000; n++){
      await sleep(n < 10 ? 1500 : 4000);
      let j;
      try { j = await this.call("/jobs?id=" + encodeURIComponent(jobId), null, 15000); } catch (e){ continue; }
      if (j.checking) continue;
      try { lsDel("tdsdesk:bridgejob"); } catch (e){}
      try { onChecked && onChecked({results: resultsOf(j), checkFailed: !!j.checkFailed}); } catch (e){}
      return;
    }
  },
  // ask the bridge on this computer for its key, with the 6-digit code FinCom Bridge shows (tray icon → Connect FinCom on this computer…)
  // (bridge 1.11: only for a few minutes after it starts, once, and never for another web page)
  async pair(code){
    const c = this.cfg();
    let base = c.url.replace(/\/+$/, ""), bridgeId = "";
    const ask = b => fetch(b + "/pair?code=" + encodeURIComponent(String(code || "").trim()), {cache: "no-store"}).catch(() => null);
    let r = await ask(base);
    let j = r ? await r.json().catch(() => null) : null;
    // 2.3.0: nothing there, or another Windows user's bridge: this user's own on 9100..9119
    if ((!r || (r.status === 403 && j && j.notYours)) && this.localUrl(base)){
      this.foundAt = 0;
      const f = await this.find();
      if (f && f.url !== base){ base = f.url; bridgeId = f.bridgeId || ""; r = await ask(base); j = r ? await r.json().catch(() => null) : null; }
    }
    if (!r) throw {code: "bridge_down", message: "FinCom Bridge is not running on this computer yet. Install FinCom Bridge from the Tally page."};
    if (r.status === 403 && j && j.notYours) throw {code: "pair", message: "That FinCom Bridge is another Windows user's on this computer. Install FinCom Bridge for your own Windows user (the setup, \u201cJust for me\u201d), then connect again."};
    if (!j || !j.ok) throw {code: "pair", message: (j && j.error) || "The bridge would not hand over its key."};
    this.setCfg({key: j.key, url: base, bridgeId: j.bridgeId || bridgeId || ""});
    return j;
  },
  tallyName(co){ const o = this.openFor(co); return o ? o.name : (co.tallyName || co.name); },
  openFor(co){
    if (!co || !this.up()) return null;
    const names = [co.tallyName, co.name].filter(Boolean).map(norm);
    const byName = this.st.open.find(c => names.includes(norm(c.name)));
    if (byName) return byName;
    // the same company under a different name in Tally: its GSTIN or PAN
    const pan = co.pan || String(co.gstin || "").slice(2, 12);
    const byId = this.st.open.filter(c => (co.gstin && c.gstin === co.gstin) || (pan && (c.pan === pan || String(c.gstin).slice(2, 12) === pan)));
    return byId.length === 1 ? byId[0] : null;
  },
  clientFor(tallyName){
    const n = norm(tallyName);
    const hit = Object.values(S.companies).find(c => norm(c.tallyName || "") === n) || Object.values(S.companies).find(c => norm(c.name) === n);
    if (hit) return hit;
    const o = this.st.open.find(x => x.name === tallyName);
    if (!o || !(o.gstin || o.pan)) return null;
    const byId = Object.values(S.companies).filter(c => (o.gstin && c.gstin === o.gstin) || (o.pan && (c.pan || String(c.gstin || "").slice(2, 12)) === o.pan));
    return byId.length === 1 ? byId[0] : null;
  },
  openClients(){
    const out = [];
    this.st.open.forEach(o => { const c = this.clientFor(o.name); if (c && !out.includes(c)) out.push(c); });
    return out;
  }
};
function bridgeLive(co){ return Bridge.on() && Bridge.up() && !!Bridge.openFor(co || CO()); }
function tallyToIso(d){ const s = String(d || ""); return /^\d{8}$/.test(s) ? s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) : ""; }
function isoToTally(d){ return String(d || "").replace(/-/g, ""); }
// a date n days on, in UTC: a local midnight read back with toISOString is the day before east of London (India)
function addDays(iso, n){ const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Poll the bridge; follow the company open in Tally
let bridgeTimer = null, bridgeBusy = false;
// only the small Tally chip changes on a routine check; the page is left alone
let lastBridgeChip = "";
function refreshBridgeChip(){
  const el = document.getElementById("sideBridge");
  if (!el) return;
  const html = bridgeChip(S.view === "company" ? CO() : null);
  if (html !== lastBridgeChip){ el.innerHTML = html; lastBridgeChip = html; }
}
// One ledger's vouchers for a period. Bridge 1.12.3 asks Tally for that ledger only; older bridges read the Day Book month by month.
function ledgerLinesUrl(company, ledger, from, to){
  const light = bridgeVer(Bridge.st.version) >= bridgeVer("1.12.3");
  return (light ? "/ledgerlines" : "/vouchers") + "?company=" + encodeURIComponent(company) + "&from=" + isoToTally(from) + "&to=" + isoToTally(to) + "&ledger=" + encodeURIComponent(ledger) + Bridge.pinQ();
}
// round 18 (owner, 04-Oct-2026: reading is prospective only): bridge 2.1.9 answers /ledgerlines from its copy, and for dates
// the copy does not hold it says so (readDays false, a note) without asking Tally. That answer is "not checked", never
// "not in Tally": nothing is marked gone, read as the bank book, or taken as a finished check from it
function copyNotCovered(j){ return !!(j && j.readDays === false); }
const COPY_NOT_COVERED = "Tally could not be checked for these dates (reading entries from Tally is off on this computer and its copy does not hold them; history comes from the Day Book upload). FinCom's own records were checked.";
function bridgeVer(v){ return String(v || "").split(".").map(x => String(num(x)).padStart(3, "0")).join("."); }
// a posting handed to the bridge before this page was reloaded or closed: say how it ended (the bridge finishes it on its own)
async function bridgeLeftover(){
  let m = null; try { m = JSON.parse(lsGet("tdsdesk:bridgejob") || "null"); } catch (e){}
  if (!m || !m.id) return;
  try {
    let j = await Bridge.call("/jobs?id=" + encodeURIComponent(m.id), null, 15000);
    if (j.status === "interrupted") j = await Bridge.call("/jobs/resume", {id: m.id}, 20000);
    if (["queued", "waiting", "running"].includes(j.status)) { toast("The earlier posting to " + (j.company || "Tally") + " is still going on the Tally computer: " + (j.done || 0) + " of " + (j.total || 0) + " done."); return; }
    lsDel("tdsdesk:bridgejob");
    const ok = [].concat(j.results || []).filter(r => r.ok).length;
    toast("The earlier posting to " + (j.company || "Tally") + " finished: " + ok + " of " + (j.total || 0) + " in Tally. Press Post again for any left; entries already in Tally are not sent twice.");
  } catch (e){ if (Date.now() - (m.at || 0) > 7 * 86400000) lsDel("tdsdesk:bridgejob"); }
}
async function bridgeTick(first){
  Bridge.st.lastAsk = Date.now();
  if (bridgeBusy || !Bridge.on()) return;
  bridgeBusy = true;
  try {
    const before = Bridge.st.state;
    await Bridge.refresh(false);          // build 194: opening FinCom does not ask Tally either; posting and Connect do
    if (first && Bridge.up() && !Bridge.posting) bridgeLeftover();
    if (first && Bridge.up() && Bridge.st.version && bridgeVer(Bridge.st.version) < bridgeVer("1.12.6") && !lsGet("tdsdesk:bridgenudge1126")){
      lsSet("tdsdesk:bridgenudge1126", "1");
      toast("A newer FinCom Bridge is ready: it reads bill references for the vendor reconciliation, deletes entries on more Tally setups, and posts fast, and it keeps posting even if this page or the connection drops. Install FinCom Bridge from the Tally page and run it on the Tally computer.");
    }
    const key = Bridge.st.open.map(o => o.name).sort().join("|");
    const changed = key !== Bridge.lastOpenKey;
    Bridge.lastOpenKey = key;
    if (Bridge.up() && Bridge.cfg().follow && changed){
      const clients = Bridge.openClients();
      const busyTyping = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== "checkbox";
      const working = S.view === "company" && ((S.tab === "bank" && B() && (B().q || B().sel.size || bankRangeOn())) || S.selected || S.revQuery || S.drawerOpen || (S.revSel && S.revSel.size));
      if (clients.length === 1 && S.coId !== clients[0].id && !busyTyping && !working && !document.querySelector("#confirmBox[style*='flex']")){
        await openCompany(clients[0].id);
        toast((first ? "" : "Tally switched company. ") + "Showing " + clients[0].name + ", the company open in Tally.");
      }
    }
    if (before !== Bridge.st.state || changed){
      if (S.view === "company" && S.tab === "bank" && B() && bridgeLive()) bankAutoSync(false);
      if (S.view === "company" && S.tab === "sales" && SL() && !SL().loading && bridgeLive()) salesAutoSync(false);
      // redraw only when nobody is in the middle of something
      const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      const midWork = S.drawerOpen || (S.revSel && S.revSel.size) || S.revQuery || (S.view === "company" && S.tab === "bank" && B() && (B().q || (B().sel && B().sel.size) || bankRangeOn())) || (S.billPost && S.billPost.busy);
      if (typing || midWork) refreshBridgeChip(); else render();
    } else refreshBridgeChip();
  } finally { bridgeBusy = false; }
}
// the inbox is looked at every two minutes while the window is in front: a small database call, nothing asked of Tally
setInterval(() => { if (document.visibilityState === "visible" && Cloud.on()) loadDocq(true); }, 120000);
function startBridgePolling(){
  // ask Tally rarely: it serves other people on the same server

  clearInterval(bridgeTimer);
  if (!Bridge.on()) return;
  bridgeTick(true);
  const every = Math.max(60000, num(Bridge.cfg().pollSec || 60) * 1000);   // never more often than once a minute
  const jitter = Math.floor(Math.random() * 8000);
  bridgeTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - (Bridge.st.lastAsk || 0) < every - 2000) return;
    bridgeTick(false);
  }, every + jitter);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Bridge.on() && Date.now() - (Bridge.st.lastAsk || 0) > 30000) bridgeTick(false); });

function bridgeChip(co){
  if (!Bridge.on()) return "";
  const st = Bridge.st;
  if (st.state === "down") return '<button class="tchip off" data-act="openSettings" title="' + esc(st.error) + '">FinCom Bridge offline \u2014 check</button>';
  if (st.state === "key") return '<span class="tchip bad" title="' + esc(st.error) + '">FinCom Bridge: wrong key</span>';
  if (st.state !== "ok") return '<span class="tchip off">FinCom Bridge\u2026</span>';
  const run = (st.jobs || []).find(j => ["queued", "waiting", "running"].includes(j.status));
  if (run) return '<span class="tchip ok" title="' + esc((run.company || "") + ": " + (run.message || "")) + '">\u25CF Posting to Tally: ' + num(run.done) + " of " + num(run.total) + "</span>";
  // build 194: Tally stopped answering (a message box open in Tally, or a long report): said plainly, with since when
  // go-bridge: a slow Tally is busy, never "disconnected" (it is open; the bridge asks again by itself)
  const busyAt = (st.stuck && st.stuck.since) || (st.tallyState === "busy" && st.busySince) || "";
  if (busyAt || st.tallyState === "busy") return '<span class="tchip warn" title="Tally is open but answering slowly' + (busyAt ? " since " + esc(fmtTime(busyAt)) : "") + '. A message box (a pop-up) in Tally, or a report still working, holds it up: close it, and FinCom carries on by itself. Nothing is lost meanwhile.">\u25D0 Tally busy' + (busyAt ? " since " + esc(fmtTime(busyAt)) : "") + "</span>";
  if (st.shaky) return '<span class="tchip warn" title="' + esc(st.error || "") + '">FinCom Bridge: reconnecting\u2026</span>';
  const why = Bridge.diag && (Bridge.diag.findings || []).find(f => f.level !== "ok");
  if (st.pinMissing) return '<button class="tchip warn" data-act="openSettings" title="' + esc(why ? why.text : "The Tally chosen in Settings is not running") + '">Your Tally is not connected \u2014 check</button>';
  if (!st.tallyUp) return '<button class="tchip warn" data-act="openSettings" title="' + esc(why ? why.text : "No TallyPrime is answering in your Windows session") + '">Tally not connected \u2014 check</button>';
  if (co){
    const o = Bridge.openFor(co);
    if (o) return '<span class="tchip ok" title="' + esc(o.name) + " is open in Tally (port " + o.port + ')">\u25CF Open in Tally</span>';
    if ((st.clash || []).some(n => norm(n) === norm(Bridge.tallyName(co)))) return '<span class="tchip bad" title="This company is open in more than one Tally. Choose yours in Settings \u2192 FinCom Bridge.">Choose your Tally</span>';
    return '<span class="tchip warn" title="Open ' + esc(Bridge.tallyName(co)) + ' in TallyPrime to post and to load its ledgers">\u25CB Not open in Tally</span>';
  }
  if ((st.clash || []).length) return '<span class="tchip bad" title="' + esc(st.clash.join(", ")) + ' is open in more than one Tally. Choose yours in Settings \u2192 FinCom Bridge.">Choose your Tally</span>';
  const n = st.open.length;
  return '<span class="tchip ok" title="' + esc(st.open.map(o => o.name).join(", ")) + '">\u25CF Tally: ' + (n === 1 ? esc(st.open[0].name) : n + " companies open") + "</span>";
}

/* ---------- ledgers and bank entries straight from Tally ---------- */
// The client's ledgers are one list for the whole app (Ledgers, src/js/58-ledgers.js): read from FinCom's cloud copy
// whenever the client is linked to it, else from the bridge (review of 02-Oct-2026: an older, shorter list kept in this
// browser was never replaced while the bridge was live, as the ledgers were read again only when that list was empty,
// and the cloud copy only when the bridge was not live). These two keep their names for their callers.
async function ensureCloudLedgers(cid){
  const r = await Ledgers.load(cid);
  return !!(r && r.ok);
}
async function syncLedgersFromTally(silent){
  const b = B(), co = CO(b && b.cid);
  if (!co) return false;
  const r = await Ledgers.load(co.id, {force: true});
  if (!r.ok){ if (!silent) toast("Could not load ledgers from Tally: " + r.err); return false; }
  if (!silent) toast(r.n + " ledgers loaded from Tally" + (r.kept ? " (a shorter list of " + r.kept + " was not taken)" : "") + ((r.mapped || []).length ? "; " + r.mapped.length + " default ledger names matched to Tally" : "") + ".");
  return true;
}
// after the list held for a client changed: what depended on the old one is looked at again
function ledgersChanged(cid){
  const co = CO(cid), b = S.bank;
  if (b && b.cid === cid){
    b.rows.forEach(r => { if (["ready", "suggested"].includes(r.state) && r.ledger && !exactLedger(r.ledger)){ r.userSet = false; r.state = "attention"; } });
    // bank accounts with no ledger yet: a guess when it is clear, shown to confirm (src/js/60); a ledger chosen is never
    // replaced here (it was replaced by a guess whenever it was not in the list read, a short or older one included)
    (co.bankAccounts || []).forEach(a => { if (!bankLedgerChoice(co, a).value){ const g = guessBankLedger(a); if (g && choiceGuess(co, "bank:" + a.id, g, "the one bank ledger in Tally that fits")) Store.saveCompany(co); } });
    if (b.rows.length){ suggestAll(b.rows, true); saveBank({rows: true}); }
  }
  const mapped = Ledgers.cid() === cid ? autoMapCompanyLedgers(co) : [];
  if (typeof billAutoAll === "function" && Ledgers.cid() === cid) billAutoAll(cid);
  return mapped;
}
function guessBankLedger(a){
  const b = B();
  const bankLeds = Ledgers.list(b.cid).filter(l => BANK_GROUPS.test(l.group || ""));
  const byAc = bankLeds.filter(l => a.acct && l.acNo && l.acNo.replace(/\D/g, "").endsWith(String(a.acct).replace(/\D/g, "").slice(-6)));
  if (byAc.length === 1) return byAc[0].name;
  const by4 = bankLeds.filter(l => a.last4 && l.name.includes(a.last4));
  if (by4.length === 1) return by4[0].name;
  const short = String(a.bank || "").split(" ")[0].toLowerCase();
  const byName = bankLeds.filter(l => short && l.name.toLowerCase().includes(short));
  return byName.length === 1 ? byName[0].name : "";
}
// Tally's own entries in this bank ledger: rows already booked are marked, and their ledgers are learnt
async function syncBankBookFromTally(silent, win){
  const b = B(), co = CO(b.cid), st = curStmt();
  if (!st || !tallyVia(co)) return 0;
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  const ledger = acc && exactLedger(acc.ledger);
  if (!ledger) return 0;
  try {
    const from = win ? win.from : addDays(st.from || b.rows[0].date, -20), to = win ? win.to : addDays(st.to || b.rows[b.rows.length - 1].date, 20);
    const j = win && win.pre ? win.pre : await tallyCall(co, ledgerLinesUrl(tallyCoName(co), ledger, from, to), null, 300000);
    if (copyNotCovered(j)){ if (!silent) toast(COPY_NOT_COVERED); return 0; }
    const entries = [];
    [].concat(j.vouchers || []).forEach(v => {
      if (/^yes$/i.test(v.cancelled || "")) return;
      v.entries = [].concat(v.entries || []);
      const be = v.entries.find(e => e.ledger === ledger);
      if (!be){
        if (/^yes$/i.test(v.optional || "") && /TDSDesk:/i.test(v.narration || "")) entries.push({date: tallyToIso(v.date), debit: 0, credit: 0, party: v.party || "", vt: (v.type || "") + " (Optional)", vn: v.number || "", guid: v.guid || "", inst: "", narr: String(v.narration || "")});
        return;
      }
      const a = parseFloat(String(be.amount).replace(/,/g, "")) || 0;
      const other = (v.entries || []).find(e => e.ledger !== ledger);
      entries.push({date: tallyToIso(v.date), debit: a < 0 ? -a : 0, credit: a > 0 ? a : 0, party: (other && other.ledger) || v.party || "", vt: v.type || "", vn: v.number || "", guid: v.guid || "", inst: String(be.instrument || ""), narr: String(v.narration || "")});
    });
    if (win){
      // a short look before posting: match only the lines about to go, and never reopen anything
      b.books[st.acctId] = {entries, file: "Tally (live, " + from + " to " + to + ")", importedAt: new Date().toISOString(), live: true, partial: true};
      const n0 = matchTallyBook(acc, win.rows, false);
      saveBank({rows: true});
      if (win.throwOnError === false) return n0;
      return n0;
    }
    b.books[st.acctId] = {entries, file: "Tally (live)", importedAt: new Date().toISOString(), live: true};
    saveBank({books: true});
    const n = matchTallyBook(acc, b.rows, true);
    saveBank({rows: true});
    b.syncedAt = b.syncedAt || {}; b.syncedAt[st.id] = Date.now();
    if (!silent) toast("Checked against Tally: " + entries.length + " entries in " + ledger + ", " + n + " already booked.");
    return n;
  } catch (e){ if (win) throw e; if (!silent) toast("Could not read the bank ledger from Tally: " + e.message); return 0; }
}
let bankSyncing = false;
async function bankAutoSync(force){
  const b = B(), co = CO();
  if (!b || bankSyncing || !bridgeLive(co)) return;
  bankSyncing = true;
  try {
    const before = (b.ledgers.list || []).length;
    // the one ledger list (Ledgers): read again when someone asks, and by itself when the cloud's ledgers changed or
    // nothing is held yet (not only when the list here is empty: review of 02-Oct-2026)
    await Ledgers.load(b.cid, {force: !!force});
    const st = curStmt();
    if (st && force) await syncBankBookFromTally(true);   // only when asked: this reads the Day Book
    if (force || (b.ledgers.list || []).length !== before) render();
  } finally { bankSyncing = false; }
  // lines marked as posted that were deleted in Tally since: looked for quietly, at most every 3 minutes per statement
  const st = curStmt();
  // build 190: only when someone asks (Refresh from Tally); not every 3 minutes by itself (it read the day book each time)
  if (force && st && bridgeVer(Bridge.st.version) >= bridgeVer("1.12.3") && b.rows.some(r => ["sent", "intally"].includes(r.state))){
    const k = st.id, last = (b.goneAt || {})[k] || 0;
    if (Date.now() - last > 3 * 60000){ b.goneAt = Object.assign({}, b.goneAt, {[k]: Date.now()}); try { await checkMarkedInTally({quiet: true}); } catch (e){} }
  }
}
/* ---------- bank reconciliation: the statement against the bank ledger in Tally, line by line ---------- */
// One read of the bank ledger for the statement's dates and one of its balance. Each statement line is paired with a
// Tally entry: first by FinCom's tag, then by amount and a nearby date. What is left on either side, and any pair
// whose amounts differ, makes up the difference; each comes with the action that removes it (post, delete, replace).
async function reconcileBank(opts){
  opts = opts || {};
  const b = B(), co = CO(b.cid), st = curStmt();
  if (!st) return null;
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId), ledger = acc && exactLedger(acc.ledger);
  if (!ledger){ toast("Choose the Tally ledger for this bank account first."); return null; }
  const tname = await ensureTallyCompany(co);
  if (!tname) return null;
  b.busy = "Reconciling " + ledger + " with the statement…"; render();
  let rec;
  try {
    const tb = await tallyBankBalance(tname, ledger, st.to);
    const jl = await Bridge.call(ledgerLinesUrl(tname, ledger, st.from, st.to), null, 600000);
    if (!Array.isArray(jl.vouchers)) throw {message: "Tally did not return the entries of " + ledger + "."};
    // Tally's side
    const T = [];
    jl.vouchers.filter(v => !/^yes$/i.test(v.cancelled || "")).forEach(v => {
      const be = [].concat(v.entries || []).find(e => norm(e.ledger) === norm(ledger));
      if (!be) return;
      const other = [].concat(v.entries || []).find(e => norm(e.ledger) !== norm(ledger));
      const date = tallyToIso(v.date);
      if (date < st.from || date > st.to) return;
      T.push({i: T.length, guid: v.guid || "", masterId: v.masterId || "", type: v.type || "", number: v.number || "", date, vdate: v.date,
        party: (other && other.ledger) || v.party || "", eff: r2(-(parseFloat(String(be.amount).replace(/,/g, "")) || 0)),
        narr: String(v.narration || ""), tag: ((String(v.narration || "").match(/TDSDesk:([A-Za-z0-9]+)/i) || [])[1] || "").toLowerCase(), optional: /^yes$/i.test(v.optional || "")});
    });
    // pair them
    const rows = b.rows.filter(r => r.date >= st.from && r.date <= st.to);
    const byTag = new Map(); rows.forEach(r => byTag.set(fpHash(r.fp || r.id), r));
    const pairOf = new Map(), used = new Set(), differ = [], dupOf = new Map();
    T.forEach(t => {                                   // 1. by FinCom's tag
      const r = t.tag && byTag.get(t.tag);
      if (!r) return;
      if (pairOf.has(r.id)){ dupOf.set(t.i, r.id); used.add(t.i); return; }
      pairOf.set(r.id, t.i); used.add(t.i);
      if (Math.abs(t.eff - bankEffect(r)) >= 0.01) differ.push({rowId: r.id, ti: t.i});
    });
    const days = (a1, b1) => Math.abs((new Date(a1) - new Date(b1)) / 864e5);
    [0, 1].forEach(pass => rows.forEach(r => {          // 2. same amount, same day first, then a nearby day
      if (pairOf.has(r.id)) return;
      const win = pass === 0 ? 0 : (r.dec && r.dec.mode === "CHQ" ? 15 : 4);
      let best = null;
      T.forEach(t => { if (used.has(t.i) || t.tag && byTag.has(t.tag) || Math.abs(t.eff - bankEffect(r)) >= 0.01) return; const d = days(t.date, r.date); if (d <= win && (!best || d < best.d)) best = {t, d}; });
      if (best){ pairOf.set(r.id, best.t.i); used.add(best.t.i); }
    }));
    const missing = rows.filter(r => !pairOf.has(r.id)).map(r => r.id);
    const extra = T.filter(t => !used.has(t.i) || dupOf.has(t.i)).map(t => t.i);
    // what FinCom shows follows what Tally has: paired lines count as in Tally, lines Tally does not have are not
    const now = new Date().toISOString();
    b.postedTags = b.postedTags || {};
    rows.forEach(r => {
      if (pairOf.has(r.id)){
        if (["ready", "attention", "suggested"].includes(r.state)){ r.prevState = r.state; r.state = "intally"; r.tallyHow = "found in Tally when reconciling"; const t = T[pairOf.get(r.id)]; r.tallyRef = [t.type, t.number, t.party].filter(Boolean).join(" · "); }
        if (r.state === "intally" || r.state === "sent") b.postedTags[fpHash(r.fp || r.id)] = b.postedTags[fpHash(r.fp || r.id)] || "tally:" + now;
      }
    });
    saveBank({rows: true, posted: true});
    const sum = (list, f) => r2(list.reduce((a, x) => a + f(x), 0));
    const rowById = new Map(b.rows.map(r => [r.id, r]));
    const all = b.rows.reduce((a, r) => a + bankEffect(r), 0);
    const sOpen = st.opening !== undefined && st.opening !== null && st.opening !== "" ? r2(num(st.opening)) : (st.closing !== undefined ? r2(num(st.closing) - all) : null);
    const sClose = st.closing !== undefined && st.closing !== null && st.closing !== "" ? r2(num(st.closing)) : (sOpen !== null ? r2(sOpen + all) : null);
    const tClose = tb.close, tOpen = r2(tClose - T.reduce((a, t) => a + t.eff, 0));
    const mEff = sum(missing, id => bankEffect(rowById.get(id)));
    const xEff = sum(extra, i => T[i].eff);
    const dEff = sum(differ, d => bankEffect(rowById.get(d.rowId)) - T[d.ti].eff);
    const openDiff = sOpen === null ? 0 : r2(sOpen - tOpen);
    rec = {sid: st.id, at: Date.now(), company: tname, ledger, from: st.from, to: st.to, T, pairs: pairOf.size, how: tb.how, laterN: tb.laterN, missing, extra, differ, dupOf: Array.from(dupOf.entries()),
      tOpen, tClose, sOpen, sClose, mEff, xEff, dEff, openDiff,
      unexplained: sClose === null ? null : r2(sClose - (tClose + mEff - xEff + dEff + openDiff)), pick: new Set(extra.filter(i => T[i].tag || dupOf.has(i)))};
    st.tallyBal = {at: Date.now(), ledger, company: tname, from: st.from, to: st.to, openAsOn: addDays(st.from, -1), tOpen, tClose, sOpen, sClose, diffOpen: sOpen === null ? null : openDiff, diff: sClose === null ? null : r2(sClose - tClose),
      notIn: [], notInEffect: 0, left: [], leftEffect: 0, extra: null, reconciled: true};
    saveBank({stmts: true});
  } catch (e){ b.busy = ""; toast("Could not reconcile: " + (e.message || e)); render(); return null; }
  S.recon = rec; b.focus = null; b.busy = "";
  render();
  if (!opts.stay) window.scrollTo({top: 0, behavior: "smooth"});
  return rec;
}
async function reconPost(){
  const b = B(), R = S.recon;
  if (!R) return;
  const ids = R.missing.filter(id => { const r = b.rows.find(x => x.id === id); return r && ["ready", "sent", "intally"].includes(r.state) && r.ledger && exactLedger(r.ledger); });
  if (!ids.length) return;
  // lines marked as posted that Tally does not have: posted afresh
  b.rows.forEach(r => { if (ids.includes(r.id) && ["sent", "intally"].includes(r.state)){ if (b.postedTags) delete b.postedTags[fpHash(r.fp || r.id)]; r.state = "ready"; r.tally = null; r.postVerified = false; r.postByReply = false; r.checking = false; r.tallyHow = ""; r.tallyRef = ""; delete r.tallyIdx; } });
  b.tallyLook = null; lsDel(wideCheckKey());
  saveBank({rows: true, posted: true});
  await postBankToTally(ids);
  await reconcileBank({stay: true});
}
async function reconDelete(which){
  const b = B(), R = S.recon;
  if (!R) return;
  const list = which === "replace" ? R.differ.map(d => R.T[d.ti]) : Array.from(R.pick).map(i => R.T[i]);
  if (!list.length) return;
  const total = list.reduce((a, t) => a + Math.abs(t.eff), 0);
  const a = await askConfirm({title: which === "replace" ? "Replace " + list.length + " entr" + (list.length === 1 ? "y" : "ies") + " in " + R.company + "?" : "Delete " + list.length + " entr" + (list.length === 1 ? "y" : "ies") + " from " + R.company + "?", ok: which === "replace" ? "Replace them" : "Delete them",
    body: '<p class="note">' + list.slice(0, 12).map(t => esc(fmtDate(t.date) + " " + [t.type, t.number].filter(Boolean).join(" ") + " " + t.party + " " + INR.format(Math.abs(t.eff)))).join("<br>") + (list.length > 12 ? "<br>and " + (list.length - 12) + " more" : "") +
      "<br><br>" + (which === "replace" ? "Each Tally entry is deleted and the statement line is posted again with the statement’s amount." : "Total " + INR.format(total) + ".") + " This cannot be undone from FinCom: take a Tally backup first if you have not.</p>"});
  if (!a) return;
  let ok = 0, bad = 0;
  const why = [], gone = new Set();
  for (let k = 0; k < list.length; k++){
    const t = list[k];
    b.busy = (which === "replace" ? "Replacing " : "Deleting ") + (k + 1) + " of " + list.length + " in Tally…"; render();
    try {
      const j = await Bridge.call("/unpost", {company: R.company, guid: t.guid, masterId: t.masterId, vchType: t.type, vchDate: t.vdate, vchNumber: t.number}, 60000);
      if (j && j.ok !== false){ ok++; gone.add(t.i); logPosting({what: "bank", id: t.guid, action: "removed", co: b.cid, ref: "reconciliation " + [t.type, t.number].join(" "), party: t.party, amount: Math.abs(t.eff), tally: {guid: t.guid, vchType: t.type, vchDate: t.vdate, company: R.company}, by: (Cloud.st && Cloud.st.email) || ""}); }
      else { bad++; why.push(fmtDate(t.date) + " " + [t.type, t.number].filter(Boolean).join(" ") + ": " + ((j && (j.message || j.error)) || "Tally did not delete it")); }
    } catch (e){ bad++; why.push(fmtDate(t.date) + " " + [t.type, t.number].filter(Boolean).join(" ") + ": " + (e.message || e)); }
  }
  b.busy = ""; b.tallyLook = null;
  toast(ok + (which === "replace" ? " removed from Tally" : " deleted from Tally") + (bad ? "; " + bad + " not deleted \u2014 Tally\u2019s reason is shown in the reconciliation" : "") + ".");
  if (which === "replace"){
    // the statement lines go in again with their own amount, only where the old entry really went
    const ids = R.differ.filter(d => gone.has(d.ti)).map(d => d.rowId);
    b.rows.forEach(r => { if (ids.includes(r.id)){ if (b.postedTags) delete b.postedTags[fpHash(r.fp || r.id)]; r.state = r.ledger && exactLedger(r.ledger) ? "ready" : "attention"; r.tally = null; r.postVerified = false; r.postByReply = false; r.tallyHow = ""; r.tallyRef = ""; delete r.tallyIdx; } });
    lsDel(wideCheckKey()); saveBank({rows: true, posted: true});
    await postBankToTally(ids.filter(id => (b.rows.find(r => r.id === id) || {}).state === "ready"));
  }
  const R2 = await reconcileBank({stay: true});
  if (R2 && why.length){ R2.deleteProblems = why; render(); }
}

/* ---------- lines marked as posted that are no longer in Tally (deleted there) ---------- */
// Every line FinCom posted carries its tag in Tally's narration; a line matched to an entry typed in Tally is found by
// amount and date. A line marked as posted that Tally no longer has is offered back for posting, never posted by itself.
function markedGone(pre, from, to){
  const b = B(), co = CO(b.cid), st = curStmt();
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId), ledger = acc && exactLedger(acc.ledger);
  const vs = [].concat(pre.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || ""));
  const tags = new Set();
  vs.forEach(v => { const m = String(v.narration || "").match(/TDSDesk:([A-Za-z0-9]+)/ig) || []; m.forEach(x => tags.add(x.slice(8).toLowerCase())); });
  const lines = vs.map(v => { const be = [].concat(v.entries || []).find(e => norm(e.ledger) === norm(ledger)); return be ? {date: tallyToIso(v.date), eff: r2(-(parseFloat(String(be.amount).replace(/,/g, "")) || 0))} : null; }).filter(Boolean);
  const used = new Set();
  const days = (a1, b1) => Math.abs((new Date(a1) - new Date(b1)) / 864e5);
  const marked = b.rows.filter(r => ["sent", "intally"].includes(r.state) && r.date >= from && r.date <= to && !r.postedOptional);
  const gone = [];
  marked.forEach(r => {
    if (tags.has(fpHash(r.fp || r.id))) return;
    const win = r.dec && r.dec.mode === "CHQ" ? 15 : 4;
    const i = lines.findIndex((l, k) => !used.has(k) && Math.abs(l.eff - bankEffect(r)) < 0.01 && days(l.date, r.date) <= win);
    if (i >= 0){ used.add(i); return; }
    gone.push(r.id);
  });
  return {ids: gone, marked: marked.length, bankLines: lines.length, at: Date.now()};
}
async function checkMarkedInTally(opts){
  opts = opts || {};
  const b = B(), co = CO(b.cid), st = curStmt();
  if (!st) return null;
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId), ledger = acc && exactLedger(acc.ledger);
  if (!ledger) return null;
  const tname = opts.tname || (bridgeLive(co) ? Bridge.openFor(co).name : await ensureTallyCompany(co));
  if (!tname) return null;
  const dsAll = b.rows.map(r => r.date).filter(Boolean).sort(), today = new Date().toISOString().slice(0, 10);
  const from = addDays(dsAll[0], -15), to = addDays(dsAll[dsAll.length - 1] > today ? dsAll[dsAll.length - 1] : today, 7);
  if (!opts.quiet){ b.busy = "Checking in Tally that the posted lines are still there\u2026"; render(); }
  let pre = opts.pre;
  try { if (!pre) pre = await Bridge.call(ledgerLinesUrl(tname, ledger, from, to), null, 600000); }
  catch (e){ if (!opts.quiet){ b.busy = ""; toast("Tally could not be read: " + e.message); render(); } return null; }
  if (!Array.isArray(pre.vouchers)){ if (!opts.quiet){ b.busy = ""; render(); } return null; }
  b.tallyLook = {sid: st.id, at: Date.now(), data: pre};
  const g = markedGone(pre, from, to);
  g.sid = st.id; g.ledger = ledger; g.company = tname;
  b.gone = g.ids.length ? g : null;
  if (!opts.quiet){ b.busy = ""; toast(g.ids.length ? g.ids.length + " line" + (g.ids.length === 1 ? " is" : "s are") + " no longer in Tally." : "All " + g.marked + " posted lines are still in Tally."); }
  render();
  return g;
}
function goneBack(){
  const b = B(), g = b.gone;
  if (!g) return;
  const ids = new Set(g.ids);
  let n = 0;
  b.rows.forEach(r => {
    if (!ids.has(r.id) || !["sent", "intally"].includes(r.state)) return;
    n++;
    if (b.postedTags) delete b.postedTags[fpHash(r.fp || r.id)];
    r.state = r.ledger && exactLedger(r.ledger) ? "ready" : "attention";
    r.tally = null; r.postVerified = false; r.postByReply = false; r.checking = false; r.postError = ""; r.postedVia = ""; r.sentAt = ""; delete r.tallyIdx; r.tallyHow = ""; r.tallyRef = "";
  });
  b.gone = null; b.focus = null; b.filter = "ready"; b.tallyLook = null;
  lsDel(wideCheckKey());
  saveBank({rows: true, posted: true});
  toast(n + " line" + (n === 1 ? " is" : "s are") + " back in Post to Tally. Press Post to send " + (n === 1 ? "it" : "them") + " to Tally again.");
  render();
}
/* ---------- finding double entries, and entries Tally holds under the wrong date ---------- */
// Reads this bank ledger from Tally over a wide window (not only the statement's dates), so an entry FinCom sent that
// Tally filed under another date is found too. Every FinCom entry carries its line's tag in the narration.
//   extra     : a second (third...) copy of a line that is already in Tally at the right date
//   wrongDate : a line that is in Tally only under another date, or an extra copy under another date
//   strangers : FinCom entries whose amount is not on this statement at all
async function scanStatementInTally(opts){
  opts = opts || {};
  const b = B(), co = CO(b.cid), st = curStmt();
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  const tname = opts.tname || await ensureTallyCompany(co);
  if (!tname) return null;
  const ledger = exactLedger(acc.ledger);
  const ds = b.rows.map(r => r.date).filter(Boolean).sort();
  const today = new Date().toISOString().slice(0, 10);
  const open = Bridge.openFor(co) || {};
  const booksFrom = /^\d{8}$/.test(String(open.from || "")) ? tallyDate(open.from) : "";
  let from = addDays(ds[0], -60);
  if (booksFrom && from < booksFrom) from = booksFrom;
  const last = ds[ds.length - 1] > today ? ds[ds.length - 1] : today;
  let to = addDays(last, 31);
  // bridge 1.12.1: one light read of FinCom's own entries (heads only); older: this bank ledger month by month
  // 1.12.3: this bank ledger's own vouchers (light, with amounts); 1.12.1-2: FinCom's tagged entries; older: the Day Book
  const byLedger = tallyVia(co) === "cloud" || bridgeVer(Bridge.st.version) >= bridgeVer("1.12.3");
  const light = !byLedger && bridgeVer(Bridge.st.version) >= bridgeVer("1.12.1");
  if (opts.pre){ from = opts.from; to = opts.to; }
  const j = opts.pre || await tallyCall(co, light ? "/tags?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(from) + "&to=" + isoToTally(to) + Bridge.pinQ() : ledgerLinesUrl(tname, ledger, from, to), null, 600000);
  if (copyNotCovered(j)) return {at: Date.now(), total: 0, tagged: 0, extra: [], wrongDate: [], strangers: [], badOnly: [], company: tname, amountOf: () => 0, from, to, notChecked: COPY_NOT_COVERED};
  const vs = [].concat(j.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || ""));
  const rowByTag = new Map(b.rows.map(r => [fpHash(r.fp || r.id), r]));
  const groups = new Map();
  vs.forEach(v => {
    const m = String(v.narration || "").match(/TDSDesk:([A-Za-z0-9]+)/i);
    if (!m) return;
    const k = m[1].toLowerCase();
    (groups.get(k) || groups.set(k, []).get(k)).push(v);
  });
  const tagOf = v => (String(v.narration || "").match(/TDSDesk:([A-Za-z0-9]+)/i) || [])[1];
  const amountOf = v => {
    const en = [].concat(v.entries || []).find(x => norm(x.ledger) === norm(ledger));
    if (en) return Math.abs(parseFloat(String(en.amount).replace(/,/g, "")) || 0);
    const r = rowByTag.get(String(tagOf(v) || "").toLowerCase());
    return r ? num(r.debit || r.credit) : 0;
  };
  const onStmt = new Set(b.rows.map(r => tallyToIso(isoToTally(r.date)) + "|" + r2(r.debit || r.credit)));
  const extra = [], wrongDate = [], strangers = [], goodTags = [], badOnly = [];
  groups.forEach((list, k) => {
    list.sort((a, c) => num(a.masterId) - num(c.masterId) || String(a.number).localeCompare(String(c.number)));
    const row = rowByTag.get(k);
    if (!row){
      // the light read sees every FinCom entry of the company (other statements, bills): only this statement's lines matter
      if (light){ goodTags.push(k); return; }
      // not a line of this statement: a line of another statement of this account, or an old copy
      const v = list[0];
      if (amountOf(v) && !onStmt.has(tallyToIso(v.date) + "|" + r2(amountOf(v)))) list.forEach(x => strangers.push(x));
      else if (list.length > 1) list.slice(1).forEach(x => extra.push(x));
      goodTags.push(k);
      return;
    }
    const want = isoToTally(row.date);
    const good = list.filter(v => String(v.date) === want), bad = list.filter(v => String(v.date) !== want);
    bad.forEach(v => { v.rowId = row.id; v.wantDate = row.date; wrongDate.push(v); });
    if (good.length){ good.slice(1).forEach(v => extra.push(v)); goodTags.push(k); }
    else badOnly.push(row.id);
  });
  // what is in Tally at the right date counts as posted, so it is never posted again from here;
  // a line that is in Tally only under a wrong date is not: once that copy is removed it is posted afresh
  b.postedTags = b.postedTags || {};
  goodTags.forEach(k => { b.postedTags[k] = b.postedTags[k] || "tally:" + new Date().toISOString(); });
  saveBank({posted: true});
  return {at: Date.now(), total: vs.length, tagged: Array.from(groups.values()).reduce((a, l) => a + l.length, 0), extra, wrongDate, strangers, badOnly, company: tname, amountOf, from, to};
}
function wideCheckKey(){ const st = curStmt(); return "tdsdesk:tallywide:" + (st ? st.id : ""); }
async function findTallyDuplicates(){
  const b = B(), co = CO(b.cid), st = curStmt();
  if (!st){ toast("Open a statement first."); return; }
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  if (!acc || !exactLedger(acc.ledger)){ toast("Set the Tally ledger for this bank account first."); return; }
  b.busy = "Reading " + exactLedger(acc.ledger) + " from Tally, month by month…"; render();
  try { S.dupFind = await scanStatementInTally(); }
  catch (e){ b.busy = ""; toast("Could not read Tally: " + e.message); render(); return; }
  b.busy = "";
  if (S.dupFind && !S.dupFind.notChecked && !S.dupFind.extra.length && !S.dupFind.wrongDate.length) lsSet(wideCheckKey(), String(Date.now()));
  render();
}
async function removeTallyDuplicates(which){
  const d = S.dupFind;
  const list = d ? (which === "wrong" ? d.wrongDate : d.extra) : [];
  if (!list.length) return;
  const what = which === "wrong" ? list.length + " wrong-date entr" + (list.length === 1 ? "y" : "ies") : list.length + " extra cop" + (list.length === 1 ? "y" : "ies");
  const a = await askConfirm({title: "Remove " + what + " from " + d.company + "?", ok: "Remove them",
    body: '<p class="note">' + (which === "wrong" ? "Only the copies under the wrong date are removed. The lines then show as not posted, and Post puts them in with the right date." : "Only the later copy of each double entry is removed; the first stays.") + " This cannot be undone from FinCom, so take a Tally backup first if you have not.</p>"});
  if (!a) return;
  const b = B();
  let ok = 0, bad = 0;
  const gone = new Set();
  for (let i = 0; i < list.length; i++){
    const v = list[i];
    b.busy = "Removing " + (i + 1) + " of " + list.length + "…"; render();
    try {
      const j = await Bridge.call("/unpost", {company: d.company, guid: v.guid || "", vchType: v.type, vchDate: v.date, vchNumber: v.number || ""}, 60000);
      if (j && j.ok !== false){
        ok++; if (v.rowId) gone.add(v.rowId);
        logPosting({what: "bank", id: v.guid, action: "removed", co: b.cid, ref: (which === "wrong" ? "wrong date " : "double entry ") + (v.number || ""), party: v.party, amount: d.amountOf(v), tally: {guid: v.guid, vchType: v.type, vchDate: v.date, company: d.company}, by: (Cloud.st && Cloud.st.email) || ""});
      } else bad++;
    } catch (e){ bad++; }
  }
  // a line whose only copy in Tally was under a wrong date is not posted any more: back to ready, so Post sends it
  if (which === "wrong") b.rows.forEach(r => {
    if (!gone.has(r.id) || !d.badOnly.includes(r.id)) return;
    if (b.postedTags) delete b.postedTags[fpHash(r.fp || r.id)];
    if (["sent", "intally"].includes(r.state)){ r.state = "ready"; r.tally = null; r.postedVia = ""; }
    r.postError = "";
  });
  saveBank({rows: true, posted: true});
  b.busy = "";
  toast(ok + " removed from Tally" + (bad ? ", " + bad + " could not be removed — delete those in Tally" : "") + "." + (which === "wrong" && ok ? " Post the lines again to put them in with the right date." : ""));
  S.dupFind = null;
  lsDel(wideCheckKey());
  render();
}

// a bank line Tally has (or is reading back: pendingCheck): sent, with Tally's voucher. Round 17a: Tally's reply (bridge
// 2.1.8, byReply) is posted, said so (r.postByReply); o: {by, quiet} for a line marked afterwards from FinCom's cloud
// (postReconcile, src/js/59): who pressed Post there, and no second record in this browser's posting log
function bankPosted(cid, r, x, tname, now, o){
  o = o || {};
  const b = B(), who = o.by || (Cloud.st && Cloud.st.email) || "";
  r.state = "sent"; r.sentAt = now; r.postedVia = "bridge"; r.postError = ""; r.postedOptional = !!x.optional; r.postVerified = x.verified === true; r.checking = !!x.pendingCheck;
  r.postByReply = x.verified !== true && x.byReply === true;
  if (b && b.cid === cid){ b.postedTags = b.postedTags || {}; b.postedTags[fpHash(r.fp || r.id)] = now; }
  if (!o.quiet) logPosting({what: "bank", id: r.id, action: "posted", co: cid, ref: String(r.narr || "").slice(0, 40), party: r.ledger, amount: num(r.debit || r.credit), tally: {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", company: tname}, by: who});
  r.tally = {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", at: now, by: who, company: tname};
  // round 15 (B1): Tally's voucher id, or the batch's last id, from bridge 2.1.8
  const mk = typeof postTallyMark === "function" ? postTallyMark(x, {company: tname, at: now, by: o.by || postMyName()}) : null;
  if (mk) Object.assign(r.tally, mk);
  if (r.billId && D(cid).entries[r.billId]){ const e = D(cid).entries[r.billId]; e.paidBy = r.id; Store.saveEntry(cid, e); }
  markSalesReceived(r);
}
/* ---------- after a posting: the bridge's read-back arrives in the background ---------- */
async function bankAfterCheck(cid, sid, chk, tname){
  const b = B(), here = b && b.cid === cid && b.cur === sid;
  const rows = here ? b.rows : ((await BankDB.get("stmt:" + cid + ":" + sid)) || []);
  const byId = new Map([].concat(chk.results || []).map(x => [x.id, x]));
  const now = new Date().toISOString();
  let confirmed = 0, notFound = [], unread = 0;
  rows.forEach(r => {
    if (!r.checking) return;
    const x = byId.get(r.id);
    r.checking = false;
    if (x && postTaken(x)){
      confirmed++; r.postVerified = x.verified === true; r.postByReply = x.verified !== true && x.byReply === true; r.postError = "";
      r.tally = Object.assign({}, r.tally || {}, {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", number: x.vchNumber || ""});
    } else if (x && !x.ok){
      // Tally said it made it, but it is not there: not counted as posted, and not sent again without a look
      r.state = "ready"; r.postVerified = false;
      r.postError = "Failed: not found in Tally when read back after posting, so it is not counted as posted. Look in Tally before posting it again.";
      if (here){ b.postedTags = b.postedTags || {}; b.postedTags[fpHash(r.fp || r.id)] = "unconfirmed:" + now; }
      notFound.push({id: r.id, what: fmtDate(r.date) + " " + (r.dec.name || "") + " " + INR.format(r.debit || r.credit), msg: "not found in Tally after posting \u2014 check Tally before posting again"});
    } else { unread++; r.postVerified = false; }
  });
  if (here){
    saveBank({rows: true, posted: true});
    const rep = b.postReport;
    if (rep && rep.checking){
      rep.checking = false; rep.confirmed = confirmed; rep.unread = unread + (chk.checkFailed ? 0 : 0);
      if (notFound.length){ rep.posted -= notFound.length; rep.failed = (rep.failed || []).concat(notFound); }
    }
    render();
    // and then the balance, once, for the whole batch
    if (!notFound.length) { try { await checkBankBalance({quiet: true, tname, closeOnly: true}); } catch (e){} }
  } else BankDB.set("stmt:" + cid + ":" + sid, rows);
}

/* ---------- the bank ledger's balance on a date, from FinCom's copy ---------- */
// FinCom Bridge 2.1.4 asks Tally for no balance (owner's decision of 02-Oct-2026): the balance on the statement's last
// day is the copy's opening of the ledger plus its entries up to that day (TCloud.ledgerAt: tally_balances, else
// tally_ledger), shown with "Balance from FinCom's copy · books as of 15:34". Neither the bridge nor Tally is asked.
// tname is kept for the callers; cid is the client (the open one when not given)
async function tallyBankBalance(tname, ledger, to, cid){
  cid = cid || S.coId;
  const close = await TCloud.ledgerAt(cid, ledger, to);
  return {close, how: "copy", later: 0, laterN: 0, line: copyLine(cid), asOf: (booksAsOf(cid) || {}).at || ""};
}

/* ---------- does the bank ledger agree with the bank? ---------- */
// The bank ledger's balance in FinCom's copy at the end of the statement, against the statement's own closing. Only once
// every entry FinCom posted to the statement is read back (in Tally, and in FinCom's copy): until then "Posted · balance
// not yet checked". Never an error: when the copy cannot answer yet, "balance not yet checked" with the reason.
// When they differ, the difference is taken apart: the statement lines not posted yet, the lines left out, and (with the
// bridge here) the entries for these dates that are not on the statement. Whatever is left is shown as unexplained.
function bankEffect(r){ return r2(num(r.credit) - num(r.debit)); }
async function checkBankBalance(opts){
  opts = opts || {};
  const b = B(), co = CO(b.cid), st = curStmt();
  if (!st) return null;
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  const ledger = acc && exactLedger(acc.ledger);
  if (!ledger){ if (!opts.quiet) toast("Choose the Tally ledger for this bank account first."); return null; }
  const cid = b.cid, tname = opts.tname || co.tallyName || (TCloud.book(cid) || {}).company || co.name;
  const sid = st.id;
  b.balBusy = true; if (!opts.quiet){ b.busy = "Working out " + ledger + "'s balance from FinCom's copy…"; } render();
  let res;
  const base = () => ({at: Date.now(), ledger, company: tname, from: st.from, to: st.to, line: copyLine(cid)});
  try {
    // the copy's state (when it last read Tally) before deciding whether the entries posted are read back
    try { if (TCloud.on()) await TCloud.status(cid, true); } catch (e){}
    const wait = bankNotReadBack(b.rows, cid);
    if (wait.length) throw {pending: wait.length};
    const tb = await tallyBankBalance(tname, ledger, st.to, cid);
    const all = b.rows.reduce((a, r) => a + bankEffect(r), 0);
    const sOpen = st.opening !== undefined && st.opening !== null && st.opening !== "" ? r2(num(st.opening)) : (st.closing !== undefined ? r2(num(st.closing) - all) : null);
    const sClose = st.closing !== undefined && st.closing !== null && st.closing !== "" ? r2(num(st.closing)) : (sOpen !== null ? r2(sOpen + all) : null);
    res = Object.assign(base(), {openAsOn: addDays(st.from, -1), tOpen: null, tClose: tb.close, how: tb.how, later: tb.laterN, sOpen, sClose, line: tb.line, asOf: tb.asOf});
    res.diffOpen = sOpen === null || res.tOpen === null ? null : r2(sOpen - res.tOpen);
    res.diff = sClose === null ? null : r2(sClose - res.tClose);
    const notIn = b.rows.filter(r => !["sent", "intally", "ignored"].includes(r.state));
    const left = b.rows.filter(r => r.state === "ignored");
    res.notIn = notIn.map(r => r.id); res.notInEffect = r2(notIn.reduce((a, r) => a + bankEffect(r), 0));
    res.left = left.map(r => r.id); res.leftEffect = r2(left.reduce((a, r) => a + bankEffect(r), 0));
    res.extra = null;
    if (res.diff !== null && Math.abs(res.diff) >= 0.01 && opts.explain && typeof bridgeLive === "function" && bridgeLive(co)) try {
      // which entries does Tally have for these dates that the statement does not?
      if (!opts.quiet) { b.busy = "The balance differs: reading " + ledger + " for " + fmtDate(st.from) + " to " + fmtDate(st.to) + " to find out why…"; render(); }
      const jv = await Bridge.call(ledgerLinesUrl(tname, ledger, st.from, st.to), null, 600000);
      const posted = b.rows.filter(r => ["sent", "intally"].includes(r.state));
      const byTag = new Map(posted.map(r => [fpHash(r.fp || r.id), r]));
      const used = new Set();
      const extra = [];
      const days = (a1, b1) => Math.abs((new Date(a1) - new Date(b1)) / 864e5);
      [].concat(jv.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || "")).forEach(v => {
        const be = [].concat(v.entries || []).find(e => norm(e.ledger) === norm(ledger));
        if (!be) return;
        const eff = r2(-(parseFloat(String(be.amount).replace(/,/g, "")) || 0));
        const date = tallyToIso(v.date);
        const tag = (String(v.narration || "").match(/TDSDesk:([A-Za-z0-9]+)/i) || [])[1];
        let hit = tag && byTag.get(tag.toLowerCase());
        if (hit && used.has(hit.id)) hit = null;
        if (!hit) hit = posted.find(r => !used.has(r.id) && Math.abs(bankEffect(r) - eff) < 0.01 && days(r.date, date) <= (r.dec && r.dec.mode === "CHQ" ? 15 : 3));
        if (hit){ used.add(hit.id); if (Math.abs(bankEffect(hit) - eff) >= 0.01) extra.push({date, type: v.type || "", number: v.number || "", party: (([].concat(v.entries || []).find(e => norm(e.ledger) !== norm(ledger)) || {}).ledger) || v.party || "", eff: r2(eff - bankEffect(hit)), note: "amount differs from the statement line of " + fmtDate(hit.date), rowId: hit.id}); return; }
        extra.push({date, type: v.type || "", number: v.number || "", party: (([].concat(v.entries || []).find(e => norm(e.ledger) !== norm(ledger)) || {}).ledger) || v.party || "", eff, narr: String(v.narration || "").slice(0, 120)});
      });
      // lines marked as in Tally that Tally does not show for these dates
      res.missing = posted.filter(r => !used.has(r.id)).map(r => r.id);
      res.missingEffect = r2(b.rows.filter(r => res.missing.includes(r.id)).reduce((a, r) => a + bankEffect(r), 0));
      res.extra = extra; res.extraEffect = r2(extra.reduce((a, x) => a + x.eff, 0));
      res.unexplained = r2(res.diff - (res.diffOpen || 0) - res.notInEffect - res.leftEffect - res.missingEffect + res.extraEffect);
    } catch (e){ res.extra = null; }
  } catch (e){
    // not an error on the screen: posted and not read back yet, or the copy cannot answer yet (it says why)
    res = Object.assign(base(), e && e.pending ? {pending: e.pending} : {notYet: (e && e.message) || String(e)});
  }
  const st2 = b.stmts.find(x => x.id === sid);
  if (st2){ st2.tallyBal = res; saveBank({stmts: true}); }
  b.balBusy = false; if (!opts.quiet) b.busy = "";
  render();
  return res;
}
function bankFocus(title, ids, note){ const b = B(); b.focus = {title, ids: [].concat(ids || []), note: note || ""}; b.sel.clear(); b.limit = 500; }

/* ---------- taking an entry back out of Tally ---------- */
async function unpostFromTally(what, obj, cid){
  const co = CO(cid || S.coId);
  const t = obj.tally || {};
  if (!t.guid){
    toast("This entry was posted before FinCom kept the Tally identity, so it has to be deleted in Tally by hand.");
    return false;
  }
  const tname = await ensureTallyCompany(co);
  if (!tname) return false;
  const ans = await askConfirm({title: "Remove this entry from Tally?", ok: "Remove it",
    body: '<p class="note">Voucher ' + esc(t.vchType || "") + " " + esc(obj.tallyVchNo || t.masterId || "") + " dated " + esc(t.vchDate ? fmtDate(tallyToIso(t.vchDate)) : "") +
      " will be deleted from <b>" + esc(t.company || tname) + "</b>. It then comes back here as waiting to be posted.</p>"});
  if (!ans) return false;
  try {
    const j = await Bridge.call("/unpost", {company: t.company || tname, guid: t.guid, vchType: t.vchType, vchDate: t.vchDate}, 120000);
    if (!j || j.ok === false){ toast("Tally would not remove it: " + plainMsg((j && (j.message || j.error)) || "")); return false; }
    logPosting({what, id: obj.id, action: "removed", co: co.id, tally: t, by: (Cloud.st && Cloud.st.email) || ""});
    toast("Removed from Tally.");
    return true;
  } catch (e){ toast("Could not remove it: " + e.message); return false; }
}
// a plain record of everything sent to Tally, and anything taken back
function logPosting(rec){
  S.firm.postLog = (S.firm.postLog || []).concat([Object.assign({at: new Date().toISOString()}, rec)]).slice(-4000);
  Store.saveFirm();
}
/* ---------- posting ---------- */
// "Posting 30 of 120 to <company>…", or the bridge's own words while it waits for Tally
function postingLine(pj, tname){
  const n = pj.total || 0, d = Math.min(pj.done || 0, n);
  const head = n ? "Posting to " + tname + ": " + d + " of " + n + " done" : "Posting to " + tname;
  return head + (pj.message && !/^(Posting|Starting|Resuming|Finding)/.test(pj.message) ? " \u2014 " + pj.message : "\u2026");
}
function refreshBusy(){ softRender(); }
async function postBankToTally(ids){
  const b = B(), co = CO(b.cid), st = curStmt();
  if (!st) return;
  const tname = await ensureTallyCompany(co);
  if (!tname) return;
  // round 17a: a line a finished posting of FinCom's cloud already put in Tally is marked first, so it is not sent again
  if (typeof postReconcile === "function") postReconcile(b.cid);
  if (Bridge.st.allowImport === false){ toast("Posting is switched off in the bridge settings (AllowImport)."); return; }
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  const heavy = b.checkBeforePost === true;
  let checkNote = "";
  b.busy = heavy ? "Loading ledgers and this bank ledger from Tally\u2026" : "Checking the ledgers\u2026"; render();
  const readyBefore = new Set(b.rows.filter(r => r.state === "ready").map(r => r.id));
  const inTallyBefore = b.rows.filter(r => r.state === "intally").length;
  const ledgerAge = Date.now() - new Date((b.ledgers || {}).importedAt || 0).getTime();
  if (!b.ledgers.live || ledgerAge > 60 * 60000) await syncLedgersFromTally(true);
  // posting uses the confirmed ledger only (src/js/60): not chosen, guessed, or gone from Tally → nothing is posted
  if (!acc || !bankLedgerReady(co, acc)){ b.busy = ""; toast(bankLedgerWhy(co, acc) || "Choose the Tally ledger for this bank account first (the set-up line at the top)."); render(); return; }
  acc.ledger = bankLedgerReady(co, acc);
  if (heavy) await syncBankBookFromTally(true);
  // guard 1: this computer's own record of lines already posted, whatever happened to the statement since
  b.postedTags = b.postedTags || {};
  b.rows.forEach(r => {
    if (r.state !== "ready" || (ids && !ids.includes(r.id))) return;
    const tag = fpHash(r.fp || r.id);
    if (b.postedTags[tag]){ r.prevState = r.state; r.state = "intally"; r.tallyHow = "posted by FinCom on " + fmtDate(String(b.postedTags[tag]).slice(0, 10)); }
  });
  // guard 2: look in Tally itself around the dates being posted, for our own entries and for ones typed in by hand
  const toCheck = b.rows.filter(r => r.state === "ready" && (!ids || ids.includes(r.id)));
  // bridge 1.12.3+: ONE read of this bank ledger covers both looks (these dates, and anything FinCom put in before),
  // and is reused for 30 minutes, so posting the next batch starts at once
  const oneRead = tallyVia(co) === "cloud" || bridgeVer(Bridge.st.version) >= bridgeVer("1.12.3");
  if (toCheck.length && !heavy && oneRead){
    try {
      const look = b.tallyLook && b.tallyLook.sid === st.id && Date.now() - b.tallyLook.at < 30 * 60000 ? b.tallyLook : null;
      let pre = look && look.data;
      const dsAll = b.rows.map(r => r.date).filter(Boolean).sort(), today = new Date().toISOString().slice(0, 10);
      const from = addDays(dsAll[0], -15), to = addDays(dsAll[dsAll.length - 1] > today ? dsAll[dsAll.length - 1] : today, 7);
      if (!pre){
        b.busy = "Looking at " + acc.ledger + " in Tally before posting\u2026"; render();
        pre = await tallyCall(co, ledgerLinesUrl(tname, acc.ledger, from, to), null, 600000);
        b.tallyLook = {sid: st.id, at: Date.now(), data: pre};
      }
      if (copyNotCovered(pre)){ checkNote = COPY_NOT_COVERED; b.tallyLook = null; }
      else {
      const g = markedGone(pre, from, to);
      if (g.ids.length){ g.sid = st.id; g.ledger = acc.ledger; g.company = tname; b.gone = g; }
      await syncBankBookFromTally(true, {from, to, rows: toCheck, pre});
      toCheck.forEach(r => { if (r.state === "intally") b.postedTags[fpHash(r.fp || r.id)] = b.postedTags[fpHash(r.fp || r.id)] || "tally:" + new Date().toISOString(); });
      saveBank({posted: true});
      if (!lsGet(wideCheckKey())){
        const d = await scanStatementInTally({tname, pre, from, to});
        if (d.extra.length || d.wrongDate.length){
          S.dupFind = d; b.busy = ""; b.tallyLook = null;
          toast("Nothing was posted: Tally already has entries from this statement under the wrong date or twice. Sort them out below, then post.");
          render(); return;
        }
        lsSet(wideCheckKey(), String(Date.now()));
      }
      }
    } catch (e){
      b.busy = ""; b.tallyLook = null; render();
      toast("Tally could not be checked before posting (" + e.message + "), so nothing was posted. Try again in a moment.");
      return;
    }
  }
  if (toCheck.length && !heavy && !oneRead){
    const ds = toCheck.map(r => r.date).sort();
    const wide = toCheck.some(r => r.dec && r.dec.mode === "CHQ") ? 15 : 4;
    try {
      b.busy = "Checking Tally for these dates\u2026"; render();
      await syncBankBookFromTally(true, {from: addDays(ds[0], -wide), to: addDays(ds[ds.length - 1], wide), rows: toCheck});
      toCheck.forEach(r => { if (r.state === "intally") b.postedTags[fpHash(r.fp || r.id)] = b.postedTags[fpHash(r.fp || r.id)] || "tally:" + new Date().toISOString(); });
      saveBank({posted: true});
    } catch (e){
      b.busy = ""; render();
      toast("Tally could not be checked for these dates (" + e.message + "), so nothing was posted. Try again in a moment.");
      return;
    }
  }
  // guard 2b: once per statement, look through Tally well beyond these dates for entries FinCom put under another date,
  // or put in twice; if there are any, nothing is posted until they are sorted out
  if (toCheck.length && !oneRead && !lsGet(wideCheckKey())){
    try {
      b.busy = "Checking Tally for earlier postings of this statement (once per statement)\u2026"; render();
      const d = await scanStatementInTally({tname});
      if (d.extra.length || d.wrongDate.length){
        S.dupFind = d; b.busy = "";
        toast("Nothing was posted: Tally already has entries from this statement under the wrong date or twice. Sort them out below, then post.");
        render(); return;
      }
      lsSet(wideCheckKey(), String(Date.now()));
    } catch (e){
      b.busy = ""; render();
      toast("Tally could not be checked (" + e.message + "), so nothing was posted. Try again in a moment.");
      return;
    }
  }
  // guard 3: a line that does not agree with the statement's running balance was probably misread, so it is not posted
  const misread = b.rows.filter(r => r.state === "ready" && (!ids || ids.includes(r.id)) && r.balOk === false);
  misread.forEach(r => { r.state = "attention"; r.why = ["This line does not agree with the statement\u2019s running balance, so it may have been misread. Check the amount against the bank statement before posting."]; });
  const skipped = b.rows.filter(r => r.state === "intally").length - inTallyBefore;
  const movedBack = b.rows.filter(r => readyBefore.has(r.id) && ["attention", "suggested"].includes(r.state)).length;
  let rows = b.rows.filter(r => r.state === "ready" && (!ids || ids.includes(r.id)));
  const failed = [];
  rows = rows.filter(r => {
    const need = [r.ledger].concat(r.tdsAtPay ? [r.tdsLedger || bankLedgers(co).tds] : []);
    const miss = need.find(n => !exactLedger(n));
    if (miss !== undefined){
      const sug = suggestLedgers(miss || "", "party", 1);
      r.postError = "Ledger \u201c" + (miss || "(none)") + "\u201d is not in Tally" + (sug.length ? " (Tally has \u201c" + sug[0] + "\u201d)" : "");
      failed.push({id: r.id, what: fmtDate(r.date) + " " + (r.dec.name || "") + " " + INR.format(r.debit || r.credit), msg: r.postError});
      return false;
    }
    r.ledger = exactLedger(r.ledger);
    if (r.tdsAtPay) r.tdsLedger = exactLedger(r.tdsLedger || bankLedgers(co).tds);
    return true;
  });
  if (!rows.length){
    b.busy = "";
    b.postReport = {at: Date.now(), posted: 0, skipped, movedBack, failed, dismiss: "bankReportOk"};
    saveBank({rows: true});
    toast(skipped ? "Those entries are already in Tally; nothing new to post." : "Nothing to post.");
    render(); return;
  }
  const used = new Set(rows.map(r => r.ledger.toLowerCase()));
  const masters = b.newLed.filter(l => !l.sent && used.has(l.name.toLowerCase()));
  b.busy = "Posting " + entries(rows.length) + " to " + tname + "\u2026"; render();
  try {
    const j = await Bridge.post({company: tname, client: co.id, ledger: acc.ledger,
      masters: masters.map(l => ({id: "led:" + l.name, xml: ledgerMasterXml(l)})),
      // round 15: bank: true tells bridge 2.1.8 to batch these by its bank-lines-per-request setting (bills carry nothing)
      vouchers: rows.map(r => ({id: r.id, xml: bankVoucherXml(r, acc, co), bank: true}))}, pj => { b.busy = postingLine(pj, tname); refreshBusy(); },
      chk => bankAfterCheck(b.cid, st.id, chk, tname));
    // B14: stopped by the check of the company this client may post to: nothing sent, the lines stay ready
    if (j.notAllowed){
      const why = ([].concat(j.results || []).find(x => x.notAllowed) || {}).message || postToProblem(co, tname);
      postStopped(why, co.id); b.busy = ""; b.postReport = {at: Date.now(), posted: 0, skipped, movedBack, failed: [], notAllowed: plainMsg(why), dismiss: "bankReportOk"};
      toast("Not sent to Tally: choose the Tally company " + co.name + " may post to."); render(); return;
    }
    const byId = new Map([].concat(j.results || []).map(x => [x.id, x]));
    const now = new Date().toISOString();
    masters.forEach(l => { const x = byId.get("led:" + l.name); if (x && x.ok){ l.sent = true; l.sentAt = now; if (!x.existed) logPosting({what: "ledger", id: "led:" + l.name, action: postAltered(x) ? "altered" : "created", co: b.cid, ref: l.name, party: l.group || "", amount: 0, tally: {company: tname}, by: (Cloud.st && Cloud.st.email) || ""}); } else if (x) failed.push({what: "New ledger " + l.name, msg: x.message}); });
    let ok = 0, optionalN = 0;
    const posted = [];
    rows.forEach(r => {
      // bridge 2.1.4: the same voucher found in Tally just before posting: in Tally (with that voucher), not failed. A
      // check that could not be made leaves the line ready, with the bridge's one line (below, as any refusal)
      const x0 = byId.get(r.id), x = postAlready(x0) ? Object.assign({}, x0, {ok: true, verified: true, vchNumber: x0.vchNumber || x0.vchNo || ""}) : x0;
      // round 17a: Tally's reply (bridge 2.1.8, byReply) is posted, not "not yet read back" (postTaken, src/js/59)
      if (x && x.ok && !postTaken(x) && !x.pendingCheck){
        b.postedTags = b.postedTags || {}; b.postedTags[fpHash(r.fp || r.id)] = "unconfirmed:" + now;
        r.postError = "In Tally, not yet read back: Tally took it, but FinCom has not found it in Tally since, so it is not counted as posted. Look in Tally (Day Book, and Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers). If it is not there, post it again." + (x.verifyNote ? " [" + x.verifyNote + "]" : "");
        failed.push({id: r.id, what: fmtDate(r.date) + " " + (r.dec.name || "") + " " + INR.format(r.debit || r.credit), msg: "In Tally, not yet read back \u2014 look in Tally before posting again"});
      } else if (x && x.ok){
        ok++; bankPosted(b.cid, r, x, tname, now); posted.push(r);
        if (x.optional) optionalN++;
      } else {
        r.postError = plainMsg(x && x.message) || "Tally did not confirm this entry.";
        failed.push({id: r.id, what: fmtDate(r.date) + " " + (r.dec.name || "") + " " + INR.format(r.debit || r.credit), msg: r.postError});
      }
    });
    learnRows(posted, "sent");
    saveBank({rows: true, newLed: true, posted: true});
    b.postReport = {at: Date.now(), posted: ok, skipped, movedBack, failed, dismiss: "bankReportOk", company: tname, optional: optionalN, noPreCheck: !heavy, checking: !!j.checking, checkNote};
    toast(ok + " posted to Tally" + (skipped ? ", " + skipped + " were already there" : "") + (failed.length ? ", " + failed.length + " not posted" : "") + ".");
    if (!failed.length && !b.rows.some(r => r.state === "ready")) b.filter = "done";
    b.afterPost = !j.checking && !j.viaCloud;
    b.tallyLook = null;          // Tally has changed: the next posting looks again
  } catch (e){
    if (e && e.code === "cancelled") toast(e.message);
    else { toast("Posting failed: " + e.message); b.postReport = {at: Date.now(), posted: 0, skipped, movedBack, failed: failed.concat([{what: "Posting", msg: e.message}]), dismiss: "bankReportOk"}; }
  }
  b.busy = "";
  render();
  if (b.afterPost){ b.afterPost = false; try { await checkBankBalance({quiet: true, tname, closeOnly: true}); } catch (e){} }
}
async function checkBillsInTally(onlyUnconfirmed){
  const co = CO();
  const tname = await ensureTallyCompany(co);
  if (!tname) return;
  const sent = Object.values(D().entries).filter(e => e.status === "approved" && e.x.invoiceDate && (onlyUnconfirmed ? (!e.exportedAt && e.postUnconfirmed) : (e.exportedAt || e.postUnconfirmed)));
  if (!sent.length){ toast("No bills are marked as sent."); return; }
  S.billCheck = {busy: true}; render();
  try {
    const dates = sent.map(e => e.x.invoiceDate).sort();
    const vt = co.voucherType || "Journal";
    const j = await tallyCall(co, "/vouchers?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(addDays(dates[0], -5)) + "&to=" + isoToTally(addDays(dates[dates.length - 1] > new Date().toISOString().slice(0, 10) ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10), 31)) + "&types=" + encodeURIComponent([vt, "Purchase", "Journal", co.debitNoteType || "Debit Note"].join(",")) + Bridge.pinQ(), null, 300000);
    const vs = [].concat(j.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || ""));
    const now = new Date().toISOString();
    const missing = [], wrongDate = [];
    let optional = 0;
    sent.forEach(e => {
      const hit = vs.find(v => String(v.narration || "").includes("TDSDesk:" + e.id)) ||
        vs.find(v => norm(v.reference) === norm(e.x.invoiceNo) && (norm(v.party) === norm(e.partyLedger) || [].concat(v.entries || []).some(en => norm(en.ledger) === norm(e.partyLedger))));
      e.tallyCheck = {at: now, found: !!hit, optional: !!(hit && /^yes$/i.test(hit.optional || "")), company: tname};
      if (hit && !e.exportedAt){ e.exportedAt = now; e.postUnconfirmed = null; e.postError = ""; e.postVerified = true; e.postedOptional = e.tallyCheck.optional; e.postedInto = tname; }
      if (hit && e.tallyCheck.optional) optional++;
      if (hit && String(hit.date || "") !== isoToTally(e.x.invoiceDate)){ e.tallyCheck.wrongDate = String(hit.date || ""); wrongDate.push({no: e.x.invoiceNo, party: e.x.vendorName, want: e.x.invoiceDate, got: tallyToIso(hit.date)}); }
      if (!hit) missing.push(e);
      Store.saveEntry(co.id, e);
    });
    S.billCheck = {at: now, checked: sent.length, found: sent.length - missing.length, optional, missing: missing.map(e => e.id), wrongDate, company: tname};
  } catch (err){ S.billCheck = {error: err.message}; }
  render();
}
async function postBillsToTally(opts){
  opts = opts || {};
  const co = CO();
  const tname = await ensureTallyCompany(co);
  if (!tname) return;
  if (!S.bank || S.bank.cid !== co.id) await loadBank(co.id);
  // round 17a: a bill a finished posting of FinCom's cloud already put in Tally is marked first, so it is not sent again
  if (typeof postReconcile === "function") postReconcile(co.id);
  S.billPost = {busy: "Loading ledgers from Tally…"}; render();
  await syncLedgersFromTally(true);
  autoMapCompanyLedgers(co);
  // round 17a: never a bill the newest posting of FinCom's cloud put in Tally, holds for review, is still sending, or is
  // looking for (each is settled there, not sent again from here)
  const jobSt = typeof postJobStates === "function" ? postJobStates(co.id) : new Map();
  let list = Object.values(D().entries).filter(e => e.status === "approved" && !e.exportedAt && (!opts.ids || opts.ids.includes(e.id))
    && !((st => st === "posted" ? !e.postedVia : ["review", "unknown", "sending"].includes(st))((jobSt.get(String(e.id)) || {}).st))).sort(byDate);
  if (!list.length){ S.billPost = null; toast("No approved entries are waiting."); render(); return; }
  canonicalizeBills(list);
  // review 21c: a bill whose GST, TDS or expense ledger comes from a Client setup choice that is only guessed waits,
  // with the one-line reason; nothing of it is sent (src/js/60 billGuessedWhy)
  const guessed = list.map(e => [e, billGuessedWhy(e, co)]).filter(x => x[1]);
  if (guessed.length){
    const why = guessed[0][1] + (guessed.length > 1 ? " (" + guessed.length + " bills)" : "") + " Confirm it in Client setup.";
    list = list.filter(e => !guessed.some(x => x[0] === e));
    postStopped(why, co.id);
    if (!list.length){ S.billPost = {notAllowed: plainMsg(why), company: ""}; toast(why); refreshStats(co.id); render(); return; }
  }
  // round 19: the second-send test (a typed REMOTEID) adds test entries: asked once, naming the company, unless Post
  // asked already (postAllToTally: opts.trialOk); No: nothing sent, the bills stay waiting
  if (!opts.trialOk && typeof remoteIdTrial === "function" && remoteIdTrial(co) && typeof postTrialConfirm === "function"){
    S.billPost = null; render();
    if (!(await postTrialConfirm(co, list.length))){ toast("Nothing sent: the test posting was cancelled."); render(); return; }
  }
  const failed = [];
  const blocked = list.filter(e => e.snapshot.lines.some(l => !exactLedger(l.ledger)));
  blocked.forEach(e => { const l = e.snapshot.lines.find(x => !exactLedger(x.ledger)); e.postError = "Ledger “" + (l.ledger || "(none)") + "” is not in Tally"; unapply(e, co.id); e.postFailedAt = new Date().toISOString(); Store.saveEntry(co.id, e); failed.push({id: e.id, no: e.x.invoiceNo, party: e.x.vendorName, msg: e.postError}); });
  let todo = list.filter(e => !blocked.includes(e));
  S.billPost = {busy: "Checking Tally for bills already booked…"}; render();
  try {
    const dates = todo.map(e => e.x.invoiceDate).filter(Boolean).sort();
    const now = new Date().toISOString();
    let dup = [], checkNote = "";
    if (dates.length){
      const vt = co.voucherType || "Journal";
      // round 18 (owner, 04-Oct-2026: reading is prospective only): bridge 2.1.9 refuses reading entries from Tally. Then
      // this check is not possible and the posting goes on: FinCom's own checks stand (its records, the cloud's id lock)
      let j0;
      try { j0 = await tallyCall(co, "/vouchers?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(addDays(dates[0], -5)) + "&to=" + isoToTally(addDays(dates[dates.length - 1], 5)) + "&types=" + encodeURIComponent([vt, "Purchase", "Journal"].join(",")) + Bridge.pinQ());
      } catch (e){
        if (!/Reading entries from Tally is off/i.test(String((e && e.message) || e))) throw e;
        j0 = {vouchers: []}; checkNote = "Bills already in Tally could not be checked (reading entries from Tally is off on this computer); FinCom's own records were checked.";
      }
      const vs0 = [].concat(j0.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || ""));
      const seen = new Set(vs0.map(v => norm(v.reference) + "|" + norm(v.party)).concat(vs0.flatMap(v => [].concat(v.entries || []).flatMap(en => [].concat(en.bills || []).map(bl => norm(bl.name) + "|" + norm(en.ledger))))));
      const marks = vs0.map(v => String(v.narration || "")).join("\n");
      dup = todo.filter(e => seen.has(norm(e.x.invoiceNo) + "|" + norm(e.partyLedger)) || marks.includes("TDSDesk:" + e.id));
      dup.forEach(e => { e.exportedAt = now; e.postNote = "Already in Tally"; Store.saveEntry(co.id, e); });
      todo = todo.filter(e => !dup.includes(e));
    }
    let ok = 0, optionalN = 0, unverified = 0, altered = 0, checkFailed = 0, byReplyN = 0, replyWords = "";
    const masterWords = [];
    if (todo.length){
      const used = new Set(todo.flatMap(e => e.snapshot.lines.map(l => String(l.ledger).toLowerCase())));
      const masters = B().newLed.filter(l => !l.sent && used.has(l.name.toLowerCase()));
      S.billPost = {busy: "Posting " + entries(todo.length) + " to " + tname + "…"}; render();
      const j = await Bridge.post({company: tname, client: co.id, masters: masters.map(l => ({id: "led:" + l.name, xml: ledgerMasterXml(l)})), vouchers: todo.map(e => ({id: e.id, xml: voucherXml(e, co)}))},
        pj => { S.billPost = {busy: postingLine(pj, tname)}; refreshBusy(); }, chk => billsAfterCheck(co.id, chk, tname));
      // B14: stopped by the check of the company this client may post to: nothing was sent, not Tally's reason; the
      // bills stay waiting under Post to Tally, as they were
      if (j.notAllowed){
        const why = ([].concat(j.results || []).find(x => x.notAllowed) || {}).message || postToProblem(co, tname);
        postStopped(why, co.id); S.billPost = {notAllowed: plainMsg(why), company: tname};
        toast("Not sent to Tally: choose the Tally company " + co.name + " may post to.");
        refreshStats(co.id); render(); return;
      }
      const byId = new Map([].concat(j.results || []).map(x => [x.id, x]));
      replyWords = typeof postReply === "function" ? postReply(Array.from(byId.values())).text : "";   // round 14c (C7): Tally's reply words
      masters.forEach(l => { const x = byId.get("led:" + l.name); if (x && x.ok){ l.sent = true; l.sentAt = now; } if (x) masterWords.push({name: l.name, word: x.ok ? postWord(x) : "Failed: " + plainMsg(x.message)});
        if (x && x.ok && !x.existed) logPosting({what: "ledger", id: "led:" + l.name, action: postAltered(x) ? "altered" : "created", co: co.id, ref: l.name, party: l.group || "", amount: 0, tally: {company: x.company || tname}, by: (Cloud.st && Cloud.st.email) || ""}); });
      saveBank({newLed: true});
      // a voucher number another supplier already used: try once more with this supplier's initials added
      const clash = todo.filter(e => { const x = byId.get(e.id); return x && !x.ok && !postAlready(x) && !postCheckFail(x) && /already\s+exists/i.test(x.message || "") && co.vchNumbering !== "tally"; });
      if (clash.length){
        clash.forEach(e => { e.vchNo = (e.x.invoiceNo || "B") + "/" + initialsOf(e.x.vendorName || e.partyLedger); });
        S.billPost = {busy: "Voucher numbers already used in Tally: trying " + clash.length + " again with the supplier’s initials…"}; render();
        try {
          const j2 = await Bridge.post({company: tname, client: co.id, masters: [], vouchers: clash.map(e => ({id: e.id, xml: voucherXml(e, co)}))}, null, chk => billsAfterCheck(co.id, chk, tname));
          [].concat(j2.results || []).forEach(x => byId.set(x.id, x));
        } catch (err){ /* reported below as refused */ }
      }
      todo.forEach(e => {
        const x = byId.get(e.id);
        // bridge 2.1.4 found the same bill in Tally as it was about to post: in Tally, with that voucher, not failed
        if (postAlready(x)){ billAlready(co.id, e, x, tname, now); dup.push(e); }
        // bridge 2.1.4 could not check Tally first: nothing was posted; the bill stays waiting, with that one line
        else if (postCheckFail(x)){ e.postCheckFailed = {at: now, message: plainMsg(x.message) || "Could not check Tally, not posted. Try again."}; e.postError = ""; checkFailed++; }
        // round 17a: Tally's reply (bridge 2.1.8, byReply) counts as posted, as a read back does (postTaken, src/js/59)
        else if (x && postTaken(x)){ ok++; if (postAltered(x)) altered++; else if (x.verified !== true && x.byReply === true) byReplyN++; billPosted(co.id, e, x, tname, now); if (x.optional) optionalN++; }
        else if (x && x.ok){ unverified++; e.postUnconfirmed = {at: now, company: x.company || tname, optional: /Optional/.test(x.verifyNote || ''), pending: !!x.pendingCheck};
          e.postError = (/Optional/.test(x.verifyNote || '') && x.message) ? plainMsg(x.message) : x.pendingCheck ? "In Tally, not yet read back: FinCom reads it back from Tally by itself in a moment." : "In Tally, not yet read back: Tally took it, but FinCom has not found it in Tally since, so it is not counted as posted. Look in Tally (Day Book, and Display More Reports → Exception Reports → Optional Vouchers). If it is not there, post it again." + (x.verifyNote ? " [" + x.verifyNote + "]" : "");
          failed.push({id: e.id, no: e.x.invoiceNo, party: e.x.vendorName, msg: "In Tally, not yet read back", unread: true}); }
        else {
          e.postError = plainMsg(x && x.message) || "Tally did not confirm this entry.";
          failed.push({id: e.id, no: e.x.invoiceNo, party: e.x.vendorName, msg: e.postError});
          unapply(e, co.id); e.postFailedAt = now;                          // back to review, with Tally's reason on it
        }
        Store.saveEntry(co.id, e);
      });
    }
    S.billPost = {done: true, ok, bad: failed.length, dup: dup.length, failed, optional: optionalN, unverified, altered, byReply: byReplyN, checkFailed, masters: masterWords, company: tname, checkNote,
      reply: replyWords};
    toast(ok + " posted to " + tname + (altered ? " (" + altered + " altered in Tally)" : "") + (optionalN ? " (" + optionalN + " as Optional vouchers)" : "") + (dup.length ? ", " + dup.length + " already there" : "") + (checkFailed ? ", " + checkFailed + " not posted: Tally could not be checked first" : "") + (failed.length ? ", " + failed.length + " not posted" : "") + ".");
  } catch (e){
    if (e && e.code === "cancelled"){ S.billPost = {cancelled: e.message}; toast(e.message); }
    else { S.billPost = {error: e.message, failed}; toast("Posting failed: " + e.message); }
  }
  refreshStats(co.id); render();
}
// a bill Tally has: marked as posted, with Tally's voucher. o (round 17a): {by, quiet} for a posting marked afterwards from
// FinCom's cloud (postReconcile): who pressed Post there, and no second record in this browser's posting log
function billPosted(cid, e, x, tname, now, o){
  o = o || {};
  const who = o.by || (Cloud.st && Cloud.st.email) || "";
  if (!o.quiet) logPosting({what: "bill", id: e.id, action: postAltered(x) ? "altered" : "posted", co: cid, ref: e.x.invoiceNo, party: e.x.vendorName, amount: num(e.x.total), tally: {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", company: x.company || tname}, by: who});
  e.exportedAt = now; e.postError = ""; e.postUnconfirmed = null; e.postCheckFailed = null; e.postedVia = "bridge"; e.postedInto = x.company || tname; e.postedOptional = !!x.optional; e.postVerified = x.verified === true; e.postAltered = postAltered(x); e.tallyVchNo = x.vchNumber || "";
  // round 17a: posted by Tally's reply (bridge 2.1.8 does not read back): in Tally (billInTally), said so
  e.postByReply = x.verified !== true && x.byReply === true;
  e.tally = {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", at: now, by: who, company: x.company || tname};
  // round 15 (B1): bridge 2.1.8 says Tally's exact voucher id (one voucher a request) or the batch's last id: kept here
  const mk = typeof postTallyMark === "function" ? postTallyMark(x, {company: x.company || tname, at: now, by: o.by || postMyName()}) : null;
  if (mk) Object.assign(e.tally, mk);
  // the owner's spec of 04-Oct (B): Tally's reply kept on the bill, so the Post page says it in one sentence wherever the
  // posting came from (postReplySentence, src/js/62); a result without counts keeps nothing
  const rep = {};
  ["created", "altered", "ignored", "exceptions", "errors", "lastVchId"].forEach(k => { if (x[k] != null && x[k] !== "") rep[k] = x[k]; });
  if (Object.keys(rep).length){ rep.ok = true; if (x.message) rep.message = String(x.message).slice(0, 300); e.tally.reply = rep; }
}
// already in Tally (bridge 2.1.4 checks Tally for the same party, bill no., date and amount at every posting): marked as
// in Tally with Tally's voucher, as a verified posting is, and said "Already in Tally"
function billAlready(cid, e, x, tname, now){
  billPosted(cid, e, Object.assign({}, x, {ok: true, verified: true, vchNumber: x.vchNumber || x.vchNo || "", vchDate: x.vchDate || x.date || ""}), tname, now);
  e.postNote = "Already in Tally"; e.postAlreadyMsg = plainMsg(x.message) || "";
}
// the bridge has read back the bills it put in Tally: the ones found count as posted now
function billsAfterCheck(cid, chk, tname){
  const d = S.data[cid];
  if (!d) return;
  const now = new Date().toISOString();
  let n = 0;
  [].concat((chk && chk.results) || []).forEach(x => {
    const e = d.entries[x.id];
    if (!e || e.exportedAt || !e.postUnconfirmed) return;
    if (postAlready(x)){ billAlready(cid, e, x, tname, now); n++; }
    else if (postTaken(x)){ billPosted(cid, e, x, tname, now); n++; }
    else { e.postUnconfirmed = Object.assign({}, e.postUnconfirmed, {pending: false}); e.postError = x.ok ? "In Tally, not yet read back: Tally took it, but FinCom did not find it in Tally afterwards. Look in Tally before posting it again." : "Failed: " + (plainMsg(x.message) || "not found in Tally"); }
    Store.saveEntry(cid, e);
  });
  if (S.billPost && S.billPost.done && n){ S.billPost.ok = (S.billPost.ok || 0) + n; S.billPost.unverified = Math.max(0, (S.billPost.unverified || 0) - n); S.billPost.failed = (S.billPost.failed || []).filter(f => !(f.unread && d.entries[f.id] && d.entries[f.id].exportedAt)); }
  refreshStats(cid); render();
}
// Set the company's voucher types in Tally to number vouchers automatically, so a repeated number can never stop a posting
const AUTO_TYPES = ["Purchase", "Journal", "Payment", "Receipt", "Contra", "Sales", "Debit Note", "Credit Note"];
async function setAutoNumbering(){
  const co = CO();
  const tname = await ensureTallyCompany(co);
  if (!tname) return;
  const ok = await askConfirm({title: "Set automatic voucher numbering in Tally?", ok: "Set it in Tally",
    body: '<p>In <b>' + esc(tname) + '</b>, these voucher types will number their vouchers automatically: ' + AUTO_TYPES.join(", ") + ".</p>" +
      '<p class="note">This changes the company in Tally for everyone who uses it. Vouchers already in Tally keep their numbers. Take a Tally backup first if you are unsure.</p>'});
  if (!ok) return;
  toast("Setting automatic numbering in " + tname + "\u2026");
  const xml = t => '<VOUCHERTYPE NAME="' + xesc(t) + '" ACTION="Alter">\n<NAME>' + xesc(t) + "</NAME>\n<NUMBERINGMETHOD>Automatic</NUMBERINGMETHOD>\n<PREVENTDUPLICATES>No</PREVENTDUPLICATES>\n</VOUCHERTYPE>\n";
  try {
    const j = await Bridge.post({company: tname, masters: AUTO_TYPES.map(t => ({id: "vt:" + t, xml: xml(t)})), vouchers: []});
    const res = [].concat(j.results || []);
    const done = res.filter(x => x.ok).map(x => x.id.slice(3)), bad = res.filter(x => !x.ok);
    if (done.length){
      co.vchNumbering = "tally"; co.vchAutoAt = new Date().toISOString(); Store.saveCompany(co);
      logPosting && logPosting({what: "setting", id: "vchauto", action: "automatic numbering", co: co.id, ref: done.join(", "), party: tname, amount: 0, tally: {company: tname}});
    }
    if (!done.length && bad.some(x => /Only VOUCHER, LEDGER or GROUP/.test(x.message || ""))){
      await askConfirm({title: "FinCom Bridge on the Tally computer needs updating", ok: "Got it", body:
        '<p>This needs FinCom Bridge 2.1. Install FinCom Bridge from the Tally page and run it on the computer where Tally runs.</p>' +
        '<p><b>Or set it in Tally yourself</b>, for each voucher type (Purchase, Journal, Payment, Receipt, Contra, Sales, Debit Note, Credit Note):</p>' +
        '<ol><li>Gateway of Tally \u2192 <b>Alter</b> \u2192 <b>Voucher Type</b>, and choose the type.</li><li>Set <b>Method of voucher numbering</b> to <b>Automatic</b>.</li><li>Press Ctrl + A to save.</li></ol>' +
        '<p class="note">Then come back here and press \u201cUse Tally\u2019s automatic numbers\u201d.</p>'});
      render(); return;
    }
    toast(done.length ? "Automatic numbering set in " + tname + " for " + done.join(", ") + "." + (bad.length ? " Not changed: " + bad.map(x => x.id.slice(3) + " (" + plainMsg(x.message) + ")").join(", ") + "." : "")
      : "Tally did not change the voucher types: " + (bad.map(x => plainMsg(x.message)).join("; ") || "no reply") + ".");
  } catch (e){ toast("Could not reach Tally: " + e.message); }
  render();
}
/* ---------- settings ---------- */
// the Tally Bridge settings (app/src/screens/Tally.jsx): an address, key or following typed; a Tally company linked to a
// client; one Tally chosen (a port) or back to automatic
function bridgeSet(k, v){ Bridge.setCfg({[k]: typeof v === "string" ? v.trim() : v}); if (k !== "follow"){ Bridge.lastOpenKey = null; startBridgePolling(); } render(); }
function bridgeLink(name, cid){ const c = S.companies[cid]; if (c){ c.tallyName = name; Store.saveCompany(c); Bridge.lastOpenKey = null; toast(c.name + " is linked to the Tally company " + c.tallyName + "."); bridgeTick(false); render(); } }
function bridgePin(port){
  port = num(port); Bridge.setCfg({port: port || 0}); Bridge.lastOpenKey = null;
  if (S.bank){ S.bank.syncedAt = {}; S.bank.ledgers.importedAt = ""; }
  Bridge.refresh().then(() => { toast(port ? "FinCom now uses only the Tally on port " + port + "." : "FinCom picks your Tally automatically."); bridgeTick(false); render(); });
}
async function saveBridgeSetup(){
  let t = null;
  try { t = await blockText(BRIDGE_SETUP_ID); } catch (e){ t = null; }
  if (!t || !t.trim()){ toast("This copy of the app does not carry the setup file. Install FinCom Bridge from the Tally page."); return; }
  const raw = atob(t.trim());
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  saveFile("Setup-FinCom-Bridge.bat", new Blob([bytes], {type: "application/octet-stream"}));
  // its fingerprint, to compare with the one published in the FinCom repository (assets/bridge-setup.sha256)
  try { const h = await crypto.subtle.digest("SHA-256", bytes); S.bridgeSha = Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, "0")).join(""); } catch (e){ S.bridgeSha = ""; }
  toast("Saved. Run it on the computer where Tally runs; FinCom Bridge then shows its icon near the clock.");
  render();
}
// A day book exported from Tally and chosen in FinCom also becomes the bridge's copy of the company (1.13.7): sent in
// pieces of a few megabytes, month by month within the dates chosen (empty days are sent as empty, so the copy knows
// them). Parts can come one period at a time, in any order. Nothing here asks Tally anything
const BridgeSeed = {
  ymd(t){ return t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0"); },
  add(d, n){ return this.ymd(new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + n)); },
  company(){ const co = CO(); return (Bridge.openFor(co) || {}).name || co.tallyName || co.name; },
  async post(path, body, type){
    const c = Bridge.cfg();
    const r = await fetch(c.url.replace(/\/+$/, "") + path + Bridge.pinQ(), {method: "POST", headers: {"X-Bridge-Key": c.key, "Content-Type": type}, body, cache: "no-store"});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || ("The bridge answered with error " + r.status));
    return j;
  },
  // the pieces: month by month from the first date to the last, whole days, about 8 MB at most
  pieces(text, range){
    const re = /<VOUCHER\b[\s\S]*?<\/VOUCHER>/g, days = new Map();
    let m;
    while ((m = re.exec(text))){ const d = (m[0].match(/<DATE>(\d{8})<\/DATE>/) || [])[1]; if (!d || (range.from && d < range.from) || (range.to && d > range.to)) continue; if (!days.has(d)) days.set(d, []); days.get(d).push(m[0]); }
    const all = Array.from(days.keys()).sort();
    const from = range.from || all[0], to = range.to || all[all.length - 1];
    if (!from || !to) return [];
    const out = [], LIMIT = 8e6;
    let ym = from.slice(0, 6);
    while (ym <= to.slice(0, 6)){
      const mEnd = this.ymd(new Date(+ym.slice(0, 4), +ym.slice(4, 6), 0)), a = from > ym + "01" ? from : ym + "01", z = to < mEnd ? to : mEnd;
      let start = a, buf = [], size = 0;
      for (let d = a; d <= z; d = this.add(d, 1)){
        const part = (days.get(d) || []).map(v => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("");
        buf.push(part); size += part.length;
        if (d === z || size >= LIMIT){ out.push({from: start, to: d, body: "<ENVELOPE><BODY><DATA>" + buf.join("") + "</DATA></BODY></ENVELOPE>", n: (buf.join("").match(/<VOUCHER\b/g) || []).length}); start = this.add(d, 1); buf = []; size = 0; }
      }
      ym = this.add(mEnd, 1).slice(0, 6);
    }
    return out;
  },
  async send(file, onStep, range, name0){
    if (!Bridge.on()) return {skipped: "FinCom Bridge is not connected"};
    const name = name0 || this.company();
    if (!name) return {skipped: "no Tally company name"};
    const pieces = this.pieces(await file.text(), range || {});
    if (!pieces.length) return {skipped: "no entries in the file for those dates"};
    let n = 0;
    for (let i = 0; i < pieces.length; i++){
      const x = pieces[i];
      if (onStep) onStep("Giving the day book to the bridge’s copy (" + (i + 1) + " of " + pieces.length + "); Tally is not asked anything…");
      const j = await this.post("/seed?company=" + encodeURIComponent(name) + "&from=" + x.from + "&to=" + x.to, x.body, "text/plain; charset=utf-8");
      if (j.skipped) return {skipped: j.skipped};
      n += num(j.entries);
    }
    return {entries: n, from: pieces[0].from, to: pieces[pieces.length - 1].to};
  },
  // opening balances from a trial balance file, for the bridge's copy
  async opening(asOn, led){
    if (!Bridge.on()) return {skipped: "FinCom Bridge is not connected"};
    return this.post("/seedbal?company=" + encodeURIComponent(this.company()), JSON.stringify({openAsOn: asOn, ledgers: Object.entries(led).map(([name, x]) => ({name, parent: x.parent || "", open: String(x.open)}))}), "application/json");
  }
};
// A trial balance exported from Tally (Display > Trial Balance, ledgers shown, Ctrl+E > XML): each ledger's closing
// balance on that day, which is the opening balance of the next. Debit is kept as Tally keeps it (negative)
const TBFile = {
  GROUPS: /^(capital account|reserves & surplus|loans \(liability\)|secured loans|unsecured loans|bank od a\/c|bank occ a\/c|current liabilities|duties & taxes|provisions|sundry creditors|fixed assets|investments|current assets|bank accounts|cash-in-hand|deposits \(asset\)|loans & advances \(asset\)|stock-in-hand|sundry debtors|branch \/ divisions|misc\. expenses \(asset\)|suspense a\/c|sales accounts|purchase accounts|direct incomes|direct expenses|indirect incomes|indirect expenses|grand total|total|opening stock|closing stock|difference in opening balances)$/i,
  read(text, b){
    // a ledger's name as every reader takes it (server/_shared/names.js): "MCS Project Pvt Ltd&amp;#13;&amp;#10;" in a
    // trial balance is the master "MCS Project Pvt Ltd", not a twin of it (migration-9)
    const unesc = t => namesClean(t);
    const groups = new Set(Object.keys((b && b.groups) || {}).map(g => g.toLowerCase()));
    const known = new Set(Object.keys(Object.assign({}, (b && b.map) || {}, (b && b.under) || {}, (b && b.ledInfo) || {})));
    const names = [], re = /<DSPACCNAME>[\s\S]*?<DSPDISPNAME>([\s\S]*?)<\/DSPDISPNAME>[\s\S]*?<\/DSPACCNAME>\s*<DSPACCINFO>([\s\S]*?)<\/DSPACCINFO>/g;
    const amt = (s, tag) => { const m = s.match(new RegExp("<" + tag + ">\\s*([-0-9.,]*)\\s*</" + tag + ">")); return m && m[1] ? Math.abs(num(m[1].replace(/,/g, ""))) : 0; };
    let m, groupsSeen = 0;
    while ((m = re.exec(text))){
      const name = unesc(m[1]);
      if (!name) continue;
      if (!known.has(name) && (this.GROUPS.test(name) || groups.has(name.toLowerCase()))){ groupsSeen++; continue; }
      const dr = amt(m[2], "DSPCLDRAMTA"), cr = amt(m[2], "DSPCLCRAMTA");
      names.push({name, open: r2(cr - dr)});
    }
    return {rows: names, groupsSeen};
  },
  // build 195: a trial balance whose ledgers are mostly unknown here is another company's: refused (with why). Only
  // when this client's ledgers are known (from the day book or the masters)
  foreign(r, b){
    const known = new Set(Object.keys(Object.assign({}, (b && b.map) || {}, (b && b.under) || {}, (b && b.ledInfo) || {})));
    if (known.size < 10 || r.rows.length < 10) return "";
    const hit = r.rows.filter(x => known.has(x.name)).length;
    return hit / r.rows.length < 0.5 ? "Only " + hit + " of its " + r.rows.length + " ledgers are in this client\u2019s books. Export the trial balance of this client\u2019s company in Tally." : "";
  }
};
// build 195: the books against Tally's own trial balance on a date: each ledger's opening plus the entries brought in
// must equal Tally's closing balance. Every ledger agrees: Ready. Otherwise the ledgers that differ, largest first
const TBCheck = {
  run(b, rows, on, file){
    const tb = b.tb || {}, led = tb.led || {}, m = b.meta || {};
    const base = { at: new Date().toISOString(), on, file };
    if (!tb.from || !Object.keys(led).length) return Object.assign(base, {ok: false, n: 0, list: [], why: "Bring in the opening balances (step 2) first; the check needs them."});
    if (on < tb.from || on > String(m.to || "")) return Object.assign(base, {ok: false, n: 0, list: [], why: "The trial balance is as on " + fmtDate(tallyDate(on)) + ", outside the books here (" + fmtDate(tallyDate(tb.from)) + " to " + fmtDate(tallyDate(m.to)) + ")."});
    const mv = MIS.moves(tb.from, on), inFile = {}, all = new Set();
    rows.forEach(x => { inFile[x.name] = r2(num(x.open)); all.add(x.name); });
    Object.keys(led).forEach(l => all.add(l)); Object.keys(mv).forEach(l => all.add(l));
    const list = [];
    all.forEach(l => {
      const books = r2(num((led[l] || {}).open) + ((mv[l] || {}).t || 0)), tally = inFile[l] || 0;
      if (Math.abs(books - tally) >= 1) list.push([l, tally, books, r2(books - tally)]);
    });
    list.sort((a, c) => Math.abs(c[3]) - Math.abs(a[3]));
    return Object.assign(base, {ok: !list.length, n: list.length, list: list.slice(0, 200), ledgers: all.size});
  }
};
// the one Tally company a client may post to (co.postTo, Client setup → Tally; review of 02-Oct-2026: Testing AAD's bill
// FA/ELEC/013 went into GARG SHEKHAR & COMPANY): "" when this company is allowed, else what to do
function postToProblem(co, company){
  if (!co) return "";
  // posting uses the confirmed choice only (src/js/60): a company found by FinCom (postToBy "auto") is confirmed first
  const ch = typeof choiceGet === "function" ? choiceGet(co, "postTo") : {value: co.postTo, state: "confirmed"};
  const to = String((ch && ch.value) || "").trim(), nm = x => ledNm(x).toLowerCase();
  if (!to) return "Choose the Tally company " + co.name + " may post to (Client setup \u2192 Tally). Nothing was posted.";
  if (ch.state !== "confirmed") return "Confirm the Tally company " + co.name + " posts to: " + to + " was found by FinCom and is not confirmed yet (Client setup \u2192 Tally). Nothing was posted.";
  if (company && nm(to) !== nm(company)) return co.name + " may post only to " + to + ", but " + company + " was about to receive it. Nothing was posted.";
  return "";
}
