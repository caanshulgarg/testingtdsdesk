// A bill's PDF page drawn by FinCom itself (pdf.js, getPdf in src/js/01, already on the site for reading bills), loaded
// with the bill's side window only. Not the browser's PDF viewer in a frame: Safari left that frame blank (the owner,
// 23-Nov-2026: "that invoice does not show in the side window"), and a browser without a PDF viewer shows nothing there.
import { useEffect, useRef, useState } from "react";

export default function BillPdf({ file, page, zoom, onPages, onFail }) {
  const box = useRef(null), cv = useRef(null);
  const [w, setW] = useState(0);
  // the width of the side window, so 100% is the page across it
  useEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setW((v) => Math.abs(v - el.clientWidth) > 8 ? el.clientWidth : v);
    fit();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!w) return;
    let gone = false, task = null;
    (async () => {
      try {
        const pdf = await getPdf(file);
        if (gone) return;
        onPages(pdf.numPages);
        const n = Math.min(Math.max(1, page), pdf.numPages), pg = await pdf.getPage(n);
        if (gone) return;
        const vp0 = pg.getViewport({ scale: 1 }), cssW = Math.max(200, w - 2) * zoom / 100;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        // sharp on a Retina screen, never a canvas Safari refuses (about 16 million pixels)
        const vp = pg.getViewport({ scale: Math.min(cssW * dpr / vp0.width, 4000 / Math.max(vp0.width, vp0.height)) });
        const c = cv.current; if (!c) return;
        c.removeAttribute("data-bill-page");
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        c.style.width = Math.round(cssW) + "px";
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        task = pg.render({ canvasContext: g, viewport: vp });
        await task.promise;
        if (!gone) c.setAttribute("data-bill-page", String(n));
      } catch (e) {
        if (!gone && !(e && e.name === "RenderingCancelledException")) onFail();
      }
    })();
    return () => { gone = true; if (task) try { task.cancel(); } catch (e) {} };
  }, [file, page, zoom, w]);
  return <div ref={box} className="billdoc-img billdoc-pdf" style={{ background: "#E8EAED" }}>
    <canvas ref={cv} title="The bill" style={{ display: "block", margin: "0 auto", background: "#fff", maxWidth: "none" }} />
  </div>;
}
