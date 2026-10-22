// mis-run (ROUND 105 B6): a worked-out My MIS report as a PDF in the cloud (the browser prints its own view; here there is
// no browser). pdf-lib, A4 portrait: the client, the report and its period, the unit line, then each block one after
// another: a KPI as a tile, a table (the figures in the unit and decimals, wide tables in a smaller size), a chart drawn
// as vectors (bars, stacked bars, lines, a pie or donut) with its legend. The standard fonts have no ₹: "Rs" is written.
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import { fmt } from "../../app/src/lib/misCustom.js";
import { UNITS } from "../_shared/misdef.js";

const A4 = [595.28, 841.89], M = 40;
const PAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = rgb(0.06, 0.09, 0.16), MUTED = rgb(0.28, 0.33, 0.41), RULE = rgb(0.8, 0.84, 0.88), OTHER = hex("#8b97a8");
const safe = (s: unknown) => String(s == null ? "" : s).replace(/₹/g, "Rs").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const tick = (v: number) => { const a = Math.abs(v), o = (x: number) => String(Math.round(x * 10) / 10); return a >= 1e7 ? o(v / 1e7) + "Cr" : a >= 1e5 ? o(v / 1e5) + "L" : a >= 1e3 ? o(v / 1e3) + "K" : String(Math.round(v)); };

export async function misPdf(res: any, o: { company?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create(), F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(safe((o.company || res.company || "") + " - " + res.name)); doc.setCreator("FinCom");
  let page: PDFPage = doc.addPage(A4 as [number, number]), y = A4[1] - M;
  const W = A4[0] - 2 * M;
  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = F, color = INK) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const width = (s: string, size: number, f: PDFFont = F) => f.widthOfTextAtSize(safe(s), size);
  const fit = (s: string, w: number, size: number, f: PDFFont = F) => { let t = safe(s); if (width(t, size, f) <= w) return t; while (t.length > 1 && width(t + ".", size, f) > w) t = t.slice(0, -1); return t + "."; };
  const need = (h: number) => { if (y - h < M) { page = doc.addPage(A4 as [number, number]); y = A4[1] - M; } };
  // the header
  text(o.company || res.company || "", M, y, 13, B); y -= 16;
  text(res.name + " - " + res.periodLabel, M, y, 11, B); y -= 13;
  text("(All amounts in " + ((UNITS as any)[res.units.unit] || "Rupees") + ", unless otherwise stated)", M, y, 9, F, MUTED); y -= 18;
  const u = res.units;
  const cell = (b: any, r: any, c: any) => { const v = r.cells[c.key]; if (v == null || v === "") return ""; if (typeof v === "string") return v; if (c.kind === "pct") return v + "%"; if (b.by === "ratio") return fmt(v, u, r.unit === "₹" ? "" : r.unit); return b.measure === "count" ? String(v) : fmt(v, u); };
  // KPI tiles, three to a row
  let kx = 0;
  for (const b of res.blocks) {
    if (b.error) { need(20); text(b.title + ": could not be worked out (" + b.error + ")", M, y, 9, F, MUTED); y -= 16; continue; }
    if (b.type === "kpi" && b.kpi) {
      const tw = (W - 16) / 3, th = 54;
      if (kx === 0) need(th + 8);
      const x = M + kx * (tw + 8), top = y;
      page.drawRectangle({ x, y: top - th, width: tw, height: th, borderColor: RULE, borderWidth: 1 });
      text(fit(b.title, tw - 16, 9, B), x + 8, top - 14, 9, B);
      const k = b.kpi, unit = k.unit && k.unit !== "₹" ? k.unit : "";
      text((k.value == null ? "-" : unit ? fmt(k.value, u, unit) : fmt(k.value, u)) + (unit ? "" : "  " + safe(({ 1: "Rs", 1000: "Rs '000", 100000: "Rs lakhs", 10000000: "Rs crores" } as any)[u.unit] || "Rs")), x + 8, top - 32, 14, B);
      if (k.chg != null) text((k.chg >= 0 ? "+" : "") + k.chg + "% on " + k.baseLabel, x + 8, top - 46, 8, F, MUTED);
      kx++; if (kx === 3) { kx = 0; y -= th + 10; }
      continue;
    }
    if (kx) { kx = 0; y -= 64; }
    need(40); text(b.title, M, y, 11, B); y -= 14;
    if (b.type === "chart" && b.chart) { need(190); drawChart(b.chart, M, y - 170, W, 160); y -= 180; }
    // the table
    const cols = b.cols, rows = b.rows.concat(b.total ? [b.total] : []), size = cols.length > 8 ? 6.5 : 8.5, lw = Math.min(170, W * 0.32), cw = (W - lw) / Math.max(1, cols.length), rh = size + 5;
    const head = () => { need(rh * 2); cols.forEach((c: any, i: number) => { const t = fit(c.label, cw - 2, size, B); text(t, M + lw + (i + 1) * cw - width(t, size, B) - 2, y, size, B); }); text("Particulars", M, y, size, B); y -= 3; page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: INK }); y -= rh - 2; };
    head();
    for (const r of rows) {
      if (y - rh < M) { page = doc.addPage(A4 as [number, number]); y = A4[1] - M; head(); }
      const bold = r.kind === "total" || r.bold, f = bold ? B : F;
      if (r.kind === "total") page.drawLine({ start: { x: M, y: y + size + 1 }, end: { x: M + W, y: y + size + 1 }, thickness: 0.5, color: INK });
      text(fit(r.label, lw - 4, size, f), M, y, size, f);
      cols.forEach((c: any, i: number) => { const t = cell(b, r, c); if (t) text(t, M + lw + (i + 1) * cw - width(t, size, f) - 2, y, size, f); });
      y -= rh;
    }
    for (const n of b.notes || []) { need(12); text(fit(n, W, 7.5), M, y, 7.5, F, MUTED); y -= 10; }
    y -= 10;
  }
  return await doc.save();

  function drawChart(spec: any, x0: number, y0: number, w: number, h: number) {
    const series = spec.series || [], colour = (s: any, i: number) => (s.key === "others" ? OTHER : hex(PAL[(s.ghost ? 0 : i) % 8]));
    const legendH = 14, ph = h - legendH;
    if (spec.type === "pie" || spec.type === "donut") {
      const vals = (series[0] || { values: [] }).values.map((v: number) => Math.max(0, +v || 0)), tot = vals.reduce((a: number, v: number) => a + v, 0) || 1;
      const cx = x0 + ph / 2 + 10, cy = y0 + legendH + ph / 2, r = ph / 2 - 4, ri = spec.type === "donut" ? r * 0.62 : 0;
      let a0 = Math.PI / 2;
      vals.forEach((v: number, i: number) => {
        if (!(v > 0)) return;
        const a1 = a0 - v / tot * Math.PI * 2, steps = Math.max(2, Math.ceil((a0 - a1) / 0.1)), P = (a: number, rr: number) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
        let d = ""; for (let k = 0; k <= steps; k++) { const [px, py] = P(a0 - (a0 - a1) * k / steps, r); d += (k ? "L" : "M") + px.toFixed(1) + " " + (2 * cy - py).toFixed(1) + " "; }
        if (ri) for (let k = steps; k >= 0; k--) { const [px, py] = P(a0 - (a0 - a1) * k / steps, ri); d += "L" + px.toFixed(1) + " " + (2 * cy - py).toFixed(1) + " "; } else d += "L" + cx.toFixed(1) + " " + cy.toFixed(1) + " ";
        page.drawSvgPath(d + "Z", { x: 0, y: 2 * cy, color: spec.pts && spec.pts[i] && spec.pts[i].key === "others" ? OTHER : hex(PAL[i % 8]), borderColor: rgb(1, 1, 1), borderWidth: 1 });
        a0 = a1;
      });
      let ly = y0 + legendH + ph - 10;
      spec.x.forEach((l: string, i: number) => { page.drawRectangle({ x: cx + r + 20, y: ly, width: 8, height: 8, color: spec.pts && spec.pts[i] && spec.pts[i].key === "others" ? OTHER : hex(PAL[i % 8]) }); text(fit(l, w - (r * 2 + 50), 8) + "  " + tick(vals[i] || 0), cx + r + 32, ly + 1, 8); ly -= 12; });
      return;
    }
    const all = series.flatMap((s: any) => s.values.map((v: number) => +v || 0)), m = spec.x.length, L = 34, pw = w - L, band = pw / Math.max(1, m), stacked = spec.type === "stacked";
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    if (stacked) { lo = 0; hi = 0; for (let i = 0; i < m; i++) { let p = 0, q = 0; series.forEach((s: any) => { const v = +s.values[i] || 0; if (v > 0) p += v; else q += v; }); hi = Math.max(hi, p); lo = Math.min(lo, q); } }
    if (hi === lo) hi = lo + 1;
    const Y = (v: number) => y0 + legendH + 12 + (v - lo) / (hi - lo) * (ph - 16), base = Y(0);
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, yy = Y(v); page.drawLine({ start: { x: x0 + L, y: yy }, end: { x: x0 + w, y: yy }, thickness: 0.4, color: RULE }); text(tick(v), x0, yy - 3, 6.5, F, MUTED); }
    const every = Math.max(1, Math.ceil(m / Math.floor(pw / 36)));
    spec.x.forEach((l: string, i: number) => { if (i % every === 0) { const t = fit(String(l).replace(/-\d{4}$/, ""), band * every - 2, 6.5); text(t, x0 + L + band * (i + 0.5) - width(t, 6.5) / 2, y0 + legendH, 6.5, F, MUTED); } });
    if (spec.type === "line") {
      series.forEach((s: any, si: number) => { const c = colour(s, si); for (let i = 1; i < m; i++) page.drawLine({ start: { x: x0 + L + band * (i - 0.5), y: Y(+s.values[i - 1] || 0) }, end: { x: x0 + L + band * (i + 0.5), y: Y(+s.values[i] || 0) }, thickness: 1.5, color: c, opacity: s.ghost ? 0.45 : 1 });
        page.drawCircle({ x: x0 + L + band * (m - 0.5), y: Y(+s.values[m - 1] || 0), size: 2.5, color: c }); });
    } else if (stacked) {
      for (let i = 0; i < m; i++) { let up = base, dn = base; const bw = Math.min(20, band * 0.6), x = x0 + L + band * (i + 0.5) - bw / 2;
        series.forEach((s: any, si: number) => { const v = +s.values[i] || 0, hgt = Math.abs(Y(v) - base); if (v >= 0) { page.drawRectangle({ x, y: up, width: bw, height: Math.max(0, hgt - 1), color: colour(s, si) }); up += hgt; } else { dn -= hgt; page.drawRectangle({ x, y: dn, width: bw, height: Math.max(0, hgt - 1), color: colour(s, si) }); } }); }
    } else {
      const n = series.length, bw = Math.max(2, Math.min(18, (band * 0.8 - (n - 1)) / n)), gw = n * bw + (n - 1);
      for (let i = 0; i < m; i++) series.forEach((s: any, si: number) => { const v = +s.values[i] || 0, x = x0 + L + band * (i + 0.5) - gw / 2 + si * (bw + 1), yy = Y(v);
        page.drawRectangle({ x, y: Math.min(yy, base), width: bw, height: Math.abs(yy - base), color: colour(s, si), opacity: s.ghost ? 0.5 : 1 }); });
    }
    page.drawLine({ start: { x: x0 + L, y: base }, end: { x: x0 + w, y: base }, thickness: 0.6, color: MUTED });
    if (series.length > 1) { let lx = x0 + L; series.forEach((s: any, si: number) => { page.drawRectangle({ x: lx, y: y0 + 1, width: 7, height: 7, color: colour(s, si) }); const t = fit(s.name, 140, 7); text(t, lx + 10, y0 + 2, 7); lx += 18 + width(t, 7); }); }
  }
}
