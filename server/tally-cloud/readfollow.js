// next-link-follow (08-Nov-2026; migration 146, tally_read_follow): reads follow the company. The database decides, for
// each linked book, the ONE bridge of the firm that reads it now (the link's own when it has the company open, else one
// of the same firm that has it open, the link record moved to it and the move recorded). Pure functions here, for the
// beat's answer in index.ts; the database call is there.
//   - a book whose reader is ANOTHER bridge: none of its hand-out (periodDays: Bring books, Bring missing days, Bring
//     another year, check for changes; the ledgers the beat asks for) goes to this bridge, so two bridges never take
//     one book's hand-out at once (the lease still guards each read in the bridge);
//   - a book this bridge reads with fetchOn (its own computer key's switch, or the switch of the key the book moved from
//     on the same computer): its older days are handed out here even when this key's own switch is off;
//   - a book this bridge reads: the held lines of the OTHER bridges of the firm for that book, whose bridge does not
//     serve it now (offline, or the company not open there), are asked of this bridge's Tally again (the bridge asks by
//     MasterID, else type and number; it takes only a company it holds under the same GUID), before any person is asked
//     for a Day Book upload;
//   - no decision (no migration 146, an error, no link, nobody serving, a person's rollback holding the book): as before.

const FREE = new Set(["", "none", "nolink", "held", "changed"]);

// "mine" | "other" | "free" for one decision and this bridge
export function followMine(dec, devId, bridgeId) {
  if (!dec || typeof dec !== "object" || dec.ok === false || FREE.has(String(dec.state || ""))) return "free";
  const r = dec.reader;
  if (!r || typeof r !== "object" || !r.device || !r.bridge) return "free";
  return String(r.device) === String(devId) && String(r.bridge) === String(bridgeId) ? "mine" : "other";
}

// the beat's gate from the decisions {company name: {book, dec}}: skip (names whose reader is another bridge), inherit
// (names this bridge reads with fetchOn), follow ({book: Set of "device|bridge" serving it now}, for the books this
// bridge reads: another bridge's held line is asked here unless its own bridge serves the book)
export function followGate(decs, devId, bridgeId) {
  const skip = new Set(), inherit = new Set(), follow = new Map();
  for (const [name, x] of decs instanceof Map ? decs : new Map(Object.entries(decs || {}))) {
    const dec = x && x.dec, book = x && x.book;
    const m = followMine(dec, devId, bridgeId);
    if (m === "other") { skip.add(name); continue; }
    if (m !== "mine" || !book) continue;
    if (dec.fetchOn === true) inherit.add(name);
    const serving = new Set((Array.isArray(dec.serving) ? dec.serving : []).filter((s) => s && s.device && s.bridge).map((s) => String(s.device) + "|" + String(s.bridge)));
    follow.set(String(book), serving);
  }
  return { skip, inherit, follow };
}

// the beat with only some of its companies (keep(name) true): the same shape, the open lists cut the same way
export function beatOnly(b, keep) {
  if (!b || typeof b !== "object") return b;
  const cut = (xs) => (Array.isArray(xs) ? xs.filter((c) => keep(typeof c === "string" ? c : String((c && c.name) || ""))) : xs);
  return { ...b, companies: cut(b.companies), open: cut(b.open) };
}

// another bridge's held line may be asked of this bridge: its book is one this bridge reads (follow), the line is not
// this bridge's own, and its own bridge does not serve the book now
export function lineFollows(r, follow, devId, bridgeId) {
  if (!r || !(follow instanceof Map)) return false;
  const serving = follow.get(String(r.book_id || ""));
  if (!serving) return false;
  const k = String(r.device_id || "") + "|" + String(r.bridge || "");
  if (String(r.device_id || "") === String(devId) && String(r.bridge || "") === String(bridgeId)) return false;
  return !serving.has(k);
}
