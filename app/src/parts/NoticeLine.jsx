// A notice on a page in ONE row (the owner's round 3 of the UI pass, 05-Oct-2026: no banner takes more than one row): its
// severity (red needs action, amber attention, grey information), the words, and its button; the longer how-to on hover
// (title) and behind "How", which says it in a message. Drawn by Arc's Alert (src/arc/registry/components/alert), kept
// to one row (.alert-line in styles/arc-look.css).
import { Alert } from "@/registry/components/alert/alert";

const TONE = { bad: "danger", stop: "danger", warn: "warning", info: "info", ok: "success" };
export default function NoticeLine({ sev = "warn", text, how, children, className = "", ...p }) {
  // the hover words (the title) sit on a wrapper with no box of its own: Arc's Alert takes "title" as its heading
  return <span className="al-wrap" title={how ? text + " " + how : text} style={{ display: "contents" }}><Alert tone={TONE[sev] || "info"} title={String(text == null ? "" : text)} className={("alert-line al-" + sev + " " + className).trim()}
    data-notice-line="" data-sev={sev} {...p}>
    {children || how ? <span className="al-acts">{children}{how && <button type="button" className="linkbtn" onClick={() => toast(how)}>How</button>}</span> : undefined}
  </Alert></span>;
}
