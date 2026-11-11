// One part of the page that fails to draw shows a short note instead, and the rest of the page keeps working.
// The error goes to the browser console (and to Help → support, which reads the console log), and on the staging build
// to Sentry, scrubbed (src/sentry.js sets window.__fincomReport; docs/sentry.md).
import { Component } from "react";
import { staleReload } from "./staleChunk.js";
import { canGoBack, goBack } from "./parts/back.jsx";

export default class Guard extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    // a screen's file a publish replaced (React.lazy): FinCom reloads once (src/staleChunk.js)
    if (staleReload(error)) return;
    console.error("[FinCom] " + (this.props.name || "a part of the page") + " could not be drawn:", error, info && info.componentStack);
    if (typeof window.__fincomReport === "function") window.__fincomReport(error, this.props.name || "a part of the page");
  }
  // the next redraw tries again (the state it failed on may have changed)
  componentDidUpdate(prev) { if (this.state.error && prev.v !== this.props.v) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    // in plain words (spec K4); the raw error only behind "details"
    const raw = String(this.state.error.message || this.state.error);
    // the owner, 11-Nov-2026: the box has its way out: "← Back" to the page before (parts/back.jsx) and Reload
    const back = () => { this.setState({ error: null }); goBack(); };
    return this.props.quiet ? null : <div className="note" data-guard=""><p style={{ margin: "0 0 8px" }}>This part of the page could not be shown. Reload the page; if it stays, tell support.{" "}
      <details style={{ display: "inline" }}><summary className="linkbtn" style={{ display: "inline" }}>details</summary><span className="note">{raw}</span></details></p>
      <div className="row" style={{ gap: 8 }}>{canGoBack() && <button type="button" className="btn small" data-guard-back="" onClick={back}>← Back</button>}
        <button type="button" className="btn small" data-guard-reload="" onClick={() => { try { location.reload(); } catch (e) { /* */ } }}>Reload</button></div></div>;
  }
}
