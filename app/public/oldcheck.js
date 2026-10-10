/* Old browsers (Internet Explorer and the like) cannot run FinCom: say so instead of a blank page. Plain old JavaScript on
   purpose, so that every browser can run this check. */
(function () {
  var ok = false;
  try { ok = !document.documentMode && typeof Promise === "function" && typeof fetch === "function" && typeof Object.assign === "function"
    && typeof Symbol === "function" && "noModule" in document.createElement("script") && typeof Proxy === "function"; } catch (e) { ok = false; }
  if (ok) return;
  window.__fincomOld = true;
  var b = document.body, box = document.createElement("div"), shell = document.querySelector(".shell");
  if (shell) shell.style.display = "none";
  b.insertBefore(box, b.firstChild);
  box.innerHTML = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:60px auto;padding:24px;border:1px solid #D7DEDA;border-radius:8px;color:#1E2A25;background:#fff">' +
    '<h1 style="font-size:22px;margin:0 0 12px">This browser isn\'t supported</h1>' +
    '<p style="font-size:15px;line-height:1.5">Please open FinCom in <b>Microsoft Edge</b> or <b>Google Chrome</b>.</p>' +
    '<p style="font-size:13px;line-height:1.5;color:#5A6B63">On a Tally server with no modern browser, the Tally Bridge setup can be downloaded with this PowerShell command:</p>' +
    '<pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;background:#F4F6F5;padding:10px;border-radius:6px">[Net.ServicePointManager]::SecurityProtocol = \'Tls12\'; Invoke-WebRequest -Uri "' + location.protocol + '//' + location.host + location.pathname.replace(/[^\/]*$/, "") + 'assets/bridge-go/FinComBridge-Setup-2.0.0.exe" -OutFile "$env:USERPROFILE\\Downloads\\FinComBridge-Setup-2.0.0.exe"</pre></div>';
  b.style.background = "#F4F6F5";
})();
