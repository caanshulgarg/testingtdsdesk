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
  setTimeout(() => { try { if (S.books && S.books.cid === cid){ Audit.maybeRun(); MIS.maybeRun(); } } catch (e){} }, 400);
  render();
}
async function saveBooks(){ const b = S.books; if (b && b.cid) await Books.save(b.cid, {cid: b.cid, vouchers: b.vouchers, map: b.map, meta: b.meta, challans: b.challans, alloc: b.alloc, pans: b.pans, twoB: b.twoB,
  gstins: b.gstins, under: b.under, states: b.states, groups: b.groups, salary: b.salary, certs: b.certs, advFix: b.advFix, assets: b.assets, rev: b.rev,
  filed: b.filed, amendFix: b.amendFix, twoBs: b.twoBs, reco2b: b.reco2b, ledInfo: b.ledInfo, ledInfoAt: b.ledInfoAt,
  audit: b.audit, auditCfg: b.auditCfg, auditRel: b.auditRel, ledSnaps: b.ledSnaps, gst9c: b.gst9c, groupInfo: b.groupInfo, fs: b.fs, tb: b.tb, mis: b.mis, misCfg: b.misCfg, msme: b.msme, budget: b.budget,
  gst3b: b.gst3b, gst9: b.gst9, gstOpen: b.gstOpen, itcBasis: b.itcBasis, itcTrack: b.itcTrack, outRej: b.outRej, gstFiled: b.gstFiled, gstAato: b.gstAato, filed1a: b.filed1a, rule37On: b.rule37On, gstCashLedger: b.gstCashLedger, gstSet: b.gstSet, gstContacts: b.gstContacts, gstApi: b.gstApi, gstEst: b.gstEst, gstVault: b.gstVault}); }
function viewBooks(){
  const co = CO();
  if (!S.books || S.books.cid !== co.id){ openBooks(co.id); return '<p class="note">Opening the books…</p>'; }
  const b = S.books, tab = booksTab(), n = (b.vouchers || []).length;
  let h = '<nav class="sbar" aria-label="Books">' + [["import", "From Tally", n || null], ["ledgers", "Tally ledgers", n ? (LedMaster.pending(b).length ? LedMaster.pending(b).length + " to confirm" : "\u2713") : null], ["tds", "TDS", n ? TDS.rows().length : ((b.salary || []).length || null)], ["gst", "GST", null], ["mis", "MIS", null], ["fs", "Accounts", null], ["audit", "Audit", b.audit && b.audit.last ? (b.audit.last.findings.filter(f => f.sev === "high" && Audit.status(f.id).s === "open").length || null) : null]]
    .map(([id, label, c]) => '<button data-bookstab="' + id + '" aria-selected="' + (tab === id) + '">' + label + (c == null ? "" : ' <span class="sbar-n">' + c + "</span>") + "</button>").join("") + "</nav>";
  if (b.busy) h += busyCard("Reading the books…", b.busy, 0, 0);
  if (tab === "import") h += viewBooksImport(b);
  else if (!n && !(tab === "tds" && (b.salary || []).length)) h += '<div class="bk-none">Bring the day book in first, under “From Tally”. Salary for 24Q can be brought in on its own, under TDS.</div>';
  else if (!n && tab === "tds") h += viewBooksTds(b);
  else if (tab === "ledgers") h += viewBooksLedgers(b);
  else if (tab === "tds") h += viewBooksTds(b);
  else if (tab === "audit") h += viewBooksAudit(b);
  else if (tab === "mis") h += viewBooksMis(b);
  else if (tab === "fs") h += viewBooksAccounts(b);
  else h += viewBooksGst(b);
  return h;
}

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
  // read a period: each month's day book, then the balances
  async read(from, to, how){
    const b = S.books, co = CO(), name = Bridge.openFor(co).name, q = "?company=" + encodeURIComponent(name) + Bridge.pinQ();
    const ms = this.months(from, to);
    for (let i = 0; i < ms.length; i++){
      const x = ms[i];
      b.busy = "Reading " + GSTR.label(x.ym) + " from Tally (" + (i + 1) + " of " + ms.length + ")\u2026"; render();
      const text = how === "copy" ? await this.raw("/syncfile" + q + "&file=daybook-" + x.ym + ".xml") : await this.raw("/daybook" + q + "&from=" + x.from + "&to=" + x.to);
      const res = await Books.importDayBook(new Blob([text], {type: "text/xml"}));
      this.merge(b, res, x.from, x.to);
    }
    b.busy = "Reading the balances from Tally\u2026"; render();
    const j = how === "copy" ? JSON.parse(await this.raw("/syncfile" + q + "&file=balances.json")) : await Bridge.call("/balances" + q + "&from=" + from + "&to=" + to, null, 600000);
    this.balances(b, j, j.from || from, j.to || to);
    b.map = Books.mapLedgers(b.vouchers, b.map); LedMaster.refresh(b);
    b.meta.at = new Date().toISOString(); b.meta.file = how === "copy" ? "last night's copy from Tally" : "read from Tally";
    b.busy = ""; b.reco = null;
    if (Audit.cfg(b).freq !== "off"){ try { Audit.run(j.from || from, j.to || to, how === "copy" ? "after last night's copy was read" : "after reading from Tally"); } catch (e){} }
    await saveBooks();
    return b.vouchers.length;
  }
};
function viewTallyRead(b){
  const co = CO(), live = typeof bridgeLive === "function" && bridgeLive(co);
  const t = Audit.today(), r = S.tallyRange || {from: Audit.iso(Audit.fyStart(t)), to: Audit.iso(t)};
  const cp = S.tallyCopy || null;
  let h = '<section class="dash-card" style="max-width:760px;margin-bottom:12px"><h3>Straight from Tally</h3>';
  if (!live) return h + '<p class="note">With the Tally Bridge running and this company open in Tally, the day book and Tally\u2019s own balances are read here directly, month by month \u2014 no exporting. Set it up under Settings \u2192 Tally Bridge.</p></section>';
  const bv = String((Bridge.st && Bridge.st.version) || ""), vnum = v2 => v2.split(".").map(x => String(num(x)).padStart(3, "0")).join(".");
  if (bv && vnum(bv) < vnum("1.10.0")) return h + '<p class="note">The Tally Bridge on this computer is ' + esc(bv) + '. Reading straight from Tally, the nightly copy and the FVU check need <b>1.10</b>: download it under Settings \u2192 Tally Bridge and run the setup on the Tally computer.</p></section>';
  h += '<p class="note">Reads every voucher of the period, and each ledger\u2019s balance as Tally works it out, from <b>' + esc(Bridge.openFor(co).name) + "</b>.</p>" +
    '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><label class="note">From <input type="date" data-tallyfrom value="' + esc(r.from) + '"></label><label class="note">to <input type="date" data-tallyto value="' + esc(r.to) + '"></label>' +
    '<button class="btn primary" data-act="tallyRead">Read from Tally</button></div>' +
    '<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px"><b>Every night</b><p class="note">The bridge on the Tally server copies each open company\u2019s day book and balances at night, so in the morning they are read in seconds and the audit is ready. The companies have to be open in Tally at that hour.</p>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><button class="btn small" data-act="tallyCopyCheck">See last night\u2019s copy</button>' +
    '<label class="note">at <input type="time" data-tallytime value="' + esc((cp && cp.time) || "02:00") + '" style="width:110px"></label>' +
    '<button class="btn small" data-act="tallyScheduleOn">Copy every night</button><button class="btn small" data-act="tallyScheduleOff">Stop</button></div>' +
    (cp ? '<div class="note" style="margin-top:6px">' + (cp.error ? '<span class="bad">' + esc(cp.error) + "</span>" : cp.none ? "No copy for this company yet." :
      "Copy made " + esc(String(cp.at || "").replace("T", " ").slice(0, 16)) + " for " + fmtDate(tallyDate(cp.from)) + " to " + fmtDate(tallyDate(cp.to)) + ", " + (cp.months || []).length + ' months. <button class="btn small primary" data-act="tallyCopyUse">Use it</button>') +
      (cp.schedule ? " \u00b7 Nightly: " + (cp.schedule.on ? "on, next " + esc(cp.schedule.next || "") : "off") : "") + "</div>" : "") + "</div></section>";
  return h;
}
function viewBooksImport(b){
  const m = b.meta || {};
  return viewTallyRead(b) + '<section class="dash-card" style="max-width:760px"><h3>Or bring in files exported from Tally</h3>' +
    '<p class="note">In Tally: <b>Display → Day Book</b>, set the period, then <b>Export</b> as XML. For the deductees’ PAN, also export <b>Display → List of Accounts</b> as XML. Nothing is sent anywhere; both are read on this computer.</p>' +
    '<div class="row" style="gap:8px;margin:10px 0"><button class="btn primary" data-act="booksPick">Choose the day book XML</button>' +
    '<button class="btn" data-act="mastersPick">Choose the ledger masters XML</button>' +
    (b.vouchers && b.vouchers.length ? '<button class="btn small" data-act="booksClear">Remove what is here</button>' : "") + "</div>" +
    (b.vouchers && b.vouchers.length
      ? '<div class="dash-row"><span>Vouchers</span><b>' + b.vouchers.length + "</b></div>" +
        '<div class="dash-row"><span>Period</span><b>' + fmtDate(tallyDate(m.from)) + " to " + fmtDate(tallyDate(m.to)) + "</b></div>" +
        '<div class="dash-row"><span>Registrations in the file</span><b>' + esc((m.gstins || []).join(", ") || "—") + "</b></div>" +
        '<div class="dash-row"><span>Read on</span><b>' + esc(m.at ? fmtDate(String(m.at).slice(0, 10)) : "—") + "</b></div>" +
        '<div class="dash-row"><span>Ledger masters</span><b>' + (Object.keys(b.pans || {}).length ? Object.keys(b.pans).length + " with PAN, " + Object.keys(b.gstins || {}).length + " with GSTIN" : "not brought in yet") + "</b></div>"
      : '<p class="note">Nothing here yet.</p>') + "</section>";
}
function tallyDate(s){ return s && String(s).length === 8 ? String(s).slice(0, 4) + "-" + String(s).slice(4, 6) + "-" + String(s).slice(6, 8) : ""; }
function viewBooksLedgers(b){
  const regs = ((b.meta && b.meta.gstins) || []).map(g => g.slice(0, 2)), info = b.ledInfo || {};
  const all = Object.entries(b.map || {});
  const isTax = ([n, m]) => LedMaster.taxLike(n, m, info[n]);
  const gst = all.filter(([n, m]) => LedMaster.isGst(m.what) && isTax([n, m])), tds = all.filter(([n, m]) => LedMaster.isTds(m.what) && isTax([n, m]));
  const pend = LedMaster.pending(b), other = all.filter(x => !isTax(x));
  const view = S.lmView || (pend.length ? "pending" : "gst");
  const q = String(S.ledQ || "").toLowerCase();
  const pool = {pending: pend, gst, tds, done: all.filter(([n, m]) => m.ok && isTax([n, m])), other}[view] || pend;
  const shown = pool.filter(([n, m]) => !q || n.toLowerCase().includes(q) || String(m.section || "").toLowerCase().includes(q) || String((info[n] || {}).group || "").toLowerCase().includes(q))
    .sort((a, c) => (LedMaster.isGst(a[1].what) ? 0 : 1) - (LedMaster.isGst(c[1].what) ? 0 : 1) || (c[1].n || 0) - (a[1].n || 0) || a[0].localeCompare(c[0]));
  const fromTally = Object.keys(info).length;
  const live = typeof bridgeLive === "function" && bridgeLive(CO());
  let h = '<section class="dash-card" style="margin-bottom:12px"><h3>GST and TDS ledgers: confirm once for this client</h3>' +
    '<p class="note">Each ledger is guessed from Tally \u2014 its tax type, duty head and group \u2014 and from how the day book uses it. Check the guess and confirm it. Returns count only confirmed ledgers; anything still to confirm is shown on the TDS and GST screens, and their files wait until it is done.</p>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
    '<button class="btn small' + (live ? " primary" : "") + '" data-act="ledRead"' + (live ? "" : ' title="Needs the Tally Bridge and this company open in Tally"') + ">Read ledgers from Tally</button>" +
    '<span class="note">' + (fromTally ? fromTally + " ledgers read from Tally" + (b.ledInfoAt ? " on " + fmtDate(String(b.ledInfoAt).slice(0, 10)) : "") : live ? "not read yet" : "Tally is not connected; the ledger masters XML under \u201cFrom Tally\u201d does the same") + "</span></div>" +
    '<div class="dash-tiles" style="margin-top:10px">' +
    '<button class="dtile' + (pend.length ? " warn" : "") + '" data-lmview="pending" style="text-align:left"><span>To confirm</span><b>' + pend.length + "</b><small>" + (pend.length ? "returns wait for these" : "all done") + "</small></button>" +
    '<button class="dtile" data-lmview="gst" style="text-align:left"><span>GST ledgers</span><b>' + gst.length + "</b><small>" + gst.filter(x => x[1].ok).length + " confirmed</small></button>" +
    '<button class="dtile" data-lmview="tds" style="text-align:left"><span>TDS and TCS ledgers</span><b>' + tds.length + "</b><small>" + tds.filter(x => x[1].ok).length + " confirmed</small></button>" +
    '<button class="dtile" data-lmview="other" style="text-align:left"><span>Other ledgers</span><b>' + other.length + "</b><small>add one to GST or TDS</small></button></div></section>";
  h = ledChangedBanner(b) + h;
  h += '<nav class="sbar" aria-label="Ledgers">' + [["pending", "To confirm", pend.length], ["gst", "GST", gst.length], ["tds", "TDS and TCS", tds.length], ["done", "Confirmed", null], ["other", "Other ledgers", other.length], ["post", "What TDS Desk posts to", null]]
    .map(([id, l, c]) => '<button data-lmview="' + id + '" aria-selected="' + (view === id) + '">' + l + (c != null ? ' <span class="sbar-n">' + c + "</span>" : "") + "</button>").join("") + "</nav>";
  if (view === "post") return h + viewLedPosting(b);
  h += '<div class="revfilter" style="flex-wrap:wrap;row-gap:6px"><input type="search" id="ledq" data-fk="ledq" data-keeptyped value="' + esc(S.ledQ || "") + '" placeholder="Find a ledger, section or group" style="width:260px;flex:0 0 auto">' +
    '<span class="note">' + shown.length + " ledger" + (shown.length === 1 ? "" : "s") + "</span>" +
    (view !== "other" && shown.some(([, m]) => !m.ok) ? '<button class="btn small primary" data-act="lmConfirmShown">Confirm the ' + shown.filter(([, m]) => !m.ok).length + " shown</button>" : "") + "</div>";
  const whatSel = (n, m) => '<select style="width:auto;min-width:180px" data-lmwhat="' + esc(n) + '">' + (view === "other" ? '<option value="">\u2014</option>' : "") +
    '<optgroup label="GST">' + LedMaster.WHAT.filter(w => LedMaster.isGst(w[0])).map(w => '<option value="' + w[0] + '"' + (m.what === w[0] ? " selected" : "") + ">" + w[1] + "</option>").join("") + "</optgroup>" +
    '<optgroup label="TDS and TCS">' + LedMaster.WHAT.filter(w => LedMaster.isTds(w[0]) || w[0] === "tds_interest").map(w => '<option value="' + w[0] + '"' + (m.what === w[0] ? " selected" : "") + ">" + w[1] + "</option>").join("") + "</optgroup>" +
    '<optgroup label="Other">' + LedMaster.WHAT.filter(w => ["bank", "roundoff", "none"].includes(w[0])).map(w => '<option value="' + w[0] + '"' + ((m.what || (view === "other" ? "" : "none")) === w[0] && view !== "other" ? " selected" : "") + ">" + w[1] + "</option>").join("") + "</optgroup></select>";
  const detail = (n, m) => {
    if (LedMaster.isGst(m.what) && !/^gst_(setoff|interest|control)$/.test(m.what)) return '<span style="display:flex;gap:4px;flex-wrap:nowrap">' +
      '<select style="width:auto" data-lmtax="' + esc(n) + '">' + ["IGST", "CGST", "SGST", "CESS"].map(x => '<option' + (m.tax === x ? " selected" : "") + ">" + x + "</option>").join("") + "</select>" +
      '<select style="width:auto" data-lmside="' + esc(n) + '"><option value="input"' + (m.side === "input" ? " selected" : "") + '>input</option><option value="output"' + (m.side === "output" ? " selected" : "") + ">output</option></select>" +
      (regs.length > 1 ? '<select style="width:auto" data-lmreg="' + esc(n) + '"><option value="">registration?</option>' + regs.map(r => '<option value="' + r + '"' + (m.reg === r ? " selected" : "") + ">" + r + "</option>").join("") + "</select>" : "") +
      '<select style="width:auto" data-lmgrate="' + esc(n) + '" title="Only if this ledger is for one rate"><option value="">any rate</option>' + LedMaster.RATES.map(r => '<option value="' + r + '"' + (num(m.gstRate) === r ? " selected" : "") + ">" + r + "%</option>").join("") + "</select></span>";
    if (LedMaster.isGst(m.what) && regs.length > 1) return '<select style="width:auto" data-lmreg="' + esc(n) + '"><option value="">registration?</option>' + regs.map(r => '<option value="' + r + '"' + (m.reg === r ? " selected" : "") + ">" + r + "</option>").join("") + "</select>";
    if (m.what === "tds_payable" || m.what === "tcs_payable") return '<span style="display:flex;gap:4px"><input type="text" data-lmsec="' + esc(n) + '" data-fk="lmsec-' + esc(n) + '" value="' + esc(m.section || "") + '" placeholder="' + (m.what === "tcs_payable" ? "206C(1H)" : "194C") + '" style="width:90px">' +
      '<input type="number" step="0.01" min="0" data-lmrate="' + esc(n) + '" value="' + esc(m.rate == null ? "" : m.rate) + '" placeholder="rate %" style="width:80px"></span>';
    return "";
  };
  h += '<div class="bk-tablewrap"><table class="bk-table" id="lmTable"><thead><tr><th>Tally ledger</th><th>What it is</th><th>Head, side, registration, rate or section</th><th class="n">Used</th><th>Why, and checks</th><th class="ac">Confirmed</th></tr></thead><tbody>' +
    shown.slice(0, 400).map(([n, m]) => {
      const warn = LedMaster.checks(b, n, m), inf = info[n] || {};
      return "<tr><td>" + esc(n) + (inf.group ? '<div class="nr">' + esc(inf.group) + (inf.taxType && !/^(others|not applicable)$/i.test(String(inf.taxType).replace(/[^A-Za-z ]/g, "").trim()) ? " \u00b7 Tally: " + esc(inf.taxType) + (inf.dutyHead ? " " + esc(inf.dutyHead) : "") : "") + "</div>" : "") +
        "</td><td>" + whatSel(n, m) + "</td><td>" + detail(n, m) + '</td><td class="n">' + (m.n || 0) + "</td>" +
        '<td style="min-width:200px">' + (m.why ? '<div class="nr" style="white-space:normal">' + esc(m.why) + "</div>" : "") + warn.map(w => '<div class="nr bad" style="white-space:normal">' + esc(w) + "</div>").join("") + "</td>" +
        '<td class="ac">' + (view === "other" ? "" : m.ok ? '<button class="linkbtn" data-lmok="' + esc(n) + '" title="Undo">\u2713 confirmed</button>' : '<button class="btn small" data-lmok="' + esc(n) + '">Confirm</button>') + "</td></tr>";
    }).join("") + "</tbody></table>" + (shown.length > 400 ? '<p class="note">The first 400 are shown; find the rest by name.</p>' : "") + (shown.length ? "" : '<div class="bk-none">' + (view === "pending" ? "Every GST and TDS ledger is confirmed." : "Nothing here.") + "</div>") + "</div>";
  h += '<p class="note">Add a ledger that was missed from \u201cOther ledgers\u201d by choosing what it is. Several ledgers for one head are fine \u2014 reverse-charge ledgers, or one ledger per rate. To take a ledger out, choose \u201cNot a tax ledger\u201d.</p>';
  return h;
}
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
function tdsCrumbs(){
  const v = S.tdsView, parts = ['<button class="linkbtn" data-tdsnav="years">TDS</button>'];
  if (S.tdsFy && v !== "years") parts.push('<button class="linkbtn" data-tdsnav="year">' + esc(S.tdsFy) + "</button>");
  if (v === "certs") parts.push("<b>Certificates and rate questions</b>");
  if (v === "return") parts.push("<b>" + esc(S.tdsQ) + " \u00b7 " + esc(S.tdsForm) + "</b>");
  return '<div class="tds-crumbs" style="display:flex;gap:8px;align-items:center;margin:0 0 12px;font-size:15px">' + parts.join('<span class="note">\u203a</span>') + "</div>";
}
function viewBooksTds(b){
  const rows = TDS.rows(), fys = tdsYears(b, rows);
  if (!S.tdsView) S.tdsView = fys.length === 1 ? "year" : "years";
  if ((S.tdsView === "year" || S.tdsView === "return" || S.tdsView === "certs") && !fys.includes(S.tdsFy)) S.tdsFy = fys[0] || "";
  if (!S.tdsFy && S.tdsView !== "years") S.tdsView = "years";
  let h = ledgerBanner(b, "tds") + tdsCrumbs();
  if (S.tdsView === "years") return h + viewTdsYears(b, rows, fys);
  if (S.tdsView === "certs") return h + viewTdsCerts(b);
  if (S.tdsView === "return") return h + (S.tdsForm === "24Q" ? viewTdsReturn24(b) : viewTdsReturn26(b, rows));
  return h + viewTdsYearPage(b, rows);
}
function viewTdsYears(b, rows, fys){
  const money = v => INR.format(r2(v || 0));
  if (!fys.length) return '<div class="bk-none">Bring in the day book, or a salary sheet under 24Q, and the years appear here.</div>' +
    '<div class="row" style="gap:8px;margin-top:10px"><button class="btn small primary" data-act="salaryPick">Bring in the salary sheet</button></div>';
  return '<section class="dash-card"><h3>Choose the financial year</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Year</th><th class="n">Deductions</th><th class="n">TDS</th><th class="n">Challans</th><th class="n">Not against a challan</th><th class="n">Without PAN</th><th class="n">Salary employees</th><th class="ac"></th></tr></thead><tbody>' +
    fys.map(fy => {
      const r = rows.filter(x => x.fy === fy), ch = TDS.challans().filter(c => TDS.fyOf(c.date) === fy);
      const emp = new Set(TDS24Q.rows().filter(x => TDS.fyOf(x.date) === fy).map(x => x.pan || x.name)).size;
      const un = r2(r.filter(x => !x.challan).reduce((a, x) => a + x.tds, 0));
      return '<tr><td><button class="linkbtn" data-tdsgo="' + fy + '"><b>' + esc(fy) + '</b></button></td><td class="n">' + r.length + '</td><td class="n">' + money(r.reduce((a, x) => a + x.tds, 0)) +
        '</td><td class="n">' + ch.length + '</td><td class="n' + (un ? " bad" : "") + '">' + (un ? money(un) : "\u2014") + '</td><td class="n' + (r.some(x => !Certs.validPan(x.pan)) ? " bad" : "") + '">' +
        r.filter(x => !Certs.validPan(x.pan)).length + '</td><td class="n">' + (emp || "\u2014") + '</td><td class="ac"><button class="btn small" data-tdsgo="' + fy + '">Open</button></td></tr>';
    }).join("") + "</tbody></table></div></section>";
}
function viewTdsYearPage(b, rows){
  const fy = S.tdsFy, money = v => INR.format(r2(v || 0)), qs = TDSYear.quarters(fy);
  const cell = (x, form) => {
    if (form === "26Q"){
      if (!x.deductions && !x.challans) return '<td class="note">nothing</td>';
      return '<td><button class="linkbtn" data-tdsgo="' + fy + "|" + x.q + '|26Q"><b>' + money(x.tds) + "</b></button>" +
        '<div class="nr">' + x.deductions + " deductions \u00b7 " + x.challans + " challan" + (x.challans === 1 ? "" : "s") + "</div>" +
        ((x.unallocated || x.noPan || x.issues) ? [x.unallocated ? money(x.unallocated) + " not against a challan" : "", x.noPan ? x.noPan + " without PAN" : "", x.issues ? x.issues + " rate question" + (x.issues === 1 ? "" : "s") : ""].filter(Boolean).map(w => '<div class="nr bad" style="white-space:normal">' + w + "</div>").join("") : '<div class="nr">ready</div>') + "</td>";
    }
    const inBooks = TDS.salaryRows().filter(r => r.fy === fy && r.q === x.q), booksTds = r2(inBooks.reduce((a, r) => a + r.tds, 0));
    if (!x.salaryEmployees) return "<td>" + (booksTds ? '<button class="linkbtn" data-tdsgo="' + fy + "|" + x.q + '|24Q"><b>' + money(booksTds) + '</b></button><div class="nr">in the books under 192</div>' : "") +
      '<div class="nr">' + ((b.salary || []).length ? (booksTds ? "" : "nothing") : '<button class="linkbtn" data-tdsgo="' + fy + "|" + x.q + '|24Q">bring in the salary sheet</button>') + "</div></td>";
    return '<td><button class="linkbtn" data-tdsgo="' + fy + "|" + x.q + '|24Q"><b>' + money(x.salaryTds) + '</b></button><div class="nr">' + x.salaryEmployees + " employee" + (x.salaryEmployees === 1 ? "" : "s") + "</div></td>";
  };
  let h = '<div class="revfilter"><select data-tdsfy>' + tdsYears(b, rows).map(f => '<option value="' + f + '"' + (fy === f ? " selected" : "") + ">" + f + "</option>").join("") + "</select>" +
    '<button class="btn small" data-tdsnav="certs">Certificates and rate questions</button>' +
    '<button class="btn small" data-act="yearExcel26">Download the year, 26Q</button><button class="btn small" data-act="yearExcel24">Download the year, 24Q</button>' +
    '<button class="btn small primary" data-act="yearExcelAll">Download the whole year</button></div>';
  h += '<section class="dash-card"><h3>' + esc(fy) + ": returns by quarter</h3>" +
    '<p class="note">Open a return to see its challans, deductees and deductions on separate tabs.</p>' +
    '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Quarter</th><th>26Q, other than salary</th><th>24Q, salary</th><th>Due</th></tr></thead><tbody>' +
    qs.map(x => {
      const due = {Q1: "31 Jul", Q2: "31 Oct", Q3: "31 Jan", Q4: "31 May"}[x.q];
      return "<tr><td><b>" + x.q + '</b><div class="nr">' + {Q1: "Apr to Jun", Q2: "Jul to Sep", Q3: "Oct to Dec", Q4: "Jan to Mar"}[x.q] + "</div></td>" + cell(x, "26Q") + cell(x, "24Q") + "<td>" + due + "</td></tr>";
    }).join("") +
    '<tr><td><b>Year</b></td><td><b>' + money(qs.reduce((a, x) => a + x.tds, 0)) + '</b><div class="nr">' + qs.reduce((a, x) => a + x.deductions, 0) + " deductions</div></td><td><b>" +
    money(qs.reduce((a, x) => a + x.salaryTds, 0)) + "</b></td><td></td></tr></tbody></table></div></section>";
  return h;
}
// one filter bar for every tab of a return; each tab keeps its own filters
function tdsFilterBar(tab, opts){
  const f = ((S.tdsFl || {})[tab]) || {};
  return '<div class="revfilter" style="flex-wrap:wrap;row-gap:6px"><input type="search" data-tdsf="q" data-fk="tdsf-' + tab + '" data-keeptyped value="' + esc(f.q || "") + '" placeholder="' + esc(opts.placeholder) + '" style="width:260px;flex:0 0 auto">' +
    (opts.selects || []).map(sel => '<select style="width:auto;flex:0 0 auto" data-tdsf="' + sel.key + '" aria-label="' + esc(sel.label || sel.key) + '">' + sel.options.map(([v, l]) => '<option value="' + esc(v) + '"' + ((f[sel.key] || "") === v ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select>").join("") +
    '<span class="note">' + esc(opts.count || "") + "</span>" +
    (Object.keys(f).some(k => f[k]) ? '<button class="linkbtn" data-tdsfclear="' + tab + '">Clear filters</button>' : "") +
    '<button class="btn small" data-printid="' + opts.table + '" data-printtitle="' + esc(opts.title || "") + '">Print or save as PDF</button>' +
    (opts.excel ? '<button class="btn small" data-act="' + opts.excel + '">Excel</button>' : "") + "</div>";
}
function tdsTabs(tabs){
  const cur = S.tdsTab;
  return '<nav class="sbar" aria-label="Return" style="margin-top:4px">' + tabs.map(([id, l, n]) => '<button data-tdstab="' + id + '" aria-selected="' + (cur === id) + '">' + l +
    (n != null ? ' <span class="sbar-n">' + n + "</span>" : "") + "</button>").join("") + "</nav>";
}
function tdsSortHead(tab, key, label, cls){
  const s = ((S.tdsSort || {})[tab]) || {}, on = s.k === key;
  return '<th' + (cls ? ' class="' + cls + '"' : "") + '><button class="linkbtn" data-tdssort="' + tab + "|" + key + '" style="font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit">' + label + (on ? (s.d < 0 ? " \u2193" : " \u2191") : "") + "</button></th>";
}
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
function viewTdsReturn26(b, allRows){
  const fy = S.tdsFy, q = S.tdsQ, money = v => INR.format(r2(v || 0));
  const rows = allRows.filter(r => r.fy === fy && r.q === q);
  const ch = tdsQuarterChallans(fy, q, rows), use = TDS.challanUse(), allCh = TDS.challans();
  const issues = Certs.issues(fy, q), issueOf = {};
  issues.forEach(x => { issueOf[x.row.id] = x; });
  const deductees = new Set(rows.map(r => r.pan && Certs.validPan(r.pan) ? r.pan : normName(r.party))).size;
  if (!["challans", "deductees", "deductions", "checks"].includes(S.tdsTab)) S.tdsTab = "challans";
  const tds = r2(rows.reduce((a, r) => a + r.tds, 0)), un = rows.filter(r => !r.challan), chTax = r2(ch.reduce((a, c) => a + num(c.tax), 0));
  const int1A = TDS.interest(fy, q), fee = TDS.lateFee(fy, q, (b.filedOn || {})[fy + q]);
  let h = '<div class="revfilter">' +
    '<button class="btn small" data-act="tdsAuto">Put them against challans</button><button class="btn small" data-act="tdsExcel">Download the 26Q working</button>' +
    '<button class="btn small" data-act="tdsTxt">Download the 26Q text file</button>' +
    '<button class="btn small primary" data-act="tdsFvu"' + (Bridge.on() ? "" : " disabled title=\"Needs the Tally Bridge\"") + ">Check it with the FVU</button></div>";
  h += '<div class="dash-tiles">' +
    '<div class="dtile"><span>TDS deducted</span><b>' + money(tds) + "</b><small>" + rows.length + " deductions, " + deductees + " deductees</small></div>" +
    '<div class="dtile"><span>Challans</span><b>' + money(chTax) + "</b><small>" + ch.length + " challan" + (ch.length === 1 ? "" : "s") + "</small></div>" +
    '<div class="dtile' + (un.length ? " warn" : "") + '"><span>Not against a challan</span><b>' + money(un.reduce((a, r) => a + r.tds, 0)) + "</b><small>" + un.length + " deductions</small></div>" +
    '<div class="dtile' + (issues.length || rows.some(r => !Certs.validPan(r.pan)) ? " warn" : "") + '"><span>To look at</span><b>' + (issues.length + rows.filter(r => !Certs.validPan(r.pan)).length) + "</b><small>" +
    rows.filter(r => !Certs.validPan(r.pan)).length + " without PAN, " + issues.length + " rate questions</small></div></div>";
  h += tdsTabs([["challans", "Challans", ch.length], ["deductees", "Deductees", deductees], ["deductions", "Deductions", rows.length],
    ["checks", "Interest, late fee and checks", (int1A.length || (fee && fee.days > 0) || issues.length) ? int1A.length + issues.length + (fee && fee.days > 0 ? 1 : 0) : null]]);
  const title = CO().name + " 26Q " + q + " " + fy;
  if (S.tdsTab === "challans"){
    const f = (S.tdsFl || {}).challans || {}, qq = String(f.q || "").toLowerCase();
    const shown = tdsSorted("challans", ch.filter(c => {
      const left = r2(num(c.tax) - (use[c.id] || 0));
      if (qq && ![c.bsr, c.serial, c.section || ""].join(" ").toLowerCase().includes(qq)) return false;
      if (f.state === "unused" && (use[c.id] || 0) > 0) return false;
      if (f.state === "part" && !((use[c.id] || 0) > 0 && left > 0.5)) return false;
      if (f.state === "full" && Math.abs(left) > 0.5) return false;
      if (f.state === "over" && left >= -0.5) return false;
      if (f.month && TDS.ymd(c.date).slice(0, 6) !== f.month) return false;
      return true;
    }), (c, k) => k === "date" ? TDS.ymd(c.date) : k === "tax" ? num(c.tax) : k === "left" ? num(c.tax) - (use[c.id] || 0) : k === "used" ? (use[c.id] || 0) : String(c[k] || ""));
    const pays = TDS.paymentsFromBooks().filter(p => TDS.fyOf(p.date) === fy && TDS.qOf(p.date) === q)
      .filter(p => !allCh.some(c => TDS.ymd(c.date) === TDS.ymd(p.date) && Math.abs(num(c.tax) - p.tax) < 1));
    if (pays.length) h += '<section class="dash-card" style="margin-bottom:12px"><h3>Paid to the government, from the books</h3>' +
      '<p class="note">TDS payment vouchers in Tally for this quarter. Add the BSR code and challan serial number and each becomes a challan.</p>' +
      '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Date</th><th class="n">Tax</th><th>Sections</th><th>Voucher</th><th>BSR code</th><th>Serial</th><th class="ac"></th></tr></thead><tbody>' +
      pays.map(p => "<tr><td>" + fmtDate(tallyDate(p.date)) + '</td><td class="n">' + money(p.tax) + "</td><td>" + esc(p.sections.join(", ")) + "</td><td>" + esc(p.voucher) + "</td>" +
        '<td><input type="text" data-paybsr="' + p.vid + '" data-fk="pb-' + p.vid + '" placeholder="0240020" style="width:100px"></td>' +
        '<td><input type="text" data-payser="' + p.vid + '" data-fk="ps-' + p.vid + '" placeholder="00979" style="width:90px"></td>' +
        '<td class="ac"><button class="btn small" data-paymake="' + p.vid + '">Make it a challan</button></td></tr>').join("") + "</tbody></table></div></section>";
    h += tdsFilterBar("challans", {placeholder: "Find a BSR code or serial", table: "tdsChTable", title: title + " challans", excel: "tdsExcel",
      count: shown.length + " of " + ch.length + " challans",
      selects: [{key: "month", label: "Month", options: [["", "Every month"]].concat(tdsMonths(fy, q).map(m => [m, monthName(m)]))},
        {key: "state", label: "Use", options: [["", "Used: any"], ["unused", "Not used"], ["part", "Part used"], ["full", "Fully used"], ["over", "Used more than paid"]]}]});
    const open = S.chOpen || "";
    h += '<div class="bk-tablewrap"><table class="bk-table" id="tdsChTable"><thead><tr><th class="n">Sl.</th>' + tdsSortHead("challans", "bsr", "BSR code") + tdsSortHead("challans", "serial", "Serial") + tdsSortHead("challans", "date", "Deposited", "dt") +
      '<th>Sections</th>' + tdsSortHead("challans", "tax", "Tax", "n") + '<th class="n">Interest</th>' + tdsSortHead("challans", "used", "Used", "n") + tdsSortHead("challans", "left", "Left", "n") + '<th class="n">Deductions</th><th class="ac"></th></tr></thead><tbody>' +
      shown.map((c, i) => {
        const mine = allRows.filter(r => r.challan === c.id), left = r2(num(c.tax) - (use[c.id] || 0)), isOpen = open === c.id;
        const secs = Array.from(new Set(mine.map(r => r.section))).join(", ") || c.section || "\u2014";
        let row = '<tr><td class="n">' + (i + 1) + '</td><td><button class="linkbtn" data-chopen="' + c.id + '">' + (isOpen ? "\u25be " : "\u25b8 ") + esc(c.bsr) + "</button></td><td>" + esc(c.serial) + "</td><td>" + fmtDate(tallyDate(c.date)) +
          "</td><td>" + esc(secs) + '</td><td class="n">' + money(c.tax) + '</td><td class="n">' + money(c.interest) + '</td><td class="n">' + money(use[c.id] || 0) +
          '</td><td class="n' + (left < -0.5 ? " bad" : "") + '">' + money(left) + '</td><td class="n"><button class="linkbtn" data-chopen="' + c.id + '">' + mine.length + "</button></td>" +
          '<td class="ac"><button class="icon danger" data-chdel="' + c.id + '" title="Remove this challan">\u2715</button></td></tr>';
        if (isOpen) row += '<tr><td colspan="11" style="background:var(--paper);padding:0">' + (mine.length ? '<table class="bk-table" style="margin:0"><thead><tr><th class="dt">Date</th><th>Deductee</th><th>PAN</th><th>Section</th><th class="n">Paid or credited</th><th class="n">TDS</th></tr></thead><tbody>' +
          mine.map(r => "<tr><td>" + fmtDate(tallyDate(r.date)) + "</td><td>" + esc(r.party) + "</td><td>" + (Certs.validPan(r.pan) ? esc(r.pan) : '<span class="tag warn">no PAN</span>') + "</td><td>" + esc(r.section) + '</td><td class="n">' + money(r.paid) + '</td><td class="n">' + money(r.tds) + "</td></tr>").join("") +
          "</tbody></table>" : '<p class="note" style="margin:8px">No deduction is against this challan yet.</p>') + "</td></tr>";
        return row;
      }).join("") +
      '<tr><td></td><td colspan="4"><b>Total</b></td><td class="n"><b>' + money(shown.reduce((a, c) => a + num(c.tax), 0)) + '</b></td><td class="n">' + money(shown.reduce((a, c) => a + num(c.interest), 0)) +
      '</td><td class="n">' + money(shown.reduce((a, c) => a + (use[c.id] || 0), 0)) + '</td><td class="n">' + money(shown.reduce((a, c) => a + num(c.tax) - (use[c.id] || 0), 0)) + "</td><td></td><td></td></tr>" +
      '<tr><td></td><td><input type="text" id="chBsr" data-fk="chBsr" placeholder="0240020" style="width:100px"></td><td><input type="text" id="chSer" data-fk="chSer" placeholder="00979" style="width:90px"></td>' +
      '<td><input type="date" id="chDate" data-fk="chDate"></td><td></td><td class="n"><input type="text" inputmode="decimal" id="chTax" data-fk="chTax" placeholder="tax" style="width:110px;text-align:right"></td>' +
      '<td class="n"><input type="text" inputmode="decimal" id="chInt" data-fk="chInt" placeholder="interest" style="width:100px;text-align:right"></td><td colspan="3"></td>' +
      '<td class="ac"><button class="btn small" data-act="chAdd">Add</button></td></tr></tbody></table>' + (shown.length || !ch.length ? "" : '<div class="bk-none">No challan matches these filters.</div>') + "</div>";
    return h;
  }
  const chOpts = ch.concat(allCh.filter(c => !ch.includes(c) && TDS.fyOf(c.date) === fy));
  const chSel = r => '<select data-alloc="' + esc(r.id) + '"><option value="">\u2014 not yet \u2014</option>' + chOpts.map(x => '<option value="' + x.id + '"' + (r.challan === x.id ? " selected" : "") + ">" +
    esc(x.bsr + "/" + x.serial + " \u00b7 " + fmtDate(tallyDate(x.date))) + "</option>").join("") + "</select>";
  const secs = Array.from(new Set(rows.map(r => r.section))).sort();
  const common = [{key: "section", label: "Section", options: [["", "Every section"]].concat(secs.map(x => [x, x]))},
    {key: "pan", label: "PAN", options: [["", "PAN: any"], ["no", "No valid PAN"], ["yes", "Has a PAN"]]},
    {key: "challan", label: "Challan", options: [["", "Challan: any"], ["no", "Not against a challan"], ["yes", "Against a challan"]]}];
  const pass = (r, f) => {
    const qq = String(f.q || "").toLowerCase();
    if (qq && ![r.party, r.pan, r.section, r.voucher, r.ledger].join(" ").toLowerCase().includes(qq)) return false;
    if (f.section && r.section !== f.section) return false;
    if (f.pan === "no" && Certs.validPan(r.pan)) return false;
    if (f.pan === "yes" && !Certs.validPan(r.pan)) return false;
    if (f.challan === "no" && r.challan) return false;
    if (f.challan === "yes" && !r.challan) return false;
    if (f.month && TDS.ymd(r.date).slice(0, 6) !== f.month) return false;
    if (f.rate === "q" && !issueOf[r.id]) return false;
    if (f.rate === "ok" && issueOf[r.id]) return false;
    return true;
  };
  if (S.tdsTab === "deductees"){
    const f = (S.tdsFl || {}).deductees || {};
    const by = {};
    rows.filter(r => pass(r, f)).forEach(r => {
      const k = Certs.validPan(r.pan) ? r.pan : "name:" + normName(r.party);
      const p = by[k] = by[k] || {key: k, party: r.party, pan: r.pan, secs: new Set(), n: 0, paid: 0, tds: 0, unallocated: 0, issues: 0, rows: []};
      p.secs.add(r.section); p.n++; p.paid = r2(p.paid + r.paid); p.tds = r2(p.tds + r.tds);
      if (!r.challan) p.unallocated = r2(p.unallocated + r.tds);
      if (issueOf[r.id]) p.issues++;
      p.rows.push(r);
    });
    const list = tdsSorted("deductees", Object.values(by).sort((a, c) => c.tds - a.tds), (p, k) => k === "secs" ? Array.from(p.secs).join(",") : p[k]);
    const open = S.tdsOpen || "";
    h += tdsFilterBar("deductees", {placeholder: "Find a deductee, PAN or voucher", table: "tdsDeTable", title: title + " deductees", excel: "tdsExcel",
      count: list.length + " of " + deductees + " deductees", selects: common.concat([{key: "rate", label: "Rate", options: [["", "Rate: any"], ["q", "Rate questions"], ["ok", "Rate as expected"]]}])});
    h += '<div class="bk-tablewrap"><table class="bk-table" id="tdsDeTable"><thead><tr>' + tdsSortHead("deductees", "party", "Deductee") + tdsSortHead("deductees", "pan", "PAN") + "<th>Code</th>" + tdsSortHead("deductees", "secs", "Sections") +
      tdsSortHead("deductees", "n", "Deductions", "n") + tdsSortHead("deductees", "paid", "Paid or credited", "n") + tdsSortHead("deductees", "tds", "TDS", "n") + tdsSortHead("deductees", "unallocated", "Not against a challan", "n") + "</tr></thead><tbody>" +
      list.map(p => {
        const isOpen = open === p.key;
        let row = '<tr><td><button class="linkbtn" data-tdsopen="' + esc(p.key) + '">' + (isOpen ? "\u25be " : "\u25b8 ") + esc(p.party) + "</button>" + (p.issues ? ' <span class="tag warn">' + p.issues + " rate</span>" : "") + "</td><td>" +
          (Certs.validPan(p.pan) ? esc(p.pan) : '<span class="tag warn">no PAN</span>') + "</td><td>" + (Certs.validPan(p.pan) ? (/^[A-Z]{3}C/.test(p.pan) ? "01 company" : "02 other") : "\u2014") + "</td><td>" + esc(Array.from(p.secs).join(", ")) +
          '</td><td class="n"><button class="linkbtn" data-tdsopen="' + esc(p.key) + '">' + p.n + '</button></td><td class="n">' + money(p.paid) + '</td><td class="n"><b>' + money(p.tds) + "</b></td>" +
          '<td class="n' + (p.unallocated ? " bad" : "") + '">' + (p.unallocated ? money(p.unallocated) : "\u2014") + "</td></tr>";
        if (isOpen) row += '<tr><td colspan="8" style="background:var(--paper);padding:0"><table class="bk-table" style="margin:0"><thead><tr><th class="dt">Date</th><th>Voucher</th><th>Section</th><th class="n">Paid or credited</th><th class="n">Rate</th><th class="n">TDS</th><th>Challan</th></tr></thead><tbody>' +
          p.rows.map(r => "<tr><td>" + fmtDate(tallyDate(r.date)) + "</td><td>" + esc(r.voucher || "") + "</td><td>" + esc(r.section) + '</td><td class="n">' + money(r.paid) + '</td><td class="n">' + (r.rate != null ? r.rate + "%" : "") +
            (issueOf[r.id] ? '<div class="nr bad">should be ' + issueOf[r.id].expected + "%</div>" : "") + '</td><td class="n">' + money(r.tds) + "</td><td>" + chSel(r) + "</td></tr>").join("") + "</tbody></table></td></tr>";
        return row;
      }).join("") +
      '<tr><td colspan="4"><b>Total</b></td><td class="n">' + list.reduce((a, p) => a + p.n, 0) + '</td><td class="n">' + money(list.reduce((a, p) => a + p.paid, 0)) + '</td><td class="n"><b>' + money(list.reduce((a, p) => a + p.tds, 0)) +
      '</b></td><td class="n">' + money(list.reduce((a, p) => a + p.unallocated, 0)) + "</td></tr></tbody></table>" + (list.length ? "" : '<div class="bk-none">No deductee matches these filters.</div>') + "</div>";
    return h;
  }
  if (S.tdsTab === "deductions"){
    const f = (S.tdsFl || {}).deductions || {};
    const shown = tdsSorted("deductions", rows.filter(r => pass(r, f)), (r, k) => k === "date" ? TDS.ymd(r.date) : k === "challan" ? (r.challan ? 1 : 0) : r[k] == null ? "" : r[k]);
    const LIMIT = 500, page = shown.slice(0, LIMIT);
    h += tdsFilterBar("deductions", {placeholder: "Find a deductee, PAN, voucher or ledger", table: "tdsDnTable", title: title + " deductions", excel: "tdsExcel",
      count: shown.length + " of " + rows.length + " deductions \u00b7 TDS " + money(shown.reduce((a, r) => a + r.tds, 0)),
      selects: [{key: "month", label: "Month", options: [["", "Every month"]].concat(tdsMonths(fy, q).map(m => [m, monthName(m)]))}].concat(common)
        .concat([{key: "rate", label: "Rate", options: [["", "Rate: any"], ["q", "Rate questions"], ["ok", "Rate as expected"]]}])});
    h += '<div class="bk-tablewrap"><table class="bk-table" id="tdsDnTable"><thead><tr><th class="n">Sl.</th>' + tdsSortHead("deductions", "date", "Date", "dt") + tdsSortHead("deductions", "voucher", "Voucher") + tdsSortHead("deductions", "party", "Deductee") +
      tdsSortHead("deductions", "pan", "PAN") + tdsSortHead("deductions", "section", "Section") + tdsSortHead("deductions", "paid", "Paid or credited", "n") + tdsSortHead("deductions", "rate", "Rate", "n") + tdsSortHead("deductions", "tds", "TDS", "n") +
      tdsSortHead("deductions", "challan", "Challan") + "</tr></thead><tbody>" +
      page.map((r, i) => '<tr><td class="n">' + (i + 1) + "</td><td>" + fmtDate(tallyDate(r.date)) + "</td><td>" + esc(r.voucher || "") + "</td><td>" + esc(r.party) + "</td><td>" + (Certs.validPan(r.pan) ? esc(r.pan) : '<span class="tag warn">no PAN</span>') +
        "</td><td>" + esc(r.section) + '</td><td class="n">' + money(r.paid) + '</td><td class="n">' + (r.rate != null ? r.rate + "%" : "") + (issueOf[r.id] ? '<div class="nr bad" title="' + esc(issueOf[r.id].why) + '">should be ' + issueOf[r.id].expected + "%</div>" : "") +
        '</td><td class="n">' + money(r.tds) + "</td><td>" + chSel(r) + "</td></tr>").join("") +
      '<tr><td></td><td colspan="5"><b>Total</b></td><td class="n">' + money(shown.reduce((a, r) => a + r.paid, 0)) + '</td><td></td><td class="n"><b>' + money(shown.reduce((a, r) => a + r.tds, 0)) + "</b></td><td></td></tr></tbody></table>" +
      (shown.length > LIMIT ? '<p class="note">The first ' + LIMIT + " are shown. Narrow them with the filters, or download the Excel for all " + shown.length + ".</p>" : "") +
      (shown.length ? "" : '<div class="bk-none">No deduction matches these filters.</div>') + "</div>";
    return h;
  }
  // interest, late fee, rate questions, by section, and the FVU result
  const total = r2(int1A.reduce((a, x) => a + x.amount, 0));
  if (S.fvuResult){
    const fr = S.fvuResult;
    h += '<section class="bk-alert ' + (fr.ok ? "" : "bad") + '"><b>' + (fr.ok ? "The FVU accepted the " + esc(fr.q) + " file." : "The FVU found problems in the " + esc(fr.q || "") + " file.") + "</b>" +
      (fr.fvu ? '<p class="note">Upload file: ' + esc(fr.fvu) + "</p>" : "") +
      (fr.errors ? '<pre style="white-space:pre-wrap;font-size:12px;max-height:220px;overflow:auto;margin:8px 0 0">' + esc(String(fr.errors).slice(0, 4000)) + "</pre>" : "") +
      (!fr.errors && !fr.ok && fr.output ? '<pre style="white-space:pre-wrap;font-size:12px;max-height:160px;overflow:auto">' + esc(String(fr.output).slice(0, 2000)) + "</pre>" : "") +
      '<div class="row" style="margin-top:8px"><button class="linkbtn" data-act="fvuClose">Hide this</button></div></section>';
  }
  h += '<section class="dash-card" style="margin-bottom:12px"><h3>Interest and late fee</h3>' +
    '<div class="dash-row"><span>Interest under 201(1A), paid after the due date</span><b>' + money(total) + "</b></div>" +
    '<div class="dash-row"><span>Late filing fee under 234E, if filed today</span><b>' + money(fee && fee.days > 0 ? fee.fee : 0) + "</b></div>" +
    (fee && fee.days > 0 ? '<p class="note">' + fee.days + " day" + (fee.days === 1 ? "" : "s") + " past " + fmtDate(tallyDate(fee.due)) + " at 200 a day, capped at the TDS of the quarter (" + money(fee.cap) + ").</p>" : "") +
    (int1A.length ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Deducted</th><th>Deductee</th><th class="n">TDS</th><th>Due</th><th>Paid</th><th class="n">Months</th><th class="n">Interest</th></tr></thead><tbody>' +
      int1A.slice(0, 100).map(x => "<tr><td>" + fmtDate(tallyDate(x.row.date)) + "</td><td>" + esc(x.row.party) + '</td><td class="n">' + money(x.row.tds) + "</td><td>" + fmtDate(tallyDate(x.due)) + "</td><td>" + fmtDate(tallyDate(x.challan.date)) +
        '</td><td class="n">' + x.months + '</td><td class="n bad">' + money(x.amount) + "</td></tr>").join("") + "</tbody></table></div>" : '<p class="note">No deduction was paid late.</p>') + "</section>";
  h += '<section class="dash-card" style="margin-bottom:12px"><h3>Rate questions</h3>' + (issues.length ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Date</th><th>Deductee</th><th>PAN</th><th>Section</th><th class="n">Paid</th><th class="n">Rate used</th><th class="n">Rate that applies</th><th>Why</th><th class="n">Short or excess</th></tr></thead><tbody>' +
    issues.map(x => "<tr><td>" + fmtDate(tallyDate(x.row.date)) + "</td><td>" + esc(x.row.party) + "</td><td>" + (Certs.validPan(x.row.pan) ? esc(x.row.pan) : '<span class="tag warn">no PAN</span>') + "</td><td>" + esc(x.row.section) +
      '</td><td class="n">' + money(x.row.paid) + '</td><td class="n">' + x.row.rate + '%</td><td class="n">' + x.expected + "%</td><td>" + esc(x.why) + '</td><td class="n' + (x.short > 0 ? " bad" : "") + '">' + money(x.short) + "</td></tr>").join("") +
    "</tbody></table></div>" : '<p class="note">Every deduction matches the rate that applies.</p>') + "</section>";
  const sum = TDS.summary(fy, q);
  h += '<section class="dash-card"><h3>By section</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Section</th><th class="n">Deductions</th><th class="n">Paid or credited</th><th class="n">TDS</th><th class="n">Not against a challan</th></tr></thead><tbody>' +
    sum.map(s => "<tr><td>" + esc(s.section) + '</td><td class="n">' + s.count + '</td><td class="n">' + money(s.paid) + '</td><td class="n">' + money(s.tds) + '</td><td class="n">' + money(s.unallocated) + "</td></tr>").join("") + "</tbody></table></div></section>";
  return h;
}
function viewTdsReturn24(b){
  const fy = S.tdsFy, q = S.tdsQ, money = v => INR.format(r2(v || 0));
  const tabs = [["employees", "Employees"], ["challans", "Challans"]].concat(q === "Q4" ? [["annex2", "Annexure II, the year"]] : []).concat([["checks", "Checks"]]);
  if (!tabs.some(t => t[0] === S.tdsTab)) S.tdsTab = "employees";
  let h = '<div class="revfilter"><button class="btn small primary" data-act="salaryPick">Bring in the salary sheet</button>' +
    ((b.salary || []).length ? '<button class="btn small" data-act="q24Excel">Download the 24Q working</button><button class="btn small" data-act="salaryClear">Remove the sheet</button>' : "") + "</div>";
  if (!(b.salary || []).length){
    const inB = TDS.salaryRows().filter(r => r.fy === fy && r.q === q);
    return h + (inB.length ? '<section class="dash-card" style="max-width:760px;margin-bottom:12px"><h3>Salary TDS in the books</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Date</th><th>Employee</th><th>PAN</th><th class="n">Paid</th><th class="n">TDS</th></tr></thead><tbody>' +
      inB.map(r => "<tr><td>" + fmtDate(tallyDate(r.date)) + "</td><td>" + esc(r.party) + "</td><td>" + esc(r.pan || "\u2014") + '</td><td class="n">' + money(r.paid) + '</td><td class="n">' + money(r.tds) + "</td></tr>").join("") +
      '</tbody></table></div><p class="note">These are kept out of 26Q. For Annexure I and II, bring in the salary sheet.</p></section>' : "") +
      '<section class="dash-card" style="max-width:760px"><h3>24Q needs the salary sheet</h3>' +
      '<p class="note">Tally credits each employee their net pay and the TDS as one figure, so the books cannot say how much was deducted from whom. Bring in the payroll sheet you already prepare \u2014 Excel or CSV \u2014 and the columns are found by their names: employee, PAN, month, gross salary, exempt allowances, standard deduction, professional tax, Chapter VI-A, taxable income and TDS.</p></section>';
  }
  const a1 = TDS24Q.annexI(fy, q), checks = TDS24Q.checks(fy, q), ch = TDS.challans().filter(c => TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q);
  const inBooks = TDS.salaryRows().filter(r => r.fy === fy && r.q === q), booksTds = r2(inBooks.reduce((a, r) => a + r.tds, 0)), sheetTds = r2(a1.reduce((s2, e) => s2 + e.tds, 0));
  if (inBooks.length && Math.abs(booksTds - sheetTds) >= 1) checks.push({what: "Salary TDS in the books differs from the salary sheet", n: inBooks.length,
    how: "Tally has " + money(booksTds) + " under section 192 this quarter; the sheet has " + money(sheetTds) + ".", who: Array.from(new Set(inBooks.map(r => r.party))).slice(0, 3)});
  h += '<div class="dash-tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
    '<div class="dtile"><span>Employees this quarter</span><b>' + a1.length + "</b><small>" + money(a1.reduce((s, e) => s + e.paid, 0)) + " paid</small></div>" +
    '<div class="dtile"><span>TDS deducted</span><b>' + money(a1.reduce((s, e) => s + e.tds, 0)) + "</b><small>" + esc(q) + " " + esc(fy) + "</small></div>" +
    '<div class="dtile' + (checks.length ? " warn" : "") + '"><span>Before filing</span><b>' + checks.length + "</b><small>" + (checks.length ? esc(checks[0].what) : "nothing to fix") + "</small></div></div>";
  h += tdsTabs(tabs.map(([id, l]) => [id, l, id === "employees" ? a1.length : id === "challans" ? ch.length : id === "checks" ? (checks.length || null) : null]));
  if (S.tdsTab === "employees"){
    const f = (S.tdsFl || {}).employees || {}, qq = String(f.q || "").toLowerCase();
    const shown = tdsSorted("employees", a1.filter(e => (!qq || (e.name + " " + e.pan).toLowerCase().includes(qq)) &&
      (f.pan !== "no" || !Certs.validPan(e.pan)) && (f.pan !== "yes" || Certs.validPan(e.pan)) && (f.tds !== "yes" || e.tds > 0) && (f.tds !== "no" || !e.tds)), (e, k) => e[k]);
    h += tdsFilterBar("employees", {placeholder: "Find an employee or PAN", table: "q24Table", title: CO().name + " 24Q " + q + " " + fy, excel: "q24Excel",
      count: shown.length + " of " + a1.length + " employees",
      selects: [{key: "pan", label: "PAN", options: [["", "PAN: any"], ["no", "No valid PAN"], ["yes", "Has a PAN"]]}, {key: "tds", label: "TDS", options: [["", "TDS: any"], ["yes", "TDS deducted"], ["no", "No TDS"]]}]});
    h += '<div class="bk-tablewrap"><table class="bk-table" id="q24Table"><thead><tr>' + tdsSortHead("employees", "name", "Employee") + tdsSortHead("employees", "pan", "PAN") + tdsSortHead("employees", "months", "Months", "n") +
      tdsSortHead("employees", "paid", "Paid", "n") + tdsSortHead("employees", "tds", "TDS", "n") + "</tr></thead><tbody>" +
      shown.map(e => {
        const key = e.pan || e.name, isOpen = S.q24Open === key;
        let row = '<tr><td><button class="linkbtn" data-q24open="' + esc(key) + '">' + (isOpen ? "\u25be " : "\u25b8 ") + esc(e.name) + "</button></td><td>" + (Certs.validPan(e.pan) ? esc(e.pan) : '<span class="tag warn">no PAN</span>') +
          '</td><td class="n">' + e.months + '</td><td class="n">' + money(e.paid) + '</td><td class="n"><b>' + money(e.tds) + "</b></td></tr>";
        if (isOpen) row += '<tr><td colspan="5" style="background:var(--paper);padding:0"><table class="bk-table" style="margin:0"><thead><tr><th class="dt">Month</th><th class="n">Gross</th><th class="n">Exempt</th><th class="n">Chapter VI-A</th><th class="n">TDS</th></tr></thead><tbody>' +
          e.rows.map(r => "<tr><td>" + fmtDate(r.date) + '</td><td class="n">' + money(r.gross) + '</td><td class="n">' + money(r.exempt) + '</td><td class="n">' + money(r.chapter6) + '</td><td class="n">' + money(r.tds) + "</td></tr>").join("") + "</tbody></table></td></tr>";
        return row;
      }).join("") +
      '<tr><td><b>Total</b></td><td></td><td class="n">' + shown.reduce((a, e) => a + e.months, 0) + '</td><td class="n">' + money(shown.reduce((a, e) => a + e.paid, 0)) + '</td><td class="n"><b>' + money(shown.reduce((a, e) => a + e.tds, 0)) + "</b></td></tr></tbody></table>" +
      (shown.length ? "" : '<div class="bk-none">No employee matches these filters.</div>') + "</div>";
    return h;
  }
  if (S.tdsTab === "challans"){
    const use = TDS.challanUse();
    h += '<p class="note">Challans deposited in ' + esc(q) + ". Salary TDS is paid under section 192; add a challan under 26Q’s Challans tab if it is not here.</p>" +
      '<div class="bk-tablewrap"><table class="bk-table" id="q24ChTable"><thead><tr><th>BSR code</th><th>Serial</th><th class="dt">Deposited</th><th>Section</th><th class="n">Tax</th><th class="n">Interest</th><th class="n">Used in 26Q</th></tr></thead><tbody>' +
      ch.map(c => "<tr><td>" + esc(c.bsr) + "</td><td>" + esc(c.serial) + "</td><td>" + fmtDate(tallyDate(c.date)) + "</td><td>" + esc(c.section || "\u2014") + '</td><td class="n">' + money(c.tax) + '</td><td class="n">' + money(c.interest) + '</td><td class="n">' + money(use[c.id] || 0) + "</td></tr>").join("") +
      "</tbody></table>" + (ch.length ? "" : '<div class="bk-none">No challan deposited in this quarter.</div>') + "</div>";
    return h;
  }
  if (S.tdsTab === "annex2"){
    const a2 = TDS24Q.annexII(fy);
    return h + '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Employee</th><th>PAN</th><th>Regime</th><th class="n">Gross</th><th class="n">Exempt</th><th class="n">Standard</th><th class="n">Chapter VI-A</th><th class="n">Taxable</th><th class="n">TDS</th></tr></thead><tbody>' +
      a2.map(e => "<tr><td>" + esc(e.name) + "</td><td>" + esc(e.pan || "\u2014") + "</td><td>" + (e.regime === "N" ? "New" : e.regime === "O" ? "Old" : "\u2014") + '</td><td class="n">' + money(e.gross) + '</td><td class="n">' + money(e.exempt) +
        '</td><td class="n">' + money(e.standard) + '</td><td class="n">' + money(e.chapter6) + '</td><td class="n">' + money(e.taxable) + '</td><td class="n">' + money(e.tds) + "</td></tr>").join("") + "</tbody></table></div>";
  }
  return h + (checks.length ? '<section class="dash-card"><h3>Before filing</h3>' + checks.map(c => '<div class="dash-row"><span>' + esc(c.what) + "</span><b>" + c.n + '</b></div><p class="note">' + esc(c.how) + (c.who.length ? " e.g. " + esc(c.who.join(", ")) : "") + "</p>").join("") + "</section>"
    : '<p class="note">Nothing to fix for this quarter.</p>');
}

function viewTdsCerts(b){
  const list = Certs.all(), money = v => INR.format(r2(v || 0));
  const iss = Certs.issues(S.tdsFy || "", "");
  let h = '<section class="dash-card" style="margin-bottom:12px"><h3>Certificates under section 197</h3>' +
    '<p class="note">A deductee with a certificate for a lower rate, or nil. Where a payment is covered by one, that rate is what the system expects instead of the usual rate.</p>' +
    '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Deductee</th><th>PAN</th><th>Section</th><th>Certificate no.</th><th class="n">Rate</th><th>From</th><th>To</th><th class="ac"></th></tr></thead><tbody>' +
    list.map(c => "<tr><td>" + esc(c.party) + "</td><td>" + esc(c.pan || "") + "</td><td>" + esc(c.section || "any") + "</td><td>" + esc(c.certNo || "") +
      '</td><td class="n">' + num(c.rate) + "%</td><td>" + (c.from ? fmtDate(c.from) : "") + "</td><td>" + (c.to ? fmtDate(c.to) : "") +
      '</td><td class="ac"><button class="icon danger" data-certdel="' + c.id + '">\u2715</button></td></tr>').join("") +
    '<tr><td><input type="text" id="ctParty" data-fk="ctParty" placeholder="deductee as named in Tally" style="width:190px"></td>' +
    '<td><input type="text" id="ctPan" data-fk="ctPan" placeholder="PAN" style="width:110px"></td>' +
    '<td><input type="text" id="ctSec" data-fk="ctSec" placeholder="194C" style="width:80px"></td>' +
    '<td><input type="text" id="ctNo" data-fk="ctNo" placeholder="certificate no." style="width:140px"></td>' +
    '<td class="n"><input type="text" inputmode="decimal" id="ctRate" data-fk="ctRate" placeholder="0.5" style="width:70px;text-align:right"></td>' +
    '<td><input type="date" id="ctFrom" data-fk="ctFrom"></td><td><input type="date" id="ctTo" data-fk="ctTo"></td>' +
    '<td class="ac"><button class="btn small" data-act="certAdd">Add</button></td></tr></tbody></table></div></section>';
  h += '<section class="dash-card"><h3>Rate questions</h3>' +
    '<p class="note">Where the books deducted at a rate different from the one that applies: a certificate, 20% under section 206AA when there is no valid PAN, or the usual rate for the section.</p>' +
    '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Date</th><th>Deductee</th><th>PAN</th><th>Section</th><th class="n">Paid</th><th class="n">Rate used</th><th class="n">Rate that applies</th><th>Why</th><th class="n">Short or excess</th></tr></thead><tbody>' +
    iss.slice(0, 200).map(x => "<tr><td>" + fmtDate(tallyDate(x.row.date)) + "</td><td>" + esc(x.row.party) + "</td><td>" + (Certs.validPan(x.row.pan) ? esc(x.row.pan) : '<span class="tag warn">no PAN</span>') +
      "</td><td>" + esc(x.row.section) + '</td><td class="n">' + money(x.row.paid) + '</td><td class="n">' + (x.row.rate == null ? "" : x.row.rate + "%") + '</td><td class="n">' + x.expected + "%</td><td>" + esc(x.why) +
      '</td><td class="n' + (x.short > 0 ? " bad" : "") + '">' + money(x.short) + "</td></tr>").join("") +
    "</tbody></table>" + (iss.length ? "" : '<div class="bk-none">Every deduction matches the rate that applies.</div>') + "</div></section>";
  return h;
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
  if (S.auditTab === "rel") return auditTabs() + viewAuditRel(b);
  if (S.auditTab === "3cd") return auditTabs() + viewAudit3cd(b);
  const m = v => INR.format(r2(v || 0)), c = Audit.cfg(b), au = b.audit || {}, run = au.last, dr = Audit.defaultRange(b);
  const range = S.auditRange || {from: Audit.iso(dr.from), to: Audit.iso(dr.to)};
  const lyFrom = MIS.shift(Audit.ymd(range.from), -1), lyTo = MIS.shift(Audit.ymd(range.to), -1), lyHere = MIS.covered(lyFrom);
  let h = auditTabs() + '<section class="dash-card"><h3>Audit of the books</h3>' +
    '<p class="note">Every check runs on the vouchers read from Tally. Each finding says what is wrong, what it costs, what to do, and the journal entry where one is needed. Mark each one, then download the report.</p>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
    '<label class="note">From <input type="date" data-auditfrom value="' + esc(range.from) + '"></label><label class="note">to <input type="date" data-auditto value="' + esc(range.to) + '"></label>' +
    '<button class="btn small primary" data-act="auditRun">Run now</button>' +
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
        vs.slice(0, 300).map(v => { const a = v.ent.filter(e => e.l === S.misLed).reduce((s, e) => s + e.a, 0); return "<tr><td>" + fmtDate(tallyDate(v.date)) + "</td><td>" + esc(v.no) + '<div class="nr">' + esc(v.type) + "</div></td><td>" + esc(v.party || "") + '</td><td class="n">' + (a < 0 ? m(-a) : "") + '</td><td class="n">' + (a > 0 ? m(a) : "") + "</td><td>" + esc(v.narr || "") + "</td></tr>"; }).join("") +
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
      list.slice(0, 400).map(p => {
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
      list.slice(0, 400).map(x => "<tr><td>" + esc(x.party || "\u2014") + "</td>" + (cols ? months.map(mm => '<td class="n">' + (x.m[mm] ? m(x.m[mm]) : "") + "</td>").join("") : "") + '<td class="n"><b>' + m(x.t) + '</b></td><td class="n">' + (S2.total ? Math.round(x.t / S2.total * 1000) / 10 + "%" : "") + "</td></tr>").join("") +
      '<tr><td><b>Total</b></td>' + (cols ? months.map(mm => '<td class="n">' + m(S2.rows.reduce((s, x) => s + (x.m[mm] || 0), 0)) + "</td>").join("") : "") + '<td class="n"><b>' + m(S2.total) + "</b></td><td></td></tr></tbody></table></div>" +
      '<p class="note">' + (tab === "sales" ? "Sales are shown without GST, less credit notes." : "Purchases and expenses booked against suppliers, without GST.") + "</p>";
    if (tab === "purch") h += '<section class="dash-card" style="margin-top:12px"><h3>Expense heads by month</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Ledger</th>' + (cols ? months.map(mm => '<th class="n">' + GSTR.label(mm) + "</th>").join("") : "") + '<th class="n">Total</th></tr></thead><tbody>' +
      S2.heads.filter(x => !q || x.l.toLowerCase().includes(q)).slice(0, 200).map(x => "<tr><td>" + esc(x.l) + (x.jumps.length ? ' <span class="tag warn">jumped</span>' : "") + "</td>" + (cols ? months.map(mm => '<td class="n' + (x.jumps.includes(mm) ? " bad" : "") + '">' + (x.m[mm] ? m(x.m[mm]) : "") + "</td>").join("") : "") + '<td class="n"><b>' + m(x.t) + "</b></td></tr>").join("") +
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
  return h + '<p class="note" style="margin-top:16px">Prepared from the books in Tally by ' + esc(co.firm || "Garg Shekhar & Company") + ".</p>";
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
      list.slice(0, 300).map(x => { const open = S.misCc === x.cat + "|" + x.name;
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
function viewLedPosting(b){
  const co = CO(), rows = LedMaster.posting(b, co), diff = rows.filter(x => x.from && x.from !== x.now);
  return '<section class="dash-card"><h3>What TDS Desk posts bills to</h3><p class="note">When TDS Desk posts a bill into Tally, these are the ledgers it uses. They come from the ledgers confirmed here; an empty one is filled in as soon as its ledger is confirmed, and one set by hand in Client setup is kept until you choose the master\u2019s.</p>' +
    (diff.length ? '<div class="row" style="margin:8px 0"><button class="btn small primary" data-act="lmPostAll">Use the master\u2019s for all ' + diff.length + "</button></div>" : "") +
    '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Used for</th><th>Now</th><th>From the master</th><th>Why</th><th class="ac"></th></tr></thead><tbody>' +
    rows.map(x => "<tr><td>" + esc(x.label) + "</td><td>" + (x.now ? esc(x.now) + ((b.ledInfo || {})[x.now] || (b.map || {})[x.now] ? "" : ' <span class="tag warn">not in Tally</span>') : '<span class="note">\u2014</span>') + "</td><td>" + (x.from ? (x.from === x.now ? '<span style="color:#1F7A4D">\u2713 same</span>' : "<b>" + esc(x.from) + "</b>") : '<span class="note">none confirmed</span>') +
      '</td><td><div class="nr" style="white-space:normal">' + esc(x.why) + '</div></td><td class="ac">' + (x.from && x.from !== x.now ? '<button class="btn small" data-lmpost="' + esc(x.k) + '">Use it</button>' : "") + "</td></tr>").join("") + "</tbody></table></div></section>";
}
function ledChangedBanner(b){
  const ch = LedMaster.changesSince(b);
  if (!ch.length) return "";
  return '<section class="bk-alert" style="margin-bottom:12px"><b>' + ch.length + " ledger" + (ch.length === 1 ? " was" : "s were") + " changed after returns were made from them.</b> Check whether those returns need a revision or an amendment." +
    '<div class="bk-tablewrap" style="margin-top:6px"><table class="bk-table"><thead><tr><th>Ledger</th><th>What changed</th><th>Returns made before the change</th></tr></thead><tbody>' +
    ch.slice(0, 30).map(x => "<tr><td>" + esc(x.name) + "</td><td>" + esc(x.change) + "</td><td>" + esc(x.returns.slice(0, 4).join("; ") + (x.returns.length > 4 ? " and " + (x.returns.length - 4) + " more" : "")) + "</td></tr>").join("") + "</tbody></table></div></section>";
}
function viewGst9(b){
  const reg = S.gstReg || (((b.meta || {}).gstins || []).length === 1 ? b.meta.gstins[0].slice(0, 2) : "");
  if (!reg) return '<p class="note">Choose a registration above; the annual return is filed for each GSTIN.</p>';
  const fy = GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]), d = GST9.build(fy, reg), m = v => INR.format(r2(v || 0));
  let h = '<section class="dash-card"><h3>GSTR-9 for ' + GST9.label(fy) + ", " + esc(((b.meta || {}).gstins || []).find(g => g.slice(0, 2) === reg) || reg) + "</h3>" +
    '<p class="note">Built from the months in the books, the same figures as each month\u2019s GSTR-1 and 3B. ' + (d.missing.length ? '<span class="bad">Not in the books: ' + d.missing.map(GSTR.label).join(", ") + ".</span> " : "") +
    (d.twoB ? d.twoB + " months of 2B here for table 8A." : '<span class="bad">No 2B here for this year, so table 8A is empty; bring the 2B files in under 2B reconciliation.</span>') + "</p>" +
    '<div class="row" style="gap:8px;margin:8px 0"><button class="btn small primary" data-act="gst9Pdf">Download (PDF)</button><button class="btn small" data-act="gst9Excel">Excel</button></div>' + GST9.html(d) +
    (Math.abs(d.T["6J"].igst + d.T["6J"].cgst + d.T["6J"].sgst + d.T["6J"].cess) >= 1 ? '<p class="bk-alert">6J: \u20b9' + m(d.T["6J"].igst + d.T["6J"].cgst + d.T["6J"].sgst + d.T["6J"].cess) + " of the credit in the 3Bs is not in 6B to 6H. It usually comes from bills marked as ITC not available, or credit entered in a 3B that is not in the books; check before filing.</p>" : "") +
    (d.heldEnd && Math.abs(d.T["6J"].igst + d.T["6J"].cgst + d.T["6J"].sgst + d.T["6J"].cess + d.heldEnd) < 2 ? '<p class="note">6J: \u20b9' + m(d.heldEnd) + " of this year\u2019s bills was held back from 3B because it was not in 2B by March; it is taken in next year\u2019s returns and belongs in 8C and 13 when it is.</p>" : "") +
    '<p class="note">Table 8C and 13 count bills of this year booked in Tally from April to November of the next year; table 12, this year\u2019s credit reversed then (\u20b9' + m(d.T["12books"].igst + d.T["12books"].cgst + d.T["12books"].sgst + d.T["12books"].cess) + " in the books). Figures that are not in the books are typed below.</p></section>";
  // what is not in the books, typed once for the year
  const ty = d.typed || {}, cell = (k, f) => '<input type="number" step="0.01" data-g9t="' + k + "." + f + '" value="' + esc(ty[k] && ty[k][f] != null ? ty[k][f] : "") + '" placeholder="0" style="width:105px;text-align:right">';
  h += '<section class="dash-card" style="margin-top:12px"><h3>Figures not in the books</h3><p class="note">Amendments made on the portal, credit from an ISD, reversals under rules 37 and 39, refunds and demands, late fee. Typed here, they go into the tables above and into the PDF and Excel.' + (d.T["12books"] && (d.T["12books"].igst + d.T["12books"].cgst + d.T["12books"].sgst) ? " Table 12 is taken from the books unless typed." : "") + '</p><div class="bk-tablewrap"><table class="bk-table gf-off"><thead><tr><th>Table</th><th class="n">Value</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Cess</th></tr></thead><tbody>' +
    GST9.TYPED.map(([k, l]) => "<tr><td>" + esc(/^\d+[A-Z]? /.test(l) ? l : k + " " + l) + "</td>" + ["taxable", "igst", "cgst", "sgst", "cess"].map(f => '<td class="n">' + cell(k, f) + "</td>").join("") + "</tr>").join("") +
    "<tr><td>14 Differential tax on 10 and 11: payable / paid</td><td class=\"n\">" + cell("14", "payable") + '</td><td class="n">' + cell("14", "paid") + '</td><td colspan="3"></td></tr></tbody></table></div></section>';
  h += '<section class="dash-card" style="margin-top:12px"><h3>17. HSN summary of outward supplies</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>HSN</th><th class="n">Rate</th><th class="n">Taxable value</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>' +
    d.hsnOut.slice(0, 100).map(x => "<tr><td>" + esc(x.hsn || "\u2014") + '</td><td class="n">' + x.rate + '%</td><td class="n">' + m(x.taxable) + '</td><td class="n">' + m(x.igst) + '</td><td class="n">' + m(x.cgst) + '</td><td class="n">' + m(x.sgst) + "</td></tr>").join("") + "</tbody></table></div></section>";
  h += '<section class="dash-card" style="margin-top:12px"><h3>18. HSN summary of inward supplies</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>HSN</th><th class="n">Taxable value</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>' +
    d.hsnIn.slice(0, 100).map(x => "<tr><td>" + esc(x.hsn || "no HSN in Tally") + '</td><td class="n">' + m(x.taxable) + '</td><td class="n">' + m(x.igst) + '</td><td class="n">' + m(x.cgst) + '</td><td class="n">' + m(x.sgst) + "</td></tr>").join("") + "</tbody></table></div></section>";
  return h;
}
function viewGst9c(b){
  const reg = S.gstReg || (((b.meta || {}).gstins || []).length === 1 ? b.meta.gstins[0].slice(0, 2) : "");
  if (!reg) return '<p class="note">Choose a registration above.</p>';
  const fy = GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]), c = GST9C.build(fy, reg), m = v => INR.format(r2(v || 0)), st = c.st;
  const inp = (k, v, ph) => '<input type="number" step="0.01" data-g9c="' + k + '" value="' + esc(v == null ? "" : v) + '" placeholder="' + esc(ph || "0") + '" style="width:140px;text-align:right">';
  const row = (no, l, v, bold, bad) => "<tr><td>" + no + "</td><td>" + (bold ? "<b>" + l + "</b>" : l) + '</td><td class="n' + (bad && Math.abs(v) >= 1 ? " bad" : "") + '">' + (bold ? "<b>" + m(v) + "</b>" : m(v)) + "</td></tr>";
  let h = '<section class="dash-card"><h3>GSTR-9C for ' + GST9.label(fy) + '</h3><p class="note">The reconciliation of the audited accounts with the annual return. The books give each figure; type the audited turnover and the adjustments where they apply. Reasons for any difference go in the boxes below each table.</p>' +
    '<div class="row" style="gap:8px;margin:8px 0"><button class="btn small primary" data-act="gst9cPdf">Download (PDF)</button><button class="btn small" data-act="gst9cExcel">Excel</button></div>' +
    '<h3 style="margin-top:10px">5. Reconciliation of gross turnover</h3><div class="bk-tablewrap"><table class="bk-table"><tbody>' +
    "<tr><td>5A</td><td>Turnover (including exports) as per the audited financial statements<div class=\"nr\">from the books: " + m(c.booksTurnover) + '</div></td><td class="n">' + inp("turnover", st.turnover, String(c.booksTurnover)) + "</td></tr>" +
    GST9C.ADJ.map(([k, l, sg]) => "<tr><td>" + k + "</td><td>" + esc(l) + " (" + (sg > 0 ? "+" : "\u2013") + ")" + (c.def[k] != null ? '<div class="nr">from the books (table 4F): ' + m(c.def[k]) + "</div>" : "") + '</td><td class="n">' + inp("adj." + k, st.adj[k], c.def[k] != null ? String(c.def[k]) : "0") + "</td></tr>").join("") +
    row("5O", "Annual turnover after adjustments", c.o5, 1) + row("5P", "Turnover as declared in the annual return (GSTR-9)", c.p5) + row("5Q", "Unreconciled turnover (5O \u2013 5P)", c.q5, 1, 1) + "</tbody></table></div>" +
    '<label class="note" style="display:block">6. Reasons for the unreconciled difference<textarea data-g9c="reasons.6" rows="2" style="width:100%">' + esc(st.reasons["6"] || "") + "</textarea></label>" +
    '<h3 style="margin-top:12px">7. Reconciliation of taxable turnover</h3><div class="bk-tablewrap"><table class="bk-table"><tbody>' +
    row("7A", "Annual turnover after adjustments (5O)", c.o5) + row("7B", "Exempted, nil rated, non-GST supplies", c.exempt) + row("7C", "Zero rated supplies without payment of tax", c.zero) + row("7D", "Supplies on which tax is paid by the recipient on reverse charge", c.rcm) +
    row("7E", "Taxable turnover as per adjustments (A \u2013 (B + C + D))", c.e7, 1) + row("7F", "Taxable turnover as per liability declared in the annual return", c.f7) + row("7G", "Unreconciled taxable turnover (E \u2013 F)", c.g7, 1, 1) + "</tbody></table></div>" +
    '<label class="note" style="display:block">8. Reasons<textarea data-g9c="reasons.8" rows="2" style="width:100%">' + esc(st.reasons["8"] || "") + "</textarea></label>" +
    '<h3 style="margin-top:12px">9. Reconciliation of tax paid, rate by rate</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="n">Rate</th><th class="n">Taxable value</th><th class="n">Tax payable</th></tr></thead><tbody>' +
    c.rates.map(x => '<tr><td class="n">' + x.rate + '%</td><td class="n">' + m(x.taxable) + '</td><td class="n">' + m(x.tax) + "</td></tr>").join("") + "</tbody></table></div>" +
    '<label class="note" style="display:block">10. Reasons<textarea data-g9c="reasons.10" rows="2" style="width:100%">' + esc(st.reasons["10"] || "") + "</textarea></label>" +
    '<h3 style="margin-top:12px">12. Reconciliation of input tax credit</h3><div class="bk-tablewrap"><table class="bk-table"><tbody>' +
    "<tr><td>12A</td><td>ITC availed as per the audited financial statements<div class=\"nr\">from the books: " + m(c.itcBooks) + '</div></td><td class="n">' + inp("itcBooks", st.itcBooks, String(c.itcBooks)) + "</td></tr>" +
    "<tr><td>12B</td><td>ITC booked in earlier years claimed in this year (+)</td><td class=\"n\">" + inp("adj.12B", st.adj["12B"]) + "</td></tr>" +
    "<tr><td>12C</td><td>ITC booked in this year to be claimed in later years (\u2013)</td><td class=\"n\">" + inp("adj.12C", st.adj["12C"]) + "</td></tr>" +
    row("12D", "ITC as per the audited financial statements after adjustments", c.d12, 1) + row("12E", "ITC claimed in the annual return (7J)", c.e12) + row("12F", "Unreconciled ITC", c.f12, 1, 1) + "</tbody></table></div>" +
    '<label class="note" style="display:block">13. Reasons<textarea data-g9c="reasons.13" rows="2" style="width:100%">' + esc(st.reasons["13"] || "") + "</textarea></label></section>";
  return h;
}
function gst9PackHtml(which){
  const b = S.books, reg = S.gstReg || (((b.meta || {}).gstins || [])[0] || "").slice(0, 2), fy = GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]), co = CO();
  const head = (t) => '<div style="border-bottom:2px solid #15201B;padding-bottom:8px;margin-bottom:10px"><div style="font-size:12px;color:#5A6B63">' + t + ' \u2014 WORKING FROM THE BOOKS</div><h1 style="font-size:20px;margin:4px 0">' + esc(co.name) + "</h1><div>" + esc(((b.meta || {}).gstins || []).find(g => g.slice(0, 2) === reg) || reg) + " \u00b7 " + GST9.label(fy) + "</div></div>";
  if (which === "9") return head("GSTR-9") + GST9.html(GST9.build(fy, reg)).replace(/<div class="bk-tablewrap">|<\/div>/g, "");
  return head("GSTR-9C") + viewGst9c(b).replace(/<input[^>]*value="([^"]*)"[^>]*>/g, "$1").replace(/<textarea[^>]*>([^<]*)<\/textarea>/g, "<p>$1</p>").replace(/<button[^>]*>[^<]*<\/button>/g, "").replace(/class="bk-tablewrap"/g, "");
}
async function gst9Excel(which){
  await ensureXlsx();
  const b = S.books, reg = S.gstReg || (((b.meta || {}).gstins || [])[0] || "").slice(0, 2), fy = GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]), wb = XLSX.utils.book_new();
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
function viewBooksGst(b){
  const months = GSTR.months(), regs = (b.meta && b.meta.gstins) || [];
  if (!S.gstYm && months.length) S.gstYm = months[months.length - 1];
  // a return is filed for one GSTIN: the company's own first, never the registrations added together
  if (regs.length && !regs.some(g => g.slice(0, 2) === S.gstReg)){ const own = String((CO() || {}).gstin || "").slice(0, 2); S.gstReg = (regs.find(g => g.slice(0, 2) === own) || regs[0]).slice(0, 2); }
  // the parts follow the GSTIN's filing type: QRMP starts from the quarter; composition has its own two returns
  const ftype = typeof GSTSet === "object" && S.gstYm ? GSTSet.typeOf(S.gstYm, S.gstReg || "") : "monthly";
  const parts = ftype === "comp" ? [["cmp08", "CMP-08"], ["gstr4", "GSTR-4"], ["inreg", "Purchases"], ["r2b", "2B reconciliation"]]
    : (ftype === "qrmp" ? [["qtr", "This quarter"], ["r1", "GSTR-1 working"], ["r3b", "GSTR-3B working"]] : [["r1", "GSTR-1"], ["r3b", "GSTR-3B"]])
      .concat([["inreg", "Input register"], ["r2b", "2B reconciliation"], ["follow", "ITC follow-up"], ["adv", "Advances"], ["rev", "Reversal"], ["amend", "Amendments"], ["g9", "GSTR-9"], ["g9c", "GSTR-9C"]]);
  parts.push(["vault", "Returns filed"]);
  // a GSTIN or filing type seen for the first time opens on its first part: This quarter, CMP-08, or GSTR-1
  const seen = (S.gstReg || "") + "|" + ftype;
  if (!S.gstPart || !parts.some(x => x[0] === S.gstPart) || (S.gstSeen && S.gstSeen !== seen)) S.gstPart = parts[0][0];
  S.gstSeen = seen;
  const part = S.gstPart, noReturn = ftype === "qrmp" && !GSTSet.isQEnd(S.gstYm || "");
  let h = ledgerBanner(b, "gst") + '<nav class="sbar" aria-label="GST">' + parts
    .map(([id, l]) => '<button data-gstpart="' + id + '" aria-selected="' + (part === id) + '">' + l + "</button>").join("") + "</nav>";
  h += '<div class="revfilter"><select data-gstym>' + months.map(m => '<option value="' + m + '"' + (S.gstYm === m ? " selected" : "") + ">" + GSTR.label(m) + "</option>").join("") + "</select>" +
    (regs.length > 1 ? '<select data-gstreg>' + regs.map(g => '<option value="' + g.slice(0, 2) + '"' + (S.gstReg === g.slice(0, 2) ? " selected" : "") + ">" + esc(g) + "</option>").join("") + "</select>" : "") +
    (part === "r2b" || part === "rev" || part === "inreg" || part === "follow" || part === "qtr" || part === "vault" || ftype === "comp" ? "" : '<button class="btn small" data-act="gstExcel">Download GSTR-1 and 3B</button>') +
    (part === "amend" && ftype === "monthly" ? '<button class="btn small primary" data-act="gstJson">Download GSTR-1 JSON with these</button>' : "") +
    (part === "r1" && !noReturn ? '<button class="btn small primary" data-act="gstJson">Download GSTR-1 JSON' + (ftype === "qrmp" ? " for the quarter" : " for the portal") + "</button>" : "") +
    (part === "r3b" && !noReturn ? '<button class="btn small primary" data-act="gst3bJson">Download GSTR-3B JSON' + (ftype === "qrmp" ? " for the quarter" : " for the portal") + "</button>" : "") + "</div>";
  // a GSTIN that is not a monthly filer: say so on every part, until its own returns are built
  const ftp = typeof GSTSet === "object" && S.gstYm ? GSTSet.typeOf(S.gstYm, S.gstReg || "") : "monthly";
  if (ftp === "qrmp" && (part === "r1" || part === "r3b")) h += '<p class="note" style="margin:0 0 10px">Quarterly (QRMP) filer: this is the working for ' + esc(GSTR.label(S.gstYm)) + (GSTSet.isQEnd(S.gstYm) ? "; the downloads cover the whole of " + esc(GSTSet.qLabel(S.gstYm)) + "." : ", for reference; this month has no GSTR-1 or 3B \u2014 see \u201cThis quarter\u201d.") + "</p>";
  if (part === "vault") return h + viewGstReturnsFiled(b);
  if (part === "qtr") return h + viewQrmp(b);
  if (part === "cmp08") return h + viewCmp08(b);
  if (part === "gstr4") return h + viewGstr4(b);
  if (part === "r2b") return h + viewBooks2B(b);
  if (part === "inreg") return h + viewInputRegister(b);
  if (part === "follow") return h + viewItcFollow(b);
  if (part === "adv") return h + viewGstAdv(b);
  if (part === "rev") return h + viewGstRev(b);
  if (part === "amend") return h + viewGstAmend(b);
  if (part === "g9") return h + viewGst9(b);
  if (part === "g9c") return h + viewGst9c(b);
  return h + (part === "r1" ? viewGstr1(b) + viewCustRejections(b) : viewGstr3b(b));
}

function viewGstAmend(b){
  const money = v => INR.format(r2(v || 0)), ym = S.gstYm || "", reg = S.gstReg || "", regs = (b.meta && b.meta.gstins) || [];
  const kindName = {B2B: "B2B invoice", B2CL: "B2C large invoice", EXP: "Export invoice", CDNR: "Credit or debit note", B2CS: "B2C small, month total"};
  const table = {B2B: "9A", B2CL: "9A", EXP: "9A", CDNR: "9C", B2CS: "10"};
  let h = "";
  const all = GSTAmend.filed(reg);
  h += '<section class="dash-card"><h3>Filed GSTR-1 returns kept here</h3>' +
    '<p class="note">Amendments are found by comparing the books now with what was filed. A copy is kept each time the GSTR-1 JSON is downloaded here; for a month filed some other way, bring in the JSON that was uploaded to the portal.</p>' +
    '<div class="row" style="gap:8px;margin:8px 0"><button class="btn small primary" data-act="filedPick">Bring in filed GSTR-1 JSON</button></div>' +
    (all.length ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Month</th><th>Registration</th><th>Copy from</th><th class="dt">Kept on</th><th class="n">Documents</th><th class="n">B2C small</th><th>Not filed</th></tr></thead><tbody>' +
      all.map(f => {
        const n = GSTAmend.norm(f.json); let bs = 0; n.b2cs.forEach(x => { bs += num(x.txval); });
        return "<tr><td>" + GSTR.label(f.ym) + "</td><td>" + esc(f.gstin) + "</td><td>" + (f.source === "portal" ? "brought in" : "downloaded here") + "</td><td>" + fmtDate(String(f.at).slice(0, 10)) +
          '</td><td class="n">' + n.docs.size + '</td><td class="n">' + money(bs) + '</td><td><input type="checkbox" data-filednot="' + esc(f.gstin + "|" + f.fp) + '"' + (f.notFiled ? " checked" : "") +
          ' aria-label="This copy was not filed"></td></tr>';
      }).join("") + "</tbody></table></div>" : '<p class="note">None yet.</p>') + "</section>";
  if (regs.length > 1 && !reg) return h + '<p class="note" style="margin-top:12px">Choose a registration above to see its amendments.</p>';
  if (!ym) return h;
  const c = GSTAmend.check(ym, reg);
  if (c){
    h += '<section class="dash-card" style="margin-top:12px"><h3>' + GSTR.label(ym) + ": the books against the return filed</h3>" +
      '<div class="dash-row"><span>Taxable value filed</span><b>' + money(c.filedTotal) + '</b></div><div class="dash-row"><span>Taxable value in the books now</span><b>' + money(c.booksTotal) + "</b></div>" +
      (Math.abs(c.b2csF - c.b2csB) >= 1 ? '<div class="dash-row"><span>B2C small: filed / books</span><b>' + money(c.b2csF) + " / " + money(c.b2csB) + "</b></div>" : "") +
      (c.rows.length ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Document</th><th>Party</th><th>Number</th><th class="dt">Date</th><th>What differs</th></tr></thead><tbody>' +
        c.rows.slice(0, 200).map(r => "<tr><td>" + esc(kindName[r.kind] || r.kind) + "</td><td>" + esc(r.doc.ctin || "\u2014") + "</td><td>" + esc(r.doc.num) + "</td><td>" + fmtDate(tallyDate(r.doc.date)) + "</td><td>" + esc(r.changes.join("; ")) + "</td></tr>").join("") +
        "</tbody></table></div>" : '<p class="note">Every document in the books matches the return filed.</p>') +
      '<p class="note">Differences here are reported as amendments in a later month’s return, not by filing this month again.</p></section>';
  }
  const p = GSTAmend.pending(ym, reg);
  const live = p.rows.filter(r => r.act !== "skip");
  const count = f => live.filter(f).length;
  h += '<div class="dash-tiles" style="margin-top:12px">' +
    '<div class="dtile"><span>9A amended invoices</span><b>' + count(r => r.kind !== "CDNR" && (r.what === "amend" || r.what === "gone")) + "</b><small>B2B, B2C large and exports</small></div>" +
    '<div class="dtile"><span>9C amended notes</span><b>' + count(r => r.kind === "CDNR" && (r.what === "amend" || r.what === "gone")) + "</b><small>credit and debit notes</small></div>" +
    '<div class="dtile"><span>Missed, reported now</span><b>' + count(r => r.what === "missing") + "</b><small>with their original number and date</small></div>" +
    '<div class="dtile"><span>10 B2C small corrected</span><b>' + count(r => r.kind === "B2CS") + "</b><small>months, rates and places revised</small></div></div>";
  h += '<section class="dash-card" style="margin-top:12px"><h3>To report in ' + GSTR.label(ym) + "’s GSTR-1</h3>" +
    '<p class="note">Earlier months’ documents that differ from what was filed. Each goes into this month’s JSON as chosen; an amendment already filed in an earlier month’s return is not repeated.</p>' +
    (p.periods.length ? '<p class="note">Compared: ' + p.periods.map(GSTR.label).join(", ") + ".</p>" : "") +
    (p.noCopy.length ? '<p class="note" style="color:#B9541B">No filed copy for ' + p.noCopy.map(GSTR.label).join(", ") + ", so those months are not compared.</p>" : "") +
    (p.late.length ? '<p class="note">Past the time to amend (November after the year): ' + p.late.map(GSTR.label).join(", ") + ".</p>" : "") +
    (p.rows.length ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Month filed</th><th>Document</th><th>GSTIN</th><th>Number</th><th class="dt">Date</th><th class="n">Taxable now</th><th>What differs</th><th>Report it as</th></tr></thead><tbody>' +
      p.rows.map(r => {
        const d = r.now || r.was;
        const opts = r.what === "amend" ? [["amend", "amendment (" + table[r.kind] + ")"], ["skip", "leave it"]]
          : r.what === "gone" ? [["nil", "amendment to nil (" + table[r.kind] + ")"], ["skip", "leave it"]]
          : (r.kind === "B2B" ? [["b2c", "was in B2C small: 4A now and table 10"], ["missed", "missed: 4A now"]] : [["missed", "missed: report now"]]).concat([["skip", "leave it"]]);
        return "<tr><td>" + GSTR.label(r.P) + "</td><td>" + esc(kindName[r.kind] || r.kind) + "</td><td>" + esc(d.ctin || "\u2014") + "</td><td>" + esc(d.num) + "</td><td>" + fmtDate(tallyDate(d.date)) +
          '</td><td class="n">' + (r.now ? money(r.now.txval) : "\u2014") + "</td><td>" + esc(r.changes.join("; ")) + '</td><td><select data-amendact="' + esc(r.id) + '">' +
          opts.map(([v, l]) => '<option value="' + v + '"' + (r.act === v ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select></td></tr>";
      }).join("") + "</tbody></table></div>"
      : '<p class="note">' + (p.periods.length ? "Nothing to amend: the books agree with what was filed." : "Nothing to compare yet.") + "</p>") + "</section>";
  h += '<p class="note">Amendments can be made up to 30 November after the end of the year (section 37(3)). A renumbered invoice, or one whose GSTIN was corrected, is one amendment (9A, with the original number). When B2C small figures of a month change \u2014 an invoice lost its GSTIN, or gained one \u2014 table 10 carries the month\u2019s revised figures.</p>';
  if (typeof viewGstr1a === "function") h += viewGstr1a(b, ym, reg);
  return h;
}
function viewGstAdv(b){
  const money = v => INR.format(r2(v || 0));
  if (!GSTAdv.ready()) return '<section class="dash-card"><h3>Advances need the day book read again</h3><p class="note">Advances are worked out from the bill-wise details in Tally (New Ref, Advance, On Account, Agst Ref). The day book here was read before those were kept. Under “From Tally”, choose the same day book XML again; nothing you set is lost.</p></section>';
  const ym = S.gstYm || "", reg = S.gstReg || "", a = GSTAdv.month(ym, reg);
  const tile = (label, s, note) => '<div class="dtile"><span>' + label + "</span><b>" + s.n + "</b><small>" + money(s.received) + " received, " + money(s.igst + s.cgst + s.sgst + s.cess) + " tax</small>" + (note ? "<small>" + note + "</small>" : "") + "</div>";
  const netTax = r2(a.net.igst + a.net.cgst + a.net.sgst + a.net.cess);
  let h = '<div class="dash-tiles">' + tile("Received, not billed this month (11A)", a.atSum) + tile("Billed now, received earlier (11B)", a.txpdSum) +
    '<div class="dtile"><span>Into 3B 3.1(a)</span><b>' + money(netTax) + '</b><small>tax on ' + money(a.net.taxable) + " net of 11B</small></div>" +
    '<div class="dtile"><span>Left out</span><b>' + a.untaxed.length + '</b><small>goods, exports, on account or marked</small></div></div>';
  const months = GSTR.months();
  const rateSel = r => '<select data-advrate="' + esc(r.id) + '" title="Rate: ' + esc(r.rateFrom) + '">' + GSTAdv.RATES.filter(x => x > 0).map(x => '<option value="' + x + '"' + (x === r.rate ? " selected" : "") + ">" + x + "%</option>").join("") + "</select>" +
    (r.rateFrom === "set" ? "" : '<br><small class="note"' + (r.rateFrom === "assumed" ? ' style="color:#B9541B"' : "") + ">" + (r.rateFrom === "assumed" ? "assumed, no invoice" : "from the " + esc(r.rateFrom)) + "</small>");
  const head = '<th class="dt">Date</th><th>Receipt</th><th>Customer</th><th>Bill ref</th><th class="n">Received</th><th class="n">Rate</th><th>Place of supply</th><th class="n">Advance, less tax</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th>';
  const cells = r => '<td class="n">' + money(r.taxable) + '</td><td class="n">' + money(r.igst) + '</td><td class="n">' + money(r.cgst) + '</td><td class="n">' + money(r.sgst) + "</td>";
  h += '<section class="dash-card" style="margin-top:12px"><h3>11A Advances received</h3>' +
    '<p class="note">Money a customer paid before the invoice, for services. An advance billed in the same month is left out, as the return asks. The rate is taken from the customer’s invoice nearest the receipt; change it where it is wrong.</p>' +
    (a.at.length ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr>' + head + '<th>Not an advance</th></tr></thead><tbody>' +
      a.at.map(r => "<tr><td>" + fmtDate(tallyDate(r.date)) + "</td><td>" + esc(r.no) + "</td><td>" + esc(r.party) + (r.gstin ? '<br><small class="note">' + esc(r.gstin) + "</small>" : "") + "</td><td>" + esc(r.ref || "\u2014") +
        '</td><td class="n">' + money(r.received) + '</td><td class="n">' + rateSel(r) + "</td><td>" + esc(r.pos) + '<br><small class="note">' + (r.inter ? "inter-state" : "same state") + "</small></td>" + cells(r) +
        '<td><input type="checkbox" data-advskip="' + esc(r.id) + '" aria-label="Not an advance"></td></tr>').join("") +
      '<tr><td colspan="4"><b>Total</b></td><td class="n"><b>' + money(a.atSum.received) + '</b></td><td></td><td></td>' + cells(a.atSum) + "<td></td></tr></tbody></table></div>"
      : '<p class="note">No advance received this month.</p>') + "</section>";
  h += '<section class="dash-card" style="margin-top:12px"><h3>11B Advances adjusted</h3>' +
    '<p class="note">An advance from an earlier month that an invoice (or a refund) used up this month. The tax paid on it then comes off now, at the same rate.</p>' +
    (a.txpd.length ? '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Adjusted on</th><th>By</th><th>Customer</th><th>Received in</th><th class="n">Amount</th><th class="n">Rate</th><th>Place of supply</th><th class="n">Advance, less tax</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>' +
      a.txpd.map(r => "<tr><td>" + fmtDate(tallyDate(r.adjDate)) + "</td><td>" + esc(r.how === "marked" ? "marked by hand" : (r.how === "refund" ? "refund " : "") + (r.by || "")) + "</td><td>" + esc(r.party) + "</td><td>" + GSTR.label(r.receivedYm) +
        '</td><td class="n">' + money(r.received) + '</td><td class="n">' + r.rate + "%</td><td>" + esc(r.pos) + "</td>" + cells(r) + "</tr>").join("") +
      '<tr><td colspan="4"><b>Total</b></td><td class="n"><b>' + money(a.txpdSum.received) + '</b></td><td></td><td></td>' + cells(a.txpdSum) + "</tr></tbody></table></div>"
      : '<p class="note">No earlier advance was adjusted this month.</p>') + "</section>";
  if (a.open.length && ym){
    const later = months.filter(m => m > ym);
    h += '<section class="dash-card" style="margin-top:12px"><h3>Advances still open at the end of ' + GSTR.label(ym) + "</h3>" +
      '<p class="note">Not yet billed or refunded in these books. If one was used up by an invoice that is not tied to it in Tally, pick the month it was billed.</p>' +
      '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Received</th><th>Customer</th><th>Bill ref</th><th class="n">Amount</th><th class="n">Still open</th><th>Billed in</th></tr></thead><tbody>' +
      a.open.map(p => {
        const left = r2(p.amount - p.adj.filter(x => x.ym <= ym).reduce((s, x) => s + x.amount, 0));
        return "<tr><td>" + fmtDate(tallyDate(p.date)) + "</td><td>" + esc(p.party) + "</td><td>" + esc(p.ref || "\u2014") + '</td><td class="n">' + money(p.amount) + '</td><td class="n">' + money(left) +
          '</td><td><select data-advadj="' + esc(p.id) + '"><option value="">not yet</option>' + later.concat(p.fix.adjYm && !later.includes(p.fix.adjYm) ? [p.fix.adjYm] : [])
            .map(m => '<option value="' + m + '"' + (p.fix.adjYm === m ? " selected" : "") + ">" + GSTR.label(m) + "</option>").join("") + "</select></td></tr>";
      }).join("") + "</tbody></table></div></section>";
  }
  if (a.untaxed.length){
    h += '<section class="dash-card" style="margin-top:12px"><h3>Received early, but not in 11A</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="dt">Date</th><th>Customer</th><th>Bill ref</th><th class="n">Received</th><th>Why</th><th>Count it</th></tr></thead><tbody>' +
      a.untaxed.map(r => {
        const p = GSTAdv.build().pieces.find(x => x.id === r.id) || {fix: {}};
        const ctl = p.skip ? '<input type="checkbox" data-advskip="' + esc(r.id) + '" checked aria-label="Not an advance"> not an advance'
          : p.type === "On Account" ? '<input type="checkbox" data-advtake="' + esc(r.id) + '"' + (p.fix.isAdv ? " checked" : "") + ' aria-label="Count as an advance"> it is an advance' : "";
        return "<tr><td>" + fmtDate(tallyDate(r.date)) + "</td><td>" + esc(r.party) + "</td><td>" + esc(r.ref || r.type) + '</td><td class="n">' + money(r.received) + "</td><td>" + esc(r.why) + "</td><td>" + ctl + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
  }
  h += '<p class="note">Read from receipts against a customer before the invoice: a New Ref, an Advance, or an Agst Ref to such a ref before it is billed. A receipt from a ledger not under Sundry Debtors is not counted; bring the ledger masters in for this. Tax on advances for goods is not payable (notification 66/2017).</p>';
  return h;
}
function viewGstRev(b){
  const money = v => INR.format(r2(v || 0)), ym = S.gstYm || "", reg = S.gstReg || "";
  const pct = k => (Math.round(k * 10000) / 100) + "%";
  const heads = x => '<td class="n">' + money(x.igst) + '</td><td class="n">' + money(x.cgst) + '</td><td class="n">' + money(x.sgst) + '</td><td class="n">' + money(x.cess) + "</td>";
  const th = '<th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Cess</th>';
  if (!ym) return '<p class="note">Pick a month.</p>';
  const r42 = GSTRev.rule42(ym, reg), r43 = GSTRev.rule43(ym, reg), q = r42.ratio, t = q.t, set = GSTRev.settings();
  const commonLeds = Object.values(b.map || {}).filter(m => m.kind === "gst_common").length;
  const tot = GSTRev.add(r42.reverse, r43.Te);
  let h = '<div class="dash-tiles"><div class="dtile"><span>Exempt share of turnover (E ÷ F)</span><b>' + pct(r42.share) + "</b><small>" + money(q.E) + " of " + money(q.F) + (q.from && q.from !== ym ? ", taken from " + GSTR.label(q.from) : "") + "</small></div>" +
    '<div class="dtile"><span>Rule 42, reversed</span><b>' + money(GSTRev.total(r42.reverse)) + "</b><small>on common credit of " + money(GSTRev.total(r42.C2)) + "</small></div>" +
    '<div class="dtile"><span>Rule 43, reversed</span><b>' + money(GSTRev.total(r43.Te)) + "</b><small>" + r43.used.length + " capital good" + (r43.used.length === 1 ? "" : "s") + " in use</small></div>" +
    '<div class="dtile"><span>Into 3B 4(B)(1)</span><b>' + money(GSTRev.total(tot)) + "</b><small>" + GSTR.label(ym) + "</small></div></div>";
  h += '<section class="dash-card" style="margin-top:12px"><h3>Turnover of the month</h3><div class="bk-tablewrap"><table class="bk-table"><tbody>' +
    '<tr><td>Taxable, net of credit notes</td><td class="n">' + money(t.taxable) + "</td></tr><tr><td>Exports and SEZ</td><td class=\"n\">" + money(t.zero) + "</td></tr>" +
    "<tr><td>Exempt, nil rated and non-GST (E)</td><td class=\"n\">" + money(t.exempt) + "</td></tr><tr><td><b>Total turnover (F)</b></td><td class=\"n\"><b>" + money(t.total) + "</b></td></tr></tbody></table></div>" +
    (t.total ? "" : '<p class="note">No turnover this month, so E and F of ' + (q.from ? GSTR.label(q.from) : "no earlier month") + " are used, as rule 42(1)(h) says.</p>") + "</section>";
  h += '<section class="dash-card" style="margin-top:12px"><h3>Rule 42: common inputs and input services</h3>' +
    (commonLeds ? "" : '<p class="note" style="color:#B9541B">No ledger is marked “GST, common credit” yet. On the Ledgers tab, mark the input tax ledgers that carry credit used for both taxable and exempt (or non-business) supplies.</p>') +
    '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th></th>' + th + "</tr></thead><tbody>" +
    "<tr><td>C2 Common credit (" + r42.n + " voucher" + (r42.n === 1 ? "" : "s") + ")</td>" + heads(r42.C2) + "</tr>" +
    "<tr><td>D1 For exempt supplies: C2 × E ÷ F</td>" + heads(r42.D1) + "</tr>" +
    "<tr><td>D2 For non-business use: 5% of C2</td>" + heads(r42.D2) + "</tr>" +
    "<tr><td><b>Reversed: D1 + D2</b></td>" + heads(r42.reverse) + "</tr>" +
    "<tr><td>C3 Credit kept</td>" + heads(r42.C3) + "</tr></tbody></table></div>" +
    '<p class="note" style="margin-top:8px">D2 (5% for non-business use): <b>' + (set.d2 ? "applies" : "does not apply") + "</b> \u00b7 " + (typeof gstSetLink === "function" ? gstSetLink() : "") + "</p></section>";
  const y = GSTRev.year(ym, reg);
  if (y.rows.length){
    const fyLabel = y.fy + "-" + String(num(y.fy) + 1).slice(2);
    const more = GSTRev.total(y.diff);
    h += '<section class="dash-card" style="margin-top:12px"><h3>Rule 42(2): the year ' + esc(fyLabel) + " worked out again</h3>" +
      '<p class="note">After the year, D1 is worked out on the whole year’s turnover. ' + y.rows.length + " of 12 months are in these books.</p>" +
      '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Month</th><th class="n">Common credit</th><th class="n">E ÷ F</th><th class="n">D1</th></tr></thead><tbody>' +
      y.rows.map(r => "<tr><td>" + GSTR.label(r.ym) + '</td><td class="n">' + money(GSTRev.total(r.C2)) + '</td><td class="n">' + pct(r.share) + '</td><td class="n">' + money(GSTRev.total(r.D1)) + "</td></tr>").join("") +
      '<tr><td><b>Year</b></td><td class="n"><b>' + money(GSTRev.total(y.C2)) + '</b></td><td class="n"><b>' + pct(y.share) + '</b></td><td class="n"><b>' + money(GSTRev.total(y.monthly)) + "</b></td></tr></tbody></table></div>" +
      '<div class="bk-tablewrap" style="margin-top:8px"><table class="bk-table"><thead><tr><th></th>' + th + "</tr></thead><tbody>" +
      "<tr><td>D1 on the year’s turnover</td>" + heads(y.annual) + "</tr><tr><td>Less: D1 reversed month by month</td>" + heads(y.monthly) + "</tr>" +
      "<tr><td><b>" + (more > 0 ? "To reverse more, with interest under section 50" : more < 0 ? "To take back as credit" : "Difference") + "</b></td>" + heads(y.diff) + "</tr></tbody></table></div>" +
      '<p class="note">Reverse the extra in 4(B)(1), or take the excess back in 4(A)(5), in a return up to September after the year ends.</p></section>';
  }
  const regs = (b.meta && b.meta.gstins) || [], assets = b.assets || [];
  h += '<section class="dash-card" style="margin-top:12px"><h3>Rule 43: capital goods</h3>' +
    '<p class="note">The credit on a capital good used for both taxable and exempt supplies is spread over 60 months, 5% a quarter, from the month it is put to use. Each month, the exempt share of that month’s part (Tr × E ÷ F) is reversed. A good used only for taxable supplies keeps all its credit; one used only for exempt or non-business supplies gets none, so mark those and they are left out.</p>' +
    '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Capital good</th><th class="dt">Put to use</th>' + th + "<th>Used for</th>" + (regs.length > 1 ? "<th>Registration</th>" : "") + '<th class="dt">Sold on</th><th class="n">This month (Tm)</th><th></th></tr></thead><tbody>' +
    assets.map(a => {
      const f = (k, type, w) => '<input type="' + type + '" data-asset="' + esc(a.id) + ":" + k + '" value="' + esc(a[k] == null ? "" : a[k]) + '" style="width:' + w + '"' + (type === "number" ? ' step="0.01" min="0"' : "") + ">";
      const tmv = GSTRev.tm(a, ym);
      return "<tr><td>" + f("name", "text", "130px") + "</td><td>" + f("date", "date", "128px") + "</td><td>" + f("igst", "number", "88px") + "</td><td>" + f("cgst", "number", "80px") + "</td><td>" + f("sgst", "number", "80px") + "</td><td>" + f("cess", "number", "64px") + "</td>" +
        '<td><select style="min-width:150px" data-asset="' + esc(a.id) + ':use">' + [["common", "taxable and exempt"], ["taxable", "taxable only"], ["exempt", "exempt or non-business only"]].map(([v, l]) => '<option value="' + v + '"' + ((a.use || "common") === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></td>" +
        (regs.length > 1 ? '<td><select data-asset="' + esc(a.id) + ':reg"><option value="">any</option>' + regs.map(g => '<option value="' + g.slice(0, 2) + '"' + (a.reg === g.slice(0, 2) ? " selected" : "") + ">" + esc(g.slice(0, 2)) + "</option>").join("") + "</select></td>" : "") +
        "<td>" + f("sold", "date", "130px") + '</td><td class="n">' + (tmv ? money(GSTRev.total(tmv)) : "\u2014") + '</td><td><button class="btn small" data-assetdel="' + esc(a.id) + '">Remove</button></td></tr>';
    }).join("") + "</tbody></table></div>" +
    '<div class="row" style="gap:8px;margin-top:8px"><button class="btn small" data-act="assetAdd">Add a capital good</button></div>' +
    (r43.used.length ? '<div class="bk-tablewrap" style="margin-top:8px"><table class="bk-table"><thead><tr><th></th>' + th + "</tr></thead><tbody><tr><td>Tr, credit of the month on common capital goods</td>" + heads(r43.Tr) +
      "</tr><tr><td><b>Te, reversed: Tr × E ÷ F</b></td>" + heads(r43.Te) + "</tr></tbody></table></div>" : "") + "</section>";
  h += '<p class="note">Both rules go into 3B table 4(B)(1). Credit marked “GST, ITC not to be taken” stays in 4(B)(2), as before.</p>';
  return h;
}

function viewGstr1(b){
  const g = GSTR.one(S.gstYm || "", S.gstReg || ""), money = v => INR.format(r2(v || 0));
  const box = (label, s, cls) => '<div class="dtile' + (cls || "") + '"><span>' + label + "</span><b>" + s.n + "</b><small>" + money(s.taxable) + " + " + money(s.igst + s.cgst + s.sgst) + " tax</small></div>";
  let h = '<div class="dash-tiles">' + box("B2B (4A)", GSTR.sum(g.b2b)) + box("B2C large (5)", GSTR.sum(g.b2cl)) + box("B2C small (7)", GSTR.sum(g.b2c)) + box("Notes (9B)", GSTR.sum(g.cdnr)) + "</div>" +
    '<div class="dash-tiles">' + box("Exports and SEZ (6)", GSTR.sum(g.exp)) + box("Nil, exempt, non-GST (8)", GSTR.sum(g.nil)) + box("Reverse charge (4B)", GSTR.sum(g.rcm)) + box("All outward", g.total) + "</div>";
  if (S.gstReg && GSTAmend.filed(S.gstReg).length){
    const p = GSTAmend.pending(S.gstYm || "", S.gstReg), live = p.rows.filter(r => r.act !== "skip");
    if (live.length) h += '<div class="dash-tiles"><div class="dtile warn"><span>Earlier months to amend</span><b>' + live.length + '</b><small><button class="linkbtn" data-gstpart="amend">See them</button>; they go into this month\u2019s JSON</small></div></div>';
  }
  if (GSTAdv.ready()){
    const a = GSTAdv.month(S.gstYm || "", S.gstReg || "");
    if (a.at.length || a.txpd.length) h += '<div class="dash-tiles">' + box("Advances received (11A)", a.atSum) + box("Advances adjusted (11B)", a.txpdSum) +
      '<div class="dtile"><span>Advances</span><b><button class="linkbtn" data-gstpart="adv">See them</button></b><small>in the JSON as at and txpd</small></div></div>';
  }
  const rows = g.b2b.concat(g.b2cl).concat(g.b2c).concat(g.cdnr).concat(g.exp).concat(g.nil);
  {
    const f = S.r1F || {}, qq = String(f.q || "").toLowerCase();
    const shown = rows.filter(r => (!qq || (r.party + " " + r.no + " " + r.gstin).toLowerCase().includes(qq)) && (!f.part || r.kind === f.part));
    const by = {};
    shown.forEach(r => {
      const k = r.gstin || normName(r.party) || "retail";
      const p = by[k] = by[k] || {party: r.party || "Retail customers", gstin: r.gstin, n: 0, taxable: 0, tax: 0, rows: []};
      p.n++; p.taxable = r2(p.taxable + r.taxable); p.tax = r2(p.tax + r.igst + r.cgst + r.sgst); p.rows.push(r);
    });
    const parties = Object.values(by).sort((a, b) => b.taxable - a.taxable);
    h += filterBar("r1F", {placeholder: "Find a customer, invoice or GSTIN", table: "r1Table", title: CO().name + " GSTR-1 " + GSTR.label(S.gstYm || ""), excel: "gstExcel",
      count: parties.length + " customers \u00b7 " + shown.length + " of " + rows.length + " documents",
      selects: [{key: "part", options: [["", "Every part"], ["B2B", "B2B (4A)"], ["B2CL", "B2C large (5)"], ["B2C", "B2C small (7)"], ["CDNR", "Credit notes (9B)"], ["EXP", "Exports (6)"], ["NIL", "Nil and exempt (8)"]]}]});
    h += '<div class="bk-tablewrap"><table class="bk-table" id="r1Table"><thead><tr><th>Customer</th><th>GSTIN</th><th class="n">Documents</th><th class="n">Taxable</th><th class="n">Tax</th></tr></thead><tbody>' +
      parties.map(p => {
        const key = p.gstin || normName(p.party), isOpen = S.r1Open === key;
        let row = "<tr><td>" + '<button class="linkbtn" data-r1open="' + esc(key) + '">' + (isOpen ? "\u25be " : "\u25b8 ") + esc(p.party) + "</button></td><td>" + esc(p.gstin || "\u2014") +
          '</td><td class="n"><button class="linkbtn" data-r1open="' + esc(key) + '">' + p.n + '</button></td><td class="n">' + money(p.taxable) + '</td><td class="n"><b>' + money(p.tax) + "</b></td></tr>";
        if (isOpen) row += '<tr><td colspan="5" style="background:var(--paper);padding:0"><table class="bk-table" style="margin:0"><thead><tr><th>Part</th><th class="dt">Date</th><th>Invoice</th><th>Place of supply</th><th class="n">Rate</th><th class="n">Taxable</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>' +
          p.rows.map(r => "<tr><td>" + r.kind + "</td><td>" + fmtDate(tallyDate(r.date)) + "</td><td>" + esc(r.no) + "</td><td>" + esc(r.pos || "") + '</td><td class="n">' + r.rate +
            '%</td><td class="n">' + money(r.taxable) + '</td><td class="n">' + money(r.igst) + '</td><td class="n">' + money(r.cgst) + '</td><td class="n">' + money(r.sgst) + "</td></tr>").join("") +
          "</tbody></table></td></tr>";
        return row;
      }).join("") +
      '<tr><td><b>Total</b></td><td></td><td class="n">' + shown.length + '</td><td class="n">' + money(shown.reduce((a, r) => a + r.taxable, 0)) +
      '</td><td class="n"><b>' + money(shown.reduce((a, r) => a + r.igst + r.cgst + r.sgst, 0)) + "</b></td></tr>" +
      "</tbody></table>" + (parties.length ? "" : '<div class="bk-none">Nothing matches.</div>') + "</div>";
  }
  h += '<section class="dash-card" style="margin-top:12px"><h3>HSN summary (12)</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>HSN</th><th>Goods or services</th><th class="n">Rate</th><th class="n">Invoices</th><th class="n">Taxable</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>' +
    g.hsn.map(x => "<tr><td>" + (x.hsn ? esc(x.hsn) : '<span class="tag warn">no HSN</span>') + "</td><td>" + esc(x.supply || "") + '</td><td class="n">' + x.rate + '%</td><td class="n">' + x.n + '</td><td class="n">' + money(x.taxable) + '</td><td class="n">' + money(x.igst) + '</td><td class="n">' + money(x.cgst) + '</td><td class="n">' + money(x.sgst) + "</td></tr>").join("") + "</tbody></table></div></section>";
  if (g.ecoBy && g.ecoBy.length){
    h += '<section class="dash-card" style="margin-top:12px"><h3>Supplies through an e-commerce operator (14)</h3>' +
      '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Operator</th><th class="n">Documents</th><th class="n">Taxable</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">TCS collected</th></tr></thead><tbody>' +
      g.ecoBy.map(e => "<tr><td>" + esc(({amazon: "Amazon", flipkart: "Flipkart", shopify: "Shopify"})[e.eco] || e.eco) + '</td><td class="n">' + e.n +
        '</td><td class="n">' + money(e.taxable) + '</td><td class="n">' + money(e.igst) + '</td><td class="n">' + money(e.cgst) + '</td><td class="n">' + money(e.sgst) +
        '</td><td class="n">' + money(e.tcs) + "</td></tr>").join("") + "</tbody></table></div>" +
      '<p class="note">The operator pays this TCS under section 52; claim it from your cash ledger after checking it against GSTR-2B or the TCS statement.</p></section>';
  }
  h += '<section class="dash-card" style="margin-top:12px"><h3>Documents issued (13)</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Nature</th><th>Series</th><th>From</th><th>To</th><th class="n">Total</th><th class="n">Cancelled</th><th class="n">Net issued</th></tr></thead><tbody>' +
    g.series.slice().sort((a, c) => a.nat - c.nat).map(x => "<tr><td>" + ({1: "Invoices for outward supply", 4: "Debit notes", 5: "Credit notes"})[x.nat] + "</td><td>" + esc(x.pre || "\u2014") + "</td><td>" + esc(x.from) + "</td><td>" + esc(x.to) + '</td><td class="n">' + x.n + '</td><td class="n">' + x.cancelled + '</td><td class="n">' + (x.n - x.cancelled) + "</td></tr>").join("") + "</tbody></table></div>" +
    '<p class="note">Cancelled vouchers are counted from Tally (marked cancelled there); a number missing from a series is not, so enter or cancel it in Tally first.</p></section>';
  h += viewGstChecks();
  return h;
}
function viewGstChecks(){
  const list = GSTR.checks(S.gstYm || "", S.gstReg || "");
  if (!list.length) return '<section class="dash-card" style="margin-top:12px"><h3>Before filing</h3><p class="note">Nothing to fix for this month.</p></section>';
  return '<section class="dash-card" style="margin-top:12px"><h3>Before filing</h3>' +
    list.map(c => '<div class="dash-row"><span>' + esc(c.what) + '</span><b>' + c.n + "</b></div>" +
      '<p class="note" style="margin:0 0 8px">' + esc(c.how) + " e.g. " + esc(c.rows.map(r => (r.no || r.party || "").slice(0, 22)).join(", ")) + "</p>").join("") + "</section>";
}
function viewGstr3b(b){
  const t = GSTR.threeB(S.gstYm || "", S.gstReg || ""), money = v => INR.format(r2(v || 0));
  const choice = ((b.itcBasis || {})[S.gstReg || ""]) || "2b";
  const ft = typeof GSTSet === "object" ? GSTSet.typeOf(S.gstYm || "", S.gstReg || "") : "monthly";
  const basisBar = '<div class="gf-ctl" style="margin-bottom:10px"><span class="note">Credit in table 4: <b>' + (choice === "2b" ? "as far as 2B shows it" : "as booked in Tally") + "</b> \u00b7 filing " + esc(typeof GSTSet === "object" ? GSTSet.typeLabel(ft).toLowerCase() : "monthly") + " \u00b7 " + (typeof gstSetLink === "function" ? gstSetLink() : "") + "</span>" +
    '<span class="note">' + (t.basis === "2b" ? "This month\u2019s 2B is here; bills not in it are held back." : t.basis === "no 2B" ? "No 2B for this month here, so the books are used; bring it in under 2B reconciliation." : "As booked.") + "</span></div>";
  const row = (label, x, bold) => "<tr><td>" + (bold ? "<b>" + label + "</b>" : label) + '</td><td class="n">' + money(x.taxable) + '</td><td class="n">' + money(x.igst) + '</td><td class="n">' + money(x.cgst) + '</td><td class="n">' + money(x.sgst) + "</td></tr>";
  const gap = '<tr><td colspan="5" style="height:8px"></td></tr>';
  let h = basisBar + '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>3.1 Outward supplies and inward on reverse charge</th><th class="n">Taxable</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>' +
    row("(a) Outward taxable supplies, other than zero rated, nil and exempt", t.sale) +
    (t.adv.taxable || t.adv.igst || t.adv.cgst ? row("Add: tax on advances, 11A less 11B", t.adv) : "") +
    row("Less: credit notes", {taxable: -t.cn.taxable, igst: -t.cn.igst, cgst: -t.cn.cgst, sgst: -t.cn.sgst}) +
    (t.custRej && t.custRej.add.n ? row("Add: our credit notes rejected by customers in IMS (" + t.custRej.add.n + ")", t.custRej.add) : "") +
    (t.custRej && t.custRej.back.n ? row("Less: of those, accepted later (" + t.custRej.back.n + ")", {taxable: -t.custRej.back.taxable, igst: -t.custRej.back.igst, cgst: -t.custRej.back.cgst, sgst: -t.custRej.back.sgst}) : "") +
    row("(b) Outward zero rated: exports and SEZ", t.zero) +
    row("(c) Other outward: nil rated and exempt", t.nil) +
    row("(d) Inward supplies on which tax is payable by you (reverse charge)", t.rcmOut) +
    row("(e) Non-GST outward supplies", t.nongst) +
    gap + row("Net outward, taxable", t.net, true) +
    "</tbody></table></div>";
  h += '<div class="bk-tablewrap" style="margin-top:12px"><table class="bk-table"><thead><tr><th>3.2 Of 3.1(a), inter-state supplies to unregistered persons, by place of supply</th><th class="n">Taxable</th><th class="n">IGST</th></tr></thead><tbody>' +
    (t.unregPos.length ? t.unregPos.map(x => "<tr><td>" + esc(x.pos + " " + (Object.keys(STATE_CODES).find(k => STATE_CODES[k] === x.pos) || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())) + '</td><td class="n">' + money(x.taxable) + '</td><td class="n">' + money(x.igst) + "</td></tr>").join("") : '<tr><td colspan="3" class="nr">None this month.</td></tr>') + "</tbody></table></div>";
  h += '<div class="bk-tablewrap" style="margin-top:12px"><table class="bk-table"><thead><tr><th>4 Input tax credit</th><th class="n">Value</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>' +
    row("(A)(1) Import of goods", {taxable: t.impGoods.taxable, igst: t.impGoods.igst, cgst: t.impGoods.cgst, sgst: t.impGoods.sgst}) +
    row("(A)(2) Import of services", {taxable: t.impServ.taxable, igst: t.impServ.igst, cgst: t.impServ.cgst, sgst: t.impServ.sgst}) +
    row("(A)(3) Inward supplies on reverse charge", {taxable: t.rcmIn.taxable, igst: t.rcmIn.igst, cgst: t.rcmIn.cgst, sgst: t.rcmIn.sgst}) +
    row("(A)(5) All other ITC", {taxable: t.other.taxable, igst: t.other.igst, cgst: t.other.cgst, sgst: t.other.sgst}) +
    (t.basis === "2b" && (t.held.n || t.released.n || (t.cn2b && t.cn2b.n) || (t.rejBack && t.rejBack.n)) ? '<tr><td colspan="5" class="nr" style="white-space:normal">' + (t.held.n ? "Held back, not yet in 2B: " + t.held.n + " bill" + (t.held.n === 1 ? "" : "s") + ", \u20b9" + money(t.held.igst + t.held.cgst + t.held.sgst + t.held.cess) + ". " : "") +
      (t.released.n ? "Taken now, booked earlier and in this month\u2019s 2B: " + t.released.n + ", \u20b9" + money(t.released.igst + t.released.cgst + t.released.sgst + t.released.cess) + ". " : "") +
      (t.rejBack && t.rejBack.n ? "Credit notes rejected in IMS, not reducing credit: " + t.rejBack.n + ", \u20b9" + money(t.rejBack.igst + t.rejBack.cgst + t.rejBack.sgst + t.rejBack.cess) + ". " : "") +
      (t.cn2b && t.cn2b.n ? "Less suppliers\u2019 credit notes in 2B, not in Tally: " + t.cn2b.n + ", \u20b9" + money(t.cn2b.igst + t.cn2b.cgst + t.cn2b.sgst + t.cn2b.cess) + ". " : "") + '<button class="linkbtn" data-gstpart="follow">See them</button></td></tr>' : "") +
    gap + row("(B)(1) Reversed: rules 38, 42, 43 and section 17(5)", {taxable: "", igst: t.rev1.igst, cgst: t.rev1.cgst, sgst: t.rev1.sgst}) +
    '<tr><td>(B)(2) Reversed: others (rule 37, and credit that may come back)<div class="nr">type any here</div></td><td class="n"></td>' + ["igst", "cgst", "sgst"].map(k => '<td class="n"><input type="number" step="0.01" data-g3b="rev2.' + k + '" value="' + esc((((b.gst3b || {})[(S.gstReg || "") + "|" + S.gstYm] || {}).rev2 || {})[k] || "") + '" placeholder="0" style="width:100px;text-align:right"></td>').join("") + "</tr>" +
    gap + row("(C) Net ITC available", {taxable: "", igst: t.netItc.igst, cgst: t.netItc.cgst, sgst: t.netItc.sgst}, true) +
    '<tr><td>(D)(1) ITC reclaimed, reversed under 4(B)(2) earlier<div class="nr">type any here</div></td><td class="n"></td>' + ["igst", "cgst", "sgst"].map(k => '<td class="n"><input type="number" step="0.01" data-g3b="reclaim.' + k + '" value="' + esc((((b.gst3b || {})[(S.gstReg || "") + "|" + S.gstYm] || {}).reclaim || {})[k] || "") + '" placeholder="0" style="width:100px;text-align:right"></td>').join("") + "</tr>" +
    row("(D)(2) Ineligible: section 16(4) and place of supply" + (GST2B.all2b(S.gstReg || "").some(z => z.ym === S.gstYm) ? " (from 2B)" : " (bring in 2B)"), {taxable: "", igst: t.na.igst, cgst: t.na.cgst, sgst: t.na.sgst}) +
    (t.ineligible ? '<tr><td class="nr">Tax charged to cost in the books</td><td class="n">' + money(t.ineligible) + '</td><td colspan="3"></td></tr>' : "") +
    "</tbody></table></div>";
  h += '<div class="bk-tablewrap" style="margin-top:12px"><table class="bk-table"><thead><tr><th>5 Exempt, nil and non-GST inward supplies</th><th class="n">Inter-state</th><th class="n">Intra-state</th></tr></thead><tbody>' +
    "<tr><td>From a supplier under composition, exempt and nil rated</td><td class=\"n\">" + money(t.inw5.gstInter) + '</td><td class="n">' + money(t.inw5.gstIntra) + "</td></tr>" +
    "<tr><td>Non-GST supply</td><td class=\"n\">" + money(t.inw5.ngInter) + '</td><td class="n">' + money(t.inw5.ngIntra) + "</td></tr></tbody></table></div>";
  // 6.1: how the tax is paid, in the order the law sets, and the credit carried to next month
  const P = t.pay, months = GSTR.months(), first = months[0] === S.gstYm, open = (b.gstOpen || {})[S.gstReg || ""] || {};
  const hd = [["igst", "Integrated tax"], ["cgst", "Central tax"], ["sgst", "State/UT tax"], ["cess", "Cess"]];
  h += '<div class="bk-tablewrap" style="margin-top:12px"><table class="bk-table"><thead><tr><th>6.1 Payment of tax</th><th class="n">Tax payable</th><th class="n">Through IGST credit</th><th class="n">CGST credit</th><th class="n">SGST credit</th><th class="n">Cess credit</th><th class="n">In cash</th><th class="n">Reverse charge, in cash</th></tr></thead><tbody>' +
    hd.map(([k, l]) => "<tr><td>" + l + '</td><td class="n">' + money(num(t.net[k]) + num(t.rcmOut[k])) + '</td><td class="n">' + money((P.use.igst || {})[k]) + '</td><td class="n">' + money((P.use.cgst || {})[k]) + '</td><td class="n">' + money((P.use.sgst || {})[k]) + '</td><td class="n">' + money((P.use.cess || {})[k]) + '</td><td class="n"><b>' + money(r2(P.cash[k] - P.rcmCash[k])) + '</b></td><td class="n"><b>' + money(P.rcmCash[k]) + "</b></td></tr>").join("") +
    '<tr><td colspan="8" style="height:6px"></td></tr>' +
    "<tr><td>Credit brought forward" + (first ? '<div class="nr">the balance in the electronic credit ledger at the start of ' + esc(GSTR.label(S.gstYm)) + ", from the portal</div>" : '<div class="nr">left over from ' + esc(GSTR.label(months[months.indexOf(S.gstYm) - 1] || "")) + "</div>") + '</td><td></td>' +
    hd.map(([k]) => '<td class="n">' + money(t.opening[k]) + "</td>").join("") + "<td>" + (first && typeof gstSetLink === "function" ? gstSetLink("typed in GST settings") : "") + "</td><td></td></tr>" +
    "<tr><td><b>Credit carried to next month</b></td><td></td>" + hd.map(([k]) => '<td class="n"><b>' + money(P.carry[k]) + "</b></td>").join("") + "<td></td><td></td></tr></tbody></table></div>";
  h += '<p class="note">Worked out from the books. Credit is used as sections 49 and 49A and rule 88A require: IGST credit first against IGST, the rest against CGST and SGST; then CGST and SGST credit against their own tax and then IGST; CGST never against SGST. Reverse charge is paid in cash. Interest and late fee, and anything paid outside the books, are not included; check the ledgers on the portal before paying.</p>';
  h += viewGstChecks();
  if (typeof viewGstFiling === "function") h += viewGstFiling(b, t);
  return h;
}
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
// what the books say about a bill that is in 2B but not among the bills taking credit
function only2bNote(p){
  const nb = p.bookedNoCredit, na = p.itcavl === "N";
  if (nb) return (na ? '<span class="nr">' : '<span class="bad">') + "booked without credit: " + esc(nb.type + " " + (nb.no || "") + " of " + GSTAmend.dmy(nb.date) + ", " + (nb.party || "")) + "</span>" +
    '<div class="nr">' + (na ? "2B says not available" + (p.rsn === "P" ? " (place of supply in another state)" : p.rsn === "C" ? " (after the section 16(4) time limit)" : "") + "; charging the tax to cost is right" : "2B says available: take the credit (time limit 30 November after the year)") + "</div>";
  return na ? '<span class="nr">not in Tally; 2B says not available</span>' : '<span class="bad">not in Tally</span>';
}
function viewInputRegister(b){
  const R = inregRows(b), money = v => INR.format(r2(v || 0)), f = S.inregF || "", q = String(S.inregQ || "").toLowerCase();
  const sgn = r => r.dir < 0 ? -1 : 1;
  const tot = list => list.reduce((a, r) => ({n: a.n + 1, taxable: r2(a.taxable + sgn(r) * r.taxable), igst: r2(a.igst + sgn(r) * r.igst), cgst: r2(a.cgst + sgn(r) * r.cgst), sgst: r2(a.sgst + sgn(r) * r.sgst), cess: r2(a.cess + sgn(r) * r.cess)}), {n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0});
  const kinds = ["Eligible", "Credit reduced", "Reverse charge", "Import of goods", "Import of services", "Not to be taken"];
  const statuses = ["In 2B", "In 2B, differs", "In 2B? confirm", "Not in 2B", "Rejected in IMS", "Booked and reversed", "2B not brought in", "not expected in 2B"];
  let list = R.rows.filter(r => !f || r.kindL === f || r.twoB === f || (f === "Booked more than once" && r.dupe));
  if (q) list = list.filter(r => [r.party, r.gstin, r.no, r.voucher, r.hsn, r.type].join(" ").toLowerCase().includes(q));
  const all = tot(R.rows), shown = tot(list);
  // it ties to 3B table 4: what the register gives against what the 3B takes
  const hr = {held: 0, rel: 0};
  const t3 = R.months.reduce((a, m) => { const t = GSTR.threeBm(m, R.reg); ["igst", "cgst", "sgst", "cess"].forEach(k => { a[k] = r2(a[k] + num(t.itc[k]) - num(t.reversal[k]) - num((t.reclaim || {})[k])); }); hr.held = r2(hr.held + t.held.igst + t.held.cgst + t.held.sgst + t.held.cess); hr.rel = r2(hr.rel + t.released.igst + t.released.cgst + t.released.sgst + t.released.cess); return a; }, {igst: 0, cgst: 0, sgst: 0, cess: 0});
  const reg = tot(R.rows.filter(r => r.kindL !== "Not to be taken"));
  const gap = r2(reg.igst + reg.cgst + reg.sgst + reg.cess - (t3.igst + t3.cgst + t3.sgst + t3.cess));
  const tx4 = x => money(x.igst + x.cgst + x.sgst + x.cess);
  // one line of chips instead of a row of tiles, so the bills are on the first screen
  const chip = (label, n, amt, warn, filt) => n ? '<button class="gf-chip' + (warn ? " warn" : "") + (f === filt ? " on" : "") + '" data-inregchip="' + esc(filt || "") + '">' + label + " <b>" + n + "</b> \u00b7 \u20b9" + amt + "</button>" : "";
  const dupes = R.rows.filter(r => r.dupe), notTaken = R.only2b.filter(p => p.itcavl !== "N" && p.bookedNoCredit);
  let h = '<section class="dash-card"><div class="gf-ctl"><h3>Input register, ' + esc(R.months.length > 1 ? "the year " + GSTR.label(R.months[0]) + " to " + GSTR.label(R.months[R.months.length - 1]) : GSTR.label(R.months[0] || "")) + "</h3>" +
    '<select data-inregscope><option value="month"' + ((S.inregScope || "month") === "month" ? " selected" : "") + '>This month</option><option value="year"' + (S.inregScope === "year" ? " selected" : "") + '>The whole year</option></select>' +
    '<select data-inregf><option value="">Every document</option><optgroup label="Kind">' + kinds.map(k => '<option' + (f === k ? " selected" : "") + ">" + k + "</option>").join("") + '</optgroup><optgroup label="2B">' + statuses.map(k => '<option' + (f === k ? " selected" : "") + ">" + k + "</option>").join("") + '</optgroup><option' + (f === "Booked more than once" ? " selected" : "") + ">Booked more than once</option></select>" +
    '<input type="search" data-inregq data-fk="inregq" placeholder="Supplier, GSTIN, bill no." value="' + esc(S.inregQ || "") + '" style="min-width:200px">' +
    '<button class="btn small primary" data-act="inregExcel">Excel</button></div>' +
    '<div class="gf-chips">' + kinds.map(k => { const x = tot(R.rows.filter(r => r.kindL === k)); return chip(k, x.n, tx4(x), false, k); }).join("") +
    (R.loaded.size ? statuses.slice(0, 5).map(k => { const x = tot(R.rows.filter(r => r.twoB === k)); return chip(k, x.n, tx4(x), k !== "In 2B" && k !== "Booked and reversed", k); }).join("") +
      (R.only2b.length ? '<a class="gf-chip warn" href="#inreg2b">In 2B, not in the books <b>' + R.only2b.length + "</b> \u00b7 \u20b9" + money(R.only2b.reduce((a, p) => a + p.dir * (p.igst + p.cgst + p.sgst + p.cess), 0)) + "</a>" : "") : "") +
    chip("Booked more than once", dupes.length, money(dupes.reduce((a, r) => a + r.tax, 0) / 2), true, "Booked more than once") +
    (notTaken.length ? '<a class="gf-chip warn" href="#inreg2b">Credit in 2B not taken <b>' + notTaken.length + "</b> \u00b7 \u20b9" + money(notTaken.reduce((a, p) => a + p.dir * (p.igst + p.cgst + p.sgst + p.cess), 0)) + "</a>" : "") + "</div>" +
    '<p class="note" style="margin:4px 0 8px">Register \u20b9' + money(reg.igst + reg.cgst + reg.sgst + reg.cess) + "; 3B table 4 \u20b9" + money(t3.igst + t3.cgst + t3.sgst + t3.cess) + (Math.abs(gap) >= 1 ? (Math.abs(gap - r2(hr.held - hr.rel)) < 1 ? " \u2014 held for 2B \u20b9" + money(hr.held) + (hr.rel ? ", taken from earlier \u20b9" + money(hr.rel) : "") + "." : ' <span class="bad">Difference \u20b9' + money(gap) + (hr.held || hr.rel ? ": held back for 2B \u20b9" + money(hr.held - hr.rel) + ", the rest from reversals under rules 42 and 43." : ", from reversals under rules 42 and 43 taken in 3B.") + "</span>") : " \u2014 they agree.") +
    (R.loaded.size ? "" : ' <span class="bad">No 2B for this registration yet; bring it in under 2B reconciliation.</span>') +
    ' <details style="display:inline"><summary class="linkbtn" style="display:inline">What is in it</summary>Every document in Tally that takes input tax for this registration: purchase bills, and journals or payments that carry input tax (reverse charge on rent, bank charges, an expense booked in a journal). GSTR-3B table 4 is made from it, and it is what is matched against 2B. Use the funnel on any column heading to filter.</details></p>';
  // narrow enough for the amounts to be on screen: voucher number only (type on hover), HSN and rate together, cess only when there is any
  const cess = list.some(r => Math.abs(r.cess) >= 0.01);
  const cols = ["Booked \u00b7 voucher", "Supplier \u00b7 GSTIN", "Bill no. \u00b7 date", "HSN \u00b7 rate", "Value", "IGST", "CGST", "SGST"].concat(cess ? ["Cess"] : []).concat(["Kind", "2B"]);
  const numFrom = 4, numTo = cess ? 8 : 7;
  // fixed widths, so the amounts are always on screen
  const widths = [10, 17, 12, 11, 9, 8, 7, 7].concat(cess ? [5] : []).concat([8, 11]);
  h += '<div class="bk-tablewrap"><table class="bk-table compact fixed"><colgroup>' + widths.map(w => '<col style="width:' + w + '%">').join("") + "</colgroup><thead><tr>" + cols.map((c, i) => "<th" + (i >= numFrom && i <= numTo ? ' class="n"' : "") + ">" + c + "</th>").join("") + "</tr></thead><tbody>" +
    list.slice(0, 5000).map(r => { const s2 = sgn(r), rates = Array.from(new Set((r.parts || []).map(x => x.rate))).join(", ");
      return "<tr><td>" + esc(fmtDate(tallyDate(r.date))) + '<div class="nr" title="' + esc(r.type + " " + (r.voucher || "")) + '">' + esc(r.voucher || "") + "</div></td><td>" + esc(r.party || "") + '<div class="nr">' + esc(r.gstin || "no GSTIN") + "</div></td><td>" + esc(r.no || "") + (r.refDate ? '<div class="nr">' + esc(fmtDate(tallyDate(r.refDate))) + "</div>" : "") + '</td><td class="hr">' + esc([r.hsn, rates ? rates + "%" : ""].filter(Boolean).join(" \u00b7 ")) + '</td><td class="n">' + money(s2 * r.taxable) + (r.valueGuessed ? '<div class="nr">from the tax</div>' : "") + '</td><td class="n">' + money(s2 * r.igst) + '</td><td class="n">' + money(s2 * r.cgst) + '</td><td class="n">' + money(s2 * r.sgst) + "</td>" + (cess ? '<td class="n">' + money(s2 * r.cess) + "</td>" : "") + "<td>" + esc(r.kindL) + '</td><td><span class="' + ((r.twoB === "In 2B" || r.twoB === "not expected in 2B" || r.twoB === "Booked and reversed") && !r.dupe ? "" : r.twoB === "2B not brought in" && !r.dupe ? "nr" : "bad") + '">' + esc(r.dupe ? "Booked " + r.dupe.n + " times" : r.twoB) + "</span>" + (r.twoBWhy ? '<div class="nr" title="' + esc(r.twoBWhy) + '">' + esc(r.twoBWhy) + "</div>" : "") + "</td></tr>"; }).join("") +
    '<tr><td colspan="4"><b>' + shown.n + " document" + (shown.n === 1 ? "" : "s") + (shown.n !== all.n ? " of " + all.n : "") + '</b></td><td class="n"><b>' + money(shown.taxable) + '</b></td><td class="n"><b>' + money(shown.igst) + '</b></td><td class="n"><b>' + money(shown.cgst) + '</b></td><td class="n"><b>' + money(shown.sgst) + "</b></td>" + (cess ? '<td class="n"><b>' + money(shown.cess) + "</b></td>" : "") + '<td colspan="2"></td></tr></tbody></table></div>' +
    (list.length > 5000 ? '<p class="note">The first 5,000 are shown; the Excel has all ' + list.length + ".</p>" : "");
  if (R.only2b.length && (!f || f === "Not in 2B")) h += '<h3 id="inreg2b" style="margin-top:14px">In 2B, not in the books</h3><div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>2B month</th><th>Supplier</th><th>GSTIN</th><th>Bill no.</th><th>Date</th><th class="n">Value</th><th class="n">Tax</th><th>In Tally</th></tr></thead><tbody>' +
    R.only2b.slice().sort((a, c) => (c.igst + c.cgst + c.sgst) - (a.igst + a.cgst + a.sgst)).slice(0, 300).map(p => "<tr><td>" + esc(GSTR.label(p.ym)) + "</td><td>" + esc(p.party) + "</td><td>" + esc(p.gstin) + "</td><td>" + esc(p.no) + "</td><td>" + esc(p.date ? fmtDate(tallyDate(p.date)) : "") + '</td><td class="n">' + money(p.dir * p.taxable) + '</td><td class="n">' + money(p.dir * (p.igst + p.cgst + p.sgst + p.cess)) + "</td><td>" + only2bNote(p) + "</td></tr>").join("") + "</tbody></table></div>";
  return h + "</section>";
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
  const gstin = ((b.meta || {}).gstins || []).find(g => g.slice(0, 2) === R.reg) || R.reg;
  saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-Input-register-" + gstin + "-" + (R.months.length > 1 ? R.months[0] + "-" + R.months[R.months.length - 1] : R.months[0]) + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}
function r2Scope(){
  const ym = S.gstYm || "", mode = S.r2Scope || "month";
  if (mode === "all" || !ym) return {mode: "all", months: null, label: "everything brought in"};
  if (mode === "year"){ const ms = GSTRev.fyMonths(ym); return {mode, months: ms, label: "the year " + ms[0].slice(0, 4) + "-" + ms[11].slice(2, 4)}; }
  return {mode: "month", months: [ym], label: GSTR.label(ym)};
}
function r2Reg(b){
  const regs = ((b.meta || {}).gstins || []).map(g => g.slice(0, 2));
  if (S.gstReg) return S.gstReg;
  const own = Array.from(new Set(GST2B.all2b("").map(t => t.gstin.slice(0, 2))));
  return own.length === 1 ? own[0] : regs.length === 1 ? regs[0] : "";
}
function viewBooks2B(b){
  const money = v => INR.format(r2(v || 0)), tx = o => r2((num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess)));
  const loadedAll = GST2B.all2b("");
  const pick = '<button class="btn small primary" data-act="twoBPick">Bring in 2B JSON</button>';
  const apiCard = typeof viewGstApiCard === "function" ? viewGstApiCard(b) : "";
  if (!loadedAll.length){
    return apiCard + '<section class="dash-card" style="max-width:760px"><h3>GSTR-2B reconciliation</h3>' +
      '<p class="note">On the portal: Returns Dashboard \u2192 the month \u2192 GSTR-2B \u2192 View \u2192 Download \u2192 <b>Generate JSON</b>. Bring in one month, a quarter, or the whole year at once \u2014 select all the files together.</p>' +
      '<p class="note">Every document in Tally that takes input tax is compared: purchases, and expenses booked in journals or payments. Invoices are matched on the supplier\u2019s GSTIN and invoice number, then on the number written differently, then on the amount; anything less than certain is put to you to confirm.</p>' +
      (b.twoB ? '<p class="note" style="color:#B9541B">A 2B brought in before this build was read the old way. Bring it in again.</p>' : "") + pick + "</section>";
  }
  const reg = r2Reg(b), sc0 = r2Scope(), set = GST2B.settings(), st = GST2B.state();
  const regs = (b.meta && b.meta.gstins) || [];
  if (!reg && regs.length > 1) return '<p class="note">Choose a registration above.</p>';
  const mine = GST2B.all2b(reg), sc = GST2B.scope(reg, sc0.months);
  const wrong = loadedAll.filter(t => regs.length && !regs.includes(t.gstin));
  // which months of the year have a 2B here
  const fyM = S.gstYm ? GSTRev.fyMonths(S.gstYm) : [], have = new Set(mine.map(t => t.ym));
  let h = apiCard + '<section class="dash-card"><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">' + pick +
    '<span class="note">2B here for ' + (regs.length > 1 ? esc(reg) + ": " : "") + "</span>" +
    (fyM.length ? fyM.map(m => '<span class="tag' + (have.has(m) ? "" : " warn") + '" title="' + (have.has(m) ? "brought in" : "not brought in yet") + '">' + esc(GSTR.label(m).replace(/ \d{4}$/, "")) + "</span>").join("") : "") +
    "</div>" + (wrong.length ? '<p class="note" style="color:#B9541B">' + wrong.length + " 2B file" + (wrong.length === 1 ? " is" : "s are") + " for " + esc(Array.from(new Set(wrong.map(t => t.gstin))).join(", ")) + ", not this client\u2019s registration.</p>" : "") +
    '<div class="row" style="gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap"><span class="note">Reconcile</span>' +
    [["month", GSTR.label(S.gstYm || "") || "this month"], ["year", "the year"], ["all", "everything here"]].map(([k, l]) => '<button class="btn small' + (sc0.mode === k ? " primary" : "") + '" data-r2scope="' + k + '">' + esc(l) + "</button>").join("") +
    '<span class="note" style="margin-left:12px">Allow a difference of \u20b9</span><input type="number" min="0" step="1" data-r2tol value="' + esc(set.tol) + '" style="width:70px">' +
    '<button class="btn small" data-act="twoBExcel">Download the reconciliation</button></div></section>';
  const S2b = sc.pairs.map(x => x.p).concat(sc.only2b).filter(p => !sc0.months || sc0.months.includes(p.ym));
  const avl = S2b.filter(p => p.itcavl !== "N"), sumTx = list => r2(list.reduce((a, o) => a + tx(o) * (o.dir || 1), 0));
  const booksIn = sc.pairs.flatMap(x => x.books).filter(d => !sc0.months || sc0.months.includes(d.ym)).concat(sc.onlyBooks);
  const tile = (id, label, n, amt, note, warn) => '<button class="dtile' + (warn && n ? " warn" : "") + '" data-r2tab="' + id + '" style="text-align:left"><span>' + label + "</span><b>" + n + "</b><small>" + money(amt) + " tax" + (note ? " \u00b7 " + note : "") + "</small></button>";
  h += '<div class="dash-tiles" style="margin-top:12px">' +
    '<div class="dtile"><span>ITC in 2B, ' + esc(sc0.label) + "</span><b>" + money(sumTx(avl)) + "</b><small>" + avl.length + " documents" + (S2b.length > avl.length ? ", " + (S2b.length - avl.length) + " not available" : "") + "</small></div>" +
    '<div class="dtile"><span>ITC in Tally</span><b>' + money(sumTx(booksIn)) + "</b><small>" + booksIn.length + " documents</small></div>" +
    '<div class="dtile' + (Math.abs(sumTx(avl) - sumTx(booksIn)) > 1 ? " warn" : "") + '"><span>Gap, 2B less Tally</span><b>' + money(r2(sumTx(avl) - sumTx(booksIn))) + "</b><small>" + sc.timing.length + " matched in another month</small></div></div>";
  const rjs = sc.rejected || [];
  if (rjs.length) h += '<p class="note">Rejected in IMS: ' + rjs.length + " document" + (rjs.length === 1 ? "" : "s") + ", tax \u20b9" + money(r2(rjs.reduce((a, x) => a + x.p.dir * tx(x.p), 0))) + " \u2014 no credit from them" + (rjs.some(x => x.books.length) ? "; " + rjs.filter(x => x.books.length).length + " booked in Tally" : "") + '. <button class="linkbtn" data-gstpart="follow">See them under ITC follow-up</button></p>';
  const sk = GST2B.skipped || {};
  if (sk.setOff || sk.taxOnly) h += '<p class="note">Left out of Tally\u2019s side: ' + [sk.setOff ? sk.setOff + " set-off entr" + (sk.setOff === 1 ? "y" : "ies") + " (output tax against credit)" : "", sk.taxOnly ? sk.taxOnly + " tax-only entr" + (sk.taxOnly === 1 ? "y" : "ies") + " with no supplier GSTIN or value (rounding, reversals)" : ""].filter(Boolean).join(" and ") + ".</p>";
  h += '<div class="dash-tiles">' +
    tile("matched", "Matched", sc.matched.length, sumTx(sc.matched.map(x => x.p)), "") +
    tile("diff", "Matched, with a difference", sc.diff.length, sumTx(sc.diff.map(x => x.p)), "", true) +
    tile("probable", "To confirm", sc.probable.length, sumTx(sc.probable.map(x => x.p)), "likely the same", true) +
    tile("only2b", "In 2B, not in Tally", sc.only2b.length, sumTx(sc.only2b), "ITC not taken", true) +
    tile("books", "In Tally, not in 2B", sc.onlyBooks.length, sumTx(sc.onlyBooks), "ITC at risk", true) + "</div>";
  const tab = S.r2Tab || (sc.probable.length ? "probable" : "suppliers");
  h += '<nav class="sbar" aria-label="2B reconciliation">' + [["suppliers", "Supplier by supplier", null], ["matched", "Matched", sc.matched.length], ["diff", "Differences", sc.diff.length],
    ["probable", "To confirm", sc.probable.length], ["only2b", "In 2B only", sc.only2b.length], ["books", "In Tally only", sc.onlyBooks.length]]
    .map(([id, l, n]) => '<button data-r2tab="' + id + '" aria-selected="' + (tab === id) + '">' + l + (n != null ? ' <span class="sbar-n">' + n + "</span>" : "") + "</button>").join("") + "</nav>";
  // filters, one set per tab
  const f = ((S.r2F || {})[tab]) || {}, qq = String(f.q || "").toLowerCase();
  const flags = [["", "Everything"], ["month", "Matched in another month"], ["notavl", "ITC not available in 2B"], ["ims", "Rejected or pending in IMS"], ["rcm", "Reverse charge"], ["nogstin", "No GSTIN in Tally"], ["notes", "Credit and debit notes"], ["big", "Tax over \u20b9 10,000"]];
  const pass = (p, bk, x) => {
    const o = p || bk;
    if (qq && ![o.party, o.gstin, o.no, bk && bk.voucher, bk && bk.party].join(" ").toLowerCase().includes(qq)) return false;
    if (f.flag === "month" && !(x && x.timing)) return false;
    if (f.flag === "notavl" && !(p && p.itcavl === "N")) return false;
    if (f.flag === "ims" && !(p && (p.ims === "R" || p.ims === "P"))) return false;
    if (f.flag === "rcm" && !((p && p.rcm) || (bk && bk.rcm))) return false;
    if (f.flag === "nogstin" && !(bk && !bk.gstin) && !(x && x.books.some(d => !d.gstin))) return false;
    if (f.flag === "notes" && !((p && /^cdnr/.test(p.sec)) || (bk && bk.dir < 0))) return false;
    if (f.flag === "big" && tx(o) < 10000) return false;
    if (f.month && (p ? p.ym : bk.ym) !== f.month) return false;
    return true;
  };
  const monthsHere = Array.from(new Set(S2b.map(p => p.ym).concat(booksIn.map(d => d.ym)))).filter(Boolean).sort();
  const bar = (count, table) => '<div class="revfilter" style="flex-wrap:wrap;row-gap:6px"><input type="search" data-r2f="q" data-fk="r2f-' + tab + '" data-keeptyped value="' + esc(f.q || "") + '" placeholder="Find a supplier, GSTIN, invoice or voucher" style="width:280px;flex:0 0 auto">' +
    '<select data-r2f="flag" style="width:auto;flex:0 0 auto">' + flags.map(([v, l]) => '<option value="' + v + '"' + ((f.flag || "") === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
    (sc0.mode !== "month" ? '<select data-r2f="month" style="width:auto;flex:0 0 auto"><option value="">Every month</option>' + monthsHere.map(m => '<option value="' + m + '"' + (f.month === m ? " selected" : "") + ">" + GSTR.label(m) + "</option>").join("") + "</select>" : "") +
    '<span class="note">' + esc(count) + "</span>" + (Object.keys(f).some(k => f[k]) ? '<button class="linkbtn" data-r2fclear="' + tab + '">Clear filters</button>' : "") +
    '<button class="btn small" data-printid="' + table + '" data-printtitle="' + esc(CO().name + " 2B reconciliation " + sc0.label) + '">Print or save as PDF</button></div>';
  const LIMIT = 400;
  const noteOf = p => [p.itcavl === "N" ? "ITC not available" + (p.rsn ? ": " + (GST2B.RSN[p.rsn] || p.rsn) : "") : "", p.rcm ? "reverse charge" : "", (p.ims === "R" || p.ims === "P") ? "IMS: " + GST2B.IMS[p.ims] : "",
    /a$/.test(p.sec) ? "amended by the supplier" + (p.oNo ? " (was " + p.oNo + ")" : "") : "", p.sec === "impg" ? "import, bill of entry" : "", p.sec === "isd" ? "from the ISD" : ""].filter(Boolean).join("; ");
  const secName = p => ({b2b: "Invoice", b2ba: "Invoice, amended", cdnr: p.dir < 0 ? "Credit note" : "Debit note", cdnra: "Note, amended", isd: "ISD", impg: "Import", impgsez: "Import from SEZ"})[p.sec] || p.sec;
  if (tab === "suppliers"){
    const sup = GST2B.suppliers({pairs: sc.pairs.filter(x => pass(x.p, x.books[0], x)), only2b: sc.only2b.filter(p => pass(p, null)), onlyBooks: sc.onlyBooks.filter(d => pass(null, d))});
    h += bar(sup.length + " suppliers", "r2Sup");
    h += '<div class="bk-tablewrap"><table class="bk-table" id="r2Sup"><thead><tr><th>Supplier</th><th>GSTIN</th><th class="n">Tax in 2B</th><th class="n">Tax in Tally</th><th class="n">Gap</th><th class="n">Matched</th><th class="n">Differences</th><th class="n">To confirm</th><th class="n">2B only</th><th class="n">Tally only</th></tr></thead><tbody>' +
      sup.slice(0, LIMIT).map(s => {
        const k = s.gstin || s.party, open = S.r2Open === k;
        let row = '<tr><td><button class="linkbtn" data-r2open="' + esc(k) + '">' + (open ? "\u25be " : "\u25b8 ") + esc(s.party || "\u2014") + "</button></td><td>" + (s.gstin ? esc(s.gstin) : '<span class="tag warn">no GSTIN in Tally</span>') +
          '</td><td class="n">' + money(s.t2b) + '</td><td class="n">' + money(s.tbk) + '</td><td class="n' + (Math.abs(s.gap) > 1 ? " bad" : "") + '">' + money(s.gap) + '</td><td class="n">' + (s.matched || "") + '</td><td class="n">' + (s.diff || "") +
          '</td><td class="n">' + (s.probable || "") + '</td><td class="n">' + (s.only2b || "") + '</td><td class="n">' + (s.onlyBooks || "") + "</td></tr>";
        if (open){
          const docs = s.pairs.map(x => ({d: x.p.date, cells: "<td>" + esc(secName(x.p)) + "</td><td>" + esc(x.p.no) + "</td><td>" + fmtDate(tallyDate(x.p.date)) + '</td><td class="n">' + money(tx(x.p)) + "</td><td>" + esc(x.books.map(d => d.no + " (vch " + d.voucher + ")").join(", ")) + '</td><td class="n">' + money(tx(x.sum)) +
            "</td><td>" + ({matched: "matched", diff: "difference", probable: "to confirm"})[x.status] + (x.issues.length ? ": " + esc(x.issues.join("; ")) : "") + "</td>"}))
            .concat(s.p2b.map(p => ({d: p.date, cells: "<td>" + esc(secName(p)) + "</td><td>" + esc(p.no) + "</td><td>" + fmtDate(tallyDate(p.date)) + '</td><td class="n">' + money(tx(p)) + '</td><td>\u2014</td><td></td><td class="bad">not in Tally' + (noteOf(p) ? "; " + esc(noteOf(p)) : "") + "</td>"})))
            .concat(s.pbk.map(d => ({d: d.date, cells: '<td>Tally</td><td>\u2014</td><td></td><td></td><td>' + esc(d.no + " (vch " + d.voucher + ")") + " " + fmtDate(tallyDate(d.date)) + '</td><td class="n">' + money(tx(d)) + '</td><td class="bad">not in 2B</td>'})))
            .sort((a, c) => String(a.d).localeCompare(String(c.d)));
          row += '<tr><td colspan="10" style="background:var(--paper);padding:0"><table class="bk-table" style="margin:0"><thead><tr><th>Document</th><th>Number in 2B</th><th class="dt">Date</th><th class="n">Tax in 2B</th><th>In Tally</th><th class="n">Tax in Tally</th><th>Result</th></tr></thead><tbody>' +
            docs.map(x => "<tr>" + x.cells + "</tr>").join("") + "</tbody></table>" +
            (s.pbk.length && s.gstin ? '<div class="row" style="gap:8px;padding:8px"><button class="btn small" data-r2copy="' + esc(k) + '">Copy a note to the supplier</button><span class="note">lists the ' + s.pbk.length + " invoice" + (s.pbk.length === 1 ? "" : "s") + " not in 2B</span></div>" : "") + "</td></tr>";
        }
        return row;
      }).join("") + "</tbody></table>" + (sup.length ? "" : '<div class="bk-none">Nothing matches.</div>') + "</div>";
    return h;
  }
  if (tab === "matched" || tab === "diff" || tab === "probable"){
    const list = sc[tab].filter(x => pass(x.p, x.books[0], x));
    h += bar(list.length + " of " + sc[tab].length, "r2Pairs");
    if (tab === "probable" && list.length) h += '<p class="note">Each of these looks like the same document, but the evidence is weaker: a different number, another registration of the supplier, or no GSTIN in Tally. Confirm the ones that are, and say which are not.</p>';
    h += '<div class="bk-tablewrap"><table class="bk-table" id="r2Pairs"><thead><tr><th>Supplier</th><th>2B</th><th class="dt">Date</th><th class="n">Taxable</th><th class="n">Tax</th><th>Tally</th><th class="n">Taxable</th><th class="n">Tax</th><th class="n">Difference</th><th style="min-width:230px">What differs</th><th class="ac"></th></tr></thead><tbody>' +
      list.slice(0, LIMIT).map(x => {
        const ids = x.books.map(d => d.id).join(",");
        const act = x.status === "probable"
          ? '<button class="btn small primary" data-r2ok="' + esc(x.p.key) + '">Same</button> <button class="btn small" data-r2no="' + esc(x.p.key + ">" + ids) + '">Not the same</button>'
          : '<button class="linkbtn" data-r2no="' + esc(x.p.key + ">" + ids) + '" title="These are not the same document">Unlink</button>';
        return "<tr><td>" + esc(x.p.party || "\u2014") + '<div class="nr">' + esc(x.p.gstin) + "</div></td><td>" + esc(x.p.no) + '<div class="nr">' + esc(secName(x.p)) + " \u00b7 " + GSTR.label(x.p.ym) + "</div></td><td>" + fmtDate(tallyDate(x.p.date)) +
          '</td><td class="n">' + money(x.p.taxable) + '</td><td class="n">' + money(tx(x.p)) + "</td><td>" + esc(x.books.map(d => d.no).join(", ")) + '<div class="nr">vch ' + esc(x.books.map(d => d.voucher).join(", ")) + " \u00b7 " + esc(Array.from(new Set(x.books.map(d => GSTR.label(d.ym)))).join(", ")) + "</div></td>" +
          '<td class="n">' + money(x.sum.taxable) + '</td><td class="n">' + money(tx(x.sum)) + '</td><td class="n' + (Math.abs(tx(x.diff)) > num(set.tol) ? " bad" : "") + '">' + money(tx(x.diff)) + "</td><td style=\"min-width:230px\">" + esc(x.issues.concat(noteOf(x.p) ? [noteOf(x.p)] : []).join("; ") || (x.timing ? "booked in another month" : "")) +
          '</td><td class="ac" style="white-space:nowrap">' + act + "</td></tr>";
      }).join("") + "</tbody></table>" + (list.length > LIMIT ? '<p class="note">The first ' + LIMIT + " are shown; narrow them with the filters, or download the reconciliation.</p>" : "") + (list.length ? "" : '<div class="bk-none">Nothing here.</div>') + "</div>";
    return h;
  }
  if (tab === "only2b"){
    const list = sc.only2b.filter(p => pass(p, null));
    const free = sc.all.onlyBooks;
    h += bar(list.length + " of " + sc.only2b.length + " \u00b7 tax " + money(sumTx(list)), "r2Only2b");
    h += '<p class="note">In the supplier\u2019s return but not found in Tally. If it is booked under another number, link it; otherwise book it, or note why the credit is not being taken.</p>';
    h += '<div class="bk-tablewrap"><table class="bk-table" id="r2Only2b"><thead><tr><th>Supplier</th><th>Number</th><th class="dt">Date</th><th class="n">Taxable</th><th class="n">Tax</th><th>Note</th><th>Booked in Tally as</th><th>Remark</th></tr></thead><tbody>' +
      list.slice(0, LIMIT).map(p => {
        const cands = free.filter(d => d.dir === p.dir && (d.gstin === p.gstin || (!d.gstin && GST2B.lastDigits(d.no) === GST2B.lastDigits(p.no)) || (d.gstin && d.gstin.slice(2, 12) === p.gstin.slice(2, 12))))
          .sort((a, c) => Math.abs(tx(a) - tx(p)) - Math.abs(tx(c) - tx(p))).slice(0, 12);
        const tag = (st.tag[p.key] || {}).tag || "";
        return "<tr><td>" + esc(p.party || "\u2014") + '<div class="nr">' + esc(p.gstin) + "</div></td><td>" + esc(p.no) + '<div class="nr">' + esc(secName(p)) + " \u00b7 " + GSTR.label(p.ym) + "</div></td><td>" + fmtDate(tallyDate(p.date)) +
          '</td><td class="n">' + money(p.taxable) + '</td><td class="n">' + money(tx(p)) + "</td><td>" + esc(noteOf(p)) + (p.bookedNoCredit ? '<div>' + only2bNote(p) + "</div>" : "") + "</td>" +
          '<td><select data-r2link="' + esc(p.key) + '" style="max-width:240px"><option value="">' + (cands.length ? "not found \u2014 choose" : "nothing close in Tally") + "</option>" +
          cands.map(d => '<option value="' + esc(d.id) + '">' + esc(d.no + " \u00b7 vch " + d.voucher + " \u00b7 " + GSTAmend.dmy(d.date) + " \u00b7 tax " + INR.format(tx(d)) + (d.gstin ? "" : " \u00b7 no GSTIN")) + "</option>").join("") + "</select></td>" +
          '<td><select data-r2tag="' + esc(p.key) + '">' + [["", "\u2014"], ["To book in Tally", "to book in Tally"], ["Booked in a later month", "booked in a later month"], ["Not our purchase", "not our purchase"], ["Blocked, section 17(5)", "blocked, 17(5)"], ["Ask supplier to correct", "ask supplier to correct"]]
            .map(([v, l]) => '<option value="' + esc(v) + '"' + (tag === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></td></tr>";
      }).join("") + "</tbody></table>" + (list.length ? "" : '<div class="bk-none">Nothing here.</div>') + "</div>";
    return h;
  }
  // in Tally, not in 2B
  const list = sc.onlyBooks.filter(d => pass(null, d));
  h += bar(list.length + " of " + sc.onlyBooks.length + " \u00b7 tax " + money(sumTx(list)), "r2Books");
  h += '<p class="note">Credit taken in Tally that the supplier has not reported' + (sc.laterMissing ? "; " + sc.laterMissing + " are from the last month here, and may appear in the next 2B" : "") + ". Supplier by supplier, you can copy a note to send them.</p>";
  h += '<div class="bk-tablewrap"><table class="bk-table" id="r2Books"><thead><tr><th>Supplier</th><th>Invoice</th><th class="dt">Date</th><th>Voucher</th><th class="n">Taxable</th><th class="n">Tax</th><th>Note</th><th>Remark</th></tr></thead><tbody>' +
    list.slice(0, LIMIT).map(d => {
      const tag = (st.tag[d.id] || {}).tag || "";
      return "<tr><td>" + esc(d.party || "\u2014") + '<div class="nr">' + (d.gstin ? esc(d.gstin) : '<span class="bad">no GSTIN in Tally</span>') + "</div></td><td>" + esc(d.no) + "</td><td>" + fmtDate(tallyDate(d.date)) + "</td><td>" + esc(d.voucher) + '<div class="nr">' + esc(d.type) + " \u00b7 " + GSTR.label(d.ym) + "</div></td>" +
        '<td class="n">' + money(d.taxable) + '</td><td class="n">' + money(tx(d)) + "</td><td>" + esc([d.rcm ? "reverse charge" : "", d.ineligible ? "ITC not to be taken" : "", d.dir < 0 ? "note from the supplier" : ""].filter(Boolean).join("; ")) + "</td>" +
        '<td><select data-r2tag="' + esc(d.id) + '">' + [["", "\u2014"], ["Follow up with supplier", "follow up with supplier"], ["Expect in next 2B", "expect in next 2B"], ["Reverse in 3B", "reverse in 3B"], ["Reverse charge or import", "reverse charge or import"], ["No credit claimed", "no credit claimed"]]
          .map(([v, l]) => '<option value="' + esc(v) + '"' + (tag === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></td></tr>";
    }).join("") + "</tbody></table>" + (list.length ? "" : '<div class="bk-none">Nothing here.</div>') + "</div>";
  return h;
}


/* ---------- The client's dashboard ---------- */
function viewClientDash(){
  const co = CO(), d = D(), st = co.stats || {}, v = Object.values(d.entries);
  const drafts = v.filter(e => e.status === "draft"), approved = v.filter(e => e.status === "approved" && !e.exportedAt), posted = v.filter(e => e.exportedAt);
  const bank = S.bank && S.bank.cid === co.id ? S.bank : null;
  const bc = bank ? tabCounts(bank.rows) : null;
  const stmt = bank ? curStmt() : null;
  const sales = S.sales && S.sales.cid === co.id ? S.sales.list : null;
  const money = x => INR.format(r2(x || 0));
  const tile = (label, n, sub, go, warn) => '<button class="dtile' + (warn && n ? " warn" : "") + '" data-goclient="' + go + '"><span>' + label + "</span><b>" + n + "</b><small>" + sub + "</small></button>";
  let h = '<section class="dash"><div class="dash-tiles">' +
    tile("To read", docqCount(co.id), "in the inbox", "inbox") +
    tile("Bills to review", drafts.length, drafts.length ? money(drafts.reduce((a, e) => a + num(e.x.total), 0)) : "nothing waiting", "bills") +
    tile("Ready to post", approved.length, approved.length ? money(approved.reduce((a, e) => a + num(e.x.total), 0)) : "nothing approved", "post") +
    tile("Bank lines to review", bc ? bc.review : "\u2026", bc ? bc.ready + " ready to post" : "opening the bank", "bank") + "</div>";
  if (CloudDocs.on()){
    h += '<p class="note" style="margin:-6px 0 14px">Documents are kept in the firm account, so anyone in the firm can open a bill from Transactions on any computer.' +
      (CloudDocs.queue.length ? " <b>" + CloudDocs.queue.length + " waiting to go up.</b>" : "") + "</p>";
  }
  h += '<div class="dash-cols">';
  // TDS this year
  const fy = fyOf(null), tds = v.filter(e => e.status !== "rejected" && e.snapshot).reduce((a, e) => a + num(e.snapshot.tds), 0);
  h += '<section class="dash-card"><h3>TDS this year</h3><div class="dash-big">' + money(tds) + '</div><p class="note">On bills approved here for ' + esc(fy) + ". Deductees over their limit show in red on the bills list.</p>" +
    '<button class="btn small" data-goclient="post">Open Post to Tally</button></section>';
  // the bank statement
  h += '<section class="dash-card"><h3>Bank</h3>' + (stmt
    ? '<p><b>' + esc(stmt.bank || "") + "</b> \u00b7 " + fmtDate(stmt.from) + " to " + fmtDate(stmt.to) + '</p><div class="dash-row"><span>Opening</span><b>' + money(stmt.opening) + "</b></div>" +
      '<div class="dash-row"><span>Closing</span><b>' + money(stmt.closing) + "</b></div>" +
      '<p class="note">' + (bank.rows.filter(r => r.balOk === false).length ? bank.rows.filter(r => r.balOk === false).length + " lines do not fit the running balance." : "Every line fits the running balance.") + "</p>"
    : '<p class="note">No statement uploaded yet.</p>') + '<button class="btn small" data-goclient="bank">Open bank</button></section>';
  // sales
  h += '<section class="dash-card"><h3>Sales</h3>' + (sales
    ? '<div class="dash-row"><span>Invoices</span><b>' + sales.length + "</b></div><div class=\"dash-row\"><span>Posted</span><b>" + sales.filter(x => x.status === "posted").length + "</b></div>"
    : '<p class="note">Open Sales to see this client\u2019s invoices.</p>') + '<button class="btn small" data-goclient="sales">Open sales</button></section>';
  // what was done lately
  const recent = v.filter(e => e.exportedAt).sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt))).slice(0, 5);
  h += '<section class="dash-card"><h3>Posted lately</h3>' + (recent.length
    ? '<ul class="dash-list">' + recent.map(e => "<li><b>" + esc(e.x.vendorName || e.fileName || "") + "</b> \u00b7 " + money(e.x.total) + '<span class="note">' + fmtDate(String(e.exportedAt).slice(0, 10)) + "</span></li>").join("") + "</ul>"
    : '<p class="note">Nothing posted yet.</p>') + "</section>";
  h += "</div></section>";
  return h;
}
/* ---------- Today: what needs doing, across every client ---------- */
function viewToday(){
  const cos = sortedCompanies();
  const tot = {read: inboxTotal(), review: 0, post: 0, problems: 0};
  cos.forEach(c => { const s = c.stats || {}; tot.review += s.drafts || 0; tot.post += s.waiting || 0; tot.problems += (s.dups || 0) + (s.check || 0); });
  const card = (label, n, warn, nav) => '<button class="metric' + (warn && n ? " warn" : "") + '"' + (nav ? ' data-nav="' + nav + '"' : "") + "><span>" + label + "</span><b>" + n + "</b></button>";
  let h = '<section class="today"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0 0 12px">What needs doing</h2><button class="btn small" data-act="addCo">Add client</button></div>' +
    '<div class="metrics">' + card("To read", tot.read, false, "inbox") + card("To review", tot.review) + card("To post", tot.post) + card("Need a look", tot.problems, true) + "</div>";
  const rows = cos.map(c => { const s = c.stats || {}; return {c, read: docqCount(c.id), review: s.drafts || 0, post: s.waiting || 0, look: (s.dups || 0) + (s.check || 0)}; })
    .sort((a, b) => (b.read + b.review + b.post + b.look) - (a.read + a.review + a.post + a.look));
  if (!rows.length) return h + '<p class="note">No clients yet. <button class="linkbtn" data-nav="clients">Add your first client</button>.</p></section>';
  const cell = (r, key, step) => r[key] ? '<button class="linkbtn tcell" data-goto="' + r.c.id + '" data-gstep="' + step + '">' + r[key] + "</button>" : '<span class="muted">\u2014</span>';
  h += '<div class="tblwrap"><table class="data"><thead><tr><th>Client</th><th class="n">To read</th><th class="n">To review</th><th class="n">To post</th><th class="n">Need a look</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td><button class="linkbtn" data-goto="' + r.c.id + '" data-gstep="review"><b>' + esc(r.c.name) + "</b></button>" + (r.c.gstin ? ' <span class="note">' + esc(r.c.gstin) + "</span>" : "") + "</td>" +
      '<td class="n">' + cell(r, "read", "collect") + '</td><td class="n">' + cell(r, "review", "review") + '</td><td class="n">' + cell(r, "post", "post") + '</td><td class="n">' + cell(r, "look", "review") + "</td></tr>").join("") +
    "</tbody></table></div>";
  return h + '<p class="note" style="margin-top:8px">Counts cover clients opened on this computer; open a client to bring its figures up to date.</p></section>';
}
/* ---------- Inbox: every waiting document, and uploads that matched no client ---------- */
function viewInboxAll(){
  const cos = sortedCompanies().filter(c => docqFor(c.id).length);
  let h = '<section class="today"><h2>Inbox</h2><p class="note" style="margin:0 0 12px">Documents from office automation, by client, and uploads that matched no client.</p></section>';
  cos.forEach(c => { h += '<div class="inbox-client"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">' + esc(c.name) + '</h3><button class="btn small" data-goto="' + c.id + '" data-gstep="collect">Open this client</button></div>' + docqPanel(c.id) + "</div>"; });
  if (docqFor("").length) h += '<div class="inbox-client"><h3 style="margin:0 0 6px">Not matched to a client</h3>' + docqPanel("") + "</div>";
  const un = Object.keys(S.inbox || {}).length;
  if (un) h += '<div class="inbox-client"><h3 style="margin:0 0 6px">Uploads that matched no client</h3>' + viewInbox() + "</div>";
  if (!cos.length && !docqFor("").length && !un) h += '<p class="note">Nothing waiting. New documents appear here as soon as they arrive.</p>';
  return h;
}
/* ---------- Tally: the connection, and everything sent ---------- */
function viewTallyHome(){
  return '<section class="today"><h2>Tally</h2></section>' + viewBridgeSettings() + viewPostLog();
}

function renderTop(){
  const bar = document.getElementById("cobar"), tabs = document.getElementById("tabs");
  document.getElementById("firmLine").textContent = (S.firm.firmName || "") + " \u00b7 " + APP_VERSION;
  renderSide();
  const top = document.querySelector("header.top");
  if (top) top.style.display = signInNeeded() ? "none" : "";
  if (S.view === "company" && CO()){ bar.innerHTML = '<div class="headrow">' + clientHeader() + topRight() + "</div>"; tabs.innerHTML = ""; }
  else {
    const title = {clients: "Clients", today: "Today", inbox: "Inbox", tally: "Tally", rules: "Settings"}[S.homeTab] || "Clients";
    bar.innerHTML = '<div class="headrow"><div class="tbar"><div class="tbar-title"><h2>' + title + '</h2><span class="note">' + esc(S.firm.firmName || "") + "</span></div></div>" + topRight() + "</div>";
    tabs.innerHTML = "";
  }
}

/* ---------- Home: client list ---------- */
function viewClients(){
  const q = S.homeQuery.trim().toLowerCase();
  const cos = sortedCompanies().filter(c => !q || c.name.toLowerCase().includes(q) || (c.gstin || "").toLowerCase().includes(q) || (c.tallyName || "").toLowerCase().includes(q));
  const all = Object.values(S.companies);
  const used = all.reduce((a, c) => a + num((c.stats || {}).records || 1), 0) + Object.keys(S.inbox).length + 1;
  let h = '<div class="two">';
  h += '<div class="drop" id="dropAuto" tabindex="0" role="button" aria-label="Upload invoices for any client"><strong>Upload invoices for any client</strong>' +
    '<div class="note">Drop any number of bills. Each is filed under the client whose GSTIN it is billed to; anything that does not match waits in Unsorted uploads. Files already uploaded are skipped.</div>' +
    "</div>" + readingCheck();
  h += '<div class="pane" style="margin-top:0">' + (S.addingCo ? addCompanyForm() :
    '<h2>' + all.length + " client" + (all.length === 1 ? "" : "s") + '</h2><p class="note" style="margin:0 0 12px">Open a client to upload, review and send its entries, like selecting a company in Tally.</p>' +
    '<button class="btn primary" data-act="addCo">Add client</button>') + "</div></div>";
  h += '<div style="margin-top:8px">' + uploadOptions() + "</div>" + viewJobs(j => j.target === "auto");
  if (!all.length){
    return h + '<div class="pane"><p class="empty" style="padding:0">No clients yet. Add your first client with its GSTIN and Tally company name.</p></div>';
  }
  h += '<div class="row" style="margin:18px 0 8px;justify-content:space-between"><label class="f" style="min-width:260px"><span>Find a client</span><input type="text" data-hq data-fk="hq" value="' + esc(S.homeQuery) + '" placeholder="Name, GSTIN or Tally name"></label>' +
    '<span class="note">About ' + INR0.format(used) + " of " + INR0.format(DB_LIMIT) + " records used</span></div>";
  h += '<div class="tblwrap"><table class="data"><thead><tr><th>Client</th><th>GSTIN</th><th class="n">To review</th><th class="n">Need a check</th><th class="n">Waiting for Tally</th><th class="n">TDS ' + fyOf(null) + '</th><th class="n">Read free</th><th></th></tr></thead><tbody>';
  if (!cos.length) h += '<tr><td colspan="7" class="note">No client matches \u201c' + esc(S.homeQuery) + "\u201d.</td></tr>";
  cos.forEach(c => {
    const st = c.stats || {}, cur = st.fy === fyOf(null);
    h += '<tr class="rowlink" data-open="' + c.id + '"><td><b>' + esc(c.name) + "</b>" + (docqCount(c.id) ? ' <span class="tag" title="Files waiting in the inbox">\u{1F4E5} ' + docqCount(c.id) + "</span>" : "") + (c.tallyName && c.tallyName !== c.name ? '<div class="note">Tally: ' + esc(c.tallyName) + "</div>" : "") +
      "</td><td>" + esc(c.gstin || "—") + '</td><td class="n">' + (st.drafts || "—") + '</td><td class="n">' + (st.check ? '<span class="tag warn">' + st.check + "</span>" : "—") +
      '</td><td class="n">' + (st.waiting ? '<span class="tag ok">' + st.waiting + "</span>" : "—") + '</td><td class="n">' + (cur && st.tdsFy ? money0(st.tdsFy) : "—") +
      '</td><td class="n">' + (freeRate(c) ? '<span class="tag ' + (freeRate(c).pct >= 90 ? "ok" : "warn") + '" title="' + freeRate(c).free + " free, " + freeRate(c).google + " Google, " + freeRate(c).claude + ' Claude">' + freeRate(c).pct + "% of " + freeRate(c).n + "</span>" : "—") +
      '</td><td class="n"><button class="btn small" data-open="' + c.id + '">Open</button></td></tr>';
  });
  return h + "</tbody></table></div>";
}
function addCompanyForm(){
  const others = sortedCompanies();
  return '<h2>Add client</h2><div class="grid" style="margin-top:10px">' +
    '<label class="f wide"><span>Client name</span><input data-draft type="text" id="ncName" placeholder="e.g. Gupta Traders Pvt Ltd"></label>' +
    '<label class="f"><span>GSTIN</span><input data-draft type="text" id="ncGstin" placeholder="09AAACG1111A1Z5"></label>' +
    '<label class="f"><span>Company name in Tally</span><input data-draft type="text" id="ncTally" placeholder="Same as client name"></label>' +
    (others.length ? '<label class="f wide"><span>Copy ledger names from</span><select data-draft id="ncCopy"><option value="">Standard names</option>' + others.map(c => '<option value="' + c.id + '">' + esc(c.name) + "</option>").join("") + "</select></label>" : "") +
    '</div><label class="chk" style="margin-top:10px"><input type="checkbox" id="ncTurn"> Turnover last year was above ₹10 crore</label>' +
    '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="saveCo">Add and open</button><button class="btn" data-act="cancelCo">Cancel</button></div>';
}

/* ---------- Home: unsorted uploads ---------- */
function viewInbox(){
  const items = Object.values(S.inbox).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!items.length && docqFor("").length) return docqPanel("");
  if (!items.length) return '<div class="pane" style="margin-top:0"><h2>Nothing unsorted</h2><p class="note" style="margin:0">Invoices uploaded from the client list land here only when their buyer does not match a client.</p></div>';
  const opts = '<option value="">Choose client…</option>' + sortedCompanies().map(c => '<option value="' + c.id + '">' + esc(c.name) + "</option>").join("");
  let h = '<div class="tblwrap"><table class="data"><thead><tr><th>File</th><th>Supplier</th><th>Billed to</th><th class="n">Total</th><th>Why it is here</th><th>Move to</th><th></th></tr></thead><tbody>';
  items.forEach(i => {
    const j = i.j || {};
    h += "<tr><td>" + esc(i.fileName) + "</td><td>" + (i.reading ? '<span class="tag no">Reading…</span>' : esc(j.vendorName || "—")) + "</td><td>" + esc(j.buyerName || "—") + (j.buyerGstin ? '<div class="note">' + esc(j.buyerGstin) + "</div>" : "") +
      '</td><td class="n">' + (j.totalAmount ? money0(j.totalAmount) : "—") + '</td><td class="note">' + esc(i.note || "") + "</td>" +
      "<td>" + (i.reading ? "" : '<select data-assign="' + i.id + '" aria-label="Move to client">' + opts + "</select>") + "</td>" +
      '<td class="n">' + (i.reading ? "" : '<button class="btn small danger" data-delinbox="' + i.id + '">Delete</button>') + "</td></tr>";
  });
  return h + "</tbody></table></div>";
}

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

  // 3. keys: only when nobody is signed in to a firm account, or for the administrator
  const showKeys = !Cloud.on() || (S.account && S.account.superadmin);
  if (showKeys) h += '<div class="pane" id="keysPane"><h2>Keys</h2>' +
    (Cloud.on() ? '<p class="note" style="margin:0 0 10px">Keys kept on this computer. Firms do not need any: they use Claude and Google through the platform.</p>' : "") +
    '<div class="two">' +
    keyBox({title: "Google Cloud Vision OCR key", label: "Google API key", inputId: "gKey", placeholder: "AIza...", value: gcfg.key, saveAct: "saveGoogle", removeAct: "removeGoogle",
      help: "Google Cloud console → create a project → enable billing → enable the Cloud Vision API → APIs & Services → Credentials → Create API key (restrict it to Cloud Vision). 1,000 pages a month free, then about $1.50 per 1,000. Kept only in this browser."}) +
    keyBox({title: "Claude API key", label: "Claude API key", inputId: "apiKey", placeholder: "sk-ant-...", value: cfg.key, saveAct: "saveKey", removeAct: "removeKey",
      help: "Claude Console → API keys. Used only for bills the OCR steps cannot read with confidence. Billed on your Claude Console account. Kept only in this browser.",
      extra: '<div class="grid" style="margin-top:6px"><label class="f"><span>Model</span><input data-draft type="text" id="apiModel" value="' + esc(cfg.model) + '"></label>' +
        '<label class="f"><span>Careful re-read model</span><input data-draft type="text" id="apiCareful" value="' + esc(cfg.carefulModel) + '"></label></div>'}) +
    "</div></div>";

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
const SETTING_TILES = [
  {id: "account",  title: "Firm account",      note: "Who is signed in, people in the firm, sync",       icon: "\u{1F465}"},
  {id: "plan",     title: "Plan and credit",   note: "What you pay, credit left, usage this month",      icon: "\u{1F4B3}"},
  {id: "bridge",   title: "Tally Bridge",      note: "Connect to TallyPrime, set it up, check it",       icon: "\u{1F517}"},
  {id: "reading",  title: "Reading bills",     note: "How bills are read, and a test of each way",       icon: "\u{1F441}"},
  {id: "rates",    title: "Rates and limits",  note: "TDS rates, limits and the firm's own details",     icon: "\u{1F4D0}"},
  {id: "postlog",  title: "Sent to Tally",     note: "Every entry posted, by whom, and taking one back", icon: "\u{1F4DC}"},
  {id: "platform", title: "Platform",          note: "All firms, credit, plans, prices, keys",           icon: "\u{1F3E2}", superadmin: true}
];
function settingsTiles(){
  const sa = !!(S.account && S.account.superadmin);
  const a = S.account;
  const sub = {
    account: Cloud.on() ? (a && a.me ? esc(a.me.email) + " \u00b7 " + esc(a.me.role) : "signed in") : "not signed in",
    plan: a && a.firm ? (a.firm.plan ? esc(a.firm.plan.name) : "no plan") + " \u00b7 " + INR.format(num(a.firm.balance)) + " left" : "",
    bridge: Bridge.on() && Bridge.up() ? (Bridge.st.tallyUp ? "connected to Tally" : "bridge running, Tally not open") : "not connected",
    reading: S.engine === "api" ? "free steps, then Claude" : hasGoogle() ? "free steps, then Google OCR" : "free reading only",
    rates: "tax year " + (S.firm && S.firm.fy ? esc(S.firm.fy) : "2026-27"),
    postlog: ((S.firm.postLog || []).filter(r => r.co === S.coId).length) + " entries",
    platform: S.adminData ? (S.adminData.firms || []).length + " firms" : "administrator"
  };
  return '<div class="tiles">' + SETTING_TILES.filter(t => !t.superadmin || sa).map(t =>
    '<button class="tile" data-settab="' + t.id + '"><span class="ti">' + t.icon + '</span><span class="tt">' + esc(t.title) + "</span>" +
    '<span class="tn">' + esc(t.note) + "</span>" + (sub[t.id] ? '<span class="ts">' + sub[t.id] + "</span>" : "") + "</button>").join("") + "</div>";
}
function viewPostLog(){
  const log = (S.firm.postLog || []).slice().reverse();
  const mine = S.logAll ? log : log.filter(r => r.co === S.coId);
  let h = '<div class="pane"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Everything sent to Tally</h2>' +
    '<div><button class="btn small" data-act="logAll">' + (S.logAll ? "This client only" : "All clients") + '</button><button class="btn small" data-act="logCsv">Download as a file</button></div></div>' +
    '<p class="note" style="margin:6px 0 10px">' + mine.length + " entr" + (mine.length === 1 ? "y" : "ies") + (S.logAll ? " across every client" : " for " + esc(CO().name)) + ". Kept so you can prove what was posted, by whom, and when.</p>";
  if (!mine.length) return h + '<p class="note">Nothing yet.</p></div>';
  h += '<div class="tblwrap"><table class="data"><thead><tr><th>When</th><th>What</th><th>Client</th><th>Reference</th><th class="n">Amount</th><th>Voucher in Tally</th><th>By</th></tr></thead><tbody>' +
    mine.slice(0, 500).map(r => "<tr" + (r.action === "removed" ? ' style="opacity:.65"' : "") + "><td>" + new Date(r.at).toLocaleString([], {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}) + "</td>" +
      "<td>" + (r.action === "removed" ? "<b>taken back</b> \u00b7 " : "") + esc(r.what === "bill" ? "purchase bill" : r.what === "bank" ? "bank entry" : r.what || "") + "</td>" +
      "<td>" + esc((CO(r.co) || {}).name || "\u2014") + "</td><td>" + esc(r.ref || "") + '</td><td class="n">' + (r.amount ? INR.format(num(r.amount)) : "\u2014") + "</td>" +
      "<td>" + esc(((r.tally || {}).vchType || "") + " " + ((r.tally || {}).masterId || "")) + '<div class="nr">' + esc((r.tally || {}).company || "") + "</div></td>" +
      "<td>" + esc(r.by || "\u2014") + "</td></tr>").join("") + "</tbody></table></div>";
  return h + "</div>";
}
function postLogCsv(){
  const log = (S.firm.postLog || []).slice().reverse();
  const rows = [["When", "What", "Action", "Client", "Reference", "Party", "Amount", "Voucher type", "Tally id", "Company", "By"]].concat(
    log.map(r => [r.at, r.what || "", r.action || "", (CO(r.co) || {}).name || "", r.ref || "", r.party || "", r.amount || "", (r.tally || {}).vchType || "", (r.tally || {}).masterId || "", (r.tally || {}).company || "", r.by || ""]));
  saveFile("posted-to-tally-" + new Date().toISOString().slice(0, 10) + ".csv", new Blob([rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n")], {type: "text/csv"}));
}
function viewRates(){
  let h = '<div class="pane"><h2>Firm</h2><div class="grid"><label class="f"><span>Firm name</span><input type="text" data-firm="firmName" value="' + esc(S.firm.firmName) + '"></label></div></div>';
  h += '<div class="pane"><h2>Rates and limits for all clients</h2><p class="note" style="margin:0 0 12px">Set for tax year 2026-27 under section 393 of the Income-tax Act, 2025. Check them against the Act and any Finance Act changes before relying on them. Ledger names are set per client in Company settings.</p>' +
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
function viewRules(){
  const tab = S.settingsTab;
  if (!tab) return '<div class="pane" style="background:none;border:0;padding:0"><h2 style="margin:0 0 4px">Settings</h2><p class="note" style="margin:0 0 14px">Choose what you want to change.</p></div>' + settingsTiles();
  const t = SETTING_TILES.find(x => x.id === tab) || SETTING_TILES[0];
  const head = '<div class="row" style="margin:0 0 12px;align-items:center"><button class="btn small" data-settab="">\u2190 All settings</button><h2 style="margin:0;font-size:19px">' + t.icon + " " + esc(t.title) + "</h2></div>";
  if (tab === "account") return head + viewCloudSettings() + (Cloud.on() ? viewAccountPeopleOnly() : "");
  if (tab === "plan") return head + viewAccount();
  if (tab === "bridge") return head + viewBridgeSettings();
  if (tab === "reading") return head + viewReading();
  if (tab === "postlog") return head + viewPostLog();
  if (tab === "platform") return head + viewSuperadmin();
  return head + viewRates();
}

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
function drawerHtml(){
  const e = drawerEntry();
  if (!e) return "";
  const rows = draftRows(), i = rows.findIndex(r => r.e.id === e.id);
  return '<button class="drawer-scrim" data-act="drawerClose" aria-label="Close"></button><aside class="drawer" role="dialog" aria-modal="true" aria-label="Bill">' +
    '<div class="drawer-head"><div><b>' + esc(e.x.vendorName || e.fileName || "Bill") + '</b><span class="note">' + esc(e.x.invoiceNo || "") + (i >= 0 ? " \u00b7 " + (i + 1) + " of " + rows.length : "") + "</span></div>" +
    '<button class="btn small" data-act="drawerClose">Close</button></div>' + viewDetail(e) + "</aside>";
}
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
function revFilterRow(){
  const f = S.revF || {};
  const txt = (k, ph) => '<input type="text" data-rf="' + k + '" data-fk="rf' + k + '" data-keeptyped autocomplete="off" placeholder="' + ph + '" value="' + esc(f[k] || "") + '" aria-label="' + ph + '">';
  return '<tr class="bk-frow"><th class="ck"></th>' +
    '<th class="dt"><input type="date"' + (f.from ? ' class="on"' : '') + ' data-rf="from" data-fk="rffrom" value="' + esc(f.from || "") + '" aria-label="From date"><input type="date"' + (f.to ? ' class="on"' : '') + ' data-rf="to" data-fk="rfto" value="' + esc(f.to || "") + '" aria-label="To date"></th>' +
    "<th>" + txt("sup", "supplier, GSTIN or ledger") + "</th><th>" + txt("no", "bill no.") + "</th>" +
    '<th class="n"><input type="number" data-rf="min" data-fk="rfmin" placeholder="from" value="' + esc(f.min || "") + '" aria-label="Value from"><input type="number" data-rf="max" data-fk="rfmax" placeholder="to" value="' + esc(f.max || "") + '" aria-label="Value to"></th>' +
    '<th><select' + (f.nature ? ' class="on"' : '') + ' data-rf="nature" aria-label="Payment type"><option value="">Any type</option>' + rules().map(r => '<option value="' + r.id + '"' + (f.nature === r.id ? " selected" : "") + ">" + esc(r.label) + "</option>").join("") + "</select></th>" +
    '<th class="ck" colspan="2"><select' + (f.tds ? ' class="on"' : '') + ' data-rf="tds" aria-label="TDS"><option value="">Any</option><option value="yes"' + (f.tds === "yes" ? " selected" : "") + '>TDS booked</option><option value="no"' + (f.tds === "no" ? " selected" : "") + ">No TDS</option></select></th>" +
    '<th><select' + (f.look ? ' class="on"' : '') + ' data-rf="look" aria-label="Needs a look"><option value="">All bills</option><option value="yes"' + (f.look === "yes" ? " selected" : "") + '>Need a look</option><option value="no"' + (f.look === "no" ? " selected" : "") + ">Ready to approve</option></select></th>" +
    '<th class="ac">' + (revColOn() ? '<button class="linkbtn" data-act="revFClear">Clear</button>' : "") + "</th></tr>";
}
function viewReviewTable(){
  const co = CO(), all = draftRows(), rows = revFiltered();
  const busyTop = "";
  const sel = S.revSel = S.revSel || new Set();
  const nSel = rows.filter(r => sel.has(r.e.id)).length;
  let h = '<div class="bk"><div class="bk-head"><div class="bk-id"><h2 class="bk-title">Review ' + rows.length + " uploaded bill" + (rows.length === 1 ? "" : "s") + '</h2><div class="bk-sub">' + esc(co.name) + " \u00b7 tick the ones to book TDS on, then approve together</div></div>" +
    '<dl class="bk-figs"><div><dt>Bills</dt><dd>' + rows.length + '</dd></div><div><dt>Value</dt><dd>' + INR.format(r2(rows.reduce((a, r) => a + num(r.e.x.total), 0))) + '</dd></div><div><dt>TDS</dt><dd>' + INR.format(r2(rows.reduce((a, r) => a + num(r.c.tds), 0))) + "</dd></div></dl>" +
    '<div class="bk-actions"><button class="btn small" data-act="revList">One at a time</button></div></div>';
  if (!rows.length) return h + '<div class="bk-none" style="background:var(--sheet);border:1px solid var(--rule);border-radius:10px">Nothing waiting. Upload bills above.</div></div>';
  h = busyTop + h;
  h += '<div class="revfilter"><input type="search" id="revq" data-fk="revq" value="' + esc(S.revQuery || "") + '" placeholder="Filter by supplier, bill no., GSTIN, ledger, payment type or amount" aria-label="Filter the bills">' +
    (S.revQuery && !revColOn() ? '<span class="note">' + rows.length + " of " + all.length + " shown</span>" : "") + "</div>" + colChipBar("rev", rows.length, all.length + " bills");
  h += '<div class="bk-tablewrap"><table class="bk-table revtbl"><thead><tr><th class="ck"><input type="checkbox" data-revall' + (nSel && nSel === rows.length ? " checked" : "") + '></th>' + colHead("rev", "date", "Date", "dt") + colHead("rev", "sup", "Supplier") + colHead("rev", "no", "Bill no.") + colHead("rev", "val", "Value", "n") + colHead("rev", "nature", "Payment type") + colHead("rev", "tds", "TDS", "ck") + '<th class="n">TDS</th>' + colHead("rev", "look", "This year vs limit") + '<th class="ac"></th></tr></thead><tbody>';
  h += rows.map(({e, c}) => {
    const fy = fyOf(e.x.invoiceDate), t = tallyYtdFor(c.party, fy, e);
    const m = c.meter;
    const limitCell = !m || !m.limit ? '<span class="src muted">no yearly limit</span>'
      : '<span class="' + (m.used + m.add > m.limit ? "src bad" : "src") + '">' + money0(m.used + m.add) + " of " + money0(m.limit) + (m.used + m.add > m.limit ? " \u00b7 crossed" : " \u00b7 within") + "</span>" +
        '<span class="src muted">' + (t ? "incl. " + money0(t.credited) + " from Tally" : "bills here only") + "</span>";
    const miss = (c.missing || []).length || c.flags.some(f => f.lvl === "hi") || e.confirmType;
    const led = e.expenseLedger || "", ledOk = led && (!hasLedgerList() || exactLedger(led));
    return '<tr class="' + (sel.has(e.id) ? "picked " : "") + (miss ? "needs" : "") + (S.drawerOpen && S.selected === e.id ? " open" : "") + '"><td class="ck"><input type="checkbox" data-revsel="' + e.id + '"' + (sel.has(e.id) ? " checked" : "") + "></td>" +
      '<td class="dt">' + (e.x.invoiceDate ? shortDate(e.x.invoiceDate) : "\u2014") + "</td>" +
      '<td class="pt"><button class="linkbtn pn" data-revopen="' + e.id + '">' + esc(e.x.vendorName || e.fileName || "\u2014") + '</button><div class="nr">' + esc(e.x.vendorGstin || e.x.vendorPan || "no GSTIN or PAN") + "</div>" +
        '<div class="nr ' + (ledOk ? "led-ok" : "led-bad") + '">' + (led ? "\u2192 " + esc(led) + (ledOk ? " \u2713" : " \u00b7 not in Tally") : "\u2192 no ledger yet") + "</div>" +
        (e.postFailedAt && e.postError ? '<div class="nr bad">Tally refused: ' + esc(e.postError) + "</div>" : "") +
        (e.noteKind ? '<div class="nr"><span class="tag">' + (e.noteKind === "credit" ? "Credit note \u2192 Debit Note in Tally" : "Debit note") + "</span></div>" : "") + "</td>" +
      "<td>" + esc(e.x.invoiceNo || "\u2014") + '</td><td class="n">' + INR.format(num(e.x.total)) + "</td>" +
      '<td><select data-revnature="' + e.id + '">' + rules().map(r => '<option value="' + r.id + '"' + (r.id === e.natureId ? " selected" : "") + ">" + esc(r.label) + "</option>").join("") + "</select></td>" +
      '<td class="ck"><input type="checkbox" data-revtds="' + e.id + '"' + (c.tdsWould > 0 && !c.skip ? " checked" : "") + (c.rule && c.rule.basis === "never" ? " disabled" : "") + ' title="' + esc(c.skip ? skipText(c.skip) : c.tdsWould > 0 ? "TDS is deducted on this bill" : "Below the limits: tick to deduct anyway") + '"></td>' +
      '<td class="n">' + (c.tds ? "<b>" + INR.format(c.tds) + "</b>" : c.tdsWould ? '<span class="src muted">' + INR.format(c.tdsWould) + " not booked</span>" : "\u2014") + "</td>" +
      "<td>" + limitCell + "</td>" +
      '<td class="ac">' + (miss ? '<button class="btn small" data-revopen="' + e.id + '">Check</button>' : '<button class="btn small primary" data-revapprove="' + e.id + '">Approve</button>') +
      '<button class="icon" data-revopen="' + e.id + '" title="Open this bill">\u2197</button><button class="icon danger" data-billdel="' + e.id + '" title="Delete this bill" aria-label="Delete this bill">\u2715</button></td></tr>';
  }).join("");
  h += "</tbody></table></div></div>";
  return h;
}
function reviewBar(){
  const rows = draftRows(), sel = S.revSel || new Set();
  const picked = rows.filter(r => sel.has(r.e.id));
  const ready = rows.filter(r => !(r.c.missing || []).length && !r.c.flags.some(f => f.lvl === "hi") && !r.e.confirmType);
  if (picked.length){
    return '<div class="actionbar bk-actionbar"><div class="ab-left"><b>' + picked.length + " selected</b> <span class=\"muted\">\u00b7 TDS " + INR.format(r2(picked.reduce((a, r) => a + num(r.c.tds), 0))) + '</span> <button class="linkbtn" data-act="revNone">Clear</button></div>' +
      '<div class="ab-right"><button class="btn" data-act="revTdsOn">Book TDS</button><button class="btn" data-act="revTdsOff">Do not book TDS</button>' +
      '<button class="btn" data-act="revCheckTally"' + (bridgeLive() ? "" : " disabled") + '>Check year in Tally</button>' +
      '<button class="btn danger" data-act="revDelete">Delete ' + picked.length + '</button><button class="btn primary" data-act="revApprove">Approve ' + picked.length + "</button></div></div>";
  }
  return '<div class="actionbar bk-actionbar"><div class="ab-left"><span class="bk-stat"><b>' + rows.length + '</b> to review</span><span class="bk-stat"><b>' + ready.length + "</b> ready to approve</span></div>" +
    '<div class="ab-right"><button class="btn" data-act="revCheckTallyAll"' + (bridgeLive() ? "" : " disabled") + '>Check the year in Tally for all</button><button class="btn primary" data-act="revApproveAll"' + (ready.length ? "" : " disabled") + ">Approve all that are ready (" + ready.length + ")</button></div></div>";
}
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
