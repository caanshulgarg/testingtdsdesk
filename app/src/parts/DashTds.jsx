// The Overview's TDS card (screens/Dash.jsx, under "More about this client"), in its own file with lib/behind.jsx.
// next-fix-client-open-freeze (FINCOM-APP-STAGING-V, staging 13-Nov-2026: 2,022 ms of script in IDBRequest.onsuccess on
// client/dash, a client opened from the sidebar): the card's books figure (the TDS page's Form 140 total for the year,
// TDS.rows) was worked out in the drawing itself, every entry of the books in one go (260 ms at full speed on 51,758
// made-up entries), in the task that opened the client, and again in the next frame once the books were saved. It is
// worked out behind the page now, in steps (TDS.allRowsIn, as the day's audit and MIS use it), and kept for the books as
// they are: "Working out…" in its place until then. The same figure as before (the same rows, the same sum).
/* global S, TDS, TCloud, CO, BOOKS_REV, num, goClient */
import { behind, Working } from "../lib/behind.jsx";

const sig = (b, fy) => () => {
  const x = typeof TCloud === "object" && TCloud.tdsl && TCloud.tdsl[b.cid], co = CO() || {};
  return [S.books, typeof BOOKS_REV === "number" ? BOOKS_REV : 0, b.vouchers, b.vouchers.length, b.map, b.mapV, b.under, b.groups, b.ledInfo, b.ledInfoAt, b.pans, b.salary, b.payroll, x && x.rows, co, co.supInvFrom, fy];
};
function* tdsSteps(fy) {
  try { yield* TDS.allRowsIn(); return TDS.rows().filter((r) => r.fy === fy).reduce((a, r) => a + num(r.tds), 0); } catch (e) { return null; }
}

export default function DashTds({ co, fy, tds, money }) {
  const b = S.books && S.books.cid === co.id && (S.books.vouchers || []).length ? S.books : null;
  const job = b ? behind("dash-tds:" + co.id, sig(b, fy), () => tdsSteps(fy)) : null, tdsBooks = job && job.v != null ? job.v : null;
  return <section className="dash-card" data-tone="violet"><h3>TDS {fy}</h3>
    <div className="dash-row"><span>On bills approved here</span><b>{money(tds)}</b></div>
    {(tdsBooks != null || (job && !job.done)) && <div className="dash-row"><span>In the books (Tally), {TDS.formShort("26Q", fy)}</span><b>{job.done || tdsBooks != null ? money(tdsBooks) : <Working />}</b></div>}
    <p className="note">{tdsBooks != null ? "The books’ figure is the TDS page’s for the year. " : "The books’ TDS for the year is on the TDS page. "}Deductees over their limit show in red on the bills list.</p>
    <button className="btn small" onClick={() => goClient("books:tds")}>Open TDS</button></section>;
}
