"""python3 run_migration183.py - server/tally-cloud/migration-183-post-release-any-member.sql (13-Nov-2026, branch
next-release-any-member; the owner's decision: any member who may post releases a bill "Deleted in Tally"). On a throwaway
PostgreSQL (pg_stand, port 31183 unless PG183_PORT; never a real database), built as run_migration174.py (its files, then
174), with a made-up firm, logins and company only. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (replaces tally_post_owner_release only; no drop, delete,
     truncate or alter); names no real database; grants restated (authenticated; not public, anon); 174's latest text
     with only the role check changed (can_write() in place of members.role = 'owner'); md5; runs twice
  1. the role rule: staff releases ("I checked in Tally: not there"): the id freed, the release kept in tally_post_marks
     with the staff member's id and the words "If it is in Tally, it will be posted twice", the entry's words name the
     member; an owner still may; a look-only member ('readonly') is refused (42501) and nothing changes; a member of
     another firm finds no posting; an inactive staff member is refused
  2. kept from 174: a reason required (staff too); never while the posting is waiting, taken or running (its id live)
  3. privileges: anon may not run it; authenticated may
RED_WITHOUT_183=1: the same checks without the file (0 and staff's release fail)."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.join(HERE, "..")
SQLDIR = os.path.join(ROOT, "server", "tally-cloud")
M183 = os.path.join(SQLDIR, "migration-183-post-release-any-member.sql")
M174 = os.path.join(SQLDIR, "migration-174-post-jobs-safe.sql")
RED = os.environ.get("RED_WITHOUT_183") == "1"
src142 = open(os.path.join(HERE, "run_migration142.py")).read()
FILES = eval(compile(src142.split("\nFILES = ", 1)[1].split("\nfails = []", 1)[0], "run_migration142.py(FILES)", "eval"), {"os": os, "SQLDIR": SQLDIR, "HERE": HERE, "ROOT": ROOT})
FILES += [os.path.join(SQLDIR, f) for f in ("migration-111-post-register.sql", "migration-142-post-any-bridge.sql", "migration-128-client-removed-frees-tally.sql", "migration-161-split-tally.sql", "migration-174-post-jobs-safe.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
def fbody(t_, name):
    i = t_.index("create or replace function public." + name + "(")
    return [l.strip() for l in t_[i:t_.index("$function$;", i)].splitlines() if l.strip()]

text = open(M183).read() if os.path.exists(M183) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M183), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate|alter|insert|update)\s", code.replace("for update", "")), "add-only: nothing dropped, deleted, truncated, altered or written")
ok(bool(text) and sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == ["tally_post_owner_release"] and "create table" not in code, "replaces tally_post_owner_release only")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
ok("revoke all on function public.tally_post_owner_release(uuid, text, text) from public, anon;" in text and "grant execute on function public.tally_post_owner_release(uuid, text, text) to authenticated;" in text, "grants restated as 174")
if text:
    a, b = fbody(text, "tally_post_owner_release"), fbody(open(M174).read(), "tally_post_owner_release")
    added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
    ok(len(gone) == 2 and all("owner" in l for l in gone) and len(added) == 2 and "not can_write()" in added[0] and "may post" in added[1], "174's latest text, only the role check changed (%s -> %s)" % (gone, added))
else: ok(False, "no file")

F, F2 = "99999999-9999-9999-9999-999999999183", "99999999-9999-9999-9999-999999999283"
OWNER, STAFF, LOOK, GONE, OTHER = ("%08d-5555-5555-5555-555555555183" % i for i in (1, 2, 3, 4, 5))
DA, BA = "d1000000-0000-0000-0000-0000000001a8", "go-aaaa000183"
BK, CO = "b0000001-0000-0000-0000-000000000183", "Made-up Heron Traders"
J = lambda n: "%08d-0000-0000-0000-000000000183" % n
db = pg_stand.start(int(os.environ.get("PG183_PORT") or 31183))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def rpc(uid, stmt, role="authenticated"):
    try: out = db.one("set role %s; %s" % (role, stmt), uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(out) if out else {}
    except (TypeError, ValueError): return {"_out": out}
def job(n, status, vid):
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge, taken_by, taken_at, first_taken_at, attempts, seq, results) values (%s, %s, 'c1', %s, %s, %s, 1, %s, %s, %s, now(), now(), 1, 1, %s)"
           % (q(J(n)), q(F), q(CO), q(DA), q(json.dumps({"masters": [], "vouchers": [{"id": vid, "xml": "<VOUCHER/>"}], "ledger": ""})), q(status), q(BA), q(BA), q(json.dumps([{"id": vid, "ok": True, "verified": True, "guid": "g-" + vid}]))))
    db.sql("insert into tally_post_ids (firm_id, client_id, fincom_id, entry_id, job_id, live) values (%s, 'c1', %s, %s, %s, true) on conflict do nothing" % (q(F), q(vid), q(vid), q(J(n))))
live = lambda n: db.one("select coalesce(string_agg(live::text, ','), '') from tally_post_ids where job_id = %s" % q(J(n)))
marks = lambda n: db.rows("select by_user::text u, note from tally_post_marks where job_id = %s and action = 'released'" % q(J(n)))
release = lambda uid, n, vid, why: rpc(uid, "select tally_post_owner_release(%s, %s, %s)::text" % (q(J(n)), q(vid), q(why)))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
                          alter role service_role bypassrls;
                          if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if; end $$;
      grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
      grant select on members to authenticated, service_role;
      insert into firms values (%(F)s, 'Made-up Firm 183'), (%(F2)s, 'Made-up Other Firm 183') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner Made-up', 'owner', true), (%(S)s, %(F)s, 'Staff Made-up', 'staff', true), (%(L)s, %(F)s, 'Look Made-up', 'readonly', true),
        (%(G)s, %(F)s, 'Gone Made-up', 'staff', false), (%(X)s, %(F2)s, 'Other Made-up', 'staff', true);
      create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
      insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%(DA)s, %(F)s, 'SRV9 · made-up-a', 'ha', '2.5.4', '{}', %(O)s);
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, updated_at timestamptz default now(), primary key (firm_id, id));
      create table if not exists public.tally_companies (firm_id uuid not null references public.firms(id) on delete cascade, company text not null, client_id text, gstin text,
        device_id uuid references public.tally_devices(id) on delete set null, first_seen timestamptz not null default now(), last_seen timestamptz, linked_at timestamptz, linked_by uuid,
        book_id uuid not null default gen_random_uuid() unique, primary key (firm_id, company));
      grant select on public.tally_companies to authenticated;
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'Made-up Heron', '{}');
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen, linked_at, book_id) values (%(F)s, %(CO)s, 'c1', %(DA)s, now(), now(), %(BK)s);
      insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%(BK)s, %(F)s, 'c1', %(CO)s, '2025-04-01');
      create table if not exists auth.users (id uuid primary key, email text);""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "L": q(LOOK), "G": q(GONE), "X": q(OTHER), "DA": q(DA), "BK": q(BK), "CO": q(CO)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;")
    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_183: not run)" % n); continue
        r = psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    print("  read-back md5(prosrc)=%s" % db.one("select md5(prosrc) from pg_proc where proname = 'tally_post_owner_release'"))

    print("== 1. the role rule")
    for n, vid in ((1, "S1"), (2, "O2"), (3, "L3"), (4, "G4"), (5, "R5")): job(n, "done", vid)
    r = release(STAFF, 1, "S1", "searched TDSDesk:S1 in the Day Book")
    m = marks(1)
    who = db.one("select r->>'by' from tally_post_jobs j, jsonb_array_elements(j.results) r where j.id = %s and r->>'id' = 'S1'" % q(J(1))) or ""
    ok(r.get("ok") is True and live(1) == "false", "staff: released, the id freed (%s, live %s)" % (r.get("_error") or r.get("error") or r.get("ok"), live(1)))
    ok(len(m) == 1 and m[0]["u"] == STAFF and "If it is in Tally, it will be posted twice" in m[0]["note"] and "searched TDSDesk:S1" in m[0]["note"], "staff: kept with the member's id, the reason and the warning (%s)" % m)
    ok(who != "" and r.get("by") == who, "staff: the entry's words name the member who released it (%r)" % who)
    r = release(OWNER, 2, "O2", "checked the Day Book")
    ok(r.get("ok") is True and live(2) == "false" and marks(2) and marks(2)[0]["u"] == OWNER, "an owner still may (%s)" % (r.get("_error") or r.get("ok")))
    r = release(LOOK, 3, "L3", "looked")
    ok("42501" in r.get("_error", "") or "may post" in r.get("_error", "") or "only an owner" in r.get("_error", ""), "a look-only member is refused (%s)" % r.get("_error", r)[-120:])
    ok(live(3) == "true" and not marks(3) and db.one("select status from tally_post_jobs where id = %s" % q(J(3))) == "done", "and nothing changes")
    ok("error" in json.dumps(release(GONE, 4, "G4", "looked")) and live(4) == "true", "an inactive staff member is refused")
    ok("_error" in release(OTHER, 5, "R5", "looked") and live(5) == "true", "a member of another firm: no such posting, nothing changes")

    print("== 2. kept from 174")
    ok("say where" in release(STAFF, 5, "R5", "  ").get("_error", "") and live(5) == "true", "a reason required (staff)")
    for n, st in ((6, "waiting"), (7, "taken"), (8, "running")):
        job(n, st, "W%d" % n)
        r = release(STAFF, n, "W%d" % n, "looked")
        ok(r.get("ok") is False and "still being sent" in str(r.get("error")) and live(n) == "true", "never while it is %s (%s)" % (st, r.get("error") or r.get("_error")))

    print("== 3. privileges")
    priv = lambda role: db.one("select has_function_privilege(%s, 'public.tally_post_owner_release(uuid, text, text)', 'execute')::text" % q(role))
    ok(priv("anon") == "false" and priv("authenticated") == "true", "anon may not, authenticated may (%s / %s)" % (priv("anon"), priv("authenticated")))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
