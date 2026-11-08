// next-link-follow (08-Nov-2026; migration 146; the owner: "it should connect to both Tally rather than switching… like
// Tally can be opened by n persons and used simultaneously"): EVERY bridge of the firm that serves a linked book (the
// company open in its own Tally under the link's GUID, the link's data location, reading not stopped, not in test mode;
// tally_read_serving) reads it at the same time, and the work is shared through claims in the database (each day, each
// held line, a book's full ledger list: one bridge at a time). Pure functions here, for the beat's answer in index.ts.
//   - a book served by others but not by this bridge: none of its older days here (its serving bridges share them);
//   - a book nobody serves by these rules (no 146, the link without a GUID, bridges whose records carry no GUIDs yet):
//     as before;
//   - a book this bridge serves: its days by claim (tally_days_claim), and the held lines of OTHER bridges of the firm for
//     it, whose own bridge does not serve it now, by claim too (tally_work_claim, kind held).

// {follow: Map book -> Set of "device|bridge" serving it (the books this bridge serves), others: Set of company names
// served only by other bridges, shared: Set of company names this bridge serves}
export function servingGate(map, devId, bridgeId) {
  // follow.guid: book -> the link's Tally GUID (146's serving list carries it), for followAskable
  const follow = new Map(), others = new Set(), shared = new Set();
  follow.guid = new Map();
  const me = String(devId) + "|" + String(bridgeId);
  for (const [name, x] of map instanceof Map ? map : new Map(Object.entries(map || {}))) {
    const list = x && Array.isArray(x.serving) ? x.serving.filter((s) => s && s.device && s.bridge) : [];
    if (!x || !x.book || !list.length) continue;
    const keys = new Set(list.map((s) => String(s.device) + "|" + String(s.bridge)));
    if (keys.has(me)) {
      follow.set(String(x.book), keys); shared.add(name);
      const g = list.map((s) => String(s.guid || "").trim().toLowerCase()).find(Boolean);
      if (g) follow.guid.set(String(x.book), g);
    } else others.add(name);
  }
  return { follow, others, shared };
}

// the beat with only some of its companies (keep(name) true): the same shape, the open lists cut the same way
export function beatOnly(b, keep) {
  if (!b || typeof b !== "object") return b;
  const cut = (xs) => (Array.isArray(xs) ? xs.filter((c) => keep(typeof c === "string" ? c : String((c && c.name) || ""))) : xs);
  return { ...b, companies: cut(b.companies), open: cut(b.open) };
}

// another bridge's held line may be asked of this bridge: its book is one this bridge serves (follow), the line is not
// this bridge's own, and its own bridge does not serve the book now
export function lineFollows(r, follow, devId, bridgeId) {
  if (!r || !(follow instanceof Map)) return false;
  const serving = follow.get(String(r.book_id || ""));
  if (!serving) return false;
  if (String(r.device_id || "") === String(devId) && String(r.bridge || "") === String(bridgeId)) return false;
  return !serving.has(String(r.device_id || "") + "|" + String(r.bridge || ""));
}

// next-link-follow (review of 314a178f1): another bridge's held line is listed for this bridge only when it would ask Tally
// for it (bridge-go applyHeldLines): the line's company GUID, not empty, the link's (the GUID this bridge serves the book
// under), and a MasterID (1 to 18 digits, above 0) or a voucher type and number. A follow map without GUIDs: never
export function followAskable(r, follow) {
  if (!r || !(follow instanceof Map) || !(follow.guid instanceof Map)) return false;
  const want = follow.guid.get(String(r.book_id || "")), cg = String(r.company_guid || "").trim().toLowerCase();
  if (!want || !cg || cg !== want) return false;
  const mid = String(r.master_id ?? "").replace(/\D/g, "");
  if (mid && mid.length <= 18 && /[1-9]/.test(mid)) return true;
  return String(r.vch_type || "").trim() !== "" && String(r.vch_no || "").trim() !== "";
}
