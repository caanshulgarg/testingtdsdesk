// The live A4 preview of a document: its blocks measured at the paper's width, laid into pages (docPrint.paginate), each
// page drawn by the same HTML as the PDF, scaled to the room there is. Tells its parent the pages (for the PDF and the
// "Page 1 of 2" line).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PAGE, PAPER_CSS, blockHtml, docHtml, paginate } from "./docPrint.js";

function usePaperCss() {
  useEffect(() => {
    if (document.getElementById("corp-paper-css")) return;
    const s = document.createElement("style"); s.id = "corp-paper-css"; s.textContent = PAPER_CSS; document.head.appendChild(s);
  }, []);
}

export default function Paper({ model, letter, onPages }) {
  usePaperCss();
  const box = useRef(null), meas = useRef(null), [scale, setScale] = useState(1), [pages, setPages] = useState([model.blocks.map((_, i) => i)]);
  const key = JSON.stringify([model.blocks, model.kind, model.head, letter && letter.on]);
  useLayoutEffect(() => {
    const el = meas.current; if (!el) return;
    const kids = [...el.children];
    const h = (i) => { const k = kids[i]; if (!k) return 0; const cs = getComputedStyle(k); return k.offsetHeight + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0); };
    const p = paginate(model, letter, h);
    setPages(p); if (onPages) onPages(p);
  }, [key]);
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver !== "function") return;
    const fit = () => setScale(Math.min(1, (el.clientWidth || PAGE.w) / PAGE.w));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);
  const html = docHtml(model, letter, pages);
  return <div ref={box} className="corp-pages" data-corp-preview="" data-pages={pages.length}>
    {/* the measuring sheet: the blocks at the text's width, out of sight */}
    <div aria-hidden="true" style={{ position: "absolute", left: -10000, top: 0, visibility: "hidden", pointerEvents: "none" }}>
      <div className="corp-a4" style={{ height: "auto", boxShadow: "none" }}><div ref={meas} className="pg-body" style={{ position: "static", width: PAGE.w - 144 }} dangerouslySetInnerHTML={{ __html: model.blocks.map(blockHtml).join("") }} /></div>
    </div>
    <div className="corp-pages-scale" style={{ height: pages.length * (PAGE.h * scale + 18) - 18 }}>
      <div style={{ transform: "scale(" + scale + ")", transformOrigin: "top left", width: PAGE.w, display: "flex", flexDirection: "column", gap: 18 / scale }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  </div>;
}
