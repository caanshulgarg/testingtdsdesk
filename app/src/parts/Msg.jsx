// A message on the screen in plain words (owner's spec K4, 04-Oct-2026): raw words from the database, the network or
// Tally become what happened, why and what to do (plainMessage, src/js/01), with the raw words behind "details";
// a message already in plain words is shown as it is.
export default function Msg({ text }) {
  const s = text == null ? "" : String(text);
  const p = typeof plainMessage === "function" ? plainMessage(s) : null;
  if (!p) return <>{s}</>;
  return <>{p.text}{" "}<details className="msg-details" data-msg-details=""><summary>details</summary><span>{p.details}</span></details></>;
}
