"""python3 run_migration107.py - migration-107-fast-reports (26-Oct-2026, branch next-fast-reports; NOT run on staging) on a
throwaway PostgreSQL (pg_stand via assistant_stand, port 31070 unless PG107_PORT; never a real database), after the
assistant's chain (77, 82, 84-88, 96) as on staging, with the made-up books of tests/fixtures/books and a book of the
largest staging size (4,002 ledgers, 4,000 entries, 3,800 kept items, 7,000 more of other clients):
  0. the file: one transaction, lock_timeout 10 s; add-only; names no real database; md5 printed
  1. runs, and runs a second time
  2. the same answers: every row of asst_led and the answer of 25 book tools, for both books, before and after; the
     policies of records, clients and tally_bills let the same rows through and refuse the same writes
  3. tally_mis_head is '' exactly for chains with none of the six P&L groups asst_led checks
  4. what changed: the indexes, the policies wrapped, asst_led / asst_pl_head with the same signature, volatility,
     security, search_path and grants
  5. faster: asst_led and the Assistant's tools timed before and after (asst_led at least twice as fast); EXPLAIN
     costs of the client_book_items reads
RED_WITHOUT_107=1: the same checks without running the file (4 and 5 fail)."""
import os, re, sys, time, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A
M = os.path.join(HERE, "..", "server", "assistant", "migration-107-fast-reports.sql")
RED = os.environ.get("RED_WITHOUT_107") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\s", code) and "delete from" not in code and "truncate" not in code and not re.search(r"^\s*update\s", code, re.M)
   and not re.search(r"alter\s+table", code) and "concurrently" not in code, "add-only (no drop, delete, update, alter table)")
ok(len(re.findall(r"create index if not exists", code)) == 2 and len(re.findall(r"create or replace function", code)) == 2, "two indexes (if not exists), two functions replaced")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")
ok("grant execute on function public.asst_pl_head(text, text[], jsonb), public.asst_led(text, uuid) to authenticated, service_role;" in text, "explicit grants")

F = A.FIRM
BIG, BK = "zz-big", "00000000-0000-4000-8000-0000000000f1"
BIG_BOOK = f"""
insert into clients (id, firm_id, name) values ('{BIG}', '{F}', 'Big Books Co');
insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('{BK}', '{F}', '{BIG}', 'Big Books Co', '2026-04-01', '2026-04-01');
insert into tally_ledgers (book_id, firm_id, name, parent, open, chain)
  select '{BK}'::uuid, '{F}'::uuid, 'Supplier ' || g, 'Sundry Creditors', 0::numeric, array['Sundry Creditors', 'Current Liabilities'] from generate_series(1, 2500) g
  union all select '{BK}', '{F}', 'Expense ' || g, 'Indirect Expenses', 0, array['Indirect Expenses'] from generate_series(1, 600) g
  union all select '{BK}', '{F}', 'Staff Salary ' || g, 'Employee Costs', 0, array['Employee Costs'] from generate_series(1, 200) g
  union all select '{BK}', '{F}', 'Other Income ' || g, 'Misc Receipts', 0, array['Misc Receipts'] from generate_series(1, 200) g
  union all select '{BK}', '{F}', 'Customer ' || g, 'Sundry Debtors', 0, array['Sundry Debtors', 'Current Assets'] from generate_series(1, 500) g
  union all select * from (values ('{BK}'::uuid, '{F}'::uuid, 'TDS Payable 194C', 'Duties & Taxes', 0::numeric, array['Duties & Taxes', 'Current Liabilities']),
                                  ('{BK}', '{F}', 'Kotak Bank', 'Bank Accounts', 0, array['Bank Accounts', 'Current Assets'])) z;
insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, narration, cancelled, optional)
  select '{BK}', '{F}', 'big-' || g, date '2026-04-01' + (g % 190), 'Journal', 'J' || g, 'Supplier ' || (1 + g % 2500), 'freight', false, false from generate_series(1, 4000) g;
insert into tally_lines (book_id, firm_id, guid, day, ledger, amount)
  select '{BK}', '{F}', 'big-' || g, date '2026-04-01' + (g % 190), x.l, x.a from generate_series(1, 4000) g,
    lateral (values ('Expense ' || (1 + g % 600), -10000.00), ('Supplier ' || (1 + g % 2500), case when g % 3 = 0 then 9800.00 else 10000.00 end),
                    ('TDS Payable 194C', case when g % 3 = 0 then 200.00 else 0 end)) x(l, a) where x.a <> 0;
insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select '{BK}', '{F}', ledger, day, sum(amount), sum(greatest(-amount, 0)), sum(greatest(amount, 0)), count(*) from tally_lines where book_id = '{BK}' group by ledger, day;
insert into client_book_items (firm_id, client_id, key, item, data, seq)
  select '{F}'::uuid, '{BIG}', 'ledInfo', '.Supplier ' || g, ('{{"pan": "AAAPA' || lpad(g::text, 4, '0') || 'A", "msme": "' || case when g % 7 = 0 then 'micro' else '' end || '"}}')::jsonb, g from generate_series(1, 1100) g
  union all select '{F}', '{BIG}', 'map', '.Expense ' || g, '{{"kind": ""}}', 2000 + g from generate_series(1, 400) g
  union all select '{F}', '{BIG}', 'map', '.TDS Payable 194C', '{{"kind": "tds_payable", "section": "194-C"}}', 3000
  union all select '{F}', '{BIG}', 'groupInfo', '.Employee Costs', '{{"rev": true, "dr": true}}', 3001
  union all select '{F}', '{BIG}', 'groupInfo', '.Misc Receipts', '{{"rev": true, "dr": false, "gp": false}}', 3002
  union all select '{F}', '{BIG}', 'gone', 'g' || g, ('{{"x": "' || repeat('y', 600) || '"}}')::jsonb, 4000 + g from generate_series(1, 1300) g;
-- other clients of the firm, as on staging (11,400 kept items in all)
insert into client_book_items (firm_id, client_id, key, item, data, seq)
  select '{F}', 'other-' || (g % 6), case when g % 3 = 0 then 'ledInfo' else 'map' end, '.L' || g, '{{"pan": ""}}', g from generate_series(1, 7000) g;
"""
# records, the clients' write policies and tally_bills as on staging (columns, keys, grants and policies read there on 26-Oct-2026)
SYNC = f"""
create table if not exists records (firm_id uuid, client_id text default '', kind text, id text, data jsonb default '{{}}'::jsonb, updated_at timestamptz default now(), updated_by uuid,
  deleted boolean default false, deleted_at timestamptz, deleted_by uuid, delete_reason text, restored_at timestamptz, restored_by uuid, primary key (firm_id, kind, id));
create index if not exists records_client_idx on records (firm_id, client_id, kind);
create index if not exists records_pull_idx on records (firm_id, updated_at);
alter table records enable row level security;
create policy records_read on records for select to authenticated using (((firm_id = my_firm()) OR is_superadmin()));
create policy records_update on records for update to authenticated using ((((firm_id = my_firm()) AND can_write()) OR is_superadmin())) with check (((firm_id = my_firm()) OR is_superadmin()));
create policy records_write on records for insert to authenticated with check ((((firm_id = my_firm()) AND can_write()) OR is_superadmin()));
grant select (client_id, data, delete_reason, deleted, deleted_at, deleted_by, firm_id, id, kind, restored_at, restored_by, updated_at, updated_by) on records to authenticated;
grant insert (client_id, data, deleted, firm_id, id, kind) on records to authenticated;
grant update (client_id, data, delete_reason, deleted, firm_id, id, kind) on records to authenticated;
alter table clients add column if not exists data jsonb, add column if not exists tally_name text;
create policy clients_update on clients for update to authenticated using ((((firm_id = my_firm()) AND can_write()) OR is_superadmin())) with check (((firm_id = my_firm()) OR is_superadmin()));
create policy clients_write on clients for insert to authenticated with check ((((firm_id = my_firm()) AND can_write()) OR is_superadmin()));
grant insert, update on clients to authenticated;
create table if not exists tally_bills (book_id uuid, firm_id uuid, guid text, day date, ledger text, name text default '', type text default '', amount numeric, bill_date date, credit_days integer, due date, id bigserial primary key);
alter table tally_bills enable row level security;
create policy tally_bills_read on tally_bills for select to authenticated using ((firm_id = my_firm()));
grant select on tally_bills to authenticated;
insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount) select '{BK}', '{F}', 'big-' || g, date '2026-04-01' + (g % 190), 'Supplier ' || (1 + g % 2500), 'B' || g, 'New Ref', 10000 from generate_series(1, 2300) g;
insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount) select '{A.OTHER_BOOK}', '{A.OTHER}', 'o-' || g, '2026-05-01', 'X', 'B' || g, 'New Ref', 1 from generate_series(1, 50) g;
insert into records (firm_id, client_id, kind, id, data) select '{F}', '{BIG}', 'bank_rows', 'r' || g, jsonb_build_object('rows', (select jsonb_agg(jsonb_build_object('d', '2026-05-0' || (1 + i % 9), 'n', 'NEFT PAYMENT TO SUPPLIER ' || i || ' REF ' || md5(i::text), 'a', i * 13.5)) from generate_series(1, 1500) i)) from generate_series(1, 14) g;
insert into records (firm_id, client_id, kind, id, data) select '{F}', '{BIG}', 'entry', 'e' || g, jsonb_build_object('n', g) from generate_series(1, 60) g;
insert into records (firm_id, client_id, kind, id, data) select '{A.OTHER}', 'zz', 'entry', 'o' || g, '{{}}' from generate_series(1, 15) g;
-- client_book_items' read policy as on staging (a member's firm OR a platform admin): the OR keeps firm_id out of the index
alter policy client_book_items_read on client_book_items using ((firm_id = (select my_firm())) or (select is_superadmin()));
analyze;
"""
def tools(c):
    return ["asst_find_ledgers('%s', null, null, null)" % c, "asst_find_ledgers('%s', 'supplier 1', null, null)" % c, "asst_find_ledgers('%s', null, 'expenses', null)" % c,
            "asst_profit_loss('%s', null, null)" % c, "asst_expenses('%s', null, null, 50)" % c, "asst_tds_missed('%s', null, null, null)" % c, "asst_tds_missed('%s', null, null, '194C')" % c,
            "asst_tds_deductees('%s', null, null, null)" % c, "asst_due_list('%s', null, null)" % c, "asst_tds_late('%s', null, null)" % c, "asst_payroll('%s', null, null)" % c,
            "asst_cash_bank('%s', null)" % c, "asst_turnover('%s', null, null)" % c, "asst_sales_by_month('%s', null, null)" % c, "asst_msme_43bh('%s', null, null)" % c,
            "asst_rcm('%s', null, null)" % c, "asst_purchase_register('%s', null, null, null)" % c, "asst_payments_list('%s', null, null, null)" % c, "asst_duplicates('%s', null, null)" % c,
            "asst_round_sums('%s', null, null, null)" % c, "asst_cash_40a3('%s', null, null)" % c, "asst_cash_269st('%s', null, null)" % c, "asst_top_parties('%s', 'supplier', 'amount', null, null, 10)" % c,
            "asst_books('%s')" % c, "asst_data_version('%s')" % c]
LED = "select coalesce(md5(string_agg(x::text, '|' order by x.name)), '-') || ':' || count(*) from asst_led('%s', '%s') x"
def ask(q, uid=A.ME):
    try: return A.ask(db, q, uid)
    except RuntimeError as e: return "ERROR " + re.sub(r"\s+", " ", str(e))[:200]
def try_write(q, uid):
    # a write as the member, rolled back: what it did or why it was refused
    try: return " ".join(sorted(A.ask(db, "begin; " + q + "; rollback;", uid).split())) or "done"      # the rows it wrote, in any order
    except RuntimeError as e: return "refused: " + re.sub(r"\s+", " ", str(e))[:120]
WRITES = [("insert into records (firm_id, client_id, kind, id, data) values ('%s', 'zz-big', 'entry', 'new1', '{\"a\":1}') returning id" % F),
          ("insert into records (firm_id, client_id, kind, id, data) values ('%s', 'zz', 'entry', 'new2', '{}') returning id" % A.OTHER),
          ("insert into records (firm_id, client_id, kind, id, data) values ('%s', 'zz-big', 'entry', 'e1', '{\"a\":2}') on conflict (firm_id, kind, id) do update set data = excluded.data returning id" % F),
          ("update records set data = '{\"b\":1}' where kind = 'entry' returning id"),
          ("update clients set name = name || ' x' returning id"),
          ("insert into clients (id, firm_id, name) values ('nc', '%s', 'New') returning id" % F)]
def snapshot():
    out = {}
    for c, bk in ((A.CLIENT, A.BOOK), (BIG, BK)):
        out["led " + c] = ask(LED % (c, bk))
        for t in tools(c): out[t] = ask("select %s" % t)
    for u in (A.ME, A.STAFF, A.VIEWER, A.STRANGER):
        out["seen by " + u] = ask("select (select count(*) || '/' || coalesce(md5(string_agg(kind || id || data::text, ',' order by kind, id)), '') from records) || ' ' || (select count(*) from tally_bills) || ' ' || (select count(*) from clients)", u)
        for w in WRITES: out["write %s %d" % (u, WRITES.index(w))] = try_write(w, u)
    return out
def pg(q): return db._psql(["-t", "-A"], q).strip()      # as postgres
def timed(q, n=3):
    # "(console)": as postgres, past row-level security, as the Supabase SQL console ran it; else as a member
    best = 1e9
    for _ in range(n):
        s = time.time(); pg(q[len("(console)"):]) if q.startswith("(console)") else ask(q); best = min(best, time.time() - s)
    return best
UPSERT = ("insert into records (firm_id, client_id, kind, id, data) select '%s', 'zz-big', 'bank_rows', 'r' || g, jsonb_set(data, '{v}', to_jsonb(clock_timestamp()::text)) from records where kind = 'bank_rows' and firm_id = '%s' "
          "on conflict (firm_id, kind, id) do update set data = excluded.data, client_id = excluded.client_id" % (F, F)).replace("'r' || g", "id")
TIMES = [("asst_led, 4,002 ledgers", "select count(*) from asst_led('%s', '%s')" % (BIG, BK)),
         ("asst_find_ledgers", "select asst_find_ledgers('%s', 'supplier 1', null, null) is not null" % BIG),
         ("asst_due_list", "select asst_due_list('%s', null, null) is not null" % BIG),
         ("asst_tds_late", "select asst_tds_late('%s', null, null) is not null" % BIG),
         ("asst_tds_missed", "select asst_tds_missed('%s', null, null, null) is not null" % BIG),
         ("asst_profit_loss", "select asst_profit_loss('%s', null, null) is not null" % BIG),
         ("asst_data_version", "select asst_data_version('%s')" % BIG),
         ("client_book_items pull (app)", "select count(*) from (select key, item, ord, data, deleted, seq, updated_at, updated_by from client_book_items where client_id = '%s' and seq > 0 order by seq limit 1000) x" % BIG),
         ("records pull (app, 200)", "select count(*) from (select kind, id, client_id, data, deleted, updated_at from records where updated_at > '1970-01-01' order by updated_at limit 200) x"),
         ("records upsert 14 bank chunks (app)", "begin; " + UPSERT + "; rollback;"),
         ("tally_bills of a book", "select count(*) from tally_bills where book_id = '%s'" % BK),
         ("ad hoc TDS check (console, 26.7 s on staging)", """(console)with b as (select book_id, client_id from tally_books where client_id in ('zz-big', 'larkspur')),
tdsl as (select i.client_id, substr(i.item, 2) item from client_book_items i where i.key = 'ledInfo' and not i.deleted and i.data->>'msme' = 'micro' and i.client_id in ('zz-big', 'larkspur')),
v as (select b.client_id, v.* from tally_vouchers v join b using (book_id) where v.deleted_at is null and not coalesce(v.cancelled, false) and not coalesce(v.optional, false))
select v.client_id, count(*) from v where exists (select 1 from tally_lines l join tdsl t on t.item = l.ledger and t.client_id = v.client_id where l.book_id = v.book_id and l.guid = v.guid) group by 1"""),
         ("ad hoc TDS check, exact name (21.1 s on staging)", """(console)with b as (select book_id, client_id from tally_books where client_id in ('zz-big', 'larkspur')),
tdsl as (select i.client_id, i.item from client_book_items i where i.key = 'ledInfo' and not i.deleted and i.data->>'msme' = 'micro' and i.client_id in ('zz-big', 'larkspur')),
v as (select b.client_id, v.* from tally_vouchers v join b using (book_id) where v.deleted_at is null and not coalesce(v.cancelled, false) and not coalesce(v.optional, false))
select v.client_id, count(*) from v where exists (select 1 from tally_lines l join tdsl t on t.item = '.' || l.ledger and t.client_id = v.client_id where l.book_id = v.book_id and l.guid = v.guid) group by 1""")]
COSTS = [("client_book_items pull, the next changes", TIMES[7][1].replace("seq > 0", "seq > 5250")), ("client_book_items pull, all", TIMES[7][1]), ("asst_data_version's max(seq)", "select max(seq) from client_book_items where client_id = '%s'" % BIG),
         ("asst_led's ledInfo", "select count(*) from client_book_items i where i.client_id = '%s' and i.key = 'ledInfo' and i.item like '.%%' and not i.deleted" % BIG),
         ("records pull", TIMES[8][1]), ("ad hoc TDS check (console)", TIMES[11][1]), ("ad hoc TDS check, exact name (console)", TIMES[12][1])]
def cost(q):
    p = pg("explain " + q[len("(console)"):]) if q.startswith("(console)") else ask("explain " + q)
    m = re.search(r"cost=[\d.]+\.\.([\d.]+)", p)
    return float(m.group(1)) if m else -1

db = A.start(int(os.environ.get("PG107_PORT") or 31070))
try:
    A.migrate(db); A.load_fixture(db)
    db.sql(BIG_BOOK + SYNC)
    before = snapshot()
    t0 = {k: timed(q) for k, q in TIMES}
    c0 = {k: cost(q) for k, q in COSTS}
    print("== 1. runs twice")
    if not RED:
        def run():
            try: db.sql(text); return ""
            except RuntimeError as e: return str(e)[-400:]
        e1 = run(); e2 = run()
        ok(not e1 and not e2, "the file runs, and runs again" + (": " + (e1 or e2) if e1 or e2 else ""))
    db.sql("analyze;")
    after = snapshot()
    print("== 2. the same answers")
    diff = [k for k in before if before[k] != after[k]]
    for k in diff[:8]: print("       %s\n         before %s\n         after  %s" % (k, before[k][:300], after[k][:300]))
    ok(not diff, "every answer the same, before and after (%d compared: asst_led rows and 25 tools for 2 books, records / clients / tally_bills as 4 members)" % len(before))
    ok(before["led zz-big"].endswith(":4002") and before["led " + A.CLIENT].split(":")[1] not in ("0", ""), "both books have their ledgers (%s; %s)" % (before["led zz-big"], before["led " + A.CLIENT]))
    errs = [k for k in before if before[k].startswith("ERROR")]
    print("       (answers that are an error both times, compared as such: %s)" % (", ".join(e.split("(")[0] for e in errs) or "none"))
    w = {k: v for k, v in after.items() if k.startswith("write ")}
    for k, v in w.items(): print("       %s (%s): %s" % (k.replace("aaaaaaaa-0000-4000-8000-00000000000", "member "), WRITES[int(k.split()[-1])][:50], v[:70]))
    ok(w["write %s 0" % A.VIEWER].startswith("refused") and not w["write %s 0" % A.STAFF].startswith("refused")
       and w["write %s 1" % A.ME].startswith("refused") and after["seen by " + A.STRANGER].startswith("15/"), "a viewer may not write, staff may, nobody writes or reads another firm's records")
    print("== 3. the P&L groups asst_led checks are tally_mis_head's")
    six = ['sales accounts', 'direct incomes', 'indirect incomes', 'purchase accounts', 'direct expenses', 'indirect expenses']
    groups = six + ['Sales Accounts', 'INDIRECT EXPENSES', 'Bank Accounts', 'Bank OD A/c', 'Branch / Divisions', 'Capital Account', 'Cash-in-Hand', 'Current Assets', 'Current Liabilities',
              'Deposits (Asset)', 'Duties & Taxes', 'Fixed Assets', 'Investments', 'Loans & Advances (Asset)', 'Loans (Liability)', 'Misc. Expenses (ASSET)', 'Provisions',
              'Reserves & Surplus', 'Secured Loans', 'Stock-in-Hand', 'Sundry Creditors', 'Sundry Debtors', 'Suspense A/c', 'Unsecured Loans', 'Employee Costs', 'Direct Expense', 'sales account']
    bad = [g for g in groups for n in ('Salary', 'Interest Paid', 'Depreciation', 'Rent') if (ask("select tally_mis_head(%s, array[%s, 'Primary'])" % (A.q(n), A.q(g))) != "") != (g.lower() in six)]
    ok(not bad, "tally_mis_head is '' exactly for chains without the six groups (%d groups x 4 names)" % len(groups) + (": " + ", ".join(bad[:5]) if bad else ""))
    print("== 4. what changed")
    ok(ask("select string_agg(indexname, ',' order by indexname) from pg_indexes where tablename = 'client_book_items' and indexname in ('client_book_items_client_key', 'client_book_items_client_seq')")
       == "client_book_items_client_key,client_book_items_client_seq", "client_book_items: indexes by client (key, item) and (seq)")
    pol = pg("select string_agg(policyname || '=' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\\n' order by policyname) from pg_policies where tablename in ('records', 'clients', 'tally_bills') and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(my_firm|can_write|is_superadmin)'")
    bare = [l.split("=")[0] for l in pol.splitlines() if re.search(r"(?<!SELECT )(my_firm|can_write|is_superadmin)\(\)", l)]
    ok(not bare and pol.count("\n") >= 5, "the records, clients and tally_bills policies work out my_firm(), can_write(), is_superadmin() once a statement" + (": still per row in " + ", ".join(bare) if bare else ""))
    sig = pg("select string_agg(p.proname || ' ' || pg_get_function_identity_arguments(p.oid) || ' -> ' || pg_get_function_result(p.oid) || ' ' || p.provolatile::text || p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') || ' ' || array_to_string(array(select a::text from unnest(p.proacl) a order by 1), ','), E'\\n' order by p.proname) from pg_proc p where p.proname in ('asst_led', 'asst_pl_head')")
    print("       " + sig.replace("\n", "\n       "))
    ok("asst_led p_client text, p_book uuid -> TABLE(name text" in sig and " sfalse search_path=public, pg_temp" in sig and "asst_pl_head p_name text, p_chain text[], p_top jsonb -> text ifalse search_path=public, pg_temp" in sig
       and sig.count("authenticated=X") == 2 and "anon" not in sig and "=X/" in sig and not re.search(r"(^|,)=X", sig), "asst_led / asst_pl_head: same signature, STABLE / IMMUTABLE, invoker, search_path; members and the service role, never anon or public")
    src = pg("select prosrc from pg_proc where proname = 'asst_led'")
    ok(src.count("asst_pl_head(") == 2 and "ph.h = 'emp', ph.h" in src, "asst_led: the P&L head worked out once a ledger (%s)" % ("new text" if "ph.h" in src else "old text"))
    print("== 5. faster")
    t1 = {k: timed(q) for k, q in TIMES}
    c1 = {k: cost(q) for k, q in COSTS}
    for k, _ in TIMES: print("       %-48s %7.0f ms -> %7.0f ms" % (k, t0[k] * 1000, t1[k] * 1000))
    for k, _ in COSTS: print("       EXPLAIN cost %-35s %9.1f -> %9.1f" % (k, c0[k], c1[k]))
    ok(t1["asst_led, 4,002 ledgers"] * 2 < t0["asst_led, 4,002 ledgers"], "asst_led at least twice as fast (%.0f -> %.0f ms)" % (t0["asst_led, 4,002 ledgers"] * 1000, t1["asst_led, 4,002 ledgers"] * 1000))
    plan = ask("explain " + COSTS[0][1])
    ok(re.search(r"Index Cond: \(\(client_id = '%s'::text\) AND \(seq > 5250\)\)" % BIG, plan) is not None and "client_book_items_client_seq" in plan
       and c1["asst_data_version's max(seq)"] < c0["asst_data_version's max(seq)"] / 2, "client_book_items by client: the app's next changes and max(seq) a seek on (client_id, seq), not the whole index")
    ok(t1["ad hoc TDS check, exact name (21.1 s on staging)"] * 10 < t0["ad hoc TDS check, exact name (21.1 s on staging)"], "a client's ledger looked up by name in client_book_items: a seek on (client_id, key, item)")
finally:
    db.stop()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
