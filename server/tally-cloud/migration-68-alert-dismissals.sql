-- Migration 68 (08-Oct-2026, FinCom "clear notifications"; the owner: "There should be option to clear notifications
-- everywhere.. in the bell of desktop even we dont have that option.. run it everywhere.. and have the clear option.. and
-- if one time any notification is cleared then that notification should not appear").
-- Runs after 60 (fresh database and staging: ... -> 59 -> 60 -> 68); it needs only members and my_firm() (migration.sql),
-- so it is independent of 61-67 and 69 (other branches) and may run before or after any of them.
-- ADD-ONLY: one new table, its index, its row security, its grants and three functions; nothing else touched; no statement
-- here removes rows (an Undo stamps undone_at, the row is kept); safe to run twice; one transaction (lock_timeout 10 s).
--
-- A notification (the bell, the slim lines on the pages: src/js/63-alerts.js, AlertHub / AlertClear) is identified by its
-- key and a fingerprint of what it says (the table of fingerprints is in 63-alerts.js). Clearing one hides it for that
-- person only, on every page and every device; it never changes the data it speaks of.
--
--   app_alert_dismissals  one row a notification a person cleared: (firm_id, user_id, alert_key, fingerprint, words,
--                         batch, cleared_at, undone_at). A person reads and adds only their own rows in their own firm
--                         (row security); nobody updates or removes them from the browser: an Undo is the RPC below,
--                         which stamps undone_at on the rows of that one Clear (its batch), and the row stays.
--   alert_dismiss(p_items jsonb)        [{key, fp, words}] (at most 500, key and fp at most 2000 characters, words 500):
--                         an active member of a firm adds the rows under one new batch; a notification already cleared
--                         (same key and fingerprint, not undone) is not added twice. Answers {ok, batch, n}.
--   alert_dismiss_undo(p_batch uuid)    the caller's own rows of that batch, not yet undone: undone_at = now().
--                         Answers {ok, n}.
--   alert_dismissals_list()             the caller's own rows in their firm not undone (newest first, 5000 at most):
--                         [{key, fp, batch, clearedAt}].
-- Every function: security definer, search_path = public, pg_temp; revoked from public and anon, granted to authenticated.
-- Tested by tests/run_migration68.py and tests/run_migration_order.py (68 in both orders).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

create table if not exists public.app_alert_dismissals (
  id bigserial primary key,
  firm_id uuid not null,
  user_id uuid not null,
  alert_key text not null,            -- the notification's key ("book:<client>|<book>", "pc:<computer>", "alert:<id>", ...)
  fingerprint text not null,          -- what it says that makes it this notification (one item a line; 63-alerts.js)
  words text not null default '',     -- the words shown when it was cleared (for the record only)
  batch uuid not null,                -- one Clear (one notification, or Clear all): what its Undo undoes
  cleared_at timestamptz not null default now(),
  undone_at timestamptz               -- Undo: the row is kept, stamped
);
create index if not exists app_alert_dismissals_mine on public.app_alert_dismissals (firm_id, user_id, cleared_at desc) where undone_at is null;
create index if not exists app_alert_dismissals_batch on public.app_alert_dismissals (batch);

alter table public.app_alert_dismissals enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_alert_dismissals' and policyname = 'app_alert_dismissals_read_own') then
    create policy app_alert_dismissals_read_own on public.app_alert_dismissals for select to authenticated
      using (user_id = auth.uid() and firm_id = public.my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_alert_dismissals' and policyname = 'app_alert_dismissals_add_own') then
    create policy app_alert_dismissals_add_own on public.app_alert_dismissals for insert to authenticated
      with check (user_id = auth.uid() and firm_id = public.my_firm() and undone_at is null);
  end if;
end $$;
revoke all on public.app_alert_dismissals from public, anon, authenticated;
grant select, insert on public.app_alert_dismissals to authenticated;
revoke all on sequence public.app_alert_dismissals_id_seq from public, anon, authenticated;
grant usage on sequence public.app_alert_dismissals_id_seq to authenticated;
grant all on public.app_alert_dismissals to service_role;
grant all on sequence public.app_alert_dismissals_id_seq to service_role;

create or replace function public.alert_dismiss(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); u uuid := auth.uid(); b uuid := gen_random_uuid(); n int := 0; it jsonb; k text; fp text;
begin
  if u is null or f is null or not exists (select 1 from members m where m.user_id = u and m.firm_id = f and coalesce(m.active, true)) then
    raise exception 'not a member of a firm' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items: a list of {key, fp, words}' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'at most 500 notifications at once' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    k := left(coalesce(it ->> 'key', ''), 2000); fp := left(coalesce(it ->> 'fp', ''), 2000);
    if k = '' or fp = '' then continue; end if;
    if exists (select 1 from app_alert_dismissals d where d.firm_id = f and d.user_id = u and d.alert_key = k and d.fingerprint = fp and d.undone_at is null) then continue; end if;
    insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, words, batch)
      values (f, u, k, fp, left(coalesce(it ->> 'words', ''), 500), b);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'batch', b, 'n', n);
end $function$;

create or replace function public.alert_dismiss_undo(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); u uuid := auth.uid(); n int;
begin
  if u is null or f is null then raise exception 'not a member of a firm' using errcode = '42501'; end if;
  update app_alert_dismissals set undone_at = now()
   where batch = p_batch and user_id = u and firm_id = f and undone_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'n', n);
end $function$;

create or replace function public.alert_dismissals_list()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(jsonb_agg(jsonb_build_object('key', x.alert_key, 'fp', x.fingerprint, 'batch', x.batch, 'clearedAt', x.cleared_at) order by x.cleared_at desc), '[]'::jsonb)
    from (select d.* from app_alert_dismissals d
           where d.user_id = auth.uid() and d.firm_id = my_firm() and d.undone_at is null
           order by d.cleared_at desc limit 5000) x
$function$;

revoke all on function public.alert_dismiss(jsonb), public.alert_dismiss_undo(uuid), public.alert_dismissals_list() from public, anon;
grant execute on function public.alert_dismiss(jsonb), public.alert_dismiss_undo(uuid), public.alert_dismissals_list() to authenticated;

commit;
