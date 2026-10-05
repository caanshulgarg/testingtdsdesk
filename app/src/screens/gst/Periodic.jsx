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

// the quarter on one page (request of 02-Oct-2026): M1 IFF, M2 IFF, M3 (the quarter's GSTR-1) and the quarter, with
// counts, value, the file, the status and PMT-06; the column chosen says what goes in its file; the quarter's total is
// checked against 3B 3.1(a), FinCom's and as filed
const ST = { filed: ["Filed", "ok"], late: ["Filed after the 13th: counts as not filed", "bad"], skipped: ["IFF not filed", "warn"], missed: ["Not filed", "bad"], open: ["Not filed yet", "warn"] };
const agree = (v) => v == null ? null : Math.abs(v) < 1 ? <span className="tag ok">agrees</span> : <span className="tag bad">{"differs by " + m(v)}</span>;

function Status({ c }) {
  const [l, cls] = ST[c.state.s] || [c.state.s, ""];
  return <><span className={"tag " + cls}>{l}</span>
    {(c.state.on || c.state.arn) && <div className="nr">{(c.state.on ? d(c.state.on) : "") + (c.state.arn ? " · ARN " + c.state.arn : "")}</div>}</>;
}

function FileBox({ q, c, reg }) {
  const iff = c.kind === "iff";
  // the file's contents: a section of the page, not a warning box (round 3, 05-Oct-2026)
  return <div className="dash-card qfile" data-qfile={c.m} style={{ margin: "12px 0 0" }}>
    <b>What goes in this file: {c.label}</b>
    {iff ? <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
      <li>{pl(c.n, "invoice") + " to registered customers (table 4A)" + (c.notes ? " and " + pl(c.notes, "credit or debit note") + " (table 9B)" : "") + ", dated in " + GSTR.label(c.m) + "."}</li>
      <li>{"Taxable value " + m(c.taxable) + " net of notes, tax " + m(c.tax) + ". Sales to unregistered buyers (B2C) never go in an IFF: they go in the quarter’s GSTR-1."}</li>
      {c.over && <li className="bad">{"Above ₹50 lakh: the portal may refuse an IFF this large. If it does, choose “IFF not filed” and these go in the quarter’s GSTR-1."}</li>}
      {c.toQuarter && <li>{"This IFF was not filed, so its documents go in the quarter’s GSTR-1 instead."}</li>}
    </ul> : <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
      <li>{"B2B: " + pl(c.n, "invoice") + " " + m(c.b2b) + (c.notes ? "; notes " + pl(c.notes, "note") + " " + m(c.cdnr) : "") + (c.skipped.length ? ". Left out: what the filed IFFs of " + c.skipped.map((x) => GSTR.label(x)).join(" and ") + " carried." : ". No IFF filed in this quarter, so all three months are here.")}</li>
      <li>{"B2C small " + m(c.b2cs) + " (notes to buyers with no GSTIN netted in)" + (c.b2cl ? ", B2C large " + m(c.b2cl) : "") + (c.exp ? ", exports " + m(c.exp) : "") + ": all three months."}</li>
      {c.adv ? <li>{"Advances: received, not yet invoiced (table 11A) " + m(c.advAt) + "; adjusted against this quarter’s invoices (table 11B) " + m(c.advTxpd) + "."}</li> : null}
      {(c.advUnmatched || []).length > 0 && <li className="bad" data-adv-unmatched="">{"Not in table 11B: " + c.advUnmatched.map((x) => "receipt " + x.no + " of " + d(x.date) + " from " + x.party + ", " + m(x.taxable) + " (" + x.missing + ")").join("; ") + "."}</li>}
      <li>{"Taxable value " + m(c.taxable) + ", tax " + m(c.tax) + "."}</li>
    </ul>}
    <p style={{ margin: "8px 0 0" }}><b>Check against 3B 3.1(a):</b>{" " + q.cols.filter((x) => x.inFile).map((x) => x.label + " " + m(x.taxable)).concat([q.m3.label + " " + m(q.m3.taxable)]).join(" + ") + " = " + m(q.total) + "; 3B 3.1(a) for " + q.label + " " + m(q.r3a) + " "}{agree(q.diff)}</p>
    <p className="note" style={{ margin: "6px 0 0" }}>{"File name: "}<code>{c.file}</code>{". On the portal: Returns → " + (iff ? "GSTR-1/IFF → " + GSTR.label(c.m) + " → Prepare offline → Upload" : "GSTR-1 → " + q.label + " → Prepare offline → Upload") + "; wait for “Processed”, check the summary, then file with DSC or EVC."}</p>
  </div>;
}

function Changes({ c }) {
  const x = c.changes;
  if (!x || (!x.n && !x.added.length)) return null;
  return <div className="bk-alert bad" data-iff-changed={c.m} style={{ margin: "8px 0 0" }}>
    <b>{"Changed after the " + c.label + " was filed"}</b>
    {x.n > 0 && <><span>{": " + pl(x.n, "document") + " — needs an amendment (table 9A for an invoice, 9C for a note) in a later GSTR-1."}</span>
      <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{x.changed.map((y) => <li key={y.key}>{y.num + ": taxable " + m(y.was.txval) + " → " + m(y.txval)}</li>)}
        {x.gone.map((y) => <li key={y.key}>{y.num + ": no longer in the books (was " + m(y.txval) + ")"}</li>)}</ul></>}
    {x.added.length > 0 && <p className="note" style={{ margin: "4px 0 0" }}>{pl(x.added.length, "document") + " dated in " + GSTR.label(c.m) + " came in after the IFF: they go in the quarter’s GSTR-1 as new documents."}</p>}
  </div>;
}

export function Qrmp() {
  const ym = S.gstYm || "", reg = S.gstReg || "", qEnd = GSTSet.qEnd(ym), q = GSTQ.quarter(qEnd, reg), sel = S.gqCol || (GSTSet.isQEnd(ym) ? qEnd : ym);
  const cols = q.cols.concat([q.m3]), pick = cols.find((c) => c.m === sel) || q.m3;
  const head = (c) => <th key={c.m} className={"n" + (c.m === pick.m ? " on" : "")}><button className="linkbtn" data-gqcol={c.m} onClick={() => { S.gqCol = c.m; render(); }}>{c.label}</button></th>;
  const row = (label, f, total, key) => <tr key={key || label}><td>{label}</td>{cols.map((c) => <td key={c.m} className="n">{f(c)}</td>)}<td className="n"><b>{total}</b></td></tr>;
  return <section className="dash-card gq" data-qrmp={qEnd}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <h3 style={{ margin: 0 }}>{q.label} <span className="tag">Quarterly (QRMP)</span></h3>
      <label className="note">Filing frequency:{" "}
        <select aria-label="Filing type for this quarter" data-qtype="" style={{ width: "auto" }} value="qrmp" onChange={(ev) => gqQuarterType(ev.target.value)}>
          <option value="qrmp">quarterly (QRMP)</option><option value="monthly">monthly</option></select></label></div>
    <div className="bk-tablewrap" style={{ marginTop: 8 }}><table className="bk-table compact gf-off" data-qtable="" data-statement="">
      <thead><tr><th></th>{cols.map(head)}<th className="n">Quarter</th></tr></thead>
      <tbody>
        {row("Due", (c) => d(c.due), d(q.due3b) + " (3B)")}
        {row("B2B invoices", (c) => c.n, q.cols.filter((c) => c.inFile).reduce((a, c) => a + c.n, 0) + q.m3.n)}
        {row("Credit / debit notes", (c) => c.notes, q.cols.filter((c) => c.inFile).reduce((a, c) => a + c.notes, 0) + q.m3.notes)}
        {row("B2C (all three months)", (c) => c.kind === "iff" ? "—" : m(c.b2c), m(q.m3.b2c))}
        {q.m3.advAt ? row("Advances received (11A)", (c) => c.kind === "iff" ? "—" : m(c.advAt), m(q.m3.advAt)) : null}
        {q.m3.advTxpd ? row("Advances adjusted against invoices (11B)", (c) => c.kind === "iff" ? "—" : m(-c.advTxpd), m(-q.m3.advTxpd)) : null}
        {row("Taxable value, net of notes", (c) => <span data-qtaxable={c.m} style={c.toQuarter ? { textDecoration: "line-through" } : undefined}>{m(c.taxable)}</span>, <span data-qtotal="">{m(q.total)}</span>)}
        {row("Tax", (c) => m(c.tax), m(r2(q.cols.filter((c) => c.inFile).reduce((a, c) => a + c.tax, 0) + q.m3.tax)))}
        {row("As filed", (c) => c.filed == null ? <span className="note">—</span> : <span data-qfiled={c.m}>{m(c.filed)}</span>, <span data-qfiled-total="">{q.filedTotal == null ? "—" : m(q.filedTotal)}</span>)}
        {row("Books less filed", (c) => c.filed == null ? "—" : <span data-qdiff={c.m}>{m(r2(c.taxable - c.filed))}</span>, q.filedTotal == null ? "—" : m(r2(q.total - q.filedTotal)))}
        {row("Status", (c) => <Status c={c} />, q.r3bOn ? <><span className="tag ok">3B filed</span><div className="nr">{d(q.r3bOn)}</div></> : <span className="tag warn">3B not filed yet</span>)}
        {row("PMT-06", (c) => c.kind === "iff" ? (c.pmt.known ? m(c.pmt.total) + (c.pmt.paidTotal ? " · paid " + m(c.pmt.paidTotal) : "") : "—") : "—", m(GSTQ.H.reduce((a, k) => a + num(q.pmtPaid[k]), 0)) + " paid")}
      </tbody></table></div>
    {(q.m3.advUnmatched || []).length > 0 && <p className="bk-alert" data-adv-unmatched-q="" style={{ margin: "8px 0 0" }}>{"An advance adjustment with no invoice, left out of GSTR-1 table 11B and 3B: " + q.m3.advUnmatched.map((x) => "receipt " + x.no + " of " + d(x.date) + " from " + x.party + ", advance " + m(x.taxable) + " (received " + m(x.received) + ") marked as adjusted in " + GSTR.label(x.adjDate.slice(0, 6)) + " — " + x.missing).join("; ") + ". Change it under GST → Workings → Advances."}</p>}
    <div className="row" style={{ gap: 16, flexWrap: "wrap", marginTop: 8 }} data-q3a="">
      <span>{"3B 3.1(a), FinCom: " + m(q.r3a) + " "}{agree(q.diff)}</span>
      {q.r3aFiled != null && <span>{"As filed: GSTR-1 + IFF " + (q.filedTotal == null ? "—" : m(q.filedTotal)) + " · 3B 3.1(a) " + m(q.r3aFiled) + " "}{agree(q.filedDiff)}</span>}
    </div>
    <FileBox q={q} c={pick} reg={reg} />
    {pick.kind === "iff" ? <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
      <button className="btn small primary" data-iffjson="" disabled={pick.state.s === "skipped"} onClick={() => { S.gstYm = pick.m; gqIffJson(); }}>Download IFF JSON</button>
      <span className="note">Filed on</span><CommitBox type="date" aria-label={"IFF filed on " + pick.m} value={GSTF.peek(pick.m, reg).iff || ""} style={{ width: "auto" }} onCommit={(x) => gqIffFiled(pick.m, "iff", x)} />
      <span className="note">ARN</span><CommitBox aria-label={"IFF ARN " + pick.m} value={GSTF.peek(pick.m, reg).iffArn || ""} style={{ width: 170 }} onCommit={(x) => gqIffFiled(pick.m, "iffArn", x.trim())} />
      {pick.state.s === "skipped" ? <button className="btn small" data-iffskip="undo" onClick={() => gqIffSkip(pick.m, false)}>It was filed after all</button>
        : <button className="btn small" data-iffskip="" onClick={() => gqIffSkip(pick.m, true)}>IFF not filed</button>}
    </div> : <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
      <button className="btn small primary" onClick={() => { S.gstYm = qEnd; doAct("gstJson"); }}>Download GSTR-1 JSON for the quarter</button>
      <span className="note">Filed on</span><CommitBox type="date" aria-label="GSTR-1 filed on" value={GSTF.peek(qEnd, reg).r1 || ""} style={{ width: "auto" }} onCommit={(x) => { S.gstYm = qEnd; gstfSet("r1", x); }} />
      <button className="btn small" onClick={() => { S.gstYm = qEnd; doAct("gst3bJson"); }}>Download GSTR-3B JSON for the quarter</button>
      <span className="note"><code>{q.file3b}</code>: tables 3.1, 3.2, 4 and 5; PMT-06 paid ({m(GSTQ.H.reduce((a, k) => a + num(q.pmtPaid[k]), 0))}) is in the cash ledger and used first, still to pay {m(q.payable)}.</span>
    </div>}
    {q.cols.map((c) => <Changes key={c.m} c={c} />)}
    {pick.kind === "iff" && <Pmt06 ym={pick.m} reg={reg} />}
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
    <Step n={1} title="Table 4: purchases"><div className="bk-tablewrap"><table className="bk-table compact" data-statement=""><thead><tr><th></th><th className="n">Value</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th></tr></thead>
      <tbody>{[row("4A From registered suppliers (not reverse charge)", g.t4.reg), row("4B From registered suppliers, reverse charge", g.t4.regRcm), row("4C From unregistered suppliers, reverse charge", g.t4.unregRcm), row("4D Import of services", g.t4.imps)]}</tbody></table></div></Step>
    <Step n={2} title="Table 5: the year’s CMP-08s"><div className="bk-tablewrap"><table className="bk-table compact" data-statement="">
      <thead><tr><th>Quarter</th><th className="n">Turnover</th><th className="n">Tax</th><th className="n">Reverse charge</th>{est && <th className="n">Interest, estimate</th>}</tr></thead>
      <tbody>{g.quarters.map((x) => <tr key={x.q}><td>{x.label}</td><td className="n">{m(x.turnover)}</td><td className="n">{m(x.tax)}</td><td className="n">{m(all4(x.rcm))}</td>{est && <td className="n">{m(x.interest)}</td>}</tr>)}
        <tr><td><b>Year</b></td><td className="n"><b>{m(g.turnover)}</b></td><td className="n"><b>{m(g.tax)}</b></td><td className="n"><b>{m(all4(g.rcm))}</b></td>{est && <td className="n"><b>{m(g.interest)}</b></td>}</tr></tbody>
    </table></div></Step>
    <Step n={3} title="Table 6: sales by rate"><p>{GSTQ.RATES[GSTQ.compCat(reg)].l + ": turnover " + m(g.turnover) + ", tax " + m(g.tax) + "."}</p></Step>
    <p className="note">Tables 7 (TDS and TCS credit) and 8 (tax paid) are taken from the portal as filed through the year.</p>
  </section>;
}
