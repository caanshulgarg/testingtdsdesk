// node tests/run_assistant_guard.mjs - Daily Check's test-mode guard (server/_shared/sendguard.js): no real client address
// is ever reached unless BOTH switches are on (the firm owner's real_send and the server's ASSISTANT_MAIL_LIVE = "yes").
// Every combination, odd inputs, and a thousand random ones. Made-up addresses only.
import { plan, mail, waTarget, isLive } from "../server/_shared/sendguard.js";

let fails = 0, n = 0;
const ok = (c, w) => { n++; if (!c) { fails++; console.log("  FAIL " + w); } };
const FIRM = "office@samplefirm.example", OWNER = "owner@samplefirm.example";
const contacts = [{ email: "accounts@sampletraders.example", whatsapp: "+91 90000 11111" }, { email: "Priya@SampleTraders.example", whatsapp: "" }, { email: "", whatsapp: "9000022222" }];
const client = new Set(["accounts@sampletraders.example", "priya@sampletraders.example"]);
const reached = (body) => [].concat(body.to || [], body.cc || [], body.bcc || []).map((x) => String(x).toLowerCase());

// every combination of the two switches
for (const realSend of [false, true, undefined, null, "true", 1])
  for (const live of ["yes", "no", "", undefined, "YES", "true", " yes"]) {
    const p = plan({ contacts, realSend, live, testTo: FIRM, ownerEmail: OWNER });
    const both = realSend === true && live === "yes";
    ok(isLive(realSend, live) === both, "isLive only when both: " + realSend + "/" + live);
    const body = mail({ from: "Sample & Co <mail@samplefirm.example>", replyTo: FIRM, plan: p, subject: "Questions", text: "1. Q" });
    const to = reached(body);
    if (both) ok(p.test === false && to.length === 2 && to.every((x) => client.has(x)) && !body.subject.startsWith("[TEST]"), "both on: the client's contacts, not marked test");
    else {
      ok(p.test === true && to.length === 1 && to[0] === FIRM, "test (" + realSend + "/" + live + "): only the firm's address");
      ok(!to.some((x) => client.has(x)), "test (" + realSend + "/" + live + "): no client address in to, cc or bcc");
      ok(body.subject.startsWith("[TEST] ") && body.text.startsWith("[TEST: not sent to the client."), "test: subject and body marked TEST");
      ok(body.text.includes("accounts@sampletraders.example"), "test: the body names where it would have gone");
    }
    ok(!("cc" in body) && !("bcc" in body) && Object.keys(body).every((k) => ["from", "to", "subject", "text", "reply_to"].includes(k)), "never cc or bcc, only known keys");
  }
// test mode: the owner's email when the firm set none; refused when neither is an address
ok(plan({ contacts, realSend: false, live: "yes", testTo: "", ownerEmail: OWNER }).to[0] === OWNER, "test: falls back to the signed-in owner's email");
ok(!!plan({ contacts, realSend: false, live: "", testTo: "", ownerEmail: "" }).refused, "test: no firm address at all: refused, nothing sent");
ok(!!plan({ contacts: [{ email: "" }], realSend: true, live: "yes", testTo: FIRM }).refused, "real: a client with no email: refused");
// the firm's test address can never be a list smuggling a client address
ok(!!plan({ contacts, realSend: false, live: "", testTo: "x@y.example, accounts@sampletraders.example", ownerEmail: "" }).refused, "test: a comma list is no address: refused");
// mail() refuses a refused or empty plan
let threw = false; try { mail({ plan: { refused: "x" } }); } catch (e) { threw = true; } ok(threw, "mail: a refused plan sends nothing");
threw = false; try { mail({ plan: { test: true, to: [] } }); } catch (e) { threw = true; } ok(threw, "mail: an empty list sends nothing");
// WhatsApp: the firm's own number in test mode
ok(JSON.stringify(waTarget({ contacts, realSend: false, live: "yes", firmWa: "+91 90000 00000" })) === JSON.stringify({ test: true, phones: ["919000000000"] }), "WhatsApp test: the firm's number only");
ok(waTarget({ contacts, realSend: true, live: "yes", firmWa: "+91 90000 00000" }).phones.length === 2, "WhatsApp real: the client's numbers");
// control characters: none in the subject; only line breaks and tabs in the text
{ const b = mail({ from: "f\r\nBcc: x@client.example <f@samplefirm.example>", plan: { test: true, to: [FIRM], meant: [] }, subject: "Q\r\nBcc: x@client.example", text: "a\nb\u0007c" });
  ok(!/[\r\n]/.test(b.subject) && !/[\r\n]/.test(b.from) && b.text.endsWith("a\nbc") && reached(b).length === 1, "no CR/LF in the subject or sender; control characters out of the text"); }
// random: a thousand made-up plans
let bad = 0;
for (let i = 0; i < 1000; i++) {
  const rs = [true, false, null, "true"][i % 4], lv = ["yes", "no", "", "Yes"][(i >> 2) % 4];
  const cs = Array.from({ length: i % 5 }, (_, k) => ({ email: "c" + i + "_" + k + "@client.example" }));
  const p = plan({ contacts: cs, realSend: rs, live: lv, testTo: i % 3 ? FIRM : "", ownerEmail: i % 7 ? OWNER : "" });
  if (p.refused) continue;
  const to = reached(mail({ from: "f@samplefirm.example", plan: p, subject: "s", text: "t" }));
  const real = rs === true && lv === "yes";
  if (!real && to.some((x) => x.endsWith("@client.example"))) bad++;
  if (real && to.some((x) => !x.endsWith("@client.example"))) bad++;
}
ok(bad === 0, "1,000 random plans: no client address unless both switches are on (" + bad + " bad)");
console.log(fails ? fails + " of " + n + " failed" : "all " + n + " passed");
process.exit(fails ? 1 : 0);
