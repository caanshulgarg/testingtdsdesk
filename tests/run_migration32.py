"""python3 run_migration32.py - migration-32-sync-safety (FinCom Bridge 2.1.4 as rebuilt on 02-Oct-2026). On a throwaway
PostgreSQL (pg_stand) with the cloud tables as on staging (02-Oct-2026) and made-up rows; never on staging.
Checks: the file runs twice without harm and deletes nothing; a FinCom id is live in one posting at a time (the backfill
keeps the first posting of an id live; a second queued posting is refused; cancelled, the id is free; Retry of the first
then refused); the lease (taken, held against another bridge, renewed, expired, released only by its holder, firm-scoped);
the rewind guard (a GUID that changed, an AlterID that went back -> needs_baseline; each read kept); the entry's origin
and its versions (append-only) and the upsert rule; a ledger's Tally GUID unique per company; the balances view; a
signed-in member cannot call the bridge's functions."""
import os, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQL = os.path.join(HERE, "..", "server", "tally-cloud", "migration-32-sync-safety.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SCHEMA = """
drop table if exists tally_books, tally_ledgers, tally_vouchers, tally_lines, tally_ledger_day, tally_post_jobs, tally_post_ids, tally_company_lease,
  tally_sync_cursor, tally_sync_reads, tally_voucher_versions cascade;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('fincom.role', true), ''), 'service_role') $$;
create table tally_books (book_id uuid primary key, firm_id uuid not null references firms(id), client_id text not null, company text not null, from_date date, open_as_on date,
  ledgers_at timestamptz, days_at timestamptz, state jsonb not null default '{}', state_at timestamptz);
create table tally_ledgers (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, name text not null, parent text not null default '',
  open numeric not null default 0, chain text[] not null default '{}', primary_group text not null default '', open_sent numeric, merged_into text, gstin text, pan text,
  primary key (book_id, name));
create table tally_vouchers (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, guid text not null, day date not null, alter_id bigint not null default 0,
  vtype text not null default '', vno text not null default '', party text not null default '', narration text not null default '', cancelled boolean not null default false,
  optional boolean not null default false, gstin text not null default '', pos text not null default '', ref text not null default '', ref_date date, cmp_gstin text not null default '',
  primary key (book_id, guid));
create table tally_ledger_day (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, ledger text not null, day date not null,
  amount numeric not null default 0, dr numeric not null default 0, cr numeric not null default 0, n integer not null default 0, primary key (book_id, ledger, day));
create table tally_post_jobs (id uuid primary key, firm_id uuid not null references firms(id) on delete cascade, client_id text not null, company text not null, device_id uuid,
  payload jsonb not null, n integer not null, status text not null default 'waiting' check (status in ('waiting', 'taken', 'running', 'done', 'failed', 'cancelled')),
  done integer not null default 0, message text not null default '', results jsonb, checking boolean not null default false, created_by uuid, created_at timestamptz not null default now(),
  taken_at timestamptz, updated_at timestamptz not null default now(), attempts integer not null default 0, items jsonb);
"""
F, F2, U = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888", "55555555-5555-5555-5555-555555555555"
B, B2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
def q(s): return "'" + str(s).replace("'", "''") + "'"
def vch(i, tag=True): return {"id": i, "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:%s</NARRATION></VOUCHER>" % i if tag else "<VOUCHER><NARRATION>no tag</NARRATION></VOUCHER>"}
def job(jid, vs, status="waiting", at="2026-10-01"):
    return "insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status, created_at) values (%s, %s, 'c1', 'ZZ CO', %s, %d, %s, %s);" % (
        q(jid), q(F), q(json.dumps({"vouchers": vs})), len(vs), q(status), q(at))
J = lambda n: "%08d-0000-0000-0000-000000000000" % n

db = pg_stand.start(55443)
try:
    db.sql(SCHEMA)
    db.sql("insert into firms values (%s, 'Firm'), (%s, 'Other') on conflict do nothing; insert into members values (%s, %s, 'Me', 'owner', true);" % (q(F), q(F2), q(U), q(F)))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%s, %s, 'c9', 'OTHER', '2026-04-01', '2026-03-31');" % (q(B), q(F), q(B2), q(F2)))
    # postings queued before the migration: X1 in two live jobs (the older stays live), X2 in a cancelled one, one untagged
    db.sql(job(J(1), [vch("X1"), vch("X2")], "done", "2026-09-01") + job(J(2), [vch("X1")], "waiting", "2026-09-02") + job(J(3), [vch("X3")], "cancelled") + job(J(4), [vch("e-4.z", tag=False)], "waiting"))
    db.sql("""insert into tally_ledgers (book_id, firm_id, name, parent, open, primary_group) values (%(B)s, %(F)s, 'Cash', 'Cash-in-Hand', -1000, 'Current Assets'), (%(B)s, %(F)s, 'Sales', 'Sales Accounts', 0, 'Sales Accounts');
      insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, narration) values (%(B)s, %(F)s, 'g-1', '2026-05-01', 7, 'cash sale');
      insert into tally_ledger_day (book_id, firm_id, ledger, day, amount) values (%(B)s, %(F)s, 'Cash', '2026-05-01', -250), (%(B)s, %(F)s, 'Sales', '2026-05-01', 250), (%(B)s, %(F)s, 'Cash', '2026-03-01', -99);""" % {"B": q(B), "F": q(F)})
    counts = lambda: {t: db.one("select count(*) from %s" % t) for t in ["tally_post_jobs", "tally_vouchers", "tally_ledgers", "tally_ledger_day", "tally_books"]}
    before = counts()
    # 1. the file as the owner runs it (psql, stop at the first error), twice
    for i in (1, 2):
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                            "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(SQL).read(), capture_output=True, text=True)
        ok(r.returncode == 0, "the file runs (run %d) %s" % (i, (r.stderr or "").strip()[-300:] if r.returncode else ""))
    ok(counts() == before, "nothing deleted (%s)" % counts())
    j = lambda s, uid=None: json.loads(db.one(s, uid))

    # 2. the FinCom id: one live posting per id
    live = {(r["fincom_id"], r["job_id"]): r["live"] for r in db.rows("select fincom_id, job_id, live from tally_post_ids")}
    ok(live.get(("X1", J(1))) == "t" and live.get(("X1", J(2))) == "f" and live.get(("X2", J(1))) == "t" and live.get(("X3", J(3))) == "f" and live.get(("e4z", J(4))) == "t",
       "the backfill: the first posting of X1 live, the second not; cancelled not live; an untagged entry by its id (%s)" % sorted(live.items()))
    try:
        db.sql(job(J(5), [vch("X2")]))
        ok(False, "a second posting of X2 was queued")
    except RuntimeError as e:
        ok("already being posted" in str(e), "a second posting of the same FinCom id is refused")
    db.sql(job(J(6), [vch("X3")]))
    ok(db.one("select live from tally_post_ids where job_id = %s" % q(J(6))) == "t", "an id whose posting was cancelled may be queued again")
    try:
        db.sql("update tally_post_jobs set status = 'waiting' where id = %s" % q(J(3)))
        ok(False, "Retry of the cancelled posting went through while X3 is live elsewhere")
    except RuntimeError as e:
        ok("already being posted" in str(e), "Retry of the cancelled posting is refused while another posting has the id")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(6)))
    ok(db.one("select live from tally_post_ids where job_id = %s" % q(J(6))) == "f", "a failed posting frees its ids")

    # 3. the lease
    take = lambda holder, firm=F, book=B: j("select tally_lease_take(%s, %s, %s, null, 120, '{\"computer\": \"PC-%s\"}')" % (q(firm), q(book), q(holder), holder[-1]))
    a = take("go-a")
    ok(a["held"] is False and "until" in a["lease"], "taken by go-a")
    b = take("go-b")
    ok(b["held"] is True and b["holder"]["bridge"] == "go-a" and b["holder"]["computer"] == "PC-a", "go-b is told go-a holds it (%s)" % b)
    ok(take("go-a")["held"] is False, "go-a renews its own")
    db.sql("update tally_company_lease set until = now() - interval '1 second'")
    ok(take("go-b")["held"] is False and db.one("select holder from tally_company_lease") == "go-b", "expired: go-b takes it")
    ok(j("select tally_lease_release(%s, %s, 'go-a')" % (q(F), q(B)))["released"] is False, "only the holder releases it")
    ok(j("select tally_lease_release(%s, %s, 'go-b')" % (q(F), q(B)))["released"] is True and db.one("select count(*) from tally_company_lease") == "0", "released by its holder")
    try:
        take("go-a", firm=F2, book=B)
        ok(False, "another firm took the lease")
    except RuntimeError as e:
        ok("no such book" in str(e), "firm-scoped: another firm's book is refused")

    # 4. the rewind guard
    g = lambda guid, alt, n: j("select tally_sync_guard(%s, %s, %s, %s, %s, null, 'go-a')" % (q(F), q(B), q(guid) if guid else "null", alt if alt is not None else "null", n if n is not None else "null"))
    ok(g("G1", None, None)["state"] == "ok" and db.one("select company_guid from tally_sync_cursor") == "G1", "the company list: its GUID kept")
    ok(g("G1", 100, 10)["state"] == "ok" and g("G1", 120, 12)["state"] == "ok", "reads with rising AlterIDs: ok")
    r = g("G1", 90, 12)
    ok(r["state"] == "needs_baseline" and "went back" in r["why"], "an AlterID that went back: needs_baseline (%s)" % r["why"])
    ok(db.one("select count(*) from tally_sync_reads") == "3", "each read kept")
    db.sql("update tally_sync_cursor set state = 'ok', state_why = null")
    r = g("G2", 130, 12)
    ok(r["state"] == "needs_baseline" and "GUID changed" in r["why"], "another GUID: needs_baseline")

    # 5. the entry's origin, its versions and the upsert rule
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, narration) values (%s, %s, 'g-2', '2026-05-02', 8, 'Rent | TDSDesk:abc12')" % (q(B), q(F)))
    ok(db.one("select origin from tally_vouchers where guid = 'g-2'") == "fincom" and db.one("select origin from tally_vouchers where guid = 'g-1'") == "tally", "origin: fincom for a FinCom id, else tally")
    db.sql("delete from tally_vouchers where guid = 'g-2'; insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, narration) values (%s, %s, 'g-2', '2026-05-03', 11, 'Rent | TDSDesk:abc12')" % (q(B), q(F)))
    ok(db.one("select count(*) from tally_voucher_versions where tally_guid = 'g-2'") == "2" and db.one("select count(*) from tally_voucher_versions where tally_guid = 'g-1'") == "1",
       "every version kept (g-2: AlterIDs 8 and 11; g-1 from before)")
    ok(db.one("select tally_voucher_newer(%s, 'g-2', 11)" % q(B)) == "f" and db.one("select tally_voucher_newer(%s, 'g-2', 12)" % q(B)) == "t" and db.one("select tally_voucher_newer(%s, 'g-new', 1)" % q(B)) == "t",
       "the upsert rule: only a higher AlterID")
    try:
        db.sql("update tally_voucher_versions set alter_id = 99 where tally_guid = 'g-2'")
        ok(False, "a version was changed")
    except RuntimeError as e:
        ok("append-only" in str(e), "versions are append-only")
    db.sql("update tally_ledgers set tally_guid = 'L-1' where name = 'Cash'")
    try:
        db.sql("update tally_ledgers set tally_guid = 'L-1' where name = 'Sales'")
        ok(False, "two ledgers took one Tally GUID")
    except RuntimeError as e:
        ok("tally_ledgers_tally_guid" in str(e), "a ledger's Tally GUID is unique in its company")

    # 6. the balances view (entries from the book's start: the March line is before it)
    bal = {r["ledger"]: r for r in db.rows("select ledger, open, movement, closing from tally_balances where book_id = %s" % q(B))}
    ok(float(bal["Cash"]["closing"]) == -1250 and float(bal["Sales"]["closing"]) == 250, "balances: opening plus entries from the start (%s)" % {k: v["closing"] for k, v in bal.items()})

    # 7. a signed-in member cannot reach the bridge's functions
    for f in ["tally_lease_take(%s, %s, 'x', null, 60, '{}')" % (q(F), q(B)), "tally_sync_guard(%s, %s, 'G', 1, 1, null, 'x')" % (q(F), q(B))]:
        try:
            db.sql("set fincom.role = 'authenticated'; select " + f + ";")
            ok(False, "a member called " + f)
        except RuntimeError as e:
            ok("not allowed" in str(e), "a member is refused " + f.split("(")[0])
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
