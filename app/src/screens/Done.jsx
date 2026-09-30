// Step 4 of a client, "Done": what has gone to Tally. Was viewDoneStep() (src/js/02) and viewPostLog() (src/js/18).
// The post log is also shown in Settings → Posted to Tally and on the Tally home page, for all clients.

// every entry sent to Tally (or taken back), newest first: S.firm.postLog, kept in the firm's settings
export function PostLog() {
  const log = (S.firm.postLog || []).slice().reverse(), co = CO();
  const all = S.logAll || !co, mine = all ? log : log.filter((r) => r.co === S.coId);
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
      {!mine.length ? <p className="note">Nothing yet.</p> : (
        <div className="tblwrap"><table className="data">
          <thead><tr><th>When</th><th>What</th><th>Client</th><th>Reference</th><th className="n">Amount</th><th>Voucher in Tally</th><th>By</th></tr></thead>
          <tbody>{mine.slice(0, 500).map((r, i) => {
            const t = r.tally || {};
            return <tr key={i} style={r.action === "removed" ? { opacity: 0.65 } : undefined}>
              <td>{new Date(r.at).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
              <td>{r.action === "removed" && <><b>taken back</b> · </>}{r.what === "bill" ? "purchase bill" : r.what === "bank" ? "bank entry" : r.what || ""}</td>
              <td>{(CO(r.co) || {}).name || "—"}</td><td>{r.ref || ""}</td>
              <td className="n">{r.amount ? INR.format(num(r.amount)) : "—"}</td>
              <td>{(t.vchType || "") + " " + (t.masterId || "")}<div className="nr">{t.company || ""}</div></td>
              <td>{r.by || "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

export function DoneStep() {
  const v = Object.values(D().entries);
  const posted = v.filter((e) => e.exportedAt).length, approved = v.filter((e) => e.status === "approved").length;
  const bankHere = S.bank && S.bank.cid === S.coId;
  return (
    <section className="poststep">
      <div className="post-sum">
        <div className="pcard"><span>Bills posted</span><b>{posted}</b><small>{approved} approved in all</small></div>
        <div className="pcard"><span>Bank lines posted</span><b>{bankHere ? S.bank.rows.filter((r) => r.state === "sent").length : "—"}</b><small>in the open statement</small></div>
      </div>
      <div className="row" style={{ margin: "0 0 14px", gap: 10 }}>
        <button className="btn small" onClick={() => doAct("toBillsApproved")}>Approved bills</button>
        <button className="btn small" onClick={() => doAct("toBankDone")}>Bank lines done</button>
      </div>
      <PostLog />
    </section>
  );
}
