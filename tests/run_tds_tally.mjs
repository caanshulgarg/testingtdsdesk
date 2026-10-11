// node run_tds_tally.mjs - bridge 2.4.3 (the owner's approval of 11-Oct-2026): TDS from Tally in FinCom (TDSTally,
// src/js/72), on Tally's real entries (TallyPrime 7.1, tally-versions run 38155837948: bridge-go/testdata/tdsfields243/7.1,
// the bridge 2.4.3 bodies read by the cloud's parse.js, brought in as the app reads the cloud copy: BookSrc.fromCopy).
// Test data only.
//   1. a payment with its challan in Tally (PX1): a challan "From Tally" with its BSR code, number and date, the tax, the
//      interest and the late fee apart (the FVU's challan record carries them); the payment's tax alone in the books' list
//   2. the deduction Tally links to a payment (SP1 pays K1): tagged to the payment's challan, marked From Tally; a
//      deduction FinCom tags elsewhere is never moved: the disagreement is listed
//   3. the section of a TDS ledger from its nature of payment in Tally, over the one in its name; a person's choice stays
//   4. a certificate Tally keeps: in FinCom's list; one FinCom has under the same number kept, the difference listed; one
//      Tally no longer keeps leaves (only Tally's)
//   5. the threshold of a nature of payment in Tally: used by the limits tracker
//   6. sync again: nothing twice
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { parseDay, cleanName } from "../server/tally-cloud/parse.js";
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { load, HTML } = require("./harness");
const TD = path.join(HERE, "..", "bridge-go", "testdata", "tdsfields243", "7.1");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES",
  "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "BookSrc", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch", "TDSFiled", "TDSTally", "AIH"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const { ctx, x } = load(HTML, NAMES.filter((n) => { try { load(HTML, [n]); return true; } catch (e) { return false; } }));
ctx.S.companies = { t: { id: "t", name: "FinCom Spike Co", choices: {} } }; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.saveBooks = () => {}; ctx.whoAmI = () => "t"; let uidN = 0; ctx.uid = (p) => (p || "id") + ++uidN; ctx.D = () => ({parties: {}, entries: {}});
const J = (o) => JSON.stringify(o);
// the cloud copy's rows, as tally-ingest stores them (parse.js on the bridge's bodies)
const heads = [], lines = [];
for (const id of ["K1", "SP1", "PX1"]) {
  const r = parseDay(fs.readFileSync(path.join(TD, "obj-" + id + "-stripped.xml"), "utf8")), v = r.vouchers[0];
  heads.push({ guid: v.guid, day: v.date, alter_id: v.alter, vtype: v.type, vno: v.no, party: v.party, narration: v.narr, cancelled: false, optional: false, tds_tally: v.tdsx || null, tds_tally_alter_id: v.tdsx ? v.alter : null, id });
  r.lines.forEach((l) => lines.push({ guid: l[0], ledger: cleanName(l[1]), amount: l[2], hsn: l[3], rate: l[4] }));
}
const G = Object.fromEntries(heads.map((h) => [h.id, h.guid]));
const NAT = { "FC Contract 194C": { cats: [["20260401", "194C", "1", "2", "20", "20", "30000.00", ""]] }, "FC Prof Fees 194J": { cats: [["20260401", "194J", "10", "10", "20", "20", "30000.00", ""]] } };
function books(extra) {
  const b = Object.assign({ cid: "t", vouchers: [], meta: { from: "20261101", to: "20261231" }, under: { "FC Party Company": "Sundry Creditors", "FC LDC Party": "Sundry Creditors", "HDFC Bank": "Bank Accounts", "FC Contract Exp": "Indirect Expenses" },
    groups: { "Sundry Creditors": "Primary", "Bank Accounts": "Primary", "Indirect Expenses": "Primary" }, challans: [], alloc: {}, certs: [], pans: { "FC Party Company": "AAACF0001A", "FC LDC Party": "AAACL0005E" }, tdsNat: NAT,
    ledTds: { "FC TDS 194C Keys": { nature: "FC Contract 194C", special: "", ldc: [] }, "FC TDS 194J XML": { nature: "FC Prof Fees 194J", special: "", ldc: [] }, "FC Contract Exp": { nature: "FC Contract 194C", special: "", ldc: [] },
      "FC LDC Party": { nature: "FC Prof Fees 194J", special: "1", ldc: [["FC Prof Fees 194J", "20260401", "20270331", "197", "LDC197CERT0001", "0", "500000.00"]] } } }, extra || {});
  ctx.S.books = b;
  x.BookSrc.apply(b, heads, lines, []);
  b.map = x.Books.mapLedgers(b.vouchers, b.mapSaved || {});
  ctx.S.books = b;
  return b;
}
// ---- 1. the challan of PX1
let b = books();
ok(b.vouchers.length === 3 && b.vouchers.every((v) => v.tdsx), "the three entries came in with Tally's TDS details");
let r = x.TDSTally.sync(b);
const px = b.challans.find((c) => c.fromVoucher === G.PX1);
ok(px && px.from === "tally" && px.bsr === "0510308" && px.serial === "54321" && px.date === "20261231", "1. PX1's challan made From Tally: " + J(px));
ok(px && px.tax === 10000 && px.interest === 150 && px.fee === 200 && px.section === "194J", "1. tax 10000, interest 150, late fee 200, section 194J (Tally's nature): " + J(px && [px.tax, px.interest, px.fee, px.section]));
const pay = x.TDS.paymentsFromBooks().find((p) => p.vid === G.PX1);
ok(pay && pay.tax === 10000 && pay.interest === 150 && pay.fee === 200, "1. the books' TDS payment: the tax alone, interest and fee apart: " + J(pay));
const firm = { tan: "DELF01234E", pan: "AAACF1234A", name: "FinCom Spike Co", deductorType: "C" };
// the FVU's challan record: tag K1 to PX1's challan only for this check (the record needs a deduction)
const k1row = G.K1 + "|FC TDS 194C Keys";
ok(x.TDSCH.rowsAll().some((rw) => rw.id === k1row), "the deduction K1 is a TDS row (" + k1row + ")");
b.alloc[k1row] = px.id;
const f = x.TDS26Q.build("2026-27", "Q3", firm, "26Q");
const cd = String(f.text || "").split("\r\n").map((l) => l.split("^")).find((a) => a[1] === "CD") || [];
ok(cd[9] === "150.00" && cd[10] === "200.00" && cd[13] === "0510308" && cd[15] === "54321", "1. the FVU's challan record: interest 150.00, fee 200.00, BSR, number (" + cd.slice(5, 16).join("^") + ")");
delete b.alloc[k1row];
// ---- 2. SP1 pays K1 (Tally's link): with a challan FinCom has for SP1 (uploaded, matched by date and amount)
x.TDSCH.add([{ bsr: "0240020", serial: "00979", date: "20261201", tax: 2000, interest: 0, section: "194C", minorHead: "200" }]);
const up = b.challans.find((c) => c.bsr === "0240020");
ok(up && up.fromVoucher === G.SP1, "2. the uploaded challan matched to the payment SP1: " + J(up && up.fromVoucher));
r = x.TDSTally.sync(b);
ok(b.alloc[k1row] === up.id && b.allocFrom[k1row] === "tally" && r.tagged === 1, "2. K1 tagged to SP1's challan From Tally (" + J([b.alloc[k1row], b.allocFrom[k1row], r.tagged]) + ")");
// a deduction FinCom tags elsewhere: never moved
b = books();
x.TDSCH.add([{ bsr: "0240020", serial: "00979", date: "20261201", tax: 2000, interest: 0, section: "194C" }, { bsr: "0240020", serial: "00980", date: "20261215", tax: 5000, interest: 0, section: "194C" }]);
const other = b.challans.find((c) => c.serial === "00980");
b.alloc[k1row] = other.id;
r = x.TDSTally.sync(b);
ok(b.alloc[k1row] === other.id && r.disagree.length === 1 && x.TDSTally.disagreements()[0].row === k1row, "2. a deduction FinCom tags to another challan is not moved; the disagreement listed: " + J(r.disagree));
// ---- 3. the section from Tally's nature, over the name; a person's choice stays
b = books({ ledTds: { "FC TDS 194C Keys": { nature: "FC Prof Fees 194J", special: "", ldc: [] } } });
x.TDSTally.sync(b);
ok(b.map["FC TDS 194C Keys"].section === "194J" && /Tally/.test(b.map["FC TDS 194C Keys"].sectionFrom), "3. 'FC TDS 194C Keys' with Tally's nature of 194J: section 194J (" + J(b.map["FC TDS 194C Keys"]) + ")");
b = books({ ledTds: { "FC TDS 194C Keys": { nature: "FC Prof Fees 194J", special: "", ldc: [] } }, mapSaved: { "FC TDS 194C Keys": { kind: "tds_payable", what: "tds_payable", section: "194C", byHand: true, ok: true } } });
x.TDSTally.sync(b);
ok(b.map["FC TDS 194C Keys"].section === "194C", "3. a section a person chose stays (" + b.map["FC TDS 194C Keys"].section + ")");
// ---- 4. certificates
b = books();
r = x.TDSTally.sync(b);
const c1 = b.certs.find((c) => c.certNo === "LDC197CERT0001");
ok(c1 && c1.src === "tally" && c1.party === "FC LDC Party" && c1.pan === "AAACL0005E" && c1.section === "194J" && c1.rate === 0 && c1.limit === 500000 && c1.from === "20260401" && c1.to === "20270331",
  "4. Tally's certificate in FinCom's list: " + J(c1));
r = x.TDSTally.sync(b);
ok(b.certs.filter((c) => c.certNo === "LDC197CERT0001").length === 1 && r.certs === 0, "6. sync again: the certificate not added twice");
b = books({ certs: [{ id: "mine", party: "FC LDC Party", pan: "AAACL0005E", section: "194J", certNo: "ldc197cert0001", rate: 1, limit: 500000, from: "20260401", to: "20270331" }] });
r = x.TDSTally.sync(b);
ok(b.certs.length === 1 && b.certs[0].id === "mine" && b.certs[0].rate === 1 && r.conflicts.some((c) => c.kind === "certificate" && c.what === "rate"), "4. FinCom's own certificate kept, the rate difference listed: " + J(r.conflicts));
b = books(); x.TDSTally.sync(b);
b.ledTds["FC LDC Party"].ldc = [];
x.TDSTally.sync(b);
ok(!b.certs.some((c) => c.src === "tally"), "4. a certificate Tally no longer keeps leaves (only Tally's)");
// ---- 5. the threshold of Tally's nature in the limits tracker (194C: FinCom's rule 30,000 a bill or 1,00,000 a year)
const tv = (id, d, amt) => ({ id, type: "Journal", date: d, no: id, party: "FC Party Company", narr: "", ent: [{ l: "FC Contract Exp", a: -amt }, { l: "FC Party Company", a: amt }], hsn: [] });
b = books();
b.vouchers = [tv("w1", "20260601", 25000), tv("w2", "20260701", 25000)];
b.map = x.Books.mapLedgers(b.vouchers, {});
ctx.S.books = b;
const w = x.TDSWatch.year("2026-27").find((y) => y.party === "FC Party Company");
ok(w && w.over === true && /Tally: FC Contract 194C/.test(w.limitWords) && w.limitFrom === "FC Contract 194C", "5. Tally's yearly threshold of 30,000: 50,000 is over (" + J(w && [w.over, w.limitWords]) + ")");
b.ledTds = {}; ctx.S.books = b;
const w2 = x.TDSWatch.year("2026-27").find((y) => y.party === "FC Party Company");
ok(w2 && w2.over === false, "5. without Tally's nature: FinCom's own limits (50,000 under 1,00,000 a year and no bill over 30,000)");
// ---- 6. sync again: no challan twice
b = books(); x.TDSTally.sync(b); r = x.TDSTally.sync(b);
ok(b.challans.filter((c) => c.from === "tally").length === 1 && r.challans === 0, "6. sync again: PX1's challan not made twice");
console.log(fails ? fails + " FAILED" : "all ok");
process.exit(fails ? 1 : 0);
