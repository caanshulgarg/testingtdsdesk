import { clientTallyState } from "../lib/tallyState.js";
// One way to link Tally (ui-tidy, 13-Oct-2026; the owner: "still it is very confusing where is the client and how to link
// tally"): every place that mentions a client's Tally link goes to that client's one Link to Tally card (parts/TallyLink.jsx,
// in Client setup → Tally): the client strip's chip, the Clients list's chip, Today's "not linked" line, Getting ready, the
// firm's Tally page and the top bar's Tally sign while the client is not linked. The chip says the link in the card's words
// (TALLY_LINK_WORDS: "Linked · reading", "Waiting for Tally", "Not linked → Link", "Needs you").
// 15-Oct-2026 (the owner: "multiple places to connect.. need a very simple connection guide"): ONE place connects and
// links Tally, the Tally page's Connect Tally guide (openConnectTally, src/js/52). A chip of a client not linked, or
// linked but waiting for Tally, points there (step 4 with that client); a client linked and reading, or needing a Day
// Book, opens its own Tally card (Client setup → Tally: what it needs, and the posting company), which links nothing
// next-tally-suvit (Suvit's flow): every chip opens the client's own Tally card, which says the company's state in the one
// pill (lib/tallyState.js) with Sync now, and, while not linked, lists the companies in Tally it may be, each with Link
export function goTallyCard(cid) {
  return goTallySetup(cid);
}
// the client's own Tally card (Client setup → Tally)
export function goTallySetup(cid) {
  const go = () => { S.step = null; S.arm = null; S.tab = "cotally"; S.tallyPanel = false; render(); window.scrollTo(0, 0); };
  if (cid && (S.view !== "company" || S.coId !== cid)) { S.view = "company"; return Promise.resolve(openCompany(cid)).then(go); }
  go(); return Promise.resolve();
}

const MARK = { ok: "● ", warn: "◐ ", bad: "○ " };
export default function TallyChip({ co, where = "", title }) {
  if (!co || typeof tallyLinkOf !== "function") return null;
  const lk = tallyLinkOf(co), p = clientTallyState(co);
  // the pill's word (Connected / Disconnected / Not linked), "Needs you" when a person must act
  const k = Object.assign({}, lk, lk.state === "needs" ? {} : { level: p.level, word: p.word });
  return <button type="button" className={"tag tchip " + k.level} data-tally-chip={k.state} data-tally-chip-at={where} data-tally-link-chip={k.state} data-tally-pill={p.state}
    title={title || ("Tally: " + p.text + (k.company ? " (" + k.company + ")" : ""))} aria-label={co.name + ", Tally: " + k.word}
    // upload-pages (14-Oct-2026): beside an upload page's name, "Tally needs you" ("○ Needs you" beside Purchase read as
    // the bills to review); the other words already say Tally
    onClick={(ev) => { ev.stopPropagation(); goTallyCard(co.id); }}>{MARK[k.level] + (where === "title" && k.state === "needs" && typeof uploadPage === "function" && uploadPage() ? "Tally " + k.word.toLowerCase() : k.word)}</button>;
}
