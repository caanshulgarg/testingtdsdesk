"""members_stand.py - the members table as staging has it, for run_migration61.py and run_live_members_fix.py (06-Oct-2026,
the owner's finding: members_self plus authenticated's UPDATE on every column lets a staff member make themselves the
firm's owner with one PATCH; audit_members only logs it).

On a pg_stand database (never a real one):
  HELPERS   auth.jwt() and auth.mfa_factors stood in for; mfa_required / mfa_ok / my_firm / is_superadmin as the repository
            has them (server/security/migration-2-mfa-audit.sql, with migration security_3b's mfa_required: a verified
            factor only). my_firm() = select firm_id from members where user_id = auth.uid() and active and mfa_ok(), the
            body the coordinator read on staging. can_write(): its staging body is not in the repository; the stand's
            (an active owner or staff member of my_firm()) is used, and members_self does not call it.
  MEMBERS   the seven columns (user_id, firm_id, name, email, role, active, created_at), row security, members_read
            (migration-2), members_self (staging: update to authenticated using user_id = auth.uid() with check
            user_id = auth.uid() and firm_id = my_firm()), audit_members (migration-2's body, after insert/update/delete).
  CASES     1a-1d, each tried in a transaction that is rolled back (nothing kept), as the signed-in member:
            a staff member makes themselves owner; an inactive member switches themselves on; a member moves themselves to
            another firm; a member changes their own email; their own user_id.
The result of a case: 'updated=N audit=M' (rows changed, person.update rows the trigger added) or the error."""
F2 = "88888888-8888-8888-8888-888888888888"
STAFF_A, INACTIVE = "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333"
OTHER_USER = "22222222-2222-2222-2222-222222222222"
HELPERS = r"""
create table if not exists auth.mfa_factors (user_id uuid, status text);
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('fincom.jwt', true), ''), '{}')::jsonb $$;
grant select on auth.mfa_factors to authenticated, service_role;
create or replace function public.mfa_required() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' or not public.mfa_required()
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
create or replace function public.can_write() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and firm_id = public.my_firm() and active and role in ('owner', 'staff'))
$$;
"""
MEMBERS = r"""
alter table public.members add column if not exists email text;
alter table public.members add column if not exists created_at timestamptz not null default now();
do $$ begin if not exists (select 1 from pg_constraint where conrelid = 'public.members'::regclass and contype = 'p') then alter table public.members add primary key (user_id); end if; end $$;
alter table public.members enable row level security;
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (user_id = auth.uid() or firm_id = public.my_firm() or public.is_superadmin());
create policy members_self on public.members for update to authenticated
  using (user_id = auth.uid()) with check ((user_id = auth.uid()) and (firm_id = public.my_firm()));
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
revoke execute on function public.audit_members() from public, anon, authenticated;
"""
def seed(q, F):
    return """insert into firms values (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members (user_id, firm_id, name, email, role, active) values (%(S)s, %(F)s, 'Sita', 's@b.in', 'staff', true), (%(I)s, %(F)s, 'Ishan', 'i@b.in', 'staff', false);""" \
        % {"F": q(F), "F2": q(F2), "S": q(STAFF_A), "I": q(INACTIVE)}
def cases(q, F):
    upd = lambda s: "with u as (%s returning 1) select 'updated=' || count(*) from u;" % s
    return [
        ("1a", STAFF_A, upd("update public.members set role = 'owner' where user_id = auth.uid()"), "a staff member sets their own role to owner"),
        ("1b", INACTIVE, upd("update public.members set active = true where user_id = auth.uid()"), "an inactive member switches themselves on (active = true)"),
        ("1c", STAFF_A, upd("update public.members set firm_id = %s where user_id = auth.uid()" % q(F2)), "a member moves themselves to another firm (firm_id)"),
        ("1d-email", STAFF_A, upd("update public.members set email = 'mine@evil.in' where user_id = auth.uid()"), "a member changes their own email"),
        ("1d-user_id", STAFF_A, upd("update public.members set user_id = %s where user_id = auth.uid()" % q(OTHER_USER)), "a member changes their own user_id"),
    ]
def attempt(psql, uid, sql):
    """one case as the signed-in member, in a transaction always rolled back"""
    r = psql("\\pset tuples_only on\n\\pset format unaligned\nbegin;\nset local role authenticated;\nset local fincom.uid = '%s';\n%s\nreset role;\n"
             "select 'audit=' || count(*) from public.activity where what = 'person.update';\nrollback;\n" % (uid, sql))
    if r.returncode: return (r.stderr.strip().splitlines() or ["?"])[-1].split("ERROR:")[-1].strip()
    return " ".join(r.stdout.split())
def run_cases(psql, q, F):
    return {k: (attempt(psql, uid, sql), w) for k, uid, sql, w in cases(q, F)}
# before the fix, on staging's policy (the results the stand shows; see run_migration61.py for what is asserted)
def refused(res): return "permission denied for table members" in res
def rls_refused(res): return "violates row-level security policy" in res
