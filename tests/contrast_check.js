// WCAG AA text contrast over the page: every text element against what is behind it (colours and gradients; a thin
// decorative strip under 8 px is not what the text sits on). Returns the failures, one per colour pair.
() => {
  const rgb = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1}; };
  const lum = c => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const blend = (top, bot) => ({r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1});
  const bgsOf = el => { const layers = []; let grad = null; for (let n = el; n; n = n.parentElement){ const cs = getComputedStyle(n);
      if (cs.backgroundImage && /gradient/.test(cs.backgroundImage) && !grad && !/(^|[ ,])[0-7](\.\d+)?px\b/.test(cs.backgroundSize)){ grad = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(rgb).filter(c => c.a > .5); if (grad.length) break; grad = null; }
      const c = rgb(cs.backgroundColor); if (c && c.a > 0){ layers.push(c); if (c.a >= 1) break; } }
    let c = {r: 255, g: 255, b: 255, a: 1}; for (let i = layers.length - 1; i >= 0; i--) c = blend(layers[i], c); return grad ? grad.map(g => blend(g, c)) : [c]; };
  const out = [], seen = new Set();
  document.querySelectorAll("body *").forEach(el => {
    if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || +cs.opacity === 0) return;
    if (el.closest("[disabled],[aria-disabled=true]")) return;
    const fg = rgb(cs.color); if (!fg) return; let ratio = 99, bg = null;
    bgsOf(el).forEach(b => { const f = blend(fg, b), L1 = lum(f), L2 = lum(b), q = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05); if (q < ratio){ ratio = q; bg = b; } });
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, large = size >= 24 || (bold && size >= 18.66);
    if (ratio < (large ? 3 : 4.5)){ const k = cs.color + "|" + cs.backgroundColor + "|" + el.className; if (seen.has(k)) return; seen.add(k);
      out.push(ratio.toFixed(2) + " " + el.tagName.toLowerCase() + "." + String(el.className).slice(0, 30) + " '" + el.textContent.trim().slice(0, 30) + "' " + cs.color + " on " + `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`); }
  });
  return out;
}
