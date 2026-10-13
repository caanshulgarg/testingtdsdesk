// Books source (zoho-books, 13-Oct-2026): one card in Client setup saying which integration feeds this client's books:
// "Tally company X", "Zoho Books organisation Y", or none yet, with a link to that integration's page. For Tally, the
// existing Link to Tally card (TallyLink) does the rest, as before; for Zoho the organisation's last read and its page.
// booksSourceOf (src/js/74-zoho-books.js) decides; nothing here changes a link.
import { useEffect, useState } from "react";
import TallyLink from "./TallyLink.jsx";

export default function BooksSource({ co, where = "setup" }) {
  const [, tick] = useState(0);
  useEffect(() => { if (typeof ZohoB === "object") ZohoB.load().then(() => tick((n) => n + 1)); }, [co && co.id]);
  if (!co) return null;
  const src = typeof booksSourceOf === "function" ? booksSourceOf(co) : { kind: "none" };
  const z = src.conn;
  return <>
    <div className="card" data-books-source={src.kind}>
      <h3>Books source</h3>
      {src.kind === "zoho" && <p data-books-source-line="">Zoho Books organisation <b>{src.name}</b>
        {z ? <span className="note"> · {z.status === "connected" ? "last read " + (z.lastSync ? fmtDateTime(z.lastSync) : "not yet") : ZohoB.tokenWords(z)}{z.error ? " · " + z.error : ""}</span> : null}
        {" "}<button className="linkbtn" onClick={() => goIntegrations("zoho")} data-books-source-go="zoho">Zoho Books page</button></p>}
      {src.kind === "tally" && <p data-books-source-line="">Tally company <b>{src.name}</b> <button className="linkbtn" onClick={() => { S.tallyFocus = co.id; navHome("tally"); }} data-books-source-go="tally">Tally page</button></p>}
      {src.kind === "none" && <p className="note" data-books-source-line="">None yet. Link this client's company in Tally below, or connect its Zoho Books organisation on the <button className="linkbtn" onClick={() => goIntegrations("zoho")} data-books-source-go="zoho">Zoho Books page</button>.</p>}
    </div>
    {src.kind !== "zoho" && <TallyLink co={co} where={where} />}
  </>;
}
