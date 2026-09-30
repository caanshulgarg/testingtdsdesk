// "How this tab works": the guide for the tab shown (Help in src/js/34), when it has one. The old click handler
// opens the panel, so the button sits in a data-legacy span.
export default function HelpButton() {
  if (typeof Help !== "object" || !Help.T[Help.key()]) return null;
  return <span data-legacy="" style={{ display: "contents" }}><button className="help-btn" data-help="open" title="How this tab works">? How this tab works</button></span>;
}
