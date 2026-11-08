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
  const follow = new Map(), others = new Set(), shared = new Set();
  const me = String(devId) + "|" + String(bridgeId);
  for (const [name, x] of map instanceof Map ? map : new Map(Object.entries(map || {}))) {
    const list = x && Array.isArray(x.serving) ? x.serving.filter((s) => s && s.device && s.bridge) : [];
    if (!x || !x.book || !list.length) continue;
    const keys = new Set(list.map((s) => String(s.device) + "|" + String(s.bridge)));
    if (keys.has(me)) { follow.set(String(x.book), keys); shared.add(name); } else others.add(name);
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
