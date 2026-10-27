// The page: the sidebar, the top bar, the client switcher and the main part (Main.jsx), and any React screen placed
// inside an old piece of HTML (<div data-react>). Each part is guarded: one that fails to draw does not take the others down.
import { Suspense, lazy, useLayoutEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { subscribe, snapshot, islands } from "./store.js";
import Guard from "./Guard.jsx";
import Side from "./Side.jsx";
import TopBar from "./TopBar.jsx";
import Switcher from "./Switcher.jsx";
import WhyNotes from "./parts/WhyNotes.jsx";
import { AssistantLauncher } from "./parts/AssistantLauncher.jsx";
// the Assistant's panel: loaded the first time it opens, then kept (so it can slide out)
const Assistant = lazy(() => import("./parts/Assistant.jsx"));
// announcements from FinCom (one bar) and the feature flags: a small chunk of its own, loaded after the page
const Announce = lazy(() => import("./parts/Announce.jsx"));
let asstEver = false;
function AssistantSlot() {
  const a = typeof ASST === "object" ? ASST.st() : {};
  if (a.open) asstEver = true;
  return <><AssistantLauncher />{asstEver && <Suspense fallback={null}><Assistant /></Suspense>}</>;
}
// integ-console (27-Oct-2026, the first file's budget): the check before filing and the firm's details are files of their
// own, fetched the first time they open (as the Assistant's panel); once opened they stay, so they can close as before
const PreFilePanel = lazy(() => import("./parts/PreFile.jsx"));
const FirmSetup = lazy(() => import("./parts/FirmSetup.jsx"));
let pfEver = false, fsEver = false;
function PreFileSlot() {
  if (S.prefile && S.prefile.open) pfEver = true;
  return pfEver ? <Suspense fallback={null}><PreFilePanel /></Suspense> : null;
}
function FirmSetupSlot() {
  if (typeof firmSetupDue === "function" && firmSetupDue()) fsEver = true;
  return fsEver ? <Suspense fallback={null}><FirmSetup /></Suspense> : null;
}
import SCREENS from "./screens/index.js";
import Main from "./Main.jsx";
import { clearBoot, bootDone } from "./boot.js";

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
  useLayoutEffect(() => { if (S.firm) bootDone(); });
  // before the firm's settings are loaded: the frame index.html drew, as it is (one loading state, not a second "Loading…")
  if (!S.firm) return null;
  clearBoot();
  // the page's main part (#app) is drawn in a host of its own: the old screens' click handlers leave what is in a
  // .react-host to React
  const main = createPortal(<Guard name="the page" v={v}><Main v={v} /></Guard>, mainHost());
  return (
    <>
      {main}
      {createPortal(<Guard name="the sidebar" v={v} quiet><Side /></Guard>, document.getElementById("side"))}
      <Guard name="the top bar" v={v} quiet><TopBar /></Guard>
      <Guard name="the client switcher" v={v} quiet><Switcher /></Guard>
      <Guard name="the firm's details" v={v} quiet><FirmSetupSlot /></Guard>
      <WhyNotes />
      <Guard name="the assistant" v={v} quiet><AssistantSlot /></Guard>
      <Guard name="the check before filing" v={v} quiet><PreFileSlot /></Guard>
      <Guard name="announcements" v={v} quiet><Suspense fallback={null}><Announce /></Suspense></Guard>
      {islands().map(({ key, name, host, props }) => {
        const Screen = SCREENS[name];
        return Screen ? createPortal(<Guard name={name} v={v}><Suspense fallback={null}><Screen {...props} /></Suspense></Guard>, host, key) : null;
      })}
    </>
  );
}
