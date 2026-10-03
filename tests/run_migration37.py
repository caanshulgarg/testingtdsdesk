"""python3 run_migration37.py - migration-37-follow-ups (03-Oct-2026, round 4 items 7, 8, 10, 11, 12, 13, 14 and 23). On a
throwaway PostgreSQL (pg_stand) with the cloud tables as on staging (the schema of run_migration33.py, tally_bills,
tally_devices of run_migration35.py), then migrations 32, 33, 35, 34 (and 36 when the file exists; else said so), then
37 twice, with made-up rows sent through the real tally_ingest_day; never on staging.
Checks: the file runs twice, drops and deletes nothing (its functions replace only the lines and bills of a re-sent entry
and rebuild the tally_ledger_day cache, as today); every function in it is security definer with search_path =
public, pg_temp; item 7: an id released per entry (live = false, released_at/by/why), the other entries of the posting
untouched, Retry of the posting never revives it, the id may be queued again, a member cannot call it; item 8: each
version carries the entry's lines, and the previous lines are kept on the previous version when an entry is re-sent;
item 10: an owner clears needs_baseline with a note (empty note refused; staff, another firm's owner and anon refused),
who and when kept; item 11: a day re-sent without one entry marks it deleted (never removed: counts), tally_tb,
tally_period, tally_mis, tally_gst_summary and tally_balances_on exclude it and tally_ledger_day moves by its amount;
re-sent again it is un-marked and its lines replaced; item 12: a lease released is kept (released_at), take reuses the
row, an expired one too; item 13: tally_balances_on arithmetic on seeded data, as on an earlier date, excluding deleted
and merged ledgers, another firm refused; item 14: fincom_id stored from the file's "fid" and origin set from it (the
narration tag still works), the index exists, old rows backfilled; item 23: withdraw owner-only with a reason, approve
refused on a withdrawn version, a new pilot clears the withdrawal (and an approval) and records them in note."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M32, M33, M34, M35, M36, M37 = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-34-ledger-safety.sql",
                                                                  "migration-35-bridge-control.sql", "migration-36-rename-rounds.sql", "migration-37-follow-ups.sql")]
M36B = os.path.join(SQLDIR, "migration-36b-post-acceptance.sql")
if not os.path.exists(M36):
    cands = [f for f in os.listdir(SQLDIR) if f.startswith("migration-36")]
    if cands: M36 = os.path.join(SQLDIR, sorted(cands)[0])
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    """the SCHEMA text of another test (one source for the tables as on staging)"""
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
# what the two schemas lack and tally_ingest_day / the reports need, as on staging
SCHEMA_X = r"""
drop table if exists tally_bills cascade;
create table tally_bills (book_id uuid not null, firm_id uuid not null, guid text not null, day date not null, ledger text not null, name text not null default '',
  type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date);
create index tally_bills_book_guid on tally_bills (book_id, guid);
create or replace function public.tally_d8(p text) returns date language plpgsql immutable set search_path to 'public' as $function$
begin
  if coalesce(p, '') !~ '^(19|20)\d{6}$' then return null; end if;
  return make_date(substr(p, 1, 4)::int, substr(p, 5, 2)::int, substr(p, 7, 2)::int);
exception when others then return null;
end $function$;
create or replace function public.tally_led_kinds(p_client text) returns table(ledger text, kind text, side text, tax text, what text)
language sql stable security definer set search_path to 'public' as $function$
  select tally_nm(substr(i.item, 2)), coalesce(i.data->>'kind', ''), coalesce(i.data->>'side', ''), coalesce(i.data->>'tax', ''),
         coalesce(nullif(i.data->>'what', ''), case when i.data->>'kind' = 'gst' and coalesce(i.data->>'rcm', '') = 'true' then 'gst_rcm' else coalesce(i.data->>'kind', '') end)
    from client_book_items i where i.firm_id = my_firm() and i.client_id = p_client and i.key = 'map' and i.item like '.%' and not i.deleted;
$function$;
create or replace function public.tally_mis_head(p_name text, p_chain text[]) returns text language sql immutable set search_path to 'public' as $function$
  select case
    when exists (select 1 from unnest(p_chain) g where lower(g) in ('sales accounts', 'direct incomes')) then 'rev'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'indirect incomes') then 'oth'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'purchase accounts') then 'pur'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'direct expenses') then 'dir'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'indirect expenses') then 'exp'
    else '' end
$function$;
grant usage on schema public, auth to authenticated, anon;
grant select on members to authenticated;
"""
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333"
B, B2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
D1, D2 = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002"
J = lambda n: "%08d-0000-0000-0000-000000000000" % n
GROUPS = [["Current Assets", ""], ["Cash-in-hand", "Current Assets"], ["Sundry Debtors", "Current Assets"], ["Sales Accounts", ""], ["Indirect Expenses", ""],
          ["Capital Account", ""], ["Duties & Taxes", "Current Liabilities"], ["Current Liabilities", ""]]
LEDGERS = [["Cash", "Cash-in-Hand", "-1000"], ["Alpha Traders", "Sundry Debtors", "-300"], ["Sales", "Sales Accounts", "0"], ["Rent", "Indirect Expenses", "0"],
           ["Capital", "Capital Account", "1300"], ["CGST Output", "Duties & Taxes", "0"], ["Old Twin", "Sundry Debtors", "0"], ["Gone Co", "Sundry Debtors", "0"]]
DAY = "2026-05-01"
def V(guid, alter, narr="", fid=None, party=""):
    v = {"guid": guid, "alter": alter, "type": "Sales", "no": guid.upper(), "party": party, "narr": narr, "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": ""}
    if fid is not None: v["fid"] = fid
    return v
L = lambda guid, ledger, amount, hsn="", rate=None, bills=None: [guid, ledger, amount, hsn, rate, bills or []]
# the day: g1 a cash sale, g2 a FinCom bill with tax and a bill reference, g3 rent paid
G1 = ([V("g1", 1)], [L("g1", "Sales", 250), L("g1", "Cash", -250)])
G2 = ([V("g2", 1, "Bill 7 | TDSDesk:ab12", "ab12", "Alpha Traders")], [L("g2", "Sales", 100, "9983", 18), L("g2", "CGST Output", 9), L("g2", "Alpha Traders", -109, "", None, [["B-7", "New Ref", -109, 30]])])
G3 = ([V("g3", 1, "May rent")], [L("g3", "Rent", -50), L("g3", "Cash", 50)])
def day(*parts, alter=5, n=None):
    vs = sum((p[0] for p in parts), []); ls = sum((p[1] for p in parts), [])
    return "select tally_ingest_day(%s, %s, %s, %s, %d, %d, 1000)::text" % (q(B), q(DAY), js(vs), js(ls), len(vs) if n is None else n, alter)

db = pg_stand.start(55448)
def psql_text(text):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=text, capture_output=True, text=True)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return psql_text(open(path).read())
j = lambda s, uid=None: json.loads(db.one(s, uid))
def as_user(uid, stmt):
    """runs stmt as a signed-in person (role authenticated, auth.uid() = uid); returns (ok, output or error)"""
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def as_anon(stmt):
    try: return True, db.one("set role anon; " + stmt)
    except RuntimeError as e: return False, str(e)
def fails_with(stmt, words, uid=None):
    try:
        db.sql(stmt, uid); return False, ""
    except RuntimeError as e:
        return all(w in str(e) for w in words), str(e)[-300:]
def counts(): return {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_lines", "tally_bills", "tally_ledgers", "tally_voucher_versions", "tally_post_ids", "tally_post_jobs",
                                                                                "tally_company_lease", "tally_sync_cursor", "tally_bridge_releases", "tally_days", "tally_books"]}
tb = lambda as_on=DAY: {r["ledger"]: r for r in db.rows("select ledger, open, movement, closing from tally_tb('c1', %s)" % q(as_on), OWNER)}
period = lambda: {r["ledger"]: r for r in db.rows("select ledger, open, dr, cr from tally_period('c1', '2026-04-01', '2026-05-31')", OWNER)}
mis = lambda: j("select tally_mis('c1', '2026-04-01', '2026-05-31')::text", OWNER)
gst = lambda: j("select tally_gst_summary('c1', '2026-05-01', '2026-05-31')::text", OWNER)
bal = lambda as_on=DAY, book=B, uid=OWNER: {r["ledger"]: r for r in db.rows("select ledger, parent, primary_group, open, movement, closing from tally_balances_on(%s, %s)" % (q(book), q(as_on)), uid)}
lday = lambda ledger: db.one("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and ledger = %s" % (q(B), q(ledger)))
vrow = lambda guid: db.rows("select guid, day, alter_id, deleted_at, fincom_id, origin, narration from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(guid)))[0]
versions = lambda guid: db.rows("select alter_id, lines::text as lines from tally_voucher_versions where book_id = %s and tally_guid = %s order by alter_id" % (q(B), q(guid)))
try:
    db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(SCHEMA_X)
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(X)s, %(F2)s, 'Them', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%(B2)s, %(F2)s, 'c9', 'OTHER', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.1.5'), (%(D2)s, %(F)s, 'OFFICE-2', 'h2', '2.1.4');
      insert into client_book_items (firm_id, client_id, key, item, data) values (%(F)s, 'c1', 'map', '.CGST Output', '{"kind": "gst", "side": "output", "tax": "CGST"}');""" % {
        "F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "X": q(OTHER), "B": q(B), "B2": q(B2), "D1": q(D1), "D2": q(D2)})
    for path in (M32, M33, M35, M34):
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
    if os.path.exists(M36):
        r = psql_file(M36); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(M36), (r.stderr or "").strip()[-300:] if r.returncode else ""))
    else: print("  note: migration-36 is not in the tree yet; 37 tested over 32, 33, 35, 34 only")
    r = psql_file(M36B); ok(r.returncode == 0, "%s runs (before 37) %s" % (os.path.basename(M36B), (r.stderr or "").strip()[-300:] if r.returncode else ""))
    j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)::text" % (q(B), js(LEDGERS), js(GROUPS)))
    db.sql("update tally_ledgers set merged_into = 'Alpha Traders' where book_id = %s and name = 'Old Twin'; update tally_ledgers set deleted_at = now() where book_id = %s and name = 'Gone Co';" % (q(B), q(B)))
    # rows from before 37: an entry whose narration carries the tag (fincom_id to be backfilled), a lease and a posting
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, narration) values (%s, %s, 'g-old', '2026-04-10', 3, 'Rent | TDSDesk:old9')" % (q(B), q(F)))
    db.sql("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values (%s, %s, 'Capital', '2026-04-10', 0, 0, 0, 0)" % (q(B), q(F)))
    before = counts()

    # 1. the file as the owner runs it (psql, stop at the first error), twice
    for i in (1, 2):
        r = psql_file(M37)
        ok(r.returncode == 0, "migration-37 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if not os.path.exists(M37) or r.returncode: raise SystemExit("cannot go on without the migration")
    ok(counts() == before, "nothing deleted by the migration (%s)" % counts())
    body = open(M37).read()
    code = " ".join(l for l in body.lower().split("\n") if not l.strip().startswith("--"))
    outside = re.sub(r"\$function\$.*?\$function\$", " ", code, flags=re.S)
    ok(not any(w in outside for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "drop index", "delete from"]) and not re.search(r"truncate\s", outside),
       "the file drops and deletes nothing outside its function bodies")
    ok("delete from tally_vouchers" not in code and "delete from tally_voucher_versions" not in code and "delete from tally_post_ids" not in code
       and "delete from tally_company_lease" not in code and "delete from tally_bridge_releases" not in code, "no function in the file deletes entries, versions, ids, leases or releases")
    ok(code.strip().startswith("begin;") and code.strip().endswith("commit;"), "one transaction (begin; ... commit;)")
    names = sorted(set(re.findall(r"create or replace function public\.(tally_\w+)\s*\(", body)))
    bad = [r["proname"] + ":" + str(r["sp"]) for r in db.rows("select proname, prosecdef, prorettype = 'trigger'::regtype as trg, array_to_string(proconfig, ',') as sp from pg_proc where proname in (%s)" % ",".join(q(n) for n in names))
           if r["sp"] != "search_path=public, pg_temp" or (r["prosecdef"] != "t" and r["trg"] != "t")]
    ok(names and not bad, "every function of the file searches public, pg_temp and is security definer (the row triggers plain, as migration-32) (%d functions%s)" % (len(names), "; wrong: " + ", ".join(bad) if bad else ""))
    for t in ("tally_post_ids", "tally_sync_cursor"):
        ok(int(db.one("select count(*) from pg_policies where tablename = %s and cmd = 'SELECT' and 'authenticated' = any(roles)" % q(t))) >= 1, "%s has a select policy for members" % t)

    # 2. item 14: the backfill, then a day sent with "fid"
    ok(vrow("g-old")["fincom_id"] == "old9" and vrow("g-old")["origin"] == "fincom", "fincom_id backfilled from the narration tag of an older entry")
    ok(int(db.one("select count(*) from pg_indexes where tablename = 'tally_vouchers' and indexdef like '%fincom_id%'")) == 1, "index on (book_id, fincom_id)")
    res = j(day(G1, G2, G3))
    ok(res["ok"] is True and res.get("marked") == 0, "the day ingested: %s" % res)
    g2 = vrow("g2")
    ok(g2["fincom_id"] == "ab12" and g2["origin"] == "fincom" and vrow("g1")["origin"] == "tally", "fincom_id stored from the file's fid and origin 'fincom' from it; a plain entry stays 'tally'")
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, narration) values (%s, %s, 'g-tag', '2026-04-11', 1, 'x | TDSDesk:zz1')" % (q(B), q(F)))
    ok(vrow("g-tag")["origin"] == "fincom" and vrow("g-tag")["fincom_id"] == "zz1", "an entry inserted with the tag in its narration only: origin fincom, fincom_id from the tag (fallback kept)")
    # fid wins over a different tag in the narration
    db.sql(day(([V("g9", 1, "Bill | TDSDesk:other", "real1")], [L("g9", "Sales", 1), L("g9", "Cash", -1)]), G1, G2, G3))
    ok(vrow("g9")["fincom_id"] == "real1", "the file's fid is the id, whatever the narration says")

    # 3. item 8: versions carry lines
    vs = versions("g2")
    ok(len(vs) == 1 and vs[0]["lines"] and json.loads(vs[0]["lines"]) == [["Alpha Traders", -109, "", None, [["B-7", "New Ref", -109, 30]]], ["CGST Output", 9, "", None, []], ["Sales", 100, "9983", 18, []]],
       "the version row carries the entry's lines [ledger, amount, hsn, rate, bills] (%s)" % (vs[0]["lines"] if vs else vs))
    ok(all(json.loads(v["lines"] or "null") for g in ("g1", "g3") for v in versions(g)), "every entry of the day has its lines on its version")

    # 4. item 11: the day re-sent without g2 -> marked, never removed; the reports and the day totals move
    c0 = counts()
    t0, p0, m0, s0, b0 = tb(), period(), mis(), gst(), bal()
    ok(float(t0["Sales"]["closing"]) == 351 and float(p0["Sales"]["cr"]) == 351 and m0["sales"]["total"] == 351 and float(b0["Sales"]["closing"]) == 351 and float(lday("Sales")) == 351,
       "before: Sales 351 in tally_tb, tally_period, tally_mis, tally_balances_on and tally_ledger_day")
    ok(s0["months"][0]["out"]["CGST"] == 9, "before: CGST output 9 in tally_gst_summary")
    res = j(day(([V("g9", 1, "Bill | TDSDesk:other", "real1")], [L("g9", "Sales", 1), L("g9", "Cash", -1)]), G1, G3, alter=6))
    ok(res.get("marked") == 1, "re-sent without g2: one entry marked (%s)" % res)
    g2 = vrow("g2")
    ok(g2["deleted_at"] != "" and counts()["tally_vouchers"] == c0["tally_vouchers"] and counts()["tally_lines"] == c0["tally_lines"] and counts()["tally_bills"] == c0["tally_bills"],
       "g2 has deleted_at; no voucher, line or bill removed (%s)" % {k: counts()[k] for k in ("tally_vouchers", "tally_lines", "tally_bills")})
    t1, p1, m1, s1, b1 = tb(), period(), mis(), gst(), bal()
    ok(float(t1["Sales"]["closing"]) == 251 and float(p1["Sales"]["cr"]) == 251 and m1["sales"]["total"] == 251 and float(b1["Sales"]["closing"]) == 251 and float(lday("Sales")) == 251,
       "after: Sales 251 everywhere (the deleted entry's 100 gone)")
    ok(float(t1["Alpha Traders"]["closing"]) == -300 and float(lday("Alpha Traders")) == 0, "the party's balance back to its opening")
    ok(s1["months"][0]["out"]["CGST"] == 0, "tally_gst_summary: the deleted entry's tax not counted")
    ok(all(p["party"] != "Alpha Traders" for p in m1["sales"]["rows"]), "tally_mis sales by customer: the deleted entry's party gone")
    ok(int(db.one("select n from tally_days where book_id = %s and day = %s" % (q(B), q(DAY)))) == 3 and int(db.one("select alter_max from tally_days where book_id = %s and day = %s" % (q(B), q(DAY)))) == 6,
       "tally_days bookkeeping as today (n, alter_max)")
    # re-sent again, changed (AlterID 2, 120 instead of 100): un-marked, lines replaced, the old lines kept on the old version
    G2b = ([V("g2", 2, "Bill 7 | TDSDesk:ab12", "ab12", "Alpha Traders")], [L("g2", "Sales", 120, "9983", 18), L("g2", "CGST Output", 10.8), L("g2", "Alpha Traders", -130.8, "", None, [["B-7", "New Ref", -130.8, 30]])])
    res = j(day(([V("g9", 1, "Bill | TDSDesk:other", "real1")], [L("g9", "Sales", 1), L("g9", "Cash", -1)]), G1, G2b, G3, alter=7))
    g2 = vrow("g2")
    ok(g2["deleted_at"] == "" and g2["alter_id"] == "2" and res.get("marked") == 0, "re-sent again: un-marked, AlterID 2")
    ok(counts()["tally_vouchers"] == c0["tally_vouchers"] and float(db.one("select sum(amount) from tally_lines where book_id = %s and guid = 'g2' and ledger = 'Sales'" % q(B))) == 120
       and int(db.one("select count(*) from tally_lines where book_id = %s and guid = 'g2'" % q(B))) == 3 and int(db.one("select count(*) from tally_bills where book_id = %s and guid = 'g2'" % q(B))) == 1,
       "its lines and bills replaced (3 lines, 1 bill), no voucher removed")
    vs = versions("g2")
    ok(len(vs) == 2 and json.loads(vs[0]["lines"])[2][1] == 100 and json.loads(vs[1]["lines"])[2][1] == 120, "two versions of g2: the old one keeps the old lines (100), the new one the new (120)")
    ok(float(tb()["Sales"]["closing"]) == 371 and float(lday("Sales")) == 371 and float(bal()["Sales"]["closing"]) == 371, "Sales 371 after the change")
    # a day moved: g3 re-sent on 02-May; its old day rebuilt too
    j("select tally_ingest_day(%s, '2026-05-02', %s, %s, 1, 8, 10)::text" % (q(B), js([V("g3", 2, "May rent")]), js([L("g3", "Rent", -50), L("g3", "Cash", 50)])))
    ok(vrow("g3")["day"] == "2026-05-02" and float(db.one("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and ledger = 'Rent' and day = '2026-05-01'" % q(B))) == 0
       and float(db.one("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and ledger = 'Rent' and day = '2026-05-02'" % q(B))) == -50, "an entry sent on another day: both days rebuilt")
    good, out = fails_with("update tally_voucher_versions set alter_id = 99 where tally_guid = 'g2'", ["append-only"])
    ok(good, "versions stay append-only")
    good, out = fails_with("update tally_voucher_versions set lines = '[]'::jsonb where tally_guid = 'g2'", ["append-only"])
    ok(good, "lines once filled cannot be changed")
    good, out = fails_with("set fincom.role = 'authenticated'; " + day(G1), ["not allowed"])
    ok(good, "a member cannot call tally_ingest_day")

    # 5. item 13: tally_balances_on
    b = bal("2026-04-30")
    ok(float(b["Sales"]["closing"]) == 0 and float(b["Cash"]["closing"]) == -1000 and float(b["Cash"]["open"]) == -1000 and float(b["Cash"]["movement"]) == 0, "as on 30-Apr: openings only")
    b = bal("2026-05-31")
    ok(float(b["Cash"]["closing"]) == -1000 - 250 - 1 + 50 and float(b["Cash"]["movement"]) == -201 and b["Cash"]["parent"] == "Cash-in-Hand" and b["Cash"]["primary_group"] == "Current Assets",
       "as on 31-May: open + movement = closing with parent and primary group (%s)" % b["Cash"])
    ok("Old Twin" not in b and "Gone Co" not in b and "Alpha Traders" in b, "a merged twin and a deleted ledger left out")
    ok(abs(sum(float(r["closing"]) for r in b.values())) < 0.005, "the book ties (sum of closings 0)")
    good, out = as_user(STAFF, "select count(*) from tally_balances_on(%s, '2026-05-31')" % q(B))
    ok(good and int(out) == len(b), "a staff member of the firm reads it")
    good, out = as_user(OTHER, "select count(*) from tally_balances_on(%s, '2026-05-31')" % q(B))
    ok(not good and "not a company of your firm" in out, "another firm's owner is refused (%s)" % out.strip()[-80:])
    good, out = as_anon("select count(*) from tally_balances_on(%s, '2026-05-31')" % q(B))
    ok(not good, "anon cannot call it")

    # 6. item 7: an id released per entry
    def vch(i): return {"id": i, "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:%s</NARRATION></VOUCHER>" % i}
    def job(jid, ids, status="waiting"):
        return "insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, %d, %s);" % (q(jid), q(F), js({"vouchers": [vch(i) for i in ids]}), len(ids), q(status))
    db.sql(job(J(1), ["X1", "X2"]))
    db.sql("update tally_post_jobs set status = 'running' where id = %s" % q(J(1)))
    r = j("select tally_post_id_release(%s, 'X1', 'Tally refused it: ledger Alpha missing')::text" % q(J(1)))
    live = {x["fincom_id"]: x for x in db.rows("select fincom_id, live, released_at, released_by, released_why from tally_post_ids where job_id = %s" % q(J(1)))}
    ok(r["released"] is True and live["X1"]["live"] == "f" and live["X1"]["released_at"] != "" and live["X1"]["released_by"] == "bridge" and "ledger Alpha" in live["X1"]["released_why"],
       "X1 released: live false with released_at/by/why (%s)" % live["X1"])
    ok(live["X2"]["live"] == "t" and live["X2"]["released_at"] == "", "X2 of the same posting untouched")
    db.sql(job(J(2), ["X1"]))
    ok(db.one("select live from tally_post_ids where job_id = %s" % q(J(2))) == "t", "X1 may be queued again in a new posting")
    good, out = fails_with(job(J(3), ["X2"]), ["already being posted"])
    ok(good, "X2, not released, still cannot be queued twice")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s; update tally_post_jobs set status = 'waiting' where id = %s" % (q(J(1)), q(J(1))))
    live = {x["fincom_id"]: x["live"] for x in db.rows("select fincom_id, live from tally_post_ids where job_id = %s" % q(J(1)))}
    ok(live == {"X1": "f", "X2": "t"}, "Retry of the posting: X2 live again, the released X1 stays released (%s)" % live)
    ok(j("select tally_post_id_release(%s, 'nope', 'x')::text" % q(J(1)))["released"] is False, "an unknown id: nothing released")
    r = j("select tally_post_id_release(%s, 'X1', 'again')::text" % q(J(1)))
    ok(r["released"] is False and "ledger Alpha" in db.one("select released_why from tally_post_ids where job_id = %s and fincom_id = 'X1'" % q(J(1))), "released twice: the first reason kept")
    good, out = fails_with("set fincom.role = 'authenticated'; select tally_post_id_release(%s, 'X2', 'x')" % q(J(1)), ["not allowed"])
    ok(good, "a member cannot release an id")
    ok(int(db.one("select count(*) from tally_post_ids")) == 3, "no id row removed")
    # round 5 (S1, S2, S4): 37 runs after 36b and keeps its rule: an id Tally accepted is never freed by the sync, and
    # tally_post_id_release never frees it either (the owner's tally_post_id_release_owner, 36b, is the only way)
    db.sql(job(J(4), ["ACC1", "REF-2.b"])); db.sql("update tally_post_jobs set status = 'running' where id = %s" % q(J(4)))
    acc = j("select tally_post_id_accept(%s, 'ACC1', '26298')::text" % q(J(4)))
    ok(acc.get("stamped") == 1, "36b's tally_post_id_accept still stamps under 37 (%s)" % acc)
    liv = lambda: {x["fincom_id"]: x["live"] for x in db.rows("select fincom_id, live from tally_post_ids where job_id = %s" % q(J(4)))}
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(4)))
    ok(liv() == {"ACC1": "t", "REF-2.b": "f"}, "S1. the posting failed under 37's sync: the accepted ACC1 stays live, REF-2.b is freed (%s)" % liv())
    db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(4)))
    ok(liv()["ACC1"] == "t", "S1. cancelled: ACC1 still live")
    ok("accepted_at" in db.one("select pg_get_functiondef('tally_post_ids_sync'::regproc)"), "37's tally_post_ids_sync carries the accepted_at guard")
    db.sql("update tally_post_jobs set status = 'running' where id = %s" % q(J(4)))
    r = j("select tally_post_id_release(%s, 'ACC1', 'the bridge says failed')::text" % q(J(4)))
    row = db.rows("select live, released_at, released_why from tally_post_ids where job_id = %s and fincom_id = 'ACC1'" % q(J(4)))[0]
    ok(r["released"] is False and "accepted" in str(r.get("why", "")) and row["live"] == "t" and row["released_at"] == "", "S2. tally_post_id_release never frees an accepted id: released false, why 'accepted by Tally' (%s | %s)" % (r, row))
    r = j("select tally_post_id_release(%s, 'REF2b', 'Tally refused it')::text" % q(J(4)))     # the bridge's spelling (letters and digits) of the tag's REF-2.b
    ok(r["released"] is True and db.one("select released_by from tally_post_ids where job_id = %s and fincom_id = 'REF-2.b'" % q(J(4))) == "bridge", "S4. released by the id as the bridge spells it (REF2b for the tag's REF-2.b) (%s)" % r)
    good, out = as_user(OWNER, "select tally_post_id_release_owner(%s::uuid, 'ACC1', 'looked: not in Tally')::text" % q(J(4)))
    ok(good and db.one("select live from tally_post_ids where job_id = %s and fincom_id = 'ACC1'" % q(J(4))) == "f", "S3. the owner's release (36b) frees the accepted id under 37 (%s)" % out[-100:])
    db.sql("update tally_post_jobs set status = 'failed' where id = %s; update tally_post_jobs set status = 'waiting' where id = %s" % (q(J(4)), q(J(4))))
    ok(liv() == {"ACC1": "f", "REF-2.b": "f"}, "S3. Retry: neither released id is revived (%s)" % liv())

    # 7. item 12: the lease released is kept; take reuses it
    take = lambda holder: j("select tally_lease_take(%s, %s, %s, null, 120, '{\"computer\": \"PC\"}')::text" % (q(F), q(B), q(holder)))
    ok(take("go-a")["held"] is False, "go-a takes the lease")
    ok(take("go-b")["held"] is True, "go-b is held off")
    r = j("select tally_lease_release(%s, %s, 'go-a')::text" % (q(F), q(B)))
    lease = db.rows("select holder, released_at, until > now() as live from tally_company_lease where book_id = %s" % q(B))
    ok(r["released"] is True and len(lease) == 1 and lease[0]["released_at"] != "", "released: the row kept with released_at (%s)" % lease)
    ok(j("select tally_lease_release(%s, %s, 'go-a')::text" % (q(F), q(B)))["released"] is False, "released again: nothing to release")
    ok(take("go-b")["held"] is False and db.rows("select holder, released_at from tally_company_lease where book_id = %s" % q(B)) == [{"holder": "go-b", "released_at": ""}], "go-b takes the released row (updated in place, released_at cleared)")
    db.sql("update tally_company_lease set until = now() - interval '1 second'")
    ok(take("go-a")["held"] is False and db.one("select holder from tally_company_lease where book_id = %s" % q(B)) == "go-a", "an expired lease is free too")
    ok(int(db.one("select count(*) from tally_company_lease")) == 1, "one lease row throughout")

    # 8. item 10: clear the baseline
    g = lambda guid, alt: j("select tally_sync_guard(%s, %s, %s, %s, 10, null, 'go-a')::text" % (q(F), q(B), q(guid), alt))
    g("GU1", 100); r = g("GU1", 90)
    ok(r["state"] == "needs_baseline", "the cursor is needs_baseline")
    good, out = as_user(OWNER, "select tally_baseline_clear(%s, '  ')" % q(B))
    ok(not good and "note" in out, "an empty note is refused")
    good, out = as_user(STAFF, "select tally_baseline_clear(%s, 'fresh baseline done')" % q(B))
    ok(not good and "only an owner" in out, "a staff member is refused")
    good, out = as_user(OTHER, "select tally_baseline_clear(%s, 'fresh baseline done')" % q(B))
    ok(not good, "another firm's owner is refused (%s)" % out.strip()[-80:])
    good, out = as_anon("select tally_baseline_clear(%s, 'x')" % q(B))
    ok(not good, "anon is refused")
    good, out = as_user(OWNER, "select tally_baseline_clear(%s, 'fresh baseline taken on 03-Oct')::text" % q(B))
    cur = db.rows("select state, cleared_by, cleared_note, cleared_at from tally_sync_cursor where book_id = %s" % q(B))[0]
    ok(good and cur["state"] == "ok" and cur["cleared_by"] == OWNER and cur["cleared_note"] == "fresh baseline taken on 03-Oct" and cur["cleared_at"] != "", "the owner clears it with a note; who and when kept (%s)" % cur)
    ok(g("GU1", 95)["state"] == "ok", "reads go on from there")

    # 9. item 23: withdraw a version
    rel = lambda: db.rows("select version, pilot_device, approved_at, withdrawn_at, withdrawn_by, withdrawn_why, note from tally_bridge_releases where firm_id = %s and version = '2.1.5'" % q(F))[0]
    good, out = as_user(OWNER, "select tally_release_pilot('2.1.5', %s)::text" % q(D1))
    ok(good, "pilot started")
    good, out = as_user(STAFF, "select tally_release_withdraw('2.1.5', 'bad build')")
    ok(not good and "only an owner" in out, "withdraw: a staff member is refused")
    good, out = as_user(OWNER, "select tally_release_withdraw('2.1.5', '')")
    ok(not good and "reason" in out, "withdraw: a reason is needed")
    good, out = as_user(OWNER, "select tally_release_withdraw('9.9.9', 'x')")
    ok(not good, "withdraw: an unknown version is refused")
    good, out = as_user(OWNER, "select tally_release_withdraw('2.1.5', 'figures wrong on NWS144')::text")
    r9 = rel()
    ok(good and r9["withdrawn_at"] != "" and r9["withdrawn_by"] == OWNER and r9["withdrawn_why"] == "figures wrong on NWS144", "withdrawn with who/when/why (%s)" % {k: r9[k] for k in ("withdrawn_by", "withdrawn_why")})
    good, out = as_user(OWNER, "select tally_release_withdraw('2.1.5', 'again')::text")
    ok(good and json.loads(out).get("already") is True and rel()["withdrawn_why"] == "figures wrong on NWS144", "withdrawn twice: the first stays")
    good, out = as_user(OWNER, "select tally_release_approve('2.1.5')")
    ok(not good and "withdrawn" in out, "approve refuses a withdrawn version (%s)" % out.strip()[-120:])
    good, out = as_user(OWNER, "select tally_release_pilot('2.1.5', %s)::text" % q(D1))
    r9 = rel()
    ok(good and json.loads(out).get("already") is None and r9["withdrawn_at"] == "" and r9["withdrawn_by"] == "" and "figures wrong on NWS144" in r9["note"], "a new pilot clears the withdrawal and records it in note (%s)" % r9["note"])
    good, out = as_user(OWNER, "select tally_release_approve('2.1.5')")
    ok(not good and "working day" in out, "approve after the new pilot: back to the working-day rule")
    # an approved version withdrawn: the approval goes with it on the next pilot
    db.sql("update tally_bridge_releases set approved_at = now(), approved_by = %s where version = '2.1.5'" % q(OWNER))
    good, out = as_user(OWNER, "select tally_release_withdraw('2.1.5', 'pulled back after approval')::text")
    ok(good and rel()["withdrawn_at"] != "", "an approved version can be withdrawn")
    good, out = as_user(OWNER, "select tally_release_pilot('2.1.5', %s)::text" % q(D2))
    r9 = rel()
    ok(good and r9["approved_at"] == "" and r9["withdrawn_at"] == "" and r9["pilot_device"] == D2 and "approved" in r9["note"], "a new pilot on a withdrawn approved version: approval cleared and noted")
    ok(int(db.one("select count(*) from tally_bridge_releases")) == 1, "one release row throughout")
    ok(fails_with("delete from tally_bridge_releases where version = '2.1.5'", ["kept"])[0], "release rows cannot be deleted")

    # 10. runs once more over everything
    r = psql_file(M37); ok(r.returncode == 0, "migration-37 runs a third time over used tables %s" % ((r.stderr or "").strip()[-300:] if r.returncode else ""))
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
