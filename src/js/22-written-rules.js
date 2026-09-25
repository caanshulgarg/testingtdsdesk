/* ================================================================== */
/* Written rules: say it once, and every statement follows it          */
/* ================================================================== */
const RULE_MODES = ["UPI", "NEFT", "RTGS", "IMPS", "CHQ", "ACH", "CASH", "CARD"];
const RULE_KINDS = [                       // firm-wide rules point at a kind, resolved per client
  ["charges", "Bank charges ledger"], ["interest", "Interest received ledger"], ["salary", "Salaries ledger"],
  ["tds", "TDS payable ledger"], ["gstCash", "GST cash ledger"], ["advanceTax", "Advance tax ledger"],
  ["pf", "PF payable ledger"], ["esi", "ESI payable ledger"], ["cash", "Cash ledger"], ["roundOff", "Round off ledger"]
];
function firmRules(){ S.firm.bankRules = S.firm.bankRules || []; return S.firm.bankRules; }
function clientRules(){ const b = B(); if (!b) return []; b.wrules = b.wrules || []; return b.wrules; }
function allRules(){ return clientRules().concat(firmRules()); }   // client rules win
function newRule(p){
  return Object.assign({
    id: uid("rl"), name: "", scope: "client", off: false,
    when: {text: [], dir: "any", amtMin: "", amtMax: "", modes: [], acNo: "", account: "any", from: "", to: ""},
    then: {action: "set", ledger: "", kind: "", vtype: "", tdsNature: "", tdsAtPay: false, splits: [], narr: "", ready: true},
    stats: {used: 0, over: 0, lastAt: ""}
  }, p || {});
}
function saveRules(scope){
  if (scope === "firm") Store.saveFirm();
  else saveBank({wrules: true});
}
/* ---------- does this rule fit this line? ---------- */
function ruleHits(rule, row, acc){
  if (!rule || rule.off) return false;
  const w = rule.when || {}, hay = (row.narr + " " + (row.ref || "")).toLowerCase();
  for (const c of (w.text || [])){
    const v = String(c.v || "").toLowerCase().trim();
    if (!v) continue;
    const has = hay.includes(v);
    if (c.op === "has" && !has) return false;
    if (c.op === "not" && has) return false;
    if (c.op === "starts" && !hay.trim().startsWith(v)) return false;
    if (c.op === "is" && normName(row.dec.name || "") !== normName(v) && hay.trim() !== v) return false;
  }
  if (w.dir === "out" && !row.debit) return false;
  if (w.dir === "in" && !row.credit) return false;
  const amt = row.debit || row.credit;
  if (w.amtMin !== "" && w.amtMin != null && amt < num(w.amtMin)) return false;
  if (w.amtMax !== "" && w.amtMax != null && amt > num(w.amtMax)) return false;
  if ((w.modes || []).length && !w.modes.includes(row.dec.mode || "")) return false;
  if (w.acNo){
    const want = String(w.acNo).replace(/\D/g, "");
    const got = (row.narr.match(/\d{6,18}/g) || []).map(x => x.replace(/^0+/, ""));
    if (want && !got.some(g => g.endsWith(want.replace(/^0+/, "")) || want.endsWith(g))) return false;
  }
  if (w.account && w.account !== "any" && acc && acc.id !== w.account) return false;
  if (w.from && row.date < w.from) return false;
  if (w.to && row.date > w.to) return false;
  return (w.text || []).some(c => String(c.v || "").trim() && c.op !== "not") || w.acNo || (w.modes || []).length ||
         w.amtMin !== "" || w.amtMax !== "";   // a rule with no positive condition never fires
}
// the ledger a rule asks for, in this client's Tally
function ruleLedger(rule, co){
  if (rule.then.kind) return stdLedger(co, rule.then.kind) || "";
  return rule.then.ledger || "";
}
function ruleLabel(rule){ return rule.name || (rule.when.text || []).map(c => c.v).filter(Boolean).join(" + ") || "rule"; }
// fill {month}, {year}, {party}, {amount} in a narration
function ruleNarr(tpl, row){
  if (!tpl) return "";
  const d = row.date ? new Date(row.date) : null;
  return tpl.replace(/\{month\}/gi, d ? d.toLocaleString("en-IN", {month: "long"}) : "")
            .replace(/\{year\}/gi, d ? String(d.getFullYear()) : "")
            .replace(/\{party\}/gi, row.dec.name || "")
            .replace(/\{amount\}/gi, INR.format(row.debit || row.credit))
            .replace(/\{date\}/gi, row.date ? fmtDate(row.date) : "");
}
/* ---------- put a rule on a line ---------- */
function applyRule(rule, row, co, acc){
  const led = ruleLedger(rule, co);
  if (rule.then.action === "ignore"){
    row.ledger = ""; row.state = "ignored"; row.ruleId = rule.id; row.srcLabel = "rule: " + ruleLabel(rule);
    row.why = ["Set aside by your rule \u201c" + ruleLabel(rule) + "\u201d."];
    return true;
  }
  if (!led || !exactLedger(led)){
    row.ruleId = rule.id; row.ruleWant = led;
    row.state = "attention"; row.ledger = "";
    row.why = ["Your rule \u201c" + ruleLabel(rule) + "\u201d asks for " + (led ? "\u201c" + led + "\u201d" : "a ledger") + ", which is not in Tally. Choose one, or create it."];
    row.source = "rule"; row.level = "none"; row.srcLabel = "rule needs a ledger";
    return true;
  }
  row.ledger = exactLedger(led);
  row.ruleId = rule.id;
  row.source = "rule";
  row.srcLabel = "rule: " + ruleLabel(rule);
  row.level = rule.then.ready ? "auto" : "guess";
  row.why = ["Your rule \u201c" + ruleLabel(rule) + "\u201d sets " + row.ledger + "."];
  row.vtype = rule.then.vtype || vtypeFor(row, row.ledger);
  row.userSet = false;
  row.splits = [];
  if ((rule.then.splits || []).length){
    const amt = row.debit || row.credit;
    let left = r2(amt);
    const parts = [];
    rule.then.splits.forEach((sp, i) => {
      const lname = sp.kind ? stdLedger(co, sp.kind) : sp.ledger;
      const value = sp.pct !== "" && sp.pct != null ? r2(amt * num(sp.pct) / 100) : r2(num(sp.amt));
      if (lname && exactLedger(lname) && value > 0){ parts.push({ledger: exactLedger(lname), amt: value}); left = r2(left - value); }
    });
    if (parts.length){
      if (left > 0.009) parts.push({ledger: row.ledger, amt: left});         // the rest goes to the main ledger
      row.splits = parts;
      row.why.push("Split: " + parts.map(p => p.ledger + " " + INR.format(p.amt)).join(", ") + ".");
    }
  }
  if (rule.then.tdsAtPay && row.debit){
    const rate = num(rule.then.tdsRate) || 0;
    if (rate > 0){ row.tdsAtPay = r2((row.debit) * rate / 100); row.tdsLedger = bankLedgers(co).tds; row.why.push("TDS at payment " + rate + "%."); }
  }
  if (rule.then.narr) row.ruleNarr = ruleNarr(rule.then.narr, row);
  row.state = rule.then.ready ? "ready" : "suggested";
  return true;
}
// the first rule that fits, client rules before firm rules
function matchRule(row, co, acc){
  const list = allRules();
  for (const r of list) if (ruleHits(r, row, acc)) return r;
  return null;
}
function rulePreview(rule){
  const b = B(); if (!b) return {n: 0, rows: []};
  const acc = curStmt() ? (CO(b.cid).bankAccounts || []).find(a => a.id === curStmt().acctId) : null;
  const rows = b.rows.filter(r => ruleHits(rule, r, acc));
  return {n: rows.length, rows: rows.slice(0, 5), total: b.rows.length};
}
// count how often a rule was overridden by hand, so a bad rule shows up
function noteOverride(row){
  if (!row.ruleId) return;
  const r = allRules().find(x => x.id === row.ruleId);
  if (!r) return;
  r.stats = r.stats || {used: 0, over: 0};
  r.stats.over = (r.stats.over || 0) + 1;
  saveRules(r.scope);
}
function countRuleUse(rows){
  const by = {};
  rows.forEach(r => { if (r.ruleId) by[r.ruleId] = (by[r.ruleId] || 0) + 1; });
  let touched = false;
  allRules().forEach(r => {
    if (by[r.id]){ r.stats = r.stats || {used: 0, over: 0}; r.stats.used = (r.stats.used || 0) + by[r.id]; r.stats.lastAt = new Date().toISOString(); touched = true; }
  });
  if (touched){ saveRules("client"); saveRules("firm"); }
}
/* ---------- make a rule from what you are looking at ---------- */
// the steady part of a narration: drop numbers, dates and reference tails
function steadyPart(narr){
  let s = String(narr || "").toUpperCase();
  s = s.replace(/\b\d{6,}\b/g, " ").replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, " ")
       .replace(/\b(UPI|NEFT|RTGS|IMPS|ACH|MMT|CMS|INF)\b[-\/ ]*/g, " ")
       .replace(/[^A-Z& ]+/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter(w => w.length >= 3 && !/^(DR|CR|TO|FROM|THE|AND|PVT|LTD|INDIA|BANK|TRANSFER|PAYMENT|CHARGES?)$/.test(w));
  return words.slice(0, 3).join(" ");
}
function ruleFromRow(row){
  const b = B(), co = CO(b.cid);
  const text = steadyPart(row.narr) || (row.dec.name || "").toUpperCase().slice(0, 20);
  return newRule({
    name: (row.dec.name || text || "New rule").slice(0, 40),
    when: {text: [{op: "has", v: text}], dir: row.debit ? "out" : "in", amtMin: "", amtMax: "", modes: [], acNo: "", account: "any", from: "", to: ""},
    then: {action: "set", ledger: exactLedger(row.ledger) || "", kind: "", vtype: "", tdsNature: "", tdsAtPay: false, splits: [], narr: "", ready: true}
  });
}
/* ---------- rules the app works out for you ---------- */
// group past decisions by their steady wording, and propose a rule where the choice was consistent
function suggestRules(){
  const b = B(), co = CO(b.cid);
  const groups = new Map();
  Object.values((b.hist && b.hist.rows) || {}).forEach(h => {
    if (!h || !h.l) return;
    const text = steadyPart(h.n || h.t || "");
    if (!text || text.length < 3) return;
    const key = text + "|" + (h.d || "any");
    const g = groups.get(key) || {text, dir: h.d || "any", n: 0, leds: {}, sample: h.n || h.t || ""};
    g.n++; g.leds[h.l] = (g.leds[h.l] || 0) + 1;
    groups.set(key, g);
  });
  // words too general to be a rule on their own
  const TOO_BROAD = /^(gst|tax|tds|upi|neft|rtgs|imps|ach|chq|cash|bank|charges?|payment|transfer|credit|debit|interest|fee|emi|loan|salary|refund|reversal|misc|other)$/i;
  const out = [];
  groups.forEach(g => {
    const words = g.text.split(" ").filter(Boolean);
    if (words.length === 1 && (TOO_BROAD.test(words[0]) || words[0].length < 5)) return;   // one common word is not a rule
    const best = Object.entries(g.leds).sort((a, c) => c[1] - a[1])[0];
    if (!best) return;
    const [ledger, hits] = best;
    if (g.n < 3) return;                                   // seen at least three times
    if (hits / g.n < 0.8) return;                          // and the choice was consistent
    if (!exactLedger(ledger)) return;                      // and that ledger is really in Tally
    const probe = {narr: g.text, ref: "", date: "", debit: g.dir === "out" ? 1 : 0, credit: g.dir === "in" ? 1 : 0, dec: {name: g.sample, mode: ""}};
    if (matchRule(probe, co, null)) return;                // a rule already covers this
    out.push({text: g.text, dir: g.dir, ledger: exactLedger(ledger), n: g.n, agree: Math.round(hits / g.n * 100), sample: g.sample});
  });
  return out.sort((a, c) => c.n - a.n).slice(0, 25);
}
function viewSuggestions(){
  const list = S.ruleSuggest;
  if (!list) return '<div class="row" style="margin-top:10px"><button class="btn small" data-act="ruleFind">Look for rules in what we have done before</button></div>';
  if (!list.length) return '<p class="note" style="margin-top:10px">Nothing worth a rule yet \u2014 the same wording has to be booked to the same ledger at least three times. <button class="linkbtn" data-act="ruleFindClose">Hide</button></p>';
  return '<div class="bdiag" style="margin-top:12px"><b>' + list.length + " rule" + (list.length === 1 ? "" : "s") + " we can make from what you have already done</b>" +
    '<div class="tblwrap" style="margin-top:6px"><table class="data"><thead><tr><th class="ck"><input type="checkbox" data-sugall checked></th><th>When the line says</th><th>Money</th><th>Use this ledger</th><th class="n">Done before</th></tr></thead><tbody>' +
    list.map((s, i) => '<tr><td class="ck"><input type="checkbox" data-sug="' + i + '"' + (s.off ? "" : " checked") + "></td>" +
      "<td><b>" + esc(s.text) + '</b><div class="nr">' + esc(String(s.sample).slice(0, 60)) + "</div></td>" +
      "<td>" + (s.dir === "out" ? "going out" : s.dir === "in" ? "coming in" : "either") + "</td>" +
      "<td>" + esc(s.ledger) + "</td>" +
      '<td class="n">' + s.n + " times" + (s.agree < 100 ? '<div class="nr">' + s.agree + "% the same</div>" : "") + "</td></tr>").join("") +
    '</tbody></table></div><div class="row" style="margin-top:8px"><button class="btn small primary" data-act="ruleMakeSug">Make the ticked rules</button><button class="btn small" data-act="ruleFindClose">Not now</button></div></div>';
}
/* ---------- the same rules for your other clients ---------- */
async function copyRulesTo(rules){
  if (!rules.length){ toast("Choose at least one rule."); return; }
  const others = Object.values(S.companies).filter(c => c.id !== S.bank.cid).sort((a, b2) => a.name.localeCompare(b2.name));
  if (!others.length){ toast("There is only one client at the moment."); return; }
  const fixed = rules.filter(r => r.then.ledger && !r.then.kind).length;
  const ans = await askConfirm({title: "Copy " + rules.length + " rule" + (rules.length === 1 ? "" : "s") + " to other clients", ok: "Copy the rules", wide: true,
    body: (fixed ? '<p class="bk-warn">' + fixed + " of these name a ledger directly. In a client whose Tally has no ledger of that name, matching lines will simply wait in To review \u2014 nothing wrong is posted.</p>" : "") +
      '<p class="note">Rules are added at the top of each client\u2019s list. Nothing already decided is changed.</p>' +
      '<div class="row" style="margin:6px 0"><button class="btn small" type="button" id="cpAll">Tick all</button><button class="btn small" type="button" id="cpNone">Untick all</button></div>' +
      '<div style="max-height:320px;overflow:auto;border:1px solid var(--rule);border-radius:8px;padding:8px">' +
      others.map(c => '<label class="chk"><input type="checkbox" class="cpCo" value="' + c.id + '"> ' + esc(c.name) + "</label>").join("") + "</div>",
    onReady: box => {
      const set = v => box.querySelectorAll(".cpCo").forEach(x => { x.checked = v; });
      const a = box.querySelector("#cpAll"), n = box.querySelector("#cpNone");
      if (a) a.onclick = () => set(true);
      if (n) n.onclick = () => set(false);
    },
    read: () => ({ids: Array.from(document.querySelectorAll(".cpCo")).filter(x => x.checked).map(x => x.value)})});
  if (!ans) return;
  const ids = ans.data.ids;
  if (!ids.length){ toast("No client was ticked."); return; }
  let done = 0;
  for (const cid of ids){
    const have = (await BankDB.get("wrules:" + cid)) || [];
    const copies = rules.map(r => Object.assign(JSON.parse(JSON.stringify(r)), {id: uid("rl"), scope: "client", stats: {used: 0, over: 0, lastAt: ""}, copiedFrom: CO(S.bank.cid).name}));
    await BankDB.set("wrules:" + cid, copies.concat(have));
    done++;
  }
  toast(rules.length + " rule" + (rules.length === 1 ? "" : "s") + " copied to " + done + " client" + (done === 1 ? "" : "s") + ".");
  render();
}

/* ---------- the rules screen ---------- */
function viewRulesPanel(){
  const b = B(), co = CO(b.cid);
  const mine = clientRules(), firm = firmRules();
  const line = (r, i, scope) => {
    const p = rulePreview(r);
    const led = ruleLedger(r, co);
    const bad = r.then.action !== "ignore" && led && !exactLedger(led);
    return '<tr' + (r.off ? ' class="off"' : "") + '><td class="ord">' +
      (scope === "client" ? '<button class="icon" data-rmove="up" data-rid="' + r.id + '" title="Move up">\u2191</button><button class="icon" data-rmove="down" data-rid="' + r.id + '" title="Move down">\u2193</button>' : "") + "</td>" +
      "<td><b>" + esc(ruleLabel(r)) + "</b>" + (r.off ? ' <span class="tag no">off</span>' : "") +
        '<div class="nr">' + esc(ruleWhenText(r)) + "</div></td>" +
      "<td>" + (r.then.action === "ignore" ? '<span class="tag">set aside</span>' :
        (bad ? '<span class="tag bad">' + esc(led) + " not in Tally</span>" : esc(led || "\u2014")) +
        ((r.then.splits || []).length ? '<div class="nr">split into ' + ((r.then.splits || []).length + 1) + " lines</div>" : "") +
        (r.then.ready ? "" : '<div class="nr">shown for checking, not auto-ready</div>')) + "</td>" +
      '<td class="n">' + (p.n ? "<b>" + p.n + "</b>" : "0") + '<div class="nr">now showing</div></td>' +
      '<td class="n">' + ((r.stats && r.stats.used) || 0) + ((r.stats && r.stats.over) ? '<div class="nr bad">' + r.stats.over + " changed by hand</div>" : "") + "</td>" +
      '<td style="white-space:nowrap"><button class="btn small" data-redit="' + r.id + '">Change</button> ' +
        '<button class="linkbtn" data-rtoggle="' + r.id + '">' + (r.off ? "Use" : "Pause") + "</button> " +
        (scope === "client" ? '<button class="linkbtn" data-rcopy="' + r.id + '">Copy to\u2026</button> ' : "") +
        '<button class="linkbtn" data-rdel="' + r.id + '">Delete</button></td></tr>';
  };
  let h = '<section class="pane"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Rules</h2>' +
    '<div><button class="btn small primary" data-act="ruleNew">New rule</button><button class="btn small" data-act="ruleRunNow">Apply to this statement</button>' +
    (clientRules().length ? '<button class="btn small" data-act="ruleCopyAll">Copy to other clients</button>' : "") + "</div></div>" +
    '<p class="note" style="margin:6px 0 10px">Rules are read from the top down; the first one that fits wins. Your own choices are never overwritten by a rule.</p>';
  h += '<div class="tblwrap"><table class="data"><thead><tr><th></th><th>Rule</th><th>Does</th><th class="n">Matches</th><th class="n">Used</th><th></th></tr></thead><tbody>' +
    (mine.length ? mine.map((r, i) => line(r, i, "client")).join("") : '<tr><td colspan="6" class="nr">No rules for ' + esc(co.name) + " yet. Make one from any line, or press New rule.</td></tr>") +
    (firm.length ? '<tr><td colspan="6" style="background:var(--paper)"><b>Firm-wide rules</b> \u2014 used for every client, after this client\u2019s own rules</td></tr>' + firm.map((r, i) => line(r, i, "firm")).join("") : "") +
    "</tbody></table></div>";
  if (!firm.length) h += '<p class="note" style="margin-top:8px">Tip: bank charges, interest, salaries and the like are the same for every client. Make those firm-wide once.</p>';
  h += viewSuggestions();
  return h + "</section>";
}
function ruleWhenText(r){
  const w = r.when || {}, bits = [];
  (w.text || []).forEach(c => { if (String(c.v || "").trim()) bits.push({has: "contains", not: "does not contain", starts: "starts with", is: "is"}[c.op] + " \u201c" + c.v + "\u201d"); });
  if (w.dir === "out") bits.push("money out");
  if (w.dir === "in") bits.push("money in");
  if ((w.modes || []).length) bits.push(w.modes.join("/"));
  if (w.amtMin !== "" && w.amtMin != null) bits.push("at least " + INR.format(num(w.amtMin)));
  if (w.amtMax !== "" && w.amtMax != null) bits.push("at most " + INR.format(num(w.amtMax)));
  if (w.acNo) bits.push("account ending " + String(w.acNo).slice(-4));
  if (w.account && w.account !== "any") bits.push("one bank account only");
  if (w.from || w.to) bits.push("between " + (w.from ? fmtDate(w.from) : "start") + " and " + (w.to ? fmtDate(w.to) : "end"));
  return bits.join(" \u00b7 ") || "no conditions yet";
}
/* ---------- writing a rule ---------- */
async function openRuleEditor(rule, isNew){
  const b = B(), co = CO(b.cid);
  const accs = co.bankAccounts || [];
  const ledgers = (b.ledgers.list || []).map(l => l.name);
  const c0 = (rule.when.text || [])[0] || {op: "has", v: ""};
  const c1 = (rule.when.text || [])[1] || {op: "has", v: ""};
  const sp = (rule.then.splits || [])[0] || {ledger: "", pct: "", amt: ""};
  const body =
    '<div class="bk-form two"><label><span>Name this rule</span><input type="text" id="rlName" value="' + esc(rule.name) + '" placeholder="Bajaj loan EMI"></label>' +
    '<label><span>Where it applies</span><select id="rlScope"><option value="client"' + (rule.scope === "client" ? " selected" : "") + '>Only ' + esc(co.name) + '</option><option value="firm"' + (rule.scope === "firm" ? " selected" : "") + ">Every client (firm-wide)</option></select></label></div>" +
    '<h3 style="margin:12px 0 4px;font-size:15px">When the line\u2026</h3>' +
    '<div class="bk-form three"><label><span>Description</span><select id="rlOp0"><option value="has"' + (c0.op === "has" ? " selected" : "") + '>contains</option><option value="starts"' + (c0.op === "starts" ? " selected" : "") + '>starts with</option><option value="is"' + (c0.op === "is" ? " selected" : "") + '>is exactly</option><option value="not"' + (c0.op === "not" ? " selected" : "") + '>does not contain</option></select></label>' +
    '<label><span>These words</span><input type="text" id="rlV0" value="' + esc(c0.v) + '" placeholder="BAJAJFIN"></label>' +
    '<label><span>Money</span><select id="rlDir"><option value="any"' + (rule.when.dir === "any" ? " selected" : "") + '>either way</option><option value="out"' + (rule.when.dir === "out" ? " selected" : "") + '>going out</option><option value="in"' + (rule.when.dir === "in" ? " selected" : "") + '>coming in</option></select></label></div>' +
    '<div class="bk-form three" style="margin-top:6px"><label><span>And also (optional)</span><select id="rlOp1"><option value="has"' + (c1.op === "has" ? " selected" : "") + '>contains</option><option value="not"' + (c1.op === "not" ? " selected" : "") + '>does not contain</option></select></label>' +
    '<label><span>These words</span><input type="text" id="rlV1" value="' + esc(c1.v) + '"></label>' +
    '<label><span>Way of payment</span><select id="rlMode"><option value="">any</option>' + RULE_MODES.map(m => '<option value="' + m + '"' + ((rule.when.modes || [])[0] === m ? " selected" : "") + ">" + m + "</option>").join("") + "</select></label></div>" +
    '<div class="bk-form three" style="margin-top:6px"><label><span>Amount at least</span><input type="number" id="rlMin" value="' + esc(rule.when.amtMin) + '"></label>' +
    '<label><span>Amount at most</span><input type="number" id="rlMax" value="' + esc(rule.when.amtMax) + '"></label>' +
    '<label><span>Bank account</span><select id="rlAcc"><option value="any">all accounts</option>' + accs.map(a => '<option value="' + a.id + '"' + (rule.when.account === a.id ? " selected" : "") + ">" + esc(a.bank + (a.last4 ? " \u2026" + a.last4 : "")) + "</option>").join("") + "</select></label></div>" +
    '<h3 style="margin:12px 0 4px;font-size:15px">\u2026 then</h3>' +
    '<div class="bk-form three"><label><span>Do this</span><select id="rlAction"><option value="set"' + (rule.then.action === "set" ? " selected" : "") + '>use this ledger</option><option value="ignore"' + (rule.then.action === "ignore" ? " selected" : "") + '>set the line aside</option></select></label>' +
    '<label><span>Ledger (must exist in Tally)</span><input type="text" id="rlLedger" data-ac="1" autocomplete="off" value="' + esc(rule.then.ledger) + '" placeholder="start typing"></label>' +
    '<label><span>or a standard ledger</span><select id="rlKind"><option value="">\u2014</option>' + RULE_KINDS.map(([k, t]) => '<option value="' + k + '"' + (rule.then.kind === k ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></label></div>" +
    '<div class="bk-form three" style="margin-top:6px"><label><span>Split off (optional)</span><input type="text" id="rlSpLed" data-ac="1" autocomplete="off" value="' + esc(sp.ledger || "") + '" placeholder="Interest ledger"></label>' +
    '<label><span>\u2026 this much</span><input type="number" id="rlSpAmt" value="' + esc(sp.amt || "") + '" placeholder="fixed amount"></label>' +
    '<label><span>\u2026 or this %</span><input type="number" id="rlSpPct" value="' + esc(sp.pct || "") + '" placeholder="%"></label></div>' +
    '<div class="bk-form two" style="margin-top:6px"><label><span>Narration for Tally (optional)</span><input type="text" id="rlNarr" value="' + esc(rule.then.narr) + '" placeholder="Rent for {month}"></label>' +
    '<label><span>Voucher type</span><select id="rlVtype"><option value="">decide from the ledger</option>' + ["Payment", "Receipt", "Contra", "Journal"].map(v => '<option' + (rule.then.vtype === v ? " selected" : "") + ">" + v + "</option>").join("") + "</select></label></div>" +
    '<label class="chk" style="margin-top:8px"><input type="checkbox" id="rlReady"' + (rule.then.ready ? " checked" : "") + "> Mark matching lines ready to post (untick to have them shown for checking first)</label>" +
    '<div id="rlPreview" class="bdiag" style="margin-top:10px">Fill in the words above to see what this would match.</div>';
  const ans = await askConfirm({title: isNew ? "New rule" : "Change this rule", ok: isNew ? "Save the rule" : "Save changes", wide: true, body,
    onReady: () => { rulePreviewLive(); ["rlV0", "rlV1", "rlOp0", "rlOp1", "rlDir", "rlMode", "rlMin", "rlMax", "rlAcc"].forEach(id => {
      const el = document.getElementById(id); if (el){ el.addEventListener("input", rulePreviewLive); el.addEventListener("change", rulePreviewLive); } }); },
    read: () => readRuleForm(rule)});
  if (!ans) return null;
  return ans.data;
}
function readRuleForm(base){
  const g = id => (document.getElementById(id) || {}).value || "";
  const r = JSON.parse(JSON.stringify(base));
  r.name = g("rlName").trim();
  r.scope = g("rlScope") || "client";
  r.when.text = [{op: g("rlOp0") || "has", v: g("rlV0").trim()}, {op: g("rlOp1") || "has", v: g("rlV1").trim()}].filter(c => c.v);
  r.when.dir = g("rlDir") || "any";
  r.when.modes = g("rlMode") ? [g("rlMode")] : [];
  r.when.amtMin = g("rlMin"); r.when.amtMax = g("rlMax");
  r.when.account = g("rlAcc") || "any";
  r.then.action = g("rlAction") || "set";
  r.then.ledger = g("rlLedger").trim();
  r.then.kind = g("rlKind") || "";
  r.then.vtype = g("rlVtype") || "";
  r.then.narr = g("rlNarr").trim();
  r.then.ready = !!(document.getElementById("rlReady") || {}).checked;
  const spL = g("rlSpLed").trim(), spA = g("rlSpAmt"), spP = g("rlSpPct");
  r.then.splits = spL && (spA || spP) ? [{ledger: spL, amt: spA, pct: spP}] : [];
  if (!r.name) r.name = (r.when.text[0] || {}).v || "Rule";
  return r;
}
function rulePreviewLive(){
  const box = document.getElementById("rlPreview");
  if (!box) return;
  const r = readRuleForm(newRule());
  const p = rulePreview(r);
  if (!(r.when.text || []).length && !r.when.amtMin && !r.when.amtMax){ box.innerHTML = "Fill in the words above to see what this would match."; return; }
  box.innerHTML = "<b>Matches " + p.n + " of " + p.total + " lines</b> in the statement now open." +
    (p.rows.length ? "<ul style='margin:6px 0 0 18px'>" + p.rows.map(x => "<li>" + fmtDate(x.date) + " \u00b7 " + esc(x.narr.slice(0, 70)) + " \u00b7 " + INR.format(x.debit || x.credit) + "</li>").join("") + "</ul>" : "") +
    (p.n > 5 ? "<div class='nr'>\u2026 and " + (p.n - 5) + " more</div>" : "");
}
/* ---------- running the rules ---------- */
function runRules(rows, opts){
  const b = B(), co = CO(b.cid);
  const st = curStmt();
  const acc = st ? (co.bankAccounts || []).find(a => a.id === st.acctId) : null;
  let hit = 0;
  (rows || b.rows).forEach(r => {
    if (r.state === "sent" || r.state === "intally") return;
    if (r.userSet && !(opts && opts.force)) return;          // never overwrite a person's choice
    const rule = matchRule(r, co, acc);
    if (!rule) return;
    applyRule(rule, r, co, acc);
    hit++;
  });
  if (hit){ countRuleUse(rows || b.rows); saveBank({rows: true}); }
  return hit;
}

function suggestAll(rows, onlyOpen){
  const b = B(), co = CO(b.cid);
  const ledgerList = Array.from(knownLedgers().values()).filter(l => !l.pending);
  const ledgerExact = new Map();
  ledgerList.forEach(l => { const k = normName(l.name).replace(/ /g, ""); if (k && !ledgerExact.has(k)) ledgerExact.set(k, l); });
  const ruleMap = new Map();
  b.rules.forEach(r => ruleMap.set(r.key + "|" + r.dir, r));
  const acIndex = new Map();
  ledgerList.forEach(l => { const n = String(l.acNo || "").replace(/\D/g, "").replace(/^0+/, ""); if (n.length >= 8 && !BANK_GROUPS.test(l.group || "")) acIndex.set(n, l); });
  const partyCompact = ledgerList.filter(l => !BANK_GROUPS.test(l.group || "") && !/duties|taxes|capital|reserves|provisions|suspense/i.test(l.group || "")).map(l => ({l, c: normName(l.name).replace(/ /g, "")})).filter(x => x.c.length >= 4);
  const ctx = {co, hasList: hasLedgerList() || b.newLed.length > 0, rules: b.rules, ruleMap, bills: openBills(b.cid), taken: new Set(), ledgerList, ledgerExact, simCache: new Map(), acIndex, partyCompact, salesInvs: openSalesInvoices(), takenSales: new Set()};
  const stNow = curStmt();
  const accNow = stNow ? (co.bankAccounts || []).find(a => a.id === stNow.acctId) : null;
  rows.forEach(r => {
    if (onlyOpen && !["attention", "suggested"].includes(r.state)) return;
    if (r.userSet && exactLedger(r.ledger)) return;
    const rule = matchRule(r, co, accNow);          // a written rule beats every guess
    if (rule){ applyRule(rule, r, co, accNow); return; }
    r.ruleId = null; r.ruleNarr = "";
    const s = suggestRow(r, ctx);
    r.userSet = false;
    r.ledger = s.ledger; r.why = s.why; r.source = s.source; r.level = s.level; r.srcLabel = s.label || "";
    r.billId = s.billId || null; r.billRef = s.billRef || ""; r.tdsAtPay = s.tdsAtPay || 0; r.tdsLedger = s.tdsLedger || ""; r.salesIds = s.salesIds || null;
    r.vtype = s.ledger ? vtypeFor(r, s.ledger) : (r.debit ? "Payment" : "Receipt");
    r.state = s.level === "auto" && co.bankAuto !== false ? "ready" : s.level === "none" ? "attention" : "suggested";
  });
  countRuleUse(rows);
}
/* ---------- upload ---------- */
function isBankFile(f){ return /\.(xlsx|xls|xlsm|csv|txt|pdf|jpe?g|png|webp|heic)$/i.test(f.name) || /^image\//.test(f.type); }
async function uploadStatements(files, force){
  const b = B(); if (!b) return;
  const co = CO(b.cid);
  for (const file of files){
    b.lastFile = file;
    b.busy = "Reading " + file.name + "…"; render();
    try {
      const hash = await fileHash(file);
      if (b.stmts.some(s => s.hash === hash)){ toast(file.name + " was already uploaded."); continue; }
      const parsed = await readStatement(file, msg => { b.busy = file.name + ": " + msg; render(); }, force);
      if (!parsed.rows.length) throw {code: "bank_no_rows", diag: parsed.diag};
      if (!(await charge("bank", parsed.rows.length, file.name, parsed.rows.length + " statement lines"))){ b.busy = ""; render(); return; }
      const meta = parsed.meta;
      const chk = checkBalances(parsed.rows, meta);
      // which bank account of this client
      const last4 = meta.acct ? meta.acct.replace(/\D/g, "").slice(-4) : "";
      co.bankAccounts = co.bankAccounts || [];
      let acc = co.bankAccounts.find(a => (last4 && a.last4 === last4) && (!meta.ifsc || !a.ifsc || a.ifsc === meta.ifsc));
      let newAcc = false;
      if (!acc && last4){
        const owners = Object.values(S.companies).filter(c => c.id !== co.id && (c.bankAccounts || []).some(a => a.last4 === last4 && (!meta.ifsc || !a.ifsc || a.ifsc === meta.ifsc)));
        if (owners.length === 1){
          const moved = await fileStatementFor(owners[0], file, hash, parsed, chk, meta, last4);
          if (moved) b.moved = {cid: owners[0].id, name: owners[0].name, file: file.name, last4};
          continue;
        }
      }
      if (!acc){
        const bankLeds = (b.ledgers.list || []).filter(l => BANK_GROUPS.test(l.group || ""));
        const short = String(meta.bank || "").split(" ")[0].toLowerCase();
        const guess = bankLeds.filter(l => last4 && l.name.includes(last4)).concat(bankLeds.filter(l => short && l.name.toLowerCase().includes(short)));
        acc = {id: uid("ba"), bank: meta.bank || "Bank", last4, acct: meta.acct || "", ifsc: meta.ifsc || "", ledger: guess.length === 1 || (guess.length && last4 && guess[0].name.includes(last4)) ? guess[0].name : ""};
        co.bankAccounts.push(acc); newAcc = true; Store.saveCompany(co);
      }
      const other = Object.values(S.companies).find(c => c.id !== co.id && (c.bankAccounts || []).some(a => last4 && a.last4 === last4 && (!meta.ifsc || a.ifsc === meta.ifsc)));
      const sid = uid("st");
      let dupRows = 0;
      const rows = [];
      parsed.rows.forEach((r, i) => {
        const fp = [acc.id, r.date, r.debit, r.credit, r.balance === null ? "" : r.balance, normName(r.narr).slice(0, 30)].join("|");
        if (b.keys[fp]){ dupRows++; return; }
        b.keys[fp] = sid;
        rows.push(Object.assign(r, {id: sid + "-" + i, fp, dec: decodeNarr(r.narr, co.name), state: "attention", ledger: "", userSet: false}));
        if (r.repaired) r.fixedDir = false;
      });
      const from = rows.length ? rows[0].date : meta.from, to = rows.length ? rows[rows.length - 1].date : meta.to;
      const st = {id: sid, fileName: file.name, hash, bank: acc.bank, acctId: acc.id, acct: meta.acct || "", ifsc: meta.ifsc || "", from: meta.from || from, to: meta.to || to,
        opening: meta.opening, closing: meta.closing, n: rows.length, dupRows, badRows: chk.bad, fixedRows: chk.fixed, summaryOk: chk.summaryOk,
        totDr: chk.totDr, totCr: chk.totCr, source: parsed.source, method: parsed.method || "", uploadedAt: new Date().toISOString(), otherClient: other ? other.name : ""};
      b.stmts.push(st);
      b.cur = sid; b.rows = rows; b.sel.clear(); b.sticky.clear(); b.undo = null;
      suggestAll(rows);
      matchTallyBook(acc, rows);
      st.counts = countStates(rows);
      S.files["st:" + sid] = file; FileStore.put(b.cid, "st:" + sid, file); CloudDocs.add(b.cid, "st:" + sid, file, "stmt");
      await BankDB.set("stmt:" + b.cid + ":" + sid, rows);
      saveBank({stmts: true, keys: true});
      b.filter = "review";
      toast(file.name + ": " + rows.length + " transactions" + (dupRows ? ", " + dupRows + " already uploaded" : "") + (chk.bad ? ", " + chk.bad + " failing the balance check" : "") + "." + (newAcc && !acc.ledger ? " Choose the Tally ledger for this bank account." : ""));
    } catch (err){
      toast(file.name + ": " + bankErr(err));
      b.lastFail = {file: file.name, report: bankReport(Object.assign({diag: {file: file.name, size: file.size}}, err)), msg: bankErr(err), at: new Date().toISOString()};
    }
  }
  b.busy = ""; render();
  if (bridgeLive() && curStmt()) bankAutoSync(true);
}
// Keep a statement under the client that owns the bank account (it is matched when that client is opened)
async function fileStatementFor(owner, file, hash, parsed, chk, meta, last4){
  const cid = owner.id;
  const acc = (owner.bankAccounts || []).find(a => a.last4 === last4 && (!meta.ifsc || !a.ifsc || a.ifsc === meta.ifsc));
  const [stmts0, keys0] = await Promise.all([BankDB.get("stmts:" + cid), BankDB.get("keys:" + cid)]);
  const stmts = stmts0 || [], keys = keys0 || {};
  if (stmts.some(x => x.hash === hash)){ toast(file.name + " belongs to " + owner.name + " and is already there."); return false; }
  const sid = uid("st");
  let dupRows = 0;
  const rows = [];
  parsed.rows.forEach((r, i) => {
    const fp = [acc.id, r.date, r.debit, r.credit, r.balance === null ? "" : r.balance, normName(r.narr).slice(0, 30)].join("|");
    if (keys[fp]){ dupRows++; return; }
    keys[fp] = sid;
    rows.push(Object.assign(r, {id: sid + "-" + i, fp, dec: decodeNarr(r.narr, owner.name), state: "attention", ledger: "", userSet: false}));
  });
  const st = {id: sid, fileName: file.name, hash, bank: acc.bank, acctId: acc.id, acct: meta.acct || "", ifsc: meta.ifsc || "", from: meta.from || (rows[0] || {}).date, to: meta.to || (rows[rows.length - 1] || {}).date,
    opening: meta.opening, closing: meta.closing, n: rows.length, dupRows, badRows: chk.bad, fixedRows: chk.fixed, summaryOk: chk.summaryOk,
    totDr: chk.totDr, totCr: chk.totCr, source: parsed.source, method: parsed.method || "", uploadedAt: new Date().toISOString(), counts: {attention: rows.length}};
  stmts.push(st);
  S.files["st:" + sid] = file; FileStore.put(cid, "st:" + sid, file); CloudDocs.add(cid, "st:" + sid, file, "stmt");
  await BankDB.set("stmt:" + cid + ":" + sid, rows);
  await Promise.all([BankDB.set("stmts:" + cid, stmts), BankDB.set("keys:" + cid, keys)]);
  toast(file.name + " is for " + owner.name + " (account \u00b7\u00b7" + last4 + "), so it was filed there.");
  return true;
}
function bankErr(err){
  const code = (err && err.code) || "";
  return ({
    xlsx_missing: "the Excel reader did not load. Reload the app.",
    bank_no_header: "could not find the column headings (Date, Narration, Withdrawal/Deposit, Balance). Download the statement from net banking as Excel or CSV.",
    bank_no_rows: "no transactions found in this file.",
    bank_scanned: "this is a scanned PDF and the OCR could not read its table.",
    bank_unreadable: "no reader could find transactions with dates, amounts and balances. See \u201cWhy this file was not read\u201d on the Bank screen and send me that report.",
    bank_type: "this kind of file is not supported. Use Excel, CSV, PDF or a photo.",
    ocr_not_working: "the built-in OCR is not working in this browser (see Settings > Self-test).",
    ocr_no_positions: "this OCR engine cannot give word positions.",
    pdf_unavailable: "the PDF reader did not load. Reload the app.",
    pdf_password: "this PDF is password-protected. Open it once, save a copy without the password (Print > Save as PDF), and upload that.",
    pdf_broken: "this PDF could not be opened."
  })[code] || ("could not read the file" + (err && err.message ? " (" + err.message + ")" : "") + ".");
}
/* ---------- Tally: ledger list and bank book ---------- */
async function importLedgerList(file){
  const b = B(); if (!b) return;
  let list = [];
  try {
    if (/\.xml$/i.test(file.name) || /^\s*<\??(xml|envelope)/i.test(await file.slice(0, 200).text())){
      let text = await file.text();
      text = text.replace(/&#([0-9]+);/g, (m, n) => { const c = +n; return c < 32 && c !== 9 && c !== 10 && c !== 13 ? "" : m; });
      const doc = new DOMParser().parseFromString(text, "text/xml");
      doc.querySelectorAll("LEDGER").forEach(l => {
        const name = l.getAttribute("NAME") || (l.querySelector("NAME.LIST > NAME, NAME") || {}).textContent || "";
        const q = sel => { const n = l.querySelector(sel); return n ? n.textContent.trim() : ""; };
        if (name.trim()) list.push({name: name.trim(), group: q("PARENT"), pan: q("INCOMETAXNUMBER"), gstin: q("PARTYGSTIN") || q("GSTREGISTRATIONNUMBER")});
      });
      doc.querySelectorAll("GROUP").forEach(g => { const n = g.getAttribute("NAME"); if (n && TALLY_GROUPS.indexOf(n) < 0) TALLY_GROUPS.push(n); });
    } else {
      const grids = await gridsFromSheet(file);
      grids.forEach(grid => {
        let hi = -1, cName = 0, cGroup = -1, cPan = -1, cGst = -1, cAc = -1;
        for (let i = 0; i < Math.min(grid.length, 30); i++){
          const r = grid[i].map(cellText);
          const n = r.findIndex(x => /^(ledger\s*name|name(\s*of\s*ledger)?|particulars|ledger)$/i.test(x));
          if (n >= 0){ hi = i; cName = n; cGroup = r.findIndex(x => /^(under|group|parent|group\s*name)$/i.test(x)); cPan = r.findIndex(x => /pan|income\s*tax/i.test(x)); cGst = r.findIndex(x => /gstin|gst\s*(no|number|registration)/i.test(x)); cAc = r.findIndex(x => /a\/?c\s*no|account\s*(no|number)/i.test(x)); break; }
        }
        grid.slice(hi + 1).forEach(r => {
          const name = cellText(r[cName]);
          if (!name || /^(total|grand total|list of (ledgers|accounts))/i.test(name)) return;
          list.push({name, group: cGroup >= 0 ? cellText(r[cGroup]) : "", pan: cPan >= 0 ? cellText(r[cPan]) : "", gstin: cGst >= 0 ? cellText(r[cGst]) : "", acNo: cAc >= 0 ? cellText(r[cAc]) : ""});
        });
      });
    }
  } catch (e){ toast("Could not read the ledger list: " + ((e && e.message) || "unknown format")); return; }
  const seen = new Set();
  list = list.filter(l => { const k = l.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!list.length){ toast("No ledger names found in " + file.name + "."); return; }
  const groupSet = new Set(list.map(l => l.group).filter(Boolean));
  b.ledgers = {list, groups: Array.from(groupSet).sort(), importedAt: new Date().toISOString(), file: file.name};
  // pending ledgers that now exist in Tally are no longer pending
  b.newLed = b.newLed.filter(n => !seen.has(n.name.toLowerCase()));
  saveBank({ledgers: true, newLed: true});
  // choices that no longer match a Tally ledger go back to review
  b.rows.forEach(r => { if (["ready", "suggested"].includes(r.state) && r.ledger && !exactLedger(r.ledger)){ r.userSet = false; r.state = "attention"; } });
  suggestAll(b.rows, true); saveBank({rows: true});
  const mapped = autoMapCompanyLedgers(CO(b.cid));
  toast(list.length + " ledgers imported from Tally" + (mapped.length ? "; " + mapped.length + " default ledger names matched" : "") + ".");
  render();
}
async function importTallyBook(file){
  const b = B(), st = curStmt();
  if (!b || !st){ toast("Open a statement first."); return; }
  try {
    const grids = await gridsFromSheet(file);
    const entries = [];
    grids.forEach(grid => {
      let hi = -1, c = {};
      for (let i = 0; i < Math.min(grid.length, 40); i++){
        const r = grid[i].map(cellText);
        const di = r.findIndex(x => /^date$/i.test(x)), dr = r.findIndex(x => /^debit/i.test(x)), cr = r.findIndex(x => /^credit/i.test(x));
        if (di >= 0 && dr >= 0 && cr >= 0){ hi = i; c = {date: di, debit: dr, credit: cr, part: r.findIndex(x => /particulars/i.test(x)), vt: r.findIndex(x => /vch\s*type|voucher\s*type/i.test(x)), vn: r.findIndex(x => /vch\s*no|voucher\s*no/i.test(x))}; break; }
      }
      if (hi < 0) return;
      grid.slice(hi + 1).forEach(r => {
        const date = bankDate(r[c.date]); if (!date) return;
        const dr = bankAmount(r[c.debit]) || 0, cr = bankAmount(r[c.credit]) || 0;
        if (!dr && !cr) return;
        entries.push({date, debit: Math.abs(dr), credit: Math.abs(cr), party: c.part >= 0 ? cellText(r[c.part]) : "", vt: c.vt >= 0 ? cellText(r[c.vt]) : "", vn: c.vn >= 0 ? cellText(r[c.vn]) : ""});
      });
    });
    if (!entries.length){ toast("No vouchers found. In Tally open the bank ledger (Display > Account Books > Ledger), export it to Excel, and upload that file."); return; }
    b.books[st.acctId] = {entries, file: file.name, importedAt: new Date().toISOString()};
    saveBank({books: true});
    const acc = (CO(b.cid).bankAccounts || []).find(a => a.id === st.acctId);
    const n = matchTallyBook(acc, b.rows, true);
    saveBank({rows: true});
    toast(entries.length + " Tally vouchers read; " + n + " statement rows are already in Tally.");
    render();
  } catch (e){ toast("Could not read the Tally bank book: " + ((e && e.message) || "unknown format")); }
}
// In Tally's bank ledger, a debit is money in and a credit is money out.
function matchTallyBook(acc, rows, force){
  const b = B();
  let learnedFromTally = false;
  const book = acc && b.books[acc.id];
  if (!book) return 0;
  const used = new Set();
  if (force){
    // a fresh copy of the Tally ledger: match everything again (an entry deleted in Tally becomes open again)
    rows.forEach(r => { if (r.state === "intally"){ r.state = r.prevState && r.prevState !== "intally" ? r.prevState : (r.ledger ? "ready" : "attention"); delete r.tallyIdx; delete r.tallyHow; delete r.tallyRef; } });
  } else rows.forEach(r => { if (r.state === "intally" && r.tallyIdx !== undefined) used.add(r.tallyIdx); });
  const refOf = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  const days = (a1, b1) => Math.abs((new Date(a1) - new Date(b1)) / 864e5);
  let n = 0;
  const take = (r, i, how) => {
    used.add(i); n++;
    const t = book.entries[i];
    r.prevState = r.state; r.state = "intally"; r.tallyIdx = i; r.tallyHow = how;
    r.tallyRef = [t.vt, t.vn, t.party].filter(Boolean).join(" \u00b7 ");
    if (t.party && !/as per details|^\(|^opening|^closing/i.test(t.party) && b.hist){ b.hist.rows[r.fp] = histEntry(r, t.party, "tally"); b.histVer++; learnedFromTally = true; }
  };
  const open = () => rows.filter(r => r.state !== "intally" && r.state !== "sent");
  // 1. posted by TDS Desk before (tag in the narration)
  open().forEach(r => {
    const tag = "TDSDESK:" + fpHash(r.fp || r.id).toUpperCase();
    const i = book.entries.findIndex((t, k) => !used.has(k) && String(t.narr).toUpperCase().includes(tag));
    if (i >= 0) take(r, i, "posted by TDS Desk earlier");
  });
  // 2. same UTR / cheque number and amount, within 45 days
  open().forEach(r => {
    const refs = [r.dec.utr, r.dec.chq, r.ref].map(refOf).filter(x => x.length >= 6);
    if (!refs.length) return;
    const amt = r.debit || r.credit, out = !!r.debit;
    const i = book.entries.findIndex((t, k) => !used.has(k) && Math.abs((out ? t.credit : t.debit) - amt) <= 0.01 && days(t.date, r.date) <= 45 && refs.some(x => refOf(t.inst).includes(x) || x.includes(refOf(t.inst) || "#") || refOf(t.narr).includes(x)));
    if (i >= 0) take(r, i, "same reference number");
  });
  // 3. same amount on a nearby date (cheques 15 days, others 3)
  open().forEach(r => {
    const amt = r.debit || r.credit, out = !!r.debit;
    const win = r.dec.mode === "CHQ" ? 15 : 3;
    let best = -1, bestGap = 1e9;
    book.entries.forEach((t, i) => {
      if (used.has(i)) return;
      if (Math.abs((out ? t.credit : t.debit) - amt) > 0.01) return;
      const gap = days(t.date, r.date);
      if (gap > win) return;
      const g = gap - (r.dec.name && nameSim(r.dec.name, t.party) > 0.6 ? 2 : 0);
      if (g < bestGap){ bestGap = g; best = i; }
    });
    if (best >= 0) take(r, best, "same amount and date");
  });
  if (learnedFromTally) saveBank({hist: true});
  return n;
}
/* ---------- row actions ---------- */
function sameParty(a, b){
  if (a.dec.key === b.dec.key) return true;
  const pa = partyKey(a.dec), pb = partyKey(b.dec);
  if (!pa || !pb) return false;
  if (pa === pb) return true;
  // banks cut long names short: "RAZORPAYPAYMENTS PVTLTD A" is the start of "RAZORPAY PAYMENTS PVT LTD AGGREGATOR..."
  const [short, long] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  return short.length >= 17 && long.startsWith(short);
}
function rowSnapshot(r){ return {id: r.id, ledger: r.ledger, state: r.state, userSet: r.userSet, why: r.why, source: r.source, vtype: r.vtype, billId: r.billId, billRef: r.billRef, tdsAtPay: r.tdsAtPay}; }
// Set a ledger on some rows; every other open row of the same party follows, and a rule is kept for next time
function setLedgerFor(rows, ledger, how){
  const b = B(), co = CO(b.cid);
  ledger = String(ledger || "").trim();
  if (!ledger || !rows.length) return 0;
  const auto = co.bankAutoApply !== false;
  const touched = new Map();
  const put = (r, why) => {
    if (!touched.has(r.id)) touched.set(r.id, rowSnapshot(r));
    r.ledger = ledger; r.userSet = true; r.source = "you"; r.why = why;
    r.billId = null; r.billRef = ""; r.tdsAtPay = 0;
    r.vtype = vtypeFor(r, ledger); r.state = "ready";
    b.sticky.add(r.id);
  };
  rows.forEach(r => put(r, "set by you"));
  let others = 0;
  const ruleKeys = [];
  if (auto){
    const open = b.rows.filter(r => ["attention", "suggested", "ready"].includes(r.state) && !touched.has(r.id) && !(r.userSet && r.ledger && r.ledger !== ledger && r.state === "ready"));
    rows.forEach(src => {
      open.forEach(r => { if (!touched.has(r.id) && sameParty(src, r)){ put(r, "same party as a row you set"); others++; } });
      [src.dec.key, partyKey(src.dec)].filter(Boolean).forEach(k => { if (!ruleKeys.includes(k)) ruleKeys.push(k); });
    });
    const oldRules = b.rules.filter(x => ruleKeys.includes(x.key));
    b.rules = b.rules.filter(x => !ruleKeys.includes(x.key));
    ruleKeys.forEach(k => b.rules.push({key: k, dir: "any", ledger, auto: true, label: rows[0].dec.name || rows[0].dec.upi || k, at: new Date().toISOString()}));
    b.undo = {what: how || "set", ledger, label: rows.length > 1 ? entries(rows.length) : (rows[0].dec.name || rows[0].dec.upi || "This entry"), n: touched.size, others, snaps: Array.from(touched.values()), ruleKeys, oldRules};
    saveBank({rows: true, rules: true});
  } else {
    b.undo = {what: how || "set", ledger, label: rows.length + " rows", n: touched.size, others: 0, snaps: Array.from(touched.values()), ruleKeys: [], oldRules: []};
    saveBank({rows: true});
  }
  const byId = new Map(b.rows.map(r => [r.id, r]));
  b.undo.histPrev = learnRows(Array.from(touched.keys()).map(id => byId.get(id)).filter(Boolean), "you");
  return touched.size;
}
function setRowLedger(row, ledger){
  if (row && row.ruleId && exactLedger(ledger) !== row.ledger) noteOverride(row);
  if (!String(ledger || "").trim()){
    const b = B();
    b.undo = {what: "clear", label: row.dec.name || "this row", n: 1, others: 0, snaps: [rowSnapshot(row)], ruleKeys: [], oldRules: []};
    row.ledger = ""; row.userSet = false; row.state = "attention"; row.why = "";
    return;
  }
  setLedgerFor([row], ledger);
}
function undoBank(){
  const b = B(), u = b.undo; if (!u) return;
  const byId = new Map(b.rows.map(r => [r.id, r]));
  u.snaps.forEach(sn => { const r = byId.get(sn.id); if (r) Object.assign(r, sn); });
  if (u.histPrev) restoreHist(u.histPrev);
  if (u.restoreAllRules) b.rules = u.restoreAllRules;
  else if (u.ruleKeys && u.ruleKeys.length){ b.rules = b.rules.filter(x => !u.ruleKeys.includes(x.key)).concat(u.oldRules || []); }
  b.undo = null;
  saveBank({rows: true, rules: true});
  toast("Undone.");
}
function forgetUndoRule(){
  const b = B(), u = b.undo; if (!u) return;
  b.rules = b.rules.filter(x => !u.ruleKeys.includes(x.key)).concat(u.oldRules || []);
  u.ruleKeys = []; u.forgot = true;
  saveBank({rules: true});
}
// Multiple selection
function bankSelected(){ const b = B(); return b.rows.filter(r => b.sel.has(r.id)); }
function bulkAction(kind, ledger){
  const b = B(), rows = bankSelected();
  if (!rows.length) return;
  const snaps = rows.map(rowSnapshot);
  let n = 0, skipped = 0;
  if (kind === "ledger"){ n = setLedgerFor(rows.filter(r => !["sent"].includes(r.state)), ledger, "bulk"); }
  else {
    rows.forEach(r => {
      if (r.state === "sent"){ skipped++; return; }
      if (kind === "accept"){ if (r.ledger){ r.state = "ready"; n++; } else skipped++; }
      if (kind === "ignore"){ if (r.state !== "ignored"){ r.prevState = r.state; r.state = "ignored"; n++; } }
      if (kind === "restore"){ if (r.state === "ignored" || r.state === "intally"){ r.state = r.ledger ? "ready" : "attention"; delete r.tallyIdx; n++; } }
      b.sticky.add(r.id);
    });
    b.undo = {what: kind, label: entries(rows.length), n, others: 0, snaps, ruleKeys: [], oldRules: []};
    if (kind === "accept") b.undo.histPrev = learnRows(rows.filter(r => r.state === "ready"), "accepted");
    if (kind === "ignore") b.undo.histPrev = unlearnRows(rows.filter(r => r.state === "ignored"));
    saveBank({rows: true});
  }
  const verb = {accept: "accepted", ignore: "ignored", restore: "restored", ledger: "set to " + ledger}[kind];
  if (skipped) toast(skipped + " skipped" + (kind === "accept" ? " (no ledger yet)" : " (already posted)") + ".");
  b.sel.clear();
  render();
}
// set the same ledger on every row now on screen (after a search)
async function applyToVisible(ledger){
  const b = B(), rows = bankVisibleRows().filter(r => r.state !== "sent" && r.state !== "intally");
  const exact = exactLedger(ledger);
  if (!exact){ toast("\u201c" + ledger + "\u201d is not a ledger in Tally. Choose one from the list, or create it."); return; }
  if (!rows.length){ toast("No entries are showing."); return; }
  const a = await askConfirm({title: "Use \u201c" + exact + "\u201d for " + rows.length + " entries?", ok: "Set them all",
    body: '<p class="note">These are the entries now showing' + (b.q.trim() ? ' for \u201c' + esc(b.q.trim()) + '\u201d' : "") + ". Entries already sent to Tally are left alone.</p>"});
  if (!a) return;
  const before = rows.map(r => ({id: r.id, ledger: r.ledger, state: r.state, userSet: r.userSet}));
  rows.forEach(r => { r.ledger = exact; r.userSet = true; if (r.state === "attention" || r.state === "suggested") r.state = "ready"; });
  learnRows(rows, "set");
  b.undo = {what: "Set " + exact + " on " + rows.length + " entries", rows: before};
  saveBank({rows: true});
  toast(rows.length + " entries set to " + exact + ".");
  b.offerRule = {text: b.q.trim(), ledger: exact, n: rows.length, dir: rows.every(r => r.debit) ? "out" : rows.every(r => r.credit) ? "in" : "any"};
  render();
}
function bankColFilter(r){
  const f = B().f;
  if (!f) return true;
  const narr = String(r.narr || "").toLowerCase(), amt = num(r.debit || r.credit);
  if (f.narr){ const words = f.narr.toLowerCase().split(",").map(w => w.trim()).filter(Boolean); const hit = words.some(w => narr.includes(w)); if (f.narrNot ? hit : !hit) return false; }
  if (f.min !== "" && f.min != null && amt < num(f.min)) return false;
  if (f.max !== "" && f.max != null && amt > num(f.max)) return false;
  if ((f.wmin || f.wmax) && !num(r.debit)) return false;
  if (f.wmin && num(r.debit) < num(f.wmin)) return false;
  if (f.wmax && num(r.debit) > num(f.wmax)) return false;
  if ((f.dmin || f.dmax) && !num(r.credit)) return false;
  if (f.dmin && num(r.credit) < num(f.dmin)) return false;
  if (f.dmax && num(r.credit) > num(f.dmax)) return false;
  if (f.dir === "out" && !num(r.debit)) return false;
  if (f.dir === "in" && !num(r.credit)) return false;
  if (f.mode && (r.dec && r.dec.mode) !== f.mode) return false;
  if (f.modes && f.modes.length && !f.modes.includes(r.dec && r.dec.mode)) return false;
  if (f.leds && f.leds.length && !f.leds.includes(r.ledger)) return false;
  if (f.led === "none" && r.ledger) return false;
  if (f.led === "set" && !r.ledger) return false;
  if (f.ledText && !String(r.ledger || "").toLowerCase().includes(f.ledText.toLowerCase())) return false;
  return true;
}
function bankColFilterOn(){ const f = B().f; return !!(f && (f.narr || f.min || f.max || f.dir || f.mode || f.led || f.ledText || f.wmin || f.wmax || f.dmin || f.dmax || (f.modes && f.modes.length) || (f.leds && f.leds.length))); }
function inBankRange(r){ const b = B(); return (!b.from || r.date >= b.from) && (!b.to || r.date <= b.to) && bankColFilter(r); }
function bankRangeOn(){ const b = B(); return !!(b && (b.from || b.to || bankColFilterOn())); }
function bankRangeRows(){ const b = B(); return bankRangeOn() ? b.rows.filter(inBankRange) : b.rows; }
function bankVisibleRows(){
  const b = B();
  const q = b.q.trim().toLowerCase();
  const states = tabStates(bankTab());
  return b.rows.filter(r => inBankRange(r) && (!states || states.includes(r.state) || b.sticky.has(r.id)) && (!q || (r.narr + " " + r.ledger + " " + (r.debit || r.credit) + " " + (r.dec.name || "")).toLowerCase().includes(q)));
}
let bankLastClicked = null;
function bankToggle(cb, shift){
  const b = B(); if (!b) return;
  const id = cb.dataset.bsel;
  if (shift && bankLastClicked && bankLastClicked !== id){
    const vis = bankVisibleRows().slice(0, b.limit).map(r => r.id);
    const i = vis.indexOf(bankLastClicked), j = vis.indexOf(id);
    if (i >= 0 && j >= 0){ const [lo, hi] = i < j ? [i, j] : [j, i]; vis.slice(lo, hi + 1).forEach(x => { if (cb.checked) b.sel.add(x); else b.sel.delete(x); }); }
  } else if (cb.checked) b.sel.add(id); else b.sel.delete(id);
  bankLastClicked = id;
  bankLightRefresh();
}
// Update only the ticks and the bottom bar (no full redraw)
function bankLightRefresh(){
  const b = B();
  document.querySelectorAll("[data-bsel]").forEach(el => { const on = b.sel.has(el.dataset.bsel); if (el.checked !== on) el.checked = on; const tr = el.closest("tr"); if (tr) tr.classList.toggle("picked", on); });
  const all = document.querySelector("[data-bselall]");
  if (all){ const vis = bankVisibleRows(); const n = vis.filter(r => b.sel.has(r.id)).length; all.checked = n > 0 && n === vis.length; all.indeterminate = n > 0 && n < vis.length; }
  const bar = document.querySelector(".actionbar");
  const html = bankBar();
  if (bar && html){ const tmp = document.createElement("div"); tmp.innerHTML = html; bar.replaceWith(tmp.firstElementChild); }
}
async function askClaudeForLedgers(){
  const b = B();
  const todo = b.rows.filter(r => r.state === "attention").slice(0, 150);
  if (!todo.length){ toast("No rows need a ledger."); return; }
  if (!S.engine){ toast("Claude is not set up. Add a key in Settings."); return; }
  const names = Array.from(knownLedgers().values()).map(l => l.name).slice(0, 400);
  b.busy = "Asking Claude about " + todo.length + " rows…"; render();
  try {
    for (let i = 0; i < todo.length; i += 50){
      const batch = todo.slice(i, i + 50);
      const prompt = "You help an Indian chartered accountant book bank statement lines in Tally.\n" +
        "Client: " + CO(b.cid).name + ".\nExisting Tally ledgers (choose from these when one fits): " + JSON.stringify(names) + "\n" +
        "For each bank line choose one ledger from the list, spelt exactly as listed. If none fits, leave ledger empty.\n" +
        "Lines: " + JSON.stringify(batch.map((r, k) => ({i: k, date: r.date, narration: r.narr, withdrawal: r.debit || 0, deposit: r.credit || 0}))) + "\n" +
        'Reply with only JSON: {"items":[{"i":0,"ledger":"...","existing":true,"group":"","confidence":0.0,"reason":"..."}]}';
      const j = await claudeRead(prompt, [], false);
      (j.items || []).forEach(it => {
        const r = batch[it.i]; if (!r || !it.ledger) return;
        const l = exactLedger(String(it.ledger));
        if (!l) return;
        r.ledger = l; r.source = "claude"; r.level = "suggest"; r.srcLabel = "Claude";
        r.why = "Claude: " + (it.reason || "suggested");
        r.vtype = vtypeFor(r, r.ledger); r.state = "suggested";
      });
    }
    saveBank({rows: true});
    toast("Claude suggested ledgers. Check them and accept.");
  } catch (e){ toast("Claude could not suggest ledgers: " + errCopy(e && e.code)); }
  b.busy = ""; render();
}
// send a newly made ledger to Tally right away, so both sides match
async function pushNewLedger(name){
  const b = B(), co = CO(b.cid);
  const led = (b.newLed || []).find(l => l.name === name);
  if (!led || led.sent) return false;
  if (!bridgeLive(co)) return false;
  try {
    const j = await Bridge.call("/import", {company: Bridge.openFor(co).name, masters: [{id: "led:" + led.name, xml: ledgerMasterXml(led)}], vouchers: []}, 120000);
    const r = [].concat(j.results || [])[0];
    if (r && r.ok){
      led.sent = true; led.sentAt = new Date().toISOString();
      saveBank({newLed: true});
      await syncLedgersFromTally(true);
      toast("\u201c" + name + "\u201d created in Tally.");
      render();
      return true;
    }
    toast("Tally did not accept the new ledger: " + plainMsg(r && r.message));
  } catch (e){ toast("Could not create it in Tally now: " + e.message + ". It will go with the next posting."); }
  return false;
}
function createLedger(name, group, pan, gstin, acNo, ifsc){
  const b = B();
  name = name.trim();
  if (!name){ toast("Enter the ledger name."); return false; }
  const known = knownLedgers();
  const near = Array.from(known.values()).map(l => ({l, s: nameSim(l.name, name)})).filter(x => x.s >= 0.85 && x.l.name.toLowerCase() !== name.toLowerCase()).sort((a, b2) => b2.s - a.s)[0];
  if (known.has(name.toLowerCase()) && !known.get(name.toLowerCase()).pending){ toast("\u201c" + name + "\u201d already exists in Tally."); return false; }
  b.newLed = b.newLed.filter(l => l.name.toLowerCase() !== name.toLowerCase());
  b.newLed.push({name, group: group || "Sundry Creditors", pan: (pan || "").toUpperCase(), gstin: (gstin || "").toUpperCase(), acNo: acNo || "", ifsc: (ifsc || "").toUpperCase(), at: new Date().toISOString(), sent: false});
  saveBank({newLed: true});
  if (near) toast("Created. Note: \u201c" + near.l.name + "\u201d looks similar; make sure it is not the same party.");
  if (bridgeLive(CO(b.cid))) pushNewLedger(name);
  return true;
}
/* ---------- Tally XML ---------- */
function bankVoucherXml(row, acc, co){
  const vt = row.vtype || (row.debit ? "Payment" : "Receipt");
  const d = tallyDate(row.date), amt2 = n => r2(n).toFixed(2);
  const amount = row.debit || row.credit, out = !!row.debit;
  const tds = out && row.tdsAtPay ? r2(row.tdsAtPay) : 0;
  const party = tallyLedgerName(row.ledger);
  const narr = ((row.ruleNarr ? row.ruleNarr + " | " : "") + row.narr.slice(0, 400) + (row.billRef ? " | against " + row.billRef : "") + " | TDSDesk:" + fpHash(row.fp || row.id));
  const txType = row.dec.chq || row.dec.mode === "CHQ" ? "Cheque" : ["NEFT", "RTGS", "IMPS", "UPI"].includes(row.dec.mode) ? "e-Fund Transfer" : "Others";
  const inst = row.dec.chq || row.dec.utr || row.ref || "";
  const bankAlloc = sign => "<BANKALLOCATIONS.LIST>\n<DATE>" + d + "</DATE>\n<INSTRUMENTDATE>" + d + "</INSTRUMENTDATE>\n<TRANSACTIONTYPE>" + txType + "</TRANSACTIONTYPE>\n" +
    (inst ? "<INSTRUMENTNUMBER>" + xesc(inst) + "</INSTRUMENTNUMBER>\n" : "") + "<PAYMENTFAVOURING>" + xesc(party) + "</PAYMENTFAVOURING>\n<BANKERSDATE>" + d + "</BANKERSDATE>\n<AMOUNT>" + sign + amt2(amount) + "</AMOUNT>\n</BANKALLOCATIONS.LIST>\n";
  const line = (ledger, dr, value, extra) => "<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>" + xesc(tallyLedgerName(ledger)) + "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>" + (dr ? "Yes" : "No") + "</ISDEEMEDPOSITIVE>\n<AMOUNT>" + (dr ? "-" : "") + amt2(value) + "</AMOUNT>\n" + (extra || "") + "</ALLLEDGERENTRIES.LIST>\n";
  const billAlloc = (dr, value) => co.billwise && row.billRef && /sundry/i.test((knownLedgers().get(party.toLowerCase()) || {group: "Sundry Creditors"}).group || "Sundry Creditors")
    ? "<BILLALLOCATIONS.LIST>\n<NAME>" + xesc(row.billRef) + "</NAME>\n<BILLTYPE>Agst Ref</BILLTYPE>\n<AMOUNT>" + (dr ? "-" : "") + amt2(value) + "</AMOUNT>\n</BILLALLOCATIONS.LIST>\n" : "";
  let x = '<VOUCHER VCHTYPE="' + vt + '" ACTION="Create" OBJVIEW="Accounting Voucher View">\n<DATE>' + d + "</DATE>\n<EFFECTIVEDATE>" + d + "</EFFECTIVEDATE>\n<VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME>\n" +
    "<NARRATION>" + xesc(narr) + "</NARRATION>\n<PARTYLEDGERNAME>" + xesc(party) + "</PARTYLEDGERNAME>\n<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n<ISOPTIONAL>" + (co.bankOptional ? "Yes" : "No") + "</ISOPTIONAL>\n";
  const splits = (row.splits || []).filter(sp => sp.ledger && exactLedger(sp.ledger) && num(sp.amt) > 0);
  if (out && splits.length){
    splits.forEach(sp => { x += line(sp.ledger, true, num(sp.amt)); });
    x += line(acc.ledger, false, amount, bankAlloc(""));
    if (tds) x += line(row.tdsLedger || bankLedgers(co).tds, false, tds);
  } else if (!out && splits.length){
    x += line(acc.ledger, true, amount, bankAlloc("-"));
    splits.forEach(sp => { x += line(sp.ledger, false, num(sp.amt)); });
  } else if (out){
    x += line(party, true, amount + tds, billAlloc(true, amount + tds));
    x += line(acc.ledger, false, amount, bankAlloc(""));
    if (tds) x += line(row.tdsLedger || bankLedgers(co).tds, false, tds);
  } else {
    x += line(acc.ledger, true, amount, bankAlloc("-"));
    const invs = (row.salesIds || []).map(id => (B().salesRef || []).find(v => v.id === id)).filter(Boolean);
    const alloc = co.billwise && invs.length ? invs.map(v => "<BILLALLOCATIONS.LIST>\n<NAME>" + xesc(v.x.number) + "</NAME>\n<BILLTYPE>Agst Ref</BILLTYPE>\n<AMOUNT>" + amt2(num(v.x.total)) + "</AMOUNT>\n</BILLALLOCATIONS.LIST>\n").join("") : "";
    x += line(party, false, amount, alloc);
  }
  return x + "</VOUCHER>\n";
}
function ledgerMasterXml(l){
  const debtorCreditor = /sundry/i.test(l.group);
  return '<LEDGER NAME="' + xesc(l.name) + '" ACTION="Create">\n<NAME.LIST>\n<NAME>' + xesc(l.name) + "</NAME>\n</NAME.LIST>\n<PARENT>" + xesc(l.group) + "</PARENT>\n" +
    "<ISBILLWISEON>" + (debtorCreditor ? "Yes" : "No") + "</ISBILLWISEON>\n" +
    (l.pan ? "<INCOMETAXNUMBER>" + xesc(l.pan) + "</INCOMETAXNUMBER>\n" : "") +
    (l.gstin ? "<PARTYGSTIN>" + xesc(l.gstin) + "</PARTYGSTIN>\n<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n" : "") +
    (l.acNo ? "<PAYMENTDETAILS.LIST>\n<ACCOUNTNUMBER>" + xesc(l.acNo) + "</ACCOUNTNUMBER>\n" + (l.ifsc ? "<IFSCODE>" + xesc(l.ifsc) + "</IFSCODE>\n" : "") + "<PAYMENTFAVOURING>" + xesc(l.name) + "</PAYMENTFAVOURING>\n</PAYMENTDETAILS.LIST>\n" : "") +
    "</LEDGER>\n";
}
function markSalesReceived(r){
  if (!r.salesIds || !r.salesIds.length) return;
  const b = B(), list = b.salesRef || [];
  let changed = false;
  list.forEach(v => { if (r.salesIds.includes(v.id)){ v.receivedBy = r.id; v.receivedAt = r.date; changed = true; } });
  if (changed){ if (S.sales && S.sales.cid === b.cid) saveSales(); else BankDB.set("sales:" + b.cid, list); }
}
function bankExportProblems(rows){
  const probs = [];
  rows.forEach(r => {
    if (!r.ledger) probs.push(fmtDate(r.date) + ": no ledger");
    else if (!exactLedger(r.ledger)) probs.push(fmtDate(r.date) + ": \u201c" + r.ledger + "\u201d is not a Tally ledger");
  });
  return probs;
}
async function exportBankXml(){
  const b = B(), st = curStmt(), co = CO(b.cid);
  if (!st) return;
  const acc = (co.bankAccounts || []).find(a => a.id === st.acctId);
  const rows = b.rows.filter(r => r.state === "ready");
  if (!rows.length){ toast("No rows are ready. Accept suggestions or set ledgers first."); return; }
  if (!acc || !exactLedger(acc.ledger)){ toast("Choose the Tally ledger for this bank account first."); return; }
  acc.ledger = exactLedger(acc.ledger);
  const probs = bankExportProblems(rows);
  if (probs.length){ toast("Fix these first: " + probs.slice(0, 3).join("; ") + (probs.length > 3 ? " and " + (probs.length - 3) + " more" : "")); return; }
  const used = new Set(rows.map(r => r.ledger.toLowerCase()));
  const masters = b.newLed.filter(l => used.has(l.name.toLowerCase()));
  const sv = co.tallyName ? "<STATICVARIABLES><SVCURRENTCOMPANY>" + xesc(co.tallyName) + "</SVCURRENTCOMPANY></STATICVARIABLES>" : "";
  const wrap = (report, body) => "<ENVELOPE>\n<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n<BODY>\n<IMPORTDATA>\n<REQUESTDESC><REPORTNAME>" + report + "</REPORTNAME>" + sv + "</REQUESTDESC>\n<REQUESTDATA>\n" + body + "</REQUESTDATA>\n</IMPORTDATA>\n</BODY>\n</ENVELOPE>\n";
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  // Tally imports one envelope per file; masters go first inside the same request so they exist before the vouchers
  const body = masters.map(l => '<TALLYMESSAGE xmlns:UDF="TallyUDF">\n' + ledgerMasterXml(l) + "</TALLYMESSAGE>\n").join("") +
    rows.map(r => '<TALLYMESSAGE xmlns:UDF="TallyUDF">\n' + bankVoucherXml(r, acc, co) + "</TALLYMESSAGE>\n").join("");
  xml += wrap(masters.length ? "All Masters" : "Vouchers", body);
  const fname = "bank-" + (co.name || "client").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-" + (acc.last4 || "acct") + "-" + new Date().toISOString().slice(0, 10) + ".xml";
  const ok = await saveFile(fname, new Blob([xml], {type: "application/xml"}));
  if (!ok) return;
  const now = new Date().toISOString();
  rows.forEach(r => {
    r.state = "sent"; r.sentAt = now;
    if (r.billId && D(b.cid).entries[r.billId]){ const e = D(b.cid).entries[r.billId]; e.paidBy = r.id; Store.saveEntry(b.cid, e); }
    markSalesReceived(r);
  });
  masters.forEach(l => { l.sent = true; l.sentAt = now; });
  learnRows(rows, "sent");
  saveBank({rows: true, newLed: true});
  toast(rows.length + " entries" + (masters.length ? " and " + masters.length + " new ledgers" : "") + " saved to " + fname + ". Import it in Tally: Gateway > Import > Transactions (or Masters and Transactions).");
  render();
}
function exportBankCsv(){
  const b = B(), st = curStmt(), co = CO(b.cid);
  if (!st) return;
  const head = ["Date","Narration","Party (decoded)","Mode","Reference","Withdrawal","Deposit","Balance","Balance check","Ledger","Voucher type","Status","Why","Against bill","Tally voucher"];
  const rows = b.rows.map(r => [r.date, r.narr, r.dec.name, r.dec.mode, r.dec.utr || r.dec.chq || r.ref, r.debit || "", r.credit || "", r.balance, r.balOk === false ? "FAILED" : r.balOk ? "OK" : "",
    r.ledger, r.vtype, BANK_STATES[r.state] || r.state, r.why, r.billRef, r.tallyRef || ""]);
  saveFile("bank-" + (co.name || "client").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-" + st.from + "-to-" + st.to + ".csv", "\uFEFF" + [head].concat(rows).map(r => r.map(csvCell).join(",")).join("\r\n"));
}
/* ---------- screen ---------- */
/* ---------- the bank screen ---------- */
const BANK_TABS_EXTRA = [["rules", "Rules"]];
const BANK_TABS = [["review", "To review"], ["ready", "Ready"], ["done", "Done"]];
function tabStates(tab){ return tab === "ready" ? ["ready"] : tab === "done" ? ["sent", "intally", "ignored"] : tab === "all" ? null : ["attention", "suggested"]; }
function bankTab(){ const b = B(); return ["review", "ready", "done", "all", "rules"].includes(b.filter) ? b.filter : "review"; }
function tabCounts(rows){
  const c = countStates(rows);
  return {review: (c.attention || 0) + (c.suggested || 0), ready: c.ready || 0, done: (c.sent || 0) + (c.intally || 0) + (c.ignored || 0), attention: c.attention || 0, suggested: c.suggested || 0};
}
function plural(n, word){ return n + " " + word + (n === 1 ? "" : word.endsWith("y") ? "" : "s"); }
function entries(n){ return n + (n === 1 ? " entry" : " entries"); }
function shortDate(iso){
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return String(d.getDate()).padStart(2, "0") + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
}
function bkAmt(n){ return n ? INR.format(r2(n)) : ""; }
function accountFor(st){ const co = CO(B().cid); return (co.bankAccounts || []).find(a => a.id === st.acctId) || {}; }
function stmtLabel(st){
  const acc = accountFor(st);
  return (exactLedger(acc.ledger) || (st.bank + (acc.last4 ? " \u00b7\u00b7" + acc.last4 : ""))) + " \u2014 " + shortDate(st.from) + " to " + shortDate(st.to) + " " + String(st.to || "").slice(0, 4);
}
function ledgerOptions(selected, preferGroups){
  const list = Array.from(knownLedgers().values());
  const pref = preferGroups ? list.filter(l => preferGroups.test(l.group || "")) : [];
  const rest = list.filter(l => !pref.includes(l));
  const opt = l => '<option value="' + esc(l.name) + '"' + (selected && l.name === selected ? " selected" : "") + ">" + esc(l.name) + (l.pending ? " (new)" : "") + "</option>";
  return '<option value="">\u2014 Choose a Tally ledger \u2014</option>' +
    (pref.length ? '<optgroup label="' + esc(preferGroups === BANK_GROUPS ? "Bank and cash ledgers" : "Suggested") + '">' + pref.map(opt).join("") + "</optgroup><optgroup label=\"All ledgers\">" + rest.map(opt).join("") + "</optgroup>" : rest.map(opt).join(""));
}
const BANK_GROUPS = /bank accounts|bank od|cash-in-hand/i;

function viewBank(){
  const b = B(), co = CO();
  if (!b || b.cid !== co.id){ loadBank(co.id); return '<p class="note">Opening bank statements\u2026</p>'; }
  if (b.loading) return '<p class="note">Opening bank statements\u2026</p>';
  const st = curStmt();
  ensureFileInputs();
  let h = "";
  h += '<div class="bk">';
  if (BankDB.mode === "memory only" || BankDB.lost) h += '<div class="bk-alert bad">This browser is not keeping bank statements' + (BankDB.lost ? " (storage is full)" : "") + ". Create the Tally file before closing, or use Chrome.</div>";
  if (b.busy) h += busyCard("Working on the statement\u2026", b.busy, 0, 0);
  if (b.moved) h += '<div class="bk-alert"><b>' + esc(b.moved.file) + "</b> is a statement of " + esc(b.moved.name) + " (account \u00b7\u00b7" + esc(b.moved.last4) + "), so it was filed there. " +
    '<button class="linkbtn" data-act="bankOpenMoved">Open ' + esc(b.moved.name) + '</button> <button class="linkbtn" data-act="bankDismissMoved">Dismiss</button></div>';
  if (b.postReport) h += postReportHtml(b.postReport);
  h += fixBanner();
  if (b.lastFail) h += '<div class="bk-alert bad"><b>' + esc(b.lastFail.file) + " was not read.</b> " + esc(b.lastFail.msg) +
    '<div class="row" style="gap:8px;margin-top:8px"><span class="note">Read it again:</span>' +
    '<button class="btn small" data-act="bankRetryFree">Try again</button>' +
    '<button class="btn small" data-act="bankRetryGoogle"' + (googleReady() ? "" : " disabled title=\"Google OCR is not set up\"") + '>With Google OCR</button>' +
    '<button class="btn small primary" data-act="bankRetryClaude"' + (claudeReady() ? "" : " disabled title=\"Claude is not available here\"") + '>With Claude</button>' +
    '<button class="linkbtn" data-act="bankCopyReport">Copy details for support</button><button class="linkbtn" data-act="bankDismissFail">Dismiss</button></div><textarea id="bankReport" readonly hidden>' + esc(b.lastFail.report) + "</textarea></div>";
  // set-up steps
  if (!hasLedgerList()){
    if (bridgeLive(co)) h += '<div class="bk-setup"><div><b>Loading ledgers from Tally\u2026</b><div class="note">' + esc(Bridge.openFor(co).name) + " is open in Tally.</div></div></div>";
    else if (Bridge.on() && Bridge.up()) h += '<div class="bk-setup"><div><b>Open ' + esc(Bridge.tallyName(co)) + ' in TallyPrime</b><div class="note">Its ledgers load automatically once it is open. Or import the ledger list from a file.</div></div><button class="btn small" data-act="ledPick">Import from file</button></div>';
    else h += '<div class="bk-setup"><div><b>Import the Tally ledger list for ' + esc(co.name) + '</b><div class="note">Suggestions only use ledgers that exist in Tally. In Tally: Display More Reports \u2192 List of Accounts \u2192 Export (Excel or XML). With the Tally Bridge this happens automatically.</div></div><button class="btn primary small" data-act="ledPick">Import ledger list</button></div>';
  }
  if (!st){
    h += '<div class="bk-empty" id="bankDrop" data-act="bankPick" tabindex="0" role="button"><div class="bk-empty-ic">\u2912</div><h2>Upload a bank statement</h2>' +
      '<p class="note">Excel or CSV from net banking works best. E-statement PDFs, scanned PDFs and photos are also read. Every entry is checked against the running balance.</p>' +
      '<span class="btn primary">Choose files</span></div>';
    h += '<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn small" data-act="bankSettings">Settings</button></div>';
    h += "</div>" + (b.showSettings ? bankSettingsHtml() : "");
    return h;
  }
  const acc = accountFor(st);
  const accLedger = exactLedger(acc.ledger);
  const tc = tabCounts(bankRangeRows());
  // header
  h += '<div class="bk-head"><div class="bk-id">' +
    (b.stmts.length > 1 ? '<select class="bk-stmtsel" data-stmtsel aria-label="Statement">' + b.stmts.slice().reverse().map(s => '<option value="' + s.id + '"' + (s.id === b.cur ? " selected" : "") + ">" + esc(stmtLabel(s)) + "</option>").join("") + "</select>"
      : '<h2 class="bk-title">' + esc(accLedger || st.bank) + "</h2>") +
    '<div class="bk-sub">' + esc(st.bank) + (st.acct ? " \u00b7 A/c " + esc(st.acct) : "") + " \u00b7 " + fmtDate(st.from) + " to " + fmtDate(st.to) + " \u00b7 " + b.rows.length + " entries</div></div>" +
    '<dl class="bk-figs"><div><dt>Opening</dt><dd>' + (st.opening !== undefined ? INR.format(st.opening) : "\u2014") + '</dd></div><div><dt>Withdrawals</dt><dd>' + INR.format(st.totDr || 0) + '</dd></div><div><dt>Deposits</dt><dd>' + INR.format(st.totCr || 0) + '</dd></div><div><dt>Closing</dt><dd>' + (st.closing !== undefined ? INR.format(st.closing) : "\u2014") + "</dd></div></dl>" +
    '<div class="bk-actions"><button class="btn small" data-act="bankPick">Upload statement</button><button class="btn small" data-act="bankSettings">Settings</button>' +
    '<details class="bk-menu"><summary class="btn small">More</summary><div class="bk-menu-list">' +
      (Bridge.on() && Bridge.up() ? '<button data-act="dupFind">Find double entries in Tally</button><button data-act="bankCheckTally">Check Tally for entries already there</button><button data-act="bankSync">Refresh ledgers from Tally</button><button data-act="bankFile">Create Tally file instead</button>' : '<button data-act="bookPick">Match with Tally bank book</button>') +
      '<button data-act="bankCsv">Download as Excel (CSV)</button>' +
      (S.engine && tc.attention ? '<button data-act="bankClaude">Ask Claude for the remaining entries</button>' : "") +
      '<button data-act="bankClearStmt">Clear all decisions</button>' +
      '<button class="danger" data-act="bankDelStmt">Delete this statement</button></div></details></div></div>';
  const repaired = b.rows.filter(r => r.repaired).length;
  h += '<div class="bk-check">' + (st.badRows ? '<span class="bad">\u2716 ' + st.badRows + " entries do not agree with the running balance \u2014 check them before posting</span>"
      : '<span class="ok">\u2714 Balances verified' + (st.summaryOk ? ": opening + deposits \u2212 withdrawals = closing" : "") + "</span>") +
    (repaired ? ' <span class="warn">\u00b7 ' + repaired + " amounts were read from the balance change (marked \u2248)</span>" : "") +
    (st.dupRows ? ' <span class="muted">\u00b7 ' + st.dupRows + " entries skipped (already uploaded)</span>" : "") +
    (b.books[st.acctId] ? ' <span class="muted">\u00b7 ' + (b.books[st.acctId].live ? "Checked against Tally " + new Date(b.books[st.acctId].importedAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : "Matched with the Tally bank book") + "</span>" : "") + "</div>";
  if (!accLedger) h += '<div class="bk-setup"><div><b>Which Tally ledger is this bank account?</b><div class="note">' + esc(st.bank) + (acc.last4 ? " \u00b7\u00b7" + esc(acc.last4) : "") + (acc.ifsc ? " \u00b7 " + esc(acc.ifsc) : "") + "</div></div>" +
    (hasLedgerList() ? '<select data-bankacc="' + acc.id + '">' + ledgerOptions("", BANK_GROUPS) + "</select>" : '<span class="note">Import the ledger list first.</span>') + "</div>";
  // tabs
  const tab = bankTab();
  h += '<div class="bk-bar"><div class="bk-tabs" role="tablist">' + BANK_TABS.concat([]).map(([k, t]) => '<button role="tab" aria-selected="' + (tab === k) + '" data-btab="' + k + '">' + t + ' <span class="cnt">' + tc[k] + "</span></button>").join("") +
    '<button role="tab" aria-selected="' + (tab === "rules") + '" data-btab="rules">Rules <span class="cnt">' + allRules().length + "</span></button></div>" +
    (tab === "review" ? '<label class="bk-switch"><input type="checkbox" data-bgroup' + (b.grouped ? " checked" : "") + "> Group by party</label>" : "") +
    '<input type="search" class="bk-search" data-bankq data-fk="bankq" data-keeptyped autocomplete="off" placeholder="Search the description, party or amount" value="' + esc(b.q) + '"></div>';
  if (bankRangeOn()){
    const inR = bankRangeRows(), out = inR.reduce((a2, r) => a2 + num(r.debit), 0), inn = inR.reduce((a2, r) => a2 + num(r.credit), 0);
    h += colChipBar("bank", inR.length, b.rows.length + " lines", "out " + INR.format(r2(out)) + " \u00b7 in " + INR.format(r2(inn)));
  }
  h += dupFindHtml();
  if (b.offerRule){
    const o = b.offerRule;
    h += '<div class="bk-found" style="border-color:var(--ledger)"><b>Keep this as a rule?</b> Every future line containing \u201c' + esc(o.text) + '\u201d would go to <b>' + esc(o.ledger) + "</b> by itself." +
      ' <button class="btn small primary" data-act="ruleFromBulk">Yes, make the rule</button><button class="linkbtn" data-act="ruleNoThanks">No thanks</button></div>';
  }
  if (b.q.trim()){
    const hits = bankVisibleRows().filter(r => r.state !== "sent" && r.state !== "intally");
    h += '<div class="bk-found"><b>' + hits.length + "</b> entr" + (hits.length === 1 ? "y" : "ies") + ' match \u201c' + esc(b.q.trim()) + "\u201d" +
      (hits.length ? ' \u00b7 <span class="muted">set them all to</span> <input type="text" class="bk-allled" data-allled data-fk="allled" data-ac="1" autocomplete="off" placeholder="a ledger from Tally" value="' + esc(b.allLed || "") + '">' +
        '<button class="btn small primary" data-act="bankApplyAll">Set all ' + hits.length + "</button>" : "") +
      ' <button class="linkbtn" data-act="bankClearSearch">Clear</button></div>';
  }
  if (tab === "rules") h += viewRulesPanel();
  else if (tab === "review" && b.grouped) h += viewBankGroups();
  else h += bankTable(tab);
  h += "</div>";
  if (b.showSettings) h += bankSettingsHtml();
  return h;
}
