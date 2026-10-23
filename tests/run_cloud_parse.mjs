// node run_cloud_parse.mjs - the cloud copy reads a day book exactly as FinCom does: the same entries, and every
// ledger's total the same, on the real books (day by day, as the bridge sends them)
import { createRequire } from "module";
import fs from "fs";
import { parseDay, namesKey } from "../server/tally-cloud/parse.js";
const require = createRequire(import.meta.url);
const {load, openBlob, HTML, DATA} = require("./harness");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const h = load(HTML, ["num", "r2", "Books"]);
const db = await h.x.Books.importDayBook(await openBlob(DATA + "/DayBook.xml"));
// the same file, cut into days as the bridge keeps them
const raw = fs.readFileSync(DATA + "/DayBook.xml");
const text = raw[0] === 0xFF && raw[1] === 0xFE ? raw.toString("utf16le") : raw.toString("utf8");
const byDay = {};
let cut, buf = text;
while ((cut = buf.indexOf("</VOUCHER>")) >= 0){
  const piece = buf.slice(0, cut + 10); buf = buf.slice(cut + 10);
  const st = piece.lastIndexOf("<VOUCHER "); if (st < 0) continue;
  const v = piece.slice(st), d = (v.match(/<DATE>(\d{8})<\/DATE>/) || [])[1]; if (!d) continue;
  (byDay[d] = byDay[d] || []).push("<TALLYMESSAGE>" + v + "</TALLYMESSAGE>");
}
let cv = 0; const cloudTot = {}, cloudIds = new Set();
for (const d of Object.keys(byDay)){
  const r = parseDay(byDay[d].join(""));
  const heads = new Map(r.vouchers.map(v => [v.guid, v]));
  cv += r.n; r.vouchers.forEach(v => cloudIds.add(v.guid));
  r.lines.forEach(([g, l, a]) => { const v = heads.get(g); if (v.cancel || v.opt) return; cloudTot[l] = (cloudTot[l] || 0) + a; });
}
const finTot = {};
db.vouchers.forEach(v => { if (v.cancel || v.opt) return; v.ent.forEach(e => { finTot[e.l] = (finTot[e.l] || 0) + e.a; }); });
ok(cv === db.vouchers.length, "the same entries: cloud " + cv + ", FinCom " + db.vouchers.length);
ok(db.vouchers.every(v => cloudIds.has(v.id)), "every entry FinCom reads is in the cloud copy, by its id");
const names = new Set(Object.keys(finTot).concat(Object.keys(cloudTot)));
const bad = [...names].filter(n => Math.abs((finTot[n] || 0) - (cloudTot[n] || 0)) >= 0.01);
ok(!bad.length, "every ledger's total is the same (" + names.size + " ledgers)" + (bad.length ? ": " + bad.slice(0, 5).map(n => n + " " + finTot[n] + " / " + cloudTot[n]).join("; ") : ""));
// finding 4 (02-Oct-2026): no ledger under two names, in either reading ("...Pvt Ltd&#13;&#10;(Noida)" was read by the
// cloud with two spaces, beside the master's one)
const byKey = new Map(); [...names].forEach(n => byKey.set(namesKey(n), (byKey.get(namesKey(n)) || []).concat([n])));
const twice = [...byKey.values()].filter(x => x.length > 1);
ok(!twice.length, "no ledger under two names" + (twice.length ? ": " + twice.slice(0, 5).map(x => JSON.stringify(x)).join("; ") : ""));
// bridge 2.3.1 part A (06-Oct-2026): the parser also reads the items, cost centres, bank, TDS, e-invoice and e-way bill
// details and the accuracy checks; what it read before is byte for byte the same on the Day Book: every entry's fields of
// before (guid .. cmp), every line, the counts, alterMax and dates, day by day, hash as the parser of 2.3.0 gave them
{
  const crypto = await import("crypto");
  const KEYS = ["guid", "date", "alter", "type", "no", "party", "narr", "fid", "cancel", "opt", "gstin", "pos", "ref", "refDate", "cmp"];
  const hsh = crypto.createHash("md5"); let flagged = 0, costs = 0;
  for (const d of Object.keys(byDay).sort()){
    const r = parseDay(byDay[d].join(""));
    hsh.update(JSON.stringify([r.vouchers.map(v => KEYS.map(k => v[k])), r.lines, r.n, r.alterMax, r.dates]));
    r.vouchers.forEach(v => { if (v.checks.length) flagged++; costs += v.costs.length; });
  }
  const got = hsh.digest("hex");
  ok(got === "72deb549d08559fc3b13ea78b0041d8e", "part A: the fields read before are byte for byte the 2.3.0 parser's on the Day Book (md5 " + got + ")");
  ok(flagged === 0, "part A: no entry of the Day Book fails the accuracy checks (" + flagged + ")");
  ok(costs === 14, "part A: the Day Book's 14 cost centre allocations read (" + costs + ")");
}
const t0 = Date.now(); parseDay(byDay[Object.keys(byDay).sort((a, b) => byDay[b].length - byDay[a].length)[0]].join("")); 
ok(Date.now() - t0 < 1000, "the busiest day is read in " + (Date.now() - t0) + " ms");
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
