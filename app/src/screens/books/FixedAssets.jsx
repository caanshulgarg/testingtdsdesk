// Books -> Accounts -> "Fixed assets & depreciation" (the owner's approval of 14-Oct-2026; overhauled the same day after
// the owner's "There should be export also. Need proper overhaul of fixed assets ledger."). Every figure is FAR's
// (src/js/80-assets.js), the same code the Assistant's depreciation_schedule runs. The answer first: four figures (gross
// block, accumulated depreciation, net block, the year's depreciation), the Confirm list when there is something to
// confirm, then the fixed asset register (one row per asset, grouped with subtotals, tied to the books) and the schedules
// under tabs: Register · Books schedule · IT blocks · Deferred tax (where it applies) · Journal. An asset opens its ledger
// (every entry, the running balance, Look up), its depreciation by year and its details (each change with its reason).
// Export: the register, the books schedule, the income-tax blocks, the deferred tax working, everything (Excel with
// formulas, PDF, Word).
//
// By entity (the owner's question of 14-Oct-2026): a company's books follow Schedule II with deferred tax; a firm, LLP,
// proprietor, trust, HUF or AOP's books follow the Income-tax rates (one schedule, no deferred tax) unless the client
// keeps its own policy (deferred tax then only at ICAI Levels I-III). The entity and the level are the statements' own
// (FAR.optsFor). Nothing here writes to the books or to Tally.
//
// State: S.farFy (the year shown), S.farTab, S.farF (the filter bar), S.farTie (the difference opened), S.farWhy (the
// reason typed for a change), the drawer openDetail("farAsset", id).
import { useEffect } from "react";
import ListTable from "../../parts/ListTable.jsx";
import Filters, { Search } from "../../parts/Filters.jsx";
import { barSelects } from "../../parts/FilterBar.jsx";
import PageTabs from "../../parts/PageTabs.jsx";
import More from "../../parts/More.jsx";
import DetailDrawer from "../../parts/DetailDrawer.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import { loadFSX, loadFAR } from "./Statements.jsx";

const m = (v) => INR.format(r2(v || 0));
const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const who = () => (typeof whoAmI === "function" ? whoAmI() : "");
const today = () => new Date().toISOString().slice(0, 10);
const ent = () => ({ name: (CO() || {}).name || "" });
const fileName = (s) => String(ent().name || "client").replace(/[^A-Za-z0-9]+/g, "-") + "-" + s;
const dt = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? fmtDate(iso) : iso || "");
const numOrNull = (v) => { const t = String(v == null ? "" : v).replace(/,/g, "").trim(); return t === "" ? null : Number(t); };
const regs = (b) => b.fixedAssets || {};
const regOf = (b, fy) => regs(b)[String(fy)] || null;
// a change by hand: the points it settles are marked confirmed (who and when), saved with the books, drawn again
function keep(b, fy, reg, keys) {
  (keys || []).forEach((k) => FAR.okSet(reg, k, who()));
  b.fixedAssets = Object.assign({}, b.fixedAssets, { [String(fy)]: reg });
  saveBooks(); render();
}
const printHtml = (html) => { const w = window.open("", "_blank"); if (!w) return; w.document.write(html); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* closed */ } }, 400); };

function Box({ label, children, wide }) {
  return <label className={"far-f" + (wide ? " wide" : "")}><span>{label}</span>{children}</label>;
}
function Sched({ t, id }) {
  if (!t) return null;
  return <div className="bk-tablewrap" data-phone-scroll=""><table className="bk-table gf-off" data-far-table={id}><thead><tr>{t.cols.map(([l, n]) => <th key={l} className={n ? "n" : undefined}>{l}</th>)}</tr></thead>
    <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={t.cols[j][1] ? "n" : undefined}>{t.cols[j][1] && typeof v === "number" && !(t.skip || []).includes(j) ? m(v) : String(v == null ? "" : v)}</td>)}</tr>)}
      {t.total && t.rows.length > 1 && <tr className="tot"><td><b>Total</b></td>{t.cols.slice(1).map(([l, n], j) => <td key={l} className={n ? "n" : undefined}><b>{n && !(t.skip || []).includes(j + 1) ? m(t.rows.reduce((s, r) => s + (typeof r[j + 1] === "number" ? r[j + 1] : 0), 0)) : ""}</b></td>)}</tr>}</tbody></table></div>;
}
const Tile = ({ l, v, sub, k }) => <div className="dtile far-tile" data-far-tile={k}><span>{l}</span><b>{money(v)}</b><small>{sub || ""}</small></div>;

// ---------------------------------------------------------------- the drawer: one asset
function AssetDrawer({ b, fy, reg, a, c, res }) {
  const it = res.basis === "it", cls = FAR.cls(a.cls);
  // every change by hand carries its reason (kept in a.log with who and when); without one it is refused
  const change = (field, value, keys) => {
    const why = String(S.farWhy || "").trim();
    if (!why) { toast("Give the reason for the change first (the box above the details)."); render(); return false; }
    a.log = (a.log || []).concat([{ field, from: a[field] == null ? null : a[field], to: value, reason: why, by: who(), at: today() }]);
    a[field] = value; keep(b, fy, reg, keys); return true;
  };
  const led = FAR.ledgerEntries(a), hist = FAR.history(b, a.id);
  const look = (e) => { if (typeof LK !== "object") return; const x = LK.st(), d8 = e.date.replace(/-/g, ""); Object.assign(x, { kind: "ledger", led: a.ledger, from: d8, to: d8, res: null });
    // the drawer goes without a step back in the browser's history (that would undo the move to Look up)
    S.detail = null; goClient("books:lookup"); setTimeout(() => { try { LK.run("auto"); } catch (er) { /* Look up runs it itself */ } }, 80); };
  return <div className="far-form" data-far-form={a.id}>
    <p className="note">{"Ledger “" + a.ledger + "”" + (a.group ? " in “" + a.group + "”" : "") + " · " + (it ? (FAR.block(a.block) || {}).name || "block to be chosen" : c.clsName + (c.life ? ", " + c.life + " years" : "")) + "."}</p>
    <h4>The ledger in the books, {FAR.fyLabel(fy)}</h4>
    <div className="bk-tablewrap"><table className="tbl small gf-off" data-far-ledger={a.id}><thead><tr><th>Date</th><th>Voucher</th><th>Particulars</th><th className="n">Debit</th><th className="n">Credit</th><th className="n">Balance</th><th></th></tr></thead><tbody>
      {led.map((e, i) => <tr key={i} data-far-entry={e.key || "open"}><td>{dt(e.date)}</td><td>{e.vtype ? e.vtype + " " + e.vno : ""}</td><td>{e.particulars}{e.taken && <span className="note">{" · taken as " + e.taken}</span>}</td>
        <td className="n">{e.dr ? m(e.dr) : ""}</td><td className="n">{e.cr ? m(e.cr) : ""}</td><td className="n">{m(e.bal)}</td><td>{e.date && <button className="linkbtn" data-far-look={e.key} onClick={() => look(e)}>Look up</button>}</td></tr>)}</tbody></table></div>
    <h4>Depreciation by year</h4>
    <table className="tbl small gf-off" data-far-history=""><thead><tr><th>Year</th><th className="n">Cost at the start</th><th className="n">Additions</th><th className="n">Deletions</th><th className="n">For the year</th><th className="n">Net block at the end</th></tr></thead><tbody>
      {hist.map((h) => <tr key={h.fy}><td>{FAR.fyLabel(h.fy)}</td><td className="n">{m(h.gOpen)}</td><td className="n">{m(h.gAdd)}</td><td className="n">{m(h.gDel)}</td><td className="n">{m(h.dep)}</td><td className="n">{m(h.nClose)}</td></tr>)}</tbody></table>
    <h4>Details</h4>
    <Box label="Reason for a change (needed before any change below)" wide><input type="text" data-far-why="" defaultValue={S.farWhy || ""} placeholder="e.g. as per the purchase invoice; technical estimate" onInput={(e) => { S.farWhy = e.target.value; }} /></Box>
    <div className="far-grid">
      <Box label="Put to use on"><CommitBox type="date" data-far-field="putToUse" value={a.putToUse || ""} onCommit={(v) => change("putToUse", v || null, ["rem:" + a.id])} /></Box>
      {!it && <Box label={res.co ? "Schedule II class" : "Class (sets the useful life)"}><select data-far-field="cls" value={a.cls || ""} onChange={(e) => { if (change("cls", e.target.value || null, ["cls:" + a.id])) { a.life = null; keep(b, fy, reg); } }}>
        <option value="">— choose —</option>{FAR.SCH2.map((k) => <option key={k.k} value={k.k}>{(res.co ? k.head + ": " : "") + k.name + (k.life ? " (" + k.life + " years)" : "")}</option>)}</select></Box>}
      {!it && <Box label={"Useful life, years" + (cls && cls.life ? (res.co ? " (Schedule II: " : " (usual: ") + cls.life + ")" : "")}><CommitBox data-far-field="life" value={a.life == null ? "" : a.life} placeholder={cls && cls.life ? String(cls.life) : "give it"} onCommit={(v) => change("life", numOrNull(v), ["cls:" + a.id])} /></Box>}
      {!it && <Box label="Method"><select data-far-field="method" value={a.method || ""} onChange={(e) => change("method", e.target.value || null)}><option value="">client's ({c.method})</option><option value="SLM">Straight line</option><option value="WDV">Written down value</option></select></Box>}
      {!it && <Box label="Residual value, % of cost"><CommitBox data-far-field="residualPct" value={a.residualPct == null ? "" : a.residualPct} placeholder={"client's " + res.settings.residualPct} onCommit={(v) => change("residualPct", numOrNull(v))} /></Box>}
      {!it && <Box label="Remaining life at the start, years"><CommitBox data-far-field="remLife" value={a.remLife == null ? "" : a.remLife} placeholder="from the date put to use" onCommit={(v) => change("remLife", numOrNull(v), ["rem:" + a.id])} /></Box>}
      <Box label="Income-tax block"><select data-far-field="block" value={a.block || ""} onChange={(e) => change("block", e.target.value || null, ["block:" + a.id])}>
        <option value="">— choose —</option>{FAR.IT.concat(a.block && !FAR.IT.some((k) => k.k === a.block) ? [FAR.block(a.block)] : []).map((k) => <option key={k.k} value={k.k}>{k.name}</option>)}</select></Box>
      <Box label="Location"><CommitBox data-far-field="location" value={a.location || ""} onCommit={(v) => change("location", v)} /></Box>
      <Box label="Tag no."><CommitBox data-far-field="tag" value={a.tag || ""} onCommit={(v) => change("tag", v)} /></Box>
      <Box label="Remarks" wide><CommitBox data-far-field="remarks" value={a.remarks || ""} onCommit={(v) => change("remarks", v)} /></Box>
    </div>
    {it && <p className="note">The books follow the Income-tax rates block by block: the useful life and the method are not used. The block's charge is shared among its assets.</p>}
    {!it && <><label className="note"><input type="checkbox" data-far-field="typedOpen" checked={!!a.typedOpen} onChange={(e) => { if (e.target.checked) { a.openGross = c.gOpen; a.openAcc = c.dOpen; } change("typedOpen", e.target.checked, ["noacc:" + a.id]); }} /> Type the cost and depreciation to date at the start (in place of the books' opening and accumulated depreciation)</label>
      {a.typedOpen && <div className="far-grid"><Box label="Cost at the start"><CommitBox data-far-field="openGross" value={a.openGross == null ? "" : a.openGross} onCommit={(v) => change("openGross", numOrNull(v) || 0)} /></Box>
        <Box label="Depreciation to the start"><CommitBox data-far-field="openAcc" value={a.openAcc == null ? "" : a.openAcc} onCommit={(v) => change("openAcc", numOrNull(v) || 0)} /></Box></div>}</>}
    {(a.adds || []).length > 0 && <><h4>Debits in the year: how each is taken</h4><table className="tbl small gf-off"><thead><tr><th>Date</th><th>Voucher</th><th className="n">Amount</th><th>Taken as</th><th>Put to use on</th>{res.settings.addl && <th>Additional dep.</th>}</tr></thead><tbody>
      {a.adds.map((x) => <tr key={x.key}><td>{dt(x.date)}</td><td>{x.vtype + " " + x.vno}</td><td className="n">{m(x.amount)}</td>
        <td><select data-far-add-kind={x.key} value={x.kind} onChange={(e) => { x.kind = e.target.value; x.sure = true; keep(b, fy, reg, ["add:" + x.key]); }}><option value="add">an addition</option><option value="transfer">a transfer in</option><option value="ignore">not an addition</option></select></td>
        <td><CommitBox type="date" data-far-add-put={x.key} value={x.putToUse || x.date} onCommit={(v) => { x.putToUse = v || x.date; keep(b, fy, reg, ["idle:" + a.id]); }} /></td>
        {res.settings.addl && <td><input type="checkbox" aria-label="Eligible for additional depreciation" checked={x.addlEligible != null ? !!x.addlEligible : a.addlEligible != null ? !!a.addlEligible : /^pm_(general|cpp)$/.test(a.cls || "")} onChange={(e) => { x.addlEligible = e.target.checked; keep(b, fy, reg, ["addl:" + a.id]); }} /></td>}</tr>)}</tbody></table></>}
    {(a.moves || []).length > 0 && <><h4>Credits in the year: how each is taken</h4><table className="tbl small gf-off"><thead><tr><th>Date</th><th>Voucher</th><th className="n">Amount</th><th>Taken as</th><th>Sale value</th><th>Cost of the part (if not all)</th></tr></thead><tbody>
      {a.moves.map((x) => <tr key={x.key}><td>{dt(x.date)}</td><td>{x.vtype + " " + x.vno}</td><td className="n">{m(x.amount)}</td>
        <td><select data-far-move-kind={x.key} value={x.kind} onChange={(e) => { x.kind = e.target.value; x.sure = true; if (x.kind === "sale" && x.sale == null) x.sale = x.amount; keep(b, fy, reg, ["move:" + x.key]); }}>
          <option value="sale">sold</option><option value="scrap">scrapped</option><option value="transfer">transferred</option><option value="dep">depreciation booked</option><option value="ignore">not a disposal</option></select></td>
        <td>{(x.kind === "sale" || x.kind === "scrap") && <CommitBox data-far-move-sale={x.key} value={x.sale == null ? x.amount : x.sale} onCommit={(v) => { x.sale = numOrNull(v); keep(b, fy, reg, ["move:" + x.key]); }} />}</td>
        <td>{["sale", "scrap", "transfer"].includes(x.kind) && <CommitBox data-far-move-part={x.key} value={x.costPart == null ? "" : x.costPart} placeholder="all of it" onCommit={(v) => { x.costPart = numOrNull(v); keep(b, fy, reg, ["part:" + a.id]); }} />}</td></tr>)}</tbody></table></>}
    {!it && <><h4>Depreciation by hand</h4>
      <div className="far-grid"><Box label="Depreciation for the year (by hand)"><CommitBox data-far-field="overrideDep" value={a.override && a.override.dep != null ? a.override.dep : ""} placeholder={"worked out: " + m(c.computed)}
        onCommit={(v) => { const n = numOrNull(v); a.override = n == null ? null : Object.assign({}, a.override, { dep: n, by: who(), at: today() }); keep(b, fy, reg); }} /></Box>
        <Box label="Reason (needed)" wide><CommitBox data-far-field="overrideWhy" value={(a.override && a.override.reason) || ""} onCommit={(v) => { if (!a.override) return false; a.override = Object.assign({}, a.override, { reason: v }); keep(b, fy, reg); }} /></Box></div></>}
    <table className="tbl small gf-off" data-far-asset-figures=""><tbody>
      {[["Cost at the start", c.gOpen], ["Additions", c.gAdd], ["Deletions", c.gDel], ["Depreciation to the start", c.dOpen], ["Depreciation for the year" + (c.override ? " (by hand; worked out " + m(c.computed) + ")" : it ? " (its share of the block's)" : ""), c.dep], ["On deletions", c.dDel], ["Net block at the end", c.nClose]]
        .map(([l, v]) => <tr key={l}><td>{l}</td><td className="n">{m(v)}</td></tr>)}
      {c.sales.map((s) => <tr key={s.key}><td>{(s.kind === "transfer" ? "Transferred " : s.kind === "scrap" ? "Scrapped " : "Sold ") + dt(s.date) + ": value " + m(s.value) + ", carrying amount " + m(s.carrying)}</td><td className="n">{it ? "left in the block " + m(s.carrying - s.value) : (s.gain < 0 ? "loss " : "gain ") + m(Math.abs(s.gain))}</td></tr>)}
    </tbody></table>
    {(a.log || []).length > 0 && <><h4>Changes</h4><table className="tbl small gf-off" data-far-log=""><thead><tr><th>When</th><th>Who</th><th>What</th><th>From</th><th>To</th><th>Reason</th></tr></thead><tbody>
      {a.log.slice().reverse().map((l, i) => <tr key={i}><td>{dt(l.at)}</td><td>{l.by}</td><td>{l.field}</td><td>{String(l.from == null ? "—" : l.from)}</td><td>{String(l.to == null ? "—" : l.to)}</td><td>{l.reason}</td></tr>)}</tbody></table></>}
  </div>;
}

// ---------------------------------------------------------------- the register: one row per asset, grouped, with totals
const RCOLS = [["gOpen", "Cost: opening"], ["gAdd", "Additions"], ["gDel", "Deletions"], ["gClose", "Cost: closing"], ["dOpen", "Depreciation: opening"], ["dep", "For the year"], ["dDel", "On deletions"], ["dClose", "Depreciation: closing"], ["nOpen", "Net block: opening"], ["nClose", "Net block: closing"]];
function Register({ res, conf, open }) {
  const R = res.register, ff = S.farF || {}, q = String(ff.q || "").toLowerCase(), need = new Set(conf.filter((c) => c.asset).map((c) => c.asset));
  const keep = (r) => (!q || (r.asset + " " + r.supplier + " " + r.group).toLowerCase().includes(q)) && (!ff.grp || r.group === ff.grp)
    && (!ff.mv || (ff.mv === "add" ? r.added : ff.mv === "sold" ? r.sold : need.has(r.id)));
  const groups = R.groups.map((g) => Object.assign({}, g, { rows: g.rows.filter(keep) })).filter((g) => g.rows.length);
  const filtered = groups.reduce((s, g) => s + g.rows.length, 0), all = R.groups.reduce((s, g) => s + g.rows.length, 0), narrowed = filtered !== all;
  const sumOf = (rows, k) => r2(rows.reduce((s, r) => s + (r[k] || 0), 0));
  const rows = [];
  groups.forEach((g) => { rows.push({ kind: "g", id: "g:" + g.key, name: g.name }); g.rows.forEach((r) => rows.push(Object.assign({ kind: "a" }, r)));
    rows.push(Object.assign({ kind: "s", id: "s:" + g.key, name: g.name }, Object.fromEntries(RCOLS.map(([k]) => [k, narrowed ? sumOf(g.rows, k) : g.sub[k]])))); });
  const tot = narrowed ? Object.fromEntries(RCOLS.map(([k]) => [k, sumOf(groups.flatMap((g) => g.rows), k)])) : R.total;
  const txt = (f) => (r) => (r.kind === "a" ? f(r) : "");
  const cols = [
    { k: "asset", label: "Asset", sort: false, cell: (r) => r.kind === "g" ? <b>{r.name}</b> : r.kind === "s" ? <b>{"Total: " + r.name}</b> : <button className="linkbtn" data-far-row={r.id} onClick={() => open(r.id)}>{r.asset}</button>, td: (r) => (r.kind === "g" ? { colSpan: 1 } : {}) },
    { k: "group", label: R.by === "block" ? "Block" : "Group / class", sort: false, cell: txt((r) => <span className="note">{r.groupShort || r.group}</span>) },
    { k: "purchased", label: "Date of purchase", sort: false, cell: txt((r) => (r.purchased === "opening" ? "opening" : dt(r.purchased))) },
    { k: "put", label: "Put to use", sort: false, cell: txt((r) => dt(r.putToUse)) },
    { k: "supplier", label: "Supplier / voucher no.", sort: false, cell: txt((r) => <span className="note">{r.supplier}</span>) },
  ].concat(RCOLS.map(([k, l]) => ({ k, label: l, cls: "n", sort: false, sum: false, cell: (r) => (r.kind === "g" ? "" : r.kind === "s" ? <b>{m(r[k])}</b> : <>{m(r[k])}{k === "dep" && r.override && <>{" "}<span className="tag warn">by hand</span></>}</>) })))
    .concat([{ k: "block", label: "Income-tax block", sort: false, cell: txt((r) => <span className="note">{r.block}</span>) }, { k: "rate", label: "Rate %", cls: "n", sort: false, sum: false, cell: txt((r) => (r.rate == null ? "" : r.rate)) }]);
  const tail = rows.length ? <tr className="far-gt" data-far-total=""><td><b>Grand total</b></td><td></td><td></td><td></td><td></td>{RCOLS.map(([k]) => <td key={k} className="n"><b>{m(tot[k])}</b></td>)}<td></td><td></td></tr> : null;
  return <div className="far-reg" data-phone-scroll="">
    <ListTable name="farRegister" id="farRegisterTable" cols={cols} rows={rows} rowKey={(r) => r.id} foot={false} tail={tail} className="bk-table far-regt gf-off"
      rowProps={(r) => ({ className: r.kind === "g" ? "far-grow" : r.kind === "s" ? "far-srow" : undefined, "data-far-kind": r.kind })}
      empty={all ? "No asset matches the filter." : "No ledger under Fixed Assets in these books."} />
    <p className="note">{filtered + " of " + all + " assets" + (narrowed ? " (the totals are of the assets shown)" : "")}</p>
  </div>;
}

export default function FixedAssets(props) {
  // FAR (src/js/80-assets.js) is its own file, fetched the first time the tab or a report is opened
  if (!globalThis.FAR) {
    loadFAR().catch(() => {});
    return <section className="dash-card" data-far="">{S.farLoadFailed ? <p className="note" data-far-load-failed="">The register could not be loaded. <button className="linkbtn" onClick={() => { S.farLoadFailed = null; loadFAR().catch(() => {}); render(); }}>Try again</button></p>
      : <p className="note" data-far-preparing="">Preparing…</p>}</section>;
  }
  return <Page {...props} />;
}
function Page({ b, fy: fyBooks }) {
  // the year: one chosen here (a year carried forward may have no books yet), else the statements' year
  const fy = S.farFy && (regOf(b, S.farFy) || (typeof fsYears === "function" && fsYears().includes(S.farFy))) ? String(S.farFy) : String(fyBooks);
  const reg = regOf(b, fy);
  // the register is proposed from the books the first time the year is opened, and kept
  useEffect(() => {
    if (!fy || regOf(b, fy)) return;
    const r = FAR.refresh(b, fy);
    if (r && r.error) { S.farErr = r.error; render(); return; }
    S.farErr = null; saveBooks(); render();
  }, [fy, b.cid]);
  const years = Array.from(new Set((typeof fsYears === "function" ? fsYears() : []).concat(Object.keys(regs(b))).concat([fy]))).sort().reverse();
  const go = (y) => { S.farFy = y; if (typeof fsYears === "function" && fsYears().includes(y)) S.fsFy = y; closeDetail(); render(); };
  const yearSel = <select aria-label="Year" data-far-year-pick="" style={{ width: "auto" }} value={fy} onChange={(e) => go(e.target.value)}>{years.map((y) => <option key={y} value={y}>{FAR.fyLabel(y)}</option>)}</select>;
  if (!reg) return <section className="dash-card" data-far="">{yearSel} <span className="note" data-far-wait="">{S.farErr ? "The register needs the ledger balances: " + S.farErr : "Proposing the register from the books…"}</span></section>;
  const opts = FAR.optsFor(b, fy), res = FAR.compute(reg, regOf(b, Number(fy) - 1), opts), sett = res.settings, T = FAR.tables(res), tab = (id) => T.find((t) => t.id === id), W = FAR.words(res);
  const conf = res.confirm, openId = detailOpen("farAsset"), oa = openId ? (reg.assets || []).find((a) => a.id === openId) : null, oc = oa ? res.assets.find((z) => z.id === oa.id) : null;
  const setS = (k, v, keys) => { reg.settings = Object.assign({}, reg.settings, { [k]: v }); keep(b, fy, reg, keys); };
  const confirmOne = (it) => { if (it.acc) { const x = (reg.accDep || []).find((z) => z.ledger === it.acc); if (x) x.byHand = true; } if (it.asset && /^(cls|block):/.test(it.key)) { const a = (reg.assets || []).find((z) => z.id === it.asset); if (a) a[it.key.startsWith("cls") ? "clsSure" : "blockSure"] = true; } keep(b, fy, reg, [it.key]); };
  const exportIt = (which, kind) => {
    const base = fileName(({ register: "fixed-asset-register", books: "depreciation-books", it: "income-tax-blocks", dt: "deferred-tax", all: "fixed-assets" })[which] + "-" + fy);
    if (kind === "pdf") return printHtml(FAR.html(res, ent(), which));
    loadFSX().then((F) => {
      if (kind === "xlsx") saveFile(base + ".xlsx", new Blob([F.xlsx(FAR.sheets(res, ent(), which), {})], { type: xlsxType }));
      else saveFile(base + ".docx", new Blob([F.docx(FAR.docxBlocks(res, ent(), which))], { type: docxType }));
    }).catch(() => toast("The download could not be prepared; try again."));
  };
  const xi = (which, kind, label) => [label, () => exportIt(which, kind), { "data-far-x": which + "-" + kind }];
  const exp = FAR.exportsFor(res), has = (k) => exp.some(([z]) => z === k);
  const exportItems = [xi("register", "xlsx", "Fixed asset register (Excel)"), xi("register", "pdf", "Fixed asset register (PDF)"), xi("register", "docx", "Fixed asset register (Word)"),
    xi("books", "xlsx", "Depreciation schedule, books (Excel)"), xi("books", "pdf", "Depreciation schedule, books (PDF)"), xi("books", "docx", "Depreciation schedule, books (Word)"),
    xi("it", "xlsx", "Income-tax block schedule (Excel)"), xi("it", "pdf", "Income-tax block schedule (PDF)"), xi("it", "docx", "Income-tax block schedule (Word)")]
    .concat(has("dt") ? [xi("dt", "xlsx", "Deferred tax working (Excel)"), xi("dt", "pdf", "Deferred tax working (PDF)"), xi("dt", "docx", "Deferred tax working (Word)")] : [])
    .concat([xi("all", "xlsx", "Everything (one workbook, a sheet each)")]);
  const carry = () => {
    const nx = String(Number(fy) + 1);
    if (regOf(b, nx)) { toast("The register for " + FAR.fyLabel(nx) + " is kept already."); return go(nx); }
    b.fixedAssets = Object.assign({}, b.fixedAssets, { [nx]: FAR.carryForward(reg) }); saveBooks();
    toast("Carried forward to " + FAR.fyLabel(nx) + ": the assets, their details and the closing as the opening."); go(nx);
  };
  const tabs = [["reg", "Register"], ["books", W.booksShort], ["it", "IT blocks"]].concat(res.dt ? [["dt", "Deferred tax"]] : []).concat([["je", "Journal"]]);
  const cur = tabs.some(([k]) => k === S.farTab) ? S.farTab : "reg";
  const ff = S.farF || {}, grpOpts = res.register.groups.map((g) => [g.name, (res.register.by === "block" ? "Block: " : "Class: ") + g.name]);
  const tie = res.tie, R = res.register.total;
  const entity = res.co ? "Company: the books follow Schedule II (Companies Act, 2013); deferred tax under AS 22."
    : (FAR.NONCO[res.kind] || "Non-corporate entity") + ": " + (res.basis === "it" ? "the books follow the Income-tax rates, block by block (no Schedule II, no deferred tax)." : "the books follow the firm's own policy" + (res.dt ? "; deferred tax under AS 22 (ICAI Levels I to III)." : "; no deferred tax (ICAI Level IV)."));
  return <div data-far="" data-far-year={fy} data-far-basis={res.basis}>
    <section className="dash-card">
      <div className="row far-top" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>{yearSel}
        <button className="btn small" data-far-carry="" onClick={carry}>{"Carry forward to " + FAR.fyLabel(Number(fy) + 1)}</button>
        <button className="btn small" data-far-refresh="" onClick={() => { const r = FAR.refresh(b, fy); if (r.error) toast(r.error); else { saveBooks(); render(); toast("Read again from the books; what you changed is kept."); } }}>Read the books again</button>
        <span style={{ flex: 1 }} />
        <More label="Export" data-far-export="" items={exportItems} /></div>
      <p className="note" data-far-entity={res.kind}>{entity + " The statements and Form 3CD clause 18 take these figures; nothing is posted to Tally."}</p>
      <div className="far-tiles" data-far-tiles="">
        <Tile k="gross" l="Gross block" v={R.gClose} sub={"at the start " + money(R.gOpen)} />
        <Tile k="acc" l="Accumulated depreciation" v={R.dClose} sub={"at the start " + money(R.dOpen)} />
        <Tile k="net" l="Net block" v={R.nClose} sub={"at the start " + money(R.nOpen)} />
        <Tile k="dep" l="Depreciation for the year" v={R.dep} sub={res.co ? "Companies Act" : res.basis === "it" ? "books = tax: " + money(res.totals.itDep + res.totals.itAddl) : "the firm's policy; tax " + money(res.totals.itDep + res.totals.itAddl)} />
      </div>
      {!tie.ok && <div className="far-tie" data-far-tie="">
        <span className="bad"><b>{"The register differs from the books by " + money(tie.diff.net) + " (net block)"}</b>{tie.why ? ": " + tie.why + "." : "."}</span>{" "}
        <button className="linkbtn" data-far-tie-show="" onClick={() => setAndShow("farTie", !S.farTie)}>{S.farTie ? "Hide difference" : "Show difference"}</button>
        {S.farTie && <table className="tbl small gf-off" data-far-tie-table=""><thead><tr><th></th><th className="n">Register</th><th className="n">Books (trial balance)</th><th className="n">Difference</th></tr></thead><tbody>
          {[["Gross block (asset ledgers)", "gross"], ["Accumulated depreciation (its ledgers)", "acc"], ["Net block", "net"]].map(([l, k]) => <tr key={k}><td>{l}</td><td className="n">{m(tie.register[k])}</td><td className="n">{m(tie.books[k])}</td><td className="n">{m(tie.diff[k])}</td></tr>)}
          {tie.assetBooks.map((x) => { const a = res.assets.find((z) => z.ledger === x.ledger), g = a ? a.gClose : 0; return r2(g - x.close) ? <tr key={"a" + x.ledger}><td className="note">{x.ledger}</td><td className="n">{m(g)}</td><td className="n">{m(x.close)}</td><td className="n">{m(g - x.close)}</td></tr> : null; })}
          {tie.accBooks.map((x) => <tr key={"c" + x.ledger}><td className="note">{x.ledger + " (accumulated depreciation)"}</td><td></td><td className="n">{m(x.close)}</td><td></td></tr>)}
          {tie.unposted ? <tr><td className="note" colSpan={4}>{"The year's depreciation not yet posted: " + money(tie.unposted) + " (the Journal tab)."}</td></tr> : null}
        </tbody></table>}
      </div>}
      <details><summary className="note" style={{ cursor: "pointer" }}>The client's defaults</summary>
        <div className="far-grid">
          {!res.co && <Box label="The books"><select data-far-set="bookBasis" value={sett.bookBasis === "own" ? "own" : "it"} onChange={(e) => setS("bookBasis", e.target.value, ["settings"])}><option value="it">At the Income-tax rates, block by block (no deferred tax)</option><option value="own">The firm's own policy (useful lives it sets)</option></select></Box>}
          {res.basis !== "it" && <Box label="Method"><select data-far-set="method" value={sett.method} onChange={(e) => setS("method", e.target.value, ["settings"])}><option value="WDV">Written down value</option><option value="SLM">Straight line</option></select></Box>}
          {res.basis !== "it" && <Box label="Residual value, % of cost"><CommitBox data-far-set="residualPct" value={sett.residualPct} onCommit={(v) => setS("residualPct", numOrNull(v) == null ? 5 : numOrNull(v), ["settings"])} /></Box>}
          <Box label="Additional depreciation, section 32(1)(iia)"><select data-far-set="addl" value={sett.addl ? "1" : ""} onChange={(e) => setS("addl", !!e.target.value, ["settings"])}><option value="">not claimed</option><option value="1">claimed (eligible new plant and machinery)</option></select></Box>
          {sett.addl && <Box label="Additional rate %"><CommitBox data-far-set="addlRate" value={sett.addlRate} onCommit={(v) => setS("addlRate", numOrNull(v) || 20, ["settings"])} /></Box>}
          {res.dt && <Box label="Deferred tax rate %"><CommitBox data-far-set="dtRate" value={sett.dtRate == null ? "" : sett.dtRate} placeholder={String(res.dt.rate)} onCommit={(v) => setS("dtRate", numOrNull(v), ["dt"])} /></Box>}
          {res.dt && <Box label="Deferred tax standard"><select data-far-set="dtStd" value={sett.dtStd} onChange={(e) => setS("dtStd", e.target.value)}><option>AS 22</option><option>Ind AS 12</option></select></Box>}
        </div>
        {!res.co && <p className="note">{"The entity and its ICAI level are the statements' (Reports, Financial statements, Details for you: Accounting policies). " + (res.levelIV ? "Level IV: current tax only." : "")}</p>}</details>
    </section>
    {conf.length > 0 && <section className="dash-card far-confirm" data-far-confirm="" style={{ marginTop: 10 }}>
      <h3>{"To confirm: " + conf.length}</h3>
      <p className="note">The figures use these proposals until you confirm or change them. Nothing is applied silently.</p>
      <ul>{conf.map((it) => <li key={it.key} data-far-item={it.key}>{it.text}{" "}
        {!/^need:/.test(it.key) && <button className="btn small" data-far-ok={it.key} onClick={() => confirmOne(it)}>Confirm</button>}
        {it.asset && <>{" "}<button className="linkbtn" onClick={() => openDetail("farAsset", it.asset)}>Open</button></>}</li>)}</ul>
    </section>}
    <div style={{ marginTop: 10 }}><PageTabs label="Fixed assets" attr="data-far-tab" tabs={tabs} value={cur} onPick={(k) => setAndShow("farTab", k)} /></div>
    {cur === "reg" && <>
      {(() => {
        // the one filter bar (the shared Filters, as FilterBar draws it); the page's own Export is at the top
        const { type } = barSelects([{ key: "grp", slot: "type", label: res.register.by === "block" ? "Block" : "Class", options: [["", res.register.by === "block" ? "Block: any" : "Class: any"]].concat(grpOpts) },
          { key: "mv", slot: "type", label: "Shown", options: [["", "All assets"], ["add", "Additions this year"], ["sold", "Sold or scrapped"], ["confirm", "Needs confirming"]] }], ff, (k, v) => setFilter("farF", k, v));
        return <Filters className="revfilter" label="Filter the register" type={type} active={Object.keys(ff).some((k) => ff[k])} onClear={() => clearFilter("farF")}
          search={<Search value={ff.q} placeholder="Find an asset, supplier or voucher" data-fk="farFq" onChange={(v) => setFilter("farF", "q", v, true)} />} />;
      })()}
      <Register res={res} conf={conf} open={(id) => openDetail("farAsset", id)} />
      <details className="far-sec" data-far-sched="acc"><summary>{"Accumulated depreciation ledgers (" + (reg.accDep || []).length + ")"}</summary>
        {(reg.accDep || []).length ? <table className="tbl small gf-off"><thead><tr><th>Ledger</th><th className="n">At the start</th><th>Belongs to</th></tr></thead><tbody>
          {reg.accDep.map((x) => { const v = !x.match ? "" : x.match.kind === "asset" ? "a:" + x.match.id : x.match.kind === "group" ? "g:" + x.match.group : "all", groups = Array.from(new Set((reg.assets || []).map((a) => a.group).filter(Boolean)));
            return <tr key={x.ledger}><td>{x.ledger}</td><td className="n">{m(x.open)}</td><td><select data-far-acc={x.ledger} value={v} onChange={(e) => { const s = e.target.value; x.match = !s ? null : s === "all" ? { kind: "all", why: "chosen by you" } : s[0] === "a" ? { kind: "asset", id: s.slice(2), why: "chosen by you" } : { kind: "group", group: s.slice(2), why: "chosen by you" }; x.byHand = true; keep(b, fy, reg, ["acc:" + x.ledger]); }}>
              <option value="">— not matched —</option>{(reg.assets || []).map((a) => <option key={a.id} value={"a:" + a.id}>{"the asset " + a.ledger}</option>)}{groups.map((g) => <option key={g} value={"g:" + g}>{"the block " + g + " (spread by cost)"}</option>)}<option value="all">every asset (spread by cost)</option></select></td></tr>; })}
        </tbody></table> : <p className="note">None in these books.</p>}</details>
    </>}
    {cur === "books" && <div data-far-pane="books">{res.basis === "it" ? <><Sched t={tab("blocks")} id="books-blocks" /><p className="note">{res.dtWhy}</p></> : <Sched t={tab("classes")} id="classes" />}
      <Sched t={tab("assets")} id="assets" /><p className="note">{res.co ? FAR.SCH2_SOURCE : FAR.words(res).rules}</p></div>}
    {cur === "it" && <div data-far-pane="it"><Sched t={tab("blocks")} id="blocks" />
      {!res.hasPrev && res.blocks.map((k) => <Box key={k.k} label={"Opening WDV, " + k.name}><CommitBox data-far-block-open={k.k} value={((reg.blocks || {})[k.k] || {}).open == null ? "" : reg.blocks[k.k].open} placeholder="from last year's return" onCommit={(v) => { reg.blocks = Object.assign({}, reg.blocks, { [k.k]: Object.assign({}, (reg.blocks || {})[k.k], { open: numOrNull(v) }) }); keep(b, fy, reg, ["open:" + k.k]); }} /></Box>)}
      {res.hasPrev && <p className="note">The opening of each block is last year's closing in FinCom.</p>}<p className="note">{FAR.IT_SOURCE}</p></div>}
    {cur === "dt" && res.dt && <div data-far-pane="dt"><Sched t={tab("dt")} id="dt" /></div>}
    {cur === "je" && <div data-far-pane="je"><Sched t={tab("je")} id="je" /><p className="note">{"Shown only: FinCom posts nothing to Tally. Already booked in the year: " + m(res.je.booked) + "; worked out: " + m(res.je.charge) + "."}</p></div>}
    <DetailDrawer kind="farAsset" wide title={oa ? oa.name || oa.ledger : ""} description={oc ? (res.basis === "it" ? (FAR.block(oc.block) || {}).name || "" : oc.clsName) + " · " + FAR.fyLabel(fy) : ""}>{oa && oc ? <AssetDrawer b={b} fy={fy} reg={reg} a={oa} c={oc} res={res} /> : null}</DetailDrawer>
    <style>{".far-grid{display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0}.far-f{display:inline-flex;flex-direction:column;font-size:12px;min-width:200px}.far-f.wide{flex:1 1 320px}.far-f input,.far-f select{min-width:180px}"
      + ".far-confirm ul{margin:6px 0 0 18px;padding:0}.far-confirm li{margin:4px 0}.far-form h4{margin:14px 0 4px}.far-sec{display:block;margin:8px 0;padding:6px 10px;border:1px solid var(--line,#ddd);border-radius:8px}.far-sec>summary{font-weight:600;cursor:pointer}"
      + ".far-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:10px 0 4px}.far-tile{cursor:default}.far-tile b{font-size:22px}@media (max-width:720px){.far-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}"
      + ".far-tie{margin:8px 0;padding:8px 10px;border:1px solid var(--bad,#b42318);border-radius:8px;background:rgba(180,35,24,.05)}.far-tie table{margin-top:6px}"
      + ".far-reg .lt-wrap,.far-reg .bk-tablewrap{overflow:auto;max-width:100%}.far-regt{min-width:1700px}.far-regt td:first-child,.far-regt th:first-child{min-width:190px}.far-regt td{white-space:nowrap}.far-regt th:first-child,.far-regt td:first-child{position:sticky;left:0;z-index:2;background:var(--sheet,#fff)}.far-regt thead th{position:sticky;top:0;z-index:3}.far-regt thead th:first-child{z-index:4}"
      + ".far-regt tr.far-grow td{background:var(--paper,#f7f7f5);font-weight:600}.far-regt tr.far-srow td{border-top:1px solid var(--rule,#ccc)}.far-regt tr.far-gt td{border-top:2px solid var(--ink,#222);font-weight:700}"}</style>
  </div>;
}
