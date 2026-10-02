// Look up: a question in plain words, or a ledger, a group, the trial balance on a date, month by month, a party's open
// bills, or any entry, from FinCom's copy of the books (Tally is never asked for a balance; each answer from the copy
// carries "Balance from FinCom's copy · books as of 15:34") or the books read here. Was LK.view, LK.result and
// LK.voucherRow (src/js/44); the answers are LK.run. Buttons go through lkAsk, lkAct, lkKind, lkPer, lkRec, lkLed,
// lkMonth, lkOpen, lkSrc, and typing through lkType (src/js/44).
//
// State: S.lk (kind, led, grp, from, to, asOn, q, typ, side, ask, heard, src, busy, res: the answer, open: entries opened).
import { Fragment, useEffect } from "react";
import Bars from "../../parts/Bars.jsx";
import NoBooks from "../../parts/NoBooks.jsx";
import FreshBar from "../../parts/FreshBar.jsx";
import { BusyCard } from "../../parts/Reading.jsx";

const Tile = ({ l, v, cls }) => <div className={"dtile" + (cls ? " " + cls : "")}><span>{l}</span><b>{v}</b></div>;
const LedBtn = ({ l }) => <button className="linkbtn strong" onClick={(ev) => { ev.stopPropagation(); lkLed(l); }}>{l}</button>;
const enter = (fn) => (ev) => { if (ev.key === "Enter") { ev.preventDefault(); fn(ev); } };
const Wrap = ({ head, children }) => <div className="bk-tablewrap"><table className="bk-table lk-t"><thead><tr>{head}</tr></thead><tbody>{children}</tbody></table></div>;

// an entry: its row, and when opened, both sides with each ledger to open
function VoucherRow({ r, x, children }) {
  const open = x.open[r.id];
  return <>
    <tr className={"lk-v" + (open ? " open" : "")} data-key={r.id} tabIndex={0} onClick={() => lkOpen(r.id)} onKeyDown={enter(() => lkOpen(r.id))}>{children}</tr>
    {open && <tr className="lk-sub"><td colSpan={9}><div className="lk-entries">{r.narr && <p className="note">{r.narr}</p>}
      <table className="bk-table lk-in"><tbody>{r.ent.map((e, i) => <tr key={i}><td><LedBtn l={e.l} /></td><td className="n">{e.a < 0 ? FC.amt(-e.a) : ""}</td><td className="n">{e.a > 0 ? FC.amt(e.a) : ""}</td></tr>)}</tbody></table></div></td></tr>}
  </>;
}

function Body({ r, x }) {
  const LIMIT = gfN(1500);
  if (r.kind === "ledger") return <>
    <div className="dash-tiles"><Tile l="Opening" v={r.open == null ? "not known" : FC.drcr(r.open)} /><Tile l="Debits" v={FC.amt(r.dr) || "0.00"} /><Tile l="Credits" v={FC.amt(r.cr) || "0.00"} /><Tile l="Closing" v={r.close == null ? FC.drcr(r.dr - r.cr) + " (movement)" : FC.drcr(r.close)} /></div>
    {!r.rows.length ? <div className="bk-none">No entries in {r.led} for these dates.</div> : <>
      <Wrap head={<><th>Date</th><th>Particulars</th><th>Type</th><th>No.</th><th className="n">Debit</th><th className="n">Credit</th><th className="n">Balance</th></>}>
        {r.open != null && <tr className="lk-ob"><td>{FC.when(r.from)}</td><td><b>Opening balance</b></td><td></td><td></td><td className="n">{r.open > 0 ? FC.amt(r.open) : ""}</td><td className="n">{r.open < 0 ? FC.amt(-r.open) : ""}</td><td className="n">{FC.drcr(r.open)}</td></tr>}
        {r.rows.slice(0, LIMIT).map((v, i) => <VoucherRow key={v.id + ":" + i} r={v} x={x}><td>{FC.when(v.date)}</td><td><span className="lk-part">{v.part}</span>{v.narr && <span className="nr">{v.narr}</span>}</td><td>{v.type}</td><td>{v.no || ""}</td>
          <td className="n">{FC.amt(v.dr)}</td><td className="n">{FC.amt(v.cr)}</td><td className="n">{r.open == null ? "" : FC.drcr(v.run)}</td></VoucherRow>)}
        <tr className="lk-tot"><td></td><td><b>Total</b></td><td></td><td></td><td className="n"><b>{FC.amt(r.dr)}</b></td><td className="n"><b>{FC.amt(r.cr)}</b></td><td className="n"><b>{r.close == null ? "" : FC.drcr(r.close)}</b></td></tr>
      </Wrap>
      {r.rows.length > LIMIT && <p className="note">{"The first " + LIMIT + " of " + r.rows.length + " entries are shown; Excel has them all."}</p>}
      <p className="note">Click an entry to see both sides. Click a ledger in it to open that ledger.</p></>}
  </>;
  if (r.kind === "group") return <>
    <div className="dash-tiles"><Tile l="Opening" v={r.open == null ? "not known" : FC.drcr(r.open)} /><Tile l="Debits" v={FC.amt(r.dr) || "0.00"} /><Tile l="Credits" v={FC.amt(r.cr) || "0.00"} /><Tile l="Closing" v={r.close == null ? "not known" : FC.drcr(r.close)} /></div>
    {!r.rows.length ? <div className="bk-none">No ledger under {r.grp} moved in these dates.</div> :
      <Wrap head={<><th>Ledger</th><th>Under</th><th className="n">Opening</th><th className="n">{r.net ? "Net debit" : "Debit"}</th><th className="n">{r.net ? "Net credit" : "Credit"}</th><th className="n">Closing</th></>}>
        {r.rows.slice(0, LIMIT).map((z, i) => <tr key={z.l + ":" + i}><td><LedBtn l={z.l} /></td><td>{z.sub}</td><td className="n">{z.open == null ? "" : FC.drcr(z.open)}</td><td className="n">{FC.amt(z.dr)}</td><td className="n">{FC.amt(z.cr)}</td><td className="n">{z.close == null ? "" : FC.drcr(z.close)}</td></tr>)}
        <tr className="lk-tot"><td><b>{r.rows.length + " ledgers"}</b></td><td></td><td className="n"><b>{r.open == null ? "" : FC.drcr(r.open)}</b></td><td className="n"><b>{FC.amt(r.dr)}</b></td><td className="n"><b>{FC.amt(r.cr)}</b></td><td className="n"><b>{r.close == null ? "" : FC.drcr(r.close)}</b></td></tr>
      </Wrap>}
  </>;
  if (r.kind === "tb") {
    if (r.none) return <div className="bk-none">{"The balances on this date are not in FinCom’s copy of the books yet: " + r.none + ". Bring in last night’s copy or today’s entries above; the trial balance is then worked out here, without holding Tally up."}</div>;
    const diff = r2(r.dr - r.cr), agrees = Math.abs(diff) < 0.5, nm = r.noMaster || [];
    const masters = nm.length > 0 && <div className="bk-alert" data-tb-nomaster="">
      <b>{nm.length} ledger{nm.length === 1 ? " has" : "s have"} entries but no master in the books read:</b>{" "}
      {nm.slice(0, 8).map((z) => z.l + " " + FC.drcr(z.bal)).join(", ")}{nm.length > 8 ? "…" : ""}. Their group and opening balance are not known.{" "}
      <button className="btn small" onClick={() => doAct("tbMasters")}>Read the ledger masters again</button></div>;
    // a trial balance that does not total zero is not shown as one: what is missing is said instead
    if (r.refused) return <>{masters}<div className="bk-none" data-tb-refused="">
      <b>Not shown: this trial balance does not total zero.</b> Debits {FC.amt(r.dr)}, credits {FC.amt(r.cr)}, out by {FC.amt(Math.abs(diff))}.
      {nm.length ? " The ledgers above have entries but no master; once their masters are read, it is worked out again." : " Read the day book and balances again from Tally, or bring in last night’s copy."}</div></>;
    return <>{masters}
      <div className="dash-tiles"><Tile l="Debit balances" v={FC.amt(r.dr)} /><Tile l="Credit balances" v={FC.amt(r.cr)} /><Tile l="Difference" v={agrees ? "agrees" : FC.amt(diff)} cls={agrees ? "" : "warn"} /><Tile l="Ledgers" v={String(r.rows.length)} /></div>
      <Wrap head={<><th>Ledger</th><th>Under</th><th className="n">Debit</th><th className="n">Credit</th></>}>
        {r.groups.map((g, gi) => <Fragment key={g.g + ":" + gi}><tr className="lk-grp"><td colSpan={2}><b>{g.g}</b></td><td className="n"><b>{FC.amt(g.dr)}</b></td><td className="n"><b>{FC.amt(g.cr)}</b></td></tr>
          {g.rows.map((z, i) => <tr key={z.l + ":" + i}><td style={{ paddingLeft: 22 }}><LedBtn l={z.l} /></td><td>{z.sub}</td><td className="n">{z.bal > 0 ? FC.amt(z.bal) : ""}</td><td className="n">{z.bal < 0 ? FC.amt(-z.bal) : ""}</td></tr>)}</Fragment>)}
        <tr className="lk-tot"><td><b>Total</b></td><td></td><td className="n"><b>{FC.amt(r.dr)}</b></td><td className="n"><b>{FC.amt(r.cr)}</b></td></tr>
      </Wrap></>;
  }
  if (r.kind === "monthly") return <>
    <Bars labels={r.rows.map((z) => FC.shortMonth(z.ym))} series={[{ name: "Debits", cls: "c1", values: r.rows.map((z) => z.dr) }, { name: "Credits", cls: "c2", values: r.rows.map((z) => z.cr) }]} label="Debits and credits by month" />
    <Wrap head={<><th>Month</th><th className="n">Debit</th><th className="n">Credit</th><th className="n">Net</th><th className="n">Closing</th></>}>
      {r.open != null && <tr className="lk-ob"><td><b>Opening</b></td><td></td><td></td><td></td><td className="n">{FC.drcr(r.open)}</td></tr>}
      {r.rows.map((z) => <tr key={z.ym}><td><button className="linkbtn strong" onClick={() => lkMonth(z.ym)}>{FC.monthLabel(z.ym)}</button></td><td className="n">{FC.amt(z.dr)}</td><td className="n">{FC.amt(z.cr)}</td><td className="n">{FC.drcr(z.net)}</td><td className="n">{z.close == null ? "" : FC.drcr(z.close)}</td></tr>)}
      <tr className="lk-tot"><td><b>Total</b></td><td className="n"><b>{FC.amt(r.dr)}</b></td><td className="n"><b>{FC.amt(r.cr)}</b></td><td className="n"><b>{FC.drcr(r.dr - r.cr)}</b></td><td></td></tr>
    </Wrap></>;
  if (r.kind === "bills") {
    const over = (d) => r.rows.filter((z) => z.age > d && z.amt > 0).reduce((s, z) => s + z.amt, 0);
    return <>
      <div className="dash-tiles"><Tile l="Outstanding" v={FC.amt(r.total) || "0.00"} /><Tile l="Bills" v={String(r.rows.length)} /><Tile l="Over 90 days" v={FC.amt(over(90)) || "0.00"} cls={over(90) ? "warn" : ""} /><Tile l="Over 180 days" v={FC.amt(over(180)) || "0.00"} cls={over(180) ? "warn" : ""} /></div>
      {!r.rows.length ? <div className="bk-none">{"Nothing open on " + FC.when(r.asOn) + "."}</div> :
        <Wrap head={<>{!r.led && <th>Party</th>}<th>Bill</th><th>Date</th><th className="n">Days</th><th className="n">Outstanding</th></>}>
          {r.rows.slice(0, LIMIT).map((z, i) => <tr key={i}>{!r.led && <td><LedBtn l={z.party} /></td>}<td>{z.ref || "on account"}{!z.hasNew && <>{" "}<span className="tag no" title="Raised before the books read here">older</span></>}</td><td>{FC.when(z.date)}</td>
            <td className={"n" + (z.age > 90 ? " bad" : "")}>{z.age}</td><td className="n">{FC.amt(z.amt)}</td></tr>)}
          <tr className="lk-tot">{!r.led && <td></td>}<td><b>Total</b></td><td></td><td></td><td className="n"><b>{FC.amt(r.total)}</b></td></tr>
        </Wrap>}</>;
  }
  return <>
    <p className="note"><b>{r.n || r.rows.length}</b>{" entries, together " + money(r.total) + (r.opt ? " (" + r.opt + " Optional, not in the total, as in Tally)" : "") + "."}{r.n > r.rows.length && <>{" The first " + r.rows.length + " are here; "}<button className="linkbtn" onClick={() => lkAct("more")}>{"show " + Math.min(TCloud.FIND_PAGE, r.n - r.rows.length) + " more"}</button>.</>}</p>
    {!r.rows.length ? <div className="bk-none">Nothing matches. Try fewer words, or a wider period.</div> : <>
      <Wrap head={<><th>Date</th><th>Type</th><th>No.</th><th>Party or ledger</th><th className="n">Amount</th></>}>
        {r.rows.slice(0, LIMIT).map((v, i) => <VoucherRow key={v.id + ":" + i} r={v} x={x}><td>{FC.when(v.date)}</td><td>{v.type}{v.opt && <> <span className="tag" data-opt="1">Optional</span></>}</td><td>{v.no || ""}</td><td><span className="lk-part">{v.party}</span>{v.narr && <span className="nr">{v.narr}</span>}</td><td className="n">{v.opt ? <s title="Optional: not in the total">{FC.amt(v.amt)}</s> : FC.amt(v.amt)}</td></VoucherRow>)}
      </Wrap>
      {r.rows.length > LIMIT && <p className="note">{"The first " + LIMIT + " are shown; Excel has them all."}</p>}</>}
  </>;
}

function Result({ r, x }) {
  return <section className="dash-card lk-res" style={{ marginTop: 12 }}>
    <div className="lk-head"><h3>{(r.title || "") + " "}{r.src === "cloud" ? <span className="tag stamp" data-src="copy">from FinCom's copy</span> : <span className="tag ok">from the books</span>}{" "}
      {r.src === "cloud" && <button className="linkbtn" onClick={() => lkAct("fresh")}>Work it out again</button>}</h3>
      <div className="row" style={{ gap: 6 }}><button className="btn small" onClick={() => lkAct("print")}>Print or PDF</button><button className="btn small" onClick={() => lkAct("excel")}>Excel</button><button className="btn small" onClick={() => lkAct("clear")}>Close</button></div></div>
    {r.line && <p className="note" data-copy-line="">{r.line}</p>}
    {r.empty ? <div className="bk-none" data-copy-none="">{r.none + "."}</div> : <>{r.note && <p className="note">{r.note}</p>}
    <Body r={r} x={x} /></>}
  </section>;
}

function Form({ x }) {
  const date = (k, label) => <label className="f"><span>{label}</span><input type="date" aria-label={label} value={FC.iso(x[k])} onChange={(ev) => lkType(k, ev.target.value)} onKeyDown={enter(() => LK.run("auto"))} /></label>;
  const dates = <>{date("from", "From")}{date("to", "To")}</>, asOn = date("asOn", "As on");
  const text = (k, props) => <input value={x[k] || ""} onChange={(ev) => lkType(k, ev.target.value)} onKeyDown={enter(() => LK.run("auto"))} autoComplete="off" {...props} />;
  const ledIn = (label, req) => <label className="f lk-wide"><span>{label}</span>{text("led", { type: "text", list: "lkLeds", "data-fk": "lkLed", "aria-label": label, placeholder: req ? "Start typing a ledger name" : "Every party" })}</label>;
  const grpIn = <label className="f lk-wide"><span>Group</span>{text("grp", { type: "text", list: "lkGrps", "data-fk": "lkGrp", "aria-label": "Group", placeholder: "Sundry Debtors, Indirect Expenses…" })}</label>;
  if (x.kind === "ledger") return <>{ledIn("Ledger", true)}{dates}</>;
  if (x.kind === "group") return <>{grpIn}{dates}</>;
  if (x.kind === "tb") return asOn;
  if (x.kind === "monthly") return <>{ledIn("Ledger (or leave empty and choose a group)", true)}{grpIn}{dates}</>;
  if (x.kind === "bills") return <>{ledIn("Party", false)}{asOn}<label className="f"><span>Side</span><select aria-label="Side" value={x.side === "p" ? "p" : "r"} onChange={(ev) => lkType("side", ev.target.value)}><option value="r">Owed to the client</option><option value="p">Owed by the client</option></select></label></>;
  return <><label className="f lk-wide"><span>Words, a number or an amount</span>{text("q", { type: "search", "data-fk": "lkQ", "aria-label": "Words, a number or an amount", placeholder: "party, narration, bill number or 25000", autoComplete: undefined })}</label>{dates}
    <label className="f"><span>Type</span><select aria-label="Type" value={x.typ || ""} onChange={(ev) => lkType("typ", ev.target.value)}><option value="">Every type</option>{LK.types().map((t) => <option key={t}>{t}</option>)}</select></label></>;
}

export default function Lookup({ b }) {
  const x = LK.st(), live = LK.live(), have = (b.vouchers || []).length > 0;
  // Tally's ledger names, once per client (light), so typing offers what is in Tally today; the books brought up to date
  useEffect(() => {
    if (!(LK.names && LK.names.cid === S.coId) && !LK._namesBusy && LK._namesTried !== S.coId && typeof TCloud === "object" && TCloud.has(S.coId)) { LK._namesTried = S.coId; setTimeout(() => LK.loadNames(), 0); }
    if (LK.live()) setTimeout(() => LK.autoFresh(), 0);
  });
  const leds = FC.ledgers(), grps = FC.groups(), T = FC.tn();
  const can = LK.canTally(x), fromTally = can && LK.useTally(x, "auto"), rec = LK.recent();
  return <>
    <section className="dash-card lk-ask"><h3>Look up</h3>
      <p className="note" style={{ margin: "0 0 10px" }}>Ask in plain words, or choose below. Answers come at once from FinCom’s copy of the books; Tally is never asked for a balance.</p>
      <div className="lk-askrow"><input type="search" id="lkAsk" data-fk="lkAsk" value={x.ask || ""} placeholder="Try: HDFC bank for August · Raj Fabrics open bills · sales month by month this year · trial balance as on 31/03/2026" aria-label="Ask a question about the books"
        onChange={(ev) => lkType("ask", ev.target.value)} onKeyDown={enter((ev) => lkAsk(ev.target.value))} />
        <button className="btn primary" onClick={() => lkAsk(x.ask || "")}>Look up</button></div>
      {x.heard && <p className="note lk-heard">Understood as: <b>{x.heard}</b>. Change anything below.</p>}
      <div className="lk-kinds" role="tablist" aria-label="What to look up">{LK.KINDS.map(([k, l]) => <button key={k} role="tab" aria-selected={x.kind === k} onClick={() => lkKind(k)}>{l}</button>)}</div>
      <FreshBar b={b} />
      <div className="lk-form"><Form x={x} /></div>
      {["ledger", "group", "monthly", "find"].includes(x.kind) && <div className="lk-presets">{FC.PRESETS.map(([k, l]) => <button key={k} className="btn small" onClick={() => lkPer(k)}>{l}</button>)}</div>}
      {can && <div className="lk-src" role="radiogroup" aria-label="Where from"><span className="note">From</span><button role="radio" aria-checked={fromTally} onClick={() => lkSrc("tally")}>FinCom's copy</button>
        {have && <button role="radio" aria-checked={!fromTally} onClick={() => lkSrc("books")}>{"The books read into FinCom" + (LK.booksAge() ? " on " + LK.booksAge() : "")}</button>}</div>}
      <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "center" }}><button className="btn primary" disabled={!!x.busy} onClick={() => LK.run("auto")}>{x.busy ? "Working it out…" : "Show"}</button>
        {(T || live) && <p className="note lk-names">{T ? <>{"Ledger names: " + T.leds.length + (T.src === "cloud" ? " (the books in the cloud)" : " (from Tally)") + " · "}<button className="linkbtn" onClick={() => lkAct("names")}>refresh</button></>
          : LK._namesBusy ? "Bringing the ledger names…" : live ? <button className="linkbtn" onClick={() => lkAct("names")}>Bring the ledger names from Tally</button> : null}</p>}</div>
      <datalist id="lkLeds">{leds.slice(0, 5000).map((l) => <option key={l} value={l} />)}</datalist><datalist id="lkGrps">{grps.map((g) => <option key={g} value={g} />)}</datalist>
    </section>
    {rec.length > 0 && !x.res && <section className="dash-card" style={{ marginTop: 12 }}><h3>Looked up lately</h3><div className="lk-recent">{rec.map((r, i) => <button key={i} className="btn small" onClick={() => lkRec(i)}>{r.label}</button>)}</div></section>}
    {!have && !live && !(typeof TCloud === "object" && TCloud.has(S.coId)) && <NoBooks what="Look up" />}
    {x.busy && <BusyCard title="Working it out…" detail={x.busy} done={0} total={0} />}
    {LK.fr().busy && <BusyCard title="Bringing the books up to date…" detail={LK.fr().busy} done={0} total={0} />}
    {x.res && <Result r={x.res} x={x} />}
  </>;
}
