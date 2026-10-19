// node run_parse_tds_rows.mjs - round 86 (19-Oct-2026, the owner: "this is coming again and again"): the TDS rows the cloud
// reads from Tally's entries (server/tally-cloud/parse.js) are the TDS Tally booked, once per entry, deductee and nature:
//  - the TDS is the sum of Tally's <TAX> only; a TDS block without one gives TDS null (never the ledger line's own amount:
//    a rent expense of 14,240 was shown as TDS 14,240);
//  - EXEMPTED Yes is exempt only when no tax was booked: real TallyPrime 7.1 writes it on a line that deducted 2,000 on
//    1,00,000 (bridge-go/testdata/real-tally-7.1/231/s5-tds-on-screen.daybook.xml), which is not exempt, rate 2 worked out;
//  - one row per entry + deductee + nature: the line carrying the assessable amount wins; the TDS ledger / party lines that
//    only echo the tax (no assessable amount) are dropped.
// Written before the code.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata", "real-tally-7.1", "231");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = JSON.stringify;
const ALL = fs.readFileSync(path.join(TD, "s5-tds-on-screen.daybook.xml"), "utf8");
const MARK = "<!-- the voucher collection of MasterID 3 -->";
const DAYBOOK = ALL.slice(0, ALL.indexOf(MARK)), COLL = ALL.slice(ALL.indexOf(MARK) + MARK.length);
const vchOf = (t) => t.slice(t.indexOf("<VOUCHER REMOTEID"), t.lastIndexOf("</VOUCHER>") + 10);
const V = vchOf(COLL);
const tdsOf = (x) => ((parseDay(x).vouchers[0] || {}).tds) || [];
const BLOCK = (V.match(/<TAXOBJECTALLOCATIONS\.LIST>\s*<TDSCHALLANDATE[\s\S]*?<\/TAXOBJECTALLOCATIONS\.LIST>/) || [""])[0];
ok(BLOCK.includes("<TAX>2000.00</TAX>") && BLOCK.includes("<ASSESSABLEAMOUNT>100000.00</ASSESSABLEAMOUNT>"), "the capture's TDS block: tax 2000 on 100000");

// ---- 1. the real capture as Tally wrote it (EXEMPTED Yes, TAX 2000 on 100000): not exempt, rate 2 worked out
for (const [how, x] of [["Tally's Day Book export", DAYBOOK], ["the collection with every field", COLL], ["the voucher element alone", V]]) {
  const t = tdsOf(x);
  ok(t.length === 1 && t[0].tax === 2000 && t[0].base === 100000 && t[0].rate === 2 && t[0].rateWorkedOut === true && !("exempt" in t[0]),
    "real capture, " + how + ": TDS 2000 on 100000 is not exempt, rate 2 worked out (" + J(t) + ")");
  ok(!t.some((r) => r.exempt && r.tax > 0), "real capture, " + how + ": no row exempt with tax booked");
}

// ---- 2. a TDS block without <TAX>: TDS null, never the line's own amount
{
  const noTax = V.replace("<TAX>2000.00</TAX>", "<TAX/>");
  const t = tdsOf(noTax);
  ok(t.length === 1 && t[0].tax === null, "no TAX in the TDS block: TDS null, not the line's amount (" + J(t) + ")");
  ok(t.length === 1 && t[0].exempt === true && !("rateWorkedOut" in t[0]), "no TAX and EXEMPTED Yes: exempt, rate as stored (" + J(t) + ")");
  const noTaxNoEx = noTax.replace("<EXEMPTED>Yes</EXEMPTED>", "<EXEMPTED>No</EXEMPTED>");
  const u = tdsOf(noTaxNoEx);
  ok(u.length === 1 && u[0].tax === null && !("exempt" in u[0]), "no TAX, not marked exempt: TDS null, not exempt (" + J(u) + ")");
}

// ---- 3. EXEMPTED Yes with a stored rate and tax booked: not exempt; the stored rate kept
{
  const stored = V.replace("<TAXRATE>0</TAXRATE>", "<TAXRATE>2</TAXRATE>");
  const t = tdsOf(stored);
  ok(t.length === 1 && t[0].rate === 2 && !("exempt" in t[0]) && !("rateWorkedOut" in t[0]), "EXEMPTED Yes, stored rate 2, tax 2000: rate 2, not exempt (" + J(t) + ")");
}

// ---- 4. one entry, the expense line carrying the assessable amount and the TDS ledger + party lines echoing the tax: one row
{
  // the TDS list on each of the three lines in order (Contract Exp n 0, TDS Payable n 1, Contractor n 2); "" leaves it empty
  const EMPTY = /<TAXOBJECTALLOCATIONS\.LIST>\s*<\/TAXOBJECTALLOCATIONS\.LIST>/g;
  const put = (b0, b1, b2) => { let k = 0; return V.replace(BLOCK, b2 || "<TAXOBJECTALLOCATIONS.LIST> </TAXOBJECTALLOCATIONS.LIST>").replace(EMPTY, (m) => { const b = [b0, b1][k++]; return b || m; }); };
  const echo = BLOCK.replace("<ASSESSABLEAMOUNT>100000.00</ASSESSABLEAMOUNT>", "<ASSESSABLEAMOUNT/>");
  const x = put(BLOCK, echo, echo);
  ok((x.match(/<TDSCHALLANDATE/g) || []).length === 3, "made up from the capture: the TDS block on all three lines (expense with the assessable amount, TDS ledger and party echoing)");
  const t = tdsOf(x);
  ok(t.length === 1, "expense + TDS ledger + party lines of one entry: one TDS row (" + J(t) + ")");
  ok(t.length === 1 && t[0].ledger === "S231 Contract Exp" && t[0].n === 0 && t[0].base === 100000 && t[0].tax === 2000 && t[0].rate === 2,
    "the row is the expense line's, with the assessable amount (" + J(t[0]) + ")");
  ok(J(parseDay(x).lines) === J(parseDay(V).lines), "the ledger lines read as before");
  // the same figures on the expense and party lines, both with the assessable amount: one row
  const u = tdsOf(put(BLOCK, "", BLOCK));
  ok(u.length === 1 && u[0].tax === 2000 && u[0].base === 100000, "the same figures on the expense and party lines: one row (" + J(u) + ")");
  // another nature of the same deductee on another line: its own row
  const w = tdsOf(put(BLOCK.replace("<CATEGORY>S231 Contract Work</CATEGORY>", "<CATEGORY>S231 Professional</CATEGORY>"), "", BLOCK));
  ok(w.length === 2 && new Set(w.map((r) => r.nature)).size === 2, "another nature on another line: two rows (" + J(w.map((r) => r.nature)) + ")");
  // only echo lines (no assessable anywhere): one row
  const e = tdsOf(put("", echo, echo));
  ok(e.length === 1 && e[0].tax === 2000, "two echo lines without assessable: one row (" + J(e) + ")");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
