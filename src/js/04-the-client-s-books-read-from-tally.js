/* ================================================================== */
/* The client's books, read from Tally: vouchers, ledgers, mapping    */
/* ================================================================== */
// Books's part the GSTR-3B engine runs is in server/_shared/gst3b.js (shared with the gst-run function); the rest is put on it here
Object.assign(Books, {
  // round 64 (the owner's GB TEXCOAT, 16-Oct-2026): an entry of a voucher type with no accounting effect in Tally (an order, a
  // delivery or receipt note, a rejection, material in or out, a memorandum, a reversing journal) never moves a ledger in
  // Tally's books. Tally's export carries no field saying so, so it is read from the voucher type: Tally's own predefined
  // type by name (VCHTYPE, VOUCHERTYPENAME or VOUCHERTYPEORIGNAME), else no accounting effect itself (lines that do not total
  // zero, with order details on the items). Such an entry is kept marked not in the books (opt), as an Optional entry is.
  // The same rule as the cloud's reader (server/tally-cloud/parse.js nonAccounting; tests/run_order_vouchers.py)
  NON_ACC_TYPES: ["purchase order", "sales order", "job work in order", "job work out order", "delivery note", "receipt note",
    "rejections in", "rejections out", "material in", "material out", "memorandum", "reversing journal"],
  nonAccounting(s, amts){
    const tag = (t) => { const m = s.match(new RegExp("<" + t + "(?:\\s[^<>]*[^/<>])?\\s*>([^<]*)</" + t + "\\s*>")); return m ? namesClean(m[1]) : ""; };
    const names = [namesClean((s.match(/VCHTYPE="([^"]*)"/) || [])[1] || ""), tag("VOUCHERTYPENAME"), tag("VOUCHERTYPEORIGNAME")].map(x => String(x || "").trim());
    const hit = names.find(x => x && this.NON_ACC_TYPES.includes(x.toLowerCase()));
    if (hit) return hit;
    if (amts && amts.length && /<ORDERNO(?:\s[^<>]*)?>\s*[^<\s]|<ORDERDUEDATE[\s>]/.test(s)){
      const sum = Math.round(amts.reduce((t, a) => t + (Number(a) || 0), 0) * 100) / 100;
      if (Math.abs(sum) > 0.01) return (names.find(Boolean) || "an order") + " (no accounting effect: its lines do not total zero)";
    }
    return "";
  },
  // speed (11-Nov-2026: a linked client's first opening read each month in one task, up to 0.5 s with the page frozen):
  // the browser gets its turn whenever a piece of work has run SLICE ms (a message, not a timer: no 4 ms wait each time)
  SLICE: 30,
  pause(){
    if (typeof scheduler === "object" && scheduler && typeof scheduler.yield === "function") return scheduler.yield().catch(() => {});
    if (typeof MessageChannel !== "function") return typeof setTimeout === "function" ? new Promise(r => setTimeout(r, 0)) : Promise.resolve();
    return new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });
  },
  now(){ return typeof performance === "object" && performance ? performance.now() : Date.now(); },
  // a slice's clock: due() once SLICE ms have passed since the browser last had its turn; give() gives it (a new slice)
  slicer(){ let t = this.now(); return {due: () => Books.now() - t > Books.SLICE, async give(){ await Books.pause(); t = Books.now(); }}; },
  // Tally exports can be very large, so the file is read in pieces and only what we use is kept
  async importDayBook(file, onProgress){
    const dec = await this.decoder(file);
    const out = [], meta = {company: "", from: "", to: "", gstins: new Set(), bills: 1, cc: 1};
    let buf = "", read = 0;
    const reader = file.stream().getReader(), sl = this.slicer();
    const take = async () => {
      let cut;
      while ((cut = buf.indexOf("</VOUCHER>")) >= 0){
        const piece = buf.slice(0, cut + 10);
        buf = buf.slice(cut + 10);
        const start = piece.lastIndexOf("<VOUCHER ");
        if (start >= 0) this.takeVoucher(piece.slice(start), out, meta);
        if (sl.due()) await sl.give();
      }
    };
    for (;;){
      const {done, value} = await reader.read();
      if (done) break;
      read += value.length;
      buf += dec.decode(value, {stream: true});
      await take();
      if (buf.length > 400000) buf = buf.slice(-200000);
      if (onProgress && out.length % 250 === 0) onProgress("Read " + out.length + " vouchers (" + Math.round(read / 1048576) + " MB)…");
    }
    buf += dec.decode();
    await take();
    meta.gstins = Array.from(meta.gstins);
    const dates = out.map(v => v.date).filter(Boolean).sort();
    meta.from = dates[0] || ""; meta.to = dates[dates.length - 1] || "";
    // build 191: each entry's words are cut from the file's text, and the browser keeps the whole text alive behind
    // them (a year's day book of 400 MB stayed in memory: 430 MB used for 7 MB of entries). A copy lets it go
    // (speed: copied a few hundred entries at a time, the browser given its turn between)
    return {vouchers: await this.copyOut(out, sl), meta};
  },
  async copyOut(out, sl){
    const cp = x => typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x));
    try {
      const clean = [];
      for (let i = 0; i < out.length; i += 250){ clean.push(...cp(out.slice(i, i + 250))); if (sl && sl.due()) await sl.give(); }
      return clean;
    } catch (e){ return out; }
  },
  // build 195: which Tally company a file was exported from: its name (SVCURRENTCOMPANY) and the company part of the
  // entries' GUIDs (the same in every export of that company), and the first registration in it
  async fileCompany(file){
    const dec = await this.decoder(file);
    const head = dec.decode(new Uint8Array(await file.slice(0, 262144).arrayBuffer()));
    const un = t => String(t || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    const name = un((head.match(/<SVCURRENTCOMPANY>([^<]*)<\/SVCURRENTCOMPANY>/) || [])[1]);
    const guid = ((head.match(/<GUID>([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9a-f]+<\/GUID>/i) || [])[1] || "").toLowerCase();
    const gstin = ((head.match(/<CMPGSTIN>([0-9A-Z]{15})<\/CMPGSTIN>/i) || [])[1] || "").toUpperCase();
    return {name, guid, gstin};
  },
  // the file's text encoding: UTF-16 by its byte-order mark, else (the owner, 17-Oct-2026: a new company's Day Book refused)
  // UTF-16 without the mark, told by the zero bytes at every other place in its first bytes (ASCII text in UTF-16LE has
  // the zero second: "<" is 3C 00), as FinCom's server tells it (server/tally-cloud, uploadPiece); else UTF-8
  async decoder(file){
    return new TextDecoder(this.encodingOf(new Uint8Array(await file.slice(0, 64).arrayBuffer())));
  },
  encodingOf(head){
    if (head[0] === 0xFF && head[1] === 0xFE) return "utf-16le";
    if (head[0] === 0xFE && head[1] === 0xFF) return "utf-16be";
    const n = head.length & ~1, half = n / 2;
    if (n >= 2){
      let odd = 0, even = 0;
      for (let i = 0; i < n; i++) if (!head[i]){ if (i % 2) odd++; else even++; }
      if (head[1] === 0 && head[0] !== 0 && odd >= half * 0.6 && even <= half * 0.2) return "utf-16le";
      if (head[0] === 0 && head[1] !== 0 && even >= half * 0.6 && odd <= half * 0.2) return "utf-16be";
    }
    return "utf-8";
  },
  // a whole file's text in its own encoding (Blob.text() reads UTF-8 only; a Tally export is often UTF-16LE)
  async text(file){
    return (await this.decoder(file)).decode(new Uint8Array(await file.arrayBuffer()));
  },
  // Tally writes "Applicable" or "Not Applicable", sometimes with a stray character in front
  yesFlag(v){ const t = String(v || "").replace(/[^A-Za-z ]/g, " ").trim().toLowerCase(); return /\bapplicable\b/.test(t) && !/\bnot\b/.test(t); },
  // "$17000.00 @ ₹ 86.40/$ = ₹ 1468800.00" is 1468800: the rupee value after the last "="
  amt(v){ const t = String(v || ""), i = t.lastIndexOf("="); return num(i >= 0 ? t.slice(i + 1) : t); },
  // the IGST rate in a block's rate details, which is the whole GST rate; null when not set
  igstRate(s){ const m = String(s || "").match(/<GSTRATEDUTYHEAD>IGST<\/GSTRATEDUTYHEAD>\s*<GSTRATEVALUATIONTYPE>[^<]*<\/GSTRATEVALUATIONTYPE>\s*<GSTRATE>\s*([\d.]+)\s*<\/GSTRATE>/); return m ? num(m[1]) : null; },
  one(s, tag){ const m = s.match(new RegExp("<" + tag + ">([^<]*)</" + tag + ">")); return m ? this.unesc(m[1]) : ""; },
  // every value read from Tally's XML, names first: entities decoded (also escaped twice, "&amp;#13;&amp;#10;"), line
  // breaks one space, ends trimmed; the one rule the cloud reader uses too (server/_shared/names.js, namesClean)
  unesc(v){ return namesClean(v); },
  // each pay head of a payroll voucher, summed over its employees: [[pay head, amount]] (Tally's sign: debit negative)
  payheads(s){
    if (s.indexOf("<PAYHEADALLOCATIONS.LIST>") < 0) return [];
    const by = new Map();
    s.split("<PAYHEADALLOCATIONS.LIST>").slice(1).forEach(p => {
      const q = p.split("</PAYHEADALLOCATIONS.LIST>")[0], n = this.one(q, "PAYHEADNAME"), a = this.amt(this.one(q, "AMOUNT"));
      if (n && a) by.set(n, Math.round(((by.get(n) || 0) + a) * 100) / 100);
    });
    return Array.from(by.entries()).filter(([, a]) => Math.abs(a) >= 0.005);
  },
  takeVoucher(s, out, meta){
    const type = (s.match(/VCHTYPE="([^"]*)"/) || [])[1] || "";
    const v = {
      id: String(this.one(s, "GUID") || (s.match(/REMOTEID="([^"]*)"/) || [])[1] || "").replace(/[^\w\-.:]/g, ""),
      date: this.one(s, "DATE"), type,
      no: this.one(s, "VOUCHERNUMBER"), ref: this.one(s, "REFERENCE"), refDate: this.one(s, "REFERENCEDATE"), irn: this.one(s, "IRN"), irnDate: this.one(s, "IRNACKDATE"),
      party: this.one(s, "PARTYNAME") || this.one(s, "PARTYLEDGERNAME"),
      gstin: this.one(s, "PARTYGSTIN"), pos: this.one(s, "PLACEOFSUPPLY"),
      cmp: this.one(s, "CMPGSTIN"), narr: this.one(s, "NARRATION").slice(0, 120),
      regType: this.one(s, "GSTREGISTRATIONTYPE"),
      country: this.one(s, "COUNTRYOFRESIDENCE"),
      rcm: this.yesFlag(this.one(s, "GSTOVRDNISREVCHARGEAPPL")) || this.one(s, "ISREVERSECHARGEAPPLICABLE") === "Yes",
      taxability: this.one(s, "GSTOVRDNTAXABILITY"),
      // round 43: Tally's nature of the transaction ("Sales to SEZ - Taxable", "Exports - LUT/Bond", ...), the first a line has
      nature: this.one(s, "GSTOVRDNNATURE"),
      supply: this.one(s, "GSTOVRDNTYPEOFSUPPLY"),
      ineligibleFlag: this.yesFlag(this.one(s, "GSTOVRDNINELIGIBLEITC")),
      hsn: Array.from(new Set((s.match(/<GSTHSNNAME>([^<]*)<\/GSTHSNNAME>/g) || []).map(x => x.replace(/<[^>]*>/g, "").trim()).filter(Boolean))),
      by: this.one(s, "ENTEREDBY"), upd: this.one(s, "UPDATEDDATETIME").slice(0, 8),
      cancel: this.one(s, "ISCANCELLED") === "Yes", opt: this.one(s, "ISOPTIONAL") === "Yes",
      // round 44: Tally's AlterID, so the later of the Day Book's and the bridge's versions of an entry is the one kept (BookSrc)
      alt: /\d/.test(this.one(s, "ALTERID")) ? Math.round(num(this.one(s, "ALTERID"))) : null,
      ent: []
    };
    if (v.cmp) meta.gstins.add(v.cmp);
    // each item's HSN, rate and goods or services, for the accounting allocation inside it
    const items = [];
    if (s.indexOf("<ALLINVENTORYENTRIES.LIST>") >= 0){
      let at = 0;
      for (;;){
        const a = s.indexOf("<ALLINVENTORYENTRIES.LIST>", at); if (a < 0) break;
        const z = s.indexOf("</ALLINVENTORYENTRIES.LIST>", a); if (z < 0) break;
        const own = s.slice(a, z).replace(/<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST>/g, "");
        const qm = this.one(own, "BILLEDQTY").match(/^\s*(-?[\d.,]+)\s*([A-Za-z][A-Za-z.]*)?/);
        items.push({a, z, h: this.one(own, "GSTHSNNAME"), hd: this.one(own, "GSTHSNDESCRIPTION"), gr: this.igstRate(own), sp: this.one(own, "GSTOVRDNTYPEOFSUPPLY"),
          q: qm ? Math.abs(num(qm[1].replace(/,/g, ""))) : 0, u: qm && qm[2] ? qm[2].replace(/\./g, "").toUpperCase() : ""});
        at = z + 1;
      }
    }
    // an item invoice keeps the purchase or sales ledger inside each item, in its accounting allocation
    [["<ALLLEDGERENTRIES.LIST>", "</ALLLEDGERENTRIES.LIST>"], ["<LEDGERENTRIES.LIST>", "</LEDGERENTRIES.LIST>"], ["<ACCOUNTINGALLOCATIONS.LIST>", "</ACCOUNTINGALLOCATIONS.LIST>"]].forEach(([open2, close]) => {
      let pos = -1;
      s.split(open2).slice(1).forEach(p => {
        pos = s.indexOf(open2, pos + 1);
        const e = p.split(close)[0];
        const name = this.one(e, "LEDGERNAME");
        if (!name) return;
        const x = {l: name, a: this.amt(this.one(e, "AMOUNT")), r: num(this.one(e, "GSTRATE")) || null};
        // the line's own HSN and rate (a ledger invoice), else the item's it sits in
        const it = open2 === "<ACCOUNTINGALLOCATIONS.LIST>" ? items.find(q => pos > q.a && pos < q.z) : null;
        const lh = it ? it.h : this.one(e, "GSTHSNNAME"), lr = it ? it.gr : this.igstRate(e), ls = it ? it.sp : this.one(e, "GSTOVRDNTYPEOFSUPPLY");
        if (lh) x.h = lh;
        if (lr != null) x.gr = lr;
        if (ls) x.sp = ls;
        const ld = it ? it.hd : this.one(e, "GSTHSNDESCRIPTION");
        if (ld) x.hd = ld;
        if (it && it.q){ x.q = it.q; if (it.u) x.u = it.u; it.q = 0; }   // the item's quantity, once, on its first allocation
        // bill-wise details: [ref name, New Ref / Agst Ref / Advance / On Account, amount]
        if (e.indexOf("<BILLALLOCATIONS.LIST>") >= 0){
          const bl = e.split("<BILLALLOCATIONS.LIST>").slice(1).map(p2 => {
            const q = p2.split("</BILLALLOCATIONS.LIST>")[0];
            // review of 01-Oct-2026: Tally's credit period on a New Ref ("30 Days"), so ageing can run from the due date
            const cp = (q.match(/<BILLCREDITPERIOD\b[^>]*>([^<]*)<\/BILLCREDITPERIOD>/) || [])[1] || "", dm = cp.match(/^\s*(\d{1,4})\s*Days?\s*$/i);
            return dm ? [this.one(q, "NAME"), this.one(q, "BILLTYPE"), this.amt(this.one(q, "AMOUNT")), Number(dm[1])] : [this.one(q, "NAME"), this.one(q, "BILLTYPE"), this.amt(this.one(q, "AMOUNT"))];
          }).filter(z => z[1] && z[2]);
          if (bl.length) x.b = bl;
        }
        // cost centres: [category, cost centre, amount]
        if (e.indexOf("<CATEGORYALLOCATIONS.LIST>") >= 0){
          const cl = [];
          e.split("<CATEGORYALLOCATIONS.LIST>").slice(1).forEach(p3 => {
            const blk = p3.split("</CATEGORYALLOCATIONS.LIST>")[0], cat = this.one(blk, "CATEGORY") || "Primary Cost Category";
            blk.split("<COSTCENTREALLOCATIONS.LIST>").slice(1).forEach(p4 => { const q4 = p4.split("</COSTCENTREALLOCATIONS.LIST>")[0], nm = this.one(q4, "NAME"); if (nm) cl.push([cat, nm, this.amt(this.one(q4, "AMOUNT"))]); });
          });
          if (cl.length) x.c = cl;
        }
        v.ent.push(x);
      });
    });
    // review of 01-Oct-2026: a payroll voucher (Tally's PaySlip view) has no ledger lines; its pay heads sit in each
    // employee's allocations. A pay head is a ledger in Tally: earnings are debits, deductions (PF, advance) credits, and
    // the party ledger (Salary Payable) takes the net. A pay head already among the ledger lines is not counted again
    const pays = this.payheads(s);
    if (pays.length){
      // names met by their key (namesKey), as the cloud reader does (server/tally-cloud/parse.js)
      const have = new Set(v.ent.map(e => namesKey(e.l))); let tot = 0;
      pays.forEach(([l, a]) => { tot = Math.round((tot + a) * 100) / 100; if (!have.has(namesKey(l))) v.ent.push({l, a, r: null}); });
      const party = this.one(s, "PARTYLEDGERNAME");
      if (party && !have.has(namesKey(party)) && Math.abs(tot) >= 0.005) v.ent.push({l: party, a: Math.round(-tot * 100) / 100, r: null});
    }
    // the rate on an item line, when the tax ledgers do not carry one
    if (!v.ent.some(e => e.r)){
      const rate = this.one(s, "GSTRATE");
      if (rate) v.rate = num(rate);
    }
    // round 64: no accounting effect in Tally (an order, a delivery or receipt note): kept, marked not in the books
    if (!v.cancel){ const na = this.nonAccounting(s, v.ent.map(e => e.a)); if (na){ v.opt = true; v.nonAcc = na.slice(0, 120); } }
    // a cancelled voucher has no entries; it is kept for the documents issued (GSTR-1 table 13)
    if (v.ent.length || (v.cancel && v.no)) out.push(v);
  },
  async importMasters(file, onProgress){
    const dec = await this.decoder(file);
    const pans = {}, gstins = {}, under = {}, states = {}, groups = {}, info = {}, groupInfo = {};
    let buf = "", n = 0;
    const take = whole => {
      // the groups come before the ledgers; keep the tree, to know a customer from a supplier
      if (whole.indexOf("<GROUP NAME=") >= 0) (whole.match(/<GROUP NAME="[^"]*"[\s\S]*?<\/GROUP>/g) || []).forEach(g => {
        const gn = this.unesc(g.match(/<GROUP NAME="([^"]*)"/)[1]);
        groups[gn] = this.one(g, "PARENT");
        groupInfo[gn] = {rev: this.one(g, "ISREVENUE") === "Yes", gp: this.one(g, "AFFECTSGROSSPROFIT") === "Yes", dr: this.one(g, "ISDEEMEDPOSITIVE") === "Yes"};
      });
      const at = whole.lastIndexOf("<LEDGER ");
      if (at < 0) return;
      const piece = whole.slice(at);
      const raw = (piece.match(/<LEDGER NAME="([^"]*)"/) || [])[1];
      if (!raw) return;
      const name = this.unesc(raw);
      const pan = this.one(piece, "INCOMETAXNUMBER").toUpperCase();
      // TallyPrime keeps the GSTIN, registration type and state in dated registration details;
      // older releases in PARTYGSTIN. The latest dated one is the one in force.
      const regs = (piece.match(/<LEDGSTREGDETAILS\.LIST>[\s\S]*?<\/LEDGSTREGDETAILS\.LIST>/g) || []).map(bk => ({from: this.one(bk, "APPLICABLEFROM"), gstin: this.one(bk, "GSTIN").toUpperCase(), type: this.one(bk, "GSTREGISTRATIONTYPE"), state: this.one(bk, "STATE")}))
        .filter(x => x.gstin || x.type).sort((a, c) => String(a.from).localeCompare(String(c.from)));
      const lastReg = regs.filter(x => x.gstin).pop() || null;
      const gst = (this.one(piece, "PARTYGSTIN") || (lastReg ? lastReg.gstin : "")).toUpperCase();
      const par = this.one(piece, "PARENT");
      const st = this.one(piece, "LEDSTATENAME") || ((piece.match(/<STATE>[^<]*<\/STATE>/g) || []).map(x => this.unesc(x.replace(/<[^>]*>/g, ""))).filter(Boolean).pop() || "");
      // a PAN not typed in Tally is the one inside a valid GSTIN
      const panG = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gst) ? gst.slice(2, 12) : "";
      if (pan) pans[name] = pan; else if (panG) pans[name] = panG;
      if (gst) gstins[name] = gst;
      if (par) under[name] = par;
      const tt = this.one(piece, "TAXTYPE").replace(/[^A-Za-z ]/g, "").trim();
      info[name] = {group: par, taxType: tt, dutyHead: this.one(piece, "GSTDUTYHEAD"), tdsNature: this.one(piece, "TDSRATENAME") || this.one(piece, "TDSNATUREOFPAYMENT") || this.one(piece, "NATUREOFPAYMENT"), rate: num(this.one(piece, "RATEOFTAXCALCULATION")) || undefined, gstin: gst, pan,
        ob: this.amt(this.one(piece, "OPENINGBALANCE")), from: this.one(piece, "STARTINGFROM"),
        msme: this.one(piece, "UDYAMREGNUMBER") ? (this.one(piece, "ENTERPRISETYPE") || "Micro") : "", regType: (lastReg && lastReg.type) || (regs.length ? regs[regs.length - 1].type : "") || this.one(piece, "GSTREGISTRATIONTYPE"),
        panFrom: pan ? "Tally" : panG ? "GSTIN" : "", email: this.one(piece, "EMAIL"), phone: this.one(piece, "LEDGERMOBILE") || this.one(piece, "LEDGERPHONE"), gstinHistory: regs.filter(x => x.gstin).length > 1 ? regs.filter(x => x.gstin).map(x => x.from + ":" + x.gstin) : undefined};
      if (st) states[name] = st;
      n++;
    };
    const reader = file.stream().getReader();
    for (;;){
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      let cut;
      while ((cut = buf.indexOf("</LEDGER>")) >= 0){
        const piece = buf.slice(0, cut + 9); buf = buf.slice(cut + 9);
        take(piece);
      }
      if (onProgress && n % 300 === 0) onProgress("Read " + n + " ledgers\u2026");
    }
    buf += dec.decode();
    let cut;
    while ((cut = buf.indexOf("</LEDGER>")) >= 0){
      const piece = buf.slice(0, cut + 9); buf = buf.slice(cut + 9);
      take(piece);
    }
    return {pans, gstins, under, states, groups, groupInfo, info, count: n};
  },
  // review of 01-Oct-2026: the supplier's invoice number of a purchase or expense entry, for 2B reconciliation and the
  // inward register. Many clients keep it in the voucher number, or write it in the narration, not in Tally's Reference
  // field. Client setup > Tally says where (co.supInvFrom: "ref", "vno" or "narr"); whichever is chosen, an empty field
  // gives way to the next: Reference, the voucher number, then an invoice number found in the narration
  SUPINV: {ref: "Reference", vno: "Voucher no.", narr: "Narration"},
  // books-speed (24-Oct-2026): the books of the last MEM clients opened in this page are kept in memory as last saved or
  // read here, so a client opened again in the same session (A -> B -> A) is not read from this browser's store again
  // (Leads: 4,414 entries, about 3 MB, read and copied on each opening). ver: this page's saves of each client's books
  // (the due list on Today works a client out again only when its books were saved since)
  MEM: 3, mem: new Map(), ver: {},
  remember(cid, data){ this.mem.delete(cid); if (data) this.mem.set(cid, data); while (this.mem.size > this.MEM) this.mem.delete(this.mem.keys().next().value); },
  // split-save (11-Nov-2026): a save wrote the whole books as one record ("books:<cid>"; 51,758 entries: 0.4 s, about
  // 1.5 s on an office PC) for any change: a tick, a cloud item, an MIS or audit run. Now the entries are kept apart from
  // the rest and written again only when they changed, in one transaction with the rest:
  //   "bke:<cid>" {s, v: the entries}   "bkw:<cid>" {s, d: the rest}   "bkh:<cid>" {s}
  // s: the version of the entries the rest goes with (bkh, small, is read in the save's transaction: another tab wrote
  // other entries since this page last saved, and this page's are written too). The entries changed when b.vouchers is
  // another array, or holds another entry in any place, than when this page last saved or read them (vk); a change to an
  // entry in place gives the books a new array (touch). Every reader goes through read: the books rebuilt only when the
  // two records carry the same version.
  // The single record of before ("books:<cid>", an older build's; it carries no time, so its age is known this way): it
  // is removed only by a save here, in that save's own transaction (the save writes the whole books: the last writer
  // wins, as when the books were one record); a read never removes it. So one found by a read was written after this
  // build's last save, by a tab still on the older build (while a release reaches every tab): it is the newer and is
  // what is read, until the next save here writes the books as the two records (none of its changes ignored).
  // gone: clients removed here (drop); a save for one is refused, so their books are not written again
  vk: {}, gone: {},
  K(cid){ return ["bke:", "bkw:", "bkh:", "books:"].map(p => p + cid); },
  touch(b){ if (b && b.vouchers) b.vouchers = b.vouchers.slice(); },
  async save(cid, data){
    if (this.gone[cid]) return;
    this.remember(cid, data); this.ver[cid] = (this.ver[cid] || 0) + 1;
    const [E, W, H, O] = this.K(cid);
    await IDBStore.tx((st, g) => { const q = st.get(H); q.onsuccess = () => g(() => {
      const k = this.vk[cid], h = q.result, v = data.vouchers, d = Object.assign({}, data);
      const s = k && h && h.s === k.s && k.r === v && (!v || v.length === k.a.length && v.every((x, i) => x === k.a[i])) ? k.s : Date.now() + "." + Math.random();
      delete d.vouchers;
      // (kept before the transaction is done: if it fails, bkh differs from it and the next save writes the entries)
      if (!k || s !== k.s){ st.put({s, v}, E); st.put({s}, H); this.vk[cid] = {s, r: v, a: v && v.slice()}; }
      st.put({s, d}, W); st.delete(O);
    }); });
  },
  // mine: the books read are to be this page's copy (load), so their entries are the ones last read here (not while the
  // open books are this client's: those are)
  async read(cid, mine){
    const [e, w, o] = await IDBStore.gets(this.K(cid).filter((k, i) => i !== 2)), m = mine && !(S.books && S.books.cid === cid && !S.books.loading);
    if (o){ if (m) delete this.vk[cid]; return o; }
    if (!(e && w && e.s === w.s)){ if (m) delete this.vk[cid]; return; }
    if (m) this.vk[cid] = {s: e.s, r: e.v, a: e.v && e.v.slice()};
    return Object.assign({cid: w.d.cid, vouchers: e.v}, w.d);
  },
  async load(cid){
    if (this.mem.has(cid)){ const d = this.mem.get(cid); this.remember(cid, d); return d; }
    try { const d = await this.read(cid, 1); if (d && d.cid === cid) this.remember(cid, d); return d; } catch (e){ return null; }
  },
  // a client removed: its books leave this browser
  drop(cid){ this.gone[cid] = 1; this.forget(cid); delete this.vk[cid]; return IDBStore.write(this.K(cid).map(k => [k, null])).catch(() => {}); },
  forget(cid){ if (cid) this.mem.delete(cid); else this.mem.clear(); }
});

