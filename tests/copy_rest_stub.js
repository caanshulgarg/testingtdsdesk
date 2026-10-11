// A stand-in for the cloud's REST reads of FinCom's cloud copy (PostgREST over tally_vouchers, tally_lines, tally_bills,
// tally_recorder_lines, tally_ledgers, tally_groups), for round 44's tests of TCloud.copyHeads / copyInto (src/js/49) and
// BookSrc (src/js/67): the app's own query strings are answered from rows given here, with the filters those reads use
// (eq, in, gt, is.null, not.is.null), select, order, limit and offset. Every query asked is kept (asked).
function parseVal(v){ return decodeURIComponent(v); }
function cmp(a, b){ if (a == null && b == null) return 0; if (a == null) return -1; if (b == null) return 1; return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; }
function restStub(tables){
  const asked = [];
  async function api(path){
    asked.push(path);
    const [t, qs] = path.split("?");
    const rows0 = tables[t];
    if (!rows0) throw new Error("no table " + t + " (404)");
    let rows = rows0.slice(), sel = null, order = [], limit = Infinity, offset = 0;
    (qs || "").split("&").filter(Boolean).forEach(kv => {
      const i = kv.indexOf("="), k = kv.slice(0, i), v = kv.slice(i + 1);
      if (k === "select"){ sel = v.split(","); return; }
      if (k === "order"){ order = v.split(",").map(x => { const p = x.split("."); return [p[0], p[1] === "desc" ? -1 : 1]; }); return; }
      if (k === "limit"){ limit = Number(v); return; }
      if (k === "offset"){ offset = Number(v); return; }
      if (v === "is.null"){ rows = rows.filter(r => r[k] == null); return; }
      if (v === "not.is.null"){ rows = rows.filter(r => r[k] != null); return; }
      let m;
      if ((m = v.match(/^eq\.(.*)$/))){ const x = parseVal(m[1]); rows = rows.filter(r => String(r[k]) === x); return; }
      if ((m = v.match(/^gt\.(.*)$/))){ const x = parseVal(m[1]); rows = rows.filter(r => r[k] != null && cmp(r[k], x) > 0); return; }
      if ((m = v.match(/^in\.\((.*)\)$/))){
        const set = new Set(m[1].split(",").map(s => parseVal(s).replace(/^"(.*)"$/, "$1")));
        rows = rows.filter(r => set.has(String(r[k]))); return;
      }
      throw new Error("the stand-in does not know the filter " + kv);
    });
    if (sel) sel.forEach(c => { if (rows0.length && !(c in rows0[0])) { const e = new Error("column " + t + "." + c + " does not exist (42703)"); e.code = "42703"; throw e; } });
    if (order.length) rows.sort((a, b) => { for (const [c, d] of order){ const x = cmp(a[c], b[c]); if (x) return x * d; } return 0; });
    rows = rows.slice(offset, offset + limit);
    return sel ? rows.map(r => { const o = {}; sel.forEach(c => { o[c] = r[c]; }); return o; }) : rows;
  }
  return {api, asked};
}
module.exports = {restStub};
