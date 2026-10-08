"""python3 run_fast234_store.py - FinCom Bridge 2.3.4 (next-fastfetch; the owner's decision of 08-Oct-2026, "Allow, strip in
bridge"): what FinCom STORES from the new entry request equals what it stores from today's (FinComVoucherByMaster), on
real Tally answers of TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (push-design run 37657679690; bridge-go/testdata/fast234/: a
3-item sales invoice and a receipt per release). Each voucher is sent twice through the real cloud function
(server/tally-cloud/index.ts, kind recorder_lines, under Deno; parse.js reads the line's xml) into a throwaway PostgreSQL
(pg_stand, port 30586) built in staging's order 32 -> ... -> 60: once with today's answer (the voucher element of
<target>-bymaster.xml) into one book, once with the bridge's stripped answer (<target>-stripped.xml, what fastStripVoucher
keeps of the object export) into a twin book. Every row stored for the entry, in every table holding the entry's rows
(tally_vouchers, tally_lines and the entry-detail tables of migration 57: items, bills, cost centres, bank, TDS), is compared
column by column (the book, row ids and times left out). The ledger lines' order (line_no) is compared too and said apart:
an item invoice's object answer gives the party and tax lines before the lines under the items (as Tally's Day Book does).
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, re, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
TD = os.path.join(HERE, "..", "bridge-go", "testdata", "fast234")
ORDER = ["migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql", "@34", "migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql",
         "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql", "migration-40-states-carried.sql", "migration-41-day-counts.sql",
         "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql", "migration-46-trial-tools.sql",
         "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
         "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
         "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql"]
FILES = [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql") if f == "@34" else os.path.join(SQLDIR, f) for f in ORDER]
FN_PORT, FS.PORT = 30589, 30588
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
FIRM, OWNER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
DA, KA = "d1000000-0000-0000-0000-000000000001", "fcd_" + "a" * 48
GA = {"id": "go-aaaaaa234234", "computer": "PC-A", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.3.4"}
RELS = sorted(d for d in os.listdir(TD) if re.match(r"^\d+\.\d+$", d))
SIDES = ("today", "fast")
def vblock(x):
    return [b for b in re.findall(r"(?s)<VOUCHER[ >].*?</VOUCHER>", x) if "<MASTERID" in b][0]
def book_of(rel, side): return "%08d-0000-4000-8000-%012d" % (int(rel.replace(".", "")), 1 if side == "today" else 2)
def co_of(rel, side): return "FAST %s %s" % (rel, side.upper())
LEDGERS = [["Template Party", "Sundry Debtors", "0"], ["Output CGST", "Duties & Taxes", "0"], ["Output SGST", "Duties & Taxes", "0"], ["Sales", "Sales Accounts", "0"],
           ["HDFC Bank", "Bank Accounts", "0"], ["Spike Income", "Indirect Incomes", "0"], ["Capital", "Capital Account", "0"]]
GROUPS = [["Sundry Debtors", ""], ["Duties & Taxes", ""], ["Sales Accounts", ""], ["Bank Accounts", ""], ["Indirect Incomes", ""], ["Capital Account", ""]]
db = pg_stand.start(30586)
fn, tmp = None, tempfile.mkdtemp(prefix="fincom-fast234-")
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm'); insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(A)s, %(F)s, 'PC-A', 'ha', '2.3.4');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(FIRM), "O": q(OWNER), "A": q(DA)})
    for rel in RELS:
        for side in SIDES:
            db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', %s, '2026-04-01', '2026-03-31')" % (q(book_of(rel, side)), q(FIRM), q(co_of(rel, side))))
    for path in FILES:
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                           input=open(path).read(), capture_output=True, text=True)
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    for rel in RELS:
        for side in SIDES:
            db.one("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s::jsonb, %s::jsonb)::text" % (q(book_of(rel, side)), q(json.dumps(LEDGERS)), q(json.dumps(GROUPS))))
    def lit(v):
        if v is None: return "null"
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, (int, float)): return repr(v)
        if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
        return q(v)
    real = FS.rpc
    def rpc(name, a):
        if name.startswith("tally_"):
            try: return json.loads(db.one("select public.%s(%s)::text" % (name, ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items()))))
            except RuntimeError as e:
                if "does not exist" in str(e): return real(name, a)
                raise RuntimeError(str(e).split("\n")[0][:300])
        return real(name, a)
    FS.rpc = rpc
    for rel in RELS:
        for side in SIDES:
            FS.T["tally_companies"].append({"firm_id": FIRM, "company": co_of(rel, side), "client_id": "c1", "book_id": book_of(rel, side)})
    FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-A", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.3.4"})
    FS.T["tally_ledgers"] = [{"book_id": book_of(rel, side), "name": l[0], "parent": l[1]} for rel in RELS for side in SIDES for l in LEDGERS]
    FS.start()
    wrap = os.path.join(tmp, "serve.ts")
    open(wrap, "w").write("const s = Deno.serve; (Deno as any).serve = (h: any) => s({ port: %d, hostname: \"127.0.0.1\" }, h);\nawait import(%s);\n"
                          % (FN_PORT, json.dumps("file://" + os.path.abspath(os.path.join(SQLDIR, "index.ts")))))
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", wrap], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = []
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    URL = "http://127.0.0.1:%d/" % FN_PORT
    def call(body, key=KA):
        rq = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
        try: r = urllib.request.urlopen(rq, timeout=120); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    for i in range(240):
        try: urllib.request.urlopen(URL, timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    else: raise SystemExit("the function did not start: " + "".join(log)[-1500:])
    tag = lambda t, x: (re.search(r"<%s(?:\s[^>]*)?>([^<]*)</%s>" % (t, t), x) or [None, ""])[1].strip()
    # the tables that hold an entry's rows: those with a book_id and a guid column
    tables = [r["table_name"] for r in db.rows("select c1.table_name from information_schema.columns c1 join information_schema.columns c2 on c1.table_name = c2.table_name and c1.table_schema = c2.table_schema "
                                                  "where c1.table_schema = 'public' and c1.column_name = 'book_id' and c2.column_name = 'guid' and c1.table_name like 'tally_%' and c1.table_name not like 'tally_recorder%' "
                                                  "and c1.table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') order by 1")]
    print("tables compared: " + ", ".join(tables))
    SKIP = {"book_id", "id", "firm_id", "created_at", "updated_at", "applied_at", "received_at", "seen_at", "first_seen", "last_seen", "at", "ingested_at", "src_line", "line_id", "source_id", "recorder_line"}
    def stored(book, guid, with_order):
        out = {}
        for t in tables:
            cols = [r["column_name"] for r in db.rows("select column_name from information_schema.columns where table_schema = 'public' and table_name = %s order by ordinal_position" % q(t))
                    if r["column_name"] not in SKIP and not r["column_name"].endswith("_at") and (with_order or r["column_name"] != "line_no")]
            rows = db.rows("select %s from %s where book_id = %s and guid = %s" % (", ".join('"%s"::text as "%s"' % (c, c) for c in cols), t, q(book), q(guid)))
            out[t] = sorted(json.dumps(r, sort_keys=True) for r in rows)
        return out
    for rel in RELS:
        for tgt in ("sales", "receipt"):
            today = vblock(open(os.path.join(TD, rel, tgt + "-bymaster.xml"), encoding="utf-8-sig").read())
            fast = open(os.path.join(TD, rel, tgt + "-stripped.xml"), encoding="utf-8").read()
            guid, mid, alt = tag("GUID", today), tag("MASTERID", today), int(tag("ALTERID", today) or 0)
            cg = guid.rsplit("-", 1)[0]
            res = {}
            for side, xml in (("today", today), ("fast", fast)):
                call({"kind": "start_point", "company": co_of(rel, side), "guid": cg, "altvchid": 1, "altmstid": 1, "at": "2026-10-01T09:00:00+05:30", "bridge": GA})
                line = {"line_id": "%s-%s-%s" % (rel, tgt, side), "event": "created", "saved_at": "2026-10-07T10:00:00+05:30", "pc": "PC-A", "user": "anshul", "company_guid": cg, "object_guid": guid,
                        "master_id": mid, "alter_id": alt, "vch_type": tag("VOUCHERTYPENAME", today), "vch_no": tag("VOUCHERNUMBER", today), "vch_date": tag("DATE", today), "ledgers": [], "save_ms": 8,
                        "xml": xml, "full": True}
                c, r = call({"kind": "recorder_lines", "company": co_of(rel, side), "version": "2.3.4", "bridge": GA, "lines": [line]})
                res[side] = (c, [(x.get("state"), x.get("why")) for x in (r.get("results") or [])])
            ok(res["today"][0] == 200 and res["fast"][0] == 200 and [s for s, _ in res["today"][1]] == ["applied"] and [s for s, _ in res["fast"][1]] == ["applied"],
               "%s %s: applied from today's answer and from the stripped one (%s)" % (rel, tgt, res))
            a, b = stored(book_of(rel, "today"), guid, False), stored(book_of(rel, "fast"), guid, False)
            diff = [t for t in tables if a[t] != b[t]]
            n = sum(len(a[t]) for t in tables)
            detail = "; ".join("%s: today %s / fast %s" % (t, [x for x in a[t] if x not in b[t]][:2], [x for x in b[t] if x not in a[t]][:2]) for t in diff)
            ok(n > 0 and not diff, "%s %s: the %d rows stored for the entry are equal, column by column (%s)" % (rel, tgt, n, ", ".join("%s %d" % (t, len(a[t])) for t in tables if a[t]) + ("; DIFFER " + detail if diff else "")))
            ao, bo = stored(book_of(rel, "today"), guid, True), stored(book_of(rel, "fast"), guid, True)
            od = [t for t in tables if ao[t] != bo[t]]
            print("  info %s %s: the ledger lines' order (line_no): %s" % (rel, tgt, "the same" if not od else "differs in " + ", ".join(od) + " (the object gives the party and tax lines first, as Tally's Day Book)"))
finally:
    if fn: fn.terminate()
    if fails and fn: print("".join(log[-30:]))
    db.stop() if hasattr(db, "stop") else None
print("%d failed" % len(fails) if fails else "all ok")
sys.exit(1 if fails else 0)
