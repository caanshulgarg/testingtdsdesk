"""python3 run_backup_history_server.py - migrations 28, 29 and 30 (02-Oct-2026) on a throwaway PostgreSQL (pg_stand),
never on staging:
  28: tally_ingest_ledger_ids stores a ledger's GSTIN and PAN by its cleaned name, for the service role only;
  29: the nightly backup keeps soft-deleted clients and records with all their data, 30 copies a firm (and all of the
      last 31 days); every change to a client's settings is kept (who, when, old, new), readable by the firm only;
  30: an update that leaves a setting out keeps the server's value (an older browser copy without postTo)."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
F, G = "00000000-0000-0000-0000-0000000000f1", "00000000-0000-0000-0000-0000000000f2"
U, V = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2"
B = "00000000-0000-0000-0000-0000000000b1"
ROOT = os.path.join(HERE, "..", "server")
# the pieces of staging these migrations lean on, as they are there (clients, records, client_books, backups, the
# triggers on clients: touch_row and sync_guard_clients, migration-19)
SETUP = """
alter table members add column if not exists email text;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('fincom.role', true), ''), 'service_role') $$;
create or replace function tally_nm(t text) returns text language sql immutable as $$ select btrim(regexp_replace(coalesce(t, ''), '[\\r\\n]+', ' ', 'g')) $$;
alter table firms add column if not exists balance numeric default 0;
create table clients (id text not null, firm_id uuid not null, name text, gstin text, pan text, tally_name text, data jsonb, updated_at timestamptz default now(), updated_by uuid,
  deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid, delete_reason text, restored_at timestamptz, restored_by uuid, primary key (firm_id, id));
create table records (firm_id uuid, kind text, id text, client_id text, data jsonb, deleted boolean not null default false, updated_at timestamptz default now(), updated_by uuid, primary key (firm_id, kind, id));
create table client_books (firm_id uuid, client_id text, part text, rev integer, data jsonb, updated_at timestamptz, updated_by uuid);
create table backups (id bigserial primary key, firm_id uuid, taken_at timestamptz default now(), clients integer, records integer, bytes bigint, data jsonb);
create table sync_refused (firm_id uuid, user_id uuid, tbl text, kind text, row_id text, what text);
create or replace function sync_empty(v anyelement) returns boolean language sql immutable as $$ select v is null or v::text in ('', '{}', '""', 'null') $$;
create or replace function touch_row() returns trigger language plpgsql as $$ begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create or replace function sync_guard_clients() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare kept text[] := '{}';
begin
  if not sync_empty(old.data) and sync_empty(new.data) then new.data := old.data; kept := kept || 'data'::text; end if;
  if new.deleted and not old.deleted then new.deleted_at := now(); new.deleted_by := auth.uid(); new.delete_reason := coalesce(nullif(btrim(new.delete_reason), ''), 'deleted in the app'); end if;
  return new;
end $function$;
create trigger clients_touch before insert or update on clients for each row execute function touch_row();
create trigger sync_guard before update on clients for each row execute function sync_guard_clients();
insert into firms (id, name) values ('%(F)s', 'GARG'), ('%(G)s', 'Other');
insert into members (user_id, firm_id, name, email, role, active) values ('%(U)s', '%(F)s', 'Anshul garg', 'test@test.com', 'owner', true), ('%(V)s', '%(G)s', 'Other firm', 'o@x.com', 'owner', true);
insert into clients (id, firm_id, name, gstin, data) values
  ('cmufksrrqjub2g', '%(F)s', 'Testing AAD', '09AANFG3202D1ZR', '{"name": "Testing AAD", "gst": {"cgst": "09 CGST INPUT"}, "postTo": "GARG SHEKHAR & COMPANY", "stats": {"records": 5}}'),
  ('cmugy1hlvpnba5', '%(F)s', 'Mastercad Solutions', '', '{"name": "Mastercad Solutions"}');
insert into records (firm_id, kind, id, client_id, data) values ('%(F)s', 'entry', 'e1', 'cmufksrrqjub2g', '{"x": 1}'), ('%(F)s', 'entry', 'e2', 'cmufksrrqjub2g', '{"x": 2}');
insert into client_books values ('%(F)s', 'cmufksrrqjub2g', 'work', 1, '{"w": 1}', now(), null);
insert into tally_books (book_id, firm_id, client_id, company) values ('%(B)s', '%(F)s', 'cmufksrrqjub2g', 'GARG SHEKHAR & COMPANY');
insert into tally_ledgers (book_id, firm_id, name, parent) values ('%(B)s', '%(F)s', 'Kashi IT Solutions', 'Sundry Creditors'), ('%(B)s', '%(F)s', 'Aadi Info Solutions Pvt. Ltd', 'Sundry Creditors');
""" % dict(F=F, G=G, U=U, V=V, B=B)

db = pg_stand.start(55443)
try:
    db.sql(SETUP)
    for m in ["tally-cloud/migration-28-ledger-ids.sql", "security/migration-29-backups-history.sql", "security/migration-30-client-keys-kept.sql"]:
        db.sql(open(os.path.join(ROOT, m)).read())
        db.sql(open(os.path.join(ROOT, m)).read())              # safe to run again
    ok(True, "migrations 28, 29 and 30 run, twice each")

    # ---- 28
    r = db.one("select tally_ingest_ledger_ids('%s', '[[\"Kashi IT Solutions\", \"09deypd8166r1z5\", \"deypd8166r\"], [\"No Such Ledger\", \"09AAAAA0000A1Z5\", \"\"]]')::text" % B)
    ok(json.loads(r)["ids"] == 1, "28: one ledger given its GSTIN and PAN, an unknown name ignored: " + r)
    row = db.rows("select gstin, pan from tally_ledgers where name = 'Kashi IT Solutions'")[0]
    ok(row == {"gstin": "09DEYPD8166R1Z5", "pan": "DEYPD8166R"}, "28: stored in capitals: " + json.dumps(row))
    try:
        db.sql("set fincom.role = 'authenticated'; select tally_ingest_ledger_ids('%s', '[]');" % B, uid=U); ok(False, "28: a signed-in user is refused")
    except RuntimeError as e: ok("not allowed" in str(e), "28: a signed-in user is refused")

    # ---- 30 (and the history of 29): the 06:02 save of an older copy without postTo
    db.sql("""update clients set data = '{"name": "Testing AAD", "gst": {"cgst": "INPUT CGST"}, "stats": {"records": 12}}' where id = 'cmufksrrqjub2g';""", uid=U)
    d = json.loads(db.one("select data::text from clients where id = 'cmufksrrqjub2g'"))
    ok(d.get("postTo") == "GARG SHEKHAR & COMPANY", "30: an update without postTo keeps it: " + str(d.get("postTo")))
    ok(d["gst"]["cgst"] == "INPUT CGST" and d["stats"]["records"] == 12, "30: the values it does send are taken")
    db.sql("""update clients set data = data || '{"postTo": ""}' where id = 'cmufksrrqjub2g';""", uid=U)
    ok(db.one("select (data->>'postTo') = '' from clients where id = 'cmufksrrqjub2g'") == "t", "30: sent empty on purpose (Stop posting): emptied")
    db.sql("""update clients set data = data || '{"postTo": "GARG SHEKHAR & COMPANY"}' where id = 'cmufksrrqjub2g';""", uid=U)
    db.sql("update clients set data = '{}' where id = 'cmugy1hlvpnba5';", uid=U)
    ok(db.one("select data->>'name' from clients where id = 'cmugy1hlvpnba5'") == "Mastercad Solutions", "30 with migration-19: an emptied copy still keeps everything")

    # ---- 29: the history
    h = db.rows("select setting, old_value::text o, new_value::text n, by_name, op from client_settings_history where client_id = 'cmufksrrqjub2g' order by id")
    sets = [x["setting"] for x in h]
    ok("data.gst" in sets and "data.stats" not in sets, "29: GST change kept, the bill counts left out: " + ", ".join(sets))
    pt = [x for x in h if x["setting"] == "data.postTo"]
    ok(len(pt) == 2 and pt[0]["o"] == '"GARG SHEKHAR & COMPANY"' and pt[0]["n"] == '""' and pt[1]["n"] == '"GARG SHEKHAR & COMPANY"', "29: postTo emptied and set again, old and new each time")
    ok(all(x["by_name"] == "Anshul garg" for x in h) and all(x["op"] == "update" for x in h), "29: who (the member's name) and what")
    db.sql("update clients set deleted = true where id = 'cmugy1hlvpnba5';", uid=U)
    ok(db.rows("select new_value::text n from client_settings_history where client_id = 'cmugy1hlvpnba5' and setting = 'deleted'") == [{"n": "true"}], "29: a soft delete is in the history")
    mine = json.loads(db.one("set fincom.role = 'authenticated'; select client_settings_history('cmufksrrqjub2g')::text", uid=U))
    ok(len(mine) == len(h) and mine[0]["setting"] == "data.postTo", "29: the firm reads its client's history, newest first (%d rows)" % len(mine))
    other = json.loads(db.one("set fincom.role = 'authenticated'; select client_settings_history('cmufksrrqjub2g')::text", uid=V))
    ok(other == [], "29: another firm reads nothing")
    try:
        db.sql("set role authenticated; set fincom.uid = '%s'; delete from client_settings_history;" % U); ok(False, "29: nobody deletes history")
    except RuntimeError as e: ok("permission denied" in str(e), "29: a signed-in user cannot change or delete the history")

    # ---- migration-27's postTo block, with these triggers in place (migration-19 guard, 29 history, 30 keys kept)
    m27 = open(os.path.join(ROOT, "tally-cloud/migration-27-post-record.sql")).read()
    block = m27[m27.rindex("\nbegin;"):]
    db.sql("""create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text);
      insert into tally_companies values ('%s', 'GARG SHEKHAR & COMPANY', 'cmufksrrqjub2g', '09AANFG3202D1ZR');
      update clients set data = data - 'postTo' where id = 'cmufksrrqjub2g';""" % F)
    ok(db.one("select data ? 'postTo' from clients where id = 'cmufksrrqjub2g'") == "t", "30: removing postTo by leaving it out is refused (kept)")
    db.sql("update clients set data = data || '{\"postTo\": \"\"}' where id = 'cmufksrrqjub2g';")
    db.sql(block); db.sql(block)
    d = json.loads(db.one("select data::text from clients where id = 'cmufksrrqjub2g'"))
    ok(d["postTo"] == "GARG SHEKHAR & COMPANY" and d["postToBy"] == "auto" and d["gst"]["cgst"] == "INPUT CGST", "27: the postTo block sets Testing AAD to GARG SHEKHAR & COMPANY with the triggers in place, nothing else changed; twice is harmless")
    ok(db.one("select count(*) from client_settings_history where client_id = 'cmufksrrqjub2g' and setting = 'data.postTo' and new_value = '\"GARG SHEKHAR & COMPANY\"' and by_name is null") == "1", "29: the block's change is in the history (by FinCom)")

    # ---- 29: the backup
    db.sql("update records set deleted = true where id = 'e2';")
    db.one("select take_backup('%s')::text" % F)
    b = db.rows("select clients, clients_deleted, records, records_deleted, jsonb_array_length(data->'clients') nc, jsonb_array_length(data->'records') nr from backups order by id desc limit 1")[0]
    ok(b == {"clients": "1", "clients_deleted": "1", "records": "1", "records_deleted": "1", "nc": "2", "nr": "2"}, "29: the backup holds the soft-deleted client and record too: " + json.dumps(b))
    gone = json.loads(db.one("select c::text from backups, jsonb_array_elements(data->'clients') c where c->>'id' = 'cmugy1hlvpnba5' order by backups.id desc limit 1"))
    ok(gone["deleted"] is True and gone["data"]["name"] == "Mastercad Solutions" and gone["delete_reason"], "29: with its data and the reason it was removed")
    # 40 nightly copies over 40 days, then one more: the last 30 days and today's kept (31 copies), the older ones go; 35 taken by hand today: none of the last 31 days goes
    db.sql("delete from backups; insert into backups (firm_id, taken_at, clients, records, bytes, data) select '%s', now() - make_interval(days => d), 0, 0, 0, '{}' from generate_series(1, 40) d;" % F)
    db.one("select take_backup('%s')::text" % F)
    n, oldest = db.rows("select count(*) n, max(now() - taken_at) > interval '31 days' too_old from backups where firm_id = '%s'" % F)[0].values()
    ok(n == "31" and oldest == "f", "29: 40 nightly copies + 1: the last 30 days and today's kept (%s), nothing older" % n)
    db.sql("insert into backups (firm_id, taken_at, clients, records, bytes, data) select '%s', now() - interval '1 minute', 0, 0, 0, '{}' from generate_series(1, 35);" % F)
    db.one("select take_backup('%s')::text" % F)
    ok(db.one("select count(*) from backups where firm_id = '%s' and taken_at < now() - interval '1 hour'" % F) == "30", "29: 35 copies taken by hand today push no nightly copy of the last 31 days out")
    ok(db.one("select count(*) from backups where firm_id = '%s'" % G) == "0", "29: a backup of one firm leaves another firm's alone")
finally:
    db.stop()
print("%d FAILED" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
