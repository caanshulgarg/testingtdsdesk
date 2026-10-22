// FinCom Assistant's panel (src/js/75-assistant.js keeps its state, S.asst, and does what its buttons do): Arc's Drawer from
// the right on every page, for the open client or the whole firm. The answer first, with what it rests on:
//   green  "Checked against the books ✓"            a book tool's figures (the table under the answer)
//   amber  "AI answer, not checked against the books" the AI read the Day Book; the entries it cited, checked
//   blue   "General guidance — verify before relying" the law, with the web pages used
//   grey   "No entries in FinCom for this client yet"  a book tool found no books in the cloud (with the Tally card)
//   grey   "Not found in the books"                    a ledger name that is not one ledger ("Which one?", buttons)
// A figure the AI stated that the books give differently is shown as FinCom's, with the AI's struck out. Under the
// answer: the tables (amounts right-aligned, dates opening the entry), Copy, Export to Excel, files, drafts, a notice's
// fields with "Add to due list", and "Wrong answer?". Earlier questions of the session below. Ctrl+J opens it anywhere.
import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { Drawer, DrawerContent } from "@/registry/components/drawer/drawer";
import { Sparkles, Paperclip, Copy, FileSpreadsheet, ThumbsDown, Download, ExternalLink, Send, Save, History, Plus, Info, ChevronDown, User } from "lucide-react";
import Button from "./Button.jsx";
import { PreFileList } from "./PreFile.jsx";
import "./assistant.css";
import "./asst-upload.js";   // AUpload: the panel's Upload (window.AUpload, ASST.upload)
import { useDismiss } from "./dismiss.js";
import { AssistantLauncher } from "./AssistantLauncher.jsx";
import { VoiceInput, SpeakButton, stopVoice } from "./AssistantVoice.jsx";

// what an answer rests on, said once in a small grey "Source:" line at the end of the reply (the owner, 14-Oct-2026: a plain
// chat, no coloured labels); the line opens the detail (the entries the AI used, the web pages, the figures recomputed)
const LABELS = {
  books: ["ok", "FinCom's books"],
  ai: ["warn", "AI, from the Day Book entries (not checked against the books)"],
  general: ["info", "general guidance, verify before relying"],
  notice: ["neutral", "the notice"],
  // a book tool found no books for the client in the cloud: never "FinCom's books"
  nodata: ["neutral", "no entries in FinCom for this client yet"],
  // a ledger name that is not one ledger: "Which one?" or the closest names, as buttons
  notfound: ["neutral", "not found in the books"],
  // certificates: neutral; each row's "From" says where its figure came from
  confirm: ["neutral", "Figures for the certificate – please confirm"],
  certificate: ["neutral", "Certificate figures – source in each row"],
  // a file made from the user's own sheet (server/assistant/filetable.ts): the cells copied from it, not the books
  file: ["neutral", "your file – figures as in it, not checked against the books"],
  // entries drafted from the person's words (the owner, 22-Oct-2026): a preview to correct, posted only by their click
  entries: ["warn", "entries drafted by AI from your words – check before posting"],
};
const money = (v) => (v == null || v === "" ? "" : INR.format(r2(num(v))));
const isNum = (t) => t === "amount" || t === "int" || t === "pct";
const dmy = (v) => ASST.dmy(v);
// when a question was asked, in Indian time: "14:05 IST" today, "14-Oct-2026 14:05 IST" on another day (a saved chat)
const when = (at) => {
  try { return typeof istDay === "function" && istDay(at) !== istDay(Date.now()) ? fmtDateTime(at) : fmtTime(at); } catch (e) { return ""; }
};

// the answer's words: paragraphs, "- " lists, **bold**; ⟦F<n>⟧ a checked figure; [V:<no>|<date>] an entry cited
function Words({ t }) {
  const v = Object.fromEntries((t.verdicts || []).map((x) => [String(x.id), x]));
  const ok = Object.fromEntries(((t.citations || {}).ok || []).map((c) => [c.no + "|" + c.date, c]));
  const inline = (s, k) => {
    const parts = String(s).split(/(⟦F\d+⟧|\[V:[^|\]]+\|\d{4}-\d{2}-\d{2}\]|\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => {
      let m = p.match(/^⟦F(\d+)⟧$/);
      if (m) {
        const x = v[m[1]]; if (!x) return null;
        return x.status === "mismatch"
          ? <span key={k + i} className="asst-fig fix" title={"AI said " + x.text + "; FinCom's books say ₹" + money(x.fincom)}><b>₹{money(x.fincom)}</b> <s>{x.text}</s></span>
          : <span key={k + i} className="asst-fig ok" title="matches FinCom's books">{x.text} <span className="asst-tick">✓ matches FinCom</span></span>;
      }
      m = p.match(/^\[V:([^|\]]+)\|(\d{4}-\d{2}-\d{2})\]$/);
      if (m) { const c = ok[m[1] + "|" + m[2]]; return <button key={k + i} className="linkbtn asst-cite" onClick={() => ASST.openEntry({ vno: m[1], day: m[2] }, t.cid)}>{"No. " + m[1] + ", " + dmy(m[2])}</button>; }
      m = p.match(/^\*\*([^*]+)\*\*$/);
      if (m) return <b key={k + i}>{m[1]}</b>;
      return p;
    });
  };
  const text = t.done ? t.text : steady(t.live);
  const blocks = String(text || "").split(/\n{2,}/);
  // while the reply streams in, one quiet marker at the very end of the words (never a block of its own, so nothing moves)
  const caret = (i) => !t.done && i === blocks.length - 1 ? <span className="asst-caret" aria-hidden="true" data-asst-caret=""><i /><i /><i /></span> : null;
  return <div className="asst-words" data-asst-words="">{blocks.map((b, i) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ""), i + "-" + j + "-")}{j === lines.length - 1 ? caret(i) : null}</li>)}</ul>;
    if (/^#{1,3}\s+/.test(b)) return <p key={i} className="asst-h"><b>{b.replace(/^#{1,3}\s+/, "")}</b>{caret(i)}</p>;
    return <p key={i}>{lines.map((l, j) => <span key={j}>{j ? <br /> : null}{inline(l, i + "-" + j + "-")}</span>)}{caret(i)}</p>;
  })}</div>;
}
// The owner, 15-Oct-2026: "the cursor is moving differently". While a reply streams in, its last few characters are often
// half of something: "**Tot" (bold not closed yet), "⟦F1" (a checked figure's mark), "[V:77|2026-0" (an entry cited), a
// "- " that will start a list line, a "#" that will be a heading. Drawn as they came, those showed for a moment as raw
// marks and then jumped to bold, a figure or a list, moving the words around them. Held back until whole, nothing jumps.
function steady(s) {
  let x = String(s || "");
  x = x.replace(/(⟦[^⟧]*|\[V:[^\]\n]*)$/, "");                    // a figure or an entry still coming
  if (((x.match(/\*\*/g) || []).length % 2) === 1) {                 // bold opened, not yet closed: the words, plain for now
    const k = x.lastIndexOf("**"); x = x.slice(0, k) + x.slice(k + 2);
  }
  x = x.replace(/\*$/, "");
  x = x.replace(/(^|\n)\s*([-•*]|\d+\.?|#{1,3})\s*$/, "$1");       // a list line or heading not begun yet
  return x.replace(/\s+$/, "");
}

// a book tool's table: amounts right-aligned, a date opening its entry
function Table({ r, t, many }) {
  const cols = (r.columns || []).filter((c) => c.k !== "guid");
  const rows = r.rows || [];
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 25);
  // the reply says what the table is and its totals (the owner, 14-Oct-2026: the reply once); the table carries no repeated
  // title or summary line, only a tool's own note (certificates: "please confirm") and, with several tables, each one's name
  const own = r.label && r.label !== "books" ? LABELS[r.label] : null;
  return <section className="asst-card" data-asst-result={r.tool} data-asst-table-label={r.label || "books"}>
    {(own || many) && <header>
      {own && <span className="asst-src">{own[1]}</span>}
      <b>{r.title || r.tool}</b>
      <button className="iconbtn asst-xl" title="Export this table to Excel" onClick={() => ASST.excel(t, r)}><FileSpreadsheet size={15} /></button>
    </header>}
    {r.none ? <p className="note">{r.why}</p> : rows.length === 0 ? <p className="note">Nothing in the books for this.</p> :
      <div className="asst-tablewrap"><table className="asst-table">
        <thead><tr>{cols.map((c) => <th key={c.k} className={isNum(c.t) ? "n" : ""}>{c.label}</th>)}</tr></thead>
        <tbody>{shown.map((row, i) => <tr key={i} className={row.guid || row.vno ? "rowlink" : ""}>
          {cols.map((c) => <td key={c.k} className={isNum(c.t) ? "n" : ""}>
            {c.t === "date" && row[c.k] && (row.guid || row.vno) && (c.k === "day" || c.k === "date") ? <button className="linkbtn" title="Open the entry" onClick={() => ASST.openEntry(row, r.client || t.cid)}>{dmy(row[c.k])}</button>
              : c.t === "date" ? dmy(row[c.k]) : c.t === "amount" ? money(row[c.k]) : c.t === "pct" ? (row[c.k] == null ? "" : row[c.k] + "%") : row[c.k] == null ? "" : String(row[c.k])}
            {own && c.k === "source" && row.books_check && <span className="asst-src asst-rowtick" data-asst-rowtick="" title="Worked out from the books"> ✓ books</span>}
          </td>)}
        </tr>)}</tbody>
      </table></div>}
    {rows.length > 25 && <button className="linkbtn" onClick={() => setAll(!all)}>{all ? "Show the first 25" : "Show all " + rows.length}</button>}
    {(r.count != null && r.shown != null && r.count > r.shown) && <p className="note">{r.shown} of {r.count} shown; the Excel export has them all.</p>}
    {r.basis && <p className="note asst-basis">{r.basis}</p>}
  </section>;
}

// a notice: what it is, the documents the department will expect (ready from FinCom / you must attach / not applicable,
// ticked as they are attached), the annexures FinCom made, the reply date (to the due list on a click) and the status
const ITEM = { ready: ["ok", "ready from FinCom"], attach: ["warn", "you must attach"], na: ["neutral", "not applicable"] };
function Notice({ t }) {
  const n = t.notice || {};
  const [ack, setAck] = useState("");
  const ref = [["Notice no.", n.notice_no], ["DIN / reference", n.din || n.reference], ["Date", n.notice_date ? dmy(n.notice_date) : ""], ["Section", n.section], ["Period", n.period || (n.months || []).join(", ") || n.fy], ["GSTIN / PAN", n.id_no]].filter(([, v]) => v);
  return <section className="asst-card notice" data-asst-notice="">
    <header><span className="asst-src neutral">Notice</span><b>{n.kindLabel || (n.form + " · " + n.law)}</b>
      <span className="note" data-asst-notice-status={t.noticeStatus || "received"}>{{ received: "Received", drafted: "Reply drafted", filed: "Filed" + (t.noticeAck ? " (" + t.noticeAck + ")" : "") }[t.noticeStatus || "received"]}</span></header>
    <p>{n.summary}</p>
    <dl>{ref.flatMap(([k, v]) => [<dt key={k}>{k}</dt>, <dd key={k + "v"}>{v}</dd>])}<dt>Amount</dt><dd>{n.amount == null ? "not stated" : "₹" + money(n.amount)}</dd><dt>Reply by</dt><dd>{n.reply_by ? dmy(n.reply_by) : "not stated"}</dd></dl>
    {(n.asked || []).length > 0 && <><p className="note">What is asked:</p><ul>{n.asked.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
    {(t.checklist || []).length > 0 && <div className="asst-checklist" data-asst-checklist="">
      <p className="note">Documents the department will expect:</p>
      <ul>{t.checklist.map((i) => <li key={i.id} data-item={i.id} data-status={i.status}>
        {i.status === "attach" ? <input type="checkbox" checked={!!i.done} disabled={!t.noticeId} title="Ticked when attached" onChange={(e) => ASST.tick(t, i.id, e.target.checked)} /> : <span className="asst-dot" />}
        <span className={"asst-src " + ITEM[i.status][0]}>{i.annex ? "Annexure " + i.annex : ITEM[i.status][1]}</span> <b>{i.name}</b> <span className="note">{i.why}{i.note ? " · " + i.note : ""}</span>
        {i.source && <a href={i.source} target="_blank" rel="noopener noreferrer"> source <ExternalLink size={11} /></a>}</li>)}</ul>
    </div>}
    <div className="asst-notice-acts">
      {n.reply_by && (t.taskAdded ? <span className="note">On the due list.</span> : <Button className="btn small" onClick={() => ASST.addTask(t)}>Add to due list</Button>)}
      {t.noticeId && t.noticeStatus !== "filed" && <span className="asst-filed"><input value={ack} placeholder="Acknowledgement no. of the reply filed" onChange={(e) => setAck(e.target.value)} />
        <Button className="btn small" onClick={() => ASST.noticeStatus(t, "filed", ack)}>Mark filed</Button></span>}
    </div>
    <p className="note">FinCom files nothing: file the reply on the portal yourself, then mark it filed here.</p>
  </section>;
}

// case law and circulars: each one checked on its page (the name and the line quoted), with its link; "Verify before filing"
function Cases({ t }) {
  const ok = t.cases.filter((c) => c.ok), bad = t.cases.filter((c) => !c.ok);
  return <section className="asst-card cases" data-asst-cases="">
    <header><span className="asst-src info">Verify before filing</span><b>Case law and circulars</b></header>
    {ok.map((c) => <div key={c.n} className="asst-case" data-case-ok="">
      <p><b>{c.case_name}</b> <span className="note">{[c.court, c.citation, c.date].filter(Boolean).join(" · ")}{(c.flags || []).length ? " · " + c.flags.join(", ").replace(/_/g, " ") : ""}{c.act ? " · " + c.act : ""}</span></p>
      <blockquote>“{c.quote}”</blockquote>
      <a href={c.url} target="_blank" rel="noopener noreferrer">{c.url} <ExternalLink size={11} /></a></div>)}
    {bad.length > 0 && <p className="note" data-case-dropped="">{bad.length === 1 ? "One citation was" : bad.length + " citations were"} dropped: not found on a page read for this answer. No verified case found for {bad.length === 1 ? "that point" : "those points"}.</p>}
    <p className="note">Case search uses free public sources (Indian Kanoon, the courts' and tribunals' sites, CBIC and CBDT).</p>
  </section>;
}

// one Upload (the owner's request of 14-Oct-2026): the files as FinCom found them, in their own small file
// (AssistantUploads.jsx), fetched when the panel first shows one, so the app's first file stays within its budget
const Uploads = lazy(() => import("./AssistantUploads.jsx"));
// entries drafted (draft_entries): the preview to correct, Post to Tally and Download XML, in their own file
const Entries = lazy(() => import("./AssistantEntries.jsx"));

function Turn({ t, latest }) {
  const [rep, setRep] = useState(null), [src, setSrc] = useState(false);
  const verdicts = (t.verdicts || []).filter((v) => v.status === "mismatch");
  const amber = (t.labels || []).includes("ai");
  // the working line: the step under way ("Making the file…"), shown while no words have come since it began; once the
  // words stream in, only the quiet marker at their end (Words). Below the words, so nothing above it moves when it goes.
  const step = (t.tools || []).slice(-1)[0];
  const working = !t.done && (!String(t.live || "").trim() || (step && t.toolAt === String(t.live || "").length));
  return <article className={"asst-turn" + (latest ? " latest" : "") + (t.done ? "" : " streaming")} data-asst-turn={t.id} aria-busy={!t.done}>
    <header className="asst-qhead" data-asst-qhead="">
      <span className="asst-who"><span className="asst-av" aria-hidden="true"><User size={12} strokeWidth={2.4} /></span><span>You</span>{t.at && <time dateTime={t.at} className="asst-time">{when(t.at)}</time>}</span>
      <p className="asst-q" data-asst-q="">{t.q}{t.attach && <span className="note"> · {t.attach.name}</span>}</p>
    </header>
    <div className="asst-a" data-asst-answer="">
    <div className="asst-who asst-fincom" aria-hidden="true"><span className="asst-mark"><Sparkles size={12} strokeWidth={2.4} /></span><span>FinCom</span></div>
    {t.cached && <p className="note asst-cached" data-asst-cached="">Answered from earlier today on the same books: no AI cost.</p>}
    {t.warn && <p className="asst-error warn80" data-asst-warn="">{t.warn.message}</p>}
    {(t.live || t.text) && <Words t={t} />}
    {working && <Thinking label={step ? String(step.label || "Working").replace(/[.…]+$/, "") : "Thinking"} />}
    {(t.cases || []).length > 0 && <Cases t={t} />}
    {t.error && <p className={"asst-error" + (t.error.kind === "cap" ? " cap" : "")} data-asst-error={t.error.kind}>{t.error.message}</p>}
    {verdicts.length > 0 && <div className="asst-fixes" data-asst-fixes="">{verdicts.map((x) => <p key={x.id}>AI said <s>{x.text || "₹" + money(x.ai)}</s>, FinCom's books say <b>₹{money(x.fincom)}</b> ({x.name}). FinCom's figure is used.</p>)}</div>}
    {(t.verdicts || []).some((v) => v.status === "match") && <p className="note asst-matched">{t.verdicts.filter((v) => v.status === "match").length} figure{t.verdicts.filter((v) => v.status === "match").length === 1 ? "" : "s"} recomputed from the books: ✓ matches FinCom.</p>}
    {t.choices && (t.choices.options || []).length > 0 && <div className="asst-card choices" data-asst-choices=""><p>{t.choices.prompt}</p>
      <div className="asst-choices">{t.choices.options.slice(0, 5).map((o) => <Button key={o.label} className="btn small" data-asst-choice={o.label} onClick={() => ASST.ask(o.q)}>{o.label}</Button>)}</div></div>}
    {(t.screens || []).map((s) => <div key={s.screen} className="asst-card screen" data-asst-screen={s.screen}><p>{s.why || "The assistant only reads, works out, drafts and exports."}</p><Button className="btn small" data-asst-screen-go={s.screen} onClick={() => ASST.screen(s.screen)}>{s.button || "Open " + s.label}</Button></div>)}
    {t.notice && <Notice t={t} />}
    {t.prefile && <section className="asst-card green" data-asst-prefile="">
      <header><span className="asst-src ok">FinCom's own checks ✓</span><b>Check before filing: {t.prefileRes ? PreFile.title(t.prefileRes) : t.prefile.form}</b>
        {t.prefileRes && <button className="iconbtn" onClick={() => { S.prefile = { open: true, res: t.prefileRes }; ASST.close(); render(); }}>Open the checklist</button>}</header>
      {t.prefileRes ? <PreFileList res={t.prefileRes} compact /> : <p className="note">{t.prefileErr || "Running…"}</p>}
    </section>}
    {(t.results || []).map((r) => r.kind === "entries" ? <Suspense key={r.id} fallback={<p className="note">Loading the entries…</p>}><Entries r={r} t={t} /></Suspense>
      : <Table key={r.id} r={r} t={t} many={(t.results || []).filter((x) => x.kind !== "entries").length > 1} />)}
    {(t.drafts || []).map((d) => <section key={d.id} className="asst-card draft" data-asst-draft="">
      <header><span className="asst-src warn">DRAFT - for the CA to review</span><b>{d.title}</b>
        <button className="iconbtn" title="Word" onClick={() => asstDraftFile(d, "doc")}>Word</button><button className="iconbtn" title="PDF" onClick={() => asstDraftFile(d, "pdf")}>PDF</button></header>
      <pre>{d.body}</pre></section>)}
    {(t.files || []).map((f) => <div key={f.id} className={"asst-file" + (f.pack ? " pack" : "")} data-asst-file={f.kind}><Download size={14} /><button className="linkbtn" onClick={() => ASST.download(f)}>{f.pack ? "Download reply pack" : f.name}</button>{f.pack && <span className="note"> ({(f.contents || []).length} files: the reply in Word and PDF, the annexures, the index)</span>}
      <span className="note">{f.kind.toUpperCase()} · kept until {f.expires ? dmy(String(f.expires).slice(0, 10)) : "30 days"}</span></div>)}
    {((t.citations || {}).dropped || []).length > 0 && <p className="asst-dropped" data-asst-dropped="">Removed: {t.citations.dropped.map((c) => "No. " + c.no + " of " + dmy(c.date)).join(", ")} - not in the entries the AI read.</p>}
    {t.done && <div className="asst-foot">
    {(t.labels || []).length > 0 && <p className="note asst-source" data-asst-source={(t.labels || []).join(" ")}>
      <button type="button" className="linkbtn" aria-expanded={src} onClick={() => setSrc(!src)}><Info size={13} aria-hidden="true" /><span>Source: {t.labels.map((l) => (LABELS[l] || [, l])[1]).join("; ")}</span><ChevronDown size={13} className="asst-chev" aria-hidden="true" /></button></p>}
    {src && <div className="asst-source-detail" data-asst-source-detail="">
      {amber && <div className="asst-cites" data-asst-cites="">
      <p className="note">Entries the AI used{(t.slices || []).length ? " (from " + t.slices.map((s) => s.count + " entr" + (s.count === 1 ? "y" : "ies")).join(", ") + " of the Day Book)" : ""}:</p>
        {((t.citations || {}).ok || []).length ? t.citations.ok.map((c, i) => <button key={i} className="chip" onClick={() => ASST.openEntry({ vno: c.no, day: c.date }, t.cid)}>No. {c.no} · {dmy(c.date)}</button>) : <span className="note">none cited</span>}
    </div>}
      {t.done && (t.unchecked || []).length > 0 && <p className="note asst-unchecked">Not checked against the books: {t.unchecked.map((u) => u.text).join(", ")}.</p>}
      {(t.links || []).length > 0 && <div className="asst-links"><p className="note">Sources:</p>{t.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.title || l.url} <ExternalLink size={12} /></a>)}</div>}
      {!amber && !(t.links || []).length && !(t.verdicts || []).length && !(t.unchecked || []).length && <p className="note">{(t.labels || []).includes("books") ? "The figures and the table are FinCom's own, worked out from the books held." : "No books were read for this reply."}</p>}
    </div>}
    {!t.error && <footer className="asst-actions">
      <button type="button" className="asst-act" onClick={() => ASST.copy(t)} title="Copy the answer and its tables"><Copy size={13} aria-hidden="true" /> Copy</button>
      {String(t.text || "").trim() && <SpeakButton text={t.text} />}
      {(t.results || []).some((r) => (r.rows || []).length) && <button type="button" className="asst-act" onClick={() => ASST.excel(t)} title="Export the tables to Excel"><FileSpreadsheet size={13} aria-hidden="true" /> Export</button>}
      {t.reported ? <span className="note">Reported. Thank you.</span> : rep == null ? <button type="button" className="asst-act" data-asst-wrong="" onClick={() => setRep("")} title="Tell the firm's owner and FinCom's developers"><ThumbsDown size={13} aria-hidden="true" /> Wrong answer?</button>
        : <span className="asst-rep"><input value={rep} maxLength={300} aria-label="What is wrong with this answer" placeholder="What is wrong? (optional, one line)" autoFocus onChange={(e) => setRep(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ASST.report(t, rep); }} /><Button className="btn small" onClick={() => ASST.report(t, rep)}>Send</Button></span>}
    </footer>}
    </div>}
    </div>
  </article>;
}

// The thinking loader (the owner, 19-Oct-2026: "loader while thinking should be there like Samsung or Claude"): FinCom's
// spark turning and breathing, the step under way in plain words ("Reading the TDS ledgers", from the stream) and three
// dots in a wave; until the first word, then gone. With reduced motion the spark and the dots stand still (assistant.css).
const SPARK = "M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z";
function Thinking({ label }) {
  return <p className="asst-status" role="status" data-asst-busy="">
    <span className="asst-think" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d={SPARK} /></svg></span>
    <span className="asst-think-txt">{label}</span><span className="asst-think-dots" aria-hidden="true"><i /><i /><i /></span>
  </p>;
}

// a draft as a Word document or a PDF (the browser's print), marked DRAFT and AI-drafted
function asstDraftFile(d, kind) {
  const lh = ASST.letterhead(), esc2 = (s) => esc(String(s || ""));
  const body = String(d.body || "").split("\n").map((l) => /^#\s+/.test(l) ? "<h3>" + esc2(l.replace(/^#\s+/, "")) + "</h3>" : "<p>" + esc2(l) + "</p>").join("");
  const html = "<h2>" + esc2(lh.name) + "</h2>" + lh.lines.map((l) => "<p class=\"note\">" + esc2(l) + "</p>").join("") + "<hr><p><b style=\"color:#B45309\">DRAFT - for the CA's review</b></p><h1>" + esc2(d.title) + "</h1>" + body +
    "<p class=\"note\" style=\"margin-top:18px\">AI-drafted text, review before use. Figures from FinCom's books as of " + esc2(new Date().toLocaleString("en-GB")) + ".</p>";
  if (kind === "pdf") { printView(d.title, "<style>@page{size:A4 portrait;margin:16mm}</style>" + html); return; }
  saveFile(String(d.title || "draft").replace(/[^A-Za-z0-9]+/g, "-") + ".doc", new Blob(["<html><head><meta charset=\"utf-8\"></head><body>" + html + "</body></html>"], { type: "application/msword" }));
}

// the launcher lives in the first file (AssistantLauncher.jsx); this panel is loaded the first time it opens (App.jsx)
export { AssistantLauncher };

const ASST_REF = { get current() { return document.querySelector('[data-overlay="asst"]'); } };
export default function Assistant() {
  const a = ASST.st();
  // a click outside or Esc closes it (app/src/parts/dismiss.js); what was typed stays in ASST's state as a draft
  useDismiss(!!a.open, ASST_REF, () => ASST.close(), { also: () => Array.from(document.querySelectorAll("[data-asst-launch]")) });
  const file = useRef(null), upl = useRef(null);
  const co = S.view === "company" ? CO() : null;
  const cid = ASST.cid();
  const turns = ASST.turns();
  const thread = useRef(null), box = useRef(null);
  // Where the conversation is scrolled (the owner, 15-Oct-2026: "questions vanish while answering", then "the cursor is
  // moving differently"). A question just asked goes to the top of the panel at once, and the newest exchange is given at
  // least the panel's height (--asst-view), so the reply streams in below it and nothing has to scroll while it does.
  // The panel used to be scrolled again at every piece of the reply (every 70 ms), so the words, the tables above and
  // anything the user had scrolled to kept moving under the cursor. Now it is scrolled only when a question is added,
  // the panel opens, the client changes, or a file is uploaded (to the end, where the files are listed).
  const ups = AUpload.list().length;
  const where = turns.length + ":" + ups + ":" + ASST.key();
  const scroller = () => { let el = thread.current; while (el && !(/auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement; return el; };
  useLayoutEffect(() => {
    // the drawer puts its content in the page a moment after it opens: until then, look again at the next frames
    let raf = 0, tries = 0, ro = null;
    const place = () => {
      const el = scroller();
      if (!el) { if (a.open && tries++ < 20) raf = requestAnimationFrame(place); return; }
      el.style.setProperty("--asst-view", el.clientHeight + "px");
      // the panel's height changes (the window, a phone's keyboard, the box growing): the newest exchange's height follows
      if (typeof ResizeObserver === "function") { ro = new ResizeObserver(() => el.style.setProperty("--asst-view", el.clientHeight + "px")); ro.observe(el); }
      const q = el.querySelector(".asst-turn.latest [data-asst-qhead]");
      if (!q || ups) { el.scrollTop = el.scrollHeight; return; }
      const qTop = q.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12;
      el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, Math.max(0, qTop));
    };
    place();
    return () => { cancelAnimationFrame(raf); if (ro) ro.disconnect(); };
  }, [where, a.open]);
  // the question box keeps the cursor: after Ask (Enter, the button, "Which one?") it stays in the box, so the next
  // question can be typed straight away (it was greyed out while FinCom answered, which threw the cursor out of it).
  // Voice typing stops first: a word heard after Ask never lands in the next question (AssistantVoice.jsx).
  const ask = (q) => { stopVoice(); ASST.ask(q); const b = box.current; if (b && document.activeElement !== b) b.focus({ preventScroll: true }); };
  return <>
    <Drawer open={!!a.open} onOpenChange={(o) => { if (!o) ASST.close(); }} modal={false}>
      <DrawerContent className="asst-panel" data-overlay="asst" title="FinCom Assistant" closeLabel="Close" aria-describedby={undefined} onInteractOutside={(ev) => ev.preventDefault()} onEscapeKeyDown={(ev) => ev.preventDefault()}>
        {a.open && <div className={"asst-body" + (a.dragOver ? " drag" : "")} data-asst-panel=""
          onDragOver={(e) => { e.preventDefault(); if (!a.dragOver) { a.dragOver = true; ASST.draw(); } }}
          onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; a.dragOver = false; ASST.draw(); }}
          onDrop={(e) => { e.preventDefault(); a.dragOver = false; ASST.upload(Array.from(e.dataTransfer.files || [])); }}>
          {a.dragOver && <div className="asst-dropzone" data-asst-dropzone="">Drop the files to upload them for {co ? co.name : "the whole firm"}</div>}
          <div className="asst-scope" data-asst-head="">
            {co ? <div className="seg" role="tablist" aria-label="What to ask about">
              <button role="tab" aria-selected={a.scope === "client"} className={a.scope === "client" ? "on" : ""} title={co.name} onClick={() => ASST.setScope("client")}>{co.name}</button>
              <button role="tab" aria-selected={a.scope !== "client"} className={a.scope !== "client" ? "on" : ""} onClick={() => ASST.setScope("firm")}>Whole firm</button>
            </div> : <span className="note asst-firmonly">Whole firm · open a client to ask about its books</span>}
            <span className="asst-tools">
              <button type="button" className="asst-tool" title="New conversation" aria-label="New conversation" onClick={() => ASST.newChat()}><Plus size={16} /></button>
              <button type="button" className="asst-tool" title="Saved conversations" aria-label="Saved conversations" aria-pressed={!!a.saved} onClick={() => (a.saved ? (a.saved = null, ASST.draw()) : ASST.listSaved())}><History size={16} /></button>
              <button type="button" className="asst-tool" title="Save this conversation" aria-label="Save this conversation" onClick={() => ASST.save()}><Save size={16} /></button>
            </span>
          </div>
          <div className="asst-scroll" data-asst-scroll="">
          {a.saved && <div className="asst-saved">{a.saved.length ? a.saved.map((s) => <button key={s.id} className="linkbtn" onClick={() => ASST.loadSaved(s.id)}>{s.title} <span className="note">{dmy(String(s.updated_at).slice(0, 10))}</span></button>) : <p className="note">No saved conversations{cid ? " for this client" : ""} yet.</p>}</div>}
          {!a.noticeOk && !ASST.noticeSeen() && <div className="asst-first-notice" data-asst-first-notice="" role="note">
            <p><b>Before you start:</b> Questions may be processed by an AI provider; identifiers are masked. PANs, GSTINs, TANs, Aadhaar and phone numbers, and the names of parties you do not name, are replaced by tokens before anything leaves FinCom. It reads, works out, drafts and exports; it never posts, files or changes anything.</p>
            <Button className="btn small" onClick={() => ASST.noticeOk()}>Got it</Button></div>}
          <div className={"asst-thread" + (ups ? " has-ups" : "")} data-asst-thread="" ref={thread}>
            {!turns.length && <div className="asst-empty">
              <span className="asst-mark big" aria-hidden="true"><Sparkles size={18} strokeWidth={2.2} /></span>
              <p className="asst-empty-t">{co && cid ? co.name : "Ask FinCom"}</p>
              <p className="note" data-asst-empty-line="">{cid ? "Ask about this client's books, TDS or GST" : "Ask a tax or accounting question, or about any client's books"}: type or speak, in English, Hindi, Hinglish or your own language.</p>
            </div>}
            {turns.map((t, i) => <Turn key={t.id} t={t} latest={i === turns.length - 1} />)}
            {AUpload.list().length > 0 && <Suspense fallback={null}><Uploads /></Suspense>}
          </div>
          </div>
          <form className="asst-ask" onSubmit={(e) => { e.preventDefault(); ask(); }}>
            {ASST.ups().length > 0 && <div className="asst-ups" data-asst-ups="">{ASST.ups().map((u) => <span key={u.path} className="chip"><Paperclip size={12} aria-hidden="true" /> {u.name} <button type="button" className="linkbtn" aria-label={"Take off " + u.name} onClick={() => ASST.unUpload(u.path)}>×</button></span>)}</div>}
            <label htmlFor="asstQ" className="sr-only">Your question</label>
            <textarea id="asstQ" ref={box} rows={1} value={a.q} placeholder={cid ? "Ask about " + co.name + "'s books, tax, or a notice…" : "Ask a tax or accounting question…"}
              aria-describedby="asstHint" onChange={(e) => { a.q = e.target.value; ASST.draw(); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); } }} />
            <div className="asst-askbar">
              {<><input ref={file} type="file" multiple accept={AUpload.ACCEPT} hidden data-asst-upload-input="" onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; ASST.upload(fs); }} />
                <button type="button" className="asst-act asst-upbtn" data-asst-upload-btn="" data-asst-upload="" title="Upload files: a notice, bills, a bank statement, 26AS or AIS, a register, a certificate format or any other document (PDF, picture, Excel, CSV, Word). Or drop them on the panel." onClick={() => file.current && file.current.click()} disabled={a.uploading} aria-label="Upload files"><Paperclip size={15} aria-hidden="true" /> {a.uploading ? "Reading…" : "Upload"}</button>
                {a.attach && <span className="note asst-attached" data-asst-attached=""><Paperclip size={13} /> {a.attach.name} <button type="button" className="linkbtn" title="Do not attach" onClick={() => { a.attach = null; ASST.draw(); }}>×</button></span>}</>}
              <VoiceInput a={a} client={ASST.cid()} onText={(s) => { a.q = s; ASST.draw(); }} />
              <span className="asst-hint" id="asstHint">{a.busy ? "FinCom is answering… you can type the next question" : <><kbd>Enter</kbd> to ask · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</>}</span>
              <Button type="submit" className="btn small primary asst-send" data-busy={a.busy ? "" : undefined} disabled={a.busy || !String(a.q || "").trim()} title={a.busy ? "FinCom is answering the last question" : !String(a.q || "").trim() ? "Type a question first" : "Ask (Enter)"}>
                {a.busy ? <span className="asst-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Ask</Button>
            </div>
          </form>
        </div>}
      </DrawerContent>
    </Drawer>
  </>;
}
