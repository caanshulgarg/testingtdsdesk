// The upload pages' shared pattern (upload-pages, 14-Oct-2026; the owner: "UI to upload bills, bank, sales is very wrong..
// it should be proper"). Purchase, Bank and Sales each show, under the page's title (whose one primary button is the
// page's Upload, top right):
//   1. StateBar: one row of states in the same words on every page (STATE_WORDS, src/js/02: To review · Ready to post ·
//      In Tally · Duplicates · Deleted; Errors, No entry and Ignored only while they have rows), one count each, from
//      the one function of the page (billStates / bankStates / salesStates), which counts the rows its table lists. The
//      guide to the page is a small "?" at the end of the row (it was "? How this tab works" at the top);
//   2. UploadLine (Purchase): the upload going on, inline ("Reading 3 of 5…"), each file the reader could not read as a
//      row with its reason and Retry, and when it is over one line ("Last upload 10:42 · 3 bills read") with the details
//      behind it;
//   3. the table of the state chosen, with the one filter bar; an empty state with one next step (EmptyNext).
import { Tabs } from "@/registry/components/tabs/tabs";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import tabs from "@/registry/components/tabs/tabs.module.css";
import HelpButton from "./HelpButton.jsx";
import Button from "./Button.jsx";
import { FinComNav } from "../nav.js";

// the old step of each state, kept on the tab (data-step) for the pages that look for a step
const STEP = { review: "review", ready: "post", intally: "done" };
// Purchase: Ready to post, Errors and In Tally are Post to Tally's three lists (data-post-tab, as its tabs were)
const POST = { ready: "topost", errors: "errors", intally: "posted" };

export function StateBar() {
  const page = typeof uploadPage === "function" ? uploadPage() : "";
  if (!page) return null;
  const states = pageStates(page);
  // Bank and Sales with nothing yet: the page is its empty state ("No bank statement yet"), with its one next step, and no
  // row of noughts; Purchase keeps its row (To review's empty state is under it)
  const help = <span className="statebar-help"><HelpButton page small /></span>;
  if (!states.length || (page !== "bills" && states.every(([, , n]) => !n))) return <div className="sbar-band"><nav className="sbar statebar" aria-label="Status" data-states={page} data-states-none="">{help}</nav></div>;
  const now = pageState(page), bills = page === "bills";
  return <div className="sbar-band"><nav className="sbar statebar" aria-label="Status" data-states={page} data-post-tabs={bills ? "" : undefined} data-bill-filters={bills ? "" : undefined}>
    <Tabs value={now || ""} onValueChange={() => {}} activationMode="manual"><TabsPrimitive.List aria-label="Status" className={tabs.list}>
      {states.map(([id, words, n]) => <TabsPrimitive.Trigger key={id} value={id} className={tabs.trigger + (id === "errors" ? " st-errors" : "")} data-state={id}
        data-step={STEP[id]} data-post-tab={bills ? POST[id] : undefined} onClick={() => FinComNav.go(() => goState(id, page))}>
        {words} <span className={"sbar-n" + (id === "errors" ? " attn" : "")} data-state-n="" data-step-n={STEP[id] ? "" : undefined} data-tab-n={bills && POST[id] ? "" : undefined}>{n}</span>
      </TabsPrimitive.Trigger>)}
    </TabsPrimitive.List></Tabs>
    {help}
  </nav></div>;
}

// an empty list's one next step: "No bills to review · Upload bills"
export function EmptyNext({ what, act, label, note }) {
  return <div className="empty-next" data-list-empty="" data-empty-next="">
    <b>{what}</b>{note && <span className="note">{note}</span>}
    {act && <Button className="btn small" data-empty-act="" onClick={act}>{label}</Button>}
  </div>;
}

const UP_WORD = { ok: "read", dup: "duplicate", bad: "not read", info: "sales" };
const UP_CLS = { ok: "ok", dup: "warn", bad: "bad", info: "" };
function openUploaded(l) {
  if (!l.open) return;
  const e = D().entries[l.open];
  if (!e) { toast("That bill is not on this computer yet."); return; }
  S.tab = "invoices"; S.filter = e.status; S.selected = l.open; S.reviewTable = false; render(); window.scrollTo(0, 0);
}

// Purchase: the upload going on, the files not read, and the last upload in one line
export function UploadLine() {
  if (typeof uploadPage !== "function" || uploadPage() !== "bills") return null;
  const p = uploadProgress(), last = S.lastUpload && S.lastUpload[S.coId];
  const failed = p.failed;
  if (!p.busy && !failed.length && !(last && last.lines.length)) return null;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return <section className="upline" data-upload-line="" aria-live="polite">
    {p.busy > 0 && <div className="upline-row" data-upload-busy="">
      <span className="spinner" aria-hidden="true" />
      <b data-upload-progress="">{"Reading " + Math.min(p.total, p.done + 1) + " of " + p.total + "…"}</b>
      {p.now && <span className="note">{p.now.name}</span>}
      <span className="upline-bar" aria-hidden="true"><i style={{ width: pct + "%" }} /></span>
    </div>}
    {failed.length > 0 && <ul className="upline-fails" data-upload-failed="">
      {failed.map((j) => <li key={j.id} data-failed-file={j.name}>
        <span className="tag bad">not read</span> <b>{j.name}</b> <span className="note" data-failed-why="">{j.msg || "no reason given"}</span>
        <span className="upline-acts">
          <Button className="btn small" data-retry-read="" onClick={() => jobAction("retry", j.id)}>Retry</Button>
          <button type="button" className="linkbtn" onClick={() => jobAction("type", j.id)}>Type it in</button>
        </span>
      </li>)}
    </ul>}
    {/* open when something did not go in as read (a duplicate, a file not read): the answer first */}
    {!p.busy && last && last.lines.length > 0 && <details className="upline-last" data-upload-result="" open={last.lines.some((l) => l.kind !== "ok")}>
      <summary><span data-upload-last="">{"Last upload " + fmtTime(last.at) + " · " + last.text}</span></summary>
      <ul>{last.lines.map((l, i) => <li key={i}><span className={"tag " + UP_CLS[l.kind]}>{UP_WORD[l.kind]}</span>{" " + l.name + ": " + l.text}
        {l.open && <>{" · "}<button type="button" className="linkbtn" onClick={() => openUploaded(l)}>open it</button></>}</li>)}</ul>
      <button type="button" className="linkbtn" onClick={() => { delete S.lastUpload[S.coId]; S.jobs = (S.jobs || []).filter((j) => !(j.cid === S.coId || j.target === S.coId) || ["waiting", "checking", "reading"].includes(j.status)); render(); }}>Clear</button>
    </details>}
  </section>;
}
