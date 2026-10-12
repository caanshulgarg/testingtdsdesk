// The crash wall (reliability item 4): what a screen or a panel shows in its own place when it fails to draw, so the rest
// of FinCom (the sidebar, the top bar, the other panels) keeps working. Calm, in Arc's look, never the raw error (that
// goes to the console and, on staging, scrubbed to Sentry: Guard.jsx).
//   kind "crash": "This part of FinCom hit a problem. Your work is saved." [Retry] [Go to Today]
//   kind "load":  a screen's file could not be fetched twice in a row (screens/lazy.js already tried once more by itself):
//                 FinCom may have been updated meanwhile. [Reload FinCom] [Go to Today]
import { RotateCcw, CloudOff } from "lucide-react";
import Button from "./Button.jsx";
import css from "./CrashWall.module.css";

function goToday() { try { navHome("today"); } catch (e) { location.reload(); } }

export default function CrashWall({ kind = "crash", compact = false, onRetry }) {
  const load = kind === "load";
  const Icon = load ? CloudOff : RotateCcw;
  return <section className={css.wall + (compact ? " " + css.compact : "")} data-crash-wall={kind} role="alert" aria-live="polite">
    <div className={css.head}>
      <span className={css.icon} aria-hidden="true"><Icon width={18} height={18} strokeWidth={1.75} /></span>
      <div>
        <h2 className={css.title}>{load ? "This part of FinCom could not be loaded." : "This part of FinCom hit a problem. Your work is saved."}</h2>
        <p className={css.text}>{load ? "FinCom may have been updated, or the connection dropped. Your work is saved. Reload FinCom to get the latest version."
          : "Try again, or go to Today and carry on. If it happens again, tell support from Help."}</p>
      </div>
    </div>
    <div className={css.actions}>
      {load ? <Button className="btn primary" onClick={() => location.reload()}>Reload FinCom</Button>
        : <Button className="btn primary" onClick={onRetry}>Retry</Button>}
      <Button className="btn" onClick={goToday}>Go to Today</Button>
    </div>
  </section>;
}
