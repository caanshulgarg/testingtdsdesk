/* FinCom GST helper: the background. It talks to FinCom's own tab (staging.fincom.live, the person signed in there) over
 * one port, keeps the return being worked on in the browser's memory for this session only (chrome.storage.session), and
 * opens the portal in the person's own browser. It never talks to any server: the figures come from the FinCom tab and
 * the results go back to it. A GST portal password passes through here once, from FinCom to the login page's field,
 * and is not kept, logged or stored anywhere. */
"use strict";
importScripts("selectors.js");
const SEL = self.GSTH_SEL;
let fincom = null;                 // the port of the FinCom tab, when one is open

chrome.runtime.onInstalled.addListener(() => { chrome.sidePanel && chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { chrome.sidePanel && chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); });

const sess = chrome.storage.session;
async function getS(k) { const o = await sess.get(k); return o[k]; }
async function setS(k, v) { await sess.set({ [k]: v }); }

// results for FinCom: sent now, or kept (in memory, this session) until FinCom's tab is open again
async function toFincom(msg) {
  if (fincom) { try { fincom.postMessage(msg); return true; } catch (e) { fincom = null; } }
  const q = (await getS("outbox")) || []; q.push(msg); await setS("outbox", q.slice(-50));
  return false;
}
async function flush() {
  const q = (await getS("outbox")) || [];
  if (!q.length || !fincom) return;
  await setS("outbox", []);
  q.forEach((m) => { try { fincom.postMessage(m); } catch (e) {} });
}

function waitLoaded(tabId, ms) {
  return new Promise((resolve) => {
    const end = Date.now() + (ms || 30000);
    const tick = () => chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") resolve(t); else if (Date.now() > end) resolve(null); else setTimeout(tick, 200); }, () => resolve(null));
    tick();
  });
}
async function ping(tabId, ms) {
  const end = Date.now() + (ms || 15000);
  for (;;) {
    try { const r = await chrome.tabs.sendMessage(tabId, { cmd: "ping" }); if (r && r.ok) return r; } catch (e) {}
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}
// The portal refuses its returns and payment pages when they are opened by typing their address (the owner's report of
// 17-Oct-2026: "Access Denied! Your session is expired…"). So the helper never types an address after login: it reuses
// the person's portal tab as it is, and the only address it ever opens is the login page, and only when no logged-in
// portal tab exists. Getting from the home page to a return is the side panel's job, through the portal's own menu.
const LOGIN_URL = SEL.pages.login.url, LOGIN_RE = new RegExp(SEL.pages.login.match), PORTAL_RE = /^https:\/\/[a-z0-9.-]*gst\.gov\.in\//;
async function portalTab() {
  const job = (await getS("job")) || {};
  let t = job.tabId ? await chrome.tabs.get(job.tabId).catch(() => null) : null;
  if (t && !PORTAL_RE.test(t.url || t.pendingUrl || "")) t = null;
  if (!t) {
    const all = await chrome.tabs.query({ url: "https://*.gst.gov.in/*" }).catch(() => []);
    t = all.find((x) => !LOGIN_RE.test(x.url || "")) || all[0] || null;
  }
  return t;
}
// "login" (the login page is open), "denied" (the portal's refusal page), "in" (logged in), or "none"
async function stateOf(t) {
  if (!t) return "none";
  if (LOGIN_RE.test(t.url || t.pendingUrl || "")) return "login";
  const r = await ping(t.id, 5000);
  return r && r.page === "denied" ? "denied" : "in";
}
async function keep(tab) {
  const job = (await getS("job")) || {};
  job.tabId = tab.id; await setS("job", job);
  try { await chrome.sidePanel.open({ tabId: tab.id }); } catch (e) { /* needs a click on the helper's icon */ }
  return tab;
}
// the portal for this return: the person's own portal tab, as it is; the login page only when there is none
async function showPortal() {
  const t = await portalTab();
  if (t) return keep(await chrome.tabs.update(t.id, { active: true }));
  return keep(await chrome.tabs.create({ url: LOGIN_URL, active: true }));
}
// the login page: in the portal tab when it is not logged in (refused, or already on the login page); never over a
// logged-in tab. {tab, already: true} when logged in.
async function openLogin() {
  const t = await portalTab(), st = await stateOf(t);
  if (st === "in") return { tab: await keep(await chrome.tabs.update(t.id, { active: true })), already: true };
  if (st === "login") return { tab: await keep(await chrome.tabs.update(t.id, { active: true })) };
  if (t) return { tab: await keep(await chrome.tabs.update(t.id, { url: LOGIN_URL, active: true })) };
  return { tab: await keep(await chrome.tabs.create({ url: LOGIN_URL, active: true })) };
}

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== "fincom") { port.disconnect(); return; }
  fincom = port;
  port.onDisconnect.addListener(() => { if (fincom === port) fincom = null; });
  port.onMessage.addListener(async (m) => {
    if (!m || typeof m !== "object") return;
    if (m.type === "hello") {
      port.postMessage({ type: "hello", version: chrome.runtime.getManifest().version, selectors: SEL.version, verified: SEL.verified, job: await getS("job"), run: await getS("run") });
      await setS("fincomAt", Date.now());
      flush();
    } else if (m.type === "job") {
      // the return FinCom asks the helper to work on: its figures, kept in this browser session only
      const job = Object.assign({}, m.job, { at: Date.now(), tabId: ((await getS("job")) || {}).tabId || null });
      await setS("job", job); await setS("run", { jobId: job.id, steps: {}, compare: {}, arn: "" });
      port.postMessage({ type: "job", ok: true, id: job.id });
      if (m.open) await showPortal();
    } else if (m.type === "login") {
      // the one place a password passes: from FinCom to the login page's box, then dropped
      let user = m.username, pass = m.password;
      m.password = null;
      try {
        const o = await openLogin();
        if (o.already) { user = null; pass = null; port.postMessage({ type: "login", ok: true, already: true, message: "Already logged in on the portal: that tab is used as it is; nothing was typed." }); return; }
        await waitLoaded(o.tab.id); await ping(o.tab.id);
        const r = await chrome.tabs.sendMessage(o.tab.id, { cmd: "fillLogin", username: user, password: pass });
        user = null; pass = null;
        port.postMessage({ type: "login", ok: !!(r && r.ok), message: (r && r.message) || "The login page did not answer." });
      } catch (e) {
        user = null; pass = null;
        port.postMessage({ type: "login", ok: false, message: "The login page could not be filled: " + ((e && e.message) || e) });
      }
    } else if (m.type === "data") {
      // FinCom answering the panel's "send the figures again"
      if (m.job) { const old = (await getS("job")) || {}; await setS("job", Object.assign({}, m.job, { at: Date.now(), tabId: old.tabId || null })); }
    }
  });
});

// the side panel and the portal tab
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || sender.id !== chrome.runtime.id) return false;
  if (m.type === "arn") {
    (async () => {
      const job = (await getS("job")) || {}, run = (await getS("run")) || {};
      run.arn = m.arn; await setS("run", run);
      await toFincom({ type: "arn", jobId: job.id, client: job.client, gstin: job.gstin, ym: job.ym, form: job.form, arn: m.arn, page: m.page, at: new Date().toISOString() });
    })();
    return false;
  }
  if (m.type === "toFincom") { toFincom(m.msg).then((sent) => reply({ sent })); return true; }
  if (m.type === "showPortal") { showPortal().then((t) => reply({ tabId: t.id })); return true; }
  if (m.type === "openLogin") { openLogin().then((o) => reply({ tabId: o.tab.id, already: !!o.already })); return true; }
  if (m.type === "fincomUp") { reply({ up: !!fincom }); return false; }
  if (m.type === "askData") { toFincom({ type: "need", gstin: m.gstin, ym: m.ym, form: m.form }).then((sent) => reply({ sent })); return true; }
  return false;
});
