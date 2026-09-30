/* ================================================================== */
/* Certificates under 197, and 206AA where there is no PAN            */
/* ================================================================== */
const Certs = {
  all(){ return ((S.books || {}).certs || []).slice().sort((a, b) => String(a.party).localeCompare(String(b.party))); },
  // the certificate that covers this payment, if there is one
  forRow(r){
    return this.all().find(c => (!c.section || c.section === r.section) &&
      normName(c.party) === normName(r.party) &&
      (!c.from || TDS.ymd(r.date) >= TDS.ymd(c.from)) && (!c.to || TDS.ymd(r.date) <= TDS.ymd(c.to)));
  },
  validPan(p){ return /^[A-Z]{5}\d{4}[A-Z]$/.test(String(p || "").toUpperCase()); },
  // what the rate should have been, and why
  expected(r){
    const cert = this.forRow(r);
    if (cert) return {rate: num(cert.rate), why: "certificate " + (cert.certNo || "under 197"), cert};
    if (!this.validPan(r.pan)) return {rate: 20, why: "no valid PAN, section 206AA"};
    const std = (TDS.STD[String(r.section).replace(/\s.*$/, "")] || []);
    if (!std.length) return {rate: null, why: ""};
    const near = std.slice().sort((a, b) => Math.abs(a - (r.rate || 0)) - Math.abs(b - (r.rate || 0)))[0];
    return {rate: near, why: "usual rate for " + r.section};
  },
  // where the books deducted at a different rate from the one that applies
  issues(fy, q){
    const out = [];
    TDS.rows().filter(r => (!fy || r.fy === fy) && (!q || r.q === q)).forEach(r => {
      const e = this.expected(r);
      if (e.rate == null || r.rate == null) return;
      const short = r2(r.paid * (e.rate - r.rate) / 100);
      if (Math.abs(e.rate - r.rate) < 0.05 || Math.abs(short) < 1) return;
      out.push({row: r, expected: e.rate, why: e.why, short});
    });
    return out.sort((a, b) => Math.abs(b.short) - Math.abs(a.short));
  }
};
/* ---------- quarter by quarter, and the year in one file ---------- */
const TDSYear = {
  quarters(fy){
    const ch = TDS.challans().filter(c => TDS.fyOf(c.date) === fy), use = TDS.challanUse();
    return ["Q1", "Q2", "Q3", "Q4"].map(q => {
      const rows = TDS.rows().filter(r => r.fy === fy && r.q === q);
      const sal = TDS24Q.annexI(fy, q);
      const mine = ch.filter(c => TDS.qOf(c.date) === q);
      return {q, deductions: rows.length, paid: r2(rows.reduce((a, r) => a + r.paid, 0)), tds: r2(rows.reduce((a, r) => a + r.tds, 0)),
        unallocated: r2(rows.filter(r => !r.challan).reduce((a, r) => a + r.tds, 0)), noPan: rows.filter(r => !Certs.validPan(r.pan)).length,
        challans: mine.length, challanTax: r2(mine.reduce((a, c) => a + num(c.tax), 0)),
        used: r2(mine.reduce((a, c) => a + (use[c.id] || 0), 0)),
        salaryEmployees: sal.length, salaryPaid: r2(sal.reduce((a, e) => a + e.paid, 0)), salaryTds: r2(sal.reduce((a, e) => a + e.tds, 0)),
        issues: Certs.issues(fy, q).length};
    });
  },
  async toExcel(fy, which){
    await ensureXlsx();
    const d = s => { const t = TDS.ymd(s); return t.length === 8 ? t.slice(6, 8) + "/" + t.slice(4, 6) + "/" + t.slice(0, 4) : ""; };
    const wb = XLSX.utils.book_new();
    const add = (name, head, body) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(body)), name.slice(0, 31));
    const qs = this.quarters(fy);
    add("Year " + fy, ["Quarter", "Deductions", "Amount paid", "TDS", "Not against a challan", "Without PAN", "Challans", "Challan tax",
      "Salary employees", "Salary paid", "Salary TDS", "Rate questions"],
      qs.map(x => [x.q, x.deductions, x.paid, x.tds, x.unallocated, x.noPan, x.challans, x.challanTax, x.salaryEmployees, x.salaryPaid, x.salaryTds, x.issues]));
    if (which !== "24Q"){
      ["Q1", "Q2", "Q3", "Q4"].forEach(q => {
        const rows = TDS.rows().filter(r => r.fy === fy && r.q === q);
        if (!rows.length) return;
        const ch = TDS.challans().filter(c => TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q);
        add("26Q " + q, ["Sl.", "Deductee code", "PAN", "Deductee", "Section", "Date", "Amount paid", "TDS", "Rate", "Rate that applies", "Why", "Challan BSR", "Challan serial", "Challan date"],
          rows.map((r, i) => {
            const c = ch.find(x => x.id === r.challan) || {}, e = Certs.expected(r);
            return [i + 1, Certs.validPan(r.pan) ? (/^[A-Z]{3}C/.test(r.pan) ? "01" : "02") : "02", r.pan || "PANNOTAVBL", r.party,
              "9" + String(r.section).replace(/^19/, ""), d(r.date), r.paid, r.tds, r.rate, e.rate, e.why, c.bsr || "", c.serial || "", d(c.date || "")];
          }));
      });
      const ch = TDS.challans().filter(c => TDS.fyOf(c.date) === fy), use = TDS.challanUse();
      add("Challans " + fy, ["Quarter", "BSR code", "Serial", "Deposited", "Tax", "Interest", "Allocated", "Left"],
        ch.map(c => [TDS.qOf(c.date), c.bsr, c.serial, d(c.date), num(c.tax), num(c.interest), use[c.id] || 0, r2(num(c.tax) - (use[c.id] || 0))]));
      const iss = Certs.issues(fy, "");
      if (iss.length) add("Rate questions", ["Date", "Deductee", "PAN", "Section", "Paid", "Rate used", "Rate that applies", "Why", "Short or excess"],
        iss.map(x => [d(x.row.date), x.row.party, x.row.pan || "", x.row.section, x.row.paid, x.row.rate, x.expected, x.why, x.short]));
    }
    if (which !== "26Q" && (S.books.salary || []).length){
      ["Q1", "Q2", "Q3", "Q4"].forEach(q => {
        const a1 = TDS24Q.annexI(fy, q);
        if (!a1.length) return;
        add("24Q " + q, ["Sl.", "Employee", "PAN", "Code", "Months", "Amount paid", "TDS"],
          a1.map((e, i) => [i + 1, e.name, e.pan || "PANNOTAVBL", e.code, e.months, e.paid, e.tds]));
      });
      const a2 = TDS24Q.annexII(fy);
      if (a2.length) add("Annexure II " + fy, ["Employee", "PAN", "Regime", "Gross", "Exempt", "Standard", "Professional tax", "Chapter VI-A", "Taxable", "TDS", "Surcharge", "Cess"],
        a2.map(e => [e.name, e.pan || "PANNOTAVBL", e.regime === "N" ? "New" : e.regime === "O" ? "Old" : "", e.gross, e.exempt, e.standard, e.profTax, e.chapter6, e.taxable, e.tds, e.surcharge, e.cess]));
    }
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-TDS-" + (which || "year") + "-" + fy.replace("-", "") + ".xlsx",
      new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};

/* ---------- Books, TDS and GST: the screens ---------- */
function booksTab(){ return S.booksTab || "import"; }
async function openBooks(cid){
  if (S.books && S.books.cid === cid) return;
  S.books = {cid, loading: true};
  render();
  const saved = await Books.load(cid);
  S.books = saved && saved.cid === cid ? Object.assign({loading: false}, saved) : {cid, loading: false, vouchers: [], map: {}, challans: [], alloc: {}, pans: {}};
  if (S.books.vouchers && S.books.vouchers.length) try { LedMaster.refresh(S.books); } catch (e){}
  if (typeof BookSync === "object") BookSync.pull(cid);
  setTimeout(() => { try { if (S.books && S.books.cid === cid){ Audit.maybeRun(); MIS.maybeRun(); } } catch (e){} }, 400);
  render();
}
// everything kept with a client's books, in this browser and (the TDS and GST work) in the firm's database
const BOOKS_KEYS = ["vouchers", "map", "meta", "challans", "alloc", "pans", "twoB", "gstins", "under", "states", "groups", "salary", "certs", "advFix", "assets", "rev", "filed", "amendFix", "twoBs", "reco2b", "ledInfo", "ledInfoAt", "audit", "auditCfg", "auditRel", "ledSnaps", "gst9c", "groupInfo", "fs", "tb", "mis", "misCfg", "msme", "budget", "gst3b", "gst9", "gstOpen", "itcBasis", "itcTrack", "outRej", "gstFiled", "gstAato", "filed1a", "rule37On", "gstCashLedger", "gstSet", "gstContacts", "gstApi", "gstEst", "gstVault", "gstRegs", "letters", "ai", "tallyCo", "tbCheck"];
async function saveBooks(opts, bb){
  const b = bb || S.books; if (!b || !b.cid) return;
  const keep = {cid: b.cid}; BOOKS_KEYS.forEach(k => { keep[k] = b[k]; });
  await Books.save(b.cid, keep);
  if (!(opts && opts.fromCloud) && typeof BookSync === "object") BookSync.schedule(b.cid);
}
// filed GST returns whose documents changed in Tally since: on every Books tab until the amendments are reported
// the books of a client (TDS & GST, MIS, Accounts, Audit, …): React (app/src/screens/Books.jsx)
function viewBooks(){ return '<div data-react="Books"></div>'; }

/* ---------- straight from Tally through the bridge: the day book month by month, and Tally's own balances ---------- */
const TallyRead = {
  months(from, to){
    const out = []; let y = num(from.slice(0, 4)), m = num(from.slice(4, 6));
    while (String(y) + String(m).padStart(2, "0") <= to.slice(0, 6)){
      const ym = String(y) + String(m).padStart(2, "0"), last = new Date(y, m, 0).getDate();
      out.push({ym, from: ym + "01" < from ? from : ym + "01", to: ym + String(last) > to ? to : ym + String(last)});
      m++; if (m > 12){ m = 1; y++; }
    }
    return out;
  },
  async raw(path, ms){
    const c = Bridge.cfg(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms || 900000);
    try {
      const r = await fetch(c.url.replace(/\/+$/, "") + path, {headers: {"X-Bridge-Key": c.key}, signal: ctl.signal, cache: "no-store"});
      const t = await r.text();
      if (!r.ok){ let e = t; try { e = JSON.parse(t).error; } catch (x){} throw new Error(e || ("The bridge answered with error " + r.status)); }
      return t;
    } finally { clearTimeout(timer); }
  },
  // put a month's vouchers in place of what was there for those dates
  merge(b, res, from, to){
    b.vouchers = (b.vouchers || []).filter(v => v.date < from || v.date > to).concat(res.vouchers);
    const m = b.meta = b.meta || {};
    const g = new Set((m.gstins || []).concat(res.meta.gstins || []));
    m.gstins = Array.from(g).sort(); m.bills = 1; m.company = res.meta.company || m.company;
    m.from = !m.from || from < m.from ? from : m.from; m.to = !m.to || to > m.to ? to : m.to;
  },
  balances(b, j, from, to){
    const led = {};
    [].concat(j.ledgers || []).forEach(l => { led[l.name] = {open: Books.amt(l.open), close: Books.amt(l.close), parent: l.parent || ""}; });
    b.tb = {from, to, at: new Date().toISOString(), led};
    Object.entries(led).forEach(([n, x]) => { if (x.parent) (b.under = b.under || {})[n] = (b.under[n] || x.parent); });
  },
  // after the books changed (read from Tally, changes brought in from the kept copy or the cloud, a day book file):
  // every section follows. Screens work from the entries as they are; audit and MIS are worked out again for the
  // period they last covered. A filed GST return is never changed: when its documents changed in Tally, a warning
  // names the return (and its ARN) and the return the changes go in as amendments
  after(b, why, range){
    b.reco = null; if (typeof GSTR === "object") GSTR._carry = null;
    if (!(b.vouchers || []).length) return;              // a very large company answered from the cloud's totals: nothing to work on here
    // audit and MIS take seconds on a big company, and the page waits meanwhile: they are not worked out here on every
    // change, only marked out of date; each is worked out again when its tab is opened (Audit, MIS)
    b.stale = {audit: why, mis: why, range: range || null};
    let d = []; try { d = GSTAmend.drift(); } catch (e){}
    const seen = new Set((b.gstDrift || []).map(x => x.ym + "|" + x.gstin + "|" + x.n));
    b.gstDrift = d;
    const fresh = d.filter(x => !seen.has(x.ym + "|" + x.gstin + "|" + x.n));
    if (fresh.length) toast(GSTAmend.driftLine(fresh[0]) + (fresh.length > 1 ? " " + (fresh.length - 1) + " more filed return" + (fresh.length > 2 ? "s" : "") + " changed: see GST → Amendments." : ""));
  },
  // an out-of-date audit or MIS, worked out again once its tab is on the screen (the page is drawn first)
  catchUp(b, k){
    const st = b.stale || {};
    if (!st[k] || this._catching) return "";
    this._catching = true;
    setTimeout(() => {
      try {
        if (k === "audit" && Audit.cfg(b).freq !== "off"){ const L = (b.audit || {}).last, r = st.range || (L && L.from ? L : Audit.defaultRange(b)); Audit.run(r.from, r.to, st.audit); }
        if (k === "mis"){ const H = ((b.mis || {}).history || [])[0], r = H && H.from ? H : MIS.autoRange(b); if (r && r.from) MIS.run(r.from, r.to, st.mis); }
      } catch (e){}
      delete st[k]; this._catching = false; saveBooks(); render();
    }, 60);
    return '<p class="bk-warn" role="status">Tally has changed since this was worked out; working it out again\u2026</p>';
  },
  soon(k, b, fn){
    const t = this._soon = this._soon || {}, x = t[k] = t[k] || {at: 0}, wait = 180000 - (Date.now() - x.at);
    const go = () => { x.at = Date.now(); x.timer = 0; if (S.books !== b) return; try { fn(); } catch (e){} };
    if (wait <= 0 || x.cid !== b.cid){ x.cid = b.cid; clearTimeout(x.timer); go(); return; }
    if (!x.timer) x.timer = setTimeout(() => { go(); saveBooks(); render(); }, wait);
  },
  // read a period: each month's day book, then the balances
  async read(from, to, how){
    const b = S.books, co = CO(), name = Bridge.openFor(co).name, q = "?company=" + encodeURIComponent(name) + Bridge.pinQ();
    const ms = this.months(from, to);
    if (how === "copy"){
      for (let i = 0; i < ms.length; i++){
        const x = ms[i];
        b.busy = "Reading " + GSTR.label(x.ym) + " from the copy (" + (i + 1) + " of " + ms.length + ")\u2026"; render();
        const res = await Books.importDayBook(new Blob([await this.raw("/syncfile" + q + "&file=daybook-" + x.ym + ".xml")], {type: "text/xml"}));
        const bad = notThisClient((res.meta || {}).gstins);
        if (bad.length){ b.busy = ""; render(); throw new Error(panRefusal("The company open in Tally", bad)); }
        this.merge(b, res, x.from, x.to);
      }
    } else {
      // Tally answers one request at a time and its screen waits meanwhile: the day book is read a few days at a time,
      // each read a few seconds (fewer days when Tally is slow, more when it is quick), with a pause between, so Tally
      // stays usable and the bridge can answer FinCom's other checks in between
      const add = (d, n) => { const t = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + n); return t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0"); };
      let at = from, step = 3, n = 0;
      const total = Math.max(1, Math.round((new Date(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8)) - new Date(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8))) / 864e5) + 1);
      while (at <= to){
        let end = add(at, step - 1); if (end > to) end = to;
        const monthEnd = (ms.find(m => m.ym === at.slice(0, 6)) || {}).to || end; if (end > monthEnd) end = monthEnd;     // never across a month
        n += Math.round((new Date(+end.slice(0, 4), +end.slice(4, 6) - 1, +end.slice(6, 8)) - new Date(+at.slice(0, 4), +at.slice(4, 6) - 1, +at.slice(6, 8))) / 864e5) + 1;
        b.busy = "Reading " + FC.span(at, end) + " from Tally (" + Math.min(100, Math.round(n * 100 / total)) + "%). Tally stays usable meanwhile\u2026"; render();
        const t0 = Date.now();
        const text = await this.raw("/daybook" + q + "&from=" + at + "&to=" + end);
        const sec = (Date.now() - t0) / 1000;
        const res = await Books.importDayBook(new Blob([text], {type: "text/xml"}));
        const bad = notThisClient((res.meta || {}).gstins);
        if (bad.length){ b.busy = ""; render(); throw new Error(panRefusal("The company open in Tally", bad)); }
        this.merge(b, res, at, end);
        step = sec > 6 ? Math.max(1, Math.floor(step / 2)) : sec < 2 ? Math.min(31, step * 2) : step;
        at = add(end, 1);
        await new Promise(r => setTimeout(r, Math.min(3000, 300 + sec * 500)));
      }
    }
    // opening balances only: Tally works every ledger's balance out for the date asked, which is slow on a big
    // company; the closing figures follow from the opening and the entries just read
    // the bridge's copy may already hold them for this date (read at a quiet time): then Tally is not asked at all
    let j = null;
    if (how !== "copy"){
      try { const k = JSON.parse(await this.raw("/syncfile" + q + "&file=balances.json", 60000)); if (k && k.openAsOn === (t => t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0"))(new Date(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8) - 1)) && (k.ledgers || []).length) j = Object.assign({}, k, {from, to, openOnly: true}); } catch (e){}
    }
    if (!j){
      b.busy = "Reading the opening balances from Tally (one read; Tally may be busy for a moment)\u2026"; render();
      j = how === "copy" ? JSON.parse(await this.raw("/syncfile" + q + "&file=balances.json")) : await Bridge.call("/balances" + q + "&from=" + from + "&to=" + to + "&open=1", null, 600000);
    }
    this.balances(b, j, j.from || from, j.to || to);
    if (how !== "copy" && typeof MIS === "object"){ const mv = MIS.moves(b.tb.from, b.tb.to); Object.entries(b.tb.led).forEach(([l, x]) => { if (j.openOnly || x.close === "" || isNaN(x.close)) x.close = r2(num(x.open) + ((mv[l] || {}).t || 0)); }); }
    b.map = Books.mapLedgers(b.vouchers, b.map); LedMaster.refresh(b);
    b.meta.at = new Date().toISOString(); b.meta.file = how === "copy" ? "last night's copy from Tally" : "read from Tally";
    b.busy = "";
    this.after(b, how === "copy" ? "after last night's copy was read" : "after reading from Tally", {from: j.from || from, to: j.to || to});
    await saveBooks();
    return b.vouchers.length;
  }
};
// Setting a company up, in order: what is done, what is missing, and what the bridge does next. The bridge does not
// read the year from Tally by itself: it waits for the day book files (or is told to copy the year in the evening)
// the parts of the day book brought in from files, and the default date for the trial balance: the day before the first
function tbDefaultOn(b){
  const parts = ((b.meta || {}).parts || []).map(p => p.from).sort(), f = parts[0] || (b.meta || {}).from;
  if (!f) return "";
  const t = new Date(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8) - 1);
  return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
}
function tallyDate(s){ return s && String(s).length === 8 ? String(s).slice(0, 4) + "-" + String(s).slice(4, 6) + "-" + String(s).slice(6, 8) : ""; }
// the line shown on the TDS and GST screens while ledgers are still to be confirmed
// the files for filing are made only from confirmed ledgers
function ledgersReady(which){
  const p = LedMaster.pending(S.books).filter(([, m]) => which === "gst" ? !LedMaster.isTds(m.what) : !LedMaster.isGst(m.what));
  if (!p.length) return true;
  toast(p.length + " ledger" + (p.length === 1 ? " is" : "s are") + " still to be confirmed. Confirm them first, so the file is right.");
  S.booksTab = "ledgers"; S.lmView = "pending"; render();
  return false;
}

/* ---------- TDS, the way TDS software is laid out: year, then quarter, then the return, then its tabs ---------- */
function tdsYears(b, rows){
  return Array.from(new Set(rows.map(r => r.fy).concat((b.salary || []).map(r => TDS.fyOf(r.date))).concat(TDS.challans().map(c => TDS.fyOf(c.date)))))
    .filter(f => /^\d{4}-\d{2}$/.test(f)).sort().reverse();
}
// a TDS return's pages are React (app/src/screens/TdsReturn.jsx); these work out what they show
function tdsSorted(tab, list, get){
  const s = ((S.tdsSort || {})[tab]) || {};
  if (!s.k) return list;
  return list.slice().sort((a, c) => { const x = get(a, s.k), y = get(c, s.k); return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * (s.d || 1); });
}
function tdsMonths(fy, q){
  const y = num(fy.slice(0, 4)), start = {Q1: 4, Q2: 7, Q3: 10, Q4: 1}[q], yy = q === "Q4" ? y + 1 : y;
  return [0, 1, 2].map(i => String(yy) + String(start + i).padStart(2, "0"));
}
function monthName(ym){ return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][num(ym.slice(4, 6)) - 1] + " " + ym.slice(0, 4); }
// the challans a quarter uses: deposited in it, or paying one of its deductions
function tdsQuarterChallans(fy, q, rows){
  const used = new Set(rows.map(r => r.challan).filter(Boolean));
  return TDS.challans().filter(c => (TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q) || used.has(c.id));
}
function filterBar(id, opts){
  const f = S[id] || {};
  return '<div class="revfilter"><input type="search" id="' + id + 'q" data-fk="' + id + 'q" data-keeptyped value="' + esc(f.q || "") + '" placeholder="' + esc(opts.placeholder || "Find") + '">' +
    (opts.selects || []).map(sel => '<select data-' + id + sel.key + '>' + sel.options.map(([v, l]) => '<option value="' + v + '"' + ((f[sel.key] || "") === v ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select>").join("") +
    '<span class="note">' + esc(opts.count || "") + "</span>" +
    (Object.keys(f).some(k => f[k]) ? '<button class="linkbtn" data-clearf="' + id + '">Clear</button>' : "") +
    '<button class="btn small" data-printid="' + opts.table + '" data-printtitle="' + esc(opts.title || "") + '">Print or save as PDF</button>' +
    (opts.excel ? '<button class="btn small" data-act="' + opts.excel + '">Excel</button>' : "") + "</div>";
}
function tdsFiltered(rows){
  const f = S.tdsF || {}, q = String(f.q || "").toLowerCase();
  return rows.filter(r => {
    if (q && ![r.party, r.pan, r.section, r.voucher].join(" ").toLowerCase().includes(q)) return false;
    if (f.section && r.section !== f.section) return false;
    if (f.challan === "no" && r.challan) return false;
    if (f.challan === "yes" && !r.challan) return false;
    if (f.pan === "no" && Certs.validPan(r.pan)) return false;
    if (f.pan === "yes" && !Certs.validPan(r.pan)) return false;
    return true;
  });
}
// printing, which is also how a PDF is made
function printView(title, html){
  const w = window.open("", "_blank");
  if (!w){ toast("Allow pop-ups for this site to print."); return; }
  w.document.write("<html><head><title>" + esc(title) + "</title><style>" +
    "body{font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#15201B;padding:18px}" +
    "h1{font-size:17px;margin:0 0 2px}p.note{color:#5A6B63;font-size:12px;margin:0 0 10px}" +
    "table{border-collapse:collapse;width:100%;font-size:11.5px;margin-bottom:10px}th,td{border:1px solid #D7DEDA;padding:4px 6px;text-align:left}" +
    "th{background:#EEF3F0}td.n,th.n{text-align:right}button,select{border:0;background:none;font:inherit;padding:0;color:inherit;appearance:none}" +
    "@page{size:A4 landscape;margin:12mm}</style></head><body>" + html + "</body></html>");
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}


function misRangeQuick(k, b){
  const t = Audit.today(), last = String((b.meta || {}).to || t), end = last < t ? last : t;
  const d = new Date(Audit.iso(end) + "T00:00:00"), ymd = x => x.getFullYear() + String(x.getMonth() + 1).padStart(2, "0") + String(x.getDate()).padStart(2, "0");
  if (k === "month") return {from: end.slice(0, 6) + "01", to: end};
  if (k === "lastmonth"){ const pm = new Date(d.getFullYear(), d.getMonth(), 0); return {from: ymd(pm).slice(0, 6) + "01", to: ymd(pm)}; }
  if (k === "quarter"){ const qm = Math.floor(d.getMonth() / 3) * 3; return {from: ymd(new Date(d.getFullYear(), qm, 1)), to: end}; }
  if (k === "ytd") return {from: Audit.fyStart(end), to: end};
  if (k === "lastyear"){ const fs = Audit.fyStart(t), y = num(fs.slice(0, 4)); return {from: (y - 1) + "0401", to: y + "0331"}; }   // the last complete financial year
  return null;
}
// the monthly pack: one document for the owner
function misPackHtml(r){
  const m = v => INR.format(r2(v || 0)), co = CO();
  const pl = [["Revenue from operations", (r.pl.heads.rev || {t: 0}).t], ["Other income", (r.pl.heads.oth || {t: 0}).t], ["Purchases and direct expenses", ((r.pl.heads.pur || {t: 0}).t + (r.pl.heads.dir || {t: 0}).t)], ["Gross profit", r.pl.gross.t, 1],
    ["Employee costs", (r.pl.heads.emp || {t: 0}).t], ["Other expenses", (r.pl.heads.exp || {t: 0}).t], ["Finance costs", (r.pl.heads.fin || {t: 0}).t], ["Depreciation", (r.pl.heads.dep || {t: 0}).t], ["Profit before tax", r.pl.pbt.t, 1]];
  const owed = A => A.sum.tally != null ? A.sum.tally : A.sum.open;
  let h = '<div style="border-bottom:2px solid #15201B;padding-bottom:8px;margin-bottom:12px"><div style="font-size:12px;color:#5A6B63">MIS</div><h1 style="font-size:22px;margin:4px 0">' + esc(co.name) + "</h1>" +
    '<div>' + fmtDate(tallyDate(r.from)) + " to " + fmtDate(tallyDate(r.to)) + " \u00b7 prepared " + fmtDate(r.at.slice(0, 10)) + " \u00b7 result code " + esc(r.code) + (r.control ? (r.control.ok ? " \u00b7 agrees with Tally\u2019s balances" : " \u00b7 " + r.control.n + " ledgers differ from Tally") : "") + "</div></div>";
  h += "<h2>At a glance</h2><table><tbody>" + [["Sales", m(r.sales.total) + (r.prev ? " (previous period " + m(r.prev.sales) + ")" : "") + (r.ly ? " (last year " + m(r.ly.sales) + ")" : "")], ["Profit before tax", m(r.pl.pbt.t)],
    ["Received / paid", m(r.cash.rec) + " / " + m(r.cash.pay)], ["Owed to you", m(owed(r.recv)) + " (over 90 days " + m(r.recv.sum.b[3] + r.recv.sum.b[4]) + ")"], ["You owe", m(owed(r.pay)) + " (MSME past " + MIS.cfg(S.books).msmeDays + " days " + m(r.msme.reduce((s, x) => s + x.amt, 0)) + ")"]]
    .map(([a, c]) => "<tr><td>" + a + "</td><td>" + c + "</td></tr>").join("") + "</tbody></table>";
  h += "<h2>Profit and loss</h2><table><tbody>" + pl.map(([a, v, bold]) => "<tr><td>" + (bold ? "<b>" + a + "</b>" : a) + '</td><td class="n">' + (bold ? "<b>" + m(v) + "</b>" : m(v)) + "</td></tr>").join("") + "</tbody></table>" +
    '<p class="note">Before the change in stock.</p>';
  if (r.balances.cash) h += "<h2>Cash and bank</h2><table><tbody>" + r.balances.cash.concat(r.balances.bank).filter(x => Math.abs(x[1]) >= 1).map(([l, v]) => "<tr><td>" + esc(l) + '</td><td class="n">' + m(v) + "</td></tr>").join("") + "</tbody></table>";
  // open bills by age: the parties with the most outstanding
  const age = (t, A) => { const open = p => p.b.reduce((a, v) => a + v, 0), rows = A.rows.filter(p => open(p) > 0).sort((a, c) => open(c) - open(a) || a.party.localeCompare(c.party));
    return "<h2>" + t + "</h2><table><thead><tr><th>Party</th>" + MIS.BUCKETS.map(z => '<th class="n">' + z[1] + "</th>").join("") + '<th class="n">Open bills</th></tr></thead><tbody>' +
    rows.slice(0, 15).map(p => "<tr><td>" + esc(p.party) + "</td>" + p.b.map(v => '<td class="n">' + (v ? m(v) : "") + "</td>").join("") + '<td class="n">' + m(open(p)) + "</td></tr>").join("") +
    "<tr><td><b>All</b></td>" + A.sum.b.map(v => '<td class="n"><b>' + m(v) + "</b></td>").join("") + '<td class="n"><b>' + m(A.sum.open) + "</b></td></tr></tbody></table>" +
    (Math.abs(A.sum.pre) >= 1 && A.sum.tally == null ? '<p class="note">' + m(Math.abs(A.sum.pre)) + " was settled against bills from before the books read here; they are not in these figures.</p>" : ""); };
  h += age("Receivables, largest 15", r.recv) + age("Payables, largest 15", r.pay);
  h += "<h2>Top customers</h2><table><tbody>" + r.sales.rows.slice(0, 10).map(x => "<tr><td>" + esc(x.party) + '</td><td class="n">' + m(x.t) + '</td><td class="n">' + (r.sales.total ? Math.round(x.t / r.sales.total * 1000) / 10 + "%" : "") + "</td></tr>").join("") + "</tbody></table>";
  h += "<h2>Compliance</h2><table><thead><tr><th>Month</th><th class=\"n\">GST payable in cash</th><th class=\"n\">TDS deducted</th><th class=\"n\">TDS deposited</th></tr></thead><tbody>" +
    r.comp.gst.map((x, i) => "<tr><td>" + GSTR.label(x.ym) + '</td><td class="n">' + m(x.pay) + '</td><td class="n">' + m(r.comp.tds[i].ded) + '</td><td class="n">' + m(r.comp.tds[i].dep) + "</td></tr>").join("") + "</tbody></table>" +
    "<h2>Due in the coming weeks</h2><table><tbody>" + r.dues.map(([d, l]) => "<tr><td>" + fmtDate(tallyDate(d)) + "</td><td>" + esc(l) + "</td></tr>").join("") + "</tbody></table>";
  if (r.p2){
    const F = r.p2.fc, C = r.p2.cash;
    h += "<h2>Cash flow</h2><table><tbody><tr><td>From operations</td><td class=\"n\">" + m(C.op.t) + "</td></tr><tr><td>From investing</td><td class=\"n\">" + m(C.inv.t) + "</td></tr><tr><td>From financing</td><td class=\"n\">" + m(C.fin.t) + "</td></tr><tr><td><b>Net change</b></td><td class=\"n\"><b>" + m(C.net) + "</b></td></tr></tbody></table>";
    h += "<h2>The next 13 weeks</h2><table><thead><tr><th>Week of</th><th class=\"n\">In</th><th class=\"n\">Out</th>" + (F.opening != null ? "<th class=\"n\">Cash at the end</th>" : "<th class=\"n\">Net</th>") + "</tr></thead><tbody>" +
      F.weeks.map(w => "<tr><td>" + fmtDate(tallyDate(w.from)) + '</td><td class="n">' + m(w.inn) + '</td><td class="n">' + m(w.out) + '</td><td class="n">' + m(F.opening != null ? w.close : w.net) + "</td></tr>").join("") + "</tbody></table>";
    const V = MIS.budgetVs(r);
    if (V.has) h += "<h2>Budget against actual</h2><table><thead><tr><th>Head</th><th class=\"n\">Budget</th><th class=\"n\">Actual</th><th class=\"n\">Difference</th></tr></thead><tbody>" + V.rows.map(x => "<tr><td>" + esc(x.l) + '</td><td class="n">' + m(x.budget) + '</td><td class="n">' + m(x.actual) + '</td><td class="n">' + m(x.diff) + "</td></tr>").join("") + "</tbody></table>";
    if (r.p2.cc.rows.length) h += "<h2>Cost centres, largest 15 by income</h2><table><thead><tr><th>Cost centre</th><th class=\"n\">Income</th><th class=\"n\">Costs</th><th class=\"n\">Profit</th><th class=\"n\">Margin</th></tr></thead><tbody>" +
      r.p2.cc.rows.slice(0, 15).map(x => "<tr><td>" + esc(x.name) + '</td><td class="n">' + m(x.inc) + '</td><td class="n">' + m(x.exp) + '</td><td class="n">' + m(x.profit) + '</td><td class="n">' + (x.margin == null ? "" : x.margin + "%") + "</td></tr>").join("") + "</tbody></table>";
  }
  return h + '<p class="note" style="margin-top:16px">Prepared from the books in Tally by ' + esc(co.firm || (S.firm && S.firm.firmName) || "the firm") + ".</p>";
}
async function misExcel(r){
  await ensureXlsx();
  const wb = XLSX.utils.book_new(), add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n.slice(0, 31)), months = r.pl.months;
  const pl = [["Head", "Ledger"].concat(months.map(GSTR.label)).concat(["Period"])];
  MIS.HEADS.forEach(([k, l]) => { const H = r.pl.heads[k]; if (!H) return; pl.push([l, ""].concat(months.map(mm => H.m[mm] || 0)).concat([H.t])); H.led.forEach(x => pl.push(["", x.l].concat(months.map(mm => x.m[mm] || 0)).concat([x.t]))); });
  [["Gross profit", r.pl.gross], ["Profit before tax", r.pl.pbt], ["Profit after tax", r.pl.pat]].forEach(([l, x]) => pl.push([l, ""].concat(months.map(mm => x.m[mm] || 0)).concat([x.t])));
  add("Profit and loss", pl);
  const age = A => [["Party"].concat(MIS.BUCKETS.map(z => z[1] + " days")).concat(["Before these books", "Advances", "On account", "Total", "Tally balance"])].concat(A.rows.map(p => [p.party].concat(p.b).concat([p.pre, p.adv, p.unalloc, p.total, p.tally == null ? "" : p.tally])));
  add("Receivables", age(r.recv)); add("Payables", age(r.pay));
  add("Bills owed to you", [["Customer", "Bill", "Date", "Days", "Outstanding"]].concat(r.recv.rows.flatMap(p => p.bills.map(z => [p.party, z.ref || "on account", Audit.iso(z.date), z.age, z.amt]))));
  add("Bills you owe", [["Supplier", "Bill", "Date", "Days", "Outstanding", "MSME"]].concat(r.pay.rows.flatMap(p => p.bills.map(z => [p.party, z.ref || "on account", Audit.iso(z.date), z.age, z.amt, p.msme || ""]))));
  add("Sales by customer", [["Customer"].concat(r.sales.months.map(GSTR.label)).concat(["Total"])].concat(r.sales.rows.map(x => [x.party].concat(r.sales.months.map(mm => x.m[mm] || 0)).concat([x.t]))));
  add("Purchases by supplier", [["Supplier"].concat(r.purchases.months.map(GSTR.label)).concat(["Total"])].concat(r.purchases.rows.map(x => [x.party].concat(r.purchases.months.map(mm => x.m[mm] || 0)).concat([x.t]))));
  add("Expense heads", [["Ledger"].concat(r.purchases.months.map(GSTR.label)).concat(["Total", "Jumped in"])].concat(r.purchases.heads.map(x => [x.l].concat(r.purchases.months.map(mm => x.m[mm] || 0)).concat([x.t, x.jumps.map(GSTR.label).join(", ")]))));
  add("Compliance", [["Month", "GST output", "GST credit", "GST payable in cash", "TDS deducted", "TDS deposited"]].concat(r.comp.gst.map((x, i) => [GSTR.label(x.ym), x.out, x.itc, x.pay, r.comp.tds[i].ded, r.comp.tds[i].dep])));
  if (r.p2){
    add("Cash flow", [["Section", "What"].concat(r.p2.cash.months.map(GSTR.label)).concat(["Period"])].concat(r.p2.cash.rows.map(x => [x.sec, x.lab].concat(r.p2.cash.months.map(mm => x.m[mm] || 0)).concat([x.t]))));
    add("13 weeks", [["Week of", "Date", "What", "Who", "Amount", "Why this date"]].concat(r.p2.fc.weeks.flatMap(w => w.items.map(z => [Audit.iso(w.from), Audit.iso(z.d), z.what, z.who, z.amt, z.why]))));
    add("Ratios", [["Ratio", "Value", "Unit"]].concat(r.p2.ratios.list.map(([l, v, u]) => [l, v == null ? "" : v, u])));
    add("Cost centres", [["Category", "Cost centre", "From", "To", "Income", "Costs", "Profit", "Margin %"]].concat(r.p2.cc.rows.map(x => [x.cat, x.name, Audit.iso(x.first), Audit.iso(x.last), x.inc, x.exp, x.profit, x.margin == null ? "" : x.margin])));
    const V = MIS.budgetVs(r); if (V.has) add("Budget", [["Head", "Budget", "Actual", "Difference", "%"]].concat(V.rows.map(x => [x.l, x.budget, x.actual, x.diff, x.pct == null ? "" : x.pct])));
  }
  const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
  saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-MIS-" + r.from + "-" + r.to + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}

function gst9PackHtml(which){
  const b = S.books, reg = S.gstReg || ((GSTR.gstins(b) || [])[0] || "").slice(0, 2), fy = GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]), co = CO();
  const head = (t) => '<div style="border-bottom:2px solid #15201B;padding-bottom:8px;margin-bottom:10px"><div style="font-size:12px;color:#5A6B63">' + t + ' \u2014 WORKING FROM THE BOOKS</div><h1 style="font-size:20px;margin:4px 0">' + esc(co.name) + "</h1><div>" + esc((GSTR.gstins(b) || []).find(g => g.slice(0, 2) === reg) || reg) + " \u00b7 " + GST9.label(fy) + "</div></div>";
  if (which === "9") return head("GSTR-9") + GST9.html(GST9.build(fy, reg)).replace(/<div class="bk-tablewrap">|<\/div>/g, "");
  // the 9C screen itself (app/src/screens/gst/Annual.jsx), with the boxes turned into their values
  return head("GSTR-9C") + FinComReact.markup("Gst9c").replace(/<input[^>]*value="([^"]*)"[^>]*>/g, "$1").replace(/<textarea[^>]*>([^<]*)<\/textarea>/g, "<p>$1</p>").replace(/<button[^>]*>[^<]*<\/button>/g, "").replace(/class="bk-tablewrap"/g, "");
}
async function gst9Excel(which){
  await ensureXlsx();
  const b = S.books, reg = S.gstReg || ((GSTR.gstins(b) || [])[0] || "").slice(0, 2), fy = GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]), wb = XLSX.utils.book_new();
  if (which === "9"){
    const d = GST9.build(fy, reg), rows = [["Table", "Details", "Taxable value", "IGST", "CGST", "SGST", "Cess"]];
    GST9.ROWS.forEach(r => { if (r.length === 3 && /^(II|III|IV|V|VI)$/.test(r[0])){ rows.push(["Part " + r[0], r[1] + ". " + r[2]]); return; } const x = d.T[r[0]] || GST9.Z(); rows.push([r[0].replace(/-.*/, ""), r[1], x.taxable, x.igst, x.cgst, x.sgst, x.cess]); });
    rows.push([]); rows.push(["Part IV", "9. Tax paid", "Tax payable", "Paid in cash", "Through IGST credit", "Through CGST credit", "Through SGST credit", "Through cess credit"]);
    [["igst", "Integrated tax"], ["cgst", "Central tax"], ["sgst", "State/UT tax"], ["cess", "Cess"]].forEach(([k, l]) => { const p = d.pay[k], by = p.by || {}; rows.push(["9", l, p.due, p.cash, by.igst || 0, by.cgst || 0, by.sgst || 0, by.cess || 0]); });
    const T14 = d.T["14"] || {}; rows.push([]); rows.push(["14", "Differential tax paid on 10 and 11", "payable " + num(T14.payable), "paid " + num(T14.paid)]);
    rows.push([]); rows.push(["Part VI", "15, 16 and 19", "Value / amount", "IGST", "CGST", "SGST", "Cess"]);
    GST9.TYPED.filter(([k]) => /^1[569]/.test(k)).forEach(([k, l]) => { const x = d.part6[k] || {}; rows.push([k, l.replace(/^\d+[A-Z]? /, ""), num(x.taxable), num(x.igst), num(x.cgst), num(x.sgst), num(x.cess)]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "GSTR-9");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["HSN", "Rate", "Taxable", "IGST", "CGST", "SGST", "Cess"]].concat(d.hsnOut.map(x => [x.hsn, x.rate, x.taxable, x.igst, x.cgst, x.sgst, x.cess]))), "17 HSN outward");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["HSN", "Taxable", "IGST", "CGST", "SGST", "Cess"]].concat(d.hsnIn.map(x => [x.hsn, x.taxable, x.igst, x.cgst, x.sgst, x.cess]))), "18 HSN inward");
  } else {
    const c = GST9C.build(fy, reg), rows = [["Table", "Details", "Amount"], ["5A", "Turnover as per audited financial statements", c.a5]].concat(GST9C.ADJ.map(([k, l, sg]) => [k, l + (sg > 0 ? " (+)" : " (-)"), c.adjOf(k)]))
      .concat([["5O", "Annual turnover after adjustments", c.o5], ["5P", "Turnover as per GSTR-9", c.p5], ["5Q", "Unreconciled", c.q5], ["6", "Reasons", c.st.reasons["6"] || ""],
        ["7A", "Annual turnover after adjustments", c.o5], ["7B", "Exempted, nil, non-GST", c.exempt], ["7C", "Zero rated without payment", c.zero], ["7D", "Reverse charge supplies", c.rcm], ["7E", "Taxable turnover as per adjustments", c.e7], ["7F", "Taxable turnover as per GSTR-9", c.f7], ["7G", "Unreconciled", c.g7], ["8", "Reasons", c.st.reasons["8"] || ""],
        ["12A", "ITC as per audited financial statements", c.itcBooks], ["12B", "ITC of earlier years claimed this year", num(c.st.adj["12B"])], ["12C", "ITC of this year to be claimed later", num(c.st.adj["12C"])], ["12D", "After adjustments", c.d12], ["12E", "ITC claimed in GSTR-9", c.e12], ["12F", "Unreconciled", c.f12], ["13", "Reasons", c.st.reasons["13"] || ""]]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "GSTR-9C");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Rate", "Taxable", "Tax payable"]].concat(c.rates.map(x => [x.rate, x.taxable, x.tax]))), "9 Tax by rate");
  }
  saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-GSTR-" + which + "-" + fy + "-" + reg + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}
// the GST tab: React (app/src/screens/Gst.jsx); GSTR-1 and 3B are app/src/screens/gst/Returns.jsx, the input register gst/InputRegister.jsx, 2B gst/TwoB.jsx, amendments, advances and reversal gst/Workings.jsx, GSTR-9 and 9C gst/Annual.jsx, ITC follow-up gst/ItcFollow.jsx, returns filed gst/ReturnsFiled.jsx, QRMP, CMP-08 and GSTR-4 gst/Periodic.jsx; the other parts are still the old pages below
function viewBooksGst(b){ return '<div data-react="Gst"></div>'; }
// the parts of the GST tab for the GSTIN and month chosen, following its filing type
// the From Tally tab: React (app/src/screens/books/FromTally.jsx). What it asks:
// the bridge's own view of this client's company (it asks Tally nothing), asked at most once a minute
function setupKeepFor(co){
  const ks = (S.setupKeep || {})[co.id];
  if (Bridge.on() && (!ks || Date.now() - ks.at > 60000) && !S.setupKeepBusy){
    S.setupKeepBusy = true;
    Bridge.call("/keep?company=" + encodeURIComponent(BridgeSeed.company()) + Bridge.pinQ(), null, 20000).then(j => ({at: Date.now(), st: j}), e => ({at: Date.now(), error: (e && e.message) || String(e)}))
      .then(x => { S.setupKeep = S.setupKeep || {}; S.setupKeep[co.id] = x; S.setupKeepBusy = false; render(); });
  }
  return ks;
}
// the time of the bridge's daily update from Tally (build 188: Tally is read once a day, or on Update now)
function keepAtSet(v){ if (/^\d{2}:\d{2}$/.test(v)) LK.keepSet({dailyAt: v}, "Tally will be updated every day at " + v + "."); }
// the Tally ledgers and Audit tabs: React (app/src/screens/books/Ledgers.jsx, Audit.jsx)
function gstParts(b){
  const regs = GSTR.gstins(b) || [], noBooks = !(b.vouchers || []).length;
  const ftype = typeof GSTSet === "object" && S.gstYm ? GSTSet.typeOf(S.gstYm, S.gstReg || "") : "monthly";
  const parts = ftype === "comp" ? [["cmp08", "CMP-08"], ["gstr4", "GSTR-4"], ["inreg", "Purchases"], ["r2b", "2B reconciliation"]]
    : (ftype === "qrmp" ? [["qtr", "This quarter"], ["r1", "GSTR-1 working"], ["r3b", "GSTR-3B working"]] : [["r1", "GSTR-1"], ["r3b", "GSTR-3B"]])
      .concat([["inreg", "Input register"], ["r2b", "2B reconciliation"], ["follow", "ITC follow-up"], ["adv", "Advances"], ["rev", "Reversal"], ["amend", "Amendments"], ["g9", "GSTR-9"], ["g9c", "GSTR-9C"]]);
  parts.push(["vault", "Returns filed"]);
  if (AIH.enabled("notices")) parts.push(["notices", "Notices"]);
  // without the day book only what does not come from it: 2B (from the portal or its JSON) and the returns filed
  if (noBooks) parts.splice(0, parts.length, ["r2b", "2B"], ["vault", "Returns filed"]);
  if (noBooks && AIH.enabled("notices")) parts.push(["notices", "Notices"]);
  return {parts, ftype, regs, noBooks};
}
// one part of the GST tab, as the old pages draw it
function gstPartGo(id){ S.gstPart = id; render(); }
function gstSetYm(ym){ S.gstYm = ym; S.books.reco = null; render(); }
function gstSetReg(reg){ S.gstReg = reg; S.books.reco = null; render(); }


function inregRows(b){
  const reg = S.gstReg || "", ym = S.gstYm || "", mode = S.inregScope || "month";
  const months = mode === "year" ? GSTRev.fyMonths(ym).filter(m => GSTR.months().includes(m)) : [ym];
  const rows = [];
  months.forEach(m => GSTR.inward(m, reg).forEach(r => { const tax = r2(r.igst + r.cgst + r.sgst + r.cess); if (tax || r.taxable) rows.push(Object.assign({ym: m, tax}, r)); }));
  // what 2B says about each, where the month's 2B has been brought in
  const loaded = new Set(GST2B.all2b(reg).map(t => t.ym)), st = {}, only2b = [], R0 = {dupes: {}};
  if (loaded.size){
    const res = GST2B.run(reg);
    res.pairs.forEach(x => x.books.forEach(d => { st[d.id] = {s: x.status, p: x.p, issues: x.issues}; }));
    res.only2b.filter(p => months.includes(p.ym)).forEach(p => only2b.push(p));
    R0.dupes = res.dupes || {};
    (res.rejected || []).forEach(x => x.books.forEach(d => { st[d.id] = {s: "rejected", issues: ["rejected in IMS" + (x.p.remarks ? ": " + x.p.remarks : "")]}; }));
    (res.reversed || []).forEach(([a, c]) => { st[a.id] = {s: "reversed", issues: ["reversed by voucher " + c.voucher + " of " + GSTAmend.dmy(c.bookDate)]}; st[c.id] = {s: "reversed", issues: ["reverses voucher " + a.voucher + " of " + GSTAmend.dmy(a.bookDate)]}; });
  }
  rows.forEach(r => {
    r.kindL = r.import ? (r.supply === "Goods" ? "Import of goods" : "Import of services") : r.rcm ? "Reverse charge" : r.blocked || r.ineligible ? "Not to be taken" : r.dir < 0 ? "Credit reduced" : "Eligible";
    const x = st[r.id];
    r.twoB = x ? ({matched: "In 2B", diff: "In 2B, differs", probable: "In 2B? confirm", reversed: "Booked and reversed", rejected: "Rejected in IMS"})[x.s] || x.s : (r.rcm && !r.gstin) || r.import ? "not expected in 2B" : loaded.has(r.ym) ? "Not in 2B" : "2B not brought in";
    r.twoBWhy = x && x.issues ? x.issues.join("; ") : "";
    const dp = R0.dupes[r.id];
    if (dp){ r.dupe = dp; r.twoBWhy = ("booked " + dp.n + " times: also voucher " + dp.others.join(", ") + (r.twoBWhy ? "; " + r.twoBWhy : "")); }
  });
  // duplicates found without 2B too: the same supplier, number and tax
  if (!loaded.size){
    const k = {}; rows.forEach(r => { if (!r.no || !r.tax) return; const q = (r.gstin || r.party) + "|" + GST2B.normNo(r.no) + "|" + r.dir + "|" + Math.round(r.tax); (k[q] = k[q] || []).push(r); });
    Object.values(k).filter(l => l.length > 1).forEach(l => l.forEach(r => { r.dupe = {n: l.length}; r.twoBWhy = "booked " + l.length + " times: also voucher " + l.filter(z => z !== r).map(z => z.voucher + " of " + GSTAmend.dmy(z.date)).join(", "); }));
  }
  return {rows, only2b, months, loaded, reg};
}
async function inregExcel(){
  await ensureXlsx();
  const b = S.books, R = inregRows(b), sg = r => r.dir < 0 ? -1 : 1, wb = XLSX.utils.book_new();
  const rows = [["Booked", "Voucher type", "Voucher no.", "Supplier", "GSTIN", "Bill no.", "Bill date", "HSN", "Rate", "Value", "IGST", "CGST", "SGST", "Cess", "Total tax", "Kind", "2B", "2B note", "Narration"]];
  R.rows.forEach(r => rows.push([tallyDate(r.date), r.type, r.voucher || "", r.party || "", r.gstin || "", r.no || "", r.refDate ? tallyDate(r.refDate) : "", r.hsn || "", Array.from(new Set((r.parts || []).map(x => x.rate))).join(", "),
    sg(r) * r.taxable, sg(r) * r.igst, sg(r) * r.cgst, sg(r) * r.sgst, sg(r) * r.cess, sg(r) * r.tax, r.kindL, r.twoB, r.twoBWhy, r.narr || ""]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Input register");
  // item by item, rate by rate
  const it = [["Booked", "Voucher no.", "Supplier", "GSTIN", "Bill no.", "HSN", "Rate", "Value", "IGST", "CGST", "SGST", "Cess"]];
  R.rows.forEach(r => (r.parts || []).forEach(x => it.push([tallyDate(r.date), r.voucher || "", r.party || "", r.gstin || "", r.no || "", x.hsn || "", x.rate, sg(r) * x.taxable, sg(r) * x.igst, sg(r) * x.cgst, sg(r) * x.sgst, sg(r) * x.cess])));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(it), "By rate and HSN");
  if (R.only2b.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["2B month", "Supplier", "GSTIN", "Bill no.", "Date", "Value", "IGST", "CGST", "SGST", "Cess", "Available in 2B", "In Tally"]].concat(R.only2b.map(p => [p.ym, p.party, p.gstin, p.no, p.date, p.dir * p.taxable, p.dir * p.igst, p.dir * p.cgst, p.dir * p.sgst, p.dir * p.cess, p.itcavl === "N" ? "No" + (p.rsn ? " (" + p.rsn + ")" : "") : "Yes",
    p.bookedNoCredit ? "booked without credit: " + p.bookedNoCredit.type + " " + (p.bookedNoCredit.no || "") + " " + p.bookedNoCredit.date + " " + (p.bookedNoCredit.party || "") : "not found"]))), "In 2B not in books");
  const gstin = (GSTR.gstins(b) || []).find(g => g.slice(0, 2) === R.reg) || R.reg;
  saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-Input-register-" + gstin + "-" + (R.months.length > 1 ? R.months[0] + "-" + R.months[R.months.length - 1] : R.months[0]) + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}
function r2Scope(){
  const ym = S.gstYm || "", mode = S.r2Scope || "month";
  if (mode === "all" || !ym) return {mode: "all", months: null, label: "everything brought in"};
  if (mode === "year"){ const ms = GSTRev.fyMonths(ym); return {mode, months: ms, label: "the year " + ms[0].slice(0, 4) + "-" + ms[11].slice(2, 4)}; }
  return {mode: "month", months: [ym], label: GSTR.label(ym)};
}
function r2Reg(b){
  const regs = (GSTR.gstins(b) || []).map(g => g.slice(0, 2));
  if (S.gstReg) return S.gstReg;
  const own = Array.from(new Set(GST2B.all2b("").map(t => t.gstin.slice(0, 2))));
  return own.length === 1 ? own[0] : regs.length === 1 ? regs[0] : "";
}
/* ---------- The client's dashboard ---------- */
// the client's dashboard: React (app/src/screens/Dash.jsx)
function viewClientDash(){ return '<div data-react="Dash"></div>'; }
/* ---------- Today: what needs doing, across every client ---------- */
/* ---------- Inbox: every waiting document, and uploads that matched no client ---------- */
// Today, Inbox and Clients are drawn by React (app/src/screens/Today.jsx, InboxAll.jsx, Clients.jsx)
function viewToday(){ return '<div data-react="Today"></div>'; }
function viewInboxAll(){ return '<div data-react="InboxAll"></div>'; }
function viewClients(){ return '<div data-react="Clients"></div>'; }
/* ---------- Tally: the connection, and everything sent ---------- */
// Settings, TDS rates and limits and reading bills (app/src/screens/SettingsMore.jsx)
function rateSet(id, k, v){ const r = S.firm.rules[id] = S.firm.rules[id] || {}; r[k] = num(v); Store.saveFirm(); render(); }
function readingToggle(which, on){
  if (which === "askClaudeNew"){ S.askClaudeNewSupplier = on; lsSet("tdsdesk:askClaudeNew", on ? "1" : ""); }
  else { S.freeFirst = on; lsSet("tdsdesk:freeFirst", on ? "1" : "0"); }
  render();
}
function viewTallyHome(){ return '<div data-react="TallyHome"></div>'; }

// the top bar is drawn by React (app/src/TopBar.jsx); a change that touches only it redraws React alone
function renderTop(){ if (window.FinComReact) FinComReact.redraw(); }

/* ---------- Home: client list ---------- */
/* ---------- Home: unsorted uploads ---------- */
// the unsorted uploads are React (app/src/parts/Unsorted.jsx)
function viewInbox(){ return '<div data-react="Unsorted"></div>'; }

/* ---------- Home: firm-wide rates ---------- */
function keyBox(opts){
  // one key panel: Google OCR or Claude
  const inClaude = !!window.claude;
  let h = '<div class="keybox"><h3>' + opts.title + "</h3>" + '<p class="note" style="margin:0 0 8px">' + opts.help + "</p>";
  if (inClaude){
    h += '<label class="f"><span>' + opts.label + '</span><input type="text" disabled placeholder="Not available inside claude.ai"></label>' +
      '<p class="note" style="margin:6px 0 0">claude.ai blocks this. Use <b>Download the standalone app</b> below, open that file in Chrome or Edge, and enter the key there.</p>';
  } else {
    h += '<label class="f"><span>' + opts.label + '</span><input data-draft type="' + (S.apiKeyShown ? "text" : "password") + '" id="' + opts.inputId + '" autocomplete="off" placeholder="' + opts.placeholder + '" value="' + esc(opts.value || "") + '"></label>' +
      (opts.extra || "") +
      '<div class="row" style="margin-top:8px"><button class="btn primary small" data-act="' + opts.saveAct + '">Save and test</button>' +
      '<button class="btn small" data-act="toggleKey">' + (S.apiKeyShown ? "Hide keys" : "Show keys") + "</button>" +
      (opts.value ? '<button class="btn small danger" data-act="' + opts.removeAct + '">Remove key</button>' : "") + "</div>";
  }
  return h + "</div>";
}
function viaPlatform(){ return Cloud.on() && !!S.account && !S.account.superadmin && !apiSettings().key; }
// everything sent to Tally: React (app/src/screens/Done.jsx)
function viewPostLog(){ return '<div data-react="PostLog"></div>'; }
function postLogCsv(){
  const log = (S.firm.postLog || []).slice().reverse();
  const rows = [["When", "What", "Action", "Client", "Reference", "Party", "Amount", "Voucher type", "Tally id", "Company", "By"]].concat(
    log.map(r => [r.at, r.what || "", r.action || "", (CO(r.co) || {}).name || "", r.ref || "", r.party || "", r.amount || "", (r.tally || {}).vchType || "", (r.tally || {}).masterId || "", (r.tally || {}).company || "", r.by || ""]));
  saveFile("posted-to-tally-" + new Date().toISOString().slice(0, 10) + ".csv", new Blob([rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n")], {type: "text/csv"}));
}
// the TDS rates and limits for all clients (the firm's name is in Settings → Firm details)
// Settings for the firm: React (app/src/screens/Settings.jsx)
function viewRules(){ return '<div data-react="FirmSettings"></div>'; }

/* ---------- Client: invoices ---------- */
/* ---------- all drafts in one table (for uploads of many bills) ---------- */
function draftRows(){
  const cid = S.coId;
  return Object.values(D().entries).filter(e => e.status === "draft").sort(byDate).map(e => {
    const c = compute(e, cid);
    return {e, c};
  });
}
function drawerEntry(){
  if (!S.drawerOpen || S.view !== "company" || S.tab !== "invoices" || !S.reviewTable || S.filter !== "draft") return null;
  const e = S.selected && D().entries[S.selected];
  if (!e || (e.status !== "draft" && e.status !== "duplicate")){ S.drawerOpen = false; return null; }
  return e;
}
// the drawer with a bill, over the review table: React (app/src/screens/Review.jsx)
function drawerHtml(){ return drawerEntry() ? '<div data-react="Drawer"></div>' : ""; }
function revColOn(){ const f = S.revF || {}; return Object.keys(f).some(k => Array.isArray(f[k]) ? f[k].length : f[k]); }
function revColPass(r){
  const f = S.revF || {}, x = r.e.x, c = r.c;
  if (f.from && (x.invoiceDate || "") < f.from) return false;
  if (f.to && (x.invoiceDate || "") > f.to) return false;
  if (f.sup && !String((x.vendorName || "") + " " + (x.vendorGstin || "") + " " + (r.e.expenseLedger || "")).toLowerCase().includes(f.sup.toLowerCase())) return false;
  if (f.no && !String(x.invoiceNo || "").toLowerCase().includes(f.no.toLowerCase())) return false;
  if (f.min && num(x.total) < num(f.min)) return false;
  if (f.max && num(x.total) > num(f.max)) return false;
  if (f.nature && r.e.natureId !== f.nature) return false;
  if (f.natures && f.natures.length && !f.natures.includes(r.e.natureId)) return false;
  if (f.sups && f.sups.length && !f.sups.includes(x.vendorName)) return false;
  if (f.tds === "yes" && !(c.tds > 0)) return false;
  if (f.tds === "no" && c.tds > 0) return false;
  if (f.look === "yes" && !((c.missing || []).length || c.flags.some(g => g.lvl === "hi") || r.e.confirmType)) return false;
  if (f.look === "no" && ((c.missing || []).length || c.flags.some(g => g.lvl === "hi") || r.e.confirmType)) return false;
  return true;
}
function revFiltered(){
  const all = draftRows().filter(revColPass), q = String(S.revQuery || "").trim().toLowerCase();
  if (!q) return all;
  return all.filter(r => [r.e.x.vendorName, r.e.x.invoiceNo, r.e.x.vendorGstin, r.e.x.vendorPan, r.e.expenseLedger, r.e.partyLedger, r.c.rule && r.c.rule.label,
    String(r.e.x.total), INR.format(num(r.e.x.total)), r.e.noteKind ? r.e.noteKind + " note" : "", r.e.postError || ""].join(" ").toLowerCase().includes(q));
}
// the review table and its bar at the bottom: React (app/src/screens/Review.jsx)
function viewReviewTable(){ return '<div data-react="ReviewTable"></div>'; }
function revSet(e, on){
  const c = compute(e);
  if (on){ e.tdsSkip = null; if (c.skip && c.skip.from !== "bill") e.tdsForce = true; if (c.tdsWould <= 0){ e.tdsAlways = true; e.tdsForce = true; } }
  else { e.tdsForce = false; e.tdsAlways = false; if (c.tdsWould > 0) e.tdsSkip = e.tdsSkip || "pay"; }
  Store.saveEntry(S.coId, e);
}
async function reviewCheckTally(list){
  const fy = f => fyOf(f.e.x.invoiceDate);
  let done = 0, failed = 0;
  S.revBusy = true; render();
  for (const r of list){
    const led = partyLedgerName(r.c.party, r.e);
    if (!led) continue;
    if (tallyYtdFor(r.c.party, fy(r), r.e)) continue;
    try { await fetchPartyYtd(r.c.party, fy(r), led); done++; } catch (e){ failed++; }
  }
  S.revBusy = false;
  toast(done ? "Checked " + done + " supplier" + (done === 1 ? "" : "s") + " in Tally." + (failed ? " " + failed + " could not be read." : "") : "Nothing to check: the suppliers need a Tally ledger and a saved PAN.");
  render();
}
