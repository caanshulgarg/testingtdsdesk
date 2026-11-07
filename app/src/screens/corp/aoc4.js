// AOC-4 (the design "3 · AOC-4 prepared from the balance sheet and P&L"): the balance sheet and the statement of profit and
// loss of a year in the order of form AOC-4's segments (Schedule III, Division I, as in the form), current and previous
// year, with where each figure came from; the figures can be edited (with a reason) and the checks are worked out again.
// FinCom does not file AOC-4: the person types these figures into the form on the MCA portal, attaches the PDFs and files
// with DSC, then saves the SRN in e-Forms.
//
//   HEADS                      the form's lines: [key, label, section, from FinSt line ids (bs) / P&L keys (pl)]
//   fromBooks(fy)              {cy: {key: v}, py: {key: v}, src: {key: words}, info} from FinSt.build (Financial statements)
//   fromUpload(up)             the same from an uploaded sheet, its columns mapped
//   figures(base, edits)       the figures with the edits over them, and the totals worked out
//   checks(f, lastFiled)       [{key, ok, tone, text}]
//   sheetRows(f, meta)         the "figures in MCA order" sheet (CSV, Excel, PDF)
// Amounts in rupees (the form takes rupees).
export const BS_HEADS = [
  ["sec", "EQUITY AND LIABILITIES"],
  ["grp", "Shareholders' funds"],
  ["sc", "Share capital", "EQ", ["sc"]],
  ["rs", "Reserves and surplus", "EQ", ["rs"]],
  ["msw", "Money received against share warrants", "EQ", []],
  ["sapp", "Share application money pending allotment", "EQ", []],
  ["grp", "Non-current liabilities"],
  ["ltb", "Long-term borrowings", "NCL", ["ltb"]],
  ["dtl", "Deferred tax liabilities (net)", "NCL", ["dtl"]],
  ["oltl", "Other long-term liabilities", "NCL", ["oltl"]],
  ["ltp", "Long-term provisions", "NCL", ["ltp"]],
  ["grp", "Current liabilities"],
  ["stb", "Short-term borrowings", "CL", ["stb"]],
  ["tpm", "Trade payables: micro and small enterprises", "CL", ["tpm"]],
  ["tpo", "Trade payables: others", "CL", ["tpo"]],
  ["ocl", "Other current liabilities", "CL", ["ocl"]],
  ["stp", "Short-term provisions", "CL", ["stp"]],
  ["tot", "Total equity and liabilities", "TL"],
  ["sec", "ASSETS"],
  ["grp", "Non-current assets"],
  ["ppe", "Property, plant and equipment (tangible assets)", "NCA", ["ppe"]],
  ["intang", "Intangible assets", "NCA", ["intang"]],
  ["cwip", "Capital work-in-progress", "NCA", ["cwip"]],
  ["iaud", "Intangible assets under development", "NCA", ["iaud"]],
  ["nci", "Non-current investments", "NCA", ["nci"]],
  ["dta", "Deferred tax assets (net)", "NCA", ["dta"]],
  ["ltla", "Long-term loans and advances", "NCA", ["ltla"]],
  ["onca", "Other non-current assets", "NCA", ["onca"]],
  ["grp", "Current assets"],
  ["ci", "Current investments", "CA", ["ci"]],
  ["inv", "Inventories", "CA", ["inv"]],
  ["tr", "Trade receivables", "CA", ["tr"]],
  ["cash", "Cash and cash equivalents", "CA", ["cash"]],
  ["stla", "Short-term loans and advances", "CA", ["stla"]],
  ["oca", "Other current assets", "CA", ["oca"]],
  ["tot", "Total assets", "TA"],
];
export const PL_HEADS = [
  ["rev", "Revenue from operations", "INC", ["rev"]],
  ["oth", "Other income", "INC", ["oth"]],
  ["tot", "Total income", "TI"],
  ["mat", "Cost of materials consumed", "EXP", ["mat"]],
  ["pur", "Purchases of stock-in-trade", "EXP", ["pur"]],
  ["chg", "Changes in inventories of finished goods, work-in-progress and stock-in-trade", "EXP", ["chg"]],
  ["emp", "Employee benefit expense", "EXP", ["emp"]],
  ["fin", "Finance costs", "EXP", ["fin"]],
  ["dep", "Depreciation and amortisation expense", "EXP", ["dep"]],
  ["exp", "Other expenses", "EXP", ["exp"]],
  ["tot", "Total expenses", "TE"],
  ["tot", "Profit before exceptional and extraordinary items and tax", "PBE"],
  ["exc", "Exceptional items", "EXC", ["exc"]],
  ["exo", "Extraordinary items", "EXC", []],
  ["tot", "Profit before tax", "PBT"],
  ["cur", "Current tax", "TAX", ["cur", "prior"]],
  ["def", "Deferred tax", "TAX", ["def"]],
  ["tot", "Profit / (loss) for the period", "PAT"],
];
export const LEAVES = BS_HEADS.concat(PL_HEADS).filter((h) => h[0] !== "sec" && h[0] !== "grp" && h[0] !== "tot");
const R = (v) => Math.round((+v || 0) * 100) / 100;

// how many ledgers make each line, by the codes of the trial balance (FinSt.bsLineOf; the P&L by note)
const PL_NOTE = { "13": "rev", "14": "oth", "40": "mat", "41": "pur", "42": "chg", "15": "emp", "16": "fin", "17": "exp", "43": "exc" };
function counts(FinSt, T) {
  const n = {};
  (T && T.rows || []).forEach((r) => {
    if (!r.code || r.synthetic || (!r.final && !r.py)) return;
    const c = FinSt.CODES[r.code]; if (!c) return;
    let k = c.side === "BS" ? FinSt.bsLineOf(r.code) : PL_NOTE[c.note] || "";
    if (r.code === "8E" || r.code === "34D") k = "dep";
    if (/^22[AB]$/.test(r.code)) k = "cur"; else if (r.code === "22C") k = "def";
    if (k) n[k] = (n[k] || 0) + 1;
  });
  return n;
}

export function fromBooks(fy) {
  const FinSt = globalThis.FinSt;
  if (!FinSt) return { error: "The financial statements' program is not loaded." };
  const d = FinSt.build(String(fy), { unit: 1, dec: 2 });
  if (!d || d.error) return { error: (d && d.error) || "The statements could not be worked out." };
  const cy = {}, py = {}, src = {};
  const lines = {}; Object.values(d.bs.sections).forEach((s) => s.lines.forEach((z) => { lines[z.id] = z; }));
  const n = counts(FinSt, d.tb);
  BS_HEADS.concat(PL_HEADS).forEach(([k, , , ids]) => {
    if (!ids) return;
    if (BS_HEADS.some((h) => h[0] === k && h[3])) { cy[k] = R(ids.reduce((s, i) => s + ((lines[i] || {}).cy || 0), 0)); py[k] = R(ids.reduce((s, i) => s + ((lines[i] || {}).py || 0), 0)); }
    else { cy[k] = R(ids.reduce((s, i) => s + ((d.pl[i] || {}).cy || 0), 0)); py[k] = R(ids.reduce((s, i) => s + ((d.pl[i] || {}).py || 0), 0)); }
    src[k] = !ids.length ? "Not in the books: type it if any" : k === "ppe" || k === "intang" ? "Books · fixed asset schedule (Note " + ((lines[k] || {}).no || "") + ")" : k === "inv" ? "Closing stock" : k === "rs" ? "Books · P&L carried"
      : n[k] ? "Books · " + n[k] + (n[k] === 1 ? " ledger" : " ledgers") : "Books · nil";
  });
  const pyWords = { copy: "the year before in FinCom", typed: "last year typed", opening: "the opening balances", upload: "last year's balance sheet uploaded", none: "none" }[d.tb.pySrc] || d.tb.pySrc;
  // ledgers with a balance and no code: in no head of the form (listed, and Ready held back, until they are coded)
  const unmapped = (d.tb.rows || []).filter((r) => !r.code && !r.synthetic && (Math.abs(+r.final || 0) >= 0.005 || Math.abs(+r.py || 0) >= 0.005)).map((r) => ({ label: r.ledger || "", cy: R(r.final), py: R(r.py) }));
  return { cy, py, src, unmapped, info: { from: d.tb.from, to: d.tb.to, py: pyWords, ledgers: (d.tb.rows || []).filter((r) => !r.synthetic).length, unmapped: (d.checks || []).find((c) => c.key === "unmapped"), eps: d.pl.eps || null } };
}

// an uploaded statement as kept: its lines (label, this year, last year, as numbers: never the file's raw rows), each
// line's head (map: {line index: head key, or "-" for a total or heading not used}), which heads were guessed (guessed:
// {line index: true}, "check the head" until chosen by hand), and the file's own totals (to compare)
export function fromUpload(up) {
  const cy = {}, py = {}, src = {}, unmapped = [], bad = [];
  LEAVES.forEach(([k]) => { cy[k] = 0; py[k] = 0; });
  (up.lines || []).forEach((z, i) => {
    const k = (up.map || {})[i];
    if (isNaN(z.cy) || isNaN(z.py) || z.cy === null || z.py === null) { bad.push(z.label); return; }
    if (!k) { if (Math.abs(z.cy) >= 0.005 || Math.abs(z.py) >= 0.005) unmapped.push({ label: z.label, cy: z.cy, py: z.py, line: i }); return; }
    if (k === "-" || cy[k] === undefined) return;
    cy[k] = R(cy[k] + z.cy); py[k] = R(py[k] + z.py);
    src[k] = (src[k] ? src[k] + ", " : "Upload · ") + String(z.label || "").slice(0, 40);
  });
  LEAVES.forEach(([k]) => { if (!src[k]) src[k] = "Upload · nil"; });
  return { cy, py, src, unmapped, bad, totals: up.totals || [], info: { from: "", to: "", py: "the upload", file: up.file } };
}
// an amount as an auditor's sheet writes it: 1,00,000.00 · (1,000) · -1,000 · 1000- · −1,000 (the Unicode minus) ·
// ₹ / Rs. / Rs / INR before it · 1,000 Cr (a credit: negative) · 1,000 Dr (a debit: positive; Cr / Dr decide the sign
// over brackets or a minus) · "-" or "—" for nil.
// Anything else ("12abc", "1e5") is not an amount: NaN (said as an error, never read as 0)
export function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  let s = String(v == null ? "" : v).replace(/[−‒–]/g, "-").replace(/\s+/g, " ").trim();
  if (!s || /^[-—]$/.test(s)) return 0;
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "").trim();
  let neg = false, side = "";
  const dc = /\s*\b(cr|dr)\.?$/i.exec(s); if (dc) { side = dc[1].toLowerCase(); s = s.slice(0, dc.index).trim(); }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "").trim();
  if (/^\(.*\)$/.test(s)) { neg = !neg; s = s.slice(1, -1).trim(); }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "").trim();
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1).trim(); } else if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1).trim(); }
  s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return NaN;
  const n = parseFloat(s);
  if (side) return side === "cr" ? -n : n;
  return neg ? -n : n;
}
// a cell holds an amount (text is never one)
export const isNum = (c) => c !== "" && c != null && /\d/.test(String(c)) && !isNaN(num(c));

// the head a line of an uploaded statement is read by (a guess: the page marks it "check the head" until chosen by hand).
// The order matters: the narrower words first ("other than micro" before "micro", intangible before tangible, purchases
// of stock-in-trade before stock, interest income before interest, cash credit / overdraft / bank loans before cash and
// bank, bank charges before bank, a provision for income tax before income tax)
const SYN = [
  ["-", /^total\b(?!\s+outstanding)|\btotal$|^profit\b|^loss\b|^\(?[a-z]?\)?\s*$|^note\b/],
  ["tpo", /other than (micro|msme)/],
  ["tpm", /micro (and|&) small|micro enterprises|\bmsme\b|micro and small/],
  ["stp", /provision for (income[- ]?)?tax|provision for taxation|short[- ]term prov/],
  ["stb", /current maturit|cash credit|overdraft|loans? repayable on demand|\bbank loans?\b|short[- ]term borrow|working capital loan/],
  ["exp", /bank charges|other expense/],
  ["oth", /other income|interest income|interest received|dividend income|rent received/],
  ["pur", /purchases? of stock|purchase/],
  ["chg", /change.*inventor/],
  ["dta", /deferred tax asset/], ["dtl", /deferred tax liab/],
  ["iaud", /under development/], ["cwip", /work[- ]in[- ]progress|\bcwip\b/],
  ["nci", /non[- ]current invest/], ["ci", /current invest/],
  ["oltl", /other long[- ]term liab/], ["onca", /other non[- ]current asset/], ["ocl", /other current liab/], ["oca", /other current asset/],
  ["ltla", /long[- ]term loans? and adv/], ["stla", /short[- ]term loans? and adv/],
  ["ltb", /long[- ]term borrow|term loan/], ["ltp", /long[- ]term prov/],
  ["sapp", /application money/], ["msw", /share warrant/], ["sc", /share capital/], ["rs", /reserves|surplus|retained/],
  ["intang", /intangible/], ["ppe", /property|plant|\btangible|fixed asset/],
  ["inv", /inventor|stock/], ["tr", /trade receiv|debtor/], ["cash", /cash|bank/], ["tpo", /trade payable|sundry creditor|creditors/],
  ["rev", /revenue|sales|turnover/], ["mat", /material/], ["emp", /employee|salar|staff/], ["fin", /finance cost|interest/],
  ["dep", /depreciation|amorti/], ["exc", /exceptional/], ["exo", /extraordinary/], ["cur", /current tax|income tax/], ["def", /deferred tax/],
];
export function guessHead(label) {
  // "(A)", "(b)", "a.", "i)" before the words are not part of them (Schedule III's own MSME lines are lettered)
  const l = String(label || "").toLowerCase().replace(/^\s*(\(?[a-z]{1,3}\)|[a-z]{1,3}\.)\s*/, "").replace(/\s+/g, " ").trim();
  if (!l) return "";
  const hit = SYN.find(([, re]) => re.test(l));
  return hit ? hit[0] : "";
}

// the file's own total lines, compared with the totals worked out from the lines mapped (equal to 0.5 paise)
export function totalChecks(f, totals) {
  const out = [];
  (totals || []).forEach((t) => {
    const l = String(t.label || "").toLowerCase(), want = /equity and liab|liabilities/.test(l) ? ["TL"] : /assets/.test(l) ? ["TA"] : /income|revenue/.test(l) ? ["TI"] : /expens/.test(l) ? ["TE"] : ["TL", "TA", "TI", "TE"];
    const ok = ["cy", "py"].every((c) => isNaN(t[c]) || want.some((w) => Math.abs((+t[c] || 0) - f.tot[c][w]) < 0.005));
    out.push({ label: t.label, ok, cy: t.cy, py: t.py });
  });
  return out;
}
export const udinOk = (u) => /^\d{8}[A-Z0-9]{10}$/i.test(String(u || "").trim());
const TOL = 0.005;   // half a paisa

// the figures shown: the source's, with an edit (by hand, with its reason) over any of them; totals worked out
export function figures(base, edits) {
  const cy = Object.assign({}, base.cy), py = Object.assign({}, base.py), src = Object.assign({}, base.src), ed = edits || {};
  Object.entries(ed).forEach(([k, e]) => { if (e.cy != null && e.cy !== "") cy[k] = R(e.cy); if (e.py != null && e.py !== "") py[k] = R(e.py); src[k] = (src[k] || "") + " · edited" + (e.why ? ": " + e.why : ""); });
  const T = (col) => {
    const v = col === "cy" ? cy : py, g = (keys) => R(keys.reduce((s, k) => s + (+v[k] || 0), 0));
    const TL = g(["sc", "rs", "msw", "sapp", "ltb", "dtl", "oltl", "ltp", "stb", "tpm", "tpo", "ocl", "stp"]), TA = g(["ppe", "intang", "cwip", "iaud", "nci", "dta", "ltla", "onca", "ci", "inv", "tr", "cash", "stla", "oca"]);
    const TI = g(["rev", "oth"]), TE = g(["mat", "pur", "chg", "emp", "fin", "dep", "exp"]), PBE = R(TI - TE), PBT = R(PBE - g(["exc", "exo"])), PAT = R(PBT - g(["cur", "def"]));
    return { TL, TA, TI, TE, PBE, PBT, PAT };
  };
  return { cy, py, src, tot: { cy: T("cy"), py: T("py") }, edited: Object.keys(ed) };
}

// the checks before filing (the design's "Checks before filing")
export function checks(f, o) {
  o = o || {};
  const out = [], rs = (x) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(x);
  const d1 = R(f.tot.cy.TL - f.tot.cy.TA), d0 = R(f.tot.py.TL - f.tot.py.TA);
  out.push({ key: "bs", ok: Math.abs(d1) < TOL && Math.abs(d0) < TOL, text: Math.abs(d1) < TOL && Math.abs(d0) < TOL ? "Balance sheet tallies: assets = equity + liabilities" : "Balance sheet does not tally: equity and liabilities less assets " + rs(d1) + (Math.abs(d0) >= TOL ? " (previous year " + rs(d0) + ")" : "") });
  const move = R((+f.cy.rs || 0) - (+f.py.rs || 0)), pat = f.tot.cy.PAT, dm = R(move - pat);
  out.push({ key: "reserves", ok: Math.abs(dm) < TOL, warn: true, text: Math.abs(dm) < TOL ? "Profit for the year matches the movement in reserves" : "Profit for the year " + rs(pat) + " is not the movement in reserves " + rs(move) + " (difference " + rs(dm) + ": dividends, transfers or an adjustment to explain)" });
  if (o.lastFiled) {
    const bad = LEAVES.filter(([k]) => Math.abs((+f.py[k] || 0) - (+o.lastFiled[k] || 0)) >= TOL).map(([, l]) => l);
    out.push({ key: "py", ok: !bad.length, text: !bad.length ? "Previous year equals the AOC-4 filed for FY " + o.lastFy : "Previous year differs from the AOC-4 filed for FY " + o.lastFy + ": " + bad.slice(0, 3).join(", ") + (bad.length > 3 ? " and " + (bad.length - 3) + " more" : "") });
  } else out.push({ key: "py", ok: null, text: "Previous year: no AOC-4 of FY " + o.lastFy + " kept in FinCom to compare with (it is kept once that year's AOC-4 is marked filed here)" });
  if (+f.cy.tpm === 0 && +f.cy.tpo > 0) out.push({ key: "msme", ok: false, warn: true, text: "Trade payables: split the dues to micro and small enterprises (Schedule III; MSMED Act s.22)" });
  if (!o.udin) out.push({ key: "udin", ok: false, warn: true, text: "Auditor's UDIN not entered yet" });
  else if (!udinOk(o.udin)) out.push({ key: "udin", ok: false, text: "The UDIN is 18 characters: 8 digits (year and membership number), then 10 letters or digits (" + String(o.udin).trim().length + " entered)" });
  else out.push({ key: "udin", ok: true, text: "Auditor's UDIN entered" });
  // in no head: ledgers without a code (Books) or lines of the upload not mapped
  const un = o.unmapped || [];
  if (un.length) out.push({ key: "unmapped", ok: false, text: "Not in any head: " + un.length + (un.length === 1 ? " line" : " lines") + ", " + rs(un.reduce((x, z) => x + Math.abs(z.cy || 0), 0)) + " this year" });
  (o.totals || []).forEach((t, i) => out.push({ key: "total" + i, ok: t.ok, text: t.ok ? "The file's " + t.label + " equals the total worked out" : "The file's " + t.label + " (" + rs(t.cy) + ") differs from the total worked out" }));
  if (o.bad && o.bad.length) out.push({ key: "bad", ok: false, text: "Not an amount in the file: " + o.bad.slice(0, 3).join(", ") + (o.bad.length > 3 ? " and " + (o.bad.length - 3) + " more" : "") });
  return out;
}

export const ATTACHMENTS = [
  ["fs", "Financial statements (signed), with the notes", "Made from Books"],
  ["board", "Board's report (s.134), with its annexures", "Draft it"],
  ["audit", "Independent auditor's report (s.143)", "Upload"],
  ["caro", "CARO 2020 report, where it applies", "Upload"],
  ["notice", "Notice of the AGM", "From Documents"],
  ["aoc1", "AOC-1 (subsidiaries / associates), where there are any", "If any"],
  ["aoc2", "AOC-2 (related party contracts, s.188), where there are any", "If any"],
  ["csr", "CSR annexure (s.135), where it applies", "If any"],
];

// the sheet: in the form's order, both years, the source
export function sheetRows(f, meta) {
  const rows = [["Form AOC-4: figures in the order of the form"], [meta.company + (meta.cin ? " · CIN " + meta.cin : "")], ["Financial year " + meta.fy + " · amounts in rupees · prepared in FinCom from " + meta.source], [],
    ["Item (Schedule III)", "Current year " + meta.cyDate, "Previous year " + meta.pyDate, "Source"]];
  const add = (heads) => heads.forEach(([k, label, sec]) => {
    if (k === "sec") rows.push([label]);
    else if (k === "grp") rows.push(["  " + label]);
    else if (k === "tot") rows.push([label, f.tot.cy[sec], f.tot.py[sec], ""]);
    else rows.push(["    " + label, +f.cy[k] || 0, +f.py[k] || 0, f.src[k] || ""]);
  });
  rows.push(["BALANCE SHEET"]); add(BS_HEADS); rows.push([]); rows.push(["STATEMENT OF PROFIT AND LOSS"]); add(PL_HEADS);
  rows.push([]); rows.push(["FinCom does not file on the MCA portal. Type these figures into AOC-4 there, attach the PDFs, file with DSC and keep the SRN in FinCom (e-Forms)."]);
  return rows;
}
// a text cell that a spreadsheet would read as a formula (= + - @, a tab or a return first) is written with a ' before it
export function csvOf(rows) {
  return rows.map((r) => r.map((c) => { let s = typeof c === "number" ? String(c) : String(c == null ? "" : c); if (typeof c !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n") + "\r\n";
}
