window.TDS_ASSETS = "assets/";
// not inside another site's frame (clickjacking); claude.ai may show its own copy
(function(){ try { if (window.top === window.self) return; } catch (e){}
  var a = (location.ancestorOrigins && Array.prototype.slice.call(location.ancestorOrigins)) || [];
  if (a.some(function(o){ return o !== location.origin && !/(^|\.)(claude\.ai|claudeusercontent\.com|anthropic\.com)$/.test(String(o).replace(/^https?:\/\//, "").replace(/:\d+$/, "")); }))
    document.documentElement.style.display = "none"; })();
