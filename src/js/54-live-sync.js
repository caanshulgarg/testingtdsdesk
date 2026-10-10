/* ================================================================== */
/* Live sync: every change on every open computer at once            */
/* ================================================================== */
// Review of 01-Oct-2026 (branch server-books). Four TDS ledgers confirmed on one computer still showed the old state on
// another, even after a refresh, and changing them there said someone else had changed them first. The work of a
// client's books was one blob per client (client_books), sent 1.5 s after a change and fetched every 45 s; any two
// changes to the same client clashed. Now:
//   - BookItems: the work is kept item by item (client_book_items, migration-12): each ledger's mapping, each challan,
//     each 2B month... A change sends only its items, at once; the latest save of an item wins and nothing else is
//     touched, so confirming a TDS ledger never clashes with someone working on a bill or another ledger.
//   - On opening a client the server's items come first (only those changed since this computer last looked); this
//     browser's copy is a cache, never shown in place of a newer one.
//   - Live: one connection to Supabase Realtime per page; a change to the firm's items, bills, suppliers, settings or
//     clients by anyone reaches every open computer in a second or two and the screen is drawn again. Realtime checks
//     the same read policies as the database, so only the firm's own rows come.
//   - cloudSoon: every change on this computer (a bill, a setting, a bank line...) goes to the server at once, not on
//     the 45-second round; the top bar says Saving..., Saved 14:05, or that the computer is offline.
//   - A change by someone else is applied with a short note ("Updated by Rahul at 14:05"), never an error.
// Without migration-12 on the database the books are shared as before (BookSync, the blob).
const BookItems = {
  off: false,              // client_book_items not in the database: BookSync's blob as before
  st: {},                  // cid -> {seq, base: {itemKey: hash}, chain, timer, editAt, error}
  MAXI: 290,
  on(){ return !this.off && typeof BookSync === "object" && BookSync.on() && !BookSync.off; },
  ik(k, i){ return k + "\u0001" + i; },
  h(d, o){ return fpHash(stableStr(d === undefined ? null : d) + "|" + (o == null ? "" : o)); },
  missing(e){ return /client_book_items|save_book_items|PGRST202|PGRST205|schema cache|does not exist|404/i.test(String(e && e.message || e)); },
  // ---------- the work as items, and back
  // an object: an item for each of its keys (".name"); a list of things with ids: an item for each ("#id", in order);
  // anything else is one item. The item "" says which (the shape), so an empty object or list comes back as it was
  split(work){
    const out = new Map(), M = this.MAXI;
    Object.keys(work || {}).forEach(k => {
      const v = work[k];
      if (v === undefined) return;
      const isObj = v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(s => s.length < M);
      const ids = Array.isArray(v) && v.length && v.every(x => x && typeof x === "object" && typeof x.id === "string" && x.id && x.id.length < M) && new Set(v.map(x => x.id)).size === v.length;
      if (isObj){
        out.set(this.ik(k, ""), {k, i: "", d: {$t: "obj"}});
        Object.keys(v).forEach(s => { if (v[s] !== undefined) out.set(this.ik(k, "." + s), {k, i: "." + s, d: v[s]}); });
      } else if (ids){
        out.set(this.ik(k, ""), {k, i: "", d: {$t: "arr"}});
        v.forEach((x, n) => out.set(this.ik(k, "#" + x.id), {k, i: "#" + x.id, o: n, d: x}));
      } else out.set(this.ik(k, ""), {k, i: "", d: v});
    });
    return out;
  },
  join(items){
    const m = items.find(x => x.i === "");
    if (!m) return undefined;
    const t = m.d && typeof m.d === "object" && !Array.isArray(m.d) && Object.keys(m.d).length === 1 ? m.d.$t : null;
    if (t === "obj"){ const o = {}; items.forEach(x => { if (x.i[0] === ".") o[x.i.slice(1)] = x.d; }); return o; }
    if (t === "arr") return items.filter(x => x.i[0] === "#").sort((a, c) => (a.o || 0) - (c.o || 0)).map(x => x.d);
    return m.d;
  },
  // rows from the server into a books object: only the keys they touch are rebuilt
  put(b, rows){
    const by = {}, keys = BookSync.keys();
    rows.forEach(r => { if (keys.indexOf(r.k) >= 0) (by[r.k] = by[r.k] || []).push(r); });
    Object.keys(by).forEach(k => {
      const cur = this.split({[k]: b[k]});
      by[k].forEach(r => { const key = this.ik(k, r.i); if (r.del) cur.delete(key); else cur.set(key, {k, i: r.i, o: r.o, d: clone(r.d)}); });
      const v = this.join([...cur.values()]);
      if (v === undefined){ if (BookSync.MASTERS.indexOf(k) < 0) delete b[k]; } else b[k] = v;
    });
    return Object.keys(by);
  },
  // ---------- what this computer last agreed with the server, item by item
  async state(cid){
    let s = this.st[cid];
    if (s && s.ready) return s;
    s = this.st[cid] = s || {seq: 0, base: {}, chain: Promise.resolve()};
    try { const m = await IDBStore.get("bookitems:" + cid); if (m){ s.seq = m.seq || 0; s.base = m.base || {}; } } catch (e){}
    s.ready = true;
    return s;
  },
  async keep(cid){ const s = this.st[cid]; try { await IDBStore.write([["bookitems:" + cid, {seq: s.seq, base: s.base, at: new Date().toISOString()}]]); } catch (e){} },
  // one thing at a time for a client: fetching, sending and live changes are not interleaved
  queue(cid, fn){ const s = this.st[cid] || (this.st[cid] = {seq: 0, base: {}, chain: Promise.resolve()}); const p = s.chain.then(fn, fn); s.chain = p.catch(() => {}); return p; },
  // ---------- from the server
  async fetch(cid, after){
    let out = [];
    for (;;){
      const rows = await Cloud.api("client_book_items?select=key,item,ord,data,deleted,seq,updated_at,updated_by&client_id=eq." + encodeURIComponent(cid) + "&seq=gt." + after + "&order=seq.asc&limit=1000") || [];
      out = out.concat(rows);
      if (rows.length < 1000) return out;
      after = rows[rows.length - 1].seq;
    }
  },
  // on opening a client (and after being offline): what changed on the server since this computer last looked
  pull(cid){ return this.queue(cid, () => this.pullNow(cid)); },
  async pullNow(cid){
    const s = await this.state(cid);
    let rows;
    try { rows = await this.fetch(cid, s.seq); Live.ok(); }
    catch (e){ if (this.missing(e)){ this.off = true; return "off"; } Live.fail(e); s.error = e.message; throw e; }
    s.error = "";
    if (!s.seq && !rows.length && !Object.keys(s.base).length) await this.fromBlob(cid);
    const first = !s.seq;
    await this.take(cid, rows, {first, cursor: true});
    await this.pushNow(cid);
    return "ok";
  },
  // rows from the server (fetched, or live): applied unless this computer changed the same item later
  async take(cid, rows, o){
    const s = await this.state(cid), me = Live.me();
    const work = (await BookSync.localWork(cid)) || {}, mine = this.split(work), use = [], notes = [];
    rows.forEach(r => {
      const key = this.ik(r.key, r.item), hNew = r.deleted ? "gone" : this.h(r.data, r.ord);
      if (o.cursor) s.seq = Math.max(s.seq, num(r.seq));
      if (s.base[key] === hNew) return;                                       // known already (this computer's own save, come back)
      const loc = mine.get(key), hLoc = loc ? this.h(loc.d, loc.o) : "gone";
      const changedHere = hLoc !== (s.base[key] || "gone");
      s.base[key] = hNew;
      if (hLoc === hNew) return;
      // changed here too and not sent yet: the later change stays (it is sent next)
      if (changedHere && s.editAt && s.editAt > Date.parse(r.updated_at || 0)) return;
      use.push({k: r.key, i: r.item, o: r.ord, d: r.data, del: !!r.deleted});
      if (!o.first && r.updated_by && r.updated_by !== me) notes.push(r);
    });
    if (use.length) await this.into(cid, use);
    await this.keep(cid);
    if (notes.length) Live.noteItems(cid, notes);
    return use.length;
  },
  async into(cid, use){
    if (S.books && S.books.cid === cid){
      const keys = this.put(S.books, use);
      if (keys.indexOf("map") >= 0 || keys.indexOf("ledInfo") >= 0){ S.books.mapV = (S.books.mapV || 0) + 1; S.books.reco = null; try { if ((S.books.vouchers || []).length) LedMaster.refresh(S.books); } catch (e){} }
      LK.cache = {};
      await saveBooks({fromCloud: true});
      render();
    } else {
      const saved = (await Books.load(cid)) || {cid};
      this.put(saved, use);
      await Books.save(cid, saved);
    }
  },
  // the first time a client's work comes to the items: what was kept in the blob (client_books), merged with this
  // browser's copy as BookSync did, then sent as items. client_books stays as it was
  async fromBlob(cid){
    let row = null;
    try { row = await BookSync.fetch(cid); } catch (e){ row = null; }
    if (!row || !row.data) return;
    const sb = await BookSync.loadBase(cid), mine = (await BookSync.localWork(cid)) || {}, clash = [];
    const merged = sb.rev === 0 && !Object.keys(sb.base || {}).length && !Object.keys(mine).length ? row.data : BookSync.merge(sb.base || {}, mine, row.data, [], clash);
    await BookSync.keepBase(cid, row.rev, row.data);
    await BookSync.apply(cid, merged);
  },
  // ---------- to the server: the items changed since this computer last agreed with it
  schedule(cid){
    const s = this.st[cid] || (this.st[cid] = {seq: 0, base: {}, chain: Promise.resolve()});
    s.editAt = Date.now();
    Live.saving();
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { s.timer = null; this.push(cid).catch(() => {}); }, 300);
  },
  push(cid){ return this.queue(cid, () => this.pushNow(cid)); },
  async pushNow(cid){
    const s = await this.state(cid);
    if (BookSync.of(cid).readonly) return 0;
    const work = await BookSync.localWork(cid);
    if (!work) return 0;
    const mine = this.split(work), send = [], present = new Set(Object.keys(work));
    mine.forEach((x, key) => { const hh = this.h(x.d, x.o); if (s.base[key] !== hh) send.push([key, hh, {k: x.k, i: x.i, o: x.o, d: x.d}]); });
    // an item is removed on the server only when its part of the books is here and the item was taken out of it; a part
    // missing here (storage cleared, not loaded yet) is never sent as removed, and neither is most of a part at once
    // (review of 02-Oct-2026: never infer a removal from absence)
    const out = {}, had = {};
    Object.keys(s.base).forEach(key => { if (s.base[key] === "gone") return; const k = key.split("\u0001")[0]; had[k] = (had[k] || 0) + 1; if (!mine.has(key)) (out[k] = out[k] || []).push(key); });
    Object.entries(out).forEach(([k, keys]) => {
      if (!present.has(k)) return;
      const left = had[k] - keys.length;
      if (keys.length > 3 && keys.length > had[k] * 0.25 && !(this.allowMass && this.allowMass[cid + "|" + k])){
        s.held = Object.assign({}, s.held, {[k]: {n: keys.length, of: had[k], at: new Date().toISOString()}});
        console.warn("FinCom: " + keys.length + " of " + had[k] + " items of " + k + " missing here; not removed on the server" + (left ? "" : " (none left)"));
        return;
      }
      keys.forEach(key => send.push([key, "gone", {k, i: key.split("\u0001")[1], del: true}]));
    });
    if (!send.length){ Live.saved(); return 0; }
    Live.saving();
    try {
      for (let at = 0; at < send.length;){
        // up to 400 items or about 2 MB a call
        let size = 0, end = at;
        while (end < send.length && end - at < 400 && (end === at || size < 2e6)){ size += JSON.stringify(send[end][2]).length; end++; }
        const part = send.slice(at, end);
        const res = await Cloud.api("rpc/save_book_items", {method: "POST", body: {p_client: cid, p_items: part.map(x => x[2])}});
        if (!res || !res.ok) throw new Error("The server did not take the change.");
        part.forEach(x => { s.base[x[0]] = x[1]; });
        at = end;
      }
      s.error = ""; await this.keep(cid); Live.saved();
    } catch (e){
      if (this.missing(e)){ this.off = true; BookSync.schedule(cid); return 0; }
      if (/not allowed|42501|permission/i.test(e.message)){ BookSync.of(cid).readonly = true; Live.saved(); return 0; }
      s.error = e.message; Live.fail(e); await this.keep(cid);
    }
    return send.length;
  },
  // a change arriving live: for the client open here; others are brought in when they are opened
  remote(r){
    const cid = r.client_id;
    if (!cid || !S.books || S.books.cid !== cid || S.books.loading) return;
    this.queue(cid, () => this.take(cid, [r], {first: false, cursor: false}));
  },
  // anything not sent yet (after being offline)
  async flush(){ for (const cid of Object.keys(this.st)) if (this.st[cid].error || this.st[cid].timer) await this.push(cid).catch(() => {}); },
  // what the screen says of this client's work
  note(cid){
    const s = this.st[cid] || {};
    if (Live.sv.state === "offline") return {t: "Offline: changes are kept on this computer and sent when it is back online.", cls: "warn"};
    if (s.error) return {t: "Not saved to the server yet (" + s.error + "). It is kept on this computer and sent again on its own.", cls: "warn"};
    if (s.timer || Live.sv.state === "saving") return {t: "Saving…"};
    return Live.sv.at ? {t: "Saved " + fmtTime(Live.sv.at) + (Live.st === "live" ? " · changes by others appear here at once" : "")} : null;
  }
};

/* ---------- Supabase Realtime: one connection a page (the Phoenix protocol, version 1) ---------- */
const Live = {
  ws: null, st: "off", ref: 0, joinRef: "", topic: "", token: "", wait: 1000, hb: null, rt: null, err: "", stopped: false,
  sv: {state: "", at: 0, pending: 0},     // Saving..., Saved, offline
  notes: [],
  me(){ const s = (typeof Cloud === "object" && Cloud.sess()) || {}; return s.user_id || Cloud.st.me || ""; },
  on(){ return typeof Cloud === "object" && Cloud.on() && !!Cloud.st.firm && !Cloud.st.mfa; },
  url(){ const c = Cloud.cfg(); return c.url.replace(/^http/, "ws").replace(/\/+$/, "") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(c.key) + "&vsn=1.0.0"; },
  start(){
    this.stopped = false;
    if (!this.on() || this.ws || typeof WebSocket !== "function") return;
    let ws;
    try { ws = new WebSocket(this.url()); } catch (e){ this.later(); return; }
    this.ws = ws; this.st = "connecting";
    ws.onopen = () => { this.join(); clearInterval(this.hb); this.hb = setInterval(() => { this.send("phoenix", "heartbeat", {}); this.tokenTick(); }, 25000); };
    ws.onmessage = ev => { let m = null; try { m = JSON.parse(ev.data); } catch (e){} if (m) this.got(m); };
    ws.onclose = () => { clearInterval(this.hb); if (this.ws === ws) this.ws = null; this.st = "off"; this.jobsTopic = ""; this.jobsLive = false; this.booksTopic = ""; this.booksLive = false; this.postsTopic = ""; this.postsLive = false; this.tallyTopic = ""; this.recorderTopic = ""; this.recorderLive = false; this.copyTopic = ""; this.copyLive = false; this.top(); if (!this.stopped) this.later(); };
    ws.onerror = () => { try { ws.close(); } catch (e){} };
  },
  stop(){ this.stopped = true; clearTimeout(this.rt); clearInterval(this.hb); const w = this.ws; this.ws = null; this.st = "off"; try { if (w) w.close(); } catch (e){} },
  later(){ clearTimeout(this.rt); if (!this.on() || this.stopped) return; this.rt = setTimeout(() => this.start(), this.wait); this.wait = Math.min(30000, this.wait * 2); },
  send(topic, event, payload){ if (!this.ws || this.ws.readyState !== 1) return ""; const ref = String(++this.ref); this.ws.send(JSON.stringify({topic, event, payload, ref, join_ref: this.joinRef || null})); return ref; },
  async join(){
    await Cloud.fresh().catch(() => {});
    const f = Cloud.st.firm, s = Cloud.sess() || {};
    this.topic = "realtime:fincom-" + f; this.token = s.access_token || "";
    const pc = ["client_book_items", "records", "clients"].map(t => ({event: "*", schema: "public", table: t, filter: "firm_id=eq." + f}));
    this.joinRef = String(this.ref + 1);
    this.send(this.topic, "phx_join", {config: {broadcast: {self: false, ack: false}, presence: {key: ""}, postgres_changes: pc, private: false}, access_token: this.token});
  },
  // a new access token (refreshed every hour) is given to the open connection
  tokenTick(){ const t = (Cloud.sess() || {}).access_token; if (this.st === "live" && t && t !== this.token){ this.token = t; this.send(this.topic, "access_token", {access_token: t}); if (this.jobsTopic) this.send(this.jobsTopic, "access_token", {access_token: t}); if (this.booksTopic) this.send(this.booksTopic, "access_token", {access_token: t}); if (this.postsTopic) this.send(this.postsTopic, "access_token", {access_token: t}); if (this.recorderTopic) this.send(this.recorderTopic, "access_token", {access_token: t}); if (this.copyTopic) this.send(this.copyTopic, "access_token", {access_token: t}); } },
  // fast-sync: the server's jobs (a day book being read, the kept day books read again) on a channel of their own, joined
  // only when the database has tally_jobs (migration-13): the live sync above never depends on it
  async joinJobs(){
    if (typeof TCloud !== "object" || !TCloud.on() || this.jobsTopic) return;
    try { await Cloud.api("tally_jobs?select=id&limit=1"); } catch (e){ return; }
    const f = Cloud.st.firm; this.jobsTopic = "realtime:fincom-jobs-" + f; this.jobsRef = String(this.ref + 1);
    this.send(this.jobsTopic, "phx_join", {config: {broadcast: {self: false, ack: false}, presence: {key: ""}, postgres_changes: [{event: "*", schema: "public", table: "tally_jobs", filter: "firm_id=eq." + f}], private: false}, access_token: this.token});
  },
  // fast-sync (migration-15): the cloud copy of a client's books changed (the Tally computer sent new days): a page open
  // on that client brings them in at once, instead of looking once a minute. A channel of its own, so nothing else
  // depends on it
  joinBooks(){
    if (typeof TCloud !== "object" || !TCloud.on() || this.booksTopic) return;
    const f = Cloud.st.firm; this.booksTopic = "realtime:fincom-books-" + f; this.booksRef = String(this.ref + 1); this.daysAt = this.daysAt || {};
    this.send(this.booksTopic, "phx_join", {config: {broadcast: {self: false, ack: false}, presence: {key: ""}, postgres_changes: [{event: "UPDATE", schema: "public", table: "tally_books", filter: "firm_id=eq." + f}], private: false}, access_token: this.token});
  },
  // the postings in FinCom's cloud (migration-26: tally_post_jobs in Realtime): the list on Post to Tally is read again when
  // one changes, so it needs no Refresh. A channel of its own; without it the list is read again while a posting goes on
  joinPosts(){
    if (typeof TCloud !== "object" || !TCloud.on() || this.postsTopic) return;
    const f = Cloud.st.firm; this.postsTopic = "realtime:fincom-posts-" + f; this.postsRef = String(this.ref + 1);
    this.send(this.postsTopic, "phx_join", {config: {broadcast: {self: false, ack: false}, presence: {key: ""}, postgres_changes: [{event: "*", schema: "public", table: "tally_post_jobs", filter: "firm_id=eq." + f}], private: false}, access_token: this.token});
  },
  // phase 2 (migration 44): every change saved in Tally, as FinCom's cloud received it (tally_recorder_lines), for the Tally
  // page's Sync activity. A channel of its own, joined only when the database has the table (else the page says it is
  // not available until migration 44 runs and reads nothing live)
  async joinRecorder(){
    if (typeof TCloud !== "object" || !TCloud.on() || this.recorderTopic) return;
    try { await Cloud.api("tally_recorder_lines?select=id&limit=1"); } catch (e){ return; }
    const f = Cloud.st.firm; this.recorderTopic = "realtime:fincom-recorder-" + f; this.recorderRef = String(this.ref + 1);
    this.send(this.recorderTopic, "phx_join", {config: {broadcast: {self: false, ack: false}, presence: {key: ""}, postgres_changes: [{event: "*", schema: "public", table: "tally_recorder_lines", filter: "firm_id=eq." + f}], private: false}, access_token: this.token});
  },
  // next-realtime (migration 64): FinCom's copy of a client's books changed (tally_book_changes: one row per book, written
  // by the database once per transaction that changed the copy, never the copy's own rows), or what Sync activity reads
  // beside the recorder lines changed (tally_sync_cursor: the gap; tally_month_locks, tally_tieouts: the tie-out; tally_alerts).
  // A channel of its own, joined only when the database has tally_book_changes; each change goes to CopyLive, which
  // refreshes only the page on screen, once for a burst
  async joinCopy(){
    if (typeof TCloud !== "object" || !TCloud.on() || this.copyTopic) return;
    try { await Cloud.api("tally_book_changes?select=book_id&limit=1"); } catch (e){ return; }
    if (this.copyTopic || !this.ws) return;
    const f = Cloud.st.firm; this.copyTopic = "realtime:fincom-copy-" + f; this.copyRef = String(this.ref + 1);
    const pc = ["tally_book_changes", "tally_sync_cursor", "tally_month_locks", "tally_tieouts", "tally_alerts"].map(t => ({event: "*", schema: "public", table: t, filter: "firm_id=eq." + f}));
    this.send(this.copyTopic, "phx_join", {config: {broadcast: {self: false, ack: false}, presence: {key: ""}, postgres_changes: pc, private: false}, access_token: this.token});
  },
  // review of 02-Oct-2026 (item 7): a Tally computer's heartbeat with a new last read, a read going on, or Tally's state
  // changed, passed on at once by tally-ingest on the firm's broadcast channel (no table, no SQL): the Post page's
  // "read 17:43" / "Reading now…" changes without waiting for FinCom to look again
  joinTally(){
    if (typeof TCloud !== "object" || !TCloud.on() || this.tallyTopic) return;
    const f = Cloud.st.firm; this.tallyTopic = "realtime:fincom-tally-" + f;
    this.send(this.tallyTopic, "phx_join", {config: {broadcast: {self: false, ack: false}, presence: {key: ""}, private: false}, access_token: this.token});
  },
  bookChanged(r){
    // the Tally computer sent the ledgers again: the client's one ledger list is read again (Ledgers)
    try { if (typeof Ledgers === "object") Ledgers.bookRow(r); } catch (e){}
    if (!r || !r.client_id || !r.days_at || this.daysAt[r.book_id] === r.days_at) return;
    const first = !(r.book_id in this.daysAt); this.daysAt[r.book_id] = r.days_at;
    if (first && !S.books) return;
    const cid = r.client_id;
    if (!(S.books && S.books.cid === cid && !S.books.loading && S.coId === cid)) return;
    clearTimeout(this.bookT);
    this.bookT = setTimeout(() => { try { if (TCloud.st[cid]) TCloud.st[cid].at = 0; const f = LK.fr(); f.cat = 0; LK.cloudFresh(true, true); } catch (e){} }, 1500);   // the day's last pieces settle first
  },
  got(m){
    if (this.tallyTopic && m.topic === this.tallyTopic){
      if (m.event === "broadcast" && m.payload && m.payload.event === "beat" && typeof TLight === "object") TLight.beatIn(m.payload.payload);
      return;
    }
    if (this.copyTopic && m.topic === this.copyTopic){
      if (m.event === "phx_reply" && m.ref === this.copyRef) this.copyLive = !!(m.payload && m.payload.status === "ok");
      else if (m.event === "system" && m.payload && m.payload.status === "error") this.copyLive = false;
      else if (m.event === "postgres_changes"){ const d = m.payload && m.payload.data; if (d && typeof CopyLive === "object") CopyLive.in(d.table, d.record); }
      return;
    }
    if (this.recorderTopic && m.topic === this.recorderTopic){
      if (m.event === "phx_reply" && m.ref === this.recorderRef) this.recorderLive = !!(m.payload && m.payload.status === "ok");
      else if (m.event === "system" && m.payload && m.payload.status === "error") this.recorderLive = false;
      else if (m.event === "postgres_changes"){ const d = m.payload && m.payload.data; if (d && d.record && typeof Rec === "object") Rec.lineIn(d.record); }
      return;
    }
    if (this.postsTopic && m.topic === this.postsTopic){
      if (m.event === "phx_reply" && m.ref === this.postsRef) this.postsLive = !!(m.payload && m.payload.status === "ok");
      else if (m.event === "system" && m.payload && m.payload.status === "error") this.postsLive = false;
      else if (m.event === "postgres_changes" && typeof CloudJobs === "object") CloudJobs.changed();
      return;
    }
    if (this.booksTopic && m.topic === this.booksTopic){
      if (m.event === "phx_reply" && m.ref === this.booksRef) this.booksLive = !!(m.payload && m.payload.status === "ok");
      else if (m.event === "postgres_changes"){ const d = m.payload && m.payload.data; if (d && d.record) this.bookChanged(d.record); }
      return;
    }
    if (this.jobsTopic && m.topic === this.jobsTopic){
      if (m.event === "phx_reply" && m.ref === this.jobsRef) this.jobsLive = !!(m.payload && m.payload.status === "ok");
      else if (m.event === "postgres_changes"){ const d = m.payload && m.payload.data; if (d && d.record) TCloud.jobRow(d.record); }
      return;
    }
    if (m.event === "phx_reply" && m.ref === this.joinRef){
      if (m.payload && m.payload.status === "ok"){ this.st = "live"; this.err = ""; this.wait = 1000; this.catchUp(); this.joinJobs(); this.joinBooks(); this.joinPosts(); this.joinTally(); this.joinRecorder(); this.joinCopy(); }
      else { this.st = "error"; this.err = JSON.stringify((m.payload || {}).response || {}).slice(0, 200); }
      this.top(); return;
    }
    if (m.event === "system" && m.payload && m.payload.status === "error" && (!m.topic || m.topic === this.topic)){ this.st = "error"; this.err = String(m.payload.message || "").slice(0, 200); this.top(); return; }
    if (m.event === "postgres_changes"){ const d = m.payload && m.payload.data; if (d) this.change(d); return; }
    if (m.event === "phx_error" || m.event === "phx_close"){ try { this.ws.close(); } catch (e){} }
  },
  // (re)connected: what changed while the connection was down
  catchUp(){
    try { if (typeof cloudSync === "function" && !cloudBusy) cloudSync(false); } catch (e){}
    const cid = S.books && S.books.cid && !S.books.loading ? S.books.cid : null;
    if (cid && BookItems.on()) BookItems.pull(cid).catch(() => {});
    if (cid && typeof TCloud === "object" && TCloud.on()) TCloud.jobsLoad(cid);
  },
  change(d){
    const r = d.record;
    if (!r || (d.errors && d.errors.length)){ this.catchUp(); return; }      // too big to come live: fetched instead
    if (d.table === "client_book_items") BookItems.remote(r);
    else if (d.table === "records" || d.table === "clients") this.rec(d.table, r).catch(() => {});
  },
  async rec(table, r){
    const row = table === "clients" ? {kind: "client", id: r.id, client_id: r.id, data: r.data, deleted: r.deleted, updated_at: r.updated_at}
      : {kind: r.kind, id: r.id, client_id: r.client_id || "", data: r.data, deleted: r.deleted, updated_at: r.updated_at};
    if (!row.deleted && (row.data === undefined || row.data === null)){ this.catchUp(); return; }
    const before = row.kind === "entry" && S.data[row.client_id] && S.data[row.client_id].entries[row.id] ? stableStr(S.data[row.client_id].entries[row.id]) : null;
    this.applying = true;
    try { await cloudApply([row]); } finally { this.applying = false; }
    const changed = row.kind !== "entry" || before !== stableStr(row.data);
    if (changed && r.updated_by && r.updated_by !== this.me()) this.noteRec(row, r.updated_by, r.updated_at);
    render();
  },
  // ---------- notes: who changed what
  who(uid){ const m = ((Cloud.st && Cloud.st.members) || []).find(x => x.user_id === uid); return m ? (m.name || m.email) : "a colleague"; },
  when(at){ try { return fmtTime(at ? Date.parse(at) : Date.now()); } catch (e){ return ""; } },
  say(text){ this.notes = [{text, at: Date.now()}].concat(this.notes).slice(0, 8); toast(text); },
  noteItems(cid, rows){
    const by = {};
    rows.forEach(r => { (by[r.updated_by] = by[r.updated_by] || []).push(r); });
    Object.entries(by).forEach(([uid, rs]) => {
      const leds = rs.filter(r => r.key === "map" && r.item[0] === ".").map(r => r.item.slice(1));
      const what = leds.length ? (leds.length === 1 ? "ledger “" + leds[0] + "”" : leds.length + " ledgers") : "the TDS and GST work";
      this.say("Updated by " + this.who(uid) + " at " + this.when(rs[rs.length - 1].updated_at) + ": " + what + ".");
    });
  },
  noteRec(row, uid, at){
    const who = this.who(uid), t = this.when(at);
    if (row.kind === "entry"){ const e = row.data || {}; this.say("Updated by " + who + " at " + t + ": bill " + (e.billNo || e.invNo || e.party || e.vendor || "") + (e.status ? " (" + e.status + ")" : "") + "."); }
    else if (row.kind === "client"){ const c = row.data || {}; this.say("Updated by " + who + " at " + t + ": client setup of " + (c.name || "a client") + "."); }
    else if (row.kind === "firm") this.say("Updated by " + who + " at " + t + ": the firm’s settings.");
  },
  // ---------- Saving..., Saved, offline (the top bar and the books)
  saving(){ if (this.sv.state !== "saving"){ this.sv.state = "saving"; this.top(); } },
  saved(){ this.sv = {state: "saved", at: Date.now()}; this.top(); },
  ok(){ if (this.sv.state === "offline"){ this.sv.state = "saved"; this.top(); } },
  fail(e){
    const off = (typeof navigator === "object" && navigator.onLine === false) || /Failed to fetch|NetworkError|network|Load failed/i.test(String(e && e.message || e));
    this.sv = {state: off ? "offline" : "error", at: this.sv.at, err: String(e && e.message || e).slice(0, 160)}; this.top();
  },
  top(){ try { if (typeof renderTop === "function") renderTop(); else render(); } catch (e){} }
};

/* ---------- next-realtime: the pages that read FinCom's copy and Sync activity, refreshed by themselves ---------- */
// A change (Live.joinCopy) is noted, and after a quiet WAIT (1.5 s) - at most MAX (6 s) after the first of a burst - the
// pages on screen read again what they show, one refresh at a time (a change during one: one more after it). Never a page
// reload, never a read for a page not on screen (its data is only marked old, read when it is opened):
//   - Look up on that client: the answer from FinCom's copy asked again (and the copy's time);
//   - the ledgers on that client: the list read again from the copy when the ledgers or groups changed;
//   - Sync activity and the tie-out: the gap, the month locks and tie-outs, the alerts (the lines come in live already).
const CopyLive = {
  WAIT: 1500, MAX: 6000,
  books: new Map(),        // client id -> the copy's tables changed
  sync: new Set(),         // Sync activity's tables changed
  t: null, first: 0, busy: false, again: false, runs: 0, events: 0,
  in(table, r){
    if (!r || typeof r !== "object") return;
    this.events++;
    if (table === "tally_book_changes"){
      if (!r.client_id) return;
      const k = String(r.client_id), had = this.books.get(k) || new Set();
      [].concat(r.tables || []).forEach(t => had.add(String(t)));
      this.books.set(k, had);
    } else this.sync.add(String(table));
    this.soon();
  },
  soon(){
    const now = Date.now();
    if (!this.first) this.first = now;
    clearTimeout(this.t);
    this.t = setTimeout(() => this.flush(), Math.max(0, Math.min(this.WAIT, this.first + this.MAX - now)));
  },
  async flush(){
    this.t = null; this.first = 0;
    if (this.busy){ this.again = true; return; }
    const books = new Map(this.books), sync = new Set(this.sync);
    this.books.clear(); this.sync.clear();
    if (!books.size && !sync.size) return;
    this.busy = true; this.runs++;
    try { await this.apply(books, sync); } catch (e){}
    this.busy = false;
    if (this.again){ this.again = false; if (this.books.size || this.sync.size) this.soon(); }
  },
  onClient(cid){ return S.view === "company" && S.coId === cid; },
  async apply(books, sync){
    let draw = false;
    for (const [cid, tables] of books){
      try { if (typeof TCloud === "object" && TCloud.st[cid]) TCloud.st[cid].at = 0; } catch (e){}
      if (!this.onClient(cid) || S.tab !== "books") continue;
      const leds = !tables.size || tables.has("tally_ledgers") || tables.has("tally_groups");
      if (S.booksTab === "lookup" && typeof LK === "object"){
        const x = LK.st();
        try { await TCloud.status(cid, true); } catch (e){}
        if (x.res && x.res.src === "cloud" && !x.busy) await LK.run("tally");     // it draws the page itself
        else draw = true;
      } else if (S.booksTab === "ledgers" && typeof Ledgers === "object"){
        if (leds) await Ledgers.load(cid, {fresh: true});
        try { delete Ledgers.hist[cid]; } catch (e){}
        draw = true;
      }
    }
    if (typeof Rec === "object"){
      if (sync.has("tally_sync_cursor") && Rec.gaps && Rec.gaps.at){ await Rec.gapsLoad(); }
      if ((sync.has("tally_month_locks") || sync.has("tally_tieouts")) && Rec.tie){ for (const cid of Object.keys(Rec.tie)) await Rec.tieLoad(cid); }
      if (sync.has("tally_alerts") && Rec.alerts && Rec.alerts.at && !Rec.alerts.none){ await Rec.alertsLoad(); }
    }
    if (draw) render();
  }
};

/* ---------- every change on this computer goes to the server at once ---------- */
let cloudSoonT = null;
function cloudSoon(){
  if (Live.applying || typeof Cloud !== "object" || !Cloud.on() || !Cloud.st.firm || Cloud.st.mfa || Cloud.cfg().auto === false) return;
  Live.saving();
  clearTimeout(cloudSoonT);
  cloudSoonT = setTimeout(cloudPushNow, 400);
}
async function cloudPushNow(){
  if (cloudBusy){ clearTimeout(cloudSoonT); cloudSoonT = setTimeout(cloudPushNow, 300); return; }
  cloudBusy = true;
  try { await cloudPush(); Cloud.st.pending = 0; Cloud.st.error = ""; Live.saved(); }
  catch (e){ Live.fail(e); Cloud.st.pending = (cloudChanges().changes || []).length; }
  cloudBusy = false;
}
if (typeof window === "object"){
  window.addEventListener("online", () => { try { Live.ok(); cloudSoon(); BookItems.flush(); if (!Live.ws) Live.start(); } catch (e){} });
  window.addEventListener("offline", () => { try { Live.fail(new Error("offline")); } catch (e){} });
  // a safety net: anything not sent (offline, an error) is tried again every 20 seconds
  setInterval(() => { try { if (Live.sv.state === "offline" || Live.sv.state === "error"){ cloudSoon(); BookItems.flush(); } } catch (e){} }, 20000);
}
