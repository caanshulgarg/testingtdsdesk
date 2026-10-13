// One way to link Tally (ui-tidy, 13-Oct-2026; the owner: "still it is very confusing where is the client and how to link
// tally"): every place that mentions a client's Tally link goes to that client's one Link to Tally card (parts/TallyLink.jsx,
// in Client setup → Tally): the client strip's chip, the Clients list's chip, Today's "not linked" line, Getting ready, the
// firm's Tally page and the top bar's Tally sign while the client is not linked. The chip says the link in the card's words
// (TALLY_LINK_WORDS: "Linked · reading", "Waiting for Tally", "Not linked → Link", "Needs you").
export function goTallyCard(cid) {
  const go = () => { S.step = null; S.arm = null; S.tab = "cotally"; S.tallyPanel = false; render(); window.scrollTo(0, 0); };
  if (cid && (S.view !== "company" || S.coId !== cid)) { S.view = "company"; return Promise.resolve(openCompany(cid)).then(go); }
  go(); return Promise.resolve();
}

const MARK = { ok: "● ", warn: "◐ ", bad: "○ " };
export default function TallyChip({ co, where = "", title }) {
  if (!co || typeof tallyLinkOf !== "function") return null;
  const k = tallyLinkOf(co);
  return <button type="button" className={"tag tchip " + k.level} data-tally-chip={k.state} data-tally-chip-at={where} data-tally-link-chip={k.state}
    title={title || ("Link to Tally: " + k.word + (k.company ? " (" + k.company + ")" : ""))} aria-label={co.name + ", Tally: " + k.word}
    onClick={(ev) => { ev.stopPropagation(); goTallyCard(co.id); }}>{MARK[k.level] + k.word}</button>;
}
