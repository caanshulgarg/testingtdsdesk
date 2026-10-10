// Link to Tally: one card for each client, the same wherever it shows (Client setup → Tally, From Tally, and where Add
// client, Getting ready and Post to Tally's "Choose the Tally company" lead). Round 39, 10-Oct-2026 (the owner could not
// tell whether a client is linked, when it will link, or whether he needs a port; none is needed to link).
//   One status line, one of four (tallyLinkOf, src/js/49):
//     Not linked          "Choose this client's company in Tally", then the companies FinCom has seen (name · computer ·
//                         last seen; the one with this client's GSTIN on top, "Same GSTIN"), each with [Link]. A company
//                         not in the list: "Open it in TallyPrime on the office computer; it appears here within a
//                         minute": the card reads the cloud again by itself while the client is not linked.
//     Waiting for Tally   "Linked to X. Open X in TallyPrime on <PC> to read new entries."
//     Linked and reading  "Linked to X on <PC> · last entry 10:42", with Update now.
//     Needs you           one line and one button: reading stopped, that day's Day Book, the starting point, held
//                         entries, Tally not answering or paused.
//   Then one tick, "Post this client's entries into X": the client's confirmed posting company (choiceConfirm postTo,
//   asked first). Nothing is posted without it; a company FinCom found by itself stays off until ticked.
//   More: Change company, Unlink, Name differs in Tally (the client's Tally name, which the bridge here matches by), Tally
//   page.
// Linking is a person's click: [Link] calls tally_company_link (TCloud.link, as Settings → Books in the cloud) and sets
// the client's Tally name to the company (tallyLinkClient). Nothing else is linked here, and nothing is sent to Tally.
import { useEffect, useState } from "react";
import { needDays } from "../screens/books/FromTally.jsx";
import Button from "./Button.jsx";
import CommitBox from "./CommitBox.jsx";

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const isOwner = () => !!(S.account && S.account.me && S.account.me.role === "owner");
const canWrite = () => (S.account && S.account.me ? ["owner", "staff"].includes(S.account.me.role) : true);
const sameName = (a, b) => !!a && !!b && ledNm(a).toLowerCase() === ledNm(b).toLowerCase();
// while the client is not linked, the cloud is read again this often (a computer reports a company within a minute)
const REFRESH_MS = 20000;

// the Tally companies FinCom's cloud has seen (tally_companies, as TLight and the Tally page read them), not linked to
// another client: {company, gstin, computer, at, open, same (this client's GSTIN), mine (linked to this client)}
function companiesSeen(co) {
  const tl = (typeof TLight === "object" && TLight.st) || {}, p = (typeof TCloud === "object" && TCloud.pane) || {};
  const devs = [].concat(tl.devs || [], p.devices || []).filter((d) => d && !d.revoked);
  const by = new Map();
  [].concat(tl.cos || [], p.companies || []).forEach((r) => {
    if (!r || !r.company) return;
    const k = ledNm(r.company).toLowerCase(), x = by.get(k) || { company: r.company, gstin: "", client: "", device: "", at: "" };
    by.set(k, Object.assign(x, { gstin: x.gstin || r.gstin || "", client: x.client || String(r.client_id || ""), device: x.device || r.device_id || "", at: [x.at, r.last_seen || ""].sort().pop() }));
  });
  const out = [];
  by.forEach((x) => {
    if (x.client && x.client !== String(co.id)) return;
    const d = x.device && devs.find((v) => v.id === x.device), info = (d && d.info) || {}, beat = info.beat || {};
    const open = [].concat(beat.open || []).concat(...Object.values(info.bridges || {}).map((b) => [].concat(b.open || []))).some((n) => sameName(n, x.company));
    const m = typeof gstinMatch === "function" ? gstinMatch(x) : null;
    out.push(Object.assign(x, { computer: d ? tallyPcLabel(d) : "", at: x.at || (d && (beat.at || d.last_seen)) || "", open, same: !!(m && m.id === co.id), mine: x.client === String(co.id) }));
  });
  return out.sort((a, b) => (b.same - a.same) || (sameName(b.company, co.tallyName) - sameName(a.company, co.tallyName)) || (b.open - a.open) || a.company.localeCompare(b.company));
}

// the list to choose from, each company with its own Link
function Picker({ co, current = "", onDone }) {
  const [busy, setBusy] = useState("");
  const cloud = typeof TCloud === "object" && TCloud.on();
  if (!cloud) return <p className="note" data-tally-link-signin="">Sign in to the firm account first: the link is kept in FinCom’s cloud, for every computer.</p>;
  const list = companiesSeen(co).filter((c) => !c.mine && !sameName(c.company, current));
  const devs = (typeof TLight === "object" && (TLight.st.devs || []).length) || (TCloud.pane.devices || []).length;
  const link = async (company) => { setBusy(company); const ok = await tallyLinkClient(company, co.id); setBusy(""); if (ok && onDone) onDone(); };
  const name = co.tallyName || "the client's company";
  return <div className="tlink-pick" data-tally-link-picker="">
    {list.length > 0 && <ul className="tlink-list">{list.map((c) => <li key={c.company} data-tally-link-option={c.company} data-same-gstin={c.same ? "" : undefined}>
      <span className="tlink-co"><b>{c.company}</b>{c.same && <span className="tag ok" data-tally-link-same="">Same GSTIN</span>}
        <span className="note">{[c.computer, c.open ? "open now" : c.at ? "last seen " + tallyHm(c.at) : ""].filter(Boolean).join(" · ")}</span></span>
      <Button className={"btn small" + (c.same ? " primary" : "")} data-tally-link-to={c.company} disabled={!!busy || !canWrite()} onClick={() => link(c.company)}>{busy === c.company ? "Linking…" : "Link"}</Button></li>)}</ul>}
    <p className="note" data-tally-link-hint="" style={{ margin: list.length ? "8px 0 0" : "6px 0 0" }}>
      {devs ? (list.length ? "Not in the list? " : "No company is waiting to be linked yet. ") + "Open " + name + " in TallyPrime on the office computer; it appears here within a minute."
        : <>FinCom Bridge is not on any computer yet. Install it on the computer where TallyPrime runs, then open {name} there. <button className="linkbtn" data-tally-link-install="" onClick={() => openTallyFor(co.id)}>How</button></>}
      {!canWrite() && " A member of the firm who may make changes links it."}</p>
  </div>;
}

// the one status line: the state's word, what it means, and at most one button
function StatusLine({ co, k, where, b }) {
  const l = k.line, x = k.company, pc = k.computer || "the office computer", owner = isOwner();
  const openTally = () => openTallyFor(co.id);
  let text = "", act = null;
  if (k.state === "unlinked") text = "Choose this client’s company in Tally";
  else if (k.state === "waiting") { text = "Linked to " + x + ". Open " + x + " in TallyPrime on " + pc + " to read new entries.";
    act = <button className="linkbtn" data-tally-link-open="" onClick={openTally}>Tally page</button>; }
  else if (k.state === "reading") { const last = lastEntry(co, k);
    text = "Linked to " + x + " on " + pc + " · last entry " + (last ? tallyHm(last) : "not received yet");
    act = <Button className="btn small" data-update-now="" onClick={() => tallyUpdateNow(co.id)}>{l && l.reading ? "Reading now…" : "Update now"}</Button>; }
  else { const n = needLine(co, k.needs[0], k, where, b, owner, openTally); text = n.text; act = n.act; }
  return <div className="tlink-line" data-tally-link-status={k.state}>
    <span className={"tag " + k.level} data-tally-link-state="">{k.word}</span>
    <span className="tlink-say" data-tally-link-text="">{text}</span>
    {act && <span className="tlink-act">{act}</span>}
  </div>;
}
// the last entry: Tally's change recorder on the company's computer (its heartbeat), else the bridge's last read
function lastEntry(co, k) {
  const tl = (typeof TLight === "object" && TLight.st) || {};
  const row = (tl.cos || []).find((c) => String(c.client_id || "") === String(co.id) && c.device_id), dev = row && (tl.devs || []).find((d) => d.id === row.device_id);
  let rec = ""; try { const rc = dev && typeof Rec === "object" && Rec.recOf ? Rec.recOf(dev) : null, y = rc && row.company ? rc[row.company] : null; rec = (y && y.lastAt) || ""; } catch (e) { rec = ""; }
  return [k.line && k.line.read, rec].filter(Boolean).sort().pop() || "";
}
// a need in words, with its one button
function needLine(co, n, k, where, b, owner, openTally) {
  const l = k.line || {};
  if (n.kind === "stopped") return { text: l.text,
    act: owner && l.stop ? <Button className="btn small primary" data-read-resume-line="" onClick={() => TCloud.readResume(l.stop.all ? null : { device: { id: l.stop.deviceId }, computer: l.stop.computer || l.computer })}>Resume</Button>
      : <span className="note">An owner of the firm can resume it.</span> };
  if (n.kind === "daybook") { const books = b || (S.books && S.books.cid === co.id ? S.books : null), days = needDays(books || {}, co.id), nd = days.reduce((a, x) => a + x.days, 0);
    const text = nd ? (nd === 1 ? "1 day needs its Day Book" : nd + " days need their Day Book") + (n.n ? " (" + plural(n.n, "entry", "entries") + " waiting)" : "")
      : n.n ? plural(n.n, "entry needs", "entries need") + " that day’s Day Book" : "Some days were not received from Tally: upload their Day Book";
    return { text, act: <Button className="btn small primary" data-tally-need-upload="" onClick={() => where === "books" && days.length ? tallyPickFor(tallyDate(days[0].from), tallyDate(days[0].to)) : goClient("books:import")}>Upload</Button> }; }
  if (n.kind === "baseline") return { text: "The starting point of " + k.company + " is not recorded yet: " + plural(n.n, "entry waits", "entries wait"),
    act: <Button className="btn small" data-tally-need-baseline="" onClick={openTally}>Open the Tally page</Button> };
  if (n.kind === "held") return { text: n.n === 1 ? "1 entry from Tally is held and needs a look" : n.n + " entries from Tally are held and need a look",
    act: <Button className="btn small" data-tally-need-held="" onClick={() => Rec.openActivity(co.id, "held")}>See them</Button> };
  if (n.kind === "paused") return { text: l.text + ". Resume it from the FinCom icon near the clock there.", act: <Button className="btn small" data-tally-link-open="" onClick={openTally}>Tally page</Button> };
  return { text: (l.text || "Tally is not answering") + ".", act: <Button className="btn small" data-tally-link-open="" onClick={openTally}>Tally page</Button> };
}

// the client's posting company, as one tick: on only when a person confirmed this company (choiceConfirm postTo)
function PostTick({ co, company }) {
  const pc = choiceGet(co, "postTo"), confirmed = !!(pc && pc.state === "confirmed"), here = sameName(co.postTo, company);
  const on = here && confirmed, may = canWrite();
  const set = (v) => askConfirm({ title: v ? "Post " + co.name + "’s entries into " + v + "?" : "Stop posting for " + co.name + "?", ok: v ? "Allow" : "Stop posting",
    body: v ? "<p>FinCom and the bridge will post this client’s bills, bank lines and sales <b>only</b> into the Tally company <b>" + esc(v) + "</b>. A posting meant for any other company is refused.</p>"
      : "<p>Nothing will be posted for this client until a company is ticked again.</p>" })
    .then((ok) => { if (!ok) return; choiceConfirm(co, "postTo", v); if (S.postStop && S.postStop.cid === co.id) S.postStop = null; toast(v ? "Posting allowed into " + v + "." : "Posting stopped."); render(); });
  const note = on ? (pc.at || co.postToAt ? "Confirmed " + fmtDateTime(pc.at || co.postToAt) + (pc.by || co.postToBy ? " by " + (pc.by || co.postToBy) : "") + "." : "")
    : co.postTo && !here && confirmed ? "Entries are posted into " + co.postTo + " now. Tick to post into " + company + " instead."
    : here ? "Found by FinCom (the one Tally company linked, same GSTIN): nothing is posted until it is ticked."
    : "Nothing is posted until it is ticked.";
  return <div className="tlink-post" data-tally-link-post={on ? "on" : "off"} data-choice="postTo" data-choice-state={pc ? pc.state : ""}>
    <label className="chk"><input type="checkbox" data-tally-link-post-tick="" checked={on} disabled={!may} onChange={() => set(on ? "" : company)} />
      {" Post this client’s entries into "}<b>{company}</b></label>
    <span className="note">{note}{!may && " A member of the firm who may make changes ticks it."}</span>
  </div>;
}

// More: Change company, Unlink, Name differs in Tally, Tally page (the menu Client setup's More uses)
function More({ co, k, onPick, onName }) {
  const linked = k.state !== "unlinked", cloud = typeof TCloud === "object" && TCloud.on(), may = canWrite();
  const unlink = () => askConfirm({ title: "Unlink " + k.company + " from " + co.name + "?", ok: "Unlink", danger: true,
    body: "<p>Its books stop coming to " + esc(co.name) + " until the client is linked again. Nothing in Tally changes.</p>" }).then((ok) => { if (ok) tallyLinkClient(k.company, null); });
  // a choice closes the menu
  const go = (fn) => (ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; fn(); };
  return <details className="bk-menu" data-tally-link-more="">
    <summary className="btn small" aria-label={"More about the Tally link of " + co.name}>More</summary>
    <div className="bk-menu-list">
      {linked && cloud && may && <button data-tally-link-change="" onClick={go(onPick)}>Change company<small>Link another company in Tally to this client instead.</small></button>}
      {linked && cloud && may && <button className="danger" data-tally-link-unlink="" onClick={go(unlink)}>Unlink<small>{k.company + "’s books stop coming to this client."}</small></button>}
      <button data-tally-link-name="" onClick={go(onName)}>Name differs in Tally<small>The company’s name exactly as Tally shows it.</small></button>
      <button data-tally-link-page="" onClick={go(() => openTallyFor(co.id))}>Tally page<small>The computers, and the details for support.</small></button>
    </div>
  </details>;
}

// the client's Tally name, when it is not the company's name in FinCom (the bridge on this computer matches by it)
function NameBox({ co, onClose }) {
  const open = typeof Bridge === "object" && Bridge.up() && (Bridge.st.open || []).length ? Bridge.st.open : null;
  const save = (v) => { const n = String(v || "").trim(); co.tallyName = n || co.name; Store.saveCompany(co); if (typeof Bridge === "object") Bridge.lastOpenKey = null; render(); };
  return <div className="tlink-name" data-tally-link-namebox="">
    <label className="f"><span>Company name in Tally, exactly as Tally shows it</span><CommitBox aria-label="Company name in Tally" value={co.tallyName || ""} placeholder={co.name} onCommit={save} /></label>
    {open && <label className="f"><span>Or pick the company open in Tally here</span>
      <select value={open.some((o) => o.name === co.tallyName) ? co.tallyName : ""} onChange={(ev) => ev.target.value && save(ev.target.value)}>
        <option value="">—</option>{open.map((o) => <option key={o.name}>{o.name}</option>)}</select></label>}
    <button className="linkbtn" onClick={onClose}>Done</button>
  </div>;
}

// the client's link state; on From Tally the days that need a Day Book are listed with their own Upload, so they are not
// said again here (a warning is shown once)
function linkHere(co, where) {
  const k = tallyLinkOf(co);
  if (!k || where !== "books" || !k.needs.some((n) => n.kind === "daybook")) return k;
  const needs = k.needs.filter((n) => n.kind !== "daybook"), state = needs.length ? "needs" : k.line && k.line.state === "open" ? "reading" : "waiting";
  return Object.assign({}, k, { needs, state, word: TALLY_LINK_WORDS[state], level: TALLY_LINK_LEVEL[state] });
}

export default function TallyLink({ co, where = "setup", b = null }) {
  const [pick, setPick] = useState(false), [name, setName] = useState(false);
  const k = co ? linkHere(co, where) : null, unlinked = !!k && k.state === "unlinked";
  // while not linked, read the cloud again by itself, so a company opened in Tally shows (and a link made elsewhere)
  useEffect(() => {
    if (!unlinked || typeof TLight !== "object" || !(typeof TCloud === "object" && TCloud.on())) return;
    const t = setInterval(() => {
      TLight.st.at = 0;
      Promise.resolve(TLight.refresh()).then(() => { const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName); if (!typing) render(); });
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [unlinked, co && co.id]);
  if (!co || !k) return null;
  return <section className="tlink" data-tally-link={k.state} data-tally-line-state={k.line ? k.line.state : ""} aria-label={"Link to Tally: " + k.word}>
    <div className="tlink-head">
      <h3 className="tlink-title">Link to Tally</h3>
      <More co={co} k={k} onPick={() => setPick(true)} onName={() => setName(true)} />
    </div>
    <StatusLine co={co} k={k} where={where} b={b} />
    {unlinked && <Picker co={co} />}
    {!unlinked && pick && <div className="tlink-change" data-tally-link-changebox=""><p className="note" style={{ margin: "8px 0 0" }}>{"Choose the company in Tally instead of " + k.company + ":"}</p>
      <Picker co={co} current={k.company} onDone={() => setPick(false)} /><button className="linkbtn" onClick={() => setPick(false)}>Cancel</button></div>}
    {k.needs.length > 1 && <ul className="tlink-needs" data-tally-link-needs="">{k.needs.slice(1).map((n) => { const x = needLine(co, n, k, where, b, isOwner(), () => openTallyFor(co.id));
      return <li key={n.kind} data-tally-need={n.kind}><span>{x.text}</span>{x.act}</li>; })}</ul>}
    {!unlinked && <PostTick co={co} company={k.company} />}
    {name && <NameBox co={co} onClose={() => setName(false)} />}
  </section>;
}
