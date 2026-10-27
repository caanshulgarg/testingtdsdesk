// API keys and integrations (Owner only). Write-only: a key is pasted once and never shown again, only its last 4.
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Facts, Loading, Page, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { call } from "../../lib/api.js";
import { fmtDate, fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";

const STORES = [{ value: "table", label: "Console" }, { value: "vault", label: "Vault" }, { value: "env", label: "Function secret" }];
const PROVIDERS = ["Anthropic", "Google", "Groq", "Resend", "Cloudflare", "FinCom (internal)", "Sentry", "TaxPro GSP", "Zoho", "FYN"];
export function SetChip({ r }) {
  return r.set ? <Chip tone="good" testid="key-set">Set{r.last4 ? " · …" + r.last4 : ""}</Chip> : <Chip tone="warn" testid="key-set">Not set</Chip>;
}
export function TestChip({ r }) {
  if (r.last_test_ok === null || r.last_test_ok === undefined) return <span className="muted" title="Not tested yet">–</span>;
  return <Chip tone={r.last_test_ok ? "good" : "bad"} testid="key-test">{r.last_test_ok ? "Passed" : "Failed"}</Chip>;
}
const COLUMNS = [
  { key: "label", label: "Key", type: "text", render: (r) => <span><b>{r.label}</b><br /><code className="muted small">{r.name}</code></span> },
  { key: "provider", label: "Provider", type: "select", options: PROVIDERS, phone: false },
  { key: "set", label: "Status", type: "bool", yes: "Set", no: "Not set", render: (r) => <SetChip r={r} /> },
  { key: "powers", label: "Powers", type: "text", phone: false },
  { key: "last_used", label: "Last used", type: "date", phone: false, render: (r) => (r.usage_known ? fmtDate(r.last_used) : <span className="muted" title="FinCom cannot know when this key was last used">n/a</span>) },
  { key: "last_test_ok", label: "Last test", type: "bool", yes: "Passed", no: "Failed", render: (r) => <TestChip r={r} /> },
  { key: "last_test_at", label: "Tested on", type: "date", hidden: true },
  { key: "rotate_by", label: "Rotate by", type: "date", phone: false, render: (r) => (r.rotate_by ? <span>{fmtDate(r.rotate_by)} {r.rotate_due && <Chip tone="warn">Due</Chip>}</span> : "–") },
  { key: "store", label: "Kept in", type: "select", options: STORES, hidden: true },
  { key: "rotate_due", label: "Rotation due", type: "bool", hidden: true },
  { key: "set_at", label: "Set on", type: "date", hidden: true },
  { key: "rotated_at", label: "Last rotated", type: "date", hidden: true },
  { key: "last4", label: "Last 4", type: "text", hidden: true },
  { key: "name", label: "Name", type: "text", hidden: true },
];
const PRESETS = [
  { label: "All", filters: {} },
  { label: "Not set", filters: { set: { op: "is", value: false } } },
  { label: "Test failed", filters: { last_test_ok: { op: "is", value: false } } },
  { label: "Rotation due", filters: { rotate_due: { op: "is", value: true } } },
];

function Keys({ me }) {
  return (
    <Page title="Keys and integrations" sub="Every platform key the server functions use. A key is never shown again after it is saved: only its last 4 characters.">
      <DataTable id="keys" action="keys.list" columns={COLUMNS}
                 presets={PRESETS} me={me} exportName="keys" rowKey="name" onRow={(r) => go("keys/" + encodeURIComponent(r.name))} />
    </Page>
  );
}

function TestButton({ name, onDone }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const run = async () => {
    setBusy(true); setRes(null);
    try { const d = await call("keys.test", { name }); setRes(d); onDone && onDone(); } catch (e) { setRes({ ok: false, msg: e.message }); }
    setBusy(false);
  };
  return (
    <>
      <button className="btn" onClick={run} disabled={busy} data-action="keys.test">{busy ? "Testing…" : "Test"}</button>
      {res && <div className={"note " + (res.ok ? "" : "note-bad")} role="status" data-testid="test-result">{res.ok ? "Passed: " : "Failed: "}{res.msg}</div>}
    </>
  );
}

function Key({ me, name }) {
  const { loading, data: k, error, reload } = useAction("key.get", { name });
  if (loading && !k) return <Page title="Key"><Loading /></Page>;
  if (!k) return <Page title="Key"><ErrorNote error={error} onRetry={reload} /></Page>;
  const valueField = (m, set) => (
    <label className="field"><span>New value (pasted once; it is never shown again)</span>
      <input className="input" type="password" autoComplete="new-password" spellCheck={false} value={m.value || ""} onChange={(e) => set({ ...m, value: e.target.value })} data-testid="key-value" required />
    </label>
  );
  return (
    <Page title={k.label} sub={<a href={href("keys")}>← All keys</a>}
          actions={<>
            {k.writable && <ReasonButton me={me} action="keys.set" params={{ name: k.name }} label={k.set ? "Replace" : "Set"} title={(k.set ? "Replace " : "Set ") + k.label} confirm="Save" extra={valueField} onDone={reload} />}
            {!k.writable && <ReasonButton me={me} action="keys.rotated" params={{ name: k.name }} label="Record rotation" title={"Record that " + k.name + " was changed"} confirm="Record" onDone={reload} />}
            {me.actions.includes("keys.test") && <TestButton name={k.name} onDone={reload} />}
          </>}>
      <ErrorNote error={error} onRetry={reload} />
      <div className="chips"><SetChip r={k} /><TestChip r={k} />{k.rotate_due && <Chip tone="warn">Rotation due</Chip>}</div>
      {k.warn && <div className="note note-warn" role="note">{k.warn}</div>}
      {!k.writable && (
        <div className="note" role="note">
          This key is a Supabase function secret. The console can read it to test it, but cannot change it. Change it with
          {" "}<code>supabase secrets set {k.name}=…</code>, then press <b>Record rotation</b> so the reason and the new last 4 are kept here.
        </div>
      )}
      {k.fallback && <p className="muted small">When this is not set, the function uses its secret <code>{k.fallback}</code> ({k.fallback_set ? "set" : "not set"}).</p>}
      <Facts items={[["Name", <code key="n">{k.name}</code>], ["Provider", k.provider], ["Kept in", (STORES.find((s) => s.value === k.store) || {}).label],
                     ["Last 4", k.last4 ? "…" + k.last4 : k.set ? "Hidden (short value)" : "–"], ["Set on", fmtTime(k.set_at)], ["Set by", k.set_by || "–"],
                     ["Last used", k.usage_known ? fmtTime(k.last_used) : "Not known"], ["Last rotated", fmtTime(k.rotated_at)], ["Rotated by", k.rotated_by || "–"],
                     ["Rotate by", k.rotate_by ? fmtDate(k.rotate_by) : "–"], ["Last test", k.last_test_at ? fmtTime(k.last_test_at) : "Never"]]} />
      {k.rotate_reason && <p className="muted">Reason for the last change: “{k.rotate_reason}”{k.last4_before ? ` (last 4 was …${k.last4_before})` : ""}</p>}
      {k.last_test_msg && <div className={"note " + (k.last_test_ok ? "" : "note-bad")} data-testid="last-test">{k.last_test_ok ? "Last test passed: " : "Last test failed: "}{k.last_test_msg}</div>}
      <section className="card">
        <h2>What stops if this key fails</h2>
        <ul className="list">{(k.powers_list || []).map((p) => <li key={p}>{p}</li>)}</ul>
      </section>
    </Page>
  );
}

export const module = {
  id: "keys", label: "Keys", icon: KeyRound, action: "keys.list",
  routes: [
    { path: /^keys$/, render: (_, me) => <Keys me={me} /> },
    { path: /^keys\/([^/]+)$/, render: (m, me) => <Key me={me} name={decodeURIComponent(m[1])} key={m[1]} /> },
  ],
};
