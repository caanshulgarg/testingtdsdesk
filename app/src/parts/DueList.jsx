// Returns and payments due, across every client (TDS/GST round 2, item 1), on the firm's Compliance page since the TDS &
// GST makeover (round 46, 11-Oct-2026; the owner: "GST and TDS return status inside the client list is illogical"). The
// list is DueList (src/js/68-due-list.js): each client's GST and TDS returns and TDS deposits, due, overdue or filed, from
// the same code as the client's own TDS and GST pages, sorted by due date. A row opens that client's return.
//   DueAll   the list, in three views (Overdue · Due this month · Filed, and All), with GST/TDS and client filters
//   DueLine  the one line Today keeps: "3 returns overdue · Open Compliance →"
//   (DueAll is parts/DueAll.jsx, with the Compliance screen's file: next-fix-audit-all, the first file's size budget)
import { useEffect, useState } from "react";

// the month of today (yyyy-mm), the list's own today (window.__dueToday in the tests)
const thisMonth = () => String(DueList.today()).slice(0, 7);
export const inView = (x, k) => k === "all" || (k === "month" ? x.status === "due" && String(x.due).slice(0, 7) <= thisMonth() : x.status === k);

export function useDue() {
  const [res, setRes] = useState(null);
  const load = () => DueList.all().then(setRes, () => setRes({ items: [], missing: [], failed: true }));
  // drawn again when the open client's books change; the server's copy of each client's work is brought once a session
  const key = S.books ? DueList.keyOf(S.books) : "";
  useEffect(() => { load(); }, [key, Object.keys(S.companies || {}).length]);
  useEffect(() => { DueList.syncAll().then((did) => { if (did) load(); }, () => {}); }, []);
  return res;
}

export function DueLine() {
  const res = useDue();
  if (!res) return null;
  const over = res.items.filter((x) => x.status === "overdue").length, month = res.items.filter((x) => inView(x, "month")).length;
  return <div className="due-line" data-due-line="">
    {over ? <span className="bad">{over} return{over === 1 ? "" : "s"} or payment{over === 1 ? "" : "s"} overdue</span> : <span>Nothing overdue</span>}
    <span className="note" style={{ margin: 0 }}>{month} due this month</span>
    <button className="linkbtn" style={{ marginLeft: "auto" }} data-open-compliance="" onClick={() => navHome("compliance")}>Open Compliance →</button>
  </div>;
}
