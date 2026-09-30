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
const BOOKS_KEYS = ["vouchers", "map", "meta", "challans", "alloc", "pans", "twoB", "gstins", "under", "states", "groups", "salary", "certs", "advFix", "assets", "rev", "filed", "amendFix", "twoBs", "reco2b", "ledInfo", "ledInfoAt", "audit", "auditCfg", "auditRel", "ledSnaps", "gst9c", "groupInfo", "fs", "tb", "mis", "misCfg", "msme", "budget", "gst3b", "gst9", "gstOpen", "itcBasis", "itcTrack", "outRej", "gstFiled", "gstAato", "filed1a", "rule37On", "gstCashLedger", "gstSet", "gstContacts", "gstApi", "gstEst", "gstVault", "gstRegs", "letters", "ai"];
async function saveBooks(opts){
  const b = S.books; if (!b || !b.cid) return;
  const keep = {cid: b.cid}; BOOKS_KEYS.forEach(k => { keep[k] = b[k]; });
  await Books.save(b.cid, keep);
  if (!(opts && opts.fromCloud) && typeof BookSync === "object") BookSync.schedule(b.cid);
}
// filed GST returns whose documents changed in Tally since: on every Books tab until the amendments are reported
function gstDriftNote(b){
  if (b.gstDrift === undefined){ try { b.gstDrift = GSTAmend.drift(); } catch (e){ b.gstDrift = []; } }
  const d = b.gstDrift || [];
  if (!d.length) return "";
  return '<div class="bk-warn" role="status">' + d.slice(0, 3).map(x => "<p>" + esc(GSTAmend.driftLine(x)) + "</p>").join("") +
    (d.length > 3 ? "<p>" + (d.length - 3) + " more filed return" + (d.length > 4 ? "s" : "") + " changed.</p>" : "") +
    '<button class="btn small" data-bookstab="gst" data-gstpart="amend">See the amendments</button></div>';
}
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
function ledgerBanner(b, which){
  const p = LedMaster.pending(b).filter(([, m]) => !which || (which === "gst" ? LedMaster.isGst(m.what) || !m.what || m.what === "none" : LedMaster.isTds(m.what) || !m.what || m.what === "none"));
  if (!p.length) return "";
  return '<div class="bk-alert bad" style="margin-bottom:12px"><b>' + p.length + " ledger" + (p.length === 1 ? " is" : "s are") + " still to be confirmed.</b> The figures below use the guesses; the return files wait until they are confirmed. " +
    '<button class="linkbtn" data-bookstab="ledgers">Confirm them</button><div class="nr" style="white-space:normal">' + esc(p.slice(0, 6).map(x => x[0]).join(", ") + (p.length > 6 ? " and " + (p.length - 6) + " more" : "")) + "</div></div>";
}
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

function viewBooksAudit(b){
  const catchUp = TallyRead.catchUp(b, "audit");
  if (catchUp) return catchUp;
  if (S.auditTab === "rel") return auditTabs() + viewAuditRel(b);
  if (S.auditTab === "3cd") return auditTabs() + viewAudit3cd(b);
  const m = v => INR.format(r2(v || 0)), c = Audit.cfg(b), au = b.audit || {}, run = au.last, dr = Audit.defaultRange(b);
  const range = S.auditRange || {from: Audit.iso(dr.from), to: Audit.iso(dr.to)};
  const lyFrom = MIS.shift(Audit.ymd(range.from), -1), lyTo = MIS.shift(Audit.ymd(range.to), -1), lyHere = MIS.covered(lyFrom);
  let h = auditTabs() + '<section class="dash-card"><h3>Audit of the books</h3>' +
    '<p class="note">Every check runs on the vouchers read from Tally. Each finding says what is wrong, what it costs, what to do, and the journal entry where one is needed. Mark each one, then download the report.</p>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
    '<label class="note">From <input type="date" data-auditfrom value="' + esc(range.from) + '"></label><label class="note">to <input type="date" data-auditto value="' + esc(range.to) + '"></label>' +
    '<button class="btn small primary" data-act="auditRun">Run now</button>' + AIH.auditButton() +
    (!lyHere && typeof bridgeLive === "function" && bridgeLive(CO()) ? '<button class="btn small" data-act="auditReadLy" title="' + esc(fmtDate(tallyDate(lyFrom)) + " to " + fmtDate(tallyDate(lyTo))) + '">Read last year from Tally, to compare</button>' : "") +
    '<span class="note" style="margin-left:12px">Run on its own</span><select data-auditfreq style="width:auto">' +
    [["daily", "every day"], ["weekly", "every week"], ["monthly", "every month"], ["off", "only when I run it"]].map(([v, l]) => '<option value="' + v + '"' + (c.freq === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>" +
    '<p class="note" style="margin-top:6px">On its own, it runs the first time this client is opened on a new ' + ({daily: "day", weekly: "week", monthly: "month"}[c.freq] || "day") + ", and each time the day book is read. To run overnight with nobody here, the bridge on the Tally server will have to send the day book on a timer.</p>" +
    (run ? '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn small primary" data-act="auditReport">Download the report (PDF)</button><button class="btn small" data-act="auditExcel">Excel with the annexures</button>' +
      '<button class="btn small" data-act="auditJe">Tally file of entries to pass (' + Audit.jesToPass(run).length + ")</button>" +
      '<button class="btn small" data-act="auditFinal">Finalise this report</button></div>' : "") +
    (run && Audit.finalFor(run.from, run.to) ? '<div class="bk-alert" style="margin-top:10px"><b>The report for ' + fmtDate(tallyDate(run.from)) + " to " + fmtDate(tallyDate(run.to)) + " is final</b>, locked on " + fmtDate(Audit.finalFor(run.from, run.to).at.slice(0, 10)) +
      " (result code " + esc(Audit.finalFor(run.from, run.to).run.code || "") + '). Later runs track what gets put right, but the final report stays as it was. <button class="linkbtn" data-act="auditFinalPdf">Download the final report</button> \u00b7 <button class="linkbtn" data-act="auditUnlock">Unlock</button></div>' : "") + "</section>";
  if (!run) return h + '<div class="bk-none" style="margin-top:12px">Not run yet. Choose the period and press Run now.</div>';
  const f0 = run.findings, sev = s => f0.filter(f => f.sev === s);
  h += '<p class="note" style="margin:10px 0">Last run ' + esc(run.how) + " on " + fmtDate(run.at.slice(0, 10)) + " at " + run.at.slice(11, 16) + " for " + fmtDate(tallyDate(run.from)) + " to " + fmtDate(tallyDate(run.to)) + ", " + run.vouchers + " vouchers." +
    " Result code <b>" + esc(run.code || "") + "</b>: the same books always give the same code." + (run.balances ? " Balances from " + esc(run.balances) + "." : "") +
    (run.notes.length ? " " + esc(run.notes.join(" ")) : "") + (run.errors.length ? ' <span class="bad">Some checks could not run: ' + esc(run.errors.join("; ")) + "</span>" : "") + "</p>";
  const open = f0.filter(f => Audit.status(f.id).s === "open").length;
  h += '<div class="dash-tiles">' +
    '<div class="dtile' + (sev("high").length ? " warn" : "") + '"><span>Serious</span><b>' + sev("high").length + "</b><small>" + m(sev("high").reduce((s, f) => s + f.amount, 0)) + " involved</small></div>" +
    '<div class="dtile"><span>To look at</span><b>' + sev("medium").length + "</b><small>" + m(sev("medium").reduce((s, f) => s + f.amount, 0)) + "</small></div>" +
    '<div class="dtile"><span>Minor</span><b>' + sev("low").length + "</b><small>for good books</small></div>" +
    '<div class="dtile"><span>Still open</span><b>' + open + "</b><small>of " + f0.length + " findings" + (f0.filter(f => f.isNew).length ? ", " + f0.filter(f => f.isNew).length + " new since the last run" : "") + "</small></div>" +
    '<div class="dtile"><span>Put right</span><b>' + (run.solved || []).reduce((s2, x) => s2 + x.n, 0) + "</b><small>items found earlier and gone when checked again</small></div></div>";
  const area = S.auditArea || "", fs = S.auditSt || "";
  h += '<nav class="sbar" aria-label="Areas"><button data-auditarea="" aria-selected="' + (!area) + '">All <span class="sbar-n">' + f0.length + "</span></button>" +
    Audit.AREAS.map(([a, l]) => { const n = f0.filter(f => f.area === a).length; return n ? '<button data-auditarea="' + a + '" aria-selected="' + (area === a) + '">' + l + ' <span class="sbar-n">' + n + "</span></button>" : ""; }).join("") + "</nav>";
  h += '<div class="revfilter"><select data-auditst style="width:auto"><option value="">Every status</option>' + Audit.STATUS.map(([v, l]) => '<option value="' + v + '"' + (fs === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>";
  const list = f0.filter(f => (!area || f.area === area) && (!fs || Audit.status(f.id).s === fs));
  const col = {high: "#B42318", medium: "#B9541B", low: "#5A6B63"};
  h += list.map(f => {
    const st = Audit.status(f.id), isOpen = S.auditOpen === f.id;
    let x = '<section class="dash-card" style="margin-top:10px;border-left:4px solid ' + col[f.sev] + '">' +
      '<div class="row" style="justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><div style="flex:1;min-width:260px">' +
      '<div class="nr" style="color:' + col[f.sev] + ';font-weight:700">' + {high: "SERIOUS", medium: "TO LOOK AT", low: "MINOR"}[f.sev] + " \u00b7 " + esc((Audit.AREAS.find(a => a[0] === f.area) || [])[1]) + (f.clause ? " \u00b7 " + esc(f.clause) : "") +
      (f.isNew ? ' <span class="tag warn">new</span>' : f.more > 0 ? ' <span class="tag warn">+' + f.more + "</span>" : "") + "</div>" +
      '<button class="linkbtn" data-auditopen="' + esc(f.id) + '" style="font-size:16px;font-weight:600;text-align:left">' + (isOpen ? "\u25be " : "\u25b8 ") + esc(f.title) + "</button>" +
      '<div class="note">' + esc(f.problem) + (f.amount ? " \u00b7 \u20b9" + m(f.amount) : "") + (Audit.solvedOf(f.id).n ? ' \u00b7 <span style="color:#1F7A4D">' + Audit.solvedOf(f.id).n + " put right</span>" : "") + "</div></div>" +
      '<div><select data-auditstatus="' + esc(f.id) + '" style="width:auto">' + Audit.STATUS.map(([v, l]) => '<option value="' + v + '"' + (st.s === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
      (f.je ? '<div class="nr">' + f.je.length + " suggested entr" + (f.je.length === 1 ? "y" : "ies") + "</div>" : "") + "</div></div>";
    if (isOpen){
      x += '<div style="margin-top:8px"><p><b>Effect.</b> ' + esc(f.impact) + "</p><p><b>What to do.</b> " + esc(f.suggestion) + "</p>" +
        '<label class="note" style="display:block;margin:6px 0">Note for the report <input type="text" data-auditnote="' + esc(f.id) + '" data-fk="an-' + esc(f.id) + '" value="' + esc(st.note || "") + '" style="width:100%" placeholder="Management response, or why it is not an issue"></label>';
      if (f.je && f.je.length){
        const miss = Audit.missingLedgers(f.je);
        x += "<p><b>Suggested entries</b>" + (miss.length ? ' <span class="note">\u2014 to create in Tally first: ' + esc(miss.join(", ")) + "</span>" : "") + '</p><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Date</th><th>Ledger</th><th class="n">Debit</th><th class="n">Credit</th></tr></thead><tbody>' +
          f.je.slice(0, 30).map(j => j.lines.map((l, k) => "<tr><td>" + (k ? "" : fmtDate(tallyDate(j.date))) + "</td><td>" + (l.cr ? "\u2003To " : "") + esc(l.l) + '</td><td class="n">' + (l.dr ? m(l.dr) : "") + '</td><td class="n">' + (l.cr ? m(l.cr) : "") + "</td></tr>").join("") +
            '<tr><td></td><td colspan="3" class="note">(' + esc(j.narr) + ")</td></tr>").join("") + "</tbody></table></div>" +
          (f.je.length > 30 ? '<p class="note">' + (f.je.length - 30) + " more in the Excel.</p>" : "") + '<p class="note">Mark it \u201cEntry to pass\u201d and these go into the Tally file.</p>';
      }
      if (f.rows && f.rows.length) x += "<p><b>The entries behind it</b></p>" + '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Date</th><th>Voucher</th><th>Party or ledger</th><th class="n">Amount</th><th>Detail</th></tr></thead><tbody>' +
        f.rows.slice(0, 100).map(r => "<tr><td>" + (r.date ? fmtDate(tallyDate(r.date)) : "") + "</td><td>" + esc(r.no || "") + (r.type ? '<div class="nr">' + esc(r.type) + "</div>" : "") + "</td><td>" + esc(r.party || "") + '</td><td class="n">' + (r.amount ? m(r.amount) : "") + "</td><td>" + esc(r.note || "") + "</td></tr>").join("") +
        "</tbody></table></div>" + (f.rows.length > 100 ? '<p class="note">The first 100 of ' + f.rows.length + "; all are in the Excel.</p>" : "");
      const sv = Audit.solvedOf(f.id);
      if (sv.n) x += '<p><b style="color:#1F7A4D">Put right</b> <span class="note">found earlier, gone when checked again</span></p><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Date</th><th>Voucher</th><th>Party or ledger</th><th class="n">Amount</th><th>Put right by</th></tr></thead><tbody>' +
        sv.items.slice(-100).map(it => { const r = it.row || {}; return '<tr style="color:#5A6B63"><td>' + (r.date ? fmtDate(tallyDate(r.date)) : "") + "</td><td><s>" + esc(r.no || "") + "</s></td><td>" + esc(r.party || "") + '</td><td class="n">' + (r.amount ? m(r.amount) : "") + "</td><td>" + fmtDate(String(it.solved).slice(0, 10)) + "</td></tr>"; }).join("") + "</tbody></table></div>";
      x += "</div>";
    }
    return x + "</section>";
  }).join("") + (list.length ? "" : '<div class="bk-none" style="margin-top:10px">Nothing here.</div>');
  // findings where every item has been put right
  const gone = (run.solved || []).filter(x => x.n && !f0.some(f => f.id === x.id) && (!area || x.area === area));
  if (gone.length) h += '<section class="dash-card" style="margin-top:12px;border-left:4px solid #1F7A4D"><h3 style="color:#1F7A4D">Solved</h3><p class="note">Every item of these was put right in the books.</p><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Observation</th><th class="n">Items</th><th class="n">Amount</th><th>Last put right</th></tr></thead><tbody>' +
    gone.map(x => "<tr><td>" + esc(x.title) + '</td><td class="n">' + x.n + '</td><td class="n">' + m(x.amount) + "</td><td>" + fmtDate(String(x.items[x.items.length - 1].solved).slice(0, 10)) + "</td></tr>").join("") + "</tbody></table></div></section>";
  if ((au.history || []).length > 1) h += '<section class="dash-card" style="margin-top:12px"><h3>Earlier runs</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Run on</th><th>How</th><th>Period</th><th class="n">Findings</th><th class="n">Serious</th><th class="n">Amount involved</th></tr></thead><tbody>' +
    au.history.slice(0, 12).map(x => "<tr><td>" + fmtDate(x.at.slice(0, 10)) + " " + x.at.slice(11, 16) + "</td><td>" + esc(x.how) + "</td><td>" + fmtDate(tallyDate(x.from)) + " to " + fmtDate(tallyDate(x.to)) + '</td><td class="n">' + x.n + '</td><td class="n">' + x.high + '</td><td class="n">' + m(x.amount) + "</td></tr>").join("") + "</tbody></table></div></section>";
  return h;
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
function viewBooksMis(b){
  const catchUp = TallyRead.catchUp(b, "mis");
  if (catchUp) return catchUp;
  const m = v => INR.format(r2(v || 0)), r = (b.mis || {}).last, c = MIS.cfg(b);
  const rg = S.misRange || (r ? {from: Audit.iso(r.from), to: Audit.iso(r.to)} : (x => ({from: Audit.iso(x.from), to: Audit.iso(x.to)}))(misRangeQuick("ytd", b)));
  let h = '<section class="dash-card"><h3>MIS</h3>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
    '<label class="note">From <input type="date" data-misfrom value="' + esc(rg.from) + '"></label><label class="note">to <input type="date" data-misto value="' + esc(rg.to) + '"></label>' +
    [["month", "This month"], ["lastmonth", "Last month"], ["quarter", "This quarter"], ["ytd", "Year to date"], ["lastyear", "Last year"]].map(([k, l]) => '<button class="btn small" data-misquick="' + k + '">' + l + "</button>").join("") +
    '<button class="btn small primary" data-act="misRun">Run now</button></div>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px"><span class="note">Run on its own</span><select data-misfreq style="width:auto">' +
    [["monthly", "on the 1st, for the month just ended"], ["weekly", "every week, the year so far"], ["daily", "every day, the year so far"], ["off", "only when I run it"]].map(([v, l]) => '<option value="' + v + '"' + (c.freq === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
    (r ? '<button class="btn small primary" data-act="misPack">Download the MIS pack (PDF)</button><button class="btn small" data-act="misExcel">Excel</button>' : "") + "</div></section>";
  if (!r) return h + '<div class="bk-none" style="margin-top:12px">Choose a period and press Run now.</div>';
  h += '<p class="note" style="margin:10px 0">' + fmtDate(tallyDate(r.from)) + " to " + fmtDate(tallyDate(r.to)) + " \u00b7 " + esc(r.how) + " on " + fmtDate(r.at.slice(0, 10)) + " at " + r.at.slice(11, 16) + " \u00b7 result code <b>" + esc(r.code) + "</b>" +
    (r.control ? (r.control.ok ? ' \u00b7 <span style="color:#1F7A4D">agrees with Tally\u2019s balances, ledger by ledger</span>' : ' \u00b7 <span class="bad">' + r.control.n + " ledgers differ from Tally by \u20b9" + m(r.control.amt) + "</span>") : " \u00b7 read the period from Tally through the bridge to check it against Tally\u2019s balances") + "</p>";
  const tab = S.misTab || "summary";
  h += '<nav class="sbar" aria-label="MIS">' + [["summary", "Summary"], ["pl", "Profit and loss"], ["recv", "Receivables"], ["pay", "Payables"], ["sales", "Sales"], ["purch", "Purchases and expenses"], ["cash", "Cash flow"], ["ratios", "Ratios"], ["regs", "Registrations"], ["cc", "Cost centres"], ["budget", "Budget"], ["comp", "Compliance"]]
    .map(([id, l]) => '<button data-mistab="' + id + '" aria-selected="' + (tab === id) + '">' + l + "</button>").join("") + "</nav>";
  const pct = (a, c2) => c2 ? (Math.round((a - c2) / Math.abs(c2) * 1000) / 10) + "%" : "\u2014";
  const q = String(S.misQ || "").toLowerCase();
  const search = ph => '<div class="revfilter"><input type="search" id="misq" data-fk="misq" data-keeptyped value="' + esc(S.misQ || "") + '" placeholder="' + esc(ph) + '" style="width:260px">' + (tab === "recv" || tab === "pay" ?
    '<select data-misf style="width:auto"><option value="">Every party</option><option value="90"' + (S.misF === "90" ? " selected" : "") + ">Over 90 days due</option>" + (tab === "pay" ? '<option value="msme"' + (S.misF === "msme" ? " selected" : "") + ">MSME suppliers</option>" : "") + "</select>" : "") + "</div>";
  if (tab === "summary"){
    const tile = (l, v, sub) => '<div class="dtile"><span>' + l + "</span><b>" + v + "</b><small>" + (sub || "") + "</small></div>";
    h += '<div class="dash-tiles">' + tile("Sales, the period", m(r.sales.total), (r.prev ? "previous period " + m(r.prev.sales) + " (" + pct(r.sales.total, r.prev.sales) + ")" : "") + (r.ly ? " \u00b7 last year " + m(r.ly.sales) + " (" + pct(r.sales.total, r.ly.sales) + ")" : "")) +
      tile("Profit before tax", m(r.pl.pbt.t), "gross profit " + m(r.pl.gross.t) + (r.pl.heads.rev ? " (" + (Math.round(r.pl.gross.t / r.pl.heads.rev.t * 1000) / 10) + "% of revenue)" : "")) +
      tile("Month to date \u00b7 year to date", r.mtd != null ? m(r.mtd) : "\u2014", r.ytd != null ? "year to date " + m(r.ytd) : "") +
      tile("Received \u00b7 paid", m(r.cash.rec), "paid out " + m(r.cash.pay) + ", net " + m(r.cash.rec - r.cash.pay)) + "</div>";
    const owed = A => A.sum.tally != null ? A.sum.tally : A.sum.open;
    const owedNote = A => A.sum.tally != null ? "as in Tally" : "bills raised in these books still open" + (Math.abs(A.sum.pre) >= 1 ? "; " + m(Math.abs(A.sum.pre)) + " settled against older bills not in these books" : "");
    h += '<div class="dash-tiles">' + tile("Owed to you", m(owed(r.recv)), owedNote(r.recv) + " \u00b7 over 90 days " + m(r.recv.sum.b[3] + r.recv.sum.b[4]) + (r.dso != null ? " \u00b7 " + r.dso + " days of sales" : "")) +
      tile("You owe", m(owed(r.pay)), owedNote(r.pay) + " \u00b7 over 90 days " + m(r.pay.sum.b[3] + r.pay.sum.b[4]) + (r.dpo != null ? " \u00b7 " + r.dpo + " days of purchases" : "")) +
      tile("MSME suppliers past " + MIS.cfg(b).msmeDays + " days", m(r.msme.reduce((s, x) => s + x.amt, 0)), r.msme.length + " suppliers \u00b7 section 43B(h)") +
      tile("GST payable, last month", m((r.comp.gst[r.comp.gst.length - 1] || {}).pay), "after credit, as per 3B") + "</div>";
    if (r.balances.cash || r.balances.bank) h += '<section class="dash-card" style="margin-top:12px"><h3>Cash and bank on ' + fmtDate(tallyDate(r.to)) + '</h3><div class="bk-tablewrap"><table class="bk-table"><tbody>' +
      r.balances.cash.concat(r.balances.bank).filter(x => Math.abs(x[1]) >= 1).map(([l, v]) => "<tr><td>" + esc(l) + '</td><td class="n' + (v < 0 ? " bad" : "") + '">' + m(v) + "</td></tr>").join("") +
      '<tr><td><b>Total</b></td><td class="n"><b>' + m(r.balances.cash.concat(r.balances.bank).reduce((s, x) => s + x[1], 0)) + '</b></td></tr></tbody></table></div><p class="note">From ' + esc(r.balances.src) + ".</p></section>";
    else h += '<p class="note">Cash and bank balances: ' + esc(r.balances.why || "") + ".</p>";
    h += '<section class="dash-card" style="margin-top:12px"><h3>Due in the coming weeks</h3>' + r.dues.map(([d, l]) => '<div class="dash-row"><span>' + esc(l) + "</span><b>" + fmtDate(tallyDate(d)) + "</b></div>").join("") + "</section>";
    return h;
  }
  if (tab === "pl"){
    const months = r.pl.months, cols = months.length <= 12;
    const row = (label, x, bold, key) => "<tr><td>" + (bold ? "<b>" + esc(label) + "</b>" : key ? '<button class="linkbtn" data-misled="' + esc(key) + '">' + esc(label) + "</button>" : esc(label)) + "</td>" +
      (cols ? months.map(mm => '<td class="n">' + m((x.m || {})[mm]) + "</td>").join("") : "") + '<td class="n">' + (bold ? "<b>" + m(x.t) + "</b>" : m(x.t)) + "</td>" +
      (r.prev ? '<td class="n">' + (x.p != null ? m(x.p) : "") + "</td>" : "") + (r.ly ? '<td class="n">' + (x.y != null ? m(x.y) : "") + "</td>" : "") + "</tr>";
    const pv = k => r.prev && r.prev.pl.heads[k] ? r.prev.pl.heads[k].t : (r.prev ? 0 : null), lv = k => r.ly && r.ly.pl.heads[k] ? r.ly.pl.heads[k].t : (r.ly ? 0 : null);
    let body = "";
    const block = keys => keys.forEach(k => { const H = r.pl.heads[k]; if (!H) return; const lab = MIS.HEADS.find(z => z[0] === k)[1];
      body += row(lab, Object.assign({}, H, {p: pv(k), y: lv(k)}), true);
      if (S.misOpenHead === k) H.led.forEach(x => { body += row("\u2003" + x.l, x, false, x.l); }); else body += '<tr><td colspan="' + (2 + (cols ? months.length : 0) + (r.prev ? 1 : 0) + (r.ly ? 1 : 0)) + '"><button class="linkbtn" data-misopenhead="' + k + '">\u25b8 ' + H.led.length + " ledgers</button></td></tr>"; });
    block(["rev", "oth"]); body += row("Total income", Object.assign({}, r.pl.income, {p: r.prev ? r.prev.pl.income.t : null, y: r.ly ? r.ly.pl.income.t : null}), true);
    block(["pur", "dir"]); body += row("Gross profit", Object.assign({}, r.pl.gross, {p: r.prev ? r.prev.pl.gross.t : null, y: r.ly ? r.ly.pl.gross.t : null}), true);
    block(["emp", "exp"]); body += row("Profit before interest and depreciation", Object.assign({}, r.pl.ebitda, {p: r.prev ? r.prev.pl.ebitda.t : null, y: r.ly ? r.ly.pl.ebitda.t : null}), true);
    block(["fin", "dep"]); body += row("Profit before tax", Object.assign({}, r.pl.pbt, {p: r.prev ? r.prev.pl.pbt.t : null, y: r.ly ? r.ly.pl.pbt.t : null}), true);
    block(["tax"]); body += row("Profit after tax", Object.assign({}, r.pl.pat, {p: r.prev ? r.prev.pl.pat.t : null, y: r.ly ? r.ly.pl.pat.t : null}), true);
    h += '<div class="bk-tablewrap"><table class="bk-table" id="misPl"><thead><tr><th></th>' + (cols ? months.map(mm => '<th class="n">' + GSTR.label(mm) + "</th>").join("") : "") + '<th class="n">Period</th>' +
      (r.prev ? '<th class="n">Previous period</th>' : "") + (r.ly ? '<th class="n">Last year</th>' : "") + "</tr></thead><tbody>" + body + "</tbody></table></div>" +
      '<p class="note">Opening and closing stock are not in the day book, so gross profit is before the change in stock. Ledgers are placed by their group in Tally.' + (r.ly ? "" : " Last year is shown once last year\u2019s books are read.") + "</p>";
    if (S.misLed){
      const vs = (b.vouchers || []).filter(v => v.date >= r.from && v.date <= r.to && v.ent.some(e => e.l === S.misLed)).sort((a, c) => a.date.localeCompare(c.date));
      h += '<section class="dash-card" style="margin-top:12px"><h3>' + esc(S.misLed) + ' <button class="linkbtn" data-misled="">close</button></h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Date</th><th>Voucher</th><th>Party</th><th class="n">Debit</th><th class="n">Credit</th><th>Narration</th></tr></thead><tbody>' +
        vs.slice(0, gfN(300)).map(v => { const a = v.ent.filter(e => e.l === S.misLed).reduce((s, e) => s + e.a, 0); return "<tr><td>" + fmtDate(tallyDate(v.date)) + "</td><td>" + esc(v.no) + '<div class="nr">' + esc(v.type) + "</div></td><td>" + esc(v.party || "") + '</td><td class="n">' + (a < 0 ? m(-a) : "") + '</td><td class="n">' + (a > 0 ? m(a) : "") + "</td><td>" + esc(v.narr || "") + "</td></tr>"; }).join("") +
        "</tbody></table></div>" + (vs.length > 300 ? '<p class="note">The first 300 of ' + vs.length + ".</p>" : "") + "</section>";
    }
    return h;
  }
  if (tab === "recv" || tab === "pay"){
    const A = tab === "recv" ? r.recv : r.pay;
    const list = A.rows.filter(p => (!q || p.party.toLowerCase().includes(q)) && (S.misF !== "90" || p.b[3] + p.b[4] > 0) && (S.misF !== "msme" || /micro|small/i.test(p.msme)));
    h += search("Find a " + (tab === "recv" ? "customer" : "supplier"));
    h += '<div class="bk-tablewrap"><table class="bk-table" id="misAge"><thead><tr><th>' + (tab === "recv" ? "Customer" : "Supplier") + "</th>" + MIS.BUCKETS.map(z => '<th class="n">' + z[1] + " days</th>").join("") +
      '<th class="n">Before these books</th><th class="n">Advances</th><th class="n">On account</th><th class="n">Total</th>' + (A.rows.some(p => p.tally != null) ? '<th class="n">Tally balance</th>' : "") + (tab === "pay" ? "<th>MSME</th>" : "") + "</tr></thead><tbody>" +
      list.slice(0, gfN(400)).map(p => {
        const open = S.misOpen === p.party;
        let x = '<tr><td><button class="linkbtn" data-misopen="' + esc(p.party) + '">' + (open ? "\u25be " : "\u25b8 ") + esc(p.party) + "</button></td>" + p.b.map((v, i) => '<td class="n' + (i >= 3 && v > 0 ? " bad" : "") + '">' + (v ? m(v) : "") + "</td>").join("") +
          '<td class="n">' + (p.pre ? m(p.pre) : "") + '</td><td class="n">' + (p.adv ? m(p.adv) : "") + '</td><td class="n">' + (p.unalloc ? m(p.unalloc) : "") + '</td><td class="n"><b>' + m(p.total) + "</b></td>" +
          (A.rows.some(z => z.tally != null) ? '<td class="n' + (p.diff && Math.abs(p.diff) >= 1 ? " bad" : "") + '" title="' + (p.diff ? "differs from the bills by " + m(p.diff) : "") + '">' + (p.tally != null ? m(p.tally) : "") + "</td>" : "") +
          (tab === "pay" ? '<td><select data-mismsme="' + esc(p.party) + '" style="width:auto"><option value="">\u2014</option>' + ["Micro", "Small", "Medium"].map(t => '<option' + (p.msme === t ? " selected" : "") + ">" + t + "</option>").join("") + "</select></td>" : "") + "</tr>";
        if (open) x += '<tr><td colspan="12" style="background:var(--paper);padding:0"><table class="bk-table" style="margin:0"><thead><tr><th>Bill</th><th class="dt">Date</th><th class="n">Days</th><th class="n">Outstanding</th></tr></thead><tbody>' +
          p.bills.map(z => "<tr><td>" + esc(z.ref || "on account") + (z.no ? '<div class="nr">vch ' + esc(z.no) + "</div>" : "") + "</td><td>" + fmtDate(tallyDate(z.date)) + '</td><td class="n">' + z.age + '</td><td class="n">' + m(z.amt) + "</td></tr>").join("") + "</tbody></table></td></tr>";
        return x;
      }).join("") +
      '<tr><td><b>Total</b></td>' + A.sum.b.map(v => '<td class="n"><b>' + m(v) + "</b></td>").join("") + '<td class="n">' + m(A.sum.pre) + '</td><td class="n">' + m(A.sum.adv) + '</td><td class="n">' + m(A.sum.unalloc) + '</td><td class="n"><b>' + m(A.sum.total) + "</b></td></tr></tbody></table></div>" +
      (Math.abs(A.sum.pre) >= 1 && A.sum.tally == null ? '<p class="bk-alert" style="margin-top:8px">' + m(Math.abs(A.sum.pre)) + " was " + (tab === "recv" ? "received" : "paid") + " against bills raised before the day book read here, so the total is not the balance. Read the books through the bridge (its balances fix the total), or a day book from when those bills were raised.</p>" : "") +
      '<p class="note">Age is counted from the bill date to ' + fmtDate(tallyDate(r.to)) + ". \u201cBefore these books\u201d are payments or receipts against bills older than the day book read here." + (tab === "pay" ? " MSME comes from the Udyam details in Tally; mark others here." : "") + "</p>";
    if (tab === "pay" && r.msme.length) h += '<section class="dash-card" style="margin-top:12px"><h3>MSME suppliers unpaid past ' + MIS.cfg(b).msmeDays + ' days</h3><p class="note">Under section 43B(h), what is owed to a micro or small enterprise and unpaid beyond the agreed period (at most 45 days) is allowed only when paid.</p><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Supplier</th><th>Type</th><th class="n">Bills</th><th class="n">Amount</th><th class="n">Oldest, days</th></tr></thead><tbody>' +
      r.msme.map(x => "<tr><td>" + esc(x.party) + "</td><td>" + esc(x.type) + '</td><td class="n">' + x.bills.length + '</td><td class="n">' + m(x.amt) + '</td><td class="n">' + Math.max.apply(null, x.bills.map(z => z.age)) + "</td></tr>").join("") + "</tbody></table></div></section>";
    return h;
  }
  if (tab === "sales" || tab === "purch"){
    const S2 = tab === "sales" ? r.sales : r.purchases, months = S2.months, cols = months.length <= 12;
    const list = S2.rows.filter(x => !q || x.party.toLowerCase().includes(q));
    h += search("Find a " + (tab === "sales" ? "customer" : "supplier"));
    if (tab === "sales") h += '<div class="dash-tiles"><div class="dtile"><span>Customers</span><b>' + S2.rows.length + "</b><small>" + (S2.fresh != null ? S2.fresh + " new in the period" : "") + '</small></div><div class="dtile"><span>Top five customers</span><b>' + (S2.total ? Math.round(S2.top5 / S2.total * 1000) / 10 : 0) + "%</b><small>of sales</small></div>" +
      '<div class="dtile"><span>By registration</span><b>' + S2.byReg.length + "</b><small>" + S2.byReg.map(([k, v]) => esc(k) + " " + m(v)).join(" \u00b7 ") + '</small></div><div class="dtile"><span>By state of the customer</span><b>' + S2.byState.length + "</b><small>" + S2.byState.slice(0, 4).map(([k, v]) => esc(k) + " " + m(v)).join(" \u00b7 ") + "</small></div></div>";
    h += '<div class="bk-tablewrap"><table class="bk-table" id="misParty"><thead><tr><th>' + (tab === "sales" ? "Customer" : "Supplier") + "</th>" + (cols ? months.map(mm => '<th class="n">' + GSTR.label(mm) + "</th>").join("") : "") + '<th class="n">Total</th><th class="n">Share</th></tr></thead><tbody>' +
      list.slice(0, gfN(400)).map(x => "<tr><td>" + esc(x.party || "\u2014") + "</td>" + (cols ? months.map(mm => '<td class="n">' + (x.m[mm] ? m(x.m[mm]) : "") + "</td>").join("") : "") + '<td class="n"><b>' + m(x.t) + '</b></td><td class="n">' + (S2.total ? Math.round(x.t / S2.total * 1000) / 10 + "%" : "") + "</td></tr>").join("") +
      '<tr><td><b>Total</b></td>' + (cols ? months.map(mm => '<td class="n">' + m(S2.rows.reduce((s, x) => s + (x.m[mm] || 0), 0)) + "</td>").join("") : "") + '<td class="n"><b>' + m(S2.total) + "</b></td><td></td></tr></tbody></table></div>" +
      '<p class="note">' + (tab === "sales" ? "Sales are shown without GST, less credit notes." : "Purchases and expenses booked against suppliers, without GST.") + "</p>";
    if (tab === "purch") h += '<section class="dash-card" style="margin-top:12px"><h3>Expense heads by month</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Ledger</th>' + (cols ? months.map(mm => '<th class="n">' + GSTR.label(mm) + "</th>").join("") : "") + '<th class="n">Total</th></tr></thead><tbody>' +
      S2.heads.filter(x => !q || x.l.toLowerCase().includes(q)).slice(0, gfN(200)).map(x => "<tr><td>" + esc(x.l) + (x.jumps.length ? ' <span class="tag warn">jumped</span>' : "") + "</td>" + (cols ? months.map(mm => '<td class="n' + (x.jumps.includes(mm) ? " bad" : "") + '">' + (x.m[mm] ? m(x.m[mm]) : "") + "</td>").join("") : "") + '<td class="n"><b>' + m(x.t) + "</b></td></tr>").join("") +
      '</tbody></table></div><p class="note">\u201cJumped\u201d: a month at least \u20b950,000 and more than one and a half times the average of the other months.</p></section>';
    return h;
  }
  if (["cash", "ratios", "regs", "cc", "budget"].includes(tab)) return h + misP2Html(tab, b, r);
  const C = r.comp;
  h += '<section class="dash-card"><h3>GST by month</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Month</th><th class="n">Output tax</th><th class="n">Credit</th><th class="n">Payable in cash</th></tr></thead><tbody>' +
    C.gst.map(x => "<tr><td>" + GSTR.label(x.ym) + '</td><td class="n">' + m(x.out) + '</td><td class="n">' + m(x.itc) + '</td><td class="n">' + m(x.pay) + "</td></tr>").join("") + "</tbody></table></div></section>";
  h += '<section class="dash-card" style="margin-top:12px"><h3>TDS by month</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Month</th><th class="n">Deducted</th><th class="n">Deposited (challans here)</th><th class="n">Difference</th></tr></thead><tbody>' +
    C.tds.map(x => "<tr><td>" + GSTR.label(x.ym) + '</td><td class="n">' + m(x.ded) + '</td><td class="n">' + m(x.dep) + '</td><td class="n' + (Math.abs(x.ded - x.dep) >= 1 ? " bad" : "") + '">' + m(x.ded - x.dep) + "</td></tr>").join("") + "</tbody></table></div></section>";
  h += '<section class="dash-card" style="margin-top:12px"><h3>Audit</h3>' + (C.audit ? '<div class="dash-row"><span>Findings open</span><b>' + C.audit.open + '</b></div><div class="dash-row"><span>Serious</span><b>' + C.audit.high + '</b></div><div class="dash-row"><span>Put right</span><b>' + C.audit.solved + "</b></div>" : '<p class="note">Not run yet.</p>') + "</section>";
  return h;
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

function misP2Html(tab, b, r){
  const m = v => INR.format(r2(v || 0)), p2 = r.p2;
  if (!p2) return '<p class="note">Run again to see this.</p>';
  if (tab === "cash"){
    const C = p2.cash, F = p2.fc, months = C.months, cols = months.length <= 12;
    const secName = {op: "From operations", inv: "From investing", fin: "From financing"};
    let h = '<section class="dash-card"><h3>Cash and bank: what came in and went out</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th></th>' + (cols ? months.map(mm => '<th class="n">' + GSTR.label(mm) + "</th>").join("") : "") + '<th class="n">Period</th></tr></thead><tbody>';
    ["op", "inv", "fin"].forEach(sc => {
      const S3 = C[sc]; if (!C.rows.some(x => x.sec === sc)) return;
      C.rows.filter(x => x.sec === sc).forEach(x => { const k = sc + "|" + x.lab, open = S.misCf === k;
        h += '<tr><td>\u2003<button class="linkbtn" data-miscf="' + esc(k) + '">' + (open ? "\u25be " : "\u25b8 ") + esc(x.lab) + "</button></td>" + (cols ? months.map(mm => '<td class="n">' + (x.m[mm] ? m(x.m[mm]) : "") + "</td>").join("") : "") + '<td class="n">' + m(x.t) + "</td></tr>";
        if (open) Object.entries(x.led).sort((a, c) => Math.abs(c[1]) - Math.abs(a[1])).slice(0, 40).forEach(([l, v]) => { h += '<tr><td class="note">\u2003\u2003' + esc(l) + '</td>' + (cols ? months.map(() => "<td></td>").join("") : "") + '<td class="n note">' + m(v) + "</td></tr>"; }); });
      h += "<tr><td><b>" + secName[sc] + "</b></td>" + (cols ? months.map(mm => '<td class="n"><b>' + m(S3.m[mm]) + "</b></td>").join("") : "") + '<td class="n"><b>' + m(S3.t) + "</b></td></tr>";
    });
    h += '<tr><td><b>Net change in cash and bank</b></td>' + (cols ? months.map(mm => '<td class="n"><b>' + m(C.op.m[mm] + C.inv.m[mm] + C.fin.m[mm]) + "</b></td>").join("") : "") + '<td class="n"><b>' + m(C.net) + "</b></td></tr></tbody></table></div>" +
      '<p class="note">Each receipt or payment is placed by the ledger on the other side of it: customers, suppliers, taxes, staff, fixed assets, loans or capital. Moves between cash and bank are left out.</p></section>';
    h += '<section class="dash-card" style="margin-top:12px"><h3>The next 13 weeks, from ' + fmtDate(tallyDate(F.start)) + "</h3>" +
      (F.opening != null ? '<p class="note">Starting with cash and bank of \u20b9' + m(F.opening) + (F.low ? "; the lowest point is \u20b9" + m(F.low.close) + " in the week of " + fmtDate(tallyDate(F.low.from)) + "." : ".") + "</p>" : '<p class="note">The cash in hand at the start is not known here (see the Summary); the table shows what comes in and goes out.</p>') +
      '<div class="bk-tablewrap"><table class="bk-table" id="misFc"><thead><tr><th>Week of</th><th class="n">Coming in</th><th class="n">Going out</th><th class="n">Net</th>' + (F.opening != null ? '<th class="n">Cash at the end</th>' : "") + "</tr></thead><tbody>" +
      F.weeks.map(w => { const open = S.misWeek === w.i;
        let x = '<tr><td><button class="linkbtn" data-misweek="' + w.i + '">' + (open ? "\u25be " : "\u25b8 ") + fmtDate(tallyDate(w.from)) + '</button></td><td class="n">' + m(w.inn) + '</td><td class="n">' + m(w.out) + '</td><td class="n' + (w.net < 0 ? " bad" : "") + '">' + m(w.net) + "</td>" +
          (F.opening != null ? '<td class="n' + (w.close < 0 ? " bad" : "") + '"><b>' + m(w.close) + "</b></td>" : "") + "</tr>";
        if (open) x += '<tr><td colspan="5" style="background:var(--paper);padding:0"><table class="bk-table" style="margin:0"><thead><tr><th class="dt">Date</th><th>What</th><th>Who</th><th class="n">Amount</th><th>Why this date</th></tr></thead><tbody>' +
          w.items.map(z => "<tr><td>" + fmtDate(tallyDate(z.d)) + "</td><td>" + esc(z.what) + "</td><td>" + esc(z.who) + '</td><td class="n' + (z.amt < 0 ? " bad" : "") + '">' + m(z.amt) + "</td><td>" + esc(z.why) + "</td></tr>").join("") + "</tbody></table></td></tr>";
        return x; }).join("") + "</tbody></table></div>" +
      '<p class="note">The rules: each open bill is expected when that party usually settles (from its past bills; ' + F.rd + " days for customers and " + F.pd + " for suppliers when a party has no history), and an overdue bill in the first week; MSME suppliers within " + MIS.cfg(b).msmeDays + " days; a payment made in at least three of the last four months, within 20% of the same amount, repeats on its usual day; GST on the 20th and TDS on the 7th, at last month\u2019s figure and then the usual month.</p></section>";
    return h;
  }
  if (tab === "ratios"){
    const R = p2.ratios, fmt = (v, u) => v == null ? "\u2014" : u === "\u20b9" ? "\u20b9" + m(v) : v + (u === "%" ? "%" : " " + u);
    return '<section class="dash-card"><h3>Ratios for the period</h3><div class="bk-tablewrap"><table class="bk-table"><tbody>' +
      R.list.map(([l, v, u, how]) => "<tr><td>" + esc(l) + (how ? '<div class="nr">' + esc(how) + "</div>" : "") + '</td><td class="n"><b>' + fmt(v, u) + "</b></td></tr>").join("") + "</tbody></table></div>" +
      (R.bs ? "" : '<p class="note">Current ratio, debt to equity and working capital need the balances; read the period from Tally through the bridge.</p>') + "</section>" +
      '<section class="dash-card" style="margin-top:12px"><h3>Margins month by month</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Month</th><th class="n">Revenue</th><th class="n">Gross margin</th><th class="n">Before-tax margin</th></tr></thead><tbody>' +
      R.trend.map(t2 => "<tr><td>" + GSTR.label(t2.ym) + '</td><td class="n">' + m(t2.rev) + '</td><td class="n">' + (t2.gross == null ? "\u2014" : t2.gross + "%") + '</td><td class="n' + (t2.pbt != null && t2.pbt < 0 ? " bad" : "") + '">' + (t2.pbt == null ? "\u2014" : t2.pbt + "%") + "</td></tr>").join("") + "</tbody></table></div></section>";
  }
  if (tab === "regs"){
    const G = p2.regs;
    if (G.length < 2) return '<p class="note">This client has one GST registration' + (G[0] ? " (" + esc(G[0].gstin) + ")" : "") + ". With more than one, sales, purchases and GST are shown for each here.</p>";
    const months = G[0].months, cols = months.length <= 12;
    return '<section class="dash-card"><h3>By GST registration</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Registration</th><th class="n">Sales</th><th class="n">Purchases</th><th class="n">GST paid in cash</th><th class="n">Share of sales</th></tr></thead><tbody>' +
      G.map(x => "<tr><td>" + esc(x.gstin) + '</td><td class="n">' + m(x.sales) + '</td><td class="n">' + m(x.purch) + '</td><td class="n">' + m(x.gstPay) + '</td><td class="n">' + (r.sales.total ? Math.round(x.sales / r.sales.total * 1000) / 10 + "%" : "") + "</td></tr>").join("") + "</tbody></table></div></section>" +
      '<section class="dash-card" style="margin-top:12px"><h3>Sales by month</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Registration</th>' + (cols ? months.map(mm => '<th class="n">' + GSTR.label(mm) + "</th>").join("") : "") + "</tr></thead><tbody>" +
      G.map(x => "<tr><td>" + esc(x.reg) + "</td>" + (cols ? months.map(mm => '<td class="n">' + m((x.m[mm] || {}).s) + "</td>").join("") : "") + "</tr>").join("") + "</tbody></table></div>" +
      '<p class="note">A voucher belongs to the registration of its GST ledgers. Expenses without GST are not split by registration; use cost centres for that.</p></section>';
  }
  if (tab === "cc"){
    const X = p2.cc, q = String(S.misQ || "").toLowerCase();
    if (!X.read) return '<div class="bk-alert">Cost centres are read from the day book from this build on. Read the day book again (or read it from Tally), then run the MIS.</div>';
    if (!X.rows.length) return '<p class="note">No income or expense in the period is allocated to cost centres in Tally.</p>';
    const list = X.rows.filter(x => (!q || x.name.toLowerCase().includes(q)) && (!S.misCat || x.cat === S.misCat));
    let h = '<div class="dash-tiles"><div class="dtile"><span>Cost centres</span><b>' + X.rows.length + "</b><small>" + X.cats.length + " categor" + (X.cats.length === 1 ? "y" : "ies") + '</small></div><div class="dtile"><span>Income allocated</span><b>' + (X.cover.inc == null ? "\u2014" : X.cover.inc + "%") + "</b><small>not allocated \u20b9" + m(X.un.inc) + '</small></div><div class="dtile"><span>Expenses allocated</span><b>' + (X.cover.exp == null ? "\u2014" : X.cover.exp + "%") + "</b><small>not allocated \u20b9" + m(X.un.exp) + '</small></div><div class="dtile"><span>Made a loss</span><b>' + X.rows.filter(x => x.inc && x.profit < 0).length + "</b><small>of those with income</small></div></div>";
    h += '<div class="revfilter"><input type="search" id="misq" data-fk="misq" data-keeptyped value="' + esc(S.misQ || "") + '" placeholder="Find a cost centre" style="width:260px">' +
      (X.cats.length > 1 ? '<select data-miscat style="width:auto"><option value="">Every category</option>' + X.cats.map(c2 => '<option' + (S.misCat === c2 ? " selected" : "") + ">" + esc(c2) + "</option>").join("") + "</select>" : "") + "</div>";
    h += '<div class="bk-tablewrap"><table class="bk-table" id="misCc"><thead><tr><th>Cost centre</th><th class="dt">From</th><th class="dt">To</th><th class="n">Income</th><th class="n">Costs</th><th class="n">Profit</th><th class="n">Margin</th></tr></thead><tbody>' +
      list.slice(0, gfN(300)).map(x => { const open = S.misCc === x.cat + "|" + x.name;
        let y = '<tr><td><button class="linkbtn" data-miscc="' + esc(x.cat + "|" + x.name) + '">' + (open ? "\u25be " : "\u25b8 ") + esc(x.name) + "</button>" + (X.cats.length > 1 ? '<div class="nr">' + esc(x.cat) + "</div>" : "") + "</td><td>" + fmtDate(tallyDate(x.first)) + "</td><td>" + fmtDate(tallyDate(x.last)) +
          '</td><td class="n">' + m(x.inc) + '</td><td class="n">' + m(x.exp) + '</td><td class="n' + (x.profit < 0 ? " bad" : "") + '"><b>' + m(x.profit) + '</b></td><td class="n">' + (x.margin == null ? "\u2014" : x.margin + "%") + "</td></tr>";
        if (open) y += '<tr><td colspan="7" style="background:var(--paper);padding:0"><table class="bk-table" style="margin:0"><thead><tr><th>Ledger</th><th class="n">Amount</th></tr></thead><tbody>' +
          Object.entries(x.led).sort((a, c) => Math.abs(c[1]) - Math.abs(a[1])).map(([l, v]) => "<tr><td>" + esc(l) + '</td><td class="n">' + m(v) + "</td></tr>").join("") + "</tbody></table></td></tr>";
        return y; }).join("") + "</tbody></table></div>" +
      '<p class="note">From the cost centre allocations in Tally, on income and expense ledgers. Anything not allocated is shown above, not spread over the cost centres.</p>';
    return h;
  }
  // budget
  const V = MIS.budgetVs(r), fy = V.fy, bud = MIS.budgetFor(fy), fyMonths = GSTRev.fyMonths(fy + "04");
  let h = '<section class="dash-card"><h3>Budget against actual, ' + fy + "-" + String(num(fy) + 1).slice(2) + "</h3>" +
    (V.has ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Head</th><th class="n">Budget for the period</th><th class="n">Actual</th><th class="n">Difference</th><th class="n">%</th></tr></thead><tbody>' +
      V.rows.map(x => { const worse = x.sign > 0 ? x.diff < 0 : x.diff > 0; return "<tr><td>" + esc(x.l) + '</td><td class="n">' + m(x.budget) + '</td><td class="n">' + m(x.actual) + '</td><td class="n' + (worse && Math.abs(x.diff) >= 1 ? " bad" : "") + '">' + m(x.diff) + '</td><td class="n">' + (x.pct == null ? "\u2014" : x.pct + "%") + "</td></tr>"; }).join("") +
      '<tr><td><b>Profit before tax</b></td><td class="n"><b>' + m(V.pbt.budget) + '</b></td><td class="n"><b>' + m(V.pbt.actual) + '</b></td><td class="n' + (V.pbt.diff < 0 ? " bad" : "") + '"><b>' + m(V.pbt.diff) + "</b></td><td></td></tr></tbody></table></div>" : '<p class="note">No budget for this year yet. Fill it in below, or start from last year.</p>') + "</section>";
  h += '<section class="dash-card" style="margin-top:12px"><h3>The budget</h3><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
    '<button class="btn small" data-act="misBudFill">Fill from this year\u2019s actual so far</button><label class="note">plus <input type="number" data-misbudpct value="' + esc(S.misBudPct || "10") + '" style="width:70px">%</label>' +
    '<span class="note">Figures in rupees for each month; income and costs as positive amounts.</span></div>' +
    '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Head</th>' + fyMonths.map(mm => '<th class="n">' + GSTR.label(mm).replace(/ \d{4}$/, "") + "</th>").join("") + '<th class="n">Year</th></tr></thead><tbody>' +
    MIS.HEADS.map(([k, l]) => "<tr><td>" + esc(l) + "</td>" + fyMonths.map(mm => '<td><input type="number" step="1" data-misbud="' + k + "|" + mm + '" value="' + esc((bud[k] || {})[mm] || "") + '" style="width:92px;text-align:right"></td>').join("") +
      '<td class="n"><b>' + m(fyMonths.reduce((s2, mm) => s2 + num((bud[k] || {})[mm]), 0)) + "</b></td></tr>").join("") + "</tbody></table></div></section>";
  return h;
}

function auditTabs(){
  const t = S.auditTab || "find";
  return '<nav class="sbar" aria-label="Audit" style="margin-bottom:10px">' + [["find", "Findings"], ["rel", "Related parties"], ["3cd", "Form 3CD draft"]]
    .map(([id, l]) => '<button data-audittab="' + id + '" aria-selected="' + (t === id) + '">' + l + "</button>").join("") + "</nav>";
}
function viewAuditRel(b){
  const rel = b.auditRel || [], guess = Audit.relatedGuess(), pans = b.pans || {};
  const REL = ["Director", "Relative of a director", "Partner or proprietor", "Shareholder with 10% or more", "Company or firm they control", "Key manager", "Other"];
  let h = '<section class="dash-card"><h3>Related parties</h3><p class="note">Directors, partners, their relatives, and the concerns they control. Transactions with them feed clause 23 (section 40A(2)(b)), clause 36A (deemed dividend), and the related-party note. The audit only uses the people listed here.</p>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0"><input type="search" id="relq" list="relList" data-fk="relq" placeholder="Type a ledger name" style="width:300px"><datalist id="relList">' +
    Object.keys(Object.assign({}, b.ledInfo || {}, b.map || {})).sort().slice(0, 3000).map(n => '<option value="' + esc(n) + '">').join("") + '</datalist><button class="btn small" data-act="relAddTyped">Add</button></div>' +
    (rel.length ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Ledger in Tally</th><th>PAN</th><th>Relation</th><th class="ac"></th></tr></thead><tbody>' +
      rel.map(x => "<tr><td>" + esc(x.name) + "</td><td>" + esc(pans[x.name] || "\u2014") + '</td><td><select data-relrel="' + esc(x.name) + '" style="width:auto"><option value="">choose</option>' + REL.map(r => "<option" + (x.relation === r ? " selected" : "") + ">" + r + "</option>").join("") + "</select></td>" +
        '<td class="ac"><button class="linkbtn" data-reldel="' + esc(x.name) + '">remove</button></td></tr>').join("") + "</tbody></table></div>" : '<p class="note">No one listed yet.</p>') + "</section>";
  if (guess.length) h += '<section class="dash-card" style="margin-top:12px"><h3>Possibly related</h3><p class="note">Found in the ledgers by where they sit or what they are called. Add the ones that are related.</p><div class="bk-tablewrap"><table class="bk-table"><tbody>' +
    guess.map(g => "<tr><td>" + esc(g.name) + '<div class="nr">' + esc(g.why) + "</div></td><td>" + esc(pans[g.name] || "") + '</td><td class="ac"><button class="btn small" data-reladd="' + esc(g.name) + '">Add</button></td></tr>').join("") + "</tbody></table></div></section>";
  return h;
}
function viewAudit3cd(b){
  const run = (b.audit || {}).last;
  if (!run) return '<div class="bk-none">Run the audit first (Findings \u2192 Run now); the draft is filled from it.</div>';
  const d = Audit.form3cd(run);
  return '<section class="dash-card"><div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px"><button class="btn small primary" data-act="audit3cdPdf">Download the draft (PDF)</button><button class="btn small" data-act="audit3cdExcel">Excel</button></div>' +
    '<div class="audit3cd">' + Audit.form3cdHtml(d).replace(/<table>/g, '<div class="bk-tablewrap"><table class="bk-table">').replace(/<\/table>/g, "</table></div>") + "</div></section>";
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
// the Tally ledgers tab: React (app/src/screens/books/Ledgers.jsx)
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
function gstPartHtml(b, part){
  if (part === "notices") return AIH.viewNotices(b, "gst");
  return "";
}
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
function viewTallyHome(){
  return '<section class="today"><h2>Tally</h2></section>' + viewBridgeSettings() + viewPostLog();
}

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
function viewReading(){
  const cfg = apiSettings(), gcfg = googleSettings(), inClaude = !!window.claude;
  const permText = {granted:"allowed", prompt:"not asked yet", denied:"declined for this page load", unavailable:"not available in this view"}[S.samplePerm] || (S.sample ? "available" : "not available in this view");
  const st = S.readStats, row = (label, state, detail, btn) => '<tr><td><b>' + label + '</b></td><td>' + state + '</td><td class="note">' + detail + "</td><td>" + (btn || "") + "</td></tr>";
  const ocrState = {idle:'<span class="tag no">Checking…</span>', available:'<span class="tag ok">Available</span>', loading:'<span class="tag no">Loading…</span>',
    ready:'<span class="tag ok">Working</span>', unavailable:'<span class="tag bad">Not working</span>'}[S.ocrState] || "";
  const clState = viaPlatform() ? '<span class="tag ok">In your plan</span>'
    : S.engine ? (S.readBlocked ? '<span class="tag bad">Declined</span>' : '<span class="tag ok">Set up</span>') : '<span class="tag bad">Not set up</span>';
  const banner = (t, busyText) => !t ? "" : '<p class="banner" style="margin:10px 0 0;' + (t.busy ? "" : t.ok ? "border-left-color:var(--ledger);background:var(--ledger-soft)" : "border-left-color:var(--stop);background:var(--stop-soft)") + '">' + (t.busy ? busyText : esc(t.msg)) + "</p>";

  // 1. where am I?
  let h = '<div class="pane" style="margin-top:0"><h2>Settings</h2><p style="margin:4px 0 0">' +
    (inClaude ? "You are using the app <b>inside claude.ai</b>. Here Claude can read bills, but the free OCR and Google OCR may be blocked. For those, download the standalone app below."
      : "You are using the <b>standalone app</b> (this file on your computer or website). Free OCR, Google OCR and your Claude API key all work here.") +
    '</p><p class="note" style="margin:4px 0 0">App version: ' + esc(APP_VERSION) + "</p>" +
    (inClaude ? '<div class="row" style="margin-top:10px"><button class="btn primary" data-act="dlStandalone">Download the standalone app</button><span class="note">About 8 MB. Open it in Chrome or Edge.</span></div>' : "") + "</div>";

  h += viewSelfTest();
  // 2. reading check
  h += '<div class="pane" id="readingPane"><h2>Reading check</h2>' +
    '<p class="note" style="margin:0 0 10px">Press Test on each line to see whether it really works here. Every bill shows a badge: <span class="tag ok">Free</span> or <span class="tag ok">Google OCR</span> means no Claude cost, <span class="tag stamp">Claude</span> means Claude read it.</p>' +
    '<div class="tblwrap"><table class="data"><tbody>' +
    row("1. Free: PDF text", (window.pdfjsLib || window.TDS_ASSETS) ? '<span class="tag ok">Working</span>' : '<span class="tag bad">Not loaded</span>', "Computer-made PDFs are read from their own text. No cost.", "") +
    row("2. Free: built-in OCR", ocrState,
      S.ocrState === "unavailable" ? esc(ocrProblem()) + "." : S.ocrKind === "built-in" ? "For photos and scans. Built into this app, works offline." : "For photos and scans.",
      '<button class="btn small" data-act="testOcr"' + (S.ocrTest && S.ocrTest.busy ? " disabled" : "") + ">Test</button>") +
    row("3. Google Cloud Vision OCR", inClaude ? '<span class="tag no">Standalone only</span>' : viaPlatform() ? '<span class="tag ok">In your plan</span>' : !hasGoogle() ? '<span class="tag no">No key yet</span>' : (S.googleAuto && !S.googleAuto.ok) || (S.googleLast && !S.googleLast.ok) ? '<span class="tag bad">Not working</span>' : S.googleAuto && S.googleAuto.ok ? '<span class="tag ok">Working</span>' : '<span class="tag ok">Set up</span>',
      inClaude ? "Blocked inside claude.ai." : viaPlatform() ? "Through your plan: used when the built-in OCR fails its checks; your firm is charged per page."
      : hasGoogle() ? "Used when the built-in OCR fails its checks." + (S.googleAuto ? " Daily check: " + (S.googleAuto.ok ? "working." : "FAILED — " + esc(S.googleAuto.msg)) : "") + (S.googleLast && !S.googleLast.ok ? " Last bill: FAILED — " + esc(S.googleLast.msg) : "") : "Stronger on photos and handwriting. Add the key in the box below.",
      hasGoogle() ? '<button class="btn small" data-act="testGoogle"' + (S.googleTest && S.googleTest.busy ? " disabled" : "") + ">Test</button>" : "") +
    row("4. Claude", clState, viaPlatform() ? "Through your plan: the platform holds the key and your firm is charged for what it uses."
      : S.engine === "api" ? "Your Claude API key (" + esc(cfg.model) + ")." : S.engine === "claude" ? "Claude inside claude.ai (access: " + esc(permText) + ")." : "Used only when steps 1–3 fail the checks.",
      '<button class="btn small" data-act="testReader"' + (S.engine && !(S.testResult && S.testResult.busy) ? "" : " disabled") + ">Test</button>" +
      (S.samplePerm === "prompt" || S.samplePerm === "denied" ? ' <button class="btn small" data-act="askPerm">Allow</button>' : "")) +
    "</tbody></table></div>" +
    banner(S.ocrTest, "Testing built-in OCR…") + banner(S.googleTest, "Testing Google OCR…") + googleHelpHtml() + banner(S.testResult, "Testing Claude… it may ask for permission first.") +
    '<p style="margin:12px 0 0">Bills read since this page opened: <b>' + st.free + "</b> free · <b>" + (st.google || 0) + "</b> by Google OCR · <b>" + (st.freePlusClaude || 0) + "</b> free figures + Claude for the supplier name · <b>" + st.claudeText + "</b> by Claude (text) · <b>" + st.claudeImages + "</b> by Claude (images).</p></div>";

  // 3. keys: none in the browser any more
  h += '<div class="pane" id="keysPane"><h2>Keys</h2><p class="note" style="margin:0">No API keys are kept on this computer. Claude and Google OCR are reached through the firm account, which holds the keys on the server; sign in to the firm account to use them. The free built-in OCR works without signing in.</p></div>';

  // 4. order
  h += '<div class="pane"><h2>Reading order</h2>' +
    '<label class="chk" style="margin:6px 0 10px"><input type="checkbox" data-act-toggle="askClaudeNew"' + (S.askClaudeNewSupplier ? " checked" : "") + "> <span><b>Ask Claude for a new supplier's name and payment type</b> when free reading got all the figures (a small text-only call). When off, you confirm them yourself; the app remembers them for that supplier's later bills.</span></label>" +
    '<label class="chk" style="margin:6px 0 4px"><input type="checkbox" data-act-toggle="freeFirst"' + (S.freeFirst ? " checked" : "") + "> <span><b>Try free reading first</b> (steps 1–3 above). A result is accepted only when the checks pass: supplier GSTIN check digit, bill number, valid date, taxable value + GST = total, standard GST rate. Otherwise Claude reads the bill.</span></label>" +
    '<p style="margin:8px 0 0">Now: ' + (viaPlatform() ? "<b>free steps, then Claude through your plan</b>"
      : S.engine === "api" ? "<b>free steps, then your Claude API key</b>"
      : S.engine === "claude" ? "<b>free steps, then Claude inside claude.ai</b>" + (S.imgMax ? "" : " (text PDFs only)")
      : S.freeFirst ? (hasGoogle() ? "<b>built-in OCR, then Google OCR</b>. No Claude: bills that fail the checks go to Type it in" : "<b>free reading only</b>. Handwritten bills need the Google or Claude key")
      : "<b>nothing: bills cannot be read here</b>") + ".</p></div>";
  return h;
}
// everything sent to Tally: React (app/src/screens/Done.jsx)
function viewPostLog(){ return '<div data-react="PostLog"></div>'; }
function postLogCsv(){
  const log = (S.firm.postLog || []).slice().reverse();
  const rows = [["When", "What", "Action", "Client", "Reference", "Party", "Amount", "Voucher type", "Tally id", "Company", "By"]].concat(
    log.map(r => [r.at, r.what || "", r.action || "", (CO(r.co) || {}).name || "", r.ref || "", r.party || "", r.amount || "", (r.tally || {}).vchType || "", (r.tally || {}).masterId || "", (r.tally || {}).company || "", r.by || ""]));
  saveFile("posted-to-tally-" + new Date().toISOString().slice(0, 10) + ".csv", new Blob([rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n")], {type: "text/csv"}));
}
// the TDS rates and limits for all clients (the firm's name is in Settings → Firm details)
function viewRates(){
  let h = "";
  h += '<div class="pane"><h2>Rates and limits for all clients</h2><p class="note" style="margin:0 0 12px">Set for tax year 2026-27 under section 393 of the Income-tax Act, 2025. Check them against the Act and any Finance Act changes before relying on them. Ledger names are set per client in Client setup \u2192 TDS.</p>' +
    '<div class="tblwrap"><table class="data"><thead><tr><th>Payment type</th><th>Section</th><th class="n">Rate: Ind/HUF %</th><th class="n">Rate: others %</th><th class="n">Single bill limit</th><th class="n">Limit</th></tr></thead><tbody>' +
    rules().map(r => {
      const lim = r.basis === "never" || r.basis === "always" ? '<td class="n">—</td>' : '<td class="n"><input type="number" data-rule="' + r.id + '" data-k="limit" value="' + r.limit + '" aria-label="Limit"><div class="note">' + ({annual:"per year", single_or_annual:"per year", monthly:"per month", excess:"per year, TDS on excess"}[r.basis]) + "</div></td>";
      return "<tr><td>" + esc(r.label) + "</td><td>" + esc(r.ref) + '<div class="note">' + esc(r.old) + "</div></td>" +
        (r.basis === "never" ? '<td class="n">—</td><td class="n">—</td>' : '<td class="n"><input type="number" step="0.01" data-rule="' + r.id + '" data-k="rateInd" value="' + r.rateInd + '" aria-label="Rate individual"></td><td class="n"><input type="number" step="0.01" data-rule="' + r.id + '" data-k="rateOth" value="' + r.rateOth + '" aria-label="Rate others"></td>') +
        (r.basis === "single_or_annual" ? '<td class="n"><input type="number" data-rule="' + r.id + '" data-k="single" value="' + r.single + '" aria-label="Single bill limit"></td>' : '<td class="n">—</td>') + lim + "</tr>";
    }).join("") + "</tbody></table></div>" +
    '<div class="row" style="margin-top:12px"><button class="btn small" data-act="resetRules">Restore default rates and limits</button></div>' +
    '<p class="note" style="margin:10px 0 0">Without a PAN the rate is 20%, or 5% for purchase of goods. TDS is worked on the value before GST where GST is shown separately.</p></div>';
  return h;
}
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
