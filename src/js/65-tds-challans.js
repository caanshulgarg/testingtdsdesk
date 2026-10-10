/* ================================================================== */
/* TDS challans: proposals, tagging many at once, uploads             */
/* ================================================================== */
// The owner's choice of 10-Oct-2026 (all four together), so nobody tags deductions to challans one by one:
//  1. auto-match by section and month: a month's deductions of one section (old or new name) against a challan of that
//     section under minor head 200 whose tax + surcharge + cess (c.tax) equals them, to the paisa; interest and fee are
//     shown apart. A difference is shown in rupees for a person to review. A minor head 400 challan is never proposed;
//  2. Tally bill-wise: a TDS payment voucher (bank payment debiting a TDS payable ledger) whose line pays the deductions'
//     bills (Agst Ref) against their New Ref proposes exactly those deductions for the challan made from it. Only what
//     FinCom already reads from Tally: each line's bill-wise details (e.b, src/js/04), kept in the day book and the cloud
//     copy. No bridge change;
//  3. many deductions tagged or untagged at once (Entries: tick, select all shown);
//  4. challans read from the e-filing portal's Payment History (CSV or Excel) and from challan receipt PDFs, many at once;
//     a Tally TDS payment voucher of the same date and amount is linked to the challan read.
// Nothing is tagged without a person: proposals are worked out each time and kept nowhere; a confirmed tagging is
// S.books.alloc (row id -> challan id) as before, which the FVU file (src/js/16) and every figure read. A challan is never
// used beyond its amount: every tagging here goes through tag(), which refuses it.
const TDSCH = {
  p: (v) => Math.round(num(v) * 100),                          // paisa, so sums are exact
  // every deduction a challan can pay: 26Q, 27Q, 27EQ and the salary TDS the books carry under 192
  rowsAll(){ return TDS.rows().concat(TDS.nrRows(), TDS.tcsRows(), TDS.salaryRows()); },
  // the deductions of one return: 26Q (Form 140), 27Q (144), 27EQ (143), or the 192 the books carry for 24Q (138)
  formRows(form){ return form === "24Q" ? TDS.salaryRows() : form === "27Q" ? TDS.nrRows() : form === "27EQ" ? TDS.tcsRows() : form ? TDS.rows() : this.rowsAll(); },
  ym(d){ return TDS.ymd(d).slice(0, 6); },
  left(c, use){ return r2(num(c.tax) - ((use || TDS.challanUse())[c.id] || 0)); },
  label(c){ return [c.bsr || "", c.date ? fmtDate(tallyDate(c.date)) : "", c.serial || ""].join("/"); },
  // a section as a challan or a portal file writes it, as FinCom's old section: "94C" and "194C" and "194-C" are 194C,
  // "92B" is 192, a new-Act provision written with its old section ("393(1) Sl. 6(i) [old 194C]") is that section
  secNorm(s){
    const t = String(s || "").toUpperCase(), old = t.match(/OLD\s*(\d{3}[A-Z]{0,3})/);
    if (old) return TDS.sec(old[1]);
    const m = t.replace(/SECTION|SEC\.?|U\/S/g, " ").match(/\b(1?9[2-6][A-Z]{0,3}|206C[A-Z]{0,2})\b/) || t.match(/(1?9[2-6]\s*-?\s*[A-Z]{0,3})/);
    if (!m) return "";
    let x = m[1].replace(/[\s-]/g, "");
    if (/^9[2-6]/.test(x)) x = "1" + x;
    if (/^192[ABC]?$/.test(x)) return "192";               // 92A / 92B / 92C of the files are salary, section 192
    return TDS.sec(x);
  },
  secOk(chSec, rowSec){
    const a = this.secNorm(chSec), b = TDS.sec(rowSec);
    if (!a || !b) return false;
    if (a === b) return true;
    // 194J and its parts (194JA technical, 194JB professional) are paid under one code by many
    return /^194J/.test(a) && /^194J/.test(b) && (a === "194J" || b === "194J");
  },
  isTdsHead(c){ return !c.minorHead || String(c.minorHead) === "200"; },
  /* ---------- Tally bill-wise ---------- */
  // the payment voucher a challan was made from, or one of the same date and amount
  payVoucher(c){
    const b = S.books || {};
    if (!c || !b.vouchers) return null;
    if (c.fromVoucher) return b.vouchers.find(v => v.id === c.fromVoucher) || null;
    return null;
  },
  // the deductions a payment voucher pays bill-wise: its TDS-ledger lines' Agst Ref names, met with the New Ref the
  // deduction put on the same ledger
  billIndex(){
    const b = S.books || {}, idx = {};
    (b.vouchers || []).forEach(v => (v.ent || []).forEach(e => {
      if (!(e.a > 0) || !e.b || Books.ledgerOf(e.l).kind !== "tds_payable") return;
      e.b.forEach(([name, type]) => { if (/new/i.test(type || "") && name) (idx[e.l + "\u0001" + String(name).trim().toUpperCase()] = idx[e.l + "\u0001" + String(name).trim().toUpperCase()] || []).push(v.id + "|" + e.l); });
    }));
    return idx;
  },
  billLinks(v, idx){
    const out = [];
    if (!v) return out;
    (v.ent || []).forEach(e => {
      if (!(e.a < 0) || !e.b || Books.ledgerOf(e.l).kind !== "tds_payable") return;
      e.b.forEach(([name, type]) => { if (/agst/i.test(type || "") && name) (idx[e.l + "\u0001" + String(name).trim().toUpperCase()] || []).forEach(id => { if (!out.includes(id)) out.push(id); }); });
    });
    return out;
  },
  // how many deductions a Tally payment voucher pays bill-wise (shown beside it before it is a challan)
  billCount(vid){ const v = ((S.books || {}).vouchers || []).find(x => x.id === vid); return this.billLinks(v, this.billIndex()).length; },
  /* ---------- proposals ---------- */
  // each: {id, kind: "tally" | "auto", challan, rows, section, months, need, avail, gap (avail - need; below 0: short), exact}
  // form: only that return's deductions (each return page proposes its own)
  proposals(fy, q, form){
    const all = this.formRows(form), use = TDS.challanUse(), byId = {};
    all.forEach(r => { byId[r.id] = r; });
    const open = all.filter(r => !r.challan && (!fy || r.fy === fy) && (!q || r.q === q));
    const free = new Set(open.map(r => r.id)), taken = {}, out = [];
    const avail = (c) => this.left(c, use) - (taken[c.id] || 0);
    const sum = (rows) => rows.reduce((a, r) => a + this.p(r.tds), 0) / 100;
    const put = (kind, c, rows, section, months) => {
      const need = r2(sum(rows)), have = r2(avail(c)), gap = r2(have - need);
      rows.forEach(r => free.delete(r.id));
      taken[c.id] = r2((taken[c.id] || 0) + Math.min(need, Math.max(0, have)));
      out.push({id: kind + ":" + c.id + ":" + section + ":" + months.join(","), kind, challan: c, rows, section, months, need, avail: have, gap, exact: Math.abs(gap) < 0.005,
        interest: num(c.interest), fee: num(c.fee)});
    };
    const chs = TDS.challans().filter(c => this.left(c, use) > 0.005);
    // 1. Tally bill-wise
    const idx = this.billIndex();
    chs.forEach(c => {
      const rows = this.billLinks(this.payVoucher(c), idx).filter(id => free.has(id)).map(id => byId[id]);
      if (!rows.length) return;
      put("tally", c, rows, Array.from(new Set(rows.map(r => TDS.sec(r.section)))).join(", "), Array.from(new Set(rows.map(r => this.ym(r.date)))).sort());
    });
    // 2. section and month: exact first
    const groups = () => {
      const g = {};
      open.filter(r => free.has(r.id)).forEach(r => { const k = TDS.sec(r.section) + "|" + this.ym(r.date); (g[k] = g[k] || {section: TDS.sec(r.section), ym: this.ym(r.date), rows: []}).rows.push(r); });
      return Object.values(g).sort((a, b) => a.ym.localeCompare(b.ym) || a.section.localeCompare(b.section));
    };
    const cands = (section, ym) => chs.filter(c => this.isTdsHead(c) && avail(c) > 0.005 && TDS.ymd(c.date).slice(0, 6) >= ym && (this.secOk(c.section, section) || !this.secNorm(c.section)))
      .sort((a, b) => (this.secNorm(b.section) ? 1 : 0) - (this.secNorm(a.section) ? 1 : 0) || String(a.date).localeCompare(String(b.date)));
    groups().forEach(g => {
      const c = cands(g.section, g.ym).find(x => this.p(avail(x)) === this.p(sum(g.rows)));
      if (c) put("auto", c, g.rows, g.section, [g.ym]);
    });
    // 3. one challan for a section's months together (a quarter paid at once), exact
    const bySec = {};
    groups().forEach(g => { (bySec[g.section] = bySec[g.section] || []).push(g); });
    Object.values(bySec).forEach(gs => {
      if (gs.length < 2) return;
      const rows = [].concat(...gs.map(g => g.rows)), first = gs[0].ym;
      const c = cands(gs[0].section, first).find(x => this.p(avail(x)) === this.p(sum(rows)));
      if (c) put("auto", c, rows, gs[0].section, gs.map(g => g.ym));
    });
    // 4. the nearest challan of the same section (named on the challan), for a person to review: paid closest to the
    //    month's due date (the 7th of the next month)
    groups().forEach(g => {
      const due = TDS.dueDate(g.ym + "01");
      const near = cands(g.section, g.ym).filter(c => this.secOk(c.section, g.section))
        .sort((a, b) => Math.abs(this.days(a.date, due)) - Math.abs(this.days(b.date, due)) || String(a.date).localeCompare(String(b.date)))[0];
      if (near) put("auto", near, g.rows, g.section, [g.ym]);
    });
    return out;
  },
  /* ---------- tagging ---------- */
  // tag deductions to a challan; refused (nothing changes) when the challan would be used beyond its amount
  tag(ids, chId){
    const b = S.books, c = TDS.challans().find(x => x.id === chId);
    if (!b || !c) return {ok: false, why: "No such challan."};
    const byId = {};
    this.rowsAll().forEach(r => { byId[r.id] = r; });
    const rows = (ids || []).map(id => byId[id]).filter(Boolean).filter(r => r.challan !== chId);
    if (!rows.length) return {ok: true, n: 0};
    const add = rows.reduce((a, r) => a + this.p(r.tds), 0), left = this.p(this.left(c));
    if (add > left) return {ok: false, over: (add - left) / 100, why: "That is " + money((add - left) / 100) + " more than is left on challan " + this.label(c) + " (" + money(left / 100) + ")."};
    b.alloc = b.alloc || {};
    rows.forEach(r => { b.alloc[r.id] = chId; });
    saveBooks();
    return {ok: true, n: rows.length};
  },
  untag(ids){
    const b = S.books; let n = 0;
    (ids || []).forEach(id => { if (b && b.alloc && b.alloc[id]){ delete b.alloc[id]; n++; } });
    if (n) saveBooks();
    return {ok: true, n};
  },
  // confirm a proposal: all its deductions, or (fit) those that fit the challan, oldest first
  confirm(pid, opt){
    const form = (opt && opt.form) || "", p = this.proposals(S.tdsFy, S.tdsQ, form).find(x => x.id === pid) || this.proposals("", "", form).find(x => x.id === pid);
    if (!p) return {ok: false, why: "That suggestion is no longer there."};
    let rows = p.rows;
    if (opt && opt.ids) rows = rows.filter(r => opt.ids.includes(r.id));
    if (opt && opt.fit){
      let room = this.p(this.left(p.challan)); const keep = [];
      rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || this.p(a.tds) - this.p(b.tds)).forEach(r => { if (this.p(r.tds) <= room){ keep.push(r); room -= this.p(r.tds); } });
      rows = keep;
    }
    return this.tag(rows.map(r => r.id), p.challan.id);
  },
  confirmAllExact(fy, q, form){
    let n = 0, k = 0;
    // one at a time: each confirmation changes what is left
    for (let i = 0; i < 200; i++){
      const p = this.proposals(fy, q, form).find(x => x.exact);
      if (!p) break;
      const r = this.tag(p.rows.map(x => x.id), p.challan.id);
      if (!r.ok || !r.n) break;
      n += r.n; k++;
    }
    return {n, challans: k};
  },
  /* ---------- reading challans ---------- */
  money2(v){ const t = String(v == null ? "" : v).replace(/rs\.?|inr|₹|,|\s/gi, ""); const n = parseFloat(t); return isFinite(n) ? r2(n) : 0; },
  MON: {JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12},
  // a date as the portal writes it (05-May-2026, 05/05/2026, 2026-05-05, an Excel day number) -> yyyymmdd
  date8(v){
    if (typeof v === "number" && v > 20000 && v < 80000){ const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10).replace(/-/g, ""); }
    const s = String(v || "").trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + m[2] + m[3];
    m = s.match(/^(\d{1,2})[-\/. ]([A-Za-z]{3})[A-Za-z]*[-\/. ,]+(\d{4})/);
    if (m && this.MON[m[2].toUpperCase()]) return m[3] + String(this.MON[m[2].toUpperCase()]).padStart(2, "0") + m[1].padStart(2, "0");
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return m[3] + m[2].padStart(2, "0") + m[1].padStart(2, "0");
    m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (m) return m[3] + m[2] + m[1];
    return "";
  },
  // the old 20-digit CIN: BSR code (7), date of deposit (ddmmyyyy), challan serial (5)
  cin(s){
    const t = String(s || "").replace(/\s/g, "");
    const m = t.match(/^(\d{7})(\d{2})(\d{2})(\d{4})(\d{5})$/);
    if (!m) return null;
    const date = m[4] + m[3] + m[2], mo = num(m[3]), d = num(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return {bsr: m[1], date, serial: m[5], cin: t};
  },
  minor(s){ const m = String(s || "").match(/\b(200|400)\b/); return m ? m[1] : ""; },
  // one challan from what was read; null when it has no BSR, date or serial
  make(x){
    const k = x.cin ? this.cin(x.cin) : null;
    const bsr = String(x.bsr || (k && k.bsr) || "").replace(/\D/g, ""), serial = String(x.serial || (k && k.serial) || "").replace(/\D/g, "");
    const date = this.date8(x.date) || (k && k.date) || "";
    if (bsr.length !== 7 || !serial || !date) return null;
    const tax = this.money2(x.tax), sur = this.money2(x.surcharge), cess = this.money2(x.cess), interest = this.money2(x.interest), fee = this.money2(x.fee),
      pen = this.money2(x.penalty), others = this.money2(x.others), total = this.money2(x.total);
    let t = r2(tax + sur + cess);
    if (!t && total) t = r2(total - interest - fee - pen - others);
    const c = {bsr, serial: serial.padStart(5, "0"), date, tax: t, interest, section: this.secNorm(x.section), minorHead: this.minor(x.minor) || "200"};
    if (k) c.cin = k.cin; else if (x.cin) c.cin = String(x.cin).replace(/\s/g, "");
    if (sur) c.surcharge = sur;
    if (cess) c.cess = cess;
    if (tax && (sur || cess)) c.incomeTax = tax;
    if (fee) c.fee = fee;
    if (pen || others) c.others = r2(pen + others);
    return c;
  },
  // the Payment History table (CSV or Excel), as rows of cells
  fromTable(aoa){
    const H = [["cin", /^cin\b|challan identification/i], ["bsr", /bsr/i], ["serial", /challan\s*(serial|no|number)|^serial/i], ["date", /date\s*of\s*deposit|deposit\s*date|tender\s*date|payment\s*date|paid\s*on|^date/i],
      ["minor", /minor\s*head|type\s*of\s*payment/i], ["section", /nature\s*of\s*payment|section|^nature/i], ["surcharge", /surcharge/i], ["cess", /cess/i],
      ["interest", /interest/i], ["penalty", /penalty/i], ["fee", /fee|234e/i], ["others", /^others?$/i], ["total", /total/i], ["tax", /^(basic\s*)?(income\s*)?tax(\s*amount)?(\s*\(.*\))?$/i]];
    const at = aoa.findIndex(r => (r || []).some(x => /bsr|^cin\b/i.test(String(x || "").trim())));
    if (at < 0) return [];
    const head = aoa[at].map(x => String(x || "").trim()), col = {};
    head.forEach((h, i) => { const hit = H.find(([k, re]) => !(k in col) && re.test(h)); if (hit) col[hit[0]] = i; });
    return aoa.slice(at + 1).map(r => {
      const x = {};
      Object.keys(col).forEach(k => { x[k] = (r || [])[col[k]]; });
      return this.make(x);
    }).filter(Boolean);
  },
  // a challan receipt PDF's text (the e-filing portal's e-Pay Tax receipt, or a bank's counterfoil)
  fromText(text){
    const t = String(text || "").replace(/₹/g, "Rs. ");
    const get = (re) => { const m = t.match(re); return m ? m[1].trim() : ""; };
    const amt = (label) => get(new RegExp("(?:^|\\n)\\s*(?:[A-F]\\s+)?" + label + "[^\\n\\d]*?([\\d,]+\\.\\d{2}|[\\d,]+)", "i"));
    const x = {
      cin: get(/\bCIN\s*(?:No\.?)?\s*[:\-]?\s*([0-9 ]{20,24})/i), bsr: get(/BSR\s*code\s*[:\-]?\s*(\d{7})/i),
      serial: get(/Challan\s*(?:Serial\s*)?(?:No\.?|Number)\s*[:\-]?\s*(\d{1,6})\b/i),
      date: get(/(?:Date\s*of\s*Deposit|Tender\s*Date|Deposit\s*Date)\s*[:\-]?\s*([0-9]{1,2}[-\/. ][A-Za-z0-9]{2,9}[-\/. ,]+\d{4})/i),
      minor: get(/Minor\s*Head\s*[:\-]?\s*([^\n]*)/i), section: get(/(?:Nature\s*of\s*Payment|Section)\s*[:\-]?\s*([^\n]*)/i),
      tax: amt("Tax(?!\\s*Breakup)(?!\\s*Applicable)"), surcharge: amt("Surcharge"), cess: amt("(?:Education\\s*)?Cess"), interest: amt("Interest"),
      penalty: amt("Penalty"), fee: amt("Fee(?:\\s*under\\s*section\\s*234E)?"), total: amt("Total(?:\\s*\\([^)]*\\))?")
    };
    if (x.cin) x.cin = x.cin.replace(/\s/g, "").slice(0, 20);
    const c = this.make(x);
    return c ? [c] : [];
  },
  async readFile(f){
    const name = String(f.name || "").toLowerCase();
    if (/\.pdf$/.test(name) || f.type === "application/pdf"){
      const pdf = await getPdf(f); let text = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 6); i++){ try { text += pageTextLines(await (await pdf.getPage(i)).getTextContent()) + "\n"; } catch (e){} }
      // a PDF of many receipts: each page on its own
      const pages = text.split(/(?=Challan\s*Receipt|ITNS\s*No)/i).filter(s => /BSR|CIN/i.test(s));
      return [].concat(...(pages.length ? pages : [text]).map(s => this.fromText(s)));
    }
    if (/\.csv$|\.txt$/.test(name) && !/\.xlsx?$/.test(name)){
      const text = await f.text();
      return this.fromTable(this.csv(text));
    }
    await ensureXlsx();
    const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), {type: "array"});
    return [].concat(...wb.SheetNames.map(s => this.fromTable(XLSX.utils.sheet_to_json(wb.Sheets[s], {header: 1, raw: true, defval: ""}))));
  },
  csv(text){
    const rows = []; let row = [], cell = "", q = false;
    const s = String(text || "").replace(/^﻿/, "");
    for (let i = 0; i < s.length; i++){
      const ch = s[i];
      if (q){ if (ch === '"' && s[i + 1] === '"'){ cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
      if (ch === '"') q = true;
      else if (ch === ","){ row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r"){ if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length){ row.push(cell); rows.push(row); }
    return rows;
  },
  // add what was read: one challan per BSR, date and serial (one already there gets what was missing: CIN, section, minor
  // head, the parts of the tax); each new one linked to the Tally TDS payment of the same amount, the same date first
  add(list){
    const b = S.books;
    b.challans = b.challans || [];
    const key = c => c.bsr + "|" + TDS.ymd(c.date) + "|" + String(c.serial).padStart(5, "0");
    const have = {};
    b.challans.forEach(c => { have[key(c)] = c; });
    const linked = new Set(b.challans.map(c => c.fromVoucher).filter(Boolean));
    const pays = TDS.paymentsFromBooks();
    let added = 0, updated = 0, linkedN = 0;
    list.forEach(x => {
      const old = have[key(x)];
      if (old){
        let ch = false;
        ["cin", "section", "minorHead", "surcharge", "cess", "incomeTax", "fee", "others"].forEach(k => { if (x[k] && !old[k]){ old[k] = x[k]; ch = true; } });
        if (ch) updated++;
        return;
      }
      const c = Object.assign({id: uid("ch"), from: "upload"}, x);
      const near = (d) => pays.find(p => !linked.has(p.vid) && this.p(p.tax) === this.p(c.tax) && Math.abs(this.days(p.date, c.date)) <= d);
      const p = c.tax > 0 ? near(0) || near(3) : null;
      if (p){ c.fromVoucher = p.vid; linked.add(p.vid); linkedN++; }
      b.challans.push(c); have[key(c)] = c; added++;
    });
    if (added || updated) saveBooks();
    return {added, updated, linked: linkedN};
  },
  days(a, b){
    const d = s => { const t = TDS.ymd(s); return Date.UTC(num(t.slice(0, 4)), num(t.slice(4, 6)) - 1, num(t.slice(6, 8))); };
    return Math.round((d(a) - d(b)) / 86400000);
  },
  async upload(files){
    const list = Array.from(files || []);
    if (!list.length || !S.books) return null;
    let read = [], bad = [];
    for (const f of list){
      try { const got = await this.readFile(f); if (got.length) read = read.concat(got); else bad.push(f.name); } catch (e){ bad.push(f.name); }
    }
    const r = this.add(read);
    const props = this.proposals(S.tdsFy, S.tdsQ, S.tdsView === "return" ? S.tdsForm || "26Q" : ""), exact = props.filter(p => p.exact).length;
    toast((r.added ? r.added + " challan" + (r.added === 1 ? "" : "s") + " added" : "No new challan") + (r.updated ? ", " + r.updated + " filled in" : "") +
      (r.linked ? ", " + r.linked + " matched to Tally payments" : "") + "." + (props.length ? " " + props.length + " suggestion" + (props.length === 1 ? "" : "s") + " to confirm" + (exact ? " (" + exact + " exact)" : "") + "." : "") +
      (bad.length ? " Nothing read from " + bad.slice(0, 3).join(", ") + (bad.length > 3 ? " and " + (bad.length - 3) + " more" : "") + "." : ""));
    render();
    return Object.assign({read: read.length, bad}, r);
  }
};
