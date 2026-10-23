-- migration-103-call-codes (23-Oct-2026, branch next-calls-meet; the owner: "a proper system like Meet/Zoom, invite by
-- email or by a code"; live translated subtitles approved the same day). NOT run on staging yet: the owner runs it in the
-- SQL editor, after migration-102-video-calls.
--   call_rooms.code      every room's meeting code, like Google Meet's: abc-defg-hij (ten lowercase letters without i, l
--                        or o), unique; the rooms already there are given one here. Members read it (one more column in
--                        their column grant); the one join link is <FinCom's page>#/join/<code>
--   call_code_tries      wrong meeting codes and requests to join, counted per address (kept as a hash) and per room in a
--                        time window, so a code cannot be guessed by trying (the function only)
--   call_code_hit()      one more try counted, atomically: true while within the limit (the service role only)
--   call_captions        live subtitles, kept only while the call is recorded and the speaker has stayed after the notice
--                        (the existing transcript rule): the words as said, the language found, the translations made
--   call_pieces.lang     the language Whisper found in a transcript piece
-- Add-only: one column with its check and unique index, one column on call_pieces, two tables, one function, policies
-- and explicit grants. One transaction, lock_timeout 10 s, safe to run twice.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- the meeting code
alter table public.call_rooms add column if not exists code text;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'call_rooms_code_form' and conrelid = 'public.call_rooms'::regclass) then
    alter table public.call_rooms add constraint call_rooms_code_form check (code is null or code ~ '^[a-hjkmnp-z]{3}-[a-hjkmnp-z]{4}-[a-hjkmnp-z]{3}$');
  end if;
end $do$;
create unique index if not exists call_rooms_code on public.call_rooms (code);

-- a new code: ten letters from 23, each from a byte of a random uuid (gen_random_uuid is the server's strong random)
create or replace function public.call_new_code() returns text language plpgsql volatile set search_path = public, pg_temp as $$
declare a constant text := 'abcdefghjkmnpqrstuvwxyz'; b bytea := uuid_send(gen_random_uuid()); s text := ''; i int;
begin
  for i in 0..9 loop s := s || substr(a, 1 + (get_byte(b, i) % 23), 1); end loop;
  return substr(s, 1, 3) || '-' || substr(s, 4, 4) || '-' || substr(s, 8, 3);
end $$;

-- the rooms there already: one code each (a clash, very unlikely, tries again)
do $do$
declare r record; n int;
begin
  for r in select id from public.call_rooms where code is null loop
    n := 0;
    loop
      begin
        update public.call_rooms set code = public.call_new_code() where id = r.id and code is null;
        exit;
      exception when unique_violation then
        n := n + 1;
        if n > 5 then raise; end if;
      end;
    end loop;
  end loop;
end $do$;

-- ---------------------------------------------------------------- tries counted (codes guessed, requests to join)
create table if not exists public.call_code_tries (
  key         text not null check (length(key) between 3 and 120),
  win         bigint not null,
  n           int not null default 0,
  at          timestamptz not null default now(),
  primary key (key, win)
);
create index if not exists call_code_tries_at on public.call_code_tries (at);

-- p_add more tries (1; 0 only looks) for a key in the window of p_secs seconds it falls in: true while at most p_max
create or replace function public.call_code_hit(p_key text, p_secs int, p_max int, p_add int default 1) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare w bigint := floor(extract(epoch from now()) / greatest(coalesce(p_secs, 900), 60)); c int; a int := greatest(least(coalesce(p_add, 1), 1), 0);
begin
  insert into public.call_code_tries (key, win, n) values (left(p_key, 120), w, a)
  on conflict (key, win) do update set n = public.call_code_tries.n + a, at = now()
  returning n into c;
  return c <= greatest(coalesce(p_max, 10), 1) - (case when a = 0 then 1 else 0 end);
end $$;

-- ---------------------------------------------------------------- live subtitles kept with a recorded call
create table if not exists public.call_captions (
  id             bigserial primary key,
  room_id        uuid not null references public.call_rooms(id),
  firm_id        uuid not null references public.firms(id),
  batch_id       uuid references public.call_batches(id),
  participant_id uuid not null references public.call_participants(id),
  who            text not null default '' check (length(who) <= 120),
  start_ms       bigint not null check (start_ms >= 0),
  text           text not null check (length(text) between 1 and 2000),
  lang           text not null default '' check (length(lang) <= 12),
  tr             jsonb not null default '{}'::jsonb check (jsonb_typeof(tr) = 'object'),
  at             timestamptz not null default now()
);
create index if not exists call_captions_room on public.call_captions (room_id, start_ms);
alter table public.call_pieces add column if not exists lang text check (lang is null or length(lang) <= 12);

-- ---------------------------------------------------------------- row-level security and grants (explicit)
alter table public.call_code_tries enable row level security;
alter table public.call_captions enable row level security;
-- call_code_tries: no policy (the function only)
drop policy if exists call_captions_read on public.call_captions;
create policy call_captions_read on public.call_captions for select to authenticated using (firm_id = (select public.my_firm()) and public.call_batch_visible(batch_id));

revoke all on public.call_code_tries, public.call_captions from public, anon, authenticated;
grant select on public.call_captions to authenticated;
grant select, insert, update, delete on public.call_code_tries, public.call_captions to service_role;
revoke all on sequence public.call_captions_id_seq from public, anon, authenticated;
grant usage, select on sequence public.call_captions_id_seq to service_role;
-- a member reads a room's code (the room's other columns as migration 102 granted them; never its channel key)
grant select (code) on public.call_rooms to authenticated;
grant select (lang) on public.call_pieces to authenticated;

revoke all on function public.call_new_code() from public, anon, authenticated;
grant execute on function public.call_new_code() to service_role;
revoke all on function public.call_code_hit(text, int, int, int) from public, anon, authenticated;
grant execute on function public.call_code_hit(text, int, int, int) to service_role;

commit;
