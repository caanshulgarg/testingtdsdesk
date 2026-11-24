// Payroll (next-payroll, docs/PAYROLL.md): a client's salary for a month, from any salary sheet or typed in, posted the way
// the company books salary. A lazy chunk of its own (Books.jsx, books:payroll).
//   1. How does this company book salary? Journal or Tally Payroll (the owner's choice; unset: FinCom's reading of the
//      books, to confirm)
//   2. The sheet: a layout seen before is read by its saved rule (no AI); a new or changed one is studied once by FinCom's
//      AI (the header and at most 3 masked rows), the owner confirms the mapping, it is saved as the client's rule
//   3. Or typed in, employee by employee, with running totals and each row checked
//   4. The preview: the payroll journal (Daily Check's own builder; approved on Daily Check › Entries), or the Tally
//      Payroll voucher (bridge 2.5.18, FinComPayrollImport): Approve here posts it (lib/payrollPost.js: the second check,
//      the claim on the night's entry, one voucher a posting, Tally's answer as the proof); the owner may still choose "Post
//      as a journal this month"
//   5. Make the journal now (the owner, 23-Nov-2026): a month kept is made at once by the night's own builder, in the cloud
//      (assistant-night payroll_now: the books as the night reads them); made once (one made already, by the night or here,
//      is said and opened); the running month too, with a plain note; it goes to Tally only when approved. (review 3) The
//      running month's salary kept or replaced while its entry is still ready or held: the entry is made again by itself
//      (no button to press), and said
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Check, AlertTriangle, Sparkles, ScrollText, Upload, PencilLine } from "lucide-react";
import * as PS from "../../lib/payrollSheet.js";
import * as TP from "../../lib/tallyPayroll.js";
import * as TPost from "../../lib/payrollPost.js";
import { payrollOne } from "../../../../server/_shared/dailyjournals.js";
import { inputOf, payrollNowCall, UPDATED } from "../daily/again.js";
import "./payroll.css";
/* global S, CO, Store, saveBooks, openBooks, toast, Payroll, whoAmI, Cloud, navHome */

const rs = PS.inr;
const say = (m) => { try { toast(m); } catch (e) { /* no toast here */ } };
const owner = () => { try { const r = S.account && S.account.me && S.account.me.role; return r === "owner" || !r; } catch (e) { return false; } };
const canWrite = () => { try { const r = S.account && S.account.me && S.account.me.role; return r === "owner" || r === "staff" || !r; } catch (e) { return false; } };
const cloudOn = () => { try { return typeof Cloud === "object" && Cloud.on(); } catch (e) { return false; } };
const who = () => { try { return typeof whoAmI === "function" ? whoAmI() : ""; } catch (e) { return ""; } };
const saveCo = (co) => { try { Store.saveCompany(co); } catch (e) { /* kept on this page */ } };
// India's month now (the running month); curYm is the month before it, the sheet's month at first
const nowYm = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7).replace("-", "");
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
// (the owner, 23-Nov-2026) what happens to a month once kept: Daily Check makes its entry at night, after the month ends
const nextWords = (ym, method) => ym > curYm() ? "Kept. Daily Check makes its " + (method === "tally" ? "Tally Payroll entry" : "journal") + " after " + PS.monLabel(ym) + " ends."
  : method === "tally" ? "Kept. Tonight’s Daily Check checks it; then Approve it here." : "Kept. Tonight’s Daily Check makes this journal; approve it tomorrow on Daily Check › Entries.";
function Summary({ rows, chk, how, rule, onKeep, kept, method, made }) {
  const ym = chk.months[0] || "";
  return <section className="pr-card" data-step="read" data-how={how}>
    <div className="pr-title">{how === "rule" ? <ScrollText width={15} height={15} aria-hidden="true" /> : <Check width={15} height={15} aria-hidden="true" />}
      {how === "rule" ? "Read by your saved layout" : how === "manual" ? "Typed in" : how === "kept" ? "Kept with the books" : "Layout saved"}{rule ? " “" + rule.name + "”" : ""}{how === "rule" ? " · no AI" : ""}</div>
    <p className="pr-line"><b>{PS.monLabel(ym) || "No month"}</b> · {rows.length} employee{rows.length === 1 ? "" : "s"} · gross <b>{rs(chk.tot.gross)}</b> · net <b>{rs(chk.tot.net)}</b> <Ok ok={chk.ok}>{chk.ok ? "Adds up" : chk.bad.length ? chk.bad.length + " to check" : chk.months.length > 1 ? "More than one month" : "Does not add up"}</Ok></p>
    {chk.bad.slice(0, 3).map((b, i) => <p key={i} className="pr-line bad">{b.name}: {b.why.join("; ")}</p>)}
    <More label="Employees" id="employees"><Employees rows={rows} chk={chk} />
      {chk.tot.pfEr || chk.tot.esiEr ? <p className="note">Employer’s PF {rs(chk.tot.pfEr)} and ESI {rs(chk.tot.esiEr)}: not in the employee’s pay.</p> : null}</More>
    {onKeep && <div className="pr-acts"><button type="button" className={"btn small" + (kept ? "" : " primary")} disabled={!chk.ok || kept} onClick={onKeep} data-keep="">{kept ? "Kept with the books" : "Keep with the books"}</button>
      {!kept && <span className="note" data-not-kept="">Not kept yet: press Keep with the books to save it.</span>}</div>}
    {kept && chk.ok && !made && <p className="pr-line note" data-next="">{nextWords(ym, method)}</p>}
  </section>;
}

// ---------------------------------------------------------------- 3. manual entry
// the typed rows live on the page (draft), so Cancel, a sheet uploaded meanwhile or the month kept opened again keep them
function draftOf(rows) {
  const earn = Array.from(new Set(rows.flatMap((r) => Object.keys(r.earn || {})))), ded = Array.from(new Set(rows.flatMap((r) => Object.keys(r.ded || {}))));
  const s = (v) => (v == null || v === 0 || v === "" ? "" : String(v)), heads = { earn: earn.length ? earn : ["Gross"], ded };
  return { heads, t: rows.length ? rows.map((r) => ({ name: r.name || "", code: r.code || "", days: s(r.days), earn: earn.length ? Object.fromEntries(earn.map((h) => [h, s((r.earn || {})[h])])) : { Gross: s(r.gross) },
    ded: Object.fromEntries(ded.map((h) => [h, s((r.ded || {})[h])])), tds: s(r.tds), pt: s(r.profTax), pf: s(r.pf), esi: s(r.esi), net: s(r.net), pfEr: s(r.pfEr), esiEr: s(r.esiEr) })) : [{}] };
}
const BLANK = { heads: { earn: ["Basic", "HRA"], ded: [] }, t: [{}] };
function Manual({ ym, setYm, onDone, draft, setDraft, onCancel }) {
  const { heads, t } = draft || BLANK, [nh, setNh] = useState("");
  const setT = (x) => setDraft({ heads, t: x }), setHeads = (h) => setDraft({ heads: h, t });
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
      <button type="button" className="btn small primary" disabled={!chk.ok} onClick={() => onDone(live)} data-manual-done="">Use these</button>
      <button type="button" className="linkbtn" onClick={onCancel} data-manual-cancel="">Cancel</button></div>
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
function Proof({ res }) {
  const parts = res.proof || [];
  return <div className={"pr-proof " + (res.ok ? "ok" : "bad")} data-proof={res.ok ? "ok" : "bad"} role="status">
    <p className="pr-line">{res.ok ? <Check width={14} height={14} aria-hidden="true" /> : <AlertTriangle width={14} height={14} aria-hidden="true" />} <b>{res.ok ? "Posted to Tally" : "Not posted"}</b></p>
    {parts.map((r) => <p key={r.id} className="pr-line" data-part={r.id}>{r.words}</p>)}
    {!parts.length && <p className="pr-line">{res.why}</p>}
    {(res.problems || []).length > 1 && <ul className="pr-list">{res.problems.map((w, i) => <li key={i}>{w}.</li>)}</ul>}
  </div>;
}
function TallyPreview({ co, rows, ledgers, onJournal, kept, tick, onUpdated }) {
  const pd = payData(), heads = pd.heads || {}, [, kick] = useState(0);
  const ym = (rows[0] || {}).month || "";
  const [ent, setEnt] = useState(undefined), [busy, setBusy] = useState(""), [res, setRes] = useState(null), [setup, setSetup] = useState(undefined), [past, setPast] = useState([]);
  useEffect(() => { let on = true; setEnt(undefined); TPost.loadEntry(co.id, ym).then((x) => on && setEnt(x)); return () => { on = false; }; }, [co.id, ym, res, tick]);
  useEffect(() => { let on = true; TPost.setupLink().then((x) => on && setSetup(x)); return () => { on = false; }; }, []);
  useEffect(() => { let on = true; if (ent && ent.state === "approved") import("../../lib/asstEntries.js").then((A) => TPost.proofOf(co.id, ym, A)).then((x) => on && setPast(x || [])).catch(() => {}); return () => { on = false; }; }, [ent && ent.state]);
  const ev = (ent && ent.voucher) || {};
  const p = TPost.prepare({ co, ym, rows, date: TPost.lastDay(ym), pay: pd, ledgers, books: books(), payable: ev.kind === "tallyPayroll" ? ev.party : "" });
  const pick = (k, v) => { co.payHeadPlan = Object.assign({}, co.payHeadPlan, { [k]: v }); saveCo(co); kick((x) => x + 1); };
  // (review 3) the salary payable ledger and the payroll voucher type, kept on the client as its other settings are
  const setCo = (k, v) => { if (v) co[k] = v; else delete co[k]; saveCo(co); kick((x) => x + 1); };
  const types = TPost.vchTypesOf(pd, books()), payables = ledgers.filter((l) => /payable|salar|outstanding|due/i.test(l));
  const br = TPost.postingBridge(co), brOk = TPost.bridgeOk(br.version), cloud = cloudOn();
  const going = ent && ent.state === "approving" && Date.now() - Date.parse(ent.updated_at || 0) < 30 * 60000;
  // (re-review 3) the night's findings are read by Approve itself (the owner's ledger picks), as Daily Check passes them;
  // (re-review 4) accept: the parts in Tally taken as they are, the rest posted
  const approve = async (accept) => {
    setBusy("Checking again…"); setRes(null);
    let r;
    try { r = await TPost.approveTallyPayroll(ent, { co, accept: accept === true, seen: accept === true ? undefined : p.vouchers.map(TP.payrollVoucherXml), progress: (v, pj) => setBusy((v.parts > 1 ? "Part " + v.part + " of " + v.parts + ": " : "") + ((pj && pj.message) || "Posting…")) }); }
    catch (x) { r = { ok: false, why: String((x && x.message) || x) }; }
    setBusy(""); setRes(r); say(r.ok ? r.words : r.why);
    // (review 3) the running month's entry made again from the salary kept now: the sheet shown is the one kept
    if (!r.ok && r.why === UPDATED && onUpdated) onUpdated(ym);
  };
  const net = p.vouchers.reduce((s, v) => s + v.net, 0), done = (ent && ent.state === "approved") || (res && res.ok);
  return <section className="pr-card" data-preview="tally">
    <div className="pr-title">Tally Payroll voucher · {PS.monLabel(ym)} {p.vouchers.length > 0 && <b className="pr-amt">{rs(net)}</b>} <span className={"pr-chip " + (done ? "ok" : p.problems.length || p.missing.length ? "bad" : "warn")} data-state="">{done ? "Approved" : p.problems.length || p.missing.length ? "Check first" : "To approve"}</span></div>
    <div className="pr-heads" data-tp-settings="">
      <label className="pr-hp">Salary payable ledger <select value={co.payrollPayable && ledgers.includes(co.payrollPayable) ? co.payrollPayable : ""} disabled={!canWrite()} onChange={(ev2) => setCo("payrollPayable", ev2.target.value)} aria-label="Salary payable ledger" data-pick-payable="">
        <option value="">{p.payable ? "As FinCom finds it (" + p.payable + ")" : "Pick the ledger"}</option>{(payables.length ? payables : ledgers).map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
      <label className="pr-hp">Voucher type <select value={co.payrollVchType || ""} disabled={!canWrite()} onChange={(ev2) => setCo("payrollVchType", ev2.target.value === "Payroll" ? "" : ev2.target.value)} aria-label="Payroll voucher type" data-pick-vchtype="">
        {types.map((t) => <option key={t} value={t === "Payroll" ? "" : t}>{t}</option>)}</select></label>
    </div>
    {p.missing.length > 0 && <div className="pr-heads">{p.missing.map((k) => <label key={k} className="pr-hp">{TP.keyWords(k)} → <select value={p.plan[k] || ""} onChange={(ev) => pick(k, ev.target.value)} aria-label={"Tally pay head for " + TP.keyWords(k)}>
      <option value="">Pick the pay head</option>{Object.keys(heads).map((h) => <option key={h} value={h}>{h}</option>)}</select></label>)}</div>}
    {p.problems.length > 0 && <div className="pr-need" data-need=""><p className="pr-line bad"><b>Before posting</b>, Tally needs:</p><ul className="pr-list">{p.problems.map((w, i) => <li key={i}>{w}.</li>)}</ul></div>}
    {p.vouchers.map((v) => <div key={v.id} className="pr-vch" data-voucher={v.id}>
      <p className="pr-line">{v.parts > 1 ? "Part " + v.part + " of " + v.parts + " · " : ""}{v.employees.length} employee{v.employees.length === 1 ? "" : "s"} · net {rs(v.net)} to <b>{v.payable}</b></p>
      <More label="Employees and pay heads" id={"emp-" + v.id}>{v.employees.map((e) => <div key={e.name} className="pr-emp"><b>{e.name}</b> <span className="note">{e.heads.map((h) => h.head + " " + rs(Math.abs(h.amount)) + (h.earn ? "" : " (ded.)")).join(" · ")}</span> <span className="pr-amt">{rs(-e.amount)}</span></div>)}</More>
      <More label="Tally XML" id={"xml-" + v.id}><pre className="pr-pre" data-xml="">{TP.payrollVoucherXml(v)}</pre>
        <p className="note">One payroll voucher, Create only, in a posting of its own. FinCom creates no employee or pay head.</p></More>
    </div>)}
    <p className="pr-line note" data-employer-note="">The employer’s PF and ESI are not in this voucher: book them in Tally separately, as now.</p>
    {res && (!res.ok && res.why === UPDATED ? <p className="pr-line" data-updated=""><Check width={14} height={14} aria-hidden="true" className="pr-ok" /> {res.why}</p> : <Proof res={res} />)}
    {res && res.stuck && res.canAccept && canWrite() && <div className="pr-acts"><button type="button" className="btn small" disabled={!!busy} onClick={() => approve(true)} data-accept-part="">Accept what is in Tally and post the rest</button></div>}
    {!res && past.length > 0 && <Proof res={{ ok: true, proof: past }} />}
    {!done && p.vouchers.length > 0 && (!brOk ? <p className="pr-line pr-install" data-install=""><AlertTriangle width={14} height={14} aria-hidden="true" /> {TPost.OLD_BRIDGE}{br.version ? " (" + (br.where || "the posting computer") + " has " + br.version + ")" : ""}.{" "}
        {setup ? <a className="btn small primary" href={setup.href} download={setup.file} data-bridge-download="">Download FinCom Bridge {setup.version}</a> : <span className="note">Download it on the Tally page.</span>}</p>
      : !cloud ? <p className="pr-line note" data-no-cloud="">Sign in to the firm account to approve.</p>
      : ent === undefined ? <p className="pr-line note">Reading…</p>
      : !ent ? <p className="pr-line note" data-no-entry="">{kept ? "Kept with the books. Tonight’s Daily Check checks it; then Approve it here." : "Keep this sheet with the books first. Tonight’s Daily Check checks it; then Approve it here."}</p>
      : going && !busy ? <p className="pr-line note" data-going="">Someone is approving it now.</p>
      : <div className="pr-acts"><button type="button" className="btn small primary" disabled={!!busy || !canWrite()} onClick={() => approve(false)} data-approve="">{busy ? "Posting…" : "Approve and post to Tally"}</button>
        {busy ? <span className="note" data-busy="">{busy}</span> : <span className="note">FinCom checks it again first.</span>}</div>)}
    {owner() && !done && <div className="pr-acts"><button type="button" className="linkbtn" onClick={onJournal} data-journal-once="">Post as a journal this month</button></div>}
  </section>;
}

// ---------------------------------------------------------------- 5. make the journal now
const LIVE = "ready,held,approving,approved,rejected";
async function madeOf(cid, ym) {
  try { const r = await Cloud.api("night_entries?select=id,state&client_id=eq." + encodeURIComponent(cid) + "&source=eq.payroll&dedupe=eq." + encodeURIComponent(TPost.dedupeOf(ym)) + "&state=in.(" + LIVE + ")&limit=1"); return (r || [])[0] || null; }
  catch (e) { return undefined; }
}
const openDaily = (tab, id) => { try { S.dcTab = tab; S.dcOpen = id || ""; if (typeof navHome === "function") navHome("daily"); } catch (e) { /* stays here */ } };
function MakeNow({ co, ym, tally, onState, saved }) {
  const [ex, setEx] = useState(undefined), [busy, setBusy] = useState(false), [said, setSaid] = useState(null), [auto, setAuto] = useState(false);
  const what = tally ? "Tally Payroll entry" : "journal", label = PS.monLabel(ym), running = ym === nowYm();
  const make = async (by) => {
    setBusy(true); setAuto(by === true);
    // (review 4) a person's press is their new decision (press: a month set aside on Daily Check is made again); the update
    // after a save is not, and keeps their choice: then nothing is said, the button stays
    const r = Object.assign({}, await payrollNowCall(co.id, ym, by === true ? null : { press: true }), by === true ? { auto: true } : {});
    setBusy(false); setAuto(false); setSaid(r.auto && r.kind === "kept" ? null : r);
    if (r.kind === "made" || r.kind === "updated" || r.kind === "already") { setEx({ id: r.id, state: r.state }); onState(true, r.kind !== "already"); }
    // (re-review 1, review 3) the running month's entry taken back (its new figures need a person, the month was set aside
    // on Daily Check, or there is nothing to make now); (review 4) Needs you (or set aside): the "Kept. Daily Check makes
    // its journal ..." line is not true, so not shown
    else if (r.kind === "you" || r.kind === "kept") { setEx(null); onState("you", !!r.withdrawn); }
    else if (r.withdrawn) { setEx(null); onState(false, true); }
  };
  // (review 3) the running month's salary just kept (or replaced) and its entry still ready or held: made again by itself
  useEffect(() => { let on = true; setEx(undefined); setSaid(null); onState(false);
    madeOf(co.id, ym).then((x) => { if (!on) return; setEx(x); onState(!!x);
      if (saved && running && x && (x.state === "ready" || x.state === "held") && canWrite()) make(true); });
    return () => { on = false; }; }, [co.id, ym, tally, saved]);
  if (ym > nowYm() || ex === undefined) return null;
  const where = tally ? "Approve it on this page." : "Approve it on Daily Check › Entries.";
  const open = (id) => !tally && <button type="button" className="linkbtn" onClick={() => openDaily("entries", id)} data-now-open="">Open it</button>;
  const k = said ? said.kind : ex ? "already" : "";
  const state = (said && said.state) || (ex && ex.state) || "";
  const done = { approved: " and approved", approving: " and is being approved", rejected: ", and rejected on Daily Check" }[state] || "";
  // (review 6) Daily Check › Entries lists an entry ready or being approved only: an approved or rejected one has no "Open it"
  // (re-review 1) the running month, still ready or held: made again from the salary kept now (the same entry, new figures)
  const again = running && (state === "ready" || state === "held") && canWrite() && <> <button type="button" className="linkbtn" disabled={busy} onClick={make} data-make-again="">{busy ? "Making…" : "Make the " + what + " now again"}</button></>;
  const youLink = <button type="button" className="linkbtn" onClick={() => openDaily("you")} data-now-you="">Open Needs you</button>;
  return <section className="pr-card" data-make-now-card="">
    {auto ? <p className="pr-line note" data-now-busy="">Updating the {what} for {label} with the new figures…</p>
      : (k === "updated" || k === "made") && said.auto ? <p className="pr-line" data-now-said=""><Check width={14} height={14} aria-hidden="true" className="pr-ok" /> <b>The {what} for {label} is updated with the new figures.</b> {where} {open(said.id)}</p>
      : k === "made" || k === "updated" ? <p className="pr-line" data-now-said=""><Check width={14} height={14} aria-hidden="true" className="pr-ok" /> <b>{k === "updated" ? "Made again from the salary kept now." : "Made."}</b> {where} It goes to Tally only when you approve it.{said.running ? " " + said.words : ""} {open(said.id)}{again}</p>
      : k === "already" ? <p className="pr-line" data-now-said="">The {what} for {label} is already made{done}. {done ? "" : where} {state !== "approved" && state !== "rejected" && open((said && said.id) || ex.id)}{again}</p>
      : k === "you" ? <p className="pr-line" data-now-said="">{said.words} It is on Daily Check › Needs you. <button type="button" className="linkbtn" onClick={() => openDaily("you")} data-now-you="">Open Daily Check</button></p>
      : k === "kept" && said.client ? <p className="pr-line" data-now-said="">{said.words || "Waiting for the client’s answer for " + label + " on Daily Check › From clients."} <button type="button" className="linkbtn" onClick={() => openDaily("clients")} data-now-clients="">Open From clients</button></p>
      : k === "kept" ? <p className="pr-line" data-now-said="">{said.words || "Daily Check needs you for " + label + "."} {youLink}</p>
      : <>
        <div className="pr-acts"><button type="button" className="btn small primary" disabled={busy || !canWrite()} onClick={make} data-make-now="">{busy ? "Making…" : "Make the " + what + " now"}</button>
          <span className="note">{running ? label + " isn’t over yet. The " + what + " is made from the salary kept now." : "Daily Check would make it tonight. Make it now to approve it today."}</span></div>
        {said && <p className="pr-line note" data-now-said="">{said.words}</p>}
      </>}
  </section>;
}

// (re-review 1) the "Replace them" confirm, when the month's entry is made: what replacing the salary does to it
function madeWords(x, what, ym) {
  const m = PS.monLabel(ym);
  if (x.state === "approved" || x.state === "approving") return " The " + what + " for " + m + " is already approved; replacing the salary does not change the entry already sent to Tally.";
  return " A " + what + " is already made for " + m + "; " + (ym === nowYm() ? "replacing updates it with the new figures." : "it is updated with the new figures tonight.");
}

// ---------------------------------------------------------------- the months kept with the books (b.salary)
const monthOfRow = (r) => r.month || String(r.date || "").slice(0, 7).replace("-", "");
function keptMonths(salary) {
  const by = new Map();
  (salary || []).forEach((r) => { const m = monthOfRow(r); if (!/^\d{6}$/.test(m)) return; if (!by.has(m)) by.set(m, []); by.get(m).push(r); });
  return Array.from(by.keys()).sort().reverse().map((m) => ({ ym: m, rows: by.get(m) }));
}
function KeptMonths({ list, onOpen, onEdit }) {
  const [all, setAll] = useState(false), shown = all ? list : list.slice(0, 6);
  return <section className="pr-card" data-kept-months="">
    <div className="pr-title"><Check width={15} height={15} aria-hidden="true" />Kept with the books</div>
    {shown.map(({ ym, rows }) => { const g = rows.reduce((s, r) => s + (Number(r.gross) || 0), 0), hand = rows.every((r) => r.src === "manual");
      return <p className="pr-line pr-kept" key={ym} data-kept={ym}><b>{PS.monLabel(ym)}</b> · {rows.length} employee{rows.length === 1 ? "" : "s"} · gross {rs(g)} · {hand ? "typed in" : "from a sheet"}{" "}
        <button type="button" className="linkbtn" onClick={() => onOpen(ym, rows)} data-kept-open={ym}>Open</button>{" "}
        <button type="button" className="linkbtn" onClick={() => onEdit(ym, rows)} data-kept-edit={ym}>Change by hand</button></p>; })}
    {list.length > 6 && !all && <button type="button" className="linkbtn" onClick={() => setAll(true)}>All {list.length} months</button>}
  </section>;
}

// ---------------------------------------------------------------- the page
export default function PayrollPage() {
  const co = CO(), [st, setSt] = useState(null), [manual, setManual] = useState(false), [ym, setYm] = useState(curYm()), [ledgers, setLedgers] = useState([]), [kept, setKept] = useState(false), [sure, setSure] = useState(false), [drafts, setDrafts] = useState({}), [sureMade, setSureMade] = useState(null), [, kick] = useState(0), [made, setMade] = useState(false), [tick, setTick] = useState(0), [saved, setSaved] = useState(0);
  useEffect(() => { let on = true; import("../../lib/asstEntries.js").then((A) => A.clientLedgers(co)).then((l) => { if (on && l) setLedgers(l.map((x) => x.name)); }).catch(() => {}); return () => { on = false; }; }, [co && co.id]);
  useEffect(() => { if (co && !(S.books && S.books.cid === co.id) && typeof openBooks === "function") Promise.resolve(openBooks(co.id)).then(() => kick((x) => x + 1), () => {}); }, [co && co.id]);
  if (!co) return null;
  const method = PS.methodOf(co);
  // the ledgers: the cloud copy's list (as Approve checks them), else the books open here (ledger -> group)
  const led = ledgers.length ? ledgers : Object.keys(books().under || {});
  const take = async (f) => {
    if (!f) return;
    setManual(false); setKept(false); setSaved(0);
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
  // (review 7) a month kept before (for 24Q too) is replaced only once the person has seen it said
  const was = rows && !kept ? PS.replacing(books().salary, rows) : { n: 0 };
  // (review) the month's entry already made or approved: the confirm says so (looked up as it is asked; Replace waits for it)
  const keep = async () => {
    if (was.n && !sure) {
      setSure(true); setSureMade(cloudOn() ? undefined : null);
      if (cloudOn()) madeOf(co.id, month).then((x) => setSureMade(x && x.state !== "rejected" ? x : null), () => setSureMade(null));
      return;
    }
    const b = books(); b.salary = PS.mergeSalary(b.salary, rows); try { await saveBooks(); } catch (e) { /* kept here */ } setKept(true); setSure(false); setSaved(Date.now()); if (st && st.how === "manual") putDraft(month, null); say(rows.length + " employee" + (rows.length === 1 ? "" : "s") + " kept for " + PS.monLabel(month) + ".");
  };
  // by hand: a draft per month (review B1), so nothing typed is lost and nothing is asked: the month's own draft typed so
  // far, else the rows given (Change by hand on a month kept, from a sheet too), else the month's rows typed in and kept
  // with the books, else a blank row
  const draft = drafts[ym] || null;
  const putDraft = (m, d) => setDrafts((o) => { const n = Object.assign({}, o); if (d) n[m] = d; else delete n[m]; return n; });
  const typed = (d) => !!(d && d.t.some((x) => String(x.name || "").trim()));
  const keptDraft = (m, rows0) => { const r = rows0 || (keptMonths(books().salary).find((x) => x.ym === m) || {}).rows; return r && (rows0 || r.every((x) => x.src === "manual")) ? draftOf(r) : null; };
  const openManual = (m, rows0) => {
    const k = m || ym;
    if (!typed(drafts[k])) putDraft(k, keptDraft(k, rows0));
    setYm(k); setSt(null); setKept(false); setSaved(0); setSure(false); setManual(true);
  };
  // the month changed while typing: the rows typed go with it, unless that month has rows of its own (then they are shown,
  // and these stay with their month)
  const manualMonth = (m) => {
    if (!/^\d{6}$/.test(m) || m === ym) return;
    const cur = drafts[ym];
    if (!typed(drafts[m]) && typed(cur)) setDrafts((o) => { const n = Object.assign({}, o); n[m] = cur; delete n[ym]; return n; });
    else if (!typed(drafts[m])) putDraft(m, keptDraft(m) || (cur ? { heads: cur.heads, t: [{}] } : null));
    setYm(m);
  };
  const openKept = (m, r) => { setManual(false); setYm(m); setSure(false); setSaved(0); setSt({ step: "read", rows: r, skipped: [], how: "kept", rule: null }); setKept(true); };
  const kept0 = keptMonths(books().salary);
  // (review 9) the month of a sheet with no month column: picked on the start card (last month at first); a sheet read by
  // its saved rule is read again for the month picked
  const pickMonth = (v) => {
    const m = String(v || "").replace("-", ""); if (!/^\d{6}$/.test(m)) return;
    setYm(m); setKept(false); setSure(false);
    if (st && st.step === "read" && st.rule && st.grid && !(st.rule.map || {}).month && !(st.rule.map || {}).date) setSt(Object.assign({}, st, PS.apply(st.rule, st.grid, st.hi, { month: m })));
  };
  const once = month && (co.payrollJournal || {})[month];
  const toggleOnce = () => { co.payrollJournal = Object.assign({}, co.payrollJournal); if (once) delete co.payrollJournal[month]; else co.payrollJournal[month] = { by: who(), at: new Date().toISOString() }; saveCo(co); kick((x) => x + 1); };
  return <div className="pr" data-payroll="">
    <Method co={co} onChange={() => kick((x) => x + 1)} />
    {(!st || st.step === "read") && <section className="pr-card pr-start">
      <label className="btn small primary pr-file"><Upload width={14} height={14} aria-hidden="true" />Salary sheet<input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" data-sheet-in="" onChange={(ev) => { const f = (ev.target.files || [])[0]; ev.target.value = ""; take(f); }} /></label>
      {!manual && <label className="pr-inline pr-month" data-sheet-month="">Month <input type="month" value={ym.slice(0, 4) + "-" + ym.slice(4)} onChange={(ev) => pickMonth(ev.target.value)} aria-label="Month of the salary sheet" /></label>}
      {!manual && <button type="button" className="btn small" onClick={() => openManual()} data-manual="">Enter by hand</button>}
      <span className="note">{(co.payrollFormats || []).filter((r) => !r.deleted).length} saved layout{(co.payrollFormats || []).filter((r) => !r.deleted).length === 1 ? "" : "s"}</span>
    </section>}
    {st && st.step === "map" && (st.busy ? <section className="pr-card"><p className="pr-line note">Reading the columns…</p></section> : <MapStep st={st} setSt={setSt} co={co} />)}
    {manual && <Manual ym={ym} setYm={manualMonth} draft={draft} setDraft={(d) => putDraft(ym, d)} onCancel={() => setManual(false)}
      onDone={(r) => { setManual(false); setSt({ step: "read", rows: r, skipped: [], how: "manual", rule: null }); }} />}
    {rows && <Summary rows={rows} chk={chk} how={st.how} rule={st.rule} onKeep={keep} kept={kept} method={method} made={made} />}
    {rows && kept && chk.ok && method && month && cloudOn() && canWrite() && <MakeNow co={co} ym={month} tally={method === "tally" && !once} saved={saved} onState={(m, fresh) => { setMade(m); if (fresh) setTick((x) => x + 1); }} />}
    {rows && sure && was.n > 0 && <p className="pr-line pr-warn" data-replace-warn="">{PS.monLabel(was.months[0] || month)} already has {was.n} employee{was.n === 1 ? "" : "s"} kept with the books{was.tax ? ", " + was.tax + " of them with 24Q’s figures" : ""}. Keeping this sheet replaces them.{sureMade ? madeWords(sureMade, method === "tally" && !once ? "Tally Payroll entry" : "journal", month) : ""}{was.tax ? " " + was.carried.length + " employee" + (was.carried.length === 1 ? "" : "s") + " carry over their exemptions, deductions, regime and PAN (matched by code, PAN or name)" + (was.missed.length ? "; not carried over, as this sheet has no one of the same code, PAN or name: " + was.missed.slice(0, 8).join(", ") + (was.missed.length > 8 ? " and " + (was.missed.length - 8) + " more" : "") : "") + "." : ""} <button type="button" className="btn small" disabled={sureMade === undefined} onClick={keep} data-keep-sure="">Replace them</button> <button type="button" className="linkbtn" onClick={() => setSure(false)}>Cancel</button></p>}
    {rows && chk.ok && (method === "tally" && !once ? <TallyPreview co={co} rows={rows} ledgers={led} onJournal={toggleOnce} kept={kept} tick={tick} onUpdated={(m) => { const x = keptMonths(books().salary).find((k) => k.ym === m); if (x) openKept(m, x.rows); }} />
      : <JournalPreview co={co} rows={rows} ledgers={led} asOnce={method === "tally" && !!once} />)}
    {rows && chk.ok && method === "tally" && once && owner() && <p className="pr-line"><button type="button" className="linkbtn" onClick={toggleOnce}>Post as Tally Payroll instead</button></p>}
    {rows && chk.ok && !method && <p className="pr-line note">Set how this company books salary to see the entry.</p>}
    {kept0.length > 0 && !manual && !(st && st.step === "map") && <KeptMonths list={kept0} onOpen={openKept} onEdit={(m, r) => openManual(m, r)} />}
  </div>;
}
