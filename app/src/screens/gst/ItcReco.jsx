// 2B reconciliation, one table (next-itc-simple, the owner, 24-Oct-2026: "in 2B reconciliation there should be follow-up
// also regarding unused and all other things — like available in ITC (books) but not in 2B, we should be able to take it;
// and in 2B but we want to take it in following months"). The month's lines (ITCF.month, app/src/lib/itcFinal.js) with
// chips and counts on top (Matched · In books, not in 2B · In 2B, not in books · Amount differs · Rejected/Pending in IMS
// · Carried forward), each with ONE Decision (and its month for "Take in a later month"), a note, and for a probable
// match Accept / Reject, for a document only in 2B a link to a bill (r2Confirm, r2Unlink, r2Link: src/js/27). Tick lines
// and "Set decision…" decides them together. "Write to suppliers": one letter per supplier with every line set to follow
// up or correct (the old ITC follow-up). Download / Upload Excel: ExcelBar (ItcParts.jsx).
//
// State: S.icF {chip, q, party}, S.icSel {key: true}, S.icMore (rows shown).
import { Fragment, useState } from "react";
import CommitBox from "../../parts/CommitBox.jsx";
import { Pop, ExcelBar } from "./ItcParts.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (/^\d{8}$/.test(String(d || "")) ? fmtDate(tallyDate(d)) : String(d || ""));
const H = ["igst", "cgst", "sgst", "cess"];
const tot = (o) => r2(H.reduce((a, k) => a + num((o || {})[k]), 0));
const ORDER = { diff: 0, books: 1, "2b": 2, ims: 3, cf: 4, matched: 5 };
const CHIP_CLS = { matched: "ok", books: "warn", "2b": "warn", diff: "bad", ims: "bad", cf: "info" };
const later = (M) => ITCF.months(M).filter((m) => m > M);
const next = (M) => later(M)[0] || M;

function DecisionCell({ r, reg, M }) {
  if (r.fixed && !r.allow.length) return <span className="nr">{r.fixed}</span>;
  const set = (code, ym) => { const x = ITCF.decide(reg, [r], code, ym, M); if (x.refused.length) toast("Not a choice for this line."); render(); };
  const v = r.show.code || "", months = later(M);
  return <div className="ic-dec">
    <select aria-label="Decision" data-ic-dec={r.key} value={v} onChange={(ev) => { const c = ev.target.value; set(c, c === "later" ? r.show.ym && r.show.ym > M ? r.show.ym : next(M) : ""); }}>
      {r.fixed && <option value="">As booked</option>}
      {r.allow.map((c) => <option key={c} value={c}>{ITCF.DEC_LABEL[c]}</option>)}
    </select>
    {v === "later" && <select aria-label="Take in month" data-ic-month={r.key} value={r.show.ym || ""} onChange={(ev) => set("later", ev.target.value)}>
      {!r.show.ym && <option value="">Pick the month…</option>}
      {r.show.ym && r.show.ym <= M && <option value={r.show.ym}>{GSTR.label(r.show.ym)}</option>}
      {months.map((m) => <option key={m} value={m}>{GSTR.label(m)}</option>)}</select>}
    {!r.fixed && <select aria-label="Eligible?" data-ic-elig={r.key} value={r.el || r.defE || "eligible"} title="Eligible? (as the books have it unless you change it)"
      onChange={(ev) => { ITCF.setElig(reg, r, ev.target.value); render(); }}>{ITCF.ELIG.map(([k, l]) => <option key={k} value={k}>{l + (k === r.defE ? " (books)" : "")}</option>)}</select>}
    {r.fixed ? <div className="nr">{r.fixed}</div> : r.e.auto ? <div className="nr" title="Nothing decided yet: FinCom's rule">FinCom's rule</div>
      : r.show.code === "booksnow" ? <div className="nr bad" data-ic-risk="">not in 2B: the credit may be questioned until the supplier reports it</div> : null}
  </div>;
}

function Side({ no, date, sub, amt, none }) {
  if (none) return <td className="nr">—</td>;
  return <td><span className="code">{no || "—"}</span><div className="nr">{day(date)}{sub ? " · " + sub : ""}</div><div className="ic-amt">{money(tot(amt))}</div></td>;
}

function Acts({ r, free, reg }) {
  if (r.kind === "pair" && r.status === "probable") {
    const ids = r.docs.map((d) => d.id);
    const told = (d) => { if (r.x && r.x.aiId && window.GSTAutoMatch) window.GSTAutoMatch.decide(reg, r.x.aiId, d); };
    return <span className="rc-acts"><button className="btn small primary" data-reco-accept="" onClick={() => { told("accept"); r2Confirm(r.p.key); }}>Same</button>
      <button className="btn small" data-reco-reject="" onClick={() => { told("reject"); r2Unlink(r.p.key, ids); }}>Not the same</button></span>;
  }
  if (r.kind === "2b" && !r.fixed) {
    const p = r.p, cands = free.filter((d) => d.dir === p.dir && (d.gstin === p.gstin || (!d.gstin && GST2B.lastDigits(d.no) === GST2B.lastDigits(p.no)) || (d.gstin && d.gstin.slice(2, 12) === String(p.gstin).slice(2, 12))))
      .sort((a, c) => Math.abs(tot(a) - tot(p)) - Math.abs(tot(c) - tot(p))).slice(0, 12);
    return cands.length ? <select aria-label="Booked in Tally as" data-reco-link="" value="" style={{ maxWidth: 130 }} onChange={(ev) => r2Link(p.key, ev.target.value)}>
      <option value="">Link to a bill…</option>{cands.map((d) => <option key={d.id} value={d.id}>{d.no + " · vch " + d.voucher + " · " + GSTAmend.dmy(d.date) + " · tax " + INR.format(tot(d))}</option>)}</select> : null;
  }
  if (r.kind === "pair") return <button className="linkbtn" data-reco-unlink="" title="These are not the same document" onClick={() => r2Unlink(r.p.key, r.docs.map((d) => d.id))}>Not the same</button>;
  return null;
}

function Letters({ reg, rows, onClose }) {
  const L = ITCF.letters(reg, rows), [open, setOpen] = useState("");
  const write = (how, s) => {
    if (how === "copy") (navigator.clipboard ? navigator.clipboard.writeText(s.text) : Promise.reject()).then(() => toast("Letter copied."), () => toast("Could not copy."));
    if (how === "mail") { if (!s.email) { toast("Add the supplier's email in GST settings, contacts."); return; } window.open("mailto:" + encodeURIComponent(s.email) + "?subject=" + encodeURIComponent("GST: invoices to report or correct") + "&body=" + encodeURIComponent(s.text), "_blank"); }
    if (how === "wa") { const ph = String(s.phone || "").replace(/\D/g, ""); if (!ph) { toast("Add the supplier's phone in GST settings, contacts."); return; } window.open("https://wa.me/" + (ph.length === 10 ? "91" + ph : ph) + "?text=" + encodeURIComponent(s.text), "_blank"); }
    ITCF.logSent(reg, s.key); render();
  };
  return <Pop open onClose={onClose} id="itc-letters" title="Write to suppliers" description={L.length + " supplier" + (L.length === 1 ? "" : "s") + " with lines set to Follow up or Ask supplier to correct"}>
    {!L.length ? <p className="note" data-letters-empty="">No supplier to write to. Set a line’s Decision to “Follow up with supplier” or “Ask supplier to correct” and its supplier comes here.</p> :
    <div className="itc-pop-table"><table className="bk-table gf-off" data-letters="">
      <thead><tr><th>Supplier · GSTIN</th><th className="n">Lines</th><th className="n">Tax</th><th>Email · phone</th><th>Last written</th><th>Write</th></tr></thead>
      <tbody>{L.map((s) => <Fragment key={s.key}><tr data-letter={s.key}><td>{s.party || "—"}<div className="nr">{s.gstin || "no GSTIN"}</div></td><td className="n">{s.rows.length}</td><td className="n">{money(s.tax)}</td>
        <td>{s.email || <span className="nr">no email</span>}<div className="nr">{s.phone || "no phone"}</div></td><td>{s.lastSent ? GSTAmend.dmy(s.lastSent) + (s.sent.length > 1 ? " (" + s.sent.length + " times)" : "") : <span className="nr">not yet</span>}</td>
        <td style={{ whiteSpace: "nowrap" }}><button className="linkbtn" data-letter-copy={s.key} onClick={() => write("copy", s)}>copy</button> · <button className="linkbtn" onClick={() => write("mail", s)}>email</button> · <button className="linkbtn" onClick={() => write("wa", s)}>WhatsApp</button> · <button className="linkbtn" onClick={() => setOpen(open === s.key ? "" : s.key)}>{open === s.key ? "hide" : "see"} letter</button></td></tr>
        {open === s.key && <tr><td colSpan={6}><pre className="itc-letter" data-letter-text="">{s.text}</pre></td></tr>}</Fragment>)}</tbody></table></div>}
    <p className="note">Email and phone come from Tally, or from GST settings (<button className="linkbtn" onClick={() => { onClose(); goGstSettings(); }}>contacts</button>). Writing is logged, so next month shows when each was last written to.</p>
  </Pop>;
}

// what differs in a matched pair without mattering (the rules' notes: server/_shared/match2b.js m2bNotes)
const notesOf = (r) => { try { return r.kind === "pair" && r.p && typeof m2bNotes === "function" ? m2bNotes(m2bRow2b(r.p), r.docs.map(m2bRowBk)) : []; } catch (e) { return []; } };

export default function ItcReco({ reg }) {
  // the automatic matching runs by itself (M2B, src/js/85): its AI pairs come back as GST2B.run's pairs; nothing else shows
  if (typeof M2B === "object") { try { M2B.view(reg); } catch (e) { /* the rules' own matching stands */ } }
  const M = S.gstYm || "", mo = ITCF.month(reg, M), f = S.icF || {}, qq = String(f.q || "").toLowerCase(), sel = S.icSel || {};
  const [bulk, setBulk] = useState({ code: "", ym: "" }), [letters, setLetters] = useState(false);
  const all = mo.rows, cnt = {}; ITCF.CHIPS.forEach(([k]) => { cnt[k] = 0; }); all.forEach((r) => { cnt[r.chip]++; });
  const pass = (r) => (!f.chip || r.chip === f.chip) && (!f.party || (r.gstin || r.party) === f.party) && (!qq || [r.party, r.gstin, r.no, r.bookNo, r.voucher].join(" ").toLowerCase().includes(qq));
  const rows = all.filter(pass).sort((a, c) => ORDER[a.chip] - ORDER[c.chip] || Math.abs(tot(c.bTax || c.pTax)) - Math.abs(tot(a.bTax || a.pTax)) || String(a.party).localeCompare(String(c.party)));
  const more = S.icMore || 200, list = rows.slice(0, more);
  const setF = (k, v, typed) => setFilter("icF", k, v, typed);
  const picked = all.filter((r) => sel[r.key]), nLet = ITCF.letters(reg, all).length;
  const take = (r) => (r.e.C === M ? tot(r.e.amt) : 0);
  const sum = (fn) => r2(rows.reduce((a, r) => a + fn(r), 0));
  const parties = Array.from(new Map(all.map((r) => [r.gstin || r.party, r.party || r.gstin])).entries()).sort((a, c) => String(a[1]).localeCompare(String(c[1])));
  const tick = (k, v) => { S.icSel = Object.assign({}, sel); if (v) S.icSel[k] = true; else delete S.icSel[k]; render(); };
  const doBulk = () => {
    if (!bulk.code) { toast("Choose the decision."); return; }
    if (bulk.code === "later" && !bulk.ym) { toast("Pick the month."); return; }
    const x = ITCF.decide(reg, picked, bulk.code, bulk.ym, M);
    toast(x.ok + " line" + (x.ok === 1 ? "" : "s") + " set to " + ITCF.DEC_LABEL[bulk.code] + (x.refused.length ? "; " + x.refused.length + " left as they were (not a choice for them)" : "") + ".");
    S.icSel = {}; setBulk({ code: "", ym: "" }); render();
  };
  const free = mo.rows.length ? ITCF.rows(reg).filter((r) => r.kind === "books").flatMap((r) => r.docs) : [];
  const has2b = GST2B.all2b(reg).some((t) => t.ym === M);
  return <div data-itc-reco={M}>
    {!has2b && <p className="note" data-ic-no2b="">No 2B for {GSTR.label(M)} here yet: the month’s bills are taken as booked. Bring it in above to check them.</p>}
    <div className="tg-tabrow r2-tabrow">
      <div className="rc-chips" role="group" aria-label="Status">
        <button type="button" className={"rc-chip" + (!f.chip ? " on" : "")} aria-pressed={!f.chip} data-ic-chip="all" onClick={() => setF("chip", "")}>All <span className="sbar-n">{all.length}</span></button>
        {ITCF.CHIPS.map(([k, l]) => <button key={k} type="button" className={"rc-chip" + (f.chip === k ? " on" : "")} aria-pressed={f.chip === k} data-ic-chip={k} onClick={() => setF("chip", f.chip === k ? "" : k)}>
          {l} <span className="sbar-n" data-ic-n={k}>{cnt[k]}</span></button>)}</div>
      <div className="tg-tabside">
        <input type="search" className="rc-find" aria-label="Find a supplier, GSTIN, invoice or voucher" data-fk="icFq" value={f.q || ""} placeholder="Find supplier, invoice" onChange={(ev) => setF("q", ev.target.value, true)} />
        <button type="button" className="btn small" data-ic-letters="" onClick={() => setLetters(true)}>Write to suppliers{nLet ? " (" + nLet + ")" : ""}</button>
        <ExcelBar reg={reg} M={M} />
      </div>
    </div>
    {picked.length > 0 && <div className="ic-bulk" data-ic-bulk="">
      <b>{picked.length} selected</b>
      <select aria-label="Set decision" data-ic-bulk-dec="" value={bulk.code} onChange={(ev) => setBulk({ code: ev.target.value, ym: ev.target.value === "later" ? bulk.ym || next(M) : "" })}>
        <option value="">Set decision…</option>{ITCF.DECS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
      {bulk.code === "later" && <select aria-label="Take in month" data-ic-bulk-month="" value={bulk.ym} onChange={(ev) => setBulk({ code: "later", ym: ev.target.value })}>{later(M).map((m) => <option key={m} value={m}>{GSTR.label(m)}</option>)}</select>}
      <button type="button" className="btn small primary" data-ic-bulk-go="" onClick={doBulk}>Apply</button>
      <button type="button" className="linkbtn" onClick={() => { S.icSel = {}; render(); }}>Clear</button>
    </div>}
    <div className="bk-tablewrap"><table className="bk-table tg-fit gf-off rc-table ic-table" data-statement="" id="icTable">
      <thead>
        <tr className="rc-band"><th colSpan={3}></th><th className="rc-bk">As per books</th><th className="rc-2b">As per GSTR-2B</th><th colSpan={4}></th></tr>
        <tr><th className="ic-tick"><input type="checkbox" aria-label="Select every line shown" data-ic-tick-all="" checked={list.length > 0 && list.every((r) => sel[r.key])} onChange={(ev) => { S.icSel = ev.target.checked ? Object.fromEntries(list.map((r) => [r.key, true])) : {}; render(); }} /></th>
          <th>Status</th>
          <th className={"pty" + (f.party ? " th-filtered" : "")}><span className="colh"><span>Supplier · GSTIN</span>
            <select className={"hf-sel" + (f.party ? " on" : "")} aria-label="Supplier" title="Filter: Supplier" value={f.party || ""} onChange={(ev) => setF("party", ev.target.value)}><option value="">Every supplier</option>{parties.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span></th>
          <th className="rc-bk">Invoice · ITC</th><th className="rc-2b">Invoice · ITC</th><th className="n">Difference</th><th className="n">ITC in {GSTR.label(M)}</th><th>Decision</th><th>Note</th></tr></thead>
      <tbody>{list.map((r, i) => {
        const diff = r.kind === "pair" ? r2(tot(r.pTax) - tot(r.bTax)) : 0;
        return <tr key={r.key + ":" + i} data-ic-row={r.key} data-ic-chip-of={r.chip}>
          <td className="ic-tick"><input type="checkbox" aria-label="Select" data-ic-tick={r.key} checked={!!sel[r.key]} onChange={(ev) => tick(r.key, ev.target.checked)} /></td>
          <td><span className={"tag " + CHIP_CLS[r.chip]} data-ic-status={r.chip}>{(ITCF.CHIPS.find((c) => c[0] === r.chip) || [])[1]}</span>
            {r.x && r.x.ai && <span className="tag info ic-ai" title={r.x.ai} data-ic-ai={r.key}>AI</span>}
            {r.kind === "pair" && r.status === "probable" && <div className="tg-sub warn">probable match: confirm</div>}
            {r.kind === "pair" && r.chip === "matched" && r.status === "matched" && notesOf(r).map((n, j) => <div key={j} className="tg-sub" data-ic-note="">{n}</div>)}
            {r.chip === "cf" && <div className="tg-sub">from {GSTR.label(r.home)}</div>}
            {r.kind === "pair" && r.tm !== M && r.tm && r.chip !== "matched" && <div className="tg-sub">in 2B of {GSTR.label(r.tm)}</div>}
            {r.kind === "pair" && r.bm !== M && r.bm && r.chip !== "cf" && r.chip !== "matched" && <div className="tg-sub">booked {GSTR.label(r.bm)}</div>}
            {r.kind === "books" && r.nob && <div className="tg-sub">2B not brought in</div>}
            {r.noItc && <div className="tg-sub bad" data-ic-noitc="">{r.noItc}</div>}
            {r.rateUnknown && <div className="tg-sub bad" data-ic-rate="">rate unknown: neither the books nor 2B give the GST rate</div>}
            {r.ims === "P" && <div className="tg-sub">pending in IMS</div>}
            {r.kind === "rej" && <div className="tg-sub bad">rejected in IMS{r.remarks ? ": " + r.remarks : ""}</div>}
            {r.kind === "pair" && r.issues && r.status === "diff" && <div className="tg-sub" title={r.issues.join("; ")}>{r.issues.filter((w) => !/^date |^value differs /.test(w)).slice(0, 2).join("; ")}</div>}</td>
          <td className="pty"><div className="tg-pty">{r.party || "—"}<div className="tg-sub">{r.gstin || "no GSTIN"}</div></div></td>
          <Side none={!r.docs || !r.docs.length} no={r.bookNo} date={(r.docs || [])[0] && r.docs[0].date} sub={r.voucher ? "vch " + r.voucher : ""} amt={r.bTax} />
          <Side none={!r.p} no={r.no} date={r.p && r.p.date} sub={r.tm && GSTR.label(r.tm)} amt={r.pTax} />
          <td className={"n" + (Math.abs(diff) > 1 ? " bad" : "")}>{r.kind === "pair" ? money(diff) : ""}</td>
          <td className="n" data-ic-take={r.key}>{take(r) ? <b>{money(take(r))}</b> : <span className="nr">—</span>}{r.e.C && r.e.C !== M && !r.fixed ? <div className="nr">in {GSTR.label(r.e.C)}</div> : null}</td>
          <td className="ac"><DecisionCell r={r} reg={reg} M={M} /><Acts r={r} free={free} reg={reg} /></td>
          <td><CommitBox aria-label="Note" data-fk={"icnote-" + r.key} value={(r.s && r.s.note) || ""} placeholder="note" style={{ width: "100%", minWidth: 90 }} onCommit={(v) => { ITCDec.note(reg, r.key, v, r.s); render(); }} /></td>
        </tr>; })}
        {rows.length > list.length && <tr className="lt-more"><td colSpan={9} style={{ textAlign: "center" }}><span className="note">{list.length} of {rows.length} lines shown · </span>
          <button type="button" className="linkbtn" onClick={() => { S.icMore = rows.length; render(); }}>Show all {rows.length}</button></td></tr>}
        {!rows.length && <tr><td colSpan={9}><p className="note" data-list-empty="" style={{ textAlign: "center" }}>No line {all.length ? "matches these filters" : "for " + GSTR.label(M)}.{Object.values(f).some(Boolean) && <> <button type="button" className="linkbtn" onClick={() => clearFilter("icF")}>Clear filters</button></>}</p></td></tr>}
      </tbody>
      <tfoot><tr className="tg-tot" data-ic-foot=""><td colSpan={3}><b data-ic-count="">{rows.length} line{rows.length === 1 ? "" : "s"}</b>{rows.length !== all.length && <span className="note"> · of {all.length}</span>}</td>
        <td><b>{money(sum((r) => tot(r.bTax)))}</b></td><td><b>{money(sum((r) => tot(r.pTax)))}</b></td><td className="n"><b>{money(sum((r) => (r.kind === "pair" ? tot(r.pTax) - tot(r.bTax) : 0)))}</b></td>
        <td className="n"><b data-ic-take-sum="">{money(sum(take))}</b></td><td colSpan={2}><button type="button" className="linkbtn" onClick={() => gstPartGo("itcfinal")}>Final credit for 3B →</button></td></tr></tfoot>
    </table></div>
    <p className="note" style={{ marginTop: 8 }}>A line nothing is decided on follows FinCom's rule: a bill not yet in 2B waits (and is carried to the next months), a bill in a later month's 2B is taken then, the lower of the books and 2B is taken where they differ, a supplier's credit note in 2B reduces credit. What you choose is kept and goes into the Final credit for 3B.</p>
    {letters && <Letters reg={reg} rows={all} onClose={() => setLetters(false)} />}
  </div>;
}
