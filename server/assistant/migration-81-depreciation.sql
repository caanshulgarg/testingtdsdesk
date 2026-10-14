-- Migration 81 (14-Oct-2026, fixed assets and depreciation; branch depreciation; approved by the owner on 14-Oct-2026).
-- Staging only until the owner says otherwise. Number 81: 80 is the tds-layout branch's.
--
-- What it adds: ONE read-only function, asst_dep_register(p_client, p_fy), for the Assistant's depreciation_schedule
-- (server/assistant/tools/depreciation.ts) and the reports' fs_build / tax_audit_draft. The register is worked out and kept
-- by the app (src/js/80-assets.js, FAR): one per financial year, with the client's books as items (key 'fixedAssets',
-- item '.<year from 1 April>', e.g. '.2025'), shared like every other part of the books (client_book_items, migration-12;
-- else the client_books blob). This function only reads the year asked for and the year before (whose closing is this
-- year's opening), so the Assistant's figures are the screen's figures.
--
-- SECURITY INVOKER and STABLE, as the other asst_* readers: it runs as the signed-in user under the tables' row-level
-- security (firm_id = my_firm()), so a member of another firm gets nothing, and it cannot write. No table, column or row
-- is added, changed or removed. ADD-ONLY; safe to run twice; one transaction (lock_timeout 10 s). Tested on pg_stand:
-- tests/run_dep_tool.py.

begin;
set local lock_timeout = '10s';

create or replace function public.asst_dep_register(p_client text, p_fy text)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare regs jsonb; py text;
begin
  if coalesce(p_fy, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('reg', null, 'prev', null, 'years', '[]'::jsonb);
  end if;
  py := (p_fy::integer - 1)::text;
  -- the registers as BookItems keeps them (one row per year, '.<year>'), else the blob of the books' work (BookSync)
  select jsonb_object_agg(substr(i.item, 2), i.data) into regs
    from client_book_items i
   where i.client_id = p_client and i.firm_id = my_firm() and i.key = 'fixedAssets' and i.item like '.%' and not i.deleted;
  if regs is null then
    select b.data->'fixedAssets' into regs from client_books b
     where b.client_id = p_client and b.firm_id = my_firm() and b.part = 'work' limit 1;
  end if;
  if regs is null or jsonb_typeof(regs) <> 'object' then regs := '{}'::jsonb; end if;
  return jsonb_build_object('reg', regs->p_fy, 'prev', regs->py,
    'years', coalesce((select jsonb_agg(k order by k desc) from jsonb_object_keys(regs) k), '[]'::jsonb));
end $$;

revoke all on function public.asst_dep_register(text, text) from public, anon;
grant execute on function public.asst_dep_register(text, text) to authenticated;

commit;
