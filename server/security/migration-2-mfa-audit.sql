-- Security hardening 2: two-step sign-in (MFA) and an append-only audit trail.
-- Rule: a firm owner and the platform administrator must use a second step (an authenticator app code).
-- Anyone who has set one up must use it. Until then my_firm() returns nothing, so every table and
-- function scoped to the firm stays closed (fail closed). The members row stays readable, so the app
-- can see the role and ask for the code.

create or replace function public.mfa_required() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
      or exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'owner')
      or exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
$$;
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' or not public.mfa_required()
$$;
create or replace function public.mfa_status() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'required', public.mfa_required(),
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'ok', public.mfa_ok())
$$;

create or replace function public.my_firm() returns uuid
language sql stable security definer set search_path to 'public' as $$
  select firm_id from public.members where user_id = auth.uid() and active and public.mfa_ok()
$$;
create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

-- the members row: your own always (to see your role before the code), the firm's once past the code
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (user_id = auth.uid() or firm_id = public.my_firm() or public.is_superadmin());

revoke execute on function public.mfa_required(), public.mfa_ok(), public.mfa_status() from public, anon;
grant execute on function public.mfa_required(), public.mfa_ok(), public.mfa_status() to authenticated, service_role;

-- Audit trail: activity can only be added to, never changed or removed (not even by the service role),
-- and a row is always in the name of the person signed in.
alter table public.activity alter column user_id set default auth.uid();
alter table public.activity alter column at set default now();
drop policy if exists activity_write on public.activity;
create policy activity_write on public.activity for insert to authenticated
  with check (firm_id = public.my_firm() and user_id = auth.uid());
create or replace function public.activity_append_only() returns trigger language plpgsql as $$
begin raise exception 'the audit trail cannot be changed or removed'; end $$;
drop trigger if exists activity_append_only on public.activity;
create trigger activity_append_only before update or delete on public.activity
  for each row execute function public.activity_append_only();

-- the server records changes to people and money itself, so they are in the trail whoever makes them
create or replace function public.audit_members() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity (firm_id, user_id, client_id, what, detail, at)
  values (coalesce(new.firm_id, old.firm_id), auth.uid(), '', 'person.' || lower(tg_op),
          coalesce(new.email, old.email) || ' role ' || coalesce(old.role, '-') || '->' || coalesce(new.role, '-') ||
          ' active ' || coalesce(old.active::text, '-') || '->' || coalesce(new.active::text, '-'), now());
  return coalesce(new, old);
end $$;
drop trigger if exists audit_members on public.members;
create trigger audit_members after insert or update or delete on public.members
  for each row execute function public.audit_members();
create or replace function public.audit_wallet() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('credit', 'adjust', 'refund') then
    insert into public.activity (firm_id, user_id, client_id, what, detail, at)
    values (new.firm_id, auth.uid(), '', 'wallet.' || new.kind, new.amount::text || ' ' || coalesce(new.note, ''), now());
  end if;
  return new;
end $$;
drop trigger if exists audit_wallet on public.wallet_entries;
create trigger audit_wallet after insert on public.wallet_entries for each row execute function public.audit_wallet();
revoke execute on function public.audit_members(), public.audit_wallet(), public.activity_append_only() from public, anon, authenticated;

-- 28 Sep 2026 (migration security_3b): two-step sign-in made OPTIONAL for firm work, at the owner's request
-- (a second step on every sign-in was judged too heavy for firms). Anyone who turns it on must still use it.
-- Platform administration keeps needing it: is_superadmin() above still requires aal2.
create or replace function public.mfa_required() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
create or replace function public.mfa_status() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'required', public.mfa_required(),
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'admin', exists (select 1 from public.platform_admins a where a.user_id = auth.uid()),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'ok', public.mfa_ok())
$$;
