// The days of a client's books that need a Day Book from Tally (the "From Tally" tab, screens/books/FromTally.jsx, and the
// top bar's Upload Tally data button, TopBar.jsx). Its own small file so the top bar, in the app's first file, does not
// carry the whole tab (integ-link, 27-Oct-2026: the first file's size budget, tests/run_stability.py)
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

// the days that need a Day Book: [{from, to (yyyymmdd), days, say}], newest first
export function needDays(b, cid) {
  const out = [];
  if (!b) return out;
  // lines Tally sent that only that day's Day Book settles (the one classifier the bell and Sync activity use)
  if (typeof AlertHub === "object" && typeof Rec === "object" && Rec.needKind) {
    const by = new Map();
    AlertHub.heldFor([cid]).forEach((l) => {
      const k = Rec.needKind(l); if (k !== "daybook" && k !== "dupid") return;
      const day = AlertHub.heldDay(l); if (!day) return;
      const x = by.get(day) || { n: 0, dup: 0 }; x.n++; if (k === "dupid") x.dup++; by.set(day, x);
    });
    by.forEach((x, day) => out.push({ from: day, to: day, days: 1, say: plural(x.n, "entry", "entries") + " Tally sent could not be read" + (x.dup ? "; check Tally for a double posting first" : "") }));
  }
  // the cloud's gap: entries made in Tally that never reached FinCom, from that day to today
  if (typeof Rec === "object" && Rec.gapFor && typeof TCloud === "object" && TCloud.on()) {
    Rec.gapFor(cid).forEach((g) => {
      const since = String(Rec.ymdLocal((g.gap && (g.gap.since || g.gap.last_match_at)) || g.gapAt || Date.now()) || "").replace(/-/g, ""), today = String(Rec.ymdLocal(Date.now())).replace(/-/g, "");
      if (!since) return;
      let n = 0; for (let x = since; x <= today; x = BridgeSeed.add(x, 1)) n++;
      const k = Number((g.gap && (g.gap.missingMax || g.gap.missing)) || 0);
      out.push({ from: since, to: today, days: n, say: (k ? plural(k, "entry", "entries") : "Entries") + " made in Tally since then " + (k === 1 ? "is" : "are") + " not in FinCom" });
    });
  }
  // the dates between the files brought in
  const parts = ((b.meta || {}).parts || []).slice().sort((x, y) => String(x.from).localeCompare(String(y.from)));
  if (parts.length) {
    let end = parts[0].to;
    parts.slice(1).forEach((p) => {
      if (p.from > BridgeSeed.add(end, 1)) {
        const f = BridgeSeed.add(end, 1), t = BridgeSeed.add(p.from, -1);
        let n = 0; for (let x = f; x <= t; x = BridgeSeed.add(x, 1)) n++;
        out.push({ from: f, to: t, days: n, say: "no Day Book uploaded for these dates" });
      }
      if (p.to > end) end = p.to;
    });
  }
  return out.sort((x, y) => String(y.from).localeCompare(String(x.from)));
}
