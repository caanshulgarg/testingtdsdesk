-- Review item 23, second wall (owner's OK needed before it runs; staging tds-desk-staging first).
-- drop_keys, support_tickets and support_messages have row level security on and no policies, so the app's users
-- already get no rows (server/security/TABLES-WITHOUT-POLICIES.md). They still *hold* the rights to select, insert,
-- update and delete, so a policy added by mistake later would open them at once. This takes those rights away from
-- the app's users. Nothing is deleted; the tables, their rows and their functions are unchanged.
--
-- Who still reaches them, unchanged:
--   * the SECURITY DEFINER functions (create_drop_key, my_drop_keys, revoke_drop_key, refresh_inbox_link,
--     post_inbox, support_new, support_list, support_get, support_reply, support_set, support_can, support_row):
--     they run as their owner (postgres), not as the caller, so they need no rights of the caller's;
--   * the service role (edge functions), which keeps its own grants;
--   * gst_sessions already grants nothing to anon or authenticated and is not touched.
--
-- To undo (only if something needed these rights after all):
--   grant select, insert, update, delete on public.drop_keys, public.support_tickets, public.support_messages to anon, authenticated;

begin;

revoke all on table public.drop_keys        from public, anon, authenticated;
revoke all on table public.support_tickets  from public, anon, authenticated;
revoke all on table public.support_messages from public, anon, authenticated;

-- check inside the same transaction: no rights left for the app's users, the service role keeps its own
do $$
declare t text; bad text := '';
begin
  foreach t in array array['drop_keys', 'support_tickets', 'support_messages'] loop
    if has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')
       or has_table_privilege('authenticated', 'public.' || t, 'select,insert,update,delete') then bad := bad || t || ' still granted; '; end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') then bad := bad || t || ' lost service_role; '; end if;
  end loop;
  if bad <> '' then raise exception 'Stopped, nothing changed: %', bad; end if;
end $$;

commit;
