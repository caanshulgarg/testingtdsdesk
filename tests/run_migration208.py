"""python3 tests/run_migration208.py - migration 208 (Daily Check phase 2) on a throwaway PostgreSQL (pg_stand), after 206 and
207, made-up data only.
  1. it stops before 207, and on a name already used by something else (changing nothing); it runs, and runs again
  2. grants: nothing for public or anon; the page reads daily_trust and calls trust_set / trust_dismiss / trust_stats; only
     the service role runs remind_due / remind_logged
  3. the two checks widened: phase 2's kinds and sources go in, the old ones still do, anything else does not
  4. night_apply with phase 2's findings and entries: ready or held, the same night twice adds nothing, a ledger a person
     picked stays picked
  5. trust levels: the owner only, logged; staff and other firms refused; bad levels and limits refused
  6. trust_stats: approvals since the last rejection, level change or put-off
  8. (review M3) Approve claims an entry first: ready -> approving, one person at a time; approved only by the claimer;
     released when the post fails; a claim left 30 minutes may be taken again; the night leaves it alone
  7. remind_due: only switched-on clients of an active owner, document requests asked once and still needed, at most
     weekly; in real sending only questions really asked; remind_logged logs each
PG_PORT (55473)."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
MIG = os.path.join(HERE, "..", "server", "assistant-night", "migration-206-assistant-night.sql")
MIG207 = os.path.join(HERE, "..", "server", "assistant-night", "migration-207-night-close-drafts.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def raises(fn):
    try: fn(); return False
    except RuntimeError: return True

F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
OWN, STAFF, LOOK, OWN2 = ("aaaaaaaa-0000-0000-0000-00000000000%d" % i for i in (1, 2, 3, 4))
db = pg_stand.start(int(os.environ.get("PG_PORT") or 55473))
try:
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      create extension if not exists pgcrypto;
      -- as on staging: the helpers are security definer with their own search path (the functions here set an empty one)
      create or replace function my_firm() returns uuid language sql stable security definer set search_path = public as $f$ select firm_id from members where user_id = auth.uid() and active $f$;
      create or replace function can_write() returns boolean language sql stable security definer set search_path = public as $f$ select exists (select 1 from members where user_id = auth.uid() and active and role in ('owner', 'staff')) $f$;
      create table if not exists clients (id text, firm_id uuid, name text, deleted boolean default false, status text default 'active');
      grant usage on schema public to authenticated, anon, service_role;
      insert into firms values ('%s', 'Sample & Co'), ('%s', 'Other Firm');
      insert into members (user_id, firm_id, name, role) values ('%s', '%s', 'Owner', 'owner'), ('%s', '%s', 'Staff', 'staff'), ('%s', '%s', 'Look', 'viewer'), ('%s', '%s', 'Owner 2', 'owner');
      insert into clients (id, firm_id, name) values ('c1', '%s', 'Sample Traders'), ('c2', '%s', 'Demo Textiles'), ('c9', '%s', 'No Books');
      insert into tally_books (book_id, firm_id, client_id) values (gen_random_uuid(), '%s', 'c1'), (gen_random_uuid(), '%s', 'c2');
      grant select on firms, members, clients to authenticated;
      create table if not exists auth.users (id uuid primary key, email text);
      insert into auth.users values ('%s', 'owner@samplefirm.example'), ('%s', 'staff@samplefirm.example'), ('%s', 'look@samplefirm.example'), ('%s', 'owner@otherfirm.example');
      -- as Supabase does (review S1): anon and authenticated get every right on what is made from now on
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on functions to anon, authenticated;
      alter default privileges in schema public grant all on sequences to anon, authenticated;""" % (F1, F2, OWN, F1, STAFF, F1, LOOK, F1, OWN2, F2, F1, F1, F1, F1, F1, OWN, STAFF, LOOK, OWN2))
    # staging has the Ask FinCom chat's own assistant_log (its columns, RLS, a policy): migration 206 must not touch it
    db.sql("""create table assistant_log (id bigserial primary key, firm_id uuid, user_id uuid, client_id text, at timestamptz default now(), question text, tools text[], input_tokens int, output_tokens int,
        calls int, ms int, feature text, route text, models text[], cache_read int, cache_write int, cost_inr numeric, fell_through boolean);
      alter table assistant_log enable row level security;
      create policy assistant_log_owner_read on assistant_log for select to authenticated using (firm_id = my_firm());
      insert into assistant_log (firm_id, question, cost_inr) values ('%s', 'made-up question', 1.25);""" % F1)
    chat_before = db.one("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'assistant_log'")
    as_ = lambda uid, q: db.rows("set role authenticated;\n" + q, uid)
    one = lambda uid, q: db.one("set role authenticated;\n" + q, uid)
    act = lambda uid, q: db.sql("set role authenticated;\n" + q, uid)
    # staging's posting queue (migration 199), as much as 208 reads of it
    db.sql("create table if not exists tally_post_jobs (id uuid primary key, firm_id uuid, client_id text, status text, results jsonb); alter table tally_vouchers add column if not exists deleted_at timestamptz")
    MIG208 = os.path.join(HERE, "..", "server", "assistant-night", "migration-208-daily-phase2.sql")
    db.sql(open(MIG).read())
    b208 = open(MIG208).read()
    try: db.sql(b208); stopped = ""
    except RuntimeError as e: stopped = str(e)
    ok("run migration 207 first" in stopped, "1. before 207: stops, saying so")
    db.sql(open(MIG207).read())
    db.sql("create function trust_set(p int) returns int language sql as 'select 1'")
    try: db.sql(b208); stopped = ""
    except RuntimeError as e: stopped = str(e)
    ok("function trust_set" in stopped and db.one("select to_regclass('public.daily_trust')") in (None, "") and "setoff_due" not in db.one("select string_agg(pg_get_constraintdef(oid), ' ') from pg_constraint where conrelid = 'public.night_findings'::regclass and contype = 'c'"),
       "1. a same-named function made by something else: stops naming it, nothing changed (no table, checks as they were)")
    db.sql("drop function trust_set(int)")
    db.sql(b208); db.sql(b208)
    ok(True, "1. runs, and runs again")
    ok(db.one("select count(*) from pg_constraint where conrelid = 'public.night_findings'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'") == "1"
       and db.one("select count(*) from pg_constraint where conrelid = 'public.night_entries'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source%'") == "1", "1. one kind check and one source check each, not two")
    # 2. grants
    tp = lambda role, t, p: db.one("select has_table_privilege('%s', 'public.%s', '%s')" % (role, t, p)) == "t"
    fp = lambda role, f: db.one("select has_function_privilege('%s', 'public.%s', 'execute')" % (role, f)) == "t"
    ok(not any(tp(r, "daily_trust", p) for r in ("anon",) for p in ("select", "insert", "update", "delete")) and tp("authenticated", "daily_trust", "select")
       and not any(tp("authenticated", "daily_trust", p) for p in ("insert", "update", "delete", "truncate", "references", "trigger")), "2. daily_trust: anon nothing; authenticated reads only")
    ok(not db.one("select count(*) from information_schema.role_table_grants where table_name = 'daily_trust' and grantee = 'PUBLIC'") != "0", "2. daily_trust: nothing for public")
    FN = ["trust_set(text, text, integer, numeric)", "trust_dismiss(text, text)", "trust_stats()", "remind_due(boolean)", "remind_logged(uuid, text, bigint, uuid[], text, text)", "trust_kind_of(text)"]
    FN3 = ["entry_claim(uuid)", "entry_release(uuid, text)", "entry_approved(uuid, text)", "entry_unconfirm(uuid, uuid)"]
    ok(all(fp("authenticated", f) for f in FN3) and not any(fp("anon", f) for f in FN3), "2. the page calls entry_claim / entry_release / entry_approved; anon none")
    ok(not any(fp("anon", f) for f in FN), "2. anon runs none of 208's functions")
    ok(all(fp("authenticated", f) for f in FN[:3]) and not any(fp("authenticated", f) for f in FN[3:]), "2. the page calls trust_set, trust_dismiss, trust_stats; not remind_due, remind_logged or the helper")
    ok(fp("service_role", FN[3]) and fp("service_role", FN[4]), "2. the service role runs the reminders")
    ok(db.one("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where n.nspname = 'public' and p.proname in ('trust_set','trust_dismiss','trust_stats','remind_due','remind_logged','trust_kind_of') and a.grantee = 0") == "0", "2. nothing for public on 208's functions")
    # 3. the checks
    def ins_f(kind):
        try: db.sql("insert into night_findings (firm_id, client_id, kind, key, first_seen, last_seen) values ('%s', 'c1', '%s', 'chk:%s', '2026-11-22', '2026-11-22')" % (F1, kind, kind)); return True
        except RuntimeError: return False
    ok(all(ins_f(k) for k in ("setoff_due", "payroll_due", "recurring_due", "ledger_pick", "setoff_exclude", "sent_check", "advance_open")) and not ins_f("made_up_kind"), "3. phase 2's kinds go in, an old one still does, a made-up one does not")
    db.sql("delete from night_findings where key like 'chk:%'")
    def ins_e(src):
        try: db.sql("insert into night_entries (firm_id, client_id, source, dedupe, voucher) values ('%s', 'c1', '%s', 'chk:%s', '{}')" % (F1, src, src)); return True
        except RuntimeError: return False
    ok(all(ins_e(s) for s in ("gst_setoff", "payroll", "recurring", "bank_self_answer", "twob_inbox_bill")) and not ins_e("made_up"), "3. phase 2's sources go in, the old ones still do, a made-up one does not")
    db.sql("delete from night_entries where dedupe like 'chk:%'")
    # 4. night_apply with phase 2
    def apply(findings, entries=(), complete=True, night="2026-11-22"):
        return json.loads(db.one("select public.night_apply('%s', 'c1', '%s', 'v1', '%s'::jsonb, '%s'::jsonb, %s)" % (F1, night, json.dumps(findings).replace("'", "''"), json.dumps(list(entries)).replace("'", "''"), "true" if complete else "false")))
    SO = {"kind": "setoff_due", "key": "setoff:07:202610", "state": "resolved", "facts": {"party": "GST set-off Oct", "amt": 157500, "ask_text": "", "short": "GST set-off Oct 2026"}, "evidence": [{"t": "gst3b", "ref": "3b:07:202610", "label": "GSTR-3B Oct 2026"}]}
    SE = {"finding_key": "setoff_due|setoff:07:202610", "source": "gst_setoff", "dedupe": "setoff:07:202610", "work_ref": "dc-x", "voucher": {"type": "Journal", "lines": [{"ledger": "CGST OUTPUT", "dr": 100}, {"ledger": "CGST INPUT", "cr": 100}]}, "reason": "GST set-off", "why": "x", "evidence": [], "checks": [{"k": "drcr", "ok": True}], "ready": True}
    PK = {"kind": "ledger_pick", "key": "led:tds", "state": "you", "facts": {"party": "TDS on salary", "ask_text": "", "title": "Which ledger is the TDS on salary?"}, "candidates": [{"t": "ledger", "ref": "ledger:tds:TDS A", "label": "TDS A", "ledger": "TDS A"}, {"t": "ledger", "ref": "ledger:tds:TDS B", "label": "TDS B", "ledger": "TDS B"}]}
    PY = {"kind": "payroll_due", "key": "payroll:202610", "state": "you", "facts": {"party": "Payroll Oct", "ask_text": "", "title": "pick", "waits": True}}
    apply([SO, PK, PY], [SE]); apply([SO, PK, PY], [SE])
    ok(db.one("select count(*) from night_findings where client_id = 'c1' and kind in ('setoff_due','ledger_pick','payroll_due')") == "3" and db.one("select count(*) from night_entries where dedupe = 'setoff:07:202610' and state = 'ready'") == "1", "4. the same night twice: three findings, one ready set-off entry")
    ok(db.one("select count(*) from client_asks a join night_findings n on n.id = a.finding_id where n.kind in ('setoff_due','ledger_pick','payroll_due')") == "0", "4. phase 2's findings never make a question to the client")
    apply([dict(SO, state="resolved"), PK, PY], [dict(SE, ready=False)])
    ok(db.one("select state from night_entries where dedupe = 'setoff:07:202610'") == "held", "4. a check failed: held, not ready")
    pid = db.one("select id from night_findings where kind = 'ledger_pick'")
    act(STAFF, "select public.finding_choose('%s', 'ledger:tds:TDS B')" % pid)
    apply([SO], [SE])
    ok(db.one("select state || ' ' || (evidence->0->>'ledger') from night_findings where id = '%s'" % pid) == "resolved TDS B", "4. a ledger a person picked stays picked when the night no longer asks")
    ok(db.one("select state from night_findings where kind = 'payroll_due'") == "cleared", "4. a journal no longer waiting is cleared")
    # 5. trust levels
    ok(json.loads(one(OWN, "select public.trust_set('c1', 'payroll', 1, null)"))["level"] == 1 and db.one("select level from daily_trust where client_id = 'c1' and kind = 'payroll'") == "1", "5. the owner sets a level")
    ok(db.one("select count(*) from daily_log where what = 'trust' and ref = 'payroll'") == "1", "5. logged")
    ok(raises(lambda: act(STAFF, "select public.trust_set('c1', 'payroll', 2, null)")) and raises(lambda: act(LOOK, "select public.trust_set('c1', 'payroll', 2, null)")), "5. staff and a look-only member cannot")
    ok(raises(lambda: act(OWN2, "select public.trust_set('c1', 'payroll', 2, null)")), "5. another firm's owner cannot (no such client in their firm)")
    ok(raises(lambda: act(OWN, "select public.trust_set('c1', 'payroll', 3, null)")) and raises(lambda: act(OWN, "select public.trust_set('c1', '*', 1, 100000)")) and raises(lambda: act(OWN, "select public.trust_set('c1', 'payroll', 1, -5)")) and raises(lambda: act(OWN, "select public.trust_set('c1', 'made_up', 1, null)")),
       "5. a level outside 0-2, a level on the limit, a negative limit, an unknown kind: refused")
    one(OWN, "select public.trust_set('c1', '*', 0, 100000)")
    ok(db.one("select limit_amt from daily_trust where kind = '*'") == "100000.00", "5. the client's limit kept (kind *)")
    ok(one(OWN2, "select count(*) from daily_trust") == "0" and one(STAFF, "select count(*) from daily_trust") == "2", "5. read by the firm only (RLS)")
    ok(raises(lambda: act(OWN, "insert into daily_trust (firm_id, client_id, kind) values ('%s', 'c1', 'bank')" % F1)) and raises(lambda: act(OWN, "update daily_trust set level = 2")), "5. nobody writes daily_trust directly")
    # 6. trust_stats
    db.sql("""insert into night_entries (firm_id, client_id, source, dedupe, voucher, state, decided_at) select '%s', 'c1', 'bank_self_answer', 'b' || i, '{}', 'approved', now() - interval '30 days' + i * interval '1 hour' from generate_series(1, 25) i;
      insert into night_entries (firm_id, client_id, source, dedupe, voucher, state, decided_at) values ('%s', 'c1', 'bank_self_answer', 'rej', '{}', 'rejected', now() - interval '30 days' + interval '4 hours 30 minutes')""" % (F1, F1))
    st = {r["kind"]: r for r in as_(OWN, "select * from public.trust_stats()")}
    ok(st["bank"]["approved"] == "21", "6. approvals since the last rejection (21 of 25)")
    ok(as_(OWN2, "select * from public.trust_stats()") == [], "6. another firm sees none")
    one(OWN, "select public.trust_dismiss('c1', 'bank')")
    st = {r["kind"]: r for r in as_(OWN, "select * from public.trust_stats()")}
    ok(st["bank"]["approved"] == "0" and db.one("select count(*) from daily_log where what = 'trust_later'") == "1", "6. put off: counts again from now, logged")
    db.sql("update daily_trust set dismissed_at = now() - interval '40 days', set_at = now() - interval '40 days' where kind = 'bank'")
    one(OWN, "select public.trust_set('c1', 'bank', 1, null)")
    ok({r["kind"]: r for r in as_(OWN, "select * from public.trust_stats()")}["bank"]["approved"] == "0", "6. a level change: counts again from it")
    # 7. reminders
    db.sql("""insert into night_findings (id, firm_id, client_id, kind, key, state, first_seen, last_seen) values ('00000000-0000-4000-8000-000000000071', '%s', 'c1', 'bank_month_missing', 'bankm:a:202610', 'ask', '2026-11-01', '2026-11-22'),
        ('00000000-0000-4000-8000-000000000072', '%s', 'c1', 'advance_open', 'adv:x', 'ask', '2026-11-01', '2026-11-22');
      insert into client_asks (id, firm_id, client_id, finding_id, week, text, state) values ('00000000-0000-4000-8000-000000000081', '%s', 'c1', '00000000-0000-4000-8000-000000000071', '2026-11-02', 'Please send the HDFC statement for October 2026.', 'draft'),
        ('00000000-0000-4000-8000-000000000082', '%s', 'c1', '00000000-0000-4000-8000-000000000072', '2026-11-02', 'Advance?', 'draft');
      insert into client_contacts (firm_id, client_id, name, email) values ('%s', 'c1', 'Anil', 'accounts@sampletraders.example');""" % (F1, F1, F1, F1, F1))
    due = lambda live=False: json.loads(db.one("select public.remind_due(%s)" % ("true" if live else "false")))
    ok(due() == [], "7. the switch off (the default): nothing")
    db.sql("insert into assistant_prefs (firm_id, client_id, auto_reminders, set_by) values ('%s', 'c1', true, '%s')" % (F1, OWN))
    ok(due() == [], "7. on, but nothing asked before: nothing")
    db.sql("insert into ask_sends (firm_id, client_id, channel, test_mode, ask_ids, status, sent_by, sent_at) values ('%s', 'c1', 'email', true, array['00000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000082']::uuid[], 'sent', '%s', now() - interval '3 days')" % (F1, OWN))
    ok(due() == [], "7. sent 3 days ago: not yet (at most weekly)")
    db.sql("update ask_sends set sent_at = now() - interval '8 days'")
    d = due()
    ok(len(d) == 1 and [q["id"] for q in d[0]["questions"]] == ["00000000-0000-4000-8000-000000000081"] and d[0]["owner_email"] == "owner@samplefirm.example" and d[0]["by"] == OWN, "7. a week on: the document request only (not the advance question), on behalf of the owner who turned it on")
    ok(d[0]["real_send"] is False and d[0]["contacts"][0]["email"] == "accounts@sampletraders.example", "7. with the firm's switch (test mode) and the contacts for the guard to decide")
    db.sql("insert into assistant_mail (firm_id, real_send) values ('%s', true)" % F1)
    ok(len(due(False)) == 1, "7. the firm's switch on but the server's off: still test mode, the test send counts")
    ok(due(True) == [], "7. real sending: a question only test-sent was never really asked: nothing")
    db.sql("update client_asks set state = 'asked' where id = '00000000-0000-4000-8000-000000000081'; insert into ask_sends (firm_id, client_id, channel, test_mode, ask_ids, status, sent_by, sent_at) values ('%s', 'c1', 'email', false, array['00000000-0000-4000-8000-000000000081']::uuid[], 'sent', '%s', now() - interval '9 days')" % (F1, OWN))
    ok(len(due(True)) == 1, "7. real sending: really asked 9 days ago: due")
    db.sql("delete from assistant_mail")
    db.sql("select public.remind_logged('%s', 'c1', null, array['00000000-0000-4000-8000-000000000081']::uuid[], 'sent', '')" % F1)
    ok(db.one("select count(*) from daily_log where what = 'remind' and evidence->>'status' = 'sent'") == "1" and due() == [], "7. a reminder sent: logged, and none again for 7 days")
    db.sql("update daily_log set at = now() - interval '8 days' where what = 'remind'")
    ok(len(due()) == 1, "7. 8 days later: due again")
    db.sql("update night_findings set state = 'resolved' where id = '00000000-0000-4000-8000-000000000071'")
    ok(due() == [], "7. the document came (finding resolved): nothing")
    db.sql("update night_findings set state = 'ask' where id = '00000000-0000-4000-8000-000000000071'; update client_asks set state = 'answered' where id = '00000000-0000-4000-8000-000000000081'")
    ok(due() == [], "7. answered: nothing")
    db.sql("update client_asks set state = 'asked' where id = '00000000-0000-4000-8000-000000000081'; update members set active = false where user_id = '%s'" % OWN)
    ok(due() == [], "7. the owner who turned it on is no longer active: nothing")
    db.sql("update members set active = true where user_id = '%s'" % OWN)
    # 8. the claim
    db.sql("insert into night_entries (id, firm_id, client_id, source, dedupe, voucher, state) values ('00000000-0000-4000-8000-000000000091', '%s', 'c1', 'payroll', 'payroll:202610', '{}', 'ready')" % F1)
    E9 = "'00000000-0000-4000-8000-000000000091'"
    st = lambda: db.one("select state from night_entries where id = %s" % E9)
    act(STAFF, "select public.entry_claim(%s)" % E9)
    ok(st() == "approving", "8. claimed: ready -> approving")
    ok(raises(lambda: act(OWN, "select public.entry_claim(%s)" % E9)), "8. a second claim (another person, the same moment): refused")
    ok(raises(lambda: act(OWN, "select public.entry_approved(%s, 'dc-x')" % E9)) and raises(lambda: act(OWN, "select public.entry_release(%s, '')" % E9)), "8. someone else cannot approve or release it")
    ok(raises(lambda: act(LOOK, "select public.entry_claim(%s)" % E9)) and raises(lambda: act(OWN2, "select public.entry_claim(%s)" % E9)), "8. a look-only member, another firm: not allowed")
    apply([dict(SO, key="payroll-x")], [])
    ok(st() == "approving", "8. the night (complete) leaves an entry being approved alone")
    act(STAFF, "select public.entry_release(%s, 'Tally refused')" % E9)
    ok(st() == "ready" and db.one("select count(*) from daily_log where what = 'release'") == "1", "8. the post failed: released to ready, logged")
    act(STAFF, "select public.entry_claim(%s)" % E9); act(STAFF, "select public.entry_approved(%s, 'dc-abc')" % E9)
    ok(db.one("select state || ' ' || work_ref || ' ' || approved_once from night_entries where id = %s" % E9) == "approved dc-abc true" and db.one("select count(*) from daily_log where what = 'approved' and ref = '00000000-0000-4000-8000-000000000091'") == "1", "8. Tally took it: approved by the claimer, logged")
    ok(raises(lambda: act(STAFF, "select public.entry_claim(%s)" % E9)), "8. an approved entry cannot be claimed again")
    # (review N4, final review 1) the closed tab: a claim left 30 minutes, settled from its draft; approved ONLY with proof
    stale = lambda: db.sql("update night_entries set state = 'approving', decided_by = '%s', updated_at = now() - interval '31 minutes' where id = %s" % (STAFF, E9))
    draft = lambda st, job=None, res=None, age="0 minutes": db.sql("delete from client_book_items where key = 'asstEntries'; insert into client_book_items (firm_id, client_id, key, item, data, updated_at) values ('%s', 'c1', 'asstEntries', '#dc-p1', '%s'::jsonb, now() - interval '%s')" % (F1, json.dumps(dict({"id": "dc-p1", "dedupe": "payroll:202610", "state": st}, **({"job": job} if job else {}), **({"results": {"dc-p1": res}} if res else {}))), age))
    J1 = "33333333-3333-4333-8333-333333333333"
    job = lambda status, results: db.sql("delete from tally_post_jobs; insert into tally_post_jobs (id, firm_id, client_id, status, results) values ('%s', '%s', 'c1', '%s', '%s'::jsonb)" % (J1, F1, status, json.dumps(results)))
    claim = lambda: json.loads(one(OWN, "select public.entry_claim(%s)" % E9))
    stale(); db.sql("delete from client_book_items where key = 'asstEntries'")
    r = claim()
    ok(r["ok"] and db.one("select decided_by from night_entries where id = %s" % E9) == OWN, "8. the tab closed before any draft was kept, 30 minutes on: claimed again (the second check then applies)")
    stale(); draft("posting")
    r = claim()
    ok(r["ok"] and st() == "approving", "8. a draft that says posting but has no job and nothing in Tally: not proof, claimed again")
    # (last fix) posted straight to the bridge here: the draft's own result
    stale(); draft("posted", res={"ok": True, "tallyId": "4417"})
    r = claim()
    ok(r["ok"] is False and "Already in Tally" in r["why"] and st() == "approved", "8. its own result ok with Tally's voucher id (no cloud job): proof, approved")
    stale(); draft("posted", res={"ok": True})
    r = claim()
    ok(r["ok"] is False and "not confirmed it yet" in r["why"] and st() == "approving", "8. says posted, no voucher id, saved just now: pending (not approved, not claimed again)")
    stale(); draft("posted", res={"ok": True}, age="25 hours")
    r = claim()
    ok(r["ok"] is False and "not confirmed there" in r["why"] and st() == "approving", "8. the same 25 hours on: unconfirmed, Needs you (never back to ready by itself)")
    settle0 = db.one("select public.entry_settle('%s', 'c1', '{payroll:202610}')" % F1)
    ok(st() == "approving", "8. the night leaves an unconfirmed one being approved (even on its own failed list)")
    db.sql("insert into night_findings (id, firm_id, client_id, kind, key, state, facts, candidates, first_seen, last_seen) values ('00000000-0000-4000-8000-000000000098', '%s', 'c1', 'sent_check', 'sent:payroll:202610:x', 'you', '{\"dedupe\": \"payroll:202610\"}', '[{\"t\": \"retry\", \"ref\": \"retry:payroll:202610\", \"label\": \"Not in Tally: offer it again\"}]', '2026-11-22', '2026-11-22')" % F1)
    ok(raises(lambda: act(STAFF, "select public.entry_unconfirm(%s, '00000000-0000-4000-8000-000000000098')" % E9)) and st() == "approving", "8. Not in Tally, offer it again: staff cannot")
    act(OWN, "select public.entry_unconfirm(%s, '00000000-0000-4000-8000-000000000098')" % E9)
    ok(st() == "ready" and db.one("select state || ' ' || (evidence->0->>'t') from night_findings where id = '00000000-0000-4000-8000-000000000098'") == "resolved retry" and db.one("select count(*) from daily_log where what = 'not_in_tally'") == "1", "8. the owner: the entry back to ready, the finding answered, logged")
    # night_apply never sends an approved entry back to ready while the night does not make it again (its draft posted or pending)
    db.sql("update night_entries set state = 'approved', decided_at = now() - interval '2 hours' where id = %s" % E9)
    apply([dict(SO, key="payroll-y")], [])
    ok(st() == "approved", "8. night_apply: an approved entry the night does not make again (draft posted or pending) stays approved")
    stale(); draft("sent", J1); job("waiting", [])
    r = claim()
    ok(r["ok"] is False and "On its way" in r["why"] and st() == "approving", "8. its job still waiting: not approved, not claimed again (on its way)")
    stale(); draft("sent", J1); job("done", [{"id": "dc-p1", "ok": False, "message": "Ledger missing"}])
    r = claim()
    ok(r["ok"] and st() == "approving", "8. a job done with THIS voucher refused: not proof, claimed again")
    stale(); draft("sent", J1); job("done", [{"id": "dc-other", "ok": True}])
    ok(claim()["ok"], "8. a job done with another voucher ok: not proof for this one")
    stale(); draft("sent", J1); job("done", [{"id": "dc-p1", "ok": True}])
    r = claim()
    ok(r["ok"] is False and "Already in Tally" in r["why"] and st() == "approved", "8. the job reports this voucher ok: proof, approved")
    db.sql("delete from tally_post_jobs"); db.sql("update night_entries set state = 'approving', updated_at = now() - interval '31 minutes' where id = %s" % E9); draft("posting")
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, narration) select book_id, firm_id, 'g-dc', '2026-10-31', 'Salary for Oct 2026 | TDSDesk:dc-p1' from tally_books where client_id = 'c1' limit 1")
    r = claim()
    ok(r["ok"] is False and st() == "approved", "8. FinCom's id in the books: proof, approved")
    db.sql("delete from tally_vouchers where guid = 'g-dc'")
    # the night settles them too (service role), by the same rule
    settle = lambda failed="{}": db.one("select public.entry_settle('%s', 'c1', '%s')" % (F1, failed))
    db.sql("update night_entries set state = 'approving', updated_at = now() - interval '31 minutes' where id = %s" % E9); draft("sent", J1); job("done", [{"id": "dc-p1", "ok": True}])
    ok(settle() == "1" and st() == "approved", "8. the night: the job reports it ok -> approved, logged")
    db.sql("update night_entries set state = 'approving', updated_at = now() - interval '31 minutes' where id = %s" % E9); draft("posting")
    db.sql("delete from tally_post_jobs"); settle()
    ok(st() == "ready" and db.one("select evidence->>'why' from daily_log where what = 'settled' order by id desc limit 1") == "Not confirmed in Tally", "8. the night: a draft saying posting with no job -> ready (Not confirmed in Tally)")
    db.sql("update night_entries set state = 'approving', updated_at = now() - interval '31 minutes' where id = %s" % E9); draft("posted", res={"ok": True})
    settle()
    ok(st() == "approving", "8. the night: says posted (no proof) within 24 hours: pending, left being approved")
    db.sql("update night_entries set state = 'approving', updated_at = now() - interval '31 minutes' where id = %s" % E9); draft("sent", J1); job("running", [])
    settle()
    ok(st() == "approving", "8. the night: its job still running -> left being approved")
    settle("{payroll:202610}")
    ok(st() == "approving", "8. the night: a job still running is not made failed by the night's own list")
    job("failed", []); settle()
    ok(st() == "ready", "8. the night: the queue stopped the job -> ready")
    db.sql("update night_entries set state = 'approving', updated_at = now() - interval '5 minutes' where id = %s" % E9); db.sql("delete from client_book_items where key = 'asstEntries'")
    settle()
    ok(st() == "approving", "8. the night: a claim 5 minutes old with no draft yet (still posting): left alone")
    # (final review 3) "That journal is not for <month>": the owner only, on the server
    db.sql("insert into night_findings (id, firm_id, client_id, kind, key, state, candidates, first_seen, last_seen) values ('00000000-0000-4000-8000-000000000097', '%s', 'c1', 'setoff_exclude', 'excl:07:202610:rv', 'you', '[{\"t\": \"exclude\", \"ref\": \"excl:07:202610:rv\", \"label\": \"That journal is not for Oct 2026\", \"voucher\": \"rv\"}]', '2026-11-22', '2026-11-22')" % F1)
    ok(raises(lambda: act(STAFF, "select public.finding_choose('00000000-0000-4000-8000-000000000097', 'excl:07:202610:rv')")) and db.one("select state from night_findings where id = '00000000-0000-4000-8000-000000000097'") == "you", "8. staff cannot say a journal is not for a month (owner only, server)")
    act(OWN, "select public.finding_choose('00000000-0000-4000-8000-000000000097', 'excl:07:202610:rv')")
    ok(db.one("select state || ' ' || (evidence->0->>'ref') from night_findings where id = '00000000-0000-4000-8000-000000000097'") == "resolved excl:07:202610:rv" and db.one("select count(*) from daily_log where what = 'choose' and ref = '00000000-0000-4000-8000-000000000097'") == "1", "8. the owner can: recorded (month-specific ref) and logged")
    ok(not fp("authenticated", "entry_settle(uuid, text, text[])") and fp("service_role", "entry_settle(uuid, text, text[])") and not fp("authenticated", "asst_draft_state(uuid, text, text)"), "8. entry_settle: the night only; the draft helper: nobody from the page")
    ok(raises(lambda: act(OWN, "select public.remind_due(false)")) and raises(lambda: act(OWN, "select public.remind_logged('%s', 'c1', null, null, 'sent', '')" % F1)), "7. a person cannot run the reminders or write their log")
finally:
    db.stop()
print("%d failed" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
