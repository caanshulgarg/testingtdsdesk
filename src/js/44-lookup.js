/* ================================================================== */
/* Look up: any ledger for any dates, a group, the trial balance on a  */
/* date, month by month, a party's open bills, or any entry, from the  */
/* books read here or straight from Tally through the bridge           */
/* ================================================================== */
// Shared bits for the Look up, Reports and Letters pages: periods, Dr/Cr amounts, a small chart, going to a page.
const FC = {
  d8(iso){ return String(iso || "").replace(/-/g, "").slice(0, 8); },
  iso(d){ return Audit.iso(d); },
  today(){ return Audit.today(); },
  // the date the quick periods are counted from: today, or the last day in the books when they end earlier
  anchor(){ const t = this.today(), to = String(((S.books || {}).meta || {}).to || ""); return to && to < t ? to : t; },
  monthEnd(y, m){ return String(y) + String(m).padStart(2, "0") + String(new Date(y, m, 0).getDate()).padStart(2, "0"); },
  period(k, at){
    const a = at || this.anchor(), y = num(a.slice(0, 4)), m = num(a.slice(4, 6)), fs = Audit.fyStart(a), fy = num(fs.slice(0, 4));
    const mStart = (yy, mm) => String(yy) + String(mm).padStart(2, "0") + "01";
    if (k === "month") return {from: mStart(y, m), to: this.monthEnd(y, m)};
    if (k === "lastmonth"){ const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return {from: mStart(yy, mm), to: this.monthEnd(yy, mm)}; }
    if (k === "quarter" || k === "lastquarter"){
      let q = Math.floor(((m + 8) % 12) / 3), qy = fy;                 // 0 = Apr-Jun
      if (k === "lastquarter"){ q--; if (q < 0){ q = 3; qy--; } }
      const sm = [4, 7, 10, 1][q], sy = q === 3 ? qy + 1 : qy, em = sm + 2;
      return {from: mStart(sy, sm), to: this.monthEnd(sy, em)};
    }
    if (k === "fy") return {from: fs, to: (fy + 1) + "0331"};
    if (k === "ytd") return {from: fs, to: a};
    if (k === "lastfy") return {from: (fy - 1) + "0401", to: fy + "0331"};
    return {from: fs, to: a};
  },
  PRESETS: [["month", "This month"], ["lastmonth", "Last month"], ["quarter", "This quarter"], ["lastquarter", "Last quarter"], ["ytd", "Year to date"], ["fy", "This year"], ["lastfy", "Last year"]],
  fyLabel(from){ const y = num(String(from).slice(0, 4)); return y + "-" + String(y + 1).slice(2); },
  // an amount with debit positive, shown the way Tally does
  drcr(x){ x = r2(x || 0); return Math.abs(x) < 0.005 ? "0.00" : INR.format(Math.abs(x)) + (x > 0 ? " Dr" : " Cr"); },
  amt(x){ return Math.abs(r2(x || 0)) < 0.005 ? "" : INR.format(r2(x)); },
  when(d){ return fmtDate(tallyDate(d)); },
  span(from, to){ return this.when(from) + " to " + this.when(to); },
  // every ledger known for the client: in the masters, the balances, or the vouchers
  // Tally's own ledger names, read through the bridge when Look up opens (light: names and groups only)
  tn(){ const n = typeof LK === "object" ? LK.names : null; return n && n.cid === S.coId ? n : null; },
  ledgers(){
    const T = this.tn(); if (T) return T.leds;
    const b = S.books || {}, key = (b.vouchers || []).length + "|" + ((b.meta || {}).at || "") + "|" + Object.keys(b.under || {}).length + "|" + Object.keys(b.ledInfo || {}).length + "|" + ((b.tb || {}).at || "");
    if (this._led && this._led.key === key && this._led.cid === b.cid) return this._led.list;
    const s = new Set(Object.keys(b.under || {}).concat(Object.keys(b.ledInfo || {}), Object.keys(b.map || {}), Object.keys((b.tb || {}).led || {})));
    const list = Array.from(s).filter(Boolean).sort((a, c) => a.localeCompare(c));
    this._led = {key, cid: b.cid, list};
    return list;
  },
  groups(){
    const T = this.tn(); if (T) return Array.from(new Set(Object.keys(T.groups).concat(Object.values(T.under)))).filter(Boolean).sort((a, c) => a.localeCompare(c));
    const b = S.books || {}, s = new Set(Object.keys(b.groups || {}).concat(Object.values(b.under || {})));
    return Array.from(s).filter(Boolean).sort((a, c) => a.localeCompare(c));
  },
  path(l){
    const T = this.tn();
    if (T && T.under[l] != null){ const out = []; let p = T.under[l]; for (let i = 0; p && i < 15; i++){ out.push(p); p = T.groups[p]; } return out; }
    return Audit.path(l);
  },
  inGroup(l, g){ const G = String(g || "").toLowerCase(); return this.path(l).some(x => x.toLowerCase() === G); },
  top(l){ const p = this.path(l); return p[p.length - 1] || "Not in a group"; },
  monthLabel(ym){ return typeof GSTR === "object" ? GSTR.label(ym) : ym; },
  shortMonth(ym){ const m = num(String(ym).slice(4, 6)); return ["", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"][((m + 8) % 12) + 1]; },
  go(tab, extra){
    Object.assign(S, extra || {});
    S.tab = "books"; S.booksTab = tab; S.step = null; S.drawerOpen = false;
    render(); window.scrollTo(0, 0);
  },
  async excel(name, sheets){
    await ensureXlsx();
    const wb = XLSX.utils.book_new();
    sheets.forEach(([n, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), String(n).replace(/[\\/?*[\]:]/g, " ").slice(0, 31)));
    saveFile(String((CO() || {}).name || "client").replace(/[^A-Za-z0-9]+/g, "-") + "-" + name.replace(/[^A-Za-z0-9]+/g, "-") + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};

const LK = {
  KINDS: [["ledger", "Ledger account"], ["group", "Group summary"], ["tb", "Trial balance on a date"], ["monthly", "Month by month"], ["bills", "Open bills of a party"], ["find", "Find entries"]],
  st(){
    const cid = S.coId;
    if (!S.lk || S.lk.cid !== cid){ const p = FC.period("ytd"); S.lk = {cid, kind: "ledger", led: "", grp: "", from: p.from, to: p.to, asOn: p.to, q: "", typ: "", ask: "", res: null, open: {}}; }
    return S.lk;
  },
  recentKey(){ return "tdsdesk:lkrecent:" + (S.coId || ""); },
  recent(){ try { return JSON.parse(lsGet(this.recentKey()) || "[]"); } catch (e){ return []; } },
  remember(x){
    const k = JSON.stringify([x.kind, x.led, x.grp, x.from, x.to, x.asOn, x.q]);
    const list = this.recent().filter(r => JSON.stringify([r.kind, r.led, r.grp, r.from, r.to, r.asOn, r.q]) !== k);
    list.unshift({kind: x.kind, led: x.led, grp: x.grp, from: x.from, to: x.to, asOn: x.asOn, q: x.q, typ: x.typ, side: x.side, label: this.title(x)});
    lsSet(this.recentKey(), JSON.stringify(list.slice(0, 8)));
  },
  title(x){
    const k = x.kind;
    if (k === "ledger") return x.led + ", " + FC.span(x.from, x.to);
    if (k === "group") return x.grp + ", " + FC.span(x.from, x.to);
    if (k === "tb") return "Trial balance on " + FC.when(x.asOn);
    if (k === "monthly") return (x.led || x.grp) + " month by month, " + FC.span(x.from, x.to);
    if (k === "bills") return (x.led || "Every party") + ": open bills on " + FC.when(x.asOn);
    return "Entries" + (x.q ? " with “" + x.q + "”" : "") + ", " + FC.span(x.from, x.to);
  },
  // the books cover these dates, and the opening balance is known
  cover(from, to){
    const m = (S.books || {}).meta || {}, f = String(m.from || ""), t = String(m.to || "");
    return {have: !!(S.books.vouchers || []).length, full: !!f && f <= from && t >= to, f, t};
  },
  bal(from, to){ try { return Audit.balances(from, to); } catch (e){ return {ok: false, why: e.message}; } },
  // ---------- one ledger's account, from the books read here
  ledgerBooks(led, from, to){
    const B = this.bal(from, to), cv = this.cover(from, to);
    const open = B.ok ? -r2((B.at(Audit.dayBefore(from))[led]) || 0) : null;
    const vs = (S.books.vouchers || []).filter(v => v.date >= from && v.date <= to && !v.opt && !v.cancel && v.ent.some(e => e.l === led))
      .sort((a, c) => a.date.localeCompare(c.date) || String(a.no).localeCompare(String(c.no), undefined, {numeric: true}));
    let run = open || 0, dr = 0, cr = 0;
    const rows = vs.map(v => {
      const a = r2(v.ent.filter(e => e.l === led).reduce((s, e) => s + e.a, 0)), d = a < 0 ? -a : 0, c = a > 0 ? a : 0;
      dr = r2(dr + d); cr = r2(cr + c); run = r2(run + d - c);
      const other = v.ent.filter(e => e.l !== led && Math.sign(e.a) !== Math.sign(a) && e.a).sort((x, y) => Math.abs(y.a) - Math.abs(x.a));
      const part = other.length ? other[0].l + (other.length > 1 ? " and " + (other.length - 1) + " more" : "") : (v.party && v.party !== led ? v.party : "");
      return {id: v.id, date: v.date, type: v.type, no: v.no, part, narr: v.narr || "", dr: d, cr: c, run, ent: v.ent.map(e => ({l: e.l, a: e.a}))};
    });
    return {kind: "ledger", src: "books", led, from, to, open, close: open == null ? null : run, dr, cr, rows,
      note: (B.ok ? "Opening from " + B.src + "." : "Opening balance not known: " + (B.why || "") + ".") + (cv.full ? "" : " The books read here cover " + (cv.f ? FC.span(cv.f, cv.t) : "no dates") + "; entries outside that are not shown. Fetch from Tally for the whole period.")};
  },
  // ---------- the same, straight from Tally
  async ledgerTally(led, from, to, force){
    const ck = S.coId + "|led|" + led + "|" + from + "|" + to, hit = this.cached(ck, force); if (hit) return hit;
    const co = CO(), o = Bridge.openFor(co);
    if (!o) throw new Error("Open " + (co.tallyName || co.name) + " in Tally first.");
    if (bridgeVer(Bridge.st.version) < bridgeVer("1.12.3")) throw new Error("This needs FinCom Bridge 2.1. Install FinCom Bridge from the Tally page.");
    const q = "?company=" + encodeURIComponent(o.name) + "&from=" + from + "&to=" + to + "&ledger=" + encodeURIComponent(led) + Bridge.pinQ();
    const bal = await Bridge.call("/ledgerbalance" + q, null, 180000);
    const lv = await Bridge.call(ledgerLinesUrl(o.name, led, FC.iso(from), FC.iso(to)), null, 600000);
    const open = -r2(num(bal.open)), close = -r2(num(bal.close));
    let run = open, dr = 0, cr = 0;
    const rows = [].concat(lv.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || "") && !/^yes$/i.test(v.optional || "")).map(v => {
      const d8 = String(v.date || "").replace(/\D/g, "").slice(0, 8), ents = [].concat(v.entries || []).map(e => ({l: e.ledger, a: r2(num(e.amount))}));
      const a = r2(ents.filter(e => norm(e.l) === norm(led)).reduce((s, e) => s + e.a, 0));
      return {v, d8, ents, a};
    }).filter(x => x.d8 >= from && x.d8 <= to && x.a).sort((x, y) => x.d8.localeCompare(y.d8)).map(({v, d8, ents, a}) => {
      const d = a < 0 ? -a : 0, c = a > 0 ? a : 0;
      dr = r2(dr + d); cr = r2(cr + c); run = r2(run + d - c);
      const other = ents.filter(e => norm(e.l) !== norm(led) && Math.sign(e.a) !== Math.sign(a) && e.a).sort((x, y) => Math.abs(y.a) - Math.abs(x.a));
      return {id: v.guid || v.masterId || d8 + v.number, date: d8, type: v.type, no: v.number, part: other.length ? other[0].l + (other.length > 1 ? " and " + (other.length - 1) + " more" : "") : (v.party || ""), narr: v.narration || "", dr: d, cr: c, run, ent: ents};
    });
    const diff = r2(close - run);
    return this.keep(ck, {kind: "ledger", src: "tally", led, from, to, open, close, dr, cr, rows, at: Date.now(),
      note: "Read from Tally (" + o.name + ")." + (Math.abs(diff) >= 0.5 ? " Tally's closing balance differs from the entries by " + INR.format(Math.abs(diff)) + ": an entry may be optional or post-dated." : "")});
  },
  // ---------- a group: each ledger's opening, debits, credits and closing
  group(grp, from, to){
    const B = this.bal(from, to), led = FC.ledgers().filter(l => FC.inGroup(l, grp));
    const set = new Set(led), mv = {};
    (S.books.vouchers || []).forEach(v => { if (v.date < from || v.date > to || v.opt || v.cancel) return; v.ent.forEach(e => { if (!set.has(e.l)) return; const x = mv[e.l] = mv[e.l] || {dr: 0, cr: 0}; if (e.a < 0) x.dr = r2(x.dr - e.a); else x.cr = r2(x.cr + e.a); }); });
    const o = B.ok ? B.at(Audit.dayBefore(from)) : null;
    const rows = led.map(l => { const x = mv[l] || {dr: 0, cr: 0}, op = o ? -r2(o[l] || 0) : null; return {l, sub: (S.books.under || {})[l] || "", open: op, dr: x.dr, cr: x.cr, close: op == null ? null : r2(op + x.dr - x.cr)}; })
      .filter(r => r.dr || r.cr || (r.open && Math.abs(r.open) >= 0.5)).sort((a, c) => Math.abs(c.close != null ? c.close : c.dr - c.cr) - Math.abs(a.close != null ? a.close : a.dr - a.cr) || a.l.localeCompare(c.l));
    const sum = k => r2(rows.reduce((s, r) => s + (r[k] || 0), 0));
    return {kind: "group", src: "books", grp, from, to, rows, open: B.ok ? sum("open") : null, dr: sum("dr"), cr: sum("cr"), close: B.ok ? sum("close") : null,
      note: B.ok ? "Balances from " + B.src + "." : "Opening and closing balances not known: " + (B.why || "") + ". Debits and credits are from the entries read here."};
  },
  // ---------- every ledger's balance on a date
  tbBooks(asOn){
    // a balance on a date needs only a known opening before it: the year's start, or where the copy starts if later
    const tb = (S.books || {}).tb, fs = Audit.fyStart(asOn), base = tb && tb.from > fs && tb.from <= asOn ? tb.from : fs;
    const B = this.bal(base, asOn);
    if (!B.ok) return {kind: "tb", src: "books", asOn, rows: [], none: B.why};
    const at = B.at(asOn), rows = Object.keys(at).filter(l => Math.abs(at[l]) >= 0.005).map(l => ({l, top: FC.top(l), sub: (S.books.under || {})[l] || "", bal: -r2(at[l])}));
    return this.tbShape({kind: "tb", src: "books", asOn, rows, note: "From " + B.src + "."});
  },
  // ---------- straight from Tally: light reads, kept for ten minutes so asking again does not touch Tally
  names: null,
  cache: {},
  TTL: 10 * 60000,
  live(){ const co = CO(); return !!(co && typeof bridgeLive === "function" && bridgeLive(co) && Bridge.openFor(co)); },
  light(){ return bridgeVer(Bridge.st.version) >= bridgeVer("1.12.10"); },
  tname(){ const co = CO(), o = Bridge.openFor(co); if (!o) throw new Error("Open " + (co.tallyName || co.name) + " in Tally first."); return o.name; },
  // build 194: the ledger names come from the cloud copy of the books (Tally is not asked); read from Tally only when
  // someone presses "refresh" and there is no cloud copy
  async loadNames(force){
    const cid = S.coId;
    if (this._namesBusy) return;
    if (!force && this.names && this.names.cid === cid && Date.now() - this.names.at < 30 * 60000) return;
    const bk = typeof TCloud === "object" && TCloud.on() ? TCloud.book(cid) : null;
    if (bk && bk.book){
      this._namesBusy = true;
      try {
        const rows = await TCloud.restAll("tally_ledgers?select=name,parent&merged_into=is.null&book_id=eq." + encodeURIComponent(bk.book) + "&order=name.asc");
        const under = {}; rows.forEach(r => { const n = ledNm(r.name); if (!(n in under) || r.parent) under[n] = r.parent || under[n] || ""; });
        this.names = {cid, at: Date.now(), leds: Object.keys(under), under, groups: {}, src: "cloud"};
      } catch (e){ if (force) toast("Could not bring the ledger names: " + ((e && e.message) || e)); }
      this._namesBusy = false;
      if (S.booksTab === "lookup") render();
      return;
    }
    if (!force || !this.live() || !this.light()) return;
    this._namesBusy = true;
    try {
      const j = await Bridge.call("/ledgernames?company=" + encodeURIComponent(this.tname()) + Bridge.pinQ(), null, 90000);
      const under = {}, groups = {};
      [].concat(j.ledgers || []).forEach(([n, p]) => { under[n] = p || ""; });
      [].concat(j.groups || []).forEach(([n, p]) => { groups[n] = p || ""; });
      this.names = {cid, at: Date.now(), leds: Object.keys(under).sort((a, c) => a.localeCompare(c)), under, groups};
    } catch (e){ if (force) toast("Could not read the ledger names from Tally: " + ((e && e.message) || e)); }
    this._namesBusy = false;
    if (S.booksTab === "lookup") render();
  },
  cached(key, force){ const c = this.cache[key]; return !force && c && Date.now() - c.at < this.TTL ? c.v : null; },
  keep(key, v){ this.cache[key] = {at: Date.now(), v}; return v; },
  // every ledger's balance on a date, debit positive: one read of the ledgers that have a balance
  async tbRaw(asOn, force){
    const key = S.coId + "|tb|" + asOn, hit = this.cached(key, force); if (hit) return hit;
    const name = this.tname(), bal = {}, par = {};
    if (this.light()){
      const j = await Bridge.call("/tb?company=" + encodeURIComponent(name) + "&to=" + asOn + Bridge.pinQ(), null, 300000);
      [].concat(j.ledgers || []).forEach(([n, p, b]) => { bal[n] = -r2(Books.amt(b)); par[n] = p || ""; });
    } else {
      const j = await Bridge.call("/balances?company=" + encodeURIComponent(name) + "&from=" + asOn + "&to=" + asOn + Bridge.pinQ(), null, 600000);
      [].concat(j.ledgers || []).forEach(l => { const b = -r2(Books.amt(l.close)); if (Math.abs(b) >= 0.005){ bal[l.name] = b; par[l.name] = l.parent || ""; } });
    }
    if (this.names && this.names.cid === S.coId) Object.entries(par).forEach(([n, p]) => { if (this.names.under[n] == null){ this.names.under[n] = p; this.names.leds.push(n); } });
    return this.keep(key, {bal, par, at: Date.now(), company: name});
  },
  async tbTally(asOn, force){
    const t = await this.tbRaw(asOn, force), sub = l => (FC.tn() ? FC.tn().under[l] : null) || t.par[l] || (S.books.under || {})[l] || "";
    const rows = Object.keys(t.bal).filter(l => Math.abs(t.bal[l]) >= 0.005).map(l => ({l, bal: t.bal[l], sub: sub(l), top: FC.path(l).length ? FC.top(l) : (sub(l) || "Not in a group")}));
    return this.tbShape({kind: "tb", src: "tally", asOn, rows, at: t.at, note: "Read from Tally (" + t.company + ")" + (this.light() ? "" : ". This bridge reads every ledger twice; install FinCom Bridge from the Tally page for a faster, lighter read") + "."});
  },
  // a group straight from Tally: each ledger's opening and closing (two light reads), and the change between
  async groupTally(grp, from, to, force){
    const A = await this.tbRaw(Audit.dayBefore(from), force), Z = await this.tbRaw(to, force);
    const inG = l => FC.inGroup(l, grp) || String(A.par[l] || Z.par[l] || "").toLowerCase() === String(grp).toLowerCase();
    const led = Array.from(new Set(Object.keys(A.bal).concat(Object.keys(Z.bal)))).filter(inG);
    const rows = led.map(l => { const o = r2(A.bal[l] || 0), c = r2(Z.bal[l] || 0), n = r2(c - o); return {l, sub: Z.par[l] || A.par[l] || "", open: o, dr: n > 0 ? n : 0, cr: n < 0 ? -n : 0, close: c}; })
      .sort((a, c) => Math.abs(c.close) - Math.abs(a.close) || a.l.localeCompare(c.l));
    const sum = k => r2(rows.reduce((s2, r) => s2 + (r[k] || 0), 0));
    return {kind: "group", src: "tally", grp, from, to, rows, open: sum("open"), dr: sum("dr"), cr: sum("cr"), close: sum("close"), at: Z.at, net: true,
      note: "Opening and closing read from Tally (" + Z.company + "); the debit and credit columns are each ledger\u2019s net change. Open a ledger for its entries."};
  },
  // a ledger month by month, from its entries in Tally
  async monthlyTally(led, from, to, force){
    const r = await this.ledgerTally(led, from, to, force), months = MIS.monthsOf(from, to), m = {};
    months.forEach(k => { m[k] = {dr: 0, cr: 0}; });
    r.rows.forEach(v => { const x = m[v.date.slice(0, 6)]; if (x){ x.dr = r2(x.dr + v.dr); x.cr = r2(x.cr + v.cr); } });
    let run = r.open;
    const rows = months.map(k => { const x = m[k]; run = r2(run + x.dr - x.cr); return {ym: k, dr: x.dr, cr: x.cr, net: r2(x.dr - x.cr), close: run}; });
    return {kind: "monthly", src: "tally", led, grp: "", from, to, open: r.open, rows, dr: r.dr, cr: r.cr, at: r.at, note: "From " + led + "\u2019s entries in Tally."};
  },
  tbShape(r){
    const ORDER = ["Capital Account", "Loans (Liability)", "Current Liabilities", "Fixed Assets", "Investments", "Current Assets", "Sales Accounts", "Purchase Accounts", "Direct Incomes", "Direct Expenses", "Indirect Incomes", "Indirect Expenses", "Suspense A/c", "Branch / Divisions", "Misc. Expenses (ASSET)"];
    const by = {};
    r.rows.forEach(x => { (by[x.top] = by[x.top] || []).push(x); });
    r.groups = Object.keys(by).sort((a, c) => (ORDER.indexOf(a) < 0 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(c) < 0 ? 99 : ORDER.indexOf(c)) || a.localeCompare(c))
      .map(g => ({g, rows: by[g].sort((a, c) => a.l.localeCompare(c.l)), dr: r2(by[g].filter(x => x.bal > 0).reduce((s, x) => s + x.bal, 0)), cr: r2(by[g].filter(x => x.bal < 0).reduce((s, x) => s - x.bal, 0))}));
    r.dr = r2(r.groups.reduce((s, g) => s + g.dr, 0)); r.cr = r2(r.groups.reduce((s, g) => s + g.cr, 0));
    // ledgers with entries but no master in the copy (their group and opening are not known), and whether the trial
    // balance totals zero: one that does not is not shown as a trial balance (review of 02-Oct-2026)
    const groups = (S.books || {}).groups || {}, under = (S.books || {}).under || {};
    r.noMaster = r.rows.filter(x => x.noMaster || (r.src === "books" && !under[x.l] && !/^profit & loss a\/c$/i.test(x.l) && !groups[x.l]));
    r.off = r2(r.dr - r.cr);
    r.refused = Math.abs(r.off) >= 1;
    return r;
  },
  // ---------- a ledger or a group, month by month
  monthly(led, grp, from, to){
    const B = this.bal(from, to), set = new Set(led ? [led] : FC.ledgers().filter(l => FC.inGroup(l, grp)));
    const months = MIS.monthsOf(from, to), m = {};
    months.forEach(k => { m[k] = {dr: 0, cr: 0}; });
    (S.books.vouchers || []).forEach(v => { if (v.date < from || v.date > to || v.opt || v.cancel) return; const x = m[v.date.slice(0, 6)]; if (!x) return; v.ent.forEach(e => { if (!set.has(e.l)) return; if (e.a < 0) x.dr = r2(x.dr - e.a); else x.cr = r2(x.cr + e.a); }); });
    let run = null;
    if (B.ok){ const o = B.at(Audit.dayBefore(from)); run = -r2(Array.from(set).reduce((s, l) => s + (o[l] || 0), 0)); }
    const open = run;
    const rows = months.map(k => { const x = m[k]; if (run != null) run = r2(run + x.dr - x.cr); return {ym: k, dr: x.dr, cr: x.cr, net: r2(x.dr - x.cr), close: run}; });
    return {kind: "monthly", src: "books", led, grp, from, to, open, rows, dr: r2(rows.reduce((s, r) => s + r.dr, 0)), cr: r2(rows.reduce((s, r) => s + r.cr, 0)),
      note: B.ok ? "Balances from " + B.src + "." : "Balances not known (" + (B.why || "") + "); debits and credits only."};
  },
  // ---------- a party's open bills on a date
  bills(led, asOn){
    const side = led ? (Audit.isCreditor(led) ? "p" : "r") : (S.lk.side === "p" ? "p" : "r");
    const all = MIS.bills(asOn, side).filter(x => !led || x.party === led).sort((a, c) => a.party.localeCompare(c.party) || String(a.date).localeCompare(String(c.date)));
    const total = r2(all.reduce((s, x) => s + x.amt, 0));
    return {kind: "bills", src: "books", led, asOn, side, rows: all, total,
      note: (side === "r" ? "Owed to the client" : "Owed by the client") + ", bill by bill, from the bill-wise details in Tally. Bills raised before the books read here show only what was settled against them."};
  },
  // ---------- any entry: party, narration, number, ledger or amount
  find(q, from, to, typ){
    const s = String(q || "").trim().toLowerCase(), amt = /^[\d,]+(\.\d+)?$/.test(s.replace(/[₹\s]/g, "")) ? num(s) : null;
    const words = amt == null ? s.split(/\s+/).filter(Boolean) : [];
    const rows = (S.books.vouchers || []).filter(v => {
      if (v.date < from || v.date > to || v.cancel) return false;
      if (typ && v.type !== typ) return false;
      if (amt != null) return v.ent.some(e => Math.abs(Math.abs(e.a) - amt) < 1);
      if (!words.length) return true;
      const hay = [v.party, v.narr, v.no, v.ref, v.type].concat(v.ent.map(e => e.l)).join(" ").toLowerCase();
      return words.every(w => hay.includes(w));
    }).sort((a, c) => a.date.localeCompare(c.date)).map(v => {
      const big = v.ent.reduce((m, e) => Math.abs(e.a) > Math.abs(m) ? e.a : m, 0);
      const tot = r2(v.ent.filter(e => e.a > 0).reduce((x, e) => x + e.a, 0));
      return {id: v.id, date: v.date, type: v.type, no: v.no, party: v.party || (v.ent.find(e => e.a < 0) || {}).l || "", narr: v.narr || "", amt: tot || Math.abs(big), ent: v.ent.map(e => ({l: e.l, a: e.a})), opt: !!v.opt};
    });
    // review of 01-Oct-2026: an Optional entry (not in Tally's books, e.g. a payroll kept as Optional) is listed and
    // marked, and left out of the total, as Tally leaves it out of every balance
    return {kind: "find", src: "books", q, from, to, typ, rows, total: r2(rows.filter(r => !r.opt).reduce((x, r) => x + r.amt, 0)), opt: rows.filter(r => r.opt).length};
  },
  types(){ return Array.from(new Set((S.books.vouchers || []).map(v => v.type).filter(Boolean))).sort(); },
  // ---------- run what the page asks for
  // Tally is never asked to work out balances during the day: that holds Tally up for everyone using it. Totals (the trial
  // balance, a group, month by month) always come from FinCom's copy of the books, which the bridge refreshes every night
  // and which "Bring in today's entries" tops up with just the days since. Only one ledger at a time is ever read live,
  // and only when the copy does not reach the dates asked for (or when asked for); that read is small.
  canTally(x){ return this.live() && (x.kind === "ledger" || (x.kind === "monthly" && !!x.led)); },
  covers(from, to){ const m = (S.books || {}).meta || {}; return (S.books.vouchers || []).length > 0 && !!m.from && m.from <= from && String(m.to || "") >= to; },
  useTally(x, how){
    if (how === "books" || !this.canTally(x)) return false;
    if (how === "tally" || how === "fresh") return true;
    if (x.src) return x.src === "tally";
    return !this.covers(x.from, x.to);
  },
  async run(how){
    const x = this.st();
    if (x.busy) return;
    const tally = this.useTally(x, how), have = (S.books.vouchers || []).length > 0;
    // build 192: whenever the client's books are in the cloud, the answer is worked out there (under a second, on any
    // computer); the books loaded in this browser are used only without the cloud (offline), and for open bills
    if (!tally && TCloud.on() && !(TCloud.st[S.coId] || {}).books){ try { await TCloud.status(S.coId); } catch (e){} }
    const cloud = !tally && how !== "books" && ["tb", "ledger", "group", "monthly", "find"].includes(x.kind) && TCloud.has(S.coId);
    const need = (c, m) => { if (!c){ toast(m); throw null; } };
    try {
      if (x.kind === "ledger") need(x.led, "Choose a ledger.");
      if (["ledger", "bills"].includes(x.kind) && x.led) need(FC.ledgers().includes(x.led) || tally || cloud, "\u201c" + x.led + "\u201d is not a ledger " + (FC.tn() ? "in Tally" : "in these books") + ". Pick one from the list.");
      if (x.kind === "group") need(x.grp, "Choose a group.");
      if (x.kind === "monthly") need(x.led || x.grp, "Choose a ledger or a group.");
      if (["ledger", "group", "monthly", "find"].includes(x.kind)) need(x.from && x.to && x.from <= x.to, "The dates are the wrong way round.");
      if (!tally && !cloud) need(have, this.live() ? "This needs the books read into FinCom. Choose \u201cTally\u201d as the source, or read the books first." : "Read the books from Tally first, or connect FinCom Bridge.");
    } catch (e){ if (e) throw e; return; }
    x.open = {};
    if (cloud){
      x.busy = "Working it out\u2026"; render();
      try {
        x.res = x.kind === "tb" ? await TCloud.tb(S.coId, x.asOn) : x.kind === "ledger" ? await TCloud.ledger(S.coId, x.led, x.from, x.to)
          : x.kind === "group" ? await TCloud.group(S.coId, x.grp, x.from, x.to) : x.kind === "monthly" ? await TCloud.monthly(S.coId, x.led, x.grp, x.from, x.to)
          : await TCloud.find(S.coId, x.q, x.from, x.to, x.typ);
      }
      catch (e){
        x.busy = "";
        // no copy in the cloud for these dates (or no internet): the books here, when there are any
        if (have){ x.res = null; return this.run("books"); }
        toast("Could not ask the cloud: " + ((e && e.message) || e)); render(); return;
      }
      x.busy = "";
    } else if (tally){
      const force = how === "fresh";
      x.busy = x.kind === "tb" ? "Reading the trial balance from Tally\u2026" : x.kind === "group" ? "Reading " + x.grp + " from Tally\u2026" : "Reading " + x.led + " from Tally\u2026"; render();
      try {
        x.res = x.kind === "tb" ? await this.tbTally(x.asOn, force) : x.kind === "group" ? await this.groupTally(x.grp, x.from, x.to, force)
          : x.kind === "monthly" ? await this.monthlyTally(x.led, x.from, x.to, force) : await this.ledgerTally(x.led, x.from, x.to, force);
      }
      catch (e){ x.busy = ""; toast("Could not read Tally: " + ((e && e.message) || e)); render(); return; }
      x.busy = "";
    } else {
      x.res = x.kind === "ledger" ? this.ledgerBooks(x.led, x.from, x.to) : x.kind === "group" ? this.group(x.grp, x.from, x.to) : x.kind === "tb" ? this.tbBooks(x.asOn)
        : x.kind === "monthly" ? this.monthly(x.led, x.grp, x.from, x.to) : x.kind === "bills" ? this.bills(x.led, x.asOn) : this.find(x.q, x.from, x.to, x.typ);
    }
    x.res.title = this.title(x);
    this.remember(x);
    render();
  },
  booksAge(){ const m = (S.books || {}).meta || {}; return m.at ? fmtDate(String(m.at).slice(0, 10)) : ""; },
  // ---------- keeping the copy of the books fresh without holding Tally up
  fr(){ const cid = S.coId; if (!S.lkFr || S.lkFr.cid !== cid) S.lkFr = {cid, man: null, sch: null, at: 0, busy: ""}; return S.lkFr; },
  // on opening Look up, Reports or Letters: if the bridge made a newer copy last night, bring it in (read from the bridge's
  // folder; Tally is not asked anything)
  // the copy in FinCom's cloud: for a computer without the bridge, or a bridge that does not keep this company
  async cloudFresh(force, quiet){
    const f = this.fr();
    if (!TCloud.on() || f.busy) return;
    if (!force && Date.now() - (f.cat || 0) < 60000) return;
    f.cat = Date.now();
    const at = ((S.books || {}).meta || {}).at;
    try { await TCloud.status(S.coId, force); if (TCloud.has(S.coId) && await TCloud.load(force) === "new") TCloud.rework(S.books); } catch (e){}
    if (!quiet || at !== ((S.books || {}).meta || {}).at) render();
  },
  // quiet: the once-a-minute look from any screen; the page is drawn again only when the books changed
  async autoFresh(force, quiet){
    const f = this.fr(), co = CO();
    if (f.busy) return;
    if (!this.live()){ await this.cloudFresh(force, quiet); return; }
    const keep = f.man && f.man.keep;
    if (!force && Date.now() - f.at < (keep ? 60000 : 15 * 60000)) return;
    f.at = Date.now();
    const q = "?company=" + encodeURIComponent(this.tname()) + Bridge.pinQ();
    try { f.man = await Bridge.call("/synced" + q, null, 30000); } catch (e){ f.man = {error: (e && e.message) || String(e)}; }
    if (!quiet){
      try { f.keep = await Bridge.call("/keep" + q, null, 30000); } catch (e){ f.keep = null; }
      try { f.sch = await Bridge.call("/schedule", null, 30000); } catch (e){ f.sch = null; }
    }
    const b = S.books, m = f.man || {}, meta = (b && b.meta) || {};
    if (!(b && b.cid === co.id && m.ok && !m.none && m.at && m.from)){ f.at = 0; await this.cloudFresh(force, quiet); if (!quiet) render(); return; }
    if (m.keep){
      // kept in step by the bridge: only the months that changed since FinCom last looked
      const known = meta.monthsAt || {}, todo = [].concat(m.months || []).filter(x => x.at && (!known[x.ym] || x.at > known[x.ym]) && x.from <= m.to);
      const balNew = m.balancesAt && m.balancesAt !== meta.balAt;
      if (todo.length || balNew){
        f.busy = "Bringing in " + (todo.length === 1 ? FC.monthLabel(todo[0].ym) : todo.length + " months") + " from the copy the bridge keeps (Tally is not asked anything)\u2026"; render();
        try {
          const nm = this.tname(), qq = "?company=" + encodeURIComponent(nm) + Bridge.pinQ();
          b.meta = b.meta || {};
          if (balNew){ const j = JSON.parse(await TallyRead.raw("/syncfile" + qq + "&file=balances.json", 120000)); TallyRead.balances(b, j, j.from || m.from, m.to); b.meta.balAt = m.balancesAt; }
          for (const x of todo){
            const text = await TallyRead.raw("/syncfile" + qq + "&file=daybook-" + x.ym + ".xml", 300000);
            const res = await Books.importDayBook(new Blob([text], {type: "text/xml"}));
            const bad = notThisClient((res.meta || {}).gstins);
            if (bad.length) throw new Error(panRefusal("The company kept in step", bad));
            TallyRead.merge(b, res, x.from, x.to);
            (b.meta.monthsAt = b.meta.monthsAt || {})[x.ym] = x.at;
          }
          if (b.tb && String(b.tb.to) < m.to) b.tb.to = m.to;
          b.map = Books.mapLedgers(b.vouchers || [], b.map); try { LedMaster.refresh(b); } catch (e){}
          b.meta.at = new Date().toISOString(); b.meta.copyAt = m.at; b.meta.copyTo = m.to; b.meta.keep = true; b.meta.file = "kept in step with Tally by the bridge";
          TallyRead.after(b, "after changes in Tally were brought in");
          this.cache = {}; await saveBooks();
        } catch (e){ toast("Could not bring in the copy: " + ((e && e.message) || e)); }
        f.busy = "";
        render();
      } else if (!quiet) render();
      return;
    }
    if ((!meta.copyAt || m.at > meta.copyAt) && (!meta.to || m.to >= meta.to || !meta.copyAt)){
      f.busy = "Bringing in last night\u2019s copy of the books (made " + fmtDateTime(m.at) + "); Tally is not asked anything\u2026"; render();
      try { await TallyRead.read(m.from, m.to, "copy"); b.meta.copyAt = m.at; b.meta.copyTo = m.to; await saveBooks(); toast("The books are up to " + FC.when(m.to) + ", from last night\u2019s copy."); }
      catch (e){ toast("Could not bring in last night\u2019s copy: " + ((e && e.message) || e)); }
      f.busy = "";
    }
    render();
  },
  async keepOn(on){
    try { const f = this.fr(); f.keep = await Bridge.call("/keep?company=" + encodeURIComponent(this.tname()) + Bridge.pinQ(), {on: !!on}, 30000); toast(on ? "The bridge will keep this company in step whenever it is open in Tally." : "Keeping in step switched off."); f.at = 0; setTimeout(() => this.autoFresh(true), 3000); render(); }
    catch (e){ toast(/Unknown address|No such/i.test(String(e && e.message)) ? "This needs FinCom Bridge 2.1. Install FinCom Bridge from the Tally page." : "The bridge could not do it: " + ((e && e.message) || e)); }
  },
  // the bridge's update from Tally: when it runs each day, or now (the bridge reads only changes, then stops)
  async keepSet(o, say){
    try {
      const j = await Bridge.call("/keep?company=" + encodeURIComponent(BridgeSeed.company()) + Bridge.pinQ(), o, 30000);
      (S.setupKeep = S.setupKeep || {})[S.coId] = {at: Date.now(), st: j}; toast(say);
      if (o.now){ [60, 180, 420].forEach(s => setTimeout(() => { try { this.autoFresh(true, true); (S.setupKeep || {})[S.coId] = null; render(); } catch (e){} }, s * 1000)); }
    } catch (e){ toast(/Unknown address|No such/i.test(String(e && e.message)) ? "This needs FinCom Bridge 2.1. Install FinCom Bridge from the Tally page." : "The bridge could not do it: " + ((e && e.message) || e)); }
    render();
  },
  async keepCheck(){
    const f = this.fr(), ym = Audit.today().slice(0, 6);
    f.busy = "Checking this month\u2019s copy against Tally\u2026"; render();
    try {
      const r = await Bridge.call("/keepcheck?company=" + encodeURIComponent(this.tname()) + "&ym=" + ym + Bridge.pinQ(), null, 300000);
      f.check = Object.assign({at: Date.now()}, r);
    } catch (e){ f.check = {error: (e && e.message) || String(e)}; }
    f.busy = ""; render();
  },
  // the days since the copy: one small day book read, merged in; balances follow from the entries
  async bringToday(){
    const f = this.fr(), b = S.books, meta = b.meta || {}, today = Audit.today();
    if (!this.live()){ toast("Connect FinCom Bridge first."); return; }
    if (!(b.vouchers || []).length || !meta.to){ toast("Bring in the books first (last night\u2019s copy, or From Tally)."); return; }
    const from = Audit.ymd(Audit.iso(meta.to) && FC.d8(addDays(Audit.iso(meta.to), 1))), to = today;
    const start = String(meta.to) >= today ? today : from;
    if (Audit.days(start, to) > 31){ toast("The copy is more than a month old. Switch on the nightly copy, or make the copy now after office hours."); return; }
    f.busy = "Reading " + FC.span(start, to) + " from Tally\u2026 (a small read)"; render();
    try {
      const q = "?company=" + encodeURIComponent(this.tname()) + Bridge.pinQ();
      const text = await TallyRead.raw("/daybook" + q + "&from=" + start + "&to=" + to, 180000);
      const res = await Books.importDayBook(new Blob([text], {type: "text/xml"}));
      const bad = notThisClient((res.meta || {}).gstins);
      if (bad.length) throw new Error(panRefusal("The company open in Tally", bad));
      TallyRead.merge(b, res, start, to);
      if (b.tb && b.tb.from <= start && String(b.tb.to) < to) b.tb.to = to;     // the opening stays; later balances follow from the entries
      b.map = Books.mapLedgers(b.vouchers, b.map); try { LedMaster.refresh(b); } catch (e){}
      b.meta.at = new Date().toISOString(); b.meta.todayAt = b.meta.at;
      TallyRead.after(b, "after today's entries were read from Tally");
      await saveBooks();
      this.cache = {}; toast(res.vouchers.length + " entries from " + FC.span(start, to) + " brought in.");
    } catch (e){ toast("Could not read Tally: " + ((e && e.message) || e)); }
    f.busy = ""; render();
  },
  async syncNow(){
    const r = await askConfirm({title: "Make the copy of the books now?", ok: "Make it now", body: "<p>The bridge reads this year\u2019s day book and every ledger\u2019s balance from Tally. On a large company Tally is busy for several minutes and others using it will wait.</p><p>Best done after office hours. Switching on the nightly copy does this every night at 2 am instead.</p>"});
    if (!r || !r.ok) return;
    const f = this.fr(); f.busy = "The bridge is copying the books from Tally\u2026 this takes a few minutes"; render();
    try { await Bridge.call("/syncnow", {company: this.tname()}, 3600000); f.at = 0; f.busy = ""; await this.autoFresh(); }
    catch (e){ f.busy = ""; toast("The copy did not finish: " + ((e && e.message) || e)); render(); }
  },
  // ---------- a question in plain words, turned into a look-up
  STOP: new Set(["the", "of", "for", "and", "to", "a", "an", "in", "on", "from", "show", "me", "give", "what", "is", "was", "ledger", "account", "a/c", "ac", "statement", "balance", "balances", "all", "with", "by", "as", "at", "till", "upto", "up", "this", "last", "year", "month", "quarter", "fy", "ltd", "pvt", "private", "limited", "llp", "co", "&", "m/s", "ms", "entries", "entry", "list", "please", "details", "detail", "how", "much", "many", "our", "my", "we", "us"]),
  MONTHS: {jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12},
  toks(s){ return String(s || "").toLowerCase().replace(/[()\[\],.:;'"\/\\]/g, " ").split(/\s+/).filter(Boolean); },
  bestName(text, names){
    const T = this.toks(text), tset = new Set(T);
    let best = null;
    names.forEach(n => {
      const nt = this.toks(n).filter(w => !this.STOP.has(w) && w.length > 1);
      if (!nt.length) return;
      const hit = nt.filter(w => tset.has(w) || (w.length >= 4 && T.some(t => t.length >= 4 && (w.startsWith(t) || t.startsWith(w)))));
      if (!hit.length || !hit.some(w => w.length >= 3)) return;
      const score = hit.length / nt.length + hit.reduce((s, w) => s + w.length, 0) / 100;
      if (hit.length / nt.length >= 0.5 && (!best || score > best.score)) best = {n, score, full: hit.length === nt.length};
    });
    return best;
  },
  dateIn(s){
    const t = String(s).toLowerCase(), a = FC.anchor();
    let m;
    // 31/03/2026, 31-03-2026, 2026-03-31, 31 mar 2026, mar 31 2026
    const one = x => {
      let q = x.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (q){ const y = q[3].length === 2 ? "20" + q[3] : q[3]; return y + q[2].padStart(2, "0") + q[1].padStart(2, "0"); }
      q = x.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (q) return q[1] + q[2] + q[3];
      q = x.match(/^(\d{1,2})\s*(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:,?\s+(\d{4}))?$/) || (x.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/) || []).slice(0).map((v, i, arr) => i === 1 ? arr[2] : i === 2 ? arr[1] : v);
      if (q && q[2] && this.MONTHS[q[2]]){
        const mm = String(this.MONTHS[q[2]]).padStart(2, "0"), dd = String(q[1]).padStart(2, "0");
        let y = q[3] ? num(q[3]) : num(a.slice(0, 4));
        if (!q[3] && String(y) + mm + dd > a) y--;                  // no year: the latest such day up to today
        return y + mm + dd;
      }
      return "";
    };
    const D = "(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?[a-z]+(?:,?\\s+\\d{4})?|[a-z]+\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?)";
    if ((m = t.match(new RegExp("(?:from|between)\\s+" + D + "\\s+(?:to|and|till|until|-)\\s+" + D)))){ const f = one(m[1]), e = one(m[2]); if (f && e) return {from: f, to: e}; }
    if ((m = t.match(new RegExp("(?:as on|as at|on|till|upto|up to)\\s+" + D)))){ const d = one(m[1]); if (d) return {asOn: d, from: Audit.fyStart(d), to: d}; }
    if ((m = t.match(/\b(?:fy\s*)?(20\d{2})\s*[-\/]\s*(\d{2}|20\d{2})\b/))){ const y = num(m[1]); return {from: y + "0401", to: (y + 1) + "0331"}; }
    if ((m = t.match(/\bq([1-4])\b(?:\s*(?:of|fy)?\s*(20\d{2}))?/))){
      const fy = m[2] ? num(m[2]) : num(Audit.fyStart(a).slice(0, 4)), q = num(m[1]), sm = [4, 7, 10, 1][q - 1], sy = q === 4 ? fy + 1 : fy;
      return {from: String(sy) + String(sm).padStart(2, "0") + "01", to: FC.monthEnd(sy, sm + 2)};
    }
    if (/\blast month\b|\bprevious month\b/.test(t)) return FC.period("lastmonth");
    if (/\bthis month\b/.test(t)) return FC.period("month");
    if (/\blast quarter\b|\bprevious quarter\b/.test(t)) return FC.period("lastquarter");
    if (/\bthis quarter\b/.test(t)) return FC.period("quarter");
    if (/\blast (financial )?year\b|\bprevious year\b|\blast fy\b/.test(t)) return FC.period("lastfy");
    if (/\bthis (financial )?year\b|\bthis fy\b|\bcurrent year\b/.test(t)) return FC.period("fy");
    if (/\bytd\b|\byear to date\b|\bso far\b/.test(t)) return FC.period("ytd");
    // a month, with or without its year: the latest such month up to the anchor
    const mk = Object.keys(this.MONTHS).sort((x, y) => y.length - x.length).find(k => new RegExp("\\b" + k + "\\b").test(t));
    if (mk){
      const mm = this.MONTHS[mk], yy = (t.match(new RegExp("\\b" + mk + "\\w*\\s*,?\\s*(20\\d{2})\\b")) || [])[1];
      let y = yy ? num(yy) : num(a.slice(0, 4));
      if (!yy && String(y) + String(mm).padStart(2, "0") > a.slice(0, 6)) y--;
      return {from: String(y) + String(mm).padStart(2, "0") + "01", to: FC.monthEnd(y, mm)};
    }
    return null;
  },
  understand(text){
    const t = String(text || "").toLowerCase(), x = this.st(), out = {};
    const dates = this.dateIn(t);
    const led = this.bestName(t, FC.ledgers()), grp = this.bestName(t, FC.groups());
    let kind = "";
    if (/\btrial balance\b|\btb\b/.test(t)) kind = "tb";
    else if (/month[- ]?(by[- ]?month|wise)|\bmonthly\b|\btrend\b/.test(t)) kind = "monthly";
    else if (/\boutstanding\b|\bopen bills?\b|\bpending bills?\b|\bbills?\b|\bdues?\b|\bowes?\b|\bageing\b|\baging\b/.test(t)) kind = "bills";
    else if (/\bfind\b|\bsearch\b|\bnarration\b|\bentries (with|of|about)\b|\bwhere\b/.test(t)) kind = "find";
    else if (grp && (!led || grp.score > led.score + 0.05 || /\bgroup\b|\bunder\b/.test(t))) kind = "group";
    else if (led) kind = "ledger";
    else kind = "find";
    out.kind = kind;
    if (kind === "tb"){ out.asOn = (dates && (dates.asOn || dates.to)) || FC.anchor(); }
    else if (kind === "bills"){ out.asOn = (dates && (dates.asOn || dates.to)) || FC.anchor(); out.led = led && (Audit.isDebtor(led.n) || Audit.isCreditor(led.n)) ? led.n : ""; out.side = /\bpay|creditor|supplier|we owe|to pay/.test(t) ? "p" : "r"; }
    else {
      const p = dates || FC.period("ytd"); out.from = p.from; out.to = p.to;
      if (kind === "ledger") out.led = led.n;
      if (kind === "group") out.grp = grp.n;
      if (kind === "monthly"){ if (led && (!grp || led.score >= grp.score)) { out.led = led.n; out.grp = ""; } else if (grp){ out.grp = grp.n; out.led = ""; } }
      if (kind === "find"){
        const q = this.toks(t.replace(/\b(find|search|entries|entry|with|narration|where|for|of|about|from|to|in|on)\b/g, " ")).filter(w => !this.MONTHS[w] && !/^20\d{2}$/.test(w) && !/^(q[1-4]|this|last|month|year|quarter|fy)$/.test(w)).join(" ");
        out.q = q; out.typ = "";
      }
    }
    Object.assign(x, out);
    return out;
  },
  // ---------- the page
  sheet(r){
    if (r.kind === "ledger") return [["Date", "Particulars", "Type", "No.", "Narration", "Debit", "Credit", "Balance"]].concat(r.open != null ? [[FC.iso(r.from), "Opening balance", "", "", "", r.open > 0 ? r.open : "", r.open < 0 ? -r.open : "", FC.drcr(r.open)]] : [])
      .concat(r.rows.map(v => [FC.iso(v.date), v.part, v.type, v.no, v.narr, v.dr || "", v.cr || "", r.open == null ? "" : FC.drcr(v.run)])).concat([["", "Total", "", "", "", r.dr, r.cr, r.close == null ? "" : FC.drcr(r.close)]]);
    if (r.kind === "group") return [["Ledger", "Under", "Opening", "Debit", "Credit", "Closing"]].concat(r.rows.map(z => [z.l, z.sub, z.open == null ? "" : FC.drcr(z.open), z.dr, z.cr, z.close == null ? "" : FC.drcr(z.close)]));
    if (r.kind === "tb") return [["Group", "Ledger", "Under", "Debit", "Credit"]].concat((r.groups || []).flatMap(g => g.rows.map(z => [g.g, z.l, z.sub, z.bal > 0 ? z.bal : "", z.bal < 0 ? -z.bal : ""]))).concat([["", "Total", "", r.dr, r.cr]]);
    if (r.kind === "monthly") return [["Month", "Debit", "Credit", "Net", "Closing"]].concat(r.rows.map(z => [FC.monthLabel(z.ym), z.dr, z.cr, FC.drcr(z.net), z.close == null ? "" : FC.drcr(z.close)]));
    if (r.kind === "bills") return [["Party", "Bill", "Date", "Days", "Outstanding"]].concat(r.rows.map(z => [z.party, z.ref || "on account", FC.iso(z.date), z.age, z.amt]));
    return [["Date", "Type", "No.", "Party", "Narration", "Amount"]].concat(r.rows.map(v => [FC.iso(v.date), v.type, v.no, v.party, v.narr, v.amt]));
  },
  printIt(){
    const r = this.st().res; if (!r) return;
    const rows = this.sheet(r), co = CO();
    const html = "<h1>" + esc(co.name) + "</h1><p class=\"note\">" + esc(r.title) + " · " + (r.src === "tally" ? "read from Tally" : "from the books in FinCom") + " · printed " + fmtDate(new Date().toISOString().slice(0, 10)) + "</p>" +
      "<table><thead><tr>" + rows[0].map(c => "<th>" + esc(c) + "</th>").join("") + "</tr></thead><tbody>" +
      rows.slice(1).map(rw => "<tr>" + rw.map(c => typeof c === "number" ? '<td class="n">' + INR.format(c) + "</td>" : "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
    printView(co.name + " " + r.title, "<style>@page{size:A4 portrait;margin:12mm}</style>" + html);
  }
};
// Look up (app/src/screens/books/Lookup.jsx): what its buttons and boxes do
function lkType(k, v){ const x = LK.st(); x[k] = k === "from" || k === "to" || k === "asOn" ? FC.d8(v) : v; FinComReact.redraw(); }
function lkSrc(src){ LK.st().src = src; render(); }
function lkKind(k){ const x = LK.st(); x.kind = k; x.res = null; x.heard = ""; if (x.typ && !LK.types().includes(x.typ)) x.typ = ""; if (x.kind === "bills" && x.led && !(Audit.isDebtor(x.led) || Audit.isCreditor(x.led))) x.led = ""; render(); }
function lkPer(k){ const x = LK.st(), p = FC.period(k); x.from = p.from; x.to = p.to; LK.run("auto"); }
function lkRec(i){ const x = LK.st(), r = LK.recent()[i]; if (r){ Object.assign(x, r); x.heard = ""; LK.run("auto"); } }
// a ledger clicked anywhere (an entry, a group, the trial balance, a letter): its account for the same dates
function lkLed(l){
  const x = LK.st(), p = x.res && x.res.from ? {from: x.res.from, to: x.res.to} : x.res && x.res.asOn ? {from: Audit.fyStart(x.res.asOn), to: x.res.asOn} : {from: x.from, to: x.to};
  Object.assign(x, {kind: "ledger", led: l, from: p.from, to: p.to, heard: ""}); if (S.booksTab !== "lookup") FC.go("lookup"); LK.run("auto");
}
function lkMonth(ym){ const x = LK.st(), y = num(ym.slice(0, 4)), m = num(ym.slice(4, 6)); Object.assign(x, {kind: x.led ? "ledger" : "group", from: ym + "01", to: FC.monthEnd(y, m)}); LK.run("auto"); }
function lkOpen(id){ const x = LK.st(); x.open[id] = !x.open[id]; render(); }
// a question in plain words (also from the dashboard's question box)
function lkAsk(q){
  const x = LK.st(); x.ask = q = q || "";
  if (!q.trim()){ toast("Type what you want to see."); return; }
  const o = LK.understand(q); x.heard = LK.title(Object.assign({}, x, o));
  if (["ledger", "group", "monthly"].includes(o.kind) && !(o.led || o.grp)){ render(); return; }
  LK.run("auto");
}
function lkAct(a){
  const x = LK.st();
  if (a === "fresh") LK.run("fresh");
  else if (a === "names"){ LK.names = null; LK.loadNames(true); render(); }
  else if (a === "clear"){ x.res = null; render(); }
  else if (a === "more" && x.res && x.res.src === "cloud"){ const r = x.res; x.busy = "Bringing the next entries\u2026"; render();
    TCloud.find(S.coId, r.q, r.from, r.to, r.typ, r).then(res => { x.busy = ""; x.res = Object.assign(res, {title: r.title}); render(); }, er => { x.busy = ""; toast("Could not ask the cloud: " + ((er && er.message) || er)); render(); }); }
  else if (a === "print") LK.printIt();
  else if (a === "excel" && x.res) FC.excel(x.res.title, [[x.res.kind === "tb" ? "Trial balance" : "Look up", LK.sheet(x.res)]]).catch(er => toast("Could not build the file: " + (er && er.message)));
}

// the books follow Tally on every screen, not only while Look up is open: once a minute, quietly (only the bridge's
// copy or the cloud is asked; Tally is not)
setInterval(() => { try { if (S.books && S.books.cid === S.coId && !document.hidden && typeof LK === "object") LK.autoFresh(false, true); } catch (e){} }, 60000);
setInterval(() => { try { if (typeof TCloud === "object") TCloud.auto(); } catch (e){} }, 60000);
setTimeout(() => { try { if (typeof TCloud === "object") TCloud.auto(); } catch (e){} }, 8000);
