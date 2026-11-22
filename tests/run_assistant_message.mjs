// node tests/run_assistant_message.mjs - the client's weekly message (server/_shared/asks.js) carries only what is still
// needed from the client: never a finding resolved by FinCom, one for the firm ("Needs you"), an answered or closed
// question, or one not ticked. Made-up data only (tests/daily_fixture.mjs).
import { sendable, message, waLink } from "../server/_shared/asks.js";
import { FINDINGS, CLIENTS } from "./daily_fixture.mjs";

let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const words = (s) => String(s || "").toLowerCase();

for (const c of CLIENTS) {
  const mine = FINDINGS.filter((f) => f.cid === c.id);
  const qs = sendable(mine, null), m = message(c, qs, { firm: "Sample & Co", week: "16-Nov-2026" });
  for (const f of mine) {
    const inMsg = (t) => !!t && words(m.text).includes(words(t));
    if (f.state === "resolved") ok(!inMsg(f.short) && !f.evidence.some((e) => inMsg(e.label)) && !inMsg(f.party + " "), c.name + ": resolved " + f.id + " is not in the message");
    if (f.state === "you") ok(!inMsg(f.title), c.name + ": needs-you " + f.id + " is not in the message");
    if (f.ask && (f.ask.state === "answered" || f.ask.state === "closed")) ok(!inMsg(f.ask.text), c.name + ": " + f.ask.state + " " + f.ask.id + " is not asked again");
    if (f.state === "ask" && (f.ask.state === "draft" || f.ask.state === "asked")) ok(inMsg(f.ask.text), c.name + ": " + f.ask.id + " is in the message");
  }
  ok(!/resolved|fincom found|already/i.test(m.text), c.name + ": no list of what was resolved");
}
// a question not ticked stays out; an edited one goes as edited
const d1 = FINDINGS.filter((f) => f.cid === "d1");
const pick = new Set(["q1"]), only = sendable(d1, pick);
ok(only.length === 1 && only[0].ask.id === "q1", "only the ticked question is sendable");
const ed = d1.map((f) => f.ask && f.ask.id === "q1" ? { ...f, ask: { ...f.ask, edited: "Has the ABC Traders bill come?" } } : f);
ok(message(CLIENTS[0], sendable(ed, pick)).text.includes("1. Has the ABC Traders bill come?"), "an edited question goes as edited, numbered");
ok(message(CLIENTS[0], []).text === "", "nothing to ask: no message");
ok(message(CLIENTS[0], only, { test: true }).text.startsWith("[TEST"), "test mode marks the message");
ok(!/[\r\n]/.test(message({ name: "Evil\r\nBcc: x@y" }, only, { firm: "F\nG" }).subject), "a name with a line break never breaks the subject");
ok(waLink("90000 11111", "hi") === "https://wa.me/919000011111?text=hi", "a 10-digit number gets 91");
ok(waLink("", "hi") === "", "no number: no link");
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
