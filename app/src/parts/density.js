// next-ui-table-filters (the owner, 16-Nov-2026: "page is eating lot of spaces"):
//  - the rows' density: Compact (the default) or Comfortable (html.comfy, styles/dense.css), chosen in the firm menu and
//    remembered per person in this browser (localStorage fincom:density:<email>; blocked storage: kept while open);
//  - a long help line (p.note of more than 160 letters, nothing to press in it) folded to one line; a click opens it
//    and closes it again. Only a class is added to the line: the line itself is the page's (React's) own.
const key = () => "fincom:density:" + ((typeof S === "object" && S && S.account && S.account.me && S.account.me.email) || "local");
const mem = {};
export function density() {
  const k = key();
  if (!(k in mem)) { let v = null; try { v = localStorage.getItem(k); } catch (e) { v = null; } mem[k] = v === "comfortable" ? "comfortable" : "compact"; }
  return mem[k];
}
export function applyDensity() { document.documentElement.classList.toggle("comfy", density() === "comfortable"); }
export function setDensity(v) {
  const k = key(); mem[k] = v;
  try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: kept while the page is open */ }
  applyDensity(); render();
}

export function clampNotes() {
  applyDensity();
  document.querySelectorAll("#app p.note:not(.tf-clamp)").forEach((p) => {
    if ((p.textContent || "").length > 160 && !p.querySelector("a, button, input, select, textarea, details, code")) {
      p.classList.add("tf-clamp"); p.setAttribute("aria-expanded", "false");
    }
  });
}
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
  const p = e.target && e.target.closest && e.target.closest("#app p.note.tf-clamp");
  if (!p || (window.getSelection && String(window.getSelection())) ) return;
  const open = !p.classList.contains("tf-open");
  p.classList.toggle("tf-open", open); p.setAttribute("aria-expanded", open ? "true" : "false");
});
