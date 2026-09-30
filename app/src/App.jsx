// React's part of the page: the sidebar, and every screen already moved to React, each in its place.
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { subscribe, snapshot, islands } from "./store.js";
import Side from "./Side.jsx";
import SCREENS from "./screens/index.js";

export default function App() {
  useSyncExternalStore(subscribe, snapshot);
  return (
    <>
      {createPortal(<Side />, document.getElementById("side"))}
      {islands().map(({ key, name, host }) => {
        const Screen = SCREENS[name];
        return Screen ? createPortal(<Screen />, host, key) : null;
      })}
    </>
  );
}
