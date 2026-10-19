// round 65 (the owner's GB TEXCOAT, 16-Oct-2026): the TDS page when the books ARE in but hold no TDS. It said "TDS is worked
// out from the day book ... once either is in [Bring in from Tally]", as if the Day Book were missing. Now, plainly: no TDS
// deducted in the client's books over the period they cover; the TDS ledgers that have no entries, by name (not the TDS
// receivable: TDS deducted by the client's customers). The salary import stays. (The TDS not deducted is in Audit only, the
// owner of 19-Oct-2026.)

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

// the owner, 19-Oct-2026 ("you have shown TDS not deducted case at the top but TDS was deducted over it.. I don't want it
// there.. it should be in Audit only"): no line here of payments that may have needed TDS (round 69's "Payments that may
// have needed TDS ... see Audit"); the TDS not deducted is the Audit's finding alone (Audit.checks.tdsMissed, src/js/06)

export default function NoTds({ b }) {
  const co = CO() || {}, span = booksSpan(b), led = emptyTdsLedgers(b);
  return <div className="tg-empty" data-list-empty="" data-tds-none="">
    <p style={{ margin: 0, color: "var(--text)" }}><b>{"No TDS deducted in " + (co.name || "the client") + "’s books" + (span ? " (" + fmtDate(tallyDate(span.from)) + " to " + fmtDate(tallyDate(span.to)) + ")" : "") + "."}</b></p>
    {led.length > 0 && <p className="note" style={{ margin: "6px 0 0" }} data-tds-empty-ledgers="">{"TDS ledgers with no entries: " + led.join(", ")}</p>}
    <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 10 }}>
      <button className="btn small" onClick={() => doAct("salaryPick")}>Import salary for 24Q</button></div>
  </div>;
}
