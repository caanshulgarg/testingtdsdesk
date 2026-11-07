// another computer saving on every try: three tries, said, then saved on the back-off
import { srv, H, W, st, ok, done, STORE, profile0 } from "./harness.mjs";
profile0({ phone: "P0", email: "E0" });
const S = await import(STORE);
S.corpOf("c1"); await W(20);
let k = 0, busy = true;
H.hook = async (m) => { if (m === "PATCH" && busy) { const r = srv.corp_profiles[0]; r.profile = Object.assign({}, r.profile, { email: "other" + (++k) }); r.updated_at = st(); } };
S.saveProfile("c1", { phone: "P1" }); await W(700);
ok(/^Not saved: another computer kept changing it/.test(S.cloudNote("c1").text) && S.corpOf("c1").profile.phone === "P1", "said; the edit on the page (" + S.cloudNote("c1").text + ")");
busy = false; await W(5600);
ok(srv.corp_profiles[0].profile.phone === "P1" && /^other/.test(srv.corp_profiles[0].profile.email) && /Saved/.test(S.cloudNote("c1").text), "saved on the back-off, the other's email kept");
done();
