window.TDS_ASSETS = "assets/";
// not inside another site's frame (clickjacking); claude.ai may show its own copy
(function(){ try { if (window.top === window.self) return; } catch (e){}
  var a = (location.ancestorOrigins && Array.prototype.slice.call(location.ancestorOrigins)) || [];
  if (a.some(function(o){ return o !== location.origin && !/(^|\.)(claude\.ai|claudeusercontent\.com|anthropic\.com)$/.test(String(o).replace(/^https?:\/\//, "").replace(/:\d+$/, "")); }))
    document.documentElement.style.display = "none"; })();
// 17-Oct-2026: newer array and object helpers that Safari 14-15.3 lacks (the program and its libraries call some of them);
// added only where missing, plain old JavaScript so that every browser reads this file
(function(){
  function def(o, k, f){ if (o && !o[k]) try { Object.defineProperty(o, k, { value: f, writable: true, configurable: true }); } catch (e) {} }
  function at(i){ var n = this.length >>> 0; i = Math.trunc(i) || 0; if (i < 0) i += n; return i < 0 || i >= n ? undefined : this[i]; }
  def(Array.prototype, "at", at); def(String.prototype, "at", at);
  if (typeof Int8Array !== "undefined") def(Object.getPrototypeOf(Int8Array.prototype), "at", at);
  def(Array.prototype, "findLast", function(f, t){ for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; });
  def(Array.prototype, "findLastIndex", function(f, t){ for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i; return -1; });
  def(Array.prototype, "toReversed", function(){ return Array.prototype.slice.call(this).reverse(); });
  def(Array.prototype, "toSorted", function(c){ return Array.prototype.slice.call(this).sort(c); });
  def(Array.prototype, "toSpliced", function(){ var a = Array.prototype.slice.call(this); Array.prototype.splice.apply(a, arguments); return a; });
  def(Array.prototype, "with", function(i, v){ var a = Array.prototype.slice.call(this), n = a.length; i = Math.trunc(i) || 0; if (i < 0) i += n; if (i < 0 || i >= n) throw new RangeError("Invalid index"); a[i] = v; return a; });
  def(Object, "hasOwn", function(o, k){ return Object.prototype.hasOwnProperty.call(o, k); });
  if (typeof window.structuredClone !== "function") window.structuredClone = function(v){ return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
})();
