// deno test --allow-read server/_shared/clientip_test.ts - the address a request came from (security review L4)
import { clientIp, isIp } from "./clientip.ts";
function eq(a: unknown, b: unknown, w = "") { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(w + " " + JSON.stringify(a) + " !== " + JSON.stringify(b)); }
const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });

Deno.test("L4: the edge's own header first; a caller's X-Forwarded-For never moves it", () => {
  eq(clientIp(req({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  eq(clientIp(req({ "cf-connecting-ip": "2001:DB8::7" })), "2001:db8::7");
});
Deno.test("L4: without it, the last public address of X-Forwarded-For (the platform's own), never the first (the caller's)", () => {
  eq(clientIp(req({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7", "one hop");
  eq(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7", "the platform's inside hop to its right is skipped");
  for (const made of ["1.1.1.1", "8.8.8.8, 9.9.9.9", "not-an-ip", "127.0.0.1", "'; drop--", "2001:db8::1"])
    eq(clientIp(req({ "x-forwarded-for": made + ", 198.51.100.9, 172.16.0.3, 10.0.0.1" })), "198.51.100.9", "whatever the caller wrote first: " + made);
});
Deno.test("L4: nothing usable: the fallback; only an address is ever taken", () => {
  eq(clientIp(req({})), "unknown"); eq(clientIp(req({ "x-forwarded-for": "10.0.0.1, 192.168.1.1" }), "127.0.0.1"), "127.0.0.1");
  eq(clientIp(req({ "cf-connecting-ip": "evil\tvalue", "x-forwarded-for": "<script>" })), "unknown");
  eq([isIp("203.0.113.7"), isIp("999.1.1.1"), isIp("::1"), isIp("abc"), isIp("1.2.3.4.5")], [true, false, true, false, false]);
});
Deno.test("L4: every function that counts by address, or passes it on, takes it from here", async () => {
  const root = new URL("../", import.meta.url);
  for (const f of ["signup/handler.ts", "security/functions/signin/handler.ts", "video-calls/handler.ts", "gst-api/index.ts", "gst-taxpro/index.ts"]) {
    const src = (await Deno.readTextFile(new URL(f, root))).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    if (!/from "\.\.\/(\.\.\/)?_shared\/clientip\.ts"/.test(src)) throw new Error(f + " does not import ../_shared/clientip.ts");
    if (/get\("x-forwarded-for"\)|get\("cf-connecting-ip"\)/.test(src)) throw new Error(f + " reads the address headers itself");
  }
});
