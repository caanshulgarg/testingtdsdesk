// next-24q-ready (20-Oct-2026). Leads Insurance's Form 138 (24Q) after next-24q-load went live: "in private window it is
// not showing.. sometimes in normal window 24Q is not showing", then "now automatically showing". The payroll was read
// only by the copy's own read (TCloud.load, src/js/49): after every day of the books in a new browser (a private window
// keeps no copy), never for a big book, not at all when that read was skipped (busy, the cloud's answer late) until the
// once-a-minute look; and a payroll kept in this browser was taken as it was (any shape, any months). Form 138 was drawn
// meanwhile from the books' one "TDS 192B" row a month, under the salary sheet's screen.
// Now (kept in the React bundle: legacy.js is at its size budget; put on window for TCloud.load):
//   - PayLoad.ensure(b, book, again): reads the client's payroll from FinCom's copy of Tally when the books here have none
//     that is right (PayLoad.ok), one read at a time (every caller shares the one in flight); then Payroll.carry, saved
//     here (never sent to the firm's database: BookSync.FROM_TALLY) and the page drawn again. Called by every 24Q page
//     (Return24, Salary) when it opens and by TCloud.load when nothing in the books changed. A read that fails is said
//     with Try again (PayLoad.Wait).
//   - PayLoad.ok(b, book): a payroll kept here is used only when it is this book's, of the shape Payroll.take makes, and
//     holds every payroll entry the books carry (a payroll read before May's entry came is read again).
//   - PayLoad.waiting(b): "loading" while a Tally-linked client's payroll is not here yet or being read, "error" when the
//     read failed, else "": the 24Q pages show "Reading payroll from FinCom's copy of Tally…" instead of the salary sheet's
//     screen or empty tables.
import { createElement as h } from "react";

const PayLoad = {
  // the books as opened (S.books) -> {state: "checking" | "loading" | "done" | "none" | "error", p, err, done: the book
  // read}: a client opened again (a new S.books) is checked again
  st: new WeakMap(),
  of(b) { let s = this.st.get(b); if (!s) this.st.set(b, s = {}); return s; },
  on() { return typeof TCloud === "object" && TCloud.on(); },
  bookOf(cid) { const bk = typeof TCloud === "object" ? TCloud.book(cid) : null; return bk && !/^Zoho Books · /.test(String(bk.company || "")) ? bk : null; },
  ok(b, book) {
    const p = b && b.payroll, obj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
    if (!obj(p) || !book || p.book !== book) return false;
    if (!Array.isArray(p.employees) || !Array.isArray(p.allocs) || !Array.isArray(p.pays) || !obj(p.heads) || !obj(p.vouchers)) return false;
    if (p.allocs.some((a) => !a || !a.guid || !a.day || !a.head || !a.employee || typeof a.amt !== "number")) return false;
    // every live payroll entry the books carry is in it (one read before a month's entry came lacks that month)
    return !(b.vouchers || []).some((v) => v && v.id && /payroll/i.test(String(v.type || "")) && !v.cancel && !v.opt && !p.vouchers[v.id]);
  },
  waiting(b) {
    if (!b || !b.cid || b.loading || (b.salary || []).length || !this.on()) return "";
    const s = this.of(b);
    if (s.state === "error") return "error";
    if (s.state === "checking" || s.state === "loading") return "loading";
    if (s.state === "none") return "";
    const bk = this.bookOf(b.cid), known = TCloud.st[b.cid] && Array.isArray(TCloud.st[b.cid].books);
    // the cloud not asked yet: ensure asks it; a whole payroll kept here is shown meanwhile (read again if not this book's)
    if (!bk) return known || s.state || this.ok(b, (b.payroll || {}).book) ? "" : "loading";
    return this.ok(b, bk.book) || s.done === bk.book ? "" : "loading";
  },
  ensure(b, book, again) {
    b = b || S.books;
    if (!b || !b.cid || b.loading || !this.on()) return Promise.resolve(false);
    const cid = b.cid, s = this.of(b);
    if (s.p) return s.p;
    const bk0 = book ? { book } : this.bookOf(cid);
    if (bk0 && !again && (this.ok(b, bk0.book) || s.done === bk0.book)) { s.state = "done"; return Promise.resolve(false); }
    s.state = "checking"; s.err = "";
    s.p = (async () => {
      try {
        let bk = bk0;
        if (!bk) {
          const list = await TCloud.status(cid);
          bk = (Array.isArray(list) ? list : []).find((x) => x && x.from) || null;
          if (bk && /^Zoho Books · /.test(String(bk.company || ""))) bk = null;
        }
        if (!bk) { s.state = "none"; return false; }
        if (!again && (this.ok(b, bk.book) || s.done === bk.book)) { s.state = "done"; return false; }
        s.state = "loading"; this.draw();
        await Payroll.into(b, bk.book);
        s.done = bk.book; s.state = "done";
        if (S.books !== b) return false;
        const n = Payroll.carry(b);
        if (typeof LK === "object") LK.cache = {};
        try { TDSReg.forget(); } catch (e) { /* */ }
        saveBooks(n ? null : { fromCloud: true });
        return true;
      } catch (e) {
        s.state = "error"; s.err = String((e && e.message) || e).replace(/[.\s]+$/, "");
        return false;
      } finally { s.p = null; this.draw(); }
    })();
    return s.p;
  },
  draw() { try { render(); } catch (e) { /* */ } },
};

// the 24Q pages while the payroll is read, or after its read failed
PayLoad.Wait = function Wait({ b, state }) {
  if (state === "error") {
    const s = PayLoad.of(b);
    return h("section", { className: "dash-card", style: { maxWidth: 760 }, "data-pay-load-err": "" },
      h("p", { className: "note warn" }, "Could not read the payroll from FinCom's copy of Tally" + (s.err ? ": " + s.err : "") + ". ",
        h("button", { className: "btn small", "data-pay-retry": "", onClick: () => PayLoad.ensure(b, null, true) }, "Try again")));
  }
  return h("div", { className: "lt-loading", "data-loading": "", "data-pay-loading": "", "aria-busy": "true", role: "status" },
    h("div", { className: "lt-loading-t" }, "Reading payroll from FinCom's copy of Tally…"),
    h("div", { className: "lt-skel", "aria-hidden": "true" }, [0, 1, 2, 3].map((i) => h("div", { key: i, className: "skel-row" }, [0, 1, 2, 3, 4].map((j) => h("span", { key: j, className: "skel" }))))));
};

// a 24Q page's first line: its payroll asked for when it opens; the loader or the failed read in its place meanwhile
export function payWait(b) {
  const state = PayLoad.waiting(b);
  const s = b && b.cid && !b.loading && PayLoad.on() ? PayLoad.of(b) : null;
  if (s && !s.p && (state === "loading" || !s.state)) setTimeout(() => PayLoad.ensure(b), 0);
  return state;
}

window.PayLoad = PayLoad;
export default PayLoad;
