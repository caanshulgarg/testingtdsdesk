-- LIVE: members fix (06-Oct-2026). For the owner to review and run on the live database himself. Minimal: one statement.
-- ADD-ONLY: nothing dropped, no row removed or changed, no statement here removes rows; the policy members_self is left
-- in place (with no UPDATE privilege it becomes inert); safe to run twice; one transaction (lock_timeout 10 s).
--
--   WHAT IT FIXES. The policy members_self (UPDATE to authenticated, using user_id = auth.uid(), with check user_id =
--   auth.uid() and firm_id = my_firm()) together with authenticated's UPDATE on every column of members lets any
--   signed-in member change their OWN row with one direct request (PATCH /rest/v1/members?user_id=eq.<self>): a staff or
--   look-only member can set role = 'owner' and take over the firm's people, billing and keys. The trigger audit_members
--   only logs it (a 'person.update' row in activity). No page writes members: people are invited, added, switched on or
--   off and given a role only through the edge function admin, which writes as the service role after checking that the
--   caller is an owner of the firm or a platform administrator. So signed-in users need no write on members at all.
--   (Staging: the same is part of migration-61-privileges.sql.)
--   After this, signed-in members still READ members as before (SELECT is not touched; members_read decides the rows).
--
--   CHECK BEFORE AND AFTER (read-only; run each before and after this file):
--     -- 1. authenticated's privileges on members (table and columns): after, of these four only SELECT is left
--     select p, has_table_privilege('authenticated', 'public.members', p) as on_table,
--            case when p <> 'DELETE' then (select string_agg(attname, ', ' order by attnum) from pg_attribute
--              where attrelid = 'public.members'::regclass and attnum > 0 and not attisdropped
--                and has_column_privilege('authenticated', 'public.members', attname, p)) end as columns
--       from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
--     -- 2. every change to a member the trail holds; 'self' = the person changed their own row (the server's changes
--     --    carry the owner's or no user id): any 'self' row with a role or active change is worth a look
--     select a.at, a.firm_id, a.user_id, a.detail,
--            (m.user_id is not null and lower(m.email) = lower(split_part(a.detail, ' ', 1))) as self
--       from public.activity a left join public.members m on m.user_id = a.user_id
--      where a.what = 'person.update' order by a.at desc;
--   Should a page be refused afterwards (none is expected): grant update on public.members to authenticated;
-- Tested by tests/run_live_members_fix.py (a throwaway PostgreSQL with Supabase's default grants; never a real database).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding members (a timeout rolls it back: run it again)

revoke insert, update, delete on table public.members from authenticated;

commit;
