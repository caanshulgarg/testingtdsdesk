// 2: a table not there (the migration not run): edits for it refused, no loop of requests; 7: Retry with nothing to send
import { srv, H, W, ok, done, STORE, profile0 } from "./harness.mjs";
profile0();
H.hook = async (m, t) => { if (t === "corp_filings") throw new Error('relation "public.corp_filings" does not exist (42P01)'); };
const pings = []; const rx = new BroadcastChannel("fincom-corp"); rx.onmessage = (m) => pings.push(m.data);
const S = await import(STORE);
S.corpOf("c1"); await W(20);
H.delay.GET = 20;
S.saveProfile("c1", { phone: "x" }); S.saveFiling("c1", { ref: "F1", form: "DPT-3" });
ok(!S.corpOf("c1").filings.length && !S.corpOf("c1").pending["f:F1"], "the filing refused (its table is not there)");
H.log = []; await W(2000);
ok(H.log.length <= 2 && srv.corp_profiles[0].profile.phone === "x", "requests in 2 s: " + H.log.length + " (the profile saved)");
ok(/e-Forms: not set up/i.test(S.cloudNote("c1").text), "said (" + S.cloudNote("c1").text + ")");
H.hook = null; pings.length = 0; H.log = [];
S.retryNow("c1"); await W(300);
ok(!H.log.length && !pings.length, "Retry with nothing to send: no request, no ping");
rx.close();
done();
