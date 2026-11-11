/* ================================================================== */
/* Certificates under 197, and 206AA where there is no PAN            */
/* ================================================================== */
const Certs = {
  all(){ return ((S.books || {}).certs || []).slice().sort((a, b) => String(a.party).localeCompare(String(b.party))); },
  // the certificate that covers this payment, if there is one
  // T-A3 (10-Oct-2026): by PAN where both have one, else by name; its section; its dates (TDSLdc, src/js/66)
  forRow(r){
    return typeof TDSLdc === "object" ? this.all().find(c => TDSLdc.covers(c, r)) : this.all().find(c => (!c.section || c.section === r.section) &&
      normName(c.party) === normName(r.party) &&
      (!c.from || TDS.ymd(r.date) >= TDS.ymd(c.from)) && (!c.to || TDS.ymd(r.date) <= TDS.ymd(c.to)));
  },
  // (the TDS check of 22-Oct-2026, M5: the fourth letter is the holder's status, one of those Protean's FVU takes)
  validPan(p){ return /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/.test(String(p || "").toUpperCase()); },
  // PANs marked inoperative (not linked with Aadhaar) for this client's books: S.books.panInoperative = {PAN: date checked}
  inoperative(p){
    const P = String(p || "").toUpperCase();
    if (!P) return false;
    if (((S.books || {}).panInoperative || {})[P]) return true;
    // next-challan-match: a PAN the TRACES verification found inoperative (PANCheck's stored result, read directly here:
    // PANCheck.status reads this function, so this one never calls it)
    if (((((typeof S === "object" && S.firm) || {}).panCheck || {})[P] || {}).state === "inoperative") return true;
    return Object.values(D().parties || {}).some(x => x && x.panInoperative && String(x.pan || "").toUpperCase() === P);
  },
  // what the rate should have been, and why
  expected(r){
    const cert = this.forRow(r);
    if (cert){
      // T-A3: the certificate's rate up to its amount; a payment that crosses the amount at the usual rate for the rest
      const lim = num(cert.limit), name = "certificate " + (cert.certNo || "under 197");
      if (!lim || typeof TDSLdc !== "object") return {rate: num(cert.rate), why: name, cert};
      const before = num(((TDSLdc.use()[cert.id] || {}).byRow || {})[r.id]), left = r2(Math.max(0, lim - before)), paid = num(r.paid);
      const normal = this.afterCert(r);
      if (left >= paid || normal.rate == null) return {rate: num(cert.rate), why: name + " (\u20b9" + INR.format(left) + " of its \u20b9" + INR.format(lim) + " left before this)", cert};
      if (left <= 0) return {rate: normal.rate, why: name + "'s amount of \u20b9" + INR.format(lim) + " used up: " + normal.why};
      // the tax due worked out on the amounts, not on the rounded rate (the TDS review's case: ₹8,000 short, not ₹8,010)
      return {rate: r2((left * num(cert.rate) + (paid - left) * normal.rate) / paid), cert, due: r2((left * num(cert.rate) + (paid - left) * normal.rate) / 100),
        why: name + ": \u20b9" + INR.format(left) + " left at " + num(cert.rate) + "%, the other \u20b9" + INR.format(r2(paid - left)) + " at " + normal.rate + "%"};
    }
    return this.expectedNormal(r);
  },
  // the rate above a certificate's amount (the TDS review of 14-Oct-2026, M4): the section's own rate for what was paid for,
  // never the rate deducted (under a certificate that is the certificate's); what was paid for not known, the section's
  // higher rate, said so. No PAN: as without a certificate
  afterCert(r){
    if (!this.validPan(r.pan) || this.inoperative(r.pan)) return this.expectedNormal(r);
    const by = typeof TDSRate === "object" ? TDSRate.expect(r) : null;
    if (by) return {rate: by.rate, why: by.why};
    const std = TDS.STD[TDS.sec(r.section)] || [];
    return std.length ? {rate: Math.max(...std), why: "the section's higher rate, " + Math.max(...std) + "% (what was paid for is not known)"} : {rate: null, why: ""};
  },
  // the rate without a certificate
  expectedNormal(r){
    const std = TDS.stdOn(r.section, r.date);
    const near = std.length ? std.slice().sort((a, b) => Math.abs(a - (r.rate || 0)) - Math.abs(b - (r.rate || 0)))[0] : null;
    // no PAN (or one marked inoperative under Deductees): the higher of the usual rate and 20%; 5% for 194Q and 194-O
    const noPan = !this.validPan(r.pan) ? "no valid PAN" : this.inoperative(r.pan) ? "PAN inoperative" : "";
    if (noPan){
      const sec = TDS.sec(r.section), rule = sec === "194Q" || sec === "194O" ? {noPanRate: 5} : null;
      return {rate: noPanRate(rule, near == null ? 0 : near), why: noPan + ", section 206AA (higher rate)", noPan: true};
    }
    // who the deductee is (the PAN's 4th letter) and what was paid for decide the rate within a section (TDSRate, src/js/66):
    // 194C to a company 2%, to an individual 1%; 194J professional 10%, technical 2%; 194-I building 10%, machinery 2%
    const by = typeof TDSRate === "object" ? TDSRate.expect(r) : null;
    if (by) return {rate: by.rate, why: by.why};
    if (near == null) return {rate: null, why: ""};
    return {rate: near, why: "usual rate for " + r.section};
  },
  // where the books deducted at a different rate from the one that applies
  issues(fy, q){
    const out = [];
    TDS.rows().filter(r => (!fy || r.fy === fy) && (!q || r.q === q)).forEach(r => {
      // a TDS entry of its own short of its bill (TDSSep, src/js/66) is the audit's "short deducted" (TDSWatch), said once
      if (r.sepShort) return;
      // N7 (Testing AAD, 01-Jul-2026: rent on "TDS 94H" at 10%): the section looks wrong, not the rate (TDSAudit says so)
      if (typeof TDSRate === "object" && TDSRate.secOfPay(r.pay) && TDSRate.secOfPay(r.pay) !== TDS.sec(r.section).slice(0, 4)) return;
      const e = this.expected(r);
      if (e.rate == null || r.rate == null) return;
      const short = e.due != null ? r2(e.due - r.tds) : r2(r.paid * (e.rate - r.rate) / 100);
      if (Math.abs(e.rate - r.rate) < 0.05 || Math.abs(short) < TDS.MIN_WARN) return;
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
        issues: Certs.issues(fy, q).length, nr: this.other(TDS.nrRows(), fy, q), tcs: this.other(TDS.tcsRows(), fy, q)};
    });
  },
  // a quarter of 27Q or 27EQ in the year's table
  other(all, fy, q){
    const rows = all.filter(r => r.fy === fy && r.q === q);
    return {n: rows.length, tds: r2(rows.reduce((a, r) => a + r.tds, 0)), unallocated: r2(rows.filter(r => !r.challan).reduce((a, r) => a + r.tds, 0)),
      noPan: rows.filter(r => !Certs.validPan(r.pan)).length};
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
// ledger-confirm (14-Oct-2026): the old Tally ledgers tab, asked for anywhere, is the TDS page's Ledgers (TaxLed.redirect)
function booksTab(){ if (S.booksTab === "ledgers" && typeof TaxLed === "object") TaxLed.redirect(); return S.booksTab || "import"; }
// 18-Oct-2026: one opening at a time per client, and its promise kept (booksOpening), so a caller that finds the books
// already opening can wait for them (tallyFiles, src/js/23). Books that cannot be opened (this browser's store not read)
// are marked openFailed with the reason, said on the Books page, never left "loading" in silence
let booksOpening = null;
function openBooks(cid){
  if (S.books && S.books.cid === cid) return booksOpening && booksOpening.cid === cid ? booksOpening.p : Promise.resolve();
  const me = {cid};
  me.p = openBooksNow(cid).catch(e => {
    const why = String((e && e.message) || e).replace(/[.\s]+$/, "");
    if (S.books && S.books.cid === cid){ S.books.openFailed = why; render(); }
  }).then(() => { if (booksOpening === me) booksOpening = null; });
  booksOpening = me;
  return me.p;
}
async function openBooksNow(cid){
  const opening = S.books = {cid, loading: true};
  render();
  // prefetch-books: these books being brought in behind the page (src/js/98) are finished first, at once, and opened from
  // this browser's store: nothing fetched twice
  if (typeof Prefetch === "object" && Prefetch.cur === cid) await Prefetch.rush(cid);
  const t0 = Date.now(), saved = await Books.load(cid);
  // another client was opened meanwhile, or these books were put in meanwhile (an import, the cloud's copy; since
  // 25-Oct-2026 Ledgers.watch opens a client's books with the client, so this opening can still be reading this browser's
  // store when they come): never written over with the older copy kept here
  if (S.books !== opening) return;
  const held = !!(saved && saved.cid === cid);
  S.books = held ? Object.assign({loading: true, cached: true}, saved) : {cid, loading: true, vouchers: [], map: {}, challans: [], alloc: {}, pans: {}};
  // live sync: the server's latest first (only what changed since this computer last looked); this browser's copy is
  // a cache and is not shown in place of a newer one. Offline, or the server slow, the copy here is shown and said so.
  // next-fast-open (Leads, 20-Oct-2026: "taking long to open"): the books are shown once the server's changes are in
  // (one read: BookItems' o.taken), not after the challans' heal and this computer's own changes are sent; books kept
  // here wait 1.5 s at most for it, then show and take the server's changes as they come, quietly. The rest (the heal,
  // sending, the cloud copy's check, the audit) waits until the page is drawn (painted; 3 s at most)
  let painted; const drawn = new Promise(ok => { painted = ok; }); setTimeout(() => painted(), 3000);
  if (typeof BookSync === "object" && BookSync.on()){
    let taken; const first = new Promise(ok => { taken = ok; });
    // speed round 2 (27-Oct-2026, the owner: "it is getting late to open", under 1 s wanted): books kept here are drawn
    // at once, and the server's changes since this computer last looked are asked for only once they are on screen
    // (beside the cloud copy's check, below, not before it); books not kept here still wait for them (6 s at most)
    const pull = (held ? drawn.then(() => BookSync.pull(cid, {taken, after: drawn})) : BookSync.pull(cid, {taken, after: drawn})).catch(() => {});
    pull.then(taken);
    // books-speed (24-Oct-2026): the server's changes come in behind the books kept here, item by item, as before
    // (BookItems.take: a change made here and not sent yet is never overwritten)
    const late = held ? true : await Promise.race([first.then(() => false), new Promise(ok => setTimeout(() => ok(true), 6000))]);
    if (!S.books || S.books.cid !== cid) return;
    // (item by item, BookItems draws the page itself when something came in: not drawn again for nothing)
    if (late && held && Live.sv.state !== "offline") first.then(() => { if (S.books && S.books.cid === cid && !(typeof BookItems === "object" && BookItems.on())) render(); });
    else if (late || Live.sv.state === "offline"){ S.books.offline = true; toast("The server could not be reached: this is this computer’s copy of the books, as last saved here. It is brought up to date as soon as the server answers.", {background: true}); pull.then(() => { if (S.books && S.books.cid === cid){ S.books.offline = false; render(); } }); }
  }
  S.books.loading = false; delete S.books.cached; S.books.openMs = Date.now() - t0; S.books.openAt = t0;
  // names kept with line breaks or entities (a copy from before they were cleaned) cleaned once (TallyRead.cleanNames)
  try { if (TallyRead.cleanNames(S.books)) saveBooks(); } catch (e){}
  if (S.books.vouchers && S.books.vouchers.length) try { LedMaster.refresh(S.books); } catch (e){}
  // server-books: the cloud copy is where the books are; this browser's copy is only a cache of it
  if (typeof TCloud === "object" && TCloud.on()) drawn.then(() => { TCloud.openLoad(cid).catch(() => {}); });
  setTimeout(() => { try { if (typeof CloudDocs === "object" && CloudDocs.on() && S.coId === cid) CloudDocs.sendPending(cid, true); } catch (e){} }, 3000);
  drawn.then(() => setTimeout(() => { try { if (S.books && S.books.cid === cid){ Audit.maybeRun(); MIS.maybeRun(); } } catch (e){} }, 400));
  // the drafts' party and expense ledgers, now that the day book and the ledger masters' GSTINs are here
  try { if (typeof billAutoAll === "function" && S.coId === cid) billAutoAll(cid); } catch (e){}
  render();
  try { requestAnimationFrame(() => setTimeout(() => painted(), 0)); } catch (e){ painted(); }
}
// everything kept with a client's books, in this browser and (the TDS and GST work) in the firm's database
const BOOKS_KEYS = ["vouchers", "map", "meta", "gstPosFix", "challans", "alloc", "allocFrom", "pans", "twoB", "gstins", "under", "states", "groups", "salary", "certs", "advFix", "assets", "rev", "filed", "amendFix", "twoBs", "reco2b", "ledInfo", "ledInfoAt", "audit", "auditCfg", "auditRel", "ledSnaps", "gst9c", "groupInfo", "fs", "tb", "mis", "misCfg", "msme", "budget", "gst3b", "gst9", "gstOpen", "itcBasis", "itcTrack", "outRej", "gstFiled", "gstAato", "filed1a", "rule37On", "gstCashLedger", "gstSet", "gstContacts", "gstApi", "gstEst", "gstVault", "gstRegs", "letters", "ai", "tallyCo", "tbCheck", "nrInfo", "tcsCodes", "panInoperative", "filed3b", "apiTaken", "trashLog", "gone", "filedDocs", "portalFiled", "gstNotes", "ledOk", "ledCheck", "tdsFiled", "tdsSnap", "tds26as", "tanParty", "f16a", "tracesJr", "tracesConso", "payDetails", "auditWp", "chPortions", "tdsCorr", "allocLog", "tracesChStatus", "tcsCodesFixed", "fixedAssets", "tdsEdits", "matchNo", "tdsSplits", "panFix", "tdsAdded", "tdsPayKind", "payroll", "itcDec", "itcAdj", "r1Fix"];
async function saveBooks(opts, bb){
  const b = bb || S.books; if (!b || !b.cid) return;
  if (typeof BOOKS_REV === "number") BOOKS_REV++;      // the figures held for the top bar's redraws are worked out again (memoKeep, src/js/01)
  if (typeof Drafts === "object" && Drafts.hold("books:" + b.cid)) return;     // a settings section not saved yet (src/js/60)
  const keep = {cid: b.cid}; BOOKS_KEYS.forEach(k => { keep[k] = b[k]; });
  await Books.save(b.cid, keep);
  if (!(opts && opts.fromCloud) && typeof BookSync === "object") BookSync.schedule(b.cid);
}
// filed GST returns whose documents changed in Tally since: on every Books tab until the amendments are reported
// the books of a client (TDS & GST, MIS, Accounts, Audit, …): React (app/src/screens/Books.jsx)
function viewBooks(){ return '<div data-react="Books"></div>'; }

/* ---------- the day book through the bridge, month by month; the opening balances from FinCom's copy ---------- */
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
    if (!(await Bridge.ensureProven())) throw new Error("FinCom Bridge on this computer did not prove itself, so nothing was sent to it. Connect it again from the Tally page.");
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
    const before = (b.vouchers || []).filter(v => v.date >= from && v.date <= to);
    b.vouchers = (b.vouchers || []).filter(v => v.date < from || v.date > to).concat(res.vouchers);
    // an entry that Tally no longer sends for these dates, and that is not elsewhere in the books (moved to another date),
    // was deleted in Tally: it is kept, marked with the day FinCom saw it gone (request of 02-Oct-2026), and is marked back
    // (not removed) if Tally sends it again
    if (before.length || b.gone){
      const now = new Set(b.vouchers.map(v => v.id)), today = new Date().toISOString().slice(0, 10);
      b.gone = b.gone || {};
      before.forEach(v => { const g = b.gone[v.id]; if (v.id && !now.has(v.id) && !v.cancel && (!g || g.back)) b.gone[v.id] = {v, at: today, by: whoAmI()}; });
      Object.keys(b.gone).forEach(id => { if (now.has(id) && !b.gone[id].back) b.gone[id].back = today; });
    }
    const m = b.meta = b.meta || {};
    const g = new Set((m.gstins || []).concat(res.meta.gstins || []));
    m.gstins = Array.from(g).sort(); m.bills = 1; m.company = res.meta.company || m.company;
    m.from = !m.from || from < m.from ? from : m.from; m.to = !m.to || to > m.to ? to : m.to;
  },
  balances(b, j, from, to){
    const led = {};
    // a ledger whose name in Tally ends in a line break is named without it, as the day book's entries name it
    // (Books.unesc), so its balance and group meet its entries; two such names are one ledger (review of 01-Oct-2026)
    const nm = n => ledClean(n);
    [].concat(j.ledgers || []).forEach(l => {
      const k = nm(l.name), had = led[k];
      led[k] = {open: r2((had ? had.open : 0) + Books.amt(l.open)), close: r2((had ? had.close : 0) + Books.amt(l.close)), parent: (had && had.parent) || l.parent || ""};
    });
    b.tb = {from, to, at: new Date().toISOString(), led};
    Object.entries(led).forEach(([n, x]) => { if (x.parent) (b.under = b.under || {})[n] = (b.under[n] || ledClean(x.parent)); });
    this.yearOpen(b);
  },
  // review of 02-Oct-2026 (trade receivables 11,550 short): a copy of the books kept from before the names were cleaned
  // (here, and in the cloud by migration-23) still names "MCS Project Pvt Ltd&#13;&#10;" (6,000 Cr) and "RAKVIK
  // TECHNOLOGIES PRIVATE LIMITED&#13;&#10;&#13;&#10;" (17,550 Dr) in its balances, with no group: not debtors, so in other
  // current liabilities and assets. Every name kept with the books is cleaned once (ledClean, src/js/00), and two names
  // that become one are one ledger (balances added). Returns how many names changed
  cleanNames(b){
    if (!b) return 0;
    const bad = s => typeof s === "string" && /&|\r|\n|^\s|\s$/.test(s) && ledClean(s) !== s;
    let n = 0;
    const keys = (o, merge, val) => {
      if (!o || typeof o !== "object") return;
      Object.keys(o).forEach(k => {
        if (val && bad(o[k])){ o[k] = ledClean(o[k]); n++; }
        if (!bad(k)) return;
        const c = ledClean(k), v = o[k]; delete o[k]; n++;
        o[c] = o[c] == null ? v : merge ? merge(o[c], v) : (o[c] || v);
      });
    };
    const sum = (a, c) => { const out = Object.assign({}, a); ["open", "close", "openSent"].forEach(f => { if (a[f] != null || c[f] != null) out[f] = r2(num(a[f]) + num(c[f])); }); out.parent = a.parent || c.parent || ""; return out; };
    if (b.tb && b.tb.led){ keys(b.tb.led, sum); Object.values(b.tb.led).forEach(x => { if (x && bad(x.parent)){ x.parent = ledClean(x.parent); n++; } }); }
    keys(b.under, null, true); keys(b.groups, null, true);
    ["ledInfo", "map", "gstins", "states", "msme"].forEach(k => keys(b[k]));
    if (b.map) Object.entries(b.map).forEach(([k, m]) => { if (m && typeof m === "object" && m.n != null && m.n !== k && bad(m.n)) m.n = k; });
    if (b.fs && b.fs.map) keys(b.fs.map);
    (b.vouchers || []).forEach(v => {
      if (bad(v.party)){ v.party = ledClean(v.party); n++; }
      (v.ent || []).forEach(e => { if (bad(e.l)){ e.l = ledClean(e.l); n++; } });
    });
    // (names in the entries changed in place: a new array, so the save writes them: Books.touch, src/js/04)
    if (n){ b.mapV = (b.mapV || 0) + 1; Books.touch(b); if (typeof LK === "object") LK.cache = {}; }
    return n;
  },
  // review of 01-Oct-2026 (owner's go-ahead): at the start of a financial year, income and expense ledgers open at nil
  // and their total goes to Profit & Loss A/c, as Tally does. Balances taken as on 31 March (a trial balance file, the
  // cloud copy before its groups came) still carry last year's income and expenses. Needs the groups; what was read is
  // kept as openSent, so this can be done again whenever the groups or the balances change. The cloud copy does the same
  // (tally_year_openings, migration-8)
  NOMINAL: ["Sales Accounts", "Purchase Accounts", "Direct Incomes", "Direct Expenses", "Indirect Incomes", "Indirect Expenses"],
  primaryOf(b, n){
    const under = b.under || {}, groups = b.groups || {}, prim = s => !s || /^\W*Primary$/i.test(s);
    let p = ledUnder(b, n), last = "";
    for (let i = 0; !prim(p) && i < 30; i++){ last = p; p = ledLook(groups, p); }
    return last;
  },
  yearOpen(b){
    const tb = b && b.tb, led = tb && tb.led;
    if (!led || !Object.keys(b.groups || {}).length) return false;
    Object.values(led).forEach(x => { if (x.openSent == null) x.openSent = x.open; x.open = x.openSent; });
    if (!/0401$/.test(String(tb.from || ""))) return false;
    const PL = "Profit & Loss A/c", nominal = new Set(this.NOMINAL.map(g => g.toLowerCase()));   // Tally's group names in any capitals
    let moved = 0, n = 0;
    Object.entries(led).forEach(([name, x]) => {
      if (name === PL || !nominal.has(String(this.primaryOf(b, name) || "").trim().toLowerCase()) || !num(x.openSent)) return;
      moved = r2(moved + num(x.openSent)); x.open = 0; n++;
    });
    if (!n) return false;
    const pl = led[PL] = led[PL] || {open: 0, openSent: 0, close: 0, parent: ""};
    pl.open = r2(num(pl.openSent) + moved);
    return true;
  },
  // the opening balances on the books' first day, from FinCom's copy in the cloud (TCloud.openings: the view
  // tally_balances, else the ledger masters' openings or the cloud's trial balance on the day before), with each ledger's
  // closing worked out from the entries here. Without a copy in the cloud, the openings already here stay as they are.
  // Never an error: b.tb.line says "Balance from FinCom's copy · books as of 15:34"
  async openings(b, cid, from, to){
    let j = null;
    try { if (typeof TCloud === "object" && TCloud.on()){ b.busy = "Opening balances from FinCom\u2019s copy\u2026"; render(); j = await TCloud.openings(cid, from); } } catch (e){ j = null; }
    if (j && (j.ledgers || []).length){
      this.balances(b, j, from, to);
      if (typeof MIS === "object"){ const mv = MIS.moves(b.tb.from, b.tb.to); Object.entries(b.tb.led).forEach(([l, x]) => { x.close = r2(num(x.open) + ((mv[l] || {}).t || 0)); }); }
      // next-mis-speed: a copy only when the copy's balances were taken here (its closings FinCom's own: no check, MIS)
      b.tb.src = "copy"; b.tb.line = copyLine(cid);
    }
    return j;
  },
  // after the books changed (read from Tally, changes brought in from the kept copy or the cloud, a day book file):
  // every section follows. Screens work from the entries as they are; audit and MIS are worked out again for the
  // period they last covered. A filed GST return is never changed: when its documents changed in Tally, a warning
  // names the return (and its ARN) and the return the changes go in as amendments
  after(b, why, range){
    b.reco = null; if (typeof GSTR === "object") GSTR._carry = null;
    try { this.cleanNames(b); } catch (e){}
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
    // the opening balances: from FinCom's copy (FinCom Bridge 2.1.4 asks Tally for no balance, and the bridge is not
    // asked for its own copy's either; owner's decision of 02-Oct-2026); the closing figures follow from the entries
    const j = await this.openings(b, co.id, from, to);
    b.map = Books.mapLedgers(b.vouchers, b.map); LedMaster.refresh(b);
    b.meta.at = new Date().toISOString(); b.meta.file = how === "copy" ? "last night's copy from Tally" : "read from Tally";
    b.busy = "";
    this.after(b, how === "copy" ? "after last night's copy was read" : "after reading from Tally", {from: (j && j.from) || from, to: (j && j.to) || to});
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
  const all = LedMaster.pending(S.books).length;
  toast(all + " ledger" + (all === 1 ? " is" : "s are") + " still to be confirmed, " + (p.length === all ? "and this file uses them" : p.length + " of them used by this file") + ". Confirm them first, so the file is right.");
  S.booksTab = "ledgers"; S.lmView = "pending"; render();
  return false;
}

/* ---------- TDS, the way TDS software is laid out: year, then quarter, then the return, then its tabs ---------- */
function tdsYears(b, rows){
  return Array.from(new Set(rows.map(r => r.fy).concat((b.salary || []).map(r => TDS.fyOf(r.date))).concat(TDS.challans().map(c => TDS.fyOf(c.date)))
    .concat(typeof Payroll === "object" ? Payroll.data().allocs.map(a => TDS.fyOf(a.day)) : [])     // bridge 2.4.4: Tally's payroll
    .concat(TDS.salaryRows().map(r => r.fy))))     // round 92: salary TDS in the books (192) alone is TDS here too
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


// the quick periods count from today in India (smart moves round 1, the owner's choice of 09-Oct-2026: MIS opens on this
// financial year to date); when the books end earlier, the MIS page says so in one line with Read from Tally
function misRangeQuick(k, b){
  const t = typeof istToday === "function" ? istToday() : Audit.today(), end = t;
  const d = new Date(Audit.iso(end) + "T00:00:00"), ymd = x => x.getFullYear() + String(x.getMonth() + 1).padStart(2, "0") + String(x.getDate()).padStart(2, "0");
  if (k === "month") return {from: end.slice(0, 6) + "01", to: end};
  if (k === "lastmonth"){ const pm = new Date(d.getFullYear(), d.getMonth(), 0); return {from: ymd(pm).slice(0, 6) + "01", to: ymd(pm)}; }
  if (k === "quarter"){ const qm = Math.floor(d.getMonth() / 3) * 3; return {from: ymd(new Date(d.getFullYear(), qm, 1)), to: end}; }
  if (k === "ytd") return {from: Audit.fyStart(end), to: end};
  if (k === "lastyear"){ const fs = Audit.fyStart(t), y = num(fs.slice(0, 4)); return {from: (y - 1) + "0401", to: y + "0331"}; }   // the last complete financial year
  return null;
}
// the MIS pack and Excel (misPackHtml, misExcel) are src/js/18-mis-pack.js; GSTR-9's PDF and Excel (gst9PackHtml, gst9Excel) src/js/08: each comes with its screen

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
      .concat([["inreg", "Input register"], ["r2b", "2B reconciliation"], ["itcfinal", "Final credit for 3B"], ["adv", "Advances"], ["rev", "Reversal"], ["amend", "Amendments"], ["g9", "GSTR-9"], ["g9c", "GSTR-9C"]]);
  // tax-accuracy: the filed GSTR-1 and 3B (fetched from the portal) against FinCom's working, month by month
  if (ftype !== "comp") parts.push(["filedcmp", "Filed vs FinCom"]);
  // request of 02-Oct-2026: the books invoice by invoice against the returns filed and 2B, for the year
  if (ftype !== "comp") parts.push(["recon", "Filed vs books"]);
  parts.push(["vault", "Returns filed"]);
  if (AIH.enabled("notices")) parts.push(["notices", "Notices"]);
  // without the day book only what does not come from it: 2B (from the portal or its JSON) and the returns filed
  if (noBooks) parts.splice(0, parts.length, ["r2b", "2B"], ["vault", "Returns filed"]);
  if (noBooks && AIH.enabled("notices")) parts.push(["notices", "Notices"]);
  return {parts, ftype, regs, noBooks};
}
// one part of the GST tab, as the old pages draw it
function gstPartGo(id){ S.gstPart = id; S.gstView = "return"; S.gstSub = ""; render(); }
function gstSetYm(ym){ S.gstYm = ym; Smart.keep("gst", {ym}); S.books.reco = null; render(); }
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
  // next-fix-toggles: Eligible? set by a person on the bill's line (app/src/lib/itcFinal.js) is the bill's kind, over
  // Tally's 17(5) mark (kept as r.blocked, shown as a note); tax booked to an ineligible ledger stays as booked
  const els = new Map(); if (typeof ITCF === "object") ITCF.rows(reg).forEach(x => { if (!x.fixed && x.s && x.s.el) (x.docs || []).forEach(d => els.set(d.id, x.e.el)); });
  rows.forEach(r => {
    r.kindL = r.import ? (r.supply === "Goods" ? "Import of goods" : "Import of services") : r.rcm ? "Reverse charge" : r.blocked || r.ineligible ? "Not to be taken" : r.dir < 0 ? "Credit reduced" : "Eligible";
    const el = els.get(r.id); if (el && !r.import && !r.rcm && !r.ineligible){ r.elSet = el; r.kindL = el !== "eligible" ? "Not to be taken" : r.dir < 0 ? "Credit reduced" : "Eligible"; }
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
// books-speed: the top bar's news is drawn with the figures of the last drawing when the books did not change (memoKeep)
function renderTop(){ if (window.FinComReact) FinComReact.redraw({keep: true}); }

/* ---------- Home: client list ---------- */
/* ---------- Home: unsorted uploads ---------- */
// the unsorted uploads are React (app/src/parts/Unsorted.jsx)
function viewInbox(){ return '<div data-react="Unsorted"></div>'; }

/* ---------- Home: firm-wide rates ---------- */
function viaPlatform(){ return Cloud.on() && !!S.account && !S.account.superadmin && !apiSettings().key; }
// everything sent to Tally: React (app/src/screens/Done.jsx)
function viewPostLog(){ return '<div data-react="PostLog"></div>'; }
function postLogCsv(){
  const log = (S.firm.postLog || []).slice().reverse();
  const rows = [["When", "What", "Action", "Client", "Reference", "Party", "Amount", "Voucher type", "Tally id", "Company", "By"]].concat(
    log.map(r => [r.at, r.what || "", r.action || "", (CO(r.co) || {}).name || "", r.ref || "", r.party || "", r.amount || "", (r.tally || {}).vchType || "", (r.tally || {}).masterId || "", (r.tally || {}).company || "", r.by || ""]));
  saveFile("posted-to-tally-" + new Date().toISOString().slice(0, 10) + ".csv", new Blob([rows.map(r => r.map(c => '"' + csvTxt(c).replace(/"/g, '""') + '"').join(",")).join("\n")], {type: "text/csv"}));
}
// the TDS rates and limits for all clients (the firm's name is in Settings → Firm details)
// Settings for the firm: React (app/src/screens/Settings.jsx)
function viewRules(){ return '<div data-react="FirmSettings"></div>'; }

/* ---------- Client: invoices ---------- */
/* ---------- all drafts in one table (for uploads of many bills) ---------- */
// hang-invoices: worked out once per drawing (perRender, src/js/01; the review table, its bar, the top bar and the column
// filters each asked for it), fresh outside a drawing (an action on the rows)
function draftRows(){
  const cid = S.coId;
  return perRender(draftRows, cid + "|" + ENTRY_REV, () => Object.values(D().entries).filter(e => e.status === "draft").sort(byDate).map(e => {
    const c = compute(e, cid);
    return {e, c};
  }));
}
function drawerEntry(){
  if (!S.drawerOpen || S.view !== "company" || S.tab !== "invoices" || !S.reviewTable || S.filter !== "draft") return null;
  const e = S.selected && D().entries[S.selected];
  if (!e || (e.status !== "draft" && e.status !== "duplicate")){ S.drawerOpen = false; return null; }
  return e;
}
// the drawer with a bill, over the review table: React (app/src/screens/Review.jsx)
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
  // "TDS on" for many bills books TDS where it is due; a bill below the limits stays without TDS
  // (deducting there is a per-bill choice, "Deduct anyway", with who and why recorded: review item 3)
  if (on){ e.tdsSkip = null; if (c.skip && c.skip.from !== "bill") e.tdsForce = true; }
  else { e.tdsForce = false; e.tdsAlways = false; e.tdsAlwaysBy = ""; if (c.tdsWould > 0) e.tdsSkip = e.tdsSkip || "pay"; }
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
