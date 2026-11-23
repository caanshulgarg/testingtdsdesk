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
  conns(){ return ((this.st.data && this.st.data.connections) || []); },
  connFor(cid){ return this.conns().find(c => c.client === String(cid) && c.status !== "disconnected") || null; },
  // a client's books come from Zoho: its organisation is linked, or its cloud book is a Zoho one (named so by migration 75)
  isZoho(co){
    if (!co) return false;
    if (this.connFor(co.id)) return true;
    const bk = typeof TCloud === "object" && TCloud.book ? TCloud.book(co.id) : null;
    return !!(bk && /^Zoho Books · /.test(String(bk.company || "")));
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
};
function goIntegrations(page){ S.integPage = page || ""; navHome("integrations"); }
