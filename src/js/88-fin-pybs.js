/* @react-lazy: begin 88-fin-pybs.js (the React app loads this file with the Financial statements page: app/src/lib/finGlobals.js; build.py react_parts) */
/* ================================================================== */
/* Last year's balance sheet, uploaded (owner, 29-Oct-2026: "there    */
/* should be a previous period balance sheet uploader also so that we */
/* can map the ledger easily")                                        */
/* ================================================================== */
// FinPyBs reads an audited balance sheet the firm already has, in this browser and nowhere else:
//   fromRows(sheets)  an Excel or CSV workbook's rows ([{name, rows: [[cell, ...]]}], SheetJS's sheet_to_json header:1):
//                     the label, note, CY and PY columns found from the heading row (the later year is CY), else from the
//                     columns that hold figures;
//   fromText(text)    a PDF's text layer as lines (pageTextLines in src/js/01): each line's label, then a note number and
//                     up to two amounts at its end, Indian grouping (1,23,456.50), brackets or a minus for a negative, "-" nil.
// Both give {lines: [{label, note, amt, py, face, head, sub, isHead, isTotal}], unit, cols, why}. A PDF with no text (a scan)
// is not read: FinCom's AI reader does not read balance sheets, and nothing is sent anywhere to be read (why says so).
//   prepare(read, kind)  each line's code (its own words, else its sub-heading's, else its note's: the codes of FinSt), and
//                        which lines make the balance sheet (use): a note's lines where they add up to the face line, else the
//                        face line; totals never.
//   save(fy, read, {by})  kept with the client's books, add-only: b.fs.pyBs[fy].versions gets a new version each time (the
//                        file's name, size and SHA-256, the unit, the lines as confirmed, usePy); latest(fy) is the last one.
//   suggestions(v, openBs, kind, map)  a code for each balance sheet ledger, from the version's lines: a ledger named in a line
//                        (a note listing ledgers), else the one line its balance at the start of the year equals (each way
//                        unique); never for a ledger coded by hand. The reason: "from last year's balance sheet: <line>".
//   pyRows(v, kind)      the lines used, by code, in rupees with a debit positive: the PY column when FinCom's copy has no
//                        previous year (FinSt.tb's pySrc "upload").
const FinPyBs = (() => {
  const N = v => +v || 0, R2 = v => { const r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; };
  // ---------- figures ----------
  function amount(s){
    if (typeof s === "number") return isFinite(s) ? (s === 0 ? 0 : s) : null;
    if (s == null) return null;
    let t = String(s).replace(/₹|\bRs\.?|\bINR\b/gi, "").replace(/[\s ]+/g, "");
    if (!t) return null;
    if (/^[-–—−]$/.test(t) || /^nil$/i.test(t)) return 0;
    let neg = false;
    if (/^\(.*\)$/.test(t)){ neg = true; t = t.slice(1, -1); }
    if (/^[-–−]/.test(t)){ neg = !neg; t = t.slice(1); }
    if (!/^(\d{1,3}(,\d{2,3})+|\d+)(\.\d+)?$/.test(t)) return null;
    const v = Number(t.replace(/,/g, ""));
    return neg && v ? -v : v;
  }
  // a figure as a PDF prints it: grouped (12,345), with paise (5000.00), small (0 to 999), or a dash; never a year
  const AMT = /^\(?[-–−]?((\d{1,3}(,\d{2,3})+|\d{1,3})(\.\d{1,2})?|\d+\.\d{2})\)?$|^[-–—]$/;
  const UNITS = [[/crore/i, 1e7], [/lakh|lac\b|lacs/i, 1e5], [/thousand|'000|’000|in 000/i, 1000]];
  const unitOf = t => { if (!/amount|rs\b|rs\.|₹|rupee|inr/i.test(t)) return 0; const u = UNITS.find(([re]) => re.test(t)); return u ? u[1] : /in\s+rupees|in\s+₹|in\s+rs/i.test(t) ? 1 : 0; };
  const yearIn = t => { const m = String(t).match(/\b(19|20)\d{2}\b/g) || String(t).match(/\d{1,2}[./-]\d{1,2}[./-](\d{2,4})/); return m ? N(String(m[m.length - 1]).slice(-4).replace(/^(\d{2})$/, "20$1")) : 0; };
  const isHeadRow = t => /particulars|as at|year ended|current year|previous year/i.test(t);
  const NOTE = /^note\s*(no\.?)?\s*(\d{1,2})\b[.:\-]?\s*/i;
  const TOTAL = t => /^\W*(grand\s+|sub-?)?total\b/i.test(t) && !/outstanding dues/i.test(t);
  const clean = t => String(t || "").replace(/^\s*(\(?[ivx]+\)|\(?[a-z]\)|[ivx]+\.|\d{1,2}[.)]|[-–•*])\s*/i, "").replace(/^\s*(\(?[a-z]\)|[-–])\s*/i, "").replace(/\s+/g, " ").trim();

  // a line in its context: face lines until the first "Note N" heading; a heading with no figure is the next lines'
  // sub-heading (or, "Note N ...", their note)
  function walk(raw){
    const lines = []; let face = true, head = "", sub = "";
    raw.forEach(z => {
      const label = String(z.label || "").replace(/\s+/g, " ").trim();
      if (!label && z.amt == null) return;
      const m = label.match(NOTE);
      if (z.amt == null && z.py == null){
        if (m){ face = false; head = label.replace(NOTE, "").trim() || label; sub = ""; lines.push({label, note: N(m[2]), isHead: true, face, head, sub: "", amt: null, py: null}); return; }
        sub = label; lines.push({label, note: z.note || null, isHead: true, face, head, sub: "", amt: null, py: null}); return;
      }
      lines.push({label, note: z.note || null, amt: z.amt == null ? 0 : z.amt, py: z.py == null ? null : z.py, face, head, sub, isTotal: TOTAL(label)});
    });
    return lines;
  }

  // ---------- Excel / CSV ----------
  function fromRows(sheets){
    sheets = (sheets || []).filter(s => s && s.rows && s.rows.length);
    if (!sheets.length) return {lines: [], unit: 1, why: "The file has no rows FinCom could read."};
    // the balance sheet's sheet and its notes' sheets, if they are named so; else the first sheet
    const bsS = sheets.filter(s => /balance\s*sheet|^bs$/i.test(s.name || "")), ntS = sheets.filter(s => /note/i.test(s.name || "") && !bsS.includes(s));
    const pick = bsS.length ? bsS.concat(ntS) : [sheets[0]];
    let unit = 0, cols = null; const raw = [];
    pick.forEach((sh, si) => {
      const rows = sh.rows.map(r => (r || []).map(c => c == null ? "" : c));
      const txt = r => r.filter(c => typeof c === "string").join(" ");
      rows.slice(0, 12).forEach(r => { unit = unit || unitOf(txt(r)); });
      // the heading row: two or more cells with a year (or "current / previous year")
      let hi = rows.findIndex(r => r.filter(c => typeof c === "string" && (yearIn(c) || /current year|previous year/i.test(c))).length >= 2 || (r.filter(c => typeof c === "string" && yearIn(c)).length >= 1 && r.some(c => /particulars/i.test(String(c)))));
      let c = null;
      if (hi >= 0){
        const h = rows[hi], yrs = h.map((x, i) => [i, typeof x === "string" ? (yearIn(x) || (/current year/i.test(x) ? 9999 : /previous year/i.test(x) ? 9998 : 0)) : 0]).filter(([, y]) => y);
        yrs.sort((a, z) => z[1] - a[1] || a[0] - z[0]);
        c = {cy: yrs[0][0], py: yrs.length > 1 ? yrs[1][0] : null, note: h.findIndex(x => /^note/i.test(String(x).trim()))};
      } else {
        // no heading: the columns that hold figures (a column of small whole numbers next to the label is the note)
        const cnt = {}; rows.forEach(r => r.forEach((x, i) => { if (typeof x === "number" || (typeof x === "string" && amount(x) != null && /\d/.test(x))) cnt[i] = (cnt[i] || 0) + 1; }));
        const noteCol = Object.keys(cnt).map(Number).find(i => rows.every(r => r[i] === "" || r[i] == null || (Number.isInteger(+r[i]) && +r[i] > 0 && +r[i] < 100)));
        const amts = Object.keys(cnt).map(Number).filter(i => i !== noteCol && cnt[i] >= 2).sort((a, z) => a - z);
        c = {cy: amts[0] == null ? -1 : amts[0], py: amts[1] == null ? null : amts[1], note: noteCol == null ? -1 : noteCol};
        hi = -1;
      }
      c.label = 0;
      const first = Math.min(...[c.cy, c.py, c.note].filter(i => i != null && i >= 0));
      if (si === 0) cols = Object.assign({}, c);
      if (si > 0) raw.push({label: "Note " + (sh.name || "").replace(/\D+/g, "") + " " + sh.name});
      rows.forEach((r, i) => {
        if (i <= hi) return;
        const label = r.slice(0, isFinite(first) ? first : r.length).filter(x => typeof x === "string" && x.trim()).join(" ").trim();
        const a = c.cy >= 0 ? amount(r[c.cy]) : null, p = c.py != null && c.py >= 0 ? amount(r[c.py]) : null, nt = c.note >= 0 && r[c.note] !== "" ? N(r[c.note]) || null : null;
        if (!label && a == null) return;
        if (a == null && p == null && isHeadRow(label) && /\d{4}/.test(label)) return;
        if (a == null && p == null && i < 4 && !nt && !NOTE.test(label) && si === 0 && raw.length === 0) return;   // the title lines
        raw.push({label, note: nt, amt: a == null && p != null ? 0 : a, py: p});
      });
    });
    const lines = walk(raw);
    return {lines, unit: unit || 1, cols, why: lines.some(z => z.amt != null) ? "" : "FinCom could not find a figure in the file: give the balance sheet's own sheet (label, note, this year and last year)."};
  }

  // ---------- a PDF's text ----------
  function fromText(text){
    const ls = String(text || "").split(/\r?\n/).map(s => s.replace(/[\s ]+/g, " ").trim()).filter(Boolean);
    if (!ls.length || ls.join("").replace(/\W/g, "").length < 20)
      return {lines: [], unit: 1, why: "FinCom could not read this PDF: it has no text to read (a scanned copy?). FinCom does not send it anywhere to be read. Upload the Excel, or a PDF saved from the accounting software."};
    let unit = 0, order = 1, started = false; const raw = [];
    ls.forEach(s => {
      if (!unit) unit = unitOf(s);
      // the heading line: the years tell which column is this year (the later one)
      if (isHeadRow(s) && (s.match(/\b(19|20)\d{2}\b/g) || []).length >= 2 && !s.split(" ").some(t => AMT.test(t) && /,/.test(t))){
        const y = s.match(/\b(19|20)\d{2}\b/g).map(Number); order = y[0] >= y[y.length - 1] ? 1 : -1; started = true; return; }
      if (/^page \d+( of \d+)?$/i.test(s)) return;
      const tk = s.split(" "), am = [];
      while (tk.length && am.length < 2 && AMT.test(tk[tk.length - 1])) am.unshift(tk.pop());
      let note = null;
      // a lone small whole number at the end is the note of a caption ("(a) Trade payables 6"), not a figure
      if (am.length === 1 && /^\d{1,2}$/.test(am[0])) note = N(am.pop());
      if (am.length && tk.length > 1 && /^\d{1,2}$/.test(tk[tk.length - 1])) note = N(tk.pop());
      const label = tk.join(" "), prev = raw[raw.length - 1];
      if (!started && !am.length) return;   // the title lines above the heading
      started = true;
      if (!label && !am.length) return;
      // a caption the PDF wraps: its figures on a line of their own go to the caption above them, and a line that goes on
      // in small letters is the rest of the line above
      if (!label && prev && prev.amt == null && prev.py == null && !NOTE.test(prev.label)){ const w = am.map(amount); [prev.amt, prev.py] = order === 1 ? [w[0], w[1] == null ? null : w[1]] : [w[1] == null ? w[0] : w[1], w[1] == null ? null : w[0]]; if (note) prev.note = note; return; }
      if (label && !am.length && prev && /^[a-z]/.test(label)){ prev.label += " " + label; return; }
      const v = am.map(amount), [a, p] = order === 1 ? [v[0], v[1]] : [v[1] == null ? v[0] : v[1], v[1] == null ? null : v[0]];
      raw.push({label, note, amt: a == null ? null : a, py: p == null ? null : p});
    });
    const lines = walk(raw);
    return {lines, unit: unit || 1, cols: {order}, why: lines.some(z => z.amt != null) ? "" : "FinCom could not find a figure in this PDF's text. Upload the Excel instead."};
  }

  // ---------- codes ----------
  // the line of the old statements (FS.LINES) a caption speaks of; FinSt.refine then gives its code
  const LINES = [
    [/^(equity )?share capital|^equity shares|^issued,? subscribed/, "share"], [/partners'?\s*capital|capital accounts?|proprietor'?s?\s*capital|owners'?\s*capital/, "capital"],
    [/reserves|surplus|securities premium|general reserve|retained earnings/, "reserves"],
    [/long[- ]term borrowings?|^term loans?/, "ltb"], [/deferred tax liabilit/, "dtl"], [/deferred tax asset/, "dta"], [/other long[- ]term liabilit/, "oltl"], [/long[- ]term provisions?/, "ltp"],
    [/short[- ]term borrowings?|cash credit|overdraft|repayable on demand/, "stb"], [/trade payables?|sundry creditors|outstanding dues of (micro|creditors)/, "tp"],
    [/other current liabilit|statutory (dues|remittances)|duties and taxes/, "ocl"], [/short[- ]term provisions?|^provisions$/, "stp"],
    [/under development|capital work[- ]in[- ]progress/, "cwip"], [/intangible assets/, "intang"], [/property,? plant|fixed assets|tangible assets/, "ppe"],
    [/non[- ]current investments?/, "nci"], [/long[- ]term loans and advances/, "ltla"], [/other non[- ]current assets/, "onca"], [/^current investments?/, "ci"],
    [/inventor|stock[- ]in[- ]trade|closing stock/, "inv"], [/trade receivables?|sundry debtors/, "tr"],
    [/cash and (cash equivalents|bank)|bank balances|balances with banks|cash on hand|cash[- ]in[- ]hand|fixed deposits?|^cash$/, "cash"],
    [/loans and advances/, "stla"], [/other current assets/, "oca"]];
  const LIAB = ["share", "capital", "reserves", "ltb", "dtl", "oltl", "ltp", "stb", "tp", "ocl", "stp"];
  const lineOf = (t, kind) => { const s = clean(t).toLowerCase(), m = LINES.find(([re]) => re.test(s)); return m ? (m[1] === "share" && kind === "nc" ? "capital" : m[1]) : ""; };
  function codeFor(z, kind){
    if (z.isHead || z.isTotal) return "";
    const lab = clean(z.label);
    for (const t of [z.label, z.sub, z.head]){
      const ln = lineOf(t, kind);
      if (!ln) continue;
      if (ln === "tp"){ const s = String(t).toLowerCase() + " " + lab.toLowerCase(); if (/other than/.test(s)) return "6B"; if (/micro|small enterprise|msme/.test(s)) return "6A"; }
      const bal = LIAB.includes(ln) ? -N(z.amt) : N(z.amt);
      return FinSt.refine(lab, ln, [], bal, kind) || "";
    }
    return "";
  }
  function prepare(read, kind){
    kind = kind || "co";
    const lines = (read.lines || []).map(z => Object.assign({}, z));
    lines.forEach(z => { z.code = z.code !== undefined && read.confirmed ? z.code : codeFor(z, kind); z.use = !!(z.code && !z.isHead && !z.isTotal && (FinSt.CODES[z.code] || {}).side === "BS"); });
    // per head of the balance sheet: the note's lines where they add up to the face line(s), else the face line(s)
    const by = {};
    lines.forEach(z => { if (!z.use) return; const id = FinSt.bsLineOf(z.code); if (!id) return; const x = by[id] = by[id] || {face: [], det: []}; (z.face ? x.face : x.det).push(z); });
    Object.values(by).forEach(({face, det}) => {
      if (!face.length || !det.length) return;
      const sf = face.reduce((s, z) => s + N(z.amt), 0), sd = det.reduce((s, z) => s + N(z.amt), 0);
      if (Math.abs(sf - sd) <= 0.5 * (face.length + det.length)) face.forEach(z => { z.use = false; z.why = "its note's lines are used"; });
      else det.forEach(z => { z.use = false; z.why = "the note's lines do not add up to the balance sheet; the balance sheet's line is used"; });
    });
    return Object.assign({}, read, {lines, kind});
  }

  // ---------- kept with the books, add-only ----------
  const store = (b, fy) => { b.fs = b.fs || {}; b.fs.pyBs = Object.assign({}, b.fs.pyBs); b.fs.pyBs[fy] = b.fs.pyBs[fy] || {versions: []}; return b.fs.pyBs[fy]; };
  function save(fy, read, o){
    const b = S.books, st = store(b, String(fy)), v = ((st.versions || []).slice(-1)[0] || {v: 0}).v + 1;
    const keep = {v, at: (o && o.at) || new Date().toISOString(), by: (o && o.by) || ((typeof Cloud === "object" && Cloud.st && Cloud.st.email) || "this computer"),
      file: read.file || "", size: N(read.size), sha256: read.sha256 || "", src: read.src || "", unit: N(read.unit) || 1, usePy: read.usePy !== false,
      lines: (read.lines || []).map(z => ({label: z.label, note: z.note || null, amt: z.amt, py: z.py, face: !!z.face, head: z.head || "", sub: z.sub || "", isHead: !!z.isHead, isTotal: !!z.isTotal, code: z.code || "", use: !!z.use}))};
    st.versions = (st.versions || []).concat([keep]);
    if (typeof saveBooks === "function") saveBooks();
    return keep;
  }
  const latest = fy => { const b = (typeof S === "object" && S.books) || {}, st = ((b.fs || {}).pyBs || {})[String(fy)]; return st && st.versions && st.versions.length ? st.versions[st.versions.length - 1] : null; };
  const versions = fy => { const b = (typeof S === "object" && S.books) || {}; return ((((b.fs || {}).pyBs || {})[String(fy)]) || {versions: []}).versions || []; };

  // ---------- the PY column and the suggestions ----------
  // the TB value of a line: in rupees, a debit positive (a liability's figure is a credit)
  const tbv = (z, u) => { const c = FinSt.CODES[z.code]; return c ? R2(c.sign * N(z.amt) * u) : 0; };
  function pyRows(v, kind){
    const u = N(v.unit) || 1, K = FinSt.codes(kind || "co"), by = {};
    (v.lines || []).forEach(z => { if (z.use && K[z.code]) by[z.code] = R2((by[z.code] || 0) + tbv(z, u)); });
    return Object.entries(by);
  }
  const key = t => String(t || "").toUpperCase().replace(/&/g, "AND").replace(/[^A-Z0-9]+/g, "");
  function suggestions(v, openBs, kind, map){
    if (!v || !v.lines) return {};
    const u = N(v.unit) || 1, K = FinSt.codes(kind || "co"), out = {}, hand = l => !!(map || {})[l];
    const data = v.lines.filter(z => !z.isHead && !z.isTotal && K[z.code] && FinSt.CODES[z.code].side === "BS"), ctx = z => clean(z.sub || z.head);
    const led = Object.keys(openBs || {}).filter(l => !hand(l)), named = new Set(), taken = new Set();
    // a ledger named in a line (a note listing the ledgers)
    const byName = {}; data.forEach(z => { const k = key(clean(z.label)); if (k.length >= 4) (byName[k] = byName[k] || []).push(z); });
    led.forEach(l => { const zs = byName[key(l)]; if (zs && zs.length === 1){ const z = zs[0]; out[l] = {code: z.code, why: "from last year's balance sheet: " + (ctx(z) && !z.face ? ctx(z) + ": " : "") + z.label}; named.add(l); taken.add(z); } });
    // else the one line, of those that make the balance sheet, its balance at the start of the year equals (each way unique)
    // (a line naming a ledger of the books, even one coded by hand, is that ledger's: no other ledger matches it by amount)
    const names = new Set(Object.keys(openBs || {}).map(key));
    const tolR = Math.max(0.005, u / 2), cand = data.filter(z => z.use && !taken.has(z) && !names.has(key(clean(z.label)))), rest = led.filter(l => !named.has(l) && Math.abs(N(openBs[l])) >= 1);
    const hit = (l, z) => Math.abs(tbv(z, u) - N(openBs[l])) <= tolR;
    rest.forEach(l => {
      const zs = cand.filter(z => hit(l, z));
      if (zs.length !== 1) return;
      const z = zs[0]; if (rest.filter(m => hit(m, z)).length !== 1) return;
      // a face line names only the head: a rule's code in the same head is the finer one, kept with the reason
      const rule = FinSt.suggest(l, null, openBs[l], kind);
      const code = z.face && rule && K[rule] && FinSt.bsLineOf(rule) === FinSt.bsLineOf(z.code) ? rule : z.code;
      out[l] = {code, why: "from last year's balance sheet: " + z.label};
    });
    return out;
  }
  return {amount, fromRows, fromText, prepare, codeFor, lineOf, save, latest, versions, pyRows, suggestions};
})();

if (typeof globalThis === "object") Object.assign(globalThis, {FinPyBs});
/* @react-lazy: end */
