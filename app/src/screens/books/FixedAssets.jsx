// Books -> Accounts -> "Fixed assets & depreciation" (the owner's approval of 14-Oct-2026, branch depreciation). The
// year's fixed asset register, proposed from the books FinCom already holds (no request to Tally) and kept with the
// client's books (b.fixedAssets[year], shared like the rest of the work); every figure is FAR's (src/js/80-assets.js), the
// same code the Assistant's depreciation_schedule runs. One table of assets; an asset's details in the drawer; what the
// rules cannot be sure of in the Confirm list at the top; the schedules (by class, by block), the deferred tax working and
// the suggested journal entry folded under the table. Nothing here writes to the books or to Tally.
//
// State: S.fsFy (the year, shared with the statements), S.farF (the table's find and choices), the drawer openDetail("farAsset", id).
import { useEffect } from "react";
import ListTable from "../../parts/ListTable.jsx";
import FilterBar from "../../parts/FilterBar.jsx";
import DetailDrawer from "../../parts/DetailDrawer.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import { loadFSX, loadFAR } from "./Statements.jsx";

const m = (v) => INR.format(r2(v || 0));
const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const who = () => (typeof whoAmI === "function" ? whoAmI() : "");
const ent = () => ({ name: (CO() || {}).name || "" });
const fileName = (s) => String(ent().name || "client").replace(/[^A-Za-z0-9]+/g, "-") + "-" + s;
const dt = (iso) => (iso ? fmtDate(iso) : "");
const numOrNull = (v) => { const t = String(v == null ? "" : v).replace(/,/g, "").trim(); return t === "" ? null : Number(t); };
const regOf = (b, fy) => ((b.fixedAssets || {})[String(fy)]) || null;
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
  return <div className="bk-tablewrap"><table className="bk-table gf-off" data-far-table={id}><thead><tr>{t.cols.map(([l, n]) => <th key={l} className={n ? "n" : undefined}>{l}</th>)}</tr></thead>
    <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={t.cols[j][1] ? "n" : undefined}>{t.cols[j][1] && typeof v === "number" && !(t.skip || []).includes(j) ? m(v) : String(v == null ? "" : v)}</td>)}</tr>)}
      {t.total && t.rows.length > 1 && <tr className="tot"><td><b>Total</b></td>{t.cols.slice(1).map(([l, n], j) => <td key={l} className={n ? "n" : undefined}><b>{n && !(t.skip || []).includes(j + 1) ? m(t.rows.reduce((s, r) => s + (typeof r[j + 1] === "number" ? r[j + 1] : 0), 0)) : ""}</b></td>)}</tr>}</tbody></table></div>;
}

// one asset: its class, life, method, block, dates and openings, the year's entries, an override with its reason
function AssetForm({ b, fy, reg, a, c }) {
  const set = (k, v, keys) => { a[k] = v; keep(b, fy, reg, keys); };
  const cls = FAR.cls(a.cls), lifeOdd = a.life != null && a.life !== "" && cls && Number(a.life) !== cls.life;
  return <div className="far-form" data-far-form={a.id}>
    <p className="note">{"Ledger “" + a.ledger + "”" + (a.group ? " in “" + a.group + "”" : "") + ". Opening in the books " + m(a.bookOpen) + "."}</p>
    <div className="far-grid">
      <Box label="Schedule II class"><select data-far-field="cls" value={a.cls || ""} onChange={(e) => { a.life = null; set("cls", e.target.value || null, ["cls:" + a.id]); }}>
        <option value="">— choose —</option>{FAR.SCH2.map((k) => <option key={k.k} value={k.k}>{k.head + ": " + k.name + (k.life ? " (" + k.life + " years)" : "")}</option>)}</select></Box>
      <Box label={"Useful life, years" + (cls && cls.life ? " (Schedule II: " + cls.life + ")" : "")}><CommitBox data-far-field="life" value={a.life == null ? "" : a.life} placeholder={cls && cls.life ? String(cls.life) : "give it"} onCommit={(v) => set("life", numOrNull(v), ["cls:" + a.id])} /></Box>
      <Box label="Why this life" wide><CommitBox data-far-field="lifeWhy" value={a.lifeWhy || ""} placeholder={lifeOdd ? "needed: the life differs from Schedule II" : "only when the life differs from Schedule II"} onCommit={(v) => set("lifeWhy", v)} /></Box>
      <Box label="Residual value, % of cost"><CommitBox data-far-field="residualPct" value={a.residualPct == null ? "" : a.residualPct} placeholder={"client's " + (reg.settings.residualPct != null ? reg.settings.residualPct : 5)} onCommit={(v) => set("residualPct", numOrNull(v))} /></Box>
      <Box label="Method"><select data-far-field="method" value={a.method || ""} onChange={(e) => set("method", e.target.value || null)}><option value="">client's ({c.method})</option><option value="SLM">Straight line</option><option value="WDV">Written down value</option></select></Box>
      <Box label="Income-tax block"><select data-far-field="block" value={a.block || ""} onChange={(e) => set("block", e.target.value || null, ["block:" + a.id])}>
        <option value="">— choose —</option>{FAR.IT.concat(a.block && !FAR.IT.some((k) => k.k === a.block) ? [FAR.block(a.block)] : []).map((k) => <option key={k.k} value={k.k}>{k.name}</option>)}</select></Box>
      <Box label="Put to use on (held at the start)"><CommitBox type="date" data-far-field="putToUse" value={a.putToUse || ""} onCommit={(v) => set("putToUse", v || null, ["rem:" + a.id])} /></Box>
      <Box label="Remaining life at the start, years"><CommitBox data-far-field="remLife" value={a.remLife == null ? "" : a.remLife} placeholder="from the date put to use" onCommit={(v) => set("remLife", numOrNull(v), ["rem:" + a.id])} /></Box>
    </div>
    <label className="note"><input type="checkbox" data-far-field="typedOpen" checked={!!a.typedOpen} onChange={(e) => { if (e.target.checked) { a.openGross = c.gOpen; a.openAcc = c.dOpen; } set("typedOpen", e.target.checked, ["noacc:" + a.id]); }} /> Type the cost and depreciation to date at the start (in place of the books' opening and accumulated depreciation)</label>
    {a.typedOpen && <div className="far-grid"><Box label="Cost at the start"><CommitBox data-far-field="openGross" value={a.openGross == null ? "" : a.openGross} onCommit={(v) => set("openGross", numOrNull(v) || 0)} /></Box>
      <Box label="Depreciation to the start"><CommitBox data-far-field="openAcc" value={a.openAcc == null ? "" : a.openAcc} onCommit={(v) => set("openAcc", numOrNull(v) || 0)} /></Box></div>}
    {(a.adds || []).length > 0 && <><h4>Debits in the year</h4><table className="tbl small"><thead><tr><th>Date</th><th>Voucher</th><th className="n">Amount</th><th>Taken as</th><th>Put to use on</th>{reg.settings.addl && <th>Additional dep.</th>}</tr></thead><tbody>
      {a.adds.map((x) => <tr key={x.key}><td>{dt(x.date)}</td><td>{x.vtype + " " + x.vno}</td><td className="n">{m(x.amount)}</td>
        <td><select data-far-add-kind={x.key} value={x.kind} onChange={(e) => { x.kind = e.target.value; x.sure = true; keep(b, fy, reg, ["add:" + x.key]); }}><option value="add">an addition</option><option value="transfer">a transfer in</option><option value="ignore">not an addition</option></select></td>
        <td><CommitBox type="date" data-far-add-put={x.key} value={x.putToUse || x.date} onCommit={(v) => { x.putToUse = v || x.date; keep(b, fy, reg, ["idle:" + a.id]); }} /></td>
        {reg.settings.addl && <td><input type="checkbox" aria-label="Eligible for additional depreciation" checked={x.addlEligible != null ? !!x.addlEligible : a.addlEligible != null ? !!a.addlEligible : /^pm_(general|cpp)$/.test(a.cls || "")} onChange={(e) => { x.addlEligible = e.target.checked; keep(b, fy, reg, ["addl:" + a.id]); }} /></td>}</tr>)}</tbody></table></>}
    {(a.moves || []).length > 0 && <><h4>Credits in the year</h4><table className="tbl small"><thead><tr><th>Date</th><th>Voucher</th><th className="n">Amount</th><th>Taken as</th><th>Sale value</th><th>Cost of the part (if not all)</th></tr></thead><tbody>
      {a.moves.map((x) => <tr key={x.key}><td>{dt(x.date)}</td><td>{x.vtype + " " + x.vno}</td><td className="n">{m(x.amount)}</td>
        <td><select data-far-move-kind={x.key} value={x.kind} onChange={(e) => { x.kind = e.target.value; x.sure = true; if (x.kind === "sale" && x.sale == null) x.sale = x.amount; keep(b, fy, reg, ["move:" + x.key]); }}>
          <option value="sale">sold</option><option value="scrap">scrapped</option><option value="transfer">transferred</option><option value="dep">depreciation booked</option><option value="ignore">not a disposal</option></select></td>
        <td>{(x.kind === "sale" || x.kind === "scrap") && <CommitBox data-far-move-sale={x.key} value={x.sale == null ? x.amount : x.sale} onCommit={(v) => { x.sale = numOrNull(v); keep(b, fy, reg, ["move:" + x.key]); }} />}</td>
        <td>{["sale", "scrap", "transfer"].includes(x.kind) && <CommitBox data-far-move-part={x.key} value={x.costPart == null ? "" : x.costPart} placeholder="all of it" onCommit={(v) => { x.costPart = numOrNull(v); keep(b, fy, reg, ["part:" + a.id]); }} />}</td></tr>)}</tbody></table></>}
    <h4>Depreciation by hand</h4>
    <div className="far-grid"><Box label="Depreciation for the year (by hand)"><CommitBox data-far-field="overrideDep" value={a.override && a.override.dep != null ? a.override.dep : ""} placeholder={"worked out: " + m(c.computed)}
      onCommit={(v) => { const n = numOrNull(v); a.override = n == null ? null : Object.assign({}, a.override, { dep: n, by: who(), at: new Date().toISOString().slice(0, 10) }); keep(b, fy, reg); }} /></Box>
      <Box label="Reason (needed)" wide><CommitBox data-far-field="overrideWhy" value={(a.override && a.override.reason) || ""} onCommit={(v) => { if (!a.override) return false; a.override = Object.assign({}, a.override, { reason: v }); keep(b, fy, reg); }} /></Box></div>
    <table className="tbl small" data-far-asset-figures=""><tbody>
      {[["Cost at the start", c.gOpen], ["Additions", c.gAdd], ["Deductions", c.gDel], ["Depreciation to the start", c.dOpen], ["Depreciation for the year" + (c.override ? " (by hand; worked out " + m(c.computed) + ")" : ""), c.dep], ["On deductions", c.dDel], ["Carrying amount at the end", c.nClose]]
        .map(([l, v]) => <tr key={l}><td>{l}</td><td className="n">{m(v)}</td></tr>)}
      {c.sales.map((s) => <tr key={s.key}><td>{(s.kind === "transfer" ? "Transferred " : s.kind === "scrap" ? "Scrapped " : "Sold ") + dt(s.date) + ": value " + m(s.value) + ", carrying amount " + m(s.carrying)}</td><td className="n">{(s.gain < 0 ? "loss " : "gain ") + m(Math.abs(s.gain))}</td></tr>)}
    </tbody></table>
  </div>;
}

export default function FixedAssets(props) {
  // FAR (src/js/80-assets.js) is its own file, fetched the first time the tab or a report is opened
  if (!globalThis.FAR) {
    loadFAR().catch(() => {});
    return <section className="dash-card" data-far="">{S.farLoadFailed ? <p className="note" data-far-load-failed="">The register could not be loaded. <button className="linkbtn" onClick={() => { S.farLoadFailed = null; loadFAR().catch(() => {}); render(); }}>Try again</button></p>
      : <p className="note" data-far-preparing="">Preparing…</p>}</section>;
  }
  return <Register {...props} />;
}
function Register({ b, fy }) {
  const reg = regOf(b, fy);
  // the register is proposed from the books the first time the year is opened, and kept
  useEffect(() => {
    if (!fy || regOf(b, fy)) return;
    const r = FAR.refresh(b, fy);
    if (r && r.error) { S.farErr = r.error; render(); return; }
    S.farErr = null; saveBooks(); render();
  }, [fy, b.cid]);
  const years = typeof fsYears === "function" ? fsYears() : [fy];
  const yearSel = <select aria-label="Year" style={{ width: "auto" }} value={fy} onChange={(e) => fsFyGo(e.target.value)}>{years.map((y) => <option key={y} value={y}>{FAR.fyLabel(y)}</option>)}</select>;
  if (!reg) return <section className="dash-card" data-far="">{yearSel} <span className="note" data-far-wait="">{S.farErr ? "The register needs the ledger balances: " + S.farErr : "Proposing the register from the books…"}</span></section>;
  const res = FAR.compute(reg, regOf(b, Number(fy) - 1)), sett = res.settings, T = FAR.tables(res), tab = (id) => T.find((t) => t.id === id);
  const conf = res.confirm, open = detailOpen("farAsset"), oa = open ? (reg.assets || []).find((a) => a.id === open) : null, oc = oa ? res.assets.find((z) => z.id === oa.id) : null;
  const setS = (k, v, keys) => { reg.settings = Object.assign({}, reg.settings, { [k]: v }); keep(b, fy, reg, keys); };
  const confirmOne = (it) => { if (it.acc) { const x = (reg.accDep || []).find((z) => z.ledger === it.acc); if (x) x.byHand = true; } if (it.asset && /^(cls|block):/.test(it.key)) { const a = (reg.assets || []).find((z) => z.id === it.asset); if (a) a[it.key.startsWith("cls") ? "clsSure" : "blockSure"] = true; } keep(b, fy, reg, [it.key]); };
  const download = (kind) => {
    if (kind === "print") return printHtml(FAR.html(res, ent()));
    loadFSX().then((F) => {
      if (kind === "xlsx") saveFile(fileName("fixed-assets-" + fy + ".xlsx"), new Blob([F.xlsx(FAR.sheets(res, ent()), {})], { type: xlsxType }));
      else saveFile(fileName("fixed-assets-" + fy + ".docx"), new Blob([F.docx(FAR.docxBlocks(res, ent()))], { type: docxType }));
    }).catch(() => toast("The download could not be prepared; try again."));
  };
  const groups = Array.from(new Set((reg.assets || []).map((a) => a.group).filter(Boolean)));
  // the one filter bar: find an asset, a class, a block
  const ff = S.farF || {}, q = String(ff.q || "").toLowerCase();
  const shown = res.assets.filter((a) => (!q || (a.name + " " + a.ledger).toLowerCase().includes(q)) && (!ff.cls || (a.cls || "") === ff.cls) && (!ff.blk || (a.block || "") === ff.blk));
  const clsOpts = Array.from(new Set(res.assets.map((a) => a.cls || ""))).map((k) => [k, "Class: " + (k ? FAR.cls(k).name : "to be chosen")]);
  const blkOpts = Array.from(new Set(res.assets.map((a) => a.block || ""))).map((k) => [k, "Block: " + (k ? (FAR.block(k) || {}).name : "to be chosen")]);
  const cols = [
    { k: "asset", label: "Asset", role: "party", v: (a) => a.name, cell: (a) => <button className="linkbtn" data-far-row={a.id} onClick={() => openDetail("farAsset", a.id)}>{a.name}</button> },
    { k: "cls", label: "Class", v: (a) => a.clsName, cell: (a) => <span className="note">{a.clsName}</span> },
    { k: "put", label: "Put to use", role: "date", v: (a) => a.putToUse || "", cell: (a) => dt(a.putToUse) },
    { k: "cost", label: "Cost", role: "amount", cls: "n", v: (a) => r2(a.gOpen + a.gAdd), cell: (a) => m(a.gOpen + a.gAdd) },
    { k: "dep", label: "Depreciation (Companies Act)", role: "amount", cls: "n", v: (a) => a.dep, cell: (a) => <>{m(a.dep)}{a.override && <>{" "}<span className="tag warn" title={a.override.reason || ""}>by hand</span></>}</> },
    { k: "close", label: "Closing", role: "amount", cls: "n", v: (a) => a.nClose, cell: (a) => m(a.nClose) },
    { k: "block", label: "Income-tax block", v: (a) => a.block || "", cell: (a) => <span className="note">{a.block ? (FAR.block(a.block) || {}).name : "—"}</span> },
  ];
  return <div data-far="" data-far-year={fy}>
    <section className="dash-card">
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>{yearSel}
        <button className="btn small" data-far-refresh="" onClick={() => { const r = FAR.refresh(b, fy); if (r.error) toast(r.error); else { saveBooks(); render(); toast("Read again from the books; what you changed is kept."); } }}>Read the books again</button>
        <button className="btn small" data-far-excel="" onClick={() => download("xlsx")}>Excel</button>
        <button className="btn small" data-far-word="" onClick={() => download("docx")}>Word</button>
        <button className="btn small" data-far-print="" onClick={() => download("print")}>Print / PDF</button></div>
      <p className="note" data-far-summary="">{"Companies Act depreciation " + money(res.totals.dep) + " (" + (sett.method === "SLM" ? "straight line" : "written down value") + ", residual " + sett.residualPct + "%); income-tax depreciation " + money(res.totals.itDep) + (res.totals.itAddl ? " and additional " + money(res.totals.itAddl) : "") + "; the statements and Form 3CD clause 18 take these figures. Nothing is posted to Tally."}</p>
      <details><summary className="note" style={{ cursor: "pointer" }}>The client's defaults</summary>
        <div className="far-grid">
          <Box label="Method"><select data-far-set="method" value={sett.method} onChange={(e) => setS("method", e.target.value, ["settings"])}><option value="WDV">Written down value</option><option value="SLM">Straight line</option></select></Box>
          <Box label="Residual value, % of cost"><CommitBox data-far-set="residualPct" value={sett.residualPct} onCommit={(v) => setS("residualPct", numOrNull(v) == null ? 5 : numOrNull(v), ["settings"])} /></Box>
          <Box label="Additional depreciation, section 32(1)(iia)"><select data-far-set="addl" value={sett.addl ? "1" : ""} onChange={(e) => setS("addl", !!e.target.value, ["settings"])}><option value="">not claimed</option><option value="1">claimed (eligible new plant and machinery)</option></select></Box>
          {sett.addl && <Box label="Additional rate %"><CommitBox data-far-set="addlRate" value={sett.addlRate} onCommit={(v) => setS("addlRate", numOrNull(v) || 20, ["settings"])} /></Box>}
          <Box label="Deferred tax rate %"><CommitBox data-far-set="dtRate" value={sett.dtRate == null ? "" : sett.dtRate} placeholder={String(res.dt.rate)} onCommit={(v) => setS("dtRate", numOrNull(v), ["dt"])} /></Box>
          <Box label="Deferred tax standard"><select data-far-set="dtStd" value={sett.dtStd} onChange={(e) => setS("dtStd", e.target.value)}><option>AS 22</option><option>Ind AS 12</option></select></Box>
        </div></details>
    </section>
    {conf.length > 0 ? <section className="dash-card far-confirm" data-far-confirm="" style={{ marginTop: 10 }}>
      <h3>{"To confirm: " + conf.length}</h3>
      <p className="note">The figures below use these proposals until you confirm or change them. Nothing is applied silently.</p>
      <ul>{conf.map((it) => <li key={it.key} data-far-item={it.key}>{it.text}{" "}
        {!/^need:/.test(it.key) && <button className="btn small" data-far-ok={it.key} onClick={() => confirmOne(it)}>Confirm</button>}
        {it.asset && <>{" "}<button className="linkbtn" onClick={() => openDetail("farAsset", it.asset)}>Open</button></>}</li>)}</ul>
    </section> : <p className="note" data-far-confirm-none="" style={{ marginTop: 10 }}>Every point of the register is confirmed.</p>}
    <FilterBar id="farF" placeholder="Find an asset" table="farAssetsTable" title={"Fixed assets " + FAR.fyLabel(fy)} count={shown.length + " of " + res.assets.length + " assets"}
      selects={[{ key: "cls", slot: "type", label: "Class", options: [["", "Class: any"]].concat(clsOpts) }, { key: "blk", slot: "type", label: "Income-tax block", options: [["", "Block: any"]].concat(blkOpts) }]} />
    <ListTable name="farAssets" id="farAssetsTable" cols={cols} rows={shown} of={res.assets.length} rowKey={(a) => a.id} unit={["asset", "assets"]} empty={res.assets.length ? "No asset matches the filter." : "No ledger under Fixed Assets in these books."} />
    <details className="far-sec" style={{ marginTop: 10 }} data-far-sched="classes"><summary>By class: Companies Act (Schedule II)</summary><Sched t={tab("classes")} id="classes" /><p className="note">{FAR.SCH2_SOURCE}</p></details>
    <details className="far-sec" data-far-sched="blocks"><summary>By block: Income-tax Act (section 32)</summary><Sched t={tab("blocks")} id="blocks" />
      {res.blocks.filter((k) => !res.hasPrev).map((k) => <Box key={k.k} label={"Opening WDV, " + k.name}><CommitBox data-far-block-open={k.k} value={((reg.blocks || {})[k.k] || {}).open == null ? "" : reg.blocks[k.k].open} placeholder="from last year's return" onCommit={(v) => { reg.blocks = Object.assign({}, reg.blocks, { [k.k]: Object.assign({}, (reg.blocks || {})[k.k], { open: numOrNull(v) }) }); keep(b, fy, reg, ["open:" + k.k]); }} /></Box>)}
      {res.hasPrev && <p className="note">The opening of each block is last year's closing in FinCom.</p>}<p className="note">{FAR.IT_SOURCE}</p></details>
    <details className="far-sec" data-far-sched="acc"><summary>{"Accumulated depreciation ledgers (" + (reg.accDep || []).length + ")"}</summary>
      {(reg.accDep || []).length ? <table className="tbl small"><thead><tr><th>Ledger</th><th className="n">At the start</th><th>Belongs to</th></tr></thead><tbody>
        {reg.accDep.map((x) => { const v = !x.match ? "" : x.match.kind === "asset" ? "a:" + x.match.id : x.match.kind === "group" ? "g:" + x.match.group : "all";
          return <tr key={x.ledger}><td>{x.ledger}</td><td className="n">{m(x.open)}</td><td><select data-far-acc={x.ledger} value={v} onChange={(e) => { const s = e.target.value; x.match = !s ? null : s === "all" ? { kind: "all", why: "chosen by you" } : s[0] === "a" ? { kind: "asset", id: s.slice(2), why: "chosen by you" } : { kind: "group", group: s.slice(2), why: "chosen by you" }; x.byHand = true; keep(b, fy, reg, ["acc:" + x.ledger]); }}>
            <option value="">— not matched —</option>{(reg.assets || []).map((a) => <option key={a.id} value={"a:" + a.id}>{"the asset " + a.ledger}</option>)}{groups.map((g) => <option key={g} value={"g:" + g}>{"the block " + g + " (spread by cost)"}</option>)}<option value="all">every asset (spread by cost)</option></select></td></tr>; })}
      </tbody></table> : <p className="note">None in these books: each asset's opening is taken as its cost (see the Confirm list).</p>}</details>
    <details className="far-sec" data-far-sched="dt"><summary>Deferred tax working</summary><Sched t={tab("dt")} id="dt" /></details>
    <details className="far-sec" data-far-sched="je"><summary>Suggested journal entry for the year's depreciation</summary><Sched t={tab("je")} id="je" />
      <p className="note">{"Shown only: FinCom posts nothing to Tally. Already booked in the year: " + m(res.je.booked) + "; worked out: " + m(res.je.charge) + "."}</p></details>
    <DetailDrawer kind="farAsset" wide title={oa ? oa.name || oa.ledger : ""} description={oc ? oc.clsName + " · " + FAR.fyLabel(fy) : ""}>{oa && oc ? <AssetForm b={b} fy={fy} reg={reg} a={oa} c={oc} /> : null}</DetailDrawer>
    <style>{".far-grid{display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0}.far-f{display:inline-flex;flex-direction:column;font-size:12px;min-width:200px}.far-f.wide{flex:1 1 320px}.far-f input,.far-f select{min-width:180px}.far-confirm ul{margin:6px 0 0 18px;padding:0}.far-confirm li{margin:4px 0}.far-form h4{margin:12px 0 4px}.far-sec{display:block;margin:8px 0;padding:6px 10px;border:1px solid var(--line,#ddd);border-radius:8px}.far-sec>summary{font-weight:600;cursor:pointer}"}</style>
  </div>;
}
