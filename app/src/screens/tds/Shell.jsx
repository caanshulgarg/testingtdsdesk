// A TDS return's frame in the ClearTax-like layout (next-tds-clear, 19-Oct-2026; the owner: TDS "like ClearTax, not
// cluttered"; design: scratchpad tds-cleartax-design.md §3.2). Above the step's own content there are at most three bands:
//   1. one header line: ← back · the return's name · due · its status chip (and Draft for a 2025-Act form) · the one
//      problem count · ⋯ · ONE primary button naming the next step ("Next: Challans →")
//   2. one summary strip: TDS · on challans · left to match
//   3. the step's own toolbar (inside the step)
// and a step rail on the left (Deductor · Deductees · [Employees & declarations] · Challans · Deductions · Validate &
// file · After filing), each step with its count and at most one problem line; on a phone the rail is a select.
// The problem count is the Validate & file panel's (tds/Validate.jsx: errors + warnings): the header's badge and the
// rail's are that one number. The status words are one vocabulary everywhere (STATUS, the TDS home's grid too).
import { useRef, useEffect } from "react";
import { Drawer, DrawerContent } from "@/registry/components/drawer/drawer";
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

// a right-hand drawer kept in the page (#app), for a row's or a check's details
export function SideDrawer({ open, onClose, title, description, kind, wide, children }) {
  const last = useRef(null);
  if (open) last.current = { title, description, children };
  const shown = last.current;
  return <Drawer open={!!open} onOpenChange={(o) => { if (!o) onClose(); }}>
    <DrawerContent className={"ddraw rt-drawer" + (wide ? " ddraw-wide" : "")} data-drawer={kind || ""} title={(shown && shown.title) || ""}
      description={(shown && shown.description) || undefined} closeLabel="Close" aria-describedby={undefined}
      portal={document.getElementById("app")} onEscapeKeyDown={(ev) => { ev.preventDefault(); onClose(); }}>
      {shown ? shown.children : null}
    </DrawerContent>
  </Drawer>;
}

// round 88 (as Winman): the four tabs at the foot of a return, and its keys: F8 Deductor, F10 Challans, F11 Deductees, F12 Deductions
export const FOOT_KEYS = { F8: "deductor", F10: "challans", F11: "deductees", F12: "deductions" };
export function footKey(ev) {
  if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
  const id = FOOT_KEYS[ev.key];
  if (!id || S.tdsView !== "return") return;
  ev.preventDefault(); tdsTabGo(id); try { window.scrollTo(0, 0); } catch (e) { /* */ }
}
export function FootTabs({ steps }) {
  const cur = S.tdsTab, keyOf = { deductor: "F8", deductees: "F11", challans: "F10", deductions: "F12" };
  const tabs = ["deductor", "deductees", "challans", "deductions"].map((id) => steps.find((s) => s.id === id)).filter(Boolean);
  return <nav className="rt-foot" aria-label="Return parts" data-ret-foot="">
    {tabs.map((s) => <button key={s.id} type="button" className={"rt-ft" + (cur === s.id ? " on" : "")} data-foot-tab={s.id} aria-current={cur === s.id ? "page" : undefined}
      title={s.label + " (" + keyOf[s.id] + ")"} onClick={() => { tdsTabGo(s.id); try { window.scrollTo(0, 0); } catch (e) { /* */ } }}>{s.label}<small className="rt-fk">{keyOf[s.id]}</small></button>)}
  </nav>;
}

// the frame. steps: [{id, label, count, done, sub: {text, bad}, off, why}]; strip: [{label, value, sub, bad}]
// val: the Validate panel's {errors, warnings} (the one problem count); primary: [label, onClick] or null
export function ReturnShell({ fy, q, form, status, statusTitle, draft, val, primary, more = [], strip = [], steps, children, progress }) {
  const cur = S.tdsTab, n = val ? val.errors.length + val.warnings.length : 0, filedOn = TDSFiled.get(fy, q, form);
  const go = (id) => { tdsTabGo(id); try { window.scrollTo(0, 0); } catch (e) { /* */ } };
  const nxt = primary === undefined ? nextStep(cur, form, !!filedOn) : null;
  const prim = primary !== undefined ? primary : nxt ? ["Next: " + stepName(nxt, form) + " →", () => go(nxt)] : null;
  useEffect(() => { window.addEventListener("keydown", footKey); return () => window.removeEventListener("keydown", footKey); }, []);
  return <div className={"rt" + (cur === "deductions" && S.tdsDedView === "table" ? " rt-compact" : "")} data-return={form + "|" + q + "|" + fy}>
    <header className="rt-head" data-return-card={form + "|" + q}>
      <button className="linkbtn ret-back" onClick={() => tdsGo(fy)} aria-label={"Back to TDS " + fy} title={"Back to TDS " + TDS.yearWord(fy) + " " + fy}>← TDS {fy}</button>
      <h2 className="rt-title" data-return-title="">{TDS.formShort(form, fy)} · {q} ({Q_MON[q]})</h2>
      <span className="rt-due" title={TDS.FORM_ABOUT[form] || ""}>due {TDS.dueWords(fy, q, form)}</span>
      <StatusChip st={status} title={statusTitle || (filedOn ? "Filed " + day(filedOn.on) + ": its challans are locked" : undefined)} data-status-tag="" data-ret-lock={filedOn ? (TDSReg.corrOpen(fy, q, form) ? "correction" : "locked") : undefined} />
      {n > 0 && <button type="button" className={"rt-prob" + (val.errors.length ? " bad" : "")} data-problem-count={n} title={val.errors.length + " errors, " + val.warnings.length + " warnings (Validate & file)"} onClick={() => go("file")}>{n} to fix</button>}
      {progress && <span className="rt-progress" data-ret-progress={progress.done + "/" + progress.of} title="On a challan, with a valid PAN and no rate question">Done: {progress.done} of {progress.of} ready</span>}
      <span className="rt-sp" />
      <button type="button" className="btn small" data-ret-allch="" onClick={() => openAllChallans(fy, { fy, q, form })}>All challans of {fy}</button>
      <More label="⋯" ariaLabel="More" items={more} />
      {prim && <button className="btn small primary" data-card-primary="" onClick={prim[1]}>{prim[0]}</button>}
    </header>
    {strip.length > 0 && <div className="rt-strip" data-ret-strip="">{strip.map((f) => <span key={f.label} className={"rt-fig" + (f.bad ? " bad" : "")} data-fig={f.label}>
      <span className="rt-fl">{f.label}</span> <b>{f.value}</b>{f.sub ? <small> · {f.sub}</small> : null}</span>)}</div>}
    <div className="rt-body">
      <nav className="rt-rail" aria-label="Return" data-return-tabs="">
        {steps.map((s, i) => <button key={s.id} type="button" className={"rt-step" + (cur === s.id ? " on" : "")} data-ret-tab={s.id} aria-selected={cur === s.id} aria-current={cur === s.id ? "step" : undefined}
          disabled={s.off} aria-description={s.off ? s.why : undefined} title={s.off ? undefined : s.label} onClick={() => go(s.id)}>
          <span className="rt-i" aria-hidden="true">{i + 1}</span><span className="rt-l">{s.label}</span>
          <span className={"rt-c" + (s.id === "file" && n ? (val.errors.length ? " bad" : " warn") : "")} data-rail-count={s.id} {...(s.id === "file" ? { "data-rail-problems": n } : {})}>{s.id === "file" ? (n ? n : "✓") : s.done ? "✓" : s.count != null ? s.count : ""}</span>
          {s.off && !s.sub ? <span className="rt-sub" data-rail-sub={s.id}>once filed</span> : null}{s.sub && s.sub.text ? <span className={"rt-sub" + (s.sub.bad ? " bad" : " warn")} data-rail-sub={s.id}>{s.sub.text}</span> : null}
        </button>)}
      </nav>
      <label className="rt-railsel"><span className="sr-only">Step</span>
        <select aria-label="Step" data-ret-select="" value={cur} onChange={(ev) => go(ev.target.value)}>
          {steps.map((s, i) => <option key={s.id} value={s.id} disabled={s.off}>{i + 1}. {s.label}{s.id === "file" ? (n ? " · " + n + " to fix" : "") : s.count != null ? " · " + s.count : ""}</option>)}</select></label>
      <div className="rt-main" data-ret-step={cur}>{children}</div>
    </div>
    <FootTabs steps={steps} />
  </div>;
}
