-- migration-215: its indexes, one statement per line, for tools/apply_concurrent_indexes.py (after migration-215-db-load.sql; see its header).
-- tally-ingest's beat (heldOwnLines, ledgersWantedFor): a bridge's held lines by computer key and bridge id, and the ":resolved" rows by line id (firm, no book); tally_read_view's "already resolved" check.
create index concurrently if not exists tally_recorder_lines_firm_line on public.tally_recorder_lines (firm_id, line_id);
create index concurrently if not exists tally_recorder_lines_held_bridge on public.tally_recorder_lines (device_id, bridge, received_at) where state in ('held', 'fetching');
comment on index public.tally_recorder_lines_firm_line is 'db load (migration 215)';
comment on index public.tally_recorder_lines_held_bridge is 'db load (migration 215)';
analyze public.tally_recorder_lines;
