/* ================================================================== */
/* Tally Bridge: live connection to TallyPrime on this computer        */
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
      throw {code: "bridge_down", message: e && e.name === "AbortError" ? "The Tally Bridge did not answer in time." : "The Tally Bridge is not running on this computer (" + c.url + ")."};
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
        stuck: j.tallyStuck || null, tallyUp: usable.length > 0, pinMissing: !!pin && !(j.sessions || []).some(s => s.port === pin && s.ok && !s.skipped)};
      if (!this.st.tallyUp || this.st.pinMissing){ if (!this.diag || Date.now() - this.diag.at > 30000) await this.diagnose(); }
      else this.diag = null;
      this.misses = 0;
    } catch (e){
      // one missed answer (or any while this tab is posting) is not a lost bridge: keep what was known and ask again soon
      this.misses = (this.misses || 0) + 1;
      const was = this.st && this.st.state === "ok" && Date.now() - (this.st.at || 0) < 5 * 60000;
      if (e.code !== "bridge_key" && was && (this.misses < 3 || this.posting)){
        this.st = Object.assign({}, this.st, {shaky: true, error: e.message});
        clearTimeout(this.again); this.again = setTimeout(() => { if (typeof bridgeTick === "function") bridgeTick(false); }, 8000);
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
  // ask the bridge on this computer for its key, with the 6-digit code shown in the bridge window
  // (bridge 1.11: only for a few minutes after it starts, once, and never for another web page)
  async pair(code){
    const c = this.cfg();
    const base = c.url.replace(/\/+$/, "");
    const r = await fetch(base + "/pair?code=" + encodeURIComponent(String(code || "").trim()), {cache: "no-store"}).catch(() => null);
    if (!r) throw {code: "bridge_down", message: "No bridge is running on this computer yet. Install it with the button below."};
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
      toast("A new Tally Bridge (1.12.6) is ready: it reads bill references for the vendor reconciliation, deletes entries on more Tally setups, and posts fast, and it keeps posting even if this page or the connection drops. Download it under Settings \u2192 Tally Bridge and run the setup on the Tally computer.");
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
  if (st.state === "down") return '<button class="tchip off" data-act="openSettings" title="' + esc(st.error) + '">Tally Bridge offline \u2014 check</button>';
  if (st.state === "key") return '<span class="tchip bad" title="' + esc(st.error) + '">Tally Bridge: wrong key</span>';
  if (st.state !== "ok") return '<span class="tchip off">Tally Bridge\u2026</span>';
  const run = (st.jobs || []).find(j => ["queued", "waiting", "running"].includes(j.status));
  if (run) return '<span class="tchip ok" title="' + esc((run.company || "") + ": " + (run.message || "")) + '">\u25CF Posting to Tally: ' + num(run.done) + " of " + num(run.total) + "</span>";
  // build 194: Tally stopped answering (a message box open in Tally, or a long report): said plainly, with since when
  if (st.stuck && st.stuck.since) return '<span class="tchip bad" title="Tally has not answered since ' + esc(String(st.stuck.since).slice(11, 16)) + '. Look at the Tally computer: a message box (a pop-up) in Tally, or a report still working, stops Tally answering anyone. Close it, and FinCom carries on by itself.">\u26A0 Tally not responding since ' + esc(String(st.stuck.since).slice(11, 16)) + " \u2014 check for a pop-up in Tally</span>";
  if (st.shaky) return '<span class="tchip warn" title="' + esc(st.error || "") + '">Tally Bridge: checking again\u2026</span>';
  const why = Bridge.diag && (Bridge.diag.findings || []).find(f => f.level !== "ok");
  if (st.pinMissing) return '<button class="tchip warn" data-act="openSettings" title="' + esc(why ? why.text : "The Tally chosen in Settings is not running") + '">Your Tally is not connected \u2014 check</button>';
  if (!st.tallyUp) return '<button class="tchip warn" data-act="openSettings" title="' + esc(why ? why.text : "No TallyPrime is answering in your Windows session") + '">Tally not connected \u2014 check</button>';
  if (co){
    const o = Bridge.openFor(co);
    if (o) return '<span class="tchip ok" title="' + esc(o.name) + " is open in Tally (port " + o.port + ')">\u25CF Open in Tally</span>';
    if ((st.clash || []).some(n => norm(n) === norm(Bridge.tallyName(co)))) return '<span class="tchip bad" title="This company is open in more than one Tally. Choose yours in Settings \u2192 Tally Bridge.">Choose your Tally</span>';
    return '<span class="tchip warn" title="Open ' + esc(Bridge.tallyName(co)) + ' in TallyPrime to post and to load its ledgers">\u25CB Not open in Tally</span>';
  }
  if ((st.clash || []).length) return '<span class="tchip bad" title="' + esc(st.clash.join(", ")) + ' is open in more than one Tally. Choose yours in Settings \u2192 Tally Bridge.">Choose your Tally</span>';
  const n = st.open.length;
  return '<span class="tchip ok" title="' + esc(st.open.map(o => o.name).join(", ")) + '">\u25CF Tally: ' + (n === 1 ? esc(st.open[0].name) : n + " companies open") + "</span>";
}

/* ---------- ledgers and bank entries straight from Tally ---------- */
async function syncLedgersFromTally(silent){
  const b = B(), co = CO(b.cid);
  if (!bridgeLive(co)) return false;
  try {
    const j = await Bridge.call("/ledgers?company=" + encodeURIComponent(Bridge.openFor(co).name) + Bridge.pinQ());
    const list = [].concat(j.ledgers || []).filter(l => l && l.name).map(l => ({name: l.name, group: l.group || "", pan: l.pan || "", gstin: l.gstin || "", acNo: l.acNo || "", ifsc: l.ifsc || "", taxType: l.taxType || "", tdsNature: l.tdsNature || "", dutyHead: l.dutyHead || ""}));
    const groups = Array.from(new Set([].concat(j.groups || []).map(g => g.name).concat(list.map(l => l.group)).filter(Boolean))).sort();
    b.ledgers = {list, groups, importedAt: new Date().toISOString(), file: "Tally (live)", live: true};
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
  if (!st || !bridgeLive(co)) return 0;
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  const ledger = acc && exactLedger(acc.ledger);
  if (!ledger) return 0;
  try {
    const from = win ? win.from : addDays(st.from || b.rows[0].date, -20), to = win ? win.to : addDays(st.to || b.rows[b.rows.length - 1].date, 20);
    const j = win && win.pre ? win.pre : await Bridge.call(ledgerLinesUrl(Bridge.openFor(co).name, ledger, from, to), null, 300000);
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
function reconHtml(){
  const b = B(), st = curStmt(), R = S.recon;
  if (!R || !st || R.sid !== st.id) return "";
  const m = v => INR.format(Math.abs(v || 0));
  const rowById = new Map(b.rows.map(r => [r.id, r]));
  const live = Bridge.on() && Bridge.up();
  const balanced = R.unexplained !== null && Math.abs(R.sClose - R.tClose) < 0.01;
  let h = '<section class="recon"><div class="recon-head"><div><h3>Bank reconciliation · ' + esc(R.ledger) + "</h3>" +
    '<div class="note">' + esc(R.company) + " · " + fmtDate(R.from) + " to " + fmtDate(R.to) + " · " + R.pairs + " lines matched · read " + new Date(R.at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) + "</div></div>" +
    '<div class="row" style="gap:8px">' + '<button class="btn small" data-act="reconExcel">Download Excel</button>' + (live ? '<button class="btn small" data-act="reconRun">Reconcile again</button>' : "") + '<button class="btn small" data-act="reconClose">Close</button></div></div>';
  if (balanced && !R.missing.length && !R.extra.length && !R.differ.length){
    return h + '<div class="bk-bal ok"><div>✔ <b>Reconciled.</b> Every line of the statement is in Tally once, and nothing else is. ' + esc(R.ledger) + " in Tally on " + fmtDate(R.to) + " is " + m(R.tClose) + ", the same as the statement.</div></div></section>";
  }
  // the reconciliation statement
  const line = (label, v, sign, note) => '<tr><td>' + label + (note ? ' <span class="muted">' + note + "</span>" : "") + '</td><td class="n">' + (v ? (sign || "") + m(v) : "—") + "</td></tr>";
  const mIn = r2(R.missing.map(id => rowById.get(id)).filter(Boolean).reduce((a, r) => a + num(r.credit), 0)), mOut = r2(R.missing.map(id => rowById.get(id)).filter(Boolean).reduce((a, r) => a + num(r.debit), 0));
  const xIn = r2(R.extra.reduce((a, i) => a + Math.max(0, R.T[i].eff), 0)), xOut = r2(R.extra.reduce((a, i) => a + Math.max(0, -R.T[i].eff), 0));
  h += '<table class="data recon-stmt"><tbody>' +
    '<tr><td><b>Balance in Tally on ' + fmtDate(R.to) + '</b></td><td class="n"><b>' + (R.tClose < 0 ? "−" : "") + m(R.tClose) + "</b></td></tr>" +
    line("Add: deposits on the statement, not in Tally", mIn, "+ ") +
    line("Less: withdrawals on the statement, not in Tally", mOut, "− ") +
    line("Less: receipts in Tally, not on the statement", xIn, "− ") +
    line("Add: payments in Tally, not on the statement", xOut, "+ ") +
    (R.differ.length ? line("Amounts that differ (statement less Tally)", R.dEff, R.dEff >= 0 ? "+ " : "− ") : "") +
    (Math.abs(R.openDiff) >= 0.01 ? line("Opening balance difference", R.openDiff, R.openDiff >= 0 ? "+ " : "− ", "Tally on " + fmtDate(addDays(R.from, -1)) + " is " + m(R.tOpen) + "; the statement opens at " + m(R.sOpen) + ": entries before " + fmtDate(R.from) + " differ — reconcile the earlier statement") : "") +
    (R.unexplained !== null && Math.abs(R.unexplained) >= 0.01 ? line("Not explained by the lines below", R.unexplained, R.unexplained >= 0 ? "+ " : "− ") : "") +
    '<tr class="tot"><td><b>Balance as per the bank statement on ' + fmtDate(R.to) + '</b></td><td class="n"><b>' + (R.sClose === null ? "—" : (R.sClose < 0 ? "−" : "") + m(R.sClose)) + "</b></td></tr></tbody></table>";
  if ((R.deleteProblems || []).length) h += '<div class="bk-alert bad" style="margin-top:10px"><b>Tally did not delete ' + R.deleteProblems.length + " entr" + (R.deleteProblems.length === 1 ? "y" : "ies") + '.</b> What Tally said:<ul style="margin:6px 0 0">' + R.deleteProblems.slice(0, 20).map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" +
    '<div class="note">If Tally says the voucher cannot be found, it may already be gone: press Reconcile again. If a Tally security setting blocks deleting, delete these in Tally (Alt+D on the voucher).</div></div>';
  // A. on the statement, not in Tally
  if (R.missing.length){
    const rows = R.missing.map(id => rowById.get(id)).filter(Boolean);
    const canPost = rows.filter(r => ["ready", "sent", "intally"].includes(r.state) && r.ledger && exactLedger(r.ledger));
    const needLedger = rows.filter(r => !canPost.includes(r) && r.state !== "ignored"), left = rows.filter(r => r.state === "ignored");
    h += '<div class="recon-sec"><h4>On the statement, not in Tally <span class="cnt">' + rows.length + "</span></h4>" +
      '<div class="tblwrap"><table class="data"><thead><tr><th>Date</th><th>Particulars</th><th class="n">Withdrawal</th><th class="n">Deposit</th><th>Ledger</th><th>Why</th></tr></thead><tbody>' +
      rows.slice(0, 400).map(r => "<tr><td>" + fmtDate(r.date) + "</td><td>" + esc(r.dec.name || r.narr.slice(0, 50)) + '</td><td class="n">' + (r.debit ? m(r.debit) : "") + '</td><td class="n">' + (r.credit ? m(r.credit) : "") + "</td><td>" + esc(r.ledger || "—") + "</td><td>" +
        esc(r.state === "ignored" ? "left out" : ["sent", "intally"].includes(r.state) ? "marked as posted, but Tally does not have it" : r.state === "ready" ? "not posted yet" : "needs a ledger") + "</td></tr>").join("") + "</tbody></table></div>" +
      '<div class="row" style="gap:8px;margin-top:8px">' + (live && canPost.length ? '<button class="btn small primary" data-act="reconPost">Post ' + (canPost.length === 1 ? "it" : "these " + canPost.length) + " to Tally</button>" : "") +
      (needLedger.length ? '<span class="note">' + needLedger.length + " need a ledger first " + focusBtn("recon-need", "need a ledger before they can be posted", needLedger.map(r => r.id), "Show them") + "</span>" : "") +
      (left.length ? '<span class="note">' + left.length + " were left out on purpose " + focusBtn("recon-left", "left out, not posted", left.map(r => r.id), "Show them") + "</span>" : "") + "</div></div>";
  }
  // B. in Tally, not on the statement
  if (R.extra.length){
    const dup = new Map(R.dupOf);
    h += '<div class="recon-sec"><h4>In Tally, not on the statement <span class="cnt">' + R.extra.length + "</span></h4>" +
      '<p class="note" style="margin:0 0 6px">Tick the entries to delete from Tally. Copies and entries FinCom posted are ticked already; check entries typed in Tally before deleting them.</p>' +
      '<div class="tblwrap"><table class="data"><thead><tr><th></th><th>Date</th><th>Voucher</th><th>Party / ledger</th><th class="n">In</th><th class="n">Out</th><th>What it is</th></tr></thead><tbody>' +
      R.extra.map(i => { const t = R.T[i]; return '<tr><td><input type="checkbox" data-reconpick="' + i + '"' + (R.pick.has(i) ? " checked" : "") + (live ? "" : " disabled") + '></td><td>' + fmtDate(t.date) + "</td><td>" + esc([t.type, t.number].filter(Boolean).join(" ")) + "</td><td>" + esc(t.party) + '</td><td class="n">' + (t.eff > 0 ? m(t.eff) : "") + '</td><td class="n">' + (t.eff < 0 ? m(t.eff) : "") + "</td><td>" +
        esc(dup.has(i) ? "a second copy of " + fmtDate((rowById.get(dup.get(i)) || {}).date) + "'s line" : t.tag ? "posted by FinCom, from another statement or an old copy" : "typed in Tally") + (t.narr && !t.tag ? '<div class="muted" style="font-size:12px">' + esc(t.narr.slice(0, 80)) + "</div>" : "") + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      (live ? '<div class="row" style="gap:8px;margin-top:8px"><button class="btn small danger" data-act="reconDelete"' + (R.pick.size ? "" : " disabled") + ">Delete the " + R.pick.size + " ticked from Tally</button></div>" : "") + "</div>";
  }
  // C. the same line, a different amount
  if (R.differ.length){
    h += '<div class="recon-sec"><h4>Amount differs <span class="cnt">' + R.differ.length + "</span></h4>" +
      '<div class="tblwrap"><table class="data"><thead><tr><th>Date</th><th>Particulars</th><th class="n">Statement</th><th class="n">Tally</th><th>Tally voucher</th></tr></thead><tbody>' +
      R.differ.map(d => { const r = rowById.get(d.rowId), t = R.T[d.ti]; return "<tr><td>" + fmtDate(r.date) + "</td><td>" + esc(r.dec.name || r.narr.slice(0, 50)) + '</td><td class="n">' + m(bankEffect(r)) + '</td><td class="n">' + m(t.eff) + "</td><td>" + esc([t.type, t.number].filter(Boolean).join(" ")) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      (live ? '<div class="row" style="gap:8px;margin-top:8px"><button class="btn small primary" data-act="reconReplace">Replace ' + (R.differ.length === 1 ? "it" : "them") + " in Tally with the statement’s amount</button></div>" : "") + "</div>";
  }
  return h + "</section>";
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
function goneHtml(){
  const b = B(), g = b.gone, st = curStmt();
  if (!g || !st || g.sid !== st.id || !g.ids.length) return "";
  const n = g.ids.length, all = n === g.marked;
  return '<div class="bk-bal bad"><div style="flex:1"><b>' + n + " line" + (n === 1 ? " is" : "s are") + " marked as posted, but " + (n === 1 ? "is" : "are") + " no longer in Tally.</b> " +
    (all ? "None of this statement\u2019s posted lines are in " + esc(g.ledger) + " in " + esc(g.company) + " any more" + (g.bankLines ? "" : " (Tally shows no entries in this ledger for these dates)") + "." : "They were probably deleted in Tally, or moved to another company.") +
    '<div class="row" style="margin-top:8px;gap:8px"><button class="btn small primary" data-act="goneBack">Put ' + (n === 1 ? "it" : "them") + " back in Ready to post</button>" + focusBtn("gone", "no longer in Tally", g.ids, "Show " + (n === 1 ? "it" : "them")) +
    '<button class="linkbtn" data-act="goneKeep">Leave them as posted</button></div></div></div>';
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
  toast(n + " line" + (n === 1 ? " is" : "s are") + " back in Ready to post. Press Post to send " + (n === 1 ? "it" : "them") + " to Tally again.");
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
  const byLedger = bridgeVer(Bridge.st.version) >= bridgeVer("1.12.3");
  const light = !byLedger && bridgeVer(Bridge.st.version) >= bridgeVer("1.12.1");
  if (opts.pre){ from = opts.from; to = opts.to; }
  const j = opts.pre || await Bridge.call(light ? "/tags?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(from) + "&to=" + isoToTally(to) + Bridge.pinQ() : ledgerLinesUrl(tname, ledger, from, to), null, 600000);
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
function dupFindHtml(){
  const d = S.dupFind;
  if (!d) return "";
  const amt = v => INR.format(d.amountOf(v));
  const tbl = (list, withWant) => '<div class="tblwrap" style="margin-top:6px;max-height:260px;overflow:auto"><table class="data"><thead><tr><th>' + (withWant ? "In Tally on" : "Date") + "</th>" + (withWant ? "<th>Should be</th>" : "") + '<th>Type</th><th>Voucher</th><th>Party</th><th class="n">Amount</th></tr></thead><tbody>' +
    list.slice(0, 400).map(v => "<tr><td>" + fmtDate(tallyToIso(v.date)) + "</td>" + (withWant ? "<td>" + fmtDate(v.wantDate) + "</td>" : "") + "<td>" + esc(v.type || "") + "</td><td>" + esc(v.number || "") + "</td><td>" + esc(v.party || "") + '</td><td class="n">' + amt(v) + "</td></tr>").join("") +
    "</tbody></table></div>";
  const bad = d.extra.length || d.wrongDate.length || d.strangers.length;
  let h = '<div class="bigwarn" style="border-color:' + (bad ? "var(--stop)" : "var(--ledger)") + '">';
  if (!bad) return h + "<b>All clear.</b> " + d.tagged + " entries posted by FinCom were checked in " + esc(d.company) + " (" + fmtDate(d.from) + " to " + fmtDate(d.to) + "): each is there once, on its statement date. " + '<button class="linkbtn" data-act="dupClose">Close</button></div>';
  if (d.wrongDate.length){
    h += "<b>" + d.wrongDate.length + " entr" + (d.wrongDate.length === 1 ? "y is" : "ies are") + " in " + esc(d.company) + " under the wrong date.</b>" +
      "<div>Remove them; the lines then show as not posted, and Post puts them in again with the statement’s date. " + focusBtn("dup-wrong", "in Tally under the wrong date", Array.from(new Set(d.wrongDate.map(v => v.rowId).filter(Boolean))), "Show their statement lines") + "</div>" + tbl(d.wrongDate, true) +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" data-act="dupRemoveWrong">Remove the ' + d.wrongDate.length + " wrong-date entr" + (d.wrongDate.length === 1 ? "y" : "ies") + ' from Tally</button></div>';
  }
  if (d.extra.length){
    h += '<div style="margin-top:' + (d.wrongDate.length ? 12 : 0) + 'px"><b>' + d.extra.length + " entr" + (d.extra.length === 1 ? "y is" : "ies are") + " in " + esc(d.company) + " twice.</b></div>" +
      "<div>For each one, the first copy is kept and the later copy is removed.</div>" + tbl(d.extra, false) +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" data-act="dupRemove">Remove the ' + d.extra.length + " extra cop" + (d.extra.length === 1 ? "y" : "ies") + " from Tally</button></div>";
  }
  if (d.strangers.length){
    h += '<div style="margin-top:10px"><b>' + d.strangers.length + " entr" + (d.strangers.length === 1 ? "y" : "ies") + " posted by FinCom " + (d.strangers.length === 1 ? "has an amount that is" : "have amounts that are") + " not on this statement:</b> " +
      d.strangers.slice(0, 40).map(v => fmtDate(tallyToIso(v.date)) + " " + esc(v.party || "") + " " + amt(v)).join("; ") +
      ". They were probably read from an earlier or different copy of the statement. Check them against the bank, and delete them in Tally if they are wrong.</div>";
  }
  return h + '<div class="row" style="margin-top:8px"><button class="linkbtn" data-act="dupClose">Close</button></div></div>';
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
function bankFocusHtml(){
  const b = B(), f = b.focus;
  if (!f) return "";
  return '<div class="bk-focus"><div><b>Showing ' + f.ids.length + " line" + (f.ids.length === 1 ? "" : "s") + ": " + esc(f.title) + "</b>" + (f.note ? '<div class="note">' + esc(f.note) + "</div>" : "") +
    '</div><button class="btn small" data-act="bankFocusOff">Show all lines</button></div>';
}
S.focusSets = S.focusSets || {};
function focusBtn(key, title, ids, label, note){
  S.focusSets[key] = {title, ids: [].concat(ids || []), note: note || ""};
  return ids && ids.length ? '<button class="linkbtn" data-bfocus="' + esc(key) + '">' + esc(label || "Show " + (ids.length === 1 ? "this line" : "these " + ids.length + " lines")) + "</button>" : "";
}
function bankBalanceHtml(st){
  const t = st.tallyBal;
  if (st.tallyBalHidden && st.tallyBalHidden === (t ? t.at : "none")) return "";
  const h = bankBalanceInner(st);
  // every form of the box can be closed; a new check shows it again
  return h ? h.replace('class="bk-bal', 'class="bk-balbox bk-bal').replace(/<\/div>$/, '<button class="icon bk-x" data-act="balHide" title="Close" aria-label="Close">\u00d7</button></div>') : "";
}
function bankBalanceInner(st){
  const b = B(), t = st.tallyBal;
  const live = Bridge.on() && Bridge.up();
  const btn = live ? '<button class="btn small" data-act="bankBalCheck"' + (b.balBusy ? " disabled" : "") + ">" + (b.balBusy ? "Checking…" : t ? "Check again" : "Check with Tally") + "</button>" : "";
  const when = (t && t.at ? '<span class="muted"> \u00b7 checked ' + new Date(t.at).toLocaleString([], {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}) + "</span>" : "") +
    (t && t.how === "worked back" ? '<span class="muted"> \u00b7 Tally gave its latest balance whatever the date, so the balance on ' + fmtDate(t.to) + " was worked back from it" + (t.later ? ", less " + t.later + " later entr" + (t.later === 1 ? "y" : "ies") : "") + "</span>" : "");
  if (!t) return '<div class="bk-bal"><div><b>Balance in Tally:</b> <span class="muted">not checked yet.' + (live ? " FinCom checks it after every posting." : " Connect the Tally Bridge to check it.") + "</span></div>" + btn + "</div>";
  if (t.error) return '<div class="bk-bal bad"><div><b>Balance in Tally could not be read:</b> ' + esc(t.error) + when + "</div>" + btn + "</div>";
  const m = v => INR.format(v || 0);
  const on = fmtDate(t.to);
  if (t.diff === null) return '<div class="bk-bal"><div><b>' + esc(t.ledger) + " in Tally on " + on + ":</b> " + m(t.tClose) + ' <span class="muted">(the statement has no closing balance to compare with)</span>' + when + "</div>" + btn + "</div>";
  if (Math.abs(t.diff) < 0.01) return '<div class="bk-bal ok"><div>✔ <b>Tally agrees with the bank.</b> ' + esc(t.ledger) + " in Tally on " + on + " is " + m(t.tClose) + ", the statement's closing balance." + when + "</div>" + btn + "</div>";
  let h = '<div class="bk-bal bad"><div style="flex:1"><div>✖ <b>Tally does not agree with the bank.</b> ' + esc(t.ledger) + " in Tally on " + on + " is <b>" + m(t.tClose) + "</b>; the statement closes at <b>" + m(t.sClose) + "</b>. Difference <b>" + m(Math.abs(t.diff)) + "</b> (" + (t.diff > 0 ? "Tally is lower" : "Tally is higher") + ")." + when + "</div>";
  const li = [];
  if (t.diffOpen && Math.abs(t.diffOpen) >= 0.01) li.push("<li><b>Opening balance:</b> Tally on " + fmtDate(t.openAsOn) + " is " + m(t.tOpen) + ", the statement opens at " + m(t.sOpen) + " (" + m(Math.abs(t.diffOpen)) + " apart). Entries before " + fmtDate(t.from) + " are missing or different in Tally: post the earlier statement first.</li>");
  if (t.notIn.length) li.push("<li><b>" + t.notIn.length + " line" + (t.notIn.length === 1 ? " is" : "s are") + " not in Tally yet</b> (" + m(Math.abs(t.notInEffect)) + " " + (t.notInEffect >= 0 ? "net in" : "net out") + ") " + focusBtn("bal-notin", "not in Tally yet", t.notIn) + "</li>");
  if (t.left.length) li.push("<li><b>" + t.left.length + " line" + (t.left.length === 1 ? " was" : "s were") + " left out</b> (" + m(Math.abs(t.leftEffect)) + ") " + focusBtn("bal-left", "left out, not posted", t.left) + "</li>");
  if (t.missing && t.missing.length) li.push("<li><b>" + t.missing.length + " line" + (t.missing.length === 1 ? " is" : "s are") + " marked as in Tally, but Tally does not show " + (t.missing.length === 1 ? "it" : "them") + " for these dates</b> (" + m(Math.abs(t.missingEffect)) + "): deleted in Tally, or under another date. " + focusBtn("bal-missing", "marked in Tally, not found there", t.missing) + "</li>");
  if (t.extra && t.extra.length) li.push("<li><b>" + t.extra.length + " entr" + (t.extra.length === 1 ? "y is" : "ies are") + " in Tally for these dates but not on the statement</b> (" + m(Math.abs(t.extraEffect)) + "):" +
    '<div class="tblwrap" style="margin-top:6px;max-height:240px;overflow:auto"><table class="data"><thead><tr><th>Date</th><th>Voucher</th><th>Party / ledger</th><th class="n">In</th><th class="n">Out</th><th></th></tr></thead><tbody>' +
    t.extra.slice(0, 300).map(x => "<tr><td>" + fmtDate(x.date) + "</td><td>" + esc([x.type, x.number].filter(Boolean).join(" ")) + "</td><td>" + esc(x.party) + '</td><td class="n">' + (x.eff > 0 ? m(x.eff) : "") + '</td><td class="n">' + (x.eff < 0 ? m(-x.eff) : "") + "</td><td>" + esc(x.note || "") + "</td></tr>").join("") +
    "</tbody></table></div></li>");
  if (!t.extra) li.push('<li>' + (live ? '<button class="btn small primary" data-act="reconRun">Reconcile with Tally</button> ' : "") + '<span class="muted">pairs every statement line with the entries of ' + esc(t.ledger) + " in Tally, and lists what to post and what to delete to make them agree</span></li>");
  if (t.unexplained !== undefined && Math.abs(t.unexplained) >= 0.01) li.push("<li><b>" + m(Math.abs(t.unexplained)) + " is not explained</b> by the lines above: check the amounts of the entries in Tally against the statement.</li>");
  else if (t.extra) li.push('<li class="muted">These together make up the whole difference.</li>');
  return h + (li.length ? '<ul class="bk-bal-why">' + li.join("") + "</ul>" : "") + "</div>" + btn + "</div>";
}

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
  const oneRead = bridgeVer(Bridge.st.version) >= bridgeVer("1.12.3");
  if (toCheck.length && !heavy && oneRead){
    try {
      const look = b.tallyLook && b.tallyLook.sid === st.id && Date.now() - b.tallyLook.at < 30 * 60000 ? b.tallyLook : null;
      let pre = look && look.data;
      const dsAll = b.rows.map(r => r.date).filter(Boolean).sort(), today = new Date().toISOString().slice(0, 10);
      const from = addDays(dsAll[0], -15), to = addDays(dsAll[dsAll.length - 1] > today ? dsAll[dsAll.length - 1] : today, 7);
      if (!pre){
        b.busy = "Looking at " + acc.ledger + " in Tally before posting\u2026"; render();
        pre = await Bridge.call(ledgerLinesUrl(tname, acc.ledger, from, to), null, 600000);
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
    const j = await Bridge.post({company: tname, ledger: acc.ledger,
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
    b.afterPost = !j.checking;
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
    const j = await Bridge.call("/vouchers?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(addDays(dates[0], -5)) + "&to=" + isoToTally(addDays(dates[dates.length - 1] > new Date().toISOString().slice(0, 10) ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10), 31)) + "&types=" + encodeURIComponent([vt, "Purchase", "Journal", co.debitNoteType || "Debit Note"].join(",")) + Bridge.pinQ(), null, 300000);
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
      const j0 = await Bridge.call("/vouchers?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(addDays(dates[0], -5)) + "&to=" + isoToTally(addDays(dates[dates.length - 1], 5)) + "&types=" + encodeURIComponent([vt, "Purchase", "Journal"].join(",")) + Bridge.pinQ());
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
      const j = await Bridge.post({company: tname, masters: masters.map(l => ({id: "led:" + l.name, xml: ledgerMasterXml(l)})), vouchers: todo.map(e => ({id: e.id, xml: voucherXml(e, co)}))}, pj => { S.billPost = {busy: postingLine(pj, tname)}; refreshBusy(); });
      const byId = new Map([].concat(j.results || []).map(x => [x.id, x]));
      masters.forEach(l => { const x = byId.get("led:" + l.name); if (x && x.ok){ l.sent = true; l.sentAt = now; } });
      saveBank({newLed: true});
      // a voucher number another supplier already used: try once more with this supplier's initials added
      const clash = todo.filter(e => { const x = byId.get(e.id); return x && !x.ok && /already\s+exists/i.test(x.message || "") && co.vchNumbering !== "tally"; });
      if (clash.length){
        clash.forEach(e => { e.vchNo = (e.x.invoiceNo || "B") + "/" + initialsOf(e.x.vendorName || e.partyLedger); });
        S.billPost = {busy: "Voucher numbers already used in Tally: trying " + clash.length + " again with the supplier\u2019s initials\u2026"}; render();
        try {
          const j2 = await Bridge.post({company: tname, masters: [], vouchers: clash.map(e => ({id: e.id, xml: voucherXml(e, co)}))});
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
      await askConfirm({title: "The Tally Bridge on the Tally computer needs updating", ok: "Got it", body:
        '<p>This needs bridge 1.8.1. Download it from Client setup \u2192 Company and Tally \u2192 Tally Bridge, and install it on the computer where Tally runs.</p>' +
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
function viewReadTest(){
  if (!Bridge.up()) return "";
  const r = S.readTest || {};
  let h = '<div style="margin-top:10px;border-top:1px solid var(--rule-soft);padding-top:10px"><div class="row" style="justify-content:space-between;align-items:center"><b>Test reading entries</b><button class="btn small" data-act="bridgeReadTest"' + (r.busy ? " disabled" : "") + ">" + (r.busy ? "Testing\u2026" : "Run test") + "</button></div>" +
    '<p class="note" style="margin:4px 0">Checks how FinCom can read entries from the company open in Tally (nothing is written). If posts are \u201cnot confirmed\u201d, run this and send the result.</p>';
  if (r.error) h += '<p class="bk-warn">' + esc(r.error) + "</p>";
  if (r.tests) h += '<table class="data"><tbody>' + r.tests.map(t => "<tr><td>" + esc(t.name) + "</td><td>" + (t.ok ? '<span class="tag ok">works</span> ' + num(t.count) + " found" + (t.optional ? " (" + num(t.optional) + " Optional)" : "") : '<span class="tag bad">failed</span> ' + esc(t.error || "")) + '</td><td class="n">' + num(t.ms) + " ms</td></tr>").join("") + "</tbody></table>" +
    '<p class="note" style="margin:4px 0 0">' + esc(r.company || "") + " \u00b7 port " + esc(r.port) + " \u00b7 " + esc(r.from) + " to " + esc(r.to) + "</p>";
  return h + "</div>";
}
function viewBridgeDiagnosis(){
  const d = Bridge.diag;
  let h = '<div class="bdiag"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Check my Tally</h3><button class="btn small" data-act="bridgeDiag">' + (d ? "Check again" : "Check now") + "</button></div>";
  if (!d) return h + '<p class="note" style="margin:6px 0 0">Finds your TallyPrime on this server and explains anything that stops the connection.</p>' + viewReadTest() + "</div>";
  if (d.error) return h + '<p class="bk-warn">' + esc(d.error) + "</p></div>";
  h += '<p class="note" style="margin:6px 0">Bridge running as <b>' + esc(d.user || "") + "</b> (Windows session " + esc(d.mySession) + ").</p>";
  h += (d.findings || []).map(f => '<div class="bd-f ' + esc(f.level) + '"><b>' + (f.level === "ok" ? "\u2714 " : "\u26A0 ") + esc(f.text) + "</b>" + (f.fix ? '<div class="bd-fix">What to do: ' + esc(f.fix) + "</div>" : "") + "</div>").join("");
  if ((d.tallies || []).length) h += '<table class="data" style="margin-top:8px"><thead><tr><th>TallyPrime of</th><th>Accepting connections on</th><th>Its setting</th></tr></thead><tbody>' +
    d.tallies.map(t => "<tr><td>" + esc(t.user || ("session " + t.session)) + (t.mine ? ' <span class="tag ok">you</span>' : "") + "</td><td>" + (t.ports.length ? "port " + esc(t.ports.join(", ")) : '<span class="tag bad">not accepting</span>') + "</td><td>" +
      (t.ini && t.ini.found ? esc((t.ini.mode || "?") + ", port " + (t.ini.port || "9000")) : '<span class="note">\u2014</span>') + "</td></tr>").join("") + "</tbody></table>";
  if (d.freePort) h += '<p class="note" style="margin:6px 0 0">A free port on this server: <b>' + esc(d.freePort) + "</b>. Each user\u2019s TallyPrime needs its own port.</p>";
  return h + viewReadTest() + "</div>";
}
function bridgeDownHelp(c){
  const url = c.url.replace(/\/+$/, "");
  return '<div class="bdiag"><b>FinCom cannot reach the bridge. Check, in this order:</b><ol style="margin:8px 0 0 18px;padding:0;line-height:1.55">' +
    "<li>On the computer where TallyPrime runs, is the window <b>FinCom - Tally Bridge</b> open and showing <b>READY</b>? If not, double-click <b>Start-TDS-Bridge.bat</b> in the bridge folder.</li>" +
    "<li>If that window shows <b>BRIDGE STOPPED</b> or <b>Could not start on port</b>, do what it says, or send the file <b>tds-bridge-console.txt</b> from the bridge folder.</li>" +
    '<li>In this same browser, open <a href="' + esc(url) + '/ping" target="_blank" rel="noopener">' + esc(url) + "/ping</a>. If it shows <code>\"ok\":true</code>, press <b>Retry</b> below (and choose <b>Allow</b> if the browser asks about apps on this device).</li>" +
    "<li>If that page cannot be reached, FinCom and the bridge are on different computers: open FinCom (the downloaded file) inside the server session where TallyPrime runs.</li>" +
    '</ol><div class="row" style="margin-top:8px"><button class="btn small primary" data-act="bridgeTest">Retry</button></div></div>';
}
async function saveBridgeSetup(){
  let t = null;
  try { t = await blockText("bridge-setup"); } catch (e){ t = null; }
  if (!t || !t.trim()){ toast("This copy of the app does not carry the setup file. Use the downloaded app (TDS-Desk-standalone.html)."); return; }
  const raw = atob(t.trim());
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  saveFile("Setup-FinCom-Bridge.bat", new Blob([bytes], {type: "application/octet-stream"}));
  // its fingerprint, to compare with the one published in the FinCom repository (assets/bridge-setup.sha256)
  try { const h = await crypto.subtle.digest("SHA-256", bytes); S.bridgeSha = Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, "0")).join(""); } catch (e){ S.bridgeSha = ""; }
  toast("Saved. On the computer where Tally runs, double-click Setup-FinCom-Bridge.bat and press I.");
  render();
}
function bridgeSetupSteps(){
  const st = Bridge.st, connected = Bridge.on() && Bridge.up();
  const step = (n, done, title, body) => '<li class="' + (done ? "done" : "") + '"><b>' + (done ? "\u2714 " : n + ". ") + title + "</b>" + (body ? "<div>" + body + "</div>" : "") + "</li>";
  return '<div class="setupcard"><h3 style="margin:0 0 6px">Set up in three steps</h3><ol class="setup">' +
    step(1, connected, "Put the bridge on the Tally computer",
      'Press <button class="btn small" data-act="bridgeSetupFile">Download the bridge setup</button> and run the file there (double-click, press <b>I</b>). It installs itself, starts, and starts again at every sign-in. No admin rights needed.') +
    (S.bridgeSha ? '<li class="note" style="list-style:none;font-size:12px">Fingerprint (SHA-256) of the file just saved: <code style="user-select:all;word-break:break-all">' + esc(S.bridgeSha) + "</code>. It must match the one published by FinCom before you run it.</li>" : "") +
    step(2, connected && st.tallyUp, "Open TallyPrime and your company",
      "In TallyPrime: F1 Help \u2192 Settings \u2192 Connectivity \u2192 <b>TallyPrime acts as: Both</b>. Each user's Tally needs its own port (9000, 9001, \u2026).") +
    step(3, connected, "Press Connect here",
      'Press <button class="btn small primary" data-act="bridgeConnect">Connect</button> and type the 6-digit code shown in the bridge window. The code works once, for 15 minutes after the bridge starts; no other web page can connect.') +
    "</ol></div>";
}
function viewBridgeSettings(){
  const c = Bridge.cfg(), st = Bridge.st;
  if (Bridge.blocked()) return '<div class="pane"><h2>Tally Bridge</h2><p class="note" style="margin:0">Pages opened on claude.ai cannot reach programs on your computer. To connect to Tally, use the downloaded app (<b>Download standalone app</b>) on the computer where TallyPrime runs.</p></div>';
  // the Windows app that keeps the bridge running, shows what it does, updates it and sends its log to support
  const cn = '<div class="pane cn-card"><h2>FinCom Connector for Windows <span class="tag">recommended</span></h2>' +
    '<p class="note" style="margin:0 0 10px">One program on the computer with Tally: it installs the bridge, starts with Windows, keeps the bridge running (and starts it again if it stops), ' +
    "shows Tally, the companies kept in step and the cloud copy, checks the computer and says what to do in plain words, updates itself, and sends its log to FinCom support in one click. No admin rights needed.</p>" +
    '<div class="row"><a class="btn primary" href="assets/connector/FinComConnector.exe?v=' + Date.now() + '" download="FinComConnector.exe">Download FinCom Connector</a>' +
    '<span class="note" style="align-self:center">Windows 10 or 11. Until the program is signed, Windows may say \u201cWindows protected your PC\u201d: press More info, then Run anyway.</span></div></div>';
  let h = cn + '<div class="pane"><h2>Tally Bridge</h2><p class="note" style="margin:0 0 12px">Connects FinCom to TallyPrime on this computer: the company open in Tally is followed, ledgers load straight from Tally, and entries are posted without files. Run <b>TDSBridge</b> on the computer where TallyPrime runs, then paste its key here.</p>' +
    '<div class="grid"><label class="f"><span>Bridge address</span><input type="text" data-bridge="url" value="' + esc(c.url) + '"></label>' +
    '<label class="f"><span>Bridge key (filled in by Connect)</span><input type="text" data-bridge="key" data-fk="bridgekey" value="' + esc(c.key) + '" autocomplete="off" placeholder="press Connect below"></label></div>' +
    '<label class="chk" style="margin-top:8px"><input type="checkbox" data-bridge="follow"' + (c.follow ? " checked" : "") + "> Follow the company open in Tally (switch FinCom to it automatically)</label>" +
    '<div class="row" style="margin-top:10px"><button class="btn small primary" data-act="bridgeTest">' + (c.key ? "Check connection" : "Connect") + "</button>" + (c.key ? '<button class="btn small" data-act="bridgeOff">Disconnect</button>' : "") +
    '<button class="btn small" data-act="bridgeSetupFile">Download the bridge setup</button></div>';
  if (!(Bridge.on() && Bridge.up())) h += bridgeSetupSteps();
  if (c.key){
    h += '<div style="margin-top:12px">' + (st.state === "ok"
      ? '<p class="note" style="margin:0 0 6px">Bridge ' + esc(st.version || "") + " connected" + (st.allowImport === false ? " (posting switched off in the bridge)" : "") + ". Checked " + new Date(st.at).toLocaleTimeString() + ".</p>" +
        '<p class="note" style="margin:0 0 6px">' + ({auto: "The bridge finds the TallyPrime running in your Windows session" + (st.user ? " (" + esc(st.user) + ")" : "") + " and ignores other users\u2019 Tally.", config: "The bridge uses the Tally ports listed in its settings file.", fallback: "Windows did not tell the bridge which Tally is yours: choose it below."}[st.mode] || "") + "</p>" +
        ((st.clash || []).length ? '<p class="bk-warn">' + esc(st.clash.join(", ")) + " is open in more than one Tally. Choose yours with <b>Use this Tally</b>; until then nothing is read or posted for it.</p>" : "") +
        (st.sessions.length ? '<table class="data"><thead><tr><th>Tally</th><th>Owner</th><th>Companies open</th><th>FinCom client</th><th></th></tr></thead><tbody>' +
          st.sessions.filter(se => se.ok || se.skipped || num(c.port) === se.port || st.mode !== "fallback").map(se => {
            const owner = se.skipped ? '<span class="tag no">Another user \u2014 not used</span>' : se.mine === true ? '<span class="tag ok">Your session</span>' : '<span class="tag warn">Not checked</span>';
            const pinned = num(c.port) === se.port;
            const comps = se.skipped ? '<span class="note">hidden</span>' : !se.ok ? '<span class="note">' + esc(se.error ? "not answering" : "\u2014") + "</span>" : se.companies.length ? se.companies.map(o => "<b>" + esc(o.name) + "</b>").join("<br>") : '<span class="note">no company open</span>';
            const clients = se.skipped || !se.ok ? "" : se.companies.map(o => { const cl = Bridge.clientFor(o.name); return cl ? esc(cl.name) : '<select data-bridgelink="' + esc(o.name) + '"><option value="">Link to a client\u2026</option>' + sortedCompanies().map(x => '<option value="' + x.id + '">' + esc(x.name) + "</option>").join("") + "</select>"; }).join("<br>");
            const act = se.skipped ? "" : pinned ? '<span class="tag ok">In use</span> <button class="linkbtn" data-bridgepin="0">Automatic</button>' : se.ok ? '<button class="btn small" data-bridgepin="' + esc(se.port) + '">Use this Tally</button>' : "";
            return "<tr><td>Port " + esc(se.port) + "</td><td>" + owner + "</td><td>" + comps + "</td><td>" + clients + "</td><td>" + act + "</td></tr>";
          }).join("") + "</tbody></table>" : '<p class="note">No TallyPrime found. Start TallyPrime in this Windows session.</p>') +
        (num(c.port) && !st.sessions.some(se => se.port === num(c.port)) ? '<p class="bk-warn">The chosen Tally (port ' + num(c.port) + ') is not running. <button class="linkbtn" data-bridgepin="0">Go back to automatic</button></p>' : "") +
        viewBridgeDiagnosis() +
        (st.tallyUp || (Bridge.diag && (Bridge.diag.findings || []).length) ? "" : '<p class="bk-warn">TallyPrime is not answering. In TallyPrime: F1 Help \u2192 Settings \u2192 Connectivity \u2192 set \u201cTallyPrime acts as\u201d to Both, port 9000.</p>')
      : '<p class="bk-warn">' + esc(st.error || "Not checked yet.") + "</p>" + (st.state === "down" ? bridgeDownHelp(c) : "")) + "</div>";
  }
  h += "</div>";
  return h;
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
  async send(file, onStep, range){
    if (!Bridge.on()) return {skipped: "the Tally Bridge is not connected"};
    const name = this.company();
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
    if (!Bridge.on()) return {skipped: "the Tally Bridge is not connected"};
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
  }
};
