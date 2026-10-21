// node run_fsx_check_guard.js - FSX.check (src/js/78-reports.js) never throws (Sentry FINCOM-APP-STAGING-2).
// A firm with no partners given yet has a plain two-column capital / current account note (no "Current Year" /
// "Previous Year" rows, no 8th column): check 3 read .c[7] of the fallback total row and threw "Cannot read properties of
// undefined", taking the whole screen down. A missing row or column now means "can't check": a soft note (a warning, the
// check marked skipped), never a crash, and the other checks still run. Test data only.
const F = require("./reports_fixtures"), X = F.loadFSX();
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const build = fx => X.run(Object.assign({}, fx, {mapStore: F.confirmed(X, fx)}));
const tryIt = (what, f) => { try { return f(); } catch (e){ ok(false, what + ": threw " + e.message); return null; } };
const all27 = cs => cs && cs.length === 27 && cs.every((c, i) => c.id === i + 1);

// 1. the Sentry case: a firm whose partners are not given yet
{ const fx = F.firm(); fx.det.partners = [];
  const r = tryIt("a firm with no partners", () => build(fx));
  if (r){
    ok(all27(r.checks), "a firm with no partners: X.run gives all 27 checks, no throw");
    const c3 = r.checks.find(c => c.id === 3), c10 = r.checks.find(c => c.id === 10);
    ok(c3 && !c3.items.some(x => /undefined/.test(x)), "check 3 on the plain capital note: no crash (" + (c3.ok ? "OK" : c3.level + ": " + c3.items[0]) + ")");
    ok(c10 && !c10.ok && /partners/.test(c10.items.join(" ")), "check 10 still says the partners are not given");
  } }

// 2. the capital / current note without its "Current Year" / "Previous Year" rows and fewer columns
{ const r = build(F.firm());
  ["capital", "current"].forEach(k => { const t = r.model.notes.find(n => n.key === k).tables[0];
    t.rows = t.rows.filter(x => x.k !== "t").map(x => Object.assign({}, x, {c: x.c.slice(0, 4)})).concat([{k: "t", t: "Total", c: [{v: 1}, {v: 2}]}]); });
  const cs = tryIt("short capital note", () => X.check(r.model));
  ok(all27(cs), "capital and current notes with 4 columns and only a 2-column Total: all 27 checks, no throw");
  const c3 = cs && cs.find(c => c.id === 3), c10 = cs && cs.find(c => c.id === 10);
  ok(c3 && c3.items.some(x => /could not be checked/i.test(x)), "check 3 says the note could not be checked (" + (c3 && c3.items[0]) + ")");
  ok(c10 && c10.items.some(x => /could not be checked/i.test(x)), "check 10 says the partners' rows could not be checked (" + (c10 && c10.items[0]) + ")");
  ok(cs && cs.every(c => c.items.every(x => !/Cannot read|undefined/.test(x))), "no raw error text in any check"); }

// 3. a fixed asset register table with short rows (check 5 read q.c[7] / r.c[4])
{ const r = build(F.company()), ppe = r.model.notes.find(n => n.key === "ppe");
  const py = ppe && ppe.tables.find(t => t.far === "py");
  if (py) py.rows = py.rows.map(x => x.k === "r" ? Object.assign({}, x, {c: x.c.slice(0, 3)}) : x);
  const cs = tryIt("short register rows", () => X.check(r.model));
  ok(!!py && all27(cs), "the previous year's register rows cut to 3 columns: all 27 checks, no throw");
  const c5 = cs && cs.find(c => c.id === 5);
  ok(c5 && c5.items.some(x => /could not be checked/i.test(x)), "check 5 says the register could not be checked (" + (c5 && c5.items[0]) + ")"); }

// 4. any other check whose table is not as expected is skipped with a note, the rest still run
{ const r = build(F.company()), eps = r.model.notes.find(n => n.key === "eps");
  if (eps) eps.tables[0].rows = [];
  const cs = tryIt("empty EPS table", () => X.check(r.model));
  ok(!!eps && all27(cs), "an EPS note with no rows: all 27 checks, no throw");
  const c15 = cs && cs.find(c => c.id === 15);
  ok(c15 && !c15.ok && c15.level === "warn" && c15.skipped && /could not be checked/i.test(c15.items[0]), "check 15 is skipped as a warning, not a failure (" + (c15 && c15.items[0]) + ")");
  ok(cs && cs.filter(c => c.id !== 15).every(c => c.ok), "the other 26 checks still pass"); }

// 5. the clean books are untouched
{ const a = build(F.company()), b = build(F.firm());
  ok(a.checks.every(c => c.ok && !c.skipped) && b.checks.every(c => c.ok && !c.skipped), "the clean company and firm still pass all 27, none skipped"); }

console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
