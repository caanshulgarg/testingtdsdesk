// A piece of an old screen (HTML text from a view…() function in src/js) shown inside a React screen, until that
// piece moves to React too. Its buttons keep working through the old click handlers.
// It is drawn again from its HTML at every redraw, as the old screens were: what the page shows always follows the
// saved state (a choice cancelled in a confirm box goes back), and store.js gives the cursor back to the box it was in.
import { useLayoutEffect, useRef } from "react";

export default function Legacy({ html, as: Tag = "div", ...rest }) {
  const el = useRef(null);
  useLayoutEffect(() => { if (el.current) el.current.innerHTML = html || ""; });
  if (!html) return null;
  return <Tag ref={el} style={{ display: "contents" }} data-legacy="" {...rest} />;
}
