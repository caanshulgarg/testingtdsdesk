// FinCom Assistant's panel (src/js/75-assistant.js keeps its state, S.asst, and does what its buttons do): Arc's Drawer from
// the right on every page, for the open client or the whole firm. The answer first, with what it rests on:
//   green  "Checked against the books ✓"            a book tool's figures (the table under the answer)
//   amber  "AI answer, not checked against the books" the AI read the Day Book; the entries it cited, checked
//   blue   "General guidance — verify before relying" the law, with the web pages used
// A figure the AI stated that the books give differently is shown as FinCom's, with the AI's struck out. Under the
// answer: the tables (amounts right-aligned, dates opening the entry), Copy, Export to Excel, files, drafts, a notice's
// fields with "Add to due list", and "Wrong answer?". Earlier questions of the session below. Ctrl+J opens it anywhere.
import { useRef, useState } from "react";
import { Drawer, DrawerContent } from "@/registry/components/drawer/drawer";
import { Sparkles, Paperclip, Copy, FileSpreadsheet, ThumbsDown, Download, ExternalLink, Send, Save, History, Plus } from "lucide-react";
import Button from "./Button.jsx";
import { PreFileList } from "./PreFile.jsx";
import "./assistant.css";
import { useDismiss } from "./dismiss.js";

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
    {sum.length > 0 && <p className="asst-sum">{sum.slice(0, 6).map(([k, x]) => <span key={k}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}: <b>{/count|parties|entries|months|suppliers|deductees|overdue|late|withR1|differ|sameBill|near|ledgersConfirmed|msmeSuppliers/i.test(k) ? x : "₹" + money(x)}</b></span>)}</p>}
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
  if (a.settings === undefined) { a.settings = null; setTimeout(() => ASST.loadSettings(), 0); }
  if (!ASST.on()) return null;
  const co = S.view === "company" && CO();
  return <button className="asst-launch" data-asst-launch="" onClick={() => ASST.open()} title="FinCom Assistant (Ctrl+J)"><Sparkles size={16} /> {co ? "Ask about " + co.name : "Ask FinCom"}</button>;
}

const ASST_REF = { get current() { return document.querySelector('[data-overlay="asst"]'); } };
export default function Assistant() {
  const a = ASST.st();
  // a click outside or Esc closes it (app/src/parts/dismiss.js); what was typed stays in ASST's state as a draft
  useDismiss(!!a.open, ASST_REF, () => ASST.close(), { also: () => Array.from(document.querySelectorAll("[data-asst-launch]")) });
  const file = useRef(null);
  const co = S.view === "company" ? CO() : null;
  const cid = ASST.cid();
  const turns = ASST.turns();
  const latest = turns[turns.length - 1], earlier = turns.slice(0, -1).reverse();
  const suggest = cid ? ASST.SUGGEST.client : ASST.SUGGEST.firm;
  return <>
    <AssistantLauncher />
    <Drawer open={!!a.open} onOpenChange={(o) => { if (!o) ASST.close(); }} modal={false}>
      <DrawerContent className="asst-panel" data-overlay="asst" title="FinCom Assistant" closeLabel="Close" aria-describedby={undefined} onInteractOutside={(ev) => ev.preventDefault()} onEscapeKeyDown={(ev) => ev.preventDefault()}>
        {a.open && <div className="asst-body" data-asst-panel="">
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
          <form className="asst-ask" onSubmit={(e) => { e.preventDefault(); ASST.ask(); }}>
            <textarea id="asstQ" rows={2} value={a.q} placeholder={cid ? "Ask about " + co.name + "'s books, tax, or a notice…" : "Ask a tax or accounting question…"} disabled={a.busy}
              onChange={(e) => { a.q = e.target.value; ASST.draw(); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ASST.ask(); } }} />
            <div className="asst-askbar">
              {cid && <><input ref={file} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; ASST.attach(f); }} />
                <button type="button" className="iconbtn" title="Attach a notice (PDF or picture)" onClick={() => file.current && file.current.click()} disabled={a.uploading}><Paperclip size={15} /> {a.uploading ? "Storing…" : a.attach ? a.attach.name : "Notice"}</button></>}
              <span className="note asst-hint" data-asst-privacy="">Questions may be processed by an AI provider; identifiers are masked. It reads, works out, drafts and exports; it never posts, files or changes anything.</span>
              <Button type="submit" className="btn small primary" disabled={a.busy || !String(a.q || "").trim()}><Send size={14} /> Ask</Button>
            </div>
          </form>
          {!turns.length && <div className="asst-suggest" data-asst-suggest="">{suggest.map((s) => <button key={s} className="chip" onClick={() => ASST.ask(s)}>{s}</button>)}</div>}
          {latest && <Turn t={latest} latest />}
          {earlier.length > 0 && <details className="asst-earlier" open={earlier.length < 3}><summary>Earlier in this conversation ({earlier.length})</summary>{earlier.map((t) => <Turn key={t.id} t={t} />)}</details>}
        </div>}
      </DrawerContent>
    </Drawer>
  </>;
}

// Settings › Assistant (the firm's owner): today's use and the daily limit, the last 30 days, the questions asked, and the
// mismatches (AI figures the books gave differently, answers marked wrong) with their status
export function AssistantSettings() {
  const a = ASST.st();
  const [cap, setCap] = useState(""), [rate, setRate] = useState("");
  if (a.usage === undefined) { a.usage = null; setTimeout(() => ASST.loadUsage(), 0); }
  const u = a.usage, m = a.mismatches;
  const ST = { new: "New", cause_found: "Cause found", fix_waiting: "Fix waiting for your OK", fixed: "Fixed" };
  return <section className="asst-settings" data-asst-settings="">
    <h3>FinCom Assistant</h3>
    <AssistantSwitch />
    {!u ? <p className="note">Loading…</p> : u.error ? <p className="note">{u.error}</p> : <>
      <p data-asst-spend="">Today: <b>₹{money(u.spent_inr)}</b> of <b>₹{money(u.cap_inr)}</b> for AI answers{u.warn ? <b className="asst-warn-txt"> · {u.over ? "the limit is reached: new AI answers wait for midnight" : "80% used"}</b> : null}.
        <span className="note"> At ₹{u.rate} to the dollar. Answers from FinCom's own tools, answers given earlier on the same books and the checks before filing cost nothing and keep working at the limit.</span></p>
      {u.owner && <p className="asst-cap"><label>Daily limit ₹ <input type="number" min="0" max="1000000" value={cap} placeholder={String(u.cap_inr)} onChange={(e) => setCap(e.target.value)} /></label>
        <label> ₹ to a dollar <input type="number" min="1" max="1000" step="0.01" value={rate} placeholder={String(u.rate)} onChange={(e) => setRate(e.target.value)} /></label>
        <Button className="btn small" onClick={() => (cap !== "" || rate !== "") && ASST.setCap(cap, rate)}>Set</Button></p>}
      {u.owner && (u.features || []).length > 0 && <table className="asst-table" data-asst-features=""><thead><tr><th>What uses the money (30 days)</th><th className="n">Questions</th><th className="n">AI calls</th><th className="n">₹</th></tr></thead>
        <tbody>{u.features.map((f) => <tr key={f.feature}><td>{{ book: "Book questions", routing: "Routing (Haiku)", general: "Tax questions", file: "Files", notice: "Notices", heavy: "Audit and reports", prefile: "Checks before filing", cache: "Answered from earlier" }[f.feature] || f.feature}</td>
          <td className="n">{f.questions}</td><td className="n">{f.calls}</td><td className="n">{money(f.inr)}</td></tr>)}</tbody></table>}
      {u.owner && (u.months || []).length > 0 && <table className="asst-table" data-asst-months=""><thead><tr><th>Month</th><th className="n">AI calls</th><th className="n">₹</th></tr></thead>
        <tbody>{u.months.map((d) => <tr key={d.month}><td>{d.month}</td><td className="n">{d.calls}</td><td className="n">{money(d.inr)}</td></tr>)}</tbody></table>}
      {u.owner && (u.days || []).length > 0 && <details><summary>By day</summary><table className="asst-table"><thead><tr><th>Day</th><th className="n">AI calls</th><th className="n">Tokens in</th><th className="n">Cache read</th><th className="n">Tokens out</th><th className="n">₹</th></tr></thead>
        <tbody>{u.days.slice(0, 31).map((d) => <tr key={d.day}><td>{dmy(d.day)}</td><td className="n">{d.calls}</td><td className="n">{INR.format(d.in)}</td><td className="n">{INR.format(d.cache_read || 0)}</td><td className="n">{INR.format(d.out)}</td><td className="n">{money(d.inr)}</td></tr>)}</tbody></table></details>}
      {u.owner && <details><summary>Questions asked ({(u.questions || []).length})</summary><table className="asst-table"><thead><tr><th>When</th><th>Who</th><th>Question</th><th>Answered by</th><th>Tools</th><th className="n">₹</th></tr></thead>
        <tbody>{(u.questions || []).slice(0, 100).map((q, i) => <tr key={i}><td>{String(q.at).slice(0, 16).replace("T", " ")}</td><td>{q.by}</td><td>{q.q}</td><td>{{ keyword: "FinCom (no AI)", haiku: "Haiku routing", "sonnet-route": "Sonnet routing", model: "AI", cache: "earlier answer" }[q.route] || q.route}</td><td>{(q.tools || []).join(", ")}</td><td className="n">{money(q.inr)}</td></tr>)}</tbody></table></details>}
      {u.owner && (u.fell_through || []).length > 0 && <details data-asst-fell=""><summary>Questions no fixed question fitted ({u.fell_through.length}): candidates for new ones</summary><ul>{u.fell_through.map((x, i) => <li key={i}>{x.q} <span className="note">×{x.n}</span></li>)}</ul></details>}
      <p className="note">Case search uses free public sources (Indian Kanoon, the Supreme Court, High Courts, ITAT, CESTAT, GSTAT, CBIC and CBDT). Taxmann, SCC Online and Manupatra need subscriptions and are not used.</p>
    </>}
    {u && u.owner && <div className="asst-mismatches" data-asst-mismatches="">
      <h4>Mismatches {m && m.counts ? <span className="note">({m.counts.new} new · {m.counts.cause_found} cause found · {m.counts.fix_waiting} fix waiting for your OK · {m.counts.fixed} fixed)</span> : null}</h4>
      <p className="note">A figure the AI stated that FinCom's books give differently (FinCom's figure was used), or an answer someone marked wrong. FinCom never changes the books to make them agree; the developers find the cause and ask your OK before a fix.</p>
      {m && m.rows && m.rows.length ? <table className="asst-table"><thead><tr><th>When</th><th>Client</th><th>Question</th><th>Figure</th><th className="n">AI</th><th className="n">FinCom</th><th>Status</th></tr></thead>
        <tbody>{m.rows.map((x) => <tr key={x.id} data-mismatch={x.status}><td>{String(x.at).slice(0, 10)}</td><td>{(S.companies[x.client] || {}).name || x.client || "firm"}</td><td>{x.question}{x.note ? <div className="note">“{x.note}”</div> : null}</td>
          <td>{x.kind === "user_report" ? "reported wrong" : x.figure}</td><td className="n">{x.ai == null ? "" : money(x.ai)}</td><td className="n">{x.fincom == null ? "" : money(x.fincom)}</td>
          <td>{ST[x.status] || x.status}{x.last && x.last.note ? <div className="note">{x.last.note}{x.last.release ? " · " + x.last.release : ""}</div> : null}</td></tr>)}</tbody></table> : <p className="note">None.</p>}
    </div>}
  </section>;
}

// the firm's switch and the clients' consent (the owner): both on before anything goes to the AI provider
function AssistantSwitch() {
  const a = ASST.st();
  if (a.settings === undefined || a.settings === null) { if (a.settings === undefined) { a.settings = null; setTimeout(() => ASST.loadSettings(), 0); } return <p className="note">Loading…</p>; }
  const st = a.settings || {};
  return <div className="asst-switch" data-asst-switch="">
    <label className="chk"><input type="checkbox" checked={!!st.enabled} disabled={!st.owner} onChange={(e) => ASST.setSettings(e.target.checked, st.consent)} /> <b>FinCom Assistant on for the firm</b>
      <span className="note"> · the chat panel on every page (Ctrl+J). Off by default. "Check before filing" works either way: it is FinCom's own checks, no AI.</span></label>
    <label className="chk"><input type="checkbox" checked={!!st.consent} disabled={!st.owner} onChange={(e) => ASST.setSettings(st.enabled, e.target.checked)} /> <b>Clients' consent to AI processing</b>
      <span className="note"> · the firm has its clients' consent for their questions and books to be processed by an AI provider (Anthropic's Claude). Before anything is sent, PANs, GSTINs, TANs, Aadhaar and phone numbers, and the names of parties the question does not name, are replaced by tokens; FinCom puts the real values back. Only what the question needs is sent.</span></label>
    {!st.owner && <p className="note">Only the firm's owner changes these.</p>}
  </div>;
}
