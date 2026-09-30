// How fresh FinCom's copy of the books is, on Reports and Look up: kept in step with Tally by the bridge, the last copy,
// or the cloud's copy; with the buttons to switch keeping in step on, bring in today's entries or check against Tally,
// and the result of that check. Was LK.freshBar (src/js/44); the work is LK (keepOn, bringToday, keepCheck).

const hhmm = (s2) => { const d = new Date(s2); return isNaN(d) ? "" : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); };
const Btn = ({ onClick, className = "btn small", children }) => <button className={className} onClick={onClick}>{children}</button>;

function Check({ c }) {
  if (c.error) return <p className="note bad">The check could not run: {c.error}</p>;
  const odd = c.missing || c.differ || c.extra;
  return <p className={"note " + (odd || !c.listMatchesDayBook ? "bad" : "ok")}>{"Checked " + FC.monthLabel(c.ym) + " against Tally: Tally has " + c.tally + " entries, the copy " + c.copy + (odd ? " (" + c.missing + " missing, " + c.differ + " changed, " + c.extra + " no longer in Tally; the bridge puts these right on its next turn)" : ", all the same") + ". The light list "}
    {c.listMatchesDayBook ? "matches" : <b>does not match</b>}{" the day book for the first days (" + c.list + " and " + c.dayBook + " entries)" + (c.listMatchesDayBook ? "." : ": please tell us, so the bridge can be adjusted for your Tally.")}</p>;
}

// the cloud's copy of the books: how old, days not read yet, Tally not answering. Was TCloud.bar (src/js/49)
function CloudBar({ cid }) {
  const bk = TCloud.book(cid); if (!bk) return null;
  const st = bk.state || {}, sk = [].concat(st.skipped || []).filter(Boolean);
  return <><b>The books</b>{": " + (st.phase === "first" ? "the first copy is still being made (up to " + FC.when(String(st.doneTo || "")) + ")" : TCloud.age(bk)) + "."}
    {sk.length > 0 && <>{" "}<span className="bad"><b>{sk.length + (sk.length === 1 ? " day" : " days") + " not read yet"}</b> from Tally.</span></>}
    {st.trouble && st.trouble.at && <>{" "}<span className="note">{"Tally did not answer at " + String(st.trouble.at).slice(11, 16) + "; the bridge carries on by itself."}</span></>}</>;
}

export default function FreshBar({ b }) {
  const f = LK.fr(), live = LK.live(), meta = (b && b.meta) || {}, have = (b.vouchers || []).length > 0, sch = f.sch || {}, today = Audit.today(), m = f.man || {}, kp = f.keep || {};
  if (!have && !live && !meta.keep && !TCloud.has(S.coId)) return null;
  const chk = f.check ? <Check c={f.check} /> : null;
  // the cloud's copy: what this page shows when it is the source
  if (TCloud.has(S.coId) && ((meta.cloud && !m.keep) || !live)) return <div className="lk-fresh"><span className="note"><CloudBar cid={S.coId} /> Totals come from this copy, so Tally is never held up.</span>{chk}</div>;
  let upTo, btns = null;
  if (m.keep) {
    const seenMin = m.seen ? (Date.now() - Date.parse(m.seen)) / 60000 : 999;
    if (m.phase === "open") upTo = "The bridge is reading the opening balances, a few ledgers at a time.";
    else if (m.phase === "first") { const pct = Math.max(0, Math.min(99, Math.round(Audit.days(m.from, m.doneTo || m.from) / Math.max(1, Audit.days(m.from, today)) * 100))); upTo = <>The bridge is copying this company from Tally a few days at a time: up to <b>{FC.when(m.doneTo)}</b>{" (" + pct + "%). It carries on whenever the company is open in Tally."}</>; }
    else upTo = seenMin < 5 ? <><b>In step with Tally</b>{" (checked at " + hhmm(m.seen) + ")."}</> : <>In step with Tally as of <b>{fmtDate(String(m.seen).slice(0, 10)) + " " + hhmm(m.seen)}</b>, when the company was last open.</>;
    const sk = (m.skipped || []).filter(Boolean);
    upTo = <>{upTo}
      {sk.length > 0 && <>{" "}<span className="bad"><b>{sk.length + (sk.length === 1 ? " day" : " days") + " not read yet"}</b>{" from Tally: " + sk.slice(0, 3).map((d) => fmtDate(Audit.iso(d))).join(", ") + (sk.length > 3 ? " and " + (sk.length - 3) + " more" : "") + ". Figures touching " + (sk.length === 1 ? "that day" : "those days") + " may be out; the bridge tries again every few minutes."}</span></>}
      {m.trouble && m.trouble.at && <>{" "}<span className="note">{"Tally did not answer at " + hhmm(m.trouble.at) + "; the bridge is leaving it alone for a while and will carry on by itself."}</span></>}</>;
    btns = live ? <Btn onClick={() => LK.keepCheck()}>Check against Tally</Btn> : null;
  } else {
    upTo = have ? <>The books in FinCom run to <b>{FC.when(meta.to)}</b>{(meta.copyAt ? " (copy made " + String(meta.copyAt).replace("T", " ").slice(0, 16) + (meta.todayAt ? "; today’s entries brought in at " + hhmm(meta.todayAt) : "") + ")" : meta.at ? " (read " + LK.booksAge() + ")" : "") + "."}</> : "No books in FinCom yet.";
    if (live) {
      btns = <>{kp.ok ? (kp.on ? null : <Btn className="btn small primary" onClick={() => LK.keepOn(true)}>Keep this company in step with Tally</Btn>) : <span className="note">Install Tally Bridge 1.13.0 to keep companies in step while they are open.</span>}
        {have && String(meta.to) < today && <Btn onClick={() => LK.bringToday()}>Bring in today’s entries</Btn>}
        {sch.on && <span className="note">{"Nightly copy is on" + (sch.next ? ", next " + sch.next : "") + "."}</span>}</>;
      if (kp.on) upTo = <>{upTo} The bridge starts keeping it in step within a minute of the company being open in Tally.</>;
    } else btns = <span className="note">Connect the Tally Bridge to keep this up to date.</span>;
  }
  return <div className="lk-fresh"><span className="note">{upTo} Totals come from this copy, so Tally is never held up.</span>{btns}{chk}</div>;
}
