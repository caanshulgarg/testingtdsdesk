// TDS/GST round 2 (items 2 and 3): files the CA brings from the portals, on the TDS page.
//   Recon26: Form 26AS / AIS / TIS against the books (AS26, src/js/69-tds-26as.js): the client's own tax credit against its
//     TDS receivable entries, and its deductees' statements against its returns. Lists Matched / Only in 26AS / Only in
//     the books, with amounts.
//   TracesFiles: Form 16A certificates kept with each deductee, the justification report's defaults, and the
//     consolidated file's deductees against FinCom's return (TRF, src/js/70-traces-files.js).
//   TracesDefaults / F16Link: the same on a return's Errors to fix tab and its Deductees tab.
// Nothing here changes a figure of the books or a return.
import { useState } from "react";
import ListTable from "../../parts/ListTable.jsx";
import { Answer, Info } from "../../parts/Answer.jsx";

const money = (v) => (v == null ? "—" : "₹" + INR.format(r2(v || 0)));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const ST = { matched: ["ok", "Matched"], file: ["bad", "Only in "], books: ["warn", "Only in "] };

function Upload({ label, accept, onFiles, hint, name }) {
  const [busy, setBusy] = useState(false);
  return <label className={"btn small primary" + (busy ? " busy" : "")} style={{ cursor: "pointer" }} data-upload={name}>{busy ? "Reading…" : label}
    <input type="file" accept={accept} multiple hidden aria-label={label} title={hint}
      onChange={async (ev) => { const t = ev.target, fs = Array.from(t.files || []); t.value = ""; if (!fs.length) return; setBusy(true); try { await onFiles(fs); } finally { setBusy(false); } }} /></label>;
}

// ---------------------------------------------------------------- 26AS / AIS
function FileList({ files }) {
  if (!files.length) return null;
  return <ListTable name="as26Files" rows={files} rowKey={(f) => f.id} unit={["file", "files"]} foot={false}
    cols={[
      { k: "kind", label: "File", v: (f) => f.kind, cell: (f) => <><b>{f.kind}</b>{f.fromPdf ? " (PDF)" : ""}<div className="nr">{f.file}</div></> },
      { k: "pan", label: "PAN", v: (f) => f.pan, cell: (f) => <>{f.pan || "—"}<div className="nr">{AS26.whose(f) === "own" ? "the client's own" : "a deductee's"}{f.holder ? " · " + f.holder : ""}</div></> },
      { k: "fy", label: "Year", v: (f) => f.fy, cell: (f) => f.fy || "—" },
      { k: "n", label: "Lines", cls: "n", v: (f) => f.rows.length, cell: (f) => f.rows.length },
      { k: "tax", label: "Tax", cls: "n", v: (f) => f.rows.reduce((a, r) => a + r.tax, 0), cell: (f) => money(f.rows.reduce((a, r) => a + r.tax, 0)) },
      { k: "chk", role: "status", label: "Read", cell: (f) => f.check && !f.check.ok ? <span className="tag bad" data-check-bad={f.id}>check: lines ≠ totals</span> : <span className="tag ok">totals agree</span> },
      { k: "x", label: "", cell: (f) => <button className="linkbtn" onClick={() => AS26.remove(f.id)}>take out</button> },
    ]} />;
}

function OwnCredit({ fy }) {
  const r = AS26.own(fy);
  if (!r) return <p className="note">Upload the client’s own 26AS (or AIS) for {fy} to compare its tax credit with the TDS receivable in the books.</p>;
  const parties = AS26.parties(), k = r.file.kind, rows = r.rows;
  const n = (s) => rows.filter((x) => x.status === s).length, amt = (s) => r2(rows.filter((x) => x.status === s).reduce((a, x) => a + (x.line ? x.line.tax : x.book.tax), 0));
  return <>
  <Answer label="26AS key figures" data-as26-answer={fy} figs={[[k + ", " + fy, money(r.sum.file)], ["TDS receivable in the books", money(r.sum.books)],
    ["Difference", money(r2(r.sum.file - r.sum.books)), "", Math.abs(r.sum.file - r.sum.books) >= 1 ? "bad" : ""], ["Lines matched", n("matched") + " of " + rows.length, n("file") + " only in " + k + " · " + n("books") + " only in the books"]]} />
  <section className="dash-card" data-as26-own={fy} style={{ marginTop: 12 }}>
    <h3>The client’s tax credit, {fy}: {k} against the books</h3>
    <p className="note">{k} {money(r.sum.file)} · TDS receivable in the books {money(r.sum.books)} · difference <b className={Math.abs(r.sum.file - r.sum.books) >= 1 ? "bad" : ""}>{money(r2(r.sum.file - r.sum.books))}</b>.
      A deductor is matched to the party in Tally of the same name; where the name differs, choose the party.</p>
    {r.file.check && !r.file.check.ok && <p className="note bad" data-as26-check="">The lines read from {r.file.file} do not add up to its totals for {r.file.check.diffs.map((d) => d.name + " (" + money(d.file) + " in the file, " + money(d.read) + " read)").join("; ")}. Use the text file (TRACES: Export as Text) for this year.</p>}
    <ListTable name="as26Deductors" rows={r.deductors} rowKey={(d) => d.tan} unit={["deductor", "deductors"]}
      rowProps={(d) => ({ "data-deductor": d.tan })}
      cols={[
        { k: "name", role: "party", label: "Deductor", v: (d) => d.name, cell: (d) => <>{d.name}<div className="nr">TAN {d.tan}</div></> },
        { k: "party", label: "Party in the books", v: (d) => d.party.party, cell: (d) => <><select aria-label={"Party for " + d.tan} value={d.party.party} onChange={(ev) => AS26.link(d.tan, ev.target.value)}>
            <option value="">— not linked —</option>{parties.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          {d.party.how === "name" && <div className="nr">by the same name</div>}</> },
        { k: "file", role: "amount", label: k, cls: "n", v: (d) => d.file, sum: true, fmt: money, cell: (d) => <>{money(d.file)}{d.pending ? <div className="nr warn">{money(d.pending)} not final (status U/P/O)</div> : null}</> },
        { k: "books", role: "amount", label: "Books", cls: "n", v: (d) => d.books, sum: true, fmt: money, cell: (d) => money(d.books) },
        { k: "diff", label: "Difference", cls: "n", v: (d) => d.diff, sum: true, fmt: money, td: (d) => ({ className: Math.abs(d.diff) >= 1 ? "bad" : undefined }), cell: (d) => (Math.abs(d.diff) >= 1 ? money(d.diff) : "—") },
      ]} />
    {Object.keys(r.booksOnly).length > 0 && <p className="note" data-books-only="" style={{ marginTop: 8 }}>TDS receivable in the books from parties with no line in the {k}: {Object.entries(r.booksOnly).map(([p, v]) => p + " " + money(v)).join(", ")}. Ask them to file their returns, or check the party.</p>}
    <div className="gf-chips" style={{ margin: "10px 0 6px" }}><span className="note">Lines: </span>
      <span className="tag ok">Matched {n("matched")} · {money(amt("matched"))}</span> <span className="tag bad">Only in {k} {n("file")} · {money(amt("file"))}</span> <span className="tag warn">Only in the books {n("books")} · {money(amt("books"))}</span></div>
    <Lines rows={rows} kind={k} other="books" name="as26Own" />
  </section></>;
}

function Lines({ rows, kind, other, name }) {
  return <ListTable name={name} rows={rows} rowKey={(x, i) => (x.line ? x.line.tan + x.line.date + x.line.tax : "") + "|" + (x.book ? x.book.id : "") + "|" + i} unit={["line", "lines"]}
    rowProps={(x) => ({ "data-as26-row": x.status })}
    cols={[
      { k: "st", role: "status", label: "Status", v: (x) => x.status, cell: (x) => <span className={"tag " + ST[x.status][0]}>{ST[x.status][1]}{x.status === "file" ? kind : x.status === "books" ? (other === "books" ? "the books" : "FinCom’s return") : ""}</span> },
      { k: "who", role: "party", label: "Deductor or party", v: (x) => (x.line ? x.line.name : x.book.party), cell: (x) => <>{x.line ? x.line.name : x.book.party || "(no party)"}{x.line && <div className="nr">TAN {x.line.tan}</div>}</> },
      { k: "sec", label: "Section", v: (x) => (x.line ? x.line.section : x.book.section || ""), cell: (x) => (x.line ? x.line.section : x.book.section || "—") },
      { k: "q", label: "Quarter", v: (x) => (x.line || x.book).q, cell: (x) => (x.line || x.book).q },
      { k: "date", role: "date", label: "Date", v: (x) => (x.line || x.book).date, cell: (x) => <>{x.line ? day(x.line.date) : ""}{x.book ? <div className="nr">{other === "books" ? "books " : "FinCom "}{day(x.book.date)}{x.book.voucher ? " · " + x.book.voucher : ""}</div> : null}</> },
      { k: "amount", label: "Paid or credited", cls: "n", v: (x) => (x.line ? x.line.amount : x.book.amount) || 0, cell: (x) => money(x.line ? x.line.amount : x.book.amount) },
      { k: "tax", role: "amount", label: "Tax", cls: "n", v: (x) => (x.line ? x.line.tax : x.book.tax), sum: true, fmt: money, cell: (x) => money(x.line ? x.line.tax : x.book.tax) },
      { k: "note", label: "", cell: (x) => <span className="nr">{x.how && x.how !== "line" ? x.how : ""}{x.note ? (x.how && x.how !== "line" ? "; " : "") + x.note : ""}{x.line && x.line.status && x.line.status !== "F" && !/active/i.test(x.line.status) ? " status " + x.line.status : ""}</span> },
    ]} />;
}

function Deductees({ fy }) {
  const list = AS26.deductees(fy);
  if (!list.length) return null;
  return <section className="dash-card" style={{ marginTop: 12 }} data-as26-deductees={fy}>
    <h3>The client’s deductions as its deductees see them, {fy}</h3>
    {!AS26.clientTan() && <p className="note bad">Add the client’s TAN in Client setup: the deductee’s statement is read for the lines of that TAN.</p>}
    {list.map((d) => <div key={d.file.id} data-as26-deductee={d.file.pan} style={{ marginTop: 10 }}>
      <p className="note"><b>{d.party || d.file.holder || d.file.pan}</b> (PAN {d.file.pan}): {d.file.kind} shows {money(d.sum.file)} under TAN {d.tan || "?"}; FinCom’s returns {money(d.sum.books)}.</p>
      <Lines rows={d.rows} kind={d.file.kind} other="return" name={"as26Ded" + d.file.pan} />
    </div>)}
  </section>;
}

export function Recon26() {
  const fy = S.tdsFy, files = AS26.files();
  return <>
    <section className="dash-card" data-as26="">
      <div className="rp-title"><h3>Form 26AS, AIS and TIS</h3>
        <span className="note">The tax credit TRACES and the compliance portal show, against the books.</span>
        <Info label="Which files, and how they are read">Upload the client’s 26AS (TRACES: View Tax Credit → Export as Text, or the PDF) or its AIS / TIS (JSON, or the PDF). A deductee’s 26AS or AIS shows the client’s deductions as the deductee sees them, against FinCom’s returns.
          {" "}Read from the files’ usual layouts: the text file’s and the JSON’s amounts are read by what each field is; a PDF is read as lines of text, and its lines are checked against the totals it prints.</Info></div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "6px 0 10px" }}>
        <Upload name="as26" label="Upload 26AS or AIS" accept=".txt,.pdf,.json,text/plain,application/pdf,application/json" onFiles={async (fs) => { for (const f of fs) await AS26.add(f); }} />
      </div>
      <FileList files={files} />
    </section>
    <OwnCredit fy={fy} />
    <Deductees fy={fy} />
  </>;
}

// ---------------------------------------------------------------- TRACES files
export function TracesFiles() {
  const fy = S.tdsFy, [said, setSaid] = useState([]);
  const f16 = TRF.f16().filter((r) => !r.fy || r.fy === fy), jrs = TRF.jrs().filter((x) => x.fy === fy), cs = TRF.consos().filter((x) => x.fy === fy);
  const byPan = {};
  f16.forEach((r) => { (byPan[r.pan] = byPan[r.pan] || { pan: r.pan, party: r.party || TRF.partyOfPan(r.pan), certs: [] }).certs.push(r); });
  return <>
    <section className="dash-card" data-traces="">
      <div className="rp-title"><h3>TRACES files, {fy}</h3><span className="note">Form 16A, the justification report and the consolidated file, as downloaded from TRACES.</span>
        <Info label="Which files">Upload the zip TRACES gives, or the files inside it. Form 16A PDFs are kept with each deductee; a justification report’s defaults and a consolidated file’s deductees are read for their return.</Info></div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "6px 0 10px" }}>
        <Upload name="traces" label="Upload TRACES files" accept=".zip,.pdf,.txt,application/zip,application/pdf,text/plain" onFiles={async (fs) => setSaid(await TRF.add(fs))} />
      </div>
      {said.length > 0 && <ul className="note" data-traces-said="" style={{ margin: "0 0 8px 18px", padding: 0 }}>{said.map((s, i) => <li key={i}>{s}</li>)}</ul>}
    </section>
    <section className="dash-card" style={{ marginTop: 12 }} data-f16a={fy}>
      <h3>{TDS.isNew(fy) ? "Form 131 (earlier Form 16A)" : "Form 16A"} certificates</h3>
      <ListTable name="f16a" rows={Object.values(byPan)} rowKey={(p) => p.pan} unit={["deductee", "deductees"]} empty="No certificate yet. Upload the Form 16A zip from TRACES."
        rowProps={(p) => ({ "data-f16-pan": p.pan })}
        cols={[
          { k: "party", role: "party", label: "Deductee", v: (p) => p.party, cell: (p) => p.party || <span className="note">not in this client’s TDS</span> },
          { k: "pan", label: "PAN", v: (p) => p.pan, cell: (p) => p.pan },
          { k: "certs", label: "Certificates", cell: (p) => p.certs.sort((a, b) => String(a.q).localeCompare(String(b.q))).map((c) => <span key={c.id} style={{ marginRight: 10 }}>
            <button className="linkbtn" data-f16-get={c.id} onClick={() => TRF.downloadF16(c.id)}>{c.q || "?"} {c.fy || ""}</button>{c.cert ? <span className="nr"> {c.cert}</span> : null}
            {" "}<button className="linkbtn" aria-label={"Take out " + c.name} onClick={() => TRF.remove("f16a", c.id)}>×</button></span>) },
        ]} />
    </section>
    {jrs.map((j) => <TracesDefaults key={j.id} jr={j} full />)}
    {cs.map((c) => <Conso key={c.id} c={c} />)}
  </>;
}

// the justification report's defaults of a return
export function TracesDefaults({ jr, full }) {
  if (!jr) return null;
  const label = (k) => (TRF.JR_KINDS.find((x) => x[0] === k) || [, , k])[2], fix = (k) => (TRF.JR_KINDS.find((x) => x[0] === k) || [, , , ""])[3];
  const kinds = Array.from(new Set(jr.items.map((x) => x.kind))), total = r2(jr.items.filter((x) => x.kind !== "pan").reduce((a, x) => a + x.amount, 0));
  return <section className="dash-card bad" style={{ marginTop: 12 }} data-traces-defaults={jr.form + "|" + jr.q + "|" + jr.fy}>
    <h3>TRACES defaults: {TDS.formShort(jr.form, jr.fy)}, {jr.q} {jr.fy}{jr.token ? " (token " + jr.token + ")" : ""}</h3>
    <p className="note">From the justification report brought in on {fmtDateTime(jr.at)}{full ? " (" + jr.file + ")" : ""}: {jr.items.length} default{jr.items.length === 1 ? "" : "s"}, {money(total)} to pay.</p>
    {jr.diffs && jr.diffs.length > 0 && <p className="note bad" data-jr-diff="">The report’s summary says {jr.diffs.map((d) => d.label + " " + money(d.summary) + " (the lines add up to " + money(d.read) + ")").join("; ")}: check the report on TRACES.</p>}
    {kinds.map((k) => <div key={k} data-jr-kind={k} style={{ marginTop: 8 }}>
      <p className="note"><b>{label(k)}</b> — {fix(k)}</p>
      <ListTable name={"jr" + k} rows={jr.items.filter((x) => x.kind === k)} rowKey={(x, i) => i} unit={["line", "lines"]}
        cols={[
          { k: "who", role: "party", label: k === "shortPay" || k === "intPay" ? "Challan or deductee" : "Deductee", v: (x) => x.name || x.pan, cell: (x) => <>{x.name || x.challan || "—"}{x.pan ? <div className="nr">PAN {x.pan}</div> : x.challan && x.name ? <div className="nr">challan {x.challan}</div> : null}</> },
          { k: "sec", label: "Section", v: (x) => x.section, cell: (x) => x.section || "—" },
          { k: "date", role: "date", label: "Date", v: (x) => x.date, cell: (x) => day(x.date) || "—" },
          { k: "amount", role: "amount", label: k === "pan" ? "Amount" : "Default", cls: "n", v: (x) => x.amount, sum: true, fmt: money, cell: (x) => money(x.amount) },
        ]} />
    </div>)}
    {full && <div className="row" style={{ marginTop: 8 }}><button className="linkbtn" onClick={() => TRF.remove("tracesJr", jr.id)}>Take this report out</button></div>}
  </section>;
}

function Conso({ c }) {
  const r = TRF.consoCheck(c), bad = r.rows.filter((x) => !x.ok);
  return <section className="dash-card" style={{ marginTop: 12 }} data-conso={c.form + "|" + c.q + "|" + c.fy}>
    <h3>Consolidated file: {TDS.formShort(c.form || "26Q", c.fy)}, {c.q} {c.fy}</h3>
    <p className="note">TRACES holds {r.rows.length} deductee line{r.rows.length === 1 ? "" : "s"} under {c.challans} challan{c.challans === 1 ? "" : "s"} for TAN {c.tan || "?"}. {bad.length ? bad.length + " differ from FinCom’s return: fix these in the correction." : "Every PAN, name and TDS agrees with FinCom’s return."}</p>
    <ListTable name="conso" rows={r.rows} rowKey={(x, i) => x.challan + "|" + x.n + "|" + i} unit={["deductee line", "deductee lines"]}
      rowProps={(x) => ({ "data-conso-row": x.pan, "data-ok": x.ok ? "1" : "0" })}
      cols={[
        { k: "st", role: "status", label: "", v: (x) => (x.ok ? 1 : 0), cell: (x) => <span className={"tag " + (x.ok ? "ok" : "bad")}>{x.ok ? "Same" : "Check"}</span> },
        { k: "name", role: "party", label: "Name in TRACES", v: (x) => x.name, cell: (x) => x.name },
        { k: "pan", label: "PAN in TRACES", v: (x) => x.pan, cell: (x) => x.pan },
        { k: "rec", label: "Challan / line", v: (x) => x.challan + "/" + x.n, cell: (x) => x.challan + " / " + x.n },
        { k: "words", label: "Against FinCom", cell: (x) => (x.ok ? <span className="nr">{x.party}</span> : <span className="bad">{x.words.join("; ")}</span>) },
      ]} />
    {r.extra.length > 0 && <p className="note bad" data-conso-extra="">In FinCom’s return, not in TRACES’ file: {r.extra.map((x) => x.party + " (" + (x.pan || "no PAN") + ", " + money(x.tds) + ")").join(", ")}.</p>}
    <div className="row" style={{ marginTop: 8 }}><button className="linkbtn" onClick={() => TRF.remove("tracesConso", c.id)}>Take this file out</button></div>
  </section>;
}

// a deductee's Form 16A for the quarter, beside its PAN on the return's Deductees tab
export function F16Link({ pan, fy, q }) {
  const c = TRF.f16().find((r) => r.pan === pan && (!r.fy || r.fy === fy) && (!r.q || r.q === q));
  return c ? <> <button className="linkbtn" data-f16-link={pan} onClick={() => TRF.downloadF16(c.id)}>Form 16A</button></> : null;
}
