// The "From Tally" tab of a client's books: setting the client up (day book, opening balances, ledger masters, the
// bridge, the cloud), reading straight from Tally through the bridge, and the files exported from Tally. Was
// viewBooksImport, viewSetupList, viewTallyRead and viewBookParts (src/js/18). The files are read by booksChange
// (src/js/23); the buttons are doAct cases (booksPick, tbPick, mastersPick, tallyRead, tallyCopy…, setup…).
//
// State: S.dbFrom / S.dbTo (a part's dates), S.tbOn (the trial balance date), S.tallyRange, S.tallyCopy.
const d = (x) => fmtDate(tallyDate(x));
const Act = ({ act, className = "btn small", children }) => <button className={className} onClick={() => doAct(act)}>{children}</button>;

// one step of setting up: done ✔, under way ⏳ or not yet ✖
function Step({ ok, title, children }) {
  return <div className="dash-row" style={{ alignItems: "flex-start" }}><span>{ok === true ? "✔" : ok === "wait" ? "⏳" : "✖"} <b>{title}</b></span><span style={{ textAlign: "right", maxWidth: "70%" }}>{children}</span></div>;
}

function Setup({ b }) {
  const co = CO(), m = b.meta || {}, parts = (m.parts || []).slice().sort((x, y) => String(x.from).localeCompare(String(y.from)));
  const today = Audit.today(), ks = setupKeepFor(co), k = ks && ks.st;
  // 1. the day book: which dates, and any gap between the parts
  const gaps = []; let cov = "";
  if (parts.length) {
    let end = parts[0].to;
    parts.slice(1).forEach((p) => { if (p.from > BridgeSeed.add(end, 1)) gaps.push(d(BridgeSeed.add(end, 1)) + " to " + d(BridgeSeed.add(p.from, -1))); if (p.to > end) end = p.to; });
    cov = d(parts[0].from) + " to " + d(end);
  }
  const tbOk = b.tb && b.tb.source, firstFrom = parts.length ? parts[0].from : m.from;
  // 4. the bridge
  let bs, bok = false, bact = null;
  if (!Bridge.on()) bs = "Not connected on this computer. Needed only on the computer with Tally: it posts entries and brings in each day’s changes.";
  else if (ks && ks.error) bs = "Did not answer: " + ks.error;
  else if (!k) bs = "asking…";
  else if (!k.on) { bs = "Keeping in step is off."; bact = <Act act="setupKeepOn" className="btn small primary">Switch it on</Act>; }
  else if (!k.phase && k.mode !== "bridge") { bs = "Waiting for the day book files (step 1). It does not read the year from Tally by itself."; bact = <Act act="setupModeBridge" className="linkbtn">or let the bridge copy the year from Tally, in the evening</Act>; }
  else if (!k.phase) { bs = "Will copy the year from Tally in the evening (or when nobody is at the computer)."; bact = <Act act="setupModeFiles" className="linkbtn">use files instead</Act>; }
  else if (k.phase === "live") { bok = true; bs = "In step: reads only changes, a few entries at a time."; }
  else bs = "Has the files; " + (k.openPending ? "reads the opening balances and " : "") + "checks them against Tally month by month this evening, then reads only changes." + (k.next && k.next <= today ? " Days from " + d(k.next) + " are read from Tally a day at a time." : "");
  const inCloud = parts.filter((p) => /^in the cloud/.test(p.cloud || "")).length;
  return (
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>Setting up {co.name}</h3>
      <Step ok={parts.length ? (gaps.length ? "wait" : true) : false} title="1. Day book">
        {parts.length ? <>{"from files, " + cov}{gaps.length > 0 && <>; <span className="bad">missing {gaps.join(", ")}</span></>}. The days after it are read from Tally a day at a time.</>
          : m.from ? "read from Tally (" + d(m.from) + " to " + d(m.to) + ")" : "Choose the dates and the day book XML below, part by part."}</Step>
      <Step ok={tbOk ? true : b.tb ? "wait" : false} title="2. Opening balances">
        {tbOk ? Object.keys(b.tb.led || {}).length + " ledgers, as on " + d(b.tb.openAsOn) + (b.tb.cloud ? ", in the cloud" : "") : b.tb ? "read from Tally" : "Choose the trial balance XML as on " + (firstFrom ? d(BridgeSeed.add(firstFrom, -1)) : "the day before the first date") + " below."}</Step>
      <Step ok={!!b.ledInfoAt} title="3. Ledger masters">
        {b.ledInfoAt ? Object.keys(b.ledInfo || {}).length + " ledgers (groups, PAN, GSTIN), " + d(String(b.ledInfoAt).slice(0, 10).replace(/-/g, "")) + ", shared with the firm" : "Choose the ledger masters XML below (List of Accounts)."}</Step>
      <Step ok={bok ? true : Bridge.on() && k && k.on ? "wait" : false} title="4. Tally Bridge">{bs}{bact && <> {bact}</>}</Step>
      <Step ok={TCloudUp.on() ? (parts.length && inCloud === parts.length ? true : "wait") : false} title="5. FinCom’s cloud">
        {TCloudUp.on() ? (parts.length ? inCloud + " of " + parts.length + " parts in the cloud: everyone in the firm sees the same books." : "Each file chosen below goes to the cloud too.") : "Sign in to the firm account (Settings) so everyone in the firm sees the same books."}</Step>
    </section>
  );
}

// reading the day book and Tally's balances through the bridge, now or every night
function StraightFromTally() {
  const co = CO(), live = typeof bridgeLive === "function" && bridgeLive(co);
  const t = Audit.today(), r = S.tallyRange || { from: Audit.iso(Audit.fyStart(t)), to: Audit.iso(t) }, cp = S.tallyCopy || null;
  const card = (body) => <section className="dash-card" style={{ maxWidth: 760, marginBottom: 12 }}><h3>Straight from Tally</h3>{body}</section>;
  if (!live) return card(<p className="note">With the Tally Bridge running and this company open in Tally, the day book and Tally’s own balances are read here directly, month by month — no exporting. Set it up under Settings → Tally Bridge.</p>);
  const bv = String((Bridge.st && Bridge.st.version) || ""), vnum = (v2) => v2.split(".").map((x) => String(num(x)).padStart(3, "0")).join(".");
  if (bv && vnum(bv) < vnum("1.10.0")) return card(<p className="note">The Tally Bridge on this computer is {bv}. Reading straight from Tally, the nightly copy and the FVU check need <b>1.10</b>: download it under Settings → Tally Bridge and run the setup on the Tally computer.</p>);
  return card(<>
    <p className="note">Reads every voucher of the period, and each ledger’s balance as Tally works it out, from <b>{Bridge.openFor(co).name}</b>.</p>
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <label className="note">From <input type="date" aria-label="Read from" defaultValue={r.from} onChange={(ev) => tallyRangeSet("from", ev.target.value)} /></label>
      <label className="note">to <input type="date" aria-label="Read to" defaultValue={r.to} onChange={(ev) => tallyRangeSet("to", ev.target.value)} /></label>
      <Act act="tallyRead" className="btn primary">Read from Tally</Act>
    </div>
    <p className="note" style={{ marginTop: 8 }}><b>A big company, or the first time?</b> Export the day book from Tally once (Display More Reports → Day Book → F2 for the period → Ctrl+E → XML) and choose it below under “Choose the day book XML”. It is the fastest way, and the bridge’s copy starts from the same file, so the bridge never reads the year from Tally; after that only changes are read.</p>
    <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}><b>Every night</b>
      <p className="note">The bridge on the Tally server copies each open company’s day book and balances at night, so in the morning they are read in seconds and the audit is ready. The companies have to be open in Tally at that hour.</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Act act="tallyCopyCheck">See last night’s copy</Act>
        <label className="note">at <input type="time" aria-label="Copy at" defaultValue={(cp && cp.time) || "02:00"} style={{ width: 110 }} onChange={(ev) => tallyTimeSet(ev.target.value)} /></label>
        <Act act="tallyScheduleOn">Copy every night</Act><Act act="tallyScheduleOff">Stop</Act>
      </div>
      {cp && <div className="note" style={{ marginTop: 6 }}>
        {cp.error ? <span className="bad">{cp.error}</span> : cp.none ? "No copy for this company yet."
          : <>{"Copy made " + String(cp.at || "").replace("T", " ").slice(0, 16) + " for " + d(cp.from) + " to " + d(cp.to) + ", " + (cp.months || []).length + " months. "}<Act act="tallyCopyUse" className="btn small primary">Use it</Act></>}
        {cp.schedule ? " · Nightly: " + (cp.schedule.on ? "on, next " + (cp.schedule.next || "") : "off") : ""}</div>}
    </div>
  </>);
}

function Parts({ b }) {
  const parts = ((b.meta || {}).parts || []).slice().sort((x, y) => String(x.from).localeCompare(String(y.from)));
  if (!parts.length) return null;
  return <div className="bk-tablewrap"><table className="bk-table compact">
    <thead><tr><th>Part brought in</th><th className="n">Entries</th><th>File</th><th className="dt">On</th><th>Bridge’s copy</th><th>Cloud</th></tr></thead>
    <tbody>{parts.map((p, i) => <tr key={p.from + ":" + i}><td>{d(p.from) + " to " + d(p.to)}</td><td className="n">{p.n}</td><td>{p.file || ""}</td><td className="dt">{fmtDate(String(p.at || "").slice(0, 10))}</td><td>{p.bridge || "—"}</td><td>{p.cloud || "—"}</td></tr>)}</tbody>
  </table></div>;
}

function Files({ b }) {
  const m = b.meta || {}, n = (b.vouchers || []).length, other = m.gstins ? notThisClient(m.gstins) : [];
  return (
    <section className="dash-card" style={{ maxWidth: 760 }}><h3>Or bring in files exported from Tally</h3>
      <p className="note">In Tally: <b>Display More Reports → Day Book</b>, <b>F2</b> for the period, then <b>Ctrl+E</b> (Export) as XML. A big company can be brought in <b>part by part</b>: choose the dates, then that part’s file, as many times as needed; each part fills only its dates. The bridge’s copy is filled from the same files, so Tally is not read for them.</p>
      <div className="row" style={{ gap: 8, margin: "10px 0", flexWrap: "wrap", alignItems: "center" }}>
        <label className="note">From <input type="date" aria-label="Day book from" value={S.dbFrom || ""} onChange={(ev) => setAndShow("dbFrom", ev.target.value)} /></label>
        <label className="note">to <input type="date" aria-label="Day book to" value={S.dbTo || ""} onChange={(ev) => setAndShow("dbTo", ev.target.value)} /></label>
        <Act act="booksPick" className="btn primary">Choose the day book XML{S.dbFrom || S.dbTo ? " for these dates" : ""}</Act><span className="note">(no dates: the whole file)</span>
      </div>
      <Parts b={b} />
      <p className="note" style={{ marginTop: 10 }}><b>Opening balances:</b> in Tally, <b>Display More Reports → Trial Balance</b>, show the ledgers (<b>Alt+F5</b>, detailed), set the date to the day <b>before</b> the first date above, then <b>Ctrl+E</b> as XML. The closing balances there are the opening balances here, so Tally is not asked for them.</p>
      <div className="row" style={{ gap: 8, margin: "6px 0", flexWrap: "wrap", alignItems: "center" }}>
        <label className="note">Balances as on <input type="date" aria-label="Balances as on" value={S.tbOn || tbDefaultOn(b)} onChange={(ev) => setAndShow("tbOn", ev.target.value)} /></label>
        <Act act="tbPick" className="btn">Choose the trial balance XML</Act>
        {b.tb && b.tb.source && <span className="note">{Object.keys(b.tb.led || {}).length + " opening balances from " + b.tb.source + " (as on " + d(b.tb.openAsOn || "") + ")"}</span>}
      </div>
      <p className="note" style={{ marginTop: 10 }}>For the deductees’ PAN and the ledger groups, also export <b>Display → List of Accounts</b> as XML.</p>
      <div className="row" style={{ gap: 8, margin: "10px 0" }}>
        <Act act="mastersPick" className="btn">Choose the ledger masters XML</Act>
        {n > 0 && <Act act="booksClear">Remove what is here</Act>}
        {booksHasAny(b) && <Act act="booksWipe">Remove Tally data and all GST work</Act>}
      </div>
      {other.length > 0 && <p className="bk-warn">The books here are for {other.join(", ")}, not this client’s PAN ({clientPan()}). Remove them with “Remove Tally data and all GST work”.</p>}
      {n ? <>
        <div className="dash-row"><span>Vouchers</span><b>{n}</b></div>
        <div className="dash-row"><span>Period</span><b>{d(m.from) + " to " + d(m.to)}</b></div>
        <div className="dash-row"><span>Registrations in the file</span><b>{(m.gstins || []).join(", ") || "—"}</b></div>
        <div className="dash-row"><span>Read on</span><b>{m.at ? fmtDate(String(m.at).slice(0, 10)) : "—"}</b></div>
        <div className="dash-row"><span>Ledger masters</span><b>{Object.keys(b.pans || {}).length ? Object.keys(b.pans).length + " with PAN, " + Object.keys(b.gstins || {}).length + " with GSTIN" : "not brought in yet"}</b></div>
      </> : <p className="note">Nothing here yet.</p>}
    </section>
  );
}

export default function FromTally({ b }) {
  return <><Setup b={b} /><StraightFromTally /><Files b={b} /></>;
}
