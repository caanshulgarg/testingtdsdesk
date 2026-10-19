/* ================================================================== */
/* Check before filing (the owner's council, 13-Oct-2026): one click   */
/* on a TDS quarter (26Q, 27Q, 24Q) or a GST month runs every check   */
/* that applies before the return is filed, and lists each as ok or   */
/* "fix this", with the entries. Pure FinCom logic: no AI, always on,  */
/* whatever the Assistant switch says.                                 */
/* It only READS: it calls the audit's own checks (src/js/06-audit.js) */
/* and the TDS, 26AS and 2B helpers they use, for the return's dates.  */
/* It never calls a return builder's writer and changes no figure      */
/* (tests/run_prefiling.js: the 26Q text file and the GSTR-1 and 3B    */
/* JSON are byte-identical with the check run and not run).            */
/* ================================================================== */
const PreFile = {
  Q: {Q1: ["04", "06"], Q2: ["07", "09"], Q3: ["10", "12"], Q4: ["01", "03"]},
  // a TDS quarter's dates: fy "2025-26", q "Q2" -> 20250701..20250930
  qDates(fy, q){
    const y = num(String(fy).slice(0, 4)) + (q === "Q4" ? 1 : 0), [a, b] = this.Q[q];
    const last = new Date(Date.UTC(y, num(b), 0)).getUTCDate();
    return {from: y + a + "01", to: y + b + String(last).padStart(2, "0")};
  },
  mDates(ym){ const y = num(ym.slice(0, 4)), m = num(ym.slice(4, 6)); return {from: ym + "01", to: ym + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}; },
  today(){ return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10).replace(/-/g, ""); },
  // one of the audit's checks, for these dates, as a checklist line (its findings' rows, at most 300)
  audit(id, from, to, keep){
    const A = Audit, V = A.vouchers(from, to).sort((a, c) => a.date.localeCompare(c.date) || String(a.id).localeCompare(String(c.id)));
    const ctx = {from, to, bal: A.balances(from, to)};
    const r = [].concat(A.checks[id](A, V, ctx) || []).filter(Boolean).filter(f => !keep || keep(f));
    return r.map(f => ({title: f.title, clause: f.clause || "", problem: f.problem || "", amount: r2(f.amount || 0), suggestion: f.suggestion || "", rows: (f.rows || []).slice(0, 300)}));
  },
  line(id, title, what, fn){
    try {
      const r = fn();
      if (r === null) return {id, title, what, status: "na", note: "does not apply here"};
      if (r && r.na) return {id, title, what, status: "na", note: r.na};
      const fs = [].concat(r || []);
      const rows = fs.flatMap(f => f.rows || []);
      return {id, title, what, status: rows.length || fs.some(f => f.count) ? "fix" : "ok", findings: fs, count: rows.length, amount: r2(fs.reduce((s, f) => s + num(f.amount), 0)), note: fs.map(f => f.problem).filter(Boolean).join(" ")};
    } catch (e){ return {id, title, what, status: "error", note: "could not be checked: " + ((e && e.message) || e)}; }
  },
  // ---------- a TDS quarter
  tds(form, fy, q){
    return this.scope(() => {
      const {from, to} = this.qDates(fy, q), today = this.today();
      const L = [];
      // the owner, 19-Oct-2026: no "Deductions missed" item before filing a TDS return (a bill's TDS is often booked in a
      // journal of its own): the TDS not deducted is the Audit's finding alone (Audit.checks.tdsMissed, src/js/06)
      L.push(this.line("rate", "Wrong section or rate", "Deductions at a lower rate than the section and the deductee's PAN call for.",
        () => form === "24Q" ? null : this.audit("tdsRate", from, to)));
      L.push(this.line("challan", "Challans not matched", "Deductions of the quarter not put against a challan (not deposited, or not matched yet).",
        () => this.audit("tdsUnpaid", from, to, f => true).map(f => Object.assign(f, {rows: f.rows.filter(x => this.formOf(x) === form || !x.type)}))));
      L.push(this.line("late", "Late deduction or payment, with interest", "Interest under section 201(1A): 1% a month for deducting late, 1.5% a month for paying late; unpaid deductions past their due date, to today.",
        () => {
          // the deductions not yet paid are added below, to today (TDS.interest's "unpaid" lines, since the TDS review L1, are the same)
          const rows = TDS.interest(fy, q, form).filter(x => x.kind !== "unpaid").map(x => ({vid: x.row.voucherId || "", date: x.row.date, no: x.row.voucher || "", party: x.row.party, type: x.row.section, amount: x.amount,
            note: x.kind === "deduct" ? "deducted " + x.months + " month(s) late at 1%" : "paid " + fmtDate(tallyDate(x.challan.date)) + ", due " + fmtDate(tallyDate(x.due)) + ": " + x.months + " month(s) at " + x.rate + "%"}));
          const pct = form === "27EQ" ? 1 : 1.5;
          TDS.formRows(form).filter(r => r.fy === fy && r.q === q && !r.challan).forEach(r => {
            const due = TDS.dueDate(r.date);
            if (TDS.ymd(due) >= today) return;
            const months = TDS.monthsBetween(r.date, today), amount = r2(r.tds * pct / 100 * months);
            if (amount >= 1) rows.push({vid: r.voucherId || "", date: r.date, no: r.voucher || "", party: r.party, type: r.section, amount, note: "not paid yet: " + months + " month(s) at " + pct + "% to today"});
          });
          return [{title: "Interest", amount: r2(rows.reduce((s, x) => s + x.amount, 0)), rows, problem: rows.length ? rows.length + " deductions; interest " + INR.format(r2(rows.reduce((s, x) => s + x.amount, 0))) + "." : ""}];
        }));
      L.push(this.line("pan", "Section 206AA: deductees without a valid PAN", "TDS applies at 20% without a PAN, and the return is rejected for an invalid one.",
        () => this.audit("tdsPan", from, to).map(f => Object.assign(f, {rows: f.rows.filter(x => !x.type || this.formOf(x) === form || form !== "24Q")}))));
      L.push(this.line("as26", "Deductee totals against 26AS / AIS", "The deductees' 26AS or AIS (where uploaded on the TDS page) against FinCom's rows for the quarter.",
        () => {
          if (typeof AS26 !== "object" || !AS26.files().some(f => AS26.whose(f) === "deductee")) return {na: "no deductee's 26AS or AIS uploaded"};
          const rows = AS26.deductees(fy).flatMap(d => d.rows.filter(x => x.status !== "matched" && ((x.book && x.book.q === q) || (x.line && x.line.q === q)))
            .map(x => ({vid: (x.book || {}).id || "", date: (x.book || x.line || {}).date || "", no: "", party: d.party || d.file.holder || "", type: (x.book || x.line || {}).section || "", amount: num((x.book || x.line || {}).tax),
              note: x.status === "books" ? "in FinCom, not in " + d.file.kind : "in " + d.file.kind + ", not in FinCom" + (x.note ? "; " + x.note : "")})));
          return [{title: "26AS", rows, amount: r2(rows.reduce((s, x) => s + x.amount, 0)), problem: rows.length ? rows.length + " lines differ." : ""}];
        }));
      L.push(this.line("dup", "Duplicate entries", "The same supplier bill entered twice, or the same party and amount within three days.", () => this.audit("duplicates", from, to)));
      L.push(this.line("ledgers", "TDS and GST ledgers confirmed", "Every tax figure rests on how these ledgers are read (Tally ledgers page).", () => this.audit("ledgers", from, to)));
      return {kind: "tds", form, fy, q, from, to, at: new Date().toISOString(), client: (CO() || {}).name || "", lines: L};
    });
  },
  // which form a TDS row belongs to (26Q unless its section is salary or a non-resident's)
  formOf(x){ const s = String(x.type || x.section || ""); return /^192/.test(s) ? "24Q" : /^195/.test(s) ? "27Q" : "26Q"; },
  // ---------- a GST month of one registration
  gst(reg, ym){
    return this.scope(() => {
      const {from, to} = this.mDates(ym);
      const mine = f => Object.assign({}, f, {rows: (f.rows || []).filter(x => !reg || !x.vid || this.regOf(x.vid) === reg)});
      const L = [];
      L.push(this.line("2b", "Input tax in the books against GSTR-2B", "Credit in the books that the suppliers have not reported in 2B (section 16(2)(aa)); reverse-charge credit is never in 2B and is left out.",
        () => Object.values(S.books.twoBs || {}).some(t => t && (!reg || String(t.gstin || "").slice(0, 2) === reg) && t.ym === ym) ? this.audit("gst2b", from, to).map(mine).map(f => Object.assign(f, {rows: f.rows.filter(x => !this.rcmDoc(x.vid))})) : {na: "no 2B for " + GSTR.label(ym) + " in FinCom yet (bring it in on the 2B page)"}));
      L.push(this.line("rcm", "Reverse charge not booked", "Expenses on services taxed under reverse charge, with no tax booked.", () => this.audit("gstRcm", from, to).map(mine)));
      L.push(this.line("blocked", "Credit usually blocked (section 17(5))", "Credit taken on expenses that are usually blocked.", () => this.audit("gstBlocked", from, to).map(mine)));
      L.push(this.line("rule37", "Suppliers unpaid after 180 days (rule 37)", "Credit to reverse on bills unpaid 180 days after their date.", () => this.audit("gstRule37", from, to).map(mine)));
      L.push(this.line("gaps", "Gaps in sales invoice numbers", "Every number issued is to be accounted for (GSTR-1 table 13).", () => this.audit("gaps", from, to)));
      L.push(this.line("dup", "Duplicate entries", "The same supplier bill entered twice, or the same party and amount within three days.", () => this.audit("duplicates", from, to).map(mine)));
      L.push(this.line("ledgers", "GST ledgers confirmed", "Every tax figure rests on how these ledgers are read (Tally ledgers page).", () => this.audit("ledgers", from, to)));
      return {kind: "gst", reg, ym, from, to, at: new Date().toISOString(), client: (CO() || {}).name || "", lines: L};
    });
  },
  scope(fn){ return typeof memoScope === "function" ? memoScope(fn) : fn(); },
  // an entry with reverse-charge tax: its credit is never in 2B (the supplier does not report it), so it is not a 2B gap
  rcmDoc(vid){ const v = (S.books.vouchers || []).find(x => x.id === vid); return !!v && (v.rcm || v.ent.some(e => ((S.books.map || {})[e.l] || {}).rcm === true || ((S.books.map || {})[e.l] || {}).what === "gst_rcm" || /\bRCM\b|REVERSE CHARGE/i.test(e.l))); },
  regOf(vid){ const v = (S.books.vouchers || []).find(x => x.id === vid); return v ? GSTR.regOf(v) : ""; },
  // ---------- the panel (app/src/parts/PreFile.jsx)
  open(kind, a, b, c){
    if (!S.books || S.books.cid !== S.coId || !(S.books.vouchers || []).length){ toast("Open the client's books first (From Tally)."); return; }
    S.prefile = {open: true, busy: true, kind}; render();
    setTimeout(() => { try { S.prefile.res = kind === "tds" ? this.tds(a, b, c) : this.gst(a, b); } catch (e){ S.prefile.err = (e && e.message) || String(e); } S.prefile.busy = false; render(); }, 30);
  },
  close(){ S.prefile = null; render(); },
  title(res){ return res.kind === "tds" ? TDS.formShort(res.form, res.fy) + " " + res.q + " " + res.fy : "GST " + GSTR.label(res.ym) + (res.reg ? " (" + res.reg + ")" : ""); },
  excel(res){
    const head = [["Check before filing: " + this.title(res) + " · " + res.client], ["Run " + new Date(res.at).toLocaleString("en-GB") + ". FinCom's own checks, no AI."], [],
      ["Check", "Result", "Items", "Amount", "Note"]].concat(res.lines.map(l => [l.title, l.status === "ok" ? "ok" : l.status === "fix" ? "fix this" : l.status === "na" ? "does not apply" : "could not check", l.count || 0, l.amount || 0, l.note || ""]));
    const items = [["Check", "Date", "Voucher", "Party or ledger", "Section or type", "Amount", "Note"]].concat(res.lines.flatMap(l => (l.findings || []).flatMap(f => (f.rows || []).map(x =>
      [l.title, x.date ? fmtDate(tallyDate(x.date)) : "", x.no || "", x.party || "", x.type || "", r2(num(x.amount)), x.note || ""]))));
    return FC.excel("check-before-filing-" + this.title(res), [["Checklist", head], ["Entries", items]]);
  },
  openEntry(x){
    const d8 = String(x.date || "").slice(0, 8);
    S.prefile = null;
    const lk = LK.st();
    Object.assign(lk, {kind: "find", q: String(x.no || x.party || ""), typ: "", from: d8 || lk.from, to: d8 || lk.to, heard: "", led: ""});
    FC.go("lookup"); LK.run("auto");
  },
};
