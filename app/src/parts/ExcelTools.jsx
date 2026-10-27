// A page's Excel, one way everywhere (next-excel-buttons, 27-Oct-2026; the owner: "download and upload excel button should be
// proper in TDS and GST"): at the right end of the page's toolbar row (the tab row of a return, else the filter row over
// the table), "Download Excel" then "Upload Excel" (only where the page brings an Excel back; the upload always opens its
// preview with Apply / Cancel first), the same icon, words and size (32 px) on every TDS and GST page, never in a table or
// a ⋯ menu, at most one of each on a page.
//   down: a function (one workbook), or [[label, onClick, props?], …] (the page has several: Download Excel ▾ lists them)
//   up:   a function (opens the page's own file box), or nothing
import More from "./More.jsx";
import { Download, Upload } from "lucide-react";

const DownIcon = () => <Download size={14} aria-hidden="true" className="xl-ic" />;

export default function ExcelTools({ down, up, downTitle, upTitle, busy = "", downProps = {}, upProps = {}, className = "", ...rest }) {
  const list = Array.isArray(down) ? down.filter(Boolean) : [];
  const one = typeof down === "function" ? down : list.length === 1 ? list[0][1] : null;
  if (!one && !list.length && !up) return null;
  return <span className={("xl-tools " + className).trim()} data-xl-tools="" {...rest}>
    {one ? <button type="button" className="btn small xl-btn" data-xl="down" title={downTitle || (list[0] && list[0][0]) || undefined} disabled={!!busy} onClick={one} {...downProps} {...(list[0] && list[0][2]) || {}}>
      <DownIcon />{busy === "down" ? "Making…" : "Download Excel"}</button>
      : list.length > 0 ? <More label={<><DownIcon />Download Excel</>} ariaLabel="Download Excel" data-xl="down" items={list} {...downProps} /> : null}
    {up && <button type="button" className="btn small xl-btn" data-xl="up" title={upTitle || "Bring an Excel back: a preview of every change first, then Apply"} disabled={!!busy} onClick={up} {...upProps}>
      <Upload size={14} aria-hidden="true" className="xl-ic" />{busy === "up" ? "Reading…" : "Upload Excel"}</button>}
  </span>;
}
