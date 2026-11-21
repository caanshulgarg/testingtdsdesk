-- migration-204: its indexes, one statement per line, for tools/apply_concurrent_indexes.py (after migration-204-db-speed.sql itself; see its
-- header). Each built CONCURRENTLY, checked valid; any other line runs after every index is valid.
create index concurrently if not exists tally_recorder_lines_remote_guid on public.tally_recorder_lines (book_id, (coalesce(payload->>'remoteGuid', payload->>'remote_guid'))) where coalesce(payload->>'remoteGuid', payload->>'remote_guid', '') <> '';
analyze public.tally_recorder_lines;
