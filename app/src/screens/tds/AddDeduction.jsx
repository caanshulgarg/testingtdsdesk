// Add or correct a deduction without leaving FinCom (next-tds-clear; the owner, 19-Oct-2026: "How would anyone add a
// deduction — go to Tally or Excel?"). One drawer, two uses:
//   add      a deduction typed in FinCom (TDSAdd, src/js/88: kept with the books, never written to Tally): deductee (from
//            the client's parties, or a new one), its PAN from the PAN book (or typed here, kept there), section (plain
//            names; the party's last one first), date paid or credited, amount, rate (worked out from the section, the PAN
//            and a certificate: Certs.expected; changeable, with the reason), TDS (amount × rate, changeable), date of
//            deduction, a lower-deduction certificate, IT Act / DTAA (27Q), the challan (optional). Edit and delete (kept,
//            with the reason) the same way
//   correct  a deduction from Tally: section, amount, rate, TDS and certificate corrected as FinCom's corrections of the
//            return (TDSEdit.set, the store of the corrected Excel): Tally is not changed, the row says "edited in FinCom"
// S.tdsAdd = {key?, rowId?, chId?} opens it.
import { useState } from "react";
import { SideDrawer } from "./Shell.jsx";
import { PanBox } from "./PanBook.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const iso = (d) => { const t = TDS.ymd(d); return t.length === 8 ? t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8) : ""; };

export const openAdd = (o) => { S.tdsAdd = o || {}; render(); };

function parties() {
  const b = S.books || {}, set = new Set();
  TDS.allRows().forEach((r) => { if (r.party) set.add(r.party); });
  Object.keys(b.pans || {}).forEach((p) => set.add(p)); Object.keys(b.panFix || {}).forEach((p) => set.add(p));
  return Array.from(set).sort();
}
function sections(form, fy) {
  return Object.keys(TDS.STD).filter((s) => !/^192/.test(s) && (form === "27Q" ? TDS.NR.test(s) : !TDS.NR.test(s) && !TDS.portalForm(s)))
    .map((s) => { const n = TDS.secNew(s, fy); return [s, n.ref ? n.ref + " [old " + s + "] · " + n.label : s + (TDS.secName(s) ? " · " + TDS.secName(s) : "")]; });
}

export default function AddDeduction({ form, fy, q }) {
  const o = S.tdsAdd, close = () => { S.tdsAdd = null; setX(null); setWhy(""); setDel(null); render(); };
  const [x, setX] = useState(null), [why, setWhy] = useState(""), [del, setDel] = useState(null);
  if (!o) return <SideDrawer open={false} onClose={close} kind="add-deduction" />;
  const row = o.rowId ? TDS.formRows(form).find((r) => r.id === o.rowId) || TDS.allRows().find((r) => r.id === o.rowId) : null;
  const key = o.key || (row && row.added ? row.id.slice(3) : ""), rec = key ? (TDSAdd.all()[key] || null) : null;
  const correct = !!row && !row.added;
  const start = () => {
    if (rec) return { party: rec.party, section: rec.section, credit: iso(rec.credit || rec.date), date: iso(rec.date), paid: String(rec.paid), rate: rec.rate === "" ? "" : String(rec.rate), tds: String(rec.tds), cert: rec.cert || "", basis: rec.basis || "", challan: ((S.books || {}).alloc || {})["fc:" + key] || "", rateWhy: rec.rateWhy || "" };
    if (correct) return { party: row.party, section: row.section, credit: iso(row.credit || row.date), date: iso(row.date), paid: String(row.paid), rate: row.rate == null ? "" : String(row.rate), tds: String(row.tds), cert: row.cert || "", challan: row.challan || "", rateWhy: "" };
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), qd = { Q1: "-06-30", Q2: "-09-30", Q3: "-12-31", Q4: "-03-31" };
    const y = num(String(fy).slice(0, 4)), end = (q === "Q4" ? y + 1 : y) + qd[q || "Q1"], d = today < end ? today : end;
    return { party: "", section: "", credit: d, date: d, paid: "", rate: "", tds: "", cert: "", basis: "", challan: o.chId || S.tdsDedCh || "", rateWhy: "" };
  };
  const v = x || start(), set = (k, val) => setX(Object.assign({}, v, { [k]: val }));
  const pan = v.party ? TDS.panOf(v.party) : "";
  const exp = v.section && num(v.paid) > 0 ? Certs.expected({ id: "new", party: v.party, pan, section: v.section, paid: num(v.paid), date: TDS.ymd(v.date), rate: v.rate === "" ? null : num(v.rate) }) : null;
  const rate = v.rate !== "" ? num(v.rate) : exp && exp.rate != null ? exp.rate : null;
  const tdsAuto = rate != null && num(v.paid) > 0 ? r2(num(v.paid) * rate / 100) : 0;
  const tds = v.tds !== "" && v.tdsTyped ? num(v.tds) : tdsAuto;
  const certs = Certs.all().filter((c) => (pan && String(c.pan || "").toUpperCase() === pan) || normName(c.party || "") === normName(v.party || ""));
  const chs = TDS.challans().filter((c) => TDSReg.balance(c).tax > 0.005 || c.id === v.challan);
  const plist = parties(), slist = sections(form, fy);
  const rateChanged = exp && exp.rate != null && v.rate !== "" && Math.abs(num(v.rate) - exp.rate) >= 0.0001;
  const save = () => {
    if (rateChanged && !String(v.rateWhy || "").trim()) { toast("Say why the rate differs from " + exp.rate + "% (" + exp.why + ")."); return; }
    if (correct) {
      const ch = [["section", v.section], ["paid", r2(num(v.paid))], ["rate", rate], ["tds", r2(tds)], ["cert", v.cert || ""]].filter(([k, val]) => !TDSEdit.same(k, val, row[k] == null ? "" : row[k]));
      if (!ch.length) { close(); return; }
      if (TDSReg.locked(row.fy, row.q, form)) { toast(TDSReg.lockWords(row.fy, row.q, form)); return; }
      ch.forEach(([k, val]) => TDSEdit.set(row, k, val));
      TDSReg.log({ act: "correct deduction", form, fy: row.fy, q: row.q, note: row.party + ": " + ch.map(([k]) => TDSEdit.WORDS[k] || k).join(", ") + (v.rateWhy ? " (" + v.rateWhy + ")" : "") });
      TDSReg.forget(); TDSReg.done(); saveBooks(); toast("Corrected in FinCom: " + ch.map(([k]) => (TDSEdit.WORDS[k] || k).toLowerCase()).join(", ") + ". Tally is not changed."); close(); return;
    }
    if (form === "27Q" && v.party && v.basis) tdsNrSet(v.party, "dtaa", v.basis === "DTAA");
    const r = TDSAdd.save({ party: v.party, section: v.section, credit: v.credit, date: v.date || v.credit, paid: v.paid, rate: rate == null ? "" : rate, tds, cert: v.cert, basis: v.basis, challan: v.challan, rateWhy: v.rateWhy }, key || undefined);
    if (!r.ok) { toast(r.why); return; }
    toast((key ? "Changed: " : "Added in FinCom: ") + v.party + " · " + money(tds) + ". Tally is not changed."); close();
  };
  const title = correct ? "Correct the deduction" : key ? "Edit the deduction added in FinCom" : "Add a deduction";
  return <SideDrawer open onClose={close} kind="add-deduction" title={title} description={correct ? row.party + " · from Tally (Tally is not changed; FinCom keeps the correction)" : "Kept in FinCom with the client's books; Tally is not changed"}>
    <div data-add-deduction={key || (correct ? "correct" : "new")} className="addded">
      <div className="ach-grid">
        <label className="ach-f">Deductee<input type="text" list="tdsAddParties" value={v.party} disabled={correct} aria-label="Deductee" placeholder="Type a name: the client's parties come up" onChange={(ev) => set("party", ev.target.value)}
          onBlur={() => { if (!v.section && v.party) { const s = TDSAdd.lastSection(v.party); if (s) set("section", s); } }} />
          <datalist id="tdsAddParties">{plist.map((p) => <option key={p} value={p} />)}</datalist></label>
        <div className="ach-f"><span>PAN</span>{v.party ? (Certs.validPan(pan) ? <b data-add-pan="">{pan}</b> : <PanBox party={v.party} />) : <span className="note">from the PAN book, once the deductee is given</span>}</div>
        <label className="ach-f">Section<select aria-label="Section" value={v.section} onChange={(ev) => set("section", ev.target.value)}><option value="">Choose the section…</option>
          {slist.map(([s, l]) => <option key={s} value={s}>{l}</option>)}{v.section && !slist.some(([s]) => s === v.section) ? <option value={v.section}>{v.section}</option> : null}</select></label>
        <label className="ach-f">Paid or credited on<input type="date" aria-label="Paid or credited on" value={v.credit} disabled={correct} onChange={(ev) => setX(Object.assign({}, v, { credit: ev.target.value, date: v.date === v.credit || !v.date ? ev.target.value : v.date }))} /></label>
        <label className="ach-f">Amount paid or credited<input type="text" inputMode="decimal" aria-label="Amount paid or credited" value={v.paid} onChange={(ev) => set("paid", ev.target.value)} /></label>
        <label className="ach-f">Rate %<input type="text" inputMode="decimal" aria-label="Rate" value={v.rate !== "" ? v.rate : rate != null ? String(rate) : ""} placeholder={exp && exp.rate != null ? String(exp.rate) : ""} onChange={(ev) => setX(Object.assign({}, v, { rate: ev.target.value, tdsTyped: false }))} />
          {exp && exp.why ? <small className="note" data-add-rate-why="">{exp.rate}% applies: {exp.why}</small> : null}</label>
        {rateChanged && <label className="ach-f">Why a different rate<input type="text" aria-label="Why a different rate" value={v.rateWhy} onChange={(ev) => set("rateWhy", ev.target.value)} placeholder="e.g. as agreed under the certificate" /></label>}
        <label className="ach-f">TDS<input type="text" inputMode="decimal" aria-label="TDS" value={v.tdsTyped ? v.tds : tdsAuto ? String(tdsAuto) : ""} onChange={(ev) => setX(Object.assign({}, v, { tds: ev.target.value, tdsTyped: true }))} />
          <small className="note">amount × rate{v.tdsTyped ? " (typed)" : ""}</small></label>
        <label className="ach-f">Deducted on<input type="date" aria-label="Deducted on" value={v.date} disabled={correct} onChange={(ev) => set("date", ev.target.value)} /></label>
        <label className="ach-f">Lower-deduction certificate<select aria-label="Lower-deduction certificate" value={v.cert} onChange={(ev) => set("cert", ev.target.value)}><option value="">None</option>
          {certs.map((c) => <option key={c.id} value={c.certNo || c.id}>{(c.certNo || "certificate") + " · " + num(c.rate) + "%"}</option>)}</select></label>
        {form === "27Q" && !correct && <label className="ach-f">Rate under<select aria-label="Rate under" value={v.basis || (v.party && TDS26Q.nrInfo(v.party).dtaa ? "DTAA" : "IT Act")} onChange={(ev) => set("basis", ev.target.value)}><option>IT Act</option><option>DTAA</option></select></label>}
        {!correct && <label className="ach-f">Challan (optional)<select aria-label="Challan" value={v.challan} onChange={(ev) => set("challan", ev.target.value)}><option value="">None yet</option>
          {chs.map((c) => <option key={c.id} value={c.id}>{TDSCH.label(c)} · {money(TDSReg.balance(c).tax)} left</option>)}</select></label>}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="btn small primary" data-add-save="" onClick={save}>{correct ? "Save the correction" : key ? "Save" : "Add deduction"}</button>
        <button type="button" className="btn small" onClick={close}>Cancel</button>
        {key && !del && <button type="button" className="linkbtn" data-add-delete="" onClick={() => setDel("")}>Delete…</button>}
      </div>
      {key && del != null && <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="ach-f">Why it is taken out<input type="text" aria-label="Why it is taken out" value={del} onChange={(ev) => setDel(ev.target.value)} /></label>
        <button type="button" className="btn small" data-add-delete-go="" disabled={!del.trim()} onClick={() => { const r = TDSAdd.remove(key, del); toast(r.ok ? "Taken out (kept in the trail)." : r.why); if (r.ok) close(); else render(); }}>Delete the deduction</button></div>}
      {rec && <p className="note" style={{ marginTop: 10 }}>Added in FinCom{rec.by ? " by " + rec.by : ""}{rec.at ? " on " + fmtDateTime(rec.at) : ""}.</p>}
    </div></SideDrawer>;
}
