/* ================================================================== */
/* The books from both sources: the Day Book and the bridge           */
/* ================================================================== */
// Round 44 (the owner's decision of 11-Oct-2026): TDS, TCS, GSTR-1, GSTR-3B, the amendments and the challans read one
// set of entries made from both ways an entry reaches FinCom:
//   - the Day Book the CA uploads (on this computer, or the day files the cloud keeps from an upload: Books.importDayBook);
//   - the entries the bridge sends by itself, kept in FinCom's cloud copy (tally_vouchers / tally_lines / tally_bills,
//     written by tally-ingest; read here as Look up and the ledger checks already read them, no new database function).
// One entry is one Tally GUID. The later version wins by Tally's AlterID; the same version that came both ways is counted
// once (the Day Book's, which carries more of the entry). An entry the cloud copy marks deleted in Tally leaves the
// books (kept in b.gone, as a Day Book read again keeps it). Cancelled and optional entries keep their marks, so every
// return leaves them out exactly as before. Each entry says where it came from: v.src "bridge", else the Day Book.
const BookSrc = {
  // the fields of the cloud copy's entry read here (deleted_at: migration 32; gstin/pos: 6; ref/cmp_gstin: 11; irn: 57)
  HEADS: "guid,day,alter_id,vtype,vno,party,narration,cancelled,optional,deleted_at,gstin,pos,ref,ref_date,cmp_gstin,irn,irn_ack_date",
  HEADS_OLD: "guid,day,alter_id,vtype,vno,party,narration,cancelled,optional,deleted_at,gstin,pos,ref,ref_date,cmp_gstin",
  // bridge 2.4.2 (round 44 part B, migration 72): each entry's GST type as Tally stores it, read first; a cloud without the
  // columns is read with HEADS, then HEADS_OLD
  HEADS_GST: "guid,day,alter_id,vtype,vno,party,narration,cancelled,optional,deleted_at,gstin,pos,ref,ref_date,cmp_gstin,irn,irn_ack_date,gst_reg_type,gst_country,gst_rcm,gst_nature,gst_taxability,gst_supply,gst_ineligible,gst_mixed,gst_alter_id",
  // the GST kind a bridge before 2.4.2 does not send (its entry has no type in the cloud copy): kept from the Day Book's
  // version of the same entry when such a bridge brings a later one, so an altered SEZ, export or reverse-charge entry
  // stays so. A 2.4.2 entry carries Tally's own type (gstRead): nothing is carried onto it
  CARRY: ["regType", "country", "rcm", "taxability", "nature", "supply", "ineligibleFlag"],
  words(v){ return v && v.src === "bridge" ? "Bridge" : "Day Book"; },
  d8(x){ return String(x || "").replace(/-/g, "").slice(0, 8); },
  alt(x){ const n = Number(x); return isFinite(n) ? n : 0; },
  // true when the cloud copy's version (AlterID a) is to be taken over the one held (have): a new entry, or a later
  // version. A Day Book kept from before its AlterIDs were read (have.alt not known) stays until it is read again
  wins(a, have){
    if (!have) return true;
    if (have.alt == null || have.alt === "") return false;
    return this.alt(a) > this.alt(have.alt);
  },
  index(list){ const m = new Map(); (list || []).forEach((v, i) => { if (v && v.id) m.set(v.id, i); }); return m; },
  // the copy's rows whose lines must be read: entries not in the books, or a later version than the one held
  need(b, heads){
    const by = this.index(b.vouchers), list = b.vouchers || [];
    return (heads || []).filter(h => h && h.guid && !h.deleted_at && this.wins(h.alter_id, by.has(h.guid) ? list[by.get(h.guid)] : null)).map(h => h.guid);
  },
  // the cloud copy's rows as the entries Books.importDayBook makes (the same names, signs and amounts to the paisa)
  fromCopy(heads, lines, bills){
    const L = {}, B = {};
    (lines || []).forEach(l => { if (l && l.guid) (L[l.guid] = L[l.guid] || []).push(l); });
    (bills || []).forEach(x => { if (x && x.guid) (B[x.guid] = B[x.guid] || []).push(x); });
    const out = [];
    (heads || []).forEach(h => {
      if (!h || !h.guid || h.deleted_at) return;
      const v = {id: String(h.guid), date: this.d8(h.day), type: h.vtype || "", no: h.vno || "", ref: h.ref || "", refDate: this.d8(h.ref_date), irn: h.irn || "", irnDate: this.d8(h.irn_ack_date),
        party: h.party || "", gstin: String(h.gstin || "").toUpperCase(), pos: h.pos || "", cmp: String(h.cmp_gstin || "").toUpperCase(), narr: String(h.narration || "").slice(0, 120),
        regType: "", country: "", rcm: false, taxability: "", nature: "", supply: "", ineligibleFlag: false, hsn: [], by: "", upd: "",
        ...this.gstOf(h),
        cancel: h.cancelled === true || h.cancelled === "true", opt: h.optional === true || h.optional === "true", ent: [], alt: this.alt(h.alter_id), src: "bridge"};
      const hs = new Set();
      (L[h.guid] || []).forEach(l => {
        if (!l.ledger) return;
        const x = {l: l.ledger, a: Math.round(Number(l.amount || 0) * 100) / 100, r: null};
        if (l.hsn){ x.h = l.hsn; hs.add(l.hsn); }
        if (l.rate != null && l.rate !== "") x.gr = Number(l.rate);
        v.ent.push(x);
      });
      // bill-wise details on the first line of their ledger: [ref name, New Ref / Agst Ref / Advance / On Account, amount, credit days]
      (B[h.guid] || []).forEach(x => {
        const e = v.ent.find(z => z.l === x.ledger); if (!e || !x.type) return;
        const one = [x.name || "", x.type, Math.round(Number(x.amount || 0) * 100) / 100];
        if (x.credit_days != null && x.credit_days !== "") one.push(Number(x.credit_days));
        (e.b = e.b || []).push(one);
      });
      v.hsn = Array.from(hs);
      // as the Day Book: a cancelled entry has no lines and is kept for the documents issued (GSTR-1 table 13)
      if (v.ent.length || (v.cancel && v.no)) out.push(v);
    });
    return out;
  },
  // bridge 2.4.2: the cloud copy's GST type (migration 72's columns, null when the cloud has none for the entry) as the
  // Day Book's fields of the same names; {} when there is none. Review H1: the type is the entry's own only when it was
  // read at the entry's AlterID (gst_alter_id); read at an older version (a later version came from a bridge before 2.4.2
  // or by number) it is kept aside (gstStale) and used only when no earlier version is held, marked carried. Review M3: a
  // type with no nature and no taxability does not stop the Day Book's kind being carried (gstRead false). Review M2: the
  // entry's GST lines disagree (gstMixed)
  gstOf(h){
    if (!h || ["gst_reg_type", "gst_country", "gst_rcm", "gst_nature", "gst_taxability", "gst_supply", "gst_ineligible"].every(k => h[k] == null)) return {};
    const t = (x) => String(x == null ? "" : x).trim(), yes = (x) => x === true || x === "true";
    const vals = {regType: t(h.gst_reg_type), country: t(h.gst_country), rcm: yes(h.gst_rcm), taxability: t(h.gst_taxability), nature: t(h.gst_nature), supply: t(h.gst_supply),
      ineligibleFlag: yes(h.gst_ineligible)};
    // review round 2 M2: an entry whose GST lines disagree is not placed by one line's kind: its nature and taxability are
    // not taken (the returns place it as before 2.4.2, by its ledgers and tax), and it says so (gstMixed)
    if (yes(h.gst_mixed)){ vals.nature = ""; vals.taxability = ""; }
    if (h.gst_alter_id == null || h.gst_alter_id === "" || this.alt(h.gst_alter_id) !== this.alt(h.alter_id)) return {gstStale: Object.assign(vals, {at: this.alt(h.gst_alter_id), mixed: yes(h.gst_mixed)})};
    // review round 2 M3: Tally's own type stops the Day Book's being carried only when it names the nature (TallyPrime
    // 3.0-6.2 give an item a taxability and no nature, 7.1 neither)
    return Object.assign(vals, {gstMixed: yes(h.gst_mixed), gstRead: !!vals.nature, gstOwn: true});
  },
  // one entry into the books by the rule above; true when the books changed
  put(b, v, by){
    by = by || this.index(b.vouchers);
    const i = by.has(v.id) ? by.get(v.id) : -1, have = i >= 0 ? b.vouchers[i] : null;
    if (!this.wins(v.alt, have)) return false;
    // (also from a bridge version that carried them before: the Day Book's GST kind stays through later alterations)
    // what is carried onto the entry (marked "carried"):
    //  - Tally's own type (read at this version, gstOwn): only the nature and goods/services when Tally left them blank (its
    //    items on 3.0-6.2 carry neither, review round 3 N3); its reverse charge, blocked credit, taxability, registration
    //    type and country are Tally's answer for this version, never an older version's; nothing when the entry's lines
    //    are of two kinds (N4)
    //  - a type read at an older version (gstStale; a later version came from a bridge before 2.4.2 or by number): the
    //    newer of it and the version held is carried (round 2 N2), and a nature still blank from the other (N5)
    //  - no type in the cloud (a bridge before 2.4.2): the version held, as before
    const fill = (from, keys) => { const k = from ? keys.filter(x => from[x] && !v[x]) : []; if (k.length){ v = Object.assign({}, v); k.forEach(x => { v[x] = from[x]; }); v.carried = (v.carried || []).concat(k); } };
    if (v.gstOwn){
      if (!v.gstMixed) fill(have, ["nature", "supply"]);
    } else if (v.gstStale){
      const st = v.gstStale, staleNewer = !have || st.at > this.alt(have.alt);
      fill(staleNewer ? st : have, this.CARRY);
      if (!(staleNewer ? st.mixed : false)) fill(staleNewer ? have : st, ["nature", "supply"]);
    } else if (have){
      fill(have, this.CARRY);
    }
    if (v.gstStale !== undefined){ v = Object.assign({}, v); delete v.gstStale; }
    if (i >= 0) b.vouchers[i] = v; else { by.set(v.id, b.vouchers.length); b.vouchers.push(v); }
    if (b.gone && b.gone[v.id] && !b.gone[v.id].back) b.gone[v.id].back = new Date().toISOString().slice(0, 10);
    return true;
  },
  // the entries the cloud copy marks deleted in Tally leave the books (kept in b.gone, as a Day Book read again does);
  // a later version held (an AlterID above the deleted one's) stays
  drop(b, heads){
    const dead = new Map(); (heads || []).forEach(h => { if (h && h.guid && h.deleted_at) dead.set(String(h.guid), this.alt(h.alter_id)); });
    if (!dead.size) return 0;
    const today = new Date().toISOString().slice(0, 10), who = typeof whoAmI === "function" ? whoAmI() : "";
    let n = 0;
    b.vouchers = (b.vouchers || []).filter(v => {
      if (!v || !dead.has(v.id) || (v.alt != null && v.alt !== "" && this.alt(v.alt) > dead.get(v.id))) return true;
      b.gone = b.gone || {};
      if (!b.gone[v.id] || b.gone[v.id].back) b.gone[v.id] = {v, at: today, by: who, src: "bridge"};
      n++; return false;
    });
    return n;
  },
  // the cloud copy's rows into the books: deleted entries out, new and later ones in; how many changed
  apply(b, heads, lines, bills){
    b.vouchers = b.vouchers || [];
    let n = this.drop(b, heads);
    const by = this.index(b.vouchers);
    this.fromCopy(heads, lines, bills).forEach(v => { if (this.put(b, v, by)) n++; });
    if (n) b.vouchers.sort((a, c) => String(a.date).localeCompare(String(c.date)));
    return n;
  },
  // before the Day Book's months are read again (TallyRead.merge puts in exactly what the files hold), the bridge's
  // entries are taken out, so they are not taken for deleted; then put back by the same rule
  stash(b){
    const keep = (b.vouchers || []).filter(v => v && v.src === "bridge");
    if (keep.length) b.vouchers = b.vouchers.filter(v => !(v && v.src === "bridge"));
    return keep;
  },
  restore(b, keep){
    let n = 0;
    b.vouchers = b.vouchers || [];
    const by = this.index(b.vouchers);
    (keep || []).forEach(v => { if (this.put(b, v, by)) n++; });
    if (n) b.vouchers.sort((a, c) => String(a.date).localeCompare(String(c.date)));
    return n;
  },
  // each ledger's PAN and GSTIN as the cloud's ledger list has them (sent by the bridge with Tally's masters): taken where
  // the books have none, or where the list is newer than the ledger masters read with the books (a PAN corrected in Tally)
  ledgersInto(b, rows, at){
    const newer = !b.ledInfoAt || (at && String(at) > String(b.ledInfoAt));
    let n = 0;
    (rows || []).forEach(l => {
      if (!l || !l.name) return;
      const nm = typeof ledClean === "function" ? ledClean(l.name) : l.name, pan = String(l.pan || "").toUpperCase().trim(), g = String(l.gstin || "").toUpperCase().trim();
      if (pan && /^[A-Z]{5}\d{4}[A-Z]$/.test(pan)){ b.pans = b.pans || {}; if (!b.pans[nm] || (newer && b.pans[nm] !== pan)){ b.pans[nm] = pan; n++; } }
      if (g && g.length === 15){ b.gstins = b.gstins || {}; if (!b.gstins[nm] || (newer && b.gstins[nm] !== g)){ b.gstins[nm] = g; n++; } }
    });
    if (n) b.panIndex = null;
    return n;
  },
  // how many entries came each way (said on the TDS and GST pages)
  counts(b){
    const c = {bridge: 0, daybook: 0};
    ((b && b.vouchers) || []).forEach(v => { if (v && v.src === "bridge") c.bridge++; else c.daybook++; });
    return c;
  }
};
