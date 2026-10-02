// Step 4 of a client, "Done": what has gone to Tally. Was viewDoneStep() (src/js/02) and viewPostLog() (src/js/18).
// The post log is also shown in Settings → Posted to Tally and on the Tally home page, for all clients.

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
      {CloudJobs.err && <p className="note bad">{"The postings in FinCom’s cloud could not be read: " + CloudJobs.err}</p>}
      {!mine.length ? <p className="note">{CloudJobs.busy ? "Reading the postings…" : "Nothing yet."}</p> : (
        <div className="tblwrap"><table className="data">
          <thead><tr><th>When</th><th>What</th><th>Client</th><th>Reference</th><th className="n">Amount</th><th>Voucher in Tally</th><th>By</th></tr></thead>
          <tbody>{mine.slice(0, 500).map((r, i) => {
            const t = r.tally || {};
            return <tr key={i} style={r.action === "removed" ? { opacity: 0.65 } : undefined}>
              <td>{fmtDateTime(r.at)}</td>
              <td>{r.action === "removed" && <><b>taken back</b> · </>}{r.what === "bill" ? "purchase bill" : r.what === "bank" ? "bank entry" : r.what || ""}
                {r.fromQueue && <div className="nr">{r.already ? "already in Tally" : r.verified ? "confirmed in Tally" : "not confirmed"} · from the cloud queue</div>}</td>
              <td>{(CO(r.co) || {}).name || "—"}</td><td>{r.ref || ""}{r.party && <div className="nr">{r.party}</div>}</td>
              <td className="n">{r.amount ? money(num(r.amount)) : "—"}</td>
              <td>{(t.vchType || "") + " " + (t.masterId || "")}<div className="nr">{t.company || ""}</div></td>
              <td>{r.fromQueue ? memberName(r.by) : r.by || "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>
      )}
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
