// Tally tell on the page (the owner, 24-Nov-2026: "There should be proper way to tell and auto import of tally days into
// fincom"; plan tally-tell-autoday-plan.md A.2, A.3): the cloud's ONE sentence for a company and its one button, the
// computers' lines, as migration 221 says them (lib/tallyTell.js). Plain words, no warning; FinCom does the rest itself.
//   TellLine  a company's row on the Tally page (the primary place): the sentence (at most two: Reading and Changes when
//             they differ; "Entries go to Tally when ..." when posting waits), its button; an earlier year FinCom does not
//             keep, said once with "Add 2025-26" (the existing Bring another year; never added by itself)
//   TellFix   the button of a fix: link (the link picker), download (FinCom Bridge's setup), update (its newer setup,
//             owners), turn_on (Turn on for this computer, owners), resume (Resume reading, owners), add_year
//   TellPcs   the computers that send Tally's books, each with its line ("Update FinCom Bridge on Hemant's computer.");
//             each person their own computer, owners every one (the cloud's own rule)
// A cloud without 221: nothing at all, and no error.
import { useEffect, useState } from "react";
import { book as tellBook, computers, view } from "../lib/tallyTell.js";
import { TurnOn, bookSum, summary, askYear, fyLabel } from "./TallyFetch.jsx";
import { press, busyOf, Said, useSaid } from "./TallyBtn.jsx";

const isOwner = () => !!(typeof S === "object" && S.account && S.account.me && S.account.me.role === "owner");
const mayWrite = () => (typeof S === "object" && S.account && S.account.me ? ["owner", "staff"].includes(S.account.me.role) : true);
// FinCom Bridge's setup on this site (the same file the Tally page's Download gives), read once
const SET = { p: null, v: undefined };
function useSetupFile() {
  const [, tick] = useState(0);
  useEffect(() => { if (SET.v !== undefined) return; SET.p = SET.p || fetch("assets/bridge-go/latest.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((m) => { const s = m && m.setup; SET.v = s && s.url && s.sha256 ? { file: s.url.split("/").pop(), version: s.version, href: "assets/bridge-go/" + s.url.split("/").pop() + "?v=" + String(s.sha256).slice(0, 12) } : null; });
    SET.p.then(() => tick((n) => n + 1)); }, []);
  return SET.v;
}
function SetupLink({ hook, label }) {
  const s = useSetupFile();
  return s ? <a className="btn small primary" data-tell-fix={hook} href={s.href} download={s.file}>{label(s)}</a> : null;
}
const ownerOnly = <span className="note" data-tell-owner="">{" An owner of the firm does this."}</span>;
export function TellFix({ fix, cid, b }) {
  useSaid();
  if (!fix) return null;
  if (fix === "link") return mayWrite() && cid ? <button type="button" className="btn small primary" data-tell-fix="link" onClick={() => { if (typeof openConnectTally === "function") openConnectTally(4, cid); }}>Link</button> : null;
  if (fix === "download") return <SetupLink hook="download" label={() => "Download FinCom Bridge"} />;
  if (fix === "update") return isOwner() ? <SetupLink hook="update" label={(s) => "Update to " + s.version} /> : ownerOnly;
  if (fix === "turn_on") { const bs = cid ? bookSum(cid) : null; if (!bs) summary(); return bs ? <span data-tell-fix="turn_on"><TurnOn b={bs} /></span> : null; }
  if (fix === "resume") {
    if (!isOwner()) return ownerOnly;
    const co = cid && S.companies ? S.companies[cid] : null, l = co && typeof tallyLine === "function" ? tallyLine(co) : null, st = l && l.stop;
    const k = "tellresume:" + (cid || "");
    return <><button type="button" className="btn small primary" data-tell-fix="resume" disabled={busyOf(k)} onClick={() => press(k, async () => {
      await TCloud.readResume(st && !st.all && st.deviceId ? { device: { id: st.deviceId }, computer: st.computer || l.computer } : null);
      return "Reading from Tally starts again within a minute."; })}>Resume reading</button><Said k={k} hook="tell-resume" className="note" /></>;
  }
  if (fix === "add_year") {
    const e = b && b.earlier, y = e && /^(\d{4})-\d{2}$/.exec(String(e.fy || ""));
    if (!y || !b.book) return null;
    if (!mayWrite()) return <span className="note">{" A member of the firm who may make changes adds it."}</span>;
    const k = "addyear:" + b.book;
    return <><button type="button" className="btn small primary" data-tell-fix="add_year" data-tell-fy={e.fy} disabled={busyOf(k)}
      onClick={() => press(k, () => askYear({ p_book: b.book, p_fy_start: y[1] + "-04-01", p_part: "year" }).then((r) => {
        summary(true);
        if (r && r.ok === false) return { text: "Not added: " + String(r.error || "FinCom did not take it").replace(/[.\s]+$/, "") + ".", bad: true };
        return "Asked: FinCom brings " + fyLabel(Number(y[1])) + " from Tally, while nobody is working in Tally."; }))}>{busyOf(k) ? "Adding…" : "Add " + e.fy}</button>
      <Said k={k} hook="tell-add-year" className="note" /></>;
  }
  return null;
}

// the lines of a book: [{code, words, fix, what}] (A.1 "the three lines")
export function linesOf(b) {
  if (!b || !b.cause || !b.cause.words) return [];
  const r = b.read || {}, c = b.changes || {}, p = b.post || {}, out = [];
  if (r.code && c.code && r.code !== c.code && r.words && c.words) out.push({ ...r, what: "read" }, { ...c, what: "changes" });
  else out.push({ ...b.cause, what: "cause" });
  if (p.code && p.words && out.length < 2 && p.words !== out[0].words) out.push({ ...p, what: "post" });
  return out;
}
export function TellLine({ cid, company = "", where = "row" }) {
  if (!view()) return null;
  const b = tellBook(cid, company);
  if (!b) return null;
  const ls = linesOf(b), e = b.earlier && b.earlier.words ? b.earlier : null;
  if (!ls.length && !e) return null;
  const Box = where === "tco" ? "div" : "span";
  return <Box className={where === "tco" ? "tco-under note tpt-tell" : "tpt-tell"} data-tell-of={cid} data-tell-where={where}>
    {ls.map((x) => <span key={x.what} className="tpt-why tpt-tell-line" data-tell-line={x.code} data-tell-what={x.what}>{x.words}{x.fix && <>{" "}<TellFix fix={x.fix} cid={cid} b={b} /></>}</span>)}
    {e && <span className="tpt-why tpt-tell-line" data-tell-line="earlier" data-tell-what="earlier">{e.words}{" "}<TellFix fix={e.fix || "add_year"} cid={cid} b={b} /></span>}
  </Box>;
}

// the computers' lines (A.2): the computer named here only, never in the header or the bell
export function TellPcs({ title = "Computers that send Tally’s books" }) {
  if (!view()) return null;
  const pcs = computers();
  if (!pcs.length) return null;
  return <section className="tsm-card tpt-tell-pcs" data-tell-pcs="" aria-label={title}>
    <b>{title}</b>
    <ul className="tpt-tell-pclist">{pcs.map((d) => <TellPc key={d.device} d={d} />)}</ul>
  </section>;
}
export function TellPc({ d }) {
  if (!d || !d.words) return null;
  return <li data-tell-pc={d.device} data-tell-pc-code={d.code} data-tell-pc-mine={d.mine ? "" : undefined}>
    <span className="tpt-tell-pcname">{d.computer || "A computer"}</span>{d.mine && <> <span className="tag ok">you</span></>}{": "}
    <span data-tell-pc-words="">{d.words}</span>{d.fix && <>{" "}<TellFix fix={d.fix} /></>}</li>;
}
export function TellPcWords({ id }) {
  if (!view()) return null;
  const d = computers().find((x) => x.device === id);
  return d && d.words ? <span data-tell-pc={d.device} data-tell-pc-code={d.code}><span data-tell-pc-words="">{d.words}</span>{d.fix && <>{" "}<TellFix fix={d.fix} /></>}</span> : null;
}
