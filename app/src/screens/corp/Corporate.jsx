// Corporate (07-Nov-2026; the owner approved the designs "Corporate and e-Forms" and "ROC documents" and said "build it"):
// a company's own page in FinCom, for the CA who looks after its company law work. Phase 1:
//   Company profile        the company's record (CIN, class, capital, auditor, AGM ...), its directors and KMP,
//                          shareholders and charges, and its compliance health worked out from them (Profile.jsx);
//   e-Forms                the annual forms with their due dates, and the event-based ones, each tracked to its SRN
//                          (Forms.jsx; the rules in rules.js);
//   Resolutions & minutes  board resolutions, the notice of a board meeting and the minutes, on letterhead or plain
//                          paper, as Word and PDF (Docs.jsx; the templates in templates/);
//   AOC-4                  the figures in the form's order from the financial statements, checked, with the attachments
//                          (Aoc4.jsx, a file of its own with the statements' model).
// FinCom does not file on the MCA portal (there is no MCA API): it prepares the figures and the attachments; the person
// files with DSC on the portal and types the SRN back in.
//
// One lazy chunk (Corporate-*.js, imported by Books.jsx): nothing of it is in the app's first file or in legacy.js. Its pages
// are books tabs for their addresses: books:corp (profile), corp-forms, corp-docs, corp-aoc4 (#/c/<client>/books/corp...).
// Shown for companies only (FS.entityOf: the PAN's fourth letter C, or Company chosen in Client setup). Where the work is
// kept is said under the tabs (store.js).
import { useEffect } from "react";
import "./corp.css";
import { loadSerif } from "./fonts.js";
import PageTabs from "../../parts/PageTabs.jsx";
import Button from "../../parts/Button.jsx";
import Profile, { shown } from "./Profile.jsx";
import Forms from "./Forms.jsx";
import Docs from "./Docs.jsx";
import { corpOf, cloudNote, retryNow, settleRemoved } from "./store.js";
import { dueCount, dueItems } from "./eforms.js";

// the serif of the documents and headings, kept with the app (fonts.js; never from another site), once, when the page
// first opens (Georgia meanwhile)
function useSerif() { useEffect(() => { loadSerif(); }, []); }

export const isCompany = (co) => !!co && typeof FS === "object" && FS.entityOf(co).code === "C";
// the page of a books tab: corp -> profile, corp-forms -> forms, corp-docs -> docs, corp-aoc4 -> aoc4
export const pageOf = (bt) => (String(bt || "").split("-")[1] || "profile");
export const goCorp = (page) => goClient("books:" + (page && page !== "profile" ? "corp-" + page : "corp"));

function NotCompany({ co }) {
  const e = typeof FS === "object" ? FS.entityOf(co) : { code: "" }, what = e.code && FS.ENTITY[e.code];
  return <div className="corp-card corp-empty" data-corp-not-company="">
    <p style={{ margin: "0 0 10px" }}>{"Corporate is for companies. " + co.name + (what ? " is set up as: " + what + "." : " has no entity type yet (no PAN).")}</p>
    <Button className="btn small" onClick={() => { S.step = null; S.tab = "settings"; render(); }}>Open Client setup</Button>
  </div>;
}

export default function Corporate() {
  useSerif();
  const co = CO();
  if (!co) return null;
  if (!isCompany(co)) return <div className="corp"><NotCompany co={co} /></div>;
  const page = pageOf(booksTab()), tab = page === "aoc4" ? "forms" : page;
  const c = corpOf(co.id), P = shown(co), due = dueCount(P, c.filings), note = cloudNote(co.id);
  // Corporate is kept in the firm account only: signed out, nothing to show or change
  if (note.signin) return <div className="corp" data-corp=""><div className="corp-card corp-empty" data-corp-signin="">
    <p style={{ margin: "0 0 10px" }}>Sign in to use Corporate. The company's profile, e-Forms and documents are kept in the firm account, so everyone in the firm sees the same.</p>
    <Button className="btn small primary" onClick={() => goSettings("account")}>Sign in</Button></div></div>;
  return <div className="corp" data-corp="">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
      <PageTabs label="Corporate" attr="data-corp-tab" value={tab} onPick={(k) => goCorp(k)}
        tabs={[["profile", "Company profile"], ["forms", "e-Forms", due || null], ["docs", "Resolutions & minutes"]]} />
      <span className="corp-note" data-corp-cloud={note.tone} role="status" style={{ fontSize: 12, color: note.tone === "bad" ? "var(--corp-bad)" : note.tone === "warn" ? "var(--corp-warn)" : undefined }}>{note.text}
        {(note.removed || []).map((r) => <span key={r.key} data-corp-removed={r.key}>{" " + r.name + ": "}<button className="linkbtn" data-corp-restore={r.key} onClick={() => settleRemoved(co.id, true, r.key)}>Restore</button>{" / "}<button className="linkbtn" data-corp-discard={r.key} onClick={() => settleRemoved(co.id, false, r.key)}>Discard</button></span>)}
        {note.after && <span data-corp-also="">{" " + note.after}</span>}
        {note.retry && <> <button className="linkbtn" data-corp-retry="" onClick={() => retryNow(co.id)}>Retry</button></>}</span>
    </div>
    {page === "forms" ? <Forms key={co.id} co={co} />
      : page === "docs" ? <Docs key={co.id} co={co} />
      : page === "aoc4" ? <div className="corp-card corp-empty" data-corp-page="aoc4">The AOC-4 builder comes with the next part of this release.</div>
      : <Profile key={co.id} co={co} formsDue={dueItems(P, c.filings)} />}
  </div>;
}
