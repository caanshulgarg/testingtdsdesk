// One part of the page that fails to draw shows a short note instead, and the rest of the page keeps working.
// The error goes to the browser console (and to Help → support, which reads the console log).
import { Component } from "react";

export default class Guard extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[FinCom] " + (this.props.name || "a part of the page") + " could not be drawn:", error, info && info.componentStack); }
  // the next redraw tries again (the state it failed on may have changed)
  componentDidUpdate(prev) { if (this.state.error && prev.v !== this.props.v) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return this.props.quiet ? null : <p className="note">This part could not be shown ({String(this.state.error.message || this.state.error)}). Reload the page; if it stays, tell support.</p>;
  }
}
