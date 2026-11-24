// The ONE action of a "Needs you" group (Rec.needKind, src/js/61, the shared classifier): on Sync activity and on a
// client's GST and TDS ledgers page (Books -> Tally ledgers).
// the ONE action of a "Needs you" group (Rec.needKind, src/js/61): who may do it, else the words say who does
import "../../../src/js/99-screen-parts.js";
import Button from "./Button.jsx";
const tellWords = (cid) => { const t = cid && globalThis.FCTell ? FCTell.book(cid) : null, c = t && t.cause; return (c && c.code && c.words) || "FinCom is bringing this day from Tally."; };
export default function NeedAction({ g, canApply, busy }) {
  const owner = Rec.owner();
  const b = (act, label, go, extra) => <Button className="btn small" data-needs-act={act} {...extra} onClick={go}>{label}</Button>;
  switch (g.kind) {
    // Tally tell (the owner, 24-Nov-2026): FinCom brings the day from Tally itself; the book's sentence when FinCom's cloud says one
    case "daybook": case "dupid": case "renumber":
      return <span className="note" data-needs-act="tell" data-needs-tell={g.cid || ""}>{" " + tellWords(g.cid)}</span>;
    case "readstop":
      return owner ? b("resume", "Resume reading", () => Rec.resumeOn(g), { "data-needs-resume": "" }) : null;
    case "baseline":
      return b("tally", "Open the Tally page", () => Rec.openTallyPage());
    case "masters":
      return g.cid ? b("masters", "Open From Tally", () => Rec.openClientTab(g.cid, "books:import")) : null;
    case "locked":
      return g.cid ? b("tieout", "Open Tie-out", () => Rec.openClientTab(g.cid, "books:tieout")) : null;
    default:
      return canApply ? b("apply", "Apply now", () => Rec.releaseAll(g.lines), { "data-needs-apply": "", disabled: busy, title: busy ? "Applying the lines already asked for" : undefined })
        : <span className="note">{" (a member of the firm who may write does this)"}</span>;
  }
}
