"""python3 run_e2e_tdsgst.py - round 43: every figure of a test company's books, made on a real TallyPrime 7.1 and read by
the published FinCom Bridge 2.4.1 as in production, reaches FinCom's TDS and GST returns, amendments included. TEST DATA
ONLY: the throwaway company of tests/fixtures/tdsgst-e2e (make.mjs), never a client's books.

What it reads (tests/fixtures/tdsgst-e2e/real71/, kept from the real-Tally run on branch tally-versions, mode tdsgst; its run
id in real71/SOURCE.txt): every request the bridge sent FinCom's cloud (stub-requests.jsonl: the ledger lists, the start
point, the recorder lines with Tally's entries), Tally's Day Book month by month and its ledger masters as the owner exports
them, before the returns are filed (phase 1) and after the amendments (phase 2), and Tally's own list of its entries.

What it runs, as in production:
  A. the bridge's requests, in the order it sent them, through the real cloud function (server/tally-cloud/index.ts under
     Deno; parse.js reads Tally's entries) into a throwaway PostgreSQL (pg_stand) built with staging's migrations in
     staging's order (docs/MIGRATION-ORDER.md): FinCom's cloud copy of every entry is compared with what was entered
     (vouchers.json), line by line, after phase 1 and after phase 2 (an altered entry, a deleted one, the PAN corrected);
  B. the Day Book uploaded (upload_new / upload_done, the cloud's split into days, tally_ingest_day into the same database),
     the day files the cloud keeps read back as the app reads them (TCloud.load: one envelope a month, Books.importDayBook),
     the ledger masters read as "From Tally" reads them (Books.importMasters), and FinCom's own TDS and GST code on them
     (e2e_tdsgst_app.js: the code the TDS and GST pages and their downloads use), with the CA's setup (setup.json);
  C. every figure compared with the answer key written by hand (expected.json; EXPECTED.md shows the sums), to the paisa.
The result table (area, figure, expected, FinCom, PASS / FAIL, note) goes to tests/out/tdsgst-e2e-result.{json,md};
docs/tdsgst-e2e-result.md is the owner's copy. A FAIL listed in known-fails.json (its cause and fix status) is reported but
does not fail the test; any other FAIL does. A listed figure that passes (its fix is in the build tested: the fixes are on
arc-ui, the list is shared with tax-accuracy) is printed as a note.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno) and the app's test build (site-test/: python3 build.py)."""
from html import unescape
import os, re, sys, json, time, gzip, hashlib, subprocess, urllib.request, urllib.error, shutil, threading, tempfile, csv
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand
csv.field_size_limit(1 << 30)
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
FX = os.path.join(HERE, "fixtures", "tdsgst-e2e"); REAL = os.environ.get("TDSGST_REAL") or os.path.join(FX, "real71")
if not os.path.exists(os.path.join(REAL, "stub-requests.jsonl")): print("skipped: no real TallyPrime 7.1 artifacts in " + REAL); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
OUT = os.environ.get("TDSDESK_OUT") or os.path.join(HERE, "out"); os.makedirs(OUT, exist_ok=True)
EXP = json.load(open(os.path.join(FX, "expected.json"))); SETUP = json.load(open(os.path.join(FX, "setup.json")))
TRUTH = json.load(open(os.path.join(FX, "tally", "vouchers.json")))
KNOWN = json.load(open(os.path.join(FX, "known-fails.json"))) if os.path.exists(os.path.join(FX, "known-fails.json")) else {}
def kept(*names):
    """the bytes of a kept file: the first of names there, plain or gzipped (the committed copy keeps one Day Book export a
    phase, daybook-p1.xml.gz: Tally answered the same export for every month, run 38066717288; the cloud's split keeps each
    month's days)"""
    for n in names:
        for f in (n, n + ".gz"):
            fp = os.path.join(REAL, f)
            if os.path.exists(fp):
                b = open(fp, "rb").read()
                return gzip.decompress(b) if f.endswith(".gz") else b
    return None
TV = {ph: json.load(open(os.path.join(REAL, "tally-vouchers-%s.json" % ph), encoding="utf-8-sig")) for ph in ("p1", "p2")}
MONTHS = ["202604", "202605", "202606", "202607"]
# Tally numbers the entries itself (automatic numbering: the number given on import is replaced, runs 38060636032 and
# 38064141905); the numbers in the key are the fixture's, matched to Tally's own through each entry's id (its narration)
NUMS = {}
for v in TRUTH["p1"]:
    tv = next((x for x in TV["p1"] if x["id"] == v["id"]), None)
    if tv and tv.get("vno"): NUMS[v["no"]] = tv["vno"]
def tnum(x):
    if isinstance(x, dict): return {k: tnum(v) for k, v in x.items()}
    if isinstance(x, list): return [tnum(v) for v in x]
    return NUMS.get(x, x) if isinstance(x, str) else x
EXP = tnum(EXP)
FN_PORT, FS.PORT, PG_PORT = 30649, 30648, 30646
CO = TRUTH["company"]["name"]

# ---------------------------------------------------------------- the result table
ROWS = []
MODE = {"name": "daybook", "prefix": ""}   # round 44: the same figures from the Day Book only, the bridge only, and both
def r2(x): return round(float(x) + 0.0, 2) if x not in (None, "") else x
def same(a, b):
    if isinstance(b, (int, float)) and not isinstance(b, bool):
        try: return abs(float(a) - float(b)) < 0.005
        except (TypeError, ValueError): return False
    return a == b
def row(area, figure, expected, fincom, note=""):
    st = "PASS" if same(fincom, expected) else "FAIL"
    figure = MODE["prefix"] + figure
    k = KNOWN.get(figure)
    ROWS.append({"mode": MODE["name"], "area": area, "figure": figure, "expected": expected, "fincom": fincom, "state": st, "note": note or (k or {}).get("note", ""), "known": bool(k and st == "FAIL"),
                 "cause": (k or {}).get("cause", ""), "fix": (k or {}).get("fix", "")})
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]

# ---------------------------------------------------------------- the database, as staging has it
STAGING = ["migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql", "@34", "migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql",
           "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql", "migration-40-states-carried.sql", "migration-41-day-counts.sql",
           "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql", "migration-46-trial-tools.sql",
           "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
           "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql",
           "migration-68-alert-dismissals.sql", "migration-70-alert-dismissals-tighten.sql", "migration-61-privileges.sql",
           "migration-62-tds-rate-worked-out.sql", "migration-63-recorder-repeat.sql", "migration-64-pages-live.sql", "migration-65-selfchecks.sql", "migration-66-recorder-masters.sql",
           "migration-67-recorder-renumbered.sql", "migration-72-gst-type.sql"]
FILES = [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql") if f == "@34" else os.path.join(SQLDIR, f) for f in STAGING]
FILES = [f for f in FILES if os.path.exists(f)]
FIRM, OWNER, BOOK, CID = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555", "11111111-1111-1111-1111-111111111143", "tg"
DEV, KEY = "d1000000-0000-0000-0000-000000000043", "fcd_" + "e" * 48
db = pg_stand.start(PG_PORT)
fn, log = None, []
TMP = tempfile.mkdtemp(prefix="fincom-tdsgst-")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Test firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, %(C)s, %(CO)s, '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'RUNNER', 'h', '2.4.1');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data, tally_name, gstin) values (%(C)s, %(F)s, %(CO)s, '{"choices": {}}', %(CO)s, %(G)s);"""
           % {"F": q(FIRM), "O": q(OWNER), "B": q(BOOK), "C": q(CID), "CO": q(CO), "D": q(DEV), "G": q(SETUP["client"]["gstin"])})
    for path in FILES:
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                           input=open(path).read(), capture_output=True, text=True)
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-400:])); raise SystemExit("cannot go on")
    ok(True, "the database built with staging's %d migrations in staging's order" % len(FILES))
    # ---------------------------------------------------------------- the cloud function: its REST tables in the stand-in, its database functions in PostgreSQL
    def lit(v):
        if v is None: return "null"
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, (int, float)): return repr(v)
        if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
        return q(v)
    real = FS.rpc
    def rpc(name, a):
        # the work queue and the upload's cursor stay in the stand-in (as run_upload_split.py has them); the rest is PostgreSQL's
        if name.startswith("tally_") and name not in ("tally_work_send", "tally_upload_advance", "tally_work_read", "tally_work_done", "tally_job_step", "tally_work_key_ok"):
            try: return json.loads(db.one("select public.%s(%s)::text" % (name, ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items()))) or "null")
            except RuntimeError as e:
                if "does not exist" in str(e) and "function" in str(e): return real(name, a)
                raise RuntimeError(str(e).split("\n")[0][:300])
        return real(name, a)
    FS.rpc = rpc
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": CO, "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-10T00:00:00Z"})
    FS.T["clients"].append({"id": CID, "firm_id": FIRM, "name": CO, "tally_name": CO, "gstin": SETUP["client"]["gstin"], "deleted": False})
    FS.T["tally_devices"].append({"id": DEV, "firm_id": FIRM, "name": "RUNNER", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.4.1"})
    FS.T["tally_books"].append({"book_id": BOOK, "firm_id": FIRM, "client_id": CID, "company": CO, "from_date": "2026-04-01"})
    FS.T.setdefault("tally_ledgers", [])
    FS.USERS["tok-owner"] = {"id": OWNER, "email": "owner@test.invalid"}
    FS.T["members"].append({"user_id": OWNER, "firm_id": FIRM, "role": "owner", "active": True})
    FS.start()
    wrap = os.path.join(TMP, "serve.ts")
    open(wrap, "w").write("const s = Deno.serve; (Deno as any).serve = (h: any) => s({ port: %d, hostname: \"127.0.0.1\" }, h);\nawait import(%s);\n"
                          % (FN_PORT, json.dumps("file://" + os.path.abspath(os.path.join(SQLDIR, "index.ts")))))
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key", TALLY_WORK_VT="3")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", wrap], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    URL = "http://127.0.0.1:%d/" % FN_PORT
    def call(body, key=KEY, tok=None, headers=None):
        h = {"Content-Type": "application/json"}; h.update(headers or {})
        if tok: h["Authorization"] = "Bearer " + tok
        elif key: h["x-fincom-device"] = key
        rq = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=h)
        try: r = urllib.request.urlopen(rq, timeout=180); return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            b = e.read()
            try: return e.code, json.loads(b or b"{}")
            except ValueError: return e.code, {"_raw": b[:300].decode("utf-8", "replace")}
    for i in range(480):
        try: urllib.request.urlopen(URL, timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    else: raise SystemExit("the cloud function did not start: " + "".join(log)[-1500:])

    # ================================================================ A. the bridge's requests, as it sent them
    print("== A. the bridge's requests through the cloud function into the database")
    reqs = [json.loads(l) for l in open(os.path.join(REAL, "stub-requests.jsonl"), encoding="utf-8-sig") if l.strip()]
    kinds = {}
    for x in reqs: kinds[x["kind"]] = kinds.get(x["kind"], 0) + 1
    print("   the bridge sent: " + ", ".join("%s %d" % kv for kv in sorted(kinds.items())))
    p1aid = {v["guid"]: v["aid"] for v in TV["p1"]}
    def phase_of(x):
        """2 for a request carrying a line made after phase 1 (an AlterID above phase 1's, or a delete); else 1"""
        for l in (x["body"].get("lines") or []):
            g = str(l.get("object_guid") or "")
            if l.get("event") == "deleted" or (g in p1aid and int(l.get("alter_id") or 0) > p1aid[g]): return 2
        return 1
    REPLAY = ("ledger_list", "ledgers", "groups", "ledger_changes", "start_point", "recorder_lines")
    seen2 = False; answers = {}
    def replay(ph):
        global seen2
        for i, x in enumerate(reqs):
            k = x["kind"]
            if k not in REPLAY: continue
            p = 2 if (seen2 or (k == "recorder_lines" and phase_of(x) == 2)) else 1
            if k == "recorder_lines" and p == 2: seen2 = True
            if (ph == 1 and p != 1) or (ph == 2 and p != 2) or i in answers: continue
            c, r = call(x["body"]); answers[i] = (c, r)
            if k in ("ledger_list", "ledger_changes"):
                # the stand-in keeps the ledgers the REST way (FS.T); the database's own copy follows them
                pass
    replay(1)
    def st(c, r): return "%s %s" % (c, ",".join("%s:%s" % (k, r.get(k)) for k in ("applied", "held", "duplicate", "failed", "queued") if r.get(k)))
    rl = [(i, answers[i]) for i in sorted(answers) if reqs[i]["kind"] == "recorder_lines"]
    print("   phase 1: %d requests replayed; recorder_lines answers: %s" % (len(answers), "; ".join(st(*a) for _, a in rl)[:600]))
    # held lines (a ledger the cloud did not have yet, a body the cloud refused): said, with why
    held = db.rows("select line_id, event, object_guid, state, held_why from tally_recorder_lines where state not in ('applied', 'duplicate') order by id")
    for h in held[:20]: print("   held/failed: %s %s %s %s" % (h.get("event"), h.get("object_guid"), h.get("state"), (h.get("held_why") or "")[:160]))

    def copy_rows():
        V = {r["guid"]: r for r in db.rows("select guid, day::text as day, vtype, vno, party, gstin, pos, cancelled::text as cancelled, optional::text as optional, deleted_at::text as deleted_at, alter_id::text as alter_id from tally_vouchers where book_id = %s" % q(BOOK))}
        Lr = {}
        for r in db.rows("select guid, ledger, amount::text as amount from tally_lines where book_id = %s" % q(BOOK)):
            Lr.setdefault(r["guid"], {}); Lr[r["guid"]][r["ledger"]] = round(Lr[r["guid"]].get(r["ledger"], 0) + float(r["amount"]), 2)
        TD = {}
        for r in db.rows("select guid, ledger, nature, section, rate::text as rate, assessable::text as assessable, amount::text as amount, party from tally_tds_lines where book_id = %s and gone_at is null" % q(BOOK)):
            TD.setdefault(r["guid"], []).append(r)
        return V, Lr, TD
    # Tally's own TDS details of each entry (the month exports): "party assessable tax" per allocation, by GUID
    TALLY_TDS = {}
    for ph_ in ("p1", "p2"):
        seen_ = set()
        for ym in MONTHS:
            fx = kept("daybook-%s-%s.xml" % (ph_, ym), "daybook-%s.xml" % ph_)
            if fx is None: continue
            for v in re.findall(r"<VOUCHER [\s\S]*?</VOUCHER>", fx.decode("utf-8", "replace")):
                g = (re.search(r"<GUID>([^<]+)</GUID>", v) or [None, ""])[1]
                if not g or g in seen_: continue
                seen_.add(g)
                al = []
                for b_ in re.findall(r"<TAXOBJECTALLOCATIONS\.LIST>([\s\S]*?)</TAXOBJECTALLOCATIONS\.LIST>", v):
                    pl = (re.search(r"<PARTYLEDGER>([^<]+)<", b_) or [None, ""])[1]
                    if not pl: continue
                    am = (re.search(r"<ASSESSABLEAMOUNT>([^<]+)<", b_) or [None, "0"])[1]; tx = (re.search(r"<TAX>([^<]+)<", b_) or [None, "0"])[1]
                    al.append("%s %.2f %.2f" % (pl, abs(float(am or 0)), abs(float(tx or 0))))
                TALLY_TDS.setdefault(ph_, {})[g] = al
    def check_copy(ph):
        V, Lr, TD = copy_rows()
        truth = {v["id"]: v for v in TRUTH["p1"]}
        if ph == "p2":
            for o in TRUTH["p2"]:
                if o.get("lines"): truth[o["id"]] = o
        tally = {v["id"]: v for v in TV[ph]}
        n_ok = 0
        for vid, t in truth.items():
            tv = tally.get(vid)
            if vid == "S13" and ph == "p2":
                g = next((v["guid"] for v in TV["p1"] if v["id"] == "S13"), "")
                cv = V.get(g, {})
                row("Cloud copy (bridge)", "%s %s: deleted in Tally after filing -> marked deleted in FinCom's copy" % (ph, t["no"]), True, bool(cv.get("deleted_at")),
                    "the bridge's add-on line for the delete (Alt+D on Tally's screen)")
                continue
            if not tv:
                row("Cloud copy (bridge)", "%s %s: in Tally" % (ph, t["no"]), True, False, "the harness did not make it"); continue
            cv = V.get(tv["guid"])
            label = "%s %s %s (%s)" % (ph, t["no"], t["type"], vid)
            if not cv:
                row("Cloud copy (bridge)", label + ": in FinCom's copy", True, False); continue
            if vid == "S12":
                row("Cloud copy (bridge)", label + ": cancelled in Tally -> cancelled in FinCom's copy", "true", cv.get("cancelled")); continue
            want = {}
            for l, a in t["lines"]: want[l] = round(want.get(l, 0) + a, 2)
            got = Lr.get(tv["guid"], {})
            diff = {l: (want.get(l), got.get(l)) for l in set(want) | set(got) if not same(got.get(l, 0), want.get(l, 0))}
            row("Cloud copy (bridge)", label + ": every ledger line's amount", "as entered (%d lines)" % len(want), "as entered (%d lines)" % len(got) if not diff else "differs: " + json.dumps(diff)[:300])
            p = TRUTH["parties"]
            party = next((x for x in p.values() if x["name"] == t["party"]), {})
            if party.get("gstin") and t["type"] in ("Sales", "Purchase", "Credit Note", "Debit Note"): row("Cloud copy (bridge)", label + ": party GSTIN", party["gstin"], cv.get("gstin"))
            if t.get("optional"): row("Cloud copy (bridge)", label + ": optional", "true", cv.get("optional"))
            td = [x for x in t["lines"] if re.match(r"^(TDS|TCS) ", x[0])]
            if td and t["type"] == "Journal" and re.match(r"^TDS ", td[0][0]):
                # what Tally itself stored as the entry's TDS details (its own export): FinCom's copy must carry exactly those
                tl = TD.get(tv["guid"], [])
                tally_td = TALLY_TDS.get(ph, {}).get(tv["guid"], [])
                row("Cloud copy (bridge)", label + ": TDS details as Tally stored them (party, assessable, tax)", " | ".join(tally_td) or "none stored by Tally",
                    " | ".join("%s %.2f %.2f" % (x["party"], float(x["assessable"] or 0), float(x["amount"] or 0)) for x in tl) or "none stored by Tally",
                    "" if tally_td else "TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read the TDS ledgers")
            n_ok += 1
        return V
    def copy_snapshot():
        """the cloud copy as the app's REST reads would answer (round 44): the entries, their lines and bills, the bridge's
        lines applied, the ledger list (the REST stand-in's rows over the database's) and the groups"""
        B = q(BOOK)
        tv = db.rows("select book_id::text as book_id, guid, day::text as day, alter_id::text as alter_id, vtype, vno, party, narration, cancelled::text as cancelled, optional::text as optional, deleted_at::text as deleted_at, gstin, pos, ref, ref_date::text as ref_date, cmp_gstin, irn, irn_ack_date::text as irn_ack_date from tally_vouchers where book_id = %s" % B)
        for r in tv:
            r["alter_id"] = int(r["alter_id"] or 0); r["cancelled"] = r["cancelled"] == "true"; r["optional"] = r["optional"] == "true"
        # bridge 2.4.2 (migration 72): each entry's GST type as the REST read gives it (null: none in the cloud for the entry);
        # a cloud without the columns gives none
        try:
            gt = {r["guid"]: r for r in db.rows("select guid, (gst_rcm is not null)::text as rd, gst_reg_type, gst_country, gst_rcm::text as gst_rcm, gst_nature, gst_taxability, gst_supply, gst_ineligible::text as gst_ineligible from tally_vouchers where book_id = %s" % B)}
            for r in tv:
                g = gt.get(r["guid"]) or {}
                for k in ("gst_reg_type", "gst_country", "gst_nature", "gst_taxability", "gst_supply"): r[k] = (g.get(k) or "") if g.get("rd") == "true" else None
                for k in ("gst_rcm", "gst_ineligible"): r[k] = (g.get(k) == "true") if g.get("rd") == "true" else None
        except RuntimeError:
            pass
        tl = db.rows("select book_id::text as book_id, guid, ledger, amount::text as amount, hsn, rate::text as rate from tally_lines where book_id = %s" % B)
        for r in tl: r["amount"] = float(r["amount"]); r["rate"] = float(r["rate"]) if r["rate"] not in (None, "") else None
        tb = db.rows("select book_id::text as book_id, guid, ledger, name, type, amount::text as amount, credit_days::text as credit_days from tally_bills where book_id = %s" % B)
        for r in tb: r["amount"] = float(r["amount"]); r["credit_days"] = int(r["credit_days"]) if r["credit_days"] not in (None, "") else None
        rl = db.rows("select id::text as id, book_id::text as book_id, object_guid, state, applied_at::text as applied_at from tally_recorder_lines where book_id = %s" % B)
        for r in rl: r["id"] = int(r["id"])
        led = {r["name"]: {"name": r["name"], "parent": r.get("parent") or "", "pan": r.get("pan") or "", "gstin": r.get("gstin") or ""} for r in db.rows("select name, parent, coalesce(pan, '') as pan, coalesce(gstin, '') as gstin from tally_ledgers where book_id = %s and deleted_at is null and merged_into is null" % B)}
        for r in FS.T.get("tally_ledgers", []):
            if r.get("book_id") == BOOK and not r.get("deleted_at") and not r.get("merged_into"):
                o = led.setdefault(r["name"], {"name": r["name"], "parent": "", "pan": "", "gstin": ""})
                for k in ("parent", "pan", "gstin"):
                    if r.get(k): o[k] = r[k]
        try: gr = db.rows("select name, parent from tally_groups where book_id = %s" % B)
        except RuntimeError: gr = []
        gr += [{"name": r["name"], "parent": r.get("parent") or ""} for r in FS.T.get("tally_groups", []) if r.get("book_id") == BOOK]
        la = db.one("select coalesce(ledgers_at::text, '') from tally_books where book_id = %s" % B) or ""
        return {"book": BOOK, "tables": {"tally_vouchers": tv, "tally_lines": tl, "tally_bills": tb, "tally_recorder_lines": rl}, "ledgers": list(led.values()), "groups": gr, "ledgersAt": la}
    V1 = check_copy("p1")
    COPY1 = copy_snapshot()
    # the GST classification Tally keeps on an entry, in the entry the bridge sent (its body): what makes an invoice an SEZ
    # supply or an export, a bill reverse charge or its credit blocked, a supply nil-rated (the Day Book export has them)
    bodies = {}
    for x in reqs:
        for l in (x["body"].get("lines") or []) if x["kind"] == "recorder_lines" else []:
            if l.get("xml"): bodies[str(l.get("object_guid") or "")] = l["xml"]
    g1 = {v["id"]: v["guid"] for v in TV["p1"]}
    # bridge 2.4.2 (round 44 part B): the body carries Tally's value AND FinCom's cloud copy stores it (migration 72's columns,
    # read by parse.js from the body); a cloud without 72 has no columns: the row says so
    try: GT = {r["guid"]: r for r in db.rows("select guid, gst_reg_type, gst_country, gst_rcm::text as gst_rcm, gst_nature, gst_taxability, gst_ineligible::text as gst_ineligible from tally_vouchers where book_id = %s" % q(BOOK))}
    except RuntimeError: GT = None
    for vid, tag, val, col, cval, what in (("S03", "GSTOVRDNNATURE", r"Sales to SEZ", "gst_nature", r"^Sales to SEZ", "the SEZ supply (registration type or nature of the transaction)"),
                                          ("S05", "COUNTRYOFRESIDENCE", r"Germany", "gst_country", r"^Germany$", "the export (the buyer's country)"),
                                          ("P03", "ISREVERSECHARGEAPPLICABLE", r"Yes", "gst_rcm", r"^true$", "the reverse charge"),
                                          ("P04", "GSTOVRDNINELIGIBLEITC", r"^\W*Applicable", "gst_ineligible", r"^true$", "the blocked credit"),
                                          ("S10", "GSTOVRDNTAXABILITY", r"Nil Rated", "gst_taxability", r"^Nil Rated$", "the nil-rated supply (taxability)")):
        g = g1.get(vid, ""); xb = bodies.get(g, "")
        inbody = any(re.search(val, unescape(m)) for m in re.findall(r"<%s>([^<]*)<" % tag, xb))
        stored = (GT or {}).get(g, {}).get(col) or ""
        got = (inbody and bool(re.search(cval, stored))) if xb and GT is not None else ("(no body)" if not xb else "(no GST type columns: migration 72 not run)")
        row("Cloud copy (bridge)", "p1 %s: %s in the entry the bridge sends" % (vid, what), True, got,
            "Tally's %s in the bridge's body: %s; FinCom's cloud copy %s: %s" % (tag, inbody, col, stored or "-"))
    # ---------------------------------------------------------------- phase 2 of the bridge's requests
    replay(2)
    rl2 = [(i, answers[i]) for i in sorted(answers) if reqs[i]["kind"] == "recorder_lines" and i not in dict(rl)]
    print("   phase 2: recorder_lines answers: %s" % "; ".join(st(*a) for _, a in rl2)[:600])
    V2 = check_copy("p2")
    COPY2 = copy_snapshot()
    print("   the cloud copy: %d entries after phase 1, %d after phase 2 (%d marked deleted); %d bridge lines applied" % (len(COPY1["tables"]["tally_vouchers"]), len(COPY2["tables"]["tally_vouchers"]),
          len([r for r in COPY2["tables"]["tally_vouchers"] if r["deleted_at"]]), len([r for r in COPY2["tables"]["tally_recorder_lines"] if r["state"] == "applied"])))
    led = {r["name"]: r for r in db.rows("select name, pan, gstin from tally_ledgers where book_id = %s" % q(BOOK))}
    fsled = {r["name"]: r for r in FS.T.get("tally_ledgers", []) if r.get("book_id") == BOOK}
    pan2 = (fsled.get("Sigma Landlord") or led.get("Sigma Landlord") or {}).get("pan")
    row("Cloud copy (bridge)", "p2 Sigma Landlord's PAN corrected in Tally -> FinCom's ledger list", "ABCPS9999F", pan2, "the ledger list the bridge sends at Update now")

    # ================================================================ B. the Day Book upload, the day files, FinCom's TDS and GST code
    print("== B. the Day Book uploaded, read back as the app reads it, FinCom's TDS and GST code on it")
    jrow = lambda job: next((x for x in FS.T["tally_jobs"] if x["id"] == job), {})
    def work_until_done(job, secs=240):
        t = time.time()
        while time.time() - t < secs:
            if jrow(job).get("status") in ("done", "failed") and all(x["archived"] for x in FS.QUEUE if (x["message"] or {}).get("job") == job): return True
            call({"kind": "work"}, key=None, headers={"x-fincom-work": FS.WORK_KEY})
            time.sleep(0.3)
        return False
    def upload(ym, data):
        y, m = int(ym[:4]), int(ym[4:]); import calendar; last = calendar.monthrange(y, m)[1]
        c, r = call({"kind": "upload_new", "client": CID, "name": "DayBook-%s.xml" % ym, "size": len(data), "from": ym + "01", "to": ym + "%02d" % last}, tok="tok-owner")
        job, path = r.get("job"), r.get("path")
        FS.FILES["tally-uploads/" + str(path)] = data
        c2, r2_ = call({"kind": "upload_done", "client": CID, "job": job, "path": path}, tok="tok-owner")
        return c, r, c2, r2_, job
    phases = []
    for ph in ("p1", "p2"):
        months = []
        for ym in MONTHS:
            data = kept("daybook-%s-%s.xml" % (ph, ym), "daybook-%s.xml" % ph)
            c, r, c2, r2_, job = upload(ym, data)
            done = work_until_done(job)
            ok(c == 200 and c2 == 200 and done and jrow(job).get("status") == "done", "%s %s: the Day Book uploaded and read by the cloud (%s, %s of %s days; %d bytes; %s %s %s)" % (ph, ym, jrow(job).get("status"), jrow(job).get("done"), jrow(job).get("total"), len(data), jrow(job).get("message"), r, r2_))
            # the day files the cloud keeps (Storage tally-days/<firm>/<book>/<yyyymm>/<day>.xml.gz), as TCloud.day fetches them
            files = []
            for k in sorted(FS.FILES):
                if k.startswith("tally-days/%s/%s/%s/" % (FIRM, BOOK, ym)) and k.endswith(".xml.gz"):
                    f = os.path.join(TMP, "%s-%s" % (ph, os.path.basename(k)[:-3])); open(f, "wb").write(gzip.decompress(FS.FILES[k])); files.append(f)
            months.append({"ym": ym, "files": files})
        mp = os.path.join(TMP, "masters-%s.xml" % ph); open(mp, "wb").write(kept("masters-%s.xml" % ph))
        phases.append({"name": ph, "months": months, "masters": mp, "gstr1": ["202605"] if ph == "p1" else ["202607"], "threeB": ["202605"] if ph == "p1" else ["202607"],
                       "fileGstr1": ["202605"] if ph == "p1" else []})
    def run_app(name, phs):
        inp = os.path.join(TMP, "app-in-%s.json" % name); outp = os.path.join(TMP, "app-out-%s.json" % name)
        json.dump({"setup": os.path.join(FX, "setup.json"), "phases": phs}, open(inp, "w"))
        r = subprocess.run(["node", os.path.join(HERE, "e2e_tdsgst_app.js"), inp, outp], capture_output=True, text=True, cwd=HERE)
        if r.returncode: raise SystemExit("e2e_tdsgst_app.js (%s) failed: " % name + (r.stderr or r.stdout)[-2000:])
        shutil.copy(outp, os.path.join(OUT, "tdsgst-e2e-fincom%s.json" % ("" if name == "daybook" else "-" + name)))
        return json.load(open(outp))
    # round 44: the same returns three ways - the Day Book only (as round 43), the bridge only (the cloud copy, no Day Book
    # uploaded, no masters file: the cloud's ledger list), and both (the Day Book and the cloud copy: each entry once)
    def with_copy(phs, copies, keep_p2):
        out = []
        for ph, cp in zip(phs, copies):
            x = dict(ph); x["copy"] = dict(cp, full=not (keep_p2 and ph["name"] == "p2"), keepFrom=bool(keep_p2 and ph["name"] == "p2"))
            out.append(x)
        return out
    bridge_phases = with_copy([{"name": ph["name"], "months": [], "masters": None, "gstr1": ph["gstr1"], "threeB": ph["threeB"], "fileGstr1": ph["fileGstr1"]} for ph in phases], [COPY1, COPY2], True)
    both_phases = with_copy(phases, [COPY1, COPY2], False)
    APPS = {"daybook": run_app("daybook", phases), "bridge": run_app("bridge", bridge_phases), "both": run_app("both", both_phases)}
    APPS["bridge"]["masters"] = False
    def compare(APP):
        P1, P2 = APP["phases"]["p1"], APP["phases"]["p2"]
        ok(P1["books"]["vouchers"] > 0 and P2["books"]["vouchers"] > 0, "the books in FinCom: %d entries (phase 1), %d (phase 2), by month %s / %s" % (P1["books"]["vouchers"], P2["books"]["vouchers"], P1["books"]["byMonth"], P2["books"]["byMonth"]))

        # ---------------------------------------------------------------- the ledger setup: FinCom's own proposal against the CA's
        for n, s in (SETUP["ledgers"].items() if APP.get("masters", True) else []):
            p = P1["proposals"].get(n, {})
            want = "%s %s %s %s" % (s["what"], s.get("tax", ""), s.get("side", ""), s.get("section", ""))
            got = "%s %s %s %s" % (p.get("what"), p.get("tax") if s.get("tax") else "", p.get("side") if s.get("side") else "", p.get("section") if s.get("section") else "")
            row("Ledger setup", "FinCom's proposal for the ledger %s" % n, want.split(), got.split(), "from Tally's masters and the day book; the CA confirms it (" + (p.get("why") or "")[:120] + ")")

        # ---------------------------------------------------------------- TDS and TCS
        def tds_rows(area, label, want, rows_, dd, keyed=True):
            dd_by = {}
            for d in dd or []: dd_by.setdefault(d["party"], []).append(d)
            for w in want:
                g = [x for x in rows_ if x["party"] == w["party"]]
                row(area, "%s: %s, a deductee row" % (label, w["party"]), 1, len(g))
                if not g: continue
                g = g[0]; d = (dd_by.get(w["party"]) or [{}])[0]
                for f in ("pan", "section", "paid", "tds", "rate"):
                    if f in w:
                        gv = g.get(f)
                        if f == "pan" and not w["pan"]: gv = d.get("pan") if d else gv; wv = "PANNOTAVBL" if d else ""
                        else: wv = w[f]
                        row(area, "%s: %s, %s" % (label, w["party"], {"paid": "amount paid or credited", "tds": "tax deducted", "rate": "rate %", "section": "section", "pan": "PAN"}[f]), wv, gv)
                if "date" in w: row(area, "%s: %s, date of payment or credit" % (label, w["party"]), w["date"], g.get("date"))
                if "remark" in w: row(area, "%s: %s, remark (A certificate / C higher rate)" % (label, w["party"]), w["remark"], (g.get("remark") or {}).get("remark", ""))
                if w.get("certNo"): row(area, "%s: %s, certificate number" % (label, w["party"]), w["certNo"], (g.get("remark") or {}).get("certNo", ""))
                if "code" in w and d: row(area, "%s: %s, deductee code in the file (01 company, 02 other)" % (label, w["party"]), w["code"], d.get("code"))
                if d:
                    row(area, "%s: %s, the file's amount paid and tax" % (label, w["party"]), "%.2f / %.2f" % (w["paid"], w["tds"]), "%s / %s" % (d.get("paid"), d.get("tds")))
                    if "remark" in w: row(area, "%s: %s, the file's remark" % (label, w["party"]), w["remark"], d.get("remark"))
        T1, T2 = EXP["tds_2026_Q1"], EXP["tds_2026_Q1"]
        f140p1 = (P1["tds"]["files"].get("26Q") or {})
        tds_rows("TDS", "Form 140 Q1 (as filed)", T1["form140_p1"], P1["tds"]["rows"], f140p1.get("dd"))
        row("TDS", "Form 140 Q1 (as filed): rows / amount paid / tax", "%d / %.2f / %.2f" % (T1["form140_p1_total"]["rows"], T1["form140_p1_total"]["paid"], T1["form140_p1_total"]["tds"]),
            "%d / %.2f / %.2f" % (len(P1["tds"]["rows"]), sum(x["paid"] for x in P1["tds"]["rows"]), sum(x["tds"] for x in P1["tds"]["rows"])))
        for n in T1["below_threshold_not_reported"]:
            row("TDS", "Form 140 Q1: %s (below the threshold, no TDS) not reported" % n, 0, len([x for x in P1["tds"]["rows"] if x["party"] == n]))
        row("TDS", "Form 140 Q1: the form's name for 2026-27", "Form 140", P1["tds"]["forms"]["26Q"])
        row("TDS", "Form 140 Q1: salary (192) kept out", 0, len([x for x in P1["tds"]["rows"] if x["section"] == "192"]))
        for s in T1["salary_192"]:
            g = [x for x in P1["tds"]["salary"] if x["party"] == s["party"]]
            row("TDS", "Form 138 (salary, 192): %s's tax deducted" % s["party"], s["tds"], g[0]["tds"] if g else None)
        tds_rows("TDS", "Form 144 Q1 (non-resident)", T1["form144"], P1["tds"]["nr"], (P1["tds"]["files"].get("27Q") or {}).get("dd"))
        row("TDS", "Form 144 Q1: the form's name", "Form 144", P1["tds"]["forms"]["27Q"])
        # TCS
        for w in T1["form143"]:
            g = [x for x in P1["tds"]["tcs"] if x["party"] == w["party"]]
            row("TCS", "Form 143 Q1: %s, a collectee row" % w["party"], 1, len(g))
            if g:
                g = g[0]
                row("TCS", "Form 143 Q1: %s, PAN" % w["party"], w["pan"], g["pan"]); row("TCS", "Form 143 Q1: %s, collection code" % w["party"], w["code"], g.get("code"))
                row("TCS", "Form 143 Q1: %s, amount received" % w["party"], w["received"], g["paid"]); row("TCS", "Form 143 Q1: %s, tax collected" % w["party"], w["tcs"], g["tds"])
                row("TCS", "Form 143 Q1: %s, rate %%" % w["party"], w["rate"], g["rate"]); row("TCS", "Form 143 Q1: %s, date" % w["party"], w["date"], g["date"])
        for w in T1["form143_flagged"]:
            g = [x for x in P1["tds"]["tcs"] if x["party"] == w["party"]]
            row("TCS", "Form 143 Q1: %s (206C(1H), omitted from 1-Apr-2025): no collection code given" % w["party"], "", g[0].get("code") if g else "(no row)")
            row("TCS", "Form 143 Q1: %s: said before filing" % w["party"], True, any(c["party"] == w["party"] for c in P1["tds"]["tcsChecks"]))
        row("TCS", "Form 143 Q1: the form's name", "Form 143", P1["tds"]["forms"]["27EQ"])
        # the correction (phase 2)
        ch = T2["form140_p2_changes"]
        want2 = [dict(w, **{k: v for k, v in ch.get(w["party"], {}).items()}) for w in T1["form140_p1"]]
        tds_rows("Amendments", "Form 140 Q1 correction (after filing)", [w for w in want2 if w["party"] in ch], P2["tds"]["rows"], (P2["tds"]["files"].get("26Q") or {}).get("dd"))
        row("Amendments", "Form 140 Q1 correction: rows / amount paid / tax", "%d / %.2f / %.2f" % (T2["form140_p2_total"]["rows"], T2["form140_p2_total"]["paid"], T2["form140_p2_total"]["tds"]),
            "%d / %.2f / %.2f" % (len(P2["tds"]["rows"]), sum(x["paid"] for x in P2["tds"]["rows"]), sum(x["tds"] for x in P2["tds"]["rows"])))
        row("Amendments", "Form 140 Q1 correction: a correction statement for the filed quarter", "made", "made" if P2["tds"].get("correction") else "not made (FinCom builds a fresh regular statement only)")

        # ---------------------------------------------------------------- GSTR-1
        def items(x): return sorted([{k: r2((i.get("itm_det") or i).get(k, 0)) for k in ("rt", "txval", "iamt", "camt", "samt")} for i in (x.get("itms") or [])], key=lambda z: z["rt"])
        def norm_items(lst): return sorted([{k: r2(i.get(k, 0)) for k in ("rt", "txval", "iamt", "camt", "samt")} for i in lst], key=lambda z: z["rt"])
        def flat(j, sec, inner, key):
            out = []
            for g in j.get(sec) or []:
                for x in g.get(inner) or []: out.append(dict(x, **{key: g.get(key)}) if key else x)
            return out
        def gstr1_docs(area, label, want, got, keys, idk):
            for w in want:
                g = [x for x in got if str(x.get(idk)) == str(w[idk]) and all(str(x.get(k)) == str(w[k]) for k in ("ctin",) if "ctin" in w)]
                row(area, "%s: %s %s in the table" % (label, w[idk], w.get("ctin", w.get("pos", ""))), 1, len(g))
                if not g:
                    other = [x for x in got if str(x.get(idk)) == str(w[idk])]
                    continue
                g = g[0]
                for k in keys:
                    if k in w: row(area, "%s: %s %s" % (label, w[idk], k), w[k], g.get(k))
                row(area, "%s: %s rate, taxable value and tax" % (label, w[idk]), json.dumps(norm_items(w["itms"])), json.dumps(items(g)))
            extra = [x.get(idk) for x in got if not any(str(x.get(idk)) == str(w[idk]) for w in want)]
            row(area, "%s: nothing else in the table" % label, [], extra)
        E1, A1 = EXP["gstr1_202605"], P1["gstr1"]["202605"]
        b2b = flat(A1, "b2b", "inv", "ctin")
        gstr1_docs("GSTR-1", "May 2026 table 4A/6B (b2b)", E1["b2b"], b2b, ("idt", "val", "pos", "rchrg", "inv_typ"), "inum")
        b2cl = flat(A1, "b2cl", "inv", "pos")
        gstr1_docs("GSTR-1", "May 2026 table 5 (b2cl)", E1["b2cl"], b2cl, ("idt", "val", "pos"), "inum")
        exp = flat(A1, "exp", "inv", "exp_typ")
        gstr1_docs("GSTR-1", "May 2026 table 6A (exp)", E1["exp"], exp, ("exp_typ", "idt", "val"), "inum")
        cs = {"%s|%s|%s" % (x["sply_ty"], x["pos"], r2(x["rt"])): x for x in A1.get("b2cs") or []}
        for w in E1["b2cs"]:
            k = "%s|%s|%s" % (w["sply_ty"], w["pos"], r2(w["rt"])); g = cs.get(k, {})
            row("GSTR-1", "May 2026 table 7 (b2cs) %s place %s %s%%: taxable / IGST / CGST / SGST" % (w["sply_ty"], w["pos"], w["rt"]), "%.2f / %.2f / %.2f / %.2f" % (w["txval"], w["iamt"], w["camt"], w["samt"]),
                "%.2f / %.2f / %.2f / %.2f" % (r2(g.get("txval", 0)), r2(g.get("iamt", 0)), r2(g.get("camt", 0)), r2(g.get("samt", 0))) if g else "(no row)")
        row("GSTR-1", "May 2026 table 7 (b2cs): nothing else", [], sorted(k for k in cs if k not in ["%s|%s|%s" % (w["sply_ty"], w["pos"], r2(w["rt"])) for w in E1["b2cs"]]))
        nil = {x.get("sply_ty"): x for x in ((A1.get("nil") or {}).get("inv") or [])}
        for t_, w in E1["nil"].items():
            g = nil.get(t_, {})
            row("GSTR-1", "May 2026 table 8 (nil) %s: nil / exempt / non-GST" % t_, "%.2f / %.2f / %.2f" % (w["nil_amt"], w["expt_amt"], w["ngsup_amt"]), "%.2f / %.2f / %.2f" % (r2(g.get("nil_amt", 0)), r2(g.get("expt_amt", 0)), r2(g.get("ngsup_amt", 0))))
        cdnr = flat(A1, "cdnr", "nt", "ctin")
        gstr1_docs("GSTR-1", "May 2026 table 9B registered (cdnr)", E1["cdnr"], cdnr, ("ntty", "nt_dt", "val", "pos"), "nt_num")
        cdnur = A1.get("cdnur") or []
        gstr1_docs("GSTR-1", "May 2026 table 9B unregistered (cdnur)", E1["cdnur"], cdnur, ("typ", "ntty", "nt_dt", "val", "pos"), "nt_num")
        at = {x["pos"]: x for x in A1.get("at") or []}
        for w in E1["at"]:
            g = at.get(w["pos"], {})
            row("GSTR-1", "May 2026 table 11A (advances) place %s: rate, advance and tax" % w["pos"], json.dumps([{k: r2(i.get(k, 0)) for k in ("rt", "ad_amt", "iamt")} for i in w["itms"]]),
                json.dumps([{k: r2(i.get(k, 0)) for k in ("rt", "ad_amt", "iamt")} for i in (g.get("itms") or [])]) if g else "(no row)")
        docs = {}
        for d in ((A1.get("doc_issue") or {}).get("doc_det") or []):
            for x in d.get("docs") or []: docs.setdefault(d["doc_num"], []).append(x)
        for w in E1["doc_issue"]:
            g = (docs.get(w["doc_num"]) or [{}])[0]
            row("GSTR-1", "May 2026 table 13 documents, nature %d: from / to / total / cancelled" % w["doc_num"], "%s / %s / %d / %d" % (w["from"], w["to"], w["totnum"], w["cancel"]),
                "%s / %s / %s / %s" % (g.get("from"), g.get("to"), g.get("totnum"), g.get("cancel")) if g else "(none)")
        row("GSTR-1", "May 2026: the optional entry OPT/001 in no table", [], [x for x in json.dumps(A1).split('"') if x == "OPT/001"])
        row("GSTR-1", "May 2026: the cancelled FC/26-27/012 in no table but table 13", [], [x for x in json.dumps({k: v for k, v in A1.items() if k != "doc_issue"}).split('"') if x == "FC/26-27/012"])

        # ---------------------------------------------------------------- GSTR-3B
        def threeb(area, label, E, J):
            sd, ie = J.get("sup_details", {}), J.get("itc_elg", {})
            av = {x["ty"]: x for x in ie.get("itc_avl", [])}; rv = {x["ty"]: x for x in ie.get("itc_rev", [])}
            m = {"3.1a": sd.get("osup_det"), "3.1b": sd.get("osup_zero"), "3.1c": sd.get("osup_nil_exmp"), "3.1d": sd.get("isup_rev"), "3.1e": sd.get("osup_nongst"),
                 "4A1": av.get("IMPG"), "4A2": av.get("IMPS"), "4A3": av.get("ISRC"), "4A5": av.get("OTH"), "4B1": rv.get("RUL"), "4B2": rv.get("OTH"), "4C": ie.get("itc_net")}
            names = {"3.1a": "3.1(a) outward taxable", "3.1b": "3.1(b) zero-rated", "3.1c": "3.1(c) nil and exempt", "3.1d": "3.1(d) inward reverse charge", "3.1e": "3.1(e) non-GST",
                     "4A1": "4(A)(1) import of goods", "4A2": "4(A)(2) import of services", "4A3": "4(A)(3) reverse charge", "4A5": "4(A)(5) all other ITC", "4B1": "4(B)(1) reversed, rules 38/42/43 and 17(5)",
                     "4B2": "4(B)(2) reversed, others", "4C": "4(C) net ITC"}
            for k, w in E.items():
                if k.startswith("_"): continue
                if k == "5":
                    isd = {x["ty"]: x for x in (J.get("inward_sup") or {}).get("isup_details", [])}
                    row(area, label + " table 5 exempt, nil and composition inward: inter / intra", "%.2f / %.2f" % (w["inter_gst"], w["intra_gst"]), "%.2f / %.2f" % (r2(isd.get("GST", {}).get("inter", 0)), r2(isd.get("GST", {}).get("intra", 0))))
                    row(area, label + " table 5 non-GST inward: inter / intra", "%.2f / %.2f" % (w["inter_nongst"], w["intra_nongst"]), "%.2f / %.2f" % (r2(isd.get("NONGST", {}).get("inter", 0)), r2(isd.get("NONGST", {}).get("intra", 0))))
                    continue
                g = m.get(k) or {}
                for f, v in w.items():
                    row(area, "%s %s: %s" % (label, names[k], {"txval": "taxable value", "iamt": "IGST", "camt": "CGST", "samt": "SGST", "csamt": "cess"}[f]), v, r2(g.get(f, 0)))
        threeb("GSTR-3B", "May 2026", EXP["gstr3b_202605"], P1["gstr3b"]["202605"])

        # ---------------------------------------------------------------- amendments (July 2026's GSTR-1 and 3B)
        E7, A7 = EXP["gstr1_202607"], P2["gstr1"]["202607"]
        gstr1_docs("Amendments", "Jul 2026 table 4A (b2b)", E7["b2b"], flat(A7, "b2b", "inv", "ctin"), ("idt", "val", "pos", "inv_typ"), "inum")
        gstr1_docs("Amendments", "Jul 2026 table 9A (b2ba)", E7["b2ba"], flat(A7, "b2ba", "inv", "ctin"), ("oidt", "idt", "val", "pos", "inv_typ"), "oinum")
        gstr1_docs("Amendments", "Jul 2026 table 9C (cdnra)", E7["cdnra"], flat(A7, "cdnra", "nt", "ctin"), ("ont_dt", "ntty", "nt_num", "nt_dt", "val", "pos"), "ont_num")
        csa = A7.get("b2csa") or []
        for w in E7["b2csa"]:
            g = [x for x in csa if x.get("omon") == w["omon"] and x.get("pos") == w["pos"] and x.get("sply_ty") == w["sply_ty"]]
            row("Amendments", "Jul 2026 table 10 (b2csa) for %s place %s %s: rate, revised taxable and tax" % (w["omon"], w["pos"], w["sply_ty"]), json.dumps(norm_items(w["itms"])), json.dumps(items(g[0])) if g else "(no row)")
        row("Amendments", "Jul 2026 table 10 (b2csa): nothing else", 0, len(csa) - len(E7["b2csa"]))
        threeb("Amendments", "Jul 2026 GSTR-3B", EXP["gstr3b_202607"], P2["gstr3b"]["202607"])


    MODE.update(name="daybook", prefix=""); compare(APPS["daybook"])
    # ---------------------------------------------------------------- round 44: the bridge only
    print("== C. the bridge only: the cloud copy's entries, no Day Book uploaded")
    BP1, BP2 = APPS["bridge"]["phases"]["p1"], APPS["bridge"]["phases"]["p2"]
    # the entries the bridge sent in phase 1 (its recorder lines); the two the test harness made in Tally before the bridge
    # started recording (its spike and renumbering journals) never came through the bridge: a Day Book brings those
    sent1 = set()
    for x in reqs:
        if x["kind"] == "recorder_lines" and phase_of(x) == 1:
            for l in x["body"].get("lines") or []:
                if l.get("object_guid") and l.get("event") in ("created", "altered", "imported", "cancelled"): sent1.add(str(l["object_guid"]))
    before = [v["id"] for v in TV["p1"] if v.get("guid") and v["guid"] not in sent1]
    live1 = len([v for v in TV["p1"] if v.get("guid") in sent1])
    print("   phase 1: %s; phase 2: %s" % (json.dumps(BP1.get("copyRead")), json.dumps(BP2.get("copyRead"))))
    MODE.update(name="bridge", prefix="")
    row("Cloud copy (bridge)", "the entries the bridge sent reach the books the TDS and GST pages read, before any Day Book upload", "%d entries, from the bridge" % BP1["books"]["vouchers"] if BP1["books"]["vouchers"] else "yes",
        "%d entries, from the bridge" % BP1["sources"]["bridge"] if BP1["sources"]["bridge"] == BP1["books"]["vouchers"] and BP1["books"]["vouchers"] else "no (%s)" % json.dumps(BP1["sources"]),
        "round 44: TCloud.load brings in the cloud copy's entries (tally_vouchers / tally_lines / tally_bills) with the Day Book's (BookSrc)")
    row("Cloud copy (bridge)", "the bridge only, phase 1: every entry the bridge sent is in the books (cancelled and optional kept, marked)", live1, BP1["books"]["vouchers"],
        "not sent by the bridge, made in Tally before it started recording: %s (a Day Book brings them)" % ", ".join(before))
    row("Cloud copy (bridge)", "the bridge only, phase 2: only the entries the bridge's lines brought since are read again", True, bool(BP2.get("copyRead") and not BP2["copyRead"]["full"] and BP2["copyRead"]["heads"] > 0 and BP2["copyRead"]["heads"] < live1),
        json.dumps(BP2.get("copyRead")))
    row("Cloud copy (bridge)", "the bridge only: the cloud copy is read from its own tables, no new database function", ["tally_bills", "tally_lines", "tally_recorder_lines", "tally_vouchers"],
        sorted(set((BP1.get("copyRead") or {}).get("asked", []) + (BP2.get("copyRead") or {}).get("asked", []))))
    MODE.update(name="bridge", prefix="[bridge only] "); compare(APPS["bridge"])
    # ---------------------------------------------------------------- round 44: both
    print("== D. both: the Day Book uploaded and the cloud copy, each entry once")
    DP1, DP2 = APPS["both"]["phases"]["p1"], APPS["both"]["phases"]["p2"]
    A1_, A2_ = APPS["daybook"]["phases"]["p1"], APPS["daybook"]["phases"]["p2"]
    MODE.update(name="both", prefix="")
    # the Day Book was uploaded for April to July; an entry the bridge sent for another month is in the books from it alone
    inm = lambda e: str(e["date"])[:6] in MONTHS
    ids = lambda P, f: sorted(json.dumps([e["no"], e["type"], e["date"]]) for e in P["books"]["entries"] if f(e))
    for ph_, A_, D_ in (("phase 1", A1_, DP1), ("phase 2", A2_, DP2)):
        row("Both sources", "%s: April to July (the Day Book's months), each entry once, as the Day Book alone" % ph_, ids(A_, inm), ids(D_, inm), "sources %s" % json.dumps(D_["sources"]))
        row("Both sources", "%s: the entries of other months are the bridge's alone" % ph_, ["Bridge"] * len([e for e in D_["books"]["entries"] if not inm(e)]),
            [e["src"] for e in D_["books"]["entries"] if not inm(e)], ", ".join("%s %s %s" % (e["type"], e["no"], e["date"]) for e in D_["books"]["entries"] if not inm(e)))
        row("Both sources", "%s: no entry twice" % ph_, 0, len(D_["books"]["entries"]) - len(set(json.dumps([e["no"], e["type"], e["date"], e["party"]]) for e in D_["books"]["entries"])))
    for k in ("rows", "nr", "tcs", "salary"):
        tot = lambda P: "%d / %.2f / %.2f" % (len(P["tds"][k]), sum(x["paid"] for x in P["tds"][k]), sum(x["tds"] for x in P["tds"][k]))
        row("Both sources", "phase 1 TDS/TCS %s: rows / amount / tax as the Day Book alone" % k, tot(A1_), tot(DP1)); row("Both sources", "phase 2 TDS/TCS %s: rows / amount / tax as the Day Book alone" % k, tot(A2_), tot(DP2))
    for ym in ("202605",):
        row("Both sources", "May 2026 GSTR-1 JSON as the Day Book alone (to the paisa)", json.dumps(A1_["gstr1"][ym], sort_keys=True), json.dumps(DP1["gstr1"][ym], sort_keys=True))
        row("Both sources", "May 2026 GSTR-3B JSON as the Day Book alone", json.dumps(A1_["gstr3b"][ym], sort_keys=True), json.dumps(DP1["gstr3b"][ym], sort_keys=True))
    row("Both sources", "Jul 2026 GSTR-1 with the amendments as the Day Book alone", json.dumps(A2_["gstr1"]["202607"], sort_keys=True), json.dumps(DP2["gstr1"]["202607"], sort_keys=True))
    row("Both sources", "Jul 2026 GSTR-3B as the Day Book alone", json.dumps(A2_["gstr3b"]["202607"], sort_keys=True), json.dumps(DP2["gstr3b"]["202607"], sort_keys=True))
    MODE.update(name="both", prefix="[both] "); compare(APPS["both"])
    MODE.update(name="daybook", prefix="")

    # ================================================================ the table
    for r in ROWS:
        if r["state"] == "FAIL" and not r["known"]: fails.append(r["figure"])
    now_pass = [f for f in KNOWN if any(r["figure"] == f and r["state"] == "PASS" for r in ROWS)]
    for f in now_pass: print("note: listed in known-fails.json, PASS in this build (fixed): " + f)
    areas = ["TDS", "TCS", "GSTR-1", "GSTR-3B", "Amendments", "Cloud copy (bridge)", "Ledger setup", "Both sources"]
    def summ_of(mode):
        rs = [r for r in ROWS if r["mode"] == mode]
        return {a: {"PASS": sum(1 for r in rs if r["area"] == a and r["state"] == "PASS"), "FAIL": sum(1 for r in rs if r["area"] == a and r["state"] == "FAIL")} for a in areas if any(r["area"] == a for r in rs)}
    by_mode = {m: summ_of(m) for m in ("daybook", "bridge", "both")}
    summ = by_mode["daybook"]
    for r in ROWS: print("%-4s %-8s %-20s %s | expected %s | FinCom %s%s" % (r["state"], r["mode"], r["area"], r["figure"], json.dumps(r["expected"])[:120], json.dumps(r["fincom"])[:160], (" | known: " + r["cause"]) if r["known"] else ""))
    for m, sm in by_mode.items():
        print("summary %s: " % {"daybook": "(Day Book only)", "bridge": "(bridge only)", "both": "(both)"}[m] + "; ".join("%s %d PASS %d FAIL" % (a, x["PASS"], x["FAIL"]) for a, x in sm.items())
              + " | total %d PASS %d FAIL" % (sum(x["PASS"] for x in sm.values()), sum(x["FAIL"] for x in sm.values())))
    json.dump({"source": open(os.path.join(REAL, "SOURCE.txt")).read().strip() if os.path.exists(os.path.join(REAL, "SOURCE.txt")) else "", "summary": summ, "summaryByMode": by_mode, "rows": ROWS},
              open(os.path.join(OUT, "tdsgst-e2e-result.json"), "w"), indent=1)
    md = ["| Mode | Area | Figure | Expected | FinCom | Result | Note |", "|---|---|---|---|---|---|---|"]
    cell = lambda v: (json.dumps(v) if not isinstance(v, str) else v).replace("|", "/")[:200]
    for r in ROWS: md.append("| %s | %s | %s | %s | %s | %s | %s |" % ({"daybook": "Day Book", "bridge": "Bridge only", "both": "Both"}[r["mode"]], r["area"], cell(r["figure"]), cell(r["expected"]), cell(r["fincom"]), r["state"], cell((r["cause"] + "; " + r["fix"]).strip("; ") if r["state"] == "FAIL" else r["note"])))
    open(os.path.join(OUT, "tdsgst-e2e-result.md"), "w").write("\n".join(md) + "\n")
finally:
    if fn:
        fn.terminate()
        try: fn.wait(10)
        except Exception: fn.kill()
    db.stop()
    shutil.rmtree(TMP, ignore_errors=True)
print("all passed (known FAILs reported above)" if not fails else str(len(fails)) + " FAILED: " + "; ".join(fails[:20]))
sys.exit(1 if fails else 0)
