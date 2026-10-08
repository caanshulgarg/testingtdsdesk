// node run_push233_parse.mjs - (branch next-push, the owner's decision of 07-Oct-2026: "full entry at save without
// read-back") the cloud reads the bridge's XML built from the add-on's full-entry line exactly as it reads Tally's own answer
// to the entry request for the same voucher. Shared fixture: bridge-go/testdata/push233/manifest.json names, per voucher,
// Tally's capture (the real TallyPrime 7.1 run's entries, testdata/real-tally-7.1/231, and typed-like made-up vouchers with
// TDS, godowns and batches, payroll and a stock journal), the add-on's lines built from it (*.lines.json) and the bridge's XML
// from those lines (*.push.xml), both kept current by bridge-go's TestPushEquivalenceWithCapture. parse.js is the cloud's,
// unchanged: same vouchers (all but the AlterID, which the line does not carry), same ledger lines, same items, TDS, bank,
// cost centres, dues and checks.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = JSON.stringify;
const man = JSON.parse(fs.readFileSync(path.join(TD, "push233", "manifest.json"), "utf8"));
const names = Object.keys(man).sort();
ok(names.length >= 20, "fixtures: " + names.length);
let tds = 0, items = 0, banks = 0, costs = 0;
for (const n of names) {
  const cap = parseDay(fs.readFileSync(path.join(TD, man[n].capture), "utf8"));
  const push = parseDay(fs.readFileSync(path.join(TD, "push233", man[n].push), "utf8"));
  const strip = (r) => r.vouchers.map((v) => ({ ...v, alter: undefined }));
  ok(push.n === cap.n && push.skipped === cap.skipped, n + ": " + push.n + " voucher(s), " + push.skipped + " skipped, as Tally's (" + cap.n + ", " + cap.skipped + ")");
  ok(J(strip(push)) === J(strip(cap)), n + ": the voucher as Tally's, AlterID aside" + (J(strip(push)) === J(strip(cap)) ? "" : "\n     push " + J(strip(push)) + "\n     tally " + J(strip(cap))));
  ok(J(push.lines) === J(cap.lines), n + ": the ledger lines as Tally's" + (J(push.lines) === J(cap.lines) ? "" : "\n     push " + J(push.lines) + "\n     tally " + J(cap.lines)));
  const v = push.vouchers[0];
  if (v) {
    tds += v.tds.length; items += v.items.length; banks += v.banks.length; costs += v.costs.length;
    if (!v.cancel && push.lines.length) ok(Math.abs(push.lines.reduce((t, l) => t + l[2], 0)) < 0.005, n + ": the ledger lines total zero");
    ok(push.alterMax === 0, n + ": no AlterID made up (" + push.alterMax + ")");
  }
}
// TDS from a real Tally (push-design run 37591395905, TallyPrime 3.0 to 7.1; bridge-go TestPushTDSFromFiveReleases): the
// bridge's XML from the add-on's line read as Tally's own XML for the same entry is read: its Day Book export on all five,
// and its answer to the bridge's entry request on 3.0 to 6.2 (on 7.1 that answer had the TDS lists empty)
const R = path.join(TD, "push233", "real");
let realTds = 0;
for (const rel of ["3.0", "4.1", "5.1", "6.2", "7.1"]) {
  const push = parseDay(fs.readFileSync(path.join(R, "pd591-" + rel + ".tds.push.xml"), "utf8"));
  const pv = push.vouchers[0];
  for (const [what, f] of [["Day Book export", "tds-tally-daybook.xml"], ["entry request", "tds-bridge-bymaster.xml"]]) {
    if (what === "entry request" && rel === "7.1") continue;
    const cap = parseDay(fs.readFileSync(path.join(R, "pd591-" + rel + "." + f), "utf8"));
    const cv = cap.vouchers.find((v) => v.tds && v.tds.length);
    ok(!!pv && !!cv && J(pv.tds) === J(cv.tds), rel + " TDS, as Tally's " + what + ": " + J(pv && pv.tds) + (cv && J(pv.tds) === J(cv.tds) ? "" : "\n     tally " + J(cv && cv.tds)));
    ok(J(push.lines.map((l) => l.slice(1, 3))) === J(cap.lines.filter((l) => cv && l[0] === cv.guid).map((l) => l.slice(1, 3))), rel + " ledger lines, as Tally's " + what + ": " + J(push.lines.map((l) => l.slice(1, 3))));
  }
  if (pv) realTds += pv.tds.length;
  ok(pv && pv.tds.length === 1 && pv.tds[0].base === 100000 && pv.tds[0].tax === 2000, rel + ": base 1,00,000 and tax 2,000");
}
ok(realTds === 5, "real TDS rows: " + realTds);
// the real lines of tally-real run 37677491784 (TallyPrime 7.1, the new add-on; bridge-go TestPushRealTallyRun677): the
// bridge's XML from the add-on's full line read as Tally's own answer to the entry request for the same voucher is read.
// KNOWN GAP (decision pending, reported 07-Oct-2026): the line is the voucher FORM at Form Accept, not the stored entry,
// and Tally sets two things as it stores it: the party of a non-invoice entry made new (P3: "" in the form, "S231
// Contractor" stored) and the bill type of an Alt+2 copy whose bill name exists ("New Ref" in the form, "Agst Ref" stored).
// Only those two, exactly, are let through here, each printed; any other difference fails. P3's TDS: Tally 7.1's answer
// has the lists empty, so its row is checked against the S5 entry's own values
const known = { "p2-sales50": ["bill"], "p4-godown": ["bill"], "p3-tds": ["party"] };
for (const n of ["p2-sales50", "p4-godown", "p3-tds"]) {
  const push = parseDay(fs.readFileSync(path.join(R, "tr677-" + n + ".push.xml"), "utf8"));
  const cap = parseDay(fs.readFileSync(path.join(R, "tr677-" + n + ".tally.xml"), "utf8"));
  const pv = push.vouchers[0], cv = cap.vouchers[0], gaps = [];
  const vk = Object.keys({ ...pv, ...cv }).filter((k) => k !== "alter" && k !== "tds" && J(pv[k]) !== J(cv[k]));
  if (vk.length === 1 && vk[0] === "party" && pv.party === "") gaps.push("party");
  const bill = (ls) => J(ls.map((l) => [l[0], l[1], l[2], l[3], l[4], (l[5] || []).map((b) => [b[0], b[2], b[3]])]));
  const lt = (ls) => J(ls.map((l) => (l[5] || []).map((b) => b[1])));
  if (J(push.lines) !== J(cap.lines) && bill(push.lines) === bill(cap.lines) && lt(push.lines).includes("New Ref") && lt(cap.lines).includes("Agst Ref")) gaps.push("bill");
  const vOk = vk.length === 0 || (vk.length === 1 && gaps.includes("party"));
  const lOk = J(push.lines) === J(cap.lines) || gaps.includes("bill");
  ok(vOk && lOk && J(gaps) === J(known[n] || []), "run 37677491784 " + n + ": the voucher and its " + push.lines.length + " ledger lines as Tally's" + (gaps.length ? " but the KNOWN GAP " + gaps.join(", ") : "") + (vOk && lOk ? "" : "\n     differs: " + vk.join(", ") + (lOk ? "" : " and the ledger lines")));
  for (const g of gaps) console.log("  INFO KNOWN GAP " + n + ": " + (g === "party" ? "party: the line " + J(pv.party) + ", Tally stored " + J(cv.party) : "bill type: the line " + lt(push.lines) + ", Tally stored " + lt(cap.lines)));
  if (n === "p3-tds") { const t = pv.tds; ok(t.length === 1 && t[0].base === 100000 && t[0].tax === 2000 && t[0].nature === "S231 Contract Work", "run 37677491784 p3-tds: TDS base 1,00,000, tax 2,000, nature S231 Contract Work: " + J(t)); }
  else ok(J(pv.tds) === J(cv.tds), "run 37677491784 " + n + ": TDS as Tally's");
}
ok(tds >= 2 && items >= 60 && banks >= 1 && costs >= 4, "covered: " + tds + " TDS rows, " + items + " item lines, " + banks + " bank rows, " + costs + " cost centre rows");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
