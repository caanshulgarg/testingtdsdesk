// next-cloud-gst: the GSTR-3B page (Summary and Details) shows the figures FinCom's cloud worked out (gst-run, migration
// 153) only when they were worked out from the same books as the ones open here; otherwise it works the month out itself,
// as before, and asks the cloud to work it out again.
//   The same books: the fingerprint the cloud kept with the month (result.fp) is the same as the one made here from
//   S.books, the marketplace sales the engine reads and this year's 2B matching run (server/_shared/gst3bprint.js,
//   gst3bSame: nothing pending on either side), and the cloud's engine is this page's own (result.src is GST3B_SRC).
//   The cloud is asked once per client, GSTIN and month (rpc gst_calc_cached; given up after WAIT), and again after
//   AGAIN; while the first answer is awaited the page says so. A miss or a different fingerprint asks gst-run to work
//   the month out (action "month": it queues the client and starts a background run), at most once per AGAIN.
import { gst3bPrint, gst3bSame } from "../../../../server/_shared/gst3bprint.js";

const WAIT = 3000, AGAIN = 60000;
const st = new Map();   // "client|reg|ym" -> {done, busy, at, asked, res: gst_calc_cached's answer or null}

// what the engine reads here (GSTR.fromSales): this client's Sales, else none; the 2B matching run of the month's year
const salesHere = () => (S.sales && S.sales.cid === S.coId ? S.sales.list || [] : []);
const runHere = (reg, ym) => { const m = typeof M2B === "object" ? M2B.st[M2B.key(reg, M2B.fyOf(ym))] : null; return m && m.run ? m.run.id : ""; };
export const cloud3bPrint = (reg, ym) => gst3bPrint(S.books, salesHere(), runHere(reg, ym));

function look(cid, reg, ym, s) {
  s.busy = true;
  const give = new Promise((res) => setTimeout(() => res(null), WAIT + 500));
  Promise.race([Cloud.api("rpc/gst_calc_cached", { method: "POST", body: { p_client: cid, p_reg: reg, p_ym: ym }, timeout: WAIT }), give])
    .catch(() => null).then((r) => {
      s.busy = false; s.at = Date.now(); s.res = r && !r.none ? r : null;
      const first = !s.done; s.done = true;
      if (first && S.coId === cid && typeof render === "function") render();
    });
}
function ask(cid, reg, ym, s) {
  if (s.asked && Date.now() - s.asked < AGAIN) return;
  s.asked = Date.now();
  Cloud.fn("gst-run", { action: "month", client_id: cid, reg, ym }).catch(() => null);
}

// -> {t, at}: the cloud's 3B to show; {wait: true}: its first answer awaited; null: work it out here
export function cloud3b(ym, reg) {
  const cid = S.coId;
  if (!cid || !ym || !reg || !S.books || typeof Cloud !== "object" || !Cloud.on() || typeof GST3B_SRC !== "string" || !GST3B_SRC) return null;
  const k = cid + "|" + reg + "|" + ym;
  let s = st.get(k);
  if (!s) st.set(k, s = { done: false, busy: false, at: 0, asked: 0, res: null });
  if (!s.busy && (!s.done || Date.now() - s.at > AGAIN)) look(cid, reg, ym, s);
  if (!s.done) return { wait: true };
  const r = s.res, res = r && r.result;
  if (res && res.src === GST3B_SRC && gst3bSame(cloud3bPrint(reg, ym), res.fp)) return { t: res, at: r.at };
  if (r && r.book && !r.too_big) ask(cid, reg, ym, s);
  return null;
}

// "at 15:42", or "on 10-Nov-2026 at 15:42" on another day
export function cloud3bAt(at) {
  const d = new Date(at);
  if (isNaN(d)) return "";
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  return d.toDateString() === new Date().toDateString() ? "at " + hm : "on " + fmtDate(d) + " at " + hm;
}
