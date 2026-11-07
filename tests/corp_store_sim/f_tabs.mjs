// 1: two tabs: each reads after the other's save, never after its own; nothing typed is lost
import { srv, H, W, ok, done, STORE, profile0 } from "./harness.mjs";
profile0({ phone: "P0" });
const A = await import(STORE + "?a"), B = await import(STORE + "?b");
A.corpOf("c1"); B.corpOf("c1"); await W(30);
H.log = []; H.delay.GET = 30; H.delay.PATCH = 30;
A.saveProfile("c1", { phone: "PA" }); B.saveProfile("c1", { email: "EB" });
await W(3000);
const p = srv.corp_profiles[0].profile;
ok(H.log.length <= 14, "requests in 3 s: " + H.log.length + " (" + H.log.map((l) => l.m) + ")");
ok(p.phone === "PA" && p.email === "EB" && A.corpOf("c1").profile.email === "EB" && B.corpOf("c1").profile.phone === "PA", "both edits on the server and in both tabs");
for (const [g, d] of [["f", 30], ["g", 300]]) {
  H.delay.GET = d;
  for (let i = 0; i < 8; i++) { A.saveProfile("c1", { [g + i]: "v" + i }); await W(500); }
  await W(2000);
  const got = Object.keys(srv.corp_profiles[0].profile).filter((k) => k[0] === g).sort().join(",");
  ok(got === [0, 1, 2, 3, 4, 5, 6, 7].map((i) => g + i).join(","), "typed every 500 ms (reads " + d + " ms): all on the server (" + got + ")");
}
done();
