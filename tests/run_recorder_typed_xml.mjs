// node run_recorder_typed_xml.mjs - (06-Oct-2026, the owner's NWS144 line 18: Receipt 213, created, body {} and held
// "waiting for the entry's details" although bridge 2.2.4 sent Tally's voucher XML, 3,060 characters) the cloud reads a
// voucher as a real TallyPrime 7.1 writes it in a collection's answer: typed fields (<DATE TYPE="Date">,
// <ALTERID TYPE="Number"> 54493</ALTERID>, <LEDGERNAME TYPE="String">, <AMOUNT TYPE="Amount">, <BILLTYPE TYPE="String">),
// white space inside a value, and a CMPINFO block of counters (<VOUCHER>4</VOUCHER>) that is never a voucher.
// Fixtures: bridge-go/testdata/real-tally-7.1/ (captured from a real TallyPrime 7.1 in the spike's runs) and
// bridge-go/testdata/typed-like-7.1/receipt-213-by-master.xml (the owner's voucher, typed exactly as the real fixtures:
// Receipt 213 of 06-Oct-2026, Salesify Marketing LLP bill-wise Agst Ref, and Cash). The Day Book export (untyped) is read
// as before: tests/run_cloud_parse.mjs.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay, one } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const read = (p) => fs.readFileSync(path.join(TD, p), "utf8");
const el = (t) => t.slice(t.indexOf("<VOUCHER REMOTEID"), t.lastIndexOf("</VOUCHER>") + 10);
const J = JSON.stringify;

// 1. the real TallyPrime 7.1 answer (spike round 2, fetch-An.xml): one receipt, its CMPINFO counter <VOUCHER>4</VOUCHER> not one
{
  const t = read("real-tally-7.1/fetch-An.xml");
  for (const [what, x] of [["the whole answer", t], ["the voucher element as the bridge sends it", el(t)]]) {
    const r = parseDay(x), v = r.vouchers[0] || {};
    ok(r.n === 1 && v.guid === "226fb516-9d2d-45ad-ad78-304d86b64500-00000002", "real 7.1, " + what + ": one voucher, its GUID (" + r.n + ", " + v.guid + ")");
    ok(v.date === "20261002" && v.alter === 4 && v.type === "Receipt" && v.no === "1" && v.party === "Spike Customer" && v.narr === "spike receipt 212" && !v.cancel && !v.opt,
      "real 7.1, " + what + ": date, AlterID ' 4' as 4, type, number, party, narration, not cancelled, not optional (" + J(v) + ")");
    ok(J(r.lines) === J([[v.guid, "Spike Customer", 500, "", null, [["", "On Account", 500, null]]], [v.guid, "Spike Cash", -500, "", null, []]]),
      "real 7.1, " + what + ": two lines, amounts and signs, the On Account bill (" + J(r.lines) + ")");
    ok(r.alterMax === 4 && J(r.dates) === J(["20261002"]), "real 7.1, " + what + ": alterMax 4, dated 02-Oct-2026 (" + r.alterMax + ", " + J(r.dates) + ")");
  }
  const d = parseDay(read("real-tally-7.1/vouchers-d.xml"));
  ok(d.n === 5 && d.vouchers.every((v) => /^226fb516-.*-0000000[1-5]$/.test(v.guid) && /^\d{8}$/.test(v.date)), "real 7.1 list of 5 vouchers (CMPINFO says 8): 5 read, each with its GUID and date (" + d.n + ")");
  ok(parseDay(read("real-tally-7.1/fetch-H.xml")).n === 0, "real 7.1, an empty answer (CMPINFO only, <VOUCHER>4</VOUCHER>): no voucher");
}

// 2. the owner's voucher (NWS144 line 18), typed as the real fixtures are
{
  const t = read("typed-like-7.1/receipt-213-by-master.xml"), x = el(t);
  ok(x.length > 2900 && x.length < 3300, "the fixture's voucher element is about the owner's 3,060 characters (" + x.length + ")");
  for (const [what, s] of [["the whole answer", t], ["the voucher element", x]]) {
    const r = parseDay(s), v = r.vouchers[0] || {}, G = "7c5fd9b3-7235-4cbb-b4cd-1124be599189-00006729";
    ok(r.n === 1 && v.guid === G, "Receipt 213, " + what + ": one voucher, GUID ...-00006729 (" + r.n + ", " + v.guid + ")");
    ok(v.date === "20261006" && v.type === "Receipt" && v.no === "213" && v.party === "Salesify Marketing LLP" && v.alter === 54493 && !v.cancel && !v.opt,
      "Receipt 213, " + what + ": 06-Oct-2026, Receipt, 213, Salesify Marketing LLP, AlterID 54493 (" + J(v) + ")");
    ok(J(r.lines) === J([[G, "Salesify Marketing LLP", 59000, "", null, [["GSC/2026-27/118", "Agst Ref", 59000, null]]], [G, "Cash", -59000, "", null, []]]),
      "Receipt 213, " + what + ": two lines, party credit 59,000 with its Agst Ref bill, Cash debit -59,000 (" + J(r.lines) + ")");
  }
  // the bill typed in every field, a New Ref with a credit period, and white space inside values
  const y = x.replace("<NAME>GSC/2026-27/118</NAME>", '<NAME TYPE="String"> 213 </NAME>').replace("Agst Ref", "New Ref")
    .replace("<BILLCREDITPERIOD/>", '<BILLCREDITPERIOD JD="46300" P="30 Days">30 Days</BILLCREDITPERIOD>')
    .replace("<AMOUNT>59000.00</AMOUNT>", '<AMOUNT TYPE="Amount"> 59000.00 </AMOUNT>').replace("<VOUCHERNUMBER>213</VOUCHERNUMBER>", '<VOUCHERNUMBER TYPE="String"> 213 </VOUCHERNUMBER>');
  const r = parseDay(y);
  ok(r.n === 1 && r.vouchers[0].no === "213" && J(r.lines[0][5]) === J([["213", "New Ref", 59000, 30]]),
    "a bill typed in every field (NAME, AMOUNT, BILLCREDITPERIOD), New Ref, values padded: read, trimmed (" + J(r.lines[0][5]) + ")");
}

// 3. one(): a tag with or without attributes and padded values; never a self-closed <TAG/>, never a longer tag
{
  ok(one('<MASTERID TYPE="Number"> 2</MASTERID>', "MASTERID") === "2", "one: a typed number padded with a space is '2'");
  ok(one("<GUID>g-1</GUID>", "GUID") === "g-1" && one('<GUID TYPE="String">g-1</GUID>', "GUID") === "g-1", "one: GUID plain or typed");
  ok(one("<NAME/><NAME>B-1</NAME>", "NAME") === "B-1", "one: a self-closed <NAME/> is not a value; the next <NAME> is");
  ok(one("<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>", "VOUCHER") === "" && one("<DATE2>x</DATE2><DATE>20261006</DATE>", "DATE") === "20261006", "one: never a longer tag");
}
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
