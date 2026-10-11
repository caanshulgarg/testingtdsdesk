// node run_parse_gsttype.mjs - bridge 2.4.2 (round 44 part B; the owner's approval of 11-Oct-2026: "the bridge sends each
// entry's GST type"). FinCom's reader (server/tally-cloud/parse.js) reads each entry's GST type the same way from the
// bridge's entry body and from a Day Book export:
//   1. the entries as bridge 2.4.2 sends them (Tally's real FinComVoucherObject answers on TallyPrime 3.0, 4.1, 5.1, 6.2
//      and 7.1, tally-versions run 38099393603, stripped by the bridge: bridge-go/testdata/gsttype242/<release>/
//      obj-<id>-stripped.xml, written by the Go test TestGST242StripRealCaptures): the registration type, country, reverse
//      charge, nature, taxability, goods or services and the blocked-credit mark, as Tally stored them;
//   2. the same entries in the Day Book's form (7.1, the Voucher collection with every stored field): the same "gst";
//   3. a body from a bridge before 2.4.2 (none of the fields): no "gst" (the cloud keeps what it has);
//   4. a ledger without GST details carries Tally's "Applicable" for the ineligible credit with no taxability or nature:
//      not a blocked credit.
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata", "gsttype242");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const base = { rcm: false, ineligible: false, mixed: false };
const WANT = {
  S01: { reg: "Regular", country: "India", nature: "Sales Taxable", taxability: "Taxable", supply: "Goods" },
  S03: { reg: "Regular", country: "India", nature: "Sales to SEZ - Taxable", taxability: "Taxable", supply: "Goods" },
  S04: { reg: "Regular", country: "India", nature: "Sales to SEZ - LUT/Bond", taxability: "Exempt", supply: "Goods" },
  S05: { reg: "Unregistered", country: "Germany", nature: "Exports - Taxable", taxability: "Taxable", supply: "Goods" },
  S06: { reg: "Unregistered", country: "Germany", nature: "Exports - LUT/Bond", taxability: "Exempt", supply: "Goods" },
  S10: { reg: "Regular", country: "India", nature: "Sales Nil Rated", taxability: "Nil Rated", supply: "Goods" },
  S11: { reg: "Unregistered", country: "India", nature: "Interstate Sales Exempt", taxability: "Exempt", supply: "Goods" },
  S15: { reg: "Regular", country: "India", nature: "Interstate Sales Taxable", taxability: "Taxable", supply: "Services" },
  P03: { reg: "Unregistered/Consumer", country: "India", nature: "Purchase From Unregistered Dealer - Taxable", taxability: "Exempt", supply: "Services", rcm: true },
  P04: { reg: "Regular", country: "India", nature: "Purchase Taxable", taxability: "Taxable", supply: "Goods" },
  P04L: { reg: "Regular", country: "India", nature: "Purchase Taxable", taxability: "Taxable", supply: "Goods", ineligible: true },
  P04V1: { reg: "Regular", country: "India", nature: "Purchase Taxable", taxability: "Taxable", supply: "Goods" },
  P04V2: { reg: "Regular", country: "India", nature: "Purchase Taxable", taxability: "Taxable", supply: "Goods", ineligible: true },
  P05: { reg: "Unregistered", country: "India", nature: "Purchase Exempt", taxability: "Exempt", supply: "Goods" }
};
const KEYS = ["reg", "country", "rcm", "nature", "taxability", "supply", "ineligible", "mixed"];
const show = (g) => g ? KEYS.map((k) => k + "=" + JSON.stringify(g[k])).join(" ") : "none";
const same = (g, w) => g && KEYS.every((k) => g[k] === w[k]) && Object.keys(g).length === KEYS.length;
const byGuid = {};
for (const rel of ["3.0", "4.1", "5.1", "6.2", "7.1"]) {
  for (const [id, w0] of Object.entries(WANT)) {
    const f = path.join(TD, rel, "obj-" + id + "-stripped.xml");
    if (!fs.existsSync(f)) { ok(false, rel + " " + id + ": no stripped capture"); continue; }
    const r = parseDay(fs.readFileSync(f, "utf8")), v = r.vouchers[0], w = { ...base, ...w0 };
    ok(r.n === 1 && same(v.gst, w), rel + " " + id + " (the bridge's body): " + show(v && v.gst) + (same(v && v.gst, w) ? "" : " | want " + show(w)));
    if (rel === "7.1") byGuid[v.guid] = { id, gst: v.gst };
  }
}
// 2. the Day Book's form of the same entries (7.1)
const coll = parseDay(zlib.gunzipSync(fs.readFileSync(path.join(TD, "7.1", "coll-all.xml.gz"))).toString("utf8"));
let n2 = 0;
for (const v of coll.vouchers) {
  const b = byGuid[v.guid]; if (!b) continue; n2++;
  ok(JSON.stringify(v.gst) === JSON.stringify(b.gst), "7.1 " + b.id + ": the Day Book's form reads the same GST type (" + show(v.gst) + ")");
}
ok(n2 === Object.keys(WANT).length, "7.1: every entry also in the Day Book's form (" + n2 + ")");
// 3. a body without the fields (a bridge before 2.4.2): no gst
const old = fs.readFileSync(path.join(TD, "7.1", "obj-S03-stripped.xml"), "utf8")
  .replace(/<(GSTREGISTRATIONTYPE|COUNTRYOFRESIDENCE|ISREVERSECHARGEAPPLICABLE|GSTOVRDN\w+)>[^<]*<\/\1>/g, "");
ok(parseDay(old).vouchers[0].gst === undefined, "a body from a bridge before 2.4.2 (no GST type fields): no gst, the cloud keeps what it has");
// 4. Tally's "Applicable" on a ledger without GST details (no taxability, no nature: TallyPrime 7.1's TDS journal, run
// 38072484999) is not a blocked credit; with a taxability it is
const j = '<VOUCHER REMOTEID="g-1" VCHTYPE="Journal"><DATE>20260501</DATE><GUID>g-1</GUID><ISREVERSECHARGEAPPLICABLE>No</ISREVERSECHARGEAPPLICABLE>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Purchase of Goods</LEDGERNAME><AMOUNT>-10.00</AMOUNT><GSTOVRDNINELIGIBLEITC>&#4; Applicable</GSTOVRDNINELIGIBLEITC></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Supplier</LEDGERNAME><AMOUNT>10.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>';
ok(parseDay(j).vouchers[0].gst.ineligible === false, "a ledger without GST details (Tally's 'Applicable', no taxability or nature): not blocked");
ok(parseDay(j.replace("&#4; Applicable</GSTOVRDNINELIGIBLEITC>", "&#4; Applicable</GSTOVRDNINELIGIBLEITC><GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>")).vouchers[0].gst.ineligible === true,
  "the same line with a taxability: blocked");
// an item invoice: the nature on the item, or on the ledger line under it
const it = '<VOUCHER REMOTEID="g-2" VCHTYPE="Sales"><DATE>20260501</DATE><GUID>g-2</GUID><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><ISREVERSECHARGEAPPLICABLE>No</ISREVERSECHARGEAPPLICABLE>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Gamma SEZ Unit</LEDGERNAME><AMOUNT>-400.00</AMOUNT><GSTOVRDNNATURE></GSTOVRDNNATURE></ALLLEDGERENTRIES.LIST>' +
  '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Laptop</STOCKITEMNAME><AMOUNT>400.00</AMOUNT><GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY><GSTOVRDNISREVCHARGEAPPL> Not Applicable</GSTOVRDNISREVCHARGEAPPL>' +
  '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales Items</LEDGERNAME><AMOUNT>400.00</AMOUNT><GSTOVRDNNATURE>Sales to SEZ - LUT/Bond</GSTOVRDNNATURE></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST></VOUCHER>';
const gi = parseDay(it).vouchers[0].gst;
ok(gi && gi.nature === "Sales to SEZ - LUT/Bond" && gi.taxability === "Taxable" && gi.rcm === false, "an item invoice: the nature from the ledger line under the item, the taxability from the item (" + show(gi) + ")");
// review M2: nature, taxability and goods/services come together from the entry's first GST line in the document's order;
// an entry whose GST lines disagree is marked mixed
const mx = '<VOUCHER REMOTEID="g-3" VCHTYPE="Sales"><DATE>20260501</DATE><GUID>g-3</GUID><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><ISREVERSECHARGEAPPLICABLE>No</ISREVERSECHARGEAPPLICABLE>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><AMOUNT>-200.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Exempt</LEDGERNAME><AMOUNT>100.00</AMOUNT><GSTOVRDNNATURE>Sales Exempt</GSTOVRDNNATURE><GSTOVRDNTAXABILITY>Exempt</GSTOVRDNTAXABILITY><GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Services</LEDGERNAME><AMOUNT>100.00</AMOUNT><GSTOVRDNNATURE>Sales Taxable</GSTOVRDNNATURE><GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY><GSTOVRDNTYPEOFSUPPLY>Services</GSTOVRDNTYPEOFSUPPLY></ALLLEDGERENTRIES.LIST></VOUCHER>';
const gm = parseDay(mx).vouchers[0].gst;
ok(gm.nature === "Sales Exempt" && gm.taxability === "Exempt" && gm.supply === "Goods" && gm.mixed === true, "M2: a taxable and an exempt line: the first line's nature, taxability and supply together, marked mixed (" + show(gm) + ")");
// an item invoice in the document's order: the item before the ledger line under it, before a later ledger line
const io = '<VOUCHER REMOTEID="g-4" VCHTYPE="Sales"><DATE>20260501</DATE><GUID>g-4</GUID><ISREVERSECHARGEAPPLICABLE>No</ISREVERSECHARGEAPPLICABLE>' +
  '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>X</STOCKITEMNAME><AMOUNT>100.00</AMOUNT><GSTOVRDNNATURE>Exports - LUT/Bond</GSTOVRDNNATURE><GSTOVRDNTAXABILITY>Exempt</GSTOVRDNTAXABILITY>' +
  '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>100.00</AMOUNT><GSTOVRDNNATURE>Exports - LUT/Bond</GSTOVRDNNATURE><GSTOVRDNTAXABILITY>Exempt</GSTOVRDNTAXABILITY></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Freight</LEDGERNAME><AMOUNT>10.00</AMOUNT><GSTOVRDNNATURE>Sales Taxable</GSTOVRDNNATURE><GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Buyer</LEDGERNAME><AMOUNT>-110.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>';
const go = parseDay(io).vouchers[0].gst;
ok(go.nature === "Exports - LUT/Bond" && go.taxability === "Exempt" && go.mixed === true, "M2: the item first (document order), the freight line's other kind marks it mixed (" + show(go) + ")");
// review M1: a body with openers never closed is read in linear time (20,000 unclosed item lists and 2 MB of text)
const big = '<VOUCHER REMOTEID="g-5" VCHTYPE="Sales"><DATE>20260501</DATE><GUID>g-5</GUID><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>' +
  "<ALLINVENTORYENTRIES.LIST><ACCOUNTINGALLOCATIONS.LIST><LEDGERENTRIES.LIST>".repeat(20000) + "x".repeat(2000000) + "</VOUCHER>";
const t0 = Date.now(); const gb = parseDay(big); const ms = Date.now() - t0;
ok(ms < 3000, "M1: 20,000 unclosed line lists and 2 MB of text read in " + ms + " ms (" + gb.n + " entries)");
console.log(fails ? fails + " FAILED" : "all ok");
process.exit(fails ? 1 : 0);
