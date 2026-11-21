// A question's states (next-assistant, phase 1 design): Draft -> Asked -> Answered -> Closed, each step kept with who or
// what moved it and when (client_asks.history, docs/ASSISTANT-PHASE1.md). A question closes by itself when the document
// comes into the Inbox or the entry appears in the books; a person can close it too, with a word why. A closed or
// answered question is never asked again (acceptance rule 4).
import { ArrowLeft, CircleDot, Send, MessageSquareReply, CircleCheck } from "lucide-react";
import { FINDINGS, CLIENTS, STATE_WORD, STATE_TAG } from "./demo.js";

const ICON = { draft: CircleDot, asked: Send, answered: MessageSquareReply, closed: CircleCheck };
const when = (s) => { const d = new Date(s); return isNaN(d) ? s : d.getDate() + "-" + d.toLocaleString("en-GB", { month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };

export function AskHistory({ ask, compact }) {
  const h = ask.history || [];
  return <ol className={"as-hist" + (compact ? " compact" : "")} aria-label="What happened">{(compact ? h.slice(-1) : h).map((x, i) => <li key={i}><time>{when(x.at)}</time> {x.what}</li>)}</ol>;
}

const STEPS = [
  ["draft", "Made by the night check. Waits for you: tick, edit, send."],
  ["asked", "Sent by email, or opened in WhatsApp by you. Waits for the client."],
  ["answered", "The client replied. You read it and close it, or ask again."],
  ["closed", "Done: the document or entry came, or you closed it. Never asked again."],
];

export default function AskStates({ back }) {
  const sample = ["draft", "asked", "answered", "closed"].map((s) => FINDINGS.find((f) => f.ask && f.ask.state === s));
  return <section className="as-page as-states" data-ask-states="">
    <button type="button" className="linkbtn as-back" onClick={back}><ArrowLeft width={15} height={15} aria-hidden="true" /> Assistant</button>
    <h2>How a question moves</h2>
    <ol className="as-flow" aria-label="The four states">{STEPS.map(([s, w], i) => { const I = ICON[s]; return <li key={s} data-step={s}>
      <span className={"as-flow-dot " + s}><I width={16} height={16} aria-hidden="true" /></span><b>{STATE_WORD[s]}</b><span className="note">{w}</span>{i < 3 && <i className="as-flow-line" aria-hidden="true" />}</li>; })}</ol>
    <div className="as-state-cards">{sample.map((f) => f && <article key={f.ask.id} className="dash-card as-state-card" data-state={f.ask.state}>
      <div className="as-state-h"><span className={"tag " + STATE_TAG[f.ask.state]}>{STATE_WORD[f.ask.state]}</span><span className="note">{(CLIENTS.find((c) => c.id === f.cid) || {}).name}</span></div>
      <p className="as-q">{f.ask.text}</p>
      {f.ask.answer && <p className="as-answer"><span className="note">Reply</span> “{f.ask.answer}”</p>}
      <AskHistory ask={f.ask} />
      <div className="as-state-acts">
        {f.ask.state === "draft" && <><button type="button" className="btn small primary">Tick to send</button><button type="button" className="btn small">Edit</button><button type="button" className="btn small">Not needed</button></>}
        {f.ask.state === "asked" && <><button type="button" className="btn small">Type the reply</button><button type="button" className="btn small">Close</button></>}
        {f.ask.state === "answered" && <><button type="button" className="btn small primary">Close</button><button type="button" className="btn small">Ask again</button></>}
        {f.ask.state === "closed" && <button type="button" className="btn small">Open again</button>}
      </div>
    </article>)}</div>
  </section>;
}
