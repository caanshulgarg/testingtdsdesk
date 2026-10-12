// One part of the page that fails to draw shows a short note instead, and the rest of the page keeps working.
// The error goes to the browser console (and to Help → support, which reads the console log), and on the staging build
// to Sentry, scrubbed (src/sentry.js sets window.__fincomReport; docs/sentry.md).
// A "wall" (reliability item 4: each routed screen and each major panel) shows the crash wall's card instead
// (parts/CrashWall.jsx), with Retry. Like every guard it tries again on the next redraw (a passing state heals itself);
// a wall reports the same failure once, not on every redraw. A screen's file that could not be loaded (screens/lazy.js,
// a release meanwhile) shows the card that offers Reload FinCom.
import { Component } from "react";
import CrashWall from "./parts/CrashWall.jsx";

// a screen's file that could not be fetched: marked by screens/lazy.js, or the browser's own words for it
export function isLoadError(e) {
  return !!e && (e.fincomLoad === true || /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|ChunkLoadError/i.test(String(e.message || e)));
}

export default class Guard extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    if (this.props.wall) {
      const sig = String(error && error.message);
      if (sig === this.reported) return;
      this.reported = sig;
    }
    console.error("[FinCom] " + (this.props.name || "a part of the page") + " could not be drawn:", error, info && info.componentStack);
    if (typeof window.__fincomReport === "function") window.__fincomReport(error, this.props.name || "a part of the page");
  }
  // the next redraw tries again (the state it failed on may have changed)
  componentDidUpdate(prev) { if (this.state.error && prev.v !== this.props.v) this.setState({ error: null }); }
  retry = () => this.setState({ error: null });
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.wall) return <CrashWall kind={isLoadError(this.state.error) ? "load" : "crash"} compact={this.props.wall === "panel"} onRetry={this.retry} />;
    // in plain words (spec K4); the raw error only behind "details"
    const raw = String(this.state.error.message || this.state.error);
    return this.props.quiet ? null : <p className="note" data-guard="">This part of the page could not be shown. Reload the page; if it stays, tell support.{" "}
      <details style={{ display: "inline" }}><summary className="linkbtn" style={{ display: "inline" }}>details</summary><span className="note">{raw}</span></details></p>;
  }
}
