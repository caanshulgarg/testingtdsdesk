// Clients: the list of clients (find one, open it) and Add client. Was viewClients() and addCompanyForm() in src/js/18.
// Clean-up batch 2 (11-Oct-2026, "one main button, one place for each thing"): the page has one job, the list, and one
// main button, Add client. Uploading bills for any client, the reading check and the Day Books for several clients are
// under the page's More, each opening its panel above the list; the records used are under Settings → Plan and credit.
import { useState } from "react";
import DropZone from "../parts/DropZone.jsx";
import { MultiUpload } from "../parts/Notes.jsx";
import { Jobs, ReadingCheck, UploadOptions } from "../parts/Reading.jsx";
import ListTable from "../parts/ListTable.jsx";
import More from "../parts/More.jsx";
import { goTallyCard } from "../parts/TallyChip.jsx";
import { seenWords } from "../parts/TallyLink.jsx";
import Filters, { Search } from "../parts/Filters.jsx";

// "Needs you" of a client: its duplicates and its bills to check, the same count as on Today
const needsYou = (c) => { const st = c.stats || {}; return (st.dups || 0) + (st.check || 0); };

// Add client. 23-Oct-2026 (next-fix-tally-link; the owner added Salesify twice and it "is not updating"):
//   Pick from Tally first: the companies FinCom has seen in Tally and not linked to a client (open now or not), each with
//   its computer and when it was last seen, the best match for what is typed on top. "Add as client" adds the client
//   already linked (saveNewCompany → tallyLinkClient, the person's own choice); a client of the same name already there is
//   offered instead ("Salesify Marketing LLP already exists — link this company to it?").
//   Or type a new client: a client of the same or a similar name, or the same GSTIN, is said under the name with Open it;
//   adding one of the same name again is asked first. The old "Company in Tally" list and free "Company name in Tally" box
//   are gone: a company picked and then cleared stayed in that box as the client's Tally name, and tally-ingest linked
//   that company (VMS EVENTS) to the new client by itself.
const SHOW_PICK = 6;
function PickFromTally({ v, onAdd, busy }) {
  const [all, setAll] = useState(false);
  const seen = tallyCompaniesSeen().filter((c) => !c.client);
  // the best match for what is typed (name or GSTIN) on top; then open now, then the latest seen
  const probe = { id: "", name: v.name, gstin: v.gstin };
  const row = (c) => ((TCloud.pane || {}).companies || []).find((x) => x.company === c.name) || {};
  const at = (c) => row(c).last_seen || "";
  // the computer that reported it (tally_companies.device_id), for "seen on NWS144"
  const pc = (c) => { const d = ((TCloud.pane || {}).devices || []).find((x) => x.id === row(c).device_id); return d && typeof tallyPcLabel === "function" ? tallyPcLabel(d) : ""; };
  const ranked = (typeof suggestFor === "function" && (v.name || v.gstin)
    ? suggestFor(probe, seen.map((c) => Object.assign({ company: c.name, at: at(c) }, c)))
    : seen.map((c) => Object.assign({ company: c.name, at: at(c), score: 0, why: "" }, c)).sort((a, b) => (b.open - a.open) || String(b.at).localeCompare(String(a.at)) || a.company.localeCompare(b.company)));
  const shown = all ? ranked : ranked.slice(0, SHOW_PICK);
  return <section className="addc-pick" data-add-pick={ranked.length}>
    <h3>Pick from Tally</h3>
    <p className="note" style={{ margin: "0 0 4px" }}>{ranked.length ? "The companies FinCom has seen in Tally and not linked to a client yet. Adding one links it at once."
      : "No Tally company is waiting to be linked. Open the client’s company in TallyPrime on a connected computer and it shows here within a minute, or type the client below."}</p>
    {shown.length > 0 && <ul className="tlink-list">{shown.map((c, i) => <li key={c.company} data-add-pick-row={c.company} data-why={c.why || ""}>
      <span className="tlink-co"><b>{c.company}</b>
        {c.why && <span className={"tag " + (c.why === "like" ? "warn" : "ok")}>{c.why === "gstin" ? "same GSTIN" : c.why === "name" ? "same name" : "similar name"}</span>}
        <span className="note">{c.open ? c.where || "open in Tally" : (pc(c) ? "seen on " + pc(c) : c.where || "seen in Tally") + (c.at ? " · last seen " + seenWords(c.at) : "")}</span></span>
      <button className="btn small" data-add-pick-company={c.company} disabled={!!busy} onClick={() => onAdd(c)}>{busy === c.company ? "Adding…" : "Add as client"}</button>
    </li>)}</ul>}
    {ranked.length > shown.length && <button className="linkbtn" data-add-pick-all="" onClick={() => setAll(true)}>{"Show all " + ranked.length}</button>}
  </section>;
}

function AddClient() {
  const others = sortedCompanies();
  const [v, setV] = useState({ name: "", gstin: "", copyFrom: "", turnover10cr: false });
  const [busy, setBusy] = useState("");
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  // the Tally companies the bridge here sees open, and the ones the firm's Tally computers reported (02-Oct-2026)
  if (typeof TCloud === "object" && TCloud.on() && TCloud.pane.devices === null && !TCloud.pane.busy) setTimeout(() => TCloud.refreshPane(), 0);
  const live = Object.values(S.companies || {}).filter((c) => !c.deleted);
  const dups = typeof similarClients === "function" && (v.name.trim() || v.gstin.trim()) ? similarClients(v.name, v.gstin, live) : [];
  const pickable = (typeof TCloud === "object" && TCloud.on()) || (typeof Bridge === "object" && Bridge.up());
  const openIt = (c) => { S.addingCo = false; openCompany(c.id); S.tab = "cotally"; render(); };
  const save = async () => {
    const same = dups.find((d) => d.why === "same");
    if (same && !(await askConfirm({ title: same.client.name + " already exists", ok: "Add another",
      body: "<p>A client named <b>" + esc(same.client.name) + "</b> is already in FinCom. Open it from Clients instead, or add another client with this name.</p>" }))) return;
    saveNewCompany({ ...v, dupOk: !!same });
  };
  // Pick from Tally: a client of the same name already there is linked instead of adding a second one
  const addFromTally = async (c) => {
    const name = v.name.trim() && sameTallyName(v.name, c.company) ? v.name.trim() : clientNameFromTally(c.company);
    const twin = similarClients(name, c.gstin || "", live).find((d) => d.why === "same" || d.why === "gstin");
    if (twin) {
      const ok = await askConfirm({ title: twin.client.name + " already exists", ok: "Link it to " + twin.client.name,
        body: "<p><b>" + esc(twin.client.name) + "</b> is already in FinCom" + (twin.why === "gstin" ? " with this GSTIN" : "") + ". Link the Tally company <b>" + esc(c.company) + "</b> to it instead of adding another client?</p>" });
      if (!ok) return;
      setBusy(c.company); const done = await tallyLinkClient(c.company, twin.client.id); setBusy("");
      if (done) openIt(twin.client);
      return;
    }
    setBusy(c.company);
    saveNewCompany({ ...v, name, gstin: v.gstin || c.gstin || "", tallyCompany: c.company, postOnly: false });
    setBusy("");
  };
  return <>
    <h2>Add client</h2>
    {pickable && <PickFromTally v={v} onAdd={addFromTally} busy={busy} />}
    {pickable && <h3 style={{ margin: "6px 0 0", fontSize: 15 }}>Or type a new client</h3>}
    <div className="grid" style={{ marginTop: 10 }} onKeyDown={(e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") save(); }}>
      <label className="f wide"><span>Client name</span><input type="text" id="ncName" autoFocus autoComplete="off" placeholder="e.g. Gupta Traders Pvt Ltd" value={v.name} onChange={set("name")} /></label>
      <label className="f"><span>GSTIN</span><input type="text" autoComplete="off" placeholder="09AAACG1111A1Z5" value={v.gstin} onChange={set("gstin")} /></label>
      {dups.length > 0 && <div className="addc-dup wide" data-add-dup={dups[0].why} role="status">
        <span>{dups[0].why === "gstin" ? dups[0].client.name + " already has this GSTIN." : dups[0].why === "same" ? dups[0].client.name + " already exists." : "A client with a similar name exists: " + dups[0].client.name + "."}</span>
        <button className="linkbtn" data-add-dup-open={dups[0].client.id} onClick={() => openIt(dups[0].client)}>Open it</button></div>}
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
  // round 39: the chip says the client's link in the same four words as its Link to Tally card and the top bar's sign
  const l = typeof tallyLine === "function" ? tallyLine(co) : null, k = tallyLinkOf(co);
  // ui-tidy (13-Oct-2026); 15-Oct-2026: a client not linked points to Connect Tally, step 4 (goTallyCard, parts/TallyChip.jsx)
  return <button type="button" className={"tag tchip " + k.level} title={(k.company ? k.word + ": " + k.company + ". " : "") + (l ? l.text + ". " : "") + t.label + ". " + t.say + (x && (t.state === "ok" || t.state === "held") ? "" : x ? " " + x.say : "")}
    data-tally={t.state} data-tally-link-chip={k.state} data-tally-chip={k.state} data-tally-chip-at="clients" data-tally-line-tip={l ? l.state : ""}
    onClick={(ev) => { ev.stopPropagation(); goTallyCard(cid); }}>{MARK[k.level] + k.word}</button>;
}

// the panels under More, one at a time (S.clientsPanel); the Day Books panel stays while its files are being matched
const PANELS = { upload: "Upload bills for any client", daybooks: "Day Books for several clients", reading: "Reading check" };
function Panel({ id }) {
  const close = <button className="linkbtn" data-clients-panel-close="" onClick={() => { S.clientsPanel = ""; if (id === "daybooks" && S.multiUp && !S.multiUp.busy) doAct("multiClose"); else render(); }}>Close</button>;
  if (id === "upload") return <div className="pane" data-clients-panel="upload">
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h3 style={{ margin: 0 }}>{PANELS.upload}</h3>{close}</div>
    <DropZone mode="auto" label="Upload invoices for any client">
      <strong>Upload invoices for any client</strong>
      <div className="note">Drop any number of bills. Each is filed under the client whose GSTIN it is billed to; anything that does not match waits in Unsorted uploads. Files already uploaded are skipped.</div>
    </DropZone>
    <div style={{ marginTop: 8 }}><UploadOptions /></div>
  </div>;
  if (id === "reading") return <div className="pane" data-clients-panel="reading">
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h3 style={{ margin: 0 }}>{PANELS.reading}</h3>{close}</div>
    <ReadingCheck />
  </div>;
  return <div data-clients-panel="daybooks"><div className="row" style={{ justifyContent: "flex-end" }}>{close}</div><MultiUpload /></div>;
}

export default function Clients() {
  // the search box: typed at once, the list follows a moment later (as before)
  const [q, setQ] = useState(S.homeQuery || "");
  const all = Object.values(S.companies), find = q.trim().toLowerCase();
  const cos = sortedCompanies().filter((c) => !find || c.name.toLowerCase().includes(find) || (c.gstin || "").toLowerCase().includes(find) || (c.pan || "").toLowerCase().includes(find) || (c.tallyName || "").toLowerCase().includes(find));
  const panel = S.multiUp ? "daybooks" : PANELS[S.clientsPanel] ? S.clientsPanel : "";
  const open = (id) => { S.clientsPanel = id; S.addingCo = false; render(); };
  return <>
    {/* the page's one row (ui-tidy: the one filter bar): find a client, Clear; More and Add client (the one main button) at its end */}
    <Filters className="clients-head" label="Find a client" data-clients-head=""
      search={all.length > 0 ? <Search value={q} placeholder="Name, GSTIN, PAN or Tally name" label="Find a client" onChange={(v) => { setQ(v); S.homeQuery = v; }} /> : null}
      onClear={all.length > 0 ? () => { setQ(""); S.homeQuery = ""; } : null} active={!!q}
      tools={<><More label="More" data-clients-more="" items={[[PANELS.upload, () => open("upload"), { "data-clients-open": "upload" }], [PANELS.daybooks, () => open("daybooks"), { "data-clients-open": "daybooks" }],
        [PANELS.reading, () => open("reading"), { "data-clients-open": "reading" }]]} />
      {/* while the Day Books' files are matched, their "Bring them in" is the main button */}
      {!S.addingCo && <button className={"btn small" + (S.multiUp ? "" : " primary")} data-add-client="" onClick={() => doAct("addCo")}>Add client</button>}</>} />
    {S.addingCo && <div className="pane" style={{ marginTop: 0 }}><AddClient /></div>}
    {panel && <Panel id={panel} />}
    <Jobs which="auto" />
    {!all.length ? <div className="pane"><p className="empty lt-empty" data-list-empty="" style={{ padding: 0 }}>No clients yet. Use <b>Add client</b> above to add the first one, with its GSTIN and Tally company name.</p></div> : <>
      {/* the one list table (spec K6): the client, its Tally sign (the status), then the counts; the foot adds them up */}
      <ListTable name="clients" className="data" rows={cos} rowKey={(c) => c.id} unit={["client", "clients"]} of={all.length}
        rowProps={(c) => ({ className: "rowlink", onClick: () => openCompany(c.id) })}
        empty={<>No client matches “{q}”. Clear the search, or use <b>Add client</b> above.</>}
        cols={[
          { k: "name", role: "party", label: "Client", v: (c) => c.name, cell: (c) => { const inbox = docqCount(c.id);
            return <><b>{c.name}</b>{inbox > 0 && <> <span className="tag" title="Files waiting in the inbox">{"\u{1F4E5} " + inbox}</span></>}
              {c.tallyName && c.tallyName !== c.name && <div className="note">Tally: {c.tallyName}</div>}</>; } },
          { k: "tally", role: "status", label: "Tally", v: (c) => tallyStatus(c).label, cell: (c) => <TallyLight cid={c.id} /> },
          { k: "gstin", label: "GSTIN / PAN", v: (c) => c.gstin || c.pan || "", cell: (c) => <>{c.gstin ? <span className="code">{c.gstin}</span> : "—"}{c.pan && (!c.gstin || c.gstin.slice(2, 12) !== c.pan) ? <div className="nr">PAN {c.pan}</div> : null}</> },
          { k: "drafts", label: "To review", cls: "n", v: (c) => (c.stats || {}).drafts || 0, sum: true, fmt: String, cell: (c) => (c.stats || {}).drafts || "—" },
          // the count words of Today (clean-up batch 1): Ready to post, then Needs you (duplicates and bills to check, as Today counts them)
          { k: "waiting", label: "Ready to post", cls: "n", v: (c) => (c.stats || {}).waiting || 0, sum: true, fmt: String, cell: (c) => { const st = c.stats || {}; return st.waiting ? <span className="tag ok">{st.waiting}</span> : "—"; } },
          { k: "check", label: "Needs you", cls: "n", v: (c) => needsYou(c), sum: true, fmt: String, cell: (c) => { const k = needsYou(c); return k ? <span className="tag warn">{k}</span> : "—"; } },
          // round 46: no return figures here (TDS of the year was one); returns and payments due are on the Compliance page
          { k: "free", label: "Read free", cls: "n", cell: (c) => <Free c={c} /> },
          { k: "ac", role: "act", cls: "n", cell: (c) => <button className="btn small" onClick={(e) => { e.stopPropagation(); openCompany(c.id); }}>Open</button> },
        ]} />
    </>}
  </>;
}
