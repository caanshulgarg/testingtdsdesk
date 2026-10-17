// 2B matched by itself (round 72b): the line "142 matched (128 by rules, 14 by AI) · 6 to look at · 3 in books only ·
// 2 in 2B only", the run line (when and why it ran, what the AI did and what it cost), "Match again", and the documents to
// look at first: probable pairs (accept / reject, or all at once) and mismatches with what differs. Its own component,
// put at the top of the 2B screen (TwoB.jsx), so the screen's redesign can place it or read M2B (src/js/85) itself.
// Hooks: data-m2b (the box), data-m2b-line, data-m2b-run, data-m2b-again, data-m2b-accept-all, data-m2b-row=<pair id>,
// data-m2b-accept / data-m2b-reject=<pair id>.
const money = (v) => "₹" + INR.format(r2(v || 0));
const tx = (o) => r2(num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess));
const day = (d) => (/^\d{8}$/.test(String(d)) ? String(d).slice(6, 8) + "-" + String(d).slice(4, 6) + "-" + String(d).slice(0, 4) : String(d || ""));
const WHY = { fetched: "after 2B was fetched from the portal", uploaded: "after 2B was brought in", "new entries": "after new purchase entries", opened: "when the 2B page was opened", "match again": "on Match again", decided: "after your choice" };

function when(at) { try { const d = new Date(at); return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return ""; } }

export default function TwoBAuto({ reg }) {
  const v = M2B.view(reg);
  const run = v.run, res = run && run.result;
  if (!run && !v.busy) return null;
  const x = M2B.inputs(reg, v.fy);
  const g2 = new Map(x.twob.map((r) => [r.key, r])), bk = new Map(x.books.map((d) => [d.id, d]));
  const look = res ? res.rows.filter((r) => r.st === "probable" || r.st === "mismatch").sort((a, c) => (a.st === "probable" ? 0 : 1) - (c.st === "probable" ? 0 : 1)) : [];
  const probable = look.filter((r) => r.st === "probable");
  const ai = (run && run.ai) || {};
  const runLine = run ? [run.local ? "Matched here" : "Matched by itself " + when(run.at) + (WHY[run.why] ? " " + WHY[run.why] : ""), ai.say || ""].filter(Boolean).join(" · ") : "";
  const Docs = ({ keys, map, side }) => <>{keys.map((k) => { const d = map.get(k); return d
    ? <div key={k}>{(d.no || "—") + " · " + day(d.date)}<div className="nr">{(side === "b" && d.voucher ? "vch " + d.voucher + " · " : "") + "taxable " + money(d.taxable) + " · tax " + money(tx(d))}</div></div>
    : <div key={k} className="nr">{side === "g" ? "2B document" : "books entry"} {k}</div>; })}</>;
  return (
    <section className="dash-card" data-m2b="" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <b data-m2b-line="">{v.busy && !run ? "Matching 2B with the books…" : run.line}</b>
        {v.busy && run && <span className="note">matching again…</span>}
        <span style={{ flex: 1 }} />
        {probable.length > 0 && !run.local && <button className="btn small primary" data-m2b-accept-all="" disabled={v.busy} onClick={() => m2bDecide(reg, probable.map((r) => r.id), "accept")}>{"Accept all suggestions (" + probable.length + ")"}</button>}
        <button className="btn small" data-m2b-again="" disabled={v.busy} onClick={() => m2bAgain(reg)}>Match again</button>
      </div>
      {runLine && <p className="note" data-m2b-run="" style={{ margin: "4px 0 0" }}>{runLine}</p>}
      {look.length > 0 && <div style={{ overflowX: "auto", marginTop: 8 }}><table className="bk-table" style={{ margin: 0 }} data-m2b-look="">
        <thead><tr><th>To look at</th><th>Supplier</th><th>In 2B</th><th>In books</th><th>What differs</th><th className="ac"></th></tr></thead>
        <tbody>{look.map((r) => { const s = g2.get(r.g[0]) || bk.get(r.b[0]) || {}; return (
          <tr key={r.id} data-m2b-row={r.id}>
            <td>{r.st === "probable" ? <span className="tag warn">Probable match</span> : <span className="tag">Differs</span>}</td>
            <td>{s.party || "—"}<div className="nr">{s.gstin || ""}</div></td>
            <td><Docs keys={r.g} map={g2} side="g" /></td>
            <td><Docs keys={r.b} map={bk} side="b" /></td>
            <td style={{ minWidth: 220 }}>{r.why.join("; ")}</td>
            <td className="ac" style={{ whiteSpace: "nowrap" }}>{r.st === "probable" && !run.local && <>
              <button className="btn small primary" data-m2b-accept={r.id} disabled={v.busy} onClick={() => m2bDecide(reg, [r.id], "accept")}>Accept</button>{" "}
              <button className="btn small" data-m2b-reject={r.id} disabled={v.busy} onClick={() => m2bDecide(reg, [r.id], "reject")}>Reject</button></>}</td>
          </tr>); })}</tbody>
      </table></div>}
    </section>
  );
}
