"""python3 tests/run_migration186.py - server/video-calls/migration-186-call-private-channels.sql (13-Nov-2026, branch
next-sec-db): who may listen and speak on a call's private Realtime channel. On a throwaway PostgreSQL (pg_stand, port
31886 unless PG186_PORT; never a real database), made-up people and rooms only; a stand-in for Realtime's own table and
its realtime.topic() (a setting, as Realtime gives it), asked the way Realtime asks: as the person's role, with their
sign-in's claims and the channel's name set, a read and a write of realtime.messages.
  0. the file: one transaction, lock_timeout 10 s; add-only (three functions, two policies); names no real database;
     its md5
  1. runs, and a second time
  2. the names: call_topic and call_lobby_topic give what app/src/calls/rules.js (topicFor, sha256Hex) and fincom-call
     give for the same key, epoch and firm (asked of rules.js itself, with node)
  3. members: the people in the call listen and speak on its channel, on working together while it is on, and on their
     firm's lobby; a member of the firm not in the call only the lobby; another firm's member, a removed one, one who
     left, one whose two-step is not done: no; a person away too long (not yet back): yes; the name before someone was
     removed, an ended room: nobody
  4. guests: the admitted guest with a pass for that room: its call channel only (never working together, a lobby or
     another room); waiting or removed, a pass naming another room or a member's row, a pass that is not readable,
     no pass: no
  5. only broadcast and presence; the two policies and no other; nothing may be changed or removed through them
  6. grants: call_channel_ok for anon and authenticated (the policies ask it as them); the two name functions for
     nobody; a database without Realtime: the file runs
RED_WITHOUT_186=1: the same checks without running 186 (2, 3 and 4's yes cases, 5 and 6 fail)."""
import os, re, sys, json, hashlib, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, "..")); sys.path.insert(0, HERE)
import pg_stand
M186 = os.path.join(ROOT, "server", "video-calls", "migration-186-call-private-channels.sql")
RED = os.environ.get("RED_WITHOUT_186") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M186).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M186), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(code.count("begin;") == 1 and code.count("commit;") == 1 and code.strip().startswith("begin;") and code.strip().endswith("commit;")
   and "set local lock_timeout = '10s';" in code, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\b|\btruncate\b|delete\s+from|create\s+(table|index|trigger)|alter\s+|\binsert\s+into\b|\bupdate\s+[a-z_.]+\s+set\b", code)
   and len(re.findall(r"create or replace function", code)) == 3 and len(re.findall(r"create policy", code)) == 2, "add-only: three functions, two policies, nothing else")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", text.lower()), "names no real database")

F1, F2 = "99999999-9999-4999-8999-999999990186", "88888888-8888-4888-8888-888888880186"
U = {k: "aaaaaaaa-0186-4000-8000-%012d" % i for i, k in enumerate(["host", "staff", "idle", "other", "removed", "stale", "left", "aal1"], 1)}
P = {k: "bbbbbbbb-0186-4000-8000-%012d" % i for i, k in enumerate(["host", "staff", "removed", "stale", "left", "aal1", "g_in", "g_wait", "g_removed", "g_stale", "other", "g_other"], 1)}
RA, RB, RC = ("cccccccc-0186-4000-8000-00000000000%d" % i for i in (1, 2, 3))
KA, KB, KC = "madeupkeyA0186" * 4, "madeupkeyB0186" * 4, "madeupkeyC0186" * 4
SECRET = "made-up-guest-signing-secret-0186-0186-0186-0186"
q = lambda s: "'" + str(s).replace("'", "''") + "'"
NODE = shutil.which("node")
js = """import(%s).then(async (R) => { const o = { call2: await R.topicFor(%s, 2), call1: await R.topicFor(%s, 1), cowork3: await R.topicFor(%s, 3, "cowork"), cowork2: await R.topicFor(%s, 2, "cowork"),
  ended: await R.topicFor(%s, 1), other: await R.topicFor(%s, 1), lobby1: "lobby:" + (await R.sha256Hex(%s + ":lobby:" + %s)).slice(0, 40), lobby2: "lobby:" + (await R.sha256Hex(%s + ":lobby:" + %s)).slice(0, 40) };
  console.log(JSON.stringify(o)); });""" % tuple(json.dumps(x) for x in ("file://" + os.path.join(ROOT, "app", "src", "calls", "rules.js"), KA, KA, KA, KA, KB, KC, SECRET, F1, SECRET, F2))
T = json.loads(subprocess.run([NODE, "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout)

SETUP = """
do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$;
grant usage on schema public, auth to anon, authenticated, service_role;
create table platform_secrets (name text primary key, value text); alter table platform_secrets enable row level security;
insert into platform_secrets values ('call_guest_secret', %(secret)s);
-- two-step: a member whose sign-in has not done it has no firm (as the real my_firm())
create table t_aal1 (user_id uuid primary key);
create or replace function my_firm() returns uuid language sql stable security definer set search_path = public as $f$
  select firm_id from members where user_id = auth.uid() and active and not exists (select 1 from t_aal1 a where a.user_id = auth.uid()) $f$;
create table call_rooms (id uuid primary key, firm_id uuid not null, kind text default 'meeting', status text not null default 'open', chan_key text not null, chan_epoch int not null default 1,
  cowork_on boolean not null default false, cowork_epoch int not null default 1, host_user uuid);
create table call_participants (id uuid primary key, room_id uuid not null references call_rooms(id), firm_id uuid not null, user_id uuid, name text default '', role text not null, state text not null default 'waiting',
  admitted_at timestamptz, left_at timestamptz, left_why text);
alter table call_rooms enable row level security; alter table call_participants enable row level security;
-- Realtime's own: the table its policies are written on, and the channel's name as it hands it to them
create schema realtime;
create table realtime.messages (id uuid default gen_random_uuid(), topic text not null, extension text not null, payload jsonb, event text, private boolean default true, inserted_at timestamptz default now());
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $f$ select nullif(current_setting('realtime.topic', true), '') $f$;
grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert, update, delete on realtime.messages to anon, authenticated;
insert into firms values (%(F1)s, 'Made-up Firm One'), (%(F2)s, 'Made-up Firm Two');
insert into members (user_id, firm_id, name, role) values (%(host)s, %(F1)s, 'Made-up Host', 'owner'), (%(staff)s, %(F1)s, 'Made-up Staff', 'staff'), (%(idle)s, %(F1)s, 'Made-up Idle', 'staff'),
  (%(removed)s, %(F1)s, 'Made-up Removed', 'staff'), (%(stale)s, %(F1)s, 'Made-up Away', 'staff'), (%(left)s, %(F1)s, 'Made-up Left', 'staff'), (%(aal1)s, %(F1)s, 'Made-up One Step', 'staff'),
  (%(other)s, %(F2)s, 'Made-up Other', 'owner');
insert into t_aal1 values (%(aal1)s);
insert into call_rooms (id, firm_id, status, chan_key, chan_epoch, cowork_on, cowork_epoch, host_user) values
  (%(RA)s, %(F1)s, 'open', %(KA)s, 2, true, 3, %(host)s), (%(RB)s, %(F1)s, 'ended', %(KB)s, 1, false, 1, %(host)s), (%(RC)s, %(F2)s, 'open', %(KC)s, 1, false, 1, %(other)s);
insert into call_participants (id, room_id, firm_id, user_id, role, state, admitted_at, left_why) values
  (%(p_host)s, %(RA)s, %(F1)s, %(host)s, 'host', 'admitted', now(), null), (%(p_staff)s, %(RA)s, %(F1)s, %(staff)s, 'member', 'admitted', now(), null),
  (%(p_removed)s, %(RA)s, %(F1)s, %(removed)s, 'member', 'removed', now(), null), (%(p_stale)s, %(RA)s, %(F1)s, %(stale)s, 'member', 'left', now(), 'stale'),
  (%(p_left)s, %(RA)s, %(F1)s, %(left)s, 'member', 'left', now(), null), (%(p_aal1)s, %(RA)s, %(F1)s, %(aal1)s, 'member', 'admitted', now(), null),
  (%(p_g_in)s, %(RA)s, %(F1)s, null, 'guest', 'admitted', now(), null), (%(p_g_wait)s, %(RA)s, %(F1)s, null, 'guest', 'waiting', null, null),
  (%(p_g_removed)s, %(RA)s, %(F1)s, null, 'guest', 'removed', now(), null), (%(p_g_stale)s, %(RA)s, %(F1)s, null, 'guest', 'left', now(), 'stale'),
  (%(p_other)s, %(RC)s, %(F2)s, %(other)s, 'host', 'admitted', now(), null), (%(p_g_other)s, %(RC)s, %(F2)s, null, 'guest', 'admitted', now(), null),
  (gen_random_uuid(), %(RB)s, %(F1)s, %(host)s, 'host', 'admitted', now(), null);
""" % dict({k: q(v) for k, v in U.items()}, **{"p_" + k: q(v) for k, v in P.items()}, F1=q(F1), F2=q(F2), RA=q(RA), RB=q(RB), RC=q(RC), KA=q(KA), KB=q(KB), KC=q(KC), secret=q(SECRET))

db = pg_stand.start(int(os.environ.get("PG186_PORT") or 31886))
def may(topic, uid=None, pass_=None, ext="broadcast", raw_claims=None):
    """-> (listen, speak) as Realtime asks: the role, the claims, the channel's name; a write (rolled back) and a read"""
    claims = raw_claims if raw_claims is not None else json.dumps(dict({"role": "authenticated" if uid else "anon"}, **({"sub": uid} if uid else {}), **({"fincom_call": pass_} if pass_ is not None else {})))
    pre = "begin; set local role %s; set local fincom.uid = %s; set local request.jwt.claims = %s; set local realtime.topic = %s;" % ("authenticated" if uid else "anon", q(uid or ""), q(claims), q(topic))
    try: speak = db.one(pre + " insert into realtime.messages (topic, extension, event) values (%s, %s, 'made-up') returning 'yes'; rollback;" % (q(topic), q(ext))) == "yes"
    except RuntimeError: speak = False
    try: listen = int(db.one(pre + " select count(*) from realtime.messages where topic = %s and extension = %s; rollback;" % (q(topic), q(ext)))) > 0
    except RuntimeError: listen = False
    return listen, speak
YES, NO = (True, True), (False, False)
try:
    db.sql(SETUP)
    db.sql("insert into realtime.messages (topic, extension, event) select t, e, 'made-up' from unnest(array[%s]) t cross join unnest(array['broadcast', 'presence', 'postgres_changes']) e;" % ", ".join(q(v) for v in T.values()))
    print("== 1. runs")
    if not RED:
        e = ""
        try: db.sql(text); db.sql(text)
        except RuntimeError as x: e = str(x)
        ok(not e, "runs, and a second time" + (": " + e[-400:] if e else ""))
    print("== 2. the names")
    try:
        n = db.rows("select public.call_topic(%s, 2) as call2, public.call_topic(%s, 3, 'cowork') as cowork3, public.call_lobby_topic(%s) as lobby1, public.call_lobby_topic(%s) as lobby2" % (q(KA), q(KA), q(F1), q(F2)))[0]
    except RuntimeError: n = {}
    ok(n == {k: T[k] for k in ("call2", "cowork3", "lobby1", "lobby2")}, "call, working together and lobby names equal rules.js's and fincom-call's (%s)" % T["call2"])
    ok(len(set(T.values())) == len(T), "every name different (another epoch, part, room or firm)")
    try: short = db.one("update platform_secrets set value = 'short'; select coalesce(public.call_lobby_topic(%s), 'none'); " % q(F1))
    except RuntimeError: short = "?"
    db.sql("update platform_secrets set value = %s;" % q(SECRET))
    ok(short == "none", "no lobby name while the server has no signing secret")
    print("== 3. members")
    for who in ("host", "staff"):
        ok(may(T["call2"], U[who]) == YES and may(T["call2"], U[who], ext="presence") == YES and may(T["cowork3"], U[who]) == YES and may(T["lobby1"], U[who]) == YES,
           "%s in the call: its channel (broadcast and presence), working together, the firm's lobby" % who)
    ok(may(T["call2"], U["idle"]) == NO and may(T["cowork3"], U["idle"]) == NO and may(T["lobby1"], U["idle"]) == YES, "a member of the firm not in the call: the lobby only")
    ok(all(may(T[t], U["other"]) == NO for t in ("call2", "cowork3", "lobby1")) and may(T["lobby2"], U["other"]) == YES and may(T["other"], U["other"]) == YES, "another firm's member: nothing of this firm; their own lobby and call")
    ok(may(T["other"], U["host"]) == NO and may(T["lobby2"], U["host"]) == NO, "and this firm's host nothing of theirs")
    ok(may(T["call2"], U["removed"]) == NO and may(T["cowork3"], U["removed"]) == NO, "a removed member: no")
    ok(may(T["call2"], U["left"]) == NO, "one who left: no")
    ok(may(T["call2"], U["stale"]) == YES, "one away too long, not yet back: yes")
    ok(may(T["call2"], U["aal1"]) == NO and may(T["lobby1"], U["aal1"]) == NO, "one whose two-step is not done: no")
    ok(may(T["call1"], U["host"]) == NO and may(T["cowork2"], U["host"]) == NO, "the names before someone was removed: nobody")
    ok(may(T["ended"], U["host"]) == NO, "an ended room: nobody")
    db.sql("update call_rooms set cowork_on = false where id = %s;" % q(RA))
    ok(may(T["cowork3"], U["host"]) == NO and may(T["call2"], U["host"]) == YES, "working together off: its channel closed, the call's open")
    db.sql("update call_rooms set cowork_on = true where id = %s;" % q(RA))
    ok(may("call:" + "0" * 40, U["host"]) == NO and may("anything", U["host"]) == NO and may(T["call2"].upper(), U["host"]) == NO, "a name that is not a room's: no")
    print("== 4. guests")
    gp = lambda p, r=RA: {"room": r, "participant": P[p]}
    ok(may(T["call2"], None, gp("g_in")) == YES and may(T["call2"], None, gp("g_in"), ext="presence") == YES, "the admitted guest with its pass: the call's channel")
    ok(may(T["cowork3"], None, gp("g_in")) == NO and may(T["lobby1"], None, gp("g_in")) == NO and may(T["other"], None, gp("g_in")) == NO and may(T["call1"], None, gp("g_in")) == NO,
       "never working together, the lobby, another room or an old name")
    ok(may(T["call2"], None, gp("g_wait")) == NO and may(T["call2"], None, gp("g_removed")) == NO, "a waiting or removed guest: no")
    ok(may(T["call2"], None, gp("g_stale")) == YES, "a guest away too long, not yet back: yes")
    ok(may(T["call2"], None, gp("g_other", RC)) == NO and may(T["call2"], None, gp("g_other", RA)) == NO and may(T["call2"], None, gp("g_in", RC)) == NO, "a pass for another room, or naming a room the guest is not in: no")
    ok(may(T["call2"], None, gp("host")) == NO and may(T["call2"], None, gp("staff")) == NO, "a pass naming a member's row: no")
    ok(may(T["call2"], None, {"room": "x", "participant": "y"}) == NO and may(T["call2"], None, "text") == NO and may(T["call2"], None, {}) == NO and may(T["call2"], None, None) == NO
       and may(T["call2"], None, raw_claims="") == NO, "a pass that is not readable, an empty one, none: no (and no error)")
    print("== 5. broadcast and presence only; the policies")
    ok(may(T["call2"], U["host"], ext="postgres_changes") == NO and may(T["call2"], None, gp("g_in"), ext="postgres_changes") == NO, "another kind of message: no")
    pol = db.rows("select policyname, cmd, roles::text as roles, permissive from pg_policies where schemaname = 'realtime' and tablename = 'messages' order by 1")
    ok([(p["policyname"], p["cmd"]) for p in pol] == [("fincom_call_listen", "SELECT"), ("fincom_call_speak", "INSERT")] and all(p["roles"] == "{anon,authenticated}" for p in pol), "two policies, listen (select) and speak (insert): %s" % [(p["policyname"], p["cmd"], p["roles"]) for p in pol])
    pre = "set role authenticated; set fincom.uid = %s; set request.jwt.claims = %s; set realtime.topic = %s;" % (q(U["host"]), q(json.dumps({"role": "authenticated", "sub": U["host"]})), q(T["call2"]))
    n0 = db.one("select count(*) from realtime.messages")
    db.sql(pre + " update realtime.messages set event = 'changed'; delete from realtime.messages;")
    ok(db.one("select count(*)::text || ':' || count(*) filter (where event = 'changed') from realtime.messages") == n0 + ":0", "nothing changed or removed through them")
    print("== 6. grants")
    g = {r["f"]: r["a"] for r in db.rows("select p.proname as f, coalesce((select string_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end, ',' order by 1) from aclexplode(p.proacl) a where a.grantee <> p.proowner), '') as a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('call_topic', 'call_lobby_topic', 'call_channel_ok')")}
    ok(g == {"call_topic": "", "call_lobby_topic": "", "call_channel_ok": "anon,authenticated,service_role"}, "call_channel_ok for anon and authenticated; the name functions for nobody: %s" % g)
    try: leak = db.one("set role authenticated; set fincom.uid = %s; select public.call_lobby_topic(%s)" % (q(U["other"]), q(F1)))
    except RuntimeError as x: leak = "refused" if "permission denied" in str(x) else "?"
    ok(leak == "refused", "a signed-in person cannot ask for a firm's lobby name")
    if not RED:
        db.sql("alter schema realtime rename to realtime_away;")
        e = ""
        try: db.sql(text)
        except RuntimeError as x: e = str(x)
        ok(not e, "a database without Realtime: the file runs" + (": " + e[-300:] if e else ""))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
