"""python3 run_migration123.py - server/console/migration-123-notices-flags.sql (27-Oct-2026, branch next-console-ops;
NOT run on staging: the owner runs it). On a throwaway PostgreSQL (pg_stand, port 31123 unless PG123_PORT), with the
stand-ins of tests/console_ops_stand.py and migration 118 run first:
  0. the file: one transaction, lock_timeout 10 s; add-only; names no real database; md5
  1. runs, and runs a second time (the same function texts afterwards)
  2. grants: the four tables RLS on, no policy, the service role only; announcements_active, announcement_dismiss and
     flags_for_me to signed-in people (not anon); every console_* function the service role only; a signed-in person
     reads none of the tables directly
  3. announcements: made (draft, then live) and changed by Owner or Support (Billing and Viewer refused), each with its
     audit row; the audience (all, plans, firms), the start and end, a draft and an ended one never shown; most severe
     first; a person dismisses a dismissible one (only for themselves; not one that is not dismissible, not one they are
     not shown); bad values refused in plain codes; End; the list with dismissed and firms-reached counts
  4. feature flags: made and changed by the Owner only (audited); flags_for_me: the default, a plan's rule, a firm's
     rule beating its plan's, an ended rule counting for nothing; a rule removed (audited); the console's view of one
     firm with why
RED_WITHOUT_123=1: the same checks without running the file (1 to 4 fail)."""
import os, re, sys, hashlib, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import console_ops_stand as S
M = os.path.join(HERE, "..", "server", "console", "migration-123-notices-flags.sql")
RED = os.environ.get("RED_WITHOUT_123") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\s+(table|column|function|view|policy|trigger)", code), "nothing dropped")
ok(set(re.findall(r"delete from ([\w.]+)", code)) <= {"public.feature_flag_rules"} and "truncate" not in code, "the only delete: a flag rule the Owner removes (audited)")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")

O, B, SU, V = S.OWNER, S.BILL, S.SUP, S.VIEW
db = S.start(int(os.environ.get("PG123_PORT") or 31123), cron=False)
SR = "set role service_role; "
def try_sql(s):
    try: db.sql(s); return None
    except Exception as e: return str(e)
def one(q, uid=None):
    try: return db.one(q, uid)
    except Exception as e: return "ERR " + str(e)[:300]
def j(q):
    v = one(SR + "select (" + q + ")::text")
    try: return json.loads(v) if v and not v.startswith("ERR") else None
    except Exception: return None
call = lambda s: try_sql(SR + "select " + s)
AUD = lambda: int(one("select count(*) from public.console_audit") or 0)
def as_user(uid, q):
    """q as a signed-in person (role authenticated, auth.uid() = uid)"""
    v = one("set role authenticated; select (" + q + ")::text", uid)
    try: return json.loads(v) if v and not v.startswith("ERR") else v
    except Exception: return v
def shown(uid): r = as_user(uid, "public.announcements_active()"); return [x["title"] for x in r] if isinstance(r, list) else r
P = lambda d: "'" + json.dumps(d).replace("'", "''") + "'::jsonb"
try:
    print("== 1. runs, twice")
    e1 = None if RED else try_sql(text)
    ok(e1 is None and one("select to_regclass('public.announcements')::text") == "announcements", "runs (%s)" % (e1 or "")[:300])
    src1 = one("select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname like 'console\\_%' or proname like 'announcement%' or proname like 'flags\\_%'")
    e2 = None if RED else try_sql(text)
    ok(e2 is None and one("select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname like 'console\\_%' or proname like 'announcement%' or proname like 'flags\\_%'") == src1, "runs a second time (%s)" % (e2 or "")[:200])

    print("== 2. grants")
    for t in ("announcements", "announcement_dismissals", "feature_flags", "feature_flag_rules"):
        ok(one("select relrowsecurity::text from pg_class where relname = '%s'" % t) == "true" and one("select count(*) from pg_policies where tablename = '%s'" % t) == "0", "%s: RLS on, no policy" % t)
        tp = lambda role: one("select coalesce(string_agg(privilege_type, ',' order by privilege_type), '-') from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t))
        ok(tp("anon") == "-" and tp("authenticated") == "-" and tp("service_role") == "DELETE,INSERT,SELECT,UPDATE", "%s: the service role only" % t)
    fx = lambda role, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (role, f))
    for f in ("public.announcements_active()", "public.announcement_dismiss(uuid)", "public.flags_for_me()"):
        ok(fx("authenticated", f) == "true" and fx("anon", f) == "false", "%s: signed-in people, not anon" % f)
    for f in ("public.flags_resolve(uuid, uuid)", "public.notice_my_firm_plan()"):
        ok(fx("authenticated", f) == "false" and fx("anon", f) == "false", "%s: not for signed-in people (it takes any firm)" % f)
    cf = [r["sig"] for r in db.rows("select p.oid::regprocedure::text as sig from pg_proc p where p.proname in ('console_announcements_list','console_announcement_save','console_announcement_end','console_flags_list','console_flag_save','console_flag_rule_set','console_flag_rule_remove','console_flags_for_firm','console_announcement_json','console_notice_choices')")]
    ok(len(cf) == 10 and all(fx("service_role", f) == "true" and fx("authenticated", f) == "false" for f in cf), "the console's functions: the service role only (%d)" % len(cf))
    ok("permission denied" in str(one("set role authenticated; select count(*) from public.announcements", S.A1)), "a signed-in person cannot read the table directly")

    print("== 3. announcements")
    n0 = AUD()
    ok(call("public.console_announcement_save('%s', null, %s, 'r', null, null)" % (B, P({"title": "Hello"}))) is not None and call("public.console_announcement_save('%s', null, %s, 'r', null, null)" % (V, P({"title": "Hello"}))) is not None and AUD() == n0, "Billing and Viewer refused")
    a1 = j("public.console_announcement_save('%s', null, %s, 'maintenance tonight', '1.1.1.1', 'ua')" % (SU, P({"title": "Maintenance tonight", "body": "11 pm to 12 am", "severity": "warning", "audience": "all"}))) or {}
    ok(a1.get("status") == "draft" and a1.get("firms_reached") == 3 and AUD() == n0 + 1, "Support makes a draft (audited; reaches 3 firms)")
    ok(shown(S.A1) == [], "a draft is not shown")
    a1 = j("public.console_announcement_save('%s', '%s', %s, 'publish', null, null)" % (O, a1.get("id"), P({"status": "live", "audience": "all"}))) or {}
    ok(a1.get("state") == "live" and shown(S.A1) == ["Maintenance tonight"] and shown(S.B1) == ["Maintenance tonight"], "live: shown to every firm")
    au = j("select to_jsonb(c) from public.console_audit c order by id desc limit 1") or {}
    ok(au.get("action") == "announcements.save" and (au.get("before") or {}).get("status") == "draft" and (au.get("after") or {}).get("status") == "live", "its audit row: before draft, after live")
    a2 = j("public.console_announcement_save('%s', null, %s, 'plan news', null, null)" % (O, P({"title": "Monthly plan news", "severity": "info", "audience": "plans", "plan_ids": [S.P2], "status": "live"}))) or {}
    a3 = j("public.console_announcement_save('%s', null, %s, 'abc only', null, null)" % (O, P({"title": "ABC: please call us", "severity": "urgent", "audience": "firms", "firm_ids": [S.F1], "status": "live", "dismissible": False}))) or {}
    a4 = j("public.console_announcement_save('%s', null, %s, 'later', null, null)" % (O, P({"title": "Next week", "audience": "all", "status": "live", "starts_at": "2099-01-01T00:00:00Z"}))) or {}
    ok(a4.get("state") == "scheduled", "one that starts later: scheduled")
    ok(shown(S.A1) == ["ABC: please call us", "Maintenance tonight"], "ABC (plan 1): its own urgent first, then the warning; not the plan-2 one, not the scheduled one (%s)" % shown(S.A1))
    ok(shown(S.B1) == ["Maintenance tonight", "Monthly plan news"], "GSC (plan 2): the warning, then its plan's info (%s)" % shown(S.B1))
    ok(as_user(None, "public.announcements_active()") == [], "nobody signed in: none")
    ok(as_user(S.A1, "public.announcement_dismiss('%s')" % a3["id"]) is False and "ABC: please call us" in shown(S.A1), "one that is not dismissible stays")
    ok(as_user(S.B1, "public.announcement_dismiss('%s')" % a3["id"]) is False, "one not shown to me cannot be dismissed")
    ok(as_user(S.A1, "public.announcement_dismiss('%s')" % a1["id"]) is True and shown(S.A1) == ["ABC: please call us"] and shown(S.A2) == ["ABC: please call us", "Maintenance tonight"], "dismissed: gone for that person only")
    ok(as_user(S.A1, "public.announcement_dismiss('%s')" % a1["id"]) is False, "dismissing again: false (nothing new)")
    bad = [({"title": "x"}, "a title too short"), ({"title": "Ok title", "severity": "loud"}, "a severity not in the list"), ({"title": "Ok title", "audience": "plans"}, "plans with no plan"),
           ({"title": "Ok title", "audience": "firms", "firm_ids": [S.U(999)]}, "an unknown firm"), ({"title": "Ok title", "starts_at": "2026-01-02T00:00:00Z", "ends_at": "2026-01-01T00:00:00Z"}, "an end before the start"),
           ({"title": "Ok title", "status": "ended"}, "status ended (End is its own action)"), ({"title": "Ok title", "firm_ids": ["not-a-uuid"], "audience": "firms"}, "a bad firm id"),
           ({"title": "Ok title", "starts_at": "yesterday-ish"}, "a bad date")]
    for d, w in bad:
        e = call("public.console_announcement_save('%s', null, %s, 'r', null, null)" % (O, P(d)))
        ok(e is not None and "console: " in e, "refused: %s (%s)" % (w, (e or "").strip().splitlines()[0][:90]))
    e = j("public.console_announcement_end('%s', '%s', 'done', null, null)" % (SU, a1["id"])) or {}
    ok(e.get("status") == "ended" and "Maintenance tonight" not in shown(S.A2) and one("select action from public.console_audit order by id desc limit 1") == "announcements.end", "End: not shown any more, audited")
    ok(call("public.console_announcement_end('%s', '%s', 'again', null, null)" % (SU, a1["id"])) is not None, "End twice: refused")
    ok(call("public.console_announcement_save('%s', '%s', %s, 'edit ended', null, null)" % (SU, a1["id"], P({"title": "Changed"}))) is not None, "an ended one cannot be changed")
    L = {x["title"]: x for x in (j("public.console_announcements_list()") or [])}
    ok(L.get("Maintenance tonight", {}).get("dismissed") == 1 and L.get("Monthly plan news", {}).get("firms_reached") == 2 and L.get("ABC: please call us", {}).get("firms") == ["ABC Associates"], "the list: dismissed and firms reached")

    ch = j("public.console_notice_choices()") or {}
    ok(len(ch.get("plans", [])) == 2 and len(ch.get("firms", [])) == 3 and set(ch["firms"][0]) == {"id", "name"}, "the forms' choices: plans and firms, id and name only")
    print("== 4. feature flags")
    n0 = AUD()
    ok(call("public.console_flag_save('%s', 'zoho_books', 'Zoho Books link', false, 'r', null, null)" % SU) is not None and AUD() == n0, "Support cannot make a flag")
    e = call("public.console_flag_save('%s', 'zoho_books', 'Zoho Books link', false, 'new flag', null, null)" % O)
    ok(e is None and one("select action || '|' || target_id from public.console_audit order by id desc limit 1") == "flags.save|zoho_books", "Owner makes a flag (audited) %s" % (e or ""))
    call("public.console_flag_save('%s', 'new_tds_screen', 'The new TDS screen', true, 'r', null, null)" % O)
    ok(call("public.console_flag_save('%s', 'Bad Key', '', false, 'r', null, null)" % O) is not None, "a bad key refused")
    ff = lambda uid: as_user(uid, "public.flags_for_me()")
    ok(ff(S.A1) == {"zoho_books": False, "new_tds_screen": True}, "flags_for_me: the defaults (%s)" % ff(S.A1))
    ok(as_user(None, "public.flags_for_me()") == {"zoho_books": False, "new_tds_screen": True}, "nobody's firm: the defaults")
    e = call("public.console_flag_rule_set('%s', 'zoho_books', 'plan', '%s', true, null, 'monthly plans first', 'pilot', null, null)" % (O, S.P2))
    ok(e is None and ff(S.B1).get("zoho_books") is True and ff(S.A1).get("zoho_books") is False, "a plan's rule: on for that plan's firms only %s" % (e or ""))
    call("public.console_flag_rule_set('%s', 'zoho_books', 'firm', '%s', false, null, 'they asked', 'firm asked', null, null)" % (O, S.F2))
    ok(ff(S.B1).get("zoho_books") is False, "a firm's rule beats its plan's")
    call("public.console_flag_rule_set('%s', 'new_tds_screen', 'firm', '%s', false, now() + interval '1 hour', 'trial', 'trial', null, null)" % (O, S.F1))
    ok(ff(S.A1).get("new_tds_screen") is False, "a firm rule with an end date, while it lasts")
    db.sql("update public.feature_flag_rules set until = now() - interval '1 minute' where flag_key = 'new_tds_screen'")
    ok(ff(S.A1).get("new_tds_screen") is True, "an ended rule counts for nothing")
    ok(call("public.console_flag_rule_set('%s', 'zoho_books', 'firm', '%s', true, now() - interval '1 day', '', 'r', null, null)" % (O, S.F1)) is not None, "an end date in the past refused")
    ok(call("public.console_flag_rule_set('%s', 'nope', 'firm', '%s', true, null, '', 'r', null, null)" % (O, S.F1)) is not None, "an unknown flag refused")
    ok(call("public.console_flag_rule_set('%s', 'zoho_books', 'firm', '%s', true, null, '', 'r', null, null)" % (O, S.U(999))) is not None, "an unknown firm refused")
    ok(call("public.console_flag_rule_set('%s', 'zoho_books', 'plan', '%s', true, null, '', 'r', null, null)" % (SU, S.P1)) is not None, "Support cannot set a rule")
    w = {x["key"]: x for x in (j("public.console_flags_for_firm('%s')" % S.F2) or [])}
    ok(w.get("zoho_books", {}).get("why") == "firm" and w.get("zoho_books", {}).get("value") is False and w.get("new_tds_screen", {}).get("why") == "default", "the console's view of one firm: value and why")
    fl = {x["key"]: x for x in (j("public.console_flags_list()") or [])}
    ok(fl.get("zoho_books", {}).get("rules") == 2 and fl.get("zoho_books", {}).get("firms_on") == 1 and len(fl["zoho_books"].get("rule_list", [])) == 2 and fl.get("new_tds_screen", {}).get("firms_on") == 3, "the list: active rules, firms on (the third firm, on plan 2)")
    rid = one("select id from public.feature_flag_rules where flag_key = 'zoho_books' and scope = 'firm'")
    e = call("public.console_flag_rule_remove('%s', %s, 'pilot over', null, null)" % (O, rid))
    ok(e is None and ff(S.B1).get("zoho_books") is True and one("select action from public.console_audit order by id desc limit 1") == "flags.rule_remove", "a rule removed (audited): the plan's rule counts again")
    ok(call("public.console_flag_rule_remove('%s', %s, 'again', null, null)" % (O, rid)) is not None, "removed twice: refused")
except Exception as e:
    ok(False, "the checks stopped: %s" % str(e)[:300])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
