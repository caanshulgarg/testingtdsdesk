// "My MIS" (ROUND 105, B2): a block's chart drawn as an SVG string. Pure JavaScript, no DOM: the screen shows it
// (parts/MisChart.jsx: the legend, the hover tooltip and the table view around it), the Excel download turns it into a
// picture (misExport.js), and the cloud's scheduled run (B6) can draw the same chart for its PDF.
// The rules (the dataviz method): bar, line, pie/donut and stacked bar; categorical colours in a fixed order (validated:
// light on #FFFFFF, dark on #111827; the light set's yellow, aqua and pink are under 3:1, so every chart has its legend
// and its figures as a table); bars at most 24px thick with a 4px rounded data end, square at the baseline, a 2px surface
// gap between touching bars and between stacked segments; 2px lines with a ringed end dot; hairline solid gridlines; text
// in the text colours, never the series colour; one value axis (never two); the series' colour follows the row, not its
// rank. Each mark carries data-s (series) and data-i (point) for the tooltip.
export const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
export const OTHERS = { light: "#8b97a8", dark: "#64748b" };
// the colours as CSS (the screen: styles in mymis.css set --mis-s1..8 for light and dark) or as hex (a picture)
export const THEME_CSS = { ink: "var(--ink)", muted: "var(--muted)", grid: "var(--rule)", surface: "var(--sheet)", series: (i) => "var(--mis-s" + ((i % 8) + 1) + ")", others: "var(--mis-other)" };
export const themeHex = (mode = "light") => ({ ink: mode === "dark" ? "#E5E7EB" : "#0F172A", muted: mode === "dark" ? "#94A3B8" : "#475569", grid: mode === "dark" ? "#334155" : "#E2E8F0",
  surface: mode === "dark" ? "#111827" : "#FFFFFF", series: (i) => PALETTE[mode][i % 8], others: OTHERS[mode] });

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const one = (v) => String(Math.round(v * 10) / 10);
// the value axis in Indian units: 80K, 4L, 1.2Cr
export const tick = (v) => { const a = Math.abs(v); return a >= 1e7 ? one(v / 1e7) + "Cr" : a >= 1e5 ? one(v / 1e5) + "L" : a >= 1e3 ? one(v / 1e3) + "K" : String(Math.round(v * 100) / 100); };
const niceStep = (span, n) => { const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
const fill = (c) => 'style="fill:' + c + '"';
const n2 = (v) => Math.round(v * 10) / 10;
// a bar with its data end rounded (r), square at the baseline; up: a positive bar
function barPath(x, y0, w, h, up, r) {
  r = Math.min(r, w / 2, Math.abs(h)); if (h <= 0.5) return "";
  if (up) { const y = y0 - h; return "M" + n2(x) + "," + n2(y0) + "V" + n2(y + r) + "Q" + n2(x) + "," + n2(y) + " " + n2(x + r) + "," + n2(y) + "H" + n2(x + w - r) + "Q" + n2(x + w) + "," + n2(y) + " " + n2(x + w) + "," + n2(y + r) + "V" + n2(y0) + "Z"; }
  const y = y0 + h; return "M" + n2(x) + "," + n2(y0) + "V" + n2(y - r) + "Q" + n2(x) + "," + n2(y) + " " + n2(x + r) + "," + n2(y) + "H" + n2(x + w - r) + "Q" + n2(x + w) + "," + n2(y) + " " + n2(x + w) + "," + n2(y - r) + "V" + n2(y0) + "Z";
}
const short = (l) => { const m = /^([A-Z][a-z]{2})-(\d{4})$/.exec(String(l)); return m ? m[1] : String(l).length > 14 ? String(l).slice(0, 13) + "…" : String(l); };

// spec: {type, x: [labels], series: [{key, name, values, ghost}]}; o: {w, h, theme, title, legend (draw it in the SVG)}
export function chartSvg(spec, o = {}) {
  const T = o.theme || THEME_CSS, W = Math.max(260, Math.round(o.w || 640)), legendRows = o.legend ? legendLayout(spec, W).rows : 0, H0 = Math.max(160, Math.round(o.h || 240)), H = H0 + legendRows * 18;
  const colour = (s, i) => (s.key === "others" ? T.others : T.series(s.ci != null ? s.ci : i));
  const series = (spec.series || []).map((s, i) => Object.assign({}, s, { ci: s.ci != null ? s.ci : s.ghost ? 0 : i }));
  const marks = [];
  const all = series.flatMap((s) => s.values.map((v) => +v || 0));
  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(o.title || "Chart") + '" font-family="Inter, Geist, Arial, sans-serif" font-size="11">' +
    (o.bg ? '<rect width="' + W + '" height="' + H + '" ' + fill(T.surface) + "/>" : "") + "<title>" + esc(o.title || "Chart") + "</title><desc>" + esc(describe(spec)) + "</desc>";
  if (!all.some((v) => Math.abs(v) >= 0.005)) return { svg: head + '<text x="' + W / 2 + '" y="' + H0 / 2 + '" text-anchor="middle" ' + fill(T.muted) + ">No figures to chart for this period</text></svg>", marks, w: W, h: H, empty: true };
  let body = "";
  if (spec.type === "pie" || spec.type === "donut") {
    const s = series[0], vals = s.values.map((v) => Math.max(0, +v || 0)), tot = vals.reduce((a, v) => a + v, 0), cx = W / 2, cy = H0 / 2, r = Math.min(W / 2 - 16, H0 / 2 - 12), ri = spec.type === "donut" ? r * 0.62 : 0;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (!(v > 0)) return;
      const a1 = a0 + v / tot * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, P = (a, rr) => n2(cx + rr * Math.cos(a)) + "," + n2(cy + rr * Math.sin(a));
      const c = (spec.pts && spec.pts[i] && spec.pts[i].key === "others") ? T.others : T.series(i);
      const d = vals.filter((x) => x > 0).length === 1 ? "M" + P(-Math.PI / 2, r) + "A" + r + "," + r + " 0 1 1 " + P(-Math.PI / 2 - 0.0001, r) + "Z" + (ri ? "M" + P(-Math.PI / 2, ri) + "A" + ri + "," + ri + " 0 1 0 " + P(-Math.PI / 2 - 0.0001, ri) + "Z" : "")
        : "M" + P(a0, r) + "A" + r + "," + r + " 0 " + big + " 1 " + P(a1, r) + (ri ? "L" + P(a1, ri) + "A" + ri + "," + ri + " 0 " + big + " 0 " + P(a0, ri) + "Z" : "L" + n2(cx) + "," + n2(cy) + "Z");
      body += '<path d="' + d + '" style="fill:' + c + ";stroke:" + T.surface + ';stroke-width:2" fill-rule="evenodd" data-s="0" data-i="' + i + '"/>';
      const am = (a0 + a1) / 2; marks.push({ s: 0, i, x: cx + (r + ri) / 2 * Math.cos(am), y: cy + (r + ri) / 2 * Math.sin(am), name: spec.x[i], value: v, share: Math.round(v / tot * 1000) / 10 });
      a0 = a1;
    });
    if (ri) body += '<text x="' + n2(cx) + '" y="' + n2(cy - 2) + '" text-anchor="middle" font-size="16" font-weight="600" ' + fill(T.ink) + ">" + esc(tick(tot)) + '</text><text x="' + n2(cx) + '" y="' + n2(cy + 14) + '" text-anchor="middle" ' + fill(T.muted) + ">Total</text>";
  } else {
    const L = 46, R = 12, TOP = 10, B = 24, pw = W - L - R, ph = H0 - TOP - B, m = spec.x.length;
    const stacked = spec.type === "stacked";
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    if (stacked) { hi = 0; lo = 0; for (let i = 0; i < m; i++) { let p = 0, q = 0; series.forEach((s) => { const v = +s.values[i] || 0; if (v > 0) p += v; else q += v; }); hi = Math.max(hi, p); lo = Math.min(lo, q); } }
    const step = niceStep(hi - lo, 4); hi = Math.ceil(hi / step) * step; lo = Math.floor(lo / step) * step; if (hi === lo) hi = lo + step;
    const Y = (v) => TOP + (hi - v) / (hi - lo) * ph, y0 = Y(0), band = pw / m;
    for (let v = lo; v <= hi + step / 2; v += step) body += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + n2(Y(v)) + '" y2="' + n2(Y(v)) + '" style="stroke:' + T.grid + ';stroke-width:1"/><text x="' + (L - 6) + '" y="' + n2(Y(v) + 4) + '" text-anchor="end" ' + fill(T.muted) + ">" + esc(tick(v)) + "</text>";
    const every = Math.max(1, Math.ceil(m / Math.max(1, Math.floor(pw / 46))));
    spec.x.forEach((l, i) => { if (i % every === 0) body += '<text x="' + n2(L + band * (i + 0.5)) + '" y="' + (H0 - 8) + '" text-anchor="middle" ' + fill(T.muted) + ">" + esc(short(l)) + "</text>"; });
    if (spec.type === "line") {
      if (series.length === 1 && !series[0].ghost) { const s = series[0], pts = s.values.map((v, i) => n2(L + band * (i + 0.5)) + "," + n2(Y(+v || 0))); body += '<path d="M' + n2(L + band * 0.5) + "," + n2(y0) + "L" + pts.join("L") + "L" + n2(L + band * (m - 0.5)) + "," + n2(y0) + 'Z" style="fill:' + colour(s, 0) + ';fill-opacity:0.1"/>'; }
      series.forEach((s, si) => {
        const c = colour(s, si), pts = s.values.map((v, i) => [L + band * (i + 0.5), Y(+v || 0)]);
        body += '<path d="M' + pts.map((p) => n2(p[0]) + "," + n2(p[1])).join("L") + '" style="fill:none;stroke:' + c + ";stroke-width:2;stroke-linejoin:round;stroke-linecap:round" + (s.ghost ? ";stroke-opacity:0.45" : "") + '"/>';
        const e = pts[pts.length - 1]; body += '<circle cx="' + n2(e[0]) + '" cy="' + n2(e[1]) + '" r="4" style="fill:' + c + ";stroke:" + T.surface + ';stroke-width:2"' + (s.ghost ? ' opacity="0.6"' : "") + "/>";
        pts.forEach((p, i) => marks.push({ s: si, i, x: p[0], y: p[1], name: s.name, label: spec.x[i], value: +s.values[i] || 0 }));
      });
      // the hover columns: one per point, the whole height (bigger than the marks)
      spec.x.forEach((l, i) => { body += '<rect x="' + n2(L + band * i) + '" y="' + TOP + '" width="' + n2(band) + '" height="' + ph + '" style="fill:transparent" data-i="' + i + '" data-col=""/>'; });
    } else if (stacked) {
      spec.x.forEach((l, i) => {
        const w = Math.min(24 * 1.6, band * 0.62), x = L + band * (i + 0.5) - w / 2; let up = y0, dn = y0;
        const pos = series.map((s, si) => [s, si, +s.values[i] || 0]).filter((z) => z[2] > 0), neg = series.map((s, si) => [s, si, +s.values[i] || 0]).filter((z) => z[2] < 0);
        pos.forEach(([s, si, v], k) => { const h = y0 - Y(v), top = k === pos.length - 1, gap = k ? 2 : 0;
          body += top ? '<path d="' + barPath(x, up - gap, w, h - gap, true, 4) + '" ' + fill(colour(s, si)) + ' data-s="' + si + '" data-i="' + i + '"/>' : '<rect x="' + n2(x) + '" y="' + n2(up - h) + '" width="' + n2(w) + '" height="' + n2(Math.max(0, h - gap)) + '" ' + fill(colour(s, si)) + ' data-s="' + si + '" data-i="' + i + '"/>';
          marks.push({ s: si, i, x: x + w / 2, y: up - h / 2, name: s.name, label: l, value: v }); up -= h; });
        neg.forEach(([s, si, v], k) => { const h = Y(v) - y0, gap = k ? 2 : 0;
          body += k === neg.length - 1 ? '<path d="' + barPath(x, dn + gap, w, h - gap, false, 4) + '" ' + fill(colour(s, si)) + ' data-s="' + si + '" data-i="' + i + '"/>' : '<rect x="' + n2(x) + '" y="' + n2(dn + gap) + '" width="' + n2(w) + '" height="' + n2(Math.max(0, h - gap)) + '" ' + fill(colour(s, si)) + ' data-s="' + si + '" data-i="' + i + '"/>';
          marks.push({ s: si, i, x: x + w / 2, y: dn + h / 2, name: s.name, label: l, value: v }); dn += h; });
      });
    } else {
      const n = series.length, bw = Math.max(3, Math.min(24, (band * 0.8 - (n - 1) * 2) / n)), gw = n * bw + (n - 1) * 2;
      spec.x.forEach((l, i) => {
        series.forEach((s, si) => {
          const v = +s.values[i] || 0, x = L + band * (i + 0.5) - gw / 2 + si * (bw + 2), h = Math.abs(Y(v) - y0);
          body += '<path d="' + barPath(x, y0, bw, h, v >= 0, 4) + '" ' + fill(colour(s, si)) + (s.ghost ? ' opacity="0.5"' : "") + ' data-s="' + si + '" data-i="' + i + '"/>';
          marks.push({ s: si, i, x: x + bw / 2, y: v >= 0 ? y0 - h : y0 + h, name: s.name, label: l, value: v });
        });
      });
    }
    body += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + n2(y0) + '" y2="' + n2(y0) + '" style="stroke:' + T.muted + ';stroke-width:1"/>';
  }
  if (o.legend) body += legendSvg(spec, series, W, H0, T, colour);
  return { svg: head + body + "</svg>", marks, w: W, h: H };
}
// the legend's entries: one per series (a bar, line or stacked chart of two or more series) or per slice (a pie)
export function legendOf(spec) {
  if (spec.type === "pie" || spec.type === "donut") return spec.x.map((l, i) => ({ name: l, ci: i, others: !!(spec.pts && spec.pts[i] && spec.pts[i].key === "others") }));
  return (spec.series || []).length > 1 ? spec.series.map((s, i) => ({ name: s.name, ci: s.ghost ? 0 : i, others: s.key === "others", ghost: !!s.ghost })) : [];
}
function legendLayout(spec, W) {
  const items = legendOf(spec); let x = 0, rows = items.length ? 1 : 0;
  items.forEach((it) => { const w = 18 + Math.min(160, String(it.name).length * 6.2) + 14; if (x + w > W - 16 && x > 0) { rows++; x = 0; } x += w; });
  return { items, rows };
}
function legendSvg(spec, series, W, H0, T) {
  const { items } = legendLayout(spec, W); let x = 12, y = H0 + 12, out = "";
  items.forEach((it) => {
    const label = String(it.name).length > 26 ? String(it.name).slice(0, 25) + "…" : String(it.name), w = 18 + Math.min(160, label.length * 6.2) + 14;
    if (x + w > W - 4 && x > 12) { x = 12; y += 18; }
    const c = it.others ? T.others : T.series(it.ci);
    out += '<rect x="' + x + '" y="' + (y - 8) + '" width="10" height="10" rx="2" ' + fill(c) + (it.ghost ? ' opacity="0.5"' : "") + '/><text x="' + (x + 15) + '" y="' + (y + 1) + '" ' + fill(T.ink) + ">" + esc(label) + "</text>";
    x += w;
  });
  return out;
}
// what the chart shows, in words (the SVG's description, read by a screen reader)
export function describe(spec) {
  const kind = { bar: "Bar chart", line: "Line chart", pie: "Pie chart", donut: "Donut chart", stacked: "Stacked bar chart" }[spec.type] || "Chart";
  return kind + " of " + (spec.series || []).map((s) => s.name).join(", ") + " by " + (spec.x || []).length + " " + (spec.type === "pie" || spec.type === "donut" ? "parts" : "points") + ". The figures are in the table view.";
}
