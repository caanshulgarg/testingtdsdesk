// The bill's own document beside its fields (review item 12): the image or PDF uploaded, or the copy kept in the
// firm account (FileStore.get: this computer first, then the firm's documents), so it opens on any computer.
// Zoom for both; page flip for a PDF (the browser's PDF viewer, opened at the page asked for).
import { useEffect, useState } from "react";
import Loading from "./Loading.jsx";

export default function BillDoc({ e }) {
  const cid = S.coId, prev = S.previews[e.id];
  const [doc, setDoc] = useState(null);          // {url, pdf} from the stored file
  const [state, setState] = useState("");        // "" | "loading" | "none"
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let url = "", gone = false;
    setDoc(null); setZoom(100); setPage(1);
    if (e.fileName === "Manual entry") { setState("none"); return; }
    setState("loading");
    FileStore.get(cid, e.id, e.docPath || "", e.fileName || "").then((f) => {
      if (gone) return;
      if (!f) { setState("none"); return; }
      url = URL.createObjectURL(f);
      setDoc({ url, pdf: /pdf/i.test(f.type) || /\.pdf$/i.test(f.name || e.fileName || "") });
      setState("");
    }).catch(() => { if (!gone) setState("none"); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [e.id, e.docPath]);
  const url = doc ? doc.url : prev, pdf = !!(doc && doc.pdf);
  if (!url) {
    if (state === "loading") return <div className="prevbox"><Loading what="the bill" lines={4} /></div>;
    if (e.fileName === "Manual entry") return null;
    return <div className="prevbox"><p className="note" style={{ margin: 0 }}>{e.docPath
      ? "The bill's document could not be opened from the firm account. Check you are signed in, then open the bill again."
      : "No copy of this bill is kept in the firm account (it was read before documents were kept, or the firm keeps documents off). Upload it again to keep it."}</p></div>;
  }
  const z = (d) => setZoom((v) => Math.min(300, Math.max(50, v + d)));
  return (
    <div className="prevbox billdoc">
      <div className="row" style={{ gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>{pdf ? "Bill (PDF)" : "Bill image"}</b>
        <button className="btn small" aria-label="Zoom out" onClick={() => z(-25)}>−</button>
        <span className="note" style={{ minWidth: 40, textAlign: "center" }}>{zoom}%</span>
        <button className="btn small" aria-label="Zoom in" onClick={() => z(25)}>+</button>
        {pdf && <>
          <button className="btn small" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Page</button>
          <span className="note">page {page}</span>
          <button className="btn small" aria-label="Next page" onClick={() => setPage((p) => p + 1)}>Page ›</button>
        </>}
        <a className="linkbtn" href={url} target="_blank" rel="noopener">Open in a new tab</a>
      </div>
      {pdf
        // an iframe, not <object>: the page's security policy has object-src 'none' and frame-src 'self' blob:
        ? <iframe key={page + ":" + zoom} src={url + "#page=" + page + "&zoom=" + zoom} title="The bill" style={{ width: "100%", height: "75vh", border: "1px solid var(--rule)", borderRadius: 4 }} />
        : <div style={{ overflow: "auto", maxHeight: "75vh", border: "1px solid var(--rule)", borderRadius: 4, background: "#fff" }}>
            <img className="preview" src={url} alt="The bill" style={{ maxHeight: "none", maxWidth: "none", width: zoom + "%", border: 0 }} /></div>}
    </div>
  );
}
