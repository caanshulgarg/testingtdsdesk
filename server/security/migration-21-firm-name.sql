-- The firm's name, 02-Oct-2026: firms.name is the one source. The app showed the firm record's own name ("GSC", or empty
-- in a backup) and asked for it again and again although firms.name was "Garg Shekhar& Company".
--   firm_name_set(name)    an owner sets the firm's name in firms.name (members cannot write the firms table)
--   firms_guard            firms.name can never be set to empty, by anyone
-- Adds only; nothing is dropped or deleted.

begin;

create or replace function public.firm_name_set(p_name text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm(); n text := left(btrim(coalesce(p_name, '')), 120);
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can change its name' using errcode = '42501'; end if;
  if n = '' then raise exception 'the firm''s name is needed'; end if;
  update firms set name = n where id = f;
  return jsonb_build_object('ok', true, 'name', n);
end $function$;
revoke all on function public.firm_name_set(text) from public, anon;
grant execute on function public.firm_name_set(text) to authenticated;

create or replace function public.firms_guard() returns trigger language plpgsql as $function$
begin
  if coalesce(btrim(new.name), '') = '' and coalesce(btrim(old.name), '') <> '' then new.name := old.name; end if;
  return new;
end $function$;
drop trigger if exists firms_guard on public.firms;
create trigger firms_guard before update on public.firms for each row execute function public.firms_guard();

commit;
