// two reads again on their way at once (two pings from another computer's tab / a ping and "online"); the one started
// first comes back last and is laid over the newer one
import { srv, H, W, st, ok, done, profile0, STORE } from "./harness.mjs";
profile0();
const S = await import(STORE);
S.corpOf("c1"); await W(20);
const orig = Cloud.api; let slow = 0;
Cloud.api = async (p, o = {}) => { const d = !o.method ? slow : 0; const r = await orig(p, o); if (d) await W(d); return r; };
slow = 600; const p1 = S.pull("c1"); slow = 0;               // read 1: before F1 exists
srv.corp_filings.push({ client_id: "c1", ref: "F1", form: "DPT-3", kind: "annual", status: "in_progress", steps: 1, data: {}, updated_at: st() });
await W(10); await S.pull("c1");                              // read 2: F1 in
ok(S.corpOf("c1").filings.some((f) => f.ref === "F1"), "F1 on the page after read 2");
await W(350);
S.saveFiling("c1", { ref: "F1", srn: "A11111111" });          // typed; read 1 lands within the 400 ms debounce
await p1; await W(800);
const n = S.cloudNote("c1");
console.log("note:", n.text, "server F1 srn:", (srv.corp_filings.find((r) => r.ref === "F1") || {}).srn);
ok(!n.removed, "no false 'Removed on another computer' while F1 is on the server");
S.settleRemoved("c1", false); await W(200);
await S.pull("c1");
const f1 = S.corpOf("c1").filings.find((f) => f.ref === "F1");
ok(f1 && f1.srn === "A11111111", "the SRN typed is kept (" + JSON.stringify(f1 && f1.srn) + ")");
done();
