// Clients: upload bills for any client, add a client, and the list of clients. Was viewClients() and
// addCompanyForm() in src/js/18.
import { useState } from "react";
import DropZone from "../parts/DropZone.jsx";
import { MultiUpload } from "../parts/Notes.jsx";
import { Jobs, ReadingCheck, UploadOptions } from "../parts/Reading.jsx";

function AddClient() {
  const others = sortedCompanies();
  const [v, setV] = useState({ name: "", gstin: "", tallyName: "", copyFrom: "", turnover10cr: false });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = () => saveNewCompany(v);
  return <>
    <h2>Add client</h2>
    <div className="grid" style={{ marginTop: 10 }} onKeyDown={(e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") save(); }}>
      <label className="f wide"><span>Client name</span><input type="text" id="ncName" autoFocus placeholder="e.g. Gupta Traders Pvt Ltd" value={v.name} onChange={set("name")} /></label>
      <label className="f"><span>GSTIN</span><input type="text" placeholder="09AAACG1111A1Z5" value={v.gstin} onChange={set("gstin")} /></label>
      <label className="f"><span>Company name in Tally</span><input type="text" placeholder="Same as client name" value={v.tallyName} onChange={set("tallyName")} /></label>
      {others.length > 0 && <label className="f wide"><span>Copy ledger names from</span>
        <select value={v.copyFrom} onChange={set("copyFrom")}><option value="">Standard names</option>{others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>}
    </div>
    <label className="chk" style={{ marginTop: 10 }}><input type="checkbox" checked={v.turnover10cr} onChange={set("turnover10cr")} /> Turnover last year was above ₹10 crore</label>
    <div className="row" style={{ marginTop: 12 }}>
      <button className="btn primary" onClick={save}>Add and open</button>
      <button className="btn" onClick={() => doAct("cancelCo")}>Cancel</button>
    </div>
  </>;
}

function Free({ c }) {
  const f = freeRate(c);
  if (!f) return "—";
  return <span className={"tag " + (f.pct >= 90 ? "ok" : "warn")} title={f.free + " free, " + f.google + " Google, " + f.claude + " Claude"}>{f.pct}% of {f.n}</span>;
}

// whether the client's Tally computer is on, Tally open and the books up to date (TLight, src/js/49: the bridge's
// heartbeat, asked every two minutes at most)
const MARK = { ok: "● ", warn: "◐ ", bad: "○ " };
function TallyLight({ cid }) {
  if (typeof TLight !== "object") return null;
  const co = CO(cid), t = tallyStatus(co), x = TLight.st.by[cid];
  // the one status (review item 5); the heartbeat's detail (updated when, Tally closed) stays in the tip
  return <span className={"tag " + t.level} title={t.say + (x && t.state === "ok" ? "" : x ? " " + x.say : "")} data-tally={t.state}>{MARK[t.level] + t.label}</span>;
}

export default function Clients() {
  // the search box: typed at once, the list follows a moment later (as before)
  const [q, setQ] = useState(S.homeQuery || "");
  const all = Object.values(S.companies), find = q.trim().toLowerCase();
  const cos = sortedCompanies().filter((c) => !find || c.name.toLowerCase().includes(find) || (c.gstin || "").toLowerCase().includes(find) || (c.tallyName || "").toLowerCase().includes(find));
  const used = all.reduce((a, c) => a + num((c.stats || {}).records || 1), 0) + Object.keys(S.inbox).length + 1, fy = fyOf(null);
  return <>
    <div className="two">
      <DropZone mode="auto" label="Upload invoices for any client">
        <strong>Upload invoices for any client</strong>
        <div className="note">Drop any number of bills. Each is filed under the client whose GSTIN it is billed to; anything that does not match waits in Unsorted uploads. Files already uploaded are skipped.</div>
      </DropZone>
      <ReadingCheck />
      <div className="pane" style={{ marginTop: 0 }}>
        {S.addingCo ? <AddClient /> : <>
          <h2>{all.length} client{all.length === 1 ? "" : "s"}</h2>
          <p className="note" style={{ margin: "0 0 12px" }}>Open a client to upload, review and send its entries, like selecting a company in Tally.</p>
          <button className="btn primary" onClick={() => doAct("addCo")}>Add client</button>
        </>}
      </div>
    </div>
    <div style={{ marginTop: 8 }}><UploadOptions /></div>
    <Jobs which="auto" />
    <MultiUpload />
    {!all.length ? <div className="pane"><p className="empty" style={{ padding: 0 }}>No clients yet. Add your first client with its GSTIN and Tally company name.</p></div> : <>
      <div className="row" style={{ margin: "18px 0 8px", justifyContent: "space-between" }}>
        <label className="f" style={{ minWidth: 260 }}><span>Find a client</span>
          <input type="text" value={q} placeholder="Name, GSTIN or Tally name" onChange={(e) => { setQ(e.target.value); S.homeQuery = e.target.value; }} />
        </label>
        <span className="note">About {INR0.format(used)} of {INR0.format(DB_LIMIT)} records used</span>
      </div>
      <div className="tblwrap">
        <table className="data">
          <thead><tr><th>Client</th><th>GSTIN</th><th>Tally</th><th className="n">To review</th><th className="n">Need a check</th><th className="n">Waiting for Tally</th><th className="n">TDS {fy}</th><th className="n">Read free</th><th></th></tr></thead>
          <tbody>
            {!cos.length && <tr><td colSpan={9} className="note">No client matches “{q}”.</td></tr>}
            {cos.map((c) => {
              const st = c.stats || {}, inbox = docqCount(c.id);
              return (
                <tr key={c.id} className="rowlink" onClick={() => openCompany(c.id)}>
                  <td><b>{c.name}</b>{inbox > 0 && <> <span className="tag" title="Files waiting in the inbox">{"\u{1F4E5} " + inbox}</span></>}
                    {c.tallyName && c.tallyName !== c.name && <div className="note">Tally: {c.tallyName}</div>}</td>
                  <td>{c.gstin || "—"}</td><td><TallyLight cid={c.id} /></td>
                  <td className="n">{st.drafts || "—"}</td>
                  <td className="n">{st.check ? <span className="tag warn">{st.check}</span> : "—"}</td>
                  <td className="n">{st.waiting ? <span className="tag ok">{st.waiting}</span> : "—"}</td>
                  <td className="n">{st.fy === fy && st.tdsFy ? money0(st.tdsFy) : "—"}</td>
                  <td className="n"><Free c={c} /></td>
                  <td className="n"><button className="btn small" onClick={(e) => { e.stopPropagation(); openCompany(c.id); }}>Open</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}
