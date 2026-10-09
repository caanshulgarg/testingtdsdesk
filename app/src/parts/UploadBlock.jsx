// Upload purchase bills for the open client: drop or choose files, take a photo, type one in, or paste bill details
// (JSON) read elsewhere. Was uploadBlock() in src/js/19.
import { useState } from "react";
import DropZone from "./DropZone.jsx";
import { ReadingCheck, UploadOptions } from "./Reading.jsx";
import Button from "./Button.jsx";

export default function UploadBlock() {
  const co = CO(), f = freeRate(co);
  const [paste, setPaste] = useState("");
  return <>
    <DropZone mode="company" label={"Upload invoices for " + co.name}>
      <strong>Drop {co.name}’s bills here</strong><div className="note">Any number of PDFs, JPGs or photos; or use <b>Upload bills</b> at the top right</div>
    </DropZone>
    <ReadingCheck />
    {f && <p className="note" style={{ margin: "6px 0 0" }}>Read free for this client: <b>{f.pct}%</b> of {f.n} bills ({f.google} by Google OCR, {f.claude} by Claude)</p>}
    <UploadOptions />
    <div className="row" style={{ marginTop: 8 }}>
      <Button className="btn small" onClick={() => doAct("camera")}>Take photo</Button>
      <Button className="btn small" onClick={() => doAct("manual")}>Type an invoice</Button>
      <Button className="btn small" onClick={() => doAct("pasteOpen")}>Paste bill details</Button>
    </div>
    {S.pasteOpen && <div className="pane" style={{ marginTop: 10, padding: 12 }}>
      <label className="f"><span>Bill details in JSON (one bill, or a list of bills)</span>
        <textarea rows={7} autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'{"vendorName": "...", "invoiceNo": "...", ...}'} />
      </label>
      <p className="note" style={{ margin: "6px 0" }}>Use this when photos cannot be read in this view: ask Claude in a chat to read the bill and reply in this app's format, then paste the reply here.</p>
      <div className="row">
        <Button className="btn primary small" onClick={() => addPasted(paste)}>Add to {co.name}</Button>
        <Button className="btn small" onClick={() => doAct("pasteClose")}>Cancel</Button>
      </div>
    </div>}
  </>;
}
