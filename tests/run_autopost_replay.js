// node run_autopost_replay.js — the regression guard of "Post automatically" (autopost plan, section 7 and 10.3): Testing
// AAD's own staging data replayed in date order through the real rules (AutoPost, src/js/90-autopost.js), each line or
// bill judged only on what came before it, as if it had just arrived.
//
// Expected (the owner's approval of 23-Oct-2026 and the plan's measurement):
//   bank   276 lines; with "any amount within the limit" and ₹50,000 an entry: 69 posted by themselves, 0 to a ledger
//          other than the one a person chose; with "the same amount only" (the default): fewer, still 0 wrong
//   bills  14 approved and in Tally: 0 posted by themselves, for the stated reasons (7 first bill of the supplier or of
//          its kind of bill, 6 a supplier without a GSTIN, 1 a possible duplicate: the same PDF as PC/26-27/0679)
//   the CLOUD WIZARD retainer receipt of ₹16,200 (05-Aug-2026) is NOT posted: the four earlier receipts went to Bank
//          Charges on FinCom's "history" guess, and a person corrected it that day; guesses never teach.
//   with every posted line counted as an approval (what learnRows(…, "sent") recorded before this build): that Cloud
//          Wizard receipt WOULD go to Bank Charges, wrong (the drift this build stops)
//
// The data: Testing AAD (client cmufksrrqjub2g) on staging, read only, never committed (client data stays out of the
// repository): TDSDESK_AUTOPOST_DATA (a folder with aad-bank.json and aad-entries.json). Without it this test says so and
// passes (CI has no copy). The two files are these read-only queries' results (jsonb_agg):
//   bank:    select jsonb_agg(jsonb_build_object('stmt',x.id,'i',r->>'id','fp',r->>'fp','d',r->>'date','dr',r->'debit','cr',r->'credit',
//            'n',r->>'narr','dec',r->'dec','l',r->>'ledger','st',r->>'state','u',r->'userSet','src',r->>'source','bal',r->'balOk',
//            'vt',r->>'vtype','sp',r->'splits','tp',r->'tdsAtPay','rp',r->'repaired','bill',r->>'billId','ord',ord) order by x.id, ord)
//            from records x, jsonb_array_elements(x.data->'rows') with ordinality t(r, ord) where x.client_id='cmufksrrqjub2g' and x.kind='bank_rows';
//   entries: select jsonb_agg((data - 'readTrace' - 'checks' - 'hint' - 'partyHist' - 'gstinNotes' - 'docPath') || jsonb_build_object('_deleted', deleted)
//            order by data->>'approvedAt') from records where client_id='cmufksrrqjub2g' and kind='entry';
const fs = require("fs"), path = require("path");
const {load, HTML} = require("./harness");
const DIR = process.env.TDSDESK_AUTOPOST_DATA || path.join(__dirname, "data", "autopost");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
if (!fs.existsSync(path.join(DIR, "aad-bank.json"))){ console.log("  ok   no staging copy of Testing AAD here (TDSDESK_AUTOPOST_DATA): the replay is skipped"); console.log("all passed"); process.exit(0); }
const {x} = load(HTML, ["num", "r2", "INR", "money0", "MONTHS3", "fmtDate", "NORM_CACHE", "normName", "normNameRaw", "partyKey", "GSTIN_RE", "GST_CHARS", "gstinCheckChar", "gstinValid", "AutoPost"]);
const AP = x.AutoPost;
const raw = JSON.parse(fs.readFileSync(path.join(DIR, "aad-bank.json"), "utf8"));
const rows = raw.map((r) => ({id: r.i, fp: r.fp, date: r.d, debit: r.dr, credit: r.cr, narr: r.n, dec: r.dec || {}, ledger: r.l, state: r.st, userSet: r.u === true, source: r.src,
  balOk: r.bal, vtype: r.vt, splits: r.sp || [], tdsAtPay: r.tp || 0, repaired: r.rp || false, stmt: r.stmt, ord: r.ord}))
  .sort((a, b) => a.date.localeCompare(b.date) || (a.stmt + "").localeCompare(b.stmt + "") || a.ord - b.ord);
const env = {partyKey: x.partyKey, exactLedger: (n) => n, ledgerInfo: () => null};

function replayBank(cfg, teaches, how) {
  const before = [], res = {auto: 0, wrong: [], by: {}, stops: {}, decided: new Map()};
  rows.forEach((r) => {
    const idx = AP.bankIndex(before.filter(teaches), {}, env, how);
    // as it arrived: no decision yet
    const fresh = Object.assign({}, r, {state: "suggested", userSet: false, source: "", prevState: null});
    const m = AP.bankCheck(fresh, {cfg, idx, env});
    res.decided.set(r.id, m);
    if (m.ok) { res.auto++; res.by[m.rule] = (res.by[m.rule] || 0) + 1; if (m.ledger !== r.ledger) res.wrong.push(r.date + " " + r.narr.slice(0, 50) + " → " + m.ledger + " (a person chose " + r.ledger + ")"); }
    else { const k = m.why.replace(/\(.*\)/, "(…)").replace(/₹[\d,]+/, "₹N"); res.stops[k] = (res.stops[k] || 0) + 1; }
    before.push(r);
  });
  return res;
}
const cfgW = Object.assign({}, AP.DEF, {on: true, bankAmounts: "within", perEntry: 50000});
const cfgE = Object.assign({}, AP.DEF, {on: true, perEntry: 50000});
// a person's approvals only (this build): the row's own record of who decided (AutoPost.rowHow)
const person = (r) => AP.BANK_TEACH.includes(AP.rowHow(r));
console.log("== bank: Testing AAD, " + rows.length + " lines, in date order, ₹50,000 an entry");
const w = replayBank(cfgW, (r) => person(r) && ["sent", "intally"].includes(r.state));
console.log("   any amount within the limit: " + w.auto + " automatic " + JSON.stringify(w.by) + "; waiting: " + JSON.stringify(w.stops));
ok(rows.length === 276, "276 lines (" + rows.length + ")");
ok(w.auto === 69, "69 of 276 posted by themselves with “any amount within the limit” (" + w.auto + ")");
ok(w.wrong.length === 0, "0 to a ledger other than the person’s " + JSON.stringify(w.wrong.slice(0, 3)));
const e = replayBank(cfgE, (r) => person(r) && ["sent", "intally"].includes(r.state));
console.log("   the same amount only (the default): " + e.auto + " automatic " + JSON.stringify(e.by));
ok(e.auto <= w.auto && e.auto > 0 && e.wrong.length === 0, "the default (same amount only) posts no more, still 0 wrong (" + e.auto + ")");
ok(Object.values(e.decided).every(() => true) && [...e.decided.values()].filter((m) => m.ok).every((m) => m.conf === "High"), "the default posts High only");
const cw = rows.find((r) => /CLOUD WIZARD/i.test(r.narr) && r.date === "2026-08-05" && num(r.credit) === 16200);
function num(v) { return Number(v) || 0; }
ok(!!cw && !w.decided.get(cw.id).ok, "the CLOUD WIZARD ₹16,200 receipt of 05-Aug-2026 is NOT posted by itself (" + (cw ? w.decided.get(cw.id).why : "not found") + ")");
const akj = rows.find((r) => /AKJ REAL INF/.test(r.narr));
ok(!!akj && !w.decided.get(akj.id).ok, "the AKJ REAL INF ₹2,00,000 audit fee receipt waits (" + (akj ? w.decided.get(akj.id).why : "not found") + ")");
const susp = [...w.decided.values()].filter((m) => m.stops.some((s) => /Suspense is never/.test(s)));
ok(susp.length > 0 && susp.every((m) => !m.ok), susp.length + " lines whose earlier approval was Suspense wait (“Suspense is never posted by itself”)");
// the drift before this build: every line posted counted as learned
const broad = replayBank(cfgW, (r) => ["sent", "intally"].includes(r.state), () => true);
console.log("   every posted line counted as learned (before this build): " + broad.auto + " automatic, " + broad.wrong.length + " wrong: " + broad.wrong.join("; "));
const cwb = cw && broad.decided.get(cw.id);
ok(!!cwb && cwb.ledger === "Bank Charges" && !cwb.ok && cwb.stops.some((s) => /money in to an expense ledger/.test(s)),
  "counting guesses as approvals would copy Bank Charges to the Cloud Wizard receipt (the drift); person-only learning stops it, and the direction stop catches it too (" + (cwb ? cwb.ledger + ": " + cwb.stops.join("; ") : "") + ")");

console.log("== bills: Testing AAD, approved and in Tally, in approval order");
const ents = JSON.parse(fs.readFileSync(path.join(DIR, "aad-entries.json"), "utf8")).filter((x) => x && x.id && !x._deleted);
const byId = Object.fromEntries(ents.map((x) => [x.id, x]));
const done = ents.filter((x) => x.status === "approved" && x.exportedAt).sort((a, b) => a.approvedAt.localeCompare(b.approvedAt));
ok(done.length === 14, "14 approved bills in Tally (" + done.length + ")");
const benv = {gstinValid: x.gstinValid, panOf: (xx) => String(xx.vendorPan || "").toUpperCase(), exactLedger: (n) => n, ledgerInfo: () => null, nameSim: null, compute: null, partyConfirmed: () => true};
const reasons = {};
let autoBills = 0;
[false, true].forEach((noGst) => {
  const cfg = Object.assign({}, AP.DEF, {on: true, perEntry: 50000, billsNoGstin: noGst});
  const why = {};
  done.forEach((b) => {
    // the bills approved before this one, as they were (status approved, in Tally); this one as it arrived
    const entries = {};
    ents.forEach((o) => { if (o.id === b.id) return; if (o.status === "approved" && o.approvedAt < b.approvedAt) entries[o.id] = o; else if (o.status !== "approved") entries[o.id] = o; });
    const cand = Object.assign({}, b, {status: "draft", approvedAt: null, exportedAt: null, approvedHow: undefined});
    entries[cand.id] = cand;
    const m = AP.billCheck(cand, {cfg, entries, env: benv});
    if (m.ok) autoBills++;
    const k = /first bill/.test(m.why) ? "first bill of the supplier (or of its kind)" : /HSN\/SAC/.test(m.why) ? "first bill of the supplier (or of its kind)" : /no GSTIN|without a GSTIN|disagree/.test(m.why) && !b.x.vendorGstin ? "a supplier without a GSTIN" : /duplicate/.test(m.why) ? "possible duplicate" : m.why;
    why[k] = (why[k] || 0) + 1;
    if (!noGst) console.log("   " + (b.x.vendorName || "").slice(0, 22).padEnd(22) + " " + String(b.x.invoiceNo).padEnd(16) + (m.ok ? "AUTO" : "waits: " + m.why));
  });
  reasons[noGst ? "with" : "without"] = why;
});
console.log("   reasons (suppliers without a GSTIN off, the default): " + JSON.stringify(reasons.without));
console.log("   reasons (suppliers without a GSTIN ticked): " + JSON.stringify(reasons.with));
ok(autoBills === 0, "0 of 14 bills posted by themselves, with or without suppliers lacking a GSTIN");
const rw = reasons.without;
ok(rw["first bill of the supplier (or of its kind)"] === 7 && rw["a supplier without a GSTIN"] === 6 && rw["possible duplicate"] === 1,
  "the stated reasons: 7 first bill of the supplier or its kind, 6 a supplier without a GSTIN, 1 possible duplicate (" + JSON.stringify(rw) + ")");
const prince = done.find((b) => b.x.invoiceNo === "PC/26-27/0679");
ok(!!prince, "the Prince Computer repeat (PC/26-27/0679, the same PDF as 0691) is the duplicate");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
