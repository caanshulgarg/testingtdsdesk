// node run_parse_fast234.mjs - next-fastfetch (the owner's decision of 08-Oct-2026, "Allow, strip in bridge"): the fast
// request (the object export "ID:<MasterID>") brings Tally's whole voucher; the bridge keeps exactly the approved fields
// of FinComVoucherByMaster and turns LEDGERENTRIES.LIST into ALLLEDGERENTRIES.LIST (bridge-go/fastvch.go). For real
// captures of TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (push-design run 37657679690; bridge-go/testdata/fast234/), FinCom's
// reader (parse.js) must read the stripped voucher exactly as it reads today's request's answer for the same voucher:
// every field of its output compared, nothing left out.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata", "fast234");
let fails = 0, n = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
// every field of the reader's output, by path, as text (so a difference names the field)
function flat(o, p, out) {
  if (o === null || typeof o !== "object") { out[p] = JSON.stringify(o); return out; }
  if (Array.isArray(o)) { out[p + ".length"] = String(o.length); o.forEach((x, i) => flat(x, p + "[" + i + "]", out)); return out; }
  for (const k of Object.keys(o).sort()) flat(o[k], p ? p + "." + k : k, out);
  return out;
}
// the entry's ledger lines in one order (an item invoice's object holds its party and tax lines before the lines under its
// items, as Tally's own Day Book export does; the collection answer gave the lines under the items first): the lines
// sorted, and every reference to a line's number (costs, banks, TDS, due dates) renumbered with them. Nothing else moves;
// how many lines moved is said
function canon(d) {
  const idx = d.lines.map((l, i) => [JSON.stringify(l), i]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  const to = new Map(idx.map(([, i], k) => [i, k]));
  const moved = idx.filter(([, i], k) => i !== k).length;
  const lines = idx.map(([, i]) => d.lines[i]);
  const vouchers = d.vouchers.map((v) => {
    const o = { ...v };
    for (const k of ["costs", "banks", "tds", "dues"]) if (Array.isArray(v[k])) o[k] = v[k].map((x) => ({ ...x, n: to.has(x.n) ? to.get(x.n) : x.n })).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
    return o;
  });
  return { d: { ...d, lines, vouchers }, moved };
}
for (const rel of fs.readdirSync(TD).filter((d) => /^\d+\.\d+$/.test(d)).sort()) {
  for (const tgt of ["sales", "receipt"]) {
    const f = (k) => path.join(TD, rel, tgt + "-" + k + ".xml");
    if (!fs.existsSync(f("stripped"))) { ok(false, rel + " " + tgt + ": no stripped capture (run the Go test TestFast234StripCaptures)"); continue; }
    const today = parseDay(fs.readFileSync(f("bymaster"), "utf8")), fast = parseDay(fs.readFileSync(f("stripped"), "utf8"));
    const ct = canon(today), cf = canon(fast);
    const a = flat(ct.d, "", {}), b = flat(cf.d, "", {});
    const moved = JSON.stringify(today.lines) === JSON.stringify(fast.lines) ? "" : " (the same lines in another order: the lines under the items after the party and tax lines, as Tally's Day Book gives them)";
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const diff = keys.filter((k) => a[k] !== b[k]);
    n++;
    ok(today.n === 1 && diff.length === 0, rel + " " + tgt + ": " + keys.length + " fields of parse.js's output, all the same" + moved +
      (diff.length ? "; differ: " + diff.slice(0, 12).map((k) => k + " today " + a[k] + " fast " + b[k]).join(" | ") : ""));
  }
}
ok(n === 10, "10 vouchers compared (5 releases x 2): " + n);
console.log(fails ? fails + " FAILED" : "all ok");
process.exit(fails ? 1 : 0);
