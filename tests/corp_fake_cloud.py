"""A stand-in for FinCom's cloud as Corporate's store (app/src/screens/corp/store.js) talks to it, put in the page in place
of Cloud.on / Cloud.api (made-up rows only; nothing leaves the page). Corporate needs a firm account, so every Corporate
test signs in to this. It answers PostgREST as the corp_* tables of migrations 143-145 would: GET with eq filters, POST
(a duplicate key: an error, as the unique index), PATCH and DELETE with eq filters (updated_at included: conditional),
each write a new updated_at, as the tables' trigger. Any other path of the app: an error (the app's own sync is not
under test, and must not take empty answers for data). Its rows are kept in localStorage ("__corp_fake_rows"), read
at every call: two tabs share them as one server would, and INSTALL again after a reload finds them.
  INSTALL(page)             puts it in (and draws the page again); window.__fake:
  __fake.rows[table]        the server's rows
  __fake.missing[table]     true: the table is not there (the migration not run): PGRST205
  __fake.fail               "": answers; "net": every call fails like a dropped line (TypeError: Failed to fetch);
                            "write": reads answer, writes fail
  __fake.delay              ms each call waits (a save in flight)
  __fake.log                the calls: {path, method, body}
  __fake.restore()          Cloud.on / Cloud.api as they were"""

INSTALL = r"""() => {
  if (window.__fake) window.__fake.restore();
  const realOn = Cloud.on, realApi = Cloud.api, KEEP = '__corp_fake_rows';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEEP) || 'null'); } catch (e) { return null; } };
  let kept = load(), tick = (kept && kept.tick) || 0;
  const stamp = () => '2026-11-07T10:00:00.' + String(++tick).padStart(6, '0') + '+00:00';
  const F = window.__fake = {rows: (kept && kept.rows) || {corp_profiles: [], corp_filings: [], corp_documents: []}, log: [], missing: {}, delay: 0, fail: '',
    restore() { Cloud.on = realOn; Cloud.api = realApi; delete window.__fake; }, stamp,
    keep() { try { localStorage.setItem(KEEP, JSON.stringify({rows: F.rows, tick})); } catch (e) {} },
    clear() { F.rows = {corp_profiles: [], corp_filings: [], corp_documents: []}; F.keep(); }};
  const keyOf = {corp_profiles: (r) => r.client_id, corp_filings: (r) => r.client_id + '|' + r.ref, corp_documents: (r) => r.id};
  const parse = (path) => { const [t, q] = path.split('?'); const f = {}; (q || '').split('&').forEach((kv) => { const m = /^([a-z_]+)=eq\.(.*)$/.exec(kv); if (m) f[m[1]] = decodeURIComponent(m[2]); }); return {t, f}; };
  const match = (r, f) => Object.entries(f).every(([k, v]) => String(r[k]) === v);
  const copy = (x) => JSON.parse(JSON.stringify(x));
  Cloud.on = () => true;
  Cloud.api = async (path, opts) => {
    const method = (opts && opts.method) || 'GET', body = opts && opts.body ? copy(opts.body) : null, {t, f} = parse(path);
    if (!F.rows[t]) throw new Error('not in the test stand: ' + t);
    // another tab wrote since (its tick is ahead): its rows are the server's now
    const k2 = load(); if (k2 && (k2.tick || 0) > tick) { F.rows = k2.rows; tick = k2.tick; }
    F.log.push({path, method, body});
    if (F.delay) await new Promise((r) => setTimeout(r, F.delay));
    if (F.fail === 'net' || (F.fail === 'write' && method !== 'GET')) throw new TypeError('Failed to fetch');
    if (F.missing[t]) throw new Error("Could not find the table 'public." + t + "' in the schema cache");
    const rows = F.rows[t];
    let out = [];
    if (method === 'GET') out = rows.filter((r) => match(r, f));
    else if (method === 'POST') {
      if (rows.some((r) => keyOf[t](r) === keyOf[t](body))) throw new Error('duplicate key value violates unique constraint (23505)');
      const r = Object.assign({}, body, {updated_at: stamp()}); if (t !== 'corp_profiles' && !r.id) r.id = 'srv-' + tick; rows.push(r); out = [r];
    } else if (method === 'PATCH') { out = rows.filter((r) => match(r, f)); out.forEach((r) => { Object.assign(r, body, {updated_at: stamp()}); }); }
    else if (method === 'DELETE') { out = rows.filter((r) => match(r, f)); F.rows[t] = rows.filter((r) => !match(r, f)); }
    F.keep();
    return copy(out);
  };
  try { render(); } catch (e) {}
}"""
