-- Migration 170 (12-Nov-2026, branch next-gst-share-engine; written, NOT run: the owner reads it and runs it). The GST
-- share sweep (migration 164, gst-run's share_sweep) notices a new engine. On staging, gst-run was deployed with a new
-- ENGINE (server/gst-run/engine.js and gst3b.js) and no book was picked: gst_share_books_due (167) takes a book only for
-- days written, entries due, an entry never worked out or no context, and the engine check that makes every entry due
-- again (the context made again, all) runs only inside share_sweep. The shares stayed on the old engine until something
-- else touched the book.
--   gst_share_engine        one row: the engine gst-run runs now (and its REV), written by gst-run
--                           (gst_share_engine_put) on every share_* call and on "share_engine", which does only that
--   gst_share_books_due(n)  as 167, and also a book whose context (calc_seen 'book'/'ctx', data->>'engine') was made by
--                           another engine than that row's (a primary-key lookup a book); still not one leased or
--                           backing off; at most n (3, never over 5). Nothing is due by engine until the row is written.
--   the timer: pg_cron job gst-share-engine every 10 minutes calls gst-run {action: "share_engine"} (gst-taxpro's key in
--                           Vault gst_cron_key, at Vault fincom_project_url, as 164's jobs), so a fresh deploy is
--                           noticed within 10 minutes even with no book due. Made only where pg_cron, pg_net and both
--                           Vault secrets are there; otherwise nothing is scheduled and this says so. The every-minute
--                           gst-share-sweep job is unchanged.
-- Add-only: one new table (RLS on, service role only), one new function, 167's function replaced (same signature, same
-- grants), one new job. Safe to run twice. Needs migration 164 (calc_seen); stops and says so otherwise.
-- Tested by tests/run_migration164.py (section 8, pg_stand) and tests/run_gst_share_deno.ts (gst-run's share_engine).
begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.calc_seen') is null or to_regprocedure('public.gst_share_books_due(integer)') is null then
    raise exception 'migration 170 needs migration 164 (calc_seen, gst_share_books_due) first';
  end if;
end $$;

create table if not exists public.gst_share_engine (
  one     boolean primary key default true check (one),
  engine  text not null,
  rev     text,
  at      timestamptz not null default now()
);
alter table public.gst_share_engine enable row level security;
revoke all on public.gst_share_engine from public, anon, authenticated;
grant select, insert, update, delete on public.gst_share_engine to service_role;

-- written only when it moved (the timer's calls cost a read of one row); true when it moved
create or replace function public.gst_share_engine_put(p_engine text, p_rev text default null)
returns boolean language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare n integer;
begin
  if coalesce(p_engine, '') = '' then return false; end if;
  insert into gst_share_engine (one, engine, rev, at) values (true, p_engine, p_rev, now())
  on conflict (one) do update set engine = excluded.engine, rev = excluded.rev, at = now()
   where gst_share_engine.engine is distinct from excluded.engine or gst_share_engine.rev is distinct from excluded.rev;
  get diagnostics n = row_count;
  return n > 0;
end;
$function$;

create or replace function public.gst_share_books_due(p_n integer default 3)
returns table (book_id uuid) language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select b.book_id from tally_books b
   cross join lateral (select min(d.changed_at) w from tally_calc_dirty d
                         left join calc_seen s on s.book_id = d.book_id and s.calc = 'gst-share' and s.kind = 'day' and s.key = d.day::text
                        where d.book_id = b.book_id and s.stamp is distinct from d.changed_at::text) dd
   where b.client_id is not null
     and (dd.w is not null
          or exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.due)
          or (not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'ctx')
              and exists (select 1 from tally_vouchers v where v.book_id = b.book_id))
          or exists (select 1 from tally_vouchers v where v.book_id = b.book_id
                      and not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid))
          -- 170: the context made by another engine than the one gst-run runs now
          or exists (select 1 from calc_seen s join gst_share_engine e on e.one
                      where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'ctx'
                        and s.data->>'engine' is distinct from e.engine))
     and not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book'
                      and s.key in ('lease', 'backoff:ctx') and (s.data->>'until')::timestamptz > clock_timestamp())
   order by dd.w nulls last, b.book_id
   limit greatest(1, least(coalesce(p_n, 3), 5));
$function$;

revoke all on function public.gst_share_engine_put(text, text) from public, anon, authenticated;
grant execute on function public.gst_share_engine_put(text, text) to service_role;
revoke all on function public.gst_share_books_due(integer) from public, anon, authenticated;
grant execute on function public.gst_share_books_due(integer) to service_role;

do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'migration 170: pg_cron, pg_net or Vault is not here: no gst-share-engine timer (gst-run writes its engine on every share_* call)';
  elsif not exists (select 1 from vault.decrypted_secrets where name = 'gst_cron_key') or not exists (select 1 from vault.decrypted_secrets where name = 'fincom_project_url') then
    raise notice 'migration 170: Vault has no gst_cron_key or fincom_project_url: no gst-share-engine timer';
  else
    -- every 10 minutes: gst-run says which engine it runs (a fresh deploy's books due within 10 minutes)
    perform cron.schedule('gst-share-engine', '*/10 * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/gst-run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
        body := jsonb_build_object('action', 'share_engine'))
    $job$);
  end if;
end $cron$;

commit;
