// A row's detail beside the row (ui-tidy, 13-Oct-2026; the owner: "every detail is showing at the last of the page"): Arc's
// Drawer from the right on a computer, the whole screen on a phone (styles/tidy.css), never under the page. One detail at
// a time, kept in the address (openDetail / closeDetail / detailOpen, src/js/52): Refresh opens it again, Back, Esc and ✕
// close it. Short details open under their row instead (ListTable's `after`).
//   <DetailDrawer kind="gstFiled" title="Mar-2026" description="Filed against FinCom">…</DetailDrawer>
//   a row: onClick={() => openDetail("gstFiled", ym)}; the open one: detailOpen("gstFiled")
import { useRef } from "react";
import { Drawer, DrawerContent } from "@/registry/components/drawer/drawer";

export default function DetailDrawer({ kind, title, description, children, wide = false }) {
  const id = detailOpen(kind), open = id != null;
  // the content stays while the panel slides out
  const last = useRef(null);
  if (open) last.current = { id, title, description, children };
  const shown = last.current;
  return <Drawer open={open} onOpenChange={(o) => { if (!o) closeDetail(); }}>
    <DrawerContent className={"ddraw" + (wide ? " ddraw-wide" : "")} data-detail={kind} data-detail-id={shown ? shown.id : ""} title={(shown && shown.title) || ""}
      description={(shown && shown.description) || undefined} closeLabel="Close" aria-describedby={undefined}
      // in the page (#app), still over it: what it says is the page's (tests and printing read #app)
      portal={document.getElementById("app")}
      // Esc is the app's (src/js/52), so it closes this first and the client stays open
      onEscapeKeyDown={(ev) => ev.preventDefault()}>
      {shown ? shown.children : null}
    </DrawerContent>
  </Drawer>;
}
