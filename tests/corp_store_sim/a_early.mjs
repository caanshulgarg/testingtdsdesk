// 1: an edit before the first read is in is kept and saved once the read is in (never dropped)
import { srv, H, W, ok, done, STORE, profile0 } from "./harness.mjs";
profile0({ phone: "P0", email: "E0" });
H.delay.GET = 300;
const S = await import(STORE);
S.corpOf("c1");
S.saveProfile("c1", { phone: "early" });
ok(S.corpOf("c1").profile.phone === "early" && S.corpOf("c1").pending.profile, "taken while the first read is on its way");
await W(1200);
ok(srv.corp_profiles[0].profile.phone === "early" && srv.corp_profiles[0].profile.email === "E0", "saved over the server's row (" + JSON.stringify(srv.corp_profiles[0].profile) + ")");
done();
