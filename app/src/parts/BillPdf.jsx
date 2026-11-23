// A bill's PDF page drawn by FinCom itself (pdf.js, already on the site for reading bills), loaded with the bill's side
// window only. Not the browser's PDF viewer in a frame: Safari left that frame blank (the owner, 23-Nov-2026: "that
// invoice does not show in the side window"), and a browser without a PDF viewer shows nothing there.
// Memory (review of 390e0ff8a: twelve 40 MB scans took a tab to 1.4 GB through the shared getPdf cache): the window opens
// its own copy (openPdfDoc), never the reading's cache; the copy is destroyed when the bill changes or the window closes,
// each page's resources are let go once it is drawn, and the canvas is emptied on close. window.__billPdfOpen counts the
// copies open (tests/run_bill_doc_pdf.py).
import { useEffect, useRef, useState } from "react";

const live = (d) => { window.__billPdfOpen = Math.max(0, (window.__billPdfOpen || 0) + d); };

export default function BillPdf({ file, page, zoom, onPages, onFail }) {
  const box = useRef(null), cv = useRef(null);
  const [w, setW] = useState(0);
  const [pdf, setPdf] = useState(null);
  // the width of the side window, so 100% is the page across it
  useEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setW((v) => Math.abs(v - el.clientWidth) > 8 ? el.clientWidth : v);
    fit();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // this bill's own copy of the PDF, destroyed when the bill changes or the window closes
  useEffect(() => {
    let gone = false, doc = null;
    const canvas = cv.current;   // kept here: React lets go of the ref before this cleanup runs
    setPdf(null);
    (async () => {
      try {
        await ensurePdfJs();
        if (!window.pdfjsLib) throw { code: "pdf_unavailable" };
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (gone) return;
        doc = await openPdfDoc(bytes); live(1);
        if (gone) { live(-1); doc.destroy(); doc = null; return; }
        onPages(doc.numPages); setPdf(doc);
      } catch (e) {
        if (!gone) onFail(e && e.name === "PasswordException" ? "password" : "broken");
      }
    })();
    return () => {
      gone = true;
      if (doc) { live(-1); try { doc.destroy(); } catch (e) {} doc = null; }
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas.removeAttribute("data-bill-page"); }
    };
  }, [file]);
  // the page asked for, drawn; its resources let go once it is on the canvas
  useEffect(() => {
    if (!pdf || !w) return;
    let gone = false, task = null, pg = null;
    (async () => {
      try {
        const n = Math.min(Math.max(1, page), pdf.numPages);
        pg = await pdf.getPage(n);
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
        if (!gone && !(e && e.name === "RenderingCancelledException")) onFail("page");
      } finally {
        if (pg) try { pg.cleanup(); } catch (e) {}
      }
    })();
    return () => { gone = true; if (task) try { task.cancel(); } catch (e) {} };
  }, [pdf, page, zoom, w]);
  return <div ref={box} className="billdoc-img billdoc-pdf" style={{ background: "#E8EAED" }}>
    <canvas ref={cv} title="The bill" style={{ display: "block", margin: "0 auto", background: "#fff", maxWidth: "none" }} />
  </div>;
}
