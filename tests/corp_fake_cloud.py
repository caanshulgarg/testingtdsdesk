"""A stand-in for FinCom's cloud as Corporate's store (app/src/screens/corp/store.js) talks to it, put in the page in place
of Cloud.on / Cloud.api (made-up rows only; nothing leaves the page). It answers PostgREST as the corp_* tables of
migrations 143-145 would: GET with eq filters, POST (a duplicate key: an error, as the unique index), PATCH with eq filters
(updated_at included: the conditional update), DELETE; every write gives the row a new updated_at, as the tables' trigger
does. INSTALL(page) puts it in; the page's window.__fake holds {rows, log, missing, delay, hold}.
  __fake.rows[table]        the server's rows
  __fake.missing[table]     true: the table is not there (the migration not run): PGRST205
  __fake.delay              ms each call waits (a save in flight)
  __fake.restore()          Cloud.on / Cloud.api as they were"""

INSTALL = r"""() => {
  if (window.__fake) window.__fake.restore();
  const realOn = Cloud.on, realApi = Cloud.api;
  let tick = 0;
  const stamp = () => '2026-11-07T10:00:00.' + String(++tick).padStart(6, '0') + '+00:00';
  const F = window.__fake = {rows: {corp_profiles: [], corp_filings: [], corp_documents: []}, log: [], missing: {}, delay: 0,
    restore() { Cloud.on = realOn; Cloud.api = realApi; delete window.__fake; }, stamp};
  const keyOf = {corp_profiles: (r) => r.client_id, corp_filings: (r) => r.client_id + '|' + r.ref, corp_documents: (r) => r.id};
  const parse = (path) => { const [t, q] = path.split('?'); const f = {}; (q || '').split('&').forEach((kv) => { const m = /^([a-z_]+)=eq\.(.*)$/.exec(kv); if (m) f[m[1]] = decodeURIComponent(m[2]); }); return {t, f}; };
  const match = (r, f) => Object.entries(f).every(([k, v]) => String(r[k]) === v);
  const copy = (x) => JSON.parse(JSON.stringify(x));
  Cloud.on = () => true;
  Cloud.api = async (path, opts) => {
    const method = (opts && opts.method) || 'GET', body = opts && opts.body ? copy(opts.body) : null, {t, f} = parse(path);
    F.log.push({path, method, body});
    if (F.delay) await new Promise((r) => setTimeout(r, F.delay));
    if (F.missing[t]) throw new Error("Could not find the table 'public." + t + "' in the schema cache");
    const rows = F.rows[t]; if (!rows) return [];
    if (method === 'GET') return copy(rows.filter((r) => match(r, f)));
    if (method === 'POST') {
      if (rows.some((r) => keyOf[t](r) === keyOf[t](body))) throw new Error('duplicate key value violates unique constraint (23505)');
      const r = Object.assign({}, body, {updated_at: stamp()}); if (t !== 'corp_profiles' && !r.id) r.id = 'srv-' + tick; rows.push(r); return [copy(r)];
    }
    if (method === 'PATCH') { const hit = rows.filter((r) => match(r, f)); hit.forEach((r) => { Object.assign(r, body, {updated_at: stamp()}); }); return copy(hit); }
    if (method === 'DELETE') { F.rows[t] = rows.filter((r) => !match(r, f)); return null; }
    return [];
  };
}"""
