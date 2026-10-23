// A remark in 2B reconciliation and the decision in ITC follow-up are one (the owner, 23-Oct-2026, Leads Insurance: "I
// have done some vendor to be followed but it was not showing up there"). They are kept in two places with the books,
// each item by item on the server (client_book_items, src/js/18 BOOKS_KEYS):
//   - the reconciliation's remark: reco2b.tag[k] = {tag, at}, k the Tally document's id (in Tally only) or the 2B
//     document's key (in 2B only, or a pair); set by r2Tag from app/src/screens/gst/Reco2b.jsx and TwoB.jsx;
//   - ITC follow-up's decision: itcTrack[reg].dec[k] = {act, at, ts, note}, k "B|gstin|no|dir" (in Tally only),
//     "P|…" (in 2B only), "D|…" (amounts differ); set by itctSetAct from app/src/screens/gst/ItcFollow.jsx.
// Before, nothing read one from the other, so "Follow up with supplier" set in the reconciliation never put the bill or
// its supplier under ITC follow-up's "Suppliers to write to". Now each change is written to both, and each line of
// ITCT.items (src/js/32) carries the later of the two, for remarks set before this (or on another computer at the same
// time). The two are matched through the same GST2B.run result ITCT.items is worked out from: the supplier's GSTIN,
// the invoice number written the one way (noN) and whether it is an invoice or a note.
// Kept out of legacy.js (its size budget, tests/run_stability.py): r2Tag and itctSetAct were src/js/27 and src/js/32.

// what a remark means on each kind of line of ITC follow-up (ITCT.CATS), and back
const TAG_ACT = {
  waiting: { "Follow up with supplier": "follow", "Expect in next 2B": "wait" },
  ournote: { "Follow up with supplier": "follow" },
  diff: { "Ask supplier to correct": "supplier", "Follow up with supplier": "supplier" },
  tobook: { "Ask supplier to correct": "supplier", "Follow up with supplier": "supplier", "To book in Tally": "book", "Not our purchase": "reject" },
};
const ACT_TAG = {};
Object.entries(TAG_ACT).forEach(([cat, m]) => { ACT_TAG[cat] = {}; Object.entries(m).forEach(([tag, act]) => { if (!ACT_TAG[cat][act]) ACT_TAG[cat][act] = tag; }); });
// a decision that settles its line (as ITCT.items has it)
const CLOSED = { "waiting:expense": 1, "diff:accept": 1, "tobook:reject": 1, "ournote:ok": 1 };

const ms = (iso) => Date.parse(iso || "") || 0;
// when a decision was made: its time, or for one made before this the start of its day
const decAt = (d) => (d.ts ? ms(d.ts) : /^\d{8}$/.test(d.at || "") ? ms(d.at.slice(0, 4) + "-" + d.at.slice(4, 6) + "-" + d.at.slice(6, 8) + "T00:00:00") : 0);
const tags = () => (((S.books || {}).reco2b || {}).tag) || {};

// the reconciliation's key for each line of ITC follow-up
function recoKeys(res) {
  const m = {};
  (res.onlyBooks || []).forEach((d) => { m["B|" + (d.gstin || d.party) + "|" + d.noN + "|" + d.dir] = d.id; });
  (res.pairs || []).forEach((x) => { if (x.status === "diff") m["D|" + x.p.gstin + "|" + x.p.noN + "|" + x.p.dir] = x.p.key; });
  (res.only2b || []).forEach((p) => { m["P|" + p.gstin + "|" + p.noN + "|" + p.dir] = p.key; });
  return m;
}

// each line: its reconciliation key (rk), and the remark's decision when the remark is the later
function apply(reg, items) {
  const rk = recoKeys(GST2B.run(reg)), tg = tags(), dec = ((((S.books || {}).itcTrack || {})[reg || ""]) || {}).dec || {};
  items.forEach((x) => {
    const map = TAG_ACT[x.cat], k = rk[x.key];
    if (!map || !k) return;
    x.rk = k;
    const t = tg[k], act = t && map[t.tag], d = dec[x.key] || {};
    if (!act || (d.act && decAt(d) >= ms(t.at))) return;
    x.act = act; x.decidedAt = String(t.at || "").slice(0, 10).replace(/-/g, ""); x.open = !CLOSED[x.cat + ":" + act];
  });
  return items;
}

function line(reg, test) { return ITCT.items(reg).items.find(test); }
function decide(reg, key, act, ts) {
  const st = ITCT.store(reg), d = Object.assign({}, st.dec[key]);
  if (act) Object.assign(d, { act, at: ITCT.today(), ts }); else { delete d.act; delete d.at; delete d.ts; }
  st.dec[key] = d;
}

// a remark set in the reconciliation: kept, and the line of ITC follow-up decided the same way; a remark taken off, or
// one that means nothing there, leaves the line to its first choice when its decision was one a remark gives
function r2Tag(key, tag) {
  const st = GST2B.state(), ts = new Date().toISOString(), reg = (typeof r2Reg === "function" ? r2Reg(S.books) : "") || S.gstReg || "";
  const x = line(reg, (i) => i.rk === key);
  if (x) { const act = TAG_ACT[x.cat][tag], had = (ITCT.store(reg).dec[x.key] || {}).act; if (act || (had && ACT_TAG[x.cat][had])) decide(reg, x.key, act || "", ts); }
  if (tag) st.tag[key] = { tag, at: ts }; else delete st.tag[key];
  saveBooks(); render();
}

// what the user decides on a line of ITC follow-up (kept, carried to later months), and the remark in the
// reconciliation to match: the one that means the same, or none where the remark there means another decision
function itctSetAct(key, act) {
  const reg = S.gstReg || "", ts = new Date().toISOString(), x = line(reg, (i) => i.key === key);
  decide(reg, key, act, ts);
  if (x && x.rk) {
    const st = GST2B.state(), tag = (ACT_TAG[x.cat] || {})[act], cur = st.tag[x.rk];
    if (tag) st.tag[x.rk] = { tag, at: ts };
    else if (cur && TAG_ACT[x.cat][cur.tag]) delete st.tag[x.rk];
  }
  saveBooks(); render();
}

if (typeof ITCT !== "undefined" && !ITCT.items.synced) {
  const items = ITCT.items;
  ITCT.items = function (reg) { const R = items.call(this, reg); apply(reg, R.items); return R; };
  ITCT.items.synced = true;
}
Object.assign(globalThis, { r2Tag, itctSetAct, ITCSync: { TAG_ACT, ACT_TAG, apply } });
