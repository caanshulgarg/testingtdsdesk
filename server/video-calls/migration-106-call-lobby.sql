-- migration-106-call-lobby (25-Oct-2026, branch next-calls-lobby; the owner: a guest's "ask to join" must reach the host
-- wherever FinCom is open). NOT run on staging yet: the owner runs it in the SQL editor, after migration 103. The
-- fincom-call function works without it (it asks once whether these columns are there and falls back to what it did).
--   call_participants.seen_at    when the person's browser last said it is there (a guest's waiting poll and beat, a
--                                member's people list); a waiting or admitted row not heard from for 60 s is marked
--                                left by the function (the 17:04 "admitted" row that was never closed)
--   call_participants.left_why   'stale' when the function marked it left for being quiet (it comes back by itself on
--                                that person's next request: a phone's page paused in the background); null otherwise
--   call_watch                   one row a person: when FinCom (open anywhere) last asked who is waiting; the host is
--                                "online" within 90 s, else the firm's owner and staff are asked too (the function only)
-- Add-only: two columns with checks, one partial index, one table with row-level security and no policy, explicit
-- grants (from 30-Oct-2026 Supabase gives none by default). One transaction, lock_timeout 10 s, safe to run twice.
begin;
set local lock_timeout = '10s';

alter table public.call_participants add column if not exists seen_at timestamptz;
alter table public.call_participants add column if not exists left_why text;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'call_participants_left_why' and conrelid = 'public.call_participants'::regclass) then
    alter table public.call_participants add constraint call_participants_left_why check (left_why is null or left_why in ('stale'));
  end if;
end $do$;
-- who is waiting in a firm (the lobby's one read)
create index if not exists call_participants_waiting on public.call_participants (firm_id, joined_at desc) where state = 'waiting';

create table if not exists public.call_watch (
  user_id     uuid primary key,
  firm_id     uuid not null references public.firms(id),
  seen_at     timestamptz not null default now()
);
create index if not exists call_watch_firm on public.call_watch (firm_id, seen_at desc);

alter table public.call_watch enable row level security;
-- call_watch: no policy (the function only)

revoke all on public.call_watch from public, anon, authenticated;
grant select, insert, update, delete on public.call_watch to service_role;
-- a member reads when someone in the firm's calls was last heard from (the other columns as migrations 102/103 granted)
grant select (seen_at, left_why) on public.call_participants to authenticated;
grant select, insert, update on public.call_participants to service_role;

commit;
