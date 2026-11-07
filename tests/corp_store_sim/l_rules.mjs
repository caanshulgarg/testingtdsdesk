// the e-Forms rules after the stage-3 review of 5ac1e8aca..5d1d0ccd1 (eforms.js, rules.js): a new company's years, ADT-1
// only in a year with an appointment, this year's MSME-1 half-year, the kinds of DIR-12 and PAS-3 (made-up profiles)
import { ok, done } from "./harness.mjs";
const E = await import("../../app/src/screens/corp/eforms.js"), R = await import("../../app/src/screens/corp/rules.js");
const row = (p, fy, form) => E.annual(p, fy, []).find((r) => r.form === form) || {};
const base = { cls: "private", incorporated: "2015-05-01", directors: [{ name: "A (made-up)", din: "01234567", kyc: ["2023-24"] }] };
console.log("1. a new company");
const nu = { cls: "private", incorporated: "2026-02-01", directors: [] };
ok(E.agmOf(nu, "2025-26") === null && E.firstFy(nu) === "2026-27", "no AGM before the first year ends; its first FY 2026-27 (incorporated in February: s.2(41))");
console.log("6. ADT-1");
const a0 = row(base, "2025-26", "ADT-1");
ok(a0.ask && /Enter the auditor's term/.test(a0.ask) && !a0.due && a0.status === "not_started", "no term entered: asked, no due date (" + a0.ask + ")");
ok(row({ ...base, auditorTill: "2025-26" }, "2025-26", "ADT-1").due === "2026-10-15", "the term ends at this year's AGM: due 15 days from it");
ok(row({ ...base, auditorTill: "2028-29" }, "2025-26", "ADT-1").status === "not_needed", "the term runs on: not needed");
const di = E.dueItems(base, [], "2026-11-07");
ok(di.some((x) => /^ADT-1/.test(x.title) && x.words === "to enter" && x.tone === "warn") && !di.some((x) => /^ADT-1/.test(x.title) && /late/.test(x.words)), "in the health: to enter, never late");
console.log("3. this year's MSME-1");
ok(di.some((x) => x.title === "MSME-1 · FY 2026-27 H1" && x.due === "2026-10-31" && x.tone === "bad"), "H1 of FY 2026-27 (Apr–Sep, due 31-Oct-2026) listed late on 07-Nov-2026 (" + di.map((x) => x.title).join("; ") + ")");
ok(!di.some((x) => x.title === "MSME-1 · FY 2026-27 H2"), "H2 not yet (the half is not over)");
ok(!E.dueItems(base, [], "2026-09-15").some((x) => /FY 2026-27/.test(x.title)), "in September: nothing of this year yet");
console.log("7. DIR-12 and PAS-3");
const pas = R.EVENT.find((e) => e.form === "PAS-3"), dir = R.EVENT.find((e) => e.form === "DIR-12");
const p1 = E.startEvent(pas, "2026-11-02", "", "private"), p2 = E.startEvent(pas, "2026-11-02", "", "other");
ok(p1.due === "2026-11-17" && p2.due === "2026-12-02" && /s\.42\(8\)/.test(E.kindOf(pas, "private").law) && /rule 12\(1\)/.test(E.kindOf(pas, "other").law), "PAS-3: private placement 15 days (s.42(8)), other 30 days (rule 12(1))");
const d2 = E.startEvent(dir, "2026-11-02", "", "resigned");
ok(d2.due === "2026-12-02" && /rule 15/.test(E.events([d2])[0].law) && /receiving the notice/.test(E.events([d2])[0].law) && /resigned/.test(E.events([d2])[0].what), "DIR-12 resigned: rule 15, 30 days of receiving the notice");
console.log("9. the SRN");
ok(R.srnOk("AB1234567") && R.srnOk("R12345678") && !R.srnOk("12"), "AB1234567 and R12345678 taken");
done();
