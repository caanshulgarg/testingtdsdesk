/* Old browsers (Internet Explorer and the like) cannot run FinCom: say so instead of a blank page. Plain old JavaScript on
   purpose, so that every browser can run this check. */
(function () {
  var ok = false;
  try { ok = !document.documentMode && typeof Promise === "function" && typeof fetch === "function" && typeof Object.assign === "function"
    && typeof Symbol === "function" && "noModule" in document.createElement("script") && typeof Proxy === "function"
    // 17-Oct-2026: the program is built for Safari 14 / Chrome 87 and newer (vite.config.js target); older ones are told so
    && typeof Promise.allSettled === "function" && typeof "".replaceAll === "function"; } catch (e) { ok = false; }
  if (ok) { watch(); return; }
  window.__fincomOld = true;
  var b = document.body, box = document.createElement("div"), shell = document.querySelector(".shell");
  if (shell) shell.style.display = "none";
  b.insertBefore(box, b.firstChild);
  box.innerHTML = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:60px auto;padding:24px;border:1px solid #D7DEDA;border-radius:8px;color:#1E2A25;background:#fff">' +
    '<h1 style="font-size:22px;margin:0 0 12px">This browser isn\'t supported</h1>' +
    '<p style="font-size:15px;line-height:1.5">Please open FinCom in <b>Microsoft Edge</b> or <b>Google Chrome</b>. On a Mac, update Safari (Apple menu → System Settings → Software Update), or use Chrome.</p>' +
    '<p style="font-size:13px;line-height:1.5;color:#5A6B63">On a Tally server with no modern browser, the Tally Bridge setup can be downloaded with this PowerShell command:</p>' +
    '<pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;background:#F4F6F5;padding:10px;border-radius:6px">[Net.ServicePointManager]::SecurityProtocol = \'Tls12\'; Invoke-WebRequest -Uri "' + location.protocol + '//' + location.host + location.pathname.replace(/[^\/]*$/, "") + 'assets/bridge-go/FinComBridge-Setup-2.0.0.exe" -OutFile "$env:USERPROFILE\\Downloads\\FinComBridge-Setup-2.0.0.exe"</pre></div>';
  b.style.background = "#F4F6F5";

  // 24-Oct-2026 (Sentry FINCOM-APP-STAGING-5, Mac Safari right after a publish: "error loading script legacy.js", and the
  // page stayed so until Safari was quit): FinCom's own copies of its files at this address (its service worker and its
  // caches fincom-shell:… / fincom-files:…) cleared, then one reload. Plain old JavaScript, 2.5 s at most
  function clearFiles(done) {
    var left = 0, over = false, end = function () { if (!over) { over = true; done(); } }, one = function () { if (--left <= 0) end(); };
    var here = location.href.replace(/[?#].*$/, "").replace(/[^\/]*$/, ""), path = here.replace(/^[a-z]+:\/\/[^\/]+/i, "");
    setTimeout(end, 2500);
    try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) { left++; navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.filter(function (r) { return r.scope === here; }).map(function (r) { return r.unregister(); })); }).then(one, one); } } catch (e) { /* no workers here */ }
    try { if (typeof caches !== "undefined") { left++; caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf("fincom-shell:" + path + ":") === 0 || k === "fincom-files:" + path; }).map(function (k) { return caches.delete(k); })); }).then(one, one); } } catch (e) { /* no caches here */ }
    if (!left) end();
  }
  function say(text) {
    try {
      var d = document.querySelector("[data-stale-reload]");
      if (!d) { d = document.createElement("div"); d.setAttribute("data-stale-reload", ""); d.setAttribute("role", "status"); d.className = "stale-reload";
        d.style.cssText = "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:10000;padding:8px 14px;border-radius:8px;background:#1E2A25;color:#fff;font:13px/1.4 -apple-system,Segoe UI,Arial,sans-serif";
        document.body.appendChild(d); }
      d.textContent = text;
    } catch (e) { /* the reload still comes */ }
  }
  function cleanReload() {
    say("FinCom is refreshing its files…");
    clearFiles(function () { try { location.reload(); } catch (e) { /* */ } });
  }
  window.__fincomCleanReload = cleanReload;

  // 17-Oct-2026 (Mac Safari stuck on "Opening FinCom"): when the program does not start, the page's frame stayed for ever with
  // no word. If after 20 s the frame is still there (app/src/boot.js clearBoot removes it), say so with a way out, and on the
  // testing site report the browser and the first error (the error reports of src/sentry.js start only once the app is up)
  function watch() {
    var first = null, me = document.currentScript, report = me && me.getAttribute("data-report"), shown = false;
    // 24-Oct-2026: a file that did not load (a script, style or font: the event has no words) is named by its element and file
    window.addEventListener("error", function (e) {
      if (first) return;
      var t = e && e.target, f = t && t !== window && t.tagName ? String(t.src || t.href || "").split("?")[0].split("/").pop() : "";
      first = (e && (e.message || (e.error && e.error.message))) || (t && t.tagName ? "error loading " + t.tagName.toLowerCase() + " " + f : "error");
    }, true);
    // 24-Oct-2026: legacy.js (the program) or the app's own first file (assets/index-….js) did not load. Not while the
    // page is being swapped for a newer build (in Safari the swap cancels its loads). It cannot be run again in this page
    // (the app's files, already run, took over its render() and other names: app/src/store.js), so: the file asked for
    // once more straight from the network, past the service worker and every cache (?fincom-net=…, 4 s at most; said in
    // the report), then FinCom's own copies cleared (its worker and caches) and ONE reload, which then asks the network
    // with no worker in between. Once per file in a tab (sessionStorage), never a loop; when it fails again, the note
    // below at once, with "Reload FinCom" (the same clean-up, pressed by the person). The app does not start meanwhile
    // (window.__fincomLegacy, src/main.jsx)
    window.addEventListener("error", function (e) {
      var t = e && e.target, src = String((t && t.src) || "");
      if (!t || t.tagName !== "SCRIPT" || window.__fincomSwapping || window.__fincomLegacy) return;
      if (!/\/legacy\.js(\?|$)/.test(src) && !(t.type === "module" && /\/assets\/[^\/?]+\.js(\?|$)/.test(src))) return;
      var key = "fincom:file-heal", name = src.split("#")[0].replace(/^.*\//, ""), done = true;
      window.__fincomLegacy = Promise.resolve(false);
      window.__fincomStage = "file not loaded: " + name.split("?")[0];
      try { done = sessionStorage.getItem(key) === name; if (!done) sessionStorage.setItem(key, name); } catch (x) { done = true; }
      if (done) { stuck(false); return; }
      var go = false, next = function (how) {
        if (go) return; go = true;
        try { sessionStorage.setItem("fincom:file-heal-net", how); } catch (x) { /* */ }
        // 27-Oct-2026: the page's own healer (index.html, fincom-heal): FinCom's kept files cleared and the previous good
        // build opened (last-good.json), reported by its own beacon; else, as before, the clean-up and one reload
        try { if (window.__fincomHeal && window.__fincomHeal("file not loaded: " + name.split("?")[0])) return; } catch (x) { /* */ }
        cleanReload();
      };
      say("FinCom is refreshing its files…");
      setTimeout(function () { next("no answer"); }, 4000);
      try { fetch(src + (src.indexOf("?") < 0 ? "?" : "&") + "fincom-net=" + Date.now(), { cache: "no-store" }).then(function (r) { next("network " + r.status); }, function () { next("network failed"); }); }
      catch (x) { next("no fetch"); }
    }, true);
    window.addEventListener("unhandledrejection", function (e) { if (!first) first = "promise: " + String(e && e.reason && (e.reason.message || e.reason)); });
    setTimeout(function () { stuck(true); }, 20000);
    // 27-Oct-2026: the note, for the page's own healer (index.html, fincom-heal) once it has healed this build already
    window.__fincomStuck = stuck;
    function stuck(timed) {
      // 24-Oct-2026: a meeting's guest page (data-guest, src/calls/guest.jsx) is drawn in place of FinCom: it has opened
      if (shown || window.__fincomOld || document.documentElement.hasAttribute("data-guest") || !document.querySelector("[data-boot-part]")) return;
      shown = true;
      var box = document.createElement("div");
      box.setAttribute("data-boot-stuck", "");
      box.setAttribute("role", "alert");
      box.style.cssText = "position:fixed;left:50%;top:120px;transform:translateX(-50%);z-index:9999;max-width:min(520px,calc(100vw - 32px));padding:18px 20px;border:1px solid #D7DEDA;border-radius:10px;background:#fff;color:#1E2A25;font:14px/1.5 -apple-system,Segoe UI,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.12)";
      box.innerHTML = '<b style="font-size:16px">FinCom did not open</b><p style="margin:6px 0 12px">Press Reload FinCom: it fetches FinCom\'s files afresh. If it happens again, update this browser (on a Mac: Apple menu → System Settings → Software Update) or open FinCom in Google Chrome.</p>' +
        '<button type="button" data-boot-reload="" style="padding:7px 14px;border-radius:7px;border:0;background:#1F6F5C;color:#fff;font:inherit;cursor:pointer">Reload FinCom</button>' +
        '<p style="margin:10px 0 0;font-size:12px;color:#5A6B63"></p>';
      // 24-Oct-2026: the button clears FinCom's kept files (its service worker and caches) before the reload, so a broken
      // kept copy cannot answer again
      box.querySelector("button").onclick = function () { this.disabled = true; cleanReload(); };
      box.lastChild.textContent = navigator.userAgent + (first ? " · " + first : "");
      document.body.appendChild(box);
      // 24-Oct-2026: where the opening stopped (the step src/js/27's start reached; "no program" when legacy.js never ran;
      // "swapping" when the page was being swapped for a newer build), whether React started, and the page's state
      var stage = window.__fincomSwapping ? "swapping" : window.__fincomStage || (typeof S === "object" ? "program, not started" : "no program");
      var where = { stage: stage, react: !!document.querySelector("#react-root > *, .react-host"), hidden: document.visibilityState || "",
        kept: document.documentElement.hasAttribute("data-boot-kept"), sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), hash: String(location.hash || "").slice(0, 12), framed: window.top !== window,
        early: !timed, healed: (function () { try { return (sessionStorage.getItem("fincom:file-heal") || "") + " " + (sessionStorage.getItem("fincom:file-heal-net") || ""); } catch (x) { return ""; } })() };
      if (report && location.hostname === "staging.fincom.live") try {
        fetch(report, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ message: "FinCom did not open" + (timed ? " in 20 s: " : ": ") + (first || "no error seen"), level: "error", platform: "javascript",
            tags: { boot: "stuck", stage: stage }, extra: { ua: navigator.userAgent, url: location.pathname, where: where } }) });
      } catch (e) { /* nothing more to do */ }
    }
  }
})();
