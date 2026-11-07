// A's POST lands, answer lost (fails); on the back-off retry POST (dup) A removes it while that POST is on its way
import { srv, H, W, st, ok, done, profile0, STORE } from "./harness.mjs";
profile0();
const S = await import(STORE);
S.corpOf("c1"); await W(20);
const orig = Cloud.api; let n = 0;
Cloud.api = async (p, o = {}) => { if (o.method === "POST") { n++; if (n === 1) { try { await orig(p, o); } catch (e) {} throw new TypeError("Failed to fetch"); } await W(300); return orig(p, o); } return orig(p, o); };
S.saveFiling("c1", { ref: "event:PAS-3:u2", form: "PAS-3", kind: "event", status: "not_started", steps: 0 }); await W(600);
// the back-off (5 s) retry POST goes; drop it while on its way
await W(4950); S.dropFiling("c1", "event:PAS-3:u2"); await W(1500);
console.log("server:", JSON.stringify(srv.corp_filings.map((x) => x.ref)), "note:", S.cloudNote("c1").text, "posts", n);
ok(!/another computer/.test(S.cloudNote("c1").text), "no false 'changed on another computer'");
ok(!srv.corp_filings.length, "removed");
done();
