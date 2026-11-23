// The design proposal's mockups (docs/UX-QUICKBOOKS-OF-INDIA.md). Standalone: not linked from the live app, made-up data.
// ?s=<screen>&theme=dark|light&state=<variant>
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "../styles/fonts.css";
import "./tokens.css";
import "../styles/arc-tokens.css";
import "./proposal.css";
import { BooksMode, BooksCoa, BooksInvoice, BooksDayBook, BooksLedger, BooksTb, BooksAudit, BooksZoho, BooksMove } from "./books.jsx";
import { FirmHome, ClientHome, NewMenu, SearchPalette, Bank, Entry, Tally, System } from "./screens.jsx";

const q = new URLSearchParams(location.search);
const s = q.get("s") || "home", state = q.get("state") || undefined;
document.documentElement.setAttribute("data-theme", q.get("theme") === "dark" ? "dark" : "light");
const SCREENS = {
  home: () => <FirmHome />,
  client: () => <ClientHome />,
  new: () => <ClientHome overlay={<div className="p-newwrap"><NewMenu /></div>} />,
  search: () => <FirmHome overlay={<SearchPalette />} />,
  bank: () => <Bank state={state} />,
  entry: () => <Entry />,
  tally: () => <Tally state={state} />,
  phone: () => <ClientHome phone />,
  phonebank: () => <Bank phone />,
  system: () => <System />,
  // the full-books screens (docs/FULL-BOOKS-PLAN.md)
  "books-mode": () => <BooksMode />,
  "books-coa": () => <BooksCoa />,
  "books-invoice": () => <BooksInvoice />,
  "books-daybook": () => <BooksDayBook />,
  "books-ledger": () => <BooksLedger />,
  "books-tb": () => <BooksTb />,
  "books-audit": () => <BooksAudit />,
  "books-zoho": () => <BooksZoho />,
  "books-move": () => <BooksMove />,
};
createRoot(document.getElementById("root")).render((SCREENS[s] || SCREENS.home)());
