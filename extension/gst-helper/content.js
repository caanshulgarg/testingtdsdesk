/* FinCom GST helper: runs in the person's own GST portal tab (https://*.gst.gov.in only). Each command from the side panel
 * is one step on the page that is open: it checks that every field the step needs is there (selectors.js), types FinCom's
 * figures, reads them back, and answers. It never presses a filing, payment, signing or OTP button, never touches the
 * captcha, and keeps nothing: no figure or password is stored by this script. Plain rules only, no AI. */
(function () {
  "use strict";
  if (window.__fincomGstHelper) return;
  window.__fincomGstHelper = true;
  const SEL = self.GSTH_SEL, R = self.GSTH_RULES;

  class Stop extends Error { constructor(step, field, message) { super(message); this.step = step; this.field = field; } }
  const norm = (s) => String(s === undefined || s === null ? "" : s).replace(/\s+/g, "").toLowerCase();
  const tpl = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] !== undefined ? String(v[k]) : m));
  const rk = (r) => String(r).replace(".", "_");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms) { const end = Date.now() + (ms || 8000); for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(100); } }
  const visible = (e) => !!(e && (e.offsetParent !== null || e.getClientRects().length));

  // find one element by a selector of selectors.js; null when it is not on the page
  function find(s, root, vars) {
    if (!s) return null;
    let scope = root || document;
    if (s.in) { scope = find(s.in, root, vars); if (!scope) return null; }
    let els = Array.from(scope.querySelectorAll(tpl(s.css, vars)));
    if (s.text) {
      const t = norm(tpl(s.text, vars)), txt = (e) => norm(e.textContent || e.value || "");
      let m = els.filter((e) => txt(e).includes(t));
      m = m.filter((e) => !m.some((o) => o !== e && e.contains(o)));          // the innermost
      const starts = m.filter((e) => txt(e).startsWith(t));
      els = starts.length ? starts : m;
    }
    const vis = els.filter(visible);
    return (vis.length ? vis : els)[s.nth || 0] || null;
  }
  function need(step, name, s, root, vars, label) {
    const el = find(s, root, vars);
    if (!el) throw new Stop(step, name, "Step “" + step + "”: the field “" + (label || name) + "” was not found on this portal page (" + location.pathname + "). " +
      "The helper stopped here and typed nothing more; it never guesses a field. The portal may have changed: the selectors file (version " + SEL.version + ") needs this field corrected.");
    return el;
  }
  function press(step, name, el) {
    const words = (el.textContent || el.value || "").trim();
    if (R.forbidden(words)) throw new Stop(step, name, "Step “" + step + "”: the helper refused to press “" + words + "”. Filing, payment and signing are always yours.");
    el.click();
  }
  // typed as a person would: the value set, then the page's own input, change and blur events
  function put(step, name, el, v) {
    if (el.tagName === "SELECT") {
      const want = String(v), opt = Array.from(el.options).find((o) => o.value === want) || Array.from(el.options).find((o) => norm(o.textContent).startsWith(norm(want) + "-"));
      if (!opt) throw new Stop(step, name, "Step “" + step + "”: “" + name + "” has no choice “" + want + "” on the portal; the helper stopped rather than pick another.");
      el.value = opt.value;
    } else if (el.type === "checkbox") {
      const on = v === true || v === "Y" || v === "y";
      if (el.checked !== on) el.click();
      return;
    } else {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      el.focus(); d.set.call(el, String(v));
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  const money = (v) => (Math.round((+v || 0) * 100) / 100).toFixed(2);
  function putMoney(step, name, el, v) {
    put(step, name, el, money(v));
    if (R.paise(el.value) !== R.paise(money(v))) throw new Stop(step, name, "Step “" + step + "”: “" + name + "” shows " + el.value + " after typing " + money(v) + "; the helper stopped.");
  }
  const readText = (el) => (el ? (el.tagName === "INPUT" || el.tagName === "SELECT" ? el.value : el.textContent).trim() : "");

  /* ---------- the steps ---------- */
  const P = SEL.pages;
  const C = {
    ping: async () => ({ ok: true, page: pageOf(), url: location.href, selectors: SEL.version }),

    // the login page: user id and password typed in; the cursor left in the captcha box for the person
    fillLogin: async ({ username, password }) => {
      const step = "Log in", f = P.login.fields;
      const u = need(step, "username", f.username, null, null, "Username"), p = need(step, "password", f.password, null, null, "Password"), c = need(step, "captcha", f.captcha, null, null, "Captcha");
      put(step, "username", u, username); put(step, "password", p, password);
      username = null; password = null;
      c.focus();
      return { ok: true, message: "User id and password typed. Type the captcha shown on the page and press LOGIN; type the OTP if the portal asks." };
    },

    // the returns dashboard: the year, quarter and month chosen, then the return opened
    dashboard: async ({ ym, go }) => {
      const step = "Choose the period", d = P.dashboard, f = d.fields;
      const fy = need(step, "fy", f.fy, null, null, "Financial Year"), q = need(step, "quarter", f.quarter, null, null, "Quarter"), m = need(step, "period", f.period, null, null, "Period");
      put(step, "fy", fy, d.fyValue(ym)); put(step, "quarter", q, d.quarterValue(ym)); put(step, "period", m, d.monthValue(ym));
      press(step, "search", need(step, "search", f.search, null, null, "SEARCH"));
      const b = await waitFor(() => find(f[go]), 8000);
      if (!b) need(step, go, f[go], null, null, go === "r3b" ? "GSTR-3B: PREPARE ONLINE" : go === "r2b" ? "GSTR-2B: VIEW" : go === "r1Offline" ? "GSTR-1: PREPARE OFFLINE" : go === "iff" ? "IFF: PREPARE ONLINE" : "GSTR-1: PREPARE ONLINE");
      setTimeout(() => press(step, go, b), 50);
      return { ok: true, message: "Period " + d.monthValue(ym) + " chosen; opening the return." };
    },

    // GSTR-1 offline upload: FinCom's own JSON file put in the portal's file box
    upload: async ({ json, name }) => {
      const step = "Upload FinCom's GSTR-1 file", f = P.upload.fields, input = need(step, "file", f.file, null, null, "Choose file");
      const dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify(json)], name || "GSTR1.json", { type: "application/json" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, message: "FinCom's GSTR-1 file put in the portal's upload box." };
    },
    uploadStatus: async () => {
      const step = "Wait for the portal to process the file", el = await waitFor(() => find(P.upload.fields.status), 15000);
      if (!el) need(step, "status", P.upload.fields.status, null, null, "Upload history: status");
      const s = readText(el);
      return { ok: /^processed$/i.test(s), status: s, message: /^processed$/i.test(s) ? "The portal processed the file." : /error/i.test(s) ? "The portal processed the file WITH ERRORS: open its error report on the portal (GENERATE ERROR REPORT)." : "Still " + s + "; check again in a minute." };
    },

    // GSTR-1: one table typed record by record, each read back from the portal's list
    r1Fill: async ({ table, records }) => {
      const T = P.gstr1.tables[table], step = "Type table " + T.tile.text;
      press(step, "tile", need(step, "tile", T.tile, null, null, T.tile.text));
      const form = T.form;
      if (table === "nil") {
        await waitFor(() => find({ css: tpl(form.grid, { k: "INTRB2B", c: "nil_amt" }) }), 5000);
        const cols = ["nil_amt", "expt_amt", "ngsup_amt"];
        // every box of the grid is checked before anything is typed
        const boxes = {};
        ["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"].forEach((k) => cols.forEach((c) => { boxes[k + "." + c] = need(step, k + "." + c, { css: tpl(form.grid, { k, c }) }, null, null, "8 " + k + " " + c); }));
        const by = {}; records.forEach((r) => { by[r.sply_ty] = r; });
        Object.entries(boxes).forEach(([kc, el]) => { const [k, c] = kc.split("."); putMoney(step, kc, el, (by[k] || {})[c] || 0); });
        press(step, "save", need(step, "save", form.save, null, null, "SAVE"));
        await waitFor(() => find(T.tile), 5000);
        return { ok: true, done: records.length, message: "Table 8 typed and saved." };
      }
      await waitFor(() => find(form.add), 5000);
      const listN = () => document.querySelectorAll(form.list.css).length;
      // records already on the portal are never typed again (they would be there twice)
      if (listN() > 0) throw new Stop(step, "list", "Step “" + step + "”: the portal already has " + listN() + " record(s) in this table. The helper adds nothing to a table that is not empty, so nothing is entered twice; check them on the portal (or delete them there and run this step again).");
      let done = 0;
      for (const rec of records) {
        press(step, "add", need(step, "add", form.add, null, null, "ADD RECORD"));
        await waitFor(() => find(Object.values(form.fields)[0]), 5000);
        // the self-check: every field of this record found before any is typed
        const els = {};
        Object.entries(form.fields).forEach(([k, s]) => { if (rec[k] !== undefined && rec[k] !== "") els[k] = need(step, k, s, null, null, k); });
        const rows = [];
        if (form.rates) (rec.itms || []).forEach((it) => {
          const row = need(step, "rate " + it.rt + "%", { css: form.rates.row }, null, { rt: rk(it.rt) }, "rate " + it.rt + "% row");
          const cells = {}; Object.entries(form.rates.cols).forEach(([c, css]) => { if (+it[c]) cells[c] = need(step, "rate " + it.rt + "% " + c, { css }, row, null, "rate " + it.rt + "% · " + (R.COL[c] || c)); });
          rows.push([it, cells]);
        });
        Object.entries(els).forEach(([k, el]) => { const v = rec[k]; if (["val", "txval", "iamt", "camt", "samt", "csamt"].includes(k)) putMoney(step, k, el, v); else put(step, k, el, k === "rt" || k === "doc_num" ? String(+v) : v); });
        rows.forEach(([it, cells]) => Object.entries(cells).forEach(([c, el]) => putMoney(step, "rate " + it.rt + "% " + c, el, it[c])));
        press(step, "save", need(step, "save", form.save, null, null, "SAVE"));
        const back = await waitFor(() => find(form.add), 5000);
        if (!back) {
          const err = document.querySelector(".err, .error, .alert-danger");
          throw new Stop(step, "save", "Step “" + step + "”: the portal did not take record " + (done + 1) + " (" + (rec.inum || rec.nt_num || rec.hsn_sc || rec.from || rec.pos || "") + ")" + (err && err.textContent.trim() ? ": " + err.textContent.trim() : "") + ". The helper stopped.");
        }
        done++;
        if (listN() < done) throw new Stop(step, "list", "Step “" + step + "”: the portal's list shows " + listN() + " record(s) after " + done + " were saved. The helper stopped.");
      }
      press(step, "back", need(step, "back", form.back, null, null, "BACK"));
      await waitFor(() => find(P.gstr1.fields.generate), 5000);
      return { ok: true, done, message: done + " record(s) typed and saved." };
    },

    // GSTR-1: GENERATE SUMMARY, then the summary read back table by table
    r1Summary: async ({ tables }) => {
      const step = "Generate the summary and read it back", f = P.gstr1.fields;
      press(step, "generate", need(step, "generate", f.generate, null, null, "GENERATE SUMMARY"));
      const t = await waitFor(() => find(f.summaryTable), 15000);
      if (!t) need(step, "summaryTable", f.summaryTable, null, null, "the summary table");
      const portal = {};
      (tables || Object.keys(P.gstr1.tables)).forEach((k) => {
        const T = P.gstr1.tables[k], row = find(T.summary);
        if (!row) return;
        const td = row.querySelectorAll("td"), o = {};
        Object.entries(T.cols).forEach(([c, i]) => { if (td[i - 1]) { const s = td[i - 1].textContent.trim(); if (s !== "") o[c] = s; } });
        portal[k] = o;
      });
      return { ok: true, portal };
    },

    // GSTR-3B: one tile's boxes typed, read back, confirmed
    r3bFill: async ({ tile, boxes }) => {
      const g = P.gstr3b, T = g.tiles[tile], step = "Type " + T.text;
      press(step, "tile", need(step, "tile", T, null, null, T.text));
      await waitFor(() => find(g.confirm), 5000);
      const els = boxes.map((b) => [b, need(step, b.key, g.fields["box:" + b.key], null, null, b.label)]);
      els.forEach(([b, el]) => putMoney(step, b.key, el, b.value));
      const back = {}; els.forEach(([b, el]) => { back[b.key] = el.value; });
      press(step, "confirm", need(step, "confirm", g.confirm, null, null, "CONFIRM"));
      return { ok: true, done: boxes.length, back };
    },
    r3b32: async ({ rows }) => {
      const g = P.gstr3b, R32 = g.rows32, T = g.tiles.t32, step = "Type 3.2 Inter-State supplies";
      press(step, "tile", need(step, "tile", T, null, null, T.text));
      await waitFor(() => find(g.confirm), 5000);
      const back = {};
      for (const r of rows) {
        press(step, "add", need(step, "add " + r.kind, R32.add, null, { k: r.kind }, r.label + ": ADD"));
        const row = await waitFor(() => find({ css: R32.row }, null, { k: r.kind }), 3000) || need(step, "row " + r.kind, { css: R32.row }, null, { k: r.kind }, r.label + ": the new row");
        const pos = need(step, "pos", { css: R32.pos }, row, null, "Place of supply"), tx = need(step, "txval", { css: R32.txval }, row, null, "Total taxable value"), ia = need(step, "iamt", { css: R32.iamt }, row, null, "Integrated tax");
        put(step, "pos", pos, r.pos); putMoney(step, "txval", tx, r.txval); putMoney(step, "iamt", ia, r.iamt);
        back["3.2." + r.kind + "." + r.pos + ".txval"] = tx.value; back["3.2." + r.kind + "." + r.pos + ".iamt"] = ia.value;
      }
      press(step, "confirm", need(step, "confirm", g.confirm, null, null, "CONFIRM"));
      return { ok: true, done: rows.length, back };
    },
    // what the portal works out (4(C), 5.1) and what FinCom does not fill (3.1.1): read, never typed
    r3bRead: async () => {
      const g = P.gstr3b, step = "Read the portal's own figures", got = {};
      Object.entries(Object.assign({}, g.computed, g.read311)).forEach(([k, s]) => { got[k] = readText(need(step, k, s, null, null, k)); });
      return { ok: true, got };
    },
    r3bSave: async () => {
      const step = "Save GSTR-3B";
      press(step, "save", need(step, "save", P.gstr3b.fields.save, null, null, "SAVE GSTR-3B"));
      return { ok: true, message: "Saved on the portal (a draft; nothing is filed)." };
    },
    r3bPayment: async ({ keys }) => {
      const g = P.gstr3b, step = "Proceed to payment and read the set-off";
      press(step, "proceed", need(step, "proceed", g.fields.proceed, null, null, "PROCEED TO PAYMENT"));
      const t = await waitFor(() => find(g.payment), 15000);
      if (!t) need(step, "payment", g.payment, null, null, "the Payment of tax table");
      const got = {}; keys.forEach((k) => { got[k] = readText(need(step, k, g.paid(k), null, null, k)); });
      return { ok: true, got };
    },

    // 2B: the portal's own JSON fetched in this tab (the person's session) and handed to FinCom's 2B import
    r2bDownload: async () => {
      const step = "Download GSTR-2B (JSON)", a = need(step, "download", P.gstr2b.fields.download, null, null, "DOWNLOAD GSTR-2B DETAILS (JSON)");
      const href = a.getAttribute("href") || "";
      if (!href || /^(javascript:|#)/.test(href)) { return { ok: false, message: "The portal makes the 2B file in the page here; download it with the portal's button and drop it into FinCom's 2B import." }; }
      const r = await fetch(new URL(href, location.href).href, { credentials: "include" });
      if (!r.ok) throw new Stop(step, "download", "Step “" + step + "”: the portal answered " + r.status + " for the 2B file.");
      const json = await r.json();
      return { ok: true, json };
    },
    ledger: async ({ which }) => {
      const pg = P[which], step = which === "cashLedger" ? "Read the cash ledger" : "Read the credit ledger", got = {};
      Object.entries(pg.fields).forEach(([k, s]) => { got[k] = readText(need(step, k, s, null, null, k.toUpperCase())); });
      return { ok: true, got };
    },
    status: async ({ form, period }) => {
      const pg = P.status, step = "Read the return's status and ARN";
      await waitFor(() => find(pg.fields.rows), 8000);
      const rows = Array.from(document.querySelectorAll(pg.fields.rows.css)), cols = pg.cols;
      const cell = (tr, i) => ((tr.querySelectorAll("td")[i - 1] || {}).textContent || "").trim();
      const hit = rows.find((tr) => norm(cell(tr, cols.form)) === norm(form) && norm(cell(tr, cols.period)) === norm(period));
      if (!hit) return { ok: false, message: "No " + form + " for " + period + " in the portal's return status yet." };
      const arn = R.arnIn(cell(hit, cols.arn));
      return { ok: !!arn, arn, status: cell(hit, cols.status), filed: cell(hit, cols.filed), message: arn ? "ARN " + arn : "The status row has no ARN yet." };
    },
  };
  function pageOf() { return Object.keys(P).find((k) => P[k].match && new RegExp(P[k].match).test(location.href)) || ""; }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || !msg.cmd || !C[msg.cmd] || sender.id !== chrome.runtime.id) return false;
    C[msg.cmd](msg).then((r) => reply(r), (e) => reply(e instanceof Stop ? { ok: false, stop: true, step: e.step, field: e.field, message: e.message } : { ok: false, message: "The helper met an error: " + ((e && e.message) || e) }));
    return true;
  });

  // after the person files: the ARN the portal shows is read and sent to FinCom (only read, never made up)
  const pg = pageOf();
  if (pg === "gstr1" || pg === "gstr3b") {
    let sent = "";
    const look = () => { const el = find(P[pg].arn), arn = el ? R.arnIn(el.textContent) : ""; if (arn && arn !== sent) { sent = arn; chrome.runtime.sendMessage({ type: "arn", arn, page: pg, url: location.href }); } };
    new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    look();
  }
})();
