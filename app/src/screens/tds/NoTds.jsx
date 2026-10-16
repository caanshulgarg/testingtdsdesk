// round 65 (the owner's GB TEXCOAT, 16-Oct-2026): the TDS page when the books ARE in but hold no TDS. It said "TDS is worked
// out from the day book ... once either is in [Bring in from Tally]", as if the Day Book were missing. Now, plainly: no TDS
// deducted in the client's books over the period they cover; the TDS ledgers that have no entries, by name (not the TDS
// receivable: TDS deducted by the client's customers); and the existing "should have deducted" check (TDSWatch.missed,
// src/js/66) over each year of the books, so a missed deduction shows. The salary import stays. Nothing is worked out here
// that TDSWatch does not already.

const money = (v) => "₹" + INR.format(r2(v || 0));
const d8 = (x) => String(x || "").replace(/-/g, "").slice(0, 8);

// the period the books cover: the cloud copy's book (its from/to), else the first and last entries here
export function booksSpan(b) {
  const bk = typeof TCloud === "object" && TCloud.on() && TCloud.has(b.cid) ? TCloud.book(b.cid) : null;
  let from = bk && d8(bk.from), to = bk && d8(bk.to);
  if (!from || !to) {
    (b.vouchers || []).forEach((v) => { if (v.opt || v.cancel) return; const d = TDS.ymd(v.date).slice(0, 8); if (d.length !== 8) return;
      if (!from || d < from) from = d; if (!to || d > to) to = d; });
  }
  return from && to ? { from, to } : null;
}

// the client's TDS / TCS payable ledgers (by Tally's list, the group or the name) that no entry uses; a TDS receivable
// (under Loans & Advances or Current Assets, or named so) is the customers' TDS and is left out
export function emptyTdsLedgers(b) {
  const used = new Set();
  (b.vouchers || []).forEach((v) => (v.ent || []).forEach((e) => used.add(e.l)));
  let tl = {};
  try { tl = typeof TaxLed === "object" ? TaxLed.tally(b) : {}; } catch (e) { tl = {}; }
  const names = new Set(Object.keys(tl).concat(Object.keys(b.map || {})));
  return Array.from(names).filter((n) => {
    if (!n || used.has(n)) return false;
    const t = tl[n] || {}, chain = [t.group || (b.under || {})[n] || ""].concat(t.chain || []).join(" | "), k = Books.ledgerOf(n).kind || "";
    if (k === "tds_receivable" || /RECEIVABLE/i.test(n) || /loans|advances|current assets|deposits|receivable/i.test(chain)) return false;
    return k === "tds_payable" || /^(TDS|TCS)$/i.test(t.taxType || "") || !!t.nature || /(^|[^A-Z])(TDS|TCS)/i.test(n) || /(^|[^A-Z])(TDS|TCS)([^A-Z]|$)/i.test(chain);
  }).sort((x, y) => x.localeCompare(y));
}

// the years the books cover, earliest first
function yearsOf(span) {
  if (!span) return [];
  const out = [], y0 = num(TDS.fyOf(span.from).slice(0, 4)), y1 = num(TDS.fyOf(span.to).slice(0, 4));
  for (let y = y0; y <= y1 && out.length < 6; y++) out.push(y + "-" + String(y + 1).slice(2));
  return out;
}

export default function NoTds({ b }) {
  const co = CO() || {}, span = booksSpan(b), led = emptyTdsLedgers(b);
  let missed = [];
  try { missed = typeof TDSWatch === "object" ? [].concat(...yearsOf(span).map((y) => TDSWatch.missed(y).map((x) => Object.assign({ fy: y }, x)))) : []; } catch (e) { missed = []; }
  const due = r2(missed.reduce((a, x) => a + x.due, 0)), np = new Set(missed.map((x) => x.party)).size;
  return <div className="tg-empty" data-list-empty="" data-tds-none="">
    <p style={{ margin: 0, color: "var(--text)" }}><b>{"No TDS deducted in " + (co.name || "the client") + "’s books" + (span ? " (" + fmtDate(tallyDate(span.from)) + " to " + fmtDate(tallyDate(span.to)) + ")" : "") + "."}</b></p>
    {led.length > 0 && <p className="note" style={{ margin: "6px 0 0" }} data-tds-empty-ledgers="">{"TDS ledgers with no entries: " + led.join(", ")}</p>}
    {missed.length > 0 && <div style={{ textAlign: "left", marginTop: 14 }}>
      <p style={{ margin: "0 0 6px", color: "var(--text)" }} data-missed=""><b>{"Should have deducted: " + np + " part" + (np === 1 ? "y" : "ies") + ", TDS " + money(due)}</b></p>
      <p className="note" style={{ margin: "0 0 6px" }}>Payments past the TDS limit with no TDS entry against them.</p>
      <div className="bk-tablewrap"><table className="bk-table" data-statement="" data-tds-missed="">
        <thead><tr><th>Party</th><th>Year</th><th>Kind</th><th className="n">Paid</th><th className="n">Not covered by TDS</th><th className="n">TDS due</th></tr></thead>
        <tbody>{missed.slice(0, 10).map((x) => <tr key={x.fy + "|" + x.party + "|" + x.rule}>
          <td>{x.party}</td><td>{x.fy}</td><td>{x.section}<div className="nr">{x.limitWords}</div></td>
          <td className="n">{money(x.credited)}</td><td className="n">{money(x.uncovered)}</td><td className="n bad">{money(x.due)}<div className="nr">{"at " + x.rate + "%" + (x.pan ? "" : ", no PAN in Tally")}</div></td></tr>)}</tbody>
      </table></div>
      {missed.length > 10 && <p className="note">{"and " + (missed.length - 10) + " more"}</p>}
    </div>}
    <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 10 }}>
      <button className="btn small" onClick={() => doAct("salaryPick")}>Import salary for 24Q</button></div>
  </div>;
}
