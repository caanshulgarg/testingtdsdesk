/* ================================================================== */
/* GSTR-1 amendments: what was filed, against the books now           */
/*   9A amended B2B / B2C large / export invoices, 9C amended notes,  */
/*   10 amended B2C small, and documents missed in the month's return */
/* ================================================================== */
const GSTAmend = {
  fpOf(ym){ return String(ym).slice(4, 6) + String(ym).slice(0, 4); },
  ymOf(fp){ return String(fp).slice(2, 6) + String(fp).slice(0, 2); },
  ymd(dmy){ const m = String(dmy || "").match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? m[3] + m[2] + m[1] : String(dmy || "").replace(/-/g, ""); },
  dmy(d){ d = String(d || ""); return d.length === 8 ? d.slice(6, 8) + "-" + d.slice(4, 6) + "-" + d.slice(0, 4) : d; },
  numKey(n){ return String(n == null ? "" : n).toUpperCase().replace(/\s+/g, ""); },
  // the last month a year's invoices can still be amended in: November after the year ends (section 37(3))
  lastYm(ym){ const y = num(ym.slice(0, 4)), m = num(ym.slice(4, 6)); return String((m >= 4 ? y + 1 : y)) + "11"; },
  filed(reg){
    return Object.values((S.books && S.books.filed) || {}).filter(f => (!reg || String(f.gstin).slice(0, 2) === reg)).sort((a, c) => a.ym.localeCompare(c.ym));
  },
  // keep a GSTR-1 JSON as filed: one per registration and month
  keep(json, source){
    const b = S.books, gstin = String(json.gstin || "").toUpperCase(), fp = String(json.fp || "");
    if (!/^\d{2}[A-Z0-9]{13}$/.test(gstin) || !/^\d{6}$/.test(fp)) throw new Error("This does not look like a GSTR-1 JSON: it needs a GSTIN and a period (fp).");
    b.filed = b.filed || {};
    const k = gstin + "|" + fp, old = b.filed[k];
    // a copy from the portal is not replaced by a later download from here
    if (old && old.source === "portal" && source === "downloaded") return old;
    b.filed[k] = {gstin, fp, ym: this.ymOf(fp), source, at: new Date().toISOString(), json, notFiled: false};
    return b.filed[k];
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
    const docs = new Map(), b2cs = {}, periods = new Set();
    this.filed(reg).filter(f => !f.notFiled && (inclusive ? f.ym <= beforeYm : f.ym < beforeYm)).forEach(f => {
      const n = this.norm(f.json);
      periods.add(f.ym);
      n.docs.forEach((d, k) => docs.set(k, Object.assign({}, d, {filedIn: f.ym})));
      b2cs[f.ym] = n.b2cs;
      const a1 = ((S.books && S.books.filed1a) || {})[String(f.gstin).toUpperCase() + "|" + f.fp];
      if (a1){ const n1 = this.norm(a1.json); n1.docs.forEach((d, k) => docs.set(k, Object.assign({}, d, {filedIn: f.ym, in1a: true}))); n1.b2csa.forEach(a => { const m = b2cs[f.ym] = b2cs[f.ym] || new Map(); m.set(a.pos + "|" + a.rt + "|" + a.sply_ty, a); }); }
      n.b2csa.forEach(a => {
        const m = b2cs[this.ymOf(a.omon)] = b2cs[this.ymOf(a.omon)] || new Map();
        m.set(a.pos + "|" + a.rt + "|" + a.sply_ty, a);
      });
    });
    return {docs, b2cs, periods};
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
    const months = self ? [ym] : GSTR.months().filter(m => m < ym);
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
      const fb = st.b2cs[P] || new Map(), keys = new Set(Array.from(fb.keys()).concat(Array.from(bn.b2cs.keys())));
      keys.forEach(k => {
        const w = fb.get(k), d = bn.b2cs.get(k), z = {txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
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
    return {period: ym >= "202407", filed1: !!f, threeB: !!(r.r3b || r.snap), kept: !!(((S.books || {}).filed1a || {})[(f ? String(f.gstin).toUpperCase() + "|" + f.fp : "")]), due: typeof GSTF === "object" ? GSTF.due(ym, "r3b") : ""};
  },
  json1a(ym, reg){
    const f = this.filed(reg).find(x => x.ym === ym && !x.notFiled); if (!f) return null;
    const out = {gstin: String(f.gstin).toUpperCase(), fp: f.fp};
    const p = this.addTo(out, ym, reg, true);
    return {json: out, rows: p.rows.filter(r => r.act !== "skip")};
  },
  keep1a(json){ const b = S.books; b.filed1a = b.filed1a || {}; const k = String(json.gstin).toUpperCase() + "|" + json.fp; b.filed1a[k] = {json, at: new Date().toISOString()}; return b.filed1a[k]; },
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
  }
};

