/* ================================================================== */
/* Page links (review item 25): every page has its own address, so    */
/* Back, Forward and Refresh work and a bill can be sent as a link.    */
/* ================================================================== */
// The address is kept after the # (#/c/<client>/bill/<id>): the site is plain files, so a path like /c/… would not be
// found on refresh. The page state (S) stays the only truth: the address is written from it after each drawing, and
// read into it when the address changes (Back, Forward, a link opened, Refresh).
//   #/clients  #/today  #/inbox  #/tally  #/help  #/settings[/<section>]
//   #/c/<client>/dash | inbox | upload | txn/<kind> | books/<tab> | purchase/review | purchase/<filter> | bill/<id>
//                | bank | sales | post/<kind> | done/<kind> | setup/<section>
const Route = {
  applying: false,
  of(){
    if (S.view !== "company" || !S.coId || !CO()){
      if (S.homeTab === "rules") return "#/settings" + (S.settingsTab ? "/" + encodeURIComponent(S.settingsTab) : "");
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
      if (S.selected && !S.reviewTable) return c + "bill/" + encodeURIComponent(S.selected);
      return c + "purchase/" + (S.reviewTable ? "review" : (S.filter || "draft"));
    }
    return c + "dash";
  },
  // after each drawing: the address follows the page; a new page is a new step in the browser's history
  pending: null,                    // a link opened before signing in: applied once signed in
  ready: false,                     // set once the page has started: until then the address is the one opened, not ours
  sync(){
    if (!this.ready || this.applying || typeof history === "undefined" || signInNeeded() || !S.firm) return;
    if (this.pending){ const p = this.pending; this.pending = null; this.apply(p); return; }
    const h = this.of();
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
        else if (what === "purchase"){ S.tab = "invoices"; S.selected = null; S.reviewTable = arg === "review"; if (arg && arg !== "review") S.filter = arg; }
        else if (what === "bill"){
          const e = D().entries[arg];
          S.tab = "invoices"; S.reviewTable = false;
          if (e){ S.filter = e.status; S.selected = e.id; } else toast("That bill is not in this client’s list (deleted, or not yet sent to this computer).");
        }
      } else if (p[0] === "settings"){ S.view = "home"; S.homeTab = "rules"; S.settingsTab = p[1] || null; }
      else if (["clients", "today", "inbox", "tally", "help"].includes(p[0])){ S.view = "home"; S.homeTab = p[0]; S.step = null; }
      else return false;
      return true;
    } finally {
      this.applying = false;
      this.replaceNext = true;       // the address already says where we are
      render();
    }
  }
};
if (typeof window !== "undefined"){
  window.addEventListener("popstate", () => { if (/^#\//.test(location.hash)) Route.apply(location.hash); });
  window.addEventListener("hashchange", () => { if (/^#\//.test(location.hash) && location.hash !== Route.of()) Route.apply(location.hash); });
}
