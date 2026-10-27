/* FinCom phone app (branch next-mobile): the page's first script in the MOBILE build only (vite.config.js, fincom-mobile;
   never in a web build). On a phone the sign-in is kept in the Keychain / Keystore (src/lib/native.js), not in
   localStorage, and reading it there takes a moment: so the program (legacy.js) and the app (the entry) are started from
   here once the sign-in is back in sessionStorage, where the program reads it first (src/js/43 Cloud.sess). Off a phone
   (the mobile build opened in a browser, the tests) they start at once, as on the web. Plain old JavaScript: it runs
   before anything else. 2.5 s at most: the app always starts. */
(function () {
  var W = window, D = document, P = "__FINCOM_LS__", me = D.currentScript, started = false;
  W.__fincomNativeLs = P;
  var legacy = me && me.getAttribute("data-legacy"), entry = me && me.getAttribute("data-entry");
  function go() {
    if (started) return; started = true;
    var a = D.createElement("script");
    a.src = legacy; a.async = false;
    a.onload = a.onerror = function () {
      var m = D.createElement("script");
      m.type = "module"; m.crossOrigin = ""; m.src = entry;
      D.body.appendChild(m);
    };
    D.body.appendChild(a);
  }
  var C = W.Capacitor, native = false;
  try { native = !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (e) { native = false; }
  if (!native) return go();
  setTimeout(go, 2500);
  var k = P + "cloudsess", here = null;
  try { here = sessionStorage.getItem(k) || localStorage.getItem(k); } catch (e) { here = null; }
  if (here) return go();
  C.nativePromise("SecureStorage", "internalGetItem", { prefixedKey: "fincom_cloudsess", sync: false }).then(function (r) {
    var txt = r && r.data;
    if (txt) {
      try { sessionStorage.setItem(k, txt); } catch (e) { /* the sign-in page then */ }
      // the frame drawn before the program (index.html's boot script) thought nobody was signed in
      var j = null; try { j = JSON.parse(txt); } catch (e) { j = null; }
      if (j && j.access_token && D.documentElement.getAttribute("data-boot") === "signin") D.documentElement.setAttribute("data-boot", "app");
    }
  }, function () { /* nothing kept: the sign-in page */ }).then(go, go);
})();
