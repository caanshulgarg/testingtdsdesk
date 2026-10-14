// A piece of an old screen (HTML text from a view…() function in src/js) shown inside a React screen, until that
// piece moves to React too. Its buttons keep working through the old click handlers.
// It is drawn again from its HTML at every redraw, as the old screens were: what the page shows always follows the
// saved state (a choice cancelled in a confirm box goes back), and store.js gives the cursor back to the box it was in.
// React screens inside it (<div data-react>) are put back after each redraw, keeping what they hold.
import { useLayoutEffect, useRef } from "react";
import { adopt } from "../store.js";

// quiet refresh (14-Oct-2026): a drawing from a background refresh (quietRender, src/js/01) leaves the piece as it is when
// its HTML is the same (an open section, a scrolled table and the focus stay); a drawing asked for by the person still
// draws it again from its HTML, as above
export default function Legacy({ html, as: Tag = "div", ...rest }) {
  const el = useRef(null), last = useRef(null);
  useLayoutEffect(() => {
    if (!el.current) return;
    const quiet = typeof window.quietDrawing === "function" && window.quietDrawing();
    if (quiet && last.current === (html || "") && el.current.childNodes.length) return;
    last.current = html || "";
    el.current.innerHTML = html || "";
    // a React screen placed inside this piece (the GST API card in the 2B page, say) is put back in its place
    if (el.current.querySelector("[data-react]")) adopt();
  });
  if (!html) return null;
  return <Tag ref={el} style={{ display: "contents" }} data-legacy="" {...rest} />;
}
