/* @react-lazy: begin 96-bank-newled.js (the React app loads this file with the Bank screen: app/src/screens/Bank.jsx, app/src/parts/bank/NewLedgers.jsx; build.py react_parts) */
/* ================================================================== */
/* New Tally ledgers from the bank page (next-bank-newled)              */
/* ================================================================== */
// The owner (20-Nov-2026): "an option in bank page that by ticking only that any name of person or company or item...
// system should suggest the ledger name to be created in tally.. we can create it single and multi select the rows".
// Rules only (no AI). A line with no ledger matched and a party name read from its narration (decodeNarr, src/js/21)
// gets a suggested NEW ledger: the name cleaned and title-cased, the group guessed (money in: Sundry Debtors, money out:
// Sundry Creditors; editable). A name close to a ledger Tally has says "Similar: …" instead. A review list (one line per
// party, the ticked lines of one party merged) is confirmed once; Create makes every ledger in ONE Bridge.post of the
// existing Import (ledgerMasterXml, src/js/22), with the client, so the linked-company rule applies; then the lines use
// them. Name and group only (the account number and IFSC only when the narration has both, as the one-ledger dialog
// reads them). Bridge or link not ready: nothing is sent and the page says why; the ledgers wait as pending new ledgers
// (b.newLed) and go with the next posting, as before.
const NewLed = {
  busy: false,
  // the bank's and the payment app's words, honorifics and filler: never part of a ledger name
  NOISE: /\b(UPI|NEFT|RTGS|IMPS|MMT|P2A|P2M|DR|CR|TRF|TRANSFER|BY|TO|FROM|INB|IB|CHQ|CHEQUE|CLG|ACH|NACH|ECS|PAYMENT|PAYMENTS|PAY|PAID|SENT|RECEIVED|REF|UTR|NA|NO|INR|RS|FT|INFT|NET ?BANK(?:ING)?|NETBANK|MOBILE|MB|BANKING|ONLINE|FUND|FR|FOR|TOWARDS|AGAINST|BILL|INVOICE|INV|MUM|DEL|MR|MRS|MS|M ?S|SHRI|SMT|SH|MESSRS|OK|QR|PAYTMQR|BHARATPE|GPAY|PHONEPE|PYTM|PAYTM|YBL|IBL|AXL|OKAXIS|OKHDFCBANK|OKICICI|OKSBI|HDFC|ICICI|SBI|AXIS|KOTAK|YES|IDFC|INDUSIND|CANARA|PNB|BOB|FEDERAL|RBL|BANK)\b/gi,
  // a line that is not a party: cash, the bank's own charges and interest
  NOT_PARTY: ["ATM", "CASH", "CHARGES", "INTEREST"],
  UPPER: new Set(["LLP", "HUF", "OPC", "LLC", "II", "III", "IV", "IT", "HR"]),
  // a usable ledger name from what the narration gave, or "": no handle, UPI id, reference or number, no filler
  clean(raw, row){
    let s = String(raw || "");
    // "M/S DEEPAK HARDWARE" is read as "S DEEPAK HARDWARE" (the "/" splits it): the honorific goes
    if (row && /^S\s/i.test(s) && new RegExp("\\bM\\s*/\\s*" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(row.narr || "")) s = s.slice(2);
    s = s.split(/[\s\/|*:,]+/).filter(t => t && !/@/.test(t) && !/\d/.test(t) && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(t)).join(" ");
    s = s.replace(/[._\-]+/g, " ").replace(this.NOISE, " ").replace(/[^A-Za-z&' ]+/g, " ").replace(/\s+/g, " ").trim();
    s = s.replace(/^(&|and)\s+|\s+(&|and)$/gi, "");
    const letters = (s.match(/[A-Za-z]/g) || []).length;
    if (letters < 3 || !/[A-Za-z]{3}/.test(s)) return "";
    // a name made only of remark words is no party ("Salary", "Rent")
    if (/^(rent|salary|fees?|refund|advance|loan|emi|misc|others?|expenses?|purchase|sale|self|cash)$/i.test(s)) return "";
    const words = s.split(" ").slice(0, 8);
    return words.map(w => this.UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w === "&" ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ").slice(0, 70).trim();
  },
  // the name for a line, or "": only from its party name, or a UPI handle that spells one (never a number handle)
  nameOf(r){
    const d = r.dec || {};
    if (this.NOT_PARTY.includes(d.mode)) return "";
    const h = String(d.upi || "").split("@")[0];
    // a name read from a machine handle ("paytmqr2810…abc@paytm"): not a name
    if (d.name && h && (h.match(/\d/g) || []).length >= 4 && nameSim(d.name, h.replace(/\d+/g, " ")) >= 0.8) return "";
    return this.clean(d.name, r);
  },
  // a line that may get a new ledger: open, and no ledger matched (a line with a ledger is never offered one)
  open(r){ return !!r && r.state === "attention" && !String(r.ledger || "").trim() && !(r.splits || []).length; },
  dir(r){ return num(r.debit) ? "out" : "in"; },
  // the groups Tally has (the ledger list's), then Tally's own; one of each whatever its capitals
  groups(){
    const b = B(), seen = new Set(), list = Ledgers.list(b && b.cid) || [];
    return [].concat((b && b.ledgers && b.ledgers.groups) || [], list.map(l => l.group), TALLY_GROUPS).filter(g => g && !seen.has(String(g).toLowerCase()) && seen.add(String(g).toLowerCase()));
  },
  groupFor(dir){ const g = dir === "in" ? "Sundry Debtors" : "Sundry Creditors"; return this.groups().find(x => x.toLowerCase() === g.toLowerCase()) || g; },
  // a ledger Tally has (or one made here, waiting) with a name close to this one: its name, else ""
  _sim: {k: null, m: new Map()},
  similar(name){
    const k = knownLedgers();
    if (this._sim.k !== k) this._sim = {k, m: new Map()};
    const key = ledgerKey(name);
    if (this._sim.m.has(key)) return this._sim.m.get(key);
    let best = "", bs = 0;
    k.forEach(l => { const s = ledgerKey(l.name) === key ? 1 : nameSim(l.name, name); if (s >= 0.7 && s > bs){ bs = s; best = l.name; } });
    this._sim.m.set(key, best);
    return best;
  },
  // the suggestion for one line: {name, group, similar} or null
  guess(r){
    if (!this.open(r) || !hasLedgerList()) return null;
    const name = this.nameOf(r);
    if (!name) return null;
    return {name, group: this.groupFor(this.dir(r)), similar: this.similar(name)};
  },
  // the account number and IFSC, only when the narration has both (as the one-ledger dialog reads them)
  bankOf(r){
    const u = String(r.narr || "").toUpperCase(), ifsc = (u.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/) || [])[1] || "";
    const ac = ((u.match(/\b(\d{9,18})\b/g) || []).find(n => n !== String((r.dec || {}).utr || "")) || "");
    return ifsc && ac ? {acNo: ac, ifsc} : {acNo: "", ifsc: ""};
  },
  // the review list for these lines: one line per new name (the lines of one party merged), what was left out
  plan(rows){
    const lines = new Map();
    let had = 0, none = 0;
    rows.forEach(r => {
      if (!this.open(r)){ if (r.ledger) had++; else none++; return; }
      const g = this.guess(r);
      if (!g){ none++; return; }
      const k = ledgerKey(g.name);
      const ln = lines.get(k) || lines.set(k, {key: k, name: g.name, similar: g.similar, rows: [], in: 0, out: 0, amt: 0, bank: null, on: !g.similar}).get(k);
      ln.rows.push(r.id); ln[this.dir(r)]++; ln.amt = r2(ln.amt + num(r.debit || r.credit));
      const bk = this.bankOf(r); ln.bank = ln.bank === null ? bk : (ln.bank.acNo === bk.acNo && ln.bank.ifsc === bk.ifsc ? ln.bank : {acNo: "", ifsc: ""});
    });
    const out = Array.from(lines.values()).map(ln => Object.assign(ln, {group: this.groupFor(ln.in > ln.out ? "in" : "out")}));
    return {lines: out, had, none, n: rows.length};
  },
  // the bulk bar: how many of these lines could get a new ledger
  count(rows){ return rows.filter(r => this.guess(r)).length; },
  // why nothing can be sent now (as posting says it: src/js/26 ensureTallyCompany), after it said no
  whyNot(co){
    if (!Bridge.on()) return "FinCom Bridge is not connected" + (typeof TCloud === "object" && TCloud.on() ? ", and the Tally company of " + co.name + " is not open on any computer" : "") + ".";
    if (!Bridge.up() || !Bridge.st.tallyUp) return "Tally is not connected.";
    return "The Tally company of " + co.name + " is not open in Tally.";
  },
  // Create: lines [{name, group, rows: [ids], bank}] -> {results: [{name, group, kind, word}], why, rows}
  // kind: created | already (Tally had it: that ledger is used) | waiting (not sent: goes with the next posting) | failed
  async create(lines){
    if (this.busy) return null;                     // a second press while the first runs sends nothing
    this.busy = true;
    const b = B(), co = CO(b.cid), out = [], now = new Date().toISOString();
    let why = "";
    try {
      const fresh = [], seen = new Set();
      lines.forEach(ln => {
        const name = String(ln.name || "").replace(/\s+/g, " ").trim(), group = String(ln.group || "").trim() || this.groupFor("out");
        const res = {name, group, rows: ln.rows || [], kind: "", word: ""};
        out.push(res);
        if (!name){ Object.assign(res, {kind: "failed", word: "Failed: no name"}); return; }
        if (seen.has(name.toLowerCase())){ Object.assign(res, {kind: "dup"}); return; }
        seen.add(name.toLowerCase());
        const has = exactLedger(name), info = has ? ledgerInfo(has) : null;
        if (has && !(info && info.pending)){ Object.assign(res, {kind: "already", name: has, word: "Already in Tally"}); return; }
        const bk = ln.bank || {};
        b.newLed = (b.newLed || []).filter(l => l.name.toLowerCase() !== name.toLowerCase());
        const led = {name, group, pan: "", gstin: "", acNo: bk.acNo || "", ifsc: bk.ifsc || "", at: now, sent: false};
        b.newLed.push(led); res.led = led; fresh.push(res);
      });
      // the same name twice in the list: one ledger, both lines' rows
      out.filter(x => x.kind === "dup").forEach(x => { const first = out.find(y => y !== x && y.kind !== "dup" && y.name.toLowerCase() === x.name.toLowerCase()); if (first) first.rows = first.rows.concat(x.rows); });
      saveBank({newLed: true});
      let sent = 0;
      if (fresh.length){
        const tname = await ensureTallyCompany(co);
        if (!tname) why = this.whyNot(co);
        else if (Bridge.st.allowImport === false && bridgeLive(co)) why = "Posting is switched off in the bridge settings (AllowImport).";
        else {
          // the review was the confirm: the posting's own "Create new ledgers?" is not asked again
          if (typeof PostGate === "object") PostGate.approve(fresh.map(x => x.name), tname);
          try {
            const j = await Bridge.post({company: tname, client: co.id, masters: fresh.map(x => ({id: "led:" + x.name, xml: ledgerMasterXml(x.led)})), vouchers: []});
            const byId = new Map([].concat(j.results || []).map(x => [x.id, x]));
            if (j.notAllowed) why = plainMsg(([].concat(j.results || []).find(x => x.notAllowed) || {}).message || postToProblem(co, tname));
            fresh.forEach(x => {
              const r = byId.get("led:" + x.name);
              if (!r || j.notAllowed || r.held){ x.kind = "waiting"; if (r && r.held && !why) why = plainMsg(r.message); return; }
              if (r.ok){
                x.led.sent = true; x.led.sentAt = now; sent++;
                x.kind = r.existed || postAltered(r) ? "already" : "created";
                x.word = x.kind === "already" ? "Already in Tally" : "Created";
                if (x.kind === "created") logPosting({what: "ledger", id: "led:" + x.name, action: "created", co: b.cid, ref: x.name, party: x.group, amount: 0, tally: {company: r.company || tname}, by: (Cloud.st && Cloud.st.email) || ""});
                return;
              }
              x.kind = "failed"; x.word = "Failed: " + (plainMsg(r.message) || "Tally did not accept it");
              b.newLed = b.newLed.filter(l => l !== x.led);
            });
          } catch (e){
            why = e && e.code === "cancelled" ? "Nothing was sent to Tally." : "Could not create them in Tally now: " + plainMsg((e && e.message) || e) + ".";
            fresh.forEach(x => { x.kind = "waiting"; });
          }
        }
        fresh.forEach(x => { if (!x.kind) x.kind = "waiting"; if (x.kind === "waiting") x.word = "Not sent: goes to Tally with the next posting"; });
      }
      // the lines use their ledgers (every other open line of the party follows: setLedgerFor), then the rest is suggested again
      if (sent) try { await syncLedgersFromTally(true); } catch (e){}
      out.forEach(x => {
        if (x.kind === "failed" || x.kind === "dup" || !x.rows.length) return;
        const l = exactLedger(x.name) || x.name, rows = x.rows.map(id => bankRow(id)).filter(r => r && ["attention", "suggested"].includes(r.state) && (!String(r.ledger || "").trim() || ledgerKey(r.ledger) === ledgerKey(l)));
        if (rows.length) setLedgerFor(rows, l, "newled");
      });
      b.undo = null;
      suggestAll(b.rows, true);
      saveBank({rows: true, newLed: true});
    } finally { this.busy = false; }
    return {results: out.filter(x => x.kind !== "dup").map(x => ({name: x.name, group: x.group, kind: x.kind, word: x.word, n: x.rows.length})), why};
  }
};
if (typeof globalThis === "object") Object.assign(globalThis, {NewLed});
/* @react-lazy: end */
