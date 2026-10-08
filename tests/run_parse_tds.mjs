// node run_parse_tds.mjs - the owner's decision of 07-Oct-2026 (option A): the entry request asks for every field of the
// TDS list and its sub-list (ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, .SUBCATEGORYALLOCATION.*), and the cloud's reader
// (server/tally-cloud/parse.js) takes the TDS detail from the Income Tax sub-category, working the rate out as tax divided
// by assessable amount (x 100) where Tally stores 0, marked rateWorkedOut: true.
// On the REAL capture of run 37492981527 (S5, a journal with TDS entered on Tally's screen, MasterID 3, 1-Jan-2027):
// bridge-go/testdata/real-tally-7.1/231/s5-tds-on-screen.daybook.xml holds Tally's own Day Book export of the day, then the
// harness's voucher collection of the entry with every field. The Contractor line carries nature "S231 Contract Work",
// Income Tax at TAXRATE 0 on 100000.00 assessable, tax 2000.00, and three empty sub-blocks (Surcharge, Education Cess,
// Secondary Education Cess). Written before the code.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata", "real-tally-7.1", "231");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = JSON.stringify;
const read = (f) => fs.readFileSync(path.join(TD, f), "utf8");
const ALL = read("s5-tds-on-screen.daybook.xml");
const MARK = "<!-- the voucher collection of MasterID 3 -->";
const DAYBOOK = ALL.slice(0, ALL.indexOf(MARK)), COLL = ALL.slice(ALL.indexOf(MARK) + MARK.length);
const vchOf = (t) => t.slice(t.indexOf("<VOUCHER REMOTEID"), t.lastIndexOf("</VOUCHER>") + 10);
const noTds = (t) => t.replace(/<TAXOBJECTALLOCATIONS\.LIST>[\s\S]*?<\/TAXOBJECTALLOCATIONS\.LIST>/g, "<TAXOBJECTALLOCATIONS.LIST>      </TAXOBJECTALLOCATIONS.LIST>");
const WANT = {n: 2, ledger: "S231 Contractor", nature: "S231 Contract Work", party: "S231 Contractor", rate: 2, base: 100000, tax: 2000, rateWorkedOut: true};
const pick = (t) => t && Object.fromEntries(Object.keys(WANT).map((k) => [k, t[k]]));

// ---- 1. the Contractor line, from Tally's Day Book export and from the collection with every field: the TDS detail of
// the Day Book, the rate worked out (2000 / 100000 x 100 = 2) and marked so
for (const [how, x] of [["Tally's Day Book export", DAYBOOK], ["the collection with every field", COLL], ["the voucher element alone", vchOf(COLL)]]) {
  const r = parseDay(x), v = r.vouchers[0] || {};
  ok(r.vouchers.length === 1 && Math.abs(r.lines.reduce((a, l) => a + l[2], 0)) < 0.005, how + ": one entry, adds to zero");
  ok((v.tds || []).length === 1, how + ": one TDS detail, on the Contractor line only (" + J(v.tds) + ")");
  ok(J(pick((v.tds || [])[0])) === J(WANT), how + ": " + J(WANT) + (J(pick((v.tds || [])[0])) === J(WANT) ? "" : " -- got " + J((v.tds || [])[0])));
  ok(J(v.checks || []) === "[]", how + ": no accuracy note (" + J(v.checks) + ")");
  // ---- 2. lines without TDS are unchanged: everything but the TDS details reads as with the TDS lists emptied
  const bare = parseDay(noTds(x)), bv = bare.vouchers[0] || {};
  ok(J(bare.lines) === J(r.lines) && J({...bv, tds: null}) === J({...v, tds: null}) && J(bv.tds) === "[]",
    how + ": the ledger lines and every other detail read as without the TDS block");
}
// the Day Book and the collection agree (the proof's comparison)
const dTds = parseDay(DAYBOOK).vouchers[0].tds, cTds = parseDay(COLL).vouchers[0].tds;
ok(J(dTds) === J(cTds), "the Day Book's TDS detail and the collection's are the same: " + J(dTds));

// ---- 3. the empty Surcharge / Cess sub-blocks are ignored, wherever they stand: the rate, base and tax are the Income
// Tax sub-category's
{
  const v = vchOf(COLL);
  const subs = v.match(/<SUBCATEGORYALLOCATION\.LIST>[\s\S]*?<\/SUBCATEGORYALLOCATION\.LIST>/g);
  ok(subs.length === 4 && /Income Tax/.test(subs[0]), "the capture holds four sub-blocks, Income Tax first");
  const swapped = v.replace(subs.join("\n       "), [subs[1], subs[2], subs[3], subs[0]].join("\n       "));
  ok(swapped !== v && J(pick(parseDay(swapped).vouchers[0].tds[0])) === J(WANT), "Income Tax last, after the empty cess heads: the same detail (" + J(parseDay(swapped).vouchers[0].tds[0]) + ")");
  // a stored rate is taken as it is, not marked worked out
  const stored = v.replace(subs[0], subs[0].replace("<TAXRATE>0</TAXRATE>", "<TAXRATE>2</TAXRATE>"));
  const st = parseDay(stored).vouchers[0].tds[0] || {};
  ok(st.rate === 2 && !("rateWorkedOut" in st), "Tally's stored rate 2: rate 2, not marked worked out (" + J(st) + ")");
  // nothing to work it from: the rate stays as stored (0), not marked
  const noBase = v.replace(subs[0], subs[0].replace("<ASSESSABLEAMOUNT>100000.00</ASSESSABLEAMOUNT>", "<ASSESSABLEAMOUNT/>"));
  const nb = parseDay(noBase).vouchers[0].tds[0] || {};
  ok(nb.rate === 0 && !("rateWorkedOut" in nb), "no assessable amount: rate 0 as stored, not worked out (" + J(nb) + ")");
}

// ---- 4. the entry request's fetch (bridge-go/recorder_live.go) carries the whole block: the voucher cut down to the
// fetched fields (a list's ".*" fetches every field of that list) reads the same TDS detail; 2.3.1's request came back with
// empty lists (s5-tds-on-screen.entry.xml: no TDS detail)
{
  const goSrc = fs.readFileSync(path.join(HERE, "..", "bridge-go", "recorder_live.go"), "utf8");
  const strs = (code) => (code.replace(/\/\/[^\n]*/g, "").match(/"[^"]*"/g) || []).map((x) => x.slice(1, -1)).join("");
  const block = goSrc.slice(goSrc.indexOf("\tliveFetchField222 = "), goSrc.indexOf("\n)", goSrc.indexOf("\tliveFetchField222 = ")));
  const FETCH = strs(block.slice(0, block.indexOf("\tliveFetchField = "))) + strs(block.slice(block.indexOf("\tliveFetchField = ") + "\tliveFetchField = liveFetchField222".length));
  ok(FETCH.includes(", ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*"), "the fetch asks for the TDS list and its sub-list whole");
  const want = new Set(FETCH.split(", "));
  const tok = /<(\/?)([A-Za-z0-9.:_]+)([^>]*?)(\/?)>([^<]*)/g, root = {kids: []}, stack = [root];
  const v = vchOf(COLL);
  let m;
  while ((m = tok.exec(v))) {
    const top = stack[stack.length - 1];
    if (m[1] === "/") { if (stack.length > 1) stack.pop(); continue; }
    if (m[4] === "/") { top.kids.push({name: m[2], open: "<" + m[2] + m[3] + "/>", kids: [], self: true}); continue; }
    const n = {name: m[2], open: "<" + m[2] + m[3] + ">", text: m[5], kids: []};
    top.kids.push(n); stack.push(n);
  }
  const emit = (n, p0) => {
    const p = (p0 ? p0 + "." : "") + n.name.replace(/\.LIST$/, "");
    if (!n.kids.length && !/\.LIST$/.test(n.name)) return want.has(p) || (p0 && want.has(p0 + ".*")) ? (n.self ? n.open : n.open + n.text + "</" + n.name + ">") : "";
    const inner = n.kids.map((k) => emit(k, p)).join("");
    return inner ? n.open + inner + "</" + n.name + ">" : "";
  };
  const cut = root.kids[0].open + root.kids[0].kids.map((k) => emit(k, "")).join("") + "</VOUCHER>";
  const got = parseDay(cut).vouchers[0] || {};
  ok(J(got.tds) === J(cTds), "the body as the request fetches it: the same TDS detail (" + J(got.tds) + ")");
  ok(J(parseDay(read("s5-tds-on-screen.entry.xml")).vouchers[0].tds) === "[]", "2.3.1's request on real Tally: the TDS lists came back empty (no detail)");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
