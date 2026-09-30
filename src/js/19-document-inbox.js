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
// called when a job that came from the inbox finishes
function docqFinish(j){
  const id = j.file && j.file.__docq;
  const d = id && S.docq[id];
  if (!d) return;
  if (j.status === "done" || j.status === "partial" || (j.status === "held" && j.entryId)){      // held: read, and kept for you to confirm as a possible duplicate
    localSet(id, "");
    docqSave(d, {status: "read", entryId: j.entryId || null, client_id: d.client_id || j.cid || ""}).catch(() => {});
  } else if (j.status === "duplicate"){
    localSet(id, "dup", j.msg || "", {entryId: (j.dupRef && (j.dupRef.entryId || j.dupRef.e)) || "", cid: (j.dupRef && j.dupRef.cid) || d.client_id});
  } else localSet(id, "failed", j.msg || "could not be read");        // stays waiting; staff can try again
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
function viewDocsSettings(){
  if (!Cloud.on()) return "";
  const a = S.account, owner = a && ((a.me || {}).role === "owner" || a.superadmin);
  const on = S.firm.cloudDocs !== false, years = num(S.firm.docYears || 3);
  const u = S.docUsage;
  let h = '<h3 style="margin:16px 0 6px;font-size:15px">Documents in the firm account</h3>' +
    '<p class="note" style="margin:0 0 8px">Bills, sales invoices and bank statements are kept with the firm, so anyone in the firm can open them from Transactions on any computer. Photos are shrunk to reading size first, and nothing is kept for a bill marked \u201cno entry\u201d or held as a duplicate.</p>' +
    '<label class="chk"><input type="checkbox" data-act-toggle="cloudDocs"' + (on ? " checked" : "") + "> Keep documents in the firm account</label>";
  if (on && owner){
    h += '<label class="f" style="max-width:280px"><span>Keep them for</span><select data-firmset="docYears">' +
      [1, 3, 5, 7, 0].map(y => '<option value="' + y + '"' + (years === y ? " selected" : "") + ">" + (y ? y + " year" + (y === 1 ? "" : "s") : "as long as the client is here") + "</option>").join("") + "</select></label>";
  }
  if (on){
    h += '<div class="row" style="gap:8px;margin-top:6px"><button class="btn small" data-act="docUsage">' + (u ? "Refresh" : "How much is stored?") + "</button>" +
      (S.coId && S.companies[S.coId] ? '<button class="btn small" data-act="docSendPending">Send documents still on this computer for ' + esc(S.companies[S.coId].name) + "</button>" : "") +
      (owner && years ? '<button class="btn small" data-act="docTidy">Clear out documents older than ' + years + " year" + (years === 1 ? "" : "s") + "</button>" : "") + "</div>";
    if (u) h += '<p class="note">' + u.files + " document" + (u.files === 1 ? "" : "s") + " \u00b7 " + (u.bytes > 1073741824 ? (u.bytes / 1073741824).toFixed(2) + " GB" : Math.round(u.bytes / 1048576) + " MB") +
      (u.oldest ? " \u00b7 oldest " + fmtDate(String(u.oldest).slice(0, 10)) : "") + ". The plan includes 100 GB.</p>";
  }
  return h;
}
function viewDropKeys(){
  if (!Cloud.on()) return "";
  const a = S.account, owner = a && ((a.me || {}).role === "owner" || a.superadmin);
  if (!owner) return "";
  const keys = S.dropKeys;
  const url = Cloud.cfg().url.replace(/\/+$/, "") + "/functions/v1/inbox-drop";
  let h = '<h3 style="margin:16px 0 6px;font-size:15px">Document inbox: keys for the agent</h3>' +
    '<p class="note" style="margin:0 0 6px">A drop key lets office automation add waiting documents to a client\u2019s inbox, and refresh their links. The database refuses anything else: it cannot read, change entries, see other firms, or post to Tally. Switch a key off at any time.</p>' +
    '<div class="row"><button class="btn small" data-act="dropKeysList">' + (keys ? "Refresh" : "Show keys") + '</button><button class="btn small primary" data-act="dropKeyNew">Make a key</button></div>';
  if (S.newDropKey){
    const rpc = Cloud.cfg().url.replace(/\/+$/, "") + "/rest/v1/rpc/post_inbox";
    h += '<div class="bigwarn" style="border-color:var(--ledger)"><b>Copy this key now. It will not be shown again.</b>' +
      '<div style="margin-top:6px"><code style="font-size:13px;user-select:all">' + esc(S.newDropKey) + "</code></div>" +
      '<div style="margin-top:8px">The Poster adds one waiting document with one call:</div>' +
      '<pre style="white-space:pre-wrap;font-size:12px;background:var(--paper);padding:8px;border-radius:6px;user-select:all">POST ' + esc(rpc) +
      "\nHeader  apikey: " + esc(Cloud.cfg().key) + "\nHeader  Content-Type: application/json\nBody\n{\n  \"p_key\": \"" + esc(S.newDropKey) + "\",\n  \"p_id\": \"&lt;intake uuid&gt;\",\n  \"p_client_id\": \"&lt;FinCom client id&gt;\",\n  \"p_data\": { \"fileName\": ..., \"fileHash\": ..., \"url\": ..., \"urlExpiresAt\": ..., ... }\n}" +
      "\n\nRefresh a link:  POST .../rest/v1/rpc/refresh_inbox_link\n{ \"p_key\": ..., \"p_id\": ..., \"p_url\": ..., \"p_expires_at\": ... }</pre>" +
      '<button class="linkbtn" data-act="dropKeyHide">I have copied it</button></div>';
  }
  if (keys && keys.length){
    h += '<div class="tblwrap" style="margin-top:8px"><table class="data"><thead><tr><th>Label</th><th>Ends in</th><th>Made</th><th class="n">Files sent</th><th>Last used</th><th></th></tr></thead><tbody>' +
      keys.map(k => "<tr" + (k.active ? "" : ' style="opacity:.55"') + "><td>" + esc(k.label) + "</td><td>\u2026" + esc(k.hint) + "</td><td>" + fmtDate(String(k.created_at).slice(0, 10)) +
        '</td><td class="n">' + (k.uses || 0) + "</td><td>" + (k.last_used ? fmtDate(String(k.last_used).slice(0, 10)) : "\u2014") + "</td><td>" +
        (k.active ? '<button class="linkbtn" data-dropoff="' + k.id + '">Switch off</button>' : "off") + "</td></tr>").join("") + "</tbody></table></div>";
  } else if (keys) h += '<p class="note" style="margin-top:6px">No keys yet.</p>';
  return h;
}

// the document inbox panel and the upload block are React (app/src/parts/Docq.jsx, UploadBlock.jsx)
function docqPanel(cid){ return Cloud.on() && docqFor(cid).length ? '<div data-react="DocqPanel" data-cid="' + esc(cid || "") + '"></div>' : ""; }
function uploadBlock(co){ return '<div data-react="UploadBlock"></div>'; }
function readDocqNow(id, cid, force){ if (force) S.docqLocal[id] = {}; readDocq([id], cid, force ? {force: true} : undefined); }
// the bill list, a bill and the vendor reconciliation are React (app/src/screens/Invoices.jsx, Bill.jsx, VendorRecon.jsx)
function viewInvoices(){
  if (VR.st()) return '<div data-react="VendorRecon"></div>';
  if (S.reviewTable && S.filter === "draft") return viewReviewTable();
  return '<div data-react="Invoices"></div>';
}
function viewDetail(e){ return '<div data-react="BillDetail" data-id="' + esc(e.id) + '"></div>'; }

/* ---------- Client: deductees ---------- */
// the deductees of a client: React (app/src/screens/Parties.jsx)
function viewParties(){ return '<div data-react="Parties"></div>'; }
