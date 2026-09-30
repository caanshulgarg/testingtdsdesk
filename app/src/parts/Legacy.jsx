// A piece of an old screen (HTML text from a view…() function in src/js) shown inside a React screen, until that
// piece moves to React too. Its buttons keep working through the old click handlers.
// It is drawn again from its HTML at every redraw, as the old screens were: what the page shows always follows the
// saved state (a choice cancelled in a confirm box goes back), and store.js gives the cursor back to the box it was in.
// React screens inside it (<div data-react>) are put back after each redraw, keeping what they hold.
import { useLayoutEffect, useRef } from "react";
import { adopt } from "../store.js";

export default function Legacy({ html, as: Tag = "div", ...rest }) {
  const el = useRef(null);
  useLayoutEffect(() => {
    if (!el.current) return;
    el.current.innerHTML = html || "";
    // a React screen placed inside this piece (the GST API card in the 2B page, say) is put back in its place
    if (el.current.querySelector("[data-react]")) adopt();
  });
  if (!html) return null;
  return <Tag ref={el} style={{ display: "contents" }} data-legacy="" {...rest} />;
}
