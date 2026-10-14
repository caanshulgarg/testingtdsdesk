// "How this tab works": the guide for the tab shown (Help in src/js/34), when it has one. The old click handler
// opens the panel, so the button sits in a data-legacy span.
// page: the top bar's button, for the screens whose topic is a guide article (Purchase, Bank, Sales, Reports, MIS...)
// small: the upload pages' "?" at the end of their row of states (upload-pages, 14-Oct-2026: help on demand, not first)
export default function HelpButton({ page, small }) {
  if (typeof Help !== "object" || !Help.topic(Help.key())) return null;
  if (!!page !== String(Help.key()).startsWith("page:")) return null;
  if (small) return <span data-legacy="" style={{ display: "contents" }}><button className="help-btn help-q" data-help="open" title="How this page works" aria-label="How this page works">?</button></span>;
  return <span data-legacy="" style={{ display: "contents" }}><button className="help-btn" data-help="open" title="How this tab works">? How this tab works</button></span>;
}
