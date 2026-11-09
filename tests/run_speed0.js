// node run_speed0.js - next-speed0 (09-Nov-2026): two answers that were worked out again at every ask, on books of 40,000
// entries (the speed plan's items 1 and 3):
//   1. Audit.mastersIn (src/js/06) counted every ledger name at each ask; TDS.billParty asks once per entry (84 s of the
//      first open of a 40,000-entry book with 6,787 ledgers);
//   2. M2B.fyNow (src/js/85) asked GSTR.months, which reads every entry's date, at each ask; GST2B.run asks it (through
//      M2B.aiSig) every time it is called (10.4 s of the GST input register's 13.1 s).
// Both are kept now. This test holds the answers to what they were:
//   A. Audit.mastersIn against the old line, step by step: no masters, an empty list, a name added in place, the list
//      replaced, another client's books and back, every name removed and saved;
//   B. M2B.fyNow and M2B.aiSig against the old line, step by step: a month chosen, none chosen, no books, no entries,
//      entries added in place, the list replaced, another client and back, a date changed and saved;
//   C. whole answers on a small and a large made-up book, old and new: TDS.billParty of every entry, TDS.allRowsNow,
//      Audit.run's findings, GST2B.run's result;
//   D. speed, with wide bounds: 40,000 entries and 10,000 ledgers.
// Made-up books only (seeded; no client's name or figure).
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const vm = require("vm"), {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSSep", "TDSTally", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday", "BOOKS_REV", "M2B"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.saveBooks = () => {}; ctx.whoAmI = () => "t"; ctx.S.data = {};
const J = JSON.stringify, S = ctx.S, A = x.Audit, M = x.M2B;
const saved = () => vm.runInContext("BOOKS_REV++", ctx);          // what saveBooks does to the kept figures
// the two lines as they were before next-speed0 (origin/staging-next d176bace8), run in the app's own context
const OLD_IN = vm.runInContext("(function(){ return Object.keys(S.books.under || {}).length > 0; })", ctx);
const OLD_FY = vm.runInContext('(function(){ const ms = (typeof GSTR === "object" && GSTR.months) ? GSTR.months() : []; return this.fyOf(S.gstYm || ms[ms.length - 1] || new Date().toISOString().slice(0, 7).replace("-", "")); })', ctx);
const NEW_IN = A.mastersIn, NEW_FY = M.fyNow;
const useOld = () => { A.mastersIn = OLD_IN; M.fyNow = OLD_FY; }, useNew = () => { A.mastersIn = NEW_IN; M.fyNow = NEW_FY; };
ok(!/Object\.keys\(S\.books\.under \|\| \{\}\)\.length > 0; \}$/.test(String(NEW_IN)) && /_in/.test(String(NEW_IN)), "the build under test keeps Audit.mastersIn's answer");
ok(/lastYm/.test(String(NEW_FY)), "the build under test keeps M2B.fyNow's last month");

// ---------------------------------------------------------------- the made-up books
function rng(seed){ let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const r2 = n => Math.round(n * 100) / 100, pad = (n, w) => String(n).padStart(w, "0");
const GSTIN = "07AAGCL4827M1Z3";
// nV entries over the months from `first` (yyyymm, `span` of them), nL ledgers. A third are bills booked as journals with
// no party (TDS.billParty decides their deductee), a third purchases with input tax, the rest sales and bank payments.
function makeBooks(nV, nL, seed, first, span){
  const R = rng(seed), under = {}, pans = {}, gstins = {}, V = [];
  const nSup = Math.max(3, Math.floor(nL * 0.5)), nCus = Math.max(3, Math.floor(nL * 0.3)), nExp = Math.max(4, nL - nSup - nCus - 8);
  const sup = [], cus = [], exp = [], KIND = ["Freight Charges", "Professional Fees", "Rent Paid", "Repair and Maintenance", "Office Upkeep", "Commission Paid"];
  for (let i = 0; i < nSup; i++){ const n = "Made Up Supplier " + pad(i + 1, 5); sup.push(n); under[n] = "Sundry Creditors"; if (i % 3) pans[n] = "AAAC" + String.fromCharCode(65 + i % 26) + pad(i % 10000, 4) + "K"; if (i % 4 === 0) gstins[n] = "07AAAC" + String.fromCharCode(65 + i % 26) + pad(i % 10000, 4) + "K1Z" + (i % 9); }
  for (let i = 0; i < nCus; i++){ const n = "Made Up Customer " + pad(i + 1, 5); cus.push(n); under[n] = "Sundry Debtors"; }
  for (let i = 0; i < nExp; i++){ const n = KIND[i % KIND.length] + " " + pad(i + 1, 4); exp.push(n); under[n] = i % 5 === 4 ? "Direct Expenses" : "Indirect Expenses"; }
  Object.assign(under, {"Made Up Bank Current": "Bank Accounts", "Cash": "Cash-in-Hand", "Sales Goods 18%": "Sales Accounts", "Purchase Goods 18%": "Purchase Accounts",
    "Input IGST 18%": "Duties & Taxes", "Output IGST 18%": "Duties & Taxes", "TDS Payable 194C": "Duties & Taxes", "Round Off": "Indirect Expenses"});
  const ymAt = k => { const y = +String(first).slice(0, 4), m = +String(first).slice(4, 6) - 1 + k; return (y + Math.floor(m / 12)) + pad(m % 12 + 1, 2); };
  for (let i = 0; i < nV; i++){
    const date = ymAt(Math.floor(i * span / nV)) + pad(1 + Math.floor(R() * 28), 2), amt = r2(500 + Math.floor(R() * 90000) + Math.floor(R() * 100) / 100), kind = i % 6;
    const v = {id: "s" + seed + "-" + (i + 1), no: String(i + 1), ref: "", party: "", narr: "", date, upd: date, alt: i + 1};
    if (kind < 2){                                  // a bill booked as a journal, no party named
      const e = exp[Math.floor(R() * exp.length)], s = sup[Math.floor(R() * sup.length)];
      Object.assign(v, {type: "Journal", ref: "J/" + i, ent: [{l: e, a: -amt}, {l: s, a: amt}]});
      if (i % 12 === 0){ const t = r2(amt * 0.02); v.ent = [{l: e, a: -amt}, {l: s, a: r2(amt - t)}, {l: "TDS Payable 194C", a: t}]; }
    } else if (kind < 4){                           // a purchase with input tax
      const s = sup[Math.floor(R() * sup.length)], tax = r2(amt * 0.18);
      Object.assign(v, {type: "Purchase", party: s, ref: "B/" + pad(i, 6), ent: [{l: "Purchase Goods 18%", a: -amt}, {l: "Input IGST 18%", a: -tax}, {l: s, a: r2(amt + tax)}]});
    } else if (kind === 4){                         // a sale
      const c = cus[Math.floor(R() * cus.length)], tax = r2(amt * 0.18);
      Object.assign(v, {type: "Sales", party: c, ent: [{l: c, a: -r2(amt + tax)}, {l: "Sales Goods 18%", a: amt}, {l: "Output IGST 18%", a: tax}]});
    } else {                                        // paid by bank
      const s = sup[Math.floor(R() * sup.length)];
      Object.assign(v, {type: "Payment", party: s, ent: [{l: s, a: -amt}, {l: "Made Up Bank Current", a: amt}]});
    }
    V.push(v);
  }
  const b = {cid: "c" + seed, vouchers: V, under, pans, gstins, groups: {}, states: {}, challans: [], alloc: {}, twoBs: {}};
  b.map = x.Books.mapLedgers(V, {});
  return b;
}
const CO_OF = seed => ({name: "Made Up Trading Company " + seed, gstin: GSTIN, choices: {}});
function open(b, seed){ S.books = b; S.coId = "c" + seed; S.companies = {["c" + seed]: CO_OF(seed)}; ctx.CO = () => S.companies[S.coId]; try { x.LedMaster.refresh(b); } catch (e){} }

// ---------------------------------------------------------------- A. Audit.mastersIn, step by step
{
  const both = w => { const o = OLD_IN.call(A), n = NEW_IN.call(A), n2 = NEW_IN.call(A); ok(o === n && n === n2, "A. " + w + ": " + n + " (was " + o + ")"); return n; };
  S.books = {cid: "a1", vouchers: []}; ok(both("no list of groups") === false, "A. no masters: no");
  S.books.under = {}; ok(both("an empty list") === false, "A. an empty list: no");
  S.books.under["Made Up Supplier 00001"] = "Sundry Creditors"; ok(both("a name added in place, asked at once") === true, "A. masters read in a moment ago are seen");
  for (let i = 0; i < 50; i++) S.books.under["Made Up Ledger " + i] = "Indirect Expenses"; both("fifty more names");
  const first = S.books;
  S.books = {cid: "a2", vouchers: [], under: {}}; ok(both("another client's books, no masters") === false, "A. another client's books do not get the first client's answer");
  S.books = first; ok(both("back to the first client") === true, "A. back: yes");
  S.books.under = {}; ok(both("the list replaced by an empty one") === false, "A. the list replaced: no");
  S.books.under = {"Made Up Bank Current": "Bank Accounts"}; both("the list replaced by a full one");
  Object.keys(S.books.under).forEach(k => { delete S.books.under[k]; }); saved(); ok(both("every name removed and the books saved") === false, "A. emptied and saved: no");
  S.books.under["Cash"] = "Cash-in-Hand"; saved(); both("a name again, saved");
  S.books = {cid: "a3", vouchers: [], under: null}; both("a null list");
  S.books = {cid: "a4", vouchers: [], under: "ab"}; both("a list that is no object");
  S.books = {cid: "a5", vouchers: [], under: []}; both("an empty array");
  let eo = "", en = ""; S.books = null; try { OLD_IN.call(A); } catch (e){ eo = e.constructor.name; } try { NEW_IN.call(A); } catch (e){ en = e.constructor.name; }
  ok(eo === en && eo, "A. no books open: the same error as before (" + en + ")");
}

// ---------------------------------------------------------------- B. M2B.fyNow and aiSig, step by step
{
  const REG = "07";
  const both = w => { const o = OLD_FY.call(M); const n = NEW_FY.call(M), n2 = NEW_FY.call(M); ok(o === n && n === n2, "B. " + w + ": " + n + " (was " + o + ")"); return n; };
  const b1 = makeBooks(60, 30, 11, 202504, 9); open(b1, 11);                 // Apr to Dec 2025
  S.gstYm = "202406"; ok(both("a month chosen") === "2024-25", "B. the chosen month's year");
  S.gstYm = ""; ok(both("no month chosen: the books' last month") === "2025-26", "B. Dec 2025 is in 2025-26");
  b1.vouchers.push({id: "late", no: "L1", date: "20260415", type: "Journal", party: "", ent: [{l: "Rent Paid 0003", a: -100}, {l: "Made Up Supplier 00001", a: 100}]});
  ok(both("an entry of Apr 2026 added in place, asked at once") === "2026-27", "B. an entry added in place moves the year");
  b1.vouchers.pop(); ok(both("it is removed again") === "2025-26", "B. removed: back");
  b1.vouchers[b1.vouchers.length - 1].date = "20270105"; saved(); ok(both("the last entry's date changed and the books saved") === "2026-27", "B. a date changed and saved is seen");
  b1.vouchers[10].date = "20280405"; saved(); ok(both("an entry in the middle changed and the books saved") === "2028-29", "B. a middle entry changed and saved is seen");
  const keep = b1.vouchers; b1.vouchers = keep.filter(v => v.date < "20260101"); ok(both("the list of entries replaced") === "2025-26", "B. a new list is read again");
  const b2 = makeBooks(60, 30, 12, 202304, 6); open(b2, 12); ok(both("another client (Apr to Sep 2023)") === "2023-24", "B. another client does not get the first client's year");
  open(b1, 11); ok(both("back to the first client") === "2025-26", "B. back: its own year");
  // the same books object under another client id (never in the app; the key holds the client all the same)
  S.coId = "other"; both("the same books, another client id"); S.coId = "c11";
  const nb = {cid: "c13", vouchers: [], gstins: {}, under: {}}; open(nb, 13); both("books with no entries, a GSTIN: the months from today's date");
  nb.vouchers = [{id: "u1", no: "1", date: "", type: "Journal", party: "", ent: []}]; both("one entry with no date");
  nb.vouchers.push({id: "u2", no: "2", date: "20240710", type: "Journal", party: "", ent: []}); ok(both("a dated entry added in place") === "2024-25", "B. the first dated entry is seen at once");
  S.books = null; both("no books open");
  // aiSig: the run of the year, found by the same key
  open(b1, 11); S.gstYm = "";
  M.st[M.key(REG, "2025-26")] = {run: {id: "r1", at: "2025-12-31T10:00:00Z", result: {rows: [{id: 1}, {id: 2}]}, decisions: {a: "accept"}}};
  M.st[M.key(REG, "2026-27")] = {run: {id: "r2", at: "2026-04-30T10:00:00Z", result: {rows: []}, decisions: {}}};
  const sig = w => { useOld(); const o = M.aiSig(REG); useNew(); const n = M.aiSig(REG); ok(o === n, "B. aiSig, " + w + ": " + J(n)); return n; };
  ok(/^r1:/.test(sig("the books' year")), "B. aiSig names the run of 2025-26");
  S.gstYm = "202605"; ok(/^r2:/.test(sig("a month of 2026-27 chosen")), "B. aiSig names the run of the chosen month's year");
  S.gstYm = "202405"; ok(sig("a year with no run") === "", "B. no run: empty");
  S.gstYm = ""; M.st = {};
}

// ---------------------------------------------------------------- C. whole answers, old and new, on a small and a large book
function answers(b, seed, withAudit){
  open(b, seed); S.gstYm = "";
  const out = {};
  out.masters = A.mastersIn();
  out.billParty = b.vouchers.map(v => x.TDS.billParty(v));
  try { out.tdsRows = J(x.TDS.allRowsNow()); } catch (e){ out.tdsRows = "error: " + e.message; }
  out.fy = M.fyNow(); out.sig = M.aiSig("07");
  try { const r = x.GST2B.run("07"); out.twoB = J([r.pairs, r.only2b, r.onlyBooks].map(l => l && l.length)) + "|" + J(r.onlyBooks && r.onlyBooks.slice(0, 200)); } catch (e){ out.twoB = "error: " + e.message; }
  // the audit keeps its last run on the books (what is new since); each run here starts with none kept
  if (withAudit){ b.audit = null; try { const r = A.run("20250401", "20260331", "t"); out.audit = J(r.findings) + J(r.notes); } catch (e){ out.audit = "error: " + e.message; } }
  return out;
}
function compare(name, b, seed, withAudit){
  x.GST2B._memo = null; useOld(); let t = Date.now(); const o = answers(b, seed, withAudit), tOld = Date.now() - t;
  x.GST2B._memo = null; useNew(); t = Date.now(); const n = answers(b, seed, withAudit), tNew = Date.now() - t;
  const named = n.billParty.filter(Boolean).length;
  Object.keys(o).forEach(k => ok(J(o[k]) === J(n[k]), "C. " + name + ": " + k + " the same, old and new" + (k === "billParty" ? " (" + named + " of " + n.billParty.length + " entries given a deductee)" : k === "tdsRows" ? " (" + n.tdsRows.length + " characters)" : k === "audit" ? " (" + n.audit.length + " characters)" : k === "twoB" ? " (" + n.twoB.slice(0, 40) + ")" : " (" + J(n[k]).slice(0, 40) + ")")));
  ok(named > 0 && !/^error/.test(n.tdsRows) && n.tdsRows.length > 2, "C. " + name + ": the answers are real ones (deductees found, TDS rows made)");
  if (withAudit) ok(!/^error/.test(n.audit), "C. " + name + ": the audit ran" + (/^error/.test(n.audit) ? " (" + n.audit + ")" : ""));
  console.log("       " + name + ": old " + tOld + " ms, new " + tNew + " ms");
  return n;
}
{
  const small = makeBooks(240, 60, 21, 202504, 12), large = makeBooks(6000, 2500, 22, 202504, 12);
  compare("small book (240 entries, 60 ledgers)", small, 21, true);
  compare("middle book (1,500 entries, 600 ledgers)", makeBooks(1500, 600, 24, 202504, 12), 24, true);
  compare("large book (6,000 entries, 2,500 ledgers), without the audit's own checks", large, 22, false);
  // no masters read: ledgers known by name only (mastersIn false all the way)
  const bare = makeBooks(240, 60, 23, 202504, 12); bare.under = {};
  const n = compare("small book, no masters", bare, 23, true); ok(n.masters === false, "C. no masters: said so");
}

// ---------------------------------------------------------------- D. speed, with wide bounds
{
  useNew();
  const big = makeBooks(40000, 10000, 31, 202504, 12); open(big, 31); S.gstYm = "";
  let t = Date.now(), c = 0; for (let i = 0; i < 40000; i++) c += A.mastersIn() ? 1 : 0; const tIn = Date.now() - t;
  ok(c === 40000 && tIn < 1500, "D. Audit.mastersIn asked 40,000 times on 10,000 ledgers: " + tIn + " ms (under 1,500)");
  t = Date.now(); let o1 = 0; for (let i = 0; i < 40; i++) o1 += OLD_IN.call(A) ? 1 : 0; const per = (Date.now() - t) / 40;
  console.log("       the old line: " + per.toFixed(2) + " ms an ask, so " + Math.round(per * 40) + " s for 40,000");
  t = Date.now(); const bp = big.vouchers.map(v => x.TDS.billParty(v)); const tBp = Date.now() - t;
  ok(bp.filter(Boolean).length > 10000 && tBp < 15000, "D. TDS.billParty of 40,000 entries: " + tBp + " ms (under 15,000), " + bp.filter(Boolean).length + " given a deductee");
  M.st[M.key("07", M.fyNow())] = {run: {id: "r", at: "t", result: {rows: []}, decisions: {}}};
  t = Date.now(); let s = ""; for (let i = 0; i < 2000; i++) s = M.aiSig("07"); const tSig = Date.now() - t;
  ok(s === "r:t:0:2" && tSig < 1500, "D. M2B.aiSig asked 2,000 times on 40,000 entries: " + tSig + " ms (under 1,500)");
  t = Date.now(); for (let i = 0; i < 20; i++) OLD_FY.call(M); const perFy = (Date.now() - t) / 20;
  console.log("       the old line: " + perFy.toFixed(2) + " ms an ask, so " + Math.round(perFy * 2000) + " ms for 2,000");
  M.st = {};
}
console.log(fails ? "FAILED: " + fails : "all passed");
process.exit(fails ? 1 : 0);
