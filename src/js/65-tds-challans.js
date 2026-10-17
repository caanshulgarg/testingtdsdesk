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
  // the tax left on a challan: the one balance (TDSReg.balance); use: the tax used, where the caller has it already
  left(c, use){ return use ? r2(num(c.tax) - (use[c.id] || 0)) : TDSReg.balance(c).tax; },
  // a challan's key: BSR code | date of deposit | serial (5 digits): one challan in the register, whoever made it
  chKey(c){ return c ? String(c.bsr || "") + "|" + TDS.ymd(c.date) + "|" + String(c.serial || "").padStart(5, "0") : ""; },
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
  // next-challan-match (17-Oct-2026): the proposals that were here (section and month, Tally bill-wise) are the one
  // matcher's rules a to d now (TDSMatch.suggest, src/js/86, and server/_shared/tdsmatch.js)
  /* ---------- tagging ---------- */
  // tag deductions to a challan; refused (nothing changes) when the challan would be used beyond its amount
  // tds-layout (14-Oct-2026, the owner's register rules, TDSReg src/js/79): refused on a return marked filed (locked until a
  // correction is opened), and over the limit in the owner's words, "₹X left on this challan" (the one balance,
  // TDSReg.balance); each tag goes to the audit trail. opt: via (tag | auto | tally | suggestion | balance), cx (the
  // action's context, kept up to date here, so a loop of tags reads it), nosave (the caller saves once at its end)
  tag(ids, chId, opt){
    opt = opt || {};
    const b = S.books, c = TDS.challans().find(x => x.id === chId);
    if (!b || !c) return {ok: false, why: "No such challan."};
    const cx = opt.cx || TDSReg.ctx(), byId = cx.byRow;
    const rows = (ids || []).map(id => byId[id] && byId[id].r).filter(Boolean).filter(r => r.challan !== chId);
    if (!rows.length) return {ok: true, n: 0};
    const lock = TDSReg.lockedOf(rows.map(r => r.id), cx);
    if (lock) return {ok: false, locked: true, why: lock};
    const add = rows.reduce((a, r) => a + this.p(r.tds), 0), left = this.p(TDSReg.balance(c, cx).tax);
    if (add > left) return {ok: false, over: (add - left) / 100, why: money(left / 100) + " left on this challan (" + this.label(c) + "): these need " + money(add / 100) + ", " + money((add - left) / 100) + " more than that."};
    b.alloc = b.alloc || {};
    const chs = TDS.challans(), moved = rows.filter(r => r.challan).map(r => ({r, ch: chs.find(x => x.id === r.challan) || null}));
    if (moved.length) TDSReg.logUntag(moved, cx);
    // bridge 2.4.3 (review 243 S1, S2): a tag made here is the person's (the sync marks its own "tally" after); a person's "off" kept (review 243 U1)
    rows.forEach(r => {
      if (r.challan) TDSReg.track(cx, r, byId[r.id].form, r.challan, -1);
      b.alloc[r.id] = chId; r.challan = chId; TDSReg.track(cx, r, byId[r.id].form, chId, 1);
      if (b.allocFrom && b.allocFrom[r.id] === "tally") delete b.allocFrom[r.id];
    });
    TDSReg.logTag(rows, c, opt.via || "tag", cx, opt.note);
    TDSReg.kept(cx);
    if (!opt.nosave){ TDSReg.done(); saveBooks(); }
    return {ok: true, n: rows.length};
  },
  untag(ids, opt){
    opt = opt || {};
    const b = S.books; if (!b) return {ok: true, n: 0};
    const cx = opt.cx || TDSReg.ctx(), on = (ids || []).filter(id => b.alloc && b.alloc[id]);
    const lock = TDSReg.lockedOf(on, cx);
    if (lock) return {ok: false, n: 0, locked: true, why: lock};
    const chs = TDS.challans(), gone = [];
    // a deduction a person takes off the challan Tally linked it to stays off ("off": the sync lists it, never tags it back) (review 243 T2)
    on.forEach(id => {
      const x = cx.byRow[id], chId = b.alloc[id];
      if (x){ gone.push({r: x.r, ch: chs.find(c => c.id === chId) || null}); TDSReg.track(cx, x.r, x.form, chId, -1); x.r.challan = ""; }
      delete b.alloc[id];
      if (b.allocFrom && (b.allocFrom[id] === "tally" || b.allocFrom[id] === "off")) b.allocFrom[id] = "off"; else if (b.allocFrom) delete b.allocFrom[id];
    });
    if (gone.length) TDSReg.logUntag(gone, cx);
    TDSReg.kept(cx);
    if (on.length && !opt.nosave){ TDSReg.done(); saveBooks(); }
    return {ok: true, n: on.length};
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
    const key = c => this.chKey(c);
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
      const c = Object.assign({id: uid("ch"), from: "upload", autoPlace: "pending"}, x);   // next-challan-match: what it pays is suggested (TDSReg.placeNew)
      const near = (d) => pays.find(p => !linked.has(p.vid) && this.p(p.tax) === this.p(c.tax) && Math.abs(this.days(p.date, c.date)) <= d);
      const p = c.tax > 0 ? near(0) || near(3) : null;
      if (p){ c.fromVoucher = p.vid; linked.add(p.vid); linkedN++; }
      b.challans.push(c); have[key(c)] = c; added++;
    });
    const placed = added && typeof TDSReg === "object" ? TDSReg.placeNew().filter(x => x.suggested).length : 0;
    if (added || updated) saveBooks();
    return {added, updated, linked: linkedN, placed};
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
    const props = typeof TDSMatch === "object" && S.tdsFy && S.tdsQ ? TDSMatch.suggestNow(S.tdsView === "return" ? S.tdsForm || "26Q" : "26Q", S.tdsFy, S.tdsQ) : [], exact = props.filter(p => /exact/.test(p.words)).length;
    toast((r.added ? r.added + " challan" + (r.added === 1 ? "" : "s") + " added" : "No new challan") + (r.updated ? ", " + r.updated + " filled in" : "") +
      (r.linked ? ", " + r.linked + " matched to Tally payments" : "") + (r.placed ? ", " + r.placed + " with matches suggested on " + (r.placed === 1 ? "its return" : "their returns") : "") + "." + (props.length ? " " + props.length + " suggestion" + (props.length === 1 ? "" : "s") + " to confirm on Challans" + (exact ? " (" + exact + " exact)" : "") + "." : "") +
      (bad.length ? " Nothing read from " + bad.slice(0, 3).join(", ") + (bad.length > 3 ? " and " + (bad.length - 3) + " more" : "") + "." : ""));
    render();
    return Object.assign({read: read.length, bad}, r);
  }
};
