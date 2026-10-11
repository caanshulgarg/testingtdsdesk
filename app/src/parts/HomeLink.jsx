// One home for each thing (clean-up batch 2, 11-Oct-2026): a thing that was shown in two or three places is kept in
// one, its home, and the other places show one line that links there. The homes:
//   the Tally page (firm)  FinCom Bridge on this computer (Computers → Details), and Everything sent to Tally
//   Client setup → Tally   the client's Link to Tally card
//   Settings               People, and Plan and credit
// goTallyPage opens the Tally page on one of its tabs; HomeLink is the one line ("<what> is on the <home> page →").

// the Tally page on a tab: "computers" (bridgeDetails: with its Details, where FinCom Bridge on this computer is,
// opened) or "sent" (Everything sent to Tally, for the open client; "All clients" there shows the firm's)
export function goTallyPage(tab = "computers", { bridgeDetails = false } = {}) {
  S.tallyFocus = "";
  S.tallyTab = tab;
  if (tab === "sent") S.logAll = false;
  // signed in, the bridge's section is inside the page's Details (for support): opened; signed out it is on the page
  if (bridgeDetails) S.tallyMore = Object.assign({}, S.tallyMore || {}, { page: true });
  navHome("tally");
  if (bridgeDetails) setTimeout(() => { const el = document.querySelector("[data-connect-section]"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" }); }, 80);
}

// the one line where a thing used to be repeated: what it is, and the link to its home
export default function HomeLink({ id, text, link, go, ...rest }) {
  return <p className="home-link" data-home-link={id} {...rest}>
    <span>{text}</span>{" "}
    <button type="button" className="linkbtn" data-home-go={id} onClick={go}>{link + " →"}</button>
  </p>;
}
