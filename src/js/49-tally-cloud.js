/* ================================================================== */
/* The books in FinCom's cloud: kept in step by the bridge            */
/* ================================================================== */
// The bridge on a computer with Tally sends each linked company's day book (the days that changed), its ledgers and
// the copy's state to the cloud (server/tally-cloud). From there:
//   - the books load into FinCom on any computer, with Tally closed: only the days that changed since last time are
//     downloaded, the rest come from this browser's own store (IndexedDB, "tcday:<book>:<day>");
//   - a large company (more than TCloud.BIG entries) is not loaded at all: the trial balance and ledgers are asked of
//     the cloud's ready totals and come back in a moment, fit for a phone;
//   - the computer with Tally connects itself (TCloud.auto); Settings, Books in the cloud: the computers that send (remove one) and which Tally company is
//     which client.
const TCloud = {
  BIG: 60000,
  st: {},                 // cid -> {books, at, err}
  pane: {devices: null, companies: null, busy: "", err: "", at: 0},
  on(){ return typeof Cloud === "object" && Cloud.on() && !!(Cloud.st && Cloud.st.firm); },
  ingestUrl(){ return Cloud.cfg().url.replace(/\/+$/, "") + "/functions/v1/tally-ingest"; },
  iso(d8){ return String(d8).slice(0, 4) + "-" + String(d8).slice(4, 6) + "-" + String(d8).slice(6, 8); },
  d8(iso){ return String(iso || "").replace(/-/g, "").slice(0, 8); },
  rpc(fn, args, q){ return Cloud.api("rpc/" + fn + (q || ""), {method: "POST", body: args || {}}); },
  // a list function, a thousand rows at a time (the database gives at most that many in one answer)
  async rpcAll(fn, args){
    let out = [], off = 0;
    for (;;){
      const page = await this.rpc(fn, args, "?limit=1000&offset=" + off) || [];
      out = out.concat(page);
      if (page.length < 1000) return out;
      off += 1000;
    }
  },
  async restAll(path){
    let out = [], off = 0;
    for (;;){
      const page = await Cloud.api(path + "&limit=1000&offset=" + off) || [];
      out = out.concat(page);
      if (page.length < 1000) return out;
      off += 1000;
    }
  },
  // the client's books in the cloud (one per Tally company; the latest first)
  async status(cid, force){
    const s = this.st[cid] = this.st[cid] || {};
    if (!this.on()) return null;
    if (!force && s.books && Date.now() - s.at < 30000) return s.books;
    try { s.books = await this.rpc("tally_status", {p_client: cid}) || []; s.err = ""; }
    catch (e){ s.books = s.books || []; s.err = (e && e.message) || String(e); if (/tally_status|does not exist|schema cache/i.test(s.err)) s.books = []; }
    s.at = Date.now();
    return s.books;
  },
  book(cid){ const s = this.st[cid]; return s && s.books && s.books.find(b => b.from) || null; },
  has(cid){ return !!this.book(cid); },
  big(cid){ const b = this.book(cid); return !!(b && b.entries > this.BIG); },
  // ---------- answers from the cloud's ready totals
  async tb(cid, asOn){
    const rows = await this.rpcAll("tally_tb", {p_client: cid, p_as_on: this.iso(asOn)});
    const bk = this.book(cid) || {};
    const out = rows.filter(r => Math.abs(num(r.closing)) >= 0.005).map(r => ({l: r.ledger, top: this.top(r.ledger, rows), sub: r.parent || "", bal: -r2(num(r.closing))}));
    return LK.tbShape({kind: "tb", src: "cloud", asOn, rows: out, note: "From the copy in FinCom's cloud (" + (bk.company || "") + "), " + this.age(bk) + "."});
  },
  // the top group of a ledger, from the groups FinCom knows, else the ledger's own group
  top(l, rows){ try { const t = FC.top(l); if (t) return t; } catch (e){} const r = rows.find(x => x.ledger === l); return (r && r.parent) || "Other"; },
  async ledger(cid, led, from, to){
    const j = await this.rpc("tally_ledger", {p_client: cid, p_ledger: led, p_from: this.iso(from), p_to: this.iso(to)});
    if (!j || j.none) throw new Error("The cloud has no copy of these books yet.");
    const open = -r2(num(j.open));
    let run = open, dr = 0, cr = 0;
    const rows = [].concat(j.lines || []).map(([d, type, no, party, narr, a, guid]) => {
      a = num(a); const dd = a < 0 ? -a : 0, c = a > 0 ? a : 0;
      dr = r2(dr + dd); cr = r2(cr + c); run = r2(run + dd - c);
      return {id: guid, date: d, type, no, part: party && party !== led ? party : "", narr: narr || "", dr: dd, cr: c, run};
    });
    const ends = j.to && this.d8(j.to) < to ? " This copy (" + (j.company || "") + ") has entries up to " + FC.when(this.d8(j.to)) + "; a later year kept as another company in Tally is asked separately." : "";
    return {kind: "ledger", src: "cloud", led, from, to, open, close: run, dr, cr, rows, note: "From the books (" + (j.company || "") + "), " + this.age(this.book(cid)) + "." + ends};
  },
  // build 192: a group, month by month, and any entry: worked out by the cloud, not from books loaded here
  inG(l, parent, grp){ try { if (FC.inGroup(l, grp)) return true; } catch (e){} return String(parent || "").toLowerCase() === String(grp || "").toLowerCase(); },
  async period(cid, from, to){ return await this.rpcAll("tally_period", {p_client: cid, p_from: this.iso(from), p_to: this.iso(to)}) || []; },
  async group(cid, grp, from, to){
    const all = await this.period(cid, from, to), bk = this.book(cid) || {};
    const rows = all.filter(r => this.inG(r.ledger, r.parent, grp)).map(r => { const op = -r2(num(r.open)), dr = r2(num(r.dr)), cr = r2(num(r.cr)); return {l: r.ledger, sub: r.parent || "", open: op, dr, cr, close: r2(op + dr - cr)}; })
      .filter(r => r.dr || r.cr || (r.open && Math.abs(r.open) >= 0.5)).sort((a, c) => Math.abs(c.close) - Math.abs(a.close) || a.l.localeCompare(c.l));
    const sum = k => r2(rows.reduce((t, r) => t + (r[k] || 0), 0));
    return {kind: "group", src: "cloud", grp, from, to, rows, open: sum("open"), dr: sum("dr"), cr: sum("cr"), close: sum("close"), note: "From the books (" + (bk.company || "") + "), " + this.age(bk) + "."};
  },
  async monthly(cid, led, grp, from, to){
    const [per, mon] = await Promise.all([this.period(cid, from, to), this.rpcAll("tally_monthly", {p_client: cid, p_from: this.iso(from), p_to: this.iso(to)})]);
    const set = new Set(per.filter(r => led ? r.ledger === led : this.inG(r.ledger, r.parent, grp)).map(r => r.ledger));
    const months = MIS.monthsOf(from, to), m = {};
    months.forEach(k => { m[k] = {dr: 0, cr: 0}; });
    (mon || []).forEach(r => { const x = m[r.ym]; if (x && set.has(r.ledger)){ x.dr = r2(x.dr + num(r.dr)); x.cr = r2(x.cr + num(r.cr)); } });
    let run = -r2(per.filter(r => set.has(r.ledger)).reduce((t, r) => t + num(r.open), 0));
    const open = run, bk = this.book(cid) || {};
    const rows = months.map(k => { const x = m[k]; run = r2(run + x.dr - x.cr); return {ym: k, dr: x.dr, cr: x.cr, net: r2(x.dr - x.cr), close: run}; });
    return {kind: "monthly", src: "cloud", led, grp, from, to, open, rows, dr: r2(rows.reduce((t, r) => t + r.dr, 0)), cr: r2(rows.reduce((t, r) => t + r.cr, 0)), note: "From the books (" + (bk.company || "") + "), " + this.age(bk) + "."};
  },
  FIND_PAGE: 500,
  async find(cid, q, from, to, typ, had){
    const j = await this.rpc("tally_find", {p_client: cid, p_q: q || "", p_from: this.iso(from), p_to: this.iso(to), p_type: typ || null, p_limit: this.FIND_PAGE, p_offset: had ? had.rows.length : 0});
    if (!j || j.none) throw new Error("The cloud has no copy of these books yet.");
    const rows = [].concat(j.rows || []).map(([d, type, no, party, narr, amt, guid, ent]) => {
      const e = [].concat(ent || []).map(([l, a]) => ({l, a: num(a)}));
      return {id: guid, date: d, type, no, party: party || (e.find(x => x.a < 0) || {}).l || "", narr: narr || "", amt: r2(num(amt)), ent: e};
    });
    return {kind: "find", src: "cloud", q, from, to, typ, rows: (had ? had.rows : []).concat(rows), n: num(j.n), total: r2(num(j.total))};
  },
  age(bk){
    if (!bk) return "";
    const st = bk.state || {}, at = String(st.seen || bk.stateAt || bk.daysAt || "");
    return at ? "in step with Tally as of " + at.replace("T", " ").slice(0, 16) : "not updated yet";
  },
  // ---------- one day's day book, from this browser's store or the cloud
  async day(bk, d, at){
    const k = "tcday:" + bk + ":" + d;
    try { const c = await IDBStore.get(k); if (c && c.at === at) return c.text; } catch (e){}
    const c = Cloud.cfg(), s = Cloud.sess();
    const url = c.url.replace(/\/+$/, "") + "/storage/v1/object/authenticated/tally-days/" + Cloud.st.firm + "/" + bk + "/" + d.slice(0, 6) + "/" + d + ".xml.gz";
    let r = await fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + s.access_token}, cache: "no-store"});
    if (r.status === 401 || r.status === 400){ await Cloud.refreshToken(); r = await fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token}, cache: "no-store"}); }
    if (r.status === 404) return "";
    if (!r.ok) throw new Error("Could not fetch " + d + " from the cloud (" + r.status + ").");
    const text = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
    try { await IDBStore.write([[k, {at, text}]]); } catch (e){}
    return text;
  },
  // ---------- bring the cloud's copy into FinCom: only the months with a day that changed
  async load(force){
    const co = CO(), b = S.books;
    if (!co || !b || b.cid !== co.id || !this.on()) return false;
    const books = await this.status(co.id, force) || [];
    const bk = books.find(x => x.from);
    if (!bk) return false;
    const f = LK.fr();
    if (bk.entries > this.BIG){
      // answered from the cloud's totals, not loaded here; only the ledgers and their groups, for choosing and grouping
      const m0 = b.meta = b.meta || {};
      if (!(m0.cloud && m0.cloud.book === bk.book && m0.cloud.big && m0.cloud.ledgersAt === bk.ledgersAt)){
        const led = await this.restAll("tally_ledgers?select=name,parent,open&order=name&book_id=eq." + bk.book);
        b.vouchers = []; TallyRead.balances(b, {ledgers: led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, this.d8(bk.from), Audit.today());
        m0.cloud = {book: bk.book, company: bk.company, ledgersAt: bk.ledgersAt, big: true, at: new Date().toISOString()};
        LK.cache = {}; render();
      }
      return "big";
    }
    const from = this.d8(bk.from), to = Audit.today();
    const list = await this.rpcAll("tally_days_list", {p_book: bk.book, p_from: bk.from, p_to: this.iso(to)});
    const meta = b.meta = b.meta || {};
    const same = meta.cloud && meta.cloud.book === bk.book;
    const known = same ? (meta.cloud.days || {}) : {};
    const byMonth = {};
    list.forEach(x => { (byMonth[x.day.slice(0, 6)] = byMonth[x.day.slice(0, 6)] || []).push(x); });
    const todo = Object.keys(byMonth).sort().filter(ym => byMonth[ym].some(x => known[x.day] !== x.at));
    const ledNew = !same || meta.cloud.ledgersAt !== bk.ledgersAt;
    if (!todo.length && !ledNew) return true;
    f.busy = "Bringing in " + (todo.length === 1 ? FC.monthLabel(todo[0]) : todo.length + " months") + " from the copy in FinCom's cloud…"; render();
    try {
      if (!same){ b.vouchers = []; b.tb = null; }
      if (ledNew){
        const led = await this.restAll("tally_ledgers?select=name,parent,open&order=name&book_id=eq." + bk.book);
        TallyRead.balances(b, {ledgers: led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, from, to);
      }
      const days = {};
      for (const ym of todo){
        const parts = [];
        for (const x of byMonth[ym]){ parts.push(await this.day(bk.book, x.day, x.at)); days[x.day] = x.at; }
        const res = await Books.importDayBook(new Blob(["<ENVELOPE>" + parts.join("") + "</ENVELOPE>"], {type: "text/xml"}));
        const bad = notThisClient((res.meta || {}).gstins);
        if (bad.length) throw new Error(panRefusal("The company in the cloud copy", bad));
        const m = TallyRead.months(ym + "01", to).find(z => z.ym === ym) || {from: ym + "01", to: ym + "31"};
        TallyRead.merge(b, res, m.from < from ? from : m.from, m.to);
      }
      if (b.tb && String(b.tb.to) < to) b.tb.to = to;
      b.map = Books.mapLedgers(b.vouchers || [], b.map); try { LedMaster.refresh(b); } catch (e){}
      meta.cloud = {book: bk.book, company: bk.company, ledgersAt: bk.ledgersAt, days: Object.assign({}, known, days), at: new Date().toISOString()};
      meta.at = meta.cloud.at; meta.keep = true; meta.file = "the copy in FinCom's cloud"; meta.from = meta.from && meta.from < from ? meta.from : from;
      TallyRead.after(b, "after changes came from the cloud copy");
      LK.cache = {}; await saveBooks();
    } catch (e){ toast("Could not bring in the cloud copy: " + ((e && e.message) || e)); }
    f.busy = ""; render();
    return true;
  },
  // ---------- Settings: computers and companies
  async refreshPane(){
    const p = this.pane; p.busy = "Loading…"; render();
    try {
      p.devices = await Cloud.api("tally_devices?select=id,name,created_at,last_seen,version,info,revoked&order=created_at.desc");
      p.companies = await this.restAll("tally_companies?select=company,client_id,gstin,last_seen,linked_at&order=company.asc");
      p.err = ""; p.at = Date.now();
      linkByGstin(p.companies);
    } catch (e){ p.err = /tally_devices|does not exist|schema cache/i.test(String(e && e.message)) ? "The cloud copy is not set up in this database yet." : (e && e.message) || String(e); }
    p.busy = ""; render();
  },
  // The computer with Tally sends by itself: signed in to the firm, with the bridge running, this computer gets its
  // key (once) and the open client's Tally company is linked to that client. Nobody has to press anything.
  // Tried every minute until done, then every 10 minutes; a failed key hand-over waits 30 minutes (no pile of keys).
  autoAt: 0, autoBusy: false,
  async auto(){
    if (this.autoBusy || !this.on() || !Bridge.on() || !Bridge.up() || Date.now() < this.autoAt) return;
    this.autoBusy = true; this.autoAt = Date.now() + 60000;
    try {
      const s = await Bridge.call("/cloudlink", null, 15000);
      if (!s.connected || s.url !== this.ingestUrl()){
        this.autoAt = Date.now() + 30 * 60000;
        const d = await this.rpc("tally_device_create", {p_name: String(Bridge.st.computer || "Office computer").slice(0, 80)});
        await Bridge.call("/cloudlink", {url: this.ingestUrl(), key: d.key}, 60000);
        this.autoAt = Date.now() + 60000;
      }
      const co = CO(), o = co && Bridge.openFor(co);
      if (o){
        const row = ((await Cloud.api("tally_companies?select=client_id&company=eq." + encodeURIComponent(o.name))) || [])[0];
        if (!row) return;                               // the computer has not reported it yet: next minute
        // linked to another client already: left as it is (changed only by hand, in Settings)
        if (!row.client_id) await this.rpc("tally_company_link", {p_company: o.name, p_client: co.id});
      }
      this.autoAt = Date.now() + 10 * 60000;
    } catch (e){ this.autoErr = (e && e.message) || String(e); }
    finally { this.autoBusy = false; }
  },
  async revoke(id, name){
    const r = await askConfirm({title: "Remove " + name + "?", ok: "Remove it", danger: true, body: "<p>That computer will not be able to send anything to the cloud any more. What it sent stays. To send again, connect it again.</p>"});
    if (!r || !r.ok) return;
    try { await this.rpc("tally_device_revoke", {p_id: id}); toast(name + " removed."); } catch (e){ toast("Could not remove it: " + ((e && e.message) || e)); }
    await this.refreshPane();
  },
  async link(company, client){
    try { await this.rpc("tally_company_link", {p_company: company, p_client: client || null}); toast(client ? company + " is linked to " + ((CO(client) || {}).name || "the client") + ". Its books go to the cloud within a few minutes." : company + " is no longer linked."); }
    catch (e){ toast("Could not link it: " + ((e && e.message) || e)); }
    await this.refreshPane();
  }

};

// FinCom opened by the FinCom Connector's "Connect FinCom on this computer": the page's address carries the bridge's
// one-time connect code (#pair=123456). It is taken off the address at once, and used to connect to the bridge.
(function(){
  const take = () => {
    const m = String(location.hash || "").match(/(?:^#|&)pair=(\d{6})\b/);
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e){ location.hash = ""; }
    const code = m[1];
    const go = async () => {
      try {
        const j = await Bridge.pair(code);
        toast("Connected to the Tally Bridge on " + (j.computer || "this computer") + ".");
        try { await Bridge.refresh(); } catch (e){}
        render();
      } catch (e){ toast("Could not connect to the bridge: " + ((e && e.message) || e) + " Press “Connect FinCom on this computer” in FinCom Connector again."); }
    };
    // after the page has drawn itself
    setTimeout(go, 600);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", take); else take();
})();

// Files exported from Tally and chosen in FinCom (the day book part by part, the trial balance) go to FinCom's cloud
// too, into the same copy a connected computer fills: everyone in the firm then works on the same books, from any
// computer. Every day of the dates chosen is sent (an empty day as empty, so a deleted entry goes too)
const TCloudUp = {
  on(){ return typeof Cloud === "object" && Cloud.on() && !!(Cloud.st && Cloud.st.firm); },
  b64(u){ let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  async gz(text){ const cs = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")); return this.b64(new Uint8Array(await new Response(cs).arrayBuffer())); },
  // who: the client and Tally company, fixed when the upload starts (build 195: the upload for several clients moves on
  // to the next client while an earlier upload is still going; the earlier one must not follow it)
  async post(body, who){
    const c = Cloud.cfg(), s = Cloud.sess();
    if (!s) throw new Error("Sign in to the firm account first.");
    const r = await fetch(TCloud.ingestUrl(), {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: JSON.stringify(Object.assign(who || {client: S.coId, company: BridgeSeed.company()}, body))});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || ("FinCom's cloud answered with error " + r.status));
    return j;
  },
  async days(text, range, onStep, who){
    if (!this.on()) return {skipped: "not signed in to the firm account"};
    who = who || {client: S.coId, company: BridgeSeed.company()};
    const re = /<VOUCHER\b[\s\S]*?<\/VOUCHER>/g, byDay = new Map();
    let m;
    while ((m = re.exec(text))){ const d = (m[0].match(/<DATE>(\d{8})<\/DATE>/) || [])[1]; if (!d || d < range.from || d > range.to) continue; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(m[0]); }
    const all = []; for (let d = range.from; d <= range.to; d = BridgeSeed.add(d, 1)) all.push(d);
    let batch = [], size = 0, sent = 0, done = 0;
    const flush = async () => { if (!batch.length) return; if (onStep) onStep("Putting the day book in FinCom’s cloud (" + Math.round(done * 100 / all.length) + "%), for everyone in the firm…"); const j = await this.post({kind: "upload_days", days: batch}, who); sent += (j.done || []).length; batch = []; size = 0; };
    for (const d of all){
      const xml = "<ENVELOPE><BODY><DATA>" + (byDay.get(d) || []).map(v => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("") + "</DATA></BODY></ENVELOPE>";
      const gz = await this.gz(xml);
      if (batch.length && (size + gz.length > 12e6 || batch.length >= 31)) await flush();
      batch.push({day: d, gz}); size += gz.length; done++;
    }
    await flush();
    return {days: sent};
  },
  async opening(from, asOn, led, who){
    if (!this.on()) return {skipped: "not signed in to the firm account"};
    return this.post({kind: "upload_ledgers", from, openAsOn: asOn, ledgers: Object.entries(led).map(([n, x]) => [n, x.parent || "", String(x.open)])}, who);
  }
};


// The light on the clients list (build 189): for each client with Tally, whether its Tally computer is on, Tally open and
// the books up to date, from the bridge's heartbeat (every 5 minutes; the bridge asks Tally nothing for it)
const TLight = {
  st: {at: 0, busy: false, by: {}},
  refresh(){
    if (!TCloud.on() || this.st.busy || Date.now() - this.st.at < 120000) return;
    this.st.busy = true;
    Promise.all([TCloud.restAll("tally_companies?select=company,client_id,device_id,gstin,linked_at&order=company.asc"), Cloud.api("tally_devices?select=id,name,last_seen,info,revoked")])
      .then(([cos, devs]) => {
        this.st.devs = (devs || []).filter(d => !d.revoked); this.st.cos = cos || [];
        this.st.by = this.work((cos || []).filter(c => c.client_id), devs || [], Date.now());
        linkByGstin(this.st.cos);
      }, () => {})
      .then(() => { this.st.at = Date.now(); this.st.busy = false; if (S.view === "home") render(); });
  },
  // client id -> {level: ok | warn | bad, short, say}
  work(cos, devs, now){
    const by = {}, dev = {};
    devs.filter(d => !d.revoked).forEach(d => { dev[d.id] = d; });
    const when = t => new Date(t).toLocaleString("en-IN", {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"});
    const rank = {bad: 3, warn: 2, ok: 1};
    cos.forEach(c => {
      const d = dev[c.device_id]; if (!d) return;
      const beat = (d.info || {}).beat || null, seen = Date.parse((beat && beat.at) || d.last_seen || 0) || 0;
      let x;
      if (!beat || now - seen > 15 * 60000) x = {level: "bad", short: "computer off", say: "No word from " + d.name + (seen ? " since " + when(seen) : "") + ": the computer, the FinCom Connector or the bridge is off."};
      else {
        const co = (beat.companies || []).find(k => k.name === c.company), at = co && Date.parse(co.at);
        if (!beat.tally) x = {level: "warn", short: "Tally closed", say: "Tally is not open on " + d.name + "."};
        else if (!co) x = {level: "warn", short: "not updated yet", say: c.company + " has no copy on " + d.name + " yet: it comes with the next update (" + (beat.dailyAt || "20:00") + ")."};
        else if (co.waiting) x = {level: "warn", short: co.waiting + " day" + (co.waiting === 1 ? "" : "s") + " to send", say: co.waiting + " day(s) of " + c.company + " wait on " + d.name + " to go to FinCom (the internet or FinCom's cloud was not reachable)."};
        else if (!at || now - at > 36 * 3600000) x = {level: "warn", short: at ? "updated " + when(at) : "not updated yet", say: c.company + " was last updated from Tally " + (at ? "on " + when(at) : "never") + ". Books \u2192 From Tally \u2192 Update now."};
        else x = {level: "ok", short: "updated " + when(at), say: c.company + " is up to date as of " + when(at) + " (" + d.name + ")."};
        if (beat.updating && x.level !== "bad") x.short = "updating now";
      }
      const had = by[c.client_id];
      if (!had || rank[x.level] > rank[had.level]) by[c.client_id] = x;
    });
    return by;
  },
  cell(cid){
    this.refresh();
    const x = this.st.by[cid];
    return x ? '<span class="tag ' + x.level + '" title="' + esc(x.say) + '">' + (x.level === "ok" ? "\u25CF " : x.level === "warn" ? "\u25D0 " : "\u25CB ") + esc(x.short) + "</span>" : '<span class="note">\u2014</span>';
  }
};


// A Tally company whose GSTIN is exactly one client's GSTIN is linked to that client by itself (review item 6).
// Not when a person unlinked it by hand (linked_at set, no client), and not when two clients share the GSTIN:
// those are offered in Books in the cloud with one click (gstinMatch). The server's link checks the PAN part again.
const gstinKey = g => String(g || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
function gstinMatch(company){
  const g = gstinKey(company && company.gstin);
  if (!GSTIN_RE.test(g)) return null;
  const hits = Object.values(S.companies || {}).filter(c => !c.deleted && gstinKey(c.gstin) === g);
  return hits.length === 1 ? hits[0] : null;
}
const linkTried = new Set();
function linkByGstin(cos){
  if (!TCloud.on()) return;
  (cos || []).forEach(c => {
    if (c.client_id || c.linked_at || linkTried.has(c.company)) return;
    const k = gstinMatch(c);
    if (!k) return;
    linkTried.add(c.company);
    TCloud.rpc("tally_company_link", {p_company: c.company, p_client: k.id})
      .then(() => { c.client_id = k.id; if (!k.tallyName){ k.tallyName = c.company; Store.saveCompany(k); } TLight.st.at = 0; toast(c.company + " linked to " + k.name + " (same GSTIN " + k.gstin + ")."); render(); },
        err => { TCloud.autoErr = "Could not link " + c.company + " to " + k.name + ": " + ((err && err.message) || err); render(); });
  });
}

// One Tally status for every screen (review item 5): the bridge on this computer and the heartbeat of the firm's
// Tally computers (tally_devices), for a client or for the firm.
// state: none | offline | unlinked | waiting | ok;  level: ok | warn | bad (the pill's colour)
function tallyStatus(co){
  if (typeof TLight === "object") TLight.refresh();
  const local = typeof Bridge === "object" && Bridge.on() && Bridge.up();
  const devs = (typeof TLight === "object" && TLight.st.devs) || [];
  const seenOf = d => Date.parse((((d.info || {}).beat) || {}).at || d.last_seen || 0) || 0;
  const heard = devs.reduce((a, d) => Math.max(a, seenOf(d)), 0);
  const fresh = devs.some(d => Date.now() - seenOf(d) <= 15 * 60000);
  const when = t => fmtDate(new Date(t).toISOString().slice(0, 10)) + " " + new Date(t).toLocaleTimeString("en-IN", {hour: "2-digit", minute: "2-digit"});
  if (!local && !devs.length) return {state: "none", level: "bad", label: "Not set up", say: "No Tally Bridge on this computer, and no computer of the firm sends from Tally. Set up the Tally Bridge on the computer with TallyPrime."};
  if (!local && !fresh) return {state: "offline", level: "bad", label: "Offline since " + (heard ? when(heard) : "—"), say: "No word from the firm's Tally computer" + (heard ? " since " + when(heard) : "") + ": the computer, the FinCom Connector or the bridge is off."};
  const cos = co ? [co] : Object.values(S.companies || {}).filter(c => !c.deleted);
  const waiting = cos.reduce((a, c) => a + num((c.stats || {}).waiting), 0);
  if (co){
    const cloudRow = ((typeof TLight === "object" && TLight.st.cos) || []).some(r => r.client_id === co.id);
    // linked means a Tally company is this client's (in the cloud, or open in Tally through the bridge here);
    // a "Tally name" typed in Client setup alone does not link anything (review recheck: Mastercad)
    const linked = cloudRow || (local && !!Bridge.openFor(co));
    if (!linked) return {state: "unlinked", level: "warn", label: "Connected – company not linked", say: "Tally is connected, but no Tally company is linked to " + co.name + ". Link it in Client setup → Tally, or in Settings → Books in the cloud."};
  }
  if (waiting > 0) return {state: "waiting", level: "warn", label: waiting + " entr" + (waiting === 1 ? "y" : "ies") + " waiting", say: waiting + " approved entr" + (waiting === 1 ? "y is" : "ies are") + " not yet in Tally" + (co ? "" : " (all clients)") + "."};
  const light = co && typeof TLight === "object" ? TLight.st.by[co.id] : null;
  return {state: "ok", level: "ok", label: "Connected & in sync", say: "Tally is connected" + (local ? " on this computer" : " (" + devs.length + " computer" + (devs.length === 1 ? "" : "s") + " sending)") + " and nothing waits to be sent." + (light ? " " + light.say : "")};
}
