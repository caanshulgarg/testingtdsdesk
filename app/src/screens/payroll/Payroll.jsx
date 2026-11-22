// Payroll (next-payroll, docs/PAYROLL.md): a client's salary for a month, from any salary sheet or typed in, posted the way
// the company books salary. A lazy chunk of its own (Books.jsx, books:payroll).
//   1. How does this company book salary? Journal or Tally Payroll (the owner's choice; unset: FinCom's reading of the
//      books, to confirm)
//   2. The sheet: a layout seen before is read by its saved rule (no AI); a new or changed one is studied once by FinCom's
//      AI (the header and at most 3 masked rows), the owner confirms the mapping, it is saved as the client's rule
//   3. Or typed in, employee by employee, with running totals and each row checked
//   4. The preview: the payroll journal (Daily Check's own builder; approved on Daily Check › Entries), or the Tally
//      Payroll voucher, which needs the owner's OK of its new Tally request before it can be posted (until then: "Post as a
//      journal this month")
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Check, AlertTriangle, Sparkles, ScrollText, Upload, PencilLine } from "lucide-react";
import * as PS from "../../lib/payrollSheet.js";
import * as TP from "../../lib/tallyPayroll.js";
import { payrollOne } from "../../../../server/_shared/dailyjournals.js";
import { inputOf } from "../daily/again.js";
import "./payroll.css";
/* global S, CO, Store, saveBooks, openBooks, toast, Payroll, whoAmI */

const rs = PS.inr;
const say = (m) => { try { toast(m); } catch (e) { /* no toast here */ } };
const owner = () => { try { const r = S.account && S.account.me && S.account.me.role; return r === "owner" || !r; } catch (e) { return false; } };
const who = () => { try { return typeof whoAmI === "function" ? whoAmI() : ""; } catch (e) { return ""; } };
const saveCo = (co) => { try { Store.saveCompany(co); } catch (e) { /* kept on this page */ } };
const curYm = () => { const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCMonth(d.getUTCMonth() - 1); return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0"); };
const books = () => (typeof S === "object" && S.books) || {};
const payData = () => { try { return typeof Payroll === "object" ? Payroll.data() : {}; } catch (e) { return {}; } };
// FinCom's AI for a new layout: the firm's assistant (registers.js SheetAI.map, "sheet_map"), loaded when first needed
const ai = async (req) => {
  if (typeof window.loadRegisters === "function") await window.loadRegisters();
  if (!(window.SheetAI && window.SheetAI.map)) throw new Error("FinCom's AI help is not available here: map the columns yourself.");
  return window.SheetAI.map(req);
};
function More({ label, children, open: o0 = false, id }) {
  const [o, setO] = useState(o0);
  return <div className={"pr-more" + (o ? " open" : "")} data-more={id || ""}>
    <button type="button" className="pr-more-btn" aria-expanded={o} onClick={() => setO(!o)}><ChevronRight width={14} height={14} aria-hidden="true" />{label}</button>
    {o && <div className="pr-more-in">{children}</div>}
  </div>;
}
const Ok = ({ ok, children }) => <span className={"pr-chip " + (ok ? "ok" : "bad")}>{ok ? <Check width={13} height={13} aria-hidden="true" /> : <AlertTriangle width={13} height={13} aria-hidden="true" />}{children}</span>;

// ---------------------------------------------------------------- 1. the method
function Method({ co, onChange }) {
  const set = PS.methodOf(co), det = useMemo(() => PS.detectMethod(books()), [co.id]), [, kick] = useState(0);
  const pick = (value, from) => { if (!owner()) return; co.payrollMethod = { value, by: who(), at: new Date().toISOString(), from }; saveCo(co); kick((x) => x + 1); onChange && onChange(); };
  return <section className="pr-card" data-method={set || "unset"}>
    <div className="pr-q">How does this company book salary?</div>
    <div className="pr-seg" role="radiogroup" aria-label="How this company books salary">
      {["journal", "tally"].map((v) => <button key={v} type="button" role="radio" aria-checked={set === v} disabled={!owner()} className={"pr-segb" + (set === v ? " on" : "")} onClick={() => pick(v, "set")} data-pick={v}>{PS.METHOD_WORDS[v]}</button>)}
    </div>
    {!set && det.value && <p className="pr-line" data-detected={det.value}>FinCom reads <b>{PS.METHOD_WORDS[det.value]}</b> from the books: {det.why}.
      {owner() && <> <button type="button" className="linkbtn" onClick={() => pick(det.value, "detected")} data-confirm="">That’s right</button></>}</p>}
    {!set && !det.value && <p className="pr-line note">Not set. {det.why}.</p>}
    {set && <More label={set === "journal" ? "Dr Salary; Cr TDS, PT, PF, ESI and Salary payable" : "Payroll vouchers with employees and pay heads"} id="method">
      <p className="note">{set === "journal" ? "One journal a month, made from the sheet by Daily Check and posted when you Approve it on Daily Check › Entries."
        : "One Tally payroll voucher a month (100 employees a voucher at most), each employee with their pay heads, the net to salary payable."}
        {co.payrollMethod.by ? " Set by " + co.payrollMethod.by + (co.payrollMethod.from === "detected" ? " (as FinCom read the books)" : "") + "." : ""}</p>
      {!owner() && <p className="note">Only the owner changes this.</p>}
    </More>}
  </section>;
}

// ---------------------------------------------------------------- 2. the mapping to confirm (a new layout)
const OPTS = [["", "Not used"]].concat(PS.FIELDS, [["earn", "Earning head"], ["ded", "Other deduction"]]);
function fieldOf(m, n) { if (m.earn.includes(n)) return "earn"; if (m.ded.includes(n)) return "ded"; return Object.keys(m.map).find((f) => m.map[f] === n) || ""; }
function setField(m, n, f) {
  const x = { map: Object.assign({}, m.map), earn: m.earn.filter((c) => c !== n), ded: m.ded.filter((c) => c !== n), why: m.why || {}, ai: m.ai };
  Object.keys(x.map).forEach((k) => { if (x.map[k] === n || k === f) delete x.map[k]; });
  if (f === "earn") x.earn.push(n); else if (f === "ded") x.ded.push(n); else if (f) x.map[f] = n;
  return x;
}
function MapStep({ st, setSt, co }) {
  const head = st.head, names = head.map(PS.norm), first = st.grid.slice(st.hi + 1).find((r) => (r || []).some((c) => String(c).trim())) || [];
  const m = st.mapping, probs = PS.mappingProblems(m, { month: st.month });
  const save = () => {
    if (probs.length) { say(probs[0]); return; }
    const rule = PS.makeRule(head, st.sheet, m, { by: who(), name: st.file });
    co.payrollFormats = (co.payrollFormats || []).concat([rule]); saveCo(co);
    setSt(Object.assign({}, st, PS.apply(rule, st.grid, st.hi, { month: st.month }), { step: "read", rule, how: "saved" }));
  };
  return <section className="pr-card" data-step="map">
    <div className="pr-title"><Sparkles width={15} height={15} aria-hidden="true" />New layout · {st.aiErr ? "map the columns" : "FinCom’s AI read the columns"}. Check them once.</div>
    {st.aiErr && <p className="pr-line bad">{st.aiErr}</p>}
    <div className="pr-maptab" role="table" aria-label="The sheet's columns">
      {head.map((h, i) => names[i] ? <div className="pr-mrow" role="row" key={i} data-col={names[i]}>
        <span className="pr-mcol" role="cell">{String(h)}</span>
        <span className="pr-mval" role="cell">{String(first[i] == null ? "" : first[i])}</span>
        <select role="cell" aria-label={"What “" + h + "” is"} value={fieldOf(m, names[i])} onChange={(ev) => setSt(Object.assign({}, st, { mapping: setField(m, names[i], ev.target.value) }))}>
          {OPTS.map(([v, w]) => <option key={v} value={v}>{w}</option>)}
        </select>
      </div> : null)}
    </div>
    {!m.map.month && !m.map.date && <label className="pr-month">Month of this sheet <input type="month" value={st.month ? st.month.slice(0, 4) + "-" + st.month.slice(4) : ""} onChange={(ev) => setSt(Object.assign({}, st, { month: ev.target.value.replace("-", "") }))} /></label>}
    {probs.length > 0 && <p className="pr-line note">{probs.join(" ")}</p>}
    <div className="pr-acts"><button type="button" className="btn small primary" disabled={probs.length > 0} onClick={save} data-save-rule="">Save this layout</button>
      <button type="button" className="linkbtn" onClick={() => setSt(null)}>Cancel</button></div>
    <More label="What the AI saw" id="ai-saw"><p className="note">The header and {st.sent ? st.sent.rows.length : 0} rows, names, PANs and codes masked. Saved as a rule, this layout is read without AI next time.</p>
      {st.sent && <pre className="pr-pre">{JSON.stringify(st.sent.head) + "\n" + st.sent.rows.map((r) => JSON.stringify(r)).join("\n")}</pre>}</More>
  </section>;
}

// ---------------------------------------------------------------- the employees and their checks
function Employees({ rows, chk }) {
  const heads = Array.from(new Set(rows.flatMap((r) => Object.keys(r.earn || {})))), ded = Array.from(new Set(rows.flatMap((r) => Object.keys(r.ded || {}))));
  return <div className="pr-scroll"><table className="pr-tab" data-employees={rows.length}>
    <thead><tr><th>Employee</th><th>Days</th>{heads.map((h) => <th key={h} className="n">{h}</th>)}<th className="n">Gross</th><th className="n">TDS</th><th className="n">PT</th><th className="n">PF</th><th className="n">ESI</th>{ded.map((h) => <th key={h} className="n">{h}</th>)}<th className="n">Net</th><th></th></tr></thead>
    <tbody>{rows.map((r, i) => { const p = chk.per[i] || { ok: true, why: [] }; return <tr key={i} className={p.ok ? "" : "bad"} title={p.why.join("; ")}>
      <td>{r.name}</td><td>{r.days == null ? "" : r.days}</td>{heads.map((h) => <td key={h} className="n">{rs((r.earn || {})[h] || 0)}</td>)}
      <td className="n">{rs(r.gross)}</td><td className="n">{rs(r.tds)}</td><td className="n">{rs(r.profTax)}</td><td className="n">{rs(r.pf)}</td><td className="n">{rs(r.esi)}</td>{ded.map((h) => <td key={h} className="n">{rs((r.ded || {})[h] || 0)}</td>)}
      <td className="n">{rs(r.net)}</td><td>{p.ok ? <Check width={14} height={14} aria-label="Adds up" className="pr-ok" /> : <AlertTriangle width={14} height={14} aria-label={p.why.join("; ")} className="pr-bad" />}</td></tr>; })}</tbody>
    <tfoot><tr><td>Total</td><td></td>{heads.map((h) => <td key={h} className="n">{rs(rows.reduce((s, r) => s + ((r.earn || {})[h] || 0), 0))}</td>)}<td className="n">{rs(chk.tot.gross)}</td><td className="n">{rs(chk.tot.tds)}</td><td className="n">{rs(chk.tot.pt)}</td><td className="n">{rs(chk.tot.pf)}</td><td className="n">{rs(chk.tot.esi)}</td>
      {ded.map((h) => <td key={h} className="n">{rs(rows.reduce((s, r) => s + ((r.ded || {})[h] || 0), 0))}</td>)}<td className="n">{rs(chk.tot.net)}</td><td></td></tr></tfoot>
  </table></div>;
}
function Summary({ rows, chk, how, rule, onKeep, kept }) {
  const ym = chk.months[0] || "";
  return <section className="pr-card" data-step="read" data-how={how}>
    <div className="pr-title">{how === "rule" ? <ScrollText width={15} height={15} aria-hidden="true" /> : <Check width={15} height={15} aria-hidden="true" />}
      {how === "rule" ? "Read by your saved layout" : how === "manual" ? "Typed in" : "Layout saved"}{rule ? " “" + rule.name + "”" : ""}{how === "rule" ? " · no AI" : ""}</div>
    <p className="pr-line"><b>{PS.monLabel(ym) || "No month"}</b> · {rows.length} employee{rows.length === 1 ? "" : "s"} · gross <b>{rs(chk.tot.gross)}</b> · net <b>{rs(chk.tot.net)}</b> <Ok ok={chk.ok}>{chk.ok ? "Adds up" : chk.bad.length ? chk.bad.length + " to check" : chk.months.length > 1 ? "More than one month" : "Does not add up"}</Ok></p>
    {chk.bad.slice(0, 3).map((b, i) => <p key={i} className="pr-line bad">{b.name}: {b.why.join("; ")}</p>)}
    <More label="Employees" id="employees"><Employees rows={rows} chk={chk} />
      {chk.tot.pfEr || chk.tot.esiEr ? <p className="note">Employer’s PF {rs(chk.tot.pfEr)} and ESI {rs(chk.tot.esiEr)}: not in the employee’s pay.</p> : null}</More>
    {onKeep && <div className="pr-acts"><button type="button" className="btn small" disabled={!chk.ok || kept} onClick={onKeep} data-keep="">{kept ? "Kept with the books" : "Keep with the books"}</button></div>}
  </section>;
}

// ---------------------------------------------------------------- 3. manual entry
function Manual({ ym, setYm, onDone }) {
  const [heads, setHeads] = useState({ earn: ["Basic", "HRA"], ded: [] }), [t, setT] = useState([{}]), [nh, setNh] = useState("");
  const rows = t.map((x) => PS.typedRow(x, ym, heads)).filter((r, i) => r.name || i < t.length - 1 ? true : r.gross || r.net);
  const live = rows.filter((r) => r.name), chk = PS.check(live);
  const upd = (i, k, v, sub) => setT(t.map((x, j) => j !== i ? x : sub ? Object.assign({}, x, { [sub]: Object.assign({}, x[sub], { [k]: v }) }) : Object.assign({}, x, { [k]: v })));
  const cell = (i, k, sub, w) => <input inputMode={k === "name" ? "text" : "decimal"} aria-label={(w || k) + " row " + (i + 1)} value={(sub ? (t[i][sub] || {})[k] : t[i][k]) || ""} onChange={(ev) => upd(i, k, ev.target.value, sub)} />;
  return <section className="pr-card" data-step="manual">
    <div className="pr-title"><PencilLine width={15} height={15} aria-hidden="true" />Enter by hand · <label className="pr-inline">Month <input type="month" value={ym.slice(0, 4) + "-" + ym.slice(4)} onChange={(ev) => setYm(ev.target.value.replace("-", ""))} /></label></div>
    <div className="pr-scroll"><table className="pr-tab pr-entry">
      <thead><tr><th>Employee</th><th>Days</th>{heads.earn.map((h) => <th key={h} className="n">{h}</th>)}<th className="n">TDS</th><th className="n">PT</th><th className="n">PF</th><th className="n">ESI</th>{heads.ded.map((h) => <th key={h} className="n">{h}</th>)}<th className="n">Net</th><th></th></tr></thead>
      <tbody>{t.map((x, i) => { const r = PS.typedRow(x, ym, heads), p = r.name ? PS.check([r]).per[0] : null; return <tr key={i} data-entry-row={i}>
        <td>{cell(i, "name", null, "Employee")}</td><td className="d">{cell(i, "days", null, "Days")}</td>{heads.earn.map((h) => <td key={h}>{cell(i, h, "earn", h)}</td>)}
        <td>{cell(i, "tds", null, "TDS")}</td><td>{cell(i, "pt", null, "PT")}</td><td>{cell(i, "pf", null, "PF")}</td><td>{cell(i, "esi", null, "ESI")}</td>{heads.ded.map((h) => <td key={h}>{cell(i, h, "ded", h)}</td>)}
        <td><input inputMode="decimal" aria-label={"Net row " + (i + 1)} placeholder={r.name ? String(r.net) : ""} value={x.net || ""} onChange={(ev) => upd(i, "net", ev.target.value)} /></td>
        <td>{p && (p.ok ? <Check width={14} height={14} className="pr-ok" aria-label="Gross = net + deductions" /> : <AlertTriangle width={14} height={14} className="pr-bad" aria-label={p.why.join("; ")} />)}</td></tr>; })}</tbody>
      <tfoot><tr data-totals=""><td>Total · {live.length}</td><td></td>{heads.earn.map((h) => <td key={h} className="n">{rs(live.reduce((s, r) => s + ((r.earn || {})[h] || 0), 0))}</td>)}<td className="n">{rs(chk.tot.tds)}</td><td className="n">{rs(chk.tot.pt)}</td><td className="n">{rs(chk.tot.pf)}</td><td className="n">{rs(chk.tot.esi)}</td>
        {heads.ded.map((h) => <td key={h} className="n">{rs(live.reduce((s, r) => s + ((r.ded || {})[h] || 0), 0))}</td>)}<td className="n">{rs(chk.tot.net)}</td><td></td></tr></tfoot>
    </table></div>
    <p className="pr-line">Gross <b>{rs(chk.tot.gross)}</b> = net {rs(chk.tot.net)} + deductions {rs(chk.tot.gross - chk.tot.net)} {live.length > 0 && <Ok ok={chk.ok}>{chk.ok ? "Adds up" : chk.bad.length + " to check"}</Ok>}</p>
    <div className="pr-acts"><button type="button" className="btn small" onClick={() => setT(t.concat([{}]))} data-add-row="">Add employee</button>
      <span className="pr-inline"><input aria-label="New head" placeholder="Add a head (Bonus)" value={nh} onChange={(ev) => setNh(ev.target.value)} />
        <button type="button" className="linkbtn" disabled={!nh.trim()} onClick={() => { setHeads({ earn: heads.earn.concat([nh.trim()]), ded: heads.ded }); setNh(""); }}>Earning</button>
        <button type="button" className="linkbtn" disabled={!nh.trim()} onClick={() => { setHeads({ earn: heads.earn, ded: heads.ded.concat([nh.trim()]) }); setNh(""); }}>Deduction</button></span>
      <button type="button" className="btn small primary" disabled={!chk.ok} onClick={() => onDone(live)} data-manual-done="">Use these</button></div>
  </section>;
}

// ---------------------------------------------------------------- 4. the preview
function Lines({ lines }) {
  const dr = lines.reduce((s, l) => s + (l.dr || 0), 0), cr = lines.reduce((s, l) => s + (l.cr || 0), 0);
  return <table className="pr-tab pr-drcr nocards"><thead><tr><th>Ledger</th><th className="n">Dr</th><th className="n">Cr</th></tr></thead>
    <tbody>{lines.map((l, i) => <tr key={i}><td>{l.ledger}</td><td className="n">{l.dr ? rs(l.dr) : ""}</td><td className="n">{l.cr ? rs(l.cr) : ""}</td></tr>)}</tbody>
    <tfoot><tr><td>Total</td><td className="n">{rs(dr)}</td><td className="n">{rs(cr)}</td></tr></tfoot></table>;
}
function inputFor(co, ledgers) {
  try { return inputOf(co.id, { ledgers }); } catch (e) { return { books: books(), ledgers, picks: {}, picksOut: {}, drafts: [], closed: [] }; }
}
function JournalPreview({ co, rows, ledgers, asOnce }) {
  const br = PS.builderRows(rows), ym = (rows[0] || {}).month || "";
  const res = useMemo(() => br.rows ? payrollOne(ym, br.rows, inputFor(co, ledgers)) : null, [rows, ledgers]);
  const e = res && res.entry, why = br.why || (res ? (res.finding.facts.title || "").replace(/^Payroll [A-Za-z]+ \d{4}: /, "") : "Already in the books or approved.");
  return <section className="pr-card" data-preview="journal">
    <div className="pr-title">Payroll journal · {e ? e.voucher.date.slice(6) + "-" + PS.monLabel(ym).slice(0, 3) : PS.monLabel(ym)} {e && <b className="pr-amt">{rs(e.voucher.lines.reduce((s, l) => s + (l.dr || 0), 0))}</b>} {asOnce && <span className="pr-chip warn">As a journal this month</span>}</div>
    {e ? <><Lines lines={e.voucher.lines} /><p className="pr-line note">Keep the sheet with the books: Daily Check prepares this journal; Approve it on Daily Check › Entries.</p>
      <More label={"✓ " + e.checks.filter((c) => c.ok).length + " checks"} id="checks"><p className="note">{e.checks.map((c) => c.k).join(" · ")}</p><p className="note">{e.voucher.narration}</p></More></>
      : <p className="pr-line bad" data-why="">{why}</p>}
  </section>;
}
function TallyPreview({ co, rows, ledgers, onJournal }) {
  const pd = payData(), heads = pd.heads || {}, emps = (pd.employees || []).filter((x) => !x.group), [, kick] = useState(0);
  const saved = co.payHeadPlan || {}, { plan, missing } = TP.payHeadPlan(rows, heads, saved);
  const ym = (rows[0] || {}).month || "", payable = (co.payrollPayable && ledgers.includes(co.payrollPayable)) ? co.payrollPayable : (ledgers.find((l) => /salar(y|ies).*payable|payable.*salar/i.test(l)) || "");
  const out = TP.payrollVouchers({ id: "dc-tp-" + ym, date: ((rows[0] || {}).date) || "", label: PS.monLabel(ym), type: co.payrollVchType || "Payroll", payable, rows, plan, employees: emps });
  const pick = (k, v) => { co.payHeadPlan = Object.assign({}, saved, { [k]: v }); saveCo(co); kick((x) => x + 1); };
  const once = (co.payrollJournal || {})[ym];
  return <section className="pr-card" data-preview="tally">
    <div className="pr-title">Tally Payroll voucher · {PS.monLabel(ym)} {out.vouchers.length > 0 && <b className="pr-amt">{rs(out.vouchers.reduce((s, v) => s + v.net, 0))}</b>} <span className="pr-chip warn" data-needs-ok="">Needs your OK</span></div>
    {missing.length > 0 && <div className="pr-heads">{missing.map((k) => <label key={k} className="pr-hp">{TP.keyWords(k)} → <select value={plan[k] || ""} onChange={(ev) => pick(k, ev.target.value)} aria-label={"Tally pay head for " + TP.keyWords(k)}>
      <option value="">Pick the pay head</option>{Object.keys(heads).map((h) => <option key={h} value={h}>{h}</option>)}</select></label>)}</div>}
    {out.problems.filter((p) => !/^Pick the pay head/.test(p)).slice(0, 3).map((p, i) => <p key={i} className="pr-line bad">{p}.</p>)}
    {out.vouchers.map((v) => <div key={v.id} className="pr-vch" data-voucher={v.id}>
      <p className="pr-line">{v.employees.length} employees · net {rs(v.net)} to <b>{v.payable}</b></p>
      <More label="Employees and pay heads" id={"emp-" + v.id}>{v.employees.map((e) => <div key={e.name} className="pr-emp"><b>{e.name}</b> <span className="note">{e.heads.map((h) => h.head + " " + rs(Math.abs(h.amount)) + (h.earn ? "" : " (ded.)")).join(" · ")}</span> <span className="pr-amt">{rs(-e.amount)}</span></div>)}</More>
      <More label="Tally XML (new request)" id={"xml-" + v.id}><pre className="pr-pre" data-xml="">{TP.payrollVoucherXml(v)}</pre>
        <p className="note">{TP.validatePayrollXml(TP.payrollVoucherXml(v)).length ? "Not the spec's shape." : "The exact shape in docs/PAYROLL.md: one voucher, Create only, no master."}</p></More>
    </div>)}
    <p className="pr-line note" data-wait="">Posting payroll vouchers is a new Tally request. It waits for your OK (docs/PAYROLL.md).</p>
    {owner() && <div className="pr-acts"><button type="button" className={"btn small" + (once ? "" : " primary")} onClick={onJournal} data-journal-once="">{once ? "Post as Tally Payroll again" : "Post as a journal this month"}</button></div>}
  </section>;
}

// ---------------------------------------------------------------- the page
export default function PayrollPage() {
  const co = CO(), [st, setSt] = useState(null), [manual, setManual] = useState(false), [ym, setYm] = useState(curYm()), [ledgers, setLedgers] = useState([]), [kept, setKept] = useState(false), [, kick] = useState(0);
  useEffect(() => { let on = true; import("../../lib/asstEntries.js").then((A) => A.clientLedgers(co)).then((l) => { if (on && l) setLedgers(l.map((x) => x.name)); }).catch(() => {}); return () => { on = false; }; }, [co && co.id]);
  useEffect(() => { if (co && !(S.books && S.books.cid === co.id) && typeof openBooks === "function") Promise.resolve(openBooks(co.id)).then(() => kick((x) => x + 1), () => {}); }, [co && co.id]);
  if (!co) return null;
  const method = PS.methodOf(co);
  // the ledgers: the cloud copy's list (as Approve checks them), else the books open here (ledger -> group)
  const led = ledgers.length ? ledgers : Object.keys(books().under || {});
  const take = async (f) => {
    if (!f) return;
    setManual(false); setKept(false);
    try {
      const { grid, sheet } = await PS.readGrid(f), hi = PS.headRow(grid), head = (grid[hi] || []).map((h) => String(h == null ? "" : h));
      const base = { file: String(f.name || "Salary sheet").replace(/\.[a-z]+$/i, ""), grid, sheet, hi, head };
      const rule = PS.findRule(head, sheet, co.payrollFormats);
      if (rule) { setSt(Object.assign(base, PS.apply(rule, grid, hi, { month: ym }), { step: "read", rule, how: "rule" })); return; }
      setSt(Object.assign({}, base, { step: "map", busy: true, mapping: PS.guess(head) }));
      const sent = PS.samples(head, grid.slice(hi + 1));
      try { const m = await PS.propose(head, grid.slice(hi + 1), ai); setSt(Object.assign({}, base, { step: "map", mapping: m, sent })); }
      catch (e) { setSt(Object.assign({}, base, { step: "map", mapping: PS.guess(head), aiErr: String((e && e.message) || e), sent: null })); }
    } catch (e) { say("Could not read that sheet: " + ((e && e.message) || e)); }
  };
  const rows = st && st.step === "read" ? st.rows : null, chk = rows ? PS.check(rows) : null, month = chk ? chk.months[0] || "" : "";
  const keep = async () => { const b = books(); b.salary = PS.mergeSalary(b.salary, rows); try { await saveBooks(); } catch (e) { /* kept here */ } setKept(true); say(rows.length + " employees kept for " + PS.monLabel(month) + "."); };
  const once = month && (co.payrollJournal || {})[month];
  const toggleOnce = () => { co.payrollJournal = Object.assign({}, co.payrollJournal); if (once) delete co.payrollJournal[month]; else co.payrollJournal[month] = { by: who(), at: new Date().toISOString() }; saveCo(co); kick((x) => x + 1); };
  return <div className="pr" data-payroll="">
    <Method co={co} onChange={() => kick((x) => x + 1)} />
    {(!st || st.step === "read") && !manual && <section className="pr-card pr-start">
      <label className="btn small primary pr-file"><Upload width={14} height={14} aria-hidden="true" />Salary sheet<input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" data-sheet-in="" onChange={(ev) => { const f = (ev.target.files || [])[0]; ev.target.value = ""; take(f); }} /></label>
      <button type="button" className="btn small" onClick={() => { setSt(null); setManual(true); }} data-manual="">Enter by hand</button>
      <span className="note">{(co.payrollFormats || []).filter((r) => !r.deleted).length} saved layout{(co.payrollFormats || []).filter((r) => !r.deleted).length === 1 ? "" : "s"}</span>
    </section>}
    {st && st.step === "map" && (st.busy ? <section className="pr-card"><p className="pr-line note">Reading the columns…</p></section> : <MapStep st={st} setSt={setSt} co={co} />)}
    {manual && <Manual ym={ym} setYm={setYm} onDone={(r) => { setManual(false); setSt({ step: "read", rows: r, skipped: [], how: "manual", rule: null }); }} />}
    {rows && <Summary rows={rows} chk={chk} how={st.how} rule={st.rule} onKeep={keep} kept={kept} />}
    {rows && chk.ok && (method === "tally" && !once ? <TallyPreview co={co} rows={rows} ledgers={led} onJournal={toggleOnce} />
      : <JournalPreview co={co} rows={rows} ledgers={led} asOnce={method === "tally" && !!once} />)}
    {rows && chk.ok && method === "tally" && once && owner() && <p className="pr-line"><button type="button" className="linkbtn" onClick={toggleOnce}>Post as Tally Payroll instead</button></p>}
    {rows && chk.ok && !method && <p className="pr-line note">Set how this company books salary to see the entry.</p>}
  </div>;
}
