// A notice on a page in ONE row (the owner's round 3 of the UI pass, 05-Oct-2026: no banner takes more than one row): a
// dot of its severity (red needs action, amber attention, grey information), the words, and its button; the longer how-to
// on hover (title) and behind "How", which says it in a message.
export default function NoticeLine({ sev = "warn", text, how, children, ...p }) {
  return <div className={"alert-line al-" + sev} data-notice-line="" data-sev={sev} title={how ? text + " " + how : text} {...p}>
    <span className="al-dot" aria-hidden="true" />
    <span className="al-line-text">{text}</span>
    {children}
    {how && <button className="linkbtn" onClick={() => toast(how)}>How</button>}
  </div>;
}
