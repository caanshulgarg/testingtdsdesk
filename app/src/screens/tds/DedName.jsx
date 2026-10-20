// The deductee's name on every TDS table (next-tds-addlist, 19-Oct-2026; the owner: "blank name in particulars"). The
// name comes from Tally (the entry's party, or the party ledger credited in a journal with none: TDS.billParty); where
// there is none, never a blank: "Name missing" in red with Fix, which keeps the name as FinCom's correction of the
// deduction (TDSEdit, field party; the PAN then from the PAN book, or the one typed beside it).
// next-tds-tidy2 (the owner: "if I enter that, I am not able to save anything"): the typed name and PAN are kept in the page
// (S.tdsNameDraft) while the screen draws again, so a redraw (live sync, a toast) no longer empties the box; Save writes
// the name (and a PAN typed with it) at once; the names given to other rows of the same Tally ledgers are offered; the
// reason is one plain line: "Tally entry has no party (Miscellaneous Expenses → TDS 94J). Type who was paid."
import { saveField } from "./DedSmart.jsx";

const vchOf = (r) => { const id = String(r.id || "").split("|")[0].replace(/\+\d+y$/, ""); return ((S.books || {}).vouchers || []).find((v) => v.id === id) || null; };
// the entry's other side: the ledgers debited that are no tax, bank or party ledger (what was paid for)
export function noPartyWhy(r) {
  const v = vchOf(r), exp = v ? (v.ent || []).filter((e) => e.a < 0 && !(Books.ledgerOf(e.l) || {}).kind).map((e) => e.l) : [];
  const tds = String(r.ledger && /tds|tcs/i.test(r.ledger) ? r.ledger : (r.tdsLedger || r.ledger || "")).replace(/\s*\d+(\.\d+)?%$/, "");
  return "Tally entry has no party (" + (exp.length ? exp.slice(0, 2).join(", ") : "no expense") + (tds ? " → " + tds : "") + "). Type who was paid.";
}
// the names given in FinCom to other deductions of the same Tally ledgers (offered first), then every deductee's name
function namesFor(r) {
  const ed = TDSEdit.all(), v = vchOf(r), mine = new Set(v ? (v.ent || []).map((e) => e.l) : []), near = [], rest = new Set();
  TDS.rows().forEach((x) => {
    if (x.id === r.id || !x.party) return;
    const f = (ed[x.id] || {}).f || {}, xv = f.party ? vchOf(x) : null;
    if (f.party && xv && (xv.ent || []).some((e) => mine.has(e.l) && !/tds|tcs/i.test(e.l) || e.l === r.ledger)) near.push(x.party); else rest.add(x.party);
  });
  return Array.from(new Set(near)).concat(Array.from(rest).filter((n) => !near.includes(n)).sort()).slice(0, 200);
}

export function DedName({ r, locked, onOpen, title }) {
  const n = r.party || r.employee;
  if (n) return onOpen ? <button type="button" className="linkbtn" data-row-detail={r.id} title={title} onClick={onOpen}>{n}</button> : <span title={title}>{n}</span>;
  const D = (S.tdsNameDraft || {})[r.id], why = noPartyWhy(r);
  const setD = (x) => { S.tdsNameDraft = Object.assign({}, S.tdsNameDraft || {}, { [r.id]: x }); if (!x) delete S.tdsNameDraft[r.id]; render(); };
  const save = () => {
    const t = String((D && D.name) || "").trim(), p = String((D && D.pan) || "").trim().toUpperCase();
    if (!t) return;
    if (p && !Certs.validPan(p)) { toast(p + " is not a PAN (five letters, four digits, a letter)."); return; }
    const y = saveField(r, "party", t);
    if (!y.ok) { toast(y.why || "Not saved."); return; }
    if (p) { const z = saveField(Object.assign({}, r, { party: t }), "pan", p); if (!z.ok) toast(z.why || "The PAN was not saved."); }
    setD(null); toast("Saved: " + t + (p ? " · " + p : "") + "."); render();
  };
  if (D && !locked) {
    const names = namesFor(r), lid = "dn-" + String(r.id).replace(/[^A-Za-z0-9]/g, "");
    return <span className="wd-namefix" onClick={(ev) => ev.stopPropagation()}>
      <input type="text" autoFocus value={D.name || ""} list={lid} data-wd-name-input={r.id} aria-label="Deductee's name" placeholder="Who was paid (name as in the PAN)"
        onChange={(ev) => setD(Object.assign({}, D, { name: ev.target.value }))}
        onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); save(); } else if (ev.key === "Escape") { ev.preventDefault(); setD(null); } }} />
      <datalist id={lid}>{names.map((x) => <option key={x} value={x} />)}</datalist>
      <input type="text" value={D.pan || ""} maxLength={10} data-wd-name-pan={r.id} aria-label="PAN (if known)" placeholder="PAN (if known)" style={{ textTransform: "uppercase", width: 118 }}
        onChange={(ev) => setD(Object.assign({}, D, { pan: ev.target.value }))} onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); save(); } }} />
      <button type="button" className="btn small primary" data-wd-name-save={r.id} disabled={!String(D.name || "").trim()} onClick={save}>Save</button>
      <button type="button" className="linkbtn" onClick={() => setD(null)}>Cancel</button>
      <small className="wd-namewhy" data-wd-name-why={r.id}>{why}</small></span>;
  }
  return <span className="wd-noname" data-wd-noname={r.id} title={(r.voucher ? "Voucher " + r.voucher + " · " : "") + why}><span className="wd-chip bad">Name missing</span>
    {!locked && <> <button type="button" className="linkbtn" data-wd-namefix={r.id} onClick={(ev) => { ev.stopPropagation(); setD({ name: "", pan: "" }); }}>Fix</button></>}
    <small className="wd-namewhy" data-wd-name-why={r.id}>{why}</small></span>;
}
