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
  return { cy, py, src, info: { from: d.tb.from, to: d.tb.to, py: pyWords, ledgers: (d.tb.rows || []).filter((r) => !r.synthetic).length, unmapped: (d.checks || []).find((c) => c.key === "unmapped"), eps: d.pl.eps || null } };
}

// an uploaded sheet: rows [[label, cy, py], ...] with each row's head chosen (map: {row index: head key})
export function fromUpload(up) {
  const cy = {}, py = {}, src = {};
  LEAVES.forEach(([k]) => { cy[k] = 0; py[k] = 0; });
  Object.entries(up.map || {}).forEach(([i, k]) => {
    const r = up.rows[+i]; if (!r || !k || cy[k] === undefined) return;
    cy[k] = R(cy[k] + num(r[up.cols.cy])); py[k] = R(py[k] + num(r[up.cols.py]));
    src[k] = (src[k] ? src[k] + ", " : "Upload · ") + String(r[up.cols.label] || "").slice(0, 40);
  });
  LEAVES.forEach(([k]) => { if (!src[k]) src[k] = "Upload · nil"; });
  return { cy, py, src, info: { from: "", to: "", py: "the upload", file: up.file } };
}
export function num(v) {
  if (typeof v === "number") return v;
  let s = String(v == null ? "" : v).trim(); if (!s || s === "-") return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s); s = s.replace(/[(),₹\s]|Rs\.?/gi, "").replace(/^-/, "");
  const n = parseFloat(s); return isFinite(n) ? (neg ? -n : n) : 0;
}

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
  out.push({ key: "bs", ok: Math.abs(d1) < 1 && Math.abs(d0) < 1, text: Math.abs(d1) < 1 && Math.abs(d0) < 1 ? "Balance sheet tallies: assets = equity + liabilities" : "Balance sheet does not tally: equity and liabilities less assets " + rs(d1) + (Math.abs(d0) >= 1 ? " (previous year " + rs(d0) + ")" : "") });
  const move = R((+f.cy.rs || 0) - (+f.py.rs || 0)), pat = f.tot.cy.PAT, dm = R(move - pat);
  out.push({ key: "reserves", ok: Math.abs(dm) < 1, warn: true, text: Math.abs(dm) < 1 ? "Profit for the year matches the movement in reserves" : "Profit for the year " + rs(pat) + " is not the movement in reserves " + rs(move) + " (difference " + rs(dm) + ": dividends, transfers or an adjustment to explain)" });
  if (o.lastFiled) {
    const bad = LEAVES.filter(([k]) => Math.abs((+f.py[k] || 0) - (+o.lastFiled[k] || 0)) >= 1).map(([, l]) => l);
    out.push({ key: "py", ok: !bad.length, text: !bad.length ? "Previous year equals the AOC-4 filed for FY " + o.lastFy : "Previous year differs from the AOC-4 filed for FY " + o.lastFy + ": " + bad.slice(0, 3).join(", ") + (bad.length > 3 ? " and " + (bad.length - 3) + " more" : "") });
  } else out.push({ key: "py", ok: null, text: "Previous year: no AOC-4 of FY " + o.lastFy + " kept in FinCom to compare with (it is kept once that year's AOC-4 is marked filed here)" });
  if (+f.cy.tpm === 0 && +f.cy.tpo > 0) out.push({ key: "msme", ok: false, warn: true, text: "Trade payables: split the dues to micro and small enterprises (Schedule III; MSMED Act s.22)" });
  if (!o.udin) out.push({ key: "udin", ok: false, warn: true, text: "Auditor's UDIN not entered yet" });
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
export function csvOf(rows) {
  return rows.map((r) => r.map((c) => { const s = typeof c === "number" ? String(c) : String(c == null ? "" : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n") + "\r\n";
}
