// FinCom Books (phase 1, read-only): the client's one set of books, from FinCom Books' own tables (fb_*, migration 220),
// whatever keeps the books. Today every book here is a mirror of Tally (or Zoho) built from FinCom's cloud copy, so the
// page only reads: the trial balance, any ledger, the day book, and whether the books are in step with the source.
// "Not in step" is a banner that warns (owner decision D18); nothing is blocked. No existing report reads fb_* yet
// (docs/FINCOM-BOOKS-REPORT-SWITCH.md). One lazy chunk (screens/fbooks), opened from the books tab books:fb.
// Data: the readers fb_status / fb_tb / fb_ledgers / fb_ledger / fb_daybook through TCloud.rpc (tests/run_fbooks_ui.py
// puts made-up books in a throwaway database behind TCloud.rpc; nothing test-only is in this file).
import { useEffect, useMemo, useState } from "react";
import "./fbooks.css";
import { billRows, entriesFromRefs, ageing, parsePaise } from "../../lib/fbooks/rules.js";

const TABS = [["tb", "Trial balance"], ["ledger", "Ledgers"], ["day", "Day Book"]];
const SCH3 = { "EQ.SC": "Equity", "EQ.OE": "Other equity", "NCL.BOR": "Borrowings", "CL.BOR": "Short-term borrowings", "CL.OCL": "Other current liabilities",
  "CL.PROV": "Provisions", "CL.TP": "Trade payables", "X.BRANCH": "Branch accounts", "X.SUSP": "Suspense (must be nil)", "NCA.PPE": "Property, plant and equipment",
  "NCA.INV": "Investments", "CA.OCA": "Current assets", "CA.INVT": "Inventories", "CA.TR": "Trade receivables", "CA.CASH": "Cash and bank", "CA.LA": "Loans and advances",
  "NCA.LA": "Long-term loans and advances", "NCA.OTH": "Other non-current assets", "PL.REV": "Revenue from operations", "PL.OI": "Other income", "PL.PUR": "Purchases",
  "PL.COGS": "Direct costs", "PL.OTH": "Other expenses" };
const INRF = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v) => INRF.format(Math.abs(+v || 0));
const rs = (v) => (+v < 0 ? "-" : "") + "₹" + money(v);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dshow = (iso) => { const s = String(iso || ""); return s.length >= 10 ? s.slice(8, 10) + "-" + MON[+s.slice(5, 7) - 1] + "-" + s.slice(0, 4) : ""; };
const dtshow = (ts) => { if (!ts) return ""; const d = new Date(ts); return d.getDate() + "-" + MON[d.getMonth()] + ", " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const srcName = (s) => (s === "zoho" ? "Zoho Books" : s === "own" ? "FinCom" : "Tally");

function rpc(fn, args) {
  if (typeof TCloud !== "object" || !TCloud.rpc) return Promise.reject(new Error("FinCom’s cloud is not connected on this computer."));
  return TCloud.rpc(fn, args);
}
const plain = (e) => {
  const m = String((e && e.message) || e || "");
  if (/PGRST202|does not exist|schema cache/i.test(m)) return "FinCom Books is not switched on yet for your firm.";
  return m.replace(/^.*?ERROR:\s*/, "").slice(0, 300);
};
function useAsk(fn, args, deps) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    if (!args) { setSt({ loading: false, data: null }); return undefined; }
    setSt((s) => ({ loading: true, data: s.data }));
    rpc(fn, args).then((data) => live && setSt({ loading: false, data }), (e) => live && setSt({ loading: false, error: plain(e) }));
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}

export default function FinComBooks() {
  const cid = S.coId;
  const [tick, setTick] = useState(0);
  const status = useAsk("fb_status", { p_client: cid }, [cid, tick]);
  const [bookPick, setBookPick] = useState("");
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("fincom:fbTab") || "tb"; } catch (e) { return "tb"; } });
  const [ledgerId, setLedgerId] = useState(null);
  const go = (t) => { setTab(t); try { localStorage.setItem("fincom:fbTab", t); } catch (e) { /* only a convenience */ } };
  const books = (status.data && status.data.books) || [];
  const book = books.find((b) => b.book === bookPick) || books[0] || null;

  return <div className="fbk" data-fbooks="">
    <header className="fbk-head">
      <div>
        <div className="fbk-eyebrow">FinCom Books</div>
        <h1>{book ? book.company || "This client’s books" : "One set of books for this client"}</h1>
        {book && <p className="fbk-sub" data-fb-source="">{"Source: " + srcName(book.source) + " · from " + dshow(book.from) + (book.counts && book.counts.last ? " · entries to " + dshow(book.counts.last) : "")}</p>}
      </div>
      {books.length > 1 && <label className="fbk-field fbk-books">Company
        <select value={book ? book.book : ""} onChange={(e) => setBookPick(e.target.value)} data-fb-book="">{books.map((b) => <option key={b.book} value={b.book}>{b.company + " (from " + dshow(b.from) + ")"}</option>)}</select></label>}
    </header>
    {status.loading && !status.data ? <p className="fbk-note" data-fb-loading="">Opening FinCom Books…</p>
      : status.error ? <p className="fbk-banner" data-tone="bad" role="alert" data-fb-error="">{status.error}</p>
      : !book ? <NotSetUp canSetUp={!!(status.data && status.data.can_set_up)} cid={cid} onDone={() => setTick((x) => x + 1)} />
      : <>
        <StepBanner book={book} onChecked={() => setTick((x) => x + 1)} />
        <nav className="fbk-tabs" role="tablist" aria-label="FinCom Books">
          {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className="fbk-tab" data-on={tab === k ? "1" : "0"} data-fb-tab={k} onClick={() => go(k)}>{label}</button>)}
        </nav>
        {tab === "tb" && <Trial book={book} openLedger={(id) => { setLedgerId(id); go("ledger"); }} />}
        {tab === "ledger" && <Ledger book={book} id={ledgerId} setId={setLedgerId} />}
        {tab === "day" && <DayBook book={book} />}
        <p className="fbk-note fbk-foot">{book.source === "own" ? "" : "Read-only: " + srcName(book.source) + " keeps these books, so changes are made in " + srcName(book.source) + ". FinCom Books copies every change within 10 minutes and checks it every night."}</p>
      </>}
  </div>;
}

function NotSetUp({ canSetUp, cid, onDone }) {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const setUp = () => { setBusy(true); setMsg(""); rpc("fb_enroll", { p_client: cid }).then(() => { setBusy(false); onDone(); }, (e) => { setBusy(false); setMsg(plain(e)); }); };
  return <section className="fbk-card" data-fb-none="">
    <h2>FinCom Books is not set up for this client yet</h2>
    <p className="fbk-note">Once set up, FinCom keeps a complete copy of this client’s books from Tally, checks it against Tally every night, and shows the trial balance, ledgers and day book here.</p>
    {canSetUp ? <div className="fbk-actions"><button className="btn primary small" disabled={busy} onClick={setUp} data-fb-setup="">{busy ? "Setting up…" : "Set up FinCom Books"}</button></div>
      : <p className="fbk-note">Your firm’s owner or staff can set it up.</p>}
    {msg && <p className="fbk-banner" data-tone="bad" role="alert">{msg}</p>}
  </section>;
}

// in step / not in step / not checked yet / read-only: one line, plain words; the differences under it when asked
function StepBanner({ book, onChecked }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const src = srcName(book.source), t = book.tieout || null, c = book.counts || {};
  const check = () => { setBusy(true); setMsg(""); rpc("fb_tieout_ask", { p_book: book.book }).then((r) => { setBusy(false); if (r && r.updating) setMsg(r.words); onChecked(); }, (e) => { setBusy(false); setMsg(plain(e)); }); };
  let tone, head, text;
  if (book.state === "read_only") { tone = "bad"; head = "Read-only."; text = "FinCom Books’ own check found a problem: " + book.read_only_why; }
  else if (book.state === "setting_up") { tone = "info"; head = "Being built."; text = "FinCom is copying this client’s entries from " + src + ". This page fills in as it goes."; }
  // FinCom Books follows the copy within 10 minutes (owner decision 23-Nov-2026): "Updating" inside that window, "Not in
  // step" once a book is more than 10 minutes behind
  else if (book.late) { tone = "warn"; head = "Not in step with " + src + " since " + dtshow(book.behind_since) + ":"; text = "FinCom Books is " + (book.behind_minutes || 10) + " minutes behind " + src + (book.mirrored_at ? " (last updated " + dtshow(book.mirrored_at) + ")" : "") + ". FinCom is bringing it up to date."; }
  else if (book.in_step === false) { tone = "warn"; head = "Not in step with " + src + (book.since ? " since " + dtshow(book.since) : "") + ":"; text = book.why || "a difference was found."; }
  else if (book.behind_since) { tone = "info"; head = "Updating…"; text = "Changes from " + src + " show here within 10 minutes" + (book.mirrored_at ? "; last updated " + dtshow(book.mirrored_at) : "") + "."; }
  else if (book.in_step === true) { tone = "ok"; head = "In step with " + src + "."; text = "Checked " + dtshow(book.checked_at) + ": every ledger and every entry match " + src + "’s copy to the paisa" + (t && !t.source_read ? "." : ", and " + src + "’s own trial balance."); }
  else { tone = "info"; head = "Not checked yet."; text = "The first check runs tonight."; }
  const diffs = (t && t.differences) || [];
  return <section className="fbk-banner" data-tone={tone} data-fb-step={tone === "warn" ? "out" : head === "Updating…" ? "updating" : book.in_step === true ? "in" : "unknown"} role={tone === "warn" || tone === "bad" ? "alert" : "status"}>
    <div className="fbk-banner-row">
      <p><b>{head}</b> {text}</p>
      <div className="fbk-actions">
        {tone === "warn" && diffs.length > 0 && <button className="btn small" onClick={() => setOpen(!open)} data-fb-why="">{open ? "Hide the differences" : "Show the differences"}</button>}
        {book.state !== "setting_up" && <button className="btn small" disabled={busy} onClick={check} data-fb-check="">{busy ? "Checking…" : "Check now"}</button>}
      </div>
    </div>
    {tone === "warn" && <p className="fbk-banner-sub">Returns can still be filed; check the figures for the period first.</p>}
    {c.sent > 0 && <p className="fbk-banner-sub" data-fb-sent="">{c.sent + (c.sent === 1 ? " entry was" : " entries were") + " sent to " + src + " and " + (c.sent === 1 ? "is" : "are") + " not back yet: kept out of the totals until " + src + " has " + (c.sent === 1 ? "it" : "them") + "."}</p>}
    {t && !t.source_read && book.in_step !== null && <p className="fbk-banner-sub" data-fb-source-todo="">{src + "’s own trial balance is not read yet (a new read from " + src + ", waiting for your OK). Today’s check is against FinCom’s copy of " + src + "."}</p>}
    {msg && <p className="fbk-banner-sub" role="alert">{msg}</p>}
    {open && <ul className="fbk-diffs" data-fb-diffs="">{diffs.map((d, i) => <li key={i}>{diffWords(d, src)}</li>)}{t.n > diffs.length && <li>{"and " + (t.n - diffs.length) + " more"}</li>}</ul>}
  </section>;
}
function diffWords(d, src) {
  switch (d.kind) {
    case "ledger_day": return d.ledger + " on " + dshow(d.day) + ": " + src + " " + rs(d.copy) + ", FinCom Books " + rs(d.fincom) + (d.cause === "held" ? " (an entry held: its Dr and Cr differ)" : "");
    case "count": return d.vtype + " entries in " + d.month + ": " + src + " " + d.copy + ", FinCom Books " + d.fincom;
    case "opening": return "Opening of " + d.ledger + ": " + src + " " + rs(d.copy) + ", FinCom Books " + rs(d.fincom);
    case "opening_difference": return "Difference in opening balances in " + src + ": " + rs(d.amount);
    case "held": return "Entry " + (d.number || "") + " of " + dshow(d.date) + " is held: " + d.why;
    case "mirror_error": return d.n + " change" + (d.n === 1 ? "" : "s") + " from " + src + " could not be applied yet";
    case "source_group": return d.group + " on " + dshow(d.as_on) + ": " + src + " " + rs(d.source) + ", FinCom Books " + rs(d.fincom);
    default: return JSON.stringify(d);
  }
}

// the trial balance at a date: primary groups with their totals, opened into ledgers
function Trial({ book, openLedger }) {
  const last = (book.counts && book.counts.last) || today();
  const [on, setOn] = useState(last > today() ? today() : last);
  const [shut, setShut] = useState({});
  const st = useAsk("fb_tb", on >= book.from ? { p_book: book.book, p_on: on } : null, [book.book, on]);
  const tb = st.data;
  const groups = useMemo(() => {
    if (!tb) return [];
    const by = new Map();
    for (const r of tb.rows) {
      const k = r.p || r.g || "Not grouped";
      if (!by.has(k)) by.set(k, { name: k, sch3: "", sort: r.gsort, rows: [], bal: 0 });
      const g = by.get(k); g.rows.push(r); g.bal += +r.close; g.sort = Math.min(g.sort, r.gsort);
      g.sch3 = r.psch3 || g.sch3;
    }
    return [...by.values()].sort((a, b) => a.sort - b.sort || (a.name < b.name ? -1 : 1));
  }, [tb]);
  return <section className="fbk-card" data-fb-tb="">
    <div className="fbk-card-head">
      <label className="fbk-field">As on<input type="date" value={on} min={book.from} onChange={(e) => e.target.value && setOn(e.target.value)} data-fb-on="" /></label>
      {tb && <span className="fbk-chip" data-tone={tb.ties ? "ok" : "warn"} data-fb-ties={tb.ties ? "1" : "0"}>{tb.ties ? "Debit = Credit" : "Debit and Credit differ by " + rs(Math.abs(tb.dr - tb.cr))}</span>}
    </div>
    {st.error ? <p className="fbk-banner" data-tone="bad">{st.error}</p> : !tb ? <p className="fbk-note">Working out the trial balance…</p> : <>
      <p className="fbk-note">{"Worked out just now from " + INRF.format(tb.entries).replace(".00", "") + " posted entries and the openings at " + dshow(tb.from) + "."}</p>
      <div className="fbk-scroll"><table className="fbk-table nocards">
        <thead><tr><th>Particulars</th><th className="fbk-hide-s">Schedule III</th><th className="n">Debit</th><th className="n">Credit</th></tr></thead>
        <tbody>{groups.map((g) => {
          const isShut = shut[g.name] !== false;
          return [<tr key={g.name} className="fbk-grp" data-fb-group={g.name} onClick={() => setShut({ ...shut, [g.name]: !isShut })}>
            <td><button className="fbk-twist" aria-expanded={!isShut} aria-label={(isShut ? "Open " : "Close ") + g.name}>{isShut ? "▸" : "▾"}</button>{g.name}</td>
            <td className="fbk-hide-s">{g.sch3 && <span className="fbk-chip fbk-chip-s">{SCH3[g.sch3] || g.sch3}</span>}</td>
            <td className="n">{g.bal > 0 ? money(g.bal) : ""}</td><td className="n">{g.bal < 0 ? money(g.bal) : ""}</td></tr>,
          ...(isShut ? [] : g.rows.map((r) => <tr key={r.id} className="fbk-led" data-fb-ledger-row={r.l} onClick={() => openLedger(r.id)}>
            <td><span className="fbk-led-n">{r.l}</span>{r.grp && r.grp !== g.name && <span className="fbk-led-g">{r.grp}</span>}{r.inactive && <span className="fbk-chip fbk-chip-s">inactive in Tally</span>}</td>
            <td className="fbk-hide-s"></td><td className="n">{+r.close > 0 ? money(r.close) : ""}</td><td className="n">{+r.close < 0 ? money(r.close) : ""}</td></tr>))];
        })}</tbody>
        <tfoot><tr><td>Total</td><td className="fbk-hide-s"></td><td className="n" data-fb-tb-dr="">{money(tb.dr)}</td><td className="n" data-fb-tb-cr="">{money(tb.cr)}</td></tr>
          {!tb.ties && <tr className="fbk-diffrow"><td colSpan={2}>{Math.abs(tb.opening_difference) > 0.001 ? "Difference in opening balances (as in Tally)" : "Difference"}</td><td className="n" colSpan={2}>{rs(Math.abs(tb.dr - tb.cr))}</td></tr>}</tfoot>
      </table></div>
    </>}
  </section>;
}

// one ledger between two dates; a party's pending bills (the ported bill-wise rules over its references)
function Ledger({ book, id, setId }) {
  const list = useAsk("fb_ledgers", { p_book: book.book }, [book.book]);
  const last = (book.counts && book.counts.last) || today();
  const [from, setFrom] = useState(book.from > addDays(last, -180) ? book.from : addDays(last, -180)), [to, setTo] = useState(last > today() ? today() : last);
  const [q, setQ] = useState("");
  const leds = (list.data || []).filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase()));
  const st = useAsk("fb_ledger", id ? { p_book: book.book, p_ledger: id, p_from: from, p_to: to } : null, [book.book, id, from, to]);
  const L = st.data;
  const bills = useMemo(() => {
    if (!L || !L.bills.length || L.ledger.kind !== "party") return null;
    // the opening at the books' start is not bill by bill yet (TODO D16: opening bill-wise, bridge 2.5.19): one row
    const rows = billRows(entriesFromRefs(L.ledger.name, L.bills), { parties: { [L.ledger.name]: "party" }, openings: { [L.ledger.name]: parsePaise(String(L.books_open || 0)) }, asOf: to });
    return { rows, age: ageing(rows, to, "due_date") };
  }, [L, to]);
  return <section className="fbk-card" data-fb-ledger="">
    <div className="fbk-card-head fbk-wrap">
      <label className="fbk-field fbk-grow">Ledger
        <input type="search" placeholder="Type to find a ledger" value={q} onChange={(e) => setQ(e.target.value)} data-fb-find="" />
        <select size={1} value={id || ""} onChange={(e) => setId(+e.target.value || null)} data-fb-pick=""><option value="">{list.loading ? "Loading…" : "Choose a ledger (" + leds.length + ")"}</option>{leds.map((l) => <option key={l.id} value={l.id}>{l.name + (l.group ? " · " + l.group : "")}</option>)}</select>
      </label>
      <label className="fbk-field">From<input type="date" value={from} min={book.from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
      <label className="fbk-field">To<input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
    </div>
    {!id ? <p className="fbk-note">Choose a ledger, or open one from the trial balance.</p> : st.error ? <p className="fbk-banner" data-tone="bad">{st.error}</p> : !L ? <p className="fbk-note">Opening the ledger…</p> : <>
      <div className="fbk-ledhead" data-fb-ledger-name={L.ledger.name}>
        <h2>{L.ledger.name}</h2>
        <p className="fbk-note">{[L.ledger.group, L.ledger.gstin && "GSTIN " + L.ledger.gstin, L.ledger.pan && "PAN " + L.ledger.pan, L.ledger.state].filter(Boolean).join(" · ")}</p>
        {L.ledger.note && <p className="fbk-note">{L.ledger.note}</p>}
      </div>
      <div className="fbk-scroll"><table className="fbk-table nocards">
        <thead><tr><th>Date</th><th>Entry</th><th className="fbk-hide-s">Against</th><th className="n">Debit</th><th className="n">Credit</th><th className="n">Balance</th></tr></thead>
        <tbody>
          <tr className="fbk-open"><td>{dshow(L.from)}</td><td>Opening balance</td><td className="fbk-hide-s"></td><td></td><td></td><td className="n">{money(L.open) + (+L.open < 0 ? " Cr" : " Dr")}</td></tr>
          {L.rows.map((r) => <tr key={r.id} data-fb-entry={r.number}><td>{dshow(r.date)}</td><td>{r.vtype + " " + r.number}{r.narration && <div className="fbk-led-g">{r.narration}</div>}</td>
            <td className="fbk-hide-s">{r.against}</td><td className="n">{+r.amount > 0 ? money(r.amount) : ""}</td><td className="n">{+r.amount < 0 ? money(r.amount) : ""}</td>
            <td className="n">{money(r.bal) + (+r.bal < 0 ? " Cr" : " Dr")}</td></tr>)}
        </tbody>
        <tfoot><tr><td>{dshow(L.to)}</td><td>Closing balance</td><td className="fbk-hide-s"></td><td></td><td></td><td className="n" data-fb-close="">{money(L.close) + (+L.close < 0 ? " Cr" : " Dr")}</td></tr></tfoot>
      </table></div>
      {bills && <div className="fbk-bills" data-fb-bills="">
        <h3>{"Bills pending on " + dshow(to)}</h3>
        <dl className="fbk-age">{[["<30", "Under 30 days"], ["30-60", "30–60"], ["60-90", "60–90"], [">90", "Over 90"]].map(([k, w]) => <div key={k}><dt>{w}</dt><dd>{money(bills.age.buckets[k].reduce((s, x) => s + x.signedPending, 0) / 100)}</dd></div>)}
          <div><dt>Not yet due</dt><dd>{money(bills.age.notYetDue.reduce((s, x) => s + x.signedPending, 0) / 100)}</dd></div></dl>
        <div className="fbk-scroll"><table className="fbk-table fbk-mini nocards">
          <thead><tr><th>Bill</th><th>Date</th><th>Due</th><th className="n">Bill amount</th><th className="n">Pending</th></tr></thead>
          <tbody>{bills.rows.map((b) => <tr key={b.billId} data-fb-bill={b.source === "opening" ? "opening" : b.resolution || b.referenceKind}><td>{b.source === "opening" ? "Opening balance on " + dshow(L.books_from) : b.name}
              {b.source === "opening" && <span className="fbk-led-g">not bill by bill yet</span>}
              {b.resolution === "unresolved" && <span className="fbk-led-g">{"settles a bill from before " + dshow(L.books_from)}</span>}
              {b.resolution === "ambiguous" && <span className="fbk-chip fbk-chip-s" data-tone="warn">names two bills</span>}</td><td>{dshow(b.date)}</td><td>{dshow(b.dueDate)}</td>
            <td className="n">{b.original ? money(b.original / 100) : ""}</td><td className="n">{money(b.pending / 100) + " " + b.drcr}</td></tr>)}</tbody>
        </table></div>
        <p className="fbk-note">{"Pending bills add up to " + rs(bills.rows.reduce((s, x) => s + x.signedPending, 0) / 100) + "; the ledger’s closing is " + rs(L.close) + (parsePaise(String(L.close)) === bills.rows.reduce((s, x) => s + x.signedPending, 0) ? " (they agree)." : " (the difference is the opening or entries without bills).")}</p>
      </div>}
    </>}
  </section>;
}

// the day book: every entry with its status; the totals count posted entries only
function DayBook({ book }) {
  const last = (book.counts && book.counts.last) || today();
  const [to, setTo] = useState(last > today() ? today() : last), [from, setFrom] = useState(addDays(last > today() ? today() : last, -6));
  const st = useAsk("fb_daybook", { p_book: book.book, p_from: from < book.from ? book.from : from, p_to: to }, [book.book, from, to]);
  const d = st.data;
  const STATUS = { posted: ["Posted", "ok"], held: ["Held", "warn"], cancelled: ["Cancelled", ""], sent: ["Sent, not back yet", "info"], pending: ["Pending approval", "info"], draft: ["Draft", ""], refused: ["Refused", "bad"] };
  return <section className="fbk-card" data-fb-day="">
    <div className="fbk-card-head fbk-wrap">
      <label className="fbk-field">From<input type="date" value={from} min={book.from} onChange={(e) => e.target.value && setFrom(e.target.value)} data-fb-from="" /></label>
      <label className="fbk-field">To<input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} data-fb-to="" /></label>
      {d && <span className="fbk-chip" data-tone={d.totals.dr === d.totals.cr ? "ok" : "warn"}>{d.totals.posted + " posted · Dr " + money(d.totals.dr) + " = Cr " + money(d.totals.cr)}</span>}
    </div>
    {st.error ? <p className="fbk-banner" data-tone="bad">{st.error}</p> : !d ? <p className="fbk-note">Opening the day book…</p> : !d.rows.length ? <p className="fbk-note">No entries on these dates.</p> : <>
      <ul className="fbk-vouchers">{d.rows.map((v) => {
        const [w, tone] = v.memo && v.status === "posted" ? ["Memo (not in totals)", ""] : STATUS[v.status] || [v.status, ""];
        return <li key={v.id} className="fbk-v" data-fb-voucher={v.number} data-status={v.status}>
          <div className="fbk-v-head"><span className="fbk-v-d">{dshow(v.date)}</span><b>{v.vtype + " " + v.number}</b>{v.party && <span className="fbk-v-p">{v.party}</span>}
            <span className="fbk-chip fbk-chip-s" data-tone={tone}>{w}</span>{v.version > 1 && <span className="fbk-chip fbk-chip-s" title="Changed in Tally since it was first copied">{"version " + v.version}</span>}</div>
          {(v.note || v.cancel_reason) && <p className="fbk-led-g">{v.cancel_reason || v.note}</p>}
          {v.lines.length > 0 && <table className="fbk-lines nocards"><tbody>{v.lines.map((l, i) => <tr key={i}><td>{l.l}</td><td className="n">{+l.a > 0 ? money(l.a) + " Dr" : ""}</td><td className="n">{+l.a < 0 ? money(l.a) + " Cr" : ""}</td></tr>)}</tbody></table>}
          {v.narration && <p className="fbk-led-g">{v.narration}</p>}
        </li>;
      })}</ul>
      <p className="fbk-note" data-fb-day-totals="">{"Posted: " + d.totals.posted + (d.totals.held ? " · held: " + d.totals.held : "") + (d.totals.memo ? " · memo: " + d.totals.memo : "") + (d.totals.cancelled ? " · cancelled: " + d.totals.cancelled : "") + (d.totals.sent ? " · sent, not back: " + d.totals.sent : "") + ". Held, memo, cancelled and sent entries are shown but never added."}</p>
    </>}
  </section>;
}
