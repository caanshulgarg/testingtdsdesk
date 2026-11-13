// Clients: the list of clients (find one, open it) and Add client. Was viewClients() and addCompanyForm() in src/js/18.
// Clean-up batch 2 (11-Oct-2026, "one main button, one place for each thing"): the page has one job, the list, and one
// main button, Add client. Uploading bills for any client, the reading check and the Day Books for several clients are
// under the page's More, each opening its panel above the list; the records used are under Settings → Plan and credit.
import { useState, Suspense } from "react";
import DropZone from "../parts/DropZone.jsx";
import { MultiUpload } from "../parts/Notes.jsx";
import { Jobs, ReadingCheck, UploadOptions } from "../parts/Reading.jsx";
import ListTable from "../parts/ListTable.jsx";
import More from "../parts/More.jsx";
import { goTallyRow } from "../parts/TallyChip.jsx";
import { clientTallyState } from "../lib/tallyState.js";
import Filters, { Search } from "../parts/Filters.jsx";
import { FirstRunTally } from "../parts/TallyFirstRun.jsx";
import { lazyModule } from "./lazy.js";

// "Needs you" of a client: its duplicates and its bills to check, the same count as on Today
const needsYou = (c) => { const st = c.stats || {}; return (st.dups || 0) + (st.check || 0); };

// Add client (parts/AddClient.jsx, its own file: fetched with the other screens, or when the form is first opened)
const AddClient = lazyModule(() => import("../parts/AddClient.jsx"))();

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
  const l = typeof tallyLine === "function" ? tallyLine(co) : null;
  // 24-Oct-2026 (next-tally-one-page): the one status (lib/tallyState.js: Connected / Disconnected / Not linked), the same
  // words as the client's title chip and its row on the Tally page; a click opens that row
  const p = clientTallyState(co);
  return <button type="button" className={"tag tchip " + p.level} title={p.text + (p.company ? " (" + p.company + ")" : "") + ". " + (l ? l.text + ". " : "") + t.label + ". " + t.say + (x && (t.state === "ok" || t.state === "held") ? "" : x ? " " + x.say : "")}
    data-tally={t.state} data-tally-link-chip={p.state} data-tally-chip={p.state} data-tally-pill={p.state} data-tally-chip-at="clients" data-tally-line-tip={l ? l.state : ""}
    onClick={(ev) => { ev.stopPropagation(); goTallyRow(cid); }}>{MARK[p.level] + p.word}</button>;
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
  const all = Object.values(S.companies).filter((c) => c && !c.deleted), find = q.trim().toLowerCase();
  // console phase 1b: companies FinCom switched off are left out (sortedCompanies) unless "Show inactive" is on
  const offN = FirmGate.offCount();
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
      {offN > 0 && <label className="chk" data-show-inactive=""><input type="checkbox" checked={!!S.showInactive} onChange={FirmGate.showAll} /> Show inactive ({offN})</label>}
      {!S.addingCo && <button className={"btn small" + (S.multiUp ? "" : " primary")} data-add-client="" onClick={() => doAct("addCo")}>Add client</button>}</>} />
    {S.addingCo && <div className="pane" style={{ marginTop: 0 }}><Suspense fallback={null}><AddClient /></Suspense></div>}
    {panel && <Panel id={panel} />}
    <Jobs which="auto" />
    {!all.length ? <div className="pane"><p className="empty lt-empty" data-list-empty="" style={{ padding: 0 }}>No clients yet. Use <b>Add client</b> above to add the first one, with its GSTIN and Tally company name.</p><FirstRunTally /></div> : <>
      {/* the one list table (spec K6): the client, its Tally sign (the status), then the counts; the foot adds them up */}
      <ListTable name="clients" className="data" rows={cos} rowKey={(c) => c.id} unit={["client", "clients"]} of={all.length}
        rowProps={(c) => ({ className: "rowlink", onClick: () => openCompany(c.id) })}
        empty={<>No client matches “{q}”. Clear the search, or use <b>Add client</b> above.</>}
        cols={[
          { k: "name", role: "party", label: "Client", v: (c) => c.name, cell: (c) => { const inbox = docqCount(c.id);
            return <><b>{c.name}</b>{FirmGate.off(c.id) && <> <span className="tag no" data-client-off="">Switched off</span></>}{inbox > 0 && <> <span className="tag" title="Files waiting in the inbox">{"\u{1F4E5} " + inbox}</span></>}
              {(() => { const tc = clientTallyState(c).company; return tc && tc !== c.name ? <div className="note" data-client-tally-co="">Tally: {tc}</div> : null; })()}</>; } },
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
