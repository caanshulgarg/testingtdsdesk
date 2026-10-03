"""python3 run_migration39.py - migration-39-rename-map-empty-day (03-Oct-2026, round 10: the owner's three gaps). Staging's
order on a throwaway PostgreSQL (pg_stand): 32 -> 33 -> 35 -> 34 (as first run on staging) -> 36b -> 37 -> 36 -> 38, the
MADE-UP BOOKS (tests/fixtures/books) through the real tally_ingest_ledgers_g / tally_ingest_day path, then 39 twice.
Checks: (1) a rename of a GST ledger that has a saved map item (client_book_items key 'map', item '.' || name, read by
tally_led_kinds) carries the item: tally_gst_summary's tax is the same before and after; the old item kept, marked
carriedTo; 'flow:<name>' and choice values in clients.data follow; a clash (both names mapped) leaves the new name's item
and notes it; needs_confirm true and before_clean.renamed[].confirm true, a staff member cannot confirm, the owner's
tally_ledger_rename_confirm clears it with who / when; (2) tally_ingest_day with p_empty: an empty file with the flag
marks the day's entries deleted, without the flag nothing (short read), a re-send with entries un-marks; the 7-argument
call still answers; (3) tally_post_ids_sync keeps an id live when its result is confirmed / ok (no stamp), frees a
refused one; a new posting for the confirmed id is refused. Needs Deno for the day book."""
import os, re, sys, json, html, subprocess, shutil, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M = {n: os.path.join(SQLDIR, f) for n, f in [(32, "migration-32-sync-safety.sql"), (33, "migration-33-ledger-lists.sql"), (35, "migration-35-bridge-control.sql"),
                                              (36, "migration-36-ledger-rename.sql"), ("36b", "migration-36b-post-acceptance.sql"), (37, "migration-37-follow-ups.sql")]}
M[34] = os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")
M[38] = os.path.join(SQLDIR, "migration-38-post-followups.sql"); M[39] = os.path.join(SQLDIR, "migration-39-rename-map-empty-day.sql")      # staging runs the FIRST migration 34 (commit 2105b2d), not the reviewed one
BOOKS = os.path.join(HERE, "fixtures", "books")
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
def sql_function(path, name):
    """the text of one function of a migration file (as deployed)"""
    s = open(path).read(); i = s.index("create or replace function public." + name + "("); j = s.index("end $function$;", i) + len("end $function$;")
    return s[i:j]
SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
SCHEMA37 = part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X")      # what 36b / 37 need beyond these (tally_bills as staging, tally_d8, tally_led_kinds, tally_mis_head, grants)
# as on staging beside run_migration33's tables: tally_bills (migration-7), tally_d8 (migration-11), migration-31's raw_* columns,
# tally_ingest_day as deployed (migration-23's body)
EXTRA = """
create table if not exists tally_bills (book_id uuid not null references tally_books (book_id) on delete cascade, firm_id uuid not null, guid text not null, day date not null,
  ledger text not null, name text not null default '', type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date);
create index if not exists tally_bills_book_party on tally_bills (book_id, ledger, name);
""" + sql_function(os.path.join(SQLDIR, "migration-11-ref-cmp.sql"), "tally_d8") + """
alter table tally_ledgers add column if not exists raw_name text;      -- staging's tally_ledgers has NO before_clean (read 03-Oct): migration 36 adds it
alter table tally_vouchers add column if not exists raw_party text; alter table tally_lines add column if not exists raw_ledger text;
alter table tally_bills add column if not exists raw_ledger text;
alter table tally_ledger_day add column if not exists raw_ledger text; alter table tally_ledger_day add column if not exists merged_into text;
alter table tally_ledger_day add column if not exists before_clean jsonb;
""" + sql_function(os.path.join(SQLDIR, "migration-23-clean-names.sql"), "tally_ingest_day")

F, U = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
B, BIG = "11111111-1111-1111-1111-111111111111", "33333333-3333-3333-3333-333333333333"
DEV = "d1000000-0000-0000-0000-000000000001"
LIST = {"source": "bridge ledgers", "device": DEV, "bridge": "go-abc123", "computer": "NWS144", "user": "accounts"}

def read_master():
    """[name, parent, opening] and [group, parent] as the bridge's ledger list carries them (a Primary parent is none)"""
    t = open(os.path.join(BOOKS, "Master.xml"), "rb").read().decode("utf-16")
    prim = lambda p: "" if re.match(r"^\W*Primary$", p) else p
    tag = lambda s, n: html.unescape((re.search("<%s>([^<]*)</%s>" % (n, n), s) or [None, ""])[1])
    leds, grps, guids = [], [], {}
    for m in re.finditer(r'<LEDGER NAME="([^"]*)"[^>]*>(.*?)</LEDGER>', t, re.S):
        nm = html.unescape(m.group(1)); leds.append([nm, prim(tag(m.group(2), "PARENT")), tag(m.group(2), "OPENINGBALANCE") or "0"]); guids[nm] = tag(m.group(2), "GUID")
    for m in re.finditer(r'<GROUP NAME="([^"]*)"[^>]*>(.*?)</GROUP>', t, re.S):
        grps.append([html.unescape(m.group(1)), prim(tag(m.group(2), "PARENT"))])
    return leds, grps, guids
def read_days():
    """the day book cut into days and read by the cloud's parser (parse.js under Deno): {yyyymmdd: {vouchers, lines, n, alterMax}}"""
    d = tempfile.mkdtemp(prefix="m36-")
    script = os.path.join(d, "days.mjs")
    open(script, "w").write("""
import { parseDay } from %s;
const raw = Deno.readFileSync(Deno.args[0]);
const text = raw[0] === 0xFF && raw[1] === 0xFE ? new TextDecoder("utf-16le").decode(raw) : new TextDecoder().decode(raw);
const byDay = {}; let cut, buf = text;
while ((cut = buf.indexOf("</VOUCHER>")) >= 0) {
  const piece = buf.slice(0, cut + 10); buf = buf.slice(cut + 10);
  const st = piece.lastIndexOf("<VOUCHER "); if (st < 0) continue;
  const v = piece.slice(st), dt = (v.match(/<DATE>(\\d{8})<\\/DATE>/) || [])[1]; if (!dt) continue;
  (byDay[dt] = byDay[dt] || []).push("<TALLYMESSAGE>" + v + "</TALLYMESSAGE>");
}
const out = {};
for (const dt of Object.keys(byDay)) { const r = parseDay(byDay[dt].join("")); out[dt] = { vouchers: r.vouchers, lines: r.lines, n: r.n, alterMax: r.alterMax }; }
console.log(JSON.stringify(out));
""" % json.dumps("file://" + os.path.abspath(os.path.join(SQLDIR, "parse.js"))))
    r = subprocess.run([DENO, "run", "--allow-read", script, os.path.join(BOOKS, "DayBook.xml")], capture_output=True, text=True)
    if r.returncode: raise SystemExit("parse.js under Deno failed: " + r.stderr[-800:])
    return json.loads(r.stdout)

db = pg_stand.start(55448)
def psql_text(text):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=text, capture_output=True, text=True)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return psql_text(open(path).read())
j = lambda s, uid=None: json.loads(db.one(s, uid))
def call(s, quiet=False):
    try: return True, j("select " + s + "::text")
    except RuntimeError as e:
        if not quiet: print("  (call failed: %s)" % str(e).strip()[-300:])
        return False, {"error": str(e)}
one = lambda s: db.one(s)
num = lambda s: float(one(s) or 0)
TABLES = ["tally_vouchers", "tally_lines", "tally_bills", "tally_ledgers", "tally_ledger_day", "tally_days", "tally_books", "tally_groups", "tally_ledger_marks", "tally_ledger_rounds"]
counts = lambda: {t: int(one("select count(*) from %s" % t)) for t in TABLES}
tb = lambda book=B: round(num("select coalesce(sum(closing), 0) from tally_balances where book_id = %s" % q(book)), 2)
led = lambda name, book=B: (db.rows("select name, open, open_sent, tally_guid, deleted_at, merged_into, renamed_at, coalesce(before_clean::text, '{}') as hist from tally_ledgers where book_id = %s and name = %s" % (q(book), q(name))) or [None])[0]
lines_n = lambda name: int(one("select count(*) from tally_lines where book_id = %s and ledger = %s" % (q(B), q(name))))
lines_sum = lambda name: round(num("select coalesce(sum(amount), 0) from tally_lines where book_id = %s and ledger = %s" % (q(B), q(name))), 2)
day_sum = lambda name: round(num("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and ledger = %s" % (q(B), q(name))), 2)
day_rows = lambda name, extra="": db.rows("select day, amount, dr, cr, n, merged_into from tally_ledger_day where book_id = %s and ledger = %s %s order by day" % (q(B), q(name), extra))
bal = lambda name: (db.rows("select open, movement, closing from tally_balances where book_id = %s and ledger = %s" % (q(B), q(name))) or [None])[0]
ren = lambda guid, frm, to, book=B, quiet=False: call("tally_ledger_rename(%s, %s, %s, %s)" % (q(book), "null" if guid is None else q(guid), q(frm), q(to)), quiet)

OWNER, STAFF = U, "44444444-4444-4444-4444-444444444444"
as_user = lambda uid, stmt: (lambda r: r)(None)
def as_user(uid, stmt):
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
item = lambda key, name: (db.rows("select data::text as d, deleted from client_book_items where firm_id = %s and client_id = 'c1' and key = %s and item = %s" % (q(F), q(key), q("." + name))) or [None])[0]
choices = lambda: json.loads(db.one("select coalesce(data->'choices', '{}')::text from clients where firm_id = %s and id = 'c1'" % q(F)))
led2 = lambda name: (db.rows("select name, needs_confirm, coalesce(before_clean::text, '{}') as hist from tally_ledgers where book_id = %s and name = %s" % (q(B), q(name))) or [None])[0]
try:
    db.sql(SCHEMA33); db.sql(EXTRA)
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing; insert into members values (%s, %s, 'Me', 'owner', true), (%s, %s, 'Staff', 'staff', true);" % (q(F), q(U), q(F), q(STAFF), q(F)))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'Larkspur Fixture Events Private Limited', '2025-04-01', '2025-03-31');" % (q(B), q(F)))
    db.sql("create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));")
    for n in (32, 33):
        r = psql_file(M[n]); ok(r.returncode == 0, "migration-%d runs" % n)
    db.sql(SCHEMA35); db.sql(SCHEMA37)
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version) values (%s, %s, 'NWS144', 'h1', '2.1.5');" % (q(DEV), q(F)))
    for n in (35, 34, "36b", 37, 36, 38):
        r = psql_file(M[n]); ok(r.returncode == 0, "migration-%s runs %s" % (n, (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    leds, grps, guids = read_master()
    j("select tally_ingest_ledgers_g(%s, '2025-04-01', '2025-03-31', %s, %s, %s, true, %d)" % (q(B), js(leds), js(grps), js(LIST), len(leds)))
    for nm, g in guids.items(): db.sql("update tally_ledgers set tally_guid = %s where book_id = %s and name = tally_nm(%s)" % (q(g), q(B), q(nm)))
    days = read_days()
    for d in sorted(days):
        x = days[d]; j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)" % (q(B), q("%s-%s-%s" % (d[:4], d[4:6], d[6:])), js(x["vouchers"]), js(x["lines"]), x["n"], x["alterMax"]))
    ok(tb() == 0 and int(one("select count(*) from tally_vouchers where book_id = %s" % q(B))) > 50, "the made-up books loaded; the trial balance ties")
    # the saved choices: GST map items for the output tax ledgers (as the mapping tab saves them), a flow choice and a choice value
    GST = [l for l in db.rows("select name from tally_ledgers where book_id = %s and name ~* 'CGST OUTPUT' and deleted_at is null order by name" % q(B))]
    C1 = GST[0]["name"]; C2 = GST[1]["name"] if len(GST) > 1 else None
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values (%s, 'c1', 'map', '', '{\"$t\": \"obj\"}') on conflict do nothing;" % q(F))
    for nm, tax in [(C1, "CGST")] + ([(C2, "CGST")] if C2 else []) + [(l["name"], "SGST") for l in db.rows("select name from tally_ledgers where book_id = %s and name ~* 'SGST OUTPUT' and deleted_at is null" % q(B))]:
        db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values (%s, 'c1', 'map', %s, %s) on conflict (firm_id, client_id, key, item) do update set data = excluded.data;" % (q(F), q("." + nm), q(json.dumps({"kind": "gst", "side": "output", "tax": tax, "ok": True}))))
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values (%s, 'c1', 'ledInfo', %s, '{\"seen\": 3}');" % (q(F), q("." + C1)))
    db.sql("insert into clients (id, firm_id, name, data) values ('c1', %s, 'Larkspur', %s);" % (q(F), q(json.dumps({"choices": {("flow:" + C1): {"value": "loan_given", "state": "confirmed"}, "gst:cgst": {"value": C1, "state": "confirmed"}, "postTo": {"value": C1, "state": "confirmed"}}}))))
    gst_before = j("select tally_gst_summary('c1', '2025-04-01', '2026-03-31')::text", OWNER)
    ok(gst_before.get("mapped", 0) >= 2 and any(float(m["out"].get("CGST", 0)) != 0 for m in gst_before.get("months", [])), "(GST summary before: %d mapped ledgers, CGST output tax not nil)" % gst_before.get("mapped", 0))
    base = counts(); before_items = int(one("select count(*) from client_book_items"))
    for i in (1, 2):
        r = psql_file(M[39]); ok(r.returncode == 0, "migration-39 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if r.returncode: raise SystemExit("cannot go on without the migration")
    ok(counts() == base and int(one("select count(*) from client_book_items")) == before_items, "nothing deleted by the migration")
    body = open(M[39]).read().lower(); code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    code2 = re.sub(r"delete from tally_(bills|lines) \w where \w\.book_id = p_book and \w\.guid = any\(sent\);|delete from tally_ledger_day t where t\.book_id = p_book and t\.day = any\(touched\);", "", code)
    ok(code2.count("delete from") == 0 and not any(w in code2 for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "drop constraint"]), "the file drops and deletes nothing (37's three cache / re-send deletes inside tally_ingest_day aside)")
    ok(code.strip().startswith("begin;") and code.strip().endswith("commit;"), "one transaction")
    # ---- 1. a rename carries the map item: the GST summary is the same before and after
    C1G = led(C1)["tally_guid"]; C1N = C1 + " (RENAMED)"
    good, r = ren(C1G, C1, C1N)
    ok(good and r.get("renamed") and r.get("confirm") is True and (r.get("carried") or {}).get("items") == 2 and r["carried"].get("flow") == 1 and r["carried"].get("values") == 1, "1. renamed; the answer says what was carried: 2 items (map, ledInfo), 1 flow choice, 1 choice value (%s)" % r.get("carried"))
    gst_after = j("select tally_gst_summary('c1', '2025-04-01', '2026-03-31')::text", OWNER)
    ok(gst_after.get("months") == gst_before.get("months") and gst_after.get("mapped") == gst_before.get("mapped") + 1, "1. tally_gst_summary: every month's tax the same before and after (the map item followed the name; the old row counted as mapped still)")
    ok(item("map", C1N) and json.loads(item("map", C1N)["d"]).get("tax") == "CGST" and item("map", C1N)["deleted"] == "f", "1. the new-name map item is there with the same data")
    old = item("map", C1); od = json.loads(old["d"]) if old else {}
    ok(old and old["deleted"] == "f" and od.get("carriedTo") == C1N and od.get("carriedAt") and od.get("tax") == "CGST", "1. the old item kept (nothing deleted), marked carriedTo / carriedAt (%s)" % od)
    ok(item("ledInfo", C1N) and json.loads(item("ledInfo", C1N)["d"]).get("seen") == 3, "1. the ledInfo item followed too")
    ch = choices()
    ok(("flow:" + C1N) in ch and ch["flow:" + C1N]["value"] == "loan_given" and ("flow:" + C1) in ch, "1. clients.data choices: flow:<new name> added beside flow:<old name>")
    ok(ch["gst:cgst"]["value"] == C1N and ch["gst:cgst"]["prev"] == C1 and ch["postTo"]["value"] == C1, "1. a choice whose value was the old name takes the new one (prev kept); postTo untouched")
    L = led2(C1N); hist = json.loads(L["hist"]).get("renamed", [])
    ok(L["needs_confirm"] == "t" and hist and hist[-1].get("confirm") is True and hist[-1].get("from") == C1 and hist[-1].get("carried", {}).get("items") == 2, "1. needs_confirm true; before_clean.renamed[-1] = {from, confirm: true, carried} (%s)" % hist[-1])
    ok(tb() == 0, "1. the trial balance ties")
    good, out = as_user(STAFF, "select tally_ledger_rename_confirm(%s::uuid, %s)::text" % (q(B), q(C1N))); ok(not good and ("42501" in out or "only an owner" in out), "1. a staff member cannot confirm (%s)" % out[-60:])
    good, out = as_user(OWNER, "select tally_ledger_rename_confirm(%s::uuid, 'no such')::text" % q(B)); ok(not good and "no such ledger" in out, "1. an unknown name is refused")
    good, out = as_user(OWNER, "select tally_ledger_rename_confirm(%s::uuid, %s)::text" % (q(B), q(C1N))); rr = json.loads(out) if good else {}
    L = led2(C1N); hist = json.loads(L["hist"]).get("renamed", [])
    ok(good and rr.get("cleared") == 1 and L["needs_confirm"] == "f" and hist[-1].get("confirm") is False and hist[-1].get("confirmedBy") == OWNER and hist[-1].get("confirmedAt"), "1. the owner confirms: needs_confirm false, the entry closed with who / when (%s)" % {k: hist[-1].get(k) for k in ("confirm", "confirmedBy")})
    # a clash: both names have a map item: the new name's stands, said
    if C2:
        C2G = led(C2)["tally_guid"]; SG = [l["name"] for l in db.rows("select name from tally_ledgers where book_id = %s and name ~* 'SGST OUTPUT' and deleted_at is null and tally_guid is not null order by name" % q(B))][0]
        db.sql("update tally_ledgers set tally_guid = null where book_id = %s and name = %s" % (q(B), q(SG)))
        sd = json.loads(item("map", SG)["d"])
        good, r = ren(C2G, C2, SG)
        ok(good and r.get("merged") and "clash" in json.dumps(r.get("carried")) and "map" in (r.get("carried") or {}).get("clash", []) and "both names had saved choices" in (r.get("note") or ""), "1. a merge onto a name that has its own map item: the clash said (%s)" % r.get("note"))
        ok(json.loads(item("map", SG)["d"]).get("tax") == sd.get("tax") and json.loads(item("map", C2)["d"]).get("carriedTo") == SG and led2(SG)["needs_confirm"] == "t", "1. the new name's item stands (SGST), the old marked carried; the row that stays needs confirming")
    # ---- 2. an empty day the bridge vouches for
    D = sorted(days)[len(days) // 2]; iso_d = "%s-%s-%s" % (D[:4], D[4:6], D[6:]); nD = int(one("select count(*) from tally_vouchers where book_id = %s and day = %s and deleted_at is null" % (q(B), q(iso_d))))
    ok(nD > 0, "(a day with %d live entries: %s)" % (nD, iso_d))
    r = j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10)" % (q(B), q(iso_d)))
    ok(r.get("refused") == "short read: 0 of 0" and r.get("marked") == 0 and int(one("select count(*) from tally_vouchers where book_id = %s and day = %s and deleted_at is null" % (q(B), q(iso_d)))) == nD, "2. an empty file without the flag (the 7-argument call): a short read, nothing marked")
    r = j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, null)" % (q(B), q(iso_d)))
    ok(r.get("refused") == "short read: 0 of 0" and r.get("marked") == 0, "2. with p_empty null: the same")
    r = j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)" % (q(B), q(iso_d)))
    ok(r.get("empty") is True and r.get("marked") == nD and "refused" not in r and int(one("select count(*) from tally_vouchers where book_id = %s and day = %s and deleted_at is null" % (q(B), q(iso_d)))) == 0
       and int(one("select count(*) from tally_vouchers where book_id = %s and day = %s" % (q(B), q(iso_d)))) == nD, "2. with p_empty true: the day's %d entries marked deleted (kept), empty: true" % nD)
    ok(int(one("select count(*) from tally_ledger_day where book_id = %s and day = %s and amount <> 0" % (q(B), q(iso_d)))) == 0, "2. the day cache follows (nil for the day)")
    x = days[D]
    r = j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0, false)" % (q(B), q(iso_d), js(x["vouchers"]), js(x["lines"]), x["n"], x["alterMax"] + 1))
    ok("refused" not in r and int(one("select count(*) from tally_vouchers where book_id = %s and day = %s and deleted_at is null" % (q(B), q(iso_d)))) == nD and tb() == 0, "2. the day re-sent with its entries: un-marked, the trial balance ties again")
    r = j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0, true)" % (q(B), q(iso_d), js(x["vouchers"][:1]), js([l for l in x["lines"] if l[0] == x["vouchers"][0]["guid"]]), 1, x["alterMax"] + 2))
    ok("empty" not in r and r.get("marked") == nD - 1, "2. the flag with entries in the file means nothing: a full file of 1 marks the others, as 37/38 (%s)" % r.get("marked"))
    j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)" % (q(B), q(iso_d), js(x["vouchers"]), js(x["lines"]), x["n"], x["alterMax"] + 3))
    # ---- 3. a confirmed or ok entry keeps its id live
    def vch(i): return {"id": i, "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:%s</NARRATION></VOUCHER>" % i}
    def job(jid, ids, status="running"): return "insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, %d, %s);" % (q(jid), q(F), js({"vouchers": [vch(i) for i in ids]}), len(ids), q(status))
    J = lambda n: "%08d-0000-0000-0000-000000000000" % n
    live = lambda jid, fid: one("select live from tally_post_ids where job_id = %s and fincom_id = %s" % (q(jid), q(fid)))
    db.sql(job(J(1), ["K1", "K2", "K3"]))
    db.sql("update tally_post_jobs set results = %s, items = %s where id = %s" % (js([{"id": "K1", "ok": True, "verified": True, "state": "in_tally", "vchNumber": "26400"}, {"id": "K2", "ok": False, "message": "Tally refused it"}, {"id": "K3", "ok": True}]),
                                                                                js([{"id": "K1", "state": "in_tally"}, {"id": "K2", "state": "failed", "reason": "refused"}]), q(J(1))))
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(1)))
    ok(live(J(1), "K1") == "t" and live(J(1), "K2") == "f" and live(J(1), "K3") == "t" and one("select accepted_at from tally_post_ids where job_id = %s and fincom_id = 'K1'" % q(J(1))) in ("", None),
       "3. the posting failed with no stamp: the confirmed K1 and the ok K3 stay live, the refused K2 is freed")
    try: db.sql(job(J(2), ["K1"])); ok(False, "3. K1 queued again")
    except RuntimeError as e: ok("already being posted" in str(e), "3. a new posting for the confirmed id is refused")
    db.sql(job(J(3), ["K2"])); ok(live(J(3), "K2") == "t", "3. the refused one may be queued again")
    for fn, args in [("tally_ledger_carry_choices", "uuid, text, text"), ("tally_ledger_rename_confirm", "uuid, text"), ("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean"), ("tally_post_ids_sync", "")]:
        d = one("select pg_get_functiondef(%s::regprocedure)" % q("public.%s(%s)" % (fn, args)))
        ok("SECURITY DEFINER" in d and "pg_temp" in d, "%s: security definer, search_path public, pg_temp" % fn)
    ok(one("select has_function_privilege('authenticated', 'tally_ledger_carry_choices(uuid, text, text)', 'execute')") == "f" and one("select has_function_privilege('anon', 'tally_ledger_rename_confirm(uuid, text)', 'execute')") == "f", "a member cannot carry choices by hand; anon cannot confirm")
    k = counts(); r = psql_file(M[39]); ok(r.returncode == 0 and counts() == k, "migration-39 runs a third time over used tables")
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
