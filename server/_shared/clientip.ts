// The address a request came from, as the platform saw it (13-Nov-2026, security review L4). Plain module.
// A caller can write any X-Forwarded-For it likes, and proxies only add to its right; so the first entry is the
// caller's own word and is never used. In order:
//   1. cf-connecting-ip: set by the edge in front of the functions, which replaces a caller's own value;
//   2. the last public address of x-forwarded-for: the one the platform's own proxy added (private and loopback hops
//      to its right are the platform's inside addresses);
//   3. the fallback ("unknown": every such request shares one count).
// Only something that reads as an IPv4 or IPv6 address is taken.
const V4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const V6 = /^(?=.*:)[0-9a-f:.]{2,45}$/i;
export const isIp = (s: string) => V4.test(s) || (V6.test(s) && s.split(":").length <= 9);
export function isPrivate(ip: string): boolean {
  const s = ip.toLowerCase();
  if (V4.test(s)) { const [a, b] = s.split(".").map(Number); return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127); }
  return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb") || s.startsWith("::ffff:10.") || s.startsWith("::ffff:127.") || s.startsWith("::ffff:192.168.");
}
export function clientIp(req: { headers: { get(name: string): string | null } }, fallback = "unknown"): string {
  const cf = String(req.headers.get("cf-connecting-ip") || "").trim();
  if (isIp(cf)) return cf.toLowerCase();
  const hops = String(req.headers.get("x-forwarded-for") || "").split(",").map((x) => x.trim()).filter(isIp);
  for (let i = hops.length - 1; i >= 0; i--) if (!isPrivate(hops[i])) return hops[i].toLowerCase();
  return fallback;
}
