/* ================================================================== */
/* Page links (review item 25): every page has its own address, so    */
/* Back, Forward and Refresh work and a bill can be sent as a link.    */
/* ================================================================== */
// The address is kept after the # (#/c/<client>/bill/<id>): the site is plain files, so a path like /c/… would not be
// found on refresh. The page state (S) stays the only truth: the address is written from it after each drawing, and
// read into it when the address changes (Back, Forward, a link opened, Refresh).
//   #/clients  #/today  #/inbox  #/tally[/bridge-1.15]  #/help  #/settings[/<section>]
//   #/c/<client>/dash | inbox | upload | txn/<kind> | books/<tab> | purchase/review | purchase/<filter> | bill/<id>
//                | bank | sales | post/<kind> | done/<kind> | setup/<section>
const Route = {
  applying: false,
  of(){
    if (S.view !== "company" || !S.coId || !CO()){
      if (S.homeTab === "rules") return "#/settings" + (S.settingsTab ? "/" + encodeURIComponent(S.settingsTab) : "");
      // 02-Oct-2026: #/tally/bridge-1.15, the hidden way back to bridge 1.15.0's setup (linked from nowhere)
      if (S.homeTab !== "tally") S.tallyOld = false;
      else if (S.tallyOld) return "#/tally/bridge-1.15";
      return "#/" + (["clients", "today", "inbox", "tally", "help"].includes(S.homeTab) ? S.homeTab : "clients");
    }
    const c = "#/c/" + encodeURIComponent(S.coId) + "/";
    if (S.step === "collect") return c + "upload";
    if (S.tab === "dash") return c + "dash";
    if (S.tab === "clientInbox") return c + "inbox";
    if (S.tab === "txn") return c + "txn/" + txnTab();
    if (S.tab === "books") return c + "books/" + booksTab();
    if (isSetupTab(S.tab)) return c + "setup/" + S.tab;
    if (S.tab === "bank") return c + "bank";
    if (S.tab === "sales") return c + "sales";
    if (S.tab === "export") return c + "post/" + (S.postFocus || "bills");
    if (S.tab === "done") return c + "done/" + (S.postFocus || "bills");
    if (S.tab === "invoices"){
      // one at a time, or opened in the drawer over the review table: either way the bill has its own address
      if (S.selected && (!S.reviewTable || S.drawerOpen)) return c + "bill/" + encodeURIComponent(S.selected);
      return c + "purchase/" + (S.reviewTable ? "review" : (S.filter || "draft"));
    }
    return c + "dash";
  },
  // after each drawing: the address follows the page; a new page is a new step in the browser's history
  pending: null,                    // a link opened before signing in: applied once signed in
  ready: false,                     // set once the page has started: until then the address is the one opened, not ours
  sync(){
    // leaving a page with unsaved changes: "Save your changes?" (src/js/60)
    if (this.ready && S.firm && !signInNeeded() && typeof Drafts === "object"){ try { Drafts.onPage(this.of()); } catch (e){} }
    if (!this.ready || this.applying || typeof history === "undefined" || signInNeeded() || !S.firm) return;
    if (this.pending){ const p = this.pending; this.pending = null; this.apply(p); return; }
    const h = this.of();
    // the Tally redesign (09-Oct-2026): the client's page last shown, for "← Back to <client>" on the Tally page
    if (/^#\/c\//.test(h)) S.lastClientHash = h;
    if (h === location.hash){ this.replaceNext = false; return; }
    try {
      if (!/^#\//.test(location.hash) || this.replaceNext) history.replaceState(null, "", location.pathname + location.search + h);
      else history.pushState(null, "", location.pathname + location.search + h);
    } catch (e){}
    this.replaceNext = false;
  },
  // the address into the page: from Back/Forward, a link, or a refresh
  async apply(h){
    const p = String(h || "").replace(/^#\/?/, "").split("/").map(x => { try { return decodeURIComponent(x); } catch (e){ return x; } });
    if (!p[0]) return false;
    this.applying = true;
    try {
      if (p[0] === "c" && p[1]){
        if (!S.companies[p[1]]){ toast("That client is not in this firm’s list."); return false; }
        await openCompany(p[1]);
        const what = p[2] || "dash", arg = p[3] || "";
        S.step = null; S.drawerOpen = false; S.colPop = null;
        if (what === "upload"){ S.tab = S.tab === "dash" ? "invoices" : S.tab; S.step = "collect"; }
        else if (what === "dash") S.tab = "dash";
        else if (what === "inbox") S.tab = "clientInbox";
        else if (what === "txn"){ S.tab = "txn"; if (arg) S.txnTab = arg; }
        else if (what === "books"){ S.tab = "books"; if (arg) S.booksTab = arg; }
        else if (what === "setup" && isSetupTab(arg)) S.tab = arg;
        else if (what === "bank"){ S.tab = "bank"; if (!S.bank || S.bank.cid !== S.coId) loadBank(S.coId).then(() => render()); }
        else if (what === "sales") S.tab = "sales";
        else if (what === "post" || what === "done"){ S.tab = what === "post" ? "export" : "done"; S.postFocus = arg || "bills"; if (!S.bank || S.bank.cid !== S.coId) loadBank(S.coId).then(() => render()); }
        else if (what === "purchase"){ S.tab = "invoices"; S.selected = null; S.drawerOpen = false; S.reviewTable = arg === "review"; if (arg && arg !== "review") S.filter = arg; }
        else if (what === "bill"){
          const e = D().entries[arg];
          S.tab = "invoices";
          // over the review table when that is where it was opened (Back closes it), else one at a time
          if (e){ if (S.reviewTable && e.status === "draft") S.drawerOpen = true; else S.reviewTable = false; S.filter = e.status; S.selected = e.id; } else toast("That bill is not in this client’s list (deleted, or not yet sent to this computer).");
        }
      } else if (p[0] === "settings"){ S.view = "home"; S.homeTab = "rules"; S.settingsTab = p[1] || null; }
      else if (["clients", "today", "inbox", "tally", "help"].includes(p[0])){ S.view = "home"; S.homeTab = p[0]; S.step = null; S.tallyOld = p[0] === "tally" && p[1] === "bridge-1.15"; }
      else return false;
      return true;
    } finally {
      this.applying = false;
      this.replaceNext = true;       // the address already says where we are
      render();
    }
  }
};
// the Tally redesign (09-Oct-2026, the owner: "if i go to tally page then return to that client is not possible"): the
// Tally page keeps the open client; "← Back to <client>" opens that client's page last shown (a new step in the
// browser's history, so Back returns to the Tally page), else its dashboard
function backToClient(){
  const cid = S.coId;
  if (!cid || !S.companies[cid]) { navHome("clients"); return; }
  const pre = "#/c/" + encodeURIComponent(cid) + "/", h = S.lastClientHash && S.lastClientHash.indexOf(pre) === 0 ? S.lastClientHash : pre + "dash";
  if (typeof history !== "undefined" && Route.ready){ try { history.pushState(null, "", location.pathname + location.search + h); } catch (e){} }
  Route.apply(h);
}
// from a client: the Tally page, focused on that client's computer and company (S.tallyFocus)
function openTallyFor(cid){ S.tallyFocus = cid || S.coId || ""; S.tallyTab = "computers"; navHome("tally"); }
if (typeof window !== "undefined"){
  window.addEventListener("popstate", () => { if (/^#\//.test(location.hash)) Route.apply(location.hash); });
  window.addEventListener("hashchange", () => { if (/^#\//.test(location.hash) && location.hash !== Route.of()) Route.apply(location.hash); });
}
