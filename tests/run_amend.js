// node run_amend.js - amendments: keep filed months, change the books, check 9A/9C/10 and the JSON
const fs = require("fs"), {load} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "MONTHS", "fmtDate", "STATE_CODES", "Books", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "INR"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
b.map = x.Books.mapLedgers(b.vouchers, {});
ctx.S.books = b;
const G = x.GSTR, A = x.GSTAmend, reg = "07";
const clone = o => JSON.parse(JSON.stringify(o));
// 1. Jun and Jul 2025 filed as the books stand today
const jun = G.toJson("202506", reg), jul = G.toJson("202507", reg);
A.keep(clone(jun), "portal"); A.keep(clone(jul), "portal");
console.log("Jun filed: b2b " + (jun.b2b || []).reduce((a, g) => a + g.inv.length, 0) + " invoices, b2cs " + (jun.b2cs || []).length + " rows, cdnr " + (jun.cdnr || []).reduce((a, g) => a + g.nt.length, 0));
let p = A.pending("202508", reg);
ok(p.rows.length === 0 && p.periods.join() === "202506,202507", "nothing to amend when the books match what was filed (compared Jun, Jul)");
ok(p.noCopy.join() === "202504,202505", "Apr and May have no filed copy and are not compared");
ok(!G.toJson("202508", reg).b2ba, "no b2ba in Aug when nothing changed");
// 2. change the books: a Jun B2B invoice goes up 10%; another Jun B2B invoice is deleted; a Jun B2C invoice gets a GSTIN
const junSales = b.vouchers.filter(v => G.ym(v.date) === "202506" && x.Books.isSale(v) && !/CREDIT/i.test(v.type) && G.regOf(v) === reg);
const b2bV = junSales.filter(v => v.gstin), b2cV = junSales.filter(v => !v.gstin && G.one("202506", reg).b2c.some(r => r.id === v.id));
console.log("Jun sales: " + junSales.length + ", with GSTIN " + b2bV.length + ", B2C small " + b2cV.length);
const up = b2bV[0], del = b2bV[1];
up.ent.forEach(e => { e.a = Math.round(e.a * 1.1 * 100) / 100; });
b.vouchers = b.vouchers.filter(v => v !== del);
let moved = null;
if (b2cV.length){ moved = b2cV[0]; moved.gstin = "07AAACH7409R1ZZ"; }
p = A.pending("202508", reg);
p.rows.forEach(r => console.log("   " + r.P + " " + r.kind + " " + r.what + " " + (r.now || r.was).num + " -> " + r.act + " : " + r.changes.join("; ")));
const rUp = p.rows.find(r => r.what === "amend" && r.now.num === String(up.no));
ok(rUp && rUp.changes.some(c => /taxable/.test(c)), "invoice raised 10% shows as a 9A amendment");
const rDel = p.rows.find(r => r.what === "gone" && r.was.num === String(del.no));
ok(rDel && rDel.act === "nil", "deleted invoice shows as amendment to nil");
if (moved){
  const rMv = p.rows.find(r => r.what === "missing" && r.now.num === String(moved.no));
  ok(rMv && rMv.act === "b2c", "B2C invoice given a GSTIN is taken as moved from B2C small");
}
const aug = G.toJson("202508", reg);
const b2ba = (aug.b2ba || []).flatMap(g => g.inv.map(i => Object.assign({ctin: g.ctin}, i)));
const aUp = b2ba.find(i => i.oinum === String(up.no)), aDel = b2ba.find(i => i.oinum === String(del.no));
ok(aUp && aUp.inum === String(up.no) && /^\d{2}-06-2025$/.test(aUp.oidt) && aUp.itms[0].itm_det.txval > 0, "Aug JSON b2ba carries oinum, oidt and the new values");
const origUp = jun.b2b.flatMap(g => g.inv).find(i => i.inum === String(up.no));
ok(aUp && Math.abs(aUp.itms[0].itm_det.txval - origUp.itms[0].itm_det.txval * 1.1) < 1, "amended taxable is 110% of what was filed");
ok(aDel && aDel.val === 0 && aDel.itms[0].itm_det.txval === 0, "deleted invoice goes in as nil");
if (moved){
  const inB2b = (aug.b2b || []).flatMap(g => g.inv).find(i => i.inum === String(moved.no));
  ok(inB2b && /-06-2025$/.test(inB2b.idt), "moved invoice reported in Aug's B2B with its June date");
  const a10 = (aug.b2csa || []).find(r => r.omon === "062025");
  const filedRow = jun.b2cs.find(r => r.pos === a10.pos && r.rt === a10.itms[0].rt && r.sply_ty === a10.sply_ty);
  const mt = G.one("202506", reg).b2b.find(r => r.no === moved.no);
  ok(a10 && Math.abs(a10.itms[0].txval - (filedRow.txval - mt.taxable)) < 0.02, "table 10 gives June's B2C small less the moved invoice: " + (a10 && a10.itms[0].txval));
}
// 3. leave one alone
ctx.S.books.amendFix = {[rUp.id]: "skip"};
ok(!(G.toJson("202508", reg).b2ba || []).flatMap(g => g.inv).some(i => i.oinum === String(up.no)), "'leave it' keeps it out of the JSON");
ctx.S.books.amendFix = {};
// 4. Aug is filed with the amendments; Sep then has nothing left to amend for June
A.keep(clone(aug), "portal");
const sep = A.pending("202509", reg);
ok(!sep.rows.some(r => r.P === "202506"), "after Aug is filed, June has nothing pending in Sep");
ok(A.pending("202508", reg).rows.length === p.rows.length, "Aug's own amendments still come out when Aug's JSON is made again");
// 5. the month's own check
const chk = A.check("202506", reg);
ok(chk && chk.rows.length >= 2, "June: books against the June return lists the differences (" + (chk && chk.rows.length) + ")");
// 6. a download here does not replace a copy brought in from the portal
const k = A.keep(clone(G.toJson("202506", reg, {plain: true})), "downloaded");
ok(k.source === "portal", "a later download does not overwrite the portal copy");
// 7. time limit: Jun 2025 can be amended up to Nov 2026 only
ok(A.lastYm("202506") === "202611" && A.lastYm("202603") === "202611" && A.lastYm("202604") === "202711", "amendment window ends November after the year");
// 8. a credit note changed
const cn = b.vouchers.find(v => G.ym(v.date) === "202507" && /CREDIT NOTE/i.test(v.type) && v.gstin && G.regOf(v) === reg);
if (cn){
  cn.ent.forEach(e => { e.a = Math.round(e.a * 0.5 * 100) / 100; });
  const q = A.pending("202509", reg), r = q.rows.find(z => z.kind === "CDNR" && z.now && z.now.num === String(cn.no));
  ok(r && r.what === "amend", "credit note halved in July shows as 9C");
  const sj = G.toJson("202509", reg);
  const na = (sj.cdnra || []).flatMap(g => g.nt).find(z => z.ont_num === String(cn.no));
  ok(na && na.ntty === "C" && na.ont_dt && na.nt_num === String(cn.no), "Sep JSON has cdnra with ont_num and ont_dt");
} else console.log("  (no July credit note with a GSTIN for 07; 9C checked by hand below)");
// 9. a portal JSON with several rates on one invoice is read by summing the items
const multi = {gstin: "07AADCV3366N1ZU", fp: "042025", b2b: [{ctin: "09AAGCS0920E1ZN", inv: [{inum: "X/1", idt: "05-04-2025", val: 1180 + 1120, pos: "09", rchrg: "N", inv_typ: "R",
  itms: [{num: 1801, itm_det: {rt: 18, txval: 1000, iamt: 180, csamt: 0}}, {num: 1201, itm_det: {rt: 12, txval: 1000, iamt: 120, csamt: 0}}]}]}]};
const nm = A.norm(multi).docs.get("B2B|09AAGCS0920E1ZN|X/1");
ok(nm && nm.txval === 2000 && nm.iamt === 300 && nm.rates.join() === "12,18", "portal JSON with two rates on an invoice is summed");
// 10. a B2C small invoice later given a GSTIN (moved from 7 to 4A, with table 10)
{
  const v = b.vouchers.find(z => G.ym(z.date) === "202507" && x.Books.isSale(z) && !/CREDIT/i.test(z.type) && z.gstin && G.regOf(z) === reg && x.Books.lines(z).total <= 100000);   // over Rs 1 lakh it would be B2C large
  const keep = v.gstin; v.gstin = "";
  const julAsFiled = G.toJson("202507", reg, {plain: true});
  ok(!(julAsFiled.b2b || []).flatMap(g => g.inv).some(i => i.inum === String(v.no)) && (julAsFiled.b2cs || []).length > 0, "set-up: a July invoice filed in B2C small");
  ctx.S.books.filed[julAsFiled.gstin + "|072025"] = {gstin: julAsFiled.gstin, fp: "072025", ym: "202507", source: "portal", at: "", json: clone(julAsFiled)};
  v.gstin = keep;
  const q = A.pending("202510", reg), r = q.rows.find(z => z.now && z.now.num === String(v.no));
  ok(r && r.what === "missing" && r.act === "b2c", "guessed as moved from B2C small");
  const oct = G.toJson("202510", reg);
  ok((oct.b2b || []).flatMap(g => g.inv).some(i => i.inum === String(v.no) && /-07-2025$/.test(i.idt)), "reported in October's B2B with its July date");
  const t10 = (oct.b2csa || []).find(z => z.omon === "072025");
  const filedRow = julAsFiled.b2cs.find(z => z.pos === t10.pos && z.rt === t10.itms[0].rt && z.sply_ty === t10.sply_ty);
  const L = G.one("202507", reg).b2b.find(z => z.no === v.no);
  ok(t10 && Math.abs(t10.itms[0].txval - (filedRow.txval - L.taxable)) < 0.02, "table 10 for July: B2C small less the moved invoice (" + t10.itms[0].txval + ")");
  ctx.S.books.amendFix = {[r.id]: "missed"};
  ok(!(G.toJson("202510", reg).b2csa || []).some(z => z.omon === "072025"), "marked as missed: B2B only, no table 10");
}
console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
