/* ================================================================== */
/* The GSTR-3B engine: one source for the app and the gst-run function */
/* ================================================================== */
// next-cloud-gst (09-Nov-2026): a month's 3B, worked out from the books, 2B and its matching, the IMS decisions, the
// amendments, the advances, rules 37, 42 and 43, the figures typed and the returns filed, and QRMP, with the credit
// carried from month to month. These are the members of each object that the 3B and its carried credit reach
// (GSTR.threeB, GSTR.creditIn), with the plain helpers they call, and the pieces that make the books from the cloud's
// rows (BookSrc, BookItems.join, Books.mapLedgers, LedMaster.refresh: the ledger list as the app fills it on opening;
// the app's LedMaster.tplFor, the firm's other clients' confirmations, stays in src/js/07, and TDSTally, which only
// names a TDS ledger's section, in src/js/72). Some objects are here whole (GSTAdv, GSTAmend, GSTF, GSTQ, GSTRev,
// GSTSet, ITCT, CustIMS, BookSrc), so their code stays together. The rest of each object (its screens, files and buttons) stays
// in src/js and is put on the same object there (Object.assign(GSTR, {...}) in src/js/12, and so on).
//   - The app: build.py puts this file, without its export line, at the head of the program (SHARED_JS), so every name
//     here is the app's own top-level name, as before.
//   - server/gst-run imports it and runs the same code on the books it loads (gst-run/engine.ts).
// It reads, at the time of a call only: S (S.books, S.coId, S.sales, S.gstYm), CO(), and names.js's namesDecode /
// namesClean / namesKey; the app's perRender, reactScope, IN_RENDER, RENDER_GEN, ITCDec, whoAmI, TDSTally and GSTX when
// they are there (each looked up with typeof). Plain JavaScript with no imports; nothing runs at load but the objects being made.
// No AI here: M2B.aiLinks only reads the pairs the gst-2b-match function already stored for the year.
// GST3B_SRC: this file's and names.js's text (this value left out), hashed (tests/run_gst_cloud.js keeps it so): a 3B the
// cloud worked out carries it, and the 3B page uses the cloud's only when its own is the same (app/src/screens/gst/cloud3b.js)
const GST3B_SRC = "sfdb3973c4d3b0aaf";
function num(v){ if (typeof v === "number") return isFinite(v) ? v : 0; const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
function r2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
const INR = new Intl.NumberFormat("en-IN", {minimumFractionDigits:2, maximumFractionDigits:2});
// One date format everywhere (review item 31): 19-Sep-2026, and 19-Sep-2026 09:32 with the time (24-hour, this computer's time)
const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function toDateObj(d){
  if (d instanceof Date) return d;
  if (typeof d === "number") return new Date(d);
  const t = String(d);
  return /^\d{4}-\d{2}-\d{2}$/.test(t.slice(0, 10)) && t.length <= 10 ? new Date(t + "T00:00:00") : new Date(t);
}
function fmtDate(d){
  if (!d && d !== 0) return "—";
  const dt = toDateObj(d);
  return isNaN(dt) ? String(d).replace(/[^\w \-\/.:]/g, "") : String(dt.getDate()).padStart(2, "0") + "-" + MONTHS3[dt.getMonth()] + "-" + dt.getFullYear();
}
// review of 02-Oct-2026 (trade receivables 11,550 short): Tally's XML can carry a name's line breaks escaped twice
// ("MCS Project Pvt Ltd&amp;#13;&amp;#10;"), which comes out of the reader as "MCS Project Pvt Ltd&#13;&#10;"; a copy
// of the books read before the cloud cleaned its names (migration-23) keeps such names in its balances and groups.
// ledClean: the name as it is kept: entities decoded, line breaks gone (ledNm); other spaces stay, as Tally has them.
// ledKey: the name for matching only: also every run of spaces as one, so "A  B" and "A B&#13;&#10;" meet
// All four are the one rule shared with the cloud reader (server/_shared/names.js, put ahead of this file by build.py)
function ledEnt(s){ return namesDecode(s); }
function ledClean(n){ return namesClean(n); }
function ledKey(n){ return namesKey(n); }
// the group a ledger sits under, and the groups above it: the one place every report looks it up (MIS, Reports, the
// accounts, Audit, Parties). The name is looked up as kept, else by its clean key, so a name with line breaks or
// entities still finds its group (and a group's parent the same way)
const LED_IDX = new WeakMap();
function ledIdx(o){
  if (!o) return null;
  // built again when the names changed (counted at most once a second: paths are asked for many times a run)
  const x = LED_IDX.get(o), t = Date.now();
  if (x && t - x.at < 1000) return x;
  const n = Object.keys(o).length;
  if (x && x.n === n){ x.at = t; return x; }
  const m = new Map(); Object.keys(o).forEach(k => { const kk = ledKey(k); if (kk && (!m.has(kk) || o[k])) m.set(kk, o[k]); });
  const y = {n, m, at: t, seen: new Map()};             // seen: a name already looked up by its key
  LED_IDX.set(o, y);
  return y;
}
function ledLook(o, l){
  if (!o || l == null) return undefined;
  if (o[l] != null) return o[l];
  const x = ledIdx(o);
  if (x.seen.has(l)) return x.seen.get(l);
  const p = x.m.get(ledKey(l)), v = p == null ? undefined : p;
  x.seen.set(l, v);
  return v;
}
function ledUnder(b, l){ return ledLook(b && b.under, l); }
function ledGroupPath(b, l){
  const groups = (b && b.groups) || {}, out = [];
  let p = ledUnder(b, l);
  for (let i = 0; p && i < 15; i++){ if (groups[p] == null && /&|\r|\n/.test(p)) p = ledClean(p); out.push(p); p = ledLook(groups, p) || ""; }
  return out;
}
const STATE_CODES = {"JAMMU AND KASHMIR": "01", "HIMACHAL PRADESH": "02", "PUNJAB": "03", "CHANDIGARH": "04", "UTTARAKHAND": "05", "HARYANA": "06", "DELHI": "07",
  "RAJASTHAN": "08", "UTTAR PRADESH": "09", "BIHAR": "10", "SIKKIM": "11", "ARUNACHAL PRADESH": "12", "NAGALAND": "13", "MANIPUR": "14", "MIZORAM": "15",
  "TRIPURA": "16", "MEGHALAYA": "17", "ASSAM": "18", "WEST BENGAL": "19", "JHARKHAND": "20", "ODISHA": "21", "CHHATTISGARH": "22", "MADHYA PRADESH": "23",
  "GUJARAT": "24", "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "26", "MAHARASHTRA": "27", "KARNATAKA": "29", "GOA": "30", "LAKSHADWEEP": "31",
  "KERALA": "32", "TAMIL NADU": "33", "PUDUCHERRY": "34", "ANDAMAN AND NICOBAR ISLANDS": "35", "TELANGANA": "36", "ANDHRA PRADESH": "37", "LADAKH": "38", "OTHER TERRITORY": "97"};
const NORM_CACHE = new Map(), GRAM_CACHE = new Map();
function normName(s){
  const key = String(s || "");
  let v = NORM_CACHE.get(key);
  if (v !== undefined) return v;
  v = normNameRaw(key);
  if (NORM_CACHE.size > 50000) NORM_CACHE.clear();
  NORM_CACHE.set(key, v);
  return v;
}
function gramsOf(s){
  let g = GRAM_CACHE.get(s);
  if (g) return g;
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++){ const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); }
  g = {m, n: Math.max(0, s.length - 1)};
  if (GRAM_CACHE.size > 50000) GRAM_CACHE.clear();
  GRAM_CACHE.set(s, g);
  return g;
}
function normNameRaw(s){
  return String(s || "").toLowerCase().replace(/\b(m\/s|ms|mr|mrs|shri|sh|smt)\b\.?/g, " ").replace(/\b(private|pvt|limited|ltd|llp|co|company|and|the|india|enterprises?|traders?)\b\.?/g, " ")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function nameSim(a, b){
  a = normName(a).replace(/ /g, ""); b = normName(b).replace(/ /g, "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length > 4 && b.length > 4 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) return 0.9;
  const ga = gramsOf(a), gb = gramsOf(b);
  if (!ga.n || !gb.n) return 0;
  // quick bound: the score cannot exceed this, so skip hopeless pairs
  if (2 * Math.min(ga.n, gb.n) / (ga.n + gb.n) < 0.5) return 0;
  let inter = 0;
  const [small, big] = ga.m.size <= gb.m.size ? [ga.m, gb.m] : [gb.m, ga.m];
  small.forEach((v, k) => { const w = big.get(k); if (w) inter += Math.min(v, w); });
  return 2 * inter / (ga.n + gb.n);
}

// BookItems (src/js/54-live-sync.js)
const BookItems = {
  join(items){
    const m = items.find(x => x.i === "");
    if (!m) return undefined;
    const t = m.d && typeof m.d === "object" && !Array.isArray(m.d) && Object.keys(m.d).length === 1 ? m.d.$t : null;
    if (t === "obj"){ const o = {}; items.forEach(x => { if (x.i[0] === ".") o[x.i.slice(1)] = x.d; }); return o; }
    if (t === "arr" || (Array.isArray(m.d) && !m.d.length && items.some(x => x.i[0] === "#"))) return items.filter(x => x.i[0] === "#").sort((a, c) => (a.o || 0) - (c.o || 0)).map(x => x.d);
    return m.d;
  },
};
// BookSrc (src/js/67-book-sources.js)
const BookSrc = {
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
      // bridge 2.4.3 (migration 73): the TDS settings Tally keeps on the ledger (null: not read yet, left as held)
      if (l.tds_nature != null || l.tds_ldc != null || l.tds_special_rate != null){
        b.ledTds = b.ledTds || {};
        const t = {nature: String(l.tds_nature || "").trim(), special: String(l.tds_special_rate || "").trim(), ldc: Array.isArray(l.tds_ldc) ? l.tds_ldc : []};
        if (JSON.stringify(b.ledTds[nm]) !== JSON.stringify(t)){ b.ledTds[nm] = t; n++; }
      }
    });
    if (n) b.panIndex = null;
    return n;
  },
  // 2.4.3: the TDS details of the version read (tds_tally at the entry's own AlterID); null otherwise
  tdsxOf(h){ return h && h.tds_tally && typeof h.tds_tally === "object" && h.tds_tally_alter_id != null && h.tds_tally_alter_id !== "" && this.alt(h.tds_tally_alter_id) === this.alt(h.alter_id) ? h.tds_tally : null; },
  // the GST kind a bridge before 2.4.2 does not send (its entry has no type in the cloud copy): kept from the Day Book's
  // version of the same entry when such a bridge brings a later one, so an altered SEZ, export or reverse-charge entry
  // stays so. A 2.4.2 entry's own type (gstOwn): only a blank nature and goods/services are carried (put, below)
  CARRY: ["regType", "country", "rcm", "taxability", "nature", "supply", "ineligibleFlag"],
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
      const tx = this.tdsxOf(h); if (tx) v.tdsx = tx;
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
  // Day Book's fields of the same names; {} when there is none. Read at the entry's AlterID (gst_alter_id) it is Tally's
  // own type for this version (gstOwn); read at an older version it is kept aside (gstStale, with that AlterID). What is
  // carried onto the entry from the version held or the older type is decided in put (below). A mixed entry (its GST
  // lines disagree, gstMixed) takes no single nature or taxability
  gstOf(h){
    if (!h || ["gst_reg_type", "gst_country", "gst_rcm", "gst_nature", "gst_taxability", "gst_supply", "gst_ineligible"].every(k => h[k] == null)) return {};
    const t = (x) => String(x == null ? "" : x).trim(), yes = (x) => x === true || x === "true";
    const vals = {regType: t(h.gst_reg_type), country: t(h.gst_country), rcm: yes(h.gst_rcm), taxability: t(h.gst_taxability), nature: t(h.gst_nature), supply: t(h.gst_supply),
      ineligibleFlag: yes(h.gst_ineligible)};
    // review round 2 M2: an entry whose GST lines disagree is not placed by one line's kind: its nature and taxability are
    // not taken (the returns place it as before 2.4.2, by its ledgers and tax), and it says so (gstMixed)
    if (yes(h.gst_mixed)){ vals.nature = ""; vals.taxability = ""; }
    if (h.gst_alter_id == null || h.gst_alter_id === "" || this.alt(h.gst_alter_id) !== this.alt(h.alter_id)) return {gstStale: Object.assign(vals, {at: this.alt(h.gst_alter_id), mixed: yes(h.gst_mixed)})};
    return Object.assign(vals, {gstMixed: yes(h.gst_mixed), gstOwn: true});
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
  // the cloud copy's rows into the books: deleted entries out, new and later ones in; how many changed. made: the
  // entries fromCopy made of these rows before (gst-run keeps them for a large book, migration 160), else made here
  apply(b, heads, lines, bills, made){
    b.vouchers = b.vouchers || [];
    let n = this.drop(b, heads);
    const by = this.index(b.vouchers);
    (made || this.fromCopy(heads, lines, bills)).forEach(v => { if (this.put(b, v, by)) n++; });
    // 2.4.3: the TDS details of an entry held at the same version (a Day Book's, read the same way by the cloud) are added to it
    (heads || []).forEach(h => { const tx = this.tdsxOf(h); if (!tx || !h || !by.has(h.guid)) return; const v = b.vouchers[by.get(h.guid)]; if (v && !v.tdsx && this.alt(v.alt) === this.alt(h.alter_id)){ v.tdsx = tx; n++; } });
    // (an entry changed in place: the books get a new array, so the save writes the entries again: Books.touch, src/js/04)
    if (n) b.vouchers = b.vouchers.slice().sort((a, c) => String(a.date).localeCompare(String(c.date)));
    return n;
  },
  // the fields of the cloud copy's entry read here (deleted_at: migration 32; gstin/pos: 6; ref/cmp_gstin: 11; irn: 57)
  HEADS: "guid,day,alter_id,vtype,vno,party,narration,cancelled,optional,deleted_at,gstin,pos,ref,ref_date,cmp_gstin,irn,irn_ack_date",
  HEADS_OLD: "guid,day,alter_id,vtype,vno,party,narration,cancelled,optional,deleted_at,gstin,pos,ref,ref_date,cmp_gstin",
  // bridge 2.4.2 (round 44 part B, migration 72): each entry's GST type as Tally stores it, read first; a cloud without the
  // columns is read with HEADS, then HEADS_OLD
  HEADS_GST: "guid,day,alter_id,vtype,vno,party,narration,cancelled,optional,deleted_at,gstin,pos,ref,ref_date,cmp_gstin,irn,irn_ack_date,gst_reg_type,gst_country,gst_rcm,gst_nature,gst_taxability,gst_supply,gst_ineligible,gst_mixed,gst_alter_id",
  // bridge 2.4.3 (migration 73): a TDS payment's challan and the TDS references as Tally keeps them (TDSTally, src/js/72),
  // read first; a cloud without the columns is read with HEADS_GST and the rest
  HEADS_TDS: "guid,day,alter_id,vtype,vno,party,narration,cancelled,optional,deleted_at,gstin,pos,ref,ref_date,cmp_gstin,irn,irn_ack_date,gst_reg_type,gst_country,gst_rcm,gst_nature,gst_taxability,gst_supply,gst_ineligible,gst_mixed,gst_alter_id,tds_tally,tds_tally_alter_id",
  words(v){ return v && v.src === "bridge" ? "Bridge" : "Day Book"; },
  // the copy's rows whose lines must be read: entries not in the books, or a later version than the one held
  need(b, heads){
    const by = this.index(b.vouchers), list = b.vouchers || [];
    return (heads || []).filter(h => h && h.guid && !h.deleted_at && this.wins(h.alter_id, by.has(h.guid) ? list[by.get(h.guid)] : null)).map(h => h.guid);
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
  // how many entries came each way (said on the TDS and GST pages)
  counts(b){
    const c = {bridge: 0, daybook: 0};
    ((b && b.vouchers) || []).forEach(v => { if (v && v.src === "bridge") c.bridge++; else c.daybook++; });
    return c;
  },
};
// Books (src/js/04-the-client-s-books-read-from-tally.js)
const Books = {
  // what each ledger is: TDS section, GST tax, party or expense
  mapLedgers(vouchers, saved){
    const seen = new Map();
    vouchers.forEach(v => v.ent.forEach(e => seen.set(e.l, (seen.get(e.l) || 0) + 1)));
    const map = {};
    seen.forEach((n, name) => {
      const keep = (saved || {})[name];
      if (keep && keep.byHand){ map[name] = Object.assign({n}, keep); return; }
      // next-gst-b2cs-summary: the party ledger's "Consolidated B2C" switch (FinCom's own, b2cSum) is kept with the guess
      map[name] = Object.assign({n}, this.guess(name), keep && keep.byHand ? keep : {}, keep && keep.b2cSum ? {b2cSum: keep.b2cSum} : {});
    });
    // FinCom 2.4.1 (Cause A, 01-Oct-2026: 17 confirms wiped on one refresh): a ledger a person confirmed or set by hand
    // that no entry uses (yet) is kept, with n:0. It was dropped here, LedMaster.refresh put it back as a guess, and the
    // save wiped the confirm. No figure moves: no entry uses it
    Object.keys(saved || {}).forEach(name => {
      const keep = saved[name];
      if (!seen.has(name) && keep && (keep.byHand || keep.ok || keep.b2cSum)) map[name] = Object.assign({}, keep, {n: 0});
    });
    return map;
  },
  // the TDS or TCS section in a ledger's name: "194C", "206C1H"; and (2.4.1) the letter after a space, "TDS 194 T" is
  // 194T, not 194 - but not the A of "194 A/C", nor a word ("194 TDS PAYABLE" is 194)
  // Review H4 of next-241: after a space or a dash only a REAL section suffix counts ("TDS 192 ON SALARY" is 192, not
  // 192ON; "195 TO", "194 OF" likewise; "194 Commission" 194); written on (194C, 194LBA) any letters as before. The owner's
  // ruling of 09-Oct-2026, "TDS 194 C = 194C", covers the dash form too: "TDS 194-C" and "TDS 194 - C" are 194C (194 is
  // dividends), as the ledger check (LedCheck.section) reads them, so the guess and the check agree
  SEC_SUF: "LBA|LBB|LBC|BA|BB|DA|EE|IA|IB|IC|LA|LB|LC|LD|A|B|C|D|E|G|H|I|J|K|M|N|O|P|Q|R|S|T",
  secIn(u){
    const m = String(u || "").toUpperCase().match(new RegExp("\\b(19[2-9])(?:([A-Z]{1,3})\\b|\\s*-?\\s*(" + this.SEC_SUF + ")(?![\\w\\/])|\\b)|\\b(206C)([A-Z]{0,2})\\b"));
    return !m ? "" : m[4] ? m[4] + (m[5] || "") : m[1] + (m[2] || m[3] || "");
  },
  guess(name){
    const u = name.toUpperCase();
    const sec = this.secIn(u);
    if (/TDS|TCS/.test(u) && sec){
      const rate = (u.match(/(\d+(?:\.\d+)?)\s*%/) || [])[1];
      return {kind: /RECEIVABLE/.test(u) ? "tds_receivable" : "tds_payable", section: sec, rate: rate ? num(rate) : null};
    }
    // round 92 (C): a TDS ledger for salary with no section in its name ("TDS on Salary", "Salary TDS", "Income Tax (Salary)")
    if (/SALAR/.test(u) && /\bTDS\b|INCOME[\s-]*TAX/.test(u) && !/RECEIVABLE|EXPENSE|INTEREST|ADVANCE/.test(u)) return {kind: "tds_payable", section: "192", rate: null};
    const gst = u.match(/\b(\d{2})?\s*(CGST|SGST|UTGST|IGST|CESS)\s*(INPUT|OUTPUT)?\b/);
    if (gst && /INPUT|OUTPUT/.test(u)) return {kind: "gst", reg: gst[1] || "", tax: gst[2] === "UTGST" ? "SGST" : gst[2], side: gst[3] === "INPUT" ? "input" : "output"};
    if (/\bROUND\s*(ED)?\s*OFF\b/.test(u)) return {kind: "roundoff"};
    if (/BANK|CASH\b/.test(u)) return {kind: "bank"};
    return {kind: ""};
  },
  ledgerOf(name){
    const b = S.books, m = (b && b.map && b.map[name]) || {};
    // the owner's decision on H1 (09-Oct-2026, "Keep today's figures"): the books' own ledger map counts as in 2.3.3,
    // whether or not the ledger check is saved or its switch set; the check's suggestions are kept apart (b.ledCheck) and
    // count in no figure until confirmed, which writes them into the map (src/js/57)
    return m;
  },
  // the purchase and sales side of a voucher, ready for GST and TDS
  // build 193: an entry's lines are worked out once per drawing or calculation (the same entry is asked many times)
  lines(v){
    // next-fix-books-crash: a render React schedules by itself is a drawing too (reactScope, src/js/01)
    if (typeof reactScope === "function") reactScope();
    if (typeof IN_RENDER === "undefined" || !IN_RENDER) return this.linesNow(v);
    // a job behind the page (app/src/lib/behind.jsx): the lines kept for the job's steps
    const c = typeof JOB_MEMO !== "undefined" && JOB_MEMO ? perRender(this, "\u0001lc", () => ({map: new WeakMap()})) : this._lc && this._lc.gen === RENDER_GEN && this._lc.books === S.books ? this._lc : (this._lc = {gen: RENDER_GEN, books: S.books, map: new WeakMap()});
    let r = c.map.get(v); if (!r){ r = this.linesNow(v); c.map.set(v, r); }
    return r;
  },
  // the party's line(s) of an entry: the receivable on a sale, the payable on a bill. The owner's reconciliation of
  // 22-Oct-2026 (a client's GSTR-1 at 20.52 crore against 8.64 crore filed): Tally keeps the buyer's name (the voucher's
  // party) apart from the ledger debited ("The Oriental Insurance Co Ltd CG" on the invoice, "The Oriental Insurance
  // Company Limited-CG" the ledger), so the party line is known by its place, not by that name alone: the ledger named as
  // the party, and any other line on the party's side (opposite the tax; with no tax, a sale's debit or a bill's credit)
  // whose ledger sits under Sundry Debtors or Sundry Creditors, or that carries the bill-wise allocation. Never a tax,
  // TDS, bank or round-off line.
  partyEnts(v){
    const ent = v.ent || [], k = e => this.ledgerOf(e.l).kind, nm = ent.find(e => e.l === v.party);
    let tax = 0;
    ent.forEach(e => { if (/^(gst|gst_common|ineligible)$/.test(k(e))) tax += e.a; });
    // the party's side: -1 debited, 1 credited
    const side = Math.abs(tax) > 0.004 ? -Math.sign(tax) : nm ? (nm.a < 0 ? -1 : 1)
      : /CREDIT NOTE/i.test(v.type) ? 1 : /DEBIT NOTE/i.test(v.type) ? -1 : this.isSale(v) ? -1 : this.isPurchase(v) ? 1 : 0;
    return ent.filter(e => e.l === v.party || (side && Math.sign(e.a) === side && !k(e) && this.sundry(e)));
  },
  // a party's line by its place: its ledger under Sundry Debtors or Sundry Creditors, or a bill-wise allocation on it
  // (partyEnts; TDS.led, src/js/09)
  sundry(e){ return (e.b && e.b.length) || ledGroupPath(S.books || {}, e.l).some(g => /^\s*sundry\s+(debtors|creditors)\s*$/i.test(g)); },
  linesNow(v){
    const out = {taxable: 0, tax: {CGST: 0, SGST: 0, IGST: 0, CESS: 0}, tds: [], tdsPaid: [], tcs: [], tcsPaid: [], party: 0, rates: {}, roundoff: 0}, vals = [];
    const pe = new Set(this.partyEnts(v));
    v.ent.forEach(e => {
      const m = Books.ledgerOf(e.l), amt = Math.abs(e.a), sign = e.a < 0 ? -1 : 1;
      if (m.kind === "ineligible"){ out.ineligible = r2((out.ineligible || 0) + amt); out.taxable = r2(out.taxable + amt); return; }
      // the reverse-charge liability credited beside the input tax is what we owe, not tax on the bill
      if (m.kind === "gst" && m.rcm && m.side === "output"){ out.rcmOwed = r2((out.rcmOwed || 0) + amt); return; }
      if (m.kind === "gst" || m.kind === "gst_common"){
        // one ledger for CGST and SGST together (a "RCM Payable" of both): half each
        const heads = m.tax === "CGST+SGST" ? [["CGST", amt / 2], ["SGST", amt / 2]] : [[m.tax, amt]];
        heads.forEach(([h, a]) => { out.tax[h] = r2((out.tax[h] || 0) + a); });
        if (m.kind === "gst_common"){ out.common = out.common || {CGST: 0, SGST: 0, IGST: 0, CESS: 0}; heads.forEach(([h, a]) => { out.common[h] = r2((out.common[h] || 0) + a); }); }
        return;
      }
      if (m.kind === "tds_clearing"){
        if (e.a < 0 && v.ent.some(z => Books.ledgerOf(z.l).kind === "bank")) out.tdsPaid.push({ledger: e.l, section: "", amount: amt});   // paid from the bank
        return;
      }
      // the TDS check of 22-Oct-2026, H5: a pay head marked "Not TDS" (payTds false) is none, unless its name says TDS or
      // income tax (Leads' "TDS 192B" stays the salary TDS; its "ESIC Employee Contribution" does not)
      if (m.kind === "tds_payable" && !(m.payTds === false && !/\bTDS\b|INCOME[\s-]*TAX/i.test(e.l))){
        // the month-end move of each section's TDS into a clearing account is neither a deduction nor a payment
        if (e.a < 0 && v.ent.some(z => Books.ledgerOf(z.l).kind === "tds_clearing" && z.a > 0)) return;
        if (e.a > 0) out.tds.push({ledger: e.l, section: m.section, rate: m.rate, amount: amt});   // credited: tax deducted
        // debited without the bank: an adjustment, not a payment; against a party's or an expense's credit, the deduction
        // undone (H4: TDS.unDo)
        else if (!v.ent.some(z => Books.ledgerOf(z.l).kind === "bank")){ if (v.ent.some(z => z.a > 0 && !Books.ledgerOf(z.l).kind)) (out.tdsBack = out.tdsBack || []).push({ledger: e.l, section: m.section, amount: amt}); }
        else out.tdsPaid.push({ledger: e.l, section: m.section, amount: amt});                      // debited: tax paid over
        return;
      }
      if (m.kind === "roundoff"){ out.roundoff = r2(out.roundoff + e.a); return; }
      // TCS collected on a sale (credited), or paid over from the bank (debited): for 27EQ; neither is part of the sale's value
      if (m.kind === "tcs_payable"){
        if (e.a > 0) out.tcs.push({ledger: e.l, section: m.section, rate: m.rate, amount: amt});
        else if (v.ent.some(z => Books.ledgerOf(z.l).kind === "bank")) out.tcsPaid.push({ledger: e.l, section: m.section, amount: amt});
        return;
      }
      if (m.kind === "tax_other" || m.kind === "tcs_receivable") return;
      if (pe.has(e)){ out.party = r2(out.party + amt); return; }
      if (m.kind === "bank" || m.kind === "tds_receivable") return;
      out.taxable = r2(out.taxable + amt);
      if (e.r){ const key = String(r2(e.r * 2)); out.rates[key] = r2((out.rates[key] || 0) + amt); }
      vals.push({amt, h: e.h || "", gr: e.gr, sp: e.sp || "", hd: e.hd || "", q: num(e.q), u: e.u || ""});
    });
    out.total = r2(out.taxable + out.tax.CGST + out.tax.SGST + out.tax.IGST + out.tax.CESS + out.roundoff);
    out.parts = this.parts(vals, out, v);
    return out;
  },
  GST_RATES: [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40],
  // the nearest GST rate, when a worked-out rate is within a rounding of it
  snapRate(r){ const n = this.GST_RATES.reduce((a, c) => Math.abs(c - r) < Math.abs(a - r) ? c : a, 0); return Math.abs(n - r) <= 0.05 ? n : r; },
  // the value and tax of a voucher, rate by rate and HSN by HSN: from each item's rate where Tally has it,
  // with the tax on the voucher shared out in proportion, so the parts always add up to the voucher
  parts(vals, L, v){
    const heads = ["IGST", "CGST", "SGST", "CESS"], taxAll = r2(heads.reduce((a, h) => a + L.tax[h], 0));
    const g = {};
    vals.forEach(x => { const k = (x.gr == null ? "?" : x.gr) + "|" + x.h; const q = g[k] = g[k] || {gr: x.gr, hsn: x.h, supply: x.sp, desc: x.hd, qty: 0, unit: x.u, taxable: 0};
      q.taxable = r2(q.taxable + x.amt); q.qty = r2(q.qty + x.q); if (!q.supply) q.supply = x.sp; if (!q.desc) q.desc = x.hd; if (!q.unit) q.unit = x.u; });
    let list = Object.values(g);
    const vh = (v && v.hsn || [])[0] || "", vs = (v && v.supply) || "";
    if (!list.length) list = [{gr: null, hsn: vh, supply: vs, taxable: 0}];
    list.forEach(q => { if (!q.hsn) q.hsn = vh; if (!q.supply) q.supply = vs; });
    // lines with no rate take whatever tax the rated lines do not explain
    const known = list.filter(q => q.gr != null), unknown = list.filter(q => q.gr == null);
    const expKnown = r2(known.reduce((a, q) => a + q.taxable * q.gr / 100, 0));
    const unkTaxable = r2(unknown.reduce((a, q) => a + q.taxable, 0));
    const unkTax = Math.max(0, r2(taxAll - expKnown - num(L.tax.CESS)));
    const unkRate = unkTaxable ? this.snapRate(Math.round(unkTax / unkTaxable * 10000) / 100) : (known.length ? 0 : (L.taxable ? this.snapRate(Math.round(r2(taxAll - L.tax.CESS) / L.taxable * 10000) / 100) : 0));
    unknown.forEach(q => { q.gr = unkRate; q.guessed = true; });
    // one line per rate and HSN, the voucher's tax shared by what each should carry
    const m = {};
    list.forEach(q => { const k = q.gr + "|" + q.hsn; const x = m[k] = m[k] || {rate: q.gr, hsn: q.hsn, supply: q.supply, desc: q.desc || "", qty: 0, unit: q.unit || "", taxable: 0, guessed: !!q.guessed};
      x.taxable = r2(x.taxable + q.taxable); x.qty = r2(x.qty + num(q.qty)); if (!x.desc) x.desc = q.desc || ""; if (!x.unit) x.unit = q.unit || ""; });
    const out = Object.values(m).sort((a, c) => c.taxable - a.taxable);
    const w = out.map(x => x.taxable * x.rate), ws = w.reduce((a, c) => a + c, 0), ts = out.reduce((a, x) => a + x.taxable, 0);
    heads.forEach(h => {
      const k = h === "IGST" ? "igst" : h === "CGST" ? "cgst" : h === "SGST" ? "sgst" : "cess";
      let left = L.tax[h];
      out.forEach((x, i) => { const share = i === out.length - 1 ? left : r2(L.tax[h] * (h === "CESS" || !ws ? (ts ? x.taxable / ts : 1 / out.length) : w[i] / ws)); x[k] = share; left = r2(left - share); });
    });
    return out;
  },
  // what part of the return a voucher belongs to
  supplyClass(v){
    const country = String(v.country || "").toLowerCase();
    const exportish = /EXPORT/i.test(v.type) || (country && country !== "india");
    if (exportish) return "export";
    if (/SEZ/i.test(v.type) || /SEZ/i.test(v.regType || "") || /SEZ/i.test(v.nature || "")) return "sez";
    if (/exempt/i.test(v.taxability || "")) return "exempt";
    if (/nil/i.test(v.taxability || "")) return "nil";
    if (/non.?gst/i.test(v.taxability || "")) return "nongst";
    return "taxable";
  },
  // reverse charge: marked so in Tally, or the tax on the bill credited to a reverse-charge payable ledger
  isRcm(v){
    if (v.rcm) return true;
    // a reverse-charge ledger on the voucher: the payable credited, or a reverse-charge input debited
    return v.ent.some(e => { const m = this.ledgerOf(e.l); return m.kind === "gst" && m.rcm && (m.side === "output" ? e.a > 0.004 : e.a < -0.004); });
  },
  isImport(v){ const c = String(v.country || "").toLowerCase(); return !!c && c !== "india"; },
  // orders and stock movements carry no accounts; they are never purchases or sales
  NONACC: /ORDER|DELIVERY NOTE|RECEIPT NOTE|REJECTION|STOCK JOURNAL|PHYSICAL STOCK|MATERIAL (IN|OUT)|MEMO/i,
  groupPath(l){ return ledGroupPath(S.books || {}, l); },
  // a voucher type with its own name ("GST INWARD", "LOCAL", "IMPORT") is known by what it does:
  // it debits a ledger under Purchase Accounts, or credits one under Sales Accounts
  byContent(v, re, debit){
    if (/JOURNAL|PAYMENT|RECEIPT|CONTRA/i.test(v.type)) return false;
    return v.ent.some(e => (debit ? e.a < 0 : e.a > 0) && (this.groupPath(e.l).some(g => re.test(g)) || (!this.groupPath(e.l).length && (debit ? /PURCHASE/i : /\bSALES?\b/i).test(e.l))));
  },
  // round 43 (the TDS and GST proof on a real TallyPrime 7.1): a debit note raised on a CUSTOMER (more value on an invoice:
  // the customer debited, a sales ledger and output tax credited) is an outward note (GSTR-1 9B, ntty D; 3B 3.1(a)), not a
  // purchase that takes input tax away. Known by what it credits: a sales ledger, and no purchase ledger
  saleNote(v){ return /DEBIT NOTE/i.test(v.type) && this.byContent(v, /^sales accounts$/i, false) && !this.byContent(v, /^purchase accounts$/i, false); },
  isPurchase(v){
    if (this.NONACC.test(v.type)) return false;
    if (this.saleNote(v)) return false;
    if (/PUR|PURCHASE/i.test(v.type) || /DEBIT NOTE/i.test(v.type)) return true;
    if (/SALE|SALES|CREDIT NOTE|EXPORT/i.test(v.type)) return false;
    return this.byContent(v, /^purchase accounts$/i, true);
  },
  invInNarr(t){
    const s = String(t || "");
    const m = s.match(/\b(?:inv(?:oice)?|bill)\s*(?:no\.?|number|num|#)?\s*[:.\-#]?\s*([A-Z0-9][A-Z0-9\/\-_.]{0,29}\d[A-Z0-9\/\-_.]*)/i)
      || s.match(/\b([A-Z]{1,8}[\/\-][A-Z0-9\/\-]{1,25}\d)\b/i);
    return m ? m[1].replace(/[.\-\/]+$/, "") : "";
  },
  supInv(v, how){
    how = how || ((typeof CO === "function" && CO()) || {}).supInvFrom || "ref";
    const ref = String(v.ref || "").trim(), no = String(v.no || "").trim(), nr = () => this.invInNarr(v.narr);
    if (how === "vno") return no || ref || nr();
    if (how === "narr") return nr() || ref || no;
    return ref || no || nr();
  },
  isSale(v){
    if (this.NONACC.test(v.type)) return false;
    if (/SALE|SALES|CREDIT NOTE|EXPORT/i.test(v.type) || this.saleNote(v)) return true;
    if (/PUR|PURCHASE|DEBIT NOTE/i.test(v.type)) return false;
    return this.byContent(v, /^sales accounts$/i, false);
  },
};
// CustIMS (src/js/33-customer-ims.js)
const CustIMS = {
  store(reg){ const b = S.books; b.outRej = b.outRej || {}; return b.outRej[reg || ""] = b.outRej[reg || ""] || {}; },
  // documents the customer can act on in IMS: invoices and notes to registered customers
  // (next-gst-big: once a drawing; a quarter's 3B asked it for each of its months, the book's every sale each time)
  docs(reg){ const f = () => GSTR.outward(null, reg).filter(r => r.gstin && (r.kind === "B2B" || r.kind === "CDNR" || r.kind === "DBNR" || (r.kind === "EXP" && r.cls === "sez")));
    return typeof perRender === "function" ? perRender(this, "docs|" + (reg || ""), f) : f(); },
  items(reg){
    const st = this.store(reg), byId = new Map(this.docs(reg).map(r => [r.id, r]));
    return Object.keys(st).map(id => { const s = st[id], r = byId.get(id);
      const tax = r ? {igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess || 0, taxable: r.taxable} : {igst: 0, cgst: 0, sgst: 0, cess: 0, taxable: 0};
      const open = s.kind === "cn" ? s.act !== "accepted" : s.act !== "done";
      return Object.assign({id, gone: !r}, s, tax, {tax: r2(tax.igst + tax.cgst + tax.sgst + tax.cess), open}); })
      .sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // 3.1(a) for a month: rejected credit notes added back, and taken out again in the month the customer accepts them
  month(ym, reg){
    const add = {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}, back = {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []};
    const put = (o, x) => { ["taxable", "igst", "cgst", "sgst", "cess"].forEach(k => { o[k] = r2(o[k] + num(x[k])); }); o.n++; o.list.push(x); };
    if (!S.books || !S.books.outRej) return {add, back};
    this.items(reg).filter(x => x.kind === "cn" && !x.gone).forEach(x => { if (x.addYm === ym) put(add, x); if (x.act === "accepted" && x.doneYm === ym) put(back, x); });
    return {add, back};
  },
  ACTS: {
    inv: [["ask", "Invoice is right: ask the customer to accept it, or send it again by amendment"], ["amend", "Details wrong: correct it in Tally, it goes as an amendment"], ["cancel", "Not a supply: issue a credit note"], ["done", "Settled"]],
    cn: [["rejected", "Rejected: its tax is added back to 3.1(a)"], ["accepted", "Customer accepted it later"]]
  },
  nextYm(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 12 ? (y + 1) + "01" : y + String(m + 1).padStart(2, "0"); },
  find(reg, q){ const n = GST2B.normNo(q); if (!n) return []; return this.docs(reg).filter(r => GST2B.normNo(r.no) === n || GST2B.normNo(r.no).endsWith(n)).slice(0, 12); },
  add(reg, id){
    const r = this.docs(reg).find(z => z.id === id); if (!r) return null;
    const st = this.store(reg); if (st[id]) return st[id];
    const ym = GSTR.ym(r.date), today = ITCT.today(), rejYm = today.slice(0, 7).replace("-", "") > ym ? today.slice(0, 7).replace("-", "") : ym;
    return st[id] = {kind: r.kind === "CDNR" ? "cn" : "inv", no: r.no, date: r.date, party: r.party, gstin: r.gstin, rejYm, addYm: this.nextYm(rejYm), act: r.kind === "CDNR" ? "rejected" : "ask", remark: "", doneYm: "", at: today};
  },
  letter(reg, gstin, party, list){
    const co = CO() || {}, g = (GSTR.gstins(S.books) || []).find(z => z.slice(0, 2) === reg) || reg, m = v => "\u20b9" + INR.format(r2(v));
    let t = "Dear Sir/Madam,\n\nThe following documents issued by " + (co.name || "us") + " (GSTIN " + g + ") to " + party + " (GSTIN " + gstin + ") are shown as rejected in your Invoice Management System:\n\n";
    t += list.map((x, i) => "   " + (i + 1) + ". " + (x.kind === "cn" ? "Credit note " : "Invoice ") + x.no + " dated " + GSTAmend.dmy(x.date) + ", taxable " + m(x.taxable) + ", tax " + m(x.tax) + (x.remark ? " (your remark: " + x.remark + ")" : "")).join("\n");
    t += "\n\nWe have checked them against our books and they are correct. Please accept them in IMS before you file GSTR-3B; if your return for that month is already filed, please let us know and we will report them again so that they come back to your IMS.\n\nRegards,\n" + (co.name || "");
    return t;
  },
  customers(reg){
    const m = {};
    this.items(reg).filter(x => x.open && ((x.kind === "inv" && x.act === "ask") || (x.kind === "cn" && x.act === "rejected"))).forEach(x => { const k = x.gstin; (m[k] = m[k] || {gstin: x.gstin, party: x.party, items: []}).items.push(x); });
    return Object.values(m).map(c => { const k = GSTSet.contact(c.gstin, c.party); return Object.assign(c, {email: k.email, phone: k.phone, tax: r2(c.items.reduce((a, x) => a + x.tax, 0))}); });
  },
};
// GST2B (src/js/11-section.js)
const GST2B = {
  normNo(s){ return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); },
  // the same number written differently: "INV/2024-25/0012", "INV-12/24-25", "12"
  coreNo(s){
    let t = String(s || "").toUpperCase().replace(/\b(FY)?\s*20\d{2}\s*[-/]\s*(20)?\d{2}\b/g, " ").replace(/\b\d{2}\s*[-/]\s*\d{2}\b(?=\D*$|\D)/g, " ");
    const digits = (t.match(/\d+/g) || []).map(d => String(num(d)));
    const letters = t.replace(/[^A-Z]/g, "").replace(/^(INV|INVOICE|BILL|TAX|GST|NO|SI|CN|DN)+/, "");
    return letters + "|" + digits.join("-");
  },
  lastDigits(s){ const d = String(s || "").match(/\d+/g); return d ? String(num(d[d.length - 1])) : ""; },
  // every document in Tally that carries input tax: purchases, and expenses booked in journals or payments
  bookDocs(){
    const b = S.books;
    if (!b || !b.vouchers) return [];
    const regs = (GSTR.gstins(b) || []).map(g => g.slice(0, 2)), gst = b.gstins || {};
    const out = [];
    this.skipped = {setOff: 0, taxOnly: 0};
    b.vouchers.forEach(v => {
      if (Books.isSale(v) || v.opt) return;                                   // an Optional entry is no document
      const tax = {IGST: 0, CGST: 0, SGST: 0, CESS: 0};
      let signed = 0, reg = "", inel = 0, any = false, setOff = false, hold = 0, claim = 0, bare = true;
      v.ent.forEach(e => {
        const m = Books.ledgerOf(e.l);
        if ((m.kind === "gst" || m.kind === "gst_common") && m.side === "output" && !m.rcm) setOff = true;
        if (m.kind === "tax_other" && m.what === "gst_setoff") setOff = true;
        if (m.kind === "gst" && m.rcm && m.side === "output") return;
        if (!((m.kind === "gst" || m.kind === "gst_common") && m.side === "input") && m.kind !== "ineligible"){ if (m.kind !== "roundoff") bare = false; return; }
        any = true; if (GSTR.held(e.l)) hold++; else claim++;
        const amt = Math.abs(e.a), t = m.tax || "IGST";
        tax[t] = r2(tax[t] + amt); signed += e.a;
        if (m.kind === "ineligible") inel = r2(inel + amt);
        if (m.reg && !reg) reg = m.reg;
      });
      if (!any) return;
      // the month's set-off of output tax against credit is not a purchase
      if (setOff){ this.skipped.setOff++; return; }
      // 3B input check (23-Oct-2026): credit moved from the held ledger ("NOT SHOWN IN 2B", GSTR.held) to the input ledger,
      // or input lines only (a rounding): no document
      // (and the held ledger credited alone: its credit written off, not a supplier's note)
      if (bare || (hold && claim) || (hold && signed > 0)){ this.skipped.taxOnly++; return; }
      // the supplier: the voucher's party, else the one ledger in it that carries a GSTIN
      let party = v.party, gstin = String(v.gstin || gst[v.party] || "").toUpperCase();
      if (!gstin){ const e = v.ent.find(x => gst[x.l]); if (e){ party = e.l; gstin = String(gst[e.l]).toUpperCase(); } }
      if (!party || Books.ledgerOf(party).kind === "bank"){ const e = v.ent.find(x => (x.a < 0) !== (signed < 0) && !Books.ledgerOf(x.l).kind); if (e) party = e.l; }
      // the value: what sits on the same side as the tax, other than tax, TDS, bank and the supplier
      let taxable = 0;
      v.ent.forEach(e => { if (e.l !== party && !Books.ledgerOf(e.l).kind && (e.a < 0) === (signed < 0)) taxable = r2(taxable + Math.abs(e.a)); });
      // tax alone, with no supplier's GSTIN and no value beside it: a rounding or reversal entry
      if (!taxable && !gstin){ this.skipped.taxOnly++; return; }
      // next-itc-simple (Leads, 24-Oct-2026: JMD's ticket 36,630 booked with its fee, tax 180): the value is what carries GST.
      // Far more value than the tax at any rate: the GST rate is worked out from what is known, never assumed (the owner:
      // "we have the tax rate — if charged 5% then no ITC, if charged 18% then full ITC"): Tally's rate on the lines (their
      // value is the value), else the rate in a tax ledger's name ("Input IGST 18%", "Input CGST 9%" is 18), else the rate
      // in the narration ("@ 18%"); the value is then the tax at that rate, the rest kept apart (other). No rate anywhere:
      // ru (rate unknown), for 2B's own rate to settle (GST2B.run, ITCF) or to be looked at. At 5% (a tour operator's
      // rate) the credit is not eligible: noItc.
      let other = 0, gstRate = 0, ru = false, noItc = "";
      const gt = r2(tax.IGST + tax.CGST + tax.SGST);
      if (taxable > 0 && gt > 0){
        const rt = gt * 100 / taxable;
        if (rt < 4.5 && ![0.1, 0.25, 1, 1.5, 3].some(x => Math.abs(rt - x) < 0.05)){
          const lines = v.ent.filter(e => e.l !== party && !Books.ledgerOf(e.l).kind && num(e.gr) >= 5 && (e.a < 0) === (signed < 0));
          const rated = r2(lines.reduce((a, e) => a + Math.abs(e.a), 0));
          let named = 0;
          v.ent.forEach(e => { const m = Books.ledgerOf(e.l); if (named || !((m.kind === "gst" || m.kind === "gst_common") && m.side === "input")) return;
            const x = num((String(e.l).match(/(\d+(?:\.\d+)?)\s*%/) || [])[1]); if (x > 0) named = (m.tax === "CGST" || m.tax === "SGST") ? x * 2 : x; });
          const nr = num((String(v.narr || "").match(/@\s*(\d+(?:\.\d+)?)\s*%/) || [])[1]);
          let base = 0;
          if (rated > 0 && rated < taxable){ base = rated; gstRate = num(lines[0].gr); }
          else if (named || nr){ gstRate = named || nr; base = r2(gt * 100 / gstRate); }
          else ru = true;
          if (base > 0 && base < taxable){ other = r2(taxable - base); taxable = base; }
          if (gstRate && Math.abs(gstRate - 5) < 0.01) noItc = "5% tour operator rate: no ITC";
        }
      }
      if (!reg) reg = String(v.cmp || "").slice(0, 2) || (regs.length === 1 ? regs[0] : "");
      const no = Books.supInv(v);
      out.push({id: v.id, voucher: v.no || "", type: v.type, party: party || "", gstin, no: String(no), noN: this.normNo(no), core: this.coreNo(no),
        date: v.refDate || v.date, bookDate: v.date, ym: String(v.date).slice(0, 6), reg,
        taxable, other, gstRate, ru, noItc, blocked: !!v.ineligibleFlag, igst: tax.IGST, cgst: tax.CGST, sgst: tax.SGST, cess: tax.CESS,
        dir: signed <= 0 ? 1 : -1, rcm: Books.isRcm(v), ineligible: inel > 0, held: hold > 0, narr: v.narr || ""});
    });
    return out;
  },
  // a 2B document's GST rate (its tax on its taxable value), when that is a GST rate; else 0
  rateOf(p){ const t = num(p.igst) + num(p.cgst) + num(p.sgst), v = num(p.taxable); if (!(v > 0) || !(t > 0)) return 0; const r = t * 100 / v; return [0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40].find(x => Math.abs(r - x) < 0.05) || 0; },
  settings(){ return Object.assign({tol: 1}, (S.books && S.books.reco2b && S.books.reco2b.opt) || {}); },
  state(){ const b = S.books; b.reco2b = b.reco2b || {}; ["confirm", "link", "tag"].forEach(k => { b.reco2b[k] = b.reco2b[k] || {}; }); return b.reco2b; },
  all2b(reg){
    const all = Object.values((S.books && S.books.twoBs) || {}).filter(t => !reg || t.gstin.slice(0, 2) === reg);
    // for a QRMP GSTIN the quarter's 2B (made for its last month) holds the whole quarter; the first two months' 2Bs are
    // for information only, and are set aside once the quarter's is here
    const have = new Set(all.map(t => t.gstin + "|" + t.ym));
    return all.filter(t => { if (typeof GSTSet !== "object") return true; const r = t.gstin.slice(0, 2);
      return !(GSTSet.typeOf(t.ym, r) === "qrmp" && !GSTSet.isQEnd(t.ym) && have.has(t.gstin + "|" + GSTSet.qEnd(t.ym))); }).sort((a, c) => a.ym.localeCompare(c.ym));
  },
  _memo: null,
  // match every 2B document against every book document, strongest evidence first
  run(reg){
    const b = S.books, st = this.state(), tol = num(this.settings().tol) || 1;
    const key = [reg, b.vouchers && b.vouchers.length, b.mapV || 0, Object.keys(b.gstins || {}).length, Object.keys(b.twoBs || {}).join(","), JSON.stringify(st.confirm), JSON.stringify(st.link), tol, S.coId, (CO() || {}).supInvFrom || "ref", typeof M2B === "object" && M2B.aiSig ? M2B.aiSig(reg) : ""].join("|");
    if (this._memo && this._memo.key === key && this._memo.v === b.vouchers) return this._memo.res;
    const portal = [], rejRows = [];
    this.all2b(reg).forEach(t => t.rows.forEach(r => (r.rej ? rejRows : portal).push(r)));
    const regs = (GSTR.gstins(b) || []).map(g => g.slice(0, 2));
    const books = this.bookDocs().filter(d => !reg || d.reg === reg || (!d.reg && regs.length <= 1));
    const byId = new Map(books.map(d => [d.id, d]));
    const taken = new Set(), pairs = [], used2b = new Set();
    const taxOf = x => r2(num(x.igst) + num(x.cgst) + num(x.sgst) + num(x.cess));
    const sumOf = list => list.reduce((a, d) => ({taxable: r2(a.taxable + d.taxable), igst: r2(a.igst + d.igst), cgst: r2(a.cgst + d.cgst), sgst: r2(a.sgst + d.sgst), cess: r2(a.cess + d.cess)}),
      {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0});
    const near = (a, c) => Math.abs(num(a) - num(c)) <= tol;
    const pan = g => String(g || "").slice(2, 12);
    const days = (a, c) => { const f = s => new Date(String(s).slice(0, 4) + "-" + String(s).slice(4, 6) + "-" + String(s).slice(6, 8)).getTime(); return Math.abs(f(a) - f(c)) / 86400000; };
    const byG = new Map();
    books.forEach(d => { const k = d.gstin || "?"; (byG.get(k) || byG.set(k, []).get(k)).push(d); });
    const free = d => !taken.has(d.id);
    const pair = (p, list, tier, how) => {
      list.forEach(d => taken.add(d.id)); used2b.add(p.key);
      const s = sumOf(list);
      const diff = {taxable: r2(p.taxable - s.taxable), igst: r2(p.igst - s.igst), cgst: r2(p.cgst - s.cgst), sgst: r2(p.sgst - s.sgst), cess: r2(p.cess - s.cess)};
      const issues = [];
      const taxSame = near(taxOf(p), taxOf(s));
      // the same tax on a different value: the bill has a part without GST (a reimbursement, a ticket) that Tally counts in the value
      if (!near(p.taxable, s.taxable)) issues.push((taxSame ? "value differs by " : "taxable differs by ") + INR.format(diff.taxable) + (taxSame ? " (the tax is the same)" : ""));
      if (!taxSame) issues.push("tax differs by " + INR.format(r2(taxOf(p) - taxOf(s))));
      else if (!near(p.igst, s.igst)) issues.push(p.igst ? "IGST in 2B, CGST and SGST in the books" : "CGST and SGST in 2B, IGST in the books");
      const bd = list[0];
      if (p.date && bd.date && p.date !== bd.date && days(p.date, bd.date) > 0) issues.push("date " + GSTAmend.dmy(p.date) + " in 2B, " + GSTAmend.dmy(bd.date) + " in Tally");
      if (tier >= 3 && p.noN !== bd.noN) issues.push("number " + p.no + " in 2B, " + bd.no + " in Tally");
      if (p.gstin && bd.gstin && p.gstin !== bd.gstin) issues.push("GSTIN " + p.gstin + " in 2B, " + bd.gstin + " in Tally");
      if (!bd.gstin) issues.push("no GSTIN in Tally for " + (bd.party || "the supplier") + "; 2B says " + p.gstin);
      if (list.length > 1) issues.push("booked in " + list.length + " vouchers");
      // next-itc-simple: the books do not give the GST rate of a bill whose value is more than its GST base: 2B's rate settles
      // it; when 2B's is no GST rate either, it is to be looked at
      if (list.some(d => d.ru) && !this.rateOf(p)) issues.push("rate unknown: neither the books nor 2B give the GST rate");
      const timing = list.some(d => d.ym !== p.ym);
      const confirmed = st.confirm[p.key] === "yes";
      if (list.length > 1 && list.every(d => d.noN === list[0].noN && near(taxOf(d), taxOf(list[0])))) issues.push("the same bill booked " + list.length + " times");
      const status = (how === "probable" && !confirmed) ? "probable" : (issues.filter(x => !/^date |^booked in |^number |^value differs /.test(x)).length ? "diff" : "matched");
      pairs.push({p, books: list, sum: s, diff, issues, tier, how, status, timing, confirmed, manual: how === "manual"});
    };
    // a bill and its exact reversal (same supplier, number and tax, the other way) cancel out: set both aside,
    // so a bill booked, reversed and booked again at a revised value is matched on what is left
    const reversed = [];
    const rk = d => (d.gstin || d.party) + "|" + d.noN + "|" + Math.round(taxOf(d));
    const pos = new Map();
    books.filter(d => d.dir > 0 && d.noN).forEach(d => { const k = rk(d); (pos.get(k) || pos.set(k, []).get(k)).push(d); });
    // not when 2B has a credit note from the supplier for that tax: then it is the supplier's credit note, to be matched
    const cn2b = new Set(portal.filter(p => p.dir < 0).map(p => p.gstin + "|" + Math.round(taxOf(p))));
    books.filter(d => d.dir < 0 && d.noN && !cn2b.has(d.gstin + "|" + Math.round(taxOf(d)))).forEach(d => { const l = pos.get(rk(d)); const hit = l && l.find(z => !taken.has(z.id)); if (hit){ taken.add(hit.id); taken.add(d.id); reversed.push([hit, d]); } });
    // 0. what the user linked by hand, and what they said is not the same
    portal.forEach(p => {
      const ids = st.link[p.key];
      if (!ids || !ids.length) return;
      const list = ids.map(id => byId.get(id)).filter(d => d && free(d));
      if (list.length) pair(p, list, 0, "manual");
    });
    const rejected = (p, list) => list.some(d => st.confirm[p.key + ">" + d.id] === "no");
    // next-itc-simple: the automatic matching's AI pairs (M2B, src/js/85) as links: matched by AI is a match (its row says
    // "AI", with the reason), suggested only is a probable match to accept or reject on the reconciliation's row
    const by2 = new Map(portal.map(p => [p.key, p]));
    (typeof M2B === "object" && M2B.aiLinks ? M2B.aiLinks(reg) : []).forEach(a => {
      const p = by2.get(a.g); if (!p || used2b.has(p.key) || st.confirm[p.key] === "no") return;
      const list = a.b.map(id => byId.get(id)).filter(d => d && free(d) && d.dir === p.dir);
      if (!list.length || list.length !== a.b.length || rejected(p, list)) return;
      pair(p, list, a.st === "probable" ? 4 : 0, a.st === "probable" ? "probable" : "ai");
      Object.assign(pairs[pairs.length - 1], {ai: a.why || "matched by AI", aiId: a.id});
    });
    const tiers = [
      // 1. same GSTIN, same number, same amounts
      p => { const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && d.noN === p.noN); const s = sumOf(c); return c.length && near(s.taxable, p.taxable) && near(taxOf(s), taxOf(p)) ? [c, 1, "exact"] : null; },
      // 2. same GSTIN, same number, amounts differ
      p => { const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && d.noN === p.noN); return c.length ? [c, 2, "number"] : null; },
      // 3. same GSTIN, the number written differently
      p => { const core = this.coreNo(p.no); const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && d.core === core && core !== "|"); return c.length ? [c, 3, "number"] : null; },
      // 3b. same GSTIN, one number the other with a prefix or suffix added ("39/2025-26" and "EXP/IN/39/2025-26")
      p => { const a = p.noN; if (a.length < 3) return null;
        const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && d.noN.length >= 3 && d.noN !== a && (d.noN.endsWith(a) || a.endsWith(d.noN) || d.noN.startsWith(a) || a.startsWith(d.noN)) && this.lastDigits(d.no) === this.lastDigits(p.no));
        return c.length ? [c, 3, "number"] : null; },
      // 4. same GSTIN and amounts, near in date, number different: to confirm
      p => { const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && near(d.taxable, p.taxable) && near(taxOf(d), taxOf(p)) && (!p.date || !d.date || days(p.date, d.date) <= 31));
        return c.length ? [[c.sort((a, x) => days(a.date, p.date) - days(x.date, p.date))[0]], 4, "probable"] : null; },
      // 5. another registration of the same supplier (same PAN)
      p => { const c = books.filter(d => free(d) && d.dir === p.dir && d.gstin && d.gstin !== p.gstin && pan(d.gstin) === pan(p.gstin) && (d.noN === p.noN || d.core === this.coreNo(p.no)));
        return c.length ? [[c[0]], 5, "probable"] : null; },
      // 6. no GSTIN in Tally: the same number and tax
      p => { const c = (byG.get("?") || []).filter(d => free(d) && d.dir === p.dir && (d.noN === p.noN || (d.core === this.coreNo(p.no) && this.lastDigits(d.no) === this.lastDigits(p.no))) && near(taxOf(d), taxOf(p)));
        return c.length ? [[c[0]], 6, "probable"] : null; },
      // 7. no GSTIN in Tally and no invoice number: a similar name, the same tax, near in date
      p => { const c = (byG.get("?") || []).filter(d => free(d) && d.dir === p.dir && near(taxOf(d), taxOf(p)) && near(d.taxable, p.taxable) && (!p.date || !d.date || days(p.date, d.date) <= 31) && nameSim(d.party, p.party) >= 0.6);
        return c.length ? [[c.sort((a, x) => nameSim(x.party, p.party) - nameSim(a.party, p.party))[0]], 7, "probable"] : null; }
    ];
    tiers.forEach(tier => portal.forEach(p => {
      if (used2b.has(p.key) || p.sec === "impg") return;
      const hit = tier(p);
      if (!hit) return;
      const [list, t, how] = hit;
      if (rejected(p, list)) return;
      if (how === "probable" && st.confirm[p.key] === "no") return;
      pair(p, list, t, how);
    }));
    // imports: by bill of entry number, else by IGST
    portal.filter(p => p.sec === "impg" && !used2b.has(p.key)).forEach(p => {
      const c = books.filter(d => free(d) && d.dir === 1 && (d.noN === p.noN || (!d.gstin && near(d.igst, p.igst) && d.igst > 0)));
      if (c.length && !rejected(p, [c[0]])) pair(p, [c[0]], c[0].noN === p.noN ? 2 : 4, c[0].noN === p.noN ? "number" : "probable");
    });
    // rejected in IMS: found in Tally by supplier and number (or number written differently), else on its own
    const rejList = [];
    rejRows.forEach(p => {
      const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && (d.noN === p.noN || (d.core === this.coreNo(p.no) && this.coreNo(p.no) !== "|")));
      c.forEach(d => taken.add(d.id));
      rejList.push({p, books: c, sum: sumOf(c)});
    });
    const only2b = portal.filter(p => !used2b.has(p.key));
    const onlyBooks = books.filter(d => !taken.has(d.id));
    // the same supplier's bill, same number and tax, booked more than once
    const dupes = {}, dk = {};
    const revIds = new Set(reversed.flat().map(d => d.id));
    books.forEach(d => { if (!d.noN || revIds.has(d.id)) return; const k = (d.gstin || d.party) + "|" + d.noN + "|" + d.dir + "|" + Math.round(taxOf(d)); (dk[k] = dk[k] || []).push(d); });
    Object.values(dk).filter(l => l.length > 1 && taxOf(l[0]) > 0).forEach(l => l.forEach((d, i) => { dupes[d.id] = {n: l.length, first: i === 0, others: l.filter(z => z !== d).map(z => z.voucher + " of " + GSTAmend.dmy(z.bookDate))}; }));
    // a bill in 2B and in Tally, but booked with no input tax (the tax charged to the expense)
    const docIds = new Set(books.map(d => d.id)), gstMap = b.gstins || {};
    const noCredit = new Map();
    (b.vouchers || []).forEach(v => { if (docIds.has(v.id) || Books.isSale(v) || v.cancel || v.opt) return; const k = this.normNo(v.ref || v.no); if (k.length >= 3) (noCredit.get(k) || noCredit.set(k, []).get(k)).push(v); });
    portal.forEach(p => { delete p.bookedNoCredit; });
    only2b.forEach(p => {
      const c = (noCredit.get(p.noN) || []).filter(v => (!p.date || days(p.date, v.date) <= 62) && (!gstMap[v.party] || String(gstMap[v.party]).toUpperCase() === p.gstin || pan(gstMap[v.party]) === pan(p.gstin)));
      if (c.length){ const v = c[0]; p.bookedNoCredit = {id: v.id, type: v.type, no: v.no, date: v.date, party: v.party}; }
    });
    const res = {pairs, only2b, onlyBooks, portal, books, taxOf, dupes, reversed, rejected: rejList, loaded: this.all2b(reg).map(t => t.ym)};
    this._memo = {key, v: b.vouchers, res};
    return res;
  },
};
// GSTAdv (src/js/14-gst-on-advances.js)
const GSTAdv = {
  RATES: [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40],
  // the owner, 22-Oct-2026: "don't treat advance unless we say": 11A/11B (GSTR-1, 3B 3.1(a), GSTR-9, the JSON and Excel,
  // the checks) only for a client whose "Show advances in GST returns" is on: co.choices.advGst = {value: "on" | "off",
  // state, by, at, prev} (choiceConfirm, from the Advances page or Client setup → GST: app/src/parts/AdvOptIn.jsx). Off
  // unless turned on. Every reader of advances asks ready() first (month() gives nothing without it), so off reads as no
  // advances at all; written inline, as legacy.js is at its size budget (tests/run_stability.py)
  ready(){ const b = S.books; return !!(b && b.meta && b.meta.bills) && (((CO() || {}).choices || {}).advGst || {}).value == "on"; },
  nearRate(x){ let best = 18, d = 1e9; this.RATES.forEach(r => { if (Math.abs(r - x) < d){ d = Math.abs(r - x); best = r; } }); return d < 0.6 ? best : r2(x); },
  // a ledger is a customer when it sits under Sundry Debtors; without the masters, when it was billed
  isCustomer(name, billed){
    const b = S.books;
    if (ledUnder(b, name) == null) return billed.has(name);
    return ledGroupPath(b, name).some(g => /^sundry\s+debtors$/i.test(String(g).trim()));
  },
  stateCode(name){ return STATE_CODES[String(name || "").toUpperCase().trim()] || ""; },
  _memo: null,
  // every advance received, and what later used it up
  build(){
    const b = S.books;
    if (!b || !b.vouchers) return {pieces: [], billed: new Map()};
    const key = [b.vouchers.length, b.mapV || 0, JSON.stringify(b.advFix || {}), Object.keys(b.under || {}).length, Object.keys(b.states || {}).length, S.coId].join("|");
    if (this._memo && this._memo.key === key && this._memo.v === b.vouchers) return this._memo.res;
    const fix = b.advFix || {};
    const vs = b.vouchers.map((v, i) => [v, i]).sort((a, c) => String(a[0].date).localeCompare(String(c[0].date)) || a[1] - c[1]).map(x => x[0]);
    // what each customer was billed, for the rate, registration and place of supply of an advance
    const billed = new Map();
    const firstSupply = {Goods: 0, Services: 0};
    vs.forEach(v => {
      if (!Books.isSale(v) || /CREDIT NOTE/i.test(v.type)) return;
      const L = Books.lines(v), tax = L.tax.CGST + L.tax.SGST + L.tax.IGST;
      const supply = v.supply || ((v.hsn || []).some(h => /^99/.test(h)) ? "Services" : (v.hsn || []).length ? "Goods" : "");
      if (supply) firstSupply[supply]++;
      // by the buyer's name and by the party ledger (the receipt names the ledger; review of 22-Oct-2026: the two differ)
      const h = {date: v.date, rate: L.taxable ? this.nearRate(tax / L.taxable * 100) : null, reg: GSTR.regOf(v), gstin: (v.gstin || "").toUpperCase(),
        pos: v.pos || "", supply, cls: Books.supplyClass(v)};
      new Set([v.party].concat(Books.partyEnts(v).map(e => e.l))).forEach(k => billed.set(k, (billed.get(k) || []).concat([h])));
    });
    const refs = new Map(), pieces = [];
    const take = (r, amount, ym, date, by, how) => {
      let need = amount;
      r.pieces.forEach(p => {
        if (need <= 0.004 || p.left <= 0.004) return;
        const t = r2(Math.min(need, p.left));
        p.left = r2(p.left - t); need = r2(need - t);
        p.adj.push({ym, date, amount: t, by, how});
      });
    };
    vs.forEach(v => {
      const rcpt = /RECEIPT/i.test(v.type) && !/CONTRA/i.test(v.type);
      const sale = Books.isSale(v) && !/CREDIT NOTE/i.test(v.type);
      const refund = /PAYMENT/i.test(v.type) || /CREDIT NOTE/i.test(v.type);
      if (!rcpt && !sale && !refund) return;
      const ym = GSTR.ym(v.date), pe = sale ? new Set(Books.partyEnts(v)) : null;
      v.ent.forEach((e, ei) => {
        if (!e.b) return;
        if (rcpt && !this.isCustomer(e.l, billed)) return;
        // the invoice's bills are on its party line, whatever the buyer's name on it (review of 22-Oct-2026: an invoice to
        // "HDFC Life Insurance Company" debits "HDFC Life Insurance Company-DL"; its receipt before it stayed in 11A)
        if (sale && !pe.has(e)) return;
        e.b.forEach((x, bi) => {
          const name = x[0], type = x[1], amt = x[2];
          const k = e.l + "|" + (type === "On Account" ? "\u0000on-account" : name);
          let r = refs.get(k);
          if (rcpt){
            if (amt <= 0) return;                                   // a debit on a receipt is not money received
            const early = type === "Advance" || type === "On Account" || (type === "New Ref" && !(r && r.billed)) || (type === "Agst Ref" && r && !r.billed && r.pieces.length);
            if (!early) return;
            const id = v.id + ":" + ei + ":" + bi;
            const p = {id, vid: v.id, date: v.date, ym, no: v.no, party: e.l, ref: type === "On Account" ? "" : name, type, amount: r2(amt), left: r2(amt), adj: [],
              cmpReg: GSTR.regOf(v), fix: fix[id] || {}};
            pieces.push(p);
            if (!r){ r = {pieces: [], billed: false}; refs.set(k, r); }
            r.pieces.push(p);
          } else if (sale){
            if (type === "Agst Ref" && r && r.pieces.length) take(r, Math.abs(amt), ym, v.date, v.no, "invoice");
            if (r) r.billed = true; else refs.set(k, {pieces: [], billed: true});
          } else if (refund){
            if (amt < 0 && type === "Agst Ref" && r && !r.billed && r.pieces.length) take(r, Math.abs(amt), ym, v.date, v.no, "refund");
          }
        });
      });
    });
    const regs = (GSTR.gstins(b) || []).map(g => g.slice(0, 2));
    const mostly = firstSupply.Goods > firstSupply.Services ? "Goods" : "Services";
    pieces.forEach(p => {
      const f = p.fix;
      if (f.adjYm && p.left > 0.004){ p.adj.push({ym: f.adjYm, date: f.adjYm + "01", amount: p.left, by: "", how: "marked"}); p.left = 0; }
      const hist = billed.get(p.party) || [];
      const before = hist.filter(h => h.date <= p.date), after = hist.filter(h => h.date > p.date);
      const s = before.length ? before[before.length - 1] : after[0] || null;
      p.supply = s && s.supply ? s.supply : mostly;
      p.zero = !!(s && (s.cls === "export" || s.cls === "sez"));
      p.exempt = !!(s && (s.cls === "exempt" || s.cls === "nil" || s.cls === "nongst"));
      p.rate = f.rate != null && f.rate !== "" ? num(f.rate) : s && s.rate != null ? s.rate : 18;
      p.rateFrom = f.rate != null && f.rate !== "" ? "set" : s && s.rate != null ? (before.length ? "last invoice" : "next invoice") : "assumed";
      p.reg = s && s.reg ? s.reg : p.cmpReg || regs[0] || "";
      const gstin = ((b.gstins || {})[p.party] || (s && s.gstin) || "").toUpperCase();
      p.gstin = gstin;
      p.pos = f.pos || (gstin ? gstin.slice(0, 2) : "") || this.stateCode((b.states || {})[p.party]) || (s ? this.stateCode(s.pos) : "") || p.reg;
      p.guessed = p.rateFrom === "assumed" || !s;
      p.skip = !!f.skip;
      // money kept on account is usually a collection nobody tied to its invoice; it counts only when marked
      p.onAccount = p.type === "On Account" && !f.isAdv;
      p.taxed = !p.skip && !p.onAccount && p.supply !== "Goods" && !p.zero && !p.exempt && p.rate > 0;
      p.why = p.skip ? "marked as not an advance" : p.onAccount ? "on account, not tied to a bill: mark it if it is an advance" : p.supply === "Goods" ? "goods: no tax on advances" : p.zero ? "export or SEZ" : p.exempt ? "exempt supply" : p.rate > 0 ? "" : "nil rate";
    });
    const res = {pieces, billed};
    this._memo = {key, v: b.vouchers, res};
    return res;
  },
  // tax inside an amount received, at the rate, split by whether the supply is inter-state
  taxOf(amount, rate, pos, reg){
    const taxable = r2(amount * 100 / (100 + rate)), inter = !!(pos && reg && pos !== reg);
    const tax = r2(taxable * rate / 100);
    return inter ? {taxable, igst: tax, cgst: 0, sgst: 0, cess: 0, inter} : {taxable, igst: 0, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), cess: 0, inter};
  },
  row(p, amount, extra){
    return Object.assign({id: p.id, party: p.party, gstin: p.gstin, date: p.date, no: p.no, ref: p.ref, type: p.type, rate: p.rate, rateFrom: p.rateFrom,
      pos: p.pos, reg: p.reg, received: amount}, this.taxOf(amount, p.rate, p.pos, p.reg), extra || {});
  },
  // one month: 11A is what came in and was not billed in the same month; 11B is an earlier advance billed now
  // (without ready(): no pieces, so every list empty and every sum nil; the result's ready is not read by any caller)
  month(ym, reg){
    const zero = {n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, received: 0};
    const months = ym ? GSTR.expand(ym) : GSTR.months();
    const {pieces, billed} = this.ready() ? this.build() : {pieces: []};
    const at = [], txpd = [], untaxed = [], unmatched = [];
    // review of 02-Oct-2026: an advance is adjusted in 11B only against an invoice to that customer in the same return
    // period (the month, or the quarter for a QRMP filer). One marked as adjusted by hand in a period with no invoice
    // to the customer (Testing AAD: receipt 13 of 15-Apr-2025 from LEADS INSURANCE BROKERS, 27,000 against bill
    // 2023-24/GST/591, marked as adjusted in Sep-2026, where there is no invoice) would make GSTR-1's taxable value
    // negative (-22,881.36): it is listed on its own, with what is missing, and left out of 11B and 3.1(a)
    const periodOf = m => { try { if (typeof GSTSet === "object" && GSTSet.typeOf(m, reg || p0reg) === "qrmp") return GSTR.expand(GSTSet.qStart(m) + "-" + GSTSet.qEnd(m)); } catch (e){} return [m]; };
    const p0reg = reg || ((GSTR.gstins(S.books) || [])[0] || "").slice(0, 2);
    const invoiced = (party, m) => { const ms = periodOf(m); return (billed.get(party) || []).some(h => ms.includes(GSTR.ym(h.date))); };
    pieces.forEach(p => {
      if (reg && p.reg !== reg) return;
      months.forEach(m => {
        if (p.ym === m){
          const sameMonth = p.adj.filter(a => a.ym === m).reduce((s, a) => s + a.amount, 0);
          const amount = r2(p.amount - sameMonth);
          if (amount > 0.004){
            if (p.taxed) at.push(this.row(p, amount));
            else untaxed.push(this.row(p, amount, {why: p.why}));
          }
        }
        p.adj.forEach(a => {
          if (!(a.ym === m && p.ym < m && p.taxed)) return;
          if (a.how === "marked" && !invoiced(p.party, m)){
            const per = periodOf(m), lab = per.length > 1 ? GSTSet.qLabel(per[per.length - 1]) : GSTR.label(m);
            unmatched.push(this.row(p, a.amount, {receivedYm: p.ym, adjDate: a.date, by: a.by, how: a.how, missing: "no invoice to " + p.party + " in " + lab + ": raise the invoice, or mark the advance as adjusted in the month of its invoice"}));
            return;
          }
          txpd.push(this.row(p, a.amount, {receivedYm: p.ym, adjDate: a.date, by: a.by, how: a.how}));
        });
      });
    });
    const sum = rows => rows.reduce((s, r) => ({n: s.n + 1, received: r2(s.received + r.received), taxable: r2(s.taxable + r.taxable), igst: r2(s.igst + r.igst),
      cgst: r2(s.cgst + r.cgst), sgst: r2(s.sgst + r.sgst), cess: r2(s.cess + r.cess)}), zero);
    const atSum = sum(at), txpdSum = sum(txpd);
    const net = {n: 0, received: r2(atSum.received - txpdSum.received), taxable: r2(atSum.taxable - txpdSum.taxable), igst: r2(atSum.igst - txpdSum.igst),
      cgst: r2(atSum.cgst - txpdSum.cgst), sgst: r2(atSum.sgst - txpdSum.sgst), cess: r2(atSum.cess - txpdSum.cess)};
    const last = months[months.length - 1] || "";
    const open = pieces.filter(p => (!reg || p.reg === reg) && p.taxed && p.ym <= last && r2(p.amount - p.adj.filter(a => a.ym <= last).reduce((s, a) => s + a.amount, 0)) > 0.004);
    return {ready: true, at, txpd, atSum, txpdSum, net, untaxed, open, unmatched, unmatchedSum: sum(unmatched)};
  },
  // GSTR-1 JSON parts: grouped by place of supply and rate, the advance shown without its tax
  json(rows){
    const m = {};
    rows.forEach(r => {
      const k = r.pos + "|" + (r.inter ? "INTER" : "INTRA");
      const g = m[k] = m[k] || {pos: String(r.pos).padStart(2, "0"), sply_ty: r.inter ? "INTER" : "INTRA", rates: {}};
      const it = g.rates[r.rate] = g.rates[r.rate] || {rt: r.rate, ad_amt: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
      it.ad_amt = r2(it.ad_amt + r.taxable); it.iamt = r2(it.iamt + r.igst); it.camt = r2(it.camt + r.cgst); it.samt = r2(it.samt + r.sgst); it.csamt = r2(it.csamt + r.cess);
    });
    return Object.values(m).map(g => ({pos: g.pos, sply_ty: g.sply_ty, itms: Object.values(g.rates).map(it => g.sply_ty === "INTER"
      ? {rt: it.rt, ad_amt: it.ad_amt, iamt: it.iamt, csamt: it.csamt} : {rt: it.rt, ad_amt: it.ad_amt, camt: it.camt, samt: it.samt, csamt: it.csamt})}));
  },
};
// GSTAmend (src/js/13-gstr-1-amendments.js)
const GSTAmend = {
  fpOf(ym){ return String(ym).slice(4, 6) + String(ym).slice(0, 4); },
  ymOf(fp){ return String(fp).slice(2, 6) + String(fp).slice(0, 2); },
  ymd(dmy){ const m = String(dmy || "").match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? m[3] + m[2] + m[1] : String(dmy || "").replace(/-/g, ""); },
  dmy(d){ d = String(d || ""); return d.length === 8 ? d.slice(6, 8) + "-" + d.slice(4, 6) + "-" + d.slice(0, 4) : d; },
  numKey(n){ return String(n == null ? "" : n).toUpperCase().replace(/\s+/g, ""); },
  // the last month a year's invoices can still be amended in: November after the year ends (section 37(3))
  lastYm(ym){ const y = num(ym.slice(0, 4)), m = num(ym.slice(4, 6)); return String((m >= 4 ? y + 1 : y)) + "11"; },
  // the copies that stand as filed: one brought in from the portal; one downloaded here only once its month is marked filed
  // (the date typed, the portal's return status or its PDF's ARN), and then the last download made by the filing date.
  // Until then a download is a draft (owner, 22-Oct-2026). all: every copy kept, for the list
  filed(reg, all){
    return Object.values((S.books && S.books.filed) || {}).filter(f => (!reg || String(f.gstin).slice(0, 2) === reg)).map(f => all || f.source === "portal" ? f : this.asFiled(f)).filter(f => f).sort((a, c) => a.ym.localeCompare(c.ym));
  },
  asFiled(f){
    const p = this.proof(f.ym, String(f.gstin).slice(0, 2)), on = p && p.on ? p.on + "T18:30" : "~", c = p && ([f].concat(f.prev || []).find(x => x.at <= on) || f);
    return c && c !== f ? Object.assign({}, f, c) : c;
  },
  // one flat list of documents from a GSTR-1 JSON, amendments folded onto the original number
  norm(json){
    const docs = new Map(), b2cs = new Map(), b2csa = [];
    const sumItems = itms => {
      const t = {txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0, rates: []};
      (itms || []).forEach(it => {
        const d = it.itm_det || it;
        t.txval = r2(t.txval + num(d.txval)); t.iamt = r2(t.iamt + num(d.iamt)); t.camt = r2(t.camt + num(d.camt)); t.samt = r2(t.samt + num(d.samt)); t.csamt = r2(t.csamt + num(d.csamt));
        if (!t.rates.includes(num(d.rt))) t.rates.push(num(d.rt));
      });
      t.rates.sort((a, c) => a - c);
      return t;
    };
    const put = (kind, key, x, extra) => docs.set(key, Object.assign({kind, key, num: String(x.inum || x.nt_num || ""), date: this.ymd(x.idt || x.nt_dt), val: num(x.val),
      pos: String(x.pos || "").padStart(2, "0"), rchrg: x.rchrg || "N", inv_typ: x.inv_typ || "R", itms: x.itms || []}, sumItems(x.itms), extra || {}));
    (json.b2b || []).forEach(g => (g.inv || []).forEach(x => put("B2B", "B2B|" + String(g.ctin).toUpperCase() + "|" + this.numKey(x.inum), x, {ctin: String(g.ctin).toUpperCase()})));
    (json.b2ba || []).forEach(g => (g.inv || []).forEach(x => put("B2B", "B2B|" + String(g.ctin).toUpperCase() + "|" + this.numKey(x.oinum), x, {ctin: String(g.ctin).toUpperCase()})));
    (json.b2cl || []).forEach(g => (g.inv || []).forEach(x => put("B2CL", "B2CL|" + this.numKey(x.inum), Object.assign({pos: g.pos}, x))));
    (json.b2cla || []).forEach(g => (g.inv || []).forEach(x => put("B2CL", "B2CL|" + this.numKey(x.oinum), Object.assign({pos: g.pos}, x))));
    (json.exp || []).forEach(g => (g.inv || []).forEach(x => put("EXP", "EXP|" + this.numKey(x.inum), x, {exp_typ: g.exp_typ || "WPAY"})));
    (json.expa || []).forEach(g => (g.inv || []).forEach(x => put("EXP", "EXP|" + this.numKey(x.oinum), x, {exp_typ: g.exp_typ || "WPAY"})));
    (json.cdnr || []).forEach(g => (g.nt || []).forEach(x => put("CDNR", "CDNR|" + String(g.ctin).toUpperCase() + "|" + this.numKey(x.nt_num), x, {ctin: String(g.ctin).toUpperCase(), ntty: x.ntty})));
    (json.cdnra || []).forEach(g => (g.nt || []).forEach(x => put("CDNR", "CDNR|" + String(g.ctin).toUpperCase() + "|" + this.numKey(x.ont_num), x, {ctin: String(g.ctin).toUpperCase(), ntty: x.ntty})));
    (json.b2cs || []).forEach(x => {
      const k = String(x.pos).padStart(2, "0") + "|" + num(x.rt) + "|" + (x.sply_ty || "");
      const o = b2cs.get(k) || {pos: String(x.pos).padStart(2, "0"), rt: num(x.rt), sply_ty: x.sply_ty, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
      o.txval = r2(o.txval + num(x.txval)); o.iamt = r2(o.iamt + num(x.iamt)); o.camt = r2(o.camt + num(x.camt)); o.samt = r2(o.samt + num(x.samt)); o.csamt = r2(o.csamt + num(x.csamt));
      b2cs.set(k, o);
    });
    (json.b2csa || []).forEach(x => (x.itms || []).forEach(it => b2csa.push({omon: x.omon, pos: String(x.pos).padStart(2, "0"), rt: num(it.rt), sply_ty: x.sply_ty,
      txval: num(it.txval), iamt: num(it.iamt), camt: num(it.camt), samt: num(it.samt), csamt: num(it.csamt)})));
    return {docs, b2cs, b2csa};
  },
  // what the portal holds, as of the returns filed before a month
  state(reg, beforeYm, inclusive){
    const docs = new Map(), b2cs = {}, periods = new Set(), qOf = {};
    this.filed(reg).filter(f => !f.notFiled && (inclusive ? f.ym <= beforeYm : f.ym < beforeYm)).forEach(f => {
      const n = this.norm(f.json);
      periods.add(f.ym);
      // a QRMP quarter's GSTR-1 reports all three months (with whatever IFF did not)
      if (f.quarter) GSTR.expand(f.quarter).forEach(m => { qOf[m] = f.quarter; if (inclusive ? m <= beforeYm : m < beforeYm) periods.add(m); });
      n.docs.forEach((d, k) => docs.set(k, Object.assign({}, d, {filedIn: f.ym})));
      b2cs[f.ym] = n.b2cs;
      const a1 = ((S.books && S.books.filed1a) || {})[String(f.gstin).toUpperCase() + "|" + f.fp];
      if (a1){ const n1 = this.norm(a1.json); n1.docs.forEach((d, k) => docs.set(k, Object.assign({}, d, {filedIn: f.ym, in1a: true}))); n1.b2csa.forEach(a => { const m = b2cs[f.ym] = b2cs[f.ym] || new Map(); m.set(a.pos + "|" + a.rt + "|" + a.sply_ty, a); }); }
      n.b2csa.forEach(a => {
        const m = b2cs[this.ymOf(a.omon)] = b2cs[this.ymOf(a.omon)] || new Map();
        m.set(a.pos + "|" + a.rt + "|" + a.sply_ty, a);
      });
    });
    return {docs, b2cs, periods, qOf};
  },
  same(a, c){ return Math.abs(num(a) - num(c)) < 1.005; },
  changes(was, now){
    const out = [], m = v => INR.format(r2(v || 0));
    if (was.date !== now.date) out.push("date " + this.dmy(was.date) + " \u2192 " + this.dmy(now.date));
    if (was.pos !== now.pos) out.push("place of supply " + was.pos + " \u2192 " + now.pos);
    if (!this.same(was.txval, now.txval)) out.push("taxable " + m(was.txval) + " \u2192 " + m(now.txval));
    ["iamt", "camt", "samt", "csamt"].forEach((k, i) => { if (!this.same(was[k], now[k])) out.push(["IGST", "CGST", "SGST", "cess"][i] + " " + m(was[k]) + " \u2192 " + m(now[k])); });
    if (!this.same(was.val, now.val) && !out.length) out.push("value " + m(was.val) + " \u2192 " + m(now.val));
    if (was.rates.join(",") !== now.rates.join(",") && out.length) out.push("rate " + was.rates.join("/") + "% \u2192 " + now.rates.join("/") + "%");
    if ((was.rchrg || "N") !== (now.rchrg || "N")) out.push("reverse charge " + was.rchrg + " \u2192 " + now.rchrg);
    if (was.kind === "CDNR" && was.ntty !== now.ntty) out.push("note type " + was.ntty + " \u2192 " + now.ntty);
    return out;
  },
  // every difference between the books and the portal, for months before the return being prepared
  // self: the month's own differences, for its GSTR-1A (after its GSTR-1, before its 3B)
  pending(ym, reg, self){
    const res = {rows: [], periods: [], noCopy: [], late: [], ready: !!reg};
    if (!reg || !ym) return res;
    const st = this.state(reg, ym, !!self), fix = (S.books && S.books.amendFix) || {};
    const qr = self && typeof GSTSet === "object" && GSTSet.typeOf(ym, reg) === "qrmp";
    const months = self ? (qr ? GSTR.expand(GSTSet.qStart(ym) + "-" + ym).filter(m => GSTR.months().includes(m)) : [ym]) : GSTR.months().filter(m => m < ym);
    months.forEach(P => {
      if (!st.periods.has(P)){ if (this.filed(reg).length) res.noCopy.push(P); return; }
      if (!self && ym > this.lastYm(P)){ res.late.push(P); return; }
      res.periods.push(P);
      const bn = this.norm(GSTR.toJson(P, reg, {plain: true})), books = bn.docs;
      const before = res.rows.length;
      const filedP = new Map(Array.from(st.docs).filter(([, d]) => GSTR.ym(d.date) === P || (d.filedIn === P && !GSTR.ym(d.date))));
      const b2csP = st.b2cs[P] || new Map();
      books.forEach((d, k) => {
        const was = filedP.get(k) || (st.docs.has(k) ? st.docs.get(k) : null);
        const id = P + "|" + k;
        if (was){
          const ch = this.changes(was, d);
          if (ch.length) res.rows.push({id, P, kind: d.kind, what: "amend", was, now: d, changes: ch, act: fix[id] || "amend"});
          return;
        }
        // not in the filed return: a B2B invoice may have gone in B2C small, or been missed
        let guess = "missed";
        if (d.kind === "B2B" && d.rates.length === 1){
          const sply = d.iamt ? "INTER" : "INTRA", g = b2csP.get(d.pos + "|" + d.rates[0] + "|" + sply);
          if (g && num(g.txval) + 1 >= d.txval) guess = "b2c";
        }
        res.rows.push({id, P, kind: d.kind, what: "missing", was: null, now: d, changes: [guess === "b2c" ? "filed in B2C small, now has a GSTIN" : "not in the filed return"], act: fix[id] || guess});
      });
      filedP.forEach((d, k) => {
        if (books.has(k) || GSTR.ym(d.date) !== P) return;
        if (!num(d.val) && !num(d.txval)) return;                     // already amended to nil
        const id = P + "|" + k;
        res.rows.push({id, P, kind: d.kind, what: "gone", was: d, now: null, changes: ["filed, but no longer in the books"], act: fix[id] || "nil"});
      });
      // a filed document that is gone and a new one that is missing are one amendment when they are the same document:
      // renumbered (same party, date and value), or its GSTIN corrected (same number and value)
      const mine = res.rows.slice(before), gone = mine.filter(r => r.what === "gone"), miss = mine.filter(r => r.what === "missing");
      gone.forEach(g => {
        const w = g.was, hit = miss.find(m => m.kind === g.kind && !m.paired && this.same(m.now.val, w.val) && (
          ((m.now.ctin || "") === (w.ctin || "") && m.now.date === w.date && this.numKey(m.now.num) !== this.numKey(w.num)) ||
          (this.numKey(m.now.num) === this.numKey(w.num) && (m.now.ctin || "") !== (w.ctin || ""))));
        if (!hit) return;
        hit.paired = true; g.paired = true;
        const d = hit.now, ch = this.changes(w, d);
        if (this.numKey(d.num) !== this.numKey(w.num)) ch.unshift("number " + w.num + " \u2192 " + d.num);
        if ((d.ctin || "") !== (w.ctin || "")) ch.unshift("GSTIN " + (w.ctin || "none") + " \u2192 " + (d.ctin || "none"));
        const id = P + "|" + g.kind + "|" + (w.ctin || "") + "|" + this.numKey(w.num) + ">" + this.numKey(d.num);
        res.rows.push({id, P, kind: d.kind, what: "amend", was: w, now: d, changes: ch, act: fix[id] || "amend"});
      });
      for (let i = res.rows.length - 1; i >= before; i--) if (res.rows[i].paired) res.rows.splice(i, 1);
      // B2C small (table 7) of the month: when the books now differ from what was filed (an invoice lost or gained a GSTIN,
      // or a B2C invoice changed), table 10 carries the month's revised figures, rate by rate and place by place
      // a QRMP quarter reports B2C small once, for the quarter: compared at its last month, against the quarter's books
      const qP = (st.qOf || {})[P];
      const bq = qP ? (GSTR.pEnd(qP) === P ? this.norm(GSTR.toJson(qP, reg, {plain: true})).b2cs : null) : bn.b2cs;
      const fb = bq ? (st.b2cs[P] || new Map()) : new Map(), keys = bq ? new Set(Array.from(fb.keys()).concat(Array.from(bq.keys()))) : new Set();
      keys.forEach(k => {
        const w = fb.get(k), d = bq.get(k), z = {txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
        const a = Object.assign({}, z, w || {}), c = Object.assign({}, z, d || {});
        if (["txval", "iamt", "camt", "samt", "csamt"].every(f => this.same(a[f], c[f]))) return;
        const [pos, rt, sply] = k.split("|"), id = P + "|B2CS|" + k, m = v => INR.format(r2(v || 0));
        // a B2B invoice you marked as missed was never in B2C small: its value is not a change to table 7
        const rel = mine.filter(r => !r.paired && r.what === "missing" && r.kind === "B2B" && r.now.rates.length === 1 && r.now.pos + "|" + r.now.rates[0] + "|" + (r.now.iamt ? "INTER" : "INTRA") === k);
        const relMissed = rel.filter(r => r.act === "missed"), movedOut = r2(relMissed.reduce((q, r) => q + num(r.now.txval), 0));
        if (relMissed.length && this.same(a.txval - c.txval, movedOut) && !fix[id]) return;
        const lab = "place " + pos + ", " + rt + "%, " + (sply === "INTER" ? "inter-state" : "intra-state");
        res.rows.push({id, P, kind: "B2CS", what: "amend", b2cs: {pos, rt: num(rt), sply_ty: sply, now: c},
          was: {num: lab, date: "", txval: a.txval, val: a.txval}, now: {num: lab, date: "", txval: c.txval, val: c.txval},
          changes: ["taxable " + m(a.txval) + " \u2192 " + m(c.txval)], act: fix[id] || "amend"});
      });
    });
    res.rows.sort((a, c) => a.P.localeCompare(c.P) || a.kind.localeCompare(c.kind) || String(a.now ? a.now.num : a.was.num).localeCompare(String(c.now ? c.now.num : c.was.num)));
    return res;
  },
  // proof that a month's GSTR-1 (or IFF) was filed: its filing date, and its ARN when the portal's PDF is kept
  proof(ym, reg){
    const r = typeof GSTF === "object" ? GSTF.peek(ym, reg) : {};
    const v = typeof GSTV === "object" ? (GSTV.copies(reg, "r1", ym)[0] || GSTV.copies(reg, "iff", ym)[0]) : null;
    const on = r.r1 || r.iff || (v && v.arnDate) || "", arn = (v && v.arn) || "";
    return on || arn ? {on, arn} : null;
  },
  zeroItems(d){ return [{num: 1, itm_det: Object.assign({rt: d.rates[0] || 0, txval: 0, csamt: 0}, d.iamt ? {iamt: 0} : {camt: 0, samt: 0})}]; },
  // put what is pending into the month's GSTR-1 JSON
  addTo(out, ym, reg, self){
    const p = this.pending(ym, reg, self);
    const groups = {}, push = (sec, gk, head, item) => { const s = groups[sec] = groups[sec] || {}; (s[gk] = s[gk] || Object.assign({}, head, {list: []})).list.push(item); };
    const moved = {};
    p.rows.forEach(r => {
      if (r.act === "skip") return;
      if (r.kind === "B2CS"){
        const x = r.b2cs, c = x.now, it = {rt: x.rt, txval: r2(c.txval), csamt: r2(c.csamt)};
        if (x.sply_ty === "INTER") it.iamt = r2(c.iamt); else { it.camt = r2(c.camt); it.samt = r2(c.samt); }
        (out.b2csa = out.b2csa || []).push({omon: this.fpOf(r.P), sply_ty: x.sply_ty, pos: x.pos, typ: "OE", itms: [it]});
        return;
      }
      const d = r.now, w = r.was;
      if (r.what === "amend" || (r.what === "gone" && r.act === "nil")){
        const x = d || w, itms = d ? d.itms : this.zeroItems(w), val = d ? d.val : 0;
        const base = {oinum: w.num, oidt: this.dmy(w.date), inum: x.num, idt: this.dmy(x.date), val};
        if (x.kind === "B2B") push("b2ba", x.ctin, {ctin: x.ctin}, Object.assign(base, {pos: x.pos, rchrg: x.rchrg, inv_typ: x.inv_typ, itms}));
        else if (x.kind === "B2CL") push("b2cla", x.pos, {pos: x.pos}, Object.assign(base, {itms}));
        else if (x.kind === "EXP") push("expa", x.exp_typ || "WPAY", {exp_typ: x.exp_typ || "WPAY"}, Object.assign(base, {itms}));
        else if (x.kind === "CDNR") push("cdnra", x.ctin, {ctin: x.ctin}, {ont_num: w.num, ont_dt: this.dmy(w.date), ntty: x.ntty, nt_num: x.num, nt_dt: this.dmy(x.date), val, pos: x.pos, rchrg: x.rchrg, inv_typ: x.inv_typ, itms});
        return;
      }
      if (r.what === "missing" && (r.act === "missed" || r.act === "b2c")){
        // reported now, in the month's own tables, with its original number and date
        if (d.kind === "B2B") push("b2b", d.ctin, {ctin: d.ctin}, {inum: d.num, idt: this.dmy(d.date), val: d.val, pos: d.pos, rchrg: d.rchrg, inv_typ: d.inv_typ, itms: d.itms});
        else if (d.kind === "B2CL") push("b2cl", d.pos, {pos: d.pos}, {inum: d.num, idt: this.dmy(d.date), val: d.val, itms: d.itms});
        else if (d.kind === "EXP") push("exp", d.exp_typ || "WPAY", {exp_typ: d.exp_typ || "WPAY"}, {inum: d.num, idt: this.dmy(d.date), val: d.val, itms: d.itms});
        else if (d.kind === "CDNR") push("cdnr", d.ctin, {ctin: d.ctin}, {ntty: d.ntty, nt_num: d.num, nt_dt: this.dmy(d.date), val: d.val, pos: d.pos, rchrg: d.rchrg, inv_typ: d.inv_typ, itms: d.itms});
        if (r.act === "b2c"){
          const sply = d.iamt ? "INTER" : "INTRA", k = r.P + "|" + d.pos + "|" + d.rates[0] + "|" + sply;
          const m = moved[k] = moved[k] || {P: r.P, pos: d.pos, rt: d.rates[0], sply_ty: sply, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
          ["txval", "iamt", "camt", "samt", "csamt"].forEach(f => { m[f] = r2(m[f] + num(d[f])); });
        }
      }
    });
    const inner = {b2b: "inv", b2ba: "inv", b2cl: "inv", b2cla: "inv", exp: "inv", expa: "inv", cdnr: "nt", cdnra: "nt"};
    Object.keys(groups).forEach(sec => {
      const list = out[sec] = out[sec] || [];
      Object.values(groups[sec]).forEach(g => {
        const key = Object.keys(g).find(k => k !== "list"), hit = list.find(x => x[key] === g[key]);
        if (hit) hit[inner[sec]] = (hit[inner[sec]] || []).concat(g.list);
        else { const o = {}; o[key] = g[key]; o[inner[sec]] = g.list; list.push(o); }
      });
    });
    // table 10 comes from the B2C small rows above: the month's revised figures, whatever moved in or out
    return p;
  },
  // keep a GSTR-1 JSON as filed: one per registration and month
  keep(json, source, extra){
    const b = S.books, gstin = String(json.gstin || "").toUpperCase(), fp = String(json.fp || "");
    if (!/^\d{2}[A-Z0-9]{13}$/.test(gstin) || !/^\d{6}$/.test(fp)) throw new Error("This does not look like a GSTR-1 JSON: it needs a GSTIN and a period (fp).");
    b.filed = b.filed || {};
    const k = gstin + "|" + fp, old = b.filed[k];
    // a copy from the portal is not replaced by a later download from here; nor is a copy of a return known to be filed
    // (a filing date, or its ARN): it is what later amendments are measured against, and a download from the books
    // as they are now would hide every change made in Tally since
    if (old && source === "downloaded" && (old.source === "portal" || (!old.notFiled && this.proof(old.ym, gstin.slice(0, 2))))) return old;
    // a draft replaced by a newer download is kept behind it: the one filed is the last made by the filing date
    b.filed[k] = Object.assign({gstin, fp, ym: this.ymOf(fp), source, at: new Date().toISOString(), json, notFiled: false, prev: old && source === "downloaded" ? [{at: old.at, json: old.json}].concat(old.prev || []).slice(0, 3) : void 0}, extra || {});
    return b.filed[k];
  },
  // the first GSTR-1 still to be filed after a month: where changes to earlier months are reported
  nextOpen(ym, reg){
    const isFiled = m => !!this.proof(m, reg) || this.filed(reg).some(f => f.ym === m && !f.notFiled);
    let m = GSTR.nextYm(ym);
    for (let i = 0; i < 24 && isFiled(m); i++) m = GSTR.nextYm(m);
    return m;
  },
  // filed returns whose documents have changed in the books since (added, changed or deleted in Tally after filing):
  // the filed return stays as it is; the changes are the amendments waiting for the next return. An amendment already
  // reported in a later return, or one you chose to leave, is not counted
  drift(){
    const out = [], b = S.books || {}, m = b.meta || {};
    if (!(b.vouchers || []).length || !m.from || !m.to) return out;
    // only months the books hold whole: a month outside them is not "changed", just not brought in
    const inBooks = ym => String(m.from) <= ym + "01" && String(m.to).slice(0, 6) >= ym;
    const regs = new Set(this.filed().filter(f => !f.notFiled).map(f => String(f.gstin).slice(0, 2)));
    regs.forEach(reg => {
      const mine = this.filed(reg).filter(f => !f.notFiled), last = mine.map(f => f.ym).sort().pop();
      const N = this.nextOpen(last, reg);
      let p = null; try { p = this.pending(N, reg); } catch (e){ return; }
      const by = {};
      p.rows.filter(r => r.act !== "skip" && inBooks(r.P)).forEach(r => { by[r.P] = (by[r.P] || 0) + 1; });
      Object.keys(by).forEach(P => {
        const f = mine.find(x => x.ym === P) || mine[0], pr = this.proof(P, reg) || {};
        out.push({ym: P, reg, gstin: f.gstin, n: by[P], arn: pr.arn || "", on: pr.on || "", next: N});
      });
    });
    return out.sort((a, c) => a.ym.localeCompare(c.ym));
  },
  // one line for a warning
  driftLine(d){
    return "GSTR-1 for " + GSTR.label(d.ym) + " (" + d.gstin + ") was filed" + (d.arn ? " with ARN " + d.arn : "") + (d.on ? " on " + fmtDate(d.on) : "") +
      ". " + d.n + " document" + (d.n === 1 ? " has" : "s have") + " been added, changed or deleted in Tally since. The filed return is not changed: " +
      "the change" + (d.n === 1 ? " goes" : "s go") + " as amendments in " + GSTR.label(d.next) + "’s GSTR-1 (GST → Amendments).";
  },
  // the month's own return: the books now against the copy filed for it
  check(ym, reg){
    if (!reg || !ym) return null;
    const f = this.filed(reg).find(x => x.ym === ym && !x.notFiled);
    if (!f) return null;
    const filed = this.norm(f.json), books = this.norm(GSTR.toJson(ym, reg, {plain: true}));
    const rows = [];
    books.docs.forEach((d, k) => { const w = filed.docs.get(k); if (!w) rows.push({kind: d.kind, doc: d, changes: ["in the books, not in the filed return"]}); else { const c = this.changes(w, d); if (c.length) rows.push({kind: d.kind, doc: d, changes: c}); } });
    filed.docs.forEach((d, k) => { if (!books.docs.has(k) && (num(d.val) || num(d.txval))) rows.push({kind: d.kind, doc: d, changes: ["in the filed return, not in the books"]}); });
    const tot = m => { let t = 0; m.forEach(x => { t += num(x.txval); }); return r2(t); };
    let b2csF = 0, b2csB = 0; filed.b2cs.forEach(x => { b2csF += num(x.txval); }); books.b2cs.forEach(x => { b2csB += num(x.txval); });
    return {file: f, rows, filedTotal: r2(tot(filed.docs) + b2csF), booksTotal: r2(tot(books.docs) + b2csB), b2csF: r2(b2csF), b2csB: r2(b2csB)};
  },
  // GSTR-1A (section 37A, from the July 2024 period): after the month's GSTR-1 is filed and before its 3B
  can1a(ym, reg){
    const f = this.filed(reg).find(x => x.ym === ym && !x.notFiled), r = typeof GSTF === "object" ? GSTF.peek(ym, reg) : {};
    const qr = typeof GSTSet === "object" && GSTSet.typeOf(ym, reg) === "qrmp";
    return {period: ym >= "202407" && (!qr || GSTSet.isQEnd(ym)), qrmpMonth: qr && !GSTSet.isQEnd(ym), filed1: !!f, threeB: !!(r.r3b || r.snap), kept: !!(((S.books || {}).filed1a || {})[(f ? String(f.gstin).toUpperCase() + "|" + f.fp : "")]), due: typeof GSTF === "object" ? GSTF.due(ym, "r3b", reg) : ""};
  },
  json1a(ym, reg){
    const f = this.filed(reg).find(x => x.ym === ym && !x.notFiled); if (!f) return null;
    const out = {gstin: String(f.gstin).toUpperCase(), fp: f.fp};
    const p = this.addTo(out, ym, reg, true);
    return {json: out, rows: p.rows.filter(r => r.act !== "skip")};
  },
  keep1a(json){ const b = S.books; b.filed1a = b.filed1a || {}; const k = String(json.gstin).toUpperCase() + "|" + json.fp; b.filed1a[k] = {json, at: new Date().toISOString()}; return b.filed1a[k]; },
};
// GSTF (src/js/35-gst-filing.js)
const GSTF = {
  store(reg){ const b = S.books; b.gstFiled = b.gstFiled || {}; return b.gstFiled[reg || ""] = b.gstFiled[reg || ""] || {}; },
  rec(ym, reg){ const s = this.store(reg); return s[ym] = s[ym] || {}; },
  peek(ym, reg){ return (((S.books || {}).gstFiled || {})[reg || ""] || {})[ym] || {}; },
  // rule 37: credit on a bill not paid within 180 days of its date is reversed in the return of the month the 181st day falls in,
  // on the unpaid part, and taken back in the month it is paid (4(D)(1)). Only bills kept bill-wise in Tally can be followed.
  bills(reg){
    const b = S.books, key = reg + "|" + (b.vouchers || []).length + "|" + (b.mapV || 0);
    if (this._bills && this._bills.key === key && this._bills.v === b.vouchers) return this._bills.list;
    const bills = {};
    (b.vouchers || []).filter(v => !v.opt && !v.cancel).forEach(v => v.ent.forEach(e => (e.b || []).forEach(([name, type, amt]) => {
      if (!name) return;
      const k = e.l + "|" + name, x = bills[k] = bills[k] || {party: e.l, ref: name, billed: 0, pays: [], v: null, tax: {}};
      if (type === "New Ref" && amt > 0 && Books.isPurchase(v) && !Books.isRcm(v) && GSTR.regOf(v) === reg){
        x.billed = r2(x.billed + amt); x.v = v;
        // the invoice's full value, credited to the supplier on this voucher: the unpaid share is measured against it
        x.gross = r2(v.ent.filter(z => z.l === e.l && z.a > 0).reduce((a, z) => a + z.a, 0));
        v.ent.forEach(z => { const m = Books.ledgerOf(z.l); if (z.a < 0 && (m.kind === "gst" || m.kind === "gst_common") && m.side === "input"){ const h = String(m.tax || "").toLowerCase(); if (h) x.tax[h] = r2((x.tax[h] || 0) - z.a); } });
      } else if (amt < 0) x.pays.push({date: v.date, amt: -amt});
    })));
    const list = Object.values(bills).filter(x => x.v && Object.keys(x.tax).length && x.billed > 0).map(x => {
      const d0 = String(x.v.refDate || x.v.date), dt = new Date(Date.UTC(+d0.slice(0, 4), +d0.slice(4, 6) - 1, +d0.slice(6, 8) + 180));
      x.revYm = dt.toISOString().slice(0, 7).replace("-", ""); x.billDate = d0; return x; });
    this._bills = {key, v: b.vouchers, list};
    return list;
  },
  // what a supplier's ledger shows as owing at a month's end: credits less debits, opening balance included
  owing(reg){
    const b = S.books, key = (b.vouchers || []).length + "|" + (b.mapV || 0);
    if (!this._owe || this._owe.key !== key || this._owe.v !== b.vouchers){
      const by = {};
      (b.vouchers || []).filter(v => !v.opt && !v.cancel).forEach(v => v.ent.forEach(e => { (by[e.l] = by[e.l] || []).push([String(v.date).slice(0, 6), e.a]); }));
      Object.values(by).forEach(l => l.sort((a, c) => a[0].localeCompare(c[0])));
      this._owe = {key, v: b.vouchers, by};
    }
    return (party, end) => { const op = num((((b.ledInfo || {})[party]) || {}).ob); let s2 = op; (this._owe.by[party] || []).forEach(([m, a]) => { if (m <= end) s2 += a; }); return Math.max(0, s2); };
  },
  rule37(ym, reg){
    const Z = () => ({igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}), rev = Z(), re = Z(), paidBy = (x, end) => x.pays.filter(p => String(p.date).slice(0, 6) <= end).reduce((a, p) => a + p.amt, 0);
    const put = (o, x, share, why) => { ["igst", "cgst", "sgst", "cess"].forEach(h => { o[h] = r2(o[h] + r2(num(x.tax[h]) * share)); }); o.n++; o.list.push({party: x.party, ref: x.ref, date: x.billDate, share: r2(share), why, tax: r2(Object.values(x.tax).reduce((a, v) => a + v, 0) * share)}); };
    // the books' months once, not once a bill (next-cloud-gst: 0.2 s a bill on a book of 40,000 entries)
    const owe = this.owing(reg), ms = GSTR.months();
    this.bills(reg).forEach(x => {
      if (x.revYm > ym) return;
      // a payment made on account, not against the bill, still pays it: never more unpaid than the ledger owes
      const unpaidAt = end => Math.max(0, Math.min(x.billed - paidBy(x, end), owe(x.party, end))) / Math.max(x.billed, x.gross || 0);
      const atRev = unpaidAt(x.revYm);
      if (atRev * Math.max(x.billed, x.gross || 0) < 1) return;
      if (x.revYm === ym) put(rev, x, atRev, (atRev < 0.01 ? "under 1%" : Math.round(atRev * 100) + "%") + " unpaid after 180 days");
      else {
        // paid in this month, after the reversal: that share comes back
        const prev = ms[ms.indexOf(ym) - 1] || x.revYm, before = unpaidAt(prev < x.revYm ? x.revYm : prev), now = unpaidAt(ym), back = r2(before - now);
        if (back > 0.0001) put(re, x, back, "paid in " + GSTR.label(ym));
      }
    });
    return {rev, re};
  },
  // a kept copy of the 3B as filed: its figures stand for the month in GSTR-9 and its credit left over is carried
  filed3b(ym, reg){ const r = this.peek(ym, reg); return r.snap || null; },
  // monthly filers: GSTR-1 by the 11th, GSTR-3B by the 20th of the next month
  // monthly: GSTR-1 by the 11th, 3B by the 20th of the next month. QRMP: GSTR-1 by the 13th and 3B by the 22nd or 24th
  // (by state) after the quarter; IFF by the 13th and PMT-06 by the 25th of the next month in the quarter's first two months.
  // Composition: CMP-08 by the 18th after the quarter.
  due(ym, which, reg){
    const t = typeof GSTSet === "object" ? GSTSet.typeOf(ym, reg || "") : "monthly", d = (m, day) => m.slice(0, 4) + "-" + m.slice(4, 6) + "-" + day;
    if (t === "monthly") return d(GSTR.nextYm(ym), which === "r1" ? "11" : "20");
    const qn = GSTR.nextYm(GSTSet.qEnd(ym));
    if (t === "comp") return which === "cmp08" ? d(qn, "18") : "";
    if (!GSTSet.isQEnd(ym)) return which === "iff" ? d(GSTR.nextYm(ym), "13") : which === "pmt06" ? d(GSTR.nextYm(ym), "25") : "";
    return d(qn, which === "r1" ? "13" : GSTSet.Q22.has(String(reg || "").slice(0, 2)) ? "22" : "24");
  },
  // whether the month has a GSTR-1 and a 3B of its own under the filing type
  files(ym, reg){ const t = typeof GSTSet === "object" ? GSTSet.typeOf(ym, reg || "") : "monthly"; return t === "monthly" || (t === "qrmp" && GSTSet.isQEnd(ym)); },
  days(a, b){ return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); },
  today(){ return new Date().toISOString().slice(0, 10); },
  fyOf(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m >= 4 ? y + "-" + String(y + 1).slice(2) : (y - 1) + "-" + String(y).slice(2); },
  // aggregate turnover of the year before, for the late fee caps: typed, else from the books (all registrations)
  aato(fy){
    const t = num(((S.books.gstAato || {})[fy]));
    if (t) return {v: t, from: "typed"};
    const y0 = +fy.slice(0, 4) - 1, months = GSTR.months().filter(m => m >= y0 + "04" && m <= (y0 + 1) + "03");
    if (months.length < 12) return {v: 0, from: months.length ? "part" : "none", n: months.length};
    let v = 0; months.forEach(m => GSTR.outward(m, "").forEach(r => { v += (r.kind === "CDNR" ? -1 : 1) * num(r.taxable); }));
    return {v: r2(v), from: "books"};
  },
  // late fee, section 47 as capped by notifications 19/2021 (3B) and 20/2021 (GSTR-1): Rs 50 a day (Rs 20 for a nil return),
  // half CGST and half SGST, capped at Rs 500 for nil, else Rs 2,000 / 5,000 / 10,000 by turnover
  // with no filing date typed, an estimate "if filed today" is given only for a month that has just fallen due
  unknown(due, filed){ return !filed && this.days(due, this.today()) > 45; },
  lateFee(ym, reg, which, nil){
    const r = this.peek(ym, reg), filed = r[which] || "", due = this.due(ym, which, reg), upto = filed || this.today(), d = Math.max(0, this.days(due, upto));
    if (!due) return {days: 0, fee: 0, due, filed, cap: 0, none: true};
    if (this.unknown(due, filed)) return {days: 0, fee: 0, due, filed, cap: 0, unknown: true};
    if (!d) return {days: 0, fee: 0, due, filed, cap: 0};
    const a = this.aato(this.fyOf(ym)), cap = nil ? 500 : !a.v ? 10000 : a.v <= 15000000 ? 2000 : a.v <= 50000000 ? 5000 : 10000;
    const fee = Math.min(d * (nil ? 20 : 50), cap);
    return {days: d, fee, cgst: fee / 2, sgst: fee / 2, due, filed, cap, capFrom: a.from, estimated: !filed};
  },
  // interest, section 50(1) with its proviso: 18% a year on the tax paid in cash, for the days after the due date
  interest(ym, reg, t){
    const r = this.peek(ym, reg), due = this.due(ym, "r3b", reg), upto = r.r3b || this.today(), d = !due || this.unknown(due, r.r3b) ? 0 : Math.max(0, this.days(due, upto));
    const cash = t.quarter ? t.cashAfter : t.pay.cash, heads = {};
    ["igst", "cgst", "sgst", "cess"].forEach(h => { heads[h] = r2(num(cash[h]) * 0.18 * d / 365); });
    return {days: d, due, filed: r.r3b || "", heads, total: r2(heads.igst + heads.cgst + heads.sgst + heads.cess), estimated: !r.r3b};
  },
  snapOf(t){ const c = JSON.parse(JSON.stringify(t)); ["held", "released", "cn2b", "rejBack", "custRej", "r37"].forEach(k => { if (c[k] && c[k].list) delete c[k].list; if (c[k] && c[k].add) { delete c[k].add.list; delete c[k].back.list; } if (c[k] && c[k].rev){ delete c[k].rev.list; delete c[k].re.list; } }); delete c.unregPos; return c; },
  // DRC-01B (rule 88C): liability in GSTR-1 higher than paid in 3B; DRC-01C (rule 88D): credit in 3B above 2B.
  // The portal intimates when the difference passes its limit; the limit is set here as notified, and the difference is always shown.
  LIM: {b: {amt: 2500000, pct: 20}, c: {amt: 500000, pct: 20}},
  drc(ym, reg, t){
    const tax = x => r2(num(x.igst) + num(x.cgst) + num(x.sgst) + num(x.cess));
    const filed = !t.quarter && typeof GSTAmend === "object" ? GSTAmend.filed(reg).find(f => f.ym === ym && !f.notFiled) : null;
    let r1 = null, r1From = "books";
    if (filed){ r1From = "filed"; const n = GSTAmend.norm(filed.json); let s = 0; n.docs.forEach(d => { s += (d.kind === "CDNR" && d.nt === "C" ? -1 : 1) * r2(num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt)); }); n.b2cs.forEach(d => { s += num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt); }); r1 = r2(s); }
    if (r1 == null) r1 = r2(tax(t.sale) - tax(t.cn) + tax(t.zero) + tax(t.adv));
    // 3.1(a) and (b) as they go in 3B (advances in both; our credit notes rejected by customers add to 3B only)
    const r3 = r2(tax(t.net) - (t.custRej ? tax(t.custRej.add) - tax(t.custRej.back) : 0) + tax(t.zero));
    const gapB = r2(r1 - r3), limB = Math.max(this.LIM.b.amt, r1 * this.LIM.b.pct / 100);
    let avl = 0, have2b = false;
    (typeof GST2B === "object" ? GST2B.all2b(reg) : []).filter(x => x.ym === ym).forEach(x => { have2b = true; x.rows.filter(r => r.itcavl !== "N" && !r.rej && !r.rcm && r.sec !== "impg" && r.sec !== "isd" && r.sec !== "isda").forEach(r => { avl += r.dir * (num(r.igst) + num(r.cgst) + num(r.sgst) + num(r.cess)); }); });
    avl = r2(avl);
    const claimed = tax(t.other), gapC = r2(claimed - avl), limC = Math.max(this.LIM.c.amt, avl * this.LIM.c.pct / 100);
    return {b: {r1, r3, gap: gapB, lim: r2(limB), flag: gapB > limB, from: r1From}, c: {have2b, avl, claimed, gap: gapC, lim: r2(limC), flag: have2b && gapC > limC}};
  },
  // section 34(2): a credit note reduces tax only if issued by 30 November after the year of the invoice
  lateCn(ym, reg){
    const out = [];
    (S.books.vouchers || []).forEach(v => {
      if (!Books.isSale(v) || v.opt || !/CREDIT NOTE/i.test(v.type) || (ym && GSTR.ym(v.date) !== ym) || (reg && GSTR.regOf(v) !== reg)) return;
      const od = String(v.refDate || ""); if (!/^\d{8}$/.test(od)) return;
      const fyEnd = +od.slice(4, 6) >= 4 ? +od.slice(0, 4) + 1 : +od.slice(0, 4), lim = fyEnd + "1130";
      if (String(v.date) > lim) out.push({no: v.no, party: v.party, date: v.date, orig: v.ref, origDate: od, lim});
    });
    return out;
  },
  // e-invoices made from Tally: once any voucher of the registration carries an IRN, invoices to registered customers without
  // one are listed, and so are IRNs taken more than 30 days after the invoice (the limit for turnover of Rs 10 crore and above)
  einv(ym, reg){
    const mode = typeof GSTSet === "object" ? GSTSet.einvMode(reg) : "auto";
    const vs = (S.books.vouchers || []).filter(v => Books.isSale(v) && !v.opt && (!reg || GSTR.regOf(v) === reg));
    if (mode !== "auto" || !vs.some(v => v.irn)) return {uses: false, missing: [], late: [], mode};
    const iso = d => { const x = String(d || "").replace(/-/g, ""); return x.slice(0, 4) + "-" + x.slice(4, 6) + "-" + x.slice(6, 8); };
    const kinds = new Set(["B2B", "EXP", "CDNR", "DBNR"]), byId = new Map(vs.map(v => [v.id, v]));
    const out = GSTR.outward(ym, reg).filter(r => kinds.has(r.kind) && (r.gstin || r.kind === "EXP"));
    const missing = out.filter(r => !(byId.get(r.id) || {}).irn).map(r => ({no: r.no, party: r.party}));
    const late = out.map(r => byId.get(r.id)).filter(v => v && v.irn && /^\d{8}$/.test(String(v.irnDate || "").replace(/-/g, "").slice(0, 8)))
      .filter(v => this.days(iso(v.date), iso(String(v.irnDate).replace(/-/g, "").slice(0, 8))) > 30).map(v => ({no: v.no, party: v.party}));
    return {uses: true, missing, late};
  },
  // the month's set-off and cash payment as one journal for Tally: output tax debited, input tax and the cash ledger credited
  journal(ym, reg){
    const t = GSTR.threeB(ym, reg), P = t.pay, H = ["igst", "cgst", "sgst", "cess"], lines = [], rec = this.peek(ym, reg);
    const led = (kind, head, side, rcm) => { const e = Object.entries(S.books.map || {}).filter(([, m]) => m.kind === kind && (m.tax === head || (rcm && !m.tax) || (rcm && !head)) && (!m.reg || m.reg === reg) && m.side === side && !!m.rcm === !!rcm).sort((a, c) => (c[1].tax ? 1 : 0) - (a[1].tax ? 1 : 0) || (c[1].n || 0) - (a[1].n || 0)); // a reverse-charge ledger of another head: asked once with no head; nothing there → null (listed as missing), not asked again
      if (!e.length && rcm && head) return led(kind, "", side, true);
      return e.length ? e[0][0] : null; };
    const cashL = (S.books.gstCashLedger || {})[reg] || rec.cashLedger || (reg + " GST ELECTRONIC CASH LEDGER"), missing = [];
    const add = (l, dr, cr, what) => { if (!r2(dr) && !r2(cr)) return; if (!l){ missing.push(what); return; }
      const o = lines.find(z => z.l === l && (dr ? z.dr : z.cr)); if (o){ o.dr = r2(o.dr + r2(dr)); o.cr = r2(o.cr + r2(cr)); } else lines.push({l, dr: r2(dr), cr: r2(cr)}); };
    H.forEach(to => {
      const HU = to.toUpperCase(), used = H.reduce((a, from) => a + num((P.use[from] || {})[to]), 0), cashTo = r2(num(P.cash[to]) - num((P.rcmCash || {})[to]));
      add(led("gst", HU, "output"), used + cashTo, 0, HU + " output ledger");
    });
    H.forEach(from => { const HU = from.toUpperCase(), used = Object.values(P.use[from] || {}).reduce((a, v) => a + num(v), 0); if (used) add(led("gst", HU, "input"), 0, used, HU + " input ledger"); });
    H.forEach(h => { const rc = num((P.rcmCash || {})[h]); if (rc) add(led("gst", h.toUpperCase(), "output", true), rc, 0, h.toUpperCase() + " reverse charge payable ledger"); });
    const cash = r2(H.reduce((a, h) => a + num(P.cash[h]), 0));
    if (cash) lines.push({l: cashL, dr: 0, cr: cash});
    // rounding: keep the voucher balanced
    // paise only: a larger difference means a ledger is missing, and the journal is not offered as balanced
    const d = r2(lines.reduce((a, l) => a + l.dr - l.cr, 0)); if (Math.abs(d) >= 0.01 && Math.abs(d) < 1 && lines.length) lines[lines.length - 1].cr = r2(lines[lines.length - 1].cr + d);
    const balanced = Math.abs(r2(lines.reduce((a, l) => a + l.dr - l.cr, 0))) < 0.01;
    const nx = (GSTR.nextYm ? GSTR.nextYm(ym) : CustIMS.nextYm(ym));
    const date = rec.r3b ? rec.r3b.replace(/-/g, "") : (this.due(ym, "r3b", reg) || (nx + "-20")).replace(/-/g, "");
    return {balanced, date, narr: "GSTR-3B " + GSTR.label(ym) + ": tax set off against input tax credit and paid in cash (sections 49, 49A; rule 88A)", lines, missing, cash, cashL};
  },
};
// GSTQ (src/js/37-gst-periodic.js)
const GSTQ = {
  H: ["igst", "cgst", "sgst", "cess"],
  z(){ return {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0}; },
  add(a, x){ const o = Object.assign({}, a); ["taxable", "igst", "cgst", "sgst", "cess", "n", "total", "ineligible"].forEach(k => { if (x && x[k] != null && typeof x[k] === "number") o[k] = r2(num(o[k]) + x[k]); }); return o; },
  months(qEnd){ const all = GSTR.months(); return GSTR.expand(GSTSet.qStart(qEnd) + "-" + qEnd).filter(m => all.includes(m)); },
  // ---- QRMP ----
  // 3B for the quarter: the three months added together, the credit set off once at the end,
  // and what was deposited by PMT-06 in the first two months used before any more cash is asked for
  threeBQ(qEnd, reg){
    const ms = this.months(qEnd), ts = ms.map(m => GSTR.threeBm(m, reg)), sum = k => ts.reduce((a, t) => this.add(a, t[k] || {}), this.z());
    const keys = ["sale", "cn", "net", "adv", "zero", "nil", "nongst", "rcmOut", "rcmIn", "toUnreg", "impGoods", "impServ", "other", "blocked", "buy", "itc", "reversal", "rev1", "rev2", "reclaim", "na", "rules", "r42", "r43", "held", "released", "cn2b", "rejBack", "netItc"];
    const t = {quarter: true, months: ms, qEnd, basis: (ts[ts.length - 1] || {}).basis || "no 2B"};
    keys.forEach(k => { t[k] = sum(k); });
    t.inw5 = ts.reduce((a, x) => { Object.keys(x.inw5 || {}).forEach(k => { a[k] = r2((a[k] || 0) + num(x.inw5[k])); }); return a; }, {});
    const up = {}; ts.forEach(x => (x.unregPos || []).forEach(p => { const o = up[p.pos] = up[p.pos] || {pos: p.pos, taxable: 0, igst: 0}; o.taxable = r2(o.taxable + p.taxable); o.igst = r2(o.igst + p.igst); }));
    t.unregPos = Object.values(up).sort((a, c) => a.pos.localeCompare(c.pos));
    t.custRej = {add: ts.reduce((a, x) => this.add(a, (x.custRej || {}).add || {}), this.z()), back: ts.reduce((a, x) => this.add(a, (x.custRej || {}).back || {}), this.z())};
    t.r37 = {rev: ts.reduce((a, x) => this.add(a, (x.r37 || {}).rev || {}), this.z()), re: ts.reduce((a, x) => this.add(a, (x.r37 || {}).re || {}), this.z())};
    t.ineligible = r2(ts.reduce((a, x) => a + num(x.ineligible), 0));
    t.opening = GSTR.creditIn(ms[0] || qEnd, reg);
    t.pay = GSTR.setOff(t.net, t.rcmOut, t.netItc, t.opening);
    // PMT-06 deposits of the quarter's first two months are in the cash ledger: they pay first
    const dep = this.deposited(qEnd, reg); t.pmt = dep;
    t.cashAfter = {}; t.pmtLeft = {};
    this.H.forEach(h => { t.cashAfter[h] = r2(Math.max(0, num(t.pay.cash[h]) - num(dep[h]))); t.pmtLeft[h] = r2(Math.max(0, num(dep[h]) - num(t.pay.cash[h]))); });
    t.payable = r2(this.H.reduce((a, h) => a + t.cashAfter[h], 0));
    return t;
  },
  deposited(qEnd, reg){ const d = {igst: 0, cgst: 0, sgst: 0, cess: 0}; GSTR.expand(GSTSet.qStart(qEnd) + "-" + qEnd).filter(m => m !== qEnd).forEach(m => { const p = (GSTF.peek(m, reg).pmt06 || {}); this.H.forEach(h => { d[h] = r2(d[h] + num(p[h])); }); }); return d; },
  // PMT-06 for a quarter's first or second month. Fixed sum: 35% of the cash paid in the last quarter's 3B,
  // or all of the cash paid in the last month if that was a monthly return. Self-assessment: the month's tax after its credit.
  pmt06(ym, reg){
    const rec = GSTF.peek(ym, reg), method = rec.pmtMethod || GSTSet.peek(reg).pmt || "fixed", prevEnd = this.prevYm(GSTSet.qStart(ym)), have = GSTR.months().includes(prevEnd);
    let amt = {igst: 0, cgst: 0, sgst: 0, cess: 0}, why = "", known = true;
    if (method === "fixed"){
      if (!have){ known = false; why = "the return before this quarter is not in the books; the portal shows the amount"; }
      else { const prevQ = GSTSet.typeOf(prevEnd, reg) === "qrmp", t = GSTR.threeB(prevEnd, reg), f = prevQ ? 0.35 : 1;
        this.H.forEach(h => { amt[h] = Math.round(num(t.pay.cash[h]) * f); });
        why = prevQ ? "35% of the cash paid in the 3B for " + GSTSet.qLabel(prevEnd) : "the cash paid in the 3B for " + GSTR.label(prevEnd) + " (a monthly return)"; }
    } else { const t = GSTR.threeBm(ym, reg); this.H.forEach(h => { amt[h] = Math.max(0, Math.round(num(t.pay.cash[h]))); }); why = "the month\u2019s tax less its credit"; }
    const total = this.H.reduce((a, h) => a + amt[h], 0), paid = rec.pmt06 || {};
    return {method, amt, total, why, known, due: GSTF.due(ym, "pmt06", reg), paid, paidTotal: r2(this.H.reduce((a, h) => a + num(paid[h]), 0))};
  },
  prevYm(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 1 ? (y - 1) + "12" : y + String(m - 1).padStart(2, "0"); },
  // IFF: the month's invoices and notes to registered customers, optional, at most Rs 50 lakh of value a month;
  // above that, documents go in date order up to the limit and the rest wait for the quarter's GSTR-1
  LIMIT: 5000000,
  key(ctin, num){ return String(ctin || "").toUpperCase() + "|" + GST2B.normNo(num); },
  iff(ym, reg){
    const j = GSTR.toJson(ym, reg, {plain: true}), out = {gstin: j.gstin, fp: j.fp, version: j.version, hash: j.hash};
    const docs = [], dt = d => { const p = String(d || "").split("-"); return p.length === 3 ? p[2] + p[1] + p[0] : ""; };
    (j.b2b || []).forEach(g => (g.inv || []).forEach(i => docs.push({sec: "b2b", ctin: g.ctin, g, x: i, num: i.inum, d: dt(i.idt), val: num(i.val)})));
    (j.cdnr || []).forEach(g => (g.nt || []).forEach(i => docs.push({sec: "cdnr", ctin: g.ctin, g, x: i, num: i.nt_num, d: dt(i.nt_dt), val: num(i.val)})));
    docs.sort((a, c) => a.d.localeCompare(c.d) || String(a.num).localeCompare(String(c.num)));
    // request of 02-Oct-2026: no longer cut at Rs 50 lakh (the Jan-2026 IFF of Testing AAD went through at 55,53,800 of
    // taxable value); above the limit the screen warns, and the documents can still go in the quarter's GSTR-1 instead
    const sg = x => x.sec === "cdnr" && String(x.x.ntty || "C").toUpperCase() === "C" ? -1 : 1;
    docs.forEach(x => { x.txval = r2((x.x.itms || []).reduce((a, it) => a + num((it.itm_det || {}).txval), 0)); x.s = sg(x); });
    let run = 0; const inc = docs.slice(), left = [];
    inc.forEach(x => { run += x.val; });
    const group = (sec, inner) => { const m = new Map(); inc.filter(x => x.sec === sec).forEach(x => { const o = m.get(x.ctin) || Object.assign({}, x.g, {[inner]: []}); o[inner].push(x.x); m.set(x.ctin, o); }); return Array.from(m.values()); };
    const b2b = group("b2b", "inv"), cdnr = group("cdnr", "nt"); if (b2b.length) out.b2b = b2b; if (cdnr.length) out.cdnr = cdnr;
    const taxOf = x => (x.x.itms || []).reduce((a, it) => { const d = it.itm_det || {}; return a + num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt); }, 0);
    const taxable = r2(inc.reduce((a, x) => a + x.s * x.txval, 0));
    return {json: out, keys: inc.map(x => this.key(x.ctin, x.num)), n: inc.filter(x => x.sec === "b2b").length, notes: inc.filter(x => x.sec === "cdnr").length,
      val: r2(run), taxable, tax: r2(inc.reduce((a, x) => a + x.s * taxOf(x), 0)), all: docs.length, allVal: r2(docs.reduce((a, x) => a + x.val, 0)), left: left.length,
      over: taxable > this.LIMIT, docs: inc.map(x => ({key: this.key(x.ctin, x.num), sec: x.sec, ctin: x.ctin, num: x.num, d: x.d, val: r2(x.val), txval: x.txval, tax: r2(taxOf(x))}))};
  },
  // GSTR-1 for the quarter: everything in it, less the invoices and notes already sent in an IFF
  r1Q(qEnd, reg){
    // the documents sent in each IFF filed: as recorded when it was downloaded, else worked out again the same way
    const qs = GSTSet.qStart(qEnd), j = GSTR.toJson(qs + "-" + qEnd, reg), skip = new Set(GSTR.expand(qs + "-" + qEnd).filter(m => m !== qEnd && this.iffFiled(m, reg)));
    const sent = new Set(); skip.forEach(m => { const r = GSTF.peek(m, reg); (r.iffDocs ? Object.keys(r.iffDocs) : r.iffKeys || this.iff(m, reg).keys).forEach(k => sent.add(k)); });
    if (sent.size){
      if (j.b2b) j.b2b = j.b2b.map(g => Object.assign({}, g, {inv: g.inv.filter(i => !sent.has(this.key(g.ctin, i.inum)))})).filter(g => g.inv.length);
      if (j.cdnr) j.cdnr = j.cdnr.map(g => Object.assign({}, g, {nt: g.nt.filter(i => !sent.has(this.key(g.ctin, i.nt_num)))})).filter(g => g.nt.length);
      if (j.b2b && !j.b2b.length) delete j.b2b; if (j.cdnr && !j.cdnr.length) delete j.cdnr;
    }
    return {json: j, skipped: Array.from(skip)};
  },
  // an IFF counts only when it was filed (a filing date or its ARN) by its due date: the portal closes it after the 13th.
  // "IFF not filed" (iffSkip) says so on purpose: its documents go in the quarter's GSTR-1
  iffFiled(ym, reg){ return this.iffState(ym, reg).s === "filed"; },
  iffState(ym, reg){
    const r = GSTF.peek(ym, reg), due = GSTF.due(ym, "iff", reg), v = typeof GSTV === "object" ? GSTV.copies(reg, "iff", ym)[0] : null;
    const on = r.iff || (v && v.arnDate) || "", arn = r.iffArn || (v && v.arn) || "";
    if (r.iffSkip) return {s: "skipped", due, on: "", arn: ""};
    if (on && on > due) return {s: "late", due, on, arn};
    if (on || arn) return {s: "filed", due, on, arn};
    return {s: GSTF.today() > due ? "missed" : "open", due, on: "", arn: ""};
  },
  // the documents of a filed IFF, as they were when it was filed, against the books now: a document changed or gone
  // since needs an amendment in a later GSTR-1 (table 9A for an invoice, 9C for a note); one added since goes in the
  // quarter's GSTR-1 as a new document
  iffChanges(ym, reg){
    const was = GSTF.peek(ym, reg).iffDocs; if (!was) return null;
    const now = new Map(this.iff(ym, reg).docs.map(x => [x.key, x])), changed = [], gone = [], added = [];
    Object.entries(was).forEach(([k, x]) => { const n = now.get(k); if (!n) gone.push(Object.assign({key: k}, x));
      else if (Math.abs(num(n.txval) - num(x.txval)) >= 0.5 || Math.abs(num(n.tax) - num(x.tax)) >= 0.5) changed.push(Object.assign({key: k, was: x}, n)); });
    now.forEach((n, k) => { if (!was[k]) added.push(n); });
    return {changed, gone, added, n: changed.length + gone.length};
  },
  // the documents of the IFF recorded when it is marked filed (a date or ARN typed, or the PDF kept)
  iffSnap(ym, reg){ const r = GSTF.rec(ym, reg); if (r.iffDocs) return false; const f = this.iff(ym, reg); r.iffDocs = {}; f.docs.forEach(x => { r.iffDocs[x.key] = {sec: x.sec, num: x.num, d: x.d, txval: x.txval, tax: x.tax}; }); r.iffSnapAt = new Date().toISOString(); return true; },
  // the quarter on one page (request of 02-Oct-2026): the first and second months' IFF, the third month's GSTR-1 for the
  // quarter (what the IFFs did not carry), and the quarter: counts, taxable value net of notes, tax, status, the figures as
  // filed (the PDFs, or typed), PMT-06; and the check that the quarter's total is 3B 3.1(a)
  quarter(qEnd, reg){
    const qs = GSTSet.qStart(qEnd), ms = GSTR.expand(qs + "-" + qEnd), fx = (f, per) => typeof GSTX === "object" ? GSTX.fig(reg, f, per) : null;
    const cols = ms.filter(m => m !== qEnd).map(m => {
      const f = this.iff(m, reg), st = this.iffState(m, reg), fig = fx("iff", m), p = this.pmt06(m, reg), sent = st.s === "filed";
      return {m, kind: "iff", label: "IFF " + GSTR.label(m), due: st.due, state: st, n: f.n, notes: f.notes, b2c: 0, taxable: f.taxable, tax: f.tax, over: f.over,
        inFile: sent || st.s === "open", toQuarter: !sent && st.s !== "open", filed: fig && fig.tl ? fig.tl.taxable : null, filedSrc: fig ? fig.source : "",
        pmt: p, changes: this.iffChanges(m, reg), file: "IFF_" + (f.json.gstin || "") + "_" + f.json.fp + ".json"};
    });
    // the third month: the quarter's GSTR-1 less what the filed IFFs carried
    const r1 = this.r1Q(qEnd, reg), j = r1.json, cnt = k => (j[k] || []).reduce((a, g) => a + (g.inv || g.nt || []).length, 0);
    const tx = k => (j[k] || []).reduce((a, g) => a + (g.inv || g.nt || []).reduce((b, i) => b + (k === "cdnr" && String(i.ntty || "C").toUpperCase() === "C" ? -1 : 1) * (i.itms || []).reduce((c, it) => c + num((it.itm_det || {}).txval), 0), 0), 0);
    const b2cs = (j.b2cs || []).reduce((a, x) => a + num(x.txval), 0), b2cl = tx("b2cl"), exp = (j.exp || []).reduce((a, g) => a + (g.inv || []).reduce((b, i) => b + (i.itms || []).reduce((c, it) => c + num(it.txval), 0), 0), 0);
    const tax = k => (j[k] || []).reduce((a, g) => a + (g.inv || g.nt || []).reduce((b, i) => b + (k === "cdnr" && String(i.ntty || "C").toUpperCase() === "C" ? -1 : 1) * (i.itms || []).reduce((c, it) => { const d = it.itm_det || {}; return c + num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt); }, 0), 0), 0);
    const b2csTax = (j.b2cs || []).reduce((a, x) => a + num(x.iamt) + num(x.camt) + num(x.samt) + num(x.csamt), 0);
    // advances received and not yet invoiced (table 11A) less those adjusted against invoices (11B): in 3.1(a) too
    const advOf = k => (j[k] || []).reduce((a, g) => a + (g.itms || []).reduce((b, it) => b + num(it.ad_amt), 0), 0);
    // advances marked as adjusted with no invoice to the customer in the quarter: not in 11B (GSTAdv.month), listed apart
    let um = []; try { um = GSTAdv.ready() ? GSTAdv.month(qs + "-" + qEnd, reg).unmatched : []; } catch (e){ um = []; }
    const st3 = GSTF.peek(qEnd, reg), fig3 = fx("r1", qEnd);
    const m3 = {m: qEnd, kind: "r1", label: "GSTR-1 " + GSTSet.qLabel(qEnd), due: GSTF.due(qEnd, "r1", reg), state: {s: st3.r1 ? "filed" : GSTF.today() > GSTF.due(qEnd, "r1", reg) ? "missed" : "open", on: st3.r1 || "", arn: st3.r1Arn || ""},
      n: cnt("b2b"), notes: cnt("cdnr"), b2b: r2(tx("b2b")), cdnr: r2(tx("cdnr")), b2cs: r2(b2cs), b2cl: r2(b2cl), exp: r2(exp), b2c: r2(b2cs + b2cl),
      adv: r2(advOf("at") - advOf("txpd")), advAt: r2(advOf("at")), advTxpd: r2(advOf("txpd")), advUnmatched: um,
      taxable: r2(tx("b2b") + tx("cdnr") + b2cs + b2cl + exp + advOf("at") - advOf("txpd")), tax: r2(tax("b2b") + tax("cdnr") + tax("b2cl") + b2csTax), skipped: r1.skipped,
      filed: fig3 && fig3.tl ? fig3.tl.taxable : null, filedSrc: fig3 ? fig3.source : "", file: "GSTR1_" + (j.gstin || "") + "_" + j.fp + ".json"};
    // FinCom's total: the IFFs that carry their documents and the GSTR-1; 3B 3.1(a) worked out for the quarter
    const t = GSTR.threeB(qEnd, reg), fig3b = fx("r3b", qEnd);
    const total = r2(cols.filter(c => c.inFile).reduce((a, c) => a + c.taxable, 0) + m3.taxable);
    const filedParts = cols.map(c => c.filed).concat([m3.filed]), filedAll = filedParts.every(v => v != null);
    const filedTotal = filedAll ? r2(filedParts.reduce((a, v) => a + num(v), 0)) : null;
    const r3a = r2(t.net.taxable), r3aFiled = fig3b && fig3b.a ? num(fig3b.a.taxable) : null;
    return {qEnd, qs, label: GSTSet.qLabel(qEnd), cols, m3, total, r3a, diff: r2(total - r3a), filedTotal, r3aFiled, filedDiff: filedTotal != null && r3aFiled != null ? r2(filedTotal - r3aFiled) : null,
      threeB: t, pmtPaid: t.pmt, payable: t.payable, due3b: GSTF.due(qEnd, "r3b", reg), r3bOn: st3.r3b || "", file3b: "GSTR3B_" + ((GSTR.gstins(S.books) || []).find(x => !reg || x.slice(0, 2) === reg) || "") + "_" + qEnd.slice(4, 6) + qEnd.slice(0, 4) + ".json"};
  },
  // the filing type of one quarter only (request of 02-Oct-2026): the quarter's own line in the filing history, and the
  // type before it put back from the next quarter on
  setQuarterType(ym, reg, type){
    const qs = GSTSet.qStart(ym), next = this.nextYm(GSTSet.qEnd(ym)), before = GSTSet.typeOf(next, reg), st = GSTSet.store(reg);
    let h = (st.filing || []).filter(x => x.from !== qs);
    h.push({from: qs, type});
    if (!h.some(x => x.from === next)) h.push({from: next, type: before});
    h = h.sort((a, c) => a.from.localeCompare(c.from)).filter((x, i, a) => i === 0 || x.type !== a[i - 1].type);
    st.filing = h; GSTR._carry = null;
  },
  nextYm(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 12 ? (y + 1) + "01" : y + String(m + 1).padStart(2, "0"); },
  // ---- Composition ----
  RATES: {mfr: {l: "Manufacturer: 1% of turnover", r: 1, base: "all"}, trader: {l: "Trader: 1% of turnover of taxable supplies", r: 1, base: "taxable"}, rest: {l: "Restaurant: 5% of turnover", r: 5, base: "all"}, serv: {l: "Services (notification 2/2019): 6% of turnover", r: 6, base: "all"}},
  compCat(reg){ return GSTSet.peek(reg).comp || "trader"; },
  cmp08(qEnd, reg){
    const ms = this.months(qEnd), cat = this.RATES[this.compCat(reg)];
    let all = 0, taxable = 0, exempt = 0;
    ms.forEach(m => GSTR.outward(m, reg).forEach(r => { const s = r.kind === "CDNR" ? -1 : 1; all += s * num(r.taxable); if (r.cls === "taxable") taxable += s * num(r.taxable); else exempt += s * num(r.taxable); }));
    const turnover = r2(cat.base === "all" ? all : taxable), tax = r2(turnover * cat.r / 100), half = r2(tax / 2);
    const rcm = ms.reduce((a, m) => this.add(a, GSTR.threeBm(m, reg).rcmOut), this.z());
    const rec = GSTF.peek(qEnd, reg), due = GSTF.due(qEnd, "cmp08", reg), upto = rec.cmp08 || "", late = upto ? Math.max(0, GSTF.days(due, upto)) : 0;
    const payable = r2(tax + rcm.igst + rcm.cgst + rcm.sgst + rcm.cess), interest = r2(payable * 0.18 * late / 365);
    return {months: ms, cat, all: r2(all), taxable: r2(taxable), exempt: r2(exempt), turnover, tax, cgst: half, sgst: r2(tax - half), rcm, payable, due, filed: upto, late, interest};
  },
  gstr4(fy, reg){
    const y = +fy.slice(0, 4), ms = GSTR.months().filter(m => m >= y + "04" && m <= (y + 1) + "03");
    const t4 = {reg: this.z(), regRcm: this.z(), unregRcm: this.z(), imps: this.z()};
    ms.forEach(m => GSTR.inward(m, reg).forEach(r0 => { const r = GSTR.signedIn(r0), k = r.import && r.supply !== "Goods" ? "imps" : r.rcm ? (r.gstin ? "regRcm" : "unregRcm") : r.gstin ? "reg" : null; if (k) t4[k] = this.add(t4[k], Object.assign({}, r, {n: 1})); }));
    const quarters = Array.from(new Set(ms.map(m => GSTSet.qEnd(m)))).map(q => Object.assign({q, label: GSTSet.qLabel(q)}, this.cmp08(q, reg)));
    const sumQ = k => r2(quarters.reduce((a, x) => a + num(typeof x[k] === "object" ? 0 : x[k]), 0));
    return {fy, months: ms, t4, quarters, turnover: sumQ("turnover"), tax: sumQ("tax"), rcm: quarters.reduce((a, x) => this.add(a, x.rcm), this.z()), interest: sumQ("interest"), due: (y + 1) + "-06-30"};
  },
  apiMode(){ return ((S.books || {}).gstApi) || "save"; },
};
// GSTR (src/js/12-gstr-1-and-gstr-3b-worked-out-from-the-b.js)
const GSTR = {
  ym(d){ return String(d).slice(0, 6); },
  // the months of the books; with no day book, the year before and this year up to last month, so the GST tab works
  // from its registrations alone
  months(){
    const b = S.books;
    if (!b) return [];
    // next-mis-speed: the months of the entries found once per drawing or calculation (each month's credit carried in asked again)
    const f = () => Array.from(new Set((b.vouchers || []).map(v => this.ym(v.date)).filter(x => x.length === 6))).sort(), seen = typeof perRender === "function" ? perRender(this, "seen", f) : f();
    // every month from the books' first to their last, with or without entries (review of 01-Oct-2026: Apr-Jun 2026 were
    // missing because no entry fell in them)
    const m = [];
    if (seen.length){ let x = seen[0]; while (x <= seen[seen.length - 1] && m.length < 240){ m.push(x); x = this.nextYm(x); } }
    if (m.length || !this.gstins(b).length) return m;
    const d = new Date(), y = d.getFullYear(), mo = d.getMonth() + 1, fy = mo >= 4 ? y : y - 1, out = [];
    let x = (fy - 1) + "04"; const last = (mo === 1 ? (y - 1) + "12" : y + String(mo - 1).padStart(2, "0"));
    while (x <= last){ out.push(x); x = this.nextYm(x); }
    return out;
  },
  // the client's registrations: read from Tally, added in GST settings, and its own GSTIN
  gstins(b){
    b = b || S.books || {};
    const co = typeof CO === "function" ? CO() : null, own = co && (!b.cid || b.cid === co.id) ? String(co.gstin || "").toUpperCase().trim() : "";
    const all = [].concat(((b.meta || {}).gstins) || [], (b.gstRegs || []).map(r => r.gstin), /^\d{2}[A-Z0-9]{13}$/.test(own) ? [own] : []);
    return Array.from(new Set(all.map(g => String(g).toUpperCase()).filter(g => /^\d{2}[A-Z0-9]{13}$/.test(g))));
  },
  inP(date, per){ const m = String(date).slice(0, 6), p = String(per); return p.length > 6 ? m >= p.slice(0, 6) && m <= p.slice(7, 13) : m === p; },
  pStart(per){ return String(per).slice(0, 6); },
  pEnd(per){ const p = String(per); return p.length > 6 ? p.slice(7, 13) : p; },
  expand(per){ const out = []; let m = this.pStart(per); const e = this.pEnd(per); while (m <= e){ out.push(m); m = this.nextYm(m); } return out; },
  nextYm(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 12 ? (y + 1) + "01" : y + String(m + 1).padStart(2, "0"); },
  // a month as "Apr-2025" (the date format of the rest of FinCom, without the day)
  label(ym){ return fmtDate(ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-01").replace(/^\d+[-\s]/, ""); },
  regOf(v){
    let r = "";
    for (const e of v.ent){ const m = Books.ledgerOf(e.l); if ((m.kind === "gst" || m.kind === "gst_common" || m.kind === "ineligible") && m.reg){ if (r && r !== m.reg){ r = ""; break; } r = m.reg; } }
    return r || String(v.cmp || "").slice(0, 2);
  },
  // the entries of one month (build 193): from an index made once per drawing or calculation, not the whole year each time
  // the entries GST is worked out from. Optional entries are memoranda in Tally, not in the books, and never in a return
  // (review of 01-Oct-2026: GSTR-1 counted 13 Optional sales of one client, each also entered as a regular invoice: their
  // tax twice; the server's GST summary, which leaves them out, showed it). Cancelled entries are left out too (review of
  // 02-Oct-2026: as the server's summary and MIS do); table 13 counts their numbers on its own
  // next-mis-speed: the year's entries filtered only when the index is made, not at every ask for a month
  vIn(ym){
    if (typeof perRender !== "function" || !ym || String(ym).length !== 6) return (S.books.vouchers || []).filter(v => !v.opt && !v.cancel);
    return perRender(this, "byMonth", () => { const m = {}; this.vIn().forEach(v => { const k = String(v.date).slice(0, 6); (m[k] = m[k] || []).push(v); }); return m; })[ym] || [];
  },
  // next-gst-pos (the owner, a CA, 11-Nov-2026): the place of supply of a sale, as a state code, is "missing" only when it
  // cannot be known. In order: (1) the entry's own place of supply from Tally; (2) FinCom's own correction, typed under
  // GST › What to fix (b.gstPosFix, one of BOOKS_KEYS, so it is synced; Tally's, when it arrives, wins); (3) CGST and
  // SGST (or UTGST) charged: within the state, so the state of the registration the return is for; (4) the party's GSTIN,
  // on the entry or its ledger: that GSTIN's state; else "" (e.g. IGST to an unregistered buyer with no state).
  // {code, from: "tally"|"fincom"|"tax"|"gstin"|"", bad}: bad when the tax does not fit the place of supply known from
  // Tally, the correction or the party's GSTIN (CGST and SGST to another state, or IGST within the own state)
  posCode(p){ const x = String(p == null ? "" : p).trim(); if (/^\d{1,2}$/.test(x)) return x.padStart(2, "0"); if (/^\d{2}\b/.test(x)) return x.slice(0, 2); return STATE_CODES[x.toUpperCase().replace(/&/g, "AND").replace(/\s+/g, " ")] || ""; },
  posName(c){ return (typeof GST_STATES === "object" && GST_STATES[c]) || (Object.keys(STATE_CODES).find(k => STATE_CODES[k] === c) || c || ""); },
  posFix(id){ const f = ((S.books || {}).gstPosFix || {})[id]; return f && /^\d{2}$/.test(String(f.pos || "")) ? f : null; },
  posOfSale(o){
    const tally = this.posCode(o.pos), fix = this.posFix(o.id), own = String(o.own || ""), g = String(o.gstin || "").toUpperCase();
    const gs = /^\d{2}[A-Z0-9]{13}$/.test(g) && !/^(97|99)/.test(g) ? g.slice(0, 2) : "";
    const i = Math.abs(num(o.igst)) > 0.005, cs = Math.abs(num(o.cgst)) + Math.abs(num(o.sgst)) > 0.005;
    const known = tally || (fix && fix.pos) || gs, from = tally ? "tally" : fix ? "fincom" : "";
    const code = known && from ? known : cs && !i && own ? own : known, why = from || (cs && !i && own ? "tax" : gs ? "gstin" : "");
    const bad = !!(own && known && !o.zero && (cs && !i ? known !== own : i && !cs ? known === own : false));
    return {code, from: why, bad};
  },
  // one row per invoice and rate, from the sales side
  outward(ym, reg){
    const out = [];
    this.vIn(ym).forEach(v => { const r = this.outRow(v, ym, reg); if (r) out.push(r); });
    return out.concat(this.fromSales(ym)).sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // next-gst-share: one entry's row of outward (null when it has none): the body of outward, so entryShares (below) puts
  // an entry's share by the very same text
  outRow(v, ym, reg){
    const b = S.books;
    if (!Books.isSale(v)) return null;
    if (ym && !this.inP(v.date, ym)) return null;
    if (reg && this.regOf(v) !== reg) return null;
    const L = Books.lines(v);
    const tax = r2(L.tax.CGST + L.tax.SGST + L.tax.IGST);
    if (!L.taxable && !tax) return null;
    const note = /CREDIT NOTE/i.test(v.type) ? "credit" : /DEBIT NOTE/i.test(v.type) ? "debit" : "";
    const exp = /EXPORT/i.test(v.type);
    const parts = L.parts || [];
    const rate = parts.length === 1 ? parts[0].rate : L.taxable ? Books.snapRate(Math.round(tax / L.taxable * 10000) / 100) : 0;
    const cls = Books.supplyClass(v);
    // a consolidated B2C entry (many B2C sales in one, e.g. through a payment gateway) is reported in B2C small, as totals,
    // even inter-state above the limit: it is not one invoice (b2cSumWhy says by which rule). next-fix-b2cs-gstin (the
    // owner, a CA, 12-Nov-2026): so even when the voucher or its party ledger has a GSTIN (Tally puts the gateway's GSTIN
    // on the entry, the gateway being the party): that GSTIN is not a buyer's, so the row has none (sumGstin keeps it): no
    // B2B line to the gateway, no GSTIN check, and the place of supply as for an unregistered buyer, never the gateway's
    // state. Never a credit or debit note, an export, SEZ, exempt, nil or non-GST supply, or reverse charge
    const gstin0 = (v.gstin || "").toUpperCase(), gstinL = String((b.gstins || {})[v.party] || "").toUpperCase();
    const sum = !note && !exp && cls === "taxable" && !Books.isRcm(v) ? this.b2cSumWhy(v.id, v.party, v.no || v.ref) : "";
    const gstin = sum ? "" : gstin0;
    const interState = !!(gstin && v.cmp && gstin.slice(0, 2) !== String(v.cmp).slice(0, 2)) || (!gstin && v.pos && v.pos !== (b.stateOf || v.pos) && L.tax.IGST > 0);
    // B2C large: inter-state to an unregistered person above Rs 1 lakh from 1 August 2024 (Rs 2.5 lakh before)
    const b2cl = !gstin && L.tax.IGST > 0 && L.total > (String(v.date) >= "20240801" ? 100000 : 250000);
    const P = this.posOfSale({id: v.id, pos: v.pos, own: reg || this.regOf(v), gstin: sum ? "" : gstin || gstinL, igst: L.tax.IGST, cgst: L.tax.CGST, sgst: L.tax.SGST, zero: cls === "sez" || cls === "export" || exp});
    return Object.assign({id: v.id, date: v.date, no: v.no || v.ref || "", party: v.party, gstin, pos: P.code ? (P.from === "tally" ? v.pos : this.posName(P.code)) : "", posCode: P.code, posFrom: P.from, posBad: P.bad, posTally: v.pos || "",
      cls, rcm: Books.isRcm(v), hsn: (parts[0] && parts[0].hsn) || (v.hsn || [])[0] || "", supply: (parts[0] && parts[0].supply) || v.supply || "", eco: "", tcs: 0, parts, mixed: new Set(parts.map(q => q.rate)).size > 1,
      kind: note ? (note === "credit" ? "CDNR" : "DBNR") : cls === "export" ? "EXP" : (cls === "sez" && gstin) ? "B2B" : cls === "sez" ? "EXP" : (cls === "exempt" || cls === "nil" || cls === "nongst") ? "NIL" : gstin ? "B2B" : b2cl && !sum ? "B2CL" : "B2C", b2cSum: sum,
      taxable: L.taxable, cgst: L.tax.CGST, sgst: L.tax.SGST, igst: L.tax.IGST, cess: L.tax.CESS,
      rate, total: L.total, note, type: v.type, src: v.src === "bridge" ? "bridge" : "daybook"}, sum && (gstin0 || gstinL) ? {sumGstin: gstin0 || gstinL} : null);
  },
  // next-gst-b2cs-summary (the owner, a CA, 11-Nov-2026): a sales entry that books many B2C sales at once (one entry for a
  // payment gateway's or a marketplace's collections, "2026-27/155 to 2026-27/182") is a B2C summary: reported in B2CS (by
  // place of supply and rate, no invoice number), never as one B2C large invoice, and its number is not checked. Which
  // rule, in order: "entry" - marked so on GST > What to fix (b.gstPosFix[id].b2cs = {on: true}; {on: false} is "not a
  // summary" and wins over the others); "ledger" - the party ledger's switch "Consolidated B2C (summary of many sales)"
  // (b.map[party].b2cSum, FinCom's own, synced, never written to Tally); "range" - the number is a range (noRange). Only
  // for a taxable sale, not a note, export or reverse charge, with or without a GSTIN (next-fix-b2cs-gstin: the gateway's
  // GSTIN on the entry does not make it B2B; the caller sees to that); "" when none
  b2cSumWhy(id, party, no){
    const b = S.books || {}, f = ((b.gstPosFix || {})[id] || {}).b2cs;
    if (f && typeof f === "object") return f.on ? "entry" : "";
    if (((b.map || {})[party] || {}).b2cSum) return "ledger";
    return this.noRange(no) ? "range" : "";
  },
  // a voucher number that is a range of documents: "X155 to X182" (or "X155 to 182"), or "X155-X182" (a dash: the same
  // prefix on both sides, not empty, so "2026-27" or "LFE/25-26/001" is no range); the second number above the first.
  // {pre, from, to, n} (n: how many documents), or null
  noRange(no){
    const s = String(no || "").trim(), tail = x => { const m = /^(.*?)(\d+)$/.exec(x); return m ? {pre: m[1], n: m[2]} : null; };
    const seps = [/\s+to\s+/ig, /\s*[-\u2013]\s*/g];
    for (let k = 0; k < seps.length; k++){
      const re = seps[k]; let m;
      while ((m = re.exec(s))){
        const L = tail(s.slice(0, m.index)), R = tail(s.slice(m.index + m[0].length));
        if (!L || !R) continue;
        const same = R.pre.toUpperCase() === L.pre.toUpperCase();
        if (!(k === 0 ? same || !R.pre : same && L.pre)) continue;
        const a = Number(L.n), c = Number(R.n);
        if (c > a && c - a < 100000) return {pre: L.pre, from: L.pre + L.n, to: L.pre + R.n, n: c - a + 1};
      }
    }
    return null;
  },
  // invoices that came from a marketplace, kept in Sales
  fromSales(ym){
    const s = S.sales;
    if (!s || s.cid !== S.coId) return [];
    return (s.list || []).filter(v => v.source === "market" && v.status !== "ignored").map(v => {
      const x = v.x || {}, d = String(x.date || "").replace(/-/g, "");
      if (ym && !GSTR.inP(d, ym)) return null;
      const tax = r2(num(x.cgst) + num(x.sgst) + num(x.igst));
      const P = this.posOfSale({id: v.id, pos: x.placeOfSupply, own: String((this.gstins(S.books)[0]) || "").slice(0, 2), gstin: x.customerGstin, igst: x.igst, cgst: x.cgst, sgst: x.sgst});
      return {posCode: P.code, posFrom: P.from, posBad: P.bad, posTally: x.placeOfSupply || "", id: v.id, date: d, no: x.number || "", party: x.customerName || "", gstin: (x.customerGstin || "").toUpperCase(),
        pos: P.code ? (P.from === "tally" ? x.placeOfSupply : this.posName(P.code)) : "", cls: "taxable", rcm: false, hsn: x.hsn || "", supply: "", eco: x.ecommerce || "market", etin: this.ecoGstinOf(x.ecoGstin) || this.ecoGstinOf(x.ecommerce),
        tcs: num(x.tcs), kind: x.noteKind === "credit" ? "CDNR" : (x.customerGstin ? "B2B" : "B2C"), note: x.noteKind || "",
        taxable: num(x.taxable), cgst: num(x.cgst), sgst: num(x.sgst), igst: num(x.igst), cess: num(x.cess),
        rate: num(x.rate) || (num(x.taxable) ? Math.round(tax / num(x.taxable) * 10000) / 100 : 0), total: num(x.total)};
    }).filter(Boolean);
  },
  // an e-commerce operator's GSTIN as written on a sale ("" when it is not one: Amazon's report names the operator only)
  ecoGstinOf(g){ const x = String(g || "").toUpperCase().replace(/[^0-9A-Z]/g, ""); return /^\d{2}[A-Z0-9]{13}$/.test(x) ? x : ""; },
  // GSTR-1 table 14 (17-Oct-2026): supplies made through an e-commerce operator, by the operator's GSTIN (they are also in
  // tables 4 to 10; nothing goes to 3B from here).
  //   14(a), the operator collects tax (TCS) u/s 52: the month's sales through an operator, net of credit notes, once its
  //   GSTIN is known (an operator collects TCS: Amazon and Flipkart, or TCS on any of its documents; tcs says so). The GSTIN is the sale's own, else
  //   the one typed for that operator and registration (GST settings: GSTSet.store(reg).ecoGstin). An operator whose GSTIN
  //   is not known cannot go in the file: it is listed apart (missing), with its figures.
  //   14(b), the operator pays the tax u/s 9(5): FinCom has no record of such supplies, so it is always empty.
  // {a: [{etin, eco, n, suppval, igst, cgst, sgst, cess}], missing: [{eco, tcs, n, suppval, ...}], b: []}
  ECO_TCS: ["amazon", "flipkart"],
  eco14(ym, reg, g){
    g = g || this.one(ym, reg);
    const typed = typeof GSTSet === "object" ? (GSTSet.peek(reg).ecoGstin || {}) : {}, by = {};
    g.eco.forEach(r => { (by[r.eco] = by[r.eco] || []).push(r); });
    const z = (o) => Object.assign({n: 0, suppval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}, o);
    const add = (o, r) => { const sg = r.kind === "CDNR" ? -1 : 1; o.n++; o.suppval = r2(o.suppval + sg * num(r.taxable)); ["igst", "cgst", "sgst", "cess"].forEach(h => { o[h] = r2(o[h] + sg * num(r[h])); }); };
    const a = {}, missing = {};
    Object.keys(by).sort().forEach(eco => {
      const rs = by[eco], known = this.ecoGstinOf(typed[eco]);
      const tcs = this.ECO_TCS.includes(eco) || rs.some(r => num(r.tcs) > 0);
      rs.forEach(r => {
        const etin = r.etin || known;
        if (etin) add(a[etin] = a[etin] || z({etin, eco}), r);
        else add(missing[eco] = missing[eco] || z({eco, tcs}), r);
      });
    });
    return {a: Object.values(a).sort((x, c) => x.etin.localeCompare(c.etin)), missing: Object.values(missing), b: []};
  },
  // the purchase side, for the credit in 3B: every bill, and every journal or payment that takes input tax
  // (an expense booked in a journal, bank charges, reverse charge on rent); not the month's set-off,
  // and not tax only moved between ledgers (to a control account, or a rounding)
  // 3B input check (23-Oct-2026): an input ledger the books keep credit in until 2B shows the bill ("IGST INPUT NOT SHOWN
  // IN 2B", or under a group so named): no credit is taken on it; it is taken when the books move it to the input ledger.
  // A ledger set by hand (held true / false) is as set
  HELD: /NOT\s*(SHOWN|REFLECT\w*|APPEAR\w*)?\s*IN\s*(GSTR\s*-?\s*)?2\s*[AB]\b|ITC\s*(ON\s*HOLD|PENDING)|PENDING\s*ITC/i,
  held(l){ const m = Books.ledgerOf(l); if (m.held != null) return !!m.held; return m.kind === "gst" && m.side === "input" && (this.HELD.test(l) || ledGroupPath(S.books || {}, l).some(g => this.HELD.test(g))); },
  // the credit an entry other than a bill takes, head by head, from the debits and credits of the input ledgers (debit
  // more); the held ledger's lines apart (hold). Lines are netted, never added up: tax moved from the held ledger to
  // Input IGST is that month's credit once (Leads: 3 x 2,02,500 taken as 12,15,000 in Apr-2026)
  netIn(v){
    const n = {IGST: 0, CGST: 0, SGST: 0, CESS: 0, hold: 0, inel: 0, other: false, round: true, ro: false};
    v.ent.forEach(e => { const m = Books.ledgerOf(e.l), inp = ((m.kind === "gst" || m.kind === "gst_common") && m.side === "input") || m.kind === "ineligible";
      if (!inp){ if (m.kind === "roundoff") n.ro = true; else n.round = false; if (m.kind === "tax_other" || m.what === "gst_setoff" || ((m.kind === "gst" || m.kind === "gst_common") && m.side === "output" && !m.rcm)) n.other = true; return; }
      if (this.held(e.l)){ n.hold = r2(n.hold - e.a); return; }
      if (m.kind === "ineligible"){ n.inel = r2(n.inel - e.a); return; }
      (m.tax === "CGST+SGST" ? [["CGST", e.a / 2], ["SGST", e.a / 2]] : [[m.tax || "IGST", e.a]]).forEach(([h, a]) => { n[h] = r2(n[h] - a); }); });
    return n;
  },
  inward(ym, reg){
    const out = [];
    this.vIn(ym).forEach(v => { const r = this.inRow(v, ym, reg); if (r) out.push(r); });
    return out;
  },
  // next-gst-share: one entry's row of inward (null when it has none): the body of inward, for entryShares as outRow
  inRow(v, ym, reg){
    const b = S.books, gst = b.gstins || {};
    if (Books.isSale(v)) return null;
    if (ym && !this.inP(v.date, ym)) return null;
    const purch = Books.isPurchase(v);
    let inTax = false, outTax = false, signed = 0;
    v.ent.forEach(e => { const m = Books.ledgerOf(e.l);
      if (((m.kind === "gst" || m.kind === "gst_common") && m.side === "input") || m.kind === "ineligible"){ inTax = true; signed += e.a; }
      else if ((m.kind === "gst" || m.kind === "gst_common") && m.side === "output" && !m.rcm) outTax = true; });
    if (!purch && (!inTax || outTax)) return null;
    if (reg && this.regOf(v) !== reg) return null;
    // not a bill: the credit is the input ledgers' net (above). None left (a move between input ledgers, a bill or a
    // write-off on the held ledger): no credit. A set-off (with output tax or the GST payable or cash ledger) or a
    // rounding of the input ledgers is no purchase, so never negative credit
    // (a bill on the held ledger: the same, its credit waits)
    let ni = this.netIn(v); const none = ["IGST", "CGST", "SGST", "CESS", "inel"].every(h => Math.abs(ni[h]) < 0.005);
    if (purch && !ni.hold) ni = null;
    else if (purch ? none : (ni.other || (ni.round && ni.ro) || none)) return null;
    if (ni){ const s = r2(ni.IGST + ni.CGST + ni.SGST + ni.CESS); signed = s > 0 ? -1 : 1; }
    const L0 = Books.lines(v), d = signed < 0 ? 1 : -1;
    const L = ni ? Object.assign({}, L0, {tax: {IGST: r2(ni.IGST * d), CGST: r2(ni.CGST * d), SGST: r2(ni.SGST * d), CESS: r2(ni.CESS * d)}}) : L0;
    const tax = r2(L.tax.CGST + L.tax.SGST + L.tax.IGST + L.tax.CESS);
    const rcm = Books.isRcm(v);
    let party = v.party, gstin = String(v.gstin || gst[v.party] || "").toUpperCase(), taxable = L.taxable, parts = L.parts || [], guessed = false, taxOnly = false;
    if (!purch){
      // a journal or payment: the value is what sits on the same side as the tax
      if (!gstin){ const e = v.ent.find(x => gst[x.l]); if (e){ party = e.l; gstin = String(gst[e.l]).toUpperCase(); } }
      taxable = 0;
      v.ent.forEach(e => { if (e.l !== party && !Books.ledgerOf(e.l).kind && (e.a < 0) === (signed < 0)) taxable = r2(taxable + Math.abs(e.a)); });
      // an entry with only an input-tax line and no supplier GSTIN (a bank payment with only IGST) still takes input tax
      // (request of 02-Oct-2026: it was dropped here and in the server's summary); it is marked so the lists can say why
      // it can never be in 2B
      if (!taxable && !gstin && !rcm) taxOnly = true;
      if (!taxable && rcm){ const rt = num((String(v.narr || "").match(/@\s*(\d+(?:\.\d+)?)\s*%/) || [])[1]) || 18; taxable = r2((tax - L.tax.CESS) * 100 / rt); guessed = true; }
      const rt = taxable ? Books.snapRate(Math.round(r2(tax - L.tax.CESS) / taxable * 10000) / 100) : 0;
      parts = [{rate: rt, hsn: parts[0] ? parts[0].hsn : "", supply: v.supply || "", taxable, igst: L.tax.IGST, cgst: L.tax.CGST, sgst: L.tax.SGST, cess: L.tax.CESS, guessed}];
    } else if (ni) parts = [Object.assign({}, parts[0] || {}, {taxable, igst: L.tax.IGST, cgst: L.tax.CGST, sgst: L.tax.SGST, cess: L.tax.CESS})];
    if (!taxable && !tax) return null;
    return {id: v.id, date: v.date, no: Books.supInv(v), voucher: v.no || "", type: v.type, party, gstin, refDate: v.refDate || "",
      taxable, cgst: L.tax.CGST, sgst: L.tax.SGST, igst: L.tax.IGST, cess: L.tax.CESS, parts, valueGuessed: guessed, bill: purch,
      cls: Books.supplyClass(v), rcm, import: Books.isImport(v), supply: v.supply || (parts[0] && parts[0].supply) || "",
      blocked: !!v.ineligibleFlag, hsn: (parts[0] && parts[0].hsn) || (v.hsn || [])[0] || "",
      ineligible: L.ineligible || 0, common: L.common || null, dir: ni ? d : this.itcDir(v), note: (ni ? d : this.itcDir(v)) < 0 ? "debit" : "", narr: v.narr || "", taxOnly, fromHold: ni && ni.hold < 0 ? -ni.hold : 0, src: v.src === "bridge" ? "bridge" : "daybook"};
  },
  sum(rows){
    return rows.reduce((a, r) => ({n: a.n + 1, taxable: r2(a.taxable + num(r.taxable)), cgst: r2(a.cgst + num(r.cgst)),
      sgst: r2(a.sgst + num(r.sgst)), igst: r2(a.igst + num(r.igst)), cess: r2(a.cess + num(r.cess)),
      ineligible: r2(a.ineligible + num(r.ineligible))}), {n: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, ineligible: 0});
  },
  // GSTR-1, in the parts the return itself has
  one(ym, reg){
    const rows = this.outward(ym, reg);
    const part = k => rows.filter(r => r.kind === k);
    const byRate = list => {
      const m = {};
      this.partsOf(list).forEach(q => { const k = String(q.rate); (m[k] = m[k] || []).push(q); });
      return Object.entries(m).sort((a, c) => num(a[0]) - num(c[0])).map(([rate, rs]) => Object.assign({rate: num(rate)}, this.sum(rs)));
    };
    // the HSN summary, split into supplies to registered and unregistered persons as table 12 now asks;
    // a credit note takes its value off
    const hsnRows = {};
    this.partsOf(rows.filter(r => r.cls === "taxable" || r.cls === "export" || r.cls === "sez" || r.cls === "exempt" || r.cls === "nil")).forEach(q => {
      const key = (q.hsn || "no HSN") + "|" + q.rate, sg = q.row.kind === "CDNR" ? -1 : 1, reg2 = q.row.gstin ? "b2b" : "b2c";
      const h = hsnRows[key] = hsnRows[key] || {hsn: q.hsn || "", rate: q.rate, supply: q.supply, desc: q.desc || "", unit: q.unit || "", n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0,
        b2b: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0}, b2c: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0}};
      h.n++; ["taxable", "igst", "cgst", "sgst", "cess", "qty"].forEach(f => { h[f] = r2(h[f] + sg * num(q[f])); h[reg2][f] = r2(h[reg2][f] + sg * num(q[f])); });
      if (!h.supply) h.supply = q.supply; if (!h.desc) h.desc = q.desc || ""; if (!h.unit) h.unit = q.unit || "";
    });
    // documents issued (table 13), by nature: invoices 1, debit notes 4, credit notes 5; cancelled numbers counted in their series
    const series = {}, natOf = r => r.kind === "CDNR" ? 5 : r.kind === "DBNR" ? 4 : 1;
    // a B2C summary numbered as a range (noRange) counts the range's documents, "155 to 182" 28, in its series
    const inSeries = (no, nat, cancelled, last, many) => {
      const pre = String(no).replace(/\d+[A-Za-z]?$/, ""), k = nat + "|" + pre, sr = series[k] = series[k] || {nat, pre, from: no, to: last || no, n: 0, cancelled: 0};
      sr.n += many || 1; if (cancelled) sr.cancelled++;
      const key = x => pre + String(String(x).slice(pre.length)).padStart(12, "0");
      if (key(no) < key(sr.from)) sr.from = no;
      if (key(last || no) > key(sr.to)) sr.to = last || no;
    };
    rows.filter(r => r.no && !r.eco).forEach(r => { const g = r.b2cSum && this.noRange(r.no); if (g) inSeries(g.from, natOf(r), false, g.to, g.n); else inSeries(r.no, natOf(r), false); });
    ((S.books || {}).vouchers || []).filter(v => v.cancel && v.no && (!ym || this.inP(v.date, ym)) && Books.isSale(v) && (!reg || String(v.cmp || "").slice(0, 2) === reg || !v.cmp))
      .forEach(v => inSeries(v.no, /CREDIT NOTE/i.test(v.type) ? 5 : /DEBIT NOTE/i.test(v.type) ? 4 : 1, true));
    // the operator sales (table 14: eco14 below, the R1 portal screen); the old card's per-operator summary is gone (17-Oct-2026)
    const eco = rows.filter(r => r.eco);
    return {rows, eco, b2b: part("B2B"), b2cl: part("B2CL"), b2c: part("B2C"), cdnr: part("CDNR").concat(part("DBNR")),
      exp: part("EXP"), nil: part("NIL"), rcm: rows.filter(r => r.rcm),
      b2cRates: byRate(part("B2C")), hsn: Object.values(hsnRows).sort((a, c) => c.taxable - a.taxable),
      series: Object.values(series), total: this.sum(rows)};
  },
  // round 43: a credit or debit note to a buyer with no GSTIN goes in table 9B unregistered (cdnur) when the invoice it
  // changes is a B2C large one (inter-state, above the limit: typ B2CL) or an export (EXPWP / EXPWOP); otherwise it adjusts
  // B2C small. The invoice is not named on the note in the books: a B2C large invoice to the same buyer and place, on or
  // before the note, is taken as it
  cdnurTyp(r, all){
    if (r.gstin || !(r.kind === "CDNR" || r.kind === "DBNR")) return "";
    if (r.cls === "export") return r.igst ? "EXPWP" : "EXPWOP";
    if (!(r.igst > 0)) return "";
    const b2cl = (all || this.outward("", "")).filter(x => x.kind === "B2CL" && x.party === r.party && String(x.pos || "") === String(r.pos || "") && String(x.date) <= String(r.date));
    return b2cl.length ? "B2CL" : "";
  },
  // each row's rate and HSN parts; a row with none is one part at its own rate
  partsOf(rows){
    const out = [];
    rows.forEach(r => { const ps = r.parts && r.parts.length ? r.parts : [{rate: r.rate, hsn: r.hsn, supply: r.supply, taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess}];
      ps.forEach(q => out.push(Object.assign({}, q, {row: r, n: 1, ineligible: 0}))); });
    return out;
  },
  // GSTR-3B: what goes out, what comes in, and what is left to pay
  // which way a purchase-side voucher moves credit: input tax debited adds to it (a bill, or the supplier's debit note);
  // input tax credited takes it away (the supplier's credit note, or a return), whatever the voucher type is called
  itcDir(v){
    let signed = 0;
    v.ent.forEach(e => { const m = Books.ledgerOf(e.l); if (((m.kind === "gst" || m.kind === "gst_common") && m.side === "input") || m.kind === "ineligible") signed += e.a; });
    return signed > 0.004 ? -1 : signed < -0.004 ? 1 : (/DEBIT NOTE/i.test(v.type) ? -1 : 1);
  },
  signedIn(r){ return r.dir < 0 ? Object.assign({}, r, {taxable: -r.taxable, cgst: -r.cgst, sgst: -r.sgst, igst: -r.igst, cess: -r.cess, ineligible: -(r.ineligible || 0)}) : r; },
  // the differences the amendments reported in a month's GSTR-1 make to outward tax (round 43): {out, zero, rows}
  amendDiff(ym, reg){
    const z = () => ({taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}), res = {out: z(), zero: z(), rows: []};
    if (!reg || typeof GSTAmend !== "object" || !GSTAmend.filed(reg).length) return res;
    let p = null; try { p = GSTAmend.pending(ym, reg); } catch (e){ return res; }
    const pick = d => ({taxable: num(d && d.txval), igst: num(d && d.iamt), cgst: num(d && d.camt), sgst: num(d && d.samt), cess: num(d && d.csamt)});
    (p.rows || []).forEach(r => {
      if (r.act === "skip" || !(r.what === "amend" || (r.what === "gone" && r.act === "nil"))) return;
      const now = r.kind === "B2CS" ? pick(r.b2cs.now) : pick(r.now), was = r.kind === "B2CS" ? pick(r.was && {txval: r.was.txval, iamt: (r.was.iamt || 0)}) : pick(r.was);
      if (r.kind === "B2CS"){ const w = (GSTAmend.state(reg, ym).b2cs[r.P] || new Map()).get(r.b2cs.pos + "|" + r.b2cs.rt + "|" + r.b2cs.sply_ty); if (w) Object.assign(was, pick(w)); }
      const sg = r.kind === "CDNR" && ((r.now || r.was || {}).ntty || "C") === "C" ? -1 : 1;
      const zeroRated = r.kind === "EXP" || /^SEW/.test(String((r.now || r.was || {}).inv_typ || ""));
      const to = zeroRated ? res.zero : res.out;
      Object.keys(to).forEach(k => { to[k] = r2(to[k] + sg * (now[k] - was[k])); });
      res.rows.push({P: r.P, kind: r.kind, num: (r.now || r.was || {}).num, sign: sg});
    });
    return res;
  },
  // the 3B as filed for a month: a monthly filer's month, or at the end of a QRMP quarter the quarter's
  threeB(ym, reg){ return typeof perRender === "function" ? perRender(this, "3b|" + ym + "|" + (reg || ""), () => this.threeBNow(ym, reg)) : this.threeBNow(ym, reg); },
  threeBNow(ym, reg){
    if (typeof GSTSet === "object" && reg && GSTSet.typeOf(ym, reg) === "qrmp" && GSTSet.isQEnd(ym) && typeof GSTQ === "object") return GSTQ.threeBQ(ym, reg);
    return this.threeBm(ym, reg);
  },
  // next-gst-share: 3.1 (the books' part: before the advances, the amendments and the customers' IMS) and 3.2, of a
  // month's outward rows and its inward rows signed (signedIn): threeBm's own figures, and what the cloud's sums of
  // entryShares are checked against (gst-run's parity)
  sec31(out, inn){
    const S1 = f => this.sum(out.filter(f)), S2 = f => this.sum(inn.filter(f));
    const taxableOut = S1(r => r.cls === "taxable" && r.kind !== "CDNR");
    const cn = S1(r => r.kind === "CDNR");
    const zero = S1(r => r.cls === "export" || r.cls === "sez");
    const nil = S1(r => r.cls === "exempt" || r.cls === "nil");
    const nongst = S1(r => r.cls === "nongst");
    const rcmOut = S2(r => r.rcm || (r.import && r.supply !== "Goods"));   // 3.1(d): tax we pay on inward supplies, imported services included
    const toUnreg = S1(r => !r.gstin && r.igst > 0);                 // 3.2 inter-state to unregistered
    // 3.2: inter-state supplies to unregistered persons, place of supply by place of supply
    const posOf = r => r.posCode || "00";
    const unregPos = {};
    this.partsOf(out.filter(r => !r.gstin && r.igst > 0 && r.cls === "taxable")).forEach(q => { const r = q.row, k = posOf(r) || "97", sg = r.kind === "CDNR" ? -1 : 1, x = unregPos[k] = unregPos[k] || {pos: k, taxable: 0, igst: 0}; x.taxable = r2(x.taxable + sg * q.taxable); x.igst = r2(x.igst + sg * q.igst); });
    return {taxableOut, cn, zero, nil, nongst, rcmOut, toUnreg, unregPos: Object.values(unregPos).sort((a, c) => a.pos.localeCompare(c.pos))};
  },
  threeBm(ym, reg){
    const out = this.outward(ym, reg), inn = this.inward(ym, reg).map(r => this.signedIn(r));
    const S2 = f => this.sum(inn.filter(f));
    const P31 = this.sec31(out, inn), {taxableOut, cn, zero, nil, nongst, rcmOut, toUnreg} = P31;
    const rcmIn = S2(r => r.rcm && !r.import);                      // 4(A)(3): the credit of that tax, other than on imports
    const impGoods = S2(r => r.import && r.supply === "Goods");
    const impServ = S2(r => r.import && r.supply !== "Goods");
    let other = S2(r => !r.import && !r.rcm);
    const blocked = S2(r => r.blocked);
    // credit only as far as 2B shows it (section 16(2)(aa), rule 36(4)): bills not yet in 2B are held back,
    // and taken in the month their 2B carries them
    const basis = this.itcBasis(ym, reg), held = {igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}, released = {igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}, cn2b = {igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []}, rejBack = {igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0, list: []};
    if (basis.on){
      const add = (o, d) => { o.igst = r2(o.igst + d.igst); o.cgst = r2(o.cgst + d.cgst); o.sgst = r2(o.sgst + d.sgst); o.cess = r2(o.cess + d.cess); o.n++; o.list.push(d); };
      const vById = new Map((S.books.vouchers || []).map(v => [v.id, v]));
      // a bill the books hold ("NOT SHOWN IN 2B") took no credit: nothing to hold back or release (the books' move takes it)
      const claimable = d => d.dir > 0 && !d.rcm && !d.ineligible && !d.held && !(vById.get(d.id) && Books.isImport(vById.get(d.id)));
      basis.res.onlyBooks.filter(d => d.ym === ym && claimable(d)).forEach(d => add(held, d));
      basis.res.pairs.forEach(x => { if (x.p.ym > ym) x.books.filter(d => d.ym === ym && claimable(d)).forEach(d => add(held, d));
        if (x.p.ym === ym) x.books.filter(d => d.ym < ym && basis.loaded.has(d.ym) && this.itcBasis(d.ym, reg, true) && claimable(d)).forEach(d => add(released, d)); });
      // in both, but more tax in Tally than in 2B: the excess waits (the lower of the two is taken)
      basis.res.pairs.filter(x => x.status === "diff").forEach(x => {
        const bks = x.books.filter(d => d.ym === ym && claimable(d)); if (!bks.length || x.p.ym > ym) return;
        const bt = bks.reduce((a, d) => a + d.igst + d.cgst + d.sgst + d.cess, 0), pt = num(x.p.igst) + num(x.p.cgst) + num(x.p.sgst) + num(x.p.cess), ex = r2(bt - pt);
        if (ex < 1 || bt <= 0) return;
        const f = ex / bt; bks.forEach(d => add(held, {id: d.id, no: d.no, party: d.party, igst: r2(d.igst * f), cgst: r2(d.cgst * f), sgst: r2(d.sgst * f), cess: r2(d.cess * f), excess: true}));
      });
      // rejected in IMS: an invoice in Tally gives no credit (held, never released unless accepted again);
      // a credit note booked in Tally (as our debit note) does not reduce credit while it stays rejected
      (basis.res.rejected || []).forEach(x => { const dk = typeof ITCT === "object" ? ITCT.dec(reg, "R|" + x.p.key).act : "";
        if (dk === "accept") return;
        x.books.filter(d => !d.rcm && !d.ineligible && !d.held).forEach(d => {
          // in the month the bill was booked, if that month is on the 2B basis; else in the month of the 2B that shows the rejection
          const here = d.ym === ym || (x.p.ym === ym && d.ym < ym && !this.itcBasis(d.ym, reg, true));
          if (!here || (d.ym !== ym && d.ym > x.p.ym)) return;
          if (d.dir > 0) add(held, Object.assign({}, d, {rejected: true})); else if (x.p.ym === ym || d.ym === ym) add(rejBack, d); }); });
      // a supplier's credit note in this month's 2B, not in Tally, reduces credit unless it is rejected in IMS
      basis.res.only2b.filter(p => p.ym === ym && p.dir < 0 && p.itcavl !== "N" && (typeof ITCT !== "object" || ITCT.dec(reg, "P|" + p.gstin + "|" + p.noN + "|" + p.dir).act !== "reject")).forEach(p => add(cn2b, p));
      other = Object.assign({}, other, {igst: r2(other.igst - held.igst + released.igst - cn2b.igst + rejBack.igst), cgst: r2(other.cgst - held.cgst + released.cgst - cn2b.cgst + rejBack.cgst), sgst: r2(other.sgst - held.sgst + released.sgst - cn2b.sgst + rejBack.sgst), cess: r2(other.cess - held.cess + released.cess - cn2b.cess + rejBack.cess)});
    }
    // 4(D)(2): credit 2B says is not available (place of supply in another state, or after the section 16(4) time limit)
    const na = {igst: 0, cgst: 0, sgst: 0, cess: 0};
    (typeof GST2B === "object" ? GST2B.all2b(reg) : []).filter(t => t.ym === ym).forEach(t => t.rows.filter(r => r.itcavl === "N" && !r.rej).forEach(r => { ["igst", "cgst", "sgst", "cess"].forEach(k => { na[k] = r2(na[k] + r.dir * num(r[k])); }); }));
    const typed = ((S.books.gst3b || {})[(reg || "") + "|" + ym]) || {}, tv = (k, h) => num(((typed[k] || {})[h]));
    const rev2 = {igst: tv("rev2", "igst"), cgst: tv("rev2", "cgst"), sgst: tv("rev2", "sgst"), cess: tv("rev2", "cess")};
    const reclaim = {igst: tv("reclaim", "igst"), cgst: tv("reclaim", "cgst"), sgst: tv("reclaim", "sgst"), cess: tv("reclaim", "cess")};
    // rule 37 (a GST setting, off unless switched on): credit on bills unpaid 180 days after their date is reversed in 4(B)(2),
    // and reclaimed when paid
    const r37 = typeof GSTF === "object" && ((S.books.rule37On || {})[reg || ""]) ? GSTF.rule37(ym, reg) : null;
    if (r37) ["igst", "cgst", "sgst", "cess"].forEach(h => { rev2[h] = r2(rev2[h] + r37.rev[h]); reclaim[h] = r2(reclaim[h] + r37.re[h]); });
    // reclaimed credit is taken in 4(A)(5) and shown again in 4(D)(1)
    other = Object.assign({}, other, {igst: r2(other.igst + reclaim.igst), cgst: r2(other.cgst + reclaim.cgst), sgst: r2(other.sgst + reclaim.sgst), cess: r2(other.cess + reclaim.cess)});
    // table 5: inward supplies with no tax (from unregistered or composition suppliers, exempt, nil, non-GST), inter- and intra-state
    const own = String(reg || "").slice(0, 2), gstOf = r => String(r.gstin || "").slice(0, 2);
    const noTax = inn.filter(r => r.bill && !r.import && !r.rcm && r.dir > 0 && !(num(r.igst) || num(r.cgst) || num(r.sgst)) && r.taxable);
    const inw5 = {gstInter: 0, gstIntra: 0, ngInter: 0, ngIntra: 0};
    noTax.forEach(r => { const inter = gstOf(r) && gstOf(r) !== own; const k = (r.cls === "nongst" ? "ng" : "gst") + (inter ? "Inter" : "Intra"); inw5[k] = r2(inw5[k] + num(r.taxable)); });
    const adv = GSTAdv.month(ym, reg).net;                           // 11A less 11B goes into 3.1(a)
    // round 43: the amendments of earlier months reported in this month's GSTR-1 (tables 9A, 9C, 10): their differences are
    // paid with this month's 3B (3.1(a); an SEZ or export invoice's in 3.1(b)); the earlier month's filed 3B is not changed
    const amd = this.amendDiff(ym, reg);
    const rul = GSTRev.month(ym, reg);                               // rules 42 and 43 go into 4(B)(1)
    // our credit notes rejected by the customer in IMS: the portal adds the tax back to 3.1(a)
    const cust = typeof CustIMS === "object" ? CustIMS.month(ym, reg) : {add: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0}, back: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0}};
    const cx = k => r2(cust.add[k] - cust.back[k]);
    const net = {taxable: r2(taxableOut.taxable - cn.taxable + adv.taxable + cx("taxable") + amd.out.taxable), cgst: r2(taxableOut.cgst - cn.cgst + adv.cgst + cx("cgst") + amd.out.cgst), sgst: r2(taxableOut.sgst - cn.sgst + adv.sgst + cx("sgst") + amd.out.sgst),
      igst: r2(taxableOut.igst - cn.igst + adv.igst + cx("igst") + amd.out.igst), cess: r2(taxableOut.cess - cn.cess + adv.cess + cx("cess") + amd.out.cess)};
    ["taxable", "igst", "cgst", "sgst", "cess"].forEach(k => { zero[k] = r2(num(zero[k]) + amd.zero[k]); });
    const itc = {cgst: r2(impGoods.cgst + impServ.cgst + rcmIn.cgst + other.cgst), sgst: r2(impGoods.sgst + impServ.sgst + rcmIn.sgst + other.sgst),
                 igst: r2(impGoods.igst + impServ.igst + rcmIn.igst + other.igst), cess: r2(impGoods.cess + impServ.cess + rcmIn.cess + other.cess)};
    // 4(B)(1): rules 38, 42 and 43 and section 17(5), reversed for good; 4(B)(2): other reversals, which may come back
    const reversal = {cgst: blocked.cgst, sgst: blocked.sgst, igst: blocked.igst, cess: blocked.cess};
    const rules = rul.total;
    const rev1 = {igst: r2(rules.igst + reversal.igst), cgst: r2(rules.cgst + reversal.cgst), sgst: r2(rules.sgst + reversal.sgst), cess: r2(rules.cess + reversal.cess)};
    const netItc = {cgst: r2(itc.cgst - rev1.cgst - rev2.cgst), sgst: r2(itc.sgst - rev1.sgst - rev2.sgst), igst: r2(itc.igst - rev1.igst - rev2.igst), cess: r2(itc.cess - rev1.cess - rev2.cess)};
    const opening = this.creditIn(ym, reg);
    const pay = this.setOff(net, rcmOut, netItc, opening);
    return {sale: taxableOut, cn, net, adv, amend: amd, custRej: cust, rules, r42: rul.r42, r43: rul.r43, zero, nil, nongst, rcmOut, rcmIn, toUnreg, impGoods, impServ, other, blocked,
      buy: this.sum(inn), itc, reversal, rev1, rev2, reclaim, r37, na, inw5, unregPos: P31.unregPos,
      basis: basis.on ? "2b" : basis.why, held, released, cn2b, rejBack, netItc, ineligible: this.sum(inn).ineligible, opening, pay, payable: pay.cash};
  },
  // credit on the 2B basis for a month: on when that month's 2B is here and the client has not chosen the books basis
  itcBasis(ym, reg, quick){
    const b = S.books, choice = ((b.itcBasis || {})[reg || ""]) || "2b";
    if (!reg || typeof GST2B !== "object") return quick ? false : {on: false, why: "no registration chosen"};
    const loaded = new Set(GST2B.all2b(reg).map(t => t.ym));
    const on = choice === "2b" && loaded.has(ym);
    if (quick) return on;
    return on ? {on, loaded, res: GST2B.run(reg)} : {on: false, why: choice === "books" ? "books" : "no 2B"};
  },
  HEADS: ["igst", "cgst", "sgst", "cess"],
  // payment of tax, sections 49 and 49A with rule 88A: IGST credit first against IGST, what is left of it against
  // CGST and SGST; only then CGST credit against CGST and then IGST, SGST credit against SGST and then IGST;
  // CGST never against SGST, cess only against cess. Reverse charge is paid in cash. Credit left over is carried.
  setOff(liab, rcm, credit, opening){
    const L = {}, C = {}, use = {igst: {igst: 0, cgst: 0, sgst: 0}, cgst: {cgst: 0, igst: 0}, sgst: {sgst: 0, igst: 0}, cess: {cess: 0}};
    this.HEADS.forEach(h => { L[h] = Math.max(0, r2(num(liab[h]))); C[h] = Math.max(0, r2(num(credit[h]) + num((opening || {})[h]))); });
    // a negative figure (more credit notes than invoices in the month) is not tax to pay
    const take = (from, to, amt) => { const a = r2(Math.min(amt, C[from], L[to])); if (a > 0){ C[from] = r2(C[from] - a); L[to] = r2(L[to] - a); use[from][to] = r2(use[from][to] + a); } };
    take("igst", "igst", Infinity);
    // what IGST credit is left goes where CGST or SGST credit falls short, then to the rest
    take("igst", "cgst", Math.max(0, L.cgst - C.cgst)); take("igst", "sgst", Math.max(0, L.sgst - C.sgst));
    const half = r2(C.igst / 2); take("igst", "cgst", half); take("igst", "sgst", Infinity); take("igst", "cgst", Infinity);
    take("cgst", "cgst", Infinity); take("sgst", "sgst", Infinity);
    take("cgst", "igst", Infinity); take("sgst", "igst", Infinity);
    take("cess", "cess", Infinity);
    const cash = {}, rc = {};
    this.HEADS.forEach(h => { rc[h] = Math.max(0, r2(num((rcm || {})[h]))); cash[h] = r2(L[h] + rc[h]); });
    return {use, cash, rcmCash: rc, carry: C, due: liab};
  },
  // the credit carried into a month: the balance typed for the first month here, then each month's left-over
  creditIn(ym, reg){
    const b = S.books, key = [reg, b.vouchers && b.vouchers.length, b.mapV || 0, JSON.stringify((b.gstOpen || {})[reg || ""] || {}), JSON.stringify(((b.gstFiled || {})[reg || ""]) || {}).length, JSON.stringify(b.rule37On || {}), JSON.stringify(b.gstSet || {}).length, JSON.stringify(b.gstRev || {}).length, JSON.stringify(b.gstAdv || {}).length, JSON.stringify(b.itcBasis || {}), JSON.stringify(b.gst3b || {}), Object.keys(b.twoBs || {}).join(","), JSON.stringify(((b.reco2b || {}).confirm) || {}).length, JSON.stringify(((b.reco2b || {}).link) || {}).length, typeof ITCDec === "object" ? ITCDec.sig(b) : ""].join("|");
    if (!this._carry || this._carry.key !== key || this._carry.v !== b.vouchers) this._carry = {key, v: b.vouchers, m: {}};
    if (this._carry.m[ym]) return this._carry.m[ym];
    const months = this.months(), i = months.indexOf(ym), open = (b.gstOpen || {})[reg || ""] || {};
    let bal = {igst: num(open.igst), cgst: num(open.cgst), sgst: num(open.sgst), cess: num(open.cess)};
    if (i > 0 && typeof GSTSet === "object" && GSTSet.typeOf(ym, reg) === "qrmp" && GSTSet.qStart(ym) !== ym && months.includes(GSTSet.qStart(ym))){ this._carry.m[ym] = this.creditIn(GSTSet.qStart(ym), reg); return this._carry.m[ym]; }
    if (i > 0){ const prev = months[i - 1], f = typeof GSTF === "object" ? GSTF.filed3b(prev, reg) : null, t = f || this.threeB(prev, reg); bal = Object.assign({}, t.pay.carry); }
    this._carry.m[ym] = bal;
    return bal;
  },
  // the file the portal takes: GSTR-1 as JSON
  toJson(ym, reg, opts){
    const g = this.one(ym, reg);
    const gstin = (GSTR.gstins(S.books) || []).find(x => !reg || x.slice(0, 2) === reg) || "";
    const dmy = d => String(d).length === 8 ? String(d).slice(6, 8) + "-" + String(d).slice(4, 6) + "-" + String(d).slice(0, 4) : d;
    // one item per rate on the invoice
    const items = r => { const m = {}; this.partsOf([r]).forEach(q => { const k = String(q.rate), x = m[k] = m[k] || {rt: q.rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
        x.txval = r2(x.txval + num(q.taxable)); x.iamt = r2(x.iamt + num(q.igst)); x.camt = r2(x.camt + num(q.cgst)); x.samt = r2(x.samt + num(q.sgst)); x.csamt = r2(x.csamt + num(q.cess)); });
      return Object.values(m).sort((a, c) => a.rt - c.rt).map((x, i) => ({num: i + 1, itm_det: Object.assign({rt: x.rt, txval: x.txval, csamt: x.csamt}, r.igst ? {iamt: x.iamt} : {camt: x.camt, samt: x.samt})})); };
    const posOf = r => String(r.posCode || (r.posCode == null ? STATE_CODES[(r.pos || "").toUpperCase()] || (r.gstin || "").slice(0, 2) : "") || "").padStart(2, "0");
    const byParty = (rows, wrap) => {
      const m = {};
      rows.forEach(r => { (m[r.gstin] = m[r.gstin] || []).push(r); });
      return Object.entries(m).map(([ctin, rs]) => ({ctin, [wrap]: rs.map(r => wrap === "nt" ? {
        ntty: r.note === "credit" ? "C" : "D", nt_num: String(r.no), nt_dt: dmy(r.date), val: r2(Math.abs(r.total)),
        pos: posOf(r), rchrg: r.rcm ? "Y" : "N", inv_typ: "R", itms: items(r)
      } : {
        inum: String(r.no), idt: dmy(r.date), val: r2(r.total), pos: posOf(r),
        rchrg: r.rcm ? "Y" : "N", inv_typ: r.cls === "sez" ? (r.igst > 0 ? "SEWP" : "SEWOP") : "R", itms: items(r)
      })}));
    };
    const b2csMap = {};
    this.partsOf(g.b2c).forEach(q => { const r = q.row;
      const pos = posOf(r), key = pos + "|" + q.rate + "|" + (r.igst ? "INTER" : "INTRA");
      const x = b2csMap[key] = b2csMap[key] || {sply_ty: r.igst ? "INTER" : "INTRA", pos, typ: "OE", rt: q.rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
      x.txval = r2(x.txval + q.taxable); x.iamt = r2(x.iamt + q.igst); x.camt = r2(x.camt + q.cgst); x.samt = r2(x.samt + q.sgst); x.csamt = r2(x.csamt + q.cess);
    });
    // a credit or debit note to a buyer with no GSTIN (request of 02-Oct-2026: Puresens Exports LLP's credit note 12 of
    // 31-Mar-2026, 1,500, was left out of the GSTR-1 file, so GSTR-1 and 3.1(a) differed): it adjusts B2C small (table 7)
    // by place of supply and rate, as the portal takes it
    const urTyp = r => this.cdnurTyp(r), cdnur = g.cdnr.filter(r => !r.gstin && urTyp(r));
    this.partsOf(g.cdnr.filter(r => !r.gstin && !urTyp(r))).forEach(q => { const r = q.row, sg = r.note === "credit" ? -1 : 1;
      const pos = posOf(r), key = pos + "|" + q.rate + "|" + (r.igst ? "INTER" : "INTRA");
      const x = b2csMap[key] = b2csMap[key] || {sply_ty: r.igst ? "INTER" : "INTRA", pos, typ: "OE", rt: q.rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
      x.txval = r2(x.txval + sg * Math.abs(q.taxable)); x.iamt = r2(x.iamt + sg * Math.abs(q.igst)); x.camt = r2(x.camt + sg * Math.abs(q.cgst)); x.samt = r2(x.samt + sg * Math.abs(q.sgst)); x.csamt = r2(x.csamt + sg * Math.abs(q.cess));
    });
    // table 8: one row per kind of supply, intra- or inter-state (the place of supply against the registration's state),
    // to a registered or an unregistered person (round 43: every nil, exempt and non-GST supply went in one INTRB2B row)
    const nilBy = {};
    g.nil.forEach(r => { const pos = posOf(r), own = String(reg || (gstin || "").slice(0, 2)), k = (pos && own && pos !== own && pos !== "00" ? "INTR" : "INTRA") + (r.gstin ? "B2B" : "B2C");
      const o = nilBy[k] = nilBy[k] || {sply_ty: k, expt_amt: 0, nil_amt: 0, ngsup_amt: 0};
      if (r.cls === "exempt") o.expt_amt = r2(o.expt_amt + r.taxable); else if (r.cls === "nil") o.nil_amt = r2(o.nil_amt + r.taxable); else o.ngsup_amt = r2(o.ngsup_amt + r.taxable); });
    const fe = this.pEnd(ym), out = {gstin, fp: fe.slice(4, 6) + fe.slice(0, 4), version: "GST3.2.1", hash: "hash"};
    if (g.b2b.length) out.b2b = byParty(g.b2b, "inv");
    if (g.b2cl.length){
      const m = {};
      g.b2cl.forEach(r => { const pos = posOf(r); (m[pos] = m[pos] || []).push(r); });
      out.b2cl = Object.entries(m).map(([pos, rs]) => ({pos, inv: rs.map(r => ({inum: String(r.no), idt: dmy(r.date), val: r2(r.total), itms: items(r)}))}));
    }
    if (Object.keys(b2csMap).length) out.b2cs = Object.values(b2csMap);
    if (g.cdnr.some(r => r.gstin)) out.cdnr = byParty(g.cdnr.filter(r => r.gstin), "nt");
    if (cdnur.length) out.cdnur = cdnur.map(r => ({typ: urTyp(r), ntty: r.note === "credit" ? "C" : "D", nt_num: String(r.no), nt_dt: dmy(r.date), val: r2(Math.abs(r.total)),
      ...(urTyp(r) === "B2CL" ? {pos: posOf(r)} : {}), itms: items(r)}));
    // exports with payment of IGST (WPAY) and under a bond or LUT, without it (WOPAY): two lists (round 43: all went as WPAY)
    if (g.exp.length) out.exp = ["WPAY", "WOPAY"].map(t => ({exp_typ: t, inv: g.exp.filter(r => (r.igst > 0) === (t === "WPAY")).map(r => ({inum: String(r.no), idt: dmy(r.date), val: r2(r.total), itms: items(r)}))})).filter(x => x.inv.length);
    const nilRows = Object.values(nilBy).filter(o => o.expt_amt || o.nil_amt || o.ngsup_amt);
    if (nilRows.length) out.nil = {inv: nilRows};
    const adv = GSTAdv.month(ym, reg);
    if (adv.at.length) out.at = GSTAdv.json(adv.at);
    if (adv.txpd.length) out.txpd = GSTAdv.json(adv.txpd);
    // table 12: HSN with its rate, no total value; from the January 2025 return period in two lists, supplies to registered (B2B) and to unregistered (B2C) persons
    // the unit as the portal's list has it: "NA" for services, as the portal's own file does
    const UQC = ["BAG", "BAL", "BDL", "BKL", "BOU", "BOX", "BTL", "BUN", "CAN", "CBM", "CCM", "CMS", "CTN", "DOZ", "DRM", "GGK", "GMS", "GRS", "GYD", "KGS", "KLR", "KME", "LTR", "MLT", "MTR", "MTS", "NOS", "OTH", "PAC", "PCS", "PRS", "QTL", "ROL", "SET", "SQF", "SQM", "SQY", "TBS", "TGM", "THD", "TON", "TUB", "UGS", "UNT", "YDS"];
    const ALIAS = {NO: "NOS", NUMBERS: "NOS", PC: "PCS", PIECE: "PCS", PIECES: "PCS", KG: "KGS", KGS: "KGS", KILOGRAM: "KGS", GM: "GMS", GRAM: "GMS", GRAMS: "GMS", MT: "MTS", TONNE: "TON", LTRS: "LTR", LITRE: "LTR", L: "LTR", ML: "MLT", MTRS: "MTR", METER: "MTR", METRE: "MTR", M: "MTR", SQFT: "SQF", SQMT: "SQM", PKT: "PAC", PACK: "PAC", PACKET: "PAC", BOXES: "BOX", SETS: "SET", PAIR: "PRS", PAIRS: "PRS", ROLL: "ROL", ROLLS: "ROL", DOZEN: "DOZ", BOTTLE: "BTL", CARTON: "CTN", UNIT: "UNT", UNITS: "UNT", QUINTAL: "QTL"};
    const uqcOf = h => (h.supply === "Services" || /^99/.test(h.hsn || "")) ? "NA" : UQC.includes(String(h.unit || "").toUpperCase()) ? String(h.unit).toUpperCase() : ALIAS[String(h.unit || "").toUpperCase()] || (h.unit ? "OTH" : "NOS");
    const hsnLine = (h, x, i) => ({num: i + 1, hsn_sc: h.hsn || "", desc: String(h.desc || "").slice(0, 30), uqc: uqcOf(h), qty: uqcOf(h) === "NA" ? 0 : r2(Math.abs(num(x.qty))), rt: h.rate,
      txval: r2(x.taxable), iamt: r2(x.igst), camt: r2(x.cgst), samt: r2(x.sgst), csamt: r2(x.cess)});
    if (g.hsn.length){
      if (ym >= "202501") out.hsn = {hsn_b2b: g.hsn.filter(h => Math.abs(h.b2b.taxable) >= 0.01).map((h, i) => hsnLine(h, h.b2b, i)), hsn_b2c: g.hsn.filter(h => Math.abs(h.b2c.taxable) >= 0.01).map((h, i) => hsnLine(h, h.b2c, i))};
      else out.hsn = {data: g.hsn.map((h, i) => hsnLine(h, h, i))};
    }
    if (g.series.length){
      const nats = Array.from(new Set(g.series.map(x => x.nat))).sort((a, c) => a - c);
      out.doc_issue = {doc_det: nats.map(n => ({doc_num: n, docs: g.series.filter(x => x.nat === n).map((x, i) => ({num: i + 1, from: String(x.from), to: String(x.to), totnum: x.n, cancel: x.cancelled, net_issue: x.n - x.cancelled}))}))};
    }
    // table 14(a) (from the January 2024 return period, when the portal opened tables 14 and 15): by the operator's GSTIN
    const e14 = fe >= "202401" ? this.eco14(ym, reg, g).a : [];
    if (e14.length) out.supeco = {clttx: e14.map(x => ({etin: x.etin, suppval: r2(x.suppval), igst: r2(x.igst), cgst: r2(x.cgst), sgst: r2(x.sgst), cess: r2(x.cess), flag: "N"}))};
    if (!(opts && opts.plain) && reg) GSTAmend.addTo(out, this.pStart(ym), reg);
    return out;
  },
};
// next-gst-share (part A, shadow): one entry's GST share, so the cloud keeps it entry by entry (gst_share, migration 164)
// and a month's 3B 3.1/3.2 and GSTR-1 tables are sums of month totals. Worked out by the engine's own text: the entry's
// row of outward (outRow) or inward (inRow), with the place of supply, the B2C summary rule, the supply class and reverse
// charge as there; the registration the entry is in (regOf) and its month. It reads S.books as the engine does (its
// ledger list, groups, GSTINs, gstPosFix); ctx.books, when given, is used for the call and put back after.
//   -> {id, ym, reg, rows: [{sec, k1, k2, k3, n, taxable, igst, cgst, sgst, cess, qty}]}; no rows: the entry is in no
//   part of these (an optional or cancelled one, a receipt, a sale with no value and no tax...). The sections:
//     3B.sale / 3B.cn / 3B.zero / 3B.nil / 3B.nongst / 3B.unreg   threeBm's sale, cn, zero, nil, nongst, toUnreg
//     3B.rcm                                                       threeBm's rcmOut (3.1(d)), signed as signedIn
//     3B.pos   k1 the place of supply                              3.2 (unregPos), a credit note taken off
//     R1.B2B / R1.B2CL / R1.B2C / R1.CDNR / R1.DBNR / R1.EXP / R1.NIL   GSTR-1's parts (cdnr is CDNR and DBNR)
//     R1.B2CS  k1 the rate, k2 the place of supply                 GSTR.one's b2cRates (by rate), part by part
//     R1.HSN   k1 the HSN, k2 the rate, k3 b2b|b2c                 GSTR.one's hsn (table 12), a credit note taken off
// Each figure is the entry's own, to the paisa (r2 as the engine adds); a month's figure is the sum over its entries.
// Not here (not an entry's): advances, amendments, the customers' IMS, marketplace sales kept in Sales (records).
function entryShares(v, ctx){
  const was = S.books;
  if (ctx && ctx.books) S.books = ctx.books;
  try {
    const out = {id: v && v.id, ym: v ? String(v.date).slice(0, 6) : "", reg: "", rows: []};
    if (!v || v.opt || v.cancel || !Array.isArray(v.ent)) return out;
    out.reg = GSTR.regOf(v);
    const acc = new Map(), F = ["taxable", "igst", "cgst", "sgst", "cess", "qty"];
    const add = (sec, k1, k2, k3, o, sg) => {
      const key = sec + "\u0001" + k1 + "\u0001" + k2 + "\u0001" + k3;
      let x = acc.get(key);
      if (!x){ x = {sec, k1: String(k1), k2: String(k2), k3: String(k3), n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0}; acc.set(key, x); }
      x.n++; F.forEach(f => { x[f] = r2(x[f] + sg * num(o[f])); });
    };
    if (Books.isSale(v)){
      const r = GSTR.outRow(v, null, "");
      if (r){
        if (r.cls === "taxable" && r.kind !== "CDNR") add("3B.sale", "", "", "", r, 1);
        if (r.kind === "CDNR") add("3B.cn", "", "", "", r, 1);
        if (r.cls === "export" || r.cls === "sez") add("3B.zero", "", "", "", r, 1);
        if (r.cls === "exempt" || r.cls === "nil") add("3B.nil", "", "", "", r, 1);
        if (r.cls === "nongst") add("3B.nongst", "", "", "", r, 1);
        if (!r.gstin && r.igst > 0) add("3B.unreg", "", "", "", r, 1);
        const sg = r.kind === "CDNR" ? -1 : 1, parts = GSTR.partsOf([r]);
        if (!r.gstin && r.igst > 0 && r.cls === "taxable") parts.forEach(q => add("3B.pos", (r.posCode || "00") || "97", "", "", {taxable: q.taxable, igst: q.igst}, sg));
        add("R1." + r.kind, "", "", "", r, 1);
        if (r.kind === "B2C") parts.forEach(q => add("R1.B2CS", String(q.rate), r.posCode || "", "", q, 1));
        if (r.cls === "taxable" || r.cls === "export" || r.cls === "sez" || r.cls === "exempt" || r.cls === "nil") parts.forEach(q => add("R1.HSN", q.hsn || "", String(q.rate), r.gstin ? "b2b" : "b2c", q, sg));
      }
    } else {
      const r0 = GSTR.inRow(v, null, "");
      if (r0){ const r = GSTR.signedIn(r0); if (r.rcm || (r.import && r.supply !== "Goods")) add("3B.rcm", "", "", "", r, 1); }
    }
    out.rows = Array.from(acc.values());
    return out;
  } finally {
    S.books = was;
  }
}
// GSTRev (src/js/15-itc-reversal.js)
const GSTRev = {
  HEADS: ["igst", "cgst", "sgst", "cess"],
  z(){ return {igst: 0, cgst: 0, sgst: 0, cess: 0}; },
  add(a, c, k){ const o = {}; this.HEADS.forEach(h => { o[h] = r2(num(a[h]) + num(c[h]) * (k == null ? 1 : k)); }); return o; },
  settings(){ return Object.assign({d2: true}, (S.books && S.books.rev) || {}); },
  // turnover of the month: E is exempt, nil rated and non-GST; F is all of it, exports included
  // next-speed-render: kept for the drawing or calculation (each month's 3B asked it of every earlier month: 28 readings of
  // a month's sales a 3B on 25 months of books); the figures are only read
  turnover(ym, reg){ return typeof perRender === "function" ? perRender(this, "to|" + ym + "|" + reg, () => this.turnoverNow(ym, reg)) : this.turnoverNow(ym, reg); },
  turnoverNow(ym, reg){
    let T = 0, Z = 0, E = 0;
    GSTR.outward(ym, reg).forEach(r => {
      const sign = r.kind === "CDNR" ? -1 : 1, v = num(r.taxable) * sign;
      if (r.cls === "export" || r.cls === "sez") Z += v;
      else if (r.cls === "exempt" || r.cls === "nil" || r.cls === "nongst") E += v;
      else T += v;
    });
    return {taxable: r2(T), zero: r2(Z), exempt: r2(E), total: r2(T + Z + E)};
  },
  // rule 42(1)(h): a month with no turnover takes E and F of the last month that had some
  ratio(ym, reg){
    const t = this.turnover(ym, reg);
    if (t.total > 0) return {E: t.exempt, F: t.total, from: ym, t};
    const earlier = GSTR.months().filter(m => m < ym).reverse();
    for (const m of earlier){ const x = this.turnover(m, reg); if (x.total > 0) return {E: x.exempt, F: x.total, from: m, t}; }
    return {E: 0, F: 0, from: "", t};
  },
  common(ym, reg){
    let c = this.z(), n = 0;
    GSTR.inward(ym, reg).forEach(r => {
      if (!r.common) return;
      n++;
      c = this.add(c, {igst: r.common.IGST, cgst: r.common.CGST, sgst: r.common.SGST, cess: r.common.CESS}, r.note === "debit" ? -1 : 1);
    });
    return {c, n};
  },
  rule42(ym, reg){
    const {c, n} = this.common(ym, reg), q = this.ratio(ym, reg), k = q.F ? q.E / q.F : 0;
    const D1 = {}, D2 = {}, C3 = {};
    const d2on = this.settings().d2;
    this.HEADS.forEach(h => { D1[h] = r2(c[h] * k); D2[h] = d2on ? r2(c[h] * 0.05) : 0; C3[h] = r2(c[h] - D1[h] - D2[h]); });
    return {C2: c, n, ratio: q, share: k, D1, D2, C3, reverse: this.add(D1, D2)};
  },
  // the months a capital good's credit is spread over: 60 from the month it is put to use
  assets(reg){ return ((S.books && S.books.assets) || []).filter(a => !reg || !a.reg || a.reg === reg); },
  tm(a, ym){
    const start = String(a.date || "").replace(/-/g, "").slice(0, 6);
    if (a.use !== "common" || start.length !== 6 || ym < start) return null;
    const idx = (num(ym.slice(0, 4)) - num(start.slice(0, 4))) * 12 + num(ym.slice(4, 6)) - num(start.slice(4, 6));
    if (idx >= 60) return null;
    const sold = String(a.sold || "").replace(/-/g, "").slice(0, 6);
    if (sold && ym > sold) return null;
    const o = {};
    this.HEADS.forEach(h => { o[h] = r2(num(a[h]) / 60); });
    return o;
  },
  rule43(ym, reg){
    let Tr = this.z(); const used = [];
    this.assets(reg).forEach(a => { const t = this.tm(a, ym); if (t){ Tr = this.add(Tr, t); used.push({a, tm: t}); } });
    const q = this.ratio(ym, reg), k = q.F ? q.E / q.F : 0, Te = {};
    this.HEADS.forEach(h => { Te[h] = r2(Tr[h] * k); });
    return {Tr, Te, used, ratio: q, share: k};
  },
  // what goes into 3B 4(B)(1) for the month (or every month when none is chosen)
  month(ym, reg){
    const months = ym ? [ym] : GSTR.months();
    let r42 = this.z(), r43 = this.z();
    months.forEach(m => { r42 = this.add(r42, this.rule42(m, reg).reverse); r43 = this.add(r43, this.rule43(m, reg).Te); });
    return {r42, r43, total: this.add(r42, r43)};
  },
  total(x){ return r2(this.HEADS.reduce((s, h) => s + num(x[h]), 0)); },
  fyMonths(ym){
    const y = num(ym.slice(0, 4)), mo = num(ym.slice(4, 6)), start = mo >= 4 ? y : y - 1;
    const out = [];
    for (let i = 0; i < 12; i++){ const m = 4 + i, yy = m > 12 ? start + 1 : start; out.push(String(yy) + String(m > 12 ? m - 12 : m).padStart(2, "0")); }
    return out;
  },
  // rule 42(2): the year worked out again on the year's turnover, and the difference
  year(ym, reg){
    const have = new Set(GSTR.months()), months = this.fyMonths(ym).filter(m => have.has(m));
    let C2 = this.z(), monthly = this.z(), E = 0, F = 0;
    const rows = months.map(m => {
      const r = this.rule42(m, reg), t = r.ratio.t;
      C2 = this.add(C2, r.C2); monthly = this.add(monthly, r.D1); E += t.exempt; F += t.total;
      return {ym: m, C2: r.C2, share: r.share, D1: r.D1, D2: r.D2, from: r.ratio.from};
    });
    const k = F ? E / F : 0, annual = {};
    this.HEADS.forEach(h => { annual[h] = r2(C2[h] * k); });
    const diff = this.add(annual, monthly, -1);
    return {months, rows, C2, E: r2(E), F: r2(F), share: k, annual, monthly, diff, fy: months.length ? months[0].slice(0, 4) : ""};
  },
};
// GSTSet (src/js/36-gst-settings.js)
const GSTSet = {
  store(reg){ const b = S.books; b.gstSet = b.gstSet || {}; return b.gstSet[reg || ""] = b.gstSet[reg || ""] || {}; },
  peek(reg){ return (((S.books || {}).gstSet) || {})[reg || ""] || {}; },
  qStart(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6), s = m >= 4 ? m - ((m - 4) % 3) : 1; return y + String(s).padStart(2, "0"); },
  qEnd(ym){ const s = this.qStart(ym), y = +s.slice(0, 4), m = +s.slice(4, 6) + 2; return y + String(m).padStart(2, "0"); },
  isQEnd(ym){ return this.qEnd(ym) === ym; },
  qLabel(ym){ const m = +this.qStart(ym).slice(4, 6), y = +ym.slice(0, 4), fy = m >= 4 ? y : y - 1; return ({4: "Q1", 7: "Q2", 10: "Q3", 1: "Q4"})[m] + " " + fy + "-" + String(fy + 1).slice(2); },
  // filing type in force for a month: the latest choice whose quarter has begun
  history(reg){ return (this.peek(reg).filing || []).slice().sort((a, c) => a.from.localeCompare(c.from)); },
  typeOf(ym, reg){ let t = "monthly"; this.history(reg).forEach(x => { if (x.from <= this.qStart(ym)) t = x.type; }); return t; },
  TYPES: [["monthly", "Monthly"], ["qrmp", "Quarterly (QRMP)"], ["comp", "Composition"]],
  // QRMP 3B falls due on the 22nd in these states and union territories, on the 24th elsewhere
  Q22: new Set(["22", "23", "24", "25", "26", "27", "29", "30", "31", "32", "33", "34", "35", "36", "37"]),
  typeLabel(t){ return (this.TYPES.find(x => x[0] === t) || [, t])[1]; },
  // the window the portal allows to change between QRMP and monthly for a quarter:
  // from the 1st of the second month of the quarter before, to the last day of the quarter's first month
  window(q){ const s = this.qStart(q), p = GSTR.nextYm ? null : null, y = +s.slice(0, 4), m = +s.slice(4, 6);
    const back = n => { let yy = y, mm = m - n; while (mm < 1){ mm += 12; yy--; } return yy + "-" + String(mm).padStart(2, "0"); };
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return {from: back(2) + "-01", to: last}; },
  einvMode(reg){ return this.peek(reg).einv || "auto"; },
  // a party's email and phone: typed in settings, else kept from earlier letters, else Tally's masters
  contact(gstin, party, legacy){
    const c = (((S.books || {}).gstContacts) || {})[String(gstin || "").toUpperCase()] || {}, l = legacy || {}, i = (((S.books || {}).ledInfo) || {})[party] || {};
    return {email: c.email || l.email || i.email || "", phone: c.phone || l.phone || i.phone || i.mobile || ""};
  },
  // parties with a GSTIN in the GST working, suppliers and customers
  parties(){
    const b = S.books, key = (b.vouchers || []).length + "|" + (b.mapV || 0);
    if (this._p && this._p.key === key && this._p.v === b.vouchers) return this._p.list;
    const m = new Map();
    (b.vouchers || []).forEach(v => { const g = String(v.gstin || "").toUpperCase(); if (!/^\d{2}[A-Z0-9]{13}$/.test(g) || !v.party) return;
      const side = Books.isSale(v) ? "customer" : Books.isPurchase(v) ? "supplier" : ""; if (!side) return;
      const x = m.get(g) || {gstin: g, party: v.party, sides: new Set(), n: 0}; x.sides.add(side); x.n++; m.set(g, x); });
    const list = Array.from(m.values()).map(x => Object.assign(x, {sides: Array.from(x.sides).sort().join(" and ")})).sort((a, c) => c.n - a.n);
    this._p = {key, v: b.vouchers, list}; return list;
  },
};
// GSTV (src/js/38-gst-returns-filed.js)
const GSTV = {
  // every record, removed ones included (a removal is a soft delete: the record and its PDF are kept, marked removed)
  all(){ const b = S.books || {}; b.gstVault = b.gstVault || []; this.fixIff(b.gstVault); return b.gstVault; },
  // the records in use
  list(){ return this.all().filter(x => !x.removed); },
  // a quarterly (QRMP) filer's return for the first or second month of a quarter is an IFF, even when the portal's PDF
  // prints "FORM GSTR-1" (request of 02-Oct-2026: the Apr-2025 and May-2025 IFFs of Testing AAD were filed as GSTR-1)
  formFor(form, per, reg){
    return form === "r1" && /^\d{6}$/.test(per) && reg && typeof GSTSet === "object" && GSTSet.typeOf(per, reg) === "qrmp" && !GSTSet.isQEnd(per) ? "iff" : form;
  },
  fixIff(list){
    list.forEach(x => { const f = this.formFor(x.form, x.per, x.reg); if (f !== x.form){
      x.formRead = x.form; x.form = f;
      // the filing date went in as a GSTR-1's; it is the IFF's
      const r = GSTF.rec(x.per, x.reg); if (x.arnDate && r.r1 === x.arnDate){ if (!r.iff) r.iff = x.arnDate; delete r.r1; }
    } });
  },
  // copies on file for a form and period, newest first
  copies(reg, form, per){ return this.list().filter(x => x.reg === reg && x.form === form && x.per === per).sort((a, c) => String(c.at).localeCompare(String(a.at))); },
};
// ITCT (src/js/32-itc-follow-up.js)
const ITCT = {
  store(reg){ const b = S.books; b.itcTrack = b.itcTrack || {}; const t = b.itcTrack[reg || ""] = b.itcTrack[reg || ""] || {}; t.dec = t.dec || {}; t.sent = t.sent || {}; t.contact = t.contact || {}; return t; },
  dec(reg, key){ return ((this.store(reg).dec[key]) || {}); },
  today(){ const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); },
  tax(o){ return r2(num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess)); },
};
// M2B (src/js/85-twob-auto.js)
const M2B = {
  st: {},                                           // reg|fy -> {run, hash, busy, err, at},
  fyOf(ym){ const y = +String(ym).slice(0, 4), m = +String(ym).slice(4, 6); const s = m >= 4 ? y : y - 1; return s + "-" + String((s + 1) % 100).padStart(2, "0"); },
  // next-speed0 (09-Nov-2026, the GST input register of a 40,000-entry book: 10.4 s of 13.1 s): GST2B.run asks aiSig, and so
  // the year, at every ask, and each time GSTR.months read every entry's date. The books' last month is asked only when no
  // month is chosen (S.gstYm), and is then kept for these books: the same books object, the same list of entries (its
  // length, its first and last entry), the same save (BOOKS_REV) and the same client. Kept only when the months come from
  // the entries; the months worked out from today's date (books with no dated entry) are asked each time. tests/run_speed0.js
  _last: null,
  lastYm(){
    if (!(typeof GSTR === "object" && GSTR.months)) return undefined;
    const b = S.books, v = b && b.vouchers, n = Array.isArray(v) ? v.length : 0, rev = typeof BOOKS_REV === "number" ? BOOKS_REV : 0, c = this._last;
    if (c && n && c.b === b && c.v === v && c.n === n && c.a === v[0] && c.z === v[n - 1] && c.rev === rev && c.co === S.coId) return c.last;
    const ms = GSTR.months(), last = ms[ms.length - 1];
    this._last = n && v.some(e => e && GSTR.ym(e.date).length === 6) ? {b, v, n, a: v[0], z: v[n - 1], rev, co: S.coId, last} : null;
    return last;
  },
  fyNow(){ return this.fyOf(S.gstYm || this.lastYm() || new Date().toISOString().slice(0, 7).replace("-", "")); },
  key(reg, fy){ return (reg || "") + "|" + fy; },
  // next-itc-simple: the AI's pairs for GST2B.run (a 2B document with its books entries), and what they were made from
  aiLinks(reg){
    const s = this.st[this.key(reg, this.fyNow())], res = s && s.run && s.run.result;
    if (!res) return [];
    return (res.rows || []).filter(r => (r.st === "matched-ai" || r.st === "probable") && r.g.length === 1 && r.b.length)
      .map(r => ({g: r.g[0], b: r.b.slice(), st: r.st, why: (r.why || []).join("; "), id: r.id}));
  },
  aiSig(reg){ const s = this.st[this.key(reg, this.fyNow())]; return s && s.run ? String(s.run.id || "") + ":" + String(s.run.at || "") + ":" + ((s.run.result || {}).rows || []).length + ":" + JSON.stringify(s.run.decisions || {}).length : ""; },
};

// Audit (src/js/06-audit.js)
const Audit = {
  // the group a ledger sits under, up to the top
  // (ledGroupPath, src/js/00: a name with line breaks or entities still finds its group)
  path(l){ return ledGroupPath(S.books, l); },
  under(l, re){ return this.path(l).some(g => re.test(g)); },
};
// LedMaster (src/js/05-tally-ledger-master.js)
const LedMaster = {
  WHAT: [
    ["gst", "GST", "gst"], ["gst_rcm", "GST, reverse charge", "gst"], ["gst_import", "GST on imports", "gst"], ["gst_common", "GST, common credit (rule 42)", "gst_common"],
    ["ineligible", "GST, ITC not to be taken", "ineligible"], ["gst_control", "GST control or provisional account", "tax_other"], ["gst_setoff", "GST set-off or electronic ledger", "tax_other"],
    ["gst_interest", "GST interest or late fee", "tax_other"],
    ["tds_payable", "TDS payable", "tds_payable"], ["tds_clearing", "TDS clearing: month-end transfer, then paid", "tds_clearing"], ["tds_receivable", "TDS receivable", "tds_receivable"], ["tcs_payable", "TCS payable", "tcs_payable"], ["tcs_receivable", "TCS receivable", "tcs_receivable"],
    ["tds_interest", "TDS interest or late fee", "tax_other"], ["bank", "Bank or cash", "bank"], ["roundoff", "Round off", "roundoff"], ["none", "Not a tax ledger", ""]],
  isGst(w){ return /^gst|^ineligible$/.test(w || ""); },
  isTds(w){ return /^tds_|^tcs_/.test(w || ""); },
  kindOf(w){ const x = this.WHAT.find(z => z[0] === w); return x ? x[2] : ""; },
  // a ledger that should be in one of the two masters
  taxLike(name, m, info){
    if (m && m.what && m.what !== "none" && m.what !== "bank" && m.what !== "roundoff") return true;
    if (m && m.what === "none") return false;
    if (info && /^(GST|TDS|TCS)$/i.test(info.taxType || "")) return true;
    return /\b(C|S|I|UT)\s*\.?\s*GST\b|\bGST\b|\bCESS\b|\bTDS\b|\bTCS\b|\b19[2-9][A-Z]{0,2}\b|\b206C/i.test(name) && !/\bSALARY\s+PAYABLE\b/i.test(name);
  },
  // how each ledger is used in the day book: which side, which registration, which rate
  usage(b){
    const u = {};
    (b.vouchers || []).forEach(v => {
      const sale = Books.isSale(v), purch = Books.isPurchase(v), reg = (sale || purch) ? String(v.cmp || "").slice(0, 2) : "";
      let value = 0;
      v.ent.forEach(e => { const k = (b.map[e.l] || {}).kind; if (!k && e.l !== v.party) value += Math.abs(e.a); });
      v.ent.forEach(e => {
        const x = u[e.l] = u[e.l] || {n: 0, sale: 0, purch: 0, dr: 0, cr: 0, regs: {}, rates: {}, rcm: 0, onSaleCr: 0, onPurchDr: 0};
        x.n++; if (sale) x.sale++; if (purch) x.purch++; if (e.a < 0) x.dr++; else x.cr++;
        if (reg) x.regs[reg] = (x.regs[reg] || 0) + 1;
        if (v.rcm) x.rcm++;
        if (sale && e.a > 0) x.onSaleCr++;
        if (purch && e.a < 0) x.onPurchDr++;
        const r = e.r || (value ? Math.round(Math.abs(e.a) / value * 10000) / 100 : 0);
        if (r){ const k = String(r); x.rates[k] = (x.rates[k] || 0) + 1; }
      });
    });
    return u;
  },
  top(obj){ const e = Object.entries(obj || {}).sort((a, c) => c[1] - a[1]); return e.length ? e[0] : null; },
  // the best guess for one ledger, and why
  propose(name, info, u, regs){
    const up = name.toUpperCase(), why = [];
    info = info || {}; u = u || {n: 0, regs: {}, rates: {}};
    const tt = String(info.taxType || "").toUpperCase(), dh = String(info.dutyHead || "").toUpperCase();
    const p = {what: "none", tax: "", side: "", reg: "", section: "", rate: null, gstRate: null};
    if (tt === "GST" || /\bGST\b|\bCESS\b|\b(C|S|I|UT)\s*\.?\s*GST/.test(up)){
      p.what = "gst";
      if (tt === "GST") why.push("Tally: tax type GST");
      // reverse charge before "GST PAYABLE": "07 RCM CGST PAYABLE" is the tax owed on reverse charge, not a set-off ledger.
      // An electronic ledger, interest or a control account named for reverse charge is still read by the tests below
      if (/\bRCM\b|REVERSE/.test(up) && !/ELECTRONIC|CASH\s*LEDGER|CREDIT\s*LEDGER|SET\s*OFF|INTEREST|LATE\s*FEE|PENALTY|CONTROL|PROVISIONAL|PENDING|SUSPENSE|UNCLAIMED/.test(up)) p.what = "gst_rcm";
      else if (/ELECTRONIC|CASH\s*LEDGER|CREDIT\s*LEDGER|CURRENT\s*GST\s*PAYABLE|GST\s*PAYABLE|SET\s*OFF/.test(up)) p.what = "gst_setoff";
      else if (/INTEREST|LATE\s*FEE|PENALTY/.test(up)) p.what = "gst_interest";
      else if (/CONTROL|PROVISIONAL|PENDING|SUSPENSE|UNCLAIMED/.test(up)) p.what = "gst_control";
      else if (/\bRCM\b|REVERSE/.test(up)) p.what = "gst_rcm";
      else if (/IMPORT|CUSTOMS|\bBOE\b/.test(up)) p.what = "gst_import";
      else if (/INELIGIBLE|BLOCKED|NOT\s*CLAIM|17\s*\(?5/.test(up)) p.what = "ineligible";
      else if (/COMMON/.test(up)) p.what = "gst_common";
      p.tax = /INTEGRATED|IGST/.test(dh) || /\bIGST\b|I\s*GST/.test(up) ? "IGST" : /CENTRAL|CGST/.test(dh) || /\bCGST\b|C\s*GST/.test(up) ? "CGST" :
        /STATE|UT|SGST|UTGST/.test(dh) || /\b(S|UT)GST\b|S\s*GST/.test(up) ? "SGST" : /CESS/.test(dh + up) ? "CESS" : "";
      if (dh) why.push("Tally: duty head " + info.dutyHead); else if (p.tax) why.push("name says " + p.tax);
      if (/\bINPUT\b|\bITC\b|RECEIVABLE/.test(up)){ p.side = "input"; why.push("name says input"); }
      else if (/OUTPUT|PAYABLE/.test(up)){ p.side = "output"; why.push("name says output"); }
      else if (u.onPurchDr > u.onSaleCr){ p.side = "input"; why.push("debited on " + u.onPurchDr + " purchases"); }
      else if (u.onSaleCr){ p.side = "output"; why.push("credited on " + u.onSaleCr + " sales"); }
      const pre = up.match(/(?:^|\D)(\d{2})\s/);
      const grp = String(info.group || "").match(/(?:^|\D)(\d{2})(?:\D|$)/);
      const used = this.top(u.regs);
      if (pre && regs.includes(pre[1])){ p.reg = pre[1]; why.push("name starts " + pre[1]); }
      else if (grp && regs.includes(grp[1])){ p.reg = grp[1]; why.push("group " + info.group); }
      else if (used){ p.reg = used[0]; why.push("used on " + used[1] + " vouchers of " + used[0]); }
      else if (regs.length === 1) p.reg = regs[0];
      const rn = up.match(/(\d+(?:\.\d+)?)\s*%/);
      if (rn){ p.gstRate = num(rn[1]); why.push("rate " + rn[1] + "% in the name"); }
    } else if (tt === "TDS" || tt === "TCS" || /\bTDS\b|\bTCS\b/.test(up) || /\b19[2-9][A-Z]{0,2}\b|\b206C/.test(up)){
      const tcs = tt === "TCS" || /\bTCS\b|206C/.test(up);
      p.what = /IN?TE?REST\s+(ON|FOR)\s+(LATE\s+)?(TDS|TCS)|LATE\s*FEE|PENALTY|234E|201\s*\(?1A/.test(up) ? "tds_interest" : tcs ? (/RECEIVABLE|ADVANCE|PAID/.test(up) ? "tcs_receivable" : "tcs_payable") : (/RECEIVABLE|ADVANCE|REFUND|\bA\.?\s*Y\b|\bT\.?\s*Y\b/.test(up) ? "tds_receivable" : "tds_payable");
      if (tt) why.push("Tally: tax type " + info.taxType);
      const sec = Books.secIn(up);
      // bridge 2.4.3: the section of the nature of payment Tally keeps on the ledger, before the one in its name
      const natSec = typeof TDSTally === "object" && TDSTally.natureOf(name) ? TDSTally.sectionOf(TDSTally.natureOf(name)) : "";
      if (natSec){ p.section = natSec; why.push("Tally: nature of payment " + TDSTally.natureOf(name) + " (section " + natSec + ")"); }
      else if (sec){ p.section = sec; why.push("section " + sec + " in the name"); }
      else if (/\b(393|389|394|392)\b/.test(up)){
        // a ledger named under the Income-tax Act, 2025: the section it replaces, from what it is for
        const NAT = [[/SALARY|PERQUISITE\s*.*SALARY/, "192"], [/NON\s*RESIDENT|\b394\b/, "195"], [/PERQUISITE|BENEFIT/, "194R"], [/CONTRACT/, "194C"], [/PROF|TECH|FEES/, "194J"],
          [/INSURANCE\s*COMM/, "194D"], [/COMM|BROKER/, "194H"], [/RENT/, "194I"], [/INTEREST/, "194A"], [/PURCHASE\s*OF\s*GOOD/, "194Q"], [/PROPERTY/, "194IA"], [/E.?COMMERCE/, "194O"], [/DIVIDEND/, "194"]];
        const hit = NAT.find(([re]) => re.test(up.replace(/\b(389|392|393|394)\b/g, " ")) || (re.source === "NON\\s*RESIDENT|\\b394\\b" && /\b394\b/.test(up)));
        if (hit){ p.section = hit[1]; why.push("named under the new Act; " + hit[1] + " from the words in the name"); }
      }
      else if (info.tdsNature){ p.section = (String(info.tdsNature).match(/19[2-9][A-Z]{0,2}|206C[A-Z]{0,2}/) || [""])[0]; if (p.section) why.push("Tally: nature " + info.tdsNature); }
      // round 92 (C): "TDS on Salary", "Salary TDS": section 192 from the word salary
      if (!p.section && p.what === "tds_payable" && /SALAR/.test(up)){ p.section = "192"; why.push("salary in the name: section 192"); }
      const rn = up.match(/(\d+(?:\.\d+)?)\s*%/);
      if (rn){ p.rate = num(rn[1]); why.push("rate " + rn[1] + "%"); }
      // its group decides over its name (review of 02-Oct-2026: "TDS Magic Seva" and "TDS Pentagon" are kept under Loans &
      // Advances, "Intrest On TDS" under Financial Expenses): an asset is TDS receivable, an expense is never TDS payable
      const grp = String(info.group || ""), under = re => (typeof Audit === "object" && Audit.under(name, re)) || re.test(grp);
      if (/payable/.test(p.what) && under(/^(loans\s*&\s*advances\s*\(asset\)|current assets|deposits\s*\(asset\)|sundry debtors)$/i)){ p.what = tcs ? "tcs_receivable" : "tds_receivable"; p.section = ""; why.push("kept under " + (grp || "an asset group") + ": tax deducted from the client"); }
      else if (/payable/.test(p.what) && under(/^(indirect expenses|direct expenses|purchase accounts|financial expenses|indirect incomes|direct incomes|sales accounts)$/i)){ p.what = /INTEREST|INTREST|LATE\s*FEE|PENALTY|PANELTY/.test(up) ? "tds_interest" : "none"; p.section = ""; why.push("an expense or income ledger (" + (grp || "its group") + "), not a tax account"); }
      if (p.what === "tds_payable" && !p.section) why.push("no section: choose one, or mark it a general TDS account");
    } else if (/SALAR/.test(up) && /INCOME[\s-]*TAX/.test(up) && !/RECEIVABLE|EXPENSE|INTEREST|ADVANCE|REFUND/.test(up)){
      // round 92 (C): "Income Tax (Salary)": the tax deducted from salary, section 192
      p.what = "tds_payable"; p.section = "192"; why.push("income tax on salary in the name: section 192");
    } else if (/\bROUND\s*(ED)?\s*OFF\b/.test(up)){ p.what = "roundoff"; why.push("name"); }
    else if (!/GST|\bTDS\b|\bTCS\b/.test(up) && /\bRCM\b|REVERSE\s*CHARGE/.test(up) && /PAYABLE|LIABILITY|OUTPUT/.test(up)){
      // "07 RCM PAYABLE": the tax owed on reverse charge, credited beside the input tax on the bill
      p.what = "gst_rcm"; p.side = "output"; p.tax = /\bIGST\b/.test(up) ? "IGST" : /\bCGST\b/.test(up) ? "CGST" : /\bSGST\b/.test(up) ? "SGST" : "";
      const pre = up.match(/(?:^|\D)(\d{2})\s/); if (pre && regs.includes(pre[1])) p.reg = pre[1]; else if (regs.length === 1) p.reg = regs[0];
      why.push("name says reverse charge payable");
    }
    else if (this.bankByGroup(name, info)){ p.what = "bank"; why.push(info.group ? "group " + info.group : "name"); }
    if (u.n) why.push("used " + u.n + " times");
    p.why = why.join("; ");
    return p;
  },
  // a bank or cash account: by its Tally group where the masters are read, by its name only where they are not.
  // "BANK CHARGES" is an expense and "ICICI BANK (CREDITORS)" a supplier, whatever the name says
  bankByGroup(name, info){
    const b = S.books || {}, groups = b.groups || {};
    let g = String((info && info.group) || ledUnder(b, name) || "");
    if (!g) return /\bBANK\b|\bCASH\b/i.test(name) && !/CHARGE|COMMISSION|INTEREST|CREDITOR|DEBTOR|LOAN|FEE/i.test(name);
    for (let i = 0; i < 12 && g; i++){
      if (/^(bank accounts|bank od a\/c|bank occ a\/c|cash-in-hand|bank overdraft)$/i.test(g.trim())) return true;
      const up = ledLook(groups, g);
      if (!up || ledKey(up) === ledKey(g) || /^\W*primary$/i.test(up)) break;
      g = up;
    }
    return /^(bank accounts|bank od a\/c|bank occ a\/c|cash-in-hand)$/i.test(g.trim());
  },
  // turn a choice into what the returns read
  applyWhat(m, w){
    m.what = w; m.kind = this.kindOf(w); m.rcm = w === "gst_rcm";
    if (this.isGst(w)){ m.tax = m.tax || "IGST"; m.side = m.side || (w === "gst_rcm" ? "output" : "input"); }
    if (!this.isTds(w)){ delete m.section; delete m.rate; }
    if (!this.isGst(w)){ delete m.tax; delete m.side; delete m.gstRate; }
    return m;
  },
  // fill every ledger not yet confirmed with the best guess; what the user set by hand is kept
  refresh(b){
    b.map = b.map || {};
    const regs = ((b.meta || {}).gstins || []).map(g => g.slice(0, 2)), info = b.ledInfo || {}, u = this.usage(b);
    const names = new Set(Object.keys(b.map).concat(Object.keys(info).filter(n => this.taxLike(n, null, info[n]))));
    names.forEach(n => {
      const m = b.map[n] = b.map[n] || {n: 0};
      m.n = (u[n] || {}).n || m.n || 0;
      // a client set up before the masters: what its ledgers were already marked as
      if (!m.what && m.kind) m.what = ({gst: m.rcm ? "gst_rcm" : "gst", gst_common: "gst_common", ineligible: "ineligible", tds_payable: "tds_payable", tds_receivable: "tds_receivable", bank: "bank", roundoff: "roundoff"})[m.kind] || "";
      if (m.ok || m.byHand) return;
      const p = this.propose(n, info[n], u[n], regs), tp = typeof this.tplFor === "function" ? this.tplFor(b, n) : null;
      if (tp && tp.what){
        this.applyWhat(m, tp.what);
        if (this.isGst(tp.what)){ m.tax = tp.tax || p.tax || m.tax; m.side = tp.side || p.side || m.side; m.reg = p.reg; m.gstRate = tp.gstRate || null; }
        if (this.isTds(tp.what)){ m.section = tp.section; m.rate = tp.rate; }
        m.why = "confirmed this way for " + tp.others + " other client" + (tp.others === 1 ? "" : "s") + (p.why ? "; " + p.why : "");
        return;
      }
      this.applyWhat(m, p.what);
      if (this.isGst(p.what)){ m.tax = p.tax || m.tax; m.side = p.side || m.side; m.reg = p.reg; if (p.gstRate != null) m.gstRate = p.gstRate; }
      if (this.isTds(p.what)){ m.section = p.section; m.rate = p.rate; }
      m.why = p.why;
    });
    // a TDS ledger with no section that is filled from the section ledgers and paid from the bank is a clearing account
    Object.entries(b.map).forEach(([n, m]) => {
      if (m.ok || m.byHand || m.what !== "tds_payable" || m.section) return;
      let cr = 0, fromTds = 0, paid = 0;
      (b.vouchers || []).forEach(v => { const e = v.ent.find(z => z.l === n); if (!e) return;
        if (e.a > 0){ cr++; if (v.ent.some(z => z !== e && z.a < 0 && (b.map[z.l] || {}).what === "tds_payable" && (b.map[z.l] || {}).section)) fromTds++; }
        else if (v.ent.some(z => /bank/.test((b.map[z.l] || {}).kind || ""))) paid++; });
      if (cr && fromTds / cr >= 0.8 && paid){ this.applyWhat(m, "tds_clearing"); m.why = fromTds + " of its " + cr + " credits move TDS from the section ledgers; paid from the bank " + paid + " times" + (m.why ? "; " + m.why.replace(/;?\s*no section: choose one, or mark it a general TDS account/, "") : ""); }
    });
    b.mapV = (b.mapV || 0) + 1;
    return b.map;
  },
  label(w){ const x = this.WHAT.find(z => z[0] === w); return x ? x[1] : "\u2014"; },
  RATES: [0.1, 0.25, 1, 1.5, 2.5, 3, 5, 6, 9, 12, 14, 18, 28],
  // what is still to be confirmed, and what the day book says against a choice
  pending(b){ return Object.entries((b && b.map) || {}).filter(([n, m]) => !m.ok && this.taxLike(n, m, (b.ledInfo || {})[n])); },
  checks(b, n, m){
    const u = (this._u && this._u.b === b.vouchers ? this._u.u : (this._u = {b: b.vouchers, u: this.usage(b)}).u)[n] || {regs: {}, rates: {}};
    const out = [];
    if (this.isGst(m.what)){
      if (m.side === "input" && u.onSaleCr) out.push("credited on " + u.onSaleCr + " sale" + (u.onSaleCr === 1 ? "" : "s"));
      if (m.side === "output" && u.onPurchDr && m.what !== "gst_rcm") out.push("debited on " + u.onPurchDr + " purchase" + (u.onPurchDr === 1 ? "" : "s"));
      const other = Object.entries(u.regs).filter(([r]) => m.reg && r !== m.reg);
      if (other.length) out.push("on " + other.reduce((a, x) => a + x[1], 0) + " vouchers Tally's voucher GSTIN is " + other.map(x => x[0]).join(", ") + "; the returns go by this ledger's registration");
      if (m.gstRate){
        const half = m.tax === "IGST" ? m.gstRate : m.gstRate / 2;
        const off = Object.entries(u.rates).filter(([r]) => Math.abs(num(r) - half) > 0.6).reduce((s, [, c]) => s + c, 0);
        if (off) out.push(off + " voucher" + (off === 1 ? "" : "s") + " at another rate");
      }
    }
    if (m.what === "tds_payable" && !m.section) out.push("no section: choose one; if it only collects the month's TDS from the section ledgers and is paid from the bank, it is a TDS clearing account");
    return out;
  },
  // who confirmed and when are kept on the ledger (shown on the ledgers page, on every computer); the check's own
  // record of the ledger (b.ledCheck, kept with the books) says confirmed or pending with it
  confirm(b, names, yes){ const who = typeof whoAmI === "function" ? whoAmI() : "", items = (b.ledCheck || {}).items || {};
    names.forEach(n => { const m = b.map[n]; if (m){ m.ok = !!yes; m.byHand = true; m.okAt = yes ? new Date().toISOString() : undefined; m.okBy = yes ? who : undefined; if (items[n]) items[n].state = yes ? "confirmed" : "pending"; } }); b.mapV = (b.mapV || 0) + 1;
    if (yes && typeof this.tplLearn === "function"){ this.tplLearn(b, names); try { const co = CO(); if (co && co.id === b.cid) this.applyPosting(b, co, "empty"); } catch (e){} } },
};


export {GST3B_SRC, entryShares, num, r2, INR, MONTHS3, toDateObj, fmtDate, ledEnt, ledClean, ledKey, LED_IDX, ledIdx, ledLook, ledUnder, ledGroupPath, STATE_CODES, NORM_CACHE, GRAM_CACHE, normName, gramsOf, normNameRaw, nameSim, BookItems, BookSrc, Books, CustIMS, GST2B, GSTAdv, GSTAmend, GSTF, GSTQ, GSTR, GSTRev, GSTSet, GSTV, ITCT, M2B, LedMaster, Audit};
