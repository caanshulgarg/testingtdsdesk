/* ================================================================== */
/* Posting from any computer: the queue in FinCom's cloud (build 199)  */
/* ================================================================== */
// On the computer with Tally, FinCom posts through the bridge there, as before. On any other computer, when the client's
// books are in the cloud, the entries are queued in the cloud (tally_post_jobs); the bridge on the Tally computer takes
// them with its heartbeat (within a minute), posts them with its usual job (FinCom's ID stamped in each entry, and Tally
// checked for those IDs first, so nothing is posted twice), and writes each entry's result back, with Tally's own words
// when it refused one. The checks before posting (the ledgers, entries already in Tally) read the cloud copy instead.

// how this computer reaches the client's Tally: "bridge" (here), "cloud" (the queue), or null
function tallyVia(co){
  if (!co) return null;
  if (bridgeLive(co)) return "bridge";
  return typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id) ? "cloud" : null;
}
function tallyCoName(co){
  const o = typeof Bridge === "object" && Bridge.up() ? Bridge.openFor(co) : null;
  return o ? o.name : ((typeof TCloud === "object" && TCloud.book(co.id) || {}).company || co.tallyName || co.name);
}
// a read the bridge answers (/ledgers, /ledgerlines, /vouchers), from the bridge here or from the cloud copy
function tallyCall(co, url, body, timeout){
  return tallyVia(co) === "cloud" ? CloudTally.call(co, url) : Bridge.call(url, body, timeout);
}
const CloudTally = {
  async call(co, url){
    const q = new URLSearchParams(url.split("?")[1] || ""), path = url.split("?")[0];
    if (path === "/ledgers"){
      const bk = TCloud.book(co.id);
      // the client's ledgers as the cloud copy holds them: twins kept from a trial balance file are not ledgers of their
      // own, and a name with line breaks is the name its entries use (one count everywhere: review of 02-Oct-2026)
      const rows = bk ? await TCloud.restAll("tally_ledgers?select=name,parent&merged_into=is.null&book_id=eq." + encodeURIComponent(bk.book) + "&order=name.asc") : [];
      const by = new Map(); rows.forEach(r => { const n = ledNm(r.name); if (n && !by.has(n)) by.set(n, {name: n, group: r.parent || ""}); });
      return {ok: true, via: "cloud", ledgers: Array.from(by.values()), groups: []};
    }
    if (path === "/ledgerlines" || path === "/vouchers"){
      const types = (q.get("types") || "").split(",").map(s => s.trim()).filter(Boolean);
      const vs = await TCloud.rpc("tally_vouchers_in", {p_client: co.id, p_from: TCloud.iso(q.get("from")), p_to: TCloud.iso(q.get("to")),
        p_ledger: q.get("ledger") || null, p_types: types.length ? types : null});
      return {ok: true, via: "cloud", vouchers: [].concat(vs || [])};
    }
    throw {code: "cloud", message: "This needs the Tally computer (" + path + ")."};
  }
};
const CloudPost = {
  uuid(){
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  },
  async row(id){ const r = await Cloud.api("tally_post_jobs?select=id,status,done,n,message,results,checking,company&id=eq." + id); return (r || [])[0] || null; },
  // the same answer as Bridge.postChecked: {ok, company, results: [{id, ok, message, ...}], checking, job}
  async run(cid, payload, onProgress, onChecked){
    const id = this.uuid(), sleep = ms => new Promise(r => setTimeout(r, ms));
    const ids = [].concat(payload.masters || [], payload.vouchers || []).map(x => x.id);
    const r = await TCloud.rpc("tally_post_enqueue", {p_id: id, p_client: cid, p_payload: {masters: payload.masters || [], vouchers: payload.vouchers || [], ledger: payload.ledger || ""}});
    // 02-Oct-2026 (B14): the cloud's own check of the company the client may post to: nothing was queued, nothing sent,
    // and it is not Tally's reason; the entries stay waiting
    if (r && !r.ok && r.notAllowed) return {ok: true, company: r.company || payload.company, notAllowed: true, viaCloud: true,
      results: ids.map(x => ({id: x, ok: false, notAllowed: true, message: r.error || "Choose the Tally company this client may post to (Client setup \u2192 Tally)."}))};
    if (!r || !r.ok) throw {code: "cloud_post", message: (r && r.error) || "The entries could not be queued."};
    try { lsSet("tdsdesk:cloudpost", JSON.stringify({id, cid, at: Date.now(), n: ids.length})); } catch (e){}
    const tell = j => { try { onProgress && onProgress(j); } catch (e){} };
    const t0 = Date.now();
    let j = null;
    for (;;){
      await sleep(j ? 2500 : 1200);
      try { j = await this.row(id) || j; } catch (e){ /* the internet: tried again */ }
      if (!j) continue;
      if (["done", "failed", "cancelled"].includes(j.status)) break;
      const waitMin = Math.floor((Date.now() - t0) / 60000);
      tell({done: j.done || 0, total: j.n || ids.length, message: j.status === "waiting"
        ? "Queued for the Tally computer; it takes it within a minute when Tally is open" + (waitMin >= 2 ? " (waiting " + waitMin + " min: is Tally open there?)" : "")
        : (j.message || "Posting on the Tally computer")});
      if (Date.now() - t0 > 30 * 60000){ j = Object.assign({}, j, {status: "failed", message: "Still waiting for the Tally computer after 30 minutes. The posting stays queued and runs when Tally is open there; entries already in Tally are never posted twice."}); break; }
    }
    const why = j.status === "done" ? "Not posted." : (j.message || "The posting stopped.");
    const resultsOf = jj => { const got = new Map([].concat(jj.results || []).map(x => [x.id, x])); return ids.map(x => got.get(x) || {id: x, ok: false, message: why}); };
    const results = resultsOf(j);
    if (j.checking){
      results.forEach(x => { if (x.ok && x.verified == null) x.pendingCheck = true; });
      (async () => {
        for (let n = 0; n < 400; n++){
          await sleep(n < 10 ? 2000 : 5000);
          let k; try { k = await this.row(id); } catch (e){ continue; }
          if (k && !k.checking){ try { lsDel("tdsdesk:cloudpost"); } catch (e){} try { onChecked && onChecked({results: resultsOf(k)}); } catch (e){} return; }
        }
      })();
    } else { try { lsDel("tdsdesk:cloudpost"); } catch (e){} }
    return {ok: true, company: j.company || payload.company, results, checking: !!j.checking, viaCloud: true, job: {id, status: j.status, message: j.message}};
  }
};
// the Post button: on the Tally computer, or anywhere once the client's books are in the cloud
function canPostTally(co){
  if (Bridge.on() && Bridge.up()) return true;
  if (!co || typeof TCloud !== "object" || !TCloud.on()) return false;
  const s = TCloud.st[co.id];
  if (!s || !s.at){ TCloud.st[co.id] = {at: Date.now(), books: null}; TCloud.status(co.id, true).then(() => { if (TCloud.has(co.id)) render(); }, () => {}); return false; }
  return TCloud.has(co.id);
}
// a posting queued before this page was reloaded or closed: how it ended (it goes on in the cloud and on the Tally
// computer by itself). Post again for anything left: entries already in Tally are recognised and not posted twice
async function cloudPostLeftover(){
  let m = null; try { m = JSON.parse(lsGet("tdsdesk:cloudpost") || "null"); } catch (e){}
  if (!m || !m.id || typeof TCloud !== "object" || !TCloud.on()) return;
  try {
    const j = await CloudPost.row(m.id);
    if (!j){ if (Date.now() - (m.at || 0) > 7 * 86400000) lsDel("tdsdesk:cloudpost"); return; }
    if (["waiting", "taken", "running"].includes(j.status) || j.checking){ toast("An earlier posting to " + j.company + " is " + (j.status === "waiting" ? "still queued for the Tally computer" : "going on at the Tally computer: " + (j.done || 0) + " of " + j.n + " done") + "."); return; }
    lsDel("tdsdesk:cloudpost");
    const ok = [].concat(j.results || []).filter(r => r.ok).length;
    toast("The earlier posting to " + j.company + " finished: " + ok + " of " + j.n + " in Tally. Post again for any left; entries already in Tally are not sent twice.");
  } catch (e){}
}
setTimeout(() => { try { cloudPostLeftover(); } catch (e){} }, 9000);
// The postings queued in FinCom's cloud (tally_post_jobs), read from the server (review of 02-Oct-2026: "Everything sent
// to Tally" showed 0 although job b3785b05 had posted FA/ELEC/013, and job aebb6c15, failed at 01:53, was nowhere): the
// list of what went to Tally is made from them, with this browser's own log only for postings made here without the queue.
const CloudJobs = {
  list: null, at: 0, busy: false, err: "", tried: {}, dismissOk: true,
  async load(force){
    // read at most once a minute, also after a failure (the page draws again after each try); the list changes by itself
    // when FinCom's cloud says a posting changed (Live, migration-26)
    if (typeof TCloud !== "object" || !TCloud.on() || this.busy || (!force && Date.now() - this.at < 60000)) return;
    this.busy = true;
    try {
      const cols = "id,client_id,company,status,done,n,message,results,created_by,created_at,updated_at,attempts";
      // each entry's state (items) from migration-24 on; the entries' ids and dismissing from migration-26 on
      const more = [",items,entry_ids,dismissed_at,dismissed_by,dismiss_note,dismiss_auto", ",items", ""];
      for (let i = 0; ; i++){
        try { this.list = await TCloud.restAll("tally_post_jobs?select=" + cols + more[i] + "&order=created_at.desc"); this.dismissOk = i === 0; break; }
        catch (e){ if (i < more.length - 1 && /items|entry_ids|dismiss|column/i.test(String(e && e.message))) continue; throw e; }
      }
      this.err = ""; this.at = Date.now();
    } catch (e){ this.err = (e && e.message) || String(e); this.at = Date.now(); }
    this.busy = false;
    this.autoDismiss();
    // without the live connection, a posting still going is looked at again soon
    clearTimeout(this.soonT);
    if ((this.list || []).some(j => ["waiting", "taken", "running"].includes(j.status) || j.checking) && !(typeof Live === "object" && Live.postsLive))
      this.soonT = setTimeout(() => this.load(true), 15000);
    render();
  },
  // a change to a posting, from the live connection: read again (a burst of changes is read once)
  changed(){ clearTimeout(this.chT); this.chT = setTimeout(() => this.load(true), 800); },
  // Retry: the same posting again under its id; entries already in Tally are found by FinCom's tag, not posted twice
  async retry(j){
    try {
      const r = await TCloud.rpc("tally_post_enqueue", {p_id: j.id, p_client: j.client_id, p_payload: {}});
      if (!r || !r.ok) throw new Error((r && r.error) || "It could not be queued again.");
      toast("Queued again for the Tally computer.");
    } catch (e){ toast((e && e.message) || String(e)); }
    await this.load(true);
  },
  // Dismiss (request of 02-Oct-2026): a failed or cancelled posting off the list; kept on the server with who and when
  async dismiss(j, auto){
    try {
      const r = await TCloud.rpc("tally_post_dismiss", {p_id: j.id, p_auto: !!auto});
      if (!r || !r.ok) throw new Error(r && /Only a failed or cancelled/.test(r.error || "") ? "FinCom’s cloud can dismiss only failed postings until migration-27 is applied." : (r && r.error) || "It could not be dismissed.");
      if (!auto) toast("Dismissed. It stays under “Show older and dismissed”.");
    } catch (e){ if (!auto) toast((e && e.message) || String(e)); }
    await this.load(true);
  },
  async undismiss(j){
    try { await TCloud.rpc("tally_post_undismiss", {p_id: j.id}); } catch (e){ toast((e && e.message) || String(e)); }
    await this.load(true);
  },
  // a failed or cancelled posting whose every entry a later posting put in: dismissed by FinCom (the server checks it again)
  autoDismiss(){
    if (!this.dismissOk) return;
    (this.list || []).forEach(j => {
      if (!["failed", "cancelled"].includes(j.status) || j.dismissed_at || this.tried[j.id] || !this.postedLater(j)) return;
      this.tried[j.id] = true; this.dismiss(j, true);
    });
  },
  forClient(cid){ return (this.list || []).filter(j => !cid || j.client_id === cid); },
  idsOf(j){ return Array.isArray(j.entry_ids) ? j.entry_ids.map(String) : null; },
  // an entry this posting put in Tally, or found there already (bridge 2.1.4: "Already in Tally (voucher no. …)")
  okIn(j){ return new Set([].concat(j.results || []).filter(r => r && (r.ok || postAlready(r))).map(r => String(r.id))); },
  // when every entry of a posting went in through a later posting of the same client; null when one has not
  postedLater(j){
    const ids = this.idsOf(j);
    if (!ids || !ids.length) return null;
    const later = (this.list || []).filter(k => k.id !== j.id && k.client_id === j.client_id && k.created_at > j.created_at);
    let at = "";
    for (const id of ids){
      const k = later.filter(x => this.okIn(x).has(id)).sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))[0];
      if (!k) return null;
      if (String(k.updated_at || "") > at) at = k.updated_at;
    }
    return at || null;
  },
  // an entry of a posting already in Tally: put in by this posting or a later one, or known to be in Tally here (a bill,
  // or a bank line of the statement open)
  inTally(j, id){
    if (this.okIn(j).has(id)) return true;
    if ((this.list || []).some(k => k.client_id === j.client_id && k.id !== j.id && this.okIn(k).has(id))) return true;
    const d = S.data[j.client_id], e = d && d.entries && d.entries[id];
    if (e) return typeof billInTally === "function" && billInTally(e);
    const b = S.bank && S.bank.cid === j.client_id ? S.bank : null, r = b && (b.rows || []).find(x => x.id === id);
    return !!(r && (r.state === "sent" || r.state === "intally") && !r.goneFromTally);
  },
  // how many entries are still to be sent (null: not known, as before migration-26)
  leftToSend(j){
    const ids = this.idsOf(j);
    if (!ids) return null;
    return ids.filter(id => !this.inTally(j, id)).length;
  },
  // the queue's postings still going or stopped: waiting for the Tally computer, being posted, or failed
  open(cid){ return this.forClient(cid).filter(j => ["waiting", "taken", "running", "failed"].includes(j.status)); },
  // the list on Post to Tally: postings still going, failed or cancelled ones not dismissed with something left to send,
  // and the last 7 days of finished ones (all: everything, the dismissed and older ones too)
  view(cid, all){
    const week = Date.now() - 7 * 86400000;
    return this.forClient(cid).filter(j => {
      if (all) return true;
      if (["waiting", "taken", "running"].includes(j.status) || j.checking) return true;
      const stopped = ["failed", "cancelled"].includes(j.status);
      // dismissed by a person: off the list, whatever its state (request of 02-Oct-2026: finished postings too)
      if (j.dismissed_at && !j.dismiss_auto) return false;
      if (stopped && !j.dismissed_at && !this.postedLater(j) && this.leftToSend(j) !== 0) return true;
      return (Date.parse(j.updated_at || j.created_at) || 0) >= week;
    });
  },
  // review of 02-Oct-2026 (item 5): the postings of a client as people think of them. A failed or cancelled posting
  // whose every entry a later posting put in is one with that later posting ("Posted 07:51 (second try)", without the
  // old error); one still failed, not dismissed, with something left to send, needs a decision (Retry, Dismiss);
  // everything else is history, hidden behind "History (N)". Successful postings are never dismissed.
  stopped(j){ return ["failed", "cancelled"].includes(j.status); },
  live(j){ return ["waiting", "taken", "running"].includes(j.status) || !!j.checking; },
  // the later posting that put in every entry of a stopped one (the one that finished it), or null
  absorber(j){
    const ids = this.idsOf(j);
    if (!this.stopped(j) || !ids || !ids.length) return null;
    const later = (this.list || []).filter(k => k.id !== j.id && k.client_id === j.client_id && k.created_at > j.created_at && !this.stopped(k));
    let last = null;
    for (const id of ids){
      const k = later.filter(x => this.okIn(x).has(id)).sort((a, b) => String(a.updated_at || a.created_at).localeCompare(String(b.updated_at || b.created_at)))[0];
      if (!k) return null;
      if (!last || String(k.updated_at || k.created_at) > String(last.updated_at || last.created_at)) last = k;
    }
    return last;
  },
  needing(cid){
    return this.forClient(cid).filter(j => this.stopped(j) && !j.dismissed_at && !this.absorber(j) && this.leftToSend(j) !== 0);
  },
  // [{job, tries: [the stopped postings it absorbed], state: posted | partly | failed | cancelled | nothing, at}]: newest first
  history(cid){
    const jobs = this.forClient(cid), need = new Set(this.needing(cid).map(j => j.id)), by = new Map(), out = [];
    jobs.forEach(j => { const a = this.absorber(j); if (a){ if (!by.has(a.id)) by.set(a.id, []); by.get(a.id).push(j); } });
    jobs.forEach(j => {
      if (need.has(j.id) || this.live(j) || this.absorber(j)) return;
      const ok = this.okIn(j).size, n = num(j.n) || (this.idsOf(j) || []).length;
      const state = j.status === "done" ? (ok >= n || !n ? "posted" : "partly") : this.leftToSend(j) === 0 ? "nothing" : j.status;
      out.push({job: j, tries: (by.get(j.id) || []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))), state, ok, n, at: j.updated_at || j.created_at});
    });
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  },
  // one line a posted entry: what it was (the bill, bank line or sale named by its id), the voucher Tally made
  rows(cid){
    const out = [];
    this.forClient(cid).forEach(j => {
      [].concat(j.results || []).filter(r => r && r.ok && r.kind !== "master").forEach(r => {
        const e = (S.data[j.client_id] && S.data[j.client_id].entries[r.id]) || null;
        out.push({at: j.updated_at || j.created_at, job: j.id, co: j.client_id, what: e ? "bill" : r.kind === "voucher" ? "entry" : r.kind || "entry",
          ref: r.vchNumber || (e && e.x.invoiceNo) || "", party: e ? e.x.vendorName : "", amount: e ? num(e.x.total) : 0, verified: r.verified === true, already: !!r.alreadyThere,
          tally: {vchType: r.vchType || "", masterId: r.masterId || "", guid: r.guid || "", company: j.company, vchDate: r.vchDate || ""}, by: j.created_by || "", fromQueue: true});
      });
    });
    return out;
  }
};
// who queued a posting: the firm member's name or e-mail (the queue keeps their user id)
function memberName(uid){
  const m = ((typeof Cloud === "object" && Cloud.st && Cloud.st.members) || []).find(x => x.user_id === uid);
  return m ? (m.name || m.email || "—") : uid ? "a member of the firm" : "—";
}
// Bills marked as in Tally, checked against Tally's own entries in FinCom's cloud copy (review of 02-Oct-2026:
// FA/ELEC/013, posted on 29-Sep as voucher …66b4, was deleted in Tally afterwards and still counted as in Tally). A bill
// is taken as gone from Tally only when the cloud copy has read its date again after it was posted (the day is not among
// those still to be read) and its voucher is not there; found again, it counts again.
const TallyProof = {
  at: {},
  async check(cid, force){
    if (typeof TCloud !== "object" || !TCloud.on() || !TCloud.has(cid)) return 0;
    if (!force && Date.now() - (this.at[cid] || 0) < 5 * 60000) return 0;
    this.at[cid] = Date.now();
    const bk = TCloud.book(cid), st = (bk && bk.state) || {}, d = S.data[cid];
    if (!bk || !d || !d.loaded) return 0;
    const readAt = Date.parse(bk.daysAt || 0) || 0, doneTo = String(st.doneTo || ""), skipped = new Set([].concat(st.skipped || []));
    const list = Object.values(d.entries).filter(e => e.exportedAt && e.tally && e.tally.guid && (billInTally(e) || e.goneFromTally));
    if (!list.length) return 0;
    let found = new Set();
    for (let i = 0; i < list.length; i += 80){
      const g = list.slice(i, i + 80).map(e => '"' + String(e.tally.guid).replace(/"/g, "") + '"').join(",");
      const rows = await Cloud.api("tally_vouchers?select=guid,cancelled&book_id=eq." + encodeURIComponent(bk.book) + "&guid=in.(" + encodeURIComponent(g) + ")");
      (rows || []).forEach(r => { if (!r.cancelled) found.add(r.guid); });
    }
    let n = 0;
    list.forEach(e => {
      const day = String(e.tally.vchDate || "").replace(/-/g, ""), read = day && doneTo >= day && !skipped.has(day) && readAt > (Date.parse(e.tally.at || e.exportedAt) || 0);
      const gone = !found.has(e.tally.guid) && !!read;
      if (gone !== !!e.goneFromTally){ e.goneFromTally = gone ? new Date().toISOString() : null; if (!gone) delete e.goneFromTally; Store.saveEntry(cid, e); n++; }
    });
    if (n){ refreshStats(cid); render(); }
    return n;
  },
  // the same for bank lines: a line posted (its voucher's id) or found when reconciling (no id: a line of the account's
  // ledger on that day for that amount) that the cloud copy, having read the day again, no longer has
  bankAt: {},
  async checkBank(cid, force){
    const b = S.bank;
    if (!b || b.cid !== cid || typeof TCloud !== "object" || !TCloud.on() || !TCloud.has(cid)) return 0;
    if (!force && Date.now() - (this.bankAt[cid] || 0) < 5 * 60000) return 0;
    this.bankAt[cid] = Date.now();
    const bk = TCloud.book(cid), st = (bk && bk.state) || {}, readAt = Date.parse(bk.daysAt || 0) || 0, doneTo = String(st.doneTo || ""), skipped = new Set([].concat(st.skipped || []));
    const d8 = x => String(x || "").replace(/-/g, "").slice(0, 8);
    const read = (r, at) => { const day = d8(r.date); return day && doneTo >= day && !skipped.has(day) && readAt > (Date.parse(at || 0) || 0); };
    const rows = b.rows.filter(r => r.state === "sent" || r.state === "intally");
    if (!rows.length) return 0;
    const withId = rows.filter(r => r.tally && r.tally.guid), found = new Set();
    for (let i = 0; i < withId.length; i += 80){
      const g = withId.slice(i, i + 80).map(r => '"' + String(r.tally.guid).replace(/"/g, "") + '"').join(",");
      const got = await Cloud.api("tally_vouchers?select=guid,cancelled&book_id=eq." + encodeURIComponent(bk.book) + "&guid=in.(" + encodeURIComponent(g) + ")");
      (got || []).forEach(x => { if (!x.cancelled) found.add(x.guid); });
    }
    // no voucher id: the account's ledger on that day, for that amount
    const noId = rows.filter(r => !(r.tally && r.tally.guid)), lines = {};
    for (const day of Array.from(new Set(noId.map(r => d8(r.date)))).filter(Boolean)){
      lines[day] = await Cloud.api("tally_lines?select=ledger,amount&book_id=eq." + encodeURIComponent(bk.book) + "&day=eq." + Audit.iso(day)) || [];
    }
    const ledOf = r => { const s2 = (b.stmts || []).find(x => x.id === String(r.id || "").split("-")[0]) || {}; return ledNm(accountFor(s2).ledger || "").toLowerCase(); };
    let n = 0;
    rows.forEach(r => {
      let gone;
      if (r.tally && r.tally.guid) gone = !found.has(r.tally.guid) && read(r, r.tally.at || r.sentAt);
      else { const amt = r2(num(r.debit) || num(r.credit)), l = ledOf(r);
        // without the account's Tally ledger chosen there is nothing to look for: not called gone (review of 02-Oct-2026)
        gone = !!l && read(r, 0) && !(lines[d8(r.date)] || []).some(x => Math.abs(Math.abs(num(x.amount)) - amt) < 0.01 && ledNm(x.ledger).toLowerCase() === l); }
      if (!!gone !== !!r.goneFromTally){ if (gone) r.goneFromTally = new Date().toISOString(); else delete r.goneFromTally; n++; }
    });
    if (n){ saveBank({rows: true}); render(); }
    return n;
  }
};
// the bank lines no longer in Tally: back to "ready", to be posted again (Tally is checked for FinCom's tag first)
function bankRepostGone(){
  const b = B(), gone = b.rows.filter(r => r.goneFromTally);
  gone.forEach(r => { r.state = "ready"; r.tally = null; r.postVerified = false; r.postedVia = ""; r.sentAt = ""; r.tallyRef = ""; r.tallyHow = ""; delete r.goneFromTally; });
  saveBank({rows: true}); toast(gone.length + " line" + (gone.length === 1 ? " is" : "s are") + " ready to post again."); render();
}
