// The end of To review (smart moves round 1, 09-Oct-2026): every bill reviewed, the approved ones waiting for Tally:
// "All 7 bills reviewed · Post 7 to Tally →". The button only opens Post to Tally; nothing is posted until Post is pressed there.
export default function QueueDone() {
  const all = Object.values(D().entries);
  if (all.some((e) => e.status === "draft")) return null;
  const waiting = all.filter((e) => e.status === "approved" && !e.exportedAt).length;
  if (!waiting) return null;
  return <div className="bk-alert ok queue-done" data-queue-done="" role="status">
    <b>{"All " + waiting + (waiting === 1 ? " bill" : " bills") + " reviewed"}</b>
    <button className="btn small primary" data-queue-post="" onClick={() => goStep("post", "bills")}>{"Post " + waiting + " to Tally →"}</button>
  </div>;
}
