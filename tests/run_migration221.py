"""python3 run_migration221.py - server/tally-cloud/migration-221-tally-tell.sql (24-Nov-2026, branch next-tally-tell-sql; the
owner, 24-Nov-2026: "There should be proper way to tell and auto import of tally days into fincom"; the plan's part A).
On a throwaway PostgreSQL (tests/tell_stand.py: port 31221 unless PG221_PORT, its data under /tmp/tell221 unless PG221_DIR,
removed after; never a real database), made-up firm, books and computers only. Written before the file.
  0. the file: one transaction, lock_timeout 10 s; add-only (one table, one column, the kind CHECK swapped only while it is
     47's, no drop / delete / truncate); names no real database; security definer with search_path public, pg_temp on every
     function; its grants (the view: authenticated only; everything else nobody's); runs twice; the name guard stops it
     over another tally_tell_of, or over a tally_alert_scan_silent that is not 47's text; md5 printed
  1. every cause 1-16 gives exactly its sentence (and Reading / Posting / Changes as A.1 says); the precedence holds when
     several apply; B.8's earlier-year line
  2. addon_silent at 1.9 and 2.1 working hours; a night or Sunday not counted (the working-hours helper); cleared by a line
  3. the bell: raised only after 30 working minutes and only when something is affected; written in place when the cause
     changes; cleared when it goes; one row a book; never for days_waiting
  4. tally_tell_view: members only (anon, another firm's member refused); the owner every computer, staff only their own;
     the computers' A.2 lines
  5. the plain-word rules: at most 14 words (the company counted as one), no "warning" / "error", no GUID or port number
  6. tally_alert_scan_silent is a no-op keeping its name; the per-computer silent rows are no longer written
  (review of 24-Nov-2026) H1 run_as_admin only for an open Tally whose owner Windows cannot tell, owners told, none of
  the user's own open; H2 the add-on line not over an 'already' tally.ini or a company already recording; H3 every
  computer line one action; H4 the bell never rings, clears and rings again (A, B, A, gone one scan, A: one row, read);
  M1 no book bell for no_bridge / bridge_off, 2 working hours for Tally closed / not open; M2 one bad book never breaks
  the view; L1 a cleared row is read; L2 an unlinked book never rings, shown until its days are parked; L3 a posting
  counts for its own company's book; L4 the cron job's name guarded
RED_WITHOUT_221=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib, datetime
os.environ["TMPDIR"] = os.environ.get("PG221_DIR") or "/tmp/tell221"
os.makedirs(os.environ["TMPDIR"], exist_ok=True); os.chmod(os.environ["TMPDIR"], 0o777)
os.environ.setdefault("PG_STAND_SOCKDIR", os.environ["TMPDIR"])
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tell_stand as T
from tell_stand import q, js, F, OWNER, STAFF, LOOK
RED = os.environ.get("RED_WITHOUT_221") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

text = open(T.M221).read() if os.path.exists(T.M221) and not RED else ""
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
print("== 0. the file")
ok(bool(text), "the migration file is there")
if text: print("  md5 of %s: %s (%d bytes)" % (os.path.basename(T.M221), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "one transaction, lock_timeout 10 s")
body = re.sub(r"\$function\$.*?\$function\$", "", code, flags=re.S)
alters = re.findall(r"\balter\s+table\s+(public\.\w+)\s+(\w+(?:\s+\w+){0,4})", body)
ok(bool(text) and "delete from" not in body and not re.search(r"\b(truncate|drop\s+(table|function|column|index|trigger|policy))\b", body) and "insert into" not in body
   and sorted(alters) == sorted([("public.tally_alerts", "add column if not exists"), ("public.tally_alerts", "drop constraint"), ("public.tally_tell_state", "enable row level security")] + [("public.tally_tell_state", "add column if not exists")] * 3) and "add column if not exists cleared_at timestamptz;" in body,
   "add-only: the new table's row security, cleared_at added, the kind CHECK swapped (%s)" % alters)
ok("pg_get_constraintdef(con.oid) = old_def" in text and "''gap''::text, ''silent''::text, ''summary''::text" in text, "the kind CHECK swapped only while it is exactly 47's")
ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://|project[_ ]ref", low), "names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_alert_scan_silent", "tally_tell_device", "tally_tell_of", "tally_tell_of_safe", "tally_tell_old", "tally_tell_pc", "tally_tell_scan", "tally_tell_view"], "seven new functions and the silent scan replaced (%s)" % FNS)
nfn = len(re.findall(r"create or replace function public\.", text))
ok(bool(text) and low.count("security definer set search_path = public, pg_temp") == nfn, "every function: security definer, search_path public, pg_temp (%d of %d)" % (low.count("security definer set search_path = public, pg_temp"), nfn))
for g in ("revoke all on function public.tally_tell_of(uuid) from public, anon, authenticated, service_role;", "revoke all on function public.tally_tell_scan() from public, anon, authenticated, service_role;",
          "revoke all on function public.tally_tell_device(uuid) from public, anon, authenticated, service_role;", "revoke all on function public.tally_tell_view() from public, anon, service_role;",
          "grant execute on function public.tally_tell_view() to authenticated;", "revoke all on function public.tally_alert_scan_silent() from public, anon, authenticated, service_role;",
          "revoke all on table public.tally_tell_state from public, anon, authenticated, service_role;",
          "perform cron.schedule('tally-tell-scan', '4-59/10 * * * *', 'select public.tally_tell_scan()');"):
    ok(g in text, "explicit: " + g[:100])
ok(len(re.findall(r"^\s*grant ", code, re.M)) == 1, "one grant only (the view, to authenticated)")

st = T.build(int(os.environ.get("PG221_PORT") or 31221)); db = st.db; j = st.j
def bye():
    st.stop()
    try: os.rmdir(os.environ["TMPDIR"])
    except OSError: pass
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
def iso(dt): return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
NOW = datetime.datetime.now(datetime.timezone.utc)
def back(hours):
    """the moment `hours` working hours (Mon-Sat 09:00-19:00 India time) before now, a minute at a time"""
    t, left = NOW, round(hours * 60)
    while left > 0:
        t -= datetime.timedelta(minutes=1); l = t.astimezone(IST)
        if l.isoweekday() <= 6 and 9 <= l.hour < 19: left -= 1
    return t
TODAY = NOW.astimezone(IST).date()
FY = datetime.date(TODAY.year if TODAY.month >= 4 else TODAY.year - 1, 4, 1)
BK = {k: "819d4a59-4cee-4bf7-8f8c-0000000%02d221" % k for k in range(1, 8)}
CG = {k: "b20abc61-0000-4000-8000-79149af%02d221" % k for k in range(1, 8)}
DA, DB = "dddddddd-0000-4000-8000-00000000a221", "dddddddd-0000-4000-8000-00000000b221"
BA, BB = "go-aaaaaa221221", "go-bbbbbb221221"
CO = lambda k: "MADE UP TRADERS %d" % k
F2, OTHER = "88888888-8888-8888-8888-888888888221", "44444444-4444-4444-4444-444444444221"
try:
    db.sql("insert into firms values (%s, 'Another Firm') on conflict do nothing; insert into members values (%s, %s, 'Elsewhere', 'owner', true)" % (q(F2), q(OTHER), q(F2)))
    for k, b in BK.items():
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, %s, %s, %s, %s)" % (q(b), q(F), q("c%d" % k), q(CO(k)), q(FY.isoformat()), q((FY - datetime.timedelta(days=1)).isoformat())))
    if text:
        for i in (1, 2):
            r = st.psql_text(text); ok(r.returncode == 0, "runs (%s time)%s" % ("first" if i == 1 else "second", "" if not r.returncode else ": " + r.stderr[-300:]))
        db.sql("create function public.tally_tell_of(p_x int) returns int language sql as 'select 1'")
        r = st.psql_text(text); ok(r.returncode != 0 and "already used by something else: function tally_tell_of" in r.stderr, "the name guard stops it over another tally_tell_of (%s)" % r.stderr.strip()[-120:])
        db.sql("drop function public.tally_tell_of(int)")
        # L4: the cron job's name guarded as the functions' are
        ok(db.one("select schedule || ' ' || command from cron.job where jobname = 'tally-tell-scan'") == "4-59/10 * * * * select public.tally_tell_scan()", "the job scheduled (the stand's pg_cron)")
        db.sql("update cron.job set command = 'select something_else()' where jobname = 'tally-tell-scan'")
        r = st.psql_text(text); ok(r.returncode != 0 and "job tally-tell-scan" in r.stderr, "the guard stops it over a cron job 'tally-tell-scan' that runs something else (%s)" % r.stderr.strip()[-120:])
        db.sql("update cron.job set command = 'select public.tally_tell_scan()' where jobname = 'tally-tell-scan'")
        ok(db.one("select pg_get_constraintdef(oid) from pg_constraint where conname = 'tally_alerts_kind_check'") == "CHECK ((kind = ANY (ARRAY['gap'::text, 'silent'::text, 'summary'::text, 'tell'::text])))", "the kind CHECK takes 'tell', the same name")
    def can(fn, role):
        try: return db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q(fn)))
        except RuntimeError: return None      # no such function (RED)
    ok(can("public.tally_tell_view()", "authenticated") == "t" and can("public.tally_tell_view()", "anon") == "f" and can("public.tally_tell_view()", "service_role") == "f", "the view: authenticated only")
    ok(all(can(f, r) == "f" for f in ("public.tally_tell_of(uuid)", "public.tally_tell_of_safe(uuid)", "public.tally_tell_scan()", "public.tally_tell_device(uuid)") for r in ("anon", "authenticated", "service_role")), "tally_tell_of, _scan, _device: nobody's")

    # ---- the world, set per case
    def reset():
        db.sql("""delete from tally_links; delete from tally_bridge_ids; delete from tally_devices; delete from tally_check_days; delete from tally_recorder_lines; delete from tally_sync_cursor;
                  delete from tally_post_jobs; delete from tally_alerts; delete from tally_member_bridges""" + ("; delete from tally_tell_state" if text else ""))
    def link(k, guid=None, linked_ago="2 days", state="linked"):
        db.sql("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, state, linked_at, device_id) values (%s, %s, %s, %s, %s, %s, now() - interval %s, %s)"
               % (q(F), q(BK[k]), q("c%d" % k), q(guid or CG[k]), q(CO(k)), q(state), q(linked_ago), q(DA)))
    def cursor(k, start=True, max_alter=500, last_at=None):
        db.sql("insert into tally_sync_cursor (book_id, firm_id, start_at, recorder_max_alter, recorder_last_at) values (%s, %s, %s, %d, %s)"
               % (q(BK[k]), q(F), "now() - interval '5 days'" if start else "null", max_alter, q(iso(last_at)) if last_at else "now() - interval '5 minutes'"))
    def device(dev, bridge, ago_min=0, version="2.5.20", cos=None, state="open", beat=None, fetch=True, tell=None, stopped=False, seen_ago=None, created_by=None, name="MADEUP\\PC-%s"):
        at = iso(NOW - datetime.timedelta(minutes=ago_min))
        br = {"at": at, "version": version, "cos": cos if cos is not None else [], "tallyState": state}
        if tell is not None: br["tell"] = tell
        if stopped: br["readStopped"] = {"at": at}
        bt = {"bridge": bridge, "version": version, "tallyState": state, "companies": [], "paused": False}
        bt.update(beat or {})
        db.sql("insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen, version, created_by) values (%s, %s, %s, 'kh-' || %s, %s, %s, now() - interval '%d minutes', %s, %s)"
               % (q(dev), q(F), q(name % dev[-4].upper()), q(dev), js({"bridges": {bridge: br}, "beat": bt, "computer": name % dev[-4].upper()}), "true" if fetch else "false", seen_ago if seen_ago is not None else ago_min, q(version), q(created_by)))
        db.sql("insert into tally_bridge_ids (bridge_id, device_id, firm_id) values (%s, %s, %s)" % (q(bridge), q(dev), q(F)))
    def serving(k, **kw):   # a bridge that has the company open with the link's GUID
        kw.setdefault("cos", [[CO(k), CG[k]]])
        kw.setdefault("beat", {"companies": [{"name": CO(k), "guid": CG[k], "open": True, "altvchid": 500}]})
        device(DA, BA, **kw)
    def day(k, d, **cols):
        c = {"book_id": q(BK[k]), "firm_id": q(F), "day": q(d.isoformat()), "source": q(cols.pop("source", "held"))}
        for kk, v in cols.items(): c[kk] = v
        db.sql("insert into tally_check_days (%s) values (%s)" % (", ".join(c), ", ".join(c.values())))
    def line(k, d, state="fetching", ago="1 hour"):
        db.sql("insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, received_at, state, vch_date) values (%s, %s, %s, %s, %s, 'altered', now() - interval %s, %s, %s)"
               % (q(F), q("c%d" % k), q(BK[k]), q(DA), q("ln-%s-%s" % (d, state)), q(ago), q(state), q(d.isoformat())))
    tell = lambda k: (j("select tally_tell_of(%s)::text" % q(BK[k])) if text else {"_error": "no file"}) or {}
    cause = lambda t: (t.get("cause") or {}) if isinstance(t, dict) else {}
    seen = {}
    def case(n, k, want_code, want_words, read=None, post=None, changes=None, fix=None):
        t = tell(k); c = cause(t); seen[want_code] = c.get("words")
        good = c.get("code") == want_code and c.get("words") == want_words and (fix is None or c.get("fix") == fix)
        for line_, w in (("read", read), ("post", post), ("changes", changes)):
            if w is not None: good = good and ((t.get(line_) or {}).get("code") == (w or None))
        ok(good, "1.%s %s: %r%s (%s)" % (n, want_code, want_words, (" [%s]" % fix) if fix else "", json.dumps(t)[:600]))
        return t
    Y = TODAY - datetime.timedelta(days=1)
    POST = "Entries go to Tally when %s is open in Tally." % CO(1)

    print("== 1. every cause, its sentence")
    reset(); cursor(1); day(1, Y)
    t = case(1, 1, "not_linked", "Link %s to its client to bring its books." % CO(1), read="not_linked", post="not_linked", changes="not_linked", fix="link")
    reset(); link(1); cursor(1); day(1, Y)
    case(2, 1, "no_bridge", "Install FinCom Bridge on the computer where you use Tally.", fix="download")
    reset(); link(1); cursor(1); serving(1, ago_min=10)
    case(3, 1, "bridge_off", "Start FinCom Bridge on the computer where you use Tally.")
    reset(); link(1); cursor(1); serving(1, version="2.5.6")
    t = case(4, 1, "old_bridge", "Update FinCom Bridge on the computer where you use Tally.", read="old_bridge", post="", changes="old_bridge", fix="update")
    reset(); link(1); cursor(1); device(DA, BA, state="closed", beat={"tallyWhy": "no Tally running in this login", "companies": [{"name": CO(1), "guid": CG[1], "open": False}]})
    t = case(5, 1, "tally_closed", "Tally is closed. Open %s in Tally." % CO(1), read="tally_closed", post="tally_closed", changes="")
    ok((t.get("post") or {}).get("words") == POST, "1.5 posting is never said as stopped: %r" % (t.get("post") or {}).get("words"))
    reset(); link(1); cursor(1); device(DA, BA, cos=[["ANOTHER MADE UP CO", "c0ffee00-0000-4000-8000-000000000221"]])
    case(6, 1, "not_open", "Open %s in Tally." % CO(1))
    reset(); link(1); cursor(1); device(DA, BA, tell={"skip": {CO(1): "ownerUnknown"}})
    case(7, 1, "run_as_admin", "Open %s in your own Tally, not with 'Run as administrator'." % CO(1), changes="run_as_admin")
    reset(); link(1); cursor(1); device(DA, BA, tell={"skip": {CO(1): "twoTallys"}})
    case(8, 1, "two_tallys", "%s is open in two Tallys. Close it in one." % CO(1), post="two_tallys", changes="")
    reset(); link(1); cursor(1); serving(1, tell={"skip": {CO(1): "twoTallys"}})
    case("8b", 1, "two_tallys", "%s is open in two Tallys. Close it in one." % CO(1))
    reset(); link(1); cursor(1); device(DA, BA, tell={"skip": {CO(1): "otherLogin"}})
    case(9, 1, "other_login", "%s is open in another person's Windows login. Open it in yours." % CO(1))
    reset(); link(1); cursor(1); device(DA, BA, cos=[[CO(1), "c0ffee00-0000-4000-8000-0000000c0221"]])
    case(10, 1, "other_copy", "The %s open in Tally is another copy. Open the linked one." % CO(1))
    reset(); link(1); cursor(1); serving(1, fetch=False)
    case(11, 1, "reading_off", "Reading from Tally is off for this computer. Turn it on.", read="reading_off", post="", changes="reading_off", fix="turn_on")
    reset(); link(1); cursor(1); serving(1, beat={"paused": True, "companies": [{"name": CO(1), "guid": CG[1], "open": True, "altvchid": 500}]})
    case(12, 1, "paused", "Reading is paused in the FinCom Bridge tray icon. Click Resume there.", post="")
    reset(); link(1); cursor(1); serving(1, stopped=True)
    case("12b", 1, "read_stopped", "Reading was stopped from FinCom. Resume it.", fix="resume")
    reset(); link(1, linked_ago="1 hour"); cursor(1, start=False); serving(1, beat={"companies": [{"name": CO(1), "guid": CG[1], "open": True}]})
    case(13, 1, "no_start", "Open %s in your own Tally once, so FinCom can start reading it." % CO(1), post="")
    reset(); link(1, linked_ago="1 hour"); cursor(1, start=False); serving(1, beat={"companies": [{"name": CO(1), "guid": CG[1], "open": True}]}, tell={"numbersWhy": {CO(1): "ownerUnknown"}})
    case("13b", 1, "run_as_admin", "Open %s in your own Tally, not with 'Run as administrator'." % CO(1))
    reset(); link(1); cursor(1); serving(1, tell={"unstarted": {CO(1): {"why": "noNumbers", "since": iso(NOW - datetime.timedelta(minutes=12))}}})
    case("13d", 1, "no_start", "Open %s in your own Tally once, so FinCom can start reading it." % CO(1))
    reset(); link(1); cursor(1); serving(1, tell={"unstarted": {CO(1): {"why": "noStart", "since": iso(NOW - datetime.timedelta(minutes=4))}}})
    t = tell(1); ok(cause(t).get("code") is None, "1.13e tally-ingest's unstarted word only after 10 minutes (%s)" % cause(t))
    reset(); link(1, linked_ago="5 minutes"); cursor(1, start=False); serving(1, beat={"companies": [{"name": CO(1), "guid": CG[1], "open": True}]})
    t = tell(1); ok(cause(t).get("code") is None, "1.13c no_start only after 10 minutes linked (%s)" % cause(t))
    reset(); link(1); cursor(1, max_alter=480, last_at=back(2.1)); serving(1)
    t = case(14, 1, "addon_silent", "Load the FinCom add-on in Tally (F1 › TDLs & Add-ons).", read="", post="", changes="addon_silent")
    reset(); link(1); cursor(1, max_alter=480, last_at=back(2.1)); serving(1, tell={"addonSilent": [{"company": CO(1), "guid": CG[1], "reason": "addonAdded"}]})
    case("14b", 1, "addon_silent", "Close and open Tally once, so it loads the FinCom add-on.")
    reset(); link(1); cursor(1); serving(1)
    for n in range(12): day(1, TODAY - datetime.timedelta(days=n + 1))
    t = case(15, 1, "days_waiting", "FinCom is bringing 12 days from Tally.", read="days_waiting", post="", changes="")
    ok((t.get("days") or {}).get("n") == 12 and (t.get("days") or {}).get("oldest") == (TODAY - datetime.timedelta(days=12)).isoformat(), "1.15 days: n and the oldest (%s)" % t.get("days"))
    reset(); link(1); cursor(1); serving(1)
    SD = datetime.date(2026, 10, 5) if datetime.date(2026, 10, 5) >= FY else TODAY - datetime.timedelta(days=3)
    if db.one("select count(*) from information_schema.columns where table_name = 'tally_check_days' and column_name = 'next_at'") == "0":
        db.sql("alter table tally_check_days add column if not exists next_at timestamptz; alter table tally_check_days add column if not exists last_why text; alter table tally_check_days add column if not exists parked_at timestamptz")
    day(1, SD, next_at="now() + interval '1 hour'", last_why="'dayRetry'")
    case(16, 1, "slow_day", "Tally was slow for %s. FinCom tries it again by itself." % SD.strftime("%d-%b-%Y"), read="slow_day", post="")
    db.sql("update tally_check_days set parked_at = now()")
    t = tell(1); ok(cause(t).get("code") is None and (t.get("days") or {}).get("n") == 0, "1.15 parked days are not counted (%s)" % cause(t))
    db.sql("update tally_check_days set parked_at = null, day = %s" % q((FY - datetime.timedelta(days=3)).isoformat()))
    t = tell(1); ok(cause(t).get("code") is None and (t.get("days") or {}).get("n") == 0, "1.15 days before the book's first day are not counted (%s)" % cause(t))

    print("== 1. precedence")
    reset(); link(1); cursor(1, max_alter=480, last_at=back(3)); serving(1, version="2.5.6", fetch=False); day(1, Y)
    t = tell(1); ok(cause(t).get("code") == "old_bridge" and (t.get("changes") or {}).get("code") == "old_bridge", "4 before 11, 14 and 15 (%s)" % cause(t))
    reset(); link(1); cursor(1, max_alter=480, last_at=back(3)); serving(1, fetch=False); day(1, Y)
    t = tell(1); ok(cause(t).get("code") == "reading_off" and (t.get("read") or {}).get("code") == "reading_off" and (t.get("changes") or {}).get("code") == "reading_off", "11 before 14 and 15 (%s)" % cause(t))
    reset(); link(1); cursor(1, max_alter=480, last_at=back(3)); serving(1); day(1, Y)
    t = tell(1); ok(cause(t).get("code") == "addon_silent" and (t.get("read") or {}).get("code") == "days_waiting" and (t.get("changes") or {}).get("code") == "addon_silent"
                     and (t.get("read") or {}).get("words") == "FinCom is bringing 1 day from Tally.", "14 before 15; Reading and Changes say each their own (%s)" % json.dumps(t)[:400])
    reset(); link(1); cursor(1); device(DA, BA, ago_min=10); device(DB, BB, version="2.5.6", cos=[[CO(1), CG[1]]])
    t = tell(1); ok(cause(t).get("code") == "old_bridge", "3 needs every bridge silent: one live old bridge says 4 (%s)" % cause(t))
    reset(); link(1); cursor(1); device(DA, BA, state="closed", tell={"skip": {CO(1): "otherLogin"}})
    t = tell(1); ok(cause(t).get("code") == "other_login", "a bridge's own word (otherLogin) names the cause before 5 (%s)" % cause(t))
    reset(); cursor(1); serving(1, version="2.5.6")
    t = tell(1); ok(cause(t).get("code") == "not_linked", "1 before everything (%s)" % cause(t))

    print("== 1. B.8: changes for an earlier year FinCom does not keep")
    reset(); link(1); cursor(1); serving(1)
    line(1, FY - datetime.timedelta(days=40), state="stale")
    fy0 = "%d-%02d" % (FY.year - 1, FY.year % 100)
    t = tell(1); e = t.get("earlier") or {}
    ok(e.get("fy") == fy0 and e.get("fix") == "add_year" and e.get("words") == "%s has changes in Tally for %s. Add %s to bring them." % (CO(1), fy0, fy0), "the earlier year said once, with Add %s (%s)" % (fy0, e))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date) values ('819d4a59-4cee-4bf7-8f8c-000000099221', %s, 'c1', %s, %s)" % (q(F), q(CO(1)), q(datetime.date(FY.year - 1, 4, 1).isoformat())))
    t = tell(1); ok("earlier" not in t and not t.get("_error"), "not said once the client has that year (%s)" % t.get("earlier"))
    db.sql("delete from tally_recorder_lines; delete from tally_books where book_id = '819d4a59-4cee-4bf7-8f8c-000000099221'")

    print("== 2. addon_silent: 2 working hours")
    for h, want in ((1.9, None), (2.1, "addon_silent")):
        reset(); link(1); cursor(1, max_alter=480, last_at=back(h)); serving(1)
        t = tell(1); ok(cause(t).get("code") == want, "%.1f working hours since the last line: %s (%s)" % (h, want, cause(t)))
    ok(db.one("select tally_working_hours('2026-11-21 13:00:00+00', '2026-11-23 04:30:00+00')::numeric(6,2)::text") == "1.50", "(the helper) Saturday 18:30 to Monday 10:00 India time: 1.5 working hours, the Sunday and nights not counted")
    wall = (NOW - back(1.9)).total_seconds() / 3600
    print("  (1.9 working hours before now is %.1f clock hours before now)" % wall)
    reset(); link(1); cursor(1, max_alter=480, last_at=back(2.1)); serving(1)
    db.sql("update tally_sync_cursor set recorder_last_at = now(), recorder_max_alter = 480 where book_id = %s" % q(BK[1]))
    t = tell(1); ok(cause(t).get("code") is None, "cleared as soon as an add-on line arrives (recorder_last_at moves) (%s)" % cause(t))

    print("== 3. the bell")
    scan = lambda: j("select tally_tell_scan()::text") if text else {"_error": "no file"}
    bell = lambda k: db.rows("select id::text, words, (cleared_at is not null)::text as cleared, (read_at is not null)::text as read from tally_alerts where kind = 'tell' and book_id = %s order by id" % q(BK[k])) if text else []
    def since(k, h, fault=True):     # the cause (and the fault, unless fault=False) began h working hours ago
        if text: db.sql("update tally_tell_state set since = %s%s where book_id = %s" % (q(iso(back(h))), (", fault_since = %s" % q(iso(back(h)))) if fault else "", q(BK[k])))
    setinfo = lambda path, val: db.sql("update tally_devices set info = jsonb_set(info, %s, %s::jsonb)" % (q(path), q(json.dumps(val))))
    readall = lambda: db.sql("update tally_alerts set read_at = now() where kind = 'tell'")
    A_W, B_W = "Reading from Tally is off for this computer. Turn it on.", "Reading is paused in the FinCom Bridge tray icon. Click Resume there."
    reset(); link(1); cursor(1); serving(1, fetch=False); day(1, Y)
    r = scan(); ok(r.get("ok") is True and bell(1) == [], "a new cause: no bell yet (%s)" % r)
    since(1, 0.4); scan(); ok(bell(1) == [], "0.4 working hours: no bell")
    since(1, 0.6); scan(); b = bell(1)
    ok(len(b) == 1 and b[0]["words"] == A_W and b[0]["cleared"] == "false" and b[0]["read"] == "false", "0.6 working hours, a day waiting: one unread bell row, the sentence only (%s)" % b)
    scan(); ok(len(bell(1)) == 1, "scanned again: still one row")
    print("  -- the sequence A, B, A, gone one scan, A: no new unread row (H4)")
    readall()
    setinfo("{beat,paused}", True); db.sql("update tally_devices set period_fetch = true"); scan(); b = bell(1)
    ok(len(b) == 1 and b[0]["words"] == B_W and b[0]["read"] == "true", "B: written in place, read kept (its fix changed, but B is new) (%s)" % b)
    setinfo("{beat,paused}", False); db.sql("update tally_devices set period_fetch = false"); scan(); b = bell(1)
    ok(len(b) == 1 and b[0]["words"] == A_W and b[0]["read"] == "true", "A again: in place, read kept (%s)" % b)
    db.sql("update tally_devices set period_fetch = true"); scan(); b = bell(1)
    ok(len(b) == 1 and b[0]["cleared"] == "false" and b[0]["read"] == "true", "gone for one scan: not cleared yet (%s)" % b)
    db.sql("update tally_devices set period_fetch = false"); scan(); b = bell(1)
    ok(len(b) == 1 and b[0]["cleared"] == "false" and b[0]["read"] == "true", "A back: the same row, still read, no new row (%s)" % b)
    print("  -- a new fix that lasts 30 working minutes: unread again")
    setinfo("{beat,paused}", True); db.sql("update tally_devices set period_fetch = true"); scan(); since(1, 0.6, fault=False); scan(); b = bell(1)
    ok(len(b) == 1 and b[0]["words"] == B_W and b[0]["read"] == "false", "B's own 30 working minutes, its button not A's: unread again (%s)" % b)
    setinfo("{beat,paused}", False)
    print("  -- cleared only after 2 scans or 20 minutes gone (L1: read_at kept or set)")
    db.sql("update tally_devices set period_fetch = true"); scan()
    ok(bool(bell(1)) and bell(1)[0]["cleared"] == "false", "gone one scan: open")
    scan(); b = bell(1)
    ok(bool(b) and b[0]["cleared"] == "true" and b[0]["read"] == "true", "gone two scans: cleared, marked read (%s)" % b)
    reset(); link(1); cursor(1); serving(1, fetch=False); day(1, Y); scan(); since(1, 0.6); scan()
    ok(len(bell(1)) == 1, "(step) a bell again")
    db.sql("update tally_devices set period_fetch = true"); scan()
    db.sql("update tally_tell_state set gone_at = now() - interval '21 minutes' where book_id = %s" % q(BK[1])) if text else None
    scan(); ok(bell(1) and bell(1)[0]["cleared"] == "true", "gone 20 minutes: cleared at the next scan")
    print("  -- M1: no book bell for no_bridge / bridge_off; Tally closed or not open: 2 working hours")
    reset(); link(1); cursor(1); serving(1, ago_min=10); day(1, Y); scan(); since(1, 3.0); scan()
    ok(bell(1) == [], "bridge_off for 3 working hours: no book bell (the firm's own alert says it)")
    reset(); link(1); cursor(1); device(DA, BA, state="closed"); day(1, Y); scan(); since(1, 1.5); scan()
    ok(bell(1) == [], "Tally closed 1.5 working hours: no bell yet")
    since(1, 2.1); scan(); b = bell(1)
    ok(len(b) == 1 and b[0]["words"] == "Tally is closed. Open %s in Tally." % CO(1), "Tally closed 2.1 working hours: the bell (%s)" % b)
    print("  -- nothing affected, days_waiting, a posting of the book (L3), an unlinked book (L2)")
    reset(); link(1); cursor(1); serving(1, fetch=False)
    scan(); since(1, 1.0); scan()
    ok(bell(1) == [], "nothing affected (no day waiting, no line, no posting, Tally's number not moving): no bell")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values ('00000000-0000-4000-8000-000000221001', %s, 'c1', 'ANOTHER MADE UP CO', '{}'::jsonb, 1, 'waiting')" % q(F))
    scan(); ok(bell(1) == [], "a posting of the same client's other company: not this book's, no bell")
    db.sql("update tally_post_jobs set company = %s" % q(CO(1)))
    scan(); ok(len(bell(1)) == 1, "a posting waiting for this book's company: the bell")
    reset(); link(1); cursor(1); serving(1)
    for n in range(3): day(1, TODAY - datetime.timedelta(days=n + 1))
    scan(); since(1, 2.0); scan()
    ok(bell(1) == [], "days_waiting is not a fault: never a bell")
    reset(); cursor(1); serving(1); day(1, Y); scan(); since(1, 3.0); scan()
    ok(bell(1) == [], "an unlinked book: never a 'Link' bell (L2)")

    print("== 4. the view, the computers")
    reset(); link(1); link(2); cursor(1); cursor(2)
    serving(1, created_by=STAFF)
    device(DB, BB, version="2.5.6", created_by=OWNER)
    vw = lambda uid: j("select tally_tell_view()::text", uid=uid, role="authenticated") if text else {"_error": "no file"}
    v = vw(OWNER)
    ok(v.get("ok") is True and sorted(x.get("book") for x in v.get("books", [])) == sorted([BK[1], BK[2]]), "the owner: every linked book (%s)" % [x.get("book") for x in v.get("books", [])])
    pcs = {x.get("device"): x for x in v.get("computers", [])}
    ok(set(pcs) == {DA, DB} and pcs.get(DB, {}).get("words") == "Update FinCom Bridge on PC-B." and pcs.get(DB, {}).get("fix") == "update" and pcs.get(DA, {}).get("words") == "Working.",
       "the owner: every computer, its line (%s)" % list(pcs.values()))
    v = vw(STAFF); pcs = {x.get("device"): x for x in v.get("computers", [])}
    ok(v.get("ok") is True and set(pcs) == {DA} and pcs[DA].get("mine") is True, "staff: only their own computer (%s)" % list(pcs))
    v = vw(LOOK); ok(v.get("ok") is True and v.get("computers") == [], "a look-only member: the books, no computer of anyone's")
    v = vw(OTHER); ok(v.get("ok") is True and v.get("books") == [] and v.get("computers") == [], "a member of another firm: nothing of this firm (%s)" % v)
    v = vw("12345678-1234-4234-8234-123456789221"); ok("_error" in v and "not allowed" in v["_error"], "a signed-in user of no firm: refused")
    r = st.psql_text("set role anon; select tally_tell_view();"); ok(r.returncode != 0 and "permission denied" in r.stderr, "anon may not call it")
    pcw = []
    def dline(want, what, **kw):
        reset(); link(1); device(DA, BA, **kw)
        dl = j("select tally_tell_device(%s)::text" % q(DA)) if text else {}
        pcw.append(dl.get("words")); ok(dl.get("words") == want, "A.2: %s: %r (%s)" % (what, want, dl))
    OWN = {"port": 9000, "owner": "Made-up User", "reason": "open", "ok": True, "skipped": False}
    CLOSED_UNK = [{"port": 9114, "owner": "unknown", "reason": "closed", "ok": False, "skipped": False}, {"port": 9249, "owner": "unknown", "reason": "closed", "ok": False, "skipped": False}]
    OTHER_USER = {"port": 9001, "owner": None, "reason": "another user", "ok": False, "skipped": True}
    STG_INI = [{"state": "shared", "serverPort": 9114}, {"state": "shared", "serverPort": 9000}, {"state": "already", "serverPort": 7845}, {"state": "already", "serverPort": 9000}, {"state": "usertdl-no", "serverPort": 9249}]
    dline("Start FinCom Bridge on PC-A.", "the bridge silent", ago_min=10)
    dline("Update FinCom Bridge on PC-A.", "an old bridge", version="2.5.6")
    dline("Open Tally on PC-A.", "Tally closed", state="closed")
    dline("Working.", "one own open port, the closed ports owner unknown (H1)", beat={"ports": [OWN] + CLOSED_UNK})
    dline("Working.", "only closed ports, owner unknown (staging: 25 of them) (H1)", beat={"ports": CLOSED_UNK + [OTHER_USER]})
    dline("Tally on PC-A runs as administrator. Open it normally.", "an open Tally whose owner Windows cannot tell, owners told for others, none of the user's own open",
          beat={"ports": [{"port": 1700, "owner": "unknown", "reason": "open", "ok": True, "skipped": False}, OTHER_USER] + CLOSED_UNK})
    dline("Working.", "an open owner-unknown Tally on a plain computer (no owner told at all): the user's own", beat={"ports": [{"port": 1700, "owner": "unknown", "reason": "open", "ok": True, "skipped": False}] + CLOSED_UNK})
    dline("Working.", "staging's tally.ini (shared and already), the add-on recording (H2)",
          beat={"tallyPort": 9000, "tallyIni": STG_INI, "companies": [{"name": CO(1), "guid": CG[1], "open": True, "recorderSeen": True}]})
    dline("Working.", "staging's tally.ini, Tally on a port its 'already' entry covers, nothing recorded yet (H2)",
          beat={"tallyPort": 9000, "tallyIni": STG_INI, "companies": [{"name": CO(1), "guid": CG[1], "open": True, "recorderSeen": False}]})
    dline("Load the FinCom add-on in Tally on PC-A (F1 › TDLs & Add-ons).", "a shared tally.ini for this Tally's port, no 'already', nothing recorded",
          beat={"tallyPort": 9114, "tallyIni": STG_INI, "companies": [{"name": CO(1), "guid": CG[1], "open": True, "recorderSeen": False}]})
    dline("Reading is paused on PC-A. Click Resume in the tray icon.", "paused", beat={"paused": True})
    dline("Working.", "working")

    print("== 4. M2: one bad book never breaks the view")
    reset(); link(1); link(2); cursor(1); cursor(2); serving(1)
    db.sql("update tally_sync_cursor set gap = '{\"tally_altvchid\": \"999999999999999\"}'::jsonb, recorder_max_alter = null where book_id = %s" % q(BK[2]))
    db.sql("update tally_devices set info = jsonb_set(info, '{bridges,%s,at}', '\"2026-13-45T99:99:00.000Z\"'::jsonb)" % BA)
    v = vw(OWNER)
    ok(v.get("ok") is True and len(v.get("books", [])) == 2 and all((x.get("cause") or {}).get("code") is None and x.get("book") for x in v.get("books", [])),
       "a book whose sentence cannot be worked out: {book, cause:{code:null}}, the view still answers (%s)" % json.dumps(v)[:300])
    print("== 4. L2: an unlinked book with days open: in the view until its days are parked")
    reset(); link(2); cursor(1); day(1, Y)
    v = vw(OWNER); ok(BK[1] in [x.get("book") for x in v.get("books", [])], "unlinked, a day open: shown (Link <co>)")
    db.sql("update tally_check_days set parked_at = now()")
    v = vw(OWNER); ok(BK[1] not in [x.get("book") for x in v.get("books", [])], "its days parked (222): no longer in the view")

    print("== 5. the plain-word rules")
    allw = [w for w in seen.values() if w] + ["FinCom is bringing 1 day from Tally.", POST]
    pcl = [w for w in pcw if w]
    ok(len(pcl) == len(pcw) and all(len(w.split()) <= 14 and not re.search(r"(?i)\b(warning|error|guid)\b|(?<![-\d])\d{4,5}(?![-\d])", w) for w in pcl), "every computer line: at most 14 words, no warning, error, GUID or port number (%s)" % pcl)
    acts = lambda w: len(re.findall(r"\b(Start|Update|Open|Load|Click|Install|Link|Turn|Close)\b", w))
    ok(all(acts(w) == (0 if w == "Working." else 1) for w in pcl), "every computer line: exactly one action (H3) (%s)" % [(w, acts(w)) for w in pcl])
    def nwords(w):
        for k in range(1, 8): w = w.replace(CO(k), "CO")
        return len(w.split())
    ok(len(allw) >= 18 and all(nwords(w) <= 14 for w in allw), "every sentence at most 14 words (%s)" % [(w, nwords(w)) for w in allw if nwords(w) > 14])
    ok(not any(re.search(r"(?i)\b(warning|error|guid)\b|(?<![-\d])\d{4,5}(?![-\d])", w.replace(CO(1), "CO")) for w in allw), "no warning, error, GUID or port number")
    ok(not any("PC-" in w or "MADEUP" in w for w in allw), "no computer or user name in a book's sentence")

    print("== 6. the per-computer silent scan: a no-op")
    r = j("select tally_alert_scan_silent()::text")
    ok(r.get("ok") is True and r.get("written") == 0 and "tally-tell" in str(r.get("skipped")), "it answers, writes nothing (%s)" % r)
    ok(can("public.tally_alert_scan_silent()", "service_role") == "f" and can("public.tally_alert_scan_silent()", "authenticated") == "f", "its grants as 47 made them (nobody's)")
finally:
    bye()
print("\n%s: %d failed" % ("FAILED" if fails else "PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
