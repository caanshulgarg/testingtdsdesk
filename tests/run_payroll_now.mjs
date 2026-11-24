// node tests/run_payroll_now.mjs - "Make the journal now" on the Payroll page (the owner, 23-Nov-2026): a month kept with
// the books made into its payroll journal (or Tally Payroll entry) at once, by the night's own builder, on made-up books:
//   1. the same entry as the night: payrollNow(ym, inp) is what journals(inp) makes for that month (Journal and Tally Payroll)
//   2. the night's rules kept: the running month is made with a plain note (the owner), a later one is not, nor one older than the night looks at, nor one
//      with no salary kept; salary already booked: nothing made; a sheet that does not add up: Needs you, said
//   3. kept in the cloud as the night keeps it (server/assistant-night/paynow.js, a stand-in database): the finding and
//      the entry once; never twice (an entry already there is said and opened); a person's choice on the finding stays;
//      a withdrawn entry made again; nothing in night_runs (tonight's run is not touched)
//   4. (review B2) the running month's entry made now is left alone by tonight's run: the night passes its dedupe to
//      night_apply as one to keep (keepNow: ready or held only, never one approved; the months the night makes itself are
//      the night's own to keep or withdraw). night_apply itself on a real PostgreSQL: tests/run_payroll_now_night.py
import { booksOf, gstOf, nightInput } from "../server/assistant-night/nightinput.js";
import * as J from "../server/_shared/dailyjournals.js";
import { sheetMonth } from "../server/_shared/nightchecks.js";
import { gstRows, head, L, keepFiled } from "./daily2_books.mjs";
import * as PN from "../server/assistant-night/paynow.js";
const { existingNow, applyNow } = PN;

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const PL = { "Salary": "Indirect Expenses", "TDS on Salary 192": "Duties & Taxes", "Professional Tax Payable": "Duties & Taxes", "Salary Payable": "Provisions", "PF Payable": "Duties & Taxes", "ESI Payable": "Duties & Taxes" };
const sheet = [
  { name: "Ravi Kumar", month: "202610", date: "2026-10-31", gross: 50000, tds: 2500, profTax: 200, net: 47300, src: "manual" },
  { name: "Asha Verma", month: "202610", date: "2026-10-31", gross: 30000, tds: 0, profTax: 200, net: 29800, src: "manual" },
];
const pay = (o = {}) => { const rw = gstRows({ ym: "202610", filed: "", extraLedgers: PL, items: [{ key: "salary", item: "", ord: 0, data: o.sheet || sheet, deleted: false }] });
  if (o.co) Object.assign(rw.co, o.co);
  (o.more || []).forEach((x, i) => { const g = "p" + i; rw.heads.push(head(g, x.date, "Journal", "")); x.lines.forEach(([l, a]) => rw.lines.push(L(g, l, a))); });
  return rw; };
function input(rows, today = "20261123", x = {}) {
  keepFiled(rows, today);
  const b = booksOf(rows), gst = gstOf(rows, b, today);
  return nightInput(rows, b, Object.assign({ today, bankRecs: [], inboxRecs: [], entryRecs: [], twob: [], gst, prior: [], jobs: {}, draftRecs: [], payHeads: [] }, x));
}

console.log("1. the same entry as the night");
{
  const inp = input(pay()), night = J.journals(inp), now = J.payrollNow("202610", inp);
  const ne = night.entries.find((e) => e.source === "payroll"), nf = night.findings.find((f) => f.kind === "payroll_due");
  ok(now.kind === "made" && ne && same(now.entry, ne) && same(now.finding, nf), "Journal: the entry and its finding are the night's own, field for field");
  ok(now.entry.voucher.type === "Journal" && now.entry.ready && now.entry.dedupe === "payroll:202610", "Journal: a ready payroll journal for Oct 2026 (payroll:202610)");
  const t = input(pay({ co: { payrollMethod: { value: "tally" } } })), tn = J.journals(t), tw = J.payrollNow("202610", t);
  ok(tw.kind === "made" && same(tw.entry, tn.entries.find((e) => e.source === "payroll")) && tw.entry.voucher.kind === "tallyPayroll", "Tally Payroll: the night's own Tally Payroll entry");
  ok(same(J.payrollMonths("20261123"), ["202605", "202606", "202607", "202608", "202609", "202610"]), "the months the night looks at: the last 6 that have ended");
}
console.log("2. the night's rules");
{
  const nov = J.payrollNow("202611", input(pay({ sheet: sheet.map((r) => Object.assign({}, r, { month: "202611", date: "2026-11-30" })) })));
  // (the owner) the running month may be made now, with a plain note that it is not over; its entry is the night's own
  // builder's, as the night would make it after the month ends from the salary kept now
  const novIn = input(pay({ sheet: sheet.map((r) => Object.assign({}, r, { month: "202611", date: "2026-11-30" })) }));
  const novNight = J.payrollOne("202611", novIn.salary.filter((r) => sheetMonth(r) === "202611"), novIn);
  ok(nov.kind === "made" && nov.running === true && /Nov 2026 isn.t over yet/.test(nov.words) && nov.entry && nov.entry.dedupe === "payroll:202611" && nov.entry.voucher.date === "20261130" && same(nov.entry, novNight.entry), "the running month: made, the night's builder's own entry, with a plain note (" + nov.words + ")");
  const dec = J.payrollNow("202612", input(pay({ sheet: sheet.map((r) => Object.assign({}, r, { month: "202612", date: "2026-12-31" })) })));
  ok(dec.kind === "notyet" && /Dec 2026 hasn.t begun/.test(dec.words) && !dec.entry, "a month after the running one: not made, said (" + dec.words + ")");
  const old = J.payrollNow("202603", input(pay()));
  ok(old.kind === "old" && !old.entry, "older than the 6 months the night looks at: not made (" + old.words + ")");
  const none = J.payrollNow("202609", input(pay()));
  ok(none.kind === "none" && /No salary/.test(none.words), "no salary kept for the month: said (" + none.words + ")");
  const booked = J.payrollNow("202610", input(pay({ more: [{ date: "2026-10-31", lines: [["Salary", -80000], ["Salary Payable", 80000]] }] })));
  ok(booked.kind === "none" && /already in the books/.test(booked.words), "salary already booked for the month: nothing made (" + booked.words + ")");
  const diff = J.payrollNow("202610", input(pay({ more: [{ date: "2026-10-31", lines: [["Salary", -90000], ["Salary Payable", 90000]] }] })));
  ok(diff.kind === "you" && /booked ₹90,000/.test(diff.words) && diff.finding.state === "you" && !diff.entry, "booked for another amount: Needs you, said, never a second journal");
}
console.log("3. kept in the cloud as the night keeps it");
// a stand-in for the cloud's tables (PostgREST paths, the service role)
function cloud(o = {}) {
  const db = { night_findings: (o.findings || []).slice(), night_entries: (o.entries || []).slice(), daily_log: [], night_runs: [] }, calls = [];
  let id = 0;
  const q = (path) => { const [t, qs] = path.replace(/^\/rest\/v1\//, "").split("?"); const p = new URLSearchParams(qs || ""); const f = []; p.forEach((v, k) => { if (/^eq\./.test(v)) f.push([k, v.slice(3)]); }); return { t, f, sel: p.get("select") }; };
  const rest = async (path, _t, init = {}) => {
    const m = (init.method || "GET").toUpperCase(), { t, f } = q(path), body = init.body ? JSON.parse(init.body) : null; calls.push([m, t]);
    if (!db[t]) throw new Error("no table " + t);
    const hit = (r) => f.every(([k, v]) => String(r[k]) === v);
    if (m === "GET") return db[t].filter(hit);
    if (m === "POST") { const rows = [].concat(body).map((r) => Object.assign({ id: "id" + (++id) }, r));
      if (t === "night_entries") { const out = []; rows.forEach((r) => { if (!db[t].some((x) => x.firm_id === r.firm_id && x.client_id === r.client_id && x.dedupe === r.dedupe)) { db[t].push(r); out.push(r); } }); return out; }
      if (t === "night_findings" && rows.some((r) => db[t].some((x) => x.kind === r.kind && x.key === r.key && x.client_id === r.client_id))) throw new Error("duplicate key");
      db[t].push(...rows); return rows; }
    if (m === "PATCH") { const rows = db[t].filter(hit); rows.forEach((r) => Object.assign(r, body)); return rows; }
    throw new Error(m);
  };
  return { db, rest, calls };
}
const F = "11111111-1111-4111-8111-111111111111";
{
  const inp = input(pay()), now = J.payrollNow("202610", inp), c = cloud();
  const a = await applyNow({ rest: c.rest, firm: F, cid: "c1", night: "2026-11-23", by: "u1" }, now);
  ok(a.kind === "made" && c.db.night_entries.length === 1 && c.db.night_entries[0].state === "ready" && c.db.night_entries[0].source === "payroll" && same(c.db.night_entries[0].voucher, now.entry.voucher), "made: one ready entry, the night's voucher");
  const fd = c.db.night_findings.find((x) => x.kind === "payroll_due");
  ok(fd && fd.state === "resolved" && c.db.night_entries[0].finding_id === fd.id && fd.first_seen === "2026-11-23", "its finding kept (resolved), the entry tied to it");
  ok(c.db.night_runs.length === 0 && c.db.daily_log.length === 1 && c.db.daily_log[0].what === "payroll_now", "tonight's run untouched; one line in the log");
  const ex = await existingNow(c.rest, F, "c1", "202610");
  ok(ex && ex.state === "ready" && ex.id === c.db.night_entries[0].id, "made once: the entry there is found (said and opened, never made again)");
  const b = await applyNow({ rest: c.rest, firm: F, cid: "c1", night: "2026-11-23", by: "u1" }, now);
  ok(b.kind === "already" && c.db.night_entries.length === 1, "pressed again (or the night made it first): already there, nothing made twice");
}
{
  const inp = input(pay()), now = J.payrollNow("202610", inp);
  const c = cloud({ findings: [{ id: "f9", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202610", state: "dismissed", decided_by: "u2", evidence: [] }] });
  const a = await applyNow({ rest: c.rest, firm: F, cid: "c1", night: "2026-11-23", by: "u1" }, now);
  ok(a.kind === "kept" && c.db.night_entries.length === 0 && c.db.night_findings[0].state === "dismissed", "a person set the month aside on Daily Check: their choice stays, nothing made");
  const w = cloud({ entries: [{ id: "e5", firm_id: F, client_id: "c1", dedupe: "payroll:202610", state: "withdrawn", decided_by: null, source: "payroll" }] });
  ok((await existingNow(w.rest, F, "c1", "202610")) === null, "a withdrawn entry is not one to open");
  const m = await applyNow({ rest: w.rest, firm: F, cid: "c1", night: "2026-11-23", by: "u1" }, now);
  ok(m.kind === "made" && w.db.night_entries.length === 1 && w.db.night_entries[0].state === "ready" && w.db.night_entries[0].id === "e5", "a withdrawn entry made again in its place (as the night does)");
  const y = J.payrollNow("202610", input(pay({ more: [{ date: "2026-10-31", lines: [["Salary", -90000], ["Salary Payable", 90000]] }] }))), cy = cloud();
  const ya = await applyNow({ rest: cy.rest, firm: F, cid: "c1", night: "2026-11-23", by: "u1" }, y);
  ok(ya.kind === "you" && cy.db.night_entries.length === 0 && cy.db.night_findings[0].state === "you", "Needs you: the finding kept for Daily Check, no entry");
}

console.log("4. tonight's run leaves the running month's entry alone (keepNow)");
{
  ok(typeof PN.keepNow === "function", "keepNow is there for the night");
  if (typeof PN.keepNow === "function") {
    const months = J.payrollMonths("20261124"), E = (ym, state, x = {}) => Object.assign({ id: "e" + ym + state, firm_id: F, client_id: "c1", dedupe: "payroll:" + ym, state, source: "payroll", decided_by: null }, x);
    const c = cloud({ entries: [E("202611", "ready"), E("202610", "ready"), E("202612", "held"), Object.assign(E("202611", "approved"), { dedupe: "payroll:202611x" }), E("202611", "ready", { client_id: "c2", id: "other" }), Object.assign(E("202611", "ready"), { dedupe: "setoff:x:202611", id: "so" })] });
    const k = await PN.keepNow(c.rest, F, "c1", months);
    ok(same(k.map((e) => e.dedupe).sort(), ["payroll:202611", "payroll:202612"]), "kept: the running month's (and a later month's) payroll entry, ready or held; never a month the night makes, another client's or another kind: " + JSON.stringify(k.map((e) => e.dedupe)));
    ok(k.every((e) => !e.finding_key && !e.voucher), "each one only a dedupe to keep: night_apply makes nothing of it");
    const a = cloud({ entries: [E("202611", "approved")] });
    ok((await PN.keepNow(a.rest, F, "c1", months)).length === 0, "an approved one is not passed (night_apply would put an approval back as ready)");
    const bad = async () => { throw new Error("HTTP 500"); };
    let threw = false; try { await PN.keepNow(bad, F, "c1", months); } catch (e) { threw = true; }
    ok(threw, "not read: said (the night stops for the client, never withdraws it unseen)");
  }
}

console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fails ? 1 : 0);
