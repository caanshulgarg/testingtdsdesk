/* @react-lazy: begin 74-zoho-connect.js (the React app loads this file with its Integrations page: app/src/screens/Integrations.jsx; build.py react_parts) */
/* ================================================================== */
/* Zoho Books: the Integrations page's actions                          */
/* ================================================================== */
// Added to ZohoB (src/js/74-zoho-books.js): connecting an organisation (connect, then finish when Zoho's sign-in comes
// back), linking it to a client, reading it now, its webhook address, disconnecting.
Object.assign(ZohoB, {
  async connect(){
    if (!this.owner()) { toast("Only the firm's owner can connect Zoho Books."); return; }
    // a random value kept for this tab only; the function is given its hash now and asks for the value itself when the
    // sign-in comes back: the sign-in is finished by this tab, signed in as this person
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, "0")).join("");
    try { sessionStorage.setItem(this.NONCE_KEY, nonce); } catch (e){ toast("Zoho Books could not be started: this browser does not keep the tab's data."); return; }
    const j = await this.call({kind: "connect_start", back: location.origin + location.pathname, nonce_hash: await this.sha256(nonce)});
    if (!j.ok){ toast(j.error || "Zoho Books could not be started."); return; }
    location.href = j.url;
  },
  NONCE_KEY: "fincom.zoho.connect",
  async sha256(t){ const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join(""); },
  // Zoho's sign-in came back to this page (#/integrations/zoho?zcode=…&zstate=…, kept in S.zohoFinish by the router and
  // taken out of the address): finished here, with this person's FinCom sign-in and the tab's value. Once only
  async finish(){
    const f = S.zohoFinish; S.zohoFinish = null;
    if (!f || !f.code || !f.state) return null;
    let nonce = "";
    try { nonce = sessionStorage.getItem(this.NONCE_KEY) || ""; sessionStorage.removeItem(this.NONCE_KEY); } catch (e){}
    if (!nonce){ S.zohoBack = "expired"; return {ok: false, why: "expired"}; }
    let j = null;
    try { j = await this.call({kind: "connect_finish", code: f.code, state: f.state, nonce}); } catch (e){ j = {ok: false, why: "failed"}; }
    if (j && j.ok && j.grant) S.zohoGrant = j.grant; else S.zohoBack = (j && j.why) || "failed";
    return j;
  },
  async link(grant, org, cid){
    const j = await this.call({kind: "link", grant, org, client: cid});
    if (!j.ok){ toast(j.error || "The organisation could not be linked."); return j; }
    await this.load(true);
    if (typeof TCloud === "object"){ TCloud.st[cid] = {}; try { await TCloud.status(cid, true); } catch (e){} }
    toast("Linked. " + ((j.first && j.first.counts && j.first.counts.entries) || 0) + " entries read from Zoho Books so far; the rest follow every few minutes.");
    render();
    return j;
  },
  async disconnect(c){
    if (!this.owner()) { toast("Only the firm's owner can disconnect Zoho Books."); return; }
    if (!(await askConfirm({title: "Disconnect " + (c.orgName || "this organisation") + "?", ok: "Disconnect",
      body: "<p>FinCom stops reading and posting to this Zoho organisation and gives up its access (the sign-in is revoked at Zoho). Nothing is deleted: the entries already read stay in FinCom, and nothing in Zoho is touched.</p>"}))) return;
    const j = await this.call({kind: "disconnect", connection: c.id});
    toast(j.ok ? (j.message || "Disconnected.") : (j.error || "Could not disconnect."));
    await this.load(true); render();
  },
  async syncNow(c){
    toast("Reading " + (c.orgName || "the organisation") + " from Zoho Books…");
    const j = await this.call({kind: "sync_now", connection: c.id});
    toast(j.ok ? "Read from Zoho Books: " + ((j.counts && j.counts.entries) || 0) + " entries new or changed." : (j.error || "The read stopped."));
    await this.load(true); render();
  },
  async hookNew(c){
    const j = await this.call({kind: "hook_new", connection: c.id});
    if (!j.ok){ toast(j.error || "Could not make the address."); return ""; }
    return j.url;
  }
});
/* @react-lazy: end */
