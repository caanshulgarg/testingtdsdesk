// node run_parse_fast234_kinds.mjs - FinCom Bridge 2.3.4 (the independent review, L2 / L3; the coordinator, 08-Oct-2026:
// "prove the stripped object answer stores the same rows as today's request"): real answers of every kind of entry on
// TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (push-design run 37741662830; bridge-go/testdata/fast234kinds: a payment with TDS
// typed on Tally's screen (S5), credit notes (accounting, with items), a debit note, journals (with a party, with cost
// centres), bank payments (UTR, cheque), a receipt with bank details and a cost centre, sales invoices (5, 50 items with
// GST, godowns and batches, 200 and 500 items), payroll (50, 200 employees), delivery and receipt notes, stock,
// manufacturing and physical stock journals). parse.js on today's answer (FinComVoucherByMaster) and on the stripped
// object (TestFast234KindsStrip's goldens) must agree, field by field, but for two differences, both towards Tally's own
// Day Book export (push-design run 37747714876, fast234d.ps1):
//   - "On Account": Tally's Voucher collection gives a bill-wise party's line that has no bill an "On Account" bill of
//     the whole amount; the object export, like the Day Book export, gives none. FinCom reads a line with no bill as on
//     account (src/js/07-mis.js), so receivables are the same
//   - TDS: the object, like the Day Book, carries the TDS details of an entry typed on the screen that today's answer
//     left empty (the S5 payment on 7.1): more, never less
// The voucher-mode invoice (stock under the sales line) is held by the bridge (its golden says HELD): not compared.
// 2.3.4 re-review (push-design run 37770938549, 3.0 and 7.1): an item invoice whose sales ledger is also a line of its own
// (M2: read as the collection's answer was, by parse.js) and a payroll voucher typed on Tally's Payroll screen (L1: its pay
// heads under each employee written as ledger lines with the employees as cost centres, by the bridge): stored as today,
// but for 7.1's collection leaving the M2 invoice's cost centres out (the object keeps them, as 3.0's answer did)
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata", "fast234kinds");
let fails = 0, n = 0, onAcc = 0, tdsMore = 0, held = 0, costMore = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const flat = (o, p, out) => { if (o === null || typeof o !== "object") { out[p] = JSON.stringify(o); return out; } if (Array.isArray(o)) { out[p + ".length"] = String(o.length); o.forEach((x, i) => flat(x, p + "[" + i + "]", out)); return out; } for (const k of Object.keys(o).sort()) flat(o[k], p ? p + "." + k : k, out); return out; };
// lines in one order (the object gives an item invoice's party and tax lines first, as the Day Book), references renumbered
const canon = (d) => ({ ...d, lines: d.lines.map((l) => JSON.stringify(l)).sort(), vouchers: d.vouchers.map((v) => { const o = { ...v }; for (const k of ["costs", "banks", "tds", "dues"]) if (Array.isArray(v[k])) o[k] = v[k].map((x) => JSON.stringify({ ...x, n: 0 })).sort(); return o; }) });
for (const rel of fs.readdirSync(TD).filter((d) => /^\d+\.\d+$/.test(d)).sort()) {
  for (const f of fs.readdirSync(path.join(TD, rel)).filter((f) => f.endsWith("-object-stripped.xml")).sort()) {
    const kind = f.replace(/-object-stripped\.xml$/, "");
    const fast = fs.readFileSync(path.join(TD, rel, f), "utf8");
    if (fast.startsWith("HELD: ")) { held++; ok(kind === "sales-voucher-mode-items", rel + " " + kind + ": held by the bridge (" + fast.slice(6) + ")"); continue; }
    const today = parseDay(zlib.gunzipSync(fs.readFileSync(path.join(TD, rel, kind + "-bymaster.xml.gz"))).toString("utf8")), got = parseDay(fast);
    // the two differences towards the Day Book
    let oa = 0, tm = 0;
    today.lines = today.lines.map((l) => { const b = l[5]; if (Array.isArray(b) && b.length === 1 && b[0][0] === "" && b[0][1] === "On Account") { oa++; return [...l.slice(0, 5), []]; } return l; });
    today.vouchers.forEach((v, i) => { const g = got.vouchers[i]; if (g && Array.isArray(g.tds) && g.tds.length && (!v.tds || !v.tds.length)) { tm++; v.tds = g.tds; } });
    // re-review M2: an item invoice whose sales ledger is also a line of its own: TallyPrime 7.1's collection answer left
    // the cost centres of the lines under the items out of the entry's list (3.0's kept them); the object keeps them
    let cm = 0;
    today.vouchers.forEach((v, i) => { const g = got.vouchers[i]; if (g && Array.isArray(g.costs) && g.costs.length && (!v.costs || !v.costs.length) && kind === "sales-5-items-direct-sales-line") { cm++; v.costs = g.costs; } });
    costMore += cm;
    onAcc += oa; tdsMore += tm;
    const a = flat(canon(today), "", {}), b = flat(canon(got), "", {});
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(), diff = keys.filter((k) => a[k] !== b[k]);
    n++;
    ok(diff.length === 0, rel + " " + kind + ": " + keys.length + " fields of parse.js's output the same" + (oa ? "; " + oa + " On Account bill(s) only in today's" : "") + (tm ? "; TDS details only in the object" : "") + (cm ? "; cost centres only in the object" : "") +
      (diff.length ? "; differ: " + diff.slice(0, 8).map((k) => k + " today " + a[k] + " fast " + b[k]).join(" | ") : ""));
  }
}
ok(n >= 100 && held === 5, n + " entries compared on five releases, " + held + " held; " + onAcc + " On Account bills only in today's answer; " + tdsMore + " entries with TDS details only in the object; " + costMore + " with cost centres only in the object");
console.log(fails ? fails + " FAILED" : "all ok");
process.exit(fails ? 1 : 0);
