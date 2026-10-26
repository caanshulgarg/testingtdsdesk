// The bill's own document beside its fields (review item 12): the image or PDF uploaded, or the copy kept in the
// firm account (FileStore.get: this computer first, then the firm's documents), so it opens on any computer.
// Zoom for both; page flip for a PDF (the browser's PDF viewer, opened at the page asked for).
import { useEffect, useState } from "react";
import Loading from "./Loading.jsx";
import Button from "./Button.jsx";

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
      url = blobUrl(f);   // never as a page of FinCom's origin (blobUrl, src/js/01)
      setDoc({ url, pdf: /pdf/i.test(f.type) || /\.pdf$/i.test(f.name || e.fileName || "") });
      setState("");
    }).catch(() => { if (!gone) setState("none"); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [e.id, e.docPath]);
  const url = doc ? doc.url : prev, pdf = !!(doc && doc.pdf);
  if (!url && state !== "loading" && e.fileName === "Manual entry") return null;
  // ui-tidy (13-Oct-2026; the owner: "there is some glitch also while opening this"): the document's place is the same size
  // from the first frame (its bar, then the page or image filling the rest), so nothing moves when the PDF arrives; the
  // PDF viewer is drawn once and only changes on a zoom or a page turn
  const z = (d) => setZoom((v) => Math.min(300, Math.max(50, v + d)));
  const isPdf = pdf || (!url && /\.pdf$/i.test(e.fileName || ""));
  const bar = <div className="row billdoc-bar" style={{ gap: 6, flexWrap: "wrap" }}>
    <b style={{ fontSize: 13 }}>{isPdf ? "Bill (PDF)" : "Bill image"}</b>
    <Button className="btn small" aria-label="Zoom out" disabled={!url} onClick={() => z(-25)}>−</Button>
    <span className="note" style={{ minWidth: 40, textAlign: "center" }}>{zoom}%</span>
    <Button className="btn small" aria-label="Zoom in" disabled={!url} onClick={() => z(25)}>+</Button>
    {isPdf && <>
      <Button className="btn small" aria-label="Previous page" disabled={!url || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Page</Button>
      <span className="note">page {page}</span>
      <Button className="btn small" aria-label="Next page" disabled={!url} onClick={() => setPage((p) => p + 1)}>Page ›</Button>
    </>}
    {url && <a className="linkbtn" href={url} target="_blank" rel="noopener">Open in a new tab</a>}
  </div>;
  let area;
  if (!url) area = state === "loading" ? <div className="billdoc-wait"><Loading what="the bill" lines={4} /></div>
    : <div className="billdoc-wait"><p className="note" style={{ margin: 0 }}>{e.docPath
      ? "The bill's document could not be opened from the firm account. Check you are signed in, then open the bill again."
      : "No copy of this bill is kept in the firm account (it was read before documents were kept, or the firm keeps documents off). Upload it again to keep it."}</p></div>;
  // an iframe, not <object>: the page's security policy has object-src 'none' and frame-src 'self' blob:
  else if (pdf) area = <iframe key={page + ":" + zoom} src={url + "#page=" + page + "&zoom=" + zoom} title="The bill" />;
  else area = <div className="billdoc-img"><img className="preview" src={url} alt="The bill" style={{ maxHeight: "none", maxWidth: "none", width: zoom + "%", border: 0 }} /></div>;
  return (
    <div className="prevbox billdoc" data-bill-doc={url ? (pdf ? "pdf" : "image") : state || "none"}>
      {bar}
      <div className="billdoc-area">{area}</div>
    </div>
  );
}
