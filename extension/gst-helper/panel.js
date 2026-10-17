/* FinCom GST helper: the side panel. It shows FinCom's figures for the return chosen in FinCom, runs the steps one after
 * another in the person's portal tab (content.js does each step on the page), compares what the portal shows with
 * FinCom's figures to the paisa, and sends each step's result back to FinCom. The last step is always the person's. */
"use strict";
const R = self.GSTH_RULES, SEL = self.GSTH_SEL, P = SEL.pages;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sess = chrome.storage.session;
const getS = async (k) => (await sess.get(k))[k];
const setS = (k, v) => sess.set({ [k]: v });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORM_LABEL = { R1: "GSTR-1", IFF: "IFF", "3B": "GSTR-3B", "2B": "GSTR-2B download", LEDGER: "Cash and credit ledgers", STATUS: "Return status and ARN" };
const FORM_PORTAL = { R1: "GSTR1", IFF: "IFF", "3B": "GSTR3B" };
let job = null, run = null, busy = false;

class Stop extends Error {}

/* ---------- the portal tab ---------- */
async function tab() {
  if (!job || !job.tabId) return null;
  return chrome.tabs.get(job.tabId).catch(() => null);
}
// The portal refuses a returns / payment page opened by its address ("Access Denied", the owner's report of
// 17-Oct-2026): the helper never moves the tab by an address. It waits while the login page is open (never touching
// it), and goes to a page through the portal's own menu.
const DENIED = "The portal wants to be opened from its own menu. Click ‘Click here to Login’ / the Home logo on the portal; once you are on the portal's home page, press Run again — the helper goes through RETURN DASHBOARD.";
class Denied extends Stop {}
const LOGIN_RE = new RegExp(P.login.match);
async function pageNow(t) {
  if (!t || t.status !== "complete") return "";
  if (LOGIN_RE.test(t.url || "")) return "login";
  try { const r = await chrome.tabs.sendMessage(t.id, { cmd: "ping" }); return r && r.ok ? (r.page || "other") : ""; } catch (e) { return ""; }
}
async function waitPage(pageKey, ms) {
  const end = Date.now() + (ms || 30000);
  for (;;) {
    const t = await tab(), pg = await pageNow(t);
    if (pg === "denied") throw new Denied(DENIED);
    if (pg === pageKey) return t;
    if (Date.now() > end) throw new Stop("The portal page “" + pageKey + "” did not open in the portal tab" + (t ? " (it shows " + (t.url || "").split("?")[0] + ")" : "") + ". If the portal logged you out, log in again and run this step again.");
    await sleep(250);
  }
}
// to the returns dashboard, the return status or a ledger: through the portal's menu (or the home page's RETURN DASHBOARD)
async function goTo(pageKey) {
  const t = await tab();
  if (!t) throw new Stop("The portal tab is not open. Press Run on the first step.");
  const pg = await pageNow(t);
  if (pg === "denied") throw new Denied(DENIED);
  if (pg === "login" || !pg) throw new Stop("Log in to the portal first (the first step).");
  if (pg === pageKey) return t;
  const path = SEL.menu.paths[pageKey];
  if (!path) throw new Stop("The helper has no way through the portal's menu to “" + pageKey + "”.");
  const r = await chrome.tabs.sendMessage(t.id, { cmd: "menu", path });
  if (!r || (!r.ok && r.stop)) throw new Stop((r && r.message) || "The portal page did not answer.");
  return waitPage(pageKey);
}
async function on(pageKey, cmd) {
  const t = await waitPage(pageKey, 8000);
  const r = await chrome.tabs.sendMessage(t.id, cmd);
  if (!r) throw new Stop("The portal page did not answer. Reload the portal tab and run this step again.");
  if (!r.ok && r.stop) throw new Stop(r.message);
  return r;
}
async function saveJob() { const cur = (await getS("job")) || {}; await setS("job", Object.assign(cur, { tabId: job.tabId })); }

/* ---------- the steps of each return ---------- */
function stepsFor(j) {
  const s = [], add = (id, label, fn, you) => s.push({ id, label, fn, you });
  add("login", "Log in to the portal: you type the captcha (and the OTP if asked)", stepLogin);
  if (j.form === "R1" || j.form === "IFF") {
    const fin = R.tables1(j.r1json || {}), keys = Object.keys(fin);
    if (j.r1mode === "type") {
      add("period", "Choose " + j.fp + " on the returns dashboard and open " + FORM_LABEL[j.form], () => stepPeriod(j.form === "IFF" ? "iff" : "r1"));
      keys.forEach((k) => add("t_" + k, "Type table " + R.R1.find((x) => x[0] === k)[1] + " (" + fin[k].n + ")", () => stepTable(k)));
    } else {
      add("period", "Choose " + j.fp + " on the returns dashboard and open the offline upload", () => stepPeriod("r1Offline"));
      add("upload", "Upload FinCom's " + FORM_LABEL[j.form] + " file (every table, one file)", stepUpload);
      add("process", "Wait for the portal to process the file", stepProcess);
      add("open", "Open " + FORM_LABEL[j.form] + " online", () => stepPeriod(j.form === "IFF" ? "iff" : "r1"));
    }
    add("summary", "Generate the summary, read it back and compare table by table", stepR1Summary);
    add("file", "Go to the portal's File page (File with DSC) and stop there", stepOpenFile);
    add("you", "You: sign on the File page — FILE WITH DSC (companies and LLPs), or EVC. The helper reads the ARN.", null, true);
  } else if (j.form === "3B") {
    add("period", "Choose " + j.fp + " on the returns dashboard and open GSTR-3B", () => stepPeriod("r3b"));
    add("t31", "Type 3.1 (a) to (e)", () => step3b("t31", (b) => b.sec === "3.1"));
    add("t32", "Type 3.2 Inter-State supplies (" + R.rows32(j.r3bjson).length + " row(s))", step32);
    add("t4", "Type 4 A(1)-(5), B(1)-(2), D(1)-(2)", () => step3b("t4", (b) => b.sec === "4"));
    add("t5", "Type 5 exempt, nil and non-GST inward supplies", () => step3b("t5", (b) => b.sec === "5"));
    add("read", "Read 4(C), 3.1.1 and 5.1 as the portal works them out, and compare", step3bRead);
    add("save", "Save GSTR-3B on the portal (a draft)", () => on("gstr3b", { cmd: "r3bSave" }).then((r) => ({ message: r.message })));
    add("pay", "Proceed to payment: read the portal's tax payable and set-off, and compare", step3bPay);
    add("you", "You: Make payment / Post credit to ledger, then FILE GSTR-3B WITH DSC (companies and LLPs) or EVC. The helper reads the ARN.", null, true);
  } else if (j.form === "2B") {
    add("period", "Choose " + j.fp + " and open GSTR-2B", () => stepPeriod("r2b"));
    add("download", "Download the 2B JSON and bring it into FinCom", step2b);
  } else if (j.form === "LEDGER") {
    add("cash", "Read the electronic cash ledger", () => stepLedger("cashLedger"));
    add("credit", "Read the electronic credit ledger", () => stepLedger("creditLedger"));
  } else if (j.form === "STATUS") {
    add("status", "Read the return's status and ARN", stepStatus);
  }
  return s;
}

async function stepLogin() {
  let t = await tab();
  if (!t) { const r = await chrome.runtime.sendMessage({ type: "showPortal" }); job.tabId = r.tabId; await saveJob(); }
  const end = Date.now() + 10 * 60000;
  for (;;) {
    t = await tab();
    if (!t) throw new Stop("The portal tab was closed.");
    const pg = await pageNow(t);
    if (pg === "denied") throw new Denied(DENIED);
    if (pg && pg !== "login") return { message: "Logged in." };
    // the login page (or a page still loading): never touched; the person types the captcha and presses LOGIN
    setMsg("login", "Waiting for you to log in on the portal tab (type the captcha, and the OTP if asked). The helper does not touch that tab until you are in.");
    if (Date.now() > end) throw new Stop("Not logged in after 10 minutes. Log in on the portal and run this step again.");
    await sleep(500);
  }
}
async function stepPeriod(go) {
  await goTo("dashboard");
  const r = await on("dashboard", { cmd: "dashboard", ym: job.ym, go });
  const target = go === "r3b" ? "gstr3b" : go === "r2b" ? "gstr2b" : go === "r1Offline" ? "upload" : "gstr1";
  await waitPage(target, 30000);
  return { message: r.message };
}
async function stepUpload() {
  const name = (job.form === "IFF" ? "IFF_" : "GSTR1_") + job.gstin + "_" + job.fp + ".json";
  const r = await on("upload", { cmd: "upload", json: job.r1json, name });
  return { message: r.message };
}
async function stepProcess() {
  for (let i = 0; i < 24; i++) {
    const r = await on("upload", { cmd: "uploadStatus" });
    if (r.ok) return { message: r.message };
    if (/error/i.test(r.status || "")) throw new Stop(r.message);
    setMsg("process", r.message);
    await sleep(5000);
    // the upload history is read again by coming back to the upload page the portal's way (never a reload or an address)
    await stepPeriod("r1Offline");
  }
  throw new Stop("The portal has not finished processing the file in 2 minutes. Check the upload history on the portal and run this step again.");
}
async function stepTable(k) {
  const recs = R.records1(job.r1json, k);
  const r = await on("gstr1", { cmd: "r1Fill", table: k, records: recs });
  return { message: r.message };
}
async function stepR1Summary() {
  const fin = R.tables1(job.r1json);
  const r = await on("gstr1", { cmd: "r1Summary", tables: Object.keys(R.tables1(job.r1json)).concat(job.form === "IFF" ? [] : []) });
  const c = R.compare1(fin, r.portal);
  run.compare.r1 = c; await setS("run", run); drawCompare();
  return { message: c.agree ? "Every table agrees with FinCom: " + verdict(c) : c.differences.length + " figure(s) differ from FinCom by ₹1.00 or more: see the comparison below. Check them before filing.", differences: c.differences.length };
}
// after the comparison: the File page opened, never signed. Run by "Run all steps" it does not go on while a figure differs
// by Rs 1.00 or more; pressed by itself ("Run") it goes on, the person having looked.
async function stepOpenFile(auto) {
  const c = run.compare.r1;
  if (auto === true && c && !c.agree) throw new Stop(c.differences.length + " figure(s) differ from FinCom by ₹1.00 or more (see below). Check them; to go to the File page anyway, press Run on this step.");
  const r = await on("gstr1", { cmd: "r1OpenFile" });
  return { message: r.message };
}
async function step3b(tileKey, pick) {
  const boxes = R.fields3b(job.r3bjson).filter(pick);
  const r = await on("gstr3b", { cmd: "r3bFill", tile: tileKey, boxes });
  const c = R.compare(boxes, r.back);
  run.compare["typed_" + tileKey] = c; await setS("run", run);
  if (c.rows.some((x) => !x.ok)) throw new Stop("The portal shows different figures from those typed in " + tileKey + ": " + c.differences.map((d) => d.label + " " + d.portal).join("; "));
  return { message: boxes.length + " box(es) typed and read back to the paisa." };
}
async function step32() {
  const rows = R.rows32(job.r3bjson);
  if (!rows.length) return { message: "No inter-State supplies to unregistered persons in FinCom: nothing typed." };
  const r = await on("gstr3b", { cmd: "r3b32", rows });
  const exp = []; rows.forEach((x) => { exp.push({ key: "3.2." + x.kind + "." + x.pos + ".txval", label: "3.2 " + x.pos + " taxable", value: x.txval }); exp.push({ key: "3.2." + x.kind + "." + x.pos + ".iamt", label: "3.2 " + x.pos + " IGST", value: x.iamt }); });
  const c = R.compare(exp, r.back);
  if (c.rows.some((x) => !x.ok)) throw new Stop("3.2 read back differs: " + c.differences.map((d) => d.label).join(", "));
  return { message: rows.length + " row(s) typed and read back." };
}
async function step3bRead() {
  const r = await on("gstr3b", { cmd: "r3bRead" });
  const c = R.compare(R.net4c(job.r3bjson), r.got);
  const g = r.got, p = (k) => R.paise(g[k]);
  const eco = ["3.1.1i.txval", "3.1.1i.iamt", "3.1.1ii.txval"].filter((k) => p(k));
  const interest = (p("5.1.int.iamt") + p("5.1.int.camt") + p("5.1.int.samt") + p("5.1.int.csamt")) / 100, fee = (p("5.1.fee.camt") + p("5.1.fee.samt")) / 100;
  run.compare.r3b4c = c; run.portal51 = { interest, fee, got: g }; await setS("run", run); drawCompare();
  const notes = [c.agree ? "4(C) net ITC agrees with FinCom to the paisa." : "4(C) net ITC differs from FinCom: see below."];
  notes.push("5.1 as the portal works it out: interest " + R.money(Math.round(interest * 100)) + ", late fee " + R.money(Math.round(fee * 100)) + " (sent to FinCom as the portal's figures).");
  if (eco.length) notes.push("3.1.1 (section 9(5)) shows figures on the portal that FinCom does not work out: check them.");
  return { message: notes.join(" "), differences: c.differences.length };
}
async function step3bPay() {
  const rows = R.setoffRows(job.pay);
  const r = await on("gstr3b", { cmd: "r3bPayment", keys: rows.map((x) => x.key) });
  const c = R.compare(rows, r.got);
  run.compare.pay = c; await setS("run", run); drawCompare();
  const cash = c.rows.filter((x) => /^pay\.(cash|liab)/.test(x.key)), cashOk = cash.every((x) => x.status !== "differs");
  return { message: (c.agree ? "Tax payable, credit used and cash agree with FinCom to the paisa." : (cashOk ? "Tax payable and cash agree; the portal uses credit differently from FinCom's set-off: see below." : "The portal's tax payable or cash differs from FinCom: see below. Check before paying.")), differences: c.differences.length };
}
async function step2b() {
  const r = await on("gstr2b", { cmd: "r2bDownload" });
  if (!r.ok) throw new Stop(r.message);
  await chrome.runtime.sendMessage({ type: "toFincom", msg: { type: "twoB", jobId: job.id, gstin: job.gstin, ym: job.ym, json: r.json } });
  return { message: "The 2B JSON was handed to FinCom's 2B import." };
}
async function stepLedger(which) {
  await goTo(which);
  const r = await on(which, { cmd: "ledger", which });
  run[which] = r.got; await setS("run", run);
  await chrome.runtime.sendMessage({ type: "toFincom", msg: { type: "ledger", jobId: job.id, gstin: job.gstin, ym: job.ym, which, got: r.got } });
  return { message: Object.entries(r.got).map(([k, v]) => k.toUpperCase() + " " + v).join(" · ") };
}
async function stepStatus() {
  await goTo("status");
  const want = FORM_PORTAL[job.of || "3B"] || "GSTR3B";
  const r = await on("status", { cmd: "status", form: want, period: job.fp });
  if (!r.ok) throw new Stop(r.message);
  run.arn = r.arn; await setS("run", run);
  await chrome.runtime.sendMessage({ type: "toFincom", msg: { type: "arn", jobId: job.id, client: job.client, gstin: job.gstin, ym: job.ym, form: job.of || "3B", arn: r.arn, page: "status", at: new Date().toISOString() } });
  return { message: r.message + (r.filed ? ", filed " + r.filed : "") };
}

/* ---------- running ---------- */
function setMsg(id, msg) { const el = document.querySelector('[data-step="' + id + '"] .msg'); if (el) el.textContent = msg; }
async function report(final) {
  const steps = (job.steps || []).map((s) => Object.assign({ id: s.id, label: s.label }, run.steps[s.id] || { status: s.you ? "you" : "waiting" }));
  const diffs = Object.entries(run.compare || {}).reduce((a, [k, c]) => a.concat((c.rows || []).filter((d) => !d.ok).map((d) => ({ part: k, key: d.key, label: d.label, fincom: d.fincom, portal: d.portal, diff: d.diff, rounding: !!d.rounding }))), []);
  const agree = Object.fromEntries(Object.entries(run.compare || {}).map(([k, c]) => [k, { agree: c.agree, n: c.rows.length, differ: c.differences.length, rounding: (c.rounding || []).length }]));
  await chrome.runtime.sendMessage({ type: "toFincom", msg: { type: "run", jobId: job.id, client: job.client, gstin: job.gstin, ym: job.ym, form: job.form, mode: job.r1mode || "", steps, agree, differences: diffs,
    portal51: run.portal51 || null, arn: run.arn || "", final: !!final, selectors: SEL.version, version: chrome.runtime.getManifest().version, at: new Date().toISOString() } });
}
async function runStep(s, auto) {
  if (s.you || busy) return false;
  busy = true; run.steps[s.id] = { status: "running", message: "" }; await setS("run", run); draw();
  let ok = false;
  try {
    const r = await s.fn(auto);
    run.steps[s.id] = { status: "done", message: (r && r.message) || "Done.", differences: r && r.differences };
    ok = true;
  } catch (e) {
    run.steps[s.id] = { status: "stopped", denied: e instanceof Denied, message: e instanceof Stop ? e.message : "The helper met an error and stopped: " + ((e && e.message) || e) };
  }
  busy = false; await setS("run", run); draw();
  const last = job.steps.filter((x) => !x.you).slice(-1)[0];
  await report(!ok || (last && last.id === s.id));
  return ok;
}
async function runAll() {
  for (const s of job.steps) {
    if (s.you) break;
    if ((run.steps[s.id] || {}).status === "done") continue;
    if (!(await runStep(s, true))) return;
  }
}

/* ---------- drawing ---------- */
const money = (r) => R.money(R.paise(r));
function drawFigures() {
  const el = $("#figures");
  if (!job) { el.hidden = true; return; }
  el.hidden = false;
  if (job.form === "R1" || job.form === "IFF") {
    const t = R.tables1(job.r1json || {});
    el.innerHTML = "<h3>FinCom's figures</h3><table><thead><tr><th>Table</th><th class=n>Records</th><th class=n>Taxable value</th><th class=n>Tax</th></tr></thead><tbody>" +
      Object.values(t).map((x) => "<tr><td>" + esc(x.label) + "</td><td class=n>" + x.n + "</td><td class=n>" + (x.key === "nil" ? R.money(x.nil + x.expt + x.ngsup) : x.key === "doc_issue" ? x.net + " issued" : R.money(x.txval)) + "</td><td class=n>" + (x.key === "nil" || x.key === "doc_issue" ? "" : R.money(x.iamt + x.camt + x.samt + x.csamt)) + "</td></tr>").join("") + "</tbody></table>";
  } else if (job.form === "3B") {
    const f = R.fields3b(job.r3bjson || {}).filter((x) => x.value), r32 = R.rows32(job.r3bjson || {});
    el.innerHTML = "<h3>FinCom's figures</h3><details open><summary class=small>" + f.length + " boxes with figures (the rest are nil and are typed as 0.00)</summary><table><tbody>" +
      f.map((x) => "<tr><td>" + esc(x.label) + "</td><td class=n>" + money(x.value) + "</td></tr>").join("") +
      r32.map((x) => "<tr><td>3.2 " + esc(x.label) + " · place " + x.pos + "</td><td class=n>" + money(x.txval) + " / IGST " + money(x.iamt) + "</td></tr>").join("") + "</tbody></table></details>";
  } else el.innerHTML = "<h3>" + esc(FORM_LABEL[job.form]) + "</h3><p class=small>No figures to type: the helper reads from the portal and sends to FinCom.</p>";
}
// the owner's rule: under Rs 1.00 is rounding (grey); Rs 1.00 or more is a difference
function verdict(c) {
  const rd = (c.rounding || []).length, n = c.rows.length;
  if (c.agree && !rd) return "All " + n + " figures agree to the paisa.";
  if (c.agree) return "All " + n + " figures agree; " + rd + " differ by less than ₹1.00 (rounding, shown grey).";
  return c.differences.length + " of " + n + " figures differ by ₹1.00 or more" + (rd ? "; " + rd + " by less than ₹1.00 (rounding)" : "") + ".";
}
function drawCompare() {
  const el = $("#compare"), parts = Object.entries((run && run.compare) || {}).filter(([k]) => !/^typed_/.test(k));
  if (!parts.length) { el.hidden = true; return; }
  el.hidden = false;
  const TITLE = { r1: "GSTR-1 summary on the portal against FinCom", r3b4c: "4(C) net ITC on the portal against FinCom", pay: "Payment of tax on the portal against FinCom's set-off" };
  el.innerHTML = parts.map(([k, c]) => "<h3>" + esc(TITLE[k] || k) + "</h3><p class=" + (c.agree ? "agree" : "differ") + " data-compare=" + k + ">" + verdict(c) + "</p>" +
    "<details" + (c.agree ? "" : " open") + "><summary class=small>Figure by figure</summary><table><thead><tr><th>Figure</th><th class=n>FinCom</th><th class=n>Portal</th><th class=n>Difference</th></tr></thead><tbody>" +
    c.rows.map((r) => "<tr" + (r.ok ? "" : r.rounding ? " class=round" : " class=diff") + " data-key=\"" + esc(r.key) + "\"><td>" + esc(r.label) + "</td><td class=n>" + esc(r.fincom) + "</td><td class=n>" + esc(r.portal) + "</td><td class=n>" + esc(r.ok ? "" : r.diff) + "</td></tr>").join("") + "</tbody></table></details>").join("");
}
function draw() {
  $("#versions").textContent = "v" + chrome.runtime.getManifest().version + " · portal map " + SEL.version + (SEL.verified ? "" : " (not yet checked on the live portal)");
  const j = $("#job"), st = $("#steps");
  if (!job) { st.hidden = true; drawFigures(); drawCompare(); return; }
  j.innerHTML = "<h3>" + esc(FORM_LABEL[job.form] || job.form) + " · " + esc(job.label || job.fp) + "</h3><div>" + esc((job.client || {}).name || "") + " · <b>" + esc(job.gstin) + "</b></div>" +
    (job.form === "R1" || job.form === "IFF" ? "<div class=small>Way: " + (job.r1mode === "type" ? "typing each table into the portal" : "FinCom's JSON file through the portal's offline upload (every table at once; the portal checks it)") + "</div>" : "") +
    (run && run.arn ? "<div class=agree data-arn>Filed · ARN " + esc(run.arn) + " (sent to FinCom)</div>" : "");
  st.hidden = false;
  st.innerHTML = "<div class=row style='justify-content:space-between'><h3>Steps</h3><button id=runAll" + (busy ? " disabled" : "") + ">Run all steps</button></div>" +
    job.steps.map((s, i) => { const r = (run.steps || {})[s.id] || { status: s.you ? "you" : "waiting" };
      return "<div class=step data-step=" + s.id + " data-status=" + r.status + "><div>" + (i + 1) + ". " + esc(s.label) + "</div><div class=row><span class='badge " + r.status + "'>" + ({ waiting: "to do", running: "running", done: "done", stopped: "stopped", you: "yours" })[r.status] + "</span>" +
        (s.you ? "" : "<button class=ghost data-run=" + s.id + (busy ? " disabled" : "") + ">Run</button>") + "</div><div class=msg>" + esc(r.message || (s.you ? youText() : "")) + "</div>" +
        (r.denied ? "<div class=row style='grid-column:1/-1'><button data-relogin>Open the portal's login page</button></div>" : "") + "</div>"; }).join("");
  $("#runAll").onclick = () => runAll();
  st.querySelectorAll("[data-relogin]").forEach((b) => { b.onclick = () => chrome.runtime.sendMessage({ type: "openLogin" }); });
  st.querySelectorAll("[data-run]").forEach((b) => { b.onclick = () => runStep(job.steps.find((s) => s.id === b.dataset.run)); });
  drawFigures(); drawCompare();
}
function youText() {
  if (job.form === "3B") return "On the portal: check the payment table, press MAKE PAYMENT/POST CREDIT TO LEDGER, then FILE GSTR-3B WITH DSC (companies and LLPs must sign with DSC) or WITH EVC and the OTP. The helper never presses these. When the portal shows the ARN, the helper reads it and FinCom marks the return filed.";
  return "On the File page the helper opened: tick the declaration, choose the authorised signatory and press FILE WITH DSC (companies and LLPs must sign with DSC; others may use FILE WITH EVC and the OTP). The helper never presses these. When the portal shows the ARN, the helper reads it and FinCom marks the return filed.";
}
async function drawConn() {
  const r = await chrome.runtime.sendMessage({ type: "fincomUp" }).catch(() => ({ up: false }));
  $("#conn").innerHTML = r.up ? "<span class=agree id=fincomState data-up=1>FinCom is open and connected.</span>"
    : "<span class=differ id=fincomState data-up=0>FinCom is not open.</span> <span class=small>Open staging.fincom.live in this browser and sign in; results are kept until it is open.</span>";
}

async function load() {
  const j = await getS("job"); run = (await getS("run")) || { steps: {}, compare: {} };
  if (!j) { job = null; draw(); return; }
  if (!job || job.id !== j.id || job.at !== j.at) { job = Object.assign({}, j); job.steps = stepsFor(job); }
  job.tabId = j.tabId;
  draw();
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === "session" && (ch.job || (ch.run && !busy))) load(); });
setInterval(drawConn, 3000);
drawConn(); load();
