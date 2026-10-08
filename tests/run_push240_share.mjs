// node run_push240_share.mjs [judge dir ...] - (branch next-push, 2.4.0) the share check judged: each kind of entry typed on
// Tally's own screens (tally-versions mode share, TallyPrime 3.0 to 7.1), what FinCom gets from the add-on's full line
// against Tally's own record of the entry, both read by FinCom's parse.js (the cloud's reader, unchanged):
//   - a line the bridge takes (trusted, its party told): parse.js of the bridge's XML from the line (<case>.push.xml) must
//     equal parse.js of Tally's record (the fast request's answer for the entry, stripped as the bridge strips it:
//     <case>.tally.xml) in every field but the AlterID (the line carries none) and the order of the ledger lines
//   - a line the bridge does not take: the fast request confirms the entry, so what goes is Tally's record itself: it
//     must be there, the one entry, under the GUID the MasterID makes
// The judge folders are written by bridge-go's TestPush240ShareCaptures (testdata/push240/share/<run>/<release>/judge).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
let fails = 0, passes = 0;
const ok = (c, w) => { console.log((c ? "  PASS " : "  FAIL ") + w); if (c) passes++; else fails++; };
function flat(o, p, out) {
  if (o === null || typeof o !== "object") { out[p] = JSON.stringify(o); return out; }
  if (Array.isArray(o)) { out[p + ".length"] = String(o.length); o.forEach((x, i) => flat(x, p + "[" + i + "]", out)); return out; }
  for (const k of Object.keys(o).sort()) flat(o[k], p ? p + "." + k : k, out);
  return out;
}
// the ledger lines in one order, every reference to a line's number renumbered with them (as run_parse_fast234.mjs)
function canon(d) {
  const idx = d.lines.map((l, i) => [JSON.stringify(l), i]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  const to = new Map(idx.map(([, i], k) => [i, k]));
  const lines = idx.map(([, i]) => d.lines[i]);
  const vouchers = d.vouchers.map((v) => {
    const o = { ...v, alter: undefined };
    for (const k of ["costs", "banks", "tds", "dues"]) if (Array.isArray(v[k])) o[k] = v[k].map((x) => ({ ...x, n: to.has(x.n) ? to.get(x.n) : x.n })).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
    return o;
  });
  return { ...d, lines, vouchers, alterMax: undefined };
}
let dirs = process.argv.slice(2);
if (!dirs.length) {
  const root = path.join(HERE, "..", "bridge-go", "testdata", "push240", "share");
  if (fs.existsSync(root)) for (const run of fs.readdirSync(root).sort()) for (const rel of fs.readdirSync(path.join(root, run)).sort()) {
    const j = path.join(root, run, rel, "judge"); if (fs.existsSync(path.join(j, "manifest.json"))) dirs.push(j);
  }
}
if (!dirs.length) { console.log("no judge folders (run bridge-go's TestPush240ShareCaptures)"); process.exit(1); }
const tally = { n: 0, pass: 0, harness: 0 };
for (const j of dirs) {
  const rel = path.basename(path.dirname(j)), run = path.basename(path.dirname(path.dirname(j)));
  const man = JSON.parse(fs.readFileSync(path.join(j, "manifest.json"), "utf8"));
  for (const cas of Object.keys(man).sort()) {
    const c = man[cas], tag = run + " " + rel + " " + cas;
    if (!c.made) { console.log("  HARNESS " + tag + ": the keys made no entry (not judged)"); tally.harness++; continue; }
    tally.n++;
    const tf = path.join(j, cas + ".tally.xml");
    const t = fs.existsSync(tf) ? parseDay(fs.readFileSync(tf, "utf8")) : null;
    if (!t || t.n !== 1) { ok(false, tag + ": no record of Tally's for the entry (the fast request's answer is " + (t ? t.n + " entries" : "missing") + ")"); continue; }
    const tv = t.vouchers[0];
    if (!c.trusted) {
      const midHex = Number(c.mid).toString(16).padStart(8, "0");
      ok(tv.guid.endsWith("-" + midHex), tag + ": not taken from the line (" + c.why + "); confirmed by the fast request: Tally's record " + tv.type + " " + tv.no + " party '" + tv.party + "', " + t.lines.length + " ledger lines, goes");
      continue;
    }
    const pf = path.join(j, cas + ".push.xml");
    const p = parseDay(fs.readFileSync(pf, "utf8"));
    const a = flat(canon(p), "", {}), b = flat(canon(t), "", {});
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(), diff = keys.filter((k) => a[k] !== b[k]);
    ok(p.n === 1 && diff.length === 0, tag + " (" + c.event + "): the line taken, as Tally's record in all " + keys.length + " fields (party '" + tv.party + "', " + t.lines.length + " ledger lines)" +
      (diff.length ? "; differ: " + diff.slice(0, 10).map((k) => k + " line " + a[k] + " Tally " + b[k]).join(" | ") : ""));
  }
}
// the TDS journal typed on the screen (tally-versions run 37826941207, mode tds240, 3.0 and 7.1): the bridge's XML from the
// add-on's own line (bridge-go TestPush240TDSExemptRealLines) against Tally's own export of the entry: the TDS list (exempt,
// the rate as stored) and the ledger lines
const TD = path.join(HERE, "..", "bridge-go", "testdata", "push240", "tds240");
if (!process.argv.slice(2).length && fs.existsSync(TD)) for (const rel of ["3.0", "7.1"]) {
  const p = parseDay(fs.readFileSync(path.join(TD, rel + ".push.xml"), "utf8"));
  const t = parseDay(fs.readFileSync(path.join(TD, rel + "-tds240-tally-entry.xml"), "utf8"));
  const pv = p.vouchers[0], tv = t.vouchers.find((v) => v.tds && v.tds.length);
  const L = (d, g) => JSON.stringify(d.lines.filter((l) => l[0] === g).map((l) => l.slice(1, 3)).sort());
  ok(!!pv && !!tv && JSON.stringify(pv.tds) === JSON.stringify(tv.tds) && pv.tds.length === 1 && pv.tds[0].exempt === true && !pv.tds[0].rateWorkedOut && L(p, pv.guid) === L(t, tv.guid),
    "run 37826941207 " + rel + " TDS typed on the screen: the line's TDS " + JSON.stringify(pv && pv.tds) + (tv && JSON.stringify(pv.tds) === JSON.stringify(tv.tds) ? " as Tally's" : "; Tally " + JSON.stringify(tv && tv.tds)) + "; ledger lines " + (pv && tv && L(p, pv.guid) === L(t, tv.guid) ? "as Tally's" : "differ"));
}
console.log((fails ? "FAILED: " : "all passed: ") + passes + " PASS, " + fails + " FAIL, " + tally.harness + " not made by the keys");
process.exit(fails ? 1 : 0);
