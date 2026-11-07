// a removal whose DELETE fails (offline) waits on its back-off; meanwhile a read comes in with another computer's change
import { srv, H, W, st, ok, done, profile0, STORE } from "./harness.mjs";
profile0();
srv.corp_filings.push({ client_id: "c1", ref: "event:CHG-1:u4", form: "CHG-1", kind: "event", status: "in_progress", steps: 1, srn: "", data: {}, updated_at: st() });
const S = await import(STORE);
S.corpOf("c1"); await W(50);
H.fail = true; S.dropFiling("c1", "event:CHG-1:u4"); await W(300); H.fail = false;
Object.assign(srv.corp_filings[0], { status: "filed", srn: "AB7654321", filed_on: "2026-11-06", updated_at: st() });
await S.pull("c1"); await W(6000);
console.log("server:", JSON.stringify(srv.corp_filings.map((x) => [x.ref, x.srn])), "note:", S.cloudNote("c1").text, "shown:", S.corpOf("c1").filings.map((f) => f.ref + ":" + f.status));
ok(srv.corp_filings.length === 1, "other computer's filing kept");
done();
