/* ================================================================== */
/* Repairing a statement: read again only the pages whose lines do    */
/* not fit the running balance, and merge without making duplicates.  */
/* ================================================================== */
function breakRows(){ const b = B(); return b ? b.rows.filter(r => r.balOk === false) : []; }
function pagesToFix(rows){
  const b = B(), out = new Set();
  rows.forEach(r => {
    const i = b.rows.indexOf(r);
    [r, b.rows[i - 1], b.rows[i + 1]].forEach(x => { if (x && x.page) out.add(x.page); });
  });
  return Array.from(out).sort((a, c) => a - c);
}
async function readPagesAgain(file, pages, force, progress){
  if (force === "claude") return (await claudeStatement(file, progress, pages)).rows;
  const all = await statementImages(file);
  const picked = pages.map(n => ({canvas: all[n - 1], page: n})).filter(x => x.canvas);
  const out = [];
  for (let i = 0; i < picked.length; i++){
    if (progress) progress((force === "google" ? "Google OCR: page " : "Reading page ") + picked[i].page);
    const src = cropCanvas(picked[i].canvas, 0, 0, picked[i].canvas.width, picked[i].canvas.height);
    if (force !== "google") enhanceCanvas(src);
    const words = (force === "google" ? await googleWords(src) : await ocrWords(src))
      .filter(w => (w.conf == null || w.conf > 20) && String(w.s).trim())
      .map(w => ({s: fixOcrNumber(String(w.s).trim()), x: w.x, y: src.height - w.y - w.h, w: w.w, h: w.h}));
    out.push({items: words, page: picked[i].page});
  }
  const byHead = parseByHeadings(out), byLine = parseByLines(out.map(p => ({items: joinOcrWords(p.items), page: p.page})));
  const pick = [byHead, byLine].filter(Boolean).sort((a, c) => (c.rows || []).length - (a.rows || []).length)[0];
  return (pick && pick.rows) || [];
}
// Put back only what belongs in each gap: the re-read lines between the last balance that was right
// and the next one, in the order they are printed. Nothing else is touched.
function spliceMissing(rows, found, accId, keys, opening){
  const fpOf = r => [accId, r.date, r.debit, r.credit, r.balance === null ? "" : r.balance, normName(r.narr).slice(0, 30)].join("|");
  const near = (a, b2) => a != null && b2 != null && Math.abs(num(a) - num(b2)) <= 0.011;
  const have = new Set(rows.map(r => r.fp || fpOf(r)));
  const out = rows.slice();
  const added = [];
  for (let i = out.length - 1; i >= 0; i--){
    if (out[i].balOk !== false) continue;
    const prevBal = i > 0 ? out[i - 1].balance : (opening == null ? null : opening);
    const curBal = out[i].balance;
    if (prevBal == null || curBal == null) continue;
    const a = found.findIndex(c => near(c.balance, prevBal));
    const bIdx = found.findIndex((c, k) => k > a && near(c.balance, curBal));
    if (a < 0 || bIdx <= a) continue;
    const middle = found.slice(a + 1, bIdx).filter(c => {
      if (!c.date || (!c.debit && !c.credit)) return false;
      const fp = fpOf(c);
      if (have.has(fp) || (keys && keys[fp])) return false;
      have.add(fp); c.fp = fp; return true;
    });
    if (!middle.length) continue;
    out.splice(i, 0, ...middle.map(c => Object.assign({}, c)));
    added.push(...middle);
  }
  return {rows: out, added};
}
// merge: keep every line that is already right, add only what is missing, never the same line twice
function mergeStatementRows(existing, found, accId, keys){
  const fpOf = r => [accId, r.date, r.debit, r.credit, r.balance === null ? "" : r.balance, normName(r.narr).slice(0, 30)].join("|");
  const have = new Set(existing.map(r => r.fp || fpOf(r)));
  const added = [];
  found.forEach(r => {
    if (!r.date || (!r.debit && !r.credit)) return;
    const fp = fpOf(r);
    if (have.has(fp)) return;                                   // already in this statement
    if (keys && keys[fp]) return;                               // already in another statement of this account
    have.add(fp);
    added.push(Object.assign({}, r, {fp}));
  });
  const all = existing.concat(added);
  all.sort((a, c) => String(a.date).localeCompare(String(c.date)) || (a.balance == null || c.balance == null ? 0 : 0));
  return {rows: all, added};
}
async function fixBreaks(force){
  const b = B(), st = curStmt();
  if (!b || !st) return;
  const bad = breakRows();
  if (!bad.length){ toast("Every line already fits the running balance."); return; }
  const file = S.files["st:" + st.id];
  if (!file){ b.fixWant = force || "claude"; toast("Choose " + st.fileName + " again so those pages can be read."); const el = document.getElementById("bankIn"); if (el) el.click(); return; }
  const pages = pagesToFix(bad);
  if (!pages.length){ toast("These lines do not say which page they came from. Upload the statement again to repair it."); return; }
  const was = bad.length;
  b.busy = "Reading " + pages.length + " page" + (pages.length === 1 ? "" : "s") + " again (" + (force === "claude" ? "Claude" : force === "google" ? "Google OCR" : "free") + ")\u2026"; render();
  try {
    const found = await readPagesAgain(file, pages, force, m => { b.busy = m + "\u2026"; render(); });
    const keys = (await BankDB.get("keys:" + b.cid)) || {};
    const before = b.rows.slice();
    const merged = spliceMissing(before, found, st.acctId, keys, st.opening);
    if (!merged.added.length){ b.busy = ""; toast("Nothing new was found on " + (pages.length === 1 ? "that page" : "those pages") + ". The missing entries may not be printed there."); render(); return; }
    merged.added.forEach((r, i) => Object.assign(r, {id: st.id + "-fix" + Date.now() + "-" + i, dec: decodeNarr(r.narr, CO(b.cid).name), state: "attention", ledger: "", userSet: false}));
    const chkNew = checkBalances(merged.rows.map(r => r), {opening: st.opening, closing: st.closing});
    if (chkNew.bad >= was){
      b.busy = ""; render();
      toast("Those pages were read again but the balances did not improve (" + chkNew.bad + " still do not fit). Nothing was changed.");
      return;
    }
    b.rows = merged.rows;
    merged.added.forEach(r => { keys[r.fp] = st.id; });
    checkBalances(b.rows, {opening: st.opening, closing: st.closing});
    st.n = b.rows.length; st.badRows = chkNew.bad; st.fixedRows = chkNew.fixed;
    st.counts = {attention: b.rows.filter(r => r.state === "attention").length};
    await BankDB.set("stmt:" + b.cid + ":" + st.id, b.rows);
    await BankDB.set("keys:" + b.cid, keys);
    saveBank({rows: true, stmts: true});
    b.busy = ""; render();
    toast(merged.added.length + " line" + (merged.added.length === 1 ? "" : "s") + " added from " + pages.length + " page" + (pages.length === 1 ? "" : "s") + ". " +
      (chkNew.bad ? chkNew.bad + " line" + (chkNew.bad === 1 ? "" : "s") + " still do not fit." : "Every line now fits the running balance."));
  } catch (e){
    b.busy = ""; render();
    toast("Could not read those pages: " + errCopy(e && e.code));
  }
}
function fixBanner(){
  const b = B(), st = curStmt();
  if (!b || !st) return "";
  const bad = breakRows();
  if (!bad.length) return "";
  const pages = pagesToFix(bad);
  return '<div class="bk-alert bad"><b>' + bad.length + " line" + (bad.length === 1 ? " does" : "s do") + " not fit the running balance.</b> " +
    (pages.length ? "Something printed on page" + (pages.length === 1 ? " " : "s ") + pages.join(", ") + " was missed or misread." : "") +
    '<div class="row" style="gap:8px;margin-top:8px"><span class="note">Read those pages again:</span>' +
    '<button class="btn small" data-act="fixFree">Free</button>' +
    '<button class="btn small" data-act="fixGoogle"' + (googleReady() ? "" : " disabled") + '>Google OCR</button>' +
    '<button class="btn small primary" data-act="fixClaude"' + (claudeReady() ? "" : " disabled") + ">Claude</button></div></div>";
}

// Claude reads the pages as images and lists the transactions. Used when asked, or when nothing else could read the file.
async function claudeStatement(file, progress, onlyPages){
  if (!claudeReady()) throw {code: "no_engine"};
  const all = await statementImages(file);
  const canvases = onlyPages && onlyPages.length ? onlyPages.map(n => all[n - 1]).filter(Boolean) : all;
  const rows = [], metaLines = [];
  for (let i = 0; i < canvases.length; i++){
    const pageNo = onlyPages && onlyPages.length ? onlyPages[i] : i + 1;
    if (progress) progress("Claude is reading page " + (i + 1) + " of " + canvases.length + " (page " + pageNo + " of the statement)\u2026");
    if (!(await charge("bills", 1, file.name, "Statement page read by Claude"))) throw {code: "no_credit"};
    const img = await imgBlob(canvases[i], "page");
    const prompt = "This is page " + (i + 1) + " of a bank statement. List every transaction row in the table, in the order printed.\n" +
      "Reply with only JSON: {\"account\":\"\",\"opening\":null,\"closing\":null,\"rows\":[{\"date\":\"YYYY-MM-DD\",\"narration\":\"\",\"withdrawal\":0,\"deposit\":0,\"balance\":0}]}\n" +
      "Rules: one entry per printed transaction; keep the narration on one line, joining text that wraps; withdrawal and deposit are numbers without commas, 0 when empty; balance is the running balance printed on that row; dates as YYYY-MM-DD; do not invent rows; opening and closing only if printed on this page.";
    let j = {};
    try { j = await claudeRead(prompt, [img], false) || {}; } catch (e){ if (i === 0) throw e; break; }
    if (j.account) metaLines.push("Account number " + j.account);
    if (j.opening != null) metaLines.push("Opening balance " + j.opening);
    if (j.closing != null) metaLines.push("Closing balance " + j.closing);
    [].concat(j.rows || []).forEach(r => {
      const d = bankDate(String(r.date || ""));
      if (!d) return;
      const deb = num(r.withdrawal), cre = num(r.deposit);
      if (!deb && !cre) return;
      rows.push({date: d, page: pageNo, narr: String(r.narration || "").replace(/\s+/g, " ").trim(), debit: deb, credit: cre, balance: r.balance == null ? null : num(r.balance)});
    });
  }
  return {rows, meta: statementMeta(metaLines)};
}
async function readStatement(file, progress, force){
  const diag = {file: file.name, size: file.size, tried: []};
  const note = (method, p, err) => diag.tried.push({method, rows: p && p.rows ? p.rows.length : 0, score: scoreParse(p), error: err ? bankErr(err) : ""});
  let best = null;
  const consider = (method, p) => { const sc = scoreParse(p); note(method, p); if (sc > 0 && (!best || sc > best.score)) best = {p, score: sc, method}; };
  if (force === "claude"){
    try { consider("Claude read the pages", await claudeStatement(file, progress)); }
    catch (e){ note("Claude", null, e); if (!best) throw Object.assign({diag}, e); }
    if (best){ best.p.method = best.method; best.p.diag = diag; return best.p; }
  }
  const isSheet = /\.(xlsx|xls|xlsm|csv|txt)$/i.test(file.name);
  const isImg = isImage(file);
  if (isSheet){
    let grids = [];
    try { grids = await gridsFromSheet(file); } catch (e){ note("Excel/CSV", null, e); }
    try { consider("Excel/CSV with headings", await parseSheetStatement(file)); } catch (e){ note("Excel/CSV with headings", null, e); }
    grids.forEach((g, i) => { try { consider("Excel/CSV without headings (sheet " + (i + 1) + ")", parseByLines(sheetAsPages(g))); } catch (e){ note("Excel/CSV without headings", null, e); } });
    diag.sample = grids[0] ? grids[0].slice(0, 12).map(r => r.map(cellText).filter(Boolean).join(" | ")) : [];
  } else if (isPdf(file) || isImg){
    let pages = null;
    if (!isImg){
      try { consider("PDF with headings", await parsePdfStatement(file)); }
      catch (e){ note("PDF with headings", null, e); if (e && (e.code === "pdf_password" || e.code === "pdf_broken")) { diag.fatal = e.code; throw Object.assign({diag}, e); } }
      try {
        pages = await pdfTextPages(file);
        diag.pages = pages.length; diag.textChars = pages.reduce((a, p) => a + p.items.reduce((b, it) => b + it.s.length, 0), 0);
        diag.sample = pages[0] ? pages[0].items.slice(0, 40).map(it => it.s) : [];
        if (diag.textChars >= 50) consider("PDF without headings", parseByLines(pages));
      } catch (e){ note("PDF without headings", null, e); }
    }
    if (!best || best.score < 3){                 // no text, or text whose layout the readers could not follow
      try {
        const ocrPages = await parseScannedStatement(file, progress);
        diag.ocrWords = ocrPages.reduce((a, p) => a + p.items.length, 0);
        diag.sample = diag.sample && diag.sample.length ? diag.sample : (ocrPages[0] ? ocrPages[0].items.slice(0, 40).map(it => it.s) : []);
        try { consider("OCR with headings", parseByHeadings(ocrPages)); } catch (e){ note("OCR with headings", null, e); }
        try { consider("OCR without headings", parseByLines(ocrPages.map(p => ({items: joinOcrWords(p.items)})))); } catch (e){ note("OCR without headings", null, e); }
      } catch (e){ note("OCR", null, e); }
    }
    if (force === "google" || ((!best || best.score < 3) && googleAvailable())){
      try {
        const gPages = await parseScannedStatement(file, progress, "google");
        diag.googleWords = gPages.reduce((a, p) => a + p.items.length, 0);
        try { consider("Google OCR with headings", parseByHeadings(gPages)); } catch (e){ note("Google OCR with headings", null, e); }
        try { consider("Google OCR without headings", parseByLines(gPages.map(p => ({items: joinOcrWords(p.items)})))); } catch (e){ note("Google OCR without headings", null, e); }
      } catch (e){ note("Google OCR", null, e); }
    }
  } else throw {code: "bank_type", diag};
  if (!best) throw {code: "bank_unreadable", diag};
  best.p.method = best.method;
  best.p.diag = diag;
  return best.p;
}
async function pdfTextPages(file){
  await ensurePdfJs();
  const pdf = await pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 400); p++){
    const tc = await (await pdf.getPage(p)).getTextContent();
    pages.push({items: (tc.items || []).filter(it => it.str && it.str.trim()).map(it => ({s: it.str.replace(/\s+/g, " ").trim(), x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 8}))});
  }
  return pages;
}
function bankReport(err){
  const d = (err && err.diag) || {};
  return ["TDS Desk bank statement report", "Version: " + APP_VERSION, "Browser: " + navigator.userAgent, "Storage: " + BankDB.mode,
    "File: " + (d.file || "") + " (" + Math.round((d.size || 0) / 1024) + " KB)", "Problem: " + bankErr(err),
    "PDF pages: " + (d.pages == null ? "—" : d.pages) + " · text characters: " + (d.textChars == null ? "—" : d.textChars) + (d.ocrWords != null ? " · OCR words: " + d.ocrWords : ""),
    "Readers tried:", ...(d.tried || []).map(t => "  " + t.method + ": " + t.rows + " rows, score " + t.score + (t.error ? " — " + t.error : "")),
    "Start of the file:", ...((d.sample || []).slice(0, 40).map(s => "  " + String(s).slice(0, 120)))].join("\n");
}

/* ---------- checks: running balance, order, direction ---------- */
function checkBalances(rows, meta){
  if (rows.length > 1 && rows[0].date > rows[rows.length - 1].date) rows.reverse();    // newest-first statements
  let bad = 0, fixed = 0, known = 0;
  for (let i = 0; i < rows.length; i++){
    const r = rows[i];
    r.balOk = null;
    if (r.balance === null || r.balance === undefined) continue;
    let prev = i > 0 ? rows[i - 1].balance : (meta.opening !== undefined ? meta.opening : null);
    if (prev === null || prev === undefined){ r.balOk = true; known++; continue; }
    known++;
    const exp = r2(prev - r.debit + r.credit);
    if (Math.abs(exp - r.balance) <= 0.011){ r.balOk = true; continue; }
    const swapped = r2(prev + r.debit - r.credit);
    if (Math.abs(swapped - r.balance) <= 0.011){ const d = r.debit; r.debit = r.credit; r.credit = d; r.balOk = true; r.fixedDir = true; fixed++; continue; }
    r.balOk = false; bad++;
  }
  if (meta.opening === undefined && rows.length && rows[0].balance !== null) meta.opening = r2(rows[0].balance + rows[0].debit - rows[0].credit);
  if (meta.closing === undefined && rows.length && rows[rows.length - 1].balance !== null) meta.closing = rows[rows.length - 1].balance;
  const totDr = r2(rows.reduce((a, r) => a + r.debit, 0)), totCr = r2(rows.reduce((a, r) => a + r.credit, 0));
  const summaryOk = meta.opening !== undefined && meta.closing !== undefined ? Math.abs(r2(meta.opening - totDr + totCr) - meta.closing) <= 0.011 : null;
  return {bad, fixed, known, totDr, totCr, summaryOk};
}
/* ---------- narrations ---------- */
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
const NARR_STRIP = /\b(UPI|NEFT|RTGS|IMPS|MMT|P2A|P2M|DR|CR|TRF|TRANSFER|TO|BY|FROM|INB|IB|CHQ|CHEQUE|PAID|DEP|DEPOSIT|CLG|CLEARING|ACH|NACH|ECS|PAYMENT|PAY|SENT|RECEIVED|REF|UTR|NA|NO|OTHERS|OTHER|INR|RS|MICR|CTS|INWARD|OUTWARD|RETURN|REV|REVERSAL|FUND|FT|BIL|ONL|MB|NET|BANKING|MOBILE|SI|INFT|BRN)\b/gi;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
function decodeNarr(n, clientName){
  const t = String(n || "").replace(/\s+/g, " ").replace(/\bUP[1l|I][1l|]?\//g, "UPI/").replace(/\bUP[1l|]-/g, "UPI-").trim(), u = t.toUpperCase();
  let mode = "OTHER";
  if (/\bUPI\b/.test(u)) mode = "UPI";
  else if (/\bNEFT\b/.test(u)) mode = "NEFT";
  else if (/\bRTGS\b/.test(u)) mode = "RTGS";
  else if (/\bIMPS\b|\bMMT\b/.test(u)) mode = "IMPS";
  else if (/\b(NACH|ACH|ECS)\b/.test(u)) mode = "NACH";
  else if (/\b(ATM|ATW|NWD|CASH\s*WDL|CASH\s*WITHDRAWAL|SELF)\b/.test(u)) mode = "ATM";
  else if (/\b(CASH\s*DEP|BY\s*CASH|CDM|CASH\s*DEPOSIT)\b/.test(u)) mode = "CASH";
  else if (/\b(CHQ|CHEQUE|CLG|CLEARING|CTS)\b/.test(u)) mode = "CHQ";
  else if (/(CHRG|CHARGE|\bSMS\b|\bAMC\b|\bFEES?\b|COMMISSION|\bGST\b\s*(ON|@)|MIN\s*BAL|NON\s*MAINT|CONSOLIDATED\s*CHARGES)/.test(u)) mode = "CHARGES";
  else if (/\b(POS|ECOM|VPS|DEBIT\s*CARD|DC\s*INTL)\b/.test(u)) mode = "CARD";
  else if (/\b(INT\.?\s*(PD|CR|PAID|CREDIT|COLL)|INTEREST)\b/.test(u)) mode = "INTEREST";
  else if (/\b(TRF|TRANSFER|FT|INB|INFT|NET\s*BANKING)\b/.test(u)) mode = "TRANSFER";
  const upiTok = t.split(/[\/\s*|:]+/).find(x => /@[a-z]{2,}/i.test(x)) || "";
  const upi = ((upiTok.split("-").find(x => /@[a-z]{2,}/i.test(x)) || "").match(/[a-z0-9._]{2,}@[a-z]{2,}/i) || [""])[0].toLowerCase();
  const chq = (u.match(/(?:CHQ|CHEQUE|CLG)\s*(?:NO\.?|PAID|DEP|DEPOSIT)?\s*[:\-]?\s*(\d{6})\b/) || [])[1] || "";
  const utr = (u.match(/\b([A-Z]{4}[RNH0-9][0-9A-Z]{9,17}|\d{12})\b/) || [])[1] || "";
  const clientKey = normName(clientName).replace(/ /g, "");
  const parts = t.split(/[\/*:|]+|\s*-\s+|\s+-\s*|-(?=[A-Za-z])|(?<=[A-Za-z])-|\s{2,}/).map(s => s.trim()).filter(Boolean);
  const bankWords = /^(?:(?:[a-z]+\s+)?bank(?:\s+(?:ltd|limited|of\s+\w+))?|hdfc|icici|sbi|axis|kotak|yes|idfc(?:\s+first)?|indusind|paytm(?:\s+payments)?|state\s+bank\s+of\s+india|punjab\s+national|canara|federal|rbl)(?:\s+bank)?$/i;
  let name = "", best = 0, bestIsRemark = false;
  for (let p of parts){
    if (/@/.test(p) || IFSC_RE.test(p.toUpperCase()) || bankWords.test(p.trim())) continue;
    p = p.replace(NARR_STRIP, " ").replace(/^\s*\d{4,}\s+|\s+\d{4,}\s*$/g, " ").replace(/\s+/g, " ").trim();
    const letters = (p.match(/[A-Za-z]/g) || []).length, digits = (p.match(/\d/g) || []).length;
    if (letters < 3 || digits > letters / 2) continue;
    if (clientKey && nameSim(p, clientName) > 0.8) continue;          // the client's own name in NEFT narrations
    let score = letters - digits * 2 + (/\s/.test(p) ? 3 : 0);
    if (upi) score += nameSim(p, upi.split("@")[0]) * 12;              // merchant name matching the UPI handle
    if (/(incorrect|invalid|account\s*(number|closed|does\s*not)|beneficiary|reason|returned?|rejected|insufficient|frozen|dormant|mismatch)/i.test(p)) continue;
    const remark = /^(rent|salary|fees?|payment|paid|sent|received|office\s*supplies|supplies|bill|invoice|advance|refund|transfer|misc|others?|expenses?|tea|snacks?|food|purchase|sale|loan|emi)(\s|$)/i.test(p);
    if (remark) score -= 8;
    if (score > best){ best = score; name = p; bestIsRemark = remark; }
  }
  // no readable name: use the UPI handle ("ramesh.gupta@okhdfc" -> "ramesh gupta")
  if (upi && bestIsRemark) name = "";
  if (!name && upi){ const h = upi.split("@")[0].replace(/[._\-]+/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim(); if (h.length >= 3) name = h.replace(/\b\w/g, c => c.toUpperCase()); }
  if (mode === "OTHER" && /\b(CMS|RTGS|FT)\b/.test(u)) mode = "TRANSFER";
  const key = upi ? "upi:" + upi : name ? "name:" + normName(name).replace(/ /g, "") : "narr:" + normName(t.replace(/\d+/g, " ")).slice(0, 40);
  return {mode, name, upi, utr, chq, key};
}
/* ---------- suggestions ---------- */
let knownLedgersCache = {key: "", map: null};
// Only real Tally ledgers (the imported list) and ledgers created here that are waiting for Tally
function knownLedgers(){
  const b = B();
  if (!b || !b.ledgers){ const m = new Map(); m.norm = new Map(); return m; }   // no client's ledger list is loaded yet
  const ck = [b.cid, b.ledgers.importedAt, b.ledgers.list.length, b.newLed.length, b.newLed.map(l => l.name).join("|").length].join("#");
  if (knownLedgersCache.key === ck && knownLedgersCache.map) return knownLedgersCache.map;
  const set = new Map();
  (b.ledgers.list || []).forEach(l => set.set(l.name.toLowerCase(), l));
  b.newLed.forEach(l => { if (!set.has(l.name.toLowerCase())) set.set(l.name.toLowerCase(), Object.assign({pending: true}, l)); });
  const norm = new Map();
  set.forEach(l => { const k = ledgerKey(l.name); if (k && !norm.has(k)) norm.set(k, l); });
  set.norm = norm;
  knownLedgersCache = {key: ck, map: set};
  return set;
}
function ledgerKey(s){ return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, ""); }
function hasLedgerList(){ const b = B(); return !!(b && b.ledgers && b.ledgers.list && b.ledgers.list.length); }
// The exact Tally spelling of a ledger, or null when Tally has no such ledger
function exactLedger(name){
  if (!name) return null;
  const k = knownLedgers();
  const hit = k.get(String(name).trim().toLowerCase()) || k.norm.get(ledgerKey(name));
  return hit ? hit.name : null;
}
function ledgerInfo(name){ const n = exactLedger(name); return n ? knownLedgers().get(n.toLowerCase()) : null; }
const STD_FIND = {
  charges: /^bank\s*(charges?|chgs?|commission)/i,
  interest: /^(bank\s*)?interest\s*(received|income|earned|on\s*(fd|fixed|savings?|deposits?|bank))|^interest\s*income/i,
  gstCash: /electronic\s*cash|gst\s*(cash|deposit)/i,
  tds: /^tds\s*payable/i,
  advanceTax: /advance\s*(income\s*)?tax|self\s*assessment/i,
  pf: /(^|\b)(pf|epf|provident\s*fund)\b.*payable|^provident\s*fund/i,
  esi: /\besic?\b.*payable|^esic?\s*(contribution|a\/c)?$/i,
  salary: /^salar(y|ies)(\s*(payable|a\/c|account|&\s*wages))?$/i,
  cash: /^cash(\s*(in\s*hand|a\/c|account))?$|cash-in-hand/i
};
// The client's own Tally ledger for a standard bank line (bank charges, interest, ...), or null
function stdLedger(co, key){
  const chosen = co.bankLedgerNames && co.bankLedgerNames[key];
  const ex = chosen ? exactLedger(chosen) : null;
  if (ex) return ex;
  const def = exactLedger(BANK_LEDGER_DEFAULTS[key]);
  if (def) return def;
  const re = STD_FIND[key], b = B();
  if (!re || !b) return null;
  const hit = (b.ledgers.list || []).find(l => re.test(l.name.trim()));
  return hit ? hit.name : null;
}
function bankLedgers(co){ const o = {}; Object.keys(BANK_LEDGER_DEFAULTS).forEach(k => { o[k] = stdLedger(co, k) || ""; }); return o; }
function ledgerStatus(name){
  if (!name) return "none";
  if (!hasLedgerList() && !B().newLed.length) return "nolist";
  const info = ledgerInfo(name);
  if (!info) return "new";
  return info.pending ? "pending" : "known";
}
function vtypeFor(row, ledger){
  const co = CO(B().cid), k = ledgerInfo(ledger);
  const g = k ? String(k.group || "") : "";
  if (/cash-in-hand|bank accounts|bank od/i.test(g) || (co.bankAccounts || []).some(a => a.ledger && a.ledger === ledger)) return "Contra";
  return row.debit ? "Payment" : "Receipt";
}
function patternFor(row, co){
  const u = row.narr.toUpperCase(), d = row.dec, out = !!row.debit;
  const mk = (key, level, label) => { const l = stdLedger(co, key); return l ? {ledger: l, level, why: label + ": standard ledger \u201c" + l + "\u201d", label, source: "pattern"} : null; };
  if (/\b(EPFO|EPF|PROVIDENT\s*FUND)\b/.test(u)) return mk("pf", "auto", "PF payment");
  if (/\b(ESIC|ESI\s*CONTRIBUTION)\b/.test(u)) return mk("esi", "auto", "ESI payment");
  if (/\b(GST\s*(PMT|PAYMENT|CHALLAN)|CPIN|GSTN|CBIC)\b/.test(u)) return mk("gstCash", "auto", "GST payment");
  if (/\b(ITNS\s*281|TDS\s*PAYMENT|281\b.*TDS)\b/.test(u)) return mk("tds", "suggest", "TDS payment");
  if (/\b(CBDT|OLTAS|ITNS\s*280|ADVANCE\s*TAX|SELF\s*ASSESSMENT|INCOME\s*TAX)\b/.test(u)) return mk("advanceTax", "suggest", "Income tax payment");
  if (d.mode === "INTEREST" && !out) return mk("interest", "auto", "Bank interest");
  if (d.mode === "CHARGES") return mk("charges", "auto", "Bank charges");
  if (d.mode === "ATM" && out) return mk("cash", "auto", "Cash withdrawal");
  if (d.mode === "CASH" && !out) return mk("cash", "auto", "Cash deposit");
  if (/\bSALARY|SAL\s*FOR|PAYROLL\b/.test(u) && out) return mk("salary", "suggest", "Salary payment");
  return null;
}
function openBills(cid){
  return Object.values(D(cid).entries || {}).filter(e => e.status === "approved" && e.snapshot && !e.paidBy).map(e => {
    const s = e.snapshot, total = num(s.total);
    const amounts = [{v: r2(total - num(s.tds)), how: s.tds ? "bill total less TDS booked" : "bill total"}];
    if (s.skip && s.skip.reason === "pay" && num(s.tdsWould) > 0) amounts.push({v: r2(total - num(s.tdsWould)), how: "bill total less TDS at payment", tdsAtPay: num(s.tdsWould), tdsLedger: CO(cid).tdsLedgers[e.natureId] || ""});
    return {e, amounts, name: e.x.vendorName, ledger: e.partyLedger, date: e.x.invoiceDate, ref: e.x.invoiceNo};
  });
}
// A receipt equal to one open sales invoice (or two of the same customer) of an earlier date
function openSalesInvoices(){
  const b = B();
  return (b.salesRef || []).filter(v => v.status !== "ignored" && !v.receivedBy && num(v.x.total) > 0 && v.customerLedger);
}
function matchSalesInvoice(row, invs, taken){
  const amt = row.credit;
  const cands = invs.filter(v => !taken.has(v.id) && (!v.x.date || v.x.date <= row.date));
  const score = v => Math.max(nameSim(row.dec.name, v.x.customerName), nameSim(row.dec.name, v.customerLedger));
  let hits = cands.filter(v => Math.abs(num(v.x.total) - amt) <= 1).map(v => ({inv: [v], sim: score(v)}));
  if (!hits.length){
    // two invoices of one customer paid together
    const byCust = new Map();
    cands.forEach(v => { const k = v.customerLedger; (byCust.get(k) || byCust.set(k, []).get(k)).push(v); });
    byCust.forEach(list => { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (Math.abs(num(list[i].x.total) + num(list[j].x.total) - amt) <= 1) hits.push({inv: [list[i], list[j]], sim: score(list[i])}); });
  }
  if (!hits.length) return null;
  hits.sort((a, b2) => b2.sim - a.sim);
  const h = hits[0];
  if (h.sim < 0.45 && hits.length > 1) return null;
  if (h.sim < 0.3 && row.dec.name) return null;
  return {inv: h.inv, strong: h.sim >= 0.6};
}
function matchBill(row, bills, taken){
  const amt = row.debit;
  const hits = [];
  bills.forEach(b => {
    if (taken.has(b.e.id)) return;
    if (b.date && row.date < b.date) return;
    b.amounts.forEach(a => {
      if (Math.abs(a.v - amt) > 1) return;
      const sim = Math.max(nameSim(row.dec.name, b.name), nameSim(row.dec.name, b.ledger));
      hits.push({b, a, sim});
    });
  });
  if (!hits.length) return null;
  hits.sort((x, y) => y.sim - x.sim);
  const h = hits[0];
  if (h.sim < 0.45 && hits.length > 1) return null;
  if (h.sim < 0.45 && !row.dec.name) return null;
  if (h.sim < 0.3) return null;
  return {bill: h.b, how: h.a.how, strong: h.sim >= 0.6, tdsAtPay: h.a.tdsAtPay || 0, tdsLedger: h.a.tdsLedger || ""};
}
function partyKey(d){ const n = normName(d.name || "").replace(/ /g, "").replace(/pvtltd|privatelimited|pvt|ltd$/g, ""); return n.length >= 4 ? "name:" + n : ""; }
function findRule(ctx, d, dir){
  const keys = [d.key, partyKey(d)].filter(Boolean);
  for (const k of keys){
    const r = ctx.ruleMap.get(k + "|" + dir) || ctx.ruleMap.get(k + "|any");
    if (r) return r;
  }
  return null;
}
/* ---------- history: every decision is remembered and used for suggestions ---------- */
const HIST_STOP = new Set("UPI NEFT RTGS IMPS MMT ACH NACH ECS CHQ CHEQUE CLG CTS MICR TRF TRANSFER FROM PAYMENT PAYMENTS PAY PAID SENT RECEIVED REF UTR THE AND FOR WITH PVT LTD PRIVATE LIMITED LLP BANK BANKING NET MOBILE INB INFT RETURN REV REVERSAL OTHERS OTHER INR DEBIT CREDIT JAN FEB MAR APR MAY JUN JUL AUG SEP SEPT OCT NOV DEC PHONE NETBANK".split(" "));
function narrTokens(r){
  const u = String(r.narr || "").toUpperCase().replace(/[^A-Z]+/g, " ");
  const out = new Set();
  u.split(" ").forEach(w => { if (w.length >= 3 && !HIST_STOP.has(w)) out.add(w); });
  return Array.from(out).sort().slice(0, 10);
}
function histEntry(r, ledger, src){
  return {k: r.dec.key, p: partyKey(r.dec), t: narrTokens(r).join(" "), l: ledger, d: r.debit ? "out" : "in", dt: r.date, s: src, n: r.dec.name || r.dec.upi || ""};
}
// record decided rows; returns what was there before, for undo
function learnRows(rows, src){
  const b = B(), prev = {};
  try { learnAcrossClients(rows); } catch (e){}
  rows.forEach(r => {
    if (!r || !r.fp) return;
    if (!(r.fp in prev)) prev[r.fp] = b.hist.rows[r.fp] || null;
    if (r.ledger && (r.state === "ready" || r.state === "sent" || r.state === "intally")) b.hist.rows[r.fp] = histEntry(r, r.ledger, src);
  });
  b.histVer++;
  saveBank({hist: true});
  return prev;
}
function unlearnRows(rows){
  const b = B(), prev = {};
  rows.forEach(r => { if (r && r.fp && b.hist.rows[r.fp]){ prev[r.fp] = b.hist.rows[r.fp]; delete b.hist.rows[r.fp]; } });
  b.histVer++;
  saveBank({hist: true});
  return prev;
}
function restoreHist(prev){
  const b = B();
  if (!prev) return;
  Object.keys(prev).forEach(fp => { if (prev[fp]) b.hist.rows[fp] = prev[fp]; else delete b.hist.rows[fp]; });
  b.histVer++;
  saveBank({hist: true});
}
let histIndexCache = {ver: -1, cid: null, idx: null};
function histIndex(){
  const b = B();
  if (histIndexCache.ver === b.histVer && histIndexCache.cid === b.cid) return histIndexCache.idx;
  const byKey = new Map(), bySig = new Map(), tokIdx = new Map(), byFp = new Map();
  const add = (map, key, e) => {
    if (!key) return;
    let m = map.get(key); if (!m){ m = new Map(); map.set(key, m); }
    let v = m.get(e.l); if (!v){ v = {n: 0, out: 0, inn: 0, last: ""}; m.set(e.l, v); }
    v.n++; if (e.d === "out") v.out++; else v.inn++;
    if (e.dt > v.last) v.last = e.dt;
  };
  Object.entries(b.hist.rows).forEach(([fp, e]) => {
    byFp.set(fp, e);
    add(byKey, e.k, e);
    if (e.p && e.p !== e.k) add(byKey, e.p, e);
    if (e.t){ add(bySig, e.t, e); e.t.split(" ").forEach(w => { let set = tokIdx.get(w); if (!set){ set = new Set(); tokIdx.set(w, set); } set.add(e.t); }); }
  });
  const idx = {byKey, bySig, tokIdx, byFp, size: byFp.size};
  histIndexCache = {ver: b.histVer, cid: b.cid, idx};
  return idx;
}
function rankLedgers(m, dir){
  return Array.from(m.entries()).map(([l, v]) => ({l, n: v.n, w: (dir === "out" ? v.out : v.inn) + (dir === "out" ? v.inn : v.out) * 0.5, last: v.last}))
    .sort((a, b) => b.w - a.w || b.last.localeCompare(a.last));
}
// What the history says about one row
function historyFor(r){
  const H = histIndex();
  if (!H.size) return null;
  const dir = r.debit ? "out" : "in";
  const own = r.fp && H.byFp.get(r.fp);
  const merged = new Map();
  Array.from(new Set([r.dec.key, partyKey(r.dec)].filter(Boolean))).forEach(k => {
    const m = H.byKey.get(k);
    if (m) m.forEach((v, l) => { const x = merged.get(l); if (!x || v.n > x.n) merged.set(l, {n: v.n, out: v.out, inn: v.inn, last: v.last > (x ? x.last : "") ? v.last : x.last}); });
  });
  if (merged.size) return {kind: own ? "same" : "party", ranked: rankLedgers(merged, dir), own};
  if (own) return {kind: "same", ranked: [{l: own.l, n: 1, w: 1, last: own.dt}], own};
  // similar narration: words in common
  const toks = narrTokens(r);
  if (toks.length < 2) return null;
  const cands = new Set();
  toks.forEach(w => { const set = H.tokIdx.get(w); if (set && set.size < 400) set.forEach(sig => cands.add(sig)); });
  let best = null;
  cands.forEach(sig => {
    const st = sig.split(" ");
    const inter = st.filter(w => toks.includes(w)).length;
    const jac = inter / (st.length + toks.length - inter);
    if (jac >= 0.6 && (!best || jac > best.jac)) best = {sig, jac};
  });
  if (!best) return null;
  return {kind: "similar", ranked: rankLedgers(H.bySig.get(best.sig), dir), jac: best.jac};
}
function historyWhy(h){
  const top = h.ranked[0];
  const others = h.ranked.slice(1, 3).map(x => x.l + " " + x.n + "\u00d7").join(", ");
  const when = top.last ? " (last " + fmtDate(top.last) + ")" : "";
  const base = h.kind === "same" && h.own && h.ranked.length === 1 ? "you booked this same transaction to " + h.own.l + " before"
    : h.kind === "similar" ? "narration like one you booked to " + top.l + when
    : "booked to " + top.l + " " + top.n + " time" + (top.n > 1 ? "s" : "") + " before for this party" + when;
  return base + (others ? "; also used: " + others : "");
}
/* ---------- what the firm has learnt across all clients ---------- */
// one shared book of "this payee is usually booked to this kind of ledger"
function crossBook(){ S.firm.crossBook = S.firm.crossBook || {}; return S.firm.crossBook; }
function crossKey(text, dir){ return (text || "").toUpperCase() + "|" + (dir || "any"); }
// remember a decision for the whole firm, not just this client
function learnAcrossClients(rows){
  const cid = S.bank && S.bank.cid;
  if (!cid) return;
  const book = crossBook();
  let touched = 0;
  (rows || []).forEach(r => {
    if (!r || !r.ledger || !["ready", "sent", "intally"].includes(r.state)) return;
    const text = steadyPart(r.narr) || normName(r.dec.name || "").toUpperCase();
    if (!text || text.length < 4) return;
    const k = crossKey(text, r.debit ? "out" : "in");
    const e = book[k] || {text, dir: r.debit ? "out" : "in", leds: {}, clients: {}, n: 0};
    e.leds[r.ledger] = (e.leds[r.ledger] || 0) + 1;
    e.clients[cid] = true;
    e.n++;
    e.at = new Date().toISOString();
    book[k] = e;
    touched++;
  });
  if (touched){
    // keep the book small: the 4,000 most used patterns
    const keys = Object.keys(book);
    if (keys.length > 4000){
      keys.sort((a, b) => (book[b].n || 0) - (book[a].n || 0)).slice(4000).forEach(k => { delete book[k]; });
    }
    Store.saveFirm();
  }
}
// what have other clients called this payee, and what is the nearest ledger here?
function crossSuggest(row, ctx){
  const book = S.firm.crossBook;
  if (!book) return null;
  const cid = S.bank && S.bank.cid;
  const text = steadyPart(row.narr) || normName(row.dec.name || "").toUpperCase();
  if (!text || text.length < 4) return null;
  const e = book[crossKey(text, row.debit ? "out" : "in")] || book[crossKey(text, "any")];
  if (!e) return null;
  const others = Object.keys(e.clients || {}).filter(x => x !== cid).length;
  if (!others) return null;                                    // only this client: the normal history covers it
  const ranked = Object.entries(e.leds).sort((a, b) => b[1] - a[1]);
  for (const [name] of ranked){
    const exact = exactLedger(name);
    if (exact) return {ledger: exact, same: true, from: others, was: name};
    const near = closestTallyLedger(name);               // the nearest ledger this client actually has
    if (near) return {ledger: near, same: false, from: others, was: name};
  }
  return {ledger: "", missing: ranked[0] ? ranked[0][0] : "", from: others};
}

function suggestRow(row, ctx){
  const d = row.dec;
  const dir = row.debit ? "out" : "in";
  const none = why => ({ledger: "", level: "none", why, label: "", source: ""});
  if (!ctx.hasList) return none("Import the Tally ledger list to get suggestions.");
  const rule = findRule(ctx, d, dir);
  if (rule){
    const l = exactLedger(rule.ledger);
    if (l) return {ledger: l, level: rule.auto ? "auto" : "suggest", why: "Saved rule: " + (d.name || d.upi || "this narration") + " \u2192 " + l, label: "Saved rule", source: "rule"};
  }
  if (dir === "out"){
    const m = matchBill(row, ctx.bills, ctx.taken);
    if (m){
      const l = exactLedger(m.bill.ledger) || exactLedger(m.bill.name);
      if (l){
        ctx.taken.add(m.bill.e.id);
        return {ledger: l, level: m.strong ? "auto" : "suggest", why: "Pays bill " + m.bill.ref + " dated " + fmtDate(m.bill.date) + " (" + m.how + ")", label: "Bill " + m.bill.ref, source: "bill",
          billId: m.bill.e.id, billRef: m.bill.ref, tdsAtPay: m.tdsAtPay, tdsLedger: exactLedger(m.tdsLedger) || stdLedger(ctx.co, "tds") || ""};
      }
    }
  }
  // the party's bank account number is on its Tally ledger
  if (ctx.acIndex.size){
    const nums = row.narr.match(/\d{9,18}/g) || [];
    for (const nm of nums){
      const l = ctx.acIndex.get(nm.replace(/^0+/, ""));
      if (l) return {ledger: l.name, level: "auto", why: "Account " + nm + " in the narration is the bank account on the Tally ledger " + l.name, label: "Bank account match", source: "account"};
    }
  }
  if (dir === "in" && ctx.salesInvs.length){
    const m = matchSalesInvoice(row, ctx.salesInvs, ctx.takenSales);
    if (m){
      const l = exactLedger(m.inv[0].customerLedger);
      if (l){
        m.inv.forEach(v => ctx.takenSales.add(v.id));
        const refs = m.inv.map(v => v.x.number).join(" + ");
        return {ledger: l, level: m.strong ? "auto" : "suggest", why: "Receipt against sales invoice " + refs + " (" + m.inv.map(v => fmtDate(v.x.date)).join(", ") + ")", label: "Sales invoice " + refs, source: "sales", salesIds: m.inv.map(v => v.id), billRef: m.inv.map(v => v.x.number).join(", ")};
      }
    }
  }
  const p = patternFor(row, ctx.co);
  const h = historyFor(row);
  if (h && h.ranked.length){
    const top = h.ranked.map(x => ({x, l: exactLedger(x.l)})).find(y => y.l);
    if (top){
      // booked the same way at least twice and never differently: sure
      const consistent = h.kind !== "similar" && h.ranked.length === 1 && top.x.n >= 2;
      const sure = (p && p.ledger === top.l) || consistent;
      return {ledger: top.l, level: sure ? "auto" : "suggest", why: historyWhy(h),
        label: h.kind === "similar" ? "Similar past entry" : h.kind === "same" && h.own ? "Booked before" : "Past entries (" + top.x.n + ")", source: "history"};
    }
  }
  if (p) return p;
  if (d.name){
    const pk = partyKey(d) || d.key;
    let best = ctx.simCache.get(pk);
    if (best === undefined){
      const exact = ctx.ledgerExact.get(normName(d.name).replace(/ /g, ""));
      best = exact ? {l: exact, s: 1} : null;
      if (!best) ctx.ledgerList.forEach(l => { const s = nameSim(d.name, l.name); if (s >= 0.85 && (!best || s > best.s)) best = {l, s}; });
      // names the bank cut short ("SATYENDRAS") that start exactly one Tally ledger
      if (!best){
        const cn = normName(d.name).replace(/ /g, "");
        if (cn.length >= 8){
          const c = ctx.partyCompact.filter(x => x.c.startsWith(cn) || (x.c.length >= 8 && cn.startsWith(x.c)));
          if (c.length === 1) best = {l: c[0].l, s: 0.86, prefix: true};
        }
      }
      ctx.simCache.set(pk, best);
    }
    if (best && best.s >= 0.85){
      const sure = best.s >= 0.99 && /sundry/i.test(best.l.group || "");
      return {ledger: best.l.name, level: sure ? "auto" : "suggest", why: best.prefix ? "The shortened bank name \u201c" + d.name + "\u201d starts the Tally ledger \u201c" + best.l.name + "\u201d" : "Party name matches the Tally ledger \u201c" + best.l.name + "\u201d (" + Math.round(best.s * 100) + "%)", label: "Name match", source: "ledger"};
    }
  }
  // UPI handle that spells a ledger name ("sharmastationery@okaxis")
  if (d.upi){
    const hc = d.upi.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
    if (hc.length >= 6){
      const c = ctx.partyCompact.filter(x => x.c.length >= 6 && (x.c.startsWith(hc) || hc.startsWith(x.c)));
      if (c.length === 1) return {ledger: c[0].l.name, level: "suggest", why: "The UPI handle " + d.upi + " matches the Tally ledger " + c[0].l.name, label: "UPI match", source: "ledger"};
    }
  }
  // what the firm's other clients call this payee
  const cross = crossSuggest(row, ctx);
  if (cross && cross.ledger){
    return {ledger: cross.ledger, level: "suggest",
      why: cross.same
        ? "Your other clients (" + cross.from + ") book this payee to \u201c" + cross.ledger + "\u201d, and this client has that ledger."
        : "Your other clients (" + cross.from + ") book this payee to \u201c" + cross.was + "\u201d; the nearest ledger here is \u201c" + cross.ledger + "\u201d. Please check.",
      label: "used by your other clients", source: "firm"};
  }
  if (cross && cross.missing){
    return {ledger: "", level: "none", label: "", source: "firm",
      why: "Your other clients book this payee to \u201c" + cross.missing + "\u201d, but this client's Tally has no ledger like that. Choose one, or create it."};
  }
  return none(d.name ? "No Tally ledger found for \u201c" + d.name + "\u201d" : "The other party could not be identified from the narration.");
}
