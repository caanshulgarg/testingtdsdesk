/* ================================================================== */
/* Zoho Books: a client's books read from Zoho, entries posted there   */
/* ================================================================== */
// The owner's decisions of 13-Oct-2026 ("Zoho first, then Busy"; FinCom both reads and posts). The zoho-books function
// (server/zoho-books) reads a linked Zoho organisation into the SAME cloud copy the Tally bridge fills (source 'zoho'),
// so TDS, GST, MIS, the due list and Look up open a Zoho client exactly as a Tally client (TCloud.load, BookSrc); and it
// posts FinCom's approved bills and bank entries into Zoho, with the safeguards of posting to Tally.
//   ZohoB.load()            the firm's Zoho sign-ins and organisations (zoho_status: never a token, a key or a hash)
//   ZohoB.connFor(cid)      the organisation linked to a client, or null
//   ZohoB.isZoho(co)        the client's books come from Zoho (its cloud book is a Zoho one)
//   ZohoB.connect()         the owner: Zoho's own approval page (India data centre); back on #/integrations/zoho?grant=
//   ZohoB.link(grant, org, cid), disconnect(conn), syncNow(conn), hookNew(conn)
//   ZohoB.post(co, payload, onProgress)    what Bridge.post hands over for a Zoho client: each voucher as Tally would get
//                           it (voucherPreview: date, number, reference, each ledger Dr / Cr), posted by the function as a
//                           Zoho bill, expense or journal; answered as Bridge.post answers ({results: [{id, ok, message}]})
const ZohoB = {
  st: {at: 0, busy: false, data: null, err: "", cfg: null, p: null},
  on(){ return typeof Cloud === "object" && Cloud.on() && !!(Cloud.st && Cloud.st.firm); },
  url(){ return String(Cloud.cfg().url || "").replace(/\/+$/, "") + "/functions/v1/zoho-books"; },
  owner(){ return !!(S.account && S.account.me && S.account.me.role === "owner"); },
  async call(body, retry){
    if (!retry) await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess();
    const r = await fetch(this.url(), {method: "POST", headers: {"Content-Type": "application/json", apikey: c.key, Authorization: "Bearer " + (s && s.access_token)}, body: JSON.stringify(body)});
    if (r.status === 401 && !retry){ await Cloud.refreshToken(s && s.access_token); return this.call(body, true); }
    let j = null; try { j = await r.json(); } catch (e){}
    if (!j) throw new Error("Zoho Books answered HTTP " + r.status + ".");
    return j;
  },
  // the firm's sign-ins and organisations, every 30 s at most unless asked
  load(force){
    if (!this.on()) return Promise.resolve(null);
    if (this.st.p && !force) return this.st.p;
    if (!force && Date.now() - this.st.at < 30000 && this.st.data) return Promise.resolve(this.st.data);
    this.st.busy = true;
    return this.st.p = Cloud.api("rpc/zoho_status", {method: "POST", body: {}}).then(d => { this.st.data = d || {grants: [], connections: []}; this.st.err = ""; },
      e => { const m = (e && e.message) || String(e); this.st.err = /zoho_status|does not exist|PGRST202|schema cache/i.test(m) ? "" : m; this.st.missing = /zoho_status|PGRST202|schema cache/i.test(m); this.st.data = this.st.data || {grants: [], connections: []}; })
      .then(() => { this.st.at = Date.now(); this.st.busy = false; this.st.p = null; return this.st.data; });
  },
  // is the function set up (the owner's Zoho client id and secret in place)? {configured, redirectUri, scopes}; never the values
  async config(force){
    if (this.st.cfg && !force) return this.st.cfg;
    try { this.st.cfg = await this.call({kind: "config"}); } catch (e){ this.st.cfg = {ok: false, configured: false, error: (e && e.message) || String(e)}; }
    return this.st.cfg;
  },
  conns(){ return ((this.st.data && this.st.data.connections) || []); },
  connFor(cid){ return this.conns().find(c => c.client === String(cid) && c.status !== "disconnected") || null; },
  // a client's books come from Zoho: its organisation is linked, or its cloud book is a Zoho one (named so by migration 75)
  isZoho(co){
    if (!co) return false;
    if (this.connFor(co.id)) return true;
    const bk = typeof TCloud === "object" && TCloud.book ? TCloud.book(co.id) : null;
    return !!(bk && /^Zoho Books · /.test(String(bk.company || "")));
  },
  // the firm's Integrations card: "Connected: 2 organisations" / "Not set up" / "Needs you"
  summary(){
    const cs = this.conns().filter(c => c.status !== "disconnected"), bad = cs.filter(c => c.status === "needs_sign_in" || c.error);
    if (!cs.length) return {state: this.st.cfg && this.st.cfg.configured === false ? "off" : "none", line: this.st.cfg && this.st.cfg.configured === false ? "Not set up" : "No organisation connected"};
    return {state: bad.length ? "warn" : "ok", line: "Connected: " + cs.length + " organisation" + (cs.length === 1 ? "" : "s") + (bad.length ? " · " + bad.length + " needs you" : "")};
  },
  async connect(){
    if (!this.owner()) { toast("Only the firm's owner can connect Zoho Books."); return; }
    const j = await this.call({kind: "connect_start", back: location.origin + location.pathname});
    if (!j.ok){ toast(j.error || "Zoho Books could not be started."); return; }
    location.href = j.url;
  },
  async link(grant, org, cid){
    const j = await this.call({kind: "link", grant, org, client: cid});
    if (!j.ok){ toast(j.error || "The organisation could not be linked."); return j; }
    await this.load(true);
    if (typeof TCloud === "object"){ TCloud.st[cid] = {}; try { await TCloud.status(cid, true); } catch (e){} }
    toast("Linked. " + ((j.first && j.first.counts && j.first.counts.entries) || 0) + " entries read from Zoho Books so far; the rest follow every few minutes.");
    render();
    return j;
  },
  async disconnect(c){
    if (!this.owner()) { toast("Only the firm's owner can disconnect Zoho Books."); return; }
    if (!(await askConfirm({title: "Disconnect " + (c.orgName || "this organisation") + "?", ok: "Disconnect",
      body: "<p>FinCom stops reading and posting to this Zoho organisation and gives up its access (the sign-in is revoked at Zoho). Nothing is deleted: the entries already read stay in FinCom, and nothing in Zoho is touched.</p>"}))) return;
    const j = await this.call({kind: "disconnect", connection: c.id});
    toast(j.ok ? (j.message || "Disconnected.") : (j.error || "Could not disconnect."));
    await this.load(true); render();
  },
  async syncNow(c){
    toast("Reading " + (c.orgName || "the organisation") + " from Zoho Books…");
    const j = await this.call({kind: "sync_now", connection: c.id});
    toast(j.ok ? "Read from Zoho Books: " + ((j.counts && j.counts.entries) || 0) + " entries new or changed." : (j.error || "The read stopped."));
    await this.load(true); render();
  },
  async hookNew(c){
    const j = await this.call({kind: "hook_new", connection: c.id});
    if (!j.ok){ toast(j.error || "Could not make the address."); return ""; }
    return j.url;
  },
  // ---------- posting: what Bridge.post would send to Tally, sent to Zoho instead
  async post(co, payload, onProgress){
    const vs = [].concat(payload.vouchers || []), ms = [].concat(payload.masters || []);
    const entries = vs.map(v => { const p = voucherPreview(v.xml); return {id: v.id, type: p.type, date: p.date, no: p.number, ref: p.ref, party: p.party, narration: p.narration,
      lines: p.lines.map(l => ({ledger: l.ledger, dr: !!l.dr, amount: l.amount}))}; });
    const masters = ms.map(m => { const p = masterPreview(m.xml); return p ? {id: m.id, name: p.name, group: p.group, gstin: p.gstin} : null; }).filter(Boolean);
    const ids = [].concat(ms, vs).map(x => x.id);
    try { onProgress && onProgress({done: 0, total: ids.length, message: "Posting to Zoho Books…"}); } catch (e){}
    let j;
    try { j = await this.call({kind: "post", client: co.id, entries, masters}); }
    catch (e){ j = {ok: false, error: "Zoho Books could not be reached: " + ((e && e.message) || e)}; }
    if (!j.ok) return {ok: true, company: "Zoho Books", viaZoho: true, results: ids.map(id => ({id, ok: false, message: j.error || "Not posted."}))};
    const got = new Map([].concat(j.results || []).map(x => [x.id, x]));
    return {ok: true, company: "Zoho Books", viaZoho: true, job: {id: j.job}, results: ids.map(id => got.get(id) || {id, ok: false, message: "Not posted."})};
  },
  // a person's words for the time Zoho's access token is good until (never the token)
  tokenWords(c){
    if (!c) return "";
    if (c.status === "needs_sign_in") return "Sign in to Zoho again (Reconnect)";
    if (c.status === "disconnected") return "Disconnected";
    return "Connected" + (c.tokenUntil ? " · token valid until " + fmtDateTime(c.tokenUntil) : "") + " (renewed by itself)";
  }
};
// the integrations a firm can use, one entry each (the Integrations page draws a card per entry; a new one is one line)
//   status(): {state: ok | warn | none | off | soon, line}
const INTEGRATIONS = [
  {id: "tally", name: "Tally (FinCom Bridge)", icon: "tally", page: "tally", status: () => typeof tallyIntegrationLine === "function" ? tallyIntegrationLine() : {state: "none", line: ""}},
  {id: "zoho", name: "Zoho Books", icon: "zoho", page: "zoho", status: () => ZohoB.summary()},
  {id: "busy", name: "Busy", icon: "busy", page: "", soon: true, status: () => ({state: "soon", line: "Coming soon"}), note: "Waiting on the route through a Busy partner."}
];
// the Tally card's line: "2 computers · 5 companies linked · 1 needs you" (the cloud's own lists, as the Tally page reads them)
function tallyIntegrationLine(){
  if (typeof TLight !== "object" || !TCloud.on()) return {state: "none", line: "Sign in to the firm account to see Tally"};
  try { TLight.refresh(); } catch (e){}
  const st = TLight.st || {}, devs = (st.devs || []).length, linked = (st.cos || []).filter(c => c.client_id).length;
  const need = Object.values(st.by || {}).filter(x => x && x.level === "bad").length;
  if (!st.loaded) return {state: "none", line: "Reading…"};
  if (!devs) return {state: "none", line: "No computer connected yet"};
  return {state: need ? "warn" : "ok", line: devs + " computer" + (devs === 1 ? "" : "s") + " · " + linked + " compan" + (linked === 1 ? "y" : "ies") + " linked" + (need ? " · " + need + " need" + (need === 1 ? "s" : "") + " you" : "")};
}
// which integration feeds a client's books, in words (Client setup's Books source card)
function booksSourceOf(co){
  if (!co) return {kind: "none"};
  const z = ZohoB.connFor(co.id);
  if (z) return {kind: "zoho", name: z.orgName || z.org, conn: z};
  const bk = typeof TCloud === "object" && TCloud.book ? TCloud.book(co.id) : null;
  if (bk && /^Zoho Books · /.test(String(bk.company || ""))) return {kind: "zoho", name: String(bk.company).replace(/^Zoho Books · /, ""), conn: null};
  const l = typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null;
  const company = (l && (l.company || l.name)) || (bk && bk.company) || "";
  return company ? {kind: "tally", name: company} : {kind: "none"};
}
function goIntegrations(page){ S.integPage = page || ""; navHome("integrations"); }
