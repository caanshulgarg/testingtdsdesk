// The Accounts tab of a client's books: financial statements for a year (Schedule III for a company, the ICAI format
// otherwise), stock, and the Mapping tab where any ledger can be placed by hand. Was viewBooksAccounts (src/js/30). The
// figures are FS (src/js/29); the statements themselves are FS.html, the same pages as the PDF, shown as an old piece.
// Changes go through fsKindSet, fsFyGo, fsStockSet, fsSet, fsMapSet, fsUnmap (src/js/23) and doAct (fsRun, fsPdf, fsExcel).
//
// State: S.fsFy (the year), S.fsRun (the statements worked out), S.fsTab (st, map), S.fsQ (the ledger search), S.fsPage
// (the page of the Mapping tab).
import Msg from "../../parts/Msg.jsx";
import { useEffect } from "react";
import Legacy from "../../parts/Legacy.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import Confirm from "../../parts/Confirm.jsx";

const m = (v) => INR.format(r2(v || 0));
const Act = ({ act, className = "btn small", children }) => <button className={className} onClick={() => doAct(act)}>{children}</button>;

function Head({ c, years, fy, d }) {
  // the format follows the entity type (Client setup, else the PAN's fourth letter) unless chosen here (review of 02-Oct-2026)
  const e = FS.entityOf(), eName = FS.ENTITY[e.code];
  const follow = () => { const b = S.books; b.fs = Object.assign({}, b.fs || {}, { kindSet: false }); S.fsRun = null; saveBooks(); render(); };
  return <section className="dash-card" data-fs-head="">
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select aria-label="Format" style={{ width: "auto" }} value={c.kind === "co" ? "co" : "nc"} onChange={(ev) => fsKindSet(ev.target.value)}>
        <option value="co">Company: Schedule III (Division I)</option><option value="nc">Firm, LLP, proprietor, trust: ICAI format for non-corporate entities</option></select>
      <select aria-label="Year" style={{ width: "auto" }} value={fy} onChange={(ev) => fsFyGo(ev.target.value)}>{years.map((y) => <option key={y} value={y}>{y + "-" + String(num(y) + 1).slice(2)}</option>)}</select>
      <Act act="fsRun" className="btn small primary">Run now</Act>{d && !d.error && <><Act act="fsPdf">Download (PDF)</Act><Act act="fsExcel">Excel</Act></>}</div>
    <p className="note" data-fs-entity={e.code} style={{ margin: "6px 0 0" }}>{eName ? "Entity type: " + eName + (e.by === "pan" ? " (from the PAN)" : " (as set in Client setup)") + (c.kindSet ? "; the format was chosen here. " : "; the format follows it. ") : "Entity type not known (no PAN in Client setup); choose the format here. "}
      {c.kindSet && eName && <button className="linkbtn" onClick={follow}>Follow the entity type</button>}</p>
    <details style={{ marginTop: 8 }}><summary className="note" style={{ cursor: "pointer" }}>Settings: stock, manufacturer, shares</summary>
    <Confirm id="books:fs-settings" label="Accounts settings" stores={["books:fs"]}>
    <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
      <label className="note">Opening stock <CommitBox type="number" step="0.01" aria-label="Opening stock" value={c.stock.open || ""} style={{ width: 130 }} onCommit={(v) => fsStockSet("open", v)} /></label>
      <label className="note">Closing stock <CommitBox type="number" step="0.01" aria-label="Closing stock" value={c.stock.close || ""} style={{ width: 130 }} onCommit={(v) => fsStockSet("close", v)} /></label>
      <label className="note"><input type="checkbox" defaultChecked={!!c.mfg} key={"mfg" + !!c.mfg} onChange={(ev) => fsSet("mfg", !!ev.target.checked)} /> purchases are materials consumed (a manufacturer)</label>
      {c.kind === "co" && <label className="note">Equity shares <CommitBox type="number" aria-label="Equity shares" value={c.shares || ""} style={{ width: 110 }} onCommit={(v) => fsSet("shares", v)} /></label>}</div>
    <p className="note">Stock is taken from the stock ledgers when Tally keeps inventory in the accounts; otherwise type it here. Each ledger is placed by its group in Tally and by its balance (a customer in credit is an advance received, a bank in credit is an overdraft); change any on the Mapping tab.</p>
    </Confirm></details>
  </section>;
}

// round 4 (03-Oct-2026), item 26: a ledger under Loans & Advances (Asset) can be marked "Loan given": the cash flow then puts
// it under investing (MIS.flowHead). The mark is a per-ledger choice, co.choices["flow:<ledger>"] = loan_given, confirmed
// by the person who ticks it (choiceConfirm: who and when, saved at once, never guessed); unticked, it is forgotten
const isLent = (l) => FS.nature(l).path.some((g) => /^loans & advances \(asset\)$/i.test(String(g).trim()));
function loanGiven(l, on) {
  const co = CO(); if (!co) return;
  if (on) choiceConfirm(co, "flow:" + l, "loan_given"); else choiceForget(co, "flow:" + l);
  toast(on ? l + ": marked Loan given; the cash flow shows it under investing." : l + ": the Loan given mark removed.");
  render();
}
// every ledger, its Tally group, its amount and the line it goes to; a line chosen by hand can go back to the rule
function Mapping({ c, d }) {
  const lines = FS.LINES[c.kind === "co" ? "co" : "nc"].concat(FS.PL.map((z) => [z[0], "P&L: " + z[1], "PL"]));
  const q = String(S.fsQ || "").toLowerCase(), rows = [];
  Object.entries(d.det).forEach(([k, list]) => list.forEach(([l, v]) => rows.push([l, k, v])));
  Object.entries(d.plDet).forEach(([k, list]) => list.forEach(([l, v]) => rows.push([l, k, v])));
  const shown = rows.filter((r) => !/^(Surplus|Closing stock|Opening stock|Less: closing)/.test(r[0]) && (!q || r[0].toLowerCase().includes(q))).sort((a, c2) => a[1].localeCompare(c2[1]) || Math.abs(c2[2]) - Math.abs(a[2]));
  // review of 02-Oct-2026: 335 ledgers, each with a drop-down of every line, were drawn at once; now a page of 50 at a
  // time, or the ledgers a search finds
  const PER = 50, pages = Math.max(1, Math.ceil(shown.length / PER)), pg = Math.min(Math.max(0, num(S.fsPage) || 0), pages - 1), page = shown.slice(pg * PER, pg * PER + PER);
  const go = (n) => setAndShow("fsPage", n);
  const pager = pages > 1 && <div className="row" data-fs-pager="" style={{ gap: 8, alignItems: "center", margin: "8px 0" }}>
    <button className="btn small" disabled={pg === 0} title={pg === 0 ? "This is the first page" : undefined} onClick={() => go(pg - 1)}>Previous</button>
    <span className="note">{"Ledgers " + (pg * PER + 1) + "–" + Math.min(shown.length, pg * PER + PER) + " of " + shown.length + " · page " + (pg + 1) + " of " + pages}</span>
    <button className="btn small" disabled={pg >= pages - 1} title={pg >= pages - 1 ? "This is the last page" : undefined} onClick={() => go(pg + 1)}>Next</button></div>;
  return <Confirm id="books:fs-map" label="Mapping" stores={["books:fs"]}>
    <div className="revfilter"><input type="search" id="fsq" aria-label="Find a ledger" data-fk="fsq" value={S.fsQ || ""} placeholder="Find a ledger" style={{ width: 260 }} onChange={(ev) => { S.fsPage = 0; setAndShow("fsQ", ev.target.value, true); }} />
      <span className="note">{shown.length + " ledgers · "}<b>{Object.keys(c.map || {}).length}</b> placed by hand</span></div>
    {pager}
    <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th>Ledger</th><th>Tally group</th><th className="n">Amount</th><th>Goes to</th></tr></thead><tbody>
      {page.map(([l, k, v], i) => <tr key={l + ":" + i} data-key={l}><td>{l}{c.map[l] && <>{" "}<span className="tag">by hand</span></>}</td><td className="note">{FS.nature(l).path.join(" ← ")}</td><td className="n">{m(v)}</td>
        <td><select aria-label={"Goes to: " + l} style={{ width: "auto" }} value={k} onChange={(ev) => fsMapSet(l, ev.target.value)}>{lines.map((z) => <option key={z[0]} value={z[0]}>{z[1]}</option>)}</select>
          {c.map[l] && <>{" "}<button className="linkbtn" onClick={() => fsUnmap(l)}>by rule</button></>}
          {isLent(l) && <>{" "}<label className="note" style={{ whiteSpace: "nowrap" }}><input type="checkbox" aria-label={"Loan given (investing): " + l} checked={MIS.flowMark(l) === "loan_given"} onChange={(ev) => loanGiven(l, ev.target.checked)} /> Loan given (investing)</label></>}</td></tr>)}
    </tbody></table></div>
    {pager}
  </Confirm>;
}

export default function Accounts({ b }) {
  const c = FS.cfg(b), years = fsYears(), fy = fsYearNow();
  const d = fy && S.fsRun && S.fsRun.fy === fy && S.fsRun.kind === c.kind ? S.fsRun.d : null, tab = S.fsTab || "st";
  // run by itself for the year shown (the last full year, unless another is chosen), once per year and format
  useEffect(() => {
    const key = fy + "|" + c.kind + "|" + (S.coId || "");
    // once shown, the next time the statements are wanted again (the format chosen back, the entity type changed in
    // Client setup) they run by themselves again (review of 02-Oct-2026: they stayed on "Working out…")
    if (d) { if (S.fsAuto && Object.keys(S.fsAuto).length) S.fsAuto = {}; }
    else if (fy && !(S.fsAuto || {})[key]) { S.fsAuto = Object.assign({}, S.fsAuto, { [key]: 1 }); doAct("fsRun"); }
  });
  if (!fy) return <div className="bk-none">Bring in the day book first.</div>;
  let body;
  if (!d) body = <div className="bk-none">Working out the statements for {fy + "-" + String(num(fy) + 1).slice(2)}…</div>;
  else if (d.error) body = <div className="bk-alert">The balances are needed: <Msg text={d.error} /></div>;
  else if (tab === "map") body = <Mapping c={c} d={d} />;
  else body = <section className="dash-card fs-doc" style={{ marginTop: 10 }}>{Math.abs(d.diff) >= 1 ? null : <p className="note" style={{ color: "var(--ok)" }}>The balance sheet tallies.</p>}
    <Legacy html={FS.html(d).replace(/<table>/g, '<div class="bk-tablewrap"><table class="bk-table">').replace(/<\/table>/g, "</table></div>")} /></section>;
  return <>
    <nav className="sbar" aria-label="Accounts" style={{ marginBottom: 10 }}>{[["st", "Statements"], ["map", "Mapping"]].map(([id, l]) => <button key={id} aria-selected={tab === id} onClick={() => setAndShow("fsTab", id)}>{l}</button>)}</nav>
    <Head c={c} years={years} fy={fy} d={d} />
    {body}
  </>;
}
