/* ================================================================== */
/* A filter on every column of every table, and long tables that     */
/* scroll inside their own box with the heading kept in view         */
/* ================================================================== */
// Tables that already have their own filters (bills, bank, sales) are left as they are.
function gfN(n){ if (typeof GridF !== "object") return n; if (GridF.full()) return Infinity; GridF.cut = true; return n; }
const GridF = {
  pop: null,
  // which screen this is, so a filter stays with its own table
  where(){ const s = [S.view, S.tab, S.homeTab]; Object.keys(S).filter(k => /(Tab|Part|Scope)$/.test(k) && typeof S[k] === "string").sort().forEach(k => s.push(k + "=" + S[k])); return s.join("|"); },
  heads(t){ const tr = t.tHead && t.tHead.rows[t.tHead.rows.length - 1]; return tr ? Array.from(tr.cells) : []; },
  label(th){ return String((th.querySelector(".gfl") || th).textContent || "").trim(); },
  key(t, i){ return this.where() + "|" + i + "|" + this.heads(t).map(th => this.label(th)).join("/"); },
  st(t){ S.gridF = S.gridF || {}; const k = t.dataset.gfkey; return S.gridF[k] = S.gridF[k] || {}; },
  // data rows: one cell per heading, none spanning; totals and section rows are left alone
  rows(t){ const n = this.heads(t).length; return Array.from(t.tBodies).flatMap(tb => Array.from(tb.rows)).filter(r => r.cells.length === n && !Array.from(r.cells).some(c => c.colSpan > 1) && !r.classList.contains("gf-sum")); },
  first(c){ const tx = String(c.innerText || c.textContent || "").trim(); return tx.split("\n")[0].trim(); },
  num(s){ let t = String(s || "").replace(/[₹,\s%]/g, ""); const neg = /^\(.*\)$/.test(t); t = t.replace(/[()]/g, ""); if (!/^-?\d+(\.\d+)?$/.test(t)) return null; return (neg ? -1 : 1) * Number(t); },
  isNum(t, i, rows){ const th = this.heads(t)[i]; if (th && th.classList.contains("n")) return true; let n = 0, k = 0; rows.forEach(r => { const v = this.first(r.cells[i]); if (v && v !== "\u2014"){ n++; if (this.num(v) != null) k++; } }); return n > 0 && k / n >= 0.9; },
  // tables cut short for speed (gfN) show every row once a filter is set on their screen, so a filter finds them all
  full(){ const w = this.where() + "|"; return Object.keys(S.gridF || {}).some(k => k.startsWith(w) && Object.values(S.gridF[k] || {}).some(f => this.active(f))); },
  cut: false, cutSeen: false,
  active(f){ return !!f && ((f.sel && f.sel.length) || f.q || f.from || f.to || f.min !== undefined && f.min !== "" || f.max !== undefined && f.max !== ""); },
  // a date as shown ("01 Apr 2025", "30 Sept 2025", "01/04/2025", "2025-04-01") to yyyy-mm-dd, or ""
  MON: {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12},
  date(s){
    const x = String(s || "").trim(), p2 = n => String(n).padStart(2, "0");
    let m = x.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = x.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,4}|\d{1,2})[\s\-\/.,]+(\d{4})\b/); if (!m) return "";
    const mo = /\d/.test(m[2]) ? +m[2] : this.MON[m[2].toLowerCase()];
    return mo >= 1 && mo <= 12 && +m[1] >= 1 && +m[1] <= 31 ? m[3] + "-" + p2(mo) + "-" + p2(m[1]) : "";
  },
  isDate(t, i, rows){ let n = 0, k = 0; rows.slice(0, 200).forEach(r => { const v = this.first(r.cells[i]); if (v && v !== "\u2014"){ n++; if (this.date(v)) k++; } }); return n > 0 && k / n >= 0.9; },
  // the quick ranges, as on the purchase page (the year runs April to March)
  quick(q){
    const d = new Date(), y = d.getFullYear(), m = d.getMonth(), iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
    const qs = m - (m + 9) % 3, fy = m >= 3 ? y : y - 1;
    const r = {month: [new Date(y, m, 1), new Date(y, m + 1, 0)], last: [new Date(y, m - 1, 1), new Date(y, m, 0)], quarter: [new Date(y, qs, 1), new Date(y, qs + 3, 0)],
      fy: [new Date(fy, 3, 1), new Date(fy + 1, 2, 31)], lastfy: [new Date(fy - 1, 3, 1), new Date(fy, 2, 31)]}[q];
    return r ? [iso(r[0]), iso(r[1])] : null;
  },
  pass(r, f, i, num){
    const c = r.cells[i], v = this.first(c), all = String(c.innerText || "").toLowerCase();
    if (f.sel && f.sel.length && !f.sel.includes(v)) return false;
    if (f.from || f.to){ const d = this.date(v); if (!d || (f.from && d < f.from) || (f.to && d > f.to)) return false; }
    if (f.q){ const words = String(f.q).toLowerCase().split(",").map(z => z.trim()).filter(Boolean); const hit = words.some(w => all.includes(w)); if (f.not ? hit : !hit) return false; }
    if (num && (f.min !== undefined && f.min !== "" || f.max !== undefined && f.max !== "")){ const x = this.num(v); if (x == null) return false; if (f.min !== "" && f.min !== undefined && x < Number(f.min)) return false; if (f.max !== "" && f.max !== undefined && x > Number(f.max)) return false; }
    return true;
  },
  // after every render: funnels on the headings, filters applied, long tables boxed
  after(){
    this.cutSeen = this.cut; this.cut = false;
    const tables = Array.from(document.querySelectorAll("#app table.bk-table"));
    tables.forEach((t, ti) => {
      if (t.querySelector(".colf") || t.classList.contains("gf-off")) return;
      const hs = this.heads(t); if (!hs.length) return;
      const rows = this.rows(t);
      t.dataset.gfkey = this.key(t, ti);
      if (rows.length >= 4) hs.forEach((th, i) => {
        if (th.querySelector(".gff") || !this.label(th) || th.querySelector("input")) return;
        th.innerHTML = '<span class="colh"><span class="gfl">' + th.innerHTML + '</span><button class="colf gff" data-gfi="' + i + '" aria-label="Filter" title="Filter this column">' + FUNNEL + "</button></span>";
      });
      this.apply(t);
      const wrap = t.closest(".bk-tablewrap");
      if (wrap && rows.length > 18) wrap.classList.add("gf-scroll");
    });
    if (this.pop){ const t = document.querySelector('#app table.bk-table[data-gfkey="' + CSS.escape(this.pop.key) + '"]'); if (!t) this.close(); else this.place(t); }
  },
  apply(t){
    const f = this.st(t), rows = this.rows(t), hs = this.heads(t), on = Object.keys(f).filter(i => this.active(f[i]));
    const nums = {}; on.forEach(i => { nums[i] = this.isNum(t, +i, rows); });
    // a filter set on a screen whose tables were cut short: drawn again with every row, then filtered
    if (on.length && this.cutSeen && !this.redraw){ this.redraw = setTimeout(() => { this.redraw = null; render(); }, 250); }
    let shown = 0;
    // every row read first, then shown or hidden (reading text between changes would lay the page out again per row)
    const keep = rows.map(r => on.every(i => this.pass(r, f[i], +i, nums[i])));
    rows.forEach((r, k) => { r.style.display = keep[k] ? "" : "none"; if (keep[k]) shown++; });
    hs.forEach((th, i) => { const b = th.querySelector(".gff"); if (b) b.classList.toggle("on", this.active(f[i])); });
    // what is shown, and its sums, just above the table
    const wrap = t.closest(".bk-tablewrap") || t;
    let bar = wrap.previousElementSibling && wrap.previousElementSibling.classList.contains("gf-bar") ? wrap.previousElementSibling : null;
    if (!on.length){ if (bar) bar.remove(); return; }
    if (!bar){ bar = document.createElement("div"); bar.className = "gf-bar"; wrap.parentNode.insertBefore(bar, wrap); }
    const sums = [];
    hs.forEach((th, i) => { if (!this.isNum(t, i, rows) || /rate|%|days|no\.?$|number/i.test(this.label(th))) return; let s = 0, any = false; rows.forEach(r => { if (r.style.display === "none") return; const x = this.num(this.first(r.cells[i])); if (x != null){ s += x; any = true; } }); if (any) sums.push(esc(this.label(th)) + " <b>" + INR.format(r2(s)) + "</b>"); });
    bar.innerHTML = "<span>Showing <b>" + shown + "</b> of " + rows.length + "</span>" + (sums.length ? '<span class="gf-sums">' + sums.join(" \u00b7 ") + "</span>" : "") + '<button class="linkbtn" data-gfclear="' + esc(t.dataset.gfkey) + '">Clear filters</button>';
  },
  open(btn){
    const t = btn.closest("table"), i = +btn.dataset.gfi;
    if (this.pop && this.pop.key === t.dataset.gfkey && this.pop.i === i){ this.close(); return; }
    this.pop = {key: t.dataset.gfkey, i, search: ""};
    this.draw(t); this.place(t);
  },
  values(t, i){ const m = new Map(); this.rows(t).forEach(r => { const v = this.first(r.cells[i]); m.set(v, (m.get(v) || 0) + 1); }); return Array.from(m.entries()).sort((a, c) => c[1] - a[1] || String(a[0]).localeCompare(String(c[0]))); },
  draw(t){
    const p = this.pop, i = p.i, f = this.st(t)[i] || {}, rows = this.rows(t), dt = this.isDate(t, i, rows), num = !dt && this.isNum(t, i, rows), label = this.label(this.heads(t)[i]);
    let el = document.getElementById("gfpop");
    if (!el){ el = document.createElement("div"); el.id = "gfpop"; el.className = "colpop"; document.body.appendChild(el); }
    const vals = this.values(t, i), q = p.search.toLowerCase(), many = vals.length > 400;
    const shown = (q ? vals.filter(([v]) => String(v).toLowerCase().includes(q) || (f.sel || []).includes(v)) : vals).slice(0, 400);
    el.innerHTML = '<div class="cp-head"><b>' + esc(label) + '</b><button class="linkbtn" data-gfx="close" aria-label="Close">\u00d7</button></div><div class="cp-body">' +
      (dt ? '<div class="cp-quick">' + [["month", "This month"], ["last", "Last month"], ["quarter", "This quarter"], ["fy", "This year"], ["lastfy", "Last year"]].map(([v, l]) => '<button class="cp-chip" data-gfq="' + v + '">' + l + "</button>").join("") + "</div>" +
        '<div class="cp-range"><label>From<input type="date" data-gfin="from" value="' + esc(f.from || "") + '"></label><label>To<input type="date" data-gfin="to" value="' + esc(f.to || "") + '"></label></div>' : "") +
      (num ? '<div class="cp-range"><label>From<input type="text" inputmode="decimal" data-gfin="min" value="' + esc(f.min || "") + '" placeholder="any"></label><label>To<input type="text" inputmode="decimal" data-gfin="max" value="' + esc(f.max || "") + '" placeholder="any"></label></div>' : "") +
      '<div class="cp-row"><select data-gfin="not"><option value="">Has</option><option value="1"' + (f.not ? " selected" : "") + '>Does not have</option></select><input type="text" data-gfin="q" value="' + esc(f.q || "") + '" placeholder="words, commas between"></div>' +
      (vals.length > 1 && !((num || dt) && vals.length > 60) ? '<p class="cp-sub">Or only these' + (many ? " (the first 400; search to narrow)" : "") + ':</p><input type="search" class="cp-search" data-gfin="search" value="' + esc(p.search) + '" placeholder="Search\u2026">' +
        '<div class="cp-list">' + shown.map(([v, n]) => '<label class="cp-item"><input type="checkbox" data-gfv="' + esc(v) + '"' + ((f.sel || []).includes(v) ? " checked" : "") + "><span>" + esc(v === "" ? "(blank)" : v) + "</span><small>" + n + "</small></label>").join("") + "</div>" : "") +
      '</div><div class="cp-foot"><button class="btn small" data-gfx="clear">Clear</button><button class="btn small primary" data-gfx="close">Done</button></div>';
  },
  place(t){
    const el = document.getElementById("gfpop"), b = t.querySelector('.gff[data-gfi="' + this.pop.i + '"]');
    if (!el || !b) return;
    const r = b.getBoundingClientRect(), w = 252;
    el.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left - 8)) + "px";
    // below the funnel; above it when there is no room below, so the buttons stay on the screen
    const h = el.offsetHeight, below = r.bottom + 6;
    el.style.top = (below + h <= window.innerHeight - 8 ? below : Math.max(8, Math.min(r.top - h - 6, window.innerHeight - h - 8))) + "px";
  },
  close(){ this.pop = null; const el = document.getElementById("gfpop"); if (el) el.remove(); },
  table(){ return this.pop ? document.querySelector('#app table.bk-table[data-gfkey="' + CSS.escape(this.pop.key) + '"]') : null; },
  set(k, v){
    const t = this.table(); if (!t) return;
    const st = this.st(t), f = st[this.pop.i] = st[this.pop.i] || {};
    if (k === "search"){ this.pop.search = v; this.draw(t); const s = document.querySelector('#gfpop [data-gfin="search"]'); if (s){ s.focus(); s.setSelectionRange(v.length, v.length); } return; }
    if (k === "not") f.not = !!v; else f[k] = v;
    this.apply(t);
  }
};
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest(".gff");
  if (b){ e.preventDefault(); e.stopPropagation(); GridF.open(b); return; }
  const c = e.target.closest && e.target.closest("[data-gfclear]");
  if (c){ const t = document.querySelector('#app table.bk-table[data-gfkey="' + CSS.escape(c.dataset.gfclear) + '"]'); if (t){ S.gridF[t.dataset.gfkey] = {}; GridF.apply(t); } GridF.close(); return; }
  const qk = e.target.closest && e.target.closest("#gfpop [data-gfq]");
  if (qk){ const t = GridF.table(), r = GridF.quick(qk.dataset.gfq); if (t && r){ const st = GridF.st(t), f = st[GridF.pop.i] = st[GridF.pop.i] || {}; f.from = r[0]; f.to = r[1]; GridF.apply(t); GridF.draw(t); } return; }
  const x = e.target.closest && e.target.closest("#gfpop [data-gfx]");
  if (x){ const t = GridF.table(); if (x.dataset.gfx === "clear" && t){ delete GridF.st(t)[GridF.pop.i]; GridF.apply(t); GridF.draw(t); } else GridF.close(); return; }
  if (GridF.pop && !(e.target.closest && e.target.closest("#gfpop"))) GridF.close();
}, true);
document.addEventListener("input", e => {
  const el = e.target;
  if (!el.closest || !el.closest("#gfpop")) return;
  if (el.dataset.gfin) GridF.set(el.dataset.gfin, el.value);
  if (el.dataset.gfv !== undefined){ const t = GridF.table(); if (!t) return; const st = GridF.st(t), f = st[GridF.pop.i] = st[GridF.pop.i] || {}; f.sel = f.sel || [];
    if (el.checked){ if (!f.sel.includes(el.dataset.gfv)) f.sel.push(el.dataset.gfv); } else f.sel = f.sel.filter(v => v !== el.dataset.gfv); GridF.apply(t); }
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && GridF.pop) GridF.close(); });
window.addEventListener("resize", () => { const t = GridF.table(); if (t) GridF.place(t); });
