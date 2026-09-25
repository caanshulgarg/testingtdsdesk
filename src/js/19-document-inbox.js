/* ================================================================== */
/* Document inbox: kind = 'inbox'. The Poster says "a file arrived";  */
/* TDS Desk reads it and owns the status after that.                   */
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
    [].concat(rows || []).forEach(r => { next[r.id] = Object.assign({}, r.data, {id: r.id, client_id: r.client_id || ""}); });
    S.docq = next;
    if (sig() !== before) render();
  } catch (e){ /* the inbox is best effort; the rest of the app keeps working */ }
}
// TDS Desk writes back only what the spec gives it: status and entryId (and the client, if staff move an unsorted file)
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
function docqPanel(cid){
  if (!Cloud.on()) return "";
  const list = docqFor(cid);
  if (!list.length) return "";
  const ago = t => { const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return !t ? "" : m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
  const kindTxt = {bill: "bill", purchase: "bill", bank: "bank statement", sales: "sales invoice"};
  return '<section class="docq"><div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">\u{1F4E5} Inbox \u00b7 ' + list.length + " waiting</h3>" +
    '<button class="btn small primary" data-act="docqReadAll">Read all ' + list.length + "</button></div>" +
    '<p class="note" style="margin:4px 0 8px">Files sent in by office automation. They are read the same way as an upload, and charged the same.</p>' +
    '<div class="tblwrap"><table class="data"><thead><tr><th>File</th><th>From</th><th>Received</th><th></th></tr></thead><tbody>' +
    list.map(d => {
      const st = docqState(d), loc = S.docqLocal[d.id] || {}, exp = docqExpired(d);
      return "<tr><td><b>" + esc(d.fileName || "document") + "</b>" + (kindTxt[d.docKind] ? ' <span class="tag" title="A guess from the file name">' + kindTxt[d.docKind] + "?</span>" : "") +
        (d.period ? ' <span class="nr">' + esc(d.period) + "</span>" : "") +
        (st === "reading" ? ' <span class="tag">reading\u2026</span>' : "") +
        (exp ? '<div class="nr">Link expired, refreshing shortly.</div>' : st === "failed" ? '<div class="nr bad">' + esc(loc.msg || "could not be read") + "</div>" : "") +
        (st === "dup" ? (() => { const e0 = loc.entryId && S.data[loc.cid] && S.data[loc.cid].entries[loc.entryId];
          return '<div class="nr bad">Already entered' + (e0 ? ": " + esc(e0.x.vendorName || e0.fileName || "") + (e0.x.invoiceNo ? " bill " + esc(e0.x.invoiceNo) : "") + " (" + esc(statusLabel(e0.status)) + ")" : loc.msg ? ": " + esc(loc.msg) : "") + ".</div>" +
            '<div style="margin-top:4px">' + (e0 ? '<button class="linkbtn" data-openentry="' + loc.entryId + '" data-openco="' + loc.cid + '">Open that bill</button> \u00b7 ' : "") +
            '<button class="linkbtn" data-docqforce="' + d.id + '">Read it anyway</button></div>'; })() : "") + "</td>" +
        "<td>" + esc(d.sender || "") + (d.source ? '<div class="nr">' + esc(d.source) + (d.sourceTicketRef ? " \u00b7 #" + esc(d.sourceTicketRef) : "") + "</div>" : "") + "</td>" +
        "<td>" + ago(d.receivedAt || d.createdAt) + "</td>" +
        '<td style="white-space:nowrap">' + (st === "reading" || st === "dup" || exp ? "" : '<button class="btn small" data-docqread="' + d.id + '">' + (st === "failed" ? "Try again" : "Read") + "</button> ") +
        (cid === "" ? '<select data-docqmove="' + d.id + '"><option value="">Assign to\u2026</option>' + sortedCompanies().map(c => '<option value="' + c.id + '">' + esc(c.name) + "</option>").join("") + "</select> " : "") +
        '<button class="linkbtn" data-docqaside="' + d.id + '" title="Covering letter, duplicate or not for entry">Not for entry</button></td></tr>';
    }).join("") + "</tbody></table></div></section>";
}
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
      "\nHeader  apikey: " + esc(Cloud.cfg().key) + "\nHeader  Content-Type: application/json\nBody\n{\n  \"p_key\": \"" + esc(S.newDropKey) + "\",\n  \"p_id\": \"&lt;intake uuid&gt;\",\n  \"p_client_id\": \"&lt;TDS Desk client id&gt;\",\n  \"p_data\": { \"fileName\": ..., \"fileHash\": ..., \"url\": ..., \"urlExpiresAt\": ..., ... }\n}" +
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

function uploadBlock(co){
  const d = D();
  return '<div class="drop" id="drop" tabindex="0" role="button" aria-label="Upload invoices for ' + esc(co.name) + '"><strong>Upload for ' + esc(co.name) + '</strong><div class="note">Drop any number of PDFs, JPGs or photos here, or click to choose</div>' +
    "</div>" + readingCheck() + (freeRate(co) ? '<p class="note" style="margin:6px 0 0">Read free for this client: <b>' + freeRate(co).pct + "%</b> of " + freeRate(co).n + " bills (" + freeRate(co).google + " by Google OCR, " + freeRate(co).claude + " by Claude)</p>" : "") + uploadOptions() +
    '<div class="row" style="margin-top:8px"><button class="btn small" data-act="camera">Take photo</button><button class="btn small" data-act="manual">Type an invoice</button><button class="btn small" data-act="pasteOpen">Paste bill details</button></div>' +
    (S.pasteOpen ? '<div class="pane" style="margin-top:10px;padding:12px"><label class="f"><span>Bill details in JSON (one bill, or a list of bills)</span><textarea data-draft id="pasteBox" rows="7" placeholder=\'{"vendorName": "...", "invoiceNo": "...", ...}\'></textarea></label>' +
      '<p class="note" style="margin:6px 0">Use this when photos cannot be read in this view: ask Claude in a chat to read the bill and reply in this app\'s format, then paste the reply here.</p>' +
      '<div class="row"><button class="btn primary small" data-act="pasteAdd">Add to ' + esc(co.name) + '</button><button class="btn small" data-act="pasteClose">Cancel</button></div></div>' : "");
}
function viewInvoices(){
  if (S.reviewTable && S.filter === "draft") return viewReviewTable();
  const d = D(), co = CO(), all = Object.values(d.entries);
  const shown = all.filter(e => e.status === S.filter).sort((a, b) => S.filter === "draft" ? byDate(a, b) : byDate(b, a));
  if (!S.selected || !d.entries[S.selected]) S.selected = shown[0] ? shown[0].id : null;
  const cnt = st => all.filter(e => e.status === st).length;
  const f = (id, label) => '<button data-filter="' + id + '" aria-pressed="' + (S.filter === id) + '">' + label + " (" + cnt(id) + ")</button>";
  const items = shown.map(e => {
    let tag;
    if (S.reading[e.id]) tag = '<span class="tag no">Reading…</span>';
    else if (e.status === "approved") tag = e.exportedAt ? '<span class="tag stamp">Sent</span>' : '<span class="tag ok">TDS ' + money0(e.snapshot ? e.snapshot.tds : 0) + "</span>";
    else if (e.status === "rejected") tag = '<span class="tag no">No entry</span>';
    else if (e.status === "duplicate") tag = '<span class="tag warn">Duplicate</span>';
    else { const c = compute(e); tag = c.flags.some(x => x.lvl !== "info") || c.missing.length ? '<span class="tag warn">Check</span>' : (c.tds ? '<span class="tag ok">TDS ' + money0(c.tds) + "</span>" : '<span class="tag no">No TDS</span>'); }
    return '<li><button data-select="' + e.id + '" aria-current="' + (S.selected === e.id) + '"><span class="v">' + esc(e.x.vendorName || e.fileName) + '</span><span class="a">' + (num(e.x.total) ? money0(e.x.total) : "") +
      '</span><span class="m">' + readBadge(e.readMode) + " " + esc([e.x.invoiceNo, e.x.invoiceDate ? fmtDate(e.x.invoiceDate) : ""].filter(Boolean).join(", ") || e.fileName) + '</span><span class="t">' + tag + "</span></button></li>";
  }).join("");
  const emptyMsg = S.filter === "draft" ? "No drafts for " + co.name + ". Upload invoices above." : S.filter === "approved" ? "Nothing approved yet." : S.filter === "duplicate" ? "No duplicates held." : "Nothing marked as no entry.";
  return docqPanel(S.coId) + '<div class="desk"><div>' +

    (Object.values(d.entries).filter(e => e.status === "draft").length > 1 ? '<div class="row" style="margin:8px 0 0"><button class="btn small" data-act="revTable">Review all ' + Object.values(d.entries).filter(e => e.status === "draft").length + ' in a table</button></div>' : "") +
    '<div class="filters">' + f("draft", "To review") + f("approved", "Approved") + f("rejected", "No entry") + (cnt("duplicate") || S.filter === "duplicate" ? f("duplicate", "Duplicates") : "") + "</div>" +
    (items ? '<ul class="queue">' + items + "</ul>" : '<p class="empty">' + esc(emptyMsg) + "</p>") +
    "</div><div>" + (S.selected ? viewDetail(d.entries[S.selected]) : '<div class="detail"><section><p class="empty">Select an invoice to see its TDS draft.</p></section></div>') + "</div></div>";
}
function field(label, key, val, o){
  o = o || {};
  const e = curEntry(), unsure = !o.ro && e && e.uncertain && e.uncertain.indexOf(key) >= 0;
  return '<label class="f' + (o.wide ? " wide" : "") + (unsure ? " unsure" : "") + '"><span>' + label + '</span><input type="' + (o.type || "text") + '" data-x="' + key + '" data-fk="x:' + key + '" value="' + esc(val) + '"' + (o.ro ? " readonly" : "") + (o.type === "number" ? ' step="0.01" inputmode="decimal"' : "") + "></label>";
}
function docWarnHtml(e){
  const co = CO(), x = e.x, out = [];
  if (e.docKind && !e.docOverride)
    out.push('<div class="bigwarn"><b>This is ' + esc(DOC_KIND_TEXT[e.docKind] || "not a tax invoice") + ", not a purchase bill.</b>" +
      "<div>Nothing should be booked from it. Wait for the supplier's tax invoice and book that one instead.</div>" +
      '<div class="row" style="margin-top:8px"><button class="btn small" data-act="docIsBill">It is a tax invoice \u2014 carry on</button></div></div>');
  const bill = String(x.buyerGstin || "").toUpperCase(), ship = String(x.shipGstin || "").toUpperCase();
  if (co.gstin && bill && bill !== co.gstin && !e.buyerOverride){
    const deliveredHere = ship && ship === co.gstin;
    out.push('<div class="bigwarn"><b>This bill is not made out to ' + esc(co.name) + ".</b>" +
      "<div>It is billed to <b>" + esc(bill) + "</b>" + (deliveredHere ? ", and only <b>delivered</b> to this client. The purchase belongs to the party it is billed to." : ", while this client\u2019s GSTIN is " + esc(co.gstin) + ".") +
      " Check whether it was filed under the wrong client.</div>" +
      '<div class="row" style="margin-top:8px"><button class="btn small" data-act="buyerOk">It does belong here \u2014 carry on</button></div></div>');
  }
  return out.join("");
}
function viewDetail(e){
  if (S.reading[e.id]) return '<div class="detail"><section><div class="thinking"><span class="dot"></span>' + esc(S.reading[e.id]) + ": " + esc(e.fileName) + ". " +
    (/careful/i.test(S.reading[e.id]) ? "Handwritten and faint bills can take up to two minutes." : "This usually takes under a minute.") + "</div></section>" +
    (S.previews[e.id] ? '<section><img class="preview" src="' + S.previews[e.id] + '" alt="Invoice being read"></section>' : "") + "</div>";
  const co = CO(), c = compute(e), ro = e.status !== "draft", x = e.x;
  const snap = e.status === "approved" && e.snapshot;
  const v = snap ? {applicable:snap.applicable, tds:snap.tds, tdsWould:snap.tdsWould != null ? snap.tdsWould : snap.tds, skip:snap.skip || null, why:snap.why || [], meter:snap.meter || null, ref:snap.ref, old:snap.old, pan:snap.pan, indHuf:!!snap.indHuf, fy:snap.fy || fyOf(x.invoiceDate), base:snap.base, tdsBase:snap.tdsBase, rate:snap.rate, rateNote:snap.rateNote || "", never:!!snap.never, flags:[], catchUp:0}
    : {applicable:c.applicable, tds:c.tds, tdsWould:c.tdsWould, skip:c.skip, why:c.why, meter:c.meter, ref:c.rule.ref, old:c.rule.old, pan:c.pan, indHuf:c.indHuf, fy:c.fy, base:c.base, tdsBase:c.tdsBase, rate:c.rate, rateNote:c.rateNote, never:c.rule.basis === "never", flags:e.status === "draft" ? c.flags : [], catchUp:c.catchUp};
  const opt = rules().map(r => '<option value="' + r.id + '"' + (r.id === e.natureId ? " selected" : "") + ">" + esc(r.label) + (r.old !== "—" ? " (old " + r.old + ")" : "") + "</option>").join("");
  let h = '<div class="detail">';
  h += '<section class="dhead"><div><h2>' + esc(x.vendorName || "New invoice") + '</h2>' +
    (e.readMode ? '<div class="readby ' + (/^(free (OCR|\(PDF)|Google OCR$)/.test(e.readMode) ? "isfree" : /Claude/.test(e.readMode) ? "isclaude" : "") + '">Read by ' + esc(e.readMode) +
      (/^free (OCR|\(PDF)/.test(e.readMode) ? ": no cost" : e.readMode === "Google OCR" ? ": Google OCR, no Claude cost" : /text only/.test(e.readMode) ? ": low Claude cost" : /^Claude/.test(e.readMode) ? ": normal Claude cost" : "") + "</div>" : "") +
    (e.checks && e.checks.length && e.status === "draft" ? '<div class="note" style="margin-top:2px">Checks passed: ' + esc(e.checks.join(" · ")) + "</div>" : "") +
    '<div class="note">' + esc(e.fileName) + (e.routedBy ? ", filed here by " + esc(e.routedBy) : "") + (c.party || !x.vendorName ? "" : ", new deductee") + "</div></div>" +
    (e.status === "draft" ? rereadButtons(e) : "") +
    '<div class="actions">' + (e.status === "draft" ? '<button class="btn small danger" data-act="delete">Delete</button>' : "") + "</div></section>";
  if (e.readError) h += '<section><p class="banner" style="margin:0">' + esc(e.readError) + "</p></section>";
  if (!ro && e.readMode !== "free (partly read)" && (e.handwritten || (e.uncertain && e.uncertain.length))){
    h += '<section><p class="banner" style="margin:0">' + (e.handwritten ? "Handwritten bill. " : "") +
      (e.uncertain && e.uncertain.length ? "Fields marked in amber need a quick look. Compare them with the image; to correct one, click in the box and type. When they are right, press \u201cFields look right\u201d in the bar at the bottom." : "Check the figures against the image.") +
      (e.legibility ? " Claude noted: " + esc(e.legibility) : "") + "</p></section>";
  }
  const prev = S.previews[e.id];
  const docWarn = docWarnHtml(e);
  const readBits = '<div class="row" style="margin-top:8px">' +
    (!ro && S.files[e.id] && S.engine ? '<button class="btn small" data-act="reread">Read again carefully</button>' : "") +
    (e.readMode ? '<span class="note">Read by ' + esc(e.readMode) + "</span>" : "") + "</div>" +
    (e.readNote ? '<p class="note" style="margin:6px 0 0">' + esc(e.readNote) + "</p>" : "") +
    (e.readTrace && e.readTrace.length ? '<details class="trace"' + (e.status === "draft" ? " open" : "") + '><summary>How this bill was read</summary><ol>' +
      e.readTrace.map(t => '<li class="' + (t.ok ? "tok" : "tno") + '"><b>' + (t.ok ? "✓ " : "✗ ") + esc(t.step) + "</b>" + (t.note ? ": " + esc(t.note) : "") + "</li>").join("") + "</ol></details>" : "") +
    (e.freeWhy && !ro && !(e.readTrace && e.readTrace.length) ? '<p class="note" style="margin:6px 0 0">Free reading was not enough: ' + esc(e.freeWhy) + ".</p>" : "");
  h += docWarn;
  h += '<section class="' + (prev ? "withprev" : "") + '">' +
    (prev ? '<details class="prevbox" open><summary>Invoice image</summary><a href="' + prev + '" target="_blank" rel="noopener"><img class="preview" src="' + prev + '" alt="Uploaded invoice"></a></details>' : "") +
    '<div><h3>Invoice details</h3><div class="grid">' +
    field("Deductee name", "vendorName", x.vendorName, {ro, wide:true}) +
    field("GSTIN", "vendorGstin", x.vendorGstin, {ro}) + field("PAN", "vendorPan", x.vendorPan || v.pan, {ro}) +
    field("Invoice no.", "invoiceNo", x.invoiceNo, {ro}) + field("Invoice date", "invoiceDate", x.invoiceDate, {ro, type:"date"}) +
    field("Taxable value", "taxable", x.taxable, {ro, type:"number"}) + field("CGST", "cgst", x.cgst, {ro, type:"number"}) +
    field("SGST", "sgst", x.sgst, {ro, type:"number"}) + field("IGST", "igst", x.igst, {ro, type:"number"}) +
    field("Invoice total", "total", x.total, {ro, type:"number"}) +
    (e.natureId.indexOf("rent") === 0 ? field("Months billed", "rentMonths", x.rentMonths, {ro, type:"number"}) : "") +
    field("Billed to GSTIN", "buyerGstin", x.buyerGstin, {ro}) + (x.shipGstin && x.shipGstin !== x.buyerGstin ? field("Delivered to GSTIN", "shipGstin", x.shipGstin, {ro}) : "") +
    field("What was supplied", "description", x.description, {ro, wide:true}) + "</div>" + itemsHtml(e, ro) + readBits +
    (!prev && e.fileName !== "Manual entry" && !ro && e.readMode ? '<p class="note" style="margin:6px 0 0">The invoice image is shown only in the session it was uploaded.</p>' : "") + "</div></section>";

  h += viewGst(e, c, ro, snap);
  h += '<section><h3>TDS decision</h3><div class="decision"><div>' +
    '<label class="f' + (e.confirmType && !ro && !(c.party && c.party.natureDefault) && !c.skip ? " unsure" : "") + '" style="margin-bottom:10px"><span>Payment type</span><select data-e="natureId"' + (ro ? " disabled" : "") + ">" + opt + "</select></label>" +
    (e.confirmType && !ro && !(c.party && c.party.natureDefault) && !c.skip ? '<div class="row" style="margin:-4px 0 10px"><button class="btn small" data-act="confirmType">Confirm payment type</button><span class="note">New supplier: the payment type decides the TDS section.</span></div>' : "") +
    (e.ai && e.ai.reason ? '<p class="note" style="margin:-4px 0 10px">' + (/Claude/.test(e.readMode || "") || !e.readMode ? "Claude: " + esc(e.ai.reason) : "Guessed from the bill: " + esc(e.ai.reason.replace(/^Free reading:\s*/, ""))) + "</p>" : "") +
    '<p class="verdict ' + (v.applicable ? "yes" : "nope") + '">' + (v.applicable ? (v.skip ? "TDS applies: " + money(v.tdsWould) + ", not booked" : "TDS applies: " + money(v.tds)) : "No TDS on this invoice") + "</p>" +
    ((v.tdsWould > 0 || e.tdsSkip || (v.rule && v.rule.basis !== "never")) && !ro ?
      '<div class="skipbox"><label class="chk"><input type="checkbox" data-bookTds' + (v.tdsWould > 0 && !v.skip ? " checked" : "") + "> <b>Deduct TDS on this bill</b></label>" +
      (v.tdsWould <= 0 && !v.skip ? '<p class="note" style="margin:4px 0 0">Below the limits, so no TDS is due. Tick the box to deduct anyway (for example when you expect the yearly limit to be crossed).</p>' : "") +
      (v.skip ? (v.skip.from === "bill"
        ? '<label class="f" style="margin-top:6px"><span>Why not</span><select data-e="tdsSkip">' + Object.entries(SKIP_REASONS).map(([k, t]) => '<option value="' + k + '"' + (k === e.tdsSkip ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></label>"
        : '<p class="note" style="margin:4px 0 0">Not booked: ' + esc(skipText(v.skip)) + ". Tick the box to book it on this bill anyway.</p>") : "") + "</div>"
      : (ro && v.skip ? '<p class="note" style="margin:0 0 8px">Not booked: ' + esc(skipText(v.skip)) + "</p>" : "")) +
    '<ul class="why">' + v.why.map(w => "<li>" + esc(w) + "</li>").join("") + "</ul>";
  if (v.meter && v.meter.limit){
    const m = v.meter, scale = Math.max(m.limit, m.used + m.add) || 1;
    const usedPct = Math.min(100, m.used / scale * 100), addPct = Math.min(100 - usedPct, m.add / scale * 100), limPct = Math.min(100, m.limit / scale * 100);
    h += '<div class="meter"><div class="bar" role="img" aria-label="' + esc(m.label + ": " + money0(m.used + m.add) + " of " + money0(m.limit)) + '"><div class="used" style="width:' + usedPct + '%"></div><div class="add' + (m.used + m.add > m.limit ? " over" : "") + '" style="left:' + usedPct + "%;width:" + addPct + '%"></div>' +
      '<div style="position:absolute;top:-2px;bottom:-2px;left:calc(' + limPct + '% - 1px);width:2px;background:var(--ink)"></div></div>' +
      '<div class="cap"><span>' + esc(m.label) + "</span><span>" + (m.used ? money0(m.used) + " earlier + " : "") + money0(m.add) + " this bill / limit " + money0(m.limit) + "</span></div></div>";
    h += ytdSourceHtml(e, c);
  }
  if (v.catchUp > 0 && !ro) h += '<label class="chk" style="margin-top:10px"><input type="checkbox" data-e="includeCatchUp"' + (e.includeCatchUp ? " checked" : "") + "> Include TDS on earlier bills (" + money0(v.catchUp) + ") in this entry</label>";
  h += '</div><dl class="figs"><dt>Section</dt><dd>' + esc(v.ref) + "</dd><dt>Old section</dt><dd>" + esc(v.old) + "</dd>" +
    "<dt>PAN</dt><dd>" + (v.pan ? esc(v.pan) + (v.indHuf ? " (Ind/HUF)" : "") : "Not found") + "</dd><dt>Tax year</dt><dd>" + v.fy + "</dd>" +
    "<dt>Value before GST</dt><dd>" + money(v.base) + "</dd><dt>TDS base</dt><dd>" + money(v.applicable ? v.tdsBase : 0) + "</dd>" +
    '<dt>Rate</dt><dd title="' + esc(v.rateNote) + '">' + (v.never ? "—" : v.rate + "%") + "</dd>" +
    (v.skip ? "<dt>TDS that applies</dt><dd>" + money(v.tdsWould) + "</dd>" : "") +
    '<dt class="big">' + (v.skip ? "TDS booked" : "TDS") + '</dt><dd class="big">' + money(v.tds) + "</dd></dl></div></section>";
  if (v.flags.length) h += '<section><h3>Check before approving</h3><ul class="flags">' + v.flags.map(f => '<li class="' + f.lvl + '">' + esc(f.t) + "</li>").join("") + "</ul></section>";

  const lines = snap ? snap.lines : c.lines;
  const tot = lines.reduce((a, l) => { a[l.side] += l.amt; return a; }, {Dr:0, Cr:0});
  const tallyCtx = !!(S.bank && S.bank.cid === S.coId && !S.bank.loading && hasLedgerList());
  const row = l => {
    let led = esc(l.ledger || "");
    if (!ro && l.role === "expense") led = '<input type="text" data-e="expenseLedger" data-fk="e:expenseLedger" data-ac="1" autocomplete="off" value="' + esc(e.expenseLedger) + '" aria-label="Expense ledger" placeholder="Expense ledger">';
    if (!ro && l.role === "party") led = '<input type="text" data-e="partyLedger" data-fk="e:partyLedger" data-ac="1" autocomplete="off" value="' + esc(e.partyLedger) + '" aria-label="Party ledger" placeholder="Party ledger">' + (e.partyFromTally ? '<div class="note">From Tally: ' + esc(e.partyFromTally) + "</div>" : "");
    if (!l.ledger && l.role !== "expense" && l.role !== "party") led = '<span class="missing">Ledger not set</span>';
    if (l.ledger && tallyCtx && !e.exportedAt){
      const ex = exactLedger(l.ledger);
      if (ex) led += ' <span class="lg-ok" title="In Tally as \u201c' + esc(ex) + '\u201d">\u2714</span>';
      else led += '<div class="lg-miss">Not in Tally' + suggestLedgers(l.ledger, l.role, 2).map(n => ' <button class="linkbtn" data-billfix="' + esc(l.role) + '" data-old="' + esc(l.ledger) + '" data-new="' + esc(n) + '">Use \u201c' + esc(n) + '\u201d</button>').join("") +
        ' <button class="linkbtn" data-billcreate="' + esc(l.role) + '" data-old="' + esc(l.ledger) + '">Create in Tally</button></div>';
    }
    if (l.role === "expense"){
      if (e.expenseFrom && !e.expenseUserSet) led += '<div class="nr" style="color:var(--ledger)">' + esc(e.expenseFrom) + "</div>";
      led += partyHistHtml(e, ro);
    }
    return '<tr><td class="by">' + l.side + "</td><td>" + led + '</td><td class="n">' + (l.side === "Dr" ? INR.format(l.amt) : "") + '</td><td class="n">' + (l.side === "Cr" ? INR.format(l.amt) : "") + "</td></tr>";
  };
  h += '<section><h3>Draft entry for Tally: ' + esc(co.tallyName || co.name) + '</h3><div class="slip">' +
    '<div class="sh"><b>' + esc(co.voucherType) + " voucher</b><span>" + fmtDate(x.invoiceDate) + (x.invoiceNo ? ", ref " + esc(x.invoiceNo) : "") + "</span></div>" +
    '<table class="vtbl"><thead><tr><th></th><th>Ledger</th><th class="n">Debit ₹</th><th class="n">Credit ₹</th></tr></thead><tbody>' + lines.map(row).join("") +
    '</tbody><tfoot><tr><td></td><td>Total</td><td class="n">' + INR.format(r2(tot.Dr)) + '</td><td class="n">' + INR.format(r2(tot.Cr)) + "</td></tr></tfoot></table>" +
    (ro ? '<div class="narr">' + esc(e.narration) + "</div>" : '<label class="f" style="margin-top:10px"><span>Narration</span><input type="text" data-e="narration" data-fk="e:narration" value="' + esc(e.narration) + '"></label>') +
    (e.status === "approved" ? '<div class="stampmark">' + (e.exportedAt ? "Sent to Tally" : "Approved") + "<small>" + fmtDate((e.exportedAt || e.approvedAt || "").slice(0, 10)) + "</small></div>" : "") +
    (e.status === "rejected" ? '<div class="stampmark rej">No entry</div>' : "") + "</div></section>";

  // Approve, No entry, Undo and the rest live in the bar at the bottom of the screen.
  if (e.status === "duplicate") h += '<section><p class="banner" style="margin:0">Held as a duplicate. ' + esc((e.dupOf && e.dupOf.msg) || "") + " It does not count towards limits and cannot be approved.</p></section>";
  return h + "</div>";
}

/* ---------- Client: deductees ---------- */
function viewParties(){
  const parties = D().parties, ps = Object.values(parties).sort((a, b) => a.name.localeCompare(b.name));
  const fy = S.partyFy;
  const fys = Array.from(new Set([fyOf(null)].concat(...ps.map(p => Object.keys(p.ytd || {}))))).sort().reverse();
  let h = '<div class="row" style="justify-content:space-between"><div><h2 style="font:600 20px var(--serif);margin:0">Deductees of ' + esc(CO().name) + '</h2><p class="note" style="margin:2px 0 0">Limits are checked against the amounts credited here. Add bills booked before you started using this desk.</p></div>' +
    '<div class="row"><label class="f"><span>Tax year</span><select data-pfy>' + fys.map(y => "<option" + (y === fy ? " selected" : "") + ">" + y + "</option>").join("") + '</select></label><button class="btn" data-act="addParty">Add deductee</button></div></div>';
  if (!ps.length) h += '<div class="pane"><p class="empty" style="padding:0">No deductees yet. They are added when you approve an invoice, or add one now.</p></div>';
  else {
    h += '<div class="tblwrap" style="margin-top:14px"><table class="data"><thead><tr><th>Deductee</th><th>PAN</th><th>Usual payment type</th><th class="n">Credited ' + fy + '</th><th class="n">TDS base ' + fy + "</th><th></th></tr></thead><tbody>";
    ps.forEach(p => {
      const y = (p.ytd && p.ytd[fy]) || {};
      const cr = Object.values(y).reduce((a, v) => a + num(v.credited), 0), tb = Object.values(y).reduce((a, v) => a + num(v.tdsBase), 0);
      h += '<tr class="' + (S.partySel === p.id ? "sel" : "") + '"><td>' + esc(p.name) + "</td><td>" + esc(p.pan || "—") + "</td><td>" + esc(p.natureDefault ? ruleOf(p.natureDefault).label : "—") +
        '</td><td class="n">' + money0(cr) + '</td><td class="n">' + money0(tb) + '</td><td class="n"><button class="btn small" data-editparty="' + p.id + '">Edit</button></td></tr>';
    });
    h += "</tbody></table></div>";
  }
  const p = S.partySel && parties[S.partySel];
  if (p){
    const opt = '<option value="">Decide per invoice</option>' + rules().map(r => '<option value="' + r.id + '"' + (r.id === p.natureDefault ? " selected" : "") + ">" + esc(r.label) + "</option>").join("");
    h += '<div class="pane"><div class="row" style="justify-content:space-between"><h2>' + esc(p.name) + '</h2><button class="btn small" data-act="closeParty">Close</button></div><div class="grid" style="margin-top:10px">' +
      pf("Name", "name", p.name) + pf("PAN", "pan", p.pan) + pf("GSTIN", "gstin", p.gstin) + pf("Ledger name in Tally", "ledgerName", p.ledgerName) + pf("Expense ledger", "expenseLedger", p.expenseLedger) +
      '<label class="f"><span>Usual payment type</span><select data-p="natureDefault">' + opt + "</select></label>" +
      pf("Lower deduction rate %", "ldcRate", p.ldcRate, "number") + pf("Certificate valid to", "ldcValidTo", p.ldcValidTo, "date") + "</div>" +
      '<div class="skipbox" style="margin-top:12px"><label class="chk"><input type="checkbox" data-pnotds' + (p.noTds ? " checked" : "") + "> <b>Do not book TDS for this deductee</b></label>" +
      '<label class="chk" style="margin-top:6px"><input type="checkbox" data-ptransporter' + (p.transporter ? " checked" : "") + "> Transporter with ten or fewer goods carriages, declaration and PAN on file (no TDS on contract payments)</label>" +
      (p.noTds ? '<label class="f" style="margin-top:6px;max-width:420px"><span>Reason</span><select data-pnotdsreason>' + Object.entries(SKIP_REASONS).map(([k, t]) => '<option value="' + k + '"' + (k === (p.noTdsReason || "na") ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></label>" : "") +
      '<p class="note" style="margin:4px 0 0">TDS is still worked out on each bill and shown; a single bill can still be booked with TDS.</p></div>' +
      '<h3 style="margin-top:18px">Amounts credited in ' + fy + '</h3><p class="note" style="margin:-6px 0 10px">"TDS base" is the part of the credited amount on which TDS was already deducted.</p>' +
      '<div class="tblwrap"><table class="data"><thead><tr><th>Payment type</th><th class="n">Credited (before GST)</th><th class="n">TDS base</th></tr></thead><tbody>' +
      rules().filter(r => r.basis !== "never" && r.basis !== "always").map(r => { const y = ytdOf(p, fy, r.id); return "<tr><td>" + esc(r.label) + '</td><td class="n"><input type="number" step="0.01" data-ytd="' + r.id + '" data-k="credited" value="' + (y.credited || "") + '"></td><td class="n"><input type="number" step="0.01" data-ytd="' + r.id + '" data-k="tdsBase" value="' + (y.tdsBase || "") + '"></td></tr>'; }).join("") +
      "</tbody></table></div></div>";
  }
  return h;
}
