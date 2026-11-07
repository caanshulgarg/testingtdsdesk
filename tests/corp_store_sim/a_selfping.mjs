// 1: a tab does not read again after its own save; an edit made right after it is saved
import { srv, H, W, ok, done, STORE, profile0 } from "./harness.mjs";
profile0({ phone: "P0" });
const S = await import(STORE);
S.corpOf("c1"); await W(20);
H.delay.GET = 300; H.log = [];
S.saveProfile("c1", { phone: "P1" }); await W(450);
ok(H.log.map((l) => l.m).join(",") === "PATCH", "one save: one PATCH, no read of its own ping (" + H.log.map((l) => l.m) + ")");
ok(S.corpOf("c1").cloud.state === "ready" && S.canEdit("c1"), "still ready and editable");
S.saveProfile("c1", { email: "typed-after@example.com" }); await W(1500);
ok(srv.corp_profiles[0].profile.email === "typed-after@example.com" && srv.corp_profiles[0].profile.phone === "P1", "the edit made after it saved (" + JSON.stringify(srv.corp_profiles[0].profile) + ")");
done();
