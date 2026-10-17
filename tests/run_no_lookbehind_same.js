// 17-Oct-2026 (Mac Safari stuck on "Opening FinCom"): Safari before 16.4 cannot read a regex with a look-behind, so the five
// that had one were rewritten without it. This compares, on random text, each old regex (Node reads look-behinds) with its
// rewrite, copied from the source: src/js/01 (RE_IGST + NotAfterRegExp), 38 (GSTPDF nums), app/src/lib/registers.js (phone),
// 21 (statement parts), 78 (sentences). Any difference fails.
class NotAfterRegExp extends RegExp {
  constructor(src, flags, notAfter){ super(src, flags); this.notAfter = notAfter; }
  exec(s){
    s = String(s); const g = this.global || this.sticky, re = new RegExp(this.source, this.flags.replace(/[gy]/g, "") + "g");
    re.lastIndex = g ? this.lastIndex : 0;
    let m;
    while ((m = RegExp.prototype.exec.call(re, s))){
      if (!this.notAfter || m[2] === undefined || m.index === 0 || !this.notAfter.test(s[m.index - 1])){ if (g) this.lastIndex = m.index + m[0].length; return m; }
      re.lastIndex = m.index + 1;
    }
    if (g) this.lastIndex = 0;
    return null;
  }
}
const oldI = /(\bi\s?[g6]st|(?<![\w.,])[1l|][g6]st)(?!\s?in\b)/i, newI = new NotAfterRegExp("(\\bi\\s?[g6]st|([1l|])[g6]st)(?!\\s?in\\b)", "i", /[\w.,]/);
const A = "iIgGs6tT1l|.,- ()%:0123456789aINn";
let bad = 0; const rnd = n => Array.from({length: n}, () => A[Math.floor(Math.random() * A.length)]).join("");
const tokens = ["IGST", "1GST", "lgst", "|GST", "i gst", "IGSTIN", ".1GST", ",lGST", "a1GST", " ", "18%", "9.00", "-", "(", "Rs"];
const rt = () => Array.from({length: 1 + Math.floor(Math.random()*6)}, () => Math.random() < .5 ? tokens[Math.floor(Math.random()*tokens.length)] : rnd(3)).join(Math.random()<.5?"":" ");
function nOld(s, n){ const out = [], re = /\(?-?\d[\d,]*\.\d{1,2}\)?|\(?-?\d{1,3}(?:,\d{2,3})+\)?|(?<![\w.])-?\d+(?![\w.])/g; let m; while ((m = re.exec(s)) && out.length < n) out.push(m[0]); return out; }
function nNew(s, n){ const out = [], re = /\(?-?\d[\d,]*\.\d{1,2}\)?|\(?-?\d{1,3}(?:,\d{2,3})+\)?|(-?\d+)(?![\w.])/g; let m; while ((m = re.exec(s)) && out.length < n){ if (m[1] !== undefined && m.index > 0 && /[\w.]/.test(s[m.index - 1])){ re.lastIndex = m.index + 1; continue; } out.push(m[0]); } return out; }
const N = "0123456789-.,()a ";
const ph = (s) => { let k=0; const o = s.replace(/(?<![\d.,])\+?\d{10,13}(?![\d.,])/g, m => "P"+(k++)+"<"+m+">"); k=0; const nw = s.replace(/(^|[^\d.,])(\+?\d{10,13})(?![\d.,])/g, (m,p,v) => p+"P"+(k++)+"<"+v+">"); return [o, nw]; };
const P = "0123456789+.,a -";
const parts = (t, nw) => (nw ? t.replace(/([A-Za-z])-(?!\s)/g, "$1|").split(/[\/*:|]+|\s*-\s+|\s+-\s*|-(?=[A-Za-z])|\s{2,}/) : t.split(/[\/*:|]+|\s*-\s+|\s+-\s*|-(?=[A-Za-z])|(?<=[A-Za-z])-|\s{2,}/)).map(s => s.trim()).filter(Boolean).join("¦");
const T = "aB1-/ *:|.x";
const sent = (x, nw) => JSON.stringify(nw ? x.replace(/\.\s+/g, ".\u0000").split("\u0000") : x.split(/(?<=\.)\s+/));
for (let i = 0; i < 60000; i++){
  const s = rt();
  if (oldI.test(s) !== newI.test(s) || s.replace(oldI, " ") !== s.replace(newI, " ")) { if (bad++ < 5) console.log("IGST", JSON.stringify(s)); }
  const u = Array.from({length: 1+Math.floor(Math.random()*14)}, () => N[Math.floor(Math.random()*N.length)]).join("");
  if (JSON.stringify(nOld(u, 9)) !== JSON.stringify(nNew(u, 9))) { if (bad++ < 10) console.log("nums", JSON.stringify(u)); }
  const p = Array.from({length: 5+Math.floor(Math.random()*30)}, () => Math.random()<.7 ? "9" : P[Math.floor(Math.random()*P.length)]).join("");
  const [a, b] = ph(p); if (a !== b) { if (bad++ < 15) console.log("phone", JSON.stringify(p), a, b); }
  const t = Array.from({length: 1+Math.floor(Math.random()*16)}, () => T[Math.floor(Math.random()*T.length)]).join("");
  if (parts(t) !== parts(t, 1)) { if (bad++ < 20) console.log("parts", JSON.stringify(t)); }
  const x = Array.from({length: 1+Math.floor(Math.random()*16)}, () => "a. \n"[Math.floor(Math.random()*4)]).join("");
  if (sent(x) !== sent(x, 1)) { if (bad++ < 25) console.log("sent", JSON.stringify(x)); }
}
console.log("differences:", bad); if (bad) { console.log("FAIL the look-behind-free regexes differ"); process.exit(1); } console.log("OK the 5 rewritten regexes give the same results as the look-behind ones");
