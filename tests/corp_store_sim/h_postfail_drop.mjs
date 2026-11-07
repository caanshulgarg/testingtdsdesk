// drop while the first POST is on its way, and that POST fails (reply lost after the server applied it / never applied).
// Real PostgREST rejects updated_at=eq. (empty) on a timestamptz with 22007; mimicked here.
import { srv, H, W, ok, done, profile0, STORE } from "./harness.mjs";
profile0();
const S = await import(STORE);
S.corpOf("c1"); await W(20);
let failPost = true;
H.hook = async (m, t, f, o) => {
  if (m === "DELETE" && f.updated_at === "") throw new Error('invalid input syntax for type timestamp with time zone: ""');
};
const orig = Cloud.api;
Cloud.api = async (p, o = {}) => { if (o.method === "POST" && failPost) { const r = await orig(p, o); await W(300); failPost = false; throw new TypeError("Failed to fetch"); } return orig(p, o); };
S.saveFiling("c1", { ref: "F9", form: "MSME-1", kind: "annual" }); await W(450);
S.dropFiling("c1", "F9");
await W(400);
console.log("server rows:", srv.corp_filings.map((r) => r.ref), "note:", S.cloudNote("c1").text);
const dels = () => H.log.filter((l) => l.m === "DELETE").map((l) => l.path);
await W(6000);
console.log("after back-off: DELETEs", dels(), "note:", S.cloudNote("c1").text, "pending:", JSON.stringify(S.corpOf("c1").pending));
ok(!dels().some((p) => /updated_at=eq\.(&|$)/.test(p)), "no DELETE with an empty updated_at");
ok(!srv.corp_filings.some((r) => r.ref === "F9") || S.corpOf("c1").filings.some((f) => f.ref === "F9"), "server row either removed or shown (not hidden-yet-there)");
ok(!Object.keys(S.corpOf("c1").pending).length, "nothing stuck pending");
await S.pull("c1"); await W(100);
console.log("after a read: shown", S.corpOf("c1").filings.map((f) => f.ref), "note:", S.cloudNote("c1").text);
done();
