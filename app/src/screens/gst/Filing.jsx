// Filing, under GSTR-3B: the dates filed, the late fee and interest from the portal (and FinCom's estimate when
// switched on), the checks the portal runs (DRC-01B, DRC-01C), rule 37, and after filing: the 3B kept as filed and the
// set-off journal for Tally. Also GSTR-1A, under Amendments. Were viewGstFiling and viewGstr1a (src/js/35); the
// figures are GSTF (35); what is typed goes through gstfSet, gstfSnap, gstfJournal, gst1aJson (35).
import CommitBox from "../../parts/CommitBox.jsx";

const money = (v) => INR.format(r2(v || 0));
const dmy = (s) => GSTAmend.dmy(String(s || "").replace(/-/g, ""));
const SetLink = ({ children = "change in GST settings" }) => <button className="linkbtn" onClick={() => goGstSettings()}>{children}</button>;
const Card = ({ title, children }) => <section className="dash-card" style={{ marginTop: 12 }}><h3>{title}</h3>{children}</section>;
const H4 = ({ children }) => <h4 style={{ margin: "12px 0 4px" }}>{children}</h4>;

// a date filed, or a figure as the portal shows it
const DateIn = ({ k, v }) => <CommitBox type="date" aria-label={k === "r1" ? "GSTR-1 filed on" : "GSTR-3B filed on"} value={v || ""} style={{ width: "auto" }} onCommit={(x) => gstfSet(k, x)} />;
const Portal = ({ k, v }) => <CommitBox type="number" step="0.01" aria-label={k} value={v === undefined || v === "" ? "" : String(v)} placeholder="as on the portal" style={{ width: 140 }} onCommit={(x) => gstfSet(k, x)} />;
const Agrees = ({ est, portal }) => portal === undefined || portal === "" ? null : Math.abs(num(est) - num(portal)) < 1 ? <div className="nr">agrees</div> : <div className="bad">{"estimate ₹" + money(est)}</div>;

function ReturnRow({ label, nil, due, k, rec, f, feeKey, est }) {
  return <tr>
    <td>{label}{nil && <> <span className="nr">nil</span></>}</td><td>{dmy(due)}</td><td><DateIn k={k} v={rec[k]} /></td>
    {est && <><td className="n">{f.unknown ? <span className="nr">type the date filed</span> : f.days || "—"}</td>
      <td className="n">{f.fee ? <>{money(f.fee)}{f.estimated && <div className="nr">if filed today</div>}</> : "—"}</td></>}
    <td className="n"><Portal k={feeKey} v={rec[feeKey]} />{est && <Agrees est={f.fee} portal={rec[feeKey]} />}</td>
  </tr>;
}

const Flag = ({ on, children }) => <div className="dash-row"><span>{children}</span><b className={on ? "bad" : undefined}>{on ? "check before filing" : "within the limit"}</b></div>;

function Rule37({ b, reg, r }) {
  const on = !!((b.rule37On || {})[reg]);
  const Rows = ({ list, inTb }) => list.map((x, i) => <tr key={inTb + i}><td>{x.party}</td><td>{x.ref}</td><td>{fmtDate(tallyDate(x.date))}</td><td>{x.why}</td><td className="n">{money(x.tax)}</td><td>{inTb}</td></tr>);
  return <>
    <H4>Rule 37: suppliers unpaid after 180 days</H4><p className="note">{on ? "On for this GSTIN" : "Off for this GSTIN"} · <SetLink /></p>
    {on && <>{r && (r.rev.n || r.re.n) ? <div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th>Supplier</th><th>Bill</th><th className="dt">Date</th><th>Why</th><th className="n">Tax</th><th>In 3B</th></tr></thead>
      <tbody><Rows list={r.rev.list} inTb="4(B)(2) reversed" /><Rows list={r.re.list} inTb="4(A)(5) and 4(D)(1) reclaimed" /></tbody></table></div>
      : <p className="note">No bill reaches 180 days unpaid this month, and none reversed earlier was paid.</p>}
      <p className="note">Only bills kept bill-wise in Tally can be followed. Interest under section 50 applies to credit reversed here only where it was used to pay tax (rule 88B).</p></>}
  </>;
}

function AfterFiling({ ym, reg, rec }) {
  const J = GSTF.journal(ym, reg), pdfs = typeof GSTV === "object" ? ["r1", "r3b"].map((f) => [f, GSTV.copies(reg, f, ym)[0]]) : [];
  return <>
    <H4>After filing</H4>
    {pdfs.length > 0 && <p className="note">Portal PDFs: {pdfs.map(([f, r]) => GSTV.label(f) + " " + (r ? "✓ on file" : "not yet")).join(" · ")} · <button className="linkbtn" onClick={() => gstPartGo("vault")}>Returns filed</button></p>}
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {rec.snap ? <><span className="tag">3B kept as filed on {dmy(rec.r3b) || fmtDate(String(rec.snapAt || "").slice(0, 10))}</span><button className="linkbtn" onClick={() => gstfUnsnap()}>remove the kept copy</button></>
        : <button className="btn small" onClick={() => gstfSnap()}>Mark this 3B as filed and keep a copy</button>}
      <button className="btn small" onClick={() => gstfJournal()}>Set-off journal for Tally</button><span className="note">cash ledger in Tally: <b>{J.cashL}</b> · <SetLink /></span>
    </div>
    <p className="note">The kept copy is used for GSTR-9 and for the credit carried into the next month, so later changes in Tally do not move a month already filed.
      {J.missing.length > 0 && <>{" "}<b>{"Ledger not found in Tally: " + J.missing.join(", ") + (J.balanced ? "" : "; the journal will not balance until it is there") + "."}</b></>}</p>
  </>;
}

export function Filing({ b, t }) {
  const ym = S.gstYm || "", reg = S.gstReg || "", rec = GSTF.peek(ym, reg);
  const ftype = typeof GSTSet === "object" ? GSTSet.typeOf(ym, reg) : "monthly";
  if (ftype === "comp") return <Card title="Filing"><p className="note">This GSTIN is set as <b>composition</b>: GSTR-1 and GSTR-3B do not apply. CMP-08 for {GSTSet.qLabel(ym)} is due {dmy(GSTF.due(ym, "cmp08", reg))} and GSTR-4 by 30 June after the year. FinCom does not prepare CMP-08 or GSTR-4 yet; the working above is for reference only. <SetLink /></p></Card>;
  if (ftype === "qrmp" && !GSTSet.isQEnd(ym)) return <Card title="Filing"><p className="note">This GSTIN files <b>quarterly (QRMP)</b>: no GSTR-1 or 3B for {GSTR.label(ym)}. Invoices to registered customers may go in IFF by {dmy(GSTF.due(ym, "iff", reg))}, and tax is paid by PMT-06 by {dmy(GSTF.due(ym, "pmt06", reg))}. GSTR-1 and 3B for {GSTSet.qLabel(ym)} are due {dmy(GSTF.due(GSTSet.qEnd(ym), "r1", reg))} and {dmy(GSTF.due(GSTSet.qEnd(ym), "r3b", reg))}. <SetLink /></p></Card>;
  const nil3b = !(t.net.igst || t.net.cgst || t.net.sgst || t.rcmOut.igst || t.rcmOut.cgst || t.rcmOut.sgst || t.other.igst || t.other.cgst || t.other.sgst);
  const nil1 = !GSTR.outward(ym, reg).length;
  const f1 = GSTF.lateFee(ym, reg, "r1", nil1), f3 = GSTF.lateFee(ym, reg, "r3b", nil3b), it = GSTF.interest(ym, reg, t), dr = GSTF.drc(ym, reg, t), a = GSTF.aato(GSTF.fyOf(ym));
  // interest and late fee are the portal's: FinCom's own estimate shows only if switched on in GST settings (off by default)
  const est = !!b.gstEst;
  return (
    <Card title="Filing, interest and late fee">
      <div className="bk-tablewrap"><table className="bk-table compact">
        <thead><tr><th>Return</th><th>Due</th><th>Filed on</th>{est && <><th className="n">Days late</th><th className="n">Late fee, estimate</th></>}<th className="n">Late fee, from the portal</th></tr></thead>
        <tbody>
          <ReturnRow label="GSTR-1" nil={nil1} due={f1.due || GSTF.due(ym, "r1", reg)} k="r1" rec={rec} f={f1} feeKey="portalFee1" est={est} />
          <ReturnRow label="GSTR-3B" nil={nil3b} due={GSTF.due(ym, "r3b", reg)} k="r3b" rec={rec} f={f3} feeKey="portalFee3" est={est} />
        </tbody>
      </table></div>
      <div className="dash-row"><span>Interest under section 50, from the portal (table 5.1)</span><b><Portal k="portalInt" v={rec.portalInt} />{est && <Agrees est={it.total} portal={rec.portalInt} />}</b></div>
      <p className="note">Late fee and interest are the portal’s own figures. They will be fetched from the portal once the GST API is connected; until then type what the portal shows. GSTR-1’s late fee is charged by the portal in the next 3B.</p>
      {est && <p className="note"><b>FinCom’s estimate</b> (<SetLink>switched on in GST settings</SetLink>){"): late fee under section 47, ₹50 a day (₹20 for nil), capped at ₹" + money(f3.cap || f1.cap || 0).replace(/\.00$/, "") + " by the turnover of the year before"
        + (a.from === "part" || a.from === "none" ? " (not all of that year is in the books; type it in GST settings)" : "") + "."
        + (it.days && it.total ? " Interest under section 50(1), 18% a year on ₹" + money(t.quarter ? t.payable : t.pay.cash.igst + t.pay.cash.cgst + t.pay.cash.sgst + t.pay.cash.cess) + (t.quarter ? " still to pay after PMT-06" : " paid in cash") + " for " + it.days + " days" + (it.estimated ? " if filed today" : "") + ": ₹" + money(it.total) + "." : "")}</p>}
      <H4>Checks the portal runs</H4>
      <Flag on={dr.b.flag}>{"DRC-01B: tax in GSTR-1 (" + (dr.b.from === "filed" ? "as filed" : "from the books") + ") ₹" + money(dr.b.r1) + " against 3B ₹" + money(dr.b.r3) + ", short by ₹" + money(Math.max(0, dr.b.gap)) + " (limit ₹" + money(dr.b.lim) + ")"}</Flag>
      {dr.c.have2b ? <Flag on={dr.c.flag}>{"DRC-01C: credit in 3B 4(A)(5) ₹" + money(dr.c.claimed) + " against 2B ₹" + money(dr.c.avl) + ", above 2B by ₹" + money(Math.max(0, dr.c.gap)) + " (limit ₹" + money(dr.c.lim) + ")"}</Flag>
        : <div className="dash-row"><span>DRC-01C: credit against 2B</span><b className="nr">no 2B for this month</b></div>}
      <p className="note">Limits as notified under rules 88C and 88D (the higher of an amount and a percentage); a difference is not wrong in itself — reclaims, credit of earlier months and 2B timing explain most — but be ready to explain it.</p>
      <Rule37 b={b} reg={reg} r={t.r37} />
      <AfterFiling ym={ym} reg={reg} rec={rec} />
    </Card>
  );
}

const KIND_1A = { B2B: "B2B invoice", B2CL: "B2C large", EXP: "Export", CDNR: "Credit or debit note", B2CS: "B2C small" };

// GSTR-1A: after GSTR-1 is filed and before the month's 3B, a missed or wrong invoice put right for the same month
export function Gstr1a({ ym, reg }) {
  if (!ym || !reg) return null;
  const c = GSTAmend.can1a(ym, reg), label = GSTR.label(ym);
  if (!c.filed1) return null;
  const card = (body) => <Card title={"GSTR-1A for " + label}>{body}</Card>;
  if (c.qrmpMonth) return card(<p className="note">Quarterly (QRMP) filer: GSTR-1A is for the whole quarter, in its last month ({GSTR.label(GSTSet.qEnd(ym))}).</p>);
  if (!c.period) return card(<p className="note">GSTR-1A is available from the July 2024 period; for this month, differences go as amendments in a later GSTR-1.</p>);
  if (c.threeB) return card(<p className="note">The 3B for {label} is marked as filed, so GSTR-1A is closed; the differences above go as amendments in the next GSTR-1.</p>);
  const r = GSTAmend.json1a(ym, reg), n = r ? r.rows.length : 0;
  const intro = <p className="note">After GSTR-1 is filed and until the 3B for the month is filed (due {dmy(c.due)}), a missed invoice or a wrong one can be put right in GSTR-1A for the same month, so the tax lands in this month’s 3B and your customer sees it in this month’s 2B. Type the 3B filing date on the GSTR-3B tab once it is filed, and this closes.</p>;
  if (!n) return card(<>{intro}<p className="note">{c.kept ? "A GSTR-1A was made for this month and the books now agree with it." : "Nothing to put in GSTR-1A: the books agree with the GSTR-1 filed."}</p></>);
  return card(<>
    {intro}
    <div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th>Document</th><th>Number</th><th>Customer</th><th>What changes</th></tr></thead>
      <tbody>{r.rows.map((x, i) => { const d = x.now || x.was || {}; return <tr key={i}><td>{KIND_1A[x.kind] || x.kind}</td><td>{d.num || (x.b2cs ? "place " + x.b2cs.pos + ", " + x.b2cs.rt + "%" : "")}</td><td>{d.ctin || ""}</td><td>{(x.changes || []).join("; ")}</td></tr>; })}</tbody></table></div>
    <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn small primary" onClick={() => gst1aJson()}>Download GSTR-1A JSON ({n})</button></div>
    <p className="note">Downloading keeps a copy, so the next GSTR-1 does not report these again. This is a first version: check it opens in the offline tool, and send me a GSTR-1A JSON exported from the portal so the layout can be matched exactly.</p>
  </>);
}
