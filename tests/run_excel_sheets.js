// node run_excel_sheets.js - FinCom's SheetJS downloads (review of 22-Nov-2026, track mis-audit), with the site's own SheetJS
// (assets/xlsx.js):
//   1. FC.excel with two tables of the same title (the Assistant's "Excel of all tables", two look-ups of one ledger, or
//      titles alike in their first 31 characters): the file is made, each sheet named apart;
//   2. a date shown as text (dd-Mon-yyyy, dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd) goes in as Excel's own date, so it sorts and
//      filters as a date; other text stays text.
// Every name and figure is made up. TDSDESK_HTML points at another build (the check before a fix: it fails there).
const fs = require("fs"), path = require("path"), vm = require("vm"), {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "esc", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "INR", "FC"]);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.globalThis = ctx; ctx.self = ctx; ctx.Uint8Array = Uint8Array; ctx.ArrayBuffer = ArrayBuffer; ctx.TextEncoder = TextEncoder;
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "xlsx.js"), "utf8"), ctx);
const sx = ctx; ctx.window = ctx; ctx.ensureXlsx = async () => {}; ctx.CO = () => ({name: "Made-up Co"});
let saved = null; ctx.saveFile = (name, blob) => { saved = {name, blob}; }; ctx.Blob = class { constructor(parts){ this.parts = parts; } };
(async () => {
  console.log("1. two tables of one title");
  let err = null;
  try { await x.FC.excel("Assistant", [["Ledger account", [["Date", "Amount"], ["01-Apr-2025", 100]]], ["Ledger account", [["Date", "Amount"], ["02-Apr-2025", 200]]],
    ["Assumptions (tell me any to change and I'll redo it)", [["a"]]], ["Assumptions (tell me any to change and I'll redo it)", [["b"]]]]); } catch (e){ err = e; }
  ok(!err && saved, "the file is made" + (err ? ": " + (err.message || err) : ""));
  const wb = saved && sx.XLSX.read(saved.blob.parts[0], {type: "array", cellDates: true});
  const names = wb ? wb.SheetNames : [];
  ok(names.length === 4 && new Set(names).size === 4 && names.every(n => n.length <= 31), "four sheets, each named apart within 31 characters: " + JSON.stringify(names));
  console.log("2. dates as dates");
  const ws = wb && wb.Sheets[names[0]];
  const a2 = ws && ws.A2;
  ok(a2 && (a2.t === "d" || (a2.t === "n" && a2.z)), "01-Apr-2025 is a date cell, not text (type " + (a2 && a2.t) + ")");
  const sh = x.FC.sheet ? x.FC.sheet([["15/03/2025", "2025-04-01", "07-07-2025", "Invoice 01-Apr", "31-Feb-2025"]]) : null;
  ok(sh && ["A1", "B1", "C1"].every(k => sh[k].t === "d") && sh.D1.t === "s" && sh.E1.t === "s", "dd/mm/yyyy, yyyy-mm-dd and dd-mm-yyyy are dates; other text (and a date that does not exist) stays text");
  ok(sh && sh.A1.v instanceof sx.Date && sh.A1.v.getMonth() === 2 && sh.A1.v.getDate() === 15, "15/03/2025 is 15 March 2025 (day first)");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
