// How a bill was read, as a small tag (Tag: Arc's Badge): Free, Google OCR, Claude, ... Same rules as readBadge() in src/js/01.
import Tag from "./Tag.jsx";

export default function ReadBadge({ mode }) {
  if (!mode) return null;
  const tag = (kind, text) => <Tag kind={kind} title={mode}>{text}</Tag>;
  if (/^free (OCR|\(PDF)/.test(mode)) return tag("ok", "Free");
  if (mode === "Google OCR") return tag("ok", "Google OCR");
  if (/text only/.test(mode)) return tag("stamp", "Claude text");
  if (/^Claude/.test(mode)) return tag("stamp", "Claude");
  if (mode === "pasted") return <Tag kind="no">Pasted</Tag>;
  if (mode === "free (partly read)") return tag("warn", "Partly read");
  return null;
}
