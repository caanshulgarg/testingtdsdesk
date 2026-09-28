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
  ledgers(){
    const b = S.books || {}, key = (b.vouchers || []).length + "|" + Object.keys(b.under || {}).length + "|" + Object.keys(b.ledInfo || {}).length + "|" + ((b.tb || {}).at || "");
    if (this._led && this._led.key === key && this._led.cid === b.cid) return this._led.list;
    const s = new Set(Object.keys(b.under || {}).concat(Object.keys(b.ledInfo || {}), Object.keys(b.map || {}), Object.keys((b.tb || {}).led || {})));
    const list = Array.from(s).filter(Boolean).sort((a, c) => a.localeCompare(c));
    this._led = {key, cid: b.cid, list};
    return list;
  },
  groups(){
    const b = S.books || {}, s = new Set(Object.keys(b.groups || {}).concat(Object.values(b.under || {})));
    return Array.from(s).filter(Boolean).sort((a, c) => a.localeCompare(c));
  },
  inGroup(l, g){ const G = String(g || "").toLowerCase(); return Audit.path(l).some(x => x.toLowerCase() === G); },
  top(l){ const p = Audit.path(l); return p[p.length - 1] || "Not in a group"; },
  // a small bar chart, drawn as SVG: series [{name, cls, values}], one bar group per label
  bars(labels, series, o){
    o = o || {}; const H = o.h || 120, W = Math.max(280, labels.length * (series.length * 12 + 10)), pad = 4;
    const all = series.flatMap(s => s.values.map(v => num(v)));
    if (!all.some(v => Math.abs(v) >= 0.5)) return "";
    const max = Math.max(1, ...all.map(v => Math.abs(v))), neg = all.some(v => v < 0);
    const zero = neg ? H / 2 : H - 2, scale = (neg ? H / 2 - 6 : H - 8) / max, gw = (W - pad * 2) / Math.max(1, labels.length), bw = Math.max(3, Math.min(22, (gw - 6) / series.length));
    let g = "";
    labels.forEach((l, i) => {
      series.forEach((s, j) => {
        const v = num(s.values[i]), hgt = Math.max(v ? 1.5 : 0, Math.abs(v) * scale), x = pad + i * gw + (gw - bw * series.length) / 2 + j * bw;
        g += '<rect class="' + (s.cls || "c1") + (v < 0 ? " neg" : "") + '" x="' + x.toFixed(1) + '" y="' + (v >= 0 ? zero - hgt : zero).toFixed(1) + '" width="' + (bw - 1.5).toFixed(1) + '" height="' + hgt.toFixed(1) + '" rx="2"><title>' + esc(l + ": " + s.name + " " + INR0.format(v)) + "</title></rect>";
      });
    });
    g += '<line x1="0" x2="' + W + '" y1="' + zero.toFixed(1) + '" y2="' + zero.toFixed(1) + '" class="axis"/>';
    const key = series.length > 1 ? '<div class="chart-key">' + series.map(s => '<span><i class="' + (s.cls || "c1") + '"></i>' + esc(s.name) + "</span>").join("") + "</div>" : "";
    const every = Math.ceil(labels.length / 12), xl = '<div class="fc-xl" aria-hidden="true">' + labels.map((l, i) => "<span>" + (i % every === 0 ? esc(String(l).slice(0, 8)) : "") + "</span>").join("") + "</div>";
    return '<figure class="fc-chart"' + (o.label ? ' aria-label="' + esc(o.label) + '"' : "") + '><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img">' + g + "</svg>" + xl + key + "</figure>";
  },
  monthLabel(ym){ return typeof GSTR === "object" ? GSTR.label(ym) : ym; },
  shortMonth(ym){ const m = num(String(ym).slice(4, 6)); return ["", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"][((m + 8) % 12) + 1]; },
  go(tab, extra){
    Object.assign(S, extra || {});
    S.tab = "books"; S.booksTab = tab; S.step = null; S.drawerOpen = false;
    render(); window.scrollTo(0, 0);
  },
  noBooks(what){
    const live = typeof bridgeLive === "function" && bridgeLive(CO());
    return '<div class="fc-empty"><div class="fc-empty-ic" aria-hidden="true">▤</div><h3>' + esc(what) + ' needs the books</h3><p class="note">Read the day book and balances from Tally first. It takes a minute a month through the Tally Bridge.</p>' +
      '<div class="row" style="justify-content:center;gap:8px"><button class="btn primary" data-fcgo="import">Read the books from Tally</button>' + (live ? "" : '<button class="btn" data-act="tallyGuide">Set up the Tally Bridge</button>') + "</div></div>";
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
  async ledgerTally(led, from, to){
    const co = CO(), o = Bridge.openFor(co);
    if (!o) throw new Error("Open " + (co.tallyName || co.name) + " in Tally first.");
    if (bridgeVer(Bridge.st.version) < bridgeVer("1.12.3")) throw new Error("This needs Tally Bridge 1.12.3 or later. Download the new setup from Settings, Tally Bridge.");
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
    return {kind: "ledger", src: "tally", led, from, to, open, close, dr, cr, rows, at: new Date().toISOString(),
      note: "Read from Tally (" + o.name + ") just now." + (Math.abs(diff) >= 0.5 ? " Tally's closing balance differs from the entries by " + INR.format(Math.abs(diff)) + ": an entry may be optional or post-dated." : "")};
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
    const B = this.bal(Audit.fyStart(asOn), asOn);
    if (!B.ok) return {kind: "tb", src: "books", asOn, rows: [], none: B.why};
    const at = B.at(asOn), rows = Object.keys(at).filter(l => Math.abs(at[l]) >= 0.005).map(l => ({l, top: FC.top(l), sub: (S.books.under || {})[l] || "", bal: -r2(at[l])}));
    return this.tbShape({kind: "tb", src: "books", asOn, rows, note: "From " + B.src + "."});
  },
  async tbTally(asOn){
    const co = CO(), o = Bridge.openFor(co);
    if (!o) throw new Error("Open " + (co.tallyName || co.name) + " in Tally first.");
    const from = Audit.fyStart(asOn), j = await Bridge.call("/balances?company=" + encodeURIComponent(o.name) + "&from=" + from + "&to=" + asOn + Bridge.pinQ(), null, 600000);
    const under = S.books.under = S.books.under || {};
    const rows = [].concat(j.ledgers || []).map(l => { if (l.parent && !under[l.name]) under[l.name] = l.parent; return {l: l.name, bal: -r2(Books.amt(l.close))}; })
      .filter(r => Math.abs(r.bal) >= 0.005).map(r => Object.assign(r, {top: FC.top(r.l), sub: under[r.l] || ""}));
    return this.tbShape({kind: "tb", src: "tally", asOn, rows, at: new Date().toISOString(), note: "Read from Tally (" + o.name + ") just now."});
  },
  tbShape(r){
    const ORDER = ["Capital Account", "Loans (Liability)", "Current Liabilities", "Fixed Assets", "Investments", "Current Assets", "Sales Accounts", "Purchase Accounts", "Direct Incomes", "Direct Expenses", "Indirect Incomes", "Indirect Expenses", "Suspense A/c", "Branch / Divisions", "Misc. Expenses (ASSET)"];
    const by = {};
    r.rows.forEach(x => { (by[x.top] = by[x.top] || []).push(x); });
    r.groups = Object.keys(by).sort((a, c) => (ORDER.indexOf(a) < 0 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(c) < 0 ? 99 : ORDER.indexOf(c)) || a.localeCompare(c))
      .map(g => ({g, rows: by[g].sort((a, c) => a.l.localeCompare(c.l)), dr: r2(by[g].filter(x => x.bal > 0).reduce((s, x) => s + x.bal, 0)), cr: r2(by[g].filter(x => x.bal < 0).reduce((s, x) => s - x.bal, 0))}));
    r.dr = r2(r.groups.reduce((s, g) => s + g.dr, 0)); r.cr = r2(r.groups.reduce((s, g) => s + g.cr, 0));
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
      return {id: v.id, date: v.date, type: v.type, no: v.no, party: v.party || (v.ent.find(e => e.a < 0) || {}).l || "", narr: v.narr || "", amt: tot || Math.abs(big), ent: v.ent.map(e => ({l: e.l, a: e.a}))};
    });
    return {kind: "find", src: "books", q, from, to, typ, rows, total: r2(rows.reduce((x, r) => x + r.amt, 0))};
  },
  types(){ return Array.from(new Set((S.books.vouchers || []).map(v => v.type).filter(Boolean))).sort(); },
  // ---------- run what the page asks for
  async run(how){
    const x = this.st();
    const need = (c, m) => { if (!c){ toast(m); throw null; } };
    try {
      if (["ledger", "bills"].includes(x.kind) && x.led) need(FC.ledgers().includes(x.led) || how === "tally", "“" + x.led + "” is not a ledger in these books. Pick one from the list.");
      if (x.kind === "ledger") need(x.led, "Choose a ledger.");
      if (x.kind === "group") need(x.grp, "Choose a group.");
      if (x.kind === "monthly") need(x.led || x.grp, "Choose a ledger or a group.");
      if (["ledger", "group", "monthly", "find"].includes(x.kind)) need(x.from && x.to && x.from <= x.to, "The dates are the wrong way round.");
    } catch (e){ if (e) throw e; return; }
    x.open = {};
    if (how === "tally"){
      x.busy = x.kind === "tb" ? "Reading every ledger’s balance from Tally…" : "Reading " + x.led + " from Tally…"; render();
      try { x.res = x.kind === "tb" ? await this.tbTally(x.asOn) : await this.ledgerTally(x.led, x.from, x.to); }
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
      q = x.match(/^(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/); if (q && this.MONTHS[q[2]]) return q[3] + String(this.MONTHS[q[2]]).padStart(2, "0") + q[1].padStart(2, "0");
      return "";
    };
    const D = "(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+[a-z]+\\s+\\d{4})";
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
  view(b){
    const x = this.st(), live = typeof bridgeLive === "function" && bridgeLive(CO()), have = (b.vouchers || []).length > 0;
    const leds = FC.ledgers(), grps = FC.groups();
    const dl = '<datalist id="lkLeds">' + leds.slice(0, 5000).map(l => '<option value="' + esc(l) + '">').join("") + '</datalist><datalist id="lkGrps">' + grps.map(g => '<option value="' + esc(g) + '">').join("") + "</datalist>";
    let h = '<section class="dash-card lk-ask"><h3>Look up</h3>' +
      '<p class="note" style="margin:0 0 10px">Ask in plain words, or choose below. Anything in the books read here opens at once; a ledger or the trial balance can also be read straight from Tally.</p>' +
      '<div class="lk-askrow"><input type="search" id="lkAsk" data-fk="lkAsk" data-lkf="ask" data-keeptyped value="' + esc(x.ask || "") + '" placeholder="Try: HDFC bank for August · Raj Fabrics open bills · sales month by month this year · trial balance as on 31/03/2026" aria-label="Ask a question about the books">' +
      '<button class="btn primary" data-lk="ask">Look up</button></div>' +
      (x.heard ? '<p class="note lk-heard">Understood as: <b>' + esc(x.heard) + "</b>. Change anything below.</p>" : "") +
      '<div class="lk-kinds" role="tablist" aria-label="What to look up">' + this.KINDS.map(([k, l]) => '<button role="tab" data-lkkind="' + k + '" aria-selected="' + (x.kind === k) + '">' + l + "</button>").join("") + "</div>";
    const dates = '<label class="f"><span>From</span><input type="date" data-lkf="from" value="' + FC.iso(x.from) + '"></label><label class="f"><span>To</span><input type="date" data-lkf="to" value="' + FC.iso(x.to) + '"></label>';
    const asOn = '<label class="f"><span>As on</span><input type="date" data-lkf="asOn" value="' + FC.iso(x.asOn) + '"></label>';
    const ledIn = (label, req) => '<label class="f lk-wide"><span>' + label + '</span><input type="text" list="lkLeds" data-fk="lkLed" data-lkf="led" value="' + esc(x.led || "") + '" placeholder="' + (req ? "Start typing a ledger name" : "Every party") + '" autocomplete="off"></label>';
    const grpIn = '<label class="f lk-wide"><span>Group</span><input type="text" list="lkGrps" data-fk="lkGrp" data-lkf="grp" value="' + esc(x.grp || "") + '" placeholder="Sundry Debtors, Indirect Expenses…" autocomplete="off"></label>';
    let form = "";
    if (x.kind === "ledger") form = ledIn("Ledger", true) + dates;
    else if (x.kind === "group") form = grpIn + dates;
    else if (x.kind === "tb") form = asOn;
    else if (x.kind === "monthly") form = ledIn("Ledger (or leave empty and choose a group)", true) + grpIn + dates;
    else if (x.kind === "bills") form = ledIn("Party", false) + asOn + '<label class="f"><span>Side</span><select data-lkf="side"><option value="r"' + (x.side !== "p" ? " selected" : "") + '>Owed to the client</option><option value="p"' + (x.side === "p" ? " selected" : "") + ">Owed by the client</option></select></label>";
    else form = '<label class="f lk-wide"><span>Words, a number or an amount</span><input type="search" data-fk="lkQ" data-lkf="q" value="' + esc(x.q || "") + '" placeholder="party, narration, bill number or 25000"></label>' + dates +
      '<label class="f"><span>Type</span><select data-lkf="typ"><option value="">Every type</option>' + this.types().map(t => '<option' + (x.typ === t ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></label>";
    const presets = ["ledger", "group", "monthly", "find"].includes(x.kind) ? '<div class="lk-presets">' + FC.PRESETS.map(([k, l]) => '<button class="btn small" data-lkper="' + k + '">' + l + "</button>").join("") + "</div>" : "";
    const tallyOk = (x.kind === "ledger" || x.kind === "tb") && live;
    h += '<div class="lk-form">' + form + "</div>" + presets +
      '<div class="row" style="gap:8px;margin-top:10px">' + (have ? '<button class="btn primary" data-lk="books">Show</button>' : "") +
      (tallyOk ? '<button class="btn' + (have ? "" : " primary") + '" data-lk="tally"' + (x.busy ? " disabled" : "") + ">" + (x.busy ? "Reading Tally…" : "Fetch from Tally") + "</button>" : "") +
      ((x.kind === "ledger" || x.kind === "tb") && !live ? '<span class="note">Connect the Tally Bridge to read any period straight from Tally.</span>' : "") + "</div>" + dl + "</section>";
    const rec = this.recent();
    if (rec.length && !x.res) h += '<section class="dash-card" style="margin-top:12px"><h3>Looked up lately</h3><div class="lk-recent">' + rec.map((r, i) => '<button class="btn small" data-lkrec="' + i + '">' + esc(r.label) + "</button>").join("") + "</div></section>";
    if (!have && !live) h += FC.noBooks("Look up");
    if (x.busy) h += busyCard("Reading Tally…", x.busy, 0, 0);
    if (x.res) h += this.result(x.res, x);
    return h;
  },
  voucherRow(r, cols, x){
    const open = x.open[r.id];
    return '<tr class="lk-v' + (open ? " open" : "") + '" data-lkopen="' + esc(r.id) + '" tabindex="0">' + cols + "</tr>" +
      (open ? '<tr class="lk-sub"><td colspan="9"><div class="lk-entries">' + (r.narr ? '<p class="note">' + esc(r.narr) + "</p>" : "") +
        '<table class="bk-table lk-in"><tbody>' + r.ent.map(e => '<tr><td><button class="linkbtn strong" data-lkled="' + esc(e.l) + '">' + esc(e.l) + '</button></td><td class="n">' + (e.a < 0 ? FC.amt(-e.a) : "") + '</td><td class="n">' + (e.a > 0 ? FC.amt(e.a) : "") + "</td></tr>").join("") + "</tbody></table></div></td></tr>" : "");
  },
  result(r, x){
    const src = r.src === "tally" ? '<span class="tag stamp">from Tally</span>' : '<span class="tag ok">from the books</span>';
    let h = '<section class="dash-card lk-res" style="margin-top:12px"><div class="lk-head"><h3>' + esc(r.title || "") + " " + src + '</h3><div class="row" style="gap:6px"><button class="btn small" data-lk="print">Print or PDF</button><button class="btn small" data-lk="excel">Excel</button><button class="btn small" data-lk="clear">Close</button></div></div>';
    if (r.note) h += '<p class="note">' + esc(r.note) + "</p>";
    const tile = (l, v, cls) => '<div class="dtile' + (cls ? " " + cls : "") + '"><span>' + l + "</span><b>" + v + "</b></div>";
    const LIMIT = 1500;
    if (r.kind === "ledger"){
      h += '<div class="dash-tiles">' + tile("Opening", r.open == null ? "not known" : FC.drcr(r.open)) + tile("Debits", FC.amt(r.dr) || "0.00") + tile("Credits", FC.amt(r.cr) || "0.00") + tile("Closing", r.close == null ? FC.drcr(r.dr - r.cr) + " (movement)" : FC.drcr(r.close)) + "</div>";
      if (!r.rows.length) return h + '<div class="bk-none">No entries in ' + esc(r.led) + " for these dates.</div></section>";
      h += '<div class="bk-tablewrap"><table class="bk-table lk-t"><thead><tr><th>Date</th><th>Particulars</th><th>Type</th><th>No.</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead><tbody>' +
        (r.open != null ? '<tr class="lk-ob"><td>' + FC.when(r.from) + "</td><td><b>Opening balance</b></td><td></td><td></td><td class=\"n\">" + (r.open > 0 ? FC.amt(r.open) : "") + '</td><td class="n">' + (r.open < 0 ? FC.amt(-r.open) : "") + '</td><td class="n">' + FC.drcr(r.open) + "</td></tr>" : "") +
        r.rows.slice(0, LIMIT).map(v => this.voucherRow(v, "<td>" + FC.when(v.date) + '</td><td><span class="lk-part">' + esc(v.part) + "</span>" + (v.narr ? '<span class="nr">' + esc(v.narr) + "</span>" : "") + "</td><td>" + esc(v.type) + "</td><td>" + esc(v.no || "") + '</td><td class="n">' + FC.amt(v.dr) + '</td><td class="n">' + FC.amt(v.cr) + '</td><td class="n">' + (r.open == null ? "" : FC.drcr(v.run)) + "</td>", x)).join("") +
        '<tr class="lk-tot"><td></td><td><b>Total</b></td><td></td><td></td><td class="n"><b>' + FC.amt(r.dr) + '</b></td><td class="n"><b>' + FC.amt(r.cr) + '</b></td><td class="n"><b>' + (r.close == null ? "" : FC.drcr(r.close)) + "</b></td></tr></tbody></table></div>" +
        (r.rows.length > LIMIT ? '<p class="note">The first ' + LIMIT + " of " + r.rows.length + " entries are shown; Excel has them all.</p>" : "") + '<p class="note">Click an entry to see both sides. Click a ledger in it to open that ledger.</p>';
    }
    else if (r.kind === "group"){
      h += '<div class="dash-tiles">' + tile("Opening", r.open == null ? "not known" : FC.drcr(r.open)) + tile("Debits", FC.amt(r.dr) || "0.00") + tile("Credits", FC.amt(r.cr) || "0.00") + tile("Closing", r.close == null ? "not known" : FC.drcr(r.close)) + "</div>";
      if (!r.rows.length) return h + '<div class="bk-none">No ledger under ' + esc(r.grp) + " moved in these dates.</div></section>";
      h += '<div class="bk-tablewrap"><table class="bk-table lk-t"><thead><tr><th>Ledger</th><th>Under</th><th class="n">Opening</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Closing</th></tr></thead><tbody>' +
        r.rows.slice(0, LIMIT).map(z => '<tr><td><button class="linkbtn strong" data-lkled="' + esc(z.l) + '">' + esc(z.l) + "</button></td><td>" + esc(z.sub) + '</td><td class="n">' + (z.open == null ? "" : FC.drcr(z.open)) + '</td><td class="n">' + FC.amt(z.dr) + '</td><td class="n">' + FC.amt(z.cr) + '</td><td class="n">' + (z.close == null ? "" : FC.drcr(z.close)) + "</td></tr>").join("") +
        '<tr class="lk-tot"><td><b>' + r.rows.length + ' ledgers</b></td><td></td><td class="n"><b>' + (r.open == null ? "" : FC.drcr(r.open)) + '</b></td><td class="n"><b>' + FC.amt(r.dr) + '</b></td><td class="n"><b>' + FC.amt(r.cr) + '</b></td><td class="n"><b>' + (r.close == null ? "" : FC.drcr(r.close)) + "</b></td></tr></tbody></table></div>";
    }
    else if (r.kind === "tb"){
      if (r.none) return h + '<div class="bk-none">The balances on this date are not known from the books read here: ' + esc(r.none) + "." + (typeof bridgeLive === "function" && bridgeLive(CO()) ? ' <button class="btn small" data-lk="tally">Fetch from Tally</button>' : "") + "</div></section>";
      const diff = r2(r.dr - r.cr);
      h += '<div class="dash-tiles">' + tile("Debit balances", FC.amt(r.dr)) + tile("Credit balances", FC.amt(r.cr)) + tile("Difference", Math.abs(diff) < 0.5 ? "agrees" : FC.amt(diff), Math.abs(diff) < 0.5 ? "" : "warn") + tile("Ledgers", String(r.rows.length)) + "</div>";
      h += '<div class="bk-tablewrap"><table class="bk-table lk-t"><thead><tr><th>Ledger</th><th>Under</th><th class="n">Debit</th><th class="n">Credit</th></tr></thead><tbody>' +
        r.groups.map(g => '<tr class="lk-grp"><td colspan="2"><b>' + esc(g.g) + '</b></td><td class="n"><b>' + FC.amt(g.dr) + '</b></td><td class="n"><b>' + FC.amt(g.cr) + "</b></td></tr>" +
          g.rows.map(z => '<tr><td style="padding-left:22px"><button class="linkbtn strong" data-lkled="' + esc(z.l) + '">' + esc(z.l) + "</button></td><td>" + esc(z.sub) + '</td><td class="n">' + (z.bal > 0 ? FC.amt(z.bal) : "") + '</td><td class="n">' + (z.bal < 0 ? FC.amt(-z.bal) : "") + "</td></tr>").join("")).join("") +
        '<tr class="lk-tot"><td><b>Total</b></td><td></td><td class="n"><b>' + FC.amt(r.dr) + '</b></td><td class="n"><b>' + FC.amt(r.cr) + "</b></td></tr></tbody></table></div>";
    }
    else if (r.kind === "monthly"){
      h += FC.bars(r.rows.map(z => FC.shortMonth(z.ym)), [{name: "Debits", cls: "c1", values: r.rows.map(z => z.dr)}, {name: "Credits", cls: "c2", values: r.rows.map(z => z.cr)}], {label: "Debits and credits by month"});
      h += '<div class="bk-tablewrap"><table class="bk-table lk-t"><thead><tr><th>Month</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Net</th><th class="n">Closing</th></tr></thead><tbody>' +
        (r.open != null ? '<tr class="lk-ob"><td><b>Opening</b></td><td></td><td></td><td></td><td class="n">' + FC.drcr(r.open) + "</td></tr>" : "") +
        r.rows.map(z => '<tr><td><button class="linkbtn strong" data-lkmonth="' + z.ym + '">' + esc(FC.monthLabel(z.ym)) + '</button></td><td class="n">' + FC.amt(z.dr) + '</td><td class="n">' + FC.amt(z.cr) + '</td><td class="n">' + FC.drcr(z.net) + '</td><td class="n">' + (z.close == null ? "" : FC.drcr(z.close)) + "</td></tr>").join("") +
        '<tr class="lk-tot"><td><b>Total</b></td><td class="n"><b>' + FC.amt(r.dr) + '</b></td><td class="n"><b>' + FC.amt(r.cr) + '</b></td><td class="n"><b>' + FC.drcr(r.dr - r.cr) + "</b></td><td></td></tr></tbody></table></div>";
    }
    else if (r.kind === "bills"){
      const over = d => r.rows.filter(z => z.age > d && z.amt > 0).reduce((s, z) => s + z.amt, 0);
      h += '<div class="dash-tiles">' + tile("Outstanding", FC.amt(r.total) || "0.00") + tile("Bills", String(r.rows.length)) + tile("Over 90 days", FC.amt(over(90)) || "0.00", over(90) ? "warn" : "") + tile("Over 180 days", FC.amt(over(180)) || "0.00", over(180) ? "warn" : "") + "</div>";
      if (!r.rows.length) return h + '<div class="bk-none">Nothing open on ' + FC.when(r.asOn) + ".</div></section>";
      h += '<div class="bk-tablewrap"><table class="bk-table lk-t"><thead><tr>' + (r.led ? "" : "<th>Party</th>") + '<th>Bill</th><th>Date</th><th class="n">Days</th><th class="n">Outstanding</th></tr></thead><tbody>' +
        r.rows.slice(0, LIMIT).map(z => "<tr>" + (r.led ? "" : '<td><button class="linkbtn strong" data-lkled="' + esc(z.party) + '">' + esc(z.party) + "</button></td>") + "<td>" + esc(z.ref || "on account") + (z.hasNew ? "" : ' <span class="tag no" title="Raised before the books read here">older</span>') + "</td><td>" + FC.when(z.date) + '</td><td class="n' + (z.age > 90 ? " bad" : "") + '">' + z.age + '</td><td class="n">' + FC.amt(z.amt) + "</td></tr>").join("") +
        '<tr class="lk-tot">' + (r.led ? "" : "<td></td>") + '<td><b>Total</b></td><td></td><td></td><td class="n"><b>' + FC.amt(r.total) + "</b></td></tr></tbody></table></div>";
    }
    else {
      h += '<p class="note"><b>' + r.rows.length + "</b> entries, together " + money(r.total) + ".</p>";
      if (!r.rows.length) return h + '<div class="bk-none">Nothing matches. Try fewer words, or a wider period.</div></section>';
      h += '<div class="bk-tablewrap"><table class="bk-table lk-t"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Party or ledger</th><th class="n">Amount</th></tr></thead><tbody>' +
        r.rows.slice(0, LIMIT).map(v => this.voucherRow(v, "<td>" + FC.when(v.date) + "</td><td>" + esc(v.type) + "</td><td>" + esc(v.no || "") + '</td><td><span class="lk-part">' + esc(v.party) + "</span>" + (v.narr ? '<span class="nr">' + esc(v.narr) + "</span>" : "") + '</td><td class="n">' + FC.amt(v.amt) + "</td>", x)).join("") +
        "</tbody></table></div>" + (r.rows.length > LIMIT ? '<p class="note">The first ' + LIMIT + " are shown; Excel has them all.</p>" : "");
    }
    return h + "</section>";
  },
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
function viewBooksLookup(b){ return LK.view(b); }

if (typeof document !== "undefined"){
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-lk],[data-lkkind],[data-lkper],[data-lkrec],[data-lkled],[data-lkopen],[data-lkmonth],[data-fcgo]");
    if (!t || !S.books) return;
    const x = LK.st();
    if (t.dataset.fcgo){ FC.go(t.dataset.fcgo); return; }
    if (t.dataset.lkkind){ x.kind = t.dataset.lkkind; x.res = null; x.heard = ""; if (x.typ && !LK.types().includes(x.typ)) x.typ = ""; if (x.kind === "bills" && x.led && !(Audit.isDebtor(x.led) || Audit.isCreditor(x.led))) x.led = ""; render(); return; }
    if (t.dataset.lkper){ const p = FC.period(t.dataset.lkper); x.from = p.from; x.to = p.to; if ((S.books.vouchers || []).length) LK.run("books"); else render(); return; }
    if (t.dataset.lkrec){ const r = LK.recent()[+t.dataset.lkrec]; if (r){ Object.assign(x, r); x.heard = ""; LK.run("books"); } return; }
    if (t.dataset.lkled !== undefined){ e.preventDefault(); e.stopPropagation(); const p = x.res && x.res.from ? {from: x.res.from, to: x.res.to} : x.res && x.res.asOn ? {from: Audit.fyStart(x.res.asOn), to: x.res.asOn} : {from: x.from, to: x.to};
      Object.assign(x, {kind: "ledger", led: t.dataset.lkled, from: p.from, to: p.to, heard: ""}); if (S.booksTab !== "lookup") FC.go("lookup"); LK.run("books"); return; }
    if (t.dataset.lkmonth){ const ym = t.dataset.lkmonth, y = num(ym.slice(0, 4)), m = num(ym.slice(4, 6)); Object.assign(x, {kind: x.led ? "ledger" : "group", from: ym + "01", to: FC.monthEnd(y, m)}); LK.run("books"); return; }
    if (t.dataset.lkopen){ if (e.target.closest("button")) return; x.open[t.dataset.lkopen] = !x.open[t.dataset.lkopen]; render(); return; }
    const a = t.dataset.lk;
    if (a === "ask"){ const q = (document.getElementById("lkAsk") || {}).value || x.ask || ""; x.ask = q; if (!q.trim()){ toast("Type what you want to see."); return; }
      const o = LK.understand(q); x.heard = LK.title(Object.assign({}, x, o)); if (["ledger", "group", "monthly"].includes(o.kind) && !(o.led || o.grp)){ render(); return; }
      if (!(S.books.vouchers || []).length && (o.kind === "ledger" || o.kind === "tb") && bridgeLive(CO())) LK.run("tally"); else LK.run("books"); return; }
    if (a === "books") LK.run("books");
    else if (a === "tally") LK.run("tally");
    else if (a === "clear"){ x.res = null; render(); }
    else if (a === "print") LK.printIt();
    else if (a === "excel" && x.res) FC.excel(x.res.title, [[x.res.kind === "tb" ? "Trial balance" : "Look up", LK.sheet(x.res)]]).catch(er => toast("Could not build the file: " + (er && er.message)));
  });
  document.addEventListener("input", e => {
    const t = e.target; if (!t.dataset || !t.dataset.lkf || !S.lk) return;
    const k = t.dataset.lkf, v = t.value;
    S.lk[k] = t.type === "date" ? FC.d8(v) : v;
  });
  document.addEventListener("change", e => {
    const t = e.target; if (!t.dataset || !t.dataset.lkf || !S.lk) return;
    if (t.tagName === "SELECT" || t.type === "date"){ S.lk[t.dataset.lkf] = t.type === "date" ? FC.d8(t.value) : t.value; }
  });
  document.addEventListener("keydown", e => {
    const t = e.target;
    if (e.key === "Enter" && t && t.dataset && t.dataset.lkf){ e.preventDefault(); if (t.dataset.lkf === "ask"){ const b = document.querySelector('[data-lk="ask"]'); if (b) b.click(); } else if ((S.books.vouchers || []).length) LK.run("books"); else if (bridgeLive(CO())) LK.run("tally"); }
    if (e.key === "Enter" && t && t.dataset && t.dataset.lkopen){ e.preventDefault(); t.click(); }
  });
}
