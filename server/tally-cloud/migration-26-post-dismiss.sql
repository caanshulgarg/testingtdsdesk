-- The postings in FinCom's cloud, request of 02-Oct-2026: a failed posting stayed in the list for ever (the 07:20 one of
-- 02-Oct, although the same bill went in at 07:51). Adds and replaces only; nothing is dropped or deleted.
--   tally_post_jobs + entry_ids        the ids of the entries a posting carries (from its payload; for the list, which
--                                      does not read the payload itself)
--                   + dismissed_at, dismissed_by, dismiss_note, dismiss_auto
--                                      a failed or cancelled posting taken off the list; the row is kept
--   tally_post_dismiss(id, auto)       auto false: a person dismisses it (who and when are kept)
--                                      auto true: FinCom does, only when every entry of it was posted by a later posting
--                                      of the same client; the note says when ("Posted later at 07:51")
--   tally_post_undismiss(id)           back on the list
--   supabase_realtime + tally_post_jobs   the list changes on every open page at once

begin;

alter table public.tally_post_jobs add column if not exists entry_ids jsonb generated always as (coalesce(jsonb_path_query_array(payload, '$.vouchers[*].id'), '[]'::jsonb)) stored;
alter table public.tally_post_jobs add column if not exists dismissed_at timestamptz;
alter table public.tally_post_jobs add column if not exists dismissed_by uuid;
alter table public.tally_post_jobs add column if not exists dismiss_note text;
alter table public.tally_post_jobs add column if not exists dismiss_auto boolean not null default false;
grant select (entry_ids, dismissed_at, dismissed_by, dismiss_note, dismiss_auto) on public.tally_post_jobs to authenticated;

-- when each entry of a posting went in through a later posting of the same client (null when one has not)
create or replace function public.tally_post_later(p_id uuid)
returns timestamptz language sql stable security definer set search_path to 'public' as $function$
  with j as (select * from tally_post_jobs where id = p_id),
  ids as (select e #>> '{}' as id from j, jsonb_array_elements(j.entry_ids) e),
  got as (select ids.id,
            (select min(k.updated_at) from tally_post_jobs k, j, jsonb_array_elements(coalesce(k.results, '[]'::jsonb)) r
              where k.firm_id = j.firm_id and k.client_id = j.client_id and k.id <> j.id and k.created_at > j.created_at
                and r->>'id' = ids.id and (r->>'ok')::boolean) as at
            from ids)
  select case when (select count(*) from ids) > 0 and not exists (select 1 from got where at is null) then (select max(at) from got) end;
$function$;

create or replace function public.tally_post_dismiss(p_id uuid, p_auto boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm(); j record; later timestamptz;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_id and firm_id = f for update;
  if not found then raise exception 'no such posting in this firm'; end if;
  if j.status not in ('failed', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'Only a failed or cancelled posting can be dismissed.'); end if;
  if j.dismissed_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if coalesce(p_auto, false) then
    later := tally_post_later(p_id);
    if later is null then return jsonb_build_object('ok', false, 'error', 'Not every entry of this posting was posted later.'); end if;
    update tally_post_jobs set dismissed_at = now(), dismissed_by = null, dismiss_auto = true,
           dismiss_note = 'Posted later at ' || to_char(later at time zone 'Asia/Kolkata', 'HH24:MI') ||
                          case when (later at time zone 'Asia/Kolkata')::date <> (j.created_at at time zone 'Asia/Kolkata')::date
                               then ' on ' || to_char(later at time zone 'Asia/Kolkata', 'DD-Mon-YYYY') else '' end
     where id = p_id;
  else
    update tally_post_jobs set dismissed_at = now(), dismissed_by = auth.uid(), dismiss_auto = false, dismiss_note = 'Dismissed' where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.tally_post_undismiss(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm();
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  update tally_post_jobs set dismissed_at = null, dismissed_by = null, dismiss_note = null, dismiss_auto = false where id = p_id and firm_id = f;
  if not found then raise exception 'no such posting in this firm'; end if;
  return jsonb_build_object('ok', true);
end $function$;

-- a Retry of a dismissed posting brings it back on the list
create or replace function public.tally_post_jobs_undismiss_on_retry() returns trigger language plpgsql as $function$
begin
  if new.status = 'waiting' and old.status in ('failed', 'cancelled') then
    new.dismissed_at := null; new.dismissed_by := null; new.dismiss_note := null; new.dismiss_auto := false;
  end if;
  return new;
end $function$;
drop trigger if exists tally_post_jobs_undismiss_on_retry on public.tally_post_jobs;
create trigger tally_post_jobs_undismiss_on_retry before update of status on public.tally_post_jobs for each row execute function public.tally_post_jobs_undismiss_on_retry();

revoke all on function public.tally_post_later(uuid) from public, anon, authenticated;
revoke all on function public.tally_post_dismiss(uuid, boolean) from public, anon;
revoke all on function public.tally_post_undismiss(uuid) from public, anon;
grant execute on function public.tally_post_dismiss(uuid, boolean) to authenticated;
grant execute on function public.tally_post_undismiss(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tally_post_jobs') then
    alter publication supabase_realtime add table public.tally_post_jobs;
  end if;
end $$;

commit;
