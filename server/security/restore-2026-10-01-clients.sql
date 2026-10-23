-- Restore of 02-Oct-2026, staging only: the three clients of firm "Garg Shekhar& Company" (efe13a47-…) blanked at
-- 18:35:26 UTC on 01-Oct. Apply migration-19-sync-guard.sql first, so an old open tab cannot blank them again.
--   1. Testing AAD (cmufksrrqjub2g) and Mastercad Solutions (cmugy1hlvpnba5): name, GSTIN, PAN, Tally name and data from
--      the backup of 30-Sep-2026 19:30 UTC (backups id 10), and deleted = false.
--   2. garg shekhar & company (cmupe4m7upncpy): in no backup (it was added on 01-Oct). It comes back with its name and
--      FinCom's defaults; type its GSTIN and PAN again in Client setup. Its bill, supplier and bank settings were never
--      touched and come back with it.
-- Only these three rows change. Their bills, parties, bank, sales and book items were not touched by the incident.

begin;

update public.clients c
   set name = b.c->>'name', gstin = coalesce(b.c->>'gstin', ''), pan = coalesce(b.c->>'pan', ''),
       tally_name = coalesce(b.c->>'tally_name', ''), data = b.c->'data', deleted = false
  from (select x as c from public.backups, jsonb_array_elements(data->'clients') x
         where backups.id = 10 and backups.firm_id = 'efe13a47-f0fa-43be-a18c-bf32caa448ca') b
 where c.firm_id = 'efe13a47-f0fa-43be-a18c-bf32caa448ca'
   and c.id = b.c->>'id' and c.id in ('cmufksrrqjub2g', 'cmugy1hlvpnba5');

update public.clients
   set name = 'garg shekhar & company', tally_name = 'garg shekhar & company', deleted = false,
       data = jsonb_build_object('id', 'cmupe4m7upncpy', 'name', 'garg shekhar & company', 'tallyName', 'garg shekhar & company',
         'gstin', '', 'pan', '', 'voucherType', 'Journal', 'createOptional', true, 'billwise', true, 'turnover10cr', false,
         'roundOff', 'Round Off', 'stats', '{}'::jsonb, 'hashes', '{}'::jsonb, 'keys', '{}'::jsonb,
         'createdAt', '2026-10-01T00:00:00Z', 'restoredNote', 'Re-added on 02-Oct-2026: GSTIN and PAN to be typed again')
 where firm_id = 'efe13a47-f0fa-43be-a18c-bf32caa448ca' and id = 'cmupe4m7upncpy';

-- what is there now: three rows, not deleted, with a name
select id, name, gstin, pan, tally_name, deleted, length(data::text) as data_size, updated_at
  from public.clients where firm_id = 'efe13a47-f0fa-43be-a18c-bf32caa448ca' order by name;

commit;
