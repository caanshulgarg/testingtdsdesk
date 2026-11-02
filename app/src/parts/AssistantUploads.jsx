// FinCom Assistant: the files of the earlier Upload (sessions before 02-Nov-2026), shown in the thread, and the next steps for
// the files sent with a question (FileActs, under its answer). app/src/parts/asst-upload.js keeps them (AUpload)
import Button from "./Button.jsx";

// one Upload (the owner's request of 14-Oct-2026): each file as FinCom found it - its kind (by FinCom's own rules, or by
// the AI when they could not tell), one line about it, and the next steps as buttons (nothing is done by itself)
const DONE_OPENS = ["purchase", "sales", "bank", "as26"];   // (an import opens its own page)
export default function Uploads() {
  const list = AUpload.list();
  if (!list.length) return null;
  return <section className="asst-uploads" data-asst-uploads="">
    {list.slice().reverse().map((u) => <div key={u.id} className={"asst-up " + u.state} data-asst-upfile={u.kind || u.state} data-name={u.name}>
      <header><b>{u.name}</b>
        {u.state === "ready" && <span className="asst-src neutral" data-asst-kind={u.kind}>{AUpload.KIND[u.kind] || "Other document"}</span>}
        {u.state === "ready" && <span className="note" data-asst-kind-by={u.by}>{u.by === "ai" ? "told by the AI" : "told by FinCom's rules"}</span>}
        {u.state === "reading" && <span className="note">Reading…</span>}
        {u.state === "asking" && <span className="note">FinCom's rules could not tell; asking the AI…</span>}
        <button type="button" className="iconbtn asst-up-x" title="Take off this list (the file stays stored)" onClick={() => AUpload.remove(u)}>×</button></header>
      {u.state === "failed" && <p className="asst-error">Not uploaded: {u.error}.</p>}
      {u.state === "ready" && <p className="asst-up-sum" data-asst-summary="">{u.summary}</p>}
      {u.state === "ready" && <div className="asst-up-acts">
        {u.acts.map((x) => u.done[x.id] ? <span key={x.id} className="note asst-up-done" data-asst-done={x.id}>✓ {u.done[x.id]}</span>
          : <Button key={x.id} className={"btn small" + (x.primary ? " primary" : "")} disabled={!!x.disabled} data-asst-act={x.id} onClick={() => AUpload.act(u, x.id)}>{x.label}</Button>)}
        {DONE_OPENS.some((k) => u.done[k]) && <Button className="btn small" data-asst-act="open" onClick={() => AUpload.act(u, "open")}>Open</Button>}
      </div>}
    </div>)}
  </section>;
}


// the files sent with a question (the owner, 31-Oct-2026: attached like Claude's): what FinCom found each to be and its next
// steps as buttons under the answer (Add to Purchase / Bank / Sales for review, Import, Use for a certificate …); nothing
// is done by itself. Asking about a file is the question itself now, so "Ask about it" and "Read the notice" are not here.
export function FileActs({ t }) {
  const list = (t.filesIn || []).filter((u) => (u.acts || []).some((x) => x.id !== "ask" && x.id !== "notice"));
  if (!list.length) return null;
  return <section className="asst-fileacts" data-asst-fileacts="">
    {list.map((u) => <div key={u.id || u.path} className="asst-fileact" data-name={u.name} data-asst-upfile={u.kind}>
      <p className="note"><b>{u.name}</b>: {u.summary || AUpload.KIND[u.kind] || "Other document"}</p>
      <div className="asst-up-acts">
        {u.acts.filter((x) => x.id !== "ask" && x.id !== "notice").map((x) => u.done[x.id] ? <span key={x.id} className="note asst-up-done" data-asst-done={x.id}>✓ {u.done[x.id]}</span>
          : <Button key={x.id} className={"btn small" + (x.primary ? " primary" : "")} disabled={!!x.disabled} data-asst-act={x.id} onClick={() => AUpload.act(u, x.id)}>{x.label}</Button>)}
        {DONE_OPENS.some((k) => u.done[k]) && <Button className="btn small" data-asst-act="open" onClick={() => AUpload.act(u, "open")}>Open</Button>}
      </div>
    </div>)}
  </section>;
}
