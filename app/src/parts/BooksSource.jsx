// Books source (zoho-books, 13-Oct-2026): one card in Client setup saying which integration feeds this client's books:
// "Tally company X", "Zoho Books organisation Y", or none yet, with a link to that integration's page. For Tally, the
// one line, TallyOne (24-Oct-2026: a client's Tally is linked on the Tally page only); for Zoho the organisation's last
// read and its page.
// booksSourceOf (src/js/74-zoho-books.js) decides; nothing here changes a link.
import { useEffect, useState } from "react";
import { TallyOne } from "./TallyChip.jsx";

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
      {src.kind !== "zoho" && <TallyOne co={co} />}
      {src.kind === "none" && <p className="note" data-books-source-line="">Or connect its Zoho Books organisation on the <button className="linkbtn" onClick={() => goIntegrations("zoho")} data-books-source-go="zoho">Zoho Books page</button>.</p>}
    </div>
  </>;
}
