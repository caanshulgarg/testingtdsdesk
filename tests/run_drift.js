// node run_drift.js - Tally changed after a GSTR-1 was filed: the filed copy is never replaced, a warning names the
// return and its ARN, and the change waits as an amendment for the next return (and the warning goes once it is filed)
const fs = require("fs"), {load, HTML, CACHE} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "MONTHS", "fmtDate", "STATE_CODES", "Books", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "INR", "GSTF", "GSTV"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
b.map = x.Books.mapLedgers(b.vouchers, {});
ctx.S.books = b;
const G = x.GSTR, A = x.GSTAmend, reg = "07", clone = o => JSON.parse(JSON.stringify(o));
b.meta = Object.assign({}, b.meta, {from: b.meta.from || "20250401", to: b.meta.to || "20260331"});
// June and July filed (downloaded here); June's filing date and ARN are known from the portal's PDF
const jun = G.toJson("202506", reg), jul = G.toJson("202507", reg);
A.keep(clone(jun), "downloaded"); A.keep(clone(jul), "downloaded");
b.gstVault = [{id: "gv1", reg, form: "r1", per: "202506", arn: "AA070625123456X", arnDate: "2025-07-11"}];
ok(A.drift().length === 0, "no warning while the books agree with what was filed");
// an invoice of June changed in Tally after filing
const up = b.vouchers.find(v => G.ym(v.date) === "202506" && x.Books.isSale(v) && !/CREDIT/i.test(v.type) && G.regOf(v) === reg && v.gstin);
up.ent.forEach(e => { e.a = Math.round(e.a * 1.1 * 100) / 100; });
const d = A.drift();
ok(d.length === 1 && d[0].ym === "202506" && d[0].n >= 1, "June is named as a filed return that changed: " + JSON.stringify(d));
ok(d[0] && d[0].next === "202508", "the change goes in the next return not yet filed (August): " + (d[0] && d[0].next));
const line = d[0] ? A.driftLine(d[0]) : "";
ok(/AA070625123456X/.test(line) && /11 Jul 2025/.test(line) && /amendments in Aug/.test(line), "the warning names the ARN, the filing date and August: " + line);
// June downloaded again from the changed books: the filed copy is kept as it was
const kept = JSON.stringify(b.filed[jun.gstin + "|" + jun.fp].json);
A.keep(clone(G.toJson("202506", reg, {plain: true})), "downloaded");
ok(JSON.stringify(b.filed[jun.gstin + "|" + jun.fp].json) === kept, "a filed return is not replaced by a download from the changed books");
// a month with no proof of filing (July: downloaded only, no date or ARN) is still replaced by a newer download
const jul2 = clone(jul); jul2.__mark = 1;
A.keep(jul2, "downloaded");
ok(b.filed[jul.gstin + "|" + jul.fp].json.__mark === 1, "a return downloaded but not known to be filed is replaced by a newer download");
// August is filed with the amendment: June's warning goes
A.keep(clone(G.toJson("202508", reg)), "portal");
ok(!A.drift().some(r => r.ym === "202506"), "once the amendment is filed in August, June's warning goes");
// books that do not hold June whole: no warning for it (not brought in is not changed)
b.meta.from = "20250701";
up.ent.forEach(e => { e.a = Math.round(e.a * 1.2 * 100) / 100; });
ok(!A.drift().some(r => r.ym === "202506"), "a month the books do not hold whole is not warned about");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
