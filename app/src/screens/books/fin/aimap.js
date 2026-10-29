// The one-time AI mapping (the owner, 29-Oct-2026: "run one time ai here to match uploaded balance sheet and fincom
// generated balance sheet.. so that you will map the ledger heads accordingly.. and for next year it would be 1 click job
// for anyone"): the model of AiMap.jsx, in the same lazy chunk (not in legacy.js nor the page's own chunk).
// Three ways in, one run each time (FinAiMap.run):
//   "close"  the matching screen (Checks): the audited balance sheet as at the year's end (FinPyBs.latest(fy + 1)) against
//            the ledgers' closing balances (the trial balance's final column);
//   "open"   the Trial balance & mapping tab: last year's balance sheet (FinPyBs.latest(fy)) against the balances the year
//            opened with (income and expense ledgers go without a balance: they have none at that date);
//   "new"    next year: only the ledgers new since the mapping (no hand choice, in no earlier run), with their closing
//            balances; checked against the audited balance sheet of the year when there is one.
// What is sent: server/_shared/fsaimap.js's faClean (name, Tally group, balance; the balance sheet's lines; the codes) to
// fincom-assistant, action "fs_aimap" (the firm's AI setting, FinCom's switch, the monthly cap, the cost and the log are the
// server's). The answer, a code and a reason per ledger, is kept in b.fs.aimap.runs (synced with the books) with each
// ledger's code at the time; nothing is applied until a person accepts it. FinCom's check (review): the trial balance with
// the proposals still open (and those accepted) applied, head by head against the audited figures (faTie); never forced.
// Accepting writes the code as a hand choice (b.fs.map, remembered and used next year) with who: "<user>, AI-assisted"
// and when (b.fs.mapBy); a hand choice the AI would change is shown as such and left out of the bulk actions unless asked.
import { faClean, faTie } from "../../../../../server/_shared/fsaimap.js";

const N = (v) => +v || 0, R2 = (v) => { const r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; };
const who = () => (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || ((typeof S === "object" && S.firm) ? (S.firm.partner || S.firm.firmName) : "") || "this computer";
const save = () => { if (typeof saveBooks === "function") saveBooks(); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fsOf = () => { const b = S.books; b.fs = b.fs || {}; return b.fs; };
function store() { const f = fsOf(); f.aimap = Object.assign({ runs: [] }, f.aimap); return f.aimap; }
const kindOf = () => (FS.cfg(S.books).kind === "co" ? "co" : "nc");
const profitHead = (kind) => FinSt.bsLineOf(kind === "co" ? "4A" : "3P");
const ny = (fy) => String(N(fy) + 1);
// the balance sheet the run is matched with, and the one whose lines are sent
const auditedOf = (fy, mode) => (mode === "open" ? FinPyBs.latest(fy) : FinPyBs.latest(ny(fy)));
const linesFrom = (fy, mode) => auditedOf(fy, mode) || (mode === "new" ? FinPyBs.latest(fy) : null);
const asAtOf = (fy, mode) => (mode === "open" ? String(fy) : ny(fy)) + "0331";

// the trial balance with some codes as if chosen (the proposals), FinCom's engine as it is; the map put back after
function withMap(over, fn) {
  const f = fsOf(), old = f.map;
  f.map = Object.assign({}, old, over);
  try { return fn(); } finally { f.map = old; }
}
const tbOf = (fy) => FinSt.tb(String(fy));

// ---------- what is sent ----------
function ledgersOf(fy, mode, only) {
  const T = tbOf(fy); if (T.error) throw new Error(T.error);
  const want = only ? new Set(only) : null, out = [];
  T.rows.forEach((r) => {
    if (r.synthetic || (want && !want.has(r.ledger))) return;
    const bal = mode === "open" ? (Object.prototype.hasOwnProperty.call(T.openBs, r.ledger) ? R2(N(T.openBs[r.ledger])) : null) : R2(r.final);
    out.push({ name: r.ledger, group: r.group || "", bal });
  });
  return out;
}
function linesOf(v) {
  if (!v) return [];
  const u = N(v.unit) || 1;
  return (v.lines || []).filter((z) => !z.isHead && !z.isTotal && z.amt != null)
    .map((z) => ({ head: z.face ? "Balance sheet" + (z.sub ? ": " + z.sub : "") : (z.head || ""), line: z.label, amt: R2(N(z.amt) * u), code: z.code || "" }));
}
function codesOf(kind) {
  const K = FinSt.codes(kind), title = {};
  FinSt.NOTES.forEach((n) => { if (!n.only || n.only === kind) title[n.key] = title[n.key] || n.title; });
  return Object.values(K).filter((c) => !c.sys).map((c) => ({ code: c.code, label: (title[c.note] ? title[c.note] + ": " : "") + c.label }));
}
function payload(fy, mode, only) {
  const kind = kindOf();
  return faClean({ ledgers: ledgersOf(fy, mode, only), lines: linesOf(linesFrom(fy, mode)), codes: codesOf(kind) });
}

// ---------- the AI setting (the firm's; Settings › AI help) and the request ----------
const FinAiMap = {
  // on while the firm's assistant is on (as TaxLed.aiOn); tests replace aiOn and post
  aiOn() {
    if (typeof Cloud !== "object" || !Cloud.on || !Cloud.on() || typeof ASST !== "object") return false;
    const st = ASST.st().settings; if (!st && !ASST.st().settingsBusy) ASST.loadSettings();
    return !!(st && !st.error && st.enabled);
  },
  offWhy() {
    if (typeof Cloud !== "object" || !Cloud.on || !Cloud.on()) return "AI needs the firm's account: sign in to it. AI is used only while the firm's AI setting is on (Settings › AI help).";
    const st = typeof ASST === "object" ? ASST.st().settings : null;
    if (!st) return "Reading the firm's AI setting… AI is used only while it is on (Settings › AI help).";
    return "AI is switched off for your firm. The firm's owner can switch it on in Settings › AI help.";
  },
  async post(body) {
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess();
    const r = await fetch(ASST.url(), { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw Object.assign(new Error(j.error || ("AI could not be asked (" + r.status + ").")), { kind: j.kind || "other", cost: j.cost });
    return j;
  },

  // one run: what is sent, the answer kept with each ledger's code at the time; nothing applied
  async run(fy, mode, only) {
    fy = String(fy);
    if (!this.aiOn()) throw Object.assign(new Error(this.offWhy()), { kind: "off" });
    const body = Object.assign({ action: "fs_aimap", client_id: S.books.cid, mode }, payload(fy, mode, only));
    delete body.notSent;
    if (!body.ledgers.length) throw new Error("No ledger to map.");
    const j = await this.post(body);
    const now = {}; tbOf(fy).rows.forEach((r) => { if (!r.synthetic) now[r.ledger] = { code: r.code || "", src: r.code ? r.codeSrc : "none" }; });
    const props = (j.proposals || []).filter((p) => p && p.name && FinSt.CODES[p.code]).map((p) => ({ l: String(p.name), ai: String(p.code), why: String(p.reason || "").slice(0, 200),
      old: (now[p.name] || {}).code || "", oldSrc: (now[p.name] || {}).src || "none" }));
    const got = new Set(props.map((p) => p.l));
    const run = { id: uid(), fy, mode, asAt: asAtOf(fy, mode), at: new Date().toISOString(), by: who(), asked: body.ledgers.length, notSent: N(j.notSent),
      missing: body.ledgers.map((l) => l.name).filter((n) => !got.has(n)).slice(0, 200), cost: { usd: N(j.cost && j.cost.usd), inr: N(j.cost && j.cost.inr) }, props, dec: {} };
    const st = store(); st.runs = st.runs.concat([run]).slice(-12);
    save();
    return run;
  },
  runs: (fy, mode) => ((((S.books || {}).fs || {}).aimap || {}).runs || []).filter((r) => (fy == null || r.fy === String(fy)) && (!mode || r.mode === mode)),
  last(fy, mode) { const l = this.runs(fy, mode); return l[l.length - 1] || null; },
  find: (id) => ((((S.books || {}).fs || {}).aimap || {}).runs || []).find((r) => r.id === id) || null,

  // ---------- FinCom's check of a run ----------
  // labels: {head id: its words} (the page's balance sheet, d.bs)
  review(run, labels) {
    const key = JSON.stringify([run.id, run.dec, (S.books.fs || {}).map, (S.books.fs || {}).adj, Object.entries((S.books.fs || {}).pyBs || {}).map(([k, x]) => k + ":" + ((x.versions || []).length)), (S.books.vouchers || []).length, (S.books.tb || {}).at]);
    if (memo.key === key) return memo.v;
    const v = review(run, labels || {}); memo = { key, v }; return v;
  },
  accept(run, names, o) {
    const f = fsOf(), by = ((o && o.by) || who()) + ", AI-assisted", at = new Date().toISOString(), want = new Set(names);
    const map = Object.assign({}, f.map), mb = Object.assign({}, f.mapBy);
    let n = 0;
    run.props.forEach((p) => {
      if (!want.has(p.l) || (run.dec[p.l] && run.dec[p.l].d === "accepted")) return;
      run.dec[p.l] = { d: "accepted", by, at, prev: Object.prototype.hasOwnProperty.call(map, p.l) ? map[p.l] : null };
      map[p.l] = p.ai; mb[p.l] = { code: p.ai, by, at, run: run.id }; n++;
    });
    f.map = map; f.mapBy = mb; run.dec = Object.assign({}, run.dec); save(); return n;
  },
  reject(run, l, o) { run.dec = Object.assign({}, run.dec, { [l]: { d: "rejected", by: (o && o.by) || who(), at: new Date().toISOString() } }); save(); },
  // an accepted code put back as it was (the hand choice before, or the rules' again); a rejection taken back
  undo(run, l) {
    const e = run.dec[l]; if (!e) return;
    if (e.d === "accepted") {
      const f = fsOf(), map = Object.assign({}, f.map), mb = Object.assign({}, f.mapBy);
      if (e.prev == null) delete map[l]; else map[l] = e.prev;
      delete mb[l]; f.map = map; f.mapBy = mb;
    }
    const x = Object.assign({}, run.dec); delete x[l]; run.dec = x; save();
  },
  // bulk: every proposal still open (tiedOnly: those whose head ties); a hand choice only when asked (hand)
  acceptMany(run, o) {
    const rv = this.review(run);
    return this.accept(run, rv.rows.filter((r) => r.state === "open" && (o.hand || !r.handChange) && (!o.tiedOnly || r.tied === true)).map((r) => r.l), o);
  },

  // ---------- next year ----------
  // the mapping of an earlier year (a run with codes accepted) used this year: N ledgers with a hand choice; M new ones
  // (no hand choice, in no earlier run); K left on the rules' codes (in a run, not accepted)
  nextYear(fy) {
    fy = String(fy);
    const key = JSON.stringify(["ny", fy, (S.books.fs || {}).map, ((S.books.fs || {}).aimap || {}).runs, (S.books.vouchers || []).length, (S.books.tb || {}).at]);
    if (nyMemo.key === key) return nyMemo.v;
    const v = this.nextYearNow(fy); nyMemo = { key, v }; return v;
  },
  nextYearNow(fy) {
    const earlier = this.runs().filter((r) => N(r.fy) < N(fy) && Object.values(r.dec || {}).some((x) => x.d === "accepted"));
    if (!earlier.length) return null;
    const T = tbOf(fy); if (T.error) return null;
    const map = (S.books.fs || {}).map || {}, seen = new Set(); earlier.forEach((r) => r.props.forEach((p) => seen.add(p.l)));
    const rows = T.rows.filter((r) => !r.synthetic), mapped = rows.filter((r) => map[r.ledger]), rest = rows.filter((r) => !map[r.ledger]);
    return { n: mapped.length, fresh: rest.filter((r) => !seen.has(r.ledger)).map((r) => r.ledger), kept: rest.filter((r) => seen.has(r.ledger)).map((r) => r.ledger), from: earlier[earlier.length - 1] };
  },
  asAtOf, auditedOf,
};
let memo = { key: "", v: null }, nyMemo = { key: "", v: null };

function review(run, labels) {
  const headLabel = (h) => labels[h] || h;
  const fy = run.fy, kind = kindOf(), K = FinSt.codes(kind), ph = profitHead(kind), map = (S.books.fs || {}).map || {};
  const T0 = tbOf(fy), now = {}; if (!T0.error) T0.rows.forEach((r) => { if (!r.synthetic) now[r.ledger] = { code: r.code || "", src: r.code ? r.codeSrc : "none" }; });
  const rows = run.props.map((p) => {
    const d = run.dec[p.l], cur = now[p.l] || { code: "", src: "none" }, hand = Object.prototype.hasOwnProperty.call(map, p.l) ? map[p.l] : null;
    const state = d ? d.d : cur.src === "hand" && cur.code === p.ai ? "same" : "open";
    return { l: p.l, ai: p.ai, why: p.why, cur: cur.code, src: cur.src, state, dec: d || null, handChange: state === "open" && hand != null && hand !== p.ai, gone: !now[p.l] };
  });
  // the check: the open proposals (and the accepted, already in the map) applied
  const over = {}; rows.forEach((r) => { if (r.state === "open" && K[r.ai]) over[r.l] = r.ai; });
  const v = auditedOf(fy, run.mode === "new" ? "close" : run.mode);
  let check = null, nowCheck = null;
  if (v) {
    const u = N(v.unit) || 1, aud = {}, info = {};
    (v.lines || []).forEach((z) => { const c = FinSt.CODES[z.code]; if (!z.use || !c || c.side !== "BS" || !K[z.code]) return; const h = FinSt.bsLineOf(z.code); if (h) aud[h] = (aud[h] || 0) + N(z.amt) * u; });
    Object.values(FinSt.CODES).forEach((c) => { info[c.code] = { head: c.side === "BS" ? FinSt.bsLineOf(c.code) : "", sign: c.sign, side: c.side }; });
    const tol = Math.max(0.005, u / 2), open = run.mode === "open";
    // (as FinSt's pyCheck for "open": each ledger's balance at the start of the year by its code, the profit brought forward
    // in the surplus; as FinRecon.compare for the year's end: every line of the trial balance, the year's profit in the surplus)
    const rowsOf = (T) => { if (!open) return T.rows.map((r) => ({ code: r.code, bal: r.final }));
      const c = {}; T.rows.forEach((r) => { if (!r.synthetic) c[r.ledger] = r.code; });
      return Object.entries(T.openBs).map(([l, b]) => ({ code: c[l] !== undefined ? c[l] : FinSt.codeOf(l, b, kind).code, bal: b })).concat([{ code: "4A", bal: N(T.bfOpen) }]); };
    const r1 = withMap(over, () => { const T1 = tbOf(fy); return T1.error ? null : rowsOf(T1); });
    if (r1 && !T0.error) {
      check = faTie(r1, info, aud, { profitHead: open ? "" : ph, tol });
      nowCheck = faTie(rowsOf(T0), info, aud, { profitHead: open ? "" : ph, tol });
    }
  }
  rows.forEach((r) => {
    const c = FinSt.CODES[r.ai]; r.head = !c ? "" : c.side === "BS" ? FinSt.bsLineOf(r.ai) : run.mode === "open" ? "" : ph;
    const h = check && r.head ? check.byHead[r.head] : null;
    r.tied = !check || !r.head ? null : h ? h.tied : true;
    r.gap = h && !h.tied ? h.diff : 0;
    r.headLabel = r.head ? headLabel(r.head) : "";
  });
  const heads = check ? check.heads.map((h) => Object.assign({}, h, { label: headLabel(h.head), now: nowCheck && nowCheck.byHead[h.head] ? nowCheck.byHead[h.head].diff : 0 })) : [];
  return { rows, heads, check: !!check, gaps: heads.filter((h) => !h.tied).length, asAt: FinSt.DMY(run.asAt) };
}
if (typeof globalThis === "object") globalThis.FinAiMap = FinAiMap;
export default FinAiMap;
