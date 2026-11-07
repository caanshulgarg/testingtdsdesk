// a DELETE the row security refuses (returns []): what is said, any loop
import { srv, H, W, st, ok, done, profile0, STORE } from "./harness.mjs";
profile0();
srv.corp_filings.push({ client_id: "c1", ref: "event:SH-7:u3", form: "SH-7", kind: "event", status: "in_progress", steps: 1, data: {}, updated_at: st() });
const S = await import(STORE);
S.corpOf("c1"); await W(50);
const orig = Cloud.api;
Cloud.api = async (p, o = {}) => (o.method === "DELETE" ? (H.log.push({ m: "DELETE", path: p }), []) : orig(p, o));
S.dropFiling("c1", "event:SH-7:u3"); await W(7000);
console.log("note:", S.cloudNote("c1").text, "DELETEs:", H.log.filter((l) => l.m === "DELETE").length);
ok(H.log.filter((l) => l.m === "DELETE").length === 1, "no loop");
ok(/did not allow it/.test(S.cloudNote("c1").text) && !/another computer/.test(S.cloudNote("c1").text) && S.corpOf("c1").filings.length === 1, "said as refused, not as changed elsewhere; the record back on the page");
done();
