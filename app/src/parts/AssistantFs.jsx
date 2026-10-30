// Ask FinCom's statements card (the owner's report of 29-Oct-2026: "I have asked for provisional balance sheet … it has not
// answered properly … wrong answers were given or incomplete answers"). Every request for the balance sheet, the financial
// statements, a provisional or interim balance sheet, Schedule III, the notes or last year's figures is answered with this
// card (server/assistant/fsask.ts, or fs_build from the model): no model and no figure from the server.
//
// The figures are the Financial statements page's to the rupee: they are worked out here, in the browser, by the page's own
// engine on the books open here (FinSt.build through the page's own memo, screens/books/fin/util.js built), for the period
// and comparative asked, in the page's unit and decimals. The card shows
//   - a short summary (funds, total assets, revenue, total income and expenses, profit before tax and for the period, with
//     the comparative), and what is missing, said plainly: the checks that do not read 0 (ledgers with no code, stock not
//     known …), no previous year in the copy, days the copy lacks, entries held only to an earlier day; nothing estimated;
//   - "Open Financial statements: <From> to <To>, compare with last year": the page with its Period and Compare with set
//     (FinSt.periodSet), and the page's own Download Excel and Download PDF (window.FinXlsx / window.FinPdf);
//   - last year's balance sheet attached in the chat, read by the page's own reader (PyBs.jsx readFile: FinPyBs) with what
//     was read (total assets, liabilities, the profit printed) to confirm, then kept as the page keeps it (FinPyBs.save):
//     the PY column when the copy has no previous year, the codes it suggests, and the check against the opening balances;
//   - for "profit is different from Tally": the profit as Tally adds it (the income and expense ledgers' entries of the
//     period) beside the statements' profit, and each thing that makes them differ.
// The figures are worked out once for a card (kept on the turn as fsSnap), so older cards do not work them out again.
import { useEffect, useState } from "react";
import Button from "./Button.jsx";
import { built, fig } from "../screens/books/fin/util.js";      // FinSt and FinPyBs (lib/finGlobals.js) come with it
import { readFile } from "../screens/books/fin/PyBs.jsx";
import { needDays } from "../lib/needDays.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymdOf = (iso) => String(iso || "").replace(/-/g, "").slice(0, 8);
const dmy = (v) => { const s = ymdOf(v); return /^\d{8}$/.test(s) ? s.slice(6, 8) + "-" + MON[+s.slice(4, 6) - 1] + "-" + s.slice(0, 4) : ""; };
const R2 = (v) => { const r = Math.round((+v || 0) * 100) / 100; return r === 0 ? 0 : r; };
const inr = (v) => (v < 0 ? "-" : "") + "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(R2(v)));
const UNIT_WORDS = { 1: "rupees", 1000: "thousands", 100000: "lakhs", 10000000: "crores" };
const sum = (list, f) => R2(list.reduce((s, x) => s + (+f(x) || 0), 0));

const booksFor = (cid) => { const b = typeof S === "object" ? S.books : null; return b && b.cid === cid && !b.loading && Array.isArray(b.vouchers) ? b : null; };
const lastHeld = (b) => (b.vouchers || []).reduce((m, v) => (String(v.date || "") > m ? String(v.date) : m), "");

// the year and the period as the page reads them: the dates asked (Custom, with the comparative), else the page's own choice
function periodFor(f) {
  const fy = f.fy || (typeof fsYearNow === "function" ? fsYearNow() : "");
  if (!fy) return null;
  const per = f.from && f.to ? FinSt.periodOf(String(fy), { preset: "custom", from: ymdOf(f.from), to: ymdOf(f.to), cmp: f.cmp === "fy" ? "fy" : "same" }) : FinSt.periodGet(String(fy));
  return { fy: String(fy), per };
}

// the page's figures for the card, from the books open here
export function workOut(f, cid) {
  const b = booksFor(cid);
  if (!b) return { none: true };
  const pp = periodFor(f);
  if (!pp) return { error: "The statements are made from the day book, which is not in yet." };
  const inp = FinSt.inputs(), unit = inp.unit, dec = inp.dec, period = pp.per.full ? undefined : pp.per;
  const d = built(b, pp.fy, unit, dec, period);
  if (!d || d.error) return { error: (d && d.error) || "The statements could not be worked out.", fy: pp.fy };
  const P = d.period || pp.per, noPy = d.tb.pySrc === "none", eq = d.bs.sections.EQ;
  const row = (label, x) => ({ label, cy: x ? x.cy : null, py: noPy || !x ? null : x.py });
  const rows = [row(eq.label, eq.total), row("Total equity and liabilities", d.bs.total.eqL), row("Total assets", d.bs.total.assets),
    row("Revenue from operations", d.pl.rev), row("Total income", d.pl.inc), row("Total expenses", d.pl.tot), row("Profit before tax", d.pl.pbt),
    row(P.full ? "Profit for the year" : "Profit for the period", d.pl.pat)];
  // what is missing, as the page's checks say it; nothing is filled in
  const missing = [];
  const noCode = d.tb.rows.filter((r) => !r.synthetic && !r.code && (Math.abs(r.final) >= 0.01 || Math.abs(r.py) >= 0.01));
  d.checks.filter((c) => c.value !== 0 && c.key !== "unit").forEach((c) => {
    if (c.key === "unmapped") missing.push({ key: c.key, text: noCode.length + " ledger" + (noCode.length === 1 ? " has" : "s have") + " no code, so " + (noCode.length === 1 ? "it is" : "they are") + " not in the statements yet: " + noCode.slice(0, 4).map((r) => r.ledger).join(", ") + (noCode.length > 4 ? " …" : "") + ". Give each a code on the Trial balance & mapping tab." });
    else if (c.key === "stockMissing") missing.push({ key: c.key, text: c.label + ". Type it on the Trial balance & mapping tab, or upload last year's balance sheet: nothing is assumed." });
    else missing.push({ key: c.key, text: c.label + " reads " + fig(c.value, /^tb|compPbt|stockOpen/.test(c.key) ? 2 : dec) + ", not 0." });
  });
  if (P.pyNote) missing.push({ key: "py", text: P.pyNote });
  else if (d.tb.pySrc === "opening") missing.push({ key: "py", text: "Last year is not in FinCom's copy: the comparative balance sheet is the opening balances only. Upload last year's balance sheet for last year's figures." });
  (d.tb.warn || []).forEach((w, i) => missing.push({ key: "warn" + i, text: String(w) }));
  try {
    const from = P.from, to = P.to;
    needDays(b, cid).filter((x) => x.to >= from && x.from <= to).forEach((x, i) => missing.push({ key: "days" + i, text: x.say + " (" + dmy(x.from) + (x.to !== x.from ? " to " + dmy(x.to) : "") + "): the statements do not have them." }));
  } catch (e) { /* the alerts not loaded: nothing to add */ }
  const held = lastHeld(b);
  if (held && held < P.to) missing.push({ key: "held", text: "FinCom's copy has entries only to " + dmy(held) + "; the period runs to " + dmy(P.to) + "." });
  // "profit is different from Tally": Tally's own way (the income and expense ledgers' entries of the period) beside the
  // statements' profit, and what makes them differ (in rupees)
  let tally = null;
  if (f.tallyDiff) {
    const rev = d.tb.rows.filter((r) => !r.synthetic && FS.nature(r.ledger).rev), tw = sum(rev, (r) => -r.cy), adj = sum(rev, (r) => -r.adj);
    const nc = sum(rev.filter((r) => !r.code), (r) => -r.final), syn = sum(d.tb.rows.filter((r) => r.synthetic && r.side === "PL"), (r) => -r.final);
    const pat = R2(d.pl.pat.cy * unit), round = R2(pat - (tw + adj - nc + syn));
    const n = (b.vouchers || []).filter((v) => String(v.date) >= P.from && String(v.date) <= P.to).length;
    tally = { tallyWay: tw, pat, adj, noCode: nc, stock: syn, round, entries: n, held, range: P.range,
      syncedAt: (b.tb && b.tb.at) || "", same: Math.abs(pat - tw) < 0.01 };
  }
  return { fy: pp.fy, unit, dec, period, range: P.range, pyRange: P.pyRange, asAt: P.asAt, full: !!P.full, cmpNote: P.cmpNote || "", noPy, rows, missing, tally, pySrc: d.tb.pySrc };
}

// the page, with its Period and Compare with set to the card's, on a tab
async function openPage(f, snap, cid, tab) {
  if (typeof S !== "object") return;
  if (S.coId !== cid && typeof openCompany === "function") await openCompany(cid);
  if (!booksFor(cid) && typeof openBooks === "function") await openBooks(cid);
  const fy = (snap && snap.fy) || f.fy || (typeof fsYearNow === "function" ? fsYearNow() : "");
  if (f.from && f.to && booksFor(cid)) FinSt.periodSet({ preset: "custom", from: ymdOf(f.from), to: ymdOf(f.to), cmp: f.cmp === "fy" ? "fy" : "same" });
  if (fy) S.fsFy = String(fy);
  S.fsTab = ""; S.fin = Object.assign({}, S.fin || {}, { tab: tab || "bs", rep: "", note: "" });
  ASST.close(); goClient("books:fs");
}
// the page's own Download Excel / Download PDF (app/src/lib/finExport.js), in the page's unit and decimals, for the card's period
function download(kind, f, snap) {
  const X = kind === "xlsx" ? window.FinXlsx : window.FinPdf, fn = X && (kind === "xlsx" ? X.download : X.open);
  const later = () => toast(kind === "xlsx" ? "Excel is being prepared: it could not be loaded just now, try again in a moment" : "The PDF is being prepared: it could not be loaded just now, try again in a moment");
  if (typeof fn !== "function") { later(); return; }
  const o = { unit: snap.unit, dec: snap.dec, period: snap.period };
  if (kind === "pdf") Object.assign(o, { includeTb: false, notes: f.notes !== false });
  try { const r = fn.call(X, snap.fy, o); if (r && typeof r.then === "function") r.catch((e) => (e && (e.finLoad || e.code === "lib_missing") ? later() : toast("Could not build the file: " + ((e && e.message) || e)))); }
  catch (e) { toast("Could not build the file: " + ((e && e.message) || e)); }
}

// last year's balance sheet from the chat, as a File: the one uploaded in this session, else read back from the firm's folder
async function pyFile(py) {
  const u = (typeof AUpload === "object" && AUpload.st ? (AUpload.st().uploads || []) : []).find((x) => x.path === py.path && x.file);
  if (u) return u.file;
  await Cloud.fresh().catch(() => {});
  const c = Cloud.cfg(), s = Cloud.sess();
  const r = await fetch(String(c.url).replace(/\/+$/, "") + "/storage/v1/object/authenticated/assistant-files/" + py.path.split("/").map(encodeURIComponent).join("/"), { headers: { apikey: c.key, Authorization: "Bearer " + s.access_token } });
  if (!r.ok) throw new Error("the file is not there any more (" + r.status + "): upload it again");
  return new File([await r.blob()], py.name || "balance-sheet.pdf", { type: py.type || r.headers.get("content-type") || "" });
}
// what was read: the lines used, in rupees (assets and liabilities, as the page's confirm line), and the profit printed
function readSummary(draft) {
  const u = +draft.unit || 1, acc = { a: 0, l: 0 };
  draft.lines.filter((z) => z.use && FinSt.CODES[z.code]).forEach((z) => { acc[FinSt.CODES[z.code].sign < 0 ? "l" : "a"] += (+z.amt || 0) * u; });
  const p = draft.lines.find((z) => z.amt != null && !z.isHead && /\b(profit|loss)\b.*\b(for the (year|period)|after tax)\b|^\W*(net\s+)?profit\s*(\(loss\))?\s*(for the year)?\W*$/i.test(String(z.label || "")));
  return { assets: R2(acc.a), liab: R2(acc.l), lines: draft.lines.filter((z) => z.amt != null).length, used: draft.lines.filter((z) => z.use).length, profit: p ? R2((+p.amt || 0) * u) : null, profitLine: p ? p.label : "" };
}

function PyBlock({ f, cid, fy, onKept }) {
  const [st, setSt] = useState({ s: "idle" });
  const kind = (() => { try { return FS.cfg(S.books).kind === "co" ? "co" : "nc"; } catch (e) { return "co"; } })();
  const kept = booksFor(cid) && fy ? FinPyBs.latest(fy) : null;
  const read = async () => {
    setSt({ s: "reading" });
    try { const file = await pyFile(f.py); const r = await readFile(file, kind); r.usePy = true; setSt({ s: "read", draft: r, sum: readSummary(r) }); }
    catch (e) { setSt({ s: "error", why: (e && e.message) || String(e) }); }
  };
  const keep = () => { const k = FinPyBs.save(fy, Object.assign({}, st.draft, { confirmed: true })); setSt({ s: "kept", v: k.v }); toast("Last year's balance sheet kept (version " + k.v + "). It is the PY column when FinCom's copy has no previous year, and suggests ledgers' codes."); onKept(); };
  return <div className="asst-fs-py" data-asst-fs-py={st.s}>
    <p><b>Last year's balance sheet:</b> {f.py.name}{kept && st.s === "idle" ? <span className="note">{" · kept on the page as version " + kept.v + (kept.file && kept.file !== f.py.name ? " (" + kept.file + ")" : "")}</span> : null}</p>
    {st.s === "idle" && <Button className="btn small" data-asst-fs-pyread="" disabled={!booksFor(cid)} onClick={read}>Read it as last year's figures</Button>}
    {st.s === "reading" && <p className="note">Reading it here, with the Financial statements page's reader…</p>}
    {st.s === "error" && <p className="asst-error" data-asst-fs-pyerr="">{st.why}</p>}
    {st.s === "read" && <>
      <p data-asst-fs-pyread-sum="">{"Read " + st.sum.lines + " lines with a figure (" + st.sum.used + " used), amounts in " + (UNIT_WORDS[st.draft.unit] || "rupees") + ": total assets " + inr(st.sum.assets) + ", equity and liabilities " + inr(st.sum.liab)
        + (Math.abs(st.sum.assets - st.sum.liab) < 1 ? " (they tie)" : " (they differ by " + inr(st.sum.assets - st.sum.liab) + ")") + "; " + (st.sum.profit != null ? "profit as printed (" + st.sum.profitLine + ") " + inr(st.sum.profit) : "no profit line was read (a balance sheet alone)") + "."}</p>
      <p className="note">Is this right? Keep it to use it as last year's figures, or check it line by line on the page first.</p>
      <div className="asst-fs-act"><Button className="btn small primary" data-asst-fs-pykeep="" onClick={keep}>Yes, keep it</Button>
        <Button className="btn small" onClick={() => openPage(f, null, cid, "tb")}>Check line by line on the page</Button></div></>}
    {st.s === "kept" && <p className="note" data-asst-fs-pykept="">{"Kept as version " + st.v + "."}</p>}
  </div>;
}

export default function FsCard({ t }) {
  const f = t.fs || {}, cid = f.client || t.cid;
  const [, redraw] = useState(0);
  const ready = !!booksFor(cid);
  useEffect(() => {
    // the client's books, opened here when they are not (the page needs them too)
    if (!ready && typeof S === "object" && S.coId === cid && typeof openBooks === "function" && !(S.books && S.books.cid === cid)) openBooks(cid).then(() => redraw((x) => x + 1), () => {});
    if (ready && !t.fsSnap) { try { t.fsSnap = workOut(f, cid); } catch (e) { t.fsSnap = { error: (e && e.message) || String(e) }; } redraw((x) => x + 1); }
  }, [t, ready]);
  const snap = t.fsSnap && !t.fsSnap.none ? t.fsSnap : null;
  const range = snap && snap.range ? snap.range : f.from && f.to ? dmy(f.from) + " to " + dmy(f.to) : "the period on the page";
  const cmpW = f.cmp === "fy" ? "the last full year" : "last year";
  const fy = (snap && snap.fy) || f.fy || "";
  return <section className="asst-card asst-fs" data-asst-fs="" data-from={f.from || ""} data-to={f.to || ""} data-cmp={f.cmp || "same"}>
    <header><span className="asst-src ok">FinCom's books ✓</span><b>Financial statements (Schedule III): {range}</b></header>
    {!snap && !(t.fsSnap && t.fsSnap.error) && <p className="note" data-asst-fs-wait="">{ready ? "Working them out with the Financial statements page…" : "Opening the client's books in this browser to work them out…"}</p>}
    {t.fsSnap && t.fsSnap.error && <p className="asst-error" data-asst-fs-err="">{t.fsSnap.error}</p>}
    {snap && !snap.error && <>
      <div className="asst-fs-box"><table className="asst-fs-t" data-asst-fs-table="">
        <thead><tr><th>Particulars</th><th className="n">{snap.full ? "This year" : "This period"}</th><th className="n">{snap.noPy ? "Last year" : snap.full ? "Last year" : "Comparative"}</th></tr></thead>
        <tbody>{snap.rows.map((r) => <tr key={r.label} data-asst-fs-row={r.label}><td>{r.label}</td><td className="n">{fig(r.cy, snap.dec)}</td><td className="n">{r.py == null ? "—" : fig(r.py, snap.dec)}</td></tr>)}</tbody>
      </table></div>
      <p className="note">{"In " + (UNIT_WORDS[snap.unit] || "rupees") + ", as on the page. The balance sheet is as on " + snap.asAt + "; the profit and loss is for " + snap.range + ". " + (snap.noPy ? "" : snap.cmpNote)}</p>
      {snap.missing.length > 0 ? <div className="asst-fs-miss" data-asst-fs-missing={snap.missing.length}><p><b>What is missing</b></p><ul>{snap.missing.map((m) => <li key={m.key} data-asst-fs-miss={m.key}>{m.text}</li>)}</ul>
        {snap.noPy && f.cmp !== "fy" && f.from && f.to && <Button className="btn small" data-asst-fs-cmpfy="" onClick={() => ASST.ask("Financial statements from " + dmy(f.from) + " to " + dmy(f.to) + ", compared with the last full year" + (f.notes === false ? ", without the notes" : ", with the notes"))}>Compare with the last full year instead</Button>}</div>
        : <p className="note" data-asst-fs-missing="0">Every check on the page reads 0.</p>}
      {snap.tally && <div className="asst-fs-tally" data-asst-fs-tally={snap.tally.same ? "same" : "differs"}>
        <p><b>Profit and Tally, {snap.tally.range}</b></p>
        <table className="asst-fs-t"><tbody>
          <tr><td>As Tally adds it: the income and expense ledgers' {snap.tally.entries} entries of the period</td><td className="n" data-asst-fs-tallyway="">{inr(snap.tally.tallyWay)}</td></tr>
          <tr><td>The statements' profit for the period</td><td className="n" data-asst-fs-pat="">{inr(snap.tally.pat)}</td></tr>
          {snap.tally.adj !== 0 && <tr><td>of which: adjustments made on the Financial statements page</td><td className="n">{inr(snap.tally.adj)}</td></tr>}
          {snap.tally.stock !== 0 && <tr><td>of which: stock (changes in inventories)</td><td className="n">{inr(snap.tally.stock)}</td></tr>}
          {snap.tally.noCode !== 0 && <tr><td>less: ledgers with no code, not in the statements yet</td><td className="n">{inr(-snap.tally.noCode)}</td></tr>}
          {snap.tally.round !== 0 && <tr><td>rounding to {UNIT_WORDS[snap.unit] || "rupees"}</td><td className="n">{inr(snap.tally.round)}</td></tr>}
        </tbody></table>
        <p className="note">{(snap.tally.same ? "They agree. " : "") + "Tally's own Profit & Loss for " + snap.tally.range + " should read " + inr(snap.tally.tallyWay) + ". If it reads otherwise, Tally has entries FinCom's copy does not: entries made or changed in Tally after the last Day Book read"
          + (snap.tally.held ? " (FinCom has entries to " + dmy(snap.tally.held) + ")" : "") + ", optional or post-dated vouchers, or a closing stock Tally values itself; or the dates differ (an earlier answer may have used another period)."}</p>
      </div>}
    </>}
    {f.py && <PyBlock f={f} cid={cid} fy={fy} onKept={() => { try { t.fsSnap = workOut(f, cid); } catch (e) { t.fsSnap = { error: (e && e.message) || String(e) }; } redraw((x) => x + 1); }} />}
    <div className="asst-fs-act">
      <Button className={"btn small" + (f.want ? "" : " primary")} data-asst-fs-open="" onClick={() => openPage(f, snap, cid, "bs")}>{"Open Financial statements: " + range + ", compare with " + cmpW}</Button>
      <Button className={"btn small" + (f.want === "xlsx" ? " primary" : "")} data-asst-fs-dl="xlsx" disabled={!snap || !!snap.error} onClick={() => download("xlsx", f, snap)}>Download Excel</Button>
      <Button className={"btn small" + (f.want === "pdf" ? " primary" : "")} data-asst-fs-dl="pdf" disabled={!snap || !!snap.error} onClick={() => download("pdf", f, snap)}>{f.notes === false ? "Download PDF (without the notes)" : "Download PDF"}</Button>
    </div>
  </section>;
}
