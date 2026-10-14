"""python3 run_dep_tool.py - migration 81 (asst_dep_register) and the Assistant's depreciation_schedule, end to end:
  1. the file: add-only (one function, no table touched, nothing deleted or dropped), one transaction with a lock timeout;
     its md5 printed
  2. on a throwaway PostgreSQL (pg_stand through assistant_stand, row-level security as on staging), run TWICE; the
     function is STABLE and SECURITY INVOKER; the register kept as BookItems keeps it (client_book_items, key
     'fixedAssets', item '.2025') read back as the firm's member, staff and a look-only member equals what the app kept;
     the year before comes with it; a member of another firm gets only its own client's register of the same id (never
     this firm's); the anon role may not run it; a bad year gives nothing; the client_books blob is read when there are
     no items; it cannot write
  3. deno test server/assistant/tools/depreciation_test.ts on what the function returned (DEP_RPC): the figures to the paisa
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it step 3 says skipped (on CI it fails)."""
import os, sys, json, re, shutil, subprocess, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
ROOT = os.path.join(HERE, "..")
OUT = os.environ.get("TDSDESK_OUT") or os.path.join(HERE, "out")
MIG = os.path.join(ROOT, "server", "assistant", "migration-81-depreciation.sql")
q = A.q

print("== 1. the file")
ok(os.path.exists(MIG), "server/assistant/migration-81-depreciation.sql is there")
text = open(MIG).read()
print("   md5 %s, %d bytes" % (hashlib.md5(text.encode()).hexdigest(), len(text)))
body = re.sub(r"\b(revoke|grant)\b[^;]*;", "", re.sub(r"--[^\n]*", "", text).lower())
ok(not re.search(r"\bdelete\s+from\b", text, re.I) and not re.search(r"\bdrop\s+(table|column|function|index|policy|schema|view)\b|\btruncate\b|\balter\s+table\b|\bcreate\s+table\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b", body), "add-only: one function, no table touched, nothing deleted or dropped")
ok(body.count("begin;") == 1 and "commit;" in body and "lock_timeout" in body, "one transaction with a lock timeout")
ok(re.findall(r"create or replace function public\.([a-z_0-9]+)\(", body) == ["asst_dep_register"], "one function: asst_dep_register")

reg = json.loads(subprocess.check_output(["node", "-e", "process.stdout.write(JSON.stringify(require('./dep_fixtures').handRegister()))"], cwd=HERE))
prev = json.loads(json.dumps(reg)); prev["fy"] = "2024"; prev["assets"] = prev["assets"][:1]
db = A.start(55481)
try:
    db.sql("create table if not exists client_books (firm_id uuid, client_id text, part text default 'work', rev integer default 1, data jsonb default '{}', updated_at timestamptz default now(), updated_by uuid, primary key (firm_id, client_id, part));"
           "alter table client_books enable row level security; drop policy if exists client_books_read on client_books; create policy client_books_read on client_books for select to authenticated using (firm_id = my_firm()); grant select on client_books to authenticated;")
    print("== 2. on pg_stand")
    for i in (1, 2):
        try: db.sql(text); ok(True, "run %d: no error" % i)
        except RuntimeError as e: ok(False, "run %d: %s" % (i, str(e)[-300:]))
    pr = db.one("select provolatile::text || ':' || prosecdef::text from pg_proc where proname = 'asst_dep_register'")
    ok(pr == "s:false", "asst_dep_register is STABLE and SECURITY INVOKER (%s)" % pr)
    db.sql("insert into firms values (%s, 'Garg Test Firm'), (%s, 'Another Firm');" % (q(A.FIRM), q(A.OTHER)) +
           "insert into members (user_id, firm_id, name, role) values (%s, %s, 'Owner', 'owner'), (%s, %s, 'Staff', 'staff'), (%s, %s, 'Viewer', 'viewer'), (%s, %s, 'Stranger', 'owner');" % (q(A.ME), q(A.FIRM), q(A.STAFF), q(A.FIRM), q(A.VIEWER), q(A.FIRM), q(A.STRANGER), q(A.OTHER)))
    # the members: assistant_stand's firm (owner, staff, look-only) and a member of another firm
    other = json.loads(json.dumps(reg)); other["assets"] = other["assets"][2:]; other["assets"][0]["ledger"] = "OTHERFIRM"
    rows = [(A.FIRM, A.CLIENT, "fixedAssets", "", {"$t": "obj"}), (A.FIRM, A.CLIENT, "fixedAssets", ".2025", reg), (A.FIRM, A.CLIENT, "fixedAssets", ".2024", prev),
            (A.OTHER, A.CLIENT, "fixedAssets", ".2025", other)]
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values " + ",".join("(%s, %s, %s, %s, %s::jsonb)" % (q(f), q(c), q(k), q(i), q(json.dumps(d))) for f, c, k, i, d in rows) + " on conflict do nothing;")
    J = lambda fy, uid=A.ME: A.askj(db, "select asst_dep_register(%s, %s)" % (q(A.CLIENT), "null" if fy is None else q(fy)), uid)
    me = J("2025")
    ok(me["reg"] == reg, "the register read back as the firm's member is what the app kept (%d assets)" % len(me["reg"]["assets"]))
    ok(me["prev"] == prev and me["years"] == ["2025", "2024"], "last year's register comes with it; the years kept, latest first")
    ok(J("2025", A.STAFF)["reg"] == reg and J("2025", A.VIEWER)["reg"] == reg, "staff and a look-only member read it too")
    st = J("2025", A.STRANGER)
    ok(st["reg"]["assets"][0]["ledger"] == "OTHERFIRM" and st["prev"] is None and "Edge Binding Machine" not in json.dumps(st), "a member of another firm sees only its own client of the same id, never this firm's register")
    ok(J("2023")["reg"] is None and J("20x5")["reg"] is None and J(None)["reg"] is None, "a year not kept, or not a year: nothing")
    try: anon = db._psql(["-t", "-A"], "set role anon;\nselect asst_dep_register('larkspur', '2025');")
    except RuntimeError as e: anon = str(e)
    ok("permission denied" in str(anon).lower(), "the anon role may not run it")
    w = db._psql(["-t", "-A"], "set fincom.uid = '%s';\nset role authenticated;\ndo $$ begin perform asst_dep_register('larkspur', '2025'); end $$;\nselect 'read';" % A.ME)
    ok("read" in w, "runs as the member, read only")
    # the tool test works to the hand-worked figures of the year itself; last year's register (checked above) is left out
    # there, as its closing would be this year's opening in place of the openings typed for the test
    rpc = {"me": dict(me, prev=None), "stranger": st}
    # without items: the client_books blob (BookSync)
    db.sql("update client_book_items set deleted = true where key = 'fixedAssets' and firm_id = %s;" % q(A.FIRM) +
           "insert into client_books (firm_id, client_id, part, data) values (%s, %s, 'work', %s::jsonb) on conflict do nothing;" % (q(A.FIRM), q(A.CLIENT), q(json.dumps({"fixedAssets": {"2025": reg}}))))
    ok(J("2025")["reg"] == reg, "without items, read from the client_books blob")
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "dep-rpc.json"), "w").write(json.dumps(rpc))
finally:
    db.stop()

DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    ok(not os.environ.get("GITHUB_ACTIONS"), "deno test server/assistant/tools/depreciation_test.ts: skipped (no deno)")
else:
    env = dict(os.environ, DEP_RPC=os.path.join(OUT, "dep-rpc.json"), NO_COLOR="1")
    if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
    r = subprocess.run([DENO, "test", "--allow-read", "--allow-run", "--allow-env", "server/assistant/tools/depreciation_test.ts"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    for line in out.splitlines():
        if (" ... ok" in line or " ... FAILED" in line) and "=>" not in line: print("   ", line.strip())
    ok(r.returncode == 0, "deno test server/assistant/tools/depreciation_test.ts, on what asst_dep_register returned")
    if r.returncode: print(out[-5000:])
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
