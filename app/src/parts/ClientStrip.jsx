// The client's own strip (ui-tidy, 13-Oct-2026; the owner: "still it is very confusing where is the client and how to link
// tally"): at the top of every page of a client, under the header's breadcrumb (Clients › the client ▾ › the page), the
// client's own pages in one row (Overview, Bills, Bank, TDS, GST, MIS, Settings) and its one Tally chip, which opens its
// Link to Tally card. Links, not a row of tabs: a page's own tabs stay the page's one row of tabs.
import TallyChip from "./TallyChip.jsx";
import { FinComNav } from "../nav.js";

export default function ClientStrip() {
  const co = S.view === "company" ? CO() : null;
  if (!co || S.loadingCo) return null;
  const setup = isSetupTab(S.tab), bt = S.tab === "books" ? booksTab() : "", mod = docType();
  const work = !setup && !["dash", "clientInbox", "txn", "books"].includes(S.tab);
  const items = [
    ["dash", "Overview", S.tab === "dash", () => goClient("dash")],
    ["bills", "Bills", work && mod === "bills", () => goClient("bills")],
    ["bank", "Bank", work && mod === "bank", () => goClient("bank")],
    ["tds", "TDS", bt === "tds", () => goClient("books:tds")],
    ["gst", "GST", bt === "gst", () => goClient("books:gst")],
    ["mis", "MIS", bt === "mis", () => goClient("books:mis")],
    ["setup", "Settings", setup, () => { if (!setup) toggleSetup(); }],
  ];
  return <div className="cstrip" data-client-strip={co.id}>
    <nav className="ctabs" aria-label={co.name + ": its pages"}>
      {items.map(([k, l, on, go]) => <button key={k} type="button" className="ctab" data-ctab={k} aria-current={on ? "page" : undefined} onClick={() => FinComNav.go(go)}>{l}</button>)}
    </nav>
    <span className="cstrip-tally"><TallyChip co={co} where="strip" /></span>
  </div>;
}
