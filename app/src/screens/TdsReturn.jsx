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
import { PreFileButton } from "../parts/PreFile.jsx";
import SrcTag, { srcWords } from "../parts/SrcTag.jsx";
import { useRef, useState } from "react";
import ListTable from "../parts/ListTable.jsx";
import { MarkFiled, InterestFee } from "./tds/Filed.jsx";
import { Correction } from "./tds/Smart.jsx";
import { TracesDefaults, F16Link } from "./tds/Files.jsx";
import More from "../parts/More.jsx";
import Salary, { Return24Tally } from "./tds/Payroll.jsx";
import Filters, { Search } from "../parts/Filters.jsx";
import { barSelects } from "../parts/FilterBar.jsx";
import { Info } from "../parts/Answer.jsx";
// tds-layout (14-Oct-2026): a return's six tabs in the owner's layout, its challans from the one register, To fix, After filing
import { returnTabs, tabNow, checksToFix, LockLine, DedSwitch, ReturnChallans, ToFix, FixRows, PreFileSlot, AfterFiling, unknownItem, overItem, UnknownChallans } from "./tds/ReturnParts.jsx";
import { Limits, TieOut } from "./tds/Smart.jsx";
// TDSF25 (src/js/83-tds-forms-2025.js: the 2026-27 forms' text file, TDS26Q.build) comes with this screen's file, not in legacy.js (build.py lazy_files)
import "../../../src/js/83-tds-forms-2025.js";

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

// tds-layout: the owner's tabs (ReturnParts.jsx: one declaration per form), with the counts the return hands over, and the
// filed lock above them, said on every tab
// t70 (16-Oct-2026; the owner: "TDS and GST pages take too much space"): By deduction · By deductee (side) on the tabs' row
// (the filed lock is said in the card, under the title)
function Tabs({ counts, side }) {
  return <>
    <div className="tg-tabrow">
      <nav className="sbar rp-tabs" aria-label="Return" data-return-tabs="">
        {returnTabs(S.tdsForm || "26Q", counts).map(([id, l, n]) => <button key={id} data-ret-tab={id} aria-selected={S.tdsTab === id} onClick={() => tdsTabGo(id)}>{l}{n != null && <> <span className="sbar-n">{n}</span></>}</button>)}
      </nav>
      {side}
    </div></>;
}

// the shared list table (spec K6, round 2) with the return's own order (S.tdsSort, tdsSortBy): same headers and arrows
const via = (tab) => { const s = (S.tdsSort || {})[tab] || {}; return { state: s.k ? { k: s.k, dir: s.d < 0 ? "desc" : "asc" } : null, by: (k) => tdsSortBy(tab, k) }; };
const Tile = ({ label, value, sub, warn }) => <div className={"dtile" + (warn ? " warn" : "")}><span>{label}</span><b>{value}</b><small>{sub}</small></div>;
const Toggle = ({ which, k, children }) => <button className="linkbtn" onClick={() => tdsToggle(which, k)}>{S[which] === k ? "▾ " : "▸ "}{children}</button>;

// a return's summary card (the TDS & GST makeover, round 46): the way back to the year, the return's name and status, its
// key figures, and one main button; rare actions and the long words under More. The status words are those of the year's
// grid: filed (with its date), a correction needed, errors to fix, ready; a form of the 2025 Act not yet validated is a draft
const Q_MON = { Q1: "Apr–Jun", Q2: "Jul–Sep", Q3: "Oct–Dec", Q4: "Jan–Mar" };
// what the TDS page puts in the card's first row: the year, quarter and form, and the ledgers to confirm (TdsPage.jsx)
export const CardCtx = { node: null, help: null, ledger: null };
function ReturnCard({ fy, q, form, filed, errN, driftN, draft, figs, primary, more = [], words, edN }) {
  const st = driftN ? ["bad", "Correction needed"] : filed ? ["ok", "Filed " + day(TDS.ymd(filed.on))] : errN ? ["bad", errN + " to fix"] : ["info", "Ready to file"];
  // t70: one card, top to bottom: the way back with the year, quarter and form and the ledgers to confirm; the return's name,
  // what it is and when due, its status and the filed lock, the actions at the right; the key figures in one strip
  // round 4 (the owner: "one row for context and title"): the period's boxes ARE the title (Form · Quarter · Year, title
  // type, no boxes), the actions at the right of the same line; under it, small: what it is and when due, the status, the
  // filed lock, the ledgers to confirm. The full name stays the card's heading for a screen reader
  return <section className="ret-card ret-slim ret-pro ret-one" data-return-card={form + "|" + q}>
    <div className="ret-head">
      <button className="linkbtn ret-back" onClick={() => tdsGo(fy)} aria-label={"Back to " + TDS.yearWord(fy) + " " + fy} title={"Back to " + TDS.yearWord(fy) + " " + fy}>←</button>
      <h2 className="sr-only" data-return-title="">{TDS.formShort(form, fy)} · {q} ({Q_MON[q]})</h2>
      {CardCtx.node || <span className="ret-title-text" aria-hidden="true">{TDS.formShort(form, fy)} · {q} ({Q_MON[q]})</span>}
      <div className="ret-acts">
        <PreFileButton kind="tds" form={form} fy={fy} q={q} />
        <More items={more} label="More">{words}</More>
        {primary && <button className="btn small primary" data-card-primary="" onClick={primary[1]}>{primary[0]}</button>}
        {CardCtx.help}
      </div>
    </div>
    <div className="ret-sub ret-line2">
      {/* (one line at 1366: the words short, the full ones on a hover) */}
      <span title={TDS.FORM_ABOUT[form] + " · due " + TDS.dueWords(fy, q, form)}>{String(TDS.FORM_ABOUT[form] || "").split(",")[0]} · due {TDS.dueWords(fy, q, form)}</span>
      {draft && <span className="tag warn" title="Draft, not yet validated: not yet matched to Protean's file format (see Return file)" data-draft-tag="">Draft<span className="sr-only">, not yet validated</span></span>}
      {errN && !filed ? <button className="tag bad" style={{ cursor: "pointer", border: 0 }} data-status-tag="" onClick={() => tdsTabGo("checks")}>{st[1]}</button>
        : <span className={"tag " + st[0]} data-status-tag="">{st[1]}</span>}
      {edN > 0 && <span className="tag info" data-edited-n={edN} title="Corrected here (the Excel brought back); the books from Tally are not changed">{edN} row{edN === 1 ? "" : "s"} edited in FinCom</span>}
      <LockLine fy={fy} q={q} form={form} short />
      {CardCtx.ledger}
    </div>
    <div className="ret-figs">{figs.map((f) => <div key={f.label} className={"ret-fig" + (f.warn ? " warn" : "")}><span>{f.label}</span><b>{f.value}</b>{f.sub && <>{" "}<small>{f.sub}</small></>}</div>)}</div>
  </section>;
}

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

// a return's Challans tab, under its challans from the register: what Tally and FinCom differ on, and the quarter's TDS payments
// in Tally not yet challans (give each its BSR code and serial, or the CIN)
function TallyPays({ fy, q }) {
  const allCh = TDS.challans(), pays = TDS.paymentsFromBooks().filter((p) => TDS.fyOf(p.date) === fy && TDS.qOf(p.date) === q).filter((p) => TDSTally.notChallan(p, allCh));
  return <>
    <TallyDiffs kind="challan" />
    {pays.length > 0 && <section className="dash-card" style={{ marginBottom: 12 }}><h3>Paid to the government, from the books <Info label="About these payments">TDS payment vouchers in Tally for this quarter, proposed as challans. Give each its CIN (or BSR code and serial) to confirm it. Uploaded challans of the same date and amount are matched to them on their own.</Info></h3>
      <div className="bk-tablewrap"><table className="bk-table" data-statement="">
        <thead><tr><th>Date</th><th className="n">Tax</th><th className="n">Interest and fee</th><th>Sections</th><th>Voucher</th><th>BSR code or CIN</th><th>Serial</th><th className="ac"></th></tr></thead>
        <tbody>{pays.map((p) => <PayRow key={p.vid} p={p} />)}</tbody>
      </table></div></section>}
  </>;
}

/* ---------------------------------------------------------------- challan tagging (tds-challans, 10-Oct-2026) */
// The owner's choice: the challans read from the portal's Payment History or receipt PDFs (Upload challans), and the
// tagging proposed from Tally's bill-wise details or by section and month, each confirmed by a person (TDSCH, src/js/65).
// Nothing here works out a figure: the proposals, the amounts left and the refusals are TDSCH's.
const gapTag = (p) => p.exact ? <span className="tag ok">Exact</span>
  : p.gap < 0 ? <span className="tag bad">{money(-p.gap)} short</span> : <span className="tag warn">{money(p.gap)} more on the challan</span>;

function Proposal({ p, fy, open, setOpen, main }) {
  const [off, setOff] = useState({});
  const ticked = p.rows.filter((r) => !off[r.id]), sum = r2(ticked.reduce((a, r) => a + r.tds, 0)), over = sum - p.avail > 0.005;
  const months = p.months.map((m) => monthName(m)).join(", "), n = p.rows.length, lab = TDSCH.label(p.challan);
  const fitN = (() => { let room = Math.round(p.avail * 100), k = 0; p.rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.tds - b.tds).forEach((r) => { const v = Math.round(r.tds * 100); if (v <= room) { room -= v; k++; } }); return k; })();
  return <li className="tch-prop" data-proposal={p.id} data-kind={p.kind}>
    <div className="tch-line">
      <span className={"tag " + (p.kind === "tally" ? "info" : "")}>{p.kind === "tally" ? "From Tally bill-wise" : "Same section and month"}</span>
      <span><b>{p.section.split(", ").map((x) => secText(x, fy)).join(", ")}</b> · {months} · {n} deduction{n === 1 ? "" : "s"} · <b>{money(p.need)}</b></span>
      <span className="note">→ challan {lab} · {money(p.avail)} {p.avail === num(p.challan.tax) ? "" : "left "}{(p.interest || p.fee) ? "· interest " + money(p.interest) + (p.fee ? ", fee " + money(p.fee) : "") + " apart" : ""}</span>
      {gapTag(p)}
      <span className="tch-act">
        {p.exact ? <button className={"btn small" + (main ? " primary" : "")} onClick={() => tdsConfirm(p.id)}>Confirm {n} deduction{n === 1 ? "" : "s"} to challan {lab}</button>
          : <button className="btn small" aria-expanded={open} onClick={() => setOpen(open ? "" : p.id)}>{open ? "Close" : "Review"}</button>}
      </span>
    </div>
    {open && !p.exact && <div className="tch-review">
      <div className="bk-tablewrap"><table className="bk-table" data-statement="">
        <thead><tr><th className="ck"></th><th className="dt">Date</th><th>Deductee</th><th>Voucher</th><th className="n">TDS</th></tr></thead>
        <tbody>{p.rows.map((r) => <tr key={r.id}><td className="ck"><input type="checkbox" aria-label={"Include " + r.party} checked={!off[r.id]} onChange={(ev) => setOff({ ...off, [r.id]: !ev.target.checked })} /></td>
          <td>{day(r.date)}</td><td>{r.party}</td><td>{r.voucher}</td><td className="n">{money(r.tds)}</td></tr>)}</tbody>
      </table></div>
      <div className="revfilter" style={{ flexWrap: "wrap", rowGap: 6 }}>
        <span>{ticked.length} ticked · <b>{money(sum)}</b> against {money(p.avail)} on the challan</span>
        <span className={over ? "bad" : "note"}>{over ? "Over by " + money(sum - p.avail) : money(p.avail - sum) + " left on the challan after"}</span>
        <button className="btn small primary" disabled={!ticked.length || over} onClick={() => tdsConfirm(p.id, { ids: ticked.map((r) => r.id) })}>Confirm {ticked.length} deduction{ticked.length === 1 ? "" : "s"} to challan {lab}</button>
        {p.gap < 0 && fitN > 0 && <button className="btn small" onClick={() => tdsConfirm(p.id, { fit: true })}>Confirm the {fitN} that fit</button>}
      </div>
    </div>}
  </li>;
}

function Suggest({ fy, q, form }) {
  const props = TDSCH.proposals(fy, q, form), exact = props.filter((p) => p.exact).length, [open, setOpen] = useState("");
  return <section className="dash-card tch-card" style={{ marginBottom: 12 }} data-challan-suggest="">
    <div className="rp-title"><h3>Suggested tagging</h3>
      <Info label="How tagging is suggested">From Tally’s bill-wise details where the TDS payment has them, else by section and month. Nothing is tagged until you confirm.</Info></div>
    {props.length ? <>
      {exact > 1 && <div className="row" style={{ marginBottom: 8 }}><button className="btn small primary" onClick={() => tdsConfirmAll()}>Confirm all exact ({exact})</button></div>}
      <ul className="tch-list">{props.map((p) => <Proposal key={p.id} p={p} fy={fy} open={open === p.id} setOpen={setOpen} main={exact === 1 && p.exact} />)}</ul></>
      : <p className="note">No suggestion now: the deductions are against challans, or no challan fits them. Add or upload challans in the challan register{form === "24Q" ? "" : ", or tick deductions under Deductions and tag them"}.</p>}
  </section>;
}

// the ticked deductions (Entries): their total against the challan chosen, tagged or untagged together
function TagBar({ rows, chOpts }) {
  const sel = rows.filter((r) => (S.tdsSel || {})[r.id]), [ch, setCh] = useState("");
  if (!sel.length) return null;
  const total = r2(sel.reduce((a, r) => a + r.tds, 0)), c = chOpts.find((x) => x.id === ch);
  const add = r2(sel.filter((r) => r.challan !== ch).reduce((a, r) => a + r.tds, 0)), left = c ? TDSCH.left(c) : 0, after = r2(left - add), over = !!c && after < -0.005;
  const tagged = sel.filter((r) => r.challan).map((r) => r.id);
  return <div className="revfilter tch-bar" style={{ flexWrap: "wrap", rowGap: 6 }} data-tag-bar="">
    <span><b>{sel.length} selected</b> · TDS <b>{money(total)}</b></span>
    <select aria-label="Tag to challan…" value={ch} onChange={(ev) => setCh(ev.target.value)} style={{ width: "auto", maxWidth: "100%" }}>
      <option value="">Tag to challan…</option>
      {chOpts.map((x) => <option key={x.id} value={x.id}>{TDSCH.label(x) + (x.section ? " · " + x.section : "") + (x.minorHead === "400" ? " · minor head 400" : "") + " · " + money(TDSCH.left(x)) + " left"}</option>)}</select>
    {c && <span className={over ? "bad" : "note"}>{over ? "Over by " + money(-after) + ": a challan cannot carry more than its amount" : money(after) + " left on the challan after"}</span>}
    <button className="btn small primary" disabled={!c || over} onClick={() => tdsTagMany(sel.map((r) => r.id), ch)}>Tag to challan</button>
    {tagged.length > 0 && <button className="btn small" onClick={() => tdsUntagMany(tagged)}>Untag{tagged.length < sel.length ? " " + tagged.length : ""}</button>}
    <button className="linkbtn" onClick={() => { S.tdsSel = {}; render(); }}>Clear selection</button>
  </div>;
}
const selSet = (ids, on) => { const s = { ...(S.tdsSel || {}) }; ids.forEach((id) => { if (on) s[id] = true; else delete s[id]; }); S.tdsSel = s; render(); };

// the challan a deduction is paid by (or not yet)
function ChallanPick({ r, chOpts }) {
  return <select value={r.challan || ""} aria-label={"Challan for " + r.party} onChange={(ev) => tdsAlloc(r.id, ev.target.value)}>
    <option value="">— not yet —</option>{chOpts.map((x) => <option key={x.id} value={x.id}>{x.bsr + "/" + x.serial + " · " + day(x.date)}</option>)}
  </select>;
}
// t70: the reason under the rate, in words (it was only on a hover, cut with "…")
// (in short, two lines at most: "should be 20% (no PAN, 206AA)"; the full reason on a hover and in To fix › Rate questions)
const shortWhy = (w) => String(w || "").replace(/no valid PAN, section /, "no PAN, ").replace(/, section 206AA/, ", 206AA").replace(/\s*\(higher rate\)/, "").replace(/\s*\(PAN's 4th letter \w\)/, "")
  .replace(/:\s*[\d.]+%$/, "").replace(/^(certificate [^ (:]+).*$/, "$1").replace(/^the section's higher rate.*$/, "the section's higher rate");
const Rate = ({ r, issue, why }) => <>{r.rate != null ? r.rate + "%" : ""}{issue && <div className="tg-sub tg-why bad" title={issue.why || undefined}>should be {issue.expected}%{why && issue.why ? " (" + shortWhy(issue.why) + ")" : ""}</div>}</>;

function Deductees({ rows, deductees, issueOf, pass, common, chOpts, title, fo }) {
  const f = (S.tdsFl || {}).deductees || {}, by = {};
  rows.filter((r) => pass(r, f)).forEach((r) => {
    const k = Certs.validPan(r.pan) ? r.pan : "name:" + normName(r.party);
    const p = by[k] = by[k] || { key: k, party: r.party, pan: r.pan, secs: new Set(), n: 0, paid: 0, tds: 0, unallocated: 0, issues: 0, rows: [] };
    p.secs.add(r.section); p.n++; p.paid = r2(p.paid + r.paid); p.tds = r2(p.tds + r.tds);
    if (!r.challan) p.unallocated = r2(p.unallocated + r.tds);
    if (issueOf[r.id]) p.issues++;
    p.rows.push(r);
  });
  const list = tdsSorted("deductees", Object.values(by).sort((a, c) => c.tds - a.tds), (p, k) => k === "secs" ? Array.from(p.secs).join(",") : p[k]);
  return <>
    {/* the one list table (spec K6): deductee (party), paid and TDS (amounts), then the rest */}
    <ListTable name="tdsDeductees" id="tdsDeTable" className="bk-table tg-fit gf-off" rows={list} footNote={<span className="note tg-dcount" data-dee-count="">{list.length + " of " + deductees + " deductees"}<ClearLink tab="deductees" /></span>} rowKey={(p) => p.key} unit={["deductee", "deductees"]} of={deductees} sortVia={via("deductees")}
      empty="No deductee matches these filters. Use Clear filters to see all." keepHead={rows.length ? <p className="note" style={{ textAlign: "center" }}><ClearLink tab="deductees" bare /></p> : null}
      after={(p) => S.tdsOpen === p.key && <table className="bk-table" style={{ margin: 0 }} data-statement="">
          <thead><tr><th className="dt">Date</th><th>Voucher</th><th>Section</th><th className="n">Paid or credited</th><th className="n">Rate</th><th className="n">TDS</th><th>Challan</th><th>From</th></tr></thead>
          <tbody>{p.rows.map((r) => <tr key={r.id}><td>{day(r.date)}</td><td>{r.voucher || ""}</td><td><Sec s={r.section} /></td><td className="n">{money(r.paid)}</td>
            <td className="n"><Rate r={r} issue={issueOf[r.id]} /></td><td className="n">{money(r.tds)}</td><td><ChallanPick r={r} chOpts={chOpts} /></td><td><SrcTag r={r} /></td></tr>)}</tbody>
        </table>}
      cols={[
        { k: "party", role: "party", label: "Deductee", cls: "pty", thCls: hfOn("deductees", "pan"), filter: <HeadFilter tab="deductees" k="pan" label="PAN" options={fo.pan} />, v: (p) => p.party, cell: (p) => <div className="tg-pty"><Toggle which="tdsOpen" k={p.key}>{p.party}</Toggle>{p.issues > 0 && <> <span className="tag warn">{p.issues} rate</span></>}</div> },
        { k: "paid", role: "amount", label: "Paid or credited", cls: "n", v: (p) => p.paid, fmt: money, cell: (p) => money(p.paid) },
        { k: "tds", role: "amount", label: "TDS", cls: "n", v: (p) => p.tds, fmt: money, cell: (p) => <b>{money(p.tds)}</b> },
        { k: "pan", label: "PAN", v: (p) => p.pan || "", cell: (p) => <><Pan pan={p.pan} /><F16Link pan={p.pan} fy={S.tdsFy} q={S.tdsQ} /></> },
        { k: "code", label: "Code", cell: (p) => (Certs.validPan(p.pan) ? (/^[A-Z]{3}C/.test(p.pan) ? "01 company" : "02 other") : "—") },
        { k: "secs", label: "Sections", thCls: hfOn("deductees", "section"), filter: <HeadFilter tab="deductees" k="section" label="Section" options={fo.section} />, v: (p) => Array.from(p.secs).join(","), cell: (p) => Array.from(p.secs).map((x) => <Sec key={x} s={x} />) },
        { k: "n", label: "Deductions", cls: "n", thCls: hfOn("deductees", "rate"), filter: <HeadFilter tab="deductees" k="rate" label="Rate" options={fo.rate} />, v: (p) => p.n, sum: true, fmt: String, cell: (p) => <button className="linkbtn" onClick={() => tdsToggle("tdsOpen", p.key)}>{p.n}</button> },
        { k: "unallocated", label: "Not against a challan", cls: "n", thCls: hfOn("deductees", "challan"), filter: <HeadFilter tab="deductees" k="challan" label="Challan" options={fo.challan} />, v: (p) => p.unallocated, sum: true, fmt: money, td: (p) => ({ className: p.unallocated ? "bad" : undefined }), cell: (p) => (p.unallocated ? money(p.unallocated) : "—") },
      ]} />
  </>;
}

// t70: the corrected Excel brought back: each change, old → new, what is refused and why; nothing applied until Apply
function ImportPreview({ rows }) {
  const p = S.tdsImport;
  if (!p) return null;
  const close = () => { S.tdsImport = null; render(); };
  const word = (k) => TDSEdit.WORDS[k] || k, show = (k, v) => (["paid", "tds"].includes(k) && v !== "" ? money(v) : k === "rate" && v !== "" ? v + "%" : v === "" || v == null ? "—" : String(v));
  const apply = () => { const r = TDSEdit.applyAll(p, rows); S.tdsImport = null; saveBooks(); toast(r.n + " change" + (r.n === 1 ? "" : "s") + " applied" + (r.why.length ? "; not applied: " + r.why.join("; ") : "") + "."); render(); };
  return <section className="dash-card tg-import" style={{ marginBottom: 10 }} data-imp-preview="">
    <div className="rp-title"><h3>The corrected Excel: {p.changes.length} change{p.changes.length === 1 ? "" : "s"} to apply</h3></div>
    {p.error ? <p className="note bad">{p.error}</p> : <>
    <p className="note">{p.name} · {p.rows} deduction{p.rows === 1 ? "" : "s"} read · {p.changes.length} change{p.changes.length === 1 ? "" : "s"}{p.refused.length ? " · " + p.refused.length + " refused" : ""}{p.unmatched.length ? " · " + p.unmatched.length + " not matched" : ""}. Nothing is changed until you apply. The books from Tally are not changed: these are kept as FinCom’s corrections of the return.</p>
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
  </section>;
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
// "edited in FinCom: books ₹X" under an amount corrected in FinCom
const Edited = ({ r, k }) => (r.books && Math.abs(num(r.books[k]) - num(r[k])) >= 0.005 ? <div className="tg-sub tg-edited" data-edited={k}>edited in FinCom: books {money(r.books[k])}</div> : null);

function Deductions({ fy, q, rows, issueOf, pass, common, chOpts, title, probs = {}, unitW, edN = 0, fo }) {
  const f = (S.tdsFl || {}).deductions || {};
  const shown = tdsSorted("deductions", rows.filter((r) => pass(r, f)), (r, k) => k === "date" ? TDS.ymd(r.date) : k === "challan" ? (r.challan ? 1 : 0) : r[k] == null ? "" : r[k]);
  const LIMIT = 500, sel = S.tdsSel || {};
  return <>
    <ImportPreview rows={rows} />
    <TagBar rows={rows} chOpts={chOpts} />
    {/* t70: how many are shown, the table's caption */}

    {/* the one list table (spec K6): date, voucher (number), deductee (party), paid and TDS (amounts), challan (status), then the rest */}
    {/* t70 (the owner: "some columns I can not even see properly without touching them"): every column in view at 1366
        px: the voucher under the date, the PAN under the deductee, the section's words and the rate's reason under them */}
    <ListTable name="tdsDeductions" id="tdsDnTable" className="bk-table tg-fit gf-off" rows={shown}
      footNote={<span className="note tg-dcount" data-ded-count="">{shown.length + " of " + rows.length + " " + (unitW || "deductions") + " · " + (unitW === "collections" ? "TCS " : "TDS ") + money(shown.reduce((a, r) => a + r.tds, 0)) + (edN ? " · " + edN + " edited in FinCom" : "")}<ClearLink tab="deductions" /></span>} rowKey={(r) => r.id} unit={["deduction", "deductions"]} of={rows.length} sortVia={via("deductions")} limit={LIMIT}
      more={<p className="note">The first {LIMIT} are shown. Narrow them with the filters, or download the Excel for all {shown.length}.</p>}
      empty="No deduction matches these filters. Use Clear filters to see all." keepHead={rows.length ? <p className="note" style={{ textAlign: "center" }}><ClearLink tab="deductions" bare /></p> : null}
      cols={[
        { k: "pick", role: "pick", cls: "ck", sort: false, head: <input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((r) => sel[r.id])} onChange={(ev) => selSet(shown.map((r) => r.id), ev.target.checked)} />,
          cell: (r) => <input type="checkbox" aria-label={"Select " + r.party} checked={!!sel[r.id]} onChange={(ev) => selSet([r.id], ev.target.checked)} /> },
        { k: "sl", role: "row", label: "Sl.", cls: "n", cell: (r, p, i) => i + 1 },
        { k: "date", role: "date", label: "Date · Voucher", cls: "dt", thCls: hfOn("deductions", "month"), filter: <HeadFilter tab="deductions" k="month" label="Month" options={fo.month} />, v: (r) => TDS.ymd(r.date), cell: (r) => <>{day(r.date)}{r.voucher ? <div className="tg-sub" data-voucher="">{r.voucher}</div> : null}</> },
        { k: "party", role: "party", label: "Deductee · PAN", cls: "pty", thCls: hfOn("deductions", "pan"), filter: <HeadFilter tab="deductions" k="pan" label="PAN" options={fo.pan} />, v: (r) => r.party, cell: (r) => <div className="tg-pty">{r.party}<div className="tg-sub" data-pan="">{Certs.validPan(r.pan) ? r.pan : <NoPan />}</div></div> },
        { k: "paid", role: "amount", label: "Paid or credited", cls: "n", v: (r) => r.paid, fmt: money, cell: (r) => <>{money(r.paid)}<Edited r={r} k="paid" /></> },
        { k: "tds", role: "amount", label: "TDS", cls: "n", v: (r) => r.tds, fmt: money, cell: (r) => <>{money(r.tds)}<Edited r={r} k="tds" /></> },
        { k: "challan", role: "status", label: "Challan", thCls: hfOn("deductions", "challan"), filter: <HeadFilter tab="deductions" k="challan" label="Challan" options={fo.challan} />, v: (r) => (r.challan ? 1 : 0), cell: (r) => <ChallanPick r={r} chOpts={chOpts} /> },
        { k: "section", label: "Section", thCls: hfOn("deductions", "section"), filter: <HeadFilter tab="deductions" k="section" label="Section" options={fo.section} />, v: (r) => r.section || "", cell: (r) => <Sec s={r.section} fy={fy} /> },
        { k: "rate", label: "Rate", cls: "n", thCls: hfOn("deductions", "rate"), filter: <HeadFilter tab="deductions" k="rate" label="Rate" options={fo.rate} />, v: (r) => (r.rate == null ? "" : r.rate), cell: (r) => <Rate r={r} issue={issueOf[r.id]} why /> },
        { k: "src", label: "From", title: "Where the entry came from: the bridge, or the Day Book uploaded", v: (r) => srcWords(r), cell: (r) => <SrcTag r={r} /> },
      ]} />
  </>;
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
function ChecksOther({ fy, q, form, other, rows, int1A, fee, filed }) {
  const parties = Array.from(new Set(rows.map((r) => r.party)));
  return <>
    <InterestFee fy={fy} q={q} form={form} list={int1A} fee={fee} filed={filed} />
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

export function Return26({ b, allRows, form = "26Q" }) {
  const fy = S.tdsFy, q = S.tdsQ, rows = allRows.filter((r) => r.fy === fy && r.q === q);
  const ch = tdsQuarterChallans(fy, q, rows), use = TDS.challanUse(), allCh = TDS.challans();
  const issues = form === "26Q" ? Certs.issues(fy, q) : [], issueOf = {};
  issues.forEach((x) => { issueOf[x.row.id] = x; });
  const deductees = new Set(rows.map((r) => (r.pan && Certs.validPan(r.pan) ? r.pan : normName(r.party)))).size;
  S.tdsTab = tabNow(S.tdsTab, form);
  if (!["challans", "deductions", "checks", "file", "after"].includes(S.tdsTab)) S.tdsTab = "deductions";
  const tds = r2(rows.reduce((a, r) => a + r.tds, 0)), un = rows.filter((r) => !r.challan);
  // T-E1, T-S3 (10-Oct-2026): every form has its interest and late fee; a return marked filed (or its quarter's date under
  // Settings › Closed periods) has its fee worked out to that date, and the fee is then not an error to fix
  const filed = TDSFiled.get(fy, q, form), filedOn = filed ? filed.on : "";
  const int1A = TDS.interest(fy, q, form), fee = TDS.lateFee(fy, q, filedOn, form), noPan = rows.filter((r) => !Certs.validPan(r.pan)).length;
  const feeErr = !filed && fee && fee.days > 0;
  // T-S2: a filed return whose entries changed in Tally since (TDSDrift, src/js/66)
  const drift = filed ? TDSDrift.check(fy, q, form) : null, driftN = drift ? drift.rows.length : 0;
  const fname = TDS.formName(form, fy), draft = TDS.isNew(fy) && !NEW_FORMS_VALIDATED;
  const title = CO().name + " " + fname + " " + q + " " + fy;
  const other = form === "27Q" ? TDS26Q.nrChecks(fy, q) : form === "27EQ" ? TCS27EQ.checks(fy, q) : [];
  // the challans a deduction may be put on: the quarter's, the year's, and any other with tax left (another form's, an
  // earlier period's: allowed, and noted; the owner's rules)
  const chOpts = ch.concat(allCh.filter((c) => !ch.includes(c) && (TDS.fyOf(c.date) === fy || TDSReg.balance(c).tax > 0.005)));
  const secs = Array.from(new Set(rows.map((r) => r.section))).sort();
  const common = [{ key: "section", label: "Section", options: [["", "Every section", "All sections"]].concat(secs.map((x) => { const n = TDS.secNew(x, fy); return [x, n.ref ? n.text + " · " + n.label : x, n.ref ? n.ref + " [" + n.old + "]" : undefined]; })) },
    { key: "pan", label: "PAN", options: [["", "PAN: any"], ["no", "No valid PAN"], ["yes", "Has a PAN"]] },
    { key: "challan", label: "Challan", options: [["", "Challan: any"], ["no", "Not against a challan"], ["yes", "Against a challan"]] }];
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
  const checksN = int1A.length || feeErr || issues.length || other.length ? int1A.length + issues.length + other.length + (feeErr ? 1 : 0) : null;
  // t70, round 4: the filters' choices, for the ▾ in the table's headers
  const fo = {
    month: [["", "All months"]].concat(tdsMonths(fy, q).map((m) => [m, monthName(m)])),
    section: common[0].options.map(([v, l]) => [v, v ? l : "All sections"]),
    pan: [["", "PAN: any"], ["no", "No valid PAN"], ["none", "No PAN given"], ["invalid", "PAN not in the PAN form"], ["inop", "PAN inoperative"], ["yes", "Has a PAN"]],
    challan: [["", "Challan: any"], ["no", "Not against a challan"], ["yes", "Against a challan"]].concat(chOpts.filter((c) => rows.some((r) => r.challan === c.id)).map((c) => ["ch:" + c.id, "Challan " + TDSCH.label(c)])),
    rate: [["", "Rate: any"], ["q", "Rate questions"], ["low", "Below the rate that applies"], ["high", "Above the rate that applies"], ["cert", "Lower-deduction certificate"], ["ok", "Rate as expected"]],
  };
  const common_ = { rows, issueOf, pass, common, chOpts, title, probs, fo };
  // the tabs' row, at its right: By deduction / By deductee, then find, Needs fixing, Export and Import (round 4)
  const dv = S.tdsDedView === "deductees" ? "deductees" : "deductions", fD = (S.tdsFl || {}).deductions || {};
  const shownD = tdsSorted("deductions", rows.filter((r) => pass(r, fD)), (r, k) => k === "date" ? TDS.ymd(r.date) : k === "challan" ? (r.challan ? 1 : 0) : r[k] == null ? "" : r[k]);
  const fixN = rows.filter((r) => probs[r.id]).length, file = useRef(null);
  const chip = <button type="button" className={"btn small fb-chip" + (fD.fix ? " on" : "")} data-ded-filter="fix" aria-pressed={!!fD.fix} title="Only the deductions with something to fix: no valid PAN, the rate, the section, no challan, the payment code"
    onClick={() => tdsFilter("deductions", "fix", fD.fix ? "" : "1")}>Needs fixing <span className="sbar-n">{fixN}</span></button>;
  const tools = dv === "deductions" ? <FilterBar tab="deductions" className="revfilter tg-tools" noClear placeholder="Find a deductee, PAN, voucher or ledger" table="tdsDnTable" title={title + " deductions"} excel="tdsExcel" chip={chip}
      items={[["Print or save as PDF", () => printTable("tdsDnTable", title + " deductions")], ["Excel to correct and bring back (these " + shownD.length + ")", () => TDSEdit.toExcel(shownD, probs, fy, title + " deductions").then(() => toast("Downloaded."))],
        ["The return’s working (Excel)", () => doAct("tdsExcel")], ["Import corrected Excel…", () => file.current && file.current.click()]]}>
      <input ref={file} type="file" hidden accept=".xlsx,.xls" aria-label="Import corrected Excel" data-ded-import="" onChange={(ev) => { const x = ev.target.files && ev.target.files[0]; ev.target.value = ""; importExcel(x, rows); }} />
      <button type="button" className="btn small" data-ded-import-btn="" title="Bring back the Excel exported here, corrected: a preview of each change first" onClick={() => file.current && file.current.click()}>Import</button>
    </FilterBar>
    : <FilterBar tab="deductees" className="revfilter tg-tools" noClear placeholder="Find a deductee, PAN or voucher" table="tdsDeTable" title={title + " deductees"} excel="tdsExcel" />;
  const errN = un.length + noPan + issues.length + other.length + int1A.length + (feeErr ? 1 : 0) + driftN;
  const unit = form === "27EQ" ? "collections" : "deductions";
  const toLook = issues.length + noPan + other.length, notCh = r2(un.reduce((a, r) => a + r.tds, 0));
  return <>
    <ReturnCard fy={fy} q={q} form={form} filed={filed} errN={errN} driftN={driftN} draft={draft} edN={edN}
      primary={(filed && !driftN) || S.tdsTab === "file" ? null : ["Make the file", () => tdsTabGo("file")]}
      more={[["Download the " + fname + " working (Excel)", () => doAct("tdsExcel")]]}
      figs={[
        { label: form === "27EQ" ? "TCS collected" : "TDS deducted", value: money(tds), sub: rows.length + (form === "27EQ" ? " collections, " + deductees + " buyers" : " deductions, " + deductees + " deductees") },
        // what this return uses of its challans, its own share (the TDS review, M6; the whole challans are the register's)
        { label: "Challans", value: money(TDSReg.usedBy(fy, q, form)), sub: (() => { const n = Object.values(TDSReg.uses()).filter((m) => m[TDSReg.key(form, fy, q)]).length; return n + " challan" + (n === 1 ? "" : "s") + " used"; })() },
        { label: "Not against a challan", value: money(notCh), sub: un.length + " " + unit, warn: un.length > 0 },
        { label: "To look at", value: toLook, sub: noPan + " without PAN, " + (form === "26Q" ? issues.length + " rate questions" : other.length + " details missing"), warn: toLook > 0 },
      ]} />
    <Tabs counts={{ deductions: rows.length, challans: Object.values(TDSReg.uses()).filter((m) => m[TDSReg.key(form, fy, q)]).length || null, checks: errN || checksN || null }}
      side={S.tdsTab === "deductions" ? <div className="tg-tabside">
        <DedSwitch unit={form === "27EQ" ? "Buyer" : "Deductee"} />{tools}</div> : null} />
    {S.tdsTab === "challans" ? <ReturnChallans fy={fy} q={q} form={form}>
        <Suggest fy={fy} q={q} form={form} />
        <TallyPays fy={fy} q={q} /></ReturnChallans>
      : S.tdsTab === "deductions" ? <>{S.tdsDedView === "deductees" ? <Deductees deductees={deductees} {...common_} />
        : <><Deductions fy={fy} q={q} {...common_} unitW={unit} edN={edN} /><BySection fy={fy} q={q} form={form} /></>}</>
      : S.tdsTab === "after" ? <AfterFiling fy={fy} q={q} form={form} />
      : S.tdsTab === "file" ? <>
        {draft && <section className="bk-alert" data-draft={TDS.formNo(form, fy)}><b>{fname} (earlier {form}): draft – not yet validated.</b> From 1 April 2026 the return is {fname} under the Income-tax Act, 2025, with new payment codes and file layout. FinCom’s file is not yet matched to Protean’s file format or run through their FVU: do not file it.</section>}
        <FvuResult form={form} />
        <section className="dash-card" data-file={form}><h3>The file for {fname}, {q} {fy}</h3>
          {un.length > 0 && <p className="note bad">{un.length} {unit} not against a challan: <button className="linkbtn" onClick={() => tdsTabGo("challans")}>tag them to challans</button> first.</p>}
          <p className="note" style={{ margin: "0 0 12px" }}>Check the working, download the text file, run it through the FVU, then file it.</p>
          {/* the TDS review, H5: the record layout is not yet checked against Protean's format (docs/fvu-check.md) */}
          <p className="note warn" data-fvu-check=""><b>Check with Protean’s FVU before filing.</b> The file’s layout and some section codes are not yet confirmed against Protean’s current format.</p>
          <PreFileSlot />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn small" onClick={() => doAct("tdsExcel")}>Download the {fname} working</button>
            <button className="btn small primary" onClick={() => doAct("tdsTxt")}>Download the {fname} text file{draft ? " (draft)" : ""}</button>
            <button className="btn small" disabled={!Bridge.on() || draft} title={draft ? "A draft is not sent to the FVU" : Bridge.on() ? undefined : "Needs FinCom Bridge"} onClick={() => doAct("tdsFvu")}>Check it with the FVU</button>
          </div></section>
        <MarkFiled fy={fy} q={q} form={form} /></>
      : <ToFix
        items={[{ k: "nopan", n: noPan, one: "without PAN", many: "without PAN" }, { k: "rate", n: issues.length, one: "rate question", many: "rate questions" },
          { k: "unmatched", n: un.length, one: unit.replace(/s$/, "") + " without a challan", many: unit + " without a challan" }, overItem(fy, q, form)].concat(missingItems(form, other)).concat([
          { k: "paycode", n: TDS26Q.payCodeRows(fy, q, form).length, one: unit.replace(/s$/, "") + " with a payment code to confirm", many: unit + " with a payment code to confirm" },
          { k: "interest", n: int1A.length, one: "interest to pay", many: "interest lines to pay" }, { k: "fee", n: feeErr ? 1 : 0, one: "late fee", many: "late fees" },
          { k: "portal", n: form === "26Q" ? TDS.portalRows().filter((r) => r.fy === fy && r.q === q).length : 0, one: "deduction to file in 26QB / 26QC / 26QD on the portal", many: "deductions to file in 26QB / 26QC / 26QD on the portal" },
          { k: "corr", n: driftN, one: "change since filing", many: "changes since filing" }, { k: "traces", n: TRF.jrFor(fy, q, form) ? TRF.jrFor(fy, q, form).items.length : 0, one: "TRACES default", many: "TRACES defaults" }, unknownItem(fy, q)])}
        parts={[
          ["chtype", <UnknownChallans fy={fy} q={q} form={form} />],
          ["paycode", <PayCodeRows fy={fy} q={q} form={form} />],
          ["portal", form === "26Q" ? <PortalRows fy={fy} q={q} /> : null],
          ["unmatched", <FixRows title={un.length + " " + unit + " without a challan · " + money(notCh)} rows={un} unit={unit} go={<button className="btn small" onClick={() => tdsTabGo("challans")}>Allocate them on Challans</button>} />],
          ["over", TDSReg.overUsed(fy, q, form).length ? <section className="dash-card bad" style={{ marginBottom: 12 }} data-over-used=""><h3>Challans used beyond their amount</h3>
            <p className="note">Two people allocated at once, or an old tagging: the file cannot be made until each is within its amount. Take deductions off them on Challans.</p>
            <ul className="note">{TDSReg.overUsed(fy, q, form).map((c) => <li key={c.id}>{TDSCH.label(c)}: {money(-TDSReg.balance(c).tax)} over</li>)}</ul></section> : null],
          ["nopan", <FixRows title={noPan + " without a valid PAN"} rows={rows.filter((r) => !Certs.validPan(r.pan))} unit={unit} />],
          ["corr", <Correction fy={fy} q={q} form={form} drift={drift} />],
          ["traces", <TracesDefaults jr={TRF.jrFor(fy, q, form)} />],
          [["interest", "fee"], form === "26Q" ? <InterestFee fy={fy} q={q} form={form} list={int1A} fee={fee} filed={filedOn} /> : null],
          [form === "26Q" ? "rate" : ["nrdetails", "nocode", "tcsrate", "missing", "interest", "fee"], form === "26Q" ? <section className="dash-card" style={{ marginBottom: 12 }}><h3>Rate questions</h3>{issues.length ? <RateQuestions list={issues} /> : <p className="note">Every deduction matches the rate that applies.</p>}</section>
            : <ChecksOther fy={fy} q={q} form={form} other={other} rows={rows} int1A={int1A} fee={fee} filed={filedOn} />],
        ]}
        year={yearChecks(fy)} />}
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

// 27Q's and 27EQ's "before the file is made", said as what is missing (the review: "details missing" made specific)
function missingItems(form, other) {
  if (form === "27Q") {
    const fields = Array.from(new Set([].concat(...other.map((x) => x.missing || [])).map((w) => w.replace(/ \(.*$/, "").replace(/, or the .*$/, ""))));
    return [{ k: "nrdetails", n: other.length, one: "non-resident deductee missing " + fields.join(", "), many: "non-resident deductees missing " + fields.join(", ") }];
  }
  if (form === "27EQ") {
    const nocode = other.filter((x) => /No collection code/.test(x.why || "")).length;
    return [{ k: "nocode", n: nocode, one: "collection without a collection code", many: "collections without a collection code" },
      { k: "tcsrate", n: other.length - nocode, one: "TCS rate question", many: "TCS rate questions" }];
  }
  return [];
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
  const shown = tdsSorted("employees", a1.filter((e) => (!qq || (e.name + " " + e.pan).toLowerCase().includes(qq)) &&
    (f.pan !== "no" || !Certs.validPan(e.pan)) && (f.pan !== "yes" || Certs.validPan(e.pan)) && (f.tds !== "yes" || e.tds > 0) && (f.tds !== "no" || !e.tds)), (e, k) => e[k]);
  return <>
    <FilterBar tab="employees" placeholder="Find an employee or PAN" table="q24Table" title={CO().name + " 24Q " + q + " " + fy} excel="q24Excel" count={shown.length + " of " + a1.length + " employees"}
      selects={[{ key: "pan", label: "PAN", options: [["", "PAN: any"], ["no", "No valid PAN"], ["yes", "Has a PAN"]] }, { key: "tds", label: "TDS", options: [["", "TDS: any"], ["yes", "TDS deducted"], ["no", "No TDS"]] }]} />
    {/* the one list table (spec K6): employee (party), paid and TDS (amounts), then the rest */}
    <ListTable name="q24Employees" id="q24Table" rows={shown} rowKey={(e) => e.pan || e.name} unit={["employee", "employees"]} of={a1.length} sortVia={via("employees")}
      empty="No employee matches these filters. Use Clear filters above to see all."
      after={(e) => S.q24Open === (e.pan || e.name) && <table className="bk-table" style={{ margin: 0 }} data-statement="">
          <thead><tr><th className="dt">Month</th><th className="n">Gross</th><th className="n">Exempt</th><th className="n">Chapter VI-A</th><th className="n">TDS</th></tr></thead>
          <tbody>{e.rows.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td className="n">{money(r.gross)}</td><td className="n">{money(r.exempt)}</td><td className="n">{money(r.chapter6)}</td><td className="n">{money(r.tds)}</td></tr>)}</tbody>
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
  if (!has && Payroll.has(fy)) return <Return24Tally fy={fy} q={q} ReturnCard={ReturnCard} Tabs={Tabs} Suggest={Suggest} />;
  // tds-layout: Deductions (Annexure I, the employees), Employees & declarations (the old Salary tab, Annexure II), …
  S.tdsTab = tabNow(S.tdsTab, "24Q");
  const fname = TDS.formName("24Q", fy);
  const top = <div className="revfilter">
    <button className="btn small primary" onClick={() => doAct("salaryPick")}>Bring in the salary sheet</button>
    {has && <><button className="btn small" onClick={() => doAct("q24Excel")}>Download the 24Q working</button><button className="btn small" onClick={() => doAct("salaryClear")}>Remove the sheet</button></>}
  </div>;
  if (!has) {
    const inB = TDS.salaryRows().filter((r) => r.fy === fy && r.q === q);
    const filed0 = TDSFiled.get(fy, q, "24Q");
    return <>
      <ReturnCard fy={fy} q={q} form="24Q" filed={filed0} errN={0} driftN={0} draft={false} primary={["Bring in the salary sheet", () => doAct("salaryPick")]}
        figs={[{ label: "Salary TDS in the books", value: money(inB.reduce((a, r) => a + num(r.tds), 0)), sub: inB.length + " deduction" + (inB.length === 1 ? "" : "s") + " under 192" }]} />
      {inB.length > 0 && <section className="dash-card" style={{ maxWidth: 760, marginBottom: 12 }}><h3>Salary TDS in the books</h3>
        <ListTable name="q24InBooks" rows={inB} rowKey={(r, i) => i} unit={["deduction", "deductions"]}
          cols={[
            { k: "date", role: "date", label: "Date", cls: "dt", v: (r) => TDS.ymd(r.date), cell: (r) => day(r.date) },
            { k: "party", role: "party", label: "Employee", v: (r) => r.party, cell: (r) => r.party },
            { k: "paid", role: "amount", label: "Paid", cls: "n", v: (r) => num(r.paid), fmt: money, cell: (r) => money(r.paid) },
            { k: "tds", role: "amount", label: "TDS", cls: "n", v: (r) => num(r.tds), fmt: money, cell: (r) => money(r.tds) },
            { k: "pan", label: "PAN", v: (r) => r.pan || "", cell: (r) => r.pan || "—" },
          ]} />
        <p className="note">These are kept out of 26Q. For Annexure I and II, bring in the salary sheet.</p></section>}
      {/* tds-challans: the 192 the books carry, tagged to their challans here too (no salary sheet needed for that) */}
      {inB.length > 0 && <div style={{ maxWidth: 1100 }}><Suggest fy={fy} q={q} form="24Q" /></div>}
      <section className="dash-card" style={{ maxWidth: 760 }} data-needs-sheet=""><h3>24Q needs the salary sheet</h3>
        <p className="note">Tally credits each employee their net pay and the TDS as one figure, so the books cannot say how much was deducted from whom. Bring in the payroll sheet you already prepare — Excel or CSV — and the columns are found by their names: employee, PAN, month, gross salary, exempt allowances, standard deduction, professional tax, Chapter VI-A, taxable income and TDS.</p></section>
    </>;
  }
  const a1 = TDS24Q.annexI(fy, q), checks = TDS24Q.checks(fy, q);
  const inBooks = TDS.salaryRows().filter((r) => r.fy === fy && r.q === q), booksTds = r2(inBooks.reduce((a, r) => a + r.tds, 0)), sheetTds = r2(a1.reduce((s, e) => s + e.tds, 0));
  if (inBooks.length && Math.abs(booksTds - sheetTds) >= 1) checks.push({ what: "Salary TDS in the books differs from the salary sheet", n: inBooks.length,
    how: "Tally has " + money(booksTds) + " under section 192 this quarter; the sheet has " + money(sheetTds) + ".", who: Array.from(new Set(inBooks.map((r) => r.party))).slice(0, 3) });
  // T-E1, T-S3: 24Q's interest (the books' salary TDS under 192 against its challans) and late fee, to the date marked filed
  const filed = TDSFiled.get(fy, q, "24Q"), filedOn = filed ? filed.on : "", int1A = TDS.interest(fy, q, "24Q"), fee = TDS.lateFee(fy, q, filedOn, "24Q");
  const late = int1A.length + (!filed && fee && fee.days > 0 ? 1 : 0);
  return <>
    <ReturnCard fy={fy} q={q} form="24Q" filed={filed} errN={checks.length + late} driftN={0} draft={false}
      primary={filed || S.tdsTab === "file" ? null : ["The file and the salary sheet", () => tdsTabGo("file")]}
      more={[["Download the 24Q working (Excel)", () => doAct("q24Excel")], ["Bring in a new salary sheet", () => doAct("salaryPick")]]}
      figs={[
        { label: "Employees this quarter", value: a1.length, sub: money(a1.reduce((s, e) => s + e.paid, 0)) + " paid" },
        { label: "TDS deducted", value: money(sheetTds), sub: q + " " + fy },
        { label: "Before filing", value: checks.length, sub: checks.length ? checks[0].what : "nothing to fix", warn: checks.length > 0 },
      ]} />
    <Tabs counts={{ deductions: a1.length, challans: Object.values(TDSReg.uses()).filter((m) => m[TDSReg.key("24Q", fy, q)]).length || null, checks: checks.length + late || null }} />
    {S.tdsTab === "file" ? <><section className="dash-card" data-file="24Q"><h3>{fname}{TDS.isNew(fy) ? " (earlier 24Q)" : ""}, {q} {fy}</h3>
        <p className="note">The working for the return comes from the salary sheet. Bring in a new sheet to replace it.</p>{top}</section>
        <PreFileSlot />
        <MarkFiled fy={fy} q={q} form="24Q" /></>
      : S.tdsTab === "deductions" ? <Employees fy={fy} q={q} a1={a1} />
      : S.tdsTab === "after" ? <AfterFiling fy={fy} q={q} form="24Q" />
      : S.tdsTab === "challans" ? <ReturnChallans fy={fy} q={q} form="24Q">
        {TDS.salaryRows().some((r) => r.fy === fy && r.q === q) && <Suggest fy={fy} q={q} form="24Q" />}</ReturnChallans>
      : S.tdsTab === "people" ? <><Salary />{q === "Q4" && <section className="dash-card" style={{ marginTop: 12 }} data-annex2=""><h3>Annexure II, the year</h3><div className="bk-tablewrap"><table className="bk-table" data-statement="">
          <thead><tr><th>Employee</th><th>PAN</th><th>Regime</th><th className="n">Gross</th><th className="n">Exempt</th><th className="n">Standard</th><th className="n">Chapter VI-A</th><th className="n">Taxable</th><th className="n">TDS</th></tr></thead>
          <tbody>{TDS24Q.annexII(fy).map((e) => <tr key={e.pan || e.name}><td>{e.name}</td><td>{e.pan || "—"}</td><td>{e.regime === "N" ? "New" : e.regime === "O" ? "Old" : "—"}</td>
            <td className="n">{money(e.gross)}</td><td className="n">{money(e.exempt)}</td><td className="n">{money(e.standard)}</td><td className="n">{money(e.chapter6)}</td><td className="n">{money(e.taxable)}</td><td className="n">{money(e.tds)}</td></tr>)}</tbody>
        </table></div></section>}</>
      : <ToFix items={checksToFix(checks).items
          .concat([{ k: "interest", n: int1A.length, one: "interest to pay", many: "interest lines to pay" }, { k: "fee", n: !filed && fee && fee.days > 0 ? 1 : 0, one: "late fee", many: "late fees" }, unknownItem(fy, q)])}
        parts={[["chtype", <UnknownChallans fy={fy} q={q} form="24Q" />], [["interest", "fee"], <InterestFee fy={fy} q={q} form="24Q" list={int1A} fee={fee} filed={filedOn} />]]
          .concat(checksToFix(checks).parts).concat([["traces", <TracesDefaults jr={TRF.jrFor(fy, q, "24Q")} />]])}
        year={yearChecks(fy)} />}
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
