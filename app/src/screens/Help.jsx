// Help: the searchable guide, the firm's tickets to FinCom support, a new ticket (with the screen's details), a ticket's
// thread, and for platform admins the support desk (SLA, pipeline, ageing, every ticket). Was viewHelp, viewSupGuide,
// viewSupMine, viewSupDesk, viewSupNew, viewSupTicket, supRow, supPill, supToolbar, supCtx, supFileList and GUIDE.html
// (src/js/40). The work is SUP; buttons and boxes go through supTab, supArt, supFilter, supDstat, supAct, supType,
// supDraft, supFiles, supFdel, supDl, supSet (src/js/40).
//
// State: S.sup (tab, list, filter, q, gq: guide search, art: the article open, open/detail: a ticket, newOpen, draft,
// files, rtext, rfiles, rint, dstat, dpri, dfirm, dq, busy).
import Loading from "../parts/Loading.jsx";
import ListTable from "../parts/ListTable.jsx";

const Pill = ({ kind, v }) => {
  const lab = kind === "st" ? (SUP.ST[v] || v) : kind === "pri" ? ((SUP.PRI.find((p) => p[0] === v) || [, v])[1]) : kind === "sla" ? ({ track: "on track", risk: "at risk", late: "late", met: "met" })[v] : v;
  return <span className={"sp-pill sp-" + kind + "-" + v}>{lab}</span>;
};
const Sup = ({ a, className = "btn small", children, disabled, title }) => <button className={className} disabled={disabled} title={title} onClick={() => supAct(a)}>{children}</button>;

function Article({ x }) {
  return <><h3 style={{ margin: "0 0 6px" }}>{x.t}</h3><p className="note" style={{ margin: "0 0 8px" }}>{x.area}</p><p>{x.what}</p>
    {x.steps && x.steps.length > 0 && <><h4>What to do</h4><ol>{x.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></>}
    {x.from && <><h4>Where the figures come from</h4><p>{x.from}</p></>}
    {x.watch && x.watch.length > 0 && <><h4>Watch for</h4><ul>{x.watch.map((s, i) => <li key={i}>{s}</li>)}</ul></>}</>;
}

function Guide() {
  const s = SUP.st(), q = s.gq || "", hits = q ? GUIDE.search(q) : null, all = GUIDE.all(), art = all.find((x) => x.k === s.art), list = hits || all;
  const groups = hits ? [["Results", list.slice(0, 20)]] : Array.from(new Set(list.map((x) => x.area))).map((a) => [a, list.filter((x) => x.area === a)]);
  return <div className="sp-guide"><div className="sp-gleft">
    <input type="search" data-fk="supgq" aria-label="Search the guide" value={q} placeholder="Search: 2B, rule 37, challan, Tally port…" style={{ width: "100%" }} onChange={(ev) => supType("gq", ev.target.value)} />
    {hits && !hits.length && <p className="note">{"Nothing in the guide for “" + q + "”."}</p>}
    {groups.map(([a, xs]) => <div key={a} style={{ display: "contents" }}><h4 className="sp-area">{a}</h4>{xs.map((x) => <button key={x.k} className={"sp-art" + (x.k === s.art ? " on" : "")} onClick={() => supArt(x.k)}>{x.t}</button>)}</div>)}
  </div><div className="sp-gright">{art ? <Article x={art} /> : <p className="note">Choose a topic on the left, or search.</p>}
    <div className="sp-still"><b>Did not find the answer?</b> {SUP.on() ? <Sup a="new">Raise a ticket</Sup> : <span className="note">Sign in to the firm account to raise a ticket.</span>}</div></div></div>;
}

// the tickets: the one list table (spec K6): updated (date), ticket no., status, then the rest; a click on a row opens it
const TicketTable = ({ rows, adm, now }) => <ListTable name={adm ? "deskTickets" : "myTickets"} className="bk-table sp-table" rows={rows} rowKey={(t) => t.id} unit={["ticket", "tickets"]}
  rowProps={(t) => ({ className: "sp-row", "data-key": t.id, onClick: () => SUP.open(t.id) })}
  empty="No ticket here. Use + New ticket at the top right to ask FinCom support."
  cols={[
    { k: "upd", role: "date", label: "Updated", cls: "dt", v: (t) => t.updated_at || "", td: (t) => ({ title: SUP.when(t.updated_at) }), cell: (t) => fmtDate(String(t.updated_at).slice(0, 10)) },
    { k: "id", role: "number", label: "ID", cls: "sp-id", v: (t) => SUP.code(t), cell: (t) => SUP.code(t) },
    { k: "st", role: "status", label: "Status", v: (t) => t.status || "", cell: (t) => <><Pill kind="st" v={t.status} />{t.status === "open" && t.last_by === "firm" && adm && <> <span className="note">firm replied</span></>}</> },
    { k: "subj", label: "Subject", v: (t) => t.subject || "", cell: (t) => <>{t.subject}{adm && <div className="note">{(t.firm_name || "") + " · " + (t.created_name || t.created_email || "")}</div>}</> },
    { k: "mod", label: "Module", v: (t) => t.module || "", cell: (t) => t.module },
    { k: "pri", label: "Priority", v: (t) => t.priority || "", cell: (t) => <Pill kind="pri" v={t.priority} /> },
    { k: "sla", label: "SLA", cell: (t) => <Pill kind="sla" v={SUP.sla(t, now)} /> },
  ]} />;

function Mine() {
  const s = SUP.st(), l = s.list || [], d30 = Date.now() - 30 * 864e5;
  const mine = l.filter((t) => SUP.active(t)), wait = l.filter((t) => t.status === "waiting"), done = l.filter((t) => !SUP.active(t) && Date.parse(t.resolved_at || t.updated_at) > d30);
  const f = s.filter || "open", q = String(s.q || "").toLowerCase();
  const shown = l.filter((t) => (f === "all" || (f === "open" ? SUP.active(t) : f === "waiting" ? t.status === "waiting" : !SUP.active(t))) && (!q || (SUP.code(t) + " " + t.subject + " " + t.module).toLowerCase().includes(q)));
  const chips = [["open", "Open", l.filter(SUP.active).length], ["waiting", "Awaiting me", wait.length], ["closed", "Closed", l.filter((t) => !SUP.active(t)).length], ["all", "All", l.length]];
  return <>
    <div className="dash-tiles" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))", marginTop: 12 }}>
      <button className="dtile" onClick={() => supFilter("open")}><span>My open</span><b>{mine.length}</b><small>in progress</small></button>
      <button className={"dtile" + (wait.length ? " warn" : "")} onClick={() => supFilter("waiting")}><span>Awaiting me</span><b>{wait.length}</b><small>support replied; your answer is needed</small></button>
      <button className="dtile" onClick={() => supFilter("closed")}><span>Resolved · 30 days</span><b>{done.length}</b><small>last 30 days</small></button></div>
    <div className="sp-bar"><div className="sp-chips">{chips.map(([k, lb, c]) => <button key={k} className={f === k ? "on" : ""} onClick={() => supFilter(k)}>{lb} <span>{c}</span></button>)}</div>
      <input type="search" data-fk="supq" aria-label="Search tickets" value={s.q || ""} placeholder="Search tickets…" style={{ width: 240 }} onChange={(ev) => supType("q", ev.target.value)} />
      <Sup a="reload" title="Read again">↻</Sup></div>
    {shown.length ? <TicketTable rows={shown} adm={false} /> : <p className="note lt-empty" data-list-empty="" style={{ border: 0 }}>{l.length ? "No tickets here. Choose another filter above, or use + New ticket." : "No tickets yet. Use + New ticket to raise one; it goes to FinCom support."}</p>}
  </>;
}

function Desk() {
  const s = SUP.st(), l = s.list || [], now = Date.now(), d30 = now - 30 * 864e5;
  const open = l.filter(SUP.active), sla = { met: 0, risk: 0, late: 0, track: 0 };
  open.forEach((t) => sla[SUP.sla(t, now)]++);
  l.filter((t) => !SUP.active(t) && Date.parse(t.resolved_at || t.updated_at) > d30).forEach((t) => sla[SUP.sla(t, now)]++);
  const judged = sla.met + sla.late + sla.track + sla.risk, health = judged ? Math.round(100 * (sla.met + sla.track) / judged) : 100;
  const win = l.filter((t) => Date.parse(t.created_at) > d30), closedWin = win.filter((t) => !SUP.active(t));
  const firstRsp = l.filter((t) => t.first_response_at && Date.parse(t.created_at) > d30).map((t) => (Date.parse(t.first_response_at) - Date.parse(t.created_at)) / 36e5);
  const avgRsp = firstRsp.length ? firstRsp.reduce((a, b) => a + b, 0) / firstRsp.length : null;
  // opened and closed, week by week, for eight weeks
  const wk = []; for (let i = 7; i >= 0; i--) { const a = now - (i + 1) * 7 * 864e5, b = now - i * 7 * 864e5;
    wk.push({ lab: fmtDate(a).slice(0, 6), o: l.filter((t) => { const c = Date.parse(t.created_at); return c > a && c <= b; }).length, c: l.filter((t) => { const c = Date.parse(t.resolved_at || ""); return c > a && c <= b; }).length }); }
  const top = Math.max(1, ...wk.map((w) => Math.max(w.o, w.c)));
  const pipe = ["new", "open", "waiting"].map((k) => [k, open.filter((t) => t.status === k).length]).filter((x) => x[1]);
  const byFirm = {}; open.forEach((t) => { byFirm[t.firm_name || "?"] = (byFirm[t.firm_name || "?"] || 0) + 1; });
  const firms = Object.entries(byFirm).sort((a, b) => b[1] - a[1]).slice(0, 6), fmax = Math.max(1, ...firms.map((f) => f[1]));
  const res = SUP.PRI.map(([k, lab]) => { const xs = l.filter((t) => t.priority === k && t.resolved_at && Date.parse(t.resolved_at) > d30).map((t) => (Date.parse(t.resolved_at) - Date.parse(t.created_at)) / 36e5); return [lab, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, xs.length]; });
  const old = open.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(0, 5);
  const q = String(s.dq || "").toLowerCase(), st = s.dstat || "active";
  const shown = l.filter((t) => (st === "all" || (st === "active" ? SUP.active(t) : st === "done" ? !SUP.active(t) : t.status === st)) && (!s.dpri || t.priority === s.dpri) && (!s.dfirm || t.firm_id === s.dfirm) &&
    (!q || (SUP.code(t) + " " + t.subject + " " + t.module + " " + (t.firm_name || "") + " " + (t.created_name || "")).toLowerCase().includes(q)));
  const firmList = Array.from(new Map(l.map((t) => [t.firm_id, t.firm_name || "?"])).entries());
  const kpis = [["Opened · 30 days", win.length, ""], ["Closed · 30 days", closedWin.length, win.length ? Math.round(100 * closedWin.length / win.length) + "% of opened" : ""],
    ["SLA breached", open.filter((t) => SUP.sla(t, now) === "late").length, "open and past due"], ["First reply", avgRsp == null ? "—" : avgRsp < 1 ? Math.round(avgRsp * 60) + "m" : avgRsp.toFixed(1) + "h", "average, 30 days"]];
  return <>
    <div className="sp-desk">
      <div className="sp-card sp-now"><div className="sp-kick">OPEN NOW</div><div className="sp-big">{open.length} <small>tickets</small></div>
        <div className="sp-kick" style={{ marginTop: 14 }}>SLA HEALTH <b style={{ float: "right" }}>{health + "%"}</b></div>
        <div className="sp-health"><i style={{ width: health + "%" }}></i></div>
        <div className="note">{["track", "risk", "late"].map((k) => <span key={k}><span className={"sp-dot sp-d-" + k}></span>{sla[k] + " " + ({ track: "on track", risk: "at risk", late: "late" })[k] + "   "}</span>)}{sla.met + " met"}</div></div>
      <div className="sp-card sp-kpis">{kpis.map(([a, b, c]) => <div key={a}><div className="sp-kick">{a.toUpperCase()}</div><div className="sp-mid">{b}</div><div className="note">{c}</div></div>)}
        <div className="sp-chart" aria-label="Opened and closed by week">{wk.map((w, i) => <div key={i} className="sp-wk"><div className="sp-bars"><i className="o" style={{ height: Math.round(60 * w.o / top) }} title={w.o + " opened"}></i><i className="c" style={{ height: Math.round(60 * w.c / top) }} title={w.c + " closed"}></i></div><small>{w.lab}</small></div>)}</div>
        <div className="note"><span className="sp-dot sp-d-o"></span>opened <span className="sp-dot sp-d-c"></span>closed · last 8 weeks</div></div></div>
    <div className="sp-card"><b>{"Pipeline · where " + open.length + " open tickets sit"}</b>{pipe.length ? <div className="sp-pipe">{pipe.map(([k, c]) => <button key={k} className={"sp-p-" + k} style={{ flex: c }} onClick={() => supDstat(k)}><b>{c}</b><small>{SUP.ST[k]}</small></button>)}</div> : <p className="note">Nothing open.</p>}</div>
    <div className="sp-two"><div className="sp-card"><b>Firms by open tickets</b>{firms.length ? firms.map(([f, c]) => <div key={f} className="sp-hbar"><span>{f}</span><i style={{ width: Math.round(100 * c / fmax) + "%" }}></i><b>{c}</b></div>) : <p className="note">None open.</p>}</div>
      <div className="sp-card"><b>Average time to resolve · 30 days</b>{res.some((r) => r[2]) ? res.map(([lab, v, n2]) => <div key={lab} className="dash-row"><span>{lab}</span><b>{v == null ? "—" : v < 24 ? v.toFixed(1) + " h" : (v / 24).toFixed(1) + " days"}{n2 ? <> <small className="note">{"(" + n2 + ")"}</small></> : null}</b></div>) : <p className="note">Nothing resolved in the last 30 days.</p>}</div></div>
    <div className="sp-card"><b>Oldest open</b>{old.length ? <ListTable name="deskOldest" className="bk-table sp-table" rows={old} rowKey={(t) => t.id} unit={["ticket", "tickets"]}
      rowProps={(t) => ({ className: "sp-row", onClick: () => SUP.open(t.id) })}
      cols={[
        { k: "age", role: "date", label: "Opened", v: (t) => t.created_at || "", td: (t) => ({ title: SUP.when(t.created_at) }), cell: (t) => SUP.ago(t.created_at) },
        { k: "id", role: "number", label: "ID", cls: "sp-id", v: (t) => SUP.code(t), cell: (t) => SUP.code(t) },
        { k: "firm", role: "party", label: "Firm", v: (t) => t.firm_name || "", cell: (t) => t.firm_name || "" },
        { k: "st", role: "status", label: "Status", v: (t) => t.status || "", cell: (t) => <Pill kind="st" v={t.status} /> },
        { k: "subj", label: "Subject", v: (t) => t.subject || "", cell: (t) => t.subject },
        { k: "own", label: "Owner", v: (t) => t.assignee || "", cell: (t) => t.assignee || "—" },
        { k: "sla", label: "SLA", cell: (t) => <Pill kind="sla" v={SUP.sla(t, now)} /> },
      ]} /> : <p className="note">Nothing open.</p>}</div>
    <div className="sp-card"><b>All tickets</b><div className="sp-bar"><div className="sp-chips">{[["active", "Open"], ["new", "New"], ["open", "Firm replied"], ["waiting", "Awaiting firm"], ["done", "Closed"], ["all", "All"]].map(([k, lb]) => <button key={k} className={st === k ? "on" : ""} onClick={() => supDstat(k)}>{lb}</button>)}</div>
      <select aria-label="Priority" style={{ width: "auto" }} value={s.dpri || ""} onChange={(ev) => supType("dpri", ev.target.value, true)}><option value="">Any priority</option>{SUP.PRI.map(([k, lb]) => <option key={k} value={k}>{lb}</option>)}</select>
      <select aria-label="Firm" style={{ width: "auto" }} value={s.dfirm || ""} onChange={(ev) => supType("dfirm", ev.target.value, true)}><option value="">All firms</option>{firmList.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      <input type="search" data-fk="supdq" aria-label="Search all tickets" value={s.dq || ""} placeholder="Search…" style={{ width: 200 }} onChange={(ev) => supType("dq", ev.target.value)} /><Sup a="reload" title="Read again">↻</Sup></div>
      {shown.length ? <TicketTable rows={shown} adm /> : <p className="note lt-empty" data-list-empty="" style={{ border: 0 }}>No tickets here. Choose another filter above.</p>}</div>
  </>;
}

function Ctx({ c }) {
  if (!c || !Object.keys(c).length) return <span className="note">No screen details.</span>;
  return <>{[["Screen", c.screen], ["Client", c.client ? c.client + (c.gstin ? " · " + c.gstin : "") : ""], ["Build", c.build], ["Browser", c.browser]].filter((x) => x[1]).map(([a, b]) => <div key={a}><span className="note">{a}</span> {b}</div>)}
    {(c.recent || []).length > 0 && <div><span className="note">Last messages</span><ul>{c.recent.map((r, i) => <li key={i}>{r.kind === "error" ? "Error: " + r.msg : r.msg}</li>)}</ul></div>}</>;
}
const Files = ({ list, which }) => (list || []).map((f, i) => <span key={i} className="sp-file">{f.name} <small>{Math.max(1, Math.round(f.size / 1024)) + " KB"}</small> <button className="linkbtn" aria-label="Remove" onClick={() => supFdel(which, i)}>✕</button></span>);
const Attach = ({ which, label, accept }) => <label className="btn small">{label}<input type="file" multiple hidden aria-label={label} accept={accept} onChange={(ev) => { const fs = Array.from(ev.target.files || []); ev.target.value = ""; supFiles(which, fs); }} /></label>;

function NewTicket() {
  const s = SUP.st(), c = S.helpCtx || SUP.context(), d = s.draft || (s.draft = { module: SUP.moduleOf(c), category: "problem", priority: "medium", withCtx: true, subject: s.gq || "", body: "" });
  const sugg = d.subject && d.subject.length > 3 ? GUIDE.search(d.subject).slice(0, 3) : [];
  const sel = (k, label, opts) => <label className="sp-f"><span>{label}</span><select aria-label={label} value={d[k]} onChange={(ev) => supDraft(k, ev.target.value, true)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  return <div className="sp-card" style={{ marginTop: 12 }}><div className="sp-head"><h3 style={{ margin: 0 }}>New ticket to FinCom support</h3><Sup a="cancel" className="linkbtn">Cancel</Sup></div>
    <label className="sp-f"><span>Subject</span><input type="text" data-fk="supd-subject" aria-label="Subject" maxLength={200} value={d.subject} placeholder="In a line: what is wrong or what you need" onChange={(ev) => supDraft("subject", ev.target.value, true)} /></label>
    {sugg.length > 0 && <div className="sp-sugg"><span className="note">The guide may answer it:</span> {sugg.map((x, i) => <span key={x.k}>{i > 0 && " · "}<button className="linkbtn" onClick={() => supArt(x.k, true)}>{x.t}</button></span>)}</div>}
    <div className="sp-grid">{sel("module", "Module", SUP.MODULES.map((m) => [m, m]))}{sel("category", "Kind", SUP.CATS)}{sel("priority", "How urgent", SUP.PRI.map(([k, l, n]) => [k, l + " — " + n]))}</div>
    <label className="sp-f"><span>What happened</span><textarea data-fk="supd-body" aria-label="What happened" rows={7} value={d.body} placeholder="What you did, what you expected, what happened instead. The exact message helps." onChange={(ev) => supDraft("body", ev.target.value)} /></label>
    <div className="sp-files"><Files list={s.files} which="files" /><Attach which="files" label="Attach screenshots or files" accept="image/*,.pdf,.xml,.json,.xlsx,.xls,.csv,.txt,.zip" /> <span className="note">up to 10 MB each</span></div>
    <label className="chk" style={{ marginTop: 10 }}><input type="checkbox" checked={!!d.withCtx} onChange={(ev) => supDraft("withCtx", ev.target.checked, true)} /> Attach the screen’s details</label>
    {d.withCtx && <div className="sp-ctx"><Ctx c={c} /></div>}
    <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}><Sup a="cancel" className="btn">Cancel</Sup><Sup a="submit" className="btn primary" disabled={!!s.busy}>{s.busy ? "Sending…" : "Raise ticket"}</Sup></div></div>;
}

function Ticket() {
  const s = SUP.st(), t = s.detail, adm = SUP.admin();
  if (!t) return <Loading what="the ticket" lines={3} />;
  const c = t.context || {};
  return <>
    <div className="sp-card" style={{ marginTop: 12 }}><Sup a="back" className="linkbtn">← All tickets</Sup>
      <div className="sp-thead"><div><div className="note">{SUP.code(t) + " · " + t.module + " · " + ((SUP.CATS.find((x) => x[0] === t.category) || [, t.category])[1])}</div><h3 style={{ margin: "2px 0 6px", fontSize: 20 }}>{t.subject}</h3>
        <Pill kind="st" v={t.status} /> <Pill kind="pri" v={t.priority} /> <Pill kind="sla" v={SUP.sla(t)} />
        <div className="note" style={{ marginTop: 6 }}>{adm && <><b>{t.firm_name || ""}</b>{" · "}</>}{"raised by " + (t.created_name || t.created_email || "") + " on " + SUP.when(t.created_at) + (SUP.active(t) ? " · answer by " + SUP.when(t.first_response_at ? t.resolve_by : t.respond_by) : t.resolved_at ? " · resolved " + SUP.when(t.resolved_at) : "")}</div></div>
        {adm ? <div className="sp-admin">
          <label className="sp-f"><span>Status</span><select aria-label="Status" value={t.status} onChange={(ev) => supSet("p_status", ev.target.value)}>{Object.entries(SUP.ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="sp-f"><span>Priority</span><select aria-label="Priority" value={t.priority} onChange={(ev) => supSet("p_priority", ev.target.value)}>{SUP.PRI.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="sp-f"><span>Owner</span><CommitOwner value={t.assignee || ""} /></label></div>
          : <div>{SUP.active(t) ? <Sup a="resolve">Mark resolved</Sup> : <Sup a="reopen">Open it again</Sup>}</div>}</div></div>
    {Object.keys(c).length > 0 && <details className="sp-ctx" open={adm}><summary>Screen details sent with the ticket</summary><Ctx c={c} /></details>}
    <div className="sp-thread">{(t.thread || []).map((m, i) => <div key={i} className={"sp-msg" + (m.from_support ? " sup" : "") + (m.internal ? " int" : "")}>
      <div className="sp-mhead"><b>{m.author_name || (m.from_support ? "FinCom support" : "Firm")}</b>{m.from_support && <> <span className="note">FinCom support</span></>}{m.internal && <> <span className="sp-pill sp-int">internal note — the firm does not see it</span></>}<span className="note" style={{ marginLeft: "auto" }}>{SUP.when(m.created_at)}</span></div>
      <div className="sp-body">{String(m.body || "").split("\n").map((ln, j) => <span key={j}>{j > 0 && <br />}{ln}</span>)}</div>
      {(m.files || []).length > 0 && <div className="sp-mfiles">{m.files.map((f, j) => <button key={j} className="sp-file" onClick={() => supDl(f.path, f.name)}>{"\u{1F4CE} " + f.name + " "}<small>{Math.max(1, Math.round((f.size || 0) / 1024)) + " KB"}</small></button>)}</div>}</div>)}</div>
    <div className="sp-card"><label className="sp-f"><span>{adm ? "Reply to the firm" : "Reply"}</span><textarea data-fk="supr" aria-label="Reply" rows={4} value={s.rtext || ""} placeholder={adm ? "Your answer" : "Add details, answer support’s question"} onChange={(ev) => supType("rtext", ev.target.value)} /></label>
      <div className="sp-files"><Files list={s.rfiles} which="rfiles" /><Attach which="rfiles" label="Attach" /></div>
      <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 8, alignItems: "center" }}>{adm && <label className="chk"><input type="checkbox" checked={!!s.rint} onChange={(ev) => supType("rint", ev.target.checked, true)} /> Internal note (the firm does not see it)</label>}
        <Sup a="send" className="btn primary" disabled={!!s.busy}>{s.busy ? "Sending…" : "Send"}</Sup></div>
      {s.mailNote && adm && <p className="note">{"Email: " + s.mailNote}</p>}</div>
  </>;
}

// who is on a ticket (support only): saved when the box is left
function CommitOwner({ value }) {
  return <input type="text" data-fk="supset-owner" aria-label="Owner" defaultValue={value} key={value} placeholder="who is on it" style={{ width: 140 }} onBlur={(ev) => ev.target.value.trim() !== value && supSet("p_assignee", ev.target.value.trim())} />;
}

export default function Help() {
  const s = SUP.st(), adm = SUP.admin();
  if (s.tab === "desk" && !adm) s.tab = "tickets";
  const n = SUP.counts();
  let body;
  if (s.newOpen) body = <NewTicket />;
  else if (s.open) body = <Ticket />;
  else if (s.tab === "guide") body = <Guide />;
  else if (!SUP.on()) body = <div className="bk-none">Sign in to the firm account (top right) to raise tickets and follow them. The guide works without it.</div>;
  else if (s.list === null) { if (!s.loading) { s.loading = true; SUP.load(true).then(() => { s.loading = false; render(); }); } body = <Loading what="tickets" />; }
  else body = s.tab === "desk" ? <Desk /> : <Mine />;
  const tabs = [["guide", "Guide"], ["tickets", "My tickets", !adm && n ? n : null]].concat(adm ? [["desk", "Support desk", n || null]] : []);
  return <div className="pane" style={{ marginTop: 0 }}><div className="sp-head"><div><h2 style={{ margin: 0 }}>Help</h2><p className="note" style={{ margin: "2px 0 0" }}>Search the guide; if it does not answer it, raise a ticket to FinCom support.</p></div>
    {SUP.on() && <Sup a="new" className="btn primary">+ New ticket</Sup>}</div>
    <nav className="sbar" aria-label="Help">{tabs.map(([id, l, c]) => <button key={id} aria-selected={s.tab === id} onClick={() => supTab(id)}>{l}{c ? <> <span className="sbar-n">{c}</span></> : null}</button>)}</nav>
    {body}</div>;
}
