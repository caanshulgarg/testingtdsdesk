// Tally tell (the owner, 24-Nov-2026: "There should be proper way to tell and auto import of tally days into fincom"; plan
// tally-tell-autoday-plan.md, part A). FinCom's cloud works out ONE plain sentence for each linked book, with its one action,
// and one line for each computer (migration 221, tally_tell_view(): {ok, at, books: [...], computers: [...]}); this file
// fetches it (cached 60 s; one call), and the 'tell' rows of the bell that are still open (tally_alerts kind 'tell',
// cleared_at null). Its own small file, fetched by the Tally icon once the app is drawn (never in the app's first file).
// A cloud without 221 (the function or the column missing), or any failure: nothing new is shown anywhere, and no error;
// it is asked again after 10 minutes. The words are the cloud's, shown as given (A.1's word table lives in 221 only).
//   book(cid, company)  the client's book: {book, client, company, cause, read, post, changes, days, since, affected, earlier}
//   device(id)          the computer's line: {device, computer, code, words, fix, at, mine}
//   icon(co)            the header's Tally sign for a fault: {icon, word, line, tell} (A.3.2), else null
//   chip(co)            the client chip's title: the sentence, else ""
//   bell(unread)        the bell's items for the open 'tell' rows (unread: the tally_alerts rows the bell already read)
const T = { firm: "", v: null, at: 0, busy: false, wait: 60000, open: null, openAt: 0, openWait: 0, openBusy: false };
const FAIL_MS = 600000;
const live = () => typeof TCloud === "object" && TCloud.on && TCloud.on() && typeof Cloud === "object" && !!(Cloud.st && Cloud.st.firm);
const visible = () => typeof document !== "object" || document.visibilityState !== "hidden";
const firm = () => { const f = Cloud.st.firm; return f && typeof f === "object" ? String(f.id || "") : String(f || ""); };
const redraw = () => { if (typeof soonRender === "function") soonRender(); else if (typeof render === "function") render(); };
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

// (the review of 25-Nov-2026) the cache is the firm's: another firm signed in starts afresh, its first firm's words never shown
function sameFirm() { if (!live()) return false; const f = firm(); if (f !== T.firm) { forget(); T.firm = f; } return true; }
export function load(force) {
  if (!sameFirm() || T.busy || (!force && (Date.now() - T.at < T.wait || !visible()))) return;
  T.busy = true; T.at = Date.now();
  const f = T.firm;
  Promise.resolve().then(() => TCloud.rpc("tally_tell_view", {})).then((j) => {
    if (f !== T.firm) return;
    const ok = !!(j && j.ok && Array.isArray(j.books));
    T.v = ok ? { books: j.books, computers: Array.isArray(j.computers) ? j.computers : [], at: j.at } : null; T.wait = ok ? 60000 : FAIL_MS;
  }, () => { if (f === T.firm) { T.v = null; T.wait = FAIL_MS; } }).finally(() => { T.busy = false; redraw(); });
  loadOpen();
}
// the bell's 'tell' rows not cleared yet (only their ids: the rest is in the rows the bell reads already)
function loadOpen() {
  if (!live() || T.openBusy || Date.now() - T.openAt < T.openWait) return;
  T.openBusy = true; T.openAt = Date.now(); const f = T.firm;
  Promise.resolve().then(() => Cloud.api("tally_alerts?select=id,client_id,book_id,kind,words,data,at,read_at,cleared_at&firm_id=eq." + encodeURIComponent(firm()) + "&kind=eq.tell&cleared_at=is.null&order=at.desc&limit=100"))
    // (a failure, e.g. a cloud without 221's cleared_at: asked again after 10 minutes)
    .then((r) => { if (f !== T.firm) return; T.open = [].concat(r || []).filter((x) => x && x.kind === "tell" && !x.cleared_at); T.openWait = 60000; },
      () => { if (f !== T.firm) return; T.open = null; T.openAt = Date.now(); T.openWait = FAIL_MS; })
    .finally(() => { T.openBusy = false; redraw(); });
}
export const view = () => { load(); return sameFirm() ? T.v : null; };
export function forget() { T.v = null; T.at = 0; T.open = null; T.openAt = 0; T.openWait = 0; T.wait = 60000; }
// ms until the bell's open rows are asked again (tests)
export const nextOpen = () => Math.max(0, T.openAt + T.openWait - Date.now());

export function book(cid, company) {
  const v = view(); if (!v || !cid) return null;
  const all = v.books.filter((b) => b && b.client === cid);
  if (!all.length) return null;
  const k = norm(company);
  return (k && all.find((b) => norm(b.company) === k)) || all.find((b) => b.cause && b.cause.code) || all[0];
}
export function device(id) { const v = view(); return (v && id && v.computers.find((d) => d && d.device === id)) || null; }
export const computers = () => { const v = view(); return v ? v.computers.filter(Boolean) : []; };

// A.3.2: the causes that wait for Tally, and those that need a person (15, 16: the sign stays as it is)
const WAIT = ["bridge_off", "tally_closed", "not_open", "other_login", "other_copy", "no_start"];
const NEEDS = ["not_linked", "no_bridge", "old_bridge", "run_as_admin", "two_tallys", "reading_off", "paused", "read_stopped", "addon_silent"];
export function icon(co) {
  const b = co ? book(co.id, co.tallyName) : null, c = b && b.cause && b.cause.code;
  if (!c || !b.cause.words) return null;
  if (WAIT.includes(c)) return { icon: "waiting", word: "Waiting for Tally", line: b.cause.words, tell: b };
  if (NEEDS.includes(c)) return { icon: "needs", word: "Needs you", line: b.cause.words, tell: b };
  return null;
}
export function chip(co) { const b = co ? book(co.id, co.tallyName) : null; return (b && b.cause && b.cause.words) || ""; }

// the bell (A.3.4): one item an open 'tell' row, its words as given; it goes when the cloud clears it
export function bell(unread) {
  if (!T.open) { load(); return []; }
  const open = new Map(T.open.map((x) => [x.id, x]));
  // (read in the bell's own rows when they hold it; the row read here otherwise)
  const read = new Map([].concat(unread || []).filter((x) => x && x.kind === "tell").map((x) => [x.id, x]));
  return [...open.values()].filter((x) => x.words && !(read.has(x.id) ? read.get(x.id).read_at : x.read_at)).map((x) => {
    const cid = x.client_id || "", code = (x.data && x.data.code) || "";
    return { key: "tell:" + x.id, fp: typeof AlertClear === "object" ? AlertClear.fp(["tell:" + (x.book_id || cid) + ":" + code]) : "", sev: "warn", cid, text: x.words, fix: "", at: x.at, selfClear: true,
      act: cid ? { label: "Open on Tally page", run: () => { if (typeof openTallyFor === "function") openTallyFor(cid); } } : null };
  });
}

if (typeof globalThis === "object") globalThis.FCTell = { load, view, book, device, computers, icon, chip, bell, forget, nextOpen };
