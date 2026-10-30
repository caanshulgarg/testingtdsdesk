// "More" (the TDS & GST makeover, 11-Oct-2026): the rare actions and the long explanations of a page, out of sight until
// asked for. A native <details>, so it opens with a click or the keyboard and needs no portal; a click on an action
// inside closes it again. items: [label, onClick, props?]; children: words shown inside, under the actions.
import { useEffect, useRef } from "react";

// A page's tab row (nav.sbar) "More": its menu is placed from the button's own rectangle, fixed to the window, under the
// button and moved in only to stay on screen (owner, 30-Oct-2026: on Safari the menu opened at the far left over the
// sidebar: it had no top / left of its own, and Safari puts an absolutely placed box's "static position" inside a flex
// row differently from Chromium). On a phone (600 wide or less) it spans the window less 16px each side, as before.
function place(d) {
  if (!d || !d.open || !d.parentElement || !d.parentElement.matches("nav.sbar")) return;
  const pop = d.querySelector(":scope > .more-pop"), sum = d.querySelector(":scope > summary");
  if (!pop || !sum) return;
  const b = sum.getBoundingClientRect(), vw = document.documentElement.clientWidth, phone = vw <= 600;
  Object.assign(pop.style, { position: "fixed", marginTop: "0", top: Math.round(b.bottom + 4) + "px", maxWidth: (vw - 16) + "px" });
  if (phone) { Object.assign(pop.style, { left: "16px", right: "16px" }); return; }
  pop.style.right = "auto"; pop.style.left = Math.round(b.left) + "px";
  const w = pop.getBoundingClientRect().width;
  pop.style.left = Math.round(Math.max(8, Math.min(b.left, vw - 8 - w))) + "px";
}

export default function More({ label = "More", ariaLabel, items = [], children, align = "end", ...rest }) {
  const ref = useRef(null);
  // while a tab row's menu is open, it follows its button when the page scrolls or the window changes
  useEffect(() => {
    const on = () => place(ref.current);
    window.addEventListener("scroll", on, true); window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, []);
  const close = () => { if (ref.current) ref.current.open = false; };
  const list = items.filter(Boolean);
  if (!list.length && !children) return null;
  return <details className="more" data-align={align} ref={ref} onToggle={() => place(ref.current)} {...rest}>
    <summary className="btn small more-btn" aria-label={ariaLabel || label}>{label}{label === "⋯" ? null : <span aria-hidden="true" className="more-caret">▾</span>}</summary>
    {/* any button inside (an item, or one among the words) is a choice: the menu closes (round 3, 14-Oct-2026); a click
        outside or Esc closes it too (parts/dismiss.js) */}
    <div className="more-pop" role="group" aria-label={ariaLabel || label} onClick={(ev) => { if (ev.target.closest && ev.target.closest("button, a[href]")) close(); }}>
      {list.map(([l, go, props], i) => <button key={i} type="button" className="more-item" onClick={() => { close(); go(); }} {...(props || {})}>{l}</button>)}
      {children && <div className="more-words">{children}</div>}
    </div>
  </details>;
}
