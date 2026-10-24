// Today: what needs doing, across every client. Was viewToday() in src/js/18.
// One set of count words everywhere (clean-up batch 1, 11-Oct-2026): To read · To review · Ready to post · Needs you, the
// same on Today, Clients, a client's Overview and the review table's status.
import ListTable from "../parts/ListTable.jsx";
import { DueLine } from "../parts/DueList.jsx";
import { AutoToday } from "../parts/AutoPost.jsx";
import { MeetToday } from "../calls/MeetLine.jsx";

// 24-Oct-2026 (next-tally-one-page): the clients not linked to Tally, as one small chip that opens the Tally page's list
// (where a company is added or linked: the one place); no names or links here
function NotLinkedLine() {
  const n = sortedCompanies().filter((c) => typeof tallyLinkOf === "function" && tallyLinkOf(c).state === "unlinked").length;
  if (!n) return null;
  return <div className="due-line due-quiet" data-not-linked-line={n}>
    <button type="button" className="tag tchip warn" data-not-linked-go="" onClick={() => { S.tallyFocus = ""; S.tallyGuide = {}; navHome("tally"); }}>{"◐ " + n + (n === 1 ? " client not linked to Tally" : " clients not linked to Tally")}</button>
  </div>;
}
import { Inbox, ReceiptText, Send, TriangleAlert } from "lucide-react";
import { FirstRunTally } from "../parts/TallyFirstRun.jsx";
const openAt = (cid, step) => openCompany(cid).then(() => goStep(step, "bills"));
const initials = (name) => String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// a figure in Arc's metric-card look, with its own accent and icon (arc-ui step 3; styles/arc-shell.css)
function Metric({ label, n, warn, onClick, tone, Icon }) {
  return <button className={"metric" + (warn && n ? " warn" : "")} data-tone={tone} onClick={onClick}><span>{label}</span><b>{n}</b>
    {Icon && <i className="dtile-chip" aria-hidden="true"><Icon width={16} height={16} strokeWidth={2} /></i>}</button>;
}

export default function Today() {
  const cos = sortedCompanies();
  const rows = cos.map((c) => {
    const s = c.stats || {};
    return { c, read: docqCount(c.id), review: s.drafts || 0, post: s.waiting || 0, look: (s.dups || 0) + (s.check || 0) };
  }).sort((a, b) => (b.read + b.review + b.post + b.look) - (a.read + a.review + a.post + a.look));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const cell = (r, key, step) => r[key]
    ? <button className="linkbtn tcell" onClick={() => openAt(r.c.id, step)}>{r[key]}</button>
    : <span className="muted">—</span>;
  return (
    <section className="today">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: "0 0 12px" }}>What needs doing</h2>
        <button className="btn small" onClick={() => doAct("addCo")}>Add client</button>
      </div>
      <div className="metrics">
        <Metric label="To read" n={inboxTotal()} onClick={() => navHome("inbox")} tone="violet" Icon={Inbox} />
        <Metric label="To review" n={sum("review")} tone="amber" Icon={ReceiptText} />
        <Metric label="Ready to post" n={sum("post")} tone="indigo" Icon={Send} />
        <Metric label="Needs you" n={sum("look")} warn tone="rose" Icon={TriangleAlert} />
      </div>
      <AutoToday />
      <MeetToday />
      {!rows.length ? <><p className="note lt-empty" data-list-empty="">No clients yet. Use <button className="linkbtn" onClick={() => navHome("clients")}>Add your first client</button> to start.</p><FirstRunTally /></> : <>
        {/* the one list table (spec K6) */}
        <ListTable name="today" className="data" rows={rows} rowKey={(r) => r.c.id} unit={["client", "clients"]}
          cols={[
            { k: "name", role: "party", label: "Client", v: (r) => r.c.name, cell: (r) => <><span className="today-co" data-initials={initials(r.c.name)}><button className="linkbtn" onClick={() => openAt(r.c.id, "review")}><b>{r.c.name}</b></button></span>{r.c.gstin && <> <span className="note">{r.c.gstin}</span></>}</> },
            { k: "read", label: "To read", cls: "n", v: (r) => r.read, sum: true, fmt: String, cell: (r) => cell(r, "read", "collect") },
            { k: "review", label: "To review", cls: "n", v: (r) => r.review, sum: true, fmt: String, cell: (r) => cell(r, "review", "review") },
            { k: "post", label: "Ready to post", cls: "n", v: (r) => r.post, sum: true, fmt: String, cell: (r) => cell(r, "post", "post") },
            { k: "look", label: "Needs you", cls: "n", v: (r) => r.look, sum: true, fmt: String, cell: (r) => cell(r, "look", "review") },
          ]} />
        <p className="note" style={{ marginTop: 8 }}>Counts cover clients opened on this computer; open a client to bring its figures up to date.</p>
        {/* round 46: the returns due are on the Compliance page; Today keeps one line */}
        <DueLine />
        <NotLinkedLine />
      </>}
    </section>
  );
}
