"""python3 run_migration_order.py - the order the cloud migrations run in on a fresh database (03-Oct-2026, round 4 items
1-3; docs/MIGRATION-ORDER.md): BOTH valid orders, each applied TWICE on its own database: staging's (32 -> 33 -> 35 -> 34 as FIRST run there, commit 2105b2d
-> 36b -> 37 -> 36 -> 38 -> 39 -> 40 -> 41 -> 42 -> 43 -> 44 -> 45 -> 46 -> 47 -> 48 -> 49 -> 50 -> 51 -> 52 -> 53 -> 54 -> 55 -> 56 -> 57 -> 58 -> 59 -> 60 -> 67) and a fresh database's (32 -> 33 -> 35 -> 34 reviewed -> 36 -> 36b -> 37 -> 38 -> 39 -> 40 -> 41 -> 42 -> 43 -> 44 -> 45 -> 46 -> 47 -> 48 -> 49 -> 50 -> 51 -> 52 -> 53 -> 54 -> 55 -> 56 -> 57 -> 58 -> 59 -> 60 -> 67); the function texts
the two orders end with are compared and must be identical (round 9), on a throwaway PostgreSQL (pg_stand)
with the tables as on staging (run_migration33's schema, tally_devices, tally_bills) and made-up rows; never on staging.
Checks: every file runs, twice, and deletes nothing; after the run the release functions are migration-34's
(tally_release_approve checks pilot_allowlist_measured; tally_release_pilot clears it), which holds only because the
revised migration-35 no longer defines tally_release_pilot / tally_release_approve (asserted on the file's text: running
35 after 34 would otherwise put back the older functions without the allow-list check); migration-36's functions are
there; every function of 35, 34 and 36 is security definer with search_path = public, pg_temp."""
import os, re, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
BASE = [(32, "migration-32-sync-safety.sql"), (33, "migration-33-ledger-lists.sql"), (35, "migration-35-bridge-control.sql")]
# the two valid orders (docs/MIGRATION-ORDER.md): staging's (the FIRST 34, commit 2105b2d, then 36b and 37 run on 03-Oct, then 36 and 38) and a fresh database's
ORDERS = {"staging": BASE + [("34 (first, as on staging)", os.path.join("..", "..", "tests", "fixtures", "migration-34-as-run-on-staging.sql")), ("36b", "migration-36b-post-acceptance.sql"), (37, "migration-37-follow-ups.sql"), (36, "migration-36-ledger-rename.sql"), (38, "migration-38-post-followups.sql"), (39, "migration-39-rename-map-empty-day.sql"), (40, "migration-40-states-carried.sql"), (41, "migration-41-day-counts.sql"), (42, "migration-42-empty-day-second-read.sql"), (43, "migration-43-posting-reply.sql"), (44, "migration-44-recorder.sql"), (45, "migration-45-bulk-posting.sql"), (46, "migration-46-trial-tools.sql"), (47, "migration-47-recorder-queue-alerts.sql"), (48, "migration-48-day-cache-once.sql"), (49, "migration-49-post-row-flags.sql"), (50, "migration-50-recorder-held.sql"), (51, "migration-51-recorder-ids-mismatch.sql"), (52, "migration-52-recorder-duplicate-needs-same-entry.sql"), (53, "migration-53-recorder-placeholder-settled.sql"), (54, "migration-54-post-target-bridge.sql"), (55, "migration-55-settle-and-lease.sql"), (56, "migration-56-keep-fields.sql"), (57, "migration-57-entry-details.sql"), (58, "migration-58-lows.sql"), (59, "migration-59-ledger-aliases.sql"), (60, "migration-60-recorder-lows.sql"), (67, "migration-67-recorder-renumbered.sql")],
          "fresh": BASE + [(34, "migration-34-ledger-safety.sql"), (36, "migration-36-ledger-rename.sql"), ("36b", "migration-36b-post-acceptance.sql"), (37, "migration-37-follow-ups.sql"), (38, "migration-38-post-followups.sql"), (39, "migration-39-rename-map-empty-day.sql"), (40, "migration-40-states-carried.sql"), (41, "migration-41-day-counts.sql"), (42, "migration-42-empty-day-second-read.sql"), (43, "migration-43-posting-reply.sql"), (44, "migration-44-recorder.sql"), (45, "migration-45-bulk-posting.sql"), (46, "migration-46-trial-tools.sql"), (47, "migration-47-recorder-queue-alerts.sql"), (48, "migration-48-day-cache-once.sql"), (49, "migration-49-post-row-flags.sql"), (50, "migration-50-recorder-held.sql"), (51, "migration-51-recorder-ids-mismatch.sql"), (52, "migration-52-recorder-duplicate-needs-same-entry.sql"), (53, "migration-53-recorder-placeholder-settled.sql"), (54, "migration-54-post-target-bridge.sql"), (55, "migration-55-settle-and-lease.sql"), (56, "migration-56-keep-fields.sql"), (57, "migration-57-entry-details.sql"), (58, "migration-58-lows.sql"), (59, "migration-59-ledger-aliases.sql"), (60, "migration-60-recorder-lows.sql"), (67, "migration-67-recorder-renumbered.sql")]}
READERS = ["tally_tb", "tally_period", "tally_mis", "tally_gst_summary", "tally_ledger", "tally_balances_on", "tally_ledger_hold_reason", "tally_ledgers_a_guard", "tally_ledger_round_seen", "tally_ledger_rename", "tally_ledger_carry", "tally_post_ids_sync", "tally_ingest_day", "tally_ledger_carry_choices", "tally_ledger_rename_confirm", "tally_post_result_taken", "tally_post_result_confirmed", "tally_post_job_accepted", "tally_post_result_accepted", "tally_post_job_settle", "tally_post_id_accept_reply", "tally_device_post_settings", "tally_post_id_accept",
           "tally_ingest_entries", "tally_ingest_delete", "tally_ledger_day_rebuild", "tally_month_locked", "tally_voucher_version_lines", "tally_recorder_line", "tally_recorder_apply", "tally_month_lock", "tally_month_unlock", "tally_recorder_release_held", "tally_tieout_save", "tally_start_point", "tally_fincom_id", "tally_control_kept", "tally_ledger_marks_frozen",
           "tally_recorder_gap_check", "tally_post_window_save", "tally_post_xml_for", "tally_post_live_for", "tally_recorder_short_held", "tally_recorder_short_retry", "tally_device_trial_tools",
           "tally_ingest_entries/3", "tally_recorder_enqueue", "tally_recorder_drain", "tally_alert_working_now", "tally_alert_scan_gaps", "tally_alert_scan_silent", "tally_alert_daily_summary", "tally_alert_read", "tally_device_recorder_source",
           # round 21 (docs/reviews/migration-47-48-review.md)
           "tally_recorder_send", "tally_recorder_take", "tally_recorder_settle", "tally_recorder_fail", "tally_recorder_why", "tally_service_or_owner", "tally_try_uuid", "tally_upload_advance",
           "tally_recorder_drain_run", "tally_recorder_archive_trim",
           # 05-Oct-2026 (migration 50: the held words, replaced, the day release)
           "tally_recorder_release_day", "tally_days_recorder_release",
           # 05-Oct-2026 (migration 53: a placeholder line whose entry the copy holds; the AlterID received only from lines whose ids belong together)
           "tally_recorder_ids_together",
           # 05-Oct-2026 (migration 54: a posting names the bridge that posts it; changes only; the member's bridge)
           "tally_post_enqueue_to", "tally_post_take_for", "tally_bridge_changes_only", "tally_member_bridge_link", "tally_post_enqueue_core", "tally_bridge_bind", "tally_post_device_for", "tally_bridge_reset", "tally_post_nobody_words",
           # 05-Oct-2026 (migration 54, the owner's rule: no conditions on any bridge)
           "tally_bridge_may_post", "tally_bridge_user", "tally_bridge_takes_unnamed", "tally_bridge_poster", "tally_post_reroute", "tally_bridge_is_own", "tally_post_own_bridge", "tally_post_own_words",
           "tally_bridge_has_open", "tally_bridge_own_key", "tally_device_create", "tally_want_update", "tally_read_resume",
           # 05-Oct-2026 (migration 55: any member settles an uncertain posting after the bridge's check; the lease's purpose and "want to post")
           "tally_post_job_mark_posted", "tally_post_id_release_owner", "tally_post_settle_ask", "tally_post_checks_for", "tally_post_check_report", "tally_post_mark_core", "tally_post_release_core", "tally_member_name",
           # 06-Oct-2026 (migration 56: a recorder line keeps the fields its request does not fetch; the repair, not run)
           "tally_ingest_entries/5", "tally_recorder_keep_vouchers", "tally_recorder_keep_lines", "tally_recorder_blanked", "tally_recorder_restore_fields", "tally_recorder_restore_fields/2", "tally_unknown_ledger_entries", "tally_recorder_pair_lines",
           # 06-Oct-2026 (migration 57, bridge 2.3.1 part A: the entry's details, written by the entry path for both paths)
           "tally_ingest_details", "tally_tds_details"]
texts = {}
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
SCHEMA37 = part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X")      # what 37's functions need beyond the two (tally_bills, tally_d8, …)
SCHEMA47 = part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47")      # pgmq, pg_cron, Storage and migration 13's tally_jobs, as 47 needs them
BILLS = """create table if not exists tally_bills (book_id uuid not null references tally_books (book_id) on delete cascade, firm_id uuid not null, guid text not null, day date not null,
  ledger text not null, name text not null default '', type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date);"""
F, U, B, DEV = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555", "11111111-1111-1111-1111-111111111111", "d1000000-0000-0000-0000-000000000001"
def run_order(label, ORDER):
    global db
    db = pg_stand.start(55448)
    def psql_file(path):
        if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
        return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                               "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
    def fdef(fn, args=None):
        """the text of a function; args (a type list) when the name is overloaded"""
        return db.one("select pg_get_functiondef(%s::%s)" % (q("public." + fn + ("(" + args + ")" if args else "")), "regprocedure" if args else "regproc")) or ""
    try:
        db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(BILLS); db.sql(SCHEMA37); db.sql(SCHEMA47)
        db.sql("insert into firms values (%s, 'Firm') on conflict do nothing; insert into members values (%s, %s, 'Me', 'owner', true);" % (q(F), q(U), q(F)))
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');" % (q(B), q(F)))
        db.sql("insert into tally_devices (id, firm_id, name, key_hash, version) values (%s, %s, 'NWS144', 'h1', '2.1.5');" % (q(DEV), q(F)))
        db.sql("""insert into tally_ledgers (book_id, firm_id, name, parent, open) values (%s, %s, 'Cash', 'Cash-in-Hand', -100), (%s, %s, 'Sales', 'Sales Accounts', 100);
                  insert into tally_vouchers (book_id, firm_id, guid, day) values (%s, %s, 'g-1', '2026-05-01');
                  insert into tally_ledger_day (book_id, firm_id, ledger, day, amount) values (%s, %s, 'Cash', '2026-05-01', -50), (%s, %s, 'Sales', '2026-05-01', 50);""" % ((q(B), q(F)) * 5))
        tables = lambda: [r["t"] for r in db.rows("select table_name as t from information_schema.tables where table_schema = 'public' and table_name like 'tally_%' order by 1")]
        counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in tables()}
        before = counts()
        for round_ in (1, 2):
            for n, f in ORDER:
                f = os.path.normpath(os.path.join(SQLDIR, f))
                r = psql_file(f)
                ok(r.returncode == 0, "pass %d: migration-%s runs %s" % (round_, n, (r.stderr or "").strip()[-400:] if r.returncode else ""))
                if r.returncode: raise SystemExit("cannot go on: migration-%s failed" % n)
            k = counts()
            ok(all(k.get(t) == v for t, v in before.items()), "pass %d: nothing deleted (%s rows kept)" % (round_, sum(before.values())))
        ARGS = {"tally_ingest_day": "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean", "tally_ingest_entries": "uuid, jsonb, jsonb, boolean", "tally_ingest_entries/3": "uuid, jsonb, jsonb", "tally_ingest_entries/5": "uuid, jsonb, jsonb, boolean, boolean", "tally_recorder_restore_fields": "uuid", "tally_recorder_restore_fields/2": "uuid, boolean"}
        for fn in READERS: texts.setdefault(fn, {})[label] = re.sub(r"\s+", " ", fdef(fn.split("/")[0], ARGS.get(fn)))
        ok("tally_post_job_accepted" in fdef("tally_post_ids_sync") and "tally_post_result_taken" in fdef("tally_post_ids_sync") and "tally_post_result_confirmed" not in fdef("tally_post_ids_sync") and "tally_post_result_taken" in fdef("tally_post_job_accepted"), "migration-40's sync and tally_post_job_accepted (39/36b's rules, calling tally_post_result_taken) are in force")
        ok(db.one("select count(*) from information_schema.columns where (table_name, column_name) in (('client_book_items', 'carried'), ('tally_ledgers', 'state'))") == "2" and "'states'" in fdef("tally_ledger_carry_choices") and "carriedTo" not in fdef("tally_ledger_carry_choices"), "40: client_book_items.carried, tally_ledgers.state; the carry marks `carried`, not data")
        ok("short read" in fdef("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean") and "p_empty" in fdef("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean")
           and "null::boolean" in fdef("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer"), "39: tally_ingest_day with p_empty (8), the 7-argument one passing null")
        ok("postOnly" in fdef("tally_post_result_accepted") and "postOnly" in fdef("tally_post_job_accepted") and "empty_at" in fdef("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean") and "second empty read" in fdef("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean")
           and db.one("select count(*) from information_schema.columns where table_name = 'tally_days' and column_name in ('empty_at', 'note')") == "2" and "do nothing" in fdef("tally_ledger_carry_choices"), "41: PostOnly never accepted, tally_days.empty_at / note, the empty-read cap, the carry never revives (in force in this order)")
        d8 = fdef("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean")
        ok("live entries: confirm by a second empty read" in d8 and "not emptied then tally_days.n" in d8 and "prev_n" not in d8 and "read empty within 24 hours" in d8, "42: any day with live entries is emptied only on the second consecutive empty read; n never decides and is not zeroed by a read that marked nothing (in force in this order)")
        ok("empty day with%" in d8 and "however old" in d8 and db.one("select count(*) from information_schema.columns where (table_name, column_name) in (('tally_devices', 'post_only'), ('tally_devices', 'post_batch_bills'), ('tally_devices', 'post_batch_bank'), ('tally_devices', 'post_settings_at'), ('tally_devices', 'post_settings_by'), ('tally_post_ids', 'reply_vch'), ('tally_post_ids', 'batch_end'), ('tally_post_ids', 'batch_n'), ('tally_post_ids', 'matched_at'), ('tally_post_ids', 'matched_vch'), ('tally_post_jobs', 'timing'))") == "11"
           and "byReply" in fdef("tally_post_result_taken") and "needsReview" in fdef("tally_post_result_taken") and "needsReview" in fdef("tally_post_job_accepted") and "need review" in fdef("tally_post_job_settle") and db.one("select count(*) from pg_proc where proname in ('tally_post_id_accept_reply', 'tally_device_post_settings')") == "2",
           "43: the pending days count however old; the settings, reply and timing columns; the reply states in taken / job_accepted / settle; the two new functions (in force in this order)")
        ok("tally_ingest_entries(" in d8 and "month locked" in d8 and "tally_month_locked" in fdef("tally_ingest_entries", "uuid, jsonb, jsonb, boolean") and db.one("select count(*) from pg_class where relname in ('tally_recorder_lines', 'tally_month_locks', 'tally_tieouts') and relrowsecurity") == "3"
           and "(% given)" in fdef("tally_device_post_settings") and db.one("select count(*) from information_schema.columns where table_name = 'tally_sync_cursor' and column_name in ('start_guid', 'start_at', 'start_device')") == "3"
           and db.one("select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('tally_fincom_id', 'tally_post_bool', 'tally_post_accept_text', 'tally_post_id_match', 'tally_post_result_accepted', 'tally_post_result_taken', 'tally_post_result_confirmed', 'tally_post_job_settle', 'tally_ledger_marks_frozen', 'tally_control_kept') and array_to_string(proconfig, ',') like '%search_path%'") == "10",
           "44: tally_ingest_day through tally_ingest_entries with the month lock; the recorder, month-lock and tie-out tables with RLS; the starting point's columns; the ten functions with a search_path; '(% given)' (in force in this order)")
        ok(db.one("select relrowsecurity from pg_class where relname = 'tally_post_windows'") == "t" and "tally_post_windows" in fdef("tally_recorder_gap_check") and "tally_post_live_for" in fdef("tally_recorder_line")
           and "matches no posting of this firm" in fdef("tally_recorder_line") and db.one("select count(*) from information_schema.columns where (table_name, column_name) in (('tally_post_ids', 'matched_guid'), ('tally_post_ids', 'matched_mid'), ('tally_post_ids', 'matched_alter'), ('tally_sync_cursor', 'match_alter'), ('tally_sync_cursor', 'match_start'))") == "5"
           and db.one("select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.tally_books'::regclass and conrelid in ('public.tally_recorder_lines'::regclass, 'public.tally_month_locks'::regclass, 'public.tally_tieouts'::regclass, 'public.tally_post_windows'::regclass) and confdeltype = 'r'") == "4",
           "45: the posting windows (RLS) in the gap check, the short line matched through tally_post_live_for, the matched_* and match_* columns, the foreign keys to tally_books restrict (in force in this order)")
        ok("match_at = now()" in fdef("tally_recorder_gap_check") and "since_fb" in fdef("tally_recorder_gap_check") and "below the last match" in fdef("tally_recorder_gap_check")
           and "changed in Tally after posting" in fdef("tally_recorder_line") and "tally_post_id_match(" not in fdef("tally_post_live_for")
           and db.one("select count(*) from pg_proc where proname = 'tally_post_window_save'") == "1" and "more created" in fdef("tally_post_window_save", "uuid, uuid, uuid, bigint, bigint, bigint, bigint, text")
           and db.one("select count(*) from information_schema.columns where (table_name, column_name) in (('tally_sync_cursor', 'match_at'), ('tally_post_windows', 'company_guid'))") == "2"
           and db.one("select count(*) from pg_indexes where indexname in ('tally_post_ids_entry', 'tally_post_ids_fid_an', 'tally_post_ids_entry_an')") == "3"
           and db.one("select count(*) from pg_proc where proname in ('tally_recorder_short_held', 'tally_recorder_short_retry')") == "2",
           "45 (the review's fixes): match_at and the server-time fallback, below the last match, a changed FinCom entry held, the indexed spelling match, one 8-argument window save with bounds and the company GUID, the held short lines retried (in force in this order)")
        ok(db.one("select count(*) from information_schema.columns where table_name = 'tally_devices' and column_name in ('trial_tools', 'trial_tools_at', 'trial_tools_by')") == "3"
           and db.one("select count(*) from tally_devices where trial_tools") == "0" and "only an owner of the firm" in fdef("tally_device_trial_tools")
           and db.one("select has_function_privilege('anon', 'public.tally_device_trial_tools(uuid, boolean)', 'execute')") == "f" and db.one("select has_function_privilege('authenticated', 'public.tally_device_trial_tools(uuid, boolean)', 'execute')") == "t"
           and "otherCompany" in fdef("tally_start_point") and "c.cleared_at > c.start_at" in fdef("tally_start_point") and db.one("select count(*) from pg_proc where proname = 'tally_start_point'") == "1"
           and db.one("select has_function_privilege('authenticated', 'public.tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text)', 'execute')") == "f",
           "46: tally_devices.trial_tools (every computer off) / trial_tools_at / trial_tools_by, the owner's tally_device_trial_tools granted to authenticated, not anon; 46's tally_start_point (another GUID never moves the point; afresh after the owner's clear), one, the service role's (in force in this order)")
        ok(db.one("select count(*) from pgmq.list_queues() where queue_name = 'tally_recorder'") == "1" and db.one("select relrowsecurity from pg_class where relname = 'tally_alerts'") == "t"
           and db.one("select relrowsecurity from pg_class where relname = 'tally_recorder_failures'") == "t" and db.one("select count(*) from pg_indexes where indexname = 'tally_alerts_once'") == "1"
           and db.one("select count(*) from information_schema.columns where (table_name, column_name) in (('tally_devices', 'recorder_source'), ('tally_devices', 'recorder_source_at'), ('tally_devices', 'recorder_source_by'), ('tally_jobs', 'upload'))") == "4"
           and db.one("select count(*) from tally_devices where recorder_source <> 'addon'") == "0" and "upload" in db.one("select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tally_jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'")
           and db.one("select count(*) from storage.buckets where id = 'tally-uploads' and not public and file_size_limit = 2147483648") == "1" and db.one("select count(*) from pg_policies where schemaname = 'storage' and policyname in ('tally_uploads_add', 'tally_uploads_read')") == "2"
           and db.one("select string_agg(jobname || '=' || schedule, ', ' order by jobname) from cron.job where jobname like 'tally-%'") == "tally-alert-gaps=*/10 * * * *, tally-alert-silent=*/30 3-13 * * 1-6, tally-alert-summary=30 13 * * *, tally-recorder-archive-trim=17 21 * * *, tally-recorder-drain=30 seconds"
           and db.one("select command from cron.job where jobname = 'tally-recorder-drain'") == "call public.tally_recorder_drain_run(15000)"
           and "ledger_altered' and og is not null" in fdef("tally_recorder_line") and db.one("select has_function_privilege('authenticated', 'public.tally_recorder_drain(integer)', 'execute')") == "f",
           "47: the queue tally_recorder, tally_alerts / tally_recorder_failures (RLS), recorder_source (every computer addon), tally_jobs.upload and kind upload, the private 2 GB bucket and its two policies, the cron jobs (round 21: the drain a procedure call, 48's archive retention), the rename by GUID in tally_recorder_line (in force in this order)")
        ok("tally_ingest_entries(p_book, p_vouchers, p_lines, true)" in fdef("tally_ingest_entries", "uuid, jsonb, jsonb") and "coalesce(p_rebuild, true)" in fdef("tally_ingest_entries", "uuid, jsonb, jsonb, boolean")
           and "fincom.day_rebuild_once" in fdef("tally_recorder_apply") and "not once" in fdef("tally_recorder_line") and db.one("select count(*) from pg_proc where proname = 'tally_ingest_entries'") == "3"     # 56 adds the 5-argument form
           and db.one("select has_function_privilege('authenticated', 'public.tally_ingest_entries(uuid, jsonb, jsonb, boolean)', 'execute')") == "f",
           "48: tally_ingest_entries with and without the rebuild (the 3-argument one calls it with true), the apply rebuilding once per call (in force in this order)")
        ok("'replaced'::text" in db.one("select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.tally_recorder_lines'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%state%'")
           and db.one("select count(*) from pg_trigger where tgrelid = 'public.tally_days'::regclass and tgname like 'tally_days_recorder_release_%' and not tgisinternal and (tgtype & 1) = 0") == "2"
           and "replaced by line" in fdef("tally_recorder_line") and "day read" not in fdef("tally_recorder_line") and "day read" not in fdef("tally_ingest_delete")
           and "tally_recorder_line(" in fdef("tally_recorder_release_day") and db.one("select count(*) from tally_post_row_flags") == "0",
           "49 and 50: the post row flags; the state 'replaced', the day release on tally_days, no 'day read' in the held words (in force in this order)")
        ok("idsMismatch" in fdef("tally_recorder_line") and "marked duplicate on %" in fdef("tally_recorder_line") and ":resolved" in fdef("tally_recorder_line") and "heldWhy" in fdef("tally_recorder_line"),
           "51: tally_recorder_line reads idsMismatch / lineGuid / heldWhy, never 'duplicate' for ids that did not belong together, replaced by the \":resolved\" line (in force in this order)")
        ok("the add-on named entry %s, but GUID %s is %s %s" in fdef("tally_recorder_line") and "idsMismatch" in fdef("tally_recorder_line"),
           "52: tally_recorder_line never takes an entry of another type, date or number (51's rules kept) (in force in this order)")
        ok("from a Day Book or another line)', s_t, s_no" in fdef("tally_recorder_line") and "the add-on named entry %s, but GUID %s is %s %s" in fdef("tally_recorder_line")
           and all("tally_recorder_ids_together(" in fdef(fn) for fn in ("tally_recorder_line", "tally_recorder_apply", "tally_recorder_release_day", "tally_recorder_release_held", "tally_recorder_short_retry"))
           and "lower(btrim(dv.vtype)) = lower(btrim(l.vch_type))" in fdef("tally_recorder_release_day")
           and db.one("select has_function_privilege('authenticated', 'public.tally_recorder_ids_together(bigint)', 'execute')") == "f"
           and db.one("select has_function_privilege('authenticated', 'public.tally_recorder_release_held(bigint)', 'execute')") == "t",
           "53: a held placeholder line whose entry the copy holds above the starting point is 'duplicate'; the AlterID received only from lines whose ids belong together (52's rules kept) (in force in this order)")
        ok(db.one("select count(*) from information_schema.columns where table_name = 'tally_post_jobs' and column_name = 'target_bridge'") == "1"
           and "target_bridge = p_bridge" in fdef("tally_post_take_for") and "tally_post_enqueue_core(p_id, p_client, p_payload, tdev, t)" in fdef("tally_post_enqueue_to") and "tally_post_enqueue_to(p_id, p_client, p_payload, null, null)" in fdef("tally_post_enqueue", "uuid, text, jsonb")
           and db.one("select has_function_privilege('authenticated', 'public.tally_post_take_for(uuid, text, boolean)', 'execute')") == "f",
           "54: tally_post_jobs.target_bridge; tally_post_enqueue_to and the 3-argument tally_post_enqueue go through tally_post_enqueue_core; tally_post_take_for for the service role only (in force in this order)")
        ok("can_write()" in fdef("tally_post_job_mark_posted") and "tally_post_checks" in fdef("tally_post_id_release_owner") and "tally_post_release_core(" not in fdef("tally_post_check_report") and "tally_post_release_core(" in fdef("tally_post_check_confirm")
           and "want_post_by" in fdef("tally_lease_take", "uuid, uuid, text, uuid, integer, jsonb, text") and "null::text" in fdef("tally_lease_take", "uuid, uuid, text, uuid, integer, jsonb")
           and db.one("select count(*) from information_schema.columns where table_name = 'tally_company_lease' and column_name in ('purpose', 'want_post_by')") == "2"
           and db.one("select has_function_privilege('authenticated', 'public.tally_post_check_report(bigint, uuid, text, boolean, text, text, text, text, text)', 'execute')") == "f",
           "55: any member who may write settles (mark posted; the bridge's report never releases: only a member's confirm after the bridge's 'not seen'); the lease's purpose and want to post (in force in this order)")
        ok("not once, true)" in fdef("tally_recorder_line") and "tally_ingest_entries(p_book, vs, ls, p_rebuild)" in fdef("tally_ingest_entries", "uuid, jsonb, jsonb, boolean, boolean")
           and "tally_ingest_entries(p_book, p_vouchers, p_lines, true)" in fdef("tally_ingest_entries", "uuid, jsonb, jsonb") and "keep" not in fdef("tally_ingest_entries", "uuid, jsonb, jsonb, boolean")
           and db.one("select count(*) from pg_proc where proname = 'tally_ingest_entries'") == "3" and db.one("select relrowsecurity from pg_class where relname = 'tally_recorder_restore_log'") == "t"
           and db.one("select has_function_privilege('authenticated', 'public.tally_recorder_restore_fields(uuid)', 'execute')") == "f"
           and db.one("select has_function_privilege('authenticated', 'public.tally_recorder_restore_fields(uuid, boolean)', 'execute')") == "f"
           and db.one("select has_function_privilege('authenticated', 'public.tally_unknown_ledger_entries(uuid)', 'execute')") == "t"
           and db.one("select has_function_privilege('service_role', 'public.tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean)', 'execute')") == "f",
           "56: the recorder's line keeps (the 5-argument entry path); 48's 3- and 4-argument forms unchanged (the Day Book's); the repair (dry run) and its log, the service role's; the unknown-ledger list for members (in force in this order)")
        ok("perform tally_ingest_details(p_book, vs, coalesce(p_keep, false));" in fdef("tally_ingest_entries", "uuid, jsonb, jsonb, boolean, boolean")
           and "p_lines, true, false);" in fdef("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean") and "nothing to remove: the entry is not in FinCom" in fdef("tally_ingest_delete")
           and db.one("select count(*) from pg_class where relname in ('tally_item_lines', 'tally_cost_allocs', 'tally_bank_allocs', 'tally_tds_lines') and relrowsecurity") == "4"
           and db.one("select count(*) from information_schema.columns where table_name = 'tally_vouchers' and column_name in ('irn', 'irn_ack_no', 'irn_ack_date', 'eway_no', 'check_notes')") == "5"
           and db.one("select has_function_privilege('service_role', 'public.tally_ingest_details(uuid, jsonb, boolean)', 'execute')") == "f"
           and db.one("select count(*) from information_schema.columns where table_name = 'tally_ledgers' and column_name = 'tds_deductee_type'") == "1"
           and db.one("select has_function_privilege('authenticated', 'public.tally_tds_details(uuid)', 'execute')") == "t"
           and db.one("select relrowsecurity::text from pg_class where oid = 'public.tally_nothing_removed'::regclass") == "true"
           and "tally_nothing_removed" in fdef("tally_ingest_delete") and "x.valt > x.vcc" in fdef("tally_ingest_entries", "uuid, jsonb, jsonb, boolean, boolean"),
           "57: the entry's details (items, cost centres, bank, TDS, e-invoice, e-way bill, the checks' words) written by the 5-argument entry path, the Day Book through it; a delete of an entry never in the copy settles (in force in this order)")
        ok("not once, true)" in fdef("tally_recorder_line") and "only the add-on''s placeholder" in fdef("tally_recorder_line") and "then_cancel" in fdef("tally_recorder_line")
           and db.one("select has_function_privilege('service_role', 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)', 'execute')") == "f",
           "60: the recorder's line is 56's (it keeps) with R3-L1..L3 (the owner's 'nothing to remove' stays 57's); granted to nobody (in force in this order)")
        ok(db.one("select count(*) from information_schema.columns where table_name = 'tally_ledger_aliases' and column_name in ('book_id', 'firm_id', 'tally_name', 'fincom_name', 'tally_guid', 'seen_at', 'confirmed_at', 'ended_at')") == "8"
           and db.one("select relrowsecurity::text from pg_class where oid = 'public.tally_ledger_aliases'::regclass") == "true"
           and db.one("select has_table_privilege('anon', 'public.tally_ledger_aliases', 'select')::text") == "false",
           "59: tally_ledger_aliases (a ledger renamed in Tally: Tally's name -> FinCom's ledger), row security on, nothing for anon (in force in this order)")
        ok("tally_ledger_carry_choices" in fdef("tally_ledger_rename") and db.one("select count(*) from information_schema.columns where table_name = 'tally_ledgers' and column_name = 'needs_confirm'") == "1", "39: the rename carries the choices; tally_ledgers.needs_confirm")
        ok(db.one("select string_agg(confdeltype::text, '') from pg_constraint where conrelid = 'public.tally_post_marks'::regclass and contype = 'f'") == "rr", "38: tally_post_marks' foreign keys restrict (no cascade)")
        for fn in ("tally_tb", "tally_period", "tally_balances_on"): ok("d.merged_into is null" in fdef(fn), "%s hides the twins" % fn)
        if label != "fresh": return
        # (the fresh order only) the release functions are migration-34's, because 35 ran before 34 and no longer defines them
        ok("pilot_allowlist_measured" in fdef("tally_release_approve"), "tally_release_approve is migration-34's: it checks pilot_allowlist_measured")
        ok("pilot_allowlist_measured = null" in fdef("tally_release_pilot").replace("  ", " "), "tally_release_pilot is migration-34's: a new pilot clears pilot_allowlist_measured")
        ok(db.one("select array_to_string(proconfig, ',') from pg_proc where proname = 'tally_release_approve'").replace(" ", "") == "search_path=public,pg_temp", "tally_release_approve searches public, pg_temp")
        m35 = open(os.path.join(SQLDIR, "migration-35-bridge-control.sql")).read()
        ok("create or replace function public.tally_release_" not in m35, "the revised migration-35 no longer defines tally_release_pilot / tally_release_approve")
        ok("tally_release_pilot" not in re.sub(r"(?m)^\s*--.*$", "", m35) and "tally_release_approve" not in re.sub(r"(?m)^\s*--.*$", "", m35), "and its revoke/grant lines no longer name them")
        ok(re.search(r"(?i)never run this file after migration 34", m35) is not None, "the file says at its top: never run it after migration 34")
        for fn in ["tally_ledger_rename", "tally_ledger_round_seen", "tally_ledger_round_batch", "tally_ledgers_mark_gone", "tally_ledger_hold_reason", "tally_read_stop", "tally_ingest_ledgers_g"]:
            ok(db.one("select count(*) from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)) not in (None, "0"), "%s is there" % fn)
        ok("tally_balances" in fdef("tally_ledger_rename") and "trial balance" in fdef("tally_ledger_rename"), "tally_ledger_rename is migration-36's (the trial-balance check)")
        ok("seen_round" not in fdef("tally_ledger_round_batch", "uuid, text, integer, integer, boolean, uuid, text, jsonb") and "seen_round" in fdef("tally_ledger_round_seen"), "the batch counts, the stamp is tally_ledger_round_seen's (migration-36)")
        # every function of 35, 34 and 36: security definer, search_path = public, pg_temp (32 and 33 ran on staging with 'public';
        # 34 replaces their ingest functions)
        n = 0
        for _, f in ORDER[2:]:
            for fn in sorted(set(re.findall(r"function\s+public\.(\w+)\s*\(", open(os.path.normpath(os.path.join(SQLDIR, f))).read()))):
                for row in db.rows("select prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)):
                    if row["prosecdef"] != "t": continue       # plain trigger functions touch no table
                    n += 1
                    # migration 54's tally_device_create (migration.sql's, without the limit of 50 keys) needs pgcrypto, in extensions on Supabase
                    want = "search_path=public,extensions,pg_temp" if fn == "tally_device_create" else "search_path=public,pg_temp"
                    if row["conf"].replace(" ", "") != want: ok(False, "%s (%s): search_path = %r" % (fn, f, row["conf"]))
        ok(n >= 20, "%d security definer functions all search public, pg_temp" % n)
        # round 5 (S1): after 36 -> 36b -> 37, an id Tally accepted stays live when the posting is failed or cancelled; a plain one is freed
        J1 = "00000001-0000-0000-0000-000000000000"
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, 2, 'running')"
               % (q(J1), q(F), q('{"vouchers": [{"id": "A1", "xml": "<NARRATION>TDSDesk:A1</NARRATION>"}, {"id": "A2", "xml": "<NARRATION>TDSDesk:A2</NARRATION>"}]}')))
        db.one("select tally_post_id_accept(%s::uuid, 'A1', '26298')::text" % q(J1))
        liv = lambda: {x["fincom_id"]: x["live"] for x in db.rows("select fincom_id, live from tally_post_ids where job_id = %s" % q(J1))}
        db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J1))
        ok(liv() == {"A1": "t", "A2": "f"}, "S1. 36b then 37: the posting failed, the accepted A1 stays live, A2 is freed (%s)" % liv())
        db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J1))
        ok(liv()["A1"] == "t", "S1. cancelled: A1 still live (%s)" % liv())
        ok("accepted_at" in fdef("tally_post_ids_sync") and "released_at" in fdef("tally_post_ids_sync"), "the sync in force (37's) keeps both guards: accepted_at and released_at")
        ok(db.one("select count(*) from pg_proc where proname = 'tally_post_id_release_owner'") == "1", "tally_post_id_release_owner (36b) is there")
    finally:
        db.stop()

for label in ("staging", "fresh"):
    print("== order: " + label + ": " + " -> ".join(str(n) for n, _ in ORDERS[label]))
    run_order(label, ORDERS[label])
same = [fn for fn in READERS if len(set(texts.get(fn, {}).values())) == 1 and len(texts.get(fn, {})) == 2]
ok(len(same) == len(READERS), "both orders end with the same function texts (%s)" % ([fn for fn in READERS if fn not in same] or "all %d" % len(READERS)))
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
