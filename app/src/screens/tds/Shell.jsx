// A TDS return's frame (next-tds-clear, 19-Oct-2026: "like ClearTax, not cluttered"; round 94, next-tds-clean: tabs
// across the top, no F-keys, every figure once). Above the step's own content:
//   1. one header line: ← back · the return's name · due · its status chip · the one problem count ("N to fix") · ⋯
//      (All challans of the year first) · ONE primary button naming the next step ("Next: Challans →")
//   2. one row of tabs (Deductor · Deductees N · [Employees & declarations] · Challans N · Deductions N · Validate &
//      file · After filing): a count only, a dot for a step with a problem; on a phone a select
//   (next-tds-tidy2, 20-Oct-2026; the owner: "TDS ₹… · On challans ₹… · Left ₹0.00 — we don't need that": no summary
//   strip; the TDS is in the Deductees table's foot, what is on challans in the Challans grid's, a TDS left off a challan
//   is in the "N to fix" count)
// The problem count is the Validate & file panel's (tds/Validate.jsx: errors + warnings), shown once, in the header.
// The status words are one vocabulary everywhere (STATUS, the TDS home's grid too).
import { Panel } from "../../parts/DetailDrawer.jsx";
import More from "../../parts/More.jsx";
import { Lock as LockIcon } from "lucide-react";
import "./clear.css";
import { openAllChallans } from "./AllChallans.jsx";

const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
export const Q_MON = { Q1: "Apr–Jun", Q2: "Jul–Sep", Q3: "Oct–Dec", Q4: "Jan–Mar" };

// the one status vocabulary (home grid, header chip): [word, tone]
export const STATUS = {
  none: ["Not started", ""], prog: ["In progress", "warn"], ready: ["Ready", "info"],
  fvu: ["FVU made", "info"], filed: ["Filed", "ok"], processed: ["Processed", "ok"],
};

// "FVU made": the day the FVU text file of a return was last made here (kept with the books; the file itself is not
// changed by it)
export const FvuMade = {
  key: (fy, q, form) => fy + "|" + q + "|" + (form || "26Q"),
  get(fy, q, form) { return ((S.books || {}).tdsFvu || {})[this.key(fy, q, form)] || null; },
  mark(fy, q, form) {
    if (!S.books) return;
    S.books.tdsFvu = Object.assign({}, S.books.tdsFvu || {}, { [this.key(fy, q, form)]: { at: new Date().toISOString(), by: (S.user && S.user.email) || "" } });
    try { saveBooks(); } catch (e) { /* kept in the page until the next save */ }
  },
};
// the previous return's token (PRN), typed on Validate & file (kept for the correction or the next return; an original
// statement's file does not carry it)
export const PrevPrn = {
  get(fy, q, form) { return ((S.books || {}).tdsPrn || {})[FvuMade.key(fy, q, form)] || ""; },
  set(fy, q, form, v) {
    if (!S.books) return;
    S.books.tdsPrn = Object.assign({}, S.books.tdsPrn || {}, { [FvuMade.key(fy, q, form)]: String(v || "").replace(/\s/g, "") });
    try { saveBooks(); } catch (e) { /* */ }
  },
};

// a return's status from what it has and its checks: filed (processed once TRACES' consolidated file or justification
// report is in), a filed return changed in Tally since or with errors -> In progress, FVU made, Ready (no error) or
// In progress; nothing in it -> Not started
export function statusOf({ fy, q, form, has, errors, drift, problems = 0 }) {
  if (!has) return "none";
  const f = TDSFiled.get(fy, q, form);
  if (f) {
    if (drift) return "prog";
    let done = false;
    try { done = TRF.consos().some((c) => c.fy === fy && c.q === q && (c.form || "26Q") === form) || !!TRF.jrFor(fy, q, form); } catch (e) { /* */ }
    return done ? "processed" : "filed";
  }
  // Ready only with nothing to fix: no error and no warning (the coordinator's review, 19-Oct-2026)
  if (errors > 0 || problems > 0) return "prog";
  return FvuMade.get(fy, q, form) ? "fvu" : "ready";
}

export function StatusChip({ st, title, ...rest }) {
  const [w, tone] = STATUS[st] || STATUS.none;
  return <span className={"tag " + tone} data-status={st} title={title} {...rest}>{(st === "filed" || st === "processed") && <LockIcon width={11} height={11} aria-hidden="true" style={{ marginRight: 3, verticalAlign: "-1px" }} />}{w}</span>;
}

// the steps of a return: [id, label]; 24Q adds Employees & declarations
export const STEPS = (form) => [["deductor", "Deductor"], ["deductees", form === "24Q" ? "Employees (PAN)" : form === "27EQ" ? "Buyers (PAN)" : "Deductees"]]
  .concat(form === "24Q" ? [["people", "Employees & declarations"]] : [])
  .concat([["challans", "Challans"], ["deductions", form === "27EQ" ? "Collections" : "Deductions"], ["file", "Validate & file"], ["after", "After filing"]]);
// a step asked for (an old tab id, an old address) to one the form has
export function stepNow(tab, form) {
  const t = { summary: "deductions", entries: "deductions", employees: "deductions", checks: "file", annex2: form === "24Q" ? "people" : "deductions", salary: form === "24Q" ? "people" : "deductions" }[tab] || tab;
  return STEPS(form).some(([id]) => id === t) ? t : "deductions";
}
export const stepName = (id, form) => (STEPS(form).find((x) => x[0] === id) || [id, id])[1];
// the next step after this one (the header's primary)
export function nextStep(cur, form, filed) {
  const ids = STEPS(form).map((x) => x[0]), i = ids.indexOf(cur);
  if (cur === "file") return filed ? "after" : "";
  if (cur === "after") return "";
  return ids[i + 1] === "after" && !filed ? "" : ids[i + 1] || "";
}

// a right-hand drawer kept in the page (#app), for a row's or a check's details: the app's one side panel (parts/DetailDrawer's
// Panel: ✕, Cancel, Esc, a click outside and Back close it at once; draft: a useDraft() for what was typed and not saved)
export function SideDrawer({ open, onClose, title, description, kind, wide, draft, children }) {
  return <Panel open={!!open} onClose={() => onClose()} title={title} description={description} wide={wide} draft={draft}
    cls="rt-drawer" attrs={{ "data-drawer": kind || "" }}>{children}</Panel>;
}

// the frame (round 94, 19-Oct-2026; the owner: "Deductor, Deductee, Challan, Deduction can come horizontally; remove
// double info anywhere"). steps: [{id, label, count, off, why}]; (round 94's strip is gone, next-tds-tidy2);
// val: the Validate panel's {errors, warnings}: the header's "N to fix" is the one problem count; a step's tab carries a
// dot (red: an error of that step, amber: a warning), never a number of problems. primary: [label, onClick] or null.
// No keys of its own (round 88's F8 / F10 / F11 / F12 and the tabs at the foot are gone).
const dotOf = (id, val) => {
  if (!val) return "";
  const of = (l) => l.some((x) => x.n > 0 && (id === "file" ? true : x.step === id));
  return of(val.errors) ? "bad" : of(val.warnings) ? "warn" : "";
};
export function ReturnShell({ fy, q, form, status, statusTitle, draft, val, primary, more = [], steps, children }) {
  const cur = S.tdsTab, n = val ? val.errors.length + val.warnings.length : 0, filedOn = TDSFiled.get(fy, q, form);
  const go = (id) => { tdsTabGo(id); try { window.scrollTo(0, 0); } catch (e) { /* */ } };
  const nxt = primary === undefined ? nextStep(cur, form, !!filedOn) : null;
  const prim = primary !== undefined ? primary : nxt ? ["Next: " + stepName(nxt, form) + " →", () => go(nxt)] : null;
  const moreAll = [["All challans of " + fy, () => openAllChallans(fy, { fy, q, form }), { "data-ret-allch": "" }]].concat(more);
  return <div className={"rt" + (cur === "deductions" && S.tdsDedView === "table" ? " rt-compact" : "")} data-return={form + "|" + q + "|" + fy}>
    <header className="rt-head" data-return-card={form + "|" + q}>
      <button className="linkbtn ret-back" onClick={() => tdsGo(fy)} aria-label={"Back to TDS " + fy} title={"Back to TDS " + TDS.yearWord(fy) + " " + fy}>← TDS {fy}</button>
      <h2 className="rt-title" data-return-title="">{TDS.formShort(form, fy)} · {q} ({Q_MON[q]})</h2>
      <span className="rt-due" title={TDS.FORM_ABOUT[form] || ""}>due {TDS.dueWords(fy, q, form)}</span>
      <StatusChip st={status} title={statusTitle || (filedOn ? "Filed " + day(filedOn.on) + ": its challans are locked" : undefined)} data-status-tag="" data-ret-lock={filedOn ? (TDSReg.corrOpen(fy, q, form) ? "correction" : "locked") : undefined} />
      {n > 0 && <button type="button" className={"rt-prob" + (val.errors.length ? " bad" : "")} data-problem-count={n} title={val.errors.length + " errors, " + val.warnings.length + " warnings (Validate & file)"} onClick={() => go("file")}>{n} to fix</button>}
      <span className="rt-sp" />
      <More label="⋯" ariaLabel="More" items={moreAll} />
      {prim && <button className="btn small primary" data-card-primary="" onClick={prim[1]}>{prim[0]}</button>}
    </header>
    <nav className="rt-tabs" role="tablist" aria-label="Return" data-return-tabs="" data-no-why="">
      {steps.map((s) => { const dot = dotOf(s.id, val); return <button key={s.id} type="button" role="tab" className="rt-tab" data-ret-tab={s.id} aria-selected={cur === s.id} aria-current={cur === s.id ? "step" : undefined}
        disabled={s.off} title={s.off ? s.why : undefined} onClick={() => go(s.id)}>
        <span className="rt-tl">{s.label}</span>{s.count != null && s.id !== "file" ? <span className="rt-tc" data-tab-count={s.id}>{s.count}</span> : null}
        {dot ? <span className={"rt-dot2 " + dot} data-tab-dot={dot} role="img" aria-label={dot === "bad" ? "has errors" : "has warnings"} /> : null}
      </button>; })}
    </nav>
    <label className="rt-railsel"><span className="sr-only">Step</span>
      <select aria-label="Step" data-ret-select="" value={cur} onChange={(ev) => go(ev.target.value)}>
        {steps.map((s, i) => <option key={s.id} value={s.id} disabled={s.off}>{i + 1}. {s.label}{s.id !== "file" && s.count != null ? " · " + s.count : ""}</option>)}</select></label>
    <div className="rt-main" data-ret-step={cur}>{children}</div>
  </div>;
}
