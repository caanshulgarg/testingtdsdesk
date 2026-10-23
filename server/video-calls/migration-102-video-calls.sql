-- migration-102-video-calls (23-Oct-2026, branch next-video-calls; the owner's approval of 23-Oct-2026: "Yes, start
-- building… I don't want initial costing"). NOT run on staging yet: the coordinator runs it.
-- Calls inside FinCom, stage 1 (rooms, chat, screen share, recording, transcript, summary), "Work together" (option A)
-- and the remote-help log of stage 2 (option B, RustDesk), in one file so the owner runs one migration:
--   call_batches, call_batch_members   a minimal Academy batch (a name and its members' emails), for "Start class"
--   call_rooms           one room a call; its channel key is never readable by a member (the function hands out the
--                        channel's name to people it has let in; the key's epoch moves on when someone is removed)
--   call_participants    who came, as a member (user_id) or a guest (name, email, verified by a code); waiting, admitted,
--                        left, removed, denied; a guest's one-time code kept as a hash only
--   call_invites         guest links: only the sha256 of the link's token is kept
--   call_messages        the chat, kept; a file in the private bucket call-files (20 MB at most)
--   call_recordings      the host's recording (pieces in the private bucket call-recordings, <firm>/<room>/...); kept for
--                        90 days for a client's call and a year for a class (or the client's setting), then marked deleted
--                        (never removed here: the owner purges on request)
--   call_pieces          each person's own microphone, in pieces of at most 55 s, with the words heard (the transcript)
--   call_transcripts     the transcript in order and the summary, decisions and action items
--   call_consents        the recording notice shown to, and accepted by, each person
--   call_client_settings per client: recording allowed (off unless the owner turns it on) and the days kept
--   call_remote_sessions remote help (RustDesk): who, which client, start, end and the host's reason
-- Members read their firm's rows (a class's recordings and transcripts only the batch's members and the owner); every
-- write goes through the fincom-call function (service role) or the two owner functions below; guests never touch the
-- database except through that function and its signed tokens.
-- Add-only: new tables, functions, policies, grants (explicit: from 30-Oct-2026 Supabase gives none by default), two
-- private buckets and a daily timer where Storage and pg_cron are there. One transaction, lock_timeout 10 s, safe twice.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- Academy batches (minimal)
create table if not exists public.call_batches (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id),
  name        text not null check (length(btrim(name)) between 2 and 120),
  retention_days int not null default 365 check (retention_days between 7 and 3650),
  archived    boolean not null default false,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists call_batches_firm on public.call_batches (firm_id);
create table if not exists public.call_batch_members (
  batch_id    uuid not null references public.call_batches(id),
  firm_id     uuid not null references public.firms(id),
  email       text not null check (email = lower(email) and email ~* '^[^@\s,;<>]+@[^@\s,;<>]+\.[a-z]{2,}$' and length(email) <= 200),
  name        text not null default '' check (length(name) <= 120),
  added_by    uuid,
  added_at    timestamptz not null default now(),
  primary key (batch_id, email)
);

-- ---------------------------------------------------------------- rooms and people
create table if not exists public.call_rooms (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id),
  kind         text not null check (kind in ('client', 'meeting', 'class', 'help')),
  client_id    text check (client_id is null or length(client_id) between 1 and 120),
  batch_id     uuid references public.call_batches(id),
  title        text not null default '' check (length(title) <= 200),
  status       text not null default 'open' check (status in ('scheduled', 'open', 'ended')),
  scheduled_at timestamptz,
  minutes      int check (minutes is null or minutes between 5 and 600),
  invitees     jsonb not null default '[]'::jsonb check (jsonb_typeof(invitees) = 'array' and jsonb_array_length(invitees) <= 50),
  media_mode   text not null default 'p2p' check (media_mode in ('p2p', 'sfu')),
  chan_key     text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  chan_epoch   int not null default 1,
  cowork_on    boolean not null default false,
  cowork_at    timestamptz,
  cowork_epoch int not null default 1,
  host_user    uuid,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  ended_at     timestamptz,
  check (kind <> 'class' or batch_id is not null),
  check (kind <> 'client' or client_id is not null)
);
create index if not exists call_rooms_firm on public.call_rooms (firm_id, created_at desc);
create index if not exists call_rooms_client on public.call_rooms (firm_id, client_id) where client_id is not null;
create index if not exists call_rooms_batch on public.call_rooms (batch_id) where batch_id is not null;

create table if not exists public.call_participants (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.call_rooms(id),
  firm_id      uuid not null references public.firms(id),
  user_id      uuid,
  name         text not null default '' check (length(name) <= 120),
  email        text not null default '' check (length(email) <= 200),
  role         text not null check (role in ('host', 'member', 'guest')),
  state        text not null default 'waiting' check (state in ('waiting', 'admitted', 'left', 'removed', 'denied')),
  verified     boolean not null default false,
  otp_hash     text,
  otp_until    timestamptz,
  otp_tries    int not null default 0,
  invite_id    uuid,
  cf_session   text,
  joined_at    timestamptz not null default now(),
  admitted_at  timestamptz,
  left_at      timestamptz,
  check (role = 'guest' or user_id is not null)
);
create index if not exists call_participants_room on public.call_participants (room_id, state);
create unique index if not exists call_participants_member_once on public.call_participants (room_id, user_id) where user_id is not null;

create table if not exists public.call_invites (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.call_rooms(id),
  firm_id     uuid not null references public.firms(id),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email       text not null default '' check (length(email) <= 200),
  uses        int not null default 0,
  max_uses    int not null default 10 check (max_uses between 1 and 50),
  expires_at  timestamptz not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists call_invites_room on public.call_invites (room_id);

-- ---------------------------------------------------------------- chat, recordings, transcript, consent
create table if not exists public.call_messages (
  id           bigserial primary key,
  room_id      uuid not null references public.call_rooms(id),
  firm_id      uuid not null references public.firms(id),
  participant_id uuid references public.call_participants(id),
  author       text not null default '' check (length(author) <= 120),
  body         text not null default '' check (length(body) <= 4000),
  file         jsonb check (file is null or (jsonb_typeof(file) = 'object' and coalesce((file->>'size')::bigint, 0) <= 20971520)),
  at           timestamptz not null default now(),
  check (length(body) > 0 or file is not null)
);
create index if not exists call_messages_room on public.call_messages (room_id, id);

create table if not exists public.call_recordings (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.call_rooms(id),
  firm_id      uuid not null references public.firms(id),
  batch_id     uuid references public.call_batches(id),
  started_by   uuid,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  prefix       text not null,
  mime         text not null default 'video/webm' check (length(mime) <= 80),
  chunks       int not null default 0,
  bytes        bigint not null default 0,
  retain_until date not null,
  deleted_at   timestamptz,
  deleted_by   uuid,
  deleted_why  text not null default '' check (length(deleted_why) <= 200)
);
create index if not exists call_recordings_room on public.call_recordings (room_id);
create index if not exists call_recordings_due on public.call_recordings (retain_until) where deleted_at is null;

create table if not exists public.call_pieces (
  id           bigserial primary key,
  room_id      uuid not null references public.call_rooms(id),
  firm_id      uuid not null references public.firms(id),
  participant_id uuid not null references public.call_participants(id),
  seq          int not null check (seq between 0 and 100000),
  start_ms     bigint not null check (start_ms >= 0),
  dur_ms       int not null check (dur_ms between 1 and 60000),
  path         text not null,
  mime         text not null default 'audio/webm',
  status       text not null default 'new' check (status in ('new', 'done', 'failed')),
  tries        int not null default 0,
  text         text not null default '' check (length(text) <= 20000),
  at           timestamptz not null default now(),
  unique (participant_id, seq)
);
create index if not exists call_pieces_room on public.call_pieces (room_id, status, start_ms);

create table if not exists public.call_transcripts (
  room_id      uuid primary key references public.call_rooms(id),
  firm_id      uuid not null references public.firms(id),
  batch_id     uuid references public.call_batches(id),
  lines        jsonb not null default '[]'::jsonb,
  summary      jsonb,
  pieces_done  int not null default 0,
  pieces_all   int not null default 0,
  tasks_added  jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

create table if not exists public.call_consents (
  id           bigserial primary key,
  room_id      uuid not null references public.call_rooms(id),
  firm_id      uuid not null references public.firms(id),
  participant_id uuid not null references public.call_participants(id),
  recording_id uuid references public.call_recordings(id),
  event        text not null check (event in ('shown', 'accepted', 'left')),
  at           timestamptz not null default now()
);
create index if not exists call_consents_room on public.call_consents (room_id, at);

create table if not exists public.call_client_settings (
  firm_id         uuid not null references public.firms(id),
  client_id       text not null check (length(client_id) between 1 and 120),
  allow_recording boolean not null default false,
  retention_days  int not null default 90 check (retention_days between 7 and 3650),
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  primary key (firm_id, client_id)
);

-- stage 2 (option B): remote help through RustDesk; FinCom keeps only this log (never an ID's password)
create table if not exists public.call_remote_sessions (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid references public.call_rooms(id),
  firm_id      uuid not null references public.firms(id),
  client_id    text,
  host_user    uuid not null,
  peer_name    text not null default '' check (length(peer_name) <= 120),
  reason       text not null check (length(btrim(reason)) between 3 and 300),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists call_remote_firm on public.call_remote_sessions (firm_id, started_at desc);

-- ---------------------------------------------------------------- who sees a class's work
-- the firm's owner, or a member whose sign-in email is on the batch
create or replace function public.call_batch_visible(p_batch uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_batch is null
      or exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'owner'
                   and m.firm_id = (select b.firm_id from public.call_batches b where b.id = p_batch))
      or exists (select 1 from public.call_batch_members bm join public.members m on m.firm_id = bm.firm_id and m.user_id = auth.uid() and m.active
                  where bm.batch_id = p_batch
                    and bm.email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', '')))
$$;

-- the same for a room (read without row-level security, so a room the reader cannot see is never taken as "no batch")
create or replace function public.call_room_visible(p_room uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select public.call_batch_visible(r.batch_id) from public.call_rooms r where r.id = p_room), false)
$$;

-- the owner: a client's recording setting
create or replace function public.call_client_setting_set(p_client text, p_allow boolean, p_days int) returns public.call_client_settings
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := public.my_firm(); r public.call_client_settings;
begin
  if f is null or not exists (select 1 from public.members where user_id = auth.uid() and firm_id = f and active and role = 'owner') then
    raise exception 'Only the firm''s owner can change a client''s recording setting' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client and c.firm_id = f and not coalesce(c.deleted, false)) then
    raise exception 'This client is not one of your firm''s' using errcode = '42501';
  end if;
  insert into public.call_client_settings (firm_id, client_id, allow_recording, retention_days, updated_by, updated_at)
  values (f, p_client, coalesce(p_allow, false), coalesce(p_days, 90), auth.uid(), now())
  on conflict (firm_id, client_id) do update set allow_recording = excluded.allow_recording, retention_days = excluded.retention_days,
    updated_by = excluded.updated_by, updated_at = now()
  returning * into r;
  return r;
end $$;

-- the owner: a recording marked deleted (kept in storage until the owner asks for a purge)
create or replace function public.call_recording_delete(p_id uuid, p_why text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := public.my_firm();
begin
  if f is null or not exists (select 1 from public.members where user_id = auth.uid() and firm_id = f and active and role = 'owner') then
    raise exception 'Only the firm''s owner can delete a recording' using errcode = '42501';
  end if;
  update public.call_recordings set deleted_at = now(), deleted_by = auth.uid(), deleted_why = left(coalesce(p_why, ''), 200)
   where id = p_id and firm_id = f and deleted_at is null;
  return found;
end $$;

-- the timer: recordings past their days marked deleted (soft; nothing removed from storage)
create or replace function public.call_retention_sweep() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.call_recordings set deleted_at = now(), deleted_why = 'kept for its days' where deleted_at is null and retain_until < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- row-level security
alter table public.call_batches enable row level security;
alter table public.call_batch_members enable row level security;
alter table public.call_rooms enable row level security;
alter table public.call_participants enable row level security;
alter table public.call_invites enable row level security;
alter table public.call_messages enable row level security;
alter table public.call_recordings enable row level security;
alter table public.call_pieces enable row level security;
alter table public.call_transcripts enable row level security;
alter table public.call_consents enable row level security;
alter table public.call_client_settings enable row level security;
alter table public.call_remote_sessions enable row level security;

drop policy if exists call_batches_read on public.call_batches;
create policy call_batches_read on public.call_batches for select to authenticated using (firm_id = (select public.my_firm()));
drop policy if exists call_batch_members_read on public.call_batch_members;
create policy call_batch_members_read on public.call_batch_members for select to authenticated using (firm_id = (select public.my_firm()));
drop policy if exists call_rooms_read on public.call_rooms;
create policy call_rooms_read on public.call_rooms for select to authenticated using (firm_id = (select public.my_firm()) and public.call_batch_visible(batch_id));
drop policy if exists call_participants_read on public.call_participants;
create policy call_participants_read on public.call_participants for select to authenticated using (firm_id = (select public.my_firm()));
drop policy if exists call_messages_read on public.call_messages;
create policy call_messages_read on public.call_messages for select to authenticated using (firm_id = (select public.my_firm())
  and public.call_room_visible(room_id));
drop policy if exists call_recordings_read on public.call_recordings;
create policy call_recordings_read on public.call_recordings for select to authenticated using (firm_id = (select public.my_firm()) and deleted_at is null and public.call_batch_visible(batch_id));
drop policy if exists call_pieces_read on public.call_pieces;
create policy call_pieces_read on public.call_pieces for select to authenticated using (firm_id = (select public.my_firm())
  and public.call_room_visible(room_id));
drop policy if exists call_transcripts_read on public.call_transcripts;
create policy call_transcripts_read on public.call_transcripts for select to authenticated using (firm_id = (select public.my_firm()) and public.call_batch_visible(batch_id));
drop policy if exists call_consents_read on public.call_consents;
create policy call_consents_read on public.call_consents for select to authenticated using (firm_id = (select public.my_firm()));
drop policy if exists call_client_settings_read on public.call_client_settings;
create policy call_client_settings_read on public.call_client_settings for select to authenticated using (firm_id = (select public.my_firm()));
drop policy if exists call_remote_read on public.call_remote_sessions;
create policy call_remote_read on public.call_remote_sessions for select to authenticated using (firm_id = (select public.my_firm()));
-- call_invites: no policy (the function only)

-- ---------------------------------------------------------------- grants (explicit, ROUND 101)
revoke all on public.call_batches, public.call_batch_members, public.call_rooms, public.call_participants, public.call_invites, public.call_messages,
  public.call_recordings, public.call_pieces, public.call_transcripts, public.call_consents, public.call_client_settings, public.call_remote_sessions
  from public, anon, authenticated;
grant select on public.call_batches, public.call_batch_members, public.call_messages, public.call_recordings, public.call_transcripts,
  public.call_consents, public.call_client_settings, public.call_remote_sessions to authenticated;
-- a room without its channel key; a person without their code's hash or the Cloudflare session
grant select (id, firm_id, kind, client_id, batch_id, title, status, scheduled_at, minutes, invitees, media_mode, cowork_on, cowork_at, host_user,
  created_by, created_at, started_at, ended_at) on public.call_rooms to authenticated;
grant select (id, room_id, firm_id, user_id, name, role, state, verified, joined_at, admitted_at, left_at) on public.call_participants to authenticated;
grant select (id, room_id, firm_id, participant_id, seq, start_ms, dur_ms, status, text, at) on public.call_pieces to authenticated;
grant select, insert, update, delete on public.call_batches, public.call_batch_members, public.call_rooms, public.call_participants, public.call_invites,
  public.call_messages, public.call_recordings, public.call_pieces, public.call_transcripts, public.call_consents, public.call_client_settings,
  public.call_remote_sessions to service_role;
revoke all on sequence public.call_messages_id_seq, public.call_pieces_id_seq, public.call_consents_id_seq from public, anon, authenticated;
grant usage, select on sequence public.call_messages_id_seq, public.call_pieces_id_seq, public.call_consents_id_seq to service_role;

revoke all on function public.call_batch_visible(uuid), public.call_room_visible(uuid) from public, anon;
grant execute on function public.call_batch_visible(uuid), public.call_room_visible(uuid) to authenticated, service_role;
revoke all on function public.call_client_setting_set(text, boolean, int), public.call_recording_delete(uuid, text) from public, anon;
grant execute on function public.call_client_setting_set(text, boolean, int), public.call_recording_delete(uuid, text) to authenticated, service_role;
revoke all on function public.call_retention_sweep() from public, anon, authenticated;
grant execute on function public.call_retention_sweep() to service_role;

-- ---------------------------------------------------------------- the buckets (where Storage is) and the timer (where pg_cron is)
-- files are written only through the function's signed upload addresses; a member reads the firm's folder, a class's
-- folder (<firm>/class/<batch>/...) only the batch and the owner
do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit) values ('call-recordings', 'call-recordings', false, 52428800) on conflict (id) do nothing;
    insert into storage.buckets (id, name, public, file_size_limit) values ('call-files', 'call-files', false, 20971520) on conflict (id) do nothing;
    execute 'drop policy if exists call_files_read on storage.objects';
    execute $p$create policy call_files_read on storage.objects for select to authenticated
      using (bucket_id in ('call-recordings', 'call-files') and (storage.foldername(name))[1] = (select public.my_firm())::text
        and ((storage.foldername(name))[2] is distinct from 'class'
             or public.call_batch_visible(case when (storage.foldername(name))[3] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[3])::uuid end)))$p$;
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('call-retention', '17 21 * * *', 'select public.call_retention_sweep()');
  end if;
end $do$;

commit;
