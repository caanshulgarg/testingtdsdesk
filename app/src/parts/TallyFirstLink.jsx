// Connect this computer: the first-time Tally connection in one place (24-Oct-2026, next-tally-firstlink; the owner:
// "Tally link is still a big problem when linking first time.. don't know how to get code.. how to link.. that is main
// problem now"). Before this, Connect Tally's step 1 said "Install" only; the 6-digit code was typed under Help & support ›
// This computer (behind a "Connect" that only re-checked), and nothing showed while FinCom waited for the bridge.
// Now, until FinCom's cloud hears a bridge, step 1 is this panel, drawn under the three steps:
//   1. Download      the one button (the setup asks nothing but "Just for me", the default)
//   2. Open it       FinCom looks for the bridge on THIS computer by itself (only /ping on 127.0.0.1:9100-9199; nothing
//                    secret is sent) and says what it finds: waiting / another Windows user's / an older bridge / found
//   3. Type the code the bridge shows (right-click its icon › Connect FinCom on this computer…): one big box, checked HERE
//                    against the bridge's proof before it is sent (Bridge.pair), so a wrong code never uses up one of the
//                    bridge's five tries; six digits connect by themselves (no button)
// Then: "Connected to FinCom Bridge on NWS144 (anshul). Linking it to <firm>…" — the computer key is made at once
// (TCloud.auto, which otherwise waits for its next minute) and the computers are read again every 5 seconds until the
// cloud hears it; step 1 ticks and the guide goes on to step 2 (Tally open) and step 3 (Add as client).
// A bridge that opens FinCom with its code in the address (#pair=123456, src/js/49) skips step 3 entirely.
// Nothing new is asked of the bridge or of Tally: the same /ping, /pair, /cloudlink and RPCs as before.
import { useEffect, useState } from "react";
import "./tallyFirstLink.css";

const SCAN_MS = 5000, LINK_MS = 5000, SLOW_LINK_MS = 120000;
// the watcher: one for the page (module state, drawn with render())
export const FL = { st: "waiting", found: null, other: null, old: null, code: "", msg: "", busy: false, pairedAt: 0, scanAt: 0, err: "", tries: 0 };
const FRESH = { ...FL };
// for support and the tests (tests/run_tally_firstlink.py): the watcher's state, and a fresh start
if (typeof window !== "undefined") window.FCFirstLink = { FL, reset() { Object.keys(FL).forEach((k) => { delete FL[k]; }); Object.assign(FL, FRESH); } };
const say = (p) => { Object.assign(FL, p); if (typeof render === "function") render(); };
// migration 104 (run on staging 24-Oct-2026): each state the panel reaches, once per change, to tally_connect_step, so the
// owner sees where a first connection stops (none of this was ever seen by the cloud before). Never the code or a key;
// a refusal or an older cloud is ignored (the panel works the same without it)
export function logStep(step, version, detail, again) {
  const k = step + (again ? "#" + again : "");
  if (FL.logged === k) return;
  FL.logged = k;
  try {
    if (typeof TCloud !== "object" || !TCloud.on()) return;
    const v = /^\d+\.\d+\.\d+$/.test(String(version || "")) ? String(version) : null;
    Promise.resolve(TCloud.rpc("tally_connect_step", { p_step: step, p_version: v, p_detail: detail ? String(detail).slice(0, 300) : null })).catch(() => {});
  } catch (e) { /* never in the way */ }
}
const pcWords = (b) => (b && b.computer ? b.computer + (b.user ? " (" + String(b.user).split("\\").pop() + ")" : "") : "this computer");

// /ping on every port of this user's range at once (nothing secret is sent): mine (with its proof window), another
// Windows user's, or an older bridge that cannot prove itself
async function scan() {
  if (typeof Bridge !== "object") return;
  if (Bridge.blocked()) return say({ st: "blocked" });
  if (FL.busy || FL.st === "pairing") return;
  if (Bridge.on() && (FL.st === "linking" || FL.st === "error")) return;
  if (Bridge.on() && await Bridge.ensureProven()) return afterPair();
  const all = (await Promise.all(Bridge.PORTS.map((p) => Bridge.probe(p, 1500)))).filter(Boolean);
  FL.scanAt = Date.now();
  const mine = all.find((b) => b.yours !== false && b.bridgeId), other = all.find((b) => b.yours === false), old = all.find((b) => b.yours !== false && !b.bridgeId);
  if (FL.st === "pairing") return;
  if (mine) { say({ st: "code", found: mine, windowOpen: !!mine.pairProof }); logStep("found", mine.version); }
  else if (other) { say({ st: "other", other, found: null }); logStep("other_user", other.version); }
  else if (old) { say({ st: "old", old, found: null }); logStep("old_bridge", old.version); }
  else { say({ st: "waiting", found: null }); logStep("waiting"); }
}

// the six digits: checked against the bridge's proof here first (Bridge.pair sends nothing to a bridge that does not
// prove it shows this code), then the key is kept and the firm link starts
export async function submitCode(raw) {
  const code = String(raw || "").replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6 || FL.busy) return;
  const was = FL.found;
  say({ busy: true, st: "pairing", msg: "", tries: FL.tries + 1 });
  try {
    await Bridge.pair(code);
    Bridge.lastOpenKey = null;
    say({ busy: false, code: "" });
    await afterPair();
  } catch (e) {
    const closed = was && !was.pairProof;
    const m = e && e.code === "pair" && !(e.message || "").includes("another Windows user")
      ? (closed ? "The code has run out. Right-click the FinCom icon near the clock › Connect FinCom on this computer… again: it shows a new code for 10 minutes."
        : "That is not the code in the FinCom Bridge box. Nothing was sent: check the six digits, or choose Connect FinCom on this computer… again for a new code.")
      : ((e && e.message) || String(e));
    say({ busy: false, st: was ? "code" : "waiting", msg: m, code: "" });
    logStep(e && e.code === "pair" && closed ? "code_ran_out" : "wrong_code", was && was.version, e && e.code !== "pair" ? (e.message || "") : "", FL.tries);
  }
}

// paired: the bridge's status (Tally found, companies open), then the firm's computer key at once
async function afterPair() {
  if (!FL.pairedAt) FL.pairedAt = Date.now();
  say({ st: "linking", msg: "" });
  logStep("paired", (Bridge.st && Bridge.st.version) || (FL.found && FL.found.version));
  try { await Bridge.refresh(); } catch (e) { /* the line below says so */ }
  if (typeof startBridgePolling === "function") startBridgePolling();
  await linkFirm();
}
export async function linkFirm() {
  if (typeof TCloud !== "object") return;
  TCloud.autoAt = 0; TCloud.autoErr = "";
  try { await TCloud.auto(); } catch (e) { TCloud.autoErr = (e && e.message) || String(e); }
  if (TCloud.autoErr) { say({ st: "error", err: TCloud.autoErr }); logStep("link_failed", Bridge.st && Bridge.st.version, TCloud.autoErr); }
  try { await TCloud.refreshPane(); } catch (e) { /* read again in 5 seconds */ }
  if (typeof render === "function") render();
}

function useWatch(linked) {
  useEffect(() => {
    if (linked) return undefined;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        if (FL.st === "linking") { await TCloud.refreshPane(); if ((TCloud.pane.devices || []).length) logStep("linked", Bridge.st && Bridge.st.version); if (!(TCloud.pane.devices || []).length && Date.now() - (TCloud.lastAutoKick || 0) > 30000) { TCloud.lastAutoKick = Date.now(); await linkFirm(); } if (typeof render === "function") render(); }
        else await scan();
      } catch (e) { /* the next tick */ }
      if (!stop) t = setTimeout(tick, FL.st === "linking" ? LINK_MS : SCAN_MS);
    };
    let t = setTimeout(tick, 50);
    return () => { stop = true; clearTimeout(t); };
  }, [linked]);
}

// the FinCom icon's menu as it looks near the clock, with the line to choose marked
function TrayPicture() {
  return <div className="fl-tray" data-fl-tray="" aria-label="The FinCom Bridge icon's menu near the clock: Connect FinCom on this computer…">
    <div className="fl-menu" role="presentation">
      <span>Open FinCom</span><span>Test connection</span><span>Show log</span><i />
      <span>Status…</span><span className="fl-pick">Connect FinCom on this computer…</span><span>Pause background reading</span>
    </div>
    <div className="fl-bar"><span className="fl-caret" title="Show hidden icons">^</span><span className="fl-icon" aria-hidden="true">F</span></div>
  </div>;
}

function CodeBox() {
  const [v, setV] = useState("");
  const set = (x) => { const d = String(x || "").replace(/\D/g, "").slice(0, 6); setV(d); if (d.length === 6) { setV(""); submitCode(d); } };
  return <div className="fl-codebox">
    <label className="fl-codelabel" htmlFor="flCode">The 6 digits from the FinCom Bridge box</label>
    <input id="flCode" data-fl-code="" className="fl-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="••••••" value={v}
      disabled={FL.busy} aria-describedby="flCodeSay" onChange={(e) => set(e.target.value)} onPaste={(e) => { e.preventDefault(); set((e.clipboardData || window.clipboardData).getData("text")); }} />
    <p id="flCodeSay" className="note" style={{ margin: "6px 0 0" }}>{FL.busy ? "Checking the code with FinCom Bridge…" : "It connects by itself after the sixth digit. The code is checked here first, so a wrong one does no harm."}</p>
    {FL.msg && <p className="bk-warn fl-msg" data-fl-code-msg="" role="alert">{FL.msg}</p>}
  </div>;
}

const HELP = [
  ["same-pc", "FinCom must be open on the computer where FinCom Bridge runs.", "Connecting is done once, in a browser on the Tally computer (inside the Remote Desktop window if Tally is on a server). After that, every other computer and phone works through FinCom’s cloud."],
  ["user", "Signed in to Windows as someone else?", "The bridge works for the Windows user who installed it. Run the setup while signed in as the person who uses Tally (it installs “Just for me”, no administrator needed)."],
  ["browser", "Your browser asked to “look for devices” or “apps on this device”?", "Choose Allow: that is how FinCom finds the bridge on this computer. Chosen Block by mistake: click the icon left of the address and allow it again."],
  ["icon", "No FinCom icon near the clock?", "Click the ^ arrow near the clock; drag the FinCom icon onto the taskbar. Still none: open the Start menu, type FinCom Bridge and open it."],
];
function Help() {
  return <details className="fl-help" data-fl-help=""><summary>Not found? What to check</summary>
    <ul>{HELP.map(([k, t, d]) => <li key={k} data-fl-fix={k}><b>{t}</b> {d}</li>)}</ul></details>;
}

function Sub({ k, n, title, done, now, children }) {
  return <li data-fl-step={k} data-done={done ? "" : undefined} className={"fl-sub" + (done ? " done" : now ? " now" : "")}>
    <span className="fl-n" aria-hidden="true">{done ? "✓" : n}</span><div className="fl-sb"><b>{title}</b>{children}</div></li>;
}

// the panel: drawn by Connect Tally (screens/Tally.jsx) while no bridge of the firm is heard; linked: the cloud heard one
export default function ConnectThisComputer({ download, linked = false }) {
  useWatch(linked);
  const st = FL.st, b = FL.found || {}, firm = (typeof S === "object" && S.firm && S.firm.firmName) || "your firm";
  const seen = st === "code" || st === "pairing" || st === "linking" || st === "error";
  const status = st === "blocked" ? ["bad", "Pages opened inside claude.ai cannot reach programs on this computer. Open FinCom in Chrome or Edge on the Tally computer."]
    : st === "waiting" ? ["wait", "Waiting for FinCom Bridge on this computer…"]
    : st === "other" ? ["bad", "FinCom Bridge here belongs to another Windows user" + (FL.other && FL.other.user ? " (" + FL.other.user + ")" : "") + ". Install it for yourself: run the setup while signed in to Windows as you (“Just for me”)."]
    : st === "old" ? ["bad", "An older FinCom Bridge" + (FL.old && FL.old.version ? " (" + FL.old.version + ")" : "") + " is running here. Download the new one and open it: it takes over by itself, keeping everything."]
    : st === "code" ? ["ok", "Found FinCom Bridge" + (b.version ? " " + b.version : "") + " on this computer. Now type its code."]
    : st === "pairing" ? ["wait", "Checking the code…"]
    : st === "linking" ? ["ok", "✓ Connected to FinCom Bridge on " + pcWords(Bridge.st && Bridge.st.computer ? { computer: Bridge.st.computer, user: Bridge.st.user } : b) + ". Linking it to " + firm + "…" + tallyWords()]
    : st === "error" ? ["bad", "Connected to the bridge, but linking it to " + firm + " did not work: " + (FL.err || "no answer") + "."] : ["wait", ""];
  const slow = st === "linking" && FL.pairedAt && Date.now() - FL.pairedAt > SLOW_LINK_MS;
  return <div className="fl" data-firstlink={st}>
    <h4 className="fl-h">Connect this computer</h4>
    <ol className="fl-steps">
      <Sub k="download" n={1} title="Download FinCom Bridge" done={seen} now={!seen}>
        <div className="fl-row">{download}</div>
        <span className="note">On the computer where TallyPrime runs. Windows says “Windows protected your PC”? Press More info, then Run anyway.</span>
      </Sub>
      <Sub k="open" n={2} title="Open it and press Next until Finish" done={seen} now={!seen}>
        <span className="note">It asks nothing else: “Just for me” is right. An icon appears near the clock and FinCom finds it here by itself.</span>
      </Sub>
      <Sub k="code" n={3} title="Type its code here" done={st === "linking"} now={st === "code" || st === "pairing"}>
        {st === "code" || st === "pairing" ? <div className="fl-codewrap">
          <div className="fl-where"><p className="tc3-p"><b>Right-click the FinCom icon near the clock</b> (click ^ if you do not see it) and choose <b>Connect FinCom on this computer…</b> A box shows six digits.</p><TrayPicture /></div>
          <CodeBox /></div>
          : st === "linking" ? <span className="note">Done.</span> : <span className="note">After step 2: FinCom asks for it as soon as it finds the bridge.</span>}
      </Sub>
    </ol>
    {status[1] && <p className={"fl-status " + status[0]} data-fl-status={st} role="status" aria-live="polite">{status[0] === "wait" && <span className="fl-spin" aria-hidden="true" />}{status[1]}</p>}
    {st === "error" && <button className="btn small primary" data-fl-retry="" onClick={() => { say({ st: "linking", err: "" }); linkFirm(); }}>Try again</button>}
    {slow && <p className="note" data-fl-slow="">Still linking after 2 minutes? FinCom Bridge needs to reach FinCom’s cloud over the internet. If your office network blocks websites, ask the person who looks after it to allow FinCom; then right-click the FinCom icon › Test connection.</p>}
    {(st === "waiting" || st === "other" || st === "old" || st === "blocked") && <Help />}
  </div>;
}

// the bridge on this computer, from its own status (it asks Tally only whether it is open)
function tallyWords() {
  const st = typeof Bridge === "object" ? Bridge.st : null;
  if (!st || st.state !== "ok") return "";
  if (!st.tallyUp) return " Tally is not open on this computer yet.";
  const n = (st.open || []).length;
  return " Tally found · " + n + (n === 1 ? " company" : " companies") + " open.";
}

// step 2, from the bridge on this computer (the cloud's view comes a beat later): "Tally found · 2 companies open"
export function LocalTally() {
  const st = typeof Bridge === "object" && Bridge.on() ? Bridge.st : null;
  if (!st || st.state !== "ok") return null;
  const n = (st.open || []).length;
  return <p className={"tc3-p fl-local " + (st.tallyUp && n ? "ok" : "bad")} data-fl-local={st.tallyUp ? n : "down"}>
    {st.tallyUp ? (n ? "On this computer: Tally found · " + n + (n === 1 ? " company" : " companies") + " open. " + (n ? "They show in the list below within a minute." : "")
      : "On this computer: Tally found, but no company is open. Open your company in TallyPrime.")
      : "On this computer: Tally is not answering. Open TallyPrime and your company. Still not found: in TallyPrime press F1 (Help) → Settings → Connectivity and set “TallyPrime acts as” to Both."}</p>;
}
