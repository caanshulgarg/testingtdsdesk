// Source Serif 4 (the documents and the headings), kept with the app (SIL Open Font License 1.1: fonts/OFL.txt; from the
// @fontsource/source-serif-4 5.1.0 package, latin): 400, 600, 700 and 400 italic only. Never loaded from another site
// (the app's Content-Security-Policy is font-src 'self' data:). new URL(..., import.meta.url) makes the build keep each
// file and give its address; the PDF's print window gets the same faces by their full address.
const FACES = [
  ["normal", 400, new URL("./fonts/source-serif-4-latin-400-normal.woff2", import.meta.url).href],
  ["normal", 600, new URL("./fonts/source-serif-4-latin-600-normal.woff2", import.meta.url).href],
  ["normal", 700, new URL("./fonts/source-serif-4-latin-700-normal.woff2", import.meta.url).href],
  ["italic", 400, new URL("./fonts/source-serif-4-latin-400-italic.woff2", import.meta.url).href],
];
const abs = (u) => { try { return new URL(u, typeof location === "object" ? location.href : undefined).href; } catch (e) { return u; } };
export const serifCss = () => FACES.map(([style, weight, url]) => "@font-face{font-family:\"Source Serif 4\";font-style:" + style + ";font-weight:" + weight + ";font-display:swap;src:url(\"" + abs(url) + "\") format(\"woff2\")}").join("");
// once, in this page, when Corporate first opens
export function loadSerif() {
  if (typeof document !== "object" || document.getElementById("corp-serif")) return;
  const s = document.createElement("style"); s.id = "corp-serif"; s.textContent = serifCss(); document.head.appendChild(s);
}
