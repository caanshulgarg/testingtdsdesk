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
    if (S.tab === "books") return c + "books/" + booksTab() + this.booksMore();
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
  // the TDS and GST pages keep their year, quarter or month, form or return and tab in the address (09-Oct-2026), so Back
  // and Refresh come back to the same return: #/c/<client>/books/tds/2026-27/Q1/26Q/challans, …/books/tds/2026-27 (the
  // year's grid), …/books/tds/2026-27/certs, …/books/tds/all; #/c/<client>/books/gst/07/202603/r1/summary, …/gst/07/202603/year
  booksMore(){
    const t = booksTab(), e = (x) => encodeURIComponent(x || "");
    if (t === "tds"){
      const v = S.tdsView || "";
      if (v === "years") return "/all";
      if (v === "notices") return "/notices";
      if (!S.tdsFy) return "";
      if (v === "return") return "/" + e(S.tdsFy) + "/" + e(S.tdsQ) + "/" + e(S.tdsForm || "26Q") + (S.tdsTab ? "/" + e(S.tdsTab) : "");
      if (v === "certs") return "/" + e(S.tdsFy) + "/certs";
      return "/" + e(S.tdsFy) + (S.tdsQ ? "/" + e(S.tdsQ) : "");
    }
    if (t === "gst"){
      if (!S.gstYm || !S.gstReg) return "";
      if ((S.gstView || "year") === "year") return "/" + e(S.gstReg) + "/" + e(S.gstYm) + "/year";
      return "/" + e(S.gstReg) + "/" + e(S.gstYm) + "/" + e(S.gstPart || "r1") + (S.gstSub ? "/" + e(S.gstSub) : "");
    }
    return "";
  },
  booksApply(tab, p){
    if (tab === "tds"){
      if (p[0] === "all"){ S.tdsView = "years"; return; }
      if (p[0] === "notices"){ S.tdsView = "notices"; return; }
      if (!/^\d{4}-\d{2}$/.test(p[0] || "")){ return; }
      S.tdsFy = p[0];
      if (p[1] === "certs"){ S.tdsView = "certs"; return; }
      if (/^Q[1-4]$/.test(p[1] || "") && p[2]){ S.tdsQ = p[1]; S.tdsForm = p[2]; S.tdsPickForm = p[2]; S.tdsView = "return"; S.tdsTab = p[3] || ""; return; }
      S.tdsQ = /^Q[1-4]$/.test(p[1] || "") ? p[1] : ""; S.tdsPickForm = ""; S.tdsView = "year";
      return;
    }
    if (tab === "gst" && /^\d{2}$/.test(p[0] || "") && /^\d{6}$/.test(p[1] || "")){
      S.gstReg = p[0]; if (S.gstYm !== p[1] && S.books) S.books.reco = null; S.gstYm = p[1];
      S.gstSeen = p[0] + "|" + (typeof GSTSet === "object" ? GSTSet.typeOf(p[1], p[0]) : "monthly");
      if (!p[2] || p[2] === "year") S.gstView = "year";
      else { S.gstView = "return"; S.gstPart = p[2]; S.gstSub = p[3] || ""; }
    }
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
    // smart moves round 1: the client's page kept for the next opening (7), the way back from a setup page let go once
    // the person has gone elsewhere (9), a Getting ready step just done (10)
    if (typeof Smart === "object"){ try { Smart.remember(h); Smart.dropReturn(h); setTimeout(() => Smart.onbWatch(), 0); } catch (e){} }
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
        else if (what === "books"){ S.tab = "books"; if (arg) S.booksTab = arg; if (arg && p.length > 4) this.booksApply(arg, p.slice(4)); }
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
