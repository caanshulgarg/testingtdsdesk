// The returns of a quarterly (QRMP) or composition GSTIN, as numbered steps: in the first two months of a quarter IFF
// and PMT-06, in its last month GSTR-1 and 3B for the quarter; for composition, CMP-08 each quarter and GSTR-4 for the
// year. Were viewQrmp, viewCmp08 and viewGstr4 (src/js/37). The figures are GSTQ (37); what is typed goes through
// gqSetField, gqSetPaid, gqIffJson (37) and gstfSet (35).
import CommitBox from "../../parts/CommitBox.jsx";

const m = (v) => "₹" + INR.format(r2(v || 0));
const d = (s) => s ? GSTAmend.dmy(String(s).replace(/-/g, "")) : "";
const pl = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const all4 = (x) => x.igst + x.cgst + x.sgst + x.cess;
const Row = ({ label, value, bold }) => <div className="dash-row"><span>{bold ? <b>{label}</b> : label}</span><b>{value}</b></div>;
const Actions = ({ children }) => <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>{children}</div>;

// one step: its number, or a tick when done
function Step({ n, title, done, children }) {
  return <div className={"gq-step" + (done ? " done" : "")}><div className="gq-n">{done ? "✓" : n}</div><div className="gq-b"><div className="gq-t">{title}</div>{children}</div></div>;
}
const FiledOn = ({ k, v, ym, label }) => <CommitBox type="date" aria-label={label} value={v || ""} style={{ width: "auto" }} onCommit={(x) => gqSetField(k, x, ym)} />;

function Iff({ ym, reg, rec }) {
  const f = GSTQ.iff(ym, reg), due = d(GSTF.due(ym, "iff", reg));
  return <Step n={1} title={"IFF — optional, by " + due} done={GSTQ.iffFiled(ym, reg) || !f.all}>
    {f.all ? <>
      <p>{pl(f.n, "invoice") + (f.notes ? " and " + pl(f.notes, "note") : "") + " to registered customers" + (f.over ? " in the IFF" : "") + ", value " + m(f.val) + ", tax " + m(f.tax) + ". Filing IFF lets your customers take the credit this month instead of at quarter end."}</p>
      {f.over && <p className="note"><b>IFF allows ₹50 lakh a month.</b>{" The month has " + f.all + " documents worth " + m(f.allVal) + "; the IFF file carries the first " + (f.n + f.notes) + " by date, and the other " + f.left + " go in the quarter’s GSTR-1."}</p>}
      <Actions><button className="btn small" onClick={() => gqIffJson()}>Download IFF JSON</button><span className="note">Filed on</span><FiledOn k="iff" v={rec.iff} label="IFF filed on" /></Actions>
      {rec.iff && (GSTQ.iffFiled(ym, reg) ? <p className="note">Filed: these are already on the portal and flow into the quarter’s GSTR-1 by themselves, so the GSTR-1 file here leaves them out.</p>
        : <p className="bad">IFF cannot be filed after {due}: these invoices go in the quarter’s GSTR-1 instead.</p>)}
    </> : <p>No invoices to registered customers this month; nothing to file.</p>}
  </Step>;
}

function Pmt06({ ym, reg }) {
  const p = GSTQ.pmt06(ym, reg);
  return <Step n={2} title={"Pay tax by PMT-06 — by " + d(p.due)} done={p.paidTotal > 0 || (p.known && !p.total)}>
    <p><select aria-label="PMT-06 method" style={{ width: "auto" }} value={p.method} onChange={(ev) => gqSetField("pmtMethod", ev.target.value)}>
      <option value="fixed">Fixed sum (35% method)</option><option value="self">Self-assessment (this month’s tax)</option></select></p>
    {p.known ? <><p><b>{m(p.total)}</b> to pay: {p.why}.</p>
      {p.total ? <p className="note">{"IGST " + m(p.amt.igst) + " · CGST " + m(p.amt.cgst) + " · SGST " + m(p.amt.sgst) + (p.amt.cess ? " · cess " + m(p.amt.cess) : "")}</p> : <p className="note">Nothing to pay this month.</p>}</>
      : <p className="note">{p.why}.</p>}
    <Actions><span className="note">Paid:</span>{GSTQ.H.map((k) => <label key={k} className="note">{k.toUpperCase()}{" "}
      <CommitBox type="number" step="1" aria-label={"PMT-06 paid " + k} value={p.paid[k] != null ? String(p.paid[k]) : ""} style={{ width: 110 }} onCommit={(x) => gqSetPaid(k, x)} /></label>)}</Actions>
    <p className="note">What you pay here sits in the cash ledger and is used in the quarter’s 3B.</p>
  </Step>;
}

// the quarter's last month: GSTR-1 and 3B for the whole quarter
function QuarterReturns({ qEnd, reg }) {
  const r1 = GSTQ.r1Q(qEnd, reg), t = GSTR.threeB(qEnd, reg), j = r1.json, filed = GSTF.peek(qEnd, reg);
  const cnt = (k) => (j[k] || []).reduce((a, g) => a + (g.inv || g.nt || []).length, 0), sumH = (o) => GSTQ.H.reduce((a, k) => a + num(o[k]), 0);
  return <>
    <p className="note">Two returns for the whole quarter, {t.months.map((x) => GSTR.label(x)).join(", ")}:</p>
    <Step n={1} title={"GSTR-1 for the quarter — by " + d(GSTF.due(qEnd, "r1", reg))} done={!!filed.r1}>
      <p>{cnt("b2b") + " B2B invoices, " + cnt("cdnr") + " notes, " + (j.b2cs || []).length + " B2C small lines, " + (cnt("b2cl") + cnt("exp")) + " B2C large and export invoices."
        + (r1.skipped.length ? " Invoices already sent in IFF for " + r1.skipped.map((x) => GSTR.label(x)).join(" and ") + " are left out." : "")}</p>
      <Actions><button className="btn small primary" onClick={() => doAct("gstJson")}>Download GSTR-1 JSON for the quarter</button><span className="note">Filed on</span>
        <CommitBox type="date" aria-label="GSTR-1 filed on" value={filed.r1 || ""} style={{ width: "auto" }} onCommit={(x) => gstfSet("r1", x)} /></Actions>
    </Step>
    <Step n={2} title={"GSTR-3B for the quarter — by " + d(GSTF.due(qEnd, "r3b", reg))} done={!!filed.r3b}>
      <Row label="Tax for the quarter (after credit)" value={m(sumH(t.pay.cash))} />
      <Row label="Less: paid by PMT-06 in the first two months" value={m(sumH(t.pmt))} />
      <Row label="Still to pay" value={m(t.payable)} bold />
      {GSTQ.H.some((k) => t.pmtLeft[k] > 0) && <p className="note">{"PMT-06 paid more than needed: " + m(GSTQ.H.reduce((a, k) => a + t.pmtLeft[k], 0)) + " stays in the cash ledger."}</p>}
      <Actions><button className="btn small primary" onClick={() => doAct("gst3bJson")}>Download GSTR-3B JSON for the quarter</button></Actions>
      <p className="note">The full 3B working is on the GSTR-3B tab.</p>
    </Step>
  </>;
}

export function Qrmp() {
  const ym = S.gstYm || "", reg = S.gstReg || "", qEnd = GSTSet.qEnd(ym), first = !GSTSet.isQEnd(ym), rec = GSTF.peek(ym, reg), q = GSTSet.qLabel(ym);
  return <section className="dash-card gq"><h3>{q + " · " + GSTR.label(ym)} <span className="tag">Quarterly (QRMP)</span></h3>
    {first ? <>
      <p className="note">This month has no GSTR-1 or 3B. Two things only:</p>
      <Iff ym={ym} reg={reg} rec={rec} />
      <Pmt06 ym={ym} reg={reg} />
      <p className="note">GSTR-1 and GSTR-3B for {q} are due {d(GSTF.due(qEnd, "r1", reg))} and {d(GSTF.due(qEnd, "r3b", reg))}.</p>
    </> : <QuarterReturns qEnd={qEnd} reg={reg} />}
  </section>;
}

export function Cmp08() {
  const ym = S.gstYm || "", reg = S.gstReg || "", qEnd = GSTSet.qEnd(ym), c = GSTQ.cmp08(qEnd, reg), rec = GSTF.peek(qEnd, reg);
  return <section className="dash-card gq"><h3>{"CMP-08 · " + GSTSet.qLabel(qEnd)} <span className="tag">Composition</span></h3>
    <p className="note">One statement a quarter, due {d(c.due)}. Fill these figures on the portal (Returns → CMP-08).</p>
    <Step n={1} title="Turnover and tax">
      <Row label={"Sales in the quarter" + (c.cat.base === "taxable" ? " (taxable supplies)" : "")} value={m(c.turnover)} />
      <div className="dash-row"><span>Rate: {c.cat.l} (<button className="linkbtn" onClick={() => goGstSettings()}>change in GST settings</button>)</span><b>{m(c.tax)}</b></div>
      <p className="note">{"CGST " + m(c.cgst) + " · SGST " + m(c.sgst) + (c.cat.base === "taxable" && c.exempt ? " · exempt sales " + m(c.exempt) + " carry no tax" : "")}</p>
    </Step>
    <Step n={2} title="Tax on purchases under reverse charge"><Row label="Reverse charge in the quarter" value={m(all4(c.rcm))} /></Step>
    <Step n={3} title="Pay and file" done={!!rec.cmp08}>
      <Row label="Total to pay, in cash" value={m(c.payable)} bold />
      {c.late && S.books.gstEst ? <p className="note">{"FinCom’s estimate: filed " + c.late + " days late, interest " + m(c.interest) + " (18% a year). The portal’s figure is the one to pay."}</p> : null}
      <div className="row" style={{ gap: 8, alignItems: "center" }}><span className="note">Filed on</span><FiledOn k="cmp08" v={rec.cmp08} ym={qEnd} label="CMP-08 filed on" /></div>
      <p className="note">A composition dealer takes no input tax credit and charges no tax on its invoices.</p>
    </Step>
  </section>;
}

export function Gstr4() {
  const reg = S.gstReg || "", fy = GSTF.fyOf(S.gstYm || ""), g = GSTQ.gstr4(fy, reg), est = !!S.books.gstEst;
  const row = (l, x) => <tr key={l}><td>{l}</td><td className="n">{m(x.taxable)}</td><td className="n">{m(x.igst)}</td><td className="n">{m(x.cgst)}</td><td className="n">{m(x.sgst)}</td></tr>;
  return <section className="dash-card gq"><h3>{"GSTR-4 · " + fy} <span className="tag">Composition, the year</span></h3>
    <p className="note">The annual return, due {d(g.due)}. Fill these figures on the portal (Returns → GSTR-4).</p>
    <Step n={1} title="Table 4: purchases"><div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th></th><th className="n">Value</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th></tr></thead>
      <tbody>{[row("4A From registered suppliers (not reverse charge)", g.t4.reg), row("4B From registered suppliers, reverse charge", g.t4.regRcm), row("4C From unregistered suppliers, reverse charge", g.t4.unregRcm), row("4D Import of services", g.t4.imps)]}</tbody></table></div></Step>
    <Step n={2} title="Table 5: the year’s CMP-08s"><div className="bk-tablewrap"><table className="bk-table compact">
      <thead><tr><th>Quarter</th><th className="n">Turnover</th><th className="n">Tax</th><th className="n">Reverse charge</th>{est && <th className="n">Interest, estimate</th>}</tr></thead>
      <tbody>{g.quarters.map((x) => <tr key={x.q}><td>{x.label}</td><td className="n">{m(x.turnover)}</td><td className="n">{m(x.tax)}</td><td className="n">{m(all4(x.rcm))}</td>{est && <td className="n">{m(x.interest)}</td>}</tr>)}
        <tr><td><b>Year</b></td><td className="n"><b>{m(g.turnover)}</b></td><td className="n"><b>{m(g.tax)}</b></td><td className="n"><b>{m(all4(g.rcm))}</b></td>{est && <td className="n"><b>{m(g.interest)}</b></td>}</tr></tbody>
    </table></div></Step>
    <Step n={3} title="Table 6: sales by rate"><p>{GSTQ.RATES[GSTQ.compCat(reg)].l + ": turnover " + m(g.turnover) + ", tax " + m(g.tax) + "."}</p></Step>
    <p className="note">Tables 7 (TDS and TCS credit) and 8 (tax paid) are taken from the portal as filed through the year.</p>
  </section>;
}
