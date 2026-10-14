// The client's Reconciliations (tds-layout, 14-Oct-2026; the owner: "26AS and TRACES don't belong as top tabs" of TDS):
// a page of its own in the sidebar (#/c/<client>/books/recon). Its first part, "TDS receivable vs 26AS", is what TDS ›
// 26AS & AIS was (tds/Files.jsx Recon26: the client's own 26AS, AIS or TIS against the TDS its books show as receivable,
// and a deductee's 26AS against the client's returns). The old address …/books/tds/<year>/26as opens it.
import { Recon26 } from "../tds/Files.jsx";
import HelpButton from "../../parts/HelpButton.jsx";
import { tdsBarYears } from "../TdsPage.jsx";
import PageTabs from "../../parts/PageTabs.jsx";
import PartyReconPage from "./PartyRecon.jsx";

// phase 3 (14-Oct-2026): three parts, one row of tabs: TDS receivable vs 26AS, Vendors, Customers
const RECON_TABS = [["tds", "TDS receivable vs 26AS"], ["vendors", "Vendors"], ["customers", "Customers"]];
export default function Recon({ b }) {
  const tab = RECON_TABS.some(([id]) => id === S.reconTab) ? S.reconTab : "tds";
  const tabs = <PageTabs tabs={RECON_TABS} value={tab} onPick={(id) => { S.reconTab = id; if (typeof closeDetail === "function" && S.detail) closeDetail(); render(); }} label="Reconciliations" attr="data-recon-tab" />;
  if (tab !== "tds") return <div data-recon-tabs="">{tabs}<PartyReconPage side={tab === "customers" ? "customer" : "vendor"} /></div>;
  return <div data-recon-tabs="">{tabs}<Tds26 b={b} /></div>;
}
function Tds26({ b }) {
  const rows = TDS.rows(), list = Array.from(new Set(tdsBarYears(b, rows))).sort().reverse();
  const fy = S.recFy && list.includes(S.recFy) ? S.recFy : S.tdsFy && list.includes(S.tdsFy) ? S.tdsFy : list[0];
  return <div data-recon-page="">
    <div className="rp-title"><h2 className="tg-h2">TDS receivable vs 26AS</h2>
      <span className="row" style={{ gap: 8 }}><label className="note">Year <select aria-label="Year" value={fy} onChange={(ev) => { S.recFy = ev.target.value; render(); }}>
        {list.map((f) => <option key={f} value={f}>{f}</option>)}</select></label><HelpButton /></span></div>
    <Recon26 fy={fy} />
  </div>;
}
