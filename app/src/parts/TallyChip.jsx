import { lazy, Suspense, useState } from "react";
import { clientTallyState, mayLink } from "../lib/tallyState.js";
// 31-Oct-2026 (the owner: "this is different tally and splitted.. I need to connect to April 2018 tally only.. I should have
// option to choose"): Client setup chooses and changes the client's Tally company right here, with the Tally page's own
// picker (TallyCompanies.jsx ChangePick: every company FinCom has seen, the client's splits and years first, each in full)
const ChangePick = lazy(() => import("./TallyCompanies.jsx").then((m) => ({ default: m.ChangePick })));
// ONE page for Tally (24-Oct-2026, next-tally-one-page; the owner: "somewhere it is showing, other places it is not
// showing.. I have to go everywhere to see where to add.. I need a clear page only"): a client's company in Tally is
// added, linked, moved, unlinked and synced on the Tally page's Companies in Tally only. Everywhere else a client's Tally
// is ONE status in the same words (lib/tallyState.js, from the cloud's link alone), and a click opens that row:
//   TallyChip  the client's title, the Clients list: "● Connected" / "○ Disconnected" / "◐ Not linked"
//   TallyOne   Client setup: "Tally: <company> ● Connected · Open in Tally page" / "Tally: Not linked · Choose on Tally page"
// goTallyRow(cid): linked, the Tally page with the client's row(s) marked (S.tallyFocus); not linked, the Tally page's list
// for that client (openConnectTally(4, cid): every company with "Link to <client>", the open ones first)
export function goTallyRow(cid) {
  const co = cid && S.companies ? S.companies[cid] : null;
  const linked = co && typeof tallyLinkOf === "function" && tallyLinkOf(co).state !== "unlinked";
  S.tallyPanel = false;
  if (linked) { S.tallyGuide = {}; openTallyFor(cid); } else openConnectTally(4, cid || "");
  window.scrollTo(0, 0);
  return Promise.resolve();
}
export const goTallyCard = goTallyRow;

const MARK = { ok: "● ", warn: "◐ ", bad: "○ " };
export default function TallyChip({ co, where = "", title }) {
  if (!co || typeof tallyLinkOf !== "function") return null;
  // next-link-record: the client's one status line beside it (p.after: parts/LinkStatus.jsx, its own file, once loaded)
  const p = clientTallyState(co);
  return <><button type="button" className={"tag tchip " + p.level} data-tally-chip={p.state} data-tally-chip-at={where} data-tally-link-chip={p.state} data-tally-pill={p.state}
    title={title || ("Tally: " + p.text + (p.company ? " (" + p.company + ")" : "") + ". Open in Tally page.")} aria-label={co.name + ", Tally: " + p.word}
    onClick={(ev) => { ev.stopPropagation(); goTallyRow(co.id); }}>{MARK[p.level] + p.word}</button>{p.after && p.after(where)}</>;
}
// Client setup's one line
export function TallyOne({ co }) {
  const [pick, setPick] = useState(false);
  if (!co || typeof tallyLinkOf !== "function") return null;
  const p = clientTallyState(co), linked = p.state !== "unlinked", may = !(S.account && S.account.me) || mayLink();
  return <><p className="tally-one" data-tally-one={p.state} data-tally-pill={p.state}>
    <b>Tally:</b>{" "}{linked && <span data-tally-one-company="">{p.company}</span>}{linked && " "}
    <span className={"tag " + p.level} title={p.text}>{MARK[p.level] + p.word}</span>
    {linked && p.state !== "connected" && <span className="note">{" " + (p.line ? "— " + p.line : p.text.replace(/^Disconnected/, "").replace(/^ — /, "— "))}</span>}
    {!linked && may && <>{" · "}<button className="linkbtn" data-tally-one-pick="" onClick={() => setPick(!pick)}>Choose Tally company…</button></>}
    {" · "}<button className="linkbtn" data-tally-one-go="" onClick={() => goTallyRow(co.id)}>{linked ? "Open in Tally page" : "Choose on Tally page"}</button>
    {/* next-fix-tally-links: Change and Unlink (asked first), as on the Tally page; 31-Oct-2026: Change opens the picker here */}
    {linked && may && <>{" · "}<button className="linkbtn" data-tally-one-change="" onClick={() => setPick(!pick)}>Change Tally company…</button>
      {" · "}<button className="linkbtn" data-tally-one-unlink="" onClick={() => import("./TallyCompanies.jsx").then((m) => m.unlink({ company: (tallyLinkOf(co) || {}).company || p.company, client: co.id }))}>Unlink</button></>}</p>
    {pick && <Suspense fallback={null}><ChangePick co={co} cur={linked ? (tallyLinkOf(co) || {}).company || p.company : ""} onClose={() => setPick(false)} /></Suspense>}</>;
}
