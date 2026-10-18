// A return's tabs in the owner's layout (tds-layout, approved 13/14-Oct-2026: "too many tabs; salary, challans, 26AS and
// TRACES don't belong as top tabs"). A return (a form and quarter of the year's grid) opens on:
//   Deductions                 its deductions (by deduction or by deductee)
//   Employees & declarations   Form 138 / 24Q only: what the TDS page's Salary tab had (tds/Payroll.jsx Salary), and
//                              Annexure II in the fourth quarter
//   Challans                   what this return uses of each challan, drawn from the client's one challan register
//   To fix                     what is wrong, said as what it is ("3 deductions without a challan · 2 without PAN"), each
//                              opening its own list; the year's checks (limits, tie-out, certificates) under it
//   Return file                the FVU text file, the FVU's answer, Mark filed; a slot for "Check before filing"
//   After filing               TRACES' files for this return, once it is marked filed
// The tab ids stay the old ones where the content is the same (deductions, challans, checks, file); the old "deductees",
// "summary", "employees" and "annex2" open their new place (tabNow).
import { useState } from "react";
import { Upload as TracesUpload, TracesDefaults, Conso } from "./Files.jsx";
import { UseBalance, SrcBadge, TracesCheck, Said } from "./Register.jsx";
import { ChallanMatch } from "./Match.jsx";
import { Lock as LockIcon } from "lucide-react";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");

// the tabs of each form, in order: [id, label]. next-challan-match, the owner's direction of 18-Oct-2026 ("like Winman, so
// anyone can see which challan pays which deduction"): exactly four tabs for every form: Deductor · Deductees (PAN) ·
// Challans · Deductions. To fix, the file and After filing are actions under the tabs (ACTS), not tabs; for 24Q /
// Form 138 also Employees & declarations
const TABS = [["deductor", "Deductor"], ["deductees", "Deductees (PAN)"], ["challans", "Challans"], ["deductions", "Deductions"]];
const ACTS = { "24Q": [["people", "Employees & declarations"], ["checks", "To fix"], ["file", "Make the file"], ["after", "After filing"]],
  other: [["checks", "To fix"], ["file", "Make the file"], ["after", "After filing"]] };
export const tabsOf = () => TABS;
export const actsOf = (form) => ACTS[form === "24Q" ? "24Q" : "other"];
// the tabs with their counts ({deductions, challans, checks}): [[id, label, count]]
export const returnTabs = (form, counts) => tabsOf(form).map(([id, l]) => [id, l, counts && counts[id] != null ? counts[id] : null]);
export const returnActs = (form, counts) => actsOf(form).map(([id, l]) => [id, l, counts && counts[id] != null ? counts[id] : null]);
// a tab asked for (an old id, an old address) to one the form has
export function tabNow(tab, form) {
  const t = { summary: "deductions", entries: "deductions", employees: "deductions", annex2: form === "24Q" ? "people" : "deductions", salary: form === "24Q" ? "people" : "deductions" }[tab] || tab;
  return tabsOf(form).concat(actsOf(form)).some(([id]) => id === t) ? t : "deductions";
}
// the four tabs and, beside them, the return's actions (To fix, Make the file, After filing)
export function ReturnNav({ form, counts, side }) {
  const cur = S.tdsTab;
  return <div className="tg-tabrow rp-navrow">
    <nav className="sbar rp-tabs" aria-label="Return" data-return-tabs="">
      {returnTabs(form, counts).map(([id, l, n]) => <button key={id} data-ret-tab={id} aria-selected={cur === id} onClick={() => tdsTabGo(id)}>{l}{n != null && <> <span className="sbar-n">{n}</span></>}</button>)}
    </nav>
    <nav className="rp-acts" aria-label="Return actions" data-return-acts="">
      {returnActs(form, counts).map(([id, l, n]) => <button key={id} type="button" className={"btn small" + (cur === id ? " on" : "") + (id === "file" ? " primary" : "")} data-ret-tab={id} aria-pressed={cur === id} onClick={() => tdsTabGo(id)}>{l}{n != null && <> <span className="sbar-n">{n}</span></>}</button>)}
    </nav>
    {side}
  </div>;
}
// a salary return's "before filing" checks as To fix's lines and lists ([{what, n, how, who}] -> {items, parts})
export function checksToFix(checks) {
  return {
    items: checks.map((c, i) => ({ k: "c" + i, n: c.n, one: c.what.toLowerCase(), many: c.what.toLowerCase() })),
    parts: checks.map((c, i) => ["c" + i, <section key={i} className="dash-card" style={{ marginBottom: 12 }}><div className="dash-row"><span>{c.what}</span><b>{c.n}</b></div>
      <p className="note">{c.how}{c.who.length ? " e.g. " + c.who.join(", ") : ""}</p></section>]),
  };
}

/* ---------------------------------------------------------------- Deductions: by deduction or by deductee */
export function DedSwitch({ unit = "Deductee" }) {
  const v = S.tdsDedView === "deductees" ? "deductees" : "deductions";
  return <nav className="sbar subnav" aria-label="Show" data-ded-view={v}>
    <button aria-selected={v === "deductions"} data-ded-switch="deductions" onClick={() => { S.tdsDedView = ""; render(); }}>By deduction</button>
    <button aria-selected={v === "deductees"} data-ded-switch="deductees" onClick={() => { S.tdsDedView = "deductees"; render(); }}>By {unit.toLowerCase()}</button>
  </nav>;
}

/* ---------------------------------------------------------------- the filed lock, in the return's header on every tab */
export function LockLine({ fy, q, form, short }) {
  const filed = TDSReg.filed(fy, q, form), open = TDSReg.corrOpen(fy, q, form);
  if (!filed) return null;
  const openIt = async () => {
    const ok = await askConfirm({ title: "Open a correction for " + form + " " + q + " " + fy + "?", ok: "Open a correction",
      body: "The return is marked filed on " + esc(day(filed.on)) + ". Opening a correction lets its challans change; each change goes to the trail. File the correction statement on TRACES, then mark it filed again: that locks the return once more." });
    if (!ok || !ok.ok) return;
    TDSReg.openCorrection(fy, q, form); toast("Correction opened for " + form + " " + q + " " + fy + "."); render();
  };
  return <p className={"tg-lock" + (open ? " open" : "")} data-ret-lock={open ? "correction" : "locked"}>
    {open ? <><b>A correction is open:</b> this return’s challans may change. <button className="linkbtn" onClick={() => { TDSReg.closeCorrection(fy, q, form); render(); }}>Close the correction</button></>
      : short ? <span title={"Filed " + day(filed.on) + ": its challans are locked."}><LockIcon width={13} height={13} aria-hidden="true" /> Challans locked · <button className="linkbtn" data-open-correction="" onClick={openIt}>Open a correction…</button></span>
      : <><LockIcon width={13} height={13} aria-hidden="true" /> Filed {day(filed.on)}: its challans are locked. <button className="linkbtn" data-open-correction="" onClick={openIt}>Open a correction…</button></>}
  </p>;
}

/* ---------------------------------------------------------------- Challans: which challan pays which deduction */
// next-challan-match (the owner, 17-Oct-2026): the one screen of tds/Match.jsx: the challans as cards, the deductions on
// each, the suggestions to confirm, what is not matched yet with its next step, the checks before the file. It replaced
// "This return's challans" with its "Auto-allocate N" and "Add from register" (and the "Suggested tagging" card)
export function ReturnChallans({ fy, q, form, children }) {
  return <div data-ret-challans={TDSReg.key(form, fy, q)}>
    <Said />
    <ChallanMatch fy={fy} q={q} form={form}>{children}</ChallanMatch>
  </div>;
}

/* ---------------------------------------------------------------- To fix */
// items: [{k, n, one, many}]: what is wrong, counted, in words; a click opens that list alone (S.tdsFix)
// parts: [[k or [k…], element]]: each list; year: [[k, label, element]]: the year's checks, opened by their links
export function ToFix({ items, parts, year = [] }) {
  // the list chosen belongs to the return it was chosen on (S.tdsFixAt); another return opens on all its lines
  const at = S.tdsFy + "|" + S.tdsQ + "|" + (S.tdsForm || "26Q");
  if (S.tdsFix && S.tdsFixAt !== at) S.tdsFix = "";
  const live = items.filter((x) => x.n > 0), sel = S.tdsFix || "";
  const pick = (k) => { S.tdsFix = S.tdsFix === k ? "" : k; S.tdsFixAt = at; render(); };
  const showing = (ks) => !sel || [].concat(ks).includes(sel);
  return <div data-to-fix={sel || "all"}>
    <section className="dash-card" style={{ marginBottom: 12 }}>
      <div className="fix-line" data-fix-line="">{live.length ? live.map((x, i) => <span key={x.k}>{i > 0 && " · "}<button className={"linkbtn" + (sel === x.k ? " on" : "")} data-fix={x.k} aria-pressed={sel === x.k}
        onClick={() => pick(x.k)}>{x.n} {x.n === 1 ? x.one : x.many}</button></span>) : <span className="note" data-fix-none="">Nothing to fix in this return.</span>}
        {sel && <> · <button className="linkbtn" data-fix-all="" onClick={() => pick("")}>Show all</button></>}</div>
      {year.length > 0 && <p className="note" style={{ margin: "6px 0 0" }}>The year’s checks: {year.map(([k, l], i) => <span key={k}>{i > 0 && " · "}<button className={"linkbtn" + (sel === k ? " on" : "")} data-fix={k} onClick={() => pick(k)}>{l}</button></span>)}</p>}
    </section>
    {parts.filter(([ks, el]) => el && showing(ks)).map(([ks, el]) => <div key={[].concat(ks).join(",")} data-fix-part={[].concat(ks).join(",")}>{el}</div>)}
    {year.filter(([k]) => sel === k).map(([k, , el]) => <div key={k} data-fix-part={k}>{el}</div>)}
  </div>;
}
// a list of deductions (without PAN, without a challan) inside To fix
export function FixRows({ title, rows, unit = "deductions", go }) {
  if (!rows.length) return null;
  return <section className="dash-card" style={{ marginBottom: 12 }}><h3>{title}</h3>
    <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th className="dt">Date</th><th>Deductee</th><th>PAN</th><th>Section</th><th className="n">TDS</th></tr></thead>
      <tbody>{rows.slice(0, 300).map((r) => <tr key={r.id}><td>{day(r.date)}</td><td>{r.party}</td><td>{Certs.validPan(r.pan) ? r.pan : <span className="tag warn">no PAN</span>}</td><td>{r.section}</td><td className="n">{money(r.tds)}</td></tr>)}</tbody></table></div>
    {rows.length > 300 && <p className="note">The first 300 of {rows.length} {unit}.</p>}
    {go && <div className="row" style={{ marginTop: 6 }}>{go}</div>}
  </section>;
}
// the To fix line for challans whose type could not be told (no nature of payment): not placed by themselves; which return?
export const unknownItem = (fy, q) => ({ k: "chtype", n: TDSReg.unknownType(fy, q).length, one: "challan of unknown type: which return?", many: "challans of unknown type: which return?" });
export function UnknownChallans({ fy, q, form }) {
  const list = TDSReg.unknownType(fy, q), [open, setOpen] = useState("");
  if (!list.length) return null;
  return <section className="dash-card" style={{ marginBottom: 12 }} data-unknown-type="">
    <h3>Challans of unknown type</h3>
    <p className="note">These give no nature of payment, so FinCom cannot tell which return they are for and did not allocate them. Use one in this return, or open the register to use it in another.</p>
    <ul className="tch-list">{list.map((c) => <li key={c.id} className="tch-prop" data-unknown-ch={c.id}><div className="tch-line">
      <span>Challan <b>{TDSCH.label(c)}</b> <SrcBadge c={c} /> · {money(TDSReg.balance(c).tax)} left</span>
      <span className="tch-act"><button className="btn small" data-unknown-use={c.id} onClick={() => setOpen(open === c.id ? "" : c.id)}>Use in this return…</button></span></div>
      {open === c.id && <UseBalance c={c} fixed={{ form, fy, q }} onDone={() => setOpen("")} />}</li>)}</ul>
  </section>;
}
// challans this return uses beyond their amount (two people at once, or an old tagging): To fix's line
export const overItem = (fy, q, form) => ({ k: "over", n: TDSReg.overUsed(fy, q, form).length, one: "challan used beyond its amount", many: "challans used beyond their amount" });

/* ---------------------------------------------------------------- Return file: the slot for "Check before filing" */
// ask-fincom's "Check before filing" (parts/PreFile.jsx, PreFileButton) goes here, beside the file's buttons
export const PreFileSlot = ({ children }) => <div className="row" data-prefile-slot="" style={{ gap: 8, margin: "0 0 10px" }}>{children}</div>;

/* ---------------------------------------------------------------- After filing */
export function AfterFiling({ fy, q, form }) {
  const [said, setSaid] = useState([]);
  if (!TDSReg.filed(fy, q, form)) return <p className="note" data-after-filing={form + "|" + q + "|" + fy} data-after-wait="">Available once marked filed (Return file › Mark filed): then the TRACES files for this return, Form 16 / 16A, the justification report and the consolidated file, go here.</p>;
  const pans = new Set(TDS.formRows(form).filter((r) => r.fy === fy && r.q === q).map((r) => String(r.pan || "").toUpperCase()));
  const f16 = TRF.f16().filter((r) => (!r.fy || r.fy === fy) && (!r.q || r.q === q) && pans.has(r.pan));
  const jr = TRF.jrFor(fy, q, form), cs = TRF.consos().filter((c) => c.fy === fy && c.q === q && (c.form || "26Q") === form);
  const uses = TDSReg.uses(), chIds = Object.keys(uses).filter((id) => uses[id][TDSReg.key(form, fy, q)]);
  const cert = form === "24Q" ? TDS.certName(fy) : TDS.isNew(fy) ? "Form 131 (earlier Form 16A)" : "Form 16A";
  return <div data-after-filing={form + "|" + q + "|" + fy}>
    <section className="dash-card">
      <div className="rp-title"><h3>TRACES files for {form} {q} {fy}</h3><span className="note">{cert}, the justification report, the consolidated file and the challan status, as downloaded from TRACES.</span></div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "6px 0 10px" }}>
        <TracesUpload name="traces" label="Upload TRACES files" accept=".zip,.pdf,.txt,.csv,application/zip,application/pdf,text/plain,text/csv" onFiles={async (fs) => setSaid(await TRF.add(fs))} /></div>
      {said.length > 0 && <ul className="note" data-traces-said="" style={{ margin: "0 0 8px 18px", padding: 0 }}>{said.map((s, i) => <li key={i}>{s}</li>)}</ul>}
    </section>
    <section className="dash-card" style={{ marginTop: 12 }} data-after-certs="">
      <h3>{cert}</h3>
      {form === "24Q" ? <p className="note">Form 16 Part B for each employee is under <button className="linkbtn" onClick={() => tdsGoTab(fy, q, "24Q", "people", { paySub: "form16" })}>Employees & declarations › Form 16</button>; Part A comes from TRACES.</p> : null}
      {f16.length ? <ul className="note" style={{ margin: "4px 0 0 18px" }}>{f16.map((c) => <li key={c.id} data-f16-pan={c.pan}><button className="linkbtn" data-f16-get={c.id} onClick={() => TRF.downloadF16(c.id)}>{c.party || c.pan}</button> · {c.pan}{c.cert ? " · " + c.cert : ""}</li>)}</ul>
        : <p className="note">No certificate of this return brought in yet.</p>}
    </section>
    {jr ? <TracesDefaults jr={jr} full /> : <section className="dash-card" style={{ marginTop: 12 }}><h3>Justification report</h3><p className="note">None brought in for this return.</p></section>}
    {cs.length ? cs.map((c) => <Conso key={c.id} c={c} />) : <section className="dash-card" style={{ marginTop: 12 }}><h3>Consolidated file</h3><p className="note">None brought in for this return.</p></section>}
    <TracesCheck filter={{ form, fy, q, chIds }} title="TRACES’ consumed amount against FinCom’s used" />
  </div>;
}
