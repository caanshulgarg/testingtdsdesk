/* ================================================================== */
/* Posting from any computer: the queue in FinCom's cloud (build 199)  */
/* ================================================================== */
// On the computer with Tally, FinCom posts through the bridge there, as before. On any other computer, when the client's
// books are in the cloud, the entries are queued in the cloud (tally_post_jobs); the bridge on the Tally computer takes
// them with its heartbeat (within a minute), posts them with its usual job (FinCom's ID stamped in each entry, and Tally
// checked for those IDs first, so nothing is posted twice), and writes each entry's result back, with Tally's own words
// when it refused one. The checks before posting (the ledgers, entries already in Tally) read the cloud copy instead.

// how this computer reaches the client's Tally: "bridge" (here), "cloud" (the queue), or null
function tallyVia(co){
  if (!co) return null;
  if (bridgeLive(co)) return "bridge";
  return typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id) ? "cloud" : null;
}
function tallyCoName(co){
  const o = typeof Bridge === "object" && Bridge.up() ? Bridge.openFor(co) : null;
  return o ? o.name : ((typeof TCloud === "object" && TCloud.book(co.id) || {}).company || co.tallyName || co.name);
}
// a read the bridge answers (/ledgers, /ledgerlines, /vouchers), from the bridge here or from the cloud copy
function tallyCall(co, url, body, timeout){
  return tallyVia(co) === "cloud" ? CloudTally.call(co, url) : Bridge.call(url, body, timeout);
}
const CloudTally = {
  async call(co, url){
    const q = new URLSearchParams(url.split("?")[1] || ""), path = url.split("?")[0];
    if (path === "/ledgers"){
      const bk = TCloud.book(co.id);
      const rows = bk ? await TCloud.restAll("tally_ledgers?select=name,parent&book_id=eq." + encodeURIComponent(bk.book) + "&order=name.asc") : [];
      return {ok: true, via: "cloud", ledgers: rows.map(r => ({name: r.name, group: r.parent || ""})), groups: []};
    }
    if (path === "/ledgerlines" || path === "/vouchers"){
      const types = (q.get("types") || "").split(",").map(s => s.trim()).filter(Boolean);
      const vs = await TCloud.rpc("tally_vouchers_in", {p_client: co.id, p_from: TCloud.iso(q.get("from")), p_to: TCloud.iso(q.get("to")),
        p_ledger: q.get("ledger") || null, p_types: types.length ? types : null});
      return {ok: true, via: "cloud", vouchers: [].concat(vs || [])};
    }
    throw {code: "cloud", message: "This needs the Tally computer (" + path + ")."};
  }
};
const CloudPost = {
  uuid(){
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  },
  async row(id){ const r = await Cloud.api("tally_post_jobs?select=id,status,done,n,message,results,checking,company&id=eq." + id); return (r || [])[0] || null; },
  // the same answer as Bridge.postChecked: {ok, company, results: [{id, ok, message, ...}], checking, job}
  async run(cid, payload, onProgress, onChecked){
    const id = this.uuid(), sleep = ms => new Promise(r => setTimeout(r, ms));
    const ids = [].concat(payload.masters || [], payload.vouchers || []).map(x => x.id);
    const r = await TCloud.rpc("tally_post_enqueue", {p_id: id, p_client: cid, p_payload: {masters: payload.masters || [], vouchers: payload.vouchers || [], ledger: payload.ledger || ""}});
    if (!r || !r.ok) throw {code: "cloud_post", message: (r && r.error) || "The entries could not be queued."};
    try { lsSet("tdsdesk:cloudpost", JSON.stringify({id, cid, at: Date.now(), n: ids.length})); } catch (e){}
    const tell = j => { try { onProgress && onProgress(j); } catch (e){} };
    const t0 = Date.now();
    let j = null;
    for (;;){
      await sleep(j ? 2500 : 1200);
      try { j = await this.row(id) || j; } catch (e){ /* the internet: tried again */ }
      if (!j) continue;
      if (["done", "failed", "cancelled"].includes(j.status)) break;
      const waitMin = Math.floor((Date.now() - t0) / 60000);
      tell({done: j.done || 0, total: j.n || ids.length, message: j.status === "waiting"
        ? "Queued for the Tally computer; it takes it within a minute when Tally is open" + (waitMin >= 2 ? " (waiting " + waitMin + " min: is Tally open there?)" : "")
        : (j.message || "Posting on the Tally computer")});
      if (Date.now() - t0 > 30 * 60000){ j = Object.assign({}, j, {status: "failed", message: "Still waiting for the Tally computer after 30 minutes. The posting stays queued and runs when Tally is open there; entries already in Tally are never posted twice."}); break; }
    }
    const why = j.status === "done" ? "Not posted." : (j.message || "The posting stopped.");
    const resultsOf = jj => { const got = new Map([].concat(jj.results || []).map(x => [x.id, x])); return ids.map(x => got.get(x) || {id: x, ok: false, message: why}); };
    const results = resultsOf(j);
    if (j.checking){
      results.forEach(x => { if (x.ok && x.verified == null) x.pendingCheck = true; });
      (async () => {
        for (let n = 0; n < 400; n++){
          await sleep(n < 10 ? 2000 : 5000);
          let k; try { k = await this.row(id); } catch (e){ continue; }
          if (k && !k.checking){ try { lsDel("tdsdesk:cloudpost"); } catch (e){} try { onChecked && onChecked({results: resultsOf(k)}); } catch (e){} return; }
        }
      })();
    } else { try { lsDel("tdsdesk:cloudpost"); } catch (e){} }
    return {ok: true, company: j.company || payload.company, results, checking: !!j.checking, viaCloud: true, job: {id, status: j.status, message: j.message}};
  }
};
// the Post button: on the Tally computer, or anywhere once the client's books are in the cloud
function canPostTally(co){
  if (Bridge.on() && Bridge.up()) return true;
  if (!co || typeof TCloud !== "object" || !TCloud.on()) return false;
  const s = TCloud.st[co.id];
  if (!s || !s.at){ TCloud.st[co.id] = {at: Date.now(), books: null}; TCloud.status(co.id, true).then(() => { if (TCloud.has(co.id)) render(); }, () => {}); return false; }
  return TCloud.has(co.id);
}
// a posting queued before this page was reloaded or closed: how it ended (it goes on in the cloud and on the Tally
// computer by itself). Post again for anything left: entries already in Tally are recognised and not posted twice
async function cloudPostLeftover(){
  let m = null; try { m = JSON.parse(lsGet("tdsdesk:cloudpost") || "null"); } catch (e){}
  if (!m || !m.id || typeof TCloud !== "object" || !TCloud.on()) return;
  try {
    const j = await CloudPost.row(m.id);
    if (!j){ if (Date.now() - (m.at || 0) > 7 * 86400000) lsDel("tdsdesk:cloudpost"); return; }
    if (["waiting", "taken", "running"].includes(j.status) || j.checking){ toast("An earlier posting to " + j.company + " is " + (j.status === "waiting" ? "still queued for the Tally computer" : "going on at the Tally computer: " + (j.done || 0) + " of " + j.n + " done") + "."); return; }
    lsDel("tdsdesk:cloudpost");
    const ok = [].concat(j.results || []).filter(r => r.ok).length;
    toast("The earlier posting to " + j.company + " finished: " + ok + " of " + j.n + " in Tally. Post again for any left; entries already in Tally are not sent twice.");
  } catch (e){}
}
setTimeout(() => { try { cloudPostLeftover(); } catch (e){} }, 9000);
