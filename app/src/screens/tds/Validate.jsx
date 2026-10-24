// Validate & file (next-tds-clear, design §3.7): ONE panel in place of To fix, the Return file tab, FileChecks and the
// step ③ card. At the top three counts, as ClearTax's validation report: errors (they block the file), warnings
// (potential notices) and checks passed. Each line says what is wrong, how many and how much, and one action: "Fix on
// <step> →" (that step, its filter set) or "Review ▸" (the existing list or form, opened under the line). Then the
// online checks (TRACES PANs, TRACES challan balances, the CSI file, the AI match), each with Run; the year's checks
// (TDS limits, tie-out with Tally, section 197 certificates) folded; and the File row: the previous PRN, Make FVU file,
// Download, Check with FVU, Mark filed.
// checkReturn() is the one source of a return's problem count: the header's badge, the rail's and the TDS home's
// status all come from it. Nothing here works out a figure: the counts are those of TDSMatch.checks, Certs.issues,
// TDSMatch.interestTable (TDS.interest / lateFee), TDS26Q / TCS27EQ, TDSReg, TDSTally, TDSDrift, TRF, TDSPanFix and TDSF25 (src/js).
import { useState } from "react";
import { TracesCheck } from "./Register.jsx";
import { InterestFee } from "./Interest.jsx";
import { stepName, PrevPrn } from "./Shell.jsx";
import { PreFileButton } from "../../parts/PreFile.jsx";
import ListTable from "../../parts/ListTable.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const s_ = (n, one, many) => n + " " + (n === 1 ? one : many);

// the rows of a return
export const rowsOf = (fy, q, form) => (form === "27Q" ? TDS.nrRows() : form === "27EQ" ? TDS.tcsRows() : form === "24Q" ? TDS.formRows("24Q") : TDS.rows()).filter((r) => r.fy === fy && r.q === q);

// a return's checks: {errors, warnings, info, passed, kinds}. Each item {k, n, words, step?, review?, act?}
export function checkReturn(fy, q, form) {
  const out = { errors: [], warnings: [], info: [], passed: 0, kinds: 0 };
  const put = (list, it) => { out.kinds++; if (it && it.n > 0) list.push(it); else out.passed++; };
  const unitW = form === "27EQ" ? ["collection", "collections"] : form === "24Q" ? ["salary payment", "salary payments"] : ["deduction", "deductions"];
  let mc = { block: [], warn: [], info: [] };
  try { mc = TDSMatch.checks(form, fy, q); } catch (e) { /* the matcher not loaded: nothing said */ }
  const blk = (k) => mc.block.find((x) => x.k === k);
  // errors: what stops the file being made (the builder refuses these too)
  const un = blk("untagged");
  const unRows = un ? rowsOf(fy, q, form).filter((r) => !r.challan && r.tds > 0.005) : [];
  put(out.errors, { k: "unmatched", n: un ? un.n : 0, words: s_(un ? un.n : 0, unitW[0] + " on no challan", unitW[1] + " on no challan") + " · " + money(unRows.reduce((a, r) => a + r.tds, 0)), step: "challans", review: true });
  const ov = blk("over");
  put(out.errors, { k: "over", n: ov ? ov.n : 0, words: ov ? ov.words : "", step: "challans", review: true });
  // next-tds-addlist (19-Oct-2026), next-tds-early (20-Oct-2026): a deduction on a challan Protean's FVU refuses for it (a
  // challan dated before the financial year, T-FV-3076 in FVU 1.2, T-FV-3166 in FVU 8.7 two years back, and FinCom refuses the year
  // before too; after today, T-FV-3040; not minor head 200): an error. An advance
  // challan (dated before the deduction, the same year) or the next year's is allowed: no error, no warning (its chip
  // says it). On a challan naming another section: a warning, below
  const chBy = {}; TDS.challans().forEach((c) => { chBy[c.id] = c; });
  const placed = rowsOf(fy, q, form).filter((r) => r.challan && chBy[r.challan]), pis = placed.map((r) => [r, TDSEdit.placeIssues(r, chBy[r.challan])]);
  const BAD = ["fy", "future", "minor"], early = pis.filter(([, p]) => p.some((x) => BAD.includes(x.k))).map(([r]) => r), wrongSec = pis.filter(([, p]) => p.some((x) => x.k === "sec")).map(([r]) => r);
  const ek = early.length ? pis.find(([r]) => r === early[0])[1].find((x) => BAD.includes(x.k)) : null;
  put(out.errors, { k: "early", n: early.length, words: s_(early.length, unitW[0] + " on a challan Protean's FVU refuses for it", unitW[1] + " on a challan Protean's FVU refuses for them") + " · " + money(early.reduce((a, r) => a + r.tds, 0)) + (ek ? ": " + ek.words : ""), step: "deductions" });
  const st = blk("stale");
  put(out.errors, { k: "stale", n: st ? st.n : 0, words: st ? st.words : "", step: "challans" });
  // next-tds-autoplace: the remarks of the rows with no tax (src/js/94): B needs its declaration, T a PAN, Y a payment below the
  // limit; each said only when it is wrong (not counted among the checks passed)
  let rk = []; try { rk = TDSDecl.checks(fy, q, form); } catch (e) { /* the TDS screens' program not loaded */ }
  rk.forEach((x) => (x.level === "warn" ? out.warnings : out.errors).push({ k: "rm-" + x.k, n: x.n, words: x.words, step: "deductees" }));
  // next-fvu87 (24-Oct-2026): up to FY 2025-26, what Protean's FVU 8.7 refuses on a deductee record (remark B for a section it
  // does not take, a 27Q nature not in its list: errors; 194T, which it has no code for: a warning) and what FinCom changed
  // for it in the file (a row left out, an inoperative PAN without C, a foreign address left out: info), in plain words
  let f87 = []; try { f87 = TDS26Q.fvu87Checks(fy, q, form); } catch (e) { /* the TDS screens' program not loaded */ }
  f87.forEach((x) => (x.level === "error" ? out.errors : x.level === "warn" ? out.warnings : out.info).push({ k: "fvu87-" + x.k, n: x.n, words: x.words, step: "deductees" }));
  // the salary return without the salary sheet or Tally's payroll: no file can be made
  const sheet = form === "24Q" && (((S.books || {}).salary || []).length > 0), tally = form === "24Q" && !sheet && Payroll.has(fy);
  if (form === "24Q") put(out.errors, { k: "nosheet", n: !sheet && !tally ? 1 : 0, words: "24Q needs the salary sheet: the books cannot say whose TDS it is", act: ["Bring in the salary sheet", () => doAct("salaryPick")] });
  // warnings: potential notices and what to look at before filing
  let pans = [];
  try { pans = TDSPanFix.list(form, fy, q).filter((p) => p.bad); } catch (e) { /* */ }
  const who = form === "24Q" ? ["employee", "employees"] : form === "27EQ" ? ["buyer", "buyers"] : ["deductee", "deductees"];
  put(out.warnings, { k: "nopan", n: pans.length, words: s_(pans.length, who[0] + " without a valid, operative PAN", who[1] + " without a valid, operative PAN"), step: "deductees", review: true });
  if (form === "26Q") {
    const iss = Certs.issues(fy, q), short = r2(iss.reduce((a, x) => a + Math.max(0, num(x.short)), 0));
    put(out.warnings, { k: "rate", n: iss.length, words: s_(iss.length, "rate question", "rate questions") + (short ? " · short " + money(short) : ""), step: "deductions", review: true });
  }
  if (form !== "24Q") {
    const pc = TDS26Q.payCodeRows(fy, q, form).length;
    put(out.warnings, { k: "paycode", n: pc, words: s_(pc, unitW[0] + " with a payment code to confirm (2025 Act)", unitW[1] + " with a payment code to confirm (2025 Act)"), review: true });
  }
  if (form === "27Q" || form === "27EQ") {
    const other = form === "27Q" ? TDS26Q.nrChecks(fy, q) : TCS27EQ.checks(fy, q);
    if (form === "27Q") put(out.warnings, { k: "nrdetails", n: other.length, words: s_(other.length, "non-resident deductee with details missing", "non-resident deductees with details missing"), review: true });
    else {
      const nocode = other.filter((x) => /No collection code/.test(x.why || "")).length;
      put(out.warnings, { k: "nocode", n: nocode, words: s_(nocode, "collection without a collection code", "collections without a collection code"), review: true });
      put(out.warnings, { k: "tcsrate", n: other.length - nocode, words: s_(other.length - nocode, "TCS rate question", "TCS rate questions"), review: true });
    }
  }
  if (form === "24Q") {
    let ch = [];
    if (sheet) {
      ch = TDS24Q.checks(fy, q);
      const a1 = TDS24Q.annexI(fy, q), inBooks = TDS.salaryRows().filter((r) => r.fy === fy && r.q === q), bt = r2(inBooks.reduce((a, r) => a + r.tds, 0)), stx = r2(a1.reduce((s, e) => s + e.tds, 0));
      if (inBooks.length && Math.abs(bt - stx) >= TDS.MIN_WARN) ch = ch.concat([{ what: "Salary TDS in the books differs from the salary sheet", n: inBooks.length, how: "Tally has " + money(bt) + " under section 192 this quarter; the sheet has " + money(stx) + ".", who: Array.from(new Set(inBooks.map((r) => r.party))).slice(0, 3) }]);
    } else if (tally) ch = Payroll.checks(fy, q);
    put(out.warnings, { k: "salary", n: ch.length, words: ch.length ? s_(ch.length, "salary check before filing", "salary checks before filing") + ": " + ch.map((c) => c.what.toLowerCase()).slice(0, 2).join("; ") : "", step: sheet ? "people" : undefined, review: true, list: ch });
  }
  // next-tds-interest (the owner, 20-Oct-2026): the interest due on the return's challans less what is allocated to it, one
  // line; the 234E fee due, one line; the figures in the Interest & fee section below (tds/Interest.jsx)
  const filed = TDSFiled.get(fy, q, form);
  let it = null; try { it = TDSMatch.interestTable(form, fy, q); } catch (e) { /* the matcher not loaded */ }
  // next-tds-interest2 (the owner, 20-Oct-2026): no warning once allocated (more than due is covered), none under ₹10
  // (TDS.MIN_WARN); the 234E fee as allocated on the Challans grid (Fee 234E allocated)
  const short = it ? it.totals.short : 0, feeShort = it && !filed ? it.totals.feeShort : 0, big = (v) => TDSMatch.warnShort(v);
  put(out.warnings, { k: "interest", n: big(short) ? 1 : 0, words: "Interest " + money(short) + " not allocated", step: "challans" });
  if (big(feeShort)) out.warnings.push({ k: "fee", n: 1, words: "Late fee 234E " + money(feeShort) + " due", step: "challans" });
  mc.warn.forEach((x, i) => put(out.warnings, { k: "m-" + x.k + i, n: 1, words: x.words, step: "challans" }));
  if (form !== "24Q") {
    let td = 0; try { td = TDSTally.disagreements().length + TDSTally.conflicts("challan").length + TDSTally.bad().length; } catch (e) { /* */ }
    put(out.warnings, { k: "tally", n: td, words: s_(td, "challan differs between Tally and FinCom", "challans differ between Tally and FinCom"), review: true });
  }
  put(out.warnings, { k: "chsec", n: wrongSec.length, words: s_(wrongSec.length, unitW[0] + " on a challan of another section", unitW[1] + " on a challan of another section"), step: "deductions" });
  const unk = TDSReg.unknownType(fy, q).length;
  put(out.warnings, { k: "chtype", n: unk, words: s_(unk, "challan of unknown type: which return?", "challans of unknown type: which return?"), review: true });
  const drift = filed && form !== "24Q" ? TDSDrift.check(fy, q, form) : null, dn = drift ? drift.rows.length : 0;
  put(out.warnings, { k: "corr", n: dn, words: s_(dn, "change in Tally since filing: file a correction", "changes in Tally since filing: file a correction"), review: true });
  const jr = TRF.jrFor(fy, q, form), jn = jr ? jr.items.length : 0;
  put(out.warnings, { k: "traces", n: jn, words: s_(jn, "TRACES default", "TRACES defaults"), review: true });
  let dp = 0; try { dp = TDSF25.deductorProblems(TDS26Q.firmDetails()).length; } catch (e) { /* */ }
  put(out.warnings, { k: "deductor", n: dp, words: s_(dp, "deductor detail missing or not in the file's form", "deductor details missing or not in the file's form"), step: "deductor" });
  // information: what goes elsewhere, and the matcher's notes
  if (form === "26Q") { const pr = TDS.portalRows().filter((r) => r.fy === fy && r.q === q).length; if (pr) out.info.push({ k: "portal", n: pr, words: s_(pr, "deduction goes on the portal (26QB / 26QC / 26QD), not this return", "deductions go on the portal (26QB / 26QC / 26QD), not this return"), review: true }); }
  mc.info.forEach((x, i) => out.info.push({ k: "i-" + x.k + i, n: 1, words: x.words }));
  // the owner, 22-Oct-2026 (Leads Insurance, a blank 194J row of ₹0.71): an entry that adjusts a TDS ledger without a
  // deductee (a round-off journal) is no deduction (TDS.adjOnly); each such entry said once here, a note, with the entry
  let adj = []; try { adj = TDSAdj.list(fy, q, form); } catch (e) { /* the TDS screens' program not loaded */ }
  adj.forEach((x, i) => out.info.push({ k: "tdsadj" + i, n: 1, words: x.words, adj: x.vid, act: ["Open the entry", () => TDSAdj.open(x)] }));
  // the TDS check of 22-Oct-2026 (src/js/91: TDSAudit.notes): reversals, top-ups, sections against the expense, payments
  // against deductions, Tally's old rates, one PAN under two names, the remarks
  let au = []; try { au = TDSAudit.notes(fy, q, form); } catch (e) { /* the TDS screens' program not loaded */ }
  au.forEach((x, i) => (x.level === "warn" ? out.warnings : out.info).push({ k: "au-" + x.k + i, n: 1, words: x.words, step: x.step, act: x.vid ? ["Open the entry", () => TDSAdj.open({ date: x.date, no: x.no || "", ledgers: [x.ledger || ""] })] : undefined }));
  // next-tds-excel: rows taken out of this return by an Excel brought back (kept in the books), with Put back
  let outs = []; try { outs = TDSEdit.outList().filter((o) => o.form === form && o.fy === fy && o.q === q); } catch (e) { /* */ }
  if (outs.length) out.info.push({ k: "tdsx-out", n: outs.length, words: s_(outs.length, unitW[0], unitW[1]) + " taken out of this return by an Excel brought back (kept in the books): " + outs.slice(0, 3).map((o) => (o.party || "—") + " " + money(o.tds)).join(", ") + (outs.length > 3 ? " …" : ""),
    act: ["Put back", () => { outs.forEach((o) => TDSX.putBack(o.id)); render(); }] });
  out.drift = dn; out.n = out.errors.length + out.warnings.length;
  return out;
}

// one line of the panel
function Line({ it, level, open, onOpen, form, review }) {
  const go = () => {
    if (it.step === "deductees") S.tdsDeeF = "bad";
    if (it.step === "challans" && it.k === "unmatched") S.tdsChSel = "__none";
    // next-tds-register: the rows on a challan that cannot pay them are in the Deductions register's Mapped tab
    if (it.step === "deductions" && (it.k === "early" || it.k === "chsec")) { S.tdsDedView = ""; S.tdsWinAdd = ""; S.tdsDedReg = "mapped"; S.tdsDregSel = {}; }
    if (it.step === "deductions" && it.k === "rate") { S.tdsFl = Object.assign({}, S.tdsFl || {}, { deductions: Object.assign({}, (S.tdsFl || {}).deductions || {}, { rate: "q" }) }); S.tdsDedView = "table"; S.tdsDedCh = ""; }
    tdsTabGo(it.step); try { window.scrollTo(0, 0); } catch (e) { /* */ }
  };
  return <li className={"vf-line " + level} data-val-item={it.k} data-val-level={level} data-tds-adj={it.adj}>
    <div className="vf-row">
      <span className="vf-ic" aria-hidden="true">{level === "error" ? "✕" : level === "warn" ? "!" : "i"}</span>
      <span className="vf-w">{it.words}</span>
      <span className="vf-act">
        {it.act ? <button type="button" className="linkbtn" data-val-act={it.k} onClick={it.act[1]}>{it.act[0]} →</button> : null}
        {it.step ? <button type="button" className="linkbtn" data-val-fix={it.step} onClick={go}>Fix on {stepName(it.step, form)} →</button> : null}
        {review ? <button type="button" className="linkbtn" data-val-review={it.k} aria-expanded={open} onClick={onOpen}>{open ? "Hide ▾" : "Review ▸"}</button> : null}
      </span>
    </div>
    {open && review ? <div className="vf-review" data-fix-part={it.k}>{review}</div> : null}
  </li>;
}

// the online checks: TRACES PANs, TRACES challan balances, the CSI file, the AI match
function Online({ fy, q, form, chIds }) {
  const [csi, setCsi] = useState(null), [show, setShow] = useState("");
  const co = CO() || {}, path = csi == null ? co.csiFile || "" : csi;
  let unknown = [];
  try { unknown = TDSPanFix.list(form, fy, q).filter((p) => p.pan && Certs.validPan(p.pan) && p.status.state === "unknown").map((p) => p.pan); } catch (e) { /* */ }
  const panOn = typeof PANCheck === "object" && typeof PANCheck.provider === "function";
  let ai = null; try { ai = TDSMatch.aiState(form, fy, q); } catch (e) { /* */ }
  const aiOn = (() => { try { return TDSMatch.aiAllowed() && !!TDSMatch.online(); } catch (e) { return false; } })();
  return <div className="vf-online" data-online-checks="">
    <div className="vf-orow" data-online="pan"><span className="vf-on">TRACES · verify PANs</span>
      <span className="note">{panOn ? (unknown.length ? unknown.length + " not checked yet" : "every PAN checked") : "not connected yet"}</span>
      <button type="button" className="btn small" data-online-run="pan" disabled={!panOn || !unknown.length} onClick={() => tdsPanCheck(unknown)}>Run</button></div>
    <div className="vf-orow" data-online="challans"><span className="vf-on">TRACES · challan balances</span>
      <span className="note">from the TRACES files brought in (After filing)</span>
      <button type="button" className="btn small" data-online-run="challans" aria-expanded={show === "ch"} onClick={() => setShow(show === "ch" ? "" : "ch")}>{show === "ch" ? "Hide" : "Run"}</button></div>
    {show === "ch" && <div className="vf-review"><TracesCheck filter={{ form, fy, q, chIds }} title="TRACES’ consumed amount against FinCom’s used" /></div>}
    <div className="vf-orow" data-online="csi"><span className="vf-on">CSI file (challans from the portal)</span>
      <span className="note">{co.csiFile ? "on the Tally computer: " + co.csiFile : "fetching from the portal is not connected yet"}</span>
      <button type="button" className="btn small" data-online-run="csi" aria-expanded={show === "csi"} onClick={() => setShow(show === "csi" ? "" : "csi")}>{co.csiFile ? "Change" : "Upload"}</button></div>
    {show === "csi" && <div className="vf-review row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="f"><span>Where the CSI file is, on the computer with FinCom Bridge (Check with FVU reads it)</span>
        <input type="text" value={path} placeholder="C:\\TDS\\DELZ12345A.csi" aria-label="CSI file on the Tally computer" style={{ width: 320 }} onChange={(ev) => setCsi(ev.target.value)} /></label>
      <button type="button" className="btn small" data-csi-save="" onClick={() => { coCommit("csiFile", String(path || "").trim()); setShow(""); toast("Kept: Check with FVU uses this CSI file."); }}>Save</button></div>}
    <div className="vf-orow" data-online="prefile"><span className="vf-on">Checks before filing</span>
      <span className="note">FinCom’s full checklist for this return, with its entries and an Excel</span>
      <PreFileButton kind="tds" form={form} fy={fy} q={q} /></div>
    <div className="vf-orow" data-online="ai"><span className="vf-on">AI match (challans)</span>
      <span className="note">{ai && ai.busy ? "AI is looking at what the rules left…" : ai && ai.say ? ai.say : aiOn ? "for what the matching rules leave" : "off (AI help, or not signed in)"}</span>
      <button type="button" className="btn small" data-online-run="ai" disabled={!aiOn || (ai && ai.busy) || TDSReg.locked(fy, q, form)} onClick={() => { TDSMatch.askAi(form, fy, q, true); render(); }}>Run</button></div>
  </div>;
}

// the panel. val: checkReturn(); reviews: {k: element}; year: [[k, label, element]]; file: the File row
export function ValidatePanel({ fy, q, form, val, reviews = {}, year = [], file, chIds = [] }) {
  // a list asked for (an old …/checks/<k> address, a year's check) belongs to the return it was asked on
  const at = fy + "|" + q + "|" + form;
  if (S.tdsFix && S.tdsFixAt && S.tdsFixAt !== at && !["limits", "tieout", "rates"].includes(S.tdsFix)) S.tdsFix = "";
  const sel = S.tdsFix || "", all = S.tdsValOpen === "*";
  const pick = (k) => { S.tdsFix = S.tdsFix === k ? "" : k; S.tdsFixAt = at; render(); };
  const isOpen = (k) => all || sel === k || (k === "interest" && sel === "fee");
  const lines = (list, level) => list.map((it) => <Line key={it.k} it={it} level={level} form={form} open={isOpen(it.k)} onOpen={() => pick(it.k)} review={it.review ? reviews[it.k] || null : null} />);
  const ySel = year.find(([k]) => k === sel);
  return <section className="vf" data-validate={form} data-to-fix={sel || "all"}>
    {/* round 94: the number to fix is the header's ("N to fix"), not said again here; the lists say what each is */}
    <div className="vf-counts" data-val-counts="" data-val-errors={val.errors.length} data-val-warnings={val.warnings.length}>
      <span className="ok" data-val-passed={val.passed}>✓ {s_(val.passed, "check passed", "checks passed")}</span>
    </div>
    {val.errors.length > 0 && <><h4 className="vf-h">Errors · block the file</h4><ul className="vf-list" data-val-list="errors">{lines(val.errors, "error")}</ul></>}
    {val.warnings.length > 0 && <><h4 className="vf-h">Warnings (potential notices)</h4><ul className="vf-list" data-val-list="warnings">{lines(val.warnings, "warn")}</ul></>}
    {!val.errors.length && !val.warnings.length && <p className="ok-line" data-fix-none="" data-cm-checks="ok">Nothing to fix in this return.</p>}
    {val.info.length > 0 && <ul className="vf-list" data-val-list="info">{lines(val.info, "info")}</ul>}
    <InterestFee fy={fy} q={q} form={form} />
    <h4 className="vf-h">Online checks</h4>
    <Online fy={fy} q={q} form={form} chIds={chIds} />
    <TallyChecks fy={fy} q={q} form={form} />
    {year.length > 0 && <details className="vf-year" data-year-checks="" open={!!ySel || all}>
      <summary>Year checks · {year.map(([, l]) => l).join(" · ")}</summary>
      <p className="vf-ylinks">{year.map(([k, l], i) => <span key={k}>{i > 0 && " · "}<button type="button" className={"linkbtn" + (sel === k ? " on" : "")} data-fix={k} aria-pressed={sel === k} onClick={() => pick(k)}>{l}</button></span>)}</p>
      {year.filter(([k]) => sel === k || all).map(([k, , el]) => <div key={k} data-fix-part={k}>{el}</div>)}
    </details>}
    <h4 className="vf-h">File</h4>
    {file}
  </section>;
}

// round 86 (19-Oct-2026): "Checks from Tally", folded: Tally's TDS rows of this return's year and quarter with a real
// problem (the rate deducted is not the law's for the section, no PAN, the section unknown), each once, read right
// (TDSTallyRows, src/js/86: the rate is the one booked; Tally's nature master's rate said beside it where it differs).
// The whole list of Tally's TDS rows is no longer on the TDS pages
export function TallyChecks({ fy, q, form }) {
  let c = null;
  try { c = TDSTallyRows.checks(S.coId, fy, q, form); } catch (e) { return null; }
  if (!c || c.off || c.missing || c.err) return null;
  const n = c.rows.length, day = (d) => (d ? fmtDate(tallyDate(d)) : "");
  return <details className="vf-year vf-tally" data-tally-checks={c.busy ? "busy" : n}>
    <summary>Checks from Tally · {c.busy ? "reading Tally’s TDS rows…" : n ? s_(n, "row to look at", "rows to look at") + (c.seen > n ? " of " + c.seen : "") : "nothing to look at"}</summary>
    {c.busy ? <p className="note">Loading…</p> : n ? <ListTable name="tdsTallyChecks" rows={c.rows} rowKey={(w) => w.row.guid + ":" + w.row.line_no} unit={["row", "rows"]} empty={null}
      rowProps={(w) => ({ "data-tally-check": w.problems.map((x) => x.k).join(" ") })}
      cols={[
        { k: "date", role: "date", label: "Date", cls: "dt", v: (w) => w.day, cell: (w) => day(w.day) },
        { k: "party", role: "party", label: "Deductee", v: (w) => w.row.party, cell: (w) => w.row.party },
        { k: "base", role: "amount", label: "Assessable", cls: "n", v: (w) => w.base, sum: true, fmt: money, cell: (w) => money(w.base) },
        { k: "nature", label: "Nature of payment", v: (w) => w.row.nature, cell: (w) => w.row.nature },
        { k: "sec", label: "Section", v: (w) => w.section, cell: (w) => w.section || "—" },
        { k: "rate", label: "Rate", cls: "n", v: (w) => (w.booked == null ? "" : w.booked), cell: (w) => <>{w.booked == null ? "" : w.booked + "%"}{w.note ? <small className="note" data-tally-rate-note="" style={{ display: "block" }}>{w.note}</small> : null}</> },
        { k: "tds", label: "TDS", cls: "n", v: (w) => w.tax || 0, sum: true, fmt: money, cell: (w) => (w.tax == null ? "—" : money(w.tax)) },
        { k: "why", label: "What to look at", cell: (w) => w.problems.map((x) => x.words).join("; ") },
      ]} /> : <p className="note" data-tally-checks-none="">{c.seen ? "Tally’s TDS rows of this quarter have a section and a PAN, at the law’s rates." : "No TDS row in Tally for this quarter."}</p>}
  </details>;
}

// the File row's previous PRN box
export function PrnBox({ fy, q, form }) {
  const [v, setV] = useState(null), cur = v == null ? PrevPrn.get(fy, q, form) : v;
  return <label className="f vf-prn"><span>Previous return’s token (PRN)</span>
    <input type="text" inputMode="numeric" value={cur} placeholder="15 digits" aria-label="Previous return's token (PRN)" data-prev-prn="" style={{ width: 170 }}
      onChange={(ev) => setV(ev.target.value)} onBlur={() => { if (v != null) PrevPrn.set(fy, q, form, v); }} /></label>;
}
