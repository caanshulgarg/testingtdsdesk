// Books -> Tie-out (phase 2, H54; migration 44): a month of the copy's period a row, the five figures typed from Tally
// (receivables, payables, cash and bank, profit, trial balance total) beside FinCom's own five for the same month-end
// (Rec.fincom, src/js/61: the helpers the books screens already use) and the difference of each. Save -> tally_tieout_save;
// the owner's Tick / Untick ("Tied out by <name> on <date>") and Lock month / Unlock (tally_month_lock / unlock). A
// ticked month is read-only for staff. Without migration 44: "not available until migration 44 runs".
import { useState, useEffect } from "react";

const money = (v) => v == null ? "" : INR.format(r2(v));
const who = (uid) => typeof memberName === "function" ? memberName(uid) : "a member of the firm";
const label = (m) => GSTR.label(m.slice(0, 4) + m.slice(5, 7));

function Month({ cid, m, t, no44 }) {
  const row = t.rows[m] || null, lock = t.locks[m] || null, msg = t.msg[m] || null;
  const owner = Rec.owner(), ticked = !!(row && row.ticked_at);
  const ro = no44 || !Rec.canWrite() || (ticked && !owner);
  const init = () => Object.fromEntries(Rec.FIGS.map(([k]) => [k, row && row[k] != null ? String(row[k]) : ""]).concat([["note", (row && row.note) || ""]]));
  const [v, setV] = useState(init);
  const sig = row ? JSON.stringify([row.saved_at, row.ticked_at]) : "";
  useEffect(() => { setV(init()); }, [sig]);
  const fc = Rec.fincom(cid, m);
  return <tr data-tieout-month={m}>
    <td><b>{label(m)}</b><div className="nr">{"to " + fmtDate(tallyDate(Rec.monthEnd(m)))}</div>
      {ticked && <div className="nr ok" data-tie-ticked="">{"Tied out by " + who(row.ticked_by) + " on " + fmtDate(String(row.ticked_at).slice(0, 10))}</div>}
      {lock && <div className="nr bad" data-tie-locked="" style={{ whiteSpace: "normal" }}>{"Locked: Tally changes to this month are held for your approval" + (lock.note ? " (" + lock.note + ")" : "")}</div>}
    </td>
    {Rec.FIGS.map(([k, name]) => {
      const typed = Rec.parse(v[k]), f = fc[k], d = typed == null || Number.isNaN(typed) || f == null ? null : r2(typed - f);
      return <td key={k} className="n" style={{ minWidth: 150 }}>
        <input type="text" inputMode="decimal" data-tie-fig={k} aria-label={name + " in Tally, " + label(m)} placeholder="from Tally" value={v[k]} disabled={ro} style={{ width: 130, textAlign: "right" }}
          onChange={(ev) => setV({ ...v, [k]: ev.target.value })} />
        <div className="nr" data-tie-fincom={k} title={f == null ? (fc.why[k] || "") : "FinCom’s figure"}>{f == null ? "FinCom: not available" : "FinCom " + money(f)}</div>
        <div className={"nr" + (d ? " bad" : d === 0 ? " ok" : "")} data-tie-diff={k} data-off={d ? "1" : "0"}>{d == null ? "" : d === 0 ? "0.00" : (d > 0 ? "+" : "") + money(d)}</div>
      </td>;
    })}
    <td style={{ minWidth: 200 }}>
      <input type="text" data-tie-note="" aria-label={"Note, " + label(m)} placeholder="Note" value={v.note} disabled={ro} style={{ width: 180 }} onChange={(ev) => setV({ ...v, note: ev.target.value })} />
      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        {!ro && <button className="btn small primary" data-tie-save="" onClick={() => Rec.tieSave(cid, m, v)}>Save</button>}
        {owner && !no44 && (ticked ? <button className="btn small" data-tie-untick="" onClick={() => Rec.tieSave(cid, m, v, false)}>Untick</button>
          : <button className="btn small" data-tie-tick="" onClick={() => Rec.tieSave(cid, m, v, true)}>Tick</button>)}
        {owner && !no44 && (lock ? <button className="btn small" data-tie-unlock="" onClick={() => Rec.unlock(cid, m)}>Unlock</button>
          : <button className="btn small" data-tie-lock="" onClick={() => Rec.lock(cid, m)}>Lock month</button>)}
      </div>
      {ticked && owner && <div className="nr">Changing a figure and saving takes the tick off.</div>}
      {msg && <div className={"nr" + (msg.err ? " bad" : "")} data-tie-msg="" style={{ whiteSpace: "normal" }}>{msg.busy ? "Saving…" : msg.err || msg.ok}</div>}
    </td>
  </tr>;
}

export default function Tieout({ b }) {
  const cid = S.coId;
  if (!TCloud.on()) return <section className="dash-card" data-tieout=""><h3>Tie-out with Tally</h3><p className="note">Sign in to the firm account to keep the month’s tie-out.</p></section>;
  const t = Rec.tieOf(cid), months = Rec.months(cid), no44 = !!t.no44;
  const nas = new Set();
  months.forEach((m) => { const f = Rec.fincom(cid, m); Rec.FIGS.forEach(([k, name]) => { if (f[k] == null) nas.add(name + ": " + f.why[k]); }); });
  return <section className="dash-card" data-tieout="">
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h3 style={{ margin: 0 }}>Tie-out with Tally</h3>
      <button className="linkbtn note" data-sync-open="" onClick={() => Rec.openActivity(cid)}>Sync activity of this client</button></div>
    <p className="note">For each month, type five figures from Tally as at the month’s end (Balance Sheet and Trial Balance in Tally) beside FinCom’s own from its copy of the books. A difference shows at once. Save keeps them with FinCom’s figures of the moment; the owner ticks a month that ties out and may lock it, so a later change in Tally to that month waits for approval.</p>
    {no44 && <p className="bk-warn" data-not-ready="">{"Tie-out: " + REC_NOT44 + ". FinCom’s figures are shown; nothing can be saved yet."}</p>}
    {t.err && <p className="bk-warn">{t.err}</p>}
    {!months.length ? <p className="note">No months yet: the copy of the books has no period. Read the books from Tally first.</p>
      : <div className="bk-tablewrap"><table className="bk-table" data-tieout-table="">
        <thead><tr><th>Month</th>{Rec.FIGS.map(([k, name]) => <th key={k} className="n">{name}</th>)}<th></th></tr></thead>
        <tbody>{months.map((m) => <Month key={m} cid={cid} m={m} t={t} no44={no44} />)}</tbody>
      </table></div>}
    {nas.size > 0 && <p className="note" data-tie-na="" style={{ marginTop: 8 }}>{"Not available from FinCom: " + [...nas].slice(0, 5).join("; ") + "."}</p>}
  </section>;
}
