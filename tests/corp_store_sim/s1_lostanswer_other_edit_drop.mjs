// A's first POST lands but the answer is lost (timeout); B marks it filed with an SRN; A removes the event form.
import { srv, H, W, st, ok, done, profile0, STORE } from "./harness.mjs";
globalThis.window.__corpTimeout = 200;
profile0();
const S = await import(STORE);
S.corpOf("c1"); await W(20);
const orig = Cloud.api; let hang = true;
Cloud.api = async (p, o = {}) => { if (o.method === "POST" && hang) { hang = false; await orig(p, o); return new Promise(() => {}); } return orig(p, o); };
S.saveFiling("c1", { ref: "event:DIR-12:u1", form: "DIR-12", kind: "event", status: "not_started", steps: 0 }); await W(800);
console.log("A note:", S.cloudNote("c1").text);
// B (another computer) files it
const r = srv.corp_filings.find((x) => x.ref === "event:DIR-12:u1"); Object.assign(r, { status: "filed", srn: "AB1234567", filed_on: "2026-11-06", updated_at: st() });
S.dropFiling("c1", "event:DIR-12:u1"); await W(800);
console.log("server:", JSON.stringify(srv.corp_filings.map((x) => [x.ref, x.status, x.srn])), "note:", S.cloudNote("c1").text);
ok(srv.corp_filings.some((x) => x.ref === "event:DIR-12:u1"), "B's filed SRN not removed without a word");
done();
