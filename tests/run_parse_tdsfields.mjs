// node run_parse_tdsfields.mjs - bridge 2.4.3 (the owner's approval of 11-Oct-2026, (a)): FinCom's reader
// (server/tally-cloud/parse.js) reads a TDS payment's challan and the TDS references the same way from the bridge's entry
// body and from Tally's full export (the Day Book's form):
//   1. the entries as bridge 2.4.3 sends them (Tally's real FinComVoucherObject answers on TallyPrime 7.1, tally-versions
//      run 38155837948, stripped by the bridge: bridge-go/testdata/tdsfields243/7.1/obj-<id>-stripped.xml, written by the
//      Go test TestTDS243StripRealCaptures): PX1's challan (BSR, number, date, cheque, bank, branch), its lines' tax /
//      interest / late fee; SP1's Stat Payment period and per-nature detail; the references linking SP1 to K1;
//   2. the same entries in Tally's full export (every stored field): the same "tdsx";
//   3. an entry with none of these fields (a GST sale): no "tdsx" (the cloud keeps what it has);
//   4. the TDS lines themselves (tds) are read exactly as before.
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata", "tdsfields243", "7.1");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = (x) => JSON.stringify(x);
const read = (id) => parseDay(fs.readFileSync(path.join(TD, "obj-" + id + "-stripped.xml"), "utf8")).vouchers[0];
const full = (id) => parseDay(zlib.gunzipSync(fs.readFileSync(path.join(TD, "full-" + id + ".xml.gz"))).toString("utf8")).vouchers[0];

// 1. PX1: a TDS payment with its challan (made by XML), 194J tax 10000, interest 150, late fee 200
const px = read("PX1");
ok(px && px.tdsx, "PX1 carries tdsx");
const x = (px && px.tdsx) || {};
ok(J(x.challan) === J({bsr: "0510308", no: "54321", date: "20261231", chq: "778899", chqDate: "20261201", bank: "HDFC Bank Ltd", branch: "Connaught Place"}), "PX1's challan: " + J(x.challan));
ok(x.stat === "TDS" && x.from === "20261101" && x.nature === "FC Prof Fees 194J" && x.section === "194J", "PX1's duty, period, nature and section: " + J([x.stat, x.from, x.to, x.nature, x.section]));
const kinds = (x.kinds || []).map((k) => [k.ledger, k.kind, k.nature, k.amt]);
ok(J(kinds) === J([["FC TDS 194J XML", "Tax", "FC Prof Fees 194J", -10000], ["FC TDS 194J XML", "Interest", "FC Prof Fees 194J", -150], ["FC TDS 194J XML", "Late Fee", "FC Prof Fees 194J", -200]]),
  "PX1's lines: tax, interest, late fee: " + J(kinds));
ok((x.kinds || []).every((k, i) => k.n === i), "PX1's lines numbered as the entry's lines");

// SP1: a payment on Tally's Stat Payment screen, linked to K1's deduction
const sp = read("SP1"), k1 = read("K1");
const s = (sp && sp.tdsx) || {};
ok(s.stat === "TDS" && s.from === "20261101" && s.to === "20261102" && s.challan === null, "SP1's duty and period, no challan given in Tally: " + J([s.stat, s.from, s.to, s.challan]));
ok(J((s.periods || []).map((p) => [p.ledger, p.name, p.from, p.to, p.nature, p.section, p.status, p.resident, p.form, p.paid])) ===
  J([["FC TDS 194C Keys", "TDS/Q3/2026-27/26Q", "20261202", "20261231", "FC Contract 194C", "194C", "Company", "Resident", "26Q", -2000]]), "SP1's nature detail: " + J(s.periods));
const pr = (s.refs || [])[0] || {}, dr = ((k1 && k1.tdsx && k1.tdsx.refs) || [])[0] || {};
ok((s.refs || []).length === 1 && pr.type === "Agst Ref" && pr.ref === "5XM6JEN801imvm4W" && pr.ledger === "FC TDS 194C Keys" && pr.party === "FC Party Company" && pr.duty === "FC TDS 194C Keys" && pr.paid === -2000,
  "SP1's reference (Agst Ref): " + J(s.refs));
ok(dr.type === "New Ref" && dr.ref === pr.ref && dr.ledger === "FC Party Company" && dr.duty === "FC TDS 194C Keys" && dr.tax === 2000 && dr.nature === "FC Contract 194C",
  "K1's reference (New Ref, the same TAXNAME, its duty ledger): " + J(k1 && k1.tdsx && k1.tdsx.refs));
ok(k1 && k1.tdsx && !k1.tdsx.stat && !k1.tdsx.challan && !(k1.tdsx.kinds || []).length, "K1 is no payment: " + J(k1 && k1.tdsx));

// 2. the full export (the Day Book's form) reads the same
for (const id of ["PX1", "SP1", "K1"]) {
  const a = read(id), b = full(id);
  ok(a && b && J(a.tdsx) === J(b.tdsx), id + ": the full export reads the same tdsx");
  ok(a && b && J(a.tds) === J(b.tds), id + ": the TDS lines read the same");
}

// 3. no fields: no tdsx; a GST sale from 2.4.2's captures
const g = parseDay(fs.readFileSync(path.join(HERE, "..", "bridge-go", "testdata", "gsttype242", "7.1", "obj-S03-stripped.xml"), "utf8")).vouchers[0];
ok(g && g.tdsx === undefined, "a GST sale carries no tdsx");
const plain = parseDay('<VOUCHER REMOTEID="g1" VCHTYPE="Payment"><GUID>g1</GUID><DATE>20261001</DATE><ALLLEDGERENTRIES.LIST><LEDGERNAME>A</LEDGERNAME><AMOUNT>-1</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>B</LEDGERNAME><AMOUNT>1</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>').vouchers[0];
ok(plain && plain.tdsx === undefined, "a plain entry carries no tdsx");

// 4. the challan written on the nature (Tally's Challan Reconciliation): read into that nature's detail
const rec = '<VOUCHER REMOTEID="g2" VCHTYPE="Payment"><GUID>g2</GUID><DATE>20261205</DATE><STATPAYMENTTYPE>TDS</STATPAYMENTTYPE>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>TDS 194C</LEDGERNAME><AMOUNT>-2000.00</AMOUNT><SUMMARYALLOCS.LIST><NAME>TDS/Q3/2026-27/26Q</NAME><TDSNATUREOFPAYMENT>Contract</TDSNATUREOFPAYMENT>' +
  '<TDSSECTIONNO>194C</TDSSECTIONNO><PAIDAMOUNT>-2000.00</PAIDAMOUNT><TAXCHALLANBSRCODE>0510308</TAXCHALLANBSRCODE><TAXBANKCHALLANNUMBER>00042</TAXBANKCHALLANNUMBER><TAXCHALLANDATE>20261207</TAXCHALLANDATE></SUMMARYALLOCS.LIST></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Bank</LEDGERNAME><AMOUNT>2000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>';
const rv = parseDay(rec).vouchers[0];
ok(rv && rv.tdsx && rv.tdsx.periods.length === 1 && J(rv.tdsx.periods[0].challan) === J({bsr: "0510308", no: "00042", date: "20261207", chq: "", chqDate: "", bank: "", branch: ""}),
  "the challan on the nature's detail: " + J(rv && rv.tdsx));

// 5. (review 243 L1) a BSR code typed with a space keeps its seven digits
const sp7 = parseDay(rec.replace("<TAXCHALLANBSRCODE>0510308<", "<TAXCHALLANBSRCODE>05 10308<").replace('REMOTEID="g2"', 'REMOTEID="g3"').replace("<GUID>g2<", "<GUID>g3<")).vouchers[0];
ok(sp7 && sp7.tdsx && sp7.tdsx.periods[0].challan.bsr === "0510308", "a BSR code with a space: " + J(sp7 && sp7.tdsx && sp7.tdsx.periods[0].challan));
// 6. (review 243 L2) a GST stat payment carries no tdsx (even with a line's TYPEOFTAXPAYMENT and a challan)
const gstPay = '<VOUCHER REMOTEID="g4" VCHTYPE="Payment"><GUID>g4</GUID><DATE>20261205</DATE><STATPAYMENTTYPE>GST</STATPAYMENTTYPE><TAXCHALLANBSRCODE>0510308</TAXCHALLANBSRCODE>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><TYPEOFTAXPAYMENT>Tax</TYPEOFTAXPAYMENT><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Bank</LEDGERNAME><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>';
const gp = parseDay(gstPay).vouchers[0];
ok(gp && gp.tdsx === undefined, "a GST stat payment carries no tdsx: " + J(gp && gp.tdsx));
const tcsPay = parseDay(rec.replace("<STATPAYMENTTYPE>TDS<", "<STATPAYMENTTYPE>TCS<").replace('REMOTEID="g2"', 'REMOTEID="g5"').replace("<GUID>g2<", "<GUID>g5<")).vouchers[0];
ok(tcsPay && tcsPay.tdsx && tcsPay.tdsx.stat === "TCS", "a TCS stat payment keeps its tdsx");
console.log(fails ? fails + " FAILED" : "all ok");
process.exit(fails ? 1 : 0);
