// node run_parse_lows.mjs - bridge 2.3.1, the deferred Lows of the 2.3.0 review round 3 on the cloud's reader
// (server/tally-cloud/parse.js), each written first:
//   L1. the tag pattern (one(), after(), igstRate) was quadratic on crafted input: an opening tag never closed made each
//       try scan to the end of the text ([^>]* crossed every later tag). A tag's attributes now stop at the next "<"
//       ((?:\s[^<>]*[^/<>])?\s*>): 40,000 unclosed tags read in well under a second; real Tally output reads as before.
//   L3. a self-closed CMPINFO with attributes (<CMPINFO TYPE="x"/>) was taken as an opening one, so the counters' drop ran
//       on to the next </CMPINFO> and swallowed the vouchers between. It is now dropped alone.
import { parseDay, one, igstRate } from "../server/tally-cloud/parse.js";
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const V = (g, no) => `<VOUCHER REMOTEID="${g}" VCHTYPE="Receipt" ACTION="Create"><DATE>20261002</DATE><GUID>${g}</GUID><ALTERID>4</ALTERID>` +
  `<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>${no}</VOUCHERNUMBER><PARTYLEDGERNAME>Cash</PARTYLEDGERNAME>` +
  `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST>` +
  `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`;
const wrap = (x) => `<ENVELOPE><BODY><DATA><COLLECTION>${x}</COLLECTION></DATA></BODY></ENVELOPE>`;

// L1: one() on many unclosed opening tags
{
  const crafted = "<GUID x".repeat(40000);
  let t = Date.now(); one(crafted, "GUID"); const a = Date.now() - t;
  ok(a < 1000, "L1 one(): 40,000 unclosed <GUID tags read in " + a + " ms (under 1 s)");
  const crafted2 = "<GSTRATEDUTYHEAD x".repeat(40000);
  t = Date.now(); igstRate(crafted2); const b = Date.now() - t;
  ok(b < 1000, "L1 igstRate(): 40,000 unclosed <GSTRATEDUTYHEAD tags read in " + b + " ms (under 1 s)");
  const crafted3 = wrap(V("aaaa-00000001", "1") + "<VOUCHER x".repeat(20000));
  t = Date.now(); const r = parseDay(crafted3); const c = Date.now() - t;
  ok(c < 2000, "L1 parseDay(): 20,000 unclosed <VOUCHER tags after a voucher read in " + c + " ms (under 2 s)");
  ok(r.vouchers.some((v) => v.guid === "aaaa-00000001"), "L1 parseDay(): the real voucher still read");
}
// what was read before is read the same: typed and untyped fields, never a self-closed tag, never a longer tag
{
  ok(one('<GUID TYPE="String"> ab-1 </GUID>', "GUID") === "ab-1", "typed field read, trimmed");
  ok(one("<GUID>ab-2</GUID>", "GUID") === "ab-2", "untyped field read");
  ok(one('<GUID TYPE="String"/><GUID>ab-3</GUID>', "GUID") === "ab-3", "a self-closed tag is not a value");
  ok(one("<GUIDX>no</GUIDX><GUID>ab-4</GUID>", "GUID") === "ab-4", "a longer tag is not the field");
  const g = '<GSTRATEDUTYHEAD TYPE="String">IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE TYPE="String">Based on Value</GSTRATEVALUATIONTYPE><GSTRATE TYPE="Number"> 18</GSTRATE>';
  ok(igstRate(g) === 18, "igstRate typed: 18 (" + igstRate(g) + ")");
  ok(igstRate(g.replace(/ TYPE="[^"]*"/g, "")) === 18, "igstRate untyped: 18");
}
// L3: a self-closed CMPINFO with attributes swallows no voucher
{
  const x = wrap('<CMPINFO TYPE="x"/>' + V("bbbb-00000001", "1") + V("bbbb-00000002", "2") + "<CMPINFO><VOUCHER>2</VOUCHER></CMPINFO>");
  const r = parseDay(x);
  ok(r.vouchers.length === 2, "L3: <CMPINFO TYPE=\"x\"/> before two vouchers: both read (" + r.vouchers.map((v) => v.guid).join(",") + ")");
  const y = wrap("<CMPINFO/>" + V("cccc-00000001", "1"));
  ok(parseDay(y).vouchers.length === 1, "L3: <CMPINFO/> (no attributes): the voucher read");
  const z = wrap('<CMPINFO TYPE="x"><VOUCHER>4</VOUCHER><LEDGER>21</LEDGER></CMPINFO>' + V("dddd-00000001", "1"));
  const rz = parseDay(z);
  ok(rz.vouchers.length === 1 && rz.vouchers[0].guid === "dddd-00000001", "CMPINFO with attributes and counters: the counters are not a voucher");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
