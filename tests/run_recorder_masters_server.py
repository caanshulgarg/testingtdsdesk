"""python3 run_recorder_masters_server.py - (07-Oct-2026, branch next-masterhook, Migration 66) tally-ingest's "recorder_lines"
with the add-on's master lines (master_created / master_altered from the Pay Head, Stock Item, Unit, Godown and Employee
forms), through the real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase
(fake_supabase.py) and a throwaway PostgreSQL (pg_stand) built 32 -> ... -> 51 as run_recorder_server.py builds it.
  1. before 66: a voucher line beside two master lines: the voucher applied as before; the master lines 'failed' with the
     words "Migration 66", nothing else of the call changed.
  2. after 66 (run here on the stand only): the master lines 'kept' with their heads in tally_recorder_masters (heads only:
     type, name, parent, GUID, MasterID, AlterID; no body), sent again 'duplicate'; an unknown master type 'failed', not kept;
     nothing of them in tally_recorder_lines.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading, re
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand, csv
csv.field_size_limit(1 << 30)     # the posted XML of 500 entries is one field (tally_post_xml_for)
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql", "migration-46-trial-tools.sql",
                                           "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql",
                                           "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
FIRM, BOOK, OWNER = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111", "55555555-5555-5555-5555-555555555555"
DA, DB_ = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002"
KA, KB = "fcd_" + "a" * 48, "fcd_" + "b" * 48
GA = {"id": "go-aaaaaa111111", "computer": "PC-A", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.2.0"}
GB = {"id": "go-bbbbbb222222", "computer": "PC-B", "user": "ravi", "mode": "main", "runMode": "user", "version": "2.2.0"}
db = pg_stand.start(int(os.environ.get("PG66S_PORT") or 55462))
fn = None
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))      # pgmq, pg_cron, Storage and tally_jobs as migration 47 needs them
    db.sql("""insert into firms values (%(F)s, 'Firm'); insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(A)s, %(F)s, 'PC-A', 'ha', '2.2.0'), (%(D)s, %(F)s, 'PC-B', 'hb', '2.2.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(FIRM), "O": q(OWNER), "B": q(BOOK), "A": q(DA), "D": q(DB_)})
    for path in FILES:
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                           input=open(path).read(), capture_output=True, text=True)
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.one("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s::jsonb, %s::jsonb)::text" % (q(BOOK), q(json.dumps([["Cash", "Cash-in-Hand", "-1000"], ["Sales", "Sales Accounts", "0"], ["Rent", "Indirect Expenses", "0"], ["Capital", "Capital Account", "1000"]])),
                                                                                                   q(json.dumps([["Sales Accounts", ""], ["Indirect Expenses", ""], ["Capital Account", ""]]))))
    db.sql("update tally_ledgers set tally_guid = 'g-' || lower(name) where book_id = %s" % q(BOOK))
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values ('00000001-0000-0000-0000-000000000000', %s, 'c1', 'ZZ CO', %s, 1, 'done')"
           % (q(FIRM), q(json.dumps({"vouchers": [{"id": "P1", "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:P1</NARRATION></VOUCHER>"}]}))))
    # the stand-in answers the recorder's functions from the database
    def lit(v):
        if v is None: return "null"
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, (int, float)): return repr(v)
        if isinstance(v, list) and name_is_array[0]: return "array[%s]::text[]" % ",".join(q(x) for x in v) if v else "'{}'::text[]"
        if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
        return q(v)
    real = FS.rpc
    name_is_array = [False]
    def rpc(name, a):
        if name in ("tally_recorder_apply", "tally_start_point", "tally_recorder_gap_check", "tally_post_window_save", "tally_post_xml_for", "tally_post_id_accept_reply", "tally_post_id_accept", "tally_recorder_short_held", "tally_recorder_short_retry", "tally_recorder_enqueue", "tally_recorder_send", "tally_recorder_masters_save"):
            FS.ARGS.setdefault(name, []).append(a)
            name_is_array[0] = name == "tally_post_xml_for"
            try: return json.loads(db.one("select public.%s(%s)::text" % (name, ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items()))))
            except RuntimeError as e: raise RuntimeError(str(e).split("\n")[0][:300])
        return real(name, a)
    FS.rpc = rpc
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": "c1", "book_id": BOOK})
    for did, key, name in ((DA, KA, "PC-A"), (DB_, KB, "PC-B")):
        FS.T["tally_devices"].append({"id": did, "firm_id": FIRM, "name": name, "key_hash": hashlib.sha256(key.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.2.0"})
    FS.start()
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = []
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    def call(body, key=KA):
        rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    def xml(guid, alter, date, amt, narr="Sale", ledger="Sales", cancel=False):
        return ('<VOUCHER REMOTEID="%s" VCHTYPE="Sales" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><ALTERID>%d</ALTERID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-%s</VOUCHERNUMBER>'
                '<NARRATION>%s</NARRATION><ISCANCELLED>%s</ISCANCELLED><ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST>'
                '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') % (guid, date, guid, alter, guid, narr, "Yes" if cancel else "No", ledger, amt, -amt)
    def line(lid, event, guid, alter, date="20260510", amt=None, **kw):
        x = {"line_id": lid, "event": event, "saved_at": "2026-10-04T10:00:00+05:30", "pc": "PC-A", "user": "anshul", "company_guid": "cg-1", "object_guid": guid, "master_id": "9",
             "alter_id": alter, "vch_type": "Sales", "vch_no": "S-" + str(guid), "vch_date": date, "ledgers": [{"name": "Sales", "guid": "g-sales"}], "save_ms": 8}
        if amt is not None: x["xml"] = xml(guid, alter, date, amt, **{k: v for k, v in kw.items() if k in ("narr", "ledger", "cancel")})
        x.update({k: v for k, v in kw.items() if k not in ("narr", "ledger", "cancel")}); return x
    rec = lambda lines, key=KA, bridge=GA: call({"kind": "recorder_lines", "company": "ZZ CO", "version": "2.3.2", "bridge": bridge, "lines": lines}, key)
    st = lambda r: {x.get("line_id"): x.get("state") for x in (r.get("results") or [])}
    why = lambda r, lid: [x.get("why") for x in (r.get("results") or []) if x.get("line_id") == lid][0]
    c, r = call({"kind": "start_point", "company": "ZZ CO", "guid": "cg-1", "altvchid": 40, "altmstid": 9, "at": "2026-10-04T09:00:00+05:30", "bridge": GA})
    def ml(lid, ev, mt, name, mid="", alter=None, guid=""):
        return {"line_id": lid, "event": ev, "master_type": mt, "name": name, "parent": "Primary", "object_guid": guid, "master_id": mid, "alter_id": alter,
                "saved_at": "2026-10-07T10:00:00+05:30", "pc": "PC-A", "user": "TALLY User", "company_guid": "cg-1", "xml": "<STOCKITEM/>", "ledgers": [{"name": "x"}]}
    print("== 1. before 66")
    c, r = rec([line("V1", "created", "v1", 41, amt=100), ml("M1", "master_created", "Stock Item", "PD Item 1"), ml("M2", "master_altered", "Unit", "Nos", "2563", 41, "cg-1-00000a03")])
    ok(c == 200 and st(r) == {"V1": "applied", "M1": "failed", "M2": "failed"} and "migration 66" in (why(r, "M1") or ""), "1. the voucher applied, the master lines failed with words (%s %s)" % (c, r))
    ok(db.one("select count(*) from tally_recorder_lines where line_id in ('M1', 'M2')") == "0", "1. no master line in tally_recorder_lines")
    print("== 2. after 66")
    r66 = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                         input="do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;\n" + open(os.path.join(SQLDIR, "migration-66-recorder-masters.sql")).read(), capture_output=True, text=True)
    ok(r66.returncode == 0, "66 runs on the stand: %s" % r66.stderr[-300:])
    c, r = rec([ml("M1", "master_created", "Stock Item", "PD Item 1"), ml("M2", "master_altered", "Unit", "Nos", "2563", 41, "cg-1-00000a03"), ml("M3", "master_altered", "Budget", "B1"),
                line("V2", "altered", "v1", 42, amt=120)])
    ok(c == 200 and st(r) == {"M1": "kept", "M2": "kept", "M3": "failed", "V2": "applied"} and r.get("kept") == 2, "2. kept, an unknown type failed, the voucher applied (%s)" % r)
    rows = db.rows("select line_id, event, master_type, name, parent, coalesce(object_guid, '') as g, master_id, coalesce(alter_id::text, '') as a, bridge, pc, tally_user, company from tally_recorder_masters order by line_id")
    ok([(x["line_id"], x["master_type"], x["name"], x["g"], x["a"]) for x in rows] == [("M1", "Stock Item", "PD Item 1", "", ""), ("M2", "Unit", "Nos", "cg-1-00000a03", "41")]
       and all(x["bridge"] == GA["id"] and x["pc"] == "PC-A" and x["company"] == "ZZ CO" for x in rows), "2. the heads kept (%s)" % rows)
    c, r = rec([ml("M2", "master_altered", "Unit", "Nos", "2563", 41, "cg-1-00000a03")])
    ok(st(r) == {"M2": "duplicate"} and db.one("select count(*) from tally_recorder_masters") == "2", "2. sent again: duplicate (%s)" % r)
    ok(db.one("select count(*) from tally_recorder_lines where line_id like 'M%'") == "0", "2. nothing of them in tally_recorder_lines")
    args = FS.ARGS.get("tally_recorder_masters_save", [])
    ok(args and all("xml" not in l and "ledgers" not in l for a in args for l in a["p_lines"]), "2. heads only to the database: no body, no ledgers")
finally:
    if fn: fn.terminate()
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
