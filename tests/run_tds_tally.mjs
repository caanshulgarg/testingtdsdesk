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
ctx.S.companies = { t: { id: "t", name: "FinCom Spike Co", choices: {} } }; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.saveBooks = () => {}; ctx.whoAmI = () => "t"; let uidN = 0; ctx.uid = (p) => (p || "id") + ++uidN; ctx.D = () => ({parties: {}, entries: {}}); if (typeof ctx.money !== "function") ctx.money = (a) => "Rs " + a;
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
  x.BookSrc.apply(b, JSON.parse(JSON.stringify(heads)), JSON.parse(JSON.stringify(lines)), []);   // each book its own copy (the cases change them)
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

// ==== review 243 (round 1): H2, H3, H4, M1, M2, M3, L4, L6
const clone = (v, id, from, to) => Object.assign(JSON.parse(from ? JSON.stringify(v).split(from).join(to) : JSON.stringify(v)), { id });
const vOf = (b, id) => b.vouchers.find((v) => v.id === G[id]);
const upload = () => x.TDSCH.add([{ bsr: "0240020", serial: "00979", date: "20261201", tax: 2000, interest: 0, section: "194C", minorHead: "200" }]);
// H2: another party's deduction with the same reference name is not tagged to SP1's challan
b = books(); b.under["FC Other Party"] = "Sundry Creditors";
b.vouchers.push(clone(vOf(b, "K1"), "K2", "FC Party Company", "FC Other Party")); b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b;
upload(); r = x.TDSTally.sync(b);
ok(b.alloc[k1row] && b.allocFrom[k1row] === "tally" && !b.alloc["K2|FC TDS 194C Keys"], "H2. the same reference on another party: K1 tagged, the other party's deduction not (" + J([b.alloc[k1row], b.alloc["K2|FC TDS 194C Keys"], r.disagree]) + ")");
// H2: two deductions of the same party under the same reference (another year's "1"): neither tagged, listed for a person
b = books(); b.vouchers.push(clone(vOf(b, "K1"), "K1b")); b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b;
upload(); r = x.TDSTally.sync(b);
ok(!b.alloc[k1row] && !b.alloc["K1b|FC TDS 194C Keys"] && r.disagree.length === 2 && r.disagree.every((d) => /2 deductions/.test(d.why || "")), "H2. one reference on two deductions of the party: none tagged, both listed (" + J(r.disagree) + ")");
// H3: the challan number corrected in Tally: the untagged challan follows, never a second one
b = books(); x.TDSTally.sync(b);
vOf(b, "PX1").tdsx.challan.no = "54322"; r = x.TDSTally.sync(b);
let pxs = b.challans.filter((c) => c.fromVoucher === G.PX1);
ok(pxs.length === 1 && pxs[0].serial === "54322", "H3. the number corrected in Tally: one challan, the new number (" + J(pxs.map((c) => c.serial)) + ")");
b.alloc[k1row] = pxs[0].id;
vOf(b, "PX1").tdsx.challan.no = "54323"; r = x.TDSTally.sync(b);
pxs = b.challans.filter((c) => c.fromVoucher === G.PX1);
ok(pxs.length === 1 && pxs[0].serial === "54322" && b.alloc[k1row] === pxs[0].id && r.conflicts.some((c) => c.kind === "challan" && c.what === "details" && /54323/.test(c.tally)),
  "H3. a tagged challan changed in Tally: kept with its tags, the difference listed, no second one (" + J([pxs.map((c) => c.serial), r.conflicts]) + ")");
delete b.alloc[k1row]; vOf(b, "PX1").cancel = true; r = x.TDSTally.sync(b);
ok(!b.challans.some((c) => c.fromVoucher === G.PX1 && c.from === "tally"), "H3. the payment cancelled in Tally: its untagged challan from Tally leaves");
// M1: only the interest and fee lines marked (a blank mark is not kept): the tax is the rest of the TDS paid
b = books(); vOf(b, "PX1").tdsx.kinds = vOf(b, "PX1").tdsx.kinds.filter((k) => k.kind !== "Tax"); x.TDSTally.sync(b);
const pm1 = b.challans.find((c) => c.fromVoucher === G.PX1), pay1 = x.TDS.paymentsFromBooks().find((p) => p.vid === G.PX1);
ok(pm1 && pm1.tax === 10000 && pm1.interest === 150 && pm1.fee === 200 && pay1 && pay1.tax === 10000, "M1. the tax line unmarked: tax 10000, interest 150, fee 200 (" + J([pm1 && [pm1.tax, pm1.interest, pm1.fee], pay1 && pay1.tax]) + ")");
// M2: a person's correction on a challan from Tally stays; the difference listed; Tally's own change goes in where untouched
b = books(); x.TDSTally.sync(b);
let pc = b.challans.find((c) => c.fromVoucher === G.PX1); pc.interest = 175;
r = x.TDSTally.sync(b); pc = b.challans.find((c) => c.fromVoucher === G.PX1);
ok(pc.interest === 175 && r.conflicts.some((c) => c.kind === "challan" && c.what === "interest" && c.tally === 150), "M2. the interest a person corrected stays, the difference listed (" + J(r.conflicts) + ")");
vOf(b, "PX1").tdsx.kinds[0].amt = -9000; vOf(b, "PX1").ent.forEach((e) => { if (e.l === "FC TDS 194J XML" && Math.abs(e.a) === 10000) e.a = Math.sign(e.a) * 9000; });
r = x.TDSTally.sync(b); pc = b.challans.find((c) => c.fromVoucher === G.PX1);
ok(pc.tax === 9000 && pc.interest === 175, "M2. Tally's new tax goes in where nobody changed it (" + J([pc.tax, pc.interest]) + ")");
b.alloc[k1row] = pc.id; b.vouchers.find((v) => v.id === G.K1);
vOf(b, "PX1").tdsx.kinds[0].amt = -1000; vOf(b, "PX1").ent.forEach((e) => { if (e.l === "FC TDS 194J XML" && Math.abs(e.a) === 9000) e.a = Math.sign(e.a) * 1000; });
r = x.TDSTally.sync(b); pc = b.challans.find((c) => c.fromVoucher === G.PX1);
ok(pc.tax === 9000 && r.conflicts.some((c) => c.kind === "challan" && c.what === "tax" && c.tally === 1000), "M2. a tax below what is tagged to the challan is not lowered, listed (" + J([pc.tax, r.conflicts]) + ")");
delete b.alloc[k1row];
// M3: a payment with two challans (per nature): each its own paid amount, the interest and fee by nature
b = books();
let px1 = vOf(b, "PX1"), ch0 = px1.tdsx.challan;
px1.tdsx.challan = null;
px1.tdsx.periods = [{ n: 0, ledger: "FC TDS 194J XML", nature: "FC Prof Fees 194J", section: "194J", paid: -6000, challan: ch0 },
  { n: 0, ledger: "FC TDS 194J XML", nature: "FC Contract 194C", section: "194C", paid: -4000, challan: Object.assign({}, ch0, { no: "54399" }) }];
r = x.TDSTally.sync(b);
const m3a = b.challans.find((c) => c.from === "tally" && c.serial === "54321"), m3b = b.challans.find((c) => c.from === "tally" && c.serial === "54399");
ok(m3a && m3b && m3a.tax === 6000 && m3a.interest === 150 && m3a.fee === 200 && m3b.tax === 4000 && !m3b.interest && !m3b.fee, "M3. two challans: 6000 with interest 150 and fee 200 (its nature), 4000 alone (" + J([m3a && [m3a.tax, m3a.interest, m3a.fee], m3b && [m3b.tax, m3b.interest, m3b.fee]]) + ")");
b = books(); px1 = vOf(b, "PX1"); ch0 = px1.tdsx.challan; px1.tdsx.challan = Object.assign({}, ch0, { no: "54398" });
px1.tdsx.periods = [{ n: 0, ledger: "FC TDS 194J XML", nature: "FC Prof Fees 194J", section: "194J", paid: -6000, challan: ch0 }];
r = x.TDSTally.sync(b);
ok(!b.challans.some((c) => c.from === "tally" && (c.serial === "54398" || !num(c.tax))) && r.bad.some((z) => /54398/.test(z.bad || "")), "M3. a challan whose share is not known is not made: listed for a person (" + J(r.bad) + ")");
// H4: Tally's thresholds only for the same section, never on a monthly limit, and never above FinCom's
const RD = (id) => ctx.RULE_DEFAULTS ? ctx.RULE_DEFAULTS.find((z) => z.id === id) : x.RULE_DEFAULTS.find((z) => z.id === id);
b = books();
ok(x.TDSTally.threshold(["FC Contract Exp"], "20260601", RD("contractor")) && x.TDSTally.threshold(["FC Contract Exp"], "20260601", RD("contractor")).limit === 30000, "H4. 194C's nature on a 194C rule: Tally's 30,000 used");
ok(x.TDSTally.threshold(["FC Contract Exp"], "20260601", RD("professional")) === null, "H4. a 194C nature on a 194J rule: not used");
b.ledTds["FC Contract Exp"].nature = "FC Rent 194I"; b.tdsNat["FC Rent 194I"] = { cats: [["20260401", "194-I", "10", "10", "20", "20", "240000.00", ""]] };
ok(x.TDSTally.threshold(["FC Contract Exp"], "20260601", RD("rent_building")) === null, "H4. a monthly limit: Tally's yearly figure not used");
b.ledTds["FC Contract Exp"].nature = "FC Contract 194C"; b.tdsNat["FC Contract 194C"] = { cats: [["20260401", "194C", "1", "2", "20", "20", "200000.00", "50000.00"]] };
const th = x.TDSTally.threshold(["FC Contract Exp"], "20260601", RD("contractor"));
ok(th === null || (!th.limit && !th.single), "H4. Tally's figures above FinCom's: FinCom's (the stricter) kept (" + J(th) + ")");
b.tdsNat = NAT;
// L4: a person's correction on a certificate from Tally stays, the difference listed
b = books(); x.TDSTally.sync(b);
b.certs.find((c) => c.certNo === "LDC197CERT0001").rate = 2;
r = x.TDSTally.sync(b);
ok(b.certs.find((c) => c.certNo === "LDC197CERT0001").rate === 2 && r.conflicts.some((c) => c.kind === "certificate" && c.what === "rate"), "L4. the certificate's rate a person corrected stays, listed (" + J(r.conflicts) + ")");
// L6: books that are no longer the open company's: nothing done
b = books(); const other2 = Object.assign({}, b); ctx.S.books = other2;
r = x.TDSTally.sync(b);
ok(!b.challans.length && r.skipped, "L6. the company changed during the load: sync does nothing (" + J(r) + ")");
console.log(fails ? fails + " FAILED" : "all ok");
process.exit(fails ? 1 : 0);
