-- Removals kept on the server (request of 02-Oct-2026): what is removed from a client (the books read from Tally, Tally
-- data and all GST work, a bank statement with its rows) is kept here with who removed it, when and why, and can be put
-- back from any computer of the firm. The browser keeps its own copy as an extra.
--   client_trash                  one row per removal; never deleted. Restoring sets restored_at / restored_by.
--   trash_put(client, kind, label, reason, data)   keeps a removal for the caller's firm (owners and staff); returns its id
--   trash_restore(id)             marks it restored and returns what was kept
-- Adds only: nothing is dropped, deleted or changed in other tables.

begin;

create table if not exists public.client_trash (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id),
  client_id   text not null,
  kind        text not null,
  label       text not null default '',
  reason      text not null default '',
  data        jsonb,
  deleted_at  timestamptz not null default now(),
  deleted_by  uuid default auth.uid(),
  deleted_by_email text,
  restored_at timestamptz,
  restored_by uuid,
  restored_by_email text
);
create index if not exists client_trash_client on public.client_trash (firm_id, client_id, deleted_at desc);

alter table public.client_trash enable row level security;
drop policy if exists client_trash_read on public.client_trash;
create policy client_trash_read on public.client_trash for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
-- read through the policy above; written only through the two functions below; nobody may delete
revoke all on public.client_trash from anon, authenticated;
grant select on public.client_trash to authenticated;

create or replace function public.trash_put(p_client text, p_kind text, p_label text, p_reason text, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm(); new_id uuid;
begin
  if f is null or not can_write() then raise exception 'not allowed to remove for this firm' using errcode = '42501'; end if;
  if coalesce(p_client, '') = '' or coalesce(p_kind, '') = '' or length(p_kind) > 40 then raise exception 'client and kind are needed'; end if;
  insert into public.client_trash (firm_id, client_id, kind, label, reason, data, deleted_by, deleted_by_email)
  values (f, p_client, p_kind, left(coalesce(p_label, ''), 300), left(coalesce(p_reason, ''), 500), p_data, auth.uid(), auth.jwt() ->> 'email')
  returning id into new_id;
  return new_id;
end $function$;

create or replace function public.trash_restore(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm(); r public.client_trash%rowtype;
begin
  if f is null or not can_write() then raise exception 'not allowed to restore for this firm' using errcode = '42501'; end if;
  select * into r from public.client_trash where id = p_id and firm_id = f for update;
  if not found then raise exception 'nothing kept with that id'; end if;
  if r.restored_at is not null then raise exception 'already restored on %', to_char(r.restored_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'); end if;
  update public.client_trash set restored_at = now(), restored_by = auth.uid(), restored_by_email = auth.jwt() ->> 'email' where id = p_id;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'label', r.label, 'data', r.data);
end $function$;

revoke execute on function public.trash_put(text, text, text, text, jsonb) from public, anon;
revoke execute on function public.trash_restore(uuid) from public, anon;
grant execute on function public.trash_put(text, text, text, text, jsonb) to authenticated;
grant execute on function public.trash_restore(uuid) to authenticated;

commit;
