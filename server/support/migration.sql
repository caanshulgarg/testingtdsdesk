-- TDS Desk help desk: tickets raised by firms, answered by TDS Desk support (platform admins).
-- Tables are closed to direct access (RLS on, no policies); everything goes through the functions below,
-- which check who is asking: a firm sees only its own tickets and never support's internal notes.
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  num bigint generated always as identity,
  firm_id uuid not null references public.firms(id) on delete cascade,
  created_by uuid not null,
  created_name text not null default '',
  created_email text not null default '',
  subject text not null check (length(subject) between 3 and 200),
  module text not null default 'Other',
  category text not null default 'question' check (category in ('question','problem','request','data','billing')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'new' check (status in ('new','open','waiting','resolved','closed')),
  assignee text not null default '',
  context jsonb not null default '{}'::jsonb,
  respond_by timestamptz not null,
  resolve_by timestamptz not null,
  first_response_at timestamptz,
  resolved_at timestamptz,
  last_by text not null default 'firm' check (last_by in ('firm','support')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author uuid not null,
  author_name text not null default '',
  from_support boolean not null default false,
  internal boolean not null default false,
  body text not null default '',
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_tickets_firm on public.support_tickets(firm_id, updated_at desc);
create index if not exists support_messages_ticket on public.support_messages(ticket_id, id);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

-- response and resolution targets by priority (hours)
create or replace function public.support_sla(p_priority text, p_from timestamptz, p_kind text)
returns timestamptz language sql immutable as $$
  select p_from + make_interval(hours => case p_kind
    when 'respond' then case p_priority when 'urgent' then 2 when 'high' then 4 when 'medium' then 8 else 24 end
    else case p_priority when 'urgent' then 8 when 'high' then 24 when 'medium' then 72 else 120 end end)
$$;

create or replace function public.support_can(p_ticket uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_superadmin() or exists (select 1 from public.support_tickets t where t.id = p_ticket and t.firm_id = public.my_firm())
$$;

create or replace function public.support_row(t public.support_tickets)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(t) || jsonb_build_object(
    'code', 'T-' || t.num,
    'firm_name', (select f.name from public.firms f where f.id = t.firm_id),
    'messages', (select count(*) from public.support_messages m where m.ticket_id = t.id and (not m.internal or public.is_superadmin())),
    'last_at', (select max(m.created_at) from public.support_messages m where m.ticket_id = t.id and (not m.internal or public.is_superadmin()))
  )
$$;

create or replace function public.support_new(p_subject text, p_module text, p_category text, p_priority text, p_body text, p_context jsonb, p_files jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f uuid := public.my_firm(); m record; t public.support_tickets;
begin
  if f is null then raise exception 'Sign in with a firm account to raise a ticket.'; end if;
  select name, email into m from public.members where user_id = auth.uid() and active limit 1;
  if length(coalesce(trim(p_subject), '')) < 3 then raise exception 'Give the ticket a subject.'; end if;
  if length(coalesce(trim(p_body), '')) < 5 then raise exception 'Describe the problem or question.'; end if;
  insert into public.support_tickets (firm_id, created_by, created_name, created_email, subject, module, category, priority, context, respond_by, resolve_by)
  values (f, auth.uid(), coalesce(m.name, ''), coalesce(m.email, ''), trim(p_subject), coalesce(nullif(p_module, ''), 'Other'),
          coalesce(nullif(p_category, ''), 'question'), coalesce(nullif(p_priority, ''), 'medium'), coalesce(p_context, '{}'::jsonb),
          public.support_sla(coalesce(nullif(p_priority, ''), 'medium'), now(), 'respond'), public.support_sla(coalesce(nullif(p_priority, ''), 'medium'), now(), 'resolve'))
  returning * into t;
  insert into public.support_messages (ticket_id, author, author_name, body, files) values (t.id, auth.uid(), coalesce(m.name, m.email, ''), trim(p_body), coalesce(p_files, '[]'::jsonb));
  return public.support_row(t);
end $$;

create or replace function public.support_reply(p_ticket uuid, p_body text, p_files jsonb, p_internal boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sa boolean := public.is_superadmin(); t public.support_tickets; who text;
begin
  if not public.support_can(p_ticket) then raise exception 'Not your ticket.'; end if;
  if length(coalesce(trim(p_body), '')) < 1 and jsonb_array_length(coalesce(p_files, '[]'::jsonb)) = 0 then raise exception 'Write a reply or add a file.'; end if;
  select coalesce((select name from public.platform_admins where user_id = auth.uid()), (select name from public.members where user_id = auth.uid() limit 1), '') into who;
  insert into public.support_messages (ticket_id, author, author_name, from_support, internal, body, files)
  values (p_ticket, auth.uid(), coalesce(who, ''), sa, sa and coalesce(p_internal, false), coalesce(trim(p_body), ''), coalesce(p_files, '[]'::jsonb));
  if sa and not coalesce(p_internal, false) then
    update public.support_tickets set first_response_at = coalesce(first_response_at, now()),
      status = case when status in ('new','open') then 'waiting' else status end, last_by = 'support', updated_at = now()
    where id = p_ticket returning * into t;
  elsif sa then
    update public.support_tickets set updated_at = now() where id = p_ticket returning * into t;
  else
    -- the firm wrote: back to support, and a resolved or closed ticket opens again
    update public.support_tickets set status = case when status = 'new' then 'new' else 'open' end, resolved_at = null, last_by = 'firm', updated_at = now()
    where id = p_ticket returning * into t;
  end if;
  return public.support_row(t);
end $$;

-- support may set everything; a firm may only mark its ticket resolved or open it again
create or replace function public.support_set(p_ticket uuid, p_status text, p_priority text, p_assignee text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sa boolean := public.is_superadmin(); t public.support_tickets;
begin
  if not public.support_can(p_ticket) then raise exception 'Not your ticket.'; end if;
  if not sa and (p_priority is not null or p_assignee is not null or coalesce(p_status, 'resolved') not in ('resolved', 'open')) then
    raise exception 'Only TDS Desk support can change that.';
  end if;
  select * into t from public.support_tickets where id = p_ticket;
  update public.support_tickets set
    status = coalesce(p_status, status),
    resolved_at = case when coalesce(p_status, status) in ('resolved','closed') then coalesce(resolved_at, now()) else null end,
    priority = coalesce(p_priority, priority),
    respond_by = case when p_priority is not null and p_priority <> t.priority then public.support_sla(p_priority, t.created_at, 'respond') else respond_by end,
    resolve_by = case when p_priority is not null and p_priority <> t.priority then public.support_sla(p_priority, t.created_at, 'resolve') else resolve_by end,
    assignee = coalesce(p_assignee, assignee),
    updated_at = now()
  where id = p_ticket returning * into t;
  return public.support_row(t);
end $$;

-- a firm's own tickets; for support, every firm's
create or replace function public.support_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.support_row(t) order by t.updated_at desc), '[]'::jsonb)
  from public.support_tickets t
  where public.is_superadmin() or t.firm_id = public.my_firm()
$$;

create or replace function public.support_get(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.support_tickets;
begin
  if not public.support_can(p_ticket) then raise exception 'Not your ticket.'; end if;
  select * into t from public.support_tickets where id = p_ticket;
  return public.support_row(t) || jsonb_build_object('thread', (
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) from public.support_messages m
    where m.ticket_id = p_ticket and (not m.internal or public.is_superadmin())));
end $$;

revoke all on function public.support_new(text,text,text,text,text,jsonb,jsonb), public.support_reply(uuid,text,jsonb,boolean),
  public.support_set(uuid,text,text,text), public.support_list(), public.support_get(uuid), public.support_row(public.support_tickets),
  public.support_can(uuid) from public, anon;
grant execute on function public.support_new(text,text,text,text,text,jsonb,jsonb), public.support_reply(uuid,text,jsonb,boolean),
  public.support_set(uuid,text,text,text), public.support_list(), public.support_get(uuid) to authenticated;

-- files on tickets: kept under the firm's folder; support can read and add to any firm's
insert into storage.buckets (id, name, public, file_size_limit) values ('support-files', 'support-files', false, 10485760)
on conflict (id) do nothing;
drop policy if exists "support files: read" on storage.objects;
drop policy if exists "support files: add" on storage.objects;
create policy "support files: read" on storage.objects for select to authenticated
  using (bucket_id = 'support-files' and ((storage.foldername(name))[1] = public.my_firm()::text or public.is_superadmin()));
create policy "support files: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'support-files' and ((storage.foldername(name))[1] = public.my_firm()::text or public.is_superadmin()));
-- ticket numbers start at T-1001
alter table public.support_tickets alter column num restart with 1001;
