"""python3 run_audit_wp_tool.py - the Assistant's audit tools end to end, from the browser's run to the chat's table:
  1. node run_audit_wp.js: the audit on the made-up book (tests/audit_fixture.js), kept with the books as items
     (tests/out/audit-wp-items.json);
  2. migration-78-audit.sql on a throwaway PostgreSQL (assistant_stand.py, row-level security as on staging): add-only, runs
     twice; asst_audit_wp is STABLE and SECURITY INVOKER; the items stored as BookItems keeps them (client_book_items,
     '#<id>' rows), read back as the firm's member equal what the browser kept, to the paisa; a member of another firm and
     the anon role get nothing; the client_books blob is read when there are no items;
  3. deno test server/assistant/tools/audit_test.ts on what the function returned (AUDIT_WP_RPC).
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it step 3 says skipped (on CI it fails)."""
import os, sys, json, re, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
ROOT = os.path.join(HERE, "..")
OUT = os.environ.get("TDSDESK_OUT") or os.path.join(HERE, "out")
MIG = os.path.join(ROOT, "server", "assistant", "migration-78-audit.sql")
q = A.q

r = subprocess.run(["node", "run_audit_wp.js"], cwd=HERE, capture_output=True, text=True, timeout=300)
ok(r.returncode == 0, "node run_audit_wp.js (the browser's audit on the fixture)")
if r.returncode: print(r.stdout[-3000:] + r.stderr[-2000:])
IT = json.load(open(os.path.join(OUT, "audit-wp-items.json")))
per = IT["period"]

text = open(MIG).read()
body = re.sub(r"\b(revoke|grant)\b[^;]*;", "", re.sub(r"--[^\n]*", "", text).lower())
ok(not re.search(r"\bdelete\s+from\b|\bdrop\s+(table|column|function|index|policy)\b|\btruncate\b|\balter\s+table\b|\bcreate\s+table\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b", body), "add-only: one function, no table touched")
ok(body.count("begin;") == 1 and "commit;" in body and "lock_timeout" in body, "one transaction with a lock timeout")

db = A.start(55479)
try:
    A.load_fixture(db)
    # the blob the books were kept in before client_book_items (BookSync), as on staging
    db.sql("create table if not exists client_books (firm_id uuid, client_id text, part text default 'work', rev integer default 1, data jsonb default '{}', updated_at timestamptz default now(), updated_by uuid, primary key (firm_id, client_id, part));"
           "alter table client_books enable row level security; create policy client_books_read on client_books for select to authenticated using (firm_id = my_firm()); grant select on client_books to authenticated;")
    db.sql(text); db.sql(text)
    ok(True, "migration 78 runs twice")
    pr = db.one("select provolatile::text || ':' || prosecdef::text from pg_proc where proname = 'asst_audit_wp'")
    ok(pr == "s:false", "asst_audit_wp is STABLE and SECURITY INVOKER (%s)" % pr)
    # the items as BookItems.split keeps an array of things with ids: the shape row, then one row per item, in order
    rows = [(A.FIRM, A.CLIENT, "auditWp", "", None, {"$t": "arr"})] + [(A.FIRM, A.CLIENT, "auditWp", "#" + it["id"], n, it) for n, it in enumerate(IT["items"])]
    # another firm's client of the same id, with a different run: never seen by this firm
    other = json.loads(json.dumps([x for x in IT["items"] if x["kind"] == "run"])); other[0]["code"] = "OTHERFIRM"
    rows += [(A.OTHER, A.CLIENT, "auditWp", "#" + other[0]["id"], 0, other[0])]
    db.sql("insert into client_book_items (firm_id, client_id, key, item, ord, data) values " + ",".join("(%s, %s, %s, %s, %s, %s::jsonb)" % (q(f), q(c), q(k), q(i), "null" if o is None else o, q(json.dumps(d))) for f, c, k, i, o, d in rows) + ";")
    J = lambda p, uid=A.ME: A.askj(db, "select asst_audit_wp(%s, %s)" % (q(A.CLIENT), "null" if p is None else q(p)), uid)
    me = J(per)
    kept = next(x for x in IT["items"] if x["id"] == "run|" + per)
    ok(me["run"] == kept, "the run read back as the firm's member is what the browser kept (code %s)" % me["run"]["code"])
    ok([(c["id"], c["count"], c["amount"], c["score"], c["rank"]) for c in me["run"]["checks"]] == [(c["id"], c["count"], c["amount"], c["score"], c["rank"]) for c in IT["run"]["checks"]],
       "every check's count, amount, score and rank to the paisa")
    ok(sorted(w["check"] for w in me["wp"]) == ["cash269ST", "round"] and next(w for w in me["wp"] if w["check"] == "cash269ST")["remark"] == "Receipts to be explained by the client", "the working papers (status, remark) for the period")
    ok(me["periods"] == [{"period": per, "at": kept["at"]}], "the periods run, latest first")
    nul = J(None)
    ok(nul["run"] is None and nul["periods"] == me["periods"], "no period: no run, the periods to choose from")
    ok(J("20250701-20250930")["run"] is None, "a period not run: nothing")
    staff = J(per, A.STAFF); viewer = J(per, A.VIEWER)
    ok(staff["run"] == kept and viewer["run"] == kept, "staff and a look-only member read it too")
    st = J(per, A.STRANGER)
    ok(st["run"]["code"] == "OTHERFIRM" and st["wp"] == [], "a member of another firm sees only its own client of the same id (code OTHERFIRM), never this firm's run or papers")
    try: anon = db._psql(["-t", "-A"], "do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;\nset role anon;\nselect asst_audit_wp('larkspur', '%s');" % per)
    except RuntimeError as e: anon = str(e)
    ok("permission denied" in str(anon).lower(), "the anon role may not run it")
    # the blob (no items): BookSync's client_books
    db.sql("delete from client_book_items where key = 'auditWp' and firm_id = %s;" % q(A.FIRM) +
           "insert into client_books (firm_id, client_id, part, data) values (%s, %s, 'work', %s::jsonb);" % (q(A.FIRM), q(A.CLIENT), q(json.dumps({"auditWp": IT["items"]}))))
    ok(J(per)["run"] == kept, "without items, read from the client_books blob")
    # STABLE: the function cannot write (a write inside a STABLE function fails)
    w = db._psql(["-t", "-A"], "set fincom.uid = '%s';\nset role authenticated;\ndo $$ begin perform asst_audit_wp('larkspur', '%s'); end $$;\nselect 'read';" % (A.ME, per))
    ok("read" in w, "runs as the member, read only")
    rpc = {"me": {"null": nul, per: me}, "stranger": {per: st, "null": J(None, A.STRANGER)}}
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "audit-wp-rpc.json"), "w").write(json.dumps(rpc))
finally:
    db.stop()

DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    ok(not os.environ.get("GITHUB_ACTIONS"), "deno test server/assistant/tools/audit_test.ts: skipped (no deno)")
else:
    env = dict(os.environ, AUDIT_WP_RPC=os.path.join(OUT, "audit-wp-rpc.json"), AUDIT_WP_ITEMS=os.path.join(OUT, "audit-wp-items.json"), NO_COLOR="1")
    if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
    r = subprocess.run([DENO, "test", "--allow-read", "--allow-env", "server/assistant/tools/audit_test.ts"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    for line in out.splitlines():
        if (" ... ok" in line or " ... FAILED" in line) and "=>" not in line: print("   ", line.strip())
    ok(r.returncode == 0, "deno test server/assistant/tools/audit_test.ts")
    if r.returncode: print(out[-5000:])
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
