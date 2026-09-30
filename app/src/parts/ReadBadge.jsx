// How a bill was read, as a small tag: Free, Google OCR, Claude, ... Same rules as readBadge() in src/js/01.
export default function ReadBadge({ mode }) {
  if (!mode) return null;
  const tag = (cls, text) => <span className={"tag " + cls} title={mode}>{text}</span>;
  if (/^free (OCR|\(PDF)/.test(mode)) return tag("ok", "Free");
  if (mode === "Google OCR") return tag("ok", "Google OCR");
  if (/text only/.test(mode)) return tag("stamp", "Claude text");
  if (/^Claude/.test(mode)) return tag("stamp", "Claude");
  if (mode === "pasted") return <span className="tag no">Pasted</span>;
  if (mode === "free (partly read)") return tag("warn", "Partly read");
  return null;
}
