// Income Tax Return, step 2: the schedules with lists of their own (in the ITR chunk with ITR.jsx). Salary (Schedule S,
// from Form 16), house property (HP, the AIS rent shown), capital gains (CG, the AIS sales offered as rows), assets and
// liabilities (AL), foreign assets (FA), the shareholding of an unlisted company (SH) and AL-1, other comprehensive
// income of an Ind AS company. Each list is kept in the return's state (b.itr "2026|state"); the computation (heads.js)
// works each head at once and shows its figure. FA, SH and AL-1 are drawn from the official schema's own fields, so
// what is entered is what the JSON carries.
import { useState } from "react";
import { money } from "../../lib/itr/sheet.js";
import { salaryFromForm16, CG_KINDS } from "../../lib/itr/heads.js";
import { nodeAt } from "../../lib/itr/sched.js";
import { ROOT } from "../../lib/itr/forms.js";

const ymdIn = (d) => (d && /^\d{8}$/.test(d) ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : "");
const ymdOut = (s) => String(s || "").replace(/-/g, "");
const num = (v) => (v === "" || v == null ? "" : +String(v).replace(/[^0-9.-]/g, "") || 0);
const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const NATURE = [["OTH", "Others (private)"], ["CGOV", "Central Government"], ["SGOV", "State Government"], ["PSU", "Public sector"], ["PE", "Pensioner, Central Govt"], ["PESG", "Pensioner, State Govt"], ["PEPS", "Pensioner, PSU"], ["PEO", "Pensioner, others"]];
const EXEMPT = ["10(13A)", "10(5)", "10(10)", "10(10A)", "10(10AA)", "10(10B)(i)", "10(10B)(ii)", "10(10C)", "10(10CC)", "10(14)(i)", "10(14)(ii)", "10(14)(i)(115BAC)", "10(14)(ii)(115BAC)", "10(6)", "10(7)", "10(17)", "EIC"];
const CGEX = ["54", "54B", "54D", "54EC", "54F", "54G", "54GA"];
const FYS = Array.from({ length: 25 }, (_, i) => String(2001 + i));
const BUCKET = { s111A: "111A at 20%", stApp: "short-term, normal rates", s112A: "112A at 12.5% above Rs 1.25 lakh", s112: "112 at 12.5%" };

function F({ label, children, wide }) { return <label className={"itr-field" + (wide ? " itr-wide" : "")}><span>{label}</span>{children}</label>; }
function Num({ label, v, on, k }) { return <F label={label}><input inputMode="numeric" data-itr-in={k} value={v ?? ""} onChange={(e) => on(num(e.target.value))} /></F>; }
function Txt({ label, v, on, k, up }) { return <F label={label}><input data-itr-in={k} value={v ?? ""} onChange={(e) => on(up ? e.target.value.toUpperCase() : e.target.value)} /></F>; }
function Day({ label, v, on, k }) { return <F label={label}><input type="date" data-itr-in={k} value={ymdIn(v)} onChange={(e) => on(ymdOut(e.target.value))} /></F>; }
function Sel({ label, v, on, opts, k }) { return <F label={label}><select data-itr-in={k} value={v ?? ""} onChange={(e) => on(e.target.value)}>{opts.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></F>; }
function Addr({ a, on, k }) {
  const x = a || {}, set = (f, v) => on(Object.assign({}, x, { [f]: v }));
  return <><Txt label="Address" k={k + "-line"} v={x.line} on={(v) => set("line", v)} /><Txt label="City" k={k + "-city"} v={x.city} on={(v) => set("city", v)} />
    <Txt label="State code (07 Delhi …)" k={k + "-state"} v={x.state} on={(v) => set("state", v.replace(/\D/g, "").slice(0, 2))} /><Txt label="PIN" k={k + "-pin"} v={x.pin} on={(v) => set("pin", v.replace(/\D/g, "").slice(0, 6))} /></>;
}
// a list of small rows (exemptions, loans, tenants ...): each a line of fields, "Add" and "Remove"
function Sub({ title, rows, on, blank, render, k }) {
  const rs = rows || [];
  return <div className="itr-sub2" data-itr-sub={k}><div className="itr-sub2-h"><span>{title}</span><button className="linkbtn" data-itr-add={k} onClick={() => on(rs.concat([Object.assign({}, blank)]))}>Add</button></div>
    {rs.map((r, i) => <div key={i} className="itr-grid itr-subrow">{render(r, (p) => on(rs.map((y, j) => (j === i ? Object.assign({}, y, p) : y))))}
      <button className="linkbtn itr-rm" onClick={() => on(rs.filter((_, j) => j !== i))}>Remove</button></div>)}</div>;
}
// one item of a schedule's list: a line with its figure, opened to edit
function Item({ title, figure, sub, open, onOpen, onRemove, children, k }) {
  return <div className="itr-file" data-itr-item={k}>
    <button className="itr-file-main" onClick={onOpen} aria-expanded={open}><span className="itr-dot" data-tone="ok" /><span className="itr-file-l">{title}</span><span className="itr-file-r">{sub ? sub + " · " : ""}{figure}</span></button>
    {open && <div className="itr-file-more itr-edit">{children}<button className="linkbtn itr-rm" data-itr-remove-item={k} onClick={onRemove}>Remove this</button></div>}
  </div>;
}
function Card({ title, chip, note, k, children, action }) {
  return <section className="itr-card" data-itr-sched={k}><div className="itr-card-head"><h2>{title}</h2><div className="itr-actions">{chip != null && <span className="itr-chip" data-itr-head={k}>{chip}</span>}{action}</div></div>
    {note && <p className="itr-note">{note}</p>}{children}</section>;
}

export default function Schedules({ X, refresh, schema }) {
  const st = X.state, M = X.model, ent = X.client.entity, ind = ent === "P" || ent === "H";
  const set = (p) => { X.store.setState(p); refresh(); };
  const [open, setOpen] = useState("");
  const tog = (k) => setOpen(open === k ? "" : k);
  const f = X.form;
  return <div className="itr-stack" data-itr-schedules="">
    {ent === "P" && (f === "ITR-3" || f === "ITR-4") && <Salary X={X} set={set} open={open} tog={tog} />}
    <Houses X={X} set={set} open={open} tog={tog} />
    <Gains X={X} set={set} open={open} tog={tog} />
    {ind && f === "ITR-3" && <AL X={X} set={set} />}
    {f !== "ITR-4" && <Foreign X={X} set={set} schema={schema} />}
    {f === "ITR-6" && (st.profile || {}).listed !== true && <Lists X={X} set={set} schema={schema} k="sh" title="Shareholding (Schedule SH)" path="ScheduleSH/ShrhldngUnlistedCompany" startPath="ScheduleSH/ShrhldngStartUps"
      note="An unlisted company: every shareholder at 31-03-2026, share application money pending, and anyone who stopped being a shareholder in the year. The share capital is checked against the balance sheet." />}
    {f === "ITR-6" && (st.profile || {}).listed !== true && <Lists X={X} set={set} schema={schema} k="al6" title="Assets and liabilities (Schedule AL-1)" path="ScheduleAL/AsstLiabilitiesUnlistedCompany" startPath="ScheduleAL/AsstLiabilitiesStartUps"
      note="An unlisted company: its land and buildings, shares and securities, loans given and taken, vehicles and jewellery at the year end. Checked against the balance sheet." />}
    {f === "ITR-6" && (st.profile || {}).indAs === true && <Oci X={X} set={set} />}
    <Other X={X} set={set} />
    {f !== "ITR-4" && <Losses X={X} set={set} />}
    {M.form === "ITR-4" && <p className="itr-note">ITR-4 takes one house and long-term gains under 112A up to Rs 1.25 lakh; anything more needs ITR-3.</p>}
  </div>;
}

// ---------------- Salary ----------------
function Salary({ X, set, open, tog }) {
  const rows = X.state.salaries || [], sh = X.model.salaryHead, f16 = (X.imports.f16 || []).filter((x) => x.data && !rows.some((r) => r.tan && r.tan === x.data.tan));
  const upd = (i, p) => set({ salaries: rows.map((r, j) => (j === i ? Object.assign({}, r, p) : r)) });
  return <Card k="salary" title="Salary (Schedule S)" chip={sh ? money(sh.income) : null} note={sh ? "Gross " + money(sh.gross) + " · exempt " + money(sh.exempt) + " · standard deduction " + money(sh.std) + (sh.ptax ? " · professional tax " + money(sh.ptax) : "") : "From Form 16 (bring it in on Data), or give the employer."}
    action={<button className="linkbtn" data-itr-add-salary="" onClick={() => set({ salaries: rows.concat([{ id: newId(), employer: "", nature: "", exempt: [] }]) })}>Add an employer</button>}>
    {f16.map((x) => <p key={x.id} className="itr-note" data-itr-f16-offer={x.data.tan}>{"Form 16 of " + (x.data.employer || x.data.tan) + ": salary " + money(x.data.s171 + x.data.s172 + x.data.s173) + ", TDS " + money(x.data.tds) + " "}
      <button className="linkbtn" data-itr-take-f16={x.data.tan} onClick={() => set({ salaries: rows.concat([Object.assign({ id: newId() }, salaryFromForm16(x.data))]) })}>Take it</button></p>)}
    {rows.map((r, i) => { const c = sh && sh.rows[i];
      return <Item key={r.id || i} k={"salary-" + i} title={r.employer || "Employer " + (i + 1)} sub={r.src === "Form 16" ? "from Form 16" : ""} figure={c ? money(c.net) : ""} open={open === "s" + i} onOpen={() => tog("s" + i)} onRemove={() => set({ salaries: rows.filter((_, j) => j !== i) })}>
        <div className="itr-grid">
          <Txt label="Employer" k="employer" v={r.employer} on={(v) => upd(i, { employer: v })} /><Txt label="TAN" k="tan" up v={r.tan} on={(v) => upd(i, { tan: v })} />
          <Sel label="Kind of employer" k="nature" v={r.nature || ""} opts={[["", "Choose"]].concat(NATURE)} on={(v) => upd(i, { nature: v })} />
          <Num label="Salary, 17(1)" k="s171" v={r.s171} on={(v) => upd(i, { s171: v })} /><Num label="Perquisites, 17(2)" k="s172" v={r.s172} on={(v) => upd(i, { s172: v })} /><Num label="Profits in lieu, 17(3)" k="s173" v={r.s173} on={(v) => upd(i, { s173: v })} />
          <Num label="Basic + DA (needed for HRA, 80CCD(2))" k="basicDa" v={r.basicDa} on={(v) => upd(i, { basicDa: v })} /><Num label="Professional tax paid" k="ptax" v={r.ptax} on={(v) => upd(i, { ptax: v })} />
          {(r.nature === "CGOV" || r.nature === "SGOV") && <Num label="Entertainment allowance" k="ent" v={r.ent} on={(v) => upd(i, { ent: v })} />}
          <Addr a={r.addr} k="saddr" on={(v) => upd(i, { addr: v })} />
        </div>
        <Sub k="exempt" title="Exempt under section 10" rows={r.exempt} blank={{ sec: "10(13A)", amt: "" }} on={(v) => upd(i, { exempt: v })} render={(e, p) => <>
          <Sel label="Section" v={e.sec} opts={EXEMPT.map((x) => [x, x])} on={(v) => p({ sec: v })} />{e.sec !== "10(13A)" || !r.hra ? <Num label="Amount" v={e.amt} on={(v) => p({ amt: v })} /> : <span className="itr-note">Worked out from the HRA lines below</span>}</>} />
        {(r.exempt || []).some((e) => e.sec === "10(13A)") && <div className="itr-grid" data-itr-hra="">
          <label className="itr-field itr-tick"><input type="checkbox" checked={!!(r.hra && r.hra.metro)} onChange={(e) => upd(i, { hra: Object.assign({}, r.hra, { metro: e.target.checked }) })} /><span>Lives in a metro (50%)</span></label>
          <Num label="HRA received" k="hra-rec" v={r.hra && r.hra.received} on={(v) => upd(i, { hra: Object.assign({}, r.hra, { received: v }) })} /><Num label="Rent paid in the year" k="hra-rent" v={r.hra && r.hra.rent} on={(v) => upd(i, { hra: Object.assign({}, r.hra, { rent: v }) })} />
          {c && c.hra && <p className="itr-note">{"HRA exempt: " + money(c.hra.eligible) + " (the least of " + money(c.hra.received) + ", " + money(c.hra.rent10) + ", " + money(c.hra.pc) + ")"}</p>}</div>}
        {c && <p className="itr-note">{"Gross " + money(c.gross) + " · exempt " + money(c.exempt) + (X.model.regime === "new" ? " · new regime: HRA, LTA and 10(14) allowances are not exempt" : "") + (c.tds ? " · TDS in Form 16 " + money(c.tds) : "")}</p>}
      </Item>; })}
  </Card>;
}

// ---------------- House property ----------------
const KIND = [["L", "Let out"], ["S", "Self-occupied"], ["D", "Deemed let out"]];
function Houses({ X, set, open, tog }) {
  const rows = X.state.houses || [], hh = X.model.hpHead, ent = X.client.entity, ind = ent === "P" || ent === "H";
  const ais = X.imports.ais && X.imports.ais.data ? X.imports.ais.data.rows.filter((r) => r.cat === "rent") : [];
  const upd = (i, p) => set({ houses: rows.map((r, j) => (j === i ? Object.assign({}, r, p) : r)) });
  return <Card k="hp" title="House property (Schedule HP)" chip={hh ? money(hh.total) : null}
    note={(ais.length ? "AIS shows rent of " + money(ais.reduce((s, x) => s + (+x.amount || 0), 0)) + " (" + ais.map((x) => x.src || x.desc).filter(Boolean).join(", ") + "). " : "") + (hh ? "The owner's share of rent " + money(hh.rentOwn) + "." : "Each house the person owns: let out, self-occupied (at most two) or deemed let out.")}
    action={<button className="linkbtn" data-itr-add-house="" onClick={() => set({ houses: rows.concat([{ id: newId(), kind: "L", share: 100, loans: [], tenants: [] }]) })}>Add a house</button>}>
    {rows.map((r, i) => { const c = hh && hh.props[i];
      return <Item key={r.id || i} k={"house-" + i} title={(r.addr && (r.addr.line || r.addr.city)) || "House " + (i + 1)} sub={(KIND.find((x) => x[0] === r.kind) || KIND[0])[1]} figure={c ? money(c.income) : ""} open={open === "h" + i} onOpen={() => tog("h" + i)} onRemove={() => set({ houses: rows.filter((_, j) => j !== i) })}>
        <div className="itr-grid">
          <Sel label="The house is" k="kind" v={r.kind || "L"} opts={ind ? KIND : KIND.filter((x) => x[0] !== "S")} on={(v) => upd(i, { kind: v })} />
          <Num label="Own share %" k="share" v={r.share ?? 100} on={(v) => upd(i, { share: v })} />
          {r.kind !== "S" && <><Num label={r.kind === "D" ? "Expected rent for the year" : "Rent for the year"} k="rent" v={r.rent} on={(v) => upd(i, { rent: v })} /><Num label="Rent not realised" k="unrealised" v={r.unrealised} on={(v) => upd(i, { unrealised: v })} />
            <Num label="Municipal tax paid in the year" k="muni" v={r.muniTax} on={(v) => upd(i, { muniTax: v })} /><Num label="Arrears / unrealised rent received (25A)" k="arrears" v={r.arrears} on={(v) => upd(i, { arrears: v })} />
            {X.model.business && <><Num label="Of the rent, credited in the books' P&L" k="inbooks" v={r.inBooks} on={(v) => upd(i, { inBooks: v })} /><Num label="Its expenses debited in the P&L" k="inbooksexp" v={r.inBooksExp} on={(v) => upd(i, { inBooksExp: v })} /></>}</>}
          <Addr a={r.addr} k="haddr" on={(v) => upd(i, { addr: v })} />
          {r.kind === "S" && <label className="itr-field itr-tick"><input type="checkbox" checked={!!r.oldLoan} onChange={(e) => upd(i, { oldLoan: e.target.checked })} /><span>Loan before 1-04-1999 or for repairs (Rs 30,000)</span></label>}
          {(r.loans || []).length > 0 && <Num label="Interest before the house was ready (total; a fifth each year for 5 years)" k="preconst" v={r.preConst} on={(v) => upd(i, { preConst: v })} />}
        </div>
        <Sub k="loans" title="Loans for the house (interest, 24(b))" rows={r.loans} blank={{ from: "B", bank: "", account: "", date: "", total: "", outstanding: "", interest: "" }} on={(v) => upd(i, { loans: v })} render={(l, p) => <>
          <Sel label="From" v={l.from || "B"} opts={[["B", "Bank"], ["I", "Other than a bank"]]} on={(v) => p({ from: v })} /><Txt label="Lender" v={l.bank} on={(v) => p({ bank: v })} /><Txt label="Loan account" v={l.account} on={(v) => p({ account: v })} />
          <Day label="Date of loan" v={l.date} on={(v) => p({ date: v })} /><Num label="Loan amount" v={l.total} on={(v) => p({ total: v })} /><Num label="Outstanding at 31-03-2026" v={l.outstanding} on={(v) => p({ outstanding: v })} /><Num label="Interest for the year (own share)" v={l.interest} on={(v) => p({ interest: v })} /></>} />
        {r.kind === "L" && <Sub k="tenants" title="Tenants" rows={r.tenants} blank={{ name: "", pan: "" }} on={(v) => upd(i, { tenants: v })} render={(t, p) => <><Txt label="Tenant" v={t.name} on={(v) => p({ name: v })} /><Txt label="PAN / TAN" up v={t.pan} on={(v) => p({ pan: v })} /></>} />}
        {+(r.share ?? 100) < 100 && <Sub k="coowners" title="Co-owners" rows={r.coOwners} blank={{ name: "", pan: "", share: "" }} on={(v) => upd(i, { coOwners: v })} render={(t, p) => <><Txt label="Co-owner" v={t.name} on={(v) => p({ name: v })} /><Txt label="PAN" up v={t.pan} on={(v) => p({ pan: v })} /><Num label="Share %" v={t.share} on={(v) => p({ share: v })} /></>} />}
        {c && <p className="itr-note" data-itr-hp-line={i}>{r.kind === "S" ? "Self-occupied: interest allowed " + money(c.interestAllowed) + (X.model.regime === "new" ? " (none in the new regime)" : " (at most Rs 2 lakh in all)")
          : "Annual value " + money(c.av) + " · own share " + money(c.own) + " · 30% " + money(c.std30) + " · interest " + money(c.interestAllowed) + (c.arrears ? " · arrears " + money(c.arrears) : "") + " · income " + money(c.income)}</p>}
      </Item>; })}
  </Card>;
}

// ---------------- Capital gains ----------------
function Gains({ X, set, open, tog }) {
  const rows = X.state.cgRows || [], g = X.model.cgHead, C = X.comp.carry || {};
  const ais = X.imports.ais && X.imports.ais.data ? X.imports.ais.data.rows.filter((r) => r.cat === "cgsale" || r.cat === "cgprop") : [];
  const keyOf = (x) => [x.code, x.src || x.desc, x.amount, x.date].join("|"), taken = new Set(rows.map((r) => r.aisKey).filter(Boolean));
  const offers = ais.filter((x) => !taken.has(keyOf(x)));
  const upd = (i, p) => set({ cgRows: rows.map((r, j) => (j === i ? Object.assign({}, r, p) : r)) });
  const head = g ? "111A " + money(g.s111A) + " · normal rates " + money(g.stApp) + " · 112A " + money(g.s112A) + " · 112 " + money(g.s112) + (X.comp.tax && X.comp.tax.relief112 ? " · ignored under the proviso to 112(1)(a) " + money(X.comp.tax.relief112) : "") + (C.stcl || C.ltcl ? " · loss carried forward " + money((C.stcl || 0) + (C.ltcl || 0)) : "") : "";
  return <Card k="cg" title="Capital gains (Schedule CG)" chip={g ? money(g.total) : null} note={head || "Each sale in the year: shares and funds, land or building, other assets. The AIS's sales are offered below."}
    action={<button className="linkbtn" data-itr-add-sale="" onClick={() => set({ cgRows: rows.concat([{ id: newId(), kind: "eq", exempt: [], improve: [] }]) })}>Add a sale</button>}>
    {offers.map((x, i) => <p key={i} className="itr-note" data-itr-ais-offer={i}>{"AIS: " + (x.desc || x.code) + (x.src ? ", " + x.src : "") + " " + money(x.amount) + " "}
      <button className="linkbtn" data-itr-take-ais={i} onClick={() => set({ cgRows: rows.concat([{ id: newId(), kind: x.cat === "cgprop" ? "land" : "eq", desc: (x.src || x.desc || "").slice(0, 60), value: +x.amount || 0, sale: x.date || "", aisKey: keyOf(x), src: "AIS", exempt: [], improve: [] }]) })}>Add as a sale</button></p>)}
    {rows.map((r, i) => { const c = g && g.rows.find((y) => y.id === (r.id || "cg" + i)), land = r.kind === "land";
      return <Item key={r.id || i} k={"sale-" + i} title={r.desc || (CG_KINDS.find((x) => x[0] === r.kind) || ["", "Sale"])[1]} sub={c ? (c.lt ? "long-term" : "short-term") + ", " + BUCKET[c.bucket] : ""} figure={c ? money(c.net) : ""} open={open === "g" + i} onOpen={() => tog("g" + i)} onRemove={() => set({ cgRows: rows.filter((_, j) => j !== i) })}>
        <div className="itr-grid">
          <Sel label="What was sold" k="cgkind" v={r.kind || "eq"} opts={CG_KINDS} on={(v) => upd(i, { kind: v })} /><Txt label="Description" k="desc" v={r.desc} on={(v) => upd(i, { desc: v })} />
          <Day label="Bought on" k="acq" v={r.acq} on={(v) => upd(i, { acq: v })} /><Day label="Sold on" k="sale" v={r.sale} on={(v) => upd(i, { sale: v })} />
          <Num label={r.kind === "buyback" ? "Amount received (taxed as dividend, 2(22)(f))" : "Sale value"} k="value" v={r.value} on={(v) => upd(i, { value: v })} />
          {(land || r.kind === "unlisted") && <Num label={land ? "Stamp duty value (50C)" : "Fair market value, rule 11UAA (50CA)"} k="sdv" v={r.sdv} on={(v) => upd(i, { sdv: v })} />}
          <Num label="Cost of acquisition" k="cost" v={r.cost} on={(v) => upd(i, { cost: v })} /><Num label="Expenses on transfer" k="exp" v={r.expenses} on={(v) => upd(i, { expenses: v })} />
          {r.kind === "eq" && (r.acq || "") < "20180201" && <Num label="FMV on 31-01-2018 (total)" k="fmv2018" v={r.fmv2018} on={(v) => upd(i, { fmv2018: v })} />}
          {r.kind !== "eq" && r.acq && r.acq < "20010401" && <Num label="FMV on 1-04-2001 (if taken as cost)" k="fmv2001" v={r.fmv2001} on={(v) => upd(i, { fmv2001: v })} />}
          {land && r.acq && r.acq < "20010401" && <Num label="Stamp duty value on 1-04-2001 (the FMV is capped at it)" k="sdv2001" v={r.sdv2001} on={(v) => upd(i, { sdv2001: v })} />}
          {land && <label className="itr-field itr-tick"><input type="checkbox" data-itr-in="residential" checked={!!r.residential} onChange={(e) => upd(i, { residential: e.target.checked })} /><span>A residential house (section 54)</span></label>}
          {r.kind === "eq" && <><Txt label="ISIN" up k="isin" v={r.isin} on={(v) => upd(i, { isin: v })} /><Num label="Number of shares / units" k="qty" v={r.qty} on={(v) => upd(i, { qty: v })} />
            <label className="itr-field itr-tick"><input type="checkbox" checked={r.stt !== false} onChange={(e) => upd(i, { stt: e.target.checked })} /><span>STT paid</span></label></>}
          {r.kind === "buyback" && <label className="itr-field itr-tick"><input type="checkbox" checked={r.listed !== false} onChange={(e) => upd(i, { listed: e.target.checked })} /><span>Listed shares</span></label>}
          {X.model.business && <Num label="Of the gain, credited in the books' P&L" k="cginbooks" v={r.inBooks} on={(v) => upd(i, { inBooks: v })} />}
          {land && <Addr a={r.addr} k="caddr" on={(v) => upd(i, { addr: v })} />}
        </div>
        {(land || r.kind === "other" || r.kind === "unlisted") && <Sub k="improve" title="Cost of improvement (from 2001-02)" rows={r.improve} blank={{ fy: "2015", amt: "" }} on={(v) => upd(i, { improve: v })} render={(m, p) => <>
          <Sel label="Year" v={m.fy} opts={FYS.map((y) => [y, y + "-" + String(+y + 1).slice(2)])} on={(v) => p({ fy: v })} /><Num label="Amount" v={m.amt} on={(v) => p({ amt: v })} /></>} />}
        <Sub k="cgexempt" title="Exemption (54-series)" rows={r.exempt} blank={{ sec: land ? "54" : "54F", amt: "" }} on={(v) => upd(i, { exempt: v })} render={(e, p) => <>
          <Sel label="Section" v={e.sec} opts={CGEX.map((x) => [x, x])} on={(v) => p({ sec: v })} />{e.sec === "54EC" || !["54", "54B", "54F"].includes(e.sec) ? <Num label={e.sec === "54EC" ? "Amount invested in the bonds" : "Amount"} v={e.amt} on={(v) => p({ amt: v })} /> : null}<Day label="Invested / bought on" v={e.date} on={(v) => p({ date: v })} />{["54", "54B", "54F"].includes(e.sec) && <Num label="Cost of the new house / land" v={e.cost} on={(v) => p({ cost: v })} />}</>} />
        {land && <Sub k="buyers" title="Buyers" rows={r.buyers} blank={{ name: "", pan: "", share: 100 }} on={(v) => upd(i, { buyers: v })} render={(b, p) => <><Txt label="Buyer" v={b.name} on={(v) => p({ name: v })} /><Txt label="PAN" up v={b.pan} on={(v) => p({ pan: v })} /><Num label="Share %" v={b.share} on={(v) => p({ share: v })} /></>} />}
        {c && <p className="itr-note" data-itr-cg-line={i}>{"Full value " + money(c.fullValue) + (c.fullValue !== c.value ? " (" + (land ? "50C" : "50CA") + ")" : "") + " · cost " + money(c.costUsed) + (c.costUsed !== c.cost ? " (55(2)(ac))" : "") + (c.imp ? " · improvement " + money(c.imp) : "") + " · gain " + money(c.gain) + (c.exemptAmt ? " · exempt " + money(c.exemptAmt) : "")
          + (c.idxGain != null ? " · with indexation " + money(c.idxGain) + proviso(X, c.id) : "")}</p>}
      </Item>; })}
  </Card>;
}

// the proviso to 112(1)(a) for one property, on what of it is chargeable (tax.js tax112)
function proviso(X, id) {
  const r = ((X.comp.tax && X.comp.tax.p112 && X.comp.tax.p112.rows) || []).find((y) => y.id === id);
  return r ? " · tax 12.5% " + money(r.taxA) + ", 20% with indexation " + money(r.taxB) + (r.excess ? ", " + money(r.excess) + " ignored" : "") : "";
}

// ---------------- Losses of earlier years (CFL) ----------------
const LKIND = [["business", "Business loss (72)"], ["hp", "House property loss (71B)"], ["stcl", "Short-term capital loss (74)"], ["ltcl", "Long-term capital loss (74)"]];
const LAYS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];
function Losses({ X, set }) {
  const L = X.state.losses || {}, rows = [];
  LKIND.forEach(([k]) => (L[k] || []).forEach((x) => rows.push({ kind: k, ay: x.ay, amt: x.amt })));
  const save = (rs, ud) => { const o = { unabsorbedDep: ud === undefined ? L.unabsorbedDep : ud }; LKIND.forEach(([k]) => { o[k] = rs.filter((x) => x.kind === k).map((x) => ({ ay: x.ay, amt: x.amt })); }); set({ losses: o }); };
  const C = X.comp, used = (C.key || {});
  const note = "Only losses carried forward in a return filed by its due date (section 80), within eight years. Used this year: house property " + money(used.bfHp || 0) + ", capital " + money((used.bfStcl || 0) + (used.bfLtcl || 0)) + ".";
  return <Card k="losses" title="Losses of earlier years" note={note}>
    <Sub k="bfloss" title="Loss carried forward" rows={rows} blank={{ kind: "hp", ay: "2025", amt: "" }} on={(rs) => save(rs)} render={(x, p) => <>
      <Sel label="Kind" v={x.kind} opts={LKIND} on={(v) => p({ kind: v })} /><Sel label="Of the year (AY)" v={x.ay} opts={LAYS.map((y) => [y, y + "-" + String(+y + 1).slice(2)])} on={(v) => p({ ay: v })} /><Num label="Amount left" v={x.amt} on={(v) => p({ amt: v })} /></>} />
    {X.model.business && <div className="itr-grid"><Num label="Unabsorbed depreciation brought forward (32(2))" k="bfud" v={L.unabsorbedDep} on={(v) => save(rows, v)} /></div>}
  </Card>;
}

// ---------------- Schedule AL (ITR-3) ----------------
const MOV = [["deposits", "Bank deposits"], ["shares", "Shares and securities"], ["insurance", "Insurance policies"], ["loans", "Loans and advances given"], ["cash", "Cash in hand"], ["jewellery", "Jewellery, bullion"], ["art", "Art, drawings, archaeological collections"], ["vehicles", "Vehicles, yachts, boats, aircraft"], ["liabilities", "Liabilities for these assets"]];
function AL({ X, set }) {
  const a = X.state.al || null, ti = X.comp.ti, need = ti > 10000000;
  const upd = (p) => set({ al: Object.assign({ immovable: [], firms: [] }, a, p) });
  return <Card k="al" title="Assets and liabilities (Schedule AL)" chip={need ? (a ? "Filled" : "Needed") : "Not needed"} note={"Needed when total income is above Rs 1 crore (here " + money(ti) + "). At cost, at 31-03-2026, other than the business's own assets (Part A-BS)."}
    action={!a && <button className="linkbtn" data-itr-al-start="" onClick={() => upd({})}>Fill it</button>}>
    {a && <><div className="itr-grid">{MOV.map(([k, l]) => <Num key={k} label={l} k={"al-" + k} v={a[k]} on={(v) => upd({ [k]: v })} />)}</div>
      <Sub k="al-imm" title="Land and buildings" rows={a.immovable} blank={{ desc: "", amt: "" }} on={(v) => upd({ immovable: v })} render={(x, p) => <><Txt label="Description" v={x.desc} on={(v) => p({ desc: v })} /><Num label="Cost" v={x.amt} on={(v) => p({ amt: v })} /><Addr a={x.addr} k="al-addr" on={(v) => p({ addr: v })} /></>} />
      <Sub k="al-firm" title="Interest in a firm or AOP" rows={a.firms} blank={{ name: "", pan: "", amt: "" }} on={(v) => upd({ firms: v })} render={(x, p) => <><Txt label="Firm" v={x.name} on={(v) => p({ name: v })} /><Txt label="Firm's PAN" up v={x.pan} on={(v) => p({ pan: v })} /><Num label="Investment" v={x.amt} on={(v) => p({ amt: v })} /><Addr a={x.addr} k="al-faddr" on={(v) => p({ addr: v })} /></>} />
      <button className="linkbtn itr-rm" onClick={() => set({ al: null })}>Clear Schedule AL</button></>}
  </Card>;
}

// ---------------- the schema's own lists: FA, SH, AL-1 ----------------
const human = (k) => k.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/_/g, " ").replace(/\bUs\b/g, "u/s").replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (m, c) => " " + c.toLowerCase());
function choices(n) {
  const d = String(n.description || ""), lab = {};
  d.split(/;\s*|,\s*(?=[A-Z0-9_]{1,12}\s*[-:])/).forEach((p) => { const m = p.match(/^\s*([A-Za-z0-9_()]+)\s*[-:]\s*(.+)$/); if (m) lab[m[1]] = m[2].trim(); });
  return n.enum.map((e) => [e, lab[e] ? e + " · " + lab[e].slice(0, 40) : e]);
}
function leaves(X, path, prefix) {
  const n = nodeAt(X, path); if (!n || !n.properties) return [];
  const out = [];
  Object.keys(n.properties).forEach((k) => { const c = nodeAt(X, path + "/" + k); if (!c) return; const req = (n.required || []).includes(k);
    if (c.properties && Object.keys(c.properties).length) leaves(X, path + "/" + k, (prefix || "") + k + "/").forEach((x) => out.push(x));
    else if (c.type !== "array" && !c.items) out.push({ key: (prefix || "") + k, node: c, req }); });
  return out;
}
const getP = (o, p) => p.split("/").reduce((a, k) => (a == null ? a : a[k]), o);
const setP = (o, p, v) => { const ks = p.split("/"), r = JSON.parse(JSON.stringify(o || {})); let x = r; ks.slice(0, -1).forEach((k) => { x[k] = x[k] && typeof x[k] === "object" ? x[k] : {}; x = x[k]; }); if (v === "" || v == null) delete x[ks[ks.length - 1]]; else x[ks[ks.length - 1]] = v; return r; };
function Field({ f, v, on }) {
  const n = f.node, label = human(f.key.split("/").pop()) + (f.req ? "" : " (if any)");
  if (n.enum) return <Sel label={label} v={v ?? ""} opts={[["", "Choose"]].concat(choices(n))} on={(x) => on(x)} />;
  if (n.type === "integer" || n.type === "number") return <Num label={label} v={v} on={(x) => on(x)} />;
  if (/\\d\{3\}-/.test(n.pattern || "") || /Date/.test(f.key)) return <F label={label}><input type="date" value={v || ""} onChange={(e) => on(e.target.value)} /></F>;
  return <Txt label={label} v={v} up={/PAN|TAN|ISIN|IFSC/.test(f.key)} on={(x) => on(x.slice(0, n.maxLength || 200))} />;
}
function SchemaList({ X, path, k, rows, on }) {
  const fields = leaves(X, path + "/" + k + "/[]");
  const rs = rows || [];
  return <div className="itr-sub2" data-itr-list={k}><div className="itr-sub2-h"><span>{human(k).replace(/^Dtls /, "").replace(/ UC$| SU$/, "")}</span><button className="linkbtn" data-itr-list-add={k} onClick={() => on(rs.concat([{}]))}>Add</button></div>
    {rs.map((r, i) => <div key={i} className="itr-grid itr-subrow">{fields.map((f) => <Field key={f.key} f={f} v={getP(r, f.key)} on={(v) => on(rs.map((y, j) => (j === i ? setP(y, f.key, v) : y)))} />)}
      <button className="linkbtn itr-rm" onClick={() => on(rs.filter((_, j) => j !== i))}>Remove</button></div>)}</div>;
}
function ListsOf({ X, path, value, on }) {
  const n = nodeAt(X, path); if (!n) return null;
  const keys = Object.keys(n.properties || {}).filter((k) => { const c = nodeAt(X, path + "/" + k); return c && (c.type === "array" || c.items); });
  return keys.map((k) => <SchemaList key={k} X={X} path={path} k={k} rows={(value || {})[k]} on={(rs) => on(Object.assign({}, value, { [k]: rs }))} />);
}
function Lists({ X, set, schema, k, title, path, startPath, note }) {
  const XX = { schema, root: ROOT[X.form] }, v = X.state[k] || {}, [su, setSu] = useState(!!(v.startup && Object.keys(v.startup).length));
  const count = Object.values(v).filter(Array.isArray).reduce((a, x) => a + x.length, 0);
  if (!schema) return <Card k={k} title={title} note="Loading the official schema…" />;
  return <Card k={k} title={title} chip={count ? count + " entered" : null} note={note}>
    <ListsOf X={XX} path={path} value={v} on={(nv) => set({ [k]: Object.assign({}, nv, { startup: v.startup }) })} />
    <label className="itr-field itr-tick"><input type="checkbox" checked={su} onChange={(e) => setSu(e.target.checked)} /><span>A start-up recognised by DPIIT</span></label>
    {su && <ListsOf X={XX} path={startPath} value={v.startup} on={(nv) => set({ [k]: Object.assign({}, v, { startup: nv }) })} />}
  </Card>;
}
function Foreign({ X, set, schema }) {
  const own = X.state.profile || {}, yes = own.foreignAssets === "YES", XX = { schema, root: ROOT[X.form] }, v = X.state.fa || {};
  const count = Object.values(v).filter(Array.isArray).reduce((a, x) => a + x.length, 0);
  return <Card k="fa" title="Foreign assets (Schedule FA)" chip={yes ? (count ? count + " entered" : "Needed") : null} note="For a resident: any asset, account or interest outside India held at any time in calendar year 2025 (January to December), in rupees at the SBI telegraphic transfer buying rate.">
    <Sel label="Held any asset outside India in 2025?" k="fa-yn" v={own.foreignAssets || ""} opts={[["", "Choose"], ["NO", "No"], ["YES", "Yes"]]} on={(x) => set({ profile: Object.assign({}, own, { foreignAssets: x || undefined }) })} />
    {yes && (schema ? <ListsOf X={XX} path="ScheduleFA" value={v} on={(nv) => set({ fa: nv })} /> : <p className="itr-note">Loading the official schema…</p>)}
  </Card>;
}
// ---------------- other sources not in the books (Schedule OS) ----------------
function Other({ X, set }) {
  const st = X.state, os = X.model.os || {};
  const ais = X.imports.ais && X.imports.ais.data ? X.imports.ais.data.rows : [], aisDiv = ais.filter((r) => r.cat === "dividend").reduce((s2, x) => s2 + (+x.amount || 0), 0);
  return <Card k="os" title="Other sources" chip={money((os.interest || 0) + (os.dividend || 0) + (os.other || 0))} note={"Interest in the books is taken already; add what is outside them (savings interest, a deposit not booked), dividends" + (aisDiv ? " (AIS: " + money(aisDiv) + ")" : "") + ", the money from a buy-back (dividend under 2(22)(f)), any other income."}>
    <div className="itr-grid"><Num label="Interest outside the books" k="os-int" v={st.osInterest} on={(v) => set({ osInterest: v })} /><Num label="Dividend" k="os-div" v={st.osDividend} on={(v) => set({ osDividend: v })} /><Num label="Other income" k="os-oth" v={st.osOther} on={(v) => set({ osOther: v })} /></div>
  </Card>;
}
// ---------------- Ind AS: other comprehensive income ----------------
const OCI = [["remeasure", "Remeasurement of defined benefit plans"], ["equity", "Equity instruments through OCI"], ["surplus", "Revaluation surplus"], ["fvtpl", "Fair value changes of liabilities (own credit)"], ["shareAssoc", "Share of OCI of associates (not reclassified)"], ["taxNot", "Income tax on these"],
  ["fx", "Exchange differences on foreign operations"], ["debt", "Debt instruments through OCI"], ["hedge", "Cash flow hedges, effective portion"], ["shareAssocRe", "Share of OCI of associates (reclassified)"], ["taxRe", "Income tax on these"]];
function Oci({ X, set }) {
  const c = X.state.indAsOci || {}, upd = (k, v) => set({ indAsOci: Object.assign({}, c, { [k]: v }) });
  return <Card k="oci" title="Other comprehensive income (Ind AS)" note="Not in the books: give it from the audited Ind AS statements (a loss with a minus). The balance sheet and P&L under Ind AS are placed from the books' codes; confirm them on Checks.">
    <div className="itr-grid">{OCI.map(([k, l]) => <F key={k} label={l}><input inputMode="numeric" data-itr-in={"oci-" + k} value={c[k] ?? ""} onChange={(e) => upd(k, e.target.value === "" || e.target.value === "-" ? e.target.value : +e.target.value || 0)} /></F>)}</div>
  </Card>;
}
