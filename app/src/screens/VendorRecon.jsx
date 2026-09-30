// Vendor ledger reconciliation, on the purchase bills tab: the account a vendor sent (Excel, CSV or PDF) against the
// party's ledger in Tally for chosen dates, what explains the gap, and where the balances first move apart. Was
// viewVendorRecon (src/js/42). The matching is VR / runVendorRecon (42); the form goes through vrSet and vrFile.
//
// State: S.vrec (ledger, from, to, the file, busy, res: the result).
import { useRef } from "react";
import { BusyCard } from "../parts/Reading.jsx";

const m = (v) => v === null || v === undefined ? "—" : (v < 0 ? "−" : "") + INR.format(Math.abs(v));
const side = (v) => v === null ? "" : v > 0.004 ? " payable" : v < -0.004 ? " advance" : "";
const amt = (x) => m(Math.abs(x.eff)), kind = (x) => x.eff > 0 ? "bill" : "payment / note";

function Form({ V0 }) {
  const file = useRef(null), live = Bridge.on() && Bridge.up();
  return <>
    <div className="vr-form">
      <label><span>Vendor ledger in Tally</span>
        <input type="text" list="vrLedgers" aria-label="Vendor ledger in Tally" data-fk="vr:ledger" autoComplete="off" placeholder="Start typing the name" value={V0.ledger || ""} onChange={(ev) => vrSet("ledger", ev.target.value)} />
        <datalist id="vrLedgers">{VR.ledgers().slice(0, 3000).map((l) => <option key={l.name} value={l.name}>{l.group || ""}</option>)}</datalist>
        {V0.ledger && !exactLedger(V0.ledger) && <small className="bad">Not a Tally ledger yet — choose one from the list</small>}</label>
      <label><span>From</span><input type="date" aria-label="From" value={V0.from || ""} onChange={(ev) => vrSet("from", ev.target.value)} /></label>
      <label><span>Up to</span><input type="date" aria-label="Up to" value={V0.to || ""} onChange={(ev) => vrSet("to", ev.target.value)} /></label>
      <label><span>Vendor’s ledger file</span><button className="btn small" onClick={() => file.current.click()}>{V0.fileName || "Choose Excel, CSV or PDF"}</button>
        <input ref={file} type="file" hidden aria-label="Vendor’s ledger file" accept=".xlsx,.xls,.xlsm,.csv,.txt,.pdf,image/*" onChange={(ev) => vrFile(ev.target.files && ev.target.files[0])} /></label>
      <div style={{ alignSelf: "end" }}><button className="btn primary" disabled={!live || !!V0.busy} onClick={() => runVendorRecon()}>Reconcile</button></div>
    </div>
    {!live && <p className="note">Connect the Tally Bridge and open the company in Tally to reconcile.</p>}
  </>;
}

// a list of entries under its heading, with a count; nothing when empty
function Section({ title, rows, cols }) {
  if (!rows.length) return null;
  return <div className="recon-sec"><h4>{title} <span className="cnt">{rows.length}</span></h4><div className="tblwrap"><table className="data">
    <thead><tr>{cols.map(([h, , n]) => <th key={h} className={n ? "n" : undefined}>{h}</th>)}</tr></thead>
    <tbody>{rows.slice(0, 500).map((r, i) => <tr key={i}>{cols.map(([h, f, n]) => <td key={h} className={n ? "n" : undefined}>{f(r)}</td>)}</tr>)}</tbody>
  </table></div></div>;
}

// Tally's balance, what explains the gap line by line, the vendor's balance
function Statement({ R }) {
  const V = R.V, T = R.T;
  const line = (label, v, sign) => <tr key={label}><td>{label}</td><td className="n">{v ? sign + m(Math.abs(v)) : "—"}</td></tr>;
  return <table className="data recon-stmt"><tbody>
    <tr><td><b>Balance in Tally on {fmtDate(R.to)}</b></td><td className="n"><b>{m(R.tClose) + side(R.tClose)}</b></td></tr>
    {R.openDiff && Math.abs(R.openDiff) >= 0.01 ? line("Opening balance difference (vendor less Tally)", R.openDiff, R.openDiff > 0 ? "+ " : "− ") : null}
    {line("Add: bills in the vendor’s ledger, not in Tally", sum0(R.onlyV.map((i) => V[i]).filter((x) => x.eff > 0)), "+ ")}
    {line("Less: payments and credit notes in the vendor’s ledger, not in Tally", sum0(R.onlyV.map((i) => V[i]).filter((x) => x.eff < 0)), "− ")}
    {line("Less: bills in Tally, not in the vendor’s ledger", sum0(R.onlyT.map((i) => T[i]).filter((x) => x.eff > 0)), "− ")}
    {line("Add: payments and debit notes in Tally, not in the vendor’s ledger", sum0(R.onlyT.map((i) => T[i]).filter((x) => x.eff < 0)), "+ ")}
    {R.differ.length ? line("Amounts that differ (vendor less Tally)", R.dEff, R.dEff >= 0 ? "+ " : "− ") : null}
    {R.unexplained !== null && Math.abs(R.unexplained) >= 0.01 ? line("Not explained by the entries below", R.unexplained, R.unexplained >= 0 ? "+ " : "− ") : null}
    <tr className="tot"><td><b>Balance in the vendor’s ledger on {fmtDate(R.to)}</b></td><td className="n"><b>{m(R.vClose) + side(R.vClose)}</b></td></tr>
  </tbody></table>;
}

function Result({ R }) {
  const V = R.V, T = R.T;
  const agreed = R.unexplained !== null && Math.abs(R.vClose - R.tClose) < 0.01 && !R.onlyV.length && !R.onlyT.length && !R.differ.length && !(R.openDiff && Math.abs(R.openDiff) >= 0.01);
  const head = <div className="note" style={{ margin: "6px 0 10px" }}>{R.ledger + " in " + R.company + " · " + fmtDate(R.from) + " to " + fmtDate(R.to) + " · " + R.file + " read as " + R.sides + " · " + R.pairs.length + " entries matched"}</div>;
  if (agreed) return <>{head}<div className="bk-bal ok"><div>✔ <b>The ledgers agree.</b>{" Every entry is on both sides, and the balance on " + fmtDate(R.to) + " is " + m(R.tClose) + side(R.tClose) + " in both."}</div></div></>;
  // what to look at first
  const openDiffers = R.openDiff !== null && Math.abs(R.openDiff) >= 0.01;
  const firstMid = R.timeline.find((x) => x.date > R.from || !(R.openDiff && Math.abs(R.openDiff) >= 0.01));
  return <>
    {head}
    <div className="bk-alert bad" style={{ marginBottom: 10 }}>
      {openDiffers ? <div><b>The opening balances differ</b>{" by " + m(Math.abs(R.openDiff)) + ": the vendor opens at " + m(R.vOpen) + side(R.vOpen) + ", Tally at " + m(R.tOpen) + side(R.tOpen) + " on " + fmtDate(addDays(R.from, -1)) + ". Entries before " + fmtDate(R.from) + " differ — reconcile the earlier period too."}</div>
        : R.openDiff !== null ? <div>{"The opening balances agree (" + m(R.tOpen) + side(R.tOpen) + ")."}</div> : null}
      {firstMid && <div><b>{"The balances first move apart on " + fmtDate(firstMid.date)}</b>{" (by " + m(Math.abs(firstMid.change)) + ")" + (firstMid.why.length ? ": " + firstMid.why.slice(0, 3).join("; ") : "") + "."}</div>}
    </div>
    <Statement R={R} />
    <Section title="In the vendor’s ledger, not in Tally" rows={R.onlyV.map((i) => V[i])} cols={[["Date", (x) => fmtDate(x.date)], ["Particulars", (x) => x.narr.slice(0, 90)], ["Kind", kind], ["Amount", amt, 1]]} />
    <Section title="In Tally, not in the vendor’s ledger" rows={R.onlyT.map((i) => T[i])} cols={[["Date", (x) => fmtDate(x.date)], ["Voucher", (x) => [x.type, x.number].filter(Boolean).join(" ")], ["Reference", (x) => x.ref || x.bills.join(", ")], ["Kind", kind], ["Amount", amt, 1]]} />
    <Section title="Same document, different amount" rows={R.differ} cols={[["Date", (d) => fmtDate(V[d.v].date)], ["Vendor’s particulars", (d) => V[d.v].narr.slice(0, 60)], ["Tally voucher", (d) => [T[d.t].type, T[d.t].number].filter(Boolean).join(" ")],
      ["Vendor", (d) => m(V[d.v].eff), 1], ["Tally", (d) => m(T[d.t].eff), 1], ["Difference", (d) => m(V[d.v].eff - T[d.t].eff), 1]]} />
    <Section title="Where the balances move apart" rows={R.timeline} cols={[["Date", (x) => fmtDate(x.date)], ["Difference after this date", (x) => m(x.diff), 1], ["Change", (x) => m(x.change), 1], ["Why", (x) => x.why.join("; ") || "entries on this date differ"]]} />
  </>;
}

export default function VendorRecon() {
  const V0 = VR.st();
  if (!V0) return null;
  const R = V0.res;
  return <section className="recon vrec">
    <div className="recon-head"><div><h3>Vendor ledger reconciliation</h3><div className="note">The vendor’s ledger (the account they sent) against the party’s ledger in Tally, for the dates you choose.</div></div>
      <div className="row" style={{ gap: 8 }}>{R && <button className="btn small" onClick={() => vrExcel()}>Download Excel</button>}<button className="btn small" onClick={() => vrClose()}>Close</button></div></div>
    <Form V0={V0} />
    {V0.busy && <div className="busy-float"><BusyCard title="Reconciling the vendor’s ledger…" detail={V0.busy} done={0} total={0} /></div>}
    {R && <Result R={R} />}
  </section>;
}
