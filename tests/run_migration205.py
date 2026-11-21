"""python3 run_migration205.py - server/tally-cloud/migration-205-db-speed-2.sql (21-Nov-2026, branch next-fix-dbspeed; the
owner: "every documents, page, cloud should be lightening fast ... effect should remain same"). On a throwaway PostgreSQL
(pg_stand, port 31275 unless PG205_PORT; never a real database), with staging's tables as they are and 204's made-up
books (run_migration204.py's tables and rows) plus made-up GST rows. Checks:
  0. the file: add-only (two functions replaced with the same arguments, five policies altered in place, indexes made
     CONCURRENTLY if not there; nothing dropped, deleted, updated, inserted or truncated; no table, no column),
     lock_timeout set, grants explicit, names no real database, runs twice; each replaced function and each policy is
     staging's text (md5 of the body; the policy's words); the indexes are exactly the 21 foreign keys the advisor named
  1. the five policies (auth.uid() asked once per statement): the same rows seen and the same writes allowed or refused,
     before and after, for an owner, a staff member, an inactive owner, another firm's owner and anon
  2. gst_calc_gstins and gst_itc_inputs: the same answer (md5 of the whole text) in every case, no slower, the main
     cases faster
  3. grants as on staging
RED_WITHOUT_205=1: the same checks without the file (fails)."""
import os, re, sys, hashlib, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.dirname(HERE)
M205 = os.path.join(ROOT, "server", "tally-cloud", "migration-205-db-speed-2.sql")
RED = os.environ.get("RED_WITHOUT_205") == "1"
PORT = int(os.environ.get("PG205_PORT", "31275"))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def fdef(path, name):
    t = open(path).read()
    i = [m.start() for m in re.finditer(r"(?i)create or replace function public\.%s\(" % name, t)][-1]
    m = re.search(r"(?is)\bas\s+(\$\w*\$)", t[i:]); tag = m.group(1)
    a = i + m.end(); b = t.index(tag, a)
    return t[i:b + len(tag)] + ";", t[a:b]
def lit(s): return "'" + s.replace("'", "''") + "'"
# 204's stand: staging's tally tables, the stubs, the bench and the made-up books
T204 = open(os.path.join(HERE, "run_migration204.py")).read()
def const(name): return T204.split("\n%s = r\"\"\"" % name, 1)[1].split('"""', 1)[0]
DDL204, GEN204, STUBS204 = const("DDL"), const("GEN"), const("STUBS")
BEFORE = [("gst_calc_gstins", "server/gst-run/migration-153-gst-cloud.sql", "ee6e4c8eb8d471433be15c5b8ad144cd", "p_book uuid, p_client text"),
          ("gst_itc_inputs", "server/tally-cloud/migration-171-gst-share-itc.sql", "38a22b661ce4e81af816fd1fc5db86b0", "p_book uuid, p_reg text, p_engine text, p_version text")]
GRANTS = {"gst_calc_gstins": "{postgres=X/postgres,service_role=X/postgres}", "gst_itc_inputs": "{postgres=X/postgres,service_role=X/postgres}"}
# the foreign keys staging's performance advisor names as having no index (21-Nov-2026): table, column
FKEYS = [("assistant_notice_events", "notice_id"), ("call_batch_members", "firm_id"), ("call_captions", "batch_id"), ("call_captions", "firm_id"), ("call_captions", "participant_id"),
         ("call_consents", "firm_id"), ("call_consents", "participant_id"), ("call_consents", "recording_id"), ("call_invites", "firm_id"), ("call_messages", "firm_id"),
         ("call_messages", "participant_id"), ("call_pieces", "firm_id"), ("call_recordings", "batch_id"), ("call_recordings", "firm_id"), ("call_remote_sessions", "room_id"),
         ("call_transcripts", "batch_id"), ("call_transcripts", "firm_id"), ("firm_signals", "firm_id"), ("subscriptions", "plan_id"), ("tally_bridge_update_asks", "firm_id"),
         ("tally_work_claims", "firm_id")]
# staging's tables for 205's statements and policies (21-Nov-2026)
DDL = r"""create sequence if not exists public.client_timings_id_seq;
create table public.gst_itc_bill (book_id uuid not null, firm_id uuid not null, guid text not null, seq integer not null, ledger text not null, name text not null, nb boolean not null default false, reg text not null default ''::text, amount numeric(20,2) not null default 0, day text not null default ''::text, rec jsonb not null);
create unique index gst_itc_bill_pkey ON public.gst_itc_bill USING btree (book_id, guid, seq);
create index gst_itc_bill_ref ON public.gst_itc_bill USING btree (book_id, ledger, name);
create index gst_itc_bill_nb ON public.gst_itc_bill USING btree (book_id, reg) WHERE nb;
create table public.gst_itc_doc (book_id uuid not null, firm_id uuid not null, guid text not null, ym text not null, reg text not null default ''::text, doc jsonb not null);
create unique index gst_itc_doc_pkey ON public.gst_itc_doc USING btree (book_id, guid);
create index gst_itc_doc_reg ON public.gst_itc_doc USING btree (book_id, reg);
create table public.gst_itc_month (book_id uuid not null, firm_id uuid not null, ym text not null, reg text not null, engine text not null default ''::text, version text not null default ''::text, carry jsonb not null default '{}'::jsonb, result jsonb, ref jsonb, at timestamp with time zone not null default now());
create unique index gst_itc_month_pkey ON public.gst_itc_month USING btree (book_id, ym, reg);
create table public.gst_month (book_id uuid not null, firm_id uuid not null, ym text not null, reg text not null default ''::text, sec text not null, k1 text not null default ''::text, k2 text not null default ''::text, k3 text not null default ''::text, n integer not null default 0, taxable numeric(20,2) not null default 0, igst numeric(20,2) not null default 0, cgst numeric(20,2) not null default 0, sgst numeric(20,2) not null default 0, cess numeric(20,2) not null default 0, qty numeric(20,2) not null default 0, status text not null default 'stale'::text, at timestamp with time zone not null default now());
create unique index gst_month_pkey ON public.gst_month USING btree (book_id, ym, reg, sec, k1, k2, k3);
create table public.assistant_mismatches (id uuid not null default gen_random_uuid(), at timestamp with time zone not null default now(), firm_id uuid not null, client_id text, user_id uuid, kind text not null, question text not null default ''::text, figure text not null default ''::text, figure_key text not null default ''::text, ai_value numeric, fincom_value numeric, tool text not null default ''::text, params jsonb not null default '{}'::jsonb, entry_ids text[] not null default '{}'::text[], note text not null default ''::text);
create unique index assistant_mismatches_pkey ON public.assistant_mismatches USING btree (id);
create index assistant_mismatches_firm ON public.assistant_mismatches USING btree (firm_id, at DESC);
create table public.assistant_mismatch_status (id bigint not null, mismatch_id uuid not null, at timestamp with time zone not null default now(), status text not null, note text not null default ''::text, release text not null default ''::text, by_name text not null default ''::text);
create unique index assistant_mismatch_status_pkey ON public.assistant_mismatch_status USING btree (id);
create index assistant_mismatch_status_m ON public.assistant_mismatch_status USING btree (mismatch_id, at DESC);
create table public.client_timings (id bigint not null default nextval('public.client_timings_id_seq'), firm_id uuid not null default my_firm(), user_id uuid not null default auth.uid(), at timestamp with time zone not null default now(), browser text, net_type text, net_rtt integer, net_down numeric, summary jsonb not null);
create unique index client_timings_pkey ON public.client_timings USING btree (id);
create index client_timings_firm_at ON public.client_timings USING btree (firm_id, at DESC);
create index client_timings_at ON public.client_timings USING btree (at);
create table public.assistant_uploads (id uuid not null default gen_random_uuid(), firm_id uuid not null default my_firm(), client_id text, path text not null, name text not null, size bigint not null default 0, mime text, kind text not null default 'other'::text, kind_by text not null default 'rules'::text, summary text, action text, created_by uuid default auth.uid(), created_at timestamp with time zone not null default now());
create unique index assistant_uploads_pkey ON public.assistant_uploads USING btree (id);
create index assistant_uploads_client ON public.assistant_uploads USING btree (firm_id, client_id, created_at DESC);
create table public.clients (id text not null, firm_id uuid not null, name text not null default ''::text, gstin text not null default ''::text, pan text not null default ''::text, tally_name text not null default ''::text, data jsonb not null default '{}'::jsonb, updated_at timestamp with time zone not null default now(), updated_by uuid, deleted boolean not null default false, deleted_at timestamp with time zone, deleted_by uuid, delete_reason text, restored_at timestamp with time zone, restored_by uuid, status text not null default 'active'::text, status_reason text, status_by uuid, status_at timestamp with time zone);
CREATE UNIQUE INDEX clients_pkey ON public.clients USING btree (firm_id, id);
"""
# staging's policies on those tables, as pg_policies gives them (21-Nov-2026): table, name, command, using, with check
POLICIES = [('assistant_mismatch_status', 'assistant_mismatch_status_owner_read', 'SELECT', "(EXISTS ( SELECT 1\n   FROM (assistant_mismatches x\n     JOIN members m ON ((m.firm_id = x.firm_id)))\n  WHERE ((x.id = assistant_mismatch_status.mismatch_id) AND (x.firm_id = my_firm()) AND (m.user_id = auth.uid()) AND m.active AND (m.role = 'owner'::text))))", None), ('assistant_mismatches', 'assistant_mismatches_owner_read', 'SELECT', "((firm_id = my_firm()) AND (EXISTS ( SELECT 1\n   FROM members m\n  WHERE ((m.user_id = auth.uid()) AND (m.firm_id = assistant_mismatches.firm_id) AND m.active AND (m.role = 'owner'::text)))))", None), ('assistant_uploads', 'assistant_uploads_add', 'INSERT', None, "((firm_id = my_firm()) AND can_write() AND (created_by = auth.uid()) AND ((path ~~ ((my_firm())::text || '/%/uploads/%'::text)) OR (path ~~ ((my_firm())::text || '/%/notices/%'::text))))"), ('assistant_uploads', 'assistant_uploads_change', 'UPDATE', '((firm_id = my_firm()) AND can_write())', '(firm_id = my_firm())'), ('assistant_uploads', 'assistant_uploads_read', 'SELECT', '(firm_id = my_firm())', None), ('client_timings', 'client_timings_insert_own', 'INSERT', None, "((user_id = auth.uid()) AND (firm_id = my_firm()) AND (at > (now() - '00:05:00'::interval)) AND (at < (now() + '00:05:00'::interval)))"), ('client_timings', 'client_timings_read_owner', 'SELECT', "(is_superadmin() OR ((firm_id = my_firm()) AND (EXISTS ( SELECT 1\n   FROM members m\n  WHERE ((m.user_id = auth.uid()) AND (m.firm_id = client_timings.firm_id) AND (m.role = 'owner'::text) AND COALESCE(m.active, true))))))", None)]
FLAGGED = ["assistant_mismatch_status_owner_read", "assistant_mismatches_owner_read", "client_timings_insert_own", "client_timings_read_owner", "assistant_uploads_add"]
GEN = r"""-- 205: the company GSTINs (a few per book, some lower case, some blank, one only on deleted entries, one not a GSTIN)
update tally_vouchers set cmp_gstin = case when alter_id % 10 = 0 then '' when alter_id % 7 = 0 then lower('27MADEU1234F1Z5')
  when deleted_at is not null and alter_id % 3 = 0 then '29MADEU1234F1Z5' else (array['27MADEU1234F1Z5', '24MADEU1234F1Z5', '07MADEU1234F1Z5', 'NOT-A-GSTIN'])[1 + alter_id % 4] end;
insert into clients (id, firm_id, name, data) select b.client_id, b.firm_id, 'Made-up client ' || b.client_id,
  case when b.client_id = 'c-a' then '{"gstin": "33madeu1234f1z5"}'::jsonb when b.client_id = 'c-b' then '{"gstin": "24MADEU1234F1Z5"}'::jsonb else '{}'::jsonb end from tally_books b;
insert into gst_itc_bill (book_id, firm_id, guid, seq, ledger, name, nb, reg, amount, day, rec)
select x.book_id, x.firm_id, x.guid, (row_number() over (partition by x.book_id, x.guid order by x.id))::int - 1, x.ledger, x.name, x.id % 3 = 0, case when x.id % 5 = 0 then '27MADEU1234F1Z5' else '' end,
       x.amount, to_char(x.day, 'YYYY-MM-DD'), jsonb_build_object('l', x.ledger, 'name', x.name, 'amt', x.amount) from tally_bills x;
insert into gst_itc_doc (book_id, firm_id, guid, ym, reg, doc)
select v.book_id, v.firm_id, v.guid, to_char(v.day, 'YYYYMM'), case when v.alter_id % 6 = 0 then '27MADEU1234F1Z5' else '' end, jsonb_build_object('bookDate', to_char(v.day, 'YYYY-MM-DD'), 'vno', v.vno)
  from tally_vouchers v where v.alter_id % 2 = 0;
insert into gst_month (book_id, firm_id, ym, reg, sec, k1, n, taxable, igst, status)
select v.book_id, v.firm_id, to_char(v.day, 'YYYYMM'), r.reg, s.sec, 'k' || (v.alter_id % 3), count(*), sum(v.alter_id), sum(v.alter_id) / 10, 'fresh'
  from tally_vouchers v, (values (''), ('27MADEU1234F1Z5')) r(reg), (values ('b2b'), ('*')) s(sec) group by 1, 2, 3, 4, 5, 6;
insert into gst_itc_month (book_id, firm_id, ym, reg, engine, version, carry, ref)
select distinct v.book_id, v.firm_id, to_char(v.day, 'YYYYMM'), '', 'e', 'v', jsonb_build_object('c', 1), case when extract(month from v.day) > 6 then jsonb_build_object('r', 2) end from tally_vouchers v;
analyze;
"""
F, G = "f0000000-0000-0000-0000-000000000204", "f0000000-0000-0000-0000-000000000206"
OWNER, STAFF, IDLE_OWNER, OTHER = ("11111111-0000-0000-0000-000000000204", "33333333-0000-0000-0000-000000000204", "44444444-0000-0000-0000-000000000204", "55555555-0000-0000-0000-000000000206")
ACCESS = r"""
insert into members values ('%(S)s', '%(F)s', 'Staff', 'staff', true), ('%(I)s', '%(F)s', 'Owner, inactive', 'owner', false), ('%(X)s', '%(G)s', 'Other owner', 'owner', true);
insert into assistant_mismatches (id, firm_id, client_id, user_id, kind) values ('a1000000-0000-0000-0000-000000000001', '%(F)s', 'c-a', '%(O)s', 'figure'),
  ('a1000000-0000-0000-0000-000000000002', '%(F)s', 'c-b', '%(S)s', 'figure'), ('a1000000-0000-0000-0000-000000000003', '%(G)s', 'c-x', '%(X)s', 'figure');
insert into assistant_mismatch_status (id, mismatch_id, status) values (1, 'a1000000-0000-0000-0000-000000000001', 'open'), (2, 'a1000000-0000-0000-0000-000000000002', 'fixed'), (3, 'a1000000-0000-0000-0000-000000000003', 'open');
insert into client_timings (id, firm_id, user_id, summary) values (1, '%(F)s', '%(O)s', '{}'), (2, '%(F)s', '%(S)s', '{}'), (3, '%(G)s', '%(X)s', '{}');
insert into assistant_uploads (id, firm_id, client_id, path, name, created_by) values ('b1000000-0000-0000-0000-000000000001', '%(F)s', 'c-a', '%(F)s/c-a/uploads/x.pdf', 'x.pdf', '%(O)s'),
  ('b1000000-0000-0000-0000-000000000002', '%(G)s', 'c-x', '%(G)s/c-x/uploads/y.pdf', 'y.pdf', '%(X)s');
select setval('public.client_timings_id_seq', 100);
grant usage on schema stand, auth to anon, authenticated;
grant select on members to anon, authenticated;
grant select, insert, update on assistant_mismatches, assistant_mismatch_status, client_timings, assistant_uploads to anon, authenticated;
grant usage on sequence public.client_timings_id_seq to anon, authenticated;
create or replace function stand.try(q text) returns text language plpgsql as $$
declare n bigint;
begin
  execute q; get diagnostics n = row_count; return 'ok ' || n;
exception when others then return 'refused ' || sqlstate;
end $$;
grant execute on function stand.try(text) to anon, authenticated;
""" % {"F": F, "G": G, "O": OWNER, "S": STAFF, "I": IDLE_OWNER, "X": OTHER}
WHO = [("owner", OWNER, "authenticated"), ("staff", STAFF, "authenticated"), ("inactive owner", IDLE_OWNER, "authenticated"), ("another firm's owner", OTHER, "authenticated"), ("anon", None, "anon")]
LOOKS = [
  "select string_agg(id::text, ',' order by id) from assistant_mismatches",
  "select string_agg(id::text, ',' order by id) from assistant_mismatch_status",
  "select string_agg(id::text, ',' order by id) from client_timings",
  "select string_agg(id::text, ',' order by id) from assistant_uploads",
  "select stand.try('insert into client_timings (firm_id, user_id, summary) values (''%s'', auth.uid(), ''{}'')')" % F,
  "select stand.try('insert into client_timings (firm_id, user_id, summary) values (''%s'', ''%s'', ''{}'')')" % (F, OTHER),
  "select stand.try('insert into client_timings (firm_id, user_id, at, summary) values (''%s'', auth.uid(), now() - interval ''1 hour'', ''{}'')')" % F,
  "select stand.try('insert into assistant_uploads (firm_id, client_id, path, name, created_by) values (''%s'', ''c-a'', ''%s/c-a/uploads/n.pdf'', ''n.pdf'', auth.uid())')" % (F, F),
  "select stand.try('insert into assistant_uploads (firm_id, client_id, path, name, created_by) values (''%s'', ''c-a'', ''%s/c-a/notices/n.pdf'', ''n.pdf'', auth.uid())')" % (F, F),
  "select stand.try('insert into assistant_uploads (firm_id, client_id, path, name, created_by) values (''%s'', ''c-a'', ''%s/c-a/uploads/n.pdf'', ''n.pdf'', ''%s'')')" % (F, F, OTHER),
  "select stand.try('insert into assistant_uploads (firm_id, client_id, path, name, created_by) values (''%s'', ''c-a'', ''%s/c-a/other/n.pdf'', ''n.pdf'', auth.uid())')" % (F, F),
  "select stand.try('update assistant_uploads set name = ''z'' where true')",
]
def access(db):
    out = []
    for who, uid, role in WHO:
        for q in LOOKS:
            pre = "begin; set local role %s; %s" % (role, ("set local fincom.uid = '%s';" % uid) if uid else "")
            r = db.rows(pre + "\n" + q + ";\nrollback;")
            out.append((who, q, list(r[0].values())[0] if r else None))
    return out
A, B, D, E = ("a0000000-0000-0000-0000-00000000000a", "b0000000-0000-0000-0000-00000000000b", "d0000000-0000-0000-0000-00000000000d", "e0000000-0000-0000-0000-00000000000e")
R = "27MADEU1234F1Z5"
CASES = [
  ("gstins: book A, its client", "", "select gst_calc_gstins('%s', 'c-a')" % A),
  ("gstins: book B, its client (a GSTIN also on the entries)", "", "select gst_calc_gstins('%s', 'c-b')" % B),
  ("gstins: book A, another client", "", "select gst_calc_gstins('%s', 'c-b')" % A),
  ("gstins: book D", "", "select gst_calc_gstins('%s', 'c-d')" % D),
  ("gstins: book E, no client", "", "select gst_calc_gstins('%s', null)" % E),
  ("gstins: no such book", "", "select gst_calc_gstins('99999999-0000-0000-0000-000000000000', 'c-a')"),
  ("gstins: book A, every GSTIN blank", "update tally_vouchers set cmp_gstin = '' where book_id = '%s';" % A, "select gst_calc_gstins('%s', 'c-a')" % A),
  ("itc: book A, no registration", "", "select gst_itc_inputs('%s', '', 'e', 'v')" % A),
  ("itc: book A, one registration", "", "select gst_itc_inputs('%s', '%s', 'e', 'v')" % (A, R)),
  ("itc: book A, nulls", "", "select gst_itc_inputs('%s', null, null, null)" % A),
  ("itc: book B", "", "select gst_itc_inputs('%s', '', 'e', 'v')" % B),
  ("itc: book D", "", "select gst_itc_inputs('%s', '', 'e', 'v')" % D),
  ("itc: book E, its lines gone (cancelled entries date it)", "delete from tally_lines where book_id = '%s';" % E, "select gst_itc_inputs('%s', '', 'e', 'v')" % E),
  ("itc: book E, nothing dated", "delete from tally_lines where book_id = '%s'; update tally_vouchers set cancelled = false where book_id = '%s';" % (E, E), "select gst_itc_inputs('%s', '', 'e', 'v')" % E),
  ("itc: book A, the first days' lines blank", "update tally_lines set ledger = '' where book_id = '%s' and day < '2025-05-01';" % A, "select gst_itc_inputs('%s', '', 'e', 'v')" % A),
  ("itc: no such book", "", "select gst_itc_inputs('99999999-0000-0000-0000-000000000000', '', 'e', 'v')"),
]
MAIN = {"gstins: book A, its client": 2}
def run_cases(db):
    out = {}
    for name, setup, stmt in CASES:
        rows = db.rows("begin;\n" + setup + "\nselect ms, h from stand.bench(%s, 7);\nrollback;" % lit(stmt))
        out[name] = (float(rows[0]["ms"]), rows[0]["h"])
    return out
text = open(M205).read() if os.path.exists(M205) and not RED else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M205), hashlib.md5(text.encode()).hexdigest() if text else "-", len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(bool(text) and not re.search(r"\b(drop|truncate)\s", code) and "delete from" not in code and not re.search(r"\bupdate\s+\w", code) and "create table" not in code
   and "insert into" not in code and "add column" not in code and "create policy" not in code, "add-only: nothing dropped, deleted, updated, inserted or truncated; no table, column or new policy")
ok("set local lock_timeout = '3s';" in code and "\nset lock_timeout = '3s';" in code, "lock_timeout 3 s (the transaction, and the indexes made after it)")
idx = re.findall(r"create index concurrently if not exists (\w+)\s+on public\.(\w+) \((\w+)\);", code)
want = sorted(FKEYS + [("tally_vouchers", "book_id, cmp_gstin")])
got = sorted([(t, c) for _, t, c in idx] + [(t, c) for t, c in re.findall(r"create index concurrently if not exists \w+\s+on public\.(\w+) \((book_id, cmp_gstin)\);", code)])
ok(got == want and code.rfind("create index concurrently") > code.rfind("commit;") and code.find("create index concurrently") > code.rfind("commit;"),
   "the 21 foreign keys and the GSTIN index, CONCURRENTLY, if not there, after the transaction (%d)" % len(got))
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == sorted(b[0] for b in BEFORE), "replaces exactly: %s" % made)
for name, path, md5, args in BEFORE:
    sig = "public.%s(%s)" % (name, ", ".join(a.split()[-1] for a in args.split(",")))
    ok(("revoke all on function %s from public, anon, authenticated" % sig) in code and ("grant execute on function %s to " % sig) in code, "%s: grants explicit" % sig)
    ok(("create or replace function public.%s(%s" % (name, args)) in code, "%s: the same arguments" % name)
    ok(hashlib.md5(fdef(os.path.join(ROOT, path), name)[1].encode()).hexdigest() == md5, "%s: replaced from staging's text (%s)" % (name, os.path.basename(path)))
altered = re.findall(r"alter policy (\w+) on public\.(\w+)", code)
ok(sorted(a[0] for a in altered) == sorted(FLAGGED), "alters exactly the five flagged policies: %s" % sorted(a[0] for a in altered))
for t, p, cmd, qual, chk in POLICIES:
    if p in FLAGGED:
        ok(("policyname = '%s'" % p) in code, "%s: refuses to run unless the policy is staging's (or already 205's)" % p)
print("== 1-2. the stand")
db = pg_stand.start(PORT)
try:
    db.sql(STUBS204); db.sql(DDL204); db.sql(DDL)
    db.sql("begin;\n" + GEN204 + "\n" + GEN + "\ncommit;")
    for t in sorted({t for t, _, _, _, _ in POLICIES}): db.sql("alter table public.%s enable row level security;" % t)
    for t, p, cmd, qual, chk in POLICIES:
        db.sql("create policy %s on public.%s as permissive for %s to authenticated%s%s;" % (p, t, cmd.lower(), (" using (%s)" % qual) if qual else "", (" with check (%s)" % chk) if chk else ""))
    for t, c in FKEYS: db.sql("create table if not exists public.%s (id bigint);\nalter table public.%s add column if not exists %s uuid;" % (t, t, c))
    db.sql(ACCESS)
    for name, path, md5, args in BEFORE:
        db.sql(fdef(os.path.join(ROOT, path), name)[0])
        sig = "public.%s(%s)" % (name, ", ".join(a.split()[-1] for a in args.split(",")))
        db.sql("revoke all on function %s from public; grant execute on function %s to service_role;" % (sig, sig))
    access_before, before = access(db), run_cases(db)
    if text:
        for i in (1, 2):
            r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-X", "-f", "-"],
                               input=text, capture_output=True, text=True)
            ok(r.returncode == 0, "the file runs (time %d)%s" % (i, "" if r.returncode == 0 else ": " + r.stderr[-400:]))
    access_after, after = access(db), run_cases(db)
    print("== 1. the policies")
    for (who, q, b), (_, _, a) in zip(access_before, access_after):
        ok(a == b, "%s, %s: %s" % (who, q[:90].replace("select stand.try(", "try("), b))
    pol = {r["policyname"]: (r["qual"] or "") + "|" + (r["with_check"] or "") for r in db.rows("select policyname, qual, with_check from pg_policies where schemaname = 'public'")}
    for p in FLAGGED:
        ok("auth.uid()" not in pol[p].replace("SELECT auth.uid() AS uid", ""), "%s: auth.uid() asked once per statement" % p)
    print("== 2. the functions")
    print("    %-56s %10s %10s  %s" % ("case", "before ms", "after ms", "x"))
    for name, _, _ in CASES:
        (b_ms, b_h), (a_ms, a_h) = before[name], after[name]
        print("    %-56s %10.1f %10.1f  %5.1f" % (name, b_ms, a_ms, b_ms / max(a_ms, 0.05)))
    for name, _, _ in CASES:
        (b_ms, b_h), (a_ms, a_h) = before[name], after[name]
        ok(a_h == b_h, "%s: the same answer (%s)" % (name, a_h[:40]))
        ok(a_ms <= b_ms * 1.3 + 3, "%s: no slower (within the stand's noise)" % name)
        if name in MAIN: ok(b_ms >= a_ms * MAIN[name], "%s: at least %sx faster" % (name, MAIN[name]))
    print("== 3. grants")
    for name, want in GRANTS.items():
        got = db.one("select proacl::text from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % lit(name))
        ok(got == want, "%s: %s" % (name, got))
finally:
    db.stop(); shutil.rmtree(db.data, ignore_errors=True)
print("\n%d failed" % len(fails) if fails else "\nall ok"); sys.exit(1 if fails else 0)
