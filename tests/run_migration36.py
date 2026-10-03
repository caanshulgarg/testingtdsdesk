"""python3 run_migration36.py - migration-36-ledger-rename (03-Oct-2026, round 4 items 4-6). On a throwaway PostgreSQL
(pg_stand) with the cloud tables and functions as on staging (run_migration33's schema, tally_bills and tally_ingest_day
as deployed, migration-31's raw_* columns), then 32 -> 33 -> 35 -> 34 -> 36 (36 twice), with the MADE-UP BOOKS
(tests/fixtures/books: Master.xml and DayBook.xml) loaded through the real tally_ingest_ledgers_g / tally_ingest_day
path (the day book read by server/tally-cloud/parse.js under Deno, day by day, as tally-ingest does); never on staging.
Checks: the file runs twice, drops and deletes nothing; the trial balance of the loaded book ties (sum of closing 0);
a rename carries the entries: tally_lines, tally_bills, tally_vouchers.party, tally_ledgers.merged_into take the new
name, tally_ledger_day gets the new-name rows (added where one exists) and the old-name rows stay with nil amounts,
merged_into the new name (migration-31's twin pattern), tally_balances shows the entries under the new name and the
sum of closing is the same as before and 0; a rename onto an existing name: one ledger, the entries and the opening
combined, the old row marked merged with the GUID moved; a party with bills and vouchers: party and bills carried; a
rename that would break the trial balance (the new name is a twin row, which the balances leave out; or a book whose
trial balance does not tie) is raised and rolled back, nothing changed; the first-round fix: tally_ledger_round_batch
counts but no longer stamps, tally_ledger_round_seen stamps by GUID after the rows have theirs, so a first round on a
GUID-less copy marks nothing and logs nothing; the service role only; run again over the rows, all kept.
Needs Deno (DENO, default /opt/deno/deno) for the day book."""
import os, re, sys, json, html, subprocess, shutil, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M = {n: os.path.join(SQLDIR, f) for n, f in [(32, "migration-32-sync-safety.sql"), (33, "migration-33-ledger-lists.sql"), (34, "migration-34-ledger-safety.sql"),
                                              (35, "migration-35-bridge-control.sql"), (36, "migration-36-ledger-rename.sql")]}
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
# as on staging beside run_migration33's tables: tally_bills (migration-7), tally_d8 (migration-11), migration-31's raw_* columns,
# tally_ingest_day as deployed (migration-23's body)
EXTRA = """
create table if not exists tally_bills (book_id uuid not null references tally_books (book_id) on delete cascade, firm_id uuid not null, guid text not null, day date not null,
  ledger text not null, name text not null default '', type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date);
create index if not exists tally_bills_book_party on tally_bills (book_id, ledger, name);
""" + sql_function(os.path.join(SQLDIR, "migration-11-ref-cmp.sql"), "tally_d8") + """
alter table tally_ledgers add column if not exists raw_name text; alter table tally_ledgers add column if not exists before_clean jsonb;
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

db = pg_stand.start(55447)
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
try:
    db.sql(SCHEMA33); db.sql(EXTRA)
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing; insert into members values (%s, %s, 'Me', 'owner', true);" % (q(F), q(U), q(F)))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'Larkspur Fixture Events Private Limited', '2025-04-01', '2025-03-31'), (%s, %s, 'c2', 'BIG CO', '2026-04-01', '2026-03-31');"
           % (q(B), q(F), q(BIG), q(F)))
    for n in (32, 33):
        r = psql_file(M[n]); ok(r.returncode == 0, "migration-%d runs %s" % (n, (r.stderr or "").strip()[-300:] if r.returncode else ""))
    db.sql(SCHEMA35)
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version) values (%s, %s, 'NWS144', 'h1', '2.1.5');" % (q(DEV), q(F)))
    for n in (35, 34):
        r = psql_file(M[n]); ok(r.returncode == 0, "migration-%d runs %s" % (n, (r.stderr or "").strip()[-300:] if r.returncode else ""))
    # 1. the file as the owner runs it (psql, stop at the first error), twice
    before = counts()
    for i in (1, 2):
        r = psql_file(M[36])
        ok(r.returncode == 0, "migration-36 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if not os.path.exists(M[36]) or r.returncode: raise SystemExit("cannot go on without the migration")
    ok(counts() == before, "nothing deleted by the migration")
    body = open(M[36]).read().lower()
    code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    ok(not any(w in code for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "delete from"]) and not re.search(r"truncate\s+(table\s+)?(public\.)?tally_", code), "the file drops and deletes nothing")
    ok(code.strip().startswith("begin;") and code.strip().endswith("commit;"), "one transaction (begin; ... commit;)")

    # 2. the made-up books through the real path: the masters as a full list, the day book day by day
    leds, grps, guids = read_master()
    r = j("select tally_ingest_ledgers_g(%s, '2025-04-01', '2025-03-31', %s, %s, %s, true, %d)" % (q(B), js(leds), js(grps), js(LIST), len(leds)))
    ok(r.get("ok") and int(one("select count(*) from tally_ledgers where book_id = %s and deleted_at is null" % q(B))) >= len(leds), "the masters loaded: %d ledgers, %d groups (%s)" % (len(leds), len(grps), {k: r.get(k) for k in ("marked", "held", "note")}))
    n_guid = 0
    for nm, g in guids.items():
        n_guid += int(one("with u as (update tally_ledgers set tally_guid = %s where book_id = %s and name = tally_nm(%s) returning 1) select count(*) from u" % (q(g), q(B), q(nm))))
    ok(n_guid == len(guids), "every ledger has its Tally GUID (%d)" % n_guid)
    days = read_days()
    nv = 0
    for d in sorted(days):
        x = days[d]
        r = j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)" % (q(B), q("%s-%s-%s" % (d[:4], d[4:6], d[6:])), js(x["vouchers"]), js(x["lines"]), x["n"], x["alterMax"]))
        nv += x["n"]
    ok(int(one("select count(*) from tally_vouchers where book_id = %s" % q(B))) == nv and nv > 50, "the day book loaded through tally_ingest_day: %d entries over %d days, %s lines, %s bills"
       % (nv, len(days), one("select count(*) from tally_lines where book_id = %s" % q(B)), one("select count(*) from tally_bills where book_id = %s" % q(B))))
    tb0 = tb()
    ok(tb0 == 0, "the trial balance of the loaded book ties: sum of closing %s" % tb0)
    base = counts()

    # 3. a rename of a ledger with entries (no bills): the entries follow, the trial balance ties
    X = one("""select l.ledger from tally_lines l join tally_ledgers t on t.book_id = l.book_id and t.name = l.ledger where l.book_id = %s and t.deleted_at is null
               and not exists (select 1 from tally_bills b where b.book_id = l.book_id and b.ledger = l.ledger) and not exists (select 1 from tally_vouchers v where v.book_id = l.book_id and v.party = l.ledger)
               group by l.ledger order by count(*) desc, l.ledger limit 1""" % q(B))
    XG = led(X)["tally_guid"]; X2 = X + " (Renamed)"
    xl, xs, xd, xrows, xbal = lines_n(X), lines_sum(X), day_sum(X), len(day_rows(X)), bal(X)
    good, r = ren(XG, X, X2)
    ok(good and r.get("renamed") and led(X) is None and led(X2)["tally_guid"] == XG, "%s -> %s: renamed by GUID (%s)" % (X, X2, {k: r.get(k) for k in ("renamed", "lines", "days", "tb")}))
    ok(lines_n(X) == 0 and lines_n(X2) == xl and lines_sum(X2) == xs, "its %d lines are under the new name in tally_lines (%s)" % (xl, xs))
    ok(day_sum(X2) == xd and len(day_rows(X2)) == xrows, "tally_ledger_day: the new-name rows carry the day totals (%s over %d days)" % (xd, xrows))
    old = day_rows(X)
    ok(len(old) == xrows and all(float(o["amount"]) == 0 and float(o["dr"]) == 0 and float(o["cr"]) == 0 and int(o["n"]) == 0 and o["merged_into"] == X2 for o in old),
       "the old-name day rows kept with nil amounts, merged_into the new name (%d rows, none deleted)" % len(old))
    b2 = bal(X2)
    ok(b2 and bal(X) is None and float(b2["movement"]) == float(xbal["movement"]) and float(b2["closing"]) == float(xbal["closing"]), "tally_balances shows the entries under the new name (closing %s)" % (b2 or {}).get("closing"))
    ok(tb() == tb0 == 0, "the trial balance ties after the rename: sum of closing %s" % tb())
    L = led(X2)
    ok(L["renamed_at"] != "" and [h.get("from") for h in json.loads(L["hist"]).get("renamed", [])][-1:] == [X], "renamed_at stamped and the old name kept in before_clean.renamed")
    ok(one("select count(*) from tally_ledger_marks where book_id = %s and ledger = %s" % (q(B), q(X2))) == "0", "no 'held' or 'marked' mark written by a rename")

    # 4. a rename onto an existing name (a merge): one ledger, the entries and the opening combined
    Y, Z = [x["ledger"] for x in db.rows("""select l.ledger from tally_lines l join tally_ledgers t on t.book_id = l.book_id and t.name = l.ledger
        where l.book_id = %s and t.deleted_at is null and l.ledger <> %s and t.name not like '%%GST%%' and not exists (select 1 from tally_bills b where b.book_id = l.book_id and b.ledger = l.ledger)
          and not exists (select 1 from tally_vouchers v where v.book_id = l.book_id and v.party = l.ledger) group by l.ledger order by count(*) desc, l.ledger limit 2""" % (q(B), q(X2)))]
    YG = led(Y)["tally_guid"]
    db.sql("update tally_ledgers set tally_guid = null where book_id = %s and name = %s" % (q(B), q(Z)))     # the row with the new name has no GUID yet (as a row made by name)
    yl, zl, ys, zs, yo, zo = lines_n(Y), lines_n(Z), lines_sum(Y), lines_sum(Z), led(Y), led(Z)
    ydays = {o["day"]: float(o["amount"]) for o in day_rows(Y)}; zdays = {o["day"]: float(o["amount"]) for o in day_rows(Z)}
    good, r = ren(YG, Y, Z)
    LY, LZ = led(Y), led(Z)
    ok(good and r.get("merged") and LY["deleted_at"] != "" and LY["tally_guid"] == "" and LZ["tally_guid"] == YG and LZ["deleted_at"] == "", "%s -> %s (a row of its own): merged, the old row marked, the GUID moved (%s)" % (Y, Z, r.get("note")))
    ok(lines_n(Y) == 0 and lines_n(Z) == yl + zl and lines_sum(Z) == round(ys + zs, 2), "one ledger with the combined lines (%d + %d)" % (yl, zl))
    ok(float(LZ["open"]) == float(yo["open"]) + float(zo["open"]) and float(LY["open"]) == 0 and float(LY["open_sent"] or 0) == 0, "the opening combined on the row that stays (%s + %s), nil on the merged row" % (yo["open"], zo["open"]))
    comb = {o["day"]: float(o["amount"]) for o in day_rows(Z)}
    want = {d: round(ydays.get(d, 0) + zdays.get(d, 0), 2) for d in set(ydays) | set(zdays)}
    ok({d: round(v, 2) for d, v in comb.items()} == want and all(float(o["amount"]) == 0 and o["merged_into"] == Z for o in day_rows(Y)), "tally_ledger_day added per day (on conflict: amounts summed), the old rows nil and pointed")
    ok(bal(Y) is None and bal(Z) and round(float(bal(Z)["movement"]), 2) == round(ys + zs, 2) and tb() == 0, "tally_balances: one row, the combined movement; the trial balance ties (%s)" % tb())
    ok(one("select count(*) from tally_ledger_marks where book_id = %s and ledger = %s and action = 'marked'" % (q(B), q(Y))) == "1", "the merge logged as a 'marked' row for the old name")

    # 5. a party with bills and vouchers: party and bills carried
    P = one("select ledger from tally_bills where book_id = %s group by ledger order by count(*) desc, ledger limit 1" % q(B))
    PG = led(P)["tally_guid"]; P2 = P + " Pvt Ltd"
    pb, pv, pl = [int(one("select count(*) from %s where book_id = %s and %s = %s" % (t, q(B), c, q(P)))) for t, c in [("tally_bills", "ledger"), ("tally_vouchers", "party"), ("tally_lines", "ledger")]]
    ok(pb > 0 and pv > 0, "%s has %d bills and is the party on %d entries" % (P, pb, pv))
    good, r = ren(PG, P, P2)
    nb, nv2, nl = [int(one("select count(*) from %s where book_id = %s and %s = %s" % (t, q(B), c, q(P2)))) for t, c in [("tally_bills", "ledger"), ("tally_vouchers", "party"), ("tally_lines", "ledger")]]
    ok(good and r.get("renamed") and (nb, nv2, nl) == (pb, pv, pl) and int(one("select count(*) from tally_bills where book_id = %s and ledger = %s" % (q(B), q(P)))) == 0
       and int(one("select count(*) from tally_vouchers where book_id = %s and party = %s" % (q(B), q(P)))) == 0, "renamed: %d bills, %d entries' party and %d lines under the new name (%s)" % (nb, nv2, nl, r.get("note") or ""))
    ok(one("select count(*) from tally_vouchers where book_id = %s and raw_party = %s" % (q(B), q(P))) == str(pv) or one("select count(*) from tally_vouchers where book_id = %s and party = %s and raw_party is null" % (q(B), q(P2))) == str(pv),
       "raw_party left as Tally sent it (history)")
    ok(tb() == 0, "the trial balance ties")
    # a twin pointing at the old name follows
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, merged_into) values (%s, %s, 'Twin Of Party', 'Sundry Debtors', 0, %s)" % (q(B), q(F), q(P2)))
    good, r = ren(PG, P2, P2 + " Two")
    ok(good and r.get("renamed") and led("Twin Of Party")["merged_into"] == P2 + " Two", "tally_ledgers.merged_into pointing at the old name now points at the new one")
    ren(PG, P2 + " Two", P2)

    # 6. a rename that would break the trial balance: raised, rolled back, nothing changed
    V = one("""select l.ledger from tally_lines l join tally_ledgers t on t.book_id = l.book_id and t.name = l.ledger where l.book_id = %s and t.deleted_at is null and t.tally_guid is not null
               and l.ledger not in (%s, %s, %s) group by l.ledger order by count(*) desc, l.ledger limit 1""" % (q(B), q(X2), q(Z), q(P2)))
    VG = led(V)["tally_guid"]
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, merged_into) values (%s, %s, 'Twin Row', 'Indirect Expenses', 0, %s)" % (q(B), q(F), q(Z)))
    k0 = counts(); vl, vd = lines_n(V), day_sum(V)
    good, r = ren(VG, V, "Twin Row", quiet=True)
    ok(not good and "trial balance" in str(r.get("error")) and "after" in str(r.get("error")), "onto a twin row (left out of the balances): raised in plain words (%s)" % str(r.get("error")).strip().split("\n")[0][-160:])
    ok(lines_n(V) == vl and day_sum(V) == vd and led(V)["deleted_at"] == "" and led(V)["tally_guid"] == VG and led("Twin Row")["tally_guid"] == "" and counts() == k0 and tb() == 0, "rolled back: lines, day totals, GUID and rows as they were")
    db.sql("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values (%s, %s, %s, '2025-06-15', 5, 0, 5, 1)" % (q(B), q(F), q(V)))
    ok(tb() == 5, "(the book made not to tie: sum of closing 5)")
    good, r = ren(VG, V, V + " B", quiet=True)
    ok(not good and "trial balance" in str(r.get("error")) and "5" in str(r.get("error")) and led(V) is not None and lines_n(V) == vl, "a book whose trial balance does not tie cannot rename until it does: raised, nothing changed (%s)" % str(r.get("error")).strip().split("\n")[0][-160:])
    db.sql("update tally_ledger_day set amount = 0, cr = 0, n = 0 where book_id = %s and ledger = %s and day = '2025-06-15' and amount = 5" % (q(B), q(V)))
    ok(tb() == 0, "(the book ties again)")
    good, r = ren(VG, V, V + " B")
    ok(good and r.get("renamed") and tb() == 0, "and then the rename goes through")

    # 7. as migration-34: refused when the new name is another GUID's; nothing when no such ledger; the same name
    good, r = ren(XG, X2, Z)
    ok(good and r.get("refused") and "GUID" in (r.get("note") or "") and led(X2)["tally_guid"] == XG and lines_n(X2) == xl, "the new name held by another GUID: refused with a note, nothing moved")
    good, r = ren("g-none", "Nobody", "Somebody")
    ok(good and not r.get("renamed") and not r.get("merged"), "no such ledger: nothing done")
    good, r = ren(XG, X2, X2)
    ok(good and not r.get("renamed"), "the same name: nothing done")
    # a row marked deleted that takes the name again (Tally renamed another ledger to it): un-marked, not left out of the balances
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, deleted_at, deleted_reason) values (%s, %s, 'Old Marked Name', 'Indirect Expenses', 0, now(), 'missing from full list')" % (q(B), q(F)))
    good, r = ren(XG, X2, "Old Marked Name")
    ok(good and r.get("merged") and led("Old Marked Name")["deleted_at"] == "" and led("Old Marked Name")["tally_guid"] == XG and lines_n("Old Marked Name") == xl and tb() == 0,
       "onto a name marked deleted: that row un-marked, the GUID and the entries move to it, the trial balance ties")
    ren(XG, "Old Marked Name", X2)

    # 8. nothing deleted by the renames; the day totals only grew
    k = counts()
    ok(all(k[t] == base[t] for t in ("tally_vouchers", "tally_lines", "tally_bills", "tally_days")) and k["tally_ledgers"] >= base["tally_ledgers"] and k["tally_ledger_day"] >= base["tally_ledger_day"],
       "renames deleted nothing: %s" % {t: (base[t], k[t]) for t in ("tally_lines", "tally_bills", "tally_vouchers", "tally_ledger_day")})
    ok(int(one("select count(*) from tally_lines where book_id = %s" % q(B))) == int(one("select sum(n) from tally_ledger_day where book_id = %s" % q(B)))
       + int(one("select count(*) from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid where l.book_id = %s and (v.cancelled or v.optional)" % q(B))),
       "the day totals still count every live line once")

    # 9. the first-round fix: the batch counts, the stamp comes after the rows have their GUIDs
    many = [["Party %02d" % i, "Sundry Debtors", "0"] for i in range(40)]
    j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, '[[\"Sundry Debtors\", \"Current Assets\"]]', %s)" % (q(BIG), js(many), js(LIST)))
    G = ["g%02d" % i for i in range(40)]
    ok(one("select count(*) from tally_ledgers where book_id = %s and tally_guid is not null" % q(BIG)) == "0", "(a copy whose rows have no GUID yet, as staging before 2.1.5)")
    stamped = lambda: int(one("select count(*) from tally_ledgers where book_id = %s and seen_round = 'r-1'" % q(BIG)))
    good, r = call("tally_ledger_round_batch(%s, 'r-1', 40, 40, true, %s, 'go-abc123', %s)" % (q(BIG), q(DEV), js(G)))
    ok(good and r["seen"] == 40 and r["complete"] is True, "the batch recorded with its counts (seen 40 of rowsRead 40)")
    # the rows get their GUIDs (tally-ingest's upsert), then the stamp
    db.sql("update tally_ledgers set tally_guid = 'g' || substr(name, 7, 2) where book_id = %s and name like 'Party %%'" % q(BIG))
    ok(stamped() == 0, "tally_ledger_round_batch no longer stamps seen_round (the rows had no GUID when it ran)")
    good, r = call("tally_ledger_round_seen(%s, 'r-1', %s)" % (q(BIG), js(G + [" g00 ", "g-poison", ""])))
    ok(good and r.get("stamped") == 40 and stamped() == 40 and one("select count(*) from tally_ledgers where book_id = %s and seen_at is null and name like 'Party %%'" % q(BIG)) == "0",
       "tally_ledger_round_seen stamps every row by GUID after the upsert (40; blanks and unknown GUIDs ignored) (%s)" % r)
    m0 = int(one("select count(*) from tally_ledger_marks where book_id = %s" % q(BIG)))
    good, r = call("tally_ledgers_mark_gone(%s, 'r-1')" % q(BIG))
    ok(good and r["marked"] == 0 and r["held"] == 0 and "nothing to mark" in (r["note"] or "") and int(one("select count(*) from tally_ledger_marks where book_id = %s" % q(BIG))) == m0,
       "the first round marks nothing and logs no 'held' burst (%s)" % r.get("note"))
    good, r = call("tally_ledger_round_seen(%s, 'r-1', %s)" % (q(BIG), js(G)))
    ok(good and r.get("stamped") == 0, "stamped again for the same round: nothing to do")
    good, r = call("tally_ledger_round_batch(%s, 'r-1', 1, null, null, %s, 'go-abc123')" % (q(BIG), q(DEV)))
    ok(good and r["batches"] == 2, "the 7-argument batch call still answers")
    # a later round that misses one: marked as before (the stamp order changes nothing there)
    call("tally_ledger_round_batch(%s, 'r-2', 39, 39, true, %s, 'go-abc123', %s)" % (q(BIG), q(DEV), js(G[:39])))
    call("tally_ledger_round_seen(%s, 'r-2', %s)" % (q(BIG), js(G[:39])))
    good, r = call("tally_ledgers_mark_gone(%s, 'r-2')" % q(BIG))
    ok(good and r["marked"] == 1 and led("Party 39", BIG)["deleted_at"] != "", "a complete round not seeing one GUID: that row marked, as migration-34")

    # 10. who may call: the service role only; every function of the file security definer, public, pg_temp
    for fn in ["tally_ledger_round_seen(%s, 'x', '[]')" % q(B), "tally_ledger_rename(%s, 'g', 'a', 'b')" % q(B), "tally_ledger_round_batch(%s, 'x', 1, 1, true, null, '', '[]')" % q(B)]:
        try:
            db.sql("set fincom.role = 'authenticated'; select " + fn + ";"); ok(False, "a member called " + fn)
        except RuntimeError as e:
            ok("not allowed" in str(e), "a member is refused " + fn.split("(")[0])
    for fn in ["tally_ledger_round_seen(uuid, text, jsonb)", "tally_ledger_rename(uuid, text, text, text)", "tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text, jsonb)"]:
        ok(one("select has_function_privilege('anon', %s, 'execute')" % q("public." + fn)) == "f" and one("select has_function_privilege('authenticated', %s, 'execute')" % q("public." + fn)) == "f"
           and one("select has_function_privilege('service_role', %s, 'execute')" % q("public." + fn)) == "t", "%s: service role only" % fn.split("(")[0])
    names = sorted(set(re.findall(r"function\s+public\.(\w+)\s*\(", open(M[36]).read())))
    n = 0
    for fn in names:
        for row in db.rows("select prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)):
            n += 1
            ok(row["prosecdef"] == "t" and row["conf"].replace(" ", "") == "search_path=public,pg_temp", "%s: security definer with search_path = public, pg_temp (has %r)" % (fn, row["conf"]))
    ok(n >= 4, "functions checked: %d" % n)
    # 11. run once more over the rows: all kept, the renames still hold
    k = counts()
    r = psql_file(M[36]); ok(r.returncode == 0 and counts() == k, "run again over the rows: all kept (%s)" % k)
    ok(lines_n(X2) == xl and tb() == 0, "the renamed entries and the trial balance as they were")
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
