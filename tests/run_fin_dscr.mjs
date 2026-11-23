// node run_fin_dscr.mjs - the Schedule III debt service coverage ratio of the statements' workbook (app/src/lib/finExport.js
// ratios) counts the principal repaid in the year in the debt service (ICAI's guidance on the ratio; review of 22-Nov-2026,
// track mis-audit). Made-up company: profit 10 lakh, depreciation 2 lakh, finance costs 1 lakh, term loan principal repaid
// 9 lakh (typed for the ratios, b.fs.rx.det["2025"].dscr): DSCR (10 + 2 + 1) / (1 + 9) = 1.3, not 13.
// FINX points at another copy of finExport.js (the check before the fix: it fails there).
import path from "path"; import { fileURLToPath, pathToFileURL } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.S = { books: { fs: { rx: { det: { "2025": { dscr: { principalCy: 900000, principalPy: 0 } } } } } } };
const file = process.env.FINX || path.join(here, "..", "app", "src", "lib", "finExport.js");
const { ratios } = await import(pathToFileURL(file).href);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const z = { cy: 0, py: 0 }, line = (id, cy) => ({ id, cy, py: 0 });
const d = { kind: "co", fy: "2025", inputs: { unit: 1, dec: 2 },
  bs: { sections: { EQ: { total: { cy: 5000000, py: 0 }, lines: [] }, NCL: { total: z, lines: [line("ltb", 1000000)] }, CL: { total: { cy: 500000, py: 0 }, lines: [] }, CA: { total: { cy: 800000, py: 0 }, lines: [] }, NCA: { total: z, lines: [] } } },
  notes: [], pl: { rev: { cy: 9000000, py: 0 }, mat: z, pur: z, chg: z, exp: z, pat: { cy: 1000000, py: 0 }, dep: { cy: 200000, py: 0 }, fin: { cy: 100000, py: 0 }, pbt: { cy: 1300000, py: 0 } } };
const r = ratios(d), ds = r && r.list.find((x) => x.key === "dscr");
ok(ds && Math.abs(ds.cy - 1.3) < 1e-9, "DSCR (10 + 2 + 1) lakh / (1 + 9) lakh = 1.3 (got " + (ds && ds.cy) + ")");
ok(ds && /principal/i.test(ds.denL), "the denominator says it holds the principal repaid: " + (ds && ds.denL));
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
