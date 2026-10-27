// One status word per client, everywhere (next-link-record, 26-Oct-2026; the owner's step 2 of "Stable Tally linking"):
// the Tally page's rows, the client's title chip, the Clients list and Post to Tally say the SAME word, from this one
// function (globalThis.LinkWord, put there by parts/LinkStatus.jsx; lib/tallyState.js clientTallyState hands over to it):
//   Linked              reading and posting are fine: "reading · posting allowed · last entry 18:42"
//   Waiting for Tally   linked, the company not open on any computer now: one plain line, "Open <company> in TallyPrime
//                       on <PC>" (Tally closed, the company not open, the computer offline)
//   Needs you           one line and one button: the same company in two places (Choose), FinCom Bridge cannot reach
//                       Tally on its port (Show the steps), posting stopped (Allow posting), reading stopped or paused,
//                       Tally not answering, entries waiting for a person (Open the Tally page)
//   Not linked          Link
// From the client's link record (src/js/98-link-record.js) and what bridge 2.4.7 already sends (the beat: Tally open or
// closed, the companies open, each bridge's ports and their errors; tally_devices: when the computer was last heard from).
// Nothing new is asked of the bridge or Tally.
// {state (the pill's code, as lib/tallyState.js: connected | notopen | offline | unseen | unlinked), kind (linked |
//  waiting | needs | unlinked), word, level, line, text (the word and the line), button: {label, act} | null, company,
//  computer, seen, port}
import { tallyDevs, openOn, pcOf, coKey, lastEntry, tallyCoState } from "./tallyState.js";
import { portIssueOf, portIssueWords, portWarnWords } from "./tallyPort.js";

const hm = (t) => String((typeof tallyHm === "function" ? tallyHm(t) : "") || "").replace(/\s*IST$/, "");
// two names of the same company: the same words, or one linked company's names (renamed in Tally: the link record knows)
export const sameCo = (a, b) => coKey(a) === coKey(b) || (typeof LinkRec === "object" && LinkRec.same(a, b));
const check = () => (typeof tallyCheckNow === "function" ? tallyCheckNow() : null);
const goLink = (co) => () => { S.tallyPanel = false; if (typeof openConnectTally === "function") openConnectTally(4, co.id); window.scrollTo(0, 0); };
const goRow = (co) => () => { S.tallyPanel = false; S.tallyGuide = {}; if (typeof openTallyFor === "function") openTallyFor(co.id); else if (typeof navHome === "function") navHome("tally"); window.scrollTo(0, 0); };
export const WORDS = { linked: "Linked", waiting: "Waiting for Tally", needs: "Needs you", unlinked: "Not linked" };
const LEVEL = { linked: "ok", waiting: "warn", needs: "bad", unlinked: "warn" };

export function linkWord(co, company) {
  if (!co || typeof tallyLinkOf !== "function") return null;
  const k = tallyLinkOf(co);
  const o = (kind, line, button, extra) => Object.assign({ kind, word: WORDS[kind], level: LEVEL[kind], line: line || "", button: button || null, state: "unlinked", company: "", computer: "", seen: "" }, extra || {},
    { text: WORDS[kind] + (line ? " — " + line : "") });
  if (!k || k.state === "unlinked") return o("unlinked", "", { label: "Link", act: goLink(co) });
  const lp = typeof linkPostOf === "function" ? linkPostOf(co) : null;
  const rec = lp ? (company ? lp.recs.find((r) => LinkRec.isName(r, company)) : null) || lp.pick || lp.recs[0] || null : null;
  const name = company || (rec ? LinkRec.nameOf(rec) : k.company) || k.company || "";
  const st = tallyCoState(name);
  // the computer that keeps it: its row's (the cloud's companies), else the record's, else one with it open now
  const rows = [].concat((typeof TLight === "object" && TLight.st.cos) || [], (typeof TCloud === "object" && TCloud.pane && TCloud.pane.companies) || []);
  const row = rows.find((r) => r && String(r.client_id || "") === String(co.id) && r.device_id && sameCo(r.company, name)) || (typeof tallyRowOf === "function" ? tallyRowOf(co, rows) : null);
  const devs = tallyDevs(), devId = (row && row.device_id) || (rec && rec.device_id) || "";
  const dev = devs.find((d) => d.id === devId) || devs.find((d) => openOn(d).some((n) => sameCo(n, name))) || null;
  const pc = (rec && rec.computer) || (dev ? pcOf(dev).split(" · ")[0] : "") || "its computer";
  const base = { state: st.state, company: name, computer: st.computer || pc, seen: st.seen };
  const open = "Open " + name + " in TallyPrime on " + pc;
  // the same company in two places (a copied data folder keeps the GUID): nothing from the other place is applied
  if (rec && typeof LinkRec === "object" && LinkRec.twoPlaces(rec)) return o("needs", name + " is open in two places with different data: choose which is the books", { label: "Choose", act: goRow(co) }, base);
  // (no computer of the firm has FinCom Bridge at all: that is what to do first)
  if (!dev) return o("waiting", devs.length ? open : "Install FinCom Bridge on the computer with TallyPrime", null, base);
  const ds = typeof devState === "function" ? devState(dev) : { bridge: "online", tally: "open" };
  if (ds.bridge === "offline" || ds.bridge === "none") return o("waiting", open, null, base);
  // the bridge itself reports it cannot reach Tally on its port (never a port FinCom only guesses at)
  const pi = portIssueOf(dev, name, sameCo);
  if (pi) return o("needs", portIssueWords(pi) + ". " + portWarnWords(pi.free), { label: "Show the steps", act: null }, Object.assign(base, { port: pi }));
  if (ds.tally === "closed") return o("waiting", open, null, base);
  const lists = [((dev.info || {}).beat || {}).open].concat(Object.values((dev.info || {}).bridges || {}).map((b) => b && b.open)).filter(Array.isArray);
  if (lists.length && !lists.some((l) => l.some((n) => sameCo(n, name)))) return o("waiting", open, null, base);
  const posting = rec ? !!rec.posting_allowed : typeof postToProblem === "function" && !postToProblem(co, "");
  if (!posting && rec) return o("needs", "Posting into Tally is stopped for " + co.name, { label: "Allow posting", act: () => (typeof linkPostingSet === "function" ? linkPostingSet(co, rec, true) : null) }, base);
  const l = k.line || null;
  if (l && l.state === "stopped") return o("needs", l.text, { label: "Open the Tally page", act: goRow(co) }, base);
  if (l && l.state === "paused") return o("needs", l.text, { label: "Update now", act: () => (typeof tallyUpdateNow === "function" ? tallyUpdateNow(co.id) : null) }, base);
  if (l && l.state === "notanswering") return o("needs", l.text, { label: "Check again", act: check }, base);
  if (k.state === "needs") return o("needs", "Entries wait for you on the Tally page", { label: "Open the Tally page", act: goRow(co) }, base);
  const last = lastEntry(co, k);
  return o("linked", ["reading", posting ? "posting allowed" : "posting not allowed", last ? "last entry " + hm(last) : ""].filter(Boolean).join(" · "), null, base);
}
