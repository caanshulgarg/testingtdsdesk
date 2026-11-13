"""The posting queue on a throwaway PostgreSQL (pg_stand; never a real database), shared by run_migration184.py and
run_migration184.py: built as run_migration174.py builds it (32 -> ... -> 116 -> 127, then 111, 142, 128, 161) and 174
(live on staging), with made-up firms, logins and companies only. One shared server (SRV9), two Windows logins, each its
own key and bridge: A (made-up-a, the link's key and data folder) and B (made-up-b); the client c1 linked to CO (its GUID
and data location on the link record), posting allowed.
    st = post_queue_stand.Stand(port); st.db, st.rpc(uid, stmt), st.beat(...), st.setbeat(dev, info), st.psql_text(sql)
    st.pair(sql_a, sql_b, hold): two sessions at the same moment (a holds its transaction open `hold` seconds)"""
import os, sys, json, subprocess, datetime, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.join(HERE, "..")
SQLDIR = os.path.join(ROOT, "server", "tally-cloud")
src142 = open(os.path.join(HERE, "run_migration142.py")).read()
FILES = eval(compile(src142.split("\nFILES = ", 1)[1].split("\nfails = []", 1)[0], "run_migration142.py(FILES)", "eval"), {"os": os, "SQLDIR": SQLDIR, "HERE": HERE, "ROOT": ROOT})
FILES += [os.path.join(SQLDIR, f) for f in ("migration-111-post-register.sql", "migration-142-post-any-bridge.sql", "migration-128-client-removed-frees-tally.sql", "migration-161-split-tally.sql",
                                            "migration-174-post-jobs-safe.sql")]
F = "99999999-9999-9999-9999-999999999184"
OWNER, STAFF = "55555555-5555-5555-5555-555555555184", "66666666-6666-6666-6666-666666666184"
DA, DB = "d1000000-0000-0000-0000-0000000001a8", "d1000000-0000-0000-0000-0000000001b8"
BA, BB = "go-aaaa000184", "go-bbbb000184"
BK = "b0000001-0000-0000-0000-000000000184"
CO, GUID = "Made-up Heron Traders", "a1b2c3d4-0000-0000-0000-000000000184"
FOLDER = "C:\\TallyData\\Shared"
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
def fbody(t_, name):
    i = t_.index("create or replace function public." + name + "(")
    ends = [k for k in (t_.find("$function$;", i), t_.find("$$;", i), t_.find("$judge$;", i)) if k >= 0]
    return [l.strip() for l in t_[i:min(ends)].splitlines() if l.strip()]   # compared as text, indentation aside
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
class Stand:
    def __init__(self, port, extra=()):
        self.db = db = pg_stand.start(port)
        db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
        db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
        db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
                              alter role service_role bypassrls;
                              if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if; end $$;
          grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
          grant select on members to authenticated, service_role;
          insert into firms values (%(F)s, 'Made-up Firm 184') on conflict do nothing;
          insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true);
          create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
          insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%(DA)s, %(F)s, 'SRV9 · made-up-a', 'ha', '2.5.4', '{}', %(O)s),
            (%(DB)s, %(F)s, 'SRV9 · made-up-b', 'hb', '2.5.4', '{}', %(O)s);
          create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, updated_at timestamptz default now(), primary key (firm_id, id));
          create table if not exists public.tally_companies (firm_id uuid not null references public.firms(id) on delete cascade, company text not null, client_id text, gstin text,
            device_id uuid references public.tally_devices(id) on delete set null, first_seen timestamptz not null default now(), last_seen timestamptz, linked_at timestamptz, linked_by uuid,
            book_id uuid not null default gen_random_uuid() unique, primary key (firm_id, company));
          alter table public.tally_companies enable row level security;
          create policy tally_companies_read on public.tally_companies for select to authenticated using (firm_id = public.my_firm());
          grant select on public.tally_companies to authenticated;
          insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'Made-up Heron', '{}'), ('c2', %(F)s, 'Made-up Egret', '{}');
          insert into tally_companies (firm_id, company, client_id, device_id, last_seen, linked_at, book_id) values (%(F)s, %(CO)s, 'c1', %(DA)s, now(), now(), %(BK)s);
          insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%(BK)s, %(F)s, 'c1', %(CO)s, '2025-04-01');
          create table if not exists auth.users (id uuid primary key, email text);""" % {"F": q(F), "O": q(OWNER), "S": q(STAFF), "DA": q(DA), "DB": q(DB), "BK": q(BK), "CO": q(CO)})
        for path in list(FILES) + list(extra):
            r = self.psql_text(open(path).read())
            if r.returncode: db.stop(); raise SystemExit("%s does not run on the stand: %s" % (os.path.basename(path), r.stderr[-400:]))
        self.grants()
        self.setbeat(DA, self.beat("made-up-a", BA, [CO])); self.setbeat(DB, self.beat("made-up-b", BB, [CO]))
        db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(DA), q(BA))); db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(DB), q(BB)))
        self.loc = json.loads(db.one("select tally_link_loc(%s::uuid, %s, %s)::text" % (q(DA), q(BA), q(CO))))["loc"]
        db.sql("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, device_id, computer, posting_allowed, state, data_loc, data_folder, windows_user) values (%s, %s, 'c1', %s, %s, %s, 'SRV9', true, 'linked', %s, %s, 'SRV9\\made-up-a') on conflict (firm_id, book_id) do update set data_loc = excluded.data_loc, device_id = excluded.device_id, company_guid = excluded.company_guid, posting_allowed = true, state = 'linked', client_id = 'c1'"
               % (q(F), q(BK), q(GUID), q(CO), q(DA), q(self.loc), q(FOLDER)))
    def grants(self): self.db.sql("grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;")
    def _cmd(self): return ["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(self.db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"]
    def psql_text(self, sql): return subprocess.run(self._cmd() + ["-f", "-"], input=sql, capture_output=True, text=True)
    def rpc(self, uid, stmt, role="authenticated"):
        try: out = self.db.one("set role %s; %s" % (role, stmt), uid)
        except RuntimeError as e: return {"_error": str(e)[-400:]}
        try: return json.loads(out) if out else {}
        except (TypeError, ValueError): return {"_out": out}
    def beat(self, user, bridge, open_, ago=0, guid=GUID, folder=FOLDER, computer="SRV9"):
        at = iso(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=ago))
        return {"computer": computer, "beat": {"at": at, "windowsUser": computer + "\\" + user, "open": list(open_), "companies": [{"name": n, "guid": guid, "open": True} for n in open_]},
                "bridges": {bridge: {"at": at, "computer": computer, "user": computer + "\\" + user, "mode": "main", "open": list(open_), "tallyPort": 9000, "dataFolder": folder}}}
    def setbeat(self, dev, info): self.db.sql("update tally_devices set info = %s, last_seen = now() where id = %s" % (q(json.dumps(info)), q(dev)))
    def pair(self, sql_a, sql_b, hold=1.5, gap=0.5, pre_a="", pre_b=""):
        """two sessions at the same moment: a runs sql_a and keeps its transaction open `hold` seconds; b starts `gap` seconds
        after a and runs sql_b. hold 0: both started together, each its own statement. -> (out a, out b) as text (or ERROR: ...)"""
        if hold: a_in = "%s\nbegin;\n%s\nselect pg_sleep(%s);\ncommit;\n" % (pre_a, sql_a, hold)
        else: a_in = "%s\n%s\n" % (pre_a, sql_a)
        pa = subprocess.Popen(self._cmd() + ["-At", "-f", "-"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        pa.stdin.write(a_in); pa.stdin.close()
        if hold: time.sleep(gap)
        pb = subprocess.Popen(self._cmd() + ["-At", "-f", "-"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        pb.stdin.write("%s\n%s\n" % (pre_b, sql_b)); pb.stdin.close()
        out = []
        for p in (pa, pb):
            o, e = p.stdout.read(), p.stderr.read(); p.wait()
            out.append(("ERROR: " + e.strip()[-300:]) if p.returncode else "\n".join(l for l in o.splitlines() if l.strip()))
        return out[0], out[1]
    def stop(self): self.db.stop()
