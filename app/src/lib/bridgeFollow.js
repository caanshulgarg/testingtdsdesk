// The bridge follows the FinCom login using it (the owner, 27-Oct-2026: "it should not matter whose computer is opened..
// it should matter which login there... every login must have their account"). Loaded by TCloud.autoOwn (src/js/49) only
// when this browser's proven bridge has not reported to the signed-in member's firm; its own file, out of legacy.js (at
// its size budget).
// No bridge change (2.4.7): this page already holds the bridge's local key, so it hands the bridge a computer key of the
// signed-in firm with POST /cloudlink, exactly as the first connection does; no code is asked. The bridge then proves to
// tally-ingest it holds both keys (own_key), and the cloud (migration 115, tally_bridge_follow_move) releases the old
// firm's binding and removes the old key when no other bridge uses it (its data kept). Asked of the cloud first
// (tally_bridge_whose): only when the bridge reports to ANOTHER firm, never while a posting is waiting or running on it
// there (tried again next minute), and only for a member who may write (the cloud refuses anyone else).
/* global TCloud, Bridge, S, toast */
export async function follow() {
  const id = (Bridge.cfg() || {}).bridgeId || "";
  if (!/^go-[0-9a-f]{6,32}$/.test(id)) return false;
  let w;
  try { w = await TCloud.rpc("tally_bridge_whose", { p_bridge: id }); } catch (e) { return false; }   // a cloud without migration 115: as before
  if (!w || !w.may || w.mine || !w.elsewhere) return false;
  // a posting waiting or running on it in the other firm: asked again next minute (true: TCloud.auto stops this pass, so its
  // 10-minute pace does not replace the minute; the bridge does not report here yet, so nothing else is left undone)
  if (w.busy) { TCloud.autoAt = Date.now() + 60000; TCloud.followWait = "a posting is waiting or running on this bridge"; return true; }
  // a computer key is made, and handed over, only for a bridge that proved itself in this same step
  if (!(await Bridge.ensureProven())) return false;
  TCloud.autoAt = Date.now() + 30 * 60000;                                   // one key at a time (no pile of keys)
  const st = Bridge.st || {};
  const d = await TCloud.rpc("tally_device_create", { p_name: String([st.computer || "Office computer", st.user || ""].filter(Boolean).join(" · ")).slice(0, 80) });
  let a;
  try { a = await TCloud.rpc("tally_bridge_follow_ask", { p_bridge: id, p_device: d.id }); } catch (e) { a = null; }
  if (!a || !a.ok) {
    try { await TCloud.rpc("tally_device_revoke", { p_id: d.id }); } catch (e) { /* the unused key: removed */ }
    if (a && a.busy) { TCloud.autoAt = Date.now() + 60000; return true; }
    return false;
  }
  await Bridge.call("/cloudlink", { url: TCloud.ingestUrl(), key: d.key }, 60000);
  TCloud.autoAt = Date.now() + 60000;
  TCloud.followWait = "";
  const firm = (S.firm && S.firm.firmName) || "your firm";
  TCloud.followed = { at: Date.now(), firm };
  toast("Tally on this computer now sends to " + firm);
  return true;
}
