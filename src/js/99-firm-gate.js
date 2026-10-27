/* ================================================================== */
/* The console's switches in the app (console phase 1b, 27-Oct-2026)   */
/* ================================================================== */
// FinCom's console (console.fincom.live) can pause a firm (firms.status suspended or closed: read-only) and switch a
// company off (clients.status deactivated: hidden from the lists, no uploads, no posting to Tally); migration 118.
// The database refuses the writes (can_write(), console_post_guard) and the functions check at their door
// (server/_shared/firmgate.ts); here the page says so and holds the buttons back, with the reason:
//   FirmGate.st      my_firm_status(): {status, reason, at} of the signed-in person's firm (null before migration 118)
//   FirmGate.co      the firm's companies that are not active: {cid: {status, reason}}
//   FirmGate.why()   the words when a write is refused here (the open client's, or the one named), else ""
// Read at sign-in and with every sync (45 s), when the tab comes back, at once from Realtime for a company (clients is
// in the publication), and at once from the signal table firm_signals when the database has it (console plan, migration 127).
const FirmGate = {
  st: null, co: {},
  paused(){ const s = this.st && this.st.status; return !!s && s !== "active"; },
  pausedWhy(){ const r = this.st && this.st.reason; return "Your firm’s FinCom account is paused" + (r ? ": " + r : "") + ". You can still view your work. Contact FinCom."; },
  off(cid){ const c = cid && this.co[cid]; return !!(c && c.status && c.status !== "active"); },
  offWhy(cid){ const c = this.co[cid] || {}, co = S.companies[cid];
    return ((co && co.name) || "This company") + " is switched off by FinCom" + (c.reason ? ": " + c.reason : "") + ". You can still view its work; uploads and posting to Tally are off."; },
  why(cid){
    if (this.paused()) return this.pausedWhy();
    if (cid === undefined) cid = S.view === "company" ? S.coId : "";
    return this.off(cid) ? this.offWhy(cid) : "";
  },
  // a company in the lists: an active one, or any while "Show inactive" is on
  shown(c){ return !!S.showInactive || !this.off(c && c.id); },
  // FinCom's own people (platform_admins): the link to the console in Settings
  admin(){ return !!((S.account && S.account.superadmin) || (Cloud.st.mfaInfo || {}).admin); },
  async load(){
    if (!Cloud.on() || Cloud.st.mfa) return;
    const was = JSON.stringify([this.st, this.co]);
    try { const r = await Cloud.rpc("my_firm_status"); this.st = r && r.status ? r : null; } catch (e){}       // before 118: nothing
    try { const co = {}; ((await Cloud.api("clients?select=id,status,status_reason&status=neq.active")) || []).forEach(r => { co[r.id] = {status: r.status, reason: r.status_reason || ""}; }); this.co = co; } catch (e){}
    if (JSON.stringify([this.st, this.co]) !== was) this.changed();
  },
  // a clients row from Realtime
  row(r){
    if (!r || !r.id || r.status === undefined) return;
    const was = JSON.stringify(this.co[r.id] || null);
    if (r.status === "active") delete this.co[r.id]; else this.co[r.id] = {status: r.status, reason: r.status_reason || ""};
    if (JSON.stringify(this.co[r.id] || null) !== was) this.changed();
  },
  changed(){ this.mark(); render(); },
  // the buttons that write, held back while a write is refused here: the main and danger buttons, the drop boxes and
  // file pickers, and anything marked data-write; never the sidebar, Settings' list, Help (contact FinCom) or a dialog
  SEL: "button.primary,button.danger,button.danger-fill,[data-write],input[type=file],.drop,#drop,#bankDrop,#salesDrop",
  OK: ".signin-box,.side,.setnav,header.top,#confirmBox,#toast,.toast,[data-gate-ok],[data-help],.help-page",
  target(t){ const el = t && t.closest && t.closest(this.SEL); return el && !el.closest(this.OK) && !(S.view !== "company" && S.homeTab === "help") ? el : null; },
  mark(){
    const why = this.why(), on = document.querySelectorAll(".fc-gated");
    on.forEach(el => { el.classList.remove("fc-gated"); el.removeAttribute("aria-disabled"); if (el.dataset.gateTitle !== undefined){ el.title = el.dataset.gateTitle; delete el.dataset.gateTitle; } });
    // watched while anything is switched off (the open client may change), dropped when nothing is
    const any = this.paused() || Object.keys(this.co).length > 0;
    if (!any && this.obs){ this.obs.disconnect(); this.obs = null; }
    if (any && !this.obs && window.MutationObserver){ this.obs = new MutationObserver(() => { clearTimeout(this.mt); this.mt = setTimeout(() => this.mark(), 60); }); this.obs.observe(document.body, {childList: true, subtree: true}); }
    if (!why) return;
    if (!document.getElementById("fc-gate-css")){ const st = document.createElement("style"); st.id = "fc-gate-css"; st.textContent = ".fc-gated{opacity:.45!important;cursor:not-allowed!important}"; document.head.appendChild(st); }
    document.querySelectorAll(this.SEL).forEach(el => { if (!this.target(el)) return; el.classList.add("fc-gated"); el.setAttribute("aria-disabled", "true"); if (el.dataset.gateTitle === undefined) el.dataset.gateTitle = el.title || ""; el.title = why; });
  },
  refuse(ev){ ev.preventDefault(); ev.stopImmediatePropagation(); toast(this.why()); }
};
// a held-back button, drop box or file picker: nothing happens but the reason (before React and the old handlers see it)
document.addEventListener("click", ev => { if (FirmGate.why() && FirmGate.target(ev.target)) FirmGate.refuse(ev); }, true);
["dragover", "drop"].forEach(k => document.addEventListener(k, ev => {
  if (!FirmGate.why() || !(ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes("Files")) || (S.view !== "company" && S.homeTab === "help")) return;
  if (k === "drop") FirmGate.refuse(ev); else { ev.preventDefault(); ev.stopImmediatePropagation(); }
}, true));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") FirmGate.load(); });

// the signal from the console (firm_signals, the console plan's migration 127: one row per firm and one for every firm,
// in Realtime; it only says "something changed"): the firm's status, its plan and credit and the AI switches are read
// again within seconds. Joined only when the database has the table, on a channel of its own beside the live sync's
Live.joinSignals = async function(){
  if (this.sigTopic || !Cloud.st.firm) return;
  try { await Cloud.api("firm_signals?select=firm_id&limit=1"); } catch (e){ return; }
  this.sigTopic = "realtime:fincom-signals-" + Cloud.st.firm;
  this.send(this.sigTopic, "phx_join", {config: {broadcast: {self: false, ack: false}, presence: {key: ""}, postgres_changes: [{event: "*", schema: "public", table: "firm_signals"}], private: false}, access_token: this.token});
};
Live.signal = function(){
  clearTimeout(this.sigT);
  this.sigT = setTimeout(() => { FirmGate.load(); loadAccount(true).then(() => render()); if (typeof window.loadFlags === "function") window.loadFlags(); if (typeof window.loadAiState === "function") window.loadAiState(); }, 300);
};
