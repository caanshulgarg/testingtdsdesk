// The client's Reconciliations (tds-layout, 14-Oct-2026; the owner: "26AS and TRACES don't belong as top tabs" of TDS):
// a page of its own in the sidebar (#/c/<client>/books/recon). Its first part, "TDS receivable vs 26AS", is what TDS ›
// 26AS & AIS was (tds/Files.jsx Recon26: the client's own 26AS, AIS or TIS against the TDS its books show as receivable,
// and a deductee's 26AS against the client's returns). The old address …/books/tds/<year>/26as opens it.
import { Recon26 } from "../tds/Files.jsx";
import HelpButton from "../../parts/HelpButton.jsx";
import { tdsBarYears } from "../TdsPage.jsx";

export default function Recon({ b }) {
  const rows = TDS.rows(), list = Array.from(new Set(tdsBarYears(b, rows))).sort().reverse();
  const fy = S.recFy && list.includes(S.recFy) ? S.recFy : S.tdsFy && list.includes(S.tdsFy) ? S.tdsFy : list[0];
  return <div data-recon-page="">
    <div className="rp-title"><h2 className="tg-h2">TDS receivable vs 26AS</h2>
      <span className="row" style={{ gap: 8 }}><label className="note">Year <select aria-label="Year" value={fy} onChange={(ev) => { S.recFy = ev.target.value; render(); }}>
        {list.map((f) => <option key={f} value={f}>{f}</option>)}</select></label><HelpButton /></span></div>
    <Recon26 fy={fy} />
  </div>;
}
