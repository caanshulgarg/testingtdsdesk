// A return's parts (tds-layout, 13/14-Oct-2026; next-challan-match, 18-Oct-2026; next-tds-clear, 19-Oct-2026: the steps of
// the ClearTax-like layout, tds/Shell.jsx STEPS: Deductor · Deductees · [Employees & declarations, 24Q] · Challans ·
// Deductions · Validate & file · After filing). The step ids stay the old tab ids where the content is the same; the old
// "checks" (To fix) and "file" (Return file) are both Validate & file ("file"); "summary", "employees", "annex2" open
// their new place (tabNow).
import { useState } from "react";
import { Upload as TracesUpload, TracesDefaults, Conso } from "./Files.jsx";
import { UseBalance, SrcBadge, TracesCheck, Said } from "./Register.jsx";
import { ChallanMatch } from "./Match.jsx";
import { STEPS, stepNow, SideDrawer } from "./Shell.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");

export const tabsOf = (form) => STEPS(form);
// a tab asked for (an old id, an old address) to one the form has
export const tabNow = (tab, form) => stepNow(tab, form);
// a salary return's "before filing" checks, each its own short card (Validate & file › Review)
export function checksToFix(checks) {
  return {
    items: checks.map((c, i) => ({ k: "c" + i, n: c.n, one: c.what.toLowerCase(), many: c.what.toLowerCase() })),
    parts: checks.map((c, i) => ["c" + i, <section key={i} className="dash-card" style={{ marginBottom: 12 }}><div className="dash-row"><span>{c.what}</span><b>{c.n}</b></div>
      <p className="note">{c.how}{c.who.length ? " e.g. " + c.who.join(", ") : ""}</p></section>]),
  };
}
export const SalaryChecks = ({ list }) => <>{checksToFix(list || []).parts.map(([k, el]) => <div key={k}>{el}</div>)}</>;

/* ---------------------------------------------------------------- Deductions: by deduction or by deductee */
export function DedSwitch({ unit = "Deductee" }) {
  const v = S.tdsDedView === "deductees" ? "deductees" : "deductions";
  return <nav className="sbar subnav" aria-label="Show" data-ded-view={v}>
    <button aria-selected={v === "deductions"} data-ded-switch="deductions" onClick={() => { S.tdsDedView = ""; render(); }}>By deduction</button>
    <button aria-selected={v === "deductees"} data-ded-switch="deductees" onClick={() => { S.tdsDedView = "deductees"; render(); }}>By {unit.toLowerCase()}</button>
  </nav>;
}

/* ---------------------------------------------------------------- the filed lock: ⋯ › Open a correction… */
export async function openCorrection(fy, q, form) {
  const filed = TDSReg.filed(fy, q, form);
  if (!filed) return;
  const ok = await askConfirm({ title: "Open a correction for " + form + " " + q + " " + fy + "?", ok: "Open a correction",
    body: "The return is marked filed on " + esc(day(filed.on)) + ". Opening a correction lets its challans change; each change goes to the trail. File the correction statement on TRACES, then mark it filed again: that locks the return once more." });
  if (!ok || !ok.ok) return;
  TDSReg.openCorrection(fy, q, form); toast("Correction opened for " + form + " " + q + " " + fy + "."); render();
}
/* ---------------------------------------------------------------- Challans: which challan pays which deduction */
// next-challan-match (the owner, 17-Oct-2026): the one screen of tds/Match.jsx: the challans as cards, the deductions on
// each, the suggestions to confirm, what is not matched yet with its next step, the checks before the file. It replaced
// "This return's challans" with its "Auto-allocate N" and "Add from register" (and the "Suggested tagging" card)
export function ReturnChallans({ fy, q, form, tallyPays }) {
  return <div data-ret-challans={TDSReg.key(form, fy, q)}>
    <Said />
    <ChallanMatch fy={fy} q={q} form={form} tallyPays={tallyPays} />
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
// one table of TRACES' files for the return (design §3.8): Form 16A / 131 (Form 16 for 24Q), the justification report,
// the consolidated file and the challan status, each with its status; a row opens its drawer
export function AfterFiling({ fy, q, form }) {
  const [said, setSaid] = useState([]), [open, setOpen] = useState("");
  const filed = TDSReg.filed(fy, q, form);
  if (!filed) return <p className="note" data-after-filing={form + "|" + q + "|" + fy} data-after-wait="">Available once marked filed (Validate & file › Mark filed): then the TRACES files for this return, Form 16 / 16A, the justification report and the consolidated file, go here.</p>;
  const pans = new Set(TDS.formRows(form).filter((r) => r.fy === fy && r.q === q).map((r) => String(r.pan || "").toUpperCase()));
  const f16 = TRF.f16().filter((r) => (!r.fy || r.fy === fy) && (!r.q || r.q === q) && pans.has(r.pan));
  const jr = TRF.jrFor(fy, q, form), cs = TRF.consos().filter((c) => c.fy === fy && c.q === q && (c.form || "26Q") === form);
  const uses = TDSReg.uses(), chIds = Object.keys(uses).filter((id) => uses[id][TDSReg.key(form, fy, q)]);
  const cert = form === "24Q" ? TDS.certName(fy) : TDS.isNew(fy) ? "Form 131 (earlier Form 16A)" : "Form 16A";
  const ft = TDSFiled.get(fy, q, form);
  const rows = [
    ["certs", cert, f16.length ? f16.length + " of " + pans.size : "none yet", f16.length ? "ok" : ""],
    ["jr", "Justification report", jr ? (jr.items.length ? jr.items.length + " default" + (jr.items.length === 1 ? "" : "s") : "no defaults") : "none yet", jr ? (jr.items.length ? "bad" : "ok") : ""],
    ["conso", "Consolidated file", cs.length ? "received" : "none yet", cs.length ? "ok" : ""],
    ["chstatus", "Challan status (TRACES against FinCom)", chIds.length + " challan" + (chIds.length === 1 ? "" : "s"), ""],
  ].concat(form === "24Q" ? [["f16b", "Form 16 Part B", "Employees & declarations", ""]] : []);
  const body = (k) => k === "certs" ? <div data-after-certs="">{f16.length ? <ul className="note" style={{ margin: "4px 0 0 18px" }}>{f16.map((c) => <li key={c.id} data-f16-pan={c.pan}><button className="linkbtn" data-f16-get={c.id} onClick={() => TRF.downloadF16(c.id)}>{c.party || c.pan}</button> · {c.pan}{c.cert ? " · " + c.cert : ""}</li>)}</ul>
      : <p className="note">No certificate of this return brought in yet.</p>}</div>
    : k === "jr" ? (jr ? <TracesDefaults jr={jr} full /> : <p className="note">None brought in for this return.</p>)
    : k === "conso" ? (cs.length ? cs.map((c) => <Conso key={c.id} c={c} />) : <p className="note">None brought in for this return.</p>)
    : k === "chstatus" ? <TracesCheck filter={{ form, fy, q, chIds }} title="TRACES’ consumed amount against FinCom’s used" /> : null;
  const sel = rows.find((r) => r[0] === open);
  return <div data-after-filing={form + "|" + q + "|" + fy}>
    <div className="rt-tool" data-step-tool="">
      <span className="note">Filed {day(ft ? ft.on : filed.on)}{ft && ft.token ? " · token " + ft.token : ""}</span><span className="rt-sp" />
      <TracesUpload name="traces" label="Upload TRACES files" accept=".zip,.pdf,.txt,.csv,application/zip,application/pdf,text/plain,text/csv" onFiles={async (fs) => setSaid(await TRF.add(fs))} /></div>
    {said.length > 0 && <ul className="note" data-traces-said="" style={{ margin: "0 0 8px 18px", padding: 0 }}>{said.map((s, i) => <li key={i}>{s}</li>)}</ul>}
    <div className="bk-tablewrap"><table className="bk-table rt-rows" data-after-table="">
      <thead><tr><th>From TRACES</th><th>Status</th><th className="ac"></th></tr></thead>
      <tbody>{rows.map(([k, l, st, tone]) => <tr key={k} data-after-row={k}><td>{l}</td><td>{tone ? <span className={"tag " + tone}>{st}</span> : <span className="note">{st}</span>}</td>
        <td className="ac">{k === "f16b" ? <button className="linkbtn" onClick={() => tdsGoTab(fy, q, "24Q", "people", { paySub: "form16" })}>Open ▸</button>
          : <button className="linkbtn" data-after-open={k} onClick={() => setOpen(k)}>View ▸</button>}</td></tr>)}</tbody></table></div>
    <SideDrawer open={!!sel} onClose={() => setOpen("")} kind="traces" wide title={sel ? sel[1] : ""} description={form + " " + q + " " + fy}>{sel ? body(sel[0]) : null}</SideDrawer>
  </div>;
}
