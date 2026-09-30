// The GST tab of a client's books: which return or working (the parts), for which month and GSTIN, and the
// downloads for the portal. Was viewBooksGst (src/js/18). The parts follow the GSTIN's filing type (gstParts):
// monthly (GSTR-1, 3B, …), quarterly QRMP (This quarter, …) or composition (CMP-08, GSTR-4); without a day book only
// 2B and the returns filed. Each part is still an old page (gstPartHtml), shown through <Legacy>.
//
// State: S.gstYm (the month, YYYYMM), S.gstReg (the GSTIN's state code), S.gstPart; a GSTIN or filing type seen
// for the first time opens on its first part (S.gstSeen).
import Legacy from "../parts/Legacy.jsx";
import HelpButton from "../parts/HelpButton.jsx";

export default function Gst() {
  const b = S.books, months = GSTR.months(), { parts, ftype, regs, noBooks } = gstParts(b);
  if (!regs.length) return <div className="bk-none">Add the client’s GSTIN in <button className="linkbtn" onClick={() => goGstSettings()}>GST settings</button> to use the GST tab.
    With it, 2B can be fetched from the portal or brought in, and the returns filed kept, with or without a Tally day book. GSTR-1 and 3B are worked out from the day book, brought in under “From Tally”.</div>;
  if (!S.gstYm || !months.includes(S.gstYm)) S.gstYm = months[months.length - 1] || "";
  // a return is filed for one GSTIN: the company's own first, never the registrations added together
  if (!regs.some((g) => g.slice(0, 2) === S.gstReg)) { const own = String((CO() || {}).gstin || "").slice(0, 2); S.gstReg = (regs.find((g) => g.slice(0, 2) === own) || regs[0]).slice(0, 2); }
  const seen = (S.gstReg || "") + "|" + ftype;
  if (!S.gstPart || !parts.some((x) => x[0] === S.gstPart) || (S.gstSeen && S.gstSeen !== seen)) S.gstPart = parts[0][0];
  S.gstSeen = seen;
  const part = S.gstPart, noReturn = ftype === "qrmp" && !GSTSet.isQEnd(S.gstYm || ""), gNow = regs.find((g) => g.slice(0, 2) === S.gstReg) || "";
  const noDownload = ["r2b", "rev", "inreg", "follow", "qtr", "vault"].includes(part) || ftype === "comp";
  const forWhat = ftype === "qrmp" ? " for the quarter" : " for the portal";
  return <>
    <Legacy html={ledgerBanner(b, "gst")} />
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
    <Legacy html={gstPartHtml(b, part)} />
  </>;
}
