// The GST tab of a client's books: which return or working (the parts), for which month and GSTIN, and the
// downloads for the portal. Was viewBooksGst (src/js/18). The parts follow the GSTIN's filing type (gstParts):
// monthly (GSTR-1, 3B, …), quarterly QRMP (This quarter, …) or composition (CMP-08, GSTR-4); without a day book only
// 2B and the returns filed. GSTR-1 and 3B are gst/Returns.jsx, the input register gst/InputRegister.jsx, 2B gst/TwoB.jsx, amendments, advances and reversal gst/Workings.jsx, GSTR-9 and 9C gst/Annual.jsx, ITC follow-up gst/ItcFollow.jsx, returns filed gst/ReturnsFiled.jsx, QRMP, CMP-08 and GSTR-4 gst/Periodic.jsx, notices parts/Ai.jsx.
//
// Redesign of 09-Oct-2026 (the owner's request, Winman's lists as the pattern): a bar of financial year → period
// (months; for a QRMP filer, the quarter's GSTR-1 and 3B at its last month and IFF in the first two) → GSTIN; the year's
// status grid of returns × months (GSTR-1/IFF, GSTR-3B, GSTR-2B, GSTR-9: grey not started, blue ready, red mismatch,
// green filed), each cell opening that return and period; a return open shows its parts as before, and GSTR-1 and 3B
// a tab at a time: Summary · Details · Differences (2B match for 3B) · File / JSON, with the downloads on File.
// Nothing here works out a figure: the statuses are read from what is kept (GSTV, the filing dates; GSTCMP, the filed
// returns fetched against the working; GST2B, the 2B brought in).
//
// The TDS & GST makeover (round 46, 11-Oct-2026; the owner: "page looks very heavy … one page = one job"): four tabs,
// each its own address — Returns (the year's grid, and GSTR-1, 3B, the quarter, CMP-08, GSTR-4, GSTR-9, 9C, amendments,
// advances, the returns filed, notices) · 2B & ITC (2B, the input register, ITC follow-up, reversal) · Supplier health ·
// Checks (filed vs FinCom, filed vs books). A GSTR-1 or 3B open has a summary card on top (status, the one download, More).
//
// State: S.gstYm (the month, YYYYMM), S.gstReg (the GSTIN's state code), S.gstView (year | return), S.gstPart,
// S.gstSub (the tab of GSTR-1 or 3B), all kept in the address (Route.booksMore, src/js/52); a GSTIN or filing type seen
// for the first time opens on its first part (S.gstSeen).
import { PreFileButton } from "../parts/PreFile.jsx";
import NotRead from "../parts/NotRead.jsx";
import { Notices } from "../parts/Ai.jsx";
import { LedgerBanner } from "../parts/Notes.jsx";
import TaxLedgers from "./books/TaxLedgers.jsx";
import HelpButton from "../parts/HelpButton.jsx";
import More from "../parts/More.jsx";
import { Gstr1, Gstr3b } from "./gst/Returns.jsx";
import InputRegister from "./gst/InputRegister.jsx";
import TwoB from "./gst/TwoB.jsx";
import { Amendments, Advances, Reversal } from "./gst/Workings.jsx";
import { Gst9, Gst9c } from "./gst/Annual.jsx";
import ItcFollow from "./gst/ItcFollow.jsx";
import SupplierHealth from "./gst/SupplierHealth.jsx";
import ReturnsFiled from "./gst/ReturnsFiled.jsx";
import FiledCompare from "./gst/FiledCompare.jsx";
import Recon from "./gst/Recon.jsx";
import { Qrmp, Cmp08, Gstr4 } from "./gst/Periodic.jsx";
import "../parts/returns.css";
import Filters, { Field } from "../parts/Filters.jsx";
import { Answer } from "../parts/Answer.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const dmy = (s) => (s ? GSTAmend.dmy(String(s).replace(/-/g, "")) : "");
const fyMonths = (fy) => { const y = +String(fy).slice(0, 4), out = []; for (let m = 4; m <= 15; m++) out.push((m <= 12 ? y : y + 1) + String(m <= 12 ? m : m - 12).padStart(2, "0")); return out; };
const RET = { r1: "GSTR-1", iff: "IFF", r3b: "GSTR-3B", r2b: "GSTR-2B", g9: "GSTR-9" };
const SUBS = { r1: [["summary", "Summary"], ["details", "Details"], ["diff", "Differences"], ["file", "Files"]],
  r3b: [["summary", "Summary"], ["details", "Details"], ["diff", "2B match"], ["file", "Files"]] };
// the GST tabs (round 46) and the parts of each; a part not listed is a return
const SECS = [["returns", "Returns"], ["itc", "2B & ITC"], ["health", "Supplier health"], ["checks", "Checks"]];
const SEC_PARTS = { itc: ["r2b", "inreg", "follow", "rev"], health: ["health"], checks: ["filedcmp", "recon"] };
export const gstSecOf = (part, view) => (view === "year" ? "returns" : Object.keys(SEC_PARTS).find((k) => SEC_PARTS[k].includes(part)) || "returns");

// the label of a period in the bar: a month, or for a QRMP filer the quarter (its last month) or IFF (the first two)
function periodLabel(ym, reg) {
  const t = GSTSet.typeOf(ym, reg);
  if (t === "qrmp") return GSTSet.isQEnd(ym) ? GSTSet.qLabel(ym) + " · GSTR-1 and 3B (" + GSTR.label(ym) + ")" : GSTR.label(ym) + " · IFF";
  if (t === "comp") return GSTR.label(ym) + (GSTSet.isQEnd(ym) ? " · CMP-08 " + GSTSet.qLabel(ym) : "");
  return GSTR.label(ym);
}

// the bar: financial year, period, GSTIN; the filing type, GST settings and the Excel download under More beside them
function Bar({ months, regs, gNow, ftype, noDownload }) {
  const fys = Array.from(new Set(months.map((m) => GSTF.fyOf(m)))).sort().reverse(), fy = GSTF.fyOf(S.gstYm || "");
  const inFy = months.filter((m) => GSTF.fyOf(m) === fy);
  // ui-tidy (13-Oct-2026): the one filter bar (parts/Filters.jsx): the year and the period, then the GSTIN; the filing
  // type, GST settings and More at its end
  return <Filters className="tg-bar" label="Choose the return" data-gst-bar=""
    period={<>
      <Field label="Financial Year"><select aria-label="Financial year" value={fy} onChange={(ev) => { const l = months.filter((m) => GSTF.fyOf(m) === ev.target.value); gstSetYm(l[l.length - 1]); }}>
        {fys.map((f) => <option key={f} value={f}>{f}</option>)}</select></Field>
      <Field label={ftype === "qrmp" ? "Quarter or month" : "Month"}>
        <select aria-label="Month" value={S.gstYm} onChange={(ev) => gstSetYm(ev.target.value)}>{inFy.map((m) => <option key={m} value={m}>{periodLabel(m, S.gstReg || "")}</option>)}</select></Field>
    </>}
    client={regs.length > 1 ? <Field label="GSTIN"><select aria-label="GSTIN" value={S.gstReg} onChange={(ev) => gstSetReg(ev.target.value)}>{regs.map((g) => <option key={g} value={g.slice(0, 2)}>{g}</option>)}</select></Field> : null}
    count={gNow ? (regs.length > 1 ? "" : gNow + " · ") + GSTSet.typeLabel(ftype) + (GSTSet.peek(S.gstReg).portalUser ? " · portal user " + GSTSet.peek(S.gstReg).portalUser : "") : ""}
    tools={<><button className="linkbtn" onClick={() => goGstSettings()}>GST settings</button>
      <More items={[!noDownload && ["Download GSTR-1 and 3B (Excel)", () => doAct("gstExcel")]]} /></>} />;
}

// one cell of the grid
function Cell({ c, ym, part, label }) {
  if (!c) return <td><div className="rp-cell st-na" aria-hidden="true">—</div></td>;
  const words = c.st === "none" ? c.none || "Not started" : c.st === "bad" ? (c.errors ? "Errors " : "Mismatch ") + c.n : c.st === "filed" ? "Filed " + c.on : c.ready || "Ready";
  return <td><button className={"rp-cell st-" + c.st} data-cell={label + "|" + ym} data-status={c.st} aria-label={label + " " + (ym.length === 6 ? GSTR.label(ym) : ym) + ": " + words}
    aria-current={S.gstView === "return" && S.gstYm === ym && S.gstPart === part || undefined} onClick={() => gstOpen(ym.length === 6 ? ym : S.gstYm, part)}>
    <span className="rp-s">{words}</span>{c.amount && <span className="rp-a">{c.amount}</span>}
    {(c.lines || []).map((w, i) => <span key={i} className="nr">{w}</span>)}</button></td>;
}

// the status of a return for a period: filed (the date kept: typed, or the ARN date of the portal's PDF), a mismatch
// (the return as filed, fetched from the portal, differs from FinCom's working), ready (the books have the month)
function status(reg, form, ym, inBooks, cmp) {
  const on = GSTV.filedOn(reg, form, ym) || ((GSTV.copies(reg, form, ym)[0] || {}).arnDate) || "";
  const part = cmp && (form === "r3b" ? cmp.r3b : cmp.r1);
  const n = part && part.any ? part.rows.filter((r) => r.any).length : 0;
  if (n) return { st: "bad", n, lines: on ? ["filed " + dmy(on)] : [] };
  if (on) return { st: "filed", on: dmy(on), lines: part ? ["matches the books"] : [] };
  if (!inBooks) return { st: "none" };
  // G-E1 (10-Oct-2026): before filing, the month's errors to fix (GSTR.checks) show as "Errors N", as TDS's grid does
  const e = GSTR.errorsFor(ym, reg)[form === "r3b" ? "r3b" : "r1"];
  return e ? { st: "bad", errors: true, n: e, lines: ["to fix before filing"] } : { st: "ready" };
}

function Grid({ months, reg }) {
  const fy = GSTF.fyOf(S.gstYm || ""), cols = fyMonths(fy), have = new Set(months), b2 = new Set(GST2B.all2b(reg).map((z) => z.ym));
  const last = (S.books.meta || {}).to ? String(S.books.meta.to).slice(0, 6) : "";
  const inBooks = (m) => (S.books.vouchers || []).length > 0 && have.has(m) && (!last || m <= last);
  const rows = [["r1", "GSTR-1 / IFF"], ["r3b", "GSTR-3B"], ["r2b", "GSTR-2B"]];
  const cell = (part, m) => {
    const t = GSTSet.typeOf(m, reg);
    if (part === "r2b") return b2.has(m) ? { st: "ready", ready: "Fetched" } : { st: "none", none: "Not fetched" };
    if (t === "comp") return null;
    const cmp = GSTCMP.month(m, reg);
    if (part === "r1") {
      const iff = t === "qrmp" && !GSTSet.isQEnd(m), c = status(reg, iff ? "iff" : "r1", m, inBooks(m), cmp);
      if (iff) c.lines = ["IFF"].concat(c.lines || []);
      else if (t === "qrmp") c.lines = ["GSTR-1, " + GSTSet.qLabel(m).split(" ")[0]].concat(c.lines || []);
      if (inBooks(m) && c.st !== "none") { const g = GSTR.one(m, reg).total; c.lines = (c.lines || []).concat([g.n ? g.n + " document" + (g.n === 1 ? "" : "s") : "nil: no documents"]); }
      return c;
    }
    if (t === "qrmp" && !GSTSet.isQEnd(m)) return null;
    const c = status(reg, "r3b", m, inBooks(m), cmp);
    if (t === "qrmp") c.lines = ["for " + GSTSet.qLabel(m).split(" ")[0]].concat(c.lines || []);
    return c;
  };
  const g9 = (() => { const on = (GSTV.copies(reg, "gstr9", fy)[0] || {}).arnDate || ((GSTV.copies(reg, "gstr9", fy)[0] || {}).at ? "on file" : "");
    if (on) return { st: "filed", on: on === "on file" ? "" : dmy(on), lines: ["copy on file"] };
    return cols.every((m) => inBooks(m)) ? { st: "ready", lines: ["the year is in the books"] } : { st: "none", lines: [cols.filter((m) => inBooks(m)).length + " of 12 months in the books"] }; })();
  // ui-tidy (13-Oct-2026): the answer first: each return's months by status, as the grid's cells below say them
  const tally = (part) => { const n = { filed: 0, bad: 0, ready: 0, none: 0 }; cols.forEach((m) => { const c = cell(part, m); if (c && n[c.st] != null) n[c.st]++; }); return n; };
  const fig = (part, label) => { const n = tally(part), done = part === "r2b" ? n.ready : n.filed, of = done + n.bad + n.ready + (part === "r2b" ? n.none : n.none);
    return [label, part === "r2b" ? n.ready + " of 12 fetched" : n.filed + " filed", [n.bad && n.bad + " to fix", part !== "r2b" && n.ready && n.ready + " ready", part !== "r2b" && n.none && n.none + " not started"].filter(Boolean).join(" · ") || (of ? "" : "nothing yet"), n.bad ? "warn" : ""]; };
  return <>
  <Answer label={"GST " + fy + " key figures"} data-gst-answer={fy} figs={[fig("r1", "GSTR-1 / IFF"), fig("r3b", "GSTR-3B"), fig("r2b", "GSTR-2B"),
    ["GSTR-9", g9.st === "filed" ? "Filed" : g9.st === "ready" ? "Ready" : "Not yet", (g9.lines || []).join(" · ")]]} />
  <section className="dash-card" data-gst-grid={fy}>
    <div className="rp-title"><h3>{fy}</h3><span className="note">{GSTR.gstins(S.books).find((g) => g.slice(0, 2) === reg)} · open a return from its cell.</span></div>
    <div className="bk-tablewrap"><table className="rp-grid gf-off" style={{ minWidth: 1100 }}>
      <thead><tr><th>Return</th>{cols.map((m) => <th key={m}>{GSTR.label(m)}{GSTSet.typeOf(m, reg) === "qrmp" && GSTSet.isQEnd(m) && <small>quarter end</small>}</th>)}</tr></thead>
      <tbody>
        {rows.map(([part, label]) => <tr key={part} data-ret={part}><th scope="row">{label}</th>{cols.map((m) => <Cell key={m} c={cell(part, m)} ym={m} part={part} label={RET[part]} />)}</tr>)}
        <tr data-ret="g9"><th scope="row">GSTR-9<small>the year</small></th><td colSpan={12}><div style={{ maxWidth: 260 }}><table style={{ width: "100%" }}><tbody><tr><Cell c={g9} ym={fy} part="g9" label="GSTR-9" /></tr></tbody></table></div></td></tr>
      </tbody>
    </table></div>
    <div className="rp-key" aria-label="Colours"><span style={{ "--k": "var(--rule-strong)" }}>Not started</span><span style={{ "--k": "var(--info)" }}>Ready / 2B fetched</span>
      <span style={{ "--k": "var(--bad)" }}>Errors to fix, or the filed return differs from the books</span><span style={{ "--k": "var(--ok)" }}>Filed</span></div>
  </section></>;
}


// Optional entries with GST are in no return (request of 02-Oct-2026): said on the return pages, listed on Filed vs books
function OptionalNote() {
  const fy = GSTF.fyOf(S.gstYm || ""), n = fy ? GSTX.optional(S.gstReg || "", fy).length : 0;
  if (!n) return null;
  return <p className="note" style={{ margin: "0 0 10px" }} data-optional-note="">{n} Optional entr{n === 1 ? "y" : "ies"} with GST in {fy} {n === 1 ? "is" : "are"} in no return. <button className="linkbtn" onClick={() => { S.reconTab = "optional"; gstPartGo("recon"); }}>See the list</button></p>;
}

// a GSTR-1 or 3B open: its summary card (round 46) — the return and period, its status as the year's grid says it, the
// one download, and More
function GstCard({ part, months, gNow, ftype, noReturn, sub, prefile }) {
  const reg = S.gstReg || "", ym = S.gstYm || "", have = new Set(months), last = (S.books.meta || {}).to ? String(S.books.meta.to).slice(0, 6) : "";
  const inBooks = (S.books.vouchers || []).length > 0 && have.has(ym) && (!last || ym <= last);
  const iff = part === "r1" && ftype === "qrmp" && !GSTSet.isQEnd(ym);
  const c = status(reg, part === "r3b" ? "r3b" : iff ? "iff" : "r1", ym, inBooks, GSTCMP.month(ym, reg));
  const words = c.st === "none" ? "Not started" : c.st === "bad" ? (c.errors ? c.n + " to fix" : "Differs from the books: " + c.n) : c.st === "filed" ? "Filed " + c.on : "Ready to file";
  const name = part === "r1" ? (iff ? "IFF" : "GSTR-1") : "GSTR-3B", forWhat = ftype === "qrmp" ? " for the quarter" : "";
  const primary = noReturn || c.st === "filed" || sub === "file" ? null : part === "r1" ? ["Download GSTR-1 JSON" + forWhat, () => doAct("gstJson")] : ["Download GSTR-3B JSON" + forWhat, () => doAct("gst3bJson")];
  // t70 (16-Oct-2026; the owner: "TDS and GST pages take too much space"): one header row: the way back, the return, its
  // GSTIN, the status, Check before filing (was a bar of its own under the card), More and the one download
  return <section className="ret-card ret-slim" data-return-card={part + "|" + ym}>
    <div className="ret-top">
      <button className="linkbtn ret-back" onClick={() => gstViewGo("year")}>← GST {GSTF.fyOf(ym)}</button>
      <div className="ret-name">
        <h2 data-return-title="">{name} · {periodLabel(ym, reg)}</h2>
        <p className="ret-sub">{gNow} · {GSTRegs.state(gNow)} · {GSTSet.typeLabel(ftype)}
          {ftype === "qrmp" && (GSTSet.isQEnd(ym) ? " · the downloads cover the whole of " + GSTSet.qLabel(ym) : " · for reference: this month has no GSTR-1 or 3B, see “This quarter”")}</p>
      </div>
      <div className="ret-acts">
        <span className={"tag " + (c.st === "filed" ? "ok" : c.st === "bad" ? "bad" : c.st === "none" ? "no" : "info")} data-status-tag="">{words}</span>
        {prefile && <span data-prefile-bar="">{prefile}</span>}
        <More items={[["Download GSTR-1 and 3B (Excel)", () => doAct("gstExcel")], ["Files and filing", () => gstSubGo("file")]]}>
          <p>Check the JSON in the portal’s offline tool before filing.</p></More>
        {primary && <button className="btn small primary" data-card-primary="" onClick={primary[1]}>{primary[0]}</button>}
      </div>
    </div>
  </section>;
}

export default function Gst() {
  const b = S.books, months = GSTR.months(), regs = GSTR.gstins(b) || [];
  if (!regs.length) return <div className="tg-empty" data-list-empty="">Add the client’s GSTIN to use GST. With it, 2B can be fetched from the portal or brought in and the returns filed kept, with or without a Tally day book; GSTR-1 and 3B are worked out from the day book.
    <div><button className="btn small primary" onClick={() => goGstSettings()}>GST settings</button></div></div>;
  // a return is filed for one GSTIN: the company's own first, never the registrations added together
  if (!regs.some((g) => g.slice(0, 2) === S.gstReg)) { const own = String((CO() || {}).gstin || "").slice(0, 2); S.gstReg = (regs.find((g) => g.slice(0, 2) === own) || regs[0]).slice(0, 2); }
  // smart moves round 1 (the owner's choice of 09-Oct-2026, "due now"): opened afresh, the return due now (monthly: last
  // month's 3B; QRMP: the quarter just ended), or the oldest one not marked filed, or the person's last choice here
  if (!S.gstYm) { const k = Smart.recall("gst"); S.gstYm = k && /^\d{6}$/.test(k.ym || "") ? k.ym : Smart.gstDue(S.gstReg); }
  const lastYm = months[months.length - 1] || "";
  // the books in FinCom do not reach that period yet: one line with Read from Tally, not an empty return
  // (the year's grid only: a return or part asked for by name, such as notices, opens on the last month read, as before)
  if (S.gstYm && lastYm && S.gstYm > lastYm && !months.includes(S.gstYm) && (S.gstView || (S.gstPart ? "return" : "year")) === "year") {
    const end = String((b.meta || {}).to || "") || lastYm + "01";
    return <><LedgerBanner b={b} which="gst" /><NotRead end={end} what={"GST " + (GSTSet.typeOf(S.gstYm, S.gstReg || "") === "qrmp" ? GSTSet.qLabel(S.gstYm) : GSTR.label(S.gstYm))} read={GSTF.fyOf(S.gstYm)} show={GSTR.label(lastYm)} onShow={() => gstSetYm(lastYm)} /></>;
  }
  if (!S.gstYm || !months.includes(S.gstYm)) S.gstYm = lastYm;
  // the year's grid first; a part already chosen (a link to it, an alert's button) opens that part
  if (!S.gstView) S.gstView = S.gstPart ? "return" : "year";
  // the parts follow the filing type of this month and GSTIN, so both are settled first
  const { parts, ftype, noBooks } = gstParts(b);
  const seen = (S.gstReg || "") + "|" + ftype;
  if (!S.gstPart || !parts.some((x) => x[0] === S.gstPart) || (S.gstSeen && S.gstSeen !== seen)) S.gstPart = parts[0][0];
  S.gstSeen = seen;
  // without a day book there is no grid: the year opens on the first part (2B)
  if (noBooks && S.gstView === "year") S.gstView = "return";
  const part = S.gstPart, noReturn = ftype === "qrmp" && !GSTSet.isQEnd(S.gstYm || ""), gNow = regs.find((g) => g.slice(0, 2) === S.gstReg) || "";
  const subs = S.gstView === "return" && !noBooks ? SUBS[part] : null;
  if (subs && !subs.some(([k]) => k === S.gstSub)) S.gstSub = "summary";
  const sub = subs ? S.gstSub : undefined;
  const noDownload = ["r2b", "rev", "inreg", "follow", "health", "qtr", "vault", "filedcmp", "recon"].includes(part) || ftype === "comp";
  const forWhat = ftype === "qrmp" ? " for the quarter" : " for the portal";
  // ledger-confirm (14-Oct-2026): the GST ledgers are confirmed here, a section of their own (TaxLedgers.jsx)
  const sec = S.gstView === "ledgers" ? "ledgers" : gstSecOf(part, S.gstView);
  const secParts = (k) => parts.filter(([id]) => gstSecOf(id, "return") === k);
  const secGo = (k) => { if (k === "ledgers") { TaxLed.go("gst"); return; } if (k === "returns" && !noBooks) { gstViewGo("year"); return; } const first = secParts(k)[0]; if (first) gstPartGo(first[0]); };
  const ledN = TaxLed.pending(b, "gst").length;
  const shownSecs = SECS.filter(([k]) => secParts(k).length || (k === "returns" && !noBooks)).concat(noBooks ? [] : [["ledgers", "Ledgers"]]);
  const subParts = secParts(sec);
  return <div data-phone-scroll="" data-gst-page="">
    {/* the ledgers still to confirm: said once, on Returns (round 46) */}
    {sec === "returns" && <LedgerBanner b={b} which="gst" />}
    <div className="tg-head">
      <nav className="sbar" aria-label="GST sections">{shownSecs.map(([k, l]) => <button key={k} data-gst-sec={k} aria-selected={sec === k} onClick={() => secGo(k)}>{l}{k === "ledgers" && ledN > 0 && <> <span className="sbar-n" data-gst-led-n="">{ledN + " to confirm"}</span></>}</button>)}</nav>
      <div className="tg-tools"><HelpButton /></div>
    </div>
    {sec === "ledgers" ? <TaxLedgers b={b} kind="gst" /> : <>
    <Bar months={months} regs={regs} gNow={gNow} ftype={ftype} noDownload={noDownload && part !== "qtr"} />
    {(subParts.length > 1 || sec === "returns") && <nav className="sbar subnav rp-tabs" aria-label="GST">
      {sec === "returns" && !noBooks && <button data-part="year" aria-selected={S.gstView === "year"} onClick={() => gstViewGo("year")}>Year</button>}
      {subParts.map(([id, l]) => <button key={id} data-part={id} aria-selected={S.gstView === "return" && part === id} onClick={() => gstPartGo(id)}>{l}</button>)}</nav>}
    {S.gstView === "year" ? <Grid months={months} reg={S.gstReg || ""} /> : <>
    {subs && <GstCard part={part} months={months} gNow={gNow} ftype={ftype} noReturn={noReturn} sub={sub} prefile={!noBooks && S.gstYm ? <PreFileButton kind="gst" reg={S.gstReg || ""} ym={S.gstYm} /> : null} />}
    {!subs && !noBooks && S.gstYm && <div className="revfilter" data-prefile-bar=""><PreFileButton kind="gst" reg={S.gstReg || ""} ym={S.gstYm} /></div>}
    {part === "amend" && ftype === "monthly" && <div className="revfilter"><button className="btn small primary" onClick={() => doAct("gstJson")}>Download GSTR-1 JSON with these</button></div>}
    {!subs && part === "r1" && !noReturn && <div className="revfilter"><button className="btn small primary" onClick={() => doAct("gstJson")}>Download GSTR-1 JSON{forWhat}</button></div>}
    {!subs && part === "r3b" && !noReturn && <div className="revfilter"><button className="btn small primary" onClick={() => doAct("gst3bJson")}>Download GSTR-3B JSON{forWhat}</button></div>}
    {subs && <nav className="sbar rp-tabs" aria-label="Return">{subs.map(([k, l]) => <button key={k} data-sub={k} aria-selected={S.gstSub === k} onClick={() => gstSubGo(k)}>{l}</button>)}</nav>}
    {!noBooks && (part === "r1" || part === "r3b" || part === "qtr") && <OptionalNote />}
    {noBooks && <p className="note" style={{ margin: "0 0 10px" }}>No Tally day book here yet. 2B and the returns filed work without it; GSTR-1, 3B, the input register and the other workings need the day book, brought in under “From Tally”.</p>}
    {sub === "file" && <section className="dash-card" style={{ marginBottom: 12 }} data-file={part}><h3>{part === "r1" ? "GSTR-1" : "GSTR-3B"} for {periodLabel(S.gstYm || "", S.gstReg || "")}</h3>
      {noReturn && <p className="note">This month has no {part === "r1" ? "GSTR-1" : "GSTR-3B"} of its own: the quarter’s is made at its last month.</p>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn small" onClick={() => doAct("gstExcel")}>Download GSTR-1 and 3B</button>
        {part === "r1" && !noReturn && <button className="btn small primary" onClick={() => doAct("gstJson")}>Download GSTR-1 JSON{forWhat}</button>}
        {part === "r3b" && !noReturn && <button className="btn small primary" onClick={() => doAct("gst3bJson")}>Download GSTR-3B JSON{forWhat}</button>}
      </div>
      <p className="note" style={{ marginTop: 8 }}>Check the JSON in the portal’s offline tool before filing.</p></section>}
    {part === "r1" ? <Gstr1 b={b} sub={sub} /> : part === "r3b" ? <Gstr3b b={b} sub={sub} /> : part === "inreg" ? <InputRegister b={b} /> : part === "r2b" ? <TwoB b={b} /> : part === "amend" ? <Amendments b={b} /> : part === "adv" ? <Advances /> : part === "rev" ? <Reversal b={b} /> : part === "g9" ? <Gst9 b={b} /> : part === "g9c" ? <Gst9c /> : part === "follow" ? <ItcFollow /> : part === "health" ? <SupplierHealth /> : part === "vault" ? <ReturnsFiled b={b} /> : part === "filedcmp" ? <FiledCompare b={b} /> : part === "recon" ? <Recon b={b} /> : part === "qtr" ? <Qrmp /> : part === "cmp08" ? <Cmp08 /> : part === "gstr4" ? <Gstr4 /> : part === "notices" ? <Notices b={b} kind="gst" /> : null}
    </>}
    </>}
  </div>;
}
