// The client's PAN book (next-tds-clear; the owner, 19-Oct-2026: "if a PAN is not in Tally there is no option to put it;
// keep the PAN and use it next time; no PAN is asked twice, whether it came from Tally or was typed in FinCom").
//   PanBox       a PAN typed right where it is missing (a deductee's row, a deduction's row and drawer, the challan
//                panels): its form and 4th letter checked as it is typed, Enter saves it for the party, and every
//                deduction of that party in every return, quarter and year carries it (TDSPanFix.set, b.panFix)
//   PanConflict  Tally later has a different PAN than the one saved in FinCom: one line, "Tally says X, FinCom has Y",
//                and the choice (nothing is overwritten silently)
//   PanPaste     many at once: "name, PAN" lines pasted, or an Excel of name and PAN
//   PanBookView  every deductee party of the client with its PAN and where it came from (Tally, or FinCom: who, when)
// The order of truth is TDS.panPick (src/js/09): Tally's PAN, else the PAN book, else asked here.
// Writing a PAN back into the Tally ledger would be a Tally posting: not done here (a later option).
import { useState } from "react";
import { SideDrawer } from "./Shell.jsx";

const day = (iso) => { try { return fmtDateTime(iso); } catch (e) { return String(iso || "").slice(0, 10); } };

export function PanBox({ party, compact, onSaved }) {
  const [v, setV] = useState(""), pan = v.toUpperCase().replace(/\s/g, "");
  let probs = [];
  try { probs = pan.length === 10 ? PANCheck.offline(pan, party, []).filter((x) => x.k !== "dup") : []; } catch (e) { /* */ }
  const bad = pan.length > 0 && (pan.length > 10 || (pan.length === 10 && !Certs.validPan(pan)));
  const save = () => {
    if (!Certs.validPan(pan)) { toast("“" + pan + "” is not a PAN: five letters, four digits, a letter."); return; }
    const r = tdsDeducteeSet(party, { pan, name: (TDSPanFix.of(party) || {}).name || "" });
    if (r && r.ok) { setV(""); if (onSaved) onSaved(pan); }
  };
  const warn = probs.find((x) => !x.bad);
  return <span className={"panbox" + (compact ? " compact" : "")} data-pan-box={party} onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>
    <input type="text" value={v} maxLength={10} placeholder="Type PAN" aria-label={"PAN of " + party} className={bad ? "bad" : ""} data-pan-input=""
      style={{ textTransform: "uppercase" }} onChange={(ev) => setV(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); save(); } }} />
    {pan.length === 10 && Certs.validPan(pan) ? <button type="button" className="linkbtn" data-pan-save="" onClick={save}>Save</button> : null}
    {bad ? <small className="bad" data-pan-box-why="form">not a PAN</small> : warn ? <small className="warn" data-pan-box-why={warn.k} title={warn.words}>check 4th letter</small> : null}
  </span>;
}

export function PanConflict({ party, c }) {
  if (!c) return null;
  return <div className="pan-conflict" data-pan-conflict={party} onClick={(ev) => ev.stopPropagation()}>
    Tally says <b>{c.tally}</b>, FinCom has <b>{c.fincom}</b> — use which?{" "}
    <button type="button" className="linkbtn" data-pan-use="tally" onClick={() => tdsPanChoose(party, "tally")}>Tally’s</button> ·{" "}
    <button type="button" className="linkbtn" data-pan-use="fincom" onClick={() => tdsPanChoose(party, "fincom")}>FinCom’s</button></div>;
}

export function PanPaste() {
  const [t, setT] = useState(""), [said, setSaid] = useState(null);
  const close = () => { S.tdsPanPaste = false; setT(""); setSaid(null); render(); };
  const run = (text) => { const r = TDSPanFix.bulk(text); setSaid(r); if (r.n) { toast(r.n + " PAN" + (r.n === 1 ? "" : "s") + " saved for the client."); render(); } };
  const excel = async (f) => {
    if (!f) return;
    try {
      await ensureXlsx();
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" }), ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }).filter((r) => r && r.length >= 2);
      run(rows.map((r) => { const pi = r.findIndex((x) => /^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(String(x || "").trim())); return pi > 0 ? String(r[pi === 1 ? 0 : pi - 1]).trim() + "\t" + String(r[pi]).trim() : String(r[0]) + "\t" + String(r[1]); }).join("\n"));
    } catch (e) { setSaid({ n: 0, why: ["Could not read this file: " + ((e && e.message) || e)] }); }
  };
  return <SideDrawer open={!!S.tdsPanPaste} onClose={close} kind="pan-paste" title="Paste PANs" description="One deductee a line: the name as in Tally, then its PAN (a comma or a tab between, as copied from Excel)">
    <div data-pan-paste="">
      <textarea value={t} rows={10} style={{ width: "100%", fontFamily: "var(--font-mono, monospace)" }} aria-label="Names and PANs" placeholder={"ZZ Consultant 17\tAABCZ9999K\nRavi Menon, ABCPM1234R"} onChange={(ev) => setT(ev.target.value)} />
      <div className="row" style={{ gap: 8, margin: "8px 0", flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn small primary" data-pan-paste-go="" disabled={!t.trim()} onClick={() => run(t)}>Save these PANs</button>
        <label className="btn small">Import Excel (name, PAN)<input type="file" hidden accept=".xlsx,.xls,.csv" data-pan-excel="" onChange={(ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; excel(f); }} /></label>
      </div>
      {said && <div className="note" data-pan-paste-said={said.n}>{said.n} saved.{said.why.length ? <ul>{said.why.slice(0, 30).map((w, i) => <li key={i}>{w}</li>)}</ul> : null}</div>}
      <p className="note">Saved in the client’s PAN book: every return, quarter and year uses it, on every login. A PAN typed in the Tally ledger comes first.</p>
    </div></SideDrawer>;
}

export function PanBookView() {
  const close = () => { S.tdsPanBook = false; render(); };
  const [edit, setEdit] = useState(""), [find, setFind] = useState("");
  const list = S.tdsPanBook ? TDSPanFix.book() : [], qq = find.trim().toLowerCase();
  const shown = list.filter((x) => !qq || (x.party + " " + x.pan).toLowerCase().includes(qq));
  return <SideDrawer open={!!S.tdsPanBook} onClose={close} kind="pan-book" wide title="PAN book" description={list.length + " deductee parties · " + list.filter((x) => !x.pan).length + " without a PAN"}>
    <div data-pan-book="">
      <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="search" value={find} placeholder="Find a party or PAN" aria-label="Find a party or PAN" onChange={(ev) => setFind(ev.target.value)} style={{ width: 240 }} />
        <button type="button" className="btn small" onClick={() => { S.tdsPanBook = false; S.tdsPanPaste = true; render(); }}>Paste PANs / import Excel</button></div>
      <div className="bk-tablewrap"><table className="bk-table rt-rows" data-statement="">
        <thead><tr><th>Party</th><th>PAN</th><th>From</th><th className="n">Deductions</th><th className="ac"></th></tr></thead>
        <tbody>{shown.map((x) => <tr key={x.party} data-pan-book-row={x.party}>
          <td>{x.party}{x.conflict ? <PanConflict party={x.party} c={x.conflict} /> : null}</td>
          <td>{edit === x.party || !x.pan ? <PanBox party={x.party} compact onSaved={() => setEdit("")} /> : x.pan}</td>
          <td className="note" data-pan-source={x.source || "none"}>{x.source === "fincom" ? "FinCom · " + (x.rec.by || "") + (x.rec.at ? " · " + day(x.rec.at) : "") : x.source === "tally" ? "Tally ledger" : "—"}</td>
          <td className="n">{x.n}</td>
          <td className="ac">{x.pan && edit !== x.party ? <button type="button" className="linkbtn" data-pan-edit={x.party} onClick={() => setEdit(x.party)}>Edit</button> : null}</td></tr>)}</tbody></table></div>
      <p className="note">A PAN in the Tally ledger is used first; one typed here is kept for the client and used in every return. Writing it back into the Tally ledger would be a Tally posting, not done from here.</p>
    </div></SideDrawer>;
}
