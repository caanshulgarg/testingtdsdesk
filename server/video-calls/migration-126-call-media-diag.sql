-- migration-126-call-media-diag.sql (28-Oct-2026, branch next-fix-meet-media; NOT run: the owner runs it)
-- What each person's call connection did, for the next look at a call with no picture or voice:
--   call_participants.media_diag   the last report of the person's browser through fincom-call's "cf" step "diag"
--     (rules.js callDiag: ICE and connection state, the candidate types used, TURN offered or not, bytes received and
--     sent per kind, the tracks wanted and got, the pull errors' codes, reconnects). No media, no names, no addresses.
-- Add-only. Written by fincom-call (service role) only; a member's token cannot read or write it (no column grant to
-- authenticated: migration 106 grants that role named columns only). Row-level security of call_participants is
-- unchanged (enabled in migration 102). Before this runs, fincom-call keeps the report in its log line alone.
alter table public.call_participants add column if not exists media_diag jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'call_participants_media_diag' and conrelid = 'public.call_participants'::regclass) then
    alter table public.call_participants add constraint call_participants_media_diag
      check (media_diag is null or (jsonb_typeof(media_diag) = 'object' and length(media_diag::text) <= 4000));
  end if;
end $$;
alter table public.call_participants enable row level security;
revoke all (media_diag) on public.call_participants from anon, authenticated;
grant select (media_diag), update (media_diag) on public.call_participants to service_role;
