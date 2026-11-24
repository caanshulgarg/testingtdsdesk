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
//   5. (re-review blocker) the running month's entry made now can be approved today: the second check at Approve
//      (again.js recheck) makes the running month the way payrollNow does, so the same entry passes (Journal and Tally
//      Payroll); the salary changed since it was made: refused, made again in the cloud (review 3)
//   6. (re-review 1) Make now again on the running month, after its salary was replaced: the ready or held entry takes the
//      new figures (the same row, by its dedupe, never a second one); an approved one never changes; a month that has
//      ended is the night's to update tonight; new figures that need a person: the old entry is taken back
//   7. (re-review 2) tonight's run also leaves the running month's open finding (Needs you) alone: keepNow passes it back
//      as it is, with the ledger picks it waits on; never one a person decided, the night's own months, or one the night
//      passes itself
//   8. (review 3) Make now with the month set aside or undone on Daily Check: kept, the running month's open entry taken
//      back (withdrawn); nothing to make for the running month: withdrawNow takes its open entry back (never an approved
//      one); Approve on a stale running-month entry: payroll_now called for that month, "Updated to the salary kept now;
//      check and approve." (nothing posted), the server's own words for none and Needs you; never "Changed since last
//      night"; a month that has ended: as before
import { booksOf, gstOf, nightInput } from "../server/assistant-night/nightinput.js";
import * as J from "../server/_shared/dailyjournals.js";
import { sheetMonth } from "../server/_shared/nightchecks.js";
import { gstRows, head, L, keepFiled } from "./daily2_books.mjs";
import * as PN from "../server/assistant-night/paynow.js";
const { existingNow, applyNow } = PN;

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// keepNow: {entries, findings} (re-review 2); an array (before): its entries only
const ents = (k) => (Array.isArray(k) ? k : (k && k.entries) || []);
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
    const k = ents(await PN.keepNow(c.rest, F, "c1", months));
    ok(same(k.map((e) => e.dedupe).sort(), ["payroll:202611", "payroll:202612"]), "kept: the running month's (and a later month's) payroll entry, ready or held; never a month the night makes, another client's or another kind: " + JSON.stringify(k.map((e) => e.dedupe)));
    ok(k.every((e) => !e.finding_key && !e.voucher), "each one only a dedupe to keep: night_apply makes nothing of it");
    const a = cloud({ entries: [E("202611", "approved")] });
    ok(ents(await PN.keepNow(a.rest, F, "c1", months)).length === 0 && !Array.isArray(await PN.keepNow(a.rest, F, "c1", months)), "an approved one is not passed (night_apply would put an approval back as ready)");
    const bad = async () => { throw new Error("HTTP 500"); };
    let threw = false; try { await PN.keepNow(bad, F, "c1", months); } catch (e) { threw = true; }
    ok(threw, "not read: said (the night stops for the client, never withdraws it unseen)");
  }
}

console.log("5. the running month's entry made now passes the second check at Approve (again.js recheck)");
const E3 = await import("../server/_shared/gst3b.js");
const { recheck, CHANGED } = await import("../app/src/screens/daily/again.js");
const NOV = (o = {}) => sheet.map((r, i) => Object.assign({}, r, { month: "202611", date: "2026-11-30" }, i === 0 ? o : {}));
// the browser at Approve: the same rows opened as books (S.books), the app's own GSTR / GSTF
async function atApprove(rows, e, today, x = {}) {
  const b = booksOf(JSON.parse(JSON.stringify(Object.assign({}, rows, { made: undefined }))));
  Object.assign(globalThis, { S: { books: b, coId: "c1", companies: { c1: rows.co } }, CO: () => rows.co, GSTR: E3.GSTR, GSTF: E3.GSTF, GSTSet: E3.GSTSet, Books: E3.Books, ledGroupPath: E3.ledGroupPath });
  try { return await recheck(Object.assign({ client_id: "c1" }, e), Object.assign({ today, ledgers: rows.ledgers.map((l) => l.name), drafts: [], prior: [], bookId: "b1", jobs: {} }, x)); }
  finally { ["S", "CO", "GSTR", "GSTF", "GSTSet", "Books", "ledGroupPath"].forEach((k) => delete globalThis[k]); }
}
for (const [kind, co] of [["Journal", null], ["Tally Payroll", { payrollMethod: { value: "tally" } }]]) {
  const T = "20261124", rows = pay(Object.assign({ sheet: NOV() }, co ? { co } : {})), now = J.payrollNow("202611", input(rows, T));
  ok(now.kind === "made" && now.running && now.entry.ready, kind + ": the running month made now (ready)");
  const e = Object.assign({ id: "e1", state: "ready" }, now.entry);
  ok(await atApprove(pay(Object.assign({ sheet: NOV() }, co ? { co } : {})), e, T) === "", kind + ": Approve today: the second check makes the running month as payrollNow does: the same entry, goes on");
  const stale = pay(Object.assign({ sheet: NOV({ gross: 51000, net: 48300 }) }, co ? { co } : {}));
  // (review 3) refused, nothing posted, but never "Changed since last night": made again in the cloud from the salary kept now
  const made = []; const said = await atApprove(stale, e, T, { payrollNow: async (cid, ym) => { made.push(ym); return { ok: true, kind: "updated", id: "e1", state: "ready" }; } });
  ok(said === "Updated to the salary kept now; check and approve." && same(made, ["202611"]), kind + ": the kept salary changed after it was made: refused, made again from the salary kept now (" + said + ")");
  const oct = J.payrollNow("202610", input(pay(co ? { co } : {}), T));
  ok(await atApprove(pay(co ? { co } : {}), Object.assign({ id: "e2", state: "ready" }, oct.entry), T) === "", kind + ": a month that has ended: as before (the night's own builder), goes on");
}

console.log("6. Make now again on the running month (its salary replaced)");
{
  const T = "20261124", ctx = (c) => ({ rest: c.rest, firm: F, cid: "c1", night: "2026-11-24", by: "u1" });
  const first = J.payrollNow("202611", input(pay({ sheet: NOV() }), T)), c = cloud();
  ok((await applyNow(ctx(c), first)).kind === "made", "made for Nov 2026 (the running month)");
  const id0 = c.db.night_entries[0].id;
  const again = J.payrollNow("202611", input(pay({ sheet: NOV({ gross: 51000, net: 48300 }) }), T));
  const u = await applyNow(ctx(c), again);
  ok(u.kind === "updated" && u.id === id0 && c.db.night_entries.length === 1 && same(c.db.night_entries[0].voucher, again.entry.voucher) && c.db.night_entries[0].state === "ready", "made again after the salary was replaced: the same entry takes the new figures (" + u.kind + "), never a second one");
  ok(c.db.daily_log.some((l) => l.what === "payroll_now" && l.evidence.kind === "updated"), "logged: updated");
  ok((await applyNow(ctx(c), again)).kind === "already" && c.db.night_entries.length === 1, "pressed again with the same figures: already made, nothing changed");
  c.db.night_entries[0].state = "held";
  ok((await applyNow(ctx(c), first)).kind === "updated" && same(c.db.night_entries[0].voucher, first.entry.voucher) && c.db.night_entries[0].state === "ready", "a held one takes the new figures too");
  c.db.night_entries[0].state = "approved"; c.db.night_entries[0].decided_by = "u2";
  const ap = await applyNow(ctx(c), again);
  ok(ap.kind === "already" && ap.state === "approved" && same(c.db.night_entries[0].voucher, first.entry.voucher), "an approved one is never changed: already made and approved");
  c.db.night_entries[0].state = "approving";
  ok((await applyNow(ctx(c), again)).kind === "already" && same(c.db.night_entries[0].voucher, first.entry.voucher), "one being approved: never changed");
  // a month that has ended: tonight's run updates it (the button says it is made)
  const o1 = J.payrollNow("202610", input(pay(), T)), co = cloud();
  await applyNow(ctx(co), o1);
  const o2 = J.payrollNow("202610", input(pay({ sheet: sheet.map((r, i) => i ? r : Object.assign({}, r, { gross: 51000, net: 48300 })) }), T));
  ok((await applyNow(ctx(co), o2)).kind === "already" && same(co.db.night_entries[0].voucher, o1.entry.voucher), "a month that has ended: already made (tonight's run updates it)");
  // the new figures need a person (salary booked by hand for another amount): the stale entry is taken back, Needs you
  const cy = cloud(); await applyNow(ctx(cy), first);
  const y = J.payrollNow("202611", input(pay({ sheet: NOV(), more: [{ date: "2026-11-20", lines: [["Salary", -90000], ["Salary Payable", 90000]] }] }), T));
  const ya = await applyNow(ctx(cy), y);
  ok(y.kind === "you" && ya.kind === "you" && cy.db.night_entries[0].state === "withdrawn" && cy.db.night_findings.find((f) => f.kind === "payroll_due").state === "you", "the new figures need a person: Needs you, the old entry taken back (never approved with old figures)");
}

console.log("7. tonight's run leaves the running month's open finding alone (keepNow findings)");
{
  const months = J.payrollMonths("20261124");
  const Fd = (kind, key, state, x = {}) => Object.assign({ id: "f" + kind + key, firm_id: F, client_id: "c1", kind, key, state, facts: { ym: key.slice(-6), waits: true, ask_text: "" }, evidence: [], candidates: [{ t: "ledger", ref: "ledger:tds:TDS" }], decided_by: null, undone_at: null }, x);
  const c = cloud({ findings: [Fd("payroll_due", "payroll:202611", "you"), Fd("ledger_pick", "led:tds", "you"), Fd("ledger_pick", "led:salaryPayable", "you"), Fd("ledger_pick", "led:rent", "you"),
    Fd("payroll_due", "payroll:202610", "you"), Fd("payroll_due", "payroll:202612", "you", { decided_by: "u2" }), Fd("payroll_due", "payroll:202611", "you", { client_id: "c2", id: "other" }),
    Fd("sent_check", "sent:payroll:202611:v1", "you"), Fd("setoff_due", "setoff:07:202611", "you")] });
  const k = await PN.keepNow(c.rest, F, "c1", months, [{ kind: "ledger_pick", key: "led:salaryPayable" }]);
  const keys = ((Array.isArray(k) ? [] : k.findings) || []).map((f) => f.kind + "|" + f.key).sort();
  ok(same(keys, ["ledger_pick|led:tds", "payroll_due|payroll:202611", "sent_check|sent:payroll:202611:v1"]), "passed back: the running month's open finding, the payroll ledger pick it waits on, its Tally check; never the night's own month, one decided, another client's, another kind, or one the night passes itself: " + JSON.stringify(keys));
  const f0 = ((Array.isArray(k) ? [] : k.findings) || []).find((f) => f.key === "payroll:202611") || {};
  ok(f0.state === "you" && same(f0.facts, Fd("payroll_due", "payroll:202611", "you").facts) && same(f0.candidates, Fd("payroll_due", "payroll:202611", "you").candidates) && !("id" in f0), "as it is: its state, facts and choices (night_apply keeps it, changes nothing)");
  const r = cloud({ findings: [Fd("payroll_due", "payroll:202611", "resolved", { facts: { ym: "202611", ask_text: "" } }), Fd("ledger_pick", "led:tds", "you")] });
  ok((((x) => Array.isArray(x) ? [1] : x.findings || [1])(await PN.keepNow(r.rest, F, "c1", months))).length === 0, "the running month resolved (its entry made): no pick passed for it; the entry itself is kept");
  const bad = async (p) => { if (/night_findings/.test(p)) throw new Error("HTTP 500"); return []; };
  let threw = false; try { await PN.keepNow(bad, F, "c1", months); } catch (e) { threw = true; }
  ok(threw, "the findings not read: said (the night stops for the client, never clears them unseen)");
}

console.log("8. (review 3) the running month kept again: the entry follows the salary by itself; Approve on a stale one makes it again");
{
  const T = "20261124", ctx = (c) => ({ rest: c.rest, firm: F, cid: "c1", night: "2026-11-24", by: "u1" });
  // B2: Make now with the month's finding set aside (dismissed) or undone on Daily Check: kept, the open entry taken back
  const first = J.payrollNow("202611", input(pay({ sheet: NOV() }), T)), again = J.payrollNow("202611", input(pay({ sheet: NOV({ gross: 51000, net: 48300 }) }), T));
  const c = cloud(); await applyNow(ctx(c), first);
  const fd = c.db.night_findings.find((f) => f.kind === "payroll_due"); fd.state = "dismissed"; fd.decided_by = "u2";
  const k = await applyNow(ctx(c), again);
  ok(k.kind === "kept" && k.withdrawn === c.db.night_entries[0].id && c.db.night_entries[0].state === "withdrawn", "set aside on Daily Check, Make now again: kept, the running month's open entry taken back and said (withdrawn: " + k.withdrawn + ")");
  const u = cloud(); await applyNow(ctx(u), first);
  const fu = u.db.night_findings.find((f) => f.kind === "payroll_due"); fu.undone_at = "2026-11-24T05:00:00Z"; fu.state = "you";
  const ku = await applyNow(ctx(u), again);
  ok(ku.kind === "kept" && ku.withdrawn === u.db.night_entries[0].id && u.db.night_entries[0].state === "withdrawn", "undone on Daily Check: kept, the open entry taken back (" + JSON.stringify(ku) + ")");
  const o1 = J.payrollNow("202610", input(pay(), T)), od = cloud({ findings: [{ id: "f8", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202610", state: "dismissed", decided_by: "u2", evidence: [] }] });
  const ko = await applyNow(ctx(od), o1);
  ok(ko.kind === "kept" && !ko.withdrawn && od.db.night_entries.length === 0, "a month that has ended, set aside: kept, nothing made, nothing taken back");
  // none: the running month's open entry taken back (the handler, by withdrawNow)
  ok(typeof PN.withdrawNow === "function", "withdrawNow is there for the handler");
  if (typeof PN.withdrawNow === "function") {
    const w = cloud(); await applyNow(ctx(w), first);
    const id = await PN.withdrawNow(w.rest, F, "c1", "202611", "u1", "none");
    ok(id === w.db.night_entries[0].id && w.db.night_entries[0].state === "withdrawn" && w.db.daily_log.some((l) => l.evidence && l.evidence.withdrawn === id), "nothing to make for the running month: its open entry taken back, logged");
    w.db.night_entries[0].state = "approved";
    ok((await PN.withdrawNow(w.rest, F, "c1", "202611", "u1", "none")) === "" && w.db.night_entries[0].state === "approved", "an approved one is never taken back");
  }
  // Approve on a stale running-month entry: made again in the cloud (payroll_now), said; never "Changed since last night"
  const e = Object.assign({ id: "e1", state: "ready" }, first.entry), stale = pay({ sheet: NOV({ gross: 51000, net: 48300 }) });
  const calls = [], srv = (r) => async (cid, ym) => { calls.push([cid, ym]); return r; };
  const atA = async (rows, ent, o) => { const b = booksOf(JSON.parse(JSON.stringify(Object.assign({}, rows, { made: undefined }))));
    Object.assign(globalThis, { S: { books: b, coId: "c1", companies: { c1: rows.co } }, CO: () => rows.co, GSTR: E3.GSTR, GSTF: E3.GSTF, GSTSet: E3.GSTSet, Books: E3.Books, ledGroupPath: E3.ledGroupPath });
    try { return await recheck(Object.assign({ client_id: "c1" }, ent), Object.assign({ today: T, ledgers: rows.ledgers.map((l) => l.name), drafts: [], prior: [], bookId: "b1", jobs: {} }, o)); }
    finally { ["S", "CO", "GSTR", "GSTF", "GSTSet", "Books", "ledGroupPath"].forEach((x) => delete globalThis[x]); } };
  const r1 = await atA(stale, e, { payrollNow: srv({ ok: true, kind: "updated", id: "e1", state: "ready" }) });
  ok(r1 === "Updated to the salary kept now; check and approve." && same(calls, [["c1", "202611"]]), "stale at Approve: payroll_now called for Nov 2026, said: " + r1);
  const r2 = await atA(stale, e, { payrollNow: srv({ ok: true, kind: "none", words: "No salary is kept with the books for Nov 2026. The entry made for it earlier is taken back." }) });
  ok(r2 === "No salary is kept with the books for Nov 2026. The entry made for it earlier is taken back.", "nothing to make now: the server's plain words: " + r2);
  const r3 = await atA(stale, e, { payrollNow: srv({ ok: true, kind: "kept", words: "Daily Check needs you for Nov 2026. The entry made for it earlier is taken back." }) });
  ok(/Daily Check needs you for Nov 2026/.test(r3) && r3 !== CHANGED, "Needs you: said: " + r3);
  const r4 = await atA(stale, e, { payrollNow: srv({ ok: true, kind: "already", id: "e1", state: "ready" }), entryOf: async () => ({ voucher: again.entry.voucher }) });
  ok(r4 === "Updated to the salary kept now; check and approve.", "already updated in the cloud (the entry here is older): said the same: " + r4);
  const r5 = await atA(stale, e, { payrollNow: srv({ ok: true, kind: "already", id: "e1", state: "ready" }), entryOf: async () => ({ voucher: e.voucher }) });
  ok(r5 && r5 !== CHANGED && !/Updated/.test(r5), "the cloud has not the salary here yet: said, nothing updated: " + r5);
  calls.length = 0;
  ok(await atA(pay({ sheet: NOV() }), e, { payrollNow: srv({ kind: "updated" }) }) === "" && calls.length === 0, "not stale: goes on, the server not called");
  const oct = J.payrollNow("202610", input(pay(), T));
  ok(await atA(pay({ sheet: sheet.map((r, i) => i ? r : Object.assign({}, r, { gross: 51000, net: 48300 })) }), Object.assign({ id: "e2", state: "ready" }, oct.entry), { payrollNow: srv({ kind: "updated" }) }) === CHANGED && calls.length === 0, "a month that has ended: as before (" + CHANGED + "), the night makes it again");
}

console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fails ? 1 : 0);
