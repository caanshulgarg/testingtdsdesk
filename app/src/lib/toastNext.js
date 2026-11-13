// ux-wins (the owner's rule: never "can't, do X first" without the button that does X; the review of 13-Nov-2026 found 38
// such messages with no button). The next step of a message that has no button of its own, asked by toast() (src/js/01)
// as window.toastNext(words): [{label, run}] or [].
//   - a step on another page ("Open a statement first.", "Connect FinCom Bridge first.") gets the button that opens it;
//   - a step on this page ("Choose the Tally ledger first.", "Tick the parties first.") gets "Show me": the box to fill
//     is scrolled to, focused and marked for a moment; no button when no such box is on the page;
//   - a message saying something failed stays until closed, with Close (toast itself, src/js/01).
// Its own file (the first file and legacy.js are at their size budgets), fetched with lib/timings.js as the app starts.
// Sign-in messages are not touched here (they are going away: next-ux-stay-signed-in).
const inClient = () => typeof S === "object" && S.view === "company" && !!S.coId;
const tallyPage = ["Open Tally page", () => { S.tallyFocus = ""; S.tallyGuide = {}; navHome("tally"); }];
const fromTally = ["Open From Tally", () => goClient("books:import"), inClient];
const bankSet = ["Open Bank settings", () => { S.step = null; S.tab = "bankset"; render(); window.scrollTo(0, 0); }, inClient];

// [the message's words, the button, what it does, (when it applies)]
const GO = [
  // (already on Bank: the upload box is shown, below)
  [/^Open a (bank )?statement first/i, "Open Bank", () => goClient("bank"), () => inClient() && S.tab !== "bank"],
  [/Tally ledger for this bank account first/i, ...bankSet],
  [/\(From Tally\)|books first \(|Books › Tally\)|Read the Tally bank book again first/i, ...fromTally],
  [/^Connect FinCom Bridge first|^Tally is not connected|^Open a company in Tally first/i, ...tallyPage],
  [/^Open (a|the) client first|open that client first/i, "Open Clients", () => navHome("clients")],
  [/^Add a client first/i, "Add client", () => doAct("addCo")],
];
// a step on this page: the words, and the boxes to look for (the first one showing, an empty one before a filled one)
const HERE = [
  [/^Open a (bank )?statement first/i, "[data-upload=bank], #app main [data-dropzone], #app main .dropzone, #app main .dz"],
  [/ledgers? first|Tally ledger on this bill first/i, "input[list], input[role=combobox], input[placeholder*=ledger i], select[aria-label*=ledger i], input[aria-label*=ledger i]"],
  [/Tick the parties first/i, "#app main table input[type=checkbox]"],
  [/email first/i, "input[type=email], input[placeholder*=mail i]"],
  [/phone first/i, "input[type=tel], input[placeholder*=phone i], input[placeholder*=mobile i]"],
  [/narration first/i, "input[placeholder*=narration i], input[aria-label*=narration i]"],
  [/year and the quarter first/i, "select[aria-label*=quarter i], select[aria-label*=year i]"],
  [/BSR code/i, "input[placeholder*=BSR i], input[aria-label*=BSR i]"],
  [/client for each file first/i, "select[aria-label*=client i], [data-multi-client]"],
  [/reason for the change first/i, "textarea, input[placeholder*=reason i]"],
  [/bill date first/i, "input[type=date], input[placeholder*=date i]"],
];
const showing = (e) => !!(e.offsetWidth || e.offsetHeight) && !e.disabled;
function boxFor(sel) {
  let all = [];
  try { all = [...document.querySelectorAll(sel)].filter((e) => showing(e) && !e.closest("#toast")); } catch (e) { /* a selector this browser does not know */ }
  return all.find((e) => e.type === "checkbox" ? !e.checked : !e.value) || all[0] || null;
}
function show(el) {
  try { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); } catch (e) { /* still marked */ }
  el.setAttribute("data-show-me", ""); setTimeout(() => el.removeAttribute("data-show-me"), 2500);
}

export function toastNext(words) {
  const s = String(words || "");
  // going away with next-ux-stay-signed-in: left as they are
  if (/sign(ed)? in/i.test(s)) return [];
  for (const [re, label, run, when] of GO) if (re.test(s) && (!when || when())) return [{ label, run }];
  if (/\bfirst\b/i.test(s)) for (const [re, sel] of HERE) if (re.test(s)) { const el = boxFor(sel); return el ? [{ label: "Show me", run: () => { const now = boxFor(sel) || el; show(now); } }] : []; }
  return [];
}
window.toastNext = toastNext;
