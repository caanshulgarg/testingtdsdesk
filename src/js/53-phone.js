/* ================================================================== */
/* Phone (review item 38): at 600 px and less every table on the page */
/* is shown as cards, one card a row, each value with its column's    */
/* name beside it. The look is in app.css; this only names the cells. */
/* ================================================================== */
const PHONE = typeof matchMedia === "function" ? matchMedia("(max-width:600px)") : null;
// each cell gets data-label from its column's header (colspan counted); a table opts out with class "nocards"
function cardLabels(root){
  if (!PHONE || !PHONE.matches || typeof document === "undefined") return;
  (root || document.getElementById("app") || document).querySelectorAll("table").forEach(t => {
    if (t.classList.contains("nocards") || !t.tHead || !t.tHead.rows.length) return;
    const heads = []; [...t.tHead.rows[t.tHead.rows.length - 1].cells].forEach(c => { const n = c.colSpan || 1, txt = (c.getAttribute("aria-label") || c.textContent || "").replace(/[▲▼⇅↑↓]/g, "").trim(); for (let i = 0; i < n; i++) heads.push(txt); });
    [...t.tBodies].forEach(b => [...b.rows].forEach(r => { let i = 0; [...r.cells].forEach(c => { const want = c.colSpan > 1 ? "" : (heads[i] || ""); if (c.getAttribute("data-label") !== want) c.setAttribute("data-label", want); i += c.colSpan || 1; }); }));
    if (!t.classList.contains("cards")) t.classList.add("cards");
  });
}
function cardsOff(){ if (typeof document !== "undefined") document.querySelectorAll("#app table.cards").forEach(t => t.classList.remove("cards")); }
if (typeof document !== "undefined" && PHONE && typeof MutationObserver === "function"){
  let queued = false;
  const run = () => { queued = false; cardLabels(); };
  const watch = () => { const app = document.getElementById("app"); if (!app) return setTimeout(watch, 300);
    new MutationObserver(() => { if (PHONE.matches && !queued){ queued = true; requestAnimationFrame(run); } }).observe(app, {childList: true, subtree: true}); run(); };
  watch();
  const flip = () => { if (PHONE.matches) cardLabels(); else cardsOff(); };
  if (PHONE.addEventListener) PHONE.addEventListener("change", flip); else if (PHONE.addListener) PHONE.addListener(flip);
}
