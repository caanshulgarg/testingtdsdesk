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
  // (an answer that is not a list, from an older cloud or a stand-in, is no book)
  book(cid){ const s = this.st[cid]; return s && Array.isArray(s.books) && s.books.find(b => b && b.from) || null; },
  has(cid){ return !!this.book(cid); },
  big(cid){ const b = this.book(cid); return !!(b && b.entries > this.BIG); },
  // ---------- answers from the cloud's ready totals
  async tb(cid, asOn){
    const raw = await this.rpcAll("tally_tb", {p_client: cid, p_as_on: this.iso(asOn)});
    const bk = this.book(cid) || {};
    // a ledger whose name in Tally ends in a line break ("MCS Project Pvt Ltd\r\n") is the ledger its entries name
    // without it: one row, its master's group and opening with its entries (review of 02-Oct-2026: the two showed as
    // separate ledgers, one of them with no master, and the trial balance was out by Rs 38,200)
    const by = new Map();
    raw.forEach(r => { const k = ledNm(r.ledger), x = by.get(k);
      if (!x) by.set(k, {ledger: k, parent: r.parent || "", closing: num(r.closing), master: !!r.parent});
      else { x.closing = r2(x.closing + num(r.closing)); if (r.parent){ x.parent = x.parent || r.parent; x.master = true; } } });
    const rows = Array.from(by.values());
    const out = rows.filter(r => Math.abs(num(r.closing)) >= 0.005).map(r => ({l: r.ledger, top: this.top(r.ledger, rows), sub: r.parent || "", bal: -r2(num(r.closing)), noMaster: !r.master && !/^profit & loss a\/c$/i.test(r.ledger)}));
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
    const rows = [].concat(j.rows || []).map(([d, type, no, party, narr, amt, guid, ent, opt]) => {
      const e = [].concat(ent || []).map(([l, a]) => ({l, a: num(a)}));
      return {id: guid, date: d, type, no, party: party || (e.find(x => x.a < 0) || {}).l || "", narr: narr || "", amt: r2(num(amt)), ent: e, opt: opt === true};
    });
    // migration-10: an Optional entry comes marked and is not in the total
    return {kind: "find", src: "cloud", q, from, to, typ, rows: (had ? had.rows : []).concat(rows), n: num(j.n), total: r2(num(j.total)), opt: num(j.opt)};
  },
  // fast-sync (migration-14): MIS and the TDS and GST summaries worked out by the database from the cloud copy's ready
  // totals, so a computer without the books loaded (a new one, or one still bringing them in) shows them in a moment.
  // One answer per client, report and period, kept for the page's life; asked again after a minute
  srv: {},
  report(kind, cid, from, to){
    const fn = {mis: "tally_mis", tds: "tally_tds_summary", gst: "tally_gst_summary"}[kind];
    const k = kind + "|" + cid + "|" + from + "|" + to, x = this.srv[k] = this.srv[k] || {};
    if (!fn || !this.on() || x.busy || (x.at && Date.now() - x.at < 60000)) return x;
    x.busy = true; x.err = ""; const t0 = Date.now();
    this.rpc(fn, {p_client: cid, p_from: this.iso(from), p_to: this.iso(to)}).then(j => { x.res = j; x.ms = Date.now() - t0; }, e => { x.err = (e && e.message) || String(e); if (/tally_mis|tally_tds_summary|tally_gst_summary|does not exist|PGRST202|schema cache/i.test(x.err)) x.missing = true; })
      .finally(() => { x.busy = false; x.at = Date.now(); render(); });
    return x;
  },
  // fast-sync (migration-13): the server's jobs for a client (a day book handed over, the kept day books read again),
  // the latest five; changes come live (Live.joinJobs), else every few seconds while one is going
  jobs: {}, jobsOk: null,
  async jobsLoad(cid){
    if (!this.on() || !cid) return;
    try {
      this.jobs[cid] = await Cloud.api("tally_jobs?select=id,client_id,kind,status,total,done,sealed,bad,message,created_at,updated_at&client_id=eq." + encodeURIComponent(cid) + "&order=created_at.desc&limit=5") || [];
      this.jobsOk = true;
      this.jobs[cid].forEach(j => { if (!this.done[j.id]) this.done[j.id] = j.status; });      // so a change to done is noticed
    } catch (e){ this.jobsOk = false; return; }
    render(); this.jobsPoll(cid);
  },
  jobsPoll(cid){
    clearTimeout(this.jobsT);
    if ((this.jobs[cid] || []).some(j => j.status === "queued" || j.status === "running") && !(typeof Live === "object" && Live.jobsLive)) this.jobsT = setTimeout(() => this.jobsLoad(cid).then(() => this.jobsSeen(cid)), 5000);
  },
  jobsSeen(cid){ (this.jobs[cid] || []).forEach(j => this.jobRow(j, true)); },
  done: {},            // job id -> its status when last seen here
  jobRow(r, quiet){
    if (!r || !r.client_id) return;
    const list = this.jobs[r.client_id] = this.jobs[r.client_id] || [], i = list.findIndex(x => x.id === r.id);
    if (i >= 0) list[i] = Object.assign({}, list[i], r); else list.unshift(r);
    const was = this.done[r.id]; this.done[r.id] = r.status;
    if (was && was !== r.status && (r.status === "done" || r.status === "failed")){
      const co = S.companies[r.client_id] || {name: "The client"}, what = r.kind === "reparse" ? "reading the kept day books again" : "reading the day book" + (r.message && r.status === "done" ? " " + r.message : "");
      toast(co.name + ": the server " + (r.status === "done" ? "has finished " + what + "." : "stopped " + what + ": " + (r.message || "")));
      // what the server read comes in here
      if (r.status === "done" && S.books && S.books.cid === r.client_id){ this.st[r.client_id] = {}; this.openLoad(r.client_id).catch(() => {}); }
    }
    if (!quiet) render();
    this.jobsPoll(r.client_id);
  },
  jobLine(j){
    const unit = j.kind === "reparse" ? "month" : "day", n = j.total, pl = x => x + " " + unit + (x === 1 ? "" : "s");
    const what = j.kind === "reparse" ? "Reading the kept day books again" : "Reading the day book" + (j.message && j.status !== "failed" ? " " + j.message : "");
    if (j.status === "done") return what + ": done, " + pl(j.done) + (j.bad && j.bad.length ? " (" + j.bad.length + " could not be read)" : "") + ", " + fmtTime(Date.parse(j.updated_at)) + ".";
    if (j.status === "failed") return what + ": stopped. " + (j.message || "");
    return what + " on FinCom’s server: " + j.done + " of " + pl(n) + (j.sealed ? "" : " handed over so far") + ". It carries on if this page is closed.";
  },
  // the period a client's cloud copy covers: the financial year of its last entry
  fyOf(cid){
    const bk = this.book(cid) || {}, last = this.d8(bk.to || "") || Audit.today(), y = num(last.slice(0, 4)) - (num(last.slice(4, 6)) < 4 ? 1 : 0);
    return {from: y + "0401", to: last < (y + 1) + "0331" ? last : (y + 1) + "0331"};
  },
  age(bk){
    if (!bk) return "";
    const st = bk.state || {}, at = String(st.seen || bk.stateAt || bk.daysAt || "");
    return at ? "in step with Tally as of " + fmtDateTime(at) : "not updated yet";
  },
  // ---------- one day's day book, from this browser's store or the cloud
  async day(bk, d, at){
    const k = "tcday:" + bk + ":" + d;
    try { const c = await IDBStore.get(k); if (c && c.at === at) return c.text; } catch (e){}
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess();
    const url = c.url.replace(/\/+$/, "") + "/storage/v1/object/authenticated/tally-days/" + Cloud.st.firm + "/" + bk + "/" + d.slice(0, 6) + "/" + d + ".xml.gz";
    let r = await fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + s.access_token}, cache: "no-store"});
    if (r.status === 401 || r.status === 400){ await Cloud.refreshToken(s.access_token); r = await fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token}, cache: "no-store"}); }
    if (r.status === 404) return "";
    if (!r.ok) throw new Error("Could not fetch " + d + " from the cloud (" + r.status + ").");
    const text = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
    try { await IDBStore.write([[k, {at, text}]]); } catch (e){}
    return text;
  },
  // Tally's groups, sent by the bridge from 1.14.7 (review of 01-Oct-2026): each group's parent, so a ledger's chain up
  // to its primary group is known (expenses, incomes, debtors...). A copy sent before has none: the names decide, as before
  async groupsInto(b, book){
    let g = [];
    try { g = await this.restAll("tally_groups?select=name,parent&book_id=eq." + book); } catch (e){ g = []; }
    if (!g.length) return;
    b.groups = Object.assign({}, b.groups || {});
    g.forEach(x => { b.groups[x.name] = x.parent || ""; });
    TallyRead.yearOpen(b);
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
        const led = await this.restAll("tally_ledgers?select=name,parent,open&merged_into=is.null&order=name&book_id=eq." + bk.book);
        b.vouchers = []; TallyRead.balances(b, {ledgers: led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, this.d8(bk.from), Audit.today());
        await this.groupsInto(b, bk.book);
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
    // server-books: the progress shows on every Books screen (TDS, GST, MIS, Reports...), not only on Look up
    const say = t => { f.busy = b.busy = t; render(); };
    say("Bringing in " + (todo.length === 1 ? FC.monthLabel(todo[0]) : todo.length + " months") + " from the copy in FinCom's cloud…");
    let changed = false;
    try {
      if (!same){ b.vouchers = []; b.tb = null; }
      if (ledNew){
        const led = await this.restAll("tally_ledgers?select=name,parent,open&merged_into=is.null&order=name&book_id=eq." + bk.book);
        TallyRead.balances(b, {ledgers: led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, from, to);
        await this.groupsInto(b, bk.book);
      }
      // the days, sixteen at a time (one by one, a year of 365 files took minutes on a new computer; the server answers
      // many at once over one connection)
      const days = {}, want = [].concat(...todo.map(ym => byMonth[ym])), text = {};
      let got = 0, next = 0;
      const one = async () => { while (next < want.length){ const x = want[next++]; text[x.day] = await this.day(bk.book, x.day, x.at); days[x.day] = x.at; got++;
        if (got % 10 === 0 || got === want.length) say("Bringing in the books from FinCom's cloud: " + got + " of " + want.length + " days…"); } };
      await Promise.all(Array.from({length: Math.min(16, want.length)}, one));
      for (const ym of todo){
        const parts = byMonth[ym].map(x => text[x.day] || "");
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
      LK.cache = {}; changed = true; await saveBooks();
    } catch (e){ toast("Could not bring in the cloud copy: " + ((e && e.message) || e)); }
    f.busy = b.busy = ""; render();
    return changed ? "new" : true;
  },
  // server-books: opening a client on any computer brings its books in from the cloud copy, with no button and no upload
  // (this browser keeps a copy of each day, so only the days that changed are fetched). Then MIS and the audit are
  // worked out again from what came in.
  async openLoad(cid){
    if (!this.on() || S.coId !== cid) return false;
    const f = LK.fr();
    if (f.busy) return false;
    f.cat = Date.now();
    let r = false;
    const b = S.books, empty = b && b.cid === cid && !(b.vouchers || []).length;
    if (empty){ f.busy = b.busy = "Looking for the books in FinCom's cloud…"; render(); }
    // a day book chosen on this computer that has not reached the cloud yet goes first
    try { if (await TCloudUp.retry(cid, t => { if (S.books && S.books.cid === cid){ f.busy = S.books.busy = t; render(); } })) this.st[cid] = {}; } catch (e){}
    try { await this.status(cid, true); if (this.has(cid) && S.books && S.books.cid === cid){ if (empty) f.busy = ""; r = await this.load(true); } } catch (e){}
    if (S.books && S.books.cid === cid && /FinCom.s cloud/.test(S.books.busy || "")){ f.busy = S.books.busy = ""; render(); }
    if (r === "new" && S.books && S.books.cid === cid) this.rework(S.books);
    // how long until every entry was in (said on the books' first line, with the time to open)
    if (S.books && S.books.cid === cid && S.books.openAt){ S.books.readyMs = Date.now() - S.books.openAt; render(); }
    return r;
  },
  rework(b){
    try {
      const last = b.mis && b.mis.last;
      if (last && last.from && last.to) MIS.run(last.from, last.to, "after the books came in from the cloud copy"); else MIS.maybeRun();
      Audit.maybeRun(); saveBooks(); render();
    } catch (e){}
  },
  // ---------- Settings: computers and companies
  async refreshPane(){
    const p = this.pane; p.busy = "Loading…"; render();
    try {
      // main_bridge from migration-22 on; without it, the list as before
      const cols = "id,name,created_at,last_seen,version,info,revoked";
      p.devices = await Cloud.api("tally_devices?select=" + cols + ",main_bridge&order=created_at.desc").catch(e => {
        if (/main_bridge/.test(String(e && e.message))) { p.noMain = true; return Cloud.api("tally_devices?select=" + cols + "&order=created_at.desc"); }
        throw e; });
      p.companies = await this.restAll("tally_companies?select=company,client_id,gstin,last_seen,linked_at&order=company.asc");
      p.err = ""; p.at = Date.now();
      linkByGstin(p.companies);
    } catch (e){ p.err = /tally_devices|does not exist|schema cache/i.test(String(e && e.message)) ? "The cloud copy is not set up in this database yet." : (e && e.message) || String(e); }
    p.busy = ""; render();
  },
  // 02-Oct-2026: every bridge heard from on the firm's computers (tally_devices.info.bridges, kept by tally-ingest from
  // each heartbeat): computer, Windows user, version, test or main, last seen, Tally and the companies open. A bridge
  // 2.0.0 in test mode sent no name of its own: it is shown from info.shadow, to be updated before it can be made main.
  bridgesHeard(){
    const now = Date.now(), rows = [];
    (this.pane.devices || []).filter(d => !d.revoked).forEach(d => {
      const info = d.info || {}, br = info.bridges || {}, main = d.main_bridge || "";
      Object.keys(br).forEach(id => { const b = br[id] || {};
        rows.push({device: d, id, computer: b.computer || info.computer || d.name, user: b.user || "", version: b.version || "", runMode: b.runMode || "",
          main: main ? id === main : b.mode === "main", at: b.at, tally: b.tallyState || (b.tally ? "open" : "closed"), open: b.open || [], go: id !== "v1"}); });
      if (!br.v1 && info.beat) rows.push({device: d, id: "v1", computer: info.computer || d.name, user: info.user || "", version: info.beat.version || d.version || "",
        main: !main, at: info.beat.at, tally: info.beat.tallyState || (info.beat.tally ? "open" : "closed"), open: info.beat.open || [], go: false});
      if (info.shadow && !Object.keys(br).some(id => id !== "v1")) rows.push({device: d, id: "", computer: info.computer || d.name, user: info.user || "", version: info.shadow.version || "",
        main: false, at: info.shadow.at, tally: info.shadow.tally ? "open" : "closed", open: info.shadow.open || [], go: true, old: true});
    });
    rows.forEach(r => { r.online = !!r.at && now - Date.parse(r.at) < 3 * 60000; });
    return rows.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  },
  // "Make this the main bridge": an owner, asked first; tally-ingest gives postings only to it from then on, tells the
  // bridge (its next heartbeat) to switch itself over, which stops bridge 1.15.0 on that computer
  async makeMain(r){
    const others = this.bridgesHeard().filter(x => x.device.id === r.device.id && x.id !== r.id);
    const ok = await askConfirm({title: "Make this the main bridge?", ok: "Make it the main bridge",
      body: "<p><b>FinCom Bridge " + esc(r.version) + "</b> on <b>" + esc(r.computer) + "</b>" + (r.user ? " (Windows user " + esc(r.user) + ")" : "") + " will read Tally <b>and post</b> to it.</p>" +
        (others.length ? "<p>" + others.map(x => "Bridge " + esc(x.version || "?") + (x.user ? " of " + esc(x.user) : "")).join(", ") + " on this computer stops posting at once: FinCom gives postings to the main bridge only. " +
          "Within a minute the new bridge also stops any older bridge for its Windows user and takes over its pairing, settings and copy of the books.</p>" : "") +
        "<p>Only one bridge may ever post to Tally.</p>"});
    if (!ok) return;
    try {
      await Cloud.rpc("tally_bridge_make_main", {p_device: r.device.id, p_bridge: r.id});
      toast("Done. FinCom Bridge " + r.version + " on " + r.computer + " is the main bridge; it switches over within a minute.");
    } catch (e){
      const m = String((e && e.message) || e);
      toast(/tally_bridge_make_main|does not exist|schema cache/i.test(m) ? "FinCom's cloud is not ready for this yet (migration-22 is not applied)." : m);
    }
    await this.refreshPane();
  },
  // an install log dropped on the Tally page (a bridge not connected to FinCom yet cannot send its own), for FinCom support
  async sendInstallLog(file){
    const p = this.pane;
    if (!file) return;
    if (file.size > 2 * 1024 * 1024){ p.logSent = {err: "That file is larger than 2 MB; it is not an install log."}; render(); return; }
    p.logSent = {busy: true}; render();
    try {
      const text = await file.text();
      const j = await TCloudUp.post({kind: "install_log", name: file.name, text}, {});
      p.logSent = {ok: true, ref: j.path || "", name: file.name};
    } catch (e){ p.logSent = {err: (e && e.message) || String(e)}; }
    render();
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

// FinCom opened by FinCom Bridge's "Connect FinCom on this computer": the page's address carries the bridge's
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
        toast("Connected to FinCom Bridge on " + (j.computer || "this computer") + ".");
        try { await Bridge.refresh(); } catch (e){}
        render();
      } catch (e){ toast("Could not connect to the bridge: " + ((e && e.message) || e) + " Right-click the FinCom Bridge icon near the clock and choose “Connect FinCom on this computer…” again."); }
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
    await Cloud.fresh().catch(() => {});
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
  // server-books: a day book file waiting to go to the cloud ("tcup:<client>:<from>-<to>" in this browser's store)
  async hold(cid, file, range, who){
    const k = "tcup:" + cid + ":" + range.from + "-" + range.to;
    this.live.add(k);
    try { await IDBStore.write([[k, {blob: file, name: file.name, from: range.from, to: range.to, who: Object.assign({}, who), at: new Date().toISOString()}]]); } catch (e){}
    return k;
  },
  live: new Set(),          // the files this page is sending now (not to be sent twice)
  async drop(k){ this.live.delete(k); try { await IDBStore.write([[k, null]]); } catch (e){} },
  async waiting(cid){ try { return await IDBStore.prefix("tcup:" + cid + ":"); } catch (e){ return []; } },
  // sent again on opening the client; true when something went
  async retry(cid, onStep){
    if (!this.on() || this.retrying) return false;
    const list = (await this.waiting(cid)).filter(([k]) => !this.live.has(k));
    if (!list.length) return false;
    this.retrying = true; let sent = 0;
    try {
      for (const [k, x] of list){
        try { const r = await this.handOver(await x.blob.text(), {from: x.from, to: x.to}, onStep, x.who, x.name); if (r && r.days != null){ await this.drop(k); sent++; } }
        catch (e){ toast("A day book (" + (x.name || "file") + ") is still waiting to go to FinCom’s cloud: " + ((e && e.message) || e)); }
      }
    } finally { this.retrying = false; }
    if (sent) toast(sent + " day book file" + (sent === 1 ? " that was waiting is" : "s that were waiting are") + " now in FinCom’s cloud.");
    return sent > 0;
  },
  // fast-sync (migration-13): the day book handed over to the server's queue, a part at a time; the server reads it into
  // the cloud copy even if this page is closed afterwards. A cloud without the queue: days() as before
  split(text, range){
    const re = /<VOUCHER\b[\s\S]*?<\/VOUCHER>/g, byDay = new Map(); let m;
    while ((m = re.exec(text))){ const d = (m[0].match(/<DATE>(\d{8})<\/DATE>/) || [])[1]; if (!d || d < range.from || d > range.to) continue; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(m[0]); }
    const all = []; for (let d = range.from; d <= range.to; d = BridgeSeed.add(d, 1)) all.push(d);
    return {all, byDay};
  },
  async handOver(text, range, onStep, who, name){
    if (!this.on()) return {skipped: "not signed in to the firm account"};
    who = who || {client: S.coId, company: BridgeSeed.company()};
    const {all, byDay} = this.split(text, range);
    let job;
    try { job = (await this.post({kind: "job_new", total: all.length, name: String(name || "").slice(0, 120)}, who)).job; }
    catch (e){ return this.days(text, range, onStep, who); }      // a cloud without the queue (or not ready): sent as before
    if (!job) return this.days(text, range, onStep, who);
    let batch = [], size = 0, done = 0;
    const flush = async last => { if (onStep) onStep("Handing the day book to FinCom’s server (" + Math.round(done * 100 / all.length) + "%)…"); await this.post({kind: "stage_days", job, days: batch, last: !!last}, who); batch = []; size = 0; };
    for (const d of all){
      const xml = "<ENVELOPE><BODY><DATA>" + (byDay.get(d) || []).map(v => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("") + "</DATA></BODY></ENVELOPE>";
      const gz = await this.gz(xml);
      if (batch.length && (size + gz.length > 4e6 || batch.length >= 31)) await flush(false);
      batch.push({day: d, gz}); size += gz.length; done++;
    }
    await flush(true);
    try { TCloud.jobsLoad(who.client); } catch (e){}
    return {days: all.length, job};
  },
  async opening(from, asOn, led, who){
    if (!this.on()) return {skipped: "not signed in to the firm account"};
    return this.post({kind: "upload_ledgers", from, openAsOn: asOn, ledgers: Object.entries(led).map(([n, x]) => [n, x.parent || "", String(x.open)])}, who);
  }
};


// The light on the clients list (build 189): for each client with Tally, whether its Tally computer is on, Tally open and
// the books up to date, from the bridge's heartbeat (every 5 minutes; the bridge asks Tally nothing for it)
// review of 01-Oct-2026: on TCloud (its pane, status, rpc and restAll); the call to FinCom's cloud goes through TCloudUp.post
Object.assign(TCloud, {
  // review of 01-Oct-2026: the day books kept in the cloud, read again by FinCom's cloud with today's reading (the party's
  // GSTIN, the place of supply, HSN and rate on lines were not kept before). One month a call; owners only. Nothing is
  // asked of the computer with Tally
  async reparse(cid){
    // review of 01-Oct-2026: what happened stays on the screen (p.rp), not only in a toast. "Read again" is said only
    // when FinCom's cloud answered for each month with the days it read; an answer of another shape, no months kept, or
    // no day read at all is an error on the screen. The line names the cloud asked, so a wrong address shows
    const co = S.companies[cid] || {name: "This client"};
    const p = this.pane; p.rp = p.rp || {};
    let host = ""; try { host = new URL(this.ingestUrl()).host.split(".")[0]; } catch (e){}
    if (p.rp[cid] && p.rp[cid].busy){ toast("Already reading " + co.name + "’s kept day books again."); return; }
    // fast-sync: handed to the server's queue (a month a piece); it carries on if this page is closed
    try {
      const j = await TCloudUp.post({kind: "reparse_queue"}, {client: cid});
      if (j && j.job){ p.rp[cid] = {job: j.job, months: j.months, host, at: new Date().toISOString()}; this.done[j.job] = "queued"; await this.jobsLoad(cid); toast(co.name + ": the server reads the " + j.months + " months of kept day books again; it carries on if this page is closed."); render(); return; }
    } catch (e){ if (/not allowed|owner/i.test(String(e && e.message))){ p.rp[cid] = {err: (e && e.message) || String(e), n: 0, host}; render(); return; } }   // no queue yet: read again as before
    let month = null, n = 0, bad = 0, total = 0, calls = 0;
    const seen = new Set();
    try {
      do {
        p.busy = "Reading " + co.name + "’s kept day books again" + (month ? " (" + FC.monthLabel(month) + ")" : "") + "…"; p.rp[cid] = {busy: true, n, months: calls, host}; render();
        const j = await TCloudUp.post({kind: "reparse", month}, {client: cid});
        calls++;
        if (!j || j.ok !== true || !Array.isArray(j.done) || !("next" in j)) throw new Error("FinCom's cloud (" + host + ") gave an answer that is not a re-read; nothing was read. Its function may be out of date.");
        if (!j.months) throw new Error("FinCom's cloud (" + host + ") keeps no day books for this client; nothing was read.");
        if (j.month){ if (seen.has(j.month)) throw new Error("FinCom's cloud answered " + j.month + " twice; stopped."); seen.add(j.month); }
        n += j.done.length; bad += (j.bad || []).length; total = j.months || total; month = j.next;
        if (calls > 240) throw new Error("More than 240 months; stopped.");
      } while (month);
      if (!n) throw new Error("No day was read (" + total + " months kept" + (bad ? ", " + bad + " days could not be read" : "") + ").");
      p.busy = ""; p.rp[cid] = {n, bad, months: total, at: new Date().toISOString(), host};
      toast(co.name + ": " + n + " days of " + total + " months read again" + (bad ? ", " + bad + " could not be read" : "") + ". Open the client again to see them.");
      const s = this.st[cid]; if (s) s.at = 0;
    } catch (e){ p.busy = ""; p.rp[cid] = {err: (e && e.message) || String(e), n, host}; toast("Could not read the kept day books again: " + ((e && e.message) || e)); }
    render();
  },
  // review of 01-Oct-2026: "Send ledgers and groups now": the Tally computer reads every ledger and group and sends
  // them (bridge 1.14.8), asked the way Update now is: through the bridge here, or through the cloud's heartbeat
  async sendLedgers(cid){
    const here = typeof Bridge === "object" && Bridge.on() && Bridge.up();
    try {
      // review of 01-Oct-2026: asked through the cloud too, always: the bridge here may keep another company, or this
      // may not be the computer that keeps this client's books
      if (here){ try { await LK.keepSet({now: true}, "Asked the bridge here to read every ledger and group from Tally and send them."); } catch (e){} }
      const j = await this.rpc("tally_want_update", {p_client: cid});
      toast(j && j.ok ? "The Tally computer is asked to send every ledger and group; it starts within a minute (Tally must be open there). Press What is in the cloud? after two minutes." : here ? "Asked the bridge here. No other Tally computer is linked to this client." : "No Tally computer is linked to this client yet.");
    } catch (e){ toast("Could not ask the Tally computer: " + ((e && e.message) || e)); }
    setTimeout(() => this.groupStatus(cid), 1500);
  },
  // what of the client's ledgers is in the cloud: groups, and ledgers with a group
  async groupStatus(cid){
    const p = this.pane; p.gs = p.gs || {};
    try {
      const bk = (await this.status(cid, true) || []).find(b => b.from); if (!bk){ p.gs[cid] = {none: true}; render(); return; }
      // a twin kept from a trial balance file (merged_into, migration-9) is not a ledger of its own; Profit & Loss A/c has
      // no group in Tally either
      const [g, led] = await Promise.all([this.restAll("tally_groups?select=name&book_id=eq." + bk.book).catch(() => []), this.restAll("tally_ledgers?select=name,parent&merged_into=is.null&book_id=eq." + bk.book).catch(() => [])]);
      const own = led.filter(l => l.name !== "Profit & Loss A/c");
      p.gs[cid] = {groups: g.length, ledgers: own.length, grouped: own.filter(l => l.parent).length, pl: own.length < led.length, at: new Date().toISOString()};
    } catch (e){ p.gs[cid] = {err: (e && e.message) || String(e)}; }
    render();
  }
});

// go-bridge (review of 01-Oct-2026: the status went between connected and disconnected while the bridge was busy with
// Tally): a Tally computer's state from its heartbeats, in three parts.
//   bridge: online | reconnecting (a beat late) | offline (three beats missed: about 2 minutes at 30 s a beat; 1.15.0
//           beats every 60 s) | none. Timed on this computer's clock from when each new beat was seen, so a clock
//           that is not right here does not make a computer look offline
//   tally:  open | busy (open, slow to answer: never shown as disconnected) | closed
const BeatSeen = {};
function beatEvery(beat){ return Math.max(10, Math.min(600, num((beat || {}).every) || 60)); }
function devState(d, now){
  now = now || Date.now();
  const beat = ((d && d.info) || {}).beat || null;
  if (!beat || !beat.at) return {bridge: "none", tally: "closed", age: Infinity, every: 60};
  const every = beatEvery(beat), k = BeatSeen[d.id];
  let seen;
  if (k && k.at === beat.at) seen = k.seen;
  else { seen = Math.min(now, Date.parse(beat.at) || now); if (k) seen = now; BeatSeen[d.id] = {at: beat.at, seen}; }
  const age = Math.max(0, now - seen), poll = 30000;
  const bridge = age <= (every + 15) * 1000 + poll ? "online" : age <= (3 * every + 30) * 1000 ? "reconnecting" : "offline";
  const tally = ["open", "busy", "closed"].includes(beat.tallyState) ? beat.tallyState : (beat.tally ? "open" : "closed");
  return {bridge, tally, age, every, busySince: beat.busySince || "", at: seen};
}
const TLight = {
  st: {at: 0, busy: false, by: {}},
  refresh(){
    // every 30 s (a small database call; nothing is asked of Tally): a beat comes every 30 s, and "offline" is three missed
    if (!TCloud.on() || this.st.busy || Date.now() - this.st.at < 30000) return;
    this.st.busy = true;
    Promise.all([TCloud.restAll("tally_companies?select=company,client_id,device_id,gstin,linked_at&order=company.asc"), Cloud.api("tally_devices?select=id,name,last_seen,info,revoked")])
      .then(([cos, devs]) => {
        this.st.devs = (devs || []).filter(d => !d.revoked); this.st.cos = cos || [];
        this.st.by = this.work((cos || []).filter(c => c.client_id), devs || [], Date.now());
        linkByGstin(this.st.cos);
      }, () => {})
      .then(() => {
        this.st.at = Date.now(); this.st.busy = false;
        // the top bar follows a change of state at once; nothing else is redrawn while someone types
        const sig = JSON.stringify(tallyStatus(typeof CO === "function" && S.view === "company" ? CO() : null).parts || {});
        const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
        if (S.view === "home" || (sig !== this.sig && !typing)) render();
        this.sig = sig;
      });
  },
  // client id -> {level: ok | warn | bad, short, say}
  work(cos, devs, now){
    const by = {}, dev = {};
    devs.filter(d => !d.revoked).forEach(d => { dev[d.id] = d; });
    const when = t => fmtDateTime(t);
    const rank = {bad: 3, warn: 2, ok: 1};
    cos.forEach(c => {
      const d = dev[c.device_id]; if (!d) return;
      const beat = (d.info || {}).beat || null, seen = Date.parse((beat && beat.at) || d.last_seen || 0) || 0, ds = devState(d, now);
      let x;
      if (!beat || ds.bridge === "offline") x = {level: "bad", short: "computer off", say: "No word from " + d.name + (seen ? " since " + when(seen) : "") + ": the computer or its bridge is off, or it has no internet."};
      else {
        const co = (beat.companies || []).find(k => k.name === c.company), at = co && Date.parse(co.at);
        if (ds.bridge === "reconnecting") x = {level: "warn", short: "reconnecting\u2026", say: d.name + "'s heartbeat is late (last " + when(seen) + "); it shows as offline only after three missed beats."};
        else if (ds.tally === "busy") x = {level: "warn", short: "Tally busy", say: "Tally on " + d.name + " is open but answering slowly (a long report or a message box?); the bridge asks again by itself."};
        else if (ds.tally === "closed") x = {level: "warn", short: "Tally closed", say: "Tally is not open on " + d.name + "."};
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


// FinCom Bridge 2.1.3 reads Tally only after an event (a client opened here, Update now, a posting, the nightly catch-up):
// Tally cannot send changes by itself, so FinCom says in one line a client how its Tally stands, from the bridge's
// heartbeat, with one button, Update now:
//   "Tally open on NWS144 · last read 15:34" | "Tally is closed on NWS144" | "NWS144 is offline" |
//   "Tally is not answering on NWS144 since 12:28" | "Background reading paused on NWS144"
// {state: open | closed | offline | notanswering | paused, level, text, computer, read}; null when no Tally computer
// keeps this client's company (and the bridge here does not have it open)
function tallyHm(t){
  const ms = typeof t === "number" ? t : Date.parse(String(t || ""));
  if (!ms) return "";
  return new Date(ms).toDateString() === new Date().toDateString() ? fmtTime(ms) : fmtDateTime(ms);
}
function tallyLine(co){
  if (!co) return null;
  const st = (typeof TLight === "object" && TLight.st) || {}, now = Date.now();
  const link = (st.cos || []).find(c => c.client_id === co.id && c.device_id);
  const dev = link && (st.devs || []).find(d => d.id === link.device_id && !d.revoked);
  let comp = "", beat = null, bridge = "online", tally = "closed", since = "", paused = false, read = "";
  if (dev){
    const info = dev.info || {}, ds = devState(dev, now);
    beat = info.beat || {}; comp = info.computer || dev.name || "the Tally computer";
    bridge = ds.bridge; tally = ds.tally; since = beat.notAnsweringSince || ""; paused = !!beat.paused;
    const cb = (beat.companies || []).find(k => k.name === link.company) || {};
    read = cb.lastRead || beat.lastRead || cb.at || "";
  } else if (typeof Bridge === "object" && Bridge.on() && Bridge.up() && Bridge.openFor(co) && Bridge.openFor(co).name){
    // no word from the cloud for it: the bridge on this computer
    const b = Bridge.st || {}, man = (typeof LK === "object" && LK.fr ? (LK.fr() || {}).man : null) || {};
    comp = b.computer || "this computer"; tally = b.tallyState || (b.tallyUp ? "open" : "closed");
    since = (b.stuck && b.stuck.since) || ""; paused = !!b.paused; read = man.readAt || man.seen || "";
  } else return null;
  const o = (state, level, text) => ({state, level, text, computer: comp, read});
  if (bridge === "offline" || bridge === "none") return o("offline", "bad", comp + " is offline");
  if (tally === "closed") return o("closed", "warn", "Tally is closed on " + comp);
  if (since) return o("notanswering", "bad", "Tally is not answering on " + comp + " since " + tallyHm(since));
  if (paused) return o("paused", "warn", "Background reading paused on " + comp);
  return o("open", "ok", "Tally open on " + comp + (read ? " \u00b7 last read " + tallyHm(read) : ""));
}
// when the client's books were last read from Tally ("Books as of 15:34"): the bridge's last read of its company, else
// when FinCom's copy was last brought in. Never shown as "now": entries made in Tally since then come at the next event
function booksAsOf(cid){
  cid = cid || S.coId;
  const co = S.companies && S.companies[cid];
  const l = co ? tallyLine(co) : null, bk = typeof TCloud === "object" ? TCloud.book(cid) : null, st = (bk && bk.state) || {};
  const man = typeof LK === "object" && LK.fr && cid === S.coId ? ((LK.fr() || {}).man || {}) : {};
  const at = [l && l.read, st.readAt, man.readAt, st.seen, man.seen].filter(x => x && Date.parse(x)).sort((a, b) => Date.parse(b) - Date.parse(a))[0]
    || (S.books && S.books.cid === cid ? booksFresh(S.books, cid).at : "");
  if (!at) return null;
  return {at, text: "Books as of " + tallyHm(at),
    say: "Tally cannot send its changes by itself: entries made in Tally after " + tallyHm(at) + " come in at the next update (opening this client, Update now, or the nightly catch-up)."};
}
// Update now for a client: the bridge here when it has the company open, else the client's Tally computer through
// FinCom's cloud (the bridge reads at once, also while its background reading is paused)
function tallyUpdateNow(cid){
  cid = cid || S.coId;
  if (cid === S.coId) return doAct("keepNow");
  if (typeof TCloud !== "object" || !TCloud.on()) return toast("Sign in to the firm account to ask the Tally computer.");
  TCloud.rpc("tally_want_update", {p_client: cid}).then(j => toast(j && j.ok ? "The Tally computer is asked to update now; the books here follow in a few minutes." : "No Tally computer is linked to this client yet."),
    e => toast("Could not ask the Tally computer: " + ((e && e.message) || e)));
}
// a client opened in FinCom wakes the computer that keeps its Tally company for one light update (only what changed in
// Tally since the last read): through FinCom's cloud (tally-ingest, kind "wake"; the bridge's own channel), and the
// bridge here when the company is open on this computer. At most once every 5 minutes a client from this page; the
// bridge holds back a second one within its own few minutes too. "active": FinCom in use, so the nightly catch-up waits
const TWake = {
  at: {}, activeAt: 0, EVERY: 5 * 60000,
  open(cid){
    if (!cid || Date.now() - (this.at[cid] || 0) < this.EVERY) return false;
    this.at[cid] = Date.now();
    const co = S.companies && S.companies[cid];
    try {
      const here = typeof Bridge === "object" && Bridge.on() && Bridge.up() && co && Bridge.openFor(co);
      if (here && here.name) Bridge.call("/wake", {what: "open", company: here.name}, 10000).catch(() => {});
    } catch (e){}
    if (typeof TCloud === "object" && TCloud.on()) this.send({kind: "wake", what: "open", client: cid});
    return true;
  },
  active(){
    if (typeof TCloud !== "object" || !TCloud.on() || Date.now() - this.activeAt < 10 * 60000) return;
    this.activeAt = Date.now();
    this.send({kind: "wake", what: "active"});
  },
  // a cloud without the wake kind yet (tally-ingest before 2.1.3) answers an error: nothing else depends on it
  send(body){ try { return TCloudUp.post(body, {}).catch(() => null); } catch (e){ return Promise.resolve(null); } }
};
if (typeof document === "object") document.addEventListener("pointerdown", () => { try { TWake.active(); } catch (e){} }, true);

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
// how fresh the books are, in one sentence used on every page (review of 01-Oct-2026: "Books up to …", "checked with
// Tally to …" and "N days not read yet" were said differently in different places): the last entry, how far FinCom's copy
// has been checked against Tally and when, and the days the bridge has not been able to read yet
function booksFresh(b, cid){
  b = b || S.books || {}; cid = cid || S.coId;
  const meta = b.meta || {}, bk = typeof TCloud === "object" && cid ? TCloud.book(cid) : null, st = (bk && bk.state) || {};
  const man = typeof LK === "object" && LK.fr ? ((LK.fr() || {}).man || {}) : {};
  let last = "";
  (b.vouchers || []).forEach(v => { if (!v.cancel && String(v.date) > last) last = String(v.date); });
  const d8 = x => String(x || "").replace(/-/g, "").slice(0, 8);
  if (!last && bk) last = d8(bk.to);
  const checked = [d8(meta.to), d8(st.doneTo), d8(man.doneTo)].filter(Boolean).sort().pop() || "";
  const at = [String(st.seen || ""), String(man.seen || ""), String(meta.at || "")].filter(Boolean).sort().pop() || "";
  const skipped = Array.from(new Set([].concat(st.skipped || [], man.skipped || []).filter(Boolean))).sort();
  const day = x => fmtDate(tallyDate(x));
  const parts = [last ? "last entry " + day(last) : "no entries yet"];
  if (checked && checked > last) parts.push("checked with Tally to " + day(checked));
  const text = "Books: " + parts.join(", ") + (at ? " (as of " + fmtDateTime(at) + ")" : "") +
    (skipped.length ? "; " + skipped.length + (skipped.length === 1 ? " day" : " days") + " not read from Tally yet (" + skipped.slice(0, 3).map(day).join(", ") + (skipped.length > 3 ? " and " + (skipped.length - 3) + " more" : "") + ")" : "") + ".";
  return {last, checked, at, skipped, text};
}
function tallyStatus(co){
  if (typeof TLight === "object") TLight.refresh();
  const local = typeof Bridge === "object" && Bridge.on() && Bridge.up();
  const lst = typeof Bridge === "object" ? Bridge.st : {};
  const devs = (typeof TLight === "object" && TLight.st.devs) || [];
  const now = Date.now(), dss = devs.map(d => Object.assign({d}, devState(d, now)));
  const seenOf = d => Date.parse((((d.info || {}).beat) || {}).at || d.last_seen || 0) || 0;
  const heard = devs.reduce((a, d) => Math.max(a, seenOf(d)), 0);
  const when = t => fmtDateTime(t);
  const rankB = {online: 3, reconnecting: 2, offline: 1, none: 0}, rankT = {open: 3, busy: 2, closed: 1};
  // the three parts: the bridge (this computer's, else the best of the firm's computers), Tally, the company
  let bridge = local ? (lst.shaky ? "reconnecting" : "online") : "none";
  dss.forEach(x => { if (rankB[x.bridge] > rankB[bridge]) bridge = x.bridge; });
  let tally = "closed", busySince = "";
  if (local) { tally = lst.tallyState || (lst.tallyUp ? "open" : "closed"); busySince = lst.busySince || ""; }
  dss.filter(x => x.bridge !== "offline" && x.bridge !== "none").forEach(x => { if (rankT[x.tally] > rankT[tally]) { tally = x.tally; busySince = x.busySince; } });
  let company = "";
  if (co){
    const cloudRow = ((typeof TLight === "object" && TLight.st.cos) || []).some(r => r.client_id === co.id);
    // linked means a Tally company is this client's (in the cloud, or open in Tally through the bridge here);
    // a "Tally name" typed in Client setup alone does not link anything (review recheck: Mastercad)
    company = cloudRow || (local && !!Bridge.openFor(co)) ? "linked" : "unlinked";
  }
  const parts = {bridge, tally, company, busySince};
  // the short words for the header chip (review of 01-Oct-2026: the long label pushed the tabs off the row); the full
  // label and sentence go in its tooltip
  const hhmm = t => { const d = new Date(t), today = new Date(); return d.toDateString() === today.toDateString() ? fmtTime(t) : fmtDate(d); };
  const SHORT = {none: "Tally not set up", offline: "Tally offline" + (heard ? " \u00b7 " + hhmm(heard) : ""), reconnecting: "Tally reconnecting\u2026",
    unlinked: "Tally: not linked", busy: "Tally busy", ok: "Tally in sync"};
  const out = o => Object.assign(o, {parts, short: o.state === "waiting" ? o.label.replace(/ waiting$/, "") + " for Tally" : SHORT[o.state] || o.label});
  if (!local && !devs.length) return out({state: "none", level: "bad", label: "Not set up", say: "FinCom Bridge is not on this computer, and no computer of the firm sends from Tally. Install FinCom Bridge from the Tally page on the computer with TallyPrime."});
  if (bridge === "offline" || bridge === "none") return out({state: "offline", level: "bad", label: "Offline since " + (heard ? when(heard) : "\u2014"), say: "No word from the firm's Tally computer" + (heard ? " since " + when(heard) : "") + " (three heartbeats missed): the computer or its bridge is off, or it has no internet."});
  if (bridge === "reconnecting") return out({state: "reconnecting", level: "warn", label: "Reconnecting\u2026", say: "The bridge's last heartbeat is late. FinCom keeps listening; it shows Offline only after three missed heartbeats (about two minutes)."});
  const cos = co ? [co] : Object.values(S.companies || {}).filter(c => !c.deleted);
  // the one count of what is for Tally (postCountFor, src/js/59): the same number as the tab, the page and the dashboard
  const waiting = cos.reduce((a, c) => a + (typeof postCountFor === "function" ? postCountFor(c.id) : num((c.stats || {}).waiting)), 0);
  if (co && company === "unlinked") return out({state: "unlinked", level: "warn", label: "Connected \u2013 company not linked", say: "Tally is connected, but no Tally company is linked to " + co.name + ". Link it in Client setup \u2192 Tally, or in Settings \u2192 Books in the cloud."});
  if (waiting > 0) return out({state: "waiting", level: "warn", label: waiting + " entr" + (waiting === 1 ? "y" : "ies") + " waiting", say: waiting + " approved entr" + (waiting === 1 ? "y is" : "ies are") + " not yet in Tally" + (co ? "" : " (all clients)") + "."});
  if (tally === "busy") return out({state: "busy", level: "warn", label: "Connected \u2013 Tally busy", say: "The bridge is connected. Tally is open but answering slowly" + (busySince ? " since " + fmtDateTime(Date.parse(busySince)) : "") + " (a long report, or a message box in Tally); the bridge asks again by itself and nothing is lost."});
  const light = co && typeof TLight === "object" ? TLight.st.by[co.id] : null;
  return out({state: "ok", level: "ok", label: "Connected & in sync", say: "Tally is connected" + (local ? " on this computer" : " (" + devs.length + " computer" + (devs.length === 1 ? "" : "s") + " sending)") + " and nothing waits to be sent." + (light ? " " + light.say : "")});
}
// the computers' connection history for the last 24 hours (tally_devices.info.history, kept by tally-ingest from the
// heartbeats), newest first, with a gap going on now shown as "offline since"
function tallyHistory(){
  const devs = (typeof TLight === "object" && TLight.st.devs) || [], now = Date.now(), day = 24 * 3600000, rows = [];
  devs.forEach(d => {
    [].concat(((d.info || {}).history) || []).forEach(e => { if (e && Date.parse(e.to || e.at) > now - day) rows.push(Object.assign({device: d.name}, e)); });
    const ds = devState(d, now);
    if (ds.bridge === "offline" && d.info && d.info.beat) rows.push({device: d.name, kind: "bridge", state: "offline", at: d.info.beat.at, now: true});
  });
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
// The Tally companies a new client can be linked to (02-Oct-2026: "Add client" links to a company the bridge sees open,
// and sets the one company the client may post to, in one step): the ones open in Tally through the bridge on this
// computer, and the ones the firm's Tally computers have reported (tally_companies, and what their heartbeats say is
// open). Each: {name, gstin, client (linked to), open (seen open now), where, reported (the cloud can link it)}
function tallyCompaniesSeen(){
  const by = new Map(), put = (name, x) => { const n = ledNm(name); if (!n) return; by.set(n, Object.assign(by.get(n) || {name: n, gstin: "", client: "", open: false, where: "", reported: false}, x)); };
  if (typeof Bridge === "object" && Bridge.up()) (Bridge.st.open || []).forEach(o => put(o.name, {open: true, where: "open in Tally on this computer"}));
  const p = typeof TCloud === "object" ? TCloud.pane : null;
  ((p && p.devices) || []).filter(d => !d.revoked).forEach(d => {
    const info = d.info || {}, comp = info.computer || d.name;
    [].concat((info.beat || {}).open || []).concat(...Object.values(info.bridges || {}).map(b => b.open || [])).forEach(n => put(n, Object.assign({open: true}, (by.get(ledNm(n)) || {}).where ? {} : {where: "open in Tally on " + comp})));
  });
  ((p && p.companies) || []).forEach(c => put(c.company, Object.assign({reported: true, gstin: c.gstin || "", client: c.client_id || ""}, by.has(ledNm(c.company)) ? {} : {where: "seen by the firm's Tally computer"})));
  return Array.from(by.values()).sort((a, b) => (a.client ? 1 : 0) - (b.client ? 1 : 0) || (b.open ? 1 : 0) - (a.open ? 1 : 0) || a.name.localeCompare(b.name));
}
// a new client linked to its Tally company in the cloud: the client is sent to the server first, then linked
async function linkNewClient(co, company){
  if (typeof TCloud !== "object" || !TCloud.on()) return;
  const seen = tallyCompaniesSeen().find(x => x.name === ledNm(company));
  if (!seen || !seen.reported){ toast(co.name + " is set to " + company + ". It is linked once the Tally computer reports that company (keep it open in Tally)."); return; }
  try { if (typeof cloudPushNow === "function") await cloudPushNow(); } catch (e){}
  await TCloud.link(company, co.id);
}
