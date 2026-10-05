// Step 4 of a client, "Done": what has gone to Tally. Was viewDoneStep() (src/js/02) and viewPostLog() (src/js/18).
// The post log is also shown in Settings → Posted to Tally and on the Tally home page, for all clients.
import Msg from "../parts/Msg.jsx";
import ListTable from "../parts/ListTable.jsx";

const logWhat = (r) => (r.what === "bill" ? "purchase bill" : r.what === "bank" ? "bank entry" : r.what || "");
const logState = (r) => (r.action === "removed" ? "Taken back" : !r.fromQueue ? "Sent" : r.already ? "Already in Tally" : r.verified ? "Confirmed in Tally" : "Sent, not confirmed");

// every entry sent to Tally (or taken back), newest first: S.firm.postLog, kept in the firm's settings
export function PostLog() {
  const co = CO(), all = S.logAll || !co;
  // review of 02-Oct-2026: the postings queued in FinCom's cloud come from the server (CloudJobs), so a posting made from
  // any computer is listed; this browser's own log adds the ones made here without the queue (the same voucher once)
  CloudJobs.load();
  const fromQueue = CloudJobs.rows(all ? null : S.coId), seen = new Set(fromQueue.map((r) => r.tally.guid).filter(Boolean));
  const log = fromQueue.concat((S.firm.postLog || []).filter((r) => !(r.tally && r.tally.guid && seen.has(r.tally.guid))))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const mine = all ? log : log.filter((r) => r.co === S.coId);
  return (
    <div className="pane">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Everything sent to Tally</h2>
        <div>
          {co && <button className="btn small" onClick={() => doAct("logAll")}>{S.logAll ? "This client only" : "All clients"}</button>}
          <button className="btn small" onClick={() => doAct("logCsv")}>Download as a file</button>
        </div>
      </div>
      <p className="note" style={{ margin: "6px 0 10px" }}>{mine.length} entr{mine.length === 1 ? "y" : "ies"}{all ? " across every client" : " for " + co.name}. Kept so you can prove what was posted, by whom, and when.</p>
      {CloudJobs.err && <p className="note bad">The postings in FinCom’s cloud could not be read: <Msg text={CloudJobs.err} /></p>}
      {/* the one list table (spec K6); while the postings are read, "Loading…" (K7) */}
      <ListTable name="postlog" className="data" rows={mine} rowKey={(r, i) => (r.tally && r.tally.guid) || r.at + ":" + i} unit={["entry", "entries"]} limit={500}
        loading={!mine.length && CloudJobs.busy ? "the postings" : false}
        rowProps={(r) => (r.action === "removed" ? { style: { opacity: 0.65 } } : {})}
        empty={"Nothing sent to Tally yet" + (all ? "" : " for " + co.name) + ". Approve bills under To review, then use Post to Tally."}
        cols={[
          { k: "at", role: "date", label: "When", v: (r) => r.at || "", cell: (r) => fmtDateTime(r.at) },
          { k: "ref", role: "number", label: "Reference", v: (r) => r.ref || "", cell: (r) => r.ref || "—" },
          { k: "party", role: "party", label: "Party", v: (r) => r.party || "", cell: (r) => r.party || "—" },
          { k: "amt", role: "amount", label: "Amount", cls: "n", v: (r) => num(r.amount) || null, cell: (r) => (r.amount ? money(num(r.amount)) : "—") },
          { k: "st", role: "status", label: "Status", v: logState, cell: (r) => { const w = logState(r); return <span className={"tag " + (r.action === "removed" ? "no" : /not confirmed/.test(w) ? "warn" : "ok")}>{w}</span>; } },
          { k: "what", label: "What", v: (r) => logWhat(r), cell: (r) => <>{logWhat(r)}{r.fromQueue && <div className="nr">from the cloud queue</div>}</> },
          all && { k: "co", label: "Client", v: (r) => (CO(r.co) || {}).name || "", cell: (r) => (CO(r.co) || {}).name || "—" },
          { k: "vch", label: "Voucher in Tally", cell: (r) => { const t = r.tally || {}; return <>{(t.vchType || "") + " " + (t.masterId || "")}<div className="nr">{t.company || ""}</div></>; } },
          { k: "by", label: "By", v: (r) => (r.fromQueue ? memberName(r.by) : r.by || ""), cell: (r) => (r.fromQueue ? memberName(r.by) : r.by || "—") },
        ]} />
    </div>
  );
}

export function DoneStep() {
  const v = Object.values(D().entries);
  setTimeout(() => TallyProof.check(S.coId).catch(() => {}), 0);
  const posted = v.filter(billInTally).length, approved = v.filter((e) => e.status === "approved").length;
  const bankHere = S.bank && S.bank.cid === S.coId;
  return (
    <section className="poststep">
      <div className="post-sum">
        <div className="pcard"><span>Bills posted</span><b>{posted}</b><small>{approved} approved in all</small></div>
        <div className="pcard"><span>Bank lines in Tally</span><b>{bankHere ? tabCounts(S.bank.rows).done : "—"}</b><small>matched to a Tally voucher, open statement</small></div>
      </div>
      <div className="row" style={{ margin: "0 0 14px", gap: 10 }}>
        <button className="btn small" onClick={() => doAct("toBillsApproved")}>Approved bills</button>
        <button className="btn small" onClick={() => doAct("toBankDone")}>Bank lines done</button>
      </div>
      <PostLog />
    </section>
  );
}
