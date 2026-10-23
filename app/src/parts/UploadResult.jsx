// What happened to each file of the last upload for this client (review of 02-Oct-2026: FA/ELEC/013 uploaded again
// left the page on "Nothing waiting" with no word): "1 bill read", "1 duplicate of … (in Tally): open it", "1 could not be
// read: why". Kept until closed or the next upload; made by uploadLines (src/js/01).
const CLS = { ok: "ok", dup: "warn", bad: "bad", info: "" };
function openEntry(cid, id) {
  if (!id) return;
  if (cid && cid !== S.coId) { goClient("bills"); }
  const e = D().entries[id];
  if (!e) { toast("That bill is not on this computer yet."); return; }
  S.tab = "invoices"; S.filter = e.status; S.selected = id; render(); window.scrollTo(0, 0);
}
export default function UploadResult() {
  const u = S.lastUpload && S.lastUpload[S.coId];
  if (!u || !u.lines.length) return null;
  return <div className="bk-alert" data-upload-result="" style={{ margin: "0 0 12px" }}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <b>{"Last upload (" + fmtTime(u.at) + "): " + u.text}</b>
      <button className="linkbtn" onClick={() => { delete S.lastUpload[S.coId]; render(); }}>Close</button></div>
    <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{u.lines.map((l, i) => <li key={i}>
      <span className={"tag " + CLS[l.kind]}>{l.kind === "ok" ? "read" : l.kind === "dup" ? "duplicate" : l.kind === "bad" ? "not read" : "sales"}</span>{" " + l.name + ": " + l.text}
      {l.kind === "dup" && l.orig && <>{" · "}<button className="linkbtn" onClick={() => openEntry(l.cid, l.orig)}>open the original</button></>}
      {l.open && <>{" · "}<button className="linkbtn" onClick={() => openEntry(l.cid, l.open)}>{l.kind === "dup" && !l.orig && !(D().entries[l.open] || {}).dupOf ? "open it" : l.kind === "dup" ? "open the copy" : "open it"}</button></>}
    </li>)}</ul>
  </div>;
}
