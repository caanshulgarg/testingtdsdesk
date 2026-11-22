"""python3 tests/run_migration206.py - migration 206 (Daily Check) on a throwaway PostgreSQL (pg_stand), made-up data only.
  1. it runs, and runs again (safe twice)
  2. night_apply: a second run of the same night adds nothing (rule 4); an answered question is never asked again; a
     question closes by itself when its finding is resolved; what is no longer found is cleared; entries ready or held
  3. undo: back as a question, never resolved by itself again, its entry withdrawn; a person's choice stays
  4. row-level security and grants: another firm sees nothing; a look-only member reads but changes nothing; nobody
     writes findings or questions directly; only the service role runs the night
  5. sending: only the owner; only questions still needed from the client (never a resolved one); a test never marks a
     question Asked; the real-send switch only by the owner; everything logged
  6. contacts: owners and staff, logged; night_due claims each client once a night
PG_PORT (55471)."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
MIG = os.path.join(HERE, "..", "server", "assistant-night", "migration-206-assistant-night.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def raises(fn):
    try: fn(); return False
    except RuntimeError: return True

F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
OWN, STAFF, LOOK, OWN2 = ("aaaaaaaa-0000-0000-0000-00000000000%d" % i for i in (1, 2, 3, 4))
db = pg_stand.start(int(os.environ.get("PG_PORT") or 55471))
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
    body = open(MIG).read()
    # a table of the same name as one of 206's, made by something else: the migration stops, naming it, and changes nothing
    db.sql("create table night_runs (id int, note text)")
    try: db.sql(body); stopped = ""
    except RuntimeError as e: stopped = str(e)
    ok("already used by something else" in stopped and "table night_runs" in stopped and db.one("select to_regclass('public.night_findings')") in (None, ""), "1. a same-named table made by something else: the migration stops loudly, nothing changed")
    db.sql("drop table night_runs")
    db.sql("create function night_due(p int) returns int language sql as 'select 1'")
    try: db.sql(body); stopped = ""
    except RuntimeError as e: stopped = str(e)
    ok("function night_due" in stopped, "1. a same-named function made by something else: the migration stops loudly")
    db.sql("drop function night_due(int)")
    db.sql(body); db.sql(body)
    ok(True, "1. the migration runs, and runs again (its own names, marked)")
    ok(db.one("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'assistant_log'") == chat_before and db.one("select count(*) from assistant_log") == "1"
       and db.one("select string_agg(policyname, ',') from pg_policies where tablename = 'assistant_log'") == "assistant_log_owner_read", "1. the chat's assistant_log is untouched: its columns, its row, its policy")
    as_ = lambda uid, q: db.rows("set role authenticated;\n" + q, uid)
    one = lambda uid, q: db.one("set role authenticated;\n" + q, uid)
    act = lambda uid, q: db.sql("set role authenticated;\n" + q, uid)

    def apply(findings, entries=(), complete=False, night="2026-11-22"):
        return json.loads(db.one("select public.night_apply('%s', 'c1', '%s', 'v1', '%s'::jsonb, '%s'::jsonb, %s)" % (F1, night, json.dumps(findings).replace("'", "''"), json.dumps(list(entries)).replace("'", "''"), "true" if complete else "false")))
    ASK = {"kind": "advance_open", "key": "adv:abctraders:v1", "state": "ask", "facts": {"party": "ABC Traders", "amt": 250000, "ask_text": "₹2,50,000 advance to ABC Traders on 12-Aug is still open. Has the bill come?", "short": "Advance open. Bill come?"}}
    RES = {"kind": "bank_no_bill", "key": "bank:a1:r1", "state": "resolved", "facts": {"party": "GST", "amt": 18450, "ask_text": "₹18,450 paid to GST on 07-Nov: what is it for?"}, "evidence": [{"t": "challan", "ref": "challan:gst:C1", "label": "GST challan C1"}]}
    YOU = {"kind": "bank_no_bill", "key": "bank:a1:r2", "state": "you", "facts": {"party": "Sample Retail", "amt": 75000, "ask_text": "₹75,000 received?"}, "candidates": [{"t": "entry", "ref": "vch:s1", "label": "Sales 1204"}, {"t": "entry", "ref": "vch:s2", "label": "Sales 1211"}]}
    ENT = {"finding_key": "bank_no_bill|bank:a1:r1", "source": "bank_self_answer", "dedupe": "row:a1:r1", "work_ref": "a1:r1", "voucher": {"type": "Payment", "lines": []}, "reason": "Challan match", "why": "x", "evidence": [], "checks": [{"k": "drcr", "ok": True}], "ready": True}
    HELD = dict(ENT, dedupe="row:a1:r9", finding_key="bank_no_bill|bank:a1:r1", ready=False)
    # ---------------------------------------------------------------- 2. the night, twice
    r1 = apply([ASK, RES, YOU], [ENT, HELD])
    ok(r1["new"] == 3 and r1["asks"] == 1 and r1["entries"] == 2, "2. first night: 3 findings, 1 question, 2 entries (%s)" % r1)
    ok(db.one("select string_agg(state, ',' order by dedupe) from night_entries") == "ready,held", "2. an entry whose checks all pass is ready; one with a failed check is held")
    counts = lambda: db.one("select (select count(*) from night_findings) || '/' || (select count(*) from client_asks) || '/' || (select count(*) from night_entries)")
    before = counts(); r2 = apply([ASK, RES, YOU], [ENT, HELD])
    ok(counts() == before and r2["new"] == 0 and r2["asks"] == 0, "2. the same night again: nothing added (%s)" % counts())
    qid = db.one("select id from client_asks")
    ok(db.one("select state from client_asks") == "draft" and db.one("select week from client_asks") == "2026-11-16", "2. the question is a Draft on the week's list (Monday 16-Nov)")
    act(STAFF, "select public.ask_answer('%s', 'The bill is coming next week.')" % qid)
    apply([ASK, RES, YOU], [ENT, HELD], night="2026-11-23")
    ok(db.one("select state from client_asks") == "answered" and db.one("select count(*) from client_asks") == "1", "2. an answered question is never asked again")
    # the bill came: the finding resolved, its question closes by itself
    apply([dict(ASK, state="resolved", evidence=[{"t": "doc", "ref": "bill:e1", "label": "Bill AT/77"}]), RES, YOU], [ENT, HELD], night="2026-11-24")
    ok(db.one("select state || ':' || closed_by from client_asks") == "closed:document", "2. the document came: the question closed by itself")
    ok("Closed: Bill AT/77" in db.one("select history::text from client_asks"), "2. its history says what closed it")
    # a finding no longer found (complete run) is cleared and its draft question closed
    X = {"kind": "cash_big", "key": "cash:20261103:hw", "state": "ask", "facts": {"ask_text": "₹15,000 paid in cash. Please send the bill."}}
    apply([dict(ASK, state="resolved", evidence=[{"t": "doc", "ref": "bill:e1", "label": "Bill AT/77"}]), RES, YOU, X], [ENT, HELD], night="2026-11-25")
    r = apply([dict(ASK, state="resolved", evidence=[{"t": "doc", "ref": "bill:e1", "label": "Bill AT/77"}]), RES, YOU], [ENT], complete=True, night="2026-11-26")
    ok(db.one("select state from night_findings where kind = 'cash_big'") == "cleared" and db.one("select a.state || ':' || a.closed_by from client_asks a join night_findings n on n.id = a.finding_id where n.kind = 'cash_big'") == "closed:entry", "2. no longer found: cleared, its question closed")
    ok(db.one("select state from night_entries where dedupe = 'row:a1:r9'") == "withdrawn", "2. an entry no longer made: withdrawn")
    ok(db.one("select count(*) from night_runs where firm_id = '%s' and client_id = 'c1'" % F1) == "5" and db.one("select status from night_runs where night = '2026-11-26'") == "ok", "2. one run a night, the complete one ok")
    # ---------------------------------------------------------------- 3. undo and choose
    rid = db.one("select id from night_findings where key = 'bank:a1:r1'")
    ok(raises(lambda: act(LOOK, "select public.finding_undo('%s')" % rid)), "3. a look-only member cannot undo")
    act(STAFF, "select public.finding_undo('%s')" % rid)
    ok(db.one("select state from night_findings where id = '%s'" % rid) == "ask" and db.one("select state from client_asks where finding_id = '%s'" % rid) == "draft", "3. undo: back as a Draft question")
    ok(db.one("select state from night_entries where dedupe = 'row:a1:r1'") == "withdrawn", "3. undo: its prepared entry withdrawn")
    apply([dict(ASK, state="resolved", evidence=[{"t": "doc", "ref": "bill:e1", "label": "Bill AT/77"}]), RES, YOU], [ENT], night="2026-11-27")
    ok(db.one("select state from night_findings where id = '%s'" % rid) == "ask", "3. undone: the next night does not resolve it again")
    ok(db.one("select state from night_entries where dedupe = 'row:a1:r1'") == "withdrawn", "3. undone: no entry made for it again")
    yid = db.one("select id from night_findings where key = 'bank:a1:r2'")
    ok(raises(lambda: act(STAFF, "select public.finding_choose('%s', 'vch:nope')" % yid)), "3. choose: only one of the candidates")
    act(STAFF, "select public.finding_choose('%s', 'vch:s2')" % yid)
    apply([dict(ASK, state="resolved", evidence=[{"t": "doc", "ref": "bill:e1", "label": "x"}]), RES, YOU], [], night="2026-11-28")
    ok(db.one("select state || ':' || (evidence->0->>'ref') from night_findings where id = '%s'" % yid) == "resolved:vch:s2", "3. a person's choice stays over the next night")
    ok(int(db.one("select count(*) from daily_log where what in ('undo', 'choose', 'answer')")) == 3, "3. every action is logged")
    # ---------------------------------------------------------------- 4. RLS and grants
    ok(one(OWN2, "select count(*) from night_findings") == "0" and one(OWN2, "select count(*) from client_asks") == "0", "4. another firm's owner sees nothing")
    ok(int(one(LOOK, "select count(*) from night_findings")) >= 3, "4. a look-only member of the firm reads its findings")
    ok(raises(lambda: act(STAFF, "insert into night_findings (firm_id, client_id, kind, key, first_seen, last_seen) values ('%s', 'c1', 'suspense', 'x', now(), now())" % F1)), "4. nobody writes findings directly")
    ok(raises(lambda: act(STAFF, "update client_asks set state = 'asked'")), "4. nobody changes questions directly")
    ok(raises(lambda: act(OWN, "select public.night_apply('%s', 'c1', '2026-11-22', 'v', '[]', '[]', true)" % F1)), "4. only the service role runs the night")
    T9 = ["client_contacts", "assistant_prefs", "assistant_mail", "night_runs", "night_findings", "client_asks", "ask_sends", "night_entries", "daily_log"]
    writes = [t for t in T9 for priv in ("insert", "update", "delete", "truncate") if t != "client_contacts" and db.one("select has_table_privilege('authenticated', 'public.%s', '%s')" % (t, priv)) == "t"]
    ok(not writes, "4. S1: with Supabase's default grants, authenticated may not write any of the tables (%s)" % writes[:4])
    ok(db.one("select has_table_privilege('authenticated', 'public.ask_sends', 'select')") == "f" and db.one("select has_table_privilege('authenticated', 'public.daily_log', 'select')") == "f", "4. S1: the send log and the action log are not readable from the page")
    ok(db.one("select has_table_privilege('authenticated', 'public.client_contacts', 'delete')") == "f" and db.one("select has_table_privilege('anon', 'public.client_contacts', 'select')") == "f", "4. S1: contacts: no delete; anon nothing")
    FN = ["night_due(integer)", "night_missed()", "night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text)", "night_fail(uuid, text, date, text, text)", "asst_log(uuid, text, text, text, jsonb)", "asst_hist(jsonb, text)", "asst_is_owner()", "asst_mask(text)",
          "ask_send_begin(uuid, uuid, text, uuid[], text, text[], text[], boolean)", "ask_send_finish(bigint, text, text, text)", "asst_finding(uuid)", "asst_ask(uuid)"]
    can = [f for f in FN for r in ("authenticated", "anon") if db.one("select has_function_privilege('%s', 'public.%s', 'execute')" % (r, f)) == "t"]
    ok(not can, "4. S1: with Supabase's default grants, neither authenticated nor anon runs the night, send-log or helper functions (%s)" % can[:4])
    ok(db.one("select has_function_privilege('authenticated', 'public.finding_undo(uuid)', 'execute')") == "t" and db.one("select has_function_privilege('anon', 'public.finding_undo(uuid)', 'execute')") == "f", "4. S1: the page's functions for authenticated only")
    ok(db.one("select has_function_privilege('authenticated', 'public.night_due(integer)', 'execute')") == "f" and db.one("select has_function_privilege('service_role', 'public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text)', 'execute')") == "t", "4. grants: the night functions for the service role only")
    ok(db.one("select has_table_privilege('anon', 'public.night_findings', 'select')") == "f", "4. anon reads nothing")
    ok(raises(lambda: act(OWN2, "select public.ask_close('%s')" % qid)), "4. another firm's owner cannot close a question")
    # ---------------------------------------------------------------- 5. sending
    act(STAFF, "insert into client_contacts (client_id, name, email, whatsapp) values ('c1', 'Anil', 'accounts@sampletraders.example', '+91 90000 11111')")
    open_q = db.one("select id from client_asks where finding_id = '%s'" % rid)
    closed_q = db.one("select a.id from client_asks a join night_findings n on n.id = a.finding_id where n.kind = 'advance_open'")
    ids = "array['%s', '%s']::uuid[]" % (open_q, closed_q)
    ok(raises(lambda: act(STAFF, "select public.ask_send_prepare('c1', %s, 'email')" % ids)), "5. staff cannot send (the owner only)")
    p = json.loads(one(OWN, "select public.ask_send_prepare('c1', %s, 'email')" % ids))
    ok([q["id"] for q in p["questions"]] == [open_q], "5. prepare: only questions still needed from the client (a resolved one never gets in)")
    ok(p["contacts"][0]["email"] == "accounts@sampletraders.example" and p["real_send"] is False and p["client"] == "Sample Traders", "5. prepare: the contacts from the table; real sending off by default")
    ok(raises(lambda: act(OWN, "select public.ask_send_begin('%s', '%s', 'c1', array['%s']::uuid[], 'email', '{}', '{}', false)" % (F1, OWN, open_q))), "5. the send log cannot be written from the page (begin: service role only)")
    sid = db.one("select public.ask_send_begin('%s', '%s', 'c1', array['%s']::uuid[], 'email', array['accounts@sampletraders.example'], array['office@samplefirm.example'], true)" % (F1, OWN, open_q))
    db.sql("select public.ask_send_finish(%s, 'sent', 'r-1')" % sid)
    ok(db.one("select state from client_asks where id = '%s'" % open_q) == "draft" and "Test email to the firm" in db.one("select history::text from client_asks where id = '%s'" % open_q), "5. a test send never marks the question Asked")
    ok(raises(lambda: db.sql("select public.ask_send_begin('%s', '%s', 'c1', array['%s']::uuid[], 'email', '{}', '{}', false)" % (F1, STAFF, open_q))), "5. begin: only for the firm's owner")
    sid = db.one("select public.ask_send_begin('%s', '%s', 'c1', array['%s']::uuid[], 'email', array['accounts@sampletraders.example'], array['accounts@sampletraders.example'], false)" % (F1, OWN, open_q))
    db.sql("select public.ask_send_finish(%s, 'sent', 'r-2')" % sid)
    ok(raises(lambda: db.sql("select public.ask_send_begin('%s', '%s', 'c1', array['%s']::uuid[], 'email', '{}', array['x@y.example'], false)" % (F1, OWN, open_q))), "5. the daily limit: a second real email to the client the same day is refused (atomic, with the claim)")
    ok(db.one("select state from client_asks where id = '%s'" % open_q) == "asked", "5. a real send marks it Asked")
    ok(db.one("select count(*) from ask_sends") == "2" and db.one("select string_agg(test_mode::text || ':' || status, ',' order by id) from ask_sends") == "true:sent,false:sent", "5. every send logged, test or real")
    # WhatsApp: the server decides test or real
    w = json.loads(one(OWN, "select public.ask_whatsapp_opened('c1', array['%s']::uuid[], '+91 90000 00000')" % open_q))
    ok(w["test"] is True, "5. WhatsApp to a number that is not the client's: a test, whatever the switch")
    ok(raises(lambda: act(STAFF, "select public.assistant_mail_set(true)")), "5. staff cannot turn real sending on")
    ok(raises(lambda: act(OWN, "select public.assistant_mail_set(false, 'accounts@sampletraders.example')")), "5. the test address must be the firm's own (a client's is refused)")
    ok(raises(lambda: act(OWN, "select public.assistant_mail_set(false, 'office@samplefirm.example')")), "5. N2: the same domain is not enough: a member's exact email only")
    act(OWN, "select public.assistant_mail_set(true, 'owner@samplefirm.example')")
    ok(db.one("select real_send from assistant_mail") == "t" and db.one("select count(*) from daily_log where what = 'setting'") == "1", "5. the owner turns it on, logged")
    ok(raises(lambda: act(STAFF, "select public.prefs_set('c1', true)")), "5. reminders by itself: the owner only")
    db.sql("update client_asks set state = 'draft' where id = '%s'" % open_q)
    w = json.loads(one(OWN, "select public.ask_whatsapp_opened('c1', array['%s']::uuid[], '9000011111')" % open_q))
    ok(w["test"] is False and db.one("select state from client_asks where id = '%s'" % open_q) == "asked", "5. WhatsApp to the client's own number with real sending on: real, marked Asked")
    # ---------------------------------------------------------------- 6. contacts and night_due
    ok(raises(lambda: act(LOOK, "insert into client_contacts (client_id, name) values ('c1', 'X')")), "6. a look-only member cannot add a contact")
    ok(db.one("select count(*) from daily_log where what = 'contact'") == "1", "6. adding a contact is logged")
    act(STAFF, "update client_contacts set email = 'anil.k@sampletraders.example' where name = 'Anil'")
    ch = db.one("select evidence::text from daily_log where what = 'contact' order by id desc limit 1")
    ok("ac…@sampletraders.example → an…@sampletraders.example" in ch and "accounts@" not in ch, "6. an address change is logged, masked (%s)" % ch[:120])
    ok(raises(lambda: act(STAFF, "insert into client_contacts (client_id, name, email) values ('c1', 'Bad', 'not-an-email')")), "6. a bad email is refused")
    d1 = db.rows("select * from public.night_due(10)"); d2 = db.rows("select * from public.night_due(10)")
    got = sorted(r["client_id"] for r in d1)
    ok("c2" in got and "c9" not in got and not any(r["client_id"] == "c2" for r in d2), "6. night_due claims a client with books once a night (%s, then %s)" % (got, [r["client_id"] for r in d2]))
    # ---------------------------------------------------------------- 7. the review's cases
    def apply2(findings, entries=(), complete=True, night="2026-11-22"):
        return json.loads(db.one("select public.night_apply('%s', 'c2', '%s', 'v1', '%s'::jsonb, '%s'::jsonb, %s)" % (F1, night, json.dumps(findings).replace("'", "''"), json.dumps(list(entries)).replace("'", "''"), "true" if complete else "false")))
    A = {"kind": "advance_open", "key": "adv:x:v9", "state": "resolved", "facts": {"ask_text": "₹9 advance. Has the bill come?"}, "evidence": [{"t": "doc", "ref": "bill:e9", "label": "Bill 9"}]}
    E9 = {"finding_key": "advance_open|adv:x:v9", "source": "twob_inbox_bill", "dedupe": "bill:e9", "work_ref": "e9", "voucher": {}, "checks": [], "ready": True}
    apply2([dict(A, state="ask")])                          # first night: asked
    apply2([A], [E9], night="2026-11-23")                    # the bill came: resolved, question closed by itself
    fid = db.one("select id from night_findings where client_id = 'c2' and key = 'adv:x:v9'")
    ok(db.one("select state from client_asks where finding_id = '%s'" % fid) == "closed", "7. resolved: its question closed by itself")
    apply2([dict(A, state="ask")], [], night="2026-11-24")   # the bill went away: asked again
    ok(db.one("select state || ':' || week from client_asks where finding_id = '%s'" % fid) == "draft:2026-11-23", "7. resolved then ask: the question reopened as a Draft on this week's list")
    apply2([A], [E9], night="2026-11-25")
    eid = db.one("select id from night_entries where dedupe = 'bill:e9'")
    act(STAFF, "select public.entry_decide('%s', 'approved', 'e9')" % eid)
    ok(raises(lambda: act(STAFF, "select public.finding_undo('%s')" % fid)) and db.one("select state from night_findings where id = '%s'" % fid) == "resolved" and db.one("select state from client_asks where finding_id = '%s'" % fid) == "closed", "7. M4: undo after the entry was approved: refused, nothing changed")
    # an approval the night does not see (the same entry made again, 30 minutes on): put back as ready
    db.sql("update night_entries set decided_at = now() - interval '2 hours' where id = '%s'" % eid)
    apply2([A], [E9], night="2026-11-26")
    ok(db.one("select state from night_entries where id = '%s'" % eid) == "ready" and db.one("select count(*) from daily_log where what = 'approval_not_found'") == "1", "7. an approval the books do not show: back to ready, logged")
    # N4: approved again; the night no longer makes it (its bill approved): withdrawn, approved once: undo still refused
    act(STAFF, "select public.entry_decide('%s', 'approved', 'e9')" % eid)
    db.sql("update night_entries set state = 'withdrawn' where id = '%s'" % eid)
    ok(raises(lambda: act(STAFF, "select public.finding_undo('%s')" % fid)) and db.one("select approved_once from night_entries where id = '%s'" % eid) == "t", "7. N4: approved once and no longer made: undo still refused")
    db.sql("update night_entries set state = 'ready', decided_by = null where id = '%s'" % eid)
    act(STAFF, "select public.entry_decide('%s', 'rejected')" % eid)
    ok(db.one("select state from night_findings where id = '%s'" % fid) == "you" and db.one("select state from client_asks where finding_id = '%s'" % fid) == "draft", "7. rejected: the finding needs you, its question reopened")
    apply2([A], [E9], night="2026-11-27")
    ok(db.one("select state from night_findings where id = '%s'" % fid) == "you", "7. rejected: the next night does not resolve it again")
    # M5: choose refuses evidence another finding uses
    B1 = {"kind": "bank_no_bill", "key": "bank:s1:r1", "state": "resolved", "facts": {}, "evidence": [{"t": "entry", "ref": "vch:s7", "label": "Sales 7"}]}
    B2 = {"kind": "bank_no_bill", "key": "bank:s1:r2", "state": "you", "facts": {}, "candidates": [{"t": "entry", "ref": "vch:s7", "label": "Sales 7"}, {"t": "entry", "ref": "vch:s8", "label": "Sales 8"}]}
    apply2([A, B1, B2], [], night="2026-11-28")
    b2 = db.one("select id from night_findings where key = 'bank:s1:r2'")
    ok(raises(lambda: act(STAFF, "select public.finding_choose('%s', 'vch:s7')" % b2)), "7. M5: choosing evidence another finding uses is refused")
    act(STAFF, "select public.finding_choose('%s', 'vch:s8')" % b2)
    ok(db.one("select state from night_findings where id = '%s'" % b2) == "resolved", "7. M5: a free candidate can be chosen")
    # N3: a send left "sending" for 10 minutes is swept to failed and logged
    db.sql("insert into ask_sends (firm_id, client_id, channel, test_mode, status, sent_by, sent_at) values ('%s', 'c1', 'email', true, 'sending', '%s', now() - interval '11 minutes')" % (F1, OWN))
    ok(db.one("select public.ask_send_sweep()") == "1" and db.one("select count(*) from ask_sends where status = 'sending'") == "0" and db.one("select count(*) from daily_log where what = 'send_stale'") == "1", "7. N3: a send stuck in sending for 10 minutes: failed, logged")
    # capacity: night_due with no number takes what the window needs; night_missed marks who was not reached
    db.sql("insert into clients (id, firm_id, name) select 'm' || g, '%s', 'Many ' || g from generate_series(1, 30) g; insert into tally_books (book_id, firm_id, client_id) select gen_random_uuid(), '%s', 'm' || g from generate_series(1, 30) g" % (F1, F1))
    got = db.rows("select * from public.night_due(null)")
    ok(4 <= len(got) <= 20, "7. capacity: night_due(null) takes as many as the window needs, at most 20 a tick (%d now)" % len(got))
    n = int(db.one("select public.night_missed()"))
    ok(n >= 1 and db.one("select count(*) from daily_log where what = 'night_missed'") >= "1", "7. capacity: every client not checked tonight is marked and logged (%d)" % n)
finally:
    db.stop()
print("%d failed" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
