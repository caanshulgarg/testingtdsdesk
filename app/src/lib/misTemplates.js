// "My MIS" (ROUND 105, B3): the ready templates a person starts from. Each is a report definition (server/_shared/misdef.js)
// with no figure in it; the engine (misCustom.js) works the figures out. Pure data, no DOM.
const T = (type, title, rows, cols, extra) => Object.assign({ type, title, rows, cols: Object.assign({ by: "month", compare: "none", pct: [] }, cols || {}) }, extra || {});
const BANKS = ["Bank Accounts", "Bank OD A/c", "Bank OCC A/c", "Cash-in-Hand"];
const EXPENSES = ["Indirect Expenses", "Direct Expenses"];
export const TEMPLATES = [
  { key: "pl", name: "Monthly P&L", about: "The profit and loss by MIS head, month by month, with the profit lines.",
    def: { name: "Monthly P&L", period: { kind: "ytd" }, units: { unit: 1, dec: 0 }, blocks: [
      T("table", "Profit and loss, month by month", { by: "head" }, { by: "month" }),
      T("chart", "Revenue and profit before tax", { by: "head", items: ["rev", "pbt"] }, { by: "month" }, { chart: { type: "line" } }),
      T("kpi", "Profit before tax", { by: "head", items: ["pbt"] }, { by: "year", compare: "ly", pct: ["change"] }),
    ] } },
  { key: "sales", name: "Sales trend by customer (top 10)", about: "The ten largest customers by month, the rest as Others.",
    def: { name: "Sales trend by customer", period: { kind: "ytd" }, units: { unit: 100000, dec: 2 }, blocks: [
      T("table", "Sales by customer, top 10", { by: "customer", top: 10, others: true }, { by: "month", pct: ["share"] }),
      T("chart", "Top 5 customers by month", { by: "customer", top: 5, others: true }, { by: "month" }, { chart: { type: "stacked" } }),
    ] } },
  { key: "exp", name: "Expense split", about: "Where the money went: the largest expense ledgers and their share.",
    def: { name: "Expense split", period: { kind: "ytd" }, units: { unit: 1000, dec: 0 }, blocks: [
      T("chart", "Expenses by ledger", { by: "ledger", under: EXPENSES, top: 6, others: true }, { by: "year" }, { chart: { type: "donut" } }),
      T("table", "Expenses by ledger, top 10", { by: "ledger", under: EXPENSES, top: 10, others: true }, { by: "year", compare: "ly", pct: ["change", "share"] }),
    ] } },
  { key: "cash", name: "Cash & bank", about: "Each bank and cash ledger's balance at each month's end.",
    def: { name: "Cash and bank", period: { kind: "ytd" }, units: { unit: 1, dec: 2 }, blocks: [
      T("kpi", "Cash and bank at the end", { by: "ledger", under: BANKS }, { by: "year" }, { measure: "close" }),
      T("table", "Balances at each month's end", { by: "ledger", under: BANKS }, { by: "month" }, { measure: "close" }),
      T("chart", "Cash and bank by month", { by: "ledger", under: BANKS, top: 4, others: true }, { by: "month" }, { measure: "close", chart: { type: "line" } }),
    ] } },
  { key: "ageing", name: "Receivables/payables ageing", about: "What customers owe and what you owe, by age.",
    def: { name: "Receivables and payables by age", period: { kind: "ytd" }, units: { unit: 1, dec: 0 }, blocks: [
      T("chart", "Owed to you, by age", { by: "ageing", side: "r" }, {}, { chart: { type: "stacked" } }),
      T("table", "Owed to you", { by: "ageing", side: "r", top: 10, others: true }),
      T("table", "You owe", { by: "ageing", side: "p", top: 10, others: true }),
    ] } },
  { key: "gst", name: "GST summary", about: "GST by month: output tax, credit, reverse charge, to pay and paid.",
    def: { name: "GST summary", period: { kind: "ytd" }, units: { unit: 1, dec: 0 }, blocks: [
      T("table", "GST by month", { by: "gst" }, { by: "month" }),
      T("chart", "Worked out to pay and paid", { by: "gst", items: ["due", "pay"] }, { by: "month" }, { chart: { type: "bar" } }),
    ] } },
  { key: "director", name: "Director's one-pager", about: "The few figures a director asks for, on one page.",
    def: { name: "Director's one-pager", period: { kind: "ytd" }, units: { unit: 100000, dec: 2 }, blocks: [
      T("kpi", "Revenue", { by: "head", items: ["rev"] }, { by: "year", compare: "ly", pct: ["change"] }),
      T("kpi", "Profit before tax", { by: "head", items: ["pbt"] }, { by: "year", compare: "ly", pct: ["change"] }),
      T("kpi", "Gross margin", { by: "ratio", items: ["gross"] }, { by: "year" }),
      T("kpi", "Cash and bank", { by: "ledger", under: BANKS }, { by: "year" }, { measure: "close" }),
      T("chart", "Revenue and profit, month by month", { by: "head", items: ["rev", "pbt"] }, { by: "month" }, { chart: { type: "bar" } }),
      T("table", "Top 5 customers", { by: "customer", top: 5, others: true }, { by: "year", pct: ["share"] }),
      T("table", "Ratios", { by: "ratio", items: ["gross", "net", "current", "dso", "dpo"] }, { by: "year" }),
    ] } },
];
export const templateOf = (key) => TEMPLATES.find((t) => t.key === key) || null;
