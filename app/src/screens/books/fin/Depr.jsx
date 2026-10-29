// Fixed assets & deferred tax (owner, 29-Oct-2026: "depreciation as per companies act and income tax act should be there so
// that deferred tax can easily be calculated.. for depreciation as per income tax act.. there should be an uploader also for
// itr 3,5,6,7 so that last year closing would come there and purchase and sell would come from accounting.. and likewise
// opening wdv would come from as per companies act"). A lazy chunk of its own, opened from the page's tabs. The figures are
// FinDepr's (src/js/88-fin-depr.js), put on the statements as d.depr:
//   - last year's ITR uploaded (ITR-3 / 5 / 6 / 7 JSON from the e-filing portal, else its PDF's text; read in this browser,
//     nothing sent anywhere), kept add-only per year;
//   - the Companies Act register by class (Schedule II lives, SLM / WDV, residual) and asset by asset, opening from last
//     year's audited balance sheet, additions and sales from the day book; any period of the year;
//   - the Income-tax Act blocks (section 32), the opening WDV from the ITR; the Computation of income takes them;
//   - deferred tax (AS 22) at the client's rate, last year's figure, the movement; the MAT note.
// Two ticks put them in the statements (the depreciation, the PPE note, profit or loss on sale; the deferred tax): until
// then the statements stay as the books hold them.
import { useState } from "react";
import Button from "../../../parts/Button.jsx";
import CommitBox from "../../../parts/CommitBox.jsx";
import { rs, dmy } from "./util.js";
import "./depr.css";

const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
const pct = (r) => (Math.round(r * 10000) / 100) + "%";
const ymd = (iso) => String(iso || "").replace(/-/g, "");
const iso = (y) => (y ? y.slice(0, 4) + "-" + y.slice(4, 6) + "-" + y.slice(6, 8) : "");

async function readItr(file, fy) {
  const name = file.name || "file", low = name.toLowerCase(), buf = await file.arrayBuffer();
  let sha = ""; try { sha = hex(await crypto.subtle.digest("SHA-256", buf)); } catch (e) { /* an old browser: no checksum */ }
  let r;
  if (/\.json$/.test(low) || file.type === "application/json") {
    let obj; try { obj = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new Error("This file is not JSON that FinCom can read. Download the return's JSON from the e-filing portal again."); }
    r = FinDepr.readItrJson(obj, fy);
  } else if (/\.pdf$/.test(low) || file.type === "application/pdf") {
    if (typeof getPdf !== "function" || typeof pageTextLines !== "function") throw new Error("The PDF reader could not be loaded just now. Try again in a moment.");
    let pdf; try { pdf = await getPdf(file); } catch (e) { throw new Error("This PDF could not be opened (it may be damaged or locked with a password)."); }
    let text = "";
    for (let p = 1; p <= Math.min(pdf.numPages, 60); p++) text += pageTextLines(await (await pdf.getPage(p)).getTextContent()) + "\n";
    r = FinDepr.readItrText(text, fy);
  } else throw new Error("Give last year's ITR as the JSON from the e-filing portal (or its PDF).");
  if (r.why && !r.found.length) throw new Error(r.why);
  return Object.assign(r, { file: name, size: file.size, sha256: sha });
}

function Itr({ fy }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const v = FinDepr.itrLatest(fy);
  const pick = async (ev) => {
    const file = ev.target.files && ev.target.files[0]; ev.target.value = "";
    if (!file) return;
    setBusy(true); setErr("");
    try { const r = await readItr(file, fy); const k = FinDepr.itrSave(fy, r); toast("Last year's ITR kept (version " + k.v + "): " + Object.keys(r.blocks).filter((b) => r.blocks[b]).length + " blocks' opening WDV read."); render(); }
    catch (e) { setErr((e && e.message) || String(e)); }
    finally { setBusy(false); }
  };
  return <div className="fin-pybs" data-fd-itr="">
    <div className="fin-pybs-head"><div><b>Upload last year’s ITR</b>
      <p className="note" data-fd-itr-state="">{v ? v.form + (v.ay ? " · AY " + v.ay + "-" + String(+v.ay + 1).slice(2) : "") + (v.pan ? " · PAN " + v.pan : "") + " · " + (v.src === "pdf" ? "PDF" : "JSON") + " · " + v.file + " · version " + v.v + (v.warn ? " · " + v.warn : "")
        : "ITR-3, ITR-5, ITR-6 or ITR-7 for AY " + fy + "-" + String(+fy + 1).slice(2) + ": the JSON from the e-filing portal (or its PDF). Schedule DPM and DOA’s closing WDV is this year’s opening WDV of each block. Read in this browser, never sent anywhere."}</p></div>
      <label className="btn small" data-fd-itr-pick="">{busy ? "Reading…" : v ? "Upload again" : "Upload ITR"}<input type="file" accept=".json,.pdf,application/json,application/pdf" hidden data-fd-itr-file="" onChange={pick} disabled={busy} /></label></div>
    {err && <p className="fin-bad" data-fd-itr-err="">{err}</p>}
    {v && v.found && v.found.length > 0 && <details className="note"><summary>What was read ({v.found.length})</summary>
      <ul>{v.found.map((f, i) => <li key={i}>{(FinDepr.BK[f.block] || {}).name + ": " + rs(f.v) + " — " + f.path + (f.field ? " · " + f.field : "")}</li>)}</ul></details>}
  </div>;
}

function Uses({ d }) {
  const u = d.depr.use.asked || {}, fy = d.fy;
  const set = (k, v) => { FinDepr.useSet(fy, { [k]: v }); toast(v ? (k === "ca" ? "The statements now take the register's depreciation and profit or loss on sale." : "The statements now take the deferred tax worked out here.") : "The statements take the books' figures again."); render(); };
  return <div className="fin-fd-use" data-fd-uses="">
    <label><input type="checkbox" data-fd-use="ca" checked={!!u.ca} onChange={(ev) => set("ca", ev.target.checked)} /> Use the Companies Act register in the statements (depreciation, the PPE note, profit or loss on sale)</label>
    <label><input type="checkbox" data-fd-use="dt" checked={!!u.dt} onChange={(ev) => set("dt", ev.target.checked)} /> Put this deferred tax in the statements (Notes 9 / 31 and the P&L)</label>
    {d.depr.postNote && <p className="note" data-fd-postnote="">{d.depr.postNote}</p>}
  </div>;
}

const CA_COLS = [["gO", "Gross: opening"], ["gA", "Additions"], ["gD", "Deletions"], ["gC", "Gross: closing"], ["dO", "Depreciation: opening"], ["dep", "For the period"], ["dD", "On deletions"], ["dC", "Depreciation: closing"], ["nC", "Net block"]];
function Ca({ d }) {
  const ca = d.depr.ca, fy = d.fy, cls = Object.values(ca.classes);
  const typedOpen = (c, k, v) => { const o = c.open || {}; FinDepr.openSet(fy, c.cls, Object.assign({ gross: o.gross, acc: o.acc }, { [k]: v === "" ? 0 : +v })); render(); };
  return <>
    <h5>Companies Act, 2013: depreciation by class (Schedule II){ca.full ? "" : ", " + dmy(ca.from) + " to " + dmy(ca.to)}</h5>
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="fd-ca">
      <thead><tr><th>Class</th><th>Method</th><th className="n">Life (years)</th><th className="n">Residual %</th><th>Income-tax block</th><th>Opening from</th>{CA_COLS.map(([k, l]) => <th key={k} className="n">{l}</th>)}</tr></thead>
      <tbody>{cls.map((c) => {
        const can = c.open && (c.open.src === "typed" || c.open.src === "books");
        return <tr key={c.cls} data-fd-class={c.cls}>
          <td title={c.cfg.why}>{c.label}</td>
          <td><select aria-label={"Method: " + c.label} data-fd-method={c.cls} value={c.cfg.method} onChange={(ev) => { FinDepr.cfgSet(c.cls, { method: ev.target.value }); render(); }}>
            <option value="WDV">WDV</option><option value="SLM">SLM</option><option value="NONE">None</option></select></td>
          <td className="n"><CommitBox type="number" step="1" aria-label={"Useful life: " + c.label} value={c.cfg.life} onCommit={(v) => { FinDepr.cfgSet(c.cls, { life: v === "" ? null : +v }); render(); }} /></td>
          <td className="n"><CommitBox type="number" step="0.5" aria-label={"Residual: " + c.label} value={c.cfg.res} onCommit={(v) => { FinDepr.cfgSet(c.cls, { res: v === "" ? null : +v }); render(); }} /></td>
          <td><select aria-label={"Income-tax block: " + c.label} data-fd-blockof={c.cls} value={c.cfg.block || ""} onChange={(ev) => { FinDepr.cfgSet(c.cls, { block: ev.target.value }); render(); }}>
            <option value="">Not depreciable</option>{FinDepr.BLOCKS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></td>
          <td className="note" data-fd-opensrc={c.open ? c.open.src : ""}>{c.open ? c.open.label : ""}
            {can && <span className="fin-fd-open"><CommitBox type="number" step="0.01" aria-label={"Opening gross block: " + c.label} placeholder="gross" value={c.open.src === "typed" ? c.open.gross : ""} onCommit={(v) => typedOpen(c, "gross", v)} />
              <CommitBox type="number" step="0.01" aria-label={"Opening depreciation: " + c.label} placeholder="depreciation" value={c.open.src === "typed" ? c.open.acc : ""} onCommit={(v) => typedOpen(c, "acc", v)} /></span>}</td>
          {CA_COLS.map(([k]) => <td key={k} className="n" data-fd-v={k}>{rs(c[k])}</td>)}</tr>; })}
        <tr className="sub" data-fd-class="total"><td colSpan={6}>Total</td>{CA_COLS.map(([k]) => <td key={k} className="n" data-fd-v={k}>{rs(ca.total[k])}</td>)}</tr></tbody></table></div>
    <p className="note">Profit / (loss) on sale for the period: <b data-fd-gain="">{rs(ca.total.gain)}</b>. Depreciation pro rata by days: from the date put to use, to the day before a sale; never below the residual value. {d.depr.sources.sch2}.</p>
  </>;
}

function Items({ d }) {
  const ca = d.depr.ca, fy = d.fy, ev = {}; (ca.events || []).forEach((e) => { ev[e.key] = e; });
  return <details className="fin-fd-items" data-fd-items="" open>
    <summary><b>Fixed asset register: asset by asset</b> ({ca.items.length})</summary>
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="fd-items">
      <thead><tr><th>Class</th><th>Asset</th><th>Put to use</th><th className="n">Cost</th><th className="n">Depreciation at the start</th><th className="n">For the period</th><th>Sold on</th><th className="n">Sale value</th><th className="n">Profit / (loss)</th></tr></thead>
      <tbody>{ca.items.map((x) => <tr key={x.id} data-fd-item={x.id}>
        <td>{(ca.classes[x.cls] || {}).label || x.cls}</td><td>{x.name}</td>
        <td>{x.kind === "add" ? <CommitBox type="date" aria-label={"Put to use: " + x.name} value={iso(x.put)} onCommit={(v) => { FinDepr.putSet(fy, x.key, v ? ymd(v) : ""); render(); }} /> : "Before the year"}</td>
        <td className="n">{rs(x.cost)}</td><td className="n">{rs(x.acc)}</td><td className="n">{rs(x.dep)}</td>
        <td>{x.sale ? dmy(x.sale) : ""}</td><td className="n">{x.sale ? rs(x.value) : ""}</td><td className="n">{x.inDel ? rs(x.gain) : ""}</td></tr>)}</tbody></table></div>
    {(ca.events || []).length > 0 && <><p className="note">Sales found in the day book: what was sold is the whole ledger (its share of the opening and its additions) unless its cost is given.</p>
      <div className="fin-box"><table className="fin-t" data-fin-table="fd-sales"><thead><tr><th>Date</th><th>Ledger</th><th>Voucher</th><th className="n">Sale value</th><th className="n">Cost of what was sold</th></tr></thead>
        <tbody>{ca.events.map((e) => <tr key={e.key} data-fd-sale={e.key}><td>{dmy(e.date)}</td><td>{e.ledger}</td><td>{[e.vtype, e.vno].filter(Boolean).join(" ")}{e.party ? " · " + e.party : ""}</td><td className="n">{rs(e.value)}</td>
          <td className="n"><CommitBox type="number" step="0.01" aria-label={"Cost of what was sold: " + e.ledger} value={e.typedCost ? e.cost : ""} placeholder={rs(e.cost)} onCommit={(v) => { FinDepr.saleSet(fy, e.key, v); render(); }} />{e.none && <span className="fin-bad"> nothing found to sell: give the cost</span>}</td></tr>)}</tbody></table></div></>}
    {(ca.flags || []).length > 0 && <ul className="note" data-fd-flags="">{ca.flags.map((f, i) => <li key={i}>{dmy(f.date) + " " + f.ledger + ": " + f.why}</li>)}</ul>}
  </details>;
}

function It({ d }) {
  const it = d.depr.it, fy = d.fy;
  return <>
    <h5>Income-tax Act, 1961: depreciation by block (section 32), previous year {fy + "-" + String(+fy + 1).slice(2)}</h5>
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="fd-it">
      <thead><tr><th>Block</th><th className="n">Rate</th><th className="n">Opening WDV</th><th>From</th><th className="n">Added, 180 days or more</th><th className="n">Added, under 180 days</th><th className="n">Sale value</th><th>Block ceases</th><th className="n">Depreciation</th><th className="n">STCG / (STCL)</th><th className="n">Closing WDV</th></tr></thead>
      <tbody>{it.blocks.map((z) => <tr key={z.key} data-fd-block={z.key}>
        <td>{z.name}</td><td className="n">{pct(z.rate)}</td>
        <td className="n">{z.src === "itr" ? rs(z.open) : <CommitBox type="number" step="0.01" aria-label={"Opening WDV: " + z.name} value={z.src === "typed" ? z.open : ""} placeholder={rs(z.open)} onCommit={(v) => { FinDepr.itOpenSet(fy, z.key, v); render(); }} />}</td>
        <td className="note" data-fd-itsrc={z.src || "none"}>{z.srcLabel || "not known: upload the ITR or type it"}</td>
        <td className="n">{rs(z.addA)}</td><td className="n">{rs(z.addB)}</td><td className="n">{rs(z.sale)}</td>
        <td><input type="checkbox" aria-label={"Block ceases: " + z.name} data-fd-ceased={z.key} checked={!!z.ceased} disabled={!z.sale} onChange={(ev) => { FinDepr.ceasedSet(fy, z.key, ev.target.checked); render(); }} /></td>
        <td className="n" data-fd-v="dep">{rs(z.dep)}</td><td className="n" data-fd-v="stcg">{rs(z.stcg)}</td><td className="n" data-fd-v="close">{rs(z.close)}</td></tr>)}
        <tr className="sub"><td colSpan={8}>Total</td><td className="n" data-fd-ittotal="">{rs(it.total)}</td><td /><td className="n">{rs(it.close)}</td></tr></tbody></table></div>
    <p className="note">The Computation of income takes this depreciation (Annexure 1). {d.depr.sources.it}.</p>
  </>;
}

function Dt({ d }) {
  const dt = d.depr.dt;
  return <>
    <h5>Deferred tax (AS 22){dt.part ? ", " + dmy(d.depr.period.to) : ""}</h5>
    {dt.partNote && <p className="note">{dt.partNote}</p>}
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="fd-dt">
      <thead><tr><th>Timing difference</th><th className="n">Amount</th><th className="n">Deferred tax</th></tr></thead>
      <tbody>{dt.rows.map((r) => <tr key={r.key} data-fd-dt={r.key}><td>{r.label}{r.key === "dep" ? <span className="fin-why">{"books " + rs(r.book) + " less tax " + rs(r.tax)}</span> : null}</td><td className="n">{rs(r.diff)}</td><td className="n">{rs(r.dtax)}</td></tr>)}
        <tr className="sub"><td>Net timing difference (a liability when positive)</td><td className="n">{rs(dt.total)}</td><td /></tr>
        <tr><td>Rate {dt.rate}% <span className="fin-why">{dt.rateWhy}</span></td><td className="n"><CommitBox type="number" step="0.001" aria-label="Deferred tax rate %" data-fd-rate="" value={dt.given ? dt.rate : ""} placeholder={String(dt.rate)} onCommit={(v) => { FinDepr.dtRateSet(v); render(); }} /></td><td /></tr>
        <tr className="tot" data-fd-dt="closing"><td>{"Deferred tax " + dt.side + " at the end"}</td><td /><td className="n">{rs(Math.abs(dt.closing))}</td></tr>
        <tr data-fd-dt="open"><td>Last year’s (liability; an asset in brackets) <span className="fin-why">{dt.openSrc + "; worked out the same way at the start of the year: books " + rs(dt.bookO) + " less tax " + rs(dt.taxO)}</span></td><td /><td className="n">{rs(dt.open)}</td></tr>
        <tr className="tot" data-fd-dt="move"><td>{"Movement: " + (dt.move >= 0 ? "charge" : "credit") + " to the profit and loss"}</td><td /><td className="n">{rs(dt.move)}</td></tr></tbody></table></div>
    <p className="note" data-fd-mat="">{dt.mat}</p>
    <p className="note">{d.depr.sources.dt}.</p>
  </>;
}

export default function Depr({ d }) {
  const fy = d.fy;
  if (!FinDepr.on()) return <section className="fin-sheet fin-depr" data-fin-depr="" data-fd-off="">
    <header><h3>Fixed assets & deferred tax</h3><p>Depreciation under the Companies Act and the Income-tax Act, last year’s ITR, and deferred tax</p></header>
    <p className="note">FinCom works out the Companies Act register (Schedule II) and the income-tax blocks (section 32) from last year’s audited balance sheet, last year’s ITR and this year’s purchases and sales in the books, and the deferred tax on the difference. Nothing changes in the statements until you choose.</p>
    <Button className="btn small" data-fd-start="" onClick={() => { FinDepr.start(); render(); }}>Start</Button>
  </section>;
  if (!d.depr) return <section className="fin-sheet" data-fin-depr=""><p className="note">The figures could not be worked out.</p></section>;
  return <section className="fin-sheet fin-depr" data-fin-depr="">
    <header><h3>Fixed assets & deferred tax</h3><p>{d.depr.period.full ? "Year ended " + dmy(d.depr.ca.y1) : "For the period " + dmy(d.depr.period.from) + " to " + dmy(d.depr.period.to)}</p></header>
    <p className="fin-unit">(Amounts in rupees)</p>
    <Uses d={d} />
    <Itr fy={fy} />
    <Ca d={d} />
    <Items d={d} />
    <It d={d} />
    <Dt d={d} />
  </section>;
}
