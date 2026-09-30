// A box to drop files on or click (or Enter/Space) to choose them. mode "auto": each bill goes to the client whose
// GSTIN it is billed to; "company": the open client. handleFiles/pickFiles are in src/js/27-firm-account.js.
import { useState } from "react";

export default function DropZone({ mode, label, className = "", children }) {
  const [over, setOver] = useState(false);
  return (
    <div className={"drop" + (className ? " " + className : "") + (over ? " over" : "")} tabIndex={0} role="button" aria-label={label}
      onClick={() => pickFiles(mode)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickFiles(mode); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); handleFiles(Array.from(e.dataTransfer.files || []), mode); }}>
      {children}
    </div>
  );
}
