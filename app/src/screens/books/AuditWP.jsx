// Audit › Working papers: the audit of the books for a period (AuditWP, src/js/77-audit.js; FinCom's own checks, no AI).
// One row per check, in risk order: the result, the entries (opened under the row, each opening the entry in Look up),
// the reviewer's status (Not reviewed, Reviewed, Issue) and a remark, kept per client and period with the books as items
// (b.auditWp). Excel (real numbers, totals as formulas) and PDF (the browser's print, A4).
// State: S.awp {cid, from, to, res, open: {checkId: true}}.
import CommitBox from "../../parts/CommitBox.jsx";
import DateBox from "../../parts/DateBox.jsx";
import Tag from "../../parts/Tag.jsx";
// AuditWP (src/js/77-audit.js) comes with this screen's file, not in legacy.js (build.py lazy_files)
import "../../../../src/js/77-audit.js";

const m = (v) => money(r2(v || 0));
const d = (x) => (x ? fmtDate(tallyDate(x)) : "");
const iso = (x) => (x && x.length === 8 ? x.slice(0, 4) + "-" + x.slice(4, 6) + "-" + x.slice(6, 8) : "");
const RES = { flag: ["bad", "Flag"], ok: ["ok", "OK"], na: ["no", "Does not apply"], error: ["warn", "Could not check"] };
const STK = { nr: "no", rev: "ok", issue: "bad" };

function Entries({ c }) {
  if (!c.entries.length) return <p className="note" style={{ margin: "6px 0" }}>{c.note}</p>;
  return <div data-awp-entries={c.id} style={{ margin: "6px 0 10px" }}>
    <p className="note" style={{ margin: "0 0 6px" }}>{c.note}</p>
    <div className="bk-tablewrap"><table className="bk-table gf-off" data-statement="">
      <thead><tr><th className="dt">Date</th><th>Voucher</th><th>Type</th><th>Party or ledger</th><th className="n">Amount</th><th>Why</th></tr></thead>
      <tbody>{c.entries.slice(0, 200).map((e) => <tr key={e.id} data-entry={e.id}>
        <td style={{ whiteSpace: "nowrap" }}>{d(e.date)}</td>
        <td>{e.vid ? <button className="linkbtn" title="Open the entry in Look up" onClick={() => AuditWP.openEntry(e)}>{e.no || "open"}</button> : e.no}</td>
        <td>{e.type}</td><td>{e.party}</td><td className="n">{m(e.amount)}</td><td>{e.note}</td></tr>)}</tbody>
    </table></div>
    {c.entries.length > 200 && <p className="note">The first 200 of {c.count}; all are in the Excel.</p>}
  </div>;
}

function Row({ c, per, s }) {
  const w = AuditWP.wp(per, c.id), open = !!s.open[c.id], [rk, rl] = RES[c.status] || RES.error;
  const toggle = () => { s.open = { ...s.open, [c.id]: !open }; render(); };
  return <>
    <tr data-awp-check={c.id} className={c.status === "flag" ? "" : "muted"}>
      <td className="n">{c.rank || ""}</td>
      <td><button className="linkbtn" aria-expanded={open} style={{ fontWeight: 600, textAlign: "left" }} onClick={toggle}>{(open ? "▾ " : "▸ ") + c.title}</button><div className="nr">{c.law}</div></td>
      <td><Tag kind={rk}>{rl}</Tag></td>
      <td className="n">{c.count}</td>
      <td className="n">{m(c.amount)}</td>
      <td className="n">{c.score || ""}</td>
      <td><select aria-label={"Review of " + c.title} data-awp-status={c.id} data-kind={STK[w.status || "nr"]} style={{ width: "auto", borderLeft: "4px solid " + (w.status === "issue" ? "var(--bad)" : w.status === "rev" ? "var(--ok)" : "var(--line, #ccd)") }} value={w.status || "nr"}
        onChange={(ev) => { AuditWP.setWp(per, c.id, "status", ev.target.value); render(); }}>{AuditWP.STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
      <td style={{ minWidth: 180 }}><CommitBox aria-label={"Remarks on " + c.title} data-fk={"awp-" + c.id} value={w.remark || ""} placeholder="Remarks" style={{ width: "100%" }} onCommit={(v) => { AuditWP.setWp(per, c.id, "remark", v); render(); }} /></td>
    </tr>
    {open && <tr className="awp-open"><td></td><td colSpan={7}><Entries c={c} /></td></tr>}
  </>;
}

export default function WorkingPapers({ b }) {
  const s = AuditWP.st(), res = s.res && s.res.from === s.from && s.res.to === s.to ? s.res : null, per = s.from + "-" + s.to;
  const kept = AuditWP.items(b).find((x) => x.id === "run|" + per);
  const order = res ? res.ranked.map((id) => res.checks.find((c) => c.id === id)) : [];
  const fl = order.filter((c) => c.status === "flag"), done = order.filter((c) => (AuditWP.wp(per, c.id).status || "nr") !== "nr").length;
  const setD = (k, v) => { const x = String(v || "").replace(/-/g, ""); if (/^\d{8}$/.test(x)) { s[k] = x; render(); } };
  return <div data-awp="">
    <section className="dash-card">
      <h3 style={{ marginTop: 0 }}>Working papers</h3>
      <p className="note">FinCom's own checks over the books for the period (no AI): cash limits, TDS, MSME dues, GST against 2B and the returns filed, 26AS, duplicates, round sums, dates, unusual ledgers and Benford's law. The risk score comes from the amount, the number of entries and the check's weight. Mark each check and write your remarks; they are kept with the client's books for this period.</p>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="f" style={{ minWidth: 150 }}><span>From</span><DateBox aria-label="Working papers from" key={"f" + s.from} defaultValue={iso(s.from)} onChange={(ev) => setD("from", ev.target.value)} /></label>
        <label className="f" style={{ minWidth: 150 }}><span>To</span><DateBox aria-label="Working papers to" key={"t" + s.to} defaultValue={iso(s.to)} onChange={(ev) => setD("to", ev.target.value)} /></label>
        <button className="btn small primary" data-awp-run="" onClick={() => { s.busy = true; render(); setTimeout(() => { try { AuditWP.go(); } finally { s.busy = false; render(); } }, 20); }}>{s.busy ? "Running…" : "Run"}</button>
        {res && <><button className="btn small" data-awp-excel="" onClick={() => AuditWP.excel(res).then(() => toast("Downloaded."), (e) => toast("Could not build the file: " + (e && e.message)))}>Excel</button>
          <button className="btn small" data-awp-pdf="" onClick={() => AuditWP.pdf(res)}>PDF</button></>}
      </div>
      {!res && kept && <p className="note" style={{ marginTop: 8 }}>{"Last run on " + fmtDateTime(kept.at) + (kept.by ? " by " + kept.by : "") + " (result code " + kept.code + "). Run again to see the entries."}</p>}
    </section>
    {res && <>
      <div className="note" data-awp-runline="" style={{ margin: "10px 0" }}>{"Run on " + fmtDateTime(res.at) + " for " + d(res.from) + " to " + d(res.to) + ": " + res.entries + " entries, in " + res.ms + " ms. Result code " + res.code + " (the same books always give the same code)."}</div>
      <div className="dash-tiles">
        <div className={"dtile" + (fl.length ? " warn" : "")}><span>Flagged</span><b data-awp-flagged="">{fl.length}</b><small>{"of " + order.length + " checks"}</small></div>
        <div className="dtile"><span>Amount involved</span><b>{m(fl.reduce((t, c) => t + c.amount, 0))}</b><small>{fl.reduce((t, c) => t + c.count, 0) + " entries"}</small></div>
        <div className="dtile"><span>Reviewed</span><b>{done}</b><small>{"of " + order.length + "; " + order.filter((c) => AuditWP.wp(per, c.id).status === "issue").length + " issues"}</small></div>
      </div>
      <section className="dash-card" style={{ marginTop: 12 }}>
        <div className="bk-tablewrap"><table className="bk-table gf-off" data-awp-table="">
          <thead><tr><th className="n">Rank</th><th>Check</th><th>Result</th><th className="n">Entries</th><th className="n">Amount</th><th className="n">Risk</th><th>Review</th><th>Remarks</th></tr></thead>
          <tbody>{order.map((c) => <Row key={c.id} c={c} per={per} s={s} />)}</tbody>
          <tfoot><tr><td></td><td><b>Total</b></td><td></td><td className="n"><b>{order.reduce((t, c) => t + c.count, 0)}</b></td><td className="n"><b>{m(order.reduce((t, c) => t + c.amount, 0))}</b></td><td></td><td></td><td></td></tr></tfoot>
        </table></div>
      </section>
    </>}
  </div>;
}
