// The owner (06-Oct-2026): "An entry using an unknown ledger is applied anyway, with nothing flagged. Until 2.3.1 is out,
// flag these on the page in plain words so they are visible." The entries whose lines name a ledger FinCom does not have
// yet (Rec.unkLines: tally_unknown_ledger_entries, migration 56), one sentence each: "<type> <number> of <date> uses the
// ledger '<name>', which FinCom does not have yet. It is in the books; the ledger's group is unknown until the next ledger
// list or bridge 2.3.1." On the Tally page's Sync activity (the firm, or the client picked) and a client's Books page.
// Nothing when there are none, or before migration 56 runs.
export default function UnknownLedgers({ cid, where, names }) {
  if (typeof Rec !== "object" || !Rec.unkLines || typeof TCloud !== "object" || !TCloud.on()) return null;
  const lines = Rec.unkLines(cid || "");
  if (!lines.length) return null;
  const n = new Set(lines.map((x) => x.key.split(":").slice(0, 2).join(":"))).size;
  const coName = (id) => (S.companies && S.companies[id] && S.companies[id].name) || "";
  return <div className="bk-alert warn" role="status" data-unknown-ledgers={where || ""} style={{ margin: "0 0 8px" }}>
    <b>{n === 1 ? "1 entry uses a ledger FinCom does not have yet" : n + " entries use a ledger FinCom does not have yet"}</b>
    {lines.map((x) => <div key={x.key} data-unknown-ledger="">{x.text}{names && !cid && coName(x.cid) ? <span className="nr">{" (" + coName(x.cid) + ")"}</span> : null}</div>)}
  </div>;
}
