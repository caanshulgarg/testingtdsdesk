// "My MIS" (ROUND 105, B1): the report definition a person builds (or describes by voice or text) - its schema, its
// normalising check and the names it refers to. Plain JavaScript with no imports and no DOM, used as it is by:
//   - the app's engine (app/src/lib/misCustom.js), which works the figures out from the client's books;
//   - Ask FinCom's build_mis tool (server/assistant/mis.ts, under Deno), which checks a definition the model wrote against
//     this schema and the client's real groups and ledgers before the builder opens it;
//   - later, the scheduled run in the cloud (B6), with the same engine.
// A definition holds no figures: what to show, by what, for which period and how (units, decimals, comparisons). The only
// amounts in it are a budget the person typed (budget), which a definition from the AI never carries (stripAmounts).
//
// def = {v: 1, id, name, period: {kind, fy?, from?, to?}, units: {unit, dec}, filters: {party: [], ledger: [], vtype: []},
//        budget: {"<row key>": {"YYYYMM": rupees}}, blocks: [block]}
// block = {id, type: table|chart|kpi, title, rows: {by, items, under, top, others, side}, measure,
//          cols: {by: month|quarter|year, compare: none|ly|budget, pct: [change, share]}, chart: {type}}
export const MIS_DEF_V = 1;
export const BLOCK_TYPES = ["table", "chart", "kpi"];
// what the rows are: MIS heads (and the profit lines), Tally groups, ledgers, Financial-statement codes (FinSt), customers
// by sales, suppliers by purchases, the GST working's lines, receivables / payables by age, ratios
export const ROW_BY = ["head", "group", "ledger", "code", "customer", "supplier", "gst", "ageing", "ratio"];
export const MEASURES = ["move", "close", "dr", "cr", "count", "fs", "sales", "purchases", "gst", "ageing", "ratio"];
export const DEFAULT_MEASURE = { head: "move", group: "move", ledger: "move", code: "fs", customer: "sales", supplier: "purchases", gst: "gst", ageing: "ageing", ratio: "ratio" };
// the measures each kind of row can take
export const MEASURES_FOR = { head: ["move"], group: ["move", "close", "dr", "cr", "count"], ledger: ["move", "close", "dr", "cr", "count"], code: ["fs"],
  customer: ["sales", "count"], supplier: ["purchases", "count"], gst: ["gst"], ageing: ["ageing"], ratio: ["ratio"] };
export const MEASURE_LABEL = { move: "Movement", close: "Closing balance", dr: "Debits", cr: "Credits", count: "Number of entries", fs: "As in the financial statements",
  sales: "Sales", purchases: "Purchases", gst: "GST", ageing: "By age", ratio: "Ratio" };
export const COL_BY = ["month", "quarter", "year"];
export const COMPARE = ["none", "ly", "budget"];
export const PCT = ["change", "share"];
export const CHARTS = ["bar", "line", "pie", "donut", "stacked"];
export const UNITS = { 1: "Rupees", 1000: "Rupees thousand", 100000: "Rupees lakhs", 10000000: "Rupees crores" };
export const UNIT_SHORT = { 1: "₹", 1000: "₹ '000", 100000: "₹ lakhs", 10000000: "₹ crores" };
export const PERIODS = ["fy", "ytd", "range", "lastMonth", "lastQuarter", "mtd", "qtd"];
export const VTYPES = ["Sales", "Purchase", "Receipt", "Payment", "Journal", "Contra", "Credit Note", "Debit Note"];
// MIS.HEADS (src/js/07-mis.js) and the profit lines of MIS.pl, in MIS's own words and order
export const HEADS = [["rev", "Revenue from operations", 1], ["oth", "Other income", 1], ["pur", "Purchases", -1], ["dir", "Direct expenses", -1], ["emp", "Employee costs", -1],
  ["exp", "Other expenses", -1], ["fin", "Finance costs", -1], ["dep", "Depreciation", -1], ["tax", "Tax", -1]];
export const PL_LINES = [["income", "Total income"], ["gross", "Gross profit"], ["ebitda", "Profit before interest and depreciation"], ["pbt", "Profit before tax"], ["pat", "Profit after tax"]];
export const HEAD_KEYS = HEADS.map((h) => h[0]).concat(PL_LINES.map((x) => x[0]));
export const headLabel = (k) => (HEADS.find((h) => h[0] === k) || PL_LINES.find((x) => x[0] === k) || [k, k])[1];
// the ratios of MIS.ratios (src/js/07-mis.js), same words: [key, label, unit]
export const RATIOS = [["gross", "Gross margin", "%"], ["op", "Operating margin (before interest and depreciation)", "%"], ["net", "Net margin (before tax)", "%"],
  ["emp", "Employee costs to revenue", "%"], ["exp", "Other expenses to revenue", "%"], ["dso", "Days of sales owed to you", "days"], ["dpo", "Days of purchases you owe", "days"],
  ["current", "Current ratio", "times"], ["quick", "Quick ratio", "times"], ["debtEq", "Debt to equity", "times"], ["icover", "Interest cover", "times"], ["wc", "Working capital", "₹"]];
export const GST_LINES = [["out", "Output tax"], ["itc", "Less: credit"], ["rcm", "Add: reverse charge"], ["carry", "Credit carried"], ["due", "Worked out to pay"], ["pay", "Paid from the bank"]];
export const AGE_BUCKETS = ["0–30", "31–60", "61–90", "91–180", "over 180"];

const LIM = { blocks: 24, items: 60, name: 120, title: 120, top: 50 };
const str = (v, n = LIM.name) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const list = (v, n = LIM.items) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map((x) => str(x)).filter(Boolean).slice(0, n);
const ymd = (v) => { const s = String(v || "").replace(/-/g, "").slice(0, 8); return /^\d{8}$/.test(s) ? s : ""; };
let seq = 0;
export const newId = (p = "b") => p + Date.now().toString(36) + (++seq).toString(36) + Math.floor(Math.random() * 1296).toString(36);

// a definition as the engine reads it: every field known, every value one the engine takes; problems say what was
// changed (a wrong value is replaced by the default, never kept)
export function normalizeDef(raw, o = {}) {
  const problems = [], r = raw && typeof raw === "object" ? raw : {};
  if (!raw || typeof raw !== "object") problems.push("the definition was not an object; an empty report was made");
  const p = r.period && typeof r.period === "object" ? r.period : {};
  const period = { kind: oneOf(p.kind, PERIODS, "fy") };
  if (p.kind && !PERIODS.includes(p.kind)) problems.push("period " + str(p.kind) + " is not known: the financial year is used");
  if (period.kind === "fy") { const fy = String(p.fy || "").slice(0, 4); if (/^\d{4}$/.test(fy)) period.fy = fy; }
  if (period.kind === "range") { period.from = ymd(p.from); period.to = ymd(p.to); if (!period.from || !period.to || period.from > period.to) { problems.push("the period's dates were not valid: the financial year is used"); period.kind = "fy"; delete period.from; delete period.to; } }
  const u = r.units && typeof r.units === "object" ? r.units : {};
  const units = { unit: UNITS[u.unit] ? Number(u.unit) : 1, dec: Number(u.dec) === 0 ? 0 : 2 };
  if (u.unit != null && !UNITS[u.unit]) problems.push("unit " + str(u.unit) + " is not one of rupees, thousands, lakhs or crores: rupees are used");
  const f = r.filters && typeof r.filters === "object" ? r.filters : {};
  const filters = { party: list(f.party), ledger: list(f.ledger), vtype: list(f.vtype).map((t) => VTYPES.find((x) => x.toLowerCase() === t.toLowerCase()) || t) };
  filters.vtype.filter((t) => !VTYPES.includes(t)).forEach((t) => problems.push("voucher type " + t + " is not one Tally has: left out"));
  filters.vtype = filters.vtype.filter((t) => VTYPES.includes(t));
  const blocks = (Array.isArray(r.blocks) ? r.blocks : []).slice(0, LIM.blocks).map((b, i) => normBlock(b, i, problems));
  if (Array.isArray(r.blocks) && r.blocks.length > LIM.blocks) problems.push("only the first " + LIM.blocks + " blocks are kept");
  const def = { v: MIS_DEF_V, id: str(r.id, 60) || newId("m"), name: str(r.name) || "My MIS", period, units, filters, budget: {}, blocks };
  if (!o.noAmounts) def.budget = normBudget(r.budget);
  if (r.shared != null) def.shared = !!r.shared;
  return { def, problems };
}
function normBlock(b, i, problems) {
  b = b && typeof b === "object" ? b : {};
  const where = "block " + (i + 1);
  const type = oneOf(b.type, BLOCK_TYPES, "table");
  if (b.type && !BLOCK_TYPES.includes(b.type)) problems.push(where + ": " + str(b.type) + " is not a table, chart or KPI: a table is used");
  const rw = b.rows && typeof b.rows === "object" ? b.rows : {};
  const by = oneOf(rw.by, ROW_BY, "head");
  if (rw.by && !ROW_BY.includes(rw.by)) problems.push(where + ": rows by " + str(rw.by) + " is not known: MIS heads are used");
  let items = list(rw.items);
  if (by === "head") { const bad = items.filter((k) => !HEAD_KEYS.includes(k)); bad.forEach((k) => problems.push(where + ": " + k + " is not an MIS head")); items = items.filter((k) => HEAD_KEYS.includes(k)); }
  if (by === "ratio") { const keys = RATIOS.map((x) => x[0]); items.filter((k) => !keys.includes(k)).forEach((k) => problems.push(where + ": " + k + " is not a ratio FinCom works out")); items = items.filter((k) => keys.includes(k)); }
  if (by === "gst") { const keys = GST_LINES.map((x) => x[0]); items = items.filter((k) => keys.includes(k)); }
  if (by === "code") items = items.map((k) => k.toUpperCase()).filter((k) => /^\d{1,2}[A-Z]$/.test(k));
  const top = Math.max(0, Math.min(LIM.top, Math.floor(Number(rw.top) || 0)));
  const rows = { by, items, under: list(rw.under), top, others: rw.others == null ? top > 0 : !!rw.others };
  if (by === "ageing" || by === "customer" || by === "supplier") rows.side = by === "supplier" ? "p" : by === "customer" ? "r" : rw.side === "p" ? "p" : "r";
  let measure = oneOf(b.measure, MEASURES, DEFAULT_MEASURE[by]);
  if (!MEASURES_FOR[by].includes(measure)) { if (b.measure) problems.push(where + ": " + MEASURE_LABEL[measure] + " does not apply to these rows: " + MEASURE_LABEL[DEFAULT_MEASURE[by]] + " is used"); measure = DEFAULT_MEASURE[by]; }
  const c = b.cols && typeof b.cols === "object" ? b.cols : {};
  const cols = { by: oneOf(c.by, COL_BY, type === "kpi" ? "year" : "month"), compare: oneOf(c.compare, COMPARE, "none"), pct: list(c.pct).filter((x) => PCT.includes(x)) };
  if (by === "ageing") { cols.by = "year"; cols.compare = "none"; }
  const ch = b.chart && typeof b.chart === "object" ? b.chart : {};
  const chart = { type: oneOf(ch.type, CHARTS, by === "ageing" ? "stacked" : cols.by === "year" ? "bar" : "line") };
  return { id: str(b.id, 60) || newId(), type, title: str(b.title, LIM.title) || defaultTitle(by, items, measure), rows, measure, cols, chart };
}
function defaultTitle(by, items, measure) {
  if (by === "head") return items.length === 1 ? headLabel(items[0]) : "Profit and loss";
  if (by === "ratio") return items.length === 1 ? (RATIOS.find((x) => x[0] === items[0]) || [, "Ratios"])[1] : "Ratios";
  return { group: "By group", ledger: "By ledger", code: "Financial statements", customer: "Sales by customer", supplier: "Purchases by supplier", gst: "GST summary", ageing: "By age" }[by] + (measure === "close" ? " (closing balances)" : "");
}
function normBudget(b) {
  const out = {};
  if (!b || typeof b !== "object") return out;
  Object.entries(b).slice(0, 200).forEach(([k, m]) => {
    if (!m || typeof m !== "object") return;
    const x = {};
    Object.entries(m).forEach(([ym, v]) => { const n = Number(v); if (/^\d{6}$/.test(ym) && isFinite(n) && n !== 0) x[ym] = Math.round(n * 100) / 100; });
    if (Object.keys(x).length) out[str(k, 200)] = x;
  });
  return out;
}
// a definition the AI wrote carries no amount: no budget, nothing that looks like a figure in a title or name
export function stripAmounts(def) {
  const d = JSON.parse(JSON.stringify(def));
  d.budget = {};
  const clean = (s) => String(s || "").replace(/(₹|rs\.?|inr)\s*[\d,]+(\.\d+)?/gi, "").replace(/\b\d{1,3}(,\d{2,3})+(\.\d+)?\b/g, "").replace(/\s+/g, " ").trim();
  d.name = clean(d.name) || "My MIS";
  d.blocks.forEach((b) => { b.title = clean(b.title) || b.title.replace(/[\d,]{4,}/g, "").trim() || "Block"; });
  return d;
}
// every name a definition refers to, with where it is: ledgers, groups and parties (checked against the client's books)
export function namesIn(def) {
  const out = [];
  def.blocks.forEach((b, i) => {
    const kind = b.rows.by === "group" ? "group" : b.rows.by === "ledger" ? "ledger" : (b.rows.by === "customer" || b.rows.by === "supplier") ? "party" : "";
    if (kind) b.rows.items.forEach((n, j) => out.push({ kind, name: n, at: ["blocks", i, "rows", "items", j] }));
    if (["ledger", "customer", "supplier"].includes(b.rows.by)) b.rows.under.forEach((n, j) => out.push({ kind: "group", name: n, at: ["blocks", i, "rows", "under", j] }));
  });
  def.filters.party.forEach((n, j) => out.push({ kind: "party", name: n, at: ["filters", "party", j] }));
  def.filters.ledger.forEach((n, j) => out.push({ kind: "ledger", name: n, at: ["filters", "ledger", j] }));
  return out;
}
// the names checked: look(kind, name) -> {name} (the client's own spelling) or {choices: [closest names]}. Known names
// take the books' spelling; unknown ones are listed for the person to correct (they stay in the definition, marked)
export async function checkNames(def, look) {
  const d = JSON.parse(JSON.stringify(def)), unknown = [];
  for (const n of namesIn(d)) {
    let r = null;
    try { r = await look(n.kind, n.name); } catch (e) { r = null; }
    if (r && r.name) { setAt(d, n.at, r.name); continue; }
    unknown.push({ kind: n.kind, name: n.name, at: n.at, where: whereOf(d, n.at), choices: ((r && r.choices) || []).slice(0, 5) });
  }
  return { def: d, unknown };
}
export function setAt(o, at, v) { let x = o; for (let i = 0; i < at.length - 1; i++) x = x[at[i]]; x[at[at.length - 1]] = v; return o; }
export function whereOf(def, at) {
  if (at[0] === "filters") return "filter: " + (at[1] === "party" ? "party" : "ledger");
  const b = def.blocks[at[1]]; return "“" + (b ? b.title : "block " + (at[1] + 1)) + "” " + (at[3] === "under" ? "(under group)" : "(rows)");
}
// a row's key, for the budget the person types against it
export const rowKey = (by, name) => by + ":" + name;
// the parameters of the build_mis tool (Ask FinCom): the definition as a JSON string (a schema with every field closed
// would pass the strict-tool limits only with difficulty), described in plain words for the model
export const TOOL_GUIDE = "A JSON object: {\"name\": \"<the report's name>\", \"period\": {\"kind\": \"fy\" | \"ytd\" | \"lastMonth\" | \"lastQuarter\" | \"mtd\" | \"qtd\" | \"range\", \"fy\": \"2025\" (the year's start, for fy), \"from\": \"YYYY-MM-DD\", \"to\": \"YYYY-MM-DD\" (for range)}, " +
  "\"units\": {\"unit\": 1 | 1000 | 100000 | 10000000, \"dec\": 0 | 2}, \"filters\": {\"party\": [names], \"ledger\": [names], \"vtype\": [\"Sales\", \"Purchase\", \"Receipt\", \"Payment\", \"Journal\", \"Contra\", \"Credit Note\", \"Debit Note\"]}, " +
  "\"blocks\": [{\"type\": \"table\" | \"chart\" | \"kpi\", \"title\": \"<words>\", \"rows\": {\"by\": \"head\" | \"group\" | \"ledger\" | \"code\" | \"customer\" | \"supplier\" | \"gst\" | \"ageing\" | \"ratio\", \"items\": [names or keys], \"under\": [group names, for ledger/customer/supplier rows], \"top\": <number of rows, 0 for all>, \"others\": true | false, \"side\": \"r\" | \"p\" (ageing: receivables or payables)}, " +
  "\"measure\": \"move\" | \"close\" | \"dr\" | \"cr\" | \"count\" | \"fs\" | \"sales\" | \"purchases\" | \"gst\" | \"ageing\" | \"ratio\", \"cols\": {\"by\": \"month\" | \"quarter\" | \"year\", \"compare\": \"none\" | \"ly\" | \"budget\", \"pct\": [\"change\", \"share\"]}, \"chart\": {\"type\": \"bar\" | \"line\" | \"pie\" | \"donut\" | \"stacked\"}}]}. " +
  "Head keys: " + HEADS.map((h) => h[0] + " (" + h[1] + ")").join(", ") + ", " + PL_LINES.map((x) => x[0] + " (" + x[1] + ")").join(", ") + ". Ratio keys: " + RATIOS.map((x) => x[0] + " (" + x[1] + ")").join(", ") + ". GST keys: " + GST_LINES.map((x) => x[0]).join(", ") + ". " +
  "Groups and ledgers by their names in the client's Tally (find_ledgers); never a figure, an amount or a budget.";
