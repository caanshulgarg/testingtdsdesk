// The design proposal's mockups (docs/UX-QUICKBOOKS-OF-INDIA.md). Standalone: not linked from the live app, made-up data.
// ?s=<screen>&theme=dark|light&state=<variant>
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "../styles/fonts.css";
import "./tokens.css";
import "../styles/arc-tokens.css";
import "./proposal.css";
import { FirmHome, ClientHome, NewMenu, SearchPalette, Bank, Entry, Tally, System } from "./screens.jsx";
import { BankStatements, Settings } from "./screens2.jsx";
import { BankLines, BankRules, Purchase } from "./screens3.jsx";

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
  stmts: () => <BankStatements />,
  stmtsphone: () => <BankStatements phone />,
  upload: () => <BankStatements upload />,
  stmtopen: () => <BankLines stmt />,
  lines: () => <BankLines />,
  linescollapsed: () => <BankLines view={q.get("nobulk") ? "full" : "bulk"} collapsed />,
  linesledger: () => <BankLines view="ledger" />,
  linesamount: () => <BankLines view="amount" />,
  linesdate: () => <BankLines view="date" />,
  linescols: () => <BankLines view="cols" />,
  linessheet: () => <BankLines view="sheet" phone />,
  purchase: () => <Purchase />,
  linesopen: () => <BankLines view="open" stmt />,
  linesphone: () => <BankLines phone />,
  rules: () => <BankRules />,
  settings: () => <Settings />,
  settingsphone: () => <Settings phone />,
};
createRoot(document.getElementById("root")).render((SCREENS[s] || SCREENS.home)());
