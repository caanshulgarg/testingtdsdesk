// 1: a read again (another tab's ping) never makes the page "loading" nor drops an edit made while it is on its way;
// a read again that fails leaves the page editable
import { srv, H, W, ok, done, STORE, profile0 } from "./harness.mjs";
profile0({ phone: "P0" });
const S = await import(STORE);
S.corpOf("c1"); await W(20);
H.delay.GET = 300;
const pr = S.pull("c1");
ok(S.corpOf("c1").cloud.state === "ready" && S.canEdit("c1"), "during a read again: ready, editable");
S.saveProfile("c1", { website: "typed-during-reread.example.com" });
ok(S.corpOf("c1").profile.website === "typed-during-reread.example.com" && S.corpOf("c1").pending.profile, "the edit taken, not saved yet");
await pr; await W(1200);
ok(srv.corp_profiles[0].profile.website === "typed-during-reread.example.com", "and saved after the read");
H.delay = {}; H.fail = true; await S.pull("c1");
ok(S.corpOf("c1").cloud.state === "ready" && S.canEdit("c1") && /could not be read/.test(S.cloudNote("c1").text) && S.cloudNote("c1").retry, "a read again failed: still editable, said with Retry (" + S.cloudNote("c1").text + ")");
H.fail = false; S.retryNow("c1"); await W(50);
ok(/Saved to the firm account/.test(S.cloudNote("c1").text), "Retry: read again");
done();
