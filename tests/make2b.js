// A GSTR-2B for the two busiest purchase months, made in the page from the books loaded (tests/data), with faults
// planted: the first two invoices of the first month missing, one amount changed, one number replaced by another (a prefix alone is matched on the number's core), and an invoice
// from a supplier not in the books. Used by pages_gst.py and run_react_gst.py. Returns the number of months made.
(() => {
      const b = S.books, reg = S.gstReg || '', gstin = (GSTR.gstins(b) || []).find(g => g.slice(0, 2) === reg) || '', docs0 = GST2B.bookDocs(), cnt = ym => docs0.filter(d => d.ym === ym && d.reg === reg && d.gstin && d.dir === 1).length, top = GSTR.months().slice().sort((a, c) => cnt(c) - cnt(a))[0], ms = GSTR.months().filter(m => m <= top).slice(-2);
      const dmy = d => d.slice(6, 8) + '-' + d.slice(4, 6) + '-' + d.slice(0, 4), docs = GST2B.bookDocs();
      b.twoBs = {};
      ms.forEach((ym, mi) => {
        const period = ym.slice(4) + ym.slice(0, 4), list = docs.filter(d => d.ym === ym && d.reg === reg && d.gstin && d.dir === 1).slice(mi ? 0 : 2), by = {};
        list.forEach((d, i) => { const inv = {inum: i === 3 ? 'QZ-' + d.date.slice(2) : d.no, dt: dmy(d.date), val: r2(d.taxable + d.igst + d.cgst + d.sgst), txval: i === 1 ? r2(d.taxable + 500) : d.taxable,
          igst: i === 1 && d.igst ? r2(d.igst + 90) : d.igst, cgst: i === 1 && !d.igst ? r2(d.cgst + 45) : d.cgst, sgst: i === 1 && !d.igst ? r2(d.sgst + 45) : d.sgst, cess: 0, rev: 'N', itcavl: 'Y', rsn: '', typ: 'R', srctyp: 'e-Invoice', irn: '', irngendate: '', pos: reg};
          (by[d.gstin] = by[d.gstin] || {ctin: d.gstin, trdnm: d.party, supfildt: '11-' + period.slice(0, 2) + '-' + period.slice(2), supprd: period, inv: []}).inv.push(inv); });
        const x = GST2B.fromJson({data: {gstin, rtnprd: period, gendt: '14-' + period.slice(0, 2) + '-' + period.slice(2), docdata: {b2b: Object.values(by).concat([{ctin: '07AAACZ9999Z1Z5', trdnm: 'ONLY IN 2B LTD', supfildt: '11-' + period.slice(0, 2) + '-' + period.slice(2), supprd: period,
          inv: [{inum: 'Z/9', dt: '05-' + period.slice(0, 2) + '-' + period.slice(2), val: 1180, txval: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0, rev: 'N', itcavl: 'Y', rsn: '', typ: 'R', pos: reg}]}])}}});
        b.twoBs[x.gstin + '|' + x.period] = x;
      });
      S.gstYm = ms[1]; S.gstPart = 'r2b'; S.r2Tab = ''; render(); return Object.keys(b.twoBs).length; })()
