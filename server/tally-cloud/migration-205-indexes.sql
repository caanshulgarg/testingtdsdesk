-- migration-205: its indexes, one statement per line, for tools/apply_concurrent_indexes.py (after migration-205-db-speed-2.sql itself; see its
-- header). Each built CONCURRENTLY, checked valid; any other line runs after every index is valid.
create index concurrently if not exists tally_vouchers_cmp_gstin on public.tally_vouchers (book_id, cmp_gstin);
create index concurrently if not exists assistant_notice_events_notice_id_fkey_idx on public.assistant_notice_events (notice_id);
create index concurrently if not exists call_batch_members_firm_id_fkey_idx on public.call_batch_members (firm_id);
create index concurrently if not exists call_captions_batch_id_fkey_idx on public.call_captions (batch_id);
create index concurrently if not exists call_captions_firm_id_fkey_idx on public.call_captions (firm_id);
create index concurrently if not exists call_captions_participant_id_fkey_idx on public.call_captions (participant_id);
create index concurrently if not exists call_consents_firm_id_fkey_idx on public.call_consents (firm_id);
create index concurrently if not exists call_consents_participant_id_fkey_idx on public.call_consents (participant_id);
create index concurrently if not exists call_consents_recording_id_fkey_idx on public.call_consents (recording_id);
create index concurrently if not exists call_invites_firm_id_fkey_idx on public.call_invites (firm_id);
create index concurrently if not exists call_messages_firm_id_fkey_idx on public.call_messages (firm_id);
create index concurrently if not exists call_messages_participant_id_fkey_idx on public.call_messages (participant_id);
create index concurrently if not exists call_pieces_firm_id_fkey_idx on public.call_pieces (firm_id);
create index concurrently if not exists call_recordings_batch_id_fkey_idx on public.call_recordings (batch_id);
create index concurrently if not exists call_recordings_firm_id_fkey_idx on public.call_recordings (firm_id);
create index concurrently if not exists call_remote_sessions_room_id_fkey_idx on public.call_remote_sessions (room_id);
create index concurrently if not exists call_transcripts_batch_id_fkey_idx on public.call_transcripts (batch_id);
create index concurrently if not exists call_transcripts_firm_id_fkey_idx on public.call_transcripts (firm_id);
create index concurrently if not exists firm_signals_firm_id_fkey_idx on public.firm_signals (firm_id);
create index concurrently if not exists subscriptions_plan_id_fkey_idx on public.subscriptions (plan_id);
create index concurrently if not exists tally_bridge_update_asks_firm_id_fkey_idx on public.tally_bridge_update_asks (firm_id);
create index concurrently if not exists tally_work_claims_firm_id_fkey_idx on public.tally_work_claims (firm_id);
