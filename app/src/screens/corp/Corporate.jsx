// Corporate (07-Nov-2026; the owner approved the designs "Corporate and e-Forms" and "ROC documents" and said "build it"):
// a company's own page in FinCom, for the CA who looks after its company law work. Phase 1:
//   Company profile        the company's record (CIN, class, capital, auditor, AGM ...), its directors and KMP,
//                          shareholders and charges, and its compliance health worked out from them;
//   e-Forms                the annual forms with their due dates, and the event-based ones, each tracked to its SRN;
//   Resolutions & minutes  board resolutions, the notice of a board meeting and the minutes, on letterhead or plain
//                          paper, as Word and PDF;
//   AOC-4                  the figures in the form's order from the financial statements, checked, with the attachments.
// FinCom does not file on the MCA portal (there is no MCA API): it prepares the figures and the attachments; the person
// files with DSC on the portal and types the SRN back in.
//
// One lazy chunk (Corporate-*.js, imported by Books.jsx): nothing of it is in the app's first file or in legacy.js. Its pages
// are books tabs for their addresses: books:corp (profile), corp-forms, corp-docs, corp-aoc4 (#/c/<client>/books/corp...).
// Shown for companies only (FS.entityOf: the PAN's fourth letter C, or Company chosen in Client setup).
import { useEffect } from "react";
import "./corp.css";
import PageTabs from "../../parts/PageTabs.jsx";
import Button from "../../parts/Button.jsx";

// the serif of the documents and headings, from Google Fonts, once, when the page first opens (Georgia meanwhile)
function useSerif() {
  useEffect(() => {
    if (document.getElementById("corp-serif")) return;
    const l = document.createElement("link");
    l.id = "corp-serif"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400;1,8..60,600&display=swap";
    document.head.appendChild(l);
  }, []);
}

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

function Soon({ page, what }) {
  return <div className="corp-card corp-empty" data-corp-page={page}>{what}</div>;
}

export default function Corporate() {
  useSerif();
  const co = CO();
  if (!co) return null;
  if (!isCompany(co)) return <div className="corp"><NotCompany co={co} /></div>;
  const page = pageOf(booksTab()), tab = page === "aoc4" ? "forms" : page;
  return <div className="corp" data-corp="">
    <PageTabs label="Corporate" attr="data-corp-tab" value={tab} onPick={(k) => goCorp(k)}
      tabs={[["profile", "Company profile"], ["forms", "e-Forms"], ["docs", "Resolutions & minutes"]]} />
    {page === "forms" ? <Soon page="forms" what="e-Forms: the annual and event-based forms of this company." />
      : page === "docs" ? <Soon page="docs" what="Resolutions & minutes: board resolutions, notices and minutes." />
      : <Soon page="profile" what={"Company profile of " + co.name + "."} />}
  </div>;
}
