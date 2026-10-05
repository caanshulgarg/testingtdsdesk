// Clients: upload bills for any client, add a client, and the list of clients. Was viewClients() and
// addCompanyForm() in src/js/18.
import { useState } from "react";
import DropZone from "../parts/DropZone.jsx";
import { MultiUpload } from "../parts/Notes.jsx";
import { Jobs, ReadingCheck, UploadOptions } from "../parts/Reading.jsx";
import ListTable from "../parts/ListTable.jsx";

function AddClient() {
  const others = sortedCompanies();
  const [v, setV] = useState({ name: "", gstin: "", tallyName: "", copyFrom: "", turnover10cr: false, tallyCompany: "", postOnly: true });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  // the Tally companies the bridge here sees open, and the ones the firm's Tally computers reported (02-Oct-2026)
  if (typeof TCloud === "object" && TCloud.on() && TCloud.pane.devices === null && !TCloud.pane.busy) setTimeout(() => TCloud.refreshPane(), 0);
  const seen = tallyCompaniesSeen(), pick = (name) => { const x = seen.find((c) => c.name === name);
    setV({ ...v, tallyCompany: name, tallyName: name || v.tallyName, name: v.name || name, gstin: v.gstin || (x && x.gstin) || "" }); };
  const save = () => saveNewCompany(v);
  return <>
    <h2>Add client</h2>
    <div className="grid" style={{ marginTop: 10 }} onKeyDown={(e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") save(); }}>
      <label className="f wide"><span>Client name</span><input type="text" id="ncName" autoFocus placeholder="e.g. Gupta Traders Pvt Ltd" value={v.name} onChange={set("name")} /></label>
      <label className="f"><span>GSTIN</span><input type="text" placeholder="09AAACG1111A1Z5" value={v.gstin} onChange={set("gstin")} /></label>
      <label className="f wide"><span>Company in Tally</span>
        <select aria-label="Company in Tally" data-add-tally="" value={v.tallyCompany} onChange={(e) => pick(e.target.value)}>
          <option value="">{seen.length ? "Choose the company in Tally (optional)" : "No Tally company seen yet: open it in Tally on a connected computer"}</option>
          {seen.map((c) => <option key={c.name} value={c.name} disabled={!!c.client}>{c.name + (c.client ? " — linked to " + ((CO(c.client) || {}).name || "another client") : " — " + (c.where || (c.open ? "open in Tally" : "seen")))}</option>)}
        </select></label>
      {v.tallyCompany && <label className="chk wide" data-add-postonly=""><input type="checkbox" checked={v.postOnly} onChange={set("postOnly")} /> Post this client’s entries only into <b>{v.tallyCompany}</b></label>}
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
  // 2.1.3: the client's one line ("Tally open on NWS144 · last read 15:34") leads the tip
  const l = typeof tallyLine === "function" ? tallyLine(co) : null;
  return <span className={"tag " + t.level} title={(l ? l.text + ". " : "") + t.say + (x && t.state === "ok" ? "" : x ? " " + x.say : "")} data-tally={t.state} data-tally-line-tip={l ? l.state : ""}>{MARK[t.level] + t.label}</span>;
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
    {!all.length ? <div className="pane"><p className="empty lt-empty" data-list-empty="" style={{ padding: 0 }}>No clients yet. Use <b>Add client</b> above to add the first one, with its GSTIN and Tally company name.</p></div> : <>
      <div className="row" style={{ margin: "18px 0 8px", justifyContent: "space-between" }}>
        <label className="f" style={{ minWidth: 260 }}><span>Find a client</span>
          <input type="text" value={q} placeholder="Name, GSTIN or Tally name" onChange={(e) => { setQ(e.target.value); S.homeQuery = e.target.value; }} />
        </label>
        <span className="note">About {INR0.format(used)} of {INR0.format(DB_LIMIT)} records used</span>
      </div>
      {/* the one list table (spec K6): the client, its Tally sign (the status), then the counts; the foot adds them up */}
      <ListTable name="clients" className="data" rows={cos} rowKey={(c) => c.id} unit={["client", "clients"]} of={all.length}
        rowProps={(c) => ({ className: "rowlink", onClick: () => openCompany(c.id) })}
        empty={<>No client matches “{q}”. Clear the search, or use <b>Add client</b> above.</>}
        cols={[
          { k: "name", role: "party", label: "Client", v: (c) => c.name, cell: (c) => { const inbox = docqCount(c.id);
            return <><b>{c.name}</b>{inbox > 0 && <> <span className="tag" title="Files waiting in the inbox">{"\u{1F4E5} " + inbox}</span></>}
              {c.tallyName && c.tallyName !== c.name && <div className="note">Tally: {c.tallyName}</div>}</>; } },
          { k: "tally", role: "status", label: "Tally", v: (c) => tallyStatus(c).label, cell: (c) => <TallyLight cid={c.id} /> },
          { k: "gstin", label: "GSTIN", v: (c) => c.gstin || "", cell: (c) => c.gstin || "—" },
          { k: "drafts", label: "To review", cls: "n", v: (c) => (c.stats || {}).drafts || 0, sum: true, fmt: String, cell: (c) => (c.stats || {}).drafts || "—" },
          { k: "check", label: "Need a check", cls: "n", v: (c) => (c.stats || {}).check || 0, sum: true, fmt: String, cell: (c) => { const st = c.stats || {}; return st.check ? <span className="tag warn">{st.check}</span> : "—"; } },
          { k: "waiting", label: "Waiting for Tally", cls: "n", v: (c) => (c.stats || {}).waiting || 0, sum: true, fmt: String, cell: (c) => { const st = c.stats || {}; return st.waiting ? <span className="tag ok">{st.waiting}</span> : "—"; } },
          { k: "tds", label: "TDS " + fy, cls: "n", v: (c) => { const st = c.stats || {}; return st.fy === fy && st.tdsFy ? num(st.tdsFy) : 0; }, sum: true, fmt: money0,
            cell: (c) => { const st = c.stats || {}; return st.fy === fy && st.tdsFy ? money0(st.tdsFy) : "—"; } },
          { k: "free", label: "Read free", cls: "n", cell: (c) => <Free c={c} /> },
          { k: "ac", role: "act", cls: "n", cell: (c) => <button className="btn small" onClick={(e) => { e.stopPropagation(); openCompany(c.id); }}>Open</button> },
        ]} />
    </>}
  </>;
}
