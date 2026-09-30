// React's part of the page: the sidebar, the top bar, the client switcher, and every screen already moved to React,
// each in its place. Each part is guarded: one that fails to draw does not take the others down.
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { subscribe, snapshot, islands } from "./store.js";
import Guard from "./Guard.jsx";
import Side from "./Side.jsx";
import TopBar from "./TopBar.jsx";
import Switcher from "./Switcher.jsx";
import SCREENS from "./screens/index.js";

export default function App() {
  const v = useSyncExternalStore(subscribe, snapshot);
  // before the firm's settings are loaded there is nothing to draw but the old screens' "Loading…"
  if (!S.firm) return null;
  return (
    <>
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
