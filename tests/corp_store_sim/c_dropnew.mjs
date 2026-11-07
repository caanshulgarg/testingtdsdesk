// 5: a removal asked while the record's first save (POST) is on its way waits for it, then a conditional DELETE
import { srv, H, W, ok, done, STORE, profile0 } from "./harness.mjs";
profile0();
const S = await import(STORE);
S.corpOf("c1"); await W(20);
H.delay.POST = 300;
S.saveFiling("c1", { ref: "F2", form: "MSME-1", kind: "annual" }); await W(450);
S.dropFiling("c1", "F2");
ok(!S.corpOf("c1").filings.length, "gone from the page at once");
await W(600);
const dl = H.log.filter((l) => l.m === "DELETE");
ok(!srv.corp_filings.length && dl.length === 1 && /updated_at=eq\./.test(dl[0].path), "the server's row removed by one conditional DELETE (" + srv.corp_filings.map((r) => r.ref) + ")");
H.delay = {}; await S.pull("c1");
ok(!S.corpOf("c1").filings.length && !Object.keys(S.corpOf("c1").pending).length, "and it does not come back on a read");
done();
