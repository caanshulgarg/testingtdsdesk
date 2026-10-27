"""python3 run_migration122.py - server/console/migration-122-console-ops.sql (27-Oct-2026, branch next-console-ops, the
console's phase 5; NOT run on staging: the owner runs it). On a throwaway PostgreSQL (pg_stand, port 31122 unless
PG122_PORT; never a real database), with the stand-ins of tests/console_ops_stand.py and migration 118 run first:
  0. the file: one transaction, lock_timeout 10 s; add-only (no table or column dropped, no "delete from", no truncate);
     names no real database; md5
  1. runs, and runs a second time (the same function texts afterwards)
  2. grants: console_secret_meta and console_view_log with RLS on and no policy, the service role only (the view log:
     select and insert); every console_* function the service role only; the view log is append-only
  3. keys: Owner only (the functions' own check); a key replaced in platform_secrets (set_at, set_by) and in Vault
     (TaxPro); the audit row says "last 4 abcd -> wxyz" and never holds a value; the same value again refused; a
     value with spaces refused; the status gives set / length / last 4 (12+ characters only) and never a value; a
     rotation note for a function secret; a Test result kept and cleared by the next replace; last used from the
     features' own tables
  4. health: bridges online / idle / offline (revoked left out); jobs waiting, stuck, failed (30 days); queues (pgmq
     and the job tables); scheduled jobs with their last run and last failure; the summary; all of it without pg_cron
     and pgmq too (left out, no error)
  5. support desk: every ticket with replies, notes and the SLA state; one ticket with internal notes and the firm's
     summary; a reply as FinCom support (first response, status waiting; the audit row has the length, not the text);
     an internal note (status kept); status / priority / assignee (SLA times move with the priority); the same again
     refused; Billing and Viewer refused
  6. see as this firm: Owner and Support only; the summary has counts, never a client's name or an activity's text
     (names only with the firm's consent row); the audit row, the view log row and the firm's bell notice "FinCom
     support viewed your account on <date>: <reason>" are written in the same transaction; a second view the same day
     is a notice of its own; an unknown firm refused with nothing written
  7. exports: the all-firms ledger (a date range, amounts in paise too) and the change history
RED_WITHOUT_122=1: the same checks without running the file (1 to 7 fail)."""
import os, re, sys, hashlib, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import console_ops_stand as S
M = os.path.join(HERE, "..", "server", "console", "migration-122-console-ops.sql")
RED = os.environ.get("RED_WITHOUT_122") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
drops = re.findall(r"\bdrop\s+(\w+)", code)
ok(all(d == "trigger" for d in drops) and not re.search(r"drop\s+(table|column|function|view|policy)", code), "nothing dropped but its own trigger re-made (%s)" % sorted(set(drops)))
ok("delete from" not in code and "truncate" not in code, "no delete from, no truncate")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")

O, B, SU, V = S.OWNER, S.BILL, S.SUP, S.VIEW
db = S.start(int(os.environ.get("PG122_PORT") or 31122))
SR = "set role service_role; "
def try_sql(s):
    try: db.sql(s); return None
    except Exception as e: return str(e)
def one(q):
    try: return db.one(q)
    except Exception as e: return "ERR " + str(e)[:300]
def j(q):
    v = one(SR + "select (" + q + ")::text")
    try: return json.loads(v) if v and not v.startswith("ERR") else None
    except Exception: return None
call = lambda s: try_sql(SR + "select " + s)
AUD = lambda: int(one("select count(*) from public.console_audit") or 0)
try:
    print("== 1. runs, twice")
    e1 = None if RED else try_sql(text)
    ok(e1 is None and one("select to_regclass('public.console_secret_meta')::text") == "console_secret_meta", "runs (%s)" % (e1 or "")[:300])
    src1 = one("select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname like 'console\\_%'")
    e2 = None if RED else try_sql(text)
    ok(e2 is None and one("select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname like 'console\\_%'") == src1, "runs a second time: the same function texts (%s)" % (e2 or "")[:200])

    print("== 2. grants")
    for t in ("console_secret_meta", "console_view_log"):
        ok(one("select relrowsecurity::text from pg_class where relname = '%s'" % t) == "true", "%s: row-level security on" % t)
        ok(one("select count(*) from pg_policies where tablename = '%s'" % t) == "0", "%s: no policy" % t)
        tp = lambda role: one("select coalesce(string_agg(privilege_type, ',' order by privilege_type), '-') from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t))
        ok(tp("anon") == "-" and tp("authenticated") == "-", "%s: anon and authenticated nothing" % t)
        ok(tp("service_role") == ("INSERT,SELECT,UPDATE" if t == "console_secret_meta" else "INSERT,SELECT"), "%s: service role %s" % (t, tp("service_role")))
    NEW = ["console_last4", "console_try_ts", "console_secret_value", "console_secrets_status", "console_secret_meta_get", "console_secret_set", "console_secret_rotated",
           "console_secret_tested", "console_secret_last_used", "console_health_bridges", "console_health_jobs", "console_health_queues", "console_health_cron",
           "console_health_summary", "console_support_row", "console_support_list", "console_support_get", "console_support_reply", "console_support_set",
           "console_support_assignees", "console_seeas", "console_seeas_body", "console_view_list", "console_ledger", "console_export_audit"]
    have = {r["proname"]: r["sig"] for r in db.rows("select p.proname, p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'console\\_%'")}
    ok(all(n in have for n in NEW), "every new function is there (%s missing)" % [n for n in NEW if n not in have])
    fx = lambda role, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (role, f))
    sigs = [have[n] for n in NEW if n in have]
    ok(sigs and all(fx("service_role", f) == "true" for f in sigs), "the service role calls each")
    ok(sigs and all(fx(r, f) == "false" for r in ("anon", "authenticated") for f in sigs), "anon and authenticated call none")
    ok(one("select bool_and(coalesce(array_to_string(proconfig, ',') like '%search_path=%', false))::text from pg_proc where proname like 'console\\_%'") == "true", "every function pins its search_path")

    print("== 3. keys")
    n0 = AUD()
    ok(call("public.console_secret_set('%s', 'claude_api_key', 'table', 'sk-ant-NEWKEY-wxyz9876', 'rotate yearly', null, null)" % SU) is not None and AUD() == n0, "Support cannot replace a key (no audit row)")
    ok(call("public.console_secret_set('%s', 'claude_api_key', 'table', 'sk-ant-NEWKEY-wxyz9876', 'rotate yearly', null, null)" % B) is not None, "Billing cannot")
    e = call("public.console_secret_set('%s', 'claude_api_key', 'table', '  sk-ant-NEWKEY-wxyz9876 ', 'rotate yearly', '1.2.3.4', 'ua')" % O)
    ok(e is None and one("select value || '|' || (set_by = '%s')::text || '|' || (set_at > now() - interval '1 minute')::text from public.platform_secrets where name = 'claude_api_key'" % O) == "sk-ant-NEWKEY-wxyz9876|true|true",
       "Owner replaces a platform_secrets key (trimmed; set_at, set_by) %s" % (e or ""))
    a = j("select to_jsonb(c) from public.console_audit c order by id desc limit 1") or {}
    ok(a.get("action") == "keys.set" and a.get("target_id") == "claude_api_key" and (a.get("before") or {}).get("last4") == "abcd" and (a.get("after") or {}).get("last4") == "9876" and a.get("reason") == "rotate yearly",
       "audit: keys.set, last 4 abcd -> 9876, the reason")
    ok("NEWKEY" not in one("select string_agg(c::text, '') from public.console_audit c") and "OLDKEY" not in one("select string_agg(c::text, '') from public.console_audit c"), "no value in any audit row")
    ok("NEWKEY" not in (one("select string_agg(m::text, '') from public.console_secret_meta m") or ""), "no value in the meta table")
    ok(call("public.console_secret_set('%s', 'claude_api_key', 'table', 'sk-ant-NEWKEY-wxyz9876', 'again', null, null)" % O) is not None, "the same value again: refused")
    ok(call("public.console_secret_set('%s', 'claude_api_key', 'table', 'sk ant with spaces 1234', 'x', null, null)" % O) is not None, "a value with spaces: refused")
    ok(call("public.console_secret_set('%s', 'bad name!', 'table', 'sk-ant-1234567890', 'x', null, null)" % O) is not None, "a bad key name: refused")
    e = call("public.console_secret_set('%s', 'gsp:taxpro:aspid', 'vault', 'ASP-1111-NEW-5678', 'new ASP id', null, null)" % O)
    ok(e is None and one("select value from vault_stand where name = 'gsp:taxpro:aspid'") == "ASP-1111-NEW-5678", "TaxPro's ASP id replaced in Vault (gsp_secret_put) %s" % (e or ""))
    st = j("public.console_secrets_status(array['claude_api_key', 'call_guest_secret', 'groq_api_key'], array['gsp:taxpro:aspid', 'gsp:taxpro:password'])") or []
    sm = {x["name"]: x for x in st}
    ok(sm.get("claude_api_key", {}).get("last4") == "9876" and sm["claude_api_key"].get("set") is True and sm["claude_api_key"].get("set_by") == "anshul@fincom.live"
       and sm["claude_api_key"].get("rotate_reason") == "rotate yearly" and sm["claude_api_key"].get("last4_before") == "abcd", "status: set, last 4, set by, the rotation's reason")
    ok(sm.get("call_guest_secret", {}).get("set") is True and sm["call_guest_secret"].get("last4") is None, "status: a short value shows no last 4")
    ok(sm.get("groq_api_key", {}).get("set") is False, "status: a key not set")
    ok(sm.get("gsp:taxpro:aspid", {}).get("last4") == "5678" and sm.get("gsp:taxpro:password", {}).get("set") is False, "status: Vault keys")
    raw = one(SR + "select public.console_secrets_status(array['claude_api_key','call_guest_secret'], array['gsp:taxpro:aspid'])::text") or ""
    ok("NEWKEY" not in raw and "short" not in raw and "ASP-1111" not in raw, "status never holds a value")
    ok(one(SR + "select public.console_secret_value('claude_api_key', 'table')") == "sk-ant-NEWKEY-wxyz9876" and one(SR + "select public.console_secret_value('gsp:taxpro:aspid', 'vault')") == "ASP-1111-NEW-5678",
       "console_secret_value (the service role, for the Test call)")
    ok(fx("authenticated", have.get("console_secret_value", "console_last4(text)")) == "false", "console_secret_value: not for signed-in people")
    e = call("public.console_secret_tested('%s', 'claude_api_key', true, 'The provider accepted the key.')" % O)
    ok(e is None and one("select last_test_ok::text || '|' || last_test_msg from public.console_secret_meta where name = 'claude_api_key'") == "true|The provider accepted the key.", "a Test result is kept %s" % (e or ""))
    ok(call("public.console_secret_tested('%s', 'claude_api_key', false, 'x')" % SU) is not None, "Support cannot record a test")
    call("public.console_secret_set('%s', 'claude_api_key', 'table', 'sk-ant-THIRD-key-0000', 'leaked', null, null)" % O)
    ok(one("select coalesce(last_test_ok::text, 'null') from public.console_secret_meta where name = 'claude_api_key'") == "null", "replacing a key clears its last Test")
    e = call("public.console_secret_rotated('%s', 'RESEND_API_KEY', 'q9Zx', 'rotated in Supabase secrets', null, null)" % O)
    ok(e is None and one("select last4 || '|' || rotate_reason from public.console_secret_meta where name = 'RESEND_API_KEY'") == "q9Zx|rotated in Supabase secrets", "a function secret's rotation note %s" % (e or ""))
    ok(one("select action from public.console_audit order by id desc limit 1") == "keys.rotated", "its audit row")
    mg = j("public.console_secret_meta_get(array['RESEND_API_KEY'])") or {}
    ok(mg.get("RESEND_API_KEY", {}).get("last4") == "q9Zx", "meta for function secrets")
    lu = j("public.console_secret_last_used()") or {}
    ok(lu.get("claude") and lu.get("vision") and lu.get("groq") is None, "last used: Claude and Vision from the ledger and the assistant's usage; Groq not known here (%s)" % lu)

    print("== 4. health")
    br = j("public.console_health_bridges()") or []
    ok(sorted((x["name"], x["state"]) for x in br) == [("PC1", "online"), ("PC2", "idle"), ("PC3", "offline")], "bridges: online, idle, offline; revoked left out (%s)" % [(x.get("name"), x.get("state")) for x in br])
    ok(all(x.get("firm") for x in br) and any(x.get("version") == "2.3.0" for x in br), "bridges: firm and version")
    jb = j("public.console_health_jobs()") or []
    ok(sorted((x["source"], x["status"]) for x in jb) == [("tally_post", "failed"), ("tally_post", "running"), ("tally_post", "waiting"), ("tally_read", "failed"), ("tally_read", "waiting")],
       "jobs: waiting, running, failed in 30 days (an older failure and done ones left out) %s" % sorted((x.get("source"), x.get("status")) for x in jb))
    ok(any(x["stuck"] for x in jb if x["status"] == "running"), "jobs: a running one not moved for 30 minutes is stuck")
    q = j("public.console_health_queues()") or []
    qn = {x["name"]: x for x in q}
    ok(qn.get("pgmq: tally_recorder", {}).get("waiting") == 4 and qn.get("pgmq: tally_recorder", {}).get("oldest_sec") == 900, "queues: pgmq lengths and oldest")
    ok(qn.get("tally_post_jobs", {}).get("failed") == 1 and qn.get("tally_post_jobs", {}).get("waiting") == 2 and qn.get("tally_recorder_failures", {}).get("failed") == 1, "queues: job tables' counts")
    cr = j("public.console_health_cron()") or []
    c1 = next((x for x in cr if x["name"] == "tally-post-register-settle"), {})
    ok(len(cr) == 2 and c1.get("last_status") == "succeeded" and c1.get("last_failed_at") and c1.get("failed_24h") == 1 and c1.get("runs_24h") == 2, "cron: each job's last run and last failure")
    sm = j("public.console_health_summary()") or {}
    ok(sm.get("bridges") == 3 and sm.get("bridges_online") == 1 and sm.get("jobs_failed_24h") == 2 and sm.get("cron_failed_24h") == 1 and sm.get("jobs_stuck") == 1, "summary %s" % sm)
    ok("SECRET" in json.dumps(jb), "(the bridge's own message is shown, cut to 200 characters)")
    db.sql("drop schema cron cascade; drop schema pgmq cascade;")
    ok(j("public.console_health_cron()") == [] and not any(x["name"].startswith("pgmq") for x in (j("public.console_health_queues()") or [])) and (j("public.console_health_summary()") or {}).get("cron_available") is False,
       "without pg_cron and pgmq: left out, no error")

    print("== 5. support desk")
    sl = j("public.console_support_list()") or []
    T = {x["subject"]: x for x in sl}
    t1 = T.get("Cannot post to Tally", {}); t2 = T.get("Billing question", {})
    ok(len(sl) == 2 and t1.get("firm") == "ABC Associates" and t1.get("code", "").startswith("T-") and t1.get("replies") == 1 and t1.get("notes") == 0, "list: every firm's tickets with replies and notes")
    ok(t1.get("sla") == "breached" and t2.get("sla") in ("ok", "due"), "list: SLA breached when no first response by respond_by")
    T1 = t1.get("id")
    n0 = AUD()
    ok(call("public.console_support_reply('%s', '%s', 'hello', false, null, null, null)" % (B, T1)) is not None and call("public.console_support_reply('%s', '%s', 'hello', false, null, null, null)" % (V, T1)) is not None and AUD() == n0,
       "Billing and Viewer cannot reply")
    r = j("public.console_support_reply('%s', '%s', 'We are looking at it. PRIVATE-TEXT', false, null, '1.1.1.1', 'ua')" % (SU, T1)) or {}
    ok(r.get("status") == "waiting" and r.get("first_response_at") and r.get("last_by") == "support" and r.get("replies") == 2, "a reply: first response, waiting on the firm")
    au = j("select to_jsonb(c) from public.console_audit c order by id desc limit 1") or {}
    ok(au.get("action") == "support.reply" and au.get("target_id") == T1 and (au.get("after") or {}).get("chars") == len("We are looking at it. PRIVATE-TEXT") and "PRIVATE-TEXT" not in json.dumps(au), "its audit row: the length, never the text")
    ok(one("select author_name || '|' || from_support::text from public.support_messages where body like 'We are looking%'") == "FinCom support (sup)|true", "the message is FinCom support's")
    r = j("public.console_support_reply('%s', '%s', 'internal: check bridge', true, null, null, null)" % (SU, T1)) or {}
    ok(r.get("status") == "waiting" and r.get("notes") == 1 and one("select action from public.console_audit order by id desc limit 1") == "support.note", "an internal note: status kept, counted as a note")
    g = j("public.console_support_get('%s')" % T1) or {}
    ok(len(g.get("thread", [])) == 3 and any(m["internal"] for m in g["thread"]) and (g.get("firm_summary") or {}).get("name") == "ABC Associates", "one ticket: the thread with notes, the firm's summary")
    ok(one("set fincom.uid = '%s'; select (public.support_get('%s')->'thread')::text" % (S.A1, T1)).count("internal: check") == 0, "the firm still never sees the note (support_get)")
    rb = one("select respond_by from public.support_tickets where id = '%s'" % T1)
    r = j("public.console_support_set('%s', '%s', 'resolved', 'urgent', 'sup@fincom.live', 'fixed bridge', null, null)" % (SU, T1)) or {}
    ok(r.get("status") == "resolved" and r.get("priority") == "urgent" and r.get("assignee") == "sup@fincom.live" and r.get("resolved_at") and one("select respond_by from public.support_tickets where id = '%s'" % T1) != rb,
       "status, priority (SLA times moved) and assignee")
    ok(call("public.console_support_set('%s', '%s', 'resolved', null, null, null, null, null)" % (SU, T1)) is not None, "the same again: refused")
    ok(call("public.console_support_set('%s', '%s', 'eaten', null, null, null, null, null)" % (SU, T1)) is not None, "a status not in the list: refused")
    ok((j("public.console_support_assignees()") or [{}])[0].get("email") and all(x["role"] != "viewer" for x in j("public.console_support_assignees()") or []), "assignees: admins, not viewers")

    print("== 6. see as this firm")
    n0 = AUD(); a0 = int(one("select count(*) from public.tally_alerts") or 0)
    ok(call("public.console_seeas('%s', '%s', 'ticket T-1001 check', null, null)" % (B, S.F1)) is not None and call("public.console_seeas('%s', '%s', 'ticket T-1001 check', null, null)" % (V, S.F1)) is not None, "Billing and Viewer refused")
    ok(call("public.console_seeas('%s', '%s', 'ticket T-1001 check', null, null)" % (SU, S.U(999))) is not None, "an unknown firm refused")
    ok(call("public.console_seeas('%s', '%s', 'x', null, null)" % (SU, S.F1)) is not None, "no reason: refused")
    ok(AUD() == n0 and int(one("select count(*) from public.tally_alerts") or 0) == a0 and one("select count(*) from public.console_view_log") == "0", "refusals write nothing")
    raw = one(SR + "select public.console_seeas('%s', '%s', 'ticket T-1001: Tally posting fails', '2.2.2.2', 'ua')::text" % (SU, S.F1)) or ""
    try: X = json.loads(raw)
    except Exception: X = {}
    ok((X.get("firm") or {}).get("name") == "ABC Associates" and (X.get("plan") or {}).get("name") == "Pay as you go" and float((X.get("credit") or {}).get("balance") or 0) == 1000, "summary: firm, plan, credit")
    c = X.get("clients") or {}
    ok(c.get("total") == 2 and c.get("active") == 2 and c.get("deleted") == 1 and c.get("with_gstin") == 1 and c.get("names") is None, "clients as counts only")
    ok(len((X.get("credit") or {}).get("entries", [])) == 3 and (X.get("team") or {}).get("active") == 2, "credit entries and team")
    ok(((X.get("tally") or {}).get("postings") or {}).get("failed_7d") == 1 and len((X.get("tally") or {}).get("devices", [])) == 1, "Tally status: postings and the firm's computers")
    ok("SECRET" not in raw and "detail" not in raw, "never a client's name or an activity's text")
    ok(AUD() == n0 + 1 and one("select action || '|' || target_id || '|' || reason from public.console_audit order by id desc limit 1") == "seeas.open|%s|ticket T-1001: Tally posting fails" % S.F1, "the audit row")
    ok(one("select count(*) || '|' || max(reason) || '|' || bool_and(not client_data)::text from public.console_view_log where firm_id = '%s'" % S.F1) == "1|ticket T-1001: Tally posting fails|true", "the view log row")
    w = one("select words || '|' || kind || '|' || (data->>'what') from public.tally_alerts where firm_id = '%s' order by id desc limit 1" % S.F1) or ""
    ok(re.match(r"^FinCom support viewed your account on \d\d [A-Z][a-z]{2} \d{4}: ticket T-1001: Tally posting fails\|summary\|support_view$", w) is not None, "the firm's bell: %s" % w)
    ok(X.get("notice", "").startswith("FinCom support viewed your account on"), "the answer says what the firm was told")
    e = call("public.console_seeas('%s', '%s', 'second look, same day', null, null)" % (O, S.F1))
    ok(e is None and one("select count(*) from public.tally_alerts where firm_id = '%s' and data->>'what' = 'support_view'" % S.F1) == "2", "a second view the same day: a notice of its own %s" % (e or ""))
    db.sql("create table public.firm_support_access (firm_id uuid primary key, allowed_until timestamptz, include_client_data boolean, set_by uuid, set_at timestamptz default now());"
           "insert into public.firm_support_access values ('%s', now() + interval '1 day', true, '%s');" % (S.F1, S.A1))
    raw2 = one(SR + "select public.console_seeas('%s', '%s', 'firm asked us to look', null, null)::text" % (SU, S.F1)) or ""
    ok("SECRET CLIENT ONE" in raw2 and json.loads(raw2).get("client_data") is True and "detail" not in raw2, "with the firm's consent row: client names (never books or activity text)")
    ok(try_sql("update public.console_view_log set reason = 'x'") is not None and try_sql("delete from public.console_view_log") is not None, "the view log is append-only")
    vl = j("public.console_view_list('%s')" % S.F1) or []
    ok(len(vl) == 3 and vl[0].get("admin") == "sup@fincom.live", "the views of a firm, newest first")

    print("== 7. exports")
    L = j("public.console_ledger(null, null, 5000)") or {}
    ok(L.get("total") == 4 and len(L.get("rows", [])) == 4 and L["rows"][0].get("firm") and any(r.get("amount_paise") == -350 for r in L["rows"]), "ledger: every firm's entries, amount in paise too")
    L2 = j("public.console_ledger(now() - interval '2 days', now(), 5000)") or {}
    ok(L2.get("total") == 2, "ledger: a date range")
    ok((j("public.console_ledger(null, null, 1)") or {}).get("rows", [None, None]).__len__() == 1, "ledger: a limit")
    A = j("public.console_export_audit(50000)") or {}
    ok(A.get("total") == AUD() and len(A.get("rows", [])) == AUD() and A["rows"][0].get("who_email"), "the change history, all of it")
except Exception as e:
    ok(False, "the checks stopped: %s" % str(e)[:300])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
