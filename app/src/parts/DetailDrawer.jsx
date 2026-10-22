// A row's detail beside the row (ui-tidy, 13-Oct-2026; the owner: "every detail is showing at the last of the page"): Arc's
// Drawer from the right on a computer, the whole screen on a phone (styles/tidy.css), never under the page. One detail at
// a time, kept in the address (openDetail / closeDetail / detailOpen, src/js/52): Refresh opens it again, Back, Esc and ✕
// close it. Short details open under their row instead (ListTable's `after`).
//   <DetailDrawer kind="gstFiled" title="Mar-2026" description="Filed against FinCom">…</DetailDrawer>
//   a row: onClick={() => openDetail("gstFiled", ym)}; the open one: detailOpen("gstFiled")
//
// next-fix-drawers (22-Oct-2026; the owner: "While adding deductee field, side bar is not getting close… pls check everywhere
// in panel where side bar is not getting closed"; then "If I click on the main screen also.. it should close right away").
// Every side panel is a Panel, and closes one way (app/src/parts/dismiss.js, ROUND 55's overlay stack):
//   - ✕, Cancel, Esc, a click anywhere on the page outside it, and Back close it at once; nothing ever asks first;
//   - it is not modal: no see-through layer over the page, no focus trap, so the click outside always lands (the first
//     click only closes, as for every overlay);
//   - Esc is the panel's: it closes the panel and goes no further (the app's own Esc would otherwise leave the client);
//   - Back closes it and the page stays (a step in the browser's history while it is open, on a computer too);
//   - what was typed and not saved is kept as a draft for that panel and item (useDraft, in memory for the session):
//     opening the same item again shows it, with one line "Unsaved changes kept · Discard"; Save clears it.
import { useId, useRef, useState } from "react";
import { Drawer, DrawerContent } from "@/registry/components/drawer/drawer";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { useDismiss } from "./dismiss.js";

const DRAFTS = new Map();   // "kind|item" -> what was typed and not saved (this session only)
// useDraft(kind, item): {value (null: no draft), set(v), clear(), kept (a draft was there when this item opened)}
export function useDraft(kind, item) {
  const id = kind + "|" + (item == null ? "" : item), live = item != null && item !== "";
  const [, tick] = useState(0), seen = useRef({ id: null, kept: false });
  if (seen.current.id !== id) seen.current = { id, kept: live && DRAFTS.has(id) };
  const has = live && DRAFTS.has(id);
  return {
    value: has ? DRAFTS.get(id) : null,
    kept: has && seen.current.kept,
    set(v) { if (!live) return; DRAFTS.set(id, v); tick((n) => n + 1); },
    clear() { DRAFTS.delete(id); seen.current.kept = false; tick((n) => n + 1); },
  };
}
if (typeof window !== "undefined") window.FCDrafts = { has: (k, i) => DRAFTS.has(k + "|" + i), size: () => DRAFTS.size };

// the one side panel. open; onClose(how): how is "x", "esc", "outside" or "back"; draft: a useDraft() to show the kept line;
// attrs: the data- attributes of its box; back: false where the address already has the step (DetailDrawer)
export function Panel({ open, onClose, title, description, wide, cls, draft, attrs, back = "always", children }) {
  const uid = useId(), ref = useRef(null);
  if (!ref.current) ref.current = { get current() { return document.querySelector('[data-panel="' + CSS.escape(uid) + '"]'); } };
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useDismiss(!!open, ref.current, (how) => closeRef.current(how), { back });
  // the content stays while the panel slides out
  const last = useRef(null);
  if (open) last.current = { title, description, children, draft };
  const shown = last.current, d = shown && shown.draft;
  return <Drawer open={!!open} modal={false} onOpenChange={(o) => { if (!o) closeRef.current("x"); }}>
    <DrawerContent className={"ddraw" + (cls ? " " + cls : "") + (wide ? " ddraw-wide" : "")} data-panel={uid} {...(attrs || {})} title={(shown && shown.title) || ""}
      description={(shown && shown.description) || undefined} closeLabel="Close" aria-describedby={undefined}
      // in the page (#app), still over it: what it says is the page's (tests and printing read #app)
      portal={document.getElementById("app")}
      // a click outside and Esc are dismiss.js's (above): Radix's own would close it a second time
      onInteractOutside={(ev) => ev.preventDefault()} onEscapeKeyDown={(ev) => ev.preventDefault()}>
      {d && d.kept ? <p className="note ddraw-kept" data-draft-kept="">Unsaved changes kept · <button type="button" className="linkbtn" data-draft-discard="" onClick={() => d.clear()}>Discard</button></p> : null}
      {shown ? shown.children : null}
    </DrawerContent>
  </Drawer>;
}

// the same for a dialog in the middle of the page (TDS: Move to a challan, Split the row): ✕, Esc, a click outside it and
// Back close it at once; its dimmed backdrop is part of it (a click there is outside)
export function PanelDialog({ open, onClose, title, description, attrs, children }) {
  const uid = useId(), ref = useRef(null);
  if (!ref.current) ref.current = { get current() { return document.querySelector('[data-panel="' + CSS.escape(uid) + '"]'); } };
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useDismiss(!!open, ref.current, (how) => closeRef.current(how), { back: "always" });
  const no = (ev) => ev.preventDefault();
  return <Dialog open={!!open} onOpenChange={(o) => { if (!o) closeRef.current("x"); }}>
    {open ? <DialogContent title={title} description={description} data-panel={uid} {...(attrs || {})} onPointerDownOutside={no} onInteractOutside={no} onEscapeKeyDown={no}>{children}</DialogContent> : null}
  </Dialog>;
}

export default function DetailDrawer({ kind, title, description, children, wide = false }) {
  const id = detailOpen(kind), open = id != null;
  const shown = useRef(""); if (open) shown.current = id;
  // its step in the history is the address's own (openDetail), so Back is the router's: closeDetail
  return <Panel open={open} onClose={() => closeDetail()} back={false} wide={wide} title={title} description={description}
    attrs={{ "data-detail": kind, "data-detail-id": shown.current }}>{children}</Panel>;
}
