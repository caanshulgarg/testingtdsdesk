// the re-review of 423e40e74: dueItems for new companies (nothing of years before the first, nor half-years over before
// incorporation), this year's H2 from 1 April only; ADT-1 kept due when the new term is entered before filing
import { ok, done } from "./harness.mjs";
const E = await import("../../app/src/screens/corp/eforms.js"), R = await import("../../app/src/screens/corp/rules.js");
const t = (p, on) => E.dueItems(p, [], on).map((x) => x.title);
const feb = { cls: "private", incorporated: "2026-02-10", directors: [] }, oct = { cls: "private", incorporated: "2026-10-20", directors: [] };
ok(!t(feb, "2026-11-07").some((x) => /FY 2025-26/.test(x)), "incorporated 10-Feb-2026, on 07-Nov-2026: nothing of FY 2025-26 (" + t(feb, "2026-11-07").join("; ") + ")");
ok(t(feb, "2026-11-07").includes("MSME-1 · FY 2026-27 H1"), "its H1 of FY 2026-27 (over on 30-Sep-2026) listed");
ok(!t(oct, "2026-11-07").some((x) => /MSME-1/.test(x)), "incorporated 20-Oct-2026: H1 ended before it, not listed (" + t(oct, "2026-11-07").join("; ") + ")");
ok(!t(feb, "2026-03-20").length, "incorporated 10-Feb-2026, on 20-Mar-2026: nothing yet");
const old = { cls: "private", incorporated: "2015-02-10", auditorTill: "2030-31", directors: [] };
ok(!t(old, "2027-03-31").includes("MSME-1 · FY 2026-27 H2") && t(old, "2027-04-01").includes("MSME-1 · FY 2026-27 H2"), "H2 from 1 April, not on 31 March");
ok(t(old, "2026-10-01").includes("MSME-1 · FY 2026-27 H1") && !t(old, "2026-09-30").includes("MSME-1 · FY 2026-27 H1"), "H1 from 1 October");
const oc = E.annual(oct, "2026-27", []).find((r) => r.ref.endsWith(":H1"));
ok(oc.status === "not_needed" && /before the company was incorporated/.test(oc.reason), "and on the e-Forms page: H1 not needed (" + oc.reason + ")");
console.log("ADT-1 with a new term entered before filing");
const reap = { cls: "private", incorporated: "2015-02-10", agms: { "2025-26": "2026-09-25" }, auditorFrom: "2026-09-25", auditorTill: "2030-31", directors: [] };
const a = E.annual(reap, "2025-26", []).find((r) => r.form === "ADT-1");
ok(R.apptFy(reap) === "2025-26" && a.status === "not_started" && a.due === "2026-10-10", "appointed at the AGM of FY 2025-26 (25-Sep-2026), term to 2030-31: ADT-1 still due 10-Oct-2026 (" + a.status + " " + a.due + ")");
ok(E.annual(reap, "2026-27", []).find((r) => r.form === "ADT-1").status === "not_needed", "the next year: not needed, the term runs");
ok(R.apptFy({ auditorFrom: "2026-09-25" }) === "2025-26" && R.apptFy({}) === "", "no AGM date entered: the year before the date's own");
done();
