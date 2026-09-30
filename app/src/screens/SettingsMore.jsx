// Settings sections for how the work is done: TDS rates and limits for all clients, reading bills (the self-test, the
// reading check, keys, the reading order), and, in Client setup, closed periods. Was viewRates, viewReading (src/js/18),
// viewSelfTest (src/js/01) and ClosedP.pane (src/js/47). Buttons are doAct cases (resetRules, runSelfTest, copyDiag,
// testOcr, testGoogle, testReader, askPerm, dlStandalone); boxes go through rateSet, readingToggle and closedSet
// (src/js/18, 27, 47). How to fix Google OCR is still googleHelpHtml, an old piece of fixed help text.
import Legacy from "../parts/Legacy.jsx";
import CommitBox from "../parts/CommitBox.jsx";

const Act = ({ act, className = "btn small", children, disabled }) => <button className={className} disabled={disabled} onClick={() => doAct(act)}>{children}</button>;
const Tag = ({ c, children }) => <span className={"tag " + c}>{children}</span>;

// TDS rates and limits for all clients
export function Rates() {
  const box = (r, k, label, step) => <td className="n"><CommitBox type="number" step={step} aria-label={label + ": " + r.label} value={r[k]} onCommit={(v) => rateSet(r.id, k, v)} />{k === "limit" && <div className="note">{({ annual: "per year", single_or_annual: "per year", monthly: "per month", excess: "per year, TDS on excess" })[r.basis]}</div>}</td>;
  const none = <td className="n">—</td>;
  return <div className="pane"><h2>Rates and limits for all clients</h2><p className="note" style={{ margin: "0 0 12px" }}>Set for tax year 2026-27 under section 393 of the Income-tax Act, 2025. Check them against the Act and any Finance Act changes before relying on them. Ledger names are set per client in Client setup → TDS.</p>
    <div className="tblwrap"><table className="data"><thead><tr><th>Payment type</th><th>Section</th><th className="n">Rate: Ind/HUF %</th><th className="n">Rate: others %</th><th className="n">Single bill limit</th><th className="n">Limit</th></tr></thead><tbody>
      {rules().map((r) => <tr key={r.id}><td>{r.label}</td><td>{r.ref}<div className="note">{r.old}</div></td>
        {r.basis === "never" ? <>{none}{none}</> : <>{box(r, "rateInd", "Rate individual", "0.01")}{box(r, "rateOth", "Rate others", "0.01")}</>}
        {r.basis === "single_or_annual" ? box(r, "single", "Single bill limit") : none}
        {r.basis === "never" || r.basis === "always" ? none : box(r, "limit", "Limit")}</tr>)}</tbody></table></div>
    <div className="row" style={{ marginTop: 12 }}><Act act="resetRules">Restore default rates and limits</Act></div>
    <p className="note" style={{ margin: "10px 0 0" }}>Without a PAN the rate is 20%, or 5% for purchase of goods. TDS is worked on the value before GST where GST is shown separately.</p></div>;
}

function SelfTest() {
  const e = envInfo(), sum = selfTestSummary(), r = (S.selfTest && S.selfTest.results) || {};
  const Line = ({ label, res }) => <tr><td><b>{label}</b></td><td>{!res ? (sum.state === "busy" ? <Tag c="no">Testing…</Tag> : <Tag c="no">Not run</Tag>) : res.ok ? <Tag c="ok">Pass</Tag> : <Tag c="bad">Fail</Tag>}</td><td className="note">{res ? res.msg : ""}</td></tr>;
  const Yn = ({ label, v, fix }) => <tr><td>{label}</td><td>{v ? <Tag c="ok">Yes</Tag> : <Tag c="bad">No</Tag>}</td><td className="note">{v ? "" : fix}</td></tr>;
  return <div className="pane" id="selfTestPane"><h2>Self-test</h2>
    <p className="note" style={{ margin: "0 0 10px" }}>Reads two sample bills built into this app (a PDF and a photo) with the free engines only. No cost. Runs by itself when the app opens.</p>
    <div className="tblwrap"><table className="data"><tbody><Line label="Sample PDF (free PDF reading)" res={r.pdf} /><Line label="Sample photo (built-in OCR)" res={r.ocr} /></tbody></table></div>
    <div className="row" style={{ marginTop: 10 }}><Act act="runSelfTest" className="btn" disabled={sum.state === "busy"}>Run self-test again</Act></div>
    <h3 style={{ marginTop: 16 }}>This browser</h3><div className="tblwrap"><table className="data"><tbody>
      <tr><td>Opened</td><td colSpan={2}>{e.where}</td></tr>
      <Yn label="WebAssembly" v={e.wasm} fix="This browser cannot run the OCR. Use a current Chrome or Edge." />
      <Yn label="WebAssembly SIMD" v={e.simd} fix="Needed by the built-in OCR. Update the browser (Chrome 91+, Edge 91+, Firefox 89+, Safari 16.4+)." />
      <Yn label="Gzip support" v={e.gunzip} fix="Needed by the built-in OCR. Update the browser (Chrome 80+, Firefox 113+, Safari 16.4+)." />
      <Yn label="PDF reader loaded" v={e.pdf} fix="Reload the page. If it stays No, download the standalone file again." />
      <Yn label="Built-in OCR inside the file" v={e.ocrBuiltIn} fix="This copy is incomplete. Download the standalone file again." /></tbody></table></div>
    <h3 style={{ marginTop: 16 }}>Diagnostic report</h3><p className="note" style={{ margin: "0 0 6px" }}>If something is still not working, copy this and send it to me.</p>
    <textarea id="diagBox" rows={9} readOnly value={diagnosticReport()} aria-label="Diagnostic report" />
    <div className="row" style={{ marginTop: 6 }}><Act act="copyDiag">Copy report</Act></div></div>;
}

// Reading bills: where the app runs, the self-test, each way of reading and whether it works here, and the order
export function Reading() {
  const cfg = apiSettings(), inClaude = !!window.claude, st = S.readStats;
  const permText = { granted: "allowed", prompt: "not asked yet", denied: "declined for this page load", unavailable: "not available in this view" }[S.samplePerm] || (S.sample ? "available" : "not available in this view");
  const ocrState = { idle: <Tag c="no">Checking…</Tag>, available: <Tag c="ok">Available</Tag>, loading: <Tag c="no">Loading…</Tag>, ready: <Tag c="ok">Working</Tag>, unavailable: <Tag c="bad">Not working</Tag> }[S.ocrState] || null;
  const clState = viaPlatform() ? <Tag c="ok">In your plan</Tag> : S.engine ? (S.readBlocked ? <Tag c="bad">Declined</Tag> : <Tag c="ok">Set up</Tag>) : <Tag c="bad">Not set up</Tag>;
  const Banner = ({ t, busyText }) => !t ? null : <p className="banner" style={Object.assign({ margin: "10px 0 0" }, t.busy ? {} : t.ok ? { borderLeftColor: "var(--ledger)", background: "var(--ledger-soft)" } : { borderLeftColor: "var(--stop)", background: "var(--stop-soft)" })}>{t.busy ? busyText : t.msg}</p>;
  const Row = ({ label, state, detail, btn }) => <tr><td><b>{label}</b></td><td>{state}</td><td className="note">{detail}</td><td>{btn}</td></tr>;
  const gState = inClaude ? <Tag c="no">Standalone only</Tag> : viaPlatform() ? <Tag c="ok">In your plan</Tag> : !hasGoogle() ? <Tag c="no">No key yet</Tag> : (S.googleAuto && !S.googleAuto.ok) || (S.googleLast && !S.googleLast.ok) ? <Tag c="bad">Not working</Tag> : S.googleAuto && S.googleAuto.ok ? <Tag c="ok">Working</Tag> : <Tag c="ok">Set up</Tag>;
  const gDetail = inClaude ? "Blocked inside claude.ai." : viaPlatform() ? "Through your plan: used when the built-in OCR fails its checks; your firm is charged per page."
    : hasGoogle() ? "Used when the built-in OCR fails its checks." + (S.googleAuto ? " Daily check: " + (S.googleAuto.ok ? "working." : "FAILED — " + S.googleAuto.msg) : "") + (S.googleLast && !S.googleLast.ok ? " Last bill: FAILED — " + S.googleLast.msg : "") : "Stronger on photos and handwriting. Add the key in the box below.";
  return <>
    <div className="pane" style={{ marginTop: 0 }}><h2>Settings</h2><p style={{ margin: "4px 0 0" }}>{inClaude ? <>You are using the app <b>inside claude.ai</b>. Here Claude can read bills, but the free OCR and Google OCR may be blocked. For those, download the standalone app below.</>
      : <>You are using the <b>standalone app</b> (this file on your computer or website). Free OCR, Google OCR and your Claude API key all work here.</>}</p>
      <p className="note" style={{ margin: "4px 0 0" }}>{"App version: " + APP_VERSION}</p>
      {inClaude && <div className="row" style={{ marginTop: 10 }}><Act act="dlStandalone" className="btn primary">Download the standalone app</Act><span className="note">About 8 MB. Open it in Chrome or Edge.</span></div>}</div>
    <SelfTest />
    <div className="pane" id="readingPane"><h2>Reading check</h2>
      <p className="note" style={{ margin: "0 0 10px" }}>Press Test on each line to see whether it really works here. Every bill shows a badge: <Tag c="ok">Free</Tag> or <Tag c="ok">Google OCR</Tag> means no Claude cost, <Tag c="stamp">Claude</Tag> means Claude read it.</p>
      <div className="tblwrap"><table className="data"><tbody>
        <Row label="1. Free: PDF text" state={(window.pdfjsLib || window.TDS_ASSETS) ? <Tag c="ok">Working</Tag> : <Tag c="bad">Not loaded</Tag>} detail="Computer-made PDFs are read from their own text. No cost." />
        <Row label="2. Free: built-in OCR" state={ocrState} detail={S.ocrState === "unavailable" ? ocrProblem() + "." : S.ocrKind === "built-in" ? "For photos and scans. Built into this app, works offline." : "For photos and scans."} btn={<Act act="testOcr" disabled={!!(S.ocrTest && S.ocrTest.busy)}>Test</Act>} />
        <Row label="3. Google Cloud Vision OCR" state={gState} detail={gDetail} btn={hasGoogle() ? <Act act="testGoogle" disabled={!!(S.googleTest && S.googleTest.busy)}>Test</Act> : null} />
        <Row label="4. Claude" state={clState} detail={viaPlatform() ? "Through your plan: the platform holds the key and your firm is charged for what it uses." : S.engine === "api" ? "Your Claude API key (" + cfg.model + ")." : S.engine === "claude" ? "Claude inside claude.ai (access: " + permText + ")." : "Used only when steps 1–3 fail the checks."}
          btn={<><Act act="testReader" disabled={!(S.engine && !(S.testResult && S.testResult.busy))}>Test</Act>{(S.samplePerm === "prompt" || S.samplePerm === "denied") && <> <Act act="askPerm">Allow</Act></>}</>} />
      </tbody></table></div>
      <Banner t={S.ocrTest} busyText="Testing built-in OCR…" /><Banner t={S.googleTest} busyText="Testing Google OCR…" /><Legacy html={googleHelpHtml()} /><Banner t={S.testResult} busyText="Testing Claude… it may ask for permission first." />
      <p style={{ margin: "12px 0 0" }}>Bills read since this page opened: <b>{st.free}</b> free · <b>{st.google || 0}</b> by Google OCR · <b>{st.freePlusClaude || 0}</b> free figures + Claude for the supplier name · <b>{st.claudeText}</b> by Claude (text) · <b>{st.claudeImages}</b> by Claude (images).</p></div>
    <div className="pane" id="keysPane"><h2>Keys</h2><p className="note" style={{ margin: 0 }}>No API keys are kept on this computer. Claude and Google OCR are reached through the firm account, which holds the keys on the server; sign in to the firm account to use them. The free built-in OCR works without signing in.</p></div>
    <div className="pane"><h2>Reading order</h2>
      <label className="chk" style={{ margin: "6px 0 10px" }}><input type="checkbox" checked={!!S.askClaudeNewSupplier} onChange={(ev) => readingToggle("askClaudeNew", ev.target.checked)} /> <span><b>Ask Claude for a new supplier's name and payment type</b> when free reading got all the figures (a small text-only call). When off, you confirm them yourself; the app remembers them for that supplier's later bills.</span></label>
      <label className="chk" style={{ margin: "6px 0 4px" }}><input type="checkbox" checked={!!S.freeFirst} onChange={(ev) => readingToggle("freeFirst", ev.target.checked)} /> <span><b>Try free reading first</b> (steps 1–3 above). A result is accepted only when the checks pass: supplier GSTIN check digit, bill number, valid date, taxable value + GST = total, standard GST rate. Otherwise Claude reads the bill.</span></label>
      <p style={{ margin: "8px 0 0" }}>Now: {viaPlatform() ? <b>free steps, then Claude through your plan</b> : S.engine === "api" ? <b>free steps, then your Claude API key</b>
        : S.engine === "claude" ? <><b>free steps, then Claude inside claude.ai</b>{S.imgMax ? "" : " (text PDFs only)"}</>
        : S.freeFirst ? (hasGoogle() ? <><b>built-in OCR, then Google OCR</b>. No Claude: bills that fail the checks go to Type it in</> : <><b>free reading only</b>. Handwritten bills need the Google or Claude key</>)
        : <b>nothing: bills cannot be read here</b>}.</p></div>
  </>;
}

// Client setup, closed periods: the date books are closed up to, the warnings, and the TDS returns filed
export function ClosedPeriods({ co }) {
  const c = ClosedP.cfg(co), b = S.books && S.books.cid === co.id ? S.books : null;
  const gf = b ? Object.values(b.gstFiled || {}).flatMap((recs) => Object.entries(recs || {}).filter(([, r]) => r && (r.r3b || r.r1)).map(([ym]) => ym)) : [];
  const lastGst = gf.sort().pop();
  return <div className="pane"><h2>Closed periods</h2><p className="note" style={{ margin: "0 0 12px" }}>Entries dated in a closed period are not stopped. Before they go to Tally, FinCom says which ones they are and why, and asks. Choosing to post them is recorded in the audit trail.</p>
    <div className="grid"><label className="f"><span>Books closed up to</span><input type="date" aria-label="Books closed up to" value={c.to ? FC.iso(FC.d8(c.to)) : ""} onChange={(ev) => closedSet(co, "to", ev.target.value)} /></label></div>
    <div className="stack" style={{ gap: 6, marginTop: 10 }}><label className="chk"><input type="checkbox" checked={!!c.gst} onChange={(ev) => closedSet(co, "gst", ev.target.checked)} /> Warn for a month whose GSTR-1 or GSTR-3B is marked filed{lastGst && <> <span className="note">{"(the latest marked filed: " + FC.monthLabel(lastGst) + ")"}</span></>}</label>
      <label className="chk"><input type="checkbox" checked={!!c.tds} onChange={(ev) => closedSet(co, "tds", ev.target.checked)} /> Warn for an entry with TDS in a quarter whose TDS return is filed</label></div>
    <h3 style={{ margin: "14px 0 6px", fontSize: 14 }}>TDS returns filed</h3><div className="cp-q">{ClosedP.quarters().map((k) => <label key={k} className="f"><span>{ClosedP.qLabel(k)}</span><input type="date" aria-label={"Filed: " + ClosedP.qLabel(k)} value={(c.tdsFiled || {})[k] || ""} onChange={(ev) => closedSet(co, "q:" + k, ev.target.value)} /></label>)}</div>
    <p className="note" style={{ marginTop: 8 }}>GST months are marked filed under TDS & GST, GST, on the GSTR-3B page or from the portal.</p></div>;
}
