/* A plain look-alike of the GST portal's return pages, for the browser helper's tests only (never shipped).
 * Written from the portal's public user manuals and screenshots, separately from extension/gst-helper/selectors.js:
 * the page keeps what is typed only through input / change events (as the portal's own framework does), works out its
 * own summary, 4(C), and set-off, and files only after an OTP typed by the person.
 * localStorage "fake:drop" (selectors, comma-separated) removes elements after each draw, to test a missing field. */
(function () {
  "use strict";
  const LS = window.localStorage;
  const get = (k, d) => { try { const v = JSON.parse(LS.getItem("fake:" + k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
  const set = (k, v) => LS.setItem("fake:" + k, JSON.stringify(v));
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const num = (v) => { const s = String(v === undefined || v === null ? "" : v).replace(/,/g, "").trim(); return s === "" ? 0 : Math.round(parseFloat(s) * 100) / 100; };
  const paise = (v) => Math.round(num(v) * 100);
  const fmt = (p) => { const neg = p < 0, s = (Math.abs(p) / 100).toFixed(2), [i, d] = s.split("."); const l3 = i.slice(-3), rest = i.slice(0, -3);
    return (neg ? "-" : "") + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + l3 + "." + d; };
  const RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];
  const rk = (r) => String(r).replace(".", "_");
  const STATES = [["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"],
    ["10", "Bihar"], ["19", "West Bengal"], ["23", "Madhya Pradesh"], ["24", "Gujarat"], ["27", "Maharashtra"], ["29", "Karnataka"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["96", "Other Country"], ["97", "Other Territory"]];
  const page = document.body.dataset.page;
  const period = () => get("period", "") || new URLSearchParams(location.search).get("period") || "";
  const drop = () => (LS.getItem("fake:drop") || "").split(",").filter(Boolean).forEach((s) => $$(s).forEach((e) => e.remove()));
  // what is typed reaches the page only through its events
  function bind(root, model) {
    $$("input, select", root).forEach((el) => {
      const k = el.dataset.k || el.id || el.name, up = () => { model[k] = el.type === "checkbox" ? el.checked : el.value; };
      el.addEventListener("input", up); el.addEventListener("change", up);
    });
  }
  function head(title) {
    document.title = title + " | GST Portal (look-alike)";
    document.body.insertAdjacentHTML("afterbegin", '<header><b>Goods and Services Tax (test look-alike)</b><span>' + esc(get("user", "")) + "</span></header>");
  }
  const posOpts = '<option value="">Select</option>' + STATES.map(([c, n]) => '<option value="' + c + '">' + c + "-" + esc(n) + "</option>").join("");
  const sel = (id, opts, k) => '<select id="' + id + '"' + (k ? ' data-k="' + k + '"' : "") + '><option value="">Select</option>' + opts.map((o) => '<option value="' + esc(o) + '">' + esc(o) + "</option>").join("") + "</select>";
  const MONTHS = ["042025", "052025", "062025", "072025", "082025", "092025", "102025", "112025", "122025", "012026", "022026", "032026"];

  /* ---------- login ---------- */
  if (page === "login") {
    head("Login");
    const m = {};
    document.body.insertAdjacentHTML("beforeend", '<main><h3>Login</h3><div class="form">' +
      '<label>Username<br><input id="username" autocomplete="off"></label><br>' +
      '<label>Password<br><input id="user_pass" type="password"></label><br>' +
      '<label>Type the characters you see in the image below<br><input id="captcha"></label><div id="captcha-img" style="font:bold 20px monospace;letter-spacing:4px">ABC123</div>' +
      '<button type="submit" id="login">LOGIN</button><p class="err" id="lerr"></p></div></main>');
    bind(document, m);
    $("#login").onclick = () => {
      if (!m.username || !m.user_pass) { $("#lerr").textContent = "Enter username and password."; return; }
      if (m.captcha !== "ABC123") { $("#lerr").textContent = "Enter valid Letters shown."; return; }
      set("user", m.username); set("loggedIn", { username: m.username, passLen: String(m.user_pass).length });   // never the password itself
      location.href = "https://return.gst.gov.in/returns/auth/dashboard";
    };
    drop(); return;
  }

  /* ---------- returns dashboard ---------- */
  if (page === "dashboard") {
    head("Returns dashboard");
    const m = {};
    document.body.insertAdjacentHTML("beforeend", '<main><h3>File Returns</h3><div class="form">' +
      '<label>Financial Year * ' + sel("fin", ["2025-26", "2024-25"]).replace('id="fin"', 'id="fin" name="fin"') + "</label>" +
      '<label>Quarter * ' + sel("quarter", ["Q1", "Q2", "Q3", "Q4"]).replace('id="quarter"', 'id="quarter" name="quarter"') + "</label>" +
      '<label>Period * <select id="mon" name="mon"><option value="">Select</option>' + MONTHS.map((x) => '<option value="' + x + '">' + x + "</option>").join("") + "</select></label>" +
      '<button id="search">SEARCH</button><p class="err" id="derr"></p></div><div id="rets"></div></main>');
    bind(document, m);
    $("#search").onclick = () => {
      if (!m.fin || !m.quarter || !m.mon) { $("#derr").textContent = "Select financial year, quarter and period."; return; }
      set("period", m.mon);
      const t = (name, title, btns) => '<div class="ret-tile"><b>' + title + "</b> <small>" + name + "</small><br>" + btns + "</div>";
      $("#rets").innerHTML = t("GSTR1", "Details of outward supplies of goods or services", '<button data-go="r1">PREPARE ONLINE</button><button data-go="r1off">PREPARE OFFLINE</button>') +
        (get("qrmp", false) ? t("IFF", "Invoice Furnishing Facility", '<button data-go="iff">PREPARE ONLINE</button>') : "") +
        t("GSTR3B", "Monthly return", '<button data-go="r3b">PREPARE ONLINE</button>') + t("GSTR2B", "Auto-drafted ITC statement", '<button data-go="r2b">VIEW</button>');
      $$("#rets [data-go]").forEach((b) => { b.onclick = () => { const g = b.dataset.go;
        location.href = g === "r1" ? "/returns/auth/gstr1" : g === "iff" ? "/returns/auth/iff" : g === "r1off" ? "/returns/auth/gstr/offlineupload" : g === "r3b" ? "/returns2/auth/gstr3b" : "https://gstr2b.gst.gov.in/gstr2b/auth/?period=" + m.mon; }; });
      drop();
    };
    drop(); return;
  }

  /* ---------- GSTR-1 / IFF ---------- */
  // the fake's own list of tables: [key, tile words, summary words, fields [id, kind, record key], rate grid?]
  const PARTY = [["ctin", "text"], ["inum", "text"], ["idt", "text"], ["val", "text"], ["pos", "pos"], ["rchrg", "check"], ["inv_typ", "sel:R,SEWP,SEWOP,DE"]];
  const NOTE = [["ctin", "text"], ["ntty", "sel:C,D"], ["nt_num", "text"], ["nt_dt", "text"], ["val", "text"], ["pos", "pos"], ["rchrg", "check"], ["inv_typ", "sel:R,SEWP,SEWOP,DE"]];
  const ORIG = [["oinum", "text"], ["oidt", "text"]], EXPF = [["exp_typ", "sel:WPAY,WOPAY"], ["inum", "text"], ["idt", "text"], ["val", "text"], ["sbpcode", "text", 1], ["sbnum", "text", 1], ["sbdt", "text", 1]];
  const UR = [["ur_typ", "sel:B2CL,EXPWP,EXPWOP", 0, "typ"], ["ntty", "sel:C,D"], ["nt_num", "text"], ["nt_dt", "text"], ["val", "text"], ["pos", "pos", 1]];
  const OMON = [["omon", "sel:" + MONTHS.join(",")]];
  const T1 = [
    ["b2b", "4A, 4B, 6B, 6C - B2B, SEZ, DE Invoices", "B2B, SEZ, DE Invoices", PARTY, 1, "inv"],
    ["b2ba", "9A - Amended B2B Invoices", "Amended B2B Invoices", ORIG.concat(PARTY), 1, "inv"],
    ["b2cl", "5 - B2C (Large) Invoices", "B2C (Large) Invoices", [["pos", "pos"], ["inum", "text"], ["idt", "text"], ["val", "text"]], 1, "inv"],
    ["b2cla", "9A - Amended B2C (Large) Invoices", "Amended B2C (Large) Invoices", ORIG.concat([["pos", "pos"], ["inum", "text"], ["idt", "text"], ["val", "text"]]), 1, "inv"],
    ["exp", "6A - Exports Invoices", "Exports Invoices", EXPF, 1, "inv"],
    ["expa", "9A - Amended Exports Invoices", "Amended Exports Invoices", ORIG.concat(EXPF), 1, "inv"],
    ["b2cs", "7 - B2C (Others)", "B2C (Others)", [["pos", "pos"], ["typ", "sel:OE,E"]], 1, "row"],
    ["b2csa", "10 - Amended B2C (Others)", "Amended B2C (Others)", OMON.concat([["pos", "pos"], ["typ", "sel:OE,E"]]), 1, "row"],
    ["nil", "8A, 8B, 8C, 8D - Nil Rated Supplies", "Nil Rated, Exempted and Non GST", null, 0, "nil"],
    ["cdnr", "9B - Credit / Debit Notes (Registered)", "Credit/Debit Notes (Registered)", NOTE, 1, "nt"],
    ["cdnra", "9C - Amended Credit / Debit Notes (Registered)", "Amended Credit/Debit Notes (Registered)", [["ont_num", "text"], ["ont_dt", "text"]].concat(NOTE), 1, "nt"],
    ["cdnur", "9B - Credit / Debit Notes (Unregistered)", "Credit/Debit Notes (Unregistered)", UR, 1, "nt"],
    ["cdnura", "9C - Amended Credit / Debit Notes (Unregistered)", "Amended Credit/Debit Notes (Unregistered)", [["ont_num", "text"], ["ont_dt", "text"]].concat(UR), 1, "nt"],
    ["at", "11A(1), 11A(2) - Tax Liability (Advances Received)", "Tax Liability (Advances Received)", [["pos", "pos"]], 1, "row"],
    ["ata", "11A - Amended Tax Liability (Advance Received)", "Amended Tax Liability (Advance Received)", OMON.concat([["pos", "pos"]]), 1, "row"],
    ["txpd", "11B(1), 11B(2) - Adjustment of Advances", "Adjustment of Advances", [["pos", "pos"]], 1, "row"],
    ["txpda", "11B - Amended Adjustment of Advances", "Amended Adjustment of Advances", OMON.concat([["pos", "pos"]]), 1, "row"],
    ["hsn", "12 - HSN-wise summary of outward supplies", "HSN-wise summary of outward supplies", [["hsn_tab", "sel:b2b,b2c", 0, "tab"], ["hsn_sc", "text"], ["desc", "text", 1], ["uqc", "sel:NA,NOS,KGS,PCS,OTH,MTR,LTR"], ["qty", "text", 1], ["rt", "sel:" + RATES.join(",")], ["txval", "text"], ["iamt", "text", 1], ["camt", "text", 1], ["samt", "text", 1], ["csamt", "text", 1]], 0, "hsn"],
    ["doc_issue", "13 - Documents Issued", "Documents Issued", [["doc_num", "sel:1,2,3,4,5,6,7,8,9,10,11,12"], ["from", "text"], ["to", "text"], ["totnum", "text"], ["cancel", "text", 1]], 0, "doc"],
  ];
  const IFF_TABLES = ["b2b", "b2ba", "cdnr", "cdnra"];
  const R1KEY = () => "r1:" + period();
  const r1 = () => get(R1KEY(), {});
  const r1save = (v) => set(R1KEY(), v);
  const NIL_ROWS = [["INTRB2B", "Inter-State supplies to registered persons"], ["INTRAB2B", "Intra-State supplies to registered persons"], ["INTRB2C", "Inter-State supplies to unregistered persons"], ["INTRAB2C", "Intra-State supplies to unregistered persons"]];
  const NIL_COLS = [["nil_amt", "Nil rated"], ["expt_amt", "Exempted"], ["ngsup_amt", "Non-GST"]];

  // a record kept by the page, from the form's model or from an uploaded JSON
  function fromModel(def, m) {
    const rec = {};
    (def[3] || []).forEach(([id, kind, opt, key]) => { const v = m[id]; rec[key || id] = kind === "check" ? (v ? "Y" : "N") : (v === undefined ? "" : String(v)); });
    if (def[4]) rec.itms = RATES.map((r) => ({ rt: r, txval: m[rk(r) + "|txval"], iamt: m[rk(r) + "|iamt"], camt: m[rk(r) + "|camt"], samt: m[rk(r) + "|samt"], csamt: m[rk(r) + "|csamt"] }))
      .filter((it) => ["txval", "iamt", "camt", "samt", "csamt"].some((c) => it[c] !== undefined && String(it[c]).trim() !== ""))
      .map((it) => ({ rt: it.rt, txval: num(it.txval), iamt: num(it.iamt), camt: num(it.camt), samt: num(it.samt), csamt: num(it.csamt) }));
    return rec;
  }
  function problems(def, rec) {
    const out = [];
    (def[3] || []).forEach(([id, kind, opt, key]) => { const v = rec[key || id]; if (!opt && kind !== "check" && (v === undefined || String(v).trim() === "")) out.push(id + " is required"); });
    ["idt", "nt_dt", "oidt", "ont_dt", "sbdt"].forEach((k) => { if (rec[k] && !/^\d{2}-\d{2}-\d{4}$/.test(rec[k])) out.push(k + " must be DD-MM-YYYY"); });
    if (rec.ctin && !/^\d{2}[A-Z0-9]{13}$/.test(rec.ctin)) out.push("GSTIN is not valid");
    if (def[4] && !(rec.itms || []).length) out.push("Enter the taxable value for at least one rate");
    return out;
  }
  // the portal's summary, worked out by the page itself
  function summary() {
    const st = r1(), rows = [];
    T1.forEach((def) => {
      const [k, , label, , , shape] = def, list = st[k];
      if (shape === "nil") { const g = st.nil || {}; let n = 0, a = 0, b = 0, c = 0; NIL_ROWS.forEach(([r]) => { const x = g[r] || {}; const p = [paise(x.nil_amt), paise(x.expt_amt), paise(x.ngsup_amt)]; if (p.some(Boolean)) n++; a += p[0]; b += p[1]; c += p[2]; });
        rows.push([label, n, fmt(a), fmt(b), fmt(c)]); return; }
      const L = list || [];
      if (shape === "doc") { let tot = 0, can = 0; L.forEach((d) => { tot += +d.totnum || 0; can += +d.cancel || 0; }); rows.push([label, L.length, tot, can, tot - can]); return; }
      const s = { val: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      L.forEach((r) => { const sg = shape === "nt" && String(r.ntty).toUpperCase() === "C" ? -1 : 1;
        if (shape === "hsn") ["txval", "iamt", "camt", "samt", "csamt"].forEach((c) => { s[c] += paise(r[c]); });
        else (r.itms || []).forEach((it) => ["txval", "iamt", "camt", "samt", "csamt"].forEach((c) => { s[c] += sg * paise(it[c]); }));
        if (r.val !== undefined) s.val += sg * paise(r.val); });
      rows.push([label, L.length, shape === "row" || shape === "hsn" ? "" : fmt(s.val), fmt(s.txval), fmt(s.iamt), fmt(s.camt), fmt(s.samt), fmt(s.csamt)]);
    });
    return rows;
  }
  // an uploaded JSON, read into the same records (the portal's offline upload)
  function fromJson(j) {
    const out = {}, items = (itms) => (itms || []).map((it) => { const d = it.itm_det || it; return { rt: +d.rt, txval: num(d.txval !== undefined ? d.txval : d.ad_amt), iamt: num(d.iamt), camt: num(d.camt), samt: num(d.samt), csamt: num(d.csamt) }; });
    T1.forEach(([k, , , , , shape]) => {
      const p = j[k]; if (!p) return;
      if (shape === "inv") out[k] = [].concat(...p.map((g) => (g.inv || []).map((i) => Object.assign({}, i, { ctin: g.ctin, pos: i.pos || g.pos, exp_typ: g.exp_typ, val: String(i.val), itms: items(i.itms) }))));
      else if (shape === "nt") out[k] = Array.isArray(p) && p[0] && p[0].nt ? [].concat(...p.map((g) => g.nt.map((i) => Object.assign({}, i, { ctin: g.ctin, val: String(i.val), itms: items(i.itms) })))) : p.map((i) => Object.assign({}, i, { val: String(i.val), itms: items(i.itms) }));
      else if (shape === "row") out[k] = p.map((r) => Object.assign({}, r, { itms: r.itms ? items(r.itms) : items([r]) }));
      else if (shape === "nil") { out.nil = {}; (p.inv || []).forEach((r) => { out.nil[r.sply_ty] = { nil_amt: String(r.nil_amt), expt_amt: String(r.expt_amt), ngsup_amt: String(r.ngsup_amt) }; }); }
      else if (shape === "hsn") out.hsn = [].concat((p.data || []), (p.hsn_b2b || []).map((r) => Object.assign({ tab: "b2b" }, r)), (p.hsn_b2c || []).map((r) => Object.assign({ tab: "b2c" }, r)));
      else if (shape === "doc") out.doc_issue = [].concat(...(p.doc_det || []).map((d) => (d.docs || []).map((x) => Object.assign({ doc_num: d.doc_num }, x))));
    });
    return out;
  }
  function filed(form) { return get("filed", []).find((f) => f.form === form && f.period === period()); }
  function fileFlow(form, arnTail) {
    const box = $("#filebox");
    box.innerHTML = '<div class="modal open" id="filemodal"><h4>File ' + form + '</h4><label><input type="checkbox" id="decl"> I hereby declare that the information given is true</label><br>' +
      '<button id="fevc">FILE WITH EVC</button><button id="fdsc">FILE WITH DSC</button><div id="otpbox"></div></div>';
    $("#fevc").onclick = () => { $("#otpbox").innerHTML = '<label>Enter OTP <input id="otp"></label><button id="verify">VERIFY</button><p class="err" id="oerr"></p>';
      $("#verify").onclick = () => { if (!$("#decl").checked || $("#otp").value !== "123456") { $("#oerr").textContent = "Invalid OTP or declaration not ticked."; return; }
        const arn = "AA" + (get("gstin", "07AABCF1234K1Z5")).slice(0, 2) + period().slice(0, 2) + period().slice(4, 6) + arnTail;
        const list = get("filed", []); list.push({ form, period: period(), fy: "2025-26", date: "11-12-2025", status: "Filed", arn }); set("filed", list);
        box.innerHTML = '<div class="alert-success" id="arn-msg">' + form + " has been successfully filed. ARN: " + arn + "</div>"; }; };
    $("#fdsc").onclick = () => { $("#otpbox").innerHTML = '<p class="err">No DSC found (look-alike).</p>'; };
  }

  if (page === "gstr1" || page === "iff") {
    const iff = page === "iff";
    head(iff ? "IFF" : "GSTR-1");
    const shown = T1.filter((d) => !iff || IFF_TABLES.includes(d[0]));
    const p = period();
    document.body.insertAdjacentHTML("beforeend", "<main><h3>" + (iff ? "IFF - Invoice Furnishing Facility" : "GSTR-1 - Details of outward supplies of goods or services") + '</h3><p>Tax period: <b id="ret-period">' + p.slice(0, 2) + "-" + p.slice(2) + '</b></p><div id="view"></div><div id="filebox"></div></main>');
    const home = () => {
      const st = r1();
      $("#view").innerHTML = '<div class="tiles">' + shown.map((d) => '<div class="tile" data-t="' + d[0] + '">' + esc(d[1]) + "<br><small>" + (d[5] === "nil" ? (st.nil ? "4 rows" : "0") : (st[d[0]] || []).length) + " record(s)</small></div>").join("") + "</div>" +
        '<button id="gen">GENERATE SUMMARY</button> <button id="file1">' + "FILE STATEMENT" + '</button><div id="sumbox"></div>';
      $$("#view .tile").forEach((t) => { t.onclick = () => table(T1.find((d) => d[0] === t.dataset.t)); });
      $("#gen").onclick = () => {
        const rows = summary().filter((r) => shown.some((d) => d[2] === r[0]));
        $("#sumbox").innerHTML = '<table id="summary"><thead><tr><th>Description</th><th class="n">No. of records</th><th class="n">Value</th><th class="n">Taxable value</th><th class="n">Integrated tax</th><th class="n">Central tax</th><th class="n">State/UT tax</th><th class="n">Cess</th></tr></thead><tbody>' +
          rows.map((r) => "<tr>" + r.map((c, i) => "<td" + (i ? ' class="n"' : "") + ">" + esc(c) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
        set("summaryAt:" + p, Date.now()); drop();
      };
      $("#file1").onclick = () => { if (!get("summaryAt:" + p, 0)) { alert("Generate summary first."); return; } fileFlow(iff ? "IFF" : "GSTR1", "0000001"); };
      if (filed(iff ? "IFF" : "GSTR1")) $("#filebox").innerHTML = '<div class="alert-success" id="arn-msg">Filed. ARN: ' + filed(iff ? "IFF" : "GSTR1").arn + "</div>";
      drop();
    };
    const table = (def) => {
      const [k, title, , fields, rates, shape] = def, st = r1();
      if (shape === "nil") {
        const m = {}, g = st.nil || {};
        $("#view").innerHTML = "<h4>" + esc(title) + '</h4><table><tr><th>Description</th>' + NIL_COLS.map((c) => "<th>" + c[1] + "</th>").join("") + "</tr>" +
          NIL_ROWS.map(([r, l]) => "<tr><td>" + l + "</td>" + NIL_COLS.map(([c]) => '<td><input id="nil_' + r + "_" + c + '" value="' + esc((g[r] || {})[c] || "") + '"></td>').join("") + "</tr>").join("") +
          '</table><button id="save">SAVE</button><button id="back">BACK</button>';
        NIL_ROWS.forEach(([r]) => NIL_COLS.forEach(([c]) => { m["nil_" + r + "_" + c] = (g[r] || {})[c] || ""; }));
        bind($("#view"), m);
        $("#save").onclick = () => { const s = r1(); s.nil = {}; NIL_ROWS.forEach(([r]) => { s.nil[r] = {}; NIL_COLS.forEach(([c]) => { s.nil[r][c] = m["nil_" + r + "_" + c] || ""; }); }); r1save(s); home(); };
        $("#back").onclick = home; drop(); return;
      }
      const list = st[k] || [];
      $("#view").innerHTML = "<h4>" + esc(title) + '</h4><table class="records"><thead><tr><th>#</th><th>Details</th><th class="n">Taxable value</th></tr></thead><tbody>' +
        list.map((r, i) => "<tr><td>" + (i + 1) + "</td><td>" + esc(r.inum || r.nt_num || r.hsn_sc || r.from || r.pos || "") + '</td><td class="n">' + fmt((r.itms || [r]).reduce((a, it) => a + paise(it.txval), 0)) + "</td></tr>").join("") +
        '</tbody></table><button id="add">ADD RECORD</button><button id="back">BACK</button>';
      $("#back").onclick = home;
      $("#add").onclick = () => {
        const m = {};
        $("#view").innerHTML = "<h4>" + esc(title) + ' - Add details</h4><div class="form">' + fields.map(([id, kind]) => "<label>" + id + "<br>" +
          (kind === "pos" ? '<select id="' + id + '">' + posOpts + "</select>" : kind === "check" ? '<input type="checkbox" id="' + id + '">' : kind.startsWith("sel:") ? sel(id, kind.slice(4).split(",")) : '<input id="' + id + '">') + "</label>").join("") +
          (rates ? '<table><tr><th>Rate (%)</th><th>' + (k.startsWith("at") || k.startsWith("txpd") ? "Gross advance" : "Taxable value") + "</th><th>Integrated tax</th><th>Central tax</th><th>State/UT tax</th><th>Cess</th></tr>" +
            RATES.map((r) => '<tr data-rate="' + rk(r) + '"><td>' + r + "</td>" + ["txval", "iamt", "camt", "samt", "csamt"].map((c) => '<td><input name="' + c + '" data-k="' + rk(r) + "|" + c + '"></td>').join("") + "</tr>").join("") + "</table>" : "") +
          '<p class="err" id="ferr"></p><button id="save">SAVE</button><button id="back">BACK</button></div>';
        bind($("#view"), m);
        $("#back").onclick = () => table(def);
        $("#save").onclick = () => { const rec = fromModel(def, m), pr = problems(def, rec); if (pr.length) { $("#ferr").textContent = pr.join("; "); return; }
          const s = r1(); (s[k] = s[k] || []).push(rec); r1save(s); set("summaryAt:" + p, 0); table(def); };
        drop();
      };
      drop();
    };
    home(); return;
  }

  /* ---------- offline upload ---------- */
  if (page === "upload") {
    head("Offline upload");
    const p = period();
    document.body.insertAdjacentHTML("beforeend", '<main><h3>Upload JSON file (GSTR-1)</h3><p>Tax period ' + p + '</p><input type="file" accept=".json,.zip" id="up"><table id="upload-history"><thead><tr><th>Date</th><th>Reference</th><th>Status</th></tr></thead><tbody>' +
      get("uploads:" + p, []).map((u) => "<tr><td>" + u.at + "</td><td>" + u.ref + '</td><td class="status">' + u.status + "</td></tr>").join("") + "</tbody></table></main>");
    $("#up").addEventListener("change", (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      f.text().then((txt) => {
        let status = "Processed", j = null;
        try { j = JSON.parse(txt); } catch (e) { status = "Processed with Error"; }
        if (j && (j.fp !== p || !/^\d{2}[A-Z0-9]{13}$/.test(j.gstin || ""))) status = "Processed with Error";
        if (j && status === "Processed") { const s = r1(), n = fromJson(j); Object.assign(s, n); r1save(s); set("summaryAt:" + p, 0); }
        const list = get("uploads:" + p, []); list.unshift({ at: "now", ref: "UP" + (list.length + 1), status }); set("uploads:" + p, list);
        $("#upload-history tbody").insertAdjacentHTML("afterbegin", "<tr><td>now</td><td>UP" + list.length + '</td><td class="status">' + status + "</td></tr>");
      });
    });
    drop(); return;
  }

  /* ---------- GSTR-3B ---------- */
  if (page === "gstr3b") {
    head("GSTR-3B");
    const p = period(), K = "3b:" + p, saved = get(K, {}), m = Object.assign({}, saved.m || {}), r32 = JSON.parse(JSON.stringify(saved.r32 || { unreg_details: [], comp_details: [], uin_details: [] }));
    const inp = (id) => '<input id="' + id + '" value="' + esc(m[id] === undefined ? "0.00" : m[id]) + '">';
    const ro = (id) => '<input id="' + id + '" readonly value="0.00">';
    const grid = (rows, cols) => "<table><tr><th>Nature of supplies</th>" + cols.map((c) => "<th>" + c[1] + "</th>").join("") + "</tr>" + rows.map(([id, l, have]) => "<tr><td>" + l + "</td>" + cols.map(([c]) => "<td>" + (have.includes(c) ? inp(id + "_" + c) : "") + "</td>").join("") + "</tr>").join("") + "</table>";
    const C5 = [["txval", "Total taxable value"], ["iamt", "Integrated tax"], ["camt", "Central tax"], ["samt", "State/UT tax"], ["csamt", "Cess"]], A = ["txval", "iamt", "camt", "samt", "csamt"], H4 = ["iamt", "camt", "samt", "csamt"];
    const modal = (id, title, body) => '<div class="modal" id="' + id + '"><h4>' + title + "</h4>" + body + '<button class="confirm">CONFIRM</button><button class="cancel">CANCEL</button></div>';
    const t31 = grid([["osup_det", "(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", A], ["osup_zero", "(b) Outward taxable supplies (zero rated)", ["txval", "iamt", "csamt"]],
      ["osup_nil_exmp", "(c) Other outward supplies (Nil rated, exempted)", ["txval"]], ["isup_rev", "(d) Inward supplies (liable to reverse charge)", A], ["osup_nongst", "(e) Non-GST outward supplies", ["txval"]]], C5);
    const t311 = "<table><tr><td>(i) Taxable supplies on which electronic commerce operator pays tax u/s 9(5)</td><td>" + inp("eco_9_5_txval") + inp("eco_9_5_iamt") + "</td></tr><tr><td>(ii) Taxable supplies made by the registered person through electronic commerce operator</td><td>" + inp("eco_reg_txval") + "</td></tr></table>";
    const t32 = [["unreg_details", "Supplies made to Unregistered Persons"], ["comp_details", "Supplies made to Composition Taxable Persons"], ["uin_details", "Supplies made to UIN holders"]]
      .map(([k, l]) => '<section class="r32" data-kind="' + k + '"><b>' + l + '</b><table><thead><tr><th>Place of Supply (State/UT)</th><th>Total taxable value</th><th>Integrated tax</th></tr></thead><tbody></tbody></table><button class="add32">ADD</button></section>').join("");
    const t4 = grid([["itc_avl_IMPG", "(A)(1) Import of goods", ["iamt", "csamt"]], ["itc_avl_IMPS", "(A)(2) Import of services", ["iamt", "csamt"]], ["itc_avl_ISRC", "(A)(3) Inward supplies liable to reverse charge (other than 1 & 2 above)", H4],
      ["itc_avl_ISD", "(A)(4) Inward supplies from ISD", H4], ["itc_avl_OTH", "(A)(5) All other ITC", H4], ["itc_rev_RUL", "(B)(1) As per rules 38, 42 & 43 of CGST Rules and section 17(5)", H4], ["itc_rev_OTH", "(B)(2) Others", H4]], C5.slice(1)) +
      "<table><tr><td>(C) Net ITC available (A) - (B)</td>" + H4.map((c) => "<td>" + ro("itc_net_" + c) + "</td>").join("") + "</tr></table>" +
      grid([["itc_inelg_RUL", "(D)(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period", H4], ["itc_inelg_OTH", "(D)(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules", H4]], C5.slice(1));
    const t5 = "<table><tr><th>Nature of supplies</th><th>Inter-State supplies</th><th>Intra-State supplies</th></tr><tr><td>From a supplier under composition scheme, Exempt and Nil rated supply</td><td>" + inp("isup_GST_inter") + "</td><td>" + inp("isup_GST_intra") + "</td></tr><tr><td>Non GST supply</td><td>" + inp("isup_NONGST_inter") + "</td><td>" + inp("isup_NONGST_intra") + "</td></tr></table>";
    const t51 = "<table><tr><th></th><th>Integrated tax</th><th>Central tax</th><th>State/UT tax</th><th>Cess</th></tr><tr><td>Interest (system computed)</td>" + H4.map((c) => "<td>" + ro("intr_" + c) + "</td>").join("") + "</tr><tr><td>Late fee</td><td></td><td>" + ro("latefee_camt") + "</td><td>" + ro("latefee_samt") + "</td><td></td></tr></table>";
    const TILES = [["t31", "3.1 Tax on outward and reverse charge inward supplies", t31], ["t311", "3.1.1 Supplies notified under section 9(5) of the CGST Act, 2017", t311], ["t32", "3.2 Inter-State supplies", t32],
      ["t4", "4. Eligible ITC", t4], ["t5", "5. Exempt, nil and Non GST inward supplies", t5], ["t51", "5.1 Interest and Late fee for previous tax period", t51]];
    document.body.insertAdjacentHTML("beforeend", '<main><h3>GSTR-3B - Monthly return</h3><p>Tax period: <b id="ret-period">' + p.slice(0, 2) + "-" + p.slice(2) + '</b></p><div class="tiles">' +
      TILES.map(([id, t]) => '<div class="tile" data-m="' + id + '">' + t + "</div>").join("") + "</div>" + TILES.map(([id, t, b]) => modal("m_" + id, t, b)).join("") +
      '<button id="save3b">SAVE GSTR-3B</button> <button id="proceed">PROCEED TO PAYMENT</button><p id="msg3b"></p><div id="paybox"></div><div id="filebox"></div></main>');
    const fee = get("latefee", { camt: 0, samt: 0 });
    const net = () => H4.forEach((c) => { const a = ["IMPG", "IMPS", "ISRC", "ISD", "OTH"].reduce((s, t) => s + paise(m["itc_avl_" + t + "_" + c]), 0), b = ["RUL", "OTH"].reduce((s, t) => s + paise(m["itc_rev_" + t + "_" + c]), 0); $("#itc_net_" + c).value = fmt(a - b).replace(/,/g, ""); });
    $("#latefee_camt").value = Number(fee.camt).toFixed(2); $("#latefee_samt").value = Number(fee.samt).toFixed(2);
    $$("input:not([readonly])").forEach((el) => { m[el.id] = m[el.id] === undefined ? el.value : m[el.id]; });
    bind(document.querySelector("main"), m);
    $$("input:not([readonly])").forEach((el) => el.addEventListener("input", net));
    net();
    const draw32 = () => $$("section.r32").forEach((s) => { const k = s.dataset.kind;
      $("tbody", s).innerHTML = r32[k].map((r, i) => '<tr><td><select name="pos" data-i="' + i + '">' + posOpts + '</select></td><td><input name="txval" data-i="' + i + '" value="' + esc(r.txval) + '"></td><td><input name="iamt" data-i="' + i + '" value="' + esc(r.iamt) + '"></td></tr>').join("");
      $$("tbody tr", s).forEach((tr, i) => { $("select", tr).value = r32[k][i].pos || ""; $$("input, select", tr).forEach((el) => { const up = () => { r32[k][i][el.name] = el.value; }; el.addEventListener("input", up); el.addEventListener("change", up); }); });
      $(".add32", s).onclick = () => { r32[k].push({ pos: "", txval: "", iamt: "" }); draw32(); drop(); }; });
    draw32();
    $$(".tile").forEach((t) => { t.onclick = () => { $$(".modal").forEach((x) => x.classList.remove("open")); $("#m_" + t.dataset.m).classList.add("open"); }; });
    $$(".modal .confirm, .modal .cancel").forEach((b) => { b.onclick = () => b.closest(".modal").classList.remove("open"); });
    $("#save3b").onclick = () => { set(K, { m, r32 }); $("#msg3b").textContent = "Saved successfully."; };
    // the portal's own payment table: liability from 3.1 and 3.1.1, credit from 4(C), its own way of using credit
    $("#proceed").onclick = () => {
      const s = get(K, null); if (!s) { $("#msg3b").textContent = "Save the return first."; return; }
      const v = (id) => paise(s.m[id]), L = { igst: v("osup_det_iamt") + v("osup_zero_iamt") + v("eco_9_5_iamt"), cgst: v("osup_det_camt"), sgst: v("osup_det_samt"), cess: v("osup_det_csamt") + v("osup_zero_csamt") };
      const RC = { igst: v("isup_rev_iamt"), cgst: v("isup_rev_camt"), sgst: v("isup_rev_samt"), cess: v("isup_rev_csamt") };
      const C = {}; [["igst", "iamt"], ["cgst", "camt"], ["sgst", "samt"], ["cess", "csamt"]].forEach(([h, c]) => { C[h] = ["IMPG", "IMPS", "ISRC", "ISD", "OTH"].reduce((a, t) => a + v("itc_avl_" + t + "_" + c), 0) - ["RUL", "OTH"].reduce((a, t) => a + v("itc_rev_" + t + "_" + c), 0); });
      const use = {}, left = Object.assign({}, L), take = (f, t) => { const a = Math.max(0, Math.min(C[f], left[t])); C[f] -= a; left[t] -= a; use[f + "." + t] = (use[f + "." + t] || 0) + a; };
      take("igst", "igst"); take("igst", "cgst"); take("igst", "sgst"); take("cgst", "cgst"); take("cgst", "igst"); take("sgst", "sgst"); take("sgst", "igst"); take("cess", "cess");
      const cash = {}; ["igst", "cgst", "sgst", "cess"].forEach((h) => { cash[h] = left[h] + RC[h]; });
      const cell = (k, p2) => '<td class="n" data-cell="' + k + '">' + fmt(p2) + "</td>";
      $("#paybox").innerHTML = '<table id="payment"><tr><th>Description</th><th>Tax payable</th><th>Paid through ITC: Integrated</th><th>Central</th><th>State/UT</th><th>Cess</th><th>Paid in cash</th></tr>' +
        [["igst", "Integrated tax"], ["cgst", "Central tax"], ["sgst", "State/UT tax"], ["cess", "Cess"]].map(([h, l]) => "<tr><td>" + l + "</td>" + cell("pay.liab." + h, L[h] + RC[h]) +
          ["igst", "cgst", "sgst", "cess"].map((f) => cell("pay.itc." + f + "." + h, use[f + "." + h] || 0)).join("") + cell("pay.cash." + h, cash[h]) + "</tr>").join("") +
        '</table><button id="mkpay">MAKE PAYMENT/POST CREDIT TO LEDGER</button><button id="f3evc" disabled>FILE GSTR-3B WITH EVC</button><button id="f3dsc" disabled>FILE GSTR-3B WITH DSC</button>';
      $("#mkpay").onclick = () => { set("posted:" + p, true); $("#f3evc").disabled = false; $("#f3dsc").disabled = false; };
      $("#f3evc").onclick = () => fileFlow("GSTR3B", "0000002");
      drop();
    };
    if (filed("GSTR3B")) $("#filebox").innerHTML = '<div class="alert-success" id="arn-msg">Filed. ARN: ' + filed("GSTR3B").arn + "</div>";
    drop(); return;
  }

  /* ---------- GSTR-2B, ledgers, return status ---------- */
  if (page === "gstr2b") {
    head("GSTR-2B");
    const p = period();
    document.body.insertAdjacentHTML("beforeend", '<main><h3>GSTR-2B - Auto-drafted ITC Statement</h3><p>Return period <b id="ret-period">' + p + '</b></p><a id="json-download" href="/gstr2b/auth/download?period=' + p + '">DOWNLOAD GSTR-2B DETAILS (JSON)</a></main>');
    drop(); return;
  }
  if (page === "cashledger" || page === "creditledger") {
    head(page === "cashledger" ? "Electronic cash ledger" : "Electronic credit ledger");
    const bal = get(page, page === "cashledger" ? { igst: "1000.00", cgst: "250.50", sgst: "250.50", cess: "0.00" } : { igst: "380.50", cgst: "0.00", sgst: "12.00", cess: "0.00" });
    document.body.insertAdjacentHTML("beforeend", page === "cashledger"
      ? '<main><h3>Electronic Cash Ledger - balance</h3><table id="cash-balance"><tr><th>Head</th><th>Tax</th><th>Interest</th><th>Penalty</th><th>Fee</th><th>Others</th><th>Total</th></tr>' + ["igst", "cgst", "sgst", "cess"].map((h) => '<tr data-head="' + h + '"><td>' + h.toUpperCase() + '</td><td>' + bal[h] + "</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td class=\"total\">" + bal[h] + "</td></tr>").join("") + "</table></main>"
      : '<main><h3>Electronic Credit Ledger - balance</h3><table id="credit-balance"><tr><th>IGST</th><th>CGST</th><th>SGST/UTGST</th><th>CESS</th></tr><tr>' + ["igst", "cgst", "sgst", "cess"].map((h) => '<td data-head="' + h + '">' + bal[h] + "</td>").join("") + "</tr></table></main>");
    drop(); return;
  }
  if (page === "status") {
    head("Track return status");
    document.body.insertAdjacentHTML("beforeend", '<main><h3>Track Return Status</h3><table id="return-status"><thead><tr><th>Return type</th><th>Financial year</th><th>Tax period</th><th>Date of filing</th><th>Status</th><th>ARN</th></tr></thead><tbody>' +
      get("filed", []).map((f) => "<tr><td>" + f.form + "</td><td>" + f.fy + "</td><td>" + f.period + "</td><td>" + f.date + "</td><td>" + f.status + "</td><td>" + f.arn + "</td></tr>").join("") + "</tbody></table></main>");
    drop(); return;
  }
})();
