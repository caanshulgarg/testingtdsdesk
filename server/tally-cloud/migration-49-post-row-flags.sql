-- migration-49-post-row-flags (04-Oct-2026, the owner's spec for the Post to Tally page, item J): Hide and Remove of the
-- rows on the Posted and Errors tabs. ADD-ONLY: one new table, five new functions; nothing existing is changed or
-- dropped, and nothing is ever removed from a table (a flag is ended by stamping restored_at, and taken up again by
-- clearing it: one row a flag, however often it is hidden and shown, removed and restored).
--
--   tally_post_row_flags   one row a flag. row_key = the posting's id and the entry's id ("<job uuid>:<entry id>", or
--                          "local:<entry id>" for a bill posted straight to a bridge). kind 'hide' (for its user only) or
--                          'remove' (for everyone in the firm, soft: the "Removed" view shows who and when, with Restore).
--                          One row per (firm, row, user) for 'hide' and per (firm, row) for 'remove'; in force while
--                          restored_at is null. A removal keeps the posting's attempts and status at that moment
--                          (job_attempts, job_status): a removal is VOID once the posting is going on again (waiting,
--                          taken, running, checking) or was started again since (Retry: its attempts changed); the row
--                          is then listed where its state puts it (tally_post_row_flags_now, and the app the same way).
--   RLS                    a member reads the firm's 'remove' flags and their own 'hide' flags; no one writes directly.
--   tally_post_row_hide(p_keys text[], p_on boolean)   hide (p_on true) or show again (false) rows, for the caller only.
--   tally_post_row_remove(p_keys text[], p_why text)   remove rows for everyone: any member for one row, an owner for more.
--                                                      A row whose posting is still going on (waiting, taken, running or
--                                                      checking) is refused: removing never cancels a posting. The
--                                                      postings are locked (for share) while this is checked and written,
--                                                      so a Retry cannot slip in between.
--   tally_post_row_restore(p_keys text[])              restore removed rows: an owner any; another member only the rows
--                                                      they removed themselves (one at a time).
--   tally_post_row_flags_now()                         the caller's flags in force, each with void (above).
-- Keys: a job key names a posting of the caller's firm (a strict uuid) AND an entry of that posting (its payload,
-- results, items or entry ids). A "local:" key (a bill posted straight to a bridge, no posting in the cloud) cannot be
-- checked here: its id must be 1 to 64 letters, digits, _ or -, at most 50 of them in one call; the app keeps such a row
-- from being removed while the bill is being posted.
-- The functions only read tally_post_jobs (the firm, entry and live checks); they never write tally_post_jobs,
-- tally_post_ids or tally_post_marks: a removed Posted row keeps its posted mark and its FinCom id, so the same bill can
-- never be posted again because its row was removed (tally_post_enqueue still refuses it).
-- security definer, search_path = public, pg_temp; revoked from public and anon, granted to authenticated (the key check
-- to nobody, service_role included).
begin;
set local lock_timeout = '10s';

create table if not exists public.tally_post_row_flags (
  id            bigint generated always as identity primary key,
  firm_id       uuid not null references public.firms(id),
  row_key       text not null check (length(row_key) between 3 and 200),
  kind          text not null check (kind in ('hide', 'remove')),
  user_id       uuid not null,
  at            timestamptz not null default now(),
  why           text,
  restored_at   timestamptz,
  restored_by   uuid,
  job_attempts  integer,
  job_status    text
);
create unique index if not exists tally_post_row_flags_hide_one on public.tally_post_row_flags (firm_id, row_key, user_id) where kind = 'hide';
create unique index if not exists tally_post_row_flags_remove_one on public.tally_post_row_flags (firm_id, row_key) where kind = 'remove';
create index if not exists tally_post_row_flags_firm on public.tally_post_row_flags (firm_id, restored_at);

alter table public.tally_post_row_flags enable row level security;
-- made once (add-only: nothing is dropped, so a second run leaves it as it is)
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_row_flags' and policyname = 'tally_post_row_flags_read') then
    create policy tally_post_row_flags_read on public.tally_post_row_flags for select to authenticated
      using (firm_id = my_firm() and (kind = 'remove' or user_id = auth.uid()));
  end if;
end $do$;
revoke all on public.tally_post_row_flags from public, anon, authenticated;
grant select on public.tally_post_row_flags to authenticated;

-- the keys asked for, checked: a firm member, at most 500 keys, each "<a posting of this firm>:<an entry of it>" or
-- "local:<id>" (at most 50 of those); returns the distinct keys
create or replace function public.tally_post_row_keys(p_keys text[])
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); k text; j text; e text; out text[] := '{}'; nlocal int := 0; t record;
begin
  if f is null or auth.uid() is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and coalesce(m.active, true))
    then raise exception 'only a member of the firm can do this' using errcode = '42501'; end if;
  if p_keys is null or cardinality(p_keys) = 0 then raise exception 'which rows? none given'; end if;
  if cardinality(p_keys) > 500 then raise exception 'at most 500 rows at a time'; end if;
  foreach k in array p_keys loop
    k := btrim(coalesce(k, ''));
    if k ~ '^local:' then
      if k !~ '^local:[A-Za-z0-9_-]{1,64}$' then raise exception 'not a row of this list: %', left(k, 80); end if;
      if not (k = any(out)) then nlocal := nlocal + 1; end if;
      if nlocal > 50 then raise exception 'at most 50 rows of bills posted straight to a bridge at a time'; end if;
    else
      if k !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}:[A-Za-z0-9_.:/-]{1,120}$' then raise exception 'not a row of this list: %', left(k, 80); end if;
      j := split_part(k, ':', 1); e := substr(k, length(j) + 2);
      select x.payload, x.results, x.items, to_jsonb(x)->'entry_ids' as entry_ids into t from tally_post_jobs x where x.id = j::uuid and x.firm_id = f;
      if not found then raise exception 'not a posting of your firm: %', left(k, 80); end if;
      if not (exists (select 1 from jsonb_array_elements(case when jsonb_typeof(t.payload->'vouchers') = 'array' then t.payload->'vouchers' else '[]'::jsonb end) v where v->>'id' = e)
           or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(t.results) = 'array' then t.results else '[]'::jsonb end) v where v->>'id' = e)
           or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(t.items) = 'array' then t.items else '[]'::jsonb end) v where v->>'id' = e)
           or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(t.entry_ids) = 'array' then t.entry_ids else '[]'::jsonb end) v where v = e))
        then raise exception 'not an entry of that posting: %', left(k, 80); end if;
    end if;
    if not (k = any(out)) then out := out || k; end if;
  end loop;
  return out;
end $function$;
revoke all on function public.tally_post_row_keys(text[]) from public, anon, authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'revoke all on function public.tally_post_row_keys(text[]) from service_role'; end if;
end $do$;

create or replace function public.tally_post_row_hide(p_keys text[], p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); ks text[]; k text; n int := 0; c int;
begin
  ks := tally_post_row_keys(p_keys);
  foreach k in array ks loop
    if coalesce(p_on, true) then
      insert into tally_post_row_flags (firm_id, row_key, kind, user_id) values (f, k, 'hide', auth.uid())
        on conflict (firm_id, row_key, user_id) where kind = 'hide'
        do update set at = now(), restored_at = null, restored_by = null where tally_post_row_flags.restored_at is not null;
    else
      update tally_post_row_flags set restored_at = now(), restored_by = auth.uid()
       where firm_id = f and row_key = k and kind = 'hide' and user_id = auth.uid() and restored_at is null;
    end if;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return jsonb_build_object('ok', true, 'n', n, 'hidden', coalesce(p_on, true));
end $function$;
revoke all on function public.tally_post_row_hide(text[], boolean) from public, anon;
grant execute on function public.tally_post_row_hide(text[], boolean) to authenticated;

create or replace function public.tally_post_row_remove(p_keys text[], p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); ks text[]; k text; j text; n int := 0; c int; why text := nullif(left(btrim(coalesce(p_why, '')), 300), ''); ja int; js text;
begin
  ks := tally_post_row_keys(p_keys);
  if cardinality(ks) > 1 and not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can remove more than one row at a time' using errcode = '42501'; end if;
  -- the postings named, locked against a Retry until this call ends (a Retry updates the row: it waits for us)
  perform 1 from tally_post_jobs x where x.firm_id = f
     and x.id in (select split_part(q, ':', 1)::uuid from unnest(ks) q where q !~ '^local:') order by x.id for share;
  -- removing never cancels a posting: a row whose posting is still going on is refused, and nothing is removed
  foreach k in array ks loop
    j := split_part(k, ':', 1);
    if j <> 'local' and exists (select 1 from tally_post_jobs x where x.id = j::uuid and x.firm_id = f and (x.status in ('waiting', 'taken', 'running') or coalesce(x.checking, false)))
      then raise exception 'this row cannot be removed: its posting is still going on (%)', left(k, 80); end if;
  end loop;
  foreach k in array ks loop
    j := split_part(k, ':', 1); ja := null; js := null;
    if j <> 'local' then select x.status, coalesce(x.attempts, 0) into js, ja from tally_post_jobs x where x.id = j::uuid and x.firm_id = f; end if;
    insert into tally_post_row_flags (firm_id, row_key, kind, user_id, why, job_attempts, job_status)
      values (f, k, 'remove', auth.uid(), why, ja, js)
      on conflict (firm_id, row_key) where kind = 'remove'
      do update set user_id = excluded.user_id, at = now(), why = excluded.why, restored_at = null, restored_by = null,
                    job_attempts = excluded.job_attempts, job_status = excluded.job_status
         -- taken up again when restored, or when the removal went void (the posting started again since)
         where tally_post_row_flags.restored_at is not null or tally_post_row_flags.job_attempts is distinct from excluded.job_attempts;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $function$;
revoke all on function public.tally_post_row_remove(text[], text) from public, anon;
grant execute on function public.tally_post_row_remove(text[], text) to authenticated;

create or replace function public.tally_post_row_restore(p_keys text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); ks text[]; n int; own boolean;
begin
  ks := tally_post_row_keys(p_keys);
  own := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true));
  if cardinality(ks) > 1 and not own
    then raise exception 'only an owner of the firm can restore more than one row at a time' using errcode = '42501'; end if;
  -- another member restores only a removal they made themselves
  if not own and exists (select 1 from tally_post_row_flags x where x.firm_id = f and x.row_key = any(ks) and x.kind = 'remove' and x.restored_at is null and x.user_id <> auth.uid())
    then raise exception 'only an owner, or the member who removed it, can restore this row' using errcode = '42501'; end if;
  update tally_post_row_flags set restored_at = now(), restored_by = auth.uid()
   where firm_id = f and row_key = any(ks) and kind = 'remove' and restored_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'n', n);
end $function$;
revoke all on function public.tally_post_row_restore(text[]) from public, anon;
grant execute on function public.tally_post_row_restore(text[]) to authenticated;

-- the caller's flags in force (the firm's removals, their own hides), each with void: a removal whose posting is going on
-- again, or was started again since it was removed (attempts changed)
create or replace function public.tally_post_row_flags_now()
returns table (row_key text, kind text, user_id uuid, at timestamptz, why text, job_attempts integer, void boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm();
begin
  if f is null or auth.uid() is null then raise exception 'only a member of the firm can do this' using errcode = '42501'; end if;
  return query
  select r.row_key, r.kind, r.user_id, r.at, r.why, r.job_attempts,
         (r.kind = 'remove' and x.id is not null and (x.status in ('waiting', 'taken', 'running') or coalesce(x.checking, false)
           or coalesce(x.attempts, 0) is distinct from r.job_attempts)) as void
    from tally_post_row_flags r
    left join tally_post_jobs x on r.row_key !~ '^local:' and x.firm_id = f and x.id::text = split_part(r.row_key, ':', 1)
   where r.firm_id = f and r.restored_at is null and (r.kind = 'remove' or r.user_id = auth.uid());
end $function$;
revoke all on function public.tally_post_row_flags_now() from public, anon;
grant execute on function public.tally_post_row_flags_now() to authenticated;

commit;
