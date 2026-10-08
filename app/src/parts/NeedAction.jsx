// The ONE action of a "Needs you" group (Rec.needKind, src/js/61, the shared classifier): on Sync activity and on a
// client's GST and TDS ledgers page (Books -> Tally ledgers).
// the ONE action of a "Needs you" group (Rec.needKind, src/js/61): who may do it, else the words say who does
export default function NeedAction({ g, canApply, busy }) {
  const owner = Rec.owner(), day = g.day ? fmtDate(g.day) : "that day";
  const b = (act, label, go, extra) => <button className="btn small" data-needs-act={act} {...extra} onClick={go}>{label}</button>;
  switch (g.kind) {
    case "daybook": case "dupid":
      return canApply && g.cid ? b("daybook", "Upload the Day Book for " + day, () => Rec.uploadDay(g.cid, g.day), { "data-needs-daybook": "" }) : <span className="note">{" (a member of the firm who may write does this)"}</span>;
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
