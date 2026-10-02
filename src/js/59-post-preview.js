/* ================================================================== */
/* Posting to Tally: what goes, seen first (review of 02-Oct-2026)     */
/* ================================================================== */
// With FinCom Bridge 2.1.1 on NWS144, jobs 0f9f0156 and c14b40fc sent "create master" for INPUT CGST and INPUT IGST,
// which GARG SHEKHAR & COMPANY already had (Tally answered ALTERED 1), and three postings went straight to the bridge
// without a trace in FinCom's cloud. Now:
//  - a ledger Tally already has (same name, ledNm, any case) is never sent as a master; one that must be created is
//    named first ("This will create ledger X under group Y in <company>") and nothing goes until that is confirmed;
//  - every voucher can be seen before it goes, as Tally will get it (date, type, each ledger Dr / Cr, narration), with a
//    warning for a new ledger, an income ledger on a purchase, and a party whose GSTIN is not the bill's;
//  - Tally's ALTERED is said as "Altered in Tally", never "created";
//  - a posting made straight to a bridge is recorded in FinCom's cloud afterwards (tally_post_record, migration-27).

// Tally's own text out of the XML being sent
function pvText(s){ return String(s == null ? "" : s).replace(/&#13;|&#10;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim(); }
// one voucher, read from the XML that goes to Tally: {type, date (yyyy-mm-dd), number, ref, party, narration, optional,
// lines: [{ledger, dr, amount}], dr, cr}
function voucherPreview(xml){
  const x = String(xml || "");
  const one = re => { const m = x.match(re); return m ? pvText(m[1]) : ""; };
  const head = x.split(/<(?:ALL)?LEDGERENTRIES\.LIST>/)[0];
  const h = re => { const m = head.match(re); return m ? pvText(m[1]) : ""; };
  const d8 = h(/<DATE>(\d{8})<\/DATE>/);
  const out = {type: (head.match(/<VOUCHER\b[^>]*\bVCHTYPE="([^"]*)"/) || [])[1] ? pvText(head.match(/<VOUCHER\b[^>]*\bVCHTYPE="([^"]*)"/)[1]) : h(/<VOUCHERTYPENAME>([\s\S]*?)<\/VOUCHERTYPENAME>/),
    date: d8 ? d8.slice(0, 4) + "-" + d8.slice(4, 6) + "-" + d8.slice(6, 8) : "", number: h(/<VOUCHERNUMBER>([\s\S]*?)<\/VOUCHERNUMBER>/), ref: h(/<REFERENCE>([\s\S]*?)<\/REFERENCE>/),
    party: h(/<PARTYLEDGERNAME>([\s\S]*?)<\/PARTYLEDGERNAME>/), narration: one(/<NARRATION>([\s\S]*?)<\/NARRATION>/), optional: /<ISOPTIONAL>\s*Yes/i.test(head), lines: [], dr: 0, cr: 0};
  const re = /<(ALLLEDGERENTRIES|LEDGERENTRIES)\.LIST>([\s\S]*?)<\/\1\.LIST>/g;
  let m;
  while ((m = re.exec(x))){
    // the line's own fields, without the lists inside it (bill and bank allocations carry amounts of their own)
    const own = m[2].replace(/<([A-Z0-9.]+\.LIST)>[\s\S]*?<\/\1>/g, "");
    const ledger = pvText((own.match(/<LEDGERNAME>([\s\S]*?)<\/LEDGERNAME>/) || [])[1]);
    const a = parseFloat(String((own.match(/<AMOUNT>\s*([-0-9.,]+)\s*<\/AMOUNT>/) || [])[1] || "0").replace(/,/g, "")) || 0;
    const dp = (own.match(/<ISDEEMEDPOSITIVE>\s*(Yes|No)/i) || [])[1];
    const dr = a < 0 || (a === 0 && /yes/i.test(dp || ""));
    out.lines.push({ledger, dr, amount: Math.abs(a)});
    if (dr) out.dr += Math.abs(a); else out.cr += Math.abs(a);
  }
  out.dr = r2(out.dr); out.cr = r2(out.cr);
  return out;
}
// a ledger master in the posting: {name, group, gstin}; null for anything else (a voucher type's numbering)
function masterPreview(xml){
  const x = String(xml || ""), m = x.match(/^\s*<LEDGER\b[^>]*\bNAME="([^"]*)"/);
  if (!m) return null;
  return {name: ledNm(pvText(m[1])), group: pvText((x.match(/<PARENT>([\s\S]*?)<\/PARENT>/) || [])[1]), gstin: pvText((x.match(/<PARTYGSTIN>([\s\S]*?)<\/PARTYGSTIN>/) || [])[1])};
}
// the client's ledger list is the one held here (Tally's, read live or from FinCom's cloud)
// (the one list of 58-ledgers.js when it is there: exactLedger reads the open client's list)
function pvListFor(cid){
  const here = typeof Ledgers === "object" && Ledgers.cid ? Ledgers.cid() : (S.bank && S.bank.cid);
  return !!(typeof hasLedgerList === "function" && (!cid || here === cid) && hasLedgerList());
}
// a ledger Tally has: the same name (ledNm, any case); a ledger made here and still waiting for Tally does not count
function ledgerInTally(name, cid){
  const n = ledNm(name);
  if (!n || !pvListFor(cid) || typeof exactLedger !== "function") return null;
  let hit = null;
  try { hit = exactLedger(n); } catch (e){ return null; }
  if (!hit || ledNm(hit).toLowerCase() !== n.toLowerCase()) return null;
  const info = typeof ledgerInfo === "function" ? ledgerInfo(hit) : null;
  return info && info.pending ? null : (info || {name: hit});
}
// Tally has a ledger spelt a little differently (the list matches "Input C.G.S.T" to "INPUT CGST")
function ledgerLike(name, cid){
  if (!pvListFor(cid) || typeof exactLedger !== "function") return "";
  let hit = null; try { hit = exactLedger(ledNm(name)); } catch (e){}
  const info = hit && typeof ledgerInfo === "function" ? ledgerInfo(hit) : null;
  return hit && !(info && info.pending) && ledNm(hit).toLowerCase() !== ledNm(name).toLowerCase() ? hit : "";
}
const INCOME_GROUPS = /^(sales accounts|direct incomes?|indirect incomes?)$/i;
function incomeLedger(name, cid){
  const info = ledgerInTally(name, cid) || (typeof ledgerInfo === "function" && pvListFor(cid) ? ledgerInfo(name) : null);
  const g = String((info && (info.group || info.parent)) || "");
  if (INCOME_GROUPS.test(g)) return g;
  try { if (typeof FC === "object" && S.books && S.books.cid === cid){ const top = ["Sales Accounts", "Direct Incomes", "Indirect Incomes"].find(x => FC.inGroup(ledNm(name), x)); if (top) return top; } } catch (e){}
  return "";
}

// Tally's answer for one entry, said one way everywhere (B12): "In Tally (verified)", "In Tally, not yet read back",
// "Altered in Tally", "Failed: reason"
function postAltered(x){
  if (!x || !x.ok) return false;
  if (num(x.altered) > 0 && !(num(x.created) > 0)) return true;
  const m = String(x.message || "");
  return /\bALTERED\b/i.test(m) && !/\bCREATED\b\s*[:=]?\s*[1-9]/i.test(m);
}
function postWord(x){
  if (!x) return "Failed: Tally did not answer for this entry";
  if (!x.ok) return "Failed: " + (plainMsg(x.message) || "Tally did not confirm it");
  if (x.existed) return "Already in Tally (not sent again)";
  if (postAltered(x)) return "Altered in Tally";
  if (x.verified === true) return "In Tally (verified)";
  return "In Tally, not yet read back";
}

const PostGate = {
  ok: null,                 // the new ledgers confirmed in the preview: {names: Set, company, until}
  approve(names, company){ this.ok = {names: new Set(names.map(n => ledNm(n).toLowerCase())), company: ledNm(company).toLowerCase(), until: Date.now() + 15 * 60000}; },
  approved(names, company){
    const a = this.ok;
    return !!a && Date.now() < a.until && (!company || !a.company || a.company === ledNm(company).toLowerCase()) && names.every(n => a.names.has(ledNm(n).toLowerCase()));
  },
  createLine(m, company){ return "This will create ledger <b>" + esc(m.name) + "</b> under group <b>" + esc(m.group || "(no group)") + "</b> in <b>" + esc(company) + "</b>."; },
  // the masters of a posting: those Tally has are dropped (answered here); new ones asked about first.
  // {masters, results, cancelled}
  async masters(payload, co){
    const keep = [], results = [], create = [];
    [].concat(payload.masters || []).forEach(m => {
      const info = masterPreview(m.xml);
      if (!info){ keep.push(m); return; }
      const has = ledgerInTally(info.name, co && co.id);
      if (has){ results.push({id: m.id, ok: true, kind: "master", existed: true, name: info.name, message: "Already in Tally (" + (has.name || info.name) + "): not sent"}); return; }
      keep.push(m); create.push(Object.assign({id: m.id, like: ledgerLike(info.name, co && co.id)}, info));
    });
    if (create.length && !this.approved(create.map(m => m.name), payload.company)){
      const a = await askConfirm({title: "Create " + (create.length === 1 ? "a new ledger" : create.length + " new ledgers") + " in " + payload.company + "?", ok: "Create and post", wide: true,
        body: '<div data-create-masters="">' + create.map(m => "<p style=\"margin:0 0 6px\">" + this.createLine(m, payload.company) + (m.like ? ' <span class="tag warn">Tally has “' + esc(m.like) + "”</span>" : "") + "</p>").join("") +
          '<p class="note" style="margin:10px 0 0">Nothing is sent to Tally until you confirm. Cancel, and choose the Tally ledger instead if it already exists under another name.</p></div>'});
      if (!a) return {cancelled: true, masters: keep, results};
    }
    return {masters: keep, results, created: create};
  },
  // ---------- the preview: each voucher as it goes to Tally, with what to look at
  warnings(it, co){
    const w = [], v = it.v, cid = co && co.id, listed = pvListFor(cid);
    if (!listed) w.push("Tally’s ledger list is not loaded here, so the ledgers were not checked.");
    else v.lines.forEach(l => {
      if (ledgerInTally(l.ledger, cid)) return;
      const pend = ((S.bank && S.bank.cid === cid && S.bank.newLed) || []).find(n => ledNm(n.name).toLowerCase() === ledNm(l.ledger).toLowerCase() && !n.sent);
      w.push("New ledger: " + l.ledger + (pend ? " will be created under " + (pend.group || "(no group)") : " is not in Tally’s ledger list") + ".");
    });
    if (it.kind === "bill"){
      v.lines.forEach(l => { const g = incomeLedger(l.ledger, cid); if (g) w.push("Income ledger on a purchase: " + l.ledger + " is under " + g + "."); });
      const e = it.e, info = e && listed ? (ledgerInTally(e.partyLedger, cid) || {}) : {};
      const a = gstinKeyOf(e && e.x.vendorGstin), b = gstinKeyOf(info.gstin);
      if (a && b && a !== b) w.push("Party not matched by GSTIN: the bill is from " + a + ", but the ledger " + (info.name || e.partyLedger) + " has " + b + ".");
    }
    if (it.kind === "sale" && it.e && listed){
      const info = ledgerInTally(it.e.customerLedger, cid) || {}, a = gstinKeyOf(it.e.x.customerGstin), b = gstinKeyOf(info.gstin);
      if (a && b && a !== b) w.push("Party not matched by GSTIN: the invoice is to " + a + ", but the ledger " + (info.name || it.e.customerLedger) + " has " + b + ".");
    }
    if (v.dr !== v.cr) w.push("Debits " + INR.format(v.dr) + " and credits " + INR.format(v.cr) + " do not agree.");
    return w;
  },
  html(items, co, masters, company){
    const amt = n => n ? INR.format(n) : "";
    const ms = (masters || []).length ? '<div class="bk-alert" data-pv-masters="" style="margin:0 0 10px">' + masters.map(m => "<div>" + this.createLine(m, company) + "</div>").join("") + "</div>" : "";
    return ms + items.map(it => {
      const v = it.v = it.v || voucherPreview(it.xml), w = this.warnings(it, co);
      return '<div class="pv" data-pv="' + esc(it.id) + '" data-pv-kind="' + it.kind + '" style="border:1px solid var(--line,#ddd);border-radius:8px;padding:8px 10px;margin:0 0 10px">' +
        "<div><b>" + esc(fmtDate(v.date) || "no date") + " · " + esc(v.type || "?") + (v.number ? " no. " + esc(v.number) : "") + "</b>" + (v.ref ? " · ref " + esc(v.ref) : "") + (v.optional ? ' <span class="tag">Optional</span>' : "") + "</div>" +
        '<div class="tblwrap"><table class="data" style="margin:6px 0"><thead><tr><th>Ledger</th><th class="n">Dr</th><th class="n">Cr</th></tr></thead><tbody>' +
        v.lines.map(l => '<tr data-pv-line=""><td>' + esc(l.ledger) + '</td><td class="n">' + (l.dr ? amt(l.amount) : "") + '</td><td class="n">' + (l.dr ? "" : amt(l.amount)) + "</td></tr>").join("") +
        '<tr><td><b>Total</b></td><td class="n"><b>' + amt(v.dr) + '</b></td><td class="n"><b>' + amt(v.cr) + "</b></td></tr></tbody></table></div>" +
        '<div class="note" data-pv-narr="">' + esc(v.narration) + "</div>" +
        (w.length ? '<ul class="pv-warn" data-pv-warn="" style="margin:6px 0 0 18px;padding:0;color:var(--bad,#b42318)">' + w.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") + "</div>";
    }).join("");
  }
};
function gstinKeyOf(g){ const k = String(g || "").toUpperCase().replace(/[^0-9A-Z]/g, ""); return /^\d{2}[A-Z0-9]{13}$/.test(k) ? k : ""; }

// A posting made straight to a bridge (no cloud for this client): recorded in FinCom's cloud afterwards, finished, so
// "Postings in FinCom's cloud" lists every posting (migration-27; an older cloud without it: nothing recorded, no error)
const PostRecord = {
  missing: false,
  clean(r){ const o = {}; ["id", "ok", "kind", "message", "verified", "vchNumber", "vchType", "guid", "masterId", "vchDate", "optional", "altered", "created", "existed", "pendingCheck"].forEach(k => { if (r[k] !== undefined) o[k] = r[k]; }); if (o.message) o.message = String(o.message).slice(0, 400); return o; },
  async save(co, payload, out){
    if (this.missing || !co || !out || typeof TCloud !== "object" || !TCloud.on()) return false;
    const uuidOk = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
    const id = out.recId || (out.job && uuidOk(out.job.id) ? out.job.id : CloudPost.uuid());
    out.recId = id;
    const vids = [].concat(payload.vouchers || []).map(v => v.id), res = [].concat(out.results || []).map(r => this.clean(r));
    const vres = res.filter(r => vids.includes(r.id)), okN = vres.filter(r => r.ok).length, unread = vres.filter(r => r.ok && r.verified !== true && !postAltered(r)).length;
    const status = vres.length && okN === vids.length ? "done" : (!vids.length && res.every(r => r.ok) ? "done" : "failed");
    const how = "sent straight to FinCom Bridge" + (Bridge.st.version ? " " + Bridge.st.version : "") + (Bridge.st.computer ? " on " + Bridge.st.computer : " on this computer");
    const message = (vids.length ? okN + " of " + vids.length + " in Tally" + (unread ? " (" + unread + " not yet read back)" : "") : res.length + " ledger" + (res.length === 1 ? "" : "s")) + ", " + how;
    try {
      const r = await TCloud.rpc("tally_post_record", {p_id: id, p_client: co.id, p_company: out.company || payload.company || "", p_status: status, p_results: res, p_entry_ids: vids, p_message: message});
      if (r && r.ok === false) return false;
      if (typeof CloudJobs === "object") CloudJobs.load(true);
      return true;
    } catch (e){
      if (/tally_post_record|does not exist|schema cache|PGRST202|404/i.test(String((e && e.message) || e))) this.missing = true;
      return false;
    }
  }
};

// One count of what is for Tally, used everywhere (review of 02-Oct-2026: the header chip said 1, the tab 1, the page 0
// and the dashboard 0): the bills approved and not confirmed in Tally, the same as the client's stats.waiting. A bill
// sent in a Tally file, or posted and not yet read back, is counted (and listed on the page) until Tally confirms it.
function postBillsOpen(cid){ const d = S.data[cid]; return d && d.loaded ? Object.values(d.entries).filter(e => e.status === "approved" && !billInTally(e)) : null; }
function postCountFor(cid){ const l = postBillsOpen(cid); return l ? l.length : num(((S.companies[cid] || {}).stats || {}).waiting); }

// ---------- the Post to Tally page: one line, one table, one button (C15-C18)
// what this client's entries go into, and through what: {company, bridge, state, action, go}
function postLineFor(co){
  const cloud = typeof TCloud === "object" && TCloud.on();
  if (cloud && !TCloud.pane.at && !TCloud.pane.busy && Date.now() - (PostPage.paneAt || 0) > 5 * 60000){ PostPage.paneAt = Date.now(); setTimeout(() => { try { TCloud.refreshPane(); } catch (e){} }, 0); }
  let bk = null; try { bk = cloud ? TCloud.book(co.id) : null; } catch (e){}
  let company = co.postTo || (bk && bk.company) || "";
  if (!company){ try { company = tallyCoName(co); } catch (e){ company = co.tallyName || co.name; } }
  let bridge = "", state = "Ready", action = "", go = "";
  let heard = []; try { heard = cloud ? TCloud.bridgesHeard() : []; } catch (e){}
  const main = heard.find(r => r.main && r.go) || heard.find(r => r.main) || null;
  const local = Bridge.on() && Bridge.up();
  if (main){
    bridge = "FinCom Bridge " + (main.version || "");
    if (!main.online){ state = ""; action = "FinCom Bridge on " + main.computer + " is not running"; go = "tally"; }
    else if (main.tally !== "open" && main.tally !== "busy" && !(local && bridgeLive(co))){ state = ""; action = "Tally not open on " + main.computer; }
  } else if (local){
    bridge = "FinCom Bridge " + (Bridge.st.version || "");
    if (!bridgeLive(co)){ state = ""; action = Bridge.st.tallyUp ? "Open " + company + " in Tally" : "Tally not open on " + (Bridge.st.computer || "this computer"); }
  } else if (Bridge.on()){ bridge = "FinCom Bridge"; state = ""; action = "FinCom Bridge is not answering on this computer"; go = "tally"; }
  else { state = ""; action = "Install FinCom Bridge"; go = "tally"; }
  if (!co.postTo){ state = ""; action = "Choose the Tally company"; go = "cotally"; }
  return {company, bridge, state, action, go};
}
const PostPage = {paneAt: 0};
function goChooseTallyCompany(){ S.step = null; S.arm = null; S.tab = "cotally"; render(); window.scrollTo(0, 0); }
function goTallyPage(){ closeSwitcher(); S.view = "home"; S.homeTab = "tally"; S.arm = null; render(); window.scrollTo(0, 0); }
// the role of a bill's ledger line, as the table groups them
const PV_ROLE = {party: "party", expense: "expense", gst: "gst", "rcm-in": "gst", "rcm-out": "gst", tds: "tds"};
// the entries waiting or on their way: bills, the open statement's bank lines, and sales ready to post
function postRows(co){
  const out = [], d = D(co.id), jobs = typeof CloudJobs === "object" ? CloudJobs.forClient(co.id) : [];
  const live = jobs.filter(j => ["waiting", "taken", "running"].includes(j.status) || j.checking);
  const stOf = (id, fallback) => {
    for (const j of live){
      const it = [].concat(j.items || []).find(x => x.id === id);
      if (it) return it.state === "waiting" ? ["Waiting for Tally", "warn"] : it.state === "sending" ? ["Sending", "warn"] : it.state === "sent" ? ["In Tally, not yet read back", "warn"] : it.state === "in_tally" ? ["In Tally (verified)", "ok"] : ["Failed: " + (it.reason || "Tally refused it"), "bad"];
      if ((CloudJobs.idsOf(j) || []).includes(id)) return [j.status === "waiting" ? "Waiting for Tally" : "Sending", "warn"];
    }
    return fallback;
  };
  const busyBills = !!(S.billPost && S.billPost.busy && /^Posting/.test(S.billPost.busy));
  (postBillsOpen(co.id) || []).sort(byDate).forEach(e => {
    const led = {party: [], expense: [], gst: [], tds: []};
    (e.snapshot ? e.snapshot.lines : []).forEach(l => { const k = PV_ROLE[l.role] || "expense"; if (l.ledger && !led[k].includes(l.ledger)) led[k].push(l.ledger); });
    // sent (a Tally file, or posted and not confirmed): listed with where it stands, not posted again from here
    const sent = !!e.exportedAt, ts = sent ? tallyStateOf(e) : null;
    out.push({kind: "bill", id: e.id, date: e.x.invoiceDate, party: e.x.vendorName, no: e.x.invoiceNo || "", amount: num(e.x.total), led, e, sent,
      state: sent ? [ts[1], ts[0] === "bad" ? "bad" : "warn"] : stOf(e.id, e.postUnconfirmed ? ["In Tally, not yet read back", "warn"] : busyBills ? ["Sending", "warn"] : ["Waiting for Tally", ""])});
  });
  const b = S.bank && S.bank.cid === co.id && !S.bank.loading ? S.bank : null, st = b ? curStmt() : null;
  if (b && st){
    const acc = (co.bankAccounts || []).find(a => a.id === st.acctId) || {};
    b.rows.filter(r => r.state === "ready").forEach(r => out.push({kind: "bank", id: r.id, date: r.date, party: (r.dec && r.dec.name) || r.narr.slice(0, 40), no: (r.dec && (r.dec.chq || r.dec.utr)) || r.ref || "",
      amount: num(r.debit || r.credit), led: {party: [r.ledger].filter(Boolean), expense: [acc.ledger].filter(Boolean), gst: [], tds: r.tdsAtPay ? [r.tdsLedger || ""].filter(Boolean) : []}, e: r,
      state: stOf(r.id, r.postError ? ["Failed: " + r.postError, "bad"] : b.busy && /^Posting/.test(b.busy) ? ["Sending", "warn"] : ["Waiting for Tally", ""])}));
  }
  const s = S.sales && S.sales.cid === co.id && !S.sales.loading ? S.sales : null;
  if (s) s.list.filter(v => v.status === "ready").forEach(v => {
    const ls = typeof salesLines === "function" ? salesLines(v) : [];
    out.push({kind: "sale", id: v.id, date: v.x.date, party: v.x.customerName || v.customerLedger, no: v.x.number || "", amount: num(v.x.total),
      led: {party: [v.customerLedger].filter(Boolean), expense: ls.map(l => l.ledger).filter(l => l && l !== v.customerLedger && !/gst|cess/i.test(l)), gst: ls.map(l => l.ledger).filter(l => /gst|cess/i.test(l || "")), tds: []}, e: v,
      state: stOf(v.id, v.postError ? ["Failed: " + v.postError, "bad"] : s.busy && /^Posting/.test(s.busy) ? ["Sending", "warn"] : ["Waiting for Tally", ""])});
  });
  return out;
}
// the voucher XML of a row, exactly as it would go now
function postRowXml(co, row){
  if (row.kind === "bill") return voucherXml(row.e, co);
  if (row.kind === "bank"){ const st = curStmt(), acc = st && (co.bankAccounts || []).find(a => a.id === st.acctId); return acc ? bankVoucherXml(row.e, acc, co) : ""; }
  if (row.kind === "sale") return typeof salesVoucherXml === "function" ? salesVoucherXml(row.e, co) : "";
  return "";
}
// the new ledgers the rows would make in Tally (waiting here, not in Tally's list)
function postNewMasters(co, rows){
  if (!S.bank || S.bank.cid !== co.id) return [];
  const used = new Set();
  rows.forEach(r => { const xml = r.xml || postRowXml(co, r); voucherPreview(xml).lines.forEach(l => used.add(ledNm(l.ledger).toLowerCase())); });
  return (S.bank.newLed || []).filter(l => !l.sent && used.has(ledNm(l.name).toLowerCase()) && !ledgerInTally(l.name, co.id)).map(l => ({name: ledNm(l.name), group: l.group || ""}));
}
function postCompanyName(co){ if (co.postTo) return co.postTo; try { return tallyCoName(co); } catch (e){ return co.tallyName || co.name; } }
// the posting stopped by the company check: kept for the page (nothing was sent; the entries stay waiting)
function postStopped(msg, cid){ S.postStop = {msg: plainMsg(msg), cid: cid || S.coId, at: Date.now()}; }
// Preview of one entry, or of the ones about to go: the dialog; true when the person pressed Post
async function postPreview(co, rows, opts){
  opts = opts || {};
  rows.forEach(r => { r.xml = r.xml || postRowXml(co, r); });
  const company = postCompanyName(co), masters = postNewMasters(co, rows);
  const items = rows.filter(r => r.xml).map(r => ({kind: r.kind, id: r.id, xml: r.xml, e: r.e}));
  const nWarn = () => document.querySelectorAll("#confirmBox [data-pv-warn] li").length;
  const a = await askConfirm({title: opts.view ? "Preview: " + (rows[0] ? (rows[0].no || rows[0].party) : "") : "Post " + entries(items.length) + " to " + company + "?", ok: opts.view ? "Close" : "Post", wide: true,
    body: '<div data-post-preview="" style="max-height:60vh;overflow:auto">' + (opts.view ? "" : '<p style="margin:0 0 8px">Each entry exactly as it goes to Tally, into <b>' + esc(company) + "</b>.</p>") + PostGate.html(items, co, masters, company) + "</div>",
    onReady: box => { if (opts.view){ const no = box.querySelector('[data-cbx="no"]'); if (no) no.remove(); } else { const n = nWarn(); if (n){ const p = document.createElement("p"); p.className = "bk-warn"; p.setAttribute("data-pv-count", ""); p.textContent = n + " warning" + (n === 1 ? "" : "s") + " above: look at them before posting."; box.querySelector(".cbx .row").before(p); } } }});
  if (!a || opts.view) return false;
  PostGate.approve(masters.map(m => m.name), company);
  return true;
}
// "Post N to Tally" (and Post on one row): the preview of all, then each kind posted as before
async function postAllToTally(only){
  const co = CO();
  if (!co) return;
  if (!co.postTo) await autoPostTo(co);
  if (!co.postTo){ postStopped(postToProblem(co, ""), co.id); render(); return; }
  if (!S.bank || S.bank.cid !== co.id) await loadBank(co.id);
  let rows = postRows(co).filter(r => !r.sent && !/^(Sending|In Tally)/.test(r.state[0]));
  if (only) rows = rows.filter(r => r.kind === only.kind && r.id === only.id);
  if (!rows.length){ toast("Nothing is waiting to be posted."); return; }
  S.postStop = null;
  if (!(await postPreview(co, rows))) return;
  const bills = rows.filter(r => r.kind === "bill").map(r => r.id), bank = rows.filter(r => r.kind === "bank").map(r => r.id), sales = rows.filter(r => r.kind === "sale");
  if (bills.length) await postBillsToTally({ids: bills});
  if (bank.length && !(S.postStop && S.postStop.cid === co.id)) await postBankToTally(bank);
  if (sales.length && !(S.postStop && S.postStop.cid === co.id) && typeof postSalesToTally === "function") await postSalesToTally();
  render();
}
function postPreviewOne(kind, id){
  const co = CO(), row = postRows(co).find(r => r.kind === kind && r.id === id);
  if (row) postPreview(co, [row], {view: true});
}
function postOneToTally(kind, id){ return postAllToTally({kind, id}); }
// Back to review from the Post to Tally page, for any kind
function postBackToReview(kind, id){
  if (kind === "bill"){ billBack(id); return; }
  if (kind === "bank" && S.bank){ const r = S.bank.rows.find(x => x.id === id); if (r){ r.state = "attention"; r.userSet = false; saveBank({rows: true}); toast("Back in To review in Bank."); render(); } return; }
  if (kind === "sale" && S.sales){ const v = S.sales.list.find(x => x.id === id); if (v){ v.status = "review"; saveSales(); toast("Back in To review in Sales."); render(); } }
}

// ---------- the company a client may post to, set by itself when it is clear (B14)
// Exactly one Tally company is linked to the client (FinCom's cloud, or the company open in Tally here) and its GSTIN is
// the client's: that one, saved (it syncs), with postToBy "auto". For existing clients too, when one is opened.
const AutoPostTo = {at: {}};
async function autoPostTo(co, force){
  if (!co || co.postTo || co.deleted) return false;
  const mine = gstinKeyOf(co.gstin);
  if (!mine) return false;
  if (!force && Date.now() - (AutoPostTo.at[co.id] || 0) < 60000) return false;
  AutoPostTo.at[co.id] = Date.now();
  const found = new Map();
  const add = (name, gstin) => { const n = ledNm(name); if (!n) return; const k = n.toLowerCase(), x = found.get(k) || {name: n, gstins: new Set()}; if (gstinKeyOf(gstin)) x.gstins.add(gstinKeyOf(gstin)); found.set(k, x); };
  if (typeof TCloud === "object" && TCloud.on()){
    let rows = TCloud.pane.companies ? TCloud.pane.companies.filter(c => c.client_id === co.id) : null;
    if (!rows){ try { rows = await Cloud.api("tally_companies?select=company,client_id,gstin&client_id=eq." + encodeURIComponent(co.id)) || []; } catch (e){ rows = []; } }
    rows.forEach(c => add(c.company, c.gstin));
  }
  const o = Bridge.up() ? Bridge.openFor(co) : null;
  if (o) add(o.name, o.gstin);
  if (found.size !== 1) return false;
  const one = Array.from(found.values())[0];
  if (!one.gstins.has(mine) || one.gstins.size !== 1 || co.postTo) return false;
  co.postTo = one.name; co.postToAt = new Date().toISOString(); co.postToBy = "auto";
  Store.saveCompany(co);
  if (S.postStop && S.postStop.cid === co.id) S.postStop = null;
  toast(co.name + ": entries are posted only into " + one.name + " (the one Tally company linked, same GSTIN " + mine + ").");
  render();
  return true;
}
