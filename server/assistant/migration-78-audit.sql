-- Migration 78 (13-Oct-2026, FinCom Assistant step 2: audit the books; branch assistant-audit). Staging only until the
-- owner says otherwise. Number 78 as docs/assistant-tools.md gives it (77 is the Assistant's, 76 db-speed's).
--
-- What it adds: ONE read-only function, asst_audit_wp(p_client, p_period), for the Assistant's audit_run and audit_check
-- (server/assistant/tools/audit.ts). The audit is worked out by FinCom's own code in the browser (src/js/77-audit.js,
-- AuditWP.run: the TDS, GST, 26AS and MIS rules live there and are not written again in SQL); each run is kept with the
-- client's books as items (key 'auditWp': "run|<from>-<to>" with every figure, "wp|<from>-<to>|<check>" with the
-- reviewer's status and remark), shared like every other part of the books (client_book_items, migration-12; else the
-- client_books blob). This function only reads those items back, so the Assistant's figures are the screen's figures.
--
-- SECURITY INVOKER and STABLE: it runs as the signed-in user under the tables' row-level security (firm_id = my_firm()),
-- so a member of another firm gets nothing, and it cannot write. No table, column or row is added, changed or removed.
-- ADD-ONLY; safe to run twice; one transaction (lock_timeout 10 s). Tested on pg_stand: tests/run_audit_wp_tool.py.

begin;
set local lock_timeout = '10s';

create or replace function public.asst_audit_wp(p_client text, p_period text)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare its jsonb;
begin
  -- the items as BookItems keeps them (one row per item, '#<id>'), else the blob of the books' work (BookSync)
  select coalesce(jsonb_agg(i.data order by i.ord nulls last, i.item), '[]'::jsonb) into its
    from client_book_items i
   where i.client_id = p_client and i.firm_id = my_firm() and i.key = 'auditWp' and i.item like '#%' and not i.deleted;
  if jsonb_array_length(its) = 0 then
    select coalesce(b.data->'auditWp', '[]'::jsonb) into its from client_books b
     where b.client_id = p_client and b.firm_id = my_firm() and b.part = 'work' limit 1;
  end if;
  its := coalesce(its, '[]'::jsonb);
  return jsonb_build_object(
    'run', (select x from jsonb_array_elements(its) x where x->>'id' = 'run|' || coalesce(p_period, '') limit 1),
    'wp', coalesce((select jsonb_agg(x order by x->>'check') from jsonb_array_elements(its) x where x->>'kind' = 'wp' and x->>'period' = coalesce(p_period, '')), '[]'::jsonb),
    -- the periods run, latest first: the tool picks the latest when the user names none
    'periods', coalesce((select jsonb_agg(jsonb_build_object('period', x->>'period', 'at', x->>'at') order by x->>'at' desc) from jsonb_array_elements(its) x where x->>'kind' = 'run'), '[]'::jsonb));
end $$;

revoke all on function public.asst_audit_wp(text, text) from public, anon;
grant execute on function public.asst_audit_wp(text, text) to authenticated;

commit;
