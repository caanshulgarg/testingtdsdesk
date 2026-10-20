// next-tds-retchallans (20-Oct-2026; the owner: "in a specific challan give the user options to add a challan in multiple
// ways"): Add challan › "Pick from other challans of this year". The year's challans with tax left that are not on this
// return's list (onChallan.js otherChallans), filtered in the column headers (date by month, section, balance), ticked and
// brought into the return in one click. A challan brought in stays with the return (onChallan.js pinChallans, kept with the
// books) until "Remove from this return" (the grid, only while no deduction of the return is on it).
import { useState } from "react";
import "../../lib/tdsGlobals.js";
import { SideDrawer } from "./Shell.jsx";
import { useCF, Th } from "./ColF.jsx";
import { otherChallans, pinChallans } from "./onChallan.js";
import "./clear.css";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monW = (ym) => (String(ym).length === 6 ? MON[+String(ym).slice(4, 6) - 1] + " " + String(ym).slice(0, 4) : ym);
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const chSec = (c) => TDSCH.secNorm(c.section) || "";

export function PickChallans({ form, fy, q, onClose }) {
  const cx = TDSReg.ctx(), key = TDSReg.key(form, fy, q), [sel, setSel] = useState({});
  const rows = otherChallans(form, fy, q, cx).map((c) => ({ c, bal: r2(TDSReg.balance(c, cx).tax) }));
  const cf = useCF("chpick", [
    { k: "date", title: "Date", kind: "pick", get: (x) => TDS.ymd(x.c.date).slice(0, 6), label: monW },
    { k: "sec", title: "Section", kind: "pick", get: (x) => chSec(x.c) || "—" },
    { k: "serial", title: "Serial", kind: "q", get: (x) => x.c.serial + " " + x.c.bsr, placeholder: "Serial or BSR" },
    { k: "bal", title: "Balance", kind: "num", get: (x) => x.bal },
  ], rows), shown = cf.shown;
  const picked = Object.keys(sel).filter((id) => sel[id] && rows.some((x) => x.c.id === id));
  const allOn = shown.length > 0 && shown.every((x) => sel[x.c.id]);
  const bring = () => { pinChallans(key, picked, true); toast(picked.length + " challan" + (picked.length === 1 ? "" : "s") + " brought into " + form + " " + q + " " + fy + "."); onClose(); };
  return <SideDrawer open onClose={onClose} kind="ch-pick" wide title="Pick from other challans of this year" description={rows.length + " other challan" + (rows.length === 1 ? "" : "s") + " of " + fy + " with tax left"}>
    <div data-ch-pick={key}>
      {!rows.length ? <p className="note">No other challan of {fy} has tax left.</p>
        : <div className="bk-tablewrap"><table className="bk-table gf-off" data-ch-pick-table="">
          <thead><tr><th className="ck"><input type="checkbox" checked={allOn} aria-label="Tick all shown" data-ch-pick-all="" onChange={(ev) => { const s = { ...sel }; shown.forEach((x) => { s[x.c.id] = ev.target.checked; }); setSel(s); }} /></th>
            <Th cf={cf} k="date" cls="dt">Date</Th><Th cf={cf} k="serial">Serial · BSR</Th><Th cf={cf} k="sec">Section</Th><th className="n">Tax</th><Th cf={cf} k="bal" cls="n">Balance</Th></tr></thead>
          <tbody>{shown.map((x) => <tr key={x.c.id} data-ch-pick-row={x.c.id}>
            <td className="ck"><input type="checkbox" checked={!!sel[x.c.id]} data-ch-pick-tick={x.c.id} aria-label={"Tick challan " + x.c.serial} onChange={(ev) => setSel({ ...sel, [x.c.id]: ev.target.checked })} /></td>
            <td className="dt">{day(x.c.date)}</td><td>{x.c.serial} · {x.c.bsr}</td><td>{chSec(x.c) || "—"}</td><td className="n">{money(num(x.c.tax))}</td><td className="n">{money(x.bal)}</td></tr>)}</tbody>
          {cf.on && <tfoot><tr className="wd-cffoot"><td colSpan={6}>{cf.foot("challans")}</td></tr></tfoot>}</table></div>}
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="button" className="btn" disabled={!picked.length} data-ch-pick-go={picked.length} onClick={bring}>{picked.length ? "Bring " + picked.length + " into this return" : "Tick the challans to bring in"}</button>
        <button type="button" className="linkbtn" onClick={onClose}>Cancel</button></div>
    </div>
  </SideDrawer>;
}
