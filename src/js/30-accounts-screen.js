
/* ---------- the Financial statements page's years (FinStatements.jsx; the figures are FinSt, src/js/88) ---------- */
function fsYears(){ const ms = GSTR.months(); return Array.from(new Set(ms.map(m => Audit.fyStart(m + "01").slice(0, 4)))).sort().reverse(); }
// the last year the books cover to its end, 31 March (review of 01-Oct-2026: Accounts opens on it and runs by itself);
// the latest year when none is complete yet
function fsLastFull(){
  const ys = fsYears(), vs = ((S.books || {}).vouchers || []);
  let end = String(((S.books || {}).meta || {}).to || "");
  vs.forEach(v => { if (String(v.date) > end) end = String(v.date); });
  return ys.find(y => end >= String(num(y) + 1) + "0331") || ys[0] || "";
}
function fsYearNow(){ const ys = fsYears(); return S.fsFy && ys.includes(S.fsFy) ? S.fsFy : fsLastFull(); }
