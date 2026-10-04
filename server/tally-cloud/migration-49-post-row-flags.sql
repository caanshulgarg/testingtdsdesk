-- migration-49-post-row-flags (04-Oct-2026, the owner's spec for the Post to Tally page, item J): Hide and Remove of the
-- rows on the Posted and Errors tabs. ADD-ONLY: one new table, three new functions; nothing existing is changed or
-- dropped, and nothing is ever removed from a table (a flag is ended by stamping restored_at).
--
--   tally_post_row_flags   one row a flag. row_key = the posting's id and the entry's id ("<job uuid>:<entry id>", or
--                          "local:<entry id>" for a bill posted straight to a bridge). kind 'hide' (for its user only) or
--                          'remove' (for everyone in the firm, soft: the "Removed" view shows who and when, with Restore).
--                          A flag in force has restored_at null; at most one in force per (firm, row, kind, user) for
--                          'hide' and per (firm, row, kind) for 'remove'.
--   RLS                    a member reads the firm's 'remove' flags and their own 'hide' flags; no one writes directly.
--   tally_post_row_hide(p_keys text[], p_on boolean)   hide (p_on true) or show again (false) rows, for the caller only.
--   tally_post_row_remove(p_keys text[], p_why text)   remove rows for everyone: any member for one row, an owner for more.
--                                                      A row whose posting is still going on (waiting, taken, running or
--                                                      checking) is refused: removing never cancels a posting.
--   tally_post_row_restore(p_keys text[])              restore removed rows: any member for one row, an owner for more.
-- The three functions only read tally_post_jobs (the firm check, the live check); they never write tally_post_jobs,
-- tally_post_ids or tally_post_marks: a removed Posted row keeps its posted mark and its FinCom id, so the same bill can
-- never be posted again because its row was removed (tally_post_enqueue still refuses it).
-- security definer, search_path = public, pg_temp; revoked from public and anon, granted to authenticated.
begin;
set local lock_timeout = '10s';

create table if not exists public.tally_post_row_flags (
  id           bigint generated always as identity primary key,
  firm_id      uuid not null references public.firms(id),
  row_key      text not null check (length(row_key) between 3 and 200),
  kind         text not null check (kind in ('hide', 'remove')),
  user_id      uuid not null,
  at           timestamptz not null default now(),
  why          text,
  restored_at  timestamptz,
  restored_by  uuid
);
create unique index if not exists tally_post_row_flags_hide_once on public.tally_post_row_flags (firm_id, row_key, user_id) where kind = 'hide' and restored_at is null;
create unique index if not exists tally_post_row_flags_remove_once on public.tally_post_row_flags (firm_id, row_key) where kind = 'remove' and restored_at is null;
create index if not exists tally_post_row_flags_firm on public.tally_post_row_flags (firm_id, restored_at);

alter table public.tally_post_row_flags enable row level security;
-- made once (add-only: nothing is dropped, so a second run leaves it as it is)
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_row_flags' and policyname = 'tally_post_row_flags_read') then
    create policy tally_post_row_flags_read on public.tally_post_row_flags for select to authenticated
      using (firm_id = my_firm() and (kind = 'remove' or user_id = auth.uid()));
  end if;
end $do$;
revoke all on public.tally_post_row_flags from public, anon;
revoke insert, update, delete, truncate on public.tally_post_row_flags from authenticated;
grant select on public.tally_post_row_flags to authenticated;

-- the keys asked for, checked: a firm member, at most 500 keys, each "<a posting of this firm>:<entry id>" or
-- "local:<entry id>"; returns the distinct keys
create or replace function public.tally_post_row_keys(p_keys text[])
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); k text; j text; e text; out text[] := '{}';
begin
  if f is null or auth.uid() is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and coalesce(m.active, true))
    then raise exception 'only a member of the firm can do this' using errcode = '42501'; end if;
  if p_keys is null or cardinality(p_keys) = 0 then raise exception 'which rows? none given'; end if;
  if cardinality(p_keys) > 500 then raise exception 'at most 500 rows at a time'; end if;
  foreach k in array p_keys loop
    k := btrim(coalesce(k, ''));
    if k !~ '^[A-Za-z0-9-]+:[A-Za-z0-9_.:/-]{1,120}$' then raise exception 'not a row of this list: %', left(k, 80); end if;
    j := split_part(k, ':', 1); e := substr(k, length(j) + 2);
    if j <> 'local' then
      if j !~ '^[0-9a-fA-F-]{36}$' or not exists (select 1 from tally_post_jobs t where t.id = j::uuid and t.firm_id = f)
        then raise exception 'not a posting of your firm: %', left(k, 80); end if;
    end if;
    if not (k = any(out)) then out := out || k; end if;
  end loop;
  return out;
end $function$;
revoke all on function public.tally_post_row_keys(text[]) from public, anon, authenticated;

create or replace function public.tally_post_row_hide(p_keys text[], p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); ks text[]; k text; n int := 0; c int;
begin
  ks := tally_post_row_keys(p_keys);
  foreach k in array ks loop
    if coalesce(p_on, true) then
      insert into tally_post_row_flags (firm_id, row_key, kind, user_id) values (f, k, 'hide', auth.uid())
        on conflict (firm_id, row_key, user_id) where kind = 'hide' and restored_at is null do nothing;
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
declare f uuid := my_firm(); ks text[]; k text; j text; n int := 0; c int; why text := nullif(left(btrim(coalesce(p_why, '')), 300), '');
begin
  ks := tally_post_row_keys(p_keys);
  if cardinality(ks) > 1 and not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can remove more than one row at a time' using errcode = '42501'; end if;
  -- removing never cancels a posting: a row whose posting is still going on is refused, and nothing is removed
  foreach k in array ks loop
    j := split_part(k, ':', 1);
    if j <> 'local' and exists (select 1 from tally_post_jobs t where t.id = j::uuid and t.firm_id = f and (t.status in ('waiting', 'taken', 'running') or coalesce(t.checking, false)))
      then raise exception 'this row cannot be removed: its posting is still going on (%)', left(k, 80); end if;
  end loop;
  foreach k in array ks loop
    insert into tally_post_row_flags (firm_id, row_key, kind, user_id, why) values (f, k, 'remove', auth.uid(), why)
      on conflict (firm_id, row_key) where kind = 'remove' and restored_at is null do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $function$;
revoke all on function public.tally_post_row_remove(text[], text) from public, anon;
grant execute on function public.tally_post_row_remove(text[], text) to authenticated;

create or replace function public.tally_post_row_restore(p_keys text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); ks text[]; n int;
begin
  ks := tally_post_row_keys(p_keys);
  if cardinality(ks) > 1 and not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can restore more than one row at a time' using errcode = '42501'; end if;
  update tally_post_row_flags set restored_at = now(), restored_by = auth.uid()
   where firm_id = f and row_key = any(ks) and kind = 'remove' and restored_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'n', n);
end $function$;
revoke all on function public.tally_post_row_restore(text[]) from public, anon;
grant execute on function public.tally_post_row_restore(text[]) to authenticated;

commit;
