// Tally: the FinCom Connector, the Tally Bridge (connect, the Tallys found, which client each company is, the check of
// this server's Tally, the reading test) and the books in FinCom's cloud. Was viewTallyHome (src/js/18),
// viewBridgeSettings, bridgeSetupSteps, bridgeDownHelp, viewBridgeDiagnosis and viewReadTest (src/js/24), and TCloud.view
// (src/js/49). The work is Bridge and TCloud; boxes and choices go through bridgeSet, bridgeLink, bridgePin, tcLink
// (src/js/24, 49), buttons through doAct (bridgeTest, bridgeConnect, bridgeOff, bridgeSetupFile, bridgeDiag, bridgeReadTest).
import TallyPill from "../parts/TallyPill.jsx";
import { PostLog } from "./Done.jsx";
import CommitBox from "../parts/CommitBox.jsx";
import { useState } from "react";

const Act = ({ act, className = "btn small", children, disabled }) => <button className={className} disabled={disabled} onClick={() => doAct(act)}>{children}</button>;

function ReadTest() {
  if (!Bridge.up()) return null;
  const r = S.readTest || {};
  return <div style={{ marginTop: 10, borderTop: "1px solid var(--rule-soft)", paddingTop: 10 }}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><b>Test reading entries</b><Act act="bridgeReadTest" disabled={!!r.busy}>{r.busy ? "Testing…" : "Run test"}</Act></div>
    <p className="note" style={{ margin: "4px 0" }}>Checks how FinCom can read entries from the company open in Tally (nothing is written). If posts are “not confirmed”, run this and send the result.</p>
    {r.error && <p className="bk-warn">{r.error}</p>}
    {r.tests && <><table className="data"><tbody>{r.tests.map((t, i) => <tr key={i}><td>{t.name}</td><td>{t.ok ? <><span className="tag ok">works</span>{" " + num(t.count) + " found" + (t.optional ? " (" + num(t.optional) + " Optional)" : "")}</> : <><span className="tag bad">failed</span>{" " + (t.error || "")}</>}</td><td className="n">{num(t.ms) + " ms"}</td></tr>)}</tbody></table>
      <p className="note" style={{ margin: "4px 0 0" }}>{(r.company || "") + " · port " + r.port + " · " + r.from + " to " + r.to}</p></>}
  </div>;
}

function Diagnosis() {
  const d = Bridge.diag;
  const head = <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h3 style={{ margin: 0 }}>Check my Tally</h3><Act act="bridgeDiag">{d ? "Check again" : "Check now"}</Act></div>;
  if (!d) return <div className="bdiag">{head}<p className="note" style={{ margin: "6px 0 0" }}>Finds your TallyPrime on this server and explains anything that stops the connection.</p><ReadTest /></div>;
  if (d.error) return <div className="bdiag">{head}<p className="bk-warn">{d.error}</p></div>;
  return <div className="bdiag">{head}
    <p className="note" style={{ margin: "6px 0" }}>Bridge running as <b>{d.user || ""}</b>{" (Windows session " + d.mySession + ")."}</p>
    {(d.findings || []).map((f, i) => <div key={i} className={"bd-f " + f.level}><b>{(f.level === "ok" ? "✔ " : "⚠ ") + f.text}</b>{f.fix && <div className="bd-fix">{"What to do: " + f.fix}</div>}</div>)}
    {(d.tallies || []).length > 0 && <table className="data" style={{ marginTop: 8 }}><thead><tr><th>TallyPrime of</th><th>Accepting connections on</th><th>Its setting</th></tr></thead><tbody>
      {d.tallies.map((t, i) => <tr key={i}><td>{t.user || ("session " + t.session)}{t.mine && <> <span className="tag ok">you</span></>}</td><td>{t.ports.length ? "port " + t.ports.join(", ") : <span className="tag bad">not accepting</span>}</td>
        <td>{t.ini && t.ini.found ? (t.ini.mode || "?") + ", port " + (t.ini.port || "9000") : <span className="note">{"—"}</span>}</td></tr>)}</tbody></table>}
    {d.freePort && <p className="note" style={{ margin: "6px 0 0" }}>A free port on this server: <b>{d.freePort}</b>. Each user’s TallyPrime needs its own port.</p>}
    <ReadTest />
  </div>;
}

function DownHelp({ c }) {
  const url = c.url.replace(/\/+$/, "");
  return <div className="bdiag"><b>FinCom cannot reach the bridge. Check, in this order:</b><ol style={{ margin: "8px 0 0 18px", padding: 0, lineHeight: 1.55 }}>
    <li>On the computer where TallyPrime runs, is the window <b>FinCom - Tally Bridge</b> open and showing <b>READY</b>? If not, double-click <b>Start-TDS-Bridge.bat</b> in the bridge folder.</li>
    <li>If that window shows <b>BRIDGE STOPPED</b> or <b>Could not start on port</b>, do what it says, or send the file <b>tds-bridge-console.txt</b> from the bridge folder.</li>
    <li>In this same browser, open <a href={url + "/ping"} target="_blank" rel="noopener">{url + "/ping"}</a>. If it shows <code>"ok":true</code>, press <b>Retry</b> below (and choose <b>Allow</b> if the browser asks about apps on this device).</li>
    <li>If that page cannot be reached, FinCom and the bridge are on different computers: open FinCom (the downloaded file) inside the server session where TallyPrime runs.</li>
  </ol><div className="row" style={{ marginTop: 8 }}><Act act="bridgeTest" className="btn small primary">Retry</Act></div></div>;
}

function SetupSteps() {
  const st = Bridge.st, connected = Bridge.on() && Bridge.up();
  const Step = ({ n, done, title, children }) => <li className={done ? "done" : ""}><b>{(done ? "✔ " : n + ". ") + title}</b>{children && <div>{children}</div>}</li>;
  return <div className="setupcard"><h3 style={{ margin: "0 0 6px" }}>Set up in three steps</h3><ol className="setup">
    <Step n={1} done={connected} title="Put the bridge on the Tally computer">Press <Act act="bridgeSetupFile">Download the bridge setup</Act> and run the file there (double-click, press <b>I</b>). It installs itself, starts, and starts again at every sign-in. No admin rights needed.</Step>
    {S.bridgeSha && <li className="note" style={{ listStyle: "none", fontSize: 12 }}>Fingerprint (SHA-256) of the file just saved: <code style={{ userSelect: "all", wordBreak: "break-all" }}>{S.bridgeSha}</code>. It must match the one published by FinCom before you run it.</li>}
    <Step n={2} done={connected && st.tallyUp} title="Open TallyPrime and your company">In TallyPrime: F1 Help → Settings → Connectivity → <b>TallyPrime acts as: Both</b>. Each user's Tally needs its own port (9000, 9001, …).</Step>
    <Step n={3} done={connected} title="Press Connect here">Press <Act act="bridgeConnect" className="btn small primary">Connect</Act> and type the 6-digit code shown in the bridge window. The code works once, for 15 minutes after the bridge starts; no other web page can connect.</Step>
  </ol></div>;
}

// the Tallys the bridge found: whose, the companies open, the client each is, and which one to use
function Sessions({ c, st }) {
  if (!st.sessions.length) return <p className="note">No TallyPrime found. Start TallyPrime in this Windows session.</p>;
  const cos = sortedCompanies();
  return <table className="data"><thead><tr><th>Tally</th><th>Owner</th><th>Companies open</th><th>FinCom client</th><th></th></tr></thead><tbody>
    {st.sessions.filter((se) => se.ok || se.skipped || num(c.port) === se.port || st.mode !== "fallback").map((se) => {
      const pinned = num(c.port) === se.port;
      return <tr key={se.port}><td>{"Port " + se.port}</td>
        <td>{se.skipped ? <span className="tag no">Another user — not used</span> : se.mine === true ? <span className="tag ok">Your session</span> : <span className="tag warn">Not checked</span>}</td>
        <td>{se.skipped ? <span className="note">hidden</span> : !se.ok ? <span className="note">{se.error ? "not answering" : "—"}</span> : se.companies.length ? se.companies.map((o, i) => <span key={i}>{i > 0 && <br />}<b>{o.name}</b></span>) : <span className="note">no company open</span>}</td>
        <td>{se.skipped || !se.ok ? null : se.companies.map((o, i) => { const cl = Bridge.clientFor(o.name);
          return <span key={i}>{i > 0 && <br />}{cl ? cl.name : <select aria-label={"Client for " + o.name} value="" onChange={(ev) => bridgeLink(o.name, ev.target.value)}><option value="">Link to a client…</option>{cos.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</span>; })}</td>
        <td>{se.skipped ? null : pinned ? <><span className="tag ok">In use</span> <button className="linkbtn" onClick={() => bridgePin(0)}>Automatic</button></> : se.ok ? <button className="btn small" onClick={() => bridgePin(se.port)}>Use this Tally</button> : null}</td></tr>;
    })}</tbody></table>;
}

// review of 01-Oct-2026: the last lines of the bridge's own log (tds-bridge.log), to read here or copy for support,
// without looking for the file on the Tally computer. Needs bridge 1.14.9 (its /logtail)
function BridgeLog() {
  const [lg, setLg] = useState(null);
  const load = () => { setLg({ busy: true }); Bridge.call("/logtail?n=200", null, 20000).then((j) => setLg({ file: j.file || "", lines: j.lines || [] }),
    (e) => setLg({ error: /unknown|not found|404/i.test(String((e && e.message) || "")) ? "This bridge cannot show its log yet: install bridge 1.14.9 or later (Download the bridge setup)." : ((e && e.message) || String(e)) })); };
  const text = lg && lg.lines ? lg.lines.join("\n") : "";
  const copy = () => (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Log copied."), () => toast("Could not copy; select the text and copy it."));
  return <div className="bridge-log" style={{ marginTop: 10 }}>
    <div className="row" style={{ gap: 8, alignItems: "center" }}><button className="linkbtn" data-act="bridgeLog" onClick={load} disabled={!!(lg && lg.busy)}>{lg && lg.lines ? "Show bridge log again" : "Show bridge log"}</button>
      {lg && lg.lines && <><button className="btn small" onClick={copy}>Copy</button><button className="linkbtn" onClick={() => setLg(null)}>Hide</button></>}</div>
    {lg && lg.busy && <p className="note">Reading the log…</p>}
    {lg && lg.error && <p className="bk-warn">{lg.error}</p>}
    {lg && lg.lines && <><p className="note" style={{ margin: "6px 0 4px" }}>{"The last " + lg.lines.length + " lines of " + (lg.file || "tds-bridge.log") + ", newest at the bottom."}</p>
      <pre className="bridge-log-text" style={{ maxHeight: 320, overflow: "auto", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--bg-soft, rgba(127,127,127,.08))", padding: 8, borderRadius: 6, margin: 0 }}>{text || "(the log is empty)"}</pre></>}
  </div>;
}

export function BridgeSettings() {
  const c = Bridge.cfg(), st = Bridge.st;
  if (Bridge.blocked()) return <div className="pane"><h2>Tally Bridge</h2><p className="note" style={{ margin: 0 }}>Pages opened on claude.ai cannot reach programs on your computer. To connect to Tally, use the downloaded app (<b>Download standalone app</b>) on the computer where TallyPrime runs.</p></div>;
  const MODE = { auto: "The bridge finds the TallyPrime running in your Windows session" + (st.user ? " (" + st.user + ")" : "") + " and ignores other users’ Tally.", config: "The bridge uses the Tally ports listed in its settings file.", fallback: "Windows did not tell the bridge which Tally is yours: choose it below." };
  return <>
    {/* the Windows app that keeps the bridge running, shows what it does, updates it and sends its log to support */}
    <div className="pane cn-card"><h2>FinCom Connector for Windows <span className="tag">recommended</span></h2>
      <p className="note" style={{ margin: "0 0 10px" }}>One program on the computer with Tally: it installs the bridge, starts with Windows, keeps the bridge running (and starts it again if it stops), shows Tally, the companies kept in step and the cloud copy, checks the computer and says what to do in plain words, updates itself, and sends its log to FinCom support in one click. No admin rights needed.</p>
      <div className="row"><a className="btn primary" href={"assets/connector/FinComConnector.exe?v=" + Date.now()} download="FinComConnector.exe">Download FinCom Connector</a>
        <span className="note" style={{ alignSelf: "center" }}>Windows 10 or 11. Until the program is signed, Windows may say “Windows protected your PC”: press More info, then Run anyway.</span></div></div>
    <div className="pane"><h2>Tally Bridge</h2><p className="note" style={{ margin: "0 0 12px" }}>Connects FinCom to TallyPrime on this computer: the company open in Tally is followed, ledgers load straight from Tally, and entries are posted without files. Run <b>TDSBridge</b> on the computer where TallyPrime runs, then paste its key here.</p>
      <div className="grid"><label className="f"><span>Bridge address</span><CommitBox data-bridge="url" aria-label="Bridge address" value={c.url} onCommit={(v) => bridgeSet("url", v)} /></label>
        <label className="f"><span>Bridge key (filled in by Connect)</span><CommitBox data-bridge="key" data-fk="bridgekey" aria-label="Bridge key" value={c.key} autoComplete="off" placeholder="press Connect below" onCommit={(v) => bridgeSet("key", v)} /></label></div>
      <label className="chk" style={{ marginTop: 8 }}><input type="checkbox" checked={!!c.follow} onChange={(ev) => bridgeSet("follow", ev.target.checked)} /> Follow the company open in Tally (switch FinCom to it automatically)</label>
      <div className="row" style={{ marginTop: 10 }}><Act act="bridgeTest" className="btn small primary">{c.key ? "Check connection" : "Connect"}</Act>{c.key && <Act act="bridgeOff">Disconnect</Act>}<Act act="bridgeSetupFile">Download the bridge setup</Act></div>
      {!(Bridge.on() && Bridge.up()) && <SetupSteps />}
      {c.key && <div style={{ marginTop: 12 }}>{st.state === "ok" ? <>
        <p className="note" style={{ margin: "0 0 6px" }}>{"Bridge " + (st.version || "") + " connected" + (st.allowImport === false ? " (posting switched off in the bridge)" : "") + ". Checked " + fmtTime(st.at) + "."}</p>
        <p className="note" style={{ margin: "0 0 6px" }}>{MODE[st.mode] || ""}</p>
        {(st.clash || []).length > 0 && <p className="bk-warn">{st.clash.join(", ") + " is open in more than one Tally. Choose yours with "}<b>Use this Tally</b>; until then nothing is read or posted for it.</p>}
        <Sessions c={c} st={st} />
        {num(c.port) && !st.sessions.some((se) => se.port === num(c.port)) ? <p className="bk-warn">{"The chosen Tally (port " + num(c.port) + ") is not running. "}<button className="linkbtn" onClick={() => bridgePin(0)}>Go back to automatic</button></p> : null}
        <Diagnosis />
        <BridgeLog />
        {st.tallyUp || (Bridge.diag && (Bridge.diag.findings || []).length) ? null : <p className="bk-warn">TallyPrime is not answering. In TallyPrime: F1 Help → Settings → Connectivity → set “TallyPrime acts as” to Both, port 9000.</p>}
      </> : <><p className="bk-warn">{st.error || "Not checked yet."}</p>{st.state === "down" && <DownHelp c={c} />}</>}</div>}
    </div>
  </>;
}

const when = (s) => s ? fmtDateTime(s) : "never";

// the books in FinCom's cloud: the computers that send, and which client each Tally company is
export function CloudBooks() {
  const p = TCloud.pane;
  if (!TCloud.on()) return <div className="pane"><p className="note">Sign in to the firm account to keep the books in FinCom’s cloud.</p></div>;
  // read again when opened after a minute, so a link made elsewhere (another computer, the auto-link) shows
  if (!p.busy && !p.err && (p.devices === null || Date.now() - (p.at || 0) > 60000)) { p.at = Date.now(); setTimeout(() => TCloud.refreshPane(), 0); }
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((a, c) => a.name.localeCompare(c.name));
  const dv = (p.devices || []).filter((d) => !d.revoked), cl = p.companies || [];
  return <>
    <div className="pane"><h2>Books in FinCom’s cloud <TallyPill /></h2><p className="note" style={{ margin: "0 0 12px" }}>The bridge on each connected computer sends the books of the Tally companies it keeps in step. Then Look up, Reports and the books open on any computer or phone, even with Tally closed, and a trial balance or ledger for any date comes back in a moment. Kept in India, for your firm only.</p>
      {p.err && <p className="note bad">{p.err}</p>}{p.busy && <p className="note">{p.busy}</p>}
      <p className="note">The computer with Tally and the bridge sends by itself once someone signs in to FinCom there. Nothing to press.</p>
      {TCloud.autoErr && <p className="note bad">{"Last try: " + TCloud.autoErr}</p>}<div className="row"><button className="btn small" onClick={() => TCloud.refreshPane()}>Refresh</button></div></div>
    <div className="pane"><h3 style={{ marginTop: 0 }}>Computers that send</h3>{dv.length ? <div className="tblwrap"><table className="data"><thead><tr><th>Computer</th><th>Last heard from</th><th>Bridge</th><th></th></tr></thead><tbody>
      {dv.map((d) => <tr key={d.id}><td>{d.name}{(d.info || {}).computer && <div className="nr">{d.info.computer + (d.info.user ? " · " + d.info.user : "")}</div>}</td><td>{when(d.last_seen)}</td><td>{d.version || "—"}</td>
        <td className="n"><button className="btn small" onClick={() => TCloud.revoke(d.id, d.name)}>Remove</button></td></tr>)}</tbody></table></div>
      : <p className="note">None yet. Open FinCom on the computer with Tally, signed in to the firm, and it connects by itself within a minute.</p>}</div>
    <div className="pane"><h3 style={{ marginTop: 0 }}>Tally companies and clients</h3><p className="note" style={{ margin: "0 0 8px" }}>A company named in Tally as a client’s “Tally name”, or with exactly one client’s GSTIN, is linked by itself. Link the others here. A company whose GSTIN is not the client’s cannot be linked, so no one’s books land in the wrong client.</p>
      {cl.length ? <div className="tblwrap"><table className="data"><thead><tr><th>Company in Tally</th><th>GSTIN</th><th>Client in FinCom</th><th>Last seen</th></tr></thead><tbody>
        {cl.map((c) => {
          const cid = String(c.client_id || ""), linked = cid && cos.find((k) => String(k.id) === cid), m = !cid && gstinMatch(c);
          return <tr key={c.company}><td>{c.company}</td><td>{c.gstin || "—"}</td><td>
            <select aria-label={"Client for " + c.company} value={cid} onChange={(ev) => TCloud.link(c.company, ev.target.value)}><option value="">— not linked —</option>
              {cid && !linked && <option value={cid}>a client not on this computer</option>}
              {cos.map((k) => <option key={k.id} value={String(k.id)}>{k.name}</option>)}</select>
            {cid ? <div className="nr">{linked ? <>✓ Linked to <b>{linked.name}</b>{gstinMatch(c) && String(gstinMatch(c).id) === cid ? " (same GSTIN)" : ""}
                {S.account && S.account.me && S.account.me.role === "owner" && <> · <button className="linkbtn" data-act="reparse" title="FinCom's cloud reads the day books it keeps again: the party's GSTIN, place of supply, HSN, rate and bill-wise details"
                  onClick={() => TCloud.reparse(cid)}>Read the kept day books again</button>
                  {(() => { const r = (p.rp || {})[cid], jb = r && r.job ? (TCloud.jobs[cid] || []).find((x) => x.id === r.job) : null;
                    // fast-sync: read again by the server's queue; the line follows the job
                    if (r && r.job) return <span className={"note" + (jb && jb.status === "failed" ? " bad" : "")} data-rp={cid}>{" · " + (jb ? TCloud.jobLine(jb) : "handed to FinCom’s server (" + r.months + " months)…")}</span>;
                    return r ? <span className={"note" + (r.err ? " bad" : "")} data-rp={cid}>{" · " + (r.err ? "Could not read again: " + r.err + (r.n ? " (" + r.n + " days done)" : "") : r.busy ? "reading again… " + r.n + " days so far" : "read again: " + Number(r.n || 0).toLocaleString("en-IN") + " day" + (Number(r.n) === 1 ? "" : "s") + " of " + Number(r.months || 0) + " month" + (Number(r.months) === 1 ? "" : "s") + ", " + fmtTime(r.at) + (r.bad ? ", " + r.bad + " could not be read" : "") + (r.host ? " (cloud " + r.host + ")" : ""))}</span> : null; })()}</>}
                <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn small" onClick={() => TCloud.sendLedgers(cid)} title="The Tally computer reads every ledger and group now and sends them (bridge 1.14.8 or later; Tally open there)">Send ledgers and groups now</button>
                  {(() => { const g = (p.gs || {})[cid]; return g ? (g.err ? <span className="note bad">{g.err}</span> : g.none ? <span className="note">No books in the cloud yet.</span>
                    : <span className="note">{"In the cloud: " + g.groups + " groups · " + g.grouped + " of " + g.ledgers + " ledgers with a group" + (g.pl ? " (and Profit & Loss A/c, which has no group in Tally)" : "")} <button className="linkbtn" onClick={() => TCloud.groupStatus(cid)}>check again</button></span>)
                    : <button className="linkbtn" onClick={() => TCloud.groupStatus(cid)}>What is in the cloud?</button>; })()}
                </div></> : "Linked to a client that is not on this computer."}</div>
              : m ? <div className="nr">Same GSTIN as <b>{m.name}</b> <button className="btn small" onClick={() => TCloud.link(c.company, m.id)}>Link to {m.name}</button></div> : null}</td><td>{when(c.last_seen)}</td></tr>;
        })}</tbody></table></div>
        : <p className="note">No Tally companies have been seen yet. They appear here once a connected computer has a company open in Tally.</p>}</div>
  </>;
}

// the Tally page in the sidebar: the bridge, then everything sent to Tally
export default function TallyHome() {
  return <><section className="today"><h2>Tally</h2></section><BridgeSettings /><PostLog /></>;
}
