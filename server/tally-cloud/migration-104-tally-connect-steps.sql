-- migration 104: tally_connect_steps (next-tally-firstlink). RUN ON STAGING 24-Oct-2026 (the owner's OK; read back: RLS on,
-- one policy, anon nothing, authenticated select only, execute on tally_connect_step for authenticated only).
-- Add-only, safe twice. Each state the first-time "Connect this computer" panel reaches (app/src/parts/TallyFirstLink.jsx
-- logStep: waiting / found / other_user / old_bridge / wrong_code / code_ran_out / paired / link_failed / linked), once per
-- change, so the owner sees where a first Tally connection stops: pairing a browser with FinCom Bridge happens only on the
-- person's computer and left no trace in the cloud before. Never the code or a key. Needs my_firm() and members.
-- Deploy order: this, then the app build (until it runs, the app's calls are refused and ignored).
create table if not exists public.tally_connect_steps (
  id bigserial primary key,
  firm_id uuid not null,
  user_id uuid not null default auth.uid(),
  at timestamptz not null default now(),
  step text not null check (step in ('waiting','found','other_user','old_bridge','wrong_code','code_ran_out','paired','link_failed','linked')),
  bridge_version text check (bridge_version is null or bridge_version ~ '^\d+\.\d+\.\d+$'),
  detail text check (detail is null or length(detail) <= 300)
);
create index if not exists tally_connect_steps_firm_at on public.tally_connect_steps (firm_id, at desc);
alter table public.tally_connect_steps enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tally_connect_steps' and policyname = 'tally_connect_steps_read') then
    create policy tally_connect_steps_read on public.tally_connect_steps for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke all on public.tally_connect_steps from anon, authenticated;
grant select on public.tally_connect_steps to authenticated;
grant usage, select on sequence public.tally_connect_steps_id_seq to service_role;
grant all on public.tally_connect_steps to service_role;

-- the only way in: one row for the caller's own firm; at most 60 rows a member an hour
create or replace function public.tally_connect_step(p_step text, p_version text default null, p_detail text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := my_firm();
begin
  if f is null or auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if (select count(*) from tally_connect_steps where user_id = auth.uid() and at > now() - interval '1 hour') >= 60 then return; end if;
  insert into tally_connect_steps (firm_id, step, bridge_version, detail) values (f, p_step, nullif(p_version, ''), left(nullif(p_detail, ''), 300));
end $$;
revoke all on function public.tally_connect_step(text, text, text) from public, anon;
grant execute on function public.tally_connect_step(text, text, text) to authenticated;
