// The GST and TDS ledger check (request of 02-Oct-2026): once per client, every tax-like ledger with FinCom's suggestion,
// the evidence and where it came from (Tally master, day book, your firm, AI), and a tick to confirm. High-confidence
// suggestions from Tally or the day book are ticked to start with; AI's never are. Nothing counts in a return until it is
// confirmed. Later, only new ledgers, and confirmed ledgers whose use has changed (a warning), come back here.
// The working is LedCheck (src/js/57-ledger-check.js).
import Confirm from "../../parts/Confirm.jsx";
import { ListRows } from "../../parts/ListTable.jsx";
import { cloneElement } from "react";
const SRCC = { master: "ok", usage: "", firm: "", name: "", ai: "warn" };
const what = (p) => {
  if (!p || !p.what) return "—";
  if (p.what === "none") return "Not a tax ledger";
  const g = { gst: "GST", gst_rcm: "GST, reverse charge", gst_import: "GST on imports" }[p.what];
  if (g) return g + (p.side ? " " + p.side : "") + (p.tax ? " · " + p.tax.replace("+", " + ") : "") + (p.rate ? " · " + p.rate + "%" : "");
  return LedMaster.label(p.what) + (p.section ? " · " + LedCheck.secLabel(p.section) : "") + (p.rate ? " · " + p.rate + "%" : "");
};

function Row({ n, it, m }) {   // also called as Row({…}) to get its <tr>
  const p = LedCheck.pick(it), on = LedCheck.ticked(it), done = m && m.ok;
  return <tr data-key={n} data-conf={p.conf}>
    <td>{!done && <input type="checkbox" aria-label={"Confirm " + n} checked={on} onChange={(ev) => LedCheck.setTick(n, ev.target.checked)} />}</td>
    <td><b>{n}</b><div className="nr">{((S.books.ledInfo || {})[n] || {}).group || ""}</div></td>
    <td><b>{what(p)}</b>{p.fromAi && <div className="nr">AI’s answer: the rules could not settle it</div>}{done && <div className="ok">confirmed{m.okAt ? " " + fmtDate(String(m.okAt).slice(0, 10)) : ""}</div>}</td>
    <td style={{ whiteSpace: "normal" }}>{p.ev.map((e, i) => <div key={i} className="note"><span className={"tag " + (SRCC[e.src] || "")}>{LedCheck.SRC[e.src]}</span> {e.say}</div>)}</td>
    <td className={p.conf === "high" ? "ok" : p.conf === "low" ? "bad" : ""}>{p.conf}</td>
  </tr>;
}

export default function LedCheckCard({ b }) {
  const c = b.ledCheck, d = LedCheck.diff(b);
  const items = c ? Object.entries(c.items).filter(([n]) => (c.names || []).includes(n)) : [];
  const open = items.filter(([n]) => !((b.map || {})[n] || {}).ok), ticked = open.filter(([, it]) => LedCheck.ticked(it)).map(([n]) => n);
  const unclear = open.filter(([, it]) => it.s.conf === "low" && !it.ai).length;
  const showAll = S.lcAll, list = (showAll ? items : open).sort((a, x) => ({ high: 0, medium: 1, low: 2 }[LedCheck.pick(a[1]).conf] - { high: 0, medium: 1, low: 2 }[LedCheck.pick(x[1]).conf]) || a[0].localeCompare(x[0]));
  // review 18: the shared footer — a tick changed by the person is not saved until confirmed; leaving asks
  const changed = () => open.some(([, it]) => it.tick !== undefined);
  // dirty (leaving asks) only for a tick changed by hand; the button confirms FinCom's pre-ticked suggestions too
  const custom = { dirty: changed, canSave: () => ticked.length > 0, save: () => { doAct("lcConfirm"); return true; }, discard: () => { open.forEach(([, it]) => { delete it.tick; }); } };
  return <Confirm id="books:ledcheck" label="GST and TDS ledger check" custom={custom} saveText={"Confirm the " + ticked.length + " ticked"} empty={c && c.savedAt ? undefined : "Nothing confirmed yet"}><section className="dash-card" style={{ marginBottom: 12 }} data-ledcheck="">
    <h3>GST and TDS ledger check</h3>
    <p className="note">Each tax-like ledger is read three ways: Tally’s master (tax type, duty head, rate, nature of payment) as fact where set; how the day book uses it; and AI only for what is still unclear. Confirm what is right. {c && c.strict ? "Only confirmed ledgers count in the returns." : "Once saved, only confirmed ledgers count in the returns."}</p>
    {(d.fresh.length > 0 || d.changed.length > 0) && <div className="bk-alert" data-ledcheck-warn="">
      {d.fresh.length > 0 && <div>{d.fresh.length} new tax-like ledger{d.fresh.length === 1 ? "" : "s"} since the check: {d.fresh.slice(0, 6).join(", ")}{d.fresh.length > 6 ? "…" : ""}. Run the check for them.</div>}
      {d.changed.map((x) => <div key={x.n}><b>{x.n}</b> is used differently since it was confirmed ({x.was} → {x.now}): {x.say}. Check it again.</div>)}
    </div>}
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn small primary" onClick={() => doAct("lcRun")}>{c ? "Check again" : "Run the ledger check"}</button>
      {c && unclear > 0 && AIH.enabled("tds") && <button className="btn small" onClick={() => doAct("lcAi")}>Ask AI about the {unclear} unclear</button>}
      {c && <label className="chk"><input type="checkbox" checked={!!showAll} onChange={(ev) => setAndShow("lcAll", ev.target.checked)} /> show confirmed too</label>}
      {c && <span className="note">{open.length} to confirm · checked {fmtDateTime(c.ranAt)}{c.savedAt ? " · saved " + fmtDateTime(c.savedAt) + (c.savedBy ? " by " + c.savedBy : "") : ""}</span>}
    </div>
    {/* the one list table (spec K6): the ledger, its confidence (status), then the rest (Row draws a plain <tr>) */}
    {c && list.length > 0 && <div style={{ marginTop: 10 }}><ListRows name="lcTable" id="lcTable" className="bk-table compact" unit={["ledger", "ledgers"]}
      head={[{ label: "", role: "pick" }, { label: "Ledger", role: "party" }, { label: "Suggestion" }, { label: "Evidence" }, { label: "Confidence", role: "status" }]}>
      {list.map(([n, it]) => cloneElement(Row({ n, it, m: (b.map || {})[n] }), { key: n }))}</ListRows></div>}
    {c && !list.length && <p className="note">Every tax-like ledger is confirmed.</p>}
  </section></Confirm>;
}
