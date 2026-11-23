// Portions ported from Independent Books (MIT, (c) 2026 Independent Books Contributors), see THIRD_PARTY_NOTICES.md
//
// FinCom Books' rules for amounts, GST splits and bill-wise references, as plain functions (no DOM, no globals): the
// FinCom Books page uses them on the rows the database gives (fb_ledger's bill references), and own-books entry (P4)
// will use them for its form help and previews. The database's own checks (migration 220: Dr = Cr, splits and bill
// references add up) stay the final word; these never replace them.
// Ported from books.py at Independent Books commit 2a7f9fe8 (decimal, gst_components, calculate_item_gst, _bill_id,
// _due_date, _bill_rows, _normalize_bill_allocations, _validate_bill_allocations, ageing), rewritten for FinCom:
//   - money is whole paise (integers), rounded half up to the paisa, never a float sum;
//   - a debit is positive and a credit negative, as in fb_lines;
//   - the place of supply is the INVOICE's (its own state), never the party ledger's (plan 11.4);
//   - a tax line is known by its tax kind, never by its ledger's name (plan 11.4);
//   - a bill id is the plain key (ledger, name, voucher), not a hash.

// ---------------------------------------------------------------- amounts
// "1,23,456.78", " 5 000 ", "₹1,000" -> paise; junk refused; Infinity / NaN refused; half up to the paisa
export function parsePaise(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Amount must be finite");
    value = String(value);
  }
  if (typeof value === "bigint") return Number(value * 100n);
  let t = String(value).trim().replace(/,/g, "").replace(/₹/g, "").replace(/\s+/g, "");
  if (!t) return 0;
  if (/^[+-]?(inf(inity)?|nan)$/i.test(t)) throw new Error("Amount must be finite");
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
  if (!m || (m[2] === "" && (m[3] === undefined || m[3] === ""))) throw new Error("Invalid numeric amount");
  const neg = m[1] === "-";
  let int = m[2] || "0", frac = m[3] || "";
  let exp = m[4] ? parseInt(m[4], 10) : 0;
  // move the point by the exponent, in the digits (exact)
  if (exp > 0) { const take = frac.slice(0, exp).padEnd(exp, "0"); int = int + take; frac = frac.slice(exp); }
  else if (exp < 0) { const n = -exp; const pad = int.padStart(n + 1, "0"); frac = pad.slice(pad.length - n) + frac; int = pad.slice(0, pad.length - n); }
  int = int.replace(/^0+(?=\d)/, "");
  const f3 = (frac + "000").slice(0, 3);
  let paise = BigInt(int) * 100n + BigInt(f3.slice(0, 2));
  // ROUND_HALF_UP on the third digit (and the ones after it only matter when it is a 5: half up rounds a 5 up anyway)
  if (+f3[2] >= 5) paise += 1n;
  const out = Number(neg ? -paise : paise);
  if (!Number.isSafeInteger(out)) throw new Error("Amount must be finite");
  return out === 0 ? 0 : out;
}
// paise -> "1234.50" (as Independent Books' str(Decimal) at 0.01)
export function rupees(paise) {
  const n = Math.round(paise), s = n < 0 ? "-" : "", a = Math.abs(n);
  return s + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
}
// half up, for a product of paise and a rate in percent (rate given as a string or number, at most 4 decimals)
function pctHalfUp(paise, rate) {
  const r = BigInt(Math.round(+rate * 10000));          // rate x 10,000
  const num = BigInt(paise) * r;                        // paise x rate x 10,000
  const den = 1000000n;                                 // / 100 (percent) / 10,000
  const q = num / den, rem = num % den;
  return Number(rem * 2n >= den ? q + 1n : q);
}
const halfOf = (paise) => (paise % 2 === 0 ? paise / 2 : Math.floor(paise / 2) + 1);   // half up of an odd paisa

// ---------------------------------------------------------------- GST
// the supplier's state and the place of supply, as two-digit state codes ("27"); a GSTIN gives its first two digits.
// Same state = CGST + SGST; another state, or either one blank = IGST (Independent Books' blank-state rule: a missing
// state never makes a supply local); SEZ and export are IGST whatever the states.
export function stateOf(x) {
  const t = String(x || "").trim();
  return /^\d{2}/.test(t) ? t.slice(0, 2) : "";
}
export function isLocal({ supplierState, placeOfSupply, sez = false, exportSupply = false }) {
  const a = stateOf(supplierState), b = stateOf(placeOfSupply);
  return !sez && !exportSupply && !!a && !!b && a === b;
}
// one taxable value at one rate: tax = rate x value, half up to the paisa; CGST = half of it (half up), SGST = the rest,
// so the two always add up to the tax
export function gstSplit({ taxable, rate, supplierState, placeOfSupply, sez = false, exportSupply = false }) {
  const tv = parsePaise(taxable), r = +rate;
  if (!(tv > 0) || !(r > 0)) return [];
  const tax = pctHalfUp(tv, r);
  if (!isLocal({ supplierState, placeOfSupply, sez, exportSupply })) return [{ kind: "igst", amount: tax, rate: r }];
  const c = halfOf(tax);
  return [{ kind: "cgst", amount: c, rate: r / 2 }, { kind: "sgst", amount: tax - c, rate: r / 2 }];
}
// an invoice's items: tax worked out item by item (each half up), then added by kind. An item's GST rate is its gstRate,
// never its price ("rate"); a nil or exempt item, or one with no amount, adds nothing
export function itemGst(items, where) {
  const tot = { cgst: 0, sgst: 0, igst: 0 };
  for (const it of items || []) {
    const r = +(it.gstRate ?? 0), amt = parsePaise(it.amount ?? 0);
    if (!(r > 0) || !(amt > 0)) continue;
    for (const p of gstSplit(Object.assign({}, where, { taxable: amt / 100, rate: r }))) tot[p.kind] += p.amount;
  }
  return ["cgst", "sgst", "igst"].filter((k) => tot[k] > 0).map((k) => ({ kind: k, amount: tot[k] }));
}

// ---------------------------------------------------------------- bill-wise
export const REF_TYPES = ["new", "against", "advance", "on_account"];
const ymd = (d) => String(d || "").replace(/-/g, "").slice(0, 8);
const isoOf = (k) => (k ? k.slice(0, 4) + "-" + k.slice(4, 6) + "-" + k.slice(6, 8) : "");
export const billId = (ledger, name, source) => "bill:" + ledger + "\u001f" + name + "\u001f" + source;
// the due date: the one given, else the bill date plus the credit days, else none
export function dueDate(billDate, ref = {}) {
  if (ref.dueDate) return isoOf(ymd(ref.dueDate));
  const m = /(\d+)/.exec(String(ref.creditDays ?? ""));
  if (m && billDate) {
    const d = new Date(isoOf(ymd(billDate)) + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + +m[1]);
    return d.toISOString().slice(0, 10);
  }
  return "";
}
const effective = (v) => !v.cancelled && !v.memo && v.status !== "cancelled" && v.status !== "held" && v.status !== "sent";

// every bill of every party ledger at a date, with what is still pending, from the entries (a debit positive):
//   entries  [{id, date, number, status/cancelled/memo, lines: [{ledger, amount, bills: [{type, name, amount, billId?, billDate, dueDate, creditDays}]}]}]
//   parties  {ledger: "debtor" | "creditor"} (only these ledgers are bill-wise)
//   openings {ledger: paise} (a party's opening, not bill by bill: one On Account row)
// A New Ref makes a bill; an Against Ref settles one, by its id or by a name that is unique for that party (two bills of
// one name: the settlement is left unallocated, "ambiguous", never given to the first); an Advance or On Account is a
// row of its own; what a line does not allocate is On Account. Rows with nothing pending are left out.
export function billRows(entries, { parties = {}, openings = {}, asOf = "", exclude = "" } = {}) {
  const cut = asOf ? ymd(asOf) : "";
  const rows = new Map(), byName = new Map();
  const row = (id, ledger, name, party, date = "", due = "", source = "", kind = "bill") => {
    if (!rows.has(id)) rows.set(id, { billId: id, name, ledger, party, date: date ? isoOf(ymd(date)) : "", dueDate: due, original: 0, signedPending: 0, source, referenceKind: kind });
    return rows.get(id);
  };
  for (const [ledger, amt] of Object.entries(openings)) {
    const p = parties[ledger];
    if (p && amt) row(billId(ledger, "On Account", "opening"), ledger, "On Account", p, "", "", "opening", "unallocated").signedPending += amt;
  }
  const ordered = (entries || []).slice().sort((a, b) => (ymd(a.date) < ymd(b.date) ? -1 : ymd(a.date) > ymd(b.date) ? 1 : String(a.id) < String(b.id) ? -1 : 1));
  for (const v of ordered) {
    if (!effective(v) || (exclude && v.id === exclude) || (cut && ymd(v.date) > cut)) continue;
    for (const line of v.lines || []) {
      const p = parties[line.ledger];
      if (!p) continue;
      const sign = line.amount >= 0 ? 1 : -1, signed = (x) => sign * x;
      let allocated = 0;
      for (const ref of line.bills || []) {
        const value = Math.abs(ref.amount ?? line.amount);
        if (!value) continue;
        allocated += value;
        const type = ref.type || "new";
        if (type === "new") {
          const name = ref.name || "On Account", id = ref.billId || billId(line.ledger, name, v.id);
          const bd = ref.billDate || v.date;
          const r = row(id, line.ledger, name, p, bd, dueDate(bd, ref), v.id);
          r.original += value; r.signedPending += signed(value);
          const k = line.ledger + "\u001f" + name; if (!byName.has(k)) byName.set(k, new Set()); byName.get(k).add(id);
        } else if (type === "against") {
          let cand = ref.billId || "";
          const cands = cand ? [] : [...(byName.get(line.ledger + "\u001f" + (ref.name || "")) || [])];
          if (!cand && cands.length === 1) cand = cands[0];
          if (cand && rows.has(cand) && rows.get(cand).ledger === line.ledger) rows.get(cand).signedPending += signed(value);
          else {
            const r = row(billId(line.ledger, ref.name || "On Account", v.id), line.ledger, ref.name || "On Account", p, v.date, "", v.id, "unallocated");
            r.signedPending += signed(value); r.resolution = cands.length > 1 ? "ambiguous" : "unresolved";
          }
        } else {
          const label = ref.name || (type === "advance" ? "Advance" : "On Account");
          const r = row(ref.billId || billId(line.ledger, label, v.id), line.ledger, label, p, v.date, "", v.id, "unallocated");
          r.signedPending += signed(value);
        }
      }
      const residual = Math.abs(line.amount) - allocated;
      if (residual > 0) row(billId(line.ledger, "On Account", v.id), line.ledger, "On Account", p, v.date, "", v.id, "unallocated").signedPending += signed(residual);
    }
  }
  const out = [];
  for (const r of rows.values()) {
    if (!r.signedPending) continue;
    out.push(Object.assign({}, r, { pending: Math.abs(r.signedPending), drcr: r.signedPending >= 0 ? "Dr" : "Cr" }));
  }
  return out.sort((a, b) => ((a.date || "9999") < (b.date || "9999") ? -1 : (a.date || "9999") > (b.date || "9999") ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : a.billId < b.billId ? -1 : 1));
}

// a voucher's bill splits checked against the books before it is posted (Independent Books' _validate_bill_allocations):
// throws in plain words; returns the splits with each Against Ref's bill id filled in
export function checkBillSplits(entries, voucher, opts = {}) {
  if (!effective(voucher)) return voucher;
  const avail = billRows(entries, Object.assign({}, opts, { asOf: voucher.date, exclude: voucher.id })).filter((r) => r.referenceKind === "bill");
  const byId = new Map(avail.map((r) => [r.billId, r]));
  const byName = new Map();
  for (const r of avail) { const k = r.ledger + "\u001f" + r.name; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(r); }
  const asked = new Map();
  const all = () => billRows(entries, opts);
  for (const line of voucher.lines || []) {
    if (!(opts.parties || {})[line.ledger] || !(line.bills || []).length) continue;
    const total = Math.abs(line.amount);
    let allocated = 0;
    for (const ref of line.bills) {
      const type = ref.type || "new";
      if (!REF_TYPES.includes(type)) throw new Error("Unknown bill allocation method");
      const value = Math.abs(ref.amount ?? line.amount);
      allocated += value;
      if (type !== "against") continue;
      const id = String(ref.billId || "").trim();
      let bill = id ? byId.get(id) : null;
      if (!bill && !id) {
        const m = byName.get(line.ledger + "\u001f" + String(ref.name || "").trim()) || [];
        if (m.length > 1) throw new Error("ambiguous bill reference");
        bill = m[0] || null;
      }
      if (!bill) {
        if (id && all().some((r) => r.billId === id)) throw new Error("Allocation belongs to another party or bill is unavailable");
        throw new Error("Bill reference is future, unknown, or already settled");
      }
      if (bill.ledger !== line.ledger) throw new Error("Allocation belongs to another party");
      if (bill.signedPending * line.amount >= 0) throw new Error("Settlement must be on the opposite Dr/Cr side of the bill");
      asked.set(bill.billId, (asked.get(bill.billId) || 0) + value);
      if (asked.get(bill.billId) > bill.pending) throw new Error("Allocation exceeds pending bill amount");
      ref.billId = bill.billId;
    }
    if (allocated > total) throw new Error("Allocation exceeds voucher amount");
    if (line.bills.some((r) => (r.type || "new") === "against") && allocated !== total) throw new Error("Allocation sum must equal voucher amount");
  }
  return voucher;
}

// a split being typed (Independent Books' _normalize_bill_allocations): {method, amount, allocations, residual}, all in
// paise; refuses what could never be posted
export function previewSplits(entries, { ledger, amount, method, allocations = [], asOf = "", exclude = "" }, opts = {}) {
  if (!(opts.parties || {})[ledger]) throw new Error("Select a debtor or creditor party ledger");
  const total = Math.abs(parsePaise(amount));
  if (!(total > 0)) throw new Error("Allocation amount must be positive");
  if (!REF_TYPES.includes(method)) throw new Error("Unknown allocation method");
  const pending = new Map(billRows(entries, Object.assign({}, opts, { asOf, exclude })).filter((r) => r.ledger === ledger).map((r) => [r.billId, r]));
  const out = []; let allocated = 0; const per = new Map();
  for (const a of allocations) {
    const m = a.method || method;
    if (!REF_TYPES.includes(m)) throw new Error("Unknown allocation method");
    const id = String(a.billId || "").trim(), name = String(a.name || "").trim();
    let bill = m === "against" ? pending.get(id) || null : null;
    if (m === "against" && id && !bill) {
      const every = new Map(billRows(entries, opts).map((r) => [r.billId, r]));
      if (every.has(id)) throw new Error(every.get(id).ledger !== ledger ? "Allocation belongs to another party" : "Bill reference is not available for settlement");
      throw new Error("Unknown bill ID");
    }
    if (m === "against" && !bill && !id && name) {
      const hits = [...pending.values()].filter((r) => r.name === name);
      if (hits.length > 1) throw new Error("ambiguous bill reference");
      bill = hits[0] || null;
    }
    const value = Math.abs(parsePaise(a.amount));
    if (m === "against") {
      if (!bill) throw new Error("Bill reference is required for Agst Ref");
      per.set(bill.billId, (per.get(bill.billId) || 0) + value);
      if (per.get(bill.billId) > bill.pending) throw new Error("Allocation exceeds pending bill amount");
    }
    if (!(value > 0)) throw new Error("Allocation amount must be positive");
    if ((m === "new" || m === "advance") && !name) throw new Error("Reference name is required");
    allocated += value;
    const item = Object.assign({}, a, { billId: bill ? bill.billId : id, name: bill ? bill.name : name, amount: value, method: m });
    for (const f of ["date", "dueDate"]) if (item[f]) item[f] = isoOf(ymd(item[f]));
    out.push(item);
  }
  if (allocated > total) throw new Error("Allocation exceeds voucher amount");
  return { method, amount: total, allocations: out, residual: total - allocated };
}

// ageing at a date, by due date or by bill date: under 30 days, 30-60, 60-90 (90 itself included), over 90; bills not
// yet due (due-date basis) and bills with no date are listed apart, never dropped
export function ageing(rows, asOf, basis = "due_date") {
  if (basis !== "due_date" && basis !== "invoice_date") throw new Error("Ageing basis must be due_date or invoice_date");
  const cut = new Date(isoOf(ymd(asOf)) + "T00:00:00Z");
  const buckets = { "<30": [], "30-60": [], "60-90": [], ">90": [] }, undated = [], notYetDue = [];
  for (const r of rows) {
    const v = basis === "due_date" ? r.dueDate : r.date;
    if (!v) { undated.push(r); continue; }
    const days = Math.round((cut - new Date(isoOf(ymd(v)) + "T00:00:00Z")) / 86400000);
    if (days < 0 && basis === "due_date") { notYetDue.push(r); continue; }
    const b = days < 30 ? "<30" : days < 60 ? "30-60" : days <= 90 ? "60-90" : ">90";
    buckets[b].push(Object.assign({}, r, { ageDays: days, bucket: b }));
  }
  return { asOf: isoOf(ymd(asOf)), basis, buckets, undated, notYetDue, rows: [...buckets["<30"], ...buckets["30-60"], ...buckets["60-90"], ...buckets[">90"], ...notYetDue, ...undated] };
}

// fb_ledger's bill references (rupees, a debit positive) as billRows' entries, for one party ledger
export function entriesFromRefs(ledger, refs) {
  const by = new Map();
  for (const r of refs || []) {
    if (!by.has(r.voucher)) by.set(r.voucher, { id: r.voucher, date: r.date, number: r.number, lines: [{ ledger, amount: 0, bills: [] }] });
    const line = by.get(r.voucher).lines[0], amt = parsePaise(r.amount);
    line.amount += amt;
    line.bills.push({ type: r.type, name: r.name, amount: amt, billDate: r.bill_date || "", dueDate: r.due || "", creditDays: r.days ?? "" });
  }
  return [...by.values()];
}
