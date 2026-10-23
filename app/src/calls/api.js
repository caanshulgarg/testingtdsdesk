// fincom-call from the browser: a member through the firm account's own sign-in (Cloud.fn, which refreshes the token),
// a guest with the signed guest pass (gt) and the project's public key only.
export const FN = "fincom-call";
const cfg = () => (typeof Cloud === "object" && Cloud.cfg ? Cloud.cfg() : { url: "", key: "" });
export const base = () => String(cfg().url || "").replace(/\/+$/, "");
export const publicKey = () => String(cfg().key || "");

export function makeApi(guest) {
  // guest: {gt} once the guest has a pass; null for a member
  async function call(action, body) {
    if (!guest) return Cloud.fn(FN, Object.assign({ action }, body || {}));
    let r;
    try {
      r = await fetch(base() + "/functions/v1/" + FN, { method: "POST", headers: { apikey: publicKey(), "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ action }, guest.gt ? { gt: guest.gt } : {}, body || {})) });
    } catch (e) { throw Object.assign(new Error("FinCom could not be reached. Check the connection and try again."), { kind: "blocked" }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw Object.assign(new Error(j.error || ("Request failed (" + r.status + ")")), { kind: j.kind || "other", status: r.status });
    return j;
  }
  // a file put at the signed address the function gave
  async function put(url, blob) {
    const r = await fetch(url, { method: "PUT", headers: { "Content-Type": blob.type || "application/octet-stream", "x-upsert": "false" }, body: blob });
    if (!r.ok) throw new Error("The file did not go up (" + r.status + ")");
  }
  async function upload(what, blob, extra) {
    const u = await call("upload", Object.assign({ what, size: blob.size, type: blob.type, name: blob.name }, extra || {}));
    await put(u.url, blob);
    return u;
  }
  return { call, upload, put, guest };
}
