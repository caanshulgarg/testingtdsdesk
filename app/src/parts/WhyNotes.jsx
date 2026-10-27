// Every disabled button says why (owner's spec K3, 04-Oct-2026): on hover (its title) AND beside it in plain sight. This
// part puts the button's title, in small grey words, just after each disabled button of the page (the old HTML pieces
// too), and takes the words away when the button is enabled again or goes. A button whose reason is already written
// beside it (an element marked data-why in the same row) gets nothing more.
import { useEffect } from "react";

const ROOTS = ["app", "cobar", "modal"];
function shown(el) { return !!(el && el.offsetParent !== null); }
function said(b, why) {
  for (let p = b.parentElement, up = 0; p && up < 2; p = p.parentElement, up++) {
    if (p.querySelector("[data-why]")) return true;
    const t = (p.innerText || "").replace(b.innerText || "", "");
    if (why.length > 8 && t.includes(why.slice(0, 25))) return true;
  }
  return false;
}
export function whyPass() {
  ROOTS.forEach((id) => {
    const root = document.getElementById(id);
    if (!root) return;
    root.querySelectorAll("button[disabled]").forEach((b) => {
      const why = (b.getAttribute("title") || "").trim(), next = b.nextElementSibling;
      const has = next && next.classList.contains("why-note");
      if (!why || !shown(b) || b.closest(".tsign-wrap, [data-no-why]") || (!has && said(b, why))) { if (has) next.remove(); return; }
      if (has) { if (next.textContent !== why) next.textContent = why; return; }
      const s = document.createElement("span"); s.className = "why-note"; s.textContent = why; s.dataset.whyFor = "";
      b.after(s);
    });
    root.querySelectorAll(".why-note").forEach((s) => {
      const b = s.previousElementSibling;
      if (!b || b.tagName !== "BUTTON" || !b.disabled || (b.getAttribute("title") || "").trim() !== s.textContent) s.remove();
    });
  });
}

export default function WhyNotes() {
  useEffect(() => {
    let raf = 0;
    const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; try { whyPass(); } catch (e) { /* never in the way of the page */ } }); };
    const mo = new MutationObserver((list) => { if (list.some((m) => !(m.target.classList && m.target.classList.contains("why-note")))) soon(); });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "title"] });
    soon();
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}
