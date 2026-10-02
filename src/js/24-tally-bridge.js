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
  async call(path, body, ms){
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
      throw {code: "bridge_down", message: e && e.name === "AbortError" ? "FinCom Bridge did not answer in time. Check the FinCom Bridge icon near the clock (right-click \u2192 Test connection)." : "FinCom Bridge is not running on this computer (" + c.url + "). Check the FinCom Bridge icon near the clock (right-click \u2192 Test connection)."};
    } finally { clearTimeout(timer); }
    let j = null;
    try { j = await r.json(); } catch (e){ j = null; }
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
        beat: j.beat || null};
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
    if (notAllowed) return {ok: true, company: payload.company, notAllowed: true, results: [].concat(payload.masters || [], payload.vouchers || []).map(x => ({id: x.id, ok: false, message: notAllowed})).concat(refused)};
    if (coP && typeof tallyVia === "function" && tallyVia(coP) === "cloud"){
      const outC = await CloudPost.run(coP.id, payload, onProgress, onChecked);
      outC.results = [].concat(outC.results || []).concat(refused);
      return outC;
    }
    const out = await this.postChecked(payload, onProgress, onChecked);
    out.results = [].concat(out.results || []).concat(refused);
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
    const base = c.url.replace(/\/+$/, "");
    const r = await fetch(base + "/pair?code=" + encodeURIComponent(String(code || "").trim()), {cache: "no-store"}).catch(() => null);
    if (!r) throw {code: "bridge_down", message: "FinCom Bridge is not running on this computer yet. Install FinCom Bridge from the Tally page."};
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) throw {code: "pair", message: (j && j.error) || "The bridge would not hand over its key."};
    this.setCfg({key: j.key, url: base});
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
  if (busyAt || st.tallyState === "busy") return '<span class="tchip warn" title="Tally is open but answering slowly' + (busyAt ? " since " + esc(String(busyAt).slice(11, 16)) : "") + '. A message box (a pop-up) in Tally, or a report still working, holds it up: close it, and FinCom carries on by itself. Nothing is lost meanwhile.">\u25D0 Tally busy' + (busyAt ? " since " + esc(String(busyAt).slice(11, 16)) : "") + "</span>";
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
// Bank and Sales take the client's ledgers from FinCom's cloud copy when the Tally computer is not here (review of
// 02-Oct-2026: they asked for the ledger list to be imported although the cloud copy had all 1,110 ledgers)
async function ensureCloudLedgers(cid){
  const b = B(), co = CO(cid);
  if (!b || b.cid !== cid || !co || bridgeLive(co) || typeof TCloud !== "object" || !TCloud.on()) return false;
  try { await TCloud.status(cid); } catch (e){ return false; }
  if (tallyVia(co) !== "cloud") return false;
  const age = Date.now() - new Date((b.ledgers || {}).importedAt || 0).getTime();
  if ((b.ledgers.list || []).length && b.ledgers.live && age < 6 * 3600000) return true;
  b.ledgersLoading = true; render();
  try { await syncLedgersFromTally(true); } finally { b.ledgersLoading = false; render(); }
  return true;
}
async function syncLedgersFromTally(silent){
  const b = B(), co = CO(b.cid);
  if (!tallyVia(co)) return false;
  try {
    const j = await tallyCall(co, "/ledgers?company=" + encodeURIComponent(tallyCoName(co)) + Bridge.pinQ());
    const list = [].concat(j.ledgers || []).filter(l => l && l.name).map(l => ({name: l.name, group: l.group || "", pan: l.pan || "", gstin: l.gstin || "", acNo: l.acNo || "", ifsc: l.ifsc || "", taxType: l.taxType || "", tdsNature: l.tdsNature || "", dutyHead: l.dutyHead || ""}));
    const groups = Array.from(new Set([].concat(j.groups || []).map(g => g.name).concat(list.map(l => l.group)).filter(Boolean))).sort();
    b.ledgers = {list, groups, importedAt: new Date().toISOString(), file: j.via === "cloud" ? "Tally, from the copy in FinCom's cloud" : "Tally (live)", live: true};
    const have = new Set(list.map(l => l.name.toLowerCase()));
    b.newLed = b.newLed.filter(n => !have.has(n.name.toLowerCase()));
    saveBank({ledgers: true, newLed: true});
    b.rows.forEach(r => { if (["ready", "suggested"].includes(r.state) && r.ledger && !exactLedger(r.ledger)){ r.userSet = false; r.state = "attention"; } });
    // bank accounts: link to their Tally ledger when it is clear
    (co.bankAccounts || []).forEach(a => { if (!exactLedger(a.ledger)){ const g = guessBankLedger(a); if (g){ a.ledger = g; Store.saveCompany(co); } } });
    suggestAll(b.rows, true); saveBank({rows: true});
    const mapped = autoMapCompanyLedgers(co);
    if (!silent) toast(list.length + " ledgers loaded from Tally" + (mapped.length ? "; " + mapped.length + " default ledger names matched to Tally" : "") + ".");
    return true;
  } catch (e){ if (!silent) toast("Could not load ledgers from Tally: " + e.message); return false; }
}
function guessBankLedger(a){
  const b = B();
  const bankLeds = (b.ledgers.list || []).filter(l => BANK_GROUPS.test(l.group || ""));
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
    // build 190: by itself only when there is no ledger list at all; a fresh read of Tally's ledgers when someone asks
    const stale = !(b.ledgers.list || []).length;
    if (force || stale) await syncLedgersFromTally(true);
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
  b.rows.forEach(r => { if (ids.includes(r.id) && ["sent", "intally"].includes(r.state)){ if (b.postedTags) delete b.postedTags[fpHash(r.fp || r.id)]; r.state = "ready"; r.tally = null; r.postVerified = false; r.checking = false; r.tallyHow = ""; r.tallyRef = ""; delete r.tallyIdx; } });
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
    b.rows.forEach(r => { if (ids.includes(r.id)){ if (b.postedTags) delete b.postedTags[fpHash(r.fp || r.id)]; r.state = r.ledger && exactLedger(r.ledger) ? "ready" : "attention"; r.tally = null; r.postVerified = false; r.tallyHow = ""; r.tallyRef = ""; delete r.tallyIdx; } });
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
    r.tally = null; r.postVerified = false; r.checking = false; r.postError = ""; r.postedVia = ""; r.sentAt = ""; delete r.tallyIdx; r.tallyHow = ""; r.tallyRef = "";
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
  if (S.dupFind && !S.dupFind.extra.length && !S.dupFind.wrongDate.length) lsSet(wideCheckKey(), String(Date.now()));
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
    if (x && x.ok && x.verified === true){
      confirmed++; r.postVerified = true;
      r.tally = Object.assign({}, r.tally || {}, {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", number: x.vchNumber || ""});
    } else if (x && !x.ok){
      // Tally said it made it, but it is not there: not counted as posted, and not sent again without a look
      r.state = "ready"; r.postVerified = false;
      r.postError = "Tally replied 'created', but the entry cannot be found in Tally afterwards, so it is NOT marked as posted. Look in Tally before posting it again.";
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

/* ---------- the bank ledger's balance in Tally on a date ---------- */
// Some Tally setups give a ledger's closing balance for their whole current period whatever date is asked, so an entry
// dated after the statement (say 31-03-2027) would be counted. So the balance on the statement's last day is checked:
// read on that day and far later, and compared with the entries in between. If Tally kept to the date, its figure is
// used; if not, the balance is worked back from its latest figure less the later entries.
async function tallyBankBalance(tname, ledger, to){
  const one = bridgeVer(Bridge.st.version) >= bridgeVer("1.12.3");
  const bankBal = v => r2(-(parseFloat(String(v == null || v === "" ? "0" : v).replace(/,/g, "")) || 0));
  const far = addDays(to, 800), next = addDays(to, 1);
  const j = await Bridge.call((one ? "/ledgerbalance" : "/balances") + "?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(next) + "&to=" + isoToTally(far) + (one ? "&ledger=" + encodeURIComponent(ledger) : "") + Bridge.pinQ(), null, 180000);
  const L = one ? {open: j.open, close: j.close} : [].concat(j.ledgers || []).find(l => norm(l.name) === norm(ledger));
  if (!L) throw {message: "\u201c" + ledger + "\u201d is not among Tally's ledgers in " + tname + "."};
  const atTo = bankBal(L.open), atFar = bankBal(L.close);
  const lv = await Bridge.call(ledgerLinesUrl(tname, ledger, next, far), null, 600000);
  let later = 0, laterN = 0;
  [].concat(lv.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || "")).forEach(v => {
    const d = tallyToIso(v.date); if (d <= to || d > far) return;
    const be = [].concat(v.entries || []).find(e => norm(e.ledger) === norm(ledger)); if (!be) return;
    later += -(parseFloat(String(be.amount).replace(/,/g, "")) || 0); laterN++;
  });
  later = r2(later);
  if (Math.abs(atFar - (atTo + later)) < 0.01) return {close: atTo, how: "tally", later, laterN};
  return {close: r2(atFar - later), how: "worked back", later, laterN};
}

/* ---------- does Tally agree with the bank? ---------- */
// Tally's balance of the bank ledger at the start and end of the statement, against the statement's own opening and closing.
// When they differ, the difference is taken apart: the opening, the statement lines not in Tally yet, the lines left out,
// and the entries in Tally for these dates that are not on the statement. Whatever is left is shown as unexplained.
function bankEffect(r){ return r2(num(r.credit) - num(r.debit)); }
async function checkBankBalance(opts){
  opts = opts || {};
  const b = B(), co = CO(b.cid), st = curStmt();
  if (!st) return null;
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  const ledger = acc && exactLedger(acc.ledger);
  if (!ledger){ if (!opts.quiet) toast("Choose the Tally ledger for this bank account first."); return null; }
  const tname = opts.tname || await ensureTallyCompany(co);
  if (!tname) return null;
  const sid = st.id;
  b.balBusy = true; if (!opts.quiet){ b.busy = "Reading " + ledger + "'s balance from Tally…"; } render();
  let res;
  try {
    const tb = await tallyBankBalance(tname, ledger, st.to);
    const all = b.rows.reduce((a, r) => a + bankEffect(r), 0);
    const sOpen = st.opening !== undefined && st.opening !== null && st.opening !== "" ? r2(num(st.opening)) : (st.closing !== undefined ? r2(num(st.closing) - all) : null);
    const sClose = st.closing !== undefined && st.closing !== null && st.closing !== "" ? r2(num(st.closing)) : (sOpen !== null ? r2(sOpen + all) : null);
    res = {at: Date.now(), ledger, company: tname, from: st.from, to: st.to, openAsOn: addDays(st.from, -1), tOpen: null, tClose: tb.close, how: tb.how, later: tb.laterN, sOpen, sClose};
    res.diffOpen = sOpen === null || res.tOpen === null ? null : r2(sOpen - res.tOpen);
    res.diff = sClose === null ? null : r2(sClose - res.tClose);
    const notIn = b.rows.filter(r => !["sent", "intally", "ignored"].includes(r.state));
    const left = b.rows.filter(r => r.state === "ignored");
    res.notIn = notIn.map(r => r.id); res.notInEffect = r2(notIn.reduce((a, r) => a + bankEffect(r), 0));
    res.left = left.map(r => r.id); res.leftEffect = r2(left.reduce((a, r) => a + bankEffect(r), 0));
    res.extra = null;
    if (res.diff !== null && Math.abs(res.diff) >= 0.01 && opts.explain){
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
    }
  } catch (e){ res = {at: Date.now(), error: e.message || String(e)}; }
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
  if (Bridge.st.allowImport === false){ toast("Posting is switched off in the bridge settings (AllowImport)."); return; }
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  const heavy = b.checkBeforePost === true;
  b.busy = heavy ? "Loading ledgers and this bank ledger from Tally\u2026" : "Checking the ledgers\u2026"; render();
  const readyBefore = new Set(b.rows.filter(r => r.state === "ready").map(r => r.id));
  const inTallyBefore = b.rows.filter(r => r.state === "intally").length;
  const ledgerAge = Date.now() - new Date((b.ledgers || {}).importedAt || 0).getTime();
  if (!b.ledgers.live || ledgerAge > 60 * 60000) await syncLedgersFromTally(true);
  if (!acc || !exactLedger(acc.ledger)){ b.busy = ""; toast("Choose the Tally ledger for this bank account first (the set-up line at the top)."); render(); return; }
  acc.ledger = exactLedger(acc.ledger);
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
      vouchers: rows.map(r => ({id: r.id, xml: bankVoucherXml(r, acc, co)}))}, pj => { b.busy = postingLine(pj, tname); refreshBusy(); },
      chk => bankAfterCheck(b.cid, st.id, chk, tname));
    const byId = new Map([].concat(j.results || []).map(x => [x.id, x]));
    const now = new Date().toISOString();
    masters.forEach(l => { const x = byId.get("led:" + l.name); if (x && x.ok){ l.sent = true; l.sentAt = now; } else if (x) failed.push({what: "New ledger " + l.name, msg: x.message}); });
    let ok = 0, optionalN = 0;
    const posted = [];
    rows.forEach(r => {
      const x = byId.get(r.id);
      if (x && x.ok && x.verified !== true && !x.pendingCheck){
        b.postedTags = b.postedTags || {}; b.postedTags[fpHash(r.fp || r.id)] = "unconfirmed:" + now;
        r.postError = "Tally replied 'created', but FinCom could not find the entry in Tally afterwards, so it is NOT marked as posted. Look in Tally (Day Book, and Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers). If it is not there, post it again." + (x.verifyNote ? " [" + x.verifyNote + "]" : "");
        failed.push({id: r.id, what: fmtDate(r.date) + " " + (r.dec.name || "") + " " + INR.format(r.debit || r.credit), msg: "not confirmed in Tally \u2014 check Tally before posting again"});
      } else if (x && x.ok){
        ok++; r.state = "sent"; r.sentAt = now; r.postedVia = "bridge"; r.postError = ""; r.postedOptional = !!x.optional; r.postVerified = x.verified === true; r.checking = !!x.pendingCheck; posted.push(r);
        b.postedTags = b.postedTags || {}; b.postedTags[fpHash(r.fp || r.id)] = now;
        logPosting({what: "bank", id: r.id, action: "posted", co: b.cid, ref: r.narr.slice(0, 40), party: r.ledger, amount: num(r.debit || r.credit), tally: {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", company: tname}, by: (Cloud.st && Cloud.st.email) || ""});
        r.tally = {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", at: now, by: (Cloud.st && Cloud.st.email) || "", company: tname};
        if (x.optional) optionalN++;
        if (r.billId && D(b.cid).entries[r.billId]){ const e = D(b.cid).entries[r.billId]; e.paidBy = r.id; Store.saveEntry(b.cid, e); }
        markSalesReceived(r);
      } else {
        r.postError = plainMsg(x && x.message) || "Tally did not confirm this entry.";
        failed.push({id: r.id, what: fmtDate(r.date) + " " + (r.dec.name || "") + " " + INR.format(r.debit || r.credit), msg: r.postError});
      }
    });
    learnRows(posted, "sent");
    saveBank({rows: true, newLed: true, posted: true});
    b.postReport = {at: Date.now(), posted: ok, skipped, movedBack, failed, dismiss: "bankReportOk", company: tname, optional: optionalN, noPreCheck: !heavy, checking: !!j.checking};
    toast(ok + " posted to Tally" + (skipped ? ", " + skipped + " were already there" : "") + (failed.length ? ", " + failed.length + " not posted" : "") + ".");
    if (!failed.length && !b.rows.some(r => r.state === "ready")) b.filter = "done";
    b.afterPost = !j.checking && !j.viaCloud;
    b.tallyLook = null;          // Tally has changed: the next posting looks again
  } catch (e){ toast("Posting failed: " + e.message); b.postReport = {at: Date.now(), posted: 0, skipped, movedBack, failed: failed.concat([{what: "Posting", msg: e.message}]), dismiss: "bankReportOk"}; }
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
async function postBillsToTally(){
  const co = CO();
  const tname = await ensureTallyCompany(co);
  if (!tname) return;
  if (!S.bank || S.bank.cid !== co.id) await loadBank(co.id);
  S.billPost = {busy: "Loading ledgers from Tally\u2026"}; render();
  await syncLedgersFromTally(true);
  autoMapCompanyLedgers(co);
  let list = Object.values(D().entries).filter(e => e.status === "approved" && !e.exportedAt).sort(byDate);
  if (!list.length){ S.billPost = null; toast("No approved entries are waiting."); render(); return; }
  canonicalizeBills(list);
  const failed = [];
  const blocked = list.filter(e => e.snapshot.lines.some(l => !exactLedger(l.ledger)));
  blocked.forEach(e => { const l = e.snapshot.lines.find(x => !exactLedger(x.ledger)); e.postError = "Ledger \u201c" + (l.ledger || "(none)") + "\u201d is not in Tally"; unapply(e, co.id); e.postFailedAt = new Date().toISOString(); Store.saveEntry(co.id, e); failed.push({id: e.id, no: e.x.invoiceNo, party: e.x.vendorName, msg: e.postError}); });
  let todo = list.filter(e => !blocked.includes(e));
  S.billPost = {busy: "Checking Tally for bills already booked\u2026"}; render();
  try {
    const dates = todo.map(e => e.x.invoiceDate).filter(Boolean).sort();
    const now = new Date().toISOString();
    let dup = [];
    if (dates.length){
      const vt = co.voucherType || "Journal";
      const j0 = await tallyCall(co, "/vouchers?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(addDays(dates[0], -5)) + "&to=" + isoToTally(addDays(dates[dates.length - 1], 5)) + "&types=" + encodeURIComponent([vt, "Purchase", "Journal"].join(",")) + Bridge.pinQ());
      const vs0 = [].concat(j0.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || ""));
      const seen = new Set(vs0.map(v => norm(v.reference) + "|" + norm(v.party)).concat(vs0.flatMap(v => [].concat(v.entries || []).flatMap(en => [].concat(en.bills || []).map(bl => norm(bl.name) + "|" + norm(en.ledger))))));
      const marks = vs0.map(v => String(v.narration || "")).join("\n");
      dup = todo.filter(e => seen.has(norm(e.x.invoiceNo) + "|" + norm(e.partyLedger)) || marks.includes("TDSDesk:" + e.id));
      dup.forEach(e => { e.exportedAt = now; e.postNote = "Already in Tally"; Store.saveEntry(co.id, e); });
      todo = todo.filter(e => !dup.includes(e));
    }
    let ok = 0, optionalN = 0, unverified = 0;
    if (todo.length){
      const used = new Set(todo.flatMap(e => e.snapshot.lines.map(l => String(l.ledger).toLowerCase())));
      const masters = B().newLed.filter(l => !l.sent && used.has(l.name.toLowerCase()));
      S.billPost = {busy: "Posting " + entries(todo.length) + " to " + tname + "\u2026"}; render();
      const j = await Bridge.post({company: tname, client: co.id, masters: masters.map(l => ({id: "led:" + l.name, xml: ledgerMasterXml(l)})), vouchers: todo.map(e => ({id: e.id, xml: voucherXml(e, co)}))}, pj => { S.billPost = {busy: postingLine(pj, tname)}; refreshBusy(); });
      const byId = new Map([].concat(j.results || []).map(x => [x.id, x]));
      masters.forEach(l => { const x = byId.get("led:" + l.name); if (x && x.ok){ l.sent = true; l.sentAt = now; } });
      saveBank({newLed: true});
      // a voucher number another supplier already used: try once more with this supplier's initials added
      const clash = todo.filter(e => { const x = byId.get(e.id); return x && !x.ok && /already\s+exists/i.test(x.message || "") && co.vchNumbering !== "tally"; });
      if (clash.length){
        clash.forEach(e => { e.vchNo = (e.x.invoiceNo || "B") + "/" + initialsOf(e.x.vendorName || e.partyLedger); });
        S.billPost = {busy: "Voucher numbers already used in Tally: trying " + clash.length + " again with the supplier\u2019s initials\u2026"}; render();
        try {
          const j2 = await Bridge.post({company: tname, client: co.id, masters: [], vouchers: clash.map(e => ({id: e.id, xml: voucherXml(e, co)}))});
          [].concat(j2.results || []).forEach(x => byId.set(x.id, x));
        } catch (err){ /* reported below as refused */ }
      }
      todo.forEach(e => {
        const x = byId.get(e.id);
        if (x && x.ok && x.verified === true){ ok++; logPosting({what: "bill", id: e.id, action: "posted", co: co.id, ref: e.x.invoiceNo, party: e.x.vendorName, amount: num(e.x.total), tally: {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", company: x.company || tname}, by: (Cloud.st && Cloud.st.email) || ""}); e.exportedAt = now; e.postError = ""; e.postUnconfirmed = null; e.postedVia = "bridge"; e.postedInto = x.company || tname; e.postedOptional = !!x.optional; e.postVerified = true; e.tallyVchNo = x.vchNumber || "";
          e.tally = {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", at: now, by: (Cloud.st && Cloud.st.email) || "", company: x.company || tname}; if (x.optional) optionalN++; }
        else if (x && x.ok){ unverified++; e.postUnconfirmed = {at: now, company: x.company || tname, optional: /Optional/.test(x.verifyNote || '')}; e.postError = (/Optional/.test(x.verifyNote || '') && x.message) ? plainMsg(x.message) : "Tally replied 'created', but FinCom could not find the entry in Tally afterwards, so it is NOT marked as posted. Look in Tally (Day Book, and Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers). If it is not there, post it again." + (x.verifyNote ? " [" + x.verifyNote + "]" : ""); failed.push({no: e.x.invoiceNo, party: e.x.vendorName, msg: "not confirmed in Tally"}); }
        else {
          e.postError = plainMsg(x && x.message) || "Tally did not confirm this entry.";
          failed.push({id: e.id, no: e.x.invoiceNo, party: e.x.vendorName, msg: e.postError});
          unapply(e, co.id); e.postFailedAt = now;                          // back to review, with Tally's reason on it
        }
        Store.saveEntry(co.id, e);
      });
    }
    S.billPost = {done: true, ok, bad: failed.length, dup: dup.length, failed, optional: optionalN, unverified, company: tname};
    toast(ok + " posted to " + tname + (optionalN ? " (" + optionalN + " as Optional vouchers)" : "") + (dup.length ? ", " + dup.length + " already there" : "") + (failed.length ? ", " + failed.length + " not posted" : "") + ".");
  } catch (e){ S.billPost = {error: e.message, failed}; toast("Posting failed: " + e.message); }
  refreshStats(co.id); render();
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
    const unesc = t => String(t || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
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
  const to = String(co.postTo || "").trim(), nm = x => ledNm(x).toLowerCase();
  if (!to) return "Choose the Tally company " + co.name + " may post to (Client setup \u2192 Tally). Nothing was posted.";
  if (company && nm(to) !== nm(company)) return co.name + " may post only to " + to + ", but " + company + " was about to receive it. Nothing was posted.";
  return "";
}
