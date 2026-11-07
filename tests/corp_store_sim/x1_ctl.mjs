// the same, the key order as sent (a control)
import { srv, H, W, ok, done, profile0, STORE } from "./harness.mjs";
const jb = (o) => Array.isArray(o) ? o.map(jb) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, jb(o[k])])) : o;
profile0();
const S = await import(STORE);
S.corpOf("c1"); await W(20);
const orig = Cloud.api; let n = 0;
Cloud.api = async (p, o = {}) => { if (o.body && o.body.data) o = Object.assign({}, o, { body: Object.assign({}, o.body, { data: o.body.data }) });
  if (o.method === "POST") { n++; if (n === 1) { try { await orig(p, o); } catch (e) {} throw new TypeError("Failed to fetch"); } } return orig(p, o); };
// first POST lands, answer lost; removed before the retry
S.saveFiling("c1", { ref: "event:DIR-12:u9", form: "DIR-12", kind: "event", period: "2026-11", event: "2026-11-01", due: "2026-12-01", status: "not_started", steps: 0, data: { event: "Director appointed or resigned", note: "", kind: "appointed" } });
await W(600);
S.dropFiling("c1", "event:DIR-12:u9"); await W(1500);
console.log("server:", JSON.stringify(srv.corp_filings.map((x) => x.ref)), "note:", S.cloudNote("c1").text);
ok(!srv.corp_filings.length && !/another computer/.test(S.cloudNote("c1").text), "own row removed, no false NOT_REMOVED");
done();
