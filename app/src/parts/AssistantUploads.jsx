// FinCom Assistant: the files of one Upload (app/src/parts/asst-upload.js keeps them, AUpload), shown in the panel
import Button from "./Button.jsx";

// one Upload (the owner's request of 14-Oct-2026): each file as FinCom found it - its kind (by FinCom's own rules, or by
// the AI when they could not tell), one line about it, and the next steps as buttons (nothing is done by itself)
const DONE_OPENS = ["purchase", "sales", "bank", "as26"];
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

