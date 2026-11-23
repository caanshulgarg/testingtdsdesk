/* ================================================================== */
/* Document inbox: kind = 'inbox'. The Poster says "a file arrived";  */
/* FinCom reads it and owns the status after that.                   */
/* ================================================================== */
S.docq = S.docq || {};
S.docqLocal = S.docqLocal || {};          // this computer's own progress: reading, or why a read failed. Never written back.
function docqState(d){ return (S.docqLocal[d.id] || {}).state || ""; }
function docqFor(cid){ return Object.values(S.docq).filter(d => (d.client_id || "") === (cid || "") && d.status === "waiting").sort((a, b) => String(a.receivedAt || a.createdAt).localeCompare(String(b.receivedAt || b.createdAt))); }
function docqCount(cid){ return docqFor(cid).length; }
function docqExpired(d){ return d.urlExpiresAt && new Date(d.urlExpiresAt).getTime() < Date.now(); }
let docqAt = 0;
async function loadDocq(force){
  if (!Cloud.on()) return;
  if (!force && Date.now() - docqAt < 60000) return;
  docqAt = Date.now();
  try {
    const rows = await Cloud.api("records?kind=eq.inbox&deleted=eq.false&select=id,client_id,data,updated_at&order=updated_at.desc&limit=1000");
    const sig = () => Object.values(S.docq).map(d => d.id + d.status + d.client_id + (d.urlExpiresAt || "")).sort().join();
    const before = sig();
    const next = {};
    [].concat(rows || []).filter(cloudRowOk).forEach(r => { next[r.id] = cleanIds(Object.assign({}, r.data, {id: r.id, client_id: r.client_id || ""}), 0); });
    S.docq = next;
    if (sig() !== before) render();
  } catch (e){ /* the inbox is best effort; the rest of the app keeps working */ }
}
// FinCom writes back only what the spec gives it: status and entryId (and the client, if staff move an unsorted file)
async function docqSave(d, patch){
  const cur = Object.assign({}, d, patch || {});
  const data = Object.assign({}, cur); delete data.client_id;
  S.docq[d.id] = cur;
  await Cloud.api("records?on_conflict=firm_id,kind,id", {method: "POST", headers: {Prefer: "resolution=merge-duplicates,return=minimal"},
    body: [{firm_id: Cloud.st.firm, kind: "inbox", id: d.id, client_id: cur.client_id || "", data, deleted: false}]});
}
async function docqFile(d){
  if (docqExpired(d)) throw new Error("the link has expired; it is refreshed shortly by office automation");
  if (!d.url) throw new Error("no link to the file yet");
  const r = await fetch(d.url);                          // a signed link: no key, no header
  if (!r.ok) throw new Error("the file could not be opened (" + r.status + ")");
  const blob = await r.blob();
  return new File([blob], d.fileName || "document", {type: d.mimeType || blob.type || "application/octet-stream"});
}
function localSet(id, state, msg, extra){ S.docqLocal[id] = Object.assign({state, msg: msg || ""}, extra || {}); }
// read waiting files through the normal pipeline: free reading, OCR, checks and the usual charge
async function readDocq(ids, cid, opts){
  const force = !!(opts && opts.force);
  const list = ids.map(id => S.docq[id]).filter(d => d && d.status === "waiting" && docqState(d) !== "reading");
  if (!list.length) return;
  const bills = [], banks = [];
  for (const d of list){
    const co = CO(d.client_id || cid);
    // already entered? the hash tells before anything is read or charged
    const c3 = d.client_id || cid;
    if (c3 && !D(c3).loaded){ try { await Store.loadCompany(c3); } catch (e){} }      // know this client's bills before judging duplicates
    const seen = c3 && d.fileHash && liveHashRec(c3, d.fileHash);
    if (seen && !force){ localSet(d.id, "dup", "", {entryId: seen.e, cid: c3}); continue; }
    localSet(d.id, "reading");
    try {
      const f = await docqFile(d);
      const h = await fileHash(f);
      const seen2 = c3 && liveHashRec(c3, h);
      if (seen2 && !force){ localSet(d.id, "dup", "", {entryId: seen2.e, cid: c3}); continue; }
      f.__docq = d.id;
      if (force) f.__force = true;
      if (d.docKind === "bank") banks.push({d, f}); else bills.push(f);          // docKind is only a hint: the reader decides the rest
    } catch (e){ localSet(d.id, "failed", e.message); }
  }
  render();
  if (bills.length) await enqueueFiles(bills, cid || "auto");
  for (const x of banks){
    const c2 = x.d.client_id || cid;
    if (!c2){ localSet(x.d.id, "failed", "Bank statements need a client: assign it first."); continue; }
    if (S.coId !== c2) await openCompany(c2);
    S.tab = "bank"; await loadBank(c2);
    const before = (S.bank.stmts || []).length;
    try { await uploadStatements([x.f]); } catch (e){}
    if ((S.bank.stmts || []).length > before){ localSet(x.d.id, ""); await docqSave(x.d, {status: "read", entryId: S.bank.stmts[S.bank.stmts.length - 1].id}).catch(() => {}); }
    else localSet(x.d.id, "failed", "The statement could not be read, or it was uploaded before.");
  }
  render();
}
// called when a job that came from the inbox finishes. A PDF of several bills is several jobs of the one file: the file
// is read once every one of them has finished, and only when each was (a part not read is named; audit of 22-Nov-2026:
// the first part to finish marked the whole file read). A file the reader sent to Sales or to Unsorted uploads
// (unsorted) was handled there: read, not waiting for ever as "Not read"
function docqFinish(j){
  const id = j.file && j.file.__docq;
  const d = id && S.docq[id];
  if (!d) return;
  const all = (S.jobs || []).filter(x => x.file === j.file).concat((S.jobs || []).includes(j) ? [] : [j]);
  if (all.some(x => ["waiting", "checking", "reading"].includes(x.status))) return;
  // held: read, and kept for you to confirm as a possible duplicate
  const ok = x => ["done", "partial", "unsorted"].includes(x.status) || (x.status === "held" && x.entryId);
  const bad = all.filter(x => !ok(x) && x.status !== "duplicate"), got = all.find(x => x.entryId);
  if (!bad.length && all.some(ok)){
    localSet(id, "");
    docqSave(d, {status: "read", entryId: (got && got.entryId) || null, client_id: d.client_id || (got && got.cid) || j.cid || "", ...(all.some(x => x.status === "unsorted") ? {note: all.map(x => x.msg).filter(Boolean).join("; ")} : {})}).catch(() => {});
  } else if (!bad.length){
    const r = j.dupRef || (all.find(x => x.dupRef) || {}).dupRef;
    localSet(id, "dup", j.msg || "", {entryId: (r && (r.entryId || r.e)) || "", cid: (r && r.cid) || d.client_id});
  // (a part of several: reading the file again here finds the parts read as duplicates, so Retry or Type it in on that part)
  } else localSet(id, "failed", all.length > 1 ? bad.map(x => x.name + ": " + (x.msg || "could not be read")).join("; ") + ". Use Retry or Type it in on " + (bad.length > 1 ? "those parts" : "that part") : j.msg || "could not be read");        // stays waiting; staff can try again
  softRender();
}
async function setAsideDocq(id){
  const d = S.docq[id]; if (!d) return;
  await docqSave(d, {status: "ignored"}).catch(e => toast(e.message));
  toast("Set aside. It will not be read.");
  render();
}
async function assignDocq(id, cid){
  const d = S.docq[id]; if (!d || !CO(cid)) return;
  await docqSave(d, {client_id: cid}).catch(e => toast(e.message));
  toast("Moved to " + CO(cid).name + "\u2019s inbox.");
  render();
}
/* ---------- on screen ---------- */
/* ---------- drop keys: how the agent is allowed to send files in ---------- */
// Documents in the firm account: switched on or off, how long they are kept, and what is held

// the document inbox panel and the upload block are React (app/src/parts/Docq.jsx, UploadBlock.jsx)
function readDocqNow(id, cid, force){ if (force) S.docqLocal[id] = {}; readDocq([id], cid, force ? {force: true} : undefined); }
// the bill list, a bill and the vendor reconciliation are React (app/src/screens/Invoices.jsx, Bill.jsx, VendorRecon.jsx)

/* ---------- Client: deductees ---------- */
// the deductees of a client: React (app/src/screens/Parties.jsx)
