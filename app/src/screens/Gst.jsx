// The GST tab of a client's books: which return or working (the parts), for which month and GSTIN, and the
// downloads for the portal. Was viewBooksGst (src/js/18). The parts follow the GSTIN's filing type (gstParts):
// monthly (GSTR-1, 3B, …), quarterly QRMP (This quarter, …) or composition (CMP-08, GSTR-4); without a day book only
// 2B and the returns filed. GSTR-1 and 3B are gst/Returns.jsx, the input register gst/InputRegister.jsx, 2B gst/TwoB.jsx, amendments, advances and reversal gst/Workings.jsx, GSTR-9 and 9C gst/Annual.jsx, ITC follow-up gst/ItcFollow.jsx, returns filed gst/ReturnsFiled.jsx, QRMP, CMP-08 and GSTR-4 gst/Periodic.jsx, notices parts/Ai.jsx.
//
// State: S.gstYm (the month, YYYYMM), S.gstReg (the GSTIN's state code), S.gstPart; a GSTIN or filing type seen
// for the first time opens on its first part (S.gstSeen).
import { Notices } from "../parts/Ai.jsx";
import { LedgerBanner } from "../parts/Notes.jsx";
import HelpButton from "../parts/HelpButton.jsx";
import { Gstr1, Gstr3b } from "./gst/Returns.jsx";
import InputRegister from "./gst/InputRegister.jsx";
import TwoB from "./gst/TwoB.jsx";
import { Amendments, Advances, Reversal } from "./gst/Workings.jsx";
import { Gst9, Gst9c } from "./gst/Annual.jsx";
import ItcFollow from "./gst/ItcFollow.jsx";
import ReturnsFiled from "./gst/ReturnsFiled.jsx";
import { Qrmp, Cmp08, Gstr4 } from "./gst/Periodic.jsx";

export default function Gst() {
  const b = S.books, months = GSTR.months(), regs = GSTR.gstins(b) || [];
  if (!regs.length) return <div className="bk-none">Add the client’s GSTIN in <button className="linkbtn" onClick={() => goGstSettings()}>GST settings</button> to use the GST tab.
    With it, 2B can be fetched from the portal or brought in, and the returns filed kept, with or without a Tally day book. GSTR-1 and 3B are worked out from the day book, brought in under “From Tally”.</div>;
  if (!S.gstYm || !months.includes(S.gstYm)) S.gstYm = months[months.length - 1] || "";
  // a return is filed for one GSTIN: the company's own first, never the registrations added together
  if (!regs.some((g) => g.slice(0, 2) === S.gstReg)) { const own = String((CO() || {}).gstin || "").slice(0, 2); S.gstReg = (regs.find((g) => g.slice(0, 2) === own) || regs[0]).slice(0, 2); }
  // the parts follow the filing type of this month and GSTIN, so both are settled first
  const { parts, ftype, noBooks } = gstParts(b);
  const seen = (S.gstReg || "") + "|" + ftype;
  if (!S.gstPart || !parts.some((x) => x[0] === S.gstPart) || (S.gstSeen && S.gstSeen !== seen)) S.gstPart = parts[0][0];
  S.gstSeen = seen;
  const part = S.gstPart, noReturn = ftype === "qrmp" && !GSTSet.isQEnd(S.gstYm || ""), gNow = regs.find((g) => g.slice(0, 2) === S.gstReg) || "";
  const noDownload = ["r2b", "rev", "inreg", "follow", "qtr", "vault"].includes(part) || ftype === "comp";
  const forWhat = ftype === "qrmp" ? " for the quarter" : " for the portal";
  return <>
    <LedgerBanner b={b} which="gst" />
    <nav className="sbar" aria-label="GST">{parts.map(([id, l]) => <button key={id} data-part={id} aria-selected={part === id} onClick={() => gstPartGo(id)}>{l}</button>)}</nav>
    <div className="revfilter">
      <select aria-label="Month" value={S.gstYm} onChange={(ev) => gstSetYm(ev.target.value)}>{months.map((m) => <option key={m} value={m}>{GSTR.label(m)}</option>)}</select>
      {regs.length > 1 && <select aria-label="GSTIN" value={S.gstReg} onChange={(ev) => gstSetReg(ev.target.value)}>{regs.map((g) => <option key={g} value={g.slice(0, 2)}>{g}</option>)}</select>}
      {!noDownload && <button className="btn small" onClick={() => doAct("gstExcel")}>Download GSTR-1 and 3B</button>}
      {part === "amend" && ftype === "monthly" && <button className="btn small primary" onClick={() => doAct("gstJson")}>Download GSTR-1 JSON with these</button>}
      {part === "r1" && !noReturn && <button className="btn small primary" onClick={() => doAct("gstJson")}>Download GSTR-1 JSON{forWhat}</button>}
      {part === "r3b" && !noReturn && <button className="btn small primary" onClick={() => doAct("gst3bJson")}>Download GSTR-3B JSON{forWhat}</button>}
      {gNow && <span className="note" style={{ alignSelf: "center" }}><b>{gNow}</b> · {GSTRegs.state(gNow)} · {GSTSet.typeLabel(ftype)}
        {GSTSet.peek(S.gstReg).portalUser ? " · portal user " + GSTSet.peek(S.gstReg).portalUser : ""} · <button className="linkbtn" onClick={() => goGstSettings()}>GST settings</button></span>}
      <HelpButton />
    </div>
    {noBooks && <p className="note" style={{ margin: "0 0 10px", color: "#B9541B" }}>No Tally day book here yet. 2B and the returns filed work without it; GSTR-1, 3B, the input register and the other workings need the day book, brought in under “From Tally” or read from Tally.</p>}
    {ftype === "qrmp" && (part === "r1" || part === "r3b") && <p className="note" style={{ margin: "0 0 10px" }}>Quarterly (QRMP) filer: this is the working for {GSTR.label(S.gstYm)}
      {GSTSet.isQEnd(S.gstYm) ? "; the downloads cover the whole of " + GSTSet.qLabel(S.gstYm) + "." : ", for reference; this month has no GSTR-1 or 3B — see “This quarter”."}</p>}
    {part === "r1" ? <Gstr1 b={b} /> : part === "r3b" ? <Gstr3b b={b} /> : part === "inreg" ? <InputRegister b={b} /> : part === "r2b" ? <TwoB b={b} /> : part === "amend" ? <Amendments b={b} /> : part === "adv" ? <Advances /> : part === "rev" ? <Reversal b={b} /> : part === "g9" ? <Gst9 b={b} /> : part === "g9c" ? <Gst9c /> : part === "follow" ? <ItcFollow /> : part === "vault" ? <ReturnsFiled b={b} /> : part === "qtr" ? <Qrmp /> : part === "cmp08" ? <Cmp08 /> : part === "gstr4" ? <Gstr4 /> : part === "notices" ? <Notices b={b} kind="gst" /> : null}
  </>;
}
