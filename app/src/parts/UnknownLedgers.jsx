// The ledgers a client's entries use that FinCom does not have yet (migration 56's tally_unknown_ledger_entries, worked out
// live by Rec.unkGroups, src/js/61). The owner, 15-Oct-2026, on 221 near-identical lines for one client: "there should be
// some smart way to show it.. everywhere it is showing like that.. and there is no option to rectify this also".
//   ONE line a client: "9 ledgers used in Tally are not in FinCom yet (INPUT IGST, INPUT CGST, … · 327 entries)", the way
//   to Books › From Tally, whose Update now reads the ledgers (next-tally-basics), with what stops it said plainly; expanded, one
//   row a ledger with its entry count and "see entries". Never a line an entry.
//   Where: the client's Books page (above every tab but Ledgers) and Books -> Ledgers' Please check (UnknownBody), the GST
//   and TDS ledgers pages' Please check; the bell has the count only (AlertHub, src/js/63). Not on Sync activity.
//   No Clear: the line goes by itself the moment each ledger is settled (it arrives in FinCom's list, under Tally's other
//   capitals or spaces too; Tally renamed it; a person confirmed it on the ledgers page).
export default function UnknownLedgers({ cid, where, byBook }) {
  const g = unknownGroup(cid, byBook);
  if (!g) return null;
  return <div className="bk-alert warn" role="status" data-unknown-ledgers={where || ""} style={{ margin: "0 0 8px" }}>
    <UnknownBody g={g} where={where} />
  </div>;
}

// the client's group, or null (nothing to say, an older cloud, not signed in)
export function unknownGroup(cid, byBook = true) {
  if (!cid || typeof Rec !== "object" || !Rec.unkGroups || typeof TCloud !== "object" || !TCloud.on()) return null;
  const books = byBook ? Rec.unkBooks(cid) : [];
  return Rec.unkGroups(cid, books.length ? books : null)[0] || null;
}

export function UnknownBody({ g, where }) {
  const cid = g.cid, can = Rec.unkCan(cid);
  const see = S.unkSee && S.unkSee.cid === cid ? S.unkSee.n : "";
  const toggle = (n) => { S.unkSee = see === n ? null : { cid, n }; render(); };
  return <div data-unk-line={where || ""}>
    <details data-unk-fold="">
      <summary style={{ cursor: "pointer" }}><b data-unk-head="">{Rec.unkHead(g)}</b></summary>
      <table className="led-t nocards" style={{ margin: "6px 0" }}><tbody>
        {g.ledgers.map((x) => <tr key={x.n} data-unk-row={x.n}>
          <td><b className="led-name">{x.n}</b>{" "}<span className="note">{Rec.unkN(x.rows.length)}</span>{" "}
            <button className="linkbtn" data-unk-see={x.n} onClick={() => toggle(x.n)}>{see === x.n ? "hide entries" : "see entries"}</button>
            {see === x.n && <ul className="note" data-unk-entries={x.n} style={{ margin: "4px 0 0 18px" }}>
              {x.rows.slice(0, 30).map((r) => <li key={(r.book_id || "") + ":" + r.guid}>{Rec.unkEntry(r)}</li>)}
              {x.rows.length > 30 && <li key="more" data-unk-more="">{"and " + (x.rows.length - 30) + " more"}</li>}
            </ul>}</td>
        </tr>)}
      </tbody></table>
      <p className="note" style={{ margin: "0 0 4px" }}>The entries are in the books. Each ledger leaves this list by itself once Tally’s ledger list brings it, or once you confirm it on Ledgers.</p>
    </details>
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
      {/* next-tally-basics (the owner): Books › From Tally is the one place that updates the ledgers; this is the way there */}
      <button className="linkbtn" data-unk-go="" data-go-from-tally="" onClick={() => (cid === S.coId || typeof Rec !== "object" || !Rec.openClientTab ? goClient("books:import") : Rec.openClientTab(cid, "books:import"))}>Update ledgers in Books › From Tally</button>
      <span className="note" data-unk-why={can.kind}>{can.text}</span>
    </div>
  </div>;
}
