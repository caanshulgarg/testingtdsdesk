// Three GST workings for the month: amendments to earlier GSTR-1s, tax on advances (tables 11A and 11B), and credit
// reversed under rules 42 and 43. Were viewGstAmend, viewGstAdv and viewGstRev (src/js/18). The figures come from
// GSTAmend (13), GSTAdv (14) and GSTRev (15); what the user corrects is saved by amendSetAct, advFix, assetSet
// (src/js/23). GSTR-1A under Amendments is Filing.jsx.
import CommitBox from "../../parts/CommitBox.jsx";
import { Gstr1a } from "./Filing.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
const Card = ({ title, children, style }) => <section className="dash-card" style={{ marginTop: 12, ...style }}>{title && <h3>{title}</h3>}{children}</section>;
const Tile = ({ label, value, small, warn }) => <div className={"dtile" + (warn ? " warn" : "")}><span>{label}</span><b>{value}</b>{[].concat(small || []).map((s, i) => <small key={i}>{s}</small>)}</div>;

/* ---------- Amendments ---------- */
const KIND = { B2B: "B2B invoice", B2CL: "B2C large invoice", EXP: "Export invoice", CDNR: "Credit or debit note", B2CS: "B2C small, month total" };
const TABLE = { B2B: "9A", B2CL: "9A", EXP: "9A", CDNR: "9C", B2CS: "10" };

// B2C small in a filed copy (n.b2cs is a Map)
const b2csTotal = (n) => { let s = 0; n.b2cs.forEach((x) => { s += num(x.txval); }); return s; };

function FiledCopies({ all }) {
  return (
    <section className="dash-card"><h3>Filed GSTR-1 returns kept here</h3>
      <p className="note">Amendments are found by comparing the books now with what was filed. A copy is kept each time the GSTR-1 JSON is downloaded here; for a month filed some other way, bring in the JSON that was uploaded to the portal.</p>
      <div className="row" style={{ gap: 8, margin: "8px 0" }}><button className="btn small primary" onClick={() => doAct("filedPick")}>Bring in filed GSTR-1 JSON</button></div>
      {all.length ? <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th>Month</th><th>Registration</th><th>Copy from</th><th className="dt">Kept on</th><th className="n">Documents</th><th className="n">B2C small</th><th>Not filed</th></tr></thead>
        <tbody>{all.map((f) => { const n = GSTAmend.norm(f.json), key = f.gstin + "|" + f.fp; return <tr key={key}>
          <td>{GSTR.label(f.ym)}</td><td>{f.gstin}</td><td>{f.source === "portal" ? "brought in" : "downloaded here"}</td><td>{fmtDate(String(f.at).slice(0, 10))}</td>
          <td className="n">{n.docs.size}</td><td className="n">{money(b2csTotal(n))}</td>
          <td><input type="checkbox" checked={!!f.notFiled} aria-label="This copy was not filed" onChange={(ev) => filedSetNotFiled(key, ev.target.checked)} /></td></tr>; })}</tbody>
      </table></div> : <p className="note">None yet.</p>}
    </section>
  );
}

function BooksAgainstFiled({ c, ym }) {
  return (
    <Card title={GSTR.label(ym) + ": the books against the return filed"}>
      <div className="dash-row"><span>Taxable value filed</span><b>{money(c.filedTotal)}</b></div><div className="dash-row"><span>Taxable value in the books now</span><b>{money(c.booksTotal)}</b></div>
      {Math.abs(c.b2csF - c.b2csB) >= 1 && <div className="dash-row"><span>B2C small: filed / books</span><b>{money(c.b2csF) + " / " + money(c.b2csB)}</b></div>}
      {c.rows.length ? <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th>Document</th><th>Party</th><th>Number</th><th className="dt">Date</th><th>What differs</th></tr></thead>
        <tbody>{c.rows.slice(0, gfN(200)).map((r, i) => <tr key={i}><td>{KIND[r.kind] || r.kind}</td><td>{r.doc.ctin || "—"}</td><td>{r.doc.num}</td><td>{day(r.doc.date)}</td><td>{r.changes.join("; ")}</td></tr>)}</tbody>
      </table></div> : <p className="note">Every document in the books matches the return filed.</p>}
      <p className="note">Differences here are reported as amendments in a later month’s return, not by filing this month again.</p>
    </Card>
  );
}

function ToReport({ p, ym }) {
  const live = p.rows.filter((r) => r.act !== "skip"), count = (f) => live.filter(f).length;
  const optsOf = (r) => r.what === "amend" ? [["amend", "amendment (" + TABLE[r.kind] + ")"], ["skip", "leave it"]]
    : r.what === "gone" ? [["nil", "amendment to nil (" + TABLE[r.kind] + ")"], ["skip", "leave it"]]
    : (r.kind === "B2B" ? [["b2c", "was in B2C small: 4A now and table 10"], ["missed", "missed: 4A now"]] : [["missed", "missed: report now"]]).concat([["skip", "leave it"]]);
  return <>
    <div className="dash-tiles" style={{ marginTop: 12 }}>
      <Tile label="9A amended invoices" value={count((r) => r.kind !== "CDNR" && (r.what === "amend" || r.what === "gone"))} small="B2B, B2C large and exports" />
      <Tile label="9C amended notes" value={count((r) => r.kind === "CDNR" && (r.what === "amend" || r.what === "gone"))} small="credit and debit notes" />
      <Tile label="Missed, reported now" value={count((r) => r.what === "missing")} small="with their original number and date" />
      <Tile label="10 B2C small corrected" value={count((r) => r.kind === "B2CS")} small="months, rates and places revised" />
    </div>
    <Card title={"To report in " + GSTR.label(ym) + "’s GSTR-1"}>
      <p className="note">Earlier months’ documents that differ from what was filed. Each goes into this month’s JSON as chosen; an amendment already filed in an earlier month’s return is not repeated.</p>
      {p.periods.length > 0 && <p className="note">Compared: {p.periods.map(GSTR.label).join(", ")}.</p>}
      {p.noCopy.length > 0 && <p className="note" style={{ color: "#B9541B" }}>No filed copy for {p.noCopy.map(GSTR.label).join(", ")}, so those months are not compared.</p>}
      {p.late.length > 0 && <p className="note">Past the time to amend (November after the year): {p.late.map(GSTR.label).join(", ")}.</p>}
      {p.rows.length ? <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th>Month filed</th><th>Document</th><th>GSTIN</th><th>Number</th><th className="dt">Date</th><th className="n">Taxable now</th><th>What differs</th><th>Report it as</th></tr></thead>
        <tbody>{p.rows.map((r, i) => { const d = r.now || r.was; return <tr key={r.id + ":" + i}>
          <td>{GSTR.label(r.P)}</td><td>{KIND[r.kind] || r.kind}</td><td>{d.ctin || "—"}</td><td>{d.num}</td><td>{day(d.date)}</td>
          <td className="n">{r.now ? money(r.now.txval) : "—"}</td><td>{r.changes.join("; ")}</td>
          <td><select aria-label="Report it as" value={r.act} onChange={(ev) => amendSetAct(r.id, ev.target.value)}>{optsOf(r).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td></tr>; })}</tbody>
      </table></div> : <p className="note">{p.periods.length ? "Nothing to amend: the books agree with what was filed." : "Nothing to compare yet."}</p>}
    </Card>
  </>;
}

export function Amendments({ b }) {
  const ym = S.gstYm || "", reg = S.gstReg || "", regs = GSTR.gstins(b) || [], all = GSTAmend.filed(reg);
  if (regs.length > 1 && !reg) return <><FiledCopies all={all} /><p className="note" style={{ marginTop: 12 }}>Choose a registration above to see its amendments.</p></>;
  if (!ym) return <FiledCopies all={all} />;
  const c = GSTAmend.check(ym, reg);
  return <>
    <FiledCopies all={all} />
    {c && <BooksAgainstFiled c={c} ym={ym} />}
    <ToReport p={GSTAmend.pending(ym, reg)} ym={ym} />
    <p className="note">Amendments can be made up to 30 November after the end of the year (section 37(3)). A renumbered invoice, or one whose GSTIN was corrected, is one amendment (9A, with the original number). When B2C small figures of a month change — an invoice lost its GSTIN, or gained one — table 10 carries the month’s revised figures.</p>
    <Gstr1a ym={ym} reg={reg} />
  </>;
}

/* ---------- Advances ---------- */
const TaxCells = ({ r }) => <><td className="n">{money(r.taxable)}</td><td className="n">{money(r.igst)}</td><td className="n">{money(r.cgst)}</td><td className="n">{money(r.sgst)}</td></>;
const ADV_HEAD = ["Place of supply", "Advance, less tax", "IGST", "CGST", "SGST"];

// the rate of an advance, from the customer's nearest invoice unless set here
function Rate({ r }) {
  return <>
    <select aria-label="Rate" title={"Rate: " + r.rateFrom} value={r.rate} onChange={(ev) => advFix(r.id, "rate", ev.target.value)}>{GSTAdv.RATES.filter((x) => x > 0).map((x) => <option key={x} value={x}>{x}%</option>)}</select>
    {r.rateFrom !== "set" && <><br /><small className="note" style={r.rateFrom === "assumed" ? { color: "#B9541B" } : undefined}>{r.rateFrom === "assumed" ? "assumed, no invoice" : "from the " + r.rateFrom}</small></>}
  </>;
}

function Received({ a }) {
  return <Card title="11A Advances received">
    <p className="note">Money a customer paid before the invoice, for services. An advance billed in the same month is left out, as the return asks. The rate is taken from the customer’s invoice nearest the receipt; change it where it is wrong.</p>
    {a.at.length ? <div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th className="dt">Date</th><th>Receipt</th><th>Customer</th><th>Bill ref</th><th className="n">Received</th><th className="n">Rate</th>{ADV_HEAD.map((h, i) => <th key={h} className={i ? "n" : undefined}>{h}</th>)}<th>Not an advance</th></tr></thead>
      <tbody>{a.at.map((r, i) => <tr key={r.id + ":" + i}>
        <td>{day(r.date)}</td><td>{r.no}</td><td>{r.party}{r.gstin && <><br /><small className="note">{r.gstin}</small></>}</td><td>{r.ref || "—"}</td>
        <td className="n">{money(r.received)}</td><td className="n"><Rate r={r} /></td><td>{r.pos}<br /><small className="note">{r.inter ? "inter-state" : "same state"}</small></td><TaxCells r={r} />
        <td><input type="checkbox" checked={false} aria-label="Not an advance" onChange={(ev) => advFix(r.id, "skip", ev.target.checked)} /></td></tr>)}
        <tr><td colSpan={4}><b>Total</b></td><td className="n"><b>{money(a.atSum.received)}</b></td><td></td><td></td><TaxCells r={a.atSum} /><td></td></tr></tbody>
    </table></div> : <p className="note">No advance received this month.</p>}
  </Card>;
}

function Adjusted({ a }) {
  return <Card title="11B Advances adjusted">
    <p className="note">An advance from an earlier month that an invoice (or a refund) used up this month. The tax paid on it then comes off now, at the same rate.</p>
    {a.txpd.length ? <div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th className="dt">Adjusted on</th><th>By</th><th>Customer</th><th>Received in</th><th className="n">Amount</th><th className="n">Rate</th>{ADV_HEAD.map((h, i) => <th key={h} className={i ? "n" : undefined}>{h}</th>)}</tr></thead>
      <tbody>{a.txpd.map((r, i) => <tr key={i}>
        <td>{day(r.adjDate)}</td><td>{r.how === "marked" ? "marked by hand" : (r.how === "refund" ? "refund " : "") + (r.by || "")}</td><td>{r.party}</td><td>{GSTR.label(r.receivedYm)}</td>
        <td className="n">{money(r.received)}</td><td className="n">{r.rate}%</td><td>{r.pos}</td><TaxCells r={r} /></tr>)}
        <tr><td colSpan={4}><b>Total</b></td><td className="n"><b>{money(a.txpdSum.received)}</b></td><td></td><td></td><TaxCells r={a.txpdSum} /></tr></tbody>
    </table></div> : <p className="note">No earlier advance was adjusted this month.</p>}
  </Card>;
}

// advances not yet billed: the month one was billed, when Tally does not tie the invoice to it
function StillOpen({ a, ym }) {
  const later = GSTR.months().filter((m) => m > ym);
  return <Card title={"Advances still open at the end of " + GSTR.label(ym)}>
    <p className="note">Not yet billed or refunded in these books. If one was used up by an invoice that is not tied to it in Tally, pick the month it was billed.</p>
    <div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th className="dt">Received</th><th>Customer</th><th>Bill ref</th><th className="n">Amount</th><th className="n">Still open</th><th>Billed in</th></tr></thead>
      <tbody>{a.open.map((p, i) => { const left = r2(p.amount - p.adj.filter((x) => x.ym <= ym).reduce((s, x) => s + x.amount, 0));
        const ms = later.concat(p.fix.adjYm && !later.includes(p.fix.adjYm) ? [p.fix.adjYm] : []);
        return <tr key={p.id + ":" + i}><td>{day(p.date)}</td><td>{p.party}</td><td>{p.ref || "—"}</td><td className="n">{money(p.amount)}</td><td className="n">{money(left)}</td>
          <td><select aria-label="Billed in" value={p.fix.adjYm || ""} onChange={(ev) => advFix(p.id, "adjYm", ev.target.value)}><option value="">not yet</option>{ms.map((m) => <option key={m} value={m}>{GSTR.label(m)}</option>)}</select></td></tr>; })}</tbody>
    </table></div>
  </Card>;
}

function LeftOut({ a }) {
  const pieces = GSTAdv.build().pieces;
  return <Card title="Received early, but not in 11A">
    <div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th className="dt">Date</th><th>Customer</th><th>Bill ref</th><th className="n">Received</th><th>Why</th><th>Count it</th></tr></thead>
      <tbody>{a.untaxed.map((r, i) => { const p = pieces.find((x) => x.id === r.id) || { fix: {} };
        const ctl = p.skip ? <><input type="checkbox" checked aria-label="Not an advance" onChange={(ev) => advFix(r.id, "skip", ev.target.checked)} /> not an advance</>
          : p.type === "On Account" ? <><input type="checkbox" checked={!!p.fix.isAdv} aria-label="Count as an advance" onChange={(ev) => advFix(r.id, "isAdv", ev.target.checked)} /> it is an advance</> : null;
        return <tr key={r.id + ":" + i}><td>{day(r.date)}</td><td>{r.party}</td><td>{r.ref || r.type}</td><td className="n">{money(r.received)}</td><td>{r.why}</td><td>{ctl}</td></tr>; })}</tbody>
    </table></div>
  </Card>;
}

export function Advances() {
  if (!GSTAdv.ready()) return <section className="dash-card"><h3>Advances need the day book read again</h3><p className="note">Advances are worked out from the bill-wise details in Tally (New Ref, Advance, On Account, Agst Ref). The day book here was read before those were kept. Under “From Tally”, choose the same day book XML again; nothing you set is lost.</p></section>;
  const ym = S.gstYm || "", a = GSTAdv.month(ym, S.gstReg || "");
  const box = (s) => [money(s.received) + " received, " + money(s.igst + s.cgst + s.sgst + s.cess) + " tax"];
  return <>
    <div className="dash-tiles">
      <Tile label="Received, not billed this month (11A)" value={a.atSum.n} small={box(a.atSum)} />
      <Tile label="Billed now, received earlier (11B)" value={a.txpdSum.n} small={box(a.txpdSum)} />
      <Tile label="Into 3B 3.1(a)" value={money(r2(a.net.igst + a.net.cgst + a.net.sgst + a.net.cess))} small={"tax on " + money(a.net.taxable) + " net of 11B"} />
      <Tile label="Left out" value={a.untaxed.length} small="goods, exports, on account or marked" />
    </div>
    <Received a={a} />
    <Adjusted a={a} />
    {a.open.length > 0 && ym && <StillOpen a={a} ym={ym} />}
    {a.untaxed.length > 0 && <LeftOut a={a} />}
    <p className="note">Read from receipts against a customer before the invoice: a New Ref, an Advance, or an Agst Ref to such a ref before it is billed. A receipt from a ledger not under Sundry Debtors is not counted; bring the ledger masters in for this. Tax on advances for goods is not payable (notification 66/2017).</p>
  </>;
}

/* ---------- Reversal, rules 42 and 43 ---------- */
const pct = (k) => (Math.round(k * 10000) / 100) + "%";
const Heads = ({ x }) => <><td className="n">{money(x.igst)}</td><td className="n">{money(x.cgst)}</td><td className="n">{money(x.sgst)}</td><td className="n">{money(x.cess)}</td></>;
const TH4 = () => <><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">Cess</th></>;
const HeadTable = ({ rows, style }) => <div className="bk-tablewrap" style={style}><table className="bk-table"><thead><tr><th></th><TH4 /></tr></thead>
  <tbody>{rows.map(([label, x, bold], i) => <tr key={i}><td>{bold ? <b>{label}</b> : label}</td><Heads x={x} /></tr>)}</tbody></table></div>;

function Turnover({ t, q }) {
  return <Card title="Turnover of the month">
    <div className="bk-tablewrap"><table className="bk-table"><tbody>
      <tr><td>Taxable, net of credit notes</td><td className="n">{money(t.taxable)}</td></tr><tr><td>Exports and SEZ</td><td className="n">{money(t.zero)}</td></tr>
      <tr><td>Exempt, nil rated and non-GST (E)</td><td className="n">{money(t.exempt)}</td></tr><tr><td><b>Total turnover (F)</b></td><td className="n"><b>{money(t.total)}</b></td></tr>
    </tbody></table></div>
    {!t.total && <p className="note">No turnover this month, so E and F of {q.from ? GSTR.label(q.from) : "no earlier month"} are used, as rule 42(1)(h) says.</p>}
  </Card>;
}

function Rule42Year({ y }) {
  const fyLabel = y.fy + "-" + String(num(y.fy) + 1).slice(2), more = GSTRev.total(y.diff);
  return <Card title={"Rule 42(2): the year " + fyLabel + " worked out again"}>
    <p className="note">After the year, D1 is worked out on the whole year’s turnover. {y.rows.length} of 12 months are in these books.</p>
    <div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th>Month</th><th className="n">Common credit</th><th className="n">E ÷ F</th><th className="n">D1</th></tr></thead>
      <tbody>{y.rows.map((r) => <tr key={r.ym}><td>{GSTR.label(r.ym)}</td><td className="n">{money(GSTRev.total(r.C2))}</td><td className="n">{pct(r.share)}</td><td className="n">{money(GSTRev.total(r.D1))}</td></tr>)}
        <tr><td><b>Year</b></td><td className="n"><b>{money(GSTRev.total(y.C2))}</b></td><td className="n"><b>{pct(y.share)}</b></td><td className="n"><b>{money(GSTRev.total(y.monthly))}</b></td></tr></tbody>
    </table></div>
    <HeadTable style={{ marginTop: 8 }} rows={[["D1 on the year’s turnover", y.annual], ["Less: D1 reversed month by month", y.monthly],
      [more > 0 ? "To reverse more, with interest under section 50" : more < 0 ? "To take back as credit" : "Difference", y.diff, true]]} />
    <p className="note">Reverse the extra in 4(B)(1), or take the excess back in 4(A)(5), in a return up to September after the year ends.</p>
  </Card>;
}

// one capital good: typed in, kept when a box is left
function Asset({ a, ym, regs }) {
  const box = (k, type, w) => <CommitBox type={type} aria-label={k} value={a[k] == null ? "" : a[k]} style={{ width: w }} {...(type === "number" ? { step: "0.01", min: "0" } : {})} onCommit={(v) => assetSet(a.id, k, v)} />;
  const tmv = GSTRev.tm(a, ym);
  return <tr>
    <td>{box("name", "text", 130)}</td><td>{box("date", "date", 128)}</td><td>{box("igst", "number", 88)}</td><td>{box("cgst", "number", 80)}</td><td>{box("sgst", "number", 80)}</td><td>{box("cess", "number", 64)}</td>
    <td><select aria-label="Used for" style={{ minWidth: 150 }} value={a.use || "common"} onChange={(ev) => assetSet(a.id, "use", ev.target.value)}>
      {[["common", "taxable and exempt"], ["taxable", "taxable only"], ["exempt", "exempt or non-business only"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
    {regs.length > 1 && <td><select aria-label="Registration" value={a.reg || ""} onChange={(ev) => assetSet(a.id, "reg", ev.target.value)}><option value="">any</option>
      {regs.map((g) => <option key={g} value={g.slice(0, 2)}>{g.slice(0, 2)}</option>)}</select></td>}
    <td>{box("sold", "date", 130)}</td><td className="n">{tmv ? money(GSTRev.total(tmv)) : "—"}</td>
    <td><button className="btn small" onClick={() => assetRemove(a.id)}>Remove</button></td>
  </tr>;
}

function Rule43({ b, r43, ym }) {
  const regs = GSTR.gstins(b) || [];
  return <Card title="Rule 43: capital goods">
    <p className="note">The credit on a capital good used for both taxable and exempt supplies is spread over 60 months, 5% a quarter, from the month it is put to use. Each month, the exempt share of that month’s part (Tr × E ÷ F) is reversed. A good used only for taxable supplies keeps all its credit; one used only for exempt or non-business supplies gets none, so mark those and they are left out.</p>
    <div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th>Capital good</th><th className="dt">Put to use</th><TH4 /><th>Used for</th>{regs.length > 1 && <th>Registration</th>}<th className="dt">Sold on</th><th className="n">This month (Tm)</th><th></th></tr></thead>
      <tbody>{(b.assets || []).map((a) => <Asset key={a.id} a={a} ym={ym} regs={regs} />)}</tbody>
    </table></div>
    <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn small" onClick={() => doAct("assetAdd")}>Add a capital good</button></div>
    {r43.used.length > 0 && <HeadTable style={{ marginTop: 8 }} rows={[["Tr, credit of the month on common capital goods", r43.Tr], ["Te, reversed: Tr × E ÷ F", r43.Te, true]]} />}
  </Card>;
}

export function Reversal({ b }) {
  const ym = S.gstYm || "", reg = S.gstReg || "";
  if (!ym) return <p className="note">Pick a month.</p>;
  const r42 = GSTRev.rule42(ym, reg), r43 = GSTRev.rule43(ym, reg), q = r42.ratio, set = GSTRev.settings();
  const commonLeds = Object.values(b.map || {}).filter((m) => m.kind === "gst_common").length;
  const y = GSTRev.year(ym, reg);
  return <>
    <div className="dash-tiles">
      <Tile label="Exempt share of turnover (E ÷ F)" value={pct(r42.share)} small={money(q.E) + " of " + money(q.F) + (q.from && q.from !== ym ? ", taken from " + GSTR.label(q.from) : "")} />
      <Tile label="Rule 42, reversed" value={money(GSTRev.total(r42.reverse))} small={"on common credit of " + money(GSTRev.total(r42.C2))} />
      <Tile label="Rule 43, reversed" value={money(GSTRev.total(r43.Te))} small={r43.used.length + " capital good" + (r43.used.length === 1 ? "" : "s") + " in use"} />
      <Tile label="Into 3B 4(B)(1)" value={money(GSTRev.total(GSTRev.add(r42.reverse, r43.Te)))} small={GSTR.label(ym)} />
    </div>
    <Turnover t={q.t} q={q} />
    <Card title="Rule 42: common inputs and input services">
      {!commonLeds && <p className="note" style={{ color: "#B9541B" }}>No ledger is marked “GST, common credit” yet. On the Ledgers tab, mark the input tax ledgers that carry credit used for both taxable and exempt (or non-business) supplies.</p>}
      <HeadTable rows={[["C2 Common credit (" + r42.n + " voucher" + (r42.n === 1 ? "" : "s") + ")", r42.C2], ["D1 For exempt supplies: C2 × E ÷ F", r42.D1], ["D2 For non-business use: 5% of C2", r42.D2],
        ["Reversed: D1 + D2", r42.reverse, true], ["C3 Credit kept", r42.C3]]} />
      <p className="note" style={{ marginTop: 8 }}>D2 (5% for non-business use): <b>{set.d2 ? "applies" : "does not apply"}</b> · <button className="linkbtn" onClick={() => goGstSettings()}>change in GST settings</button></p>
    </Card>
    {y.rows.length > 0 && <Rule42Year y={y} />}
    <Rule43 b={b} r43={r43} ym={ym} />
    <p className="note">Both rules go into 3B table 4(B)(1). Credit marked “GST, ITC not to be taken” stays in 4(B)(2), as before.</p>
  </>;
}
