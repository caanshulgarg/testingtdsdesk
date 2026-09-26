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
    if (!r.ok || !j || j.ok === false) throw {code: r.status === 401 ? "bridge_key" : "bridge", message: (j && j.error) || ("The bridge answered with error " + r.status + ".")};
    return j;
  },
  async refresh(){
    if (!this.on()){ this.st = {state: "off", sessions: [], open: [], at: Date.now(), error: ""}; return this.st; }
    try {
      const j = await this.call("/status", null, 15000);
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
        version: j.version, allowImport: j.allowImport !== false, mode: j.mode || "", user: j.user || "", mySession: j.mySession,
        tallyUp: usable.length > 0, pinMissing: !!pin && !(j.sessions || []).some(s => s.port === pin && s.ok && !s.skipped)};
      if (!this.st.tallyUp || this.st.pinMissing){ if (!this.diag || Date.now() - this.diag.at > 30000) await this.diagnose(); }
      else this.diag = null;
    } catch (e){
      this.st = {state: e.code === "bridge_key" ? "key" : "down", sessions: [], open: [], at: Date.now(), error: e.message};
    }
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
function addDays(iso, n){ const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

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
async function bridgeTick(first){
  Bridge.st.lastAsk = Date.now();
  if (bridgeBusy || !Bridge.on()) return;
  bridgeBusy = true;
  try {
    const before = Bridge.st.state;
    await Bridge.refresh();
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
    const j = await Bridge.call("/vouchers?company=" + encodeURIComponent(Bridge.openFor(co).name) + "&from=" + isoToTally(from) + "&to=" + isoToTally(to) + "&ledger=" + encodeURIComponent(ledger) + Bridge.pinQ());
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
    const stale = !b.ledgers.live || !(b.ledgers.list || []).length;
    if (force || stale) await syncLedgersFromTally(true);
    const st = curStmt();
    if (st && force) await syncBankBookFromTally(true);   // only when asked: this reads the Day Book
    if (force || (b.ledgers.list || []).length !== before) render();
  } finally { bankSyncing = false; }
}
/* ---------- finding and removing double entries already in Tally ---------- */
async function findTallyDuplicates(){
  const b = B(), co = CO(b.cid), st = curStmt();
  if (!st){ toast("Open a statement first."); return; }
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  if (!acc || !exactLedger(acc.ledger)){ toast("Set the Tally ledger for this bank account first."); return; }
  const tname = await ensureTallyCompany(co);
  if (!tname) return;
  const ds = b.rows.map(r => r.date).filter(Boolean).sort();
  b.busy = "Reading " + exactLedger(acc.ledger) + " from Tally\u2026"; render();
  let vs = [];
  try {
    const j = await Bridge.call("/vouchers?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(ds[0]) + "&to=" + isoToTally(ds[ds.length - 1]) + "&ledger=" + encodeURIComponent(exactLedger(acc.ledger)) + Bridge.pinQ(), null, 300000);
    vs = [].concat(j.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || ""));
  } catch (e){ b.busy = ""; toast("Could not read Tally: " + e.message); render(); return; }
  b.busy = "";
  // group what TDS Desk posted by its tag; more than one voucher with the same tag is a double entry
  const groups = new Map();
  vs.forEach(v => {
    const m = String(v.narration || "").match(/TDSDesk:([A-Za-z0-9]+)/i);
    if (!m) return;
    const k = m[1].toLowerCase();
    (groups.get(k) || groups.set(k, []).get(k)).push(v);
  });
  const extra = [];
  groups.forEach(list => {
    if (list.length < 2) return;
    list.sort((a, c) => num(a.masterId) - num(c.masterId) || String(a.number).localeCompare(String(c.number)));
    list.slice(1).forEach(v => extra.push(v));            // keep the first, the rest are copies
  });
  // vouchers TDS Desk posted whose amount is not on this statement at all
  const amountOf = v => { const en = [].concat(v.entries || []).find(x => norm(x.ledger) === norm(exactLedger(acc.ledger))); return en ? Math.abs(parseFloat(String(en.amount).replace(/,/g, "")) || 0) : 0; };
  const onStmt = new Set(b.rows.map(r => tallyToIso(isoToTally(r.date)) + "|" + r2(r.debit || r.credit)));
  const strangers = [];
  groups.forEach(list => { const v = list[0]; const k = tallyToIso(v.date) + "|" + r2(amountOf(v)); if (amountOf(v) && !onStmt.has(k)) list.forEach(x => strangers.push(x)); });
  // everything seen in Tally counts as posted, so it is never posted again from here
  b.postedTags = b.postedTags || {};
  groups.forEach((list, k) => { b.postedTags[k] = b.postedTags[k] || new Date().toISOString(); });
  saveBank({posted: true});
  S.dupFind = {at: Date.now(), total: vs.length, tagged: Array.from(groups.values()).reduce((a, l) => a + l.length, 0), extra, strangers, company: tname, amountOf};
  render();
}
function dupFindHtml(){
  const d = S.dupFind;
  if (!d) return "";
  const amt = v => INR.format(d.amountOf(v));
  let h = '<div class="bigwarn" style="border-color:' + (d.extra.length || d.strangers.length ? "var(--stop)" : "var(--ledger)") + '">';
  if (!d.extra.length && !d.strangers.length) return h + "<b>No double entries.</b> " + d.tagged + " entries posted by TDS Desk were checked in " + esc(d.company) + '. <button class="linkbtn" data-act="dupClose">Close</button></div>';
  if (d.extra.length){
    h += "<b>" + d.extra.length + " entr" + (d.extra.length === 1 ? "y is" : "ies are") + " in " + esc(d.company) + " twice.</b>" +
      "<div>For each one, the first copy is kept and the later copy is removed.</div>" +
      '<div class="tblwrap" style="margin-top:6px;max-height:260px;overflow:auto"><table class="data"><thead><tr><th>Date</th><th>Type</th><th>Voucher</th><th>Party</th><th class="n">Amount</th></tr></thead><tbody>' +
      d.extra.slice(0, 300).map(v => "<tr><td>" + fmtDate(tallyToIso(v.date)) + "</td><td>" + esc(v.type || "") + "</td><td>" + esc(v.number || "") + "</td><td>" + esc(v.party || "") + '</td><td class="n">' + amt(v) + "</td></tr>").join("") +
      "</tbody></table></div>" +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" data-act="dupRemove">Remove the ' + d.extra.length + " extra cop" + (d.extra.length === 1 ? "y" : "ies") + ' from Tally</button><button class="linkbtn" data-act="dupClose">Not now</button></div>';
  }
  if (d.strangers.length){
    h += '<div style="margin-top:10px"><b>' + d.strangers.length + " entr" + (d.strangers.length === 1 ? "y" : "ies") + " posted by TDS Desk " + (d.strangers.length === 1 ? "has an amount that is" : "have amounts that are") + " not on this statement:</b> " +
      d.strangers.map(v => fmtDate(tallyToIso(v.date)) + " " + esc(v.party || "") + " " + amt(v)).join("; ") +
      ". They were probably read from an earlier or different copy of the statement. Check them against the bank, and delete them in Tally if they are wrong.</div>";
  }
  return h + "</div>";
}
async function removeTallyDuplicates(){
  const d = S.dupFind;
  if (!d || !d.extra.length) return;
  const a = await askConfirm({title: "Remove " + d.extra.length + " extra copies from " + d.company + "?", ok: "Remove them",
    body: '<p class="note">Only the later copy of each double entry is removed; the first stays. This cannot be undone from TDS Desk, so take a Tally backup first if you have not.</p>'});
  if (!a) return;
  const b = B();
  let ok = 0, bad = 0;
  for (let i = 0; i < d.extra.length; i++){
    const v = d.extra[i];
    b.busy = "Removing copy " + (i + 1) + " of " + d.extra.length + "\u2026"; render();
    try {
      const j = await Bridge.call("/unpost", {company: d.company, guid: v.guid || "", vchType: v.type, vchDate: v.date, vchNumber: v.number || ""}, 60000);
      if (j && j.ok !== false){ ok++; logPosting({what: "bank", id: v.guid, action: "removed", co: b.cid, ref: "double entry " + (v.number || ""), party: v.party, amount: d.amountOf(v), tally: {guid: v.guid, vchType: v.type, vchDate: v.date, company: d.company}, by: (Cloud.st && Cloud.st.email) || ""}); }
      else bad++;
    } catch (e){ bad++; }
  }
  b.busy = "";
  toast(ok + " extra copies removed" + (bad ? ", " + bad + " could not be removed \u2014 delete those in Tally" : "") + ".");
  S.dupFind = null;
  render();
}

/* ---------- taking an entry back out of Tally ---------- */
async function unpostFromTally(what, obj, cid){
  const co = CO(cid || S.coId);
  const t = obj.tally || {};
  if (!t.guid){
    toast("This entry was posted before TDS Desk kept the Tally identity, so it has to be deleted in Tally by hand.");
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
    if (b.postedTags[tag]){ r.prevState = r.state; r.state = "intally"; r.tallyHow = "posted by TDS Desk on " + fmtDate(String(b.postedTags[tag]).slice(0, 10)); }
  });
  // guard 2: look in Tally itself around the dates being posted, for our own entries and for ones typed in by hand
  const toCheck = b.rows.filter(r => r.state === "ready" && (!ids || ids.includes(r.id)));
  if (toCheck.length && !heavy){
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
      failed.push({what: fmtDate(r.date) + " " + (r.dec.name || "") + " " + INR.format(r.debit || r.credit), msg: r.postError});
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
    const j = await Bridge.call("/import", {company: tname,
      masters: masters.map(l => ({id: "led:" + l.name, xml: ledgerMasterXml(l)})),
      vouchers: rows.map(r => ({id: r.id, xml: bankVoucherXml(r, acc, co)}))}, 600000);
    const byId = new Map([].concat(j.results || []).map(x => [x.id, x]));
    const now = new Date().toISOString();
    masters.forEach(l => { const x = byId.get("led:" + l.name); if (x && x.ok){ l.sent = true; l.sentAt = now; } else if (x) failed.push({what: "New ledger " + l.name, msg: x.message}); });
    let ok = 0, optionalN = 0;
    const posted = [];
    rows.forEach(r => {
      const x = byId.get(r.id);
      if (x && x.ok && x.verified !== true){
        b.postedTags = b.postedTags || {}; b.postedTags[fpHash(r.fp || r.id)] = "unconfirmed:" + now;
        r.postError = "Tally replied 'created', but TDS Desk could not find the entry in Tally afterwards, so it is NOT marked as posted. Look in Tally (Day Book, and Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers). If it is not there, post it again." + (x.verifyNote ? " [" + x.verifyNote + "]" : "");
        failed.push({what: fmtDate(r.date) + " " + (r.dec.name || "") + " " + INR.format(r.debit || r.credit), msg: "not confirmed in Tally \u2014 check Tally before posting again"});
      } else if (x && x.ok){
        ok++; r.state = "sent"; r.sentAt = now; r.postedVia = "bridge"; r.postError = ""; r.postedOptional = !!x.optional; r.postVerified = x.verified === true; posted.push(r);
        b.postedTags = b.postedTags || {}; b.postedTags[fpHash(r.fp || r.id)] = now;
        logPosting({what: "bank", id: r.id, action: "posted", co: b.cid, ref: r.narr.slice(0, 40), party: r.ledger, amount: num(r.debit || r.credit), tally: {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", company: tname}, by: (Cloud.st && Cloud.st.email) || ""});
        r.tally = {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", at: now, by: (Cloud.st && Cloud.st.email) || "", company: tname};
        if (x.optional) optionalN++;
        if (r.billId && D(b.cid).entries[r.billId]){ const e = D(b.cid).entries[r.billId]; e.paidBy = r.id; Store.saveEntry(b.cid, e); }
        markSalesReceived(r);
      } else {
        r.postError = plainMsg(x && x.message) || "Tally did not confirm this entry.";
        failed.push({what: fmtDate(r.date) + " " + (r.dec.name || "") + " " + INR.format(r.debit || r.credit), msg: r.postError});
      }
    });
    learnRows(posted, "sent");
    saveBank({rows: true, newLed: true, posted: true});
    b.postReport = {at: Date.now(), posted: ok, skipped, movedBack, failed, dismiss: "bankReportOk", company: tname, optional: optionalN, noPreCheck: !heavy};
    toast(ok + " posted to Tally" + (skipped ? ", " + skipped + " were already there" : "") + (failed.length ? ", " + failed.length + " not posted" : "") + ".");
    if (!failed.length && !b.rows.some(r => r.state === "ready")) b.filter = "done";
  } catch (e){ toast("Posting failed: " + e.message); b.postReport = {at: Date.now(), posted: 0, skipped, movedBack, failed: failed.concat([{what: "Posting", msg: e.message}]), dismiss: "bankReportOk"}; }
  b.busy = "";
  render();
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
    const j = await Bridge.call("/vouchers?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(addDays(dates[0], -5)) + "&to=" + isoToTally(addDays(dates[dates.length - 1], 5)) + "&types=" + encodeURIComponent([vt, "Purchase", "Journal", co.debitNoteType || "Debit Note"].join(",")) + Bridge.pinQ(), null, 300000);
    const vs = [].concat(j.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || ""));
    const now = new Date().toISOString();
    const missing = [];
    let optional = 0;
    sent.forEach(e => {
      const hit = vs.find(v => String(v.narration || "").includes("TDSDesk:" + e.id)) ||
        vs.find(v => norm(v.reference) === norm(e.x.invoiceNo) && (norm(v.party) === norm(e.partyLedger) || [].concat(v.entries || []).some(en => norm(en.ledger) === norm(e.partyLedger))));
      e.tallyCheck = {at: now, found: !!hit, optional: !!(hit && /^yes$/i.test(hit.optional || "")), company: tname};
      if (hit && !e.exportedAt){ e.exportedAt = now; e.postUnconfirmed = null; e.postError = ""; e.postVerified = true; e.postedOptional = e.tallyCheck.optional; e.postedInto = tname; }
      if (hit && e.tallyCheck.optional) optional++;
      if (!hit) missing.push(e);
      Store.saveEntry(co.id, e);
    });
    S.billCheck = {at: now, checked: sent.length, found: sent.length - missing.length, optional, missing: missing.map(e => e.id), company: tname};
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
      const j = await Bridge.call("/import", {company: tname, masters: masters.map(l => ({id: "led:" + l.name, xml: ledgerMasterXml(l)})), vouchers: todo.map(e => ({id: e.id, xml: voucherXml(e, co)}))}, 600000);
      const byId = new Map([].concat(j.results || []).map(x => [x.id, x]));
      masters.forEach(l => { const x = byId.get("led:" + l.name); if (x && x.ok){ l.sent = true; l.sentAt = now; } });
      saveBank({newLed: true});
      // a voucher number another supplier already used: try once more with this supplier's initials added
      const clash = todo.filter(e => { const x = byId.get(e.id); return x && !x.ok && /already\s+exists/i.test(x.message || "") && co.vchNumbering !== "tally"; });
      if (clash.length){
        clash.forEach(e => { e.vchNo = (e.x.invoiceNo || "B") + "/" + initialsOf(e.x.vendorName || e.partyLedger); });
        S.billPost = {busy: "Voucher numbers already used in Tally: trying " + clash.length + " again with the supplier\u2019s initials\u2026"}; render();
        try {
          const j2 = await Bridge.call("/import", {company: tname, masters: [], vouchers: clash.map(e => ({id: e.id, xml: voucherXml(e, co)}))}, 120000);
          [].concat(j2.results || []).forEach(x => byId.set(x.id, x));
        } catch (err){ /* reported below as refused */ }
      }
      todo.forEach(e => {
        const x = byId.get(e.id);
        if (x && x.ok && x.verified === true){ ok++; logPosting({what: "bill", id: e.id, action: "posted", co: co.id, ref: e.x.invoiceNo, party: e.x.vendorName, amount: num(e.x.total), tally: {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", company: x.company || tname}, by: (Cloud.st && Cloud.st.email) || ""}); e.exportedAt = now; e.postError = ""; e.postUnconfirmed = null; e.postedVia = "bridge"; e.postedInto = x.company || tname; e.postedOptional = !!x.optional; e.postVerified = true; e.tallyVchNo = x.vchNumber || "";
          e.tally = {guid: x.guid || "", masterId: x.masterId || "", vchType: x.vchType || "", vchDate: x.vchDate || "", at: now, by: (Cloud.st && Cloud.st.email) || "", company: x.company || tname}; if (x.optional) optionalN++; }
        else if (x && x.ok){ unverified++; e.postUnconfirmed = {at: now, company: x.company || tname, optional: /Optional/.test(x.verifyNote || '')}; e.postError = (/Optional/.test(x.verifyNote || '') && x.message) ? plainMsg(x.message) : "Tally replied 'created', but TDS Desk could not find the entry in Tally afterwards, so it is NOT marked as posted. Look in Tally (Day Book, and Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers). If it is not there, post it again." + (x.verifyNote ? " [" + x.verifyNote + "]" : ""); failed.push({no: e.x.invoiceNo, party: e.x.vendorName, msg: "not confirmed in Tally"}); }
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
    const j = await Bridge.call("/import", {company: tname, masters: AUTO_TYPES.map(t => ({id: "vt:" + t, xml: xml(t)})), vouchers: []}, 120000);
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
    '<p class="note" style="margin:4px 0">Checks how TDS Desk can read entries from the company open in Tally (nothing is written). If posts are \u201cnot confirmed\u201d, run this and send the result.</p>';
  if (r.error) h += '<p class="bk-warn">' + esc(r.error) + "</p>";
  if (r.tests) h += '<table class="data"><tbody>' + r.tests.map(t => "<tr><td>" + esc(t.name) + "</td><td>" + (t.ok ? '<span class="tag ok">works</span> ' + t.count + " found" + (t.optional ? " (" + t.optional + " Optional)" : "") : '<span class="tag bad">failed</span> ' + esc(t.error || "")) + '</td><td class="n">' + t.ms + " ms</td></tr>").join("") + "</tbody></table>" +
    '<p class="note" style="margin:4px 0 0">' + esc(r.company || "") + " \u00b7 port " + esc(r.port) + " \u00b7 " + esc(r.from) + " to " + esc(r.to) + "</p>";
  return h + "</div>";
}
function viewBridgeDiagnosis(){
  const d = Bridge.diag;
  let h = '<div class="bdiag"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Check my Tally</h3><button class="btn small" data-act="bridgeDiag">' + (d ? "Check again" : "Check now") + "</button></div>";
  if (!d) return h + '<p class="note" style="margin:6px 0 0">Finds your TallyPrime on this server and explains anything that stops the connection.</p>' + viewReadTest() + "</div>";
  if (d.error) return h + '<p class="bk-warn">' + esc(d.error) + "</p></div>";
  h += '<p class="note" style="margin:6px 0">Bridge running as <b>' + esc(d.user || "") + "</b> (Windows session " + esc(d.mySession) + ").</p>";
  h += (d.findings || []).map(f => '<div class="bd-f ' + f.level + '"><b>' + (f.level === "ok" ? "\u2714 " : "\u26A0 ") + esc(f.text) + "</b>" + (f.fix ? '<div class="bd-fix">What to do: ' + esc(f.fix) + "</div>" : "") + "</div>").join("");
  if ((d.tallies || []).length) h += '<table class="data" style="margin-top:8px"><thead><tr><th>TallyPrime of</th><th>Accepting connections on</th><th>Its setting</th></tr></thead><tbody>' +
    d.tallies.map(t => "<tr><td>" + esc(t.user || ("session " + t.session)) + (t.mine ? ' <span class="tag ok">you</span>' : "") + "</td><td>" + (t.ports.length ? "port " + t.ports.join(", ") : '<span class="tag bad">not accepting</span>') + "</td><td>" +
      (t.ini && t.ini.found ? esc((t.ini.mode || "?") + ", port " + (t.ini.port || "9000")) : '<span class="note">\u2014</span>') + "</td></tr>").join("") + "</tbody></table>";
  if (d.freePort) h += '<p class="note" style="margin:6px 0 0">A free port on this server: <b>' + d.freePort + "</b>. Each user\u2019s TallyPrime needs its own port.</p>";
  return h + viewReadTest() + "</div>";
}
function bridgeDownHelp(c){
  const url = c.url.replace(/\/+$/, "");
  return '<div class="bdiag"><b>TDS Desk cannot reach the bridge. Check, in this order:</b><ol style="margin:8px 0 0 18px;padding:0;line-height:1.55">' +
    "<li>On the computer where TallyPrime runs, is the window <b>TDS Desk - Tally Bridge</b> open and showing <b>READY</b>? If not, double-click <b>Start-TDS-Bridge.bat</b> in the bridge folder.</li>" +
    "<li>If that window shows <b>BRIDGE STOPPED</b> or <b>Could not start on port</b>, do what it says, or send the file <b>tds-bridge-console.txt</b> from the bridge folder.</li>" +
    '<li>In this same browser, open <a href="' + esc(url) + '/ping" target="_blank" rel="noopener">' + esc(url) + "/ping</a>. If it shows <code>\"ok\":true</code>, press <b>Retry</b> below (and choose <b>Allow</b> if the browser asks about apps on this device).</li>" +
    "<li>If that page cannot be reached, TDS Desk and the bridge are on different computers: open TDS Desk (the downloaded file) inside the server session where TallyPrime runs.</li>" +
    '</ol><div class="row" style="margin-top:8px"><button class="btn small primary" data-act="bridgeTest">Retry</button></div></div>';
}
async function saveBridgeSetup(){
  let t = null;
  try { t = await blockText("bridge-setup"); } catch (e){ t = null; }
  if (!t || !t.trim()){ toast("This copy of the app does not carry the setup file. Use the downloaded app (TDS-Desk-standalone.html)."); return; }
  const raw = atob(t.trim());
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  saveFile("Setup-TDS-Bridge.bat", new Blob([bytes], {type: "application/octet-stream"}));
  toast("Saved. On the computer where Tally runs, double-click Setup-TDS-Bridge.bat and press I.");
}
function bridgeSetupSteps(){
  const st = Bridge.st, connected = Bridge.on() && Bridge.up();
  const step = (n, done, title, body) => '<li class="' + (done ? "done" : "") + '"><b>' + (done ? "\u2714 " : n + ". ") + title + "</b>" + (body ? "<div>" + body + "</div>" : "") + "</li>";
  return '<div class="setupcard"><h3 style="margin:0 0 6px">Set up in three steps</h3><ol class="setup">' +
    step(1, connected, "Put the bridge on the Tally computer",
      'Press <button class="btn small" data-act="bridgeSetupFile">Download the bridge setup</button> and run the file there (double-click, press <b>I</b>). It installs itself, starts, and starts again at every sign-in. No admin rights needed.') +
    step(2, connected && st.tallyUp, "Open TallyPrime and your company",
      "In TallyPrime: F1 Help \u2192 Settings \u2192 Connectivity \u2192 <b>TallyPrime acts as: Both</b>. Each user's Tally needs its own port (9000, 9001, \u2026).") +
    step(3, connected, "Press Connect here",
      'Press <button class="btn small primary" data-act="bridgeConnect">Connect</button> and type the 6-digit code shown in the bridge window. The code works once, for 15 minutes after the bridge starts; no other web page can connect.') +
    "</ol></div>";
}
function viewBridgeSettings(){
  const c = Bridge.cfg(), st = Bridge.st;
  if (Bridge.blocked()) return '<div class="pane"><h2>Tally Bridge</h2><p class="note" style="margin:0">Pages opened on claude.ai cannot reach programs on your computer. To connect to Tally, use the downloaded app (<b>Download standalone app</b>) on the computer where TallyPrime runs.</p></div>';
  let h = '<div class="pane"><h2>Tally Bridge</h2><p class="note" style="margin:0 0 12px">Connects TDS Desk to TallyPrime on this computer: the company open in Tally is followed, ledgers load straight from Tally, and entries are posted without files. Run <b>TDSBridge</b> on the computer where TallyPrime runs, then paste its key here.</p>' +
    '<div class="grid"><label class="f"><span>Bridge address</span><input type="text" data-bridge="url" value="' + esc(c.url) + '"></label>' +
    '<label class="f"><span>Bridge key (filled in by Connect)</span><input type="text" data-bridge="key" data-fk="bridgekey" value="' + esc(c.key) + '" autocomplete="off" placeholder="press Connect below"></label></div>' +
    '<label class="chk" style="margin-top:8px"><input type="checkbox" data-bridge="follow"' + (c.follow ? " checked" : "") + "> Follow the company open in Tally (switch TDS Desk to it automatically)</label>" +
    '<div class="row" style="margin-top:10px"><button class="btn small primary" data-act="bridgeTest">' + (c.key ? "Check connection" : "Connect") + "</button>" + (c.key ? '<button class="btn small" data-act="bridgeOff">Disconnect</button>' : "") +
    '<button class="btn small" data-act="bridgeSetupFile">Download the bridge setup</button></div>';
  if (!(Bridge.on() && Bridge.up())) h += bridgeSetupSteps();
  if (c.key){
    h += '<div style="margin-top:12px">' + (st.state === "ok"
      ? '<p class="note" style="margin:0 0 6px">Bridge ' + esc(st.version || "") + " connected" + (st.allowImport === false ? " (posting switched off in the bridge)" : "") + ". Checked " + new Date(st.at).toLocaleTimeString() + ".</p>" +
        '<p class="note" style="margin:0 0 6px">' + ({auto: "The bridge finds the TallyPrime running in your Windows session" + (st.user ? " (" + esc(st.user) + ")" : "") + " and ignores other users\u2019 Tally.", config: "The bridge uses the Tally ports listed in its settings file.", fallback: "Windows did not tell the bridge which Tally is yours: choose it below."}[st.mode] || "") + "</p>" +
        ((st.clash || []).length ? '<p class="bk-warn">' + esc(st.clash.join(", ")) + " is open in more than one Tally. Choose yours with <b>Use this Tally</b>; until then nothing is read or posted for it.</p>" : "") +
        (st.sessions.length ? '<table class="data"><thead><tr><th>Tally</th><th>Owner</th><th>Companies open</th><th>TDS Desk client</th><th></th></tr></thead><tbody>' +
          st.sessions.filter(se => se.ok || se.skipped || num(c.port) === se.port || st.mode !== "fallback").map(se => {
            const owner = se.skipped ? '<span class="tag no">Another user \u2014 not used</span>' : se.mine === true ? '<span class="tag ok">Your session</span>' : '<span class="tag warn">Not checked</span>';
            const pinned = num(c.port) === se.port;
            const comps = se.skipped ? '<span class="note">hidden</span>' : !se.ok ? '<span class="note">' + esc(se.error ? "not answering" : "\u2014") + "</span>" : se.companies.length ? se.companies.map(o => "<b>" + esc(o.name) + "</b>").join("<br>") : '<span class="note">no company open</span>';
            const clients = se.skipped || !se.ok ? "" : se.companies.map(o => { const cl = Bridge.clientFor(o.name); return cl ? esc(cl.name) : '<select data-bridgelink="' + esc(o.name) + '"><option value="">Link to a client\u2026</option>' + sortedCompanies().map(x => '<option value="' + x.id + '">' + esc(x.name) + "</option>").join("") + "</select>"; }).join("<br>");
            const act = se.skipped ? "" : pinned ? '<span class="tag ok">In use</span> <button class="linkbtn" data-bridgepin="0">Automatic</button>' : se.ok ? '<button class="btn small" data-bridgepin="' + se.port + '">Use this Tally</button>' : "";
            return "<tr><td>Port " + se.port + "</td><td>" + owner + "</td><td>" + comps + "</td><td>" + clients + "</td><td>" + act + "</td></tr>";
          }).join("") + "</tbody></table>" : '<p class="note">No TallyPrime found. Start TallyPrime in this Windows session.</p>') +
        (num(c.port) && !st.sessions.some(se => se.port === num(c.port)) ? '<p class="bk-warn">The chosen Tally (port ' + num(c.port) + ') is not running. <button class="linkbtn" data-bridgepin="0">Go back to automatic</button></p>' : "") +
        viewBridgeDiagnosis() +
        (st.tallyUp || (Bridge.diag && (Bridge.diag.findings || []).length) ? "" : '<p class="bk-warn">TallyPrime is not answering. In TallyPrime: F1 Help \u2192 Settings \u2192 Connectivity \u2192 set \u201cTallyPrime acts as\u201d to Both, port 9000.</p>')
      : '<p class="bk-warn">' + esc(st.error || "Not checked yet.") + "</p>" + (st.state === "down" ? bridgeDownHelp(c) : "")) + "</div>";
  }
  h += "</div>";
  return h;
}

