// node run_fin_memo.mjs - the Financial statements page's kept statements (app/src/screens/books/fin/util.js built()) are
// worked out again when the books change though their counts do not (review of 22-Nov-2026, track mis-audit): an entry's
// amount changed in place, ledgers regrouped with the same number of ledgers. FinSt.build is a stand-in that counts calls.
// UTIL points at another copy of util.js (the check before the fix: it fails there).
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.UTIL || path.join(here, "..", "app", "src", "screens", "books", "fin", "util.js");
const src = fs.readFileSync(file, "utf8").replace(/^import .*$/gm, "");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
let calls = 0;
Object.assign(globalThis, { S: { firm: {} }, CO: () => ({ name: "Made-up Co" }), FinSt: { build: () => ({ n: ++calls }) }, BOOKS_REV: 1, fmtDate: (x) => x, tallyDate: (x) => x, render() {} });
const { built } = await import("data:text/javascript," + encodeURIComponent(src));
const b = { cid: "t", vouchers: [{ id: "v1", date: "20250601", ent: [{ l: "Rent", a: -10000 }, { l: "Made-up Bank", a: 10000 }] }], under: { "Rent": "Indirect Expenses", "Supp A": "Sundry Creditors" }, msme: {}, fs: {}, tb: { at: "x", from: "20250401" } };
const d1 = built(b, "2025", 1, 2, null);
ok(built(b, "2025", 1, 2, null) === d1 && calls === 1, "the same books: kept, worked out once");
// a correction saved: the amount changes in place, the count does not (saveBooks moves BOOKS_REV)
b.vouchers[0].ent[0].a = -12000; b.vouchers[0].ent[1].a = 12000; globalThis.BOOKS_REV++;
ok(built(b, "2025", 1, 2, null) !== d1 && calls === 2, "an entry's amount changed and saved: worked out again");
// a ledger moved to another group, the same number of ledgers
const d2 = built(b, "2025", 1, 2, null);
b.under = Object.assign({}, b.under, { "Supp A": "Sundry Debtors" }); globalThis.BOOKS_REV++;
ok(built(b, "2025", 1, 2, null) !== d2 && calls === 3, "a ledger regrouped with the same count: worked out again");
// another client's books with the same counts
const other = JSON.parse(JSON.stringify(b));
ok(built(other, "2025", 1, 2, null) !== built(b, "2025", 1, 2, null), "another books object: not the kept one");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
