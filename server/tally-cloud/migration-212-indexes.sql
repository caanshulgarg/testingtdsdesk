-- migration-212: its indexes, one statement per line, for tools/apply_concurrent_indexes.py (after migration-212-post-withdraw.sql itself; see its
-- header). Each built CONCURRENTLY, checked valid; every other line runs after every index is valid: the two guard triggers (tally_post_withdraw_arm: each only when absent, lock_timeout 3 s), then ANALYZE.
create index concurrently if not exists tally_post_ids_withdrawn on public.tally_post_ids (firm_id, fincom_id) where withdrawn_at is not null;
create index concurrently if not exists tally_post_ids_withdrawn_job on public.tally_post_ids (job_id) where withdrawn_at is not null;
select public.tally_post_withdraw_arm();
analyze public.tally_post_ids;
