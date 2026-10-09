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
  // migration-32: a ledger deleted in Tally stays in the cloud, marked (tally_ledgers.deleted_at). Every read of the
  // cloud's ledger list leaves those out; a cloud without the column (migration-32 not applied) is read as before.
  // hasDel: null not known yet, true the column is there, false it is not
  hasDel: null,
  async restAll(path){
    if (/^tally_ledgers\?/.test(path) && !/deleted_at/.test(path) && this.hasDel !== false){
      try { const r = await this.restPages(path + "&deleted_at=is.null"); this.hasDel = true; return r; }
      catch (e){ if (!/deleted_at|42703/i.test(String((e && e.message) || e))) throw e; this.hasDel = false; }
    }
    return this.restPages(path);
  },
  // the names of the ledgers deleted in Tally (none on a cloud without the column), kept per book and ledger time
  async deletedNames(bk){
    if (!bk || !bk.book || this.hasDel === false) return new Set();
    const k = bk.book + "|" + (bk.ledgersAt || ""), c = this._del;
    if (c && c.k === k) return c.set;
    let set = new Set();
    try { set = new Set((await this.restPages("tally_ledgers?select=name&deleted_at=not.is.null&book_id=eq." + encodeURIComponent(bk.book))).map(r => ledNm(r.name))); this.hasDel = true; }
    catch (e){ if (/deleted_at|42703/i.test(String((e && e.message) || e))) this.hasDel = false; }
    this._del = {k, set};
    return set;
  },
  async restPages(path){
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
    const raw = await this.balRows(cid, asOn);
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
    return LK.tbShape({kind: "tb", src: "cloud", asOn, rows: out, line: copyLine(cid), note: this.noteFor("From the copy in FinCom's cloud (" + (bk.company || "") + ")", cid), noteOf: ["From the copy in FinCom's cloud (" + (bk.company || "") + ")", cid]});
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
    return {kind: "ledger", src: "cloud", led, from, to, open, close: run, dr, cr, rows, line: copyLine(cid), note: this.noteFor("From the books (" + (j.company || "") + ")", cid, ends), noteOf: ["From the books (" + (j.company || "") + ")", cid, ends]};
  },
  // build 192: a group, month by month, and any entry: worked out by the cloud, not from books loaded here
  inG(l, parent, grp){ try { if (FC.inGroup(l, grp)) return true; } catch (e){} return String(parent || "").toLowerCase() === String(grp || "").toLowerCase(); },
  async period(cid, from, to){ return await this.rpcAll("tally_period", {p_client: cid, p_from: this.iso(from), p_to: this.iso(to)}) || []; },
  async group(cid, grp, from, to){
    const all = await this.period(cid, from, to), bk = this.book(cid) || {};
    const rows = all.filter(r => this.inG(r.ledger, r.parent, grp)).map(r => { const op = -r2(num(r.open)), dr = r2(num(r.dr)), cr = r2(num(r.cr)); return {l: r.ledger, sub: r.parent || "", open: op, dr, cr, close: r2(op + dr - cr)}; })
      .filter(r => r.dr || r.cr || (r.open && Math.abs(r.open) >= 0.5)).sort((a, c) => Math.abs(c.close) - Math.abs(a.close) || a.l.localeCompare(c.l));
    const sum = k => r2(rows.reduce((t, r) => t + (r[k] || 0), 0));
    return {kind: "group", src: "cloud", grp, from, to, rows, open: sum("open"), dr: sum("dr"), cr: sum("cr"), close: sum("close"), line: copyLine(cid), note: this.noteFor("From the books (" + (bk.company || "") + ")", cid), noteOf: ["From the books (" + (bk.company || "") + ")", cid]};
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
    return {kind: "monthly", src: "cloud", led, grp, from, to, open, rows, dr: r2(rows.reduce((t, r) => t + r.dr, 0)), cr: r2(rows.reduce((t, r) => t + r.cr, 0)), line: copyLine(cid), note: this.noteFor("From the books (" + (bk.company || "") + ")", cid), noteOf: ["From the books (" + (bk.company || "") + ")", cid]};
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
  // review M1 of 2.4.0 part 2: the TDS details of Tally's entries in the client's book (migration 62,
  // tally_tds_details_marked: each line with rate_worked_out and exempt), kept for the page's life, asked again after a minute
  tdsl: {},
  tdsLines(cid){
    const bk = this.book(cid), x = this.tdsl[cid] = this.tdsl[cid] || {};
    if (!bk || !bk.book || !this.on() || x.busy || (x.at && Date.now() - x.at < 60000)) return x;
    x.busy = true; x.err = "";
    this.rpc("tally_tds_details_marked", {p_book: bk.book}).then(j => { x.rows = [].concat(j || []); }, e => { x.err = (e && e.message) || String(e); if (/tally_tds_details_marked|does not exist|PGRST202|schema cache/i.test(x.err)) x.missing = true; })
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
    // round 20 (d.2): a Day Book that went through Storage, split into days by FinCom's server
    if (j.kind === "upload"){
      const per = typeof TCloudUp === "object" ? TCloudUp.periodOf(j) : "", head = "Day Book" + (per ? " " + per : "");
      if (j.status === "failed") return head + ": stopped. " + (j.message || "");
      if (!num(j.total) && j.status !== "done") return head + ": in FinCom’s cloud, being split into days. It carries on if this page is closed.";
      return head + ": " + num(j.done) + " of " + num(j.total) + " days read" + (j.bad && j.bad.length ? " (" + j.bad.length + " could not be read)" : "") + (j.status === "done" ? ", " + fmtTime(Date.parse(j.updated_at)) + "." : "");
    }
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
  // "From the books (GARG SHEKHAR & COMPANY), in step with Tally as of 05-Oct-2026 13:59 IST.": never while a line Tally
  // sent for these books is held (the owner's finding of 05-Oct-2026); then "From the books (…)." and the held line
  // beside it (HeldBooks, app/src/parts/HeldBooks.jsx)
  noteFor(lead, cid, ends){
    const held = typeof booksHeld === "function" && booksHeld(cid), a = held ? "" : this.age(this.book(cid));
    return lead + (a ? ", " + a : "") + "." + (ends || "");
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
        b.vouchers = []; TallyRead.balances(b, {ledgers: led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, this.d8(bk.from), Audit.today()); b.tb.src = "copy";
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
        TallyRead.balances(b, {ledgers: led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, from, to); b.tb.src = "copy";
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
      // created_by: the member whose page made the computer key (the owner's rule of 05-Oct-2026: their own bridge)
      const cols = "id,name,created_at,created_by,last_seen,version,info,revoked";
      // round 15 (F3): the posting settings an owner saved for the computer (migration 43: post_only, post_batch_bills,
      // post_batch_bank, post_settings_at, post_settings_by); without the columns the page says they are not available
      const PS = ",post_only,post_batch_bills,post_batch_bank,post_settings_at,post_settings_by", noPS = m => /post_only|post_batch|post_settings/.test(m);
      const read = extra => Cloud.api("tally_devices?select=" + cols + extra + "&order=created_at.desc");
      p.devices = await read(",main_bridge" + PS).then(r => { p.noPostSettings = false; return r; }).catch(e => {
        const m = String(e && e.message);
        if (noPS(m)){ p.noPostSettings = true; return read(",main_bridge").catch(e2 => { if (/main_bridge/.test(String(e2 && e2.message))){ p.noMain = true; return read(""); } throw e2; }); }
        if (/main_bridge/.test(m)){ p.noMain = true; return read(PS).then(r => { p.noPostSettings = false; return r; }).catch(e2 => { if (noPS(String(e2 && e2.message))){ p.noPostSettings = true; return read(""); } throw e2; }); }
        throw e; });
      // round 19: "Trial tools on this computer" (migration 46: tally_devices.trial_tools), read apart so a cloud without
      // the column (42703) keeps the rest of the page; the line then says it is not available yet
      try {
        const tt = [].concat(await Cloud.api("tally_devices?select=id,trial_tools") || []), by = new Map(tt.map(x => [x.id, x.trial_tools]));
        (p.devices || []).forEach(d => { if (by.has(d.id)) d.trial_tools = by.get(d.id) === true; });
        p.noTrialTools = false;
      } catch (e){ p.noTrialTools = /trial_tools|42703/.test(String(e && e.message)); }
      // round 20 (d.3): where a computer's changes come from (migration 47: tally_devices.recorder_source, addon |
      // alterid | both, default addon), read apart: without the column nothing is shown
      try {
        const rs = [].concat(await Cloud.api("tally_devices?select=id,recorder_source") || []), by = new Map(rs.map(x => [x.id, x.recorder_source]));
        (p.devices || []).forEach(d => { if (by.has(d.id)) d.recorder_source = by.get(d.id) || "addon"; });
        p.noRecorderSource = false;
      } catch (e){ p.noRecorderSource = true; }
      // FinCom Bridge 2.3.0 (migration 54): "Changes only" per bridge, and the bridge each member posts through; without
      // the tables (an older cloud) neither is shown and postings go as before
      try {
        p.prefs = [].concat(await Cloud.api("tally_bridge_prefs?select=device_id,bridge_id,changes_only") || []);
        p.links = [].concat(await Cloud.api("tally_member_bridges?select=user_id,device_id,bridge_id") || []);
        p.noTarget = false;
      } catch (e){ p.prefs = []; p.links = []; p.noTarget = true; }
      await this.loadBridgeAlerts();
      p.companies = await this.restAll("tally_companies?select=company,client_id,device_id,gstin,last_seen,linked_at&order=company.asc");
      // migration-35: the stops and resumes from FinCom with who and when (round 4, item 24: the latest 300 rows; the
      // standing stops and the latest resume a computer are taken out here), and the bridge versions on trial, approved
      // or withdrawn (members may read both); without the migration, none (the lines still show what each heartbeat says)
      try {
        const all = [].concat(await Cloud.api("tally_read_stops?select=id,device_id,action,reason,stopped_at,stopped_by,cleared_at,cleared_by&order=id.desc&limit=300") || []);
        p.stops = all.filter(x => x.action !== "resume" && !x.cleared_at); p.resumes = resumeRows(all); p.noControl = false;
      } catch (e){ p.stops = []; p.resumes = {}; p.noControl = true; }
      const relCols = "version,pilot_device,pilot_started_at,pilot_by,pilot_seen_at,pilot_self_stop,approved_at,approved_by";
      // migration 54: held_* (an owner's hold of a version) and the rollback standing (tally_bridge_rollbacks); without them
      // (an older cloud) the page offers neither
      try { p.releases = [].concat(await Cloud.api("tally_bridge_releases?select=" + relCols + ",withdrawn_at,withdrawn_by,withdrawn_why,held_at,held_by,held_why&order=pilot_started_at.desc") || []); p.noWithdraw = false; p.noHold = false; }
      catch (e){ p.noHold = true; try { p.releases = [].concat(await Cloud.api("tally_bridge_releases?select=" + relCols + ",withdrawn_at,withdrawn_by,withdrawn_why&order=pilot_started_at.desc") || []); p.noWithdraw = false; }
      catch (e){
        // migration 37 not applied: no withdrawal columns yet (the page says FinCom's cloud is not ready for a withdrawal)
        if (/withdrawn|42703/i.test(String(e && e.message))){ p.noWithdraw = true; try { p.releases = [].concat(await Cloud.api("tally_bridge_releases?select=" + relCols + "&order=pilot_started_at.desc") || []); } catch (e2){ p.releases = []; } }
        else p.releases = [];
      } }
      try { p.rollback = ([].concat(await Cloud.api("tally_bridge_rollbacks?select=version,why,set_by,set_at&cleared_at=is.null&order=set_at.desc&limit=1") || []))[0] || null; p.noRollback = false; }
      catch (e){ p.rollback = null; p.noRollback = true; }
      // migration-37 (item 10): each book's reading state (needs_baseline: since when, why; cleared by whom, with the note)
      // and the books, to list them under their computer. Not readable (an older cloud, no select for members): nothing shown
      try { p.cursors = [].concat(await Cloud.api("tally_sync_cursor?select=book_id,state,state_why,state_at,cleared_at,cleared_by,cleared_note") || []); p.noBaselineClear = false; }
      catch (e){
        if (/cleared_note|cleared_by|cleared_at|42703/i.test(String(e && e.message))){ p.noBaselineClear = true; try { p.cursors = [].concat(await Cloud.api("tally_sync_cursor?select=book_id,state,state_why,state_at") || []); } catch (e2){ p.cursors = null; } }
        else p.cursors = null;
      }
      try { p.books = p.cursors && p.cursors.length ? [].concat(await this.restAll("tally_books?select=book_id,client_id,company&order=company.asc") || []) : []; } catch (e){ p.books = []; }
      // next release (item e, migration 65): the nightly self-check of each company, the firm's latest 300 (tally_selfchecks,
      // as row security gives them); a cloud without the table: none, and nothing said
      try { p.selfchecks = [].concat(await Cloud.api("tally_selfchecks?select=id,book_id,device_id,bridge,company,ran_at,night,result,words,still_missing,fetched,copy_ok&order=ran_at.desc&limit=300") || []); p.noSelfChecks = false; }
      catch (e){ p.selfchecks = []; p.noSelfChecks = true; }
      // FinCom 2.4.1 (migration 71): each book's data locations (tally_company_sources, as row security gives them: one
      // company open in two places with different data) and the books' names; a cloud without the table: none, nothing said
      // review SR-M2 of next-241: bounded (at most 20 locations a book; 1000 rows)
      try { p.sources = [].concat(await Cloud.api("tally_company_sources?select=id,book_id,company_guid,data_id,path,device_id,win_user,computer,first_seen,last_seen,last_line_at,choice,chosen_by,chosen_at&order=first_seen.asc&limit=1000") || []); p.noSources = false; }
      catch (e){ p.sources = []; p.noSources = true; }
      if (p.sources.length && !(p.books || []).length){ try { p.books = [].concat(await this.restAll("tally_books?select=book_id,client_id,company&order=company.asc") || []); } catch (e){ p.books = p.books || []; } }
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
      const beat = info.beat || {}, wu = (x) => String((x && x.user) || "").trim().toLowerCase();
      Object.keys(br).forEach(id => { const b = br[id] || {}, isMain = main ? id === main : b.mode === "main";
        // 2.1.5: its requests to Tally (last, longest today, over 20 s) and whether it stopped reading: its own entry,
        // else the computer's beat when it is the main bridge
        const mine = (k) => b[k] !== undefined ? b[k] : isMain ? beat[k] : undefined;
        // 2.3.0: its own port, its Tally's port and data folder, and the owner's "Changes only"
        const co = this.isChangesOnly(d.id, id);
        // the owner's rule of 05-Oct-2026 (migration 54's tally_bridge_may_post): the main bridge chosen stops only the other
        // bridges of its own Windows user; another user's main bridge on a shared key stops nobody
        const coOn = co === null ? !!b.changesOnly : co;
        const mayPost = !coOn && (main && br[main] && wu(br[main]) === wu(b) ? id === main : b.mode !== "test");
        rows.push({device: d, id, computer: b.computer || info.computer || d.name, user: b.user || "", version: b.version || "", runMode: b.runMode || "",
          port: b.port || null, tallyPort: b.tallyPort || (isMain && beat.tallyPort) || null, dataFolder: b.dataFolder || (isMain && beat.dataFolder) || "", changesOnly: co === null ? !!b.changesOnly : co,
          main: isMain, mayPost, at: b.at, tally: b.tallyState || (b.tally ? "open" : "closed"), open: b.open || [], go: id !== "v1",
          reqs: mine("reqs") || null, readStopped: mine("readStopped") || null, paused: !!mine("paused"), readStop: info.readStop || null,
          // bridge 2.3.1: a request not answered in time and when it tries again by itself ({words, at, next, tries})
          tallyRetry: mine("tallyRetry") || null,
          // bridge 2.3.2: the companies whose entries it no longer asks Tally for (over 2 s to find one), as tally-ingest keeps
          // them on its own entry ({bodies: {company: {off, seconds, at, why}}}); shown only for a 2.3.2 bridge or later
          recorderOff: b.recorderOff || null}); });
      if (!br.v1 && info.beat) rows.push({device: d, id: "v1", computer: info.computer || d.name, user: info.user || "", version: info.beat.version || d.version || "",
        main: !main, at: info.beat.at, tally: info.beat.tallyState || (info.beat.tally ? "open" : "closed"), open: info.beat.open || [], go: false});
      if (info.shadow && !Object.keys(br).some(id => id !== "v1")) rows.push({device: d, id: "", computer: info.computer || d.name, user: info.user || "", version: info.shadow.version || "",
        main: false, at: info.shadow.at, tally: info.shadow.tally ? "open" : "closed", open: info.shadow.open || [], go: true, old: true});
    });
    rows.forEach(r => { r.online = !!r.at && now - Date.parse(r.at) < 3 * 60000; r.read = this.readState(r); });
    return rows.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  },
  // ---------- FinCom Bridge 2.3.0: one bridge for each Windows user on a shared server (migration 54)
  // the owner's "Changes only" for a bridge (tally_bridge_prefs): true / false, null when nothing is set
  isChangesOnly(devId, id){ const x = (this.pane.prefs || []).find(q => q.device_id === devId && q.bridge_id === id); return x ? x.changes_only === true : null; },
  // a bridge in words: "<PC> · <Windows user> · <company> · <data folder>" (the company given, else those open there)
  bridgeWords(r, company){
    if (!r) return "";
    return [r.computer || "", r.user || "", company || (r.open || []).join(", "), r.dataFolder || ""].filter(Boolean).join(" \u00b7 ");
  },
  // the signed-in member
  me(){ return typeof Cloud === "object" && Cloud.sess ? ((Cloud.sess() || {}).user_id || "") : ""; },
  // the bridge the signed-in member is linked to (by an owner, or by themselves); "" when none
  myBridge(){
    const me = this.me();
    const l = me && (this.pane.links || []).find(x => x.user_id === me && x.bridge_id);
    return l ? l.bridge_id : "";
  },
  // the members linked to a bridge
  linkedTo(r){ return (this.pane.links || []).filter(x => x.bridge_id && x.bridge_id === r.id && x.device_id === r.device.id).map(x => x.user_id); },
  // the owner's rule of 05-Oct-2026 (migration 54's tally_bridge_is_own): a member's own bridge is the one they are linked
  // to, or one on a computer key they made on which every bridge is of one Windows user
  isOwn(r){
    const me = this.me();
    if (!me || !r || !r.device) return false;
    if ((this.pane.links || []).some(x => x.user_id === me && x.bridge_id === r.id && x.device_id === r.device.id)) return true;
    if (r.device.created_by !== me) return false;
    const u = (x) => String((x && x.user) || "").trim().toLowerCase(), br = (r.device.info && r.device.info.bridges) || {};
    return Object.keys(br).every(k => u(br[k]) === u(r));
  },
  // this browser's own FinCom Bridge (paired here, proved within the last 10 minutes), as a line FinCom has heard from; null
  localRow(){
    if (typeof Bridge !== "object" || !Bridge.cfg) return null;
    const c = Bridge.cfg() || {}, u = String(c.url || "").replace(/\/+$/, ""), at = (Bridge.proven || {})[u];
    if (!c.key || !c.bridgeId || !at || Date.now() - at > 600000) return null;
    return this.bridgesHeard().find(r => r.go && !r.old && r.id === c.bridgeId) || null;
  },
  // the client's Tally company (its link in FinCom's cloud, else the one it may post to)
  companyOf(cid){
    const c = (this.pane.companies || []).find(x => x.client_id === cid && x.company), co = typeof S === "object" && S.companies ? S.companies[cid] : null;
    return (c && c.company) || (co && (co.postTo || co.tallyName)) || "";
  },
  hasOpen(r, company){ const n = (x) => String(x || "").trim().replace(/\s+/g, " ").toLowerCase(); return !company || (r.open || []).some(o => n(o) === n(company)); },
  // the bridges a posting may be sent through: FinCom Bridge 2.x, allowed to post (the main bridge among its own Windows
  // user's on its computer, not changes only)
  postTargets(){ return this.bridgesHeard().filter(r => r.go && !r.old && r.id && r.mayPost); },
  // the bridge a posting of this client goes through: the one an owner picked on the Post screen, else the POSTER'S OWN
  // (the owner's rule of 05-Oct-2026, as migration 54 decides it): the linked one (when it may post, and has the company
  // open or no other of theirs has), else the newest of theirs that may post with the company open, else this browser's
  // own proven bridge (not linked to another member); "" for none: the cloud then says what to do, and never routes into
  // another person's Tally
  postTargetFor(cid){
    if (this.pane.noTarget) return "";
    const t = this.postTargets(), pick = (S.postTarget || {})[cid], company = this.companyOf(cid);
    if (pick && t.some(r => r.id === pick)) return pick;
    const mine = this.myBridge(), linked = mine && t.find(r => r.id === mine);
    const own = t.filter(r => this.isOwn(r) && this.hasOpen(r, company)).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    if (linked && (this.hasOpen(linked, company) || !own.length)) return linked.id;
    if (own.length) return own[0].id;
    const loc = this.localRow(), me = this.me();
    // final review M3: this browser's own proven bridge counts as the member's only on a computer key the member made (an
    // owner may post through any); on another's key it first gets a key of its own (autoOwn)
    if (loc && t.some(r => r.id === loc.id) && this.hasOpen(loc, company) && !this.linkedTo(loc).some(u => u !== me) && this.mayLinkSelf(loc)) return loc.id;
    return "";
  },
  // final review M3: a member links HIMSELF only to a bridge on a computer key he made (migration 54); an owner links anyone
  mayLinkSelf(r){ return !!(r && r.device && ((typeof postOwner === "function" && postOwner()) || r.device.created_by === this.me())); },
  // a posting through this browser's own bridge, not yet linked to the member: linked first (so the cloud knows it is theirs)
  async linkIfLocal(target){
    const loc = this.localRow(), me = this.me();
    if (!loc || loc.id !== target || !me || this.isOwn(loc) || !this.mayLinkSelf(loc)) return;
    await this.rpc("tally_member_bridge_link", {p_user: me, p_device: loc.device.id, p_bridge: loc.id});
    this.pane.links = (this.pane.links || []).filter(x => x.user_id !== me).concat([{user_id: me, device_id: loc.device.id, bridge_id: loc.id}]);
  },
  // the bridge's line that will post a client's entries: the target's; none (null) when the poster has no bridge of their
  // own for it (an older cloud without migration 54: the main bridge of the computer keeping the company, as before)
  postThrough(co){
    const rows = this.bridgesHeard(), id = co ? this.postTargetFor(co.id) : "";
    if (id) return rows.find(r => r.id === id) || null;
    if (!this.pane.noTarget) return null;
    const c = co && (this.pane.companies || []).find(x => x.client_id === co.id && x.device_id), devId = c && c.device_id;
    return rows.find(r => r.go && !r.old && r.main && !r.changesOnly && (!devId || r.device.id === devId)) || null;
  },
  // why the poster has no bridge of their own for a company, and what to do (migration 54's tally_post_own_words)
  noTargetWords(company){
    const own = this.bridgesHeard().filter(r => r.go && !r.old && r.id && this.isOwn(r)), w = (l) => [...new Set(l.map(r => [r.computer, r.user].filter(Boolean).join(" \u00b7 ")))].join(", ");
    const head = "Nobody can post into " + company + " from your sign-in just now: ";
    if (!own.length) return head + "FinCom has not heard from a FinCom Bridge of yours. Install FinCom Bridge on the computer where you use Tally, as your own Windows user (\u201cJust for me\u201d), and connect it to FinCom; then open " + company + " in Tally there and post again.";
    const has = own.filter(r => this.hasOpen(r, company));
    if (has.length) return head + "your FinCom Bridge (" + w(has) + ") has it open but is set to Changes only or only reads Tally. Ask the firm\u2019s owner to switch Changes only off for it (Tally page), then post again.";
    const may = own.filter(r => r.mayPost);
    return head + "your FinCom Bridge (" + w(may.length ? may : own) + ") does not have " + company + " open in Tally. Open " + company + " in Tally there, then post again.";
  },
  // an owner switches a bridge to changes only (it never takes a posting) or back -> tally_bridge_changes_only
  async changesOnly(r, on){
    if (on){
      const a = await askConfirm({title: "Changes only for " + this.bridgeWords(r) + "?", ok: "Changes only",
        body: "<p>This bridge keeps reading Tally\u2019s changes for FinCom but is never given a posting, and the Post screen never offers it. A posting it is running now finishes.</p>"});
      if (!a || !a.ok) return;
    }
    await this.control("tally_bridge_changes_only", {p_device: r.device.id, p_bridge: r.id, p_on: !!on},
      (on ? "Changes only: " : "Posting allowed again: ") + this.bridgeWords(r) + ".");
  },
  // the owner's condition (Fix 2): a computer key refused a bridge id: ONE alert per (id, computer) for the owners, until
  // read or until the identity is released (tally_bridge_alerts, migration 54); none on an older cloud
  async loadBridgeAlerts(){
    const p = this.pane;
    p.bridgeAlertsAt = Date.now();
    try { p.bridgeAlerts = [].concat(await Cloud.api("tally_bridge_alerts?select=id,bridge_id,device_id,tried_computer,tried_user,words,at,last_at,read_at&cleared_at=is.null&order=at.desc&limit=50") || []); }
    catch (e){ p.bridgeAlerts = []; }
  },
  async bridgeAlertRead(x){
    try { await this.rpc("tally_bridge_alert_read", {p_id: x.id}); x.read_at = new Date().toISOString(); } catch (e){ toast((e && e.message) || String(e)); }
    render();
  },
  // Fix 2b: an owner releases a bridge's identity: the next computer that reports the id gets it (kept with who, when, why)
  async releaseIdentity(r){
    const a = await askConfirm({title: "Release the identity of " + this.bridgeWords(r) + "?", ok: "Release it",
      body: "<p>FinCom keeps bridge " + esc(r.id) + " tied to the computer key that reported it first. Released, the next computer that reports this id gets it. Who released it, when and why are kept.</p>" +
        '<div class="bk-form one"><label><span>Why (kept with the release)</span><input id="releaseWhy" maxlength="300" placeholder="e.g. the computer was set up again"></label></div>',
      read: () => ({why: ((document.getElementById("releaseWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say why the identity is released."});
    if (!a || !a.ok) return;
    await this.control("tally_bridge_reset", {p_bridge: r.id, p_why: a.data.why}, "The identity of " + this.bridgeWords(r) + " is released; the next computer that reports it gets it.");
  },
  // an owner links a member to the bridge they post through (r null: unlinked) -> tally_member_bridge_link
  async linkMember(uid, r){
    const m = ((typeof Cloud === "object" && Cloud.st.members) || []).find(x => x.user_id === uid), who = (m && (m.name || m.email)) || "The member";
    await this.control("tally_member_bridge_link", {p_user: uid, p_device: r ? r.device.id : null, p_bridge: r ? r.id : null},
      r ? who + " now posts through " + this.bridgeWords(r) + "." : who + " is no longer linked to a bridge.");
  },
  // the reading state of a bridge's computer (plan item 14): {state: reading | paused | retrying | fincomstop | offline,
  // text, reason}. A stop from FinCom still standing (tally_read_stops, for this computer or for all of them, or the
  // computer's info.readStop) wins over what the bridge last said, then paused. Bridge 2.3.1 (the owner's last change)
  // never stops reading by itself: a request not answered in time is tried again by itself, said in plain words
  // ("Tally did not answer in time at 12:14; trying again by itself at 12:15"). A bridge before 2.3.1 that stopped by
  // itself is said the same way, with no Resume: 2.3.1 clears such a stop when it starts.
  readState(r){
    if (!r.online) return {state: "offline", text: "Offline" + (r.at ? " since " + fmtDateTime(r.at) : "")};
    const st = this.stopFor(r.device.id), rs = r.readStopped || {};
    if (st) return {state: "fincomstop", text: "Reading stopped from FinCom: " + (st.reason || "no reason given"), reason: st.reason || ""};
    if (rs.by === "fincom") return {state: "fincomstop", text: "Reading stopped from FinCom: " + (rs.reason || "no reason given"), reason: rs.reason || ""};
    if (r.paused) return {state: "paused", text: "Paused"};
    const tr = r.tallyRetry || {};
    if (tr.words) return {state: "retrying", text: String(tr.words), reason: ""};
    if (rs.by === "self") return {state: "retrying", text: "Tally did not answer in time" + (rs.at ? " at " + tallyHm(rs.at) : "") +
      "; reading starts again by itself once FinCom Bridge 2.3.1 is on that computer (it tries again by itself)", reason: rs.reason || ""};
    return {state: "reading", text: "Reading"};
  },
  // the stop from FinCom standing for a computer: the one for all computers ({device_id: null}), else its own; with no
  // list (before migration-35, or not read yet) the computer's info.readStop
  stopFor(devId){
    const list = this.pane.stops;
    if (Array.isArray(list) && !this.pane.noControl){
      const all = list.find(s => !s.device_id && !s.cleared_at), own = list.find(s => s.device_id === devId && !s.cleared_at);
      return all || own || null;
    }
    const d = (this.pane.devices || []).find(x => x.id === devId), rs = d && d.info && d.info.readStop;
    return rs ? {device_id: devId, reason: rs.reason || ""} : null;
  },
  stoppedAll(){ return Array.isArray(this.pane.stops) && !this.pane.noControl && this.pane.stops.some(s => !s.device_id && !s.cleared_at); },
  // the latest resume that holds for a computer (its own, or one for all computers, whichever is later): {by, at}, or null
  resumeFor(devId){
    const r = this.pane.resumes || {}, own = r[devId], all = r.all;
    if (own && all) return String(own.at || "") >= String(all.at || "") ? own : all;
    return own || all || null;
  },
  // item 10: the books of a computer's companies whose reading needs a fresh baseline (tally_sync_cursor.state), and the
  // ones cleared in the last week (who, when, the note): [{book, company, cur}]
  baselines(devId){
    const p = this.pane;
    if (!Array.isArray(p.cursors) || !p.cursors.length) return [];
    const cos = (p.companies || []).filter(c => c.device_id === devId), week = Date.now() - 7 * 86400000, out = [];
    (p.books || []).forEach(b => {
      if (!cos.some(c => c.company === b.company && (!c.client_id || !b.client_id || String(c.client_id) === String(b.client_id)))) return;
      const cur = p.cursors.find(x => x.book_id === b.book_id);
      if (!cur) return;
      if (cur.state === "needs_baseline" || (cur.cleared_at && Date.parse(cur.cleared_at) > week)) out.push({book: b.book_id, company: b.company, cur});
    });
    return out;
  },
  // next release (item e): under a computer, each of its companies' latest nightly self-check (tally_selfchecks):
  // [{book, company, row, old}], old when it ran more than two nights ago (Tally closed at night, or the bridge off). On a
  // shared computer key (2.3.0, one bridge per Windows user) each bridge's line shows the checks that bridge made
  selfChecks(devId, bridgeId){
    const rows = Array.isArray(this.pane.selfchecks) ? this.pane.selfchecks : [], seen = new Set(), out = [];
    rows.filter(r => r && r.device_id === devId && (!bridgeId || !r.bridge || r.bridge === bridgeId)).sort((a, b) => String(b.ran_at || "").localeCompare(String(a.ran_at || ""))).forEach(r => {
      const k = r.book_id || r.company || "";
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push({book: r.book_id || "", company: String(r.company || ""), row: r, old: !!r.ran_at && Date.now() - Date.parse(r.ran_at) > 2 * 86400000});
    });
    return out.sort((a, b) => a.company.localeCompare(b.company));
  },
  // a request's line: "vouchers 1.2 s at 15:34"
  reqSay(q){ if (!q || !q.kind) return ""; const ms = Number(q.ms) || 0; return q.kind + " " + (ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s") + (q.at ? " at " + tallyHm(q.at) : ""); },
  // Stop reading / Resume reading / a pilot / approval (owners; the cloud checks it again): migration-35's RPCs. What
  // was done, or the refusal in plain words, is kept for the page (pane.ctl)
  async control(fn, args, done){
    const p = this.pane; p.ctl = {busy: true}; render();
    try {
      const r = await this.rpc(fn, args);
      if (r && r.ok === false) throw new Error(r.error || "It was not done.");
      p.ctl = {ok: done};
      toast(done);
    } catch (e){
      const m = String((e && e.message) || e), missing = /PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(m);
      const mig = {tally_bridge_changes_only: 54, tally_member_bridge_link: 54, tally_bridge_reset: 54, tally_release_withdraw: 37, tally_baseline_clear: 37, tally_device_post_settings: 43, tally_device_trial_tools: 46, tally_device_recorder_source: 47, tally_company_source_choose: 71, tally_company_source_same: 71}[fn] || 35;
      p.ctl = {err: missing && fn === "tally_device_post_settings" ? "Posting settings are not available until migration 43 runs."
        : missing && fn === "tally_device_trial_tools" ? "Trial tools on this computer: not available until migration 46 runs."
        : missing && fn === "tally_device_recorder_source" ? "Changes come from: not available until migration 47 runs."
        : missing ? "FinCom\u2019s cloud is not ready for this yet (migration " + mig + " is not applied)."
        : m.replace(/^ERROR:\s*/i, "").replace(/^./, c => c.toUpperCase())};
    }
    await this.refreshPane();
  },
  // round 15 (F3): the posting settings of a computer, saved by an owner -> tally_device_post_settings(p_device, p_post_only
  // (names; [] = any company), p_bills, p_bank (1..500)); the bridge applies them at its next heartbeat (info.beat.postOnly,
  // postBatchBills, postBatchBank, settingsAt). Checked here first: the words stay on the line, nothing is sent
  postSettingsCheck(v){
    const n = k => { const x = Math.floor(num(v[k])); return x >= 1 && x <= 500 ? x : null; };
    if (!n("bills")) return "Bills per request must be a number from 1 to 500.";
    if (!n("bank")) return "Bank lines per request must be a number from 1 to 500.";
    return "";
  },
  postSettingsNames(text){ const seen = new Set(); return String(text || "").split(/[,\n;]/).map(x => x.trim()).filter(x => x && !seen.has(x.toUpperCase()) && seen.add(x.toUpperCase())).slice(0, 20); },
  // v.only0 is the names box as the editor opened: left as it was, p_post_only goes as null (the row's list, and an
  // installer-set PostOnly, stay); emptied from a named list, the owner is asked first (review of 2.1.8, must-fix)
  async postSettings(dev, v){
    const why = this.postSettingsCheck(v);
    if (why) return why;
    const names = this.postSettingsNames(v.only), was = this.postSettingsNames(v.only0), touched = JSON.stringify(names) !== JSON.stringify(was);
    if (touched && !names.length && was.length){
      const a = await askConfirm({title: "Posting to any company from this computer?", ok: "Yes, any company", danger: true,
        body: "<p>" + esc(dev.name || "This computer") + " now posts only to " + esc(was.join(", ")) + ". With the list empty, FinCom Bridge there posts into whichever Tally company a client is set to, and the list set by its installer goes.</p>"});
      if (!a || !a.ok) return "Nothing sent: the list stays as it was.";
    }
    await this.control("tally_device_post_settings", {p_device: dev.id, p_post_only: touched ? names : null, p_bills: Math.floor(num(v.bills)), p_bank: Math.floor(num(v.bank))},
      "Saved for " + (dev.name || "the computer") + "; the bridge applies it within a minute.");
    return "";
  },
  // round 19: an owner switches the trial tools of one computer on or off -> tally_device_trial_tools(p_device, p_on)
  // (migration 46; owner only there too); the bridge applies it at its next heartbeat (within 30 seconds)
  async trialTools(dev, on){
    await this.control("tally_device_trial_tools", {p_device: dev.id, p_on: !!on},
      "Trial tools " + (on ? "on" : "off") + " for " + (dev.name || "the computer") + "; the bridge applies it within 30 seconds.");
  },
  // round 20 (d.3): an owner picks where a computer's changes come from -> tally_device_recorder_source(p_device,
  // p_source) (migration 47; owner only there too); the bridge takes it from its next heartbeat's answer
  RECORDER_SOURCES: [["addon", "the add-on"], ["alterid", "Tally’s change list"], ["both", "both"]],
  async recorderSource(dev, src){
    const w = (this.RECORDER_SOURCES.find(x => x[0] === src) || [])[1];
    if (!w) return;
    await this.control("tally_device_recorder_source", {p_device: dev.id, p_source: src},
      "Changes on " + (dev.name || "the computer") + " now come from " + w + "; the bridge takes it within 30 seconds.");
  },
  async readStop(r){
    const all = !r, where = all ? "every computer" : r.computer;
    const a = await askConfirm({title: all ? "Stop reading Tally on all computers?" : "Stop reading Tally on " + r.computer + "?", ok: "Stop reading",
      body: "<p>FinCom Bridge on " + esc(where) + " stops reading Tally at its next heartbeat (within 30 seconds). Posting to Tally goes on. Reading starts again only when an owner presses Resume reading.</p>" +
        '<div class="bk-form one"><label><span>Why (shown on the Tally page and by the bridge)</span><input id="readStopWhy" maxlength="300" placeholder="Stopped from FinCom"></label></div>',
      read: () => ({why: ((document.getElementById("readStopWhy") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    await this.control("tally_read_stop", {p_device: all ? null : r.device.id, p_reason: (a.data && a.data.why) || ""}, "Reading stopped on " + where + "; it stops within 30 seconds.");
  },
  async readResume(r){
    await this.control("tally_read_resume", {p_device: r ? r.device.id : null}, "Reading resumes on " + (r ? r.computer : "every computer") + " within 30 seconds.");
  },
  // the owner's rule of 05-Oct-2026 (migration 54): new versions go to every computer by themselves; an owner HOLDS a
  // version (no bridge takes it; a reason is required, kept with who and when), lets it go again, rolls every bridge back
  // to an earlier version (until cleared), and clears that rollback
  async releaseHold(v){
    const a = await askConfirm({title: "Hold version " + v + "?", ok: "Hold it",
      body: "<p>No bridge of the firm takes FinCom Bridge " + esc(v) + " until you let it go; the ones running it keep running.</p>" +
        '<div class="bk-form one"><label><span>Why (kept with the version, shown on this page)</span><input id="holdWhy" maxlength="500" placeholder="What went wrong"></label></div>',
      read: () => ({why: ((document.getElementById("holdWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say why the version is held."});
    if (!a || !a.ok) return;
    await this.control("tally_release_hold", {p_version: v, p_why: a.data.why}, "Version " + v + " is held: no bridge takes it.");
  },
  async releaseUnhold(v){
    const a = await askConfirm({title: "Let version " + v + " go?", ok: "Let it go",
      body: "<p>Every bridge of the firm takes FinCom Bridge " + esc(v) + " by itself again, within a few hours.</p>" +
        '<div class="bk-form one"><label><span>Note (kept)</span><input id="unholdWhy" maxlength="500" placeholder="What was put right"></label></div>',
      read: () => ({why: ((document.getElementById("unholdWhy") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    await this.control("tally_release_unhold", {p_version: v, p_why: (a.data && a.data.why) || ""}, "Version " + v + " goes to every computer again.");
  },
  async releaseRollback(){
    const a = await askConfirm({title: "Roll every bridge back to an earlier version?", ok: "Roll back",
      body: "<p>Each bridge of the firm that keeps that version from its last update puts it back by itself, and no bridge takes a newer version until you clear the rollback. A bridge that does not keep it stays as it is and says so in its log.</p>" +
        '<div class="bk-form one"><label><span>Version (like 2.2.4)</span><input id="rollbackVersion" maxlength="20" placeholder="2.2.4"></label>' +
        '<label><span>Why (kept, shown on this page)</span><input id="rollbackWhy" maxlength="500" placeholder="What went wrong"></label></div>',
      read: () => ({version: ((document.getElementById("rollbackVersion") || {}).value || "").trim(), why: ((document.getElementById("rollbackWhy") || {}).value || "").trim()}),
      validate: d => !d || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(d.version) ? "Give the version, like 2.2.4." : !d.why ? "Say why." : ""});
    if (!a || !a.ok) return;
    await this.control("tally_release_rollback", {p_version: a.data.version, p_why: a.data.why}, "Every bridge goes back to version " + a.data.version + " (where it is kept); no newer version until you clear it.");
  },
  async releaseRollbackClear(){
    const a = await askConfirm({title: "Clear the rollback?", ok: "Clear it", body: "<p>Every bridge takes the newest version by itself again, within a few hours.</p>"});
    if (!a || !a.ok) return;
    await this.control("tally_release_rollback_clear", {p_why: ""}, "The rollback is cleared; the bridges update themselves again.");
  },
  // round 4, item 23: an owner withdraws a version on trial or approved (a reason is required; the cloud's beat gives it
  // to no computer any more; a new pilot of it is allowed)
  async releaseWithdraw(v){
    const a = await askConfirm({title: "Withdraw version " + v + "?", ok: "Withdraw it",
      body: "<p>No computer of the firm gets FinCom Bridge " + esc(v) + " from FinCom\u2019s cloud any more; the ones running it keep running. It can be tried on one computer again later.</p>" +
        '<div class="bk-form one"><label><span>Why (kept with the version, shown on this page)</span><input id="withdrawWhy" maxlength="500" placeholder="What went wrong"></label></div>',
      read: () => ({why: ((document.getElementById("withdrawWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say why the version is withdrawn."});
    if (!a || !a.ok) return;
    await this.control("tally_release_withdraw", {p_version: v, p_why: a.data.why}, "Version " + v + " is withdrawn.");
  },
  // item 10: an owner clears "needs a fresh baseline" on a book (with a note); the bridge reads the company afresh
  // FinCom 2.4.1 (migration 71): the books open in more than one data location: [{book, company, cid, list: [source row +
  // n (①, ②: by first seen)]}]
  sourceBooks(){
    const p = this.pane, by = new Map();
    (p.sources || []).forEach(x => { if (x && x.book_id){ if (!by.has(x.book_id)) by.set(x.book_id, []); by.get(x.book_id).push(x); } });
    // the re-review of next-241, N2: a lone location waiting for the owner's choice (pending) gets its card too (its lines
    // are held until it is chosen)
    return [...by.entries()].filter(([, l]) => l.length > 1 || l.some(x => x.choice === "pending")).map(([book, l]) => {
      const b = (p.books || []).find(y => y.book_id === book) || {};
      l = l.slice().sort((a, c) => String(a.first_seen || "").localeCompare(String(c.first_seen || "")) || num(a.id) - num(c.id));
      return {book, company: b.company || "This company", cid: b.client_id || "", list: l.map((x, i) => Object.assign({}, x, {n: i < 20 ? String.fromCharCode(0x2460 + i) : "(" + (i + 1) + ")"}))};
    });
  },
  // the re-review (Low): every location on one computer (one folder under two paths there, e.g. D:\TallyData and Z:\)
  sourceOnePc(l){ const pcs = new Set((l || []).map(x => String(x.computer || "").toLowerCase())); return (l || []).length > 1 && pcs.size === 1 && !pcs.has(""); },
  // an owner chooses which data location is the books (tally_company_source_choose: that one chosen, the others not,
  // the starting point cleared so the chosen location records it afresh); FinCom reads only that one from then on
  // The coordinator, 09-Oct-2026: asked once first (it changes what FinCom reads and clears the starting point)
  async sourceChoose(book, dataId, n, company){
    const g = (this.sourceBooks() || []).find(x => x.book === book), x = g && g.list.find(y => y.data_id === dataId);
    const others = g ? g.list.filter(y => y.data_id !== dataId).map(y => y.n).join(", ") : "the other location";
    const where = x ? [x.computer || "a computer", x.path || "its data folder"].join(" \u00b7 ") : "";
    const a = await askConfirm({title: "Read " + company + " from " + n + "?", ok: "Use " + n,
      body: esc("FinCom will read " + company + " from " + n + (where ? " (" + where + ")" : "") + " from now on. " + (others ? "Entries from " + others + " will be held, not used. You'll need to upload " + n + "'s Day Book for the year. " : "The entries held from it are put in the books. ") + "Continue?")});
    if (!a || !a.ok) return;
    // the security re-check SR2-M2: the locations this card showed; FinCom refuses when they changed meanwhile
    await this.control("tally_company_source_choose", {p_book: book, p_data_id: dataId, p_seen: g ? g.list.map(y => y.data_id) : [dataId]}, "FinCom now reads " + n + " of " + company + ".");
  },
  // review H5 of next-241: "These are the same data (both computers read it)": one data folder under two paths (the
  // server's D:\TallyData, a client's \\SERVER\TallyData or Z:\). Asked once; then every location is read, and the entries
  // held from them are put in the books (tally_company_source_same)
  async sourceSame(book, company){
    // the re-review (Low): only the locations waiting for a choice (pending) join the ones FinCom reads; never one set 'other'
    const g = (this.sourceBooks() || []).find(x => x.book === book), l = g ? g.list.filter(y => y.choice !== "other") : [], ns = l.map(y => y.n);
    const both = ns.length > 1 ? ns.slice(0, -1).join(", ") + " and " + ns[ns.length - 1] : ns.join("");
    const onePc = TCloud.sourceOnePc(l);
    const a = await askConfirm({title: "Are these the same data?", ok: "They are the same data",
      body: esc("FinCom will read " + company + " from " + both + " as the same data (" + (onePc ? "both data folders are one folder" : "both computers read one data folder") + "). The entries held from them are put in the books. Continue?")});
    if (!a || !a.ok) return;
    // SR2-M2: the locations the card showed waiting for a choice (FinCom refuses when they changed meanwhile)
    await this.control("tally_company_source_same", {p_book: book, p_pending: g ? g.list.filter(y => y.choice === "pending").map(y => y.data_id) : []}, "FinCom reads " + both + " of " + company + " as the same data.");
  },
  async baselineClear(book, company){
    const a = await askConfirm({title: "Clear the baseline of " + company + "?", ok: "Clear it",
      body: "<p>FinCom\u2019s cloud stops holding " + esc(company) + " back; the bridge reads the whole company again from Tally at its next round, and the copy here follows it.</p>" +
        '<div class="bk-form one"><label><span>Note (why it is cleared; kept with the book)</span><input id="baselineNote" maxlength="500" placeholder="What happened in Tally"></label></div>',
      read: () => ({note: ((document.getElementById("baselineNote") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    await this.control("tally_baseline_clear", {p_book: book, p_note: (a.data && a.data.note) || ""}, "The baseline of " + company + " is cleared; the bridge reads it afresh.");
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
      // the owner's condition: a computer key is made, and handed over, only for a bridge that proved itself
      if (!(await Bridge.ensureProven())) return;
      const s = await Bridge.call("/cloudlink", null, 15000);
      if (!s.connected || s.url !== this.ingestUrl()){
        // review M2 of 2.3.0: a computer key is made only when the bridge proved itself in this same step (a squatter that
        // took the port since the call above gets no key made for it); Bridge.call proves it again before handing it over
        if (!(await Bridge.ensureProven())) return;
        this.autoAt = Date.now() + 30 * 60000;
        // 2.3.0: one key per Windows user's bridge: "<PC> · <Windows user>"
        const d = await this.rpc("tally_device_create", {p_name: String([Bridge.st.computer || "Office computer", Bridge.st.user || ""].filter(Boolean).join(" \u00b7 ")).slice(0, 80)});
        await Bridge.call("/cloudlink", {url: this.ingestUrl(), key: d.key}, 60000);
        this.autoAt = Date.now() + 60000;
      }
      // the owner's rule of 05-Oct-2026: this browser's own bridge is the member's (self-linked); on a computer key shared
      // with another Windows user whose bridge is the main one, it gets a key of its own
      if (await this.autoOwn()) return;
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
  // after pairing (TCloud.auto): #4 the member is linked to this browser's own proven bridge when they are linked to none
  // (or to one FinCom no longer hears from), unless it posts for another member. Final review M3: a member's own bridge is
  // one on a computer key that member made; when this browser's bridge reports through a key another member made (1.15.0's
  // settings carried over), or one whose main bridge is ANOTHER Windows user's (#7), a fresh key is made for this user and
  // handed to the bridge, which moves its identity to it itself (it holds both keys: tally-ingest's own_key; its postings
  // and links go with it); no owner, no member move. The member is linked on the next pass. true when a new key was handed
  // over. An older cloud without migration 54: nothing done
  async autoOwn(){
    const me = this.me(), id = (Bridge.cfg() || {}).bridgeId || "";
    if (!me || !/^go-[0-9a-f]{6,32}$/.test(id)) return false;
    try {
      const devs = [].concat(await Cloud.api("tally_devices?select=id,name,main_bridge,info,created_by,revoked") || []).filter(d => !d.revoked);
      const d = devs.find(x => x.info && x.info.bridges && x.info.bridges[id]);
      if (!d) return false;                                                  // not reported yet: next time
      const bs = d.info.bridges, u = (x) => String((x && x.user) || "").trim().toLowerCase();
      const links = [].concat(await Cloud.api("tally_member_bridges?select=user_id,device_id,bridge_id") || []);
      const mine = links.find(l => l.user_id === me && l.bridge_id), taken = links.some(l => l.user_id !== me && l.bridge_id === id && l.device_id === d.id);
      if (taken) return false;
      const shared = d.main_bridge && d.main_bridge !== id && bs[d.main_bridge] && u(bs[d.main_bridge]) !== u(bs[id]);
      if (shared || !this.mayLinkSelf({device: d})){
        this.autoAt = Date.now() + 30 * 60000;                               // one key at a time (no pile of keys if the move is refused)
        const k = await this.rpc("tally_device_create", {p_name: String([Bridge.st.computer || bs[id].computer || "Office computer", Bridge.st.user || bs[id].user || ""].filter(Boolean).join(" \u00b7 ")).slice(0, 80)});
        await Bridge.call("/cloudlink", {url: this.ingestUrl(), key: k.key}, 60000);
        this.autoAt = Date.now() + 60000;
        return true;
      }
      const heard = mine && devs.some(x => x.id === mine.device_id && x.info && x.info.bridges && x.info.bridges[mine.bridge_id]);
      if (!mine || !heard){
        await this.rpc("tally_member_bridge_link", {p_user: me, p_device: d.id, p_bridge: id});
        this.pane.links = links.filter(l => l.user_id !== me).concat([{user_id: me, device_id: d.id, bridge_id: id}]);
      }
    } catch (e){ this.autoErr = (e && e.message) || String(e); }
    return false;
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

// the latest resume a computer (and for all computers, key "all") out of tally_read_stops: a 'resume' row, or a stop
// cleared (cleared_by, cleared_at): {by, at}
function resumeRows(all){
  const out = {};
  [].concat(all || []).forEach(x => {
    const k = x.device_id || "all";
    const r = x.action === "resume" ? {by: x.stopped_by || "", at: x.stopped_at || ""} : x.cleared_at ? {by: x.cleared_by || "", at: x.cleared_at} : null;
    if (r && (!out[k] || String(r.at) > String(out[k].at))) out[k] = r;
  });
  return out;
}
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
    const r = await fetch(TCloud.ingestUrl(), {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: JSON.stringify(Object.assign({}, who || {client: S.coId, company: BridgeSeed.company()}, body))});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false){ const e = new Error(j.error || ("FinCom's cloud answered with error " + r.status)); e.status = r.status; throw e; }
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
        try { const r = await this.handOver(x.blob, {from: x.from, to: x.to}, onStep, x.who, x.name); if (r && r.days != null){ await this.drop(k); sent++; } }
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
  // round 20 (d.2): src is the file (a Blob) or its text. The file goes to Storage first (storageUp); a cloud without
  // upload_new gets the old hand-over below, a part at a time
  async handOver(src, range, onStep, who, name){
    if (!this.on()) return {skipped: "not signed in to the firm account"};
    who = who || {client: S.coId, company: BridgeSeed.company()};
    if (typeof Blob === "function" && typeof IDBStore === "object"){
      const up = await this.storageUp(src instanceof Blob ? src : new Blob([String(src)], {type: "text/xml"}), range, onStep, who, name);
      if (up) return up;
    }
    // a Tally export is often UTF-16LE: decoded by its byte-order mark (Blob.text() is UTF-8 only)
    const text = typeof src === "string" ? src : (await Books.decoder(src)).decode(new Uint8Array(await src.arrayBuffer()));
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
  // ---------- round 20 (d.2): a Day Book through Storage (migration 47: the bucket tally-uploads, the job kind upload).
  // tally-ingest upload_new {client, name, size} -> {job, path}; the file goes to Storage by the resumable (TUS 1.0.0)
  // protocol in 6 MB chunks (a cut connection: HEAD for the server's offset, then on from there; the upload's address is
  // kept in this browser's store under "tus:<client>:<from>-<to>:<size>", so a reload goes on where it stopped); then
  // upload_done {job, path}, and FinCom's server splits it into days even if this page is closed. Its progress is the
  // tally_jobs row (jobLine: "Day Book 2026-27: 143 of 365 days read"). null: the cloud has no upload_new (400 "unknown
  // kind", or 404), and the caller hands it over the old way
  CHUNK: 6 * 1024 * 1024,
  tusWait: [1000, 3000, 8000, 15000, 30000],
  prog: {},                // client -> {name, sent, size} while its Day Book goes to Storage (the progress bar)
  periods: {},             // job -> the period its line says
  unknownKind(e){ return /unknown kind/i.test(String((e && e.message) || e)) || (e && e.status === 404); },
  period(range){
    const f = String(range.from || ""), t = String(range.to || ""), y = num(f.slice(0, 4));
    if (f.slice(4) === "0401" && t === (y + 1) + "0331") return y + "-" + String(y + 1).slice(2);
    return fmtDate(tallyDate(f)) + " to " + fmtDate(tallyDate(t));
  },
  periodSave(job, range){
    this.periods[job] = this.period(range);
    try { const m = JSON.parse(localStorage.getItem("tcup-periods") || "{}"); m[job] = this.periods[job]; const ks = Object.keys(m); ks.slice(0, Math.max(0, ks.length - 50)).forEach(k => delete m[k]); localStorage.setItem("tcup-periods", JSON.stringify(m)); } catch (e){}
  },
  periodOf(j){
    if (this.periods[j.id]) return this.periods[j.id];
    try { const m = JSON.parse(localStorage.getItem("tcup-periods") || "{}"); if (m[j.id]) return (this.periods[j.id] = m[j.id]); } catch (e){}
    return "";
  },
  async storageUp(blob, range, onStep, who, name){
    const key = "tus:" + who.client + ":" + range.from + "-" + range.to + ":" + blob.size;
    const keep = async rec => { try { await IDBStore.write([[key, rec]]); } catch (e){} };
    let rec = null;
    try { rec = await IDBStore.get(key); } catch (e){}
    if (!rec || !rec.job || !rec.path){
      let j;
      try { j = await this.post({kind: "upload_new", name: String(name || "").slice(0, 120), size: blob.size, from: range.from, to: range.to}, who); }
      catch (e){ if (this.unknownKind(e)) return null; throw e; }
      if (!j || !j.job || !j.path) return null;
      rec = {job: j.job, path: j.path, url: "", size: blob.size, name: String(name || ""), at: new Date().toISOString()};
      await keep(rec);
    }
    this.periodSave(rec.job, range);
    if (!rec.uploaded){
      try { await this.tus(blob, rec, keep, who.client, onStep); }
      finally { delete this.prog[who.client]; if (typeof render === "function") render(); }
      rec.uploaded = true; await keep(rec);
    }
    if (onStep) onStep("The day book is in FinCom’s cloud; FinCom’s server reads it now…");
    await this.post({kind: "upload_done", job: rec.job, path: rec.path}, who);
    try { await IDBStore.write([[key, null]]); } catch (e){}
    let days = 0; for (let d = range.from; d <= range.to; d = BridgeSeed.add(d, 1)) days++;
    try { TCloud.jobsLoad(who.client); } catch (e){}
    return {days, job: rec.job, storage: true};
  },
  async tusHeaders(){
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess();
    if (!s) throw new Error("Sign in to the firm account first.");
    return {apikey: c.key, authorization: "Bearer " + s.access_token, "Tus-Resumable": "1.0.0"};
  },
  // the server's offset of an upload: a number, or null when the upload is gone (expired, or never made)
  async tusHead(url){
    const r = await fetch(url, {method: "HEAD", headers: await this.tusHeaders(), cache: "no-store"});
    if (r.status === 404 || r.status === 410 || r.status === 403) return null;
    if (!r.ok) throw new Error("Storage answered " + r.status);
    const o = Number(r.headers.get("Upload-Offset"));
    return Number.isFinite(o) ? o : 0;
  },
  async tusCreate(blob, rec, keep){
    const base = Cloud.cfg().url.replace(/\/+$/, "") + "/storage/v1/upload/resumable";
    const b64 = v => btoa(unescape(encodeURIComponent(String(v))));
    const meta = [["bucketName", "tally-uploads"], ["objectName", rec.path], ["contentType", blob.type || "text/xml"]].map(([k, v]) => k + " " + b64(v)).join(",");
    const r = await fetch(base, {method: "POST", headers: Object.assign(await this.tusHeaders(), {"Upload-Length": String(blob.size), "Upload-Metadata": meta, "x-upsert": "false"})});
    if (!r.ok){ const t = await r.text().catch(() => ""); throw new Error("Storage did not take the day book (" + r.status + (t ? ": " + t.slice(0, 160) : "") + ")"); }
    const loc = r.headers.get("Location");
    if (!loc) throw new Error("Storage gave no address for the upload.");
    rec.url = new URL(loc, base).href;
    await keep(rec);
  },
  async tus(blob, rec, keep, cid, onStep){
    const size = blob.size, name = rec.name || "the day book";
    let off = 0, fails = 0;
    if (rec.url){ const h = await this.tusHead(rec.url).catch(() => undefined); if (h === null) rec.url = ""; else if (typeof h === "number") off = h; }
    if (!rec.url) await this.tusCreate(blob, rec, keep);
    const say = () => { this.prog[cid] = {name, sent: off, size}; if (onStep) onStep("Sending the day book to FinCom’s cloud (" + Math.floor(off * 100 / (size || 1)) + "%)…"); if (typeof render === "function") render(); };
    while (off < size){
      say();
      const end = Math.min(size, off + this.CHUNK);
      let why = "";
      try {
        const r = await fetch(rec.url, {method: "PATCH", headers: Object.assign(await this.tusHeaders(), {"Upload-Offset": String(off), "Content-Type": "application/offset+octet-stream"}), body: blob.slice(off, end)});
        if (r.ok){ const o = Number(r.headers.get("Upload-Offset")); off = Number.isFinite(o) && o > off && o <= size ? o : end; fails = 0; continue; }
        why = "Storage answered " + r.status;
      } catch (e){ why = (e && e.message) || String(e); }
      if (fails >= this.tusWait.length) throw new Error("The day book stopped at " + Math.floor(off * 100 / (size || 1)) + "% on its way to FinCom’s cloud (" + why + "). It goes on from there the next time this client is opened.");
      await new Promise(ok => setTimeout(ok, this.tusWait[fails++]));
      // where the server is: on from there (a cut chunk may have arrived in part); gone: made again from the start
      let h;
      try { h = await this.tusHead(rec.url); } catch (e){ h = undefined; }
      if (h === null){ off = 0; await this.tusCreate(blob, rec, keep); }
      else if (typeof h === "number") off = h;
    }
    this.prog[cid] = {name, sent: size, size};
  },
  // migration-34 (round 2): the ledgers here come from a trial balance file (TBFile.read, Books → From Tally), which may
  // leave out ledgers with a nil balance; so the list is never declared complete (complete:false, no count) and the cloud
  // marks nothing missing from it: it adds, brings up to date and un-marks only. Only a list parsed from a Master.xml
  // could say complete:true with the count parsed; FinCom has no such upload today
  async opening(from, asOn, led, who){
    if (!this.on()) return {skipped: "not signed in to the firm account"};
    return this.post({kind: "upload_ledgers", from, openAsOn: asOn, complete: false, ledgers: Object.entries(led).map(([n, x]) => [n, x.parent || "", String(x.open)])}, who);
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
    if (!TCloud.on() || this.st.busy || Date.now() - this.st.at < 30000) return this.st.p || Promise.resolve();
    this.st.busy = true;
    // round 4, item 25: the stops from FinCom still standing, with who and when (null when they cannot be read: before
    // migration-35; then the computer's info.readStop alone says it)
    return this.st.p = Promise.all([TCloud.restAll("tally_companies?select=company,client_id,device_id,gstin,linked_at&order=company.asc"), Cloud.api("tally_devices?select=id,name,last_seen,info,revoked"),
        Cloud.api("tally_read_stops?select=id,device_id,action,reason,stopped_at,stopped_by&action=eq.stop&cleared_at=is.null&order=id.desc").then(r => [].concat(r || []), () => null)])
      .then(([cos, devs, stops]) => {
        this.st.devs = (devs || []).filter(d => !d.revoked); this.st.cos = cos || []; this.st.stops = stops;
        this.st.by = this.work((cos || []).filter(c => c.client_id), devs || [], Date.now());
        linkByGstin(this.st.cos);
      }, () => {})
      .then(() => {
        this.st.at = Date.now(); this.st.busy = false;
        // the top bar follows a change of state at once; nothing else is redrawn while someone types. The open client's
        // last read and "reading now" are part of it (review of 02-Oct-2026: the Post page said "last read 15:34" at
        // 17:43 because a new read time alone never drew the page again)
        const co = typeof CO === "function" && S.view === "company" ? CO() : null, l = co ? tallyLine(co) : null;
        const sig = JSON.stringify([tallyStatus(co).parts || {}, l ? [l.state, l.read, l.reading] : null]);
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
//   "Connected · Tally open on NWS144 · last read 15:34" | "Tally not open on NWS144" | "NWS144 is offline" |
//   "Tally is not answering on NWS144 since 12:28" | "Reading paused on NWS144" (FinCom 2.3.5: the cards' words)
// {state: open | closed | offline | notanswering | paused, level, text, computer, read}; null when no Tally computer
// keeps this client's company (and the bridge here does not have it open)
function tallyHm(t){
  const ms = typeof t === "number" ? t : Date.parse(String(t || ""));
  if (!ms) return "";
  return istDay(ms) === istDay(Date.now()) ? fmtTime(ms) : fmtDateTime(ms);
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
  // "Reading now…": the bridge says a read is going on (beat.updating), or Update now was asked here and no newer read
  // has come in yet (for three minutes at most)
  const ask = TallyAsk[co.id], updating = !!(beat && beat.updating);
  const reading = updating || !!(ask && now - ask.at < 180000 && !((Date.parse(read || 0) || 0) > ask.before));
  const o = (state, level, text) => ({state, level, text, computer: comp, read, reading});
  // FinCom 2.3.5: the same words as the Tally page's cards (Connected / Offline / Tally not open / Reading stopped / paused)
  if (bridge === "offline" || bridge === "none") return o("offline", "bad", comp + " is offline");
  // round 4, item 25: a stop from FinCom on the client's computer (or on all computers) comes before everything but
  // offline: "Reading stopped by <name> at <time>: <reason>"; the line's Resume (owners) and Update now look at .stop
  const stop = dev ? tallyStopOn(dev) : null;
  if (stop) return Object.assign(o("stopped", "bad", "Reading stopped " + (stop.who ? "by " + stop.who : "from FinCom") + (stop.at ? " at " + tallyHm(stop.at) : "") + ": " + (stop.reason || "no reason given")), {stop});
  if (tally === "closed") return o("closed", "warn", "Tally not open on " + comp);
  if (since) return o("notanswering", "bad", "Tally is not answering on " + comp + " since " + tallyHm(since));
  if (paused) return o("paused", "warn", "Reading paused on " + comp);
  return o("open", "ok", "Connected \u00b7 Tally open on " + comp + (read ? " \u00b7 last read " + tallyHm(read) : ""));
}
// the stop from FinCom standing on a computer, as the per-client line needs it: the one for all computers, else the
// computer's own (tally_read_stops read by TLight, or by the Tally page), else the computer's info.readStop from its
// heartbeat (no name then). {who, at, reason, all, deviceId, computer} or null
function tallyStopOn(dev){
  const st = (typeof TLight === "object" && TLight.st) || {}, lists = [st.stops, typeof TCloud === "object" && TCloud.pane && !TCloud.pane.noControl ? TCloud.pane.stops : null];
  const list = lists.find(l => Array.isArray(l));
  let row = null, all = false;
  if (list){ const a = list.find(x => !x.device_id && !x.cleared_at), own = list.find(x => x.device_id === dev.id && !x.cleared_at); row = a || own || null; all = !!a; }
  // with a list at hand it decides (a computer's readStop can lag a resume by one heartbeat); without one, the heartbeat
  const rs = !list && dev.info ? dev.info.readStop : null;
  if (!row && !(rs && (rs.by === "fincom" || (rs.reason && !rs.by)))) return null;
  const who = row && row.stopped_by && typeof memberName === "function" ? memberName(row.stopped_by) : "";
  return {who, at: (row && row.stopped_at) || (rs && rs.at) || "", reason: (row && row.reason) || (rs && rs.reason) || "", all, deviceId: dev.id, computer: (dev.info && dev.info.computer) || dev.name || ""};
}
// the stop standing on the computer that keeps a client's company (null when none)
function tallyStopFor(cid){
  const co = S.companies && S.companies[cid];
  const l = co ? tallyLine(co) : null;
  return l && l.state === "stopped" ? l.stop : null;
}
// Update now asked here, per client: {at, before (the last read then)}, for "Reading now…" until a newer read comes in
const TallyAsk = {};
function tallyAskedRead(cid){
  const co = S.companies && S.companies[cid];
  let before = 0; try { const l = co ? tallyLine(co) : null; before = Date.parse((l && l.read) || 0) || 0; } catch (e){}
  TallyAsk[cid] = {at: Date.now(), before};
  try { if (typeof TLight === "object") TLight.st.at = 0; } catch (e){}
}
// a heartbeat passed on at once by FinCom's cloud (tally-ingest broadcasts "beat" on the firm's channel when the last
// read, a read going on, or Tally's state changed; Live in src/js/54): the computer's beat as FinCom keeps it, merged
Object.assign(TLight, {
  beatIn(m){
    if (!m || !m.device || !m.beat || typeof m.beat !== "object") return false;
    let hit = false;
    [].concat(this.st.devs || [], (TCloud.pane && TCloud.pane.devices) || []).forEach(d => {
      if (!d || d.id !== m.device) return;
      d.info = Object.assign({}, d.info || {}); d.info.beat = Object.assign({}, d.info.beat || {}, m.beat); hit = true;
      // 2.1.5 (migration-35): the bridge's own entry follows too (its requests, a stop by itself, paused, when heard
      // from), and the stop from FinCom standing for this computer
      const bid = m.beat.bridge;
      if (bid && d.info.bridges && d.info.bridges[bid]){
        const b = Object.assign({}, d.info.bridges[bid]);
        ["reqs", "readStopped", "paused", "at", "tallyState", "open", "tallyRetry"].forEach(k => { if (m.beat[k] !== undefined) b[k] = m.beat[k]; });
        d.info.bridges = Object.assign({}, d.info.bridges, {[bid]: b});
      }
      if (m.beat.readStop !== undefined) d.info.readStop = m.beat.readStop;
    });
    if (hit) render();
    else { this.st.at = 0; this.refresh(); }
    return hit;
  },
  // the Post page and the Tally panel look again every 30 s while they are open (a read may have come in), and every
  // few seconds while a read asked for here is awaited
  tick(){
    if (typeof document !== "object" || document.visibilityState !== "visible" || !TCloud.on() || S.view !== "company") return;
    const cid = S.coId, ask = TallyAsk[cid];
    if (ask && Date.now() - ask.at < 180000 && Date.now() - this.st.at > 5000) this.st.at = 0;
    this.refresh();
  }
});
if (typeof setInterval === "function") setInterval(() => { try { TLight.tick(); } catch (e){} }, 5000);
// when the client's books were last read from Tally ("Books as of 15:34"): the bridge's last read of its company, else
// when FinCom's copy was last brought in. Never shown as "now": entries made in Tally since then come at the next event
// the time "Books as of" gives, in plain words: FinCom Bridge's last read of the company from Tally (its readAt, the
// Tally computer's lastRead), its last check of FinCom's copy against Tally (state.seen), the last Day Book read into
// FinCom, or when the books on this page were brought in
const BOOKS_ASOF_WHY = {read: "the bridge's last read of this company in Tally", seen: "the bridge's last check of these books against Tally",
  daybook: "the last Day Book read into FinCom", books: "when these books were last brought into FinCom"};
function booksAsOf(cid){
  cid = cid || S.coId;
  const co = S.companies && S.companies[cid];
  const l = co ? tallyLine(co) : null, bk = typeof TCloud === "object" ? TCloud.book(cid) : null, st = (bk && bk.state) || {};
  const man = typeof LK === "object" && LK.fr && cid === S.coId ? ((LK.fr() || {}).man || {}) : {};
  // what the time is, said with it (the owner's finding of 05-Oct-2026: "books as of 13:59 IST" did not say what 13:59 was)
  const cands = [[l && l.read, "read"], [st.readAt, "read"], [man.readAt, "read"], [st.seen, "seen"], [man.seen, "seen"]].filter(x => x[0] && Date.parse(x[0]))
    .sort((a, b) => Date.parse(b[0]) - Date.parse(a[0]));
  let at = cands.length ? cands[0][0] : "", what = cands.length ? cands[0][1] : "";
  if (!at && S.books && S.books.cid === cid){
    const f = booksFresh(S.books, cid), m = S.books.meta || {};
    at = f.at; what = !at ? "" : at === String(st.seen || "") || at === String(man.seen || "") ? "seen" : /day book files/i.test(String(m.file || "")) ? "daybook" : "books";
  }
  if (!at) return null;
  return {at, what, why: BOOKS_ASOF_WHY[what] || "", text: "Books as of " + tallyHm(at) + (BOOKS_ASOF_WHY[what] ? " (" + BOOKS_ASOF_WHY[what] + ")" : ""),
    say: "Tally cannot send its changes by itself: entries made in Tally after " + tallyHm(at) + " come in at the next update (opening this client, Update now, or the nightly catch-up)."};
}
// FinCom Bridge 2.1.4 asks Tally for no balance (its /balances, /tb and /ledgerbalance answer only from its own copy, and
// on most companies with an error). The owner's decision of 02-Oct-2026: every balance FinCom shows (Look up, the books'
// opening balances, the bank check after a posting) is worked out from FinCom's cloud copy, openings plus entries, and
// is shown with this line, never with an error: "Balance from FinCom's copy · books as of 15:34"
function copyLine(cid){ const a = booksAsOf(cid); return "Balance from FinCom's copy \u00b7 books as of " + (a ? tallyHm(a.at) + (a.why ? " (" + a.why + ")" : "") : "the last update"); }
Object.assign(TCloud, {
  // the view tally_balances (migration-32): each ledger's opening, its entries from the book's start, and the closing.
  // The source of every balance from FinCom's copy. null: not asked yet; false: not on this cloud (an older environment
  // without migration-32: then, and only then, tally_tb / tally_ledger / the ledger masters, as before). Any other error
  // reading the view is shown as an error, never answered from the older functions
  hasView: null,
  async viewRows(bk){
    if (this.hasView === false || !bk || !bk.book) return null;
    try {
      const rows = await this.restAll("tally_balances?select=ledger,parent,open,closing,last_day&book_id=eq." + encodeURIComponent(bk.book));
      this.hasView = true;
      // migration-32's view keeps the ledgers deleted in Tally (deleted_at); migration-33's leaves them out itself. Left
      // out here too, for a cloud with migration-32 only (one with a figure all the same is kept, so the total stays whole)
      const del = await this.deletedNames(bk);
      return del.size ? rows.filter(r => !(del.has(ledNm(r.ledger)) && !num(r.open) && !num(r.closing))) : rows;
    } catch (e){
      if (!/tally_balances|does not exist|PGRST2\d\d|schema cache|404/i.test(String((e && e.message) || e))) throw e;
      this.hasView = false;
      return null;
    }
  },
  // every ledger's opening, movement and closing on a date (Tally's signs: a debit is negative), from the view
  // tally_balances (migration-32, applied on staging 02-Oct-2026; migration-33 also leaves out deleted ledgers):
  //   - a date on or after the last day the copy holds: the view's closing;
  //   - a date inside the copy: the view's opening plus the entries from the book's first day to the date
  //     (tally_period over the same day totals the view sums, tally_ledger_day; amount = credit - debit).
  // Only where the view is missing (an older cloud without migration-32), or for a date before this book begins (an
  // earlier year, another book), the trial balance function tally_tb, as before
  // migration-37 (item 13): tally_balances_on(p_book, p_as_on) answers a date inside the copy in one request (opening,
  // movement and closing a ledger; deleted and merged ledgers left out). null when the function is not on this cloud
  // (then the view plus tally_period, as before); any other error is an error
  hasBalOn: null,
  async balOn(bk, asOn){
    if (this.hasBalOn === false || !bk || !bk.book) return null;
    try { const rows = await this.rpcAll("tally_balances_on", {p_book: bk.book, p_as_on: this.iso(asOn)}); this.hasBalOn = true; return [].concat(rows || []); }
    catch (e){
      if (!/tally_balances_on|PGRST202|Could not find the function|schema cache|does not exist|404/i.test(String((e && e.message) || e))) throw e;
      this.hasBalOn = false; return null;
    }
  },
  async balRows(cid, asOn){
    const bk = this.book(cid), from = bk ? this.d8(bk.from || "") : "", last = bk ? this.d8(bk.to || "") : "";
    asOn = String(asOn);
    if (bk && from && asOn >= from){
      if (!(last && asOn >= last)){
        const on = await this.balOn(bk, asOn);
        if (on) return on.map(r => ({ledger: r.ledger, parent: r.parent || "", open: num(r.open), movement: r2(num(r.movement)), closing: r2(num(r.closing))}));
      }
      const v = await this.viewRows(bk);
      if (v){
        if (last && asOn >= last) return v.map(r => ({ledger: r.ledger, parent: r.parent || "", open: r.open, movement: r2(num(r.closing) - num(r.open)), closing: r.closing}));
        return this.viewAt(v, await this.period(cid, from, asOn), bk);
      }
    }
    const rows = await this.rpcAll("tally_tb", {p_client: cid, p_as_on: this.iso(asOn)}) || [];
    const del = bk ? await this.deletedNames(bk) : new Set();
    // a ledger deleted in Tally has no entries left; one with a figure all the same is kept, so the total stays whole
    return del.size ? rows.filter(r => !(del.has(ledNm(r.ledger)) && !num(r.movement) && !num(r.closing))) : rows;
  },
  // the view's rows on a date inside the copy: each ledger's opening plus its entries to the date (per: tally_period from
  // the book's first day). Entries on a ledger with no row in the view (no master, or deleted in Tally with entries left)
  // are kept as rows of their own, so the trial balance stays whole
  viewAt(v, per, bk){
    const mv = new Map(), par = new Map();
    (per || []).forEach(r => { mv.set(r.ledger, r2((mv.get(r.ledger) || 0) + num(r.cr) - num(r.dr))); if (r.parent) par.set(r.ledger, r.parent); });
    const seen = new Set(), out = v.map(r => { const m = mv.get(r.ledger) || 0; seen.add(r.ledger); return {ledger: r.ledger, parent: r.parent || "", open: r.open, movement: m, closing: r2(num(r.open) + m)}; });
    mv.forEach((m, l) => { if (!seen.has(l) && Math.abs(m) >= 0.005) out.push({ledger: l, parent: par.get(l) || "", open: 0, movement: m, closing: m}); });
    return out;
  },
  // one ledger's balance at the end of a day, a debit positive: from the view (its closing, or its opening plus the
  // ledger's entries to the day, tally_ledger); only without the view, the opening of the next day (tally_ledger)
  async ledgerAt(cid, led, asOn){
    asOn = Audit.ymd(asOn);
    if (!this.on()) throw new Error("not signed in to the firm account");
    if (!this.has(cid)) await this.status(cid);
    const bk = this.book(cid);
    if (!bk) throw new Error("FinCom's copy of these books is not in the cloud yet");
    const from = this.d8(bk.from || ""), last = this.d8(bk.to || ""), k = ledNm(led);
    if (from && String(asOn) >= from){
      const v = await this.viewRows(bk);
      if (v){
        const hit = v.filter(r => ledNm(r.ledger) === k);
        if (last && String(asOn) >= last) return -r2(hit.reduce((t, r) => t + num(r.closing), 0));
        const j = await this.rpc("tally_ledger", {p_client: cid, p_ledger: led, p_from: this.iso(from), p_to: this.iso(asOn)});
        if (!j || j.none) throw new Error("FinCom's copy of these books does not reach " + FC.when(asOn) + " yet");
        const moved = [].concat(j.lines || []).reduce((t, x) => t + num(x[5]), 0);
        return -r2(hit.reduce((t, r) => t + num(r.open), 0) + moved);
      }
    }
    const next = Audit.ymd(addDays(Audit.iso(asOn), 1));
    const j = await this.rpc("tally_ledger", {p_client: cid, p_ledger: led, p_from: this.iso(next), p_to: this.iso(next)});
    if (!j || j.none) throw new Error("FinCom's copy of these books does not reach " + FC.when(asOn) + " yet");
    return -r2(num(j.open));
  },
  // the opening balances on a day, as TallyRead.balances takes them: from the view (its openings on the book's first day,
  // else its balances on the day before, TCloud.balRows); only without the view, the ledger masters' openings (on the
  // first day) or the cloud's trial balance on the day before (tally_tb)
  async openings(cid, from){
    if (!this.has(cid)) await this.status(cid);
    const bk = this.book(cid);
    if (!bk) return null;
    let rows = null;
    if (this.d8(bk.from) === String(from)){
      const v = await this.viewRows(bk);
      if (v) rows = v.map(r => ({name: r.ledger, parent: r.parent || "", open: String(r.open), close: ""}));
      if (!rows){ const led = await this.restAll("tally_ledgers?select=name,parent,open&merged_into=is.null&order=name&book_id=eq." + encodeURIComponent(bk.book)); rows = led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""})); }
    } else {
      const t = await this.balRows(cid, Audit.dayBefore(from)) || [];
      rows = t.map(r => ({name: r.ledger, parent: r.parent || "", open: String(r.closing), close: ""}));
    }
    return {ledgers: rows, from, openOnly: true, company: bk.company, line: copyLine(cid)};
  }
});
// The bank check after a posting counts only once each entry FinCom posted to the statement is read back: confirmed in
// Tally (read back after posting) and in FinCom's copy (the copy read after it was posted). The lines still waiting
function bankNotReadBack(rows, cid){
  const a = booksAsOf(cid), at = a ? Date.parse(a.at) : 0;
  return (rows || []).filter(r => r.state === "sent" && !r.postedOptional &&
    (r.checking || (r.postedVia === "bridge" && r.postVerified !== true && r.postByReply !== true) || (r.sentAt && (!at || Date.parse(r.sentAt) > at))));
}
// Update now for a client: the bridge here when it has the company open, else the client's Tally computer through
// FinCom's cloud (the bridge reads at once, also while its background reading is paused)
function tallyUpdateNow(cid){
  cid = cid || S.coId;
  // round 4, item 25: while FinCom has stopped reading on the client's computer, nothing is asked (the bridge would not
  // read anyway); the Tally page is where an owner resumes it
  const stop = tallyStopFor(cid);
  if (stop) return toast("Reading is stopped by " + (stop.who || "FinCom") + " (" + (stop.reason || "no reason given") + "); resume it on the Tally page");
  tallyAskedRead(cid); render();
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
// round 14c (C6, owner item 5): the cloud copy of a client may hold no entries for the current financial year. The one
// note for every screen that shows the books' figures (BooksAsOf, app/src/parts/TallyLine.jsx): the last entry known
// (the books here, else the cloud copy's end) is before 01-Apr of the current year. "" when there is nothing to say
function booksYearNote(cid){
  cid = cid || S.coId;
  const b = S.books && S.books.cid === cid ? S.books : null;
  let last = "";
  if (b) (b.vouchers || []).forEach(v => { if (v && !v.cancel && String(v.date) > last) last = String(v.date); });
  const bk = typeof TCloud === "object" && cid ? TCloud.book(cid) : null;
  const d8 = x => String(x || "").replace(/-/g, "").slice(0, 8);
  if (!last && bk) last = [d8(bk.to), d8((bk.state || {}).doneTo)].filter(Boolean).sort().pop() || "";
  if (!last) return "";
  const start = d8(fyStartEnd(fyOf(null)).from);
  return last < start ? "Current year not yet read from Tally; figures incomplete." : "";
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
  const hhmm = t => istDay(t) === istDay(Date.now()) ? fmtTime(t) : fmtDateTime(t);
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
  // nothing ready to post, but bills or postings that need a decision (Post to Tally → Needs your attention): not "in sync"
  const attn = cos.reduce((a, c) => a + (typeof postAttentionFor === "function" ? postAttentionFor(c.id) : 0), 0);
  if (attn > 0) return out({state: "attention", level: "warn", label: attn + " to check in Tally", say: attn + (attn === 1 ? " bill or posting needs" : " bills or postings need") + " your attention under Post to Tally" + (co ? "" : " (all clients)") + "."});
  // the owner's finding of 05-Oct-2026: a line Tally sent that is HELD (tally_recorder_lines.state = 'held') is not in the
  // books, so a book with one is never "in sync": "N received, not yet entered in the books", with the reasons
  const held = typeof AlertHub === "object" && AlertHub.heldFor ? AlertHub.heldFor(co ? [co.id] : cos.map(c => c.id)) : [];
  if (held.length) return out({state: "held", level: "warn", label: AlertHub.heldSay(held.map(l => ({held_why: ""})), true),
    say: held.length === 1 ? "1 entry " + AlertHub.heldSay(held) + "." : held.length + " entries received from Tally are not yet entered in the books" + (co ? "" : " (all clients)") + ": " + [...new Set(held.map(l => l.held_why || "no reason given"))].slice(0, 3).join("; ") + ". See Tally \u2192 Sync activity."});
  if (tally === "busy") return out({state: "busy", level: "warn", label: "Connected \u2013 Tally busy", say: "The bridge is connected. Tally is open but answering slowly" + (busySince ? " since " + fmtDateTime(Date.parse(busySince)) : "") + " (a long report, or a message box in Tally); the bridge asks again by itself and nothing is lost."});
  const light = co && typeof TLight === "object" ? TLight.st.by[co.id] : null;
  return out({state: "ok", level: "ok", label: "Connected & in sync", say: "Tally is connected" + (local ? " on this computer" : " (" + devs.length + " computer" + (devs.length === 1 ? "" : "s") + " sending)") + " and nothing waits to be sent." + (light ? " " + light.say : "")});
}
// The top bar's one Tally sign (owner's spec H, 04-Oct-2026): exactly two states. Connected = FinCom Bridge on a computer
// of this firm is online (its heartbeat recent: online, or one beat late) AND Tally is open there with THIS client's
// company (for the firm's own pages: with any company). Anything else is disconnected, with the reason and the fix:
//   bridge (not running / not heard from), internet (the bridge here runs but cannot reach FinCom), tally (TallyPrime
//   closed), nocompany (Tally open, no company), othercompany (a different company is open).
// From what the app already reads: the heartbeats (TLight.st.devs, info.beat: tallyState, open), the client's link
// (TLight.st.cos), and this computer's bridge (Bridge.st, and its beat.missedSince). A computer whose heartbeats stopped
// cannot say why from afar: unless this computer is the one (then its bridge says), the reason names both causes.
// {on, code, computer, company, at ("04-Oct-2026 14:05 IST"), reason, fix, words}
function tallyIst(t){
  // the one formatter for times (fmtDateTime, src/js/01: IST whatever this computer's clock)
  const ms = typeof t === "number" ? t : Date.parse(String(t || ""));
  return ms ? fmtDateTime(ms) : "";
}
// a computer as the owner knows it: its name in FinCom (tally_devices.name) and its Windows name from the heartbeat:
// "Office computer (NWS144)"; one of them alone when there is one, or they are the same
function tallyPcLabel(d){
  const info = (d && d.info) || {}, beat = info.beat || {};
  const name = String((d && d.name) || "").trim(), win = String(info.computer || beat.computer || beat.pc || beat.hostname || "").trim();
  return name && win && norm(name) !== norm(win) ? name + " (" + win + ")" : name || win || "the Tally computer";
}
function tallySign(co){
  if (typeof TLight === "object") TLight.refresh();
  const now = Date.now(), st = (typeof TLight === "object" && TLight.st) || {};
  const devs = (st.devs || []).filter(d => d && !d.revoked);
  const link = co ? (st.cos || []).find(c => c.client_id === co.id) : null;
  const want = co ? (link && link.company) || co.tallyName || co.name : "";
  const same = n => !!co && (norm(n) === norm(want) || norm(n) === norm(co.tallyName || "") || norm(n) === norm(co.name));
  const localOn = typeof Bridge === "object" && Bridge.on(), localUp = localOn && Bridge.up(), lst = (typeof Bridge === "object" && Bridge.st) || {};
  // each computer: its name, whether its heartbeat is recent, Tally's state, the companies open, the last contact
  const pcs = devs.map(d => {
    const info = d.info || {}, beat = info.beat || {}, ds = devState(d, now);
    const open = [].concat(beat.open || []).concat(...Object.values(info.bridges || {}).map(b => [].concat(b.open || []))).map(String).filter(Boolean);
    const at = Date.parse(beat.at || d.last_seen || 0) || 0;
    return {id: d.id, computer: tallyPcLabel(d), win: info.computer || beat.computer || beat.pc || beat.hostname || d.name || "", recent: ds.bridge === "online" || ds.bridge === "reconnecting",
      tally: ds.tally, open: Array.from(new Set(open)), at};
  });
  // this computer's bridge, answering here (on 127.0.0.1): only then is it "this computer" (round 3, 05-Oct-2026: never
  // guessed from the user or the firm)
  if (localUp){
    const o = (lst.open || []).map(x => x.name), name = lst.computer || "this computer";
    const mine = pcs.find(x => norm(x.win) === norm(name) || norm(x.computer) === norm(name));
    // its heartbeats not reaching FinCom (no internet there): not recent, whatever it sees in Tally
    const noNet = !!(lst.beat && lst.beat.on !== false && lst.beat.missedSince);
    const me = {id: mine ? mine.id : "local", computer: name, recent: !noNet, local: true, tally: lst.tallyState || (lst.tallyUp ? "open" : "closed"), open: o, at: (typeof Bridge === "object" && Bridge.okAt) || lst.at || now,
      noNet};
    // the last contact: with FinCom's cloud when the bridge here cannot reach it, else the latest of the two
    if (mine) pcs.splice(pcs.indexOf(mine), 1, Object.assign({}, mine, me, {computer: mine.computer, at: noNet ? mine.at : Math.max(mine.at, me.at)})); else pcs.push(noNet ? Object.assign(me, {at: Date.parse(lst.beat.last || 0) || 0}) : me);
  }
  const isOpen = x => x.tally === "open" || x.tally === "busy";
  const has = x => co ? x.open.some(same) : x.open.length > 0;
  const goods = pcs.filter(x => x.recent && isOpen(x) && has(x));
  const good = goods.find(x => x.local) || goods.find(x => !link || !link.device_id || x.id === link.device_id) || goods[0];
  const out = (o) => Object.assign({computer: "", company: co ? want : "", at: "", reason: "", fix: "", short: o.computer || ""}, o);
  if (good){
    const company = co ? good.open.find(same) : good.open.join(", ");
    // round 3 (05-Oct-2026): the sign says which computer: this one, the other one, or how many
    if (good.local) return out({on: true, code: "ok", local: true, computer: "this computer (" + good.computer + ")", company, at: tallyIst(good.at), words: "Tally connected on this computer", short: "This computer", through: [good.computer]});
    if (goods.length > 1) return out({on: true, code: "ok", computer: goods.map(x => x.computer).join(", "), company, at: goods.map(x => x.computer + ": " + tallyIst(x.at)).join(", "), words: "Tally connected through " + goods.length + " computers",
      short: goods.length + " computers", through: goods.map(x => x.computer), many: goods.map(x => ({computer: x.computer, company: co ? x.open.find(same) : x.open.join(", "), at: tallyIst(x.at)}))});
    return out({on: true, code: "ok", computer: good.computer, company, at: tallyIst(good.at), words: "Tally connected through " + good.computer, short: good.computer, through: [good.computer]});
  }
  // the computer that matters: the one linked to this client, else the one heard from last
  const pick = (link && link.device_id && pcs.find(x => x.id === link.device_id)) || pcs.slice().sort((a, b) => (b.recent - a.recent) || (b.at - a.at))[0];
  const off = (code, reason, fix, x) => out({on: false, code, computer: x ? x.computer : "", at: x && x.at ? tallyIst(x.at) : "", reason, fix,
    words: code === "othercompany" && x ? "Tally is open on " + x.computer + " with a different company" : "Tally not connected" + (x && x.at ? ". Last seen on " + x.computer + " at " + tallyIst(x.at) : ""),
    short: x ? x.computer : "No Tally"});
  const coName = co ? want : "the client's company";
  if (!pick){
    if (localOn && !localUp) return off("bridge", "FinCom Bridge is not running on this computer.", "Start FinCom Bridge (its icon near the clock, or from the Start menu), then keep TallyPrime open.", {computer: "this computer"});
    return off("bridge", "FinCom Bridge is not running on any computer of the firm.", "Start FinCom Bridge on the computer with TallyPrime, or install it from the Tally page.", null);
  }
  if (!pick.recent){
    if (pick.local && pick.noNet) return off("internet", pick.computer + " has no internet: FinCom Bridge is running there but cannot reach FinCom since " + tallyIst(lst.beat.missedSince) + ".", "Check the internet connection on " + pick.computer + ". Nothing is lost: FinCom Bridge sends everything when it is back.", pick);
    if (localOn && !localUp && localIsPick(pick)) return off("bridge", "FinCom Bridge is not running on " + pick.computer + " (this computer).", "Start FinCom Bridge on this computer (its icon near the clock, or from the Start menu).", pick);
    return off("bridge", "FinCom Bridge on " + pick.computer + " is not running or cannot reach FinCom: no word from it since " + (pick.at ? tallyIst(pick.at) : "it was set up") + ".",
      "On " + pick.computer + ": start FinCom Bridge (its icon near the clock) and check that the computer is on and has internet.", pick);
  }
  if (!isOpen(pick)) return off("tally", "TallyPrime is closed on " + pick.computer + ".", "Open TallyPrime on " + pick.computer + (co ? " and open " + coName + " in it." : "."), pick);
  if (!pick.open.length) return off("nocompany", "TallyPrime is open on " + pick.computer + ", but no company is open in it.", "Open " + coName + " in TallyPrime on " + pick.computer + ".", pick);
  return off("othercompany", "A different company is open in Tally on " + pick.computer + ": " + pick.open.slice(0, 3).join(", ") + ".", "Open " + coName + " in TallyPrime on " + pick.computer + " (the other company can stay open)." + (co && !link ? " If it is open under another name, link it in Client setup → Tally." : ""), pick);
}
function localIsPick(x){ return !!(x && (x.local || (typeof Bridge === "object" && Bridge.st && Bridge.st.computer && (norm(Bridge.st.computer) === norm(x.win || "") || norm(Bridge.st.computer) === norm(x.computer))))); }
// the same, in words for the hover and the panel: "Tally connected · OFFICE-PC · TESTING AAD · last contact …"
function tallySignWords(s){
  return (s.words || "Tally: " + (s.on ? "connected" : "not connected")) + (s.computer ? " — computer: " + s.computer : "") + (s.company ? " — company: " + s.company : "") +
    (s.at ? " — last contact: " + s.at : "") + (s.on ? "" : " — why: " + s.reason + " — what to do: " + s.fix);
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
