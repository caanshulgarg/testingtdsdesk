// The page: the sidebar, the top bar, the client switcher and the main part (Main.jsx), and any React screen placed
// inside an old piece of HTML (<div data-react>). Each part is guarded: one that fails to draw does not take the others down.
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { subscribe, snapshot, islands } from "./store.js";
import Guard from "./Guard.jsx";
import Side from "./Side.jsx";
import TopBar from "./TopBar.jsx";
import Switcher from "./Switcher.jsx";
import SCREENS from "./screens/index.js";
import Main from "./Main.jsx";

let host = null;
function mainHost() {
  if (!host) {
    const app = document.getElementById("app");
    app.textContent = "";
    host = document.createElement("div"); host.className = "react-host"; host.style.display = "contents"; host.dataset.react = "Main";
    app.appendChild(host);
  }
  return host;
}

export default function App() {
  const v = useSyncExternalStore(subscribe, snapshot);
  // the page's main part (#app) is drawn in a host of its own: the old screens' click handlers leave what is in a
  // .react-host to React
  const main = createPortal(<Guard name="the page" v={v}><Main v={v} /></Guard>, mainHost());
  // before the firm's settings are loaded there is only the main part's "Loading…"
  if (!S.firm) return main;
  return (
    <>
      {main}
      {createPortal(<Guard name="the sidebar" v={v} quiet><Side /></Guard>, document.getElementById("side"))}
      <Guard name="the top bar" v={v} quiet><TopBar /></Guard>
      <Guard name="the client switcher" v={v} quiet><Switcher /></Guard>
      {islands().map(({ key, name, host, props }) => {
        const Screen = SCREENS[name];
        return Screen ? createPortal(<Guard name={name} v={v}><Screen {...props} /></Guard>, host, key) : null;
      })}
    </>
  );
}
