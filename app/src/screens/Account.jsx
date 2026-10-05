// The firm account, in Settings: plan and credit (with the credit history), signing in and the firm's sign-in settings,
// people, documents kept in the account, the document inbox's drop keys, backups, and the platform page for FinCom's
// administrators. Was viewAccount, walletHtml, viewCloudSettings, viewAccountPeopleOnly, viewPeople, viewBackups and
// viewSuperadmin (src/js/27), viewDocsSettings and viewDropKeys (src/js/19). The work is Cloud and loadAccount; buttons go
// through doAct (cloudSignIn, cloudSync, cloudPassword, addPerson, backupNow…), which read the boxes by their id or
// data-cloud as before, and acctPerson, acctBackup, acctDropOff, adminAct, adminPlan, cloudAuto, signOutAll, docsKeep,
// docYearsSet (src/js/27, 19, 43).
import Msg from "../parts/Msg.jsx";

import { KeepBox } from "./SignIn.jsx";
import ListTable from "../parts/ListTable.jsx";

const Act = ({ act, className = "btn small", children, disabled, title }) => <button className={className} disabled={disabled} title={title} onClick={() => doAct(act)}>{children}</button>;
const H3 = ({ children, top = 16 }) => <h3 style={{ margin: top + "px 0 " + (top === 14 ? 4 : 6) + "px", fontSize: 15 }}>{children}</h3>;
const at = (s) => fmtDateTime(s);

function Wallet() {
  const rows = S.wallet || [];
  const what = (w) => (w.kind === "credit" ? "Credit added" : w.kind === "fee" ? "Monthly charge" : w.kind === "refund" ? "Refund" : (w.code || "use"));
  // the one list table (spec K6): when (date), amount, then the rest
  return <div style={{ marginTop: 8 }}><ListTable name="wallet" className="data" rows={rows} rowKey={(w, i) => (w.at || "") + ":" + i} unit={["entry", "entries"]}
    empty="No entries yet. Credit added by FinCom and what is used appear here."
    cols={[
      { k: "at", role: "date", label: "When", v: (w) => w.at || "", cell: (w) => at(w.at) },
      { k: "amt", role: "amount", label: "Amount", cls: "n", v: (w) => num(w.amount), td: (w) => ({ style: num(w.amount) < 0 ? undefined : { color: "var(--ledger)" } }), cell: (w) => money(num(w.amount)) },
      { k: "what", label: "What", v: what, cell: what },
      { k: "left", label: "Left", cls: "n", v: (w) => num(w.balance_after), sum: false, cell: (w) => money(num(w.balance_after)) },
      { k: "note", label: "Note", cell: (w) => w.note || "" },
    ]} /></div>;
}

// Plan and credit: what is left, the plan, and what each module charges and has used this month
export function PlanCredit() {
  const a = S.account;
  if (!Cloud.on()) return null;
  if (!a || !a.firm) return <div className="pane"><h2>Plan and credit</h2><p className="note">Reading the account…</p></div>;
  const f = a.firm, plan = f.plan || { name: "No plan set", monthly_fee: 0, includes: {} }, used = (a.usage || []).reduce((m, u) => (m[u.code] = u, m), {});
  return <div className="pane"><h2>Plan and credit</h2>
    <div className="bk-figs" style={{ margin: "0 0 10px" }}><div><dt>Credit left</dt><dd style={num(f.balance) <= num(f.warn_at) ? { color: "var(--stop)" } : undefined}>{money(num(f.balance))}</dd></div>
      <div><dt>Plan</dt><dd>{plan.name}</dd></div><div><dt>Monthly</dt><dd>{num(plan.monthly_fee) ? money(num(plan.monthly_fee)) : "—"}</dd></div><div><dt>Since</dt><dd>{fmtDate(f.period_start)}</dd></div></div>
    <div className="tblwrap"><table className="data" data-statement=""><thead><tr><th>What</th><th>How it is charged</th><th className="n">This month</th><th className="n">Spent</th></tr></thead><tbody>
      {(a.modules || []).map((m) => { const inc = moduleIncluded(m.code), u = used[m.code];
        return <tr key={m.code}><td>{(MODULE_ICON[m.code] || "") + " " + m.title}{!m.enabled && <> <span className="tag no">off</span></>}</td>
          <td>{m.billing === "free" ? "included" : inc ? <span className="tag ok">in the plan</span> : money(num(m.price)) + " " + m.unit}</td>
          <td className="n">{u ? num(u.qty) : 0}</td><td className="n">{u && num(u.spent) ? money(num(u.spent)) : "—"}</td></tr>; })}</tbody></table></div>
    <div className="row" style={{ marginTop: 10 }}><Act act="acctRefresh">Refresh</Act><Act act="acctHistory">{(S.walletOpen ? "Hide" : "Show") + " credit history"}</Act></div>
    {S.walletOpen && <Wallet />}</div>;
}

// Sign-in and the firm account: sign in here, or who is signed in, syncing, the password, two-step sign-in, signing out
export function FirmAccount() {
  const c = Cloud.cfg(), st = Cloud.st, form = S.cloudForm || {};
  if (!Cloud.on()) return <div className="pane"><h2>Firm account (shared data)</h2>
    <p className="note" style={{ margin: "0 0 10px" }}>Sign in to share clients, bills, bank statements and sales invoices with the rest of the firm. Without signing in, everything stays on this computer only.</p>
    <div className="grid"><label className="f"><span>Email</span><input type="email" data-cloud="email" data-fk="cloudemail" aria-label="Email" defaultValue={form.email || c.email || ""} autoComplete="username" onChange={(ev) => cloudForm("email", ev.target.value)} /></label>
      <label className="f"><span>Password</span><input type="password" data-cloud="password" data-fk="cloudpw" aria-label="Password" defaultValue={form.password || ""} autoComplete="current-password" onChange={(ev) => cloudForm("password", ev.target.value)} /></label></div>
    <KeepBox />
    <div className="row" style={{ marginTop: 10 }}><Act act="cloudSignIn" className="btn small primary">Sign in</Act></div>
    {st.error && <p className="bk-warn" style={{ marginTop: 10 }}><Msg text={st.error} /></p>}</div>;
  const pending = st.pending, aal2 = Cloud.aal() === "aal2", mi = st.mfaInfo || {}, a = S.account, owner = !!(a && ((a.me || {}).role === "owner" || a.superadmin === true));
  return <div className="pane"><h2>Firm account (shared data)</h2>
    <p className="note" style={{ margin: "0 0 8px" }}>Signed in as <b>{st.email}</b>{(st.role ? " (" + st.role + ")" : "") + (st.lastSync ? " · last sync " + fmtTime(st.lastSync) : "") + (pending ? " · " + pending + " change" + (pending > 1 ? "s" : "") + " waiting to be sent" : " · everything is sent")}</p>
    {st.error && <p className="bk-warn"><Msg text={st.error} /></p>}
    <label className="chk"><input type="checkbox" checked={c.auto !== false} onChange={(ev) => cloudAuto(ev.target.checked)} /> Keep in sync automatically (every 45 seconds)</label>
    <div className="row" style={{ marginTop: 10 }}><Act act="cloudSync" className="btn small primary" disabled={!!st.busy}>{st.busy ? "Syncing…" : "Sync now"}</Act><Act act="cloudSignOut">Sign out</Act>
      {owner && <button className="btn small" title="Every computer and phone signed in to your account is signed out" onClick={() => signOutAll()}>Sign out of all devices</button>}</div>
    {/* section D (03-Oct-2026): there is no automatic sign-out. The idle timer (30 minutes without a click, and its setting here) is gone:
        from a tab left in the background it signed out every tab of the browser, with no word of why. */}
    <p className="note" style={{ margin: "8px 0 0" }}>FinCom does not sign you out by itself. You stay signed in on this computer until you sign out{owner ? " (or sign out of all devices)" : ""}; without “Keep me signed in” at sign-in, until the browser is closed.</p>
    <H3 top={14}>Change password</H3><div className="bk-form two"><label><span>New password (8 characters or more)</span><input type="password" data-cloud="newpw" data-fk="cloudnewpw" aria-label="New password" autoComplete="new-password" /></label>
      <label><span>Repeat it</span><input type="password" data-cloud="newpw2" data-fk="cloudnewpw2" aria-label="Repeat the new password" autoComplete="new-password" /></label></div>
    <div className="row" style={{ marginTop: 8 }}><Act act="cloudPassword">Change password</Act></div>
    <H3 top={14}>Two-step sign-in (optional)</H3><p className="note" style={{ margin: "0 0 6px" }}>{aal2 ? <><span className="tag ok">On</span> This sign-in used a code from your authenticator app.</> : mi.enrolled ? "On for this account." : <>Off. For extra safety you can add a code from an authenticator app on your phone. <button className="btn small" onClick={() => mfaAction("mfaOptIn")}>Turn it on</button></>}</p>
    {mi.admin && !aal2 && <p className="bk-warn" style={{ margin: "6px 0" }}>Platform administration is locked until you give the code from your phone. <button className="btn small primary" onClick={() => mfaAction("mfaAdmin")}>Unlock administration</button></p>}
    {S.lastSignIn && <p className="note" style={{ margin: "0 0 6px" }}>{"Your last sign-in: " + fmtDateTime(S.lastSignIn.at) + ", " + S.lastSignIn.device + "."}</p>}
    {/* the people table with its actions (New password, Reset two-step, Switch off) is drawn below by PeopleEtc; this plain list only stands in until that loads */}
    {!S.account && (st.members || []).length > 0 && <><H3 top={14}>People in the firm</H3><table className="data" data-statement=""><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
      {st.members.map((m) => <tr key={m.email}><td>{m.name || "—"}</td><td>{m.email}</td><td>{m.role + (m.active ? "" : " (off)")}</td></tr>)}</tbody></table></>}
  </div>;
}

function People({ canManage }) {
  const a = S.account;
  return <>
    <H3>People in the firm</H3>
    {/* the one list table (spec K6): the person, their role (status), then the rest */}
    <ListTable name="people" className="data" rows={a.people || []} rowKey={(p) => p.email} unit={["person", "people"]} rowProps={(p) => ({ "data-key": p.email })}
      empty="Nobody yet. Add a person below with their name and email."
      cols={[
        { k: "name", role: "party", label: "Name", v: (p) => p.name || "", cell: (p) => p.name || "—" },
        { k: "role", role: "status", label: "Role", v: (p) => p.role + (p.active ? "" : " (off)"), cell: (p) => p.role + (p.active ? "" : " (off)") },
        { k: "email", label: "Email", v: (p) => p.email, cell: (p) => p.email },
        { k: "ac", role: "act", td: () => ({ style: { whiteSpace: "nowrap" } }), cell: (p) => canManage && <><button className="linkbtn" title="Emails a link to choose a new password" onClick={() => acctPerson("reset", p.email)}>Send reset link</button>{" "}
          <button className="linkbtn" title="Where email is not set up: a password is made and shown once" onClick={() => acctPerson("makepw", p.email)}>Make a password</button>{" "}
          <button className="linkbtn" title="After 5 wrong passwords the login is locked for 15 minutes" onClick={() => acctPerson("unlock", p.email)}>Unlock</button>{" "}
          <button className="linkbtn" title="For a lost phone: they set up two-step sign-in again" onClick={() => acctPerson("mfa", p.email)}>Reset two-step</button>{" "}
          <button className="linkbtn" onClick={() => acctPerson(p.active ? "off" : "on", p.email)}>{p.active ? "Switch off" : "Switch on"}</button></> },
      ]} />
    {canManage && <><div className="bk-form three" style={{ marginTop: 8 }}><label><span>Name</span><input type="text" id="npName" aria-label="Name" /></label><label><span>Email</span><input type="email" id="npEmail" aria-label="Email of the person" /></label>
      <label><span>Can do</span><select id="npRole" aria-label="Can do"><option value="staff">Everything except billing</option><option value="readonly">Look only</option><option value="owner">Everything, including people</option></select></label></div>
      <div className="row" style={{ marginTop: 6 }}><Act act="invitePerson" className="btn small primary">Invite by email</Act><span className="note">They get an email with a link to choose their own password.</span>
        <Act act="addPerson" className="linkbtn">or make a password instead</Act></div>
</>}
    {S.newPerson && <p className="bk-alert" style={{ marginTop: 8 }}><b>{S.newPerson.email}</b> can sign in with the password <b>{S.newPerson.password}</b>. Write it down: it is shown only now.</p>}
  </>;
}

function DocsSettings() {
  if (!Cloud.on()) return null;
  const a = S.account, owner = a && ((a.me || {}).role === "owner" || a.superadmin), on = S.firm.cloudDocs !== false, years = num(S.firm.docYears || 3), u = S.docUsage;
  return <>
    <H3>Documents in the firm account</H3>
    <p className="note" style={{ margin: "0 0 8px" }}>Bills, sales invoices and bank statements are kept with the firm, so anyone in the firm can open them from Transactions on any computer. Photos are shrunk to reading size first, and nothing is kept for a bill marked “no entry” or held as a duplicate.</p>
    <label className="chk"><input type="checkbox" checked={on} onChange={(ev) => docsKeep(ev.target.checked)} /> Keep documents in the firm account</label>
    {on && owner && <label className="f" style={{ maxWidth: 280 }}><span>Keep them for</span><select aria-label="Keep them for" value={years} onChange={(ev) => docYearsSet(ev.target.value)}>{[1, 3, 5, 7, 0].map((y) => <option key={y} value={y}>{y ? y + " year" + (y === 1 ? "" : "s") : "as long as the client is here"}</option>)}</select></label>}
    {on && <><div className="row" style={{ gap: 8, marginTop: 6 }}><Act act="docUsage">{u ? "Refresh" : "How much is stored?"}</Act>
      {S.coId && S.companies[S.coId] && <Act act="docSendPending">{"Send documents still on this computer for " + S.companies[S.coId].name}</Act>}
      {owner && years ? <Act act="docTidy">{"Clear out documents older than " + years + " year" + (years === 1 ? "" : "s")}</Act> : null}</div>
      {u && <p className="note">{u.files + " document" + (u.files === 1 ? "" : "s") + " · " + (u.bytes > 1073741824 ? (u.bytes / 1073741824).toFixed(2) + " GB" : Math.round(u.bytes / 1048576) + " MB") + (u.oldest ? " · oldest " + fmtDate(String(u.oldest).slice(0, 10)) : "") + ". The plan includes 100 GB."}</p>}</>}
  </>;
}

function DropKeys() {
  if (!Cloud.on()) return null;
  const a = S.account, owner = a && ((a.me || {}).role === "owner" || a.superadmin);
  if (!owner) return null;
  const keys = S.dropKeys, base = Cloud.cfg().url.replace(/\/+$/, "");
  return <>
    <H3>Document inbox: keys for the agent</H3>
    <p className="note" style={{ margin: "0 0 6px" }}>A drop key lets office automation add waiting documents to a client’s inbox, and refresh their links. The database refuses anything else: it cannot read, change entries, see other firms, or post to Tally. Switch a key off at any time.</p>
    <div className="row"><Act act="dropKeysList">{keys ? "Refresh" : "Show keys"}</Act><Act act="dropKeyNew" className="btn small primary">Make a key</Act></div>
    {S.newDropKey && <div className="bigwarn" style={{ borderColor: "var(--ledger)" }}><b>Copy this key now. It will not be shown again.</b>
      <div style={{ marginTop: 6 }}><code style={{ fontSize: 13, userSelect: "all" }}>{S.newDropKey}</code></div>
      <div style={{ marginTop: 8 }}>The Poster adds one waiting document with one call:</div>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--paper)", padding: 8, borderRadius: 6, userSelect: "all" }}>{"POST " + base + "/rest/v1/rpc/post_inbox\nHeader  apikey: " + Cloud.cfg().key + "\nHeader  Content-Type: application/json\nBody\n{\n  \"p_key\": \"" + S.newDropKey + "\",\n  \"p_id\": \"<intake uuid>\",\n  \"p_client_id\": \"<FinCom client id>\",\n  \"p_data\": { \"fileName\": ..., \"fileHash\": ..., \"url\": ..., \"urlExpiresAt\": ..., ... }\n}" +
        "\n\nRefresh a link:  POST .../rest/v1/rpc/refresh_inbox_link\n{ \"p_key\": ..., \"p_id\": ..., \"p_url\": ..., \"p_expires_at\": ... }"}</pre>
      <Act act="dropKeyHide" className="linkbtn">I have copied it</Act></div>}
    {keys ? <div style={{ marginTop: 8 }}><ListTable name="dropKeys" className="data" rows={keys} rowKey={(k) => k.id} unit={["key", "keys"]} rowProps={(k) => (k.active ? {} : { style: { opacity: 0.55 } })}
      empty="No keys yet. Use Make a drop key above to let an office tool send files in."
      cols={[
        { k: "made", role: "date", label: "Made", v: (k) => k.created_at || "", cell: (k) => fmtDate(String(k.created_at).slice(0, 10)) },
        { k: "hint", role: "number", label: "Ends in", v: (k) => k.hint || "", cell: (k) => "…" + k.hint },
        { k: "st", role: "status", label: "State", v: (k) => (k.active ? "on" : "off"), cell: (k) => <span className={"tag " + (k.active ? "ok" : "no")}>{k.active ? "On" : "Off"}</span> },
        { k: "label", label: "Label", v: (k) => k.label || "", cell: (k) => k.label },
        { k: "uses", label: "Files sent", cls: "n", v: (k) => k.uses || 0, sum: true, fmt: String, cell: (k) => k.uses || 0 },
        { k: "last", label: "Last used", v: (k) => k.last_used || "", cell: (k) => (k.last_used ? fmtDate(String(k.last_used).slice(0, 10)) : "—") },
        { k: "ac", role: "act", cell: (k) => (k.active ? <button className="linkbtn" onClick={() => acctDropOff(k.id)}>Switch off</button> : "off") },
      ]} /></div> : null}
  </>;
}

function Backups() {
  if (!Cloud.on()) return null;
  const list = S.backups;
  return <>
    <H3>Backups</H3>
    <p className="note" style={{ margin: "0 0 6px" }}>A copy of this firm’s clients, bills, bank statements and sales is taken every night and the last fourteen are kept. Download one to keep outside the system.</p>
    <div className="row"><Act act="backupList">{list ? "Refresh" : "Show backups"}</Act><Act act="backupNow">Take one now</Act></div>
    {list && <div style={{ marginTop: 8 }}><ListTable name="backups" className="data" rows={list.slice(0, 14)} rowKey={(b) => b.id} unit={["backup", "backups"]}
      empty={<>None yet. Use <b>Take one now</b> to take the first.</>}
      cols={[
        { k: "at", role: "date", label: "Taken", v: (b) => b.taken_at || "", cell: (b) => at(b.taken_at) },
        { k: "cl", label: "Clients", cls: "n", v: (b) => num(b.clients), cell: (b) => b.clients },
        { k: "rec", label: "Records", cls: "n", v: (b) => num(b.records), cell: (b) => b.records },
        { k: "size", label: "Size", cls: "n", v: (b) => num(b.bytes), cell: (b) => Math.round(num(b.bytes) / 1024) + " KB" },
        { k: "ac", role: "act", cell: (b) => <button className="btn small" onClick={() => acctBackup(b.id)}>Download</button> },
      ]} /></div>}
  </>;
}

// the rest of Sign-in and people: people, documents, drop keys, backups
export function PeopleEtc() {
  const a = S.account;
  if (!a) return null;
  return <div className="pane"><People canManage={(a.me || {}).role === "owner" || a.superadmin === true} /><DocsSettings /><DropKeys /><Backups /></div>;
}

const Admin = ({ act, firm, name, plan, className = "btn small", children }) => <button className={className} onClick={() => adminAct(act, firm, { name, plan })}>{children}</button>;

// the platform page (FinCom's administrators only): firms, prices, new firms, plans, new accounts, keys
export function Platform() {
  const a = S.account;
  if (!a || !a.superadmin) return null;
  const d = S.adminData;
  if (!d) return <div className="pane"><h2>Platform (administrator only)</h2><p className="note">Reading… <Act act="adminRefresh">Refresh</Act></p></div>;
  const firms = d.firms || [], plans = d.plans || [];
  const pf = S.adminPrices && firms.find((x) => x.id === S.adminPrices);
  const pe = S.planEdit && (plans.find((x) => x.id === S.planEdit) || { name: "", monthly_fee: 0, includes: {}, note: "" });
  const su = d.signup || { open: false };
  return <div className="pane"><h2>Platform (administrator only)</h2>
    <div className="bk-figs" style={{ margin: "0 0 10px" }}><div><dt>Firms</dt><dd>{firms.length}</dd></div><div><dt>Credit held</dt><dd>{money(firms.reduce((s, f) => s + num(f.balance), 0))}</dd></div><div><dt>Charged this month</dt><dd>{money(num(d.month))}</dd></div></div>
    <ListTable name="adminFirms" className="data" rows={firms} rowKey={(f) => f.id} unit={["firm", "firms"]}
      cols={[
        { k: "name", role: "party", label: "Firm", v: (f) => f.name, cell: (f) => <><b>{f.name}</b>{f.note && <div className="nr">{f.note}</div>}</> },
        { k: "bal", role: "amount", label: "Credit", cls: "n", v: (f) => num(f.balance), td: (f) => ({ style: num(f.balance) <= 0 ? { color: "var(--stop)" } : undefined }), cell: (f) => money(num(f.balance)) },
        { k: "st", role: "status", label: "State", v: (f) => (f.active ? "on" : "off"), cell: (f) => <span className={"tag " + (f.active ? "ok" : "no")}>{f.active ? "On" : "Off"}</span> },
        { k: "plan", label: "Plan", cell: (f) => <select aria-label={"Plan of " + f.name} value={f.plan_id || ""} onChange={(ev) => adminPlan(f.id, ev.target.value)}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name + (num(p.monthly_fee) ? " (" + money(num(p.monthly_fee)) + "/m)" : "")}</option>)}</select> },
        { k: "used", label: "Used this period", cls: "n", v: (f) => num(f.used_this_period), sum: true, cell: (f) => money(num(f.used_this_period)) },
        { k: "people", label: "People", cls: "n", v: (f) => num(f.people), sum: true, fmt: String, cell: (f) => f.people },
        { k: "ac", role: "act", td: () => ({ style: { whiteSpace: "nowrap" } }), cell: (f) => <><Admin act="credit" firm={f.id} name={f.name}>Add credit</Admin>{" "}<Admin act="prices" firm={f.id} name={f.name} className="linkbtn">Prices</Admin>{" "}<Admin act={f.active ? "off" : "on"} firm={f.id} className="linkbtn">{f.active ? "Switch off" : "Switch on"}</Admin></> },
      ]} />
    {pf && <div className="bdiag" style={{ marginTop: 10 }}><b>{"Prices for " + pf.name}</b> — blank means the standard price.
      <table className="data" style={{ marginTop: 6 }} data-statement=""><tbody>{(pf.modules || []).map((m) => { const std = (d.modules || []).find((x) => x.code === m.code) || {};
        return <tr key={m.code}><td>{(MODULE_ICON[m.code] || "") + " " + (std.title || m.code)}<div className="nr">{(std.unit || "") + " · standard " + money(num(std.price))}</div></td>
          <td style={{ width: 130 }}><input type="number" step="0.01" min="0" id={"pr_" + m.code} aria-label={"Price of " + (std.title || m.code)} defaultValue={num(m.price) === num(std.price) ? "" : num(m.price)} placeholder={num(std.price)} /></td>
          <td><label className="chk"><input type="checkbox" id={"en_" + m.code} defaultChecked={!!m.enabled} /> on</label></td></tr>; })}</tbody></table>
      <div className="row" style={{ marginTop: 8 }}><Admin act="savePrices" firm={pf.id} className="btn small primary">Save prices</Admin><Admin act="closePrices">Close</Admin></div></div>}
    <H3>Add a firm</H3>
    <div className="bk-form three"><label><span>Firm name</span><input type="text" id="nfName" aria-label="Firm name" /></label><label><span>Owner email</span><input type="email" id="nfEmail" aria-label="Owner email" /></label><label><span>Owner name</span><input type="text" id="nfOwner" aria-label="Owner name" /></label></div>
    <div className="bk-form three" style={{ marginTop: 6 }}><label><span>Plan</span><select id="nfPlan" aria-label="Plan of the new firm">{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span>Opening credit</span><input type="number" id="nfCredit" aria-label="Opening credit" defaultValue={0} min="0" step="100" /></label></div>
    <div className="row" style={{ marginTop: 6 }}><Admin act="createFirm" className="btn small primary">Create the firm</Admin></div>
    {S.newFirm && <p className="bk-alert" style={{ marginTop: 8 }}>Firm made. <b>{S.newFirm.email}</b> signs in with the password <b>{S.newFirm.password}</b>. Shown only now.</p>}
    <H3>Plans</H3><div className="tblwrap"><table className="data" data-statement=""><thead><tr><th>Plan</th><th className="n">Monthly</th><th>Included</th><th></th></tr></thead><tbody>
      {plans.map((p) => <tr key={p.id}><td>{p.name}{p.note && <div className="nr">{p.note}</div>}</td><td className="n">{num(p.monthly_fee) ? money(num(p.monthly_fee)) : "—"}</td>
        <td>{Object.keys(p.includes || {}).length ? Object.entries(p.includes).map(([k, v]) => k + (v && v.cap ? " (" + v.cap + ")" : "")).join(", ") : "nothing — pay per use"}</td>
        <td><Admin act="editPlan" plan={p.id} className="linkbtn">Change</Admin></td></tr>)}</tbody></table></div>
    {pe && <div className="bdiag" style={{ marginTop: 10 }} key={S.planEdit}><b>{pe.id ? "Change this plan" : "New plan"}</b>
      <div className="bk-form two" style={{ marginTop: 6 }}><label><span>Name</span><input type="text" id="plName" aria-label="Plan name" defaultValue={pe.name} /></label><label><span>Monthly fee</span><input type="number" id="plFee" aria-label="Monthly fee" step="50" min="0" defaultValue={num(pe.monthly_fee)} /></label></div>
      <div style={{ marginTop: 8 }}>Included, and how much of it:</div><table className="data" data-statement=""><tbody>
        {(d.modules || []).filter((m) => m.billing !== "free").map((m) => { const inc = (pe.includes || {})[m.code];
          return <tr key={m.code}><td>{(MODULE_ICON[m.code] || "") + " " + m.title}</td><td><label className="chk"><input type="checkbox" id={"inc_" + m.code} defaultChecked={!!inc} /> included</label></td>
            <td style={{ width: 150 }}><input type="number" id={"cap_" + m.code} aria-label={"Limit of " + m.title} min="0" step="10" defaultValue={inc && inc.cap ? inc.cap : ""} placeholder="no limit" /></td></tr>; })}</tbody></table>
      <label className="f" style={{ marginTop: 6 }}><span>Note</span><input type="text" id="plNote" aria-label="Plan note" defaultValue={pe.note || ""} /></label>
      <div className="row" style={{ marginTop: 8 }}><Admin act="savePlan" plan={pe.id || ""} className="btn small primary">Save the plan</Admin><Admin act="closePlan">Close</Admin></div></div>}
    <div className="row" style={{ marginTop: 6 }}><Admin act="newPlan">Add a plan</Admin><Admin act="runMonthly">Run this month's charges</Admin><Act act="adminRefresh">Refresh</Act></div>
    <H3>New accounts</H3>
    <div className="bk-form three"><label className="chk" style={{ alignSelf: "end" }}><input type="checkbox" id="suOpen" defaultChecked={!!su.open} /> Anyone may create an account</label>
      <label><span>Credit to start with</span><input type="number" id="suCredit" aria-label="Credit to start with" defaultValue={num(su.trial_credit || 0)} step="50" min="0" /></label>
      <label><span>Plan they start on</span><select id="suPlan" aria-label="Plan they start on" defaultValue={su.plan}>{plans.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</select></label></div>
    <div className="row" style={{ marginTop: 6 }}><Admin act="saveSignup">Save</Admin></div>
    <H3>Keys (only you)</H3><p className="note" style={{ margin: "0 0 6px" }}>These stay on the server. Firms use Claude and Google through us and never see a key. A key cannot be read back here — only replaced.</p>
    <div className="tblwrap"><table className="data" data-statement=""><tbody>{[["claude_api_key", "Claude API key"], ["google_vision_key", "Google Cloud Vision key"]].map(([k, label]) => { const s = (d.secrets || []).find((x) => x.name === k);
      return <tr key={k}><td>{label}</td><td>{s ? <><span className="tag ok">set</span>{" …" + (s.tail || "") + " · " + fmtDate(s.updated_at)}</> : <span className="tag no">not set</span>}</td>
        <td><input type="password" id={"sec_" + k} aria-label={"New " + label} placeholder="paste a new key" /></td><td><Admin act="saveSecret" name={k}>Save</Admin></td></tr>; })}</tbody></table></div>
  </div>;
}
