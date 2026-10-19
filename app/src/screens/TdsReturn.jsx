// A quarter's TDS return: 26Q (other than salary) with its challans, deductees, deductions and checks; 24Q (salary)
// with its employees, challans, Annexure II and checks; and the section 197 certificates with the rate questions.
// Was viewTdsReturn26, viewTdsReturn24, viewTdsCerts, tdsFilterBar, tdsTabs and tdsSortHead (src/js/18).
//
// The figures come from the business logic: TDS.rows() (deductions read from the books), TDS.challans(),
// TDS.challanUse(), Certs.issues(), TDS.interest(), TDS.lateFee(), TDS24Q.annexI()/annexII()/checks().
// Redesign of 09-Oct-2026 (the owner's request, Computax and Winman as the pattern), and tds-layout of 14-Oct-2026: a return
// opens on its card, then the six tabs of tds/ReturnParts.jsx (Deductions · Employees & declarations for 24Q · Challans ·
// To fix · Return file · After filing). From tax
// year 2026-27 a section is shown as the Act of 2025 numbers it with the old section beside it (TDS.secNew, src/js/09):
// "393(1) Sl. 6(i) [old 194C]"; the section filter and the find box take either.
// Filters are kept per tab in S.tdsFl, sorting in S.tdsSort; the row opened under a table in S.chOpen, S.tdsOpen,
// S.q24Open. Changes go through tdsFilter, tdsSortBy, tdsToggle, tdsAlloc, challanAdd, … (src/js/27).
import SrcTag, { srcWords } from "../parts/SrcTag.jsx";
import { useRef, useState } from "react";
import ListTable from "../parts/ListTable.jsx";
import { MarkFiled, InterestFee } from "./tds/Filed.jsx";
import { Correction } from "./tds/Smart.jsx";
import { TracesDefaults } from "./tds/Files.jsx";
import More from "../parts/More.jsx";
import Salary, { Return24Tally } from "./tds/Payroll.jsx";
import Filters, { Search } from "../parts/Filters.jsx";
import { barSelects } from "../parts/FilterBar.jsx";
import { Info } from "../parts/Answer.jsx";
// next-tds-clear (19-Oct-2026): the return's frame (header, summary strip, step rail), Validate & file, the drawers
import { ReturnShell, SideDrawer, statusOf, stepName, FvuMade } from "./tds/Shell.jsx";
import { checkReturn, ValidatePanel, PrnBox } from "./tds/Validate.jsx";
import { tabNow, ReturnChallans, FixRows, AfterFiling, UnknownChallans, SalaryChecks, openCorrection } from "./tds/ReturnParts.jsx";
import { Limits, TieOut } from "./tds/Smart.jsx";
import { ChallanCell, MatchDialogs, PlainDeductions, ChallanSelect, ChallanTicker } from "./tds/Match.jsx";
import DeducteesPan, { secShort, secTitle, SecShort } from "./tds/Deductees.jsx";
import { PanBox } from "./tds/PanBook.jsx";
import AddDeduction, { openAdd } from "./tds/AddDeduction.jsx";
import { dedMatch, ChallanOrSugg, ChallanSide, sideFilter, groupRows, GroupHead } from "./tds/DedSide.jsx";
import { Cell, Fixes, BulkBar, KeysHelp, onTableKey, safeFixes, readyCount } from "./tds/DedSmart.jsx";
import { DeductorDetails } from "./Settings.jsx";
import DedTodo from "./tds/DedTodo.jsx";
import { DedByChallan, retChallans } from "./tds/Winman.jsx";
import { unplacedOf } from "./tds/onChallan.js";
// TDSF25 (src/js/83-tds-forms-2025.js: the 2026-27 forms' text file, TDS26Q.build) comes with this screen's file, not in legacy.js (build.py lazy_files)
import "../../../src/js/83-tds-forms-2025.js";
import "../lib/tdsGlobals.js";   // next-challan-match: TDSMatch, PANCheck and the matcher's rules come with the TDS screens

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
const NoPan = () => <span className="tag warn">no PAN</span>;
const Pan = ({ pan }) => (Certs.validPan(pan) ? pan : <NoPan />);
const Empty = ({ children }) => <div className="bk-none">{children}</div>;
// a section: from 2026-27 the new provision with the old section beside it and the table entry under it; before, as it was
// (t70, the owner: "section name is not there": before 2026-27 too, its plain name under the code, from the same table)
export const Sec = ({ s, fy = S.tdsFy }) => { const x = TDS.secNew(s, fy), name = x.label || TDS.secName(s); return x.ref ? <span className="rp-sec" data-sec={x.old}><span className="rp-sec-code">{x.ref} [old {x.old}]</span><small>{x.label}</small></span>
  : name ? <span className="rp-sec" data-sec={x.old}><span className="rp-sec-code">{s}</span><small>{name}</small></span> : <>{s}</>; };
const secText = (s, fy = S.tdsFy) => TDS.secNew(s, fy).text;
// bridge 2.4.3: a challan or certificate made from what Tally keeps, and where Tally and FinCom differ (TDSTally, src/js/72)
const FromTally = ({ on }) => (on ? <span className="tag" data-from-tally="" title="Made from the details Tally keeps">From Tally</span> : null);
function TallyDiffs({ kind }) {
  const tags = kind === "challan" ? TDSTally.disagreements() : [], cs = TDSTally.conflicts(kind), bad = kind === "challan" ? TDSTally.bad() : [];
  if (!tags.length && !cs.length && !bad.length) return null;
  return <section className="dash-card" style={{ marginBottom: 12 }} data-tally-diffs={kind}><h3>Tally and FinCom differ</h3>
    <p className="note">Nothing here was changed: FinCom keeps what a person entered. Decide each, then change it in FinCom or in Tally.</p>
    <ul className="note">
      {tags.map((d) => <li key={"t" + d.row}>{d.party} ({day(d.date)}): {d.why ? d.why : <>Tally pays it with challan {d.tallyLabel}; FinCom has it on {d.fincomLabel}</>}</li>)}
      {cs.map((c, i) => <li key={"c" + i}>{c.label}: {c.what} is {String(c.fincom)} in FinCom, {String(c.tally)} in Tally</li>)}
      {bad.map((z, i) => <li key={"b" + i}>Tally's challan {z.bad}: not made in FinCom. Enter it by hand.</li>)}
    </ul></section>;
}

// the bar above a return's table: the one filter bar (Filters.jsx): month, the other choices, find, Clear; then how many
// are shown, print, Excel
function FilterBar({ tab, placeholder, table, title, excel, count, selects = [], chip, items, children, noClear, className = "revfilter" }) {
  const f = (S.tdsFl || {})[tab] || {};
  const { period, type } = barSelects(selects, f, (k, v) => tdsFilter(tab, k, v));
  return <Filters className={className} label={"Filter " + title} period={period} type={chip ? <>{type}{chip}</> : type}
    search={<Search value={f.q} placeholder={placeholder.replace(/^Find an? /, "Find ").split(/,| or /)[0] + (/PAN/.test(placeholder) ? ", PAN" : "")} label={placeholder} data-fk={"tdsf-" + tab} onChange={(v) => tdsFilter(tab, "q", v, true)} />}
    onClear={noClear ? null : () => tdsFilterClear(tab)} active={Object.keys(f).some((k) => f[k])} count={count || ""}
    tools={<><More label="Export" data-fb-out="" items={items || [["Print or save as PDF", () => printTable(table, title)], excel && ["Excel", () => doAct(excel)]]} />{children}</>} />;
}

// t70, round 4 (the owner: "filters in the column headers, like Excel"): a column's filter is a small ▾ in its header, a
// native list (its aria-label the filter's name, as the boxes had); a header filtered shows a filled ▾ on a tint. The same
// filters as before (S.tdsFl, tdsFilter), no other state
function HeadFilter({ tab, k, label, options }) {
  const v = (((S.tdsFl || {})[tab] || {})[k]) || "";
  const chosen = v ? ((options.find((o) => o[0] === v) || [])[1] || v) : "";
  return <select className={"hf-sel" + (v ? " on" : "")} aria-label={label} title={"Filter: " + label + (v ? " · " + chosen : "")} value={v}
    onClick={(ev) => ev.stopPropagation()} onChange={(ev) => tdsFilter(tab, k, ev.target.value)}>
    {options.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>;
}
const hfOn = (tab, k) => ((((S.tdsFl || {})[tab] || {})[k]) ? "th-filtered" : undefined);
const anyOn = (tab) => Object.values((S.tdsFl || {})[tab] || {}).some(Boolean);
const ClearLink = ({ tab, bare }) => (anyOn(tab) ? <>{bare ? "" : " · "}<button type="button" className="linkbtn" data-ded-clear="" onClick={() => tdsFilterClear(tab)}>Clear filters</button></> : null);

// the shared list table (spec K6, round 2) with the return's own order (S.tdsSort, tdsSortBy): same headers and arrows
const via = (tab) => { const s = (S.tdsSort || {})[tab] || {}; return { state: s.k ? { k: s.k, dir: s.d < 0 ? "desc" : "asc" } : null, by: (k) => tdsSortBy(tab, k) }; };
const Toggle = ({ which, k, children }) => <button className="linkbtn" onClick={() => tdsToggle(which, k)}>{S[which] === k ? "▾ " : "▸ "}{children}</button>;
const Q_MON = { Q1: "Apr–Jun", Q2: "Jul–Sep", Q3: "Oct–Dec", Q4: "Jan–Mar" };
// kept for older imports: the TDS page no longer puts anything in a return's header
export const CardCtx = { node: null, help: null, ledger: null };

/* ---------------------------------------------------------------- 26Q */

// a TDS payment in Tally not yet a challan: give its BSR code and serial
// (tds-challans, 10-Oct-2026: the BSR box also takes the 20-digit CIN; the deductions the voucher pays bill-wise in Tally
// are said, as they will be proposed for the challan)
function PayRow({ p }) {
  const [bsr, setBsr] = useState(""), [ser, setSer] = useState(""), bw = TDSCH.billCount(p.vid), cin = !!TDSCH.cin(bsr);
  return <tr>
    <td>{day(p.date)}</td><td className="n">{money(p.tax)}{!num(p.tax) && <div className="nr">interest or fee only</div>}</td><td className="n">{money(num(p.interest) + num(p.fee) + num(p.others))}</td><td>{p.sections.join(", ")}</td><td>{p.voucher}{bw > 0 && <div className="nr">{bw} deduction{bw === 1 ? "" : "s"} paid bill-wise in Tally</div>}</td>
    <td><input type="text" value={bsr} placeholder="0240020 or the CIN" aria-label="BSR code or CIN" style={{ width: 170 }} onChange={(ev) => setBsr(ev.target.value)} /></td>
    <td><input type="text" value={cin ? TDSCH.cin(bsr).serial : ser} disabled={cin} placeholder="00979" aria-label="Challan serial" style={{ width: 90 }} onChange={(ev) => setSer(ev.target.value)} /></td>
    <td className="ac"><button className="btn small" onClick={() => challanFromBooks(p.vid, bsr, ser)}>Make it a challan</button></td>
  </tr>;
}

// the quarter's TDS payments in Tally not yet challans (Challans › Add challan ▾ › From a Tally TDS payment): give each its
// BSR code and serial, or the CIN. {n, el}
function tallyPaysOf(fy, q) {
  const allCh = TDS.challans(), pays = TDS.paymentsFromBooks().filter((p) => TDS.fyOf(p.date) === fy && TDS.qOf(p.date) === q).filter((p) => TDSTally.notChallan(p, allCh));
  return { n: pays.length, el: pays.length ? <section className="dash-card" style={{ marginBottom: 12 }}><h3>Paid to the government, from the books <Info label="About these payments">TDS payment vouchers in Tally for this quarter, proposed as challans. Give each its CIN (or BSR code and serial) to confirm it. Uploaded challans of the same date and amount are matched to them on their own.</Info></h3>
      <div className="bk-tablewrap"><table className="bk-table" data-statement="">
        <thead><tr><th>Date</th><th className="n">Tax</th><th className="n">Interest and fee</th><th>Sections</th><th>Voucher</th><th>BSR code or CIN</th><th>Serial</th><th className="ac"></th></tr></thead>
        <tbody>{pays.map((p) => <PayRow key={p.vid} p={p} />)}</tbody>
      </table></div></section> : <p className="note">No TDS payment in Tally this quarter is waiting to be made a challan.</p> };
}

// the ticked deductions (Deductions): their total, moved to a challan (the Move dialog of tds/Match.jsx: each challan's
// section, month and balance, refused over it) or taken off their challans; a bar at the foot, only while rows are ticked
function TagBar({ rows }) {
  const sel = rows.filter((r) => (S.tdsSel || {})[r.id]);
  if (!sel.length) return null;
  const total = r2(sel.reduce((a, r) => a + r.tds, 0)), tagged = sel.filter((r) => r.challan).map((r) => r.id);
  return <div className="cm-bar-sel" data-tag-bar="">
    <span><b>{sel.length} ticked</b> · TDS <b>{money(total)}</b></span>
    <button className="btn small" data-tag-move="" onClick={() => tdsMoveOpen(sel.map((r) => r.id))}>Move to challan…</button>
    {tagged.length > 0 && <button className="btn small" onClick={() => tdsTakeOff(tagged)}>Take off challan{tagged.length < sel.length ? " (" + tagged.length + ")" : ""}</button>}
    <button className="linkbtn" onClick={() => { S.tdsSel = {}; render(); }}>Clear</button>
  </div>;
}
const selSet = (ids, on) => { const s = { ...(S.tdsSel || {}) }; ids.forEach((id) => { if (on) s[id] = true; else delete s[id]; }); S.tdsSel = s; render(); };

// the reason under the rate, in short ("should be 20% (no PAN, 206AA)"); in the row's details and Validate & file in full
const shortWhy = (w) => String(w || "").replace(/no valid PAN, section /, "no PAN, ").replace(/, section 206AA/, ", 206AA").replace(/\s*\(higher rate\)/, "").replace(/\s*\(PAN's 4th letter \w\)/, "")
  .replace(/:\s*[\d.]+%$/, "").replace(/^(certificate [^ (:]+).*$/, "$1").replace(/^the section's higher rate.*$/, "the section's higher rate");
const Rate = ({ r, issue }) => <>{r.rate != null ? r.rate + "%" : ""}{issue && <span className="rt-dot" data-rate-q="" title={"should be " + issue.expected + "%" + (issue.why ? " (" + shortWhy(issue.why) + ")" : "")} aria-label={"rate question: should be " + issue.expected + "%"}>•</span>}</>;

// t70: the corrected Excel brought back: each change, old → new, what is refused and why; nothing applied until Apply.
// In a drawer beside the table (design §3.6), not a card above it
function ImportPreview({ rows }) {
  const p = S.tdsImport;
  const close = () => { S.tdsImport = null; render(); };
  if (!p) return <SideDrawer open={false} onClose={close} kind="import" />;
  const word = (k) => TDSEdit.WORDS[k] || k, show = (k, v) => (["paid", "tds"].includes(k) && v !== "" ? money(v) : k === "rate" && v !== "" ? v + "%" : v === "" || v == null ? "—" : String(v));
  const apply = () => { const r = TDSEdit.applyAll(p, rows); S.tdsImport = null; saveBooks(); toast(r.n + " change" + (r.n === 1 ? "" : "s") + " applied" + (r.why.length ? "; not applied: " + r.why.join("; ") : "") + "."); render(); };
  return <SideDrawer open onClose={close} kind="import" wide title={"The corrected Excel: " + p.changes.length + " change" + (p.changes.length === 1 ? "" : "s") + " to apply"} description={p.name}>
    <div className="tg-import" data-imp-preview="">
    {p.error ? <p className="note bad">{p.error}</p> : <>
    <p className="note">{p.rows} deduction{p.rows === 1 ? "" : "s"} read · {p.changes.length} change{p.changes.length === 1 ? "" : "s"}{p.refused.length ? " · " + p.refused.length + " refused" : ""}{p.unmatched.length ? " · " + p.unmatched.length + " not matched" : ""}. Nothing is changed until you apply. The books from Tally are not changed: these are kept as FinCom’s corrections of the return.</p>
    {p.changes.length > 0 && <div className="bk-tablewrap"><table className="bk-table tg-fit" data-statement="" data-imp-changes="">
      <thead><tr><th className="n">Line</th><th>Deduction</th><th>What</th><th>Now</th><th>In the file</th></tr></thead>
      <tbody>{p.changes.map((c, i) => <tr key={i} data-imp-change={c.field}><td className="n">{c.line}</td><td>{c.who}</td><td>{word(c.field)}</td><td>{show(c.field, c.from)}</td><td><b>{show(c.field, c.to)}</b></td></tr>)}</tbody></table></div>}
    {p.refused.length > 0 && <><h3 style={{ marginTop: 10 }}>Refused</h3><ul className="note" data-imp-refused="">{p.refused.map((x, i) => <li key={i} data-imp-refused-field={x.field}>Line {x.line}, {x.who}: {word(x.field)} “{x.value}”: {x.why}</li>)}</ul></>}
    {p.unmatched.length > 0 && <p className="note" data-imp-unmatched="">Not found in this return (FinCom id): {p.unmatched.map((x) => "line " + x.line).join(", ")}.</p>}
    {p.notes.length > 0 && <ul className="note" data-imp-notes="">{p.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    </>}
    <div className="row" style={{ gap: 8, marginTop: 8 }}>
      {!p.error && p.changes.length > 0 && <button className="btn small primary" data-imp-apply="" onClick={apply}>Apply {p.changes.length} change{p.changes.length === 1 ? "" : "s"}</button>}
      <button className="btn small" onClick={close}>{p.changes.length && !p.error ? "Cancel" : "Close"}</button></div>
    </div></SideDrawer>;
}
async function importExcel(file, rows) {
  if (!file) return;
  try {
    await ensureXlsx();
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
    S.tdsImport = Object.assign({ name: file.name }, TDSEdit.read(wb, rows));
  } catch (e) { S.tdsImport = { name: file.name, error: "Could not read this file: " + ((e && e.message) || e), changes: [], refused: [], unmatched: [], notes: [] }; }
  render();
}
// "edited in FinCom: books ₹X" beside an amount corrected in FinCom (a mark; the words on a hover and in the row's details)
const Edited = ({ r, k }) => (r.books && Math.abs(num(r.books[k]) - num(r[k])) >= 0.005 ? <span className="tg-edited" data-edited={k} title={"edited in FinCom: books " + money(r.books[k])}> ✎</span> : null);

// the Deductions step (design §3.6): one line a deduction, eight columns (☐ · date · deductee · PAN · section · paid ·
// rate · TDS · challan); the voucher, the source and the rate's reason in the row's drawer (Match.jsx RowDetails). A
// challan chosen at the top: the challan-first two-panel view (ChallanTicker), as on Challans. "By section" swaps the
// table for the section summary
function Deductions({ fy, q, rows, issueOf, pass, probs = {}, unitW, edN = 0, fo, form, m }) {
  const f = (S.tdsFl || {}).deductions || {}, locked = TDSReg.locked(fy, q, form);
  const shown = tdsSorted("deductions", sideFilter(rows.filter((r) => pass(r, f)), m), (r, k) => k === "date" ? TDS.ymd(r.date) : k === "challan" ? (r.challan ? 1 : 0) : r[k] == null ? "" : r[k]);
  const LIMIT = 500, sel = S.tdsSel || {};
  return <div className="dd-two">
    <div className="dd-main">{S.tdsDedView === "sections" ? <BySection fy={fy} q={q} form={form} /> : <DedTable {...{ fy, rows, shown, issueOf, probs, unitW, edN, fo, form, m, locked, sel, LIMIT }} />}</div>
    <ChallanSide form={form} fy={fy} q={q} rows={rows} m={m} />
  </div>;
}
function DedTable({ fy, rows, shown: shown0, issueOf, probs, unitW, edN, fo, form, m, locked, sel, LIMIT }) {
  // round 86: the deductions with no challan of one section and month together, under one header line saying why
  const gr = groupRows(shown0, m), shown = gr.rows;
  const ids = shown.slice(0, LIMIT).map((r) => r.id), C = (r, k, el) => <Cell r={r} k={k} form={form} locked={locked}>{el}</Cell>;
  return <div onKeyDown={(ev) => onTableKey(ev, ids)} data-ded-keys="">
    <ImportPreview rows={rows} />
    <ListTable name="tdsDeductions" id="tdsDnTable" className="bk-table tg-fit rt-rows gf-off" rows={shown}
      footNote={<span className="note tg-dcount" data-ded-count="">{shown.length + " of " + rows.length + " " + (unitW || "deductions") + " · " + (unitW === "collections" ? "TCS " : "TDS ") + money(shown.reduce((a, r) => a + r.tds, 0)) + (edN ? " · " + edN + " edited in FinCom" : "")}<ClearLink tab="deductions" /></span>} rowKey={(r) => r.id} unit={["deduction", "deductions"]} of={rows.length} sortVia={via("deductions")} limit={LIMIT}
      more={<p className="note">The first {LIMIT} are shown. Narrow them with the filters, or download the Excel for all {shown.length}.</p>}
      empty={rows.length ? "No deduction matches these filters. Use Clear filters to see all." : "Deductions come from the client's books in Tally automatically; add one here (Add deduction) or import Excel (⋯)."} keepHead={rows.length ? <p className="note" style={{ textAlign: "center" }}><ClearLink tab="deductions" bare /></p> : null}
      rowProps={(r) => ({ "data-ded-row": r.id, tabIndex: 0, className: probs[r.id] ? "rt-fix" : undefined })}
      before={(r) => (gr.firstOf[r.id] ? <GroupHead g={gr.firstOf[r.id]} form={form} locked={locked} /> : null)}
      cols={[
        { k: "pick", role: "pick", cls: "ck dd-pick", sort: false, head: <input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((r) => sel[r.id])} onChange={(ev) => selSet(shown.map((r) => r.id), ev.target.checked)} />,
          cell: (r) => <input type="checkbox" aria-label={"Select " + r.party} checked={!!sel[r.id]} onChange={(ev) => selSet([r.id], ev.target.checked)} /> },
        { k: "date", role: "date", label: "Date", cls: "dt", thCls: hfOn("deductions", "month"), filter: <HeadFilter tab="deductions" k="month" label="Month" options={fo.month} />, v: (r) => TDS.ymd(r.date), td: (r) => ({ title: "Deducted on " + day(r.date) + (r.credit ? ", paid or credited on " + day(r.credit) : "") }), cell: (r) => C(r, "date", day(r.date).slice(0, 6)) },
        { k: "party", role: "party", label: unitW === "collections" ? "Buyer" : "Deductee", cls: "pty", v: (r) => r.party, cell: (r) => <><button type="button" className="linkbtn rt-name" data-row-detail={r.id} title={(r.voucher ? "Voucher " + r.voucher + " · " : "") + "Details"} onClick={() => { S.tdsRowDet = r.id; render(); }}>{r.party}</button>{r.added ? <small className="tg-sub-i" data-added="" title={"Added in FinCom" + (r.addedBy ? " by " + r.addedBy : "")}> · added in FinCom</small> : null}<Fixes r={r} issue={issueOf[r.id]} m={m} locked={locked} /></> },
        { k: "pan", label: "PAN", thCls: hfOn("deductions", "pan"), filter: <HeadFilter tab="deductions" k="pan" label="PAN" options={fo.pan} />, v: (r) => r.pan || "", cell: (r) => <span data-pan="">{Certs.validPan(r.pan) ? r.pan : <PanBox party={r.party} compact />}</span> },
        { k: "section", label: "Section", thCls: hfOn("deductions", "section"), filter: <HeadFilter tab="deductions" k="section" label="Section" options={fo.section} />, v: (r) => r.section || "", td: (r) => ({ title: secTitle(r.section, fy) || undefined }), cell: (r) => C(r, "section", <span data-sec={TDS.sec(r.section)}>{TDS.sec(r.section) || r.section}</span>) },
        { k: "paid", label: "Paid", cls: "n", v: (r) => r.paid, fmt: money, cell: (r) => C(r, "paid", <>{money(r.paid)}<Edited r={r} k="paid" /></>) },
        { k: "rate", label: "Rate", cls: "n", thCls: hfOn("deductions", "rate"), filter: <HeadFilter tab="deductions" k="rate" label="Rate" options={fo.rate} />, v: (r) => (r.rate == null ? "" : r.rate), cell: (r) => C(r, "rate", <Rate r={r} issue={issueOf[r.id]} />) },
        { k: "tds", label: unitW === "collections" ? "TCS" : "TDS", cls: "n", v: (r) => r.tds, fmt: money, cell: (r) => C(r, "tds", <>{money(r.tds)}<Edited r={r} k="tds" /></>) },
        { k: "challan", label: "Challan · suggested", cls: "dd-chcol", thCls: hfOn("deductions", "challan"), filter: <HeadFilter tab="deductions" k="challan" label="Challan" options={fo.challan} />, v: (r) => (r.challan ? 1 : 0), cell: (r) => <ChallanOrSugg r={r} m={m} locked={locked} /> },
      ]} />
    <BulkBar rows={rows} issueOf={issueOf} form={form} />
    <KeysHelp />
  </div>;
}

// the rate questions table, shared by the return's checks and the certificates page
function RateQuestions({ list }) {
  // the one list table (spec K6): date, deductee (party), paid (amount), then the rest
  return <ListTable name="tdsRateQ" rows={list} rowKey={(x, i) => x.row.id || i} unit={["deduction", "deductions"]} empty={null}
    cols={[
      { k: "date", role: "date", label: "Date", cls: "dt", v: (x) => TDS.ymd(x.row.date), cell: (x) => day(x.row.date) },
      { k: "party", role: "party", label: "Deductee", v: (x) => x.row.party, cell: (x) => x.row.party },
      { k: "paid", role: "amount", label: "Paid", cls: "n", v: (x) => num(x.row.paid), fmt: money, cell: (x) => money(x.row.paid) },
      { k: "pan", label: "PAN", v: (x) => x.row.pan || "", cell: (x) => <Pan pan={x.row.pan} /> },
      { k: "sec", label: "Section", v: (x) => x.row.section || "", cell: (x) => <Sec s={x.row.section} fy={x.row.fy || S.tdsFy} /> },
      { k: "used", label: "Rate used", cls: "n", v: (x) => (x.row.rate == null ? "" : x.row.rate), cell: (x) => (x.row.rate == null ? "" : x.row.rate + "%") },
      { k: "exp", label: "Rate that applies", cls: "n", v: (x) => x.expected, cell: (x) => x.expected + "%" },
      { k: "why", label: "Why", cell: (x) => x.why },
      { k: "short", label: "Short or excess", cls: "n", v: (x) => num(x.short), sum: true, fmt: money, td: (x) => ({ className: x.short > 0 ? "bad" : undefined }), cell: (x) => money(x.short) },
    ]} />;
}

// the FVU's answer on the file (on the File tab since 09-Oct-2026; it was above the 26Q checks and the 27Q/27EQ checks)
function FvuResult({ form }) {
  const fr = S.fvuResult;
  if (!fr || (form !== "26Q" && fr.form !== form)) return null;
  const what = form === "26Q" ? fr.q : form;
  return <section className={"bk-alert " + (fr.ok ? "" : "bad")}><b>{fr.ok ? "The FVU accepted the " + what + " file." : "The FVU found problems in the " + (what || "") + " file."}</b>
    {form === "26Q" && fr.fvu && <p className="note">Upload file: {fr.fvu}</p>}
    {fr.errors && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 220, overflow: "auto", margin: "8px 0 0" }}>{String(fr.errors).slice(0, 4000)}</pre>}
    {form === "26Q" && !fr.errors && !fr.ok && fr.output && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 160, overflow: "auto" }}>{String(fr.output).slice(0, 2000)}</pre>}
    <div className="row" style={{ marginTop: 8 }}><button className="linkbtn" onClick={() => doAct("fvuClose")}>Hide this</button></div></section>;
}

// the quarter by section (on the Summary since 09-Oct-2026; it was the last part of the checks)
function BySection({ fy, q, form }) {
  const sum = form === "26Q" ? TDS.summary(fy, q) : TDS.summary(fy, q, form), tcs = form === "27EQ";
  return <section className="dash-card" style={{ marginTop: 12 }}><h3>By section</h3><div className="bk-tablewrap"><table className="bk-table" data-statement="">
    <thead><tr><th>Section</th><th className="n">{tcs ? "Collections" : "Deductions"}</th><th className="n">{form === "26Q" ? "Paid or credited" : "Paid or received"}</th><th className="n">{tcs ? "TCS" : "TDS"}</th><th className="n">Not against a challan</th></tr></thead>
    <tbody>{sum.map((s) => <tr key={s.section}><td><Sec s={s.section} fy={fy} /></td><td className="n">{s.count}</td><td className="n">{money(s.paid)}</td><td className="n">{money(s.tds)}</td><td className="n">{money(s.unallocated)}</td></tr>)}</tbody>
  </table></div></section>;
}

// 27Q and 27EQ: what is missing before the file can be made, the non-resident's details, and the FVU's answer
function NrInfo({ party }) {
  const i = TDS26Q.nrInfo(party);
  const f = (k, label, w = 140) => <label className="nr" style={{ display: "inline-flex", flexDirection: "column", marginRight: 8 }}>{label}
    <input type="text" defaultValue={i[k] || ""} aria-label={label + ": " + party} style={{ width: w }} onBlur={(ev) => tdsNrSet(party, k, ev.target.value)} /></label>;
  return <tr data-nr={party}><td>{party}</td><td colSpan={2}>
    {f("country", "Country code", 60)}{f("nature", "Nature code", 60)}{f("ack15ca", "15CA acknowledgement")}{f("tin", "Tax ID in the country")}
    {f("email", "Email", 180)}{f("phone", "Phone")}{f("address", "Address", 260)}
    <label className="nr"><input type="checkbox" defaultChecked={!!i.dtaa} onChange={(ev) => tdsNrSet(party, "dtaa", ev.target.checked)} /> Treaty (DTAA) rate</label>{" "}
    <label className="nr"><input type="checkbox" defaultChecked={!!i.trc} onChange={(ev) => tdsNrSet(party, "trc", ev.target.checked)} /> Tax residency certificate and Form 10F on file</label>
  </td></tr>;
}
function ChecksOther({ fy, q, form, other, rows }) {
  const parties = Array.from(new Set(rows.map((r) => r.party)));
  return <>
    <section className="dash-card" style={{ marginBottom: 12 }} data-checks={form}><h3>Before the file is made</h3>
      {other.length ? <ul>{other.map((x, i) => <li key={i}>{x.party ? <><b>{x.party}</b>: missing {x.missing.join(", ")}</> : x.why}</li>)}</ul>
        : <p className="note">Nothing is missing.</p>}
    </section>
    {form === "27Q" && <section className="dash-card" style={{ marginBottom: 12 }}><h3>Non-resident deductees</h3>
      <p className="note">The 27Q file needs these for each deductee. The country and nature codes are the ones in the return's own lists.</p>
      <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th>Deductee</th><th colSpan={2}>Details</th></tr></thead>
        <tbody>{parties.map((p) => <NrInfo key={p} party={p} />)}</tbody></table></div></section>}
    {form === "27EQ" && <section className="dash-card" style={{ marginBottom: 12 }}><h3>Collection codes</h3>
      <p className="note">Each TCS ledger needs the 27EQ collection code of what was sold.</p>
      <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th>TCS ledger</th><th>Collection code</th></tr></thead>
        <tbody>{Array.from(new Set(rows.map((r) => r.ledger))).map((l) => <tr key={l}><td>{l}</td><td>
          <select aria-label={"Collection code: " + l} value={TCS27EQ.codeOf(l)} onChange={(ev) => tdsTcsCode(l, ev.target.value)}>
            <option value="">Choose…</option>{TCS27EQ.CODES.map(([c, t]) => <option key={c} value={c}>{c} · {t}</option>)}</select></td></tr>)}</tbody></table></div></section>}
  </>;
}

// the ⋯ of every return: the working, the Excel to correct and bring back, a correction, how this works, the register
function retMore({ fy, q, form, extra = [] }) {
  const filed = TDSReg.filed(fy, q, form), open = TDSReg.corrOpen(fy, q, form);
  return extra.concat([
    filed && !open && ["Open a correction…", () => openCorrection(fy, q, form), { "data-open-correction": "" }],
    open && ["Close the correction", () => { TDSReg.closeCorrection(fy, q, form); render(); }, { "data-close-correction": "" }],
    ["How this works", () => {}, { "data-help": "open", "data-ret-how": "" }],
    ["Tips for matching challans", () => { S.tdsHow = true; render(); }, { "data-ret-tips": "" }],
    ["The challan register", () => tdsNav("register")],
  ]);
}
// ⋯ › How this works (the Challans step's tips, as they were)
function HowItWorks() {
  const close = () => { S.tdsHow = false; render(); };
  return <SideDrawer open={!!S.tdsHow} onClose={close} kind="how" title="How a TDS return is made here" description="Deductor · Deductees · Challans · Deductions · Validate & file · After filing">
    <ul className="note" data-cm-tips="">
      <li>Pay one challan per section per month: each challan then matches its month’s deductions exactly, and nothing needs choosing.</li>
      <li>Before making the file, download the challan file (CSI) from the income-tax portal for this TAN: the FVU checks each challan against it.</li>
      <li>Use a balance left on an earlier challan of the same tax year before paying a fresh one.</li>
      <li>One deduction is paid by one challan. If no challan has enough left, split the row: two rows, the same dates, each on its challan.</li>
      <li>Validate & file lists what blocks the file (errors) and what to look at (warnings); each line opens the step where it is fixed.</li>
    </ul></SideDrawer>;
}
// "Show" pills of a step's toolbar: [[key, label, count]]
const Pills = ({ items, cur, on }) => <span className="segs" role="group" aria-label="Show">{items.map(([k, l, n]) => <button key={k || "all"} type="button" className={"seg" + (cur === k ? " on" : "")} aria-pressed={cur === k} data-ded-show={k || "all"} onClick={() => on(k)}>{l}{n != null ? <span className="sbar-n">{n}</span> : null}</button>)}</span>;

export function Return26({ b, allRows, form = "26Q" }) {
  const fy = S.tdsFy, q = S.tdsQ, rows = allRows.filter((r) => r.fy === fy && r.q === q);
  const ch = tdsQuarterChallans(fy, q, rows), allCh = TDS.challans();
  const issues = form === "26Q" ? Certs.issues(fy, q) : [], issueOf = {};
  issues.forEach((x) => { issueOf[x.row.id] = x; });
  const deductees = new Set(rows.map((r) => (r.pan && Certs.validPan(r.pan) ? r.pan : normName(r.party)))).size;
  S.tdsTab = tabNow(S.tdsTab, form);
  const tds = r2(rows.reduce((a, r) => a + r.tds, 0)), un = unplacedOf(rows);
  // T-E1, T-S3 (10-Oct-2026): every form has its interest and late fee; a return marked filed (or its quarter's date under
  // Settings › Closed periods) has its fee worked out to that date, and the fee is then not an error to fix
  const filed = TDSFiled.get(fy, q, form), filedOn = filed ? filed.on : "";
  const int1A = TDS.interest(fy, q, form), fee = TDS.lateFee(fy, q, filedOn, form), noPan = rows.filter((r) => !Certs.validPan(r.pan)).length;
  const drift = filed ? TDSDrift.check(fy, q, form) : null;
  const fname = TDS.formName(form, fy), draft = TDS.isNew(fy) && !NEW_FORMS_VALIDATED;
  const title = CO().name + " " + fname + " " + q + " " + fy;
  const other = form === "27Q" ? TDS26Q.nrChecks(fy, q) : form === "27EQ" ? TCS27EQ.checks(fy, q) : [];
  // the challans a deduction may be put on: the quarter's, the year's, and any other with tax left
  const chOpts = ch.concat(allCh.filter((c) => !ch.includes(c) && (TDS.fyOf(c.date) === fy || TDSReg.balance(c).tax > 0.005)));
  const secs = Array.from(new Set(rows.map((r) => r.section))).sort();
  const secOpts = [["", "Every section", "All sections"]].concat(secs.map((x) => { const n = TDS.secNew(x, fy); return [x, n.ref ? n.text + " · " + n.label : x, n.ref ? n.ref + " [" + n.old + "]" : undefined]; }));
  // t70: what the return already finds wrong, by deduction ("Needs fixing", and the Excel's last column)
  const probs = TDSEdit.problems(rows, fy, q, form), edN = TDSEdit.edited(rows).length;
  const pass = (r, f) => {
    const qq = String(f.q || "").toLowerCase();
    if (qq && ![r.party, r.pan, TDS.secFind(r.section, fy), r.voucher, r.ledger].join(" ").toLowerCase().includes(qq)) return false;
    if (f.section && r.section !== f.section) return false;
    if (f.pan === "no" && Certs.validPan(r.pan)) return false;
    if (f.pan === "yes" && !Certs.validPan(r.pan)) return false;
    if (f.pan === "none" && String(r.pan || "").trim()) return false;
    if (f.pan === "invalid" && (!String(r.pan || "").trim() || Certs.validPan(r.pan))) return false;
    if (f.pan === "inop" && !(Certs.validPan(r.pan) && Certs.inoperative(r.pan))) return false;
    if (f.challan === "no" && r.challan) return false;
    if (f.challan === "yes" && !r.challan) return false;
    if (f.challan && f.challan.startsWith("ch:") && r.challan !== f.challan.slice(3)) return false;
    if (f.rate === "low" && !(issueOf[r.id] && issueOf[r.id].short > 0)) return false;
    if (f.rate === "high" && !(issueOf[r.id] && issueOf[r.id].short < 0)) return false;
    if (f.rate === "cert" && !Certs.forRow(r)) return false;
    if (f.month && TDS.ymd(r.date).slice(0, 6) !== f.month) return false;
    if (f.rate === "q" && !issueOf[r.id]) return false;
    if (f.rate === "ok" && issueOf[r.id]) return false;
    if (f.fix && !probs[r.id]) return false;
    return true;
  };
  // the filters' choices, for the ▾ in the table's headers
  const fo = {
    month: [["", "All months"]].concat(tdsMonths(fy, q).map((m) => [m, monthName(m)])),
    section: secOpts.map(([v, l]) => [v, v ? l : "All sections"]),
    pan: [["", "PAN: any"], ["no", "No valid PAN"], ["none", "No PAN given"], ["invalid", "PAN not in the PAN form"], ["inop", "PAN inoperative"], ["yes", "Has a PAN"]],
    challan: [["", "Challan: any"], ["no", "Not against a challan"], ["yes", "Against a challan"]].concat(chOpts.filter((c) => rows.some((r) => r.challan === c.id)).map((c) => ["ch:" + c.id, "Challan " + TDSCH.label(c)])),
    rate: [["", "Rate: any"], ["q", "Rate questions"], ["low", "Below the rate that applies"], ["high", "Above the rate that applies"], ["cert", "Lower-deduction certificate"], ["ok", "Rate as expected"]],
  };
  const fD = (S.tdsFl || {}).deductions || {};
  const shownD = tdsSorted("deductions", rows.filter((r) => pass(r, fD)), (r, k) => k === "date" ? TDS.ymd(r.date) : k === "challan" ? (r.challan ? 1 : 0) : r[k] == null ? "" : r[k]);
  const fixN = rows.filter((r) => probs[r.id]).length, file = useRef(null), dm = S.tdsTab === "deductions" ? dedMatch(form, fy, q) : null;
  const sfx = dm ? safeFixes(rows, issueOf, dm) : [], ready = readyCount(rows, issueOf);
  const unit = form === "27EQ" ? "collections" : "deductions";
  const notCh = r2(un.reduce((a, r) => a + r.tds, 0));
  // round 89: the count is the Challans grid's rows, the sum this return's TDS on them (tds/Winman.jsx retChallans)
  const key = TDSReg.key(form, fy, q), rc = retChallans(form, fy, q), usedN = rc.n;
  // the one problem count: Validate & file's
  const val = checkReturn(fy, q, form);
  const status = statusOf({ fy, q, form, has: rows.length > 0 || usedN > 0, errors: val.errors.length, drift: val.drift, problems: val.n });
  const itemN = (k) => { const it = val.errors.concat(val.warnings).find((x) => x.k === k); return it ? it.n : 0; };
  const steps = [
    { id: "deductor", label: "Deductor", done: !itemN("deductor"), sub: itemN("deductor") ? { text: itemN("deductor") + " to complete" } : null },
    { id: "deductees", label: stepName("deductees", form), count: deductees, sub: itemN("nopan") ? { text: itemN("nopan") + " PAN" } : null },
    { id: "challans", label: "Challans", count: usedN, sub: un.length ? { text: un.length + " not matched", bad: true } : null },
    { id: "deductions", label: stepName("deductions", form), count: rows.length, sub: issues.length ? { text: issues.length + " rate" } : null },
    { id: "file", label: "Validate & file" },
    { id: "after", label: "After filing", off: !TDSReg.filed(fy, q, form), why: "Once the return is marked filed (Validate & file › Mark filed)" },
  ];
  const confirmable = (() => { try { return TDSMatch.suggest(form, fy, q).filter((s) => s.rule !== "split").length; } catch (e) { return 0; } })();
  const primary = (S.tdsTab === "challans" || S.tdsTab === "deductions") && confirmable && !TDSReg.locked(fy, q, form) ? null : undefined;
  const more = retMore({ fy, q, form, extra: [["Download the " + fname + " working (Excel)", () => doAct("tdsExcel")],
    ["Excel to correct and bring back", () => TDSEdit.toExcel(shownD, probs, fy, title + " deductions").then(() => toast("Downloaded."))],
    ["Import corrected Excel…", () => { S.tdsTab = "deductions"; render(); setTimeout(() => { const el = document.querySelector("[data-ded-import]"); if (el) el.click(); }, 50); }]] });
  const strip = [
    { label: form === "27EQ" ? "TCS" : "TDS", value: money(tds), sub: rows.length + " " + unit + " · " + deductees + (form === "27EQ" ? " buyers" : " deductees") },
    { label: "On challans", value: money(rc.here), sub: usedN + " challan" + (usedN === 1 ? "" : "s") },
    { label: "Left", value: money(notCh), bad: notCh > 0.005, sub: un.length ? un.length + " not matched" : null },
  ];
  const reviews = {
    unmatched: <FixRows title={un.length + " " + unit + " without a challan · " + money(notCh)} rows={un} unit={unit} />,
    over: TDSReg.overUsed(fy, q, form).length ? <section className="dash-card" style={{ marginBottom: 12 }} data-over-used=""><h3>Challans used beyond their amount</h3>
      <p className="note">Two people allocated at once, or an old tagging: the file cannot be made until each is within its amount. Take deductions off them on Challans.</p>
      <ul className="note">{TDSReg.overUsed(fy, q, form).map((c) => <li key={c.id}>{TDSCH.label(c)}: {money(-TDSReg.balance(c).tax)} over</li>)}</ul></section> : null,
    nopan: <FixRows title={noPan + " " + unit + " without a valid PAN"} rows={rows.filter((r) => !Certs.validPan(r.pan))} unit={unit} />,
    rate: <section className="dash-card" style={{ marginBottom: 12 }}><h3>Rate questions</h3>{issues.length ? <RateQuestions list={issues} /> : <p className="note">Every deduction matches the rate that applies.</p>}</section>,
    paycode: <PayCodeRows fy={fy} q={q} form={form} />,
    nrdetails: <ChecksOther fy={fy} q={q} form={form} other={other} rows={rows} />,
    nocode: <ChecksOther fy={fy} q={q} form={form} other={other} rows={rows} />,
    tcsrate: <ChecksOther fy={fy} q={q} form={form} other={other} rows={rows} />,
    interest: <InterestFee fy={fy} q={q} form={form} list={int1A} fee={fee} filed={filedOn} />,
    tally: <TallyDiffs kind="challan" />,
    chtype: <UnknownChallans fy={fy} q={q} form={form} />,
    corr: <Correction fy={fy} q={q} form={form} drift={drift} />,
    traces: <TracesDefaults jr={TRF.jrFor(fy, q, form)} />,
    portal: form === "26Q" ? <PortalRows fy={fy} q={q} /> : null,
  };
  const make = () => { doAct("tdsTxt"); try { if (!TDS26Q.build(fy, q, TDS26Q.firmDetails(), form).error) FvuMade.mark(fy, q, form); } catch (e) { /* */ } render(); };
  const fileBox = <div className="vf-file" data-file={form}>
    <p className="vf-amber" data-fvu-check="" {...(draft ? { "data-draft": TDS.formNo(form, fy) } : {})}>{draft
      ? <><b>{fname} (earlier {form}): draft – not yet validated.</b> From 1 April 2026 the return is {fname} under the Income-tax Act, 2025, with new payment codes and file layout. FinCom’s file is not yet matched to Protean’s file format or run through their FVU: do not file it.</>
      : <><b>Check with Protean’s FVU before filing.</b> The file’s layout and some section codes are not yet confirmed against Protean’s current format.</>}</p>
    <FvuResult form={form} />
    <div className="vf-frow" data-prefile-slot="">
      <PrnBox fy={fy} q={q} form={form} />
      <button className="btn small primary" data-make-fvu="" disabled={val.errors.length > 0} title={val.errors.length ? "Fix the errors above first" : "Make the text file the FVU checks, and download it"} onClick={make}>Make FVU file{draft ? " (draft)" : ""}</button>
      <button className="btn small" onClick={() => doAct("tdsExcel")}>Download working</button>
      <button className="btn small" disabled={!Bridge.on() || draft} title={draft ? "A draft is not sent to the FVU" : Bridge.on() ? undefined : "Needs FinCom Bridge"} onClick={() => doAct("tdsFvu")}>Check with FVU</button>
    </div>
    {val.errors.length > 0 && <p className="note bad" data-make-why="">Fix the {val.errors.length === 1 ? "error" : val.errors.length + " errors"} above first: the file is not made while {val.errors.length === 1 ? "it is" : "any is"} left.</p>}
    <MarkFiled fy={fy} q={q} form={form} />
  </div>;
  // next-tds-allchallans (the owner's layout): the Deductions step opens on its to-do list (tds/DedTodo.jsx); "All rows"
  // is the table with every filter, the challans panel and editing in place (S.tdsDedView "table")
  const todo = !S.tdsDedView;
  const tools = <div className="rt-tool" data-step-tool="">
    {<><Search value={fD.q} placeholder="Find deductee, PAN, voucher" label="Find a deductee, PAN, voucher or ledger" data-fk="tdsf-deductions" onChange={(v) => tdsFilter("deductions", "q", v, true)} />
      <Pills cur={todo ? "todo" : S.tdsDedView === "sections" ? "sections" : fD.challan === "no" ? "no" : fD.fix ? "fix" : ""} on={(k) => {
        if (k === "todo") { S.tdsDedView = ""; render(); return; }
        S.tdsDedView = k === "sections" ? "sections" : "table";
        const nf = Object.assign({}, fD, { challan: k === "no" ? "no" : fD.challan === "no" ? "" : fD.challan, fix: k === "fix" ? "1" : "" });
        if (!k) { nf.challan = fD.challan === "no" ? "" : fD.challan; nf.fix = ""; }
        S.tdsFl = Object.assign({}, S.tdsFl || {}, { deductions: nf }); render(); }}
        items={[["todo", "By challan"], ["", "All rows"], ["no", "No challan", un.length], ["fix", "Needs fixing", fixN], ["sections", "By section"]]} /></>}
    <span className="rt-sp" />
    {sfx.length > 0 && !TDSReg.locked(fy, q, form) && <button type="button" className="btn small" data-fix-all="" title={sfx.map((f) => f.label).join("; ")} onClick={() => { let n = 0; sfx.forEach((f) => { const x = f.apply(); if (x && x.ok) n++; }); TDSReg.forget(); TDSReg.done(); saveBooks(); toast(n + " safe fix" + (n === 1 ? "" : "es") + " applied."); render(); }}>Apply all safe fixes ({sfx.length})</button>}
    {!todo && dm && dm.accept.length > 0 && !TDSReg.locked(fy, q, form) && <button type="button" className="btn small primary" data-dd-accept-all="" data-cm-confirm-all="" onClick={() => tdsMatchConfirmAll()}>Accept all {dm.accept.reduce((a, s) => a + s.ids.length, 0)} suggestions</button>}
    {form !== "27EQ" && !TDSReg.locked(fy, q, form) && <button type="button" className="btn small" data-add-open="" onClick={() => openAdd({ chId: S.tdsDedChF && S.tdsDedChF !== "__none" ? S.tdsDedChF : "" })}>Add deduction</button>}
    <More label="⋯" ariaLabel="Export" data-fb-out="" items={[["Print or save as PDF", () => printTable("tdsDnTable", title + " deductions")], ["Excel to correct and bring back (these " + shownD.length + ")", () => TDSEdit.toExcel(shownD, probs, fy, title + " deductions").then(() => toast("Downloaded."))],
      ["The return’s working (Excel)", () => doAct("tdsExcel")], ["Import corrected Excel…", () => file.current && file.current.click(), { "data-ded-import-btn": "" }]]} />
    <input ref={file} type="file" hidden accept=".xlsx,.xls" aria-label="Import corrected Excel" data-ded-import="" onChange={(ev) => { const x = ev.target.files && ev.target.files[0]; ev.target.value = ""; importExcel(x, rows); }} />
  </div>;
  // round 88 (as Winman): the step opens on a challan (tds/Winman.jsx DedByChallan); "Not on any challan" is the to-do
  // list; the table with every filter and By section are under ⋯
  const winTools = <span className="wd-tools"><More label="⋯" ariaLabel="More" data-wd-more="" items={[["All " + unit + " in one table", () => { S.tdsDedView = "table"; render(); }, { "data-wd-all": "" }],
      ["By section", () => { S.tdsDedView = "sections"; render(); }], ["Print or save as PDF", () => printTable("tdsDnTable", title + " deductions")],
      ["Excel to correct and bring back", () => TDSEdit.toExcel(shownD, probs, fy, title + " deductions").then(() => toast("Downloaded."))],
      ["The return’s working (Excel)", () => doAct("tdsExcel")], ["Import corrected Excel…", () => file.current && file.current.click(), { "data-ded-import-btn": "" }]]} />
    <input ref={file} type="file" hidden accept=".xlsx,.xls" aria-label="Import corrected Excel" data-ded-import="" onChange={(ev) => { const x = ev.target.files && ev.target.files[0]; ev.target.value = ""; importExcel(x, rows); }} /></span>;
  return <>
    <ReturnShell fy={fy} q={q} form={form} status={status} statusTitle={drift && drift.rows.length ? "Filed, and changed in Tally since: a correction is needed" : TDSReg.corrOpen(fy, q, form) ? "A correction is open: this return’s challans may change" : undefined}
      draft={draft && !filed} val={val} primary={primary} more={more} strip={strip} steps={steps} progress={rows.length ? { done: ready, of: rows.length } : null}>
      {S.tdsTab === "challans" ? <ReturnChallans fy={fy} q={q} form={form} tallyPays={tallyPaysOf(fy, q)} />
        : S.tdsTab === "deductor" ? <DeductorDetails />
        : S.tdsTab === "deductees" ? <><DeducteesPan form={form} fy={fy} q={q} issueOf={issueOf} title={title} />
          {/* 27Q's non-resident details and 27EQ's collection codes, filled where the deductees are */}
          {(form === "27Q" || form === "27EQ") && <div style={{ marginTop: 14 }}><ChecksOther fy={fy} q={q} form={form} other={other} rows={rows} /></div>}</>
        : S.tdsTab === "deductions" ? todo ? <><DedByChallan form={form} fy={fy} q={q} rows={rows} m={dm} issueOf={issueOf} probs={probs} locked={TDSReg.locked(fy, q, form)} tools={winTools}
            todo={<DedTodo form={form} fy={fy} q={q} rows={rows.filter((r) => pass(r, fD))} m={dm} issueOf={issueOf} probs={probs} locked={TDSReg.locked(fy, q, form)} />} /><ImportPreview rows={rows} /></>
          : <>{tools}<Deductions fy={fy} q={q} rows={rows} issueOf={issueOf} pass={pass} probs={probs} fo={fo} unitW={unit} edN={edN} form={form} m={dm} /></>
        : S.tdsTab === "after" ? <AfterFiling fy={fy} q={q} form={form} />
        : <ValidatePanel fy={fy} q={q} form={form} val={val} reviews={reviews} year={yearChecks(fy)} file={fileBox} chIds={Object.keys(TDSReg.uses()).filter((id) => TDSReg.uses()[id][key])} />}
    </ReturnShell>
    <MatchDialogs form={form} fy={fy} q={q} />
    <HowItWorks />
    {form !== "27EQ" && <AddDeduction form={form} fy={fy} q={q} />}
  </>;
}

// the deductions of a 2026-27 return whose payment code is not confirmed (rent, a section or collection not in FinCom's
// confirmed list): the file leaves the code empty; never picked silently (docs/tds-codes.md)
function PayCodeRows({ fy, q, form }) {
  const list = TDS26Q.payCodeRows(fy, q, form);
  if (!list.length) return null;
  return <section className="dash-card" style={{ marginBottom: 12 }} data-paycode-rows=""><h3>Payment code to confirm</h3>
    <p className="note">The forms of the Income-tax Act, 2025 carry a 4-digit payment code for each deduction. For these, the code is not confirmed (the sources disagree, or it is not yet in FinCom's list), so the file leaves it empty: confirm it before filing.</p>
    <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th className="dt">Date</th><th>Deductee</th><th>Section</th><th>Why</th><th className="n">{form === "27EQ" ? "TCS" : "TDS"}</th></tr></thead>
      <tbody>{list.slice(0, 300).map(({ row: r, why }) => <tr key={r.id}><td>{day(r.date)}</td><td>{r.party}</td><td>{form === "27EQ" ? r.code || "" : <Sec s={r.section} fy={fy} />}</td><td>{why.replace(/^payment code to confirm: /, "")}</td><td className="n">{money(r.tds)}</td></tr>)}</tbody></table></div>
  </section>;
}

// 194-IA, 194-IB and 194M: not in 26Q; each filed in its challan-cum-statement on the portal (the TDS review, M3)
function PortalRows({ fy, q }) {
  const list = TDS.portalRows().filter((r) => r.fy === fy && r.q === q);
  if (!list.length) return null;
  return <section className="dash-card" style={{ marginBottom: 12 }} data-portal-rows=""><h3>File on the income-tax portal, not in this return</h3>
    <p className="note">Tax deducted on buying property (194-IA, Form 26QB), on rent paid by an individual or HUF (194-IB, Form 26QC) and on payments by an individual or HUF under 194M (Form 26QD) is paid and reported with its own challan-cum-statement on the portal, within 30 days of the month's end.</p>
    <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th className="dt">Date</th><th>Deductee</th><th>PAN</th><th>Section</th><th>File in</th><th className="n">Paid</th><th className="n">TDS</th></tr></thead>
      <tbody>{list.map((r) => <tr key={r.id}><td>{day(r.date)}</td><td>{r.party}</td><td><Pan pan={r.pan} /></td><td><Sec s={r.section} fy={fy} /></td><td>{r.portalForm}</td><td className="n">{money(r.paid)}</td><td className="n">{money(r.tds)}</td></tr>)}</tbody></table></div>
  </section>;
}

// the year's checks, opened from a return's To fix (they were TDS › Checks): limits, the tie-out with Tally, section 197
// certificates with the year's rate questions
export function yearChecks(fy) {
  return [["limits", "TDS limits", TDSWatch.tracker(fy).length ? <Limits fy={fy} /> : <p className="note">No party has come near a TDS limit in {fy}.</p>],
    ["tieout", "Tie-out with Tally", TDSTie.quarters(fy).some((x) => x.deducted || x.challans || x.moved || x.paidBooks) ? <TieOut fy={fy} /> : <p className="note">No TDS deducted or paid in {fy} to tie out with Tally.</p>],
    ["rates", "Section 197 certificates", <CertsPage />]];
}

/* ---------------------------------------------------------------- 24Q */

function Employees({ fy, q, a1 }) {
  const f = (S.tdsFl || {}).employees || {}, qq = String(f.q || "").toLowerCase();
  // next-challan-match: each month's row of the sheet with its challan (the rows TDS.salaryRows matches; a split row its parts)
  const ded = {}; TDS24Q.dedRows().forEach((r) => { const k = r.splitOf || r.id; (ded[k] = ded[k] || []).push(r); });
  const shown = tdsSorted("employees", a1.filter((e) => (!qq || (e.name + " " + e.pan).toLowerCase().includes(qq)) &&
    (f.pan !== "no" || !Certs.validPan(e.pan)) && (f.pan !== "yes" || Certs.validPan(e.pan)) && (f.tds !== "yes" || e.tds > 0) && (f.tds !== "no" || !e.tds)), (e, k) => e[k]);
  return <>
    <FilterBar tab="employees" placeholder="Find an employee or PAN" table="q24Table" title={CO().name + " 24Q " + q + " " + fy} excel="q24Excel" count={shown.length + " of " + a1.length + " employees"}
      selects={[{ key: "pan", label: "PAN", options: [["", "PAN: any"], ["no", "No valid PAN"], ["yes", "Has a PAN"]] }, { key: "tds", label: "TDS", options: [["", "TDS: any"], ["yes", "TDS deducted"], ["no", "No TDS"]] }]} />
    {/* the one list table (spec K6): employee (party), paid and TDS (amounts), then the rest */}
    <ListTable name="q24Employees" id="q24Table" rows={shown} rowKey={(e) => e.pan || e.name} unit={["employee", "employees"]} of={a1.length} sortVia={via("employees")}
      empty="No employee matches these filters. Use Clear filters above to see all."
      after={(e) => S.q24Open === (e.pan || e.name) && <table className="bk-table" style={{ margin: 0 }} data-statement="">
          <thead><tr><th className="dt">Month</th><th className="n">Gross</th><th className="n">Exempt</th><th className="n">Chapter VI-A</th><th className="n">TDS</th><th>Challan</th></tr></thead>
          <tbody>{e.rows.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td className="n">{money(r.gross)}</td><td className="n">{money(r.exempt)}</td><td className="n">{money(r.chapter6)}</td><td className="n">{money(r.tds)}</td>
            <td>{(ded[r.id] || []).filter((x) => x.tds > 0.005).map((x) => <ChallanCell key={x.id} r={x} />)}</td></tr>)}</tbody>
        </table>}
      cols={[
        { k: "name", role: "party", label: "Employee", v: (e) => e.name, cell: (e) => <Toggle which="q24Open" k={e.pan || e.name}>{e.name}</Toggle> },
        { k: "paid", role: "amount", label: "Paid", cls: "n", v: (e) => e.paid, fmt: money, cell: (e) => money(e.paid) },
        { k: "tds", role: "amount", label: "TDS", cls: "n", v: (e) => e.tds, fmt: money, cell: (e) => <b>{money(e.tds)}</b> },
        { k: "pan", label: "PAN", v: (e) => e.pan || "", cell: (e) => <Pan pan={e.pan} /> },
        { k: "months", label: "Months", cls: "n", v: (e) => e.months, sum: true, fmt: String, cell: (e) => e.months },
      ]} />
  </>;
}

export function Return24({ b }) {
  const fy = S.tdsFy, q = S.tdsQ, has = (b.salary || []).length > 0;
  // bridge 2.4.4: Tally's payroll, when there is no salary sheet (tds/Payroll.jsx)
  if (!has && Payroll.has(fy)) return <Return24Tally fy={fy} q={q} />;
  S.tdsTab = tabNow(S.tdsTab, "24Q");
  const fname = TDS.formName("24Q", fy), key = TDSReg.key("24Q", fy, q), rc = retChallans("24Q", fy, q), usedN = rc.n;
  const inBooks = TDS.salaryRows().filter((r) => r.fy === fy && r.q === q), booksTds = r2(inBooks.reduce((a, r) => a + num(r.tds), 0));
  const val = checkReturn(fy, q, "24Q"), filed = TDSFiled.get(fy, q, "24Q"), filedOn = filed ? filed.on : "";
  const a1 = has ? TDS24Q.annexI(fy, q) : [], sheetTds = r2(a1.reduce((s, e) => s + e.tds, 0));
  const status = statusOf({ fy, q, form: "24Q", has: has ? a1.length > 0 || inBooks.length > 0 : inBooks.length > 0, errors: val.errors.length, problems: val.n });
  const int1A = TDS.interest(fy, q, "24Q"), fee = TDS.lateFee(fy, q, filedOn, "24Q");
  const sal = val.warnings.find((x) => x.k === "salary");
  const steps = [
    { id: "deductor", label: "Deductor", done: !val.warnings.some((x) => x.k === "deductor") },
    { id: "deductees", label: stepName("deductees", "24Q"), count: has ? a1.length : null, sub: (val.warnings.find((x) => x.k === "nopan") || {}).n ? { text: val.warnings.find((x) => x.k === "nopan").n + " PAN" } : null },
    { id: "people", label: "Employees & declarations", sub: !has ? { text: "salary sheet needed", bad: true } : sal ? { text: sal.n + " to check" } : null },
    { id: "challans", label: "Challans", count: usedN, sub: (val.errors.find((x) => x.k === "unmatched") || {}).n ? { text: val.errors.find((x) => x.k === "unmatched").n + " not matched", bad: true } : null },
    { id: "deductions", label: "Deductions", count: inBooks.length || null },
    { id: "file", label: "Validate & file" },
    { id: "after", label: "After filing", off: !TDSReg.filed(fy, q, "24Q"), why: "Once the return is marked filed (Validate & file › Mark filed)" },
  ];
  const strip = has ? [{ label: "Employees", value: String(a1.length), sub: money(a1.reduce((s, e) => s + e.paid, 0)) + " paid" }, { label: "TDS", value: money(sheetTds), sub: "from the salary sheet" },
    { label: "On challans", value: money(rc.here), sub: usedN + " challan" + (usedN === 1 ? "" : "s") }]
    : [{ label: "Salary TDS in the books", value: money(booksTds), sub: inBooks.length + " deduction" + (inBooks.length === 1 ? "" : "s") + " under 192" }, { label: "On challans", value: money(rc.here), sub: usedN + " challan" + (usedN === 1 ? "" : "s") }];
  const confirmable = (() => { try { return TDSMatch.suggest("24Q", fy, q).filter((s) => s.rule !== "split").length; } catch (e) { return 0; } })();
  const primary = !has && S.tdsTab !== "challans" && S.tdsTab !== "file" ? ["Bring in the salary sheet", () => doAct("salaryPick")] : S.tdsTab === "challans" && confirmable && !TDSReg.locked(fy, q, "24Q") ? null : undefined;
  const more = retMore({ fy, q, form: "24Q", extra: [["Download the 24Q working (Excel)", () => doAct("q24Excel")], ["Bring in a new salary sheet", () => doAct("salaryPick")], has && ["Remove the salary sheet", () => doAct("salaryClear")]] });
  const un = unplacedOf(TDS.formRows("24Q").filter((r) => r.fy === fy && r.q === q));
  const reviews = {
    unmatched: <FixRows title={un.length + " salary payments without a challan"} rows={un} unit="salary payments" />,
    nopan: <FixRows title="Without a valid PAN" rows={TDS.formRows("24Q").filter((r) => r.fy === fy && r.q === q && !Certs.validPan(r.pan))} unit="salary payments" />,
    salary: <SalaryChecks list={sal ? sal.list : []} />,
    interest: <InterestFee fy={fy} q={q} form="24Q" list={int1A} fee={fee} filed={filedOn} />,
    chtype: <UnknownChallans fy={fy} q={q} form="24Q" />,
    traces: <TracesDefaults jr={TRF.jrFor(fy, q, "24Q")} />,
  };
  const fileBox = <div className="vf-file" data-file="24Q">
    <p className="vf-amber" data-fvu-check="">The working for the return comes from the salary sheet; bring in a new sheet to replace it (⋯). Run the text file through Protean’s FVU before filing.</p>
    <div className="vf-frow" data-prefile-slot="">
      <PrnBox fy={fy} q={q} form="24Q" />
      {TDS.isNew(fy) && q === "Q4" ? <p className="note" data-q4-wait="">Protean has not yet released the Q4 layout for Form 138: the fourth quarter's file is made once it has.</p>
        : <button className="btn small primary" data-sheet-fvu="" disabled={val.errors.length > 0} title={val.errors.length ? "Fix the errors above first" : undefined} onClick={() => { payFvuDownload(fy, q); try { if (!TDS24Q_FILE.build(fy, q, TDS26Q.firmDetails()).error) FvuMade.mark(fy, q, "24Q"); } catch (e) { /* */ } render(); }}>Make FVU file</button>}
      {has && <button className="btn small" onClick={() => doAct("q24Excel")}>Download working</button>}
    </div>
    <MarkFiled fy={fy} q={q} form="24Q" />
  </div>;
  const v24 = S.q24View === "emp" ? "emp" : "";
  return <>
    <ReturnShell fy={fy} q={q} form="24Q" status={status} draft={false} val={val} primary={primary} more={more} strip={strip} steps={steps}>
      {S.tdsTab === "deductor" ? <DeductorDetails />
        : S.tdsTab === "deductees" ? <DeducteesPan form="24Q" fy={fy} q={q} title={CO().name + " " + fname + " " + q + " " + fy} />
        : S.tdsTab === "challans" ? <ReturnChallans fy={fy} q={q} form="24Q" />
        : S.tdsTab === "deductions" ? (v24 === "emp" && has ? <><div className="rt-tool" data-step-tool=""><Pills cur={v24} on={(k) => { S.q24View = k; render(); }} items={[["", "By payment"], ["emp", "By employee (Annexure I)"]]} /></div><Employees fy={fy} q={q} a1={a1} /></>
          : <PlainDeductions form="24Q" fy={fy} q={q} extra={has ? <Pills cur={v24} on={(k) => { S.q24View = k; render(); }} items={[["", "By payment"], ["emp", "By employee (Annexure I)"]]} /> : null} />)
        : S.tdsTab === "after" ? <AfterFiling fy={fy} q={q} form="24Q" />
        : S.tdsTab === "people" ? (has ? <><Salary />{q === "Q4" && <section className="dash-card" style={{ marginTop: 12 }} data-annex2=""><h3>Annexure II, the year</h3><div className="bk-tablewrap"><table className="bk-table" data-statement="">
            <thead><tr><th>Employee</th><th>PAN</th><th>Regime</th><th className="n">Gross</th><th className="n">Exempt</th><th className="n">Standard</th><th className="n">Chapter VI-A</th><th className="n">Taxable</th><th className="n">TDS</th></tr></thead>
            <tbody>{TDS24Q.annexII(fy).map((e) => <tr key={e.pan || e.name}><td>{e.name}</td><td>{e.pan || "—"}</td><td>{e.regime === "N" ? "New" : e.regime === "O" ? "Old" : "—"}</td>
              <td className="n">{money(e.gross)}</td><td className="n">{money(e.exempt)}</td><td className="n">{money(e.standard)}</td><td className="n">{money(e.chapter6)}</td><td className="n">{money(e.taxable)}</td><td className="n">{money(e.tds)}</td></tr>)}</tbody>
          </table></div></section>}</>
          : <section className="dash-card" style={{ maxWidth: 760 }} data-needs-sheet=""><h3>24Q needs the salary sheet</h3>
            <p className="note">Tally credits each employee their net pay and the TDS as one figure, so the books cannot say how much was deducted from whom. Bring in the payroll sheet you already prepare — Excel or CSV — and the columns are found by their names: employee, PAN, month, gross salary, exempt allowances, standard deduction, professional tax, Chapter VI-A, taxable income and TDS.</p></section>)
        : <ValidatePanel fy={fy} q={q} form="24Q" val={val} reviews={reviews} year={yearChecks(fy)} file={fileBox} chIds={Object.keys(TDSReg.uses()).filter((id) => TDSReg.uses()[id][key])} />}
    </ReturnShell>
    <MatchDialogs form="24Q" fy={fy} q={q} />
    <HowItWorks />
  </>;
}

/* ---------------------------------------------------------------- certificates */

function NewCert() {
  const blank = { party: "", pan: "", section: "", certNo: "", rate: "", limit: "", from: "", to: "" }, [c, setC] = useState(blank);
  const box = (k, props) => <input value={c[k]} onChange={(ev) => setC({ ...c, [k]: ev.target.value })} {...props} />;
  return <tr className="lt-new">
    <td>{box("from", { type: "date", "aria-label": "New certificate: from" })}</td>
    <td>{box("certNo", { type: "text", placeholder: "certificate no.", "aria-label": "New certificate: number", style: { width: 140 } })}</td>
    <td>{box("party", { type: "text", placeholder: "deductee as named in Tally", "aria-label": "New certificate: deductee", style: { width: 190 } })}</td>
    <td>{box("pan", { type: "text", placeholder: "PAN", "aria-label": "New certificate: PAN", style: { width: 110 } })}</td>
    <td>{box("section", { type: "text", placeholder: "194C", "aria-label": "New certificate: section", style: { width: 80 } })}</td>
    <td className="n">{box("rate", { type: "text", inputMode: "decimal", placeholder: "0.5", "aria-label": "New certificate: rate", style: { width: 70, textAlign: "right" } })}</td>
    <td className="n">{box("limit", { type: "text", inputMode: "decimal", placeholder: "amount", "aria-label": "New certificate: amount limit", style: { width: 110, textAlign: "right" } })}</td>
    <td>{box("to", { type: "date", "aria-label": "New certificate: to" })}</td>
    <td colSpan={3}></td>
    <td className="ac"><button className="btn small" onClick={() => { if (certAdd(c)) setC(blank); }}>Add</button></td>
  </tr>;
}

export function CertsPage() {
  const list = Certs.all(), iss = Certs.issues(S.tdsFy || "", "");
  return <>
    <TallyDiffs kind="certificate" />
    <section className="dash-card" style={{ marginBottom: 12 }} data-certs=""><h3>Certificates under section 197</h3>
      <p className="note">A deductee with a certificate for a lower rate, or nil. Where a payment is covered by one, that rate is what the system expects instead of the usual rate, up to the certificate's amount and until its last day; then the usual rate applies again. Matched by PAN where both have one.</p>
      {list.length ? <ListTable name="tdsCerts" rows={list} rowKey={(c) => c.id} unit={["certificate", "certificates"]} tail={<NewCert />}
        cols={[
          { k: "from", role: "date", label: "From", v: (c) => c.from || "", cell: (c) => (c.from ? fmtDate(c.from) : "") },
          { k: "no", role: "number", label: "Certificate no.", v: (c) => c.certNo || "", cell: (c) => <>{c.certNo || ""} <FromTally on={c.src === "tally"} /></> },
          { k: "party", role: "party", label: "Deductee", v: (c) => c.party, cell: (c) => c.party },
          { k: "pan", label: "PAN", v: (c) => c.pan || "", cell: (c) => c.pan || "" },
          { k: "sec", label: "Section", v: (c) => c.section || "", cell: (c) => c.section || "any" },
          { k: "rate", label: "Rate", cls: "n", v: (c) => num(c.rate), cell: (c) => num(c.rate) + "%" },
          { k: "limit", label: "Amount limit", cls: "n", v: (c) => num(c.limit), cell: (c) => (num(c.limit) ? money(c.limit) : "none given") },
          { k: "to", label: "To", v: (c) => c.to || "", cell: (c) => (c.to ? fmtDate(c.to) : "") },
          // T-A3: how much of the certificate the books have used, what is left, and a warning at 80% and near its end
          { k: "used", label: "Used", cls: "n", v: (c) => TDSLdc.state(c).used, cell: (c) => money(TDSLdc.state(c).used) },
          { k: "left", label: "Left", cls: "n", v: (c) => num(TDSLdc.state(c).left), cell: (c) => (TDSLdc.state(c).left == null ? "—" : money(TDSLdc.state(c).left)) },
          { k: "st", label: "State", v: (c) => TDSLdc.state(c).st, cell: (c) => { const x = TDSLdc.state(c); return <span className={"tag " + (x.st === "ok" ? "ok" : x.st === "warn" ? "warn" : "bad")}>{x.words}</span>; } },
          { k: "ac", role: "act", cls: "ac", cell: (c) => <button className="icon danger" aria-label="Remove this certificate" onClick={() => certDelete(c.id)}>✕</button> },
        ]} /> : <><p className="note lt-empty" data-list-empty="" style={{ border: 0 }}>No certificate yet. Type one in below and use Add.</p>
        <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th>From</th><th>Certificate no.</th><th>Deductee</th><th>PAN</th><th>Section</th><th className="n">Rate</th><th className="n">Amount limit</th><th>To</th><th className="n">Used</th><th className="n">Left</th><th>State</th><th className="ac"></th></tr></thead><tbody><NewCert /></tbody></table></div></>}
    </section>
    <section className="dash-card"><h3>Rate questions</h3>
      <p className="note">Where the books deducted at a rate different from the one that applies: a certificate, 20% under section 206AA when there is no valid PAN, or the usual rate for the section.</p>
      <RateQuestions list={iss.slice(0, 200)} />{!iss.length && <Empty>Every deduction matches the rate that applies.</Empty>}
      {iss.length > 200 && <p className="note">The first 200 of {iss.length} are shown.</p>}
    </section>
  </>;
}
