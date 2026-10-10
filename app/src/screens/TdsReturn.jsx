// A quarter's TDS return: 26Q (other than salary) with its challans, deductees, deductions and checks; 24Q (salary)
// with its employees, challans, Annexure II and checks; and the section 197 certificates with the rate questions.
// Was viewTdsReturn26, viewTdsReturn24, viewTdsCerts, tdsFilterBar, tdsTabs and tdsSortHead (src/js/18).
//
// The figures come from the business logic: TDS.rows() (deductions read from the books), TDS.challans(),
// TDS.challanUse(), Certs.issues(), TDS.interest(), TDS.lateFee(), TDS24Q.annexI()/annexII()/checks().
// Redesign of 09-Oct-2026 (the owner's request, Computax and Winman as the pattern): a return opens on its Summary, then
// Challans · Deductees · Entries · Errors to fix · File (the downloads and the FVU, moved from above the tabs). From tax
// year 2026-27 a section is shown as the Act of 2025 numbers it with the old section beside it (TDS.secNew, src/js/09):
// "393(1) Sl. 6(i) [old 194C]"; the section filter and the find box take either.
// Filters are kept per tab in S.tdsFl, sorting in S.tdsSort; the row opened under a table in S.chOpen, S.tdsOpen,
// S.q24Open. Changes go through tdsFilter, tdsSortBy, tdsToggle, tdsAlloc, challanAdd, … (src/js/27).
import { useRef, useState } from "react";
import ListTable from "../parts/ListTable.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
const NoPan = () => <span className="tag warn">no PAN</span>;
const Pan = ({ pan }) => (Certs.validPan(pan) ? pan : <NoPan />);
const Empty = ({ children }) => <div className="bk-none">{children}</div>;
// a section: from 2026-27 the new provision with the old section beside it and the table entry under it; before, as it was
export const Sec = ({ s, fy = S.tdsFy }) => { const x = TDS.secNew(s, fy); return x.ref ? <span className="rp-sec" data-sec={x.old}>{x.ref} [old {x.old}]<small>{x.label}</small></span> : <>{s}</>; };
const secText = (s, fy = S.tdsFy) => TDS.secNew(s, fy).text;

// the bar above a return's table: find, choices, how many shown, print, Excel
function FilterBar({ tab, placeholder, table, title, excel, count, selects = [] }) {
  const f = (S.tdsFl || {})[tab] || {};
  return (
    <div className="revfilter" style={{ flexWrap: "wrap", rowGap: 6 }}>
      <input type="search" value={f.q || ""} placeholder={placeholder} aria-label={placeholder} style={{ width: 260, flex: "0 0 auto" }} data-fk={"tdsf-" + tab}
        onChange={(ev) => tdsFilter(tab, "q", ev.target.value, true)} />
      {selects.map((sel) => (
        <select key={sel.key} style={{ width: "auto", flex: "0 1 auto", maxWidth: "100%" }} aria-label={sel.label || sel.key} value={f[sel.key] || ""} onChange={(ev) => tdsFilter(tab, sel.key, ev.target.value)}>
          {sel.options.map(([v, l], i) => <option key={i} value={v}>{l}</option>)}
        </select>))}
      <span className="note">{count || ""}</span>
      {Object.keys(f).some((k) => f[k]) && <button className="linkbtn" onClick={() => tdsFilterClear(tab)}>Clear filters</button>}
      <button className="btn small" onClick={() => printTable(table, title)}>Print or save as PDF</button>
      {excel && <button className="btn small" onClick={() => doAct(excel)}>Excel</button>}
    </div>
  );
}

function Tabs({ tabs }) {
  return (
    <nav className="sbar rp-tabs" aria-label="Return" style={{ marginTop: 4 }}>
      {tabs.map(([id, l, n]) => <button key={id} aria-selected={S.tdsTab === id} onClick={() => tdsTabGo(id)}>{l}{n != null && <> <span className="sbar-n">{n}</span></>}</button>)}
    </nav>
  );
}

// the shared list table (spec K6, round 2) with the return's own order (S.tdsSort, tdsSortBy): same headers and arrows
const via = (tab) => { const s = (S.tdsSort || {})[tab] || {}; return { state: s.k ? { k: s.k, dir: s.d < 0 ? "desc" : "asc" } : null, by: (k) => tdsSortBy(tab, k) }; };
const Tile = ({ label, value, sub, warn }) => <div className={"dtile" + (warn ? " warn" : "")}><span>{label}</span><b>{value}</b><small>{sub}</small></div>;
const Toggle = ({ which, k, children }) => <button className="linkbtn" onClick={() => tdsToggle(which, k)}>{S[which] === k ? "▾ " : "▸ "}{children}</button>;

/* ---------------------------------------------------------------- 26Q */

// a TDS payment in Tally not yet a challan: give its BSR code and serial
// (tds-challans, 10-Oct-2026: the BSR box also takes the 20-digit CIN; the deductions the voucher pays bill-wise in Tally
// are said, as they will be proposed for the challan)
function PayRow({ p }) {
  const [bsr, setBsr] = useState(""), [ser, setSer] = useState(""), bw = TDSCH.billCount(p.vid), cin = !!TDSCH.cin(bsr);
  return <tr>
    <td>{day(p.date)}</td><td className="n">{money(p.tax)}</td><td>{p.sections.join(", ")}</td><td>{p.voucher}{bw > 0 && <div className="nr">{bw} deduction{bw === 1 ? "" : "s"} paid bill-wise in Tally</div>}</td>
    <td><input type="text" value={bsr} placeholder="0240020 or the CIN" aria-label="BSR code or CIN" style={{ width: 170 }} onChange={(ev) => setBsr(ev.target.value)} /></td>
    <td><input type="text" value={cin ? TDSCH.cin(bsr).serial : ser} disabled={cin} placeholder="00979" aria-label="Challan serial" style={{ width: 90 }} onChange={(ev) => setSer(ev.target.value)} /></td>
    <td className="ac"><button className="btn small" onClick={() => challanFromBooks(p.vid, bsr, ser)}>Make it a challan</button></td>
  </tr>;
}

// the last row of the challans table: a challan typed in
function NewChallan() {
  const blank = { bsr: "", serial: "", date: "", tax: "", interest: "" }, [c, setC] = useState(blank);
  const box = (k, props) => <input value={c[k]} onChange={(ev) => setC({ ...c, [k]: ev.target.value })} {...props} />;
  return <tr className="lt-new">
    <td></td><td>{box("date", { type: "date", "aria-label": "New challan: date" })}</td>
    <td>{box("bsr", { type: "text", placeholder: "0240020", "aria-label": "New challan: BSR code", style: { width: 100 } })}</td>
    <td>{box("serial", { type: "text", placeholder: "00979", "aria-label": "New challan: serial", style: { width: 90 } })}</td>
    <td className="n">{box("tax", { type: "text", inputMode: "decimal", placeholder: "tax", "aria-label": "New challan: tax", style: { width: 110, textAlign: "right" } })}</td>
    <td colSpan={2}></td>
    <td className="n">{box("interest", { type: "text", inputMode: "decimal", placeholder: "interest", "aria-label": "New challan: interest", style: { width: 100, textAlign: "right" } })}</td>
    <td colSpan={3}></td>
    <td className="ac"><button className="btn small" onClick={() => { if (challanAdd(c)) setC(blank); }}>Add</button></td>
  </tr>;
}

// a challan's use, in words (the status of the challans list)
const chState = (c, use) => { const u = use[c.id] || 0, l = r2(num(c.tax) - u); return l < -0.5 ? "Used more than paid" : u <= 0 ? "Not used" : Math.abs(l) <= 0.5 ? "Fully used" : "Part used"; };

function Challans({ fy, q, ch, allRows, allCh, use, title }) {
  const f = (S.tdsFl || {}).challans || {}, qq = String(f.q || "").toLowerCase(), left = (c) => r2(num(c.tax) - (use[c.id] || 0));
  const shown = tdsSorted("challans", ch.filter((c) => {
    if (qq && ![c.bsr, c.serial, c.section ? TDS.secFind(c.section, fy) : ""].join(" ").toLowerCase().includes(qq)) return false;
    if (f.state === "unused" && (use[c.id] || 0) > 0) return false;
    if (f.state === "part" && !((use[c.id] || 0) > 0 && left(c) > 0.5)) return false;
    if (f.state === "full" && Math.abs(left(c)) > 0.5) return false;
    if (f.state === "over" && left(c) >= -0.5) return false;
    if (f.month && TDS.ymd(c.date).slice(0, 6) !== f.month) return false;
    return true;
  }), (c, k) => k === "state" ? chState(c, use) : k === "int" ? num(c.interest) : k === "date" ? TDS.ymd(c.date) : k === "tax" ? num(c.tax) : k === "left" ? num(c.tax) - (use[c.id] || 0) : k === "used" ? (use[c.id] || 0) : String(c[k] || ""));
  const pays = TDS.paymentsFromBooks().filter((p) => TDS.fyOf(p.date) === fy && TDS.qOf(p.date) === q)
    .filter((p) => !allCh.some((c) => TDS.ymd(c.date) === TDS.ymd(p.date) && Math.abs(num(c.tax) - p.tax) < 1));
  return <>
    {pays.length > 0 && <section className="dash-card" style={{ marginBottom: 12 }}><h3>Paid to the government, from the books</h3>
      <p className="note">TDS payment vouchers in Tally for this quarter, proposed as challans. Give each its CIN (or BSR code and serial) to confirm it. Uploaded challans of the same date and amount are matched to them on their own.</p>
      <div className="bk-tablewrap"><table className="bk-table" data-statement="">
        <thead><tr><th>Date</th><th className="n">Tax</th><th>Sections</th><th>Voucher</th><th>BSR code or CIN</th><th>Serial</th><th className="ac"></th></tr></thead>
        <tbody>{pays.map((p) => <PayRow key={p.vid} p={p} />)}</tbody>
      </table></div></section>}
    <FilterBar tab="challans" placeholder="Find a BSR code or serial" table="tdsChTable" title={title + " challans"} excel="tdsExcel" count={shown.length + " of " + ch.length + " challans"}
      selects={[{ key: "month", label: "Month", options: [["", "Every month"]].concat(tdsMonths(fy, q).map((m) => [m, monthName(m)])) },
        { key: "state", label: "Use", options: [["", "Used: any"], ["unused", "Not used"], ["part", "Part used"], ["full", "Fully used"], ["over", "Used more than paid"]] }]} />
    {/* the one list table (spec K6): deposited (date), BSR code and serial (number), tax (amount), use (status), then the rest */}
    <ListTable name="tdsChallans" id="tdsChTable" rows={shown} rowKey={(c) => c.id} unit={["challan", "challans"]} of={ch.length} sortVia={via("challans")}
      empty={ch.length ? "No challan matches these filters. Use Clear filters above to see all." : null}
      tail={<NewChallan />} prep={(c) => ({ mine: allRows.filter((r) => r.challan === c.id), l: left(c) })}
      after={(c, p) => S.chOpen === c.id && (p.mine.length ? <table className="bk-table" style={{ margin: 0 }} data-statement="">
          <thead><tr><th className="dt">Date</th><th>Deductee</th><th>PAN</th><th>Section</th><th className="n">Paid or credited</th><th className="n">TDS</th></tr></thead>
          <tbody>{p.mine.map((r) => <tr key={r.id}><td>{day(r.date)}</td><td>{r.party}</td><td><Pan pan={r.pan} /></td><td><Sec s={r.section} fy={fy} /></td><td className="n">{money(r.paid)}</td><td className="n">{money(r.tds)}</td></tr>)}</tbody>
        </table> : <p className="note" style={{ margin: 8 }}>No deduction is against this challan yet.</p>)}
      cols={[
        { k: "sl", role: "row", label: "Sl.", cls: "n", cell: (c, p, i) => i + 1 },
        { k: "date", role: "date", label: "Deposited", cls: "dt", v: (c) => TDS.ymd(c.date), cell: (c) => day(c.date) },
        { k: "bsr", role: "number", label: "BSR code", v: (c) => String(c.bsr || ""), cell: (c) => <Toggle which="chOpen" k={c.id}>{c.bsr}</Toggle> },
        { k: "serial", role: "number", label: "Serial", v: (c) => String(c.serial || ""), cell: (c) => c.serial },
        { k: "tax", role: "amount", label: "Tax", cls: "n", v: (c) => num(c.tax), fmt: money, cell: (c) => money(c.tax) },
        { k: "state", role: "status", label: "Use", v: (c, p) => chState(c, use), cell: (c) => { const w = chState(c, use); return <span className={"tag " + (/more than/.test(w) ? "bad" : /Not used|Part/.test(w) ? "warn" : "ok")}>{w}</span>; } },
        { k: "secs", label: "Sections", cell: (c, p) => Array.from(new Set(p.mine.map((r) => r.section))).map((x) => secText(x, fy)).join(", ") || c.section || "—" },
        { k: "int", label: "Interest", cls: "n", v: (c) => num(c.interest), sum: true, fmt: money, cell: (c) => money(c.interest) },
        { k: "used", label: "Used", cls: "n", v: (c) => use[c.id] || 0, sum: true, fmt: money, cell: (c) => money(use[c.id] || 0) },
        { k: "left", label: "Left", cls: "n", v: (c) => left(c), sum: true, fmt: money, td: (c, p) => ({ className: p.l < -0.5 ? "bad" : undefined }), cell: (c, p) => money(p.l) },
        { k: "n", label: "Deductions", cls: "n", cell: (c, p) => <button className="linkbtn" onClick={() => tdsToggle("chOpen", c.id)}>{p.mine.length}</button> },
        { k: "ac", role: "act", cls: "ac", cell: (c) => <button className="icon danger" title="Remove this challan" aria-label="Remove this challan" onClick={() => challanDelete(c.id)}>✕</button> },
      ]} />
    {!shown.length && !ch.length && <table className="bk-table" id="tdsChTable" data-statement=""><tbody><NewChallan /></tbody></table>}
  </>;
}

/* ---------------------------------------------------------------- challan tagging (tds-challans, 10-Oct-2026) */
// The owner's choice: the challans read from the portal's Payment History or receipt PDFs (Upload challans), and the
// tagging proposed from Tally's bill-wise details or by section and month, each confirmed by a person (TDSCH, src/js/65).
// Nothing here works out a figure: the proposals, the amounts left and the refusals are TDSCH's.
function Upload() {
  const ref = useRef(null);
  return <div className="revfilter" style={{ flexWrap: "wrap", rowGap: 6 }} data-challan-upload-bar="">
    <button className="btn small primary" onClick={() => ref.current && ref.current.click()}>Upload challans</button>
    <input ref={ref} type="file" multiple hidden data-challan-upload="" accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf"
      onChange={(ev) => { const f = Array.from(ev.target.files || []); ev.target.value = ""; TDSCH.upload(f); }} />
    <span className="note">The e-filing portal’s Payment History (CSV or Excel) or challan receipt PDFs, many at once. Each challan’s CIN, section and amounts are read, and the tagging is suggested below.</span>
  </div>;
}

const gapTag = (p) => p.exact ? <span className="tag ok">Exact</span>
  : p.gap < 0 ? <span className="tag bad">{money(-p.gap)} short</span> : <span className="tag warn">{money(p.gap)} more on the challan</span>;

function Proposal({ p, fy, open, setOpen }) {
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
        {p.exact ? <button className="btn small primary" onClick={() => tdsConfirm(p.id)}>Confirm {n} deduction{n === 1 ? "" : "s"} to challan {lab}</button>
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
      <span className="note">From Tally’s bill-wise details where the TDS payment has them, else by section and month. Nothing is tagged until you confirm.</span></div>
    {props.length ? <>
      {exact > 1 && <div className="row" style={{ marginBottom: 8 }}><button className="btn small primary" onClick={() => tdsConfirmAll()}>Confirm all exact ({exact})</button></div>}
      <ul className="tch-list">{props.map((p) => <Proposal key={p.id} p={p} fy={fy} open={open === p.id} setOpen={setOpen} />)}</ul></>
      : <p className="note">No suggestion now: the deductions are against challans, or no challan fits them. Upload challans{form === "24Q" ? "" : ", or tick deductions under Entries and tag them"}.</p>}
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
const Rate = ({ r, issue, why }) => <>{r.rate != null ? r.rate + "%" : ""}{issue && <div className="nr bad" title={why ? issue.why : undefined}>should be {issue.expected}%</div>}</>;

function Deductees({ rows, deductees, issueOf, pass, common, chOpts, title }) {
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
    <FilterBar tab="deductees" placeholder="Find a deductee, PAN or voucher" table="tdsDeTable" title={title + " deductees"} excel="tdsExcel" count={list.length + " of " + deductees + " deductees"}
      selects={common.concat([{ key: "rate", label: "Rate", options: [["", "Rate: any"], ["q", "Rate questions"], ["ok", "Rate as expected"]] }])} />
    {/* the one list table (spec K6): deductee (party), paid and TDS (amounts), then the rest */}
    <ListTable name="tdsDeductees" id="tdsDeTable" rows={list} rowKey={(p) => p.key} unit={["deductee", "deductees"]} of={deductees} sortVia={via("deductees")}
      empty="No deductee matches these filters. Use Clear filters above to see all."
      after={(p) => S.tdsOpen === p.key && <table className="bk-table" style={{ margin: 0 }} data-statement="">
          <thead><tr><th className="dt">Date</th><th>Voucher</th><th>Section</th><th className="n">Paid or credited</th><th className="n">Rate</th><th className="n">TDS</th><th>Challan</th></tr></thead>
          <tbody>{p.rows.map((r) => <tr key={r.id}><td>{day(r.date)}</td><td>{r.voucher || ""}</td><td><Sec s={r.section} /></td><td className="n">{money(r.paid)}</td>
            <td className="n"><Rate r={r} issue={issueOf[r.id]} /></td><td className="n">{money(r.tds)}</td><td><ChallanPick r={r} chOpts={chOpts} /></td></tr>)}</tbody>
        </table>}
      cols={[
        { k: "party", role: "party", label: "Deductee", v: (p) => p.party, cell: (p) => <><Toggle which="tdsOpen" k={p.key}>{p.party}</Toggle>{p.issues > 0 && <> <span className="tag warn">{p.issues} rate</span></>}</> },
        { k: "paid", role: "amount", label: "Paid or credited", cls: "n", v: (p) => p.paid, fmt: money, cell: (p) => money(p.paid) },
        { k: "tds", role: "amount", label: "TDS", cls: "n", v: (p) => p.tds, fmt: money, cell: (p) => <b>{money(p.tds)}</b> },
        { k: "pan", label: "PAN", v: (p) => p.pan || "", cell: (p) => <Pan pan={p.pan} /> },
        { k: "code", label: "Code", cell: (p) => (Certs.validPan(p.pan) ? (/^[A-Z]{3}C/.test(p.pan) ? "01 company" : "02 other") : "—") },
        { k: "secs", label: "Sections", v: (p) => Array.from(p.secs).join(","), cell: (p) => Array.from(p.secs).map((x) => secText(x)).join(", ") },
        { k: "n", label: "Deductions", cls: "n", v: (p) => p.n, sum: true, fmt: String, cell: (p) => <button className="linkbtn" onClick={() => tdsToggle("tdsOpen", p.key)}>{p.n}</button> },
        { k: "unallocated", label: "Not against a challan", cls: "n", v: (p) => p.unallocated, sum: true, fmt: money, td: (p) => ({ className: p.unallocated ? "bad" : undefined }), cell: (p) => (p.unallocated ? money(p.unallocated) : "—") },
      ]} />
  </>;
}

function Deductions({ fy, q, rows, issueOf, pass, common, chOpts, title }) {
  const f = (S.tdsFl || {}).deductions || {};
  const shown = tdsSorted("deductions", rows.filter((r) => pass(r, f)), (r, k) => k === "date" ? TDS.ymd(r.date) : k === "challan" ? (r.challan ? 1 : 0) : r[k] == null ? "" : r[k]);
  const LIMIT = 500, sum = (k) => money(shown.reduce((a, r) => a + r[k], 0)), sel = S.tdsSel || {};
  return <>
    <FilterBar tab="deductions" placeholder="Find a deductee, PAN, voucher or ledger" table="tdsDnTable" title={title + " deductions"} excel="tdsExcel"
      count={shown.length + " of " + rows.length + " deductions · TDS " + sum("tds")}
      selects={[{ key: "month", label: "Month", options: [["", "Every month"]].concat(tdsMonths(fy, q).map((m) => [m, monthName(m)])) }].concat(common)
        .concat([{ key: "rate", label: "Rate", options: [["", "Rate: any"], ["q", "Rate questions"], ["ok", "Rate as expected"]] }])} />
    <TagBar rows={rows} chOpts={chOpts} />
    {/* the one list table (spec K6): date, voucher (number), deductee (party), paid and TDS (amounts), challan (status), then the rest */}
    <ListTable name="tdsDeductions" id="tdsDnTable" rows={shown} rowKey={(r) => r.id} unit={["deduction", "deductions"]} of={rows.length} sortVia={via("deductions")} limit={LIMIT}
      more={<p className="note">The first {LIMIT} are shown. Narrow them with the filters, or download the Excel for all {shown.length}.</p>}
      empty="No deduction matches these filters. Use Clear filters above to see all."
      cols={[
        { k: "pick", role: "pick", cls: "ck", sort: false, head: <input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((r) => sel[r.id])} onChange={(ev) => selSet(shown.map((r) => r.id), ev.target.checked)} />,
          cell: (r) => <input type="checkbox" aria-label={"Select " + r.party} checked={!!sel[r.id]} onChange={(ev) => selSet([r.id], ev.target.checked)} /> },
        { k: "sl", role: "row", label: "Sl.", cls: "n", cell: (r, p, i) => i + 1 },
        { k: "date", role: "date", label: "Date", cls: "dt", v: (r) => TDS.ymd(r.date), cell: (r) => day(r.date) },
        { k: "voucher", role: "number", label: "Voucher", v: (r) => r.voucher || "", cell: (r) => r.voucher || "" },
        { k: "party", role: "party", label: "Deductee", v: (r) => r.party, cell: (r) => r.party },
        { k: "paid", role: "amount", label: "Paid or credited", cls: "n", v: (r) => r.paid, fmt: money, cell: (r) => money(r.paid) },
        { k: "tds", role: "amount", label: "TDS", cls: "n", v: (r) => r.tds, fmt: money, cell: (r) => money(r.tds) },
        { k: "challan", role: "status", label: "Challan", v: (r) => (r.challan ? 1 : 0), cell: (r) => <ChallanPick r={r} chOpts={chOpts} /> },
        { k: "pan", label: "PAN", v: (r) => r.pan || "", cell: (r) => <Pan pan={r.pan} /> },
        { k: "section", label: "Section", v: (r) => r.section || "", cell: (r) => <Sec s={r.section} fy={fy} /> },
        { k: "rate", label: "Rate", cls: "n", v: (r) => (r.rate == null ? "" : r.rate), cell: (r) => <Rate r={r} issue={issueOf[r.id]} why /> },
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

function Checks26({ fy, q, int1A, fee, issues }) {
  const total = r2(int1A.reduce((a, x) => a + x.amount, 0));
  return <>
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>Interest and late fee</h3>
      <div className="dash-row"><span>Interest under 201(1A), paid after the due date</span><b>{money(total)}</b></div>
      <div className="dash-row"><span>Late filing fee under 234E, if filed today</span><b>{money(fee && fee.days > 0 ? fee.fee : 0)}</b></div>
      {fee && fee.days > 0 && <p className="note">{fee.days} day{fee.days === 1 ? "" : "s"} past {day(fee.due)} at 200 a day, capped at the TDS of the quarter ({money(fee.cap)}).</p>}
      {int1A.length ? <ListTable name="tdsLate" rows={int1A} rowKey={(x, i) => (x.row.id || "") + ":" + i} unit={["late deduction", "late deductions"]} limit={100}
        cols={[
          { k: "date", role: "date", label: "Deducted", cls: "dt", v: (x) => TDS.ymd(x.row.date), cell: (x) => day(x.row.date) },
          { k: "party", role: "party", label: "Deductee", v: (x) => x.row.party, cell: (x) => x.row.party },
          { k: "int", role: "amount", label: "Interest", cls: "n", v: (x) => num(x.amount), fmt: money, td: () => ({ className: "bad" }), cell: (x) => money(x.amount) },
          { k: "tds", label: "TDS", cls: "n", v: (x) => num(x.row.tds), sum: true, fmt: money, cell: (x) => money(x.row.tds) },
          { k: "due", label: "Due", v: (x) => TDS.ymd(x.due), cell: (x) => day(x.due) },
          { k: "paid", label: "Paid", v: (x) => TDS.ymd(x.challan.date), cell: (x) => day(x.challan.date) },
          { k: "m", label: "Months", cls: "n", v: (x) => x.months, cell: (x) => x.months },
        ]} /> : <p className="note">No deduction was paid late.</p>}
    </section>
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>Rate questions</h3>{issues.length ? <RateQuestions list={issues} /> : <p className="note">Every deduction matches the rate that applies.</p>}</section>
  </>;
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

export function Return26({ b, allRows, form = "26Q" }) {
  const fy = S.tdsFy, q = S.tdsQ, rows = allRows.filter((r) => r.fy === fy && r.q === q);
  const ch = tdsQuarterChallans(fy, q, rows), use = TDS.challanUse(), allCh = TDS.challans();
  const issues = form === "26Q" ? Certs.issues(fy, q) : [], issueOf = {};
  issues.forEach((x) => { issueOf[x.row.id] = x; });
  const deductees = new Set(rows.map((r) => (r.pan && Certs.validPan(r.pan) ? r.pan : normName(r.party)))).size;
  if (!["summary", "challans", "deductees", "deductions", "checks", "file"].includes(S.tdsTab)) S.tdsTab = "summary";
  const tds = r2(rows.reduce((a, r) => a + r.tds, 0)), un = rows.filter((r) => !r.challan), chTax = r2(ch.reduce((a, c) => a + num(c.tax), 0));
  const int1A = form === "26Q" ? TDS.interest(fy, q) : [], fee = form === "26Q" ? TDS.lateFee(fy, q, (b.filedOn || {})[fy + q]) : null, noPan = rows.filter((r) => !Certs.validPan(r.pan)).length;
  const fname = TDS.formName(form, fy), draft = TDS.isNew(fy) && !NEW_FORMS_VALIDATED;
  const title = CO().name + " " + fname + " " + q + " " + fy;
  const other = form === "27Q" ? TDS26Q.nrChecks(fy, q) : form === "27EQ" ? TCS27EQ.checks(fy, q) : [];
  const chOpts = ch.concat(allCh.filter((c) => !ch.includes(c) && TDS.fyOf(c.date) === fy));
  const secs = Array.from(new Set(rows.map((r) => r.section))).sort();
  const common = [{ key: "section", label: "Section", options: [["", "Every section"]].concat(secs.map((x) => { const n = TDS.secNew(x, fy); return [x, n.ref ? n.text + " · " + n.label : x]; })) },
    { key: "pan", label: "PAN", options: [["", "PAN: any"], ["no", "No valid PAN"], ["yes", "Has a PAN"]] },
    { key: "challan", label: "Challan", options: [["", "Challan: any"], ["no", "Not against a challan"], ["yes", "Against a challan"]] }];
  const pass = (r, f) => {
    const qq = String(f.q || "").toLowerCase();
    if (qq && ![r.party, r.pan, TDS.secFind(r.section, fy), r.voucher, r.ledger].join(" ").toLowerCase().includes(qq)) return false;
    if (f.section && r.section !== f.section) return false;
    if (f.pan === "no" && Certs.validPan(r.pan)) return false;
    if (f.pan === "yes" && !Certs.validPan(r.pan)) return false;
    if (f.challan === "no" && r.challan) return false;
    if (f.challan === "yes" && !r.challan) return false;
    if (f.month && TDS.ymd(r.date).slice(0, 6) !== f.month) return false;
    if (f.rate === "q" && !issueOf[r.id]) return false;
    if (f.rate === "ok" && issueOf[r.id]) return false;
    return true;
  };
  const checksN = int1A.length || (fee && fee.days > 0) || issues.length || other.length ? int1A.length + issues.length + other.length + (fee && fee.days > 0 ? 1 : 0) : null;
  const common_ = { rows, issueOf, pass, common, chOpts, title };
  const errN = un.length + noPan + issues.length + other.length + int1A.length + (fee && fee.days > 0 ? 1 : 0);
  const unit = form === "27EQ" ? "collections" : "deductions";
  return <>
    <Tabs tabs={[["summary", "Summary"], ["challans", "Challans", ch.length], ["deductees", form === "27EQ" ? "Buyers" : "Deductees", deductees], ["deductions", "Entries", rows.length],
      ["checks", "Errors to fix", errN || checksN || null], ["file", "File"]]} />
    {draft && S.tdsTab !== "file" && <p className="note" style={{ margin: "6px 0 10px" }} data-draft-line={TDS.formNo(form, fy)}>{fname} (earlier {form}) is a draft: not yet validated. See File.</p>}
    {S.tdsTab === "summary" ? <>
      <div className="dash-tiles">
        <Tile label={form === "27EQ" ? "TCS collected" : "TDS deducted"} value={money(tds)} sub={rows.length + (form === "27EQ" ? " collections, " + deductees + " buyers" : " deductions, " + deductees + " deductees")} />
        <Tile label="Challans" value={money(chTax)} sub={ch.length + " challan" + (ch.length === 1 ? "" : "s")} />
        <Tile label="Not against a challan" value={money(un.reduce((a, r) => a + r.tds, 0))} sub={un.length + " " + unit} warn={un.length > 0} />
        <Tile label="To look at" value={issues.length + noPan + other.length} sub={noPan + " without PAN, " + (form === "26Q" ? issues.length + " rate questions" : other.length + " details missing")} warn={issues.length > 0 || noPan > 0 || other.length > 0} />
      </div>
      <BySection fy={fy} q={q} form={form} />
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {errN > 0 && <button className="btn small" onClick={() => tdsTabGo("checks")}>Errors to fix ({errN})</button>}
        <button className="btn small primary" onClick={() => tdsTabGo("file")}>Make the file</button></div>
    </>
      : S.tdsTab === "challans" ? <>
        <Upload />
        <Suggest fy={fy} q={q} form={form} />
        <Challans fy={fy} q={q} ch={ch} allRows={allRows} allCh={allCh} use={use} title={title} /></>
      : S.tdsTab === "deductees" ? <Deductees deductees={deductees} {...common_} />
      : S.tdsTab === "deductions" ? <Deductions fy={fy} q={q} {...common_} />
      : S.tdsTab === "file" ? <>
        {draft && <section className="bk-alert" data-draft={TDS.formNo(form, fy)}><b>{fname} (earlier {form}): draft – not yet validated.</b> From 1 April 2026 the return is {fname} under the Income-tax Act, 2025, with new payment codes and file layout. FinCom’s file is not yet matched to Protean’s file format or run through their FVU: do not file it.</section>}
        <FvuResult form={form} />
        <section className="dash-card" data-file={form}><h3>The file for {fname}, {q} {fy}</h3>
          {un.length > 0 && <p className="note bad">{un.length} {unit} not against a challan: <button className="linkbtn" onClick={() => tdsTabGo("challans")}>tag them to challans</button> first.</p>}
          <ol className="note" style={{ margin: "0 0 10px 18px", padding: 0 }}><li>Download the working and check it.</li><li>Download the text file.</li><li>Check it with the FVU, then file it.</li></ol>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn small" onClick={() => doAct("tdsExcel")}>Download the {fname} working</button>
            <button className="btn small" onClick={() => doAct("tdsTxt")}>Download the {fname} text file{draft ? " (draft)" : ""}</button>
            <button className="btn small primary" disabled={!Bridge.on() || draft} title={draft ? "A draft is not sent to the FVU" : Bridge.on() ? undefined : "Needs FinCom Bridge"} onClick={() => doAct("tdsFvu")}>Check it with the FVU</button>
          </div></section></>
      : <>
        {(un.length > 0 || noPan > 0) && <section className="dash-card" style={{ marginBottom: 12 }} data-fix=""><h3>To fix before the file</h3>
          {un.length > 0 && <div className="dash-row"><span>{un.length} {unit} not against a challan <button className="linkbtn" onClick={() => tdsTabGo("challans")}>Challans</button></span><b>{money(un.reduce((a, r) => a + r.tds, 0))}</b></div>}
          {noPan > 0 && <div className="dash-row"><span>{noPan} without a valid PAN <button className="linkbtn" onClick={() => { tdsFilter("deductions", "pan", "no"); tdsTabGo("deductions"); }}>See them</button></span><b>{noPan}</b></div>}</section>}
        {form === "26Q" ? <Checks26 fy={fy} q={q} int1A={int1A} fee={fee} issues={issues} /> : <ChecksOther fy={fy} q={q} form={form} other={other} rows={rows} />}</>}
  </>;
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
  const tabs = [["summary", "Summary"], ["employees", "Employees"], ["challans", "Challans"]].concat(q === "Q4" ? [["annex2", "Annexure II, the year"]] : []).concat([["checks", "Errors to fix"], ["file", "File"]]);
  if (!tabs.some((t) => t[0] === S.tdsTab)) S.tdsTab = "summary";
  const fname = TDS.formName("24Q", fy);
  const top = <div className="revfilter">
    <button className="btn small primary" onClick={() => doAct("salaryPick")}>Bring in the salary sheet</button>
    {has && <><button className="btn small" onClick={() => doAct("q24Excel")}>Download the 24Q working</button><button className="btn small" onClick={() => doAct("salaryClear")}>Remove the sheet</button></>}
  </div>;
  if (!has) {
    const inB = TDS.salaryRows().filter((r) => r.fy === fy && r.q === q);
    return <>{top}
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
      {inB.length > 0 && <div style={{ maxWidth: 1100 }}><Upload /><Suggest fy={fy} q={q} form="24Q" /></div>}
      <section className="dash-card" style={{ maxWidth: 760 }}><h3>24Q needs the salary sheet</h3>
        <p className="note">Tally credits each employee their net pay and the TDS as one figure, so the books cannot say how much was deducted from whom. Bring in the payroll sheet you already prepare — Excel or CSV — and the columns are found by their names: employee, PAN, month, gross salary, exempt allowances, standard deduction, professional tax, Chapter VI-A, taxable income and TDS.</p></section>
    </>;
  }
  const a1 = TDS24Q.annexI(fy, q), checks = TDS24Q.checks(fy, q), ch = TDS.challans().filter((c) => TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q);
  const inBooks = TDS.salaryRows().filter((r) => r.fy === fy && r.q === q), booksTds = r2(inBooks.reduce((a, r) => a + r.tds, 0)), sheetTds = r2(a1.reduce((s, e) => s + e.tds, 0));
  if (inBooks.length && Math.abs(booksTds - sheetTds) >= 1) checks.push({ what: "Salary TDS in the books differs from the salary sheet", n: inBooks.length,
    how: "Tally has " + money(booksTds) + " under section 192 this quarter; the sheet has " + money(sheetTds) + ".", who: Array.from(new Set(inBooks.map((r) => r.party))).slice(0, 3) });
  const use = S.tdsTab === "challans" ? TDS.challanUse() : null;
  return <>
    <Tabs tabs={tabs.map(([id, l]) => [id, l, id === "employees" ? a1.length : id === "challans" ? ch.length : id === "checks" ? (checks.length || null) : null])} />
    {S.tdsTab === "summary" ? <>
      <div className="dash-tiles" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <Tile label="Employees this quarter" value={a1.length} sub={money(a1.reduce((s, e) => s + e.paid, 0)) + " paid"} />
        <Tile label="TDS deducted" value={money(sheetTds)} sub={q + " " + fy} />
        <Tile label="Before filing" value={checks.length} sub={checks.length ? checks[0].what : "nothing to fix"} warn={checks.length > 0} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {checks.length > 0 && <button className="btn small" onClick={() => tdsTabGo("checks")}>Errors to fix ({checks.length})</button>}
        <button className="btn small primary" onClick={() => tdsTabGo("file")}>The file and the salary sheet</button></div></>
      : S.tdsTab === "file" ? <section className="dash-card" data-file="24Q"><h3>{fname}{TDS.isNew(fy) ? " (earlier 24Q)" : ""}, {q} {fy}</h3>
        <p className="note">The working for the return comes from the salary sheet. Bring in a new sheet to replace it.</p>{top}</section>
      : S.tdsTab === "employees" ? <Employees fy={fy} q={q} a1={a1} />
      : S.tdsTab === "challans" ? <>
        <p className="note">Challans deposited in {q}. Salary TDS is paid under section 192; upload challans here, or add one under 26Q’s Challans tab if it is not here.</p>
        <Upload />
        {TDS.salaryRows().some((r) => r.fy === fy && r.q === q) && <Suggest fy={fy} q={q} form="24Q" />}
        <ListTable name="q24Challans" id="q24ChTable" rows={ch} rowKey={(c) => c.id} unit={["challan", "challans"]}
          empty="No challan deposited in this quarter. Add one under 26Q’s Challans tab."
          cols={[
            { k: "date", role: "date", label: "Deposited", cls: "dt", v: (c) => TDS.ymd(c.date), cell: (c) => day(c.date) },
            { k: "bsr", role: "number", label: "BSR code", v: (c) => String(c.bsr || ""), cell: (c) => c.bsr },
            { k: "serial", role: "number", label: "Serial", v: (c) => String(c.serial || ""), cell: (c) => c.serial },
            { k: "tax", role: "amount", label: "Tax", cls: "n", v: (c) => num(c.tax), fmt: money, cell: (c) => money(c.tax) },
            { k: "sec", label: "Section", v: (c) => c.section || "", cell: (c) => (c.section ? <Sec s={c.section} fy={fy} /> : "—") },
            { k: "int", label: "Interest", cls: "n", v: (c) => num(c.interest), sum: true, fmt: money, cell: (c) => money(c.interest) },
            { k: "used", label: "Used", cls: "n", v: (c) => use[c.id] || 0, sum: true, fmt: money, cell: (c) => money(use[c.id] || 0) },
          ]} /></>
      : S.tdsTab === "annex2" ? <div className="bk-tablewrap"><table className="bk-table" data-statement="">
          <thead><tr><th>Employee</th><th>PAN</th><th>Regime</th><th className="n">Gross</th><th className="n">Exempt</th><th className="n">Standard</th><th className="n">Chapter VI-A</th><th className="n">Taxable</th><th className="n">TDS</th></tr></thead>
          <tbody>{TDS24Q.annexII(fy).map((e) => <tr key={e.pan || e.name}><td>{e.name}</td><td>{e.pan || "—"}</td><td>{e.regime === "N" ? "New" : e.regime === "O" ? "Old" : "—"}</td>
            <td className="n">{money(e.gross)}</td><td className="n">{money(e.exempt)}</td><td className="n">{money(e.standard)}</td><td className="n">{money(e.chapter6)}</td><td className="n">{money(e.taxable)}</td><td className="n">{money(e.tds)}</td></tr>)}</tbody>
        </table></div>
      : checks.length ? <section className="dash-card"><h3>Before filing</h3>{checks.map((c, i) => <span key={i} style={{ display: "contents" }}>
          <div className="dash-row"><span>{c.what}</span><b>{c.n}</b></div><p className="note">{c.how}{c.who.length ? " e.g. " + c.who.join(", ") : ""}</p></span>)}</section>
        : <p className="note">Nothing to fix for this quarter.</p>}
  </>;
}

/* ---------------------------------------------------------------- certificates */

function NewCert() {
  const blank = { party: "", pan: "", section: "", certNo: "", rate: "", from: "", to: "" }, [c, setC] = useState(blank);
  const box = (k, props) => <input value={c[k]} onChange={(ev) => setC({ ...c, [k]: ev.target.value })} {...props} />;
  return <tr className="lt-new">
    <td>{box("from", { type: "date", "aria-label": "New certificate: from" })}</td>
    <td>{box("certNo", { type: "text", placeholder: "certificate no.", "aria-label": "New certificate: number", style: { width: 140 } })}</td>
    <td>{box("party", { type: "text", placeholder: "deductee as named in Tally", "aria-label": "New certificate: deductee", style: { width: 190 } })}</td>
    <td>{box("pan", { type: "text", placeholder: "PAN", "aria-label": "New certificate: PAN", style: { width: 110 } })}</td>
    <td>{box("section", { type: "text", placeholder: "194C", "aria-label": "New certificate: section", style: { width: 80 } })}</td>
    <td className="n">{box("rate", { type: "text", inputMode: "decimal", placeholder: "0.5", "aria-label": "New certificate: rate", style: { width: 70, textAlign: "right" } })}</td>
    <td>{box("to", { type: "date", "aria-label": "New certificate: to" })}</td>
    <td className="ac"><button className="btn small" onClick={() => { if (certAdd(c)) setC(blank); }}>Add</button></td>
  </tr>;
}

export function CertsPage() {
  const list = Certs.all(), iss = Certs.issues(S.tdsFy || "", "");
  return <>
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>Certificates under section 197</h3>
      <p className="note">A deductee with a certificate for a lower rate, or nil. Where a payment is covered by one, that rate is what the system expects instead of the usual rate.</p>
      {list.length ? <ListTable name="tdsCerts" rows={list} rowKey={(c) => c.id} unit={["certificate", "certificates"]} tail={<NewCert />}
        cols={[
          { k: "from", role: "date", label: "From", v: (c) => c.from || "", cell: (c) => (c.from ? fmtDate(c.from) : "") },
          { k: "no", role: "number", label: "Certificate no.", v: (c) => c.certNo || "", cell: (c) => c.certNo || "" },
          { k: "party", role: "party", label: "Deductee", v: (c) => c.party, cell: (c) => c.party },
          { k: "pan", label: "PAN", v: (c) => c.pan || "", cell: (c) => c.pan || "" },
          { k: "sec", label: "Section", v: (c) => c.section || "", cell: (c) => c.section || "any" },
          { k: "rate", label: "Rate", cls: "n", v: (c) => num(c.rate), cell: (c) => num(c.rate) + "%" },
          { k: "to", label: "To", v: (c) => c.to || "", cell: (c) => (c.to ? fmtDate(c.to) : "") },
          { k: "ac", role: "act", cls: "ac", cell: (c) => <button className="icon danger" aria-label="Remove this certificate" onClick={() => certDelete(c.id)}>✕</button> },
        ]} /> : <><p className="note lt-empty" data-list-empty="" style={{ border: 0 }}>No certificate yet. Type one in below and use Add.</p>
        <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th>From</th><th>Certificate no.</th><th>Deductee</th><th>PAN</th><th>Section</th><th className="n">Rate</th><th>To</th><th className="ac"></th></tr></thead><tbody><NewCert /></tbody></table></div></>}
    </section>
    <section className="dash-card"><h3>Rate questions</h3>
      <p className="note">Where the books deducted at a rate different from the one that applies: a certificate, 20% under section 206AA when there is no valid PAN, or the usual rate for the section.</p>
      <RateQuestions list={iss.slice(0, 200)} />{!iss.length && <Empty>Every deduction matches the rate that applies.</Empty>}
      {iss.length > 200 && <p className="note">The first 200 of {iss.length} are shown.</p>}
    </section>
  </>;
}
