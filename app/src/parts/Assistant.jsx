// FinCom Assistant's panel (src/js/75-assistant.js keeps its state, S.asst, and does what its buttons do): Arc's Drawer from
// the right on every page, for the open client or the whole firm. The answer first, with what it rests on:
//   green  "Checked against the books ✓"            a book tool's figures (the table under the answer)
//   amber  "AI answer, not checked against the books" the AI read the Day Book; the entries it cited, checked
//   blue   "General guidance — verify before relying" the law, with the web pages used
// A figure the AI stated that the books give differently is shown as FinCom's, with the AI's struck out. Under the
// answer: the tables (amounts right-aligned, dates opening the entry), Copy, Export to Excel, files, drafts, a notice's
// fields with "Add to due list", and "Wrong answer?". Earlier questions of the session below. Ctrl+J opens it anywhere.
import { lazy, Suspense, useRef, useState } from "react";
import { Drawer, DrawerContent } from "@/registry/components/drawer/drawer";
import { Sparkles, Paperclip, Upload as UploadIcon, Copy, FileSpreadsheet, ThumbsDown, Download, ExternalLink, Send, Save, History, Plus } from "lucide-react";
import Button from "./Button.jsx";
import { PreFileList } from "./PreFile.jsx";
// the one label map for a result's fields (server/_shared/assistant-labels.js), fetched as its own small file so the
// app's first file stays within its budget (tests/run_stability.py); until it is in, a key is put in words
let LAB = null;
import("../../../server/_shared/assistant-labels.js").then((m) => { LAB = m; }).catch(() => {});
const fieldLabel = (k) => (LAB ? LAB.fieldLabel(k) : String(k).replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase());
const fieldKind = (k) => (LAB ? LAB.fieldKind(k) : "amount");
import "./assistant.css";

const LABELS = {
  books: ["ok", "Checked against the books ✓"],
  ai: ["warn", "AI answer, not checked against the books"],
  general: ["info", "General guidance — verify before relying"],
  notice: ["neutral", "Notice"],
};
const money = (v) => (v == null || v === "" ? "" : INR.format(r2(num(v))));
const isNum = (t) => t === "amount" || t === "int" || t === "pct";
const dmy = (v) => ASST.dmy(v);

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
  const text = t.done ? t.text : t.live;
  const blocks = String(text || "").split(/\n{2,}/);
  return <div className="asst-words" data-asst-words="">{blocks.map((b, i) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ""), i + "-" + j + "-")}</li>)}</ul>;
    if (/^#{1,3}\s+/.test(b)) return <p key={i}><b>{b.replace(/^#{1,3}\s+/, "")}</b></p>;
    return <p key={i}>{lines.map((l, j) => <span key={j}>{j ? <br /> : null}{inline(l, i + "-" + j + "-")}</span>)}</p>;
  })}</div>;
}

// a book tool's table: amounts right-aligned, a date opening its entry
function Table({ r, t }) {
  const cols = (r.columns || []).filter((c) => c.k !== "guid");
  const rows = r.rows || [];
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 25);
  const sum = r.summary && typeof r.summary === "object" ? Object.entries(r.summary).filter(([, x]) => typeof x === "number") : [];
  return <section className="asst-card green" data-asst-result={r.tool}>
    <header>
      <span className="asst-src ok">Checked against the books ✓</span>
      <b>{r.title || r.tool}</b>
      {r.period && <span className="note">{dmy(r.period.from)} to {dmy(r.period.to)}</span>}
      {r.asOn && <span className="note">on {dmy(r.asOn)}</span>}
      <button className="iconbtn" title="Export this table to Excel" onClick={() => ASST.excel(t, r)}><FileSpreadsheet size={15} /></button>
    </header>
    {r.none ? <p className="note">{r.why}</p> : rows.length === 0 ? <p className="note">Nothing in the books for this.</p> :
      <div className="asst-tablewrap"><table className="asst-table">
        <thead><tr>{cols.map((c) => <th key={c.k} className={isNum(c.t) ? "n" : ""}>{c.label}</th>)}</tr></thead>
        <tbody>{shown.map((row, i) => <tr key={i} className={row.guid || row.vno ? "rowlink" : ""}>
          {cols.map((c) => <td key={c.k} className={isNum(c.t) ? "n" : ""}>
            {c.t === "date" && row[c.k] && (row.guid || row.vno) && (c.k === "day" || c.k === "date") ? <button className="linkbtn" title="Open the entry" onClick={() => ASST.openEntry(row, r.client || t.cid)}>{dmy(row[c.k])}</button>
              : c.t === "date" ? dmy(row[c.k]) : c.t === "amount" ? money(row[c.k]) : c.t === "pct" ? (row[c.k] == null ? "" : row[c.k] + "%") : row[c.k] == null ? "" : String(row[c.k])}
          </td>)}
        </tr>)}</tbody>
      </table></div>}
    {rows.length > 25 && <button className="linkbtn" onClick={() => setAll(!all)}>{all ? "Show the first 25" : "Show all " + rows.length}</button>}
    {(r.count != null && r.shown != null && r.count > r.shown) && <p className="note">{r.shown} of {r.count} shown; the Excel export has them all.</p>}
    {sum.length > 0 && <p className="asst-sum">{sum.slice(0, 6).map(([k, x]) => <span key={k} data-asst-sum-field={k}>{fieldLabel(k)}: <b>{fieldKind(k) === "count" ? x : fieldKind(k) === "pct" ? x + "%" : "₹" + money(x)}</b></span>)}</p>}
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

function Turn({ t, latest }) {
  const [rep, setRep] = useState(null);
  const verdicts = (t.verdicts || []).filter((v) => v.status === "mismatch");
  const amber = (t.labels || []).includes("ai");
  return <article className={"asst-turn" + (latest ? " latest" : "")} data-asst-turn={t.id}>
    <p className="asst-q">{t.q}{t.attach && <span className="note"> · {t.attach.name}</span>}</p>
    {!t.done && <div className="asst-progress" data-asst-busy="">{(t.tools || []).slice(-3).map((x, i) => <span key={i}>{x.label}…</span>)}{!(t.tools || []).length && <span>Thinking…</span>}</div>}
    {t.done && (t.labels || []).length > 0 && <div className="asst-labels">{t.labels.map((l) => <span key={l} className={"asst-src " + LABELS[l][0]} data-asst-label={l}>{LABELS[l][1]}</span>)}</div>}
    {t.cached && <p className="note asst-cached" data-asst-cached="">Answered from earlier today on the same books: no AI cost.</p>}
    {t.warn && <p className="asst-error warn80" data-asst-warn="">{t.warn.message}</p>}
    {(t.live || t.text) && <Words t={t} />}
    {(t.cases || []).length > 0 && <Cases t={t} />}
    {t.error && <p className={"asst-error" + (t.error.kind === "cap" ? " cap" : "")} data-asst-error={t.error.kind}>{t.error.message}</p>}
    {verdicts.length > 0 && <div className="asst-fixes" data-asst-fixes="">{verdicts.map((x) => <p key={x.id}>AI said <s>{x.text || "₹" + money(x.ai)}</s>, FinCom's books say <b>₹{money(x.fincom)}</b> ({x.name}). FinCom's figure is used.</p>)}</div>}
    {(t.verdicts || []).some((v) => v.status === "match") && <p className="note asst-matched">{t.verdicts.filter((v) => v.status === "match").length} figure{t.verdicts.filter((v) => v.status === "match").length === 1 ? "" : "s"} recomputed from the books: ✓ matches FinCom.</p>}
    {amber && <div className="asst-cites" data-asst-cites="">
      <p className="note">Entries the AI used{(t.slices || []).length ? " (from " + t.slices.map((s) => s.count + " entr" + (s.count === 1 ? "y" : "ies")).join(", ") + " of the Day Book)" : ""}:</p>
      {((t.citations || {}).ok || []).length ? t.citations.ok.map((c, i) => <button key={i} className="chip" onClick={() => ASST.openEntry({ vno: c.no, day: c.date }, t.cid)}>No. {c.no} · {dmy(c.date)}</button>) : <span className="note">none cited</span>}
      {((t.citations || {}).dropped || []).length > 0 && <p className="asst-dropped" data-asst-dropped="">Removed: {t.citations.dropped.map((c) => "No. " + c.no + " of " + dmy(c.date)).join(", ")} - not in the entries the AI read.</p>}
    </div>}
    {t.done && (t.unchecked || []).length > 0 && <p className="note asst-unchecked">Not checked against the books: {t.unchecked.map((u) => u.text).join(", ")}.</p>}
    {(t.links || []).length > 0 && <div className="asst-links"><p className="note">Sources:</p>{t.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.title || l.url} <ExternalLink size={12} /></a>)}</div>}
    {(t.screens || []).map((s) => <div key={s.screen} className="asst-card screen" data-asst-screen={s.screen}><p>{s.why || "The assistant only reads, works out, drafts and exports."}</p><Button className="btn small" onClick={() => ASST.screen(s.screen)}>Open {s.label}</Button></div>)}
    {t.notice && <Notice t={t} />}
    {t.prefile && <section className="asst-card green" data-asst-prefile="">
      <header><span className="asst-src ok">FinCom's own checks ✓</span><b>Check before filing: {t.prefileRes ? PreFile.title(t.prefileRes) : t.prefile.form}</b>
        {t.prefileRes && <button className="iconbtn" onClick={() => { S.prefile = { open: true, res: t.prefileRes }; ASST.close(); render(); }}>Open the checklist</button>}</header>
      {t.prefileRes ? <PreFileList res={t.prefileRes} compact /> : <p className="note">{t.prefileErr || "Running…"}</p>}
    </section>}
    {(t.results || []).map((r) => <Table key={r.id} r={r} t={t} />)}
    {(t.drafts || []).map((d) => <section key={d.id} className="asst-card draft" data-asst-draft="">
      <header><span className="asst-src warn">DRAFT - for the CA to review</span><b>{d.title}</b>
        <button className="iconbtn" title="Word" onClick={() => asstDraftFile(d, "doc")}>Word</button><button className="iconbtn" title="PDF" onClick={() => asstDraftFile(d, "pdf")}>PDF</button></header>
      <pre>{d.body}</pre></section>)}
    {(t.files || []).map((f) => <div key={f.id} className={"asst-file" + (f.pack ? " pack" : "")} data-asst-file={f.kind}><Download size={14} /><button className="linkbtn" onClick={() => ASST.download(f)}>{f.pack ? "Download reply pack" : f.name}</button>{f.pack && <span className="note"> ({(f.contents || []).length} files: the reply in Word and PDF, the annexures, the index)</span>}
      <span className="note">{f.kind.toUpperCase()} · kept until {f.expires ? dmy(String(f.expires).slice(0, 10)) : "30 days"}</span></div>)}
    {t.done && !t.error && <footer className="asst-actions">
      <button className="iconbtn" onClick={() => ASST.copy(t)} title="Copy the answer and its tables"><Copy size={14} /> Copy</button>
      {(t.results || []).some((r) => (r.rows || []).length) && <button className="iconbtn" onClick={() => ASST.excel(t)} title="Export the tables to Excel"><FileSpreadsheet size={14} /> Export to Excel</button>}
      {t.reported ? <span className="note">Reported. Thank you.</span> : rep == null ? <button className="iconbtn" data-asst-wrong="" onClick={() => setRep("")} title="Tell the firm's owner and FinCom's developers"><ThumbsDown size={14} /> Wrong answer?</button>
        : <span className="asst-rep"><input value={rep} maxLength={300} placeholder="What is wrong? (optional, one line)" onChange={(e) => setRep(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ASST.report(t, rep); }} /><Button className="btn small" onClick={() => ASST.report(t, rep)}>Send</Button></span>}
    </footer>}
  </article>;
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

export function AssistantLauncher() {
  const a = ASST.st();
  if (!S.firm || a.open || typeof Cloud !== "object" || !Cloud.on()) return null;
  if (a.settings === undefined && !a.settingsBusy) setTimeout(() => ASST.loadSettings(), 0);
  if (!ASST.on()) return null;
  const co = S.view === "company" && CO();
  // a long client name is cut with an ellipsis (assistant.css); the whole name is in the tooltip (the owner's report of 14-Oct-2026)
  const words = co ? "Ask about " + co.name : "Ask FinCom";
  return <button className="asst-launch" data-asst-launch="" onClick={() => ASST.open()} title={words + " · FinCom Assistant (Ctrl+J)"} aria-label={words}><Sparkles size={16} /> <span className="asst-launch-txt">{words}</span></button>;
}

export default function Assistant() {
  const a = ASST.st();
  const file = useRef(null);
  const co = S.view === "company" ? CO() : null;
  const cid = ASST.cid();
  const turns = ASST.turns();
  const latest = turns[turns.length - 1], earlier = turns.slice(0, -1).reverse();
  const suggest = cid ? ASST.SUGGEST.client : ASST.SUGGEST.firm;
  return <>
    <AssistantLauncher />
    <Drawer open={!!a.open} onOpenChange={(o) => { if (!o) ASST.close(); }} modal={false}>
      <DrawerContent className="asst-panel" title="FinCom Assistant" closeLabel="Close" aria-describedby={undefined} onInteractOutside={(ev) => ev.preventDefault()}>
        {a.open && <div className={"asst-body" + (a.dragOver ? " drag" : "")} data-asst-panel=""
          onDragOver={(e) => { if (!cid) return; e.preventDefault(); if (!a.dragOver) { a.dragOver = true; ASST.draw(); } }}
          onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; a.dragOver = false; ASST.draw(); }}
          onDrop={(e) => { if (!cid) return; e.preventDefault(); a.dragOver = false; ASST.upload(Array.from(e.dataTransfer.files || [])); }}>
          {a.dragOver && <div className="asst-dropzone" data-asst-dropzone="">Drop the files to upload them for {co ? co.name : "this client"}</div>}
          <div className="asst-scope">
            {co ? <div className="seg" role="tablist">
              <button role="tab" aria-selected={a.scope === "client"} className={a.scope === "client" ? "on" : ""} onClick={() => ASST.setScope("client")}>{co.name}</button>
              <button role="tab" aria-selected={a.scope !== "client"} className={a.scope !== "client" ? "on" : ""} onClick={() => ASST.setScope("firm")}>Whole firm</button>
            </div> : <span className="note">Whole firm · open a client to ask about its books</span>}
            <span className="asst-tools">
              <button className="iconbtn" title="New conversation" onClick={() => ASST.newChat()}><Plus size={15} /></button>
              <button className="iconbtn" title="Saved conversations" onClick={() => (a.saved ? (a.saved = null, ASST.draw()) : ASST.listSaved())}><History size={15} /></button>
              <button className="iconbtn" title="Save this conversation" onClick={() => ASST.save()}><Save size={15} /></button>
            </span>
          </div>
          {a.saved && <div className="asst-saved">{a.saved.length ? a.saved.map((s) => <button key={s.id} className="linkbtn" onClick={() => ASST.loadSaved(s.id)}>{s.title} <span className="note">{dmy(String(s.updated_at).slice(0, 10))}</span></button>) : <p className="note">No saved conversations{cid ? " for this client" : ""} yet.</p>}</div>}
          {!a.noticeOk && !ASST.noticeSeen() && <div className="asst-first-notice" data-asst-first-notice="" role="note">
            <p><b>Before you start:</b> Questions may be processed by an AI provider; identifiers are masked. PANs, GSTINs, TANs, Aadhaar and phone numbers, and the names of parties you do not name, are replaced by tokens before anything leaves FinCom. It reads, works out, drafts and exports; it never posts, files or changes anything.</p>
            <Button className="btn small" onClick={() => ASST.noticeOk()}>Got it</Button></div>}
          <form className="asst-ask" onSubmit={(e) => { e.preventDefault(); ASST.ask(); }}>
            <textarea id="asstQ" rows={2} value={a.q} placeholder={cid ? "Ask about " + co.name + "'s books, tax, or a notice…" : "Ask a tax or accounting question…"} disabled={a.busy}
              onChange={(e) => { a.q = e.target.value; ASST.draw(); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ASST.ask(); } }} />
            <div className="asst-askbar">
              {cid && <><input ref={file} type="file" multiple accept={AUpload.ACCEPT} hidden data-asst-upload-input="" onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; ASST.upload(fs); }} />
                <button type="button" className="iconbtn" data-asst-upload-btn="" title="Upload files: a notice, bills, a bank statement, 26AS or AIS, a register, a certificate format or any other document (PDF, picture, Excel, CSV, Word). Or drop them on the panel." onClick={() => file.current && file.current.click()} disabled={a.uploading}><UploadIcon size={15} /> {a.uploading ? "Reading…" : "Upload"}</button>
                {a.attach && <span className="note asst-attached" data-asst-attached=""><Paperclip size={13} /> {a.attach.name} <button type="button" className="linkbtn" title="Do not attach" onClick={() => { a.attach = null; ASST.draw(); }}>×</button></span>}</>}
              <span className="note asst-hint" data-asst-privacy="">Questions may be processed by an AI provider; identifiers are masked. It reads, works out, drafts and exports; it never posts, files or changes anything.</span>
              <Button type="submit" className="btn small primary" disabled={a.busy || !String(a.q || "").trim()}><Send size={14} /> Ask</Button>
            </div>
          </form>
          {AUpload.list().length > 0 && <Suspense fallback={null}><Uploads /></Suspense>}
          {!turns.length && <div className="asst-suggest" data-asst-suggest="">{suggest.map((s) => <button key={s} className="chip" onClick={() => ASST.ask(s)}>{s}</button>)}</div>}
          {latest && <Turn t={latest} latest />}
          {earlier.length > 0 && <details className="asst-earlier" open={earlier.length < 3}><summary>Earlier in this conversation ({earlier.length})</summary>{earlier.map((t) => <Turn key={t.id} t={t} />)}</details>}
        </div>}
      </DrawerContent>
    </Drawer>
  </>;
}
