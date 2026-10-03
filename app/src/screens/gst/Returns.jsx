// GSTR-1 and GSTR-3B for the month and GSTIN chosen, worked out from the day book, and the checks before filing.
// Was viewGstr1, viewGstr3b and viewGstChecks (src/js/18). The figures are GSTR.one() and GSTR.threeB() (src/js/12);
// the customers' IMS rejections are CustIms.jsx; filing is Filing.jsx.
import FilterBar from "../../parts/FilterBar.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import { Filing } from "./Filing.jsx";
import CustIms from "./CustIms.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
const SetLink = ({ children = "change in GST settings" }) => <button className="linkbtn" onClick={() => goGstSettings()}>{children}</button>;
const Box = ({ label, s, warn }) => <div className={"dtile" + (warn ? " warn" : "")}><span>{label}</span><b>{s.n}</b><small>{money(s.taxable)} + {money(s.igst + s.cgst + s.sgst)} tax</small></div>;

export function Checks() {
  const list = GSTR.checks(S.gstYm || "", S.gstReg || "");
  return (
    <section className="dash-card" style={{ marginTop: 12 }}><h3>Before filing</h3>
      {!list.length ? <p className="note">Nothing to fix for this month.</p> : list.map((c, i) => <span key={i} style={{ display: "contents" }}>
        <div className="dash-row"><span>{c.what}</span><b>{c.n}</b></div>
        <p className="note" style={{ margin: "0 0 8px" }}>{c.how} e.g. {c.rows.map((r) => (r.no || r.party || "").slice(0, 22)).join(", ")}</p></span>)}
    </section>
  );
}

// the documents of the month by customer; one opened shows its invoices
function Customers({ rows }) {
  const f = S.r1F || {}, qq = String(f.q || "").toLowerCase();
  const shown = rows.filter((r) => (!qq || (r.party + " " + r.no + " " + r.gstin).toLowerCase().includes(qq)) && (!f.part || r.kind === f.part));
  const by = {};
  shown.forEach((r) => {
    const k = r.gstin || normName(r.party) || "retail";
    const p = by[k] = by[k] || { party: r.party || "Retail customers", gstin: r.gstin, n: 0, taxable: 0, tax: 0, rows: [] };
    p.n++; p.taxable = r2(p.taxable + r.taxable); p.tax = r2(p.tax + r.igst + r.cgst + r.sgst); p.rows.push(r);
  });
  const parties = Object.values(by).sort((a, b) => b.taxable - a.taxable);
  return <>
    <FilterBar id="r1F" placeholder="Find a customer, invoice or GSTIN" table="r1Table" title={CO().name + " GSTR-1 " + GSTR.label(S.gstYm || "")} excel="gstExcel"
      count={parties.length + " customers · " + shown.length + " of " + rows.length + " documents"}
      selects={[{ key: "part", label: "Part", options: [["", "Every part"], ["B2B", "B2B (4A)"], ["B2CL", "B2C large (5)"], ["B2C", "B2C small (7)"], ["CDNR", "Credit notes (9B)"], ["EXP", "Exports (6)"], ["NIL", "Nil and exempt (8)"]] }]} />
    <div className="bk-tablewrap"><table className="bk-table" id="r1Table">
      <thead><tr><th>Customer</th><th>GSTIN</th><th className="n">Documents</th><th className="n">Taxable</th><th className="n">Tax</th></tr></thead>
      <tbody>
        {parties.map((p, i) => { const key = p.gstin || normName(p.party), open = S.r1Open === key; return [<tr key={key + ":" + i}>
          <td><button className="linkbtn" onClick={() => tdsToggle("r1Open", key)}>{open ? "▾ " : "▸ "}{p.party}</button></td><td>{p.gstin || "—"}</td>
          <td className="n"><button className="linkbtn" onClick={() => tdsToggle("r1Open", key)}>{p.n}</button></td><td className="n">{money(p.taxable)}</td><td className="n"><b>{money(p.tax)}</b></td>
        </tr>, open && <tr key={key + ":open:" + i}><td colSpan={5} style={{ background: "var(--paper)", padding: 0 }}><table className="bk-table" style={{ margin: 0 }}>
          <thead><tr><th>Part</th><th className="dt">Date</th><th>Invoice</th><th>Place of supply</th><th className="n">Rate</th><th className="n">Taxable</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th></tr></thead>
          <tbody>{p.rows.map((r, i) => <tr key={i}><td>{r.kind}</td><td>{day(r.date)}</td><td>{r.no}</td><td>{r.pos || ""}</td><td className="n">{r.rate}%</td>
            <td className="n">{money(r.taxable)}</td><td className="n">{money(r.igst)}</td><td className="n">{money(r.cgst)}</td><td className="n">{money(r.sgst)}</td></tr>)}</tbody>
        </table></td></tr>]; })}
        <tr><td><b>Total</b></td><td></td><td className="n">{shown.length}</td><td className="n">{money(shown.reduce((a, r) => a + r.taxable, 0))}</td>
          <td className="n"><b>{money(shown.reduce((a, r) => a + r.igst + r.cgst + r.sgst, 0))}</b></td></tr>
      </tbody>
    </table>{!parties.length && <div className="bk-none">Nothing matches.</div>}</div>
  </>;
}

export function Gstr1({ b }) {
  const g = GSTR.one(S.gstYm || "", S.gstReg || "");
  const amend = S.gstReg && GSTAmend.filed(S.gstReg).length ? GSTAmend.pending(S.gstYm || "", S.gstReg).rows.filter((r) => r.act !== "skip") : [];
  const adv = GSTAdv.ready() ? GSTAdv.month(S.gstYm || "", S.gstReg || "") : null;
  const rows = g.b2b.concat(g.b2cl).concat(g.b2c).concat(g.cdnr).concat(g.exp).concat(g.nil);
  const ECO = { amazon: "Amazon", flipkart: "Flipkart", shopify: "Shopify" }, NAT = { 1: "Invoices for outward supply", 4: "Debit notes", 5: "Credit notes" };
  return <>
    <div className="dash-tiles"><Box label="B2B (4A)" s={GSTR.sum(g.b2b)} /><Box label="B2C large (5)" s={GSTR.sum(g.b2cl)} /><Box label="B2C small (7)" s={GSTR.sum(g.b2c)} /><Box label="Notes (9B)" s={GSTR.sum(g.cdnr)} /></div>
    <div className="dash-tiles"><Box label="Exports and SEZ (6)" s={GSTR.sum(g.exp)} /><Box label="Nil, exempt, non-GST (8)" s={GSTR.sum(g.nil)} /><Box label="Reverse charge (4B)" s={GSTR.sum(g.rcm)} /><Box label="All outward" s={g.total} /></div>
    {amend.length > 0 && <div className="dash-tiles"><div className="dtile warn"><span>Earlier months to amend</span><b>{amend.length}</b>
      <small><button className="linkbtn" onClick={() => gstPartGo("amend")}>See them</button>; they go into this month’s JSON</small></div></div>}
    {adv && (adv.at.length > 0 || adv.txpd.length > 0) && <div className="dash-tiles"><Box label="Advances received (11A)" s={adv.atSum} /><Box label="Advances adjusted (11B)" s={adv.txpdSum} />
      <div className="dtile"><span>Advances</span><b><button className="linkbtn" onClick={() => gstPartGo("adv")}>See them</button></b><small>in the JSON as at and txpd</small></div></div>}
    <Customers rows={rows} />
    <section className="dash-card" style={{ marginTop: 12 }}><h3>HSN summary (12)</h3><div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th>HSN</th><th>Goods or services</th><th className="n">Rate</th><th className="n">Invoices</th><th className="n">Taxable</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th></tr></thead>
      <tbody>{g.hsn.map((x, i) => <tr key={i}><td>{x.hsn ? x.hsn : <span className="tag warn">no HSN</span>}</td><td>{x.supply || ""}</td><td className="n">{x.rate}%</td><td className="n">{x.n}</td>
        <td className="n">{money(x.taxable)}</td><td className="n">{money(x.igst)}</td><td className="n">{money(x.cgst)}</td><td className="n">{money(x.sgst)}</td></tr>)}</tbody>
    </table></div></section>
    {g.ecoBy && g.ecoBy.length > 0 && <section className="dash-card" style={{ marginTop: 12 }}><h3>Supplies through an e-commerce operator (14)</h3>
      <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th>Operator</th><th className="n">Documents</th><th className="n">Taxable</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">TCS collected</th></tr></thead>
        <tbody>{g.ecoBy.map((e) => <tr key={e.eco}><td>{ECO[e.eco] || e.eco}</td><td className="n">{e.n}</td><td className="n">{money(e.taxable)}</td><td className="n">{money(e.igst)}</td>
          <td className="n">{money(e.cgst)}</td><td className="n">{money(e.sgst)}</td><td className="n">{money(e.tcs)}</td></tr>)}</tbody>
      </table></div>
      <p className="note">The operator pays this TCS under section 52; claim it from your cash ledger after checking it against GSTR-2B or the TCS statement.</p></section>}
    <section className="dash-card" style={{ marginTop: 12 }}><h3>Documents issued (13)</h3><div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th>Nature</th><th>Series</th><th>From</th><th>To</th><th className="n">Total</th><th className="n">Cancelled</th><th className="n">Net issued</th></tr></thead>
      <tbody>{g.series.slice().sort((a, c) => a.nat - c.nat).map((x, i) => <tr key={i}><td>{NAT[x.nat]}</td><td>{x.pre || "—"}</td><td>{x.from}</td><td>{x.to}</td>
        <td className="n">{x.n}</td><td className="n">{x.cancelled}</td><td className="n">{x.n - x.cancelled}</td></tr>)}</tbody>
    </table></div>
      <p className="note">Cancelled vouchers are counted from Tally (marked cancelled there); a number missing from a series is not, so enter or cancel it in Tally first.</p></section>
    <Checks />
    <CustIms />
  </>;
}

const Row = ({ label, x, bold }) => <tr><td>{bold ? <b>{label}</b> : label}</td><td className="n">{money(x.taxable)}</td><td className="n">{money(x.igst)}</td><td className="n">{money(x.cgst)}</td><td className="n">{money(x.sgst)}</td></tr>;
const Gap = ({ n = 5, h = 8 }) => <tr><td colSpan={n} style={{ height: h }}></td></tr>;
const neg = (x) => ({ taxable: -x.taxable, igst: -x.igst, cgst: -x.cgst, sgst: -x.sgst });
const tax = (x) => ({ taxable: "", igst: x.igst, cgst: x.cgst, sgst: x.sgst });
const all4 = (x) => x.igst + x.cgst + x.sgst + x.cess;

// a figure typed into 3B (4(B)(2), 4(D)(1)), kept for the GSTIN and month
function Typed({ b, grp }) {
  const v = (((b.gst3b || {})[(S.gstReg || "") + "|" + S.gstYm] || {})[grp] || {});
  return ["igst", "cgst", "sgst"].map((k) => <td key={k} className="n">
    <CommitBox type="number" step="0.01" value={v[k] || ""} placeholder="0" aria-label={grp + " " + k.toUpperCase()} style={{ width: 100, textAlign: "right" }} onCommit={(val) => gst3bSet(grp + "." + k, val)} /></td>);
}

// credit available in 2B and not claimed in 3B (request of 02-Oct-2026), by head: 2B (Part A less Part B, where credit is
// available) against the 3B filed (its PDF, the portal's copy, or typed), else against FinCom's working
function Unclaimed({ reg, ym }) {
  const per = GSTX.retOf(ym, reg), u = per ? GSTX.unclaimed(reg, per) : null;
  if (!u) return null;
  const lab = GSTSet.typeOf(per, reg) === "qrmp" ? GSTSet.qLabel(per) : GSTR.label(per);
  return <div className="bk-tablewrap" style={{ marginTop: 12 }} data-unclaimed=""><table className="bk-table">
    <thead><tr><th>Credit in 2B not claimed, {lab}<div className="nr">claimed: {u.source}</div></th><th className="n">In 2B</th><th className="n">Claimed in 3B</th><th className="n">Not claimed</th></tr></thead>
    <tbody>{u.rows.filter((r) => r.avail || r.claimed).map((r) => <tr key={r.h} data-head={r.h}><td>{{ igst: "IGST", cgst: "CGST", sgst: "SGST", cess: "Cess" }[r.h]}</td><td className="n">{money(r.avail)}</td><td className="n">{money(r.claimed)}</td>
      <td className="n">{r.not > 0.5 ? <b className="bad">{money(r.not)}</b> : r.not < -0.5 ? <span className="nr">{money(-r.not)} more than 2B</span> : "—"}</td></tr>)}</tbody>
  </table></div>;
}

export function Gstr3b({ b }) {
  const t = GSTR.threeB(S.gstYm || "", S.gstReg || ""), choice = ((b.itcBasis || {})[S.gstReg || ""]) || "2b";
  const ft = typeof GSTSet === "object" ? GSTSet.typeOf(S.gstYm || "", S.gstReg || "") : "monthly";
  const P = t.pay, months = GSTR.months(), first = months[0] === S.gstYm;
  const HD = [["igst", "Integrated tax"], ["cgst", "Central tax"], ["sgst", "State/UT tax"], ["cess", "Cess"]];
  const heldNote = t.basis === "2b" && (t.held.n || t.released.n || (t.cn2b && t.cn2b.n) || (t.rejBack && t.rejBack.n));
  const stateName = (pos) => (Object.keys(STATE_CODES).find((k) => STATE_CODES[k] === pos) || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return <>
    <div className="gf-ctl" style={{ marginBottom: 10 }}>
      <span className="note">Credit in table 4: <b>{choice === "2b" ? "as far as 2B shows it" : "as booked in Tally"}</b> · filing {typeof GSTSet === "object" ? GSTSet.typeLabel(ft).toLowerCase() : "monthly"} · <SetLink /></span>
      <span className="note">{t.basis === "2b" ? "This month’s 2B is here; bills not in it are held back." : t.basis === "no 2B" ? "No 2B for this month here, so the books are used; bring it in under 2B reconciliation." : "As booked."}</span>
    </div>
    <div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th>3.1 Outward supplies and inward on reverse charge</th><th className="n">Taxable</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th></tr></thead>
      <tbody>
        <Row label="(a) Outward taxable supplies, other than zero rated, nil and exempt" x={t.sale} />
        {(t.adv.taxable || t.adv.igst || t.adv.cgst) ? <Row label="Add: tax on advances, 11A less 11B" x={t.adv} /> : null}
        <Row label="Less: credit notes" x={neg(t.cn)} />
        {t.custRej && t.custRej.add.n ? <Row label={"Add: our credit notes rejected by customers in IMS (" + t.custRej.add.n + ")"} x={t.custRej.add} /> : null}
        {t.custRej && t.custRej.back.n ? <Row label={"Less: of those, accepted later (" + t.custRej.back.n + ")"} x={neg(t.custRej.back)} /> : null}
        <Row label="(b) Outward zero rated: exports and SEZ" x={t.zero} />
        <Row label="(c) Other outward: nil rated and exempt" x={t.nil} />
        <Row label="(d) Inward supplies on which tax is payable by you (reverse charge)" x={t.rcmOut} />
        <Row label="(e) Non-GST outward supplies" x={t.nongst} />
        <Gap /><Row label="Net outward, taxable" x={t.net} bold />
      </tbody>
    </table></div>
    <div className="bk-tablewrap" style={{ marginTop: 12 }}><table className="bk-table">
      <thead><tr><th>3.2 Of 3.1(a), inter-state supplies to unregistered persons, by place of supply</th><th className="n">Taxable</th><th className="n">IGST</th></tr></thead>
      <tbody>{t.unregPos.length ? t.unregPos.map((x) => <tr key={x.pos}><td>{x.pos + " " + stateName(x.pos)}</td><td className="n">{money(x.taxable)}</td><td className="n">{money(x.igst)}</td></tr>)
        : <tr><td colSpan={3} className="nr">None this month.</td></tr>}</tbody>
    </table></div>
    <div className="bk-tablewrap" style={{ marginTop: 12 }}><table className="bk-table">
      <thead><tr><th>4 Input tax credit</th><th className="n">Value</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th></tr></thead>
      <tbody>
        <Row label="(A)(1) Import of goods" x={t.impGoods} /><Row label="(A)(2) Import of services" x={t.impServ} />
        <Row label="(A)(3) Inward supplies on reverse charge" x={t.rcmIn} /><Row label="(A)(5) All other ITC" x={t.other} />
        {heldNote ? <tr><td colSpan={5} className="nr" style={{ whiteSpace: "normal" }}>
          {t.held.n ? "Held back, not yet in 2B: " + t.held.n + " bill" + (t.held.n === 1 ? "" : "s") + ", ₹" + money(all4(t.held)) + ". " : ""}
          {t.released.n ? "Taken now, booked earlier and in this month’s 2B: " + t.released.n + ", ₹" + money(all4(t.released)) + ". " : ""}
          {t.rejBack && t.rejBack.n ? "Credit notes rejected in IMS, not reducing credit: " + t.rejBack.n + ", ₹" + money(all4(t.rejBack)) + ". " : ""}
          {t.cn2b && t.cn2b.n ? "Less suppliers’ credit notes in 2B, not in Tally: " + t.cn2b.n + ", ₹" + money(all4(t.cn2b)) + ". " : ""}
          <button className="linkbtn" onClick={() => gstPartGo("follow")}>See them</button></td></tr> : null}
        <Gap /><Row label="(B)(1) Reversed: rules 38, 42, 43 and section 17(5)" x={tax(t.rev1)} />
        <tr><td>(B)(2) Reversed: others (rule 37, and credit that may come back)<div className="nr">type any here</div></td><td className="n"></td><Typed b={b} grp="rev2" /></tr>
        <Gap /><Row label="(C) Net ITC available" x={tax(t.netItc)} bold />
        <tr><td>(D)(1) ITC reclaimed, reversed under 4(B)(2) earlier<div className="nr">type any here</div></td><td className="n"></td><Typed b={b} grp="reclaim" /></tr>
        <Row label={"(D)(2) Ineligible: section 16(4) and place of supply" + (GST2B.all2b(S.gstReg || "").some((z) => z.ym === S.gstYm) ? " (from 2B)" : " (bring in 2B)")} x={tax(t.na)} />
        {t.ineligible ? <tr><td className="nr">Tax charged to cost in the books</td><td className="n">{money(t.ineligible)}</td><td colSpan={3}></td></tr> : null}
      </tbody>
    </table></div>
    <Unclaimed reg={S.gstReg || ""} ym={S.gstYm || ""} />
    <div className="bk-tablewrap" style={{ marginTop: 12 }}><table className="bk-table">
      <thead><tr><th>5 Exempt, nil and non-GST inward supplies</th><th className="n">Inter-state</th><th className="n">Intra-state</th></tr></thead>
      <tbody>
        <tr><td>From a supplier under composition, exempt and nil rated</td><td className="n">{money(t.inw5.gstInter)}</td><td className="n">{money(t.inw5.gstIntra)}</td></tr>
        <tr><td>Non-GST supply</td><td className="n">{money(t.inw5.ngInter)}</td><td className="n">{money(t.inw5.ngIntra)}</td></tr>
      </tbody>
    </table></div>
    {/* 6.1: how the tax is paid, in the order the law sets, and the credit carried to next month */}
    <div className="bk-tablewrap" style={{ marginTop: 12 }}><table className="bk-table">
      <thead><tr><th>6.1 Payment of tax</th><th className="n">Tax payable</th><th className="n">Through IGST credit</th><th className="n">CGST credit</th><th className="n">SGST credit</th><th className="n">Cess credit</th><th className="n">In cash</th><th className="n">Reverse charge, in cash</th></tr></thead>
      <tbody>
        {HD.map(([k, l]) => <tr key={k}><td>{l}</td><td className="n">{money(num(t.net[k]) + num(t.rcmOut[k]))}</td>
          {["igst", "cgst", "sgst", "cess"].map((c) => <td key={c} className="n">{money((P.use[c] || {})[k])}</td>)}
          <td className="n"><b>{money(r2(P.cash[k] - P.rcmCash[k]))}</b></td><td className="n"><b>{money(P.rcmCash[k])}</b></td></tr>)}
        <Gap n={8} h={6} />
        <tr><td>Credit brought forward{first ? <div className="nr">the balance in the electronic credit ledger at the start of {GSTR.label(S.gstYm)}, from the portal</div>
          : <div className="nr">left over from {GSTR.label(months[months.indexOf(S.gstYm) - 1] || "")}</div>}</td><td></td>
          {HD.map(([k]) => <td key={k} className="n">{money(t.opening[k])}</td>)}<td>{first && <SetLink>typed in GST settings</SetLink>}</td><td></td></tr>
        <tr><td><b>Credit carried to next month</b></td><td></td>{HD.map(([k]) => <td key={k} className="n"><b>{money(P.carry[k])}</b></td>)}<td></td><td></td></tr>
      </tbody>
    </table></div>
    <p className="note">Worked out from the books. Credit is used as sections 49 and 49A and rule 88A require: IGST credit first against IGST, the rest against CGST and SGST; then CGST and SGST credit against their own tax and then IGST; CGST never against SGST. Reverse charge is paid in cash. Interest and late fee, and anything paid outside the books, are not included; check the ledgers on the portal before paying.</p>
    <Checks />
    <Filing b={b} t={t} />
  </>;
}
