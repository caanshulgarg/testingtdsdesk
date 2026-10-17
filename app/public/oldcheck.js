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

  // 17-Oct-2026 (Mac Safari stuck on "Opening FinCom"): when the program does not start, the page's frame stayed for ever with
  // no word. If after 20 s the frame is still there (app/src/boot.js clearBoot removes it), say so with a way out, and on the
  // testing site report the browser and the first error (the error reports of src/sentry.js start only once the app is up)
  function watch() {
    var first = null, me = document.currentScript, report = me && me.getAttribute("data-report");
    window.addEventListener("error", function (e) { if (!first) first = (e && (e.message || (e.error && e.error.message))) || "error"; }, true);
    window.addEventListener("unhandledrejection", function (e) { if (!first) first = "promise: " + String(e && e.reason && (e.reason.message || e.reason)); });
    setTimeout(function () {
      if (window.__fincomOld || !document.querySelector("[data-boot-part]")) return;
      var box = document.createElement("div");
      box.setAttribute("data-boot-stuck", "");
      box.setAttribute("role", "alert");
      box.style.cssText = "position:fixed;left:50%;top:120px;transform:translateX(-50%);z-index:9999;max-width:min(520px,calc(100vw - 32px));padding:18px 20px;border:1px solid #D7DEDA;border-radius:10px;background:#fff;color:#1E2A25;font:14px/1.5 -apple-system,Segoe UI,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.12)";
      box.innerHTML = '<b style="font-size:16px">FinCom did not open</b><p style="margin:6px 0 12px">Press Reload. If it happens again, update this browser (on a Mac: Apple menu → System Settings → Software Update) or open FinCom in Google Chrome.</p>' +
        '<button type="button" style="padding:7px 14px;border-radius:7px;border:0;background:#1F6F5C;color:#fff;font:inherit;cursor:pointer">Reload</button>' +
        '<p style="margin:10px 0 0;font-size:12px;color:#5A6B63"></p>';
      box.querySelector("button").onclick = function () { location.reload(); };
      box.lastChild.textContent = navigator.userAgent + (first ? " · " + first : "");
      document.body.appendChild(box);
      if (report && location.hostname === "staging.fincom.live") try {
        fetch(report, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ message: "FinCom did not open in 20 s: " + (first || "no error seen"), level: "error", platform: "javascript",
            tags: { boot: "stuck" }, extra: { ua: navigator.userAgent, url: location.pathname } }) });
      } catch (e) { /* nothing more to do */ }
    }, 20000);
  }
})();
