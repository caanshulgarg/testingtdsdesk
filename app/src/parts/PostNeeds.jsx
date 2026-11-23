// Entries not in Tally that need a person, first on the page (the owner, 23-Nov-2026: "If tally has not posted entry then
// user action should be treated on priority with the warning message"): on Home (every client, a count per client) and at
// the head of a client's pages (that client), in the classic and the new look alike, never behind a tab. Each line says
// what happened and the one thing to do (the Post page's own words, lib/postNeeds.js), with a button that opens it on
// Post to Tally. Nothing is kept: a line goes by itself once its entries are in Tally. Its own file (a lazy chunk).
import { useEffect, useState } from "react";
import "./postNeeds.css";
import { postNeedClients, needSentence } from "../lib/postNeeds.js";

// Home's Needs you figure counts these entries too (screens/Today.jsx reads it through window)
if (typeof window === "object") { window.__postNeedsN = () => { try { return postNeedClients().reduce((a, c) => a + c.n, 0); } catch (e) { return 0; } }; if (typeof render === "function") setTimeout(render, 0); }

function go(x) {
  const open = () => { S.postTabs = S.postTabs || {}; S.postTabs[x.cid] = x.tab; goStep("post", "bills"); };
  if (S.view === "company" && S.coId === x.cid) return open();
  return Promise.resolve(openCompany(x.cid)).then(open);
}
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

export default function PostNeeds({ cid }) {
  const [, tick] = useState(0);
  // a posting starts to need someone after 10 minutes of waiting with nothing changed: drawn again each minute
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  // the postings of FinCom's cloud, read once here if no page read them yet (Live keeps them current afterwards)
  useEffect(() => { try { if (typeof CloudJobs === "object" && !CloudJobs.list && typeof TCloud === "object" && TCloud.on()) CloudJobs.load(); } catch (e) { /* none */ } }, []);
  let cs = [];
  try { cs = postNeedClients(); } catch (e) { cs = []; }
  if (cid) cs = cs.filter((c) => c.cid === cid);
  if (!cs.length) return null;
  const total = cs.reduce((a, c) => a + c.n, 0);
  return <div className="pn-box" role="alert" data-post-needs={cid ? "client" : "home"}>
    <b className="pn-head">{"Needs you: " + plural(total, "entry", "entries") + " not in Tally" + (cid ? "" : " · " + plural(cs.length, "client", "clients"))}</b>
    {cs.map((c) => <div key={c.cid} className="pn-co" data-post-needs-client={c.cid}>
      {!cid && <div className="pn-name"><b>{c.client}</b> <span className="pn-n">{plural(c.n, "entry", "entries")}</span></div>}
      {c.lines.map((x) => <div key={x.key + x.kind} className={"pn-line pn-r" + x.rank} data-post-needs-line={x.key.split(":")[0]}>
        <span>{needSentence(x)}</span>
        <button type="button" className="btn small" data-post-needs-go={x.cid} onClick={() => go(x)}>{x.label}</button>
      </div>)}
    </div>)}
  </div>;
}
