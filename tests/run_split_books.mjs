// node run_split_books.mjs - next-split-years (migration 161; app/src/lib/splitBooks.js): a SPLIT Tally, the same business
// cut into two Tally companies on 31-Mar-2025, joined into ONE client's books, gives the same figures as one company
// holding every year. Made-up books: FY 2021-22 to 2025-26, cash, capital, a debtor, sales, rent; the earlier company
// holds up to 31-Mar-2025 (and one entry of April that the current company holds too: an overlap), the current one from
// 1-Apr-2025, its openings as Tally carries them (income and expenses into Profit & Loss A/c); both companies' entries
// share GUIDs (one company GUID), and the earlier company spells a ledger differently ("debtor  a"). Checks, with the
// real legacy code (Audit.balances, MIS.moves, TDSMatch-free):
//   1. joined: every ledger's balance at each year end and mid-year, each year's movements, the number of entries: the
//      same as the one company; no entry twice; the openings check says Matched
//   2. differs: the current company's opening of one ledger off by 1,000: "Differs by ₹1,000 in 1 ledger"; the years up
//      to 31-Mar-2025 as the earlier company has them, from 1-Apr-2025 the current company's own openings (as it alone)
//   3. unlinked (unjoin): the books are the current company's alone again, exactly
//   4. a client with one company: Audit.balances as before (no step), the same figures
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { load, HTML } = require("./harness");
const { ctx, x } = load(HTML, ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "INR", "Books", "LedMaster", "Audit", "MIS", "TallyRead"]);
Object.assign(globalThis, { num: x.num, r2: x.r2, ledKey: ctx.ledKey || x.ledKey, TallyRead: x.TallyRead });
if (!globalThis.ledKey) globalThis.ledKey = (n) => require("vm").runInContext("ledKey", ctx)(n);
const SB = await import("../app/src/lib/splitBooks.js");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const r2 = x.r2, clone = (o) => JSON.parse(JSON.stringify(o));

const under = { "Cash": "Cash-in-Hand", "Capital": "Capital Account", "Debtor A": "Sundry Debtors", "Sales": "Sales Accounts", "Rent": "Indirect Expenses", "Profit & Loss A/c": "" };
const groups = { "Cash-in-Hand": "Current Assets", "Current Assets": "", "Capital Account": "", "Sundry Debtors": "Current Assets", "Sales Accounts": "", "Indirect Expenses": "" };
const open0 = { "Cash": -100000, "Capital": 100000, "Debtor A": 0, "Sales": 0, "Rent": 0, "Profit & Loss A/c": 0 };
// the entries of one company holding every year (a debit negative, as Tally gives them)
const all = []; let n = 0;
const V = (date, ent, id) => all.push({ id: id || "g-" + (++n), date, type: "Journal", no: String(n), party: "", narr: "", ent: ent.map(([l, a]) => ({ l, a })) });
for (let y = 2021; y <= 2025; y++) {
  [["0415", 40000], ["0920", 55000], ["0110", 30000]].forEach(([md, amt], i) => { const d = (md < "04" ? y + 1 : y) + md; V(d, [["Cash", -amt], ["Sales", amt]]); });
  V(y + "0601", [["Rent", -12000 - y], ["Cash", 12000 + y]]);
  V((y + 1) + "0331", [["Debtor A", -(7000 + y)], ["Sales", 7000 + y]]);
  V(y + "0501", [["Cash", -(5000 + y)], ["Debtor A", 5000 + y]]);
}
V("20250402", [["Rent", -999], ["Cash", 999]]);
all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const tbOf = (from, opens) => ({ from, to: "20260331", at: "2026-04-30T10:00:00Z", src: "copy", led: Object.fromEntries(Object.entries(opens).map(([l, o]) => [l, { open: o, close: 0, parent: under[l] }])) });
const books = (vs, tb) => ({ cid: "t", vouchers: clone(vs), under: clone(under), groups: clone(groups), tb, meta: {}, map: {} });
const one = books(all, tbOf("20210401", open0));
// the earlier company: up to 31-Mar-2025, plus the overlap day of April; a ledger spelt otherwise
const earlyV = all.filter((v) => v.date <= "20250331" || v.date === "20250402").map((v) => Object.assign(clone(v), { ent: v.ent.map((e) => ({ l: e.l === "Debtor A" ? "debtor  a" : e.l, a: e.a })) }));
const eb = { vouchers: earlyV, tb: tbOf("20210401", Object.fromEntries(Object.entries(open0).map(([l, o]) => [l === "Debtor A" ? "debtor  a" : l, o]))), under: Object.fromEntries(Object.entries(under).map(([l, p]) => [l === "Debtor A" ? "debtor  a" : l, p])), groups: clone(groups), meta: {} };
// the current company: from 1-Apr-2025, its own GUIDs counted again from 1 (the same ids as the earlier company's)
let m = 0;
const curV = all.filter((v) => v.date >= "20250401").map((v) => Object.assign(clone(v), { id: "g-" + (++m) }));
const close = {}; Object.entries(open0).forEach(([l, o]) => { close[l] = o; });
all.filter((v) => v.date <= "20250331").forEach((v) => v.ent.forEach((e) => { close[e.l] = r2((close[e.l] || 0) + e.a); }));
const carriedOpen = Object.assign({}, close); carriedOpen["Profit & Loss A/c"] = r2(close["Profit & Loss A/c"] + close.Sales + close.Rent); carriedOpen.Sales = 0; carriedOpen.Rent = 0;
const SP = { book: "early-book", company: "ZZ (from 1-Apr-2021)", ends: "20250331", curFrom: "20250401", curCompany: "ZZ (from 1-Apr-25)" };
const nominal = (b) => (l) => { const s = new Set(x.TallyRead.NOMINAL.map((g) => g.toLowerCase())); return s.has(String(x.TallyRead.primaryOf(b, l) || "").toLowerCase()); };
const figures = (b, from = "20210401") => {
  ctx.S.books = b;
  const B = x.Audit.balances(from, "20260331"), out = {};
  ok(B.ok, "balances known (" + (B.why || B.src) + ")");
  ["20220331", "20230331", "20240331", "20250331", "20250401", "20250630", "20260331"].filter((d) => d >= from).forEach((d) => { const at = B.at(d); out["bal " + d] = Object.keys(at).sort().filter((l) => Math.abs(at[l]) >= 0.005).map((l) => l + "=" + r2(at[l])).join(", "); });
  for (let y = Number(from.slice(0, 4)); y <= 2025; y++) { const mv = x.MIS.moves(y + "0401", (y + 1) + "0331"); out["moves " + y] = Object.keys(mv).sort().filter((l) => mv[l] && Math.abs(mv[l].t) >= 0.005).map((l) => l + "=" + r2(mv[l].t)).join(", "); }
  out.entries = b.vouchers.filter((v) => !v.opt && !v.cancel).length;
  return out;
};
const same = (a, b, what) => Object.keys(a).forEach((k) => ok(a[k] === b[k], what + " " + k + (a[k] === b[k] ? "" : ": " + b[k] + " (one company: " + a[k] + ")")));

console.log("\n1. joined: the same figures as one company holding every year");
const want = figures(books(all, tbOf("20210401", open0)));
const cur = books(curV, tbOf("20250401", carriedOpen));
const r = SB.join(cur, clone(eb), SP, { nominal: nominal(cur) });
ok(r && r.check.matched && SB.checkWords(r.check) === "Matched", "the openings check: " + SB.checkWords(r && r.check));
same(want, figures(cur), "joined");
const ids = cur.vouchers.map((v) => v.id);
ok(new Set(ids).size === ids.length && ids.filter((i) => i.startsWith("early:")).length === all.filter((v) => v.date <= "20250331").length, "no entry twice (the shared GUIDs kept apart; the April overlap taken from the current company alone)");
ok(cur.vouchers.every((v) => v.ent.every((e) => e.l !== "debtor  a")) && cur.tb.led["Debtor A"] && !cur.tb.led["debtor  a"], "\"debtor  a\" of the earlier company is the current company's Debtor A (ledKey)");
ok(cur.vouchers.every((v, i) => !i || cur.vouchers[i - 1].date <= v.date), "the entries in date order");
const again = SB.join(cur, SB.earlyBack(cur), SP, { nominal: nominal(cur) });
same(want, figures(cur), "joined again (the earlier books back from the joined ones)");
ok(again.n === r.n, "the same earlier entries again (" + again.n + ")");

console.log("\n2. the openings differ: shown, and the current company's openings stand from its first day");
const off = Object.assign({}, carriedOpen, { "Debtor A": r2(carriedOpen["Debtor A"] - 1000), "Capital": r2(carriedOpen.Capital + 1000) });
const cur2 = books(curV, tbOf("20250401", off));
const alone2 = figures(books(curV, tbOf("20250401", off)), "20250401");
const r2_ = SB.join(cur2, clone(eb), SP, { nominal: nominal(cur2) });
ok(!r2_.check.matched && SB.checkWords(r2_.check) === "Differs by ₹2,000 in 2 ledgers", "said: " + SB.checkWords(r2_.check));
ok(r2_.check.list.map((l) => l[0] + ":" + l[3]).sort().join(",") === "Capital:1000,Debtor A:-1000", "each ledger with its difference: " + JSON.stringify(r2_.check.list));
const f2 = figures(cur2);
["bal 20220331", "bal 20230331", "bal 20240331", "bal 20250331", "moves 2021", "moves 2022", "moves 2023", "moves 2024"].forEach((k) => ok(f2[k] === want[k], "up to 31-Mar-2025 as the earlier company: " + k));
ctx.S.books = cur2; const B2 = x.Audit.balances("20250401", "20260331"); ctx.S.books = books(curV, tbOf("20250401", off)); const A2 = x.Audit.balances("20250401", "20260331");
["20250401", "20250630", "20260331"].forEach((d) => { const j = B2.at(d), a = A2.at(d); ["Cash", "Capital", "Debtor A"].forEach((l) => ok(r2(j[l] || 0) === r2(a[l] || 0), "from 1-Apr-2025 the current company's own: " + l + " on " + d + " " + j[l] + " / " + a[l])); });
ok(f2["moves 2025"] === alone2["moves 2025"], "FY 2025-26's movements: the current company's");

console.log("\n3. the earlier company unlinked: the current company alone again");
const solo = books(curV, tbOf("20250401", carriedOpen)), soloF = figures(solo, "20250401");
ok(SB.unjoin(cur) && !cur.meta.split && !cur.tb.split && !cur.tb.step, "undone");
same(soloF, figures(cur, "20250401"), "unlinked");
ok(cur.vouchers.length === curV.length && cur.vouchers.every((v) => !SB.isEarly(v)), "only the current company's entries");

console.log("\n4. a client with one company: as before");
const plain = books(all, tbOf("20210401", open0));
ok(!plain.tb.step, "no step");
same(want, figures(plain), "one company");

console.log(fails ? "\n" + fails + " failure(s)" : "\nall ok");
process.exit(fails ? 1 : 0);
