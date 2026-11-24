// Income Tax Return (AY 2026-27): a client's return worked out from the books, checked the way a CA reviewer would,
// and given as the official ITR JSON (ITR-3, 4, 5, 6) for the owner's income tax software (Winman imports it).
// Four steps, each a books tab for its address: books:itr (Data), itr-comp (Computation), itr-checks (Checks), itr-json.
// One lazy chunk (screens/itr, imported by Books.jsx); nothing of it in the app's first file or in legacy.js.
// docs/ITR-MODULE.md has the design, the sources, the rules and the owner's decisions.
import { useEffect, useMemo, useState } from "react";
import "./itr.css";
import "../../lib/finGlobals.js";
// the 3CD draft the checks read (Audit.form3cd) comes with the Audit screen's file (src/js/77-audit.js), not in legacy.js
import "../../../../src/js/77-audit.js";
import { makeStore, appDeps, fileIn, AY_KEY } from "../../lib/itr/store.js";
import { LABEL } from "../../lib/itr/imports.js";
import { importsOf, buildModel, buildProfile } from "../../lib/itr/model.js";
import { ALL_FORMS, JSON_FORMS, recommendForm, chosenForm, formStatus, factsOf } from "../../lib/itr/pick.js";
import { compute, compareRegimes, fmtDate } from "../../lib/itr/tax.js";
import { check, differences } from "../../lib/itr/check.js";
import { verify, gate, GROUPS, isOpen } from "../../lib/itr/verify.js";
import { fromApp } from "../../lib/itr/books.js";
import { gstData, pfBooks, clientOf } from "../../lib/itr/appData.js";
import { makeJson, report, VERSION } from "../../lib/itr/json.js";
import { SCHEMA_FILES } from "../../lib/itr/forms.js";
import { rows as sheetRows, money, openPdf, workbook } from "../../lib/itr/sheet.js";
import Schedules from "./Schedules.jsx";

const STEPS = [["itr", "Data"], ["itr-sch", "Schedules"], ["itr-comp", "Computation"], ["itr-checks", "Checks"], ["itr-json", "JSON"]];
const STATUS = { matched: ["Matched", "ok"], difference: ["Difference", "bad"], missing: ["Missing data", "warn"], needs: ["Needs you", "warn"] };
const redraw = () => { try { if (typeof render === "function") render(); } catch (e) { /* the next drawing shows it */ } };
const go = (t) => goClient("books:" + t);
const ymdIn = (d) => (d ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : "");
const ymdOut = (s) => String(s || "").replace(/-/g, "");
const R0 = (v) => Math.round(+v || 0);

// the schema from this site (itr-schema/, put there at publish time); kept for the page
const schemas = {};
function useSchema(form) {
  const [, tick] = useState(0);
  const file = SCHEMA_FILES[form];
  useEffect(() => {
    if (!file || schemas[file]) return;
    schemas[file] = { loading: true };
    const url = (window.__itrSchemaBase || new URL("itr-schema/", document.baseURI).href) + file;
    fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))).then((j) => { schemas[file] = { schema: j }; tick((x) => x + 1); },
      (e) => { schemas[file] = { error: String((e && e.message) || e) }; tick((x) => x + 1); });
  }, [file]);
  return schemas[file] || { loading: true };
}

// a demo (tests and the design screenshots only: window.__itrDemo, made-up data) or the app's own
function demoDeps(D) {
  return { books: () => D.booksObj, save: async () => { D.saves = (D.saves || 0) + 1; }, clients: () => D.clients, open: () => Object.assign({}, D.clients[0], D.booksObj.itr[AY_KEY + "|state"] && { pfCode: D.booksObj.itr[AY_KEY + "|state"].pfCode, esiCode: D.booksObj.itr[AY_KEY + "|state"].esiCode }),
    firm: () => D.firm || "", user: () => "Owner", now: () => new Date().toISOString(),
    sha: async (bytes) => { const h = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, "0")).join(""); },
    upload: async (path) => { (D.uploads = D.uploads || []).push(path); return { ok: true, path }; }, remove: async (path) => { (D.removed = D.removed || []).push(path); } };
}

// everything the page shows, worked out once a drawing: the books, the model, both computations, the JSON (once the
// official schema is in) and the checks (which take the JSON's coverage: a schedule with figures FinCom does not fill)
function useItr() {
  const D = window.__itrDemo || null;
  const store = useMemo(() => makeStore(D ? demoDeps(D) : appDeps()), [D]);
  const client = D ? D.client : clientOf();
  const files = store.files(), state = store.state(), imports = importsOf(files);
  const booksRev = D ? 0 : (typeof BOOKS_REV === "number" ? BOOKS_REV : 0);
  const entity = client.entity;
  const due = state.tp ? "20261130" : (state.audit || entity === "C") ? "20261031" : "20260831";
  const books = useMemo(() => (D ? D.books : fromApp(String(+AY_KEY - 1), imports, due)), [D, booksRev, files.length, due]);
  // the form: recommended from the kind of person and the income known (pick.js), the person's own choice kept
  const facts = factsOf(client, state, books, imports), prev = store.state(String(+AY_KEY - 1));
  const make = (form) => { const m = buildModel({ entity, client, state: Object.assign({}, state, { form }), books, imports, due, prevState: prev }); return { form, model: m, comp: compute(m) }; };
  let rec = recommendForm(facts), w = make(chosenForm(state, rec));
  // the total income (ITR-1 / ITR-4 within Rs 50 lakh) and the gains are known only once worked out: asked again
  rec = recommendForm(Object.assign({}, facts, { ti: w.comp.ti, capitalGains: gainsOf(w.model) }));
  const form = chosenForm(state, rec);
  if (form !== w.form) w = make(form);
  const model = w.model, comp = w.comp, second = check(model), fstat = formStatus(form, rec);
  const profile = buildProfile({ entity, client, state, imports });
  const sch = useSchema(fstat.json ? form : "");
  const gst = D ? D.gst : gstData(String(+AY_KEY - 1), books);
  const bk = books && books.ok ? books : null;
  const gstTurnover = gst && gst.ok ? (gst.perGstin || (client.gstin && gst.filedR1 != null ? [{ gstin: client.gstin, amt: gst.filedR1 }] : [])) : [];
  // a form FinCom's JSON does not cover, or one not for this kind of person: no JSON at all (never another form's)
  const json = fstat.json && sch.schema ? makeJson({ form, schema: sch.schema, model, comp, sched: bk ? bk.sched : null, profile, answers: (state.answers || {})[form] || {}, today: new Date().toISOString().slice(0, 10),
    dues43B: model.dues43B || [], gstTurnover, gstRegistered: !!client.gstin }) : null;
  const checks = verify({ model, main: comp, imports, books, gst, tds: bk ? bk.tds : null, form3cd: bk ? bk.form3cd : null, pfBooks: pfBooks(books), esiBooks: bk ? bk.esiBooks : null, pfAdminCharges: state.pfAdmin,
    pf36va: model.pf36va, dues43B: bk ? model.dues43B : null, msme: bk ? model.msme : null, prior43B: model.prior43B, pfProof: bk ? bk.pfProof : null, due, answers: state.paidOn || {},
    nrAsk: bk ? bk.nrAsk : [], coverage: json ? json.coverage : [], accepted: state.accepted || {} });
  return { D, store, client, files, state, imports, books, facts, form, rec, fstat, model, profile, comp, second, checks, sch, json };
}
// what the recommendation needs to know (pick.js factsOf), before the computation
// capital gains other than 112A up to Rs 1.25 lakh (ITR-1 and ITR-4 take only those)
function gainsOf(M) { const g = M.cg; return !!g && !!(+g.s111A || +g.s112 || +g.other || +g.s112A > 125000); }

export default function ITR() {
  const [, tick] = useState(0);
  const refresh = () => { tick((x) => x + 1); redraw(); };
  const X = useItr(), sch = X.sch, json = X.json;
  const tab = typeof booksTab === "function" ? booksTab() : "itr";
  const step = STEPS.some(([k]) => k === tab) ? tab : "itr";
  // on a phone the steps scroll sideways: the one open is brought into view (every hook before any early return)
  useEffect(() => { try { const e = document.querySelector("[data-itr-tab][data-on='1']"); if (e && e.scrollIntoView) e.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (x) { /* only a nicety */ } }, [step]);
  const co = typeof CO === "function" ? CO() : null;
  if (!co && !window.__itrDemo) return null;
  const g = gate(X.checks, json ? (json.asks.length ? { ok: false, errors: json.asks.map((a) => ({ path: a.path, msg: "to answer" })) } : json.schema) : null);
  const open = X.checks.filter(isOpen);
  // the kind of taxpayer: none shown until it is known (no PAN, no kind chosen)
  const ent = { P: "Individual", H: "HUF", F: X.model.llp === true ? "LLP" : X.model.llp === false ? "Firm" : "Firm or LLP", C: "Company", A: "AOP", B: "BOI", J: "Artificial juridical person", L: "Local authority", G: "Government", T: "Trust" }[X.rec.code] || "";
  const sub = [ent, X.client.pan].filter(Boolean).join(" · ");
  return <div className="itr" data-itr="" data-itr-step={step}>
    <header className="itr-head">
      <div>
        <div className="itr-eyebrow">AY 2026-27 · FY 2025-26</div>
        <h1>{X.rec.code || X.state.formSet ? X.form : "ITR form not picked"}{sub && <span className="itr-sub" data-itr-kind={X.rec.code || ""}>{" " + sub}</span>}</h1>
      </div>
      <div className="itr-head-r">
        {g.ok ? <span className="itr-chip" data-tone="ok" data-itr-ready="">JSON ready</span> : <span className="itr-chip" data-tone="warn" data-itr-open={open.length}>{open.length ? open.length + " to look at" : "Not ready"}</span>}
      </div>
    </header>
    <FormPick X={X} refresh={refresh} />
    <nav className="itr-steps" role="tablist" aria-label="Return steps">
      {STEPS.map(([k, label], i) => {
        const badge = k === "itr-checks" ? (open.length || "") : k === "itr-json" ? (g.ok ? "✓" : "") : k === "itr" ? (X.files.length ? X.files.length : "") : "";
        return <button key={k} role="tab" aria-selected={step === k} className="itr-step" data-itr-tab={k} data-on={step === k ? "1" : "0"} onClick={() => go(k)}>
          <span className="itr-step-n">{i + 1}</span><span>{label}</span>{badge !== "" && <span className="itr-step-b">{badge}</span>}</button>;
      })}
    </nav>
    {step === "itr" ? <DataStep X={X} refresh={refresh} />
      : step === "itr-sch" ? <Schedules X={X} refresh={refresh} schema={sch.schema || null} />
      : step === "itr-comp" ? <CompStep X={X} />
      : step === "itr-checks" ? <ChecksStep X={X} refresh={refresh} />
      : <JsonStep X={X} json={json} sch={sch} g={g} refresh={refresh} />}
  </div>;
}

// ---------------- the form ----------------
// on every step: the form in use, the recommended one with its reason, the person's choice (kept per client per year)
const yn = (v) => (v === true ? "y" : v === false ? "n" : "");
const ny = (v) => (v === "y" ? true : v === "n" ? false : undefined);
function FormPick({ X, refresh }) {
  const rec = X.rec, fs = X.fstat, code = rec.code, set = (p) => { X.store.setState(p); refresh(); };
  const exemptQ = "CTABJLG".includes(code || "-"), presQ = (code === "P" || code === "H" || (code === "F" && X.state.llp !== true));
  // rule 12 (pick.js): an individual is asked what rules ITR-1 and ITR-4 out (unanswered: ITR-2, or ITR-3 for business
  // income); a HUF with presumptive income the same for ITR-4; a firm (not an LLP) with it the unlisted shares and the
  // agricultural income (unanswered: ITR-5)
  const Q12 = [["director", "A director in a company at any time in the year"], ["unlisted", "Held unlisted equity shares at any time in the year"], ["agriOver", "Agricultural income above Rs 5,000"]];
  // the residential status (individuals and HUFs; ITR-1 and ITR-4 need Resident), kept as the return's own
  // (state.resident); firm or LLP (a firm PAN: ITR-4 only for a partnership firm), kept where Data keeps it (state.llp)
  const resQ = code === "P" || code === "H", llpQ = code === "F";
  const llpV = X.facts.llp === true ? "llp" : X.facts.llp === false ? "firm" : "";
  // Schedule FA rows left after assets outside India was answered No: they bar ITR-1 and ITR-4 while they are there
  const faLeft = rec.faLeft && "PHF".includes(code || "-");
  // asked too when ITR-4 is chosen by hand: its JSON waits for the answers (formStatus)
  const pres = !!(X.facts && X.facts.presumptive) || X.form === "ITR-4";
  // a HUF and a firm are not asked about a director (rule 12: "a person who is a director"; a HUF cannot be one, the
  // review of 24-Nov-2026 (3))
  const q1 = code === "P" ? Q12 : (code === "H" || (code === "F" && X.facts.llp !== true)) && pres ? Q12.slice(1) : [];
  const tag = (f) => (code && f === rec.form ? " (recommended)" : code && !rec.allowed.includes(f) ? " (not for this client)" : !JSON_FORMS.includes(f) ? " (no JSON yet)" : "");
  return <section className="itr-pick" data-itr-pick="" data-fits={fs.fits ? "1" : "0"} data-json={fs.json ? "1" : "0"}>
    <div className="itr-pick-row">
      <label className="itr-pick-f"><span>ITR form</span>
        <select data-itr-form="" value={code || X.state.formSet ? X.form : ""} onChange={(e) => set({ form: e.target.value, formSet: true })}>{!code && !X.state.formSet && <option value="" disabled>Choose a form</option>}{ALL_FORMS.map((f) => <option key={f} value={f}>{f + tag(f)}</option>)}</select></label>
      {code ? <p className="itr-pick-why" data-itr-why=""><b>{"Recommended: " + rec.form + "."}</b>{" " + rec.why}</p> : <p className="itr-pick-why" data-itr-why=""><b>No form recommended yet.</b></p>}
      {code && X.form !== rec.form && <button className="linkbtn" data-itr-use-rec="" onClick={() => set({ form: "", formSet: false })}>{"Use " + rec.form}</button>}
    </div>
    {fs.text && <p className="itr-pick-warn" data-itr-form-warn="" data-tone={fs.tone} role="status">{fs.text}</p>}
    {faLeft && <p className="itr-pick-warn" data-itr-fa-left="" data-tone="info" role="status">{"Schedule FA has " + X.facts.faRows + (X.facts.faRows === 1 ? " row" : " rows") + ", but assets outside India is not answered Yes. While " + (X.facts.faRows === 1 ? "it is" : "they are") + " there, ITR-1 and ITR-4 do not fit. "}
      <button className="linkbtn" data-itr-fa-remove="" onClick={() => set({ fa: {} })}>Remove these rows</button></p>}
    {(exemptQ || presQ || q1.length > 0 || resQ || llpQ) && <div className="itr-pick-row itr-pick-qs">
      {exemptQ && <label className="itr-pick-f"><span>Claims exemption under section 11 or 10 (a charitable trust, a section 8 company)</span>
        <select data-itr-exempt="" value={yn(X.state.exempt11)} onChange={(e) => set({ exempt11: ny(e.target.value) })}><option value="">Choose</option><option value="y">Yes</option><option value="n">No</option></select></label>}
      {presQ && <label className="itr-pick-f"><span>Business income on a presumptive basis (44AD, 44ADA, 44AE)</span>
        <select data-itr-presq="" value={yn(X.state.presumptiveOpt)} onChange={(e) => set({ presumptiveOpt: ny(e.target.value) })}><option value="">Choose</option><option value="y">Yes</option><option value="n">No</option></select></label>}
      {llpQ && <label className="itr-pick-f"><span>Firm or LLP</span>
        <select data-itr-llp="" value={llpV} onChange={(e) => set({ llp: e.target.value === "" ? undefined : e.target.value === "llp" })}><option value="">Choose</option><option value="firm">Partnership firm</option><option value="llp">LLP</option></select></label>}
      {q1.map(([k, label]) => <label key={k} className="itr-pick-f"><span>{label}</span>
        <select data-itr-q1={k} value={yn(X.state[k])} onChange={(e) => set({ [k]: ny(e.target.value) })}><option value="">Choose</option><option value="y">Yes</option><option value="n">No</option></select></label>)}
      {resQ && <label className="itr-pick-f"><span>Residential status</span>
        <select data-itr-res="" value={X.facts.resident || ""} onChange={(e) => set({ resident: e.target.value || undefined })}><option value="">Choose</option><option value="RES">Resident</option><option value="NOR">Not ordinarily resident</option><option value="NRI">Non-resident</option></select></label>}
    </div>}
  </section>;
}

// ---------------- 1. Data ----------------
const KINDS = [["ais", "AIS"], ["tis", "TIS"], ["as26", "Form 26AS"], ["prefill", "Pre-filled data"]];
function DataStep({ X, refresh }) {
  const [busy, setBusy] = useState(false), [said, setSaid] = useState([]), [open, setOpen] = useState("");
  async function bring(list) {
    setBusy(true); const out = [];
    const dob = X.profile.dob ? X.profile.dob.slice(8, 10) + X.profile.dob.slice(5, 7) + X.profile.dob.slice(0, 4) : "";
    for (const f of list) {
      try {
        const fi = await fileIn(f, { passwords: dob ? [dob, String(X.client.pan || "").toLowerCase() + dob] : [] });
        const r = await X.store.bring(fi);
        out.push({ name: f.name, ok: r.ok, text: r.text, ask: r.ask, id: r.id, confirm: r.confirm ? fi : null });
      } catch (e) { out.push({ name: f.name, ok: false, text: e && e.code === "pdf_password" ? "This PDF has a password FinCom could not open it with (the date of birth as DDMMYYYY; for AIS the PAN in small letters with it). Download the text or JSON instead." : "The file could not be read." }); }
    }
    setSaid(out); setBusy(false); refresh();
  }
  const fileOf = (k) => X.files.find((f) => f.kind === k);
  const months = (k) => X.files.filter((f) => f.kind === k).sort((a, b) => a.wageMonth.localeCompare(b.wageMonth));
  return <div className="itr-stack">
    <section className="itr-card" data-itr-uploads="">
      <div className="itr-card-head"><h2>Portal files</h2><span className="itr-note">Kept in the firm's private storage only.</span></div>
      <label className={"itr-drop" + (busy ? " busy" : "")} data-itr-drop="">
        <input type="file" multiple accept=".json,.txt,.csv,.pdf" data-itr-file="" onChange={(e) => { const l = [...e.target.files]; e.target.value = ""; if (l.length) bring(l); }} />
        <span className="itr-drop-t">{busy ? "Reading…" : "Bring in files"}</span>
        <span className="itr-note">AIS, TIS, 26AS, pre-filled JSON, Form 16, PF ECR and challans, ESI challans. FinCom tells which is which.</span>
      </label>
      {said.length > 0 && <ul className="itr-said" data-itr-said="">{said.map((s, i) => <li key={i} data-ok={s.ok ? "1" : "0"}><b>{s.name}</b> {s.text}
        {s.confirm && <span> <button className="linkbtn" data-itr-confirm="" onClick={async () => { const r = await X.store.bring(s.confirm, AY_KEY, { confirmed: true }); setSaid(said.map((z, j) => j === i ? { name: z.name, ok: r.ok, text: r.text, ask: r.ask } : z)); refresh(); }}>{"Yes, it is " + (X.client.name || "this client") + "'s"}</button></span>}
        {s.ask && <span> {s.ask.text} <button className="linkbtn" data-itr-yes={s.ask.key} onClick={() => { X.store.setState({ [s.ask.key]: s.ask.value }); setSaid(said.map((z, j) => j === i ? Object.assign({}, z, { ask: null, text: z.text + " Remembered." }) : z)); refresh(); }}>Yes, it is</button></span>}</li>)}</ul>}
      <div className="itr-files">
        {KINDS.map(([k, label]) => { const f = fileOf(k); return <FileRow key={k} k={k} label={label} f={f} open={open === k} onOpen={() => setOpen(open === k ? "" : k)} onDrop={() => { X.store.drop(f.id); refresh(); }} />; })}
        <F16Row list={X.files.filter((f) => f.kind === "form16")} open={open === "form16"} onOpen={() => setOpen(open === "form16" ? "" : "form16")} />
        <MonthRow label="PF ECR" list={months("ecr")} k="ecr" open={open === "ecr"} onOpen={() => setOpen(open === "ecr" ? "" : "ecr")} />
        <MonthRow label="PF challans" list={months("pfchallan")} k="pfchallan" open={open === "pfchallan"} onOpen={() => setOpen(open === "pfchallan" ? "" : "pfchallan")} />
        <MonthRow label="ESI challans" list={months("esic")} k="esic" open={open === "esic"} onOpen={() => setOpen(open === "esic" ? "" : "esic")} />
      </div>
    </section>
    <ReturnCard X={X} refresh={refresh} />
    <BooksCard X={X} />
  </div>;
}
function FileRow({ k, label, f, open, onOpen, onDrop }) {
  return <div className="itr-file" data-itr-kind={k} data-in={f ? "1" : "0"}>
    <button className="itr-file-main" onClick={onOpen} aria-expanded={open} disabled={!f}>
      <span className="itr-dot" data-tone={f ? "ok" : "none"} />
      <span className="itr-file-l">{label}</span>
      <span className="itr-file-r">{f ? f.name + " · " + String(f.at || "").slice(0, 10) : "Not brought in"}</span>
    </button>
    {f && open && <div className="itr-file-more" data-itr-read={k}>
      <table className="itr-mini"><tbody>{(f.read.sections || []).map((s) => <tr key={s.name}><td>{s.name}</td><td className="n">{s.count}</td><td className="n">{money(s.total)}</td></tr>)}</tbody></table>
      <p className="itr-note">{"PAN " + (f.pan || "") + " · AY " + f.ay + "-" + String(+f.ay + 1).slice(2) + (f.stored ? " · stored" : " · not stored (signed out)") + (f.assumed ? " · layout to confirm on the first real file" : "")}</p>
      <button className="linkbtn" data-itr-remove={k} onClick={onDrop}>Remove</button>
    </div>}
  </div>;
}
// Form 16: one per employer (TAN); taken into Schedule S on Schedules
function F16Row({ list, open, onOpen }) {
  return <div className="itr-file" data-itr-kind="form16" data-in={list.length ? "1" : "0"}>
    <button className="itr-file-main" onClick={onOpen} aria-expanded={open} disabled={!list.length}>
      <span className="itr-dot" data-tone={list.length ? "ok" : "none"} /><span className="itr-file-l">Form 16</span>
      <span className="itr-file-r">{list.length ? list.length + " employer" + (list.length === 1 ? "" : "s") : "None"}</span>
    </button>
    {open && <div className="itr-file-more" data-itr-read="form16"><table className="itr-mini"><tbody>{list.map((f) => <tr key={f.id}><td>{(f.data.employer || "") + " (" + (f.data.tan || "") + ")"}</td><td className="n">{money(f.data.s171 + f.data.s172 + f.data.s173)}</td><td className="n">{"TDS " + money(f.data.tds)}</td></tr>)}</tbody></table>
      <p className="itr-note">Layout to confirm on the first real file. Take it into Schedule S on Schedules.</p></div>}
  </div>;
}
function MonthRow({ label, list, k, open, onOpen }) {
  return <div className="itr-file" data-itr-kind={k} data-in={list.length ? "1" : "0"}>
    <button className="itr-file-main" onClick={onOpen} aria-expanded={open} disabled={!list.length}>
      <span className="itr-dot" data-tone={list.length >= 12 ? "ok" : list.length ? "warn" : "none"} />
      <span className="itr-file-l">{label}</span>
      <span className="itr-file-r">{list.length ? list.length + " of 12 months" : "None"}</span>
    </button>
    {open && <div className="itr-file-more" data-itr-read={k}><table className="itr-mini"><tbody>{list.map((f) => <tr key={f.id}>
      <td>{f.wageMonth.slice(4, 6) + "-" + f.wageMonth.slice(0, 4)}</td><td>{f.paidOn ? "paid " + fmtDate(f.paidOn) : (f.read.sections[0] || {}).name}</td><td className="n">{money(f.kind === "ecr" ? f.data.ee : f.data.total)}</td></tr>)}</tbody></table></div>}
  </div>;
}
function ReturnCard({ X, refresh }) {
  const st = X.state, ent = X.client.entity, ind = ent === "P" || ent === "H";
  const [more, setMore] = useState(false);
  const cmp = ind ? compareRegimes(X.model) : null;
  const set = (p) => { X.store.setState(p); refresh(); };
  return <section className="itr-card" data-itr-return="">
    <div className="itr-card-head"><h2>The return</h2><button className="linkbtn" data-itr-more="" onClick={() => setMore(!more)}>{more ? "Less" : "Details"}</button></div>
    <div className="itr-grid">
      {ind && <label className="itr-field"><span>Regime</span><select data-itr-regime="" value={st.regime || ""} onChange={(e) => set({ regime: e.target.value })}><option value="">Choose</option><option value="new">New (115BAC)</option><option value="old">Old</option></select></label>}
      {ent === "C" && <label className="itr-field"><span>Regime</span><select data-itr-regime="" value={st.regime || ""} onChange={(e) => set({ regime: e.target.value })}><option value="">Choose</option><option value="115BAA">115BAA</option><option value="normal">Normal (with MAT)</option></select></label>}
      <label className="itr-field"><span>Filing date</span><input type="date" data-itr-filing="" value={ymdIn(st.filingDate)} onChange={(e) => set({ filingDate: ymdOut(e.target.value) })} /></label>
      <label className="itr-field itr-tick"><input type="checkbox" data-itr-audit="" checked={!!st.audit} onChange={(e) => set({ audit: e.target.checked })} /><span>Tax audit (44AB)</span></label>
    </div>
    {cmp && <p className="itr-note" data-itr-regimes="">{"New regime " + money(cmp.new) + " · old " + money(cmp.old) + " · " + (cmp.saving ? cmp.better + " is lower by " + money(cmp.saving) : "the same")}</p>}
    {more && <div className="itr-more" data-itr-details="">
      {X.form === "ITR-4" && <Presumptive X={X} set={set} />}
      {ent === "F" && <Partners X={X} set={set} />}
      {ent === "F" && <label className="itr-field"><span>Firm or LLP</span><select data-itr-llp="" value={st.llp === true ? "llp" : st.llp === false ? "firm" : ""} onChange={(e) => set({ llp: e.target.value === "" ? undefined : e.target.value === "llp" })}><option value="">Choose</option><option value="firm">Partnership firm</option><option value="llp">LLP</option></select></label>}
      {ent === "C" && st.regime === "normal" && <div className="itr-grid"><label className="itr-field"><span>Book profit under 115JB (with the Explanation 1 adjustments)</span><input inputMode="numeric" data-itr-bp="" value={st.bookProfit ?? ""} onChange={(e) => set({ bookProfit: e.target.value === "" ? "" : +e.target.value, bookProfitOk: false })} /></label>
        <label className="itr-field itr-tick"><input type="checkbox" data-itr-bp-ok="" checked={!!st.bookProfitOk} onChange={(e) => set({ bookProfitOk: e.target.checked })} /><span>The book profit is confirmed</span></label></div>}
      {ent === "C" && <Yn label="Follows Ind AS" k="indAs" X={X} set={set} />}
      {ent === "C" && (X.state.profile || {}).indAs === true && <Yn label="Preference shares are irredeemable (equity under Ind AS 32)" k="prefEquity" X={X} set={set} />}
      {ent === "C" && <Yn label="Listed company" k="listed" X={X} set={set} />}
      {ent !== "P" || X.form !== "ITR-4" ? <Yn label="Every loan and advance given is for the business" k="loansForBusiness" X={X} set={set} /> : null}
      {st.audit && <Auditor X={X} set={set} />}
      {(ent === "P" || ent === "H") && <Via X={X} set={set} />}
      {ent === "C" && <label className="itr-field"><span>Turnover of FY 2023-24 within Rs 400 crore</span><select data-itr-small="" value={st.smallCo === false ? "no" : st.smallCo ? "yes" : ""} onChange={(e) => set({ smallCo: e.target.value === "" ? undefined : e.target.value === "yes" })}><option value="">Choose</option><option value="yes">Yes (25%)</option><option value="no">No (30%)</option></select></label>}
      <Profile X={X} set={set} />
    </div>}
  </section>;
}
function Presumptive({ X, set }) {
  const p = X.state.presumptive || {}, ad = p.ad || {}, ada = p.ada || {};
  const upd = (k, f, v) => set({ presumptive: Object.assign({}, p, { [k]: Object.assign({}, p[k] || {}, { [f]: v === "" ? "" : +v }) }) });
  return <div className="itr-grid" data-itr-presumptive="">
    <label className="itr-field"><span>44AD: received digitally</span><input inputMode="numeric" data-itr-ad-dig="" value={ad.digital ?? ""} onChange={(e) => upd("ad", "digital", e.target.value)} /></label>
    <label className="itr-field"><span>44AD: other (cash)</span><input inputMode="numeric" data-itr-ad-oth="" value={ad.other ?? ""} onChange={(e) => upd("ad", "other", e.target.value)} /></label>
    <label className="itr-field"><span>44ADA: gross receipts</span><input inputMode="numeric" data-itr-ada="" value={ada.receipts ?? ""} onChange={(e) => upd("ada", "receipts", e.target.value)} /></label>
  </div>;
}
function Partners({ X, set }) {
  const ps = X.state.partners || [];
  const upd = (i, f, v) => set({ partners: ps.map((p, j) => (j === i ? Object.assign({}, p, { [f]: f === "name" || f === "pan" ? v : +v }) : p)) });
  return <div data-itr-partners=""><table className="itr-mini"><thead><tr><th>Partner</th><th>PAN</th><th>Share %</th><th>City, state code, PIN</th><th>Remuneration</th><th>Interest</th><th>Rate %</th></tr></thead><tbody>
    {ps.map((p, i) => <tr key={i}><td><input value={p.name || ""} onChange={(e) => upd(i, "name", e.target.value)} /></td><td><input value={p.pan || ""} onChange={(e) => upd(i, "pan", e.target.value.toUpperCase())} /></td>
      <td><input inputMode="numeric" value={p.share ?? ""} onChange={(e) => upd(i, "share", e.target.value)} /></td>
      <td><input value={[p.city, p.state, p.pin].filter((x) => x != null && x !== "").join(", ")} onChange={(e) => { const [c, st2, pin] = e.target.value.split(",").map((x) => x.trim()); set({ partners: ps.map((q, j) => (j === i ? Object.assign({}, q, { city: c || "", state: st2 || "", pin: pin || "" }) : q)) }); }} /></td>
      <td><input inputMode="numeric" value={p.remuneration || ""} onChange={(e) => upd(i, "remuneration", e.target.value)} /></td>
      <td><input inputMode="numeric" value={p.interest || ""} onChange={(e) => upd(i, "interest", e.target.value)} /></td><td><input inputMode="numeric" value={p.rate || ""} onChange={(e) => upd(i, "rate", e.target.value)} /></td></tr>)}
  </tbody></table><button className="linkbtn" data-itr-add-partner="" onClick={() => set({ partners: ps.concat([{ name: "", remuneration: 0, interest: 0, rate: 12 }]) })}>Add a partner</button>
  {X.comp.p40b && <p className="itr-note">{"Book profit " + money(X.comp.p40b.bookProfit) + " · 40(b) limit " + money(X.comp.p40b.limit) + " · allowed " + money(X.comp.p40b.allowed)}</p>}</div>;
}
// a Yes / No kept in the person's details (the profile), unanswered until chosen
function Yn({ label, k, X, set }) {
  const own = X.state.profile || {}, v = own[k];
  return <label className="itr-field"><span>{label}</span><select data-itr-yn={k} value={v === true ? "y" : v === false ? "n" : ""} onChange={(e) => set({ profile: Object.assign({}, own, { [k]: e.target.value === "" ? undefined : e.target.value === "y" }) })}><option value="">Choose</option><option value="y">Yes</option><option value="n">No</option></select></label>;
}
function Auditor({ X, set }) {
  const own = X.state.profile || {}, a = own.auditor || {};
  const upd = (k, v) => set({ profile: Object.assign({}, own, { auditor: Object.assign({}, a, { [k]: v }) }) });
  return <div className="itr-grid" data-itr-auditor="">{[["firm", "Auditor's firm"], ["firmPan", "Firm's PAN"], ["reportDate", "Date of the audit report", "date"], ["ack", "Acknowledgement of 3CA / 3CB"]].map(([k, l, t]) =>
    <label key={k} className="itr-field"><span>{l}</span><input type={t || "text"} data-itr-aud={k} value={a[k] || ""} onChange={(e) => upd(k, e.target.value)} /></label>)}</div>;
}
// Chapter VI-A claims (old regime: each section's limit applied by the computation; the new regime takes 80CCD(2), 80CCH)
const VIA_F = [["80C", "80C"], ["80CCD1B", "80CCD(1B)"], ["80CCD2", "80CCD(2) employer"], ["80D_self", "80D self and family"], ["80D_parents", "80D parents"], ["80DD", "80DD"], ["80DDB", "80DDB"], ["80U", "80U"], ["80E", "80E"], ["80TTA", "80TTA"], ["80TTB", "80TTB"], ["80CCH", "80CCH"]];
function Via({ X, set }) {
  const d = X.state.deductions || {};
  const upd = (k, v) => set({ deductions: Object.assign({}, d, { [k]: v === "" ? "" : +v }) });
  const flag = (k, v) => set({ deductions: Object.assign({}, d, { [k]: v }) });
  return <div data-itr-via=""><div className="itr-grid">{VIA_F.map(([k, l]) => <label key={k} className="itr-field"><span>{l}</span><input inputMode="numeric" data-itr-via-k={k} value={d[k] ?? ""} onChange={(e) => upd(k, e.target.value)} /></label>)}</div>
    <div className="itr-grid">{[["parentsSenior", "Parents are senior citizens"], ["ddSevere", "80DD: severe disability"], ["uSevere", "80U: severe disability"], ["ddbSenior", "80DDB: patient a senior citizen"], ["govtEmployer", "Employer is the government"]].map(([k, l]) =>
      <label key={k} className="itr-field itr-tick"><input type="checkbox" checked={!!d[k]} onChange={(e) => flag(k, e.target.checked)} /><span>{l}</span></label>)}</div>
    {X.comp.viaAllowed && Object.keys(X.comp.viaAllowed).length > 0 && <p className="itr-note">{"Allowed: " + Object.entries(X.comp.viaAllowed).map(([k, v]) => k + " " + money(v)).join(" · ")}</p>}</div>;
}
const PF = [["dob", "Date of birth / incorporation", "date"], ["father", "Father's name (verification)"], ["verName", "Verified by"], ["verPan", "Verifier's PAN"], ["place", "Place"], ["email", "Email"], ["mobile", "Mobile"], ["swId", "Software ID (SW + 8 digits)"]];
function Profile({ X, set }) {
  const P = X.profile, own = X.state.profile || {};
  const upd = (k, v) => set({ profile: Object.assign({}, own, { [k]: v }) });
  return <div className="itr-grid" data-itr-profile="">{PF.map(([k, label, t]) => <label key={k} className="itr-field"><span>{label}{P.src && P.src[k] ? <em className="itr-src">{" " + P.src[k]}</em> : null}</span>
    <input type={t || "text"} data-itr-p={k} value={P[k] || ""} onChange={(e) => upd(k, e.target.value)} /></label>)}</div>;
}
function BooksCard({ X }) {
  const b = X.books;
  if (!b || !b.ok) return <section className="itr-card" data-itr-books="missing"><div className="itr-card-head"><h2>Books</h2></div><p className="itr-note">{(b && b.missing && b.missing.join(" ")) || "Not in yet."}</p></section>;
  const t = b.sched.totals;
  return <section className="itr-card" data-itr-books="">
    <div className="itr-card-head"><h2>Books · FY 2025-26</h2><span className="itr-note">From Tally, through the statements</span></div>
    <dl className="itr-kpis"><div><dt>Revenue</dt><dd>{money(t.revenue)}</dd></div><div><dt>Profit before tax</dt><dd>{money(t.pbt)}</dd></div><div><dt>Balance sheet</dt><dd>{t.diff ? "Off by " + money(t.diff) : "Tallies"}</dd></div></dl>
  </section>;
}

// ---------------- 2. Computation ----------------
function CompStep({ X }) {
  const S = X.comp, [open, setOpen] = useState(""), agree = differences(S.key, X.second).length === 0;
  const rows = sheetRows(S);
  const XX = { form: X.form, comp: S, profile: X.profile, version: VERSION };
  async function excel() {
    try {
      if (!window.ExcelJS && typeof loadScriptOnce === "function") await loadScriptOnce("exceljs.min.js");
      const { wb } = await workbook(window.ExcelJS, XX); const buf = await wb.xlsx.writeBuffer();
      const name = "Computation " + (X.client.pan || "") + " AY 2026-27.xlsx", blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      if (typeof saveFile === "function") saveFile(name, blob); else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
    } catch (e) { if (typeof toast === "function") toast("The Excel file could not be made."); }
  }
  return <section className="itr-card itr-sheet" data-itr-sheet="">
    <div className="itr-card-head">
      <div><h2>Computation of Income</h2><span className="itr-note">{(X.profile.orgName || [X.profile.first, X.profile.sur].filter(Boolean).join(" ")) + " · " + (S.tax.rateName || "")}</span></div>
      <div className="itr-actions">
        <span className="itr-chip" data-tone={agree ? "ok" : "bad"} data-itr-agree={agree ? "1" : "0"}>{agree ? "Checked twice" : "Second check differs"}</span>
        <button className="btn small" data-itr-pdf="" onClick={() => openPdf(XX)}>PDF</button>
        <button className="btn small" data-itr-xlsx="" onClick={excel}>Excel</button>
      </div>
    </div>
    <table className="itr-comp"><tbody>{rows.map((r, i) => r.head ? <tr key={i} className="itr-h"><td colSpan={2}>{r.label}</td></tr>
      : <CompRow key={i} r={r} open={open === r.key} onOpen={() => setOpen(open === r.key ? "" : r.key)} />)}</tbody></table>
  </section>;
}
function CompRow({ r, open, onOpen }) {
  const has = (r.trace && r.trace.length) || r.src || r.why;
  return <>
    <tr className={(r.total ? "itr-t " : "") + (has ? "itr-x" : "")} data-itr-line={r.key} onClick={has ? onOpen : undefined}>
      <td>{r.label}{r.confirm ? <span className="itr-chip itr-chip-s" data-tone="warn"> confirm</span> : null}</td><td className="n">{money(r.shown)}</td></tr>
    {open && <tr className="itr-trace" data-itr-trace={r.key}><td colSpan={2}>
      {r.src && <div className="itr-note">{r.src}</div>}
      {r.why && <div className="itr-note">{r.why}</div>}
      {r.trace && r.trace.length > 0 && <table className="itr-mini"><tbody>{r.trace.slice(0, 40).map((t, j) => <tr key={j}><td>{t.ledger}</td><td className="itr-src">{t.group || t.note || ""}</td><td className="n">{money(t.amt)}</td></tr>)}</tbody></table>}
    </td></tr>}
  </>;
}

// ---------------- 3. Checks ----------------
function ChecksStep({ X, refresh }) {
  const [open, setOpen] = useState(""), [show, setShow] = useState("open");
  const cs = X.checks;
  const counts = { matched: cs.filter((c) => c.status === "matched").length, difference: cs.filter((c) => c.status === "difference").length, missing: cs.filter((c) => c.status === "missing").length, needs: cs.filter((c) => c.status === "needs").length };
  const list = show === "open" ? cs.filter(isOpen) : cs;
  return <div className="itr-stack" data-itr-checks="">
    <div className="itr-tally" data-itr-tally="">
      {Object.entries(counts).map(([k, n]) => <span key={k} className="itr-chip" data-tone={STATUS[k][1]} data-itr-count={k}>{n + " " + STATUS[k][0].toLowerCase()}</span>)}
      <span className="itr-spacer" />
      <button className="linkbtn" data-itr-show={show === "open" ? "all" : "open"} onClick={() => setShow(show === "open" ? "all" : "open")}>{show === "open" ? "Show all " + cs.length : "Show open only"}</button>
    </div>
    {GROUPS.map(([gk, gl]) => { const xs = list.filter((c) => c.group === gk); if (!xs.length) return null;
      return <section key={gk} className="itr-card" data-itr-group={gk}><div className="itr-card-head"><h2>{gl}</h2></div>
        <div className="itr-checklist">{xs.map((c) => <Check key={c.id} c={c} X={X} open={open === c.id} onOpen={() => setOpen(open === c.id ? "" : c.id)} refresh={refresh} />)}</div></section>; })}
    {!list.length && <p className="itr-empty" data-itr-allclear="">Every check is matched or accepted.</p>}
  </div>;
}
function Check({ c, X, open, onOpen, refresh }) {
  const [note, setNote] = useState(""), [err, setErr] = useState("");
  const [label, tone] = STATUS[c.status];
  return <div className="itr-check" data-itr-check={c.id} data-status={c.status} data-accepted={c.accepted ? "1" : "0"}>
    <button className="itr-check-main" onClick={onOpen} aria-expanded={open}>
      <span className="itr-chip" data-tone={c.accepted ? "none" : tone}>{c.accepted ? (c.status === "needs" ? "Answered" : "Accepted") : label}</span>
      <span className="itr-check-t">{c.kind === "consistency" ? c.title.replace(/^Consistency: /, "") : c.title}{c.kind === "consistency" && <span className="itr-chip itr-chip-s" data-tone="none" data-itr-consistency=""> consistency</span>}</span>
      {c.status === "difference" && c.diff ? <span className="itr-check-d n">{money(c.diff)}</span> : null}
    </button>
    {open && <div className="itr-check-more" data-itr-more-of={c.id}>
      {c.a && c.b && <div className="itr-sides">
        <div><span className="itr-note">{c.a.label}</span><b className="n">{money(c.a.amt)}</b><span className="itr-src">{c.a.src}</span></div>
        <div><span className="itr-note">{c.b.label}</span><b className="n">{money(c.b.amt)}</b><span className="itr-src">{c.b.src}</span></div>
      </div>}
      {c.text && <p className="itr-note">{c.text}</p>}
      {c.rows && c.rows.length > 0 && <table className="itr-mini"><tbody>{c.rows.slice(0, 30).map((r, i) => <tr key={i}><td>{r.label}</td><td className="n">{r.a == null ? "" : money(r.a)}</td><td className="n">{r.b == null ? "" : money(r.b)}</td>{r.diff != null && <td className="n">{money(r.diff)}</td>}</tr>)}</tbody></table>}
      {c.how && <p className="itr-how">{c.how}</p>}
      {c.ask && <Answers c={c} X={X} refresh={refresh} />}
      {c.askAmount && <AmountAnswer X={X} refresh={refresh} />}
      {c.lapsed && !c.accepted && <p className="itr-err" data-itr-lapsed="">{"Accepted on " + String(c.lapsed.at).slice(0, 10) + " (“" + c.lapsed.note + "”), but the figures have changed since: look again."}</p>}
      {c.accepted ? <p className="itr-note" data-itr-accepted-note="">{(c.status === "needs" ? "Answered: " : "Accepted: ") + c.accepted.note + " (" + c.accepted.by + ", " + String(c.accepted.at).slice(0, 10) + ") "}<button className="linkbtn" onClick={() => { X.store.unaccept(c.id); refresh(); }}>Undo</button></p>
        : c.status !== "matched" && !c.noAccept && <div className="itr-accept"><input data-itr-note={c.id} placeholder={c.status === "needs" ? "Your answer" : "Why this is right (a note)"} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn small" data-itr-accept={c.id} onClick={() => { const r = X.store.accept(c.id, note, c.fp); if (!r.ok) setErr(r.text); else { setErr(""); refresh(); } }}>{c.status === "needs" ? "Confirm" : "Accept"}</button>{err && <span className="itr-err">{err}</span>}</div>}
    </div>}
  </div>;
}

// a payment date for each item the books do not show (43B, 43B(h), 36(1)(va)), or Not paid: kept in the state
// (paidOn), and the computation follows it at once
function Answers({ c, X, refresh }) {
  const all = X.state.paidOn || {};
  const set = (id, v) => { const p = Object.assign({}, X.state.paidOn || {}); if (v) p[id] = v; else delete p[id]; X.store.setState({ paidOn: p }); refresh(); };
  return <div className="itr-answers" data-itr-answers={c.id}>{c.ask.map((a) => { const v = all[a.id] || "";
    return <div key={a.id} className="itr-answer" data-itr-answer={a.id}><span className="itr-answer-l">{a.label}<span className="itr-src">{money(a.amt)}</span></span>
      <input type="date" aria-label={"Paid on, " + a.label} value={v && v !== "none" ? ymdIn(v) : ""} onChange={(e) => set(a.id, ymdOut(e.target.value))} />
      <button className="linkbtn" data-itr-notpaid={a.id} aria-pressed={v === "none"} onClick={() => set(a.id, v === "none" ? "" : "none")}>{v === "none" ? "Not paid ✓" : "Not paid"}</button></div>; })}</div>;
}
function AmountAnswer({ X, refresh }) {
  const [v, setV] = useState(X.state.prior43BPaid ?? "");
  return <div className="itr-accept" data-itr-prior43b=""><input inputMode="numeric" placeholder="Amount (0 if none)" value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))} />
    <button className="btn small" data-itr-prior43b-save="" disabled={v === ""} onClick={() => { X.store.setState({ prior43BPaid: +v }); refresh(); }}>Save</button></div>;
}

// ---------------- 4. JSON ----------------
function JsonStep({ X, json, sch, g, refresh }) {
  const answers = (X.state.answers || {})[X.form] || {};
  const setAns = (path, v) => { const all = Object.assign({}, X.state.answers || {}); all[X.form] = Object.assign({}, answers, { [path]: v }); X.store.setState({ answers: all }); refresh(); };
  async function download() {
    const text = JSON.stringify(json.doc), bytes = new TextEncoder().encode(text);
    const h = await crypto.subtle.digest("SHA-256", bytes), sha = Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, "0")).join("");
    const rep = report({ form: X.form, comp: X.comp, profile: X.profile, now: new Date().toISOString(), schemaFile: SCHEMA_FILES[X.form] }, X.checks, sha);
    const base = X.form + "_" + (X.client.pan || "") + "_AY2026-27";
    const save = (blob, name) => { if (typeof saveFile === "function") saveFile(name, blob); else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); } };
    save(new Blob([text], { type: "application/json" }), base + ".json");
    save(new Blob([JSON.stringify(rep, null, 1)], { type: "application/json" }), base + "_checks.json");
    // what 43B and 43B(h) added back, by ledger / party: next year's return allows it when paid (prior43B, model.js)
    const dis = (X.model.dues43B || []).filter((d) => d.kind43B && R0(d.dis) && !d.unknown && !d.unknownShare).map((d) => ({ ledger: d.ledger, amt: R0(d.dis) }))
      .concat(((X.model.msme || {}).rows || []).map((m) => ({ ledger: m.party, party: m.party, ref: m.ref || "", date: m.date, amt: R0(m.amt), msme: true })));
    X.store.addVersion({ v: (X.state.versions || []).length + 1, at: rep.made, sha, liability: X.comp.liability, payable: X.comp.payable, refund: X.comp.refund, fincom: VERSION, dis43B: dis });
    refresh();
  }
  if (!X.fstat.json) return <section className="itr-card" data-itr-json="unsupported"><div className="itr-card-head"><h2>{"No JSON for " + X.form}</h2></div>
    <p className="itr-note" data-itr-json-why="">{X.fstat.text}</p>
    {X.rec.code && X.form !== X.rec.form && <button className="linkbtn" onClick={() => { X.store.setState({ form: "", formSet: false }); refresh(); }}>{"Use " + X.rec.form + " (recommended)"}</button>}</section>;
  if (sch.error) return <section className="itr-card" data-itr-json="noschema"><div className="itr-card-head"><h2>JSON</h2></div><p className="itr-note">The official schema could not be loaded ({sch.error}). The JSON is not offered without it.</p></section>;
  if (!json) return <section className="itr-card" data-itr-json="loading"><p className="itr-note">Loading the official schema…</p></section>;
  const vs = X.state.versions || [];
  return <div className="itr-stack">
    <section className="itr-card" data-itr-json={g.ok ? "ready" : "blocked"}>
      <div className="itr-card-head"><h2>{g.ok ? "Ready for Winman" : "Not yet"}</h2><span className="itr-note">{SCHEMA_FILES[X.form]}</span></div>
      <ul className="itr-gate">
        <li data-ok={json.schema.ok && !json.asks.length ? "1" : "0"}>Official schema{json.schema.ok && !json.asks.length ? ": passes" : json.asks.length ? ": " + json.asks.length + " answers needed" : ": " + json.schema.errors.length + " errors"}</li>
        <li data-ok={differences(X.comp.key, X.second).length ? "0" : "1"}>Two computations agree to the rupee</li>
        <li data-ok={g.open.length ? "0" : "1"}>{g.open.length ? g.open.length + " checks open" : "Every check matched or accepted"}</li>
      </ul>
      {!json.asks.length && !json.schema.ok && <details className="itr-versions" data-itr-schema-errors=""><summary>{"What the schema says (" + json.schema.errors.length + ")"}</summary>
        <ul className="itr-said">{json.schema.errors.slice(0, 30).concat(json.mapErrors.map((m) => ({ path: m, msg: "" }))).map((e, i) => <li key={i} data-ok="0">{e.path.replace(/^\/ITR\/ITR\d\//, "") + " " + e.msg}</li>)}</ul></details>}
      {g.ok ? <div className="itr-ready"><button className="btn primary" data-itr-download="" onClick={download}>Download JSON</button>
        <span className="itr-note">{"With its checks report · " + VERSION}</span></div>
        : g.open.length > 0 && <button className="linkbtn" data-itr-to-checks="" onClick={() => go("itr-checks")}>Open the checks</button>}
      {vs.length > 0 && <details className="itr-versions" data-itr-versions=""><summary>{vs.length + " made before"}</summary>
        <table className="itr-mini"><tbody>{vs.slice().reverse().map((v) => <tr key={v.v}><td>{"v" + v.v}</td><td>{String(v.at).slice(0, 16).replace("T", " ")}</td><td className="n">{v.payable ? "payable " + money(v.payable) : "refund " + money(v.refund)}</td></tr>)}</tbody></table></details>}
    </section>
    {json.asks.length > 0 && <section className="itr-card" data-itr-asks=""><div className="itr-card-head"><h2>For the form</h2><span className="itr-note">{json.asks.length + " questions the schema needs answered"}</span></div>
      <div className="itr-asks">{json.asks.map((a) => <label key={a.path} className="itr-field" data-itr-ask={a.path}><span>{a.label}</span>
        {a.choices ? <select value={answers[a.path] ?? ""} onChange={(e) => setAns(a.path, e.target.value)}><option value="">Choose</option>{a.choices.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          : <input type={a.kind === "date" ? "date" : "text"} value={answers[a.path] ?? ""} onChange={(e) => setAns(a.path, a.kind === "number" ? +e.target.value : e.target.value)} />}</label>)}</div></section>}
  </div>;
}
