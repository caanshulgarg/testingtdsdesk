// The Accounts tab of a client's books: financial statements for a year (Schedule III for a company, the ICAI format
// otherwise), stock, and the Mapping tab where any ledger can be placed by hand. Was viewBooksAccounts (src/js/30). The
// figures are FS (src/js/29); the statements themselves are FS.html, the same pages as the PDF, shown as an old piece.
// Changes go through fsKindSet, fsFyGo, fsStockSet, fsSet, fsMapSet, fsUnmap (src/js/23) and doAct (fsRun, fsPdf, fsExcel).
//
// State: S.fsFy (the year), S.fsRun (the statements worked out), S.fsTab (st, map), S.fsQ (the ledger search).
import Legacy from "../../parts/Legacy.jsx";
import CommitBox from "../../parts/CommitBox.jsx";

const m = (v) => INR.format(r2(v || 0));
const Act = ({ act, className = "btn small", children }) => <button className={className} onClick={() => doAct(act)}>{children}</button>;

function Head({ c, years, fy, d }) {
  return <section className="dash-card"><h3>Financial statements</h3>
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select aria-label="Format" style={{ width: "auto" }} value={c.kind === "co" ? "co" : "nc"} onChange={(ev) => fsKindSet(ev.target.value)}>
        <option value="co">Company: Schedule III (Division I)</option><option value="nc">Firm, LLP, proprietor, trust: ICAI format for non-corporate entities</option></select>
      <select aria-label="Year" style={{ width: "auto" }} value={fy} onChange={(ev) => fsFyGo(ev.target.value)}>{years.map((y) => <option key={y} value={y}>{y + "-" + String(num(y) + 1).slice(2)}</option>)}</select>
      <Act act="fsRun" className="btn small primary">Run now</Act>{d && !d.error && <><Act act="fsPdf">Download (PDF)</Act><Act act="fsExcel">Excel</Act></>}</div>
    <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
      <label className="note">Opening stock <CommitBox type="number" step="0.01" aria-label="Opening stock" value={c.stock.open || ""} style={{ width: 130 }} onCommit={(v) => fsStockSet("open", v)} /></label>
      <label className="note">Closing stock <CommitBox type="number" step="0.01" aria-label="Closing stock" value={c.stock.close || ""} style={{ width: 130 }} onCommit={(v) => fsStockSet("close", v)} /></label>
      <label className="note"><input type="checkbox" defaultChecked={!!c.mfg} key={"mfg" + !!c.mfg} onChange={(ev) => fsSet("mfg", !!ev.target.checked)} /> purchases are materials consumed (a manufacturer)</label>
      {c.kind === "co" && <label className="note">Equity shares <CommitBox type="number" aria-label="Equity shares" value={c.shares || ""} style={{ width: 110 }} onCommit={(v) => fsSet("shares", v)} /></label>}</div>
    <p className="note">Stock is taken from the stock ledgers when Tally keeps inventory in the accounts; otherwise type it here. Each ledger is placed by its group in Tally and by its balance (a customer in credit is an advance received, a bank in credit is an overdraft); change any on the Mapping tab.</p>
  </section>;
}

// every ledger, its Tally group, its amount and the line it goes to; a line chosen by hand can go back to the rule
function Mapping({ c, d }) {
  const lines = FS.LINES[c.kind === "co" ? "co" : "nc"].concat(FS.PL.map((z) => [z[0], "P&L: " + z[1], "PL"]));
  const q = String(S.fsQ || "").toLowerCase(), rows = [];
  Object.entries(d.det).forEach(([k, list]) => list.forEach(([l, v]) => rows.push([l, k, v])));
  Object.entries(d.plDet).forEach(([k, list]) => list.forEach(([l, v]) => rows.push([l, k, v])));
  const shown = rows.filter((r) => !/^(Surplus|Closing stock|Opening stock|Less: closing)/.test(r[0]) && (!q || r[0].toLowerCase().includes(q))).sort((a, c2) => a[1].localeCompare(c2[1]) || Math.abs(c2[2]) - Math.abs(a[2]));
  return <>
    <div className="revfilter"><input type="search" id="fsq" aria-label="Find a ledger" data-fk="fsq" value={S.fsQ || ""} placeholder="Find a ledger" style={{ width: 260 }} onChange={(ev) => setAndShow("fsQ", ev.target.value, true)} />
      <span className="note">{shown.length + " ledgers · "}<b>{Object.keys(c.map || {}).length}</b> placed by hand</span></div>
    <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th>Ledger</th><th>Tally group</th><th className="n">Amount</th><th>Goes to</th></tr></thead><tbody>
      {shown.slice(0, 500).map(([l, k, v], i) => <tr key={l + ":" + i} data-key={l}><td>{l}{c.map[l] && <>{" "}<span className="tag">by hand</span></>}</td><td className="note">{FS.nature(l).path.join(" ← ")}</td><td className="n">{m(v)}</td>
        <td><select aria-label={"Goes to: " + l} style={{ width: "auto" }} value={k} onChange={(ev) => fsMapSet(l, ev.target.value)}>{lines.map((z) => <option key={z[0]} value={z[0]}>{z[1]}</option>)}</select>
          {c.map[l] && <>{" "}<button className="linkbtn" onClick={() => fsUnmap(l)}>by rule</button></>}</td></tr>)}
    </tbody></table></div>
  </>;
}

export default function Accounts({ b }) {
  const c = FS.cfg(b), years = fsYears(), fy = S.fsFy && years.includes(S.fsFy) ? S.fsFy : years[0];
  if (!fy) return <div className="bk-none">Bring in the day book first.</div>;
  const d = S.fsRun && S.fsRun.fy === fy && S.fsRun.kind === c.kind ? S.fsRun.d : null, tab = S.fsTab || "st";
  let body;
  if (!d) body = <div className="bk-none">Press Run now.</div>;
  else if (d.error) body = <div className="bk-alert">The balances are needed: {d.error}.</div>;
  else if (tab === "map") body = <Mapping c={c} d={d} />;
  else body = <section className="dash-card fs-doc" style={{ marginTop: 10 }}>{Math.abs(d.diff) >= 1 ? null : <p className="note" style={{ color: "#1F7A4D" }}>The balance sheet tallies.</p>}
    <Legacy html={FS.html(d).replace(/<table>/g, '<div class="bk-tablewrap"><table class="bk-table">').replace(/<\/table>/g, "</table></div>")} /></section>;
  return <>
    <Head c={c} years={years} fy={fy} d={d} />
    <nav className="sbar" aria-label="Accounts" style={{ marginTop: 10 }}>{[["st", "Statements"], ["map", "Mapping"]].map(([id, l]) => <button key={id} aria-selected={tab === id} onClick={() => setAndShow("fsTab", id)}>{l}</button>)}</nav>
    {body}
  </>;
}
