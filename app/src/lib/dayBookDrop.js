// next-tally-daybook (07-Nov-2026): a Day Book (or ledger masters) file dropped on one client's Entries card on the Tally
// page (TallyProgress.jsx, DayBookDrop), read into THAT client's books: loaded on the first drop (its own chunk).
// Review of 0b3c34839 (A1-A6): the open client is never swapped. Every step takes its target explicitly, for the whole read:
//   cid    the client dropped on, fixed when the file is dropped;
//   co     its client record (S.companies[cid]), never CO(): the company check (companyGate), the PAN check
//          (notThisClient / panRefusal) and the Tally company sent with the file are that client's;
//   bb     its books: the open books only when they ARE that client's (S.books.cid === cid), else its copy kept in this
//          browser (Books.load, after BookSync's pull of its work), never S.books; picked again just before the entries
//          go in, so a client opened meanwhile (the switcher) never takes them, and saved by bb.cid (saveBooks(null, bb));
//   who    {client: cid, company} for FinCom's cloud (TCloudUp.handOver) and this browser's copy of the file.
// S.coId, S.books and CO() of the client open are not read for the target and never written. Taken here: Day Book and
// ledger masters (XML, Tally's JSON, a zip of them). A trial balance, an Excel or a PDF file: Books › From Tally.
// The Tally page draws one drop at a time (every other box says "Another file is being read…").
/* global S, Books, BookSync, Prefetch, TCloudUp, TallyRead, LedMaster, BridgeSeed, Bridge, companyGate, notThisClient, panRefusal,
   tallyFileKind, tallyOpenFiles, tallyCloudSend, saveBooks, DayCut, fmtDate, tallyDate, clone, render, toast */

const why = (e) => String((e && e.message) || e).replace(/[.\s]+$/, "");
const nIN = (n) => Number(n || 0).toLocaleString("en-IN");
const fresh = (cid) => ({ cid, vouchers: [], map: {}, challans: [], alloc: {}, pans: {} });
const mayChange = () => !(S.account && S.account.me) || ["owner", "staff"].includes(S.account.me.role);
const NOT_HERE = /\.(xlsx|xlsm|xls|csv|pdf)$/i;
const TB_WORDS = "drop a trial balance on Books › From Tally";

// the target's books. The open books are taken only when they are this client's and open (they ARE its books: written
// there, the screen and the next save keep the entries); books being opened are waited for by nobody here: refused
async function booksOf(cid) {
  if (typeof Prefetch === "object" && Prefetch && Prefetch.cur === cid) { try { await Prefetch.rush(cid); } catch (e) {} }
  for (let i = 0; i < 3; i++) {
    if (S.books && S.books.cid === cid) {
      if (S.books.loading) throw new Error("its books are being opened on this page just now; drop the file again once they are open");
      return { bb: S.books, live: true };
    }
    const saved = await Books.load(cid);
    if (S.books && S.books.cid === cid) continue;       // opened meanwhile: those books, not this copy
    return { bb: saved && saved.cid === cid ? clone(saved) : fresh(cid), live: false };
  }
  throw new Error("its books were opened and closed meanwhile; drop the file again");
}

// what companyGate reads of the books (the Tally company their files came from), without copying them
async function tallyCoOf(cid) {
  if (S.books && S.books.cid === cid) { if (S.books.loading) throw new Error("its books are being opened on this page just now; drop the file again once they are open"); return { tallyCo: S.books.tallyCo }; }
  const saved = await Books.load(cid);
  return { tallyCo: saved && saved.cid === cid ? saved.tallyCo : undefined };
}

// the work kept in FinCom's database (confirmed ledgers, PANs) brought into this browser's copy first, so the entries
// are put beside it and never over it (BookSync / BookItems write that copy, not the open books, for another client)
async function workIn(cid, step) {
  if (S.books && S.books.cid === cid) return;
  if (typeof BookSync !== "object" || !BookSync.on()) return;
  step("Bringing in this client’s work from FinCom…");
  try { await BookSync.pull(cid); } catch (e) {}
}

// the entries go in: the books picked again now (a client opened meanwhile), the company checked again on them (quietly:
// the person answered above), then put in and saved by this client's id, with nothing awaited in between
async function intoBooks(cid, co, fc, fname, put) {
  const { bb, live } = await booksOf(cid);
  const g = await companyGate(fc, bb, co, fname, true);
  if (!g.ok) return { refused: g.why };
  if (S.books && S.books.cid === cid && S.books !== bb) return { refused: "its books were opened meanwhile; drop the file again" };
  const r = put(bb, live);
  if (fc && (fc.name || fc.guid) && !bb.tallyCo) bb.tallyCo = { name: fc.name, guid: fc.guid };
  await saveBooks(null, bb);
  return Object.assign({ bb, live }, r);
}

async function dayBook(cid, co, f, fc, step) {
  let res;
  try { res = await Books.importDayBook(f, step); } catch (e) { return { refused: "could not read it: " + why(e) }; }
  const bad = notThisClient((res.meta || {}).gstins, co);
  if (bad.length) return { refused: panRefusal("The day book " + f.name, bad, co).replace(/[.\s]+$/, "") };
  const ds = res.vouchers.map((v) => v.date).filter(Boolean).sort();
  if (!ds.length) return { refused: "there are no entries in " + f.name };
  const from = ds[0], to = ds[ds.length - 1];
  let part = null;
  const r = await intoBooks(cid, co, fc, f.name, (b, live) => {
    if (!(b.vouchers || []).length) { b.vouchers = res.vouchers; b.meta = Object.assign(res.meta, { from, to }); }
    else TallyRead.merge(b, { vouchers: res.vouchers, meta: res.meta }, from, to);
    b.meta.at = new Date().toISOString(); b.meta.file = "day book files from Tally";
    part = { from, to, n: res.vouchers.length, file: f.name, at: b.meta.at };
    b.meta.parts = (b.meta.parts || []).filter((p) => !(p.from >= from && p.to <= to)).concat([part]);
    b.map = Books.mapLedgers(b.vouchers, b.map);
    // (LedMaster and TallyRead.after read the open books: only for the open books; another client's are worked out when opened)
    if (live) { try { LedMaster.refresh(b); } catch (e) {} TallyRead.after(b, "after the day book was read", { from: b.meta.from, to: b.meta.to }); }
    else { try { TallyRead.cleanNames(b); } catch (e) {} }
  });
  if (r.refused) return r;
  if (r.live) render();
  send(cid, co, f, r.bb, part);
  return { n: part.n, from, to };
}

// the same file to FinCom's cloud (for this client: who) and to the bridge's copy, after the entries are in, in the
// background as Books › From Tally does; the part's line is saved with these books, never the open client's
function send(cid, co, f, bb, part) {
  const who = { client: cid, company: Bridge.tallyName(co) }, range = { from: part.from, to: part.to };
  (async () => {
    const wait = TCloudUp.keep(cid, f, range); part.wait = wait;
    const held = f.size > DayCut.PIECE ? Promise.resolve() : TCloudUp.hold(cid, f, range, who).catch(() => {});
    try {
      if (TCloudUp.on()) await tallyCloudSend(bb, part, f, wait, who, () => {}, held);
      else part.cloud = "waiting: it goes to FinCom’s cloud once you sign in to the firm account";
    } catch (e) { part.cloud = TCloudUp.notSent(e); part.again = true; }
    if (Bridge.on()) {
      try { const x = await BridgeSeed.send(f, null, range, who.company); part.bridge = x && x.entries != null ? "filled (" + x.entries + ")" : x && x.skipped ? "not changed: " + x.skipped : ""; }
      catch (e) { part.bridge = "not taken: " + why(e); }
    } else part.bridge = "not connected on this computer";
    await partSaid(cid, bb, part);
  })().catch(() => {});
}
// the part's cloud and bridge lines kept with this client's books as they are NOW (opened, changed or closed since the
// entries went in): only that part's lines are changed, by this client's id; never the copy taken at the drop over them
async function partSaid(cid, bb, part) {
  try {
    const cur = S.books && S.books.cid === cid ? (S.books.loading ? null : S.books) : bb === S.books ? bb : await Books.load(cid);
    if (!cur || cur.cid !== cid) return;
    const p = ((cur.meta || {}).parts || []).find((x) => x === part || (x.file === part.file && x.from === part.from && x.to === part.to && x.at === part.at));
    if (!p) return;
    ["wait", "cloud", "again", "bridge"].forEach((k) => { if (part[k] === undefined) delete p[k]; else p[k] = part[k]; });
    await saveBooks(null, cur);
    if (cur === S.books) render();
  } catch (e) {}
}

async function masters(cid, co, f, fc, step) {
  let res;
  try { res = await Books.importMasters(f, step); } catch (e) { return { refused: "could not read it: " + why(e) }; }
  const r = await intoBooks(cid, co, fc, f.name, (b, live) => {
    b.pans = res.pans; b.gstins = res.gstins; b.under = res.under; b.states = res.states; b.groups = res.groups; b.groupInfo = res.groupInfo;
    TallyRead.yearOpen(b); b.ledInfo = res.info; b.ledInfoAt = new Date().toISOString();
    if (live) { try { LedMaster.refresh(b); } catch (e) {} }
  });
  if (r.refused) return r;
  if (r.live) render();
  return { count: res.count, pans: Object.keys(res.pans).length, gstins: Object.keys(res.gstins || {}).length };
}

// files: those dropped or chosen; o.say({ok, text}) a result line, o.step(text) the progress line (both for this box only)
export async function dropDayBook(cid, files, o) {
  const say = o.say, step = o.step || (() => {});
  const co = S.companies && S.companies[cid];
  if (!co) { say({ ok: false, text: "This client is not in the firm’s list any more." }); return; }
  if (!mayChange()) { say({ ok: false, text: "A member of the firm who may make changes uploads a Day Book." }); return; }
  files = Array.from(files || []);
  if (!files.length) { say({ ok: false, text: "No file came with that: drop the XML, JSON or zip file itself (exported from Tally), not a link or a folder." }); return; }
  const seen = [];
  step("Opening " + (files.length === 1 ? files[0].name : files.length + " files") + "…");
  const open = [];
  for (const f of files) {
    if (NOT_HERE.test(f.name || "")) seen.push([f, { kind: "", why: f.name + " is not a Day Book: " + (/\.pdf$/i.test(f.name) ? "drop the Day Book exported from Tally as XML or JSON" : "for a trial balance, " + TB_WORDS) + "." }]);
    else open.push(f);
  }
  for (const x of await tallyOpenFiles(open, step)) {
    if (!x.file) { seen.push([{ name: x.name }, { kind: "", why: x.why }]); continue; }
    let k; try { k = await tallyFileKind(x.file); } catch (e) { k = { kind: "", why: "Could not read " + x.file.name + ": " + why(e) }; }
    seen.push([x.file, k]);
  }
  const order = { masters: 0, daybook: 1, tb: 2, "": 3 };
  seen.sort((a, b) => order[a[1].kind] - order[b[1].kind]);
  for (const [f, k] of seen) {
    if (!k.kind) { say({ ok: false, text: k.why }); continue; }
    if (k.kind === "tb") { say({ ok: false, text: f.name + " is a trial balance: " + TB_WORDS + "." }); continue; }
    step("Reading " + f.name + "…");
    let fc = null; try { fc = await Books.fileCompany(f); } catch (e) {}
    await workIn(cid, step);
    // the company check before anything is read (asked when the file's company is not plainly this client's), on these books
    let gate;
    try { gate = await companyGate(fc, await tallyCoOf(cid), co, f.name); } catch (e) { gate = { ok: false, why: why(e) }; }
    if (!gate.ok) { say({ ok: false, text: (k.kind === "masters" ? "The ledger masters were" : "The Day Book was") + " not taken: " + gate.why + "." }); continue; }
    if (k.kind === "masters") {
      const r = await masters(cid, co, f, fc, step);
      say(r.refused ? { ok: false, text: "The ledger masters were not taken: " + r.refused + "." }
        : { ok: true, text: "Read the ledger masters: " + nIN(r.count) + " ledgers (" + r.pans + " with PAN, " + r.gstins + " with GSTIN)." });
      continue;
    }
    const r = await dayBook(cid, co, f, fc, step);
    if (r.refused) { say({ ok: false, text: "The Day Book was not taken: " + r.refused + "." }); continue; }
    let days = 0; for (let d = r.from; d <= r.to; d = BridgeSeed.add(d, 1)) days++;
    say({ ok: true, text: "Read " + nIN(r.n) + (r.n === 1 ? " entry" : " entries") + " for " + fmtDate(tallyDate(r.from)) + " to " + fmtDate(tallyDate(r.to)) + "; " + days + (days === 1 ? " day" : " days") + " updated. It goes to FinCom’s cloud now." });
  }
}
